# API Contracts

Two REST APIs — one per portal **[DEC-02]** — plus the ingestion endpoints on the worker.

---

## 1. Conventions

| Aspect | Rule |
| --- | --- |
| Base paths | `/api/v1/…` on both APIs |
| Versioning | URL segment. A breaking change means `v2`; `v1` is supported for at least 6 months |
| Auth | `Authorization: Bearer <JWT>`; audience differs per API |
| Content type | `application/json`; `application/problem+json` for errors |
| Errors | RFC 7807 problem details |
| Dates | ISO 8601 with offset. Delivery dates are plain `YYYY-MM-DD` (Amsterdam) |
| Money | `{ "amount": "1234.56", "currency": "EUR" }` — **string** to avoid float parsing |
| Energy | `{ "value": "744.000000", "unit": "MWH" }` |
| Paging | `?page=1&pageSize=50`, response envelope with `total`, `page`, `pageSize` |
| Sorting | `?sort=field:asc,other:desc` |
| Idempotency | `Idempotency-Key` header required on all state-changing POSTs |
| Concurrency | `If-Match` with an ETag on updates that can conflict |
| Correlation | `X-Correlation-Id` accepted and echoed; generated if absent |

### 1.1 Error shape

```jsonc
{
  "type": "https://peakpower.example/errors/offer-expired",
  "title": "The offer has expired",
  "status": 409,
  "detail": "This offer expired at 2026-08-12T14:32:00+02:00.",
  "instance": "/api/v1/trades/9f3c.../accept",
  "correlationId": "01J9…",
  "errors": {}
}
```

Domain rejections are `409 Conflict` with a stable `type` URI the frontend can branch on — never a
`500`, and never a bare `400` with prose the UI has to parse.

## 2. Customer API

Every endpoint is implicitly scoped to the `customer_id` in the token **[F13-R14]** — the customer
**company**. There is no `customerId` path parameter anywhere in this API, by design.

The token additionally carries `account_id`, the **person**. It is never used for scoping — every
account of a company sees the same data **[DEC-16]** — but it is stamped on every write as the acting
account **[DEC-17]**. Two claims, two jobs: `customer_id` decides *what may be touched*, `account_id`
records *who touched it*.

### 2.1 Metering points

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/metering-points` | List with search, filter, sort |
| `GET` | `/metering-points/{id}` | Detail with data-quality summary |
| `PATCH` | `/metering-points/{id}/label` | Set friendly name and description |
| `GET` | `/metering-points/{id}/data-quality` | Per-date data state for a range |

### 2.2 Consumption

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/consumption/day?date=&meteringPointIds=` | 15-minute series with block overlay |
| `GET` | `/consumption/month?month=&meteringPointIds=` | Daily totals |
| `GET` | `/consumption/summary?from=&to=&meteringPointIds=` | KPI strip figures |
| `GET` | `/consumption/export?…` | CSV |

```jsonc
// GET /api/v1/consumption/day?date=2026-08-12&meteringPointIds=mp-1
{
  "date": "2026-08-12",
  "meteringPointIds": ["mp-1"],
  "intervalCount": 96,
  "dataState": "PROVISIONAL",
  "intervals": [
    {
      "pos": 1,
      "start": "2026-08-12T00:00:00+02:00",
      "end":   "2026-08-12T00:15:00+02:00",
      "consumptionKwh": "180.000",
      "productionKwh": "0.000",
      "blockKwh": "250.000",
      "netPositionKwh": "-70.000",
      "isPeak": false,
      "dayAheadPriceEurMwh": "41.2000"
    }
    // …
  ],
  "blocks": [
    { "tradeReference": "TRD-1042", "shape": "BASE", "powerMw": "1.000000", "priceEurMwh": "72.4000" }
  ],
  "summary": {
    "consumptionKwh": "11420.000",
    "blockKwh": "36000.000",
    "coverageRatio": "1.0000",
    "surplusKwh": "24580.000"
  }
}
```

Note `intervalCount` in the envelope: the client must never assume 96.

### 2.3 Prices

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/prices/indications` | Price board — one entry per active product |
| `GET` | `/prices/indications/{productCode}/history?from=&to=` | Trend |
| `GET` | `/prices/day-ahead?from=&to=` | Day-ahead curve |

```jsonc
// GET /api/v1/prices/indications
{
  "disclaimer": "Indicative prices. Not an offer. A binding price is issued only in response to a trade request.",
  "products": [
    {
      "code": "NL_POWER_BASE_M1",
      "displayName": "Base — next month",
      "shape": "BASE",
      "periodType": "MONTH",
      "deliveryPeriod": "2026-09",
      "price": { "amount": "78.4500", "currency": "EUR" },
      "unit": "MWH",
      "changeVsPreviousClose": "1.2500",
      "observedAt": "2026-07-30T14:22:11+02:00",
      "isStale": false
    }
  ]
}
```

### 2.4 Trading

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/trades` | List with state filter |
| `GET` | `/trades/{id}` | Detail including the shared event timeline |
| `POST` | `/trades/quote` | Compute volume and estimated value — **no side effects** |
| `POST` | `/trades` | Submit a request |
| `POST` | `/trades/{id}/cancel` | Cancel while `REQUESTED` |
| `POST` | `/trades/{id}/accept` | Accept the offer |
| `POST` | `/trades/{id}/reject` | Reject the offer |
| `GET` | `/blocks` | Confirmed positions |

```jsonc
// POST /api/v1/trades        Idempotency-Key: 01J9…
{
  "direction": "BUY",
  "shape": "PEAK",
  "periodType": "QUARTER",
  "period": "2027-Q1",
  "lines": [
    { "meteringPointId": "mp-1", "powerMw": "0.200" },
    { "meteringPointId": "mp-2", "powerMw": "0.300" },
    { "meteringPointId": "mp-3", "powerMw": "0.400" },
    { "meteringPointId": "mp-4", "powerMw": "0.100" }
  ],
  "comment": "Hedging Q1 baseload growth"
}

// 201 Created
{
  "id": "9f3c…",
  "reference": "TRD-1051",
  "state": "REQUESTED",
  "totalPowerMw": "1.000000",
  "totalMwh": "768.000000",
  "estimatedValue": { "amount": "73843.20", "currency": "EUR" },
  "estimateBasis": { "productCode": "NL_POWER_PEAK_Q1", "price": "96.1500", "observedAt": "…" },
  "requestedBy": {
    "accountId": "acc-0031",
    "name": "J. de Vries",
    "jobTitle": "Energy Manager"
  },
  "createdAt": "2026-07-30T14:25:02+02:00"
}
```

`requestedBy` is taken from the token, never from the request body. A client cannot act on behalf of
a colleague.

`POST /trades/quote` exists so the wizard can show live figures without creating anything. It takes
the same body and returns the volume, estimate and wallet impact.

```jsonc
// GET /api/v1/trades/{id}   — the offer and the shared timeline
{
  "id": "9f3c…",
  "reference": "TRD-1051",
  "state": "OFFERED",
  "offer": {
    "price": { "amount": "94.7500", "currency": "EUR" },
    "unit": "MWH",
    "totalValue": { "amount": "72768.00", "currency": "EUR" },
    "amountToReserve": { "amount": "72768.00", "currency": "EUR" },
    "offeredAt": "2026-07-30T14:31:00+02:00",
    "expiresAt": "2026-07-30T15:01:00+02:00",
    "secondsRemaining": 1487
  },
  "walletCheck": { "availableBalance": { "amount": "95000.00", "currency": "EUR" }, "sufficient": true },
  "requestedBy": { "accountId": "acc-0031", "name": "J. de Vries", "jobTitle": "Energy Manager" },
  "timeline": [
    { "sequence": 1, "type": "SUBMITTED", "at": "2026-07-30T14:25:02+02:00",
      "actor": { "type": "CUSTOMER", "accountId": "acc-0031",
                 "name": "J. de Vries", "jobTitle": "Energy Manager" },
      "comment": "Hedging Q1 baseload growth" },
    { "sequence": 2, "type": "OFFERED",   "at": "2026-07-30T14:31:00+02:00",
      "actor": { "type": "EMPLOYEE", "name": "PeakPower Trading" },
      "payload": { "price": "94.7500", "reactionWindowMinutes": 30 } },
    { "sequence": 3, "type": "ACCEPTED",  "at": "2026-07-30T14:44:18+02:00",
      "actor": { "type": "CUSTOMER", "accountId": "acc-0044",
                 "name": "M. Vandersteen", "jobTitle": "Finance Director" },
      "payload": { "reservedAmount": "72768.00" } }
  ]
}
```

Note sequences 1 and 3: two different accounts of the same company **[DEC-18]**. `name` and
`jobTitle` are snapshots taken when the event happened, so a later promotion or deactivation does not
rewrite the record **[F05-R47]**.

`secondsRemaining` is server-computed at response time. The client counts down from it and
re-fetches on expiry — it never computes expiry from its own clock **[DEC-13]**.

### 2.5 Wallet

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/wallet` | Balances and active reservations |
| `GET` | `/wallet/ledger?from=&to=&types=` | Paged ledger |
| `GET` | `/wallet/ledger/export?…` | CSV / PDF statement |
| `GET` | `/wallet/topup-instructions` | IBAN, BIC, holder, wallet reference |
| `POST` | `/wallet/payments` | Start an iDEAL top-up, returns a redirect URL |
| `GET` | `/wallet/payments/{id}` | Payment status (polled after return) |

### 2.6 Invoices

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/invoices` | List |
| `GET` | `/invoices/{id}` | Detail with sections and lines |
| `GET` | `/invoices/{id}/pdf` | PDF download |
| `GET` | `/invoices/{id}/export` | CSV of lines |

### 2.7 Company & accounts

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/company` | Read-only company profile: legal name, KvK, VAT, registered bank account, addresses, contact |
| `GET` | `/company/accounts` | Colleagues who can also act — name, job title, email, status **[OQ-80]** |

Both are read-only. Company details and accounts are maintained by PeakPower employees, so there is
no write endpoint here at all.

### 2.8 Notifications & profile

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/notifications?unreadOnly=` | Notification centre |
| `POST` | `/notifications/{id}/read` | Mark read |
| `GET`/`PATCH` | `/me` | Own account: name, job title, phone, notification preferences. Username is read-only |

```jsonc
// GET /api/v1/me
{
  "accountId": "acc-0031",
  "username": "jdevries",
  "firstName": "Jan", "lastName": "de Vries",
  "jobTitle": "Energy Manager",
  "email": "j.devries@vandersteen.nl",
  "phone": "+31 6 2244 8890",
  "locale": "nl-NL",
  "company": { "id": "c-000142", "name": "Vandersteen Koeling B.V." }
}
```

### 2.9 Real-time

`/hub/customer` (SignalR), authenticated with the same token. Server-to-client events:

| Event | Payload |
| --- | --- |
| `offerReceived` | trade id, reference, expiry |
| `offerExpiring` | trade id, seconds remaining |
| `tradeStateChanged` | trade id, new state, reason |
| `walletBalanceChanged` | new balances |
| `notificationCreated` | notification summary |

## 3. Employee API

Explicitly cross-customer; `customerId` is a real parameter here.

### 3.1 Trade desk

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/trade-desk/queues` | The three queues with counts |
| `GET` | `/trades?state=&customerId=&…` | Search |
| `GET` | `/trades/{id}` | Full detail: position, wallet, indication, internal notes |
| `POST` | `/trades/{id}/offer` | Publish price + window |
| `POST` | `/trades/{id}/decline` | Decline (reason required) |
| `POST` | `/trades/{id}/withdraw-offer` | Withdraw (reason required) |
| `POST` | `/trades/{id}/confirm` | Confirm execution |
| `POST` | `/trades/{id}/fail` | Fail (reason required) |
| `POST` | `/trades/{id}/internal-notes` | Add an internal note |

```jsonc
// POST /api/v1/trades/{id}/offer
{
  "priceEurMwh": "94.7500",
  "reactionWindowMinutes": 30,
  "internalNote": "Bought 1MW at 93.10, 1.65 margin"
}
```

### 3.2 Customers, wallets, invoicing, data, reference data

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`/`POST`/`PATCH` | `/customers`, `/customers/{id}` | Administration |
| `POST` | `/customers/{id}/metering-points` | Attach an EAN |
| `GET` | `/customers/{id}/accounts` | List the company's accounts |
| `POST` | `/customers/{id}/accounts` | Create an account and send the invitation |
| `PATCH` | `/accounts/{accountId}` | Edit name, job title, phone, email. Username is immutable |
| `POST` | `/accounts/{accountId}/deactivate` | Deactivate and revoke sessions |
| `POST` | `/accounts/{accountId}/resend-invitation` | Reissue; invalidates the previous link |
| `PATCH` | `/metering-points/{id}` | Master data and end-dating |
| `GET` | `/wallets?belowThreshold=` | Wallet overview |
| `GET` | `/wallets/{id}/ledger` | Ledger with actor detail |
| `POST` | `/wallets/{id}/deposits` | Register a bank transfer |
| `POST` | `/wallets/{id}/adjustments` | Manual adjustment (reason required) |
| `POST` | `/invoice-runs` | Start a run |
| `GET` | `/invoice-runs/{id}` | Progress and report |
| `POST` | `/invoices/{id}/recalculate` \| `/finalise` \| `/credit` | Invoice actions |
| `POST` | `/true-up-runs` | Annual true-up |
| `GET` | `/data-health/metering-points` | Ingestion health |
| `GET` | `/data-health/messages` | Inbound message log |
| `POST` | `/data-health/messages/{id}/replay` | Replay |
| `GET` | `/data-health/quarantine` | Unattached series |
| `GET`/`PUT` | `/reference/peak-calendars` | Calendars |
| `GET`/`PUT` | `/reference/tax-tariffs` | Energiebelasting |
| `GET`/`PUT` | `/reference/surcharges` | Surcharges |
| `GET`/`PUT` | `/reference/price-products` | Montel mapping |
| `GET`/`PUT` | `/reference/wallet-thresholds` | Alert rules |
| `GET` | `/audit?…` | Audit search |
| `POST` | `/impersonation` | Start a read-only view-as session |

## 4. Worker endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/webhooks/pvned` | mTLS / shared secret **[OQ-05]** | Inbound `TimeSeriesDocument` |
| `POST` | `/webhooks/payments/{provider}` | Signature verification | Payment status |
| `GET` | `/health/live`, `/health/ready` | None / internal | Probes |
| `GET` | `/hangfire` | Employee admin only | Dashboard |

## 5. Idempotency

Required on every state-changing POST in both APIs.

```
Idempotency-Key: 01J9WQ8XPZ3K4M5N6P7Q8R9S0T
```

- The key plus the request body hash is stored with the response for 24 hours.
- A repeat with the same key and the same body returns the stored response.
- A repeat with the same key and a **different** body returns `422 Unprocessable Entity`.
- Missing key on a state-changing POST returns `400`.

This is what makes "the customer double-clicked Accept" a non-event.

## 6. Rate limiting

| Scope | Limit |
| --- | --- |
| Customer API, per user | 300 req/min |
| Customer API, `POST /trades*` | 20 req/min |
| Employee API, per user | 600 req/min |
| PVNed webhook | 60 req/min, burst 200 |
| Payment webhook | 120 req/min |

Exceeding returns `429` with `Retry-After`.

## 7. OpenAPI

Both APIs publish OpenAPI 3.1 documents. Angular clients are generated from them at build time, so a
contract change breaks CI rather than production. A snapshot test flags breaking changes against the
previous release.

## 8. Open questions

| Ref | Question |
| --- | --- |
| [OQ-05] | PVNed webhook authentication and acknowledgement format |
| [OQ-55] | Does any customer need programmatic API access of their own? |
