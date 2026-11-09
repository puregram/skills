#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { canonicalUrl, pageUrl } from './catalogue.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const BOT_API = join(ROOT, 'telegram-bot-api/tools/botapi.mjs')

function text(value) {
  return value.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`]/g, '').replace(/\\\|/g, '|').trim()
}

function checkEntry(document, parsed) {
  const failures = []
  const table = document.body.match(/^\|(Parameter|Field)\|[^\n]*\n\|[-:| ]+\|\n((?:\|[^\n]*(?:\n|$))*)/m)
  if (!table) {
    if (/^\|[^\n]*\bRequired\b[^\n]*\|/m.test(document.body)) failures.push('unrecognized parameter table')
    return failures
  }
  const rows = table[2].trimEnd().split('\n').filter(Boolean).map(line => line.slice(1, -1).split(/(?<!\\)\|/).map(text))
  const members = table[1] === 'Parameter' ? parsed.params : parsed.fields
  if (!members || members.length !== rows.length) return ['parser omitted or added table rows']
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    const member = members[index]
    if (member.name !== row[0] || member.type !== row[1]) failures.push('parsed name/type differs for ' + row[0])
    if (table[1] === 'Parameter') {
      if (!/^(yes|optional)$/i.test(row[2])) failures.push('unrecognized required marker for ' + row[0])
      else if (member.required !== /^yes$/i.test(row[2])) failures.push('incorrect required flag for ' + row[0])
    } else if (member.required !== !/^Optional\./i.test(row[2])) failures.push('incorrect optional field flag for ' + row[0])
  }
  return failures
}

export function checkCatalogue(path, { minDocuments = 1000, checkEntries = true } = {}) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all()
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('SQLite integrity check failed')
    const counts = {
      documents: db.prepare('SELECT COUNT(*) AS n FROM documents').get().n,
      sections: db.prepare('SELECT COUNT(*) AS n FROM sections').get().n
    }
    if (counts.documents < minDocuments) throw new Error('catalogue coverage below minimum: ' + counts.documents + ' < ' + minDocuments)
    if (counts.sections < counts.documents) throw new Error('some documentation pages have no indexed section')
    const entries = []
    for (const row of db.prepare('SELECT url,body,hash FROM documents').iterate()) {
      if (canonicalUrl(row.url) !== row.url) throw new Error('non-canonical source URL: ' + row.url)
      if (createHash('sha256').update(row.body).digest('hex') !== row.hash) throw new Error('body hash mismatch: ' + row.url)
      if (/\/bots\/api\/(?:methods|types)\/[^/]+\.md$/.test(row.url)) {
        const name = row.body.match(/^# ([A-Za-z][A-Za-z0-9]*)\s*$/m)?.[1]
        if (!name) throw new Error('unrecognized Bot API entry heading: ' + row.url)
        entries.push({ ...row, name })
      }
    }
    const failures = []
    if (checkEntries) {
      for (let offset = 0; offset < entries.length; offset += 30) {
        const batch = entries.slice(offset, offset + 30)
        const result = spawnSync(process.execPath, [BOT_API, 'get', ...batch.map(entry => entry.name), '--offline', '--json'], {
          env: { ...process.env, TG_CORE_DOCS_DB: path, TG_BOTAPI_CACHE: join(dirname(path), '.validation-cache'), TG_CORE_DOCS_AUTO_UPDATE: '0' },
          encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
        })
        if (result.error) throw result.error
        if (result.status !== 0) throw new Error('Bot API lookup validation failed: ' + result.stderr + result.stdout)
        const parsed = JSON.parse(result.stdout)
        for (const entry of batch) {
          const value = parsed.results.find(candidate => candidate.url === entry.url)
          if (!value) failures.push({ url: entry.url, reason: 'entry could not be resolved by its documented name' })
          else for (const reason of checkEntry(entry, value)) failures.push({ url: entry.url, reason })
        }
      }
    }
    if (failures.length) throw new Error('parser drift detected: ' + JSON.stringify(failures.slice(0, 20)))
    return { ...counts, botApiEntriesChecked: checkEntries ? entries.length : 0 }
  } finally {
    db.close()
  }
}

export function catalogueChanges(path, previousPath = null, { root = ROOT } = {}) {
  const current = new DatabaseSync(path, { readOnly: true })
  const previous = previousPath ? new DatabaseSync(previousPath, { readOnly: true }) : null
  try {
    const before = new Map(previous ? previous.prepare('SELECT url,hash FROM documents').all().map(row => [row.url, row.hash]) : [])
    const added = []
    const changed = []
    for (const row of current.prepare('SELECT url,hash FROM documents ORDER BY url').iterate()) {
      if (!before.has(row.url)) added.push(row.url)
      else if (before.get(row.url) !== row.hash) changed.push(row.url)
      before.delete(row.url)
    }
    const removed = [...before.keys()].sort()
    const modified = new Set([...added, ...changed, ...removed])
    const reviewNeeded = []
    if (previous && modified.size) {
      const botChange = [...modified].some(url => new URL(url).pathname.startsWith('/bots'))
      for (const folder of readdirSync(root, { withFileTypes: true })) {
        if (!folder.isDirectory() || folder.name.startsWith('.')) continue
        let skill
        try { skill = readFileSync(join(root, folder.name, 'SKILL.md'), 'utf8') } catch (error) { if (error.code === 'ENOENT') continue; throw error }
        const references = [...skill.matchAll(/https:\/\/core\.telegram\.org\/[^\s)>"`]+/g)].flatMap(match => {
          try { return [pageUrl(match[0])] } catch { return [] }
        })
        if (folder.name === 'telegram-core-docs' || references.some(url => modified.has(url)) || (botChange && /^(?:telegram-|puregram-|using-puregram$|rich-message-authoring$)/.test(folder.name))) {
          reviewNeeded.push(folder.name + '/SKILL.md')
        }
      }
    }
    return { added, changed, removed, reviewNeeded }
  } finally {
    current.close()
    previous?.close()
  }
}

export function renderDrift(report) {
  const lines = [
    '# Official Telegram documentation sync', '',
    `Checked ${report.checked} URLs; published candidate has ${report.documents} pages and ${report.sections} sections.`, '',
    `Added: ${report.added.length}; changed: ${report.changed.length}; unavailable/removed: ${report.removed.length}.`,
    'Source: https://core.telegram.org/. The crawler does not access bot credentials or notification databases.', ''
  ]
  if (report.reviewNeeded.length) {
    lines.push('## Skill guidance needs review', '', 'Documentation is updated automatically; measured behavior and SDK instructions are not rewritten.', '')
    for (const skill of report.reviewNeeded) lines.push('- `' + skill + '`')
    lines.push('')
  }
  for (const key of ['added', 'changed', 'removed']) {
    if (!report[key].length) continue
    lines.push('## ' + key, '')
    for (const url of report[key].slice(0, 30)) lines.push('- <' + url + '>')
    if (report[key].length > 30) lines.push('- … ' + (report[key].length - 30) + ' more; see the JSON report artifact.')
    lines.push('')
  }
  return lines.join('\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('usage: check-catalogue.mjs <catalogue.sqlite>')
    console.log(JSON.stringify(checkCatalogue(process.argv[2]), null, 2))
  } catch (error) {
    process.stderr.write('error: ' + error.message + '\n')
    process.exitCode = 1
  }
}
