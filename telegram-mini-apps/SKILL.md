---
name: telegram-mini-apps
description: >
  use for Telegram Mini Apps / Web Apps in any language or SDK: launch buttons and
  startapp links, window.Telegram.WebApp, initData authentication, bot-token HMAC
  versus third-party Ed25519 signatures, context-specific data return, lifecycle,
  themes, viewport, permissions, storage and version-gated device APIs. use when
  reviewing Mini App security or debugging sendData, answerWebAppQuery,
  switchInlineQuery or prepared-message sharing. not embedded HTML message widgets
  (window.TelegramWidget), website Login/Post widgets, or payment fulfillment itself.
---

# telegram mini apps

A Mini App is a web interface inside Telegram, connected through
`window.Telegram.WebApp`. Its launch context determines its identity data and what
it can send back. A working browser bridge does not authenticate a backend request.
This guidance is library-agnostic; use `telegram-bot-api` for exact current payloads.

## source and version context

Official sources checked **2026-11-10**: [Mini Apps](https://core.telegram.org/bots/webapps),
its [Markdown](https://core.telegram.org/bots/webapps.md), [client implementation](https://core.telegram.org/api/bots/webapps),
[web events](https://core.telegram.org/api/web-events) and the linked Bot API entries.
The webapps page's latest dated entry is Bot API 10.1; the Bot API lookup corpus is
10.4. Neither implies the user's client supports that version. Prefer field/method
contracts over introductory counts or an SDK's existence checks. Concrete limits,
capability gates and source discrepancies are in
[capabilities and limits](references/capabilities-and-limits.md).

## choose the launch and return path first

| launch | authenticated/context data | valid return path and restrictions |
|---|---|---|
| reply `KeyboardButton.web_app` | `WebAppInitData` is empty | `WebApp.sendData(string)` sends `message.web_app_data` to the bot and closes the app; keyboard-button launches only. [`KeyboardButton`](https://core.telegram.org/bots/api#keyboardbutton) makes this private-chat-only. [launch contract](https://core.telegram.org/bots/webapps#keyboard-button-mini-apps) |
| `InlineKeyboardButton.web_app` | user and session `query_id`, after server verification | backend `answerWebAppQuery` sends a message on behalf of the user to the originating bot chat, closing the app. Private user–bot chats only; not business-account or ephemeral messages. [button contract](https://core.telegram.org/bots/api#inlinekeyboardbutton), [launch](https://core.telegram.org/bots/webapps#inline-button-mini-apps) |
| bot menu button with web URL | same as inline-button launch | same query-answer path. Configure via BotFather or `setChatMenuButton`. A menu button whose URL is a bot's `t.me` Mini App link instead behaves as that link, not the ordinary menu webview. [menu launch](https://core.telegram.org/bots/webapps#launching-mini-apps-from-the-menu-button), [`MenuButtonWebApp`](https://core.telegram.org/bots/api#menubuttonwebapp) |
| inline-results `InlineQueryResultsButton.web_app` | `WebAppInitData` is empty; no chat access | `switchInlineQuery` returns to inline mode; the user must choose a result. Not an inline-keyboard web-app button. [inline-mode launch](https://core.telegram.org/bots/webapps#inline-mode-mini-apps) |
| main app profile button / `t.me/<bot_username>?startapp=...` | optional user/context fields; direct-link launch can include `chat_type`, `chat_instance`, `start_param` | use authenticated backend calls for app actions; do not assume `query_id` or `sendData`. For publishing, use supported user-mediated inline selection or prepared-message sharing. [main launch](https://core.telegram.org/bots/webapps#launching-the-main-mini-app) |
| named app `t.me/<bot_username>/<short_name>?startapp=...` | optional user; opaque chat context `chat_type`/`chat_instance`, not permission to read the chat or a Bot API chat ID | no automatic chat reading/sending. Use `switchInlineQuery` plus user selection, or supported prepared-message sharing. [direct-link contract](https://core.telegram.org/bots/webapps#direct-link-mini-apps) |
| attachment menu | user, session `query_id`; optional `receiver` in private chats or `chat` in group/channel contexts | `answerWebAppQuery` can send on behalf of the user to the originating chat; respect optional `can_send_after`. Production integration is restricted to major Telegram Ad Platform advertisers; all bots can use the separate test environment. [attachment contract](https://core.telegram.org/bots/webapps#launching-mini-apps-from-the-attachment-menu) |
| guard-bot chat join request | `chat_join_request_query_id`, user and chat after verification | `sendChatJoinRequestWebApp` shows the app; backend `answerChatJoinRequestQuery` resolves with `approve`, `decline` or `queue`. This is not `answerWebAppQuery`. [guard launch](https://core.telegram.org/bots/webapps#launching-mini-apps-on-chat-join-requests), [resolution](https://core.telegram.org/bots/api#answerchatjoinrequestquery) |

Treat fields as optional exactly as [WebAppInitData](https://core.telegram.org/bots/webapps#webappinitdata)
specifies. Never synthesize a query ID, user ID or chat ID when absent. A regular
website visit is not a Telegram login. Empty init data in the documented simple
launches is not an authentication failure to bypass; choose a return path that does
not require signed identity or provide a separate real authentication flow.

### returning data is not one API

- **Keyboard input:** serialize a small application payload and call `sendData` once
  at completion. The documented ceiling is **4096 bytes**, not JavaScript UTF-16
  string length ([bridge contract](https://core.telegram.org/bots/webapps#initializing-mini-apps)).
  Bot-side `WebAppData.data` **and** `button_text` can be forged by a bad client;
  validate schema, authorization and domain values. Use the actual Bot API update
  sender for identity, not a user ID inside the payload. [WebAppData warning](https://core.telegram.org/bots/api#webappdata)
- **Session result:** send raw `initData` and the application choice to your backend.
  Validate both, use verified `query_id` as `web_app_query_id`, and construct an
  `InlineQueryResult` for [`answerWebAppQuery`](https://core.telegram.org/bots/api#answerwebappquery).
  The browser never calls Bot API with a bot token. Honor `can_send_after` when
  present; handle expired/invalid queries without inventing a universal query TTL.
- **Inline selection:** `switchInlineQuery(query, choose_chat_types?)` inserts a query;
  it does not silently publish a message. Bot inline mode must be configured; let
  the user select a result. Read `telegram-inline-mode` for result handling.
  [bridge and supported chat-type values](https://core.telegram.org/bots/webapps#initializing-mini-apps)
- **Prepared sharing:** backend calls [`savePreparedInlineMessage`](https://core.telegram.org/bots/api#savepreparedinlinemessage)
  with the verified target `user_id`, an `InlineQueryResult`, and intended
  `allow_*_chats` flags. Return its [`PreparedInlineMessage.id`](https://core.telegram.org/bots/api#preparedinlinemessage)
  to that user and call `WebApp.shareMessage(id)` on a supported client. This opens
  a sharing dialog; it is not a normal message ID, a web-app query ID, or automatic
  chat access. Respect returned `expiration_date`, cancellation and sharing errors.
  [shareMessage gate/events](https://core.telegram.org/bots/webapps#initializing-mini-apps)
- **Application backend:** an authenticated HTTP request can save a preference/order
  without producing a Telegram message. Do not force every launch through a chat
  return API. Hosted Serverless endpoints are a separate official transport below.

## trust boundary: authenticate before using identity

Read [validation and replay handling](references/validation.md) before implementing
or reviewing a verifier. The two algorithms are deliberately different:

| verifier | secret/public key | excluded fields | signed message |
|---|---|---|---|
| bot's own backend, HMAC-SHA-256 | server-only bot token derives a binary secret | `hash` only; **retain `signature` when present** | alphabetically sorted decoded `key=value` pairs joined with LF |
| third-party Ed25519 | official Telegram environment-specific public key, expected bot ID | **both `hash` and `signature`** | `<bot_id>:WebAppData` + LF + sorted decoded pairs joined with LF |

Sources: [bot-token validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app),
[third-party validation](https://core.telegram.org/bots/webapps#validating-data-for-third-party-use).

`initDataUnsafe` is only client-side convenience data. Send the original **raw
`initData` query string** to the backend; never send only its parsed `user`, a
client-supplied hash of your own JSON, or a browser boolean saying validation passed.
Preserve decoded value strings while checking signatures: parsing and reserializing
nested JSON, decoding twice, omitting unknown fields or sorting with a locale-aware
collator changes the signed message. Fail closed on missing/invalid proof.

Only after cryptographic verification, check `auth_date` freshness using your own
explicit policy and establish a backend session. Telegram specifies checking age,
not a universal expiry interval. Signature integrity alone does not prevent replay,
prove chat membership/admin rights, authorize an order, or make browser business data
trustworthy. See the reference for action-level idempotency and session binding.

Optional puregram users can consult `puregram-utils` for its `WebApp` helpers;
confirm the installed helper's canonicalization, signature support and age policy
against this protocol. No SDK helper replaces authorization or replay defenses.

## launch/start data

- Main link: `https://t.me/<bot_username>?startapp=<payload>`; named app link:
  `https://t.me/<bot_username>/<short_name>?startapp=<payload>`.
  Attachment links use `startattach`, not `startapp`; ordinary bot `/start` links
  use a different mechanism. [official link formats](https://core.telegram.org/api/links#main-mini-app-links)
- `startapp` and `startattach` values reach `start_param` and the early URL hint
  `tgWebAppStartParam` in their documented launch contexts. Use the URL hint for
  provisional routing only; use the verified `initData.start_param` for backend
  decisions. Even a Telegram-signed start parameter was chosen by a link author:
  it does not grant access to an object or confer a referral reward by itself.
  [main](https://core.telegram.org/bots/webapps#launching-the-main-mini-app),
  [direct](https://core.telegram.org/bots/webapps#direct-link-mini-apps),
  [attachment](https://core.telegram.org/bots/webapps#adding-bots-to-the-attachment-menu)
- Distinguish maximum-height expansion from true fullscreen. `mode=compact` and
  `mode=fullscreen` are link behaviors in the [link specification](https://core.telegram.org/api/links#direct-mini-app-links);
  `expand()` and `requestFullscreen()` are different bridge operations.
- Use short opaque references rather than secrets in shareable launch links.
  See the sourced `startapp` limit and documentation inconsistencies in the
  [capability reference](references/capabilities-and-limits.md).

## browser lifecycle and adaptive UI

Load the official [telegram-web-app.js](https://telegram.org/js/telegram-web-app.js)
in `<head>` before application scripts, as described by
[Initializing Mini Apps](https://core.telegram.org/bots/webapps#initializing-mini-apps).
Do not embed a bot token. Separate initialization, authentication and app data loading:

1. Obtain `window.Telegram.WebApp`; render essential UI and call `ready()` early
   to dismiss the placeholder. `ready()` is not proof of authorization or completion
   of backend loading. Handle a non-Telegram preview as unauthenticated.
2. Read `version` (bridge Bot API version), `platform`, `colorScheme` and
   `themeParams`. Platform/User-Agent are presentation/capability hints, not signed
   identity or authorization. Use `isVersionAtLeast()` rather than lexical version
   comparison; gate the particular method/property too. Version alone does not
   guarantee hardware, permissions or platform support.
3. Subscribe to `themeChanged` and render optional theme values with fallbacks;
   CSS `--tg-theme-*` and `--tg-color-scheme` expose the same themes.
   [ThemeParams](https://core.telegram.org/bots/webapps#themeparams)
4. Track `viewportChanged` and `isStateStable`. Use `viewportStableHeight` /
   `--tg-viewport-stable-height` to anchor bottom UI; `viewportHeight` updates are
   explicitly too coarse to follow the moving lower border smoothly.
5. On supported clients, account for **both** system `safeAreaInset` and Telegram
   `contentSafeAreaInset`, and their change events; do not mistake them for the same
   obstruction. Recompute layout after orientation/fullscreen changes.
6. Bind `MainButton`, `SecondaryButton`, `BackButton`, `SettingsButton` and events
   with stable handlers; remove them with `offClick`/`offEvent` on route teardown.
   Show progress/disable submit during a pending action, restoring state on errors.
7. Use `activated`/`deactivated` where supported to pause/resume expensive work;
   stop sensors on teardown. Use closing confirmation for unsaved work. Disabling
   vertical swipes does not remove the user's header swipe/close controls.
8. Finish through the appropriate return path or `close()`; do not assume closing
   the window commits data or cancels a server-side operation.

The lifecycle, viewport, methods and event availability above are specified in
[WebApp](https://core.telegram.org/bots/webapps#initializing-mini-apps) and
[events](https://core.telegram.org/bots/webapps#events-available-for-mini-apps).
For exact version gates, permissions, native callback shapes, storage limits and
failure handling, read [capabilities and limits](references/capabilities-and-limits.md)
before generating capability-dependent code.

## payment and hosted-endpoint handoffs

- Read **`telegram-payments`** for fiat versus Stars, checkout, fulfillment, refunds
  and subscriptions. For digital goods/services inside Telegram, use Telegram
  Stars (`XTR`), not an external card checkout workaround.
  [official digital-goods requirement](https://core.telegram.org/bots/payments-stars#how-does-this-work)
- Backend creates an invoice link with [`createInvoiceLink`](https://core.telegram.org/bots/api#createinvoicelink);
  the app calls supported `openInvoice(url, callback)`. Treat `invoiceClosed`
  (`paid`, `cancelled`, `failed`, `pending`) as UI state, not fulfillment authority.
  Reconcile the bot's genuine `successful_payment` update and your order ledger
  before granting goods; a forged browser callback cannot purchase anything.
  [invoice event contract](https://core.telegram.org/bots/webapps#events-available-for-mini-apps)
- For **Telegram Serverless-hosted** apps, `WebApp.Serverless.call(name, input,
  callback)` sends init data to platform-validated endpoints. Handle errors and
  missing/invalid authorization; do not assume the object authenticates arbitrary
  third-party HTTP endpoints. There is no documented minimum bridge version in
  this entry; do not invent one. Check actual availability and deployment support.
  Platform authentication still leaves input validation, object ownership and
  action-level authorization to the endpoint.
  [Serverless bridge](https://core.telegram.org/bots/webapps#serverless),
  [endpoint contract](https://core.telegram.org/bots/serverless#endpoints)

## implementation/review checklist

- Identify the exact launch button/link and return mechanism before coding.
- Reject unverified identity; keep browser UI state separate from backend authority.
- Choose HMAC or Ed25519 deliberately; preserve that algorithm's canonical bytes.
- Define freshness, session and action-level replay/idempotency policy explicitly.
- Check optional fields, client version, permission denial, unsupported hardware,
  cancellations and returned expiration dates instead of inventing fallbacks.
- Validate app payloads and enforce ownership/roles even after Telegram auth.
- Keep bot secrets, raw init data and bearer session tokens out of URLs and logs.
- Use the separate official test environment for development; its accounts/bots
  and Ed25519 key differ from production. HTTP without TLS is a documented test
  exception, not a production recommendation.
  [test environment](https://core.telegram.org/bots/webapps#using-bots-in-the-test-environment)
- Do not substitute `window.TelegramWidget` or website Login Widget validation.
  Embedded HTML message widgets belong to `telegram-widgets`, not this bridge.
