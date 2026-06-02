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
get-method — look up a bot api method from the schema shipped by @puregram/api.

usage:
  node skills/using-puregram/tools/get-method.mjs <method>
  node skills/using-puregram/tools/get-method.mjs --list

flags:
  --json   emit the raw schema entry instead of rendered text
  --list   print every method name and exit
  --help   show this help

examples:
  node skills/using-puregram/tools/get-method.mjs sendMessage
  node skills/using-puregram/tools/get-method.mjs sendphoto      # fuzzy match
  node skills/using-puregram/tools/get-method.mjs --list
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
  const methods = schema.methods ?? []

  if (flags.has('--list')) {
    for (const m of methods.map(m => m.name).sort()) console.log(m)
    return
  }

  const { exact, partial, ranked } = fuzzyMatch(name, methods, m => m.name)
  let method = exact[0]
  if (!method) method = tryAutoCorrect(name, ranked)
  if (!method) suggestAndFail(name, partial, ranked, m => m.name)

  if (flags.has('--json')) {
    console.log(JSON.stringify(method, null, 2))
    return
  }

  printMethod(method, schema.version)
}

function printMethod (m, version) {
  const v = `bot api ${version.major}.${version.minor}`
  console.log(`${m.name}  (${v})`)
  console.log(`  ${m.documentationLink}`)
  console.log()
  console.log(wrap(m.description, '  '))
  if (m.multipartOnly) {
    console.log()
    console.log('  multipart-only: this method must be sent as multipart/form-data')
  }

  if (m.arguments && m.arguments.length > 0) {
    console.log()
    console.log('arguments:')
    for (const a of m.arguments) {
      const req = a.required ? '' : '?'
      console.log(`  ${a.name}${req}: ${renderType(a.type)}`)
      console.log(wrap(a.description, '      '))
    }
  } else {
    console.log()
    console.log('arguments: (none)')
  }

  console.log()
  console.log(`returns: ${renderType(m.returnType)}`)

  console.log()
  console.log('puregram usage:')
  console.log(`  await tg.api.${m.name}({ ... })          // raw bot-api signature, throws ApiError on failure`)
  console.log(`  await tg.api.${m.name}({ ..., suppress: true })  // returns T | ApiResponseError instead of throwing`)
  console.log(`  await tg.api.call('${m.name}', { ... }) // string escape hatch, always throws`)
}

/** word-wrap a string at ~80 cols with the given indent */
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
