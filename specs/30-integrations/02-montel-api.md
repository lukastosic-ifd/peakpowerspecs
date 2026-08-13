# Integration — Montel

**Direction:** outbound poll · **Protocol:** REST/JSON over HTTPS · **Criticality:** high

Two distinct uses of one provider:

1. **Price indications** — forward prices for base and peak, month/quarter/year, shown to customers
   as non-binding indications ([F04](../10-features/F04-price-indications.md)).
2. **Day-ahead prices** — the NL day-ahead curve, used to settle uncovered volume
   ([F08](../10-features/F08-day-ahead-prices.md)).

**An implementation already exists** and should be reused rather than rewritten. This document
specifies what the platform needs from it, not how to call Montel from scratch — the concrete
endpoints, authentication and rate limits must be taken from that implementation and from Montel's
current documentation. **[OQ-52]**, **[OQ-23]**.

---

## 1. What the platform needs

| Need | Frequency | Consumer | Failure impact |
| --- | --- | --- | --- |
| Forward prices for 6–12 configured products | Every 5 min in market hours | Price board, trade wizard estimate | Customers see stale indications; trading continues |
| NL day-ahead curve for D+1 | **Once daily, from 18:00 Europe/Amsterdam [DEC-36]** | Invoicing, chart tooltips, exposure KPI | **Invoicing blocked for affected days** |
| Historical forward prices | On demand | Trend charts | Trend view degrades |
| Historical day-ahead | Backfill, once | Historical positions | Past periods cannot be settled — **and how far back is unknown, [OQ-16]** |

The asymmetry is important: a stale indication is a cosmetic problem, a missing day-ahead price is a
blocked invoice run. They deserve different alerting and different retry aggression.

## 2. Adapter shape

```csharp
public interface IMarketDataProvider          // named for the role, not the vendor
{
    Task<Result<PriceObservation>>        GetLatestAsync(string ticker, CancellationToken ct);
    Task<Result<IReadOnlyList<PriceObservation>>> GetHistoryAsync(string ticker, DateOnly from, DateOnly to, CancellationToken ct);
    Task<Result<IReadOnlyList<DayAheadPrice>>>    GetDayAheadAsync(string marketArea, DateOnly deliveryDate, CancellationToken ct);
}

public sealed record PriceObservation(
    string Ticker, decimal Price, string Currency, string Unit, DateTimeOffset ObservedAt);

public sealed record DayAheadPrice(
    string MarketArea, DateTimeOffset ValidFrom, DateTimeOffset ValidTo,
    decimal Price, string Currency, string Unit);
```

Naming the port `IMarketDataProvider` rather than `IMontelClient` is deliberate: it keeps the
possibility of a second or replacement provider a configuration matter rather than a refactor.

## 3. Product configuration

Ticker symbols are **reference data**, never constants
([F04](../10-features/F04-price-indications.md) §3). Six products for the first release:

| Code | Display | Shape | Period | Offset |
| --- | --- | --- | --- | --- |
| `NL_POWER_BASE_M1` | Base — next month | BASE | MONTH | +1 |
| `NL_POWER_PEAK_M1` | Peak — next month | PEAK | MONTH | +1 |
| `NL_POWER_BASE_Q1` | Base — next quarter | BASE | QUARTER | +1 |
| `NL_POWER_PEAK_Q1` | Peak — next quarter | PEAK | QUARTER | +1 |
| `NL_POWER_BASE_Y1` | Base — next calendar year | BASE | YEAR | +1 |
| `NL_POWER_PEAK_Y1` | Peak — next calendar year | PEAK | YEAR | +1 |

Adding M+2, Q+2 and Cal+2 is configuration. The Montel symbol for each is **[OQ-23]**.

### 3.1 Rolling

Products are defined by *relative offset*, so `M+1` resolves to a different delivery month each
month. The resolution runs at read time against the Amsterdam calendar, and the resolved delivery
period is stored with each observation — so a trend chart can show the roll rather than splicing two
unrelated instruments into one line.

## 4. Polling

| Job | Schedule | Notes |
| --- | --- | --- |
| `PollMontelIndicationsJob` | 5 min in market hours, hourly otherwise | Market hours from reference data, not hard-coded |
| `FetchDayAheadPricesJob` | **18:00 Europe/Amsterdam, once [DEC-36]**, then retry with backoff until complete or cut-off | The NL day-ahead curve **arrives at 18:00 Amsterdam**. Both the time and the retry policy are configuration **[F08-R01]** |
| `CheckDayAheadCompletenessJob` | 20:00 Europe/Amsterdam | Alerts on gaps for the next day |

**[DEC-36] replaces the four-attempt schedule.** The previous 13:00 / 14:00 / 15:00 / 18:00 sequence
existed only because the publication time was unknown; three of those four attempts were speculative
polls against an unpublished curve. With the time known, the design is **one scheduled fetch plus
retry**, and a curve that is not there at 18:00 becomes an **alert** rather than another poll — which
is the point, because a delayed auction is something operations should hear about.

> **Times are `Europe/Amsterdam`, not `CET`.** The schedule above previously said CET, which is wrong
> for half the year: between the last Sunday in March and the last Sunday in October the local clock is
> CEST, and a job pinned to CET would fetch at 19:00 local. Schedules follow the same rule as every
> other business time in this set — local calendar, never a fixed offset **[DEC-08]**.

⚠ **[DEC-36] answers *when*, not *what*.** The **resolution** Montel delivers (hourly or 15-minute) and
whether **history is available for backfill** are both still unanswered — see §8, [OQ-16]. The storage
model handles either resolution by design (§5), but backfill depth is a hard limit on how far back a
position can be settled, and no amount of design absorbs a history that does not exist.

## 5. Storage

Observations are append-only:

```
price_indication_observation
  ├─ product_code
  ├─ ticker                    (as configured at observation time)
  ├─ resolved_delivery_period
  ├─ price · currency · unit
  ├─ observed_at               (Montel's timestamp)
  └─ received_at
```

Day-ahead prices are stored with a validity range and versioned
([Database design](../20-architecture/04-database-design.md) §3.3), so an hourly and a 15-minute
source are handled identically **[OQ-16]**.

### 5.1 The stored price is the settled price **[DEC-44]**

**Day-ahead settlement uses the raw price, with no spread**, which closes [OQ-35]. Nothing is added on
ingestion and nothing is added on use: no spread column, no configured adder, no per-customer variant.
Whatever this adapter stores is what
[Invoice calculation §4](../50-calculations/03-invoice-calculation.md) charges and credits.

The same decision **narrows what day-ahead prices at all**. Physically exported volume no longer
settles here: it settles at a per-customer **feed-in tariff** as invoice line 6
([Invoice calculation §7A](../50-calculations/03-invoice-calculation.md)), which is **customer
reference data and not a Montel input**. This integration is unaffected in what it fetches — the curve
is still needed in full, for the uncovered purchase leg and the unused-block-cover sale leg — and it
matters here only so that nobody adds a feed-in lookup to the market-data port. Read §7A rather than
inferring the split from this document.

## 6. Resilience

| Concern | Handling |
| --- | --- |
| Transient failure | Retry with exponential backoff and jitter; the standard resilience handler from `ServiceDefaults` |
| Sustained failure | Circuit breaker; last known values served with a staleness marker |
| Rate limiting | Respect `429` and `Retry-After`; poll intervals sized well inside any quota |
| Unexpected currency or unit | **Rejected and logged.** Never silently converted |
| Wrong market area | Rejected |
| Missing price | Stored as absent; never interpolated |
| Credential rotation | Read from Key Vault, refreshed without a restart |

## 7. Licensing

Market data is licensed, and the licence — not the API — decides what the UI may do.

**[DEC-27] decides the display question.** Montel price indications **must not be displayed
publicly**; display inside the **authenticated portal is permitted**. That closes **[OQ-24]** for
display and retires the public-price element of
[F14](../10-features/F14-public-website.md).

| Use | Permitted | Basis |
| --- | --- | --- |
| Shown to a signed-in customer in the portal | **Yes** | [DEC-27] |
| Used internally by employees | **Yes** | Never in question — it was the fallback had display been refused |
| Shown on the public website or any unauthenticated page | **No** | [DEC-27] |
| Exported or downloaded by a customer (CSV) | **No, until the licence says otherwise** | **Not covered by [DEC-27].** Export is redistribution, so the conservative reading holds until it is answered |

The contingency that mattered most is retired: **[F04](../10-features/F04-price-indications.md) does
not have to become a PeakPower-derived indication**, because showing the market price to a signed-in
customer is permitted. What it keeps regardless of the licence is its *"Indication — not an offer"*
labelling and its stale-data flagging — those answer a different question. **R-07 is reduced, not
closed** ([Risks](../70-delivery/02-risks.md)).

The **export** half of [OQ-24] stays open and stays a commercial and contractual dependency rather
than a technical detail: if a customer-facing CSV export of indications is wanted, it is a licence
negotiation, not a feature ticket. Until then the portal shows indications and offers no download of
them.

## 8. Open questions

| Ref | Question |
| --- | --- |
| [OQ-16] | **Partly closed by [DEC-36]** — the curve arrives at **18:00 Amsterdam**, which settles the schedule (§4). ⚠ **Still open:** **(a)** the **resolution** delivered, hourly or 15-minute — handled by design (§5) but unconfirmed; **(b)** whether **history is available for backfill**, and how deep. Backfill depth limits how far back positions can be settled, so it is a scope question, not a detail |
| [OQ-23] | Exact ticker symbols for the six products |
| [OQ-24] | Licence terms for onward display and export — **display closed by [DEC-27]** (portal yes, public no); **export still open**, treated as not permitted (§7) |
| [OQ-25] | Are indications shown raw, or with a PeakPower spread? ⚠ **Not answered by [DEC-44]**, which is about day-ahead *settlement*. Indications are a display question and stay open |
| ~~[OQ-35]~~ | ~~Is the raw day-ahead price used for settlement, or a price plus a spread?~~ **Closed by [DEC-44]** — the **raw** price, no spread, on both legs (§5.1) |
| [OQ-52] | Where does the existing Montel implementation live, and in what shape is it? |
