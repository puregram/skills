import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const PUREGRAM_PACKAGES = [
  'puregram',
  '@puregram/api',
  '@puregram/flow',
  '@puregram/scenes',
  '@puregram/session',
  '@puregram/storage',
  '@puregram/markup',
  '@puregram/callback-data',
  '@puregram/media-cacher',
  '@puregram/rate-limit',
  '@puregram/file-id',
  '@puregram/utils',
  '@puregram/test'
]

function levenshtein (a, b) {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const prev = new Array(b.length + 1)
  const curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

/** find items by exact match, then substring match, then nearest distance */
export function fuzzyMatch (query, items, getName) {
  const q = query.toLowerCase()
  const exact = []
  const partial = []
  const ranked = []

  for (const item of items) {
    const name = getName(item)
    const lower = name.toLowerCase()
    if (lower === q) exact.push(item)
    else if (lower.includes(q)) partial.push(item)
    ranked.push({ item, name, dist: levenshtein(q, lower) })
  }

  ranked.sort((a, b) => a.dist - b.dist)
  return { exact, partial, ranked }
}

/** if there's one near-match within edit distance 2, auto-pick it */
export function tryAutoCorrect (query, ranked) {
  if (ranked.length === 0 || ranked[0].dist > 2) return null
  const best = ranked[0].dist
  const tied = ranked.filter(r => r.dist === best)
  if (tied.length !== 1) return null
  console.error(`(assuming "${tied[0].name}" for "${query}")`)
  console.error()
  return tied[0].item
}

/** print suggestions and exit non-zero */
export function suggestAndFail (query, partial, ranked, getName = (x) => x) {
  if (partial.length > 0) {
    console.error(`no exact match for "${query}". similar:`)
    for (const item of partial.slice(0, 20)) {
      console.error(`  ${getName(item)}`)
    }
  } else if (ranked.length > 0 && ranked[0].dist <= 5) {
    console.error(`no match for "${query}". did you mean:`)
    for (const r of ranked.filter(r => r.dist <= 5).slice(0, 10)) {
      console.error(`  ${r.name}`)
    }
  } else {
    console.error(`nothing found matching "${query}"`)
  }
  process.exit(1)
}

/** parse argv into { flags, positional, positionals } */
export function parseArgs () {
  const args = process.argv.slice(2)
  const flags = new Set()
  const positionals = []
  for (const a of args) {
    if (a.startsWith('--')) flags.add(a)
    else positionals.push(a)
  }
  return { flags, positional: positionals[0], positionals }
}

/** walk up from a starting dir to find the nearest package.json */
function findPackageRoot (startDir) {
  let dir = startDir
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir
}

/** locate an installed package's root directory using node's resolver */
export function resolvePackageDir (pkg, from = process.cwd()) {
  const req = createRequire(join(from, '__stub.js'))
  try {
    return dirname(req.resolve(`${pkg}/package.json`))
  } catch {}
  try {
    return findPackageRoot(dirname(req.resolve(pkg)))
  } catch {}
  // last-resort walk up looking for node_modules/<pkg>
  let dir = from
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'node_modules', pkg)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** assert a package is installed, returning its root or exiting with a hint */
export function requireInstalled (pkg) {
  const dir = resolvePackageDir(pkg)
  if (!dir) {
    console.error(`could not find ${pkg} in node_modules. install it first:`)
    console.error(`  npm install ${pkg}`)
    process.exit(1)
  }
  return dir
}

/** pick the latest version-named json file in a schema directory */
export function pickLatestSchema (schemaDir) {
  if (!existsSync(schemaDir)) return null
  // accepts the current `X.Y.json` and legacy `X.Y.Z.json` names; the `archive/` dir is ignored (no extension match)
  const files = readdirSync(schemaDir).filter(f => /^\d+\.\d+(?:\.\d+)?\.json$/.test(f))
  if (files.length === 0) return null
  files.sort((a, b) => {
    const pa = a.replace('.json', '').split('.').map(Number)
    const pb = b.replace('.json', '').split('.').map(Number)
    const len = Math.max(pa.length, pb.length)
    for (let i = 0; i < len; i++) {
      if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0)
    }
    return 0
  })
  return join(schemaDir, files[0])
}

/** render a schema type node back into a readable signature */
export function renderType (t) {
  if (!t || !t.kind) return 'unknown'
  switch (t.kind) {
    case 'integer': return 'integer'
    case 'string': return 'string'
    case 'bool': return 'boolean'
    case 'true': return 'true'
    case 'float': return 'number'
    case 'union': {
      const inner = (t.of ?? []).map(renderType)
      return inner.length === 1 ? inner[0] : inner.join(' | ')
    }
    case 'array': return `${renderType(t.of)}[]`
    case 'reference': return t.name ?? 'unknown'
    default: return t.name ?? t.kind
  }
}
