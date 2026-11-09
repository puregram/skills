# widget bridge, state and context

Public official sources checked 2026-11-10: [Telegram Widgets](https://core.telegram.org/bots/widgets.md),
Bot API 10.4 types/methods (indexed verification 2026-11-09). Read
[limits and profile](limits-and-profile.md) for the complete numeric audit rather than
inferring browser/Mini App behavior. No SDK extension or private experiment is a server guarantee.

## contents

- [Context and availability](#context-and-availability), including inline/guest boundaries
- [Bot update routing and authorization](#bot-update-routing-and-authorization)
- [State synchronization](#state-synchronization)
- [Initialization and bridge surface](#initialization-detection-and-bridge-surface)
- [Theme, events and layout](#theme-events-and-layout-integration)
- [Storage, links, copy and haptics](#storage-links-copy-and-haptics)
- [Wallet flow](#wallet-widget-specific-ton-flow-not-invoice-payments)
- [Lifecycle, privacy and tests](#lifecycle-privacy-and-test-checklist)

## context and availability

Sources: [Availability](https://core.telegram.org/bots/widgets.md#availability),
[Where widgets live](https://core.telegram.org/bots/widgets.md#where-widgets-live),
[Requests](https://core.telegram.org/bots/widgets.md#requests-to-the-bot),
[Forwards](https://core.telegram.org/bots/widgets.md#forwards),
[Previews](https://core.telegram.org/bots/widgets.md#previews).

The table below describes the full documented feature set. **Only original private chats
with the bot are currently enabled in production**, automatically protected from forwarding.
Groups, inline widgets and forwarding are test-server features at this verification date.
`allow_queries` is necessary in every request-enabled row; without it viewer is null and
requests are refused everywhere, even originals. It is not a grant of background access
outside the private original.

| Context | Tap request | Background request | Chat state | `viewer` | Bridge `chatType` |
|---|---|---|---|---|---|
| Original private chat with bot | yes | yes, only visible | this message's | looking user | `private` |
| Original basic group/supergroup | yes | no | one value for every member | looking user | `group`/`supergroup` |
| Original sent via inline bot | yes | no | per sent message | looking user | chat type |
| Forward of shared widget | yes | no | always null | looking user | null |
| Forward of static widget | no | no | always null | null | null |
| Inline result preview | no | no | result's initial state | null | null |

A group requires bot membership plus `can_send_other_messages`; topics are allowed.
Channels refuse direct and inline sends, but can receive forwards where forwarding is
available. The bridge's possible `channel` enum is not permission to post there.

A preview is `isPreview:true`, `isForward:false`: it runs timers/animations/theme but takes
no pointer/tap events, since a tap selects the result. `request` rejects `NOT_ALLOWED`;
links, copy and haptics do nothing; wallet is null. `ready`/`setResizeAnchor` work,
watching has no effect. Storage starts empty and is not persisted.

`isForward:true` tells only that the message is a forward. No chat type, chat state or
location is disclosed. Shared forwards can remain live; static forwards are snapshots as of
forwarding. Every forward retains the author bot header even if the sender is hidden.
`copyMessage`/`copyMessages` refuse widgets. `protect_content` prevents forwarding
([Forwards](https://core.telegram.org/bots/widgets.md#forwards)).

### inline and guest are not interchangeable

[Inline mode](https://core.telegram.org/bots/widgets.md#inline-mode-widgets) uses
`answerInlineQuery` → `InlineQueryResultArticle.input_message_content` with either
[InputWidgetMessageContent](https://core.telegram.org/bots/api/types/inputwidgetmessagecontent.md)
(new source) or [InputSharedWidgetMessageContent](https://core.telegram.org/bots/api/types/inputsharedwidgetmessagecontent.md)
(an existing widget created by this bot). The new-source form with `is_shared` creates a
**new object for every send**. To offer one object, create it with a send, save returned id,
then offer by id. Bots do not receive the messages users send via them; new inline-created
widget ids reach the bot only in a later query. Only widget-capable clients receive widget
inline results.

[answerGuestQuery](https://core.telegram.org/bots/api/methods/answerguestquery.md) accepts an
`InlineQueryResult`, but the widget guide does not describe guest-widget context, update
routing or supported environments. **Do not infer guest support from type composition,
or assert a universal guest prohibition from an undocumented/probed case.** For a guest task,
recheck official documentation, respect current production private-only rollout, and provide
a documented non-widget reply if the requested path is not established. Do not invent a
`guest_widget_query`, guest widget id format or guest background access.

## bot update routing and authorization

Official [WidgetQuery](https://core.telegram.org/bots/api/types/widgetquery.md) and
[SharedWidgetQuery](https://core.telegram.org/bots/api/types/sharedwidgetquery.md) are distinct:

| Field | Direct original `widget_query` | Inline original `widget_query` | Shared forward `shared_widget_query` |
|---|---|---|---|
| `id`, `from`, `data`, `type` | required | required | required |
| `chat`, `message_id` | yes | absent | absent |
| `inline_message_id` | absent | yes | absent |
| `chat_instance` | yes | yes, chat of tap | absent |
| `chat_type` | absent; inspect `chat.type` | optional | absent |
| `widget_id` | only shared | only shared | required |

`chat_instance` is not `chat_id` and cannot substitute for message coordinates.
The Bot API inline-query `chat_type` enum includes `sender`, `private`, `group`, `supergroup`,
`channel`; the **bridge** `chatType` documentation instead lists chat kinds and null, not
`sender`. Keep the two contracts separate. Channels remain subject to sending restrictions.

`from` is authenticated by Telegram and `widget_id` is computed from the tapped message;
no Mini App init-data signature check is needed for these update fields. Still validate all
`data` against authoritative application state/permissions, authorize the actual operation,
and receive updates through a trustworthy Bot API transport. Queries carry **no state**.
A forward reveals no chat/message/instance, so an application rule such as one vote per
person uses `(widget_id, from.id)`, not a forged location/id in data.

[WidgetQueryType](https://core.telegram.org/bots/api/types/widgetquerytype.md) is a nested
object with `type` equal to:

- [`data`](https://core.telegram.org/bots/api/types/widgetquerytypedata.md): optional
  `wallet_card: TonWalletCard` if requested with `{wallet:true}`.
- [`sent_transaction`](https://core.telegram.org/bots/api/types/widgetquerytypesenttransaction.md):
  `wallet: WidgetQueryWallet`, `msg_hash`.
- [`sign_data`](https://core.telegram.org/bots/api/types/widgetquerytypesigndata.md):
  `wallet: WidgetQueryWallet`, `sign_data` (JSON-serialized signed data).

Subscribe to both top-level query update kinds when specifying `allowed_updates`.
Answer either with `answerWidgetQuery({widget_query_id: q.id, data?: text})`; there is no
separate shared-query answer method. Data goes only to the requester. Every query needs an
answer, including rejected/failed operations; do slow work after acknowledging. An answer
has no state edits, popup, notification or URL. State edits and the answer can arrive in
either order. A late answer cannot rescue an expired promise.

## state synchronization

Sources: [The widget's state](https://core.telegram.org/bots/widgets.md#the-widgets-state),
[Static/shared](https://core.telegram.org/bots/widgets.md#static-and-shared-widgets),
[Changing state](https://core.telegram.org/bots/widgets.md#changing-the-state).

Read `publicData`/`chatData` as nullable strings, parse defensively and redraw from state
without restarting the document. A change that touches both fires chat first, then public;
unchanged fields fire no event. No chat-data events in forwards.

- Direct original edit: `editMessageWidgetData` with `chat_id` + `message_id`.
- Inline original edit: same method with `inline_message_id` instead.
- `public_data` on a static original changes only that original; snapshots do not follow.
- Shared public state: `editSharedWidgetData({widget_id, public_data, cache_time?})`, or edit
  public data through an original. Only `editSharedWidgetData` sets refresh period.
- Omitted edit fields are unchanged; empty strings clear; script sees null, not empty string.
- Only the creating bot edits. Edits are silent (no mark/notification/chat-list bump).
  No-op edits fail with `Bad Request: message is not modified`, which can be treated as the
  desired state being present, but does not answer a waiting query.
- Commit an application move after successful publication, so a failed edit does not consume
  a turn. Serialize concurrent transitions; coalesce high-volume shared updates within quotas.
- Deleting an original removes its editable chat state, not the shared object. Shared state
  can still be changed by id after every carrier is deleted.

**Live watching:** `watchPublicData()` is synchronous, repeatable, needs no tap and asks the
client to poll **while visible**, at the shared object's refresh period. One client poll per
shared id serves its on-screen carriers. `unwatchPublicData()` stops this widget's demand.
Static widgets need no polling (state is pushed); previews never watch. Opening/scrolling to
a shared message gets current shared state; an already visible widget without a watcher
gets no live polling promise. Shared polling may deliver older data than a query answer:
put a monotonic revision in state **and answers** and ignore older revisions while rendering.

## initialization, detection and bridge surface

Sources: [Initializing](https://core.telegram.org/bots/widgets.md#initializing-widgets),
[TelegramWidget](https://core.telegram.org/bots/widgets.md#telegramwidget),
[Detecting features](https://core.telegram.org/bots/widgets.md#detecting-features).

`window.TelegramWidget` exists before the first script, with state/theme/context in place.
No external initialization script is needed; outside Telegram it is undefined. Render the
first state synchronously and optionally call `ready()`. Never replace the real object with
a browser shim in a sent source. No `sendMessage` method, no id getter, no automatic identity
where requests are prohibited.

| Member | Contract |
|---|---|
| `profile`, `isProfileAtLeast(n)` | profile 1; predicate returns false for non-number input |
| `isActive` | same visibility as `!document.hidden` |
| `isPreview`, `isForward`, `chatType`, `viewer` | use context matrix; viewer frozen/null |
| `chatData`, `publicData` | read-only strings/null, bot-owned |
| `colorScheme`, `themeParams` | chat light/dark, new frozen palette after change |
| `watchPublicData`, `unwatchPublicData` | synchronous polling demand, no tap |
| `request(data, options?)` | promise resolving to frozen `{result: string|null}`; optional `{wallet:true}` on tap only |
| `onEvent(type, handler)`, `offEvent(type, handler)` | handler `this` is widget, no arguments; read already-updated fields; unknown event ignored |
| `ready()` | optional first-render notification |
| `setResizeAnchor('top'|'bottom')` | top default; before resize; no tap, invalid edge TypeError; early apps lack it, check `typeof` |
| `contentSafeAreaInset` | new frozen object after change; see theme/layout below |
| `copyText`, `openLink`, `openTelegramLink`, `HapticFeedback` | native bridges, not browser clipboard/network access |
| `wallet` | wallet object or null; see wallet section |

Methods return nothing synchronously except `isProfileAtLeast` (boolean), request/wallet
(promises) and haptic methods (chainable HapticFeedback). Deprecated `theme`/`onTheme` aliases
are documented but new code should use `colorScheme`/`themeChanged`.
Use `isProfileAtLeast` for profile additions, `CSS.supports`/`@supports` for retained CSS,
and `typeof` for methods added within profile 1, not inferred client version strings.

[WidgetViewer](https://core.telegram.org/bots/widgets.md#widgetviewer) has `id`; `first_name`,
`last_name`, `username`, `is_premium` are optional and may be absent when the app lacks them.
Do not require every display-name field. Numeric/string bounds are in the limits reference.
Do not use a browser-side viewer object as trusted input to your own backend.

### request failures

Source: [WidgetRequestError](https://core.telegram.org/bots/widgets.md#widgetrequesterror).
Errors have `name:'WidgetRequestError'` and a `code`; invalid argument types/lengths instead
throw `TypeError` before transmission. Show a pending state, success/application denial and
every rejection; do not hide failures in an endless retry loop.

| Code | Meaning / handling |
|---|---|
| `NOT_ALLOWED` | flags/context/tap/preview/app-delivery denial; wallet lacks fresh authorization; change UI/context, not retries |
| `BUSY` | another request/wallet call is in flight; gate interaction |
| `RATE_LIMITED` | background interval or per-user/bot cap; throttle/coalesce |
| `TIMEOUT` | bot missed answer deadline; check update delivery/answer handling; wallet may already have sent payment |
| `FAILED` | message gone, bot blocked/deleted, network failure or other failure |
| `INVALID_ANSWER` | app rejected bot answer before widget code received it |
| `REJECTED` | user declined wallet action |
| `BAD_REQUEST` | wallet rejected sender/network/expiry/cells/payload |

Tap activation requires an actual tap, synchronous handler and visible widget. Do not first
`await`, schedule a timer, use a frame or assume `pointerdown` (which may become chat scroll)
grants it. Request/link/copy share one call per tap. Background calls only follow the private
original rules; the bot cannot distinguish them from tap requests.

## theme, events and layout integration

Sources: [ThemeParams](https://core.telegram.org/bots/widgets.md#themeparams),
[CSS variables](https://core.telegram.org/bots/widgets.md#css-variables),
[Events](https://core.telegram.org/bots/widgets.md#events-available-for-widgets),
[ContentSafeAreaInset](https://core.telegram.org/bots/widgets.md#contentsafeareainset).

Every theme key is present, lowercase `#rrggbb`; incoming/outgoing bubbles have different
palettes. Use variables and `em`/system fonts, not fixed contrast colors. Chat theme drives
`prefers-color-scheme`, `light-dark()` and `color-scheme` live, not the OS setting.
Theme keys: `bg_color text_color hint_color link_color button_color button_text_color
secondary_bg_color accent_text_color subtitle_text_color destructive_text_color
section_bg_color section_header_text_color section_separator_color header_bg_color
bottom_bar_bg_color`. Last section/header/bar keys with no bubble counterpart get the closest
color for Mini App compatibility; separator color also draws native table/HR separators.

Each becomes `--tg-theme-<key-with-hyphens>`. Other root variables:

- `--tg-color-scheme`, `--tg-text-font-size`, `--tg-text-line-height`, `--tg-text-padding`.
- `--tg-button-bg/text/radius/font/padding/height/pressed-opacity/disabled-opacity`
  (expand each suffix with the `--tg-button-` prefix).
- `--tg-content-safe-area-inset-top/right/bottom/left` (each full prefixed name), also
  `env(safe-area-inset-*)`; bottom is the time band's height, other insets zero in this profile.
- `--tg-content-safe-area-corner-left/right`: covered corner width on its side, other zero.
  All time insets/corners zero with caption below. Canvas can read `contentSafeAreaInset`
  `{top,right,bottom,left,cornerLeft,cornerRight}`. Never hard-code time band dimensions.

Root variables are inline `!important` and cannot be overridden there; redefine on your own
elements if necessary. Default styles reserve time band; avoid double-padding if replacing.

| Event | State already available when called |
|---|---|
| `themeChanged` | new colorScheme, palette and CSS variables |
| `activated` | visible/isActive true, after visibilitychange |
| `deactivated` | hidden/isActive false, after visibilitychange |
| `chatDataChanged` | new chat data, never a forward |
| `publicDataChanged` | new public data, live shared updates require watching |
| `contentSafeAreaChanged` | new safe-area object/variables after caption/status layout change |

`chatDataChanged` precedes `publicDataChanged` if one change touches both. Safe-area changes
are caption/time-status driven, not per-frame signals. Respect `prefers-reduced-motion`.

## storage, links, copy and haptics

Source: [Storage, links and haptics](https://core.telegram.org/bots/widgets.md#storage-links-and-haptics).

`localStorage` is **per message per device**, available on first script line, survives widget
recreation and app restarts, cleared with message/chat/account/cache. Never synced or sent
to bot/server. `sessionStorage` has the same scope but lasts until app restart. A new carrier,
even for the same shared id, and every forward start empty. Previews keep nothing. Catch
storage quota errors; authoritative/cross-device state belongs in bot-written data, not local
“already voted” flags. Neither storage is a secure authorization source.

`openLink` accepts external HTTPS only, excluding `t.me`, `telegram.me`, `telegram.dog`;
no credentials in URL, confirmation shows full URL. Use canonical `https://t.me/...` with
`openTelegramLink` inside Telegram; it adds no confirmation of its own, but normal Telegram
confirmations (join/proxy etc.) still apply. Tapped HTTPS anchors and window.open route
through the appropriate bridge. Other-scheme anchors/window.open are ignored; direct method
calls with invalid URLs throw `TypeError`. The widget does not learn whether a link opened.

`copyText` shows a toast containing the copied text, preventing hidden clipboard substitution;
`navigator.clipboard` is unavailable. Neither copy nor link calls work outside the real tap
handler. Haptics run only visible under limits; impact styles `light medium heavy rigid soft`,
notification types `error success warning`, or `selectionChanged()`. Unknown style/type throws
`TypeError`. Desktop/web play nothing. See the limits reference for exact quotas/units.

## wallet: widget-specific TON flow, not invoice payments

Sources: [Payments with wallet](https://core.telegram.org/bots/widgets.md#payments-with-the-wallet),
[WidgetWallet](https://core.telegram.org/bots/widgets.md#widgetwallet),
[WidgetQueryWallet](https://core.telegram.org/bots/api/types/widgetquerywallet.md),
[TonWalletCard](https://core.telegram.org/bots/api/types/tonwalletcard.md).

This is the Telegram built-in wallet bridge with TON Connect **formats**; no separate
connection/manifest/bridge server. It is not `sendInvoice`, Stars checkout or Mini App
`openInvoice`. Use `telegram-payments` for Bot API invoice lifecycles and TON-specific
skills if actually implementing transaction/signature validation.

1. Gate UI on non-null `TelegramWidget.wallet`. It can be null for older clients, unavailable
   countries, missing app wallet, contexts without query rights or previews. Do not promise
   availability from user identity alone.
2. On tap, `request(action, {wallet:true})` gives the bot the user's **profile wallet card**
   via `type:{type:'data',wallet_card:...}`. A user without a wallet gets one created at that
   step. Never request it in background; this is a user-initiated wallet operation.
3. Bot validates the order and answers with a **fresh** TON Connect sendTransaction object:
   `{valid_until?, network?, from?, messages:[{address,amount,payload?,stateInit?}]}`.
   Addresses are user-friendly, amounts are nanotons as decimal strings, payload/stateInit
   are base64. The guide recommends expiry and leaving out `from`: device wallet can differ
   from profile card when backup is disabled. Unknown fields/malformed transaction TypeError.
4. In that tap request's answer handler, call `wallet.sendTransaction(tx, outcomeLabel)`.
   One wallet call is authorized within the fresh-answer window without another tap.
   Telegram's wallet window shows the bot, destinations and amounts and asks the user.
5. Bot receives `type:{type:'sent_transaction',wallet,msg_hash}` with that label and answers
   the query. The wallet promise resolves only with the bot's answer. Verify actual on-chain
   sender, recipients, amounts and outcome, not a hash alone. After `TIMEOUT`, reconcile order
   status before offering retry: the transaction may already have gone out.

`wallet.signData(payload,label)` accepts TON Connect `{type:'text',text}`,
`{type:'binary',bytes}` or `{type:'cell',schema,cell}`. Outcome contains nested `type:'sign_data'`,
wallet and JSON-serialized signed result. Signed domain is `bot<bot_id>`. Verify signature
and tie key to wallet address on chain. `WidgetQueryWallet` has address and decimal-string
balance, optional hex `public_key` plus base64 `state_init` (both omitted together if unknown);
do not assume validation material is always present or authenticate by balance/profile card.
Wallet and ordinary requests share one in-flight slot; wallet has declined/bad-request errors.
All calls are subject to the precise tap/answer/payload limits in the limits reference.

## lifecycle, privacy and test checklist

Sources: [Lifecycle](https://core.telegram.org/bots/widgets.md#lifecycle),
[Privacy](https://core.telegram.org/bots/widgets.md#privacy),
[Testing](https://core.telegram.org/bots/widgets.md#testing).

Offscreen/background: document.hidden true → visibilitychange → deactivated/isActive false;
frames stop, timers throttle. Resume uses activated. Destruction/recreation can happen anytime;
restore from state and Web Storage, never assume in-memory variables survive scrolling.

The widget knows state/theme/language and preview/forward context. It knows viewer only
where it may ask, and original chat type only when provided. The bot learns requester +
data, original context where present, but never a forward's location, a preview, or link-open
outcome through the widget protocol. Code can include language/theme/width/timezone/storage
in request data, so minimize disclosures. Private background requests reveal visibility.
No query from a non-requesting viewer outside that private-background exception is promised.
Never put secrets in HTML/public data or group-visible chat state.

Test only authorized environments/accounts: first render and restored render; private
background request at script start; two-user group shared state/different viewers; inline
preview vs sent message; static forward snapshot vs shared live forward; both themes,
outgoing bubbles, large text, narrow phone, desktop mouse, RTL; caption above/below/absent;
resource limits on older phone; request denial/busy/rate/timeout/network outcomes; stale
poll revisions and wallet decline/uncertain completion. Browser shims prove only layout.
The official guide specifies no general remote console/debug transport; inspect request
routing, API results and visible rendering without inventing one or exfiltrating user data.
