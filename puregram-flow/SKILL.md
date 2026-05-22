---
name: puregram-flow
description: >
  use when working with `@puregram/flow` in puregram v3 — `waitFor(kind, opts?)`
  pausing a handler, `waitForCallbackQuery` / `waitForCommand` shortcuts,
  `waitForAny([...specs])` racing waiters with `AbortSignal`, `prompt(text)`
  send-then-wait, `collectMediaGroup(...)` album buffering, and persistent flows
  (`flow.handle(id, config)` + `flow.prompt({ id, payload, ttl })`) that survive
  restarts. two surfaces — `update.flow.*` auto-scoped inside handlers,
  `tg.flow.*` explicit chat/from outside.
metadata:
  author: nitreojs
  source: https://github.com/nitreojs/puregram/tree/v3/packages/flow
  package: "@puregram/flow@3"
---

# `@puregram/flow`

conversational primitives for puregram v3: pause a handler until a specific update arrives, ask-then-wait prompts, race multiple waiters, buffer album items, and persistent flows that survive bot restarts. v2's `@puregram/prompt` + the `mergeMediaEvents` option + a new `waitFor` are all rolled into this one plugin.

## when to use this skill

- pausing a handler for the next message / callback / inline-query / any update kind (`waitFor`)
- send-then-wait conversations (`prompt`) — sign-ups, confirmations, validation loops
- multi-step linear flows where each step waits on the previous user reply
- racing several waiters in parallel and acting on whichever wins (`waitForAny`)
- gathering every item in an album into one array (`collectMediaGroup`)
- multi-step flows that **must survive a bot restart** — registration wizards, two-step purchases, "user closes the app and comes back tomorrow"
- coordinating waiter cancellation with `AbortSignal` (`AbortSignal.timeout` / `AbortSignal.any`)
- callback-query confirmation flows with `waitForCallbackQuery(predicate)`
- "wait for /done" patterns with `waitForCommand(name)`

if you also need session state (state that *isn't* tied to a pending waiter), install `@puregram/session` and look at the `puregram-session` skill. if you need rich multi-step wizards with branching and on-enter/on-leave lifecycle, look at `puregram-scenes`.

## quick start

```ts
import { Telegram } from 'puregram'
import { flow } from '@puregram/flow'

const tg = Telegram.fromToken(process.env.TOKEN!)
  .extend(flow())

tg.command('signup', async (message) => {
  const name = await message.flow.prompt("what's your name?", {
    timeout: 60_000,
    nullOnTimeout: true
  })

  if (name === null) {
    return message.send('cancelled')
  }

  await message.send(`hi, ${name.text}`)
})

await tg.startPolling()
```

## two surfaces — `update.flow` vs `tg.flow`

every primitive exists in **two places**:

- **`update.flow.*`** — context-bound, attached to every incoming update with a chat. chat is auto-derived; sender is auto-derived too. **use this form inside handlers** — it's shorter and the binding is right by default
- **`tg.flow.*`** — lower-level, takes explicit `chat` / `from`. **use outside handlers** (cron jobs, webhook endpoints, anywhere there's no incoming update to bind to), or when you need to override the auto-derived scope

| inside a handler | outside a handler |
|---|---|
| `await message.flow.prompt('name?')` | `await tg.flow.prompt(chatId, 'name?', { from })` |
| `await message.flow.waitFor('callback_query')` | `await tg.flow.waitFor('callback_query', { filter, timeout })` |
| `await message.flow.collectMediaGroup()` | `await tg.flow.collectMediaGroup(message)` |

`update.flow` is auto-attached to every update kind that has a chat in the payload — `message`, `edited_message`, `channel_post`, `business_message`, `callback_query`, `chat_member`, `chat_join_request`, plus all message-derived service events (`new_chat_members`, `pinned_message`, `boost_added`, ...).

every section below leads with the `update.flow` form; the `tg.flow` equivalent is shown next to it.

## `waitFor` — pause your handler

resolves with the next matching wrapped update of `kind`. throws `WaitForTimeout` on expiry by default; pass `nullOnTimeout: true` to get `null` instead.

```ts
tg.command('echo', async (message) => {
  await message.send('send me anything')

  const reply = await message.flow.waitFor('message', {
    timeout: 30_000,
    nullOnTimeout: true
  })

  if (reply === null) {
    return message.send('timed out')
  }

  return message.send(`you said: ${reply.text}`)
})
```

### `match` — control the auto-scope

`update.flow.waitFor` accepts a `match` field that controls the auto-gating:

| `match` | meaning |
|---|---|
| `'chat+from'` (default when both extractable) | wait for an update from the same chat AND the same sender |
| `'chat'` (default when only chat extractable, e.g. channel posts) | wait for any update in the same chat |
| `'none'` | no auto-scoping — only your `filter` runs |

```ts
// "anyone in this chat can reply" — drop the sender pin
const anyReply = await message.flow.waitFor('message', { match: 'chat' })

// strict pinning is the default; combine with your own filter for extra checks
const yes = await message.flow.waitFor('callback_query', {
  filter: (q) => q.data === 'yes'
})
```

### the lower-level form

```ts
const wait = await tg.flow.waitFor('message', {
  filter: (m) => m.chat.id === someChatId && m.from?.id === someUserId,
  timeout: 30_000,
  nullOnTimeout: true
})
```

use it from cron jobs / webhook endpoints, or when you need cross-chat behavior `update.flow`'s auto-scope blocks.

### `WaitForOptions` (both forms)

| field | type | default | description |
|---|---|---|---|
| `filter` | `(update) => boolean` | `() => true` | extra predicate. on `update.flow.waitFor` it's AND-composed with the auto-scope; on `tg.flow.waitFor` it's the only gate |
| `timeout` | `number` (ms) | `Infinity` | when to give up |
| `nullOnTimeout` | `boolean` | `false` | return `null` instead of throwing on timeout |
| `consume` | `boolean` | `true` | when matched, swallow the update so other handlers don't see it. set `false` to keep it flowing |
| `validate` | `(update) => boolean \| string` | none | post-filter check. return `false` to silently re-wait, return a string to send that as feedback and re-wait |
| `transform` | `(update) => T` | identity | shape the matched update before resolving. promise type follows the return type |
| `signal` | `AbortSignal` | none | external cancellation. fires `WaiterAbortedError`. pairs with `AbortSignal.timeout(...)` / `AbortSignal.any([...])` |

### multiple waiters on the same update

if more than one waiter matches the same update, **first registered wins** — others keep waiting (FIFO). locked semantics inherited from v2's prompt/waitFor.

### cancellation

```ts
tg.flow.cancelAll()   // reject every pending in-memory waiter with WaitForCancelled
```

useful in shutdown / hot-reload paths. persistent records (see below) are untouched.

## `waitForCallbackQuery` / `waitForCommand` — common-case sugar

two thin wrappers over `waitFor` that build the predicate for you. both accept every `WaitForOptions` knob.

### `waitForCallbackQuery(predicate?, options?)`

wait for the next callback query whose data matches `predicate`. omit `predicate` to match any callback query.

```ts
tg.command('confirm', async (message) => {
  await message.send('press the button', {
    reply_markup: {
      inline_keyboard: [[{ text: 'confirm', callback_data: 'confirm:yes' }]]
    }
  })

  const tap = await message.flow.waitForCallbackQuery(
    (q) => q.data === 'confirm:yes',
    { timeout: 30_000, nullOnTimeout: true }
  )

  if (tap === null) return message.send('timed out')

  await tap.answer()
  await message.send('confirmed')
})
```

`update.flow.waitForCallbackQuery` applies the same `'chat+from'` auto-scope. pass `match: 'chat'` for "anyone in this chat can tap".

### `waitForCommand(name, options?)`

wait for the next message whose text matches `/name`, `/name@bot`, or `/name <args>`. pass a `RegExp` for arbitrary patterns:

```ts
const done = await message.flow.waitForCommand('done', {
  timeout: 60_000,
  nullOnTimeout: true
})

// regex form
const cancel = await message.flow.waitForCommand(/^\/(cancel|stop|abort)$/, {
  timeout: 30_000,
  nullOnTimeout: true
})
```

falls back to `caption` when `text` is undefined — commands sent under media attachments still match.

## `waitForAny` — race multiple waiters

run several waiters in parallel, resolve on the **first** match. losers are cancelled (listeners unregister — no memory leak):

```ts
import { spec } from '@puregram/flow'

const winner = await tg.flow.waitForAny([
  spec('callback_query', { filter: (q) => q.data === 'confirm' }),
  spec('message', { filter: (m) => m.text === 'cancel' })
])

if (winner.index === 0) {
  // they tapped confirm — winner.value is the CallbackQueryUpdate
  await winner.value.answer({ text: 'confirmed' })
} else {
  // they sent "cancel" as a message
  await tg.send(winner.value.chat.id, 'cancelled')
}
```

`{ index, value }` shape — `index` is the position in the input array, `value` is the matched (transform-aware) update for that spec.

`spec(kind, options?)` is a helper that preserves the literal `kind` so each spec's `filter` gets the precise `UpdateKindMap[K]` parameter type. plain object literals work too, you just have to type the filter parameters yourself.

### shared deadline via `AbortSignal`

```ts
import { WaiterAbortedError } from '@puregram/flow'

const deadline = AbortSignal.timeout(30_000)

try {
  const winner = await message.flow.waitForAny(
    [
      { kind: 'callback_query', options: { filter: (q) => q.data === 'confirm' } },
      { kind: 'message' }
    ],
    { signal: deadline }
  )
  // ... handle winner
} catch (error) {
  if (error instanceof WaiterAbortedError) {
    await message.send('took too long — try again')
  } else {
    throw error
  }
}
```

each spec may also carry its own per-waiter `signal` for finer control. use `AbortSignal.any([sigA, sigB])` to combine.

## `prompt` — send + waitFor in one

```ts
const reply = await message.flow.prompt("what's your name?", {
  timeout: 60_000,
  nullOnTimeout: true
})

if (reply === null) return message.send('cancelled')

await message.send(`hi, ${reply.text}`)
```

three things happen:

1. sends `text` to the same chat the message came from
2. opens a `waitFor` auto-scoped to that chat + the same sender
3. resolves with the matched reply (or `null` on timeout if `nullOnTimeout: true`)

### overriding the binding

```ts
// "anyone in chat" — drop the sender pin
await message.flow.prompt('react below', { from: undefined })

// reply in a different chat
await message.flow.prompt('reply over there', { chat: otherChatId })
```

setting `from: undefined` explicitly opts out. omitting `from` keeps the default sender pin.

### lower-level form

```ts
await tg.flow.prompt(chatId, 'name?', { from: userId, timeout: 60_000, nullOnTimeout: true })
```

### `PromptOptions` — extends `WaitForOptions` with three knobs

| field | type | default | description |
|---|---|---|---|
| `kind` | `keyof UpdateKindMap` | `'message'` | which update kind closes this prompt. set to `'callback_query'` to wait for a button tap |
| `from` | `number` | sender of the source update (auto-derived) | restrict to replies from a specific user id |
| `reply_markup` | `InlineKeyboardMarkup \| ...` | none | keyboard attached to the prompt message |

### chained prompts (multi-step)

```ts
tg.command('signup', async (message) => {
  const name = await message.flow.prompt('name?', { nullOnTimeout: true })
  if (name === null) return

  const age = await message.flow.prompt('age?', { nullOnTimeout: true })
  if (age === null) return

  await message.send(`${name.text}, ${age.text}`)
})
```

each prompt's filter is composed independently — answers don't leak between waiters.

## `collectMediaGroup` — albums in one call

when a user sends an album, telegram delivers each item as a separate `MessageUpdate` with the same `media_group_id`. `collectMediaGroup` buffers on a sliding-window basis and resolves with the full set:

```ts
tg.onMessage(async (message) => {
  if (!message.hasMediaGroupId()) return

  const all = await message.flow.collectMediaGroup()
  await message.send(`got ${all.length} items in this album`)
})
```

resolves immediately with `[message]` if `media_group_id` is absent — safe to call defensively.

### lower-level form

```ts
await tg.flow.collectMediaGroup(message, options?)
```

### tuning the window

```ts
// plugin-level default — applies to every collectMediaGroup call without a per-call override
const tg = Telegram.fromToken(TOKEN).extend(flow({ mediaGroupWindow: 2_000 }))

// per-call override
const all = await message.flow.collectMediaGroup({ window: 500 })
```

window is **sliding** — every new item resets the timer. defaults to `1000` ms. larger windows tolerate slower telegram backends; smaller windows resolve faster but risk truncating a slow-arriving album.

## persistent flows

ephemeral `prompt` / `waitFor` lives in memory — a bot restart drops every pending prompt. for flows that must **survive restarts** (registration wizards, two-step purchases), use the persistent variant.

### setup

```ts
import { Telegram } from 'puregram'
import { MemoryStorage } from '@puregram/storage'
import { flow, type PersistedFlow } from '@puregram/flow'

const tg = Telegram.fromToken(process.env.TOKEN!)
  .extend(flow({
    storage: new MemoryStorage<PersistedFlow>(),  // swap for redis/sqlite/file in prod
    defaultTtl: 24 * 60 * 60 * 1000               // 24h default expiry
  }))
```

### `flow.handle(id, config)` — the resume body

declare the handler at module scope (or inside `install`, anywhere that runs once at bot startup). when a persisted record matching `id` resolves on a future update — *even after a restart* — the registered config fires:

```ts
tg.flow.handle('register:age', {
  kind: 'message',
  validate: (m) => {
    const n = Number.parseInt(m.text ?? '', 10)
    return Number.isFinite(n) ? true : 'please send a number'
  },
  transform: (m) => Number.parseInt(m.text ?? '0', 10),
  onAnswer: async (age, ctx) => {
    const payload = ctx.payload as { name: string }
    await ctx.send(ctx.chatId, `${payload.name}, age ${age} ✓`)
  },
  onTimeout: async (ctx) => {
    await ctx.send(ctx.chatId, 'signup expired')
  }
})
```

`config` fields:

| field | type | description |
|---|---|---|
| `kind` | `keyof UpdateKindMap` | update kind that closes this prompt. defaults to `'message'`. mismatch with the call-site `kind` throws `FlowKindMismatch` |
| `validate` | `(update) => boolean \| string` | post-filter check; return `false` for silent re-wait, string for re-wait with feedback message |
| `transform` | `(update) => T` | shape the matched update into the value `onAnswer` receives |
| `onAnswer` | `(value, ctx) => Promise<void>` | **required** — the resume body |
| `onTimeout` | `(ctx) => Promise<void>` | runs once on `ttl` expiry |
| `filter` | `(update) => boolean` | optional secondary filter, AND-composed with the call-site filter |

### opening the persistent flow

call `flow.prompt({ id, payload, ttl })` or `flow.waitFor({ id, chatId, fromId, payload, ttl })`. the open call writes a record to storage and **returns immediately** — the registered handler resolves it on a future matching update:

```ts
tg.command('signup', async (message) => {
  if (message.from === undefined) return

  await tg.flow.prompt(message.chat.id, 'how old are you?', {
    id: 'register:age',
    payload: { name: message.from.firstName },
    ttl: 60 * 60 * 1000
  })
})
```

`flow.waitFor({ id })` is the no-prompt variant — for "press the button below" where you've already sent the message:

```ts
tg.flow.handle('confirm:purchase', {
  kind: 'callback_query',
  onAnswer: async (q) => {
    await q.answer({ text: 'confirmed' })
  }
})

tg.command('buy', async (message) => {
  if (message.from === undefined) return

  await tg.flow.waitFor('callback_query', {
    id: 'confirm:purchase',
    chatId: message.chat.id,
    fromId: message.from.id
  })
})
```

### `FlowHandleContext` — what `onAnswer` and `onTimeout` get

```ts
interface FlowHandleContext {
  id: string                            // the registered handle id
  chatId: number                        // the chat the prompt was opened in
  fromId: number | undefined            // scoped user id, undefined when accepting any user
  payload: unknown                      // verbatim from the open call site
  update: UpdateKindMap[K]              // the raw matched update (or trigger update on timeout)

  open: (id, options?) => Promise<void> // chain into another persistent prompt — same shape as flow.prompt
  close: () => Promise<void>            // explicit early termination — drops the record, no onAnswer fires
  send: tg.send                         // proxy onto tg.send (NOT pre-bound to chatId — pass it explicitly)
}
```

`ctx.open(id, opts?)` is how you chain — step 1 calls `ctx.open('register:step2', { payload: { name } })` to advance, and **the bot can shut down between steps**. when the user replies an hour (or a day) later, step 2's handler picks up.

### typing persistent payloads

declaration-merge `FlowHandlers` for end-to-end types:

```ts
declare module '@puregram/flow' {
  interface FlowHandlers {
    'register:age': { kind: 'message', payload: { name: string }, result: number }
    'register:step2': { kind: 'message', payload: { name: string, age: number }, result: void }
  }
}
```

now `ctx.payload` inside `flow.handle('register:age', ...)` is typed as `{ name: string }`, and the open-call site `tg.flow.prompt(..., { id: 'register:age', payload: ... })` requires the payload to match.

## errors

| error | thrown when |
|---|---|
| `WaitForTimeout` | a `timeout` elapsed and `nullOnTimeout` is `false` |
| `WaitForCancelled` | `tg.flow.cancelAll()` was called, or a `waitForAny` loser |
| `WaiterAbortedError` | a waiter's `signal` (or `waitForAny`'s top-level `signal`) aborted before a match. `error.cause` carries the original `AbortController.abort(reason)` value |
| `FlowPersistenceUnconfigured` | called `flow.prompt({ id })` / `flow.waitFor({ id })` without `flow({ storage })` configured |
| `FlowHandlerMissing` | a persisted record resolves but no `flow.handle(id, ...)` was registered for that id |
| `FlowKindMismatch` | the `kind` at the call site differs from the kind registered on `flow.handle(...)` |

```ts
import { WaitForTimeout, WaiterAbortedError } from '@puregram/flow'

try {
  const reply = await message.flow.waitFor('message', { timeout: 5_000 })
} catch (error) {
  if (error instanceof WaitForTimeout) {
    console.log(`gave up after ${error.timeout}ms`)
  } else if (error instanceof WaiterAbortedError) {
    console.log('aborted via signal:', error.cause)
  }
}
```

## options

`flow(options?)`:

| option | type | description |
|---|---|---|
| `mediaGroupWindow` | `number` (ms) | sliding-window timeout for `collectMediaGroup`. default `1000` |
| `storage` | `KVStorage<PersistedFlow>` | required for any `flow.prompt({ id })` / `flow.waitFor({ id })` usage. omit for ephemeral-only |
| `defaultTtl` | `number` (ms) | applied if a persistent call site doesn't pass `ttl`. absent + no per-call ttl = no expiry |

## `tg.flow` interface reference

```ts
interface FlowExtension {
  waitFor: <K extends keyof UpdateKindMap, T = UpdateKindMap[K]> (
    kind: K,
    options?: WaitForOptions<K, T> & { id?: string, payload?, ttl?, chatId?, fromId? }
  ) => Promise<T | null>

  waitForCallbackQuery: (
    predicate?: (q: CallbackQueryUpdate) => boolean,
    options?: WaitForCallbackQueryOptions
  ) => Promise<CallbackQueryUpdate | null>

  waitForCommand: (
    name: string | RegExp,
    options?: WaitForCommandOptions
  ) => Promise<MessageUpdate | null>

  waitForAny: <S extends readonly WaiterSpec[]> (
    specs: S,
    options?: { signal?: AbortSignal }
  ) => Promise<{ index: number, value: /* matched spec result */ }>

  prompt: <K extends keyof UpdateKindMap = 'message', T = UpdateKindMap[K]> (
    chat: number | string,
    text: string,
    options?: PromptOptions<K, T> & { id?: string, payload?, ttl? }
  ) => Promise<T | null>

  collectMediaGroup: (
    message: MessageUpdate,
    options?: CollectMediaGroupOptions
  ) => Promise<MessageUpdate[]>

  handle: <K extends keyof UpdateKindMap = 'message', T = UpdateKindMap[K]> (
    id: string,
    config: FlowHandleConfig<K, T>
  ) => void

  cancelAll: () => void
}
```

## three full bots

### 1. linear sign-up (ephemeral)

```ts
import { Telegram } from 'puregram'
import { flow } from '@puregram/flow'

const tg = Telegram.fromToken(process.env.BOT_TOKEN!).extend(flow())

tg.command('signup', async (message) => {
  const name = await message.flow.prompt("what's your name?", { nullOnTimeout: true, timeout: 60_000 })
  if (name === null) return message.send('cancelled')

  const age = await message.flow.prompt('how old are you?', { nullOnTimeout: true, timeout: 60_000 })
  if (age === null) return message.send('cancelled')

  const email = await message.flow.prompt('your email?', { nullOnTimeout: true, timeout: 60_000 })
  if (email === null) return message.send('cancelled')

  await message.send(`signed up: ${name.text}, ${age.text}, ${email.text}`)
})

await tg.startPolling()
```

### 2. persistent registration (survives restart)

three steps chained via `ctx.open(...)`. handlers registered at module scope (run once at boot); state lives in storage. **kill the bot between steps and it picks up where it left off**:

```ts
import { Telegram } from 'puregram'
import { MemoryStorage } from '@puregram/storage'
import { flow } from '@puregram/flow'

const tg = Telegram.fromToken(process.env.BOT_TOKEN!)
  .extend(flow({
    storage: new MemoryStorage(),
    defaultTtl: 24 * 60 * 60 * 1000
  }))

tg.flow.handle('register:name', {
  onAnswer: async (msg, ctx) => {
    await ctx.open('register:age', { payload: { name: msg.text } })
  }
})

tg.flow.handle('register:age', {
  validate: (m) => Number.isFinite(Number.parseInt(m.text ?? '', 10)) ? true : 'send a number',
  transform: (m) => Number.parseInt(m.text ?? '0', 10),
  onAnswer: async (age, ctx) => {
    const { name } = ctx.payload as { name: string }
    await ctx.open('register:email', { payload: { name, age } })
  }
})

tg.flow.handle('register:email', {
  onAnswer: async (msg, ctx) => {
    const { name, age } = ctx.payload as { name: string, age: number }
    await ctx.send(ctx.chatId, `welcome, ${name} (${age}, ${msg.text})!`)
  },
  onTimeout: async (ctx) => {
    await ctx.send(ctx.chatId, 'sign-up expired — try /register again')
  }
})

tg.command('register', async (message) => {
  await tg.flow.prompt(message.chat.id, "what's your name?", {
    id: 'register:name',
    ttl: 60 * 60 * 1000
  })
})

await tg.startPolling()
```

`flow.prompt({ id })` only **opens** the prompt — it returns immediately after writing the storage record. the actual answer is delivered to the handler registered at `flow.handle(id, ...)`, which can run on a different process / hour / day.

### 3. inline-button confirmation (`waitFor` on callback queries)

```ts
import { Telegram } from 'puregram'
import { flow } from '@puregram/flow'

const tg = Telegram.fromToken(process.env.BOT_TOKEN!).extend(flow())

tg.command('poll', async (message) => {
  await message.send('rock, paper, or scissors?', {
    reply_markup: {
      inline_keyboard: [[
        { text: 'rock', callback_data: 'rps:rock' },
        { text: 'paper', callback_data: 'rps:paper' },
        { text: 'scissors', callback_data: 'rps:scissors' }
      ]]
    }
  })

  const tap = await message.flow.waitFor('callback_query', {
    filter: (q) => q.data?.startsWith('rps:') ?? false,
    timeout: 30_000,
    nullOnTimeout: true
  })

  if (tap === null) return message.send('no choice — game over')

  const choice = tap.data?.slice('rps:'.length)
  await tap.answer({ text: `you picked ${choice}` })
  await message.send(`you went with ${choice}`)
})

await tg.startPolling()
```

`message.flow.waitFor` auto-scopes to the same chat **and** sender, so a third user clicking buttons in a group chat doesn't hijack alice's poll. extra `filter: q.data?.startsWith('rps:')` rejects unrelated callback queries.

## exported surface

```ts
import { flow, spec, WaitForTimeout, WaitForCancelled, WaiterAbortedError } from '@puregram/flow'

import type {
  CollectMediaGroupOptions,
  FlowExtension,
  FlowHandleConfig,
  FlowHandleContext,
  FlowHandlers,
  FlowOptions,
  PersistedFlow,
  PersistentOpenOptions,
  PersistentPromptOptions,
  PersistentWaitForOptions,
  PromptOptions,
  ValidateResult,
  WaitForOptions,
  WaitForResult,
  WaitForCallbackQueryOptions,
  WaitForCommandOptions,
  WaitForAnyOptions,
  WaitForAnyResult,
  WaiterSpec,
  Filter
} from '@puregram/flow'
```

## see also

- main skill: `using-puregram` — covers `.extend(plugin)`, the Telegram client, dispatch model, middleware priority (flow installs at `'high'` to intercept updates before user handlers)
- sibling: `puregram-session` — stateful counterpart for state that *isn't* tied to a pending waiter
- sibling: `puregram-scenes` — rich multi-step wizards with branching, on-enter/on-leave
- sibling: `puregram-storage` — the `KVStorage<V>` contract that persistent flows are backed by
- package source: [`packages/flow/`](https://github.com/nitreojs/puregram/tree/v3/packages/flow)
