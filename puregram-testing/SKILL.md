---
name: puregram-testing
description: >
  use when testing a puregram v3 bot with `@puregram/test` — an in-process fake
  telegram via `createTestEnv(tg, opts?)`. covers actor users / chats
  (`env.createUser`, `env.createChat`, `user.in(chat)`, `user.on(msg).tapButton`),
  raw `env.inject(raw)`, fixture builders, virtual-clock `env.advanceTime(ms)`,
  api-call recording (`env.apiCalls` / `lastApiCall` / `callsTo`), stub overrides
  (`env.onApi` + `apiError(code, desc)`), strict modes, plugin packs, and
  `env.shutdown()`. assertion-library-agnostic.
metadata:
  author: starkow
  source: https://github.com/puregram/puregram/tree/v3/packages/test
  package: "@puregram/test@3"
---

# `@puregram/test`

actor-driven test framework for puregram v3 — pretend users / chats / channels send updates to your bot, assert on the api calls it makes back. an in-process fake telegram, not a mock, not an integration test. assertion-library-agnostic (vitest / mocha / node:test / whatever).

## when to use this skill

- unit-testing a puregram bot's handler logic without hand-rolled http mocks
- testing scene flows, persistent flows, session state, rate-limit budgets — anything time-sensitive (`env.advanceTime`)
- exercising error paths — what does the bot do on `403 Forbidden`, `429 Too Many Requests`, missing chat membership?
- testing inline-keyboard taps (`user.on(message).tapButton('yes')`)
- testing channel-post handlers (`chat.post('text')`)
- testing service-event handlers (new chat members, pinned messages) via `env.inject(raw)`
- catching "i forgot to register the handler" bugs with `strictDispatch: true`
- shipping fixtures for your own plugin via `registerPack(...)`

if you need full end-to-end testing against the real telegram api, this isn't that — `@puregram/test` replaces the network. for staging-bot integration tests, use a real bot token + a throwaway chat.

## quick start

```ts
import { describe, expect, it } from 'vitest'
import { Telegram } from 'puregram'
import { createTestEnv } from '@puregram/test'

describe('echo bot', () => {
  it('replies with echo: <text>', async () => {
    const tg = new Telegram({ token: 'TEST' })  // 'TEST' is fine — no network is touched
    const env = createTestEnv(tg)

    tg.onMessage(async (message) => {
      await tg.api.sendMessage({ chat_id: message.chat.id, text: `echo: ${message.text ?? ''}` })
    })

    const alice = env.createUser({ first_name: 'Alice' })
    await alice.sendMessage('hello')

    const last = env.lastApiCall('sendMessage')

    expect(last?.params).toMatchObject({
      chat_id: alice.pmChat.id,
      text: 'echo: hello'
    })

    await env.shutdown()
  })
})
```

three things happen:
1. `createTestEnv(tg)` swaps in an intercepting http client
2. `alice.sendMessage('hello')` dispatches a `MessageUpdate` into your `onMessage` handler — same path a real update would take
3. when the bot calls `tg.api.sendMessage(...)`, the env records it; `env.lastApiCall(...)` lets you assert against the recorded params

**constructor note**: `new Telegram({ token: 'TEST' })` and `Telegram.fromToken('TEST')` both work — tests usually use the `new` form to avoid env-var rituals, the rest of the puregram docs lean on `fromToken`. either is fine.

**assertion-safety**: `env.lastApiCall(...)` returns `ApiCallRecord | undefined`. `last?.params` with `toMatchObject` silently passes when `last` is `undefined`, masking "the bot never called the api" bugs as green tests. always assert presence first:

```ts
const last = env.lastApiCall('sendMessage')
expect(last).toBeDefined()
expect(last!.params).toMatchObject({ chat_id: alice.pmChat.id, text: 'echo: hello' })
```

install as a dev-dep:

```sh
$ yarn add -D @puregram/test
```

usually your tests need it, your bundle doesn't.

## actors

actors are the things that send updates **to your bot**. think of them as the cast of a play — your `tg.on*` handlers are the bot reacting to whatever the cast does.

### users — `env.createUser(options?)`

```ts
const alice = env.createUser({
  first_name: 'Alice',
  last_name: 'Smith',   // optional
  username: 'alice',    // optional
  language_code: 'en'   // optional
})
```

`alice` is a `TestUser`. every user gets an auto-allocated id (or pass `id` if you need a specific one) and a private-message chat exposed as `alice.pmChat`.

every shape of incoming update has a corresponding actor method:

```ts
// PM (auto-uses alice.pmChat)
await alice.sendMessage('hello')
await alice.sendPhoto(buffer, { caption: 'cat' })
await alice.sendDocument(buffer)
await alice.sendVideo(buffer)
await alice.sendAudio(buffer)
await alice.sendVoice(buffer)
await alice.sendAnimation(buffer)
await alice.sendVideoNote(buffer)
await alice.sendSticker(stickerFileId)
await alice.sendLocation({ latitude: 55.75, longitude: 37.61 })
await alice.sendVenue({ latitude: 55.75, longitude: 37.61, title: 'Red Square', address: 'Moscow' })
await alice.sendContact({ phone_number: '+1234567890', first_name: 'Bob' })
await alice.sendPoll({ question: 'pick one', options: ['a', 'b'] })
await alice.sendDice('🎰')
```

### sending in a specific chat — `alice.in(chat)`

returns a `TestUserInChat` scope that pre-binds every send method to that chat:

```ts
const group = env.createChat({ type: 'group', title: 'devs' })

await alice.in(group).sendMessage('morning team')
await alice.in(group).sendPhoto(buffer, { caption: 'lunch' })
```

### callback queries on a specific message — `alice.on(message)`

scopes callback-query taps to a specific message — typically the one that carried the inline keyboard:

```ts
const reply = await alice.sendMessage('show me a button')
// the bot replied with a message that has an inline keyboard;
// alice taps "yes" on it
await alice.on(reply).tapButton('yes')
```

`alice.on(message)` also exposes `tapInlineKeyboard(callbackData)` for raw `callback_data` taps (useful with `@puregram/callback-data` payloads).

### chats — `env.createChat(options)`

```ts
const group = env.createChat({ type: 'group', title: 'devs' })
const supergroup = env.createChat({ type: 'supergroup', title: 'big devs', username: 'big_devs' })
const channel = env.createChat({ type: 'channel', title: 'News', username: 'news' })
```

a `TestChat` is a passive container — actors send into it. four chat types: `'private'`, `'group'`, `'supergroup'`, `'channel'`.

### channel posts — `chat.post(text)`

channels send updates **without a `from` user** — that's the bot api's `channel_post` semantic:

```ts
const channel = env.createChat({ type: 'channel', title: 'News' })

await channel.post('breaking news')
// fires tg.onChannelPost — update.from is undefined
```

throws if called on a non-channel chat.

### chat membership

every chat tracks who's in it — useful for `getChatMember` / `restrictChatMember` style tests:

```ts
group.setMembership(alice.id, { status: 'member', since: Date.now() })

const m = group.membershipOf(alice)
console.log(m?.status)  // 'member'
```

with `strictMembership: true` in `TestEnvOptions`, actors throw `MembershipRequired` if they try to send in a chat they're not a member of — catches scopes you forgot to set up.

## raw injection — `env.inject(raw)`

for corner-case update shapes the actor api doesn't cover yet:

```ts
await env.inject({
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: 100, type: 'private' },
    from: { id: 1, is_bot: false, first_name: 'Alice' },
    text: 'raw injection'
  }
})
```

ships through the same `update_id` dedup, the same dispatch chain, the same `update.session` / `update.scene` / etc. augmentations that polled updates would.

## fixture builders

minimal-but-realistic shapes you can override field-by-field. each builder takes an optional `overrides` partial that's **deep-merged** with the defaults — sequential ids, current unix time, `'private'` chats, `'test-user'` username, etc.:

```ts
import {
  buildCallbackQuery,
  buildChat,
  buildInlineQuery,
  buildMessage,
  buildUpdate,
  buildUser,
  resetFixtureCounters
} from '@puregram/test'

const alice = buildUser({ first_name: 'Alice' })
const group = buildChat({ type: 'group', title: 'devs', id: -1001 })

// nested overrides are deep-merged
const msg = buildMessage({
  text: 'hello',
  from: { id: alice.id, first_name: alice.first_name },
  chat: group
})

await env.inject(buildUpdate('message', msg))
```

`buildUpdate(kind, payload)` is sugar for `{ update_id, [kind]: payload }` — the `kind` is typed against `TelegramUpdate` so typos surface at compile time.

builders are state-light (module-scoped counters for ids). for deterministic ids across tests, call `resetFixtureCounters()` in your suite's `beforeEach`.

## time travel — `env.advanceTime(ms)`

testing TTL expirations (session timeouts, flow `waitFor` deadlines, rate-limit windows) shouldn't require real waits. `env.advanceTime(ms)` installs a virtual clock that overrides `Date.now`, `setTimeout`, `setInterval` (and their `clear*` counterparts), advances by `ms`, and fires every timer whose deadline falls inside the window:

```ts
const env = createTestEnv(tg)

let fired = false
setTimeout(() => { fired = true }, 60 * 60 * 1000)  // 1 hour

await env.advanceTime(3_600_000)
expect(fired).toBe(true)
```

- interval timers re-arm and may fire multiple times in a single `advance` call
- timers scheduled inside callbacks are picked up by the same call
- the clock is uninstalled automatically by `env.shutdown()` — next test gets real timers back

standalone API for finer control:

```ts
import { installTestClock } from '@puregram/test'

const clock = installTestClock(1_700_000_000_000)
setInterval(() => { /* ... */ }, 1000)

await clock.advance(3500)        // fires 3 times
clock.restore()                  // restore real globals
```

## assertions

`@puregram/test` records every outgoing `tg.api.*` call — that's the surface you assert against.

### `env.apiCalls`

every recorded call, in order:

```ts
console.log(env.apiCalls)
// [
//   { method: 'sendMessage', params: { chat_id: 1, text: 'hi' }, at: 1717000000 },
//   { method: 'sendPhoto', params: { ... }, at: 1717000001 }
// ]
```

each entry is an `ApiCallRecord`:

```ts
interface ApiCallRecord {
  method: string
  params: Record<string, unknown>
  result?: unknown
  error?: { error_code: number, description: string, parameters?: object }
  at: number
}
```

### `env.lastApiCall(method?)`

newest call, optionally filtered by method:

```ts
const last = env.lastApiCall('sendMessage')

expect(last?.params).toMatchObject({ chat_id: alice.pmChat.id, text: 'echo: hello' })
```

### `env.callsTo(method)`

every call to a specific method, oldest first:

```ts
expect(env.callsTo('sendMessage')).toHaveLength(1)
expect(env.callsTo('sendPhoto')).toHaveLength(0)
```

### `env.clearApiCalls()`

drop the recording — useful between scenarios in a long-running test:

```ts
await alice.sendMessage('warmup')
env.clearApiCalls()

await alice.sendMessage('the actual case')
expect(env.callsTo('sendMessage')).toHaveLength(1)
```

## stubbing the api

without overrides, `@puregram/test` returns plausible auto-stubs:

| method | auto-stub |
|---|---|
| `getMe` | a synthetic bot user (`{ id: <auto>, is_bot: true, first_name: 'TestBot', username: 'test_bot' }`) |
| `sendMessage` (and `sendX` siblings) | a plausible `Message` echoing back `chat_id` + the relevant content |
| `answerCallbackQuery` / `answerShippingQuery` / `answerPreCheckoutQuery` | `true` |
| anything else | falls through to user override or, with `strictApi: true`, throws |

### `env.onApi(method, reply, opts?)` — override

```ts
env.onApi('getMe', { id: 7, is_bot: true, first_name: 'MyBot', username: 'my_bot' })

env.onApi('getChatMember', { user: { id: 1, is_bot: false, first_name: 'A' }, status: 'member' })
```

defaults to "reply with this every time"; `opts.times = 1` makes it one-shot (perfect for "first call fails, second succeeds" tests):

```ts
env.onApi('sendMessage', apiError(429, 'Too Many Requests', { retry_after: 1 }), { times: 1 })
env.onApi('sendMessage', { message_id: 1, date: 0, chat: { id: 1, type: 'private' } })
```

`opts.mutateWorld: true` keeps the world-state mutations (e.g. appending the synthetic message to chat history) even when the reply is overridden.

### `apiError(code, description, parameters?)` — error sentinels

returning an `apiError(...)` from a stub makes the bot see a real bot-api error response:

```ts
import { apiError } from '@puregram/test'

env.onApi('sendMessage', apiError(403, 'Forbidden: bot was blocked by the user'))

tg.onMessage(async (m) => {
  try {
    await tg.api.sendMessage({ chat_id: m.chat.id, text: 'hi' })
  } catch (error) {
    // error.code === 403, error.message === 'Forbidden: bot was blocked by the user'
  }
})
```

rate-limit responses with `parameters`:

```ts
env.onApi('sendMessage', apiError(429, 'Too Many Requests', { retry_after: 30 }))
```

`isApiErrorSentinel(value)` is the typeguard for inspecting a stored override.

### `env.offApi(method?)` — drop overrides

```ts
env.offApi('sendMessage')   // drop sendMessage's overrides
env.offApi()                // drop every override
```

## options — strict modes

`createTestEnv(telegram, options?)`:

| option | type | description |
|---|---|---|
| `strictMembership` | `boolean` | when `true`, actor methods throw `MembershipRequired` if the actor isn't a member of the target chat. forces you to wire chat membership explicitly. default `false` |
| `strictApi` | `boolean` | when `true`, an api call with no auto-stub and no override throws. default `false` (auto-stubs cover common methods, unmocked rare ones return undefined) |
| `strictDispatch` | `boolean` | when `true`, actor calls fail if no `tg.on*` handler matches the dispatched update — catches "i forgot to register the handler" bugs. default `false` |

all three are off by default so you can drop the framework into an existing test and not have it break everything. flip them on once you want stricter discipline.

## plugin packs — `registerPack(...)`

if you're testing a satellite plugin and want to ship pre-canned fixtures (typed storage views, stub replies for the methods that plugin always touches), `registerPack(...)` registers a factory that runs once for every `createTestEnv(...)` whose target `tg` has the plugin installed:

```ts
import { registerPack, type PackFactory } from '@puregram/test'

const sessionPack: PackFactory = {
  pluginName: 'session',
  apply: (env, tg) => {
    // wire up env.storage with a friendly view, stub a default getMe, etc.
  }
}

registerPack(sessionPack)
```

the satellite's package can ship its own pack — `@puregram/test/session`, `@puregram/test/scenes` — and consumers get the fixtures by importing them. `@puregram/test` already ships subpath exports for the official plugin packs.

## media in tests — `FileStore`

actor methods like `sendPhoto(buffer, ...)` need a `file_id` for the synthetic message they produce. `FileStore` does the bookkeeping — every `Buffer` / `Uint8Array` / pre-existing `file_id` you hand it gets registered as a `FileHandle`:

```ts
import { FileStore } from '@puregram/test'

const store = new FileStore()
const handle = store.registerBuffer(Buffer.from('fake photo'))
// → { file_id: 'sha256-...', file_unique_id: '...' }
```

normally the env owns its own store and you don't touch it — `alice.sendPhoto(Buffer.from('x'))` does this internally. reach for `FileStore` directly when you're building custom actor methods.

## `env.onPostInject(fn)` — react to dispatched updates

a hook that fires after every actor-driven update finishes dispatching. useful for "the bot processed something — let me snapshot the world state" patterns:

```ts
env.onPostInject((rawUpdate) => {
  console.log('bot just finished processing:', rawUpdate)
})
```

multiple hooks compose; they fire in registration order.

## tearing down

```ts
await env.shutdown()
```

restores the original http client, runs `tg.shutdown()` (so `onShutdown` plugin hooks fire), drains in-flight tasks. **always call this in your test's teardown** — `vitest`'s `afterEach`, `mocha`'s `afterEach`, `node:test`'s `afterEach`.

```ts
let env: ReturnType<typeof createTestEnv>

beforeEach(() => {
  const tg = new Telegram({ token: 'TEST' })
  env = createTestEnv(tg, { strictDispatch: true })
})

afterEach(async () => {
  await env.shutdown()
})
```

## `TestEnv` interface reference

```ts
class TestEnv<TG extends Telegram = Telegram> {
  readonly tg: TG
  readonly options: TestEnvOptions
  readonly apiCalls: ApiCallRecord[]
  storage: StorageViewWithRegister | undefined  // attached by plugin packs

  // actors
  createUser (options?: CreateUserOptions): TestUser
  createChat (options: { type: ChatType, title?: string, username?: string }): TestChat

  // raw injection
  inject (raw: Record<string, unknown>): Promise<void>
  onPostInject (fn: (raw: Record<string, unknown>) => Promise<void> | void): void

  // assertions
  lastApiCall (method?: string): ApiCallRecord | undefined
  callsTo (method: string): ApiCallRecord[]
  clearApiCalls (): void

  // stubs
  onApi (method: string, reply: unknown, opts?: { times?: number, mutateWorld?: boolean }): void
  offApi (method?: string): void

  // time travel
  advanceTime (ms: number): Promise<void>

  // teardown
  shutdown (): Promise<void>
}
```

## exported surface

```ts
import {
  apiError,                  // (code, description, params?) => ApiErrorSentinel
  buildCallbackQuery,
  buildChat,
  buildInlineQuery,
  buildMessage,
  buildUpdate,
  buildUser,
  createTestEnv,             // factory: (tg, opts?) => TestEnv
  FileStore,                 // file-store class for custom actor methods
  installTestClock,          // standalone virtual clock
  isApiErrorSentinel,
  MembershipRequired,        // thrown when strictMembership rejects a send
  registerPack,              // global plugin pack registration
  resetFixtureCounters,      // reset id counters used by build* helpers
  TestChat,
  TestEnv,
  TestMessage,
  TestUser,
  TestUserInChat,
  TestUserOnMessage
} from '@puregram/test'

import type {
  ActorMediaInput,           // shape accepted by actor sendPhoto/sendVideo/etc
  ApiCallRecord,
  ApiErrorSentinel,
  ChatMembership,            // { status, since, customTitle? }
  ChatType,                  // 'private' | 'group' | 'supergroup' | 'channel'
  CreateUserOptions,
  FileHandle,                // { file_id, file_unique_id }
  PackFactory,
  ResolvedMedia,
  TestEnvOptions             // strictMembership / strictApi / strictDispatch
} from '@puregram/test'
```

## see also

- main skill: `using-puregram` — covers `.extend(plugin)`, the Telegram client, dispatch model
- sibling: `puregram-session` — pair with `strictDispatch: true` for catching missing handlers in scene/session flows
- sibling: `puregram-flow` — pair `env.advanceTime` with `waitFor` timeouts and persistent flow ttls
- sibling: `puregram-scenes` — `strictDispatch` is especially useful here to catch unhandled steps
- package source: [`packages/test/`](https://github.com/puregram/puregram/tree/v3/packages/test)
