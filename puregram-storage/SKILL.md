---
name: puregram-storage
description: >
  use when writing or consuming a storage adapter for puregram v3 — `KVStorage<V>`
  and `TtlStorage<V>` contracts, `MemoryStorage`, `LruMemoryStorage`,
  `isTtlStorage`, `enhanceStorage(base, { migrations, millisecondPrecision? })`
  for versioned migrations and ttl envelopes, sharing one store across plugins,
  custom redis / sqlite / cloudflare-kv / json-file adapters, and the official
  `@puregram/storage-redis` / `@puregram/storage-sqlite` packages.
metadata:
  author: nitreojs
  source: https://github.com/puregram/puregram/tree/v3/packages/storage
  package: "@puregram/storage@3"
---

# `@puregram/storage`

shared key-value storage contracts for puregram v3, plus two batteries-included in-process implementations (`MemoryStorage`, `LruMemoryStorage`) and a versioned-migration wrapper (`enhanceStorage`). every plugin that needs state between updates — `@puregram/session`, `@puregram/scenes`, `@puregram/media-cacher`, `@puregram/rate-limit`, `@puregram/flow` — talks to its backing store through the contract defined here. write your adapter once, plug it into every plugin.

## when to use this skill

- writing a custom storage adapter (redis / sqlite / postgres / cloudflare kv / dynamodb / json-file)
- sharing one storage instance across multiple puregram plugins
- bounding an in-process cache (`LruMemoryStorage`) — common for media-cacher and rate-limit
- opting your backend into sliding-window ttl by implementing `TtlStorage<V>` and `touch`
- migrating session/cache shapes across deploys with `enhanceStorage`
- consuming the official `@puregram/storage-redis` or `@puregram/storage-sqlite` adapters
- typing the `V` generic per-call site

most users never install `@puregram/storage` directly — it ships transitively with whichever satellite they're using (`@puregram/session` re-exports the lot). install it explicitly when you're writing an adapter or sharing one storage across plugins.

## quick start

```ts
import { Telegram } from 'puregram'
import { session } from '@puregram/session'
import { MemoryStorage } from '@puregram/storage'

const tg = Telegram.fromToken(process.env.TOKEN!)
  .extend(session({ storage: new MemoryStorage() }))

tg.onMessage(async (message) => {
  message.session.counter = (message.session.counter ?? 0) + 1
  await message.send(`hit ${message.session.counter}`)
})

await tg.startPolling()
```

if you don't pass `storage`, every satellite falls back to its own fresh `MemoryStorage()` — fine for development, ephemeral on restart.

## `KVStorage<V>` — the contract

four required methods, three optional iterators:

```ts
interface KVStorage<V> {
  get (key: string): Promise<V | undefined>
  set (key: string, value: V): Promise<void>
  delete (key: string): Promise<void>
  has (key: string): Promise<boolean>

  // optional — skip these when iteration is expensive (cloudflare kv, dynamodb, ...)
  keys?: () => AsyncIterable<string>
  values?: () => AsyncIterable<V>
  entries?: () => AsyncIterable<readonly [string, V]>
}
```

intentional choices:

- **all methods return Promises**, even on sync backings. consumers never have to do `await maybeAsync(...)` ceremony. `MemoryStorage` is `async` even though it doesn't await anything — fine
- **`V` is generic at the class level**, not per-call. once typed as `KVStorage<{ counter: number }>`, accidental `set('k', 'a string')` is a compile error
- **iterators are optional**. consumers that want to enumerate do it defensively: `for await (const k of storage.keys?.() ?? []) ...`

## `MemoryStorage<V>`

unbounded in-process kv backed by `Map`. fast, simple, ephemeral. perfect for development and stateless bots, fine for production when state really doesn't need to survive a restart.

```ts
import { MemoryStorage } from '@puregram/storage'

const storage = new MemoryStorage<number>()

await storage.set('counter', 1)
await storage.set('counter', (await storage.get('counter') ?? 0) + 1)
console.log(await storage.get('counter')) // 2
```

an optional `entries` argument seeds the map at construction:

```ts
const storage = new MemoryStorage<string>([['a', '1'], ['b', '2']])
console.log(storage.size) // 2
```

## `LruMemoryStorage<V>`

bounded in-process kv with LRU eviction. same shape as `MemoryStorage`, but keeps at most `max` entries — setting the `max + 1`th key evicts the least-recently-used one.

```ts
import { LruMemoryStorage } from '@puregram/storage'

const storage = new LruMemoryStorage<string>({ max: 1000 })

await storage.set('a', 'b')
console.log(storage.size) // 1
```

semantics:

- `get(key)` and `set(key, value)` **bump** the entry to the back of the iteration order (most recent)
- `has` and `delete` **don't bump** — they're observation, not access
- iteration order is **oldest → newest**, so walking it gives you eviction candidates first

great for `@puregram/media-cacher` (cap how many `file_id`s you remember), `@puregram/rate-limit` (cap how many users you track), or any unbounded-by-default cache that you'd rather have a hard ceiling on.

## `TtlStorage<V>` — sliding-window expiry

extends `KVStorage<V>` with one extra method — `touch(key)` — for backends that support sliding-window expiry (redis `EXPIRE`, sqlite `last_seen` columns, dynamodb ttl attributes, etc.):

```ts
interface TtlStorage<V> extends KVStorage<V> {
  touch (key: string): Promise<void>
}
```

consumers like `@puregram/session` runtime-check via `isTtlStorage(storage)` and call `touch` after every read, rolling the timer forward without rewriting the value.

### `isTtlStorage(storage)` typeguard

```ts
import { isTtlStorage, type KVStorage } from '@puregram/storage'

function maybeTouch (storage: KVStorage<unknown>, key: string) {
  if (isTtlStorage(storage)) {
    // narrowed to TtlStorage<unknown>
    return storage.touch(key)
  }
}
```

returns `true` when `typeof storage.touch === 'function'`. if you're writing a plugin that wants to take advantage of ttl when present and silently degrade when not, this is the check.

## writing your own adapter

every official adapter is just a class implementing `KVStorage<V>`. no base class to extend, no registration step, no magic.

### the minimal four

```ts
import type { KVStorage } from '@puregram/storage'

interface RedisClient {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
  del: (key: string) => Promise<number>
  exists: (key: string) => Promise<number>
}

export class RedisStorage<V> implements KVStorage<V> {
  constructor (private readonly redis: RedisClient, private readonly prefix = 'pg:') {}

  async get (key: string): Promise<V | undefined> {
    const raw = await this.redis.get(this.prefix + key)
    return raw === null ? undefined : JSON.parse(raw) as V
  }

  async set (key: string, value: V) {
    await this.redis.set(this.prefix + key, JSON.stringify(value))
  }

  async delete (key: string) {
    await this.redis.del(this.prefix + key)
  }

  async has (key: string) {
    return (await this.redis.exists(this.prefix + key)) === 1
  }
}
```

plug it in:

```ts
const tg = Telegram.fromToken(TOKEN)
  .extend(session({ storage: new RedisStorage(redis) }))
```

### opting into ttl

if your backend supports expiring keys, implement `TtlStorage<V>` instead — same four methods plus `touch`:

```ts
import type { TtlStorage } from '@puregram/storage'

export class RedisTtlStorage<V> implements TtlStorage<V> {
  // ... the four required methods ...

  /** roll the ttl forward without rewriting the value */
  async touch (key: string) {
    await this.redis.expire(this.prefix + key, this.ttlSeconds)
  }
}
```

session middleware (and anything else built on top) auto-detects `touch` via `isTtlStorage` and calls it after every read. you don't have to wire it up — implement the method, it works.

### iteration

leave the three iterators off if your backend can't enumerate cheaply. callers do this defensively:

```ts
for await (const key of storage.keys?.() ?? []) {
  console.log(key)
}
```

implement them when iteration is cheap (in-process map, sqlite, postgres). skip them when it's `O(everything)` (cloudflare kv, dynamodb without an index).

### typing the `V`

the generic is on the **class**, not per method. expose your adapter generically and let each satellite parameterize:

```ts
const sessionStore = new RedisStorage<{ counter: number }>(redis)
const cacheStore = new RedisStorage<string>(redis, 'cache:')

tg
  .extend(session({ storage: sessionStore }))
  .extend(mediaCacher({ storage: cacheStore }))
```

each satellite documents what `V` it expects: `@puregram/session` uses `unknown` (user-shaped), `@puregram/media-cacher` uses `string` (file_ids), `@puregram/rate-limit` uses `RateLimitEntry`, etc.

## `enhanceStorage(base, opts)` — versioned migrations + ttl envelope

wraps any `KVStorage<V>` with versioned migrations and optional per-entry expiry. payloads are encoded as `{ __v, __exp?, data }` on the backing store — bump the version, old entries upgrade lazily on next read, transparent to the consumer.

```ts
import { enhanceStorage, MemoryStorage } from '@puregram/storage'

interface SessionV3 {
  counter: number
  role: 'guest' | 'user'
  kind: 'session'
}

const storage = enhanceStorage<SessionV3>(new MemoryStorage(), {
  migrations: {
    1: (d: any) => ({ ...d, role: 'guest' }),
    2: (d: any) => ({ ...d, kind: 'session' }),
    3: (d: any) => ({ ...d, counter: d.counter ?? 0 })
  }
})
```

| option | type | description |
|---|---|---|
| `migrations` | `Record<number, (data) => V \| Promise<V>>` | keyed by target version. `migrations[1]` runs to upgrade v0 → v1, `migrations[2]` runs after to upgrade v1 → v2, etc. the latest key wins as the "current version" stamped on every `set` |
| `millisecondPrecision` | `boolean` | when `true`, preserves any `__exp` (unix ms) carried on the underlying envelope across re-writes |

semantics:

- legacy unversioned values are treated as **v0** and migrated forward on first read
- expired entries (`__exp < Date.now()`) return `undefined` and are **deleted** from the base storage on read
- migrated envelopes are **written back** at the current version, so subsequent reads skip the upgrade chain
- concurrent reads converge on the same migrated payload (last write wins)

use it when:

- you're rolling a session-shape change to production and don't want to lose existing user state
- you want lazy backfill of new defaults without a one-shot script
- you need per-entry ttl on a backend that doesn't natively support it

## batteries-included adapters

| package | backend | native ttl |
|---|---|---|
| [`@puregram/storage-redis`](https://github.com/puregram/puregram/tree/v3/packages/storage/storages/redis) | redis via `ioredis` | `PX` / `PEXPIRE` |
| [`@puregram/storage-sqlite`](https://github.com/puregram/puregram/tree/v3/packages/storage/storages/sqlite) | sqlite via `better-sqlite3` | `expires_at` column + optional sweep |

```sh
$ yarn add @puregram/storage-redis ioredis
$ yarn add @puregram/storage-sqlite better-sqlite3
```

both implement `TtlStorage<V>` end-to-end — `@puregram/session`'s sliding-window detection lights up automatically.

## sharing one storage across plugins

you don't have to. every plugin defaults to its own fresh `MemoryStorage()`. but if you want a single redis instance backing all of them, instantiate the adapter once and pass it to every satellite that asks for one:

```ts
import { Telegram } from 'puregram'
import { session } from '@puregram/session'
import { mediaCacher } from '@puregram/media-cacher'
import { rateLimit } from '@puregram/rate-limit'
import { RedisStorage } from '@puregram/storage-redis'

const redis = new Redis()

const tg = Telegram.fromToken(TOKEN)
  .extend(session({ storage: new RedisStorage(redis, 'session:') }))
  .extend(mediaCacher({ storage: new RedisStorage(redis, 'media:') }))
  .extend(rateLimit({ storage: new RedisStorage(redis, 'rl:') }))
```

**use distinct prefixes** — one redis instance, but each plugin gets its own keyspace. otherwise a session key and a media-cacher key with the same string would collide.

## exported surface

```ts
import {
  MemoryStorage,
  LruMemoryStorage,
  isTtlStorage,
  enhanceStorage
} from '@puregram/storage'

import type {
  KVStorage,
  TtlStorage,
  LruMemoryStorageOptions
} from '@puregram/storage'
```

## see also

- main skill: `using-puregram` — covers `.extend(plugin)`, the Telegram client, dispatch model
- sibling: `puregram-session` — proxy-based session plugin built on `KVStorage`
- package source: [`packages/storage/`](https://github.com/puregram/puregram/tree/v3/packages/storage)
- redis adapter: [`@puregram/storage-redis`](https://github.com/puregram/puregram/tree/v3/packages/storage/storages/redis)
- sqlite adapter: [`@puregram/storage-sqlite`](https://github.com/puregram/puregram/tree/v3/packages/storage/storages/sqlite)
