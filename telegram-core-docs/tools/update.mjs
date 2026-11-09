import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gunzipSync } from 'node:zlib'

import { Catalogue, ORIGIN, canonicalUrl, databasePath, parseMarkdown } from './catalogue.mjs'

export const MANIFEST_URL = 'https://github.com/puregram/skills/releases/download/docs-catalogue/catalogue.json'
export const MAX_COMPRESSED_BYTES = 32 * 1024 * 1024
export const MAX_DATABASE_BYTES = 128 * 1024 * 1024
const CHECK_INTERVAL = 3_600_000
const RELEASE_BASE = 'https://github.com/puregram/skills/releases/download/docs-catalogue/'
const CDN_HOSTS = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'])
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const isoTime = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value))
const cacheRoot = () => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'telegram-core-docs')

export function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 ||
    value.repository !== 'puregram/skills' || value.source !== ORIGIN + '/' || value.complete !== true ||
    !isoTime(value.generatedAt) || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value.revision) ||
    !/^[0-9a-f]{64}$/.test(value.sha256) || !/^[0-9a-f]{64}$/.test(value.databaseSha256) ||
    value.asset !== `catalogue-${value.sha256}.sqlite.gz` ||
    !Number.isSafeInteger(value.documents) || value.documents < 0 || !Number.isSafeInteger(value.sections) || value.sections < 0 ||
    !Number.isSafeInteger(value.compressedBytes) || value.compressedBytes < 1 || value.compressedBytes > MAX_COMPRESSED_BYTES ||
    !Number.isSafeInteger(value.databaseBytes) || value.databaseBytes < 512 || value.databaseBytes > MAX_DATABASE_BYTES ||
    !Array.isArray(value.reviewNeeded) || value.reviewNeeded.some(path => typeof path !== 'string' ||
      !/^[a-z0-9][a-z0-9-]*(?:\/[A-Za-z0-9._-]+)*$/.test(path) || path.split('/').some(part => part === '.' || part === '..'))) {
    throw new Error('invalid release catalogue manifest')
  }
  return value
}

function readJson(path) {
  try {
    if (lstatSync(path).size > 64 * 1024) return null
    const bytes = readFileSync(path)
    if (bytes.length > 64 * 1024) return null
    return JSON.parse(bytes.toString('utf8'))
  } catch { return null }
}

function currentPointer(cacheDir) {
  const pointer = readJson(join(cacheDir, 'current.json'))
  try {
    validateManifest(pointer?.manifest)
    if (pointer.schemaVersion !== 1 || databasePath(cacheDir, { ignoreOverride: true }) !== join(cacheDir, pointer.database)) return null
    return pointer
  } catch { return null }
}

function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  let fd
  try {
    fd = openSync(temporary, 'wx', 0o600)
    writeFileSync(fd, JSON.stringify(value, null, 2) + '\n')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temporary, path)
    if (process.platform !== 'win32') {
      const directory = openSync(dirname(path), 'r')
      try { fsyncSync(directory) } finally { closeSync(directory) }
    }
  } finally {
    if (fd !== undefined) closeSync(fd)
    rmSync(temporary, { force: true })
  }
}

function downloadUrl(value, initial) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
    (url.href !== initial && !CDN_HOSTS.has(url.hostname))) throw new Error('unsafe catalogue download redirect')
  return url.href
}

async function download(url, maximum, fetcher) {
  let target = url
  const signal = AbortSignal.timeout(30_000)
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetcher(downloadUrl(target, url), {
      redirect: 'manual', signal,
      headers: { accept: 'application/octet-stream, application/json', 'user-agent': 'telegram-core-docs-skill/1.0' }
    })
    if (response.url && response.url !== target) {
      await response.body?.cancel()
      throw new Error('unexpected automatically followed catalogue redirect')
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new Error('catalogue redirect without a location')
      target = downloadUrl(new URL(location, target).href, url)
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      const error = new Error(`HTTP ${response.status} for ${url}`)
      error.status = response.status
      error.resource = url === MANIFEST_URL ? 'manifest' : 'asset'
      throw error
    }
    if (Number(response.headers.get('content-length')) > maximum) {
      await response.body?.cancel()
      throw new Error('catalogue response exceeds size limit')
    }
    if (!response.body) throw new Error('empty catalogue response')
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maximum) throw new Error('catalogue response exceeds size limit')
        chunks.push(value)
      }
    } finally {
      await reader.cancel()
    }
    return Buffer.concat(chunks, size)
  }
  throw new Error('too many catalogue redirects')
}

let schema
function expectedSchema() {
  if (!schema) {
    const catalogue = new Catalogue(':memory:')
    try { schema = schemaRows(catalogue.db) } finally { catalogue.close() }
  }
  return schema
}

function schemaRows(db) {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(row => [row.type, row.name, row.tbl_name, row.sql?.replace(/\s+/g, ' ').trim()])
}

export function validateDatabase(path, manifest) {
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON')
    if (JSON.stringify(schemaRows(db)) !== JSON.stringify(expectedSchema())) throw new Error('unexpected catalogue SQLite schema')
    const integrity = db.prepare('PRAGMA integrity_check').all()
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) {
      throw new Error('catalogue SQLite integrity check failed')
    }
    db.prepare("INSERT INTO section_search(section_search) VALUES ('integrity-check')").run()
    const documents = db.prepare('SELECT COUNT(*) AS count FROM documents').get().count
    const sections = db.prepare('SELECT COUNT(*) AS count FROM sections').get().count
    if (documents !== manifest.documents || sections !== manifest.sections ||
      db.prepare('SELECT COUNT(*) AS count FROM section_search').get().count !== sections) throw new Error('catalogue row count mismatch')
    const indexed = db.prepare(`SELECT COUNT(*) AS count FROM sections s JOIN documents d ON d.url=s.url
      JOIN section_search f ON f.rowid=s.id WHERE f.url=s.url AND f.title=d.title AND f.heading=s.heading AND f.body=s.body`).get().count
    if (indexed !== sections) throw new Error('catalogue search index mismatch')
    const sectionRows = db.prepare('SELECT heading,anchor,level,start_line,end_line,body FROM sections WHERE url=? ORDER BY start_line')
    for (const row of db.prepare('SELECT * FROM documents').iterate()) {
      if (canonicalUrl(row.url) !== row.url || typeof row.body !== 'string' || digest(row.body) !== row.hash ||
        !['live', 'tracker snapshot'].includes(row.source) || !['bot-api', 'bots', 'mtproto', 'tdlib', 'gateway', 'other'].includes(row.area) ||
        (row.checked_at !== null && !isoTime(row.checked_at)) || (row.fetched_at !== null && !isoTime(row.fetched_at))) {
        throw new Error('invalid official catalogue document: ' + row.url)
      }
      const parsed = parseMarkdown(row.body, row.url)
      const actual = sectionRows.all(row.url).map(section => [section.heading, section.anchor, section.level, section.start_line, section.end_line, section.body])
      const expected = parsed.sections.map(section => [section.heading, section.anchor, section.level, section.startLine, section.endLine, section.body])
      if (row.title !== parsed.title || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('catalogue section mismatch: ' + row.url)
    }
    return { documents, sections }
  } finally { db.close() }
}

function promote(path, cacheDir, manifest, selectedPath) {
  let local
  let destination
  let mergedDocuments = 0
  try {
    if (existsSync(selectedPath)) {
      local = new DatabaseSync(selectedPath)
      local.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE')
    }
    destination = new Catalogue(path)
    destination.db.exec('BEGIN IMMEDIATE')
    try {
      if (local) {
        for (const row of local.prepare("SELECT * FROM documents WHERE source='live'").iterate()) {
          if (!isoTime(row.checked_at)) continue
          const remote = destination.get(row.url)
          const cutoff = remote ? (remote.checkedAt === null ? -Infinity : Date.parse(remote.checkedAt)) : Date.parse(manifest.generatedAt)
          if (Date.parse(row.checked_at) <= cutoff) continue
          if (destination.replace({ url: row.url, body: row.body, hash: row.hash, checkedAt: row.checked_at,
            fetchedAt: row.fetched_at, source: row.source, etag: row.etag, lastModified: row.last_modified })) mergedDocuments++
        }
      }
      destination.db.exec('COMMIT')
    } catch (error) {
      destination.db.exec('ROLLBACK')
      throw error
    }
    destination.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE')
    destination.close()
    destination = undefined
    const database = `catalogue-${manifest.sha256}-${randomUUID()}.sqlite`
    const target = join(cacheDir, database)
    renameSync(path, target)
    const fd = openSync(target, 'r')
    try { fsyncSync(fd) } finally { closeSync(fd) }
    const pointer = { schemaVersion: 1, database, installedAt: new Date().toISOString(), manifest, mergedDocuments }
    atomicJson(join(cacheDir, 'current.json'), pointer)
    return pointer
  } finally {
    destination?.close()
    if (local) {
      try { local.exec('ROLLBACK') } finally { local.close() }
    }
  }
}

async function synchronize({ force = false, offline = false, fetcher = globalThis.fetch, cacheDir = cacheRoot(), db,
  enabled = process.env.TG_CORE_DOCS_AUTO_UPDATE !== '0', privateCache = false } = {}) {
  const selected = () => db || databasePath(cacheDir, { ignoreOverride: privateCache })
  const result = (status, extra = {}) => {
    const pointer = currentPointer(cacheDir)
    return { status, databasePath: selected(), manifest: pointer?.manifest ?? null,
      installedAt: pointer?.installedAt ?? null, mergedDocuments: pointer?.mergedDocuments ?? 0,
      lastAttempt: readJson(join(cacheDir, 'update.json')), ...extra }
  }
  if (!privateCache && (db !== undefined || process.env.TG_CORE_DOCS_DB)) return result('custom')
  if (offline) return result('offline')
  if (!force && !enabled) return result('disabled')
  let lock
  let temporary
  let state
  try {
    mkdirSync(cacheDir, { recursive: true, mode: 0o700 })
    lock = new DatabaseSync(join(cacheDir, 'update-lock.sqlite'))
    try {
      lock.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE')
    } catch (error) {
      if (error.errcode === 5 || /locked|busy/i.test(error.message)) return result('busy')
      throw error
    }
    state = readJson(join(cacheDir, 'update.json'))
    const age = Date.now() - Date.parse(state?.attemptedAt)
    if (!force && state?.schemaVersion === 1 && age >= 0 && age < CHECK_INTERVAL) {
      return result('cached', { lastAttempt: state, ...(state.status === 'failed' ? {
        error: state.error, ...(state.httpStatus ? { httpStatus: state.httpStatus, resource: state.resource, missing: state.missing } : {})
      } : {}) })
    }
    state = { schemaVersion: 1, attemptedAt: new Date().toISOString(), status: 'checking' }
    atomicJson(join(cacheDir, 'update.json'), state)
    const manifest = validateManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await download(MANIFEST_URL, 64 * 1024, fetcher))))
    const pointer = currentPointer(cacheDir)
    if (pointer && (Date.parse(manifest.generatedAt) < Date.parse(pointer.manifest.generatedAt) ||
      (Date.parse(manifest.generatedAt) === Date.parse(pointer.manifest.generatedAt) && manifest.sha256 !== pointer.manifest.sha256))) {
      throw new Error('refusing an older or conflicting catalogue release')
    }
    if (pointer?.manifest.sha256 === manifest.sha256 &&
      ['databaseSha256', 'compressedBytes', 'databaseBytes', 'documents', 'sections'].some(key => pointer.manifest[key] !== manifest[key])) {
      throw new Error('conflicting metadata for an immutable catalogue asset')
    }
    let status = 'current'
    let installed = pointer
    if (!pointer || pointer.manifest.sha256 !== manifest.sha256) {
      const compressed = await download(RELEASE_BASE + manifest.asset, manifest.compressedBytes, fetcher)
      if (compressed.length !== manifest.compressedBytes || digest(compressed) !== manifest.sha256) throw new Error('compressed catalogue size or SHA-256 mismatch')
      const bytes = gunzipSync(compressed, { maxOutputLength: MAX_DATABASE_BYTES })
      if (bytes.length !== manifest.databaseBytes || digest(bytes) !== manifest.databaseSha256 ||
        !bytes.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) throw new Error('catalogue database size, SHA-256 or header mismatch')
      temporary = join(cacheDir, `.download-${randomUUID()}.sqlite`)
      writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 })
      validateDatabase(temporary, manifest)
      installed = promote(temporary, cacheDir, manifest, selected())
      temporary = undefined
      status = 'updated'
    }
    if (pointer && pointer.manifest.sha256 === manifest.sha256 && pointer.manifest.generatedAt !== manifest.generatedAt) {
      installed = { ...pointer, manifest }
      atomicJson(join(cacheDir, 'current.json'), installed)
    }
    state = { ...state, status, checkedAt: new Date().toISOString(), manifest }
    atomicJson(join(cacheDir, 'update.json'), state)
    return result(status, { lastAttempt: state, installedAt: installed.installedAt, mergedDocuments: installed.mergedDocuments })
  } catch (error) {
    const failed = { ...(state || { schemaVersion: 1, attemptedAt: new Date().toISOString() }), status: 'failed', error: error.message,
      ...(Number.isInteger(error.status) ? { httpStatus: error.status, resource: error.resource, missing: error.status === 404 && error.resource === 'manifest' } : {}) }
    try { atomicJson(join(cacheDir, 'update.json'), failed) } catch {}
    return result('failed', { error: failed.error,
      ...(failed.httpStatus ? { httpStatus: failed.httpStatus, resource: failed.resource, missing: failed.missing } : {}), lastAttempt: failed })
  } finally {
    if (temporary) for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(temporary + suffix, { force: true })
    lock?.close()
  }
}

export function synchronizeCatalogue(options = {}) {
  return synchronize(options)
}

export function preserveManagedRead(document, previousPath, { cacheDir = cacheRoot() } = {}) {
  if (process.env.TG_CORE_DOCS_DB) return
  while (true) {
    const selected = databasePath(cacheDir)
    if (selected === previousPath) return
    const catalogue = new Catalogue(selected)
    try {
      catalogue.db.exec('BEGIN IMMEDIATE')
      try {
        if (databasePath(cacheDir) !== selected) {
          catalogue.db.exec('ROLLBACK')
          continue
        }
        const existing = catalogue.get(document.url)
        const generatedAt = currentPointer(cacheDir)?.manifest.generatedAt
        if (existing || !generatedAt || Date.parse(document.checkedAt) > Date.parse(generatedAt)) catalogue.replace(document)
        catalogue.db.exec('COMMIT')
        return
      } catch (error) {
        catalogue.db.exec('ROLLBACK')
        throw error
      }
    } finally {
      catalogue.close()
    }
  }
}

export async function fetchPublishedCatalogue({ cacheDir, fetcher = globalThis.fetch } = {}) {
  if (!cacheDir) throw new Error('fetchPublishedCatalogue requires a private cacheDir')
  const result = await synchronize({ force: true, cacheDir, fetcher, privateCache: true })
  if (result.status === 'failed' || result.status === 'busy') {
    const error = new Error(result.error || 'catalogue update already in progress')
    if (result.httpStatus) error.status = result.httpStatus
    error.resource = result.resource
    error.missing = result.missing === true
    throw error
  }
  return result
}
