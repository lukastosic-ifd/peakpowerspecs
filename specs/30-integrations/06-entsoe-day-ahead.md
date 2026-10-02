# Integration — ENTSO-E Transparency Platform (day-ahead prices)

**Direction:** outbound poll · **Protocol:** REST, XML over HTTPS · **Criticality:** medium — the
customer's day-ahead card and the cost figures read what it stores; settlement still blocks on a
missing price **[F08-R07]**

> **As built 2026-10-01 by [DEC-169].** The NL day-ahead curve is read from the **ENTSO-E
> Transparency Platform**, live and **backfilled from 2020-01-01**. It replaces **Montel** as the
> day-ahead source of [F08](../10-features/F08-day-ahead-prices.md) (the Montel day-ahead job of
> **[DEC-36]**, **[DEC-75]** and **[DEC-96]** was never built). Forward prices stay on Montel, see
> [02 Montel API](02-montel-api.md). The token is **optional**: with none, the job logs one warning
> and stays idle, and the 2026 EPEX seed **[DEC-149]** keeps working.

## 1. The request

`GET {EntsoE:BaseUrl}?securityToken=…&documentType=A44&in_Domain={zone}&out_Domain={zone}&periodStart=yyyyMMddHHmm&periodEnd=yyyyMMddHHmm`,
times in **UTC**, from a typed `HttpClient` (`IHttpClientFactory`) with a timeout. `A44` is the
day-ahead price document; `contract_MarketAgreement.type=A01` is added where the API requires it.

| Rule | Value |
| --- | --- |
| Span per request | At most one year; the platform asks for **one month** per call in the backfill and **one day** per call in the daily fetch |
| Pace | At most **one request per second** |
| Failure | Backoff and retry on `429` and `5xx`; every call has a timeout |
| The token | Never logged. A logged URL has the `securityToken` value redacted |

## 2. Settings

| Setting | Env | Default |
| --- | --- | --- |
| `EntsoE:SecurityToken` | `EntsoE__SecurityToken` (compose `${ENTSOE_SECURITY_TOKEN:-}`) | none — optional |
| `EntsoE:BaseUrl` | — | `https://web-api.tp.entsoe.eu/api` |
| `EntsoE:BiddingZone` | — | `10YNL----------L` |
| `DayAheadIngestion:Interval` | — | 30 minutes |
| `DayAheadIngestion:BackfillFrom` | — | `2020-01-01` |

All of them are documented in `deploy/env.example`. **Getting a token:** register at
transparency.entsoe.eu (*Login → Register*); email transparency@entsoe.eu with the subject *Restful
API access* and the registered address; once access is granted, *My Account Settings → Web API
Security Token → Generate*; put the token in the VM's `.env` as `ENTSOE_SECURITY_TOKEN`.

## 3. The response

An XML `Publication_MarketDocument`. **Element names are matched regardless of namespace**, because the
namespace version varies. The path is `TimeSeries / Period (timeInterval start, end; resolution
PT60M or PT15M) / Point (position, price.amount in EUR/MWh)`.

- **Curve type A03:** a missing `position` means the previous point's price continues.
- **Several `TimeSeries` for one day:** `PT15M` is preferred; otherwise the first is taken.
- **`Acknowledgement_MarketDocument`** ("No matching data found") means the day is *not published
  yet*. It is not an error and writes nothing.

## 4. Storage

Into `market.day_ahead_price (delivery_date, pos)`, in **15-minute positions on the Amsterdam
delivery day** mapped through `IMarketCalendar`, so a DST day has **92 or 100** positions. A `PT60M`
price is written to the hour's four quarters. The price is stored as EUR/kWh = EUR/MWh ÷ 1000, with
`source = 'ENTSOE'`.

**Precedence.** An `ENTSOE` row **overwrites** a row from any other source (the EPEX seed, a
`DERIVED_*` row). The Migrator's seeder keeps `ON CONFLICT DO NOTHING`, so an `ENTSOE` row survives a
re-seed.

## 5. The job

A Worker schedule host mirroring `TradeExpiryJob`, every `DayAheadIngestion:Interval`. Each tick fills
the **missing delivery days** — a day with fewer stored positions than it has, or a non-`ENTSOE` source —
**oldest first**, from `max(BackfillFrom, earliest gap)` up to tomorrow. The work per tick is bounded
(three month-chunks), so the backfill is resumable and polite. **Tomorrow is fetched only after 12:00
Amsterdam**; a not-yet-published reply is fine. See
[background jobs §2](../20-architecture/06-background-jobs.md).

## 6. What reads it

The Dashboard's day-ahead card and its CSV export, through `GET /api/v1/market/day-ahead` and
`/export.csv` ([API contracts §2.3A](../20-architecture/05-api-contracts.md)), and the consumption
cost figures **[DEC-149]**. The stored price is raw, and the **[DEC-80]** markup never touches it
**[F08-R17]**.
