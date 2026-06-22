---
name: using-puregram
description: >
  use when writing or modifying telegram bot code with puregram v3 — `puregram` /
  `@puregram/*` imports, `Telegram.fromToken`, `tg.api.X` / `tg.send` /
  `update.send`, `.extend(plugin)`, request hooks, dispatch middleware,
  `MediaSource`, keyboards, parse-mode, filters, `ApiError` / `suppress: true`,
  polling or webhook (express / fastify / koa / hono / h3 / elysia / web / raw
  http). esm-only, node 22+, bot api 10.1. not for puregram v2.
allowed-tools: >
  Bash(node *skills/using-puregram/tools/get-method.mjs*),
  Bash(node *skills/using-puregram/tools/get-object.mjs*),
  Bash(node *skills/using-puregram/tools/get-update.mjs*),
  Bash(node *skills/using-puregram/tools/get-shortcut.mjs*),
  Bash(node *skills/using-puregram/tools/get-filter.mjs*),
  Bash(node *skills/using-puregram/tools/get-factory.mjs*),
  Bash(node *skills/using-puregram/tools/grep-source.mjs*),
  Bash(node *skills/using-puregram/tools/check-version.mjs*)
metadata:
  author: starkow
  source: https://github.com/puregram/puregram
  bot_api: "10.1"
  package: "puregram@3"
---

# puregram

puregram is a thin, type-safe wrapper around the [telegram bot api](https://core.telegram.org/bots/api). it's **not** a framework — no built-in command router, no scene manager, no fsm in core. those live in opt-in satellite packages (`@puregram/scenes`, `@puregram/flow`, etc.) installed via `tg.extend(plugin)`.

## when to use this skill

- authoring or modifying any telegram bot built on `puregram@3` or `@puregram/*`
- calling bot api methods (`tg.api.sendMessage`, `tg.send`, `update.send`, `update.reply`, `update.thread`)
- handling updates (`tg.onMessage`, `tg.onCallbackQuery`, `tg.on('inline_query')`, ...)
- sending media (`MediaSource.path` / `.url` / `.fileId` / `.buffer` / `.stream`)
- building keyboards (`Keyboard`, `InlineKeyboard`, `KeyboardBuilder`, `InlineKeyboardBuilder`)
- formatting messages (`HTML.bold`, `MarkdownV2.escape`, the `@puregram/markup` tagged template)
- writing or installing plugins via `tg.extend(plugin)` with `dependsOn` / `tg.has`
- typed `callback_data` payloads with `@puregram/callback-data` (`defineCallbackData`, `.button`, `.filter`, `.with`)
- wiring hooks (`onBeforeRequest`, `onRequestIntercept`, `onResponseIntercept`, `onAfterRequest`, `onError`, plus `onInit`, `onUpdate`, `onShutdown`)
- emitting custom updates with `tg.defineUpdate` + `tg.emit`
- catching `ApiError` or using `suppress: true` for typed conditional returns
- configuring polling, webhooks (express / fastify / koa / hono / h3 / elysia / web fetch / raw http)
- composing filters (`filters.and`, `filters.or`, `filters.not`, `defineFilter`)
- migrating between bot api versions when puregram bumps its schema

for deeper topics see the companion sibling skills:

- `puregram-flow` — `@puregram/flow` (`waitFor`, prompts, conditional waits, `collectMediaGroup`, persistent flows)
- `puregram-scenes` — `@puregram/scenes` (linear and branching wizards)
- `puregram-session` — `@puregram/session` (proxy-backed per-user store, ttl, declaration-merged `SessionData`)
- `puregram-storage` — `@puregram/storage` (the `KVStorage<V>` / `TtlStorage<V>` contract that session/scenes/media-cacher/rate-limit all build on, plus `enhanceStorage` versioned migrations)
- `puregram-callback-data` — `@puregram/callback-data` (`defineCallbackData`, typed callback payloads, `.button`, `.filter`, `.with`)
- `puregram-testing` — `@puregram/test` (actor-driven test framework for puregram bots)
- `puregram-markup` — `@puregram/markup` (tagged-template entity-aware formatting; composes message entities, no `parse_mode` header needed)
- `puregram-rich` — `@puregram/rich` (safe emitter for rich-message html/markdown; templates, block-array, builders, sendRich/editRich shortcuts)
- `puregram-media-cacher` — `@puregram/media-cacher` (transparent `file_id` caching plugin, drop-in via `onBeforeRequest`)
- `puregram-rate-limit` — `@puregram/rate-limit` (inbound per-user fixed-window rate limiting; distinct from outbound `@puregram/throttler`)
- `puregram-file-id` — `@puregram/file-id` (parse / inspect / serialize telegram `file_id` and `file_unique_id` strings)
- `puregram-utils` — `@puregram/utils` (slot-machine value decoder + telegram web app init-data verification + deep-link helpers)
- `puregram-inline-message-id` — `@puregram/inline-message-id` (TL parser for telegram's `inline_message_id` blob; zero puregram deps)
- `puregram-stream` — `@puregram/stream` (stream LLM output to telegram via animated message drafts)
- `puregram-throttler` — `@puregram/throttler` (outbound rate-limit middleware that keeps your bot under telegram's ~30 rps / per-chat / per-group soft limits; distinct from inbound `puregram-rate-limit`)

## tools

run these from any directory under a project that has puregram installed. they resolve `node_modules/@puregram/api` and `node_modules/puregram` on disk:

```sh
node skills/using-puregram/tools/get-method.mjs <method>     # bot-api method → params/return/version
node skills/using-puregram/tools/get-object.mjs <name>       # bot-api object/structure → fields
node skills/using-puregram/tools/get-update.mjs <kind|Class> # wrapped update class → helpers/shortcuts
node skills/using-puregram/tools/get-shortcut.mjs <name>     # tg.send-family curated shortcut signatures
node skills/using-puregram/tools/get-filter.mjs <name>       # dispatch filter → narrowing/usage (hasX, kind.X, command, ...)
node skills/using-puregram/tools/get-factory.mjs <Name>      # factory class → static builder methods (MediaSource, InlineKeyboard, ...)
node skills/using-puregram/tools/grep-source.mjs <pattern>   # scoped grep across installed puregram packages
node skills/using-puregram/tools/check-version.mjs           # installed versions + bot-api drift vs this skill's pin
```

each tool supports `--help` and most support `--list`. for full reference depth, also read `node_modules/puregram/README.md` (~46 KB, ships with the package) — it has exhaustive option tables, factory menus, and live examples for every concept covered below.

example folders aren't shipped on npm — fetch them from [`github.com/puregram/puregram/tree/v3/examples`](https://github.com/puregram/puregram/tree/v3/examples).

## quick start

```ts
import { Telegram } from 'puregram'

const tg = Telegram.fromToken(process.env.TOKEN!)

tg.onMessage(message => message.send('hey!'))

await tg.startPolling()
```

that's the smallest viable bot. everything else builds on this shape.

## architecture at a glance

| layer | what it is | when to reach for it |
|---|---|---|
| `tg.api.X(params)` | auto-generated 1:1 mapping of every bot api method | when you want raw bot-api params, including unusual fields, or fields not yet covered by curated shortcuts |
| `tg.send(args)` | curated higher-level shortcut on the client | when you want positional args (`chat` first, `text` second) and a friendlier signature |
| `update.send(args)` / `update.reply(args)` | per-update-kind shortcuts | when you already have an update and want to skip the `chat_id` plumbing |
| `tg.extend(plugin)` | install an extension that adds typed members to `tg` | when you want sessions, scenes, flow, rate-limit, etc. |
| hooks (`onBeforeRequest`, ...) | request-lifecycle interceptors | when you want to mutate requests, log, retry, transform responses |
| middlewares (`tg.use(...)`) | update-dispatch interceptors with priority | when you want timing, logging, auth, rate-limit short-circuits across every handler |
| dispatchers (`tg.onMessage`, `tg.on(kind, handler)`) | update routing | when you want to handle incoming updates |

## the three-layer api

puregram exposes four ways to talk to telegram, in increasing order of ergonomics:

```ts
// 1. raw bot-api, every method, schema-typed params (all-object form)
await tg.api.sendMessage({ chat_id: 100, text: 'hi' })
await tg.api.sendPhoto({ chat_id: 100, photo: MediaSource.path('./cat.jpg'), caption: 'hi' })

// 2. curated shortcut on the client, positional args (chat first, then the "subject")
await tg.send(100, 'hi')
await tg.sendPhoto(100, MediaSource.path('./cat.jpg'), { caption: 'hi' })

// 3. per-kind shortcut, chat_id auto-filled from update.chat.id
tg.onMessage(message => message.send('hi'))
tg.onMessage(message => message.sendPhoto(MediaSource.path('./cat.jpg'), { caption: 'hi' }))

// 4. escape hatch for methods we haven't generated yet (e.g. corefork-only beta)
await tg.api.call('someBetaMethod', { foo: 'bar' })
```

pick whichever reads best at the call site — they're equivalent in capability.

**signature shapes by layer** (this is the part v2 users always get wrong on the way over):

| layer | shape | example |
|---|---|---|
| `tg.api.X(...)` | **all-object** — every field as a key on one params object, including `chat_id` | `tg.api.sendPhoto({ chat_id, photo, caption })` |
| `tg.X(...)` | **positional + optional params object** — chat first, then the method's "subject" (text / photo / sticker / ...), rest as `params?` | `tg.sendPhoto(chat, photo, { caption })` |
| `update.X(...)` | **positional + optional params object** — chat is auto-filled, so the subject comes first | `update.sendPhoto(photo, { caption })` |

so per-update media calls keep the v2-style ergonomics — `context.sendPhoto(photo, opts?)` → `update.sendPhoto(photo, opts?)` is a near-1:1 port at the call site.

every wrapped accessor keeps `.raw` available — when you want the bare bot-api payload, just reach in:

```ts
tg.onMessage((message) => {
  const text = message.text          // wrapped accessor
  const rawDate = message.raw.date   // raw payload, always available
})
```

### iterating paginated endpoints

six paged bot-api methods have `iter*` helpers that auto-page — `for await` yields items one by one, `.collect()` drains the rest into an array carrying `.total`:

```ts
for await (const tx of tg.iterStarTransactions()) { console.log(tx.amount) }

const photos = await tg.iterUserProfilePhotos(userId).collect()   // photos.length, photos.total
```

`iterUserProfilePhotos`, `iterUserProfileAudios`, `iterStarTransactions`, `iterUserGifts`, `iterChatGifts`, `iterBusinessAccountGifts` — each takes its `get*` options minus the offset (the iterator manages it), plus `{ limit }` to size pages.

### default request params

set `defaultParams` once on the client to stop repeating params (most commonly `parse_mode`) at every call site. it merges into every outgoing call across all three layers. precedence is **call-site > per-method > `'*'`**; object-valued params replace wholesale (never deep-merged):

```ts
const tg = Telegram.fromToken(process.env.TOKEN!, {
  defaultParams: {
    // applied wherever the param is valid
    '*': { parse_mode: 'HTML' },
    // per-method, typed to that method's params, overrides '*'
    sendMessage: { link_preview_options: { is_disabled: true } }
  }
})

// parse_mode: 'HTML' added for you
await tg.send(chatId, '<b>bold</b>')

// the call site always wins
await tg.api.sendMessage({ chat_id: chatId, text: '*x*', parse_mode: 'MarkdownV2' })
```

a `'*'` default only lands on methods that actually accept the param (it never adds `parse_mode` to `sendDice`), because core gates it against the schema's per-method param sets. constructor-only — there is no runtime setter.

### suppressing api errors

by default, api errors throw an `ApiError`:

```ts
import { ApiError } from 'puregram'

try {
  await tg.api.sendMessage({ chat_id: 1, text: 'hi' })
} catch (error) {
  if (error instanceof ApiError) {
    console.error(error.code, error.message)
  }
}
```

pass `suppress: true` and the return type becomes `T | ApiResponseError` — a typed conditional return. `Telegram.isErrorResponse(value)` narrows it:

```ts
const result = await tg.api.sendMessage({ chat_id: 1, text: 'hi', suppress: true })

if (Telegram.isErrorResponse(result)) {
  console.error(result.description)
} else {
  console.log(result.message_id) // typed as TelegramMessage
}
```

**important**: `tg.api.call('method', params)` always throws — no `suppress` on the string escape hatch.

## media (`MediaSource`)

every method that accepts an upload (photo, video, document, sticker, ...) takes a `MediaSource`. it's a tagged union so the multipart pipeline knows where the bytes live:

```ts
import { MediaSource } from 'puregram'

await tg.api.sendPhoto({ chat_id: 1, photo: MediaSource.path('./cat.png') })
await tg.api.sendDocument({ chat_id: 1, document: MediaSource.url('https://...') })
await tg.api.sendVideo({ chat_id: 1, video: MediaSource.fileId('AgACAgI...') })
```

the full menu (see `README.md` for the table — every factory is one method on `MediaSource`):

- `path(p)` — local file path
- `url(url, { forceUpload? })` — remote url; telegram fetches it (or you do, with `forceUpload`)
- `fileId(id)` — reuse a `file_id` you already have
- `buffer(buf)`, `stream(readable)`, `file(undiciFile)`, `arrayBuffer(ab)`, `bytes(view)`, `base64(b64)`, `text(s)`, `json(value, { space? })`
- `local(p)` — path the **local bot api server** reads off disk, no upload; requires `useLocal: true` (see [local bot api server](#local-bot-api-server))

### multi-item uploads

for `sendMediaGroup`, `editMessageMedia`, `answerInlineQuery`, build typed item arrays with the schema-derived factories:

```ts
import { InputMedia, MediaSource } from 'puregram'

await tg.api.sendMediaGroup({
  chat_id: 1,
  media: [
    InputMedia.photo(MediaSource.path('./a.jpg'), { caption: 'first' }),
    InputMedia.photo(MediaSource.path('./b.jpg'))
  ]
})
```

variants: `InputMedia.{photo,video,document,animation,audio,sticker,videoNote,voice}`. each takes a `MediaSource` (or raw `attach://name` reference) as the first arg.

`MediaGroup.{photos,videos,documents,audios}(items, opts?)` builds **whole arrays** in one call, with `caption` attached to one item (first by default, set `captionIndex` to pin elsewhere):

```ts
import { MediaGroup, MediaSource } from 'puregram'

await tg.api.sendMediaGroup({
  chat_id: 100,
  media: MediaGroup.photos([
    MediaSource.path('./a.jpg'),
    MediaSource.path('./b.jpg'),
    MediaSource.path('./c.jpg')
  ], { caption: 'three photos' })
})
```

document and audio groups must be uniform; photos and videos can mix freely.

inline-query and inline-message factories: `InlineQueryResult.{article,photo,video,audio,voice,document,gif,mpeg4Gif,location,venue,contact,game}` plus `InlineQueryResult.cached.X`, and `InputMessageContent.{text,location,venue,contact,invoice}` plus `InputMessageContent.rich` — the rich variant is **callable**: `InputMessageContent.rich(richObject)` accepts a `Rich` / `RichLike` from `@puregram/rich` and auto-unwraps it to `{ rich_message: … }` using the dialect it was built with; the sub-forms `InputMessageContent.rich.{md,markdown,html}(string, params?)` build from a raw dialect string instead and take an optional `{ isRtl?, skipEntityDetection? }` extras bag.

**factory naming convention** (holds for every factory): required fields are positional, the optional extras bag is camelCase mirroring the bot-api field one-to-one (`parseMode`, `showAboveText`, `canSendMessages`, `allowSendingWithoutReply`, ...). two spots rename beyond plain camelCasing: `InlineQueryResult.*` flattens `input_message_content` → `content` and the `thumbnail_*` group → `thumbnail: { url, width?, height?, mimeType? }`; and `InputPollOption.text(text, { parseMode?, entities?, media? })` drops the bot-api `text_` prefix so its formatting extras read like `InputMessageContent.text`.

## other factories

beyond the media/inline factories above, core ships these (same positional-required + camelCase-extras convention; see `README.md` for full option tables, or `node skills/using-puregram/tools/get-factory.mjs <Name>` for the exact static-method signatures of any factory):

- `ReplyParameters.{to,cross,quote}` → `reply_parameters`. `to(messageId)` same-chat reply, `cross(chatId, messageId)` reply across chats, `quote(messageId, quote)` reply with an excerpt
- `LinkPreview.{disabled,url,large,small}` → `link_preview_options`. `disabled()`, `url(url)`, or `large(url)` / `small(url)` to force preview media size
- `ChatPermissions.{allowAll,denyAll}(overrides?)` — every permission flipped on/off; `overrides` (camelCase flags) tweaks individual ones
- `ChatAdministratorRights.{allowAll,denyAll}(overrides?)` — same shape, for admin-promotion rights
- `InputSticker.{static,animated,video}(sticker, emojiList, extras?)` — sticker-set items; `sticker` is a `MediaSource`/`attach://` ref, `emojiList` positional
- `InputPollOption.text(text, { parseMode?, entities?, media? })` — one `sendPoll` option; formatting plus the bot-api 10.0 `media` field
- `LabeledPrice.of(label, amount)` and `ShippingOption.of(id, title, prices)` — invoice / shipping building blocks
- `Invoice.{fiat,stars}(params)` — full `sendInvoice` / `createInvoiceLink` body. `stars` pins `currency: 'XTR'` + allows `subscriptionPeriod`; `fiat` requires `providerToken` + ISO 4217 `currency`. each rejects the other's exclusive fields at compile time. spread into `sendInvoice` (with `chat_id`) or pass straight to `createInvoiceLink`
- `BotCommands.command(command, description)` plus `BotCommands.scope.{default,allPrivateChats,allGroupChats,allChatAdministrators,chat,chatAdministrators,chatMember}` for scoping `setMyCommands`
- `MenuButton.{default,commands,webApp}` — chat menu button (`webApp(text, url)`)
- `Reaction.{emoji,customEmoji,paid}` — reaction types for `setMessageReaction`

## keyboards

four kinds live in core: `Keyboard` (reply), `InlineKeyboard`, `RemoveKeyboard`, `ForceReply`. each has static-method builders for the common case plus a `*Builder` class for fluent chains:

```ts
import { InlineKeyboard, Keyboard, RemoveKeyboard, ForceReply } from 'puregram'

// inline keyboard, attached to a message
await tg.send(100, 'pick one', {
  reply_markup: InlineKeyboard.keyboard([
    [InlineKeyboard.urlButton({ text: 'docs', url: 'https://core.telegram.org/bots/api' })],
    [InlineKeyboard.textButton({ text: 'press me', payload: 'press' })]
  ])
})

// reply keyboard
const replyKeyboard = Keyboard.keyboard([
  [Keyboard.textButton('yes'), Keyboard.textButton('no')]
])

// remove the reply keyboard / force a reply
const removed = new RemoveKeyboard()
const forced = new ForceReply().setPlaceholder('your answer here')
```

`InlineKeyboard.textButton({ text, payload })` is the common case for `callback_data`. other inline factories: `urlButton`, `payButton`, `loginButton`, `webAppButton`, `switchInlineQueryButton`, `switchInlineQueryCurrentChatButton`, `copyButton`, `gameButton`, plus reactive button styles (`primary`/`danger`/`success`) and `iconCustomEmojiId` on reply buttons.

for fluent chains use `InlineKeyboardBuilder` / `KeyboardBuilder` (`builder.row(button1, button2).button(button3).keyboard`).

## parse mode

three static helper classes — `HTML`, `Markdown`, `MarkdownV2` — wrap each formatting style. they escape user input for you:

```ts
import { HTML, MarkdownV2 } from 'puregram'

await tg.send(100, `${HTML.bold('hello!')} ${HTML.italic('world')}`, { parse_mode: 'HTML' })
await tg.send(100, MarkdownV2.bold('hi'), { parse_mode: 'MarkdownV2' })
```

each class exposes the canonical set: `bold`, `italic`, `underline`, `strikethrough`, `spoiler`, `code`, `pre`, `link`, `mention`, `blockquote`, `expandableBlockquote`, plus `escape` for raw user input.

`parse_mode` (and the `*_parse_mode` variants) is typed `'HTML' | 'Markdown' | 'MarkdownV2' | (string & {})` — the canonical values autocomplete, but it stays a soft enum since telegram matches case-insensitively, so any string still typechecks.

for a tagged-template api with chained styles that composes message entities directly (no `parse_mode` needed) — look at `@puregram/markup`. example:

```ts
import { format, bold, italic } from '@puregram/markup'

await tg.send(100, format`${bold('hello')} ${italic(userInput)}`)
// auto-injects `entities`, no parse_mode header
```

see `puregram-markup` for the full builder surface, the `html` / `htmlb` / `md` parsers, custom html tags, and the `Formatted` codec.

## chat actions (typing / upload indicators)

telegram clears a chat action after ~5s, so a long task needs `sendChatAction` re-fired on an interval. two helpers do that loop — on `tg` (pass a chat id) and on an update (`chat_id` auto-filled). both also take any extra `sendChatAction` params (e.g. `message_thread_id`).

`withChatAction(action, fn, options?)` is the safe default — runs `fn` with the action on, stops it when `fn` settles (even on throw), returns `fn`'s result:

```ts
const answer = await message.withChatAction('typing', () => generateReply(message.text))
const photo = await tg.withChatAction(chatId, 'upload_photo', () => buildPhoto())
```

`createActionController(action, options?)` returns a manual controller — `start()` / `stop()`, mutable `.action`, options `interval` (default `5000`), `wait` (default `0`), `timeout` (default `0`, off). it self-stops on a `sendChatAction` api error:

```ts
const controller = message.createActionController('typing', { interval: 4000 })
controller.start()
try { await longTask() } finally { controller.stop() }
```

exported: `ChatActionController` (class, from `puregram`), `ActionControllerLike` / `ActionControllerOptions` / `ActionControllerParams` (types, from `@puregram/api`).

## updates

an **update** is anything telegram pushes at your bot — a new message, an edited message, a callback-query press, an inline query, a poll vote, a chat-member change, etc. about 30 different kinds, each a discriminated subclass of the `Update` union.

every update class is **codegen'd** from the bot-api schema, so:

- primitive fields are direct getters: `message.text`, `message.messageId`, `callbackQuery.data`
- nested-object fields are lazy + memoized wrappers: `message.from` (a `User`), `message.chat` (a `Chat`)
- per-kind shortcuts are attached as methods: `message.send(...)`, `message.reply(...)`, `message.edit(...)`, `message.delete()`, `message.react('👍')` (emoji string or `TelegramReactionType[]`), `callbackQuery.answer(...)`
- `update.kind` is a literal-typed discriminant, `update.is('message')` narrows the type, `update.raw` is always the bot-api payload as-is

```ts
tg.onMessage(message => message.send('got it'))
tg.onMessage(message => message.reply('quoting you'))
tg.onCallbackQuery(callbackQuery => callbackQuery.answer({ text: 'thanks' }))
tg.onInlineQuery(inlineQuery => inlineQuery.answer({ results: [] }))

// or hook anything via onUpdate
tg.onUpdate((update) => {
  if (update.is('message') && update.hasText()) {
    return update.send(`echo: ${update.text}`)
  }
})
```

### `reply` / `replyWith<Media>`

on message-bearing kinds every `send`-family shortcut has a **reply twin** that auto-fills `reply_parameters.message_id` with the current message — `reply` mirrors `send` (text), and each `sendX` gets a `replyWithX`:

```ts
tg.onMessage(message => message.reply('text reply'))
tg.onMessage(message => message.replyWithPhoto(MediaSource.path('./cat.jpg'), { caption: 'as a reply' }))
tg.onMessage(message => message.replyWithDocument(doc))
tg.onMessage(message => message.replyWithMediaGroup(media))
```

`replyWithAudio`, `replyWithVideo`, `replyWithAnimation`, `replyWithVoice`, `replyWithVideoNote`, `replyWithSticker`, `replyWithLocation`, `replyWithVenue`, `replyWithContact`, `replyWithDice`, `replyWithPoll`, etc. exist for the whole family — anything `tg.api.sendX` accepts `reply_parameters` for. signatures match the matching `send` shortcut exactly; the only difference is the injected `reply_parameters`.

you can still pass `reply_parameters` to customize the reply (quote, `allow_sending_without_reply`, cross-chat) — your fields merge over the injected `message_id`, which you can also override:

```ts
import { ReplyParameters } from 'puregram'

message.reply('with a quote', { reply_parameters: ReplyParameters.quote(message.messageId, 'why?') })
```

`update.sendRich` (alias `sendRichMessage`) and its `replyWithRich` twin send a rich message — you build an `InputRichMessage` as a raw `{ html }` or `{ markdown }` string telegram parses server-side (ergonomic builders live in `@puregram/rich`). `sendDraft` / `sendRichDraft` are the draft twins. on `chat_join_request` updates, `update.approve()` / `update.decline()` accept or reject directly (chat + user auto-filled), while `update.answer({ result: 'approve' | 'decline' | 'queue' })` and `update.sendChatJoinRequestWebApp({ web_app_url })` drive the guard-bot query flow (query id auto-filled).

### `update.thread`

message-bearing kinds expose `update.thread` — an opt-in namespace mirroring every thread-capable shortcut, auto-filling `message_thread_id` (plus `chat_id`, and `reply_parameters.message_id` on the reply twins) from the current message. it's `undefined` when the message isn't in a forum topic / thread, so use `?.` or narrow with `hasMessageThreadId()`:

```ts
tg.onMessage(async (message) => {
  await message.thread?.send('stays in this topic')
  await message.thread?.sendPhoto(MediaSource.path('./p.png'))
  await message.thread?.reply('threaded reply')
  await message.thread?.sendChatAction('typing')

  if (message.hasMessageThreadId()) {
    await message.thread.send('no ?. past the guard')
  }
})
```

covers the `send` / `reply` families, `copy` / `forward`, and forum-topic management (`editForumTopic`, `closeForumTopic`, ...) — everything whose `tg.api.X` accepts `message_thread_id`. plain `update.send(...)` never threads on its own; `thread` pins the current topic and takes no `message_thread_id` of its own, so to target a different thread use the top-level shortcut where it's a normal param: `message.send('x', { message_thread_id: 1234 })`.

### business connections

`business_connection_id` is anchored automatically on every update shortcut that accepts it (`send`, `reply`, `edit*`, `pin`, `sendChatAction`, `createActionController` / `withChatAction`, the `thread` namespace, …). a reply/edit on a `business_message` stays on that connection with no manual plumbing; it's filled only when the message has one, and excluded from the shortcut's `params`. to act as the bot rather than the business account, drop to `tg.api`:

```ts
tg.onBusinessMessage(message => message.reply('on the connection'))   // + business_connection_id
tg.onMessage(message => message.reply('regular'))                     // omitted (not a business msg)
```

outside an update — or to bind a connection explicitly — `tg.business(connectionId)` returns a scoped `tg.api` that injects `business_connection_id` into every call (a call-site value still wins):

```ts
await tg.business(connectionId).sendMessage({ chat_id, text: 'on behalf of the account' })
```

every kind has a matching `tg.on<Kind>(handler)` — `onMessage`, `onEditedMessage`, `onChannelPost`, `onCallbackQuery`, `onInlineQuery`, `onChatMember`, `onPoll`, etc. picking a kind that doesn't exist is a compile error. for cross-kind handlers or custom predicates, `tg.onUpdate(...)` is the catch-all.

use `node skills/using-puregram/tools/get-update.mjs <kind|ClassName>` to look up any wrapped update class — it prints all inherited getters/methods and shows the dispatcher name.

### service events

service events are `TelegramMessage`-derived updates dispatched when the underlying payload has a matching field set: `new_chat_members`, `left_chat_member`, `new_chat_title`, `migrate_to_chat`, `pinned_message`, `video_chat_started`, `forum_topic_created`, `web_app_data`, etc. they share the `MessageShared` base with regular messages, so all message helpers (`send`, `reply`, `delete`, `pin`) work as expected. each has its own `tg.onX(...)` dispatcher.

## filters

a **filter** is a named, composable, type-guarded predicate over an update. compose them, pass them as the first arg of `tg.on<Kind>(filter, handler)`, and the handler's argument narrows to whatever the filter promises.

most common cases have a one-liner on `Telegram` itself:

```ts
// matches /start, /start@yourbot, /start payload, etc
tg.command('start', message => message.send('welcome!'))
```

for anything richer, compose. `puregram` re-exports a `filters` namespace plus a few top-level helpers (`and`, `or`, `not`):

```ts
import { filters, and } from 'puregram'

const { kind, hasText } = filters

// gate the handler on a filter — `message` is narrowed
tg.onMessage(hasText, message => message.send(`heard: ${message.text}`))

// compose with `and`/`or`/`not` — use tg.onUpdate when the filter spans kinds
tg.onUpdate(and(kind.message, hasText), update => update.send('!'))
```

three composition forms are interoperable — pick whichever's prettier:

```ts
import { kind, hasText, and } from 'puregram'

tg.onUpdate(and(kind.message, hasText), handler)              // factory form
tg.onUpdate(kind.message.and(hasText), handler)               // chained method
tg.onUpdate(update => kind.message(update) && hasText(update), handler) // raw boolean
```

write your own with `defineFilter`:

```ts
import { defineFilter } from 'puregram'

const isWeekend = defineFilter('isWeekend', _update => {
  const day = new Date().getDay()
  return day === 0 || day === 6
})

tg.onMessage(isWeekend, message => message.send('chill, it is the weekend'))
```

declaring `kinds: ['message', 'edited_message']` on a custom filter gives the dispatcher a free fast-path — it skips evaluating the predicate when `update.kind` isn't in the set. the codegen'd `hasX` filters already do this.

handcrafted filters available out of the box: `command`, `text`, `regex`, `chat`, `senderChat`, `from`, `callbackData`, `inlineQuery`, and many more (`start`, `startsWith`, `contains`, `caption`, `chatId`, `forum`, `fromBot`, `viaBot`, `kindIn`, ...). codegen'd ones: `kind.X` / `action.X` (one per update / service-event kind), `hasX` (presence predicates for every nullable field).

run `node skills/using-puregram/tools/get-filter.mjs --list` to enumerate every filter (there are ~100+, most undocumented here), or `get-filter.mjs <name>` for a single filter's narrowing type and usage.

## middlewares

a **middleware** runs on every incoming update before user handlers fire. signature: `(update, next) => ...`. call `next()` to let the chain continue; don't call `next()` to swallow the update. classic use case for cross-cutting concerns — timing, logging, auth, rate-limit short-circuits.

```ts
tg.use(async (update, next) => {
  const start = Date.now()
  await next()
  console.log(`${update.kind} took ${Date.now() - start}ms`)
})
```

the 2-arg form gates on a filter and the `update` argument is properly typed inside:

```ts
import { filters } from 'puregram'

tg.use(filters.kind.message, async (message, next) => {
  console.log(message.kind, message.text)
  await next()
})
```

middlewares are **prioritized** — `'high'` runs first, then `'normal'` (the default), then user `tg.on<Kind>(...)` handlers, then `'low'`:

```ts
tg.use(myMiddleware, { priority: 'high' })
```

plugins like `@puregram/flow`'s `waitFor` claim `'high'` to intercept updates before any user handler sees them. that's how `flow.waitFor(...)` can pluck the next message out from under the regular dispatch chain.

## hooks

middlewares wrap **incoming updates**. hooks wrap **outgoing api requests**. every `tg.api.X(...)` call runs through a five-stage pipeline, and each stage is a hook you can register middleware on:

```ts
import type { RequestContext } from 'puregram'

tg.useHook('onBeforeRequest', (context: RequestContext, next) => {
  if (context.method === 'sendMessage' && context.params !== undefined) {
    context.params.parse_mode ??= 'HTML'
  }
  return next()
})

tg.useHook('onError', (error, _context) => {
  console.error('api call failed:', error.message)
})
```

the five request-stage hooks, in order:

1. **`onBeforeRequest`** — request just caught, params not yet serialized. mutate `params`, abort early
2. **`onRequestIntercept`** — just before `fetch` fires. `url`, `init` are populated; swap the http client or rewrite the url here
3. **`onApiCall`** — *around* hook wrapping the fetch: `(ctx, next) => { ... await next() ... }`. time / trace / retry / short-circuit a call. registered via `useHook('onApiCall', ...)`; runs only when registered, so no cost otherwise
4. **`onResponseIntercept`** — response back, parsed as `json`. inspect or rewrite before puregram processes it
5. **`onAfterRequest`** — pipeline done. cleanup time

plus:

- **`onError`** — between intercept and after-request; catches request errors. return a new `Error` to replace it, or nothing to keep it as-is
- **`onUpdate`** — dispatch middleware (priority-aware). `tg.use(...)` is shorthand for `useHook('onUpdate', fn, options)`
- **`onInit`** — after all plugin installs resolve, before dispatch starts
- **`onShutdown`** — graceful teardown, drains in-flight
- **`onDispatchError`** — registered via `tg.catch(fn)`; sees errors thrown inside dispatched handlers

plugins lean on hooks all the time — `@puregram/markup` uses `onBeforeRequest` to unwrap its tagged-template formatted text into `entities`, `@puregram/media-cacher` uses it to swap upload sources for cached `file_id`s, `@puregram/rate-limit` uses `onUpdate` with `'high'` priority to short-circuit. see `puregram-media-cacher` for the cache-install + key-derivation + auto-evict mechanics, and `puregram-rate-limit` for the filter / middleware / imperative `tg.rateLimit.check` call shapes.

## plugins (`.extend`)

a **plugin** is a self-contained piece of behavior that attaches itself to `tg` under its own namespace. every official satellite (`@puregram/session`, `@puregram/scenes`, `@puregram/markup`, `@puregram/flow`, `@puregram/media-cacher`, `@puregram/rate-limit`) is a plugin.

the api is `tg.extend(plugin)`, chainable, and every link narrows the type of `tg` so you never need `declare module 'puregram'` augmentations:

```ts
import { Telegram } from 'puregram'
import { session } from '@puregram/session'

const tg = Telegram.fromToken(process.env.TOKEN!)
  .extend(session())

tg.onMessage(async (message) => {
  message.session.counter = (message.session.counter ?? 0) + 1
  await message.send(`you sent ${message.session.counter} messages`)
})
```

plugins compose freely:

```ts
import { session } from '@puregram/session'
import { scenes } from '@puregram/scenes'
import { flow } from '@puregram/flow'

const tg = Telegram.fromToken(TOKEN)
  .extend(session())
  .extend(scenes())
  .extend(flow())

// tg.session, tg.scenes, tg.flow — all typed
```

writing your own takes ~5 lines. `createPlugin` returns a typed plugin spec; the install function's return value gets keyed under `plugin.name` and merged onto `tg`:

```ts
import { createPlugin, Telegram } from 'puregram'

const greeter = createPlugin({
  name: 'greeter',
  install: tg => ({
    hello: (chatId: number) => tg.send(chatId, 'hi!')
  })
})

const tg = Telegram.fromToken(process.env.TOKEN!).extend(greeter)
await tg.greeter.hello(100) // typed
```

key things to know:

- **`dependsOn`**. `createPlugin({ name: 'X', dependsOn: ['session'], install: ... })` declares a hard dependency. install order resolves topologically; `PluginCycle` on a cycle, `PluginMissingDep` if the dep isn't installed
- **`tg.has(name)`**. soft dependency check — runtime only, doesn't widen the type. use it for "adapt-if-present" behavior inside a plugin
- **namespace collisions**. two plugins with the same `name` throw `PluginConflict` at start time. plugins **cannot** pollute the root `tg` namespace — everything they expose lives under `tg.<name>.X`
- **install timing**. `.extend(plugin)` queues the plugin synchronously. installs are awaited on `tg.start()` (or implicitly on the first `startPolling()` / `getWebhookCallback()`), in dependency-resolved order. async installs are fine
- **lifecycle hooks**. `useHook('onInit', ...)` runs once installs settle; `useHook('onShutdown', ...)` runs on `tg.shutdown()`. that's the canonical place to spin background tasks up or tear them down

## custom updates

**first — is the incoming kind already wrapped?** the generated schema covers the whole bot api, so a kind you don't recognize (newer, niche, or just unfamiliar) is usually already a first-class update with its own `tg.on<Kind>` dispatcher and typed getters — not something to hand-route. before reaching for the machinery below, confirm: `node skills/using-puregram/tools/get-update.mjs <kind>`, or just try `tg.on<Kind>(...)` (a real kind type-checks; a missing one is a compile error). the `defineUpdate`/`emit` path is **only** for events telegram never sends you.

your bot may produce events that don't come from telegram — a webhook from a payment provider, a cron tick, an internal job-completion signal. instead of inventing a parallel event bus, teach `tg` about a custom kind and emit through the same dispatch pipeline as bot-api updates:

```ts
type JobDone = { jobId: string, result: unknown }

const tg = Telegram.fromToken(TOKEN)

tg.defineUpdate<'job_done', JobDone>('job_done')

setInterval(() => {
  tg.emit('job_done', { jobId: 'abc', result: { ok: true } })
}, 1000)

tg.onUpdate((update) => {
  if (update.kind === 'job_done') {
    update.jobId   // string — typed
    update.result  // unknown
  }
})
```

`tg.on<custom kind>(...)` is typechecked just like the bot-api ones — `tg.on('not_a_real_kind', ...)` is a compile error. custom updates flow through the same `onUpdate` middleware chain as everything else.

## errors

`tg.api.X(...)` and `tg.send(...)` throw `ApiError` on failure. `tg.api.X({..., suppress: true})` returns `T | ApiResponseError` without throwing. `Telegram.isErrorResponse(value)` is the type guard. `tg.api.call('method', params)` always throws (no `suppress` on the string escape hatch).

```ts
import { Telegram, ApiError } from 'puregram'

// throwing form
try {
  await tg.api.sendMessage({ chat_id: 1, text: 'hi' })
} catch (err) {
  if (err instanceof ApiError) {
    console.error('code', err.code, 'desc', err.description)
    // err.parameters?.retry_after — telegram's flood-wait hint
    // err.parameters?.migrate_to_chat_id — chat moved to supergroup
  }
}

// non-throwing form
const r = await tg.api.sendMessage({ chat_id: 1, text: 'hi', suppress: true })
if (Telegram.isErrorResponse(r)) {
  // typed as ApiResponseError
} else {
  // typed as TelegramMessage
}
```

for dispatch-side errors (thrown inside an `on<Kind>` handler) use `tg.catch(fn)`. without a catch handler, puregram is loud by default — errors rethrow on a microtask so node's `uncaughtException` fires. set `swallowDispatchErrors: true` to suppress that fallback:

```ts
const tg = new Telegram({
  token: process.env.TOKEN!,
  swallowDispatchErrors: true
})

tg.catch((err, ctx) => {
  console.error('handler threw on update', ctx.raw.update_id, err)
})
```

multiple `catch` handlers can be registered — they all run in registration order. inspired by [grammY's `bot.catch`](https://grammy.dev/guide/errors).

## polling vs webhook

### polling

simplest transport — long-poll `getUpdates`, dispatch each batch, repeat. great for development, fine for small bots:

```ts
await tg.startPolling({
  allowedUpdates: ['message', 'callback_query', 'chat_member'],
  dropPendingUpdates: true
})

// later
tg.stopPolling()       // halts the loop, in-flight handlers keep running
await tg.shutdown()    // also fires onShutdown plugin hooks + drains in-flight
```

key options:

- `offset` — starting `update_id`, rarely needed
- `timeout` — long-poll timeout in seconds
- `allowedUpdates` — restrict the kinds telegram delivers (`UpdatesFilter.all()` for "every kind incl. opt-in ones like `chat_member`"; or `'auto'` to derive the minimal set from your registered handlers, falling back to telegram's default for opaque predicates)
- `dropPendingUpdates` — `true` to drop the queued backlog, or a `string[]` to drop only specific kinds
- `concurrency` — cap concurrent dispatches (default `Infinity`)
- `maxInFlight` — backpressure; stop pulling new updates while this many dispatches are in flight (running + queued), resume as they settle (default `Infinity`). `concurrency` bounds what *runs*, `maxInFlight` bounds *running + queued* by pausing `getUpdates` — telegram holds the backlog server-side so memory stays flat under overload
- `sequentializeBy: (raw) => string | undefined` — return a key; updates sharing that key dispatch in FIFO order, different keys still run in parallel subject to `concurrency`. handy for "updates from the same chat run serially when the handler mutates per-chat state"

```ts
await tg.startPolling({
  concurrency: 8,
  maxInFlight: 64,
  sequentializeBy: (raw) =>
    String(raw.message?.chat.id ?? raw.callback_query?.message?.chat.id ?? '')
})
```

### webhook

three patterns, pick what matches your environment:

**1. `tg.startWebhook(...)`** — registers the webhook with telegram and spins up a built-in node `http` listener in one call:

```ts
const { stop } = await tg.startWebhook({
  url: 'https://example.com/webhook',
  port: 8080,
  secretToken: 'my-secret',
  dropPendingUpdates: true
})

process.on('SIGTERM', async () => {
  await stop()
  await tg.shutdown()
})
```

**2. bring your own http framework** — one adapter per framework at `puregram/webhook`:

```ts
import express from 'express'
import { Telegram } from 'puregram'
import { expressAdapter } from 'puregram/webhook'

const tg = Telegram.fromToken(process.env.TOKEN!)
const app = express()

app.use(express.json())
app.post('/webhook', expressAdapter(tg.webhookHandler({ secretToken: 'my-secret' })))
app.listen(8080)

await tg.setWebhook({ url: 'https://example.com/webhook', secretToken: 'my-secret' })
```

adapters available at `puregram/webhook`: `expressAdapter`, `fastifyAdapter`, `koaAdapter`, `honoAdapter`, `h3Adapter`, `elysiaAdapter`, `webAdapter` (for `fetch`-style runtimes — workers, deno, bun, edge), `nodeAdapter` (raw `node:http`).

express and koa require pre-parsed JSON (`express.json()`, `koa-bodyparser`). fastify, hono, h3, elysia, and web auto-parse.

**3. bare `node:http`** — `tg.getWebhookCallback(opts?)` is `nodeAdapter(webhookHandler(opts))` rolled into one:

```ts
import { createServer } from 'node:http'

const callback = tg.getWebhookCallback({ secretToken: 'my-secret' })
createServer(callback).listen(8080)

await tg.setWebhook({ url: 'https://example.com/webhook', secretToken: 'my-secret' })
```

### webhook options

- `secretToken` — shared secret echoed in `x-telegram-bot-api-secret-token` header; mismatched/missing requests get `401`
- `webhookReply` (default `true`) — webhook-reply optimization. methods returning `true` (chat actions, reactions, deletions) ride the `200` body, saving a round-trip. data-returning methods still round-trip. invisible to userland; disable only if a proxy strips non-empty 200 bodies
- `timeoutMilliseconds` (default `25_000`) — max wait between request arrival and the 200 response. dispatch keeps running after; awaited by `tg.shutdown()`. only active with `webhookReply`
- `maxBodyBytes` (default `1_048_576` = 1 MB) — `nodeAdapter` body cap; oversize → `413`. other adapters honor their own framework limits

### `setWebhook` / `deleteWebhook`

camelCase wrappers around the bot-api methods (easier to read than the snake_case raw form):

```ts
await tg.setWebhook({
  url: 'https://example.com/webhook',
  secretToken: 'my-secret',
  allowedUpdates: ['message', 'callback_query'],
  maxConnections: 100,
  dropPendingUpdates: true
})

await tg.deleteWebhook({ dropPendingUpdates: true })
```

## resilience

a handful of opt-in knobs for production traffic.

### `retryOnFloodWait` — auto-retry on 429

when telegram returns `429 Too Many Requests` it includes `parameters.retry_after` (seconds). this option makes the api proxy honor that automatically:

```ts
// one retry, no wait cap
const tg = new Telegram({ token: process.env.TOKEN!, retryOnFloodWait: true })

// bounded: up to 3 retries, bail if telegram asks for more than 10s
const tg = new Telegram({
  token: process.env.TOKEN!,
  retryOnFloodWait: { max: 3, maxWaitMs: 10_000 }
})

// also retry 5xx + network errors with exponential backoff
const tg = new Telegram({
  token: process.env.TOKEN!,
  retryOnFloodWait: { max: 3, on: ['flood', 'server', 'network'], backoff: { base: 3000 } }
})
```

defaults to `on: ['flood']` — only `429` with numeric `retry_after` retries. add `'server'` (api 5xx) / `'network'` (transport errors) to opt into exponential-`backoff` retries (`base × 2 ** attempt`, capped at `max`). `suppress: true` calls keep their semantics (raw error object, no retry).

### `tg.catch` + `swallowDispatchErrors`

covered in [errors](#errors) above. these turn dispatch errors from "uncaughtException" into routable events.

### polling concurrency + per-key sequentialization

covered in [polling](#polling) above. `concurrency` + `sequentializeBy` give you real-world traffic shaping.

### auto-answering + de-duplicating updates

two constructor knobs, both off by default:

- `autoAnswerCallbackQuery` — answers a `callback_query` after dispatch if no handler called `update.answer(...)` (stops the client's loading spinner hanging). `true` for an empty answer, or `{ text, show_alert, ... }` for a default
- `dedupeUpdates` — drops updates whose `update_id` was seen recently (webhook retries, overlapping `getUpdates`). `true` keeps the last 1000 ids; `{ max }` sizes the window

```ts
const tg = new Telegram({ token: process.env.TOKEN!, autoAnswerCallbackQuery: true, dedupeUpdates: true })
```

## local bot api server

the [official local bot api server](https://github.com/tdlib/telegram-bot-api) speaks the same bot api as the cloud, so it's a drop-in — set `apiBaseUrl` + `useLocal`:

```ts
const tg = new Telegram({
  token: process.env.TOKEN!,
  apiBaseUrl: 'http://localhost:8081/bot',
  useLocal: true
})
```

wins: 2 GB up/downloads (vs 50 MB / 20 MB), absolute on-disk `file_path`s, http webhooks on any port, no global rate limit. call `logOut` against the cloud once before moving a live bot over.

`useLocal: true` makes `tg.download(...)` read files straight off disk (the server returns a local path, not a url). for uploads, `MediaSource.local(path)` hands the server a `file://` path to read itself, skipping the multipart upload — it throws without `useLocal`.

`useLocal` and `MediaSource.local()` are orthogonal: `useLocal` is the endpoint protocol, `local()` is "this file is on a disk the server can read". they stay separate because the bot and server don't always share a filesystem (separate containers/hosts) — there `MediaSource.path(...)` still uploads the bytes.

## canonical recipe — photo with spoiler caption and a typed callback-data button

end-to-end, using `@puregram/callback-data` for typed payloads:

```ts
import { Telegram, MediaSource, HTML } from 'puregram'
import { defineCallbackData } from '@puregram/callback-data'

const Press = defineCallbackData('press').string('source')

const tg = Telegram.fromToken(process.env.TOKEN!)

tg.onMessage(async (message) => {
  await message.sendPhoto(MediaSource.path('./cat.jpg'), {
    caption: HTML.spoiler('caption is a spoiler'),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[Press.button({ text: 'press me', source: 'cat-card' })]]
    }
  })
})

tg.onCallbackQuery(Press.filter, (q) => {
  // q.payload: { source: string } — typed, validated, narrowed
  return q.answer({ text: `thanks (from ${q.payload.source})!` })
})

await tg.startPolling()
```

four things to notice:

1. `message.sendPhoto(photo, params?)` is the per-update shortcut — `chat_id` is auto-filled from `message.chat.id`, photo is positional, everything else goes in `params?`. `message.replyWithPhoto(photo, params?)` is the reply twin (same signature, auto-fills `reply_parameters`)
2. `HTML.spoiler(text)` returns escaped HTML; pair with `parse_mode: 'HTML'`. for entity-aware formatting without a `parse_mode` header, use `@puregram/markup` (`format\`${spoiler('...')}\``)
3. `Press.button({ text, ...payload })` builds an inline button with binary-packed `callback_data` (no JSON, no manual parsing). `reply_markup` accepts both the raw `{ inline_keyboard: [[...]] }` shape and `InlineKeyboard.keyboard([[...]])` — pick whichever's prettier at the call site
4. `Press.filter` is dispatch-ready — pass it to `tg.onCallbackQuery(...)` and the handler's `q.payload` is fully typed and validated

without typed payloads, the no-plugin form is `InlineKeyboard.textButton({ text, payload: 'pressed' })` and `cb.data === 'pressed'` on the receiving side.

### `@puregram/callback-data` in depth

field types: `.string(key, opts?)`, `.number(key, opts?)` (zigzag varint, signed safe integer), `.boolean(key, opts?)` (1 bit in header), `.literal(key, [...] as const, opts?)` (`ceil(log2(N))` bits). `opts` supports `default` or `optional` (mutually exclusive).

the slug becomes the wire prefix (first 6 chars of `base64url(md5(slug))` by default; customize with `slugLength`). this leaves more of the 64-byte `callback_data` budget for actual data.

chained predicates via `.with`:

```ts
const Ban = defineCallbackData('ban').number('user_id').boolean('confirm')

tg.onCallbackQuery(Ban.filter.with({ confirm: true }), (q) => {
  // only fires when confirm === true
  return q.answer({ text: `banned ${q.payload.user_id}` })
})
```

`.with(condition)` accepts a partial payload, a per-field predicate, or `present` / `missing` helpers for optional fields. see `packages/callback-data/README.md` for the full wire-format reference.

## debug logs

namespaced logger built in, no `debug` dependency:

```sh
# everything
PUREGRAM_DEBUG='puregram:*' node index.js

# just the api proxy + dispatch
PUREGRAM_DEBUG='puregram:api,puregram:dispatch' node index.js
```

namespaces: `puregram:api`, `puregram:dispatch`, `puregram:polling`, `puregram:webhook`. comma-separated, supports `*` wildcards. logs go to `stderr`.

`puregram:api` prints the method + result (`<- sendMessage ok=false error_code=400 description=...` on failure); `puregram:api:raw` adds full request params and the complete raw response body — noisy, but it's what you paste when a call does something weird. `puregram:*` captures it too.

## typescript usage

written in typescript, ships its own `.d.ts` — no `@types/puregram`. node 22+, ts 5.4+.

- **`Telegram<Ext>` is generic over its plugins**. each `.extend(plugin)` narrows the type, no `declare module 'puregram'` augmentations needed
- **`update.is(kind)` is a type predicate** — same for the codegen'd `hasX` predicates (`if (message.hasText()) { message.text /* string */ }`)
- **raw bot-api types**: `import type { TelegramMessage, TelegramUser, TelegramChat } from 'puregram'` (re-exported from `@puregram/api`)

## conventions

- esm-only. no cjs build is shipped — `"type": "module"` in your `package.json` is required
- node 22+, typescript 5.4+
- one bot api version per puregram release (currently **bot api 10.1**). no multiplexing — upgrade puregram to upgrade the schema
- plugins must namespace under `plugin.name`. top-level `tg` namespace pollution is rejected by the registry
- `tg.api.X(...)` throws `ApiError` on failure. `tg.api.X({..., suppress: true})` returns `T | ApiResponseError`; use `Telegram.isErrorResponse(value)` as the type guard
- `tg.api.call('method', params)` always throws (no `suppress` on the string escape hatch)

## migrating from v2

v2 is frozen on the `lord` branch (currently `2.27.0`). v3 is a hard break — there is no codemod and there will not be one. major differences:

| v2 | v3 |
|---|---|
| `Context` per update | wrapped update class per kind (`MessageUpdate`, `CallbackQueryUpdate`, ...) |
| `applyMixins(...)` runtime patching | codegen'd class hierarchy, no mixins |
| `telegram.updates.on('message', ...)` | `tg.onMessage(...)` or `tg.on('message', ...)` |
| `declare module 'puregram'` for plugin augmentation | `tg.extend(plugin)` runtime + type |
| `middleware-io` composer | first-party priority middleware (`'high' \| 'normal' \| 'low'`) |
| `@puregram/hear` | userland (`tg.command(...)` or compose a filter) |
| `@puregram/prompt` | folded into `@puregram/flow` as `flow.prompt(...)` |
| `inspectable` decorators | `Symbol.for('nodejs.util.inspect.custom')` codegen |
| `experimentalDecorators` required | no decorators needed |
| `undici` runtime dep | native `fetch` + pluggable `HttpClient` |

if you're porting a bot: read the new examples, write the migration by hand, file an issue if something's genuinely unclear.

## see also

- repo: [`github.com/puregram/puregram`](https://github.com/puregram/puregram)
- examples: [`examples/`](https://github.com/puregram/puregram/tree/v3/examples)
- per-package READMEs under [`packages/*/README.md`](https://github.com/puregram/puregram/tree/v3/packages)
- bot api reference: [core.telegram.org/bots/api](https://core.telegram.org/bots/api)
- telegram chat: [`t.me/pureforum`](https://t.me/pureforum)
