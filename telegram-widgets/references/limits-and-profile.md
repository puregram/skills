# widget limits and profile 1

Verified 2026-11-10 against the public [Telegram Widgets guide](https://core.telegram.org/bots/widgets.md).
API tables: Bot API 10.4, indexed verification 2026-11-09, live `sendWidget` rechecked 2026-11-10.
These are server checks or **documented profile/client quotas**, not SDK policy or measured
private experiments. Recheck the linked source if implementing close to a boundary.

## source keys

- **L:** [Limits](https://core.telegram.org/bots/widgets.md#limits).
- **S:** [sendWidget](https://core.telegram.org/bots/api/methods/sendwidget.md),
  [InputWidgetMessageContent](https://core.telegram.org/bots/api/types/inputwidgetmessagecontent.md).
- **C:** [Counting the size](https://core.telegram.org/bots/widgets.md#counting-the-size).
- **P:** [What widgets support](https://core.telegram.org/bots/widgets.md#what-widgets-support),
  with [HTML](https://core.telegram.org/bots/widgets.md#html),
  [inline SVG](https://core.telegram.org/bots/widgets.md#inline-svg),
  [CSS](https://core.telegram.org/bots/widgets.md#css),
  [JavaScript](https://core.telegram.org/bots/widgets.md#javascript),
  [input](https://core.telegram.org/bots/widgets.md#input).

Every row below cites its source key; L is the complete main limits table. `K`, `KB`, `MB`
and “units” below preserve the guide's notation where it does not give an explicit byte
integer. Do not replace UTF-8 bytes with string length or confuse UTF-16 units with code points.

## server and bridge boundaries

| Item | Documented boundary / outcome | Source |
|---|---|---|
| Source HTML | **1–32768 UTF-8 bytes**, valid UTF-8, no U+0000; oversize `INPUT_MEDIA_WIDGET_TOO_LARGE`, invalid text `INPUT_MEDIA_WIDGET_HTML_INVALID` | S, L |
| Compressed source | **4096 bytes**, zlib **level 9**, server compresses plain `html`; oversize `INPUT_MEDIA_WIDGET_TOO_LARGE` | S, L, C |
| Chat/public state | **0–1024 UTF-8 bytes each**, valid UTF-8, no NUL; send/edit oversize `INPUT_MEDIA_WIDGET_DATA_TOO_LARGE`; invalid send `INPUT_MEDIA_WIDGET_DATA_INVALID`, invalid edit `WIDGET_DATA_INVALID` | S, L |
| Caption | **0–1024 characters after entities parsing**; not the HTML byte budget | S; [sendSharedWidget](https://core.telegram.org/bots/api/methods/sendsharedwidget.md) |
| Request data | string of **1–64 UTF-8 bytes**; invalid value throws `TypeError` before send | L; [request](https://core.telegram.org/bots/widgets.md#telegramwidget) |
| Answer data | **0–1024 UTF-8 bytes**; oversize `WIDGET_RESULT_TOO_LARGE`; absent answer data becomes `result: null` | L; [answerWidgetQuery](https://core.telegram.org/bots/api/methods/answerwidgetquery.md) |
| Answer deadline / id validity | **15 seconds**; `TIMEOUT`, late answer refused (`query is too old`) | L |
| Aggregate requests | **5 per 5 seconds per user and bot**, all its widgets and background calls together; `RATE_LIMITED` | L; [WidgetQuery](https://core.telegram.org/bots/api/types/widgetquery.md) |
| In-flight requests | **one** per widget, shared with wallet calls; second call `BUSY` | L; [WidgetWallet](https://core.telegram.org/bots/widgets.md#widgetwallet) |
| Tap privileges | **one** request/link/copy call, synchronously in a real tap handler; no promise/timer/frame delay | L; [Requests](https://core.telegram.org/bots/widgets.md#requests-to-the-bot) |
| Background requests | only original private chat with bot while visible: **one on appearance**, then **one per 5 seconds**; early script call waits for visibility | L; [Requests](https://core.telegram.org/bots/widgets.md#requests-to-the-bot) |
| Message-state edits | `editMessageWidgetData` counts as **one sent message** against ordinary bot sending limits | L; [Changing state](https://core.telegram.org/bots/widgets.md#changing-the-state) |
| Shared edits | **one per second** (including shared public data edited via message); flood wait beyond | L; [editMessageWidgetData](https://core.telegram.org/bots/api/methods/editmessagewidgetdata.md), [editSharedWidgetData](https://core.telegram.org/bots/api/methods/editsharedwidgetdata.md) |
| Shared refresh period | default **30 seconds**; `cache_time` **5–3600 seconds**, omitted preserves current; below 5 refused (`invalid cache time specified`), above 3600 clamped per guide | L; [Static/shared](https://core.telegram.org/bots/widgets.md#static-and-shared-widgets), [editSharedWidgetData](https://core.telegram.org/bots/api/methods/editsharedwidgetdata.md) |
| Storage | **4 KB per area per message**, UTF-8 keys + values; `QuotaExceededError`, failed write stores nothing | L; [Storage](https://core.telegram.org/bots/widgets.md#storage-links-and-haptics) |
| Clipboard | **1–256 UTF-16 code units**, real tap required; `TypeError` or dropped without tap | L; [TelegramWidget](https://core.telegram.org/bots/widgets.md#telegramwidget) |
| Bridge URLs | at most **256 characters**, HTTPS only, no user/password, host must match chosen method; invalid URL `TypeError` | L; [Links](https://core.telegram.org/bots/widgets.md#storage-links-and-haptics) |
| Bridge event handlers | **16 per event type**; extra ignored | L; [TelegramWidget](https://core.telegram.org/bots/widgets.md#telegramwidget) |
| Haptics | visible only; **5 in burst**, refill **10/second**; free during touch and **5 seconds** after lift; without touch **one 1-second series**, next after touch or **10 seconds**; other calls dropped, desktop/web silent | L; [HapticFeedback](https://core.telegram.org/bots/widgets.md#hapticfeedback) |
| Wallet transaction messages | **1–255**; one call per tap or fresh answer, **10 seconds** to use answer authorization; request labels **1–64 bytes** | [WidgetWallet](https://core.telegram.org/bots/widgets.md#widgetwallet), [Wallet flow](https://core.telegram.org/bots/widgets.md#payments-with-the-wallet) |
| Viewer first/last name | each optional, **1–64 characters** when present | [WidgetViewer](https://core.telegram.org/bots/widgets.md#widgetviewer) |
| Viewer username | optional, **5–32 characters**, ASCII letters/digits/underscore | [WidgetViewer](https://core.telegram.org/bots/widgets.md#widgetviewer) |

Source-byte accounting means the actual HTML text, not JSON-escaped representation or its
base64. Zlib here is **RFC 1950** (DEFLATE plus zlib framing/checksum), not gzip or a raw
DEFLATE stream. Do not assume a magic zlib header alone validates a stream. Use a proper
zlib encoder/decoder. Bot API clients submit **uncompressed** `html`, not that stream.
C says Python `zlib.compress(bytes,9)` matches server counting; gzip is about **12 bytes**
larger, other zlib builds can be **a few dozen bytes** either side. These are documented
implementation comparisons, not a universal conversion formula. Leave headroom.

Common send options remain ordinary Bot API options. If explicitly using `allow_paid_broadcast`,
S documents up to **1000 messages/second**, **0.1 Stars per message** withdrawn from the bot;
this is not an exemption from shared-edit or widget-query limits. Do not turn it on implicitly.

## client resource quotas

All entries in this table come from **L**. Counted quotas are documented as identical across
apps; time quotas depend on work and device speed. Throttling is not the same as stopping.

| Resource | Boundary | Beyond it |
|---|---|---|
| JavaScript CPU | **300 ms per second** | timers/frames wait; over-quota task prolongs later waits |
| One JS task, initial script included | **500 ms continuous** | widget stopped |
| Blocking layout reads | **128 per task**, at most **1000 ms combined** | widget stopped |
| App main-thread work | layout reads + about **25 µs/DOM change** + **2 µs/canvas command**, **100 ms/second** | timers/frames wait |
| Memory | **8 MB** | widget stopped |
| Live timers | **64** | `RangeError` |
| Document nodes | **2000**, elements + text + comments | widget stopped |
| DOM changes/method calls | **10000 per task**, includes calls such as `scrollTo` | widget stopped |
| Text | **32 K UTF-16 units/value**, **48 K/document**; counted text, visible, `data-*`/`aria-*` attributes and CSS strings | widget stopped |
| Complex-script text | **8192 units** (guide does not further specify the unit here) | text refused |
| Attribute/inline style | **8 K UTF-16 units each** | widget stopped |
| CSS | **400 rules**, **32 `@keyframes`** | widget stopped |
| Canvas commands | **4000 per canvas per task** | `RangeError` |
| Canvas pixels | total **2048 × 2048** pixels across all canvases; unsized canvas **300 × 150** | widget stopped |
| `data:` image dimensions | **1024 × 1024** pixels | placeholder |
| Script animations (`element.animate`) | **64 running** | additional animations not drawn |
| Heavy elements | **16 at once**, at most **2 with `backdrop-filter`** | widget stopped; last frame drawn without these effects |
| Consecutive crashes | **2** | stopped until app restart |

Heavy means blurred `box-shadow`, `filter`, `backdrop-filter`, `opacity < 1`, or a running
animation of one of those. Each `::before`/`::after` counts. Unblurred shadow, `display:none`
and the default dimming of disabled/pressed buttons do not count. Use theme hint color,
`rgba()` text or SVG `fill-opacity` instead of element opacity for secondary content.

A stopped widget keeps its last frame with a badge; the client rebuilds when shown again,
subject to the consecutive-crash rule. Offscreen it pauses animation frames, fires timers
at most **once per second**, and signals visibility/activation changes
([Lifecycle](https://core.telegram.org/bots/widgets.md#lifecycle)). Cache layout reads and update
only changed elements; a quick browser render proves none of these quotas.

## layout and gestures

Sources: [Sizes](https://core.telegram.org/bots/widgets.md#sizes),
[Native look](https://core.telegram.org/bots/widgets.md#native-look),
[Time corner](https://core.telegram.org/bots/widgets.md#the-time-in-the-corner),
[Gestures](https://core.telegram.org/bots/widgets.md#gestures).

- Width: **200 px to the app's bubble maximum** (guide describes **200–600 px**, phones
  about **320–430 px**). `width` clamps to that range, not a viewport guarantee.
- Height: **50–600 logical px**. Overflow is clipped; no inner scrolling or fullscreen.
  “Under about **560 px at 320 px width**” is design headroom, not a second server limit.
- Omit either dimension for automatic sizing (guide also defines **0** as automatic per axis).
  API parameter tables recommend omission; do not assume returned fields explicitly equal 0.
  Fixed height stays fixed; automatic height adopts first content height and is remembered
  per message. Shared size anchors are fixed at creation, identical in every carrier.
- Body defaults: about **8 px 12 px** margin; text about **15 px**, line height about **1.35**.
  These are client theme examples, not hard layout constants. Your CSS wins over defaults.
- The root is transparent over the bubble; root/body background paints to rounded edges.
  Without a caption **below**, the time/status covers one bottom corner (right, or left in
  RTL). Caption above does not avoid it. Reserve dynamic safe-area values, not a guessed px
  constant. Defaults already add bottom padding; custom safe-area padding needs `body{padding:0}`
  to avoid doubling. Taps on the time belong to the app.
- Width-based media queries and `vw`/`vmin`/`vmax` use bubble width. Height units are unsupported.
  Default resize anchor is top; feature-detected `setResizeAnchor('bottom')` fixes the bottom
  before changes that grow upwards. No tap needed.

| `touch-action` on target or ancestor | Hold | Horizontal drag | Vertical drag |
|---|---|---|---|
| `auto` (default) | chat menu | chat reply | chat scroll |
| `pan-y` | chat menu | widget | chat scroll |
| `none` | widget `contextmenu` | widget | chat scroll |

`pan-x` claims nothing. First movement beyond **10 px** decides for the whole press; a
claimed sideways drag then remains the widget's on both axes. Vertical-first always goes
to chat: handle `pointercancel` and undo pending interaction. Hold: **500 ms within 10 px**.
Double tap: **300 ms, 40 px**, yields two clicks then `dblclick`. Leading **20 px** never
claims gestures (right edge in RTL). Mouse right-click follows the claim rule; mouse clicks,
holds and drags are the widget's. No vertical sliders/drawing/joysticks/map panning: redesign
as horizontal controls or buttons. Keep ordinary space at `auto` so menu/reply remain usable.

## profile: what is retained

Source **P**. Unsupported declarations/selectors/elements/events are removed before drawing
while the rest runs; some have explicit fallbacks below. Do not model this as a browser's
full DOM/CSS or treat an unsupported construct as a fatal error.

### HTML, SVG and media

**HTML in:** `div span p br hr h1`–`h6 header footer main nav section article aside pre
blockquote figure figcaption`; inline `b i u s em strong small mark code kbd sub sup abbr
cite q del ins time`; lists `ul ol li dl dt dd menu`; tables with `colspan`/`rowspan`;
`details summary`; `button`; `canvas`; `<img>` using only data-URL **PNG/JPEG/GIF/WebP**.
`<a href="#id">` has no navigation; HTTPS anchors route through bridge link handling.
Preserved attributes include `class id style title hidden lang dir data-* aria-*`, inline
`on*` handlers running in the sandbox. Unknown elements become inline boxes.

**HTML out:** form controls (`input select textarea option optgroup fieldset legend datalist
output`, etc.) removed with contents; `form` becomes a block and `label` an inline box.
`progress meter dialog`, popovers, `audio video source track`, `iframe frame object embed`,
external scripts/stylesheets (`script src`, `link`), `meta base template slot portal math
ruby rt rp bdi bdo`, and the guide's other non-profile elements. No network images: placeholders,
never fetched. No data-URL **SVG/AVIF/BMP/ICO**; use **inline SVG** for vectors. No legacy
presentation (`center font big tt strike nobr`, `align valign bgcolor border cellpadding
cellspacing color face nowrap`), editing/spellcheck/input attributes, `draggable tabindex
autofocus accesskey`. Inline initial `<script>` works; do not rely on adding script elements
as DOM content to load code. There are no bundled CDN libraries.

**SVG in:** shapes/paths, `g defs symbol use` (fragment references), `transform viewBox text
tspan`, linear/radial gradients and stops, CSS fill/stroke and CSS animation of SVG properties.
**SVG out:** `clipPath mask pattern marker`, filter primitives, SMIL `animate animateTransform
animateMotion`, `foreignObject`, SVG `image` (even data images). CSS `clip` in canvas does not
imply SVG clip-path support.

### CSS

**In:** block/inline/inline-block, flex with `gap`, grid, tables; relative/absolute/fixed
positioning (fixed relative to bubble), `z-index float aspect-ratio box-sizing object-fit`,
`overflow:hidden/clip`; margins/padding, solid/dashed/dotted/double borders, radius, outline,
shadow/opacity/visibility, data-image backgrounds, linear/radial/conic gradients; 2D transforms
and individual `translate rotate scale`.

`filter`: **blur, brightness, drop-shadow**; `backdrop-filter`: **blur, brightness** per detailed
CSS reference. Stay inside heavy-element quotas. Text sizing/weight/style/line-height/font
shorthand; generic system families only (`system-ui sans-serif serif monospace ui-sans-serif
ui-serif ui-monospace ui-rounded`, `-apple-system` mapped to `system-ui`); numeric tabular-nums,
text alignment/decoration/transform/spacing, white-space/wrapping/breaking, single-line ellipsis,
vertical alignment, list styles, RTL/color emoji, `user-select:none/text/auto`.

Named/hex/rgb/hsl colors, transparent/currentColor/light-dark and color-scheme; transitions,
keyframes, cubic-bezier/steps/linear timing, animation-play-state and events. Units
`px em rem % ch ex vw vmin vmax`; `calc min max clamp`, variables, safe-area `env()`, generated
content strings/`attr(data-*)`/counters. Type/class/id/attribute/combinator/structural selectors,
`:not :is :where :root`, `::before/after`, `:active`, mouse-only `:hover`, button-only
`:disabled/:enabled`. `@supports`, `@keyframes`, media width/orientation/chat color scheme/
reduced motion; `touch-action pointer-events cursor`.

**Out or degraded:** height-relative units (`vh dvh svh vb` etc.); scroll/auto overflow becomes
hidden, sticky becomes relative. Logical properties, multi-column, `display:contents/flow-root/
list-item`; 3D/perspective, other filters (grayscale/saturate/contrast/etc.), clip-path/masks/
blend/isolation; text-shadow, line-clamp, gradient text, vertical writing/text-orientation;
modern colors (`hwb lab lch oklab oklch color color-mix`); non-safe-area `env()`, external
`url()`/`image-set()` except data images or fragments; named fonts, `@font-face`, `@import`,
`@namespace`, container/layer/property/nesting and other unlisted at-rules (`@scope`, `@page`,
`@starting-style`, etc.). No `:has :focus* :target :scope :host*`, shadow-part selectors,
`::first-letter/line/marker`, form-state selectors (except enabled/disabled buttons), media
hover/pointer/resolution/print. `CSS.supports` and `@supports` report the **profile**, not
whatever a desktop browser happens to support.

### JavaScript, canvas and input

**In:** ES2023 QuickJS, promises/async-await, timers/animation frames; DOM create/query/innerHTML,
classList/dataset/style/events, `CustomEvent MutationObserver`; layout reads and hit testing,
`getBoundingClientRect offsetWidth getComputedStyle matchMedia elementFromPoint ResizeObserver`.
`IntersectionObserver` always reports visible: use actual lifecycle signals instead.
Canvas 2D paths/Path2D, gradients/text/measureText, transforms/clip/isPointInPath, drawing from
data images/canvases; Web Animations if all apps draw them. `Intl`/navigator.language,
`crypto.getRandomValues/randomUUID TextEncoder TextDecoder URL URLSearchParams structuredClone
AbortController atob btoa`, Web Storage, document visibility, sandboxed eval/new Function.
Element ids are not global JS variables; query elements explicitly.

**Out:** all network APIs (`fetch XMLHttpRequest WebSocket EventSource RTCPeerConnection
sendBeacon importScripts Worker BroadcastChannel`) throw `NetworkDisabledError`. No location/
history navigation; window.open routes to bridge. No dialogs (`confirm:false`, `prompt:null`),
clipboard/share/vibrate/geolocation/mediaDevices/notifications, shadow DOM/custom elements,
Blob/FileReader/object URLs/fullscreen. Focus/blur are no-ops, not ways to summon input.
Canvas has no get/put/createImageData, readback/toDataURL/toBlob/captureStream, createPattern,
createConicGradient, shadows, globalCompositeOperation, ctx.filter, WebGL, OffscreenCanvas
or bitmaprenderer.

**Input in:** click; pointer down/move/up/cancel/enter/leave/over/out with coordinates/type,
pointer capture, mouse compatibility events; double click; contextmenu under the gesture
claim; preventDefault(pointerdown); animation/transition events and details toggle.
**Out:** touch events (use pointer events), keyboard/focus/text input, wheel/scroll. A key
press never grants a privileged bridge gesture. Text is nonselectable by default; opt in
with `user-select:text` and `-webkit-user-select:text`, with inherited opt-out `none`.
The widget cannot read selection.

## documentation discrepancies: choose the detailed reference

The guide's [LLM appendix](https://core.telegram.org/bots/widgets.md#writing-widgets-with-an-llm)
is useful, but compressed summaries disagree with the detailed tables:

- It says exceeding 64 script animations stops the widget; **L says extra animations are not drawn**.
- It lists `:disabled/:enabled` among unsupported form selectors, while the detailed CSS
  section explicitly allows them on buttons; use the button exception.
- It groups drop-shadow with both filter kinds; detailed CSS lists backdrop blur/brightness only.
- It calls forms/labels out collectively; detailed HTML explicitly defines their box fallbacks.
- Some illustrative query JSON omits `type`; current API query tables require `type`.
- API `cache_time` lists 5–3600; the guide additionally specifies clamping above the maximum.

Report these as source differences, not private observations. Do not fabricate extra numeric
bounds (DOM nesting, total SVG paths, canvas scale, arbitrary URL byte counts, wallet payload
sizes or viewer-name encoding) when the official sources do not specify them.
