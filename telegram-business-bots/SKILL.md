---
name: telegram-business-bots
description: >
  use when a telegram bot is connected to a user's account as a business / secretary bot, in any
  language or SDK: `business_connection`, `business_message`, `edited_business_message`,
  `deleted_business_messages`, `business_connection_id` on send/edit/delete calls,
  `BusinessBotRights`, `readBusinessMessage`, `deleteBusinessMessages`, account management
  (name, bio, photo, username, gifts, stars, stories). covers enabling Secretary Mode, the
  connection lifecycle (rights changes, disconnect, reconnect), what the bot sees and who the
  other side thinks wrote, which rights each call needs, misleading error strings, the chat-id
  namespace trap, and recipes. measured live on bot api 10.3.
---

# telegram business bots

a user connects a bot to their own account (Settings → Telegram Business → Chatbots). the bot then
receives that account's private conversations and, if allowed, answers **as the user**. every
call on the account's behalf carries a `business_connection_id`.

```
user connects the bot            → business_connection { id, user, user_chat_id, rights, is_enabled }
someone writes to the user       → business_message { business_connection_id, chat, from, … }
bot answers as the user          → sendMessage { business_connection_id, chat_id, text }
                                   → the other side sees a message from the *user*
user changes rights / disconnects → business_connection again (same id; is_enabled false on disconnect)
```

exact fields: `node <telegram-bot-api skill>/tools/botapi.mjs BusinessConnection BusinessBotRights`
and `botapi.mjs features "Business Bots"`.

> **measured** = observed against the live bot api 10.3 (oct 2026). test setup: a bot connected to
> a real account with recipients limited to one contact, who sent messages, edited, deleted and
> pressed buttons.

## enabling

- @BotFather → `/mybots` → bot → **Bot Settings → Secretary Mode → Turn on** (the features page calls
  it Secretary Mode; there is no separate "business mode" toggle). check with `getMe`:
  `can_connect_to_business: true` (**measured**)
- since 10.0 the connecting user no longer needs Telegram Premium
- subscribe to `business_connection`, `business_message`, `edited_business_message` and
  `deleted_business_messages` if you pass an explicit `allowed_updates` list. a stale list
  silently drops them
- the user picks **recipients** (all/existing/new chats, contacts, non-contacts, or specific
  people, with exclusions) and **rights** when connecting. the bot only ever sees the chats the user
  selected

## the connection

```json
{ "business_connection": {
    "id": "641iW1WeyEoEFQAAO1NXQh6VRn4",
    "user": { "id": 96006, "first_name": "devour", "is_premium": true },
    "user_chat_id": 96006,
    "date": 1792561546,
    "is_enabled": true,
    "rights": { "can_reply": true, "can_read_messages": true, "can_delete_sent_messages": true,
                "can_delete_all_messages": true, "can_view_gifts_and_stars": true } } }
```

**measured** lifecycle:

| event | update |
|---|---|
| connect | `business_connection`, `is_enabled: true` |
| user changes rights | `business_connection` again, **same `id`**, new `rights` |
| all rights removed | still `is_enabled: true`, `rights: {}`. messages **keep arriving** |
| disconnect | `business_connection` with `is_enabled: false` and no `rights`; `getBusinessConnection` still answers, with `is_enabled: false` |
| connect again later | a **new** `id`. ids are per connection, not per user |

- `rights` lists only the rights that are on (`True` fields). a missing key means "no"
- an undocumented top-level `can_reply` still arrives next to `rights` (legacy). read
  `rights.can_reply`
- `user_chat_id` is **your bot's private chat with the account owner**: the place to send setup
  messages and alerts to the owner (as the bot, without `business_connection_id`)
- store the latest connection per `id` and check `is_enabled` + the specific right before acting.
  `getBusinessConnection(id)` refreshes it after a restart

## incoming messages

```json
{ "business_message": {
    "business_connection_id": "641iW1WeyEoEFQAAO1NXQh6VRn4",
    "message_id": 61798,
    "from": { "id": 3034249, "first_name": "nihil" },
    "chat": { "id": 3034249, "type": "private", "first_name": "nihil" },
    "text": "hi" } }
```

**measured**:

- `chat` is the account's private chat with the other person, so `chat.id` = **the other person's
  user id**. the reference: such a message "belongs to a chat of the corresponding business account
  that is independent from any potential bot chat which might share the same identifier". the same
  number is also your bot's own private chat with that person. **always key state on
  `(business_connection_id, chat.id)`**, never on `chat.id` alone, and never answer a
  business message without `business_connection_id`
- the **owner's own** outgoing messages (typed by the user in their app) also arrive as
  `business_message`, with `from` = the owner. check `from.id === connection.user.id` before
  "replying" to them
- the bot's own sends on behalf of the account do **not** come back as `business_message`
- edits by the other person → `edited_business_message`. deletions → `deleted_business_messages {
  business_connection_id, chat, message_ids }`
- delivery was usually ~0.5 s, but once an incoming message arrived more than 20 s late. don't infer
  ordering from arrival time
- messages keep arriving with **zero rights**. read-only "inbox mirror" connections are valid, and
  so is a connection the user stripped mid-conversation: check rights before answering
- after disconnecting, nothing more arrives

## acting on the account's behalf

```json
POST sendMessage
{ "business_connection_id": "641iW1WeyEoEFQAAO1NXQh6VRn4", "chat_id": 3034249,
  "text": "thanks, I'll get back to you",
  "reply_parameters": { "message_id": 61798 },
  "reply_markup": { "inline_keyboard": [[{ "text": "book a slot", "callback_data": "book" }]] } }
→ Message { from: <the account owner>, sender_business_bot: <your bot>, business_connection_id, … }
```

- the other person sees a normal message **from the user**. no bot attribution showed up on their
  side (**measured**)
- 51 methods take `business_connection_id`: the `send*` family (text, media, albums, polls, dice,
  checklists, rich messages, paid media), `sendChatAction`, pin/unpin, all `editMessage*`,
  `stopPoll`, `deleteBusinessMessages`, `readBusinessMessage` and the account-management methods.
  **not**: `sendMessageDraft` / `sendRichMessageDraft` (no streaming on behalf of a user),
  `sendInvoice`, `sendGift`. live list: `botapi.mjs search business_connection_id`
- `sendRichMessage` on behalf of the account works (**measured**)
- inline keyboards work. a press arrives as a normal `callback_query` whose `message` carries
  `business_connection_id` and the business `chat` (**measured**), so answer it and edit with the
  same `business_connection_id`
- `reply_parameters.chat_id` (cross-chat replies) and reply keyboards aren't supported for business
  sends (docs); `allow_sending_without_reply` is always true there

### editing

| target | result (**measured**) |
|---|---|
| a message the bot sent on behalf of the account | `editMessageText` with `business_connection_id` works |
| a message the **owner typed themselves** | also editable by the bot (docs: within 48 h unless it has an inline keyboard) |
| either one, **without** `business_connection_id` | `Bad Request: message to edit not found` |

### deleting

| call | result (**measured**) |
|---|---|
| `deleteBusinessMessages` on the bot's own sent message (`can_delete_sent_messages`) | ok; a `deleted_business_messages` update follows for it |
| `deleteBusinessMessages` on the **other person's** message (`can_delete_all_messages`) | ok, and it is **gone for both sides** |
| either without the right | `Bad Request: BOT_ACCESS_FORBIDDEN` |

1–100 ids per call, all from one chat.

## rights → calls

| right | unlocks | without it (**measured** where marked) |
|---|---|---|
| `can_reply` | sending and editing in private chats with an incoming message in the last 24 h | `sendMessage`, `sendChatAction` → `Bad Request: BUSINESS_PEER_INVALID` (**measured**) |
| `can_read_messages` | `readBusinessMessage` (chat active in the last 24 h) | `Bad Request: BUSINESS_PEER_INVALID` (**measured**) |
| `can_delete_sent_messages` / `can_delete_all_messages` | `deleteBusinessMessages` | `Bad Request: BOT_ACCESS_FORBIDDEN` (**measured**) |
| `can_edit_name` / `_bio` / `_profile_photo` / `_username` | `setBusinessAccount*` | `setBusinessAccountBio` → `Bad Request: BOT_ACCESS_FORBIDDEN` (**measured**) |
| `can_view_gifts_and_stars` | `getBusinessAccountGifts`, `getBusinessAccountStarBalance` (worked: `{ "amount": 9 }`, **measured**) | — |
| `can_change_gift_settings`, `can_convert_gifts_to_stars`, `can_transfer_and_upgrade_gifts`, `can_transfer_stars` | gift and stars management | — |
| `can_manage_stories` | `postStory`, `editStory`, `deleteStory`, `repostStory` | — |

`BUSINESS_PEER_INVALID` is the catch-all for "this connection can't act in this chat". it covers a
missing right, a chat outside the user's chosen recipients, and the 24-hour rule. check the
connection's rights and recipients before blaming the chat id.

## the 24-hour rule

`can_reply` covers "private chats that had incoming messages in the last 24 hours". a business bot
can't start conversations or revive old chats on the user's behalf. queue the work and act after
the other person writes again, or notify the owner in `user_chat_id`.

## other bots through a business account

per the docs, a business bot may message other bots in the account's chats if **the business bot**
has bot-to-bot mode on (the other bot doesn't need it). in the test, a send to a bot outside the
connection's recipients failed with `BUSINESS_PEER_INVALID`, which is the recipients filter, so the
bot-to-bot part itself wasn't measured.

## rules

1. key everything on `business_connection_id` + `chat.id`. the same `chat.id` also names your bot's
   own private chat with that person
2. check `from.id` against the connection's `user.id`: the owner's own messages arrive too
3. check `is_enabled` and the specific right before each action, and handle a rights change
   mid-conversation (same `id`, new `rights`)
4. treat a disconnect as final: a reconnect brings a new id. drop per-connection state on
   `is_enabled: false`
5. you're speaking as a person. the other side can't tell a bot wrote it, so keep automated
   replies obviously scoped (away messages, booking flows) and follow section 5.4 of the bot
   developer terms
6. talk to the owner through `user_chat_id`, never through the managed chats
7. no drafts, no invoices on behalf of the user. stream into the owner's chat with the bot instead,
   or send the finished message

## recipes

### away replies with a handoff

```
business_message (from ≠ owner, owner offline by your own schedule)
  → sendMessage(bcid, chat, "I'm away until 10:00. leave a note?", keyboard [urgent])
callback_query "urgent" (message.business_connection_id present)
  → answerCallbackQuery
  → sendMessage(chat_id: connection.user_chat_id, "urgent from <name>")   // to the owner, as the bot
```

### inbox triage, read-only

connect with **no** rights → every `business_message` still arrives → classify / summarize → send
the digest to `user_chat_id`. nothing is ever sent as the user.

## with puregram

`tg.onBusinessMessage(message => message.reply('…'))` answers on the same connection: every update
shortcut (`send`, `reply`, `edit*`, `pin`, `sendChatAction`, …) fills in `business_connection_id`
when the message has one. outside an update, `tg.business(connectionId)` returns a scoped api that
adds it to every call (a call-site value still wins). to message the owner as the bot, use plain
`tg.api` with `chat_id: connection.user_chat_id`. see `using-puregram`.

## related

- `telegram-groups`: bot-to-bot rules (business sends need only the sender's mode)
- `telegram-rich-messages`: rich content on behalf of the account
- `telegram-bot-api`: live lookup
