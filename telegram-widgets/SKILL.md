---
name: telegram-widgets
description: >
  use for Telegram embedded HTML message widgets in any language or SDK: sendWidget,
  sendSharedWidget, Widget, widget_query/shared_widget_query, window.TelegramWidget,
  immutable HTML with mutable chat/public data, zlib size accounting, profile-1 rendering,
  sandbox/network restrictions, bridge requests, context/privacy, wallet calls and testing.
  Not the legacy website login/post widgets, not Mini Apps (Telegram.WebApp), and not
  rich-message HTML. For @puregram/widgets implementation details also read puregram-widgets.
---

# telegram embedded HTML widgets

A widget is a self-contained HTML document or fragment rendered **inside a message bubble**.
Inline CSS and JavaScript run in QuickJS, not a browser/WebView. The app filters rendering
against its widget profile. There is no network, keyboard, hosted page or bundled library.
Use a Mini App for a larger networked UI; use the website widget documentation for embedding
Telegram posts or login on a website. Those are different products.

## source and reading map

Verified against the public [widget guide](https://core.telegram.org/bots/widgets.md) and
Bot API 10.4 documentation, retrieved 2026-11-10; the indexed API entries were checked
2026-11-09. This is **profile 1**, not a claim about future availability or SDK support.
Recheck exact methods through the sibling `telegram-bot-api` lookup when implementing.
The sibling `telegram-core-docs` can search/read the guide; this skill ships no lookup tools.

Read these before choosing a design, not only after a failure:

- [limits and profile](references/limits-and-profile.md): every published size/resource,
  rendering and gesture limit; allowed/unsupported HTML, SVG, CSS, JS and media.
- [bridge and context](references/bridge-and-context.md): complete request/context matrix,
  fields, events, theme/safe area, storage, links, wallet and lifecycle behavior.

## availability is part of the contract

[Availability](https://core.telegram.org/bots/widgets.md#availability) currently says:

- **Production:** only private chats with users; widget messages automatically have protected
  content and cannot be forwarded ([sendWidget](https://core.telegram.org/bots/api/methods/sendwidget.md),
  [sendSharedWidget](https://core.telegram.org/bots/api/methods/sendsharedwidget.md)).
- **Test server:** private chats, groups, inline mode and forwards. Use separate test accounts
  and bots as described in [the test-environment guide](https://core.telegram.org/bots/webapps.md#using-bots-in-the-test-environment).
- Direct/channel-inline posting is unsupported; test-server users may forward to channels.
  Groups require membership and `can_send_other_messages`, including forum topics
  ([groups](https://core.telegram.org/bots/widgets.md#widgets-in-groups)).
- Unsupported clients show unsupported media **with the caption**. Always supply meaningful
  caption text for notifications, search, accessibility and unsupported clients. Profile 1
  has no accessibility semantics even though it preserves `aria-*` attributes.

Do not generalize test behavior to production, or production rollout restrictions into a
permanent protocol prohibition. The guide does not establish a guest-widget lifecycle;
`answerGuestQuery.result` accepting an `InlineQueryResult` is not a guarantee that widget
content works there. See the context reference for the documented boundary.

## the data model

[Code and state](https://core.telegram.org/bots/widgets.md#code-and-state): source HTML,
size anchors and request flag are fixed at creation. No method replaces a sent widget's
HTML; send a new widget for a new layout. A caption can be edited with `editMessageCaption`.

| | Static widget | Shared widget |
|---|---|---|
| Create | `sendWidget` without `is_shared` | first `sendWidget` with `is_shared: true` |
| Identifier | none | returned `Message.widget.id` (opaque string) |
| `public_data` | per message; forward is a frozen snapshot | one state for all messages/forwards showing it |
| `chat_data` | per original message | per original message, not per widget id |
| Forward | no chat data, no requests | no chat data; tap requests only with `allow_queries` |
| Send again | forwarding where available | `sendSharedWidget` with its `widget_id` |

Only the **creating bot** edits state or sends its shared widget again. The sources do not
promise cross-bot, cross-environment or cross-server portability of identifiers. Do not
invent a static-widget id, a file id, a `createWidget` method or a `TelegramWidget.widgetId`.
The sandbox is not told its widget id. Shared widgets outlive deleted carrier messages.
See [static/shared semantics](https://core.telegram.org/bots/widgets.md#static-and-shared-widgets).

Both state values are opaque UTF-8 strings, often serialized JSON, at most **1024 bytes each**.
No NUL. At send, omission means absent. In edits, omission means unchanged, `""` clears;
inside the widget, absent/cleared state is `null`. Only the bot writes these fields; assigning
`chatData`/`publicData` or returning an answer cannot persist a change. Never place secrets
in HTML/public state; all group members see that message's chat state.

## sending and compression: do not confuse the layers

The official Bot API accepts **plain source HTML as the `html` string**. The server packs it.
Do not send gzip, raw DEFLATE, base64, an attachment, or compressed bytes in `html`.
The size check is over the UTF-8 source and its **RFC 1950 zlib-wrapped DEFLATE at level 9**:
not RFC 1952 gzip, and not raw DEFLATE. JSON escaping does not change the source-byte count.

Language-neutral preparation:

```text
source_bytes = UTF8_ENCODE(html_source)
require 1 <= LENGTH(source_bytes) <= 32768
require html_source contains no U+0000
packed_for_measurement = ZLIB_COMPRESS(source_bytes, level = 9, wrapper = zlib)
require LENGTH(packed_for_measurement) <= 4096
POST /bot<TOKEN>/sendWidget with Content-Type: application/json
JSON_ENCODE({chat_id: target_chat, html: html_source,
             caption: "Shared counter", is_shared: true, allow_queries: true,
             public_data: JSON_ENCODE({r: 0, n: 0})})
```

Use the full HTML below as `html_source`; `target_chat` is an authorized private chat in
production. `caption`, `is_shared`, `allow_queries` and `public_data` are ordinary sibling
parameters, not nested under `widget`. The response is `{ok:true,result:Message}`; save
`result.widget.id` from a shared send, plus original message coordinates if needed.

For the official size calculation, independently of your implementation language:

```sh
python3 -c 'import sys,zlib; h=sys.stdin.buffer.read(); h.decode("utf-8"); print(len(h), len(zlib.compress(h,9)))' < widget.html
```

[Counting the size](https://core.telegram.org/bots/widgets.md#counting-the-size) says Python's
zlib matches server accounting; other builds (including Node's) can differ by dozens of bytes.
`gzip -9 -n` is about 12 bytes larger, not an interchangeable validator. Leave headroom;
the actual server response is authoritative. This measurement is not a requirement to ship
Python or precompressed source.

## a complete small HTML example

This shows a shared counter, revision ordering, initial render, live shared polling,
synchronous tap activation, pending/error UI and a safe read-only fallback. It needs no
external script tag or Mini App initialization. Do not embed a browser testing shim in it.

```html
<p id="count">Counter unavailable</p>
<button id="add" disabled>Add one</button>
<p id="status"></p>
<script>
const W = window.TelegramWidget;
const count = document.getElementById('count');
const button = document.getElementById('add');
const status = document.getElementById('status');
let revision = -1;
function apply(text) {
  try {
    const s = JSON.parse(text);
    if (!s || !Number.isInteger(s.r) || !Number.isInteger(s.n)) return;
    if (s.r < revision) return;
    revision = s.r;
    count.textContent = 'Count: ' + s.n;
  } catch (e) {}
}
if (W) {
  apply(W.publicData);
  W.onEvent('publicDataChanged', () => apply(W.publicData));
  W.watchPublicData();
  button.disabled = W.isPreview || !W.viewer;
  button.onclick = () => {
    button.disabled = true;
    status.textContent = 'Sending…';
    let pending;
    try { pending = W.request('add'); }
    catch (e) {
      status.textContent = 'Invalid request';
      button.disabled = false;
      return;
    }
    pending.then(a => {
      let reply = null;
      try { reply = JSON.parse(a.result); } catch (e) {}
      if (!reply || reply.ok !== true) {
        status.textContent = reply && typeof reply.error === 'string'
          ? reply.error : 'Not confirmed';
        return;
      }
      apply(JSON.stringify(reply.state));
      status.textContent = 'Done';
    }, e => {
      status.textContent = 'Not sent: ' + (e.code || 'FAILED');
    }).finally(() => { button.disabled = W.isPreview || !W.viewer; });
  };
  W.ready();
}
</script>
```

`viewer` gates this example's UI, but never authorizes the bot-side operation. The server
must validate each query against authoritative state, permissions and action semantics.
The sample starts no background request and retains native body/time-safe-area styling.
The example's answer format is `{ok:true,state:{r,n}}` or `{ok:false,error:"..."}`.
These are application fields **inside** answer data, not the Bot API response envelope.

## the bot side of that example

[Requests](https://core.telegram.org/bots/widgets.md#requests-to-the-bot) arrive as
`Update.widget_query` or, for a shared forward, `Update.shared_widget_query`. Subscribe to
both if restricting `allowed_updates`. Each carries `id`, `from`, `data`, `type`; handle the
`type.type` discriminator (`data`, `sent_transaction`, `sign_data`), not just the string data.

For any request or wallet implementation, check the [limits reference](references/limits-and-profile.md)
for request and answer UTF-8 sizes, the aggregate per-user/bot rate, the shared in-flight
slot, answer deadline and gesture/fresh-answer authorization window. A correct transaction
sequence still fails when these independent budgets are exceeded.

For `type.type == "data"` and `data == "add"`:

1. Use authenticated `from.id` and the server-provided `widget_id`; reject unknown actions,
   unauthorized widgets or users. Do not trust ids embedded in `data`. The update contains
   **no current state**. Keep `{r,n}` in your own authoritative store keyed by that widget id.
2. Serialize concurrent mutations. Compute `{r: old.r+1, n: old.n+1}` and call
   `editSharedWidgetData({widget_id, public_data: JSON_ENCODE(next)})`. Commit the authoritative
   transition after the successful edit. For high fan-in, aggregate state/editing rather than
   issuing an edit per tap; shared edits are capped at one per second.
3. Call `answerWidgetQuery({widget_query_id: query.id,
   data: JSON_ENCODE({ok:true,state:next})})` within **15 seconds**.
   On rejection/failure, answer with `{ok:false,error:"..."}` serialized into `data`.
   For slow work, acknowledge promptly and publish the eventual result through a state edit.
   Answer data reaches only that requesting widget; it does not change stored widget state.
4. State events and the answer may arrive in either order. The monotonic revision prevents
   an older poll response from rolling the display back.

For message-specific state use `editMessageWidgetData`: address a direct original with
`chat_id` + `message_id`, or an inline original with `inline_message_id`, never coordinates
invented from `chat_instance`. A static widget's `public_data` changes only its original;
a shared widget's `public_data` changes the shared object. Edits are silent. A no-op edit
returns `Bad Request: message is not modified`; still answer the query.

## API routing

| Need | Official API |
|---|---|
| New source | [sendWidget](https://core.telegram.org/bots/api/methods/sendwidget.md) |
| Existing shared object created by this bot | [sendSharedWidget](https://core.telegram.org/bots/api/methods/sendsharedwidget.md) |
| Original message's state | [editMessageWidgetData](https://core.telegram.org/bots/api/methods/editmessagewidgetdata.md) |
| Shared public state / refresh period | [editSharedWidgetData](https://core.telegram.org/bots/api/methods/editsharedwidgetdata.md) |
| Acknowledge either query kind | [answerWidgetQuery](https://core.telegram.org/bots/api/methods/answerwidgetquery.md) |
| Read returned source/state/id | [Widget](https://core.telegram.org/bots/api/types/widget.md) |
| Inline new/shared content | [InputWidgetMessageContent](https://core.telegram.org/bots/api/types/inputwidgetmessagecontent.md) / [InputSharedWidgetMessageContent](https://core.telegram.org/bots/api/types/inputsharedwidgetmessagecontent.md) inside an `InlineQueryResultArticle` |

An inline result with new `html` + `is_shared` creates a **different shared widget per send**.
To share one live state, first send once, save its returned id, then offer `widget_id` content.
Do not invent `InlineQueryResultWidget`. Production inline widgets are currently unavailable.

## test and diagnose deliberately

Use [Testing](https://core.telegram.org/bots/widgets.md#testing), without sending anything to
real users merely to inspect a layout. A browser preview is useful at phone widths, but has
no bridge, no profile enforcement and none of Telegram's resource/gesture limits. A local
stand-in is a test-only aid, never evidence of server/client support; remove it before send.

In an authorized test environment check the relevant contexts, theme and lifecycle cases in
the references: private/background, two-account groups, inline preview vs sent original,
static/shared forwards, outgoing bubble, RTL, large text, caption above/below/absent, mouse,
older phone, offscreen/resume/recreation, denied/slow/failed requests and stale revisions.

- Size rejection: count **UTF-8 source + zlib output**, not characters/base64/gzip.
- Missing feature: compare the profile, then `CSS.supports`, `isProfileAtLeast` and `typeof`.
- `NOT_ALLOWED`: inspect context/flags/tap timing, not an arbitrary retry loop.
- `TIMEOUT`: check both update subscriptions and answer deadline; a late query id is expired.
- No live shared updates: call `watchPublicData()`; respect refresh period and revisions.
- Clipping: fixed/automatic height, text scale and time safe area; no inner scrolling.
- “Widget stopped”: resource table and lifecycle; unsupported CSS alone is silently removed,
  not a crash. Do not invent a debugger/log transport the official docs do not supply.

For puregram implementation names, also read `puregram-widgets`; this skill deliberately
specifies server/client contracts rather than SDK wrappers.
