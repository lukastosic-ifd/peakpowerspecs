# API Contracts

Two REST APIs — one per portal **[DEC-02]** — plus the ingestion endpoints on the worker.

⚠ **Revised 2026-08-19.** The customer API gains a **second surface**, the machine-called usage API
**[DEC-97]** §2.11, on the same host rather than a third one. Both APIs shed invoicing mechanics —
numbering **[DEC-88]**, PDF and email **[DEC-89]**, VAT **[DEC-76]**, surcharges **[DEC-73]**, invoice
settlement from the wallet **[DEC-77]** — and gain energiebelasting **[DEC-74]**, withdrawals
**[DEC-83]**, matched bank-transfer deposits **[DEC-106]**, configurable BRPs **[DEC-69]** and
four-eyes as a per-company mode **[DEC-71]**. Every removed endpoint is struck through rather than
deleted, with the decision that removed it.

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
| Volume granularity | Requested power is MW with a **minimum of 0,01 MW and in multiples of 0,01 MW** **[DEC-70]** — §2.4.1 |
| Prices | Every customer-facing indication is the quote **× (1 + markup)** **[DEC-80]**; there is **no price history and no price export** on any customer surface **[DEC-81]** — §2.3 |
| Paging | `?page=1&pageSize=50`, response envelope with `total`, `page`, `pageSize` |
| Sorting | `?sort=field:asc,other:desc` |
| Idempotency | `Idempotency-Key` header required on all state-changing POSTs |
| Concurrency | `If-Match` with an ETag on updates that can conflict |
| Correlation | `X-Correlation-Id` accepted and echoed; generated if absent |
| Authentication strength | A customer token must **evidence multi-factor authentication** **[DEC-92]** — §1.2. ⚠ **Suspended 2026-09-03 by [DEC-119]:** the token carries `amr: ["pwd"]` and **nothing rejects on it** |
| Roles | ~~Every customer token carries `customer.user`; an admin carries `customer.admin` beside it~~ ⚠ **Corrected 2026-09-03:** there is **no `roles` claim**. The role model is a boolean `is_admin` claim **[DEC-71]**, **[F13-R43]** — §1.2 |
| VAT | Every amount is **ex-VAT** **[DEC-26]**, **[DEC-76]** — the platform computes no VAT at all. The single exception is a trade reservation and the debit it becomes, which are VAT-**inclusive** **[DEC-78]** and always carry the `vatRate` they used |

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

### 1.2 Token requirements — [DEC-92], [DEC-71]

⚠ **New 2026-08-19.** Two things about the token changed, and both are **checked by the API** rather
than assumed from the tenant that issued it.

| Claim | Carries | What the API does with it |
| --- | --- | --- |
| `customer_id` | the **company** | Scopes every read and write **[F13-R14]**. Never a path parameter on the customer API |
| ~~`account_id`~~ `sub` | the **person** | Stamped on every write as the acting account **[DEC-17]**. Never scopes. ⚠ **Renamed 2026-09-03**: the claim is the standard `sub`, not `account_id`; the meaning is unchanged |
| ~~`roles`~~ `is_admin` | ~~`customer.user`, plus `customer.admin` for an admin~~ `"true"` / `"false"` **[F13-R43]** | Decides who may raise and who may approve a four-eyes action **[DEC-71]**, §2.10. Nothing else branches on it — an admin reads and writes exactly what a non-admin does **[F13-R41]**. ⚠ **Corrected 2026-09-03:** there is no `roles` claim and no `customer.*` role vocabulary. The flag is one boolean claim, and `ICustomerContext` reads that |
| `amr` | the authentication methods used | ~~Rejects the call unless one of them is a second factor~~ ⚠ **Corrected 2026-09-03 by [DEC-119]: evidence only.** The claim is issued as `["pwd"]` — a password, not a second factor — and **nothing anywhere rejects on it**. The verification **[DEC-92]**, **[F13-R45]** describes is recorded, not built; see [Security §3.1.0](07-security.md) |
| `stamp` | `customer_account.security_stamp` | ⚠ **Added 2026-09-03 by [DEC-117].** Compared to the account's stored stamp on **every** request. It costs nothing measurable — the request already opens a transaction to `SET LOCAL app.customer_id` — and it is what makes **[F01-R16]**'s *immediate* revocation literally true against a stateless 15-minute token |

⚠ **None of the following paragraph is built — [DEC-119], added 2026-09-03.** There is no Entra
tenant, so there is no Conditional Access enforcing anything and no `amr` value the platform did not
mint itself. The `403 mfa-required` response shape below is **never produced**. The text is kept
because it states what has to be reinstated when an identity provider exists, and because a security
requirement quietly deleted is a requirement nobody reinstates.

**MFA is mandatory for customer users [DEC-92].** It is still *enforced* by Conditional Access on the
corporate tenancy **[DEC-66]** and the platform still implements no MFA, no enrolment and no step-up —
**[DEC-51]** is amended, not reversed. What changed is that "enforced elsewhere" is no longer taken on
trust: every customer access token is checked for an authentication-method claim that evidences a
second factor, and the accepted method set is **configuration, not a constant**, because Entra's `amr`
values change over time. An absent, empty or unrecognised value **fails closed** **[F13-R45]**.

```jsonc
// any Customer API call with a single-factor token → 403 Forbidden
{
  "type": "https://peakpower.example/errors/mfa-required",
  "title": "Multi-factor authentication is required",
  "status": 403,
  "detail": "This token was issued for a single-factor sign-in.",
  "instance": "/api/v1/trades",
  "correlationId": "01J9…"
}
```

`403` and not `401`, deliberately: the token is valid and the caller *is* authenticated — they are
authenticated **insufficiently**. A `401` invites the SPA to refresh silently, which returns the same
single-factor token and loops. The body never names the methods that would satisfy the check.

⚠ What this costs: the API now fails closed on a configuration it does not own. If Conditional Access
is loosened, or Entra renames an `amr` value, **every** customer call returns `403` until the accepted
set is corrected — which is why the rejection is logged with its reason **[F13-R45]** and why the set
is configuration. The alternative failure is worse and silent: accepting single-factor sign-ins and
never knowing.

**~~The admin flag rides in the existing `roles` claim~~ [DEC-71].** ⚠ **Corrected 2026-09-03: it is its own `is_admin` claim.** There is no `roles` claim on this API. The reasoning below — one authorisation vocabulary rather than a parallel boolean one — is what was *intended*; what was built is the boolean, and `ICustomerContext` reads it directly. The paragraph's **re-validation** is achieved by a different mechanism than it describes, and the guarantee is intact: `is_admin` is read off the token and is *not* compared to the account row per request — but changing the flag **bumps `security_stamp`**, and the `stamp` claim is compared on every request **[DEC-117]**, so a token minted before the flag was cleared is rejected on its very next call. Same property, one comparison instead of two. `customer.admin` beside
`customer.user`, so deny-by-default endpoint declaration **[F13-R18]** keeps one authorisation
vocabulary instead of gaining a parallel boolean one, and like `customer_id` and `account_id` it is
**re-validated against the platform's own account record on every request** **[F13-R43]** — a claim
that decides who may release money must not be trusted on the token alone, because a token minted
before the flag was cleared would otherwise still approve. `four_eyes_enabled` is deliberately **not**
a claim: it is company reference data, read server-side, so turning the mode on takes effect on the
next request rather than on the next token.

⚠ **Interaction with [DEC-67].** The claim-mapping spike now has **three** claims to map instead of
two. The marginal cost inside the spike is small — one more app-role assignment on the same app
registration — but it is a third thing that can only be proven against the **corporate tenancy**, not
against the local OIDC container **[F13-R32]**, and that spike already carries the tenant-access
dependency on the critical path. `amr` makes it four: the container can prove the claim *contract*
(the API reads `amr` and refuses without it) but not the *values* Entra will actually emit under
PeakPower's Conditional Access policy. Both are additive to an existing spike rather than a new one.

## 2. Customer API

Every endpoint is implicitly scoped to the `customer_id` in the token **[F13-R14]** — the customer
**company**. There is no `customerId` path parameter anywhere in this API, by design.

The token additionally carries `account_id`, the **person**. It is never used for scoping — every
account of a company sees the same data **[DEC-16]** — but it is stamped on every write as the acting
account **[DEC-17]**. Two claims, two jobs: `customer_id` decides *what may be touched*, `account_id`
records *who touched it*.

### 2.0 Authentication and onboarding — ⚠ added 2026-09-03

Neither group existed when this document was written, because the proof of concept was to run
unauthenticated **[DEC-20]**. **[DEC-113]** and **[DEC-117]** created both. These are the routes as
frozen in `artifacts/openapi/customer.json`; the paths below are relative to `/api/v1`.

**Auth [DEC-117]** — the two `password-reset` routes and `sign-in` are anonymous; the rest need a
token.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/sign-in` | Username and password for an access token (15 min) and a rotating refresh cookie. `200` or `401`, and the `401` is **byte-identical** for a wrong password, an unknown username and a deactivated account — one branch, one constant response, deliberately no oracle |
| `POST` | `/auth/refresh` | Rotates the HttpOnly `pp_refresh` cookie. No request body: the cookie **is** the credential |
| `POST` | `/auth/sign-out` | Revokes the refresh chain and clears the cookie. `204` |
| `GET` | `/auth/me` | The signed-in account |
| `POST` | `/auth/password-reset/requests` | Always `202`, whether or not the address exists **[DEC-113]** |
| `POST` | `/auth/password-reset/completions` | Token plus new password. `204`, and every session for that account dies with it |
| `GET` | `/.well-known/jwks.json` | The ES256 verification key **[DEC-117]**. Anonymous by definition |

**Onboarding [DEC-113]** — the nine-step self-service wizard. **Every route here is anonymous**: a
prospect has no company and no token until step 9 signs.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/onboarding/applications` | Start a draft. `201` with `Location` |
| `PATCH` | `/onboarding/applications/{id}` | Save one step. **A partial save sends every field**, with the ten optional ones explicitly `null` |
| `POST` | `/onboarding/applications/{id}/signatories` | Step 8. `202` with `Location` |
| `POST` | `/onboarding/applications/{id}/bank-verification/simulate` | Stands in for a real bank check for the proof of concept |
| `POST` | `/onboarding/applications/{id}/sign` | Step 9. Six-digit code; creates the company, the account and the wallet in one transaction |
| `GET` | `/onboarding/applications/{id}/sign-code` | ⚠ **Development only, and the gate is structural rather than a route condition.** The route is mapped **unconditionally** and appears in the frozen contract; what is gated is its **backing store**, registered only when the host is Development. Outside Development the store is absent and the route answers `404`. Mapping it conditionally would have made the contract differ between environments — worse than a documented `404` |

⚠ **Onboarding's rejections are `422`, and they carry no `errors` map.** The routes are declared
`ProducesProblem`, never `ProducesValidationProblem`, so a client **cannot** field-target a validation
message from an onboarding response the way it can from `/metering-points`. That is a real limit on
the wizard, not an omission in this table.

### 2.1 Metering points

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/metering-points` | List with search, filter, sort |
| `POST` | `/metering-points` | ⚠ **Added 2026-09-03 [DEC-113].** Claim an unclaimed EAN out of the shared pool and attach it to the company. `201` with `Location`; `409` when someone claimed it first; `404` for an EAN that is not in the pool at all — those are two different answers and a client needs both |
| `GET` | `/metering-points/{id}` | Detail with data-quality summary |
| `PATCH` | `/metering-points/{id}/naming` | Set friendly name and description |
| `GET` | `/ean-pool` | ⚠ **Added 2026-09-03 [DEC-113].** The unclaimed pool. It is **shared reference data**, not tenant-scoped — two different companies must receive byte-identical bodies — so it has its own tenancy classification rather than being labelled tenant-scoped and lying about it. It still requires a token |
| `GET` | `/metering-points/{id}/data-quality` | Per-date data state for a range |

> **Renamed from `/label` on 2026-08-26**, following the friendly name settling as `name` +
> `description` columns on `metering_point`. The route had no consumers when it was renamed, so it
> was free then and awkward later.

⚠ **Framework `400` and `415` are deliberately undeclared** on the nine body-binding operations
(recorded 2026-09-03). Three of them — `POST /metering-points`, `PATCH /metering-points/{id}/naming`
and `POST /auth/password-reset/completions` — already own a **domain-meaning** `400`. The only
available mechanism adds a response by `TryAdd`, so a document-wide framework `400` would *skip*
those three and land on the other six, producing a contract where `400` means "malformed JSON" on six
operations and "name too long" on three. Inconsistent is worse than absent, and a blind overwrite
would replace `HttpValidationProblemDetails` with a bare `ProblemDetails` on the two routes that
legitimately return a field-keyed `errors` map. **Cost, accepted:** a generated client types a
malformed-body `400` and a wrong-content-type `415` as untyped failures. They are client bugs rather
than API outcomes, so a correct client cannot reach them.

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

⚠ **The export carries volumes, never prices [DEC-81].** `dayAheadPriceEurMwh` above is a **screen**
field: it is rendered in the tooltip and the KPI strip **[F03-R05]**, **[F03-R19]** and is absent from
`/consumption/export`, from every other download, and from the usage API §2.11 **[F03-R26]**,
**[NFR-67]**. Usage leaves the platform; prices are looked at **[DEC-97]**. The split is enforced by
the payloads, not by a flag on the export endpoint — a `?includePrices=` parameter would be one
support request away from being turned on.

### 2.3 Prices

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/prices/indications` | Price board — one entry per active product. The price is the raw quote **× (1 + markup)** **[DEC-80]**, **[F04-R17]** |
| ~~`GET`~~ | ~~`/prices/indications/{productCode}/history?from=&to=`~~ | ~~Trend~~ ⚠ **Removed 2026-08-19 by [DEC-81]** — customers see the **current** curve and nothing from which an earlier price can be recovered **[F04-R20]**. The observation series is still stored, for **[F04-R10]** and staleness **[F04-R06]**; it is internal |
| `GET` | `/prices/day-ahead?from=&to=` | Day-ahead curve. **Portal surface only** — it is not on the usage API and there is no export of it **[DEC-81]**, **[NFR-67]** |

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
      "observedAt": "2026-07-30T14:22:11+02:00",
      "isStale": false
    }
  ]
}
```

⚠ **Two fields left this payload on 2026-08-19.**

| Field | Why it is gone |
| --- | --- |
| ~~`changeVsPreviousClose`~~ | A price and a delta are two prices: the reader recovers the previous close by subtraction, which is exactly the history **[DEC-81]** withholds **[F04-R04]** |
| ~~`rawQuote`~~ / ~~`markupPercent`~~ (never shipped, and never will) | The customer-facing number is the marked-up one **[DEC-80]**, **[F04-R17]**. Price and percentage together disclose the raw quote, so neither the raw quote nor the percentage appears on a customer payload. Both are on the **employee** surface **[F04-R21]** |

`price` is therefore the only number on this surface, and it is already marked up. The markup itself
is reference data with a default of 2%, maintained through the Employee API §3.2 **[F12-R48]**.

### 2.4 Trading

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/trades` | List with state filter |
| `GET` | `/trades/{id}` | Detail including the shared event timeline |
| `POST` | `/trades/quote` | Compute volume and estimated value — **no side effects** |
| `POST` | `/trades` | Submit a request |
| `POST` | `/trades/{id}/cancel` | Cancel while `REQUESTED` |
| `POST` | `/trades/{id}/accept` | Accept the offer. **May return state `AWAITING_APPROVAL`** — see below |
| `POST` | `/trades/{id}/reject` | Reject the offer |
| `POST` | `/trades/{id}/approve` | ~~**[DEC-33]**~~ ⚠ **Amended 2026-08-19 by [DEC-71]** — approve a colleague's acceptance. The verb, path and semantics are unchanged; the **caller must be an `customer.admin` of the company and must not be the accepting account** **[F05-R59]**, **[F13-R44]**. Refused for the accepting account |
| `POST` | `/trades/{id}/refuse-approval` | ~~**[DEC-33]**~~ ⚠ **Amended 2026-08-19 by [DEC-71]** — decline it, optionally with a reason. Terminal. Same admin requirement **[F05-R63]** |
| `GET` | `/blocks` | Confirmed positions. ⚠ Under **[DEC-72]** a position may be **short**: a confirmed `SELL` with no matching purchase makes the net figure negative, and the client must render a negative as a position rather than as an error **[F05-R69]** |

Approval is two endpoints rather than one with a `decision` field, matching the house style — every
other transition on this API is its own verb (`/cancel`, `/accept`, `/reject`), and the two outcomes
have different eligibility rules, which a single endpoint would hide in a branch.

#### 2.4.1 Request validation — [DEC-70], [DEC-72]

Two validation rules changed on 2026-08-19, in opposite directions: one got stricter, one disappeared.

| Rule | Was | Is | Error `type` |
| --- | --- | --- | --- |
| Requested power per line | minimum 0,1 MW, multiples of 0,1 MW **[DEC-32]** | ⚠ **Reversed by [DEC-70]** — minimum **0,01 MW**, multiples of **0,01 MW**, per line and on the request total | `…/errors/invalid-volume` |
| Holdings on a `SELL` | the sold volume had to be covered by confirmed blocks **[DEC-34]** | ⚠ **Reversed by [DEC-72]** — **no holdings check at all**. A customer may sell a block they do not hold; the motivating case is a customer with solar production selling expected surplus **[F05-R69]** | *(none — the check is gone, not relaxed)* |

`powerMw` is validated as a decimal with **at most two decimal places and a value ≥ 0.01**, which is
the whole rule: "multiple of 0,01" and "two decimals" are the same statement, so the API expresses it
once. `0.005`, `0.0`, and a negative value are all `409 invalid-volume` with the offending line index
in `errors`. The check is server-side and repeated at acceptance, because the wizard is not the only
client this API will ever have.

⚠ **What ten-times-finer granularity costs downstream.** Per-EAN allocation rounds to 0,01 MW instead
of 0,1 MW, so the non-whole-MW tail **[DEC-32]** removed is back: `totalPowerMw` may be `0.070000`,
and every allocation, block and coverage figure has to survive it. Nothing in this contract changes
shape — the fields were always decimal strings — but a client that assumed one decimal place is wrong.

⚠ **What the missing holdings check costs.** A short is a **promise to deliver**, not a spend, so the
pre-trade balance check **[DEC-41]** does not bound it: a `SELL` **credits** the wallet on confirmation
**[F05-R35]**. No collateral or exposure limit is decided — **[OQ-94]**. The API is specified without
one; until it is answered, the sell path is not safe to open to volumes beyond confirmed holdings, and
that is a product gate rather than a contract change.

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
  "estimatedValueExVat": { "amount": "73843.20", "currency": "EUR" },
  "estimatedValue":      { "amount": "89350.27", "currency": "EUR" },
  "vatRate": "0.21",
  "estimateBasis": { "productCode": "NL_POWER_PEAK_Q1", "price": "96.1500", "observedAt": "…" },
  "requestedBy": {
    "accountId": "acc-0031",
    "name": "J. de Vries",
    "jobTitle": "Energy Manager"
  },
  "fourEyes": {
    "enabled": true,
    "activeAdminCount": 2,
    "canBeApproved": true
  },
  "createdAt": "2026-07-30T14:25:02+02:00"
}
```

Two changes in that body, both from 2026-08-19.

**`estimatedValue` is now VAT-inclusive [DEC-78].** Prices are quoted, offered and stored **ex-VAT**
**[DEC-26]** and the platform computes no VAT for accounting purposes **[DEC-76]** — this gross-up is
a **sizing rule for a wallet hold**, nothing else **[F05-R70]**, **[F06-R32]**. The wizard must show
the number the wallet will actually hold, or the customer passes the balance check on screen and fails
it on acceptance. Both figures are on the wire, and the rate that produced them is too, so a client
never re-derives one from the other:

| Field | Q1 2027 peak, 1 MW | Working |
| --- | ---: | --- |
| `totalMwh` | 768,000000 | 64 weekdays in Q1 2027 × 12 peak hours × 1 MW |
| `estimatedValueExVat` | € 73 843,20 | `768 × 96.1500` |
| `estimatedValue` (reserved) | € 89 350,27 | `round(73843.20 × 1.21, 2)` at the **[DEC-64]** reference rate of 21% |

**`fourEyes` is a mode, not a threshold [DEC-71].** ⚠ `thresholdApplies`, `threshold` and
`estimateAboveThreshold` are **removed** — there is no threshold in euros or in megawatts, so nothing
resolves a value and **[DEC-33]**'s reference table is not built **[F13-R42]**. What is left is
`enabled` (the company's flag), `activeAdminCount` and `canBeApproved`. ⚠ `activeAccountCount` becomes
`activeAdminCount`: a second pair of eyes must be a **different admin account** of the same company
**[F13-R44]**, and a company with three accounts and one admin cannot clear the control.

`requestedBy` is taken from the token, never from the request body. A client cannot act on behalf of
a colleague.

`POST /trades/quote` exists so the wizard can show live figures without creating anything. It takes
the same body and returns the volume, estimate and wallet impact — **and the same `fourEyes` block**,
so the wizard can warn before submission **[F05-R56]** rather than at acceptance. ⚠ **Amended
2026-08-19 by [DEC-71]**: the warning is no longer *"this one is above your threshold"* but *"your
company runs four-eyes, so every trade needs a second admin"* — it is the same warning on every trade
of that company, which is what makes it cheap to render and impossible to get wrong.
`canBeApproved` is `false` when the company has fewer than **two active admin accounts**, the case
where the trade cannot clear the control at all **[F12-R36]**. The estimate is advisory: the binding
figure is computed at acceptance from the **offer** price **[F05-R52]**, not from this number, and it
is the gross figure that is checked against the balance **[DEC-41]**, **[F05-R70]**.

```jsonc
// GET /api/v1/trades/{id}   — the offer and the shared timeline
{
  "id": "9f3c…",
  "reference": "TRD-1051",
  "state": "OFFERED",
  "offer": {
    "price": { "amount": "94.7500", "currency": "EUR" },
    "unit": "MWH",
    "totalValueExVat": { "amount": "72768.00", "currency": "EUR" },
    "vatRate": "0.21",
    "amountToReserve": { "amount": "88049.28", "currency": "EUR" },
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
      "payload": { "reservedAmount": "88049.28", "vatRate": "0.21" } }
  ]
}
```

⚠ **`totalValue` became `totalValueExVat`, and `amountToReserve` is now larger than it [DEC-78].**
`768 × 94.75 = € 72 768,00` ex-VAT; `round(72768.00 × 1.21, 2) = € 88 049,28` is what the wallet holds
and later debits — **the same stored number**, never two calculations **[F05-R70]**. The rename is
deliberate and breaking: a field called `totalValue` sitting beside a bigger `amountToReserve` reads
as a bug, and a client that silently kept displaying the old name would understate the hold by 21%.
Both go through expand/contract §7 like any other contract change. `walletCheck.sufficient` is
computed against `amountToReserve` — € 95 000,00 available covers € 88 049,28, so it stays `true` here,
but a balance between the two figures now fails where it used to pass.

Note sequences 1 and 3: two different accounts of the same company **[DEC-18]**. `name` and
`jobTitle` are snapshots taken when the event happened, so a later promotion or deactivation does not
rewrite the record **[F05-R47]**.

`secondsRemaining` is server-computed at response time. The client counts down from it and
re-fetches on expiry — it never computes expiry from its own clock **[DEC-13]**.

#### Acceptance at a four-eyes company ~~above the four-eyes threshold~~ **[DEC-33]** ⚠ **Amended 2026-08-19 by [DEC-71]**

`POST /trades/{id}/accept` **no longer always yields `ACCEPTED`**. A client that branches on the
response must handle both destinations; this is the one place four-eyes changes an existing
contract rather than adding to it. ⚠ **What [DEC-71] changed here is the *trigger*, not the shape**:
the second destination is reached when **the customer company has four-eyes enabled**, on every trade
of that company regardless of value, instead of when the value cleared a threshold **[F13-R42]**.
The states, the clock and the two verbs are untouched.

```jsonc
// POST /api/v1/trades/{id}/accept    → 200 OK
{
  "id": "9f3c…",
  "reference": "TRD-1051",
  "state": "AWAITING_APPROVAL",
  "reservedAmount": { "amount": "88049.28", "currency": "EUR" },
  "vatRate": "0.21",
  "approval": {
    "requiredBecause": { "fourEyesEnabled": true },
    "acceptedBy": { "accountId": "acc-0044", "name": "M. Vandersteen", "jobTitle": "Finance Director" },
    "eligibleApproverCount": 1,
    "canCurrentAccountApprove": false,
    "expiresAt": "2026-07-30T15:01:00+02:00",
    "secondsRemaining": 887
  }
}
```

⚠ **Three fields left `requiredBecause` [DEC-71].** ~~`tradeValue`~~, ~~`threshold`~~ and
~~`thresholdVersion`~~ are removed: there is no threshold to compare against and no reference-data
version to pin, so **[F05-R54]**'s pinning obligation has nothing left to pin on this path. What is
recorded on the trade instead is the **company's four-eyes flag as it stood at acceptance**, which is
what `requiredBecause.fourEyesEnabled` reports back. `eligibleApproverCount` counts **active admin
accounts other than the acceptor** **[F13-R44]** — one, in a two-admin company, which is the ordinary
case **[F12-R41]**.

Three things this shape is asserting.

- `reservedAmount` is present, because the money was reserved by **this** call, and it is the
  **VAT-inclusive** figure **[DEC-78]**, **[F05-R70]**. An `AWAITING_APPROVAL` trade always holds a
  reservation **[F05-R55]**, so approval never has to re-check the balance and cannot fail on funds.
- `expiresAt` is the **offer's** `expires_at`, unchanged. There is no separate approval window
  **[F05-R61]**; the same value that guarded the acceptance now guards the approval, and the same
  countdown component renders it.
- `canCurrentAccountApprove` is `false` for the account that just accepted, and the UI hides the
  button accordingly — but the server refuses the call regardless. Four eyes is enforced in the
  domain, not in the client **[F05-R59]**, **[F13-R44]**. It is also `false` for a **non-admin**
  account of the same company, which is new: under **[DEC-33]** any active account could approve;
  under **[DEC-71]** only an admin can **[F01-R47]**.

```jsonc
// POST /api/v1/trades/{id}/approve            (no body)
// POST /api/v1/trades/{id}/refuse-approval    { "reason": "Volume is above what we agreed internally" }
```

`/approve` returns the trade with `state: "ACCEPTED"` and `approvedBy` populated;
`/refuse-approval` returns `state: "APPROVAL_REFUSED"` with the reservation released. The reason is
optional on refusal, symmetric with `/reject` **[F05-R63]**. Both are `Idempotency-Key` POSTs like
every other transition, and both take the same wallet-then-trade lock order as `/accept`.

The `GET /trades/{id}` response carries the same `approval` object while the trade is
`AWAITING_APPROVAL`, and the timeline gains `APPROVED` / `APPROVAL_REFUSED` event types. Note that
the acceptance event is still typed `ACCEPTED` even when the resulting state is `AWAITING_APPROVAL`:
the event names what the person did, the state names what the trade is waiting for.

New error `type` URIs, all `409`:

| `type` | When |
| --- | --- |
| `…/errors/self-approval-not-permitted` | The acting account is the accepting account **[F05-R59]** |
| `…/errors/approval-window-elapsed` | `now ≥ expires_at` on an approve attempt **[F05-R62]** |
| ~~`…/errors/four-eyes-threshold-not-configured`~~ | ~~No threshold row is in force for the customer **[F05-R53]**~~ ⚠ **Removed 2026-08-19 by [DEC-71]** — there is no threshold row to be missing, so acceptance can no longer fail on reference data. The failure it guarded against is replaced by **`four-eyes-not-satisfiable`** below |
| `…/errors/approval-required` | A confirm attempt against a trade still `AWAITING_APPROVAL` **[F05-R66]** |
| `…/errors/admin-role-required` | ⚠ **New 2026-08-19 [DEC-71]** — an approve or decline attempt by an account without `customer.admin`, re-validated against the account record rather than read off the token **[F13-R43]** |
| `…/errors/four-eyes-not-satisfiable` | ⚠ **New 2026-08-19 [DEC-71]** — the company has four-eyes on and **fewer than two active admin accounts**, so nobody can be the second pair of eyes. Raised at **acceptance**, before money is reserved, rather than letting the trade sit in `AWAITING_APPROVAL` until it expires. It should be unreachable — **[F12-R41]** refuses to enable the mode below two admins and **[F01-R50]** refuses to deactivate below it — which is exactly why it is checked: an unreachable state that is not checked is an unreachable state that happens |
| `…/errors/invalid-volume` | ⚠ **New 2026-08-19 [DEC-70]** — a `powerMw` below 0,01 or not a multiple of 0,01 — §2.4.1 |

### 2.5 Wallet, deposits and withdrawals

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/wallet` | Balances and active reservations. **Reservations are VAT-inclusive** for trades **[DEC-78]** and face value for withdrawals **[F06-R33]** |
| `GET` | `/wallet/ledger?from=&to=&types=` | Paged ledger |
| `GET` | `/wallet/ledger/export?…` | CSV / PDF statement. ⚠ **Unaffected by [DEC-89]** — that decision moves the **invoice** document to the bookkeeping program; a wallet statement is not an invoice, is not numbered and states no VAT **[DEC-76]** |
| ~~`GET`~~ | ~~`/wallet/topup-instructions`~~ | ~~IBAN, BIC, holder, wallet reference~~ ⚠ **Removed 2026-08-19 by [DEC-106]** — the reference is now issued **per deposit intent**, not standing per customer, so a static instruction page would print a code that matches nothing **[F07-R13]**, **[F07-R14]**. The instructions come back from `POST /wallet/deposits` |
| `POST` | `/wallet/deposits` | ⚠ **New 2026-08-19 [DEC-106]** — create a **deposit intent** with `{ amount, method }`, `method` ∈ `IDEAL` \| `BANK_TRANSFER`. Moves no money and reserves nothing **[F07-R23]** |
| `GET` | `/wallet/deposits?state=` | ⚠ **New** — the customer's own pending and credited intents **[F07-R11]** |
| `GET` | `/wallet/deposits/{id}` | ⚠ **New** — intent state, and the credited entries matched to it **[F07-R26]** |
| ~~`POST`~~ | ~~`/wallet/payments`~~ | ~~Start an iDEAL top-up, returns a redirect URL~~ ⚠ **Amended 2026-08-19 by [DEC-106]** — folded into `POST /wallet/deposits` with `method: "IDEAL"`. iDEAL and bank transfer are **peers on one deposit action**, not a default with a fallback behind it **[F07-R01]** |
| `GET` | `/wallet/payments/{id}` | Payment status (polled after the iDEAL return). Retained: it is the PSP leg, not the deposit intent |
| `POST` | `/wallet/withdrawals` | ⚠ **New 2026-08-19 [DEC-83]** — request a withdrawal up to `availableBalance`. **Admin only** **[F06-R33]**; the amount is held immediately **[F07-R29]** |
| `GET` | `/wallet/withdrawals?state=` | ⚠ **New** — the company's requests and their states **[F07-R32]** |
| `POST` | `/wallet/withdrawals/{id}/cancel` | ⚠ **New** — the customer withdraws their own request before payout; releases the hold **[F07-R32]** |

⚠ **There is no wallet-threshold endpoint, and none is coming [DEC-90].** ~~`/wallet/thresholds`~~ and
the low-balance alert it would have configured are **reversed [DEC-49]**. The balance is returned by
`GET /wallet` and rendered; nothing monitors it, and the **only** decision taken on it anywhere in the
platform is the pre-trade check **[DEC-41]**, **[F06-R39]**. A customer can only trade within their
balance, so a low balance limits the customer rather than exposing PeakPower — there is nothing for an
alert to prevent.

```jsonc
// POST /api/v1/wallet/deposits     Idempotency-Key: 01J9…
{ "amount": { "amount": "50000.00", "currency": "EUR" }, "method": "BANK_TRANSFER" }

// 201 Created  — [DEC-106]
{
  "id": "dep-0091",
  "state": "AWAITING_PAYMENT",
  "method": "BANK_TRANSFER",
  "intendedAmount": { "amount": "50000.00", "currency": "EUR" },
  "paymentReference": "PP-4K7M-2QX9-3B",
  "instructions": {
    "iban": "NL00 BANK 0123 4567 89",
    "bic": "BANKNL2A",
    "accountHolder": "PeakPower B.V.",
    "descriptionMustContain": "PP-4K7M-2QX9-3B"
  },
  "createdAt": "2026-08-19T09:04:00+02:00"
}
```

`paymentReference` is **issued by the platform per intent**, carries a check character and is
formatted to survive being retyped **[F07-R14]**. It is the primary matching key on the incoming
payment feed **[F07-R21]**; the customer's registered IBAN **[DEC-61]** is the fallback when they omit
it. The intent is an **expectation**, not a credit: `intendedAmount` is used for matching confidence
and duplicate detection, and the wallet is credited with **the amount actually received**
**[F07-R25]**. A reference is **not consumed by use and does not expire** **[F07-R26]**, so a second
transfer quoting it credits again rather than stranding money on PeakPower's account — which is why
this endpoint is idempotent on `Idempotency-Key` but the *matching* is idempotent on the bank
transaction id instead.

⚠ **The feed behind this is not chosen — [OQ-93].** CAMT.053 import, a PSP webhook or a SEPA-instant
push all satisfy the contract above and differ only in latency, which is why `GET /wallet/deposits/{id}`
exists and why the portal states timing honestly rather than promising minutes **[F07-R16]**. No PSP is
committed to either **[DEC-86]**.

```jsonc
// POST /api/v1/wallet/withdrawals    Idempotency-Key: 01J9…
{ "amount": { "amount": "25000.00", "currency": "EUR" }, "reason": "Surplus after Q1 hedging" }

// 201 Created  — [DEC-83]
{
  "id": "wdr-0034",
  "state": "AWAITING_APPROVAL",
  "amount": { "amount": "25000.00", "currency": "EUR" },
  "held": true,
  "destination": { "iban": "NL00 BANK 0123 4567 89", "status": "ACTIVE" },
  "requestedBy": { "accountId": "acc-0044", "name": "M. Vandersteen", "jobTitle": "Finance Director" },
  "approval": { "required": true, "eligibleApproverCount": 1, "canCurrentAccountApprove": false },
  "createdAt": "2026-08-19T09:10:00+02:00"
}
```

Four things this asserts, each of them a decision rather than a design preference.

- **`held: true` from the moment of the request** **[F07-R29]**. Without the hold the same euros can
  be traded and withdrawn, and **[AS-11]** fails. It uses the wallet's existing reservation mechanism,
  so it shows in `GET /wallet` beside trade reservations, labelled **[F06-R17]**.
- **`state` starts at `AWAITING_APPROVAL` only when the company runs four-eyes** **[DEC-71]**,
  **[F07-R30]**; otherwise `REQUESTED`. **Deposits are explicitly out of scope for four-eyes** — a
  customer can wire money or use iDEAL alone, so gating a deposit gates nothing.
- **`destination` is read-only and is the bank account on the customer record** **[DEC-61]**,
  **[F06-R37]**. It is never a request field. A `PENDING_APPROVAL` bank account is not a payout
  destination **[F01-R45]**, and the request is refused with `…/errors/no-active-bank-account`.
- **There is no payout endpoint on this API.** PeakPower pays out **manually** and records what the
  bank did **[DEC-83]**, **[F12-R54]** — §3.2. The platform never initiates a transfer, so no customer
  call can cause money to leave; `POST /wallet/withdrawals` creates an obligation, not a payment.

### 2.6 Invoices

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/invoices` | List. Shows the platform's own states **[F10 §6]** and the **number returned by the bookkeeping program** where one exists **[DEC-88]**, **[F10-R37]** |
| `GET` | `/invoices/{id}` | Detail with sections and lines — the **calculated invoice data**, not a rendered document **[F10-R34]** |
| ~~`GET`~~ | ~~`/invoices/{id}/pdf`~~ | ~~PDF download~~ ⚠ **Removed 2026-08-19 by [DEC-89]**, which reverses **[DEC-46]**. The bookkeeping program generates the PDF **and emails it** **[F10-R46]**; the platform renders, stores and serves no document. **[OQ-90]** (attached or linked) closes with it — it is no longer the platform's question |
| `GET` | `/invoices/{id}/export` | CSV of lines. Retained: these are the customer's **own settled figures**, the same numbers the bookkeeping program's PDF carries. It is not a price feed — no forward price, no indication and no day-ahead curve **[DEC-81]**, **[NFR-67]** |
| `GET` | `/invoices/{id}/corrections` | ⚠ **New 2026-08-19 [DEC-99]** — the correction invoices raised against this one, each its own document with its own returned number **[F10-R49]** |

```jsonc
// GET /api/v1/invoices/{id}   — excerpt
{
  "id": "inv-2026-07-000142",
  "period": "2026-07",
  "state": "NUMBERED",
  "number": "2026/07/0311",          // returned by the bookkeeping program [DEC-88], null until then
  "numberedAt": "2026-08-06T11:20:04+02:00",
  "totalExVat": { "amount": "48210.55", "currency": "EUR" },
  "correctionOf": null,
  "corrections": [ { "id": "inv-2026-11-000517", "number": "2026/11/0088", "reason": "METERING_CORRECTION" } ]
}
```

Four things are **absent** from that body, and each absence is a decision.

| Absent | Why |
| --- | --- |
| A platform-issued number | The bookkeeping program owns numbering **[DEC-88]**, reversing **[DEC-45]**. `number` is **nullable until that program answers**, and a client must render "not yet issued" rather than a placeholder ⚠ — a `PUSHED` invoice that never reaches `NUMBERED` leaves the customer with **no number, no PDF and no email at all** **[F10-R45]** |
| A PDF link | **[DEC-89]** — the row above |
| VAT fields | The platform computes **no VAT** **[DEC-76]**, so there is no subtotal/VAT/total triple to return. Every amount here is ex-VAT **[DEC-26]**. ⚠ The one VAT-inclusive number in the whole customer API is a **trade reservation** §2.4 **[DEC-78]** — different concern, different object |
| A payment state | Delivery invoices are paid to the bank and never settled from the wallet **[DEC-77]**, reversing **[AS-12]**. The platform records no payment, no receivable and derives no paid state; matching and reconciliation are the bookkeeping program's **[DEC-105]**, **[F10-R48]** |

`correctionOf` and `corrections` carry **[DEC-99]**: a metering correction that lands months after a
finalised month produces a **correction invoice for the delta at any time**, never an edit of the
original **[F10-R32]**, and every non-zero difference gets its own document with no materiality
threshold **[DEC-100]**, **[F10-R50]**.

### 2.7 Company & accounts

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/company` | Read-only company profile: legal name, KvK, VAT, registered bank account, addresses, contact |
| `GET` | `/company/accounts` | Colleagues who can also act — name, job title, email, status **[OQ-80]**, and each account's **admin** flag **[DEC-71]**, **[F01-R21]** |
| `GET` | `/company/bank-accounts` | ⚠ **New 2026-08-19 [DEC-71]** — the company's bank accounts with status (`PENDING_APPROVAL` \| `ACTIVE` \| `DEACTIVATED`) **[F01-R44]**. Read-only here: a bank account is added and deactivated by a PeakPower employee **[DEC-16]** and, under four-eyes, approved by a second admin §2.10 |

All three are read-only. Company details, accounts and bank accounts are maintained by PeakPower
employees **[DEC-16]**, so there is no write endpoint here at all. ⚠ **[DEC-71] does not change
that** — it adds an **approval** the customer's second admin gives §2.10, not an administration
screen. A bank account **cannot be edited once added**; correcting an IBAN is *deactivate the old, add
the new*, two audited events with two named actors **[F01-R44]**, **[F01-R46]**.

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

| Event | Payload | Who receives it |
| --- | --- | --- |
| `offerReceived` | trade id, reference, expiry | ⚠ **Amended 2026-08-19 by [DEC-111]**, reversing **[DEC-63]**: the **account that raised the request**, plus **both admins** when the company runs four-eyes **[DEC-71]** — not every active account |
| `offerExpiring` | trade id, seconds remaining | Same set as `offerReceived` |
| `approvalRequired` | trade id, reference, **VAT-inclusive reserved amount [DEC-78]**, accepting account, expiry | ~~every active account except the acceptor **[DEC-33]**~~ ⚠ **Amended 2026-08-19 by [DEC-71]** — the **active admin accounts of the company except the acceptor**, because only an admin can answer it **[F13-R44]** |
| `approvalRequested` | approval id, action type, subject, raised-by, raised-at | ⚠ **New 2026-08-19 [DEC-71]** — the non-trade four-eyes actions §2.10: bank account added or deactivated, user added, withdrawal requested. Same recipient rule |
| `tradeStateChanged` | trade id, new state, reason | The company |
| `walletBalanceChanged` | new balances | The company |
| `depositReceived` | amount, value date, new balance | ⚠ **New 2026-08-19 [DEC-106]** — the initiating account plus the company's notification addresses; the **email** carrying the same news **[F07-R27]** is the reason a customer need not watch the balance after wiring |
| `notificationCreated` | notification summary | The addressed account |

⚠ **Cost of the narrower recipient set, recorded because [DEC-63]'s rationale was exactly this.** A
30-minute offer can now die because one person is in a meeting. **[DEC-18]** still allows **any**
active account to accept, so the notification is deliberately narrower than the permission — the
platform tells fewer people than it allows to act, and accepts that a missed offer is the price
**[F05-R65]**, **[DEC-111]**.

### 2.10 Approvals — four-eyes **[DEC-71]**

⚠ **New section 2026-08-19.** **[DEC-71]** puts **five** actions behind a second admin's approval when
the customer company has four-eyes enabled. Only one of them — *execute a trade*, meaning accept an
offer — already had verbs on this API §2.4. The other four had none, because they were not customer
actions at all: PeakPower employees add bank accounts and users **[DEC-16]**. The approval is
therefore a **customer-side gate on an employee-side action**, and it needs a surface of its own.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/approvals?state=PENDING` | The queue: everything waiting on this company's admins |
| `GET` | `/approvals/{id}` | One item with its subject and the raising actor |
| `POST` | `/approvals/{id}/approve` | Approve. **Admin only, and never the raising account** **[F13-R44]** |
| `POST` | `/approvals/{id}/decline` | Decline, optionally with a reason. Terminal |

```jsonc
// GET /api/v1/approvals?state=PENDING
{
  "total": 2,
  "items": [
    {
      "id": "apr-0117",
      "action": "BANK_ACCOUNT_ADD",
      "subject": { "type": "BANK_ACCOUNT", "id": "ba-0009", "summary": "NL00 BANK 0123 4567 89" },
      "raisedBy": { "type": "EMPLOYEE", "name": "PeakPower Onboarding" },
      "raisedAt": "2026-08-19T08:41:00+02:00",
      "canCurrentAccountApprove": true
    },
    {
      "id": "apr-0118",
      "action": "WITHDRAWAL",
      "subject": { "type": "WITHDRAWAL", "id": "wdr-0034", "amount": { "amount": "25000.00", "currency": "EUR" } },
      "raisedBy": { "type": "CUSTOMER", "accountId": "acc-0044", "name": "M. Vandersteen", "jobTitle": "Finance Director" },
      "raisedAt": "2026-08-19T09:10:00+02:00",
      "canCurrentAccountApprove": false,
      "expiresAt": null
    }
  ]
}
```

`action` is one of **`TRADE_ACCEPT`**, **`BANK_ACCOUNT_ADD`**, **`BANK_ACCOUNT_DEACTIVATE`**,
**`USER_ADD`**, **`WITHDRAWAL`** — the five and no others. **`DEPOSIT` is deliberately not in the
enumeration** **[DEC-71]**: a customer can wire money or use iDEAL on their own, so gating a deposit
gates nothing that is not already ungated.

Three shape decisions, each with a reason.

- **One queue to read, action-native verbs to act — with one exception.** `TRADE_ACCEPT` items appear
  in this queue for visibility, and are decided on `POST /trades/{id}/approve` §2.4, because the trade
  has a clock, a reservation and a state machine that the generic endpoint would have to reimplement
  **[F05-R61]**, **[F05-R62]**. The other four actions are decided here. Both paths write the **same
  approval record**, so the audit trail is one trail and not two **[DEC-17]**.
- **`expiresAt` is `null` for everything except a trade.** The trade's approval window is the offer's
  own `expires_at` and there is no second clock **[F05-R61]**. A pending bank account or user addition
  has no deadline — it waits, and the record shows how long it has waited. ⚠ A withdrawal held pending
  keeps the customer's own money reserved **[F07-R29]**, which is a cost the *customer* bears for
  their own mode; the platform does not time it out and quietly release it.
- **Nothing here is an employee action.** There is no approve, decline or override endpoint on the
  Employee API §3 — the back office **observes** the trail and offers no action on it **[F12-R42]**.
  An override would be one pair of eyes wearing PeakPower's badge, which is the control it is meant to
  be.

Error `type` URIs, all `409`: `…/errors/self-approval-not-permitted`, `…/errors/admin-role-required`,
`…/errors/approval-already-decided`.

### 2.11 Customer usage API — **[DEC-97]**

⚠ **New section 2026-08-19.** Customers get **programmatic access to their own usage data, and to
nothing priced** **[DEC-97]**. This is a second surface on the same host as the portal BFF, not a
fourth host: same Entra tenant, same `customer_id` scoping through the same global query filter
**[F13-R46]**, same rate limiting, one deployment
([Solution structure](02-solution-structure.md) §1, **[DEC-02]** unchanged).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/usage/intervals?from=&to=&meteringPointIds=` | Interval net usage — the same rollups the chart reads **[F03-R27]** |
| `GET` | `/usage/aggregate?from=&to=&granularity=DAY\|MONTH&meteringPointIds=` | Aggregated net usage |
| `GET` | `/usage/metering-points` | The calling company's EANs, so a client can discover what it may ask for |

```jsonc
// GET /api/v1/usage/intervals?from=2026-08-12&to=2026-08-12&meteringPointIds=mp-1
{
  "from": "2026-08-12",
  "to": "2026-08-12",
  "granularity": "PT15M",
  "rowCount": 96,
  "series": [
    {
      "meteringPointId": "mp-1",
      "ean": "871685900000000000",
      "dataState": "PROVISIONAL",
      "intervals": [
        { "start": "2026-08-12T00:00:00+02:00", "end": "2026-08-12T00:15:00+02:00",
          "consumptionKwh": "180.000", "productionKwh": "0.000", "netUsageKwh": "180.000" }
      ]
    }
  ]
}
```

Four rules govern this surface, and three of them are stated as *absences*.

| Rule | Why |
| --- | --- |
| **Usage only — no price of any kind** | No forward price, no indication, no day-ahead value, no €-figure derived from one **[DEC-81]**, **[DEC-27]**, **[F13-R47]**, **[NFR-67]**. Enforced by **the surface not carrying those endpoints**, not by a role check a later change could relax |
| **No block, coverage or trade data** | Not forbidden by a decision, but out of what **[DEC-97]** put in scope: it is a *usage* API. The portal remains the place where usage meets position |
| **Company scope only** | A usage credential reads **its own company's** usage and nothing else — no cross-company scope, no employee scope, no "all customers" mode **[F13-R46]**. `404`, not `403`, on another company's EAN **[F13-R19]** |
| **`dataState` on every series** | The same provisional/final state the portal shows **[F02-R23]**. A machine consumer that cannot tell provisional data from final will reconcile against a figure that is still allowed to move |

`rowCount` is capped at **35 040 rows per response** — one metering point-year at quarter-hour
resolution, `365 × 96 = 35 040` — and the surface is limited to **60 requests/minute, burst 120**, per
calling company **[NFR-62]**; §6. Over-limit is `429` with `Retry-After`. Latency target **p95 500 ms**
for a one-month, one-metering-point range **[NFR-61]**.

⚠ **The transport is not decided — [OQ-95].** The source names an API *or* FTP without choosing. This
section specifies the HTTP shape because it is the one that constrains the rest of the architecture; if
**[OQ-95]** lands on file delivery, the same fields and the same scope rule become a scheduled export
in `PeakPower.Jobs` and these routes are not built. The scope rule is written **before** the transport
deliberately: it holds whichever is chosen.

⚠ **The credential is not decided either, and it is the harder half.** The portal's token is an
interactive user token with an `amr` claim §1.2; an unattended client has no human to second-factor.
Whatever **[OQ-95]** resolves to, this surface needs a **machine credential with its own lifecycle**,
its own rate limits and no `customer.admin`, and **[DEC-92]**'s MFA rule cannot be the control on it —
which is why **[F13-R46]** puts the tenancy scope, not the authentication strength, in the load-bearing
position. It rides on the **[DEC-67]** claim-mapping spike, which now has three claims and a machine
identity to prove against the corporate tenancy.

## 3. Employee API

Explicitly cross-customer; `customerId` is a real parameter here.

### 3.1 Trade desk

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/trade-desk/queues` | The **four** queues with counts **[F12-R06]** |
| `GET` | `/trades?state=&customerId=&…` | Search |
| `GET` | `/trades/{id}` | Full detail: position, wallet, indication, internal notes, four-eyes status |
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

The trade detail carries a `fourEyes` block so the trader can size the window before publishing
**[F12-R35]**, and so the desk can flag a customer that cannot clear the control **[F12-R36]**:

```jsonc
// GET /api/v1/trades/{id}   — employee view, excerpt   ⚠ reshaped 2026-08-19 by [DEC-71]
{
  "fourEyes": {
    "enabled": true,
    "activeAdminCount": 1,
    "canBeApproved": false,
    "warning": "This customer runs four-eyes and has one active admin account. Every trade of theirs needs a second admin, and none is available."
  }
}
```

⚠ **Removed here as well: ~~`threshold`~~, ~~`thresholdVersion`~~, ~~`thresholdScope`~~ and
~~`estimateAboveThreshold`~~ [DEC-71].** The trader's question changes from *"is this one above their
number?"* to *"does this customer run four-eyes?"* — which is true for **every** trade of that company
or none of them **[F12-R35]**. That makes the reaction-window decision simpler and the desk's flag
sharper: ~~fewer than two active accounts~~ **fewer than two active *admin* accounts** is the
unclearable case **[F12-R36]**, and it is rarer than it was, because **[F12-R41]** refuses to enable
the mode below two admins.

There is **no employee endpoint that approves on the customer's behalf**, deliberately, and
**[DEC-71]** does not add one: the back office observes the four-eyes trail and offers no action on it
**[F12-R42]**. An override would be one pair of eyes wearing PeakPower's badge, which is the control it
is meant to be. `POST /trades/{id}/confirm` refuses with `409 approval-required` while a trade is
`AWAITING_APPROVAL` **[F05-R66]**.

### 3.2 Customers, wallets, withdrawals, payments, invoicing, data, reference data

⚠ **Reshaped 2026-08-19.** Four groups are new — withdrawal payout **[DEC-83]**, unmatched-payment
matching **[DEC-106]**, energiebelasting brackets and per-customer reductions **[DEC-74]**, and BRP
administration **[DEC-69]** — and four are struck: surcharge tariffs **[DEC-73]**, four-eyes
thresholds **[DEC-71]**, wallet thresholds **[DEC-90]** and manual wallet adjustments **[DEC-85]**.
The push endpoint replaces finalisation and the **returned number is stored, never minted**
**[DEC-88]**, **[F10-R44]**.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`/`POST`/`PATCH` | `/customers`, `/customers/{id}` | Administration |
| `POST` | `/customers/{id}/metering-points` | Attach an EAN |
| `GET` | `/customers/{id}/accounts` | List the company's accounts |
| `POST` | `/customers/{id}/accounts` | Create an account and send the invitation |
| `PATCH` | `/accounts/{accountId}` | Edit name, job title, phone, email. Username is immutable |
| `POST` | `/accounts/{accountId}/deactivate` | Deactivate and revoke sessions |
| `POST` | `/accounts/{accountId}/resend-invitation` | Reissue; invalidates the previous link. ⚠ Under four-eyes **no invitation is sent** until the second admin approves the addition **[F01-R49]** |
| `PATCH` | `/accounts/{accountId}/admin` | ⚠ **New 2026-08-19 [DEC-71]** — set or clear the account's **admin** flag **[F01-R47]**, **[F12-R39]**. Refused when it would leave a four-eyes company with fewer than two active admins **[F01-R50]** |
| `POST` | `/customers/{id}/four-eyes/enable` \| `/disable` | ⚠ **New 2026-08-19 [DEC-71]** — turn the mode on or off for a company **[F12-R40]**. Enabling with **fewer than two active admin accounts is refused** **[F12-R41]**. Audited before/after **[DEC-17]**; it takes effect for actions started after it, and does not release a trade already `AWAITING_APPROVAL` |
| `GET`/`POST` | `/customers/{id}/bank-accounts` | ⚠ **New 2026-08-19 [DEC-71]** — add a bank account. **No `PATCH`**: a bank account cannot be edited, only added or deactivated **[F01-R44]**. Under four-eyes it lands `PENDING_APPROVAL` §2.10 **[F01-R45]** |
| `POST` | `/bank-accounts/{id}/deactivate` | ⚠ **New 2026-08-19 [DEC-71]** — the other half of the pair; also a four-eyes action. A company holds **at most one `ACTIVE`** account, so replacing one activates the new and deactivates the old together **[F01-R46]** |
| `PATCH` | `/metering-points/{id}` | Master data, end-dating, **BRP assignment [DEC-69]**, **[F12-R50]**, and the **production expectation the customer declares at onboarding [DEC-112]**, **[F01-R41]** |
| `GET` | ~~`/wallets?belowThreshold=`~~ `/wallets` | Wallet overview. ⚠ **`belowThreshold` removed 2026-08-19 by [DEC-90]** — there is no threshold to be below. The list can still be **sorted** by lowest available balance; there is no colouring, no warning state and no alert behind it **[F06-R28]**, **[F06-R39]** |
| `GET` | `/wallets/{id}/ledger` | Ledger with actor detail |
| `POST` | `/wallets/{id}/deposits` | Register a bank transfer. ⚠ **Amended 2026-08-19 by [DEC-106]** — this is now the **exception path**, not the normal one: unmatched transfers, payments arriving outside the feed, and everything until **[OQ-93]** is answered **[F07-R17]** |
| ~~`POST`~~ | ~~`/wallets/{id}/adjustments`~~ | ~~Manual adjustment (reason required)~~ ⚠ **Removed 2026-08-19 by [DEC-85]** — chargebacks and reversals are the bookkeeping program's, and the manual-adjustment-with-a-reason path goes with them **[F06-R26]**, **[F06-R27]** retired. ⚠ **Known gap, recorded rather than papered over:** a charged-back iDEAL deposit leaves the wallet overstated and the platform has no entry type left to correct it |
| `GET` | `/withdrawals?state=` | ⚠ **New 2026-08-19 [DEC-83]** — the payout worklist: customer, amount, requester, age, destination bank account, four-eyes state **[F12-R53]** |
| `POST` | `/withdrawals/{id}/pay` | ⚠ **New [DEC-83]** — **record a transfer already made**: value date, amount actually transferred, bank reference. Posts `WITHDRAWAL_PAID` and releases the hold in one transaction **[F12-R54]**, **[F06-R36]**. It is **not** an instruction to the bank; the platform initiates no payment |
| `POST` | `/withdrawals/{id}/reject` | ⚠ **New [DEC-83]** — reason **mandatory**; releases the hold **[F07-R32]** |
| `GET` | `/payments/unmatched` | ⚠ **New 2026-08-19 [DEC-106]** — received payments the platform could not attribute: value date, amount, payer name, payer IBAN, raw description, why matching failed **[F12-R56]** |
| `POST` | `/payments/{id}/match` | ⚠ **New [DEC-106]** — attribute one to a wallet by hand, with a mandatory note. Matching order is **(1)** platform-issued reference — automatic, never reaches this list; **(2)** payer IBAN resolving to exactly one customer — a *proposed* match, confirmed here; **(3)** manual **[F12-R57]**, **[F07-R21]** |
| `POST` | `/invoice-runs` | Start a run |
| `GET` | `/invoice-runs/{id}` | Progress and report |
| `POST` | `/invoices/{id}/recalculate` \| ~~`/finalise`~~ **`/push`** \| `/credit` | Invoice actions. ⚠ **Amended 2026-08-19 by [DEC-88]** — **there is no finalisation step**: review, recalculate **[F10-R14]** and discard **[F10-R15]** happen in the platform, then the draft is **pushed** to the bookkeeping program, which numbers and issues it **[F12-R58]**. `DRAFT → PUSHED → NUMBERED` replaces `FINALISED` **[F10 §6]** |
| `POST` | `/invoices/{id}/corrections` | ⚠ **New 2026-08-19 [DEC-99]** — raise a **correction invoice for the delta**, at any time, on the corrected volumes at the **original month's prices** **[F10-R49]**. Pushed as a draft like any other document. Every non-zero difference, individually — no materiality threshold **[DEC-100]**, **[F10-R50]** |
| ~~`POST`~~ | ~~`/true-up-runs`~~ **`/energy-tax-close-runs`** | ~~Annual true-up. ⚠ Deferred with energiebelasting — **[DEC-24]**~~ ⚠ **Reinstated and narrowed 2026-08-19 by [DEC-74]** and **[DEC-99]** — the January run settles the **calendar-year energiebelasting tiers per EAN** and nothing else; every other correction is continuous **[F10-R27]**, **[F10-R29]**. The path is renamed because "true-up" no longer describes what it does |
| `GET` | `/data-health/metering-points` | Ingestion health, including metering points with **no BRP assigned** — a configuration error, not a gap **[F12-R26]**, **[F12-R50]** |
| `GET` | `/data-health/messages?brpId=` | Inbound message log, **filtered by BRP [DEC-69]**. PVNed is one row in that filter, not the whole log **[F12-R27]** |
| `POST` | `/data-health/messages/{id}/replay` | Replay. The stored `brp_id` selects the adapter, so a replay is parsed by the adapter that first parsed it — including after that BRP is deactivated **[F02-R41]** |
| `GET` | `/data-health/quarantine` | Unattached series, including `WRONG_BRP` **[F02-R42]** |
| `GET`/`PUT` | `/reference/peak-calendars` | Calendars |
| ~~`GET`/`PUT`~~ | ~~`/reference/tax-tariffs`~~ **`GET`/`POST` `/reference/energy-tax-brackets`** | ~~Energiebelasting. ⚠ Endpoint retained, tariffs unpopulated — **[DEC-24]**~~ ⚠ **Reversed 2026-08-19 by [DEC-74]** — energiebelasting is **back in scope and populated**. Per **calendar year**, an ordered set of tiers with lower and upper bound in kWh and a rate in €/kWh; the top tier is unbounded **[F12-R44]**. **Versioned, never edited in place**: `POST` creates a new version with a `valid_from`; a version a completed calculation has read can only be superseded **[F12-R45]**. `PUT` is gone with the in-place edit |
| `POST` | `/reference/energy-tax-brackets/validate` | ⚠ **New [DEC-74]** — contiguity, no gap, no overlap, ascending bounds, year fully covered, **plus the blast radius**: how many customers and EANs the version affects and from when **[F12-R47]**. A wrong boundary silently mis-taxes every EAN for a year |
| `GET`/`PUT` | `/customers/{id}/energy-tax-reduction` | ⚠ **New [DEC-74]** — the minority case: no reduction (the default, ~90% of customers), a **percentage reduction applied per bracket**, or a full exemption, with `valid_from`, `valid_to`, a mandatory reason and the ruling or certificate that justifies it **[F12-R46]**. Per customer, not per EAN |
| ~~`GET`/`PUT`~~ | ~~`/reference/surcharges`~~ | ~~Surcharges~~ ⚠ **Removed 2026-08-19 by [DEC-73]**, reversing **[DEC-35]**. Topups leave the platform entirely: it pushes the **invoiced volume per EAN** and the bookkeeping program multiplies by the topup fee **[F10-R51]**. A rate stored here would be a second source of truth for PeakPower's margin |
| ~~`GET`/`PUT`~~ | ~~`/reference/four-eyes-thresholds`~~ | ~~Four-eyes thresholds **[DEC-33]**, scoped `GLOBAL_DEFAULT` or per customer, with `valid_from`/`valid_to`. ⚠ **Ships with no rows — the value is not decided.** Until one is in force, acceptance returns `409 four-eyes-threshold-not-configured` **[F05-R53]**~~ ⚠ **Removed 2026-08-19 by [DEC-71]** — there is **no threshold**, in euros or in megawatts, so the table is **not built** rather than shipped empty **[F13-R42]**. Four-eyes is a **per-company flag**, set through `/customers/{id}/four-eyes/enable` above |
| `GET`/`PUT` | `/reference/price-products` | Montel mapping. ⚠ Under **[DEC-96]** the poll goes through the **existing PeakPower Montel service**, not the Montel API directly **[F04-R01]** |
| `GET`/`PUT` | `/reference/price-markup` | ⚠ **New 2026-08-19 [DEC-80]** — the **markup percentage** applied to every customer-facing indication: one platform-wide value, **default 2%**, effective-dated, changed **without a release**, audited before/after **[F12-R48]**, **[F04-R18]**. ⚠ It is now the platform's **only** margin instrument — **[DEC-73]** took the surcharge out — so a wrong value here is wrong on every quote |
| `GET`/`POST` | `/reference/brps` · `PATCH` `/reference/brps/{id}` | ⚠ **New 2026-08-19 [DEC-69]** — a **BRP** is reference data: name, endpoint, credentials, document format / adapter, and the direction and trigger of the exchange **[F12-R49]**. **Credentials are write-only** — replaced, never read back — and rotation is audited like any other reference-data change **[F12-R24]**. PVNed is the first row, not the only one **[F02-R44]** |
| ~~`GET`/`PUT`~~ | ~~`/reference/wallet-thresholds`~~ | ~~Alert rules~~ ⚠ **Removed 2026-08-19 by [DEC-90]**, reversing **[DEC-49]**. No warning amount, no critical amount, no low-balance alert and no `wallet_threshold_rule` **[F06-R39]** |
| `GET` | `/audit?…` | Audit search. Retention is the fiscal **seven years** **[DEC-95]**; the trail covers **actions**, and the financial record of record is the bookkeeping program's |
| `POST` | `/impersonation` | Start a read-only view-as session |

⚠ **Three endpoints that will never be added, stated so nobody adds them.**

| Never | Why |
| --- | --- |
| A feed-in tariff CRUD | **[DEC-87]** reverses the second half of **[DEC-44]**: exported volume is credited at the **day-ahead price, raw**, exactly as surplus is under **[DEC-23]**. There is no feed-in tariff and therefore no `MISSING_FEED_IN_TARIFF` and no skip **[F10-R42]** retired |
| An invoice-numbering endpoint | The bookkeeping program owns numbering **[DEC-88]**. The platform **stores** the returned number and never mints one, so there is no sequence to configure and no gap to repair |
| An invoice PDF or email endpoint | **[DEC-89]**. **[DEC-48]** (SendGrid) narrows to the platform's **own** notifications: offers, wallet events, alerts |

## 4. Worker endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | ~~`/webhooks/pvned`~~ `/webhooks/brp/{brpCode}` | Per adapter: mTLS, shared secret or IP allow-list, and more than one at once **[AS-16]**, **[OQ-05]** | ⚠ **Amended 2026-08-19 by [DEC-69]** — **one endpoint per configured BRP adapter** **[F02-R01]**, **[F02-R39]**. The PVNed adapter's endpoint is the SOAP `TimeSeriesDocument` one, unchanged in content **[F02-R44]**; it is now one route among several rather than *the* ingestion route |
| `POST` | `/webhooks/payments/{provider}` | Signature verification | Payment status. ⚠ **No PSP is chosen [DEC-86]** — the route exists because the port does; the provider is a candidate list, not a commitment |
| `POST` | `/webhooks/bank/{feed}` | Signature / mTLS, **[OQ-93]** | ⚠ **New 2026-08-19 [DEC-106]** — incoming-payment lines for **wallet deposits only**: match on the platform-issued reference, credit, email the customer **[F07-R25]**, **[F07-R27]**. **Idempotent on the bank transaction id**, not on amount-and-reference **[F07-R18]**. Debit lines are not actioned — the matcher reads credits only **[F07-R25]**, **[F07-R34]**. ⚠ Whether this is a push at all — CAMT.053 import and a PSP webhook are the alternatives — is **[OQ-93]**; invoice payments are **not** matched here, they are the bookkeeping program's **[DEC-105]** |
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

| Scope | Limit | Source |
| --- | --- | --- |
| Customer API, per user | 300 req/min | — |
| Customer API, `POST /trades*` | 20 req/min | — |
| **Customer usage API, per calling company** | **60 req/min, burst 120**; at most **35 040 interval rows** per response | **[NFR-62]**, **[DEC-97]** — §2.11. Limits are reference data, not constants **[NFR-54]** |
| Employee API, per user | 600 req/min | — |
| ~~PVNed webhook~~ **BRP webhook, per BRP** | 60 req/min, burst 200 | ⚠ **Amended 2026-08-19 by [DEC-69]** — the limit is **per BRP**, so a noisy adapter cannot throttle a quiet one **[F02-R39]** |
| Payment webhook | 120 req/min | — |
| Bank feed webhook | 120 req/min | **[DEC-106]**, **[OQ-93]** |

Exceeding returns `429` with `Retry-After`.

## 7. OpenAPI

Both APIs publish OpenAPI 3.1 documents, and the Angular clients are generated from them. A snapshot
test flags breaking changes against the previous release. ⚠ **The usage API §2.11 is in the customer
API's document, not a third one [DEC-97]** — it is a surface on that host, so it shares the document,
the version and the snapshot test. It has **no generated Angular client**: its consumers are the
customers' own systems, which is exactly why its breaking changes are the ones that hurt, and why
expand/contract below applies to it most strictly of all.

⚠ **Three renames in this round are breaking and go through expand/contract deliberately**:
`totalValue` → `totalValueExVat` beside a larger `amountToReserve` **[DEC-78]** §2.4, the `fourEyes`
block losing its threshold fields **[DEC-71]** §2.4, and `changeVsPreviousClose` leaving the price
board **[DEC-81]** §2.3. Each was reshaped rather than reinterpreted, because leaving a familiar field
name attached to a different number is the failure mode that costs money.

⚠ **[DEC-55] weakened the guarantee this section used to make.** With a single repository, generation
happened at build time and a contract change broke CI rather than production. With separate .NET and
Angular repositories the client crosses a repository boundary, so **nothing fails automatically** —
the web build keeps compiling against the last published client until someone republishes it.

What replaces it, per [Solution structure](02-solution-structure.md) §5.1: the client is published as
a versioned package, the API repository fails its own build when the OpenAPI document changes without
a version bump, and **expand/contract now applies to the HTTP contract as well as to the schema** —
the API ships the additive change first, the web repository consumes it, and only then is the old
shape removed. The safety property is preserved deliberately rather than for free.

## 8. Open questions

| Ref | P | Question | What it decides in this contract |
| --- | :--: | --- | --- |
| [OQ-05] | ⏸ | ~~PVNed webhook authentication and acknowledgement format~~ **Closed for the PoC only [DEC-21]**; the mechanism the real BRP requires is still unconfirmed | ⚠ **Widened by [DEC-69]** — it is now a question **per BRP**, not one question: each adapter owns its route, its authentication and its acknowledgement format **[F02-R39]**, **[F02-R08]**. §4 |
| ~~[OQ-55]~~ | ✅ | ~~Does any customer need programmatic API access of their own?~~ **CLOSED — yes, for usage data and for nothing priced** **[DEC-97]** | §2.11 exists because of it. What it did **not** settle is the transport, which is [OQ-95] |
| [OQ-95] | 🟡 | Is customer usage delivered over an API, over file/FTP, or both? | Whether §2.11's routes are built at all. If file delivery wins, the same fields and the same scope rule become a scheduled export and these routes are not built **[F13-R47]** |
| [OQ-93] | 🟠 | Which incoming-payment feed does the platform consume for wallet deposits — CAMT.053 import, a PSP webhook, or a SEPA-instant push? | Whether `/webhooks/bank/{feed}` §4 is a webhook or an import job, and what the portal may honestly promise about timing **[F07-R16]**. Blocks the bank-transfer deposit route **[DEC-106]** |
| [OQ-94] | 🟠 | What collateral or exposure limit applies to a short position? | Nothing in the contract shape — §2.4.1 already removes the holdings check **[DEC-72]** — and everything about whether the sell path may be opened to volumes beyond confirmed holdings **[F05-R69]** |
| [OQ-92] | 🟠 | Are the hedge and the day-ahead delivery one invoice document or two? | How many drafts `POST /invoices/{id}/push` produces per customer per month, and therefore how many numbers come back **[DEC-88]**, **[F10-R21]** |
| [OQ-96] | 🟠 | Does the *vermindering* (the fixed annual reduction on energiebelasting) apply, and to which connections? | The energiebelasting amount on every affected invoice, and whether `/customers/{id}/energy-tax-reduction` needs a second, per-connection shape beside the per-customer one **[DEC-74]**, **[F12-R46]** |
| [DEC-67] | 🟠 | *(spike, not a question)* Claim mapping against the corporate tenancy | §1.2's three claims and §2.11's machine credential are all proven there. The local OIDC container **[F13-R32]** can prove the claim *contract* but not the values Entra emits |
