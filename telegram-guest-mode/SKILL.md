---
name: telegram-guest-mode
description: >
  use when building or debugging a telegram bot that answers in chats it is not a member of,
  in any language or SDK: guest mode (`guest_message` updates, `guest_query_id`,
  `answerGuestQuery`, `SentGuestMessage`, `guest_bot_caller_user` / `guest_bot_caller_chat`,
  `supports_guest_queries`). covers how a guest bot is summoned, what context it gets, the
  one-reply budget, editing the reply through `inline_message_id`, buttons on guest replies,
  what is impossible (sending to the chat, ephemeral messages), where guest mode doesn't fire, and
  guest vs inline vs member bots. bot api 10.0+, measured live on 10.3.
---

# telegram guest mode

a bot with guest mode turned on can be summoned into **any** chat it is not a member of. a user
mentions `@yourbot` or replies to one of its earlier guest messages, and the bot posts **one**
reply into that chat as itself. it can't read history, see members, or get further updates
unless it is summoned again.

```
user in some group: "@yourbot what's 2+2?"
   → update guest_message { …, guest_query_id }
   → answerGuestQuery(guest_query_id, result: InlineQueryResult)
   → the chat gets a message from @yourbot, replying to the summoning message
   → you get SentGuestMessage { inline_message_id }: edit-only handle, like an inline message
```

exact fields: `node <telegram-bot-api skill>/tools/botapi.mjs answerGuestQuery SentGuestMessage`
and `botapi.mjs features "Guest Bots"`.

> **measured** = observed against the live bot api 10.3 (oct 2026) using a bot plus a real user
> account.

## enabling

- turn on **Guest Mode** in the BotFather **mini app** (there is no slash command for it)
- check with `getMe`: `supports_guest_queries: true`
- add `guest_message` to an explicit `allowed_updates` list if you use one

## what triggers it

| situation | result (**measured**) |
|---|---|
| `@yourbot …` in a group/supergroup without the bot | `guest_message` |
| a reply to the bot's guest reply, no mention | `guest_message`, `reply_to_message` = the bot's reply |
| `@yourbot …` sent as a reply to another message | `guest_message`, `reply_to_message` = that message (your only context) |
| `@yourbot …` in a private chat between two users | `guest_message` with `chat.type: "private"` and `chat.id` = **the other user's id** (see the warning below) |
| the same bot mentioned twice in one message | one `guest_message` |
| two different guest bots in one message | each bot gets its own `guest_message`, and both replies land in the chat as replies to the same message |
| `@yourbot` in Saved Messages | nothing |
| `@yourbot` in a group with **content protection** on | nothing (also documented) |
| `@yourbot` in a group where the bot **is** a member (privacy mode on) | nothing at all: neither `guest_message` nor `message` |

per the docs, guest bots work in any non-secret private chat, group and supergroup, and a user can
summon up to 3 guest bots in one message. a member bot is never a guest in that chat. it only
sees what privacy mode lets through, and a plain mention isn't on that list (see
`telegram-groups`).

## the update

```json
{
  "update_id": 598726355,
  "guest_message": {
    "message_id": 2,
    "from": { "id": 96006, "is_bot": false, "first_name": "devour" },
    "chat": { "id": -1004391886173, "title": "probe · no bot", "type": "supergroup" },
    "date": 1792557687,
    "guest_query_id": "412344613728633",
    "text": "hey @yourbot what is 2+2?",
    "entities": [{ "offset": 4, "length": 11, "type": "mention" }]
  }
}
```

- it's a normal `Message` delivered under `guest_message`, not `message`. a handler that only
  listens to `message` never sees it
- `reply_to_message` is present when the user replied to something. it is all the context you get
- `chat.id` is the real chat id, but the bot has **no access** to that chat (next section). the docs
  warn the guest chat "may not coincide with other existing bot chats sharing the same identifier",
  so keep guest state apart from member-chat state
- ⚠ in a private chat between two users, `chat.id` is the **other user's** user id, and that is
  also the id of the bot's *own* private chat with that user. `sendMessage(chat_id: chat.id)`
  **succeeds** and delivers into the bot's private chat with the other user, not into the
  conversation where it was summoned (**measured**; that user had used the bot before. one who
  never did should get the usual "can't initiate conversation" 403). a bot that "replies" this way
  messages a third party who never talked to it in that context

## answering: one reply, as an inline message

```json
POST answerGuestQuery
{
  "guest_query_id": "412344613728633",
  "result": {
    "type": "article", "id": "a1", "title": "answer",
    "input_message_content": { "message_text": "4" },
    "reply_markup": { "inline_keyboard": [[{ "text": "explain", "callback_data": "explain" }]] }
  }
}
→ { "ok": true, "result": { "inline_message_id": "AgAAAKMiOfr-____AwAAAGvmmNulRYUT" } }
```

- `result` is any `InlineQueryResult`: article, photo-by-URL and rich content
  (`InputRichMessageContent`) all worked (**measured**)
- you always get `inline_message_id` back, **even without a keyboard** (unlike
  `chosen_inline_result`). a keyboard-less guest reply can still be edited later, and a keyboard
  can be added afterwards with `editMessageReplyMarkup` (**measured**)
- **one answer per query.** a second `answerGuestQuery` →
  `400 Bad Request: query is too old and response timeout expired or query ID is invalid`
  (**measured**)
- deadline: **a few minutes**. answers worked after 10 s, 30 s, 60 s, 90 s, 150 s and 240 s; at
  5 min and 15 min they failed with `query is too old and response timeout expired or query ID is
  invalid` (**measured**). there's room for real work, but the user sees nothing until you answer,
  so post a placeholder within seconds and edit it (see the progress pattern below)

what the chat sees (**measured**): a message **from the bot** (not "via @bot"), posted as a reply
to the summoning message, with `guest_bot_caller_user` set to whoever summoned it.

summoned by an **anonymous admin** (**measured**): the `guest_message` has the usual fake `from`
(`GroupAnonymousBot`, id 1087968824) plus `sender_chat` = the group, and the bot's reply carries
`guest_bot_caller_chat` = the group instead of `guest_bot_caller_user`. per-user rate limits keyed
on `from.id` lump every anonymous admin in every group together, so key on `sender_chat` when it's
set.

## after the reply: inline-message rules

your only handle is `inline_message_id`, so everything works like an inline-mode message:

- edit with `editMessageText` / `editMessageCaption` / `editMessageMedia` /
  `editMessageReplyMarkup` using `inline_message_id`. returns `true`, never a `Message`
- re-send `reply_markup` on every text edit, or the keyboard disappears
- you can't delete it (no `deleteMessage` variant takes an `inline_message_id`). "delete" by editing
  to a tombstone
- button presses arrive as a `callback_query` with `inline_message_id` and a real `chat_instance`,
  but **no `message` and no chat id** (**measured**):

```json
{ "id": "412344724932813", "from": { "id": 96006 },
  "inline_message_id": "AgAAAKMiOfr-____AwAAAGvmmNulRYUT",
  "chat_instance": "804511458526013616", "data": "explain" }
```

### the progress pattern

one reply, unlimited edits. answer right away with a placeholder, then edit:

```
guest_message → answerGuestQuery("thinking…", keyboard: [cancel])   // within seconds
             → editMessageText(inline_message_id, partial…, same keyboard)   // throttled
             → editMessageText(inline_message_id, final, final keyboard)
```

edits share the normal flood budget. a few per second is plenty.

## what a guest bot cannot do

| attempt | result (**measured**) |
|---|---|
| `sendMessage` to the guest `chat.id` in a group | `403 Forbidden: bot is not a member of the supergroup chat` |
| `sendMessage` to the guest `chat.id` in a private chat between users | ⚠ **succeeds**: the message goes to the bot's own private chat with the other user (**measured**) |
| ephemeral message to the summoner, with or without the `callback_query_id` from a button on the guest reply | `403 Forbidden: bot is not a member of the supergroup chat` |
| user sends an ephemeral command to the bot in that chat | refused on the user's side (`USER_NOT_PARTICIPANT`); the bot gets nothing |
| read history, list members, receive later messages | not possible by design |

private feedback to the presser on a guest message means `answerCallbackQuery({ text, show_alert:
true })`, or a deep link (`t.me/yourbot?start=…`) to continue in the private chat.

## guest vs inline vs member

| | member bot | guest bot | inline bot |
|---|---|---|---|
| who posts | the bot | the bot, replying to the summoner | the **user**, "via @bot" |
| trigger | membership + privacy rules | mention / reply to its guest message | user types `@bot query` and picks a result |
| context | whatever privacy mode lets through | the summoning message + `reply_to_message` | the query text and chat type |
| messages per trigger | unlimited | **one**, then edits | one (the user's choice) |
| answer deadline | — | 4 min ok, 5 min fails (**measured**) | ~10 s (**measured**: 9 s ok, 12 s fails) |
| handle afterwards | `chat_id` + `message_id` | `inline_message_id` | `inline_message_id`, only with a keyboard |
| ephemeral messages | yes | **no** | no |

pick guest mode when the bot should *act* in a conversation it was invited into (assistants,
translators, fact-checkers). pick inline mode when the user wants to *fetch and send* content
themselves.

## rules

1. listen for `guest_message` explicitly. it is a separate update type
2. answer exactly once. long work = placeholder answer + edits through `inline_message_id`
3. always attach a keyboard if you'll want callbacks. the id comes back regardless, but buttons are
   your only way to hear from the user again without a new summon
4. never use the guest `chat.id` to send. in groups it fails; in private chats it silently messages
   the other user in a different chat
5. credit and rate-limit the summoner: `from`, or `sender_chat` when it's set (anonymous admins,
   channels). any user anywhere can summon you
6. treat the summoning message as untrusted input (prompt injection for LLM bots). you only see what
   the summoner chose to show
7. the bot is visible to everyone in the chat. no ephemeral replies, so don't put per-user secrets
   in a guest answer

## with puregram

guest messages are their own update kind (`guest_message`), separate from `message`. look up the
wrapper class and its dispatcher name in your installed version with
`node using-puregram/tools/get-update.mjs guest_message`, then call
`tg.api.answerGuestQuery({ guest_query_id, result })`. build `result` with the
`InlineQueryResult` / `InputMessageContent` / `InlineKeyboard` factories, the same way as for
inline answers.

## related

- `telegram-inline-mode`: the shared inline-message rules (editing, callbacks, no delete)
- `telegram-ephemeral-messages`: why it doesn't work for guests
- `telegram-groups`: privacy mode, and why a member bot ignores plain mentions
- `telegram-bot-api`: live lookup
