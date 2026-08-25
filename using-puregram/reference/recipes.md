# puregram cookbook

canonical bot recipes — short, runnable, idiomatic puregram v3. each recipe is self-contained and assumes `node 22+`, `"type": "module"`, and a `TOKEN` env var.

referenced from the main [`using-puregram`](../SKILL.md) skill.

## 1. echo bot

the smallest viable bot. replies to every message with `echo: <text>`:

```ts
import { Telegram } from 'puregram'

const tg = Telegram.fromToken(process.env.TOKEN!)

tg.onMessage((message) => {
  if (!message.hasText()) return
  return message.send(`echo: ${message.text}`)
})

await tg.startPolling()
```

## 2. command router with `/start`, `/help`, `/cancel`

`tg.command(name, handler)` is the built-in slash-command filter — matches `/name`, `/name@bot`, `/name <args>`:

```ts
import { Telegram } from 'puregram'

const tg = Telegram.fromToken(process.env.TOKEN!)

tg.command('start', message => message.send('hi! send /help for what i can do'))
tg.command('help', message => message.send('available: /start, /help, /cancel'))
tg.command('cancel', message => message.send('nothing to cancel'))

// fallback for anything else
tg.onMessage((message) => {
  if (message.hasText() && !message.text!.startsWith('/')) {
    return message.send('try /help')
  }
})

await tg.startPolling()
```

## 3. photo with spoiler caption + typed callback-data button

idiomatic v3 — per-update `sendPhoto(photo, params?)` positional shortcut, `@puregram/markup` for the caption entity, `@puregram/callback-data` for the button payload, `.filter` for dispatch:

```ts
import { InlineKeyboard, MediaSource, Telegram } from 'puregram'
import { markup, spoiler } from '@puregram/markup'
import { defineCallbackData } from '@puregram/callback-data'

const Press = defineCallbackData('press').string('source')

const tg = Telegram.fromToken(process.env.TOKEN!).extend(markup())

tg.onMessage(async (message) => {
  await message.sendPhoto(MediaSource.path('./cat.jpg'), {
    caption: spoiler('caption is a spoiler'),
    reply_markup: InlineKeyboard.keyboard([[Press.button({ text: 'press me', source: 'cat-card' })]])
  })
})

tg.onCallbackQuery(Press.filter, (q) => {
  // q.payload: { source: string } — typed, validated
  return q.answer({ text: `thanks (from ${q.payload.source})!` })
})

await tg.startPolling()
```

## 4. prompt + validate loop with `@puregram/flow`

ask a question, validate the answer, re-prompt on bad input. `validate` returning a string is the re-prompt feedback message:

```ts
import { Telegram } from 'puregram'
import { flow } from '@puregram/flow'

const tg = Telegram.fromToken(process.env.TOKEN!)
  .extend(flow())

tg.command('age', async (message) => {
  const reply = await message.flow.prompt('how old are you?', {
    timeout: 60_000,
    nullOnTimeout: true,
    validate: (m) => {
      const n = Number.parseInt(m.text ?? '', 10)
      if (!Number.isFinite(n)) return 'please send a number'
      if (n < 0 || n > 150) return 'be serious'
      return true
    },
    transform: (m) => Number.parseInt(m.text!, 10)
  })

  if (reply === null) return message.send('took too long')
  await message.send(`you are ${reply} years old`)
})

await tg.startPolling()
```

`validate` runs after the predicate matches. returning `false` silently re-waits, returning a string sends that string and re-waits. `transform` shapes the resolved value.

## 5. multi-step signup wizard with `@puregram/scenes`

three-step ephemeral signup. `firstTime` decides between sending the prompt and consuming the answer; `scene.step.next()` advances; calling `next()` from the last step leaves the scene:

```ts
import { Telegram } from 'puregram'
import { session } from '@puregram/session'
import { scenes, StepScene } from '@puregram/scenes'

const signup = new StepScene('signup', [
  (message) => {
    if (message.scene.step.firstTime || !message.hasText()) {
      return message.send("what's your name?")
    }
    message.scene.state.name = message.text
    return message.scene.step.next()
  },
  (message) => {
    if (message.scene.step.firstTime || !message.hasText()) {
      return message.send('how old are you?')
    }
    const n = Number.parseInt(message.text!, 10)
    if (!Number.isFinite(n)) {
      message.send('please send a number')
      return message.scene.step.reenter()
    }
    message.scene.state.age = n
    return message.scene.step.next()
  },
  async (message) => {
    const { name, age } = message.scene.state
    await message.send(`signed up: ${name}, ${age}`)
    return message.scene.step.next() // last step → leaves the scene
  }
])

const tg = Telegram.fromToken(process.env.TOKEN!)
  .extend(session())
  .extend(scenes({
    scenes: [signup],
    passthrough: (u) => 'text' in u && u.text === '/cancel'
  }))

tg.command('signup', message => message.scene.enter('signup'))
tg.command('cancel', (message) => {
  if (message.scene.current !== undefined) {
    return message.scene.leave({ cancelled: true })
  }
  return message.send('nothing to cancel')
})

await tg.startPolling()
```

for a non-linear flow — a hub menu with sub-screens, an in-place toggle, and a per-field-editable confirmation — see the branching [`order-wizard`](https://github.com/puregram/puregram/tree/v3/examples/recipes/order-wizard) recipe and the hub-and-spoke section in the `puregram-scenes` skill.

## 6. persistent flow that survives a bot restart

three steps chained via `ctx.open(...)`. handlers registered at module scope, state in storage. **kill the bot between steps and it picks up where it left off**:

```ts
import { Telegram } from 'puregram'
import { MemoryStorage } from '@puregram/storage'  // swap for redis/sqlite in prod
import { flow } from '@puregram/flow'

const tg = Telegram.fromToken(process.env.TOKEN!)
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
  transform: (m) => Number.parseInt(m.text!, 10),
  onAnswer: async (age, ctx) => {
    const { name } = ctx.payload as { name: string }
    await ctx.send(ctx.chatId, `welcome, ${name} (${age})!`)
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

## 7. inline-query bot

answer inline queries with article results that send a chosen message body when picked:

```ts
import { Telegram, InlineQueryResult, InputMessageContent } from 'puregram'

const tg = Telegram.fromToken(process.env.TOKEN!)

tg.onInlineQuery(async (query) => {
  const q = query.query.toLowerCase()

  await query.answer({
    cache_time: 0,
    results: [
      InlineQueryResult.article({
        id: '1',
        title: `say "${q}"`,
        description: `bot will send the literal "${q}"`,
        content: InputMessageContent.text(q || '(empty)')
      })
    ]
  })
})

await tg.startPolling({ allowedUpdates: ['inline_query', 'chosen_inline_result'] })
```

`InlineQueryResult.article` is one of the camelCase exceptions — `input_message_content` → `content`, `reply_markup` → `replyMarkup`, `thumbnail_*` → `thumbnail: { url, width?, height?, mimeType? }`.

this answers every keystroke with final content. when results are expensive to produce, defer the work instead — see recipe 16.

## 8. broadcast to many users with rate-limit handling

opt into `retryOnFloodWait` so 429s auto-sleep + retry. catch leftover `ApiError` codes (user blocked the bot, etc.) and skip:

```ts
import { Telegram, ApiError } from 'puregram'

const tg = new Telegram({
  token: process.env.TOKEN!,
  retryOnFloodWait: { max: 3, maxWaitMs: 10_000 }
})

async function broadcast (userIds: number[], text: string) {
  const failed: { id: number, reason: string }[] = []

  for (const id of userIds) {
    try {
      await tg.send(id, text)
    } catch (err) {
      if (err instanceof ApiError) {
        failed.push({ id, reason: `${err.code} ${err.description}` })
      } else {
        throw err
      }
    }
  }

  return { sent: userIds.length - failed.length, failed }
}

// example
const ids = [/* ... user ids ... */]
const result = await broadcast(ids, 'announcement: we ship tomorrow')
console.log(result)
```

for stricter per-recipient pacing, also add `@puregram/rate-limit` and gate the broadcast loop on `tg.rateLimit.check(...)`.

## 9. collect a full album with `collectMediaGroup`

when a user sends an album, telegram delivers each item as a separate `MessageUpdate` with the same `media_group_id`. `collectMediaGroup` buffers them all:

```ts
import { Telegram } from 'puregram'
import { flow } from '@puregram/flow'

const tg = Telegram.fromToken(process.env.TOKEN!)
  .extend(flow({ mediaGroupWindow: 1500 }))

tg.onMessage(async (message) => {
  if (!message.hasMediaGroupId()) {
    return  // not part of an album
  }

  const all = await message.flow.collectMediaGroup()
  await message.send(`got ${all.length} items in this album`)
})

await tg.startPolling()
```

the window is sliding — every new item resets the timer. tune `mediaGroupWindow` higher if telegram is slow delivering items, lower for snappier resolution.

## 10. webhook deployment with express

production-grade webhook via the express adapter at `puregram/webhook`:

```ts
import express from 'express'
import { Telegram } from 'puregram'
import { expressAdapter } from 'puregram/webhook'

const tg = Telegram.fromToken(process.env.TOKEN!)

tg.onMessage(message => message.send('got it via webhook'))

const app = express()
app.use(express.json())  // required — express adapter expects pre-parsed json
app.post('/webhook', expressAdapter(tg.webhookHandler({ secretToken: 'my-secret' })))

app.listen(8080, async () => {
  await tg.setWebhook({
    url: 'https://example.com/webhook',
    secretToken: 'my-secret',
    allowedUpdates: ['message', 'callback_query']
  })
})

process.on('SIGTERM', async () => {
  await tg.shutdown()
  process.exit(0)
})
```

other adapters at `puregram/webhook`: `fastifyAdapter`, `koaAdapter`, `honoAdapter`, `h3Adapter`, `elysiaAdapter`, `webAdapter` (for fetch-style runtimes), `nodeAdapter` (raw `node:http`).

## 11. typed session counter

declaration-merge `SessionData` to type `update.session` end-to-end:

```ts
import { Telegram } from 'puregram'
import { session } from '@puregram/session'

declare module '@puregram/session' {
  interface SessionData {
    counter: number
    lastSeen?: number
  }
}

const tg = Telegram.fromToken(process.env.TOKEN!)
  .extend(session({ initial: () => ({ counter: 0 }) }))

tg.onMessage(async (message) => {
  message.session.counter++              // typed as number
  message.session.lastSeen = Date.now()  // typed as number | undefined
  await message.send(`you've sent ${message.session.counter} messages`)
})

await tg.startPolling()
```

for production, swap `session()` for `session({ storage: new RedisStorage(redis) })` or any other `KVStorage` adapter.

## 12. callback-data pagination

`.repack(data, partial)` unpacks → merges → re-packs in one shot — perfect for "next" / "prev" buttons that bump one field:

```ts
import { Telegram, InlineKeyboard } from 'puregram'
import { defineCallbackData } from '@puregram/callback-data'

const Page = defineCallbackData('page').number('n')

const tg = Telegram.fromToken(process.env.TOKEN!)

function pageKeyboard (n: number, total: number) {
  const buttons = []
  if (n > 0) buttons.push(Page.button({ text: '« prev', n: n - 1 }))
  if (n < total - 1) buttons.push(Page.button({ text: 'next »', n: n + 1 }))
  return InlineKeyboard.keyboard([buttons])
}

tg.command('list', message =>
  message.send('page 1/5', { reply_markup: pageKeyboard(0, 5) })
)

tg.onCallbackQuery(Page.filter, async (q) => {
  const { n } = q.payload
  // bump via repack on a "next" button's existing data
  const total = 5

  await q.message?.editText(`page ${n + 1}/${total}`, {
    reply_markup: pageKeyboard(n, total)
  })
  await q.answer()
})

await tg.startPolling()
```

## 13. error recovery — `suppress` + `tg.catch`

`suppress: true` returns `ApiResponseError` instead of throwing for a single call; `tg.catch(fn)` is the global net for thrown handlers:

```ts
import { Telegram } from 'puregram'

const tg = new Telegram({
  token: process.env.TOKEN!,
  retryOnFloodWait: true,
  swallowDispatchErrors: true  // route everything through tg.catch
})

tg.catch((err, ctx) => {
  console.error('handler threw on update', ctx.raw.update_id, err)
})

tg.onMessage(async (message) => {
  // non-throwing send — silently skips users who blocked the bot
  const r = await tg.api.sendMessage({
    chat_id: message.chat.id,
    text: 'hello',
    suppress: true
  })

  if (Telegram.isErrorResponse(r)) {
    if (r.error_code === 403) {
      // user blocked the bot — quietly skip
      return
    }
    console.warn('unexpected non-403 error', r)
    return
  }

  console.log('sent', r.message_id)
})

await tg.startPolling()
```

`suppress: true` and `swallowDispatchErrors` cover different paths — `suppress` for individual api calls you don't want to throw, `swallowDispatchErrors` + `tg.catch` for the dispatch loop.

## 14. auto-inject `parse_mode: 'HTML'` via a request hook

**only when you're not using `@puregram/markup`.** the two don't mix: telegram discards the `entities` array whenever `parse_mode` is set, so a hook like this silently unformats every markup send. without the plugin, though, it stops you writing `parse_mode: 'HTML'` on every call:

```ts
import { Telegram, type RequestContext } from 'puregram'

const tg = Telegram.fromToken(process.env.TOKEN!)

tg.useHook('onBeforeRequest', (context: RequestContext, next) => {
  if (
    context.method.startsWith('send') &&
    context.params !== undefined &&
    ('text' in context.params || 'caption' in context.params)
  ) {
    context.params.parse_mode ??= 'HTML'
  }
  return next()
})

tg.onMessage(message => message.send('<b>auto-bold</b> by default'))

await tg.startPolling()
```

works for every `send*` family method that takes `text` or `caption`. `??=` only sets the default — explicit `parse_mode: 'MarkdownV2'` at the call site still wins.

## 15. custom plugin — adding a typed namespace to `tg`

`createPlugin` returns a typed plugin spec; the install function's return value gets keyed under `plugin.name`:

```ts
import { Telegram, createPlugin } from 'puregram'

const greeter = createPlugin({
  name: 'greeter',
  install: tg => ({
    hello: (chatId: number) => tg.send(chatId, 'hi!'),
    goodbye: (chatId: number) => tg.send(chatId, 'bye!')
  })
})

const tg = Telegram.fromToken(process.env.TOKEN!)
  .extend(greeter)

await tg.greeter.hello(100)   // typed
await tg.greeter.goodbye(100) // typed

await tg.startPolling()
```

for plugins that need other plugins, set `dependsOn: ['session']` and the installer resolves install order topologically (throws `PluginCycle` on a cycle, `PluginMissingDep` if a dep isn't installed).

for plugins that need lifecycle hooks (background tasks, periodic flushes), use `tg.useHook('onInit', ...)` and `tg.useHook('onShutdown', ...)` from inside `install`.

## 16. inline bot that defers heavy work to `chosen_inline_result`

don't render the expensive thing per keystroke — answer with a cheap placeholder and inject the real content only for the result actually sent. three telegram-side preconditions (details in [`telegram-quirks.md`](telegram-quirks.md)): inline feedback enabled at **100%** via @botfather's `/setinlinefeedback`, an inline keyboard on every result (no keyboard → no `inline_message_id` → uneditable forever), and a callback-button fallback because feedback is lossy even at 100%:

```ts
import { Telegram, InlineQueryResult, InputMessageContent, InlineKeyboard } from 'puregram'

const tg = Telegram.fromToken(process.env.TOKEN!)

const keyboard = InlineKeyboard.keyboard([
  InlineKeyboard.textButton({ text: 'refresh', payload: 'refresh' })
])

tg.onInlineQuery((query) => query.answer({
  cache_time: 0,
  results: [
    InlineQueryResult.article({
      id: query.query || 'empty',
      title: `render "${query.query}"`,
      content: InputMessageContent.text('rendering…'),
      replyMarkup: keyboard
    })
  ]
}))

async function inject (inlineMessageId: string, query: string) {
  await tg.api.editMessageText({
    inline_message_id: inlineMessageId,
    text: await renderExpensiveThing(query),
    reply_markup: keyboard // edits drop the keyboard unless re-passed
  })
}

tg.onChosenInlineResult(async (chosen) => {
  if (!chosen.hasInlineMessageId()) return

  await inject(chosen.inlineMessageId, chosen.query)
})

tg.onCallbackQuery(async (query) => {
  if (!query.hasInlineMessageId()) return

  await query.answer()
  await inject(query.inlineMessageId, 'refresh')
})

await tg.startPolling({ allowedUpdates: ['inline_query', 'chosen_inline_result', 'callback_query'] })
```

the same edit path is how bots without fragment usernames get custom emoji into inline messages: entities are ignored in the initial result but honored when the message is edited (bot owner needs premium — see the quirks sheet).

## see also

- main skill: [`using-puregram`](../SKILL.md)
- sibling skills: `puregram-flow`, `puregram-scenes`, `puregram-session`, `puregram-storage`, `puregram-callback-data`, `puregram-testing`
- examples directory: [`github.com/puregram/puregram/tree/v3/examples`](https://github.com/puregram/puregram/tree/v3/examples)
- bot api reference: [`core.telegram.org/bots/api`](https://core.telegram.org/bots/api)
