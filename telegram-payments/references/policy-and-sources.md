# policy, testing and source boundaries

Reviewed 2026-11-10. This is implementation guidance, not individualized financial, tax or
legal advice. Quote current Telegram/provider obligations with their source and scope;
do not make eligibility, settlement or earnings guarantees.

## official sources by responsibility

| question | authoritative source |
|---|---|
| physical goods, provider connection, shipping, live checklist | [Bot Payments API](https://core.telegram.org/bots/payments) |
| digital goods, XTR routing, fulfillment warning, `/paysupport` | [Stars payments guide](https://core.telegram.org/bots/payments-stars) |
| exact method parameters/types | [Bot API payments](https://core.telegram.org/bots/api#payments); individual method/type links in the other references |
| bot/channel subscription lifecycle and subscriber-side UI concepts | [Star subscriptions](https://core.telegram.org/api/subscriptions), explicitly distinguish MTProto from Bot API |
| current fiat exponent/min/max metadata | [currencies.json](https://core.telegram.org/bots/payments/currencies.json), plus provider/account restrictions |
| digital/physical classification and availability obligations | [Bot Developer Terms §3](https://telegram.org/tos/bot-developers#3-availability), [§6](https://telegram.org/tos/bot-developers#6-payments) |
| Mini App launch/authentication/invoice UI | [Mini Apps](https://core.telegram.org/bots/webapps), companion `telegram-mini-apps` skill |

The sibling `telegram-core-docs` and `telegram-bot-api` skills supply public-document lookup
utilities; no utility is bundled with this skill. When an SDK, older article and current
method table disagree, identify their versions rather than guessing a new method or field.

## policy boundaries to retain

- **Physical:** providers process payment details and may limit countries, currencies,
  product categories, merchant eligibility and live access. Telegram does not handle card
  disputes/refunds on the merchant's behalf. The [physical guide live checklist](https://core.telegram.org/bots/payments#live-checklist)
  requires accessible terms, user agreement before purchase and timely customer support
  (a `/support` command or another clear route). Never claim Telegram support will settle
  the customer's merchant dispute.
- **Digital:** inside Telegram apps, Stars are required even if the merchant also operates
  an external website. Do not suggest card, crypto or external-link routing as a loophole
  ([Stars FAQ](https://core.telegram.org/bots/payments-stars#q-i-run-my-own-website-to-process-sales-does-this-mean-i-dont-have-to-use-telegram-stars),
  [terms §6.2](https://telegram.org/tos/bot-developers#6-2-digital-goods-and-services)).
  Classification follows current app-store definitions, not whichever payment API is easiest.
- Digital sellers must respond to `/paysupport` and handle legitimate purchase disputes
  ([Stars disputes](https://core.telegram.org/bots/payments-stars#q-how-are-disputes-handled),
  [terms §6.2.1](https://telegram.org/tos/bot-developers#6-2-1-payment-disputes-for-digital-goods-and-services)).
  Terms and privacy policies should accurately describe actual delivery/data behavior;
  do not copy generic policy text and represent it as legal compliance.
- Keep bot/provider credentials server-side and avoid collecting card data. Request only
  necessary order information, protect purchase records and retain what is needed for
  support/reconciliation under the merchant's applicable retention obligations.
- Developer proceeds are not the user's Star acquisition price. Acquisition costs vary
  with region, taxes and fees ([Star pricing](https://core.telegram.org/bots/payments-stars#star-pricing)).
  Do not promise a fixed fiat conversion or guaranteed withdrawal eligibility.

For earnings questions, consult the current
[reward terms](https://telegram.org/tos/bot-developers#6-2-4-rewards-for-stars) and
[receiving-rewards terms](https://telegram.org/tos/bot-developers#6-2-4-1-receiving-rewards):
rewards use Fragment, availability can vary by user/country, and Stars may be unavailable
for credits/rewards for up to **21 days after receipt**. The terms' values may change; do
not freeze payout rates in invoice code or run withdrawals as a payment implementation test.

Other relevant current policy numbers are **not invoice limits**:

- Topics enabled in private bot chats: terms specify a non-refundable **15%** fee on
  subsequent Stars purchases while enabled, subject to propagation and policy changes
  ([§6.2.6](https://telegram.org/tos/bot-developers#6-2-6-enabling-topics-in-private-chats)).
- Earned Stars expire after **3 years** unless used for the stated credits/rewards
  ([§6.2.7](https://telegram.org/tos/bot-developers#6-2-7-expiration)).

Do not extrapolate these into universal revenue rates or replace current policy review with
this snapshot. Publishing code is not accepting terms, enabling billing or authorizing a
real financial action on the merchant's behalf.

## testing without accidental production effects

The [physical guide's test-provider section](https://core.telegram.org/bots/payments#testing-payments-the-stripe-test-mode-provider)
describes a separate **Stripe TEST MODE** provider: real cards cannot be used there, and
provider test/live tokens are distinct. The guide's live checklist and the provider's own
requirements apply before switching. Do not infer all providers expose identical test modes.

The [Stars testing section](https://core.telegram.org/bots/payments-stars#testing-payments)
points to the [dedicated Telegram test environment](https://core.telegram.org/bots/features#testing-your-bot).
Do not treat Stars production invoices as harmless just because no external provider token
was needed. Never mix production/test credentials, order namespaces or charge records.

Design local handler cases with synthetic updates: valid/rejected checkout, currency/amount
mismatch, shared offers, duplicate success, distinct double payment, missing shipping fields,
delivery crash, recurring renewal, cancellation, refund and same-ID refund ledger entry.
When explicitly authorized, exercise official test environments with separate credentials.
No actual payment, provider connection, refund, bot startup or credential use is required
merely to read or apply this skill to code design.

## known official prose discrepancies

- The physical guide's older [“What can my bot sell?” FAQ](https://core.telegram.org/bots/payments#what-can-my-bot-sell)
  still says digital payments are unavailable on iOS and includes a forward-looking Stars
  update. Its broad statement about unrestricted products is not current universal policy.
  Use the dedicated Stars guide and current developer terms for digital routing/eligibility.
- Guide pre-checkout steps say **10 seconds after receiving**; the
  [API method](https://core.telegram.org/bots/api/methods/answerprecheckoutquery.md) says the
  API must receive the answer **within 10 seconds after the query was sent**. Design for the
  stricter method contract, including transport/queue delay.
- The physical guide's “no commission” claim is scoped to its physical-provider flow. It
  does not establish that Stars have no fees or that developer reward value equals the
  purchaser's cost; current digital terms include the topics fee described above.
- MTProto bot-subscription cancellation examples name `provider_charge_id`; the
  [Bot API method](https://core.telegram.org/bots/api/methods/edituserstarsubscription.md)
  requires `telegram_payment_charge_id`. These are separate API surfaces. Preserve both
  received charge fields and follow the chosen interface's exact contract.
