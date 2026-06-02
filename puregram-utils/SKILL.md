---
name: puregram-utils
description: >
  use when working with `@puregram/utils` — a small standalone grab-bag of
  helpers for puregram v3. covers `getCasinoValues(value)` slot-machine
  decoder, `WebApp.validate` / `generateSecretKey` / `parseInitData` /
  `generateInitDataHash` for telegram web app init-data verification,
  `parseCommand(text)` for `/command[@bot] [args...]` strings, and the
  `deepLink.*` builder namespace (start, startGroup, startChannel, startApp,
  startAttach, attachInChat, game, share, videoChat) for typed
  `https://t.me/...` deep-links with validated inputs.
metadata:
  author: nitreojs
  source: https://github.com/puregram/puregram/tree/v3/packages/utils
  package: "@puregram/utils@3"
---

# `@puregram/utils`

a small grab-bag of standalone helpers that don't belong in `puregram` core. no plugin glue, no `Telegram` instance required — every export is a plain function or namespace you can drop anywhere.

right now it covers four areas: slot-machine dice decoding, telegram web app `initData` validation, bot-command string parsing, and a typed `t.me` deep-link builder.

## when to use this skill

- you handle `🎰` dice updates and want to know which symbols landed on each wheel
- you serve a telegram web app and need to verify `initData` server-side before trusting the user fields
- you're parsing `/command@bot args...` strings by hand and want a tested helper instead
- you're building `https://t.me/<bot>?start=...` / `?startgroup=...` / `?startapp=...` links and want input validation (bot username format, payload charset, admin-rights enum, etc) at construction time
- you need a `deepLink.share` / `deepLink.videoChat` / `deepLink.attachInChat` builder for attachment-menu or livestream flows

## quick start

```ts
import { Telegram } from 'puregram'
import { getCasinoValues, CasinoValue } from '@puregram/utils'

const tg = Telegram.fromToken(process.env.TOKEN!)

tg.onMessage((message) => {
  if (message.hasDice() && message.dice.emoji === '🎰') {
    const [a, b, c] = getCasinoValues(message.dice.value)

    if (a === CasinoValue.Seven && b === a && c === a) {
      return message.send('🎉 jackpot — three sevens!')
    }

    return message.send(`you got ${a}, ${b}, ${c}`)
  }
})

await tg.startPolling()
```

## `getCasinoValues(source)` — slot-machine decoder

when telegram delivers a `🎰` dice, `dice.value` is an integer in `1..64` that encodes the three symbols on the wheels. `getCasinoValues(value)` returns the actual `[left, middle, right]` triple:

```ts
import { getCasinoValues, CasinoValue } from '@puregram/utils'

const symbols = getCasinoValues(64)
// → readonly [CasinoValue.Seven, CasinoValue.Seven, CasinoValue.Seven] (jackpot)
```

`source` accepts a `number` or numeric string. the return is a typed 3-tuple of `CasinoValue`:

| member | string value |
|---|---|
| `CasinoValue.Bar` | `'bar'` |
| `CasinoValue.Grapes` | `'grapes'` |
| `CasinoValue.Lemon` | `'lemon'` |
| `CasinoValue.Seven` | `'seven'` |

## `WebApp` — telegram web app initData validation

when your bot opens a [web app](https://core.telegram.org/bots/webapps), the page receives an `initData` query string containing user identity, auth date, and a `hash` that proves it came from telegram (signed with your bot token). before you trust *any* of those fields server-side, you have to verify the hash.

### simple — pass the token, get true/false

```ts
import { WebApp } from '@puregram/utils'

const valid = WebApp.validate({
  initData: req.body.initData,
  token: process.env.TOKEN!
})

if (!valid) {
  res.status(401).end()
  return
}
```

### hot-path — derive the HMAC key once

`WebApp.validate` derives the key on every call. for high-rps endpoints, derive once at boot and pass `key` instead — the HMAC step is the expensive part:

```ts
const KEY = WebApp.generateSecretKey(process.env.TOKEN!)

app.post('/api/me', (req, res) => {
  if (!WebApp.validate({ initData: req.body.initData, key: KEY })) {
    return res.status(401).end()
  }
})
```

returns a `Buffer`. cache it — re-deriving per request burns cpu.

### lower-level helpers

`WebApp.parseInitData(initData)` — `URLSearchParams` shortcut, returns the fields as a plain `Record<string, string>`. don't trust the values until you've called `validate`.

`WebApp.generateInitDataHash(initData, key)` — recompute the expected hash by hand, for custom flows (rate limiting on hash mismatches, error reporting with the expected/actual pair, etc.):

```ts
const expected = WebApp.generateInitDataHash(initData, KEY)
const actual = WebApp.parseInitData(initData).hash

if (expected !== actual) { /* tampered */ }
```

### `WebApp.validate(params)` reference

| field | type | description |
|---|---|---|
| `initData` | `string` | the raw query string from `Telegram.WebApp.initData` (not `initDataUnsafe`) |
| `key` | `Buffer` | pre-derived HMAC key. mutually exclusive with `token` |
| `token` | `string` | bot token; derives the key on every call |
| `throwError` | `boolean` | when `true`, throws on mismatch instead of returning `false`. default `false` |

returns `true` when the hash matches, `false` otherwise. always throws synchronously when `initData` is missing the `hash` field — that's a malformed input, not a hash mismatch.

## `parseCommand(text)` — parse `/command[@bot] [args...]`

returns a structured breakdown of a telegram bot command string, or `null` for non-commands:

```ts
import { parseCommand } from '@puregram/utils'

parseCommand('/buy')
// → { command: 'buy', bot: undefined, args: [], rest: '' }

parseCommand('/buy@my_bot apples 5 fresh')
// → { command: 'buy', bot: 'my_bot', args: ['apples', '5', 'fresh'], rest: 'apples 5 fresh' }

parseCommand('/start ref_abc123_with_underscores')
// → { command: 'start', bot: undefined, args: ['ref_abc123_with_underscores'], rest: 'ref_abc123_with_underscores' }

parseCommand('hello')   // null — no leading slash
parseCommand('/')       // null — no command name
parseCommand('  /buy')  // null — telegram commands never have leading whitespace
```

`args` is `rest.split(/\s+/).filter(Boolean)`; `rest` is everything after the command (and optional `@bot`) with leading whitespace trimmed. bot usernames are validated against the telegram rule `[a-zA-Z0-9_]{5,32}`.

## `deepLink` — typed `t.me` builders

a namespace of strict builders for every t.me deep-link the bot api recognizes — see [core.telegram.org/api/links](https://core.telegram.org/api/links). each helper validates inputs (username format, payload charset, admin-rights enum, etc.) and **throws** on invalid input rather than emitting a link the telegram client would reject.

```ts
import { deepLink } from '@puregram/utils'

// bot starts
deepLink.start({ bot: 'my_bot' })
// → 'https://t.me/my_bot'

deepLink.start({ bot: 'my_bot', payload: 'ref_42' })
// → 'https://t.me/my_bot?start=ref_42'

// add bot to a group (optionally as admin)
deepLink.startGroup({ bot: 'my_bot', payload: 'invite' })
// → 'https://t.me/my_bot?startgroup=invite'

deepLink.startGroup({ bot: 'my_bot', admin: ['post_messages'] })
// → 'https://t.me/my_bot?startgroup&admin=post_messages'

// channels require admin rights
deepLink.startChannel({ bot: 'my_bot', admin: ['post_messages', 'edit_messages'] })
// → 'https://t.me/my_bot?startchannel&admin=post_messages+edit_messages'

// mini-app — main or named, with optional launch mode
deepLink.startApp({ bot: 'my_bot', payload: 'page_42', mode: 'fullscreen' })
// → 'https://t.me/my_bot?startapp=page_42&mode=fullscreen'

deepLink.startApp({ bot: 'my_bot', app: 'tictactoe', payload: 'room_7' })
// → 'https://t.me/my_bot/tictactoe?startapp=room_7'

// attachment menu — in the bot's own chat or in a chosen one
deepLink.startAttach({ bot: 'my_bot', choose: ['users', 'groups'] })
// → 'https://t.me/my_bot?startattach&choose=users+groups'

deepLink.attachInChat({ chat: { username: 'durov' }, bot: 'my_bot', payload: 'p' })
// → 'https://t.me/durov?attach=my_bot&startattach=p'

// games, share dialogs, video chats / livestreams
deepLink.game({ bot: 'my_bot', name: 'tetris' })
deepLink.share({ url: 'https://example.com', text: 'check this!' })
deepLink.videoChat({ username: 'mychannel', hash: 'abc123', live: true })
```

### validation rules

- **bot username** — `[A-Za-z][A-Za-z0-9_]{4,31}` (telegram's 5-32 char rule)
- **start / startgroup / startapp / startattach payload** — 1-64 chars of `[A-Za-z0-9_-]` (base64url). these are **not url-encoded** — they must already be in the allowed charset
- **admin rights** — must be from the closed `AdminRight` set: `change_info`, `post_messages`, `edit_messages`, `delete_messages`, `restrict_members`, `invite_users`, `pin_messages`, `manage_topics`, `promote_members`, `manage_video_chats`, `anonymous`, `manage_chat`, `post_stories`, `edit_stories`, `delete_stories`, `manage_direct_messages`
- **mini-app mode** — `'compact'` or `'fullscreen'`
- **choose targets** — subset of `'users'`, `'bots'`, `'groups'`, `'channels'`
- **phone** (for `attachInChat`) — digits only, no `+` prefix
- **share url / text** — free-form; these *are* `encodeURIComponent`-escaped

## peer id conversion — bot api ↔ mtproto

telegram clients, `t.me/c/…` links, and mtproto libs (mtcute, gramjs) use *bare*
mtproto ids. the bot api uses *marked* ids where the sign / `-100…` prefix encodes
the peer kind. these helpers convert and classify without a `getChat` call

```ts
import {
  parsePeerId, toMtprotoId, toBotApiId,
  getPeerType, isUserId, isChatId, isChannelId
} from '@puregram/utils'

parsePeerId(-1001234567890) // { type: 'channel', id: 1234567890 }
toMtprotoId(-1001234567890) // 1234567890
toBotApiId(1234567890, 'channel') // -1001234567890
getPeerType(-987654321)     // 'chat'
isChannelId(-1001234567890) // true
```

mapping: user `id` (positive) ↔ bare `id`; basic group `-id` ↔ bare `id`;
supergroup/channel `-1000000000000 - id` ↔ bare `id`

caveats:
- `type` is coarse — `'channel'` is **supergroup OR broadcast channel** (same
  `-100…` marking, indistinguishable from the id alone)
- converting helpers throw `PeerIdError` on `0`, `-1000000000000`, non-integers,
  unsafe integers (and `toBotApiId` on a non-positive bare id); `isXId` guards
  return `false` instead
- ranges are lenient (no upper-bound check) so future telegram id-ceiling bumps
  keep working
- plain `number` throughout — every valid id fits inside `Number.MAX_SAFE_INTEGER`

## exported surface

```ts
import {
  getCasinoValues, CasinoValue,
  WebApp,
  parseCommand,
  deepLink,
  parsePeerId, toMtprotoId, toBotApiId,
  getPeerType, isUserId, isChatId, isChannelId,
  PeerIdError
} from '@puregram/utils'

import type {
  AdminRight,
  AttachChatTarget,
  AttachChooseTarget,
  ParsedCommand,
  ParsedPeerId,            // { type, id }
  PeerType,                // 'user' | 'chat' | 'channel'
  SlotMachineValue,        // readonly [CasinoValue, CasinoValue, CasinoValue]
  StartOpts, StartGroupOpts, StartChannelOpts,
  StartAppOpts, StartAttachOpts,
  AttachInChatOpts,
  GameOpts, ShareOpts, VideoChatOpts,
  WebAppMode,              // 'compact' | 'fullscreen'
  WebAppValidateParams
} from '@puregram/utils'
```

## see also

- main skill: `using-puregram` — covers `message.hasDice()` and dice-update handling
- sibling: `puregram-callback-data` — typed `callback_data` payloads, the other "structured t.me-flow" plugin (start payloads are often paired with callback flows)
- package source: [`packages/utils/`](https://github.com/puregram/puregram/tree/v3/packages/utils)
