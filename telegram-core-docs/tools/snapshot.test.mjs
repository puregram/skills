import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'

import { Catalogue } from './catalogue.mjs'
import { buildSnapshot } from './build-snapshot.mjs'
import { checkCatalogue, catalogueChanges } from './check-catalogue.mjs'

const ORIGIN = 'https://core.telegram.org'
const REVISION = 'a'.repeat(40)
const pages = {
  '/': '# Telegram documentation\n\n[API](/bots/api.md)\n[Types](/bots/api/types.md)\n[Rich](/bots/api/rich-messages.md)\n[Changelog](/bots/api-changelog.md)\n',
  '/bots/api.md': '# Telegram Bot API\n\n### Available methods\n\n- [sendMessage](/bots/api/methods/sendmessage.md): send text.\n',
  '/bots/api/types.md': '# Bot API types\n\n## Available types\n\n- [User](/bots/api/types/user.md): a user.\n',
  '/bots/api/rich-messages.md': '# Rich messages\n\n## Methods\n\nNo rich methods in this fixture.\n',
  '/bots/api-changelog.md': '# Bot API changelog\n\n#### August 24, 2026\n\n**Bot API 10.3**\n',
  '/bots/api/methods/sendmessage.md': '# sendMessage\n\nReturns a [User](/bots/api/types/user.md).\n\n|Parameter|Type|Required|Description|\n|-----------|\n|chat_id|Integer|Yes|Target chat.|\n|text|String|Optional|Text.|\n',
  '/bots/api/types/user.md': '# User\n\nA user.\n\n|Field|Type|Description|\n|-----------|\n|id|Integer|Identifier.|\n|is_premium|True|*Optional*. Premium status.|\n'
}
const sha256 = body => createHash('sha256').update(body).digest('hex')

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'telegram-snapshot-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

function catalogue(path, entries) {
  const db = new Catalogue(path)
  try {
    for (const [url, body] of Object.entries(entries)) db.put({
      url: ORIGIN + url, body, checkedAt: '2026-01-01T00:00:00.000Z',
      fetchedAt: '2026-01-01T00:00:00.000Z', source: 'live'
    })
  } finally { db.close() }
}

function fetchPages(entries, failing = null) {
  return async input => {
    const url = new URL(input)
    assert.equal(url.origin, ORIGIN)
    if (url.pathname === failing) return new Response('temporarily unavailable', { status: 503 })
    if (!(url.pathname in entries)) return new Response('not found', { status: 404 })
    return new Response(entries[url.pathname], { headers: { 'content-type': 'text/markdown' } })
  }
}

test('published gzip is a standalone validated SQLite snapshot with matching hashes and counts', async t => {
  const directory = await temporary(t)
  const result = await buildSnapshot({
    outputDir: directory, revision: REVISION, minDocuments: 7,
    crawlOptions: { seeds: [ORIGIN + '/'], fetcher: fetchPages(pages) }
  })
  const manifest = JSON.parse(await readFile(join(directory, 'catalogue.json'), 'utf8'))
  const compressed = await readFile(join(directory, manifest.asset))
  const database = gunzipSync(compressed)
  assert.equal(manifest.complete, true)
  assert.equal(manifest.documents, 7)
  assert.equal(result.report.botApiEntriesChecked, 2)
  assert.equal(manifest.sha256, sha256(compressed))
  assert.equal(manifest.databaseSha256, sha256(database))
  assert.equal(manifest.compressedBytes, compressed.length)
  assert.equal(manifest.databaseBytes, database.length)
  const path = join(directory, 'downloaded.sqlite')
  await writeFile(path, database)
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete')
    assert.equal(db.prepare('SELECT body FROM documents WHERE url=?').get(ORIGIN + '/bots/api/types/user.md').body, pages['/bots/api/types/user.md'])
  } finally { db.close() }
})

test('incomplete crawls and bounded smoke crawls cannot produce a release manifest', async t => {
  const directory = await temporary(t)
  await assert.rejects(buildSnapshot({
    outputDir: directory, revision: REVISION, minDocuments: 1,
    crawlOptions: { seeds: [ORIGIN + '/'], fetcher: fetchPages(pages, '/bots/api/types/user.md') }
  }), /crawl incomplete/)
  assert.equal(existsSync(join(directory, 'catalogue.json')), false)
  await assert.rejects(buildSnapshot({
    outputDir: directory, revision: REVISION, minDocuments: 1,
    crawlOptions: { seeds: [ORIGIN + '/'], fetcher: fetchPages(pages), maxPages: 2 }
  }), /crawl incomplete/)
  assert.equal(existsSync(join(directory, 'catalogue.json')), false)
})

test('coverage loss is blocked before replacing an existing snapshot', async t => {
  const directory = await temporary(t)
  const previousPath = join(directory, 'previous.sqlite')
  const previous = { '/': '# Telegram documentation\n' }
  for (let index = 0; index < 10; index++) previous['/api/old-' + index + '.md'] = '# Old page ' + index + '\n'
  catalogue(previousPath, previous)
  await assert.rejects(buildSnapshot({
    outputDir: join(directory, 'release'), previousPath, revision: REVISION, minDocuments: 1,
    crawlOptions: { seeds: [ORIGIN + '/'], fetcher: fetchPages({ '/': previous['/'] }) }
  }), /more than 10%/)
  const db = new Catalogue(previousPath)
  try { assert.equal(db.stats().documents, 11) } finally { db.close() }
  assert.equal(existsSync(join(directory, 'release/catalogue.json')), false)
})

test('integrity checks reject body corruption and unrecognized upstream required markers', async t => {
  const directory = await temporary(t)
  const path = join(directory, 'catalogue.sqlite')
  catalogue(path, pages)
  const db = new DatabaseSync(path)
  db.prepare('UPDATE documents SET hash=? WHERE url=?').run('0'.repeat(64), ORIGIN + '/bots/api.md')
  db.close()
  assert.throws(() => checkCatalogue(path, { minDocuments: 1 }), /hash/)
  const changed = new Catalogue(path)
  try {
    changed.put({ url: ORIGIN + '/bots/api.md', body: pages['/bots/api.md'], checkedAt: '2100-01-01T00:00:00.000Z', source: 'live' })
    changed.put({ url: ORIGIN + '/bots/api/methods/sendmessage.md', body: pages['/bots/api/methods/sendmessage.md'].replace('|Yes|', '|Maybe|'), checkedAt: '2100-01-01T00:00:00.000Z', source: 'live' })
  } finally { changed.close() }
  assert.throws(() => checkCatalogue(path, { minDocuments: 1 }), /required marker/)
})

test('content drift reports changed, new and removed URLs and relevant skill guidance only', async t => {
  const directory = await temporary(t)
  const previous = join(directory, 'previous.sqlite')
  const current = join(directory, 'current.sqlite')
  catalogue(previous, { '/api/auth.md': '# Authentication\nOld.\n', '/api/removed.md': '# Removed\n' })
  catalogue(current, { '/api/auth.md': '# Authentication\nNew.\n', '/api/new.md': '# New\n' })
  const root = join(directory, 'skills')
  for (const [name, body] of Object.entries({
    'telegram-core-docs': '# Core docs\n',
    'auth-guide': 'Read https://core.telegram.org/api/auth.md',
    'unrelated-guide': 'Read https://core.telegram.org/bots/api.md'
  })) {
    await mkdir(join(root, name), { recursive: true })
    await writeFile(join(root, name, 'SKILL.md'), body)
  }
  const report = catalogueChanges(current, previous, { root })
  assert.deepEqual(report.added, [ORIGIN + '/api/new.md'])
  assert.deepEqual(report.changed, [ORIGIN + '/api/auth.md'])
  assert.deepEqual(report.removed, [ORIGIN + '/api/removed.md'])
  assert.deepEqual(report.reviewNeeded.sort(), ['auth-guide/SKILL.md', 'telegram-core-docs/SKILL.md'])
})
