# F09 — Tariffs & Energiebelasting

> **This file was `F09 — Surcharges ("Topups")` until 2026-08-19.** On that date **[DEC-73]** took
> surcharges out of the platform altogether and **[DEC-87]** withdrew the feed-in tariff, which
> between them removed everything the feature used to be. The same round brought **energiebelasting**
> back into scope **[DEC-74]** — and energiebelasting needs exactly the machinery this document
> already described: versioned, employee-editable reference data, a resolution order, a snapshot of
> what was applied, and an audit of every change. So the document is **repurposed rather than
> deleted**, and the old text is struck rather than removed.
>
> **The filename `F09-surcharges.md` is deliberately left alone.** Fourteen markdown links in eight
> files point at it, plus the generated site index; renaming the file would break every one of them
> and buy nothing, because the heading carries the identity and the path is only an address. Renaming
> is a separate, mechanical change for whoever owns a repo-wide link sweep.

**Portal:** employee · **Priority:** Must · **Phase:** 3 · **Size:** S

---

## 1. Summary

Energiebelasting is Dutch energy tax, levied **per EAN, per calendar year, on net consumed volume**,
in **degressive brackets** — the €/kWh rate falls as the annual volume rises **[AS-14]**. **[DEC-74]**
puts it back in scope and it is what this feature now delivers:

- a **versioned bracket table** — tier boundaries and €/kWh rates, per commodity per calendar year —
  that employees can change **without a release** (F09-R18, F09-R19, F09-R25);
- a **per-customer reduction or exemption** for the minority who do not pay the standard rate; the
  source names growers as the example (F09-R20, F09-R21);
- calculation **per EAN per calendar year on net usage [DEC-22]**, by the cumulative year-to-date
  delta method so a bracket is crossed once a year and not once a month (F09-R22);
- the **mid-year EAN transfer rule**: each period gets **50% of each bracket** (F09-R23, §5.2);
- a **ledger push** of the result to the bookkeeping program, ex-VAT, against the energiebelasting
  ledger account **[DEC-76]**, **[DEC-88]**, **[DEC-107]** — not a VAT-bearing invoice line computed
  here (F09-R24).

~~A per-**kWh** adder applied on top of the energy price, configured per customer and validity period
**[DEC-35]**. It is PeakPower's margin line on the invoice.~~
⚠ **Reversed 2026-08-19 by [DEC-73]**. Surcharges — "topups" — are **out of platform scope**. The
platform computes and pushes **volume**; the bookkeeping program multiplies that volume by the topup
fee. The surcharge tariff table, its resolution order and **invoice line 4** all leave the platform.
The platform's only margin instrument is now the **spread on the price it quotes [DEC-80]**, which
lives in [F04](F04-price-indications.md), not here.

~~**[DEC-44] adds a second rate of exactly the same shape**: the **feed-in tariff**, the per-kWh rate
at which physically exported volume is credited on invoice line 6. It is not a surcharge and it is not
PeakPower's margin, but it is maintained by the same people, on the same screens, under the same
rules — so it lives in this feature rather than in one of its own. §11.~~
⚠ **Reversed 2026-08-19 by [DEC-87]**. The feed-in tariff is withdrawn. Exported volume is credited
**raw at the day-ahead price** for the interval, exactly as surplus is under **[DEC-23]**, with no
topup and no feed-in fee on it. §11 and §11.1 are obsolete and kept only as history.

> ⚠ **The feature index has not caught up, and it is not this document's to change.**
> ~~[10-features/README.md](README.md) still labels F09 "Surcharges (topups)" and counts its
> requirements as 7 Must / 2 Should / 1 Could. Under **[DEC-35]** and **[DEC-44]** the feature covers
> **both** per-customer rates and carries **F09-R01…R17** — 13 Must, 3 Should, 1 Could. The label and
> the counts need updating by that file's owner, along with the F09 row's dependency on F10 for the
> line-6 requirements **F10-R39…R42**.~~
> **Restated 2026-08-19.** The index needs a larger correction than before: the F09 row must be
> relabelled **"Tariffs & Energiebelasting"**, its requirement count becomes **F09-R18…R27 — 10 Must,
> 0 Should, 0 Could** with F09-R01…R17 all retired, its dependency on F10 for the line-6 requirements
> **F10-R39…R42** disappears with the feed-in tariff **[DEC-87]**, and the phase-3 scope line that
> reads "without energiebelasting **[DEC-24]**" is now false **[DEC-74]**. Owner: that file.

> ~~**Unit — [DEC-35].** Both rates are quoted and stored in **€/kWh**. This is deliberate and it is a
> change: every *market* price in the platform — block prices, day-ahead — remains **€/MWh**. The
> boundary is "market price" versus "customer rate", and it is the reason the invoice formula for
> these two lines has **no `/1000`** where every other line has one. See
> [Invoice calculation](../50-calculations/03-invoice-calculation.md) §6.1.~~
> ⚠ **Amended 2026-08-19 by [DEC-73] and [DEC-74].** The two rates it governed are gone, but the
> **rule survives and still applies here**: energiebelasting brackets are published by the
> Belastingdienst in **€/kWh** and are stored and applied in €/kWh, against a kWh volume, with **no
> `/1000`**. Market prices — block prices, day-ahead — stay €/MWh. The boundary is unchanged; only the
> rates that sit on the customer side of it have changed identity.

> ~~**Naming.** The brief calls this a "topup". This specification calls it a **surcharge** in code,
> UI and documentation, because "top-up" is already the customer-facing word for putting money in the
> wallet, and both appear on the same screens. **[OQ-12] is closed by [DEC-35]**: a "topup per
> customer per period" is a per-unit fee, not a fixed periodic fee and not a scheduled wallet deposit.
> The feature stays volumetric and the tariff screens can be built.~~
> ⚠ **Obsolete 2026-08-19 by [DEC-73].** The naming collision resolves itself: the platform has no
> surcharge to name, so "top-up" reverts to meaning only what a customer puts into the wallet
> ([F07](F07-wallet-topup-and-payments.md)). **[OQ-12] stays closed** — [DEC-35] answered *what a
> topup is*, and [DEC-73] then decided the platform does not calculate it. Both facts are true and
> neither reopens the question.

## 2. User stories

| As a… | I want to… | So that… |
| --- | --- | --- |
| ~~Finance~~ | ~~set a surcharge for a customer with a start and end date~~ | ~~the agreed margin is billed automatically~~ — removed by **[DEC-73]**; the topup fee is applied in the bookkeeping program |
| ~~Finance~~ | ~~change a surcharge from a future date without touching past invoices~~ | ~~a renegotiation applies from when it was agreed~~ — removed by **[DEC-73]** |
| ~~Finance~~ | ~~see the surcharge history for a customer~~ | ~~I can answer "what did we charge in March?"~~ — removed by **[DEC-73]** |
| ~~Finance~~ | ~~set a default surcharge for new customers~~ | ~~I don't have to remember~~ — removed by **[DEC-73]** |
| ~~Finance~~ | ~~set a feed-in tariff for a customer with a start and end date **[DEC-44]**~~ | ~~exported volume is credited at the agreed rate~~ — removed by **[DEC-87]**; export is credited raw at day-ahead |
| ~~Customer user~~ | ~~see the surcharge as a clear line on my invoice~~ | ~~the price I pay is explainable~~ — removed by **[DEC-73]**; the line is produced by the bookkeeping program |
| ~~Customer user~~ | ~~see what I was paid for the energy I exported, and at what rate~~ | ~~the credit is explainable too **[DEC-44]**~~ — removed by **[DEC-87]**; the rate is the published day-ahead price |
| Finance | load next year's energiebelasting brackets before 1 January, without waiting for a release **[DEC-74]** | the tax is right from the first interval of the year |
| Finance | record that a specific customer pays a reduced rate or none at all | the growers and other non-standard cases are billed correctly without a code change |
| Finance | see, per EAN per year, the running net volume, the bracket it sits in and the tax pushed so far | I can answer a customer's "why did this month cost more?" |
| Finance | have the calculated energiebelasting land in the bookkeeping program as a ledger entry **[DEC-76]** | VAT and the document are handled where they belong, once |
| Employee | transfer an EAN between customers mid-year and have both periods taxed correctly | a change of supplier or owner does not need a manual tax calculation |

## 3. Functional requirements

**F09-R01…R17 are all retired.** Nothing in this table is renumbered; the IDs stay so that the
fourteen inbound references across the spec set resolve to an explicit "removed, and here is why"
rather than to nothing. New work continues at **F09-R18**.

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| ~~F09-R01~~ | ~~A surcharge has: scope (`GLOBAL_DEFAULT` or a specific customer), commodity, **`rate_eur_per_kwh` (signed, 7 decimals) [DEC-35]**, `valid_from`, `valid_to` (nullable = open-ended), and a note. The field was `rate_eur_per_mwh` at 4 decimals; **[DEC-35]** changes both the unit and the precision — see F09-R11 and §4 rule 6.~~ **Removed by [DEC-73]** — no surcharge table in the platform. ⚠ Two other documents lean on this row for *shape* rather than for surcharges: **[F05-R50]** (the four-eyes threshold, itself replaced by **[DEC-71]**) and the reference-data pattern in [Database design](../20-architecture/04-database-design.md) §3.6. The shape survives in **F09-R20** below. | ~~Must~~ |
| ~~F09-R02~~ | ~~Validity periods are half-open `[from, to)`. Two surcharges with the same scope and commodity may not overlap — enforced by a database exclusion constraint.~~ **Removed by [DEC-73]** as a surcharge rule; the identical rule is re-stated for the energiebelasting reduction in **F09-R20**. | ~~Must~~ |
| ~~F09-R03~~ | ~~Resolution order for a given customer, commodity and date: the customer-specific surcharge, else the global default, else zero.~~ **Removed by [DEC-73]**; replaced by the energiebelasting resolution order in **F09-R21**, which ends in a **hard stop** rather than in zero. | ~~Must~~ |
| ~~F09-R04~~ | ~~A negative rate is permitted and represents a discount.~~ **Removed by [DEC-73]**. Energiebelasting rates are never negative; a discount is expressed as a reduced rate or an exemption **F09-R20**. | ~~Must~~ |
| ~~F09-R05~~ | ~~Surcharges are never edited retroactively into a period already invoiced. Changing history requires a credit note plus a re-issue **[F10](F10-invoicing-and-settlement.md)**.~~ **Removed by [DEC-73]**; the equivalent rule for bracket versions is **F09-R19**, and **[DEC-99]** changes what "already invoiced" costs — a correction is now a correction invoice at any time, not a closed door. | ~~Must~~ |
| ~~F09-R06~~ | ~~Every create and change is audited with actor, timestamp and before/after values.~~ **Removed by [DEC-73]** as a surcharge rule; re-stated for brackets and reductions in **F09-R27**. | ~~Must~~ |
| ~~F09-R07~~ | ~~The invoice applies the surcharge per interval using the rate valid at that interval, so a mid-month change splits correctly.~~ **Removed by [DEC-73]**. Energiebelasting is not a per-interval rate: it is annual and cumulative **F09-R22**. | ~~Must~~ |
| ~~F09-R08~~ | ~~Finance can preview the monetary effect of a surcharge change on the last full month's volumes before saving.~~ **Removed by [DEC-73]**. Not carried over: a bracket table is published law, not a negotiated rate, so there is nothing to decide by previewing it. | ~~Should~~ |
| ~~F09-R09~~ | ~~A surcharge can be scoped to a single metering point rather than the whole customer.~~ **Removed by [DEC-73]**. The metering-point scope *is* carried over — a reduction is often held per connection, not per company **F09-R20**. | ~~Should~~ |
| ~~F09-R10~~ | ~~Multiple named surcharge components (e.g. "margin", "imbalance cover", "certificates") can be stacked and shown as separate invoice lines.~~ **Removed by [DEC-73]**. Component stacking is now the bookkeeping program's, if anyone still wants it. | ~~Could~~ |
| ~~F09-R11~~ | ~~Rates are stored at **7 decimal places** in €/kWh… The required column type is **`numeric(12,7)`**, signed.~~ **Removed by [DEC-73]**. The *precision reasoning* transfers: `billing.energy_tax_tariff.rate_eur_kwh` is already `numeric(14,8)` in [Database design](../20-architecture/04-database-design.md) §3.6, which is finer still, and **F09-R18** requires it to stay that way. | ~~Must~~ |
| ~~F09-R12~~ | ~~Migrating to **[DEC-35]** **divides every existing €/MWh rate by 1000** and widens the column in the same migration.~~ **Removed by [DEC-73]** — there is no surcharge column to migrate. ⚠ This retires work, not just a requirement: the expand/backfill/contract migration in [Database design](../20-architecture/04-database-design.md) §7.1, item 12 of [Solution structure](../20-architecture/02-solution-structure.md) §9, and **risk R-23** in [Risks](../70-delivery/02-risks.md) all exist only to make this migration safe. Their owners should retire them. | ~~Must~~ |
| ~~F09-R13~~ | ~~Every rate is displayed, entered and exported in **€/kWh** only. The equivalent €/MWh figure is never shown alongside it on an invoice line.~~ **Removed by [DEC-73]** as a surcharge rule; re-stated for energiebelasting in **F09-R18**, because the 1000× reading error it prevents is identical. | ~~Must~~ |
| ~~F09-R14~~ | ~~A **feed-in tariff [DEC-44]** has the same fields, the same validity and overlap rules, the same resolution order and the same audit as a surcharge, in a separate table with its own scope. It is signed; a positive rate credits the customer.~~ **Removed by [DEC-87]** — there is no feed-in tariff. `billing.feed_in_tariff` is not built. | ~~Must~~ |
| ~~F09-R15~~ | ~~The invoice applies the feed-in tariff per interval using the rate valid at that interval, so a mid-month change splits into two lines rather than blending.~~ **Removed by [DEC-87]**. Export is valued at the day-ahead price for the interval **[DEC-23]**, which is already per-interval by construction. | ~~Must~~ |
| ~~F09-R16~~ | ~~Feed-in tariffs are never edited retroactively into a period already invoiced; changing history requires a credit note plus a re-issue.~~ **Removed by [DEC-87]**. | ~~Must~~ |
| ~~F09-R17~~ | ~~Finance can see, side by side for one customer and period, the surcharge and the feed-in tariff that will apply — they are agreed together and a mismatch in validity dates between them is a common and expensive error.~~ **Removed by [DEC-73]** and **[DEC-87]** together: neither rate exists, so there is nothing to compare and no mismatch to catch. | ~~Should~~ |
| **F09-R18** | The **energiebelasting bracket table** is reference data, versioned **per commodity per calendar year**. A bracket row has: commodity, tax year, tier index, `lower_kwh` (inclusive), `upper_kwh` (exclusive, null = open-ended top tier), `rate_eur_kwh` and a `source` naming where the figure came from. Rates are **€/kWh** and are applied to a **kWh** volume with **no `/1000`**; they are stored at `numeric(14,8)` and never displayed converted to €/MWh **[DEC-74]**. | Must |
| **F09-R19** | A bracket set is **versioned, never edited in place**. Once a year's table has been used to push a ledger entry it is closed to edits; a correction creates a **new version** of that year's table, and every calculation records which version it used **(F09-R26)**. Loading next year's rates is therefore always additive and can be done at any time before 1 January **[DEC-74]**. | Must |
| **F09-R20** | A **per-customer reduction or exemption** can be recorded for the minority who do not pay the standard rate — the source names growers as the example. A reduction row has: scope (`CUSTOMER` or `METERING_POINT`), scope id, commodity, tax year, either an **`EXEMPT`** flag or an **overriding `rate_eur_kwh` per tier index**, a validity period `[from, to)`, a note and a `source`. Validity is half-open and two rows for the same scope, commodity and tier may not overlap — the same database exclusion constraint the surcharge used **[DEC-74]**. A percentage discount is expressed as an overriding rate rather than as a second mechanism; one shape is cheaper to reason about than two, and the ledger push has to show a rate either way. | Must |
| **F09-R21** | **Resolution order** for a given metering point, commodity and calendar year: the metering-point reduction, else the customer reduction, else the standard bracket table for that year. There is **no fallback to zero**: if no bracket table exists for the year and commodity, the run **stops** with `MISSING_TAX_TARIFF` for that customer rather than taxing at zero **[DEC-74]**. Zero tax is a legal statement that only an explicit `EXEMPT` row may make. | Must |
| **F09-R22** | Energiebelasting is calculated **per EAN, per calendar year, on net usage [DEC-22]**, by the **cumulative year-to-date delta** method: `tax(month) = cumulative(ytdAfter) − cumulative(ytdBefore)`, where `cumulative(V)` sums each tier's clamped share of `V` at that tier's resolved rate. This is what makes a bracket boundary be crossed **once a year** rather than once a month; charging each month against the ladder from zero over-charges every site above the first tier. The whole year is evaluated on the customer's **resolved** ladder **(F09-R21)**, so `ytdBefore` and `ytdAfter` are never computed on two different ladders **[AS-14]**. | Must |
| **F09-R23** | When an EAN **transfers between customers mid-year**, **each period gets 50% of each bracket** — a straight half-and-half split of the annual tier boundaries, **not** a pro-rata by days **[DEC-74]**, closing **[OQ-77]**. Each period then runs its own year-to-date ladder from zero on the halved boundaries. Rates are not halved; only the boundaries are. §5.2. | Must |
| **F09-R24** | The calculated amount is **pushed as a ledger entry** to the bookkeeping program against the energiebelasting ledger account **[DEC-76]**, **[DEC-88]**, **[DEC-107]** — **ex-VAT, with no VAT computed here**. The platform does not produce a VAT-bearing invoice line for it; the bookkeeping program applies the rate configured on that ledger account and puts it on the document it numbers and sends **[DEC-89]**. ⚠ The Dutch subtlety that energiebelasting is itself part of the VAT base moves out with the VAT: it is now the bookkeeping program's ordering problem, and **[DEC-107]** must set that account up knowing it. | Must |
| **F09-R25** | Employees maintain the bracket table and the reductions on a **back-office screen, with no release** — load a year, view it, close a version, add the next. This is the whole point of **[DEC-74]**'s "we need to be able to change those prices". **[F12-R20]** is that screen: **[DEC-24]**'s deferral of it is lifted with **[DEC-74]**, and **[F12-R21]** (manage surcharges) retires with **[DEC-73]**. Owner: [F12](F12-employee-back-office.md). | Must |
| **F09-R26** | Every pushed amount **snapshots what produced it**: the bracket-table version, the tier boundaries and rates actually applied, the reduction or exemption row if one resolved, the `ytdBefore` and `ytdAfter` volumes, and the split factor if **F09-R23** applied. Re-reading a pushed entry never depends on current reference data, which is the same rule the surcharge had and the same reason: reference data moves and invoices do not. | Must |
| **F09-R27** | Every create, version-close and change to a bracket table or a reduction is **audited with actor, timestamp and before/after values** **[DEC-17]**. A tax rate that changed with no name against it is not defensible to an accountant or to the Belastingdienst. | Must |

## 4. Business rules

1. **Time-bounded, non-overlapping, per scope.** The constraint lives in the database.
   *Unchanged in force, changed in subject 2026-08-19: the rows it governs are now bracket-table
   versions and reduction rows **F09-R19**, **F09-R20**, not surcharges **[DEC-73]**.*
2. ~~**Resolution is most-specific-wins**, evaluated per interval, not per invoice.~~
   ⚠ **Amended 2026-08-19 by [DEC-74]**: most-specific-wins survives — metering point, then customer,
   then the standard table **F09-R21** — but it is evaluated **per EAN per calendar year**, not per
   interval. Energiebelasting has no per-interval rate to resolve; it has an annual ladder.
3. **The applied rate is snapshotted on the result**, so re-reading an old amount never depends on
   current reference data. *(Was "on the invoice line"; under **[DEC-88]** the platform pushes and the
   bookkeeping program numbers, so the snapshot lives on the pushed ledger entry **F09-R26**.)*
4. **A change is a new row.** Rates are never updated in place. *Unchanged, and stronger: a used
   bracket-table version is closed, and a correction is a new version **F09-R19**.*
5. ~~**Zero is a valid rate** and is distinct from "no surcharge configured" — both bill nothing, but
   only one is a deliberate statement.~~
   ⚠ **Amended 2026-08-19 by [DEC-74]**: the distinction is now load-bearing rather than tidy. "No
   bracket table" is a **hard stop**; only an explicit `EXEMPT` row taxes at nothing **F09-R21**. Both
   used to bill nothing; now only one of them is allowed to.
6. **Customer rates are €/kWh; market prices are €/MWh** ~~**[DEC-35]**~~ **[DEC-74]**. The boundary is
   absolute and it is the reason the ~~surcharge and feed-in~~ energiebelasting formula carries no
   `/1000`. Every rate field, label, column header, CSV column and API property carries its unit in its
   name. *The rule outlived the rates that motivated it: the Belastingdienst publishes brackets in
   €/kWh, so a customer-side rate is still €/kWh and a market price is still €/MWh.*
7. ~~**Both rates obey rules 1–5 identically [DEC-44].** The feed-in tariff is not a special case; it is
   a second instance of the same mechanism, and should be implemented as one — with one exception,
   rule 8.~~ ⚠ **Reversed 2026-08-19 by [DEC-87]** — there is no second rate.
8. ~~**A missing feed-in tariff is not the same as a missing surcharge.** A missing surcharge bills
   nothing and costs the customer nothing. A missing feed-in tariff means exported energy was taken
   and not paid for. See §11.1 — this is an open question, not a settled default.~~
   ⚠ **Reversed 2026-08-19 by [DEC-87]** — export is credited raw at the day-ahead price **[DEC-23]**,
   so there is no tariff to be missing. The `MISSING_FEED_IN_TARIFF` check and the month-skip it caused
   are **removed**.
9. **The ladder is annual and cumulative, never monthly.** A month's amount is the delta of the
   year-to-date cumulative tax **F09-R22**. Any monthly figure that can be computed without knowing the
   year to date is wrong.
10. **A mid-year transfer halves the boundaries, not the rates** **F09-R23**. The rule is simple on
    purpose; §5.2 states what the simplicity costs.
11. **Ex-VAT, always.** The platform pushes a value and a ledger account **[DEC-76]**; VAT is the
    bookkeeping program's, per account **F09-R24**.
12. **The tax basis is net usage [DEC-22]**, which is the platform's own volume basis, so the taxed
    series and the invoiced series are the same series **[AS-14]**. ⚠ One fiscal subtlety is *not*
    settled here and is not this document's: whether the netting is per interval (`Σ U`) or floored at
    zero per interval (`Σ max(U, 0)`) for an exporting site. It is recorded in
    [Invoice calculation](../50-calculations/03-invoice-calculation.md) §7.3 and it belongs to a tax
    advisor, not to this feature.

## 5. Worked example

The rates below are **illustrative, not the Belastingdienst's**. Real rates are set annually, the band
boundaries have moved historically, and a rate copied into a specification is a rate that will be
wrong within a year — which is precisely why **F09-R18** makes them editable reference data. The
arithmetic, not the figures, is the thing to check.

**Illustrative 2026 ELECTRICITY bracket table, version 1:**

| Tier | Annual band (kWh) | Rate |
| :--: | --- | --- |
| 1 | 0 – 10 000 | €0,1000/kWh |
| 2 | 10 000 – 50 000 | €0,0700/kWh |
| 3 | 50 000 – 10 000 000 | €0,0400/kWh |
| 4 | above 10 000 000 | €0,0100/kWh |

`cumulative(V) = Σ over tiers t: clamp(V − lowerₜ, 0, upperₜ − lowerₜ) × rateₜ`

### 5.1 One EAN, one customer, two months

Net usage **[DEC-22]**: January 30 000 kWh, February 35 000 kWh.

| Month | ytdBefore | ytdAfter | cumulative(ytdBefore) | cumulative(ytdAfter) | Pushed |
| --- | --: | --: | --: | --: | --: |
| January | 0 kWh | 30 000 kWh | €0,00 | €2 400,00 | **€2 400,00** |
| February | 30 000 kWh | 65 000 kWh | €2 400,00 | €4 400,00 | **€2 000,00** |

Checking both cumulatives by hand:

- `cumulative(30 000)` = `10 000 × 0,1000` + `20 000 × 0,0700` = 1 000,00 + 1 400,00 = **€2 400,00**
- `cumulative(65 000)` = `10 000 × 0,1000` + `40 000 × 0,0700` + `15 000 × 0,0400`
  = 1 000,00 + 2 800,00 + 600,00 = **€4 400,00**
- February delta = 4 400,00 − 2 400,00 = **€2 000,00**, which is also 20 000 kWh of tier 2 (from
  30 000 up to 50 000) at 0,0700 = 1 400,00 plus 15 000 kWh of tier 3 at 0,0400 = 600,00. The two
  routes agree, which is the point of the method.

**Why not month-by-month.** Taxing February on its own 35 000 kWh from the bottom of the ladder gives
`10 000 × 0,1000 + 25 000 × 0,0700` = **€2 750,00** — €750,00 too much, every month, for every site
past the first tier **F09-R22**.

**With a reduction.** Suppose this customer holds an overriding tier-3 rate of €0,0200/kWh
**F09-R20**. The *whole year* is then evaluated on the resolved ladder: `cumulative(30 000)` is
unchanged at €2 400,00 (tiers 1 and 2 are not overridden), `cumulative(65 000)` becomes
`1 000,00 + 2 800,00 + 15 000 × 0,0200` = €4 100,00, and February pushes **€1 700,00**. Computing
`ytdBefore` on the standard ladder and `ytdAfter` on the reduced one would push €1 700,00 − nothing of
the sort: it would push 4 100,00 − 2 400,00 by luck here and a nonsense number as soon as tier 1 or 2
is overridden. Hence "never on two different ladders" in **F09-R22**.

### 5.2 Mid-year EAN transfer — 50% of each bracket *([DEC-74], closes [OQ-77])*

EAN transfers from customer A to customer B on **1 July 2026**. Each period gets **half of every
annual boundary**, and each runs its own ladder from zero:

| Tier | Annual band | **Per-period band (50%)** | Rate *(unchanged)* |
| :--: | --- | --- | --- |
| 1 | 0 – 10 000 | 0 – 5 000 | €0,1000/kWh |
| 2 | 10 000 – 50 000 | 5 000 – 25 000 | €0,0700/kWh |
| 3 | 50 000 – 10 000 000 | 25 000 – 5 000 000 | €0,0400/kWh |
| 4 | above 10 000 000 | above 5 000 000 | €0,0100/kWh |

Net usage: **A** 40 000 kWh (Jan–Jun), **B** 10 000 kWh (Jul–Dec). Total 50 000 kWh.

| Period | Volume | Tier 1 | Tier 2 | Tier 3 | Tax |
| --- | --: | --: | --: | --: | --: |
| A · Jan–Jun | 40 000 kWh | 5 000 × 0,1000 = 500,00 | 20 000 × 0,0700 = 1 400,00 | 15 000 × 0,0400 = 600,00 | **€2 500,00** |
| B · Jul–Dec | 10 000 kWh | 5 000 × 0,1000 = 500,00 | 5 000 × 0,0700 = 350,00 | — | **€850,00** |
| | | | | **Total** | **€3 350,00** |

**What it costs, stated rather than hidden.** The same 50 000 kWh on one uninterrupted annual ladder
would be `1 000,00 + 40 000 × 0,0700` = **€3 800,00**. The rule therefore yields **€450,00 less** on
this connection. That is not a rounding artefact, it is arithmetic that holds generally:

- Halving every boundary is the identity `halved(v) = full(2v) / 2`. Check it: `full(80 000)` =
  1 000,00 + 2 800,00 + 30 000 × 0,0400 = €5 000,00, half of which is €2 500,00 — A's figure.
  `full(20 000)` = 1 000,00 + 10 000 × 0,0700 = €1 700,00, half of which is €850,00 — B's figure.
- So the two periods together pay `[full(2v_A) + full(2v_B)] / 2`. When the volume splits **evenly**
  that is exactly `full(v_A + v_B)` — the rule is revenue-neutral. Check: 25 000 kWh each gives
  `500,00 + 1 400,00` = €1 900,00 per period, €3 800,00 together, identical to the annual ladder.
- The ladder is degressive, hence concave, so **any uneven split pays less**, and the more uneven the
  split the larger the gap.

**Where it diverges from pro-rata, which [DEC-74] explicitly rejects.** For a 1 July transfer the two
rules nearly coincide anyway — pro-rata by days would give 181/365 = 49,6%. For a **1 October**
transfer they do not: pro-rata would give 74,8% / 25,2%, while the rule still gives 50/50, so a
three-month tail receives a full half of every bracket. On 45 000 kWh Jan–Sep and 5 000 kWh Oct–Dec
the rule yields `2 700,00 + 500,00` = **€3 200,00** against €3 800,00 for a single annual ladder —
**€600,00 less**, and the gap widens the further the transfer sits from midyear. This is the price of
a rule that a person can check in their head, and it was chosen knowing that.

## 6. Data

| Entity | Purpose |
| --- | --- |
| ~~`surcharge`~~ | ~~scope, scope_id, commodity, rate **`numeric(12,7)` €/kWh [DEC-35]**, valid_from, valid_to, note, created_by~~ **Removed by [DEC-73]** — not built |
| ~~`surcharge_audit`~~ | ~~Full change history~~ **Removed by [DEC-73]** |
| ~~`feed_in_tariff`~~ | ~~**New [DEC-44].** Identical shape…~~ **Removed by [DEC-87]** — not built |
| ~~`feed_in_tariff_audit`~~ | ~~Full change history~~ **Removed by [DEC-87]** |
| `energy_tax_tariff` | **Populated at last [DEC-74].** commodity, tax_year, **version**, tier_index, lower_kwh, upper_kwh (null = open-ended), `rate_eur_kwh numeric(14,8)`, source, closed_at |
| `energy_tax_reduction` | **New [DEC-74].** scope (`CUSTOMER` \| `METERING_POINT`), scope_id, commodity, tax_year, tier_index, `EXEMPT` flag **or** overriding `rate_eur_kwh`, `validity daterange`, note, source, created_by |
| `energy_tax_result` | Per EAN per month: bracket-table version, resolved ladder, ytd_before_kwh, ytd_after_kwh, split_factor, amount_eur **ex-VAT [DEC-76]**, ledger account, push status **F09-R26** |
| `energy_tax_tariff_audit`, `energy_tax_reduction_audit` | Full change history, actor and before/after **F09-R27** |

> ⚠ **The schema is owned by [Database design](../20-architecture/04-database-design.md) §3.6, not by
> this document.** ~~Two changes are required there and must not be assumed done:
> `billing.surcharge.rate` migrates from `numeric(12,4)` to **`numeric(12,7)`** with the field renamed
> to reflect €/kWh **[DEC-35]**, and a new `billing.feed_in_tariff` table is added with the same
> columns, the same `daterange` **exclusion constraint** and the same audit companion **[DEC-44]**.~~
> **Restated 2026-08-19.** Neither of those changes is wanted any more. What that document now needs:
> `billing.surcharge` and its migration in §7.1 are **dropped** **[DEC-73]**; `billing.feed_in_tariff`
> is **never created** **[DEC-87]**; `billing.energy_tax_tariff` loses its "retained but unpopulated
> **[DEC-24]**" comment, gains a **version** column and a uniqueness key that includes it, and is
> joined by `billing.energy_tax_reduction` with a `daterange` exclusion constraint and
> `billing.energy_tax_result` **[DEC-74]**. Owner: that file.

## 7. Edge cases

| Case | Behaviour |
| --- | --- |
| Overlapping reduction periods entered | Rejected at save with the conflicting row shown — the same exclusion constraint the surcharge used **F09-R20** |
| No bracket table loaded for the year | **Hard stop** `MISSING_TAX_TARIFF` for that customer; nothing is taxed at zero by omission **F09-R21**. ⚠ This check is **reinstated** — [Monthly invoicing](../40-processes/04-monthly-invoicing.md) §Pre-flight currently marks it "not evaluated **[DEC-24]**". Owner: that file |
| Customer genuinely pays nothing | Requires an explicit `EXEMPT` reduction row with a `source` **F09-R20**. "Nothing configured" is never read as "exempt" |
| A reduction is dated to start mid-year | The tax is annual **[AS-14]**, so the whole calendar year is recomputed on the resolved ladder and the difference is pushed in the month the change lands — the continuous-correction mechanism of **[DEC-99]**, not a special case. ⚠ Reasoned here, not stated by **[DEC-74]**; if Finance reads the reduction as applying only forward from its start date, the ladder splits and this row changes. Raise at the next session rather than assuming |
| EAN transfers mid-year | Each period gets **50% of every bracket**, own ladder from zero **F09-R23**, §5.2 |
| EAN transfers **twice** in one year | ⚠ **[DEC-74]** answers the two-period case only. Reasoned extension: *n* periods each get `100/n` % of every bracket, which degenerates to the stated rule at *n* = 2 and keeps the "equal shares, never pro-rata" principle. Rare enough to be worth confirming rather than building blind |
| Net usage negative for a month (site exported more than it took) | The year-to-date cumulative can fall, so the month's delta is **negative** and the pushed entry is a credit. Whether the fiscal basis floors at zero per interval is the tax question in §4 rule 12, owned by [Invoice calculation](../50-calculations/03-invoice-calculation.md) §7.3 |
| Metering correction lands months later | Recompute the affected year, push the delta **[DEC-99]**. The year is never "closed" by the platform; the bookkeeping program decides what to do with a late ledger entry |
| Bracket table edited after it has been used | Blocked; a new **version** is created and the affected months are recomputed **F09-R19**, **F09-R26** |
| Rate entered in €/MWh out of habit | A €0,10/kWh rate typed as €100/MWh is 1000× out. The field is labelled **€/kWh**, and entry validates against a plausibility band, warning rather than blocking — a legitimate rate outside the band must still be enterable. *(Rule kept from the surcharge; the failure mode is identical and it is the only part of **[DEC-35]**'s reasoning worth keeping.)* |
| ~~No surcharge at all configured~~ | ~~Zero is applied and the invoice omits the line~~ — **removed by [DEC-73]** |
| ~~Rate changes mid-interval~~ | ~~Impossible — validity is date-bounded, and an interval belongs to exactly one date~~ — **removed by [DEC-73]** |
| ~~Existing €/MWh rate read after migration~~ | ~~Impossible if **F09-R12** is honoured…~~ — **removed by [DEC-73]**; there is no migration because there is no surcharge column |
| ~~No feed-in tariff configured and the site exported~~ | ~~⚠ **Not decided — see §11.1.** The month is skipped with `MISSING_FEED_IN_TARIFF`~~ — **removed by [DEC-87]**. Export is credited raw at the day-ahead price **[DEC-23]**; the skip and the error code are deleted |
| ~~No feed-in tariff configured and the site did not export~~ | ~~Warning only~~ — **removed by [DEC-87]** |

## 8. Out of scope

- ~~Volume-tiered or capacity-based surcharges, and volume-tiered feed-in tariffs.~~ Moot — **surcharges
  themselves are out of scope [DEC-73]** and **the feed-in tariff is withdrawn [DEC-87]**.
- ~~Automatic indexation.~~ Still out: next year's brackets are **loaded**, never derived or indexed
  **F09-R18**.
- ~~Customer-visible surcharge or feed-in-tariff editing.~~ Restated: customers never edit bracket
  tables or reductions. They are back-office reference data **F09-R25**.
- **The topup fee itself [DEC-73].** The platform pushes **volume**; the bookkeeping program
  multiplies it by the topup fee. No surcharge tariff, no resolution order, no invoice line 4 here.
  Pushing the volume is [F10](F10-invoicing-and-settlement.md)'s, not this feature's.
- **VAT [DEC-76].** Ex-VAT amounts and a ledger account go out; the rate is configured per account in
  the bookkeeping program.
- **The *vermindering*** — pending **[OQ-96]**. Nothing is implemented for it and nothing is defaulted.

## 9. Dependencies

| Depends on | Why |
| --- | --- |
| [F10](F10-invoicing-and-settlement.md) | ~~The only consumer, of both rates~~ **Restated 2026-08-19**: the consumer of the energiebelasting amount, and the owner of the monthly volume push that replaces the surcharge **[DEC-73]**. **[F10-R39]…[F10-R42]** (feed-in) retire with **[DEC-87]**; line 5 returns with **[DEC-74]** |
| [F01](F01-customer-and-metering-points.md) | Scope resolution — and the **mid-year EAN transfer** event that triggers **F09-R23** |
| [F02](F02-metering-data-ingestion.md) | The net-usage series the tax is levied on **[DEC-22]** |
| [F12](F12-employee-back-office.md) | The bracket and reduction screens **F09-R25**: **[F12-R20]** returns to Must, **[F12-R21]** retires |
| [Odoo accounting](../30-integrations/04-odoo-accounting.md) | The ledger push and the energiebelasting account **[DEC-76]**, **[DEC-107]** |

## 10. Open questions

| Ref | Question |
| --- | --- |
| ~~[OQ-12]~~ | ~~Confirm that a "topup" is a €/MWh surcharge rather than a fixed fee or a scheduled deposit~~ **Closed by [DEC-35]** — a per-unit fee, in **€/kWh**. ~~The unit carries a precision consequence (F09-R11) and a migration (F09-R12)~~ **Stays closed, and now moot: [DEC-73] takes the topup out of the platform entirely**, so the precision consequence and the migration both disappear with it |
| ~~[OQ-36]~~ | ~~Is the surcharge applied to consumption only, or to all invoiced volume including surplus sales?~~ **CLOSED 2026-08-19 by [DEC-73]** — the surcharge leaves the platform, so there is no base to define. The bookkeeping program decides what volume it multiplies |
| ~~[OQ-86]~~ | ~~When a customer exports but no feed-in tariff resolves, is the export valued at zero or at the day-ahead price?~~ **CLOSED 2026-08-19 by [DEC-87]** — there is no feed-in tariff to fail to resolve. Export is credited **raw at the day-ahead price [DEC-23]**, which was one of the two candidates; the **€662,53** difference on the worked example disappears with the question |
| ~~[OQ-14]~~ | ~~Energiebelasting: tariff source and ownership, does the *vermindering* apply, do any customers hold exemptions or reduced rates?~~ **CLOSED 2026-08-19 by [DEC-74]** on scope, brackets and reductions — energiebelasting is **in**, with a versioned bracket table **F09-R18** and per-customer reductions **F09-R20**. The *vermindering* half is **not** answered and is handed on as **[OQ-96]** |
| ~~[OQ-77]~~ | ~~When an EAN transfers between customers mid-year, how is the annual energiebelasting tier applied?~~ **CLOSED 2026-08-19 by [DEC-74]** — **each period gets 50% of each bracket**, not a pro-rata by days **F09-R23**. §5.2 states what the simplification costs |
| **[OQ-96]** | 🟠 **Does the *vermindering* — the fixed annual reduction on energiebelasting — apply, and to which connections?** Registered 2026-08-19. **[DEC-74]** brings energiebelasting in with brackets and per-customer reductions and is silent on the *vermindering*, which was part of **[OQ-14]**'s original question. It is a **fixed annual credit per connection**, not a rate, so it changes the amount on **every affected invoice** and cannot be approximated by a bracket row. Two things are unknown: whether it applies at all to non-residential **grootverbruik** connections, and if it does, per which connections and pro-rated how across a mid-year transfer **F09-R23**. Owner: Finance / tax advisor. Nothing is implemented and nothing is defaulted until it is answered |
| ~~*(unnumbered)*~~ | ~~When a customer exports but no feed-in tariff resolves, is the export valued at zero or at the day-ahead price? **Needs a decision — see §11.1**~~ **Closed by [DEC-87]** — this was [OQ-86] under another name; §11.1 is obsolete |

## 11. ~~The feed-in tariff — the same mechanism~~ *(obsolete — [DEC-87])*

> ⚠ **Obsolete 2026-08-19. Retained as history, not as specification.**
> **[DEC-87]** withdraws the feed-in tariff and reverses the second half of **[DEC-44]**. Physically
> exported volume is credited **raw at the day-ahead price** for the interval, exactly as surplus is
> under **[DEC-23]**, with no topup and no feed-in fee on it. The first half of **[DEC-44]** — the
> day-ahead price used raw, with no spread — is **confirmed**. Nothing below is to be built:
> `billing.feed_in_tariff` is not created, `MISSING_FEED_IN_TARIFF` does not exist, and the month-skip
> it caused is deleted. **[F09-R14]…[F09-R17]** are struck in §3.

~~**[DEC-44]** makes feed-in its own invoice line category, settled at a per-customer feed-in tariff
rather than at the day-ahead price. That requires a per-customer, per-period reference-data table —
and the table PeakPower already has for the surcharge is exactly the right shape, so it is copied
rather than reinvented.~~

| Property | ~~Surcharge~~ | ~~Feed-in tariff~~ |
| --- | --- | --- |
| ~~Scope~~ | ~~`GLOBAL_DEFAULT` / `CUSTOMER` / `METERING_POINT`~~ | ~~Same~~ |
| ~~Resolution order~~ | ~~Customer-specific → global default → zero~~ | ~~Same — but see §11.1~~ |
| ~~Validity~~ | ~~Half-open `[from, to)`, no overlap per scope, DB exclusion constraint~~ | ~~Same~~ |
| ~~Unit~~ | ~~€/kWh **[DEC-35]**~~ | ~~€/kWh **[DEC-44]**~~ |
| ~~Precision~~ | ~~`numeric(12,7)`~~ | ~~`numeric(12,7)`~~ |
| ~~Sign~~ | ~~Negative = discount to the customer~~ | ~~Positive = credit to the customer~~ |
| ~~Per-interval application~~ | ~~Yes; a mid-month change is two lines, never a blend~~ | ~~Same~~ |
| ~~Snapshot on the invoice line~~ | ~~Yes~~ | ~~Yes~~ |
| ~~Retroactive edit into an invoiced period~~ | ~~Blocked~~ | ~~Blocked~~ |
| ~~Invoice line~~ | ~~4~~ — removed **[DEC-73]** | ~~**6**~~ — removed **[DEC-87]** |
| ~~Applied to~~ | ~~Net usage `Σ U`~~ | ~~Exported volume `Σ max(−U, 0)`~~ — now settled at day-ahead **[DEC-23]** |

~~**Why €/kWh for feed-in.** The argument is **[DEC-35]**'s and it transfers directly: this is a
per-unit rate on metered volume, agreed commercially per customer, and quoted to the customer in the
same conversation as the surcharge. Two customer rates on one invoice in two different units is a
defect waiting to be written, and the €/MWh reading of a €/kWh number is out by exactly the factor
that makes it look plausible. Market prices stay €/MWh.~~ *The unit argument itself survives — see §4
rule 6, where it now governs energiebelasting rates.*

### 11.1 ~~What [DEC-44] does not say~~ *(obsolete — [DEC-87])*

> ⚠ **Obsolete 2026-08-19.** **[OQ-86] is closed by [DEC-87]**: the fallback question disappears
> because there is no tariff left to fail to resolve. The **€662,53** the two candidates differed by
> is no longer at stake, and the "day-ahead as fallback" candidate is now simply the rule.
>
> ~~**The fallback when a customer exports and no feed-in tariff resolves is undecided.**
> The table above copies the surcharge's resolution order, which ends in **zero** — but the two cases
> are not equivalent, and copying the default here is a policy choice dressed as consistency. A
> missing surcharge bills nothing. A missing feed-in tariff means the customer's exported energy was
> taken and not paid for.~~
>
> | ~~Candidate~~ | ~~Argument for it~~ |
> | --- | --- |
> | ~~**Zero**~~ | ~~Consistency with the surcharge; nothing is owed that was not agreed~~ |
> | ~~**Day-ahead as fallback**~~ | ~~The behaviour before **[DEC-44]**, under **[DEC-23]**~~ — **this is now the rule [DEC-87]** |
>
> ~~They differ in money on every exporting site — **€662.53** on the single worked example in
> [Invoice calculation](../50-calculations/03-invoice-calculation.md) §7A.2, which is more than the
> credit actually invoiced there. **This needs a decision of its own, registered against [DEC-44].**~~
>
> ~~**Until it is answered**, the invoice run does not choose: a month with export and no resolving
> feed-in tariff is **skipped** with `MISSING_FEED_IN_TARIFF` **[F10-R39]**, and a month without
> export raises a warning only. Skipping is recoverable; a wrong credit on a finalised invoice is a
> credit note.~~ **Removed by [DEC-87]** — nothing is skipped, because nothing has to be chosen.
