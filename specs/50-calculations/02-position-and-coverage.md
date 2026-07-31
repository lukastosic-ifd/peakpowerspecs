# Position & Coverage

How measured consumption, purchased blocks and market prices combine into a per-interval position.
This is the model behind the chart overlay, the "am I covered?" question, and the energy lines on the
invoice.

---

## 1. The core identity

For every 15-minute interval `i` and metering point `m`:

```
netPosition(i,m)  =  consumption(i,m)  −  blockVolume(i,m)
```

| Sign | Meaning | Settlement |
| --- | --- | --- |
| `> 0` | **Short** — consumed more than was hedged | Buy the shortfall at the day-ahead price |
| `= 0` | Perfectly covered | Nothing settles at spot |
| `< 0` | **Long** — hedged more than was consumed | Sell the surplus back at the day-ahead price |

Everything else in this document is bookkeeping around that one line.

## 2. Inputs

| Input | Source | Resolution | Notes |
| --- | --- | --- | --- |
| `consumption(i,m)` | PVNed allocation data, `Direction = A02` | 15 min, kWh | The current version for that delivery date **[DEC-07]** |
| `production(i,m)` | PVNed allocation data, `Direction = A01` | 15 min, kWh | Displayed, but does **not** offset coverage **[AS-06]**, see [OQ-11] |
| `blockVolume(i,m)` | Confirmed blocks | Derived | See §3 |
| `dayAheadPrice(i)` | Montel | Per market time unit | See §5 |
| `imbalance` | PVNed imbalance report | 15 min, portfolio level | See [Invoice calculation](03-invoice-calculation.md) §6 |

## 3. Block volume per interval

```
blockPower(i,m)  =  Σ over confirmed blocks b:
                       sign(b) × allocation_MW(b, m) × active(b, i)

blockVolume(i,m) =  blockPower(i,m) × 250          // kWh, since 1 MW × 15 min = 250 kWh

where sign(BUY) = +1 and sign(SELL) = −1
```

`active(b, i)` is the shape function from [Energy block maths](01-energy-block-maths.md) §2.

Only blocks in state `CONFIRMED` contribute. Requests, offers and accepted-but-unconfirmed trades are
shown on the chart as a **provisional** overlay but are excluded from every settlement calculation.

### 3.1 Stacking

Blocks stack additively. A customer holding 1 MW base + 1 MW peak on the same metering point has
2 MW of cover during peak intervals:

```mermaid
flowchart LR
    subgraph interval["Interval: Wed 12 Aug 2026, 14:00–14:15"]
        direction TB
        B["BASE block · 1.0 MW<br/>active = 1"]
        P["PEAK block · 1.0 MW<br/>active = 1 (Wed, 14:00)"]
        S["SELL block · 0.25 MW<br/>active = 1 → sign −1"]
    end
    B --> SUM
    P --> SUM
    S --> SUM
    SUM["blockPower = 1.0 + 1.0 − 0.25<br/>= <b>1.75 MW</b>"] --> V["blockVolume<br/>= 1.75 × 250<br/>= <b>437.5 kWh</b>"]
```

## 4. Coverage metrics

Derived from `netPosition` for presentation:

```
covered(i,m)      = min( consumption(i,m), max(blockVolume(i,m), 0) )
uncovered(i,m)    = max( consumption(i,m) − blockVolume(i,m), 0 )
overCovered(i,m)  = max( blockVolume(i,m) − consumption(i,m), 0 )

coverageRatio(i,m) = covered(i,m) / consumption(i,m)      // undefined when consumption = 0
```

Aggregated over a period `P` (day, month, quarter):

```
coverageRatio(P,m) = Σ_i∈P covered(i,m)  /  Σ_i∈P consumption(i,m)
```

> **Aggregate first, then divide.** Averaging per-interval ratios gives a different — and wrong —
> answer, because it weights a 5 kWh interval the same as a 500 kWh one.

### 4.1 What the customer sees

| Metric | Where |
| --- | --- |
| Coverage ratio for the visible range | Chart header KPI |
| Uncovered MWh for the visible range | Chart header KPI |
| Cost of uncovered volume at day-ahead | Chart header KPI, marked *indicative* until the month is final |
| Per-interval stacked area: covered / uncovered | Chart body |
| Block step-line overlay | Chart body |

See the [consumption chart mockup](../60-mockups/README.md).

## 5. Day-ahead pricing of the open position

```
spotSettlement(i,m) = netPosition(i,m) / 1000 × dayAheadPrice(i)     // kWh → MWh
```

A positive result is a cost to the customer; a negative result is a credit.

### 5.1 Price granularity

Day-ahead prices are published per **market time unit**. Since the European day-ahead market moved to
15-minute MTUs, the platform should expect 15-minute prices — but must not assume it.

**The rule:** store the day-ahead price at whatever resolution the source delivers, together with its
validity interval, and resolve `dayAheadPrice(i)` by looking up the price whose validity interval
contains `i`. An hourly price then simply applies to four consecutive intervals with no special case.

**[OQ-16]** confirms what resolution Montel actually delivers for the NL day-ahead curve, and what
the fallback is when a price is missing.

### 5.2 Missing prices

A missing day-ahead price blocks invoicing for the affected day. The invoice run halts that customer
with a clear `MISSING_DAY_AHEAD_PRICE` reason rather than substituting a value. Silent substitution
of a market price is the kind of thing that is discovered a year later.

## 6. Worked example

**Setup.** One metering point. 1 MW base + 1 MW peak for August 2026. Four sample intervals.

| Interval (local) | Peak? | Consumption | blockPower | blockVolume | netPosition | DA price | Spot settlement |
| --- | :--: | --: | --: | --: | --: | --: | --: |
| Wed 12 Aug 03:00–03:15 | no | 180 kWh | 1.00 MW | 250 kWh | **−70 kWh** | €41.20/MWh | **−€2.88** (credit) |
| Wed 12 Aug 10:30–10:45 | yes | 620 kWh | 2.00 MW | 500 kWh | **+120 kWh** | €96.50/MWh | **+€11.58** |
| Wed 12 Aug 19:45–20:00 | yes | 545 kWh | 2.00 MW | 500 kWh | **+45 kWh** | €88.10/MWh | **+€3.96** |
| Wed 12 Aug 20:00–20:15 | no | 505 kWh | 1.00 MW | 250 kWh | **+255 kWh** | €83.40/MWh | **+€21.27** |

Note the step at 20:00: the peak block stops, cover halves, and the open position jumps even though
consumption barely moved. This is exactly the picture the chart overlay has to make obvious.

**Day total for 12 Aug 2026** (illustrative):

```
consumption          = 41 250 kWh
block volume         =  1 MW × 96 × 250 = 24 000 kWh  (base)
                     +  1 MW × 48 × 250 = 12 000 kWh  (peak)
                     = 36 000 kWh

covered              = 33 480 kWh      (Σ min(consumption, block))
uncovered            =  7 770 kWh      (Σ max(consumption − block, 0))
surplus              =  2 520 kWh      (Σ max(block − consumption, 0))
coverage ratio       = 33 480 / 41 250 = 81,2 %
```

Note that **uncovered and surplus both occur on the same day**. Netting them to a single 5 250 kWh
"shortfall" would hide the fact that the site is short in the evening and long in the small hours,
priced at completely different day-ahead levels. The chart and the invoice both keep them separate.

## 7. Blocks that start or end mid-invoice-period

A quarter or calendar-year block spans several invoice months. Attribution is automatic because
everything is computed per interval: a month's invoice sums only the intervals inside that month.

```
blockVolumeInMonth(b, m, M) = allocation_MW(b,m) × |{ i ∈ M : active(b,i) }| × 0.25
```

No pro-rating by day count, no partial-month special case.

## 8. Data quality gates

Coverage and settlement figures are only as good as the interval data. Each derived figure carries a
**data state**:

| State | Meaning | UI treatment |
| --- | --- | --- |
| `NO_DATA` | No PVNed document received for this delivery date yet | Gap in the chart, not a zero |
| `PARTIAL` | Fewer intervals received than the day requires (96 / 92 / 100) | Chart shows the gap; totals flagged |
| `PROVISIONAL` | Complete, but inside the 10-working-day correction window | Chart normal; totals labelled *provisional* |
| `FINAL` | Correction window closed | Clean |

**Zero is a value; missing is not.** A missing interval must never be rendered or summed as `0`.
This single rule prevents the most common class of energy-platform bug.

## 9. Implementation notes

1. **Compute coverage as a query, not a loop.** With a precomputed `calendar_interval` spine, the
   whole thing is one join between interval readings, block allocations and prices. Pulling millions
   of rows into application memory to iterate them is the wrong shape.
2. **Materialise daily aggregates.** A `daily_position` rollup per metering point per day
   (consumption, production, block volume, covered, uncovered, spot cost, data state) makes month
   views and invoice runs fast. Rebuild it whenever a new interval-data version lands for that date.
3. **Invalidate on correction.** A late PVNed correction for 12 August must invalidate the daily
   rollup, the month aggregate, and flag any invoice already issued for that month.
4. **One implementation.** The chart, the invoice and the employee view must call the same coverage
   function. If they diverge, someone will eventually reconcile them by hand at month-close.

## 10. Open questions raised here

| Ref | Question |
| --- | --- |
| [OQ-11] | Does production offset consumption for coverage and invoicing, or is it purely informational? |
| [OQ-13] | Is surplus (over-covered) volume credited at day-ahead, at the block price, or not at all? |
| [OQ-16] | What resolution and coverage does the Montel day-ahead curve provide for NL? |
