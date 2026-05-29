---
name: puregram-media-cacher
description: >
  use when working with `@puregram/media-cacher` in puregram v3 — transparent
  `file_id` caching for repeated `MediaSource.path` / `MediaSource.url`
  uploads. covers `.extend(mediaCacher())`, the seven cached methods, custom
  `KVStorage<string>` backends, `getStorageKey` scoping, `keyStrategy:
  'sourceValue' | 'hash'`, manual `tg.mediaCacher.get` / `.invalidate` /
  `.storage` access, the auto-evict + retry path on stale `file_id` 400s, and
  the deduped re-upload behavior under concurrency.
metadata:
  author: nitreojs
  source: https://github.com/puregram/puregram/tree/v3/packages/media-cacher
  package: "@puregram/media-cacher@3"
---

# `@puregram/media-cacher`

transparent `file_id` cache for puregram v3. heavy files (paths, urls) only upload once per chat — every later send swaps the source for the cached `file_id` before the request leaves your bot. telegram never sees the same file twice.

it sits as an `onBeforeRequest` hook on every cacheable upload method (`sendPhoto`, `sendVideo`, `sendAnimation`, `sendVideoNote`, `sendAudio`, `sendDocument`, `sendSticker`) and an `onResponseIntercept` hook to harvest the resulting `file_id`. cache hits skip the upload entirely; cache misses upload as normal and store the id keyed by `(chatId, sourceValue)` (or `(chatId, sha256)` if you ask for it).

## when to use this skill

- you send the same image, document, or sticker repeatedly and don't want to re-upload every call
- your bot has a fixed asset library (logos, onboarding gifs, sticker packs) that's expensive to re-upload
- you want a per-bot persistent `file_id` cache backed by redis / sqlite / json so restarts don't drop everything
- you want auto-recovery when telegram rotates a cached `file_id` (no more "Bad Request: wrong file identifier" surprises)
- you need a hash-keyed cache so the same bytes under different paths/urls share one entry
- you want manual read / eviction access from outside an update handler

if you want **outbound rate limiting** instead of caching, look elsewhere — `@puregram/throttler` is the outbound plugin. if you want **inbound** per-user gating, that's `puregram-rate-limit`.

## quick start

```ts
import { Telegram, MediaSource } from 'puregram'
import { mediaCacher } from '@puregram/media-cacher'

const tg = Telegram.fromToken(process.env.TOKEN!)
  .extend(mediaCacher())

tg.onMessage((message) => {
  return tg.api.sendPhoto({
    chat_id: message.chat.id,
    photo: MediaSource.path('./cat.png')
  })
})

await tg.startPolling()
```

first send uploads `./cat.png`. every later send to the same chat is instantaneous — the `MediaSource.path(...)` quietly becomes a cached `MediaSource.fileId(...)` before the request fires.

## what gets cached

| method | media field | cached |
|---|---|---|
| `sendPhoto` | `photo` | ✅ |
| `sendVideo` | `video` | ✅ |
| `sendAnimation` | `animation` | ✅ |
| `sendVideoNote` | `video_note` | ✅ |
| `sendAudio` | `audio` | ✅ |
| `sendDocument` | `document` | ✅ |
| `sendSticker` | `sticker` | ✅ |
| anything else | — | untouched |

cache only fires for `MediaSource.path(...)` and `MediaSource.url(...)` inputs. buffers, streams, base64 are one-off by nature and skip the cache silently.

the live list lives at the exported `MEDIA_METHOD_TO_KEY_MAP` and `ALLOWED_MEDIA_TYPES` constants if you need to introspect them at runtime.

## `getStorageKey` — what counts as one cache scope

the default keyer is `(ctx) => String(ctx.params.chat_id)`, so the same `./cat.png` cached for chat A doesn't leak into chat B. that's the safe default — sticker / document permissions can vary between private and group chats, and a `file_id` minted in one chat can be unusable in another.

to share a single global cache (fine for fully public assets):

```ts
mediaCacher({
  getStorageKey: () => 'global'
})
```

per-user instead of per-chat:

```ts
mediaCacher({
  getStorageKey: (ctx) => `user:${ctx.params.user_id ?? ctx.params.chat_id}`
})
```

throws `TypeError` at request time if the default keyer can't find a `chat_id` — every method in the cached list above has one, so this only matters if you customize the cache to apply elsewhere.

## `keyStrategy` — by source string or by content hash

```ts
mediaCacher({ keyStrategy: 'sourceValue' })   // default — key by (chatId, raw path/url)
mediaCacher({ keyStrategy: 'hash' })          // key by (chatId, sha256(bytes))
```

`sourceValue` (default) — two distinct paths pointing at the exact same bytes get two distinct entries. `hash` — distinct sources resolving to identical content share one cached `file_id`.

what the hash is computed over, per source type:

| source | how |
|---|---|
| `MediaSource.path(...)` | `fs.readFile` once, sha-256 of the bytes |
| `MediaSource.url(...)` | `fetch(url)`, sha-256 of the response body |
| `MediaSource.buffer(...)` | sha-256 of the buffer directly |
| `MediaSource.arrayBuffer(...)` | sha-256 of the arraybuffer directly |
| `MediaSource.stream(...)` / `MediaSource.file(...)` | not supported — streams aren't replayable. use `'sourceValue'` for these |

**tradeoff** — `keyStrategy: 'hash'` on `MediaSource.url(...)` cache-miss fetches the url twice (once to hash, once for telegram to actually upload). for paths the kernel page cache makes the second read free.

`hashBytes` and `hashMediaInput` are exported for direct use if you want to pre-compute the hash and pass it as `sourceValue` for manual lookups.

## `tg.mediaCacher` — manual access

the plugin attaches a small handle for direct reads and evictions:

```ts
// look up the cached file_id for (storageKey, sourceValue)
const fileId = await tg.mediaCacher.get('100', './cat.png')

if (fileId !== undefined) {
  console.log('already cached:', fileId)
}

// drop a single entry — next send will re-upload
await tg.mediaCacher.invalidate('100', './cat.png')

// the raw KVStorage<string>, if you need it
await tg.mediaCacher.storage.set('whatever:key', 'AgADAQA…')
```

`storageKey` is what `getStorageKey(ctx)` returned (default: `String(ctx.params.chat_id)`). `sourceValue` is the raw string the `MediaSource` carried — `'./cat.png'` for path, `'https://…'` for url, the sha-256 hex for `keyStrategy: 'hash'`.

## auto-evict + retry on stale `file_id`

cached `file_id`s mostly live forever, but telegram occasionally rotates them — usually with one of these 400s:

- `Bad Request: wrong file identifier/HTTP URL specified`
- `Bad Request: wrong file_id`
- `Bad Request: file is temporarily unavailable`

when the plugin spots one of those on a request that used a cached `file_id`, it:

1. evicts the stale entry from storage
2. re-issues the same request once with the original `MediaSource.path(...)` / `MediaSource.url(...)`
3. lets the normal cache hook persist the fresh `file_id` from the retry response
4. returns the retry's result to the caller — exactly as if the first send had worked

if the retry itself fails (e.g. the local file was deleted, or the url 404s), the original error propagates — there's no second retry, no infinite loop.

### concurrency — one re-upload per stale id

if multiple in-flight sends share the same stale `file_id` and all 400 around the same time, only **one** re-upload happens. the first failure becomes the leader; everyone else waits until the cache is refreshed and then dispatches with the fresh id. for a heavy file in a popular chat, that's one upload instead of N.

### customizing the trigger

```ts
mediaCacher({
  staleFileIdPatterns: [
    'wrong file_id',
    'file is temporarily unavailable',
    'file no longer exists'   // custom
  ]
})
```

case-insensitive substring match against `description`. defaults cover the three known telegram messages — pass your own list if your bot api proxy returns different wording.

## persistence — bring your own `KVStorage<string>`

internally the plugin uses `MemoryStorage<string>` — fine for development, lost on restart. swap in any `KVStorage<string>`:

```ts
import { mediaCacher } from '@puregram/media-cacher'
import { LruMemoryStorage } from '@puregram/storage'

// bounded in-memory cache, no persistence
tg.extend(mediaCacher({
  storage: new LruMemoryStorage<string>({ max: 5_000 })
}))

// redis / sqlite / json — anything implementing KVStorage<string>
class RedisStorage implements KVStorage<string> { /* get/set/delete/has */ }

tg.extend(mediaCacher({
  storage: new RedisStorage(/* … */)
}))
```

see the `puregram-storage` sibling skill for the full `KVStorage<V>` contract and a redis-flavored example. `@puregram/media-cacher` re-exports `MemoryStorage` and the `KVStorage` type for convenience.

## options

`mediaCacher(options?)`:

| option | type | default | description |
|---|---|---|---|
| `storage` | `KVStorage<string>` | fresh `MemoryStorage<string>` | backing store. swap for redis/sqlite/`LruMemoryStorage`/etc to persist or bound the cache |
| `getStorageKey` | `(ctx: RequestContext) => string` | `(ctx) => String(ctx.params.chat_id)` | how to derive the cache scope key from each outgoing request. throws if `chat_id` is absent and you haven't overridden |
| `keyStrategy` | `'sourceValue' \| 'hash'` | `'sourceValue'` | raw path/url vs sha-256 of the bytes |
| `staleFileIdPatterns` | `readonly string[]` | three known telegram messages | substrings that trigger the auto-evict + retry path, matched case-insensitively against `description` |

## exported surface

```ts
import {
  mediaCacher,                 // .extend(mediaCacher())
  MemoryStorage,               // re-exported from @puregram/storage
  hashBytes, hashMediaInput,   // sha-256 helpers
  MEDIA_METHOD_TO_KEY_MAP,     // { sendPhoto: 'photo', sendVideo: 'video', … }
  ALLOWED_MEDIA_TYPES          // [MediaSourceType.Path, MediaSourceType.Url]
} from '@puregram/media-cacher'

import type {
  AllowedMediaMethod,          // 'sendPhoto' | 'sendVideo' | … (the seven cached methods)
  KeyStrategy,                 // 'sourceValue' | 'hash'
  KVStorage,                   // re-exported from @puregram/storage
  MediaCacherExtension,        // shape of tg.mediaCacher
  MediaCacherOptions           // options to mediaCacher({...})
} from '@puregram/media-cacher'
```

`tg.mediaCacher` shape:

```ts
interface MediaCacherExtension {
  get: (storageKey: string, sourceValue: string) => Promise<string | undefined>
  invalidate: (storageKey: string, sourceValue: string) => Promise<void>
  storage: KVStorage<string>
}
```

## see also

- main skill: `using-puregram` — covers `MediaSource.*`, the request-hook model, `.extend(plugin)`
- sibling: `puregram-storage` — the `KVStorage<V>` contract that backs the cache, plus `LruMemoryStorage` and `enhanceStorage` migrations
- sibling: `puregram-file-id` — parse / inspect the `file_id`s the cache stores, when you want to know which dc / type they belong to
- package source: [`packages/media-cacher/`](https://github.com/puregram/puregram/tree/v3/packages/media-cacher)
