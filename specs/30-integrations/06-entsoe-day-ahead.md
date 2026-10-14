# Integration — ENTSO-E Transparency Platform (day-ahead prices)

**Direction:** outbound poll · **Protocol:** REST, XML over HTTPS · **Criticality:** medium — the
customer's day-ahead card and the cost figures read what it stores; settlement still blocks on a
missing price **[F08-R07]**

> **As built 2026-10-01 by [DEC-169].** The NL day-ahead curve is read from the **ENTSO-E
> Transparency Platform**, live and **backfilled from 2020-01-01**. It replaces **Montel** as the
> day-ahead source of [F08](../10-features/F08-day-ahead-prices.md) (the Montel day-ahead job of
> **[DEC-36]**, **[DEC-75]** and **[DEC-96]** was never built). Forward prices stay on Montel, see
> [02 Montel API](02-montel-api.md). The token is **optional**: with none, the job logs one warning
> and stays idle, and the 2026 EPEX seed **[DEC-149]** keeps working. ⚠ **Amended 2026-10-02 by [DEC-172]:** there is no seed any more, so with
> no token **no day-ahead price is stored or served**.
>
> **As built 2026-10-02 by [DEC-172] — ENTSO-E only, from 2026-01-01.** The EPEX/DERIVED seed is gone
> (migration `RemoveSeededDayAheadPrices`), `BackfillFrom` defaults to **2026-01-01** and the job deletes
> older rows, and the first tick loads all of 2026 (`MaxChunksPerTick` 12). Everything below that still
> says *2020-01-01*, *three month-chunks* or *the EPEX seed* is superseded by this paragraph.

> **As built 2026-10-13 by [DEC-180] (7).** The feed asks again, stamps, records itself and alerts. (1) A request made to fill
> missing days writes only those days. (2) Once a day, on the first tick at or after 16:00 Amsterdam, one request asks again for
> the 7 delivery days before today, with today and tomorrow when they are stored, and a price is written only when it differs at
> 5 decimals. (3) A changed price is stamped `updated_at`; no version is kept. (4) Every tick saves its outcome as one row of
> `market.day_ahead_feed_run`, kept 90 days, and the back office shows the feed's status. (5) The alert
> `DAY_AHEAD_PRICES_MISSING` is raised for today, and for tomorrow from 15:00 Amsterdam, and closes by itself when the day is
> stored. (6) A price change leads to the recalculation of the saved costs and positions of that day. Everything below that
> says "a stored day is never asked for again" is superseded by this paragraph.

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
| `DayAheadIngestion:BackfillFrom` | — | `2026-01-01` ⚠ [DEC-172] (was `2020-01-01`) |
| `DayAheadIngestion:RecheckDays` | — | 7 ⚠ [DEC-180] (7): at most 28, 0 switches the re-check off |
| `DayAheadIngestion:RecheckAfter` | — | 16:00 Amsterdam ⚠ [DEC-180] (7) |
| `DayAheadIngestion:MissingAlertAfter` | — | 15:00 Amsterdam ⚠ [DEC-180] (7) |
| `DayAheadIngestion:RunRetentionDays` | — | 90 ⚠ [DEC-180] (7) |
| `DayAheadIngestion:Provider` | — | empty ⚠ [DEC-180] (7): `Simulated` only on a local run-mode stack |

All of them are documented in `deploy/env.example`. **Getting a token:** register at
transparency.entsoe.eu (*Login → Register*); email transparency@entsoe.eu with the subject *Restful
API access* and the registered address; once access is granted, *My Account Settings → Web API
Security Token → Generate*; put the token in the VM's `.env` as `ENTSOE_SECURITY_TOKEN`.

⚠ **[DEC-180] (7):** no variable is added to the compose file for the five new `DayAheadIngestion:` keys, and all have working defaults. To change one on the VM it is set on the worker service. The keys are `RecheckDays`, `RecheckAfter`, `MissingAlertAfter`, `RunRetentionDays` and `Provider`, as built.

## 3. The response

An XML `Publication_MarketDocument`. **Element names are matched regardless of namespace**, because the
namespace version varies. The path is `TimeSeries / Period (timeInterval start, end; resolution
PT60M or PT15M) / Point (position, price.amount in EUR/MWh)`.

⚠ **How many decimals the amount carries, and whether a published day is ever revised, is not known. To be confirmed after the landing: `max_source_decimals` and `rows_changed` on the saved runs.**

- **Curve type A03:** a missing `position` means the previous point's price continues.
- **Several `TimeSeries` for one day:** `PT15M` is preferred; otherwise the first is taken.
- **`Acknowledgement_MarketDocument`** ("No matching data found") means the day is *not published
  yet*. It is not an error and writes nothing.

## 4. Storage

Into `market.day_ahead_price (delivery_date, pos)`, in **15-minute positions on the Amsterdam
delivery day** mapped through `IMarketCalendar`, so a DST day has **92 or 100** positions. A `PT60M`
price is written to the hour's four quarters. The price is stored as EUR/kWh = EUR/MWh ÷ 1000, with
`source = 'ENTSOE'`. ⚠ **Amended 2026-10-13 by [DEC-180] (3), (7):** rounded half away from zero to 5 decimals; this is the only place a day-ahead price is rounded, and the rounded value is the platform's price. The table gains `updated_at` (null until a stored price is replaced by a different one), and `source` may read `SIMULATED` on a local run-mode stack only.

**Precedence.** An `ENTSOE` row **overwrites** a row from any other source (the EPEX seed, a
`DERIVED_*` row). The Migrator's seeder keeps `ON CONFLICT DO NOTHING`, so an `ENTSOE` row survives a
re-seed.

⚠ **Amended 2026-10-02 by [DEC-172]: only `ENTSOE` is stored.** The EPEX seed and its `DERIVED_*` rows
are deleted (migration `RemoveSeededDayAheadPrices`) and nothing inserts a non-`ENTSOE` price any more.
The `source` column stays. The job's upsert stays `DO UPDATE`, because it completes a half-written day. ⚠ **[DEC-180] (7): the one exception is the `SIMULATED` source of a local run-mode stack, which a token always overrides and a deployed stack is never given.**

## 5. The job

A Worker schedule host mirroring `TradeExpiryJob`, every `DayAheadIngestion:Interval`. Each tick fills
the **missing delivery days** — a day with fewer stored positions than it has, or a non-`ENTSOE` source
(⚠ [DEC-172]: no other source exists any more, so this counts `ENTSOE` rows only) —
**oldest first**, from `max(BackfillFrom, earliest gap)` up to tomorrow. The work per tick is bounded
(three month-chunks), so the backfill is resumable and polite. **Tomorrow is fetched only after 12:00
Amsterdam**; a not-yet-published reply is fine.

⚠ **As built 2026-10-02 by [DEC-172].** (1) Each tick that has a token first runs
`DELETE FROM market.day_ahead_price WHERE delivery_date < @BackfillFrom`, so the stored window starts at
`BackfillFrom`; the count is reported as `RowsPruned` and a tick that pruned anything is logged even when
it made no requests. With no token nothing is pruned. (2) `MaxChunksPerTick` is **12**, replacing the
three above: ten month requests plus today and tomorrow load all of 2026 so far in the first tick, at
most one request a second. (3) ~~A stored day is never asked for again, so after tomorrow's prices land
(about 13:00) every 30-minute tick is idle, with no ENTSO-E call, until 12:00 the next day; the tick is
a cheap database query and is what retries when publication is late.~~ ⚠ **Reversed 2026-10-13 by [DEC-180] (7).** See
[background jobs §2](../20-architecture/06-background-jobs.md).

⚠ **The re-check, as built 2026-10-13 by [DEC-180] (7).** Once a day, on the first tick at or after `DayAheadIngestion:RecheckAfter` (16:00), one request asks again for the `RecheckDays` delivery days before today (default 7), with today and tomorrow when they are stored. Only this re-check can change a stored day. A row is written only for a real change, which is a stored price of the same source whose 5-decimal value differs from the incoming one:

| What the reply holds | Result |
| --- | --- |
| The same price at 5 decimals | Not written, not stamped, not counted |
| A price that differs by 0,00001 EUR/kWh or more | Rewritten, stamped `updated_at`, counted, and the day is handed on to the recalculation of the saved costs |
| A source amount that moves but rounds to the same 5 decimals | Not a change |
| A new position, or a position of another source | A new position is stored without a stamp; a row of another source is left alone |

A reply that lacks a position of a day writes nothing for that day, so a re-check never writes part of a revision. Every tick saves a run (`IDLE`, `COMPLETED`, `FAILED` or `NOT_CONFIGURED`) with what it asked, stored and changed, and for a failure its code and a redacted reason; the token is never stored or logged. The alert is raised for a day with fewer stored quarter-hours than it has (92, 96 or 100) and sends no mail.

## 6. What reads it

The Dashboard's day-ahead card and its CSV export, through `GET /api/v1/market/day-ahead` and
`/export.csv` ([API contracts §2.3A](../20-architecture/05-api-contracts.md)), and the consumption
cost figures **[DEC-149]**. ⚠ **[DEC-180]: the saved costs and positions follow a price through the recalculation queue, and the back office reads the feed's status at `GET /api/v1/data-health/day-ahead`.** ⚠ **[DEC-172]:** every read is from the database and none calls ENTSO-E. The stored price is raw, and the **[DEC-80]** markup never touches it
**[F08-R17]**.
