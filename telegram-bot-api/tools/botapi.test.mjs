import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const script = fileURLToPath(new URL('./botapi.mjs', import.meta.url))
const sqlite = await import('node:sqlite').catch(() => null)
const ORIGIN = 'https://core.telegram.org'
const OLD = '2000-01-01T00:00:00.000Z'
const NEW = '2100-01-01T00:00:00.000Z'
const hash = (body) => createHash('sha256').update(body).digest('hex')
const pageUrl = (file) => `${ORIGIN}/${file.replaceAll('__', '/')}`
const pages = {
  'bots__api.md': '# Telegram Bot API\n\n### Available methods\n\n- [sendMessage](/bots/api/methods/sendmessage.md): send text.\n- [getMe](/bots/api/methods/getme.md): get the bot.\n\n#### Formatting options\n\nSee formatting.\n',
  'bots__api__types.md': '# Bot API types\n\n## Available types\n\n- [User](/bots/api/types/user.md): a user.\n- [InputMedia](/bots/api/types/inputmedia.md): media.\n',
  'bots__api__rich-messages.md': '# Rich messages\n\n## Rich Message Formatting Options\n\nIntro.\n\n#### Rich HTML style\n\n    <b>bold</b>\n\n## Methods\n\n- [sendRichMessage](/bots/api/methods/sendrichmessage.md): send rich text.\n',
  'bots__api-changelog.md': '# Bot API changelog\n\n### 2026\n\n#### August 24, 2026\n\n**Bot API 10.3**\n\n- Added *ephemeral_message_parameters*.\n',
  'bots__api__methods__sendmessage.md': '# sendMessage\n\n> Part of the [Telegram Bot API](/bots/api.md). Canonical location: [sendMessage](/bots/api#sendmessage).\n\nOn success, the sent [User](/bots/api/types/user.md) is returned.\n\n|Parameter|Type|Required|Description|\n|-----------|\n|chat_id|Integer|Yes|Target chat.|\n|text|String|Yes|Text with \\| a literal pipe.|\n|reply_to|[User](/bots/api/types/user.md)|Optional|A user.|\n\nExtra constraints.\n',
  'bots__api__methods__getme.md': '# getMe\n\nReturns a [User](/bots/api/types/user.md).\n',
  'bots__api__methods__sendrichmessage.md': '# sendRichMessage\n\nReturns True.\n\n|Parameter|Type|Required|Description|\n|-----------|\n|media|[InputMedia](/bots/api/types/inputmedia.md)|Yes|Media.|\n',
  'bots__api__types__user.md': '# User\n\nA user.\n\n|Field|Type|Description|\n|-----------|\n|id|Integer|Identifier.|\n|is_premium|True|*Optional*. Premium status.|\n',
  'bots__api__types__inputmedia.md': '# InputMedia\n\nOne of:\n\n* [User](/bots/api/types/user.md)\n',
  'bots__api__formatting.md': '# Formatting options\n\n> Part of the [Telegram Bot API](/bots/api.md).\n\n### HTML style\n\n    <b>bold</b>\n\n### MarkdownV2 style\n\n    *bold*\n',
  'bots__features.md': '# Features\n\n### Interactions\n\nIntro.\n\n#### Guest Bots\n\nGuest content.\n\n```markdown\n### Not a section\n```\n\n#### Other Bots\n\nOther content.\n\n### Management\n\nManagement content.\n'
}

async function fixture(t, { legacy = pages, shared = null, metadata = {}, responses = {} } = {}) {
  const cache = await mkdtemp(join(tmpdir(), 'botapi-markdown-test-'))
  t.after(() => rm(cache, { recursive: true, force: true }))
  await Promise.all(Object.entries(legacy).map(async ([name, text]) => {
    await writeFile(join(cache, name), text)
    await utimes(join(cache, name), new Date(OLD), new Date(OLD))
    if (metadata[name]) await writeFile(join(cache, `${name}.json`), JSON.stringify({
      url: pageUrl(name), hash: hash(text), ...metadata[name]
    }))
  }))
  const dbPath = join(cache, 'catalogue.sqlite')
  if (shared) {
    const db = new sqlite.DatabaseSync(dbPath)
    try {
      db.exec(`CREATE TABLE documents (
        url TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL,
        checked_at TEXT, fetched_at TEXT, source TEXT NOT NULL, etag TEXT, last_modified TEXT, area TEXT NOT NULL
      )`)
      const insert = db.prepare(`INSERT INTO documents
        (url,title,body,hash,checked_at,fetched_at,source,area) VALUES (?,?,?,?,?,?,?,?)`)
      for (const entry of shared) insert.run(
        entry.url, entry.title ?? entry.body.match(/^# (.+)/m)?.[1] ?? '',
        entry.body, entry.hash ?? hash(entry.body), entry.checkedAt === undefined ? OLD : entry.checkedAt,
        entry.fetchedAt ?? null, entry.source ?? 'tracker snapshot', 'bots'
      )
    } finally { db.close() }
  }
  const requests = join(cache, 'requests.jsonl')
  const preload = join(cache, 'network.mjs')
  await writeFile(preload, `import { appendFileSync } from 'node:fs'
globalThis.fetch = async (url) => {
  appendFileSync(process.env.BOTAPI_REQUESTS, JSON.stringify(String(url)) + '\\n')
  const body = JSON.parse(process.env.BOTAPI_RESPONSES)[String(url)]
  if (body === undefined) throw new Error('network prohibited by fixture')
  return new Response(body, { headers: { 'content-type': 'text/markdown' } })
}
`)
  const invoke = (args, offline = true, json = true) => {
    const result = spawnSync(process.execPath, [
      '--import', preload, script, ...args, ...(offline ? ['--offline'] : []), ...(json ? ['--json'] : [])
    ], {
      env: {
        ...process.env, TG_BOTAPI_CACHE: cache, TG_CORE_DOCS_DB: dbPath,
        BOTAPI_REQUESTS: requests, BOTAPI_RESPONSES: JSON.stringify(responses)
      }, encoding: 'utf8'
    })
    return { ...result, data: json && result.stdout ? JSON.parse(result.stdout) : null }
  }
  const run = (...args) => invoke(args)
  run.online = (...args) => invoke(args, false)
  run.text = (...args) => invoke(args, true, false)
  run.cache = cache
  run.dbPath = dbPath
  run.requests = async () => {
    try { return (await readFile(requests, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse) }
    catch (err) { if (err.code === 'ENOENT') return []; throw err }
  }
  return run
}

test('exact lookups preserve required fields, literal pipes, unions, returns and notes', async (t) => {
  const run = await fixture(t)
  const result = run('sendMessage', 'User', 'InputMedia', 'getMe')
  assert.equal(result.status, 0, result.stderr)
  const [method, user, union, noParams] = result.data.results
  assert.deepEqual(method.params.map((p) => [p.name, p.required]), [['chat_id', true], ['text', true], ['reply_to', false]])
  assert.equal(method.params[1].description, 'Text with | a literal pipe.')
  assert.equal(method.params[2].type, 'User')
  assert.equal(method.returns, 'On success, the sent User is returned.')
  assert.equal(method.notes, 'Extra constraints.')
  assert.deepEqual(user.fields.map((f) => [f.name, f.required]), [['id', true], ['is_premium', false]])
  assert.deepEqual(union.oneOf, ['User'])
  assert.deepEqual(noParams.params, [])
  const typo = run('sendMesage')
  assert.equal(typo.status, 1)
  assert.ok(typo.data.results[0].didYouMean.includes('sendMessage'))
})

test('search and refs include parameter, return and union relationships across split pages', async (t) => {
  const run = await fixture(t)
  const search = run('search', 'reply_to')
  assert.equal(search.status, 0, search.stderr)
  assert.ok(search.data.some((e) => e.name === 'sendMessage' && e.matches.includes('reply_to')))
  const refs = run('refs', 'User')
  assert.equal(refs.status, 0, refs.stderr)
  assert.deepEqual(refs.data.refs.map((r) => [r.in, r.member]).sort(), [
    ['InputMedia', '(member of)'], ['getMe', '(returns)'], ['sendMessage', '(returns)'], ['sendMessage', 'reply_to']
  ].sort())
  const rich = run('list', 'methods', '--section', 'Rich messages')
  assert.equal(rich.status, 0, rich.stderr)
  assert.deepEqual(rich.data.map((e) => e.name), ['sendRichMessage'])
})

test('prose keeps formatting examples and feature sections ignore fenced headings', async (t) => {
  const run = await fixture(t)
  const formatting = run('Formatting options')
  assert.equal(formatting.status, 0, formatting.stderr)
  assert.ok(formatting.data.results[0].description.includes('    <b>bold</b>'))
  assert.ok(formatting.data.results[0].description.includes('    *bold*'))
  const rich = run('Rich Message Formatting Options')
  assert.equal(rich.status, 0, rich.stderr)
  assert.ok(rich.data.results[0].description.includes('    <b>bold</b>'))
  const headings = run('features')
  assert.equal(headings.status, 0, headings.stderr)
  assert.deepEqual(headings.data.map((e) => e.name), ['Interactions', 'Guest Bots', 'Other Bots', 'Management'])
  const features = run('features', 'Interactions')
  assert.equal(features.status, 0, features.stderr)
  assert.deepEqual(features.data.map((e) => e.name), ['Interactions', 'Guest Bots', 'Other Bots'])
  assert.ok(features.data[1].text.includes('### Not a section'))
})

test('tracker corpus alone answers offline methods, types, prose, search and refs', { skip: !sqlite }, async (t) => {
  const shared = Object.entries(pages).map(([file, body]) => ({ url: pageUrl(file), body }))
  const run = await fixture(t, { legacy: {}, shared })
  const result = run('get', 'sendMessage', 'User', 'Formatting options')
  assert.equal(result.status, 0, result.stderr)
  const [method, type, prose] = result.data.results
  assert.equal(method.params[2].type, 'User')
  assert.equal(type.fields[0].name, 'id')
  assert.ok(prose.description.includes('    <b>bold</b>'))
  assert.deepEqual(method.provenance, {
    url: pageUrl('bots__api__methods__sendmessage.md'),
    hash: hash(pages['bots__api__methods__sendmessage.md']), source: 'tracker snapshot',
    checkedAt: OLD, fetchedAt: null, freshness: 'stale', stale: true
  })
  const search = run('search', 'reply_to')
  assert.equal(search.status, 0, search.stderr)
  assert.equal(search.data.find((e) => e.name === 'sendMessage').provenance.hash, method.provenance.hash)
  const refs = run('refs', 'User')
  assert.equal(refs.status, 0, refs.stderr)
  assert.ok(refs.data.refs.some((e) => e.in === 'sendMessage' && e.member === 'reply_to' && e.provenance.source === 'tracker snapshot'))
  const text = run.text('sendMessage')
  assert.equal(text.status, 0, text.stderr)
  for (const value of [method.provenance.url, method.provenance.hash]) {
    assert.ok(text.stdout.includes(value))
  }
  assert.deepEqual(await run.requests(), [])
})

test('unindexed pages use actual H1 and path kind, including without indexes', { skip: !sqlite }, async (t) => {
  const url = `${ORIGIN}/bots/api/methods/newservermethod.md`
  const body = '# newServerMethod\n\nReturns a [FutureType](/bots/api/types/futuretype.md).\n\n|Parameter|Type|Required|Description|\n|---|\n|future|FutureType|Yes|A newly documented value.|\n'
  const shared = [
    { url, body, title: 'not the definition name' },
    { url: `${ORIGIN}/bots/api/types/futuretype.md`, body: '# FutureType\n\n|Field|Type|Description|\n|---|\n|value|String|A value.|\n' },
    { url: `${ORIGIN}/bots/api/new-guide.md`, body: '# New server guide\n\nActual guide content.\n' }
  ]
  const run = await fixture(t, { legacy: {}, shared })
  const result = run('newServerMethod', 'FutureType')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.data.version, null)
  assert.deepEqual(result.data.results.map((e) => [e.name, e.kind]), [['newServerMethod', 'method'], ['FutureType', 'type']])
  assert.equal(result.data.results[0].params[0].name, 'future')
  assert.equal(result.data.results[0].provenance.url, url)
  const list = run('list', 'methods')
  assert.equal(list.status, 0, list.stderr)
  assert.deepEqual(list.data.map((e) => e.name), ['newServerMethod'])
  const prose = run('New server guide')
  assert.equal(prose.status, 0, prose.stderr)
  assert.equal(prose.data.results[0].description, 'Actual guide content.')
  const refs = run('refs', 'FutureType')
  assert.equal(refs.status, 0, refs.stderr)
  assert.deepEqual(refs.data.refs.map((r) => r.member).sort(), ['(returns)', 'future'])
  assert.deepEqual(await run.requests(), [])
  const indexed = await fixture(t, { shared })
  const discovered = indexed('newServerMethod')
  assert.equal(discovered.status, 0, discovered.stderr)
  assert.equal(discovered.data.results[0].kind, 'method')
  assert.equal(discovered.data.results[0].name, 'newServerMethod')
  const methods = indexed('list', 'methods')
  assert.equal(methods.status, 0, methods.stderr)
  assert.ok(methods.data.some((e) => e.name === 'sendMessage'))
  assert.ok(methods.data.some((e) => e.name === 'newServerMethod'))
  assert.deepEqual(await indexed.requests(), [])
})

test('freshness precedence chooses the newest valid shared or legacy copy', { skip: !sqlite }, async (t) => {
  const file = 'bots__api__methods__sendmessage.md'
  const url = pageUrl(file)
  const liveBody = '# sendMessage\n\nReturns True. Newly fetched definition.\n'
  const snapshot = '# sendMessage\n\nReturns True. Older snapshot.\n'
  const run = await fixture(t, {
    legacy: { ...pages, [file]: liveBody }, metadata: { [file]: { checkedAt: NEW, fetchedAt: NEW } },
    shared: [{ url, body: snapshot, checkedAt: OLD }]
  })
  const result = run('sendMessage')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.data.results[0].provenance.hash, hash(liveBody))
  assert.equal(result.data.results[0].provenance.source, 'live')
  assert.equal(result.data.results[0].provenance.freshness, 'fresh')
  const newer = await fixture(t, {
    legacy: { ...pages, [file]: snapshot }, metadata: { [file]: { checkedAt: OLD, fetchedAt: OLD } },
    shared: [{ url, body: liveBody, checkedAt: NEW }]
  })
  const sharedResult = newer('sendMessage')
  assert.equal(sharedResult.status, 0, sharedResult.stderr)
  assert.equal(sharedResult.data.results[0].provenance.source, 'tracker snapshot')
  assert.equal(sharedResult.data.results[0].provenance.hash, hash(liveBody))
  assert.equal(sharedResult.data.results[0].provenance.fetchedAt, null)
  const unknown = run('User')
  assert.equal(unknown.status, 0, unknown.stderr)
  assert.equal(unknown.data.results[0].provenance.checkedAt, null)
  assert.equal(unknown.data.results[0].provenance.freshness, 'unknown')
  assert.equal(unknown.data.results[0].provenance.stale, true)
  assert.deepEqual(await run.requests(), [])
  assert.deepEqual(await newer.requests(), [])
})

test('offline overrides refresh, never creates an absent catalogue and never attempts fetch', async (t) => {
  const run = await fixture(t, { legacy: {} })
  const result = run('sendMessage', '--refresh')
  assert.equal(result.status, 2)
  assert.deepEqual(await run.requests(), [])
  await assert.rejects(stat(run.dbPath), { code: 'ENOENT' })
  const cached = await fixture(t)
  const success = cached('sendMessage', '--refresh')
  assert.equal(success.status, 0, success.stderr)
  assert.deepEqual(await cached.requests(), [])
})

test('search and refs reuse stale corpus while exact refresh fetches only indexes and requested page', { skip: !sqlite }, async (t) => {
  const refreshed = '# sendMessage\n\nReturns True. Refreshed definition.\n'
  const responses = Object.fromEntries(Object.entries(pages).map(([file, body]) => [pageUrl(file), body]))
  responses[pageUrl('bots__api__methods__sendmessage.md')] = refreshed
  const run = await fixture(t, {
    legacy: {}, responses,
    shared: Object.entries(pages).map(([file, body]) => ({
      url: pageUrl(file), body, checkedAt: ['bots__api.md', 'bots__api__types.md', 'bots__api__rich-messages.md', 'bots__api-changelog.md'].includes(file) ? NEW : OLD
    }))
  })
  const search = run.online('search', 'reply_to')
  assert.equal(search.status, 0, search.stderr)
  assert.equal(search.data.find((e) => e.name === 'sendMessage').provenance.freshness, 'stale')
  const refs = run.online('refs', 'User')
  assert.equal(refs.status, 0, refs.stderr)
  assert.ok(refs.data.refs.some((e) => e.member === 'reply_to'))
  assert.deepEqual(await run.requests(), [])
  const refresh = run.online('sendMessage', '--refresh')
  assert.equal(refresh.status, 0, refresh.stderr)
  const provenance = refresh.data.results[0].provenance
  assert.equal(provenance.source, 'live')
  assert.equal(provenance.hash, hash(refreshed))
  assert.ok(Number.isFinite(Date.parse(provenance.checkedAt)))
  assert.equal(provenance.checkedAt, provenance.fetchedAt)
  assert.equal(provenance.freshness, 'fresh')
  assert.deepEqual((await run.requests()).sort(), [
    'bots__api.md', 'bots__api__types.md', 'bots__api__rich-messages.md',
    'bots__api-changelog.md', 'bots__api__methods__sendmessage.md'
  ].map(pageUrl).sort())
  const offline = run('sendMessage')
  assert.equal(offline.status, 0, offline.stderr)
  assert.equal(offline.data.results[0].provenance.hash, hash(refreshed))
})
