# F08 — Day-Ahead Prices

**Portal:** platform · **Priority:** Must · **Phase:** 3 · **Size:** S

---

## 1. Summary

Volume not covered by a block settles at the day-ahead price. The platform pulls the Dutch day-ahead
curve from Montel **once daily, from 18:00 Amsterdam time** **[DEC-36]**, through the **Montel service
Luka has already built** **[DEC-96]**, and stores it per market
time unit, so that
[Position & coverage](../50-calculations/02-position-and-coverage.md) and
[Invoicing](../50-calculations/03-invoice-calculation.md) have a price for every interval.

**Montel's day-ahead history is available for backfill** **[DEC-75]**. The curve is therefore not only
forward-looking: historical delivery days can be loaded to whatever depth the licence allows, so a
position can be settled retrospectively and **there is no backfill cliff** below which a period simply
cannot be invoiced **[F08-R15]**.

The curve is **two-sided, and since [DEC-87] the sell side is wide again**. It prices **three**
volumes, not two, all at the same raw price for the same interval:

| # | Volume | Side | Price | Decision |
| :--: | --- | --- | --- | --- |
| 1 | Uncovered volume — `uncovered(i,m)`, net import not covered by a block | purchase (charge) | day-ahead, raw | **[DEC-22]**, **[DEC-44]** |
| 2 | Unused block cover — `unusedCover(i,m)`, bought volume the customer did not consume | sale (credit) | day-ahead, raw | **[DEC-23]** |
| 3 | Physically exported volume — `exported(i,m) = max(−U, 0)` | sale (credit) | day-ahead, raw | **[DEC-87]** |

The three are **never netted against one another** — three volumes, three lines — but they now carry
**one price**, not two. Which invoice line each one lands on is
[Invoice calculation](../50-calculations/03-invoice-calculation.md)'s business; F08's only obligation
is that all three get the **same raw price for the same interval** **[F08-R14]**.

⚠ **Reversed 2026-08-19 by [DEC-87]**, original kept readable: ~~The curve is **two-sided, and the sell
side is now narrower**. Uncovered volume is bought at it, and **unused block cover is credited at it**
**[DEC-23]**. **[DEC-44]** takes the other half of the old sell side away: **physically exported
volume — the negative net usage [DEC-22] introduces — no longer settles at day-ahead at all.** It
settles at a per-customer **feed-in tariff** as invoice line 6. Read [Invoice calculation
§7A](../50-calculations/03-invoice-calculation.md) for the arithmetic and the volume identity rather
than inferring it from here; that section is authoritative and was written against the decision.~~
The feed-in tariff is withdrawn with its line category, its per-customer reference table and its
`MISSING_FEED_IN_TARIFF` failure mode;
[Invoice calculation §7A](../50-calculations/03-invoice-calculation.md) is where that withdrawal is
worked through. **[OQ-86] closes with it** — there is no tariff left to fail to resolve, so the
€662,53 fallback question disappears rather than being answered.

**The price is raw.** **[DEC-44]**'s first half is **confirmed 2026-08-19** (OQ-35's comment: *"Day
ahead price is raw"*): day-ahead settlement uses the market price with **no configured spread**, on the
purchase leg and on **both** credit legs alike **[F08-R12]**.

⚠ **A second price now exists beside it, and the two must not meet.** **[DEC-80]** shows customers a
**quote plus a configurable percentage** — reference data, default 2% — as a price *indication* in
[F04](F04-price-indications.md). That markup is **customer-facing only and must never reach
settlement** **[F08-R17]**. Before this round the platform had exactly one price concept and the rule
was self-enforcing; now it has two, and the boundary is the one thing in this feature a careless
refactor can cross without anything failing loudly.

Small feature, high consequence: a missing or wrong day-ahead price silently corrupts every invoice
for that day — now on all **three** of its volumes. And since **[DEC-99]** a correction can re-open a
month finalised long ago, so the stored curve has to stay correct and complete for **history**, not
just for the current month **[F08-R16]**.

## 2. Functional requirements

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F08-R01 | The platform retrieves the NL day-ahead curve for delivery day D on **D−1 at 18:00 Europe/Amsterdam**, the time the curve arrives **[DEC-36]** — a **single scheduled fetch plus retry**, not the previous four attempts at 13:00 / 14:00 / 15:00 / 18:00. The fetch time and the retry policy are configuration, not constants, so a change in publication time is a setting rather than a release. Retries continue until the day is complete **[F08-R06]** or the cut-off is reached **[F08-R07]**. | Must |
| F08-R02 | Each price is stored with an explicit **validity interval** (`valid_from`, `valid_to`, `timestamptz`), price, currency and unit — never with an implicit "hour index". | Must |
| F08-R03 | `dayAheadPrice(i)` resolves by finding the price whose validity interval contains interval `i`. Hourly and 15-minute source resolutions therefore both work with no special case — which is still needed, because **[DEC-36]** answers *when* the curve arrives and **[DEC-75]** answers *how far back*, but **neither states the resolution**. ~~**[OQ-16]**~~ is now closed **[DEC-75]**, so the resolution is settled by this design rather than by an answer — and it stays free to be unstated only for as long as this requirement holds. Replace interval lookup with an index and the question returns. | Must |
| F08-R04 | Prices are versioned: a corrected publication creates a new version, and the newest is authoritative. Superseded versions are retained. | Must |
| F08-R05 | Negative prices are stored and used as-is. | Must |
| F08-R06 | A completeness check runs after each retrieval and verifies full coverage of the delivery day, expecting 92 / 96 / 100 intervals as appropriate for DST. | Must |
| F08-R07 | Missing prices raise an alert and **block** invoicing for the affected days with a specific reason. No substitution, no interpolation, no carry-forward. A missing price blocks a **credit** exactly as it blocks a charge **[DEC-23]**. | Must |
| F08-R08 | Day-ahead prices are exposed to the customer portal for chart tooltips and the exposure KPI, on **all three** volumes — cost of uncovered volume, credit for **unused block cover** **[DEC-23]**, credit for **exported volume** **[DEC-87]** — **[DEC-22]**. ⚠ **Amended 2026-08-19 by [DEC-87]**: ~~Exported volume is shown at the feed-in tariff instead, and the two must not be labelled alike.~~ Exported volume is shown at the **day-ahead price** too. The three stay **separately labelled** — the labels distinguish *what* was priced, not *which price* was used — because netting them hides which of the three moved. | Must |
| F08-R09 | An employee can see day-ahead coverage per day and manually trigger a retrieval. | Should |
| F08-R10 | An employee can enter a price manually as a last resort, flagged as manual with a mandatory reason, and surfaced on any invoice that uses it. | Should |
| F08-R11 | The day-ahead curve can be shown as a line on the consumption chart. | Could |
| F08-R12 | Settlement uses the **raw** day-ahead price. There is **no configured spread**, on any leg **[DEC-44]**, and no spread field exists to be populated by accident. **Confirmed 2026-08-19** — **[DEC-87]** reverses only the second half of **[DEC-44]**; this, its first half, stands unchanged and now covers three legs instead of two **[F08-R14]**. | Must |
| ~~F08-R13~~ | ~~The day-ahead price applies to **two volumes only**: the uncovered purchase leg and the unused-block-cover sale leg. **Physically exported volume is not settled at day-ahead** **[DEC-44]** — it goes to the feed-in tariff on invoice line 6, specified in [Invoice calculation §7A](../50-calculations/03-invoice-calculation.md). A missing feed-in tariff is that section's failure mode, not this one's; a missing day-ahead price still blocks invoicing **[F08-R07]**.~~ ⚠ **Reversed 2026-08-19 by [DEC-87]**. Retired, not renumbered and not reused: replaced by **[F08-R14]**, which states the three volumes. The feed-in tariff, its line category and its `MISSING_FEED_IN_TARIFF` failure mode are withdrawn, so the second sentence has nothing left to point at. | ~~Must~~ |
| F08-R14 | The day-ahead price applies to **three volumes**: the uncovered purchase leg, the unused-block-cover sale leg **[DEC-23]**, and **physically exported volume**, credited **raw** **[DEC-87]**. All three resolve through the same `dayAheadPrice(i)` **[F08-R03]** for the interval concerned, so a single stored price serves all three and they can never disagree. A missing price blocks all three **[F08-R07]**. Replaces ~~[F08-R13]~~. | Must |
| F08-R15 | The platform can **backfill historical day-ahead days** from Montel **[DEC-75]**, on demand for a requested date range, using the same storage, versioning **[F08-R04]** and completeness check **[F08-R06]** as the daily fetch. Backfill depth is bounded by the licence, not by the platform: the range is a parameter, and a day the licence does not cover fails as a *refused* request rather than as an empty success. | Must |
| F08-R16 | Backfilled and previously fetched history is **retained and re-readable indefinitely**, because a metering correction can arrive months after a month is finalised and forces those intervals to be **re-settled** at the price that applied then **[DEC-99]**. Re-settlement reads the newest **version** of the price for the interval **[F08-R04]**, never the price of the day the correction arrived. | Must |
| F08-R17 | The **[DEC-80]** indication markup — the configurable percentage, default 2%, added to the customer-facing quote in [F04](F04-price-indications.md) — **must never be applied to a day-ahead price used for settlement**. The two paths share the Montel service **[DEC-96]** and nothing else: the markup is applied at the presentation edge of the price board, and `day_ahead_price` stores only what Montel published **[F08-R12]**. A day-ahead price carrying a markup is a defect, not a configuration. | Must |
| F08-R18 | Retrieval goes through the **existing Montel service built by Luka** **[DEC-96]** rather than a fresh Montel client, behind the `IMarketDataProvider` port described in [Montel integration](../30-integrations/02-montel-api.md) §2. Its shape and location must be read before the estimate for this feature is firm. | Must |

## 3. Business rules

1. **A price has a validity interval, not an index.** Hour numbering breaks on DST days; validity
   intervals do not. This one decision removes a whole class of twice-a-year bugs.
2. **No price, no invoice.** Blocking is correct behaviour. A guessed price becomes a real charge —
   or, since **[DEC-23]** and now **[DEC-87]**, one of **two** kinds of real credit — on a real
   customer.
3. **Manual prices are visible.** If a human entered a price, every artefact derived from it says so.
4. **Corrections version, they don't overwrite** — the same rule as metering data **[DEC-07]**.
5. **The auction is daily and the data must be there before the month closes**, so the monitoring
   window is generous but the alert is loud.
6. **The stored price is the settled price** **[DEC-44]**. No spread is applied on the way in or on the
   way out, so what the invoice charges is what Montel published — which is also what makes a
   customer's own check against a public curve come out right. Since **[DEC-87]** this is also what
   makes the export credit checkable: the customer can verify it against the same public curve.
7. **One arrival time, not four** **[DEC-36]**. The curve arrives at 18:00 Amsterdam. Retrying a known
   time is monitoring; polling four speculative times was a workaround for not knowing it.
8. **One price, three volumes** **[DEC-87]**. Uncovered volume, unused block cover and physical export
   all settle at the day-ahead price of the interval. They stay three separate lines because they are
   three different events, but the *price* question has one answer. What this removes: a second rate
   table, a second resolution order, a second failure mode and a second reason an invoice run could
   stop.
9. **Settlement price and indication price are different objects** **[DEC-44]**, **[DEC-80]**. The
   settlement price is raw and stored; the indication price is a quote plus a configurable percentage
   and is computed for display. The markup never enters `day_ahead_price` and never leaves the price
   board **[F08-R17]**. They coexist deliberately: one prices what happened, the other quotes what
   might.
10. **History is data, not decoration** **[DEC-75]**, **[DEC-99]**. Backfill exists because a
    correction can land months after a month closed and force those intervals to be re-priced. Without
    the history a late correction cannot be settled at all; with it, re-settlement is arithmetic.
11. **Backfill uses the same path as the daily fetch** **[F08-R15]**. Same storage, same versioning,
    same completeness check. A second code path for old days would be a second place for the
    completeness rule to drift.

## 4. Data

| Entity | Purpose |
| --- | --- |
| `day_ahead_price` | market_area, valid_from, valid_to, price, currency, unit, version, source, is_manual |
| `day_ahead_coverage` | Per delivery day: expected intervals, covered intervals, state |

Backfilled days **[DEC-75]** are ordinary `day_ahead_price` rows — no separate table, no separate
type — with `source` recording that they came from a backfill rather than the 18:00 fetch. Two
consequences follow from **[F08-R15]** and are worth stating rather than discovering:

- `day_ahead_coverage` is written for **historical** delivery days too, and its `state` must
  distinguish *never requested* from *requested and incomplete*. Otherwise a day that has simply not
  been backfilled yet looks identical to a day where the auction data is missing, and the alert
  **[F08-R07]** fires on the wrong one.
- A backfill that re-fetches a day already stored creates a **new version only when the price
  differs** **[F08-R04]**. Re-running a backfill must be safe; a version churn of identical rows
  would make the correction trail **[DEC-99]** unreadable.

No feed-in tariff table exists any more. **[DEC-87]** withdraws `billing.feed_in_tariff` and its audit
companion before either was built — the cost of the reversal is a specification rewrite, not a
migration.

## 5. Edge cases

| Case | Behaviour |
| --- | --- |
| DST spring day | 23 hours / 92 intervals expected; a 24-hour curve fails the completeness check |
| DST autumn day | 25 hours / 100 intervals expected; the duplicated hour must have two distinct validity intervals |
| Auction delayed | The 18:00 fetch **[DEC-36]** finds nothing and the retry schedule continues; alert after the configured cut-off. This is the case the four-attempt schedule used to absorb silently, and it is better as an alert than as a poll |
| Curve arrives earlier than 18:00 | Harmless — the scheduled fetch simply finds it. Nothing is fetched before 18:00, so an early curve is retrieved late rather than missed |
| Price published then corrected | New version supersedes; any affected finalised invoice is flagged. ⚠ **Amended 2026-08-19 by [DEC-99]** — the annual true-up is no longer the mechanism: a **correction invoice** for the delta is raised whenever the correction lands, months later if need be **[F08-R16]** |
| Negative prices across a whole day | Normal. **Unused block cover** then costs the customer money to sell — the invoice must present that clearly rather than hiding it in a net figure **[DEC-23]**. ⚠ **Reversed 2026-08-19 by [DEC-87]**: ~~Since **[DEC-44]** the sunny-day solar case is **no longer** this row's: physically exported volume settles at the feed-in tariff, which is a per-customer rate and is not negative unless someone configures it so. Negative day-ahead now bites on cover, not on export.~~ The sunny-day solar case is **back in this row**. Export is credited raw **[DEC-87]**, so a negative price means the customer **pays to export** — a negative credit. There is no floor at zero and no per-customer rate to soften it, and this is the single most likely surprise on a customer's first summer invoice: it must be presented as its own line with its own price, never netted **[F08-R08]** |
| Backfill requested for a day the licence does not cover | Refused as a failed request with a stated reason, never recorded as a complete day with no prices **[F08-R15]**. **[DEC-75]** removes the *cliff*, not the licence boundary |
| Correction arrives for a month closed long ago | Re-settle those intervals at the **newest version** of the price stored for them **[F08-R16]**, **[DEC-99]**. If the day was never fetched or backfilled, the correction cannot be settled and blocks **[F08-R07]** — which is exactly what **[DEC-75]** exists to prevent |
| Montel returns a different market area | Rejected and logged; never stored under the wrong area |
| A markup appears on a stored day-ahead price | A defect, not a configuration **[F08-R17]**. The **[DEC-80]** percentage belongs to [F04](F04-price-indications.md) and to display only; settlement reads `day_ahead_price` raw **[DEC-44]** |

## 6. Dependencies

| Depends on | Why |
| --- | --- |
| [Montel integration](../30-integrations/02-montel-api.md) | The source, the 18:00 schedule **[DEC-36]**, the **history for backfill** **[DEC-75]**, and the **existing service to reuse** **[DEC-96]**, **[F08-R18]** |
| [F10](F10-invoicing-and-settlement.md) | The main consumer — now including **correction invoices** raised whenever a late metering correction lands **[DEC-99]**, which is what makes the backfilled history load-bearing |
| [F03](F03-consumption-visualisation.md) | Tooltips and exposure KPI, on all three volumes **[F08-R08]** |
| [Invoice calculation](../50-calculations/03-invoice-calculation.md) | Where the three volumes become lines. ⚠ **Amended 2026-08-19 by [DEC-87]**: ~~§7A — where exported volume goes instead — the feed-in tariff, line 6 **[DEC-44]**~~. §7A's feed-in line is withdrawn; exported volume is credited at the day-ahead price with the rest |
| [F04](F04-price-indications.md) | The **other** consumer of Montel, and the boundary this feature must not cross: indications carry the **[DEC-80]** markup, settlement never does **[F08-R17]** |
| [Background jobs](../20-architecture/06-background-jobs.md) | The daily fetch, its retry policy, and the backfill run **[F08-R15]** |

## 7. Open questions

| Ref | Question |
| --- | --- |
| ~~[OQ-16]~~ | ~~What resolution does Montel deliver for the NL day-ahead curve, and is history available for backfill?~~ **CLOSED 2026-08-19 by [DEC-75]** — it was ⏸ partial on **[DEC-36]** (arrival time only) and is now ✅. **History is available for backfill**, to whatever depth the licence allows, so positions can be settled retrospectively and there is **no backfill cliff** **[F08-R15]**. ⚠ Recorded honestly: the source answered the *backfill* half and never restated the **resolution** half. The row closes anyway because resolution is settled **by design** — **[F08-R03]** resolves a price by validity interval, so hourly and 15-minute deliveries both work with no special case, and the only thing that varies is how many rows a day carries and what **[F08-R06]** counts. If **[F08-R03]** is ever replaced by index-based lookup, this question comes back with it |
| ~~[OQ-35]~~ | ~~Is the raw day-ahead price used, or a price plus a configured spread?~~ **Closed by [DEC-44]** — the **raw** price, no spread **[F08-R12]**. **First half confirmed 2026-08-19** (*"Day ahead price is raw"*), and it now covers **three** legs, not two **[F08-R14]**. ⚠ ~~The same decision removes exported volume from day-ahead settlement entirely **[F08-R13]**; it settles at the feed-in tariff on invoice line 6~~ — **Reversed 2026-08-19 by [DEC-87]**. Separately, **[DEC-80]** introduces a markup that applies to customer-facing *indications* only and must never reach settlement **[F08-R17]**; that is a second price, not a spread on this one |
| ~~[OQ-86]~~ | ~~When a customer exports and no feed-in tariff resolves, is the export valued at zero or at the day-ahead price?~~ **CLOSED 2026-08-19 by [DEC-87]** — the question **disappears** rather than being answered: there is no feed-in tariff, so nothing can fail to resolve. Export settles raw at the day-ahead price in **every** interval, not only in the fallback; `MISSING_FEED_IN_TARIFF` and the invoice-run skip it caused are removed, the €662,53 gap between the two candidate answers goes with them, and the only missing-price failure mode left in this feature is **[F08-R07]**. ⚠ The outcome coincides with one of the two candidate answers — day-ahead — but by a different route: it is the rule, not a fallback from a rule |

**Nothing in this feature is open after 2026-08-19.** The three questions it carried — schedule and
backfill **[OQ-16]**, spread **[OQ-35]**, feed-in fallback **[OQ-86]** — are all closed. What replaces
them is not a question but a discipline: the **[DEC-80]** markup and the **[DEC-44]** raw price now
coexist in one system **[F08-R17]**, and no open question protects that boundary.
