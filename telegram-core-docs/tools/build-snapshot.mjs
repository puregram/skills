#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { backup, DatabaseSync } from 'node:sqlite'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'

import { crawlCatalogue } from './crawl.mjs'
import { checkCatalogue, catalogueChanges, renderDrift } from './check-catalogue.mjs'
import { fetchPublishedCatalogue } from './update.mjs'

async function digest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function buildSnapshot({ outputDir, previousPath = null, revision, minDocuments = 1000, crawlOptions = {} }) {
  await mkdir(outputDir, { recursive: true })
  const work = join(outputDir, '.building-' + randomUUID())
  await mkdir(work)
  const candidate = join(work, 'candidate.sqlite')
  try {
    const crawl = await crawlCatalogue({ ...crawlOptions, outputPath: candidate, previousPath })
    await writeFile(join(outputDir, 'crawl-report.json'), JSON.stringify(crawl, null, 2) + '\n')
    if (!crawl.complete) throw new Error('crawl incomplete; refusing to publish: ' + JSON.stringify(crawl.transientErrors))
    const quality = checkCatalogue(candidate, { minDocuments })
    const changes = catalogueChanges(candidate, previousPath)
    if (previousPath) {
      const previous = new DatabaseSync(previousPath, { readOnly: true })
      let previousCount
      try { previousCount = previous.prepare('SELECT COUNT(*) AS n FROM documents').get().n } finally { previous.close() }
      if (quality.documents < previousCount * 0.9) throw new Error('more than 10% of the previous catalogue disappeared; review before publishing')
    }
    const report = { ...crawl, ...quality, ...changes }
    await writeFile(join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    const markdown = renderDrift(report)
    await writeFile(join(outputDir, 'drift.md'), markdown)
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown)
    const database = join(work, 'catalogue.sqlite')
    const source = new DatabaseSync(candidate, { readOnly: true })
    try { await backup(source, database) } finally { source.close() }
    const final = new DatabaseSync(database)
    try { final.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE') } finally { final.close() }
    const databaseSha256 = await digest(database)
    const databaseBytes = (await stat(database)).size
    const compressed = join(work, 'catalogue.sqlite.gz')
    await pipeline(createReadStream(database), createGzip({ level: 9 }), createWriteStream(compressed))
    const sha256 = await digest(compressed)
    const asset = 'catalogue-' + sha256 + '.sqlite.gz'
    const compressedBytes = (await stat(compressed)).size
    if (compressedBytes > 32 * 1024 * 1024 || databaseBytes > 128 * 1024 * 1024) throw new Error('catalogue exceeds supported download size bounds')
    const manifest = {
      schemaVersion: 1, repository: 'puregram/skills', source: 'https://core.telegram.org/',
      generatedAt: new Date().toISOString(), revision, complete: true,
      documents: quality.documents, sections: quality.sections, asset, sha256, databaseSha256,
      compressedBytes, databaseBytes, reviewNeeded: changes.reviewNeeded
    }
    await rename(compressed, join(outputDir, asset))
    await writeFile(join(outputDir, 'catalogue.json'), JSON.stringify(manifest, null, 2) + '\n')
    return { manifest, report }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

async function main() {
  const args = process.argv.slice(2)
  const opts = { outputDir: '.catalogue-release', minDocuments: 1000 }
  const crawlOptions = {}
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--output') opts.outputDir = args[++index]
    else if (arg === '--previous') opts.previousPath = args[++index]
    else if (arg === '--revision') opts.revision = args[++index]
    else if (arg === '--min-documents') opts.minDocuments = Number(args[++index])
    else if (arg === '--max-pages') crawlOptions.maxPages = Number(args[++index])
    else if (arg === '--help') {
      process.stdout.write('usage: build-snapshot.mjs [--output dir] [--previous sqlite] [--revision SHA] [--min-documents N] [--max-pages N]\nBuilds a complete, validated direct crawl. Bounded --max-pages runs never publish a manifest.\n')
      return
    } else throw new Error('unknown option: ' + arg)
  }
  opts.outputDir = resolve(opts.outputDir)
  if (!opts.revision) opts.revision = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (!/^[a-f0-9]{40}$/.test(opts.revision)) throw new Error('revision must be a full Git commit SHA')
  if (!Number.isInteger(opts.minDocuments) || opts.minDocuments < 1) throw new Error('minimum document coverage must be a positive integer')
  const previousCache = join(opts.outputDir, '.previous')
  try {
    if (!opts.previousPath) {
      try {
        const prior = await fetchPublishedCatalogue({ cacheDir: previousCache })
        opts.previousPath = prior.databasePath
      } catch (error) {
        if (!error.missing) throw error
        process.stderr.write('No published catalogue yet; creating the first baseline directly from Telegram.\n')
      }
    }
    const result = await buildSnapshot({ ...opts, crawlOptions })
    console.log(JSON.stringify(result.manifest, null, 2))
    if (result.report.reviewNeeded.length) process.stdout.write('::warning title=Skill guidance review needed::Changed Telegram documentation may affect ' + result.report.reviewNeeded.join(', ') + '\n')
  } finally {
    await rm(previousCache, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write('error: ' + error.message + '\n')
    process.exitCode = 1
  })
}
