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
get-factory — look up a puregram factory class and its builder methods.

factories turn positional + camelCase-extras calls into typed bot-api payloads:
  MediaSource, InputMedia, MediaGroup, InlineQueryResult, InputMessageContent,
  ReplyParameters, LinkPreview, ChatPermissions, Keyboard, InlineKeyboard,
  Reaction, BotCommands, MenuButton, LabeledPrice, ... and the *Builder classes.

usage:
  node skills/using-puregram/tools/get-factory.mjs <Name>
  node skills/using-puregram/tools/get-factory.mjs --list

flags:
  --list   print every factory class and its method count
  --help   show this help

examples:
  node skills/using-puregram/tools/get-factory.mjs MediaSource
  node skills/using-puregram/tools/get-factory.mjs InlineKeyboard
  node skills/using-puregram/tools/get-factory.mjs inputmedia      # fuzzy match
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

  const factories = await collectFactories(apiDir, coreDir)

  if (factories.length === 0) {
    console.error('no factory classes found — is puregram built?')
    process.exit(1)
  }

  if (flags.has('--list')) {
    const width = Math.max(...factories.map(f => f.name.length))
    for (const f of factories.sort((a, b) => a.name.localeCompare(b.name))) {
      const n = f.members.length
      console.log(`  ${f.name.padEnd(width)}  ${n} ${n === 1 ? 'method' : 'methods'}  (${f.pkg})`)
    }
    return
  }

  const { exact, partial, ranked } = fuzzyMatch(query, factories, f => f.name)
  let hit = exact[0]
  if (!hit) hit = tryAutoCorrect(query, ranked)
  if (!hit) suggestAndFail(query, partial, ranked, f => f.name)

  printFactory(hit)
}

const SOURCES = [
  { pkg: '@puregram/api', rel: 'lib/generated/factories.d.ts' },
  { pkg: 'puregram', rel: 'lib/factories', dir: true },
  { pkg: 'puregram', rel: 'lib/keyboards', dir: true },
  { pkg: 'puregram', rel: 'lib/media-source/index.d.ts' }
]

async function collectFactories (apiDir, coreDir) {
  const dirs = { '@puregram/api': apiDir, puregram: coreDir }
  const found = new Map()

  for (const src of SOURCES) {
    const base = dirs[src.pkg]
    if (!base) continue
    const target = join(base, src.rel)
    if (!existsSync(target)) continue

    const files = src.dir
      ? readdirSync(target).filter(f => f.endsWith('.d.ts') && f !== 'index.d.ts').map(f => join(target, f))
      : [target]

    for (const file of files) {
      const text = await readFile(file, 'utf8')
      const rel = file.slice(base.length + 1)
      for (const cls of parseClasses(text)) {
        if (cls.members.length === 0) continue
        const existing = found.get(cls.name)
        if (existing) {
          mergeMembers(existing.members, cls.members)
        } else {
          found.set(cls.name, { name: cls.name, pkg: src.pkg, source: `${src.pkg} ${rel}:${cls.line}`, members: cls.members })
        }
      }
    }
  }

  return [...found.values()]
}

function mergeMembers (into, extra) {
  for (const m of extra) {
    if (!into.some(x => x.name === m.name && x.static === m.static)) into.push(m)
  }
}

/** parse `export declare class NAME { ... }` blocks, capturing public static/instance members */
function parseClasses (src) {
  const lines = src.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^export declare class (\w+)/)
    if (!m) continue
    const { members, end } = scanBody(lines, i + 1)
    out.push({ name: m[1], line: i + 1, members })
    i = end - 1
  }
  return out
}

function scanBody (lines, start) {
  let depth = 1
  const members = []
  let jsdoc = []
  let i = start
  for (; i < lines.length; i++) {
    const line = lines[i]

    if (/^\s*\/\*\*/.test(line)) {
      const block = []
      if (/\*\//.test(line)) {
        block.push(line)
      } else {
        while (i < lines.length) {
          block.push(lines[i])
          if (/\*\//.test(lines[i])) break
          i++
        }
      }
      jsdoc = block
      continue
    }

    // a public member sits at brace depth 1 — capture before counting this line's braces
    if (depth === 1) {
      const mm = line.match(/^\s{2,}(static\s+)?((?:get|set)\s+)?(\w+)\s*[(<:]/)
      if (mm && !/^\s*(private|protected|constructor|readonly\s+#|#)/.test(line)) {
        const isStatic = Boolean(mm[1])
        const name = mm[3]
        if (name !== 'constructor' && name !== 'private') {
          const { signature, next } = collectMember(lines, i)
          members.push({ name, static: isStatic, signature: normalize(signature), jsdoc: cleanJsdoc(jsdoc) })
          jsdoc = []
          // advance over consumed lines, but keep brace accounting correct below
          for (let k = i; k < next; k++) depth += braceDelta(lines[k])
          i = next - 1
          continue
        }
      }
      if (line.trim() !== '' && !/^\s*\*/.test(line)) jsdoc = []
    }

    depth += braceDelta(line)
    if (depth <= 0) return { members, end: i + 1 }
  }
  return { members, end: i }
}

function braceDelta (line) {
  let d = 0
  for (const ch of line) {
    if (ch === '{') d++
    else if (ch === '}') d--
  }
  return d
}

/** gather a member declaration until its terminating `;` at the member's own depth */
function collectMember (lines, start) {
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

function normalize (sig) {
  // the `static` modifier is conveyed by the `Class.` print prefix, so drop it here
  return sig.replace(/\s+/g, ' ').trim().replace(/^static\s+/, '').replace(/;$/, '').trim()
}

function printFactory (f) {
  console.log(f.name)
  console.log(`  source: ${f.source}`)

  const statics = f.members.filter(m => m.static)
  const instance = f.members.filter(m => !m.static)

  if (statics.length) {
    console.log()
    console.log('static:')
    for (const m of statics) printMember(f.name, m)
  }
  if (instance.length) {
    console.log()
    console.log('instance:')
    for (const m of instance) printMember(f.name, m)
  }

  console.log()
  console.log('puregram usage:')
  console.log(`  import { ${f.name} } from 'puregram'`)
}

function printMember (cls, m) {
  const prefix = m.static ? `${cls}.` : '.'
  console.log(`  ${prefix}${m.signature}`)
  if (m.jsdoc) {
    console.log(m.jsdoc.split('\n').map(l => `      ${l}`).join('\n'))
  }
}

await main()
