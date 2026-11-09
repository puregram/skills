import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const ORIGIN = 'https://core.telegram.org'
export const DEFAULT_TTL = 6
const MAX_BODY = 8 * 1024 * 1024

export function databasePath(cacheDir = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'telegram-core-docs'), { ignoreOverride = false } = {}) {
  if (!ignoreOverride && process.env.TG_CORE_DOCS_DB) return process.env.TG_CORE_DOCS_DB
  try {
    const pointerFile = join(cacheDir, 'current.json')
    if (lstatSync(pointerFile).size > 64 * 1024) throw new Error('invalid catalogue pointer')
    const pointer = JSON.parse(readFileSync(pointerFile, 'utf8'))
    const manifest = pointer.manifest
    if (pointer.schemaVersion !== 1 || !/^[0-9a-f]{64}$/.test(manifest?.sha256) ||
      manifest.schemaVersion !== 1 || manifest.repository !== 'puregram/skills' ||
      manifest.source !== ORIGIN + '/' || manifest.complete !== true ||
      !Number.isFinite(Date.parse(manifest.generatedAt)) ||
      typeof pointer.database !== 'string' ||
      !new RegExp(`^catalogue-${manifest.sha256}-[0-9a-f-]{36}\\.sqlite$`).test(pointer.database)) throw new Error('invalid catalogue pointer')
    const path = join(cacheDir, pointer.database)
    if (!lstatSync(path).isFile() || dirname(realpathSync(path)) !== realpathSync(resolve(cacheDir))) throw new Error('invalid catalogue generation')
    return path
  } catch {
    return join(cacheDir, 'catalogue.sqlite')
  }
}

export function canonicalUrl(input, base = ORIGIN + '/') {
  const url = new URL(input, base)
  if (url.origin !== ORIGIN || url.username || url.password || (url.pathname !== '/' && !url.pathname.endsWith('.md'))) {
    throw new Error('expected an HTTPS core.telegram.org Markdown URL: ' + input)
  }
  url.search = ''
  url.hash = ''
  return url.href
}

export function pageUrl(input) {
  const url = new URL(input, ORIGIN + '/')
  if (url.pathname !== '/' && !url.pathname.endsWith('.md')) url.pathname = url.pathname.replace(/\/$/, '') + '.md'
  return canonicalUrl(url.href)
}

export function plainText(text) {
  return text.replace(/\[([^\]]+)\]\([^\n)]+\)/g, '$1').replace(/<[^>]+>/g, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1').replace(/`([^`\n]+)`/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()
}

function areaFor(url) {
  const path = new URL(url).pathname
  if (path === '/bots/api.md' || path === '/bots/api-changelog.md' || path.startsWith('/bots/api/')) return 'bot-api'
  if (path === '/bots.md' || path.startsWith('/bots/')) return 'bots'
  if (path.startsWith('/tdlib')) return 'tdlib'
  if (path.startsWith('/gateway')) return 'gateway'
  if (/^\/(?:api|mtproto|method|methods|constructor|constructors|type|types|schema)(?:[/.]|$)/.test(path)) return 'mtproto'
  return 'other'
}

export function parseMarkdown(body, url) {
  const lines = body.split('\n')
  const sections = []
  const visible = []
  const anchors = new Map()
  let fence = null
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && /^ {0,3}(?:`+|~+)\s*$/.test(line)) fence = null
      continue
    }
    if (fence) continue
    visible.push(line)
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/)
    if (!heading) continue
    const title = plainText(heading[2])
    const base = title.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-')
    const count = (anchors.get(base) || 0) + 1
    anchors.set(base, count)
    sections.push({ heading: title, anchor: base + (count > 1 ? '-' + count : ''), level: heading[1].length, startLine: index + 1 })
  }
  const title = sections.find(section => section.level === 1)?.heading
  if (!title) throw new Error('Markdown page has no top-level heading: ' + url)
  const parents = []
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index]
    section.endLine = lines.length
    while (parents.length && parents[parents.length - 1].level >= section.level) parents.pop().endLine = section.startLine - 1
    parents.push(section)
    section.body = lines.slice(section.startLine, (sections[index + 1]?.startLine ?? lines.length + 1) - 1).join('\n').trim()
  }
  const text = visible.join('\n')
  const references = new Map([...text.matchAll(/^ {0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+["'(].*)?$/gm)].map(match => [match[1].trim().toLowerCase(), match[2]]))
  const links = new Map()
  const add = (label, href) => {
    try {
      const target = new URL(href.replace(/&amp;/g, '&'), url)
      const fragment = target.hash
      const canonical = canonicalUrl(target.href) + fragment
      if (!links.has(canonical)) links.set(canonical, { text: plainText(label), url: canonical })
    } catch {}
  }
  for (const match of text.matchAll(/(?<!!)\[([^\]\n]+)\]\((<?[^\s)]+>?)(?:\s+["'][^\n]*["'])?\)/g)) add(match[1], match[2].replace(/^<|>$/g, ''))
  for (const match of text.matchAll(/(?<!!)\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    const href = references.get((match[2] || match[1]).trim().toLowerCase())
    if (href) add(match[1], href)
  }
  for (const match of text.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) add(match[2], match[1])
  return { title, sections, links: [...links.values()] }
}

export function provenance(document, ttl = DEFAULT_TTL) {
  return {
    url: document.url, hash: document.hash, source: document.source,
    checkedAt: document.checkedAt, fetchedAt: document.fetchedAt,
    stale: document.stale === true || !document.checkedAt || Date.now() - Date.parse(document.checkedAt) > ttl * 3_600_000,
    ...(document.warning ? { warning: document.warning } : {})
  }
}

async function responseText(response) {
  if (!response.body) throw new Error('empty Markdown response')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY) throw new Error('Markdown response exceeds 8 MiB')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  return Buffer.concat(chunks).toString('utf8')
}

export class Catalogue {
  constructor(path = databasePath(), { fetcher = fetch } = {}) {
    this.path = path
    this.fetcher = fetcher
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (
        url TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL,
        checked_at TEXT, fetched_at TEXT, source TEXT NOT NULL, etag TEXT, last_modified TEXT, area TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sections (
        id INTEGER PRIMARY KEY, url TEXT NOT NULL REFERENCES documents(url) ON DELETE CASCADE,
        heading TEXT NOT NULL, anchor TEXT NOT NULL, level INTEGER NOT NULL,
        start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sections_url ON sections(url);
      CREATE VIRTUAL TABLE IF NOT EXISTS section_search USING fts5(url UNINDEXED, title, heading, body, tokenize='porter unicode61');
    `)
    this.statements = {
      get: this.db.prepare('SELECT * FROM documents WHERE url=?'),
      update: this.db.prepare('INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(url) DO UPDATE SET title=excluded.title,body=excluded.body,hash=excluded.hash,checked_at=excluded.checked_at,fetched_at=excluded.fetched_at,source=excluded.source,etag=excluded.etag,last_modified=excluded.last_modified,area=excluded.area'),
      clearSearch: this.db.prepare('DELETE FROM section_search WHERE rowid IN (SELECT id FROM sections WHERE url=?)'),
      clearSections: this.db.prepare('DELETE FROM sections WHERE url=?'),
      section: this.db.prepare('INSERT INTO sections (url,heading,anchor,level,start_line,end_line,body) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      search: this.db.prepare('INSERT INTO section_search (rowid,url,title,heading,body) VALUES (?, ?, ?, ?, ?)')
    }
  }

  get(url) {
    const row = this.statements.get.get(canonicalUrl(url))
    if (!row) return null
    return { url: row.url, title: row.title, body: row.body, hash: row.hash, checkedAt: row.checked_at, fetchedAt: row.fetched_at, source: row.source, etag: row.etag, lastModified: row.last_modified, area: row.area }
  }

  replace(document) {
    const url = canonicalUrl(document.url)
    const old = this.get(url)
    const checkedAt = document.checkedAt && Number.isFinite(Date.parse(document.checkedAt)) ? new Date(document.checkedAt).toISOString() : null
    if (old?.checkedAt && (!checkedAt || Date.parse(old.checkedAt) > Date.parse(checkedAt))) return false
    const hash = createHash('sha256').update(document.body).digest('hex')
    if (document.hash && document.hash !== hash) throw new Error('content hash mismatch: ' + url)
    const parsed = old?.hash === hash ? null : parseMarkdown(document.body, url)
    const fetchedAt = document.fetchedAt ?? (old?.hash === hash ? old.fetchedAt : null)
    this.statements.update.run(url, parsed?.title ?? old.title, document.body, hash, checkedAt, fetchedAt, document.source, document.etag ?? null, document.lastModified ?? null, areaFor(url))
    if (old?.hash === hash) return true
    this.statements.clearSearch.run(url)
    this.statements.clearSections.run(url)
    for (const section of parsed.sections) {
      const inserted = this.statements.section.run(url, section.heading, section.anchor, section.level, section.startLine, section.endLine, section.body)
      this.statements.search.run(inserted.lastInsertRowid, url, parsed.title, section.heading, section.body)
    }
    return true
  }

  put(document) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const changed = this.replace(document)
      this.db.exec('COMMIT')
      return changed
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  importTracker(path) {
    const source = new DatabaseSync(path, { readOnly: true })
    source.exec('BEGIN')
    let imported = 0
    let kept = 0
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const rawTime = source.prepare('SELECT value FROM meta WHERE key=?').get('last_scan')?.value
      const checkedAt = rawTime && Number.isFinite(Date.parse(rawTime)) ? new Date(rawTime).toISOString() : null
      const rows = source.prepare('SELECT url,body,hash,etag,modified FROM pages WHERE body IS NOT NULL AND error IS NULL AND removed=0')
      for (const row of rows.iterate()) {
        const changed = this.replace({ url: row.url, body: row.body, hash: row.hash, checkedAt, fetchedAt: null, source: 'tracker snapshot', etag: row.etag, lastModified: row.modified })
        if (changed) imported++
        else kept++
      }
      const importedAt = new Date().toISOString()
      this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)').run('last_import_at', importedAt)
      this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)').run('snapshot_checked_at', checkedAt || 'unknown')
      this.db.exec('COMMIT')
      return { imported, keptNewer: kept, importedAt, snapshotCheckedAt: checkedAt }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    } finally {
      source.close()
    }
  }

  sections(url) {
    return this.db.prepare('SELECT heading,anchor,level,start_line AS startLine,end_line AS endLine FROM sections WHERE url=? ORDER BY start_line').all(canonicalUrl(url))
  }

  section(document, selector) {
    const sections = this.sections(document.url)
    const target = selector.replace(/^#/, '').toLowerCase()
    const exactAnchor = sections.find(section => section.anchor.toLowerCase() === target)
    const matches = exactAnchor ? [exactAnchor] : sections.filter(section => section.heading.toLowerCase() === target)
    if (matches.length !== 1) {
      throw new Error(matches.length ? 'ambiguous section; use an anchor from the sections command' : 'section not found; use the sections command: ' + selector)
    }
    const section = matches[0]
    return { ...section, text: document.body.split('\n').slice(section.startLine - 1, section.endLine).join('\n'), url: document.url + '#' + section.anchor }
  }

  search(query, { area = 'all', limit = 10, offset = 0, ttl = DEFAULT_TTL } = {}) {
    const terms = query.trim().split(/\s+/).filter(term => /[\p{L}\p{N}]/u.test(term))
    if (!terms.length) throw new Error('search needs at least one word or symbol name')
    const match = terms.map(term => '"' + term.replaceAll('"', '""') + '"').join(' AND ')
    const key = terms.join('').replace(/[_.-]/g, '').toLowerCase()
    if (!['all', 'bot-api', 'bots', 'mtproto', 'tdlib', 'gateway', 'other'].includes(area)) throw new Error('unknown documentation area: ' + area)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be between 1 and 100')
    if (!Number.isInteger(offset) || offset < 0) throw new Error('offset must be a nonnegative integer')
    const filter = area === 'all' ? '' : area === 'bots' ? " AND d.area IN ('bots','bot-api')" : ' AND d.area=?'
    const sql = `SELECT s.url,s.heading,s.anchor,s.start_line AS line,d.title,d.hash,d.checked_at,d.fetched_at,d.source,d.area,
      snippet(section_search,3,'','',' … ',32) AS excerpt,bm25(section_search,0,7,10,1) AS rank
      FROM section_search JOIN sections s ON s.id=section_search.rowid JOIN documents d ON d.url=s.url
      WHERE section_search MATCH ?${filter}
      ORDER BY CASE
        WHEN lower(replace(replace(replace(replace(s.heading,' ',''),'_',''),'.',''),'-',''))=? THEN 0
        WHEN lower(replace(replace(replace(replace(d.title,' ',''),'_',''),'.',''),'-',''))=? THEN 1
        ELSE 2 END,rank,s.url,s.start_line LIMIT ? OFFSET ?`
    const params = area === 'all' || area === 'bots' ? [match, key, key, limit, offset] : [match, area, key, key, limit, offset]
    return this.db.prepare(sql).all(...params).map(row => ({
      title: row.title, heading: row.heading, url: row.url + '#' + row.anchor, pageUrl: row.url, line: row.line,
      excerpt: row.excerpt || row.heading, score: -row.rank, area: row.area,
      provenance: provenance({ url: row.url, hash: row.hash, checkedAt: row.checked_at, fetchedAt: row.fetched_at, source: row.source }, ttl)
    }))
  }

  stats() {
    return {
      database: this.path,
      documents: this.db.prepare('SELECT COUNT(*) AS count FROM documents').get().count,
      sections: this.db.prepare('SELECT COUNT(*) AS count FROM sections').get().count,
      areas: this.db.prepare('SELECT area,COUNT(*) AS count FROM documents GROUP BY area ORDER BY area').all(),
      latestCheckedAt: this.db.prepare('SELECT MAX(checked_at) AS time FROM documents').get().time,
      importedAt: this.db.prepare('SELECT value FROM meta WHERE key=?').get('last_import_at')?.value ?? null
    }
  }

  async load(input, { offline = false, refresh = false, ttl = DEFAULT_TTL } = {}) {
    if (offline && refresh) throw new Error('--offline and --refresh cannot be combined')
    const url = canonicalUrl(input)
    const cached = this.get(url)
    if (offline) {
      if (!cached) throw new Error('no offline copy of ' + url + '; read it online or import a tracker snapshot first')
      return cached
    }
    if (cached && !refresh && !provenance(cached, ttl).stale) return cached
    try {
      let target = url
      const headers = { accept: 'text/markdown', 'user-agent': 'telegram-core-docs-skill/1.0' }
      if (cached?.etag) headers['if-none-match'] = cached.etag
      if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified
      for (let redirect = 0; redirect <= 5; redirect++) {
        const response = await this.fetcher(target, { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location')
          await response.body?.cancel()
          if (!location) throw new Error('redirect without a location')
          target = canonicalUrl(new URL(location, target).href)
          continue
        }
        const checkedAt = new Date().toISOString()
        if (response.status === 304 && cached) {
          await response.body?.cancel()
          this.put({ ...cached, checkedAt })
          return this.get(url)
        }
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error('HTTP ' + response.status + ' for ' + target)
        }
        if (!response.headers.get('content-type')?.includes('text/markdown')) {
          await response.body?.cancel()
          throw new Error('unexpected content type for ' + target)
        }
        const body = await responseText(response)
        this.put({ url: target, body, checkedAt, fetchedAt: checkedAt, source: 'live', etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') })
        return this.get(target)
      }
      throw new Error('too many redirects')
    } catch (error) {
      if (!cached) throw error
      return { ...cached, stale: true, warning: error.message }
    }
  }

  close() {
    this.db.close()
  }
}
