---
name: puregram-widgets
description: >
  Use for @puregram/widgets in puregram v3: defineWidget, html/js/raw interpolation,
  WidgetHtml size preflight, typed chat/public state codecs, per-message templates,
  sendWidget/sendSharedWidget, widget_query/shared_widget_query handlers, queryData
  routing and widgets auto-answering. Use whenever writing or debugging this SDK's
  embedded HTML message widgets. Not website Login/Post widgets, Mini Apps
  (Telegram.WebApp), rich-message blocks, or general Telegram widget protocol rules.
metadata:
  source: https://github.com/puregram/puregram/tree/v3/packages/widgets
  package: "@puregram/widgets"
  verified_source_version: "3.0.0"
  bot_api: "10.4"
---

# `@puregram/widgets`

SDK companion for embedded HTML **message** widgets. Read sibling `telegram-widgets`
for the authoritative server/client contract, all limits, availability, sandbox,
wallet security and supported HTML/CSS/JavaScript profile. Read `using-puregram` for
client startup/transport/errors; use `telegram-bot-api` for exact raw method fields.
Do not substitute `@puregram/markup`, `@puregram/rich`, legacy website widgets, or
`window.Telegram.WebApp`: this surface uses `window.TelegramWidget`.

## Version and source boundary

Verified on 2026-11-10 against public source commit
[`765ed27a554fc22aa97ae372cd15cfdc1c433c3a`](https://github.com/puregram/puregram/tree/765ed27a554fc22aa97ae372cd15cfdc1c433c3a/packages/widgets),
whose package metadata says **3.0.0**, with the accompanying puregram and
`@puregram/api` sources. This is a source pin, not proof of npm publication or
exports available in a consumer's installed dependencies. Check their package
metadata and `.d.ts` files before generating code. The package is ESM, Node >=22,
with one public entry point `@puregram/widgets`; do not import private `src` paths.
No lookup executable ships with this skill. Existing sibling skills provide API
and installed-SDK lookup tools.

Current production widgets are limited to private chats with the bot; group,
inline and forwarding workflows are test-server-only. Recheck
[availability](https://core.telegram.org/bots/widgets#availability) when that matters.
An SDK method existing does not make a server feature generally available.

## Pick the surface

| Task | Actual API |
|---|---|
| Fixed HTML with typed initial state | ``defineWidget({ html: html`…`, chat: json<C>(), public: json<P>() })`` |
| Immutable HTML differing per message | ``defineWidget({ html: (args: A) => html`…`, … }).render(args)`` |
| Send a definition | `tg.sendWidget(chatId, Definition, options)` / `message.sendWidget(Definition, options)` |
| Reply / topic-scoped send | `message.replyWithWidget(Definition, options)` / `message.thread?.sendWidget(Definition, options)` |
| Send existing shared widget | `Definition.sendShared(tg, chatId, widgetId, { chat, caption })` |
| Update original message state | `Definition.editState(tg, target, { chat, public })` |
| Update shared public state | `Definition.editShared(tg, widgetId, value, { cacheTime })` |
| Decode a raw/wrapped message | `Definition.decode(message)` → `{ chat, public }` |
| Build inline input content | `Definition.content(options)` / `Definition.sharedContent(widgetId, options)` |
| Route requests | `queryData('action').filter` with `tg.onWidgetQuery` and/or `tg.onSharedWidgetQuery` |
| Fallback answers after dispatch | `tg.extend(widgets({ autoAnswer: true }))` |

Definitions implement `WidgetLike`; sending them requires **no plugin**. The
`widgets()` plugin adds only auto-answer middleware, not a `tg.widgets` API.
Templates must be `.render(args)`ed before sending; state helpers are also on the
unrendered template because edits never change HTML.

Typed send/content options use `chat`, `public`, `allowQueries`, `shared`; other
ordinary API fields remain snake_case (`show_caption_above_media`, etc.).
`editShared` alone calls its refresh option `cacheTime`. Raw
`tg.api.sendWidget({ chat_id, html, chat_data, public_data, allow_queries, is_shared })`
is all-object and takes plain HTML, not a definition. Raw-string
`tg.sendWidget(chatId, htmlString, rawApiOptions)` remains supported, but bypasses
this package's typed state/HTML-preflight path.

## Safe interpolation

```ts
import { html, js, raw } from '@puregram/widgets'

export function greeting(name: string, trustedCss: string) {
  return html`<style>${raw(trustedCss)}</style>
<p title="${name}">${name}</p>
<script>
const name = ${js(name)};
document.querySelector('p').textContent = name;
</script>`
}
```

- `html` escapes ordinary values for text and **quoted** attributes, including
  quotes; null/undefined disappear, arrays concatenate, nested `html` composes.
- Put `js(value)` as a complete JavaScript expression inside `<script>` — not
  inside JS quotes or a template literal. It JSON-serializes and escapes `<`, `>`,
  `&` and Unicode line/paragraph separators, preventing data like `</script>` from
  terminating the element. Undefined/nonserializable data throws; cycles and
  BigInt retain JSON serialization errors. It is a data serializer, not a JS
  source compiler.
- A plain value or nested `html` inside script throws `WidgetHtmlContextError`;
  `js()` outside script also throws. In `<style>`, only `raw()` interpolation is
  accepted.
- `raw(source)` deliberately bypasses escaping/context protection, including in
  scripts/styles. Use only application-owned reviewed markup/code/CSS, never
  user input or externally supplied content. `new WidgetHtml(source)` is not a
  sanitizer; `new WidgetJs(source)` also bypasses `js` serialization.
- `escapeHtml(string)` is exported for explicit text escaping; prefer the tag.
  Escaping does **not** validate URL schemes, CSS, event-handler code or dynamic
  tag/attribute names. Keep those static or validate them independently. Do not
  interpolate untrusted strings into inline event-handler attributes.

The tag tracks HTML parsing context; it does not establish that the document
uses only Telegram's supported profile. Budget/resource warnings are not a
security audit. Keep script libraries and assets self-contained.

## Preflight without sending anything

```ts
import { defineWidget, html, json } from '@puregram/widgets'

export const Card = defineWidget({
  chat: json<{ count: number }>(),
  html: html`<b id="count">0</b><script>
const W = window.TelegramWidget;
const draw = () => {
  const state = JSON.parse(W.chatData || '{"count":0}');
  document.getElementById('count').textContent = String(state.count);
};
W.onEvent('chatDataChanged', draw); draw();
</script>`
})

export const budget = Card.html.check()
Card.html.assertFits()
export const inputContent = Card.content({ chat: { count: 0 }, caption: 'Counter' })
```

`WidgetHtml.source` is plain HTML; `.bytes` counts UTF-8 and `.compressedBytes`
caches pako zlib level-9 output (RFC1950, not gzip or raw DEFLATE). `.check()`
returns `{ ok, bytes, compressedBytes, problems }`. Problem kinds are
`html_invalid`, `html_too_large`, `compressed_too_large`,
`compressed_near_limit`, `external_resource`, each with severity and message.
Empty/NUL-containing HTML is an error; remote-resource detection is heuristic and
warning-only. `.assertFits()` returns the same HTML or throws
`WidgetTooLargeError`, also for invalid HTML. Definitions call it through
`.content()` before their first send and cache success. Plain HTML is sent over
the API; never send the locally compressed bytes.

Use exported `WIDGET_LIMITS` for SDK thresholds instead of copying numeric server
limits into application code. The near-compression warning is **SDK policy**;
pako output can differ near the boundary from the server's compressor. Leave
headroom; the server remains authoritative. See
[counting the size](https://core.telegram.org/bots/widgets#counting-the-size).

## State is data, not source

The HTML/CSS/script becomes immutable when sent. For a layout change send a new
widget; for changing scores/status update state and redraw on the state events.
`js()` embeds send-time constants, not live data. A template's arguments are also
immutable after its rendered definition is sent.

- `chat` is per message, visible in its chat, not per viewer. A shared widget
  still has per-message chat state.
- `public` belongs to a static message or to the shared widget across its carriers.
  For shared updates the script calls `watchPublicData()` and handles
  `publicDataChanged`. Neither channel is a place for secrets.
- `json<T>()` defaults both state codecs, but TypeScript `T` is **not runtime
  validation**. `text()` preserves strings; `codec<T>(serialize, parse)` supplies
  custom conversion/validation. Codecs run on the bot, not in the widget sandbox.
- `encode(null)` and `encode(undefined)` produce `''`. `decode('')`, null or
  undefined returns null. At the definition-helper layer an **undefined key is
  omitted** (unchanged on edit), while **null explicitly clears** it.
- `decode(message)` accepts raw or wrapped `widget` data, returns nulls if absent,
  and may throw on malformed serialized state. A query does not contain current
  state; do not call `decode(query)` or trust a request payload as saved state.

Keep authoritative state in your own store. Validate sender/ownership/action and
serialize competing updates by message or widget ID. Commit local changes only
after the state edit succeeds; handle durable storage/API consistency explicitly.
For busy shared widgets coalesce updates according to the server edit cadence;
the SDK neither queues/coalesces edits nor provides transactional persistence.

## Requests and handlers

```ts
import type { Telegram } from 'puregram'
import { defineWidget, html, js, queryData, text } from '@puregram/widgets'

export const StatusRequest = queryData('status')
export const Status = defineWidget({
  public: text(),
  html: html`<button id="refresh">Refresh</button><p id="result"></p><script>
const W = window.TelegramWidget;
const result = document.getElementById('result');
const draw = () => { result.textContent = W.publicData || 'No status'; };
W.onEvent('publicDataChanged', draw); W.watchPublicData(); draw();
document.getElementById('refresh').onclick = () => {
  result.textContent = 'Checking…';
  W.request(${js(StatusRequest.encode('current'))})
    .then(answer => { result.textContent = answer.result || 'No answer'; })
    .catch(error => { result.textContent = 'Request failed: ' + error.code; });
};
</script>`
})

export function registerStatusAnswers(tg: Telegram) {
  tg.onWidgetQuery(StatusRequest.filter, query => {
    if (query.type.type !== 'data' || query.payload !== 'current') {
      return query.answer({ data: 'Unsupported request' })
    }
    return query.answer({ data: 'Available' })
  })
  tg.onSharedWidgetQuery(StatusRequest.filter, query => {
    if (query.type.type !== 'data' || query.payload !== 'current') {
      return query.answer({ data: 'Unsupported request' })
    }
    return query.answer({ data: 'Available' })
  })
}
```

`queryData(prefix)` requires a nonempty prefix without `:`. `.encode(payload)`
forms `prefix:payload` and checks the UTF-8 query budget. `.filter` matches both
query kinds and attaches `.payload: string`; registering only `onWidgetQuery`
does not also handle forwarded shared queries. The prefix is routing, **not**
authorization or payload-schema validation. Check `query.type.type`: the filter
also matches wallet `sign_data` and `sent_transaction` queries. The package does
not verify signatures, wallet ownership or on-chain settlement.

Send with `allowQueries: true` if requests are needed. Include both update kinds
in transport subscriptions when needed, or use `allowedUpdates: 'auto'` with
registered typed handlers. Register middleware/plugins/handlers before transport
startup; follow the core lifecycle when dispatching updates manually.

`query.answer({ data })` replies only to that request; it does not change state.
Use `Definition.editState(tg, query, …)` for a `WidgetQueryUpdate`, or
`Definition.editShared(tg, query.widgetId, …)` for a shared-query update. Shared
queries carry no message coordinates and cannot be `editState` targets. Message
refs can alternatively be `{ chat_id, message_id }` or `{ inline_message_id }`.
For `WidgetQueryUpdate`, inline coordinates take precedence; missing coordinates
throw `TypeError`. Inspect optional `query.widgetId` on original-message queries.

`widgets({ autoAnswer: true })` answers unhandled queries with empty data;
`widgets({ autoAnswer: { data: 'Unavailable' } })` sets a fallback. Default is off.
It runs after dispatch, including after handler errors, and tracks calls to
`query.answer()`, not raw `tg.api.answerWidgetQuery`. Tracking marks a query
answered **before** awaiting the API: a failed explicit answer is not retried by
the fallback. Fallback answer failures are swallowed; handler errors still need
`tg.catch`. Auto-answer is not a response deadline, payment validation or business
logic completion guarantee.

## Shared reuse, inline content and error boundaries

`sendWidget(..., { shared: true })` creates the shared object. Persist the returned
`sent.widget?.id` after checking it exists; reuse it with `.sendShared` (new chat
state, same source/public state). `.editShared(tg, id, value, { cacheTime })`
requires public data even when only changing refresh timing: resend the current
value. It validates integer/minimum cache time, not the upper server clamp. It
returns `true` and does not suppress unchanged-state errors.

`.content()` makes `InputWidgetMessageContent`; `.sharedContent()` makes
`InputSharedWidgetMessageContent`. Supply either to an inline article factory's
`content` option, not a guessed `InputMessageContent.widget` helper. Such content
is for the test-server-only inline workflow until availability changes.

| Failure | Handling |
|---|---|
| `WidgetHtmlContextError` | Fix the interpolation context; `.context` explains where. |
| `WidgetTooLargeError` | Inspect `.check().problems`; reduce source/assets or fix empty/NUL HTML. |
| `WidgetStateTooLargeError` | Inspect `.bytes` / `.limit`; reduce serialized state. |
| `WidgetQueryDataTooLargeError` | Inspect `.data` / `.bytes`; shorten routing payload. |
| `TypeError`, `RangeError`, JSON parse/serialization errors | Fix invalid prefixes, codecs, data, targets or cache options; don't silence them. |
| API/transport failures | Handle separately with core `ApiError` / dispatch `tg.catch`; local preflight doesn't prove server acceptance. |

Local construction/preflight can throw **synchronously before a Promise exists**;
put both the helper call and `await` inside `try`, rather than relying only on
`.catch()` on its return. `.editState()` returns `false` only for an Error message
matching `message is not modified`, `true` otherwise on success, and rethrows all
other failures. It is not a general retry/error-suppression mechanism.

## Compact send/edit/reuse recipe

This independent module only defines functions and builds local inline content;
it performs no network calls until a caller invokes its async functions.

```ts
import { InlineQueryResult, type Telegram } from 'puregram'
import { defineWidget, html, json, type WidgetMessageRef } from '@puregram/widgets'

export const Score = defineWidget({
  chat: json<{ selected: boolean }>(),
  public: json<{ score: number }>(),
  html: (title: string) => html`<h3>${title}</h3><p id="score"></p><script>
const W = window.TelegramWidget;
const draw = () => {
  const data = JSON.parse(W.publicData || '{"score":0}');
  document.getElementById('score').textContent = String(data.score);
};
W.onEvent('publicDataChanged', draw); W.watchPublicData(); draw();
</script>`
})

export async function createScore(tg: Telegram, chatId: number | string, title: string) {
  const definition = Score.render(title)
  definition.html.assertFits()
  const sent = await tg.sendWidget(chatId, definition, {
    shared: true, public: { score: 0 }, chat: { selected: false }, caption: title
  })
  const widgetId = sent.widget?.id
  if (widgetId === undefined) throw new Error('Missing shared widget identifier')
  return { sent, widgetId }
}

export async function updateScore(tg: Telegram, widgetId: string, score: number) {
  return Score.editShared(tg, widgetId, { score })
}

export async function clearSelection(tg: Telegram, target: WidgetMessageRef) {
  return Score.editState(tg, target, { chat: null })
}

export async function reuseScore(tg: Telegram, chatId: number | string, widgetId: string) {
  return Score.sendShared(tg, chatId, widgetId, {
    chat: { selected: false }, caption: 'Shared score'
  })
}

export function sharedInlineResult(widgetId: string) {
  return InlineQueryResult.article({
    id: 'score', title: 'Shared score',
    content: Score.sharedContent(widgetId, { chat: { selected: false } })
  })
}
```

## Sources

- Pinned [exports](https://github.com/puregram/puregram/blob/765ed27a554fc22aa97ae372cd15cfdc1c433c3a/packages/widgets/src/index.ts), [HTML safety/preflight](https://github.com/puregram/puregram/blob/765ed27a554fc22aa97ae372cd15cfdc1c433c3a/packages/widgets/src/html.ts), [definition/state helpers](https://github.com/puregram/puregram/blob/765ed27a554fc22aa97ae372cd15cfdc1c433c3a/packages/widgets/src/widget.ts), [codecs](https://github.com/puregram/puregram/blob/765ed27a554fc22aa97ae372cd15cfdc1c433c3a/packages/widgets/src/codec.ts), [query routing](https://github.com/puregram/puregram/blob/765ed27a554fc22aa97ae372cd15cfdc1c433c3a/packages/widgets/src/query-data.ts), [auto-answer plugin](https://github.com/puregram/puregram/blob/765ed27a554fc22aa97ae372cd15cfdc1c433c3a/packages/widgets/src/plugin.ts).
- Pinned [consumer type tests](https://github.com/puregram/puregram/blob/765ed27a554fc22aa97ae372cd15cfdc1c433c3a/packages/widgets/tests/contextual-types.test.ts) and [README](https://github.com/puregram/puregram/blob/765ed27a554fc22aa97ae372cd15cfdc1c433c3a/packages/widgets/README.md).
- Official [widget guide](https://core.telegram.org/bots/widgets), [sendWidget](https://core.telegram.org/bots/api/methods/sendwidget), [editMessageWidgetData](https://core.telegram.org/bots/api/methods/editmessagewidgetdata), [editSharedWidgetData](https://core.telegram.org/bots/api/methods/editsharedwidgetdata), [answerWidgetQuery](https://core.telegram.org/bots/api/methods/answerwidgetquery). Server documentation consulted 2026-11-10; API catalogue method snapshots checked 2026-11-09. For numeric server/profile limits load `telegram-widgets`, not this SDK companion.
