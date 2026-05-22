---
name: puregram-throttler
description: >
  use when working with `@puregram/throttler` in puregram v3 — outbound
  rate-limit middleware that keeps your bot under telegram's bot api soft
  limits (~30 req/s global, ~1 msg/s per private chat, ~20 msg/min per group).
  sliding-window buckets, per-method overrides via `perMethod`, `mode: 'queue' |
  'drop'` backpressure with `ThrottlerDroppedError`, `tg.throttler` observability
  (`pending`, `chatWindows`, `groupWindows`, `sweep()`), composes with core's
  `retryOnFloodWait` (proactive + reactive). distinct from `@puregram/rate-limit`
  which gates inbound updates.
metadata:
  author: nitreojs
  source: https://github.com/nitreojs/puregram/tree/v3/packages/throttler
  package: "@puregram/throttler@3"
---

# `@puregram/throttler`

outbound rate-limit middleware for puregram v3. queues bot api calls in front of the request lifecycle so you stay under telegram's soft limits (~30 req/s globally, ~1 msg/s per private chat, ~20 msg/min per group). sliding-window buckets, fifo-fair acquire order, plays nicely with the core `retryOnFloodWait` retry loop.

**not to be confused with `@puregram/rate-limit`** — that one gates **inbound** updates from your users (kicks them with `429`-style feedback if they hammer your bot). `@puregram/throttler` paces **outbound** api calls (keeps your bot from getting `429`'d by telegram).

## when to use this skill

- broadcasting to many users (`for (const id of ids) tg.send(id, ...)` — without throttling, you'll hit `429` in the first second)
- replying inside busy groups where multiple updates can produce concurrent sends
- avoiding flood-wait bans entirely rather than just retrying through them
- pacing expensive methods (`sendVideo`, `sendMediaGroup`) slower than cheap ones
- adding observability over outbound queue depth (`tg.throttler.pending`)
- combining proactive smoothing with `retryOnFloodWait`'s reactive retry — covers both the typical and the long-tail case
- shipping a `drop`-mode broadcast script that bails out instead of buffering gigabytes of pending payloads
- building custom rate-limit plugins on top of the exported sliding-window primitives (`createWindow`, `BucketRegistry`)

## quick start

```ts
import { Telegram } from 'puregram'
import { throttler } from '@puregram/throttler'

const tg = Telegram.fromToken(process.env.TOKEN!)
  .extend(throttler())

// hammer this however you want — the throttler queues for you
for (const id of userIds) {
  void tg.api.sendMessage({ chat_id: id, text: 'hi' })
}

await tg.startPolling()
```

defaults: 30 req/s global, 1 msg/s per private chat, 20 msg/min per group/supergroup, infinite queue depth.

## how it works

`throttler()` registers a single `onBeforeRequest` hook at `'high'` priority. for every outbound bot api call:

1. the **global** bucket is acquired (`globalPerSec` per `1s`)
2. if the request targets a chat (`params.chat_id`), either the **per-chat** (private) or **per-group** bucket is acquired next — group detection is `chatId < 0` by default (telegram's convention)
3. each acquire is serialised behind a **per-bucket fifo mutex** so concurrent callers get fair, deterministic ordering — no thundering-herd
4. on acquire, a timestamp is recorded; expired stamps prune on every check

each bucket is a **sliding window**: timestamps go in on acquire, expired ones drop off on every check, and the caller sleeps (`await new Promise(resolve => setTimeout(resolve, wait))`) until the oldest in-window stamp leaves.

methods in `excludeMethods` skip the whole pipeline. defaults: `getMe`, `getUpdates`, `getWebhookInfo`, `logOut`, `close` — control-plane calls that don't count toward send budgets.

## composing with `retryOnFloodWait`

puregram core has reactive flood-wait retry via the `retryOnFloodWait` option — on `429`, it sleeps for `retry_after` and retries. `@puregram/throttler` is the **proactive** half of the same problem. they compose:

```ts
const tg = Telegram.fromToken(process.env.TOKEN!, {
  // reactive — if we still get a 429, retry up to 3 times with a max wait of 30s
  retryOnFloodWait: { max: 3, maxWaitMs: 30_000 }
}).extend(
  // proactive — keep us under the per-chat / per-group limits to begin with
  throttler({
    globalPerSec: 25,       // pad below telegram's nominal 30 for headroom
    perChatPerSec: 1,
    perGroupPerMin: 20
  })
)
```

throttler's `onBeforeRequest` runs **before** the request is dispatched; the core retry loop runs **around** the dispatch. when a retry fires, it re-enters the lifecycle and re-acquires throttler slots, so the second attempt is also rate-limited — no double-flood.

## options

```ts
throttler(options?: ThrottlerOptions)
```

| option | type | default | description |
|---|---|---|---|
| `globalPerSec` | `number` | `30` | global cap, requests/sec across the whole bot |
| `perChatPerSec` | `number` | `1` | per-private-chat cap, messages/sec |
| `perGroupPerMin` | `number` | `20` | per-group cap, messages/min |
| `perMethod` | `Record<string, { perChatPerSec?, perGroupPerMin? }>` | `{}` | per-method overrides — methods listed here get isolated buckets. see [per-method overrides](#per-method-overrides) |
| `extractChatId` | `(method, params) => number \| undefined` | tries `params.chat_id` | derive the chat id this call targets. return `undefined` to skip per-chat/per-group bucketing |
| `extractIsGroup` | `(chatId: number) => boolean` | `chatId < 0` | classify a chat id as group/supergroup |
| `maxQueueDepth` | `number` | `Infinity` | per-bucket queue depth before backpressure |
| `mode` | `'queue' \| 'drop'` | `'queue'` | what to do at `maxQueueDepth`. `'drop'` throws `ThrottlerDroppedError` |
| `excludeMethods` | `string[]` | `['getMe', 'getUpdates', 'getWebhookInfo', 'logOut', 'close']` | methods that bypass the throttler entirely |

## per-method overrides

different bot api methods have different real-world costs. `sendVideo` competes for upload bandwidth and you may want to pace it slower than `sendMessage`; `forwardMessage` is cheap on the bot side and can run faster than the default. `perMethod` overrides the per-chat / per-group caps per method:

```ts
const tg = Telegram.fromToken(TOKEN).extend(throttler({
  perChatPerSec: 1,                             // catch-all
  perGroupPerMin: 20,

  perMethod: {
    sendVideo: { perChatPerSec: 0.2 },          // 1 video every 5 seconds per chat
    sendMediaGroup: { perChatPerSec: 0.5 },     // 1 album every 2 seconds per chat
    forwardMessage: { perChatPerSec: 5 },       // looser than the default
    sendChatAction: { perChatPerSec: 10 }       // 'typing' indicator can pulse fast
  }
}))
```

semantics:

- methods listed in `perMethod` use **isolated** per-(method, chat) and per-(method, group) buckets — `sendVideo` stamps don't share a window with `sendMessage` even when both target the same chat
- unspecified fields fall back to top-level defaults — `perMethod: { sendDocument: {} }` still isolates `sendDocument`'s buckets but with `perChatPerSec: 1` / `perGroupPerMin: 20`
- the global cap (`globalPerSec`) always applies on top of every method
- methods not listed continue to share the default per-chat / per-group buckets

**caveat**: telegram's actual per-chat throttle is method-agnostic — it counts every outbound message toward the same `1/sec/chat` budget. `perMethod` gives you stricter or looser **pacing**, but doesn't *replicate* telegram's enforcement model. for accurate enforcement of the bot api's 1/sec/chat, leave the default in place for `sendMessage` and only loosen `perMethod` for methods that are demonstrably exempt from the message budget.

## drop mode for backpressure

default mode is patient — the throttler queues forever. if you'd rather fail fast when downstream is hopelessly behind (a broadcast script that should bail out instead of holding gigabytes of pending payloads in memory), switch to `drop`:

```ts
import { throttler, ThrottlerDroppedError } from '@puregram/throttler'

const tg = Telegram.fromToken(TOKEN).extend(throttler({
  mode: 'drop',
  maxQueueDepth: 1_000
}))

for (const id of userIds) {
  try {
    await tg.api.sendMessage({ chat_id: id, text: 'hi' })
  } catch (err) {
    if (err instanceof ThrottlerDroppedError) {
      console.warn('dropped', err.method, 'on', err.bucket)
      continue
    }
    throw err
  }
}
```

`ThrottlerDroppedError` carries `.method` (the bot api method that was dropped) and `.bucket` (which bucket overflowed — `'global'`, `'chat:<id>'`, or `'group:<id>'`).

## `tg.throttler` — observability

the plugin attaches a small handle to `tg.throttler`:

```ts
interface ThrottlerExtension {
  /** count of callers currently parked across all buckets */
  readonly pending: number
  /** number of distinct per-chat windows currently tracked */
  readonly chatWindows: number
  /** number of distinct per-group windows currently tracked */
  readonly groupWindows: number
  /** drop expired buckets — happens implicitly on every acquire; exposed for tests/observability */
  sweep: () => void
}
```

useful for instrumentation:

```ts
setInterval(() => {
  console.log(
    'throttler — pending:', tg.throttler.pending,
    'chats:', tg.throttler.chatWindows,
    'groups:', tg.throttler.groupWindows
  )
}, 5_000)
```

`sweep()` drops expired buckets from memory. runs implicitly on every acquire; call it manually only in long-running tests or when you specifically want to free memory between batches.

## errors

| error | thrown when |
|---|---|
| `ThrottlerDroppedError` | `mode: 'drop'` is set and a bucket's queue depth has reached `maxQueueDepth` when a new request arrives. carries `.method` and `.bucket` |

no error in `'queue'` mode — callers just sleep.

## exported surface

```ts
import {
  throttler,
  ThrottlerDroppedError,

  // sliding-window primitives, exported for advanced integrations / custom plugins
  createWindow,
  BucketRegistry,

  // constants (default limits + exclude list)
  DEFAULT_GLOBAL_PER_SEC,
  DEFAULT_PER_CHAT_PER_SEC,
  DEFAULT_PER_GROUP_PER_MIN,
  GLOBAL_WINDOW_MS,
  PER_CHAT_WINDOW_MS,
  PER_GROUP_WINDOW_MS,
  DEFAULT_EXCLUDED_METHODS
} from '@puregram/throttler'

import type {
  ThrottlerExtension,
  ThrottlerOptions,
  ThrottlerMethodLimits,
  SlidingWindow
} from '@puregram/throttler'
```

`createWindow(limit, windowMs)` and `BucketRegistry` are reusable building blocks — if you're writing a custom plugin that needs sliding-window pacing on a different signal (per-user instead of per-chat, say), you don't have to reimplement the primitive.

## see also

- main skill: `using-puregram` — covers `.extend(plugin)`, hooks, `retryOnFloodWait`
- sibling: `puregram-rate-limit` — **inbound** rate limiting (gating updates from your users). different problem; both plugins coexist cleanly
- package source: [`packages/throttler/`](https://github.com/nitreojs/puregram/tree/v3/packages/throttler)
