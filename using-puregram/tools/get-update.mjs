#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  fuzzyMatch,
  parseArgs,
  requireInstalled,
  suggestAndFail,
  tryAutoCorrect
} from './_utils.mjs'

const HELP = `
get-update — look up a wrapped update class shipped by @puregram/api.

usage:
  node skills/using-puregram/tools/get-update.mjs <kind|ClassName>
  node skills/using-puregram/tools/get-update.mjs --list

accepts:
  the update kind discriminant (e.g. message, callback_query, message_reaction)
  the class name (e.g. MessageUpdate, CallbackQueryUpdate)

flags:
  --list   print every update class and its kind
  --help   show this help

examples:
  node skills/using-puregram/tools/get-update.mjs message
  node skills/using-puregram/tools/get-update.mjs CallbackQueryUpdate
  node skills/using-puregram/tools/get-update.mjs message_reaction
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
  const dtsPath = join(apiDir, 'lib/generated/updates.d.ts')
  if (!existsSync(dtsPath)) {
    console.error(`expected types not found at ${dtsPath}`)
    process.exit(1)
  }

  const src = await readFile(dtsPath, 'utf8')
  const lines = src.split('\n')
  const classes = indexClasses(lines)

  if (flags.has('--list')) {
    const w = Math.max(...classes.map(c => c.name.length))
    for (const c of classes.sort((a, b) => a.name.localeCompare(b.name))) {
      const kind = c.kind ? `kind: ${c.kind}` : '(no kind discriminant)'
      console.log(`  ${c.name.padEnd(w)}  ${kind}`)
    }
    return
  }

  // match against both class names and kind discriminants
  const candidates = [
    ...classes.map(c => ({ ...c, _matchName: c.name })),
    ...classes.filter(c => c.kind).map(c => ({ ...c, _matchName: c.kind }))
  ]

  const { exact, partial, ranked } = fuzzyMatch(query, candidates, c => c._matchName)
  let hit = exact[0]
  if (!hit) hit = tryAutoCorrect(query, ranked)
  if (!hit) suggestAndFail(query, partial, ranked, c => c._matchName)

  printUpdate(hit, classes, dtsPath)
}

function indexClasses (lines) {
  const classes = []
  let i = 0
  while (i < lines.length) {
    const m = lines[i].match(/^export declare class (\w+Update|\w+Shared)(?:<[^>]*>)?\s+(?:extends\s+(\w+)(?:<[^>]*>)?\s+)?\{/)
    if (m) {
      const name = m[1]
      const parent = m[2] ?? null
      const declLine = i + 1
      const { kind, bodyEnd, members } = scanClassBody(lines, i + 1)
      classes.push({ name, parent, kind, declLine, bodyEnd, members })
      i = bodyEnd
      continue
    }
    i++
  }
  // also pick up internal shared bases (sometimes declared without `export`)
  for (let j = 0; j < lines.length; j++) {
    const m = lines[j].match(/^declare class (\w+Shared)\s+\{/)
    if (m) {
      const { kind, bodyEnd, members } = scanClassBody(lines, j + 1)
      classes.push({ name: m[1], parent: null, kind, declLine: j + 1, bodyEnd, members, internal: true })
    }
  }
  return classes
}

function scanClassBody (lines, start) {
  let depth = 1
  let kind = null
  const members = []
  let i = start
  for (; i < lines.length; i++) {
    const l = lines[i]
    if (kind === null) {
      const km = l.match(/readonly kind:\s*"([^"]+)"/)
      if (km) kind = km[1]
    }
    // pick up public getters and methods (skip private/protected)
    const sig = l.match(/^\s{4}((?:get|set)\s+\w+|\w+)\s*[\(\:]/)
    if (sig && !/^\s*(private|protected|declare)/.test(l)) members.push(l.trim().replace(/;$/, ''))
    for (const ch of l) {
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) return { kind, bodyEnd: i + 1, members }
      }
    }
  }
  return { kind, bodyEnd: i, members }
}

function printUpdate (hit, all, dtsPath) {
  console.log(`${hit.name}`)
  if (hit.kind) console.log(`  kind: ${hit.kind}`)
  if (hit.parent) console.log(`  extends: ${hit.parent}`)
  console.log(`  source: ${dtsPath}:${hit.declLine}`)

  // collect members from the class itself plus walked-up parents
  const chain = [hit]
  let cur = hit
  while (cur.parent) {
    const next = all.find(c => c.name === cur.parent)
    if (!next) break
    chain.push(next)
    cur = next
  }

  for (const c of chain) {
    if (c.members.length === 0) continue
    console.log()
    console.log(`members (${c.name}):`)
    for (const m of c.members) console.log(`  ${m}`)
  }

  console.log()
  console.log('puregram usage:')
  if (hit.kind) {
    const handler = camelOnHandler(hit.kind)
    console.log(`  tg.${handler}(update => { /* update is ${hit.name} */ })`)
    console.log(`  tg.on('${hit.kind}', update => { /* update is ${hit.name} */ })`)
  }
  console.log(`  import { ${hit.name} } from '@puregram/api'`)
}

function camelOnHandler (kind) {
  const camel = kind.replace(/_(\w)/g, (_, c) => c.toUpperCase())
  return `on${camel[0].toUpperCase()}${camel.slice(1)}`
}

await main()
