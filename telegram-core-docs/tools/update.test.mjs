import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { Catalogue, databasePath } from './catalogue.mjs'
import { MANIFEST_URL, MAX_COMPRESSED_BYTES, MAX_DATABASE_BYTES, fetchPublishedCatalogue, synchronizeCatalogue, validateManifest } from './update.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const generatedAt = '2026-01-01T00:00:00.000Z'
const old = '2025-01-01T00:00:00.000Z'
const newer = '2027-01-01T00:00:00.000Z'
const url = 'https://core.telegram.org/bots/guide.md'
const body = '# Guide\n\nPublished snapshot.\n\n## Details\n\nRelease catalogue details.\n'
const script = fileURLToPath(new URL('./core-docs.mjs', import.meta.url))

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'docs-update-test-'))
  const cacheDir = join(root, 'cache')
  const variables = ['TG_CORE_DOCS_DB', 'TG_CORE_DOCS_AUTO_UPDATE', 'XDG_CACHE_HOME']
  const previous = Object.fromEntries(variables.map(key => [key, process.env[key]]))
  for (const key of variables) delete process.env[key]
  t.after(() => {
    for (const key of variables) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    rmSync(root, { recursive: true, force: true })
  })
  let serial = 0
  function snapshot({ time = generatedAt, text = body, documents = [{ url, body: text, checkedAt: old, fetchedAt: old, source: 'live' }], mutate } = {}) {
    const path = join(root, `snapshot-${serial++}.sqlite`)
    const catalogue = new Catalogue(path)
    for (const document of documents) catalogue.put(document)
    if (mutate) mutate(catalogue.db)
    const stats = catalogue.stats()
    catalogue.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE')
    catalogue.close()
    return pack(readFileSync(path), { generatedAt: time, documents: stats.documents, sections: stats.sections })
  }
  function pack(bytes, counts) {
    const compressed = gzipSync(bytes)
    const manifest = { schemaVersion: 1, repository: 'puregram/skills', source: 'https://core.telegram.org/',
      generatedAt, revision: 'a'.repeat(40), complete: true, documents: 1, sections: 2,
      asset: `catalogue-${hash(compressed)}.sqlite.gz`, sha256: hash(compressed), databaseSha256: hash(bytes),
      compressedBytes: compressed.length, databaseBytes: bytes.length, reviewNeeded: ['telegram-bot-api/SKILL.md'], ...counts }
    return { bytes, compressed, manifest }
  }
  function remote(snapshot) {
    const calls = []
    const fetcher = async (target, init) => {
      calls.push(target)
      assert.equal(init.redirect, 'manual')
      assert.ok(init.signal instanceof AbortSignal)
      if (target === MANIFEST_URL) return Response.json(snapshot.manifest)
      assert.equal(target, MANIFEST_URL.replace('catalogue.json', snapshot.manifest.asset))
      return new Response(snapshot.compressed)
    }
    return { fetcher, calls }
  }
  return { root, cacheDir, snapshot, pack, remote,
    sync(options = {}) { return synchronizeCatalogue({ cacheDir, ...options }) } }
}

function readDocument(path, target = url) {
  const db = new DatabaseSync(path, { readOnly: true })
  try { return db.prepare('SELECT * FROM documents WHERE url=?').get(target) } finally { db.close() }
}

function seed(path, documents = [{ url, body: '# Legacy\n\nLast good local copy.\n', checkedAt: old, source: 'live' }]) {
  const catalogue = new Catalogue(path)
  for (const document of documents) catalogue.put(document)
  catalogue.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE')
  catalogue.close()
}

test('cold boot validates a release and atomically selects a generation', async t => {
  const f = fixture(t)
  const snapshot = f.snapshot()
  const remote = f.remote(snapshot)
  const result = await f.sync(remote)
  assert.equal(result.status, 'updated', result.error)
  assert.equal(remote.calls.length, 2)
  assert.equal(readDocument(result.databasePath).body, body)
  const pointer = JSON.parse(readFileSync(join(f.cacheDir, 'current.json'), 'utf8'))
  assert.equal(pointer.schemaVersion, 1)
  assert.deepEqual(pointer.manifest, snapshot.manifest)
  assert.equal(pointer.mergedDocuments, 0)
  assert.equal(result.databasePath, join(f.cacheDir, pointer.database))
  assert.equal(databasePath(f.cacheDir), result.databasePath)
  assert.equal(existsSync(join(f.cacheDir, 'catalogue.sqlite')), false)
  assert.equal(readdirSync(f.cacheDir).some(name => name.endsWith('.tmp') || name.startsWith('.download-')), false)
  const cached = await f.sync({ fetcher: () => assert.fail('hourly cache must avoid network') })
  assert.equal(cached.status, 'cached')
  assert.deepEqual(cached.manifest, snapshot.manifest)
  assert.equal((await f.sync({ force: true, ...remote })).status, 'current')
  assert.equal(remote.calls.length, 3)
})

test('generation promotion leaves open WAL readers and their original file intact', async t => {
  const f = fixture(t)
  const legacy = join(f.cacheDir, 'catalogue.sqlite')
  const reader = new Catalogue(legacy)
  t.after(() => reader.close())
  reader.put({ url, body: '# Legacy\n\nOpen reader.\n', checkedAt: old, source: 'live' })
  const result = await f.sync(f.remote(f.snapshot()))
  assert.equal(result.status, 'updated', result.error)
  assert.notEqual(result.databasePath, legacy)
  assert.equal(reader.get(url).body, '# Legacy\n\nOpen reader.\n')
  assert.equal(readDocument(result.databasePath).body, body)
  assert.ok(existsSync(legacy))
})

test('invalid or escaping pointers fall back to the legacy database', async t => {
  const f = fixture(t)
  const result = await f.sync(f.remote(f.snapshot()))
  const pointerPath = join(f.cacheDir, 'current.json')
  const pointer = JSON.parse(readFileSync(pointerPath, 'utf8'))
  const legacy = join(f.cacheDir, 'catalogue.sqlite')
  for (const invalid of [null, { ...pointer, schemaVersion: 2 }, { ...pointer, database: '../outside.sqlite' },
    { ...pointer, manifest: { ...pointer.manifest, repository: 'other/skills' } }]) {
    writeFileSync(pointerPath, JSON.stringify(invalid))
    assert.equal(databasePath(f.cacheDir), legacy)
  }
  writeFileSync(pointerPath, JSON.stringify(pointer))
  const outside = join(f.root, 'outside.sqlite')
  writeFileSync(outside, readFileSync(result.databasePath))
  rmSync(result.databasePath)
  symlinkSync(outside, result.databasePath)
  assert.equal(databasePath(f.cacheDir), legacy)
})

for (const [name, damage] of [
  ['compressed hash', snapshot => { snapshot.compressed = Buffer.from(snapshot.compressed); snapshot.compressed[20] ^= 1 }],
  ['compressed size', snapshot => { snapshot.manifest.compressedBytes++ }],
  ['database hash', snapshot => { snapshot.manifest.databaseSha256 = '0'.repeat(64) }],
  ['database size', snapshot => { snapshot.manifest.databaseBytes++ }],
  ['document count', snapshot => { snapshot.manifest.documents++ }],
  ['section count', snapshot => { snapshot.manifest.sections++ }],
  ['compressed bound', snapshot => { snapshot.manifest.compressedBytes = MAX_COMPRESSED_BYTES + 1 }],
  ['database bound', snapshot => { snapshot.manifest.databaseBytes = MAX_DATABASE_BYTES + 1 }],
  ['asset escape', snapshot => { snapshot.manifest.asset = 'https://evil.test/catalogue.sqlite.gz' }],
  ['repository escape', snapshot => { snapshot.manifest.repository = 'other/skills' }],
  ['unofficial source', snapshot => { snapshot.manifest.source = 'https://evil.test/' }],
  ['incomplete snapshot', snapshot => { snapshot.manifest.complete = false }]
]) {
  test(`${name} failure preserves the legacy fallback and records failed attempts`, async t => {
    const f = fixture(t)
    const legacy = join(f.cacheDir, 'catalogue.sqlite')
    seed(legacy)
    const before = readFileSync(legacy)
    const snapshot = f.snapshot()
    damage(snapshot)
    const result = await f.sync(f.remote(snapshot))
    assert.equal(result.status, 'failed')
    assert.equal(result.databasePath, legacy)
    assert.deepEqual(readFileSync(legacy), before)
    assert.equal(existsSync(join(f.cacheDir, 'current.json')), false)
    assert.equal(JSON.parse(readFileSync(join(f.cacheDir, 'update.json'), 'utf8')).status, 'failed')
    const cached = await f.sync({ fetcher: () => assert.fail('failed checks must be cached') })
    assert.equal(cached.status, 'cached')
    assert.equal(cached.error, result.error)
    assert.equal(readdirSync(f.cacheDir).some(name => name.startsWith('.download-')), false)
  })
}

test('corrupt gzip and invalid SQLite never promote even with matching asset hashes', async t => {
  const f = fixture(t)
  for (const compressed of [Buffer.from('not gzip'), gzipSync(Buffer.from('not sqlite'))]) {
    const snapshot = f.snapshot()
    snapshot.compressed = compressed
    Object.assign(snapshot.manifest, { sha256: hash(compressed), asset: `catalogue-${hash(compressed)}.sqlite.gz`, compressedBytes: compressed.length })
    const result = await f.sync({ force: true, ...f.remote(snapshot) })
    assert.equal(result.status, 'failed')
    assert.equal(existsSync(join(f.cacheDir, 'current.json')), false)
  }
})

test('SQLite schema, integrity, official document URLs and index contents are validated', async t => {
  const f = fixture(t)
  const invalid = [
    f.snapshot({ mutate: db => db.exec('CREATE TABLE unexpected (value TEXT)') }),
    f.snapshot({ mutate: db => db.exec("UPDATE documents SET body='# Tampered'") }),
    f.snapshot({ mutate: db => db.exec("UPDATE section_search SET body='wrong index'") }),
    f.snapshot({ mutate: db => db.exec("UPDATE documents SET source='unofficial'") }),
    f.snapshot({ mutate: db => db.exec("PRAGMA foreign_keys=OFF; UPDATE documents SET url='https://evil.test/guide.md'; UPDATE sections SET url='https://evil.test/guide.md'; UPDATE section_search SET url='https://evil.test/guide.md'") })
  ]
  const corrupt = Buffer.from(f.snapshot().bytes)
  corrupt.fill(0xff, 100, 200)
  invalid.push(f.pack(corrupt))
  for (const snapshot of invalid) {
    const result = await f.sync({ force: true, ...f.remote(snapshot) })
    assert.equal(result.status, 'failed')
    assert.equal(existsSync(join(f.cacheDir, 'current.json')), false)
  }
})

test('failed fetches keep an installed generation and force bypasses failure throttling', async t => {
  const f = fixture(t)
  const installed = await f.sync(f.remote(f.snapshot()))
  const pointer = readFileSync(join(f.cacheDir, 'current.json'))
  const failed = await f.sync({ force: true, fetcher: async () => { throw new Error('network unavailable') } })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.databasePath, installed.databasePath)
  assert.deepEqual(readFileSync(join(f.cacheDir, 'current.json')), pointer)
  assert.equal(readDocument(failed.databasePath).body, body)
  const cached = await f.sync({ fetcher: () => assert.fail('recent failed attempt must suppress requests') })
  assert.equal(cached.status, 'cached')
  assert.match(cached.error, /network unavailable/)
  const forced = await f.sync({ force: true, ...f.remote(f.snapshot({ time: newer })) })
  assert.equal(forced.status, 'current', forced.error)
  assert.equal(forced.manifest.generatedAt, newer)
})

test('expired successful and failed check metadata permits a new check', async t => {
  const f = fixture(t)
  const remote = f.remote(f.snapshot())
  await f.sync(remote)
  for (const status of ['updated', 'failed']) {
    writeFileSync(join(f.cacheDir, 'update.json'), JSON.stringify({ schemaVersion: 1, attemptedAt: old, status }))
    const result = await f.sync(remote)
    assert.equal(result.status, 'current', result.error)
  }
  assert.equal(remote.calls.length, 4)
})

test('older and same-time conflicting manifests cannot roll back the current generation', async t => {
  const f = fixture(t)
  const installed = await f.sync(f.remote(f.snapshot({ time: newer, text: '# New release\n\nNewest snapshot.\n' })))
  const pointer = readFileSync(join(f.cacheDir, 'current.json'))
  for (const snapshot of [f.snapshot(), f.snapshot({ time: newer })]) {
    const remote = f.remote(snapshot)
    const result = await f.sync({ force: true, ...remote })
    assert.equal(result.status, 'failed')
    assert.match(result.error, /older or conflicting/)
    assert.equal(result.databasePath, installed.databasePath)
    assert.equal(remote.calls.length, 1)
    assert.deepEqual(readFileSync(join(f.cacheDir, 'current.json')), pointer)
  }
})

test('offline is strictly network-free for cold, populated and forced synchronization', async t => {
  const f = fixture(t)
  const never = () => assert.fail('offline must never fetch')
  const cold = await f.sync({ offline: true, force: true, fetcher: never })
  assert.equal(cold.status, 'offline')
  assert.equal(existsSync(f.cacheDir), false)
  const installed = await f.sync(f.remote(f.snapshot()))
  const state = readFileSync(join(f.cacheDir, 'update.json'))
  const offline = await f.sync({ offline: true, force: true, fetcher: never })
  assert.equal(offline.databasePath, installed.databasePath)
  assert.deepEqual(readFileSync(join(f.cacheDir, 'update.json')), state)
})

test('explicit databases and environment overrides are user-managed, even with force', async t => {
  const f = fixture(t)
  const custom = join(f.root, 'custom.sqlite')
  seed(custom)
  const bytes = readFileSync(custom)
  const never = () => assert.fail('user-managed databases must never update')
  const explicit = await f.sync({ force: true, db: custom, fetcher: never })
  assert.equal(explicit.status, 'custom')
  assert.equal(explicit.databasePath, custom)
  process.env.TG_CORE_DOCS_DB = custom
  const environment = await f.sync({ force: true, fetcher: never })
  assert.equal(environment.status, 'custom')
  assert.equal(environment.databasePath, custom)
  assert.equal(databasePath(f.cacheDir), custom)
  assert.deepEqual(readFileSync(custom), bytes)
  assert.equal(existsSync(f.cacheDir), false)
})

test('automatic update opt-outs do not fetch; explicit force still checks', async t => {
  const f = fixture(t)
  const never = () => assert.fail('automatic updates disabled')
  assert.equal((await f.sync({ enabled: false, fetcher: never })).status, 'disabled')
  process.env.TG_CORE_DOCS_AUTO_UPDATE = '0'
  assert.equal((await f.sync({ fetcher: never })).status, 'disabled')
  assert.equal(existsSync(f.cacheDir), false)
  const result = await f.sync({ force: true, ...f.remote(f.snapshot()) })
  assert.equal(result.status, 'updated', result.error)
})

test('simultaneous updaters serialize through SQLite locks without corrupting the pointer', async t => {
  const f = fixture(t)
  const remote = f.remote(f.snapshot())
  let release
  let entered
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const first = f.sync({ fetcher: async (...args) => { entered(); await gate; return remote.fetcher(...args) } })
  await started
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => f.sync({ force: true, fetcher: () => assert.fail('locked updater must not fetch') })))
  assert.ok(concurrent.every(result => result.status === 'busy'))
  release()
  const result = await first
  assert.equal(result.status, 'updated', result.error)
  assert.equal(databasePath(f.cacheDir), result.databasePath)
  assert.equal(readDocument(result.databasePath).body, body)
  assert.equal((await f.sync({ force: true, ...remote })).status, 'current')
})

test('a separate process holding the updater lock prevents concurrent fetches', async t => {
  const f = fixture(t)
  await f.sync(f.remote(f.snapshot()))
  const lock = new DatabaseSync(join(f.cacheDir, 'update-lock.sqlite'))
  lock.exec('BEGIN IMMEDIATE')
  try {
    const module = new URL('./update.mjs', import.meta.url).href
    const code = `import { synchronizeCatalogue } from ${JSON.stringify(module)}; const result = await synchronizeCatalogue({ force: true, cacheDir: ${JSON.stringify(f.cacheDir)}, fetcher: () => { throw new Error('unexpected fetch') } }); console.log(JSON.stringify(result))`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).status, 'busy')
  } finally { lock.close() }
})

test('promotion transactionally preserves only newer local live documents, including absent URLs', async t => {
  const f = fixture(t)
  const absent = 'https://core.telegram.org/api/new-live.md'
  const snapshotOnly = 'https://core.telegram.org/api/tracker-only.md'
  const oldOnly = 'https://core.telegram.org/api/old-only.md'
  seed(join(f.cacheDir, 'catalogue.sqlite'), [
    { url, body: '# Local latest\n\nLocal live revision.\n', checkedAt: newer, fetchedAt: newer, source: 'live' },
    { url: absent, body: '# Newly discovered\n\nFresh local discovery.\n', checkedAt: newer, source: 'live' },
    { url: snapshotOnly, body: '# Imported\n\nNot a live document.\n', checkedAt: newer, source: 'tracker snapshot' },
    { url: oldOnly, body: '# Old local\n\nPredates the release.\n', checkedAt: old, source: 'live' }
  ])
  const result = await f.sync(f.remote(f.snapshot()))
  assert.equal(result.status, 'updated', result.error)
  assert.equal(result.mergedDocuments, 2)
  assert.match(readDocument(result.databasePath).body, /Local live revision/)
  assert.ok(readDocument(result.databasePath, absent))
  assert.equal(readDocument(result.databasePath, snapshotOnly), undefined)
  assert.equal(readDocument(result.databasePath, oldOnly), undefined)
  const catalogue = new Catalogue(result.databasePath)
  try {
    assert.equal(catalogue.search('Fresh local discovery')[0].pageUrl, absent)
    assert.equal(catalogue.search('Published snapshot').length, 0)
    assert.deepEqual(catalogue.db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { catalogue.close() }
})

test('GitHub CDN redirects are bounded and cannot escape to arbitrary hosts or repositories', async t => {
  const f = fixture(t)
  const snapshot = f.snapshot()
  const cdn = 'https://release-assets.githubusercontent.com/github-production-release-asset/123/catalogue?token=signed'
  const calls = []
  const result = await f.sync({ fetcher: async target => {
    calls.push(target)
    if (target === MANIFEST_URL) return new Response(null, { status: 302, headers: { location: cdn } })
    if (target === cdn) return Response.json(snapshot.manifest)
    return new Response(snapshot.compressed)
  } })
  assert.equal(result.status, 'updated', result.error)
  assert.ok(calls.includes(cdn))
  for (const location of ['https://evil.test/file', 'http://release-assets.githubusercontent.com/file',
    'https://github.com/other/repo/releases/download/docs-catalogue/catalogue.json', 'https://user@objects.githubusercontent.com/file']) {
    let count = 0
    const rejected = await f.sync({ force: true, fetcher: async () => { count++; return new Response(null, { status: 302, headers: { location } }) } })
    assert.equal(rejected.status, 'failed')
    assert.equal(count, 1)
  }
  let loops = 0
  const loop = await f.sync({ force: true, fetcher: async () => { loops++; return new Response(null, { status: 302, headers: { location: cdn } }) } })
  assert.equal(loop.status, 'failed')
  assert.equal(loops, 6)
})

test('response length bounds stop downloads before promotion', async t => {
  const f = fixture(t)
  const snapshot = f.snapshot()
  let calls = 0
  const result = await f.sync({ fetcher: async target => {
    calls++
    if (target === MANIFEST_URL) return Response.json(snapshot.manifest)
    return new Response(snapshot.compressed, { headers: { 'content-length': String(MAX_COMPRESSED_BYTES + 1) } })
  } })
  assert.equal(result.status, 'failed')
  assert.match(result.error, /size limit/)
  assert.equal(calls, 2)
  assert.equal(existsSync(join(f.cacheDir, 'current.json')), false)
})

test('publisher helper ignores user-managed overrides and distinguishes missing releases', async t => {
  const f = fixture(t)
  process.env.TG_CORE_DOCS_DB = join(f.root, 'user-managed.sqlite')
  process.env.TG_CORE_DOCS_AUTO_UPDATE = '0'
  const remote = f.remote(f.snapshot())
  const result = await fetchPublishedCatalogue({ cacheDir: f.cacheDir, fetcher: remote.fetcher })
  assert.equal(result.status, 'updated', result.error)
  assert.equal(readDocument(result.databasePath).body, body)
  assert.equal(existsSync(process.env.TG_CORE_DOCS_DB), false)
  await assert.rejects(fetchPublishedCatalogue({ cacheDir: join(f.root, 'missing'), fetcher: async () => new Response(null, { status: 404 }) }), error => error.status === 404 && error.missing && error.resource === 'manifest')
  await assert.rejects(fetchPublishedCatalogue({ cacheDir: join(f.root, 'failed'), fetcher: async () => new Response(null, { status: 503 }) }), error => error.status === 503)
  const snapshot = f.snapshot()
  await assert.rejects(fetchPublishedCatalogue({ cacheDir: join(f.root, 'missing-asset'), fetcher: async target =>
    target === MANIFEST_URL ? Response.json(snapshot.manifest) : new Response(null, { status: 404 })
  }), error => error.status === 404 && !error.missing && error.resource === 'asset')
})

test('manifest validation rejects invalid metadata and unsupported versions', t => {
  const f = fixture(t)
  const valid = f.snapshot().manifest
  assert.equal(validateManifest(valid), valid)
  for (const change of [{ schemaVersion: 2 }, { revision: 'not a revision' }, { generatedAt: 'yesterday' },
    { documents: -1 }, { sections: 1.5 }, { reviewNeeded: ['../escape'] }, { sha256: 'bad' }]) {
    assert.throws(() => validateManifest({ ...valid, ...change }))
  }
})

test('sync JSON reports metadata without network in offline and custom-cache modes', t => {
  const f = fixture(t)
  for (const args of [['sync', '--offline'], ['sync', '--db', join(f.root, 'custom.sqlite')]]) {
    const result = spawnSync(process.execPath, [script, ...args, '--json'], { encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: f.root } })
    assert.equal(result.status, 0, result.stderr)
    const data = JSON.parse(result.stdout)
    assert.ok(['offline', 'custom'].includes(data.status))
    assert.equal(data.manifest, null)
    assert.equal(typeof data.databasePath, 'string')
  }
})

function cliFixture(f, snapshot) {
  const preload = join(f.root, 'fetch.mjs')
  const requests = join(f.root, 'requests.jsonl')
  writeFileSync(preload, `import { appendFileSync } from 'node:fs'
globalThis.fetch = async (url) => {
  appendFileSync(process.env.DOCS_REQUESTS, JSON.stringify(String(url)) + '\\n')
  if (process.env.DOCS_FAIL) return new Response(null, { status: 503 })
  if (String(url) === ${JSON.stringify(MANIFEST_URL)}) return Response.json(JSON.parse(process.env.DOCS_MANIFEST))
  if (String(url) === ${JSON.stringify(MANIFEST_URL.replace('catalogue.json', snapshot.manifest.asset))}) return new Response(Buffer.from(process.env.DOCS_PAYLOAD, 'base64'))
  throw new Error('network prohibited by fixture: ' + url)
}
`)
  return {
    requests,
    run(tool, args, environment = {}) {
      const result = spawnSync(process.execPath, ['--import', preload, tool, ...args, '--json'], {
        encoding: 'utf8', env: { ...process.env, XDG_CACHE_HOME: f.root, TG_BOTAPI_CACHE: join(f.root, 'botapi-cache'),
          DOCS_REQUESTS: requests, DOCS_MANIFEST: JSON.stringify(snapshot.manifest),
          DOCS_PAYLOAD: snapshot.compressed.toString('base64'), ...environment }
      })
      return { ...result, data: result.stdout ? JSON.parse(result.stdout) : null }
    },
    calls() { return existsSync(requests) ? readFileSync(requests, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [] }
  }
}

test('normal CLI lookup synchronizes, explicit sync fails visibly, and cached fallback warns', t => {
  const f = fixture(t)
  const cli = cliFixture(f, f.snapshot())
  const lookup = cli.run(script, ['search', 'snapshot'])
  assert.equal(lookup.status, 0, lookup.stderr)
  assert.equal(lookup.data.results[0].pageUrl, url)
  assert.equal(cli.calls().length, 2)
  const failed = cli.run(script, ['sync'], { DOCS_FAIL: '1' })
  assert.equal(failed.status, 1)
  assert.equal(failed.data.status, 'failed')
  assert.equal(failed.data.httpStatus, 503)
  const fallback = cli.run(script, ['search', 'snapshot'], { DOCS_FAIL: '1' })
  assert.equal(fallback.status, 0, fallback.stderr)
  assert.match(fallback.stderr, /catalogue update failed/)
  assert.equal(fallback.data.results[0].pageUrl, url)
  assert.equal(cli.calls().length, 3)
  assert.equal(cli.run(script, ['sync', '--offline']).data.status, 'offline')
  assert.equal(cli.calls().length, 3)
})

test('CLI --no-sync and automatic-update environment opt-out do not contact releases', t => {
  const f = fixture(t)
  const cli = cliFixture(f, f.snapshot())
  for (const [args, env] of [[['stats', '--no-sync'], {}], [['stats'], { TG_CORE_DOCS_AUTO_UPDATE: '0' }]]) {
    const result = cli.run(script, args, env)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.data.documents, 0)
  }
  assert.deepEqual(cli.calls(), [])
})

test('Bot API optionally synchronizes the sibling catalogue and resolves its generation offline', t => {
  const f = fixture(t)
  const methodUrl = 'https://core.telegram.org/bots/api/methods/getme.md'
  const snapshot = f.snapshot({ documents: [
    { url: 'https://core.telegram.org/bots/api.md', body: '# Telegram Bot API\n\n### Available methods\n\n- [getMe](/bots/api/methods/getme.md): get the bot.\n', checkedAt: newer, source: 'live' },
    { url: 'https://core.telegram.org/bots/api/types.md', body: '# Bot API types\n\n## Types\n', checkedAt: newer, source: 'live' },
    { url: 'https://core.telegram.org/bots/api/rich-messages.md', body: '# Rich messages\n\n## Formatting\n', checkedAt: newer, source: 'live' },
    { url: 'https://core.telegram.org/bots/api-changelog.md', body: '# Bot API changelog\n\n### 2026\n\n#### January 1, 2026\n\n**Bot API 10.0**\n', checkedAt: newer, source: 'live' },
    { url: methodUrl, body: '# getMe\n\nReturns True.\n', checkedAt: newer, source: 'live' }
  ] })
  const cli = cliFixture(f, snapshot)
  const botapi = fileURLToPath(new URL('../../telegram-bot-api/tools/botapi.mjs', import.meta.url))
  const result = cli.run(botapi, ['getMe'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.data.results[0].name, 'getMe')
  assert.equal(result.data.results[0].provenance.url, methodUrl)
  assert.equal(cli.calls().length, 2)
  const offline = cli.run(botapi, ['getMe', '--offline', '--refresh'])
  assert.equal(offline.status, 0, offline.stderr)
  assert.equal(offline.data.results[0].name, 'getMe')
  assert.equal(cli.calls().length, 2)
  const isolated = join(f.root, 'standalone-botapi.mjs')
  writeFileSync(isolated, readFileSync(botapi))
  const standalone = cli.run(isolated, ['getMe', '--offline'], { TG_CORE_DOCS_DB: '' })
  assert.equal(standalone.status, 2)
  assert.match(standalone.stderr, /no cached copy/)
  assert.equal(cli.calls().length, 2)
})

test('immutable asset metadata conflicts are rejected without replacing the current pointer', async t => {
  const f = fixture(t)
  const snapshot = f.snapshot()
  await f.sync(f.remote(snapshot))
  const pointer = readFileSync(join(f.cacheDir, 'current.json'))
  snapshot.manifest.documents++
  const result = await f.sync({ force: true, ...f.remote(snapshot) })
  assert.equal(result.status, 'failed')
  assert.match(result.error, /conflicting metadata/)
  assert.deepEqual(readFileSync(join(f.cacheDir, 'current.json')), pointer)
})

test('subsequent releases preserve newer live fetches made in the selected generation', async t => {
  const f = fixture(t)
  const first = await f.sync(f.remote(f.snapshot()))
  const local = new Catalogue(first.databasePath)
  local.put({ url, body: '# Locally refreshed\n\nKeep this live revision.\n', checkedAt: newer, fetchedAt: newer, source: 'live' })
  local.close()
  const result = await f.sync({ force: true, ...f.remote(f.snapshot({ time: '2026-06-01T00:00:00.000Z', text: '# New release\n\nRemote changes.\n' })) })
  assert.equal(result.status, 'updated', result.error)
  assert.notEqual(result.databasePath, first.databasePath)
  assert.equal(result.mergedDocuments, 1)
  assert.match(readDocument(result.databasePath).body, /Keep this live revision/)
  assert.match(readDocument(first.databasePath).body, /Keep this live revision/)
})

test('local reads newer than individual remote pages survive even when fetched during the crawl', async t => {
  const f = fixture(t)
  const duringCrawl = '2025-12-01T00:00:00.000Z'
  const remoteNewer = '2025-12-15T00:00:00.000Z'
  const latestUrl = 'https://core.telegram.org/api/remote-latest.md'
  const absentUrl = 'https://core.telegram.org/api/removed-before-release.md'
  const equalUrl = 'https://core.telegram.org/api/equal-time.md'
  seed(join(f.cacheDir, 'catalogue.sqlite'), [
    { url, body: '# Local during crawl\n\nNewer than the remote page.\n', checkedAt: duringCrawl, fetchedAt: duringCrawl, source: 'live' },
    { url: latestUrl, body: '# Older local\n\nRemote verification is newer.\n', checkedAt: duringCrawl, source: 'live' },
    { url: absentUrl, body: '# Old absent local\n\nDo not resurrect a removal.\n', checkedAt: duringCrawl, source: 'live' },
    { url: equalUrl, body: '# Equal local\n\nKeep the published copy on ties.\n', checkedAt: duringCrawl, source: 'live' }
  ])
  const snapshot = f.snapshot({ documents: [
    { url, body, checkedAt: old, source: 'live' },
    { url: latestUrl, body: '# Latest remote\n\nVerified after the local copy.\n', checkedAt: remoteNewer, source: 'live' },
    { url: equalUrl, body: '# Equal remote\n\nPublished copy wins ties.\n', checkedAt: duringCrawl, source: 'live' }
  ] })
  const result = await f.sync(f.remote(snapshot))
  assert.equal(result.status, 'updated', result.error)
  assert.equal(result.mergedDocuments, 1)
  assert.match(readDocument(result.databasePath).body, /Newer than the remote page/)
  assert.match(readDocument(result.databasePath, latestUrl).body, /Verified after the local copy/)
  assert.match(readDocument(result.databasePath, equalUrl).body, /Published copy wins ties/)
  assert.equal(readDocument(result.databasePath, absentUrl), undefined)
})
