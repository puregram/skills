---
name: telegram-rich-messages
description: >
  use when working with telegram **rich messages** in any language or SDK — the structured
  message format behind `sendRichMessage` / `sendRichMessageDraft` / `editMessageText`'s
  `rich_message`. covers the whole feature surface three ways in parallel (native `blocks`
  JSON, the rich-markdown dialect, the rich-html dialect): all 24 block types (paragraph,
  heading, pre, footer, divider, formula, anchor, list, blockquote, expandable blockquote,
  pull quote, collage, slideshow, table, details, map, button row, animation, audio,
  document, photo, video, voice note, thinking) and all 26 inline types (bold, italic,
  underline, strikethrough, spoiler, marked, code, sub, sup, url, email, phone, bank card,
  mention, hashtag, cashtag, bot command, custom emoji, date-time, math, button, anchor,
  anchor link, reference, reference link, text mention). also limits, media reuse via
  `tg://photo?id=`, entity auto-detection, rtl, drafts, ephemeral rich messages, and
  reading a received `RichMessage` back.
---

# telegram rich messages

a rich message is telegram's structured document format for bots: headings, lists, tables,
media, quotes, formulas, collapsible sections and inline buttons in a single message. it is a
different channel from ordinary `text` + `entities` — richer, with its own methods, its own
limits and its own two text dialects.

## when to use this skill

- authoring or debugging any `rich_message` payload, in any language
- deciding between `blocks`, `markdown` and `html` for a given feature
- a construct renders wrong, is silently dropped, or the api rejects it
- reading a `RichMessage` telegram sent back and mapping it to what you built
- porting rich-message code between SDKs

for constraining an **LLM** to emit valid rich content, see `rich-message-authoring`. for the
`@puregram/rich` builder API specifically, see `puregram-rich`.

## the model

```
InputRichMessage          what you send
  blocks?  InputRichBlock[]      native structure
  html?    string                the rich-html dialect
  markdown? string               the rich-markdown dialect
  media?   InputRichMessageMedia[]   files referenced by tg:// links in html/markdown
  is_rtl?  bool
  skip_entity_detection? bool

RichMessage               what you get back
  blocks   RichBlock[]           telegram's parse of whatever you sent
  is_rtl?  bool
```

**exactly one of `blocks`, `html`, `markdown`.** sending two is an error. all three converge on
the same `RichBlock[]`, so the returned `blocks` are the ground truth for what telegram
understood — the fastest way to debug a dialect string is to send it and read the result.

input and output types differ: you send `InputRichBlockPhoto { photo: InputMediaPhoto }`, you
get back `RichBlockPhoto { photo: PhotoSize[] }`. same `type` discriminator, different payload.

### methods

| method | rich field | notes |
|---|---|---|
| `sendRichMessage` | `rich_message` (required) | the main send. returns the `Message`, whose `rich_message` holds the parse |
| `sendRichMessageDraft` | `rich_message` (required) | 30-second animated preview, private chats only. `draft_id`, `can_stop`, `keep_on_stop` |
| `editMessageText` | `rich_message` (optional) | supply this **or** `text`, not both |
| `editEphemeralMessageText` | `rich_message` (optional) | same, for ephemeral messages |

`sendRichMessage` also takes `ephemeral_message_parameters`, so a rich message can be visible
to a single user in a group.

## limits

| limit | value |
|---|---|
| text length | 32768 UTF-8 chars, counting custom-emoji alt text and formula source |
| blocks | 500, including nested blocks, list items, table rows, quote and details blocks |
| nesting | 16 levels of formatting and blocks |
| media attachments | 50 total |
| table columns | 20 |
| buttons per row | 1–8 |
| callback data | 1–64 bytes |

## the three ways, side by side

one message, four representations. this is the whole skill in miniature:

**native blocks**

```json
{ "blocks": [
  { "type": "heading", "size": 2, "text": "report" },
  { "type": "paragraph", "text": [
    "speed is ",
    { "type": "bold", "text": "42" },
    { "type": "superscript", "text": "ms" }
  ] },
  { "type": "divider" }
] }
```

**rich markdown**

```markdown
## report

speed is **42**<sup>ms</sup>

---
```

**rich html**

```html
<h2>report</h2>
<p>speed is <b>42</b><sup>ms</sup></p>
<hr/>
```

**puregram builder** (emits the native blocks above)

```ts
rich([
  rich.h2('report'),
  rich.paragraph(['speed is ', rich.bold('42'), rich.sup('ms')]),
  rich.divider()
])
```

pick `blocks` when you are generating structure programmatically — it is unambiguous and needs
no escaping. pick a dialect when the content is authored as text, or when a model produced it.

## inline text — all 26 types

`RichText` is recursively `string | RichText[] | node`. nodes nest freely except where noted.

| wire `type` | fields | markdown | html |
|---|---|---|---|
| `bold` | `text` | `**x**` / `__x__` | `<b>` `<strong>` |
| `italic` | `text` | `*x*` / `_x_` | `<i>` `<em>` |
| `underline` | `text` | — | `<u>` `<ins>` |
| `strikethrough` | `text` | `~~x~~` | `<s>` `<strike>` `<del>` |
| `spoiler` | `text` | `\|\|x\|\|` | `<tg-spoiler>` |
| `marked` | `text` | `==x==` | `<mark>` |
| `code` | `text` | `` `x` `` | `<code>` |
| `subscript` | `text` | — | `<sub>` |
| `superscript` | `text` | — | `<sup>` |
| `url` | `text`, `url` | `[x](https://t.me/)` | `<a href="…">` |
| `email_address` | `text`, `email_address` | `[x](mailto:a@b.c)` | `<a href="mailto:…">` |
| `phone_number` | `text`, `phone_number` | `[x](tel:+1…)` | `<a href="tel:…">` |
| `text_mention` | `text`, `user` | `[x](tg://user?id=1)` | `<a href="tg://user?id=1">` |
| `custom_emoji` | `custom_emoji_id`, `alternative_text` | `![👍](tg://emoji?id=…)` | `<tg-emoji emoji-id="…">👍</tg-emoji>` |
| `date_time` | `text`, `unix_time`, `date_time_format` | `![22:45](tg://time?unix=…&format=wDT)` | `<tg-time unix="…" format="wDT">` |
| `mathematical_expression` | `expression` | `$x^2$` | `<tg-math>x^2</tg-math>` |
| `button` | `button` | — (use the html tag) | `<tg-button type="…">` |
| `anchor` | `name` | — (use the html tag) | `<a name="chapter-1"></a>` |
| `anchor_link` | `text`, `anchor_name` | `[x](#chapter-1)` | `<a href="#chapter-1">` |
| `reference` | `text`, `name` | `[^id]: definition` | `<tg-reference name="id">` |
| `reference_link` | `text`, `reference_name` | `[^id]` | `<a href="#id">` |
| `mention` | `text`, `username` | auto-detected from `@name` | auto |
| `hashtag` | `text`, `hashtag` | auto-detected from `#tag` | auto |
| `cashtag` | `text`, `cashtag` | auto-detected from `$USD` | auto |
| `bot_command` | `text`, `bot_command` | auto-detected from `/cmd` | auto |
| `bank_card_number` | `text`, `bank_card_number` | auto-detected | auto |

the last five are **detection results**, not things you author: telegram finds them in plain
characters and hands them back in the parsed `blocks`. `skip_entity_detection: true` turns that
off, and urls/emails/phones are detected the same way when written bare.

`underline`, `subscript` and `superscript` have no markdown syntax — use the html tag inside
markdown, which is explicitly supported. same for buttons and anchors.

### nesting rules

`bold`, `italic`, `underline`, `strikethrough`, `spoiler` and `marked` nest with each other and
with anything else. `code` and `pre` do not take nested formatting. inside a markdown document,
**inline** html tags do parse nested markdown:

```markdown
<u>In inline tags, nested **markdown** is parsed</u>
```

but **block** html tags do not, except `<details>`, `<tg-collage>` and `<tg-slideshow>`. inside
any other block tag, only html works.

## blocks — all 24 types

| wire `type` | fields | markdown | html |
|---|---|---|---|
| `paragraph` | `text` | a bare line | `<p>` |
| `heading` | `text`, `size` 1–6 | `#`…`######` | `<h1>`…`<h6>` |
| `pre` | `text`, `language?` | ` ```lang ` fence | `<pre><code class="language-x">` |
| `footer` | `text` | — | `<footer>` |
| `divider` | — | `---` | `<hr/>` |
| `mathematical_expression` | `expression` | `$$E=mc^2$$` or a ` ```math ` fence | `<tg-math-block>` |
| `anchor` | `name` | — | `<a name="x"></a>` |
| `list` | `items[]` | `-` / `*` / `+`, `1.`, `- [ ]`, `- [x]` | `<ul>` `<ol>` `<li>` |
| `blockquote` | `blocks[]`, `credit?` | `>` lines | `<blockquote>` + `<cite>` |
| `expandable_blockquote` | `text`, `credit?` | — | `<blockquote expandable>` |
| `pullquote` | `text`, `credit?` | — | `<aside>` + `<cite>` |
| `collage` | `blocks[]`, `caption?` | `<tg-collage>` | `<tg-collage>` |
| `slideshow` | `blocks[]`, `caption?` | `<tg-slideshow>` | `<tg-slideshow>` |
| `table` | `cells[][]`, `is_bordered?`, `is_striped?`, `is_compact?`, `caption?` | gfm pipe table | `<table>` `<tr>` `<th>` `<td>` |
| `details` | `summary`, `blocks[]`, `is_open?` | `<details open>` | `<details open>` |
| `map` | `location`, `zoom?`, `width?`, `height?`, `caption?` | `<tg-map/>` | `<tg-map lat long zoom/>` |
| `buttons` | `buttons[]`, `align?` | `<tg-button-row>` | `<tg-button-row align="…">` |
| `photo` | `photo`, `caption?` | `![](url.jpg)` | `<img src>` |
| `video` | `video`, `caption?` | `![](url.mp4)` | `<video src>` |
| `animation` | `animation`, `caption?` | `![](url.gif)` | `<video src>` |
| `audio` | `audio`, `caption?` | `![](url.mp3)` | `<audio src>` |
| `voice_note` | `voice_note`, `caption?` | `![](url.ogg)` | `<audio src>` |
| `document` | `document`, `caption?` | `![](url.zip)` | `<tg-document src>` |
| `thinking` | `text` | — | `<tg-thinking>` (drafts only) |

media type is decided by the url and MIME type, which is why one markdown `![]()` covers six
block types. `expandable_blockquote`, `pullquote`, `footer` and `thinking` have no markdown
syntax at all — reach for the html tag.

### quotes, three kinds

```json
{ "type": "blockquote", "blocks": [{ "type": "paragraph", "text": "collapsible? no" }], "credit": "me" }
{ "type": "expandable_blockquote", "text": "collapsed until tapped", "credit": "me" }
{ "type": "pullquote", "text": "a visual aside", "credit": "me" }
```

```html
<blockquote>collapsible? no<cite>me</cite></blockquote>
<blockquote expandable>collapsed until tapped<cite>me</cite></blockquote>
<aside>a visual aside<cite>me</cite></aside>
```

```markdown
>collapsible? no
>
>a second paragraph of the same quote
```

note the shape difference: `blockquote` nests **blocks**, while `expandable_blockquote` and
`pullquote` take **inline text**. only `blockquote` has markdown syntax, and that syntax has no
credit slot.

```ts
rich.blockquote('collapsible? no', 'me')          // blocks + credit
rich.expandableBlockquote('collapsed until tapped', 'me')
rich.pullQuote('a visual aside', 'me')
```

### lists

one `list` type covers bullets, numbers and checkboxes — the item fields decide which.

```json
{ "type": "list", "items": [
  { "blocks": [{ "type": "paragraph", "text": "plain bullet" }] },
  { "blocks": [{ "type": "paragraph", "text": "third" }], "value": 3, "type": "1" },
  { "blocks": [{ "type": "paragraph", "text": "done" }], "has_checkbox": true, "is_checked": true }
] }
```

```markdown
- plain bullet
3. third
- [x] done
```

```html
<ul><li>plain bullet</li></ul>
<ol><li value="3" type="1">third</li></ol>
<ul><li><input type="checkbox" checked>done</li></ul>
```

item `type` is the label style: `a`, `A`, `i`, `I` or `1`. `<ol start="3" type="a" reversed>`
sets it for the whole list. items hold **blocks**, so a list item can contain anything.

```ts
rich.list(['plain bullet'])
rich.orderedList(['third'], { start: 3 })
rich.taskList([{ text: 'done', done: true }])
```

### tables

```json
{ "type": "table", "is_compact": true, "caption": "timings",
  "cells": [
    [{ "text": "metric", "is_header": true, "align": "left", "valign": "middle" }],
    [{ "text": "speed", "align": "left", "valign": "middle" }]
  ] }
```

```markdown
| metric | value |
|:-------|------:|
| speed  | **42** <sup>ms</sup> |
```

```html
<table bordered striped compact><caption>timings</caption>
<tr><th>metric</th><th>value</th></tr>
<tr><td colspan="2" align="center" valign="top">42</td></tr>
</table>
```

**cells hold inline formatting only** — no nested blocks. `align` and `valign` are required on
the wire; `colspan`/`rowspan` are optional. markdown carries alignment via `:---`/`:-:`/`---:`
and nothing else: `is_bordered`, `is_striped`, `is_compact` and the caption have no markdown
slot and are dropped. the first markdown row is always the header.

```ts
rich.table([['metric', 'value'], ['speed', '42']], { compact: true, bordered: true })
```

### buttons

buttons live **inside** the message, unlike `reply_markup`. two placements: inline in a text
run, or a standalone row.

```json
{ "type": "paragraph", "text": [
  "the ", { "type": "button", "button": { "text": "terms", "url": "https://telegram.org/tos" } }, " apply"
] }

{ "type": "buttons", "align": "center", "buttons": [
  { "text": "free", "callback_data": "plan:free" },
  { "text": "pro", "callback_data": "plan:pro", "style": "primary" },
  { "text": "soon", "disabled": {} }
] }
```

```html
<p>the <tg-button type="url" url="https://telegram.org/tos">terms</tg-button> apply</p>

<tg-button-row align="center">
  <tg-button type="callback_data" data="plan:free">free</tg-button>
  <tg-button type="callback_data" style="primary" data="plan:pro">pro</tg-button>
  <tg-button type="disabled">soon</tg-button>
</tg-button-row>
```

markdown has **no** button syntax — use the html tags, which are valid inside a markdown
document.

```ts
rich.paragraph(['the ', rich.button('terms', { url: 'https://telegram.org/tos' }), ' apply'])
rich.buttonRow([
  rich.button('free', { callbackData: 'plan:free' }),
  rich.button('pro', { callbackData: 'plan:pro', style: 'primary' }),
  rich.button('soon', { disabled: true })
], { align: 'center' })
```

**exactly one action per button**, from: `url`, `callback_data`, `web_app`, `login_url`,
`switch_inline_query`, `switch_inline_query_current_chat`, `switch_inline_query_chosen_chat`,
`copy_text`, `disabled`. plus optional `style`: `danger`, `success`, `primary`, `link`
(borderless — **callback buttons only**). apps pick theme colors from the style.

| action | html attributes |
|---|---|
| `url` | `type="url" url="…"` |
| `callback_data` | `type="callback_data" data="…"` |
| `web_app` | `type="web_app" url="…"` — private chats only |
| `login_url` | `type="login_url" url="…" forward-text="…" request-write-access` — not for ephemeral messages |
| `switch_inline_query` | `type="switch_inline_query" query="…"` |
| `switch_inline_query_current_chat` | `type="switch_inline_query_current_chat" query="…"` |
| `switch_inline_query_chosen_chat` | `type="switch_inline_query_chosen_chat" query="…" allow-user-chats allow-bot-chats allow-group-chats allow-channel-chats` |
| `copy_text` | `type="copy_text" text="…"` |
| `disabled` | `type="disabled"` |

button labels accept plain text, `custom_emoji` and `date_time` only. `login_url.bot_username`
has no dialect attribute — send such a button as native blocks.

**buttons are effectively bot-only.** everything above holds when a *bot* sends the message.
sending the same markdown from a **user account** over mtproto behaves differently, verified
side by side against both surfaces:

| | bot | user account |
|---|---|---|
| `url`, `copy_text` in a `<tg-button-row>` | works | works |
| `callback_data`, `switch_inline_query` | works | `400 BUTTON_TYPE_INVALID` |
| `style` — `primary` / `danger` / `success` | preserved | preserved |
| `style="link"` | works (callback buttons only) | dropped, since callback buttons are unavailable |
| inline `<tg-button>` inside a paragraph | works, yields a `button` text node | renders the literal string `[object Object]` |

the callback rejection is the expected consequence of user accounts having no callback-query
channel, but the inline-button case is a serialization bug rather than a refusal — it fails
silently and puts `[object Object]` in front of the reader. an unsupported `type` is not
silent either: it takes the whole message down with `BUTTON_TYPE_INVALID`. so from a user
account, `url` and `copy_text` rows are the usable set, and they keep their colors. when you
render untrusted or model-generated markdown, drop rows whose buttons use any other action and
unwrap any `<tg-button>` that is not inside a `<tg-button-row>`.

### media

six media block types, one caption shape (`{ text, credit? }`).

```json
{ "type": "photo", "photo": { "type": "photo", "media": "https://x/p.jpg" },
  "caption": { "text": "a photo", "credit": "the author" } }
```

```markdown
![](https://x/p.jpg "a photo")
```

```html
<figure><img src="https://x/p.jpg" tg-spoiler/><figcaption>a photo<cite>the author</cite></figcaption></figure>
```

```ts
rich.photo('https://x/p.jpg', { caption: 'a photo', credit: 'the author' })
rich.document('https://x/d.zip', { caption: 'a file' })
```

rules that bite:

- **media is a block.** it can never sit inside a paragraph or a table cell.
- **photo / video / audio accept http(s) urls in a dialect; documents do not.** verified against
  the live api: `![](https://…/logo.png)` yields a `photo`, but `<tg-document src="https://…">`
  answers `RICH_MESSAGE_DOCUMENT_NO_MEDIA_FOUND`. a document in a dialect string **must** go
  through `media[]`:

  ```json
  { "markdown": "<tg-document src=\"tg://document?id=note\"></tg-document>",
    "media": [{ "id": "note", "media": { "type": "document", "media": "<file_id or attach://…>" } }] }
  ```

  the link forms are `tg://photo?id=`, `tg://video?id=`, `tg://document?id=` and
  `tg://audio?id=` — those four only; `tg://animation?id=` is not recognized (it falls through to
  photo handling). ids are 1–64 chars of `A-Z a-z 0-9 _ -`. in puregram, `RichMedia.document(id,
  src)` builds the entry and `RichMedia.link('document', id)` builds the reference, so the id is
  written once.
- markdown's `![](url "caption")` has no slot for `credit` or a spoiler; both drop.
- `collage` and `slideshow` group media blocks and take their own caption.

### collapsible, map, footer, formulas

```html
<details open><summary>Title</summary>markdown works in here</details>
<tg-map lat="41.9" long="12.5" zoom="14"/>
<footer>Footer text</footer>
<tg-math-block>E = mc^2</tg-math-block>
```

`<details>` body is full rich content, and markdown **is** parsed inside it (one of the three
exceptions). formula source is raw LaTeX, never escaped or parsed. map `zoom` is 0–24, `width`
and `height` 0–10000.

### footnotes and anchors

two separate mechanisms that look similar:

```markdown
Text with a reference[^id1].

[^id1]: Definition of the first footnote.
```

```html
<a href="#note-1">Reference</a> … <tg-reference name="note-1">Referenced text</tg-reference>
<a name="chapter-1"></a> … <a href="#chapter-1">in-document link</a>
```

`reference` + `reference_link` are footnotes. `anchor` + `anchor_link` are in-document jumps. on
the wire a footnote definition is a `paragraph` whose entire text is one `reference` node.

## drafts

`sendRichMessageDraft` shows an animated 30-second preview and returns `true`, not a message.
same `draft_id` animates; a different one replaces without animation. **private chats only.**
you must send a real message afterwards to persist anything.

`<tg-thinking>` / `{ "type": "thinking" }` is valid **only** in a draft.

`can_stop: true` renders a Stop button and delivers a `stopped_message_generation` update
(`chat`, `message_thread_id?`, `draft_id`) when pressed. `keep_on_stop: true` keeps the draft
visible briefly after the press — to actually preserve the partial answer, send it as a real
message.

## reading a received rich message

`Message.rich_message` is a `RichMessage` with telegram's parse. because all three input forms
converge there, comparing it against what you built is the most reliable debugging move
available — and the only way to confirm a dialect string parsed the way you intended.

```ts
const sent = await tg.api.sendRichMessage({ chat_id, rich_message: { html: source } })

console.log(sent.rich_message?.blocks.map(b => b.type))
```

output payloads differ from input ones: `photo` returns `PhotoSize[]`, `document` returns a
`Document` with a `file_id`, and detected entities (`mention`, `hashtag`, …) appear that you
never wrote.

## escaping

**markdown**: a preceding `\` escapes the markdown metacharacters — verified for
``\ ` * _ [ ] ( ) ~ = | $ ! # + - > .`` , each of which renders as the bare character. two
exceptions bite:

- **`\` does not escape a line-start ordered list.** `\1. o` renders with the backslash
  showing. escape the delimiter instead — `1\. o` — which suppresses the list and renders
  clean. `\#`, `\-`, `\+` and `\>` at line start do work.
- **`\<` renders with the backslash showing.** to keep a literal `<` that must not open a tag,
  use `&#60;` (and `&#38;` for `&`).

`<`, `>` and `&` in ordinary text need no escaping at all — they render literally. entities are
only needed to stop a sequence being read as a tag. a raw `|` splits a table cell; a blank line
ends a single-line construct.

**html**: all **numeric** entities work. the only supported **named** entities are `&lt;`
`&gt;` `&amp;` `&quot;` `&apos;` `&nbsp;` `&hellip;` `&mdash;` `&ndash;` `&lsquo;` `&rsquo;`
`&ldquo;` `&rdquo;`. anything else is rejected.

## gotchas

- **one input form only.** `blocks` + `markdown` together is an error.
- **`skip_entity_detection`** is the only way to stop telegram linkifying urls, `@names`,
  `#tags`, `$CASH`, `/commands`, emails, phone numbers and card numbers in your text.
- **clients warn on inline links.** telegram shows an "Open this link?" prompt with the full
  url before following one.
- **markdown is not parsed inside block html tags** except `<details>`, `<tg-collage>` and
  `<tg-slideshow>`. inline html tags do parse it.
- **`<pre>` needs a nested `<code class="language-x">`** to set a language; a standalone
  `<code>` cannot carry one.
- **a code fence does not protect the enclosing container's closing tag.** a literal
  `</details>` inside a ` ``` ` fence nested in a `<details>` closes the block early and the
  whole send is rejected with `RICH_MESSAGE_CONTENT_REQUIRED` — it is a hard error, not a
  render glitch. an *opening* `<details>` in the same position is worse: it silently swallows
  every following block into the collapsed section. any other html, e.g. `<b>x</b>`, is
  literal inside a fence as expected. when you fence untrusted text inside a container, break
  its closing tags first (a zero-width space after the `<` works and is invisible).
- **numeric entities are not decoded inside a fence or `<pre>`.** `&#60;` renders as the four
  literal characters, so you cannot entity-escape fenced content — see the previous point for
  what to do instead.
- **link destinations are fragile.** a space anywhere in the destination destroys the link and
  the whole construct falls back to literal text with the url exposed. the CommonMark angle
  form `[x](<url>)` is **not** supported and also drops the link. balanced parens
  (`…/Foo_(bar)`) do work, and `%28`/`%29` work — but note `encodeURIComponent` leaves parens
  untouched, so percent-encode them yourself if you are sanitising a destination.
- **table cells and button labels are inline-only.** no blocks inside either.
- **`thinking` is draft-only**; sending it via `sendRichMessage` fails.
- **markdown silently drops** `is_bordered` / `is_striped` / `is_compact`, table captions, media
  credits and media spoilers. use `blocks` or html when those matter.
- **an empty `<a name="x"></a>`** on its own line is an anchor, not a link.
- **a returned `document` block carries its payload under `audio`.** telegram answers
  `{ "type": "document", "audio": { file_id, file_name, mime_type, file_size } }` even though
  `RichBlockDocument` declares the key as `document`. verified against the live api with
  `text/plain`, `application/zip` and `application/json` — read both keys when parsing a received
  rich message. the send side is unaffected; `InputRichBlockDocument.document` is correct.

## version floors

verified against the committed schema snapshots, not from memory:

| construct | first in |
|---|---|
| `sendRichMessage`, `sendRichMessageDraft`, `InputRichMessage` (`html` / `markdown` only) | 10.1 |
| the native `blocks` input path — every `InputRichBlock*` class | 10.2 |
| `media[]` + the `tg://photo?id=` style links | 10.2 |
| `thinking` block | 10.2 |
| `buttons` block, inline `button` text node, `RichMessageButton` | 10.3 |
| `expandable_blockquote` | 10.3 |
| `document` block, `tg://document?id=` | 10.3 |
| `table.is_compact` | 10.3 |
| `can_stop` / `keep_on_stop` on both draft methods | 10.3 |

so on a 10.1 server rich messages exist but you can only author them as dialect strings — there
is no `blocks` array to send.

## see also

- `rich-message-authoring` — constraining an LLM to emit valid rich content
- `puregram-rich` — the `@puregram/rich` builder API
- `puregram-stream` — streaming model output into rich drafts
- [rich message formatting options](https://core.telegram.org/bots/api#rich-message-formatting-options)
