# capabilities, limits and source discrepancies

Verified against official Telegram documentation and the official browser bridge
on 2026-11-10. These are documented contracts/implementation checks, not claims
from device probes. Version numbers below are minimum **client bridge Bot API**
versions, not an npm package version or the currently deployed Bot API server.

## capability gates

Gate by `WebApp.isVersionAtLeast(version)` and the actual API's presence. Then
handle callback failure, user denial, missing hardware and `UNSUPPORTED` events.
A function present in the downloaded JavaScript does not guarantee its native
client implementation exists. Do not infer support from a platform name alone.
Sources: [WebApp methods](https://core.telegram.org/bots/webapps#initializing-mini-apps)
and [events](https://core.telegram.org/bots/webapps#events-available-for-mini-apps).

| minimum version | surface | constraints / handling | source |
|---|---|---|---|
| 6.1 | `BackButton`, `HapticFeedback`, header/background colors, `openInvoice` | haptics may not play; invoice status is not backend fulfillment. Prior to 6.9 header color is limited to theme background/secondary background | [WebApp](https://core.telegram.org/bots/webapps#initializing-mini-apps), [BackButton](https://core.telegram.org/bots/webapps#backbutton), [haptics](https://core.telegram.org/bots/webapps#hapticfeedback) |
| 6.2 | closing confirmation; `showPopup`, `showAlert`, `showConfirm` | handle dismissal, not just a button ID; don't open another popup while one is active | [WebApp](https://core.telegram.org/bots/webapps#initializing-mini-apps), [popup events](https://core.telegram.org/api/web-events#web-app-open-popup) |
| 6.4 | QR scanner, clipboard; `openLink`'s Instant View option | scanner can be closed/denied; stop after accepting a valid code. Clipboard requires permitted launch/context plus direct user interaction; never assume it contains text | [WebApp](https://core.telegram.org/bots/webapps#initializing-mini-apps) |
| 6.7 | `switchInlineQuery` | requires configured bot inline mode; user selects the actual result. Optional chat types: `users`, `bots`, `groups`, `channels` | [WebApp](https://core.telegram.org/bots/webapps#initializing-mini-apps) |
| 6.9 | `CloudStorage`, `requestWriteAccess`, `requestContact`; arbitrary header color | callbacks/events can report cancellation. Write permission is permission to message the user, not access to arbitrary chats. Contact request is a native consent flow, not direct phone-number extraction from init data | [WebApp](https://core.telegram.org/bots/webapps#initializing-mini-apps), [CloudStorage](https://core.telegram.org/bots/webapps#cloudstorage) |
| 7.0 | `SettingsButton`; `openTelegramLink` no longer closes Mini App | settings handler must be removed on teardown; older Telegram-link behavior differs | [SettingsButton](https://core.telegram.org/bots/webapps#settingsbutton), [WebApp](https://core.telegram.org/bots/webapps#initializing-mini-apps) |
| 7.2 | `BiometricManager` | `init()` first, check availability and access status, request access, then authenticate/update token; not proof of server authorization | [BiometricManager](https://core.telegram.org/bots/webapps#biometricmanager) |
| 7.7 | vertical swipe enable/disable; `scanQrPopupClosed` | header swipe still lets the user minimize/close; don't disable vertical swipes unless app gestures conflict | [WebApp](https://core.telegram.org/bots/webapps#initializing-mini-apps) |
| 7.8 | `shareToStory` | opens editor, not automatic publishing; HTTPS media; story links require Premium | [WebApp](https://core.telegram.org/bots/webapps#initializing-mini-apps), [StoryShareParams](https://core.telegram.org/bots/webapps#storyshareparams) |
| 7.10 | `SecondaryButton`, bottom-bar color, button shine | secondary position applies when both buttons show; `left`, `right`, `top`, `bottom` | [WebApp](https://core.telegram.org/bots/webapps#initializing-mini-apps), [BottomButton](https://core.telegram.org/bots/webapps#bottombutton) |
| 8.0 | activity state/events; fullscreen; safe areas; orientation lock | fullscreen can fail with `UNSUPPORTED` or `ALREADY_FULLSCREEN`; expanded height is not fullscreen | [WebApp](https://core.telegram.org/bots/webapps#initializing-mini-apps), [events](https://core.telegram.org/bots/webapps#events-available-for-mini-apps) |
| 8.0 | home-screen shortcut APIs | status may be `unsupported`, `unknown`, `added`, `missed`; some platforms cannot emit a conclusive added event even after installation | [WebApp](https://core.telegram.org/bots/webapps#initializing-mini-apps) |
| 8.0 | `Accelerometer`, `DeviceOrientation`, `Gyroscope` | start/stop callbacks and failure events; requested rate may differ from actual. Check `DeviceOrientation.absolute` even when `need_absolute=true` | [Accelerometer](https://core.telegram.org/bots/webapps#accelerometer), [DeviceOrientation](https://core.telegram.org/bots/webapps#deviceorientation), [Gyroscope](https://core.telegram.org/bots/webapps#gyroscope) |
| 8.0 | `LocationManager` | `init()` first; check `isLocationAvailable`/access flags; `getLocation` may return `null`; optional measurements may be `null` | [LocationManager](https://core.telegram.org/bots/webapps#locationmanager), [LocationData](https://core.telegram.org/bots/webapps#locationdata) |
| 8.0 | `shareMessage`, `downloadFile`, emoji status APIs | prepared-message sharing is user-mediated; download acceptance is not completion. `setEmojiStatus` opens a confirmation dialog; programmatic bot status updates require prior `requestEmojiStatusAccess` authorization | [WebApp](https://core.telegram.org/bots/webapps#initializing-mini-apps), [events](https://core.telegram.org/bots/webapps#events-available-for-mini-apps) |
| 9.0 | `DeviceStorage`, `SecureStorage` | asynchronous callbacks/errors, not a guarantee of storage success. Secure key recovery needs `restoreItem` and user consent; see storage table | [DeviceStorage](https://core.telegram.org/bots/webapps#devicestorage), [SecureStorage](https://core.telegram.org/bots/webapps#securestorage) |
| 9.1 | `hideKeyboard` | no-op when keyboard isn't active | [WebApp](https://core.telegram.org/bots/webapps#initializing-mini-apps) |
| 9.5 | `BottomButton.iconCustomEmojiId` / `setParams({icon_custom_emoji_id})` | distinguish camelCase property from snake_case parameter | [BottomButton](https://core.telegram.org/bots/webapps#bottombutton) |
| 9.6 | `requestChat(req_id, callback)` | ID comes from bot's `savePreparedKeyboardButton`, not a chat ID. Callback reports success/cancellation, not a directly returned chat object. Bot receives the corresponding sharing service message | [WebApp](https://core.telegram.org/bots/webapps#initializing-mini-apps), [savePreparedKeyboardButton](https://core.telegram.org/bots/api#savepreparedkeyboardbutton), [peer-request flow](https://core.telegram.org/api/bots/buttons#requesting-peers-via-mini-apps) |

`WebApp.Serverless` has an official platform-specific contract but no minimum
bridge version stated in its [entry](https://core.telegram.org/bots/webapps#serverless).
Do not guess one. Raw [web events](https://core.telegram.org/api/web-events) also
cover client features beyond the documented `WebApp` wrapper (for example OAuth
or age-verification events); don't invent JavaScript wrapper methods or universal
availability from the event name. Consult that specific official flow if requested.

## documented sizes, capacities and expirations

Preserve the unit: **bytes**, documented **characters**, JS string-length checks,
items and time intervals are different kinds of limits. Do not convert MB to MiB
or infer a limit not specified by the source.

| surface | documented limit / rule | authority |
|---|---|---|
| `sendData` | up to **4096 bytes**, keyboard-button launches only; service message and close | [WebApp](https://core.telegram.org/bots/webapps#initializing-mini-apps) |
| keyboard return count | client processes only the first data-send event for a keyboard app and then closes | [client implementation](https://core.telegram.org/api/bots/webapps#keyboard-button-mini-apps) |
| direct-link `startapp` | maximum **512 characters**; don't confuse with ordinary bot `start` / inline-button `start_parameter` | [Bot API 6.8 changelog](https://core.telegram.org/bots/api-changelog#august-18-2023) |
| popup title | **0–64 characters** | [PopupParams](https://core.telegram.org/bots/webapps#popupparams) |
| popup message | **1–256 characters** | [PopupParams](https://core.telegram.org/bots/webapps#popupparams) |
| popup buttons | **1–3**; default is one `close` button | [PopupParams](https://core.telegram.org/bots/webapps#popupparams) |
| popup button ID / text | **0–64 characters** each; text required for `default` and `destructive`, irrelevant for native localized types | [PopupButton](https://core.telegram.org/bots/webapps#popupbutton) |
| QR scanner help text | **0–64 characters** | [ScanQrPopupParams](https://core.telegram.org/bots/webapps#scanqrpopupparams) |
| biometric permission/authentication reason | high-level API says optional **0–128 characters**; raw protocol omits empty reason and describes supplied reason as **1–128** | [permission params](https://core.telegram.org/bots/webapps#biometricrequestaccessparams), [auth params](https://core.telegram.org/bots/webapps#biometricauthenticateparams), [raw event](https://core.telegram.org/api/web-events#web-app-biometry-request-access) |
| biometric token | **0–1024 characters**; empty string removes token | [raw token event](https://core.telegram.org/api/web-events#web-app-biometry-update-token) |
| story caption | **0–200 characters** regular users; **0–2048** Premium users | [StoryShareParams](https://core.telegram.org/bots/webapps#storyshareparams) |
| story link label | **0–48 characters**; only Premium users can post story links | [StoryWidgetLink](https://core.telegram.org/bots/webapps#storywidgetlink), [StoryShareParams](https://core.telegram.org/bots/webapps#storyshareparams) |
| accelerometer/orientation/gyroscope refresh | requested **20–1000 ms**, default **1000 ms**; actual frequency/platform support can differ | [AccelerometerStartParams](https://core.telegram.org/bots/webapps#accelerometerstartparams), [DeviceOrientationStartParams](https://core.telegram.org/bots/webapps#deviceorientationstartparams), [GyroscopeStartParams](https://core.telegram.org/bots/webapps#gyroscopestartparams) |
| Telegram user/chat numeric identifiers | at most **52 significant bits**; use safe integer representation, never 32-bit truncation | [WebAppUser](https://core.telegram.org/bots/webapps#webappuser), [WebAppChat](https://core.telegram.org/bots/webapps#webappchat) |
| prepared inline message | use returned **`expiration_date`**; no fixed lifespan asserted | [PreparedInlineMessage](https://core.telegram.org/bots/api#preparedinlinemessage) |
| init-data age | inspect signed **`auth_date`**; **no universal TTL documented** in validation sections | [HMAC](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app), [Ed25519](https://core.telegram.org/bots/webapps#validating-data-for-third-party-use) |
| `answerWebAppQuery` delay | optional **`can_send_after`**, in seconds; not a fixed validity duration | [WebAppInitData](https://core.telegram.org/bots/webapps#webappinitdata) |

The [official JavaScript bridge](https://telegram.org/js/telegram-web-app.js),
checked on the same date, additionally enforces `BottomButton` text length at most
**64** and `switchInlineQuery` query length at most **256**, using JavaScript string
`.length` (UTF-16 code units). These are **bridge implementation checks**, not
proof of a universal server byte limit. It rejects empty bottom-button text unless
an icon is configured, and rejects empty `sendData`. Its story-caption check allows
**2048** code units generally;
that does **not** override the documented regular-user **200-character** allowance.
Apply the applicable account-specific documentation and handle native rejection.

## storage is not one interchangeable backend

| storage | scope and security | documented limits | source |
|---|---|---|---|
| `CloudStorage` | per bot/per user cloud data; don't treat it as a secret vault or an authoritative server ledger | **1024 items/keys**; key **1–128 characters**, allowed `A-Z a-z 0-9 _ -`; value **0–4096 characters** | [CloudStorage](https://core.telegram.org/bots/webapps#cloudstorage) |
| `DeviceStorage` | persistent local device data, available only to the creating bot; not cross-device cloud sync | **5 MB per bot per user**; do not invent per-key/string limits absent from this entry | [DeviceStorage](https://core.telegram.org/bots/webapps#devicestorage) |
| `SecureStorage` | encrypted-at-rest device storage; iOS Keychain / Android Keystore; no claim of universal desktop/web support | **10 items per bot per user**; no documented per-item size in this entry | [SecureStorage](https://core.telegram.org/bots/webapps#securestorage) |

Handle error-first callbacks. `SecureStorage.getItem` can return `null` with a
restorable flag; call `restoreItem` only as a deliberate permission flow. Do not
silently move secrets to CloudStorage/plain storage when secure storage fails.
Biometric access and secure storage are separate APIs; neither makes a browser
assertion authoritative for a backend. Keep the bot token off every frontend and
client storage, including SecureStorage.

## user interaction and native UI constraints

These are **client protocol requirements**, not API flood limits for your bot:

| operation | documented interaction/concurrency rule | source |
|---|---|---|
| native popup | no parallel popup; at most **3 consecutive valid events in 3 seconds** while handling is enabled | [popup event](https://core.telegram.org/api/web-events#web-app-open-popup) |
| external `openLink` | respond to user interaction; raw client allows last interaction age at most **1 second**, one open per interaction; protocols follow `web_app_allowed_protocols` client config | [open-link event](https://core.telegram.org/api/web-events#web-app-open-link) |
| clipboard | direct interaction; raw client interaction window **10 seconds**; high-level launch restriction and raw client eligibility differ, see discrepancies below | [clipboard event](https://core.telegram.org/api/web-events#web-app-read-text-from-clipboard) |
| biometric settings | direct interaction, handled at most **once per second** | [biometric settings event](https://core.telegram.org/api/web-events#web-app-biometry-open-settings) |
| location settings | direct interaction within **10 seconds**, no same-type request concurrently | [location settings event](https://core.telegram.org/api/web-events#web-app-open-location-settings) |
| add home-screen shortcut | latest click within **10 seconds**, no same-type concurrent request; success/failure events may be unobservable on some platforms | [home-screen event](https://core.telegram.org/api/web-events#web-app-add-to-home-screen) |
| set emoji status / request status access | latest click within **10 seconds**, no same-type concurrent request | [status event](https://core.telegram.org/api/web-events#web-app-set-emoji-status), [access event](https://core.telegram.org/api/web-events#web-app-request-emoji-status-access) |
| file download | don't overlap request dialogs; a later request may be accepted once the prior download starts. Acceptance means `downloading`, not file completion | [download event](https://core.telegram.org/api/web-events#web-app-request-file-download) |

Invoke gesture-bound APIs directly from the user's handler rather than after a
long asynchronous job. Do not repeatedly reopen prompts after denial. Biometric
and location initializers read capability/access state; they are not permission
requests. Offer settings only from a deliberate gesture if access was denied.
See [biometric](https://core.telegram.org/api/web-events#web-app-biometry-get-info)
and [location](https://core.telegram.org/api/web-events#web-app-check-location) flows.

For `downloadFile`, provide an HTTPS URL and suggested filename. Telegram recommends
`Content-Disposition: attachment; filename="<file_name>"` and
`Access-Control-Allow-Origin: https://web.telegram.org` in the download response
for consistent cross-platform behavior; this is a download interoperability
recommendation, **not** backend authentication or an instruction to allow arbitrary
origins everywhere. [DownloadFileParams](https://core.telegram.org/bots/webapps#downloadfileparams)

## source discrepancies to preserve, not paper over

- The webapps introduction says **seven** launch mechanisms but the page also
  documents guard-bot chat join requests. Follow the actual launch sections;
  don't omit guard mode because of that introductory count.
- `WebAppInitData.start_param`'s field row says attachment links only, while the
  main/direct launch sections explicitly pass `startapp` through `start_param`
  and `tgWebAppStartParam`. Honor the specific main/direct launch sections rather
  than deleting legitimate start data. [field](https://core.telegram.org/bots/webapps#webappinitdata),
  [main](https://core.telegram.org/bots/webapps#launching-the-main-mini-app),
  [direct](https://core.telegram.org/bots/webapps#direct-link-mini-apps)
- High-level `readTextFromClipboard` says attachment-menu launches only. Raw
  client docs allow bots installed in attachment menus or in the configured bot
  whitelist **regardless of launch mode**. Default to the narrower supported
  high-level contract; do not promise broad access or bypass it via raw events.
  [high-level](https://core.telegram.org/bots/webapps#initializing-mini-apps),
  [raw clipboard contract](https://core.telegram.org/api/web-events#web-app-read-text-from-clipboard)
- Biometric reason bounds differ only in empty-value representation: high-level
  optional 0-length text versus raw optional non-empty reason; omit empty reason.
- `settingsButtonClicked` event is listed as 6.1+, while the `SettingsButton`
  controller is 7.0+. A preexisting attachment-menu Settings entry and the newer
  programmatic controller are not the same availability promise.
  [events](https://core.telegram.org/bots/webapps#events-available-for-mini-apps),
  [controller](https://core.telegram.org/bots/webapps#settingsbutton)
- Bot-token HMAC prose says all received fields and compares `hash`; Ed25519
  explicitly excludes **both** `hash` and `signature`. These are different
  algorithms, not a reason to remove `signature` from the HMAC message.
  [validation reference](validation.md)
- The official bridge implementation gates `switchInlineQuery` at **6.6**, while
  its documented high-level minimum is **6.7**. Use the conservative documented
  minimum, not the lower JavaScript guard, when promising support.
  [bridge source](https://telegram.org/js/telegram-web-app.js),
  [method documentation](https://core.telegram.org/bots/webapps#initializing-mini-apps)
