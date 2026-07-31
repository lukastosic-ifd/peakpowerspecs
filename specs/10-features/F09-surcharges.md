# F09 — Surcharges ("Topups")

**Portal:** employee · **Priority:** Must · **Phase:** 3 · **Size:** S

---

## 1. Summary

A per-MWh adder applied on top of the energy price, configured per customer and validity period. It
is PeakPower's margin line on the invoice.

> **Naming.** The brief calls this a "topup". This specification calls it a **surcharge** in code,
> UI and documentation, because "top-up" is already the customer-facing word for putting money in the
> wallet, and both appear on the same screens. **[OQ-12]** should confirm that a "topup per customer
> per period" is indeed a €/MWh adder — the alternative readings are a fixed periodic fee or a
> scheduled wallet deposit, and each would change this feature substantially.

## 2. User stories

| As a… | I want to… | So that… |
| --- | --- | --- |
| Finance | set a surcharge for a customer with a start and end date | the agreed margin is billed automatically |
| Finance | change a surcharge from a future date without touching past invoices | a renegotiation applies from when it was agreed |
| Finance | see the surcharge history for a customer | I can answer "what did we charge in March?" |
| Finance | set a default surcharge for new customers | I don't have to remember |
| Customer user | see the surcharge as a clear line on my invoice | the price I pay is explainable |

## 3. Functional requirements

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F09-R01 | A surcharge has: scope (`GLOBAL_DEFAULT` or a specific customer), commodity, `rate_eur_per_mwh` (signed, 4 decimals), `valid_from`, `valid_to` (nullable = open-ended), and a note. | Must |
| F09-R02 | Validity periods are half-open `[from, to)`. Two surcharges with the same scope and commodity may not overlap — enforced by a database exclusion constraint. | Must |
| F09-R03 | Resolution order for a given customer, commodity and date: the customer-specific surcharge, else the global default, else zero. | Must |
| F09-R04 | A negative rate is permitted and represents a discount. | Must |
| F09-R05 | Surcharges are never edited retroactively into a period already invoiced. Changing history requires a credit note plus a re-issue **[F10](F10-invoicing-and-settlement.md)**. | Must |
| F09-R06 | Every create and change is audited with actor, timestamp and before/after values. | Must |
| F09-R07 | The invoice applies the surcharge per interval using the rate valid at that interval, so a mid-month change splits correctly. | Must |
| F09-R08 | Finance can preview the monetary effect of a surcharge change on the last full month's volumes before saving. | Should |
| F09-R09 | A surcharge can be scoped to a single metering point rather than the whole customer. | Should |
| F09-R10 | Multiple named surcharge components (e.g. "margin", "imbalance cover", "certificates") can be stacked and shown as separate invoice lines. | Could |

## 4. Business rules

1. **Time-bounded, non-overlapping, per scope.** The constraint lives in the database.
2. **Resolution is most-specific-wins**, evaluated per interval, not per invoice.
3. **The applied rate is snapshotted on the invoice line**, so re-reading an old invoice never
   depends on current reference data.
4. **A change is a new row.** Rates are never updated in place.
5. **Zero is a valid rate** and is distinct from "no surcharge configured" — both bill nothing, but
   only one is a deliberate statement.

## 5. Worked example

Customer A: global default €5.00/MWh. A customer-specific rate of €4.50/MWh agreed from 15 August 2026.

| Period | Applicable rate | Source |
| --- | --- | --- |
| 1–14 August 2026 | €5.0000/MWh | Global default |
| From 15 August 2026 | €4.5000/MWh | Customer-specific |

The August invoice shows two surcharge lines, each with its own volume and rate — not one blended
rate. Blending hides the change and makes the invoice unverifiable.

## 6. Data

| Entity | Purpose |
| --- | --- |
| `surcharge` | scope, scope_id, commodity, rate, valid_from, valid_to, note, created_by |
| `surcharge_audit` | Full change history |

## 7. Edge cases

| Case | Behaviour |
| --- | --- |
| Overlapping periods entered | Rejected at save with the conflicting row shown |
| Gap between periods | Falls back to the global default for the gap; a warning is shown at save time |
| Change dated inside an already-invoiced month | Blocked, with a pointer to the credit-note route |
| No surcharge at all configured | Zero is applied and the invoice omits the line |
| Rate changes mid-interval | Impossible — validity is date-bounded, and an interval belongs to exactly one date |

## 8. Out of scope

- Volume-tiered or capacity-based surcharges.
- Automatic indexation.
- Customer-visible surcharge editing.

## 9. Dependencies

| Depends on | Why |
| --- | --- |
| [F10](F10-invoicing-and-settlement.md) | The only consumer |
| [F01](F01-customer-and-metering-points.md) | Scope resolution |

## 10. Open questions

| Ref | Question |
| --- | --- |
| [OQ-12] | Confirm that a "topup" is a €/MWh surcharge rather than a fixed fee or a scheduled deposit |
| [OQ-36] | Is the surcharge applied to consumption only, or to all invoiced volume including surplus sales? |
