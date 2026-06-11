---
name: puregram-file-id
description: >
  use when working with `@puregram/file-id` — TL parser for telegram `file_id`
  and `file_unique_id` strings. zero puregram deps, drop-in for any node 22+
  project. covers `FileId.from` / `FileUniqueId.from`, `.dcId` / `.fileType` /
  `.accessHash` / `.fileReference` / `.hasReference` / `.hasWebLocation`,
  `toString` round-trip, `toUniqueId`, `PhotoSizeSource` discriminated union
  (legacy / thumbnail / dialog_photo_small / dialog_photo_big /
  sticker_set_thumbnail), type guards, the `FileType` enum, the free-function
  api, `FileIdParseError` / `UnsupportedFileIdVersionError`, and the low-level
  rle + base64url + TL primitives.
metadata:
  author: starkow
  source: https://github.com/puregram/puregram/tree/v3/packages/file-id
  package: "@puregram/file-id@3"
---

# `@puregram/file-id`

decoder for telegram's `file_id` and `file_unique_id` strings. those opaque base64url-looking blobs aren't really opaque — they're TL-serialized [TDLib](https://core.telegram.org/tdlib) payloads carrying the data center, file type, access hash, photo size source, and a few other useful bits. this package reads them, lets you inspect every field, and re-serializes back to the same string.

zero `puregram` bindings, zero runtime deps. drop it into any node 22+ project — it's just a parser.

## when to use this skill

- you want to know which telegram dc a file lives on (analytics, forwarded-content tracing)
- you're deduping uploads across chats by `file_unique_id` and need to know whether two ids point at the same underlying file
- you're branching on file type without keeping a parallel "is this a sticker / animation / video note" flag
- you're inspecting `PhotoSizeSource` to tell a thumbnail apart from a dialog photo or a sticker-set thumbnail
- you're round-tripping a `file_id` for storage normalization (parse → serialize gives you the canonical form)
- you're decoding `file_id`s in a non-puregram context (analytics worker, log enrichment, support tooling) — there's no `Telegram` instance needed
- you're researching telegram internals — sticker-set ids embed the creator's `user_id`, dialog-photo sources carry the chat id, etc. — and want the raw discriminated payload to play with

## quick start

```ts
import { Telegram } from 'puregram'
import { FileId } from '@puregram/file-id'

const DC_NAMES: Record<number, string> = {
  1: 'Miami, FL, USA',
  2: 'Amsterdam, NL',
  3: 'Miami, FL, USA',
  4: 'Amsterdam, NL',
  5: 'Singapore'
}

const tg = Telegram.fromToken(process.env.TOKEN!)

tg.onMessage(async (message) => {
  if (!message.hasPhoto()) return

  const file = FileId.from(message.photo.biggest.fileId)
  const where = DC_NAMES[file.dcId] ?? '?'

  await message.send(`stored on DC ${file.dcId} (${where})`)
})

await tg.startPolling()
```

forwards work the same — the embedded photo's `file_id` keeps the original dc regardless of who forwarded it.

## `FileId.from(string)` — parse a `file_id`

```ts
import { FileId, FileType } from '@puregram/file-id'

const file = FileId.from('AgACAgIAAxkDAAIBcGT...')

file.kind           // 'photo' | 'document' | 'web'
file.fileType       // FileType enum (.Photo / .Sticker / .Animation / …)
file.dcId           // 1..5
file.version        // file_id format major version
file.subVersion     // file_id format minor version
file.accessHash     // bigint
file.fileReference  // Uint8Array | undefined
file.hasReference   // true when the file_id carries a fresh reference
file.hasWebLocation // true for `kind: 'web'` ids
file.raw            // discriminated parsed payload (photo | document | web)

if (file.fileType === FileType.Sticker) {
  // …
}
```

throws `FileIdParseError` on malformed input, `UnsupportedFileIdVersionError` when telegram bumps the format past what the current `@puregram/file-id` understands.

### kind-specific accessors

| getter | populated when | type |
|---|---|---|
| `file.id` | `kind === 'photo' \| 'document'` | `bigint` |
| `file.photoSize` | `kind === 'photo'` | `PhotoSizeSource` |
| `file.url` | `kind === 'web'` | `string` |

for type-narrowed access to `.raw`, use the guards:

```ts
import { FileId, isPhotoFileId, isWebFileId } from '@puregram/file-id'

const file = FileId.from('…')

if (isPhotoFileId(file.raw)) {
  console.log(file.raw.id, file.raw.photoSize.type)
}

if (isWebFileId(file.raw)) {
  console.log(file.raw.url)
}
```

### `file.toString()` — re-serialize

```ts
const original = 'AgACAgI...'
const parsed = FileId.from(original)

parsed.toString() === original  // round-trip preserves bytes
```

### `file.toUniqueId()` — derive the matching `file_unique_id`

telegram exposes both `file_id` (chat-scoped, may rotate) and `file_unique_id` (stable identity across the file's lifetime). the second is derivable from the first:

```ts
const unique = file.toUniqueId()

unique.toString()  // base64url
unique.kind        // 'photo' | 'document' | 'web' | …
```

useful for deduping — same `file_unique_id` ⇒ same underlying file.

## `FileUniqueId.from(string)` — parse a `file_unique_id`

```ts
import { FileUniqueId } from '@puregram/file-id'

const unique = FileUniqueId.from('AgADAQADAg')

unique.kind      // 'photo' | 'document' | 'web' | 'secure' | 'encrypted' | 'temp'
unique.id        // bigint | undefined
unique.url       // string — only for kind: 'web'
unique.volumeId  // bigint — only for kind: 'photo'
unique.localId   // number — only for kind: 'photo'

unique.toString()  // re-serializes
```

`file_unique_id` strings are short — six bytes of TL plus base64url. they don't carry dc / access hash / photo-size source — that's all on the full `file_id`.

## type guards

discriminated narrows on `.raw`. all return `boolean` (and `is X` at the type level):

| guard (on `FileId.raw`) | narrows to |
|---|---|
| `isPhotoFileId(raw)` | `PhotoFileId` |
| `isDocumentFileId(raw)` | `DocumentFileId` |
| `isWebFileId(raw)` | `WebFileId` |
| `isStickerFileId(raw)` | `DocumentFileId` with `fileType === FileType.Sticker` |

| guard (on `FileUniqueId.raw`) | narrows to |
|---|---|
| `isPhotoUniqueId(raw)` | `PhotoFileUniqueId` |
| `isDocumentUniqueId(raw)` | `DocumentFileUniqueId` |
| `isWebUniqueId(raw)` | `WebFileUniqueId` |
| `isSecureUniqueId(raw)` | `SecureFileUniqueId` |
| `isEncryptedUniqueId(raw)` | `EncryptedFileUniqueId` |
| `isTempUniqueId(raw)` | `TempFileUniqueId` |

## `PhotoSizeSource` — where a photo size comes from

photos carry a `photo_size_source` describing whether they're a thumbnail, a dialog photo, a sticker-set thumbnail, or the legacy pre-`RemovePhotoVolumeAndLocalId` shape:

```ts
import { isPhotoFileId } from '@puregram/file-id'

const file = FileId.from('AgACAgI...')

if (isPhotoFileId(file.raw)) {
  const ps = file.raw.photoSize

  switch (ps.type) {
    case 'legacy':                ps.localId; break
    case 'thumbnail':             ps.thumbnailType; break
    case 'dialog_photo_small':    ps.dialogId; break
    case 'dialog_photo_big':      ps.dialogId; break
    case 'sticker_set_thumbnail': ps.stickerSetId; break   // bigint — the set's numeric id
  }
}
```

each variant has its own type guard — `isLegacySource`, `isThumbnailSource`, `isDialogPhotoSmallSource`, `isDialogPhotoBigSource`, `isStickerSetThumbnailSource`. the `PhotoSizeSource` union itself is exported for type-only use.

> the `sticker_set_thumbnail` variant exposes the set's numeric id — community research shows the creator's `user_id` is packed into its upper bits. the bot api doesn't expose the set id directly, but the set's thumbnail `file_id` carries it for free. a working proof-of-concept lives in the repo's `examples/src/file-id/sticker-set-owner-poc.ts` — useful when researching ownership of public sets

## `FileType` enum

mirrors [TDLib's `FileType`](https://core.telegram.org/tdlib/getting-started#downloading-files). useful for branching on `.fileType`:

```ts
import { FileType } from '@puregram/file-id'

FileType.Photo                 // 2
FileType.VoiceNote             // 3
FileType.Video                 // 4
FileType.Document              // 5
FileType.Sticker               // 8
FileType.Animation             // 10
FileType.VideoNote             // 13
FileType.SelfDestructingPhoto  // 22
// …and ~30 more
```

the full list lives in `packages/file-id/src/constants.ts`.

## free-function api (no class wrapper)

every entry point on the class also exists as a free function:

| class | function |
|---|---|
| `FileId.from(s)` | `parseFileId(s)` |
| `parsed.toString()` | `serializeFileId(raw)` |
| `parsed.toUniqueId()` | `fileUniqueIdFromFileId(raw)` |
| `FileUniqueId.from(s)` | `parseFileUniqueId(s)` |
| `unique.toString()` | `serializeFileUniqueId(raw)` |

```ts
import { parseFileId, serializeFileId, fileUniqueIdFromFileId } from '@puregram/file-id'

const raw = parseFileId('AgACAgI...')
const back = serializeFileId(raw)
const uniqueRaw = fileUniqueIdFromFileId(raw)
```

## errors

both errors extend `Error`, so `instanceof` works:

- **`FileIdParseError`** — input was malformed (bad base64url, truncated tl, unknown `file_type`, etc)
- **`UnsupportedFileIdVersionError`** — the `file_id`'s major/minor version is newer than the parser knows. **open an issue when you hit this** — telegram bumped the format

```ts
import { FileId, FileIdParseError, UnsupportedFileIdVersionError } from '@puregram/file-id'

try {
  FileId.from(suspect)
} catch (error) {
  if (error instanceof UnsupportedFileIdVersionError) {
    console.error('newer telegram format:', error.message)
  } else if (error instanceof FileIdParseError) {
    console.error('malformed file_id:', error.message)
  } else {
    throw error
  }
}
```

## low-level encoding helpers

the primitives the parser builds on are exported too — useful when implementing a TDLib-flavored format yourself or shipping a custom serializer:

| export | purpose |
|---|---|
| `base64urlEncode(bytes)` / `base64urlDecode(str)` | TDLib's url-safe base64 (no padding) |
| `rleEncode(bytes)` / `rleDecode(bytes)` | run-length encoding for zero-bytes; what telegram applies before base64url |
| `packTlString(str)` / `unpackTlString(reader)` | TL string framing (length prefix, alignment) |
| `BinaryReader` / `BinaryWriter` | little-endian bigint-aware reader/writer |

stable but very low-level — read the package source first.

## constants

- `SUPPORTED_VERSIONS` — readonly tuple of `[majorVersion, subVersion]` pairs the parser accepts
- `FILE_REFERENCE_FLAG` — `0x02000000`, the high-bit flag in the type id meaning "carries a fresh file_reference"
- `WEB_LOCATION_FLAG` — `0x01000000`, the high-bit flag meaning "web location"

## exported surface

```ts
import {
  FileId, FileUniqueId,            // classes
  FileType,                        // enum
  parseFileId, serializeFileId,
  parseFileUniqueId, serializeFileUniqueId,
  fileUniqueIdFromFileId,
  isPhotoFileId, isDocumentFileId, isWebFileId, isStickerFileId,
  isPhotoUniqueId, isDocumentUniqueId, isWebUniqueId,
  isSecureUniqueId, isEncryptedUniqueId, isTempUniqueId,
  isLegacySource, isThumbnailSource,
  isDialogPhotoSmallSource, isDialogPhotoBigSource,
  isStickerSetThumbnailSource,
  base64urlEncode, base64urlDecode,
  rleEncode, rleDecode,
  packTlString, unpackTlString,
  BinaryReader, BinaryWriter,
  FileIdParseError, UnsupportedFileIdVersionError,
  SUPPORTED_VERSIONS, FILE_REFERENCE_FLAG, WEB_LOCATION_FLAG
} from '@puregram/file-id'

import type {
  PhotoFileId, DocumentFileId, WebFileId, ParsedFileId,
  PhotoFileUniqueId, DocumentFileUniqueId, WebFileUniqueId,
  SecureFileUniqueId, EncryptedFileUniqueId, TempFileUniqueId,
  ParsedFileUniqueId,
  PhotoSizeSource,
  LegacySource, ThumbnailSource,
  DialogPhotoSmallSource, DialogPhotoBigSource,
  StickerSetThumbnailSource
} from '@puregram/file-id'
```

## see also

- main skill: `using-puregram` — covers `MediaSource.fileId(...)`, where parsed `file_id`s are usually destined
- sibling: `puregram-media-cacher` — the cache plugin stores `file_id` strings keyed by `(chatId, sourceValue)`; this parser is how you inspect what's actually in there
- sibling: `puregram-inline-message-id` — the matching TL parser for inline-message ids
- package source: [`packages/file-id/`](https://github.com/puregram/puregram/tree/v3/packages/file-id)
