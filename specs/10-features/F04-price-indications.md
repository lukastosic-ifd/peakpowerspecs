# F04 — Price Indications (Montel)

**Portal:** customer · **Priority:** Must · **Phase:** 2 · **Size:** M

⚠ **Size after 2026-08-19: still M, because the round removed as much as it added.** Out go the trend
chart, its range selector and its series endpoint **[DEC-81]**; in come effective-dated markup
reference data, its maintenance screen and its capture on every trade request **[DEC-80]**. Two things
stop the estimate being firm in either direction: the reuse saving from Luka's Montel service is
unquantified until the service is read **[DEC-96]**, and the board cannot be built to completion at
all until the ticker symbols arrive **[OQ-23]**. Side effect worth naming: the charting-library
question **[DEC-79]** loses its F04 driver entirely — it is now [F03](F03-consumption-visualisation.md)'s
alone.

---

## 1. Summary

Customers need a sense of where the market is before they ask for a price. The platform pulls
wholesale forward prices from Montel — base and peak, for month, quarter and calendar-year delivery
— and shows them as **indications only**.

The word "indication" carries legal weight here. These prices are not quotes, not offers, and not
tradeable. Only PeakPower's response to a trade request is binding. The UI has to make that
distinction unmissable without making the numbers useless.

⚠ **Amended 2026-08-19.** Four things changed, and none of them is cosmetic:

| What | Before | After 2026-08-19 |
| --- | --- | --- |
| The number shown | The Montel quote as received | The quote **plus a configurable percentage markup, default 2%** — **never raw** **[DEC-80]**. The markup is reference data an employee maintains, not a constant in code **[F04-R17]**, **[F04-R18]** |
| Firmness | "Indication — not an offer" as a label | The label stands, and behind it a stated commercial rule: a price the platform gives is **firm only when PeakPower says so** **[DEC-80]**. Presentation requirements in **[F04-R19]** |
| How much of the curve | Current values plus a 30 / 90 / 365-day trend chart | The **current** curve only — **no history, no export, no download, no API** **[DEC-81]**, **[DEC-97]**. This is a licence restriction, not a product choice. **[F04-R09]** and **[F04-R13]** are retired for it |
| Where the feed comes from | The Montel API, through "an existing implementation" of unknown shape | The **existing PeakPower Montel service built by Luka** is integrated first, rather than the Montel API directly **[DEC-96]**. **[OQ-52]** closes; the service's shape and location still have to be read before the estimate is firm |

> **Where they may appear — [DEC-27].** Indications may be shown **inside the authenticated portal**.
> They must **not** be displayed publicly, which withdraws the public teaser in
> [F14-R09](F14-public-website.md). ~~⚠ **Customer export is not covered by that answer.** Export is
> redistribution, so it is treated as **not permitted** until the Montel licence says otherwise
> **[OQ-24]**.~~ ⚠ **Amended 2026-08-19 by [DEC-81]** — the export residual of [OQ-24] is answered,
> and answered the way this paragraph assumed: **there is no export**, in any form, and no history
> either. The provisional reading became the decision. Risk [R-07](../70-delivery/02-risks.md) is
> reduced, not closed: the labelling and stale-data rules below apply regardless, because they are
> about how a number is read, not about who may hold it.

## 2. User stories

| As a… | I want to… | So that… |
| --- | --- | --- |
| Customer user | see current market prices for the products I could buy | I can judge whether now is a reasonable moment |
| ~~Customer user~~ | ~~see how a price has moved recently~~ | ~~I have context for "is this high?"~~ ⚠ **Withdrawn 2026-08-19 by [DEC-81]** — the licence does not allow the platform to hand a customer a price history. The customer keeps the "is this high?" question and loses the platform's answer to it |
| Customer user | understand that these are indications, not offers | I am not surprised when the actual offer differs |
| Customer user | go from a price tile straight into a trade request for that product | the path from interest to request is short |
| Employee | control which tickers map to which product | the customer sees the products we actually trade |
| Employee | change the markup percentage without waiting for a release **[DEC-80]** | the risk premium tracks the market rather than the deployment calendar |
| Employee | see the raw quote next to the marked-up price the customer sees **[F04-R21]** | I can answer "why is your price higher than the exchange?" and spot a wrong markup |
| Employee | see when the price feed is stale | I know the customer is looking at old numbers |

## 3. Product / ticker matrix

The customer-facing dimension is **shape × delivery period**:

| | Month-ahead | Quarter-ahead | Calendar-year-ahead |
| --- | --- | --- | --- |
| **Base** | `NL Base M+1` | `NL Base Q+1` | `NL Base Cal+1` |
| **Peak** | `NL Peak M+1` | `NL Peak Q+1` | `NL Peak Cal+1` |

⚠ **The matrix cannot be completed, and [OQ-23] closes only in part (⏸).** The **Montel ticker symbols
for the six products were never supplied** in the 2026-08-19 round. [DEC-80] settles what is done *to*
the price; it says nothing about which symbol each cell reads. Until the symbols arrive:

- the six names in the table above are **placeholders written for this document — they are not Montel
  symbols** and must not be copied into configuration;
- `montel_ticker` has no value for any row, so the poller **[F04-R01]** has nothing to call and the
  price board has nothing to render;
- the missing symbols are the single blocking dependency on this feature. Everything else in F04 —
  the markup, the staleness rules, the labelling, the reference-data screens — can be built and
  tested against a stub, and none of it can go live.

⚠ **Electricity only.** No gas row exists in this matrix and none is added: gas is out of scope
**[DEC-68]**, which withdraws **[DEC-30]**. The `commodity` discriminator below stays on the product
row **[DEC-15]** because it is nearly free now and expensive to retrofit, but while [DEC-68] stands it
only ever holds `ELECTRICITY`.

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
the live feed — see **[OQ-23]**. ⚠ **Amended 2026-08-19 by [DEC-96]** — "the existing Montel
implementation" now has a name: the **Montel service Luka built** inside PeakPower. The symbols are
read from it rather than from the Montel API, which is one fewer contract to negotiate and one more
piece of code to read first. Showing the *front two* periods per cell (M+1 and M+2, Q+1 and Q+2,
Cal+1 and Cal+2) is the recommended default; more than that is noise for this audience.

### 3.1 The markup — reference data, not a constant **[DEC-80]**

The customer never sees the quote. The customer sees the quote **plus a percentage**, and the
percentage is maintained like a tariff:

```
price_indication_markup
  ├─ id
  ├─ percentage          decimal(5,2)   default 2.00   -- 2% → displayed = quote × 1.02
  ├─ valid_from          timestamptz
  ├─ valid_to            timestamptz NULL              -- NULL = currently in force
  ├─ changed_by          employee account [DEC-17]
  ├─ changed_at
  └─ note                                              -- why it moved
```

One platform-wide value, keyed by validity period only. **[DEC-80]** asks for "a configurable
percentage, default 2%" and names no per-product, per-customer, per-shape or per-period
differentiation, so none is built — a second dimension is cheap to add to a one-row table later and
expensive to remove once quotes have been captured against it **[F04-R10]**.

**Worked example.** Montel returns 76,91 €/MWh for `NL Base M+1`; the markup in force is 2,00%.

| Step | Value | Where it lives |
| --- | --- | --- |
| Raw quote from the Montel service | 76,9100 €/MWh | `price_indication_observation.price` — stored, never rendered to a customer **[F04-R01]** |
| Markup in force | 2,00% | `price_indication_markup.percentage` **[F04-R18]** |
| Marked-up price | 76,9100 × 1,02 = **78,4482** €/MWh | computed; captured at 4 decimals on a trade request **[F04-R10]**, matching the offer precision of **[F05-R17]** |
| Shown on the tile | **€ 78,45** /MWh | rounded to 2 decimals for display **[F04-R17]** |

The 2% is not a display flourish. Since **[DEC-73]** took surcharges and topups out of the platform,
the **spread inside the price PeakPower quotes** is the only margin instrument left; the markup is
that spread shown on the board ahead of the offer, so that the indication and the eventual offer
**[F05-R17]** are read on the same basis rather than differing by an unexplained 2%. That makes it a
commercial control, which is why an employee changes it without a release **[F04-R18]** and why every
change is audited **[F12-R24]**.

## 4. Functional requirements

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F04-R01 | The platform polls Montel on a schedule and stores each observation with its ticker, price, currency, unit and source timestamp. ⚠ **Amended 2026-08-19 by [DEC-96]** — the poll goes through the **existing PeakPower Montel service**, not the Montel API directly. The stored price is the **raw quote as received**; the markup **[F04-R17]** is applied on the way out, never on the way in, so a markup change never rewrites what Montel actually said. | Must |
| F04-R02 | Poll frequency is configurable per product, defaulting to every 5 minutes during market hours and hourly outside them. | Must |
| F04-R03 | Observations are stored as an append-only series; the latest is the current indication. ~~History is retained for the trend view.~~ ⚠ **Amended 2026-08-19 by [DEC-81]** — the series is still stored, because **[F04-R10]** captures a point in it and **[F04-R06]** needs an age, but it is **internal**. No customer surface reads more than the latest observation per product **[F04-R20]**. The trend view it was retained for is retired. | Must |
| F04-R04 | The customer portal shows a price board: one tile per active product with price, unit (€/MWh), ~~change vs. previous close,~~ and the observation timestamp. ⚠ **Amended 2026-08-19 by [DEC-81]** — the **change vs. previous close is removed**. A price and a delta are two prices: the reader recovers the earlier close by subtraction, which is exactly the history [DEC-81] withholds. The price on the tile is the marked-up price **[F04-R17]**. | Must |
| F04-R05 | Every tile and every price carries an explicit **"Indication — not an offer"** label. A tooltip explains that a firm price is only given in response to a trade request. ⚠ **Extended 2026-08-19 by [DEC-80]** — the number on the tile is a **PeakPower indication**, not a market price, and the copy must say so: no screen calls it "the market price", "the Montel price" or "the exchange price", because it is a Montel quote plus PeakPower's markup **[F04-R17]**. Whether the *existence* of the markup is spelled out in words is a commercial copy choice [DEC-80] does not settle; it goes through the copy review in business rule 1. The markup **percentage** is never shown to a customer **[F04-R17]**; employees see it **[F04-R21]**. | Must |
| F04-R06 | If the newest observation for a product is older than a configurable staleness threshold (default 30 min during market hours), the tile is visibly marked stale with its age. | Must |
| F04-R07 | If no observation exists at all, the tile shows "unavailable" rather than a blank or a zero. | Must |
| F04-R08 | A tile links into the trade wizard with shape and delivery period pre-filled. | Must |
| ~~F04-R09~~ | ~~A tile expands into a trend chart of the last 30 / 90 / 365 days for that product.~~ **Retired 2026-08-19 by [DEC-81]** — customers see the current curve only; there is no history surface and nothing replaces it. The chart component, the range selector and the series endpoint are not built. | ~~Should~~ |
| F04-R10 | The trade request and the resulting offer both record the indication that was current at the moment of request, for later comparison. ⚠ **Amended 2026-08-19 by [DEC-80]** — what is recorded is now **three values, not one**: the raw quote, the **markup percentage in force**, and the marked-up price at 4 decimals. Without the percentage a captured indication cannot be reproduced after the markup moves, and the dispute this requirement exists to prevent comes back. | Must |
| F04-R11 | An employee can add, edit, deactivate and reorder products and their ticker mapping without a deployment. | Must |
| F04-R12 | Feed health (last successful poll, error count, stale products) is visible on the employee integration dashboard. | Must |
| ~~F04-R13~~ | ~~Prices can be shown on the consumption chart as a secondary axis.~~ **Retired 2026-08-19 by [DEC-81]** — a price series drawn along a consumption chart is a price history, whatever it is called. Nothing replaces it; the consumption chart **[F03](F03-consumption-visualisation.md)** carries volume only. | ~~Could~~ |
| F04-R14 | A customer can set a price alert threshold per product. ⚠ **Amended 2026-08-19 by [DEC-81]** and **[DEC-27]** — the notification may say that a threshold was crossed and link into the portal; it may **not** carry the price itself, because email is not an authenticated portal surface **[F04-R15]** and a stream of threshold-crossing prices is a history assembled by the recipient. Stays **Could**. | Could |
| F04-R15 | Indications are rendered on **authenticated portal surfaces only**. No unauthenticated page, feed or share link carries a Montel-derived indication **[DEC-27]**. ⚠ **Confirmed 2026-08-19 by [DEC-81]**, which narrows the permitted surface further rather than widening it. | Must |
| F04-R16 | Customer **export** of Montel-derived indications is not offered. ~~Export is redistribution and the licence has not been confirmed to permit it **[DEC-27]**, **[OQ-24]**; the chart export in **[F03-R23]** therefore excludes any indication series. Reopen when the licence is read.~~ ⚠ **Amended 2026-08-19 by [DEC-81]** — this is no longer provisional and does not reopen. There is **no export in any form**: no CSV, no PNG carrying a price series, no download, and **no API** — the customer usage API **[DEC-97]** carries net usage and nothing priced. The exclusion of indication series from the chart export **[F03-R23]** is permanent. | Must |
| F04-R17 | Every customer-facing indication is the raw Montel quote **× (1 + markup)**, using the markup in force at render time **[F04-R18]**. The result is stored and captured at **4 decimals** **[F04-R10]** and displayed rounded to **2 decimals** €/MWh. The **raw quote is never rendered on a customer surface**, and neither is the markup percentage — price and percentage together disclose the raw quote by division, which puts the Montel number back on the customer's screen **[DEC-80]**, **[DEC-27]**. | Must |
| F04-R18 | The markup is **reference data**: one platform-wide percentage, default **2%**, effective-dated, which an employee changes **without a release** — the screen belongs beside the ticker mapping **[F12-R22]** and the change is audited before/after **[F12-R24]**, **[DEC-17]**. A new value applies to indications rendered after it takes effect; indications already captured against a trade request keep the percentage that was in force **[F04-R10]**. The value must be **greater than zero** — a 0% markup would render the raw quote, which **[DEC-80]** forbids — and [DEC-80] names no upper bound, so none is enforced. | Must |
| F04-R19 | Indicative-versus-firm status is **explicit on every customer-facing price**, and the two are structurally different objects, not two labels. An indication has no expiry, no accept action and no reference; a firm price exists only as a published offer with a price, a countdown and an accept action **[F05-R19]**. The price board may not use the words *offer*, *quote*, *valid until* or *bid/ask* — this document uses "quote" for the Montel number, which is internal vocabulary and must not reach customer copy. A price is firm **only when PeakPower says so** **[DEC-80]**. | Must |
| F04-R20 | Customer surfaces expose the **current** value per product and nothing else: no series, no earlier observation, no open/close/high/low, no delta, and no value from which an earlier price can be derived. This applies to screens, tooltips, notifications and any payload **[DEC-81]**, **[DEC-97]**. | Must |
| F04-R21 | Employee surfaces show, per product, the **raw quote**, the **markup percentage in force** and the resulting customer-visible price side by side, with the timestamp of each. This is the only place the raw number is rendered, and it is what makes "why is your price above the exchange?" and a mistyped markup diagnosable. | Should |

## 5. Business rules

1. **Indications are never binding.** No screen, export or notification may present an indication in
   a way that reads as a quote. Copy is reviewed for this specifically. ⚠ **Extended 2026-08-19 by
   [DEC-80]** — the rule now has a source sentence behind it: *bids the platform gives are always
   bids, and firm only if we say so.* "We say so" has exactly one form in this platform, a published
   offer **[F05-R19]** with a price and a running clock. Everything else is indicative by
   construction **[F04-R19]**.
2. **Stale is worse than absent.** A number without an age is a number a customer will assume is
   live. Timestamp always visible; staleness always flagged.
3. **Never interpolate or synthesise.** If Montel has no price, the platform has no price.
4. **The indication at request time is captured.** When PeakPower later offers a price, both the
   customer and the trader can see what the market looked like when the request was made. This
   removes an entire category of dispute.
5. **Redistribution limits apply.** Market data is licensed. **[DEC-27]** settles the display
   question — authenticated portal yes, public no — ~~and leaves granularity and **export**
   unanswered. Anything not explicitly permitted is treated as not permitted **[OQ-24]**.~~
   ⚠ **Amended 2026-08-19 by [DEC-81]** — granularity and export are answered: **the current curve
   only, and no export at all**. The precautionary reading was right, so nothing built on it has to
   be undone. The rule itself stands unchanged for anything still unwritten: not explicitly
   permitted means not permitted.
6. **The customer never sees a raw Montel number.** Every price on a customer surface is the quote
   plus the markup **[F04-R17]**, and the two inputs are withheld individually because either one
   plus the displayed price recovers the other by arithmetic. This is one rule serving two masters:
   the licence **[DEC-27]** wants the Montel number off the screen, and **[DEC-80]** wants the
   margin off it.
7. **The markup is a commercial control, so it is versioned, not overwritten.** An employee changes
   it without a release **[F04-R18]**; the platform keeps the old value with its validity period,
   because a captured indication **[F04-R10]** that cannot be reproduced is worse than no capture at
   all. ⚠ **Which side of the market is marked up is not settled.** OQ-25's comment says *bid* plus a
   percentage; OQ-23's answer says *ask* price plus 2%. The comment governs under this set's column
   rule, so **bid** is what is written here — but bid and ask are not the same number, so the
   difference is real money, and the wording is carried on **[OQ-23]** to be confirmed together with
   the ticker symbols. Do not treat "bid" as settled while [OQ-23] is ⏸.

## 6. Screens

| Screen | Mockup |
| --- | --- |
| Price board | [`price-indications.svg`](../60-mockups/price-indications.svg) |
| Dashboard price strip | [`customer-dashboard.svg`](../60-mockups/customer-dashboard.svg) |

⚠ **The price-board mockup predates 2026-08-19 and now contradicts the requirements above in two
places.** It is generated from
[`screens-customer.mjs`](../60-mockups/screens-customer.mjs) (`priceIndications()`) and is not edited
by hand, so the fix is a regeneration, not a redraw:

| In the mockup | Why it is now wrong | What it should show |
| --- | --- | --- |
| A *"Base — next month · 90-day trend"* panel under the tiles | **[DEC-81]** — no history surface exists; **[F04-R09]** is retired | The panel is removed. The board is tiles only |
| A change figure on each tile (`+1,25`, `−0,45`, …) | **[DEC-81]** via **[F04-R04]** — price plus delta discloses the previous close | Price, unit and observation time; no delta |
| Tile price `€ 78,45` | Correct as drawn, and now for a different reason | It is the **marked-up** price: 76,9100 × 1,02 = 78,4482 → **78,45** **[F04-R17]**. The raw 76,91 belongs only on the employee view **[F04-R21]** |

The banner it already carries — *"These are indicative market prices, not offers. A firm, time-limited
price is issued only in response to a trade request"* — is what **[F04-R19]** asks for, with one word
to change: they are **PeakPower indications**, not *market prices* **[F04-R05]**.

## 7. Data

| Entity | Purpose |
| --- | --- |
| `price_indication_product` | Product definition and Montel ticker mapping. `montel_ticker` is empty for all six rows until **[OQ-23]** delivers the symbols |
| `price_indication_observation` | ticker, price, currency, unit, source_ts, received_ts. The `price` is the **raw quote**, stored exactly as the Montel service returned it **[F04-R01]** — the markup is never baked into it |
| `price_indication_markup` | **New 2026-08-19 [DEC-80]** — percentage (default 2.00), valid_from, valid_to, changed_by, changed_at, note. Effective-dated so a captured indication stays reproducible **[F04-R10]** |
| `price_feed_health` | Per-product last success, last error, consecutive failures |

**Retention.** The observation series is append-only and kept for internal use — capture
**[F04-R10]**, staleness **[F04-R06]**, feed health, support. **[DEC-81]** restricts what a *customer*
may read, not what the platform may store, so nothing is deleted earlier than before; the difference
is that no customer-facing query may return more than one row per product **[F04-R20]**.

## 8. Edge cases

| Case | Behaviour |
| --- | --- |
| Montel unreachable | Last known values shown with a prominent stale marker and age; alert raised after N consecutive failures. The stale value is still marked up **[F04-R17]** — a stale price is not an excuse to show the raw quote |
| The existing Montel service is unreachable, but Montel is not | Identical handling: **[DEC-96]** makes that service the feed, so its outage is a feed outage. Feed health **[F04-R12]** names the service, not "Montel", or the first incident is diagnosed against the wrong system |
| Ticker rolls (M+1 becomes a new month) | Relative-offset products resolve dynamically; the board always shows the correct forward period. ~~and the trend chart notes the roll~~ ⚠ **Amended 2026-08-19 by [DEC-81]** — there is no trend chart to note it in, and a roll is now invisible to the customer because there is no earlier value on screen to be confused with the new one |
| Price returned in a different currency or unit | Rejected and logged; never silently converted |
| Negative price | Displayed as-is. Negative wholesale prices are real and must not be filtered. ⚠ **A multiplicative markup breaks on a negative quote.** Read literally, **[DEC-80]** gives −4,00 × 1,02 = **−4,08**, which moves the price *in the customer's favour* — the opposite of what a risk markup is for. The alternative reading, quote plus 2% of the absolute value, gives **−3,92**. [DEC-80] does not choose, so the platform implements the literal `× (1 + markup)` of **[F04-R17]** and this row is the record that it is unverified; confirm the sign convention together with the bid-versus-ask wording carried on **[OQ-23]**. Negative *forward* prices are rare enough that this is a correctness note, not a blocker |
| Market closed | Last close shown, labelled as such rather than as stale. It is the current value of the curve, not history: one value per product, which is what **[F04-R20]** permits |
| ~~A product is deactivated while a trend chart is open~~ | ~~Chart still renders history; the tile disappears from the board~~ ⚠ **Withdrawn 2026-08-19 by [DEC-81]** — there is no trend chart. A deactivated product simply disappears from the board on the next render |
| The markup is changed while a trade request is in flight | The request keeps the percentage captured at submission **[F04-R10]**, **[F05-R12]**. The board moves; the captured indication does not |
| No markup row is in force at render time | Treated as a configuration failure, not as 0%: the tile shows "unavailable" **[F04-R07]** rather than the raw quote, because rendering the quote would breach **[DEC-80]** silently. The default of 2% is seeded at install, so this should only occur if a row is closed without a successor |

## 9. Out of scope

- **Public display of indications** — withdrawn by **[DEC-27]**; see [F14-R09](F14-public-website.md).
- **Customer export of indications** — ~~not permitted until the licence says otherwise~~ **out for
  good 2026-08-19 by [DEC-81]**: no CSV, no download, no PNG carrying a price series and **no API**
  **[DEC-97]**. **[F04-R16]**.
- **Price history in any customer-facing form** — **new out 2026-08-19 by [DEC-81]**: no trend chart
  (**[F04-R09]** retired), no price series on the consumption chart (**[F04-R13]** retired), no
  change-vs-close on a tile (**[F04-R04]** amended). Licence-driven.
- Order-book depth, bid/ask, volumes.
- Own price curve construction or forward-curve modelling.
- ~~Gas price indications ([OQ-01]).~~ **Gas entirely — [DEC-68]**, which withdraws **[DEC-30]**. No
  gas product row, no gas ticker, no m³ unit. The `commodity` field stays **[DEC-15]**; it holds
  `ELECTRICITY` and nothing else while [DEC-68] stands.
- Automated hedging advice or recommendations — this is regulated territory.

## 10. Dependencies

| Depends on | Why |
| --- | --- |
| [Montel integration](../30-integrations/02-montel-api.md) | The feed. ⚠ **Amended 2026-08-19 by [DEC-96]** — the dependency is on the **existing PeakPower Montel service built by Luka**, integrated first rather than the Montel API directly. **[OQ-52]** closes on the question of whether such a thing exists; what it does not close is the **estimate** — the service's shape, location and coverage of the six forward products have to be read before the size of this feature is firm. If it turns out to serve day-ahead only, F04 is back to a direct integration with the API |
| **[OQ-23]** — the six ticker symbols | Blocking. Nothing on the board can be polled without them (§3) |
| [F12-R22], [F12-R24] | The employee screens: ticker mapping, and the **markup** **[F04-R18]** with its audit trail |
| [F05](F05-energy-block-trading.md) | Where the customer goes next, and the only place a **firm** price exists **[F05-R19]** |

## 11. Open questions

Post-2026-08-19 state. One question is open on this feature, and it blocks the board.

| Ref | Status | Question |
| --- | :--: | --- |
| **[OQ-23]** | ⏸ | **Which exact Montel tickers map to the six product cells?** **CLOSED ONLY IN PART.** **[DEC-80]** settled the markup that OQ-23's answer was carrying; the **ticker symbols themselves were never supplied**, so the half of the question that gives the feature its data is still open (§3). ⚠ It now also carries two wordings to confirm with the symbols: **bid or ask** — OQ-25's comment says *bid* + a percentage, OQ-23's answer says *ask* + 2%, and the comment governs (business rule 7) — and the **sign convention** for a negative quote (§8). 🟠, Trading |
| ~~[OQ-24]~~ | ✅ | ~~**Partly closed by [DEC-27]**: authenticated display is permitted, public display is not. Still open — does the licence permit customer **export**, and at what granularity?~~ **CLOSED — no export, and current granularity only** **[DEC-81]**. Both halves are answered, and answered as F04 had provisionally assumed, so nothing built on the precautionary reading is undone **[F04-R16]**, **[F04-R20]**. ⚠ The master ledger's summary lists OQ-24 in neither its closed nor its remaining-open set; the register row for it has been ✅ since **[DEC-27]** and [DEC-81] settles its export residual, so it is recorded closed here |
| ~~[OQ-25]~~ | ✅ | ~~Should indications include a PeakPower spread, or be shown as raw market prices?~~ **CLOSED — never raw** **[DEC-80]**: a quote plus a **configurable percentage markup, default 2%**, held as reference data an employee maintains **[F04-R17]**, **[F04-R18]**. The residual — which side of the market is marked up — moved to **[OQ-23]**, not into a new question |
| ~~[OQ-52]~~ | ✅ | ~~Where does the existing Montel implementation live, and in what shape?~~ **CLOSED — it exists: a Montel service built by Luka, integrated before the Montel API** **[DEC-96]**. Listed here because it is F04's implementation route, not only an architecture question. ⚠ "It exists" is not "it fits": the estimate stays soft until the service is read (§10) |
