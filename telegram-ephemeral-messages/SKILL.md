---
name: telegram-ephemeral-messages
description: >
  use when a telegram bot needs to show something to one member of a group without the rest of
  the chat seeing it, in any language or SDK: ephemeral messages (`ephemeral_message_parameters`,
  `receiver_user_id`, `callback_query_id`, `replace_callback_query_message`), ephemeral commands
  (`BotCommand.is_ephemeral`), replies to ephemeral messages, and the `editEphemeralMessage*` /
  `deleteEphemeralMessage` family. covers the two delivery modes (15-second triggered vs admin),
  where it works and where it fails, the silent public-message traps, every error string, and
  recipes. bot api 10.2+, measured live on 10.3.
---

# telegram ephemeral messages

an ephemeral message is a message in a group or supergroup that only one member and the bot can
see. it goes both ways:

- **ephemeral messages** (bot → user): any of 14 send methods with `ephemeral_message_parameters`
- **ephemeral commands** (user → bot): a command the user sends that nobody else in the chat sees,
  other bots included

delivery is best-effort. the message "may disappear automatically after some time, or if the app
is restarted", and "it is not guaranteed that the ephemeral message will be received, especially
if the user is offline". in the Telegram app (tester's observation): an ephemeral stays as long as
the app keeps running and is **gone after an app restart**, and an admin-sent ephemeral shows up on
**all** of the user's devices.

exact fields at any time: `node <telegram-bot-api skill>/tools/botapi.mjs EphemeralMessageParameters
"Ephemeral Messages and Commands"`.

> facts marked **measured** were observed against the live bot api 10.3 (oct 2026) using a bot plus
> a real user account. everything else is quoted from the reference.

## where it works

| chat | result |
|---|---|
| supergroup / group, bot is a **member** | works (see the delivery modes) |
| private chat with the bot | `400 Bad Request: BOT_NOT_ADMIN` (**measured**; the error name is misleading) |
| channel, bot is an admin | `400 Bad Request: BOT_NOT_ADMIN` (**measured**) |
| chat where the bot is only a **guest** (guest mode) | `403 Forbidden: bot is not a member of the supergroup chat`, including with a `callback_query_id` from a button on the bot's own guest reply (**measured**) |
| inline-mode message | impossible: inline callbacks carry `inline_message_id` and no `chat_id` |

the bot has to be a member of the group. ephemeral messages never reach a chat the bot only
visits through guest mode or inline mode. for a private reveal on an inline or guest message, use
`answerCallbackQuery({ text, show_alert: true })`.

## the two delivery modes

| | triggered | admin-initiated |
|---|---|---|
| who can use it | any member bot | a bot that is a chat **administrator** |
| what it needs | `callback_query_id` of a fresh callback **or** `reply_parameters.ephemeral_message_id` of a fresh incoming ephemeral | nothing |
| window | **15 s** after the trigger | any time |
| receiver | must be the user who triggered it: another member → `RECEIVER_ID_INVALID` (**measured** with two real users) | any non-bot **member**: a bot → `RECEIVER_ID_INVALID`, a non-member → `USER_NOT_PARTICIPANT` (**measured**) |
| delivered to | "the exact client application that triggered the action" | "may be delivered across multiple active client applications … not guaranteed to be delivered to any of them" |
| non-admin bot without a trigger | `400 Bad Request: BOT_NOT_ADMIN` (**measured**) | — |

**measured** details:

- `can_send_welcome_messages` is **not** required: an admin bot without it sent untriggered
  ephemerals fine. (only tested with ordinary rights like delete/pin/invite present, so "admin with
  zero rights" is unverified)
- callback trigger at 16.5 s → `400 Bad Request: query is too old and response timeout expired or
  query ID is invalid`
- reply trigger: works at 12 s, `400 Bad Request: REPLY_TO_INVALID` at 16.5 s
- one trigger can carry **several** ephemerals inside its window
- answering the callback first does **not** use up the trigger. `answerCallbackQuery` followed by an
  ephemeral send with the same `callback_query_id` still works

## sending

```json
POST sendMessage
{
  "chat_id": -1001234567890,
  "text": "only you can see this",
  "ephemeral_message_parameters": {
    "receiver_user_id": 96006,
    "callback_query_id": "412344376448377",
    "replace_callback_query_message": false
  }
}
```

the documented list: `sendMessage`, `sendPhoto`, `sendLivePhoto`, `sendAudio`, `sendDocument`,
`sendVideo`, `sendAnimation`, `sendVoice`, `sendVideoNote`, `sendLocation`, `sendVenue`,
`sendContact`, `sendSticker`, `sendRichMessage`. what the others do with the parameter
(**measured**):

| method | result |
|---|---|
| `sendMediaGroup` | ⚠ **ignored: the album is posted publicly**, `ok: true`, real `message_id`s |
| `copyMessage` | works as an ephemeral, but returns only `{ "message_id": 0 }`: no `ephemeral_message_id`, so you can never edit or delete it |
| `forwardMessage` | `400 Bad Request: can't use forwarded message` |
| `sendDice`, `sendPoll`, `sendInvoice`, `sendPaidMedia` | `400 Bad Request: unallowed message content specified` |

for a private album, send the items one by one, or use a rich message with a collage/slideshow
block (`sendRichMessage` with `ephemeral_message_parameters` works; so does editing it to plain text
and back, and `editEphemeralMessageReplyMarkup`, all **measured**).

the returned `Message`:

```json
{
  "message_id": 0,
  "ephemeral_message_id": 76970000,
  "chat": { "id": -1003979618164, "type": "supergroup", "title": "…" },
  "from": { "id": 8688444190, "is_bot": true, "username": "yourbot" },
  "receiver_user": { "id": 96006, "is_bot": false, "first_name": "devour" },
  "date": 1792557220,
  "text": "only you can see this"
}
```

- `message_id` is always `0`. the handle is the triple **(chat_id, receiver_user_id,
  ephemeral_message_id)**
- ids look random (`76970000`, `30414056`, `3471311`), not sequential, and "may be reused for
  another ephemeral message after the message is deleted or expires". don't use one as a
  long-lived database key
- **check the result.** `message_id: 0` + `ephemeral_message_id` means it went out ephemeral. a real
  `message_id` means everyone in the chat saw it (see the reply trap below)

pre-10.3 SDKs that send a flat top-level `receiver_user_id` still get an ephemeral message on 10.3
(**measured**). this is undocumented backward compatibility: migrate to
`ephemeral_message_parameters`.

### forum topics

`message_thread_id` works as usual (**measured**): an ephemeral sent into a topic shows in that
topic, one without the parameter goes to General, and `message_thread_id: 1` fails with `message
thread not found`, the same General-topic trap as regular sends. an ephemeral command sent inside a
topic arrives with `message_thread_id` and `is_topic_message: true`, and replying with the same
`message_thread_id` keeps the answer in the topic.

### the overlay: `replace_callback_query_message`

with `callback_query_id` + `replace_callback_query_message: true`, the ephemeral is shown **in
place of** the message whose button was pressed, for that user only. the receiver's client gets
it anchored to the original message (`anchor_msg_id` at the MTProto level). everyone else keeps
seeing the original. this makes per-user panels possible on a shared message.

it must be `false` when the button sits on an ephemeral message. telegram rejects that with the
**misleading** `400 Bad Request: query is too old and response timeout expired or query ID is
invalid` (**measured**), even though the same query id is still valid without the flag. edit the
ephemeral instead.

### callbacks still need an answer

an ephemeral send with `callback_query_id` does **not** answer the callback query (**measured**):
the button keeps spinning until you call `answerCallbackQuery`. call it, before or after the send.

## ephemeral commands (user → bot)

```json
POST setMyCommands
{ "commands": [{ "command": "secret", "description": "ask privately", "is_ephemeral": true }],
  "scope": { "type": "all_group_chats" } }
```

the command arrives as a normal `message` update (**measured**):

```json
{
  "message_id": 0,
  "ephemeral_message_id": 256830417,
  "from": { "id": 96006, "is_bot": false },
  "chat": { "id": -1003979618164, "type": "supergroup" },
  "receiver_user": { "id": 8688444190, "is_bot": true, "username": "yourbot" },
  "text": "/secret",
  "entities": [{ "offset": 0, "length": 7, "type": "bot_command" }]
}
```

- detect it with `ephemeral_message_id` present / `message_id === 0`
- `receiver_user` on an **incoming** ephemeral is the **bot**. the user you answer is `from`
- it reaches **privacy-mode, non-admin** bots, even as a bare `/secret` without `@yourbot`
  (**measured**)
- it really is invisible: another member's client got no update at all, and a second **admin**
  bot in the same group (which did receive ordinary messages before and after) didn't receive it
  (**measured**)
- users can only send *commands* ephemerally (`MESSAGE_NOT_COMMAND` otherwise), so the text always
  starts with `/`
- `is_ephemeral` is a client-side hint. the server accepted an ephemeral `/public@yourbot` that was
  never declared ephemeral (**measured**). handle any command arriving either way
- a user's reply to the bot's ephemeral message is itself ephemeral, with `message_id: 0`
- the bot must be a member. to a non-member bot the user's client gets `USER_NOT_PARTICIPANT`
  (**measured**)

## replying to an incoming ephemeral

**pass both** the reply target and the receiver:

```json
POST sendMessage
{
  "chat_id": -1003979618164,
  "text": "here's your private answer",
  "reply_parameters": { "ephemeral_message_id": 256830417 },
  "ephemeral_message_parameters": { "receiver_user_id": 96006 }
}
```

| what you send | result (**measured**) |
|---|---|
| `reply_parameters.ephemeral_message_id` + `ephemeral_message_parameters.receiver_user_id = from.id` | ephemeral reply; `reply_to_message` is the user's command |
| `reply_parameters.ephemeral_message_id` **only** | ⚠ sent as a **public** message with **no reply**. no error |
| `reply_parameters.message_id: 0` | ⚠ public message, no reply, no error |
| `receiver_user_id = receiver_user.id` (the bot) | `400 Bad Request: RECEIVER_ID_INVALID` |
| after the 15 s window | `400 Bad Request: REPLY_TO_INVALID`; `allow_sending_without_reply: true` does not rescue it |

the reply target counts as the trigger, so a **non-admin** bot can reply this way. the docs say
`quote` is ignored for ephemeral replies and `allow_sending_without_reply` is always false.

## buttons on ephemeral messages

a press on an ephemeral message's button arrives as a `callback_query` whose `message` is the
ephemeral (**measured**):

```json
{
  "id": "412346354547056",
  "from": { "id": 96006 },
  "message": { "message_id": 0, "ephemeral_message_id": 39732411, "receiver_user": { "id": 96006 }, "chat": { "id": -1004366210366 }, "…": "…" },
  "chat_instance": "0",
  "data": "ep"
}
```

- `chat_instance` is `"0"` here. don't use it to group per-chat state
- respond with the `editEphemeralMessage*` family (overlay flag off), then `answerCallbackQuery`
- `login_url` buttons are documented as unsupported. in practice they are **silently turned into
  plain `url` buttons** (**measured**), so no login happens

## editing and deleting

| call | notes |
|---|---|
| `editEphemeralMessageText` | `text` or `rich_message` |
| `editEphemeralMessageCaption` | + `show_caption_above_media` (10.3) |
| `editEphemeralMessageMedia` | file_id, URL **and** fresh multipart upload all work on 10.3 (**measured**); the media type may change (photo → animation worked) |
| `editEphemeralMessageReplyMarkup` | markup only |
| `deleteEphemeralMessage` | idempotent: deleting twice returns `true` both times (**measured**) |

all of them take a flat `chat_id` + `receiver_user_id` + `ephemeral_message_id`, return `true`, and
delivery to the user is not guaranteed.

- regular `editMessageText` with `message_id: 0` → `400 Bad Request: message to edit not found`
- wrong receiver, deleted message, or unknown id → `400 Bad Request: MESSAGE_NOT_FOUND`
- a text edit **without** `reply_markup` **removes the keyboard** (**measured**). re-send it on every
  edit
- a no-op edit (same text) **succeeds** and still pushes an edit to the client. there is no
  `message is not modified` error here, so diff first if you edit in a loop

## rules

1. **never let critical content depend on delivery**: captcha answers, one-time codes, the only
   copy of a result. offer a fallback (a deep link to a private chat, `show_alert`)
2. **always pair the reply target with `ephemeral_message_parameters`**. alone it publishes your
   answer to the whole group
3. **verify `message_id === 0`** on every ephemeral send result. an SDK that drops an unknown
   parameter turns a private message public
4. **answer the callback query** yourself. the ephemeral send doesn't
5. **do the slow work after the send.** the trigger dies at 15 s: send a placeholder ephemeral
   right away, then `editEphemeralMessageText` when the result is ready (edits have no window)
6. **key state on (chat, user)**, not on `ephemeral_message_id`
7. **re-send `reply_markup` on every ephemeral edit**
8. **reply to whoever triggered it.** a triggered ephemeral to anyone else is
   `RECEIVER_ID_INVALID`. reaching other members needs admin status

## error catalogue

| description | cause |
|---|---|
| `Bad Request: BOT_NOT_ADMIN` | no trigger and the bot isn't an admin; or the chat is private / a channel |
| `Bad Request: RECEIVER_ID_INVALID` | the receiver isn't the user who triggered it, or is a bot |
| `Bad Request: USER_NOT_PARTICIPANT` | admin-initiated ephemeral to a user who isn't in the chat |
| `Bad Request: query is too old and response timeout expired or query ID is invalid` | callback trigger older than 15 s; **or** `replace_callback_query_message: true` for a button on an ephemeral |
| `Bad Request: REPLY_TO_INVALID` | reply target older than 15 s |
| `Bad Request: unallowed message content specified` | the content type can't be ephemeral (dice, poll, invoice, paid media) |
| `Bad Request: can't use forwarded message` | `forwardMessage` with ephemeral parameters |
| `Bad Request: MESSAGE_NOT_FOUND` | ephemeral edit/delete target gone, wrong receiver, unknown id |
| `Bad Request: message to edit not found` | used `editMessage*` instead of `editEphemeralMessage*` |
| `Forbidden: bot is not a member of the supergroup chat` | guest-mode chat; the bot isn't in it |

## recipes

### private settings panel on a shared message

```
public message with [⚙ settings] button
  → callback_query (cq)
  → sendMessage { ephemeral_message_parameters: { receiver_user_id: cq.from.id,
                    callback_query_id: cq.id, replace_callback_query_message: true },
                  reply_markup: <per-user toggles> }
  → answerCallbackQuery(cq.id)
toggle pressed on the panel (callback from the ephemeral)
  → editEphemeralMessageText { chat_id, receiver_user_id: cq.from.id,
                               ephemeral_message_id: cq.message.ephemeral_message_id,
                               text, reply_markup: <updated toggles> }
  → answerCallbackQuery
```

### `/secret` → private answer, slow backend

```
message with ephemeral_message_id (the command)
  → sendMessage { text: "working…",
                  reply_parameters: { ephemeral_message_id: msg.ephemeral_message_id },
                  ephemeral_message_parameters: { receiver_user_id: msg.from.id } }   // within 15 s
  → … slow work …
  → editEphemeralMessageText { chat_id, receiver_user_id: msg.from.id,
                               ephemeral_message_id: <from the placeholder>, text: result }
```

### admin bot nudges a member

an admin bot can send an untriggered ephemeral to any non-bot member at any time, e.g. a rule
reminder to someone who just joined (`chat_member` / `new_chat_members`). it may reach none of
their devices, so treat it as a hint, not a notice.

## with puregram

`tg.ephemeral(userId, { callbackQueryId?, replaceCallbackQueryMessage? })` returns a scoped api
that adds the nested parameters to send methods and the flat ones to the edit/delete family. inside
a handler for an incoming ephemeral command (`update.isEphemeral()`), `update.send()` / `reply()`
fill in both the receiver and the reply target. that is exactly rule 2. see `using-puregram`.

```ts
// inside a callback handler; chatId = the chat of the message whose button was pressed
await tg.ephemeral(userId, { callbackQueryId: queryId, replaceCallbackQueryMessage: true })
  .sendMessage({ chat_id: chatId, text: 'your settings' })
await query.answer() // the ephemeral send doesn't answer it
```

## related

- `telegram-guest-mode`: why ephemerals don't work in guest chats
- `telegram-groups`: privacy mode, admin status, command scopes
- `telegram-rich-messages`: rich content in `sendRichMessage` / `editEphemeralMessageText`
- `telegram-bot-api`: live lookup of every field mentioned here
