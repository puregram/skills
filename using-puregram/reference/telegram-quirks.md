# telegram-side quirks — how the bot api actually behaves

operational rules the [bot api reference](https://core.telegram.org/bots/api) buries in footnotes or never states. each one changes how you architect a bot. library mechanics live in the [main skill](../SKILL.md); telegram mechanics live here.

## inline mode — the real lifecycle

the flow: user types `@yourbot query` → telegram fires `inline_query` → you answer with up to 50 results → **the user's client sends the chosen result as its own message**. the bot is not in the send path:

- you never receive the resulting message, its `message_id`, or the target chat. the only handle you'll ever hold is `inline_message_id` — key persistence on it (or on your own `result_id`). one exception: in groups the bot is a member of, the inline-sent message also arrives as a regular `message` update (with `via_bot` set) — never in private chats between other users
- `inline_message_id` exists **only if the result carried an inline keyboard** — "available only if there is an inline keyboard attached to the message" ([ChosenInlineResult](https://core.telegram.org/bots/api#choseninlineresult); same rule on `SentWebAppMessage`). no button → no id on `chosen_inline_result` *and* no id on future `callback_query` → the message is permanently untouchable
- `chosen_inline_result` is **off by default** — enable inline feedback via @botfather (`/setinlinefeedback`). it's a probability (0–100%): anything below 100% randomly samples. telegram itself says [feedback is for analytics](https://core.telegram.org/api/bots/inline#inline-feedback): "feedback collection should only be used for statistical purposes rather than functional"
- even at 100%, feedback is lossy: cached re-sends (`cache_time`), choices by anonymous group admins, and scheduled messages never produce `chosen_inline_result`. design for the update *not* arriving
- one answer per query id. re-answering — or answering slower than ≈10s (community figure, not documented) — fails with 400 `query is too old and response timeout expired or query ID is invalid`. every keystroke can fire a fresh query that supersedes the last, so treat that error as noise, not failure
- results are cached server-side per query text for `cache_time` seconds (default **300**) and shared across users unless `is_personal: true`. dev-loop tip: `cache_time: 0`
- pagination: set `next_offset` (≤64 bytes) — the next page arrives as a new `inline_query` carrying it in `offset`; query text itself caps at 256 chars
- `switch_pm_*` is gone — `button: InlineQueryResult.button(text, { startParameter | webApp })` renders above the results; `startParameter` deep-links into a `/start` pm
- `query.chatType` gives the chat *kind* (`sender` | `private` | `group` | `supergroup` | `channel`) — good for filtering result sets, useless for identity (which you never learn). may be absent (secret chats). `query.from` is always the real user, even for anonymous admins

### deferred heavy work — placeholder now, content on `chosen_inline_result`

while the user types you serve many queries that never get picked. don't render the expensive thing per keystroke — answer with cheap placeholders and do the real work only for the result actually sent:

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
      id: query.query,
      title: `render "${query.query}"`,
      content: InputMessageContent.text('rendering…'),
      // without a keyboard there is no inline_message_id — the message would be uneditable forever
      replyMarkup: keyboard
    })
  ]
}))

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

requirements: feedback probability at **100%**, and every placeholder carries an inline keyboard — both for the `inline_message_id` and for the callback fallback.

### editing inline messages

- every `editMessage*` method accepts `inline_message_id` *instead of* `chat_id` + `message_id`
- edits of inline messages return `true`, never a `Message` — after the edit you still know nothing new
- `editMessageMedia` on an inline message **cannot upload**: "a new file can't be uploaded; use a previously uploaded file via its file_id or specify a URL" ([editMessageMedia](https://core.telegram.org/bots/api#editmessagemedia)). upload assets ahead of time (e.g. to a dump channel) and reuse `file_id`s — `@puregram/media-cacher` automates the bookkeeping
- inline messages can **never be deleted** — `deleteMessage` has no `inline_message_id` parameter. the convention is a tombstone edit: `editMessageText` to neutral text, `reply_markup` omitted to strip the keyboard
- no documented time limit on editing them (the 48h notes in the docs concern business messages and `deleteMessage`)

### inline result constraints (non-cached types)

| type | gotcha |
|---|---|
| all url types | urls are handed to clients — "must be assumed to be public" |
| photo | jpeg only, ≤5 mb, thumbnail url required |
| gif / mpeg4Gif | thumbnail url required (jpeg/gif/mp4 mime) |
| video | mime required; `text/html` embeds (youtube etc.) **require** `input_message_content` |
| document | pdf and zip only |
| sticker | cached-only — no url variant exists |

`InlineQueryResult.cached.*` take `file_id`s and drop the url restrictions. mixing media and article results in one answer renders poorly in most clients.

## custom emoji — who can actually send them

the gate ([formatting options](https://core.telegram.org/bots/api#formatting-options)): "custom emoji entities can only be used by bots that purchased additional usernames on fragment, **or in the messages directly sent by the bot to private, group and supergroup chats if the owner of the bot has a telegram premium subscription**". channels are excluded from the premium-owner path; fragment has no carve-outs.

- **failure is silent.** an unentitled bot gets no error — the server strips the entity and only the plain fallback emoji shows. custom emoji "not working" is almost always the gate, not your code
- the entity must wrap a real emoji character (server-enforced), so degradation is always graceful: notifications, non-premium forwards, and stripped sends all show the fallback. use `Sticker.emoji` from `getCustomEmojiStickers` as the fallback char
- **initial inline results ignore custom emoji** — but *editing* the inline message afterwards applies them, since the edit is a message directly sent by the bot (community-verified — [gramio docs](https://gramio.dev/formatting) — not spelled out officially). combine with the deferred pattern above: plain-emoji placeholder → edit in the custom-emoji entities on `chosen_inline_result` / first `callback_query`
- receiving is ungated: every bot sees incoming `custom_emoji` entities and resolves them with `getCustomEmojiStickers` (≤200 ids per call)
- clients render at most ~100 animated custom emoji per message (`message_animated_emoji_max` app config); the rest fall back
- other surfaces: keyboard-button icons (`icon_custom_emoji_id`, 9.4, same gate); poll questions/options accept **only** `custom_emoji` entities and nothing else; forum-topic icons must come from the `getForumTopicIconStickers` whitelist; a reaction may use a custom emoji only if it's already on the message or explicitly admin-allowed — and bots set at most one reaction, never paid ones

build them with `@puregram/markup`'s `customEmoji(fallback, id)` (the default path), `@puregram/rich`'s `rich.customEmoji(id, alt)` inside a rich message, or core's `HTML.emoji(fallback, id)` / `MarkdownV2.emoji(fallback, id)` when you're stuck on `parse_mode` — never hand-assemble the entity.

## editing & deleting — the actual rules

- only messages **without a reply keyboard** are editable: "it is currently only possible to edit messages without reply_markup or with inline keyboards" ([updating messages](https://core.telegram.org/bots/api#updating-messages))
- `editMessageText` / `editMessageCaption` **drop the existing inline keyboard** unless you re-pass `reply_markup` on every edit (universally corroborated; absent from the official docs). markup-only change → `editMessageReplyMarkup`
- a no-op edit is an error: 400 `message is not modified: specified new message content and reply markup are exactly the same...`. diff before editing, or suppress exactly that error
- bots edit their **own** messages with no time limit — the 48h window applies to users and to business messages ("business messages that were not sent by the bot and do not contain an inline keyboard can only be edited within 48 hours"). but bot-side message storage is ephemeral ("older messages may be removed by the server shortly after they have been processed"), so an old `message_id` can still 400 with `message to edit not found`
- album members are type-locked: "only to an audio for audio albums, only to a document for document albums and to a photo, a live photo, or a video otherwise". replacing a *text* message with media works; media → text never does
- `deleteMessage` limits (the [full list](https://core.telegram.org/bots/api#deletemessage) is worth one read): 48h general ceiling — even for the bot's own messages; incoming messages deletable only in private chats; admin rights (`can_delete_messages`) lift the limits within that chat; a dice in a private chat deletes only *after* 24h. `deleteMessages` batches ≤100 ids and silently skips missing ones
- live-updating uis (progress bars) share the flood budget — community figure ~20 edits/min per group; batch redraws (`@puregram/throttler` shapes this)

## update delivery — what never arrives by default

- the `allowed_updates` default **excludes** `chat_member`, `message_reaction`, and `message_reaction_count` ([getUpdates](https://core.telegram.org/bots/api#getupdates)). reaction and member handlers silently never fire until you subscribe explicitly — `UpdatesFilter.all()`, `'auto'`, or a literal list in `startPolling` / webhook options
- the setting is sticky server-side: "if not specified, the previous setting will be used" — a list set by an old deploy survives until overwritten, and a new list only affects updates created *after* the call
- reactions additionally require the bot to be an **admin** of the group/channel. `message_reaction` = identified per-user changes; `message_reaction_count` = anonymous totals, "grouped and can be sent with delay up to a few minutes". your own `setMessageReaction` calls never echo back. reacting to an album lands on its first non-deleted message
- **privacy mode** ([features](https://core.telegram.org/bots/features#privacy-mode)): a non-admin group bot receives only commands addressed to it, replies to its messages, messages sent via it inline, and service messages — plain group chatter never arrives. admin bots receive everything. toggling `/setprivacy` **requires removing and re-adding the bot** to each existing group. corollary: free-text prompts (`@puregram/flow`, `@puregram/scenes`) silently break in privacy-mode groups — use `ForceReply` (replies always route to the bot), buttons, or admin rights
- each group message is delivered to at most **one** privacy-enabled bot (replies take priority), and bots never see other bots' messages
- bots can't dm first: 403 `bot can't initiate conversation with a user` until the user messages the bot once — an inline-button press or shared group membership is not enough. deep-link them into a `/start` (`t.me/yourbot?start=payload`) when you need a pm channel
- 403 `bot was blocked by the user` on send = unsubscribe signal — flag the user and stop; there's no way to detect a block beforehand
- undelivered updates are kept server-side for max 24h. polling and webhook are mutually exclusive: webhook set → `getUpdates` returns 409; a second concurrent poller kills the first with 409 `terminated by other getUpdates request`

## callback queries — the short window

- answering is mandatory — clients spin "until you call answerCallbackQuery" ([CallbackQuery](https://core.telegram.org/bots/api#callbackquery)); `autoAnswerCallbackQuery: true` is the safety net
- the query id expires fast (≈10s, community figure): late or duplicate answers fail with 400 `query is too old and response timeout expired or query ID is invalid`. answer *first*, then do the slow work
- `callback_data` is 1–64 **bytes**, not characters — multi-byte utf-8 shrinks the budget (`@puregram/callback-data` packs binary within it)
- `answerCallbackQuery`'s `url` opens only game urls (from `callback_game` buttons) and `t.me/yourbot?start=...` deep links — arbitrary urls don't open
- `cache_time` on the answer caches it client-side — repeat presses may never reach the bot

## forum topics — the General trap

- the General topic has id **1**, but sends to it must **omit** `message_thread_id` — passing `1` fails with 400 `message thread not found`. incoming General-topic messages carry no `message_thread_id` at all (`update.thread` models this correctly: it exists only when the id is present)
- don't treat `message_thread_id` as a topic id unless `is_topic_message` is true — replies in General can carry a reply-thread root that is not a topic
- topic ids are the `message_id` of the topic-creation service message — topics and messages share one chat-wide id sequence
- closed topics reject sends until reopened; creating/editing/closing topics needs `can_manage_topics`

## `parse_mode` silently wins over `entities`

the docs only say entities "can be specified instead of `parse_mode`" ([sendMessage](https://core.telegram.org/bots/api#sendmessage)) — they never say what happens when both arrive. measured against the live api, `parse_mode` wins and the `entities` array is **discarded**:

- `{ text: 'hello world', entities: [{ type: 'bold', offset: 0, length: 5 }] }` → the returned message carries the bold entity
- the same call plus `parse_mode: 'HTML'` → `entities: undefined`. no error, no formatting. identical under `MarkdownV2`, and identical for `caption` / `caption_entities` on `sendPhoto`
- `{ text: '<b>tags</b> plus entity', entities: [{ type: 'italic', … }], parse_mode: 'HTML' }` → comes back `"tags plus entity"` with a **bold** entity: the tags were parsed, the supplied italic entity thrown away

so a `defaultParams: { '*': { parse_mode: 'HTML' } }` left over from before `@puregram/markup` strips formatting from every send — and when the entity text happens to contain a `<` or a MarkdownV2 reserved char, the send 400s with `can't parse entities` instead. one or the other, never both.

## entity offsets are utf-16

`MessageEntity` offsets/lengths count [utf-16 code units](https://core.telegram.org/api/entities#entity-length), not code points: bmp chars = 1, astral chars (nearly all emoji) = 2, flags = 4, zwj sequences more. js `string.length` / `.slice()` already measure utf-16, so plain js math happens to be correct — but code-point counting (`[...str].length`) is wrong for this. in practice you rarely hand-build entities: the `HTML` / `Markdown` helpers, `@puregram/markup`, and `@puregram/rich` compute offsets for you.
