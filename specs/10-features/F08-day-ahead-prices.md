# F08 — Day-Ahead Prices

**Portal:** platform · **Priority:** Must · **Phase:** 3 · **Size:** S

---

## 1. Summary

Volume not covered by a block settles at the day-ahead price. The platform pulls the Dutch day-ahead
curve from Montel after each daily auction and stores it per market time unit, so that
[Position & coverage](../50-calculations/02-position-and-coverage.md) and
[Invoicing](../50-calculations/03-invoice-calculation.md) have a price for every interval.

Small feature, high consequence: a missing or wrong day-ahead price silently corrupts every invoice
for that day.

## 2. Functional requirements

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F08-R01 | The platform retrieves the NL day-ahead curve for delivery day D shortly after publication on D−1, on a schedule with retries. | Must |
| F08-R02 | Each price is stored with an explicit **validity interval** (`valid_from`, `valid_to`, `timestamptz`), price, currency and unit — never with an implicit "hour index". | Must |
| F08-R03 | `dayAheadPrice(i)` resolves by finding the price whose validity interval contains interval `i`. Hourly and 15-minute source resolutions therefore both work with no special case **[OQ-16]**. | Must |
| F08-R04 | Prices are versioned: a corrected publication creates a new version, and the newest is authoritative. Superseded versions are retained. | Must |
| F08-R05 | Negative prices are stored and used as-is. | Must |
| F08-R06 | A completeness check runs after each retrieval and verifies full coverage of the delivery day, expecting 92 / 96 / 100 intervals as appropriate for DST. | Must |
| F08-R07 | Missing prices raise an alert and **block** invoicing for the affected days with a specific reason. No substitution, no interpolation, no carry-forward. | Must |
| F08-R08 | Day-ahead prices are exposed to the customer portal for chart tooltips and the exposure KPI. | Must |
| F08-R09 | An employee can see day-ahead coverage per day and manually trigger a retrieval. | Should |
| F08-R10 | An employee can enter a price manually as a last resort, flagged as manual with a mandatory reason, and surfaced on any invoice that uses it. | Should |
| F08-R11 | The day-ahead curve can be shown as a line on the consumption chart. | Could |

## 3. Business rules

1. **A price has a validity interval, not an index.** Hour numbering breaks on DST days; validity
   intervals do not. This one decision removes a whole class of twice-a-year bugs.
2. **No price, no invoice.** Blocking is correct behaviour. A guessed price becomes a real charge on
   a real customer.
3. **Manual prices are visible.** If a human entered a price, every artefact derived from it says so.
4. **Corrections version, they don't overwrite** — the same rule as metering data **[DEC-07]**.
5. **The auction is daily and the data must be there before the month closes**, so the monitoring
   window is generous but the alert is loud.

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
| Auction delayed | Retry schedule continues; alert after the configured cut-off |
| Price published then corrected | New version supersedes; any affected finalised invoice is flagged for true-up, like a metering correction |
| Negative prices across a whole day | Normal. Surplus volume then costs the customer money to sell — the invoice must present that clearly rather than hiding it in a net figure |
| Montel returns a different market area | Rejected and logged; never stored under the wrong area |

## 6. Dependencies

| Depends on | Why |
| --- | --- |
| [Montel integration](../30-integrations/02-montel-api.md) | The source |
| [F10](F10-invoicing-and-settlement.md) | The main consumer |
| [F03](F03-consumption-visualisation.md) | Tooltips and exposure KPI |

## 7. Open questions

| Ref | Question |
| --- | --- |
| [OQ-16] | What resolution does Montel deliver for the NL day-ahead curve, and is history available for backfill? |
| [OQ-35] | Is the raw day-ahead price used, or a price plus a configured spread? |
