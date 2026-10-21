---
name: telegram-streaming-replies
description: >
  use when a telegram bot should show a reply while it is still being generated (LLM output,
  long searches, reports), in any language or SDK: `sendMessageDraft`, `sendRichMessageDraft`,
  `draft_id`, `can_stop` / `keep_on_stop`, the `stopped_message_generation` update, the
  "Thinking…" placeholder, and finalizing with `sendMessage`. covers the 30-second draft
  lifetime, rate limits, where drafts are allowed, the measured quirks (string `draft_id` in
  stop updates, stop events for drafts without a stop button), and a complete streaming loop.
  bot api 9.3+ (stop button 10.3), measured live on 10.3.
---

# telegram streaming replies (drafts)

a draft is a temporary, animated preview of a message the bot is still writing. it shows at the
bottom of the private chat and updates in place. it is **never saved**: when the answer is done
you send it as a real message, and the draft disappears.

```
sendMessageDraft(draft_id=7, text="")            → "Thinking…" placeholder
sendMessageDraft(draft_id=7, text="The")         → preview
sendMessageDraft(draft_id=7, text="The quick")   → same draft, new characters animate in
sendMessage(text="The quick brown fox.")         → the real message; the draft goes away
```

exact parameters: `node <telegram-bot-api skill>/tools/botapi.mjs sendMessageDraft
sendRichMessageDraft MessageGenerationStopped`.

> **measured** = observed against the live bot api 10.3 (oct 2026) using a bot plus a real user
> account. limits marked *MTProto docs* come from core.telegram.org/api/bots/ai and are not in the
> bot api reference.

## where drafts work

| target | result |
|---|---|
| private chat, numeric `chat_id` | works |
| private chat topic (bots with topics enabled) | works with `message_thread_id` |
| group / supergroup | `400 Bad Request: TEXTDRAFT_PEER_INVALID` (**measured**) |
| `chat_id: "@username"` of a user | `400 Bad Request: chat not found` (**measured**). the parameter is Integer-only |

## the parameters that matter

| param | rule |
|---|---|
| `draft_id` | non-zero. `0` → `400 Bad Request: RANDOM_ID_INVALID` (**measured**). same id = update in place with animation; a new id = a new draft (some clients collapse concurrent drafts into one, *MTProto docs*) |
| `text` | the **whole text so far**, not a delta. 0–4096 chars; 4097 → `400 Bad Request: MESSAGE_TOO_LONG` (**measured**). `""` shows "Thinking…" |
| `parse_mode` / `entities` | as in `sendMessage`. partial markup mid-stream (an unclosed `<b>`) fails to parse, so prefer `entities`, or close tags before each frame |
| `can_stop` | show a Stop button. a press arrives as `stopped_message_generation` |
| `keep_on_stop` | keep the draft on screen briefly after Stop. it "will still disappear after a short time or if the bot sends a message". to keep the partial answer, send it as a real message |

`sendRichMessageDraft` is the same thing with `rich_message` instead of `text` (see
`telegram-rich-messages`). a `<tg-thinking>` block / `InputRichBlockThinking` shows a "thinking"
placeholder inside rich drafts.

## lifetime and limits

- a draft is "a temporary 30-second preview": it expires 30 s after its **last** update. on a long
  pause (tool calls, retrieval), re-send the same frame before 30 s pass
- a real message from the bot in that chat/topic removes the draft right away (*MTProto docs*)
- **rate limits, per chat**: at most **20 calls per 5 s** and **40 per 30 s**, shared with
  `sendChatAction`. the server may also send short (≤ 3 s) flood waits on bursts (*MTProto docs*).
  sustained that's about 1.3 frames/s, so send a frame **every ~0.8–1 s or every N new
  characters, whichever comes later**, and on a 429 **drop frames** instead of queueing them
- these limits are per chat. ten users streaming at once don't share one budget

## the stop button

```json
{ "update_id": 598726363,
  "stopped_message_generation": {
    "chat": { "id": 96006, "type": "private", "first_name": "devour" },
    "draft_id": "4242" } }
```

**measured** quirks:

- `draft_id` arrives as a **string** (`"4242"`), although the reference types it as Integer.
  normalize before comparing: `String(update.draft_id) === String(myDraftId)`
- the update arrives even for drafts sent **without** `can_stop`. the server forwards any stop
  request for any draft id. ignore ids that don't match a running generation in that
  chat (+ `message_thread_id`)
- after a stop the server still **accepts** further drafts with the same id. stopping is your job:
  cancel the model / upstream request, then finalize or drop

## rules

1. **always finalize.** every exit path (done, error, timeout, stop) ends in `sendMessage` /
   `sendRichMessage` with what you want kept, or in a deliberate drop. a stream that ends with a
   draft leaves the user with nothing after 30 s
2. **one `draft_id` per answer**, unique per chat. derive it from something stable (incoming
   `message_id`, a counter) and never `0`
3. **throttle and drop**, never queue: the newest frame replaces all older ones
4. **roll over before 4096**: when the text approaches the limit, send the finished part as a real
   message and keep streaming the rest under a **new** `draft_id`
5. **cancel upstream work on stop**. the stop update is the user saying "I don't want the rest";
   paying for the remaining tokens is a bug
6. **private chats only**. in groups show progress some other way: `sendChatAction`, or a
   placeholder message you edit (mind the edit flood limits)
7. **send entities, not half-parsed markup**, for formatted streams

## the loop

```
draftId  = incoming.message_id || counter++          // non-zero, unique in this chat
active[chat][draftId] = abortController
sendMessageDraft(chat, draftId, text: "")             // "Thinking…" right away
buffer = ""; lastSent = 0
try:
  for chunk in model.stream(signal = abortController.signal):
    buffer += chunk
    if buffer.length > 3900:                          // roll over before 4096
      sendMessage(chat, buffer[0:cut]); buffer = buffer[cut:]
      delete active[chat][draftId]; draftId = next(); active[chat][draftId] = abortController
    if now - lastSent >= 900ms:                       // throttle
      try sendMessageDraft(chat, draftId, buffer, can_stop: true)
      except 429: pass                                // drop the frame
      lastSent = now
  sendMessage(chat, buffer)                           // finalize
except Aborted:                                       // user pressed Stop
  if buffer: sendMessage(chat, buffer + " …")         // keep the partial answer
finally:
  delete active[chat][draftId]

on stopped_message_generation(u):
  active[u.chat.id]?.[String(u.draft_id)]?.abort()   // string id; unknown ids are ignored
```

## with puregram

`@puregram/stream` implements this loop (throttling, rollover, stop matching, finalize) for
OpenAI / Anthropic / Vercel AI / Ollama / LangChain streams: `update.stream(llmStream, {
canStop: true })`. see `puregram-stream`.

## related

- `telegram-rich-messages`: rich drafts and the thinking block
- `telegram-guest-mode`: progress through edits where drafts aren't available
- `telegram-bot-api`: live lookup
