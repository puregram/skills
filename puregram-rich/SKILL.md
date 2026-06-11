---
name: puregram-rich
description: >
  use when working with `@puregram/rich` in puregram v3 — a safe tagged-template
  emitter for telegram's rich messages (structured content with headings, lists,
  code blocks, math formulas, spoilers, collapsible blocks, and more). covers the
  `rich` namespace (`md` / `markdown` / `html` template tags), every implemented
  inline builder (`bold` / `italic` / `underline` / `strikethrough` / `spoiler` /
  `code` / `marked` / `subscript` / `superscript` / `link` / `mentionUser` /
  `math` / `customEmoji` / `time` / `reference` / `anchor`), every block builder
  (`heading` / `paragraph` / `codeBlock` / `blockquote` / `divider` / `list` /
  `orderedList` / `details` / `mathBlock`), composition helpers (`join` / `br`),
  the `Rich` envelope with `.rtl()` / `.noEntityDetection()` / `.toInputRichMessage()`,
  and the escaping rules that make string interpolation safe.
metadata:
  author: nitreojs
  source: https://github.com/puregram/puregram/tree/v3/packages/rich
  package: "@puregram/rich"
---

# `@puregram/rich`

safe emitter for telegram's rich messages. telegram accepts a single raw html or markdown string; `@puregram/rich` makes authoring ergonomic and injection-proof: template literal text passes through raw (the server parses it), while interpolated `${…}` values are automatically escaped (strings) or rendered (builder nodes).

result is a `Rich` envelope. call `.toInputRichMessage()` to get the `TelegramInputRichMessage` shape.

## when to use this skill

- sending rich messages (headings, lists, code blocks, formulas, spoilers, collapsible blocks, …)
- you want safe interpolation of user data into a rich-message template without hand-escaping
- you're choosing between the `md` and `html` dialects and need to know which builders render how
- you need to use `message.sendRich` / `message.replyWithRich` / `message.editRich` or pass a `Rich` to `telegram.api.sendRichMessage`
- you need right-to-left support or want to disable telegram's automatic entity detection on a message

this skill does **not** cover plain-text entity formatting (`bold`, `italic`, `parse_mode`). for that see `puregram-markup`. for `telegram.extend` / plugin mechanics see `using-puregram`.

## quick start

```ts
import { rich } from '@puregram/rich'

// inside a message handler
await message.sendRich(rich.md`
  # ${title}

  ${rich.bold('status:')} ${status}

  ${rich.list(items)}
`)
```

`@puregram/rich` depends on `@puregram/api` for types. `Rich` implements `RichLike`, so it passes directly into any `rich_message` field without calling `.toInputRichMessage()` first.

## the `rich` namespace

everything lives under one named import:

```ts
import { rich } from '@puregram/rich'
```

### template tags

```ts
rich.md`…`        // markdown dialect → Rich { dialect: 'markdown', content: '…' }
rich.markdown`…`  // alias of rich.md
rich.html`…`      // html dialect → Rich { dialect: 'html', content: '…' }
```

calling a tag as a plain function skips escaping and dedent — the string is wrapped as-is:

```ts
rich.md('# already formatted')
```

### interpolation rules

| interpolated value | what happens |
|---|---|
| `string` | dialect-escaped → cannot inject formatting |
| `number` | stringified, then escaped |
| builder node (`RichNode`) | rendered to the template's dialect |
| `Rich` | inlined as-is; mismatch with template dialect throws `RichError` |
| `RichContent[]` | each item rendered and concatenated |
| `null` / `undefined` / `false` | empty string |

template strings are **dedented** — the common leading indentation shared by all literal lines is stripped, so multi-line authoring reads naturally at any indent level.

**escape sets:**

- markdown: backslash-escapes `` \ ` * _ ~ = | [ ] ( ) # > ! + - < ``
- html: `& < > "` → numeric entities (`&#38;` etc.)

because strings are always escaped, `${userInput}` is safe in both dialects.

## inline builders

all inline builders are under `rich.*`. content args accept `RichContent` (string / number / node / Rich / array / falsy).

| builder | markdown | html |
|---|---|---|
| `rich.bold(x)` | `**x**` | `<b>x</b>` |
| `rich.italic(x)` | `*x*` | `<i>x</i>` |
| `rich.underline(x)` | `<u>x</u>` | `<u>x</u>` |
| `rich.strikethrough(x)` | `~~x~~` | `<s>x</s>` |
| `rich.spoiler(x)` | `\|\|x\|\|` | `<tg-spoiler>x</tg-spoiler>` |
| `rich.code(x)` | `` `x` `` | `<code>x</code>` |
| `rich.marked(x)` | `==x==` | `<mark>x</mark>` |
| `rich.subscript(x)` | `<sub>x</sub>` | `<sub>x</sub>` |
| `rich.superscript(x)` | `<sup>x</sup>` | `<sup>x</sup>` |
| `rich.link(text, url)` | `[text](url)` | `<a href="url">text</a>` |
| `rich.mentionUser(text, userId)` | `[text](tg://user?id=…)` | `<a href="tg://user?id=…">text</a>` |
| `rich.math(latex)` | `$latex$` | `<tg-math>latex</tg-math>` |
| `rich.customEmoji(id, alt)` | `![alt](tg://emoji?id=…)` | `<tg-emoji emoji-id="…">alt</tg-emoji>` |
| `rich.time(label, unix, format?)` | `![label](tg://time?unix=…)` | `<tg-time unix="…">label</tg-time>` |
| `rich.reference(text, name)` | `[text](#name)` | `<a href="#name">text</a>` |
| `rich.anchor(name)` | `<a name="…"></a>` | `<a name="…"></a>` |

`underline`, `subscript`, `superscript`, and `anchor` have no markdown token — they emit html even inside `rich.md` (rich-markdown accepts inline html).

## block builders

| builder | signature | notes |
|---|---|---|
| `rich.heading` | `(level: 1\|2\|3\|4\|5\|6, content: RichContent)` | `#…######` / `<h1>…<h6>` |
| `rich.paragraph` | `(content: RichContent)` | bare text in md / `<p>` in html |
| `rich.codeBlock` | `(code: string, language?: string)` | fenced ` ``` ` / `<pre><code class="language-…">` |
| `rich.blockquote` | `(content: RichContent)` | `>` prefix per line / `<blockquote>` |
| `rich.divider` | `()` | `---` / `<hr/>` |
| `rich.list` | `(items: RichContent[])` | `- ` / `<ul>` |
| `rich.orderedList` | `(items: RichContent[], options?: { start?: number })` | `1.` / `<ol start="…">` |
| `rich.details` | `(summary: RichContent, body: RichContent, options?: { open?: boolean })` | `<details><summary>` (legal in both dialects) |
| `rich.mathBlock` | `(latex: string)` | `$$…$$` / `<tg-math-block>` |

`codeBlock` and `mathBlock` do **not** escape the `code` / `latex` arg — those values are trusted raw content by design.

## composition helpers

### `rich.join(items, separator?)`

```ts
rich.join(items: RichContent[], separator?: string | RichNode): RichNode
```

joins items with a separator. when any item is a block node, separator is replaced with `\n`; otherwise items concat with the given separator (default `''`). level of the returned node is `block` if any item is a block, `inline` otherwise.

```ts
rich.md`tags: ${rich.join(tags.map(t => rich.code(t)), ', ')}`
```

### `rich.br()`

line break — `<br>` in html, `\n` in markdown. useful inside `blockquote` or joined inline runs:

```ts
rich.html`${rich.blockquote([
  'first line',
  rich.br(),
  rich.italic('second line')
])}`
```

## the `Rich` envelope

```ts
class Rich {
  readonly dialect: 'markdown' | 'html'
  readonly content: string

  rtl(value?: boolean): this
  noEntityDetection(value?: boolean): this

  toInputRichMessage(): TelegramInputRichMessage
  // → { markdown?: string } | { html?: string } (+ is_rtl?, skip_entity_detection?)

  toJSON(): TelegramInputRichMessage
}
```

```ts
const r = rich.md`# ${heading}`

r.toInputRichMessage()
// → { markdown: '# My heading' }

r.rtl().noEntityDetection().toInputRichMessage()
// → { markdown: '# My heading', is_rtl: true, skip_entity_detection: true }
```

## sending

per-update shortcuts fill `chat_id` and `message_id` automatically:

```ts
// send a rich message in the same chat
await message.sendRich(rich.md`# ${title}`)

// reply to the incoming message
await message.replyWithRich(rich.md`# ${title}`)

// edit the bot's own message to rich content
await message.editRich(rich.md`# updated ${status}`)
```

a `Rich` can also be passed directly to `telegram.api.sendRichMessage` — `rich_message` accepts `TelegramInputRichMessage | RichLike` and `Rich` implements `RichLike`:

```ts
await telegram.api.sendRichMessage({
  chat_id,
  rich_message: rich.md`# ${title}`
})
```

`.toInputRichMessage()` is available as the low-level escape hatch when you need the raw shape.

## non-goals

- no parsing of the literal template text (the server parses the final string)
- no client-side validation of server limits
- no entity tree for the input side (`TelegramRichText` / `TelegramPageBlock` are output-only — received inside `Message.rich_message`)
- tables, media, `pullQuote`, `footer`, `taskList`, `map`, `collage`, `slideshow` are specified but not yet implemented — they'll be added incrementally

## exported surface

```ts
import {
  rich,         // the authoring namespace (md / markdown / html + all builders)
  Rich,         // the Rich envelope class
  RichError,    // thrown on dialect-mismatch interpolation
  makeNode,     // low-level: construct a RichNode directly
  isRichNode    // type guard
} from '@puregram/rich'

import type {
  RichContent,  // string | number | RichNode | Rich | null | undefined | false | RichContent[]
  RichNode,     // { level: 'inline' | 'block'; render(dialect: Dialect): string }
  Dialect       // 'markdown' | 'html'
} from '@puregram/rich'
```

## errors

`RichError` is thrown when:
- a `Rich` value with the wrong dialect is interpolated into a template (e.g. an `html` envelope inside `rich.md\`\``)
- unsupported content type is passed as `RichContent`

## see also

- `using-puregram` — covers `telegram.api.*`, the three-layer api, and plugin mechanics
- `puregram-markup` — entity-based formatting for plain messages (no `parse_mode`)
- package source: [`packages/rich/`](https://github.com/puregram/puregram/tree/v3/packages/rich)
