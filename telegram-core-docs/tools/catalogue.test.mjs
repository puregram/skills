import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { Catalogue, ORIGIN, canonicalUrl, pageUrl, parseMarkdown, provenance } from './catalogue.mjs'

const script = fileURLToPath(new URL('./core-docs.mjs', import.meta.url))
const hash = text => createHash('sha256').update(text).digest('hex')
const old = '2000-01-01T00:00:00.000Z'
const guideUrl = ORIGIN + '/bots/guide.md'
const guide = '# Guide with `inline_name`\n\nIntro.\n\n## Parent\n\nBusiness bots need can_reply rights.\n\n### Child\n\nChild details.\n\n~~~md\n## Not a heading\n[not a link](/fake.md)\n~~~\n\n## Next\n\n[API](/bots/api.md#available-methods)\n[authentication][auth]\n\n[auth]: /api/auth.md\n\n<a href="/gateway.md">Gateway</a>\n[external](https://evil.test/page.md)\n![image](/image.md)\n'

function fixture(t, options) {
  const dir = mkdtempSync(join(tmpdir(), 'core-docs-test-'))
  const path = join(dir, 'catalogue.sqlite')
  const catalogue = new Catalogue(path, options)
  t.after(() => { catalogue.close(); rmSync(dir, { recursive: true, force: true }) })
  return {
    dir, path, catalogue,
    run(...args) {
      const result = spawnSync(process.execPath, [script, '--db', path, ...args, '--json'], { encoding: 'utf8' })
      return { ...result, data: result.stdout ? JSON.parse(result.stdout) : null }
    }
  }
}

function document(url, body, checkedAt = old) {
  return { url, body, checkedAt, fetchedAt: checkedAt, source: 'live', etag: 'v1' }
}

function tracker(path, rows, checkedAt = old) {
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT); CREATE TABLE pages (url TEXT PRIMARY KEY,body TEXT,hash TEXT,etag TEXT,modified TEXT,error TEXT,removed INTEGER)')
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('last_scan', checkedAt)
  const insert = db.prepare('INSERT INTO pages VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (const row of rows) insert.run(row.url, row.body, row.hash ?? hash(row.body), 'v1', null, row.error ?? null, row.removed ?? 0)
  db.close()
}

test('heading ranges include descendants, exclude fenced headings and retain literal identifiers', t => {
  const { catalogue } = fixture(t)
  catalogue.put(document(guideUrl, guide))
  const parsed = parseMarkdown(guide, guideUrl)
  assert.equal(parsed.title, 'Guide with inline_name')
  assert.deepEqual(parsed.sections.map(section => section.heading), ['Guide with inline_name', 'Parent', 'Child', 'Next'])
  const parent = catalogue.section(catalogue.get(guideUrl), 'Parent')
  assert.ok(parent.text.includes('### Child'))
  assert.ok(parent.text.includes('## Not a heading'))
  assert.equal(parent.text.includes('## Next'), false)
  assert.deepEqual(parsed.links.map(link => link.url).sort(), [ORIGIN + '/bots/api.md#available-methods', ORIGIN + '/api/auth.md', ORIGIN + '/gateway.md'].sort())
})

test('full-text search filters areas, safely handles punctuation, paginates and removes obsolete index terms', t => {
  const { catalogue } = fixture(t)
  catalogue.put(document(guideUrl, guide))
  catalogue.put(document(ORIGIN + '/api/passkeys.md', '# Passkeys\n\nBusiness bots can use passkeys.\n'))
  const bots = catalogue.search('business bots', { area: 'bots' })
  assert.deepEqual(bots.map(result => result.pageUrl), [guideUrl])
  assert.equal(catalogue.search('can_reply')[0].heading, 'Parent')
  const results = catalogue.search('business bots')
  assert.deepEqual(catalogue.search('business bots', { limit: 1, offset: 1 }), results.slice(1, 2))
  assert.deepEqual(catalogue.search('unfindable" OR "injection'), [])
  catalogue.put(document(guideUrl, '# Revised\n\nGuest queries only.\n', new Date().toISOString()))
  assert.deepEqual(catalogue.search('can_reply'), [])
  assert.equal(catalogue.search('guest queries')[0].pageUrl, guideUrl)
  assert.equal(catalogue.search('guest queries')[0].provenance.hash, hash('# Revised\n\nGuest queries only.\n'))
})

test('offline reads never fetch, and conditional verification preserves body fetch time and index', async t => {
  let requests = 0
  const { catalogue } = fixture(t, { fetcher: async (url, init) => {
    requests++
    assert.equal(url, guideUrl)
    assert.equal(init.headers['if-none-match'], 'v1')
    return new Response(null, { status: 304 })
  } })
  catalogue.put(document(guideUrl, guide))
  assert.equal((await catalogue.load(guideUrl, { offline: true })).body, guide)
  await assert.rejects(catalogue.load(ORIGIN + '/missing.md', { offline: true }), Error)
  await assert.rejects(catalogue.load(guideUrl, { offline: true, refresh: true }), Error)
  assert.equal(requests, 0)
  const refreshed = await catalogue.load(guideUrl, { refresh: true })
  assert.equal(requests, 1)
  assert.equal(refreshed.fetchedAt, old)
  assert.equal(refreshed.hash, hash(guide))
  assert.equal(provenance(refreshed).stale, false)
  assert.equal(catalogue.search('can_reply')[0].pageUrl, guideUrl)
})

test('failed revalidation retains the old body and reports stale evidence without changing its check time', async t => {
  const { catalogue } = fixture(t, { fetcher: async () => new Response(null, { status: 503 }) })
  catalogue.put(document(guideUrl, guide))
  const result = await catalogue.load(guideUrl, { refresh: true })
  assert.equal(result.body, guide)
  assert.equal(result.checkedAt, old)
  assert.equal(result.hash, hash(guide))
  assert.equal(provenance(result).stale, true)
  assert.match(result.warning, /503/)
  assert.equal(catalogue.get(guideUrl).checkedAt, old)
})

test('requests and redirects cannot leave the official HTTPS Markdown scope', async t => {
  const calls = []
  const { catalogue } = fixture(t, { fetcher: async url => {
    calls.push(url)
    return new Response(null, { status: 302, headers: { location: 'https://evil.test/stolen.md' } })
  } })
  await assert.rejects(catalogue.load(guideUrl), Error)
  await assert.rejects(catalogue.load('http://core.telegram.org/bots/api.md'), Error)
  await assert.rejects(catalogue.load('https://core.telegram.org.evil.test/bots/api.md'), Error)
  assert.deepEqual(calls, [guideUrl])
  assert.equal(canonicalUrl(guideUrl + '#parent'), guideUrl)
  assert.equal(pageUrl('/method/messages.sendMessage'), ORIGIN + '/method/messages.sendMessage.md')
})

test('tracker import is read-only, excludes unhealthy pages, preserves unknown timestamps and keeps newer live copies', t => {
  const { catalogue, dir } = fixture(t)
  const source = join(dir, 'tracker.sqlite')
  const now = new Date().toISOString()
  const newer = '# Newer\n\nCurrent live body.\n'
  catalogue.put(document(guideUrl, newer, now))
  tracker(source, [
    { url: guideUrl, body: guide },
    { url: ORIGIN + '/api/auth.md', body: '# Authentication\n\nLogin flow.\n' },
    { url: ORIGIN + '/removed.md', body: '# Removed\n', removed: 1 },
    { url: ORIGIN + '/failed.md', body: '# Failed\n', error: 'HTTP 500' }
  ])
  const before = hash(readFileSync(source))
  const result = catalogue.importTracker(source)
  assert.equal(result.imported, 1)
  assert.equal(result.keptNewer, 1)
  assert.equal(hash(readFileSync(source)), before)
  assert.equal(catalogue.get(guideUrl).body, newer)
  const auth = catalogue.get(ORIGIN + '/api/auth.md')
  assert.equal(auth.fetchedAt, null)
  assert.equal(auth.checkedAt, old)
  assert.equal(auth.source, 'tracker snapshot')
  assert.equal(catalogue.get(ORIGIN + '/removed.md'), null)
  assert.equal(catalogue.get(ORIGIN + '/failed.md'), null)
})

test('an invalid snapshot rolls back imported pages and search rows together', t => {
  const { catalogue, dir } = fixture(t)
  const source = join(dir, 'corrupt.sqlite')
  tracker(source, [{ url: guideUrl, body: guide }, { url: ORIGIN + '/wrong.md', body: '# Wrong\n', hash: 'invalid' }])
  assert.throws(() => catalogue.importTracker(source), Error)
  assert.equal(catalogue.get(guideUrl), null)
  assert.deepEqual(catalogue.search('business bots'), [])
})

test('CLI section reads preserve source line ranges, JSON provenance and related-link targets', t => {
  const f = fixture(t)
  f.catalogue.put(document(guideUrl, guide))
  const section = f.run('read', guideUrl + '#parent', '--offline', '--max-lines', '3')
  assert.equal(section.status, 0, section.stderr)
  assert.equal(section.data.startLine, 5)
  assert.equal(section.data.endLine, 7)
  assert.equal(section.data.truncated, true)
  assert.equal(section.data.text, guide.split('\n').slice(4, 7).join('\n'))
  assert.equal(section.data.provenance.hash, hash(guide))
  const headings = f.run('sections', guideUrl, '--offline', '--limit', '2', '--offset', '1')
  assert.equal(headings.status, 0, headings.stderr)
  assert.deepEqual(headings.data.sections.map(section => section.anchor), ['parent', 'child'])
  const links = f.run('links', guideUrl, '--offline')
  assert.equal(links.status, 0, links.stderr)
  assert.equal(links.data.links[0].url, ORIGIN + '/bots/api.md#available-methods')
  const missing = f.run('read', '/uncached.md', '--offline')
  assert.notEqual(missing.status, 0)
})

test('exact guide and symbol headings outrank incidental mentions in short reference pages', t => {
  const { catalogue } = fixture(t)
  catalogue.put(document(ORIGIN + '/api/passkeys.md', '# Passkeys\n\nUse passkeys for user authorization.\n'))
  catalogue.put(document(ORIGIN + '/constructor/account.passkeys.md', '# account.passkeys\n\nPasskeys.\n'))
  assert.equal(catalogue.search('passkeys')[0].pageUrl, ORIGIN + '/api/passkeys.md')
  catalogue.put(document(ORIGIN + '/bots/api/types/businessbotrights.md', '# BusinessBotRights\n\nThis object represents the rights of a business bot.\n'))
  catalogue.put(document(ORIGIN + '/bots/api/methods/transfergift.md', '# transferGift\n\nBusiness bot rights.\n'))
  assert.equal(catalogue.search('business bot rights', { area: 'bots' })[0].pageUrl, ORIGIN + '/bots/api/types/businessbotrights.md')
})
