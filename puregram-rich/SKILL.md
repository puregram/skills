---
name: puregram-rich
description: >
  use when working with `@puregram/rich` in puregram v3 — the native-blocks
  authoring layer for telegram's rich messages. builders and
  template tags emit `TelegramInputRichBlock[]` directly. covers the `rich`
  namespace (callable composition, `md` / `markdown` / `html` parse tags with
  `.lenient`, `raw.md` / `raw.html` passthrough), every inline builder (`bold` /
  `italic` / `underline` / `strikethrough` / `spoiler` / `code` / `marked` /
  `subscript` / `superscript` / `link` / `mentionUser` / `math` / `customEmoji` /
  `time` / `reference` / `anchor` / `footnoteRef` / `button`), every block
  builder (`heading` / `paragraph` / `codeBlock` / `blockquote` /
  `expandableBlockquote` / `divider` / `list` / `orderedList` / `taskList` /
  `details` / `mathBlock` / `footer` / `pullQuote` / `media` / `photo` / `video` /
  `audio` / `animation` / `voiceNote` / `document` / `thinking` / `map` /
  `collage` / `slideshow` / `table` / `buttonRow` / `footnote`), MediaSource
  uploads in media builders, the `Rich` envelope (`.blocks` / `.rtl()` /
  `.noEntityDetection()` / `.toMarkdown()` / `.toHtml()` /
  `.toInputRichMessage()`), strict vs lenient parsing, and interpolation
  splicing semantics.
metadata:
  author: starkow
  source: https://github.com/puregram/puregram/tree/v3/packages/rich
  package: "@puregram/rich"
---

# `@puregram/rich`

native-blocks authoring for telegram's rich messages. builders and template tags emit the `blocks` wire format (`TelegramInputRichBlock[]`) directly — telegram renders exactly what you compose, no server-side string parsing involved. interpolation is safe by construction: `${…}` values are spliced into the block tree as values, never concatenated into a source string.

result is a `Rich` envelope. it implements `RichLike`, so it passes directly into any `rich_message` field.

## when to use this skill

- sending rich messages (headings, lists, code blocks, tables, formulas, media, collapsible blocks, …)
- you want safe interpolation of user data without hand-escaping
- you need `message.sendRich` / `message.replyWithRich` / `message.editRich` or `telegram.api.sendRichMessage`
- you have a pre-authored markdown/html string (e.g. LLM output) and need to choose between parsing it (`rich.md(str)`) and passing it through raw (`rich.raw.md(str)`)
- you want uploaded media (`MediaSource.path` / `.buffer`) inside a rich message
- rich content in an inline-query result via `InputMessageContent.rich(richObject)`

not covered here: plain-text entity formatting (see `puregram-markup`), streaming drafts (see `puregram-stream`), the LLM grammar prompt (see `rich-message-authoring`).

## quick start

```ts
import { rich } from '@puregram/rich'

await message.sendRich(rich.md`
  # ${title}

  ${rich.bold('status:')} ${status}

  ${rich.list(items)}
`)
```

## the `rich` namespace

```ts
rich(content)      // compose builders/content into a blocks envelope
rich`…`            // compose template — NO parsing: literal text stays literal, values splice,
                   // blank lines separate paragraphs, dedent applies (markup's `format` analogue)
rich.md`…`         // parse rich-markdown → blocks (rich.markdown is an alias)
rich.html`…`       // parse rich-html → blocks
rich.raw.md(str)   // raw dialect passthrough — no parsing (also raw.markdown / raw.html)
rich.*             // every builder (rich.bold, rich.heading, …)
```

### parse tags

each tag accepts three call forms and has a `.lenient` variant:

```ts
rich.md`# ${title}`               // tagged template — parses, splices ${…} safely
rich.md('# from a string')        // string call — parses the string
rich.md([rich.h1('from data')])   // builder array — emits directly, no parsing
rich.md.lenient(llmOutput)        // permissive — unsupported constructs become literal text
```

- strict parses throw `RichParseError` (with `.position` and `.source`) on unsupported/malformed constructs; `.lenient` degrades them to literal text
- markdown templates are **dedented** (common leading indentation stripped); html templates are not
- the accepted grammar is the rich dialect telegram itself parses (see `rich-message-authoring` for the full list): headings, fenced code (` ```lang ` / ` ```math `), `$…$` / `$$…$$` math, dividers, quotes, bullet / ordered / task lists, gfm tables, footnotes, lone `![](url)` media lines, all inline tokens, embedded supported html tags, backslash escapes, numeric + the 13 named entities
- parse input is bounded by `MAX_RICH_PARSE_LENGTH` (4 × telegram's 32768-char message cap); nesting by `MAX_NESTING_DEPTH` (128)

### interpolation splicing

| interpolated value | what happens |
|---|---|
| `string` | spliced as literal text — never parsed as syntax |
| `number` | stringified |
| inline builder | spliced into the surrounding text |
| block builder | spliced as its own block(s); paragraph prose splits around it; throws inside headings/cells |
| blocks `Rich` fragment | spliced at block level |
| array | each item spliced in order |
| `null` / `undefined` / `false` | nothing |

interpolation also works inside urls, anchor names, emoji ids, code-fence language tags, and code/math bodies (plain text only there).

### raw passthrough

```ts
rich.raw.md(markdown)                    // → { markdown }
rich.raw.html(html, { media })           // → { html, media } — entries for tg://…?id= links
```

use for pre-authored strings that are already in the grammar (LLM output being the main case — the server parses them). raw envelopes expose no `.blocks` and cannot be spliced into templates or compositions.

## inline builders

all emit native `RichText` entities. content args accept `RichContent`.

| builder | emits |
|---|---|
| `bold` / `italic` / `underline` / `strikethrough` / `spoiler` / `code` / `marked` / `subscript` / `superscript` | `{ type, text }` |
| `link(text, url)` | `url` |
| `mentionUser(text, userId, options?)` | `text_mention` with a real user object; `options`: `firstName` / `lastName` / `username` / `isBot` |
| `math(latex)` | `mathematical_expression` |
| `customEmoji(id, alt)` | `custom_emoji` |
| `time(label, unix, format?)` | `date_time` |
| `reference(text, name)` | `anchor_link` |
| `anchor(name)` | `anchor` |
| `footnoteRef(id, label?)` | `reference_link` |
| `button(label, options)` | `button` — see [buttons](#buttons) |

**aliases:** `strike`, `sub`, `sup`, `mention`, `emoji`, `fnRef`.

## block builders

| builder | signature / notes |
|---|---|
| `heading` | `(level: 1-6, content)` → `{ type: 'heading', size }`; `h1`–`h6` aliases |
| `paragraph` | `(content)` |
| `codeBlock` | `(code, language?)` → `pre` (code is raw, untouched) |
| `blockquote` | `(content, credit?)` |
| `expandableBlockquote` | `(content, credit?)` — collapsed by default; takes inline content, not nested blocks |
| `divider` | `()` |
| `list` | `(items)` |
| `orderedList` | `(items, { start?, type? })` — `type`: `'a' \| 'A' \| 'i' \| 'I' \| '1'` label style |
| `taskList` | `({ text, done? }[])` — checkbox items |
| `details` | `(summary, body, { open? })` |
| `mathBlock` | `(latex)` (raw) |
| `footer` | `(content)` |
| `pullQuote` | `(content, cite?)` |
| `thinking` | `(content)` — **`sendRichMessageDraft` only**, can't appear in a sent message |
| `media` | `(src, { type?, caption?, credit?, spoiler? })` — kind inferred from the url extension (document-ish extensions → `document`, unknown → `photo`), `photo` for envelopes |
| `photo` / `video` / `audio` / `animation` / `voiceNote` / `document` | `(src, options)` — kind fixed; `spoiler` applies to photo/video/animation only |
| `map` | `(lat, long, { zoom?, width?, height?, caption?, credit? })` — defaults zoom 15, 900×450 |
| `collage` / `slideshow` | `(mediaNodes, { caption?, credit? })` |
| `table` | `(rows, { header?, align?, bordered?, striped?, compact?, caption? })` — first row is the header unless `header: false` |
| `buttonRow` | `(buttons, { align? })` — 1-8 `button(...)` nodes, `align`: `'left' \| 'center' \| 'right'` |
| `footnote` | `(id, definition)` — pairs with `footnoteRef(id)` |

**aliases:** `quote`, `pre`, `hr`, `fn`, `expandableQuote`. composition helpers: `join(items, separator?)`, `br()`.

`caption` + `credit` build a `RichBlockCaption`; a `credit` without a `caption` throws.

### buttons

`button(label, options)` is an inline node — it lives inside a text run. `buttonRow(buttons, { align? })` is the block that holds 1-8 of them. `options` takes exactly **one** action plus an optional `style` (`'danger' | 'success' | 'primary' | 'link'`, omitted means the app default):

| action | value |
|---|---|
| `url` | `string` |
| `callbackData` | `string` |
| `webApp` | `string` (the web-app url) |
| `loginUrl` | `string` (shorthand for `{ url }`) or `{ url, forwardText?, botUsername?, requestWriteAccess? }` |
| `switchInlineQuery` / `switchInlineQueryCurrentChat` | `string` |
| `switchInlineQueryChosenChat` | `{ query?, allowUserChats?, allowBotChats?, allowGroupChats?, allowChannelChats? }` |
| `copyText` | `string` |
| `disabled` | `true` |

```ts
rich([
  rich.paragraph(['press ', rich.button('me', { callbackData: 'ok', style: 'success' })]),
  rich.buttonRow([
    rich.button('open', { url: 'https://t.me' }),
    rich.button('soon', { disabled: true })
  ], { align: 'center' })
])
```

`RichError` on zero or more than one action, on an empty row, on more than 8 buttons, and on anything but `button(...)` nodes in a row. a `loginUrl` with `botUsername` emits fine as native blocks but throws on `toMarkdown()` / `toHtml()` — that field has no dialect attribute.

### media sources

media builders accept an http(s) url string **or** any puregram `MediaSource.*` envelope:

```ts
import { MediaSource } from 'puregram'

rich([
  rich.photo(MediaSource.path('./chart.png'), { caption: 'q3' }),
  rich.voiceNote(MediaSource.buffer(voice))
])
```

envelopes pass through the emitted blocks untouched; puregram core resolves them at send time (upload via `attach://`, file_id/url substituted inline). this works for `blocks[].…` media and `InputRichMessage.media[]` entries alike — serialization to a dialect string (`toMarkdown()`) throws for envelope media.

`RichMediaKind` is `'photo' | 'video' | 'audio' | 'animation' | 'voice_note' | 'document'`.

## the `Rich` envelope

```ts
class Rich {
  readonly dialect: 'blocks' | 'markdown' | 'html'
  readonly content: TelegramInputRichBlock[] | string
  readonly media?: TelegramInputRichMessageMedia[]

  get blocks(): TelegramInputRichBlock[] | undefined  // undefined for raw envelopes

  rtl(value?: boolean): this
  noEntityDetection(value?: boolean): this

  toMarkdown(): string   // blocks → rich-markdown serializer (raw md returns content as-is)
  toHtml(): string       // blocks → rich-html serializer
  toInputRichMessage(): TelegramInputRichMessage
  toJSON(): TelegramInputRichMessage
}
```

`toInputRichMessage()` → `{ blocks }` or `{ [dialect]: content, media? }`, plus `is_rtl` / `skip_entity_detection` when set.

## sending

```ts
await message.sendRich(rich.md`# ${title}`)
await message.replyWithRich(rich.md`# ${title}`)
await message.editRich(rich.md`# updated ${status}`)

await telegram.api.sendRichMessage({ chat_id, rich_message: rich.md`# ${title}` })
```

inline queries: `InputMessageContent.rich(richObject)` wraps the envelope for an inline-query result body.

## errors

- `RichError` — misuse: raw envelope composed into blocks, dialect-mismatched serialization, block builder in inline content, credit without caption, a button without exactly one action, a button row outside 1-8 buttons or holding non-button nodes, envelope media serialized to a string, parse input over the length bound
- `RichParseError extends RichError` — grammar violations in strict parses; carries `.position` and `.source`

## exported surface

```ts
import {
  rich, Rich, RichError, RichParseError,
  makeNode, isRichNode,          // custom nodes: makeNode(level, emit)
  emitText, emitBlocks,          // RichContent → RichText / InputRichBlock[]
  parseMarkdown, parseHtml,      // string → InputRichBlock[]
  serializeBlocks                // InputRichBlock[] → dialect string
} from '@puregram/rich'

import type {
  RichContent, RichNode, RichEmit, Dialect,
  RichMediaSource, RichMediaInput, RichMediaKind,
  RichParseTag, RawOptions
} from '@puregram/rich'
```

## see also

- `telegram-rich-messages` — what rich messages are, independent of puregram: every block and inline type, the wire shapes, the limits, and the markdown / html / blocks forms in parallel
- `using-puregram` — `telegram.api.*`, the three-layer api, plugin mechanics
- `rich-message-authoring` — when an **LLM** writes the dialect string for `rich.raw.*`
- `puregram-stream` — streaming drafts (`sendRichMessageDraft`)
- `puregram-markup` — entity-based formatting for plain messages
- package source: [`packages/rich/`](https://github.com/puregram/puregram/tree/v3/packages/rich)
