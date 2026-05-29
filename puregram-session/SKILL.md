---
name: puregram-session
description: >
  use when working with `@puregram/session` in puregram v3 — `tg.extend(session())`,
  proxied `update.session` with auto-flush, `ttl(value, ms)`, `$forceUpdate()`,
  `tg.session` direct storage access, composite keys, `lazy: true`, declaration-
  merging `SessionData` for typed sessions, swap-in `KVStorage<V>` backends.
  per-user / per-chat / per-thread state. peer-depends on `puregram@3` and
  `@puregram/storage`.
metadata:
  author: nitreojs
  source: https://github.com/puregram/puregram/tree/v3/packages/session
  package: "@puregram/session@3"
---

# `@puregram/session`

per-user (or per-chat / per-thread) state plugin for puregram v3. attaches a proxied bag of data as `update.session`; reads and writes persist transparently when the handler returns. backing store is pluggable — defaults to in-memory, swap in any [`KVStorage<V>`](https://github.com/puregram/puregram/tree/v3/packages/storage) (redis, sqlite, file, cloudflare kv, custom).

## when to use this skill

- counters, half-filled forms, last-seen timestamps, any per-user scratch state
- multi-step conversations that need to remember the in-progress state between updates
- persisting flow / scenes state (`@puregram/scenes` builds on top of `@puregram/session`)
- short-lived flags or rate-limit counters with `ttl(value, ms)`
- accessing the backing store from outside an update handler (cron, webhook from another service)
- per-chat (not per-user) state, or forum-thread-scoped state — via `getStorageKey`
- typed sessions via declaration-merging the `SessionData` interface
- swapping in a persistent backend (redis / sqlite / json-file / kv) without changing handler code

if you also need multi-step wizards on top of session state, install `@puregram/scenes` and look at the `puregram-scenes` skill. for `waitFor` / prompts / conversational flow, look at `puregram-flow`.

## quick start

```ts
import { Telegram } from 'puregram'
import { session } from '@puregram/session'

// note: when chaining with @puregram/scenes, .extend(session()) must come first —
// scenes' install function reads from update.session, so the session middleware
// has to be wired before scenes' middleware runs
const tg = Telegram.fromToken(process.env.TOKEN!)
  .extend(session())

tg.onMessage(async (message) => {
  const counter = (message.session.counter as number ?? 0) + 1
  message.session.counter = counter

  await message.send(`you sent ${counter} messages!`)
})

await tg.startPolling()
```

that's it. no `save()`, no manual flushing — the assignment persists when the handler returns.

## how `.extend(session())` works

at install time the plugin does three things:

1. registers a high-priority `onUpdate` middleware that **loads** the user's data from `storage`, wraps it in a proxy, and attaches it as `update.session`
2. **flushes** any changes back to `storage` when the handler chain returns (only if the proxy detected a write)
3. exposes the configured backing store directly as `tg.session` so you can read/write/evict keys **outside** an update context

the proxy is shallow-recursive — `message.session.user.name = 'alex'` is detected and flushed just like `message.session.name = 'alex'`.

## `ttl(value, ms)` — expiring values

mark a session value as expiring after `ms` milliseconds. the proxy checks per access, so it works on any backend regardless of whether it supports native ttl:

```ts
import { ttl } from '@puregram/session'

message.session.user = ttl(user, 300_000)
// gone in 5 minutes if not updated
```

every reassignment **resets** the timer:

```ts
message.session.user = newUser // ttl reset to the original 5 minutes
```

clear ttl by wrapping with `0`:

```ts
message.session.user = ttl(user, 0) // now a regular non-expiring value
```

if your backend implements `TtlStorage<V>` (sliding-window expiry — redis, sqlite with `last_seen`, etc.) the plugin detects it via `isTtlStorage(storage)` and `touch()`es on every read, so the timer rolls forward without you re-wrapping.

quick demo of the per-access check:

```ts
message.session.counter = ttl(0, 5_000) // counter = 0, expires in 5s
message.session.counter += 1            // counter = 1, ttl reset to 5s
setTimeout(() => (message.session.counter += 1), 3_000)  // counter = 2, ttl reset
setTimeout(() => (message.session.counter += 1), 10_000) // counter = NaN — expired before +1
```

## `$forceUpdate()` — persist mid-handler

writes are flushed automatically when the handler returns. for long-running jobs or branches that may not return cleanly, persist immediately:

```ts
tg.onMessage(async (message) => {
  message.session.startedAt = Date.now()
  await message.session.$forceUpdate() // persist now in case the long task crashes

  await runLongTask(message)
})
```

idempotent — call it as many times as you want.

## `tg.session` — direct storage access

inside an update handler you've got `update.session` (proxied + auto-flushed). outside one — a cron job, a webhook from another service, a scheduled cleanup — use `tg.session`. it forwards to the configured `KVStorage<unknown>` directly, bypassing the proxy and ttl-marker layer:

```ts
await tg.session.set('promo:flag', { active: true, until: Date.now() + 86_400_000 })

const flag = await tg.session.get('promo:flag')
const exists = await tg.session.has('promo:flag')
await tg.session.delete('promo:flag')
```

what you write is what you get when you read.

## typed sessions — declaration merging `SessionData`

`update.session` is typed as `Record<string, unknown>` by default. to get precise types, augment the global `SessionData` interface:

```ts
import { session } from '@puregram/session'

declare module '@puregram/session' {
  interface SessionData {
    counter: number
    user?: { name: string }
  }
}

const tg = Telegram.fromToken(TOKEN).extend(session({
  initial: () => ({ counter: 0 })
}))

tg.onMessage((message) => {
  // message.session is typed as SessionData & { $forceUpdate, [key: string]: unknown }
  message.session.counter++
  message.session.user = { name: 'alex' }
})
```

other plugins that augment `SessionData` (e.g. `@puregram/scenes` adds `__scene`) merge into the same interface — your declaration sits next to theirs, no conflicts.

### why declaration-merge instead of `session<T>()`?

reasonable question — most session plugins in the ecosystem accept a generic. puregram doesn't, on purpose:

- `update.session` doesn't come from the plugin's return type. it's attached to every wrapped update class via ambient module augmentation (`packages/session/src/generated/augmentations`). that augmentation references `SessionData` by name — there's no generic parameter it could thread through, because the same declaration is shared across every update kind regardless of which `Telegram<Ext>` you have at the call site
- declaration merging composes naturally across plugins. `@puregram/scenes` augments the same `SessionData` to add `__scene`; your fields sit next to theirs and `update.session` is correctly typed as the intersection of all of them. with a `session<T>()` generic, that composition would have to be combined manually (`session<T & ScenesField>()`) or via conditional types — fragile
- a `session<T>()` could only meaningfully type the return value (`tg.session`, the `KVStorage<unknown>` wrapper). it can't change `update.session`'s type — so calling `session<{counter: number}>()` and skipping `declare module` would silently fail at the per-update access site. one path typed, another `unknown` — worse DX than the current "always declare-merge" rule

## options

`session(options?)`:

| option | type | default | description |
|---|---|---|---|
| `storage` | `KVStorage<unknown>` | fresh `MemoryStorage<unknown>` | backing store. pass any `KVStorage` (including `LruMemoryStorage`, redis adapter, sqlite, custom). `TtlStorage` auto-detected via `isTtlStorage` |
| `getStorageKey` | `(update) => string \| StorageKeyDescriptor \| undefined` | `(u) => ({ chat: u.chatId, user: u.from?.id })` | how to derive the per-update storage key. return `undefined` to skip session attachment for that update |
| `initial` | `(update) => SessionData` | `() => ({})` | initial value when the storage entry is missing |
| `lazy` | `boolean` | `false` | defer the `storage.get` until `update.session` is actually accessed (see [lazy mode](#lazy-mode) below) |

## composite keys

`getStorageKey` can return a structured descriptor instead of a raw string. segments compose into `user:<id>:chat:<id>:thread:<id>:key:<value>`, omitting undefined parts:

```ts
session({
  getStorageKey: (update) => ({
    chat: update.chatId,
    user: update.from?.id,
    thread: update.messageThreadId
  })
})
```

| field | format |
|---|---|
| `user` | `user:<id>` |
| `chat` | `chat:<id>` |
| `thread` | `thread:<id>` — forum-topic-scoped sessions |
| `key` | `key:<value>` — free-form trailing segment (workflow id, locale, etc.) |

returning a raw `string` is used verbatim. returning `undefined` skips session attachment.

the default keyer is `(u) => ({ chat: u.chatId, user: u.from?.id })` — same user gets independent sessions across chats. for v2-style "one session per user regardless of chat", override:

```ts
session({
  getStorageKey: (u) => u.from?.id !== undefined ? `user:${u.from.id}` : undefined
})
```

per-chat (not per-user) state:

```ts
session({
  getStorageKey: (u) => 'chat' in u && u.chat !== undefined ? `chat:${u.chat.id}` : undefined
})
```

## lazy mode

by default the middleware runs `storage.get` for every keyable update — fine for most bots, wasteful when most updates don't touch session. pass `lazy: true` to defer the load:

```ts
session({ lazy: true })
```

in lazy mode `update.session` resolves to a thenable on first access — `await` it to receive the proxy:

```ts
tg.onMessage(async (message) => {
  // 0 get, 0 set — early-return without touching session
  if (!message.text?.startsWith('/')) return

  const session = await message.session
  // 1 get; 1 set only if you actually mutate
  session.counter = (session.counter as number ?? 0) + 1
})
```

| handler | `storage.get` | `storage.set` |
|---|---|---|
| never accesses `update.session` | 0 | 0 |
| reads only | 1 | 0 |
| writes | 1 | 1 |

**important**: lazy mode is opt-in because downstream plugins (`@puregram/scenes` in particular) rely on **synchronous** `update.session.<key>` reads. when those plugins are installed, leave `lazy` at its default (`false`).

## storage backends

`@puregram/session` re-exports everything you need from `@puregram/storage`:

```ts
import { MemoryStorage, LruMemoryStorage, isTtlStorage, type KVStorage, type TtlStorage } from '@puregram/session'
```

### bounded in-memory cache

cap how many sessions live in memory at once — once the cap is hit, the least-recently-used user is evicted:

```ts
import { session, LruMemoryStorage } from '@puregram/session'

session({
  storage: new LruMemoryStorage<unknown>({ max: 10_000 })
})
```

### persistent backend — `KVStorage<V>` contract

```ts
interface KVStorage<V> {
  get (key: string): Promise<V | undefined>
  set (key: string, value: V): Promise<void>
  delete (key: string): Promise<void>
  has (key: string): Promise<boolean>
}
```

a minimal json-file backend:

```ts
import { session, type KVStorage } from '@puregram/session'
import { readFile, writeFile } from 'node:fs/promises'

class JsonFileStorage<V> implements KVStorage<V> {
  private map = new Map<string, V>()
  constructor (private path: string) {}

  async get (key: string) { await this.load(); return this.map.get(key) }
  async set (key: string, value: V) { await this.load(); this.map.set(key, value); await this.flush() }
  async delete (key: string) { await this.load(); this.map.delete(key); await this.flush() }
  async has (key: string) { await this.load(); return this.map.has(key) }

  private loaded = false
  private async load () {
    if (this.loaded) return
    try { this.map = new Map(JSON.parse(await readFile(this.path, 'utf8'))) } catch {}
    this.loaded = true
  }
  private async flush () { await writeFile(this.path, JSON.stringify([...this.map])) }
}

const tg = Telegram.fromToken(TOKEN).extend(session({
  storage: new JsonFileStorage<unknown>('./sessions.json')
}))
```

for sliding-window expiry implement `TtlStorage<V>` — `isTtlStorage(storage)` detection is automatic. see `@puregram/storage` for the full contract and a redis-flavored example.

## exported types

```ts
import type {
  AnyUpdate,         // discriminated union of every wrapped update kind (bot-api + custom)
  KVStorage,         // re-exported from @puregram/storage
  SessionContext,    // shape of `update.session` — `SessionData & { $forceUpdate, [key: string]: unknown }`
  SessionData,       // user-augmentable interface (declare-merge to widen)
  SessionExtension,  // shape of `tg.session`
  SessionOptions,    // options object accepted by `session({ … })`
  TtlData,           // internal ttl envelope (advanced)
  TtlStorage,        // re-exported from @puregram/storage
  TtlWrapped         // return type of ttl(value)
} from '@puregram/session'
```

## see also

- main skill: `using-puregram` — covers `.extend(plugin)`, the Telegram client, dispatch model
- sibling: `puregram-scenes` — multi-step wizards built on top of session
- sibling: `puregram-flow` — `waitFor` / `prompt` conversational primitives
- sibling: `puregram-storage` — the `KVStorage<V>` / `TtlStorage<V>` contract, `MemoryStorage`, `LruMemoryStorage`, `enhanceStorage` migrations, custom adapters
- package source: [`packages/session/`](https://github.com/puregram/puregram/tree/v3/packages/session)
