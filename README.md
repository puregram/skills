# puregram skills

agent-installable skills for [`puregram`](https://github.com/puregram/puregram) v3 — a thin, type-safe wrapper around the [telegram bot api](https://core.telegram.org/bots/api).

these skills are designed for [skills.sh](https://skills.sh) and any agent-skill runtime that follows the same shape (claude code, codex, etc.).

## skills

### main entry

- [**using-puregram**](./using-puregram/SKILL.md) — `Telegram.fromToken`, three-layer api (`tg.api.X` / `tg.send` / `update.send`), `.extend(plugin)`, request hooks (incl. the `onApiCall` around-hook), dispatch middleware, `MediaSource`, keyboards, parse-mode, filters, errors, polling vs webhook, `retryOnFloodWait`, `Invoice` builders, pagination iterators, `tg.business`. start here.

### siblings

- [**puregram-flow**](./puregram-flow/SKILL.md) — `waitFor` / `prompt` / `collectMediaGroup` / `waitForAny`, plus persistent flows that survive bot restarts
- [**puregram-scenes**](./puregram-scenes/SKILL.md) — multi-step wizards via `StepScene`, `enterHandler` / `leaveHandler` / `beforeStep` / `afterStep`, `passthrough` escape hatches
- [**puregram-session**](./puregram-session/SKILL.md) — per-user / per-chat / per-thread state, proxied auto-flush, `ttl`, declaration-merged `SessionData`
- [**puregram-storage**](./puregram-storage/SKILL.md) — the `KVStorage<V>` / `TtlStorage<V>` contract that session / scenes / media-cacher / rate-limit all share, plus `enhanceStorage` migrations
- [**puregram-callback-data**](./puregram-callback-data/SKILL.md) — typed `callback_data` payloads via `defineCallbackData`, `.button`, `.filter`, `.with`
- [**puregram-testing**](./puregram-testing/SKILL.md) — actor-driven in-process test framework, vitest / mocha / node:test agnostic
- [**puregram-markup**](./puregram-markup/SKILL.md) — tagged-template entity-aware formatter; composes message entities directly, no `parse_mode` header needed
- [**telegram-rich-messages**](./telegram-rich-messages/SKILL.md) — the rich-message format itself, independent of any SDK: all 24 block types and 26 inline types, wire shapes, limits, media reuse, drafts, and the native-blocks / markdown / html forms side by side
- [**puregram-rich**](./puregram-rich/SKILL.md) — safe emitter for rich-message html/markdown; templates + block-array authoring + builders, plus the sendRich/editRich shortcuts
- [**rich-message-authoring**](./rich-message-authoring/SKILL.md) — a system-prompt block that constrains LLM output to telegram's supported rich grammar; for streaming or drafting rich content with a model
- [**puregram-media-cacher**](./puregram-media-cacher/SKILL.md) — transparent `file_id` caching plugin; first send uploads, every later send reuses the cached id
- [**puregram-rate-limit**](./puregram-rate-limit/SKILL.md) — inbound per-user fixed-window rate limiting; filter / middleware / imperative call shapes
- [**puregram-file-id**](./puregram-file-id/SKILL.md) — TL parser for telegram `file_id` and `file_unique_id` strings; zero puregram deps
- [**puregram-utils**](./puregram-utils/SKILL.md) — standalone helpers: slot-machine decoder, web app `initData` validation, `parseCommand`, typed `t.me` deep-link builders + `parseDeepLink` parser
- [**puregram-inline-message-id**](./puregram-inline-message-id/SKILL.md) — TL parser for telegram's `inline_message_id` blob; legacy + modern wire shapes
- [**puregram-stream**](./puregram-stream/SKILL.md) — stream LLM output to telegram via animated `sendMessageDraft` previews; adapters for openai / anthropic / vercel ai / ollama / langchain
- [**puregram-throttler**](./puregram-throttler/SKILL.md) — outbound rate-limit middleware; sliding-window buckets keep your bot under telegram's ~30 rps / per-chat / per-group soft limits

### cookbook

- [**recipes**](./using-puregram/reference/recipes.md) — 15 short canonical bot recipes referenced from the main skill

## lookup tools

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
