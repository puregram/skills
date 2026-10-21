# telegram-side quirks — puregram notes

how the bot api behaves, as it affects puregram code. the server-side rules themselves live in the SDK-agnostic skills, measured against the live api: `telegram-inline-mode`, `telegram-ephemeral-messages`, `telegram-guest-mode`, `telegram-streaming-replies`, `telegram-groups`, `telegram-business-bots`, and `telegram-bot-api` for live reference lookups. this file keeps the puregram-shaped recipes and the topics those skills don't cover yet (custom emoji, editing/deleting, callback queries, formatting). library mechanics live in the [main skill](../SKILL.md).

## inline mode — deferred heavy work in puregram

the lifecycle (≈10 s answer deadline, `inline_message_id` only with a keyboard, lossy feedback, caching, editing rules, no delete) is in `telegram-inline-mode`. this is the puregram shape of its deferred-render recipe: answer with cheap placeholders and render only the result that was actually sent:

```ts
import { Telegram, InlineQueryResult, InputMessageContent, InlineKeyboard } from 'puregram'

const tg = Telegram.fromToken(process.env.TOKEN!)

const keyboard = InlineKeyboard.keyboard([
  InlineKeyboard.textButton({ text: 'refresh', payload: 'refresh' })
])

tg.onInlineQuery((query) => query.answer([
  InlineQueryResult.article({
    id: query.query,
    title: `render "${query.query}"`,
    content: InputMessageContent.text('rendering…'),
    // without a keyboard there is no inline_message_id — the message would be uneditable forever
    replyMarkup: keyboard
  })
], { cache_time: 0 }))

tg.onChosenInlineResult(async (chosen) => {
  if (!chosen.hasInlineMessageId()) return

  const text = await renderExpensiveThing(chosen.query)

  await tg.api.editMessageText({
    inline_message_id: chosen.inlineMessageId,
    text,
    reply_markup: keyboard // edits drop the keyboard unless re-passed
  })
})

// feedback is lossy — the button is the recovery path: callback_query carries inline_message_id too
tg.onCallbackQuery(async (query) => {
  if (!query.hasInlineMessageId()) return

  await query.answer()
  await tg.api.editMessageText({
    inline_message_id: query.inlineMessageId,
    text: await renderExpensiveThing('refresh'),
    reply_markup: keyboard
  })
})

await tg.startPolling({ allowedUpdates: ['inline_query', 'chosen_inline_result', 'callback_query'] })
```

requirements: feedback probability at **100%**, and every placeholder carries an inline keyboard — both for the `inline_message_id` and for the callback fallback. `editMessageMedia` on an inline message can't upload: keep assets as `file_id`s (`@puregram/media-cacher` automates that), and use `InlineQueryResult.cached.*` to send them as results.

## custom emoji — who can actually send them

the gate ([formatting options](https://core.telegram.org/bots/api#formatting-options)): "custom emoji entities can only be used by bots that purchased additional usernames on fragment, **or in the messages directly sent by the bot to private, group and supergroup chats if the owner of the bot has a telegram premium subscription**". channels are excluded from the premium-owner path; fragment has no carve-outs.

- **failure is silent.** an unentitled bot gets no error — the server strips the entity and only the plain fallback emoji shows. custom emoji "not working" is almost always the gate, not your code
- the entity must wrap a real emoji character (server-enforced), so degradation is always graceful: notifications, non-premium forwards, and stripped sends all show the fallback. use `Sticker.emoji` from `getCustomEmojiStickers` as the fallback char
- **initial inline results ignore custom emoji** — but *editing* the inline message afterwards applies them, since the edit is a message directly sent by the bot (measured on 10.3 with a premium-owner bot, along with: kept in groups/private, silently stripped in channels, button icons dropped in channels — table in `telegram-inline-mode`). combine with the deferred pattern above: plain-emoji placeholder → edit in the custom-emoji entities on `chosen_inline_result` / first `callback_query`
- receiving is ungated: every bot sees incoming `custom_emoji` entities and resolves them with `getCustomEmojiStickers` (≤200 ids per call)
- clients render at most ~100 animated custom emoji per message (`message_animated_emoji_max` app config); the rest fall back
- other surfaces: keyboard-button icons (`icon_custom_emoji_id`, 9.4, same gate); poll questions/options accept **only** `custom_emoji` entities and nothing else; forum-topic icons must come from the `getForumTopicIconStickers` whitelist; a reaction may use a custom emoji only if it's already on the message or explicitly admin-allowed — and bots set at most one reaction, never paid ones

build them with `@puregram/markup`'s `customEmoji(fallback, id)` (the default path), `@puregram/rich`'s `rich.customEmoji(id, alt)` inside a rich message, or core's `HTML.emoji(fallback, id)` / `MarkdownV2.emoji(fallback, id)` when you're stuck on `parse_mode` — never hand-assemble the entity.

## editing & deleting — the actual rules

- only messages **without a reply keyboard** are editable: "it is currently only possible to edit messages without reply_markup or with inline keyboards" ([updating messages](https://core.telegram.org/bots/api#updating-messages))
- `editMessageText` / `editMessageCaption` **drop the existing inline keyboard** unless you re-pass `reply_markup` on every edit (measured on 10.3 for regular and inline messages; ephemeral edits behave the same). markup-only change → `editMessageReplyMarkup`
- a no-op edit is an error: 400 `message is not modified: specified new message content and reply markup are exactly the same...`. diff before editing, or suppress exactly that error
- bots edit their **own** messages with no time limit — the 48h window applies to users and to business messages ("business messages that were not sent by the bot and do not contain an inline keyboard can only be edited within 48 hours"). but bot-side message storage is ephemeral ("older messages may be removed by the server shortly after they have been processed"), so an old `message_id` can still 400 with `message to edit not found`
- album members are type-locked: "only to an audio for audio albums, only to a document for document albums and to a photo, a live photo, or a video otherwise". replacing a *text* message with media works; media → text never does
- `deleteMessage` limits (the [full list](https://core.telegram.org/bots/api#deletemessage) is worth one read): 48h general ceiling — even for the bot's own messages; incoming messages deletable only in private chats; admin rights (`can_delete_messages`) lift the limits within that chat; a dice in a private chat deletes only *after* 24h. `deleteMessages` batches ≤100 ids and silently skips missing ones
- live-updating uis (progress bars) share the flood budget — community figure ~20 edits/min per group; batch redraws (`@puregram/throttler` shapes this)

## update delivery — what never arrives by default

- the `allowed_updates` default **excludes** `chat_member`, `message_reaction`, and `message_reaction_count` ([getUpdates](https://core.telegram.org/bots/api#getupdates)). reaction and member handlers silently never fire until you subscribe explicitly — `UpdatesFilter.all()`, `'auto'`, or a literal list in `startPolling` / webhook options
- the setting is sticky server-side: "if not specified, the previous setting will be used" — a list set by an old deploy survives until overwritten, and a new list only affects updates created *after* the call
- reactions additionally require the bot to be an **admin** of the group/channel. `message_reaction` = identified per-user changes; `message_reaction_count` = anonymous totals, "grouped and can be sent with delay up to a few minutes". your own `setMessageReaction` calls never echo back. reacting to an album lands on its first non-deleted message
- **privacy mode**: what a member bot does and doesn't receive is measured case by case in `telegram-groups`. puregram corollary: free-text prompts (`@puregram/flow`, `@puregram/scenes`) silently break in privacy-mode groups — use `ForceReply` (replies always route to the bot), buttons, or admin rights
- each group message is delivered to at most **one** privacy-enabled bot, and a reply wins even over an explicit `/cmd@otherbot` (measured; matrix in `telegram-groups`). bots don't see other bots' messages unless bot-to-bot communication mode is on (10.0)
- bots can't dm first: 403 `bot can't initiate conversation with a user` until the user messages the bot once — an inline-button press or shared group membership is not enough. deep-link them into a `/start` (`t.me/yourbot?start=payload`) when you need a pm channel
- 403 `bot was blocked by the user` on send = unsubscribe signal — flag the user and stop; there's no way to detect a block beforehand
- undelivered updates are kept server-side for max 24h. polling and webhook are mutually exclusive: webhook set → `getUpdates` returns 409; a second concurrent poller kills the first with 409 `terminated by other getUpdates request`

## callback queries — the short window

- answering is mandatory — clients spin "until you call answerCallbackQuery" ([CallbackQuery](https://core.telegram.org/bots/api#callbackquery)); `autoAnswerCallbackQuery: true` is the safety net
- the query id expires fast (≈10s, community figure): late or duplicate answers fail with 400 `query is too old and response timeout expired or query ID is invalid`. answer *first*, then do the slow work
- `callback_data` is 1–64 **bytes**, not characters — multi-byte utf-8 shrinks the budget (`@puregram/callback-data` packs binary within it)
- `answerCallbackQuery`'s `url` opens only game urls (from `callback_game` buttons) and `t.me/yourbot?start=...` deep links — arbitrary urls don't open
- `cache_time` on the answer caches it client-side — repeat presses may never reach the bot

## forum topics

the General-topic trap (omit `message_thread_id`, never pass `1`), topic detection via `is_topic_message`, and reply threads in non-forum groups are measured in `telegram-groups`. puregram's `update.thread` exists only when `message_thread_id` is present, so it matches the server's behavior.

## `parse_mode` silently wins over `entities`

the docs only say entities "can be specified instead of `parse_mode`" ([sendMessage](https://core.telegram.org/bots/api#sendmessage)) — they never say what happens when both arrive. measured against the live api, `parse_mode` wins and the `entities` array is **discarded**:

- `{ text: 'hello world', entities: [{ type: 'bold', offset: 0, length: 5 }] }` → the returned message carries the bold entity
- the same call plus `parse_mode: 'HTML'` → `entities: undefined`. no error, no formatting. identical under `MarkdownV2`, and identical for `caption` / `caption_entities` on `sendPhoto`
- `{ text: '<b>tags</b> plus entity', entities: [{ type: 'italic', … }], parse_mode: 'HTML' }` → comes back `"tags plus entity"` with a **bold** entity: the tags were parsed, the supplied italic entity thrown away

so a `defaultParams: { '*': { parse_mode: 'HTML' } }` left over from before `@puregram/markup` strips formatting from every send — and when the entity text happens to contain a `<` or a MarkdownV2 reserved char, the send 400s with `can't parse entities` instead. one or the other, never both.

## entity offsets are utf-16

`MessageEntity` offsets/lengths count [utf-16 code units](https://core.telegram.org/api/entities#entity-length), not code points: bmp chars = 1, astral chars (nearly all emoji) = 2, flags = 4, zwj sequences more. js `string.length` / `.slice()` already measure utf-16, so plain js math happens to be correct — but code-point counting (`[...str].length`) is wrong for this. in practice you rarely hand-build entities: the `HTML` / `Markdown` helpers, `@puregram/markup`, and `@puregram/rich` compute offsets for you.
