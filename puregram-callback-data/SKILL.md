---
name: puregram-callback-data
description: >
  use when working with `@puregram/callback-data` in puregram v3 — typed
  `callback_data` payloads. covers `defineCallbackData(slug)` with `.string` /
  `.number` / `.boolean` / `.literal`, `.pack` / `.unpack` / `.repack`, `.button`
  inline-button shortcut, dispatch-ready `.filter`, `.with(condition)` narrowing
  with `present` / `missing` markers, `.and` / `.or` / `.not` composition, and
  the optional `callbackData([...])` plugin for global slug-collision detection.
metadata:
  author: nitreojs
  source: https://github.com/nitreojs/puregram/tree/v3/packages/callback-data
  package: "@puregram/callback-data@3"
---

# `@puregram/callback-data`

typed callback-data builder for puregram v3. stop stuffing JSON into the 64-byte `callback_data` budget — declare a schema, get a tiny binary-ish encoder, packed buttons, a dispatch-ready filter, and full TS narrowing all the way through to `q.payload` in your handler.

## when to use this skill

- any inline-button flow that needs to identify which button + carry state on the press
- replacing `callback_data: 'cart:add:abc'` / `JSON.stringify({ kind: 'cart', sku: 'abc' })` pattern with typed + validated payloads
- you've outgrown the 64-byte limit packing decimal numbers or json
- you want compile-time + runtime checks that the data on a button matches the schema the handler expects
- you need pagination / counter / step-through buttons (`.repack`)
- you need conditional dispatch based on payload values (`.with({ kind: 'ban' })`)
- you have multiple schemas and want to fail fast on slug collisions (`callbackData([...])` plugin)
- migrating from `@puregram/callback-data@1.x`

if you also need typed callback payloads that survive bot restarts (state lives in storage, not in the button), look at `puregram-flow` persistent flows. callback-data is for state encoded **in the button itself**.

## quick start

```ts
import { Telegram } from 'puregram'
import { defineCallbackData } from '@puregram/callback-data'

const Ban = defineCallbackData('ban').number('user_id')

const tg = Telegram.fromToken(process.env.TOKEN!)

tg.onMessage((m) => {
  return m.send('this user is sus', {
    reply_markup: {
      inline_keyboard: [[Ban.button({ text: 'ban', user_id: m.senderId! })]]
    }
  })
})

tg.onCallbackQuery(Ban.filter, (q) => {
  // q.payload: { user_id: number } — fully typed, validated, narrowed
  return q.answer({ text: `banned ${q.payload.user_id}` })
})

await tg.startPolling()
```

`Ban.filter` is the dispatch-ready filter; pass it to `tg.onCallbackQuery(...)` and the handler's update gets the unpacked `payload` attached. no separate `.handle()` middleware, no string-prefix routing, no `JSON.parse`.

## defining a schema

```ts
import { defineCallbackData } from '@puregram/callback-data'

const Action = defineCallbackData('action')
  .number('user_id')                                  // signed safe integer
  .literal('kind', ['ban', 'kick', 'mute'] as const)  // packs as ceil(log2(N)) bits
  .boolean('confirm')                                 // packs as 1 bit
  .string('reason', { optional: true })               // utf-16, max 127 code units
```

each method returns a **fresh** `CallbackData` (immutable / chainable), so storing intermediate variables is safe.

### field types

| method | wire cost | TS type |
|---|---|---|
| `.string(key, opts?)` | 1 length byte + N code units | `string` |
| `.number(key, opts?)` | 1–9 zigzag-varint bytes | `number` (signed safe integer only) |
| `.boolean(key, opts?)` | 1 **bit** (in header) | `boolean` |
| `.literal(key, [...] as const, opts?)` | `ceil(log2(N))` bits (in header) | union of the literals |

### `default` / `optional`

```ts
.number('count', { default: 0 })       // omitted at pack-time → uses default
.string('reason', { optional: true })  // omitted → field absent at unpack
```

**mutually exclusive** — pick one. `default` keeps the field required at the type level but lets you skip it at pack sites. `optional` widens the TS type to `T | undefined` and frees you from passing it at all.

## slug + collision

the schema's slug becomes the wire prefix on every packed payload. by default it's the first 6 chars of `base64url(md5(slug))` — short, url-safe, deterministic, collision-resistant for ~hundreds of schemas. customize with `slugLength`:

```ts
defineCallbackData('ban', { slugLength: 4 })   // shorter prefix, slightly higher collision risk
defineCallbackData('ban', { slugLength: 22 })  // full md5, zero collision risk
```

### global collision detection

if you want runtime collision detection across every schema in your bot, install the optional plugin:

```ts
import { callbackData } from '@puregram/callback-data'

const tg = Telegram.fromToken(TOKEN).extend(callbackData([Ban, Kick, Promote]))
// throws on install if any two schemas hash to the same slug
```

## packing + unpacking

```ts
const data = Action.pack({ user_id: 1337, kind: 'ban', confirm: true })
// data: '<slug><header><body>' — typically 8-12 bytes total

Action.unpack(data)
// { user_id: 1337, kind: 'ban', confirm: true }

Action.unpack('garbage')
// null — never throws

Action.validate(data)
// true
```

`unpack` returns `null` on any malformed input (wrong slug, truncated body, invalid literal index). it never throws.

`pack` throws on:

- missing required field with no default → `CallbackDataInvalid`
- wrong type (e.g. `'true'` for a boolean) → `CallbackDataInvalid`
- non-integer / non-safe number → `CallbackDataInvalid`
- string > 127 code units → `CallbackDataInvalid`
- final payload > 64 bytes → `CallbackDataTooLong`

### `.button({ text, ...state })` — inline button shortcut

```ts
const Ban = defineCallbackData('ban').number('user_id')

// before:
const button = { text: 'Ban', callback_data: Ban.pack({ user_id: 1337 }) }

// after:
const button = Ban.button({ text: 'Ban', user_id: 1337 })
```

returns a plain `TelegramInlineKeyboardButton`; works anywhere a button is expected. composes naturally with `InlineKeyboard.keyboard([...])`.

### `.repack(data, partial)` — counter / pagination / step-through

```ts
const Pager = defineCallbackData('pager').number('page')

const next = Pager.repack(currentData, { page: currentPage + 1 })
// unpacks → merges → re-packs in one shot
```

throws if `data` doesn't match this schema's slug. ideal for "next page" / "+1" buttons that mutate one field of the existing payload.

## filtering with `.with(...)`

`.with(...)` narrows the filter. matchers can be **values**, **predicates**, **arrays** of either, or the `present` / `missing` markers:

```ts
import { defineCallbackData, present, missing } from '@puregram/callback-data'

const Action = defineCallbackData('a')
  .number('user_id')
  .literal('kind', ['ban', 'kick', 'mute'] as const)
  .string('reason', { optional: true })

const ADMIN_IDS = new Set([1, 2, 3])

// exact value
tg.onCallbackQuery(Action.with({ kind: 'ban' }).filter, q => /* q.payload.kind: 'ban' */)

// array — match any
tg.onCallbackQuery(Action.with({ kind: ['ban', 'kick'] }).filter, q => /* q.payload.kind: 'ban' | 'kick' */)

// predicate
tg.onCallbackQuery(Action.with({ user_id: id => !ADMIN_IDS.has(id) }).filter, q => /* ... */)

// presence
tg.onCallbackQuery(Action.with({ reason: present }).filter, q => /* q.payload.reason: string */)
tg.onCallbackQuery(Action.with({ reason: missing }).filter, q => /* q.payload.reason: undefined */)
```

**chains**: multiple `.with(...)` calls AND together. each call returns a **new** `CallbackData` (and its `.filter`) without mutating the original schema.

### filter chain ops

`.filter` is a regular v3 `Filter`, so `.and` / `.or` / `.not` work like any other:

```ts
tg.onCallbackQuery(Ban.filter.or(Kick.filter), handler)
tg.onCallbackQuery(Action.with({ kind: 'ban' }).filter.and(somePredicate), handler)
```

## wire format

after the slug prefix:

- **header**: bit-packed presence + boolean values + literal indices, packed 7 bits per ASCII byte. exact size = `ceil(headerBits / 7)`, deterministic from the schema alone
- **body**: variable-length strings (`[length-byte][N code units]`) and varint numbers (zigzag, base-64 over the high-bit-zero charset, continuation bit at `0x40`), in field-declaration order. **only present fields contribute bytes**

booleans cost **1 bit**, not 1 byte. enums (literals) cost `ceil(log2(N))` bits. optional fields cost 1 presence bit + their normal cost when present. small numbers fit in 1–2 bytes; even 13-digit telegram chat IDs fit in 8 bytes vs 14 for decimal `toString`.

### example sizes

| schema | sample state | bytes |
|---|---|---|
| `{ id: number }` | `{ id: 1337 }` | 8 |
| `{ id: number }` | `{ id: 1234567890 }` | 11 |
| 7-boolean schema | all `true` | 7 |
| `{ id: number, ban: bool, reason?: enum<8> }` | `{ id: 99, ban: true, reason: 'spam' }` | 9 |

## typescript narrowing

`tg.onCallbackQuery(BanPayload.filter, handler)` types `handler`'s argument as `CallbackQueryUpdate & { payload: State }`. `.with(...)` further narrows `payload` based on the conditions:

```ts
const Ban = defineCallbackData('ban').literal('kind', ['ban', 'kick'] as const).number('user_id')

tg.onCallbackQuery(Ban.with({ kind: 'ban' }).filter, (q) => {
  q.payload.kind     // 'ban' (not 'ban' | 'kick')
  q.payload.user_id  // number
})

tg.onCallbackQuery(Ban.with({ kind: ['ban', 'kick'] }).filter, (q) => {
  q.payload.kind     // 'ban' | 'kick'
})
```

**predicate-based conditions don't narrow** — TS can't infer from a runtime function. value and array conditions do.

## v2 → v3 migration

if you used `@puregram/callback-data@1.x`, the new API is mostly the same shape with these changes:

| v1 (puregram v2) | v3 |
|---|---|
| `CallbackDataBuilder.create('ban')` | `defineCallbackData('ban')` (the v1 name is still re-exported as an alias) |
| `.handle(fn)` middleware | gone — use `tg.onCallbackQuery(BanPayload.filter, handler)` directly |
| `.filter({...})` (conditional method) | renamed to `.with({...})`, returns a fresh schema (immutable) |
| `.filter` property | now the dispatch-ready `Filter` value |
| `filters.exists()` | `present` / `missing` markers |
| `context.unpackedPayload` | `q.payload` |
| oversize payload failed silently at telegram | now throws `CallbackDataTooLong` at pack time |
| slug encoded via plain `base64` | now `base64url` — old packed strings won't round-trip |

wire format changed in v3 — old payloads stored in long-lived buttons (e.g. pinned messages) won't unpack on the new schema. if you have surviving v2 buttons in active chats, encode them under a different schema and migrate readers gradually.

## errors

| error | thrown when |
|---|---|
| `CallbackDataInvalid` | `pack` got missing required field, wrong type, unsafe integer, or string > 127 code units |
| `CallbackDataTooLong` | final packed payload > 64 bytes (telegram's `callback_data` ceiling) |

`unpack` and `validate` never throw — they return `null` / `false` on malformed input.

```ts
import { CallbackDataInvalid, CallbackDataTooLong } from '@puregram/callback-data'

try {
  const data = MyPayload.pack(state)
} catch (err) {
  if (err instanceof CallbackDataTooLong) {
    // schema too rich for 64 bytes — split into multiple buttons or drop a field
  } else if (err instanceof CallbackDataInvalid) {
    // state doesn't match the schema
  }
}
```

## exported surface

```ts
import {
  defineCallbackData,
  CallbackDataBuilder,    // alias for defineCallbackData (v1 compat)
  callbackData,           // optional global collision-detection plugin
  present,                // .with({ field: present })
  missing,                // .with({ field: missing })
  CallbackDataInvalid,
  CallbackDataTooLong
} from '@puregram/callback-data'

import type {
  CallbackData,           // return type of defineCallbackData
  CallbackDataState,      // infer<T> helper: the state shape of a schema
  CallbackDataOptions     // options to defineCallbackData
} from '@puregram/callback-data'
```

## see also

- main skill: `using-puregram` — covers `.extend(plugin)`, filters, `tg.onCallbackQuery`, inline keyboards
- sibling: `puregram-flow` — persistent flows for state that survives restarts (state in storage, not in the button)
- package source: [`packages/callback-data/`](https://github.com/nitreojs/puregram/tree/v3/packages/callback-data)
