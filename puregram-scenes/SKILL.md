---
name: puregram-scenes
description: >
  use when working with `@puregram/scenes` in puregram v3 — multi-step wizards
  via `StepScene<S, U>` with `enterHandler` / `leaveHandler` / `beforeStep` /
  `afterStep`, `update.scene.enter` / `leave` / `reenter`, `update.scene.step`
  navigation (`firstTime`, `next`, `go`, `previous`, `reenter`), `tg.scenes`
  runtime registry, declaration-merging `SceneState` for typed state, opt-out
  active-scene dispatch with `passthrough` for global `/cancel` / `/help`
  escapes. hard-depends on `@puregram/session`.
metadata:
  author: starkow
  source: https://github.com/puregram/puregram/tree/v3/packages/scenes
  package: "@puregram/scenes@3"
---

# `@puregram/scenes`

middleware-based multi-step scene management for puregram v3 — signup wizards, multi-question forms, anything where the bot has to ask, the user has to answer, and the bot has to remember where it is in the conversation. one plugin install, a `StepScene` per flow, and you're done.

state is persisted between updates by `@puregram/session`, so a user staying mid-form across a bot restart works out of the box if your session backend is persistent.

## when to use this skill

- linear multi-step wizards (signup, onboarding, checkout)
- branching scenes — step 1 routes to step 3 or step 5 based on input
- forms that need per-step validation with re-prompt on failure (`scene.step.reenter()`)
- flows with global `/cancel` / `/help` escape hatches (`passthrough` option)
- scenes that should survive restarts — pair with a persistent session backend
- inspecting / force-entering / force-leaving another user's scene from an admin command or cron job
- registering scenes dynamically at runtime via `tg.scenes.add(...)`
- typing per-scene state with TS generics (`StepScene<{ name, age }, MessageUpdate>`)

if you need lightweight conversational primitives (one-off `waitFor` / `prompt`) without ordered steps and named flows, use `puregram-flow` instead — scenes is the right tool when you have a **named, persistent, multi-step** flow.

## quick start

```ts
import { Telegram } from 'puregram'
import { session } from '@puregram/session'
import { scenes, StepScene } from '@puregram/scenes'

const signup = new StepScene('signup', [
  (message) => {
    if (message.scene.step.firstTime || !message.hasText()) {
      return message.send("what's your name?")
    }
    message.scene.state.firstName = message.text
    return message.scene.step.next()
  },

  (message) => {
    if (message.scene.step.firstTime || !message.hasText()) {
      return message.send('how old are you?')
    }
    message.scene.state.age = Number.parseInt(message.text, 10)
    return message.scene.step.next()
  },

  async (message) => {
    const { firstName, age } = message.scene.state

    await message.send(`you are ${firstName}, ${age} years old!`)
    // last step — calling next() leaves the scene
    return message.scene.step.next()
  }
])

const tg = Telegram.fromToken(process.env.TOKEN!)
  .extend(session())
  .extend(scenes({ scenes: [signup] }))

tg.onMessage((message) => {
  if (message.text === '/signup') {
    return message.scene.enter('signup')
  }
})

await tg.startPolling()
```

**`@puregram/scenes` requires `@puregram/session`.** install both. they're peer-deps and the plugin's `dependsOn: ['session']` throws `PluginMissingDep` at start time if you forget.

## how it works

three pieces:

- **`StepScene`** — a named, ordered list of step handlers. each handler can read+write `scene.state`, advance with `scene.step.next()`, jump with `scene.step.go(id)`, or bail out with `scene.leave()`. the same handler is invoked for every update that lands while you're sitting on its step
- **`scenes({ scenes: [...] })`** — the plugin install. registers a high-priority `onUpdate` middleware that:
  - attaches `update.scene` (a `SceneContext`) to every update
  - if the user has an active scene, dispatches the update into the current step instead of letting it flow to your normal handlers
  - exposes `tg.scenes` for runtime registry mutation (`add` / `has` / `remove` / `all`)
- **session-backed state** — `update.session.__scene` is where `{ current, state, stepId, firstTime }` actually lives. you don't normally touch it directly; `update.scene.*` is the api. but it's there for [advanced patterns](#advanced-patterns) like inspecting another user's scene

**active-scene dispatch is opt-out**: any update from a user with an active scene goes to that scene by default. provide `passthrough` to whitelist updates that should escape (e.g. global `/help` and `/cancel`).

## typescript

`@puregram/scenes` already attaches `scene: SceneContext<SceneState>` to every update kind via codegen. with no extra type setup, `message.scene.state` is `SceneState` (an empty user-augmentable interface).

scope a step scene to a specific update kind with the second generic — handler args narrow accordingly:

```ts
import type { MessageUpdate } from '@puregram/api'
import { StepScene } from '@puregram/scenes'

new StepScene<{ firstName: string, age: number }, MessageUpdate>('signup', [
  (message) => {
    // message is MessageUpdate — message.text, message.send(...), message.hasText() all available
    // message.scene.state is { firstName, age }
  }
])
```

mixed update kinds across steps — pass a union as `U` and narrow inside each step with `update.is(...)`:

```ts
import type { CallbackQueryUpdate, MessageUpdate } from '@puregram/api'

new StepScene<MyState, MessageUpdate | CallbackQueryUpdate>('mixed', [
  (update) => {
    if (update.is('callback_query')) {
      // typed as CallbackQueryUpdate
      return update.answer({ text: 'pick a button below' })
    }
    // typed as MessageUpdate
    return update.send('please tap a button')
  }
])
```

global default `SceneState` shape — declaration-merge once:

```ts
declare module '@puregram/scenes' {
  interface SceneState {
    firstName: string
    age: number
  }
}
```

(same composition rules as `@puregram/session`'s `SessionData` — multiple plugins augmenting the same interface compose naturally.)

## `update.scene` — the api

attached to every update by the plugin. returns a `SceneContext`; inside a step body it's a `StepSceneContext` flavor with `update.scene.step` added.

### getters

| getter | type | meaning |
|---|---|---|
| `current` | `SceneInterface \| undefined` | the active scene resolved from `session.__scene.current`, or `undefined` |
| `state` | `SceneState` (or the generic `S`) | per-scene user state. lives at `session.__scene.state`. mutate freely — flushed when the handler chain returns |
| `cancelled` | `boolean` | `true` inside `leaveHandler` when leave was called with `{ cancelled: true }` |
| `lastAction` | `'None' \| 'Enter' \| 'Leave'` | what the last navigation was. introspectable for debugging and for `passthrough` predicates |

### `enter(slug, options?)`

```ts
await message.scene.enter('signup')
await message.scene.enter('signup', { state: { firstName: '' } })  // seed initial state
await message.scene.enter('signup', { silent: true })              // skip enterHandler
```

### `leave(options?)`

```ts
await message.scene.leave()
await message.scene.leave({ cancelled: true })  // surfaces as scene.cancelled in leaveHandler
await message.scene.leave({ silent: true })     // skip leaveHandler
```

### `reenter()`

re-runs the current scene's `enterHandler`. useful when input was invalid and you want to start over:

```ts
await message.scene.reenter()
```

### `reset()`

drops `session.__scene` synchronously. **no `leaveHandler` fires**. mostly internal — prefer `leave()`.

## `update.scene.step` — step-aware navigation (inside `StepScene` only)

| getter | type | meaning |
|---|---|---|
| `firstTime` | `boolean` | `true` on the first dispatch into this step (immediately after `enter` / `next` / `go`). use it to decide between sending the prompt vs consuming user input |
| `stepId` | `number` | current step index (0-based) |
| `current` | `StepSceneHandler \| undefined` | the handler bound to the current step. `undefined` when `stepId` is past the last step |

### canonical `firstTime` pattern

```ts
if (message.scene.step.firstTime || !message.hasText()) {
  return message.send("what's your name?")
}

message.scene.state.firstName = message.text
return message.scene.step.next()
```

first dispatch → prompt. subsequent dispatches with valid input → consume and advance. invalid input → re-prompt (the `|| !message.hasText()` guard).

### `go(stepId, options?)`

jump to a specific step by index. `{ silent: true }` skips re-running the handler — useful when you want to advance state but already replied this turn:

```ts
await message.scene.step.go(0)
await message.scene.step.go(2, { silent: true })
```

### `next(options?)` / `previous(options?)`

shorthand for `go(stepId ± 1)`:

```ts
await message.scene.step.next()
await message.scene.step.previous()
```

calling `next()` from the **last** step leaves the scene cleanly. calling `previous()` from step 0 also leaves (it doesn't underflow).

### `reenter()`

re-runs the **current step**. handy when validation failed:

```ts
const parsed = Number.parseInt(message.text ?? '', 10)

if (!Number.isInteger(parsed)) {
  await message.send('please send a number')
  return message.scene.step.reenter()
}

message.scene.state.age = parsed
return message.scene.step.next()
```

## branching scenes — the hub-and-spoke pattern

real wizards rarely walk a straight line. the common shape is a **hub** (a menu the user keeps returning to) with **spokes** (sub-screens you dive into and come back from), plus a confirmation screen you can bounce back from to fix a single field. `scene.step.go(id)` is what makes this work — steps are **destinations**, not a forward-only queue.

the trick for "edit one field, then return to where i was" is a return target stashed in `scene.state` before diving into a spoke:

```ts
enum Step { Menu = 0, Type = 1, Confirm = 2 }

// in the menu step — opening the type sub-screen:
update.scene.state.returnTo = Step.Menu
return update.scene.step.go(Step.Type)

// in the confirm step — the per-field "✏️ edit type" button:
update.scene.state.returnTo = Step.Confirm
return update.scene.step.go(Step.Type)

// the type step, once it captures a value, returns to wherever it was opened from:
update.scene.state.type = picked
return update.scene.step.go(update.scene.state.returnTo ?? Step.Menu)
```

one `returnTo` field, two behaviors: the same sub-screen returns to the menu when reached from the menu, and to the confirmation screen when reached from confirm.

other techniques the same flow leans on:

- **one morphing "control panel" message** — stash the menu's `message_id` in `scene.state` and `editMessageText` it on every screen change instead of spamming new messages. an in-place toggle (✅/▫️) just flips a boolean in state and redraws that one message
- **mixed update kinds in one scene** — `StepScene<State, MessageUpdate | CallbackQueryUpdate>`; narrow per step with `update.is('message')` / `update.is('callback_query')`, and `answer()` taps to clear the spinner
- **submit → another chat** — on the final step `update.api.sendMessage({ chat_id: ORDERS_CHAT, ... })`, then `scene.leave()`
- **group scenes need buttons or force-reply** — privacy-mode bots never receive plain group text, so free-text steps silently stall in groups; use callback buttons, send prompts with `ForceReply`, or run the bot as admin (see `using-puregram` → `reference/telegram-quirks.md`)

full worked example (contact request → preferences hub → type sub-menu → engraving free-text → gift-wrap toggle → per-field-editable confirmation → submit-to-chat): [`examples/recipes/order-wizard`](https://github.com/puregram/puregram/tree/v3/examples/recipes/order-wizard).

## `tg.scenes` — runtime registry

```ts
tg.scenes.add(scene)        // add a SceneInterface at runtime
tg.scenes.has('signup')     // boolean
tg.scenes.remove('signup')  // returns boolean (true if removed)
tg.scenes.all()             // every registered scene
```

useful when scenes are loaded lazily (per-feature flags, A/B tests, hot-reload during dev).

## options

`scenes(options?)`:

| option | type | description |
|---|---|---|
| `scenes` | `SceneInterface[]` | initial scene set. shortcut equivalent to calling `tg.scenes.add(...)` for each at install time |
| `getStorageKey` | `(update) => string \| undefined` | how to derive the per-update storage key. default: `from.id ?? senderChat.id ?? chat.id`. return `undefined` to skip scene attachment for that update |
| `passthrough` | `(update) => boolean` | when `true` for an update from a user with an active scene, the update flows through to subsequent middleware as if no scene were active. `update.scene` stays attached so handlers can still call `update.scene.leave()` |

### `passthrough` — global escape hatches

active-scene dispatch is opt-out, so **without `passthrough`, every update from a scene-active user goes to the scene body — including `/cancel` and `/help`**. your global `tg.command('cancel', ...)` will be silently swallowed by the active step. fix this by whitelisting the escape commands in `passthrough`:

```ts
scenes({
  scenes: [signup, password, settings],
  passthrough: (update) =>
    'text' in update && (update.text === '/cancel' || update.text === '/help')
})

// then handle the escapes:
tg.command('cancel', async (message) => {
  if (message.scene.current !== undefined) {
    await message.scene.leave({ cancelled: true })
  }
  return message.send('cancelled')
})

tg.command('help', message => message.send('help text...'))
```

note `update.scene` is still attached during passthrough — handlers can inspect `update.scene.current` to decide whether to call `leave({ cancelled: true })`.

## `StepScene` options — lifecycle hooks

besides the bare `[handler1, handler2, ...]` form, `StepScene` accepts an options object with `enterHandler` / `leaveHandler` / `beforeStep` / `afterStep`:

```ts
new StepScene<MyState, MessageUpdate>('wizard', {
  enterHandler: message => message.send('welcome to the wizard!'),
  leaveHandler: (message) => (
    message.scene.cancelled
      ? message.send('cancelled')
      : message.send('done!')
  ),
  beforeStep: async (message) => {
    if (message.text === '/cancel') {
      await message.scene.leave({ cancelled: true })
    }
  },
  steps: [
    message => message.send('step 1'),
    message => message.send('step 2')
  ]
})
```

| hook | when it runs |
|---|---|
| `enterHandler` | on `scene.enter(slug)`. skipped when `enter(..., { silent: true })` |
| `leaveHandler` | on `scene.leave()` or after the last step's `next()`. skipped when `leave({ silent: true })`. inspect `scene.cancelled` for graceful vs aborted |
| `beforeStep` | before each step body. calling `scene.leave()` or `step.next()` from inside short-circuits the body — natural place for in-scene `/cancel` handling |
| `afterStep` | after each step body, **only when the step didn't navigate or leave** |

## advanced patterns

### inspecting another user's scene state

scene state lives on the session, so `tg.session.get(String(userId))` gives you the raw payload, including `__scene`:

```ts
const raw = await tg.session.get(String(userId)) as Record<string, unknown> ?? {}
console.log(raw.__scene?.current, raw.__scene?.stepId)
```

useful for admin dashboards, debugging, "is alice still mid-signup?" checks.

### force-priming a user into a scene

write the `__scene` shape directly to a target user's session entry — they'll resume into that scene on their **next** message:

```ts
async function primeScene (userId: number, slug: string, initialState: object = {}) {
  const key = String(userId)
  const stored = (await tg.session.get(key)) as Record<string, unknown> ?? {}

  stored.__scene = {
    current: slug,
    state: initialState,
    stepId: 0,
    firstTime: true
  }

  await tg.session.set(key, stored)

  // optional: send the first prompt yourself — enterHandler can't run without an Update
  await tg.send(userId, "hey! quick form — what's your name?")
}
```

**caveat**: the scene's `enterHandler` won't fire from outside (no `Update` to bind a `SceneContext` to). once the user sends anything, the scenes plugin sees `__scene` populated and dispatches into step 0 normally.

### force-leaving another user's scene

```ts
async function dropScene (userId: number) {
  const key = String(userId)
  const stored = (await tg.session.get(key)) as Record<string, unknown> ?? {}

  delete stored.__scene
  await tg.session.set(key, stored)
}
```

no `leaveHandler` fires — same as `reset()` but cross-user.

## exported types

```ts
import type {
  AnyUpdate,                   // wrapped update union (bot-api + custom)
  LastAction,                  // 'None' | 'Enter' | 'Leave'
  SceneContextEnterOptions,    // options arg of update.scene.enter()
  SceneContextLeaveOptions,    // options arg of update.scene.leave()
  SceneContextOptions,         // construction shape of SceneContext
  SceneHandlerPayload,         // payload a scene handler receives
  SceneInterface,              // contract of any registered scene
  SceneOptions,                // options accepted by scenes(...)
  ScenePayload,                // structural shape of `update` inside scene context
  SceneSessionState,           // shape persisted at session.__scene
  SceneState,                  // user-augmentable per-scene state
  ScenesExtension,             // shape of tg.scenes
  StepContext,                 // payload a StepScene step receives
  StepContextGoOptions,        // options arg of step.go() / next() / previous()
  StepContextOptions,          // construction shape of StepSceneContext
  StepSceneHandler,            // (payload: StepContext) => unknown
  StepSceneOptions             // options object accepted by `new StepScene(slug, opts)`
} from '@puregram/scenes'
```

## see also

- main skill: `using-puregram` — covers `.extend(plugin)`, dispatch middleware, the active-scene dispatch model
- sibling: `puregram-session` — required dependency; scenes state lives on the session
- sibling: `puregram-flow` — for one-off `prompt`/`waitFor` without ordered steps
- sibling: `puregram-storage` — backing store contract; pair with a persistent backend if you want scenes to survive restarts
- worked example: [`examples/recipes/order-wizard`](https://github.com/puregram/puregram/tree/v3/examples/recipes/order-wizard) — branching hub-and-spoke wizard (sub-menus, in-place toggle, per-field edit, submit-to-chat)
- package source: [`packages/scenes/`](https://github.com/puregram/puregram/tree/v3/packages/scenes)
