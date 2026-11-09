---
name: telegram-payments
description: >
  use for Telegram bot or Mini App payments in any language or SDK: fiat physical-goods
  invoices, Telegram Stars (XTR) digital goods, shipping_query, pre_checkout_query,
  successful_payment, currency units, shared invoices, recurring subscriptions,
  refundStarPayment, editUserStarSubscription, and Stars transaction reconciliation.
  covers the server-side purchase and fulfillment lifecycle, not just invoice UI or
  builders. use telegram-mini-apps for frontend launch/authentication/openInvoice;
  this skill owns payment correctness and refund/subscription semantics.
---

# telegram payments

Keep three things separate: **an invoice is an offer; pre-checkout approval is permission
 to attempt payment; `message.successful_payment` is payment evidence for fulfillment**.
A successful payment is not a guarantee against later disputes or chargebacks.

Library-agnostic Bot API guidance. Reference baseline: **Bot API 10.4**, reviewed
**2026-11-10** against official Telegram guides and method/type pages. Core lifecycle
entries were live-refreshed; supporting cached API pages had verification metadata from
2026-11-09. No payment execution or measured client/server probes are implied. Recheck
current method tables before implementation; installed SDK types may lag.

## choose the route before writing code

| offering | route |
|---|---|
| physical goods/services | supported fiat currency plus a provider connected through BotFather; merchant/provider handle settlement, disputes and refunds |
| digital goods/services sold inside Telegram bots or Mini Apps | Telegram Stars, `currency: "XTR"`, empty `provider_token`; not fiat, cryptocurrency or an external-checkout workaround |
| recurring digital access/content | Stars subscription **invoice link**, with `createInvoiceLink.subscription_period` |
| native paid channel membership | separate `createChatSubscriptionInviteLink` flow; not a bot invoice subscription |

Sources: [physical guide](https://core.telegram.org/bots/payments),
[Stars guide](https://core.telegram.org/bots/payments-stars),
[policy §6.2](https://telegram.org/tos/bot-developers#6-2-digital-goods-and-services).
When classification is unclear, explain the boundary and consult current platform/provider
rules; do not relabel a digital item as physical to evade them.

## load the relevant reference

- **Creating/pricing/sharing invoices, fiat vs XTR, shipping:**
  [invoices.md](references/invoices.md).
- **Pre-checkout, fulfillment, duplicate updates, order integrity, recovery:**
  [checkout.md](references/checkout.md). Read before writing handlers.
- **Recurring bot subscriptions, channel subscriptions, Stars refunds/history:**
  [subscriptions-and-stars.md](references/subscriptions-and-stars.md).
- **Support, eligibility, test/live boundaries, known stale prose:**
  [policy-and-sources.md](references/policy-and-sources.md).

The sibling `telegram-bot-api` skill supplies exact method/type lookup; this skill ships
no lookup tool. For example:

```text
node <telegram-bot-api skill>/tools/botapi.mjs sendInvoice createInvoiceLink LabeledPrice
node <telegram-bot-api skill>/tools/botapi.mjs ShippingQuery PreCheckoutQuery SuccessfulPayment
node <telegram-bot-api skill>/tools/botapi.mjs refundStarPayment editUserStarSubscription getStarTransactions
```

## lifecycle to preserve

```text
server records offer/order and expected currency + integer price
  -> sendInvoice / inline invoice / createInvoiceLink
  -> shipping_query if flexible shipping was requested (fiat)
  -> pre_checkout_query: validate current order; approve or reject promptly
  -> wait; approval does not mean paid
  -> authenticated message.successful_payment
  -> atomically record charge and durable fulfillment job
  -> deliver once per accepted charge; retry failed delivery without charging again
```

The API must receive `answerPreCheckoutQuery` **within 10 seconds after the query was
sent** ([method](https://core.telegram.org/bots/api/methods/answerprecheckoutquery.md)).
Budget transport/queue latency too; the guides' wording “after receiving” is not a reason
to start a fresh full deadline at the worker. The cited shipping-query contract gives no
separate numeric deadline; answer promptly, without inventing the same guarantee for it.

### hard correctness rules

- Use integer currency amounts. Fiat uses the currency's current `exp`, `min_amount`,
  `max_amount` from [currencies.json](https://core.telegram.org/bots/payments/currencies.json).
  Do not assume every fiat currency uses cents or freeze all currency limits in code.
  XTR invoice amounts are whole Stars, not fiat minor units or nanostars.
- For XTR, supply exactly **one** `LabeledPrice`; tips are unsupported and shipping/contact
  collection flags are ignored ([sendInvoice](https://core.telegram.org/bots/api/methods/sendinvoice.md)).
- Recompute the expected total from the stored offer plus the validated shipping/tip
  selection; compare currency, payload, amount and payer policy at pre-checkout and again
  on success. Do not trust a frontend-provided price or bind the buyer to the invoice's chat.
- Fulfill only after server-side `successful_payment`, never after approving checkout,
  returning an invoice link, a Pay-button press, or a Mini App `invoiceClosed` callback.
  See [Stars checkout warning](https://core.telegram.org/bots/payments-stars#4-checkout).
- Persist `telegram_payment_charge_id` and `provider_payment_charge_id` as distinct opaque
  fields with the order and actual payer. Use the **Telegram** charge ID plus payer ID for
  Stars refunds, not the provider charge ID, payload, message ID or transaction page offset.
- `refundStarPayment` refunds a successful **Stars** charge. It is not a fiat-refund method,
  and has no partial-amount parameter. Route fiat refunds through the relevant provider.
- Canceling subscription extension is **not** refunding payments or immediately removing
  paid access. `is_canceled: false` allows the user to re-enable; it does not prove renewal.
- Handle `Update.subscription` renewal-state notifications (`canceled`, `active`, `failed`)
  separately from receipts. `BotSubscriptionUpdated` carries user and invoice payload,
  not a charge ID; `active` alone does not extend paid entitlement. See the subscription
  reference for correlation when one user has multiple subscriptions.

Idempotent database writes, inventory reservation, outbox delivery, payer eligibility and
refund authorization are **merchant application design**, not extra Bot API guarantees.
Describe them as such. Do not promise exactly-once transport, automatic order deduplication,
or an invented universal payment-status endpoint.

## minimal Stars invoice body

For `createInvoiceLink`, this synthetic JSON creates an offer, not a purchase. The amount
is an illustrative product price, not a documented limit. Store the offer before issuing it.

```json
{
  "title": "Digital guide",
  "description": "Access to the purchased guide",
  "payload": "opaque-order-reference",
  "provider_token": "",
  "currency": "XTR",
  "prices": [{ "label": "Guide", "amount": 25 }]
}
```

For `sendInvoice`, add the intended `chat_id` and optional messaging fields from its current
reference. For fiat, use the provider token and integer amount for the selected supported
currency, not the XTR body with a currency string changed. Keep credentials server-side.

## scope handoffs

- `telegram-mini-apps`: authenticated frontend/backend identity, launch contexts,
  `window.Telegram.WebApp.openInvoice`, events and client capability checks. Its UI is not
  the fulfillment authority; keep the lifecycle above on the server.
- `telegram-inline-mode`: choosing/sharing inline results; this skill owns invoice semantics.
- `telegram-business-bots`: verify connection and delegated rights before using
  `createInvoiceLink.business_connection_id` (Stars-only in the method table).
- `using-puregram`: optional `Invoice` builders for puregram users; do not require that SDK
  or replace this lifecycle with builder examples.

Use placeholders in examples. Creating invoices in code is not authorization to charge,
refund, cancel a real subscription, connect a real provider, or disclose purchase records.
