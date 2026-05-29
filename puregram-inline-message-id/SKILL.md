---
name: puregram-inline-message-id
description: >
  use when working with `@puregram/inline-message-id` — TL parser for telegram
  `inline_message_id` strings. zero puregram deps, drop-in for any node 22+
  project. covers `InlineMessageId.from` / `.kind` / `.dcId` / `.messageId` /
  `.chatId` (legacy) / `.ownerId` (modern) / `.accessHash`, `toString`
  round-trip, the legacy (20-byte `inputBotInlineMessageID`) vs modern
  (24-byte `inputBotInlineMessageID64`) wire shapes, the free-function api
  (`parseInlineMessageId` / `serializeInlineMessageId` / type guards), and
  `InlineMessageIdParseError`.
metadata:
  author: nitreojs
  source: https://github.com/puregram/puregram/tree/v3/packages/inline-message-id
  package: "@puregram/inline-message-id@3"
---

# `@puregram/inline-message-id`

decoder for telegram's `inline_message_id` strings. every inline message your bot sends carries one — the opaque base64url-looking string you get on `chosen_inline_result` and pass to `editMessageText` / `editMessageReplyMarkup` / `editMessageMedia`. it's not really opaque: it's a TL-serialized blob from [TDLib](https://core.telegram.org/tdlib)'s `inputBotInlineMessageID` / `inputBotInlineMessageID64`, with the dc, chat or owner id, message id, and access hash packed inside.

zero `puregram` bindings, zero runtime deps. drop it into any node 22+ project — it's just a parser.

## when to use this skill

- you're handling `chosen_inline_result` updates and want to know which dc / chat / owner each inline message lives on
- you're building inline-bot analytics — distribution across dcs, fraction of legacy vs modern ids, etc.
- you're inspecting what telegram actually gave you back from `answerInlineQuery` (the `inline_message_id` is the only handle you keep — the rest is opaque on the bot api side)
- you need a stable identity for an inline message (`messageId + ownerId/chatId` survives serialization, the raw `inline_message_id` is just bytes)
- you're researching telegram internals — the two wire shapes, the legacy mtproto chat-id quirk, etc.
- you're decoding inline ids in a non-puregram context (analytics worker, log enrichment) — no `Telegram` instance needed

## quick start

a tiny inline bot that reports which dc and which user each chosen inline result lives on:

```ts
import { Telegram, InlineQueryResult, InputMessageContent, InlineKeyboard } from 'puregram'
import { InlineMessageId } from '@puregram/inline-message-id'

const DC_NAMES: Record<number, string> = {
  1: 'Miami, FL, USA',
  2: 'Amsterdam, NL',
  3: 'Miami, FL, USA',
  4: 'Amsterdam, NL',
  5: 'Singapore'
}

const tg = Telegram.fromToken(process.env.TOKEN!)

tg.onInlineQuery((q) => q.answer({
  cache_time: 0,
  results: [
    InlineQueryResult.article({
      id: '1',
      title: 'send a tagged message',
      content: InputMessageContent.text('tap the button — i\'ll decode the inline_message_id'),
      // inline_message_id is only emitted when the result carries a reply markup
      reply_markup: InlineKeyboard.keyboard([InlineKeyboard.textButton({ text: 'ping', payload: 'ping' })])
    })
  ]
}))

tg.onChosenInlineResult((u) => {
  const raw = u.raw.inline_message_id

  if (raw === undefined) return

  const id = InlineMessageId.from(raw)

  console.log(`dc ${id.dcId} (${DC_NAMES[id.dcId] ?? '?'}) — ${id.kind} form`)

  if (id.kind === 'legacy') {
    console.log(`  chat_id=${id.chatId}, message_id=${id.messageId}`)
  } else {
    console.log(`  owner_id=${id.ownerId}, message_id=${id.messageId}`)
  }
})

await tg.startPolling()
```

## `InlineMessageId.from(string)` — parse an `inline_message_id`

```ts
import { InlineMessageId } from '@puregram/inline-message-id'

const id = InlineMessageId.from('AgAAAH4AAAAtAQAAAAAAAA')

id.kind        // 'legacy' | 'modern'
id.dcId        // 2
id.messageId   // 301
id.chatId      // 126         — legacy form only; `undefined` for modern
id.ownerId     // undefined   — modern form only; bigint, `undefined` for legacy
id.accessHash  // bigint
id.raw         // the discriminated parsed payload
```

re-encode via `id.toString()` — round-trips losslessly back to the original base64url string.

## the two wire shapes

telegram emits two flavours of `inline_message_id`, distinguished by decoded byte length:

| length | TL type | exposed kind |
|---|---|---|
| 20 | `inputBotInlineMessageID` | `'legacy'` |
| 24 | `inputBotInlineMessageID64` | `'modern'` |

**legacy (20 bytes)** packs the message info as `dcId: int32`, `id: int64`, `accessHash: int64`. the middle `id` long encodes the signed legacy chat id in its high 32 bits and the message id in its low 32 bits. produced by older clients and for chats whose ids still fit in int32.

**modern (24 bytes)** splits the fields out: `dcId: int32`, `ownerId: int64`, `messageId: int32`, `accessHash: int64`. produced for inline-bot-only messages and for chats whose owner id outgrew int32.

> the legacy form's `chatId` is the **mtproto** chat id (32-bit, signed), not the bot api's `chat.id` you receive on updates — the bot api adds the `-100<peer_id>` prefix for groups/channels. don't compare these directly

## free-function api

if you'd rather work with the discriminated union directly:

```ts
import {
  parseInlineMessageId,
  serializeInlineMessageId,
  isLegacyInlineMessageId,
  isModernInlineMessageId
} from '@puregram/inline-message-id'

const parsed = parseInlineMessageId(raw)

if (isLegacyInlineMessageId(parsed)) {
  // narrowed to { kind: 'legacy', dcId, id, accessHash }
}

const encoded = serializeInlineMessageId(parsed)
// round-trips back to the original base64url string
```

| class | function |
|---|---|
| `InlineMessageId.from(s)` | `parseInlineMessageId(s)` |
| `id.toString()` | `serializeInlineMessageId(raw)` |

## errors

`parseInlineMessageId` and `InlineMessageId.from` throw `InlineMessageIdParseError` on:

- empty / non-string input
- input that isn't valid base64url
- decoded byte length other than 20 or 24

the error carries the offending `input` on the `.input` property for logging:

```ts
import { InlineMessageId, InlineMessageIdParseError } from '@puregram/inline-message-id'

try {
  InlineMessageId.from('garbage')
} catch (error) {
  if (error instanceof InlineMessageIdParseError) {
    console.error(`bad inline_message_id: ${error.message}`, error.input)
  }
}
```

## exported surface

```ts
import {
  InlineMessageId,
  parseInlineMessageId,
  serializeInlineMessageId,
  isLegacyInlineMessageId, isModernInlineMessageId,
  InlineMessageIdParseError
} from '@puregram/inline-message-id'

import type {
  LegacyInlineMessageId,
  ModernInlineMessageId,
  ParsedInlineMessageId
} from '@puregram/inline-message-id'
```

- **`ParsedInlineMessageId`** — discriminated union of `LegacyInlineMessageId | ModernInlineMessageId`
- **`LegacyInlineMessageId`** — `{ kind: 'legacy', dcId, id, accessHash }`
- **`ModernInlineMessageId`** — `{ kind: 'modern', dcId, ownerId, messageId, accessHash }`

## see also

- main skill: `using-puregram` — covers `tg.onInlineQuery` / `tg.onChosenInlineResult`, `InlineQueryResult.*`, `InputMessageContent.*`, `InlineKeyboard`
- sibling: `puregram-file-id` — the matching TL parser for `file_id` and `file_unique_id`
- sibling: `puregram-callback-data` — typed `callback_data` payloads (the other "decode the opaque telegram string" plugin, but for buttons not inline messages)
- package source: [`packages/inline-message-id/`](https://github.com/puregram/puregram/tree/v3/packages/inline-message-id)
