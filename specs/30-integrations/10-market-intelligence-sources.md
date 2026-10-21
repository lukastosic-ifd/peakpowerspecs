# Integration — Market Intelligence sources (market-news mailbox, expected prices)

**Added 2026-10-21 by [DEC-184]** for [F17](../10-features/F17-market-intelligence.md). Two inbound sources and one
processor, all called only by the **Worker**, never by a browser.

## 1. Market-news mailbox (IMAP)

**Direction:** inbound poll · **Protocol:** IMAP over TLS (993) · **Criticality:** low — the screen says there is no
update yet when nothing has arrived.

| Setting (`MarketNews__…`) | Default | Meaning |
| --- | --- | --- |
| `Provider` | empty | Empty: IMAP when `Imap__Host` is set, otherwise not configured (logged once). `Simulated`: the 9 October 2026 sample, for local runs. |
| `Imap__Host`, `Imap__Port`, `Imap__Username`, `Imap__Password`, `Imap__Folder` | —, 993, —, —, `INBOX` | The mailbox. Use an app password for a mailbox that holds only the market updates. |
| `AllowedSender` | `marketnews@peakpower.nl` | Exact sender address; anything else is not read. |
| `RequireAuthenticatedSender` | `true` | Requires `dkim=pass` or `dmarc=pass` for the sender's domain in `Authentication-Results`. |

Unread mail from the sender is stored once by `Message-Id` and then marked read. The original text (which may contain
prices) is kept in `market.market_news_message`, which the customer role cannot read.

## 2. Gemini API (rewriting)

**Direction:** outbound · **Protocol:** HTTPS, REST (`generativelanguage.googleapis.com`, `POST /v1beta/models/{model}:generateContent`,
key in the `x-goog-api-key` header) · **Criticality:** low — without it the price-stripped Dutch text is published unrewritten.
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
