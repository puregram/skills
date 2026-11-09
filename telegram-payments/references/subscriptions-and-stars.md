# subscriptions, refunds and Stars reconciliation

Reference baseline: Bot API 10.4, official methods/types and
[Star subscriptions](https://core.telegram.org/api/subscriptions), reviewed 2026-11-10.
MTProto subscriber/client operations are explanatory context, not Bot API methods.

## recurring bot subscriptions

Use [`createInvoiceLink`](https://core.telegram.org/bots/api/methods/createinvoicelink.md),
not a fabricated `sendInvoice.subscription_period` parameter. Set:

- `currency: "XTR"`, empty `provider_token`, exactly **one** `prices` item;
- `subscription_period: 2592000`, currently **30 days**, the only allowed period;
- subscription price no greater than **10000 Stars**.

All these numeric restrictions are in the linked method table. Do not apply the subscription
price cap to unrelated one-time invoices or promise arbitrary weekly/annual billing. The
[protocol guide](https://core.telegram.org/api/subscriptions#bot-subscriptions) also says bot
subscription invoices are exported as invoice links rather than sent as invoice messages.
Opening a link in a Mini App uses the frontend lifecycle in `telegram-mini-apps`; the backend
still handles payment success.

The method explicitly permits any number of active subscriptions, including multiple from
the same user. **A Telegram user is not a unique subscription key.** Model the purchased
subscription separately from each charge and from an optional merchant rule disallowing
concurrent subscriptions. Enforce that rule yourself; Telegram does not impose it.

### payment and entitlement state

[`SuccessfulPayment`](https://core.telegram.org/bots/api/types/successfulpayment.md) has:

- `is_recurring: true` for a subscription payment;
- `is_first_recurring: true` for the first subscription payment;
- `subscription_expiration_date`, the Unix timestamp of the paid period's expiry.

These fields are optional: do not assume they exist on one-time purchases or interpret
absence as a Boolean false field supplied by Telegram. Store the first payment's Telegram
charge identifier as the subscription's retained handle, retain every subsequent charge
separately, and preserve the order/payload relationship. Use the Bot API's documented
`telegram_payment_charge_id` when editing a subscription; do not substitute the
`provider_payment_charge_id` from a different protocol/API example.

On each verified recurring success, idempotently record that charge and update the paid
entitlement to the reported expiration. Avoid adding a hard-coded period on every duplicate
or late update; do not reduce a newer paid-through date when processing an older success.
Renewal is automatic in Telegram according to the
[subscription guide](https://core.telegram.org/api/subscriptions#bot-subscriptions). Do not
implement a second charge loop, or require a fresh interactive checkout approval as proof
of every automatic renewal. Only extend access when payment evidence supports it.

The subscriber can cancel renewal; insufficient Stars can prevent renewal. These states
are described in the [client/protocol management guide](https://core.telegram.org/api/subscriptions#managing-subscriptions).
Do not invent Bot API cancellation/failed-renewal update fields or a Bot API method named
`getStarsSubscriptions`: the similarly named documented listing operations belong to
MTProto. Keep paid-through state and reconcile known charges; absent renewal is not a
reason to keep granting unpaid future periods. Any merchant grace period is explicitly
merchant policy, not Telegram-guaranteed paid access.

### cancel extension vs refund a charge

[`editUserStarSubscription`](https://core.telegram.org/bots/api/methods/edituserstarsubscription.md)
requires `user_id`, `telegram_payment_charge_id` for the subscription, and `is_canceled`:

- `true`: cancels **extension**. The subscription **must stay active through the end of the
  current paid period**. This does not refund a prior payment.
- `false`: allows the user to re-enable a subscription previously canceled by the bot.
  It is not proof that the user opted back in or that another payment succeeded.

Persist renewal-control intent/result separately from paid entitlement and refund status.
Refunding an individual payment is a separate operation; the refund method does not promise
to cancel renewal. If the merchant's authorized resolution is both cancellation and refund,
perform and reconcile both independently, rather than claiming either implies the other.
Do not remove already-paid access merely because cancellation succeeded.

The MTProto guide names `provider_charge_id` for its own bot-cancellation call, while the
Bot API method explicitly names `telegram_payment_charge_id`. Follow the API you are using;
these names are not permission to swap the two fields in Bot API requests.

## native channel subscriptions are a different product

[`createChatSubscriptionInviteLink`](https://core.telegram.org/bots/api/methods/createchatsubscriptioninvitelink.md)
creates a **channel** invite link, requires `can_invite_users` administrator rights and
returns `ChatInviteLink`. Its documented period is **2592000 seconds (30 days)** and price
**1–10000 Stars**; optional link name **0–32 characters**. These are that method's bounds,
not generic bot-invoice rules.

[`editChatSubscriptionInviteLink`](https://core.telegram.org/bots/api/methods/editchatsubscriptioninvitelink.md)
edits a bot-created link's name, not its price/period. The create method points to
`revokeChatInviteLink` for revocation. Revoking an invitation is not a documented refund or
cancellation of every existing member subscription. Do not use `editUserStarSubscription`
as an invented channel-membership billing API.

The [channel-subscription protocol guide](https://core.telegram.org/api/subscriptions#channel-subscriptions)
explains Stars go to the **channel's balance**, with Telegram managing paid join/renewal.
Do not assume these charges appear as the bot's invoice revenue in `getStarTransactions`.
Use `telegram-groups` for chat administration and distinguish membership/link management
from merchant-managed digital entitlements.

## refunds

[`refundStarPayment`](https://core.telegram.org/bots/api/methods/refundstarpayment.md)
accepts only `user_id` of the payer and `telegram_payment_charge_id` of a successful Stars
payment, and returns `True`. It has **no amount parameter**: do not invent partial refunds.
[Policy §6.2.1](https://telegram.org/tos/bot-developers#6-2-1-payment-disputes-for-digital-goods-and-services)
describes returning the Stars in full if unable to fulfill.

Retrieve the charge from server-owned purchase records; authenticate the requester and
authorize the refund according to the merchant's policy. Never accept an arbitrary charge
identifier/user pair from an untrusted client. Record refund intent and outcome durably,
including an unknown result after a network failure. Reconcile before retrying ambiguous
requests; do not describe an unknown/already-refunded error as a new successful refund.

[`RefundedPayment`](https://core.telegram.org/bots/api/types/refundedpayment.md) currently
has currency always `XTR`, `total_amount`, `invoice_payload`, `telegram_payment_charge_id`,
optional `provider_payment_charge_id`; it is available on `Message.refunded_payment`.
Process it idempotently and reconcile with the original charge/refund request.

For fiat, use the payment provider's refund/dispute APIs and provider charge identifier.
`refundStarPayment` and Stars refund messages are not a generic card refund facility.

## transaction history and balances

[`getStarTransactions`](https://core.telegram.org/bots/api/methods/getstartransactions.md)
returns `StarTransactions.transactions` in chronological order. `offset` is the number of
transactions to skip; `limit` is **1–100**, default **100**, per the method. It is an offset,
not a transaction ID, timestamp or cursor token. Page the history, keep durable progress and
overlap/reconcile pages when resuming; do not assume a single page is complete history.

[`StarTransaction`](https://core.telegram.org/bots/api/types/startransaction.md):

- `id` matches `SuccessfulPayment.telegram_payment_charge_id` for successful incoming user
  payments. A **refund shares its original transaction's ID**. Therefore `id` alone is not
  a safe deduplication key for all ledger events: preserve incoming/outgoing direction and
  event kind, so a refund is not suppressed as a duplicate sale.
- `source` is for incoming transactions; `receiver` is for outgoing transactions. Do not
  infer direction from an assumed negative amount or classify every incoming transfer as
  an invoice purchase.
- `amount` is whole Stars; optional `nanostar_amount` is **0–999999999** shares of
  **1/1000000000** Star. Keep precise integer components in reconciliation, not floating
  approximations. Fractional ledger amounts do not enable fractional invoice pricing.
- `date` is Unix time. Inspect partner type and subtype, not just payload presence.

[`TransactionPartnerUser`](https://core.telegram.org/bots/api/types/transactionpartneruser.md)
distinguishes `invoice_payment`, `paid_media_payment`, `gift_purchase`, `premium_purchase`
and `business_account_transfer`; optional `invoice_payload` and `subscription_period` are
available for invoice payments only. The full `TransactionPartner` union also contains
non-user movements. Do not fulfill merchandise for a reward, ad/broadcast debit or refund.

[`getMyStarBalance`](https://core.telegram.org/bots/api/methods/getmystarbalance.md) returns
[`StarAmount`](https://core.telegram.org/bots/api/types/staramount.md): whole `amount` rounded
toward zero, possibly negative, plus optional signed `nanostar_amount` from
**-999999999 to 999999999**, negative only if the whole amount is non-positive. The balance
is not a purchase receipt or a replacement for the order ledger.

Reconcile payments, refunds, renewals and other Stars movements separately. A Star purchase
can be charged back through the provider from which the buyer acquired Stars, debiting the
bot's balance ([StarTransaction warning](https://core.telegram.org/bots/api/types/startransaction.md)).
Do not claim that a recorded success or current balance makes proceeds irreversible.
