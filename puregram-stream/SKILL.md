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
  4096-char rollover, and the `StreamResult` return shape. private-chat-only.
metadata:
  author: nitreojs
  source: https://github.com/nitreojs/puregram/tree/v3/packages/stream
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
- you want a tested abort/error/backoff model instead of writing the `setTimeout` + `editMessageText` loop yourself

**private chats only** — telegram only allows `sendMessageDraft` in private chats. the plugin throws synchronously *before consuming the source* if you target a group, channel, or forum thread. a `streamEdit`-based fallback for groups is planned.

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

## options

| option | type | default | notes |
|---|---|---|---|
| `parseMode` | `'MarkdownV2' \| 'HTML'` | plain | lenient per-tick, strict on finalize. needs `@puregram/markup` |
| `editIntervalMs` | `number` | `250` | soft floor between `sendMessageDraft` calls — pieces yielded faster than this are coalesced |
| `maxEditBackoff` | `number` | `4000` | drop a draft tick if local backoff exceeds this. the finalize `sendMessage` is never dropped |
| `thinkingPlaceholder` | `boolean` | `true` | emit an empty draft eagerly on start so the user sees "typing…" immediately |
| `draftIdOffset` | `number` | derived | base offset for the rolling draft id. `update.stream(...)` derives `message_id << 8`; `tg.stream(...)` uses a counter |
| `signal` | `AbortSignal` | — | aborts mid-stream, finalizes the last-good buffer, sets `result.aborted = true`, **no rethrow** |
| `message_thread_id` | `number` | — | forwarded to telegram |
| `reply_parameters` | `ReplyParameters` | — | forwarded |
| `link_preview_options` | `LinkPreviewOptions` | — | forwarded |
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
}
```

`messages` is always non-empty on success — at minimum the terminal `sendMessage` lands. on early abort, `messages` carries whatever finalized before the abort fired.

## error handling

| failure | behavior |
|---|---|
| source throws mid-stream | stop pulling, finalize last-good via `sendMessage`, call `onError`, rethrow |
| `AbortSignal.abort()` | stop pulling, finalize last-good, set `result.aborted = true`, no rethrow |
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
  DRAFT_TTL_MS, DRAFT_SAFETY_MS, MAX_CHUNK, DRAFT_ID_MAX,
  DEFAULT_EDIT_INTERVAL_MS, DEFAULT_MAX_EDIT_BACKOFF
} from '@puregram/stream'

import type {
  StreamCallOptions,               // shared option shape across update.stream / tg.stream
  StreamTgParams,                  // tg.stream({ chat_id, source, ... }) param shape
  StreamExtension,                 // shape of tg.stream
  StreamSource,                    // discriminated union of accepted source shapes
  StreamResult,                    // return value of stream calls
  StreamApi, RunStreamOptions, StreamForwardOptions, StreamCallbacks,
  ParseMode, ParsedPayload
} from '@puregram/stream'
```

## see also

- main skill: `using-puregram` — covers `.extend(plugin)`, `update.send` / `tg.send`, `retryOnFloodWait`, the request-hook model
- sibling: `puregram-markup` — required for `parseMode: 'MarkdownV2' | 'HTML'`. produces the `Formatted` shape that strict-parse rebuilds on finalize
- sibling: `puregram-flow` — when you want a streaming response inside a `prompt` / `waitFor` flow (the abort signal can be wired to flow cancellation)
- package source: [`packages/stream/`](https://github.com/nitreojs/puregram/tree/v3/packages/stream)
