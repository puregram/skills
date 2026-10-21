#!/usr/bin/env node
// live lookup over the official telegram bot api reference (core.telegram.org/bots/api).
// zero dependencies, node >= 18. fetches the page, caches it, parses methods / types / prose
// sections out of the html, and answers queries. run with --help for usage.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PAGES = {
  api: 'https://core.telegram.org/bots/api',
  changelog: 'https://core.telegram.org/bots/api-changelog',
  features: 'https://core.telegram.org/bots/features'
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
  --ttl <hours>     cache lifetime (default ${DEFAULT_TTL_HOURS})
  --brief           get: omit field / param descriptions

the cache lives in $TG_BOTAPI_CACHE, else $XDG_CACHE_HOME/telegram-bot-api, else ~/.cache/telegram-bot-api.
if the network fails, a stale cache is used with a warning on stderr.

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
  const opts = { json: false, refresh: false, offline: false, brief: false, ttl: DEFAULT_TTL_HOURS }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') opts.json = true
    else if (a === '--refresh') opts.refresh = true
    else if (a === '--offline') opts.offline = true
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

async function loadPage(key, opts) {
  const file = join(cacheDir(), `${key}.html`)
  let cached = null
  let ageHours = Infinity
  try {
    const st = await stat(file)
    ageHours = (Date.now() - st.mtimeMs) / 3_600_000
    cached = await readFile(file, 'utf8')
  } catch {}

  if (opts.offline) {
    if (cached) return cached
    throw new Error(`--offline but no cached copy of ${PAGES[key]} at ${file}`)
  }
  if (cached && !opts.refresh && ageHours < opts.ttl) return cached

  try {
    const res = await fetch(PAGES[key], { headers: { 'user-agent': 'telegram-bot-api-skill/1.0' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    if (!html.includes('dev_page_content')) throw new Error('unexpected page shape')
    await mkdir(cacheDir(), { recursive: true })
    await writeFile(file, html)
    return html
  } catch (err) {
    if (cached) {
      process.stderr.write(`warning: fetching ${PAGES[key]} failed (${err.message}); using cache from ${ageHours.toFixed(1)}h ago\n`)
      return cached
    }
    throw new Error(`cannot fetch ${PAGES[key]}: ${err.message}`)
  }
}

// ---------- html → text ----------

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return NAMED_ENTITIES[e.toLowerCase()] ?? m
  })
}

function toText(html) {
  let s = html
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, body) => '\n```\n' + decode(body.replace(/<[^>]+>/g, '')).replace(/\n+$/, '') + '\n```\n')
  s = s.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '$1')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<li[^>]*>/gi, '\n- ')
  s = s.replace(/<\/(p|blockquote|ul|ol|h\d|tr|table|div)>/gi, '\n')
  s = s.replace(/<(p|blockquote|ul|ol|h\d|table|div)[^>]*>/gi, '\n')
  s = s.replace(/<\/?(td|th)[^>]*>/gi, ' | ')
  s = s.replace(/<[^>]+>/g, '')
  s = decode(s)
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

function oneLine(html) {
  return toText(html).replace(/\s*\n\s*/g, ' ').trim()
}

// ---------- parsing ----------

function pageBody(html) {
  const i = html.indexOf('id="dev_page_content"')
  return i < 0 ? html : html.slice(i)
}

// splits the page into h3 / h4 headed chunks, keeping the raw html of each
function chunks(html) {
  const body = pageBody(html)
  const re = /<h([34])[^>]*>([\s\S]*?)<\/h\1>/gi
  const heads = []
  let m
  while ((m = re.exec(body))) {
    const anchor = (m[2].match(/name="([^"]+)"/) || [])[1] || ''
    heads.push({ level: Number(m[1]), title: oneLine(m[2]), anchor, start: m.index, bodyStart: re.lastIndex })
  }
  return heads.map((h, i) => ({ ...h, html: body.slice(h.bodyStart, i + 1 < heads.length ? heads[i + 1].start : body.length) }))
}

function parseTable(tableHtml) {
  const head = [...tableHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((x) => oneLine(x[1]).toLowerCase())
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((r) => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]))
    .filter((cells) => cells.length)
  return { head, rows }
}

function parseApi(html) {
  const entries = []
  let section = ''
  let version = null
  const vm = html.match(/<strong>Bot API ([\d.]+)<\/strong>/)
  if (vm) version = vm[1]
  const dm = html.match(/<h4>[\s\S]*?<\/a>([^<]+)<\/h4>\s*<p><strong>Bot API/)
  const date = dm ? dm[1].trim() : null

  for (const c of chunks(html)) {
    if (c.level === 3) {
      section = c.title
      const prose = toText(c.html)
      if (prose && section !== 'Recent changes') entries.push({ kind: 'section', name: section, anchor: c.anchor, section, description: prose })
      continue
    }
    if (section === 'Recent changes') continue

    const tableMatch = c.html.match(/<table[\s\S]*?<\/table>/i)
    const before = tableMatch ? c.html.slice(0, tableMatch.index) : c.html
    const after = tableMatch ? c.html.slice(tableMatch.index + tableMatch[0].length) : ''
    const isIdentifier = /^[A-Za-z][A-Za-z0-9]*$/.test(c.title)
    const kind = !isIdentifier ? 'prose' : /^[a-z]/.test(c.title) ? 'method' : 'type'

    const entry = { kind, name: c.title, anchor: c.anchor, section, description: toText(before) }
    if (kind === 'prose') {
      entry.description = toText(c.html)
      entries.push(entry)
      continue
    }

    const notes = toText(after)
    if (notes) entry.notes = notes

    if (tableMatch) {
      const { head, rows } = parseTable(tableMatch[0])
      if (kind === 'method' || head.includes('required')) {
        entry.params = rows.map(([name, type, req, desc]) => ({
          name: oneLine(name), type: oneLine(type), required: /^yes$/i.test(oneLine(req)), description: oneLine(desc ?? '')
        }))
      } else {
        entry.fields = rows.map(([name, type, desc]) => {
          const d = oneLine(desc ?? '')
          return { name: oneLine(name), type: oneLine(type), required: !/^Optional\./.test(d), description: d }
        })
      }
    } else if (kind === 'method') {
      entry.params = []
    }

    // unions / abstract types list their members as <li><a href="#x">X</a></li> with nothing else
    const lis = [...before.matchAll(/<li>\s*<a href="#([^"]+)">([^<]+)<\/a>\s*<\/li>/gi)]
    if (kind === 'type' && !tableMatch && lis.length) {
      entry.oneOf = lis.map((x) => x[2])
      entry.description = toText(before.replace(/<ul>[\s\S]*?<\/ul>/i, ''))
    }

    if (kind === 'method') {
      const sentences = entry.description.replace(/\n/g, ' ').split(/(?<=\.)\s+/)
      const ret = sentences.filter((s) => /\breturn(s|ed)?\b/i.test(s))
      if (ret.length) entry.returns = ret.join(' ')
    }
    entries.push(entry)
  }
  return { version, date, entries }
}

function parseChangelog(html) {
  const out = []
  for (const c of chunks(html)) {
    if (c.level !== 4) continue
    const vm = c.html.match(/<strong>Bot API ([\d.]+)<\/strong>/)
    out.push({ date: c.title, version: vm ? vm[1] : null, anchor: c.anchor, text: toText(c.html) })
  }
  return out
}

function parseFeatures(html) {
  return chunks(html).map((c) => ({ level: c.level, name: c.title, anchor: c.anchor, text: toText(c.html) }))
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
  return `${PAGES.api}#${entry.anchor}`
}

function renderEntry(e, brief) {
  const lines = [`## ${e.name}  (${e.kind}, section "${e.section}")`, link(e), '']
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
  const api = parseApi(await loadPage('api', opts))
  const found = []
  const texts = []
  let missing = false
  for (const name of names) {
    const e = findExact(api.entries, name)
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
  out(opts, { version: api.version, results: found }, `bot api ${api.version}\n\n` + texts.join('\n\n'))
  if (missing) process.exitCode = 1
}

async function cmdSearch(words, opts) {
  if (!words.length) throw new Error('search needs at least one word')
  const api = parseApi(await loadPage('api', opts))
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
        return `  ${e.name.padEnd(36)} ${e.kind.padEnd(7)} ${first}${h}`
      }).join('\n')
    : '  no matches'
  out(opts, ranked.map(({ e, score, hits }) => ({ name: e.name, kind: e.kind, section: e.section, score, matches: hits, anchor: link(e) })),
    `bot api ${api.version} — search: ${words.join(' ')}\n\n${text}`)
}

async function cmdRefs(name, opts) {
  const api = parseApi(await loadPage('api', opts))
  const target = findExact(api.entries, name)
  const n = target ? target.name : name
  const refs = []
  for (const e of api.entries) {
    for (const m of [...(e.params || []), ...(e.fields || [])]) {
      if (typeMentions(m.type, n)) refs.push({ in: e.name, kind: e.kind, member: m.name, type: m.type })
    }
    if (e.oneOf?.includes(n)) refs.push({ in: e.name, kind: 'union', member: '(member of)', type: e.name })
    if (e.returns && typeMentions(e.returns, n)) refs.push({ in: e.name, kind: e.kind, member: '(returns)', type: e.returns })
  }
  const text = refs.length
    ? refs.map((r) => `  ${r.in}.${r.member}: ${r.type}`).join('\n')
    : '  no references'
  out(opts, { name: n, refs }, `bot api ${api.version} — references to ${n}\n\n${text}`)
}

async function cmdList(what, opts) {
  const api = parseApi(await loadPage('api', opts))
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
    bySection.get(e.section).push(e.kind === 'method' || e.kind === 'type' ? e.name : `"${e.name}"`)
  }
  const text = [...bySection].map(([s, names]) => `### ${s} (${names.length})\n${names.join(', ')}`).join('\n\n')
  out(opts, list.map((e) => ({ name: e.name, kind: e.kind, section: e.section })), `bot api ${api.version}\n\n${text}`)
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
  let log = parseChangelog(await loadPage('changelog', opts)).filter((x) => x.version)
  if (opts.since) log = log.filter((x) => cmpVersion(x.version, opts.since) >= 0)
  if (opts.grep) {
    const re = new RegExp(opts.grep, 'i')
    log = log
      .map((x) => ({ ...x, text: x.text.split('\n').filter((l) => re.test(l)).join('\n') }))
      .filter((x) => x.text)
  }
  if (opts.last || (!opts.since && !opts.grep)) log = log.slice(0, opts.last || 1)
  out(opts, log, log.map((x) => `## ${x.date} — Bot API ${x.version}\n\n${x.text}`).join('\n\n'))
}

async function cmdFeatures(heading, opts) {
  const sections = parseFeatures(await loadPage('features', opts))
  if (!heading) {
    out(opts, sections.map(({ level, name }) => ({ level, name })),
      sections.map((s) => `${s.level === 4 ? '    ' : ''}${s.name}`).join('\n'))
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
  out(opts, picked, picked.map((s) => `${'#'.repeat(s.level)} ${s.name}\n${PAGES.features}#${s.anchor}\n\n${s.text}`).join('\n\n'))
}

async function cmdVersion(opts) {
  const api = parseApi(await loadPage('api', opts))
  const counts = { methods: 0, types: 0 }
  for (const e of api.entries) {
    if (e.kind === 'method') counts.methods++
    if (e.kind === 'type') counts.types++
  }
  out(opts, { version: api.version, date: api.date, ...counts }, `bot api ${api.version} (${api.date}) — ${counts.methods} methods, ${counts.types} types`)
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
