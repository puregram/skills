---
name: telegram-bot-api
description: >
  use before writing any telegram bot api call, payload or update handler from memory, in any
  language or SDK. ships `tools/botapi.mjs`, a zero-dependency Markdown lookup over the official
  reference at core.telegram.org/bots/api: exact method parameters, type fields, unions, return
  types, reverse references, prose sections, the changelog and the /bots/features guide. also
  covers how to read the reference correctly (optional fields, `True` types, 52-bit ids,
  JSON-serialized params, the error envelope) and how to handle API drift between your SDK and
  the server.
---

# telegram bot api — official Markdown lookup

look up method parameters and update fields before writing them: the server documentation can
change independently of your installed SDK.

```
node <skill>/tools/botapi.mjs <Name> [<Name>...]   # exact method / type / prose section
```

exact lookups fetch only discovery indexes/changelog and requested entry pages, not the whole
reference. `search` and `refs` reuse cached entry pages, even stale ones, and fetch missing pages
with at most 8 concurrent requests. offline searches warn when only an index is cached, since
uncached fields and references cannot be searched.

node ≥18 works standalone, without installing another skill or npm dependencies. node ≥22.13
also reads an **optional, read-only shared catalogue** at `$TG_CORE_DOCS_DB`, otherwise
`${XDG_CACHE_HOME:-~/.cache}/telegram-core-docs/catalogue.sqlite`. tracker-imported official
Markdown pages can answer offline lookups and discover methods/types omitted from the fixed
indexes; names come from actual page headings, not inferred API definitions.

the legacy Markdown cache remains at `$TG_BOTAPI_CACHE`, otherwise
`${XDG_CACHE_HOME:-~/.cache}/telegram-bot-api`. the tool chooses the newest valid cached copy
across both stores. it writes targeted live fetches only to this legacy cache.

- `--offline` never uses the network, even together with `--refresh`; missing exact pages fail.
- `sendMessage --refresh` bypasses both cached copies for live verification of discovery pages
  and this method. `search --refresh` / `refs --refresh` refetch all their entry pages.
- exact lookups normally recheck pages after 6 hours (`--ttl <hours>`). failed network fetches
  fall back to available cache with a warning; a fallback is not successful verification.
- text and JSON expose source URL, SHA-256, source, `checkedAt`, `fetchedAt`, and freshness
  (`fresh`, `stale`, `unknown`; `stale: true` also covers unknown). freshness means checked
  within the TTL, not a promise that the server has not changed. tracker `fetchedAt: null`
  stays unknown. old standalone files without verification metadata also have unknown
  timestamps; their filesystem time is only a cache-selection hint.
- version/release information comes from the changelog, with its own provenance; a partial
  offline corpus may have an unknown version. index listings cite their index unless a
  discovered page supplied the entry.

run the isolated parser/corpus regressions (node ≥22.13 exercises SQLite cases) with:

```
node --test <skill>/tools/botapi.test.mjs
```

## commands

| command | use it for |
|---|---|
| `botapi.mjs sendMessage ReplyParameters` | full entries: description, every parameter / field with type, required-ness and description |
| `botapi.mjs sendMessage --brief` | names and types only |
| `botapi.mjs search ephemeral` | don't know the name: ranks methods / types by name, field, param and description hits |
| `botapi.mjs refs InlineQueryResult` | every parameter, field, union and return value that uses a type, e.g. "what can I pass an `InlineQueryResult` to?" |
| `botapi.mjs list methods --section "Updating messages"` | browse. kinds: `methods`, `types`, `prose`, `sections` |
| `botapi.mjs "Formatting options"` | prose sections: formatting, sending files, command scope resolution, ephemeral messages, paid broadcasts… |
| `botapi.mjs changelog --since 10.0 --grep ephemeral` | what changed and when. no flags = the latest release |
| `botapi.mjs features "Guest Bots"` | the /bots/features guide: behavior and intent that the reference leaves out. no argument lists headings |
| `botapi.mjs version` | current api version and release date |

every command takes `--json`. lookups are case-insensitive and typo-tolerant (`sendMesage` →
"did you mean: sendMessage").

## when to run it

- before every raw call or hand-built payload: check the parameter names, which are required,
  and the exact nesting
- when a user names a feature you don't know (guest mode, ephemeral messages, join request
  queries, managed bots…): `search` + `features`
- when an SDK lacks a method or field: confirm it exists server-side, then call it raw
- when a call fails with `Bad Request` and the payload "looks right": compare it with the live
  entry. renamed parameters are the usual cause
- when reading an update: `botapi.mjs Message` / `Update` lists every optional field that can
  show up

## reading the reference correctly

| you see | it means |
|---|---|
| description starts with `Optional.` | the field may be absent. the tool marks these `(optional)` |
| type `True` (not `Boolean`) | the field is either `true` or missing. it is never `false` |
| type `Integer` on an id | up to 52 significant bits. use int64 / double, **never int32** |
| "JSON-serialized" | a nested object. in `application/json` bodies send it as an object; in query string / form / multipart, send it as a JSON **string** |
| `X or Y` types | for `InputFile or String`: upload a file, or pass a `file_id` / URL string. for unions (`InlineKeyboardMarkup or ReplyKeyboardMarkup or …`), the object's shape decides which one it is |
| abstract type with a bullet list (`MessageOrigin`, `ChatMember`, `InlineQueryResult`) | a discriminated union. the discriminator is `type`, `status` or `source`; `botapi.mjs <Union>` prints the members |
| "Returns …" / "On success, … is returned" | the only place the return type is specified. edits of inline messages return `True`, not a `Message` |
| "for X only" in a parameter description | the server ignores or rejects the parameter outside X |

method names are case-insensitive. requests may be GET or POST, with parameters in the query
string, `application/x-www-form-urlencoded`, `application/json` (no file uploads) or
`multipart/form-data` (uploads).

### the response envelope

```json
{ "ok": true, "result": … }
{ "ok": false, "error_code": 400, "description": "Bad Request: …", "parameters": { "retry_after": 7 } }
```

- `description` is the human-readable error. match on it, not on `error_code` ("its contents are
  subject to change")
- `parameters.retry_after`: flood control. wait that many seconds, then retry the same request
- `parameters.migrate_to_chat_id`: the group became a supergroup. retry against the new id and
  update what you have stored

## drift: the reference vs your SDK vs the server

- **renames happen.** examples: `correct_option_id` → `correct_option_ids` (9.6); top-level
  `receiver_user_id` / `callback_query_id` → `ephemeral_message_parameters` (10.3). when an SDK
  targets an older version, check `botapi.mjs changelog --since <sdk's version>` before trusting
  its types
- **the prose can lag the tables.** the "Ephemeral Messages and Commands" section still talks about
  a `receiver_user_id` parameter that 10.3 moved into `EphemeralMessageParameters`. parameter
  tables and the changelog are authoritative
- the reference describes the server. the features page explains intent and limits that the
  reference leaves out (guest mode vs inline mode, bot-to-bot loop rules). read both for new
  features
- **inapplicable parameters are often dropped silently instead of rejected.** measured on 10.3: a
  `reply_parameters.ephemeral_message_id` without `ephemeral_message_parameters` produces a *public*
  message with no reply, and a `login_url` button on an ephemeral message becomes a plain `url`
  button. `ok: true` only means the call went through. check the returned object for the effect
  you wanted

## related skills

feature skills built on this lookup: `telegram-ephemeral-messages`, `telegram-guest-mode`,
`telegram-inline-mode`, `telegram-streaming-replies`, `telegram-groups`, `telegram-business-bots`,
`telegram-rich-messages`.
puregram users: `using-puregram` looks up the installed `@puregram/api` typings. these official
pages describe the server contract at their recorded verification time, **not installed SDK
support**. confirm SDK names/types separately; do not invent wrappers for newly documented APIs.
