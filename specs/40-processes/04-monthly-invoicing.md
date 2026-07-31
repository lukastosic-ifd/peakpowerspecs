# Process — Monthly Invoicing

The month-close run. Feature spec: [F10](../10-features/F10-invoicing-and-settlement.md) ·
Arithmetic: [Invoice calculation](../50-calculations/03-invoice-calculation.md).

---

## 1. Calendar

```mermaid
gantt
    title Invoicing August 2026
    dateFormat YYYY-MM-DD
    axisFormat %d %b

    section Delivery
    August delivery month        :done, 2026-08-01, 31d

    section Data
    Data arrival (D+1 each day)  :active, 2026-08-02, 31d
    Correction window for 31 Aug :2026-09-01, 14d

    section Run
    Invoice run                  :crit, milestone, 2026-09-05, 0d
    Finance review               :2026-09-05, 2d
    Finalise + push + settle     :crit, milestone, 2026-09-07, 0d
```

The correction window for the last days of August is still open on the 5th of September. Running
anyway, disclosing provisional dates, and correcting through the
[annual true-up](05-annual-true-up.md) is the deliberate trade-off **[OQ-56]**.

## 2. The run

```mermaid
flowchart TB
    T(["Trigger — scheduled 5th 02:00,<br/>or manual"]) --> LOCK{"Another run for<br/>this period?"}
    LOCK -->|yes| REFUSE["Refused"]
    LOCK -->|no| SNAP["Snapshot reference data versions:<br/>calendars · tariffs · surcharges"]
    SNAP --> LOOP["For each customer in scope"]

    LOOP --> GATE{"Pre-flight gate"}
    GATE -->|"missing metering data"| SKIP1["Skip · MISSING_METERING_DATA"]
    GATE -->|"incomplete day"| SKIP2["Skip · INCOMPLETE_METERING_DATA"]
    GATE -->|"missing day-ahead price"| SKIP3["Skip · MISSING_DAY_AHEAD_PRICE"]
    GATE -->|"missing imbalance"| SKIP4["Skip · MISSING_IMBALANCE_DATA"]
    GATE -->|"no tax tariff"| SKIP5["Skip · MISSING_TAX_TARIFF"]
    GATE -->|pass| CALC

    CALC["For each metering point:<br/>1 block energy · 2 spot<br/>3 imbalance · 4 surcharge<br/>5 energiebelasting"]
    CALC --> IDENT{"Volume identity<br/>reconciles to<br/>±0.001 MWh?"}
    IDENT -->|no| ERR["<b>Calculation halted</b><br/>for this customer · alert"]
    IDENT -->|yes| TOT["Totals · VAT"]
    TOT --> DRAFT["DRAFT invoice created"]

    DRAFT --> NEXT{"More<br/>customers?"}
    SKIP1 --> NEXT
    SKIP2 --> NEXT
    SKIP3 --> NEXT
    SKIP4 --> NEXT
    SKIP5 --> NEXT
    ERR --> NEXT
    NEXT -->|yes| LOOP
    NEXT -->|no| REPORT(["Run report:<br/>drafted · skipped · failed"])

    classDef bad fill:#7f1d1d,stroke:#dc2626,color:#fff
    classDef warn fill:#78350f,stroke:#f59e0b,color:#fff
    class ERR,REFUSE bad
    class SKIP1,SKIP2,SKIP3,SKIP4,SKIP5 warn
```

Two properties make this run safe to re-run at will: **reference data is snapshotted at the start**,
so a mid-run change cannot produce two customers billed on different rules; and **a skip is per
customer**, so one customer's missing data never stops the other forty-nine.

## 3. The volume identity

Asserted per metering point before a draft is created:

```
Σ block volume  +  Σ day-ahead purchases  −  Σ day-ahead sales  =  measured consumption
```

within 0.001 MWh. If it fails, something is wrong in coverage, in the calendar, or in the interval
data — and the calculation stops rather than producing a plausible-looking wrong invoice. The
identity is also printed on the invoice, so the customer can perform the same check.

This one assertion is the cheapest available detector of a whole class of bugs, which is why it is a
hard failure and not a warning.

## 4. Review and finalisation

```mermaid
sequenceDiagram
    autonumber
    actor F as Finance
    participant P as Platform
    participant O as Odoo
    participant W as Wallet
    actor C as Customer

    P->>F: run report — 47 drafted, 3 skipped
    F->>P: investigate the 3 skips
    Note over F,P: two awaiting metering data, one missing a day-ahead price
    F->>P: fix causes, re-run for those customers
    P->>F: 50 drafts

    F->>P: review drafts, spot-check lines
    F->>P: finalise (bulk)
    P->>P: assign gapless numbers · render PDFs

    par Accounting
        P->>O: push invoices
        O-->>P: move references
    and Settlement
        P->>W: INVOICE_DEBIT per customer
        W-->>P: balances updated
    end

    P->>C: notify — invoice available
    Note over P,W: any wallet going negative raises an alert<br/>and blocks trading for that customer
```

The two branches are independent **[F10-R19]**. An Odoo outage delays accounting; it does not delay
settlement, and it does not delay the customer seeing their invoice.

## 5. Skip reasons and their fixes

| Reason | Meaning | Fix | Typical delay |
| --- | --- | --- | --- |
| `MISSING_METERING_DATA` | A delivery date has no data for an active metering point | Chase PVNed; replay a quarantined message | Hours to days |
| `INCOMPLETE_METERING_DATA` | A day is `PARTIAL` | Await the completing document | Days |
| `MISSING_DAY_AHEAD_PRICE` | Gap in the curve | Re-fetch, or manual entry with a flag **[F08-R10]** | Minutes |
| `MISSING_IMBALANCE_DATA` | No imbalance report for the month | Chase PVNed | Days |
| `MISSING_TAX_TARIFF` | No energiebelasting tariff for the year | Admin loads the tariff | Minutes |
| `MISSING_SURCHARGE` | No rate resolves — **warning only** | Configure, or accept zero | Minutes |
| `OPEN_TRADE_IN_PERIOD` | A trade for the period is still non-terminal — **warning only** | Resolve the trade | Hours |

## 6. Wallet settlement outcomes

```mermaid
flowchart LR
    A["Invoice finalised<br/>€34 397.48"] --> B{"Available<br/>balance"}
    B -->|"≥ total"| C["Debited<br/>balance positive"]
    B -->|"< total"| D["Debited anyway<br/><b>balance negative</b>"]
    C --> E(["SETTLED"])
    D --> F["Alert raised<br/>trading blocked<br/>customer notified"]
    F --> G["Customer tops up"]
    G --> H["Balance restored<br/>trading unblocked"]

    classDef warn fill:#78350f,stroke:#f59e0b,color:#fff
    class D,F warn
```

This is the **[OQ-19]** behaviour: full debit into negative rather than partial settlement. The debt
is real either way; carrying it in the wallet keeps one number authoritative instead of splitting it
between the wallet and a receivable.

## 7. Corrections

| Situation | Route |
| --- | --- |
| Error found in a **draft** | Recalculate |
| Error found after **finalisation** | Credit note + new invoice |
| Metering correction after finalisation | Flagged, settled in the [annual true-up](05-annual-true-up.md) |
| Wrong surcharge applied | Credit note + new invoice |
| Wrong tax tariff loaded | Credit note + new invoice for every affected customer — which is why editing a used tariff is blocked **[F12-R20]** |

## 8. Monitoring

| Check | Alert |
| --- | --- |
| Run did not start on schedule | **P1** |
| Run failed | **P1** |
| Run duration > 60 min | P2 |
| Skipped customers > 10% | P2 |
| Volume identity failure | **P1** — indicates a calculation defect |
| Drafts unreviewed after 3 days | P2 |
| Odoo push failing > 3 attempts | P2 |
| Wallet negative after settlement | P2 per customer |
