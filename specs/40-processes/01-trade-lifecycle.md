# Process — Trade Lifecycle

End-to-end, from a customer noticing an exposure to a confirmed position on the chart.

Feature spec: [F05](../10-features/F05-energy-block-trading.md).

---

## 1. The whole process

```mermaid
flowchart TB
    subgraph cust["Customer company — any account may act"]
        A1["Reviews consumption chart<br/>and coverage"]
        A2["Checks price indications"]
        A3["Composes request:<br/>shape · period · MW per EAN"]
        A4{"Wallet<br/>sufficient?"}
        A5["Tops up wallet"]
        A6["Submits request"]
        A7{"Respond to<br/>offer<br/><i>any account</i>"}
        A8["Accepts →<br/>funds reserved"]
    end

    subgraph pp["PeakPower"]
        B1["Request appears<br/>on the trade desk"]
        B2["Trader reviews:<br/>position · wallet · indication"]
        B3{"Price it?"}
        B4["Obtains executable<br/>price from the market"]
        B5["Publishes offer<br/>price + reaction window"]
        B6["Appears in<br/>'to confirm'"]
        B7["Executes with<br/>the counterparty"]
        B8{"Execution<br/>succeeded?"}
        B9["Confirms →<br/>reservation settled"]
        B10["Marks failed + reason →<br/>reservation released"]
        B11["Declines + reason"]
    end

    subgraph sys["Platform"]
        C1["Captures the current<br/>price indication"]
        C2["Timer runs;<br/>server owns expiry"]
        C3["Expires the offer"]
        C4["Creates the block<br/>and its allocations"]
        C5["Block appears on<br/>the chart"]
    end

    A1 --> A2 --> A3 --> A4
    A4 -->|no| A5 --> A3
    A4 -->|yes| A6 --> C1 --> B1
    B1 --> B2 --> B3
    B3 -->|no| B11
    B3 -->|yes| B4 --> B5 --> C2
    C2 --> A7
    C2 -->|"window elapses"| C3
    A7 -->|reject| END1(["Rejected"])
    A7 -->|accept| A8 --> B6
    B6 --> B7 --> B8
    B8 -->|no| B10 --> END2(["Failed"])
    B8 -->|yes| B9 --> C4 --> C5 --> END3(["Confirmed"])

    classDef good fill:#14532d,stroke:#22c55e,color:#fff
    classDef bad fill:#7f1d1d,stroke:#dc2626,color:#fff
    class END3 good
    class END1,END2 bad
```

## 2. State machine

```mermaid
stateDiagram-v2
    direction LR
    [*] --> DRAFT
    DRAFT --> REQUESTED: submit
    DRAFT --> [*]: discard

    REQUESTED --> CANCELLED: customer cancels
    REQUESTED --> DECLINED: trader declines (reason)
    REQUESTED --> OFFERED: trader offers

    OFFERED --> REJECTED: customer rejects
    OFFERED --> EXPIRED: window elapses
    OFFERED --> WITHDRAWN: trader withdraws (reason)
    OFFERED --> ACCEPTED: customer accepts → reserve

    ACCEPTED --> CONFIRMED: trader confirms → settle
    ACCEPTED --> FAILED: trader fails (reason) → release

    CONFIRMED --> [*]
    CANCELLED --> [*]
    DECLINED --> [*]
    REJECTED --> [*]
    EXPIRED --> [*]
    WITHDRAWN --> [*]
    FAILED --> [*]
```

## 3. Timing

```mermaid
gantt
    title Target timings for one trade
    dateFormat HH:mm
    axisFormat %H:%M

    section Customer
    Composes request      :a1, 14:15, 10m
    Reads offer, decides  :a2, 14:32, 12m

    section PeakPower
    Request in queue      :crit, b1, 14:25, 3m
    Trader prices it      :b2, 14:28, 4m
    Reaction window open  :active, b3, 14:32, 30m
    Executes on market    :b4, 14:44, 8m
    Confirms              :b5, 14:52, 3m
```

| Interval | Target | Alert |
| --- | --- | --- |
| Request → offer | median **< 30 min** | Request unpriced after 60 min |
| Offer → customer response | within the window, default 30 min | Notification at T−5 min |
| Acceptance → confirmation | median **< 30 min** | Escalation after 4 h **[F05-R39]** |

## 4. Money at each step

```mermaid
flowchart LR
    S1["REQUESTED<br/><i>nothing held</i>"]
    S2["OFFERED<br/><i>nothing held</i>"]
    S3["ACCEPTED<br/><b>reserved</b><br/>available ↓"]
    S4["CONFIRMED<br/><b>settled</b><br/>settled ↓"]
    S5["FAILED<br/><b>released</b><br/>available restored"]

    S1 --> S2 --> S3
    S3 --> S4
    S3 --> S5

    style S3 fill:#78350f,stroke:#f59e0b,color:#fff
    style S4 fill:#14532d,stroke:#22c55e,color:#fff
    style S5 fill:#7f1d1d,stroke:#dc2626,color:#fff
```

Ledger entries produced: `TRADE_RESERVED` on acceptance, then either `TRADE_SETTLED`
(or `TRADE_PROCEEDS` for a sell) on confirmation, or `TRADE_RESERVATION_RELEASED` on failure.

## 5. The two dangerous moments

### 5.1 Acceptance at the expiry boundary

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant API as Customer API
    participant DB as Database
    participant JOB as Expiry job

    Note over C,JOB: expires_at = 15:01:00 — C is any account of the company

    par Customer accepts at 15:00:59.8
        C->>API: POST /trades/{id}/accept
        API->>DB: BEGIN
        API->>DB: SELECT wallet FOR UPDATE
        API->>DB: SELECT trade FOR UPDATE
        API->>API: guard: now (15:00:59.9) < expires_at ✓
        API->>DB: insert reservation, state = ACCEPTED
        API->>DB: COMMIT
        API-->>C: 200 accepted
    and Expiry job fires at 15:01:00
        JOB->>DB: BEGIN
        JOB->>DB: SELECT trade FOR UPDATE (waits for the lock)
        JOB->>JOB: state is ACCEPTED, not OFFERED → no-op
        JOB->>DB: COMMIT
    end
```

Row-level locking makes the race a queue. Whichever transaction takes the lock first decides; the
second observes the resulting state and does nothing. There is no window in which both succeed.

### 5.2 Confirmation

Wallet and trade change together, in one transaction, with a fixed lock order — **wallet first, then
trade** ([Database design](../20-architecture/04-database-design.md) §5). A partially applied
confirmation is not a state the system can reach.

## 6. Failure paths

| Path | Trigger | Money | Customer sees |
| --- | --- | --- | --- |
| Cancelled | Customer, before pricing | — | Cancelled |
| Declined | Trader will not price it | — | Declined + reason |
| Rejected | Customer says no | — | Rejected |
| Expired | Window elapsed | — | Expired |
| Withdrawn | Trader pulls the offer | — | Withdrawn + reason |
| Failed | Execution failed after acceptance | **Released in full** | Failed + reason |

Every PeakPower-initiated negative outcome carries a mandatory reason that the customer reads
**[F05-R38]**.

## 7. Notifications

| Moment | To | Channel |
| --- | --- | --- |
| Request submitted | Traders | In-app (real-time) + email |
| Offer published | **Every active account** of the company | In-app (real-time) + email — **immediate** |
| 5 minutes remaining | Every active account | In-app + email |
| Offer expired | Every active account, traders | In-app + email |
| Accepted | Traders | In-app (real-time) |
| Confirmed | Every active account | In-app + email |
| Failed | Every active account | In-app + email — **immediate** |
| Unconfirmed > 4 h | Traders | In-app escalation |

Offers go to everyone who could answer them, not only to the person who asked — see
[F11 §2](../10-features/F11-notifications.md) and **[OQ-81]**.

## 8. Audit output

Every transition appends a `trade_event`. A complete history for a typical trade:

| # | Event | Actor | Recorded |
| --: | --- | --- | --- |
| 1 | `SUBMITTED` | Customer account — **J. de Vries** *(Energy Manager)* | Volumes per EAN, comment, captured indication |
| 2 | `OFFERED` | Employee — M. Bakker | Price, reaction window, expiry |
| 3 | `ACCEPTED` | Customer account — **M. Vandersteen** *(Finance Director)* | Amount reserved, reservation id |
| 4 | `CONFIRMED` | Employee — M. Bakker | External reference, block id, settled amount |

Events 1 and 3 are **two different people at the same company** — the normal split between spotting
an exposure and approving the spend **[DEC-18]**. Each event stores the account id plus a snapshot of
the name and job title as at that moment, so the record still reads correctly years later even if
someone is promoted or leaves **[DEC-17]**.

Rendered as one timeline for both audiences, from the same rows **[F15](../10-features/F15-audit-and-observability.md)**.
