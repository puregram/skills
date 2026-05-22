#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import {
  fuzzyMatch,
  parseArgs,
  pickLatestSchema,
  renderType,
  requireInstalled,
  suggestAndFail,
  tryAutoCorrect
} from './_utils.mjs'

const HELP = `
get-object — look up a bot api object/structure from the schema shipped by @puregram/api.

usage:
  node skills/using-puregram/tools/get-object.mjs <name>
  node skills/using-puregram/tools/get-object.mjs --list

flags:
  --json   emit the raw schema entry instead of rendered text
  --list   print every object name and exit
  --help   show this help

examples:
  node skills/using-puregram/tools/get-object.mjs Message
  node skills/using-puregram/tools/get-object.mjs inlinequeryresult     # fuzzy match
  node skills/using-puregram/tools/get-object.mjs Update
`

function main () {
  const { flags, positional } = parseArgs()
  if (flags.has('--help') || (!positional && !flags.has('--list'))) {
    process.stdout.write(HELP.trimStart())
    process.exit(positional ? 0 : 1)
  }
  return run({ flags, name: positional })
}

async function run ({ flags, name }) {
  const apiDir = requireInstalled('@puregram/api')
  const schemaPath = pickLatestSchema(`${apiDir}/schema`)
  if (!schemaPath) {
    console.error(`no schema found under ${apiDir}/schema`)
    process.exit(1)
  }
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
  const objects = schema.objects ?? []

  if (flags.has('--list')) {
    for (const o of objects.map(o => o.name).sort()) console.log(o)
    return
  }

  const { exact, partial, ranked } = fuzzyMatch(name, objects, o => o.name)
  let obj = exact[0]
  if (!obj) obj = tryAutoCorrect(name, ranked)
  if (!obj) suggestAndFail(name, partial, ranked, o => o.name)

  if (flags.has('--json')) {
    console.log(JSON.stringify(obj, null, 2))
    return
  }

  printObject(obj, schema.version)
}

function printObject (o, version) {
  const v = `bot api ${version.major}.${version.minor}.${version.patch}`
  console.log(`${o.name}  (${v})`)
  console.log(`  ${o.documentationLink}`)
  console.log()
  console.log(wrap(o.description, '  '))

  if (o.fields && o.fields.length > 0) {
    console.log()
    console.log('fields:')
    for (const f of o.fields) {
      const req = f.required ? '' : '?'
      console.log(`  ${f.name}${req}: ${renderType(f.type)}`)
      console.log(wrap(f.description, '      '))
    }
  }

  if (o.subtypes && o.subtypes.length > 0) {
    console.log()
    console.log('subtypes:')
    for (const s of o.subtypes) console.log(`  ${s}`)
  }

  console.log()
  console.log('puregram usage:')
  console.log(`  import type { Telegram${o.name} } from '@puregram/api'`)
}

function wrap (text, indent) {
  const width = 80 - indent.length
  const words = (text ?? '').split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    if (line.length + w.length + 1 > width) {
      lines.push(indent + line)
      line = w
    } else {
      line = line ? `${line} ${w}` : w
    }
  }
  if (line) lines.push(indent + line)
  return lines.join('\n')
}

await main()
