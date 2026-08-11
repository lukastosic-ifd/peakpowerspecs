# Process — Wallet Top-up

Two routes, very different latency. Feature spec:
[F07](../10-features/F07-wallet-topup-and-payments.md).

> **Two routes, and only two [DEC-58].** iDEAL and manual bank transfer. No SEPA-via-provider, no
> Bancontact, no card **[F07-R20]**.
>
> **Money is one-way [DEC-43].** There is **no refund payout path**, so this process has no reverse.
> Surplus balance stays in the wallet and is spent on trades and invoices **[F06-R29]**. ⚠ The
> offboarding case that follows — a customer closing with a positive balance — is a **known gap**, not
> an open question: see [F06](../10-features/F06-wallet-and-ledger.md) §1.
>
> **Two matching keys, not one [DEC-61].** A transfer is matched on the wallet reference, and failing
> that on the customer's **registered IBAN** — which is what makes the commonest customer mistake
> stop producing manual work **[F07-R21]**.

---

## 1. Route comparison

```mermaid
flowchart LR
    START(["Customer needs funds"]) --> CHOICE{"Method"}

    CHOICE -->|iDEAL| I1["Enter amount"]
    I1 --> I2["Redirect to bank"]
    I2 --> I3["Authorise"]
    I3 --> I4["Webhook confirms"]
    I4 --> I5["Wallet credited"]
    I5 --> IDONE(["Available in <b>seconds</b>"])

    CHOICE -->|Bank transfer| B1["Read instructions:<br/>IBAN · BIC · holder · reference"]
    B1 --> B2["Transfer from<br/>own bank"]
    B2 --> B3["Funds arrive at<br/>PeakPower"]
    B3 --> B4["Finance registers<br/>the receipt"]
    B4 --> B5["Wallet credited"]
    B5 --> BDONE(["Available in <b>1–2 business days</b>"])

    classDef fast fill:#14532d,stroke:#22c55e,color:#fff
    classDef slow fill:#78350f,stroke:#f59e0b,color:#fff
    class IDONE fast
    class BDONE slow
```

The latency difference is the whole reason iDEAL is a *Must*. A customer who discovers a funding gap
while looking at a 30-minute offer cannot use the bank-transfer route at all.

## 2. iDEAL — the important detail

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant P as Portal
    participant API as Customer API
    participant W as Worker
    participant PSP as Provider
    participant WAL as Wallet

    C->>P: top up €25 000
    P->>API: POST /wallet/payments
    API->>PSP: initiate
    PSP-->>API: providerPaymentId + redirectUrl
    API-->>P: redirectUrl
    P->>PSP: redirect → bank
    C->>PSP: authorise

    rect rgba(34,197,94,0.12)
        Note over PSP,WAL: Authoritative path — always runs
        PSP->>W: webhook
        W->>W: verify signature
        W->>PSP: fetch authoritative status
        PSP-->>W: SUCCEEDED, €25 000
        W->>W: amount matches the originating payment ✓
        W->>WAL: credit (idempotent on providerPaymentId)
    end

    rect rgba(148,163,184,0.12)
        Note over C,API: Cosmetic path — may not happen
        PSP-->>P: redirect to returnUrl
        P->>API: GET /wallet/payments/{id}
        API-->>P: SUCCEEDED
        P-->>C: confirmation, back to the trade
    end
```

Two rules follow from this shape:

1. **The browser never credits a wallet.** If the customer closes the tab, they are still credited.
2. **The webhook is a signal, not a source.** The worker fetches the authoritative status before
   crediting, so a replayed or stale callback cannot create money.

### 2.1 When the browser wins the race

The customer is returned before the webhook lands. The portal shows *processing* and polls for up to
60 seconds, then explains that the payment is being confirmed and that the wallet will update
automatically. It never shows a failure for a payment that is merely in flight.

## 3. Bank transfer

```mermaid
flowchart TB
    A["Customer opens<br/>'Bank transfer' tab"] --> B["Instructions displayed:<br/>IBAN · BIC · account holder<br/><b>wallet reference PP-4821-QK</b>"]
    B --> C["Customer transfers<br/>from their own bank"]
    C --> D["Funds arrive on the<br/>PeakPower account"]
    D --> E{"Reference<br/>present and valid?"}
    E -->|yes| F["Finance registers against<br/>the matched wallet"]
    E -->|no| K{"Sending IBAN known,<br/>and to exactly<br/>one customer?"}
    K -->|yes| L["<b>Proposed match by IBAN</b><br/>customer named · DEC-61"]
    L --> M["Finance confirms"]
    M --> F
    K -->|"no, or ambiguous"| G["Unmatched queue"]
    G --> H["Finance investigates<br/>and matches manually"]
    H --> F
    F --> I["DEPOSIT_BANK entry<br/>wallet credited<br/>matched_by recorded"]
    I --> J["Customer notified"]

    classDef warn fill:#78350f,stroke:#f59e0b,color:#fff
    classDef good fill:#14532d,stroke:#22c55e,color:#fff
    class G,H warn
    class L,M good
```

### 3.1 Two matching keys **[DEC-61]**

**The reference is the first key; the registered IBAN is the second.** The order matters: a reference
identifies the wallet directly and needs no judgement, while an IBAN identifies the *company* and is
therefore proposed rather than applied **[F07-R21]**.

| Key | Applies when | Credited |
| --- | --- | --- |
| **Wallet reference** | Present and the check character validates | Automatically, on registration by finance |
| **Registered IBAN** | No usable reference, and the sending IBAN resolves to **exactly one** active customer | **Proposed** to finance with the customer named, and confirmed before crediting |
| **Neither** | IBAN unknown or matching more than one customer | Unmatched queue, manual resolution **[F07-R22]** |

The match basis is recorded on the deposit (`matched_by`), so the value of the second key is
**measurable** — if IBAN matching turns out to resolve most of the queue, that is an argument for the
statement import **[OQ-07]**; if it resolves little, that is worth knowing too.

### 3.2 The reference

`PP-4821-QK` — designed to be retyped correctly by a human into a banking app:

- Fixed `PP-` prefix so it is recognisable on a statement.
- Grouped, uppercase.
- Alphabet excludes `I`, `O`, `0` and `1` — the characters people confuse.
- Final character is a check character, so an obvious typo can be rejected before it becomes an
  unmatched payment.

Unmatched payments are the main operational cost of this route. The reference design is the cheapest
place to reduce it, and **[DEC-61]** removes the largest remaining source — the customer who transfers
the right amount from the right account and simply forgets the reference.

## 4. Triggered from a blocked trade

```mermaid
flowchart LR
    A["Customer composes<br/>a trade request"] --> B{"Estimated value ≤<br/>available balance?"}
    B -->|yes| C["Submit enabled"]
    B -->|no| D["Submit blocked<br/>shortfall shown"]
    D --> E["'Top up €12 400' →<br/>amount prefilled, rounded up"]
    E --> F["iDEAL flow"]
    F --> G["Returns to the wizard<br/>with the request intact"]
    G --> B
```

The request draft survives the round trip. Losing it would mean re-entering per-EAN volumes across
several sites, which is exactly the moment a customer gives up and phones instead.

## 5. Failure handling

| Situation | Handling |
| --- | --- |
| Customer abandons at the bank | Payment expires; no credit; visible in payment history |
| Webhook never arrives | Reconciliation job resolves within 15 minutes |
| Duplicate webhook | Idempotent; one credit |
| Amount differs from the initiated payment | Quarantined, alerted, **not credited** |
| Payment succeeds after expiry | Credited, state corrected, audit note |
| Provider outage | iDEAL disabled in the UI with an explanation; bank transfer remains. There is no third method to fall back to **[DEC-58]** |
| **Transfer without a reference** | Matched on the sending IBAN when it resolves to exactly one active customer, and **proposed** to finance for confirmation **[DEC-61]**, **[F07-R21]**. Only an unknown or ambiguous IBAN reaches the unmatched queue |
| **Transfer from a customer's second bank account** | Not matched — the IBAN is unknown to the platform. Unmatched queue. The fix is to record the additional IBAN on the customer, not to match on the account-holder name |
| Transfer from a third party | Flagged for finance review before crediting. An IBAN match cannot arise here, which is the intended behaviour rather than a gap |
| **Customer asks for the balance back** | Nothing to invoke — **no refund path exists [DEC-43]**, **[F06-R29]**. A commercial conversation, not a platform action |

## 6. Notifications

| Event | To | Channel |
| --- | --- | --- |
| iDEAL succeeded | Customer | In-app + email |
| iDEAL failed / cancelled | Customer | In-app + email |
| Bank deposit registered | Customer | In-app + email |
| **Transfer proposed by IBAN, awaiting confirmation [DEC-61]** | Finance | In-app |
| Unmatched transfer received | Finance | In-app |
| Payment stuck > 1 h | Finance | In-app |

Customer-facing notifications go to the initiating account for an iDEAL top-up and to **all active
accounts** for a bank deposit, since nobody initiated it in the portal
([F11](../10-features/F11-notifications.md) §2).
