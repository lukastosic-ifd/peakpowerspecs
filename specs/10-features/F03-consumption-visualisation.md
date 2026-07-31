# F03 — Consumption & Production Visualisation

**Portal:** customer · **Priority:** Must · **Phase:** 1 (chart) / 2 (block overlay) · **Size:** L

---

## 1. Summary

The chart is the product's centre of gravity. It answers three questions at a glance: *what did I
use*, *what have I already hedged*, and *where am I exposed*. Everything else — price indications,
the trade wizard — hangs off a decision the customer makes while looking at this screen.

Two views: **day** (96 points, the shape of a working day) and **month** (daily totals, the shape of a
season). Purchased blocks overlay both.

## 2. User stories

| As a… | I want to… | So that… |
| --- | --- | --- |
| Customer user | see a day's consumption in 15-minute detail | I can see my load shape and my peaks |
| Customer user | see a month at daily resolution | I can see trend and weekday/weekend patterns |
| Customer user | see my purchased blocks drawn on the same chart | I can tell covered from uncovered volume immediately |
| Customer user | compare this period against the previous one | I can see whether something changed |
| Customer user | see consumption and production together | I understand my net position |
| Customer user | know whether the data is provisional or final | I know how much to trust it |
| Customer user | switch between metering points, or view several combined | I can work per site or per portfolio |
| Customer user | export the underlying data | I can use it in my own model |
| Customer user | go from "I'm exposed here" to a trade request in one click | the insight leads somewhere |

## 3. Functional requirements

### Day view

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F03-R01 | The day view renders 15-minute interval data for one Amsterdam calendar day: 96 points normally, 92 or 100 on DST transition days. | Must |
| F03-R02 | Consumption and production are rendered as distinct, visually separable series. | Must |
| F03-R03 | The x-axis is local time with hour ticks; the autumn duplicate hour is labelled unambiguously (`02:00 A` / `02:00 B`). | Must |
| F03-R04 | The y-axis is kWh per interval by default, with a toggle to average kW. | Should |
| F03-R05 | Hovering an interval shows a tooltip with: local time range, consumption, production, block cover, net position, and the day-ahead price if available. | Must |
| F03-R06 | Missing intervals are drawn as gaps, never as zero **[F02-R25]**. | Must |
| F03-R07 | Date navigation: previous/next day, a date picker, and a jump to the most recent day with data. | Must |

### Month view

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F03-R08 | The month view renders daily totals for one calendar month. | Must |
| F03-R09 | Each day is clickable and drills into the day view. | Must |
| F03-R10 | Days with partial or missing data are visually marked, not silently short. | Must |
| F03-R11 | Weekends and non-working days are shaded, using the same calendar as the peak definition **[DEC-14]**. | Should |
| F03-R12 | A quarter and a year view follow the same pattern at coarser granularity. | Could |

### Block overlay

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F03-R13 | Confirmed blocks are overlaid as a step line showing total block power per interval, stacking base and peak **[F05](F05-energy-block-trading.md)**. | Must |
| F03-R14 | The area below the overlay and under the consumption curve is rendered as **covered**; consumption above it as **uncovered**; overlay above consumption as **surplus**. | Must |
| F03-R15 | The overlay is derived from the same coverage function used for invoicing — one implementation, no divergence. | Must |
| F03-R16 | Accepted-but-unconfirmed trades can be shown as a separate, visually provisional overlay, off by default and clearly labelled. | Should |
| F03-R17 | A legend lists the contributing blocks, each linking to its trade detail. | Must |
| F03-R18 | Individual blocks can be toggled to see the effect of removing one. | Could |

### Metrics and interaction

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F03-R19 | A KPI strip above the chart shows, for the visible range: total consumption, total production, block volume, covered %, uncovered MWh, surplus MWh, and indicative day-ahead cost of the open position. | Must |
| F03-R20 | Every KPI carries the data state of its range; a range containing non-final data is labelled *provisional*. | Must |
| F03-R21 | A metering point selector supports one, several, or all — with several rendering the aggregate. | Must |
| F03-R22 | Comparison mode overlays the previous equivalent period (previous day / same weekday last week / previous month / same month last year). | Should |
| F03-R23 | The visible data can be exported as CSV and as PNG. | Should |
| F03-R24 | A **"Hedge this exposure"** action on the chart opens the trade wizard pre-filled with the visible period and the uncovered volume as a suggested MW. | Should |
| F03-R25 | The chart is usable on a tablet: pinch-zoom on the x-axis, tap for tooltip. Phone gets a simplified view. | Should |

## 4. Business rules

1. **One coverage implementation.** Chart, invoice and employee view call the same function. A
   discrepancy between the chart and the invoice destroys trust faster than any bug.
2. **Provisional data is always labelled.** No number derived from non-final data appears without its
   state.
3. **Aggregation across metering points sums volumes; it never averages prices or ratios.**
   Coverage ratio for a selection is `Σ covered / Σ consumption`.
4. **The overlay reflects allocation, not the whole block.** If a 1 MW block is allocated 0.2 MW to
   this metering point, the overlay shows 0.2 MW here.
5. **Local time throughout.** No UTC anywhere in a customer-facing chart.
6. **Empty state is informative.** "No data yet — first data for a day arrives the following day"
   beats a blank canvas.

## 5. Reading the chart

```mermaid
flowchart LR
    subgraph legend[" "]
        direction TB
        A["▇ Covered consumption<br/><i>supplied by your blocks</i>"]
        B["▇ Uncovered consumption<br/><i>settled at day-ahead</i>"]
        C["▇ Surplus block volume<br/><i>sold back at day-ahead</i>"]
        D["━ Block power (step line)<br/><i>base + peak stacked</i>"]
        E["▁ Production<br/><i>informational</i>"]
    end
```

The 08:00 and 20:00 steps in the block line on weekdays are the single most informative feature of
the chart — they show peak cover starting and stopping. The design must not smooth them.

## 6. Screens

| Screen | Mockup |
| --- | --- |
| Day view with block overlay | [`chart-day-view.svg`](../60-mockups/chart-day-view.svg) |
| Month view | [`chart-month-view.svg`](../60-mockups/chart-month-view.svg) |
| Customer dashboard (chart in context) | [`customer-dashboard.svg`](../60-mockups/customer-dashboard.svg) |

## 7. Data & performance

| Concern | Approach |
| --- | --- |
| Day view payload | 96 intervals × a handful of series — trivial |
| Month view | Served from the `daily_position` rollup, not from raw intervals |
| Year view across 50 metering points | Served from a monthly rollup |
| Cache | Rollups are cached with the interval-data version as part of the cache key, so a correction invalidates naturally |
| Target | Day view interactive within **1.5 s** on a warm cache; month view within **2 s** ([NFR-03](../20-architecture/08-non-functional-requirements.md)) |

## 8. Edge cases

| Case | Behaviour |
| --- | --- |
| DST autumn day | 100 intervals; duplicate hour labelled `02:00 A` / `02:00 B`; day total correctly exceeds a normal day |
| DST spring day | 92 intervals; the 02:00–03:00 gap is a real gap, drawn as such |
| No data at all for the metering point | Explanatory empty state with the expected first-data date |
| Data arrives while the user is viewing | A non-intrusive "new data available" affordance; no silent redraw |
| Block covers only part of the visible range | The step line drops to zero outside the delivery period — never extrapolated |
| Production exceeds consumption | Both series render; net position goes negative; KPI strip explains it |
| A correction changes yesterday | Chart shows the new values with a "corrected on …" marker |
| 50 metering points selected | Aggregate only; per-EAN breakdown moves to a table below the chart |

## 9. Out of scope

- Forecasting or predicted consumption.
- Weather overlays.
- Real-time / near-live metering (data is D+1 by nature).
- Anomaly detection.

## 10. Dependencies

| Depends on | Why |
| --- | --- |
| [F02](F02-metering-data-ingestion.md) | The data itself |
| [F05](F05-energy-block-trading.md) | Blocks to overlay |
| [F08](F08-day-ahead-prices.md) | Price in tooltips and the exposure KPI |
| [Position & coverage](../50-calculations/02-position-and-coverage.md) | The maths |

## 11. Open questions

| Ref | Question |
| --- | --- |
| [OQ-11] | Does production net against consumption, or is it informational only? |
| [OQ-22] | Which charting library — and is a commercial licence acceptable? |
