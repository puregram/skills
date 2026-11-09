import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'

import { Catalogue, ORIGIN } from './catalogue.mjs'
import { crawlCatalogue } from './crawl.mjs'

const oldTime = '2000-01-01T00:00:00.000Z'
const url = path => ORIGIN + path
const markdown = (body, headers = {}) => new Response(body, { headers: { 'content-type': 'text/markdown; charset=utf-8', ...headers } })
const settle = () => new Promise(resolve => setImmediate(resolve))

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'docs-crawl-test-'))
  const outputPath = join(directory, 'candidate.sqlite')
  const previousPath = join(directory, 'previous.sqlite')
  const controller = new AbortController()
  const catalogues = []
  t.after(() => {
    controller.abort()
    for (const catalogue of catalogues) catalogue.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return {
    directory, outputPath, previousPath, controller,
    crawl(options) { return crawlCatalogue({ outputPath, seeds: [], signal: controller.signal, ...options }) },
    open(path = outputPath) {
      const catalogue = new Catalogue(path)
      catalogues.push(catalogue)
      return catalogue
    }
  }
}

function stored(catalogue, path, body, extra = {}) {
  catalogue.put({ url: url(path), body, checkedAt: oldTime, fetchedAt: oldTime, source: 'live', etag: 'old-tag', lastModified: 'Sat, 01 Jan 2000 00:00:00 GMT', ...extra })
}

function routesFetcher(routes, calls = []) {
  return async (target, init) => {
    calls.push({ url: target, init })
    if (target === url('/robots.txt')) return new Response('', { status: 404 })
    assert.ok(routes.has(target), 'unexpected request: ' + target)
    const response = routes.get(target)
    return typeof response === 'function' ? response(init) : response
  }
}

test('concurrency includes body reads, late discoveries keep idle workers alive, and URLs are scanned once', async t => {
  const f = fixture(t)
  const bodies = new Map()
  const firstWave = deferred()
  const secondWave = deferred()
  const calls = []
  let active = 0
  let peak = 0
  let finished = false
  const running = f.crawl({ seeds: [url('/a.md'), url('/b.md'), url('/a.md#again')], concurrency: 2, fetcher: async target => {
    if (target === url('/robots.txt')) return new Response('User-agent: *\nDisallow:\n')
    calls.push(target)
    active++
    peak = Math.max(peak, active)
    const body = new ReadableStream({
      start(controller) {
        bodies.set(target, text => { active--; controller.enqueue(new TextEncoder().encode(text)); controller.close() })
        if (calls.length === 2) firstWave.resolve()
        if (calls.length === 4) secondWave.resolve()
      },
      cancel() { active-- }
    })
    return markdown(body)
  } })
  running.then(() => { finished = true }, () => {})
  await firstWave.promise
  assert.equal(active, 2)
  assert.equal(calls.length, 2)
  bodies.get(url('/b.md'))('# B\n')
  await settle()
  assert.equal(active, 1)
  assert.equal(finished, false)
  bodies.get(url('/a.md'))('# A\n\n[C](/c.md#details)\n[D](/d.md)\n[C again](/c.md)\n[not Markdown](/ignored)\n[foreign](https://example.com/e.md)')
  await secondWave.promise
  assert.equal(active, 2)
  bodies.get(url('/c.md'))('# C\n\n[A again](/a.md)\n## Details\n')
  bodies.get(url('/d.md'))('# D\n')
  const report = await running
  assert.equal(peak, 2)
  assert.deepEqual(calls.sort(), ['/a.md', '/b.md', '/c.md', '/d.md'].map(url).sort())
  assert.equal(report.complete, true)
  assert.equal(report.checked, 4)
  assert.equal(report.documents, 4)
  assert.deepEqual(report.transientErrors, [])
})

test('the decoded body cap cannot be bypassed with a small Content-Length or an encoding header', async t => {
  const f = fixture(t)
  let cancelled = false
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)) },
    cancel() { cancelled = true }
  })
  const report = await f.crawl({ seeds: [url('/large.md')], fetcher: routesFetcher(new Map([
    [url('/large.md'), markdown(body, { 'content-length': '1', 'content-encoding': 'gzip' })]
  ])) })
  assert.equal(cancelled, true)
  assert.equal(report.complete, false)
  assert.equal(report.documents, 0)
  assert.match(report.transientErrors[0].message, /exceeds 8 MiB/)
})

test('a fresh candidate includes committed WAL data, conditionally checks all previous URLs, and never modifies the previous snapshot', async t => {
  const f = fixture(t)
  const previous = f.open(f.previousPath)
  const retainedBody = '# Retained\n\n[New discovery](/discovered.md#section)\n'
  const sameBody = '# Refetched\n\nStill the same body.\n'
  stored(previous, '/retained.md', retainedBody, { source: 'tracker snapshot' })
  stored(previous, '/refetched.md', sameBody)
  stored(previous, '/gone.md', '# Gone\n\nObsolete_unique_token\n')
  stored(previous, '/removed.md', '# Removed\n\nObsolete_unique_token\n')
  const databaseBefore = readFileSync(f.previousPath)
  const walBefore = readFileSync(f.previousPath + '-wal')
  const calls = []
  const report = await f.crawl({ previousPath: f.previousPath, fetcher: routesFetcher(new Map([
    [url('/retained.md'), new Response(null, { status: 304, headers: { etag: 'new-tag' } })],
    [url('/refetched.md'), markdown(sameBody, { etag: 'fresh-tag' })],
    [url('/gone.md'), new Response(null, { status: 404 })],
    [url('/removed.md'), new Response(null, { status: 410 })],
    [url('/discovered.md'), markdown('# Discovered\n\n## Section\nDetails.\n')]
  ]), calls) })
  assert.deepEqual(readFileSync(f.previousPath), databaseBefore)
  assert.deepEqual(readFileSync(f.previousPath + '-wal'), walBefore)
  assert.equal(previous.get(url('/retained.md')).checkedAt, oldTime)
  assert.equal(previous.get(url('/gone.md')).body.includes('Obsolete_unique_token'), true)
  assert.equal(report.complete, true)
  assert.equal(report.checked, 5)
  assert.equal(report.documents, 3)
  assert.deepEqual(report.unavailable.map(item => [item.url, item.status]).sort(), [[url('/gone.md'), 404], [url('/removed.md'), 410]])
  for (const path of ['/retained.md', '/refetched.md', '/gone.md', '/removed.md']) {
    const headers = calls.find(call => call.url === url(path)).init.headers
    assert.equal(headers['if-none-match'], 'old-tag')
    assert.equal(headers['if-modified-since'], 'Sat, 01 Jan 2000 00:00:00 GMT')
  }
  assert.equal(calls.find(call => call.url === url('/discovered.md')).init.headers['if-none-match'], undefined)
  const candidate = f.open()
  const retained = candidate.get(url('/retained.md'))
  assert.equal(retained.fetchedAt, oldTime)
  assert.notEqual(retained.checkedAt, oldTime)
  assert.equal(retained.source, 'live')
  assert.equal(retained.etag, 'new-tag')
  assert.equal(retained.lastModified, 'Sat, 01 Jan 2000 00:00:00 GMT')
  assert.equal(retained.body, retainedBody)
  const refetched = candidate.get(url('/refetched.md'))
  assert.equal(refetched.body, sameBody)
  assert.equal(refetched.fetchedAt, refetched.checkedAt)
  assert.notEqual(refetched.fetchedAt, oldTime)
  assert.equal(refetched.etag, 'fresh-tag')
  assert.equal(refetched.lastModified, null)
  assert.equal(candidate.get(url('/gone.md')), null)
  assert.equal(candidate.get(url('/removed.md')), null)
  assert.equal(candidate.db.prepare('SELECT COUNT(*) AS count FROM sections WHERE url IN (?, ?)').get(url('/gone.md'), url('/removed.md')).count, 0)
  assert.equal(candidate.db.prepare('SELECT COUNT(*) AS count FROM section_search WHERE url IN (?, ?)').get(url('/gone.md'), url('/removed.md')).count, 0)
  assert.deepEqual(candidate.search('Obsolete_unique_token'), [])
})

test('network, HTTP, content, UTF-8, parser, and unexpected 304 failures make a scan incomplete without replacing good content', async t => {
  const f = fixture(t)
  const previous = f.open(f.previousPath)
  stored(previous, '/good.md', '# Good\n\nLast good content.\n')
  const routes = new Map([
    [url('/good.md'), new Response('<html>Server error</html>', { status: 500 })],
    [url('/network.md'), () => { throw new Error('network unavailable') }],
    [url('/html.md'), new Response('# Misleading heading\n', { headers: { 'content-type': 'text/html' } })],
    [url('/disguised.md'), markdown('<!doctype html>\n<html>\n# Misleading heading\n</html>')],
    [url('/invalid.md'), markdown('No top-level heading.')],
    [url('/encoding.md'), markdown(new Uint8Array([0xff]))],
    [url('/stream.md'), markdown(new ReadableStream({ start(controller) { controller.error(new Error('body disconnected')) } }))],
    [url('/uncached.md'), new Response(null, { status: 304 })],
    [url('/busy.md'), new Response(null, { status: 503, headers: { 'retry-after': '0' } })]
  ])
  const report = await f.crawl({ previousPath: f.previousPath, seeds: [...routes.keys()], fetcher: routesFetcher(routes) })
  assert.equal(report.complete, false)
  assert.equal(report.checked, routes.size)
  assert.equal(report.transientErrors.length, routes.size)
  assert.equal(report.transientErrors.find(error => error.url === url('/good.md')).status, 500)
  assert.deepEqual(report.unavailable, [])
  const candidate = f.open()
  assert.equal(candidate.stats().documents, 1)
  assert.equal(candidate.get(url('/good.md')).body, '# Good\n\nLast good content.\n')
  assert.equal(candidate.get(url('/good.md')).checkedAt, oldTime)
})

test('canonical redirects share a target scan, use the target validators, and remove obsolete alias indexes', async t => {
  const f = fixture(t)
  const previous = f.open(f.previousPath)
  stored(previous, '/alias.md', '# Alias\n\nObsolete_alias_token\n', { etag: 'alias-tag' })
  stored(previous, '/target.md', '# Target\n', { etag: 'target-tag' })
  const calls = []
  const report = await f.crawl({ previousPath: f.previousPath, seeds: [url('/alias.md')], fetcher: routesFetcher(new Map([
    [url('/alias.md'), new Response(null, { status: 301, headers: { location: '/target.md#heading' } })],
    [url('/target.md'), new Response(null, { status: 304 })]
  ]), calls) })
  assert.equal(report.complete, true)
  assert.equal(report.documents, 1)
  assert.equal(calls.filter(call => call.url === url('/target.md')).length, 1)
  assert.equal(calls.find(call => call.url === url('/target.md')).init.headers['if-none-match'], 'target-tag')
  assert.ok(calls.every(call => call.init.redirect === 'manual'))
  const candidate = f.open()
  assert.equal(candidate.get(url('/alias.md')), null)
  assert.deepEqual(candidate.search('Obsolete_alias_token'), [])
})

test('redirects cannot leave the HTTPS Markdown scope and loops and long chains prevent completion', async t => {
  const f = fixture(t)
  const routes = new Map([
    [url('/external.md'), new Response(null, { status: 302, headers: { location: 'https://evil.test/stolen.md' } })],
    [url('/downgrade.md'), new Response(null, { status: 302, headers: { location: 'http://core.telegram.org/stolen.md' } })],
    [url('/html.md'), new Response(null, { status: 302, headers: { location: '/not-markdown' } })],
    [url('/loop-a.md'), new Response(null, { status: 302, headers: { location: '/loop-b.md' } })],
    [url('/loop-b.md'), new Response(null, { status: 302, headers: { location: '/loop-a.md' } })]
  ])
  for (let index = 0; index < 7; index++) routes.set(url(`/chain-${index}.md`), new Response(null, { status: 302, headers: { location: `/chain-${index + 1}.md` } }))
  const calls = []
  const report = await f.crawl({ seeds: ['/external.md', '/downgrade.md', '/html.md', '/loop-a.md', '/chain-0.md'].map(url), fetcher: routesFetcher(routes, calls) })
  assert.equal(report.complete, false)
  assert.equal(report.documents, 0)
  assert.equal(report.disallowed.length, 3)
  assert.equal(report.transientErrors.length, 5)
  assert.ok(report.transientErrors.some(error => /redirect loop/.test(error.message)))
  assert.ok(report.transientErrors.some(error => /too many redirects/.test(error.message)))
  assert.equal(calls.filter(call => call.url === url('/loop-a.md')).length, 1)
  assert.ok(calls.every(call => call.url.startsWith(ORIGIN + '/')))
  assert.equal(calls.some(call => call.url === url('/chain-6.md')), false)
})

test('robots groups, longest rules, wildcard endings, percent normalization, and allows are respected', async t => {
  const f = fixture(t)
  const calls = []
  const robots = 'User-agent: *\nDisallow: /\n\nUser-agent: telegram-core-docs-crawler\nDisallow: /blocked/\nAllow: /blocked/allowed.md$\nDisallow: /encoded/%7eprivate.md\nDisallow: /suffix*.md$\nAllow: /suffix-ok.md\n\nUser-agent: telegram-core-docs-crawler\nDisallow: /second.md\n'
  const seeds = ['/blocked/denied.md', '/blocked/allowed.md', '/encoded/~private.md', '/suffix-no.md', '/suffix-ok.md', '/second.md', '/normal.md'].map(url)
  const report = await f.crawl({ seeds, fetcher: async target => {
    calls.push(target)
    if (target === url('/robots.txt')) return new Response(robots)
    return markdown('# Allowed\n')
  } })
  assert.equal(report.complete, true)
  assert.equal(report.documents, 3)
  assert.deepEqual(report.disallowed.map(item => item.url).sort(), ['/blocked/denied.md', '/encoded/~private.md', '/suffix-no.md', '/second.md'].map(url).sort())
  assert.deepEqual(calls.filter(target => target !== url('/robots.txt')).sort(), ['/blocked/allowed.md', '/suffix-ok.md', '/normal.md'].map(url).sort())
})

for (const status of [404, 410]) {
  test('HTTP ' + status + ' robots.txt means no restrictions', async t => {
    const f = fixture(t)
    const report = await f.crawl({ seeds: [url('/allowed.md')], fetcher: async target => target === url('/robots.txt') ? new Response(null, { status }) : markdown('# Allowed\n') })
    assert.equal(report.complete, true)
    assert.equal(report.documents, 1)
  })
}

test('robots failures and off-scope redirects abort before any document is fetched', async t => {
  const responses = [
    () => new Response(null, { status: 503 }),
    () => new Response(null, { status: 403 }),
    () => { throw new Error('robots network failure') },
    () => new Response('<!doctype html><html>Unavailable</html>'),
    () => new Response(null, { status: 302, headers: { location: 'https://evil.test/robots.txt' } })
  ]
  for (const [index, response] of responses.entries()) {
    const outputPath = join(fixture(t).directory, 'failure-' + index + '.sqlite')
    let calls = 0
    await assert.rejects(crawlCatalogue({ outputPath, seeds: [url('/never.md')], fetcher: async target => {
      calls++
      assert.equal(target, url('/robots.txt'))
      return response()
    } }))
    assert.equal(calls, 1)
  }
})

test('crawl delay and Retry-After are shared with workers already waiting for a slot', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const f = fixture(t)
  const calls = []
  const running = f.crawl({ seeds: ['/a.md', '/b.md', '/c.md'].map(url), concurrency: 3, delay: 1000, fetcher: async target => {
    calls.push({ url: target, at: Date.now() })
    if (target === url('/robots.txt')) return new Response('User-agent: *\nCrawl-delay: 2\n')
    if (target === url('/a.md')) return new Response(null, { status: 503, headers: { 'retry-after': '5' } })
    return markdown('# Available\n')
  } })
  await settle()
  t.mock.timers.tick(1999)
  await settle()
  assert.equal(calls.length, 1)
  t.mock.timers.tick(1)
  await settle()
  assert.deepEqual(calls.map(call => call.at), [0, 2000])
  t.mock.timers.tick(4999)
  await settle()
  assert.equal(calls.length, 2)
  t.mock.timers.tick(1)
  await settle()
  assert.deepEqual(calls.map(call => call.at), [0, 2000, 7000])
  t.mock.timers.tick(2000)
  const report = await running
  assert.deepEqual(calls.map(call => call.at), [0, 2000, 7000, 9000])
  assert.equal(report.complete, false)
  assert.equal(report.transientErrors[0].status, 503)
})

test('HTTP-date Retry-After delays later requests and the default adds no artificial gap', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const f = fixture(t)
  const calls = []
  const running = f.crawl({ seeds: ['/busy.md', '/next.md', '/last.md'].map(url), concurrency: 1, fetcher: async target => {
    calls.push({ url: target, at: Date.now() })
    if (target === url('/robots.txt')) return new Response(null, { status: 404 })
    if (target === url('/busy.md')) return new Response(null, { status: 429, headers: { 'retry-after': new Date(4000).toUTCString() } })
    return markdown('# Available\n')
  } })
  await settle()
  assert.deepEqual(calls.map(call => call.at), [0, 0])
  t.mock.timers.tick(3999)
  await settle()
  assert.equal(calls.length, 2)
  t.mock.timers.tick(1)
  const report = await running
  assert.deepEqual(calls.map(call => call.at), [0, 0, 4000, 4000])
  assert.equal(report.complete, false)
})

test('request timeout covers hanging body reads and keeps the scan incomplete', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 })
  const f = fixture(t)
  const entered = deferred()
  let cancelled = false
  let requestSignal
  const running = f.crawl({ seeds: [url('/hanging.md')], fetcher: async (target, init) => {
    if (target === url('/robots.txt')) return new Response(null, { status: 404 })
    requestSignal = init.signal
    entered.resolve()
    return markdown(new ReadableStream({ cancel() { cancelled = true } }))
  } })
  await entered.promise
  await settle()
  t.mock.timers.tick(30_000)
  const report = await running
  assert.equal(cancelled, true)
  assert.equal(requestSignal.aborted, true)
  assert.equal(report.complete, false)
  assert.match(report.transientErrors[0].message, /timed out/)
})

test('abort cancels every active body read, drains workers, and does not start queued URLs', async t => {
  const f = fixture(t)
  const entered = deferred()
  const signals = []
  let cancelled = 0
  const running = f.crawl({ seeds: ['/a.md', '/b.md', '/queued.md'].map(url), concurrency: 2, fetcher: async (target, init) => {
    if (target === url('/robots.txt')) return new Response(null, { status: 404 })
    signals.push(init.signal)
    if (signals.length === 2) entered.resolve()
    return markdown(new ReadableStream({ cancel() { cancelled++ } }))
  } })
  running.catch(() => {})
  await entered.promise
  await settle()
  const reason = new Error('stop this scan')
  f.controller.abort(reason)
  await assert.rejects(running, error => error === reason)
  assert.equal(signals.length, 2)
  assert.equal(cancelled, 2)
  assert.ok(signals.every(signal => signal.aborted))
  assert.equal(f.open().stats().documents, 0)
})

test('fatal SQLite errors abort and drain other workers before rejecting', async t => {
  const f = fixture(t)
  const entered = deferred()
  const release = deferred()
  let cancelled = 0
  let activeSignal
  const running = f.crawl({ seeds: ['/fail.md', '/waiting.md', '/queued.md'].map(url), concurrency: 2, fetcher: async (target, init) => {
    if (target === url('/robots.txt')) {
      const db = new DatabaseSync(f.outputPath)
      try { db.exec("CREATE TRIGGER reject_document BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT, 'forced storage failure'); END;") } finally { db.close() }
      return new Response(null, { status: 404 })
    }
    if (target === url('/fail.md')) { await release.promise; return markdown('# Fails\n') }
    assert.equal(target, url('/waiting.md'))
    activeSignal = init.signal
    entered.resolve()
    return markdown(new ReadableStream({ cancel() { cancelled++ } }))
  } })
  running.catch(() => {})
  await entered.promise
  await settle()
  release.resolve()
  await assert.rejects(running, /forced storage failure/)
  assert.equal(cancelled, 1)
  assert.equal(activeSignal.aborted, true)
})

test('an already-aborted scan performs no I/O and output cannot overwrite a previous snapshot', async t => {
  const f = fixture(t)
  const reason = new Error('already aborted')
  f.controller.abort(reason)
  await assert.rejects(f.crawl({ fetcher: () => { throw new Error('must not fetch') } }), error => error === reason)
  assert.equal(existsSync(f.outputPath), false)
  const previous = f.open(f.previousPath)
  stored(previous, '/old.md', '# Old\n')
  await assert.rejects(crawlCatalogue({ outputPath: f.previousPath, previousPath: f.previousPath, fetcher: () => { throw new Error('must not fetch') } }), /must differ/)
  await assert.rejects(crawlCatalogue({ outputPath: f.previousPath, fetcher: () => { throw new Error('must not fetch') } }), /EEXIST/)
})

for (const maxPages of [0, 1, 50]) {
  test('maxPages=' + maxPages + ' always produces a nonpublishable report', async t => {
    const f = fixture(t)
    const report = await f.crawl({ maxPages, seeds: [url('/one.md')], fetcher: routesFetcher(new Map([[url('/one.md'), markdown('# One\n')]])) })
    assert.equal(report.complete, false)
    assert.equal(report.checked, maxPages === 0 ? 0 : 1)
  })
}
