# F08 — Day-Ahead Prices

**Portal:** platform · **Priority:** Must · **Phase:** 3 · **Size:** S

---

## 1. Summary

Volume not covered by a block settles at the day-ahead price. The platform pulls the Dutch day-ahead
curve from Montel **once daily, from 18:00 Amsterdam time** **[DEC-36]**, and stores it per market
time unit, so that
[Position & coverage](../50-calculations/02-position-and-coverage.md) and
[Invoicing](../50-calculations/03-invoice-calculation.md) have a price for every interval.

The curve is **two-sided, and the sell side is now narrower**. Uncovered volume is bought at it, and
**unused block cover is credited at it** **[DEC-23]**. **[DEC-44]** takes the other half of the old
sell side away: **physically exported volume — the negative net usage [DEC-22] introduces — no longer
settles at day-ahead at all.** It settles at a per-customer **feed-in tariff** as invoice line 6. Read
[Invoice calculation §7A](../50-calculations/03-invoice-calculation.md) for the arithmetic and the
volume identity rather than inferring it from here; that section is authoritative and was written
against the decision.

**The price is raw. [DEC-44] closes [OQ-35]:** day-ahead settlement uses the market price with **no
configured spread**, on the purchase leg and the sale leg alike **[F08-R12]**.

Small feature, high consequence: a missing or wrong day-ahead price silently corrupts every invoice
for that day — now on both sides of it.

## 2. Functional requirements

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F08-R01 | The platform retrieves the NL day-ahead curve for delivery day D on **D−1 at 18:00 Europe/Amsterdam**, the time the curve arrives **[DEC-36]** — a **single scheduled fetch plus retry**, not the previous four attempts at 13:00 / 14:00 / 15:00 / 18:00. The fetch time and the retry policy are configuration, not constants, so a change in publication time is a setting rather than a release. Retries continue until the day is complete **[F08-R06]** or the cut-off is reached **[F08-R07]**. | Must |
| F08-R02 | Each price is stored with an explicit **validity interval** (`valid_from`, `valid_to`, `timestamptz`), price, currency and unit — never with an implicit "hour index". | Must |
| F08-R03 | `dayAheadPrice(i)` resolves by finding the price whose validity interval contains interval `i`. Hourly and 15-minute source resolutions therefore both work with no special case — which is still needed, because **[DEC-36]** answers *when* the curve arrives and **not** at what resolution **[OQ-16]**. | Must |
| F08-R04 | Prices are versioned: a corrected publication creates a new version, and the newest is authoritative. Superseded versions are retained. | Must |
| F08-R05 | Negative prices are stored and used as-is. | Must |
| F08-R06 | A completeness check runs after each retrieval and verifies full coverage of the delivery day, expecting 92 / 96 / 100 intervals as appropriate for DST. | Must |
| F08-R07 | Missing prices raise an alert and **block** invoicing for the affected days with a specific reason. No substitution, no interpolation, no carry-forward. A missing price blocks a **credit** exactly as it blocks a charge **[DEC-23]**. | Must |
| F08-R08 | Day-ahead prices are exposed to the customer portal for chart tooltips and the exposure KPI, on both sides — cost of uncovered volume and credit for **unused block cover** **[DEC-22]**, **[DEC-23]**, **[DEC-44]**. Exported volume is shown at the feed-in tariff instead, and the two must not be labelled alike. | Must |
| F08-R09 | An employee can see day-ahead coverage per day and manually trigger a retrieval. | Should |
| F08-R10 | An employee can enter a price manually as a last resort, flagged as manual with a mandatory reason, and surfaced on any invoice that uses it. | Should |
| F08-R11 | The day-ahead curve can be shown as a line on the consumption chart. | Could |
| F08-R12 | Settlement uses the **raw** day-ahead price. There is **no configured spread**, on either leg **[DEC-44]**, and no spread field exists to be populated by accident. | Must |
| F08-R13 | The day-ahead price applies to **two volumes only**: the uncovered purchase leg and the unused-block-cover sale leg. **Physically exported volume is not settled at day-ahead** **[DEC-44]** — it goes to the feed-in tariff on invoice line 6, specified in [Invoice calculation §7A](../50-calculations/03-invoice-calculation.md). A missing feed-in tariff is that section's failure mode, not this one's; a missing day-ahead price still blocks invoicing **[F08-R07]**. | Must |

## 3. Business rules

1. **A price has a validity interval, not an index.** Hour numbering breaks on DST days; validity
   intervals do not. This one decision removes a whole class of twice-a-year bugs.
2. **No price, no invoice.** Blocking is correct behaviour. A guessed price becomes a real charge —
   or, since **[DEC-23]**, a real credit — on a real customer.
3. **Manual prices are visible.** If a human entered a price, every artefact derived from it says so.
4. **Corrections version, they don't overwrite** — the same rule as metering data **[DEC-07]**.
5. **The auction is daily and the data must be there before the month closes**, so the monitoring
   window is generous but the alert is loud.
6. **The stored price is the settled price** **[DEC-44]**. No spread is applied on the way in or on the
   way out, so what the invoice charges is what Montel published — which is also what makes a
   customer's own check against a public curve come out right.
7. **One arrival time, not four** **[DEC-36]**. The curve arrives at 18:00 Amsterdam. Retrying a known
   time is monitoring; polling four speculative times was a workaround for not knowing it.

## 4. Data

| Entity | Purpose |
| --- | --- |
| `day_ahead_price` | market_area, valid_from, valid_to, price, currency, unit, version, source, is_manual |
| `day_ahead_coverage` | Per delivery day: expected intervals, covered intervals, state |

## 5. Edge cases

| Case | Behaviour |
| --- | --- |
| DST spring day | 23 hours / 92 intervals expected; a 24-hour curve fails the completeness check |
| DST autumn day | 25 hours / 100 intervals expected; the duplicated hour must have two distinct validity intervals |
| Auction delayed | The 18:00 fetch **[DEC-36]** finds nothing and the retry schedule continues; alert after the configured cut-off. This is the case the four-attempt schedule used to absorb silently, and it is better as an alert than as a poll |
| Curve arrives earlier than 18:00 | Harmless — the scheduled fetch simply finds it. Nothing is fetched before 18:00, so an early curve is retrieved late rather than missed |
| Price published then corrected | New version supersedes; any affected finalised invoice is flagged for true-up, like a metering correction |
| Negative prices across a whole day | Normal. **Unused block cover** then costs the customer money to sell — the invoice must present that clearly rather than hiding it in a net figure **[DEC-23]**. ⚠ Since **[DEC-44]** the sunny-day solar case is **no longer** this row's: physically exported volume settles at the feed-in tariff, which is a per-customer rate and is not negative unless someone configures it so. Negative day-ahead now bites on cover, not on export |
| Montel returns a different market area | Rejected and logged; never stored under the wrong area |

## 6. Dependencies

| Depends on | Why |
| --- | --- |
| [Montel integration](../30-integrations/02-montel-api.md) | The source, and the 18:00 schedule **[DEC-36]** |
| [F10](F10-invoicing-and-settlement.md) | The main consumer |
| [F03](F03-consumption-visualisation.md) | Tooltips and exposure KPI |
| [Invoice calculation §7A](../50-calculations/03-invoice-calculation.md) | Where exported volume goes instead — the feed-in tariff, line 6 **[DEC-44]** |

## 7. Open questions

| Ref | Question |
| --- | --- |
| [OQ-16] | **Partly closed by [DEC-36]** — the curve arrives at **18:00 Amsterdam**, which settles the schedule **[F08-R01]**. ⚠ **Still open, and both halves matter:** **(a)** what **resolution** Montel delivers, hourly or 15-minute — handled by design **[F08-R03]** but unconfirmed, and it decides how many rows a day carries and how the completeness check counts them; **(b)** whether **history is available for backfill**, because backfill depth limits how far back positions can be settled. A period with no day-ahead history cannot be invoiced at all **[F08-R07]** |
| ~~[OQ-35]~~ | ~~Is the raw day-ahead price used, or a price plus a configured spread?~~ **Closed by [DEC-44]** — the **raw** price, no spread, on both legs **[F08-R12]**. The same decision removes exported volume from day-ahead settlement entirely **[F08-R13]**; it settles at the feed-in tariff on invoice line 6 |
