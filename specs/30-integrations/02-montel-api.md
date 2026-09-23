# Integration — Montel

**Direction:** outbound poll · **Protocol:** REST/JSON over HTTPS ⚠ *to Montel; the transport to
PeakPower's own Montel service is one of the four things [DEC-96] leaves to be read — §2.1* ·
**Criticality:** high

Two distinct uses of one provider:

1. **Price indications** — forward prices for base and peak, month/quarter/year, shown to customers
   as non-binding indications ([F04](../10-features/F04-price-indications.md)). Since **[DEC-80]** the
   customer sees the quote **plus a configurable markup, default 2%**, applied at display and never
   stored (§5.2).
2. **Day-ahead prices** — the NL day-ahead curve, used **raw** to settle uncovered volume, unused
   block cover and — since **[DEC-87]** — physically exported volume
   ([F08](../10-features/F08-day-ahead-prices.md)).

**An implementation already exists** and should be reused rather than rewritten. This document
specifies what the platform needs from it, not how to call Montel from scratch — the concrete
endpoints, authentication and rate limits must be taken from that implementation and from Montel's
current documentation. ~~**[OQ-52]**~~, **[OQ-23]**.

**[DEC-96] names that implementation and changes where the work starts.** There is an existing
**PeakPower Montel service, built by Luka**, and other PeakPower .NET conventions and shared libraries
to align with. The price-board work therefore starts by **integrating that service**, not by calling
the Montel API directly: the platform's adapter is a client of a PeakPower service that is itself the
Montel client (§2.1). **Closes [OQ-52]** on *whether* something exists and what to do with it.
⚠ What the decision does **not** settle: the service's location, its shape and how much of the need in
§1 it actually covers. Those have to be **read before the estimate is firm**, and §2.1 lists exactly
what to look for. **[OQ-23]** is the one input still missing from the outside.

---

## 1. What the platform needs

| Need | Frequency | Consumer | Failure impact |
| --- | --- | --- | --- |
| Forward prices for **24** configured products ⚠ **Amended 2026-09-23 by [DEC-161]** — widened from the original 6–12 sketch to a fixed 6M/4Q/2Y × Base/Peak depth | **Platform-wide** for Phase 1, every 5 min in market hours **[DEC-161]** (per-product frequency waits for P5) | Price board, **marked up at display [DEC-80]**. The trade-wizard estimate is deferred with F05 in Phase 1 (**F04-R10**) | Customers see stale indications, or `Unavailable` if the configured provider is absent entirely **[DEC-159]**; trading continues |
| NL day-ahead curve for D+1 | **Once daily, from 18:00 Europe/Amsterdam [DEC-36]** | Invoicing (uncovered purchase, unused block cover, **export credit [DEC-87]**), chart tooltips, exposure KPI | **Invoicing blocked for affected days** |
| Historical forward prices | On demand | **Employee** trend charts only — the customer-facing history is withdrawn by **[DEC-81]** (§7) | Internal trend view degrades; nothing customer-facing is affected |
| Historical day-ahead | Backfill, once, then on demand for corrections | Historical positions, late correction invoices **[DEC-99]** | Past periods cannot be settled. ⚠ **No longer an unknown: history is available [DEC-75]** — the limit is the licence, not the data |

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

⚠ **Amended 2026-09-23 by [DEC-161] — this is the pre-build sketch; the port as actually built for
Phase 1 is narrower and batch-shaped:**

```csharp
public interface IMarketDataProvider
{
    string SourceId { get; }                  // "SIMULATED" for [DEC-159]'s fixture; non-nullable — "none" means no IMarketDataProvider is registered at all, so there is no instance to read
    Task<IReadOnlyList<ForwardQuote>> GetForwardQuotesAsync(
        IReadOnlyList<ForwardQuoteRequest> requests, CancellationToken ct);
}

public sealed record ForwardQuoteRequest(string ProductCode, BlockShape Shape, DeliveryPeriod Period, string? Ticker);

public sealed record ForwardQuote(
    string ProductCode, DeliveryPeriod Period, decimal PricePerMwh,
    string Currency, string Unit, DateTimeOffset ObservedAt);
```

**Forward-only.** `GetHistoryAsync` and `GetDayAheadAsync` are not part of the built interface. History
has no customer- or platform-facing consumer to build against in Phase 1 (**F04-R09** stays retired —
this document's §1 "Historical forward prices / employee trend charts" row is aspirational, not
scheduled work). Day-ahead **keeps its [DEC-149] loader** — a seeded reference table
(`market.day_ahead_price`, migration 12, covering 2026-01-01..2026-08-05), not a poll — so it was
never going to share this port. ⚠ **This narrows one sentence of the brief, not a reversal of
[DEC-36].** `IMarketDataProvider` is scoped to forward prices for Phase 1 of this feature; day-ahead is
**currently loaded** through **[DEC-149]**'s seeded reference set, for the proof of concept, rather
than through this port. §4's day-ahead jobs (`FetchDayAheadPricesJob` and its siblings) are **not**
superseded, retired or historical — **[DEC-149]** neither mentions them nor changes them, and §1's own
table above still names a failed daily fetch as blocking invoicing (**[DEC-36]**). They remain the
specified mechanism for whenever day-ahead moves off the seeded reference set onto a live feed; this
feature's build simply does not touch them.
**Batch, not per-ticker**: `GetForwardQuotesAsync` takes every requested product in one call, matching
a platform-wide poll interval (**F04-R02**, **[DEC-161]**) rather than 24 independent per-ticker calls.
**`SourceId`, not an implicit vendor name**: the sweep job stamps every observation it writes with
`provider.SourceId`, which is what `price_indication_observation.source` records. ⚠ **The customer
endpoint's read-side filter and `isSampleData` do not read this property at all — they read
`ForwardPriceOptions.ConfiguredSourceId` from config, independently.** No `IMarketDataProvider` is
even registered in the customer API host; only the Worker resolves and calls the provider. The
customer endpoint serves `price_indication_latest` rows where `source = options.ConfiguredSourceId`
(`"SIMULATED"` for `Simulated`, `null` — matching no rows — for "none"), and sets `isSampleData` when
the **configured** provider is `Simulated` and at least one row priced. **[DEC-159]**'s sample-honesty
rule is therefore enforced by a config value read at the API boundary, which happens to agree with
what the Worker's provider wrote as `SourceId` only because both hosts are bound from the same
`ForwardPrices:Provider` setting — it is not the same property read twice.

Naming the port `IMarketDataProvider` rather than `IMontelClient` is deliberate: it keeps the
possibility of a second or replacement provider a configuration matter rather than a refactor.
**[DEC-96] cashes that in immediately**: the first implementation behind this port is not a Montel
client at all, it is a client of PeakPower's own Montel service — and **[DEC-159]** cashes it in a
second time: the Phase 1 implementation behind the port is neither of those, it is the **simulated
test fixture**, config-gated to development and the demo VM.

### 2.1 The first hop is PeakPower's existing Montel service **[DEC-96]**

The platform does not open a connection to Montel. It calls the service Luka already built; that
service calls Montel.

```
Platform                        PeakPower Montel service            Montel
IMarketDataProvider        →    (exists, built by Luka)        →    vendor API
adapter in this repo            credentials · quota · symbols
```

| Concern | Owner after [DEC-96] | Why |
| --- | --- | --- |
| Montel credentials and their rotation | **Existing service** | The platform holds a credential for the *service*, not for Montel. §6's Key Vault row narrows accordingly |
| Vendor rate limits and quota | **Existing service** | One consumer at the vendor rather than two competing for the same quota |
| Vendor endpoint shapes and their changes | **Existing service** | A Montel API change is absorbed one layer down |
| Ticker symbol resolution | ⏸ **Unknown until the service is read** | It may already hold the (now 24, not six — ⚠ **widened 2026-09-23 by [DEC-161]**) symbols **[OQ-23]** asks for, which is the cheapest way to close that question |
| Product configuration — which products the portal shows | **Platform** (§3) | Customer-facing reference data, edited by employees **[F04-R11]** |
| Markup at display | **Platform only, never the service** **[DEC-80]** | The service returns raw values and must keep doing so (§5.2) |
| Storage, versioning, completeness, alerting | **Platform** (§4, §5) | The invoice depends on these; they cannot live in a service this repo does not own |

**Read these four things out of the service before the estimate is firm.** The decision starts the
work, it does not size it:

| # | What to establish | Why it changes the estimate |
| --- | --- | --- |
| 1 | Does it serve **day-ahead** as well as forwards? | Day-ahead is the leg that blocks invoicing. If the service is forward-only, the day-ahead implementation of `IMarketDataProvider` calls Montel directly and both live behind the one port |
| 2 | Does it serve **history**, and how deep? | **[DEC-75]** says the history exists at Montel; it does not say this service exposes it. Backfill and late correction invoices **[DEC-99]** both read it |
| 3 | Transport, response shape, **currency and unit** | §6 rejects an unexpected currency or unit rather than converting. That check moves to the service boundary and has to be written against the service's actual contract |
| 4 | Deployment, ownership and availability | It becomes a runtime dependency of invoicing — see the new row in §6 |

⚠ **What the hop costs.** An availability, deployment and ownership dependency outside this repository
sits on the path to the invoice run. That is accepted in exchange for not duplicating credentials,
quota and vendor-contract surface, and because the alternative — a second independent Montel client —
is the thing **[DEC-96]** exists to prevent. The mitigation is the port: if the service proves
unsuitable for the day-ahead leg, only one implementation is replaced.

## 3. Product configuration

Ticker symbols are **reference data**, never constants
([F04](../10-features/F04-price-indications.md) §3). ⚠ **Amended 2026-09-23 by [DEC-161] — 24
products, not six.** Depth is data: 6 months (M+1…M+6) + 4 quarters (Q+1…Q+4) + 2 calendar years
(Cal+1…Cal+2), × Base/Peak. **All 24 rows carry `commodity = ELECTRICITY`** (gas stays out —
**[DEC-68]**), so that column is omitted from the table below rather than repeated 24 times unchanged.
The full seed, exactly as migration 25 writes it
([database design](../20-architecture/04-database-design.md) §3.3/§7.5), `display_name` and
`display_order` included since a reader diagnosing the board's ordering needs them here rather than a
second lookup:

| Code | Display name | Shape | Period | Offset | Display order | Montel ticker |
| --- | --- | --- | --- | --- | :--: | --- |
| `NL_POWER_BASE_M1` | Base — month +1 | BASE | MONTH | +1 | 1 | ⏸ **[OQ-23]** |
| `NL_POWER_PEAK_M1` | Peak — month +1 | PEAK | MONTH | +1 | 2 | ⏸ **[OQ-23]** |
| `NL_POWER_BASE_M2` | Base — month +2 | BASE | MONTH | +2 | 3 | ⏸ **[OQ-23]** |
| `NL_POWER_PEAK_M2` | Peak — month +2 | PEAK | MONTH | +2 | 4 | ⏸ **[OQ-23]** |
| `NL_POWER_BASE_M3` | Base — month +3 | BASE | MONTH | +3 | 5 | ⏸ **[OQ-23]** |
| `NL_POWER_PEAK_M3` | Peak — month +3 | PEAK | MONTH | +3 | 6 | ⏸ **[OQ-23]** |
| `NL_POWER_BASE_M4` | Base — month +4 | BASE | MONTH | +4 | 7 | ⏸ **[OQ-23]** |
| `NL_POWER_PEAK_M4` | Peak — month +4 | PEAK | MONTH | +4 | 8 | ⏸ **[OQ-23]** |
| `NL_POWER_BASE_M5` | Base — month +5 | BASE | MONTH | +5 | 9 | ⏸ **[OQ-23]** |
| `NL_POWER_PEAK_M5` | Peak — month +5 | PEAK | MONTH | +5 | 10 | ⏸ **[OQ-23]** |
| `NL_POWER_BASE_M6` | Base — month +6 | BASE | MONTH | +6 | 11 | ⏸ **[OQ-23]** |
| `NL_POWER_PEAK_M6` | Peak — month +6 | PEAK | MONTH | +6 | 12 | ⏸ **[OQ-23]** |
| `NL_POWER_BASE_Q1` | Base — quarter +1 | BASE | QUARTER | +1 | 13 | ⏸ **[OQ-23]** |
| `NL_POWER_PEAK_Q1` | Peak — quarter +1 | PEAK | QUARTER | +1 | 14 | ⏸ **[OQ-23]** |
| `NL_POWER_BASE_Q2` | Base — quarter +2 | BASE | QUARTER | +2 | 15 | ⏸ **[OQ-23]** |
| `NL_POWER_PEAK_Q2` | Peak — quarter +2 | PEAK | QUARTER | +2 | 16 | ⏸ **[OQ-23]** |
| `NL_POWER_BASE_Q3` | Base — quarter +3 | BASE | QUARTER | +3 | 17 | ⏸ **[OQ-23]** |
| `NL_POWER_PEAK_Q3` | Peak — quarter +3 | PEAK | QUARTER | +3 | 18 | ⏸ **[OQ-23]** |
| `NL_POWER_BASE_Q4` | Base — quarter +4 | BASE | QUARTER | +4 | 19 | ⏸ **[OQ-23]** |
| `NL_POWER_PEAK_Q4` | Peak — quarter +4 | PEAK | QUARTER | +4 | 20 | ⏸ **[OQ-23]** |
| `NL_POWER_BASE_Y1` | Base — year +1 | BASE | YEAR | +1 | 21 | ⏸ **[OQ-23]** |
| `NL_POWER_PEAK_Y1` | Peak — year +1 | PEAK | YEAR | +1 | 22 | ⏸ **[OQ-23]** |
| `NL_POWER_BASE_Y2` | Base — year +2 | BASE | YEAR | +2 | 23 | ⏸ **[OQ-23]** |
| `NL_POWER_PEAK_Y2` | Peak — year +2 | PEAK | YEAR | +2 | 24 | ⏸ **[OQ-23]** |

`montel_ticker` is empty on every one of these 24 rows. "Adding M+2, Q+2 and Cal+2 is configuration"
is no longer a forward-looking sentence: it is what this round did, and `relative_offset` continues
to be how the next widening happens too. ⚠ **The display names above are the seeded ones** — "Base —
month +1", not "Base — next month" — matching the migration literally, the api-contracts example and
the mockup; an earlier draft of this table used the "next month"/"next quarter"/"next calendar year"
phrasing for the front six, which is not what was built.

**The ticker column is deliberately empty on all 24 rows. [OQ-23] stays open in part (⏸)**, and it is
now three missing things rather than two:

1. **The 24 symbols themselves were never supplied.** Nothing can be seeded into
   `price_indication_product.montel_ticker`, so until they arrive the price board renders
   `Unavailable` **[F04-R07]** rather than a wrong number — and for Phase 1 it renders against
   **[DEC-159]**'s simulated fixture regardless, so the missing symbols do not block the build, only
   the production switch.
2. **Which side of the market they quote is contradicted by the sources.** [OQ-23]'s answer says
   **ask** + 2%; [OQ-25]'s comment says **bid** + percentage. The comment governs, so **[DEC-80]** is
   recorded on the **bid** and that is the working assumption — but the wording has to be confirmed
   *together with* the symbols, because a symbol that turns out to be an ask quote moves the number the
   customer sees by the bid-ask spread **on top of** the 2% markup. Confirming the symbol without
   confirming the side leaves a silent pricing error, not a missing feature.
3. **⚠ New 2026-09-23.** Licence and service coverage of the **fourteen far-offset products** —
   M+3…M+6, Q+3…Q+4, Cal+2 (4 + 2 + 1 offsets × Base/Peak) — is unconfirmed: nothing has established
   that the Montel licence extends that far or that **[DEC-96]**'s existing service carries quotes for
   them at all. A service that answers only M+1…M+2, Q+1…Q+2 and Cal+1 (Base and Peak, ten products)
   leaves exactly those fourteen permanently `Unavailable`, which would be a licence/service finding to record, not a defect to fix.
   (This is a different, smaller set than the eighteen products the depth expansion adds in total —
   that figure also counts M+2 and Q+2, which this coverage question does not name.)

### 3.1 Rolling

Products are defined by *relative offset*, so `M+1` resolves to a different delivery month each
month. The resolution runs at read time against the Amsterdam calendar, and the resolved delivery
period is stored with each observation — so a trend chart can show the roll rather than splicing two
unrelated instruments into one line.

⚠ **Amended 2026-08-19 by [DEC-81]** — *whose* trend chart. The customer-facing history is withdrawn:
the portal shows the **current** curve only, with no history and no export (§7). Storing the resolved
delivery period is still required, for two reasons that survive the withdrawal: the **employee** trend
view, and reconstructing which instrument a customer was looking at when a trade request was raised
**[F04-R10]**. The storage rule does not change; its customer-facing consumer does.

## 4. Polling

| Job | Schedule | Notes |
| --- | --- | --- |
| `PollMontelIndicationsJob` | 5 min in market hours, hourly otherwise | Market hours from configuration, not hard-coded. ⚠ **Amended 2026-09-23 by [DEC-161]** — for Phase 1 the market window is **application config**, not the employee-maintained reference-data table this document elsewhere means by that term (contrast the markup table, §3): `ForwardPrices:MarketWindow:Days`/`:Open`/`:Close` on `ForwardPriceOptions`, with a **placeholder** value, Monday–Friday 08:00–18:00 Europe/Amsterdam, tracked against real values by **[OQ-108]**. The poll interval is likewise config and **platform-wide** (`ForwardPrices:PollIntervalInMarketHours`/`PollIntervalOutsideMarketHours`), not per-product until **F04-R02**'s P5 maintenance screen ships |
| `FetchDayAheadPricesJob` | **18:00 Europe/Amsterdam, once [DEC-36]**, then retry with backoff until complete or cut-off | The NL day-ahead curve **arrives at 18:00 Amsterdam**. Both the time and the retry policy are configuration **[F08-R01]** |
| `CheckDayAheadCompletenessJob` | 20:00 Europe/Amsterdam | Alerts on gaps for the next day |
| `BackfillDayAheadPricesJob` | **On demand, operator-triggered, over a bounded date range [DEC-75]** | Not a schedule. It exists because the history is available, and it is also the path a late metering correction **[DEC-99]** takes when it needs a price for a month already closed. Rate-limited so a wide range cannot starve the daily fetch |

⚠ **As-built roll rule, found 2026-09-23 by reading the code for this close-out.** `PollMontelIndicationsJob`'s table row above does not say what happens when a product's delivery period **rolls** — M+1 becoming a new month, or the equivalent for a quarter or year. The built poller does not leave a roll to the ordinary 5-minute/hourly cadence: it detects one by comparing each active product's currently resolved delivery period against the latest delivery period stored for it, and a mismatch forces an immediate poll on the next one-minute tick, exactly as if the source had never been polled before — in effect, it polls again as soon as the last poll predates the current Amsterdam period's start, for whichever period type (month, quarter or year) just rolled. This is not documented elsewhere in this set and is recorded here because a reader relying only on the table above would assume a roll waits up to an hour to be reflected.

**[DEC-36] replaces the four-attempt schedule.** The previous 13:00 / 14:00 / 15:00 / 18:00 sequence
existed only because the publication time was unknown; three of those four attempts were speculative
polls against an unpublished curve. With the time known, the design is **one scheduled fetch plus
retry**, and a curve that is not there at 18:00 becomes an **alert** rather than another poll — which
is the point, because a delayed auction is something operations should hear about.

> **Times are `Europe/Amsterdam`, not `CET`.** The schedule above previously said CET, which is wrong
> for half the year: between the last Sunday in March and the last Sunday in October the local clock is
> CEST, and a job pinned to CET would fetch at 19:00 local. Schedules follow the same rule as every
> other business time in this set — local calendar, never a fixed offset **[DEC-08]**.

⚠ **Amended 2026-08-19 by [DEC-75].** The paragraph below stands as the record of what was unknown on
the day [DEC-36] was taken:

> ⚠ **[DEC-36] answers *when*, not *what*.** The **resolution** Montel delivers (hourly or 15-minute) and
> whether **history is available for backfill** are both still unanswered — see §8, [OQ-16]. The storage
> model handles either resolution by design (§5), but backfill depth is a hard limit on how far back a
> position can be settled, and no amount of design absorbs a history that does not exist.

**The history exists. [DEC-75] closes [OQ-16].** Day-ahead history is available for backfill, so there
is **no backfill cliff**: a position can be settled retrospectively to whatever depth the licence
allows, and the earliest invoiced period is a licence and a rate-limit question rather than a data
one (§7). What this buys, concretely: the platform can be switched on mid-period and still invoice the
period that preceded it, and a metering correction that lands months later **[DEC-99]** can be priced
rather than blocked. The resolution half of the old question never got a separate answer and no longer
needs one — §5 stores hourly and 15-minute identically, so whichever arrives is absorbed on arrival
rather than being a precondition for building anything.

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

⚠ **Amended 2026-09-23 by [DEC-161] — ticker and source, as built.** The table
[actually migrated](../20-architecture/04-database-design.md) §3.3/§7.5 is keyed by `product_id`
rather than `product_code`, splits `resolved_delivery_period` into `delivery_start`/`delivery_end`
(`DeliveryPeriod` is a value object, not stored as one string), and adds `source varchar(32)` —
`'SIMULATED'` for **[DEC-159]**'s fixture, a future real value once one exists — which is what the
least-privilege `price_indication_latest` view and the served-rows sample-honesty filter both key on:
both serve only rows whose `source` matches the currently configured provider, so a row from a source
the platform is no longer configured for is never returned as live (**[DEC-159]**). `ticker` is `NULL`
for every `SIMULATED` row, since a simulated observation was never resolved against a real Montel
symbol.

There is **no markup column and no adjusted-price column** in that table, and none in `day_ahead_price`
either. Everything stored here is the value the provider gave — see §5.2. ⚠ **This reconciles with
[F04-R10]**, deferred with F05 for Phase 1 (**[DEC-161]**): the observation store holds the **raw**
value only, in Phase 1 exactly as it always was meant to, and there is nothing here for F05's capture
step to disturb when it lands — it reads this table, it does not write a different shape into it.

Day-ahead prices are stored with a validity range and versioned
([Database design](../20-architecture/04-database-design.md) §3.3), so an hourly and a 15-minute
source are handled identically — which is why the resolution half of ~~[OQ-16]~~ could close
unanswered **[DEC-75]**.

### 5.1 The stored price is the settled price **[DEC-44]** — confirmed 2026-08-19

**Day-ahead settlement uses the raw price, with no spread**, which closes [OQ-35]. Nothing is added on
ingestion and nothing is added on use: no spread column, no configured adder, no per-customer variant.
Whatever this adapter stores is what
[Invoice calculation §4](../50-calculations/03-invoice-calculation.md) charges and credits.

**The first half of [DEC-44] is confirmed** by the 2026-08-19 round ("Day ahead price is raw", OQ-35's
comment) and by **[DEC-87]**. It is now load-bearing in a way it was not before: **[DEC-80]** puts a
markup on the *indication* side, so "raw" is no longer the only price in the building. §5.2 draws the
boundary.

⚠ **Reversed 2026-08-19 by [DEC-87]** — the paragraph below is withdrawn. It is kept readable because
it is the reason the market-data port has no feed-in lookup in it, and that outcome survives:

> The same decision **narrows what day-ahead prices at all**. Physically exported volume no longer
> settles here: it settles at a per-customer **feed-in tariff** as invoice line 6
> ([Invoice calculation §7A](../50-calculations/03-invoice-calculation.md)), which is **customer
> reference data and not a Montel input**. This integration is unaffected in what it fetches — the curve
> is still needed in full, for the uncovered purchase leg and the unused-block-cover sale leg — and it
> matters here only so that nobody adds a feed-in lookup to the market-data port. Read §7A rather than
> inferring the split from this document.

**[DEC-87] withdraws the feed-in tariff entirely.** Physically exported volume is credited at the
**raw day-ahead price for the interval**, exactly as surplus is under **[DEC-23]**. No topup and no
feed-in fee touch export volume. For this integration that means:

| Item | Status after [DEC-87] |
| --- | --- |
| Feed-in tariff as a Montel input | **Never was one, and now there is nothing to source at all.** No provider, no ticker, no lookup |
| A feed-in rate stored anywhere in this adapter's tables | **None.** `price_indication_observation` and `day_ahead_price` are the only price stores this integration writes |
| Legs the day-ahead curve now settles | **Three** — uncovered purchase, unused block cover, **physical export**. It was two |
| `MISSING_FEED_IN_TARIFF` and the invoice skip it caused | **Removed.** **Closes [OQ-86]**: there is no tariff left to fail to resolve |
| Consequence for this document | A missing day-ahead price now blocks **more** than it did — the export credit fails with it. §6's "missing price" row and **[F08-R07]** get heavier, not lighter |

### 5.2 The markup is a presentation concern. It must never reach settlement **[DEC-80]**

**[DEC-80] closes [OQ-25]:** indications are **never shown raw**. The customer sees the quote plus a
**configurable markup, default 2%** — reference data with a default, not a constant — and an indication
is **never firm unless PeakPower says so**; only PeakPower's response to a trade request binds
**[F04-R05]**. Which side of the market is marked up is carried on **[OQ-23]** (§3): the comment column
governs and says **bid**, the answer column says ask.

This creates two prices where there was one, so the boundary has to be stated rather than implied:

| Layer | Value | Rule |
| --- | --- | --- |
| Montel / the Montel service returns | Raw quote | Untouched. §2.1 forbids the service applying a markup |
| This adapter stores (`price_indication_observation`) | **Raw quote** | **No markup column, no adjusted column.** What is stored is what was quoted |
| Portal price board, trade-wizard estimate | **Raw × (1 + markup)** | Computed at render time from the stored raw value and the markup in force **[DEC-80]** |
| `day_ahead_price` store | **Raw** | Unchanged by [DEC-80], which is about indications |
| Day-ahead shown to a customer (tooltip, exposure KPI) | **Raw** | It is the price they are actually charged; marking it up would break their own reconciliation |
| Settlement — [Invoice calculation](../50-calculations/03-invoice-calculation.md) | **Raw day-ahead, always** | **[DEC-44]** first half, confirmed by **[DEC-87]**. No marked-up value is an input to any invoice line |

**The rule, precisely stated: the *observation store* holds only raw values, in Phase 1.** A marked-up
number is never returned by `IMarketDataProvider`, never written to `price_indication_observation` or
`day_ahead_price`, and never read by the invoice run — the port's `ForwardQuote` and `DayAheadPrice`
records (§2; `ForwardQuote` is the as-built type, replacing the pre-build `PriceObservation` sketch)
carry raw values by definition, which is what makes that half of the rule enforceable at the type
level rather than by convention. ⚠ **This does not mean a marked-up number is never persisted
anywhere.** **[F04-R10]** and **[F04-R17]** require the trade request to capture and store the
marked-up price at 4 dp alongside the markup rate in force — deferred to **[F05](../10-features/F05-energy-block-trading.md)**
for Phase 1, since there is no trade request to capture it against until F05 ships, but not deferred
forever. When F05 lands, it **reads** the observation table's raw value and the markup in force, and
writes the computed marked-up price with the trade request it belongs to — a different table, a
different lifecycle, and a write F05 owns, not this adapter. The boundary this section draws is
narrower than "never persisted": it is "never persisted in the observation store, and never computed
by anything but the render/capture path itself."

Worked example, at the 2% default:

| Quantity | Raw | Shown | Charged |
| --- | --- | --- | --- |
| Base M+1 indication, 92,40 €/MWh | 92,40 | 92,40 × 1,02 = 94,248 → **94,25** | *n/a — an indication is not charged* |
| Day-ahead interval, 87,30 €/MWh | 87,30 | 87,30 | **87,30** |

⚠ **What a breach of the boundary costs.** If the markup ever leaked into settlement, one MW of
uncovered volume across a 730-hour month at 87,30 €/MWh would be over-charged by
0,02 × 87,30 × 730 = **€1 274,58 per MW-month** — silently, because the invoice would still tie out
against itself. It would only surface when a customer checked the invoice against a public day-ahead
curve, which [F08](../10-features/F08-day-ahead-prices.md) business rule 6 explicitly expects them to
do. That is why the markup is applied
at the last possible moment instead of on ingestion.

⚠ **Consequence for [F04-R10]**, which records the indication current at the moment of a trade request:
the recorded value is a raw observation, so the markup percentage **in force at that moment** must be
recorded with it. Otherwise the audit trail cannot reproduce the number the customer actually saw, and
the markup being settable **[DEC-80]** guarantees that today's percentage is not a safe substitute.

## 6. Resilience

| Concern | Handling |
| --- | --- |
| Transient failure | Retry with exponential backoff and jitter; the standard resilience handler from `ServiceDefaults` |
| Sustained failure | Circuit breaker; last known values served with a staleness marker |
| Rate limiting | Respect `429` and `Retry-After`; poll intervals sized well inside any quota |
| Unexpected currency or unit | **Rejected and logged.** Never silently converted |
| Wrong market area | Rejected |
| Missing price | Stored as absent; never interpolated. ⚠ Heavier since **[DEC-87]**: a missing day-ahead price now blocks the **export credit** as well as the purchase and cover legs (§5.1) |
| Credential rotation | Read from Key Vault, refreshed without a restart. Since **[DEC-96]** the credential rotated here is the one for **PeakPower's Montel service**; the Montel credential itself sits in that service (§2.1) |
| **The existing Montel service is down or lagging** **[DEC-96]** | New failure mode, and it is on the invoicing path. Treated exactly as a provider outage — backoff, circuit breaker, last known values with a staleness marker — but the alert must name the **hop**, because the fix is a PeakPower deploy rather than a vendor ticket. Escalation path and ownership of that service are part of what §2.1 requires to be established |
| Backfill request over a wide range | Rate-limited and chunked, and never allowed to delay the 18:00 fetch. The history exists **[DEC-75]**, which makes an accidental multi-year pull a realistic way to exhaust the quota |

## 7. Licensing

Market data is licensed, and the licence — not the API — decides what the UI may do.

**[DEC-27] decides the display question.** Montel price indications **must not be displayed
publicly**; display inside the **authenticated portal is permitted**. That closes **[OQ-24]** for
display and retires the public-price element of
[F14](../10-features/F14-public-website.md).

| Use | Permitted | Basis |
| --- | --- | --- |
| Shown to a signed-in customer in the portal | **Yes** — the **current** curve only | [DEC-27], narrowed by [DEC-81] |
| Used internally by employees | **Yes** | Never in question — it was the fallback had display been refused |
| Shown on the public website or any unauthenticated page | **No** | [DEC-27] |
| ~~Exported or downloaded by a customer (CSV)~~ | ~~**No, until the licence says otherwise**~~ → **No, decided** | ⚠ **Amended 2026-08-19 by [DEC-81].** ~~Not covered by [DEC-27]; export is redistribution, so the conservative reading holds until it is answered.~~ It is answered: there is **no export**, in any format. This is now a product decision, not a holding position |
| **Price history shown to a customer** | **No** | **[DEC-81]** — the price board shows the current curve; the customer-facing trend chart is withdrawn (§3.1) |
| **Price data over a customer-facing API** | **No** | **[DEC-81]**, **[DEC-97]**. The customer usage API **[DEC-97]** exists and carries **net usage only**; no price, no indication, no day-ahead value goes through it |
| Employee trend charts and internal analysis over stored history | **Yes** | Internal use, unchanged. §5's history is retained for it |

The contingency that mattered most is retired: **[F04](../10-features/F04-price-indications.md) does
not have to become a PeakPower-derived indication**, because showing the market price to a signed-in
customer is permitted. What it keeps regardless of the licence is its *"Indication — not an offer"*
labelling and its stale-data flagging — those answer a different question. **R-07 is reduced, not
closed** ([Risks](../70-delivery/02-risks.md)).

⚠ **Amended 2026-08-19 by [DEC-81]:**

> The **export** half of [OQ-24] stays open and stays a commercial and contractual dependency rather
> than a technical detail: if a customer-facing CSV export of indications is wanted, it is a licence
> negotiation, not a feature ticket. Until then the portal shows indications and offers no download of
> them.

**[DEC-81] settles it from the product side instead.** Customers see forward prices in the portal with
**no history and no export** — no CSV, no download, no API **[DEC-97]** — and the source gives the
reason: it is a **licence-driven restriction, not a product one**. The conservative reading above
therefore stops being provisional and becomes the design.

**What this does to the licence conversation** — it gets shorter, and it changes shape:

| Item | Before 2026-08-19 | After |
| --- | --- | --- |
| Display to a signed-in customer | Permitted **[DEC-27]** | Unchanged, and still the permission the whole price board rests on |
| Customer export / redistribution | An open ask, blocking a feature | **Off the agenda.** Nothing to negotiate, because nothing is exported. Re-opening it is a new product decision first and a licence question second |
| Customer-facing price history and price API | Not raised | **Off the agenda**, same reason **[DEC-81]**, **[DEC-97]** |
| **Depth of day-ahead history the platform may retain and backfill** | Not raised — the history was not known to exist | **On the agenda, and it is now the only live licence item.** **[DEC-75]** makes retrospective settlement possible "to whatever depth the licence allows" (§4), so the licence — not Montel's archive — sets the earliest period the platform can invoice |

⚠ **[DEC-80] puts a nuance on that retirement** — the licence table above is unaffected; this is about
what is on the screen. What the customer sees is the market price **plus PeakPower's markup** (§5.2) — a *derived*
number commercially, while remaining a Montel display for licence purposes. It does not change what is
licensed. It does mean the figure on the tile is **not** a raw quote that a third party could
reconcile against Montel, which makes the *"Indication — not an offer"* labelling **[F04-R05]** carry
more weight than it did, not less.

## 8. Open questions

Post-2026-08-19 state. ⚠ **Amended 2026-09-23.** Two questions remain against this integration: one is
a partial ([OQ-23]), the other is fully open and does not block Phase 1's build ([OQ-108]).

| Ref | Status | Question |
| --- | :--: | --- |
| ~~[OQ-16]~~ | ✅ | ~~What resolution does Montel deliver for the NL day-ahead curve, and is history available for backfill?~~ **CLOSED.** The arrival time was settled by **[DEC-36]** (18:00 Amsterdam, §4); **[DEC-75]** settles the rest — **history is available for backfill**, so there is no backfill cliff and retrospective settlement is bounded by the licence rather than by the data (§4, §7). The **resolution** half was never separately answered and no longer needs to be: §5 stores hourly and 15-minute identically, so it is absorbed on arrival |
| **[OQ-23]** | ⏸ | **Still open in part.** ~~Exact ticker symbols for the six products~~ — the symbols **were never supplied** (§3), and a second half has been added to the row: **the sources disagree on which side of the market is quoted and marked up** — [OQ-23]'s answer says *ask* + 2%, [OQ-25]'s comment says *bid* + percentage, and the comment governs **[DEC-80]**. Both must be confirmed together; a symbol confirmed without its side is a silent pricing error. First place to look: the existing Montel service **[DEC-96]**, §2.1. ⚠ **Widened 2026-09-23 by [DEC-161]** — the row is now 24 symbols, not six (§3), and carries two further items: the **sign convention** for a negative quote ([F04](../10-features/F04-price-indications.md) §8), and **licence/service coverage of the far offsets** (M+3…M+6, Q+3…Q+4, Cal+2 — fourteen products) that must be confirmed before those can go live. All four items — symbols, side, sign, far-offset coverage — must arrive together; see [80-open-questions.md](../80-open-questions.md) |
| **[OQ-108]** | 🟠 | **New 2026-09-23 by [DEC-161] (6).** Confirm the real market-window values — trading days, open time, close time — against the **placeholder** window this integration polls to (§4: Monday–Friday 08:00–18:00 Europe/Amsterdam). Fully open, not a partial: unlike [OQ-23] it is not one of the five named [F04](../10-features/F04-price-indications.md) live-gate conditions, confirming it is cheap and blocks nothing else, and it is deliberately tracked separately from the ticker-symbol wait. See [80-open-questions.md](../80-open-questions.md) |
| ~~[OQ-24]~~ | ✅ | ~~Licence terms for onward display and export.~~ **CLOSED on both halves.** Display: **[DEC-27]** — portal yes, public no. Export: **[DEC-81]** — no export, no history, no price API **[DEC-97]**, decided rather than merely presumed (§7). ⚠ What replaces it in the licence conversation is **retention and backfill depth**, which **[DEC-75]** makes a live question for the first time |
| ~~[OQ-25]~~ | ✅ | ~~Are indications shown raw, or with a PeakPower spread?~~ **CLOSED — never raw** **[DEC-80]**: quote plus a **configurable markup, default 2%**, applied at display only, and never firm unless PeakPower says so. The stored value stays raw and settlement stays raw (§5.2) |
| ~~[OQ-35]~~ | ✅ | ~~Is the raw day-ahead price used for settlement, or a price plus a spread?~~ **Closed by [DEC-44]** — the **raw** price, no spread (§5.1). ⚠ **Confirmed and widened 2026-08-19**: the first half of [DEC-44] is confirmed, its second half is **reversed by [DEC-87]**, and the raw curve now settles **three** legs rather than two — uncovered purchase, unused block cover and physical export |
| ~~[OQ-52]~~ | ✅ | ~~Where does the existing Montel implementation live, and in what shape is it?~~ **CLOSED — it is the Montel service built by Luka**, and the work starts by integrating it **[DEC-96]** (§2.1). ⚠ *Where* and *in what shape* are still literally unknown; that is a **reading task with a named target**, not an open question, and §2.1 lists the four things it must answer before the estimate is firm |
| ~~[OQ-86]~~ | ✅ | ~~What happens when no feed-in tariff resolves?~~ **CLOSED by [DEC-87]** — there is no feed-in tariff. Recorded here only because §5.1 used to point at it |
