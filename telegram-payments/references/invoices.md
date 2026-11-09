# invoices, amounts and sharing

Official reference baseline: Bot API 10.4; reviewed 2026-11-10. Numeric bounds below are
from linked official sources, not SDK policy or measured behavior.

## amounts: branch on currency first

**Fiat:** `LabeledPrice.amount`, shipping price components, tips and payment totals are
integers in the smallest units. Read the selected currency from the official
[currencies.json](https://core.telegram.org/bots/payments/currencies.json):

- `exp` is the number of decimal digits; parse a decimal string using integer arithmetic
  scaled by `10^exp`, rather than multiplying a binary float and hoping rounding works.
- `min_amount` and `max_amount` are integer-unit bounds represented as strings in the JSON.
  Parse them numerically with adequate range, not lexicographically. Fetch/cache metadata
  with a deliberate refresh policy; record the version/time used to quote an order.
- Validate the supported currency, provider/account support and final total. Provider
  availability and restrictions can be narrower than the Telegram currency list.

The [supported-currencies prose](https://core.telegram.org/bots/payments#supported-currencies)
explains that fiat bounds roughly correspond to **US$1–10000**, change with exchange rates
outside USD, and the amount must fit **12 digits or fewer**. These are not a conversion
algorithm or a substitute for the current JSON bounds. Do not copy a static table for every
currency. [`LabeledPrice`](https://core.telegram.org/bots/api/types/labeledprice.md) gives
**US$1.45 → 145** as an example; it does not say every currency has the same exponent.

**Stars:** `currency: "XTR"`; an invoice amount is an integer number of whole Stars. Do not
multiply Stars by the fiat exponent or use `StarAmount.nanostar_amount` as an invoice input.
The [Stars guide](https://core.telegram.org/bots/payments-stars#1-create-invoice) specifies
prices in Stars. Current [invoice methods](https://core.telegram.org/bots/api/methods/sendinvoice.md)
require exactly **one** `prices` item for Stars. Aggregate the product/bundle into that price
rather than sending separate XTR tax/discount/delivery lines. Do not invent a universal
one-time Stars invoice maximum from the subscription maximum.

For XTR, `provider_token: ""` is the documented value. Tips are unsupported;
`need_name`, `need_phone_number`, `need_email`, `need_shipping_address`,
`send_phone_number_to_provider`, `send_email_to_provider`, `is_flexible` are ignored
([sendInvoice](https://core.telegram.org/bots/api/methods/sendinvoice.md),
[createInvoiceLink](https://core.telegram.org/bots/api/methods/createinvoicelink.md),
[InputInvoiceMessageContent](https://core.telegram.org/bots/api/types/inputinvoicemessagecontent.md)).
Do not claim these flags collect personal details for a Stars order.

For fiat tips, `max_tip_amount` defaults to **0**. At most **4** suggested tips, each positive,
strictly increasing and no greater than `max_tip_amount`
([sendInvoice](https://core.telegram.org/bots/api/methods/sendinvoice.md)). The buyer can choose
a different allowed tip; compare the final total using an explicit allowed-tip policy rather
than only accepting the base subtotal or a suggested value.

## choose an invoice surface

| API | meaning |
|---|---|
| [sendInvoice](https://core.telegram.org/bots/api/methods/sendinvoice.md) | sends a `Message` to a target chat; supports forum/direct-message topic context where documented |
| [createInvoiceLink](https://core.telegram.org/bots/api/methods/createinvoicelink.md) | returns a String link; no `chat_id` or `start_parameter`; supports bot Stars subscriptions |
| [InputInvoiceMessageContent](https://core.telegram.org/bots/api/types/inputinvoicemessagecontent.md) | invoice content nested in an appropriate inline query result; not a send method |

All three specify `title`, `description`, `payload`, `currency`, `prices`; fiat uses the
provider token obtained through BotFather. A bot may route different physical offers/users
to different connected providers
([create-invoice section](https://core.telegram.org/bots/payments#1-create-invoice)).
Keep provider-specific `provider_data` in the format that provider documents; it is not a
Telegram-defined metadata schema. Credentials belong on the server, never in Mini App JS,
inline content intended for users, public examples or logs.

Common field bounds: title **1–32 characters**, description **1–255 characters**, payload
**1–128 bytes** ([sendInvoice](https://core.telegram.org/bots/api/methods/sendinvoice.md),
[createInvoiceLink](https://core.telegram.org/bots/api/methods/createinvoicelink.md),
[inline content](https://core.telegram.org/bots/api/types/inputinvoicemessagecontent.md)).
Bytes are not Unicode character count. Store an opaque order/offer reference as payload;
“not displayed” does not mean encrypted or suitable for secrets.

A custom `sendInvoice.reply_markup` must start with a Pay button; absent markup gives the
default Pay button. A `pay: true` button is **first in the first row**, and invoice-messages
only ([InlineKeyboardButton](https://core.telegram.org/bots/api/types/inlinekeyboardbutton.md)).
A callback button labeled Pay does not become a payment method.

## invoice chat is not payer identity

[Forwarding behavior](https://core.telegram.org/bots/payments#2-choose-forwarding-behavior):

- Empty `sendInvoice.start_parameter`: forwarded copies retain Pay; multiple buyers can
  attempt payment using the same invoice. Inline invoices are always multi-chat.
- Nonempty `start_parameter`: forwards show a bot deep-link URL instead of Pay. The bot can
  create an appropriate new order after the deep link; do not encode secrets there.
- A single-chat invoice in the private chat with the merchant bot can be paid **once**;
  in other chats it can be paid **many times**. The merchant still decides which attempts
  to accept. Neither nonempty `start_parameter` nor a payload is a universal database lock.

The same behavior is documented for [Stars](https://core.telegram.org/bots/payments-stars#2-choose-forwarding-behavior).
Distinguish a reusable **offer** from a single-payer **order** in application data. A shared
invoice can legitimately produce different purchases with the same payload. Resolve the
buyer from the payment/query sender, not the storefront's channel or the user who shared it.
If an offer is deliberately payer-bound, reject other users at pre-checkout.

## shipping (fiat)

Request `need_shipping_address` and set `is_flexible` when the final price depends on
shipping. [`ShippingQuery`](https://core.telegram.org/bots/api/types/shippingquery.md)
contains `id`, `from`, `invoice_payload`, `shipping_address`.

Look up the offer, validate delivery/stock and create allowed options tied to that checkout.
Use [`answerShippingQuery`](https://core.telegram.org/bots/api/methods/answershippingquery.md):

- `shipping_query_id`, `ok: true`, and required `shipping_options`;
- or `ok: false` plus required human-readable `error_message`.

Each [`ShippingOption`](https://core.telegram.org/bots/api/types/shippingoption.md) has
`id`, `title`, `prices: LabeledPrice[]`. Persist/validate the selected option at pre-checkout;
recheck availability there, since a shipping answer is not a payment or stock guarantee.
The official shipping method/guide gives no numeric answer deadline. Respond promptly;
the explicit **10-second** deadline belongs to
[pre-checkout](https://core.telegram.org/bots/api/methods/answerprecheckoutquery.md).
