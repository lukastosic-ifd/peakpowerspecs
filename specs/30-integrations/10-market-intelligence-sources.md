# Integration — Market Intelligence sources (market-news mailbox, expected prices)

**Added 2026-10-21 by [DEC-184]** for [F17](../10-features/F17-market-intelligence.md). Two inbound sources and one
processor, all called only by the **Worker**, never by a browser.

## 1. Market-news mail (Resend receiving)

⚠ **Amended 2026-10-30 (product owner):** ~~IMAP over TLS (993)~~. marketnews@peakpower.nl is a Microsoft 365 mailbox, and Microsoft 365
refuses IMAP password sign-in, so the mail is received by **Resend** and the IMAP mailbox is removed from the platform.

**Direction:** inbound, polled by the Worker every 5 minutes · **Protocol:** HTTPS, REST (`api.resend.com`), key in the
`Authorization: Bearer` header · **Criticality:** low — the screen says there is no update yet when nothing has arrived.

**Setup (once):** in Resend, a receiving domain on a subdomain (for example `inbound.peakpower.nl`, with the MX record Resend
shows, so the Microsoft 365 MX records of `peakpower.nl` are untouched); in Exchange, a rule that **redirects** the market mail to
an address on it (a redirect keeps the original sender and its DKIM signature; Exchange Online needs external forwarding allowed
in the outbound spam policy).

| Setting | Default | Meaning |
| --- | --- | --- |
| `MarketNews__Provider` (`MARKET_NEWS_PROVIDER`) | empty | Empty: no mail is read (logged once). `Resend`: the mail Resend received. `Simulated`: the 9 October 2026 sample, for local runs only. |
| `Resend__ApiKey` (`RESEND_API_KEY`) | — | The same key that sends the platform's mail. It must be a **full-access** key: a sending-only key cannot read received mail. Empty with `Resend` stops the Worker at start-up. |
| `MarketNews__AllowedSender` (`MARKET_NEWS_ALLOWED_SENDER`) | `marketnews@peakpower.nl` | Exact sender address; anything else is not read. |
| `MarketNews__RequireAuthenticatedSender` | `true` | Requires Resend's `authentication.dmarc` to be `pass`. A DKIM pass alone does not count, because Resend does not say which domain signed. |

Per poll: `GET /emails/receiving?limit=100` (newest 100), keep the allowed sender, drop the `Message-Id`s already in
`market.market_news_message`, then for each of the rest, oldest first and at most 25, `GET /emails/receiving/{id}` and the
original `.eml` from the signed `raw.download_url` (fetched **without** the API key, https only). Resend has no read flags: the
stored `Message-Id` is the state. The original text (which may contain prices) is kept in `market.market_news_message`, which the
customer role cannot read. Resend is already a processor under [DEC-101] for outgoing mail; it now also holds the market mail it
received (no personal data beyond the sender's address).

## 2. Gemini API (rewriting)

**Direction:** outbound · **Protocol:** HTTPS, REST (`generativelanguage.googleapis.com`, `POST /v1beta/models/{model}:generateContent`,
key in the `x-goog-api-key` header) · **Criticality:** low — ~~without it the price-stripped Dutch text is published unrewritten~~ ⚠ (2026-10-22) without it nothing is published; mail waits and is retried every 5 minutes.
Settings: `MarketNews__Ai__ApiKey` (`GEMINI_API_KEY`, empty = off) and `MarketNews__Ai__Model` (`MARKET_NEWS_AI_MODEL`, default
`gemini-3.8-flash`). One JSON-output request per email; the input is the price-stripped text only, no personal data. A processor
under [DEC-101] ([OQ-123]); use a paid-tier key, because input sent with a free-tier key may be used by Google to improve its products.

## 3. dynamische-energieprijzen.nl (expected prices)

**Direction:** outbound poll every 6 hours · **Protocol:** REST, JSON over HTTPS · **Criticality:** low.

`GET https://dynamische-energieprijzen.nl/api/expected-prices`

```json
{ "inclVat": false, "lastUpdated": "2026-06-09 12:00:09",
  "prices": { "gas": 1.32, "electricity": 0.27, "electricity-solar": 0.11, "solar-feedin": 0.09 } }
```

Only `prices.electricity` (EUR/kWh), `inclVat` and `lastUpdated` (Amsterdam local time, no zone in the document) are
kept, as one row of `market.expected_price` per `lastUpdated`. `ExpectedPrices__Provider`: empty = this API (public, no
key), `Simulated` = the example above, `Off` = not fetched. No agreement covers reuse or availability ([OQ-123]).
