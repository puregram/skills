---
name: puregram-stream
description: >
  use when working with `@puregram/stream` in puregram v3 — bridge any
  `AsyncIterable<string>` or LLM SDK stream to telegram via animated
  `sendMessageDraft` previews and a terminal `sendMessage`. covers `.extend(stream())`,
  `update.stream(source, opts?)` / `tg.stream({ chat_id, source, ... })`,
  the eight built-in adapters (`fromOpenAI` / `fromAnthropic` / `fromVercelAI`
  / `fromOllama` / `fromLangChain` / `fromTextStream` / `fromBytes` /
  `fromEventEmitter`) plus duck-typed auto-detect, `parseMode: 'MarkdownV2' |
  'HTML'` integration with `@puregram/markup`, `editIntervalMs` /
  `maxEditBackoff` / `thinkingPlaceholder` pacing, `signal` aborts, the
  user-facing stop button (`canStop` / `keepOnStop` / `result.stopped`), the
  4096-char rollover, rich-message streaming via `rich` (`sendRichMessageDraft`
  + `sendRichMessage`, 32768-char limit), and the `StreamResult` return shape.
  private-chat-only.
metadata:
  author: starkow
  source: https://github.com/puregram/puregram/tree/v3/packages/stream
  package: "@puregram/stream@3"
---

# `@puregram/stream`

stream LLM output to telegram via `sendMessageDraft` previews + a terminal `sendMessage`. a thin bridge from any `AsyncIterable<string>` (or a known LLM SDK stream) to repeated animated drafts, finalized as real messages once each 4096-char window fills or the stream ends.

mental model — every chunk yielded by the source flows into a *draft* (telegram bot api 10.0's `sendMessageDraft` — an animated preview the user sees being typed in real time). drafts are coalesced under back-pressure (you don't pay for one round-trip per token). once the buffer reaches `MAX_CHUNK` (4096 chars, telegram's message ceiling) or the stream ends, the plugin commits the current buffer as a real `sendMessage`, and — if there's more content — starts a fresh draft for the next window.

## when to use this skill

- you're streaming output from a chat completion (openai, anthropic, vercel ai sdk, ollama, langchain, raw `AsyncIterable<string>`) to a telegram user
- you want the "typing in real time" UX without managing `editMessageText` polling yourself
- you want automatic 4096-char rollover into a chain of messages, no math required
- you want entity-aware streaming via `parseMode: 'MarkdownV2' | 'HTML'` — lenient per-tick, strict on finalize, so a half-emitted bold doesn't kill the stream
- you want `AbortSignal`-driven cancellation that still finalizes the last-good draft
- you want the user to be able to stop generation from the message itself (`canStop`)
- you want a tested abort/error/backoff model instead of writing the `setTimeout` + `editMessageText` loop yourself

**private chats only** — telegram only allows `sendMessageDraft` in private chats. the plugin throws synchronously *before consuming the source* if you target a group, channel, or forum thread. in those chats, send a regular message with `tg.send` / `update.send` instead.

## quick start

```ts
import { Telegram } from 'puregram'
import { stream } from '@puregram/stream'

const tg = Telegram.fromToken(process.env.TOKEN!).extend(stream())

tg.onMessage(async (message) => {
  await message.stream(openAIStream)
})

await tg.startPolling()
```

both call sites are supported:

```ts
// inside an update handler — chat_id, message_thread_id inferred
await message.stream(source, options?)

// raw — call out of context, pass chat_id yourself
await tg.stream({ chat_id: 12345, source, ...options })
```

`update.stream(...)` is attached to every message-shaped update kind: `MessageUpdate`, `EditedMessageUpdate`, `ChannelPostUpdate`, `EditedChannelPostUpdate`, `BusinessMessageUpdate`, `EditedBusinessMessageUpdate` (the latter four still only work when the target chat is private).

## adapters

every modern LLM client already exposes an `AsyncIterable` (or trivially adapts to one). `update.stream(...)` duck-types the source — but you can also call a named adapter explicitly for better type inference and future-proofing against shape collisions.

| adapter | accepts |
|---|---|
| `fromOpenAI(completion)` | `openai` chat completion stream |
| `fromAnthropic(stream)` | `@anthropic-ai/sdk` messages stream |
| `fromVercelAI(result)` | vercel ai sdk `streamText` result (uses `.textStream`) |
| `fromOllama(res)` | `ollama` chat stream |
| `fromLangChain(stream)` | langchain runnable stream |
| `fromTextStream(rs)` | web `ReadableStream<string>` |
| `fromBytes(iter)` | `AsyncIterable<Uint8Array>` (utf-8) |
| `fromEventEmitter(ee, event?)` | node `EventEmitter` (default event `'text'`) |

duck-typing handles every adapter's input shape transparently, so `message.stream(openaiCompletion)` works without an import. but for production code, prefer the named adapters — better intellisense, narrower types, and you're insulated if two SDK shapes accidentally collide:

```ts
import OpenAI from 'openai'
import { fromOpenAI } from '@puregram/stream'

const openai = new OpenAI()
const completion = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  stream: true,
  messages: [{ role: 'user', content: 'tell me a joke' }]
})

await message.stream(fromOpenAI(completion))
```

```ts
import Anthropic from '@anthropic-ai/sdk'
import { fromAnthropic } from '@puregram/stream'

const stream = new Anthropic().messages.stream({
  model: 'claude-sonnet-4-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'tell me a joke' }]
})

await message.stream(fromAnthropic(stream))
```

```ts
import { streamText } from 'ai'
import { fromVercelAI } from '@puregram/stream'

const result = await streamText({ model: openai('gpt-4o'), prompt: 'tell me a joke' })

await message.stream(fromVercelAI(result))   // explicit
await message.stream(result)                 // duck-typed via .textStream
```

raw `AsyncIterable<string>` works directly:

```ts
async function * generate () {
  for (const word of ['hello', ' ', 'world']) {
    yield word
    await new Promise(r => setTimeout(r, 50))
  }
}

await message.stream(generate())
```

## `parseMode` — entity-aware streaming

opt into telegram's MarkdownV2 or HTML rendering by passing `parseMode: 'MarkdownV2' | 'HTML'`. the plugin parses each piece **lenient** as it streams (so a half-emitted `**bold` doesn't kill the draft) and **strict** on the final commit (so the finalized message has proper entities, not a malformed shell):

```ts
import { stream } from '@puregram/stream'
import { markup } from '@puregram/markup'

const tg = Telegram.fromToken(TOKEN)
  .extend(markup())       // markup adapter is required for parseMode
  .extend(stream())

tg.onMessage((message) => {
  return message.stream(llmStream, { parseMode: 'MarkdownV2' })
})
```

`@puregram/markup` is an optional peer dependency — it's only required when you actually use `parseMode`. if the strict re-parse fails on finalize (truly malformed output), the plugin falls back to raw text and calls `onError` instead of throwing.

the option name says `parseMode`, but nothing sets `parse_mode` on the wire: markup turns each piece into `text` + `entities`. only when markup isn't installed does the plugin pass the parse mode through raw. so don't add a `defaultParams: { '*': { parse_mode: … } }` — telegram discards `entities` whenever `parse_mode` is present, which would silently unformat every streamed message.

## rich-message streaming

pass `rich` to stream into a telegram **rich message** (`sendRichMessageDraft` + `sendRichMessage`) instead of flat `parse_mode` text. rich markdown renders headings / lists / code blocks / tables / math, and the limit is 32768 (vs 4096) so rollovers are rarer

```ts
await message.stream(openAIStream, { rich: true })          // markdown (default)
await message.stream(openAIStream, { rich: 'html' })        // telegram rich html
await telegram.stream({ chat_id, source, rich: 'markdown' })
```

same engine — adapters, pacing, callbacks, abort, reply/thread forwarding all reused. only the wire calls and content field swap (`rich_message: { markdown }` / `{ html }`)

- **private chats only** (drafts are private-only)
- **`rich` and `parseMode` are mutually exclusive** — both set throws
- **`link_preview_options` ignored** in rich mode (`sendRichMessage` has no such param)
- `is_rtl` / `skip_entity_detection` are not exposed

## stopping a stream

`canStop: true` puts `can_stop` on every draft the run ships, so telegram renders a stop button next to the preview. pressing it gives you a `stopped_message_generation` update; the plugin matches it against that run's own draft ids in that chat and stops only the matching run:

```ts
const result = await message.stream(llmStream, { canStop: true, keepOnStop: true })

if (result.stopped) {
  await message.send('(stopped)')
}
```

- `keepOnStop: true` (sent as `keep_on_stop` on every draft) commits the accumulated buffer through the usual terminal `sendMessage`, so the partial answer stays in the chat
- without it the unfinished window is dropped — windows that already rolled over into real messages stay
- `result.stopped` is `true`, `messages` holds whatever was committed, and nothing throws
- the plugin watches the update in a `high`-priority `onUpdate` hook that always calls `next()`, so your own `tg.onStoppedMessageGeneration(...)` handlers still run

## options

| option | type | default | notes |
|---|---|---|---|
| `parseMode` | `'MarkdownV2' \| 'HTML'` | plain | lenient per-tick, strict on finalize. needs `@puregram/markup` |
| `rich` | `boolean \| 'markdown' \| 'html'` | off | stream into a rich message — `true`=markdown, mutually exclusive with `parseMode` |
| `editIntervalMs` | `number` | `250` | soft floor between `sendMessageDraft` calls — pieces yielded faster than this are coalesced |
| `maxEditBackoff` | `number` | `4000` | drop a draft tick if local backoff exceeds this. the finalize `sendMessage` is never dropped |
| `thinkingPlaceholder` | `boolean` | `true` | emit an empty draft eagerly on start so the user sees "typing…" immediately |
| `canStop` | `boolean` | off | `can_stop` on every draft — telegram shows a stop button and reports presses as `stopped_message_generation` |
| `keepOnStop` | `boolean` | off | `keep_on_stop` on every draft — on stop, commit the partial buffer instead of discarding it |
| `draftIdOffset` | `number` | derived | base offset for the rolling draft id. `update.stream(...)` derives `message_id << 8`; `tg.stream(...)` uses a counter |
| `signal` | `AbortSignal` | — | aborts mid-stream, finalizes the last-good buffer, sets `result.aborted = true`, **no rethrow** |
| `message_thread_id` | `number` | — | forwarded to telegram |
| `reply_parameters` | `ReplyParameters` | — | forwarded |
| `link_preview_options` | `LinkPreviewOptions` | — | forwarded; ignored in rich mode |
| `disable_notification` | `boolean` | — | forwarded |
| `protect_content` | `boolean` | — | forwarded |
| `reply_markup` | `ReplyMarkup` | — | only attached to the terminal `sendMessage`, never to drafts |
| `onPiece` | `(piece, draftId) => void` | — | called once per source yield. `piece: { text, entities? }` |
| `onDraftFinalized` | `(msg) => void` | — | called once per terminal `sendMessage` |
| `onError` | `(err) => void \| Promise<void>` | — | called for source / draft / strict-parse errors |

## return value — `StreamResult`

```ts
interface StreamResult {
  messages: TelegramMessage[]    // committed sendMessage results, in order
  drafts: number                 // distinct sendMessageDraft calls issued
  pieces: number                 // chunks pulled from source
  bytes: number                  // total text bytes streamed
  skipped: number                // draft ticks coalesced or dropped under back-pressure
  aborted: boolean               // true iff AbortSignal triggered
  stopped: boolean               // true iff a stop button press ended the run
}
```

`messages` is always non-empty on success — at minimum the terminal `sendMessage` lands. on early abort, `messages` carries whatever finalized before the abort fired; on a stop without `keepOnStop` it can be empty.

## error handling

| failure | behavior |
|---|---|
| source throws mid-stream | stop pulling, finalize last-good via `sendMessage`, call `onError`, rethrow |
| `AbortSignal.abort()` | stop pulling, finalize last-good, set `result.aborted = true`, no rethrow |
| user presses stop (`canStop`) | stop pulling, set `result.stopped = true`, commit the partial only with `keepOnStop`, no rethrow |
| target chat is not private | throws synchronously **before** consuming the source |
| `maxEditBackoff` exceeded on a draft | drop the draft tick, `skipped += 1`, continue |
| terminal `sendMessage` fails | never dropped — bubbles up |
| strict-parse failure on finalize | falls back to raw text, `onError` called |

`signal` is the cleanest cancellation path — you keep the last-good chunk, the user keeps what they've seen, and the result tells you it aborted. an `AbortController` wrapped in a `setTimeout` is a one-line "max stream duration" gate.

```ts
const controller = new AbortController()
const stopAt = setTimeout(() => controller.abort(), 30_000)

try {
  const result = await message.stream(llmStream, { signal: controller.signal })

  if (result.aborted) {
    await message.send('(response was cut off at 30s)')
  }
} finally {
  clearTimeout(stopAt)
}
```

## auto-detect vs named adapters

| approach | when to use |
|---|---|
| `m.stream(openaiCompletion)` — auto-detect | quick prototyping, common-case happy path |
| `m.stream(fromOpenAI(openaiCompletion))` — explicit | better intellisense, narrower types, future-proof against SDK shape collisions |

mix freely — auto-detect is implemented on top of the same adapters.

## throttling

`@puregram/stream` doesn't implement outbound throttling. it leans on:

- puregram core's built-in `retryOnFloodWait` for 429s
- the local `maxEditBackoff` cap to drop stale draft ticks before they pile up

for strict per-chat pacing across other outgoing calls, layer `@puregram/throttler` over the top — its filter/middleware shape is independent of the stream plugin.

## comparison vs `@grammyjs/stream`

| feature | `@puregram/stream` | `@grammyjs/stream` |
|---|---|---|
| transport | `sendMessageDraft` + `sendMessage` (bot api 10.0) | `editMessageText` polling |
| group chats | not supported (private-only — bot-api constraint) | supported |
| 4096 rollover | automatic; multi-message finalize | manual |
| LLM source detection | duck-typed + named adapters for 6+ SDKs | one adapter form |
| parseMode handling | lenient per-tick / strict on finalize | strict only |
| abort | `AbortSignal` | `AbortSignal` |
| backoff | core auto-retry + local `maxEditBackoff` | per-call |

## constants

exported for advanced use (own pacing wrappers, draft-id collision tests):

| const | value | meaning |
|---|---|---|
| `DRAFT_TTL_MS` | telegram's draft expiry | drafts older than this are gone server-side |
| `DRAFT_SAFETY_MS` | safety margin under `DRAFT_TTL_MS` | local cutoff before finalize |
| `MAX_CHUNK` | `4096` | telegram's message-length ceiling |
| `MAX_RICH_CHUNK` | `32768` | rich-message length ceiling (rich-mode rollover) |
| `DRAFT_ID_MAX` | rolling-counter ceiling | `draftIdOffset` wraps modulo this |
| `DEFAULT_EDIT_INTERVAL_MS` | `250` | default for `editIntervalMs` |
| `DEFAULT_MAX_EDIT_BACKOFF` | `4000` | default for `maxEditBackoff` |

## exported surface

```ts
import {
  stream,                          // .extend(stream())
  runStream,                       // low-level driver — for custom integrations
  normalize,                       // turn anything into an AsyncIterable<string>
  fromOpenAI, fromAnthropic, fromVercelAI, fromOllama,
  fromLangChain, fromTextStream, fromBytes, fromEventEmitter,
  DRAFT_TTL_MS, DRAFT_SAFETY_MS, MAX_CHUNK, MAX_RICH_CHUNK, DRAFT_ID_MAX,
  DEFAULT_EDIT_INTERVAL_MS, DEFAULT_MAX_EDIT_BACKOFF
} from '@puregram/stream'

import type {
  StreamCallOptions,               // shared option shape across update.stream / tg.stream
  StreamTgParams,                  // tg.stream({ chat_id, source, ... }) param shape
  StreamExtension,                 // shape of tg.stream
  StreamSource,                    // discriminated union of accepted source shapes
  StreamResult,                    // return value of stream calls
  StreamApi, RunStreamOptions, StreamForwardOptions, StreamCallbacks,
  ParseMode, ParsedPayload, RichDialect
} from '@puregram/stream'
```

## see also

- main skill: `using-puregram` — covers `.extend(plugin)`, `update.send` / `tg.send`, `retryOnFloodWait`, the request-hook model
- sibling: `puregram-markup` — required for `parseMode: 'MarkdownV2' | 'HTML'`. produces the `Formatted` shape that strict-parse rebuilds on finalize
- sibling: `puregram-flow` — when you want a streaming response inside a `prompt` / `waitFor` flow (the abort signal can be wired to flow cancellation)
- sibling: `telegram-rich-messages` — the rich-message format itself: every block and inline type, the limits, and the three input forms in parallel
- sibling: `rich-message-authoring` — when you stream an LLM into a rich message: a system-prompt block that keeps the model's output inside telegram's rich grammar
- package source: [`packages/stream/`](https://github.com/puregram/puregram/tree/v3/packages/stream)
