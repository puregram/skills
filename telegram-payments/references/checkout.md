# checkout, fulfillment and recovery

Reference baseline: official Bot API 10.4 and payment guides, reviewed 2026-11-10.
The API events below are documented; database/outbox/reservation rules are recommended
merchant application design, not Telegram's transactional guarantees.

## pre-checkout: a fast decision, not a receipt

[`PreCheckoutQuery`](https://core.telegram.org/bots/api/types/precheckoutquery.md) contains
`id`, `from`, `currency`, `total_amount`, `invoice_payload`, optional `shipping_option_id`
and optional `order_info`.

Validate against server-owned state:

- payload resolves to the intended offer/order and is still usable;
- payer is allowed to buy it (an invoice's target chat does not identify its buyer);
- currency is exact and total matches the stored quote, permitted shipping and tip;
- selected shipping option is one actually offered for this order/address;
- stock, capacity and existing-order state allow the new purchase;
- subscription/product choice matches the offer, rather than a browser's submitted price.

For mutable stock, reserve atomically as part of the approval decision. Reservation expiry
and release/reconciliation are merchant policy; a stale reservation cannot safely be treated
as evidence that an ambiguous payment failed.

Reply with [`answerPreCheckoutQuery`](https://core.telegram.org/bots/api/methods/answerprecheckoutquery.md):
`pre_checkout_query_id: query.id`, `ok: true`, or `ok: false` with required human-readable
`error_message`. The Bot API must **receive** the answer within **10 seconds after the query
was sent**. Do not put slow fulfillment, email, analytics or a long provider call before it.
If essential validation cannot complete in time, reject rather than approve blindly.

The guide describes the deadline as after receiving the update
([fiat step 7](https://core.telegram.org/bots/payments#7-pre-checkout),
[Stars step 3](https://core.telegram.org/bots/payments-stars#3-pre-checkout)); use the stricter
method wording for latency design. `True` from the answer method only acknowledges the
answer. A timeout/error answering a query is not evidence of a charge or of its absence.

## fulfillment: the actual success message

Process `message.successful_payment` from the authenticated Bot API update channel, not
from client-submitted JSON. Ensure the application's update filtering/routing includes
`message`, `pre_checkout_query` and, when used, `shipping_query`. Do not discard pending
payment messages as a routine deployment shortcut.

[`SuccessfulPayment`](https://core.telegram.org/bots/api/types/successfulpayment.md) includes:

| field | use |
|---|---|
| `currency`, `total_amount`, `invoice_payload` | match against authoritative order/offer state |
| `telegram_payment_charge_id` | persist as Telegram's opaque charge identifier; key for Stars refunds |
| `provider_payment_charge_id` | persist separately for provider reconciliation; not a replacement for the Telegram ID |
| `shipping_option_id`, `order_info` | optional final shipping/customer details; not universally present, especially for Stars |
| `is_recurring`, `is_first_recurring`, `subscription_expiration_date` | optional recurring-payment facts; see the subscription reference |

The successful payment is nested in a `Message`, not a top-level `Update.successful_payment`.
Recover the actual payer from the corresponding message sender and retained checkout
context. Keep unknown/mismatched paid records for reconciliation; do not silently drop a
real success because local state is missing. Investigate and fulfill or arrange a refund
through the correct route, rather than manufacturing an unpaid state.

[Fiat checkout](https://core.telegram.org/bots/payments#8-checkout) and the explicit
[Stars warning](https://core.telegram.org/bots/payments-stars#4-checkout) say to deliver
**after** success. A Mini App callback (including a `paid` display status), Pay-button press,
screenshot, invoice-link response or pre-checkout approval is not server fulfillment proof.

## recommended durable processing model

```text
on verified successful_payment message:
  begin database transaction
    find stored offer/order using payload + actual payer context
    validate currency, amount, shipping and applicable order policy
    insert payment uniquely by bot/environment + telegram_payment_charge_id
    if already recorded: finish without creating another delivery
    attach payment to purchase; record both charge identifiers and received fields
    create durable fulfillment job uniquely for this accepted purchase/payment
  commit
  acknowledge update only after durable capture (or durable queue acceptance)

fulfillment worker:
  claim job and deliver using a stable idempotency key for the destination system
  persist delivery result; retry the same job after transient delivery failures
```

For a single-use order, also enforce the order's allowed number of payments atomically. A
second **different** successful charge is a real additional payment requiring resolution,
not a duplicate update to ignore. For reusable offers, one payload can map to many legitimate
purchases; do not deduplicate all buyers by payload. For subscriptions, deduplicate charges,
not all payments by user or by original payload.

A database transaction cannot magically make a non-idempotent external delivery atomic.
Use an outbox plus an idempotent destination or an explicit reconciliation step for crashes
between delivery and recording its result. These are application guarantees you implement.

## failure classification

- Invoice API error: compare exact current parameters, currency metadata, provider setup,
  XTR-only restrictions and context. Do not repeatedly resend malformed invoices.
- Checkout rejected/expired: expose a useful reason; do not mark the order paid. Let the
  user restart with a current offer when appropriate.
- Network timeout: preserve the attempt and known identifiers. An absent response alone
  does not establish whether a side effect occurred. Do not issue another charge/refund or
  create another fulfillment job just to make local state look consistent.
- Delivery failure **after success**: payment remains paid. Retry delivery by the same
  durable job or follow the merchant's refund/support process; do not ask the user to pay again.
- Dispute/chargeback: `SuccessfulPayment` explicitly warns funds can later be debited.
  Payment success is not irreversible settlement.

For Stars, reconcile order records with `getStarTransactions`; for fiat use the provider's
records and APIs with `provider_payment_charge_id`. The Bot API payment methods cited here
do not offer a generic fiat refund or universal `getPaymentStatus` method. Preserve enough
local history to resolve missing updates; do not promise a lost order can always be rebuilt
from the current bot balance.
