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
get-shortcut — look up a curated tg.send-family shortcut from TelegramShortcuts.

usage:
  node skills/using-puregram/tools/get-shortcut.mjs <name>
  node skills/using-puregram/tools/get-shortcut.mjs --list

for per-update shortcuts (update.send / update.reply / update.delete / etc.)
use get-update.mjs — those live on the wrapped update class hierarchy.

flags:
  --list   print every shortcut name
  --help   show this help

examples:
  node skills/using-puregram/tools/get-shortcut.mjs send
  node skills/using-puregram/tools/get-shortcut.mjs sendPhoto
  node skills/using-puregram/tools/get-shortcut.mjs forward
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
  const dtsPath = join(apiDir, 'lib/generated/shortcuts.d.ts')
  if (!existsSync(dtsPath)) {
    console.error(`expected types not found at ${dtsPath}`)
    process.exit(1)
  }

  const src = await readFile(dtsPath, 'utf8')
  const shortcuts = parseShortcuts(src)

  if (flags.has('--list')) {
    for (const s of shortcuts.map(s => s.name).sort()) console.log(s)
    return
  }

  const { exact, partial, ranked } = fuzzyMatch(query, shortcuts, s => s.name)
  let hit = exact[0]
  if (!hit) hit = tryAutoCorrect(query, ranked)
  if (!hit) suggestAndFail(query, partial, ranked, s => s.name)

  printShortcut(hit, dtsPath)
}

function parseShortcuts (src) {
  const lines = src.split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (/^\s*\/\*\*/.test(l)) {
      const jsdocLines = []
      while (i < lines.length && !/\*\//.test(lines[i])) {
        jsdocLines.push(lines[i])
        i++
      }
      if (i < lines.length) {
        jsdocLines.push(lines[i])
        i++
      }
      // look ahead for a method signature
      while (i < lines.length && lines[i].trim() === '') i++
      const sigLines = []
      while (i < lines.length) {
        sigLines.push(lines[i])
        if (/;\s*$/.test(lines[i])) { i++; break }
        i++
      }
      const sig = sigLines.join('\n').trim()
      const m = sig.match(/^(\w+)\s*[\(<]/)
      if (m) {
        out.push({ name: m[1], jsdoc: cleanJsdoc(jsdocLines), signature: sig })
      }
      continue
    }
    i++
  }
  return out
}

function cleanJsdoc (lines) {
  return lines
    .map(l => l.replace(/^\s*\/?\*+\/?/, '').trim())
    .filter(l => l.length > 0)
    .join('\n')
}

function printShortcut (s, dtsPath) {
  console.log(`tg.${s.name}`)
  console.log(`  source: ${dtsPath}`)
  console.log()
  if (s.jsdoc) {
    console.log(s.jsdoc.split('\n').map(l => `  ${l}`).join('\n'))
    console.log()
  }
  console.log('signature:')
  console.log(`  ${s.signature}`)
  console.log()
  console.log('puregram usage:')
  console.log(`  await tg.${s.name}(/* see signature above */)`)
}

await main()
