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
| NL day-ahead curve for D+1 | Daily after auction publication | Invoicing, chart tooltips, exposure KPI | **Invoicing blocked for affected days** |
| Historical forward prices | On demand | Trend charts | Trend view degrades |
| Historical day-ahead | Backfill, once | Historical positions | Past periods cannot be settled |

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
| `FetchDayAheadPricesJob` | 13:00, 14:00, 15:00, 18:00 CET | Repeats until the curve for D+1 is complete |
| `CheckDayAheadCompletenessJob` | 20:00 CET | Alerts on gaps for the next day |

Day-ahead is fetched several times rather than once because auction publication times move and a
single missed window would block a whole day's invoicing.

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

Three questions need answers before the price board is built **[OQ-24]**:

1. May indications be displayed to PeakPower's customers at all, or only used internally?
2. May customers export or download them?
3. May any price appear on the public website?

If onward display is restricted, [F04](../10-features/F04-price-indications.md) changes shape
substantially — possibly to a PeakPower-derived indication rather than a market price. That is a
commercial and contractual dependency on the critical path of phase 2, not a technical detail.

## 8. Open questions

| Ref | Question |
| --- | --- |
| [OQ-16] | Day-ahead resolution (hourly or 15-minute), history depth available for backfill |
| [OQ-23] | Exact ticker symbols for the six products |
| [OQ-24] | Licence terms for onward display and export |
| [OQ-25] | Are indications shown raw, or with a PeakPower spread? |
| [OQ-35] | Is the raw day-ahead price used for settlement, or a price plus a spread? |
| [OQ-52] | Where does the existing Montel implementation live, and in what shape is it? |
