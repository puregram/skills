# init data validation, sessions and replay

Official contract checked 2026-11-10:
[bot-token HMAC](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
and [third-party Ed25519](https://core.telegram.org/bots/webapps#validating-data-for-third-party-use).
The pseudocode below names cryptographic arguments explicitly because libraries
use different argument orders. Use vetted crypto primitives, not custom crypto.

## shared parsing and canonicalization

1. Receive the exact `Telegram.WebApp.initData` string over HTTPS. The browser's
   `initDataUnsafe` and any separately submitted `user`, `query_id`, `start_param`
   or `auth_date` are untrusted. The server decides its expected bot and environment.
2. Parse the query-string encoding once into key/string-value pairs. Apply normal
   query decoding (`+` represents a space; percent escapes represent encoded
   bytes). Do not URL-decode a decoded value again. Reject malformed encodings
   and ambiguous duplicate keys as an application hardening policy: Telegram's
   canonicalization is defined for fields, not competing duplicate interpretations.
3. Preserve **all** received fields except the exclusions for the chosen algorithm.
   Keep unknown/future fields; a whitelist assembled from today's documentation
   breaks signatures. Sort keys alphabetically with deterministic ordinal ordering
   for Telegram's ASCII field names, not locale-dependent collation.
4. Join `key=value` pairs using a single LF byte (`0x0A`), without a trailing LF.
   Encode the message as UTF-8. Do not trim, normalize Unicode, re-escape slashes,
   pretty-print, reorder JSON properties or rebuild a `user` object before hashing.
   A nested value is the original decoded JSON **string**, not a freshly serialized
   object. Spaces and punctuation are part of its signed value.
5. Decode and validate the proof's encoding with the crypto library; fail closed
   on missing/malformed proof, invalid keys or verification errors. Do not trust
   parsed identity until the selected cryptographic check succeeds.

Example of the canonicalization distinction (symbolic values, not a test vector):

```text
received fields: auth_date, hash, signature, user
HMAC message:
  auth_date=<original decoded string>\nsignature=<original decoded string>\nuser=<original decoded JSON string>
Ed25519 message:
  <expected_bot_id>:WebAppData\nauth_date=<original decoded string>\nuser=<original decoded JSON string>
```

Never share one indiscriminate “remove hash and signature” canonicalizer between
these algorithms. It is correct for Ed25519, not for the bot-token HMAC contract.

## bot-controlled backend: HMAC-SHA-256

Keep the bot token **only on the trusted backend**. A party that has the token can
forge this proof; do not send a token to a Mini App frontend or an analytics vendor.

```text
received_hash = strict_hex_decode(fields["hash"])
message = canonical_pairs(fields excluding "hash")
secret = HMAC_SHA256(key = UTF8("WebAppData"), data = UTF8(bot_token))
expected_hash = HMAC_SHA256(key = secret, data = UTF8(message))
accept cryptographic proof only if constant_time_equal(expected_hash, received_hash)
```

`secret` is the binary HMAC digest, not its hexadecimal text. `signature`, if
present, remains in `message`. Do not apply the website Login Widget's token
SHA-256 derivation: Mini Apps use the `WebAppData` HMAC derivation instead.
The [official HMAC description](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
uses “all received fields”; `hash` is the comparison value, while `signature` is not
an exclusion in this algorithm.

## third party: Ed25519 without receiving the bot token

A third party receives raw init data and the bot ID, but must bind verification to
its **expected/authorized bot ID** and the configured Telegram environment. Merely
accepting an arbitrary caller-selected bot's identity is not your app's login policy.

```text
signature = strict_base64url_decode(fields["signature"])
message = expected_bot_id_as_decimal + ":WebAppData\n"
          + canonical_pairs(fields excluding "hash" and "signature")
accept cryptographic proof only if Ed25519_verify(
    public_key = telegram_environment_key,
    message = UTF8(message),
    signature = signature
)
```

Use the base64url decoder's appropriate optional-padding handling; do not decode
`signature` as hex, or compare it to an HMAC. Do not include `hash`, and do not
omit the `<bot_id>:WebAppData\n` prefix. Telegram publishes these **public** keys
(hexadecimal encoding, not secrets) in the
[third-party validation section](https://core.telegram.org/bots/webapps#validating-data-for-third-party-use):

| environment | Ed25519 public key |
|---|---|
| production | `e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d` |
| test | `40055058a4ee38156a06562e52eece92a771bcd8346a8c4615cb7376eddf72ec` |

Select a configured key, not a key supplied by the requester. If an Ed25519 proof
is absent or invalid, fail this authentication path; do not quietly accept
`initDataUnsafe`, an unsigned object or a browser's “validated” result. Bot-owned
backends may deliberately implement HMAC as their chosen protocol, but an external
party does not need or get the bot token to validate Telegram's Ed25519 signature.

## freshness is not a universal TTL or complete replay prevention

Telegram recommends checking `auth_date` to prevent outdated data; it does **not**
set a universal Mini App init-data expiry interval in either validation section.
After checking the proof:

- Require a well-formed signed Unix timestamp; choose a maximum acceptable age
  and future-clock tolerance appropriate to the operation. Document these as
  **application policy**, not Telegram limits. Reject missing, expired or
  unreasonably future data before establishing an authenticated session.
- Bind the session to the verified bot/environment and verified `user.id` when
  present. If the launch has no verified user, do not synthesize authenticated
  identity. Store Telegram identifiers without truncating to 32 bits; the
  [user/chat contract](https://core.telegram.org/bots/webapps#webappuser) allows up
  to 52 significant bits.
- Exchange initial proof for your normal protected backend session when useful;
  apply its expiry, CSRF/origin protections and revocation policy. Raw init data
  acts like a bearer credential during your acceptance window: avoid logging it
  or passing it in URLs. TLS does not stop replay by someone who already stole it.
- Protect state-changing operations with per-action nonces/idempotency keys and
  an atomic server-side record or transaction; check object ownership and expected
  state. Repeating an authenticated HTTP request must not duplicate fulfillment,
  rewards, withdrawals or join approvals. A signature authenticates launch data,
  not arbitrary additional request fields or user consent to every operation.
- Do not declare all init data universally single-use: a legitimate app can make
  multiple requests during a session. If enforcing single-use login exchange,
  persist that decision atomically and make its retry/session semantics explicit.
- `query_id` and `chat_join_request_query_id` serve specific Telegram workflows;
  they are not general-purpose app replay protection. Honor `can_send_after`
  when present and handle invalid/consumed workflow IDs as real errors.
- A verified `chat_instance` is an opaque context identifier, not a Bot API chat
  ID or proof that the user is a member/admin. A signed `start_param` is still
  link-supplied input. Validate business rules independently.

Hosted exception: the official
[Serverless endpoint transport](https://core.telegram.org/bots/webapps#serverless)
automatically passes init data for platform verification. This applies to that
platform contract, not to arbitrary public endpoints, and does not remove
application authorization or input validation.
