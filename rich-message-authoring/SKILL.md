---
name: rich-message-authoring
description: >
  use when you need an LLM to produce telegram **rich-message** content (markdown
  or html) that telegram's rich parser actually accepts — most importantly when
  streaming model output into a rich message, or when asking a model to draft
  rich content you'll send via `@puregram/rich` / `sendRichMessage`. provides a
  copy-pasteable system-prompt block that constrains output to the supported
  grammar (bold / italic / strikethrough / highlight / spoiler / code / links /
  custom emoji / math inline; headings / lists / task lists / blockquotes / code
  blocks / dividers / tables / footnotes / media / collapsible / map / collage /
  slideshow blocks; the html-tag fallbacks for underline / sub / sup / footer /
  pull quote / anchor), the exact named-entity set, the hard limits, and
  contrastive good/bad examples for the mistakes models default to.
metadata:
  author: starkow
  source: https://github.com/puregram/puregram/tree/v3/docs/plugins/rich-llm-grammar.md
---

# rich-message authoring (for LLMs)

telegram **rich messages** take a single raw markdown (or html) string and the server parses it. there is no `entities[]` array — the model's text *is* the wire format. so a model that writes rich content has to stay inside the constructs telegram's rich parser supports; everything else renders wrong, is silently stripped, or shows up as literal text.

this skill is the constraint. drop the block below into the system prompt of any call that emits rich content, then send the model's string as the `markdown` (or `html`) field of a rich message.

this skill does **not** cover the `@puregram/rich` builder api (templates, `rich.bold(...)`, the `Rich` envelope) — for that see `puregram-rich`. for streaming model output into a live message, see `puregram-stream`.

## when to use this skill

- you stream an LLM straight into a telegram rich message and need its tokens to be valid rich markdown
- you ask a model to draft rich content (a report, a formatted summary) that you'll send via `message.sendRich` / `telegram.api.sendRichMessage`
- a model keeps emitting `<div>`, `<br>`, `<button>`, unsupported entities, or escaped `<` and telegram renders it wrong
- you're deciding between the markdown and html dialects for model output (markdown is almost always right)

## the model the LLM must internalize

- rich input is **one raw string in ONE dialect** (markdown **or** html) — the server parses it
- **pick one dialect per message.** markdown is the natural target: models already emit it, and rich markdown renders headings, lists, code blocks, tables, and math
- rich markdown is GFM-compatible **and** accepts the supported html tags inline — but prefer markdown tokens, dropping to html only for features with no markdown token
- **only the constructs below exist.** any other html tag or markdown extension is unsupported — the model must not invent them

## the system prompt — markdown dialect

````text
You output Telegram rich-message content as a single Markdown string. The server
parses it. Use ONLY the constructs below — anything else renders wrong, is
stripped, or shows as literal text.

INLINE
- bold: **text** or __text__
- italic: *text* or _text_
- strikethrough: ~~text~~
- inline code: `text`
- highlight: ==text==
- spoiler: ||text||
- link: [text](https://…)  — also mailto:, tel:+…, tg://user?id=123
- custom emoji: ![](tg://emoji?id=ID)
- date-time: ![label](tg://time?unix=UNIX&format=FMT)
- inline math (raw LaTeX): $x^2 + y^2$

BLOCKS — separate each with a blank line
- headings: # … through ######
- paragraph: plain text
- code block: ```lang … ```   (language optional)
- divider: ---
- bullet list: lines starting -, *, or +
- numbered list: lines starting 1. 2. …
- task list: - [ ] todo  /  - [x] done
- blockquote: > on each line (a > blank > line breaks paragraphs inside the quote)
- media (http/https URL only): ![](https://…/photo.jpg)
  caption goes in quotes after the URL: ![](https://…/clip.mp4 "Caption")
- table (cells are inline-only):
    | A | B |
    |:--|--:|
    | a | b |
  alignment: :-- left, :-: center, --: right
- footnote: a marker text[^id] plus a definition line  [^id]: the definition
- block math (raw LaTeX): $$ E = mc^2 $$   or a ```math … ``` fence

NO MARKDOWN TOKEN → use these inline HTML tags (valid inside Markdown):
  underline <u>…</u> · subscript <sub>…</sub> · superscript <sup>…</sup>
  footer <footer>…</footer> · pull quote <aside>…<cite>author</cite></aside>
  anchor target <a name="id"></a>
  collapsible <details open><summary>…</summary> · blank line · body · blank line · </details>
  map <tg-map lat="…" long="…" zoom="…"/>
  collage <tg-collage>…media…</tg-collage> · slideshow <tg-slideshow>…media…</tg-slideshow>

DON'T WRAP THESE — Telegram auto-detects them, write them plainly:
  URLs, e-mails, @mentions, #hashtags, $CASHTAGS, /commands, phone numbers, card numbers.

NEVER
- invent tags: no <div>, <span>, <section>, <button>, <style>, <script>;
  no <br> outside a blockquote
- use inline styles, class, or id (the only allowed class is
  <code class="language-…"> nested inside <pre>)
- use markdown extensions that aren't listed: ~sub~, ^sup^, definition lists, HTML comments
- put a file_id, local path, or data: URI in media — HTTP/HTTPS only
- escape the LaTeX inside $…$ or $$…$$
- backslash-escape <, >, or & — use a numeric entity (&#60; &#62; &#38;)
- mix dialects — one message is all Markdown OR all HTML, never both

LIMITS
  ≤ 32768 characters · ≤ 500 blocks · ≤ 16 nesting levels · ≤ 50 media · ≤ 20 table columns
````

## the system prompt — html dialect

only when you've deliberately chosen html (models rarely emit telegram rich-html on their own). send the result in the `html` field instead of `markdown`.

```text
You output Telegram rich-message content as a single HTML string. The server
parses it. ONLY the tags below exist — no others.

INLINE
  <b>/<strong> bold · <i>/<em> italic · <u>/<ins> underline
  <s>/<strike>/<del> strikethrough · <code> inline code · <mark> highlight
  <sub> subscript · <sup> superscript · <tg-spoiler> spoiler
  <a href="…"> link  (https, mailto:, tel:+…, tg://user?id=… → mention, #anchor → in-document)
  <a name="…"></a> anchor target
  <tg-reference name="…">text</tg-reference> referenced/footnote text
  <tg-emoji emoji-id="…">alt</tg-emoji>  (or <img src="tg://emoji?id=…" alt=""/>)
  <tg-time unix="…" format="…">label</tg-time> date-time
  <tg-math>x^2</tg-math> inline math (raw LaTeX)

BLOCKS
  <h1>…<h6> · <p> · <pre> (language: nest <pre><code class="language-python">…</code></pre>)
  <footer> · <hr/>
  <ul><li>…</li></ul> · <ol><li>…</li></ol>  (<ol>: start, type, reversed; <li>: value, type)
  <blockquote>…<br>…<cite>Author</cite></blockquote> · <aside>…<cite>Author</cite></aside>
  media, HTTP/HTTPS only: <img src="URL"/>, <video src="URL"></video>, <audio src="URL"></audio>
    (optional tg-spoiler attribute)
  <figure><img src="URL" tg-spoiler/><figcaption>Caption<cite>Credit</cite></figcaption></figure>
  <tg-map lat="…" long="…" zoom="…"/> · <tg-collage>…media…</tg-collage> · <tg-slideshow>…media…</tg-slideshow>
  <table bordered striped><caption>…</caption><tr><th>…</th></tr>
    <tr><td colspan="2" rowspan="2" align="left|center|right" valign="top|middle|bottom">…</td></tr></table>
  <details open><summary>…</summary>body</details>  (open = expanded)
  <tg-math-block>E = mc^2</tg-math-block> block math (raw LaTeX)

ENTITIES
  All numeric entities work (&#60; etc.). The ONLY named entities are:
  &lt; &gt; &amp; &quot; &apos; &nbsp; &hellip; &mdash; &ndash; &lsquo; &rsquo; &ldquo; &rdquo;
  To show a literal < > &, use a numeric entity — never a backslash.

DON'T WRAP THESE — Telegram auto-detects them: URLs, e-mails, @mentions, #hashtags,
  $CASHTAGS, /commands, phone numbers, card numbers.

NEVER invent a tag not listed; no inline styles / class / id (except the language class on
  a <code> inside <pre>); HTTP/HTTPS media only; raw LaTeX; don't mix dialects.

LIMITS
  ≤ 32768 characters · ≤ 500 blocks · ≤ 16 nesting levels · ≤ 50 media · ≤ 20 table columns
```

## common mistakes

models default to web html. a few contrastive pairs teach the constraint faster than the rules alone.

| the model reaches for | the rich-grammar way |
|---|---|
| `<div class="card">…</div>` to group content | nothing — write a heading + paragraphs; there is no container tag |
| `line one<br>line two` for spacing | a blank line between blocks (or two list items); `<br>` only lives inside a `<blockquote>` |
| `<button>Open</button>` in the text | buttons aren't message content — they're `reply_markup`, set separately |
| `&copy;` / `&trade;` / `&rarr;` | numeric entities `&#169;` / `&#8482;` / `&#8594;` — only 13 named entities exist |
| `5 \< 10` (backslash escape) | `5 &#60; 10` — backslash renders literally; use a numeric entity |
| `![](AgACAgIAAx0…)` (a `file_id`) | an http/https url: `![](https://…/photo.jpg)` — no file ids, paths, or data URIs |
| `H~2~O`, `x^2^` (markdown sub/sup) | `H<sub>2</sub>O`, `x<sup>2</sup>` — those extensions don't exist; use the html tags |
| `$x \leq y$` escaped, or mixing `<b>bold</b>` with `**bold**` | raw LaTeX `$x \leq y$` stays as-is; pick one dialect per message |

## wiring it into a send

prepend the block to your model call, then hand the model's raw markdown to a rich message. `rich.raw.md(...)` passes the string through unchanged — exactly right for output that's already in the grammar (`rich.md(...)` would parse it client-side into native blocks and throw `RichParseError` on anything outside the grammar; `rich.md.lenient(...)` parses but degrades unknown constructs to literal text):

```ts
import { rich } from '@puregram/rich'

const markdown = await runModel(richSystemPrompt, userPrompt)

await message.sendRich(rich.raw.md(markdown))
```

without `@puregram/rich`, send the string straight through the api:

```ts
await telegram.api.sendRichMessage({
  chat_id: message.chat.id,
  rich_message: { markdown }
})
```

`rich_message` also takes `is_rtl` and `skip_entity_detection` — set `skip_entity_detection: true` if you don't want telegram auto-linking bare urls / `@mentions` / `#hashtags` in the model's text.

## source of truth

the grammar above was captured and verified against the telegram bot api rich-message anchors (`#rich-markdown-style`, `#rich-html-style`, `#rich-message-formatting-options`, `#rich-message-limits`) on 2026-06-12. the rich spec is evolving — re-verify against the live anchors before relying on it long-term, and treat telegram's docs as the source of truth over this file.

## see also

- `puregram-rich` — native-blocks builders/templates for hand-authored rich content, plus the `rich.raw.*` passthrough used here
- `puregram-stream` — stream model output into a telegram message via live edits
- `puregram-markup` — entity formatting for plain (non-rich) messages
- `using-puregram` — `telegram.api.*`, the three-layer api, `.extend(plugin)`
- docs: [`/plugins/rich-llm-grammar`](https://github.com/puregram/puregram/tree/v3/docs/plugins/rich-llm-grammar.md)
