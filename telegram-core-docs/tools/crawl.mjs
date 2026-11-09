#!/usr/bin/env node
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { Catalogue, ORIGIN, canonicalUrl, parseMarkdown } from './catalogue.mjs'

const AGENT = 'telegram-core-docs-crawler'
const USER_AGENT = AGENT + '/1.0 (+https://github.com/puregram/skills)'
const MAX_BODY = 8 * 1024 * 1024
const TIMEOUT = 30_000
const MAX_REDIRECTS = 5
const REDIRECTS = new Set([301, 302, 303, 307, 308])
const DEFAULT_SEEDS = [
  '/', '/bots/api.md', '/bots/api/types.md', '/bots/api/rich-messages.md',
  '/bots/api/formatting.md', '/bots/api-changelog.md', '/bots/features.md',
  '/api.md', '/methods.md', '/types.md', '/mtproto.md', '/tdlib.md', '/gateway.md'
].map(path => ORIGIN + path)

function cancelBody(response) {
  try { response.body?.cancel().catch(() => {}) } catch {}
}

function abortable(promise, signal, lateValue) {
  return new Promise((resolve, reject) => {
    let settled = false
    const abort = () => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(value => {
      if (settled) { lateValue?.(value); return }
      settled = true
      signal.removeEventListener('abort', abort)
      resolve(value)
    }, error => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      reject(error)
    })
    if (signal.aborted) abort()
  })
}

function sleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(finish, Math.min(milliseconds, 2_147_483_647))
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

function throttle(delay) {
  let gap = delay
  let lastStart = -Infinity
  let retryAt = 0
  return {
    setDelay(value) { gap = Math.max(delay, value) },
    retryAfter(value) {
      if (!value) return
      const seconds = /^\s*\d+\s*$/.test(value) ? Number(value) : null
      const time = seconds === null ? Date.parse(value) : Date.now() + seconds * 1000
      if (Number.isFinite(time)) retryAt = Math.max(retryAt, time)
    },
    async wait(signal) {
      while (true) {
        signal.throwIfAborted()
        const now = Date.now()
        const remaining = Math.max(lastStart + gap, retryAt) - now
        if (remaining <= 0) { lastStart = now; return }
        await sleep(remaining, signal)
      }
    }
  }
}

async function readText(response, signal) {
  if (!response.body) throw new Error('empty response body')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal)
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY) throw new Error('decoded response exceeds 8 MiB')
      chunks.push(value)
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))
  } finally {
    try { reader.cancel().catch(() => {}) } catch {}
    reader.releaseLock()
  }
}

function robotsUrl(input, base = ORIGIN + '/robots.txt') {
  const url = new URL(input, base)
  if (url.origin !== ORIGIN || url.username || url.password || url.pathname !== '/robots.txt') {
    throw new Error('robots redirect leaves the official robots.txt URL')
  }
  url.search = ''
  url.hash = ''
  return url.href
}

function robotsPath(value) {
  return value.replace(/[^\x21-\x7e]/gu, character => encodeURIComponent(character))
    .replace(/%([\da-f]{2})/gi, (_, hex) => {
      const character = String.fromCharCode(parseInt(hex, 16))
      return /[\w.~\-]/.test(character) ? character : '%' + hex.toUpperCase()
    })
}

function parseRobots(body) {
  const groups = []
  let group = null
  for (const line of body.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.replace(/#.*/, '').match(/^\s*([^:]+):\s*(.*?)\s*$/)
    if (!match) continue
    const name = match[1].trim().toLowerCase()
    const value = match[2]
    if (name === 'user-agent') {
      if (!group || group.directives.length) {
        group = { agents: [], directives: [] }
        groups.push(group)
      }
      group.agents.push(value.toLowerCase())
    } else if (group) group.directives.push({ name, value })
  }
  const specificity = group => Math.max(-1, ...group.agents.map(agent => agent === '*' ? 0 : agent && AGENT.includes(agent) ? agent.length : -1))
  const best = Math.max(-1, ...groups.map(specificity))
  const rules = []
  let delay = 0
  for (const group of groups.filter(group => best >= 0 && specificity(group) === best)) {
    for (const { name, value } of group.directives) {
      if (name === 'crawl-delay' && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && Number.isFinite(Number(value) * 1000)) {
        delay = Math.max(delay, Number(value) * 1000)
      }
      if (!['allow', 'disallow'].includes(name) || !value) continue
      const path = robotsPath(value)
      const end = path.endsWith('$')
      const pattern = end ? path.slice(0, -1) : path
      const expression = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
      rules.push({ allow: name === 'allow', length: (pattern.replaceAll('*', '').match(/%[\dA-F]{2}|./g) || []).length, expression: new RegExp('^' + expression + (end ? '$' : '')) })
    }
  }
  return {
    delay,
    allows(url) {
      const path = robotsPath(new URL(url).pathname)
      let winner = null
      for (const rule of rules) {
        if (rule.expression.test(path) && (!winner || rule.length > winner.length || (rule.length === winner.length && rule.allow))) winner = rule
      }
      return !winner || winner.allow
    }
  }
}

function httpError(status, message = 'HTTP ' + status) {
  return Object.assign(new Error(message), { status })
}

function createCandidate(outputPath, previousPath) {
  const path = resolve(outputPath)
  if (previousPath && path === resolve(previousPath)) throw new Error('output and previous paths must differ')
  mkdirSync(dirname(path), { recursive: true })
  closeSync(openSync(path, 'wx', 0o600))
  if (previousPath) {
    const previous = new DatabaseSync(resolve(previousPath), { readOnly: true })
    try {
      // VACUUM INTO includes committed WAL pages without writing the previous database.
      previous.prepare('VACUUM INTO ?').run(path)
    } finally { previous.close() }
  }
  return new Catalogue(path)
}

export async function crawlCatalogue({ outputPath, previousPath = null, seeds = DEFAULT_SEEDS, concurrency = 8, delay = 0, maxPages = null, fetcher = fetch, signal } = {}) {
  if (typeof outputPath !== 'string' || !outputPath || outputPath === ':memory:') throw new Error('outputPath must name a new SQLite file')
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive integer')
  if (!Number.isFinite(delay) || delay < 0) throw new Error('delay must be nonnegative milliseconds')
  if (maxPages !== null && (!Number.isInteger(maxPages) || maxPages < 0)) throw new Error('maxPages must be a nonnegative integer or null')
  const seedUrls = [...seeds].map(url => canonicalUrl(url))
  const startedAt = Date.now()
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const runningSignal = controller.signal
  const limiter = throttle(delay)
  let catalogue
  const report = { complete: false, checked: 0, documents: 0, transientErrors: [], unavailable: [], disallowed: [], elapsedMs: 0 }

  async function request(url, headers, consume) {
    await limiter.wait(runningSignal)
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(new Error('request timed out after 30000 ms')), TIMEOUT)
    const requestSignal = AbortSignal.any([runningSignal, timeout.signal])
    let response
    try {
      requestSignal.throwIfAborted()
      response = await abortable(fetcher(url, { headers: { 'user-agent': USER_AGENT, ...headers }, redirect: 'manual', signal: requestSignal }), requestSignal, cancelBody)
      if ([429, 503].includes(response.status)) limiter.retryAfter(response.headers.get('retry-after'))
      if (response.redirected || (response.url && response.url !== url)) throw new Error('fetcher followed a redirect instead of returning it')
      return await consume(response, requestSignal)
    } finally {
      clearTimeout(timer)
      if (response) cancelBody(response)
    }
  }

  async function loadRobots() {
    let url = ORIGIN + '/robots.txt'
    const seen = new Set()
    for (let count = 0; count <= MAX_REDIRECTS; count++) {
      if (seen.has(url)) throw new Error('robots redirect loop')
      seen.add(url)
      const result = await request(url, { accept: 'text/plain' }, async (response, requestSignal) => {
        if (REDIRECTS.has(response.status)) {
          const location = response.headers.get('location')
          if (!location) throw new Error('robots redirect without a location')
          return { redirect: robotsUrl(location, url) }
        }
        if ([404, 410].includes(response.status)) return { body: '' }
        if (response.status !== 200) throw httpError(response.status, 'robots.txt returned HTTP ' + response.status)
        if (/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('robots.txt returned HTML')
        const body = await readText(response, requestSignal)
        if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(body)) throw new Error('robots.txt returned HTML')
        return { body }
      })
      if (!result.redirect) return parseRobots(result.body)
      url = result.redirect
    }
    throw new Error('too many robots redirects')
  }

  try {
    runningSignal.throwIfAborted()
    catalogue = createCandidate(outputPath, previousPath)
    const robots = await loadRobots()
    limiter.setDelay(robots.delay)
    const queue = []
    const seen = new Set()
    const outcomes = new Map()
    const redirects = new Map()
    const removeSearch = catalogue.db.prepare('DELETE FROM section_search WHERE rowid IN (SELECT id FROM sections WHERE url=?)')
    const removePage = catalogue.db.prepare('DELETE FROM documents WHERE url=?')
    const enqueue = input => {
      const url = canonicalUrl(input)
      if (!seen.has(url)) { seen.add(url); queue.push(url) }
    }
    const remove = url => {
      catalogue.db.exec('BEGIN IMMEDIATE')
      try {
        removeSearch.run(url)
        removePage.run(url)
        catalogue.db.exec('COMMIT')
      } catch (error) { catalogue.db.exec('ROLLBACK'); throw error }
    }
    for (const url of seedUrls) enqueue(url)
    for (const { url } of catalogue.db.prepare('SELECT url FROM documents ORDER BY url').all()) enqueue(url)

    async function processPage(url) {
      if (!robots.allows(url)) {
        report.disallowed.push({ url, reason: 'robots.txt' })
        outcomes.set(url, 'disallowed')
        remove(url)
        return
      }
      const cached = catalogue.get(url)
      const headers = { accept: 'text/markdown' }
      if (cached?.etag) headers['if-none-match'] = cached.etag
      if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified
      report.checked++
      let result
      try {
        result = await request(url, headers, async (response, requestSignal) => {
          if (REDIRECTS.has(response.status)) {
            const location = response.headers.get('location')
            if (!location) throw httpError(response.status, 'redirect without a location')
            const destination = new URL(location, url).href
            let target
            try { target = canonicalUrl(destination) } catch {
              report.disallowed.push({ url: destination, from: url, reason: 'redirect outside official HTTPS Markdown scope' })
              throw httpError(response.status, 'redirect outside official HTTPS Markdown scope')
            }
            redirects.set(url, target)
            try {
              for (const origin of redirects.keys()) {
                const chain = new Set([origin])
                let next = origin
                while (redirects.has(next)) {
                  next = redirects.get(next)
                  if (chain.has(next)) throw httpError(response.status, 'redirect loop')
                  chain.add(next)
                  if (chain.size > MAX_REDIRECTS + 1) throw httpError(response.status, 'too many redirects')
                }
              }
            } catch (error) {
              redirects.delete(url)
              throw error
            }
            return { kind: 'redirect', target }
          }
          if ([404, 410].includes(response.status)) return { kind: 'unavailable', status: response.status }
          if (response.status === 304) {
            if (!cached) throw httpError(304, '304 without a cached document')
            const parsed = parseMarkdown(cached.body, url)
            return {
              kind: 'document', links: parsed.links,
              document: { ...cached, checkedAt: new Date().toISOString(), source: 'live', etag: response.headers.get('etag') ?? cached.etag, lastModified: response.headers.get('last-modified') ?? cached.lastModified }
            }
          }
          if (response.status !== 200) throw httpError(response.status)
          if (!/^text\/markdown(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw httpError(200, 'unexpected Markdown content type')
          const body = await readText(response, requestSignal)
          if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(body)) throw httpError(200, 'Markdown response contains HTML')
          const parsed = parseMarkdown(body, url)
          const now = new Date().toISOString()
          return { kind: 'document', links: parsed.links, document: { url, body, checkedAt: now, fetchedAt: now, source: 'live', etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified') } }
        })
      } catch (error) {
        runningSignal.throwIfAborted()
        report.transientErrors.push({ url, ...(error.status === undefined ? {} : { status: error.status }), message: error.message || String(error) })
        outcomes.set(url, 'transient')
        return
      }
      if (result.kind === 'redirect') { outcomes.set(url, 'redirect'); enqueue(result.target); return }
      if (result.kind === 'unavailable') {
        report.unavailable.push({ url, status: result.status })
        outcomes.set(url, 'unavailable')
        remove(url)
        return
      }
      catalogue.db.exec('BEGIN IMMEDIATE')
      try {
        // A previous machine's future clock must not override this scan's actual verification time.
        catalogue.db.prepare('UPDATE documents SET checked_at=NULL WHERE url=?').run(url)
        catalogue.replace(result.document)
        catalogue.db.exec('COMMIT')
      } catch (error) { catalogue.db.exec('ROLLBACK'); throw error }
      outcomes.set(url, 'verified')
      for (const link of result.links) enqueue(link.url)
    }

    await new Promise((resolve, reject) => {
      let next = 0
      let active = 0
      let failure = null
      const pump = () => {
        if (runningSignal.aborted && !failure) failure = runningSignal.reason
        while (!failure && active < concurrency && next < queue.length && (maxPages === null || next < maxPages)) {
          const url = queue[next++]
          active++
          processPage(url).catch(error => {
            failure ||= error
            controller.abort(failure)
          }).finally(() => { active--; pump() })
        }
        if (!active) {
          if (failure) reject(failure)
          else resolve()
        }
      }
      pump()
    })
    runningSignal.throwIfAborted()
    for (const url of redirects.keys()) {
      const visited = new Set()
      let target = url
      while (redirects.has(target) && !visited.has(target)) { visited.add(target); target = redirects.get(target) }
      if (['verified', 'unavailable', 'disallowed'].includes(outcomes.get(target))) remove(url)
    }
    report.complete = maxPages === null && report.transientErrors.length === 0
    report.documents = catalogue.stats().documents
    catalogue.db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;')
    report.elapsedMs = Date.now() - startedAt
    return report
  } catch (error) {
    controller.abort(error)
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
    catalogue?.close()
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    output: { type: 'string' }, previous: { type: 'string' },
    'max-pages': { type: 'string' }, concurrency: { type: 'string' }, delay: { type: 'string' },
    seed: { type: 'string', multiple: true }, help: { type: 'boolean', short: 'h' }
  } })
  if (values.help) {
    console.log('Usage: node crawl.mjs --output NEW.sqlite [--previous OLD.sqlite] [--max-pages N] [--concurrency N] [--delay MILLISECONDS] [--seed URL ...]\nPrints a JSON report. A max-pages scan is always incomplete. Incomplete scans exit with status 1.')
    return
  }
  const controller = new AbortController()
  const interrupt = () => controller.abort(new Error('crawl interrupted'))
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    const report = await crawlCatalogue({
      outputPath: values.output, previousPath: values.previous,
      maxPages: values['max-pages'] === undefined ? null : Number(values['max-pages']),
      concurrency: values.concurrency === undefined ? 8 : Number(values.concurrency),
      delay: values.delay === undefined ? 0 : Number(values.delay),
      seeds: values.seed, signal: controller.signal
    })
    console.log(JSON.stringify(report))
    if (!report.complete) process.exitCode = 1
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(JSON.stringify({ error: error.message || String(error) })); process.exitCode = 1 })
}
