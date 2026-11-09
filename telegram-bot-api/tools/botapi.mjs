#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ORIGIN = 'https://core.telegram.org'
const PAGES = {
  api: `${ORIGIN}/bots/api.md`,
  types: `${ORIGIN}/bots/api/types.md`,
  rich: `${ORIGIN}/bots/api/rich-messages.md`,
  formatting: `${ORIGIN}/bots/api/formatting.md`,
  changelog: `${ORIGIN}/bots/api-changelog.md`,
  features: `${ORIGIN}/bots/features.md`
}

const DEFAULT_TTL_HOURS = 6

const HELP = `botapi — live lookup over the official telegram bot api reference

usage:
  botapi.mjs <Name> [<Name>...]        exact method / type / prose section (case-insensitive)
  botapi.mjs get <Name> [<Name>...]    same as above
  botapi.mjs search <words...>         rank methods, types, fields and params by relevance
  botapi.mjs refs <Type>               every field / param / union that uses <Type>
  botapi.mjs list [methods|types|prose|sections] [--section <h3 name>]
  botapi.mjs changelog [--last N] [--since X.Y] [--grep <regex>]
  botapi.mjs features [<heading>]      bots/features page: list headings, or print one section
  botapi.mjs version                   current bot api version + release date

options:
  --json            machine-readable output
  --refresh         ignore the cache and refetch
  --offline         never touch the network; use the cache even if stale
  --no-sync         skip optional shared-catalogue release checks
  --ttl <hours>     cache lifetime (default ${DEFAULT_TTL_HOURS})
  --brief           get: omit field / param descriptions

the cache lives in $TG_BOTAPI_CACHE, else $XDG_CACHE_HOME/telegram-bot-api, else ~/.cache/telegram-bot-api.
optional shared catalogue: $TG_CORE_DOCS_DB, else $XDG_CACHE_HOME/telegram-core-docs/catalogue.sqlite.
the sibling telegram-core-docs skill can update that catalogue from GitHub about hourly; --offline never checks.
shared catalogue reading needs Node >=22.13; standalone Markdown lookup needs Node >=18.
search/refs reuse cached entry pages even when stale; --refresh refetches with at most 8 concurrent requests.
results include source URL, SHA-256, verification/fetch timestamps and explicit freshness.
if the network fails, a cached page is used with a warning on stderr.

examples:
  botapi.mjs sendMessage
  botapi.mjs EphemeralMessageParameters ReplyParameters
  botapi.mjs search ephemeral
  botapi.mjs search guest query
  botapi.mjs refs InlineQueryResult
  botapi.mjs "Formatting options"
  botapi.mjs changelog --last 2
  botapi.mjs features "Guest Bots"
`

// ---------- args ----------

function parseArgs(argv) {
  const opts = { json: false, refresh: false, offline: false, brief: false, ttl: DEFAULT_TTL_HOURS, noSync: false }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') opts.json = true
    else if (a === '--refresh') opts.refresh = true
    else if (a === '--offline') opts.offline = true
    else if (a === '--no-sync') opts.noSync = true
    else if (a === '--brief') opts.brief = true
    else if (a === '--help' || a === '-h') opts.help = true
    else if (a === '--ttl') opts.ttl = Number(argv[++i])
    else if (a === '--last') opts.last = Number(argv[++i])
    else if (a === '--since') opts.since = argv[++i]
    else if (a === '--grep') opts.grep = argv[++i]
    else if (a === '--section') opts.section = argv[++i]
    else rest.push(a)
  }
  return { opts, rest }
}

// ---------- fetching + cache ----------

function cacheDir() {
  if (process.env.TG_BOTAPI_CACHE) return process.env.TG_BOTAPI_CACHE
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
  return join(base, 'telegram-bot-api')
}

const hashBody = (body) => createHash('sha256').update(body).digest('hex')
const timestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null

function officialUrl(value) {
  try {
    const url = new URL(value)
    return url.origin === ORIGIN && !url.username && !url.password && !url.search && !url.hash &&
      (url.pathname === '/' || url.pathname.endsWith('.md')) && url.href === value
  } catch { return false }
}

let cataloguePromise
async function catalogue(opts) {
  if (!cataloguePromise) cataloguePromise = readCatalogue(opts)
  return cataloguePromise
}

async function readCatalogue(opts) {
  let path = process.env.TG_CORE_DOCS_DB ||
    join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'telegram-core-docs', 'catalogue.sqlite')
  const [major, minor] = process.versions.node.split('.').map(Number)
  let lease
  if (!process.env.TG_CORE_DOCS_DB && (major > 22 || (major === 22 && minor >= 13))) {
    const updater = new URL('../../telegram-core-docs/tools/update.mjs', import.meta.url)
    try {
      await stat(updater)
      const { acquireCatalogueLease, synchronizeCatalogue } = await import(updater.href)
      const result = await synchronizeCatalogue({ offline: opts.offline,
        enabled: !opts.noSync && process.env.TG_CORE_DOCS_AUTO_UPDATE !== '0' })
      lease = acquireCatalogueLease()
      path = lease.databasePath
      if (result.error) process.stderr.write(`warning: shared catalogue update failed (${result.error}); using the existing cache\n`)
    } catch (error) {
      if (error.code !== 'ENOENT') process.stderr.write(`warning: shared catalogue updater unavailable: ${error.message}\n`)
    }
  }
  try {
    await stat(path)
  } catch (err) {
    lease?.close()
    if (err.code === 'ENOENT') return new Map()
    process.stderr.write(`warning: cannot read shared catalogue: ${err.message}\n`)
    return new Map()
  }
  let db
  try {
    const { DatabaseSync } = await import('node:sqlite')
    db = new DatabaseSync(path, { readOnly: true })
    const rows = db.prepare(`SELECT url, title, body, hash, checked_at, fetched_at, source
      FROM documents WHERE url LIKE 'https://core.telegram.org/bots/%'`).all()
    const documents = new Map()
    for (const row of rows) {
      if (!officialUrl(row.url) || typeof row.body !== 'string' || !/^# /m.test(row.body) ||
        hashBody(row.body) !== row.hash || !['live', 'tracker snapshot'].includes(row.source)) continue
      const checkedAt = timestamp(row.checked_at)
      const fetchedAt = timestamp(row.fetched_at)
      documents.set(row.url, {
        body: row.body, title: row.title,
        provenance: { url: row.url, hash: row.hash, source: row.source, checkedAt, fetchedAt },
        storedAt: Date.parse(checkedAt || fetchedAt) || 0
      })
    }
    return documents
  } catch (err) {
    process.stderr.write(`warning: shared catalogue unavailable (requires Node >=22.13 and a valid catalogue): ${err.message}\n`)
    return new Map()
  } finally {
    db?.close()
    lease?.close()
  }
}

function documentWithFreshness(document, opts) {
  const checked = Date.parse(document.provenance.checkedAt)
  const freshness = !Number.isFinite(checked) ? 'unknown' :
    (Date.now() - checked) / 3_600_000 < opts.ttl ? 'fresh' : 'stale'
  return { ...document, provenance: { ...document.provenance, freshness, stale: freshness !== 'fresh' } }
}

async function cachedPage(url, opts) {
  const file = join(cacheDir(), new URL(url).pathname.slice(1).replaceAll('/', '__'))
  let legacy
  try {
    const st = await stat(file)
    const body = await readFile(file, 'utf8')
    if (/^# /m.test(body)) {
      const hash = hashBody(body)
      let metadata
      try { metadata = JSON.parse(await readFile(`${file}.json`, 'utf8')) } catch {}
      const verified = metadata?.url === url && metadata.hash === hash
      legacy = {
        body, storedAt: st.mtimeMs,
        provenance: {
          url, hash, source: verified ? 'live' : 'legacy cache',
          checkedAt: verified ? timestamp(metadata.checkedAt) : null,
          fetchedAt: verified ? timestamp(metadata.fetchedAt) : null
        }
      }
      legacy.storedAt = Date.parse(legacy.provenance.checkedAt || legacy.provenance.fetchedAt) || st.mtimeMs
    }
  } catch {}
  const shared = (await catalogue(opts)).get(url)
  const newest = legacy && (!shared || legacy.storedAt >= shared.storedAt) ? legacy : shared
  return newest ? documentWithFreshness(newest, opts) : null
}

async function loadPage(key, opts) {
  const url = PAGES[key] || key
  if (!officialUrl(url)) throw new Error(`not an official Markdown URL: ${url}`)
  const cached = await cachedPage(url, opts)
  if (opts.offline) {
    if (cached) return cached
    throw new Error(`--offline but no cached copy of ${url}`)
  }
  if (cached && !opts.refresh && (opts.preferCache || cached.provenance.freshness === 'fresh')) return cached
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'telegram-bot-api-skill/1.0' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.text()
    if (!res.headers.get('content-type')?.includes('text/markdown') || !/^# /m.test(body)) {
      throw new Error('unexpected Markdown page')
    }
    const now = new Date().toISOString()
    const provenance = { url, hash: hashBody(body), source: 'live', checkedAt: now, fetchedAt: now }
    const file = join(cacheDir(), new URL(url).pathname.slice(1).replaceAll('/', '__'))
    await mkdir(cacheDir(), { recursive: true })
    await writeFile(file, body)
    await writeFile(`${file}.json`, JSON.stringify(provenance))
    return documentWithFreshness({ body, provenance, storedAt: Date.parse(now) }, opts)
  } catch (err) {
    if (cached) {
      process.stderr.write(`warning: fetching ${url} failed (${err.message}); using ${cached.provenance.freshness} cache, checked ${cached.provenance.checkedAt || 'unknown'}\n`)
      return cached
    }
    throw new Error(`cannot fetch ${url}: ${err.message}`)
  }
}

function plainText(markdown) {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)\n]+\)/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\\([\\|])/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .trim()
}

function anchor(name) {
  return plainText(name).toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')
}

function chunks(markdown, levels = [3, 4]) {
  const heads = []
  let offset = 0
  let fence = null
  for (const line of markdown.split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null
    } else if (!fence) {
      const h = line.match(/^(#{1,6}) (.+?)\s*$/)
      if (h && levels.includes(h[1].length)) {
        heads.push({ level: h[1].length, title: plainText(h[2]), anchor: anchor(h[2]), start: offset, bodyStart: offset + line.length + 1 })
      }
    }
    offset += line.length + 1
  }
  return heads.map((h, i) => ({ ...h, text: markdown.slice(h.bodyStart, heads[i + 1]?.start ?? markdown.length).trim() }))
}

function parseIndex(markdown, source) {
  const entries = []
  let section = source === 'rich' ? 'Rich messages' : ''
  const levels = source === 'types' ? [2] : source === 'rich' ? [2, 4] : [3, 4]
  for (const c of chunks(markdown, levels)) {
    if (source === 'types' || (source === 'api' && c.level === 3)) section = c.title
    if (source !== 'types' && section !== 'Recent changes') {
      const kind = source === 'api' && c.level === 3 ? 'section' : 'prose'
      entries.push({ kind, name: c.title, anchor: c.anchor, section, description: c.text })
    }
    for (const m of c.text.matchAll(/^[-*] \[([A-Za-z][A-Za-z0-9]*)\]\((\/bots\/api\/(methods|types)\/[^)]+\.md)\):[ \t]*(.*)$/gm)) {
      entries.push({ kind: m[3] === 'methods' ? 'method' : 'type', name: m[1], anchor: m[1].toLowerCase(), section, description: plainText(m[4]), url: `${ORIGIN}${m[2]}` })
    }
  }
  if (source === 'rich') {
    for (const c of chunks(markdown, [2])) {
      const entry = entries.find((e) => e.kind === 'prose' && e.name === c.title)
      if (entry) entry.description = c.text
    }
  }
  return entries
}

function parseEntry(markdown, entry) {
  const body = markdown.replace(/^# .+\n/, '').replace(/^> Part of .+\n/m, '').trim()
  const table = body.match(/^\|(?:Parameter|Field)\|.*\n\|[-:| ]+\|\n(?:\|.*(?:\n|$))*/m)
  const before = table ? body.slice(0, table.index).trim() : body
  const result = { ...entry, description: before }
  if (table) {
    const rows = table[0].trimEnd().split('\n').slice(2).map((line) => line.slice(1, -1).split(/(?<!\\)\|/).map(plainText))
    if (entry.kind === 'method' || table[0].split('\n')[0].includes('|Required|')) {
      result.params = rows.map(([name, type, req, description]) => ({ name, type, required: /^yes$/i.test(req), description }))
    } else {
      result.fields = rows.map(([name, type, description]) => ({ name, type, required: !/^Optional\./.test(description), description }))
    }
    const notes = body.slice(table.index + table[0].length).trim()
    if (notes) result.notes = notes
  } else if (entry.kind === 'method') result.params = []
  if (entry.kind === 'type' && !table) {
    const members = [...before.matchAll(/^[-*] \[([A-Za-z][A-Za-z0-9]*)\]\(\/bots\/api\/types\/[^)]+\.md\)[ \t]*$/gm)]
    if (members.length) {
      result.oneOf = members.map((m) => m[1])
      result.description = before.replace(/^[-*] \[[^\]]+\]\(\/bots\/api\/types\/[^)]+\.md\)[ \t]*(?:\n|$)/gm, '').trim()
    }
  }
  if (entry.kind === 'method') {
    const ret = plainText(before).replace(/\n/g, ' ').split(/(?<=\.)\s+/).filter((s) => /\breturn(s|ed)?\b/i.test(s))
    if (ret.length) result.returns = ret.join(' ')
  }
  return result
}

function parseChangelog(markdown) {
  return chunks(markdown).filter((c) => c.level === 4).map((c) => ({
    date: c.title, version: c.text.match(/\*\*Bot API ([\d.]+)\*\*/)?.[1] || null, anchor: c.anchor, text: plainText(c.text)
  }))
}

function parseFeatures(markdown) {
  return chunks(markdown).map((c) => ({ level: c.level, name: c.title, anchor: c.anchor, text: c.text }))
}

async function loadApi(opts, full = false) {
  const sources = ['api', 'types', 'rich', 'changelog']
  const documents = await catalogue(opts)
  const pages = await Promise.all(sources.map(async (key) => {
    if (opts.offline) return cachedPage(PAGES[key], opts)
    return loadPage(key, opts)
  }))
  const latest = parseChangelog(pages[3]?.body || '').find((c) => c.version)
  const entries = [...new Map(sources.slice(0, 3).flatMap((source, i) =>
    parseIndex(pages[i]?.body || '', source).map((e) => ({ ...e, provenance: pages[i].provenance }))
  ).map((e) => [`${e.kind}:${e.name.toLowerCase()}`, e])).values()]
  const knownUrls = new Set(entries.map((e) => e.url))
  for (const [url, document] of documents) {
    const path = new URL(url).pathname
    const pathKind = path.match(/^\/bots\/api\/(methods|types)\/[^/]+\.md$/)?.[1]
    const kind = pathKind === 'methods' ? 'method' : pathKind === 'types' ? 'type' :
      /^\/bots\/api\/[^/]+\.md$/.test(path) && !Object.values(PAGES).includes(url) ? 'prose' :
        url === PAGES.formatting ? 'prose' : null
    if (!kind || knownUrls.has(url)) continue
    const name = chunks(document.body, [1])[0]?.title || plainText(document.title || '')
    if (!name || (kind !== 'prose' && !/^[A-Za-z][A-Za-z0-9]*$/.test(name))) continue
    const existing = entries.find((entry) => entry.kind === kind && norm(entry.name) === norm(name))
    if (existing) {
      existing.url = url
      existing.provenance = documentWithFreshness(document, opts).provenance
      knownUrls.add(url)
      continue
    }
    entries.push({
      kind, name, anchor: anchor(name),
      section: 'Catalogue discoveries', description: '', url,
      provenance: documentWithFreshness(document, opts).provenance
    })
    knownUrls.add(url)
  }
  if (!pages.some(Boolean) && !entries.length) throw new Error('no cached Bot API indexes or entry pages available')
  const api = {
    version: latest?.version ?? null, date: latest?.date ?? null, entries,
    provenance: pages[3]?.provenance ?? null
  }
  if (full) {
    const unavailable = []
    let next = 0
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (next < entries.length) {
        const i = next++
        const url = entries[i].url || (entries[i].name === 'Formatting options' ? PAGES.formatting : null)
        if (opts.offline && url && !await cachedPage(url, opts)) {
          unavailable.push(entries[i].name)
          continue
        }
        entries[i] = await loadEntry(entries[i], { ...opts, preferCache: true })
      }
    }))
    if (unavailable.length) process.stderr.write(`warning: offline results have index-only coverage for uncached pages: ${unavailable.sort().join(', ')}\n`)
  }
  return api
}

async function loadEntry(entry, opts) {
  if (entry.url) {
    const document = await loadPage(entry.url, opts)
    const name = chunks(document.body, [1])[0]?.title || entry.name
    if (entry.kind === 'prose') return {
      ...entry, name, provenance: document.provenance,
      description: document.body.replace(/^# .+\n/, '').replace(/^> Part of .+\n/m, '').trim()
    }
    return parseEntry(document.body, { ...entry, name, provenance: document.provenance })
  }
  if (entry.name === 'Formatting options') {
    const document = await loadPage('formatting', opts)
    return {
      ...entry, provenance: document.provenance,
      description: document.body.replace(/^# .+\n/, '').replace(/^> Part of .+\n/m, '').trim()
    }
  }
  return entry
}

// ---------- lookup helpers ----------

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function findExact(entries, name) {
  const n = norm(name)
  return entries.find((e) => norm(e.name) === n || e.anchor === name.toLowerCase())
}

function score(entry, terms) {
  let total = 0
  const name = entry.name.toLowerCase()
  const desc = (entry.description || '').toLowerCase()
  const members = [...(entry.params || []), ...(entry.fields || [])]
  const hits = []
  for (const t of terms) {
    let s = 0
    if (name === t) s += 100
    else if (name.includes(t)) s += 40
    for (const m of members) {
      if (m.name.toLowerCase().includes(t)) { s += 15; hits.push(m.name) }
      else if (m.description.toLowerCase().includes(t)) { s += 3; hits.push(m.name) }
    }
    if (desc.includes(t)) s += 8
    if (!s) return { score: 0, hits: [] }
    total += s
  }
  return { score: total, hits: [...new Set(hits)] }
}

function suggest(entries, name) {
  const n = norm(name)
  return entries
    .filter((e) => e.kind !== 'section')
    .map((e) => ({ e, d: levenshtein(norm(e.name), n) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map((x) => x.e.name)
}

function levenshtein(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}

function typeMentions(typeStr, name) {
  return new RegExp(`(^|[^A-Za-z0-9])${name}([^A-Za-z0-9]|$)`).test(typeStr)
}

// ---------- rendering ----------

function link(entry) {
  return entry.url || `${PAGES.api}#${entry.anchor}`
}

function renderProvenance(provenance) {
  if (!provenance) return 'source: unknown; freshness: unknown'
  const { url, hash, source, checkedAt, fetchedAt, freshness } = provenance
  return `source: ${url} (${source})\nsha256: ${hash}\ncheckedAt: ${checkedAt || 'unknown'}; fetchedAt: ${fetchedAt || 'unknown'}; freshness: ${freshness}`
}

function renderEntry(e, brief) {
  const lines = [`## ${e.name}  (${e.kind}, section "${e.section}")`, link(e), renderProvenance(e.provenance), '']
  if (e.description) lines.push(e.description, '')
  if (e.oneOf) lines.push('one of:', ...e.oneOf.map((x) => `  - ${x}`), '')
  if (e.params) {
    if (!e.params.length) lines.push('parameters: none', '')
    else {
      lines.push('parameters:')
      for (const p of e.params) {
        lines.push(`  ${p.name}: ${p.type}${p.required ? '  (required)' : ''}`)
        if (!brief && p.description) lines.push(`      ${p.description}`)
      }
      lines.push('')
    }
  }
  if (e.fields) {
    lines.push('fields:')
    for (const f of e.fields) {
      lines.push(`  ${f.name}: ${f.type}${f.required ? '' : '  (optional)'}`)
      if (!brief && f.description) lines.push(`      ${f.description.replace(/^Optional\.\s*/, '')}`)
    }
    lines.push('')
  }
  if (e.notes) lines.push(e.notes, '')
  return lines.join('\n')
}

function out(opts, data, text) {
  if (opts.json) process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  else process.stdout.write(text.replace(/\n*$/, '\n'))
}

// ---------- commands ----------

async function cmdGet(names, opts) {
  const api = await loadApi(opts)
  const found = []
  const texts = []
  let missing = false
  for (const name of names) {
    const match = findExact(api.entries, name)
    const e = match ? await loadEntry(match, opts) : null
    if (e) {
      found.push(e)
      texts.push(renderEntry(e, opts.brief))
    } else {
      missing = true
      const s = suggest(api.entries, name)
      found.push({ name, error: 'not found', didYouMean: s })
      texts.push(`## ${name}: not found in bot api ${api.version}. did you mean: ${s.join(', ')}?\n(try: botapi.mjs search ${name})`)
    }
  }
  out(opts, { version: api.version, provenance: api.provenance, results: found },
    `bot api ${api.version ?? 'unknown'}\n${renderProvenance(api.provenance)}\n\n` + texts.join('\n\n'))
  if (missing) process.exitCode = 1
}

async function cmdSearch(words, opts) {
  if (!words.length) throw new Error('search needs at least one word')
  const api = await loadApi(opts, true)
  const terms = words.map((w) => w.toLowerCase())
  const ranked = api.entries
    .map((e) => ({ e, ...score(e, terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40)
  const text = ranked.length
    ? ranked.map(({ e, hits }) => {
        const first = (e.description || '').split('\n')[0].slice(0, 140)
        const h = hits.length ? `\n      matches: ${hits.slice(0, 8).join(', ')}${hits.length > 8 ? ', …' : ''}` : ''
        return `  ${e.name.padEnd(36)} ${e.kind.padEnd(7)} ${first}${h}\n${renderProvenance(e.provenance)}`
      }).join('\n')
    : '  no matches'
  out(opts, ranked.map(({ e, score, hits }) => ({ name: e.name, kind: e.kind, section: e.section, score, matches: hits, anchor: link(e), provenance: e.provenance })),
    `bot api ${api.version} — search: ${words.join(' ')}\n\n${text}`)
}

async function cmdRefs(name, opts) {
  const api = await loadApi(opts, true)
  const target = findExact(api.entries, name)
  const n = target ? target.name : name
  const refs = []
  for (const e of api.entries) {
    for (const m of [...(e.params || []), ...(e.fields || [])]) {
      if (typeMentions(m.type, n)) refs.push({ in: e.name, kind: e.kind, member: m.name, type: m.type, provenance: e.provenance })
    }
    if (e.oneOf?.includes(n)) refs.push({ in: e.name, kind: 'union', member: '(member of)', type: e.name, provenance: e.provenance })
    if (e.returns && typeMentions(e.returns, n)) refs.push({ in: e.name, kind: e.kind, member: '(returns)', type: e.returns, provenance: e.provenance })
  }
  const text = refs.length
    ? refs.map((r) => `  ${r.in}.${r.member}: ${r.type}\n${renderProvenance(r.provenance)}`).join('\n')
    : '  no references'
  out(opts, { name: n, refs }, `bot api ${api.version} — references to ${n}\n\n${text}`)
}

async function cmdList(what, opts) {
  const api = await loadApi(opts)
  const kinds = { methods: 'method', types: 'type', prose: 'prose', sections: 'section' }
  let list = api.entries
  if (what) {
    if (!kinds[what]) throw new Error(`list: expected one of ${Object.keys(kinds).join(', ')}`)
    list = list.filter((e) => e.kind === kinds[what])
  } else list = list.filter((e) => e.kind !== 'section')
  if (opts.section) list = list.filter((e) => norm(e.section) === norm(opts.section))
  const bySection = new Map()
  for (const e of list) {
    if (!bySection.has(e.section)) bySection.set(e.section, [])
    bySection.get(e.section).push(`${e.kind === 'method' || e.kind === 'type' ? e.name : `"${e.name}"`}\n${renderProvenance(e.provenance)}`)
  }
  const text = [...bySection].map(([s, names]) => `### ${s} (${names.length})\n${names.join(', ')}`).join('\n\n')
  out(opts, list.map((e) => ({ name: e.name, kind: e.kind, section: e.section, provenance: e.provenance })), `bot api ${api.version}\n\n${text}`)
}

function cmpVersion(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

async function cmdChangelog(opts) {
  const document = await loadPage('changelog', opts)
  let log = parseChangelog(document.body).filter((x) => x.version).map((x) => ({ ...x, provenance: document.provenance }))
  if (opts.since) log = log.filter((x) => cmpVersion(x.version, opts.since) >= 0)
  if (opts.grep) {
    const re = new RegExp(opts.grep, 'i')
    log = log
      .map((x) => ({ ...x, text: x.text.split('\n').filter((l) => re.test(l)).join('\n') }))
      .filter((x) => x.text)
  }
  if (opts.last || (!opts.since && !opts.grep)) log = log.slice(0, opts.last || 1)
  out(opts, log, log.map((x) => `## ${x.date} — Bot API ${x.version}\n${renderProvenance(x.provenance)}\n\n${x.text}`).join('\n\n'))
}

async function cmdFeatures(heading, opts) {
  const document = await loadPage('features', opts)
  const sections = parseFeatures(document.body).map((s) => ({ ...s, provenance: document.provenance }))
  if (!heading) {
    out(opts, sections.map(({ level, name, provenance }) => ({ level, name, provenance })),
      `${renderProvenance(document.provenance)}\n\n` + sections.map((s) => `${s.level === 4 ? '    ' : ''}${s.name}`).join('\n'))
    return
  }
  const i = sections.findIndex((s) => norm(s.name) === norm(heading))
  if (i < 0) {
    process.exitCode = 1
    out(opts, { error: 'not found' }, `no features section "${heading}". run without an argument to list headings.`)
    return
  }
  // an h3 includes its h4 children
  const picked = [sections[i]]
  if (sections[i].level === 3) for (let j = i + 1; j < sections.length && sections[j].level === 4; j++) picked.push(sections[j])
  out(opts, picked, picked.map((s) => `${'#'.repeat(s.level)} ${s.name}\n${PAGES.features}#${s.anchor}\n${renderProvenance(s.provenance)}\n\n${s.text}`).join('\n\n'))
}

async function cmdVersion(opts) {
  const api = await loadApi(opts)
  const counts = { methods: 0, types: 0 }
  for (const e of api.entries) {
    if (e.kind === 'method') counts.methods++
    if (e.kind === 'type') counts.types++
  }
  out(opts, { version: api.version, date: api.date, ...counts, provenance: api.provenance },
    `bot api ${api.version} (${api.date}) — ${counts.methods} methods, ${counts.types} types\n${renderProvenance(api.provenance)}`)
}

// ---------- main ----------

const { opts, rest } = parseArgs(process.argv.slice(2))
const [cmd, ...args] = rest

try {
  if (opts.help || !cmd) process.stdout.write(HELP)
  else if (cmd === 'get') await cmdGet(args, opts)
  else if (cmd === 'search') await cmdSearch(args, opts)
  else if (cmd === 'refs') await cmdRefs(args.join(' '), opts)
  else if (cmd === 'list') await cmdList(args[0], opts)
  else if (cmd === 'changelog') await cmdChangelog(opts)
  else if (cmd === 'features') await cmdFeatures(args.join(' '), opts)
  else if (cmd === 'version') await cmdVersion(opts)
  else await cmdGet(rest.length > 1 && rest.every((r) => /^[A-Za-z0-9]+$/.test(r)) ? rest : [rest.join(' ')], opts)
} catch (err) {
  process.stderr.write(`error: ${err.message}\n`)
  process.exitCode = 2
}
