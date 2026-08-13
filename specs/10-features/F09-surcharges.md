# F09 — Surcharges ("Topups")

**Portal:** employee · **Priority:** Must · **Phase:** 3 · **Size:** S

---

## 1. Summary

A per-**kWh** adder applied on top of the energy price, configured per customer and validity period
**[DEC-35]**. It is PeakPower's margin line on the invoice.

**[DEC-44] adds a second rate of exactly the same shape**: the **feed-in tariff**, the per-kWh rate at
which physically exported volume is credited on invoice line 6. It is not a surcharge and it is not
PeakPower's margin, but it is maintained by the same people, on the same screens, under the same
rules — so it lives in this feature rather than in one of its own. §11.

> ⚠ **The feature index has not caught up, and it is not this document's to change.**
> [10-features/README.md](README.md) still labels F09 "Surcharges (topups)" and counts its
> requirements as 7 Must / 2 Should / 1 Could. Under **[DEC-35]** and **[DEC-44]** the feature covers
> **both** per-customer rates and carries **F09-R01…R17** — 13 Must, 3 Should, 1 Could. The label and
> the counts need updating by that file's owner, along with the F09 row's dependency on F10 for the
> line-6 requirements **F10-R39…R42**.

> **Unit — [DEC-35].** Both rates are quoted and stored in **€/kWh**. This is deliberate and it is a
> change: every *market* price in the platform — block prices, day-ahead — remains **€/MWh**. The
> boundary is "market price" versus "customer rate", and it is the reason the invoice formula for
> these two lines has **no `/1000`** where every other line has one. See
> [Invoice calculation](../50-calculations/03-invoice-calculation.md) §6.1.

> **Naming.** The brief calls this a "topup". This specification calls it a **surcharge** in code,
> UI and documentation, because "top-up" is already the customer-facing word for putting money in the
> wallet, and both appear on the same screens. **[OQ-12] is closed by [DEC-35]**: a "topup per
> customer per period" is a per-unit fee, not a fixed periodic fee and not a scheduled wallet deposit.
> The feature stays volumetric and the tariff screens can be built.

## 2. User stories

| As a… | I want to… | So that… |
| --- | --- | --- |
| Finance | set a surcharge for a customer with a start and end date | the agreed margin is billed automatically |
| Finance | change a surcharge from a future date without touching past invoices | a renegotiation applies from when it was agreed |
| Finance | see the surcharge history for a customer | I can answer "what did we charge in March?" |
| Finance | set a default surcharge for new customers | I don't have to remember |
| Finance | set a feed-in tariff for a customer with a start and end date **[DEC-44]** | exported volume is credited at the agreed rate |
| Customer user | see the surcharge as a clear line on my invoice | the price I pay is explainable |
| Customer user | see what I was paid for the energy I exported, and at what rate | the credit is explainable too **[DEC-44]** |

## 3. Functional requirements

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F09-R01 | A surcharge has: scope (`GLOBAL_DEFAULT` or a specific customer), commodity, **`rate_eur_per_kwh` (signed, 7 decimals) [DEC-35]**, `valid_from`, `valid_to` (nullable = open-ended), and a note. The field was `rate_eur_per_mwh` at 4 decimals; **[DEC-35]** changes both the unit and the precision — see F09-R11 and §4 rule 6. | Must |
| F09-R02 | Validity periods are half-open `[from, to)`. Two surcharges with the same scope and commodity may not overlap — enforced by a database exclusion constraint. | Must |
| F09-R03 | Resolution order for a given customer, commodity and date: the customer-specific surcharge, else the global default, else zero. | Must |
| F09-R04 | A negative rate is permitted and represents a discount. | Must |
| F09-R05 | Surcharges are never edited retroactively into a period already invoiced. Changing history requires a credit note plus a re-issue **[F10](F10-invoicing-and-settlement.md)**. | Must |
| F09-R06 | Every create and change is audited with actor, timestamp and before/after values. | Must |
| F09-R07 | The invoice applies the surcharge per interval using the rate valid at that interval, so a mid-month change splits correctly. | Must |
| F09-R08 | Finance can preview the monetary effect of a surcharge change on the last full month's volumes before saving. | Should |
| F09-R09 | A surcharge can be scoped to a single metering point rather than the whole customer. | Should |
| F09-R10 | Multiple named surcharge components (e.g. "margin", "imbalance cover", "certificates") can be stacked and shown as separate invoice lines. | Could |
| F09-R11 | Rates are stored at **7 decimal places** in €/kWh. Four decimals resolve only to €0.10/MWh, a thousand times coarser than every other price in the platform; seven give €0.0000001/kWh = €0.0001/MWh, which is the granularity the €/MWh rate had before **[DEC-35]**. The required column type is **`numeric(12,7)`**, signed. | Must |
| F09-R12 | Migrating to **[DEC-35]** **divides every existing €/MWh rate by 1000** and widens the column in the same migration. A rate reinterpreted in place, or written into a 4-decimal column as €/kWh, is silently rounded on insert with no error to catch. | Must |
| F09-R13 | Every rate is displayed, entered and exported in **€/kWh** only. The equivalent €/MWh figure is never shown alongside it on an invoice line. | Must |
| F09-R14 | A **feed-in tariff [DEC-44]** has the same fields, the same validity and overlap rules, the same resolution order and the same audit as a surcharge, in a separate table with its own scope. It is signed; a positive rate credits the customer. | Must |
| F09-R15 | The invoice applies the feed-in tariff per interval using the rate valid at that interval, so a mid-month change splits into two lines rather than blending. | Must |
| F09-R16 | Feed-in tariffs are never edited retroactively into a period already invoiced; changing history requires a credit note plus a re-issue **[F10](F10-invoicing-and-settlement.md)**. | Must |
| F09-R17 | Finance can see, side by side for one customer and period, the surcharge and the feed-in tariff that will apply — they are agreed together and a mismatch in validity dates between them is a common and expensive error. | Should |

## 4. Business rules

1. **Time-bounded, non-overlapping, per scope.** The constraint lives in the database.
2. **Resolution is most-specific-wins**, evaluated per interval, not per invoice.
3. **The applied rate is snapshotted on the invoice line**, so re-reading an old invoice never
   depends on current reference data.
4. **A change is a new row.** Rates are never updated in place.
5. **Zero is a valid rate** and is distinct from "no surcharge configured" — both bill nothing, but
   only one is a deliberate statement.
6. **Customer rates are €/kWh; market prices are €/MWh [DEC-35].** The boundary is absolute and it is
   the reason the surcharge and feed-in formulas carry no `/1000`. Every rate field, label, column
   header, CSV column and API property carries its unit in its name.
7. **Both rates obey rules 1–5 identically [DEC-44].** The feed-in tariff is not a special case; it is
   a second instance of the same mechanism, and should be implemented as one — with one exception,
   rule 8.
8. **A missing feed-in tariff is not the same as a missing surcharge.** A missing surcharge bills
   nothing and costs the customer nothing. A missing feed-in tariff means exported energy was taken
   and not paid for. See §11.1 — this is an open question, not a settled default.

## 5. Worked example

Customer A: global default €0.0050/kWh. A customer-specific rate of €0.0045/kWh agreed from
15 August 2026. *(These are the same rates as before **[DEC-35]** — €5.00/MWh and €4.50/MWh — restated
in the unit they are now agreed and stored in.)*

| Period | Applicable rate | Source |
| --- | --- | --- |
| 1–14 August 2026 | €0.0050000/kWh | Global default |
| From 15 August 2026 | €0.0045000/kWh | Customer-specific |

The August invoice shows two surcharge lines, each with its own volume and rate — not one blended
rate. Blending hides the change and makes the invoice unverifiable. On 120 000 kWh and 180 000 kWh
respectively that is `120 000 × 0.0050 = €600.00` and `180 000 × 0.0045 = €810.00`, with **no
divisor**: the rate is per kWh and the volume is in kWh.

## 6. Data

| Entity | Purpose |
| --- | --- |
| `surcharge` | scope, scope_id, commodity, rate **`numeric(12,7)` €/kWh [DEC-35]**, valid_from, valid_to, note, created_by |
| `surcharge_audit` | Full change history |
| `feed_in_tariff` | **New [DEC-44].** Identical shape: scope, scope_id, commodity, rate **`numeric(12,7)` €/kWh**, validity, note, created_by |
| `feed_in_tariff_audit` | Full change history |

> ⚠ **The schema is owned by [Database design](../20-architecture/04-database-design.md) §3.6, not by
> this document.** Two changes are required there and must not be assumed done:
> `billing.surcharge.rate` migrates from `numeric(12,4)` to **`numeric(12,7)`** with the field renamed
> to reflect €/kWh **[DEC-35]**, and a new `billing.feed_in_tariff` table is added with the same
> columns, the same `daterange` **exclusion constraint** and the same audit companion **[DEC-44]**.

## 7. Edge cases

| Case | Behaviour |
| --- | --- |
| Overlapping periods entered | Rejected at save with the conflicting row shown |
| Gap between periods | Falls back to the global default for the gap; a warning is shown at save time |
| Change dated inside an already-invoiced month | Blocked, with a pointer to the credit-note route |
| No surcharge at all configured | Zero is applied and the invoice omits the line |
| Rate changes mid-interval | Impossible — validity is date-bounded, and an interval belongs to exactly one date |
| Rate entered in €/MWh out of habit | A €4.50 entry is 1000× the intended rate. The field is labelled **€/kWh**, and entry validates against a configurable plausibility band, warning rather than blocking — a legitimate rate outside the band must still be enterable **[DEC-35]** |
| Existing €/MWh rate read after migration | Impossible if **F09-R12** is honoured. If a rate is found outside the plausibility band after migration, treat it as an unconverted row and stop — do not invoice on it |
| No feed-in tariff configured and the site exported | ⚠ **Not decided — see §11.1.** The month is skipped with `MISSING_FEED_IN_TARIFF` rather than defaulted, so nothing is settled by accident |
| No feed-in tariff configured and the site did not export | Warning only; there is no volume for the line and no money at stake |

## 8. Out of scope

- Volume-tiered or capacity-based surcharges, and volume-tiered feed-in tariffs.
- Automatic indexation.
- Customer-visible surcharge or feed-in-tariff editing.

## 9. Dependencies

| Depends on | Why |
| --- | --- |
| [F10](F10-invoicing-and-settlement.md) | The only consumer, of both rates |
| [F01](F01-customer-and-metering-points.md) | Scope resolution |

## 10. Open questions

| Ref | Question |
| --- | --- |
| ~~[OQ-12]~~ | ~~Confirm that a "topup" is a €/MWh surcharge rather than a fixed fee or a scheduled deposit~~ **Closed by [DEC-35]** — a per-unit fee, in **€/kWh**. The unit carries a precision consequence (F09-R11) and a migration (F09-R12) |
| [OQ-36] | Is the surcharge applied to consumption only, or to all invoiced volume including surplus sales? Still open — and **[DEC-44]** sharpens it further, since invoiced volume now leaves by three doors rather than two |
| *(unnumbered)* | When a customer exports but no feed-in tariff resolves, is the export valued at zero or at the day-ahead price? **Needs a decision — see §11.1** |

## 11. The feed-in tariff — the same mechanism *([DEC-44])*

**[DEC-44]** makes feed-in its own invoice line category, settled at a per-customer feed-in tariff
rather than at the day-ahead price. That requires a per-customer, per-period reference-data table —
and the table PeakPower already has for the surcharge is exactly the right shape, so it is copied
rather than reinvented.

| Property | Surcharge | Feed-in tariff |
| --- | --- | --- |
| Scope | `GLOBAL_DEFAULT` / `CUSTOMER` / `METERING_POINT` | Same |
| Resolution order | Customer-specific → global default → zero | Same — but see §11.1 |
| Validity | Half-open `[from, to)`, no overlap per scope, DB exclusion constraint | Same |
| Unit | €/kWh **[DEC-35]** | €/kWh **[DEC-44]** |
| Precision | `numeric(12,7)` | `numeric(12,7)` |
| Sign | Negative = discount to the customer | Positive = credit to the customer |
| Per-interval application | Yes; a mid-month change is two lines, never a blend | Same |
| Snapshot on the invoice line | Yes | Yes |
| Retroactive edit into an invoiced period | Blocked | Blocked |
| Invoice line | 4 | **6** |
| Applied to | Net usage `Σ U` | Exported volume `Σ max(−U, 0)` |

**Why €/kWh for feed-in.** The argument is **[DEC-35]**'s and it transfers directly: this is a
per-unit rate on metered volume, agreed commercially per customer, and quoted to the customer in the
same conversation as the surcharge. Two customer rates on one invoice in two different units is a
defect waiting to be written, and the €/MWh reading of a €/kWh number is out by exactly the factor
that makes it look plausible. Market prices stay €/MWh.

### 11.1 What [DEC-44] does not say

> ⚠ **The fallback when a customer exports and no feed-in tariff resolves is undecided.**
> The table above copies the surcharge's resolution order, which ends in **zero** — but the two cases
> are not equivalent, and copying the default here is a policy choice dressed as consistency. A
> missing surcharge bills nothing. A missing feed-in tariff means the customer's exported energy was
> taken and not paid for.
>
> | Candidate | Argument for it |
> | --- | --- |
> | **Zero** | Consistency with the surcharge; nothing is owed that was not agreed |
> | **Day-ahead as fallback** | The behaviour before **[DEC-44]**, under **[DEC-23]**; arguably the neutral market price for energy delivered |
>
> They differ in money on every exporting site — **€662.53** on the single worked example in
> [Invoice calculation](../50-calculations/03-invoice-calculation.md) §7A.2, which is more than the
> credit actually invoiced there. **This needs a decision of its own, registered against [DEC-44].**
>
> **Until it is answered**, the invoice run does not choose: a month with export and no resolving
> feed-in tariff is **skipped** with `MISSING_FEED_IN_TARIFF` **[F10-R39]**, and a month without
> export raises a warning only. Skipping is recoverable; a wrong credit on a finalised invoice is a
> credit note.
