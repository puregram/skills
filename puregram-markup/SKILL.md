---
name: puregram-markup
description: >
  use when working with `@puregram/markup` in puregram v3 — entity-based text
  formatting that builds the `entities` array directly, no `parse_mode` header
  needed. covers the `markup()` plugin install, every builder (`bold` / `italic`
  / `code` / `pre` / `link` / `mentionUser` / `time` / `join` / …) in tagged-
  template + call form, `format` / `formatDedent` composition, the `html` /
  `htmlb` / `md` parsers with `.define` / `.with` / `.lenient`, custom html
  tags, the `Formatted` codec (`fromMessage` / `toHtml` / `toMarkdown`),
  `MarkupParseError`, and the chain rules telegram clients actually honor.
metadata:
  author: nitreojs
  source: https://github.com/puregram/puregram/tree/v3/packages/markup
  package: "@puregram/markup@3"
---

# `@puregram/markup`

entity-aware text formatter for puregram v3. instead of stringly-typed concatenation (`HTML.bold('a') + ' ' + HTML.italic('b')`) it builds the bot-api **`entities` array** directly — no `parse_mode`, no escape bugs, full composability. `tg.extend(markup())` hooks an `onBeforeRequest` unwrapper into every outgoing api call, so a `Formatted` value can be passed anywhere a `text` / `caption` is accepted.

## when to use this skill

- you're sending styled messages and don't want to think about `parse_mode` / escape rules
- you want to interpolate user input safely inside a bold / link / blockquote without manually escaping `*`, `_`, `<`
- you already have html or markdown source (from a database, llm, config) and want it rendered as telegram entities
- you need a `time` / `customEmoji` / `mentionUser` (no-username mention) / `pre`-with-language entity
- you need to convert a received message's `(text, entities)` back to html or markdown for logging / export
- you want a permissive parser path (`md.lenient`, `html.lenient`) for llm output that's malformed half the time
- you're extending the html parser with custom tags (`<upper>`, `<h1>`, ...) for a templating layer

for other entity work — sending `Formatted` chunks from an llm stream — see the sibling skill `puregram-stream` (it integrates with markup via the `parseMode: 'MarkdownV2' | 'HTML'` option). for callback-button payloads, that's `puregram-callback-data` territory.

## quick start

```ts
import { Telegram } from 'puregram'
import { markup, format, bold, italic, code } from '@puregram/markup'

const tg = Telegram.fromToken(process.env.TOKEN!)
  .extend(markup())

tg.onMessage((message) => {
  return message.send(
    format`hey! this ${bold('message')} is ${italic('formatted')} without ${code('parse_mode')}!`
  )
})

await tg.startPolling()
```

`.extend(markup())` is what wires the `Formatted` unwrapping into outgoing requests. without it, a `Formatted` value reaches telegram as `[object Object]`. the plugin doesn't change any types — every builder returns a `Formatted` value that `message.send(...)` / `tg.send(...)` / `tg.api.sendMessage(...)` (with markup installed) accepts as the `text` argument.

## call forms

almost every builder accepts both forms — pick whichever reads best at the call site:

```ts
// tagged-template
bold`foo ${italic`bar`}`

// parentheses
bold(italic('bar'))
```

**footgun** — interpolating a `Formatted` inside a *plain* backtick string coerces it to `"[object Object]"`. always use the tagged form on both sides if you want the result to be a `Formatted`:

```ts
// ✅ works
bold`foo ${italic`bar`}`
bold(italic('foo'))

// ❌ does not work
bold(`foo ${italic('bar')}`)   // template concat strips the entity
```

modifiers also chain — every modifier exposes every other modifier as a property:

```ts
bold.italic('all together')
bold.italic.underline('all three')
bold.italic.underline`tagged form too`
```

### what telegram actually renders

at the type level, every modifier chains to every other — `code.bold(...)`, `pre.italic(...)`, `expandableBlockquote.spoiler(...)` all compile and emit both entities on the wire. but telegram clients override a few of those combinations:

| chain | result |
|---|---|
| text styles within text styles (`bold.italic`, `spoiler.bold`, ...) | compounds correctly |
| anything within `blockquote` / `expandableBlockquote` | inner styles render inside the quote |
| anything within `code` (`code.bold`, `code.italic`) | inner styles **dropped** — code renders as monospace plain text |
| `code` within anything (`bold.code`) | renders as monospace; outer style ignored too |
| nested `blockquote` inside `blockquote` | flattened to a single quote |

treat `code` and `pre` as leaves. stack everything else freely.

## builders

### text-style modifiers

| builder | entity |
|---|---|
| `bold(text)` / `bold\`text\`` | `bold` |
| `italic(text)` | `italic` |
| `underline(text)` | `underline` |
| `strikethrough(text)` | `strikethrough` |
| `spoiler(text)` | `spoiler` |
| `code(text)` | `code` (inline monospace — leaf, drops inner styles) |
| `blockquote(text)` | `blockquote` |
| `expandableBlockquote(text)` | `expandable_blockquote` (telegram needs >3 lines for the expand UI) |

### `pre(text, language?)` — fenced code block

```ts
pre('console.log("hi")', 'js')   // 2-arg eager form with language
pre`unhighlighted block`         // tagged-template, no language
pre()`also unhighlighted`        // curried, no language
```

curried-with-language is intentionally not supported — use the 2-arg eager form when you need `language`. same monospace-leaf rule as `code`.

### `link(text, url)` / `link(url)` — text links

```ts
link('puregram on github', 'https://github.com/puregram/puregram')   // eager
link('https://core.telegram.org/bots/api')`bot api docs`             // curried, tagged
link('https://t.me/pureforum')('the forum')                          // curried, parens
```

### `mentionUser(text, userId)` / `mentionBot(text, botId)` / `textMention(text, user)`

`text_mention` entity — links to a user by id, no `username` required. `mentionBot` synthesises `is_bot: true`. `textMention` takes a full bot-api `User` you already have.

```ts
mentionUser('dude', 398859857)
mentionBot('robodude', tg.bot.id)
textMention('dude', { id: 398859857, is_bot: false, first_name: 'dude' })
```

### `customEmoji(text, customEmojiId)`

```ts
customEmoji('😁', '5448765217123141')
```

### `time(text, when, format?)` / `time(when, format?)`

emits a `date_time` entity that telegram clients render in the recipient's locale + timezone:

```ts
time('see you', new Date(), { dateStyle: 'short', timeStyle: 'short' })

// curried
time(new Date(), { relative: true })`see you`
```

`when` is a unix timestamp (seconds) or a `Date`. the `TimeFormat` object maps to telegram's `r|w?[dD]?[tT]?` flag string:

| field | flag | meaning |
|---|---|---|
| `relative: true` | `r` | "in 5 minutes" / "5 hours ago". mutually exclusive with every other flag |
| `weekday: true` | `w` | prepends the day-of-week |
| `dateStyle: 'short'` | `d` | short date — `17.03.22` |
| `dateStyle: 'long'` | `D` | long date — `March 17, 2022` |
| `timeStyle: 'short'` | `t` | short time — `22:45` |
| `timeStyle: 'long'` | `T` | long time — `22:45:00` |

setting `relative: true` alongside any other flag throws `RangeError`. flag ordering is handled for you.

### `join(items, separator)` / `joinWithEntities(parts, separator)`

`Array.prototype.join` for `Formatted` values — preserves entities across the separator:

```ts
format`pick: ${join(['alpha', 'beta', 'gamma'].map(s => bold(s)), ', ')}`
```

`joinWithEntities` is the lower-level variant that accepts pre-built `Formatted` parts directly.

## composition — `format` / `formatDedent`

```ts
format`
  hello!
  the leading two-space indent is stripped from every line
    these extra two stay (matches stripIndent)
`

formatDedent`
  every leading whitespace prefix strips
  including
              the eighteen-space one
`
```

`format` removes the *common* leading indent (like `stripIndent`); `formatDedent` removes *every* leading prefix it finds (like `stripIndents`). interpolate any `Formatted` value inside.

## parsers — `html` / `htmlb` / `md`

if your formatted content arrives as a string (database, config, llm), pipe it through a parser. each one returns a `Formatted` that drops into `message.send(...)` directly — `parse_mode` is never set on the wire.

### `html\`...\``

```ts
import { html } from '@puregram/markup'

await message.send(html`
  hello, <b>${userName}</b>!
  <i>italic</i> · <u>underline</u> · <s>strike</s> · <tg-spoiler>secret</tg-spoiler>
  <code>inline</code> · <a href="https://x.com">link</a>
  <blockquote>quoted line</blockquote>
  <blockquote expandable>line 1
  line 2
  line 3
  line 4 — needs >3 lines for the expand UI</blockquote>
`)
```

interpolated values are escaped automatically — `${userInput}` can't break out of the surrounding tag.

`htmlb` is the same parser with explicit `<br>` newlines (use when your html doesn't follow the `\n`-as-significant convention):

```ts
htmlb`
  first line <br>
  <b>second line, <br>
  still bold across breaks</b>
`
```

### custom html tags — `html.define` / `html.with`

```ts
import { html, Formatted } from '@puregram/markup'

html.define({
  upper: content => new Formatted(content.text.toUpperCase(), content.entities)
})

html`shouting: <upper>quietly</upper>`
// → "shouting: QUIETLY"
```

`html.define(...)` mutates the global `html` / `htmlb` registry — every later `html`-tagged template anywhere sees the new tag. for a scoped registry that doesn't bleed:

```ts
const fancy = html.with({
  h1: c => new Formatted(`H1: ${c.text}`, c.entities)
})

fancy`<h1>title</h1>`   // works on `fancy`
html`<h1>title</h1>`    // throws — `h1` not in the global registry
```

a tag handler receives `(content: Formatted, info: TagInfo)`. `TagInfo` carries the original tag name, attributes, and parent — useful for tag-stack-aware behavior.

### `md` / `markdown`

```ts
import { md } from '@puregram/markup'

await message.send(md`
  **bold** _italic_ __underline__ ~~strike~~ ||spoiler||
  [link](https://x.com), [tg user mention](tg://user?id=${message.from?.id ?? 0})
  \`code\`, then a fenced block:
  \`\`\`js
  console.log('hello')
  \`\`\`
  > regular quote
  >> expandable quote
`)
```

parses telegram's MarkdownV2 flavor. `markdown` is just an alias for spell-it-out preference. interpolations are auto-escaped, so the `tg://user?id=${userId}` form is safe with untrusted input.

### lenient parsing — `.lenient`

strict parsers throw `MarkupParseError` on malformed input. lenient variants swallow the error and return a plain-text `Formatted` instead:

```ts
md('**unclosed bold and [a link with no url')          // throws
md.lenient('**unclosed bold and [a link with no url')  // Formatted { text: input, entities: [] }
```

`html.lenient` and `htmlb.lenient` mirror this shape. well-formed input parses identically to the strict form.

`md.lenient(...)` over `md(input, { onError: 'plain' })` because the tagged-template form already eats the second-argument slot for interpolations.

## the `Formatted` codec

every builder produces a `Formatted` — text + bot-api entities. it's a two-way pipe:

### `Formatted.fromMessage(msg)`

hydrate a `Formatted` from an incoming message (or any `{ text, entities, caption, caption_entities }` shape). picks `text`+`entities` when present, otherwise `caption`+`caption_entities`. round-trip safe — `Formatted.fromMessage(msg).toPayload()` reproduces the original pair byte-for-byte.

```ts
tg.command('quote', async (message) => {
  const reply = message.replyToMessage
  if (reply == null) return

  const original = Formatted.fromMessage(reply)

  await message.send(format`you said: ${original}`)
})
```

### `formatted.toHtml()` / `formatted.toMarkdown()`

serialize a `Formatted` back into html or markdown v2 source — useful for logging, persisting drafts, exporting:

```ts
const f = format`${bold('build:')} ${italic('passing')}`

f.toHtml()       // "<b>build:</b> <i>passing</i>"
f.toMarkdown()   // "**build:** _passing_"
```

standalone `toHtml(source)` / `toMarkdown(source)` are also exported when you'd rather operate on raw `{ text, entities }` pairs.

### hand-rolling a `Formatted`

```ts
import { Formatted } from '@puregram/markup'

const f = new Formatted('hello world', [
  { type: 'bold', offset: 0, length: 5 },
  { type: 'italic', offset: 6, length: 5 }
])

await message.send(f)
```

handy for porting code that already produces a `{ text, entities[] }` shape.

## errors

`MarkupParseError` is thrown by the strict `html` / `htmlb` / `md` paths and by custom-tag handlers when input doesn't parse. carries `.position` + the offending source so you can build helpful diagnostics:

```ts
import { md, MarkupParseError } from '@puregram/markup'

try {
  md`broken **bold`
} catch (error) {
  if (error instanceof MarkupParseError) {
    console.error(error.message, 'at offset', error.position)
  }
}
```

## exported surface

```ts
import {
  markup,                          // .extend(markup()) — the unwrap hook
  Formatted,                       // class + ctor for hand-rolled values
  format, formatDedent,            // template composers
  bold, italic, underline, strikethrough,
  spoiler, blockquote, expandableBlockquote, code,
  pre, link, customEmoji,
  mentionUser, mentionBot, textMention,
  time,                            // date_time entity
  html, htmlb,                     // html parsers (+ `.lenient`, `.define`, `.with`)
  md, markdown,                    // markdown v2 parser (+ `.lenient`)
  join, joinWithEntities,
  toHtml, toMarkdown,              // standalone serializers
  MarkupParseError
} from '@puregram/markup'

import type {
  Entity,
  HtmlCallable,
  MdCallable,
  Modifier,
  ModifierName,
  TagDefinitions,
  TagHandler,
  TagInfo,
  TimeFormat,
  MessageLike,
  FormattedPayload
} from '@puregram/markup'
```

## see also

- main skill: `using-puregram` — covers `.extend(plugin)`, `MediaSource`, `tg.send` / `message.send`, the request-hook model markup plugs into
- sibling: `puregram-stream` — uses markup for `parseMode: 'MarkdownV2' | 'HTML'` streaming
- sibling: `puregram-callback-data` — typed `callback_data` payloads (unrelated to formatting but the other "structured content" plugin)
- package source: [`packages/markup/`](https://github.com/puregram/puregram/tree/v3/packages/markup)
