---
name: telegram-inline-mode
description: >
  use when building or debugging telegram inline mode in any language or SDK: `inline_query`,
  `answerInlineQuery`, `InlineQueryResult*`, `InputMessageContent`, `chosen_inline_result`,
  `inline_message_id`, switch-inline buttons, `InlineQueryResultsButton`, caching, pagination,
  and the other producers of "inline messages" (`answerWebAppQuery`,
  `savePreparedInlineMessage`, `answerGuestQuery`). covers the ~10-second answer deadline, why
  the bot never learns the chat, when `inline_message_id` exists, editing inline messages (no
  delete, no upload, keyboard dropped on edit), validation errors, and the deferred-render
  pattern. measured live on bot api 10.3.
---

# telegram inline mode

the user types `@yourbot query` in **any** chat. telegram sends the bot an `inline_query`, the
bot answers with up to 50 results, the user picks one, and **the user's client sends it** into
the chat as the user's own message ("via @yourbot"). the bot is not in that send path:

```
user types "@yourbot cats"
  → inline_query { id, from, query: "cats", offset: "", chat_type }
  → answerInlineQuery(id, results[≤ 50], cache_time, is_personal, next_offset, button)   // ~10 s
user picks a result
  → the chat gets the user's message "via @yourbot"
  → chosen_inline_result { result_id, from, query, inline_message_id? }   // only if feedback is on
  → later: callback_query { inline_message_id, chat_instance }            // only if it has buttons
```

exact fields: `node <telegram-bot-api skill>/tools/botapi.mjs answerInlineQuery InlineQuery
ChosenInlineResult`, all result types: `botapi.mjs InlineQueryResult`, "what accepts a result":
`botapi.mjs refs InlineQueryResult`.

> **measured** = observed against the live bot api 10.3 (oct 2026) using a bot plus a real user
> account.

## setup

- `/setinline` in @BotFather (placeholder text) → `getMe.supports_inline_queries: true`
- `/setinlinefeedback` → the share of choices reported as `chosen_inline_result`. **0% by default.**
  "feedback collection should only be used for statistical purposes rather than functional"
  (MTProto docs), and caching makes it lossy even at 100%
- `/setinlinegeo` → `inline_query.location` (users are asked to share location)

## the query

```json
{ "id": "412343030053409", "from": { "id": 96006, "first_name": "devour" },
  "chat_type": "supergroup", "query": "shape", "offset": "" }
```

- `query` ≤ 256 chars. every pause in typing can fire a new query, so cheap answers win
- `chat_type` is the **kind** of chat, never its identity. **measured**: `"sender"` in the private
  chat with the bot itself, `"private"` in a private chat between two users and in Saved Messages,
  `"supergroup"` in a group whether or not the bot is a member. it can be missing (secret chats)
- `from` is always the real user, even for anonymous admins
- you never learn the chat id, the message id, or who else is in the chat

## answering

| rule | detail (**measured** where marked) |
|---|---|
| deadline | **~10 s**. answered at 9 s: delivered. at 12 s: the bot gets `query is too old and response timeout expired or query ID is invalid`, and the user's client already got `BOT_RESPONSE_TIMEOUT` at ~10.1 s and shows nothing (**measured**) |
| one answer per query | a second `answerInlineQuery` for the same id returns `ok: true` but is **ignored**: the user sees the first answer (**measured**) |
| ≤ 50 results | 51 → `Bad Request: too many inline query results specified` (**measured**) |
| unique result ids, 1–64 bytes | duplicate → `Bad Request: RESULT_ID_DUPLICATE` (**measured**) |
| `next_offset` ≤ 64 bytes | 65 → `Bad Request: NEXT_OFFSET_INVALID` (**measured**). `""` = no more pages |
| `cache_time` (default 300 s) | while cached, an identical query **never reaches the bot**: the client got the cached answer in ~0.2 s (**measured**). use `cache_time: 0` while developing |
| `is_personal` | cache per user instead of shared. **measured**: without it, a second user typing the same text got the *first user's* personalized result and the bot never saw the query; with it, the second user's query reached the bot, and the first user's repeat came from their own cache. required whenever results depend on the user |
| URLs | every URL in a result goes to the client: "must be assumed to be public" |

pagination: when the user scrolls past the results, the same query arrives again with `offset =
your next_offset` (**measured**: page 1 answered with `next_offset: "cur:2"`, page 2 arrived with
`offset: "cur:2"`). encode a cursor, not a page number, if the data can shift.

`button` (an `InlineQueryResultsButton`) shows above the results: `start_parameter` opens the
private chat with `/start <param>` (for auth or setup flows), `web_app` opens a mini app that can
return with `switchInlineQuery`. the docs say exactly one of the two, but an answer with both was
accepted with `ok: true` (**measured**), so don't rely on the server to catch that mistake.

### result types in one paragraph

URL results (`photo`, `gif`, `mpeg4_gif`, `video`, `audio`, `voice`, `document`) make telegram
fetch the file. photos are jpeg ≤ 5 MB with a required thumbnail, documents only PDF/ZIP, and
`text/html` videos (embeds) need `input_message_content`. `cached_*` variants take a `file_id`
and skip all of that; stickers exist only as cached results. `article` + `input_message_content`
is the generic "send this text / location / venue / contact / invoice / **rich message**" result.
`botapi.mjs InlineQueryResultPhoto` etc. give the exact fields.

rich results (`InputRichMessageContent`) may only use **already uploaded** media: a never-seen image
URL in the rich markdown is rejected at answer time with `Bad Request: EXTERNAL_MEDIA_NOT_SUPPORTED`
(**measured**). a URL telegram happened to fetch before was accepted, but don't rely on that. upload
once, then reference the file (see `telegram-rich-messages` for `tg://photo?id=` and friends).

## after the user picks a result: the inline message

the sent message belongs to the user. the bot's only handle is `inline_message_id`, and it
**exists only if the result carried an inline keyboard** (**measured**: the result with a keyboard
came back with `inline_message_id`, the one without came back with none). no keyboard → the
message can never be touched again.

- `chosen_inline_result` needs feedback enabled. even at 100% it skips cached re-sends and some
  other cases, so don't build features on it
- a button press arrives as `callback_query { inline_message_id, chat_instance, data }`, with **no
  `message` and no chat**. this is the reliable recovery path for the id
- if the bot is a **member** of the chat where the result was sent, it also gets the message as a
  normal `message` update with `via_bot` set (**measured** in a group). from a private chat between
  users the bot gets no copy (**measured**)

### editing inline messages

- `editMessageText` / `editMessageCaption` / `editMessageMedia` / `editMessageReplyMarkup` /
  `editMessageLiveLocation` / `stopMessageLiveLocation` take `inline_message_id` **instead of**
  `chat_id` + `message_id` and return `true`, never a `Message`
- **a text edit without `reply_markup` removes the keyboard** (**measured**, for inline and regular
  messages). re-send it on every edit. a keyboard-only change → `editMessageReplyMarkup`
- a no-op edit → `Bad Request: message is not modified: specified new message content and reply
  markup are exactly the same as a current content and reply markup of the message` (**measured**)
- `editMessageMedia` on an inline message can't upload: use a `file_id` or a URL
- **no delete**: no delete method accepts `inline_message_id`. "delete" = edit to a tombstone and
  drop the keyboard
- inline messages get no ephemeral messages (no chat id). a private reaction to a press =
  `answerCallbackQuery({ text, show_alert: true })`

## the inline-message family

four methods take an `InlineQueryResult` and produce a message addressed only by
`inline_message_id`. everything in the section above applies to all of them:

| producer | who sends | id returned |
|---|---|---|
| `answerInlineQuery` → user picks | the user, "via @bot" | in `chosen_inline_result` / callbacks, only with a keyboard |
| `answerWebAppQuery` (mini app) | the user, "via @bot", in the private chat where the mini app was opened | `SentWebAppMessage.inline_message_id`, only with a keyboard (**measured**: `{}` without one) |
| `savePreparedInlineMessage` → mini app `shareMessage` | the user | later, through callbacks |
| `answerGuestQuery` (guest mode) | **the bot**, as a reply to the summoner | always, in `SentGuestMessage` |

## switch-inline buttons

| button field | effect | not available |
|---|---|---|
| `switch_inline_query` | pick a chat, then insert `@bot <query>` there | channel DMs, business messages |
| `switch_inline_query_current_chat` | insert `@bot <query>` in this chat | channels, channel DMs, business messages |
| `switch_inline_query_chosen_chat` | pick a chat of the allowed types (`allow_user_chats`, `allow_bot_chats`, `allow_group_chats`, `allow_channel_chats`) | channel DMs, business messages |

## recipes

### deferred heavy work

while the user types, most queries are never chosen, so don't render the expensive thing for each
keystroke:

```
inline_query → answer [article "render <query>" with content "rendering…" + keyboard [refresh]],
               cache_time 0                                          // cheap, within 10 s
chosen_inline_result(inline_message_id) → render → editMessageText(inline_message_id, result,
                                                                   same keyboard)
callback_query(inline_message_id)       → same render path           // covers lost feedback
```

needs feedback at 100% **and** a keyboard on every placeholder.

### per-user results

any result that depends on who asks (their files, their settings, auth state) → `is_personal:
true`, or one user's results get served to another user who types the same text.

### custom emoji

all **measured** with a bot whose owner has Premium:

| where | custom emoji entity | button `icon_custom_emoji_id` |
|---|---|---|
| group / private chat, direct send | kept | kept (with `style`) |
| channel, direct send | **silently stripped** | **silently dropped** |
| inline result as first sent | **stripped** | — |
| the same inline message, edited by the bot | applied | — |

so: placeholder with plain emoji → edit in the custom-emoji entities on `chosen_inline_result` /
the first callback. a bot without entitlement (no Fragment username, owner without Premium) gets
them stripped everywhere, with no error.

## mini app producers

### mini app queries (`answerWebAppQuery`)

- `web_app_query_id` is the `query_id` from the mini app's **initData** (a short base64-style
  string such as `AAEGdwEAAAAAAAZ3AQBUEHq6`). the numeric MTProto query id doesn't work: it gets
  `query is too old and response timeout expired or query ID is invalid` (**measured**)
- one answer per query; a second one gets the same error (**measured**)
- `web_app` **inline** buttons only work in private chats: in a group, `sendMessage` fails with
  `Bad Request: BUTTON_TYPE_INVALID` (**measured**)

### prepared inline messages (`savePreparedInlineMessage`)

- at least one `allow_*_chats` flag is required: none → `Bad Request: at least one chat type must
  be allowed` (**measured**)
- the id belongs to `user_id`: another user fetching it gets `ID_EXPIRED` (**measured**). it expires
  after about an hour (`expiration_date`; the client saw a 3598 s cache time)
- the `allow_*` flags are a **client-side** filter: a client that ignores them could send a
  users-only prepared message into a group (**measured** with a raw MTProto client). don't treat
  them as a security boundary

## with puregram

`tg.onInlineQuery((query) => query.answer([...], { cache_time }))`, results via
`InlineQueryResult.article({ id, title, content: InputMessageContent.text(…), replyMarkup })`, and
`chosen.hasInlineMessageId()` / `query.hasInlineMessageId()` guards on the follow-ups. see
`using-puregram` and its `reference/recipes.md`.

## related

- `telegram-guest-mode`: the bot-posted member of the inline-message family
- `telegram-ephemeral-messages`: why inline callbacks can't go ephemeral
- `telegram-rich-messages`: `InputRichMessageContent` in results
- `telegram-bot-api`: live lookup
