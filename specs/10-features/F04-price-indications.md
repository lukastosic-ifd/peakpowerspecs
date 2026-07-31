# F04 — Price Indications (Montel)

**Portal:** customer · **Priority:** Must · **Phase:** 2 · **Size:** M

---

## 1. Summary

Customers need a sense of where the market is before they ask for a price. The platform pulls
wholesale forward prices from Montel — base and peak, for month, quarter and calendar-year delivery
— and shows them as **indications only**.

The word "indication" carries legal weight here. These prices are not quotes, not offers, and not
tradeable. Only PeakPower's response to a trade request is binding. The UI has to make that
distinction unmissable without making the numbers useless.

## 2. User stories

| As a… | I want to… | So that… |
| --- | --- | --- |
| Customer user | see current market prices for the products I could buy | I can judge whether now is a reasonable moment |
| Customer user | see how a price has moved recently | I have context for "is this high?" |
| Customer user | understand that these are indications, not offers | I am not surprised when the actual offer differs |
| Customer user | go from a price tile straight into a trade request for that product | the path from interest to request is short |
| Employee | control which tickers map to which product | the customer sees the products we actually trade |
| Employee | see when the price feed is stale | I know the customer is looking at old numbers |

## 3. Product / ticker matrix

The customer-facing dimension is **shape × delivery period**:

| | Month-ahead | Quarter-ahead | Calendar-year-ahead |
| --- | --- | --- | --- |
| **Base** | `NL Base M+1` | `NL Base Q+1` | `NL Base Cal+1` |
| **Peak** | `NL Peak M+1` | `NL Peak Q+1` | `NL Peak Cal+1` |

Each cell maps to a Montel ticker through **configurable reference data**, never a hard-coded symbol:

```
price_indication_product
  ├─ code                NL_POWER_BASE_M1
  ├─ commodity           ELECTRICITY
  ├─ shape               BASE | PEAK
  ├─ period_type         MONTH | QUARTER | YEAR
  ├─ relative_offset     1 = next, 2 = the one after
  ├─ montel_ticker       (external symbol)
  ├─ display_name        "Base — next month"
  ├─ display_order
  └─ active
```

The exact Montel symbols must come from the existing Montel implementation and be confirmed against
the live feed — see **[OQ-23]**. Showing the *front two* periods per cell (M+1 and M+2, Q+1 and Q+2,
Cal+1 and Cal+2) is the recommended default; more than that is noise for this audience.

## 4. Functional requirements

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F04-R01 | The platform polls Montel on a schedule and stores each observation with its ticker, price, currency, unit and source timestamp. | Must |
| F04-R02 | Poll frequency is configurable per product, defaulting to every 5 minutes during market hours and hourly outside them. | Must |
| F04-R03 | Observations are stored as an append-only series; the latest is the current indication. History is retained for the trend view. | Must |
| F04-R04 | The customer portal shows a price board: one tile per active product with price, unit (€/MWh), change vs. previous close, and the observation timestamp. | Must |
| F04-R05 | Every tile and every price carries an explicit **"Indication — not an offer"** label. A tooltip explains that a firm price is only given in response to a trade request. | Must |
| F04-R06 | If the newest observation for a product is older than a configurable staleness threshold (default 30 min during market hours), the tile is visibly marked stale with its age. | Must |
| F04-R07 | If no observation exists at all, the tile shows "unavailable" rather than a blank or a zero. | Must |
| F04-R08 | A tile links into the trade wizard with shape and delivery period pre-filled. | Must |
| F04-R09 | A tile expands into a trend chart of the last 30 / 90 / 365 days for that product. | Should |
| F04-R10 | The trade request and the resulting offer both record the indication that was current at the moment of request, for later comparison. | Must |
| F04-R11 | An employee can add, edit, deactivate and reorder products and their ticker mapping without a deployment. | Must |
| F04-R12 | Feed health (last successful poll, error count, stale products) is visible on the employee integration dashboard. | Must |
| F04-R13 | Prices can be shown on the consumption chart as a secondary axis. | Could |
| F04-R14 | A customer can set a price alert threshold per product. | Could |

## 5. Business rules

1. **Indications are never binding.** No screen, export or notification may present an indication in
   a way that reads as a quote. Copy is reviewed for this specifically.
2. **Stale is worse than absent.** A number without an age is a number a customer will assume is
   live. Timestamp always visible; staleness always flagged.
3. **Never interpolate or synthesise.** If Montel has no price, the platform has no price.
4. **The indication at request time is captured.** When PeakPower later offers a price, both the
   customer and the trader can see what the market looked like when the request was made. This
   removes an entire category of dispute.
5. **Redistribution limits apply.** Market data is licensed. Whether indications may be shown to
   customers at all, in what granularity, and whether they may be exported, depends on the Montel
   licence — **[OQ-24]**. This is a contractual question with a real chance of constraining the UI.

## 6. Screens

| Screen | Mockup |
| --- | --- |
| Price board | [`price-indications.svg`](../60-mockups/price-indications.svg) |
| Dashboard price strip | [`customer-dashboard.svg`](../60-mockups/customer-dashboard.svg) |

## 7. Data

| Entity | Purpose |
| --- | --- |
| `price_indication_product` | Product definition and Montel ticker mapping |
| `price_indication_observation` | ticker, price, currency, unit, source_ts, received_ts |
| `price_feed_health` | Per-product last success, last error, consecutive failures |

## 8. Edge cases

| Case | Behaviour |
| --- | --- |
| Montel unreachable | Last known values shown with a prominent stale marker and age; alert raised after N consecutive failures |
| Ticker rolls (M+1 becomes a new month) | Relative-offset products resolve dynamically; the board always shows the correct forward period, and the trend chart notes the roll |
| Price returned in a different currency or unit | Rejected and logged; never silently converted |
| Negative price | Displayed as-is. Negative wholesale prices are real and must not be filtered |
| Market closed | Last close shown, labelled as such rather than as stale |
| A product is deactivated while a trend chart is open | Chart still renders history; the tile disappears from the board |

## 9. Out of scope

- Order-book depth, bid/ask, volumes.
- Own price curve construction or forward-curve modelling.
- Gas price indications ([OQ-01]).
- Automated hedging advice or recommendations — this is regulated territory.

## 10. Dependencies

| Depends on | Why |
| --- | --- |
| [Montel integration](../30-integrations/02-montel-api.md) | The feed and the existing implementation |
| [F05](F05-energy-block-trading.md) | Where the customer goes next |

## 11. Open questions

| Ref | Question |
| --- | --- |
| [OQ-23] | Which exact Montel tickers map to the six product cells? |
| [OQ-24] | What does the Montel licence permit regarding onward display and export to customers? |
| [OQ-25] | Should indications include a PeakPower spread, or be shown as raw market prices? |
