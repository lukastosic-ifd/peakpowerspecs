# Process — Annual True-Up

Each January, settle the preceding calendar year against final data.

Feature spec: [F10](../10-features/F10-invoicing-and-settlement.md) §Annual true-up ·
Arithmetic: [Invoice calculation](../50-calculations/03-invoice-calculation.md) §9.

---

## 1. Why it exists

Two independent reasons, both of which would require a true-up on their own.

```mermaid
flowchart TB
    R1["<b>1 · Energiebelasting is annual</b><br/>Degressive tiers apply to the<br/>calendar-year volume per EAN.<br/>Monthly charges are the best<br/>estimate at the time."]
    R2["<b>2 · Data keeps changing</b><br/>PVNed corrects for 10 working days;<br/>reconciliation can move volumes later.<br/>A December correction changes<br/>which tier the whole year sits in."]
    R1 --> T["<b>Annual true-up</b><br/>recompute on final full-year data,<br/>invoice or credit the delta"]
    R2 --> T
```

The second reason is the compounding one: a late correction to a single day in March does not just
change March — it shifts the annual volume, which can shift the tier boundary crossing, which changes
the tax attribution of *every* subsequent month.

## 2. The run

```mermaid
flowchart TB
    T(["Trigger — 20 January, or manual"]) --> LOOP["For each customer active in year Y"]
    LOOP --> GATE{"All delivery dates in Y<br/><b>FINAL</b> for every<br/>metering point?"}
    GATE -->|no| SKIP["Skip · DATA_NOT_FINAL<br/>list the outstanding dates"]
    GATE -->|yes| PRICE{"Day-ahead prices<br/>complete for Y?"}
    PRICE -->|no| SKIP2["Skip · MISSING_DAY_AHEAD_PRICE"]
    PRICE -->|yes| RECALC

    RECALC["Recompute for the whole year, per EAN:<br/>• block energy<br/>• spot settlement<br/>• imbalance<br/>• surcharge<br/>• <b>energiebelasting on the final annual volume</b>"]
    RECALC --> SUM["Sum what was already invoiced<br/>across the twelve monthly invoices"]
    SUM --> DELTA["delta = recomputed − invoiced<br/>per component, per EAN"]
    DELTA --> ZERO{"Any delta beyond<br/>the materiality threshold?"}
    ZERO -->|no| STMT["Statement only<br/>no financial document"]
    ZERO -->|"yes, positive"| INV["Correction <b>invoice</b>"]
    ZERO -->|"yes, negative"| CN["<b>Credit note</b>"]

    INV --> REVIEW["Finance review"]
    CN --> REVIEW
    STMT --> NEXT
    REVIEW --> FINAL["Finalise · push to Odoo · settle on wallet"]
    FINAL --> NEXT{"More customers?"}
    SKIP --> NEXT
    SKIP2 --> NEXT
    NEXT -->|yes| LOOP
    NEXT -->|no| REPORT(["Run report"])

    classDef warn fill:#78350f,stroke:#f59e0b,color:#fff
    class SKIP,SKIP2 warn
```

**The finality gate is the point of the whole run.** Producing a true-up on data that can still
change would require a true-up of the true-up. A customer failing the gate is skipped with a list of
the outstanding dates and re-run later — 20 January is a default, not a deadline.

## 3. Timing

```mermaid
gantt
    title True-up for calendar year 2026
    dateFormat YYYY-MM-DD
    axisFormat %b %Y

    section Year 2026
    Delivery + monthly invoicing   :done, 2026-01-01, 365d

    section Finalisation
    December data arrives          :2027-01-01, 5d
    December correction window     :active, 2027-01-01, 20d
    All 2026 dates FINAL           :milestone, 2027-01-20, 0d

    section True-up
    True-up run                    :crit, 2027-01-20, 3d
    Finance review                 :2027-01-23, 5d
    Finalise + settle              :crit, milestone, 2027-01-28, 0d
```

## 4. What is recomputed

| Component | Recomputed? | Why |
| --- | --- | --- |
| **Energiebelasting** | **Always** | The tiers are an annual construct — this is the primary purpose |
| Block energy | If any input changed | Blocks rarely change, but a corrected calendar or a late failed-trade reversal would |
| Spot settlement | If interval data or prices changed | The most common source of a delta |
| Imbalance | If imbalance data or the allocation basis changed | |
| Surcharge | If volumes changed | Volumetric, so it moves with consumption |
| VAT | Always, on the recomputed base | |

## 5. Presentation

The correction document carries **only the deltas**, with a supporting statement showing the working.
A summary section per metering point:

| Component | Invoiced during 2026 | Recomputed | Delta |
| --- | --: | --: | --: |
| Block energy | €248 312.44 | €248 312.44 | €0.00 |
| Day-ahead purchases | €91 204.18 | €92 887.05 | **+€1 682.87** |
| Day-ahead sales | −€18 442.90 | −€18 901.33 | **−€458.43** |
| Imbalance | €4 918.22 | €5 002.71 | **+€84.49** |
| Surcharge | €19 483.60 | €19 561.85 | **+€78.25** |
| Energiebelasting | €—  | €— | **[OQ-14]** |
| **Subtotal delta** | | | **+€1 387.18** |

Alongside it, a per-month comparison of the volume that changed, so a customer can see *which* month
moved and by how much. "Your annual bill changed by €1 387" without that breakdown is an invitation
to a long phone call.

## 6. Materiality threshold

A delta below a configurable threshold (default **€25**) produces a statement, not a financial
document **[F10-R33]**. Issuing a €0.40 credit note costs more in processing on both sides than the
amount involved.

The threshold is per customer per year, applied to the absolute total delta, and the statement
records the amount waived so it is visible rather than silently dropped. **[OQ-76]** confirms the
threshold and whether waived amounts should accumulate.

## 7. Interaction with monthly invoices

```mermaid
flowchart LR
    M1["Jan 2026<br/>invoice"] --> KEEP
    M2["Feb 2026<br/>invoice"] --> KEEP
    MX["…"] --> KEEP
    M12["Dec 2026<br/>invoice"] --> KEEP
    KEEP["<b>All twelve stay exactly as issued</b><br/>never modified, never cancelled"]
    KEEP --> TU["Annual correction document<br/>carries only the deltas"]
    TU --> LEDGER["One wallet entry<br/>debit or credit"]
```

This keeps the accounting trail linear: twelve invoices plus one correction, rather than twelve
invoices replaced by twelve new ones **[F10-R32]**.

## 8. Edge cases

| Case | Behaviour |
| --- | --- |
| Customer joined mid-year | True-up covers only their active period; tiers apply to their actual volume, which may put them in a higher tier band |
| Customer left mid-year | True-up produced on closure rather than in January; final settlement, then the wallet is refunded or the debt pursued **[OQ-30]** |
| EAN transferred between customers mid-year | Each customer's tier calculation uses only their own period's volume. **Whether that is the correct fiscal treatment is [OQ-77]** — the tax is levied per connection per year, which may mean the two periods should be considered together |
| An EAN with zero consumption all year | Appears with zero deltas; no document |
| Tax tariff for the year was revised retroactively | Recompute uses the current tariff version; the delta captures the difference. The statement names the tariff version used |
| Customer disputes the correction | Full working is available: per-month deltas, per-component, with links to the underlying interval versions |
| Data still not final in March | Customer remains skipped; a standing alert lists them until resolved |

## 9. Monitoring

| Check | Alert |
| --- | --- |
| True-up run did not start by 31 January | **P1** |
| Customers skipped for non-final data | P2, with the list |
| Delta above a large threshold (default €10 000) | P2 — review before finalising |
| Delta with the opposite sign to expectation | P2 |
| Any customer without a true-up by 28 February | **P1** |
