---
name: telegram-groups
description: >
  use when a telegram bot lives in groups or supergroups, in any language or SDK: privacy mode
  (exactly which messages a bot receives), admin vs member bots, commands and command scopes,
  forum topics and the General-topic trap, reply threads in non-forum groups, anonymous admins
  (`GroupAnonymousBot`, `sender_chat`), group → supergroup migration (`migrate_to_chat_id`),
  `my_chat_member` / `chat_member`, and bot-to-bot visibility. measured live on bot api 10.3.
---

# telegram groups

most "my bot ignores messages in the group" and "works in private, breaks in groups" bugs come
from four things: **privacy mode**, **admin status**, **topics**, and **chat identity**
(anonymous admins, migrations). this skill covers all four.

exact fields: `node <telegram-bot-api skill>/tools/botapi.mjs "Determining list of commands"
BotCommandScope ChatMemberUpdated` and `botapi.mjs features "Privacy Mode"`.

> **measured** = observed against the live bot api 10.3 (oct 2026) using a bot plus a real user
> account.

## what the bot receives

a bot in a group is one of:

- **admin** bot: receives **every** message, whatever the privacy setting
- **member** bot with privacy **off**: receives every message. after toggling `/setprivacy`, the
  bot must be **removed and re-added** to each group for the change to apply
- **member** bot with privacy **on** (the default): receives only the messages below

privacy on, not admin (**measured**):

| user sends | delivered? |
|---|---|
| plain text | ✗ |
| `@yourbot hi` (a mention) | ✗ (and no `guest_message` either, since the bot is a member). an **admin** bot gets it as a normal `message`, still no `guest_message` (**measured**) |
| reply to a user's message | ✗ |
| reply to **the bot's** message | ✓ |
| `/cmd@yourbot` | ✓ |
| `/cmd@otherbot` | ✗ |
| bare `/cmd` | ✓ **only for the bot that sent the last bot message** in the chat. with two privacy-mode bots, it went to exactly that one and not the other (**measured**) |
| an ephemeral command `/cmd` (bare or suffixed) | ✓ (see `telegram-ephemeral-messages`) |
| service messages, messages sent via the bot inline | ✓ (documented) |

with two privacy-mode bots in one group, each message went to **one** of them (**measured**):

| user sends | goes to |
|---|---|
| bare `/help` | only the bot that spoke last |
| `/help@B` | B |
| **a reply to A's message** containing `/help@B` | ⚠ **only A**: the reply wins over the explicit `@B`, and B never sees its own command |
| a reply to B's message containing bare `/help` (A spoke last) | B |
| a plain reply to A | A |

consequences:

- conversational flows that wait for free text silently break in privacy-mode groups. ask with
  **`ForceReply`** (replies to the bot always arrive), use buttons, or make the bot an admin
- a plain `@mention` doesn't reach a member bot. tell users to reply to the bot or use a command
- always generate commands with the `@yourbot` suffix in groups (help texts, buttons with
  `switch_inline_query_current_chat`), so they reach this bot even when another bot spoke last.
  and don't expect `/cmd@yourbot` typed as a reply to *another* bot's message to reach you

### updates that need admin and an opt-in

| update | requirement |
|---|---|
| `chat_member` | admin **and** listed in `allowed_updates` (the default list excludes it) |
| `message_reaction`, `message_reaction_count` | admin **and** listed in `allowed_updates` |
| `chat_join_request` | admin with `can_invite_users` |
| `chat_boost`, `removed_chat_boost` | admin |
| `my_chat_member` | always: this is how you learn you were added, removed, promoted or restricted |

`allowed_updates` is **sticky**: an omitted value keeps the previous setting, and an old explicit
list silently filters out update types added later (e.g. `guest_message`,
`stopped_message_generation`).

## commands

- names: 1–32 chars, lowercase letters, digits, underscores. up to 100 per scope + language
- `setMyCommands` scopes: `default`, `all_private_chats`, `all_group_chats`,
  `all_chat_administrators`, `chat`, `chat_administrators`, `chat_member`. the client shows the
  first list that is set, in the order `botapi.mjs "Determining list of commands"` prints (most
  specific scope first, each with `language_code` before without)
- updates **never say which scope** a command came from, and users can type commands that aren't
  in any list. **check the sender's rights on the server side**; the menu is only a hint
- `BotCommand.is_ephemeral` (10.2) marks a command as sent ephemerally. the server doesn't enforce
  it, so handle every command arriving either way

## topics

### forum supergroups

| action | result (**measured**) |
|---|---|
| send with `message_thread_id: 1` (General's id) | `400 Bad Request: message thread not found` |
| send **without** `message_thread_id` | lands in General; the returned message has no `message_thread_id` |
| `createForumTopic` | `{ message_thread_id: 4, name, icon_color }`: topic ids come from the chat's message id sequence |
| send with the topic's id | `message_thread_id: 4`, `is_topic_message: true` |
| incoming message in General (or a reply inside General) | **no** `message_thread_id`, no `is_topic_message` |
| incoming message in a topic | `message_thread_id: 4`, `is_topic_message: true` |

rules: to reply "in the same place", copy `message_thread_id` only when `is_topic_message` is
true, and omit it for General. topic management needs `can_manage_topics`. closed topics reject
sends until reopened.

### reply threads in ordinary supergroups

in a **non-forum** supergroup, a reply carries `message_thread_id` = the id of the thread's root
message, **without** `is_topic_message` (**measured**: root 9 → reply had `message_thread_id: 9`).
it isn't a topic. passing it back as a topic id is wrong. `is_topic_message` is the only reliable
"this is a topic" signal.

### private-chat topics

since 9.3 a bot can have topics in its private chats (enabled in @BotFather; `getMe.
has_topics_enabled`). `message_thread_id` works there for sends, chat actions and drafts.

## who sent it: anonymous admins, channels, migrations

### anonymous admins

an admin posting anonymously arrives as (**measured**):

```json
{ "from": { "id": 1087968824, "is_bot": true, "first_name": "Group", "username": "GroupAnonymousBot" },
  "sender_chat": { "id": -1004366210366, "type": "supergroup", "title": "…" } }
```

- `from` is a **fake** user kept for backward compatibility. never check rights or rate-limit by
  `from.id` when `sender_chat` is set
- `sender_chat.id === chat.id` → an anonymous admin. treat it as "some admin", because you can't
  tell which one. for actions that need a specific person, ask them to repeat non-anonymously or
  use a button (a `callback_query.from` is always the real user)
- `sender_chat` being a **channel** → a post auto-forwarded from the linked channel
  (`is_automatic_forward`) or a user posting as their channel

### group → supergroup migration

a basic group becomes a supergroup (admin toggles, history visibility, size), and **the chat id
changes** (**measured**):

```
old chat (-5206862960, type group):         message { migrate_to_chat_id: -1004397763075 }
new chat (-1004397763075, type supergroup): message { migrate_from_chat_id: -5206862960 }
sendMessage(old id) → 400 "Bad Request: group chat was upgraded to a supergroup chat",
                      parameters: { migrate_to_chat_id: -1004397763075 }
```

handle both: update stored ids when you see `migrate_to_chat_id` in a message, **and** on that
error read `parameters.migrate_to_chat_id`, update storage, and retry. ids are up to 52 bits:
int64 / double, never int32.

## admin rights checklist

| feature | needs |
|---|---|
| seeing all messages | admin, or privacy off + re-add |
| deleting others' messages | `can_delete_messages` |
| ban / restrict | `can_restrict_members` |
| pins | `can_pin_messages` |
| topics | `can_manage_topics` |
| join requests (approve/decline, the update) | `can_invite_users` |
| member tags (9.5) | `can_manage_tags` |
| untriggered ephemeral messages | admin status; `can_send_welcome_messages` not needed (**measured**) |

read the bot's actual rights from the latest `my_chat_member` (`new_chat_member` is
`ChatMemberAdministrator` with the `can_*` flags) or `getChatMember(chat, botId)`. don't assume.

## bot-to-bot (10.0)

bots normally don't see other bots' messages. **Bot-to-Bot Communication Mode** is a per-bot
switch in the @BotFather mini app. measured with two bots (A sends, B receives; **measured** on
10.3):

| A sends | both modes on | only A's mode on | both off |
|---|---|---|---|
| `/cmd@B` in a group (B = privacy-mode member) | ✓ | ✓ | ✗ |
| reply to B's message in a group | ✓ | ✓ | the send itself fails: `Bad Request: message to be replied not found` (A can't see B's message) |
| plain text in a group, B = privacy-mode member | ✗ | — | — |
| plain text in a group, B = **admin** | ✓ (B's mode on) | ✗ (B's mode off) | — |
| `sendMessage(chat_id: "@B")` or B's numeric id, private | ✓, arrives as a private `message` from A | `400 Bad Request: USER_BOT_TO_BOT_DISABLED` both ways | `USER_BOT_TO_BOT_DISABLED` |

so in groups, mentions and replies need the mode on **either** bot. "see every bot message"
needs the **receiving** bot's mode on plus admin (or privacy off, per the docs). private chats need
**both**. business-connection sends need only the sender's mode (docs, not measured).

- give a freshly promoted bot a few seconds. a message sent ~2 s after promoting a bot to admin
  didn't reach it; later messages did (**measured**)
- you **must** implement loop prevention: dedupe, per-bot rate limits, a maximum interaction depth
  or timeout. "your bot must remain stable even if another bot intentionally responds instantly and
  continuously"

## rules

1. decide up front: admin bot (sees everything) or privacy-mode member (sees commands + replies).
   design the UX for that
2. prompts in groups use `ForceReply` or buttons, never "just type it"
3. authorize on the server. command menus and scopes are cosmetic
4. `sender_chat` beats `from`. a set `sender_chat` means `from` is fake
5. General topic = no `message_thread_id`. topic = `is_topic_message: true`
6. handle migration both ways (service message + error parameters)
7. explicit `allowed_updates` lists must be updated when you start using new update types

## related

- `telegram-ephemeral-messages`: private messages inside groups
- `telegram-guest-mode`: answering in groups the bot is not in
- `telegram-bot-api`: live lookup
