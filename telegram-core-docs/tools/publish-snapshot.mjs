#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const REPOSITORY = 'puregram/skills'
const TAG = 'docs-catalogue'

async function gh(...args) {
  const result = await execute('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  return result.stdout
}

async function main() {
  const directory = resolve(process.argv[2] || '.catalogue-release')
  const manifestPath = join(directory, 'catalogue.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.repository !== REPOSITORY || manifest.complete !== true ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) || manifest.asset !== 'catalogue-' + manifest.sha256 + '.sqlite.gz') {
    throw new Error('invalid publication manifest')
  }
  const assetPath = join(directory, manifest.asset)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(assetPath)) hash.update(chunk)
  if (hash.digest('hex') !== manifest.sha256 || (await stat(assetPath)).size !== manifest.compressedBytes) throw new Error('publication asset no longer matches its manifest')
  let release
  try {
    release = JSON.parse(await gh('api', 'repos/' + REPOSITORY + '/releases/tags/' + TAG))
  } catch (error) {
    if (!/HTTP 404/.test(error.stderr || '')) throw error
    await gh('release', 'create', TAG, '--repo', REPOSITORY, '--target', manifest.revision,
      '--title', 'Official Telegram documentation catalogue', '--notes-file', join(directory, 'drift.md'), '--prerelease', '--latest=false')
    release = JSON.parse(await gh('api', 'repos/' + REPOSITORY + '/releases/tags/' + TAG))
  }
  if (!release.assets.some(asset => asset.name === manifest.asset)) {
    await gh('release', 'upload', TAG, assetPath, '--repo', REPOSITORY)
  }
  await gh('release', 'upload', TAG, manifestPath, '--repo', REPOSITORY, '--clobber')
  await gh('release', 'edit', TAG, '--repo', REPOSITORY, '--notes-file', join(directory, 'drift.md'))
  console.log('Published https://github.com/' + REPOSITORY + '/releases/download/' + TAG + '/catalogue.json')
}

main().catch(error => {
  process.stderr.write('error: ' + (error.stderr || error.message) + '\n')
  process.exitCode = 1
})
