# puregram skills

agent-installable skills for [`puregram`](https://github.com/puregram/puregram) v3 — a thin, type-safe wrapper around the [telegram bot api](https://core.telegram.org/bots/api).

these skills are designed for [skills.sh](https://skills.sh) and any agent-skill runtime that follows the same shape (claude code, codex, etc.).

## skills

### main entry

- [**using-puregram**](./using-puregram/SKILL.md) — `Telegram.fromToken`, three-layer api (`tg.api.X` / `tg.send` / `update.send`), `.extend(plugin)`, request hooks (incl. the `onApiCall` around-hook), dispatch middleware, `MediaSource`, keyboards, text formatting, filters, errors, polling vs webhook, `retryOnFloodWait`, `Invoice` builders, pagination iterators, `tg.business`. start here.

### siblings

- [**puregram-flow**](./puregram-flow/SKILL.md) — `waitFor` / `prompt` / `collectMediaGroup` / `waitForAny`, plus persistent flows that survive bot restarts
- [**puregram-scenes**](./puregram-scenes/SKILL.md) — multi-step wizards via `StepScene`, `enterHandler` / `leaveHandler` / `beforeStep` / `afterStep`, `passthrough` escape hatches
- [**puregram-session**](./puregram-session/SKILL.md) — per-user / per-chat / per-thread state, proxied auto-flush, `ttl`, declaration-merged `SessionData`
- [**puregram-storage**](./puregram-storage/SKILL.md) — the `KVStorage<V>` / `TtlStorage<V>` contract that session / scenes / media-cacher / rate-limit all share, plus `enhanceStorage` migrations
- [**puregram-callback-data**](./puregram-callback-data/SKILL.md) — typed `callback_data` payloads via `defineCallbackData`, `.button`, `.filter`, `.with`
- [**puregram-testing**](./puregram-testing/SKILL.md) — actor-driven in-process test framework, vitest / mocha / node:test agnostic
- [**puregram-markup**](./puregram-markup/SKILL.md) — the default way to format text: tagged-template entity-aware formatter, composes message entities directly, no `parse_mode` header and nothing to escape
- [**puregram-rich**](./puregram-rich/SKILL.md) — safe emitter for rich-message html/markdown; templates + block-array authoring + builders, plus the sendRich/editRich shortcuts
- [**rich-message-authoring**](./rich-message-authoring/SKILL.md) — a system-prompt block that constrains LLM output to telegram's supported rich grammar; for streaming or drafting rich content with a model
- [**puregram-media-cacher**](./puregram-media-cacher/SKILL.md) — transparent `file_id` caching plugin; first send uploads, every later send reuses the cached id
- [**puregram-rate-limit**](./puregram-rate-limit/SKILL.md) — inbound per-user fixed-window rate limiting; filter / middleware / imperative call shapes
- [**puregram-file-id**](./puregram-file-id/SKILL.md) — TL parser for telegram `file_id` and `file_unique_id` strings; zero puregram deps
- [**puregram-utils**](./puregram-utils/SKILL.md) — standalone helpers: slot-machine decoder, web app `initData` validation, `parseCommand`, typed `t.me` deep-link builders + `parseDeepLink` parser
- [**puregram-inline-message-id**](./puregram-inline-message-id/SKILL.md) — TL parser for telegram's `inline_message_id` blob; legacy + modern wire shapes
- [**puregram-stream**](./puregram-stream/SKILL.md) — stream LLM output to telegram via animated `sendMessageDraft` previews; adapters for openai / anthropic / vercel ai / ollama / langchain
- [**puregram-throttler**](./puregram-throttler/SKILL.md) — outbound rate-limit middleware; sliding-window buckets keep your bot under telegram's ~30 rps / per-chat / per-group soft limits

### telegram bot api (any SDK)

these skills describe the server, not a library. the knowledge applies to any language or framework; puregram users get a short pointer per section. behavior that the reference doesn't spell out was measured against the live bot api 10.3 using a bot plus a real user account.

- [**telegram-bot-api**](./telegram-bot-api/SKILL.md) — live lookup over the official reference (methods, types, prose sections, changelog, features page) via `tools/botapi.mjs`, plus how to read the reference and handle api drift. read it before writing raw calls from memory
- [**telegram-ephemeral-messages**](./telegram-ephemeral-messages/SKILL.md) — group messages visible to one member: triggered (15 s) vs admin delivery, the overlay, ephemeral commands, replies, the edit/delete family, the silent public-message traps, every error string
- [**telegram-guest-mode**](./telegram-guest-mode/SKILL.md) — answering in chats the bot isn't in: `guest_message`, one `answerGuestQuery` reply, edits via `inline_message_id`, what's impossible, guest vs inline vs member
- [**telegram-inline-mode**](./telegram-inline-mode/SKILL.md) — the ~10 s answer deadline, caching, pagination, when `inline_message_id` exists, editing inline messages, the four producers of inline messages, validation errors
- [**telegram-streaming-replies**](./telegram-streaming-replies/SKILL.md) — `sendMessageDraft` / `sendRichMessageDraft`, the stop button and `stopped_message_generation`, rate limits, the finalize rule, a complete streaming loop
- [**telegram-groups**](./telegram-groups/SKILL.md) — the measured privacy-mode delivery matrix, command scopes, forum topics and the General trap, anonymous admins, group → supergroup migration, admin rights, bot-to-bot
- [**telegram-business-bots**](./telegram-business-bots/SKILL.md) — bots connected to a user's account: the connection lifecycle, business messages and the chat-id namespace trap, acting as the user, rights → calls, misleading error strings, the 24-hour rule
- [**telegram-rich-messages**](./telegram-rich-messages/SKILL.md) — the rich-message format itself, independent of any SDK: all 24 block types and 26 inline types, wire shapes, limits, media reuse, drafts, and the native-blocks / markdown / html forms side by side

### official Telegram documentation

- [**telegram-core-docs**](./telegram-core-docs/SKILL.md) — searchable, provenance-aware catalogue of official Markdown pages across bot guides, Bot API, MTProto/TL, TDLib, Gateway and other developer documentation. read a page or section and follow related links without loading the full corpus into context.

### cookbook

- [**recipes**](./using-puregram/reference/recipes.md) — 15 short canonical bot recipes referenced from the main skill

## lookup tools

`telegram-bot-api` ships [`telegram-bot-api/tools/botapi.mjs`](./telegram-bot-api/tools/botapi.mjs): zero dependencies, node ≥18 standalone. On node ≥22.13 it also reads the optional shared Markdown catalogue, including method/type pages missing from the fixed indexes. Exact lookups stay targeted; search and reverse references reuse cached entry pages. Source URLs, hashes, verification times and explicit freshness distinguish cached evidence from live verification:

    node telegram-bot-api/tools/botapi.mjs sendMessage ReplyParameters   # exact entries
    node telegram-bot-api/tools/botapi.mjs search ephemeral               # ranked search
    node telegram-bot-api/tools/botapi.mjs refs InlineQueryResult         # where a type is used
    node telegram-bot-api/tools/botapi.mjs changelog --since 10.0         # what changed
    node telegram-bot-api/tools/botapi.mjs features "Guest Bots"          # the /bots/features guide

`telegram-core-docs` ships [`telegram-core-docs/tools/core-docs.mjs`](./telegram-core-docs/tools/core-docs.mjs): zero dependencies, node ≥22.13 with built-in SQLite full-text search. Online commands automatically download a validated published catalogue, then search locally or refresh a selected page:

    node telegram-core-docs/tools/core-docs.mjs sync --json
    node telegram-core-docs/tools/core-docs.mjs search business bot rights --area bots --limit 5
    node telegram-core-docs/tools/core-docs.mjs read /api/passkeys.md --refresh
    node telegram-core-docs/tools/core-docs.mjs sections /bots/features.md --offline
    node telegram-core-docs/tools/core-docs.mjs read /bots/features.md --section "Guest Bots" --offline
    node telegram-core-docs/tools/core-docs.mjs links /api/auth.md --offline

Both tools accept `--json` and `--offline`; offline mode never accesses the network. With both skills installed on node ≥22.13, online commands check for catalogue updates at most hourly. `--no-sync` or `TG_CORE_DOCS_AUTO_UPDATE=0` opts out. `TG_CORE_DOCS_DB` (or core-docs `--db`) selects a user-managed database, which is never automatically replaced. Managed generations and their atomic `current.json` pointer live under `${XDG_CACHE_HOME:-~/.cache}/telegram-core-docs`; an existing `catalogue.sqlite` remains a fallback. Failed updates keep the last good copy, and newer targeted live reads survive promotion. Source check times remain visible; neither a successful download nor a recent filesystem timestamp is invented proof of live verification.

### scheduled source and parser checks

[`docs-catalogue.yml`](./.github/workflows/docs-catalogue.yml) runs hourly and on manual dispatch in this repository. It crawls `https://core.telegram.org/` directly with bounded concurrency and robots rules, discovers linked official Markdown, and rechecks previously discovered URLs. It requires a complete crawl, at least 1,000 pages, no unexplained loss above 10%, valid SQLite/body hashes and successful structured Bot API parser checks before publishing. Changes to tools run the isolated tests on pushes and pull requests.

The public, non-latest [`docs-catalogue` prerelease](https://github.com/puregram/skills/releases/tag/docs-catalogue) serves a manifest and immutable SHA-256-addressed gzip snapshots. Clients validate size limits, hashes, schema and official source scope before atomic installation. Actions summaries and seven-day report artifacts list changed URLs and skills needing human review; guidance is never blindly rewritten. GitHub schedules are best-effort and can be disabled by GitHub after repository inactivity: stale provenance and targeted `--refresh` remain essential.

This pipeline uses only `GITHUB_TOKEN` for this repository's releases. It needs no Datalix host, SSH key, bot token or tracker database. Optional `import-tracker <backup> --db <file>` still copies only healthy public documentation from a consistent read-only backup, never credentials, leases or notification queues. Search does not crawl the site, and no queryable revision-history API is claimed.

`using-puregram` ships executable lookup tools under [`using-puregram/tools/`](./using-puregram/tools/) — they resolve the user's installed `node_modules/@puregram/api` and `node_modules/puregram` at runtime, so they work in any project that has puregram installed:

    node using-puregram/tools/get-method.mjs sendMessage     # bot-api method → params/return/version
    node using-puregram/tools/get-object.mjs Message         # bot-api object/structure → fields
    node using-puregram/tools/get-update.mjs message         # wrapped update class → helpers
    node using-puregram/tools/get-shortcut.mjs send          # tg.send-family shortcut signatures
    node using-puregram/tools/get-filter.mjs hasText         # dispatch filter → narrowing + usage
    node using-puregram/tools/get-factory.mjs MediaSource    # factory class → static builder methods
    node using-puregram/tools/grep-source.mjs MessageShared  # scoped grep across installed puregram packages
    node using-puregram/tools/check-version.mjs              # installed versions + bot-api drift check

each tool supports `--help` and most support `--list`.

## relationship to puregram

these skills track [`puregram@3`](https://github.com/puregram/puregram) and **must stay in sync with package source** — when a public api in any `@puregram/*` package changes, the matching skill is updated in the same release. drift in either direction is a bug.

## license

MPL-2.0 — same as puregram itself.
