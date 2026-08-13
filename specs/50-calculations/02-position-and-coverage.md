# Position & Coverage

How measured consumption, measured production, purchased blocks and market prices combine into a
per-interval position. This is the model behind the chart overlay, the "am I covered?" question, and
the energy lines on the invoice.

---

## 1. The core identity

For every 15-minute interval `i` and metering point `m`:

```
netUsage(i,m)     =  consumption(i,m)  −  production(i,m)          [DEC-22]
netPosition(i,m)  =  netUsage(i,m)     −  blockVolume(i,m)
```

**[DEC-22] makes net usage the platform's volume basis**, superseding **[AS-06]**: production nets
against consumption instead of being displayed only. Coverage, the net position, the spot settlement
and the invoice are all measured against net usage. Closes [OQ-11].

| Sign of `netUsage` | Meaning |
| --- | --- |
| `> 0` | **Net import** — the site drew more from the grid than it generated |
| `= 0` | Generation exactly matched consumption |
| `< 0` | **Net export** — generation exceeded consumption. Settled at the **feed-in tariff** on its own invoice line **[DEC-44]**, not at day-ahead |

| Sign of `netPosition` | Meaning | Settlement |
| --- | --- | --- |
| `> 0` | **Short** — net usage exceeded the hedge | Buy the shortfall at the day-ahead price |
| `= 0` | Perfectly covered | Nothing settles at spot |
| `< 0` | **Long** — hedged more than the net usage | Sell the **unused cover** at the day-ahead price **[DEC-23]**. Any **physical export** inside that surplus leaves the day-ahead leg and settles at the feed-in tariff **[DEC-44]** |

**[DEC-44] splits the sale side and partially reopens [DEC-23].** Over-covered volume is no longer one
settlement. Unused block cover still settles at the raw day-ahead price of the interval; physically
exported volume — net usage below zero — is separated out and settled at a per-customer **feed-in
tariff** as invoice line 6. The split is derived in §4 and priced in §5. The other half of **[DEC-44]**
closes **[OQ-35]**: day-ahead settlement uses the **raw** price, with no spread, on both legs.

Everything else in this document is bookkeeping around those two lines.

## 2. Inputs

| Input | Source | Resolution | Notes |
| --- | --- | --- | --- |
| `consumption(i,m)` | PVNed allocation data, `Direction = A02` | 15 min, kWh | Gross, non-negative **[AS-05]**. The current version for that delivery date **[DEC-07]** |
| `production(i,m)` | PVNed allocation data, `Direction = A01` | 15 min, kWh | Gross, non-negative **[AS-05]**. **Nets against consumption [DEC-22]** — supersedes [AS-06], closes [OQ-11] |
| `netUsage(i,m)` | Derived from the two series above | 15 min, kWh | `consumption − production`. **May be negative.** See §2.1 |
| `blockVolume(i,m)` | Confirmed blocks | Derived | See §3 |
| `dayAheadPrice(i)` | Montel | Per market time unit | **Raw price, no spread [DEC-44]**, closing [OQ-35]. See §5. Arrives 18:00 Europe/Amsterdam **[DEC-36]** |
| `feedInRate(customer, i)` | `billing.feed_in_tariff` reference data | Per validity period | **€/kWh, signed [DEC-44]** — same shape and resolution rules as the surcharge. See §5.3 |
| `imbalance` | PVNed imbalance report | 15 min, portfolio level | **Deferred by [DEC-25]** — `A12` documents are stored, not turned into charges. See [Invoice calculation](03-invoice-calculation.md) §5 |

### 2.1 Net usage is derived, never stored as a source series

Consumption and production remain two separate, non-negative series per metering point **[AS-05]**.
`netUsage` is computed from them per interval; neither series is overwritten with a signed value, and
both stay available for the chart and for the invoice's own volume check.

**Zero is a value; missing is not — and it propagates.** If either the consumption or the production
interval is missing, `netUsage` for that interval is **missing**, not the other series' value. A
derived figure is never more complete than its least complete input. See §8.

One distinction the implementation must make explicitly: a metering point with no production
registration has no `A01` series at all, which is *not* a missing interval — production is
structurally zero there. Whether production is expected must be a recorded property of the metering
point, not inferred from the absence of a document. Inferring it makes a genuine ingestion gap look
like a zero, which is precisely what §8 exists to prevent.

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

Derived from `netUsage` and `netPosition` for presentation. Writing `U = netUsage(i,m)` and
`B = blockVolume(i,m)`, and noting that **[DEC-22]** allows `U < 0`:

```
covered(i,m)      = min( max(U, 0), max(B, 0) )
uncovered(i,m)    = max( max(U, 0) − B, 0 )          → day-ahead purchase   line 2
unusedCover(i,m)  = max( B − max(U, 0), 0 )          → day-ahead sale       line 2   [DEC-44]
exported(i,m)     = max( −U, 0 )                     → feed-in tariff       line 6   [DEC-44]
overCovered(i,m)  = max( −netPosition(i,m), 0 )  =  max( B − U, 0 )
```

`uncovered` and `unusedCover` are the positive and the negative part of one quantity,
`max(U,0) − B`, so at most one of them is non-zero in any interval. `overCovered` is retained as the
sum of `unusedCover` and `exported` — it is no longer a settlement quantity in its own right.

> **On `uncovered`.** It was written `max( U − B, 0 )`, the positive part of the net position, and the
> two forms agree everywhere except one quadrant. The clamped form above is the one to implement; the
> reason is in the warning below.

**What changed under [DEC-22], and what did not.** Only `covered` needed a new clamp then. `uncovered`
and `overCovered` were the positive and the negative part of the net position, which is why they kept
behaving correctly once net usage could go negative: an exporting interval has nothing to buy
(`uncovered = 0`), and its export was added to the surplus (`overCovered = B + |U|`). `covered`
without the outer clamp would return the negative net usage itself, which is meaningless: covered
volume is volume that never reaches the spot market, and an exporting interval has none.

**What [DEC-44] changed.** `overCovered` is no longer a settlement quantity — it is the *sum* of two
quantities that now settle at different prices:

```
overCovered(i,m)  =  unusedCover(i,m)  +  exported(i,m)
```

`unusedCover` is block cover the site did not use, sold back at the raw day-ahead price **[DEC-23]**.
`exported` is electricity that physically left the meter, credited at the feed-in tariff **[DEC-44]**.
No definition was withdrawn: `overCovered` and `exported` are unchanged, `unusedCover` is new, and
`uncovered` gains a clamp that is a no-op wherever the block position is long or flat.

**Verification of the identity, case by case.** Taking `B ≥ 0`, which the three cases below assume:

| Case | `overCovered = max(B−U,0)` | `unusedCover = max(B−max(U,0),0)` | `exported = max(−U,0)` | `unusedCover + exported` | |
| --- | --- | --- | --- | --- | :--: |
| `U ≥ 0`, `B ≤ U` | `0` | `max(B−U,0) = 0` | `0` | `0` | ✓ |
| `U ≥ 0`, `B > U` | `B − U` | `max(B−U,0) = B−U` | `0` | `B − U` | ✓ |
| `U < 0` | `B − U = B + \|U\|` | `max(B−0,0) = B` | `\|U\|` | `B + \|U\|` | ✓ |

The `U < 0` line is the whole point of **[DEC-44]**: the surplus that **[DEC-23]** treated as one
`B + |U|` block sold at day-ahead is now `B` at day-ahead and `|U|` at the feed-in tariff.

> ⚠ **The identity fails in one quadrant: `U < 0` together with `B < 0`.** A net **sell** block
> position in an exporting interval breaks it, because `exported` then counts export volume that the
> sold block has already committed. Take `B = −100`, `U = −250`: `overCovered = 150`,
> `unusedCover = 0`, `exported = 250`, and `0 + 250 ≠ 150`. The volume identity in
> [Invoice calculation](03-invoice-calculation.md) §11.1 fails with it, by the same 100 kWh.
>
> **The fix is one clamp**, and it changes nothing anywhere else:
>
> ```
> uncovered(i,m) = max( max(U, 0) − B, 0 )        instead of  max( U − B, 0 )
> ```
>
> The two agree whenever `U ≥ 0`, and whenever `B ≥ 0` they are both zero for `U < 0`. They differ
> only in the `U < 0 ∧ B < 0` quadrant, and with the clamp in place the volume identity holds for
> every sign of `U` and `B` — see the proof in [Invoice calculation](03-invoice-calculation.md) §11.1.
>
> Under **[DEC-34]** short selling is not permitted and sell requests validate against confirmed
> holdings, so per-interval `B < 0` should be unreachable. The row is nonetheless still documented
> below, and the clamp costs nothing. **Implement the clamped form**; do not rely on [DEC-34] to keep
> an arithmetic identity true.

Behaviour by case:

| `netUsage` | `blockVolume` | `covered` | `uncovered` | `overCovered` | `unusedCover` | `exported` | Reading |
| --- | --- | --: | --: | --: | --: | --: | --- |
| `U > 0` | `B ≥ U` | `U` | `0` | `B − U` | `B − U` | `0` | Hedged, with cover to spare; the spare is sold at day-ahead |
| `U > 0` | `0 ≤ B < U` | `B` | `U − B` | `0` | `0` | `0` | Partly hedged; the rest is bought at spot |
| `U = 0` | `B ≥ 0` | `0` | `0` | `B` | `B` | `0` | Nothing used; the whole block is sold back at day-ahead |
| `U < 0` | `B ≥ 0` | `0` | `0` | `B + \|U\|` | `B` | `\|U\|` | **Export.** Cover sold at day-ahead **[DEC-23]**; the exported volume credited at the feed-in tariff **[DEC-44]** |
| any | `B < 0` | `0` | `max( max(U,0) − B, 0 )` | `max(B − U, 0)` | `0` | `max(−U, 0)` | Net **sell** position: no cover exists to be "covered". See the caveat above |

Invariants, with `uncovered` in the clamped form defined above:

```
covered, uncovered, overCovered, unusedCover, exported   ≥  0        always
uncovered(i,m) × unusedCover(i,m)  =  0                              at most one of the two is non-zero
uncovered(i,m) − unusedCover(i,m)  =  max( U, 0 ) − B                always            [DEC-44]
uncovered(i,m) − overCovered(i,m)  =  netPosition(i,m)               when blockVolume ≥ 0
overCovered(i,m) = unusedCover(i,m) + exported(i,m)                  when blockVolume ≥ 0   [DEC-44]
covered(i,m) + uncovered(i,m)      =  max( netUsage(i,m), 0 )        when blockVolume ≥ 0
covered(i,m) + unusedCover(i,m)    =  blockVolume(i,m)               when blockVolume ≥ 0   [DEC-44]
```

The third line is the one the invoice's volume identity is now built on — see
[Invoice calculation](03-invoice-calculation.md) §11.1. The last is new with **[DEC-44]** and is worth
asserting on its own: every kWh of block cover is either used by the site or sold back, and nothing
else can happen to it. The two `blockVolume ≥ 0` lines involving `netPosition` hold only for a
long-or-flat block position; with `B < 0` the customer must also buy back what was sold, so
`uncovered` exceeds the net import volume by `|B|`.

```
coverageRatio(i,m) = covered(i,m) / max( netUsage(i,m), 0 )    // undefined when netUsage ≤ 0
```

Aggregated over a period `P` (day, month, quarter):

```
coverageRatio(P,m) = Σ_i∈P covered(i,m)  /  Σ_i∈P max( netUsage(i,m), 0 )
```

> **The denominator is net *import* volume, not net usage.** Summing signed net usage would let
> exporting intervals shrink the denominator and push the ratio above 100%, which is not a coverage
> ratio. The question the KPI answers is "what share of the volume I had to buy was hedged?", and an
> exporting interval contributes nothing to buy. A range with no import intervals at all has **no**
> coverage ratio: render it `—`, never `0%`.

> **Aggregate first, then divide.** Averaging per-interval ratios gives a different — and wrong —
> answer, because it weights a 5 kWh interval the same as a 500 kWh one.

### 4.1 What the customer sees

| Metric | Where |
| --- | --- |
| Coverage ratio for the visible range | Chart header KPI — denominator is net import volume |
| Uncovered MWh for the visible range | Chart header KPI |
| Cost of uncovered volume at day-ahead | Chart header KPI, marked *indicative* until the month is final |
| Unused-cover MWh and its day-ahead credit for the visible range | Chart header KPI, same *indicative* treatment **[DEC-23]** |
| Exported MWh and its feed-in credit for the visible range | Chart header KPI, same *indicative* treatment **[DEC-44]**. Shown separately from the unused-cover credit, because the two carry different prices |
| Net usage alongside the two gross series, consumption and production | Chart body — three series **[DEC-22]** |
| Per-interval stacked area: covered / uncovered | Chart body |
| Block step-line overlay | Chart body |

See the [consumption chart mockup](../60-mockups/README.md).

## 5. Pricing the open position

**[DEC-44] splits this into two legs.** The volume that reaches the day-ahead market is the net
position with the physical export taken out of it:

```
dayAheadVolume(i,m) = max( U, 0 ) − B          =  uncovered(i,m) − unusedCover(i,m)
                    = netPosition(i,m) + exported(i,m)
```

The two right-hand forms are the same quantity written twice, and the second says what happened: the
day-ahead leg is measured against net **import** volume, not against signed net usage. In a
non-exporting interval `exported = 0` and `dayAheadVolume = netPosition`, so nothing changes for the
great majority of intervals.

```
dayAheadSettlement(i,m) = dayAheadVolume(i,m) / 1000 × dayAheadPrice(i)      // kWh → MWh
feedInCredit(i,m)       = − exported(i,m) × feedInRate(customer, i)          // €/kWh — no divisor
```

A positive result is a cost to the customer; a negative result is a credit. Note the two different
shapes: `dayAheadPrice` is €/MWh and carries the `/1000`, while `feedInRate` is **€/kWh** and does not
— the same unit split **[DEC-35]** introduces for the surcharge, and for the same reason. Mixing them
up is a factor-1000 error in a credit line, so the unit belongs in the column name.

**[DEC-23] fixes the price on the day-ahead credit side and closed [OQ-13]; [DEC-44] narrows what it
applies to.** Unused block cover is credited at the day-ahead price of the interval concerned. Export
is not — it leaves the day-ahead leg entirely. **[DEC-44] also closes the other half of [OQ-35]: the
raw day-ahead price is used, with no spread, on both the buy and the sell leg.**

Three quantities are accumulated separately and none of them is ever netted against another:

```
purchase(m,P) = Σ_{i ∈ P, dayAheadVolume > 0}  dayAheadVolume(i,m) / 1000 × dayAheadPrice(i)
sale(m,P)     = Σ_{i ∈ P, dayAheadVolume < 0}  dayAheadVolume(i,m) / 1000 × dayAheadPrice(i)  // negative
feedIn(m,P)   = − Σ_{i ∈ P}  exported(i,m) × feedInRate(customer, i)                          // negative
```

They appear on the invoice as a purchase line, a **separate sale line** and a **separate feed-in
line** — lines 2 and 6, never one net figure. See [Invoice calculation](03-invoice-calculation.md) §4
and §7A. Uncovered volume, unused cover and export occur at different times and now at three
different prices; netting any pair of them prices both at an average that existed in no interval.

### 5.1 Price granularity

Day-ahead prices are published per **market time unit**. Since the European day-ahead market moved to
15-minute MTUs, the platform should expect 15-minute prices — but must not assume it.

**The rule:** store the day-ahead price at whatever resolution the source delivers, together with its
validity interval, and resolve `dayAheadPrice(i)` by looking up the price whose validity interval
contains `i`. An hourly price then simply applies to four consecutive intervals with no special case.

**[OQ-16] is now partly answered. [DEC-36] fixes the arrival time — the NL day-ahead curve lands at
18:00 Europe/Amsterdam**, replacing the four-attempt schedule with a single fetch plus retry. That is
a jobs concern rather than a calculation one; see
[Background jobs](../20-architecture/06-background-jobs.md). What **[DEC-36]** does *not* answer is
the resolution Montel delivers, nor how far back history can be fetched — and the second of those
limits how far back a position can be settled. The rule above stands either way: store what arrives,
with its validity interval, and resolve by lookup.

### 5.2 Missing prices

A missing day-ahead price blocks invoicing for the affected day. The invoice run halts that customer
with a clear `MISSING_DAY_AHEAD_PRICE` reason rather than substituting a value. Silent substitution
of a market price is the kind of thing that is discovered a year later.

### 5.3 The feed-in tariff

**[DEC-44]** introduces a second per-unit reference rate alongside the surcharge, with deliberately
the same shape, so there is one mechanism to build, test and reason about:

| Property | Feed-in tariff | Same as the surcharge? |
| --- | --- | :--: |
| Scope resolution | Customer-specific → global default → **zero** | yes |
| Validity | Half-open `[from, to)` periods; no overlap per scope, enforced by a database exclusion constraint | yes |
| Sign | Signed. The normal case is a positive rate producing a credit | yes |
| Unit | **€/kWh** | yes **[DEC-35]** |
| Application | Per interval, at the rate valid for that interval — a mid-month change produces two lines, never a blend | yes |
| Snapshot | The applied rate is stored on the invoice line | yes |
| History | Never edited retroactively into a period already invoiced | yes |

**Why €/kWh.** **[DEC-35]** puts the surcharge in €/kWh, and the feed-in tariff is the same kind of
object: a per-unit rate on metered volume, set commercially per customer, quoted to the customer in
the same conversation. Two per-unit rates on one invoice in two different units is a defect waiting to
be written. The same precision consequence follows — see
[Invoice calculation](03-invoice-calculation.md) §7A — and the same boundary holds: block prices and
day-ahead prices remain **€/MWh**.

> ⚠ **Unanswered by [DEC-44]: what applies when a site exports and no feed-in tariff resolves.**
> The table above copies the surcharge's resolution order for symmetry, but the two cases are not
> alike. A missing surcharge bills nothing and costs the customer nothing; a missing feed-in tariff
> means exported energy is taken and **not paid for**. Zero and day-ahead-as-fallback (**[DEC-23]**'s
> price) are both defensible, and they differ in money for every exporting site. **This needs a
> decision of its own and must be registered as an open question against [DEC-44]** — do not let the
> surcharge's default settle it by inheritance. Until it is answered, the invoice run treats a
> non-resolving feed-in tariff as a **warning** where the month has no export and as a **hard skip**
> where it does, so no invoice can be issued that silently values export at zero. See
> [Monthly invoicing](../40-processes/04-monthly-invoicing.md) §5.

## 6. Worked example

**Setup.** One metering point with rooftop PV. 1 MW base + 1 MW peak for August 2026. Five sample
intervals. All volumes in kWh. Feed-in tariff €0.0285/kWh **[DEC-44]** — that is €28.50/MWh, quotable
against the day-ahead column.

| Interval (local) | Peak? | Consumption | Production | Net usage | blockPower | blockVolume | netPosition | DA price |
| --- | :--: | --: | --: | --: | --: | --: | --: | --: |
| Wed 12 Aug 03:00–03:15 | no | 180 | 0 | **180** | 1.00 MW | 250 | **−70** | €41.20/MWh |
| Wed 12 Aug 10:30–10:45 | yes | 620 | 145 | **475** | 2.00 MW | 500 | **−25** | €96.50/MWh |
| Wed 12 Aug 13:00–13:15 | yes | 610 | 790 | **−180** | 2.00 MW | 500 | **−680** | €38.60/MWh |
| Wed 12 Aug 19:45–20:00 | yes | 545 | 60 | **485** | 2.00 MW | 500 | **−15** | €88.10/MWh |
| Wed 12 Aug 20:00–20:15 | no | 505 | 20 | **485** | 1.00 MW | 250 | **+235** | €83.40/MWh |

Settlement, decomposed per **[DEC-44]**. `dayAheadVolume = max(U,0) − B`, which equals `netPosition`
in every interval except the exporting one:

| Interval (local) | `uncovered` | `unusedCover` | `exported` | `dayAheadVolume` | Day-ahead settlement | Feed-in credit |
| --- | --: | --: | --: | --: | --: | --: |
| 03:00–03:15 | 0 | 70 | 0 | **−70** | **−€2.88** | — |
| 10:30–10:45 | 0 | 25 | 0 | **−25** | **−€2.41** | — |
| 13:00–13:15 | 0 | 500 | **180** | **−500** | **−€19.30** | **−€5.13** |
| 19:45–20:00 | 0 | 15 | 0 | **−15** | **−€1.32** | — |
| 20:00–20:15 | 235 | 0 | 0 | **+235** | **+€19.60** | — |

Arithmetic for the day-ahead column, `dayAheadVolume / 1000 × DA`, rounded half-away-from-zero to
2 decimals: `−70 × 41.20 / 1000 = −2.884 → −2.88`; `−25 × 96.50 / 1000 = −2.4125 → −2.41`;
`−500 × 38.60 / 1000 = −19.30`; `−15 × 88.10 / 1000 = −1.3215 → −1.32`;
`+235 × 83.40 / 1000 = +19.599 → +19.60`. For the feed-in column, `exported × rate` with **no
divisor** because the rate is €/kWh **[DEC-35]**, **[DEC-44]**: `180 × 0.0285 = 5.13`.

Three things this table is here to show:

- **13:00–13:15 has negative net usage, and [DEC-44] splits it.** Production exceeds consumption by
  180 kWh, so the site is exporting. `covered` is zero and the surplus is still
  `500 + 180 = 680 kWh` — but it no longer settles as one figure. The 500 kWh of unused block cover
  is sold at the day-ahead price **[DEC-23]**; the 180 kWh that physically left the meter is credited
  at the feed-in tariff **[DEC-44]**. Check the decomposition against §4:
  `unusedCover + exported = 500 + 180 = 680 = overCovered` ✓.
- **The split is worth money.** Under **[DEC-23]** alone this interval credited
  `680 × 38.60 / 1000 = €26.25`. It now credits `19.30 + 5.13 = €24.43`, because the feed-in tariff of
  €28.50/MWh is below the €38.60/MWh day-ahead price of that interval. Midday export and midday
  solar-depressed prices arrive together, so this is the normal direction of the difference, not an
  unlucky sample — but the sign is not guaranteed, and a negative day-ahead hour reverses it.
- **The step at 20:00.** Net usage is identical in the last two intervals, 485 kWh both times. The
  peak block stops, cover halves, and the position flips from long to short on the cover alone. This
  is exactly the picture the chart overlay has to make obvious.

**Day total for 12 Aug 2026** (illustrative):

```
gross consumption            = 41 250 kWh
production                   = 12 500 kWh
net usage    Σ U             = 28 750 kWh          = 41 250 − 12 500
  of which import  Σ max(U,0)  = 30 850 kWh
  of which export  Σ max(−U,0) =  2 100 kWh          30 850 − 2 100 = 28 750  ✓

block volume                 =  1 MW × 96 × 250 = 24 000 kWh  (base)
                             +  1 MW × 48 × 250 = 12 000 kWh  (peak)
                             = 36 000 kWh

covered      Σ min(max(U,0), max(B,0))  = 27 100 kWh
uncovered    Σ max(U − B, 0)            =  3 750 kWh      = 30 850 − 27 100
surplus      Σ max(B − U, 0)            = 11 000 kWh      = 36 000 + 2 100 − 27 100
coverage ratio                          = 27 100 / 30 850 = 87,8 %

invariant check:  uncovered − surplus = 3 750 − 11 000 = −7 250 = Σ U − Σ B = 28 750 − 36 000  ✓

the surplus splits [DEC-44]:
  unusedCover  Σ max(B − max(U,0), 0)   =  8 900 kWh      → day-ahead sale, line 2
  exported     Σ max(−U, 0)             =  2 100 kWh      → feed-in tariff, line 6
                                          11 000 = 8 900 + 2 100 = surplus  ✓
  cross-check  covered + unusedCover    = 27 100 + 8 900 = 36 000 = block volume  ✓

volume identity [DEC-44]:
  Σ B + uncovered − unusedCover − exported
    = 36 000 + 3 750 − 8 900 − 2 100  =  28 750  =  Σ U  ✓
```

Note that **uncovered, unused cover and export all occur on the same day**, and that netting them to
a single 7 250 kWh net-long figure would hide the fact that the site is short in the evening and long
around midday — priced at completely different day-ahead levels, and midday is the cheap end of the
curve. The chart and the invoice keep all three separate **[DEC-23]**, **[DEC-44]**.

The cross-check on the second-to-last line is the new invariant from §4 and is the cheapest available
test of the split: every kWh of block cover is either consumed by the site or sold back, so
`covered + unusedCover` must equal block volume exactly. If it does not, the day-ahead sale leg and
the feed-in leg have been divided wrongly, and the volume identity below will fail with it.

Note also what **[DEC-22]** did to this site: on gross consumption it was 5 250 kWh short for the
day; on net usage it is 7 250 kWh long. Netting production does not shade the position, it can
reverse it.

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

Under **[DEC-22]** the rule has to survive one derivation step. `netUsage` carries the **worse** of the
two source series' states, ordered `NO_DATA < PARTIAL < PROVISIONAL < FINAL`: `NO_DATA` if either side
is `NO_DATA`, `PARTIAL` if either is `PARTIAL`, `PROVISIONAL` if either is `PROVISIONAL`, and `FINAL`
only when both are `FINAL`. A complete consumption day paired with a half-delivered production day is
a `PARTIAL` net day — not a day on which the site happened to generate less. The same rule propagates
to `netPosition`, to every coverage metric and to the invoice.

## 9. Implementation notes

1. **Compute coverage as a query, not a loop.** With a precomputed `calendar_interval` spine, the
   whole thing is one join between interval readings, block allocations and prices. Pulling millions
   of rows into application memory to iterate them is the wrong shape.
2. **Materialise daily aggregates.** A `daily_position` rollup per metering point per day
   (gross consumption, production, net usage, import volume `Σ max(U,0)`, export volume
   `Σ max(−U,0)`, block volume, covered, uncovered, **unused cover**, surplus, day-ahead cost,
   day-ahead credit, **feed-in credit**, data state) makes month views and invoice runs fast. Rebuild
   it whenever a new interval-data version lands for that date — for **either** direction, since both
   feed net usage **[DEC-22]**. Store the import and export sums, not only the signed net: they cannot
   be recovered from a signed daily total. The same now applies to unused cover and export
   **[DEC-44]** — a stored `surplus` alone cannot be split back into its two legs after the fact,
   because the split depends on the sign of `U` interval by interval.
3. **Invalidate on correction.** A late PVNed correction for 12 August must invalidate the daily
   rollup, the month aggregate, and flag any invoice already issued for that month.
4. **One implementation.** The chart, the invoice and the employee view must call the same coverage
   function. If they diverge, someone will eventually reconcile them by hand at month-close.

## 10. Open questions raised here

| Ref | Question | Status |
| --- | --- | --- |
| [OQ-11] | Does production offset consumption for coverage and invoicing, or is it purely informational? | **Closed by [DEC-22]** — it offsets. Net usage is the volume basis; [AS-06] is superseded |
| [OQ-13] | Is surplus (over-covered) volume credited at day-ahead, at the block price, or not at all? | **Closed by [DEC-23]**, then **narrowed by [DEC-44]** — day-ahead now applies to *unused block cover* only. Physical export leaves the day-ahead leg for the feed-in tariff |
| [OQ-16] | What resolution and coverage does the Montel day-ahead curve provide for NL? | **Partly answered by [DEC-36]** — the curve arrives at 18:00 Europe/Amsterdam. Resolution and backfill depth are still open |
| [OQ-35] | Is the raw day-ahead price used for settlement, or a price plus a spread? | **Closed by [DEC-44]** — the **raw** price, no spread, on both the buy and the sell leg |
| *(unnumbered)* | When a customer exports but no feed-in tariff resolves, is the export valued at zero or at the day-ahead price? | **Open — needs a decision.** Not answered by **[DEC-44]**; the two options differ in money for every exporting site. Interim behaviour in §5.3. Register against [DEC-44] |
