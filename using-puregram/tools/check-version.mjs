#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseArgs,
  pickLatestSchema,
  PUREGRAM_PACKAGES,
  readPackageJson,
  resolvePackageDir
} from './_utils.mjs'

const HELP = `
check-version — report installed puregram versions and flag schema drift.

shows the installed version of every @puregram/* package, the bot api version
baked into the installed @puregram/api schema, and whether that matches the
bot api this skill is pinned to (the \`bot_api\` field in SKILL.md). exits
non-zero on drift so it can guard a CI step.

usage:
  node skills/using-puregram/tools/check-version.mjs
  node skills/using-puregram/tools/check-version.mjs --json

flags:
  --json   emit a machine-readable report instead of rendered text
  --help   show this help
`

const here = dirname(fileURLToPath(import.meta.url))

function main () {
  const { flags } = parseArgs()
  if (flags.has('--help')) {
    process.stdout.write(HELP.trimStart())
    process.exit(0)
  }
  return run({ flags })
}

/** read the bot_api pin out of the sibling SKILL.md frontmatter */
async function readSkillPin () {
  const skillPath = join(here, '..', 'SKILL.md')
  if (!existsSync(skillPath)) return null
  const src = await readFile(skillPath, 'utf8')
  const m = src.match(/^\s*bot_api:\s*"?(\d+\.\d+(?:\.\d+)?)"?/m)
  return m ? m[1] : null
}

async function run ({ flags }) {
  const apiDir = resolvePackageDir('@puregram/api')

  // bot api version from the installed schema
  let schemaVersion = null
  if (apiDir) {
    const schemaPath = pickLatestSchema(join(apiDir, 'schema'))
    if (schemaPath) {
      const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
      const { major, minor, patch } = schema.version ?? {}
      if (major !== undefined) {
        schemaVersion = patch !== undefined ? `${major}.${minor}.${patch}` : `${major}.${minor}`
      }
    }
  }

  const pin = await readSkillPin()
  const drift = pin && schemaVersion ? !sameMinor(pin, schemaVersion) : false

  const packages = PUREGRAM_PACKAGES.map((name) => {
    const dir = resolvePackageDir(name)
    const pkg = readPackageJson(dir)
    return { name, version: pkg?.version ?? null, installed: Boolean(pkg) }
  })

  if (flags.has('--json')) {
    console.log(JSON.stringify({ skillBotApi: pin, schemaBotApi: schemaVersion, drift, packages }, null, 2))
    process.exit(drift ? 1 : 0)
  }

  printReport({ pin, schemaVersion, drift, packages })
  process.exit(drift ? 1 : 0)
}

/** two version strings agree on major.minor (patch is allowed to differ) */
function sameMinor (a, b) {
  const [a1, a2] = a.split('.')
  const [b1, b2] = b.split('.')
  return a1 === b1 && a2 === b2
}

function printReport ({ pin, schemaVersion, drift, packages }) {
  if (!packages.some(p => p.installed)) {
    console.error('no puregram packages found in node_modules. install puregram first:')
    console.error('  npm install puregram')
    process.exit(1)
  }

  console.log('bot api:')
  console.log(`  skill pinned to:   ${pin ?? '(unknown — no bot_api in SKILL.md)'}`)
  console.log(`  installed schema:  ${schemaVersion ?? '(no @puregram/api schema found)'}`)
  if (drift) {
    console.log()
    console.log(`  ⚠ drift: installed schema (${schemaVersion}) does not match the skill pin (${pin}).`)
    console.log('    the skill may describe a different bot api surface than the one you have installed.')
  } else if (pin && schemaVersion) {
    console.log('  ✓ in sync')
  }

  console.log()
  console.log('installed packages:')
  const width = Math.max(...packages.map(p => p.name.length))
  for (const p of packages) {
    const status = p.installed ? p.version : '(not installed)'
    console.log(`  ${p.name.padEnd(width)}  ${status}`)
  }
}

await main()
