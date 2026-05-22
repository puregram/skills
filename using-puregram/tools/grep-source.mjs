#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs, PUREGRAM_PACKAGES, resolvePackageDir } from './_utils.mjs'

const HELP = `
grep-source — search across installed puregram packages.

usage:
  node skills/using-puregram/tools/grep-source.mjs <pattern> [options]

options:
  --pkg <name>     limit search to a single package (e.g. puregram, @puregram/api)
                   may be repeated; if omitted, all resolvable puregram packages are searched
  --ext <ext>      limit to files with the given extension(s), comma separated
                   (default: ts,d.ts,js,mjs,cjs)
  --max <n>        cap total matches (default: 200)
  -i               case-insensitive
  -l               print matching filenames only
  --help           show this help

examples:
  node skills/using-puregram/tools/grep-source.mjs MessageShared
  node skills/using-puregram/tools/grep-source.mjs createPlugin --pkg puregram
  node skills/using-puregram/tools/grep-source.mjs callback_data -i --ext d.ts
`

function main () {
  const { flags, positionals } = parseArgs()
  if (flags.has('--help') || positionals.length === 0) {
    process.stdout.write(HELP.trimStart())
    process.exit(positionals.length === 0 ? 1 : 0)
  }

  // pull values for flags that take args from process.argv (parseArgs doesn't know them)
  const argv = process.argv.slice(2)
  const pkgs = []
  const exts = []
  let max = 200
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pkg' && argv[i + 1]) { pkgs.push(argv[i + 1]); i++ }
    else if (argv[i] === '--ext' && argv[i + 1]) { exts.push(...argv[i + 1].split(',')); i++ }
    else if (argv[i] === '--max' && argv[i + 1]) { max = Number(argv[i + 1]); i++ }
  }

  const pattern = positionals[0]
  const targets = (pkgs.length > 0 ? pkgs : PUREGRAM_PACKAGES)
    .map(p => ({ name: p, dir: resolvePackageDir(p) }))
    .filter(t => t.dir && existsSync(join(t.dir, 'lib')))

  if (targets.length === 0) {
    console.error('no puregram packages found in node_modules. install puregram first.')
    process.exit(1)
  }

  const grepArgs = ['-rn', '--color=never']
  if (flags.has('-i')) grepArgs.push('-i')
  if (flags.has('-l')) grepArgs.push('-l')

  const extList = exts.length > 0 ? exts : ['ts', 'd.ts', 'js', 'mjs', 'cjs']
  for (const e of extList) grepArgs.push('--include', `*.${e}`)

  grepArgs.push('-e', pattern, '--')
  for (const t of targets) grepArgs.push(join(t.dir, 'lib'))

  try {
    const out = execFileSync('grep', grepArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const lines = out.split('\n')
    let printed = 0
    for (const line of lines) {
      if (!line) continue
      console.log(line)
      printed++
      if (printed >= max) {
        console.error(`...truncated at ${max} matches (use --max to raise)`)
        break
      }
    }
    if (printed === 0) {
      console.error(`no matches for "${pattern}"`)
      process.exit(1)
    }
  } catch (err) {
    if (err.status === 1) {
      console.error(`no matches for "${pattern}"`)
      process.exit(1)
    }
    throw err
  }
}

main()
