#!/usr/bin/env node

import { Catalogue, DEFAULT_TTL, databasePath, pageUrl, parseMarkdown, provenance } from './catalogue.mjs'
import { acquireCatalogueLease, preserveManagedRead, synchronizeCatalogue } from './update.mjs'

const HELP = `core-docs — searchable official core.telegram.org Markdown

usage:
  core-docs.mjs import-tracker <sqlite-backup>   seed/update the catalogue from a read-only tracker snapshot
  core-docs.mjs sync                           check and install the latest published catalogue
  core-docs.mjs search <words...>               ranked local section-level full-text search
  core-docs.mjs read <path-or-url>              read a page or --section; fetch only this page if needed
  core-docs.mjs sections <path-or-url>          list heading anchors and source line ranges
  core-docs.mjs links <path-or-url>             related official Markdown links
  core-docs.mjs stats                          catalogue coverage and import freshness

options:
  --db <file>           user-managed catalogue (never automatically updated)
  --area <name>         search: all, bot-api, bots (includes bot-api), mtproto, tdlib, gateway, other
  --limit <N>           search/sections/links results, 1–100 (default 20)
  --offset <N>          search/sections/links pagination, zero-based (default 0)
  --section <name>      read a heading or anchor; URL fragments also select a section
  --line <N>           read from this absolute source line, one-based
  --max-lines <N>      maximum source lines to print, 1–100000 (default 200)
  --offline            read cached pages only; never use the network
  --no-sync            skip automatic release checks (also $TG_CORE_DOCS_AUTO_UPDATE=0)
  --refresh            revalidate this page even when fresh (not for search)
  --ttl <hours>        freshness threshold (default ${DEFAULT_TTL})
  --json               machine-readable output, including provenance

Node >=22.13; no install or npm dependencies. Only official HTTPS Markdown pages are fetched.
Default-cache lookups check the GitHub release about hourly, retaining the last good catalogue.
Search covers the installed/cached corpus, not unlinked or undiscovered pages. Refreshing one
page does not rediscover the site. Use sync to force a release check.
`

function parseArgs(argv) {
  const opts = { area: 'all', limit: 20, offset: 0, maxLines: 200, ttl: DEFAULT_TTL, json: false, offline: false, refresh: false, noSync: false }
  const rest = []
  const values = { '--db': 'db', '--area': 'area', '--limit': 'limit', '--offset': 'offset', '--section': 'section', '--line': 'line', '--max-lines': 'maxLines', '--ttl': 'ttl' }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--json') opts.json = true
    else if (arg === '--offline') opts.offline = true
    else if (arg === '--no-sync') opts.noSync = true
    else if (arg === '--refresh') opts.refresh = true
    else if (arg === '--help' || arg === '-h') opts.help = true
    else if (values[arg]) {
      const value = argv[++index]
      if (value === undefined || value.startsWith('--')) throw new Error('missing value for ' + arg)
      opts[values[arg]] = ['--db', '--area', '--section'].includes(arg) ? value : Number(value)
    } else if (arg.startsWith('-')) throw new Error('unknown option: ' + arg)
    else rest.push(arg)
  }
  if (opts.offline && opts.refresh) throw new Error('--offline and --refresh cannot be combined')
  if (!Number.isFinite(opts.ttl) || opts.ttl < 0) throw new Error('--ttl must be a nonnegative number')
  if (!Number.isInteger(opts.limit) || opts.limit < 1 || opts.limit > 100) throw new Error('--limit must be between 1 and 100')
  if (!Number.isInteger(opts.offset) || opts.offset < 0) throw new Error('--offset must be a nonnegative integer')
  if (!Number.isInteger(opts.maxLines) || opts.maxLines < 1 || opts.maxLines > 100000) throw new Error('--max-lines must be between 1 and 100000')
  if (opts.line !== undefined && (!Number.isInteger(opts.line) || opts.line < 1)) throw new Error('--line must be a positive integer')
  return { opts, rest }
}

function describe(source) {
  return `${source.stale ? 'STALE · ' : ''}${source.source} · checked ${source.checkedAt || 'unknown'} · fetched ${source.fetchedAt || 'unknown'} · sha256 ${source.hash}`
}

function output(opts, value, text) {
  process.stdout.write(opts.json ? JSON.stringify(value, null, 2) + '\n' : text.replace(/\n*$/, '\n'))
}

async function main() {
  const { opts, rest } = parseArgs(process.argv.slice(2))
  const managed = opts.db === undefined && !process.env.TG_CORE_DOCS_DB
  const [command, ...args] = rest
  if (!command || opts.help) {
    process.stdout.write(HELP)
    return
  }
  if (!['sync', 'import-tracker', 'search', 'read', 'sections', 'links', 'stats'].includes(command)) throw new Error('unknown command: ' + command)
  if (command === 'sync') {
    if (args.length) throw new Error('sync does not take arguments')
    if (opts.noSync) throw new Error('sync and --no-sync cannot be combined')
    const result = await synchronizeCatalogue({ force: true, offline: opts.offline, db: opts.db })
    output(opts, result, `${result.status}${result.error ? ': ' + result.error : ''}\ndatabase: ${result.databasePath}\ngenerated: ${result.manifest?.generatedAt || 'unknown'}`)
    if (result.status === 'failed') process.exitCode = 1
    return
  }
  if (command === 'search' && opts.refresh) throw new Error('search is local; use read --refresh to revalidate a page or sync to update the corpus')
  if (command !== 'import-tracker') {
    const result = await synchronizeCatalogue({ offline: opts.offline, db: opts.db,
      enabled: !opts.noSync && process.env.TG_CORE_DOCS_AUTO_UPDATE !== '0' })
    opts.db = result.databasePath
    if (result.error) process.stderr.write('warning: catalogue update failed (' + result.error + '); using the existing cache\n')
  }
  const lease = managed ? acquireCatalogueLease() : null
  let catalogue
  try {
    catalogue = new Catalogue(lease?.databasePath || opts.db || databasePath())
    if (command === 'import-tracker') {
      if (args.length !== 1) throw new Error('import-tracker needs one SQLite backup path')
      const result = catalogue.importTracker(args[0])
      const stats = catalogue.stats()
      output(opts, { ...result, ...stats }, `imported ${result.imported} pages; retained ${result.keptNewer} newer copies\n${stats.documents} documents, ${stats.sections} indexed sections\nsnapshot checked: ${result.snapshotCheckedAt || 'unknown'}\nimported: ${result.importedAt}\ndatabase: ${stats.database}`)
      return
    }
    if (command === 'stats') {
      if (args.length) throw new Error('stats does not take arguments')
      const stats = catalogue.stats()
      output(opts, stats, `${stats.documents} documents, ${stats.sections} sections\nlatest successful check: ${stats.latestCheckedAt || 'unknown'}\nlast import: ${stats.importedAt || 'never'}\ndatabase: ${stats.database}\n` + stats.areas.map(row => `${row.area}: ${row.count}`).join('\n'))
      return
    }
    if (command === 'search') {
      if (!args.length) throw new Error('search needs words or a symbol name')
      if (!catalogue.stats().documents) throw new Error('catalogue is empty; run sync, import-tracker, or read a known URL online')
      const results = catalogue.search(args.join(' '), opts)
      const text = results.length ? results.map(result => `${result.title} › ${result.heading}\n${result.url} (line ${result.line})\n${describe(result.provenance)}\n${result.excerpt}`).join('\n\n') : 'no matches in the cached corpus'
      output(opts, { query: args.join(' '), area: opts.area, offset: opts.offset, results }, text)
      return
    }
    if (args.length !== 1) throw new Error(command + ' needs one path or URL')
    const input = new URL(args[0], 'https://core.telegram.org/')
    const fragment = input.hash ? decodeURIComponent(input.hash.slice(1)) : null
    const url = pageUrl(args[0])
    const cached = catalogue.get(url)
    const document = await catalogue.load(url, opts)
    if (managed && !opts.offline && !document.warning && document.checkedAt !== cached?.checkedAt) {
      preserveManagedRead(document, catalogue.path)
    }
    const source = provenance(document, opts.ttl)
    if (source.warning) process.stderr.write('warning: ' + source.warning + '; using a stale cached page\n')
    if (command === 'read') {
      const selector = opts.section || fragment
      const section = selector ? catalogue.section(document, selector) : null
      const lines = document.body.split('\n')
      const first = Math.max(section?.startLine ?? 1, opts.line ?? section?.startLine ?? 1)
      const last = section?.endLine ?? lines.length
      if (first > last) throw new Error('--line lies outside the selected page or section')
      const end = Math.min(last, first + opts.maxLines - 1)
      const text = lines.slice(first - 1, end).join('\n')
      const result = { title: document.title, url: section?.url ?? document.url, provenance: source, startLine: first, endLine: end, totalLines: lines.length, truncated: end < last, text }
      const more = result.truncated ? `\n\n[truncated; continue with --line ${end + 1}, or increase --max-lines]` : ''
      output(opts, result, `${result.url}\n${describe(source)}\nlines ${first}–${end}\n\n${text}${more}`)
    } else if (command === 'sections') {
      const all = catalogue.sections(document.url)
      const sections = all.slice(opts.offset, opts.offset + opts.limit)
      output(opts, { url: document.url, provenance: source, total: all.length, offset: opts.offset, sections }, `${document.url}\n${describe(source)}\n\n` + sections.map(section => `${'  '.repeat(section.level - 1)}${section.heading}  #${section.anchor}  lines ${section.startLine}–${section.endLine}`).join('\n') + (opts.offset + sections.length < all.length ? `\n[more headings: --offset ${opts.offset + sections.length}]` : ''))
    } else {
      const all = parseMarkdown(document.body, document.url).links
      const links = all.slice(opts.offset, opts.offset + opts.limit).map(link => ({ ...link, cached: Boolean(catalogue.get(link.url)) }))
      output(opts, { url: document.url, provenance: source, total: all.length, offset: opts.offset, links }, `${document.url}\n${describe(source)}\n\n` + links.map(link => `${link.text || link.url}\n${link.url}${link.cached ? ' [cached]' : ''}`).join('\n\n') + (opts.offset + links.length < all.length ? `\n[more links: --offset ${opts.offset + links.length}]` : ''))
    }
  } finally {
    catalogue?.close()
    lease?.close()
  }
}

main().catch(error => {
  process.stderr.write('error: ' + error.message + '\n')
  process.exitCode = 1
})
