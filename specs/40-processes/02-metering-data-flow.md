# Process — Metering Data Flow

From a PVNed push to a number on a customer's chart and a line on an invoice.

Feature spec: [F02](../10-features/F02-metering-data-ingestion.md) ·
Integration: [PVNed](../30-integrations/01-pvned-timeseries.md).

---

## 1. End-to-end

```mermaid
flowchart TB
    P(["PVNed pushes<br/>TimeSeriesDocument"]) --> AUTH{"Authenticated?"}
    AUTH -->|no| R401["401 · log · alert"]
    AUTH -->|yes| SIZE{"Within<br/>size limit?"}
    SIZE -->|no| R413["413"]
    SIZE -->|yes| STORE["<b>Persist raw payload</b><br/>object storage + metadata row"]
    STORE --> DUP{"Duplicate hash<br/>within 24 h?"}
    DUP -->|yes| MARKDUP["Mark DUPLICATE"] --> ACK
    DUP -->|no| ENQ["Enqueue<br/>ProcessTimeSeriesDocument"]
    ENQ --> ACK["<b>200 OK to PVNed</b><br/>target &lt; 1 s"]

    ENQ -.->|"async"| XSD{"XSD valid?"}
    XSD -->|no| FAIL1["FAILED · reason · alert"]
    XSD -->|yes| SEM{"Semantically<br/>valid?"}
    SEM -->|no| FAIL2["FAILED · reason · alert"]
    SEM -->|yes| TYPE{"Document<br/>type"}

    TYPE -->|"A23 allocation"| RES{"EAN resolves to a<br/>metering point valid<br/>on that date?"}
    TYPE -->|"A12 imbalance"| IMB["Store portfolio-level<br/>imbalance series"]

    RES -->|no| QUAR["Quarantine · alert<br/><i>never discarded</i>"]
    RES -->|yes| VER["Create interval data version<br/>supersede the previous current"]

    VER --> ROLL["Rebuild daily rollup"]
    IMB --> ROLL2["Rebuild imbalance aggregates"]
    ROLL --> INVCHK{"Does this date fall in a<br/><b>finalised</b> invoice?"}
    INVCHK -->|yes| FLAG["Flag invoice<br/>AFFECTED_BY_CORRECTION"]
    INVCHK -->|no| DONE
    FLAG --> DONE(["PROCESSED"])
    ROLL2 --> DONE

    classDef bad fill:#7f1d1d,stroke:#dc2626,color:#fff
    classDef warn fill:#78350f,stroke:#f59e0b,color:#fff
    class R401,R413,FAIL1,FAIL2 bad
    class QUAR,FLAG warn
```

**The acknowledgement happens before any business processing** **[DEC-03]**. PVNed's retry behaviour
is triggered by a non-2xx, so a slow or failing parse must never be visible to it — otherwise a bug
in the platform turns into a flood of redeliveries.

## 2. Version lifecycle for one delivery date

```mermaid
sequenceDiagram
    autonumber
    participant P as PVNed
    participant PL as Platform
    participant C as Customer view

    Note over P,C: Delivery date: Wed 12 Aug 2026

    P->>PL: 13 Aug 09:14 — document v1 (96 points)
    PL->>PL: version 1 → current · state PROVISIONAL
    PL->>C: chart shows data, labelled provisional

    P->>PL: 15 Aug 11:02 — corrected document (96 points)
    PL->>PL: version 2 → current · version 1 superseded
    PL->>PL: rebuild rollups
    PL->>C: chart updates, "corrected on 15 Aug"

    Note over PL: 27 Aug — 10 working days elapsed
    PL->>PL: state → FINAL
    PL->>C: figures no longer labelled provisional

    P->>PL: 4 Sep 08:30 — late correction
    PL->>PL: version 3 → current · state back to PROVISIONAL
    PL->>PL: August invoice flagged AFFECTED_BY_CORRECTION
    PL->>C: chart updates, invoice notes a pending correction
```

The last step is the one that matters commercially: a correction after invoicing does **not** change
the invoice. It is captured and settled through the
[annual true-up](05-annual-true-up.md) **[F02-R20]**.

## 3. Data state transitions

```mermaid
stateDiagram-v2
    [*] --> NO_DATA
    NO_DATA --> PARTIAL: incomplete day received
    NO_DATA --> PROVISIONAL: complete day received
    PARTIAL --> PROVISIONAL: completing document
    PROVISIONAL --> PROVISIONAL: correction
    PROVISIONAL --> FINAL: 10 working days, no newer version
    FINAL --> PROVISIONAL: late correction
```

| State | Chart | KPI | Invoicing |
| --- | --- | --- | --- |
| `NO_DATA` | Gap | Excluded | Blocks the run |
| `PARTIAL` | Gap for missing intervals, marked | Flagged | Blocks the run |
| `PROVISIONAL` | Normal | Labelled provisional | **Allowed**, disclosed on the invoice |
| `FINAL` | Normal | Clean | Allowed |

## 4. Expected arrival pattern

```mermaid
gantt
    title Data availability for delivery date D
    dateFormat YYYY-MM-DD
    axisFormat D+%d

    section Delivery
    Delivery date D            :milestone, 2026-08-12, 0d

    section Arrival
    First data (D+1)           :crit, a1, 2026-08-13, 1d
    Correction window          :active, a2, 2026-08-13, 14d
    Finalised (10 working days):milestone, 2026-08-27, 0d

    section Invoicing
    Month closes               :milestone, 2026-08-31, 0d
    Invoice run (5th)          :b1, 2026-09-05, 1d
```

Note the overlap: for a delivery date near the end of the month, the correction window is still open
when the invoice run starts. **This is why invoicing on provisional data with an annual true-up is
the design**, rather than waiting for every date to finalise — waiting would push invoicing to
mid-month at best.

## 5. Monitoring

| Check | Frequency | Alert |
| --- | --- | --- |
| Any PVNed message received | Hourly | No message in 6 h during the expected window → **P1** |
| Per-metering-point silence | Daily 10:00 | No data for 3 days → P2 |
| Failed messages | Continuous | Any → P2, immediate for a burst |
| Quarantined series | Daily | Any outstanding → P2 |
| Volume anomaly | Per document | Deviation beyond a configured factor from the trailing average → P2, does not block |
| Processing lag | Continuous | p95 > 5 min → P2 |

The volume anomaly check is the one that catches a technically valid document containing wrong data —
the failure mode that no schema can detect.

## 6. Recovery

| Situation | Action |
| --- | --- |
| Message failed on a platform bug | Fix, then replay from the raw store. Idempotent |
| Unknown EAN | Register the metering point, then resolve the quarantine entry — the same replay path |
| Rollups inconsistent | Trigger a rebuild for a metering point and date range; no replay needed |
| Whole day missing and PVNed cannot resend | Employee-entered data, flagged as manual, surfaced on every derived figure and invoice **[OQ-75]** |
| Bulk backfill after an outage | Batched replay with progress reporting; ingestion queue scales out |
