#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  cleanJsdoc,
  fuzzyMatch,
  parseArgs,
  requireInstalled,
  resolvePackageDir,
  suggestAndFail,
  tryAutoCorrect
} from './_utils.mjs'

const HELP = `
get-filter — look up a puregram dispatch filter.

covers every filter you can pass to tg.on<Kind>(filter, handler):
  - presence filters (hasText, hasPhoto, ...) — one per nullable update field
  - kind.<X> / action.<X> — match an update kind / service-event kind
  - handcrafted filters (command, text, regex, from, chat, callbackData, ...)
  - composition helpers (and, or, not, every, some)

usage:
  node skills/using-puregram/tools/get-filter.mjs <name>
  node skills/using-puregram/tools/get-filter.mjs --list

flags:
  --list   print every filter, grouped by category
  --help   show this help

examples:
  node skills/using-puregram/tools/get-filter.mjs hasText
  node skills/using-puregram/tools/get-filter.mjs command
  node skills/using-puregram/tools/get-filter.mjs kind.message
  node skills/using-puregram/tools/get-filter.mjs kind          # whole namespace
`

function main () {
  const { flags, positional } = parseArgs()
  if (flags.has('--help') || (!positional && !flags.has('--list'))) {
    process.stdout.write(HELP.trimStart())
    process.exit(positional ? 0 : 1)
  }
  return run({ flags, query: positional })
}

async function run ({ flags, query }) {
  const apiDir = requireInstalled('@puregram/api')
  const coreDir = resolvePackageDir('puregram')

  const filters = await collectFilters(apiDir, coreDir)

  if (filters.length === 0) {
    console.error('no filters found — is @puregram/api built? expected lib/generated/filters.d.ts')
    process.exit(1)
  }

  if (flags.has('--list')) {
    printList(filters)
    return
  }

  // whole-namespace shortcut
  if (query === 'kind' || query === 'action') {
    printNamespace(query, filters)
    return
  }

  const { exact, partial, ranked } = fuzzyMatch(query, filters, f => f.name)
  let hit = exact[0]
  if (!hit) hit = tryAutoCorrect(query, ranked)
  if (!hit) suggestAndFail(query, partial, ranked, f => f.name)

  printFilter(hit)
}

async function collectFilters (apiDir, coreDir) {
  const out = []

  // 1. generated presence (hasX) + kind/action namespaces
  const genPath = join(apiDir, 'lib/generated/filters.d.ts')
  if (existsSync(genPath)) {
    const src = await readFile(genPath, 'utf8')
    for (const decl of parseDecls(src)) {
      if (decl.name === 'kind' || decl.name === 'action') {
        for (const member of parseNamespaceMembers(decl.signature)) {
          out.push({
            name: `${decl.name}.${member.key}`,
            category: decl.name,
            narrows: member.update,
            jsdoc: '',
            source: `@puregram/api lib/generated/filters.d.ts:${decl.line}`
          })
        }
        continue
      }
      if (/^has[A-Z]/.test(decl.name)) {
        out.push({
          name: decl.name,
          category: 'presence',
          narrows: extractNarrowing(decl.signature),
          jsdoc: decl.jsdoc,
          signature: decl.signature,
          source: `@puregram/api lib/generated/filters.d.ts:${decl.line}`
        })
      }
    }
  }

  // 2. composition helpers (and / or / not / every / some)
  const runtimePath = join(apiDir, 'lib/filter-runtime.d.ts')
  if (existsSync(runtimePath)) {
    const src = await readFile(runtimePath, 'utf8')
    for (const decl of parseDecls(src)) {
      if (['and', 'or', 'not', 'every', 'some'].includes(decl.name)) {
        upsert(out, {
          name: decl.name,
          category: 'composition',
          jsdoc: decl.jsdoc,
          signature: decl.signature,
          source: `@puregram/api lib/filter-runtime.d.ts:${decl.line}`
        })
      }
    }
  }

  // 3. handcrafted filters, one file per topic under core lib/filters
  if (coreDir) {
    const filtersDir = join(coreDir, 'lib/filters')
    if (existsSync(filtersDir)) {
      const files = readdirSync(filtersDir)
        .filter(f => f.endsWith('.d.ts') && !['index.d.ts', 'composition.d.ts'].includes(f))
      for (const file of files) {
        const topic = file.replace('.d.ts', '')
        const src = await readFile(join(filtersDir, file), 'utf8')
        for (const decl of parseDecls(src)) {
          // skip type-only helpers, keep filter values/functions
          upsert(out, {
            name: decl.name,
            category: topic,
            jsdoc: decl.jsdoc,
            signature: decl.signature,
            source: `puregram lib/filters/${file}:${decl.line}`
          })
        }
      }
    }
  }

  return out
}

/** add a filter, merging overload signatures under one name */
function upsert (list, entry) {
  const existing = list.find(f => f.name === entry.name && f.category === entry.category)
  if (existing) {
    if (entry.signature && existing.signature !== entry.signature) {
      existing.signature += `\n${entry.signature}`
    }
    if (!existing.jsdoc && entry.jsdoc) existing.jsdoc = entry.jsdoc
    return
  }
  list.push(entry)
}

/** walk a .d.ts, pairing each `export declare const|function NAME` with its jsdoc */
function parseDecls (src) {
  const lines = src.split('\n')
  const out = []
  let jsdoc = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (/^\s*\/\*\*/.test(line)) {
      const block = []
      // single-line /** ... */
      if (/\*\//.test(line)) {
        block.push(line)
        i++
      } else {
        while (i < lines.length) {
          block.push(lines[i])
          if (/\*\//.test(lines[i])) { i++; break }
          i++
        }
      }
      jsdoc = block
      continue
    }

    const m = line.match(/^export declare (?:const|function) (\w+)/)
    if (m) {
      const { signature, next } = collectSignature(lines, i)
      out.push({ name: m[1], signature: normalize(signature), jsdoc: cleanJsdoc(jsdoc), line: i + 1 })
      jsdoc = []
      i = next
      continue
    }

    if (line.trim() !== '' && !/^\s*\*/.test(line)) jsdoc = []
    i++
  }
  return out
}

/** gather a declaration's lines until the terminating `;` at bracket depth 0 */
function collectSignature (lines, start) {
  let depth = 0
  const buf = []
  let i = start
  for (; i < lines.length; i++) {
    const l = lines[i]
    buf.push(l)
    for (const ch of l) {
      if (ch === '{' || ch === '(' || ch === '[') depth++
      else if (ch === '}' || ch === ')' || ch === ']') depth--
      else if (ch === ';' && depth <= 0) return { signature: buf.join('\n'), next: i + 1 }
    }
  }
  return { signature: buf.join('\n'), next: i }
}

/** collapse whitespace and drop the `export declare` prefix */
function normalize (sig) {
  return sig.replace(/^export declare (const|function)\s+/, '').replace(/\s+/g, ' ').replace(/;$/, '').trim()
}

/** pull the `{ field: Type }` narrowing out of `Filter<unknown, { ... }>` */
function extractNarrowing (sig) {
  const m = sig.match(/Filter<[^,]*,\s*(\{.*\})\s*>$/)
  if (!m) return null
  return m[1].replace(/\s+/g, ' ').replace(/;\s*}/, ' }').trim()
}

/** read `key: Filter<import("...").XUpdate, ...>` members out of a kind/action block */
function parseNamespaceMembers (sig) {
  const members = []
  const re = /(\w+):\s*Filter<(?:import\([^)]*\)\.)?(\w+)/g
  let m
  while ((m = re.exec(sig)) !== null) {
    if (m[1] === 'Filter') continue
    members.push({ key: m[1], update: m[2] })
  }
  return members
}

function printList (filters) {
  const by = (cat) => filters.filter(f => f.category === cat).map(f => f.name).sort()

  const composition = by('composition')
  if (composition.length) {
    console.log('composition:')
    console.log(`  ${composition.join(', ')}`)
    console.log()
  }

  const kinds = by('kind')
  if (kinds.length) {
    console.log(`kind.<X>  (${kinds.length} update kinds — match an update kind):`)
    console.log(wrapNames(kinds))
    console.log()
  }

  const actions = by('action')
  if (actions.length) {
    console.log(`action.<X>  (${actions.length} service-event kinds):`)
    console.log(wrapNames(actions))
    console.log()
  }

  const presence = by('presence')
  if (presence.length) {
    console.log(`presence  (${presence.length} — true when the field is set):`)
    console.log(wrapNames(presence))
    console.log()
  }

  const handcrafted = [...new Set(filters
    .filter(f => !['composition', 'kind', 'action', 'presence'].includes(f.category))
    .map(f => f.category))].sort()
  for (const topic of handcrafted) {
    const names = by(topic)
    console.log(`${topic}:`)
    console.log(`  ${names.join(', ')}`)
  }

  console.log()
  console.log('run get-filter <name> for signature + usage. kind/action: see get-update --list.')
}

function printNamespace (ns, filters) {
  const members = filters.filter(f => f.category === ns).sort((a, b) => a.name.localeCompare(b.name))
  console.log(`${ns}  (namespace — ${members.length} members)`)
  console.log()
  const width = Math.max(...members.map(m => m.name.length))
  for (const m of members) {
    console.log(`  ${m.name.padEnd(width)}  → ${m.narrows ?? ''}`)
  }
  console.log()
  console.log('puregram usage:')
  console.log(`  import { ${ns} } from 'puregram'`)
  console.log(`  tg.onUpdate(${ns}.${members[0]?.name.split('.')[1] ?? 'X'}, (update) => { /* narrowed */ })`)
}

function printFilter (f) {
  console.log(f.name)
  console.log(`  category: ${f.category}`)
  console.log(`  source: ${f.source}`)
  if (f.narrows) console.log(`  narrows: ${f.narrows}`)
  if (f.jsdoc) {
    console.log()
    console.log(f.jsdoc.split('\n').map(l => `  ${l}`).join('\n'))
  }
  if (f.signature) {
    console.log()
    console.log('signature:')
    for (const sig of f.signature.split('\n')) console.log(`  ${sig}`)
  }

  console.log()
  console.log('puregram usage:')
  if (f.category === 'composition') {
    console.log(`  import { ${f.name}, hasText, kind } from 'puregram'`)
    console.log(`  tg.onUpdate(${f.name}(kind.message, hasText), (update) => { /* ... */ })`)
  } else if (f.category === 'kind' || f.category === 'action') {
    const [ns, key] = f.name.split('.')
    console.log(`  import { ${ns} } from 'puregram'`)
    console.log(`  tg.onUpdate(${ns}.${key}, (update) => { /* update is ${f.narrows ?? 'narrowed'} */ })`)
  } else {
    // callable factories (command, text, from, chat, ...) vs bare value filters (hasText, ...)
    const callable = /^\w+\s*[(<]/.test(f.signature) || /=>/.test(f.signature)
    const expr = callable ? `${f.name}(/* … */)` : f.name
    console.log(`  import { ${f.name} } from 'puregram'   // or: filters.${f.name}`)
    console.log(`  tg.onUpdate(${expr}, (update) => { /* narrowed */ })`)
    console.log('  // kind dispatchers (tg.onMessage, tg.onCallbackQuery, …) accept it too when the kinds line up')
  }
}

/** print a long name list wrapped at ~78 cols, two-space indented */
function wrapNames (names) {
  const lines = []
  let line = '  '
  for (const n of names) {
    if (line.length + n.length + 2 > 78 && line.trim() !== '') {
      lines.push(line.replace(/, $/, ''))
      line = '  '
    }
    line += `${n}, `
  }
  if (line.trim() !== '') lines.push(line.replace(/, $/, ''))
  return lines.join('\n')
}

await main()
