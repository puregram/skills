---
name: puregram-rate-limit
description: >
  use when working with `@puregram/rate-limit` in puregram v3 — inbound
  per-user fixed-window rate limiting. distinct from outbound
  `@puregram/throttler`. covers `.extend(rateLimit())`, the three opt-in call
  shapes (`rateLimitFilter` / `rateLimitMiddleware` / `tg.rateLimit.check`),
  per-command `bucket`s, the raw `tg.rateLimit.hit(key, limit, window)`
  primitive, `tg.rateLimit.reset` / `resolveKey`, `onLimitExceeded` resolution
  order (per-call > plugin > silent), custom `getStorageKey` for per-chat / per-thread
  scoping, and swap-in persistent `KVStorage<RateLimitEntry>` backends.
metadata:
  author: nitreojs
  source: https://github.com/puregram/puregram/tree/v3/packages/rate-limit
  package: "@puregram/rate-limit@3"
---

# `@puregram/rate-limit`

per-user, per-bucket, fixed-window inbound rate limiter for puregram v3. one user spamming `/buy` 200 times a second is supposed to hit a wall — this plugin builds that wall, declaratively, with a key derivation that just works for messages, callback queries, channel posts, business bots, etc.

each user-bucket pair has its own counter — `limit` hits within `window` seconds. the same user can be gated independently on `/buy`, `/sell`, `/withdraw`, etc. unlike many rate-limit plugins, `@puregram/rate-limit` **registers no global middleware on install**. instead it attaches `tg.rateLimit` and gives you three opt-in places to gate — you decide what gets limited.

## when to use this skill

- bot commands that touch money / external apis / expensive work need throttling per user
- you want a different budget for `/buy` vs `/sell` (independent counters)
- you want a global cap on a class of updates (`every message`, `every callback`) — middleware form
- you want gating decisions made imperatively inside a handler based on payload state — `tg.rateLimit.check`
- you want raw bucket access for per-app or per-resource counters (`tg.rateLimit.hit('global', 1000, 60)`)
- you need to scope by chat or by thread instead of by user — custom `getStorageKey`
- you want persistent counters that survive restarts — swap in a `KVStorage<RateLimitEntry>`

**distinct from `@puregram/throttler`** — that one paces *outbound* api calls (your bot's `sendMessage`s under telegram's per-chat 30/s ceiling). this one gates *inbound* updates (incoming messages from users hitting your bot). they don't overlap and you can run both.

## quick start

```ts
import { Telegram, and, filters } from 'puregram'
import { rateLimit, rateLimitFilter } from '@puregram/rate-limit'

const { command } = filters

const tg = Telegram.fromToken(process.env.TOKEN!)
  .extend(rateLimit({
    onLimitExceeded: async (update, retryAfter) => {
      const u = update as { send?: (text: string) => Promise<unknown> }

      if (typeof u.send === 'function') {
        await u.send(`slow down — try again in ${retryAfter}s`)
      }
    }
  }))

// gate /buy to 5 hits per 60s per user
tg.onMessage(
  and(command('buy'), rateLimitFilter(tg, { limit: 5, window: 60, bucket: 'buy' })),
  async (message) => {
    await message.send('purchase confirmed')
  }
)

await tg.startPolling()
```

## the three call shapes

### `rateLimitFilter(tg, opts)` — filter form

returns an async filter you compose with structural filters. matches when **under** budget; on block returns `false` and fires `onLimitExceeded` (per-call override > plugin-level fallback > silent no-op). use this when the gate is part of a handler's match condition.

```ts
import { and, filters } from 'puregram'
import { rateLimitFilter } from '@puregram/rate-limit'

const { command, hasText } = filters

tg.onMessage(
  and(command('buy'), rateLimitFilter(tg, { limit: 5, window: 60, bucket: 'buy' })),
  (message) => message.send('bought!')
)

tg.onMessage(
  and(hasText, rateLimitFilter(tg, { limit: 30, window: 60 })),
  (message) => message.send(`got: ${message.text}`)
)
```

**ordering matters** — `rateLimitFilter` is side-effecting. it writes to storage and may invoke user callbacks even when the request would have been declined by a structural filter. compose it **last** in `and(...)` chains so cheaper filters (`command`, `hasText`) short-circuit first.

### `rateLimitMiddleware(tg, opts)` — middleware form

returns an `onUpdate` middleware that gates everything downstream. on block, the update is silently swallowed (after `onLimitExceeded` if set). use this when you want one global cap across a whole class of updates:

```ts
import { filters } from 'puregram'
import { rateLimitMiddleware } from '@puregram/rate-limit'

// every message-kind update: 30/min/user
tg.use(
  filters.kind.message,
  rateLimitMiddleware(tg, { limit: 30, window: 60 })
)

tg.onMessage((message) => message.send('through!'))
```

unkeyable updates (no `from` / `senderChat` / `chat`) pass through untouched.

### `tg.rateLimit.check(update, opts)` — imperative form

returns `Promise<number | null>` — `null` when allowed, retry-after seconds when blocked. **doesn't** fire `onLimitExceeded` — you write the response yourself. use this when the gate decision depends on something only the handler knows:

```ts
tg.onMessage(async (message) => {
  if (!message.text?.startsWith('/buy ')) return

  const sku = message.text.slice('/buy '.length)
  const expensive = sku.startsWith('premium-')

  // tighter bucket for premium SKUs
  const wait = expensive
    ? await tg.rateLimit.check(message, { limit: 1, window: 60, bucket: 'buy:premium' })
    : await tg.rateLimit.check(message, { limit: 5, window: 60, bucket: 'buy' })

  if (wait !== null) {
    return message.send(`please wait ${wait}s`)
  }

  await message.send(`bought ${sku}`)
})
```

## buckets — independent counters per command

every check takes an optional `bucket` string. counters are keyed by `(userKey, bucket)`, so the same user can carry independent budgets across commands:

```ts
tg.onMessage(async (message) => {
  if (message.text === '/buy') {
    const wait = await tg.rateLimit.check(message, { limit: 5, window: 60, bucket: 'buy' })
    if (wait !== null) return
  }

  if (message.text === '/sell') {
    const wait = await tg.rateLimit.check(message, { limit: 5, window: 60, bucket: 'sell' })
    if (wait !== null) return
  }
})
```

`bucket` defaults to `'default'`. omit it for one budget per user across everything.

## `tg.rateLimit.hit(key, limit, window)` — global counters

the raw bucket primitive — pass any string key, get `null` when allowed or retry-after seconds when blocked. `check` / the filter / the middleware are all thin shims over this:

```ts
// app-wide cap: 1000 ops per 60s, regardless of user
const wait = await tg.rateLimit.hit('global', 1000, 60)

// per-resource cap on top of the per-user one
await tg.rateLimit.hit(`payment-provider:${providerId}`, 100, 60)
```

## resetting a bucket

drop a counter explicitly — useful after a successful flow, refunds, etc:

```ts
await tg.rateLimit.reset('buy:12345')

// keys are `<bucket>:<userKey>`. derive the same key check would derive:
const key = tg.rateLimit.resolveKey(message, 'buy')

if (key !== undefined) {
  await tg.rateLimit.reset(key)
}
```

`resolveKey(update, bucket?)` returns the key the gate **would** derive for that update — or `undefined` if the update is unkeyable.

## `onLimitExceeded`

invoked once per blocked update **except** in the imperative `check` form (where you're already controlling the response). resolution order: per-call override > plugin-level fallback > silent no-op.

```ts
// plugin-level fallback
const tg = Telegram.fromToken(TOKEN).extend(rateLimit({
  onLimitExceeded: async (update, retryAfter) => {
    const u = update as { send?: (text: string) => Promise<unknown> }

    if (typeof u.send === 'function') {
      await u.send(`whoa, slow down — try again in ${retryAfter}s`)
    }
  }
}))

// per-call override
tg.onMessage(
  rateLimitFilter(tg, {
    limit: 5,
    window: 60,
    bucket: 'buy',
    onLimitExceeded: (_update, retryAfter) => {
      console.log(`buy gate hit at ${retryAfter}s`)
    }
  }),
  handler
)
```

`update` is typed as `AnyUpdate` — every wrapped update kind plus custom updates. cast or check `'send' in update` if you want to reply.

## key derivation — `getStorageKey`

default: `from.id ?? senderChat.id ?? chat.id`. return `undefined` to leave an update unkeyable (passes through filters/middleware untouched).

### scope by chat instead of by user

```ts
rateLimit({
  getStorageKey: (update) => {
    if ('chat' in update && update.chat !== undefined) {
      return `chat:${update.chat.id}`
    }

    return undefined
  }
})
```

### scope by forum thread

```ts
rateLimit({
  getStorageKey: (update) => {
    if ('messageThreadId' in update && update.messageThreadId !== undefined) {
      return `thread:${update.chat?.id}:${update.messageThreadId}`
    }

    return update.from?.id !== undefined ? `user:${update.from.id}` : undefined
  }
})
```

## options

### plugin-level — `rateLimit(options?)`

| option | type | description |
|---|---|---|
| `storage` | `KVStorage<RateLimitEntry>` | backing store. default: a fresh `MemoryStorage<RateLimitEntry>`. swap in `LruMemoryStorage` for bounded memory, redis / sqlite / etc for persistence |
| `getStorageKey` | `(update) => string \| undefined` | how to derive the per-user key. default: `from.id ?? senderChat.id ?? chat.id`. return `undefined` to skip |
| `onLimitExceeded` | `(update, retryAfter) => void \| Promise<void>` | plugin-level fallback callback. fires once per blocked update from filter/middleware paths |

### per-call — `RateLimitCheckOptions`

passed to `rateLimitFilter(tg, opts)`, `rateLimitMiddleware(tg, opts)`, and `tg.rateLimit.check(update, opts)`:

| field | type | description |
|---|---|---|
| `limit` | `number` | maximum hits permitted in the window |
| `window` | `number` | window length in **seconds** |
| `bucket` | `string` | sub-key. default `'default'` |
| `onLimitExceeded` | `RateLimitCallback` | per-call override of the plugin-level callback. ignored by `tg.rateLimit.check` (caller handles the block) |

## persistence

### bounded in-memory

cap how many user counters live in memory at once — once the cap is hit, the least-recently-touched user gets evicted (which gives them their budget back early — the right failure mode for spam-prevention):

```ts
import { LruMemoryStorage, type RateLimitEntry } from '@puregram/rate-limit'

rateLimit({
  storage: new LruMemoryStorage<RateLimitEntry>({ max: 50_000 })
})
```

### persistent backend

```ts
import type { KVStorage, RateLimitEntry } from '@puregram/rate-limit'

class RedisStorage implements KVStorage<RateLimitEntry> {
  // get/set/delete/has — see @puregram/storage
}

rateLimit({ storage: new RedisStorage() })
```

see the `puregram-storage` sibling skill for the full `KVStorage<V>` contract. `@puregram/rate-limit` re-exports `MemoryStorage`, `LruMemoryStorage`, `KVStorage`, and `LruMemoryStorageOptions` directly so you don't need to install `@puregram/storage` separately.

## `tg.rateLimit` reference

```ts
interface RateLimitExtension {
  /** gate an update on a per-call budget. doesn't invoke onLimitExceeded — caller writes the response */
  check: (update: AnyUpdate, opts: RateLimitCheckOptions) => Promise<number | null>

  /** raw bucket access for arbitrary keys (global counters, per-resource gates) */
  hit: (key: string, limit: number, window: number) => Promise<number | null>

  /** drop the counter for `key`. no-op if absent */
  reset: (key: string) => Promise<void>

  /** the configured KVStorage<RateLimitEntry> — direct read access */
  storage: KVStorage<RateLimitEntry>

  /** the same key check would derive — useful when you want to reset it from outside */
  resolveKey: (update: AnyUpdate, bucket?: string) => string | undefined

  /** plugin-level fallback callback — filter/middleware shims call it on block */
  onLimitExceeded: RateLimitCallback | undefined
}
```

## exported surface

```ts
import {
  rateLimit,                       // .extend(rateLimit())
  rateLimitFilter,                 // filter form
  rateLimitMiddleware,             // middleware form
  MemoryStorage, LruMemoryStorage  // re-exported from @puregram/storage
} from '@puregram/rate-limit'

import type {
  AnyUpdate,
  KVStorage, LruMemoryStorageOptions,
  RateLimitCallback,
  RateLimitCheckOptions,
  RateLimitEntry,                  // { hits, resetAt }
  RateLimitExtension,
  RateLimitOptions,
  RateLimitOutcome                 // internal { allowed: boolean, retryAfter? }
} from '@puregram/rate-limit'
```

## see also

- main skill: `using-puregram` — covers `.extend(plugin)`, filters, `and` / `or` / `not`, dispatch middleware
- sibling: `puregram-storage` — the `KVStorage<V>` contract that backs the counter store
- sibling: `puregram-callback-data` — typed `callback_data` flows often want a per-user gate on the resulting query
- package source: [`packages/rate-limit/`](https://github.com/puregram/puregram/tree/v3/packages/rate-limit)
