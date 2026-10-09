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
| Money | `{ "amount": "1234.56", "currency": "EUR" }` — **string** to avoid float parsing, as originally specified. ⚠ **Note added 2026-09-23 by [DEC-161], correcting rather than reusing this row's original framing.** Every customer-facing money field this platform has actually built is a **bare `decimal`**, not the string-wrapped envelope above — there is no `{ amount, currency }` type anywhere in `PeakPower.Contracts`. `WalletSummaryResponse.SettledBalance`/`ReservedAmount`/`AvailableBalance` and the wallet deposit/withdrawal `Amount` fields are all plain, **non-nullable** decimals. `ConsumptionIntervalDto.PriceEurPerKwh`/`CostEur` and `ConsumptionSummaryDto.TotalCostEur` are the one built exception that is **nullable**: a range with nothing measured or priced totals `null`, never `0.00`. The price-indications payload (§2.3) follows the bare-decimal convention and, like the consumption fields, is nullable: `price` is a bare, nullable `decimal` at 4 dp, with `currency` as a separate sibling field, because a string-wrapped amount has no honest representation for `UNAVAILABLE` (`"0.00"` reads as a real price, not as an absence). It is not an exception to the bare-decimal shape — only the wallet balance/amount fields are non-nullable; nullability, not the envelope, is what genuinely varies across this platform's built DTOs. This row's original text was aspirational rather than descriptive of anything built |
| Energy | `{ "value": "744.000000", "unit": "MWH" }` |
| Volume granularity | Requested power is MW with a **minimum of 0,01 MW and in multiples of 0,01 MW** **[DEC-70]** — §2.4.1 |
| Prices | Every customer-facing indication is the quote **× (1 + markup)** **[DEC-80]**; there is **no price history and no price export** on any customer surface **[DEC-81]** — §2.3 |
| Paging | `?page=1&pageSize=50`, response envelope with `total`, `page`, `pageSize` |
| Sorting | `?sort=field:asc,other:desc` |
| Idempotency | `Idempotency-Key` header required on all state-changing POSTs |
| Concurrency | `If-Match` with an ETag on updates that can conflict |
| Correlation | `X-Correlation-Id` accepted and echoed; generated if absent |
| Authentication strength | A customer token must **evidence multi-factor authentication** **[DEC-92]** — §1.2. ⚠ **Suspended 2026-09-03 by [DEC-119]:** the token carries `amr: ["pwd"]` and **nothing rejects on it** |
| Roles | ~~Every customer token carries `customer.user`; an admin carries `customer.admin` beside it~~ ⚠ **Corrected 2026-09-03:** there is **no `roles` claim**. ~~The role model is a boolean `is_admin` claim **[DEC-71]**, **[F13-R43]**~~ — §1.2. ⚠ **Removed 2026-09-10 by [DEC-152]: there is no `is_admin` claim either, nor a role claim of any kind.** The token carries no role at all; `customer.customer_membership`, read fresh on every request, is the sole authority |
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
| ~~`roles`~~ ~~`is_admin`~~ **(no role claim)** | ~~`customer.user`, plus `customer.admin` for an admin~~ ~~`"true"` / `"false"`~~ **nothing** | ⚠ **Removed 2026-09-10 by [DEC-152]: the token carries no role of any kind.** The database is the sole authority. On every request the middleware reads `customer.customer_membership` for the account and the claimed business and puts the resulting `membershipRole` on `ICustomerContext` — and a **claimed business with no active membership row is refused before `app.customer_id` is honoured**, so the customer-id claim is now a *claim* proven per request rather than a fact carried in the token. ⚠ **`ICustomerContext.IsAdmin` is removed, not kept alongside the role.** Two sources of truth for one fact is how a demoted admin keeps admin rights for the rest of a fifteen-minute token. ⚠ **The property gained** is that demotion and removal take effect on the **next request** rather than at expiry — which is what **[DEC-117]**'s `stamp` comparison bought for the flag, now got structurally instead. Original text: *"Decides who may raise and who may approve a four-eyes action **[DEC-71]**, §2.10. Nothing else branches on it — an admin reads and writes exactly what a non-admin does **[F13-R41]**. ⚠ Corrected 2026-09-03: there is no `roles` claim and no `customer.*` role vocabulary. The flag is one boolean claim, and `ICustomerContext` reads that."* |
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

⚠ **The whole paragraph above is withdrawn 2026-09-10 by [DEC-152], and is kept because it is the
argument that has to be re-made if a role ever returns to a token.** There is no `is_admin` claim to
re-validate, no re-validation to achieve by a different mechanism, and no admin vocabulary on this
API. `four_eyes_enabled` is still deliberately not a claim, for the reason given — it is company
reference data read server-side — and that half of the paragraph survives unchanged.

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
| `POST` | `/auth/sign-in` | Username and password for an access token (15 min) and a rotating refresh cookie. `200` or `401`; the `401` is **byte-identical** for a wrong password, an unknown username and a deactivated account — one branch, one constant response, deliberately no oracle. ⚠ **Amended 2026-09-10 by [DEC-152]: which business it signs into.** The account can belong to several now: sign-in lands in `last_active_business_id` if that membership is still live, otherwise the **oldest** membership by `created_at`, tied by `id` — never an arbitrary one (`AuthEndpoints.cs:751-767` @ debadda0). A right password on an account with **no live membership anywhere** is a *different*, named `401` — `no-business-access` (`:981-991`) — deliberately not folded into the constant response above: the password was right, so nothing should imply otherwise |
| `POST` | `/auth/refresh` | Rotates the HttpOnly `pp_refresh` cookie. No request body: the cookie **is** the credential. ⚠ **Amended 2026-09-10 by [DEC-152]: refresh re-proves membership.** Every rotation re-checks that the account still holds a live membership in the chain's own business (`:390-414`) — without it a removed member's refresh would loop forever, quietly re-minting for a business already left. A chain whose business the account has left gets a **terminal** `401`, `…/problems/membership-revoked` (`:853-861`), distinct from the ordinary `session-expired` `401` every other refusal shares — the one refusal a client must react to by signing out, not by retrying |
| `POST` | `/auth/sign-out` | ⚠ **Narrowed 2026-09-10 by [DEC-152]: per business, not every session for this account.** Revokes the refresh chain **for the business the presented token is currently acting for** — `customer.refresh_token`'s policy is `customer_id = app.customer_id`, and an authenticated connection never sees another business's rows (`:313-333`). `204`. An account signed into several businesses signs out of each one separately; the missing "sign out everywhere" gesture is registered debt on **[DEC-152]**, next to **[OQ-105]** |
| `GET` | `/auth/me` | The signed-in account. ⚠ **Amended 2026-09-10 by [DEC-152]: loses `isAdmin`, gains `membershipRole` and `memberships`.** The body is `{ accountId, customerId, firstName, lastName, email, membershipRole, memberships: [{ customerId, tradeName, membershipRole }] }` — `customerId` is the **active** business (`ICustomerContext.CustomerId`, proven this request), `membershipRole` is read off `ICustomerContext.Role` and never re-queried (`:256-263`), and `memberships` lists every business this login belongs to, for the switcher below |
| `POST` | `/auth/active-business` | ⚠ **New 2026-09-10 [DEC-152]** — switch this session to another business the same login belongs to: `{ customerId }`, authenticated. **Mints a whole new session** (the same body sign-in and refresh answer with) rather than flipping a flag, and **revokes nothing**: the pre-switch cookie stays bound to the business it was issued for, still re-proves membership in it and still mints only tokens for it — switching is additive, not a replacement (`:619-723`, the reasoning at `:695-705`). `404`, never `403` **[F13-R19]**, for a business this login holds no live membership in — indistinguishable from one that does not exist; `400` for a request naming no business at all |
| `POST` | `/auth/password-reset/requests` | Always `202`, whether or not the address exists **[DEC-113]** |
| `POST` | `/auth/password-reset/completions` | Token plus new password. `204`, and every session for that account dies with it |
| `GET` | `/.well-known/jwks.json` | The ES256 verification key **[DEC-117]**. Anonymous by definition |

**Onboarding [DEC-113]** — the nine-step self-service wizard. **Every route here is anonymous**: a
prospect has no company and no token until step 9 signs.
⚠ **As built 2026-10-02, [DEC-171] (5), (6):** step 1 sends `termsAccepted: true` on the click of *Create account* (no tick), and step 6 may be saved with a blank IBAN (*Skip*). The step 2 search box has the placeholder *Business name or KvK number*, and step 9 shows the sign-code expiry as content. No contract changes. ⚠ **Amended 2026-10-05 by [DEC-174] (9):** the platform now also stores, server-side, the Terms of Use version current at that instant in `terms_version_id`; the request is **unchanged** and the client never sends a version (§2.12). ⚠ **Amended 2026-10-09 by [DEC-177] (5):** the start request (`POST /onboarding/applications`) gains an optional **`language`** (`en` or `nl`, the portal's UI language; any other value counts as absent); the server stores, beside `terms_version_id`, the language it actually served in `terms_language` (§2.12). The client still never sends a version.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/onboarding/applications` | Start a draft. `201` with `Location`. Optional `language` (`en` or `nl`) **[DEC-177]** |
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

⚠ **As built 2026-10-01, [DEC-169] (4) — `displayLabel` is the name or the unspaced EAN.** The metering-point read models carry `displayLabel` = `name ?? ean` with the EAN as **raw digits, no spaces**, and `ean` is the unspaced EAN; `eanDisplay` (grouped) stays on the wire for the back office but a customer screen no longer prints it. Sorting by `displayLabel` is unchanged.

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
| `GET` | `/dashboard/position?month=YYYY-MM` | The month's position for the Dashboard: metered volume against confirmed BUY blocks. ⚠ Added 2026-10-01 ([DEC-167] (19)) |

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

**Volume position** ⚠ added 2026-10-07 ([DEC-175]). `GET /api/v1/consumption/position?from=YYYY-MM-DD&to=YYYY-MM-DD` — any member; tenant-scoped, with the authentication, tenancy and row-level security of `GET /consumption/intervals`; account-level; at most **92 days**, otherwise `400`; no `meteringPointIds`. A **separate DTO**, so [DEC-149] holds: the consumption DTOs gain no block field. The server does not gate it on Future Trading; the portal calls it only when the product is held. Dense: every quarter-hour of the range, the future included. Not documented, published or opened for programmatic use ([F03-R26]). Calculation, null, partial and totals rules: [DEC-175] (4), (5); the field names are those of the generated OpenAPI document.

```jsonc
// GET /api/v1/consumption/position?from=2026-11-01&to=2026-11-01   (illustrative values; the day is dense, two of its 96 intervals shown)
{
  "from": "2026-11-01", "to": "2026-11-01", "dayCount": 1, "connectionsExpected": 3,
  "days": [
    { "date": "2026-11-01", "intervalCount": 96, "connectionsExpected": 3,
      "intervals": [
        { "pos": 33, "start": "2026-11-01T08:00:00+01:00", "end": "2026-11-01T08:15:00+01:00", "dstPass": null,
          "hedgeKwh": 2500.0, "hedgeCostEur": 175.0,       // always present, also in the future
          "netUsageKwh": 2310.5,                            // null when not metered; everything below it is then null
          "priceEurPerKwh": 0.08123,                        // day-ahead, may be negative; null when unpriced
          "coveredKwh": 2310.5, "shortKwh": 0.0, "longKwh": 189.5,
          "buyLegEur": 0.0, "sellLegEur": 15.39,            // sell leg is a credit; both null when unpriced
          "actualCostEur": 159.61,                          // hedge cost + buy leg - sell leg
          "costWithoutHedgeEur": 187.68,                    // net usage x price: today's costEur
          "connectionsReported": 3, "partial": false },
        { "pos": 34, "start": "2026-11-01T08:15:00+01:00", "end": "2026-11-01T08:30:00+01:00", "dstPass": null,
          "hedgeKwh": 2500.0, "hedgeCostEur": 175.0,       // a future or unmetered interval: the hedge only
          "netUsageKwh": null, "priceEurPerKwh": null, "coveredKwh": null, "shortKwh": null, "longKwh": null,
          "buyLegEur": null, "sellLegEur": null, "actualCostEur": null, "costWithoutHedgeEur": null,
          "connectionsReported": 0, "partial": false }
      ] }
  ],
  "blocks": [ { "id": "...", "reference": "...", "direction": "BUY", "shape": "BASE", "periodCode": "...",
                 "deliveryStart": "2026-11-01", "deliveryEnd": "2026-12-01", "powerMw": 10.0, "priceEurMwh": 70.0 } ],
  "totals": {
    "meteredIntervals": 1, "costedIntervals": 1, "partialIntervals": 0,
    "netUsageKwh": 2310.5, "coveredKwh": 2310.5, "shortKwh": 0.0, "longKwh": 189.5,
    "coveragePct": 100.0,                                   // sum covered / sum max(U, 0); null when that sum is 0
    "meteredHedgeKwh": 2500.0, "meteredHedgeCostEur": 175.0,
    "rangeHedgeKwh": 5000.0, "rangeHedgeCostEur": 350.0,    // the whole range, measured or not
    "cost": { "hedgeCostEur": 175.0, "buyLegEur": 0.0, "sellLegEur": 15.39,
              "actualCostEur": 159.61, "costWithoutHedgeEur": 187.68 }   // metered AND priced intervals only; null when none
  }
}
```

**Dashboard position** ⚠ added 2026-10-01 ([DEC-167] (19)). Any member; tenant-scoped; `month` defaults to the current Amsterdam month, a malformed value is a `400`. A **separate DTO** from the consumption ones, so [DEC-149] holds. The server does not gate it on Future Trading; the portal calls it only when the product is enabled. Definitions (per 15-minute interval, C against the confirmed BUY block energy B) are in [F03](../10-features/F03-consumption-visualisation.md).

```jsonc
// GET /api/v1/dashboard/position?month=2026-10
{
  "month": "2026-10", "monthLabel": "October 2026",
  "asOf": "2026-10-01T09:45:00+02:00", "connectionCount": 3,
  "meteredMwh": 12.4, "hedgedMwh": 9.1, "shortMwh": 2.8, "longMwh": 0.2, "unpricedMwh": 0.5,
  "coveragePct": 73.4, "uncoveredMwh": 3.3, "uncoveredEstimateEur": 214.5,
  "latestDay": { "date": "2026-10-01", "intervals": [ { "start": "2026-10-01T00:00:00+02:00", "consumptionKwh": 180, "blockKwh": 250 } ] }
}
```

Nullables: `asOf`, `uncoveredMwh` and `latestDay` are null when no interval was metered at all; `coveragePct` is null when Σ C is 0, which also covers a month whose intervals are all metered at 0 kWh (a connection shut for the summer), so `latestDay` present does not imply `coveragePct` present; `uncoveredEstimateEur` is null when nothing is metered and also when no interval is priced. The composition total (hedged + short + long + unpriced) equals Σ max(C, B), so it equals `meteredMwh` only when no metered interval has B > C (long can be 0 while unpriced intervals still have B > C): in the example above 12.6 against 12.4.

### 2.3 Prices

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/prices/indications` | Price board — one entry per active product (**24** as of **[DEC-161]**). The price is the raw quote **× (1 + markup)** **[DEC-80]**, **[F04-R17]** ⚠ **Amended 2026-09-29 by [DEC-167]** — the price is the **raw quote as received**, no markup. |
| ~~`GET`~~ | ~~`/prices/indications/{productCode}/history?from=&to=`~~ | ~~Trend~~ ⚠ **Removed 2026-08-19 by [DEC-81]** — customers see the **current** curve and nothing from which an earlier price can be recovered **[F04-R20]**. The observation series is still stored, for **[F04-R10]** and staleness **[F04-R06]**; it is internal |
| `GET` | `/prices/day-ahead?from=&to=` | Day-ahead curve. **Portal surface only** — it is not on the usage API and there is no export of it **[DEC-81]**, **[NFR-67]** ⚠ **Amended 2026-10-01 by [DEC-169]: the day-ahead curve now has an export and a day read — §2.3A — and they are the only price data a customer can export.** |

⚠ **Amended 2026-09-23 by [DEC-161] — payload and roll example replaced.** Additive to §2.3 as it
stood on 2026-08-19, reconciled with the binding interfaces built for Phase 1 of the forward-curve
work:

```jsonc
// GET /api/v1/prices/indications
{
  "disclaimer": "A PeakPower indication. A firm price is given only in response to a trade request.",
  "isSampleData": true,
  "products": [
    {
      "code": "NL_POWER_BASE_M1",
      "displayName": "Base — month +1",
      "shape": "BASE",
      "periodType": "MONTH",
      "deliveryPeriod": "2026-08",
      "deliveryStart": "2026-08-01",
      "deliveryEnd": "2026-09-01",
      "displayOrder": 1,
      "price": 78.4482,
      "currency": "EUR",
      "unit": "MWH",
      "observedAt": "2026-07-30T12:22:11+00:00",
      "status": "FRESH"
    },
    {
      "code": "NL_POWER_BASE_Q1",
      "displayName": "Base — quarter +1",
      "shape": "BASE",
      "periodType": "QUARTER",
      "deliveryPeriod": "2026-Q4",
      "deliveryStart": "2026-10-01",
      "deliveryEnd": "2027-01-01",
      "displayOrder": 13,
      "price": null,
      "currency": "EUR",
      "unit": "MWH",
      "observedAt": null,
      "status": "UNAVAILABLE"
    }
  ]
}
```

⚠ **The roll example is corrected.** Observed on **2026-07-30**, `M1` (`relative_offset 1`, the next
whole calendar month) resolves to **2026-08**, not 2026-09 as an earlier draft of this example showed;
`Q1` resolves to **2026-Q4**, the next whole quarter after the quarter containing 30 July — the second
product is `NL_POWER_BASE_Q1` (quarter **offset 1**, not `NL_POWER_BASE_Q4`, which is the *code* of the
quarter **+4** product and names a different instrument entirely), at `displayOrder` **13**: the seeded
order groups Month (offsets 1–6, `displayOrder` 1–12, Base before Peak at each offset), then Quarter
(offsets 1–4, `displayOrder` 13–20), then Year (offsets 1–2, `displayOrder` 21–24) — see
[database design](04-database-design.md) §7.5 and the seed migration it records. Period-code formats:
a month is `YYYY-MM`, a quarter is `YYYY-Qn`, a calendar year is `YYYY`.

⚠ **Two fields left this payload on 2026-08-19, and one boolean left it again on 2026-09-23.**

| Field | Why it is gone |
| --- | --- |
| ~~`changeVsPreviousClose`~~ | A price and a delta are two prices: the reader recovers the previous close by subtraction, which is exactly the history **[DEC-81]** withholds **[F04-R04]** |
| ~~`rawQuote`~~ / ~~`markupPercent`~~ (never shipped, and never will) | The customer-facing number is the marked-up one **[DEC-80]**, **[F04-R17]**. Price and percentage together disclose the raw quote, so neither the raw quote nor the percentage appears on a customer payload. Both are on the **employee** surface **[F04-R21]** ⚠ **Reversed in part 2026-09-29 by [DEC-167]** — `price` **is** the raw quote now; `markupPercent` still never ships and the percentage still never appears on a customer payload. |
| ~~`isStale: boolean`~~ | **Replaced 2026-09-23 by `status: "FRESH" \| "STALE" \| "UNAVAILABLE"`** **[DEC-161]**. A boolean answers "is it old"; it cannot also answer "does it exist at all" without a second field drifting out of sync with the first — `status` answers both: `price` is `null` exactly when `status` is `UNAVAILABLE`, and so is `observedAt` — whatever the cause (no row for the currently resolved period, no markup in force, or no provider configured at all), the customer surface does not distinguish which **[F04-R07]** |

`price` is therefore the only priced number on this surface, and it is already marked up — a plain,
nullable `decimal` at 4 dp: the bare-decimal shape §1's Money row note now describes for every
customer-facing money field this platform has built, and the nullable trait it shares specifically
with the consumption price/cost fields, not with every built money field (see that row). The
markup itself is reference data with a default of 2%, maintained through the Employee API §3.2
**[F12-R48]** once **[F04-R18]**'s screen ships; for Phase 1 it is the single seeded row
(**[DEC-161]**).

⚠ **Amended 2026-09-29 by [DEC-167] — `price` is the raw quote.** The last paragraph's claims that `price` *"is already marked up"* and that the markup applies at display are **reversed**: `GET /prices/indications` returns the **raw** quote as `price` (4 dp on the wire, unchanged shape); no field is added or removed. The markup table stays and is **unused by customer reads**. The *no markup row in force ⇒ `UNAVAILABLE`* cause listed above no longer applies. The request-panel estimate in `POST /trades/quote` uses the same raw indication (§2.4). Licence caveat before Montel goes live: **[OQ-117]**. ⚠ **As built (2026-09-29, final review) the Prices read no longer consults the markup table at all** — the gate was removed from `IndicationStatusRules`, so `GET /prices/indications` and the request-panel estimate are raw on the same observation (see the "Slice 1 as built" box in F05 and [DEC-167]).

⚠ **As built 2026-10-01, [DEC-169] (3) — four fields on `PriceIndicationDto`, and `price` is unchanged.** `buyPrice` (= `price`, the raw indication), `sellPrice` = `price` − |`price`| × (spread ÷ 100), rounded half away from zero to 2 decimals (the spread comes off the magnitude, so Sell stays below Buy for a negative price too: −50.00 gives −51.00 at 2 percent) with `ForwardPrices:SellSpreadPercent` (default **2**, validated **0–20**), `eodPrice` and `eodObservedAt` — the latest `PriceIndicationObservation` for the product with `ObservedAt` **before today's Amsterdam midnight**, or both null. All four are null when `price` is null. `GET /trades/products` carries `buyPrice` with its `price`. This bends the *one current value* rule of [F04-R20] for the end-of-day price, by a user decision.

### 2.3A Market day-ahead — [DEC-169], added 2026-10-01

Two reads for **any signed-in customer, of any role**. They return **market data with no tenant**, so — like `/prices/indications` — they are classified tenant-agnostic reference data, not tenant-scoped. They are **not** on the usage API ([DEC-97]).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/market/day-ahead?date=YYYY-MM-DD` | One delivery day, **default today in Amsterdam** → `DayAheadDayDto` |
| `GET` | `/market/day-ahead/export.csv?from=&to=&resolution=hour\|quarter` | `text/csv` through `Results.File`, `Content-Disposition: attachment; filename="peakpower-day-ahead-{from}_{to}-{resolution}.csv"`, documented with the `FileDownloadOperationTransformer` pattern |

```jsonc
// GET /api/v1/market/day-ahead?date=2027-03-28   (a DST day: 23 hours)
{
  "date": "2027-03-28", "timeZone": "Europe/Amsterdam",
  "published": true, "source": "ENTSOE",          // ENTSOE | null (the stored value; only ENTSOE is stored, DEC-172)
  "resolutionMinutes": 15,                          // the source's resolution, 15 or 60
  "quarters": [ { "pos": 1, "start": "2027-03-28T00:00:00+01:00", "end": "2027-03-28T00:15:00+01:00", "priceEurMwh": 61.2 } ],
  "hours":    [ { "start": "2027-03-28T00:00:00+01:00", "end": "2027-03-28T01:00:00+01:00", "priceEurMwh": 60.4 } ],
  "averageEurMwh": 71.8,
  "availableFrom": "2026-01-01", "availableTo": "2027-03-29"   // the min and max stored delivery dates
}
```

`hours[]` is the **average of the hour's quarters** — **23 or 25** entries on a DST day. An unpublished day answers `published: false` with empty arrays and a null `source`, not an error. **The CSV** has the columns `delivery_date,start,end,price_eur_mwh,source`, with times as ISO with the Amsterdam offset. **Caps:** `quarter` up to **366 days**, `hour` unlimited within the available range; a bad range (missing, reversed, outside the range or over the cap) is a `400`. Source: [06 ENTSO-E](../30-integrations/06-entsoe-day-ahead.md).

⚠ **As built 2026-10-02 by [DEC-172].** The DTO shape is unchanged (`quarters[]`, `hours[]`, `resolutionMinutes`, `source`). `source` is the stored value passed through, in the DTO and in the CSV column, and only `ENTSOE` is ever stored; it is null when the day is not published. Once a tick with a token has run, `availableFrom` is no earlier than `DayAheadIngestion:BackfillFrom` (2026-01-01), because that tick deletes older rows; with no token nothing is pruned, so a database that already holds older `ENTSOE` rows reports them until the first tick with a token. Both reads are from the database and never call ENTSO-E. The Dashboard draws `quarters[]`.

### 2.4 Trading
| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/trades` | List with state filter |
| `GET` | `/trades/{id}` | Detail including the shared event timeline |
| `POST` | `/trades/quote` | Compute volume and estimated value — **no side effects**. ⚠ 2026-09-30 ([DEC-167] (16)): one `powerMw`, no lines; also returns the covered and excluded connections and `currentCoverMw` |
| `GET` | `/trades/products` | ⚠ **New 2026-09-30 [DEC-167] (16)** — the product list of the Prices table and its request panel (⚠ formerly the wizard's two tables, [DEC-178]): the products per shape (12 each, 24 in all) with the RAW price, hours and the value of 1 MW |
| `POST` | `/trades` | Submit a request |
| `POST` | `/trades/{id}/cancel` | Cancel while `REQUESTED` |
| `POST` | `/trades/{id}/accept` | Accept the offer. **May return state `AWAITING_APPROVAL`** — see below |
| `POST` | `/trades/{id}/reject` | Reject the offer |
| `POST` | `/trades/{id}/approve` | ~~**[DEC-33]**~~ ⚠ **Amended 2026-08-19 by [DEC-71]** — approve a colleague's acceptance. The verb, path and semantics are unchanged; the **caller must be an `customer.admin` of the company and must not be the accepting account** **[F05-R59]**, **[F13-R44]**. Refused for the accepting account |
| `POST` | `/trades/{id}/pay-balance` | ⚠ **New 2026-09-30 [DEC-167] (17)** — pay the balance of a confirmed BUY from the available balance while the payment window is open. Any member; not a four-eyes action. See §2.4.3 |
| `POST` | `/trades/{id}/refuse-approval` | ~~**[DEC-33]**~~ ⚠ **Amended 2026-08-19 by [DEC-71]** — decline it, optionally with a reason. Terminal. Same admin requirement **[F05-R63]** |
| `GET` | `/blocks` | Confirmed positions. ⚠ Under **[DEC-72]** a position may be **short**: a confirmed `SELL` with no matching purchase makes the net figure negative, and the client must render a negative as a position rather than as an error **[F05-R69]** |

Approval is two endpoints rather than one with a `decision` field, matching the house style — every
other transition on this API is its own verb (`/cancel`, `/accept`, `/reject`), and the two outcomes
have different eligibility rules, which a single endpoint would hide in a branch.

#### 2.4.1 Request validation — [DEC-70], [DEC-72]

Two validation rules changed on 2026-08-19, in opposite directions: one got stricter, one disappeared.

| Rule | Was | Is | Error `type` |
| --- | --- | --- | --- |
| Requested power per line | minimum 0,1 MW, multiples of 0,1 MW **[DEC-32]** | ⚠ **Reversed by [DEC-70]** — minimum **0,01 MW**, multiples of **0,01 MW**, per line and on the request total (⚠ 2026-09-30: there are no lines; the one `powerMw` is the whole request — [DEC-167] (16)) | `…/errors/invalid-volume` |
| Holdings on a `SELL` | the sold volume had to be covered by confirmed blocks **[DEC-34]** | ⚠ **Reversed by [DEC-72]** — **no holdings check at all**. A customer may sell a block they do not hold; the motivating case is a customer with solar production selling expected surplus **[F05-R69]** | *(none — the check is gone, not relaxed)* |

`powerMw` is validated as a decimal with **at most two decimal places and a value ≥ 0.01**, which is
the whole rule: "multiple of 0,01" and "two decimals" are the same statement, so the API expresses it
once. ⚠ **2026-09-29 [DEC-167] (9):** `invalid-volume` is a **400** validation shape, not a 409; every other trading problem type is a 409. `0.005`, `0.0`, and a negative value are all rejected as `invalid-volume` (⚠ **2026-09-30 [DEC-167] (16): there are no lines, so there is no line index** — as built the `ValidationProblem` `errors` is keyed by `powerMw`). The check is server-side and repeated at acceptance, because the request panel is not the only
client this API will ever have.

⚠ **What ten-times-finer granularity costs downstream.** ⚠ **Superseded 2026-09-30 by [DEC-167] (16): there are no allocations** — the paragraph below is the pre-2026-09-30 per-EAN model, and the one account-level `powerMw` is the only volume. Per-EAN allocation rounds to 0,01 MW instead
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
  // ⚠ 2026-09-30 [DEC-167] (16): one volume for the whole account. The earlier body carried
  // "lines": [{ "meteringPointId", "powerMw" }, …]; there are no lines now.
  "powerMw": "1.000",
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
a **sizing rule for a wallet hold**, nothing else **[F05-R70]**, **[F06-R32]**. The request panel must show
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

`POST /trades/quote` exists so the request panel can show live figures without creating anything. It takes
the same body and returns the volume, estimate and wallet impact — **and the same `fourEyes` block**,
so the request panel can warn before submission **[F05-R56]** rather than at acceptance. ⚠ **Amended
2026-08-19 by [DEC-71]**: the warning is no longer *"this one is above your threshold"* but *"your
company runs four-eyes, so every trade needs a second admin"* — it is the same warning on every trade
of that company, which is what makes it cheap to render and impossible to get wrong.
`canBeApproved` is `false` when the company has fewer than **two active admin accounts**, the case
where the trade cannot clear the control at all **[F12-R36]**. The estimate is advisory: the binding
figure is computed at acceptance from the **offer** price **[F05-R52]**, not from this number, and it
is the gross figure that is checked against the balance **[DEC-41]**, **[F05-R70]**. ⚠ **(17) 2026-09-30 [DEC-167]:** for a BUY it is the **deposit**, not the gross, that is checked and held (§2.4.3); the gross is still stored and shown as `totalInclVat`.

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
    "totalInclVat": { "amount": "88049.28", "currency": "EUR" },
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

⚠ **`totalValue` became `totalValueExVat`, and `amountToReserve` is now larger than it [DEC-78].** ⚠ **(17) 2026-09-30 [DEC-167]: `amountToReserve` was then renamed `totalInclVat`** on `TradeOfferDto`, `TradeSummaryDto` and `EmployeeTradeOfferDto` (the platform's OpenAPI artifacts carry no `amountToReserve` any more). A deliberate, breaking rename, as `totalValue` → `totalValueExVat` was: what is *reserved* is now the deposit, so a field named "amount to reserve" would be wrong.
`768 × 94.75 = € 72 768,00` ex-VAT; `round(72768.00 × 1.21, 2) = € 88 049,28` is what the wallet holds
and later debits — **the same stored number**, never two calculations **[F05-R70]**. The rename is
deliberate and breaking: a field called `totalValue` sitting beside a bigger `amountToReserve` reads
as a bug, and a client that silently kept displaying the old name would understate the hold by 21%.
Both go through expand/contract §7 like any other contract change. `walletCheck.sufficient` is
computed against `amountToReserve` (⚠ (17): now the **deposit**, `depositAmount`, not `totalInclVat` — §2.4.3) — € 95 000,00 available covers € 88 049,28, so it stays `true` here,
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
every other transition, and both take the same wallet-then-trade lock order as `/accept`. ⚠ **Superseded 2026-09-29 by [DEC-167] (7):** the order is roster → company row → trade → wallet; refuse-approval takes roster → trade → wallet, and approve takes no wallet lock.

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
| `…/errors/four-eyes-not-satisfiable` | ⚠ **New 2026-08-19 [DEC-71]** — the company has four-eyes on and **fewer than two active admin accounts**, so nobody can be the second pair of eyes. Raised at **acceptance**, before money is reserved, rather than letting the trade sit in `AWAITING_APPROVAL` until it expires. It should be unreachable — **[F12-R41]** refuses to enable the mode below two admins and **[F01-R50]** refuses to deactivate below it — which is exactly why it is checked: an unreachable state that is not checked is an unreachable state that happens. ⚠ **Amended 2026-09-23 by [DEC-157]:** deactivating an admin below the floor is **no longer refused** — it is **warned and reasoned [F12-R43]**, because the account may be a leaver — so this state is now **reachable by design**. The acceptance check is therefore load-bearing rather than a guard against the merely-improbable; the demotion path, by contrast, *is* refused ([DEC-157], above) |
| `…/errors/invalid-volume` | ⚠ **New 2026-08-19 [DEC-70]** — a `powerMw` below 0,01 or not a multiple of 0,01 — §2.4.1 |

#### 2.4.2 Slice 1 as designed — [DEC-167]

⚠ **Added 2026-09-29.** The routes above, minus `GET /blocks` (deferred) and with the bodies and shapes below. All are `.RequireAuthorization()` — any active member, `viewer` included **[DEC-152]** — and every route parameter is `{tradeId:guid}`. Error type URIs are under `https://peakpower.dev/problems/`; there is **no 403** literal anywhere.

| Method and path | Body → 200 | Other |
| --- | --- | --- |
| `GET /trades?category=&state=&page=&pageSize=` | → `TradeListResponse` (`state` repeatable; `pageSize` 1–100). ⚠ **2026-09-30 [DEC-167] (18):** `category` is `open`, `balance-due` (CONFIRMED BUY, balance unpaid, ordered by due date, overdue first) or `all`; the response adds `counts: { open, balanceDue, all }` for the token's company whatever the filter; each item's nullable `settlement` summary carries `balanceAmount`, `balanceDueDate`, `balanceState`; an omitted `category` means no category filter (every state), and `category` and `state` are both applied (AND) | 400 |

⚠ **As built 2026-10-01, [DEC-169] (5) — `category` also takes `confirmed` and `closed`, and `counts` is `{ open, balanceDue, all, confirmed, closed }`.** `confirmed` is state `CONFIRMED`; `closed` is `EXPIRED`, `DECLINED`, `WITHDRAWN`, `REJECTED`, `APPROVAL_REFUSED`, `CANCELLED` and `FAILED`. `open` (REQUESTED, OFFERED, ACCEPTED, AWAITING_APPROVAL) and `balance-due` are unchanged, and no state is in two of open, confirmed and closed. The trade detail honours `?action=confirm|decline` in the portal only; no API field changes.

⚠ **As built 2026-10-01, [DEC-170] (16) — `TradeCountsDto` gains `offered`.** `offered` is the number of the company's `OFFERED` trades (a subset of `open`); the customer portal's Trades navigation badge shows it and hides it at 0. No state moves between categories.

| `POST /trades/quote` | `TradeQuoteRequest` → `TradeQuoteResponse` (no side effects) | 400 |
| `POST /trades` | `SubmitTradeRequest` → `SubmitTradeResponse` | 400, 409 `customer-not-active` / `insufficient-available-balance` |
| `GET /trades/{tradeId}` | → `TradeDetailDto` | 404 |
| `POST …/cancel` | none → `TradeDetailDto` | 404, 409 |
| `POST …/accept` | none → `TradeDetailDto` (state `ACCEPTED` or `AWAITING_APPROVAL`) | 404, 409 |
| `POST …/reject` | `{ "reason" }` → `TradeDetailDto` | 400, 404, 409 |
| `POST …/approve` | none → `TradeDetailDto` | 404, 409 |
| `POST …/refuse-approval` | `{ "reason" }` (optional, ≤ 500) → `TradeDetailDto` | 400, 404, 409 |

**Request.** `direction, shape, periodType, period, powerMw, comment` (the quote omits `comment`) — ⚠ **amended 2026-09-30 ([DEC-167] (16)): one `powerMw` for the whole account, no `lines`.** `direction` null or `BUY` is accepted; **`SELL` is a 400 on `direction`** — *"Only BUY trades can be requested for now."* The server resolves `period` to one of the 24 active products by `(shape, periodType)`; none is a 400 on `period`. `powerMw` is at least 0,01, in steps of 0,01 and **under 1 000 000 MW** (`invalid-volume`). ~~Duplicates are a 400 on `lines`, and an unknown or foreign connection returns the same message as an ineligible one.~~ Nobody names a connection any more, so nothing foreign can be probed; the roster is the company's own connections **valid for the whole delivery period**, snapshotted at submit, and **none is `409 metering-point-not-eligible`** — *"None of your connections can take a block for the whole of {period}."* Accept, approve and confirm re-check only that **at least one** such connection remains.

**Money on the wire** is a **bare decimal**, and every gross amount has its `vatRate` beside it, so no client does money arithmetic: `TradeOfferDto` carries `priceEurMwh`, `totalValueExVat` (rounded to 2 dp), `vatRate`, `vatAmount` (= ⚠ (17) the gross minus the rounded ex-VAT value, so the three confirmation lines always add up), ⚠ **(17) `totalInclVat` (renamed from `amountToReserve`, [DEC-167]; the gross, no longer the amount held)**, `offeredAt`, `expiresAt` and **`secondsRemaining`** — the client counts down from that, never from its reading of `expiresAt`. Once accepted the amount is the **stored** gross and `vatRate` the **stored** rate.

**The estimate is RAW.** `TradeQuoteResponse.estimate` carries `productCode`, `priceEurMwh` — the **raw** indication, **no markup** — `observedAt`, `status` (`FRESH` or `STALE`), `estimatedValueExVat`, `vatRate`, `estimatedValue` (the gross) and `isSampleData`. It is **absent** when the indication is `UNAVAILABLE` or at or below zero; `walletCheck.sufficient` is then `null`. `TradeQuoteResponse` also carries the resolved dates, `peakDays`, `totalPowerMw` and `totalMwh`, ⚠ **(2026-09-30, [DEC-167] (16)) `connections[{ meteringPointId, ean, name, validTo? }]` (the covered roster), `excludedConnections[{ ean, name, reason }]` (electricity connections not valid for the whole period, reason e.g. "Ends 31 Dec 2026") and `currentCoverMw`** (the sum of `power_mw` of the company's confirmed BUY blocks of the same shape whose delivery period contains the requested one — `block.start <= period.start` and `block.end >= period.end` — and 0 when none; a quote with no covered connection is still a 200, the submit is the 409), the wallet check and `fourEyes { enabled, activeAdminCount, canBeApproved }` (`canBeApproved` = at least two active admins). **Only the quote and submit responses ever carry a raw estimate.**

**Products read — `GET /trades/products` (2026-09-30, [DEC-167] (16)).** Any member, `.RequireAuthorization()` and tenant-agnostic reference data with the same gating as the Prices read (the body is identical for every company). `TradeProductsResponse { items }`, each item `{ shape, periodType, period (the Code: `2026-11`, `2027-Q1`, `2027`), label ("Sep 2026", "Q4 2026", "Cal 2027"), deliveryStart, deliveryEnd, price (the RAW €/MWh, no markup, null without an indication), observedAt, status (`FRESH`/`STALE`/`UNAVAILABLE`), hours, mwhAt1Mw, valueAt1Mw }`. `hours` and `mwhAt1Mw` come from the volume calculator at 1 MW; `valueAt1Mw = mwhAt1Mw × price` ex VAT rounded to 2 dp, null without a price. **There are 12 products per shape (6 months, 4 quarters and 2 calendar years), 24 in all; a period that has already started is left out**, by the same test a request uses. It is registered in the route-table and OpenAPI harnesses.

**Trade DTOs.** ⚠ **2026-09-30:** `TradeDetailDto` and `TradeSummaryDto` carry `totalPowerMw` and (detail) `connections[{ ean, name }]` — the snapshot — and **no `lines`**; `TradeOfferDto` has no per-EAN breakdown. `EmployeeTradeDetailDto` shows `totalPowerMw`, `connections[{ ean, name }]` and `anyConnectionEligible`, with no per-line power.

**Reads project.** Every customer read is a projection — the customer role cannot `SELECT` the captured indication, `actual_market_price` or `offered_by_employee_id` (§3.4.4) — newest first. Participant names and job titles come from the **`trade_event` actor snapshots** (`SUBMITTED` → requester, `ACCEPTED` → acceptor, `APPROVED`/`APPROVAL_REFUSED` → decider), never a join on `customer_account`, whose customer policy hides removed members. Staff actors show as *PeakPower Trading*, the system as *PeakPower*. `availableActions` (`CANCEL`, `ACCEPT`, `REJECT`, `APPROVE`, `REFUSE_APPROVAL`, ⚠ **(17) `PAY_BALANCE`** — §2.4.3) is computed server-side: at a four-eyes company `ACCEPT` is offered only to an active admin, and only when there are at least two.

**Transactions.** The `CurrentTransaction is null ? Begin : null` transaction is opened **before** `OwnerPrivilegedWrite`; every guard runs **before** any mutation; any refusal discovered after a flush **throws** (rollback, 500), because the customer middleware commits on a returned 409. **Accept** takes: (1) the admin roster, (2) the company row `FOR SHARE` (owner-privileged, the token's company) — refuse if not `ACTIVE`; the four-eyes flag is read here, and at a four-eyes company the caller must be in the roster (`admin-role-required`) and there must be at least two admins (`four-eyes-not-satisfiable`); (3) the trade `FOR UPDATE` — 404 if absent; (4) the wallet `FOR UPDATE`; then `now` is read **once**, the state and `expires_at` guards run, the roster is re-checked (`metering-point-not-eligible` when **no** electricity connection is valid for the whole period any more — ⚠ 2026-09-30, [DEC-167] (16); it named the EANs before) and the balance is checked ⚠ **(17) against the deposit on the stored price (not the gross)** — *"Your available balance is € A, but accepting reserves € D — the {pct} deposit on the price plus 21 % VAT. Top up your Balance and accept again before the offer expires."* (was *"…accepting reserves € G — the price plus 21 % VAT…"*) — and only then does the trade accept, pin `four_eyes_applied`, `vat_rate` and the gross, and reserve. **Approve** takes roster → company (`FOR SHARE`) → trade, re-checks the caller is an active admin **and is not the acceptor** (`409 self-approval-not-permitted`, refused before any write, [DEC-167] (3), [F05-R59]), the period and the connections, and moves no money. **Refuse-approval** takes roster → trade → wallet, checks the caller is an active admin **and is not the acceptor** (`409 self-approval-not-permitted`, refused before the flush so `ck_trade_refuser_not_acceptor` is never the guard that fires; [F05-R63]), and releases the reservation with the **refuser** as the ledger actor. **Cancel and reject** lock the trade only. The order is [DEC-167] (7).

**Problem details** (shown verbatim by both portals; the exact strings are pinned in tests): `four-eyes-not-satisfiable` — *"Your company uses four-eyes approval but has fewer than two active administrators, so an acceptance could never be approved. Appoint a second administrator first."*; `admin-role-required` — *"Your company uses four-eyes approval, so only an administrator can accept this offer."* (accept) and *"Only an active administrator of your company can approve or refuse an acceptance."* (approve, refuse); `self-approval-not-permitted` — *"You accepted this offer, so a different administrator must approve or refuse it."*; `customer-not-active` — *"Your company's account is not active, so it cannot request or accept trades. Contact PeakPower."*; `delivery-period-started` — *"The delivery period {period} has already started, so this can no longer go ahead."*; `offer-expired` — *"This offer expired at {time}. Any reservation is released automatically."*; `trade-state-conflict` — *"This trade is now “{label}”, so this action is no longer possible. The page will refresh."*; `insufficient-available-balance` — *"Your available balance is € A. At acceptance this request reserves about € E — the {pct} deposit, incl. 21 % VAT. Top up your Balance first, or request a smaller volume."* (submit; ⚠ (17) was *"…reserves about € E incl. 21 % VAT…"*). `approval-window-elapsed` is **not used**: one clock covers acceptance and approval, so it folds into `offer-expired` **[DEC-167]** (11). `Idempotency-Key` and rate limits are **deferred**.

#### 2.4.3 Deposit and balance — [DEC-167] (17), added 2026-09-30

A bought block is paid as a **deposit at accept** and a **balance by the day before delivery starts**. The company's percentage is set by the back office alone (§3.2 `PUT /customers/{id}/commercial-terms`); a customer only reads it. Amounts are bare decimals incl. VAT.

- **`POST /trades/{tradeId}/pay-balance`** — no body → `TradeDetailDto`. `.RequireAuthorization()`, any active member. Allowed only for a `CONFIRMED`, unpaid BUY whose payment window is open (today in Amsterdam ≤ `balanceDueDate`, or the desk confirmed at or after the delivery start). Takes company row → trade → wallet and debits `balanceAmount` as `TRADE_BALANCE_PAID`. Problems (all 409, `https://peakpower.dev/problems/`): **`insufficient-available-balance`** (*"Your available balance is € A, but the balance is € B incl. 21 % VAT. Top up your Balance and pay again."*, nothing written); **`balance-window-closed`** — title *"The balance can no longer be paid here"*, detail *"Delivery has started, so this balance can no longer be paid here. PeakPower will contact you to settle it."*; **`trade-state-conflict`** (already paid, or not confirmed). 404 for an unknown or foreign trade. The trade problem types are now **12**.
- **`settlement`** on `TradeDetailDto` (null before accept and for a non-BUY): `{ depositPct, depositAmount, balanceAmount, balanceDueDate, balancePaidAt, balancePaidSource ("CUSTOMER" \| "AUTO" \| null), depositState ("ON_HOLD" \| "APPLIED" \| "RELEASED"), balanceState ("SCHEDULED" \| "DUE_SOON" \| "OVERDUE" \| "PAID" \| "NOT_EXECUTED"), paymentWindow ("OPEN" \| "CLOSED" \| "NOT_EXECUTED" \| "PAID") }`. `DUE_SOON` is within 14 days of the due date; `OVERDUE` is a closed window with the balance unpaid — **derived, the trade stays `CONFIRMED`**. `TradeSummaryDto.settlement` is the compact `{ depositAmount, balanceAmount, balanceDueDate, balanceState, paymentWindow }` for the list pill. `reservedAmount` on the trade is the **deposit**. `availableActions` gains **`PAY_BALANCE`** exactly when paying would succeed, ignoring funds.
- **Offer and quote.** `TradeOfferDto` gains `depositPct`, `depositAmount`, `balanceAmount`, `balanceDueDate` (prospective while `OFFERED`, frozen after accept; `totalInclVat` is the gross — ⚠ the renamed `amountToReserve`, see the ⚠ note in §2.4.2 "Money on the wire"). `TradeQuoteResponse` gains `depositPct`, `depositEstimate` (the estimate's gross × the percentage, rounded once), `balanceEstimate` and `balanceDueDate`. `walletCheck.sufficient` is judged on the **deposit** at quote, submit, and the offer's wallet check.
- **Ledger.** The wallet's history gains the entry type `TRADE_BALANCE_PAID` (F06 §3).
- **Timeline.** The event type list gains `BALANCE_PAID` (13 types).

### 2.5 Wallet, deposits and withdrawals

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/wallet` | Balances and active reservations. **Reservations are VAT-inclusive** for trades **[DEC-78]** and face value for withdrawals **[F06-R33]** |
| `GET` | `/wallet/ledger?from=&to=&types=` | Paged ledger |
| `GET` | `/wallet/ledger/export?…` | CSV / PDF statement. ⚠ **Unaffected by [DEC-89]** — that decision moves the **invoice** document to the bookkeeping program; a wallet statement is not an invoice, is not numbered and states no VAT **[DEC-76]** |
| ~~`GET`~~ | ~~`/wallet/topup-instructions`~~ | ~~IBAN, BIC, holder, wallet reference~~ ⚠ **Removed 2026-08-19 by [DEC-106]** — the reference is now issued **per deposit intent**, not standing per customer, so a static instruction page would print a code that matches nothing **[F07-R13]**, **[F07-R14]**. The instructions come back from `POST /wallet/deposits` |
| `POST` | `/wallet/deposits` | ⚠ **New 2026-08-19 [DEC-106]** — create a **deposit intent** with `{ amount, method }`, `method` ∈ `IDEAL` \| `BANK_TRANSFER`. Moves no money and reserves nothing **[F07-R23]**. ⚠ **Amended 2026-09-23 by [DEC-163]** — **admin or trader**, not any member; a viewer is refused |
| `GET` | `/wallet/deposits?state=` | ⚠ **New** — the customer's own pending and credited intents **[F07-R11]** |
| `GET` | `/wallet/deposits/{id}` | ⚠ **New 2026-09-23 [DEC-162]** — any member, tenant-scoped **[F07-R11]** — the intent, its credited entries **[F07-R26]**, and **`expiresAt`** for an iDEAL intent **[DEC-162]**; for a bank transfer, **`instructions { iban, accountHolder }`** — the BIC is deferred **[OQ-109]**. **404** for another company's id or an unknown one, byte-identical either way |
| `POST` | `/wallet/deposits/{id}/simulated-checkout` | ⚠ **New 2026-09-23 [DEC-162]** — body `{ outcome: "SUCCEEDED" \| "FAILED" }`. **Admin or trader [DEC-163]**. Settles through the **same idempotent core the webhook uses**; the simulated PSP is acting, not the browser. **200** with the deposit; **404** when the switch is off, the id is unknown, another company's, a bank transfer, or a non-simulated provider — a real PSP's intent 404s here too; **409** when the intent has expired or is already settled the other way; **400** on any outcome but the two named |
| ~~`POST`~~ | ~~`/wallet/payments`~~ | ~~Start an iDEAL top-up, returns a redirect URL~~ ⚠ **Amended 2026-08-19 by [DEC-106]** — folded into `POST /wallet/deposits` with `method: "IDEAL"`. iDEAL and bank transfer are **peers on one deposit action**, not a default with a fallback behind it **[F07-R01]** |
| `GET` | `/wallet/payments/{id}` | Payment status. Retained: it is the PSP leg, not the deposit intent. ⚠ **Amended 2026-09-23 by [DEC-162] and [DEC-164]** — no longer what the portal polls after the return: the return target moved to `/wallet/deposits/{id}` **[F07-R04]**, and **[F07-R09]**'s confirmation poll targets the `GET /wallet/deposits/{id}` row above |
| `POST` | `/wallet/withdrawals` | ⚠ **New 2026-08-19 [DEC-83]** — request a withdrawal up to `availableBalance`. **Admin only** **[F06-R33]**; the amount is held immediately **[F07-R29]** |
| `GET` | `/wallet/withdrawals?state=` | ⚠ **New** — the company's requests and their states **[F07-R32]**. ⚠ **Amended 2026-09-29 by [DEC-166]:** each request now carries **`bankReference`** — the reference the back office recorded when it paid the request, null until then and when none was given — **appended as the last field, an additive change**. The customer never sees which staff member paid: there is no `paidByName` on this contract |
| `POST` | `/wallet/withdrawals/{id}/cancel` | ⚠ **New** — the customer withdraws their own request before payout; releases the hold **[F07-R32]** |
| `GET` | `/bank-account` | ⚠ **New 2026-09-28 [DEC-165]** — the company's registered bank account and whether **this caller** may change it. **Any member**, tenant-scoped. Answers `{ account, canChange, changeBlockedReason }` — the shape and the exact sentences are below **[F01-R44]** |
| `POST` | `/bank-account` | ⚠ **New 2026-09-28 [DEC-165]** — add **or replace** the company's bank account; a replace deactivates the current `ACTIVE` account and activates the new one in one transaction **[F01-R46]**. **Admin only** (`CompanyAdmin`); refused at a company with four-eyes on. `200` with the new account; `400`, `403` and `409` below |

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

⚠ **The iDEAL create response's `redirectUrl` is `{CustomerPortal:BaseUrl}/wallet/checkout/{depositId}`
for the simulated provider [DEC-162]** — the same shape as any other provider's redirect, so the
portal's post-create handling does not branch on which one it got. A real PSP's `redirectUrl` points at
its own hosted page instead.

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
  destination **[F01-R45]**, and the request is refused with `…/errors/no-active-bank-account`. ⚠ **Amended 2026-09-28 by [DEC-165].** No bank account is ever written `PENDING_APPROVAL`, so that case does not arise; the case that does is **none on file**, refused with a `409` whose detail reads *"No bank account on file for this company. A company admin can add one on the Balance page."* ⚠ **Amended 2026-10-08 by [DEC-176] (9): the card is on the Company page.** The platform's 409 detail text still names Balance: a known stale wire string, unchanged because DEC-176 makes no platform change; the web does not show it (it matches the problem prefix only). A one-line platform text change is a follow-up. — the generic `conflict` problem type, not a dedicated `…/errors/no-active-bank-account` URI. The destination is the company's `ACTIVE` account (`GET /bank-account`), read under a share lock on the company's row so a concurrent replace cannot slip between the read and the insert; a replace **re-points** the company's open requests (`REQUESTED`, `AWAITING_APPROVAL`) at the new account while they wait. On the built wire `destination` is the IBAN string.
- **There is no payout endpoint on this API.** PeakPower pays out **manually** and records what the
  bank did **[DEC-83]**, **[F12-R54]** — §3.2. The platform never initiates a transfer, so no customer
  call can cause money to leave; `POST /wallet/withdrawals` creates an obligation, not a payment.

⚠ **The company bank account — new 2026-09-28 by [DEC-165].** Two routes at `/api/v1/bank-account` — top level,
tagged *Wallet*, **not** under `/company`. The read is open to every member of the token's company; the write is
behind the `CompanyAdmin` policy, proven from the database on every request, never a claim **[DEC-152]**. There is no
verification step: the account is `ACTIVE` the moment `POST` answers `200`.

```jsonc
// GET /api/v1/bank-account            — any member
{
  "account": {
    "id": "0198…",
    "iban": "NL00BANK0123456789",
    "bic": null,
    "holderName": "Zonnedak Beheer B.V.",
    "addedAt": "2026-09-28T09:41:00+02:00"
  },
  "canChange": true,
  "changeBlockedReason": null
}

// POST /api/v1/bank-account           — admin only, no Idempotency-Key
{ "iban": "NL00 BANK 0123 4567 89", "bic": "BANKNL2A", "holderName": "Zonnedak Beheer B.V." }
// 200 OK — the new account, in the shape of "account" above
```

- **`account` is `null`** when the company has no `ACTIVE` account on file. **`canChange` is true only for an admin
  at a company with four-eyes off**; when it is false, **`changeBlockedReason`** is the server's own sentence and is
  what the portal shows — *"Only a company admin can change the bank account."* for a non-admin (which wins when both
  apply), *"Bank account changes need a second admin's approval, which isn't available yet."* for a four-eyes
  company, and `null` otherwise.
- **Request.** `iban` is accepted in either case and with or without spaces, and returned normalised (upper case, no
  spaces). `bic` is optional and, when given, 8 or 11 characters; it is returned normalised, or `null`. `holderName`
  is trimmed and must be 1 to 200 characters. The route takes **no `Idempotency-Key`**: repeating an identical call
  is refused as *already registered* rather than replayed.
- **`400`**, a validation problem (`https://peakpower.dev/problems/validation`), `errors` keyed **`iban`**,
  **`bic`** or **`holderName`**, one message each — *"IBAN must not be blank."*, *"IBAN must be 15 to 34 characters:
  two letters, two digits, then letters or digits."*, *"IBAN failed the ISO 7064 mod-97 check."*; *"BIC must be 8 or
  11 characters: a bank code, a country code, a location code and an optional branch code."*; *"Account holder name
  must not be blank."*, *"Account holder name must be at most 200 characters."* Every field is validated **before**
  a transaction opens or a lock is taken, so a bad BIC is a `400` even at a four-eyes company.
- **`403`** for a member who is not an admin. No row is written.
- **`409`**, the generic `conflict` problem type (`https://peakpower.dev/problems/conflict`) with a `detail` — there is
  no per-condition `type` URI here, so the `detail` is the discriminator — and the whole change refused, nothing
  written: *"Bank account changes need a second admin's approval, which isn't available yet."* (four-eyes is on,
  **re-read under the company's row lock** so a toggle racing the request cannot pass); *"This bank account is
  already registered."* (the same IBAN as the `ACTIVE` account, or a concurrent add of it); *"Another bank account
  change happened at the same time. Reload and try again."* (a concurrent change won with a **different** IBAN).
- **A replace is one transaction** — the company's row locked `FOR UPDATE`, the old account deactivated by the acting
  account, the new one inserted (`source = PORTAL`, added by the acting account) in one save, and the company's open
  withdrawals re-pointed. A record is **never edited and never deleted** **[F01-R44]**; the change writes no
  `audit.audit_record`, because the record itself carries the acting accounts and both timestamps.
- **Three readers use the `ACTIVE` account**: the withdrawal request (above), the employee payout (§3.2) and the
  incoming-transfer matcher **[F07-R21]**.

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
| `GET` | `/company/accounts` | Colleagues who can also act — name, job title, email, status **[OQ-80]**, and each account's ~~**admin** flag~~ **`membershipRole`** **[F01-R21]**. ⚠ **Corrected 2026-09-10 by [DEC-152]: there is no admin flag.** Open to **every** member, unchanged — `CompanyEndpoints.cs:77` @ debadda0 (`MapGet("/accounts")`), `.RequireAuthorization()` with **no policy** at `:104`. `admin` gates no read here; the read it gates is `/company/memberships` below |
| `GET` | `/company/bank-accounts` | ⚠ **New 2026-08-19 [DEC-71]** — the company's bank accounts with status (`PENDING_APPROVAL` \| `ACTIVE` \| `DEACTIVATED`) **[F01-R44]**. Read-only here: a bank account is added and deactivated by a PeakPower employee **[DEC-16]** and, under four-eyes, approved by a second admin §2.10. ⚠ **Not built, and superseded 2026-09-28 by [DEC-165].** The built read is `GET /bank-account` (§2.5) and answers the `ACTIVE` account only — there is no list of deactivated ones — with `canChange` and `changeBlockedReason` beside it; a company **admin**, not an employee, adds and replaces it, and no approval is involved: a four-eyes company is refused |
| `GET`/`PATCH`/`DELETE` | `/company/memberships`, `/company/memberships/{accountId}` | ⚠ **New 2026-09-10 [DEC-152]** — the member list, a role change and a removal, **all three `CompanyAdmin`** (`MembershipEndpoints.cs:75`/`:85`/`:102` @ debadda0, the `.RequireAuthorization` lines; routes at `:61`/`:83`/`:100`). ⚠ **Not "`GET` open to every member"**: every member instead keeps `GET /company/accounts` above, which already carries the colleague's `membershipRole`; this list additionally names who has been **invited** and is admin-only for that reason. `GET` returns the whole `CompanyMembershipsResponse`; `PATCH` replaces one row but answers with the **whole list**, not the one row, so a screen never merges a partial response; `DELETE` answers `204` with no body. Both are `404` for a membership not this business's or already removed — byte-identical to an unknown `accountId` **[F13-R19]** — and `409` for the **admin floor**: demoting or removing the company's last admin, or a four-eyes company's second one; `DELETE` alone also refuses removing **your own** membership under the same status and body. ⚠ The `DELETE` **verb is a soft delete**: the SQL is an `UPDATE` setting `removed_at`, because PostgreSQL never evaluates `WITH CHECK` for a `DELETE` and there is no `DELETE` grant to guard |
| `GET`/`POST` | `/company/four-eyes` and its five actions | ⚠ **New 2026-09-29 [DEC-166]** — the company's four-eyes mode, set by its own admins. `GET` is open to every member; the five `POST`s — `enable`, `disable-request`, `disable-request/approve`, `…/decline`, `…/cancel` — are **`CompanyAdmin`**. Each `POST` answers `200` with the same state the `GET` builds. Shapes and the exact `409` sentences are in the block below the entitlements table **[F01-R42]**, **[F01-R43]**, **[F01-R48]** |
| `POST` | `/company/invitations`, `/company/invitations/accept` | ⚠ **New 2026-09-10 [DEC-152]** — issue (**`CompanyAdmin`**, `InvitationEndpoints.cs:49`/`:51` @ debadda0) and redeem (**anonymous**, `:67`/`:69`, on the owner connection: the invitation token is the authorisation, not tenancy). Issue answers **`202` always**, indistinguishable for a known and an unknown address in status, body and timing; its only other response is a **validation `400`** on the request itself, which never touches the address's standing. Accept answers the created `CompanyInvitationAcceptedResponse`, a **validation `400`** for the profile fields an address with no login must supply, or a single **`409`** — an unknown, a spent and an expired invitation token are one indistinguishable body |

~~All three are read-only. Company details, accounts and bank accounts are maintained by PeakPower
employees **[DEC-16]**, so there is no write endpoint here at all.~~ ⚠ **Reversed 2026-09-10 by
[DEC-152].** This URL space now carries **four customer-initiated writes** — the two invitation
routes and the role change and removal above — and they are administration, not approval: a customer
**admin** brings a colleague into their own business and takes them out again, which is precisely the
self-service **[DEC-16]** refused.

⚠ **This paragraph was already untrue before [DEC-152], and that is recorded rather than quietly
fixed.** **[DEC-150]** put `GET`/`POST /api/v1/company/entitlements` in this same URL space on
2026-09-08 — an admin of a company switching that company's own entitlements on and off — and §2.7 was
never amended. It is listed here now, so the section's inventory is complete:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`/`POST` | `/company/entitlements` | ⚠ **Missing since 2026-09-08 [DEC-150]** — the shelf a company switches on. `GET` is open to every member (the rail is computed from the held set, so a 403 would take away navigation rather than a privilege); `POST` is **`CompanyAdmin`** and audited in both directions |

⚠ **[DEC-71] still does not change that** — the approval a second admin gives §2.10 is a different
mechanism from an administration screen, and *"add a user"* has now left that approval list
altogether. What is unchanged: company **details** are still maintained by PeakPower employees, and a
bank account **cannot be edited once added** — correcting an IBAN is *deactivate the old, add the
new*, two audited events with two named actors **[F01-R44]**, **[F01-R46]**. ⚠ **Amended 2026-09-28 by [DEC-165]:** *who* and *how* changed, not *whether it can be edited* — a company **admin** replaces the account from the Balance page, `POST /bank-account` §2.5, as **one** operation recorded against one acting account; it is still never edited. ⚠ **Amended 2026-10-08 by [DEC-176] (9): on the Company page, not Balance.**

⚠ **The company's four-eyes mode — new 2026-09-29 by [DEC-166].** Six routes at `/api/v1/company/four-eyes`,
tenant-scoped like the other company routes and tagged *Company*. The read is open to every member of the token's
company; each write is behind the `CompanyAdmin` policy, proven from the database on every request and never read
from a claim **[DEC-152]**. **Four-eyes is set by the company's own admins**: turning it on is immediate, turning it
off is a request a **different** admin approves, and the back office has no route that changes it **[F01-R42]**. No
route takes an `Idempotency-Key`.

| Method | Path | Body | Effect |
| --- | --- | --- | --- |
| `GET` | `/company/four-eyes` | — | The state below. Any member |
| `POST` | `/company/four-eyes/enable` | — | Turn four-eyes on, at once. Needs two or more active admins **[F01-R43]** |
| `POST` | `/company/four-eyes/disable-request` | — | Ask for four-eyes to be turned **off**. It stays on while the request is pending |
| `POST` | `/company/four-eyes/disable-request/approve` | — | A **different** admin approves. Four-eyes is off afterwards and the request is cleared **[F01-R48]** |
| `POST` | `/company/four-eyes/disable-request/decline` | optional `{ reason }` | A **different** admin declines. Four-eyes stays on and the request is cleared |
| `POST` | `/company/four-eyes/disable-request/cancel` | — | The requester withdraws it |

```jsonc
// GET /api/v1/company/four-eyes — and the 200 body of every POST above (the page applies this one state)
{
  "enabled": true,
  "activeAdminCount": 3,
  "pendingDisable": {
    "requestedByName": "M. Vandersteen",
    "requestedAt": "2026-09-29T09:41:00+02:00",
    "canApprove": true,
    "canDecline": true,
    "canCancel": false
  },
  "canEnable": false,
  "canRequestDisable": false,
  "blockedReason": null
}

// POST /api/v1/company/four-eyes/disable-request/decline — the whole body is optional
{ "reason": "We are mid-audit; ask again in October." }
```

- **`pendingDisable` is null** when nobody has asked. `requestedByName` is "First Last" and reads *"A former admin"*
  when the requester's account is no longer visible. **The flags are computed for the caller**: `canEnable` — the
  caller is an admin, four-eyes is off and `activeAdminCount` is at least 2; `canRequestDisable` — an admin, four-eyes
  on, nothing pending; `canApprove` — an admin **other than the requester**, and the requester is still an active
  admin; `canDecline` — an admin other than the requester; `canCancel` — the requester. `activeAdminCount` counts
  active accounts with an active `admin` membership in the token's company.
- **`blockedReason`** is *"Only a company admin can change four-eyes."* for a non-admin (which wins when both apply),
  *"Four-eyes needs at least two active admins. Your company has {n}."* for an admin while four-eyes is off with fewer
  than two, and `null` otherwise. The portal shows it verbatim.
- **`403`** for a member who is not an admin, on any `POST`. Nothing is written.
- **`400`**, a validation problem keyed **`reason`**, when a decline's reason is longer than 500 characters after
  trimming — *"Reason must be at most 500 characters."* A blank reason means none. It is checked before anything is
  locked.
- **`409`**, the generic `conflict` problem type with a `detail` that is the discriminator, the whole change refused
  and nothing written:

| Route | `detail` |
| --- | --- |
| `enable` | *"Four-eyes is already on."* — or, with fewer than two active admins, *"Four-eyes needs at least two active admins. Your company has {n}."* |
| `disable-request` | *"Four-eyes is off."* — or *"A request to turn off four-eyes is already waiting for approval."* |
| `approve` | *"There is no request to turn off four-eyes."* — self-approval, *"You requested this change. A different admin must approve it."* — or, when the requester has since been removed, demoted or deactivated, *"The admin who asked for this is no longer an active admin, so the request cannot be approved. Decline it, and ask again if four-eyes should still be turned off."* |
| `decline` | *"There is no request to turn off four-eyes."* — or self-decline, *"You requested this change. Cancel it instead, or ask a different admin to decline it."* |
| `cancel` | *"There is no request to turn off four-eyes."* — or, from anyone but the requester, *"Only the admin who requested this change can cancel it."* |
| any `POST` | *"Only a company admin can change four-eyes."* — a caller demoted between the policy check and the lock |

- **Every mutation locks and re-reads.** The admin roster is locked first (`CustomerMembershipCore.LockAdminAccountIdsAsync`),
  then the company's row `FOR UPDATE`, owner-privileged with the **token's** company named explicitly; the mode, the
  pending request and the roster are read after both locks. **All guards run before any mutation**, so no `409`
  follows a flush — the customer middleware commits on a returned `409`. The one global lock order, roster, company
  row, bank-account row, withdrawal row, wallet row, is recorded in **[DEC-166]**.
- **Each success writes one audit row** from the customer host — `FOUR_EYES_ENABLED`, `FOUR_EYES_DISABLE_REQUESTED`,
  `FOUR_EYES_DISABLE_APPROVED`, `FOUR_EYES_DISABLE_DECLINED` (the reason on the after side) or
  `FOUR_EYES_DISABLE_CANCELLED`, actor `account:{id}`, entity `Customer`. A decline's reason is kept only there; no
  response returns it to the requester.
- **Unchanged while a request is pending:** withdrawal approval and decline **[F07-R30]**, the bank-account block
  **[DEC-165]** (`GET /bank-account` still answers `changeBlockedReason` for a four-eyes company) and the admin floor
  **[DEC-157]**.

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

⚠ **New section 2026-08-19.** ⚠ **Amended 2026-09-10 by [DEC-152]: four actions, not five.**
**[DEC-71]** puts ~~five~~ **four** actions behind a second admin's approval when the customer company
has four-eyes enabled. Only one of them — *execute a trade*, meaning accept an offer — already had
verbs on this API §2.4. The other ~~four~~ **three** had none, because they were not customer actions
at all: PeakPower employees add bank accounts **[DEC-16]**. ⚠ *Adding a user* was the fourth of those,
and it has left in both directions at once — it is now a **customer** action (§2.7) **and** it is no
longer an approvable one. The approval is
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
**`WITHDRAWAL`** — ⚠ **four and no others, since 2026-09-10 [DEC-152]**. ~~**`USER_ADD`**~~ left the
list: membership changes bypass four-eyes entirely **[F01-R49]**, so no membership write ever raises
an approval and no `approval_request` row ever carries that action. **`DEPOSIT` is deliberately not in
the enumeration** **[DEC-71]**: a customer can wire money or use iDEAL on their own, so gating a
deposit gates nothing that is not already ungated.

⚠ **Build status 2026-09-28 [DEC-165]: `BANK_ACCOUNT_ADD` and `BANK_ACCOUNT_DEACTIVATE` are never raised.** The approval flow of **[F01-R45]** is not built — no `PENDING_APPROVAL` record, no approver — and the two arms stay in the closed list for it. Their premise, that *PeakPower employees add bank accounts*, no longer holds either: a company **admin** adds or replaces the account, and at a company with four-eyes on `POST /bank-account` §2.5 is refused with a `409` instead of raising an approval.

⚠ **The closed list is the whole value of this field, which is why removing an arm is recorded here
and not only on [DEC-152].** *"The five and no others"* was a contract a client could switch on
exhaustively; *"four and no others"* is the same contract with one arm fewer, and a client that still
handles `USER_ADD` is handling a value the API can no longer emit. ⚠ **The domain enum moves with
it** — `FourEyesAction` in `PeakPower.Domain` drops its `AddUser` arm, and the two tests that pin the
arm list move with that. ⚠ **Note the two spellings, which have always disagreed and still do**: this
section says `USER_ADD` while the database's `approval_request` `CHECK` and the domain enum say
`ADD_USER`. Both lose the arm; neither vocabulary is corrected to the other here, because that is a
separate defect and conflating them would hide it.

Three shape decisions, each with a reason.

- **One queue to read, action-native verbs to act — with one exception.** `TRADE_ACCEPT` items appear
  in this queue for visibility, and are decided on `POST /trades/{id}/approve` §2.4, because the trade
  has a clock, a reservation and a state machine that the generic endpoint would have to reimplement
  **[F05-R61]**, **[F05-R62]**. The other ~~four~~ **three** actions are decided here. Both paths write the **same
  approval record**, so the audit trail is one trail and not two **[DEC-17]**.
- **`expiresAt` is `null` for everything except a trade.** The trade's approval window is the offer's
  own `expires_at` and there is no second clock **[F05-R61]**. A pending bank account ~~or user
  addition~~ has no deadline — it waits, and the record shows how long it has waited. ⚠ **`or user
  addition` struck 2026-09-10 by [DEC-152]**: membership changes bypass four-eyes entirely, so there
  is no pending user addition left to wait on. ⚠ A withdrawal held pending
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

### 2.12 Legal documents — [DEC-174], added 2026-10-05

⚠ **Amended 2026-10-09 by [DEC-177] (3), (4):** every document is in English and Dutch. The list gains `fileUrls`, `/current` takes `?lang`, the short links take `?lang=`, and a response whose language a valid `lang` did not name sends `Vary: Accept-Language`. The language rule is [F16-R38]; no route is added, so the route table and the anonymous allow-list are unchanged. Text below that predates this decision is read with these changes.

Two reads, **anonymous** — people open the Terms and the Privacy Statement before they have an account. The customer API gives a **slim list** and the **current PDF** and nothing else: **no history route, no old-version route, no version number, no effective date**. No tenant, no token; a token, if sent, changes nothing (a signed-in customer gets the byte-identical response). In the route table they are labelled **`.AnonymousEndpoint(reason)`**, not `SharedReferenceData`: that arm of the route-table harness requires authentication, so the reason string records that the data is shared reference data, like `/market/day-ahead` (§2.3A). Neither host has a rate-limit policy, so **none applies** to these routes. They are **not** on the usage API ([DEC-97]). Feature: [F16](../10-features/F16-legal-documents.md).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/legal-documents` | `200`: the **visible** types, ordered by `sortOrder` then `key`. Each (`LegalDocumentListItemDto`): `key`, `title`, `fileUrl` (the relative `/api/v1/legal-documents/{key}/current`, language-less and resolved by the language rule, when a version is published now, else null) and, new, **`fileUrls`**: `{en, nl}`, each the relative `/api/v1/legal-documents/{key}/current?lang=en` or `?lang=nl` when the current version has that language, else null. **Nothing else**: no version number, date or size |
| `GET` | `/legal-documents/{key}/current` | `200`: the current PDF in the language of the rule: `?lang=en` or `?lang=nl` first (any other value counts as absent), then the first `nl` or `en` in `Accept-Language` (highest quality first, ties in the order written, `q=0` never counts, a region ignored (`nl-BE` is Dutch)), then `nl`; if the version lacks that language, the other one (never a `404` for a document that exists in some language). `304` on a matching `If-None-Match`. `404` (problem details) when nothing is published, or for an unknown, malformed or hidden key |

**Removed by the links-only decision (2026-10-05).** `GET /legal-documents/{key}` (a type with its version history) and `GET /legal-documents/{key}/versions/{n}` (an old version's PDF) do **not** exist on the customer API; they answer as unknown routes. Customers can read the **current** document only. A scheduled version is never exposed — not in the list, not as `/current`. "Current" is the highest version number whose `effectiveFrom <= now`, inclusive. **PDF responses:** `Content-Type: application/pdf`; `Content-Disposition: inline; filename="PeakPower-{Title words joined by -}-v{n}-{en|nl}.pdf"` (on `200`, the language of the file served); `ETag: "<sha256 hex>"` of the file served (so it differs per language), strong and quoted; `Cache-Control: no-cache` (it always revalidates); `Vary: Accept-Language` whenever `lang` is absent or not `en`/`nl` (the Dutch default included); `X-Content-Type-Options: nosniff`. `If-None-Match` is honoured with `304` and no body for a strong or weak match, `*`, or a list containing the ETag; the file bytes are read only after that check. The download route is documented with the existing `FileDownloadOperationTransformer`.

**Short public links.** Two anonymous redirects on the customer host, mapped as endpoints **outside `/api/v1`** so they win over the portal's SPA fallback (a literal-prefix endpoint beats the `{*path:nonfile}` catch-all, and static files defer to a matched endpoint; there is no `legal` folder in `wwwroot`). They appear in no OpenAPI document and each is named in the customer route table and the anonymous allow-list.

| Method | Path | Result |
| --- | --- | --- |
| `GET`, `HEAD` | `/legal/{key}` | **`302`** (not permanent) with the relative `Location: /api/v1/legal-documents/{key}/current?lang=<resolved>` when the type is visible and has a version in effect; `/legal/{key}?lang=nl` asks for Dutch, and without `lang` the rule above applies (the response then sends `Vary: Accept-Language`). `<resolved>` is the language that will be served, after the fallback (the short links read the data; the old PDF URL below does not, and forwards the language requested). Otherwise **`404`**, `text/plain`, body *This document is not available.* — hidden, unpublished, scheduled-only, unknown and malformed alike, byte-identical, and never the SPA shell |
| `GET`, `HEAD` | `/legal/user-agreement` | The legacy alias: the same rule, `?lang` included, for `terms-of-use` |
| `GET`, `HEAD` | `/legal`, `/legal/` and `/legal/{**rest}` | **`404`**, `text/plain`, the same body, never the SPA shell. The two routes above are more specific and win |

**The old static URL.** `GET` and `HEAD /peakpower-privacy-policy.pdf` on the customer host answers **`302`** (not permanent) to `/api/v1/legal-documents/privacy-statement/current?lang=<requested>` (`<requested>` is the language asked for: `?lang=` when it is `en` or `nl`, otherwise the language rule). Unlike `/legal/{key}`, this redirect reads no data, so it forwards the language requested and the fallback to the other language happens at `/current`; it sends `Vary: Accept-Language` whenever `lang` is absent or not `en`/`nl`. Static files run first, so while the web build still ships that file the file wins; once the web removes it the redirect answers. It is a mapped endpoint outside `/api/v1` and appears in no OpenAPI document.

**Onboarding.** `POST /onboarding/applications` takes the optional `language` (`en` or `nl`). The server stores the Terms of Use version current at acceptance in `terms_version_id`, or null when none is published, and the language it served (the language rule applied to `language`, then the fallback) in `terms_language`; the sign-up succeeds either way. The client never sends a version.

**Query parameter, not a path segment.** `?lang=` leaves the route table, the anonymous allow-list and the rule that `/legal/{**rest}` answers the plain-text `404` unchanged; the byte-identical unavailable cases are unchanged. The previous portal, which sends no language and reads `fileUrl`, keeps working between the platform and web deploys.

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
| `GET` | `/trade-desk/balances?state=&limit=` | ⚠ **New 2026-09-30 [DEC-167] (17)** — every company's `CONFIRMED` trades with an unpaid balance, **overdue first**, then by due date, then by reference. See §3.1.2 |

⚠ **As built 2026-10-01, [DEC-170] (16) — the employee trades list has categories and counts.** `GET /trades` (back office) accepts `category` = `all` (or empty), `to-price` (`REQUESTED`), `offer-out` (`OFFERED`), `awaiting-approval`, `to-confirm` (`ACCEPTED`), `confirmed` (`CONFIRMED`) or `closed` (`REJECTED`, `EXPIRED`, `FAILED`, `DECLINED`, `WITHDRAWN`, `CANCELLED`, `APPROVAL_REFUSED`), 400 on anything else; the repeatable `state` filter still works. The response gains `counts` = `{ all, toPrice, offerOut, awaitingApproval, toConfirm, confirmed, closed }` ignoring `category` and `state` and following the `customerId` filter when one is given (the whole book otherwise). The six specific categories are disjoint and each count equals the length of its own filter's results. The trade detail honours `?action=offer|confirm` in the portal only; no API field changes.

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

#### 3.1.2 Balances view and settlement — [DEC-167] (17), added 2026-09-30

`GET /trade-desk/balances?state=due-soon|overdue|all&limit=` (`.BackOffice`, any operator; `state` defaults to `all`, an unknown value is a 400 on `state`; `limit` 1–1000, default 200) → `{ items, total, counts { dueSoon, overdue, all }, generatedAt }`. Each item: `tradeId, reference, customerId, customerName, shape, periodType, period, balanceAmount, balanceDueDate, balanceState ("SCHEDULED" \| "DUE_SOON" \| "OVERDUE"), paymentWindow ("OPEN" \| "CLOSED"), walletAvailableBalance, confirmedAt`. **Counts cover every state whatever the filter**; `total` is the true number of rows the filter matches. **View only** — the desk has no money action on a balance, and an unpaid balance is flagged, never cancelled.

The desk trade detail gains `settlement` (same shape as the customer's: `depositPct`, `depositAmount`, `balanceAmount`, `balanceDueDate`, `balancePaidAt`, `balancePaidSource`, `depositState`, `balanceState`, `paymentWindow`; null before accept and for a non-BUY), the offer gains the prospective `depositPct`, `depositAmount`, `balanceAmount`, `balanceDueDate`, the acceptance's `reservedAmount` is the deposit, and the desk's customer block gains `depositPct`.

#### 3.1.1 Slice 1 as designed — [DEC-167]

⚠ **Added 2026-09-29.** Every route is `.BackOffice(...)` — **any signed-in operator**, no per-trade ownership **[DEC-155]**; bodies are validated by FluentValidation. **There is no `internal-notes` route in slice 1** (**[F05-R23]** is deferred) and **no approve, override or four-eyes route of any kind** — the Awaiting approval queue is watch-only **[DEC-166]**.

| Method and path | Body → 200 | Other |
| --- | --- | --- |
| `GET /trade-desk/queues?limit=` | → the four queues (`limit` 1–200, default 50) with **true totals** and `valueAtRiskExVat` | 400 |
| `GET /trades?state=&customerId=&page=&pageSize=` | → paged desk list | 400 |
| `GET /trades/{tradeId}` | → `EmployeeTradeDetailDto` | 404 |
| `POST …/offer` | `{ priceEurMwh, reactionWindowMinutes }` → detail | 400, 404, 409 |
| `POST …/decline`, `…/withdraw-offer`, `…/fail` | `{ reason }` (required, ≤ 500) → detail | 400, 404, 409 |
| `POST …/confirm` | `{ externalReference?, actualMarketPrice? }` → detail | 400, 404, 409 |

**Queues.** *To price* = `REQUESTED` oldest first; *Awaiting customer* = `OFFERED` by `expires_at`; *Awaiting approval* = `AWAITING_APPROVAL` by `expires_at`, each card carrying the acceptor's name and job title and the number of **other** active admins who can approve **[F12-R34]**; *To confirm* = `ACCEPTED` ordered and aged by `readySince` = `approval_decided_at`, else `accepted_at`. `valueAtRiskExVat` sums the ex-VAT value of offered, awaiting and accepted trades.

**Detail.** Beside the trade, the customer (`fourEyesEnabled`, `activeAdminCount`), the requester's contact, ~~the lines with an *eligible now* flag~~ ⚠ **(2026-09-30, [DEC-167] (16)) `connections[{ ean, name }]` (no power, no per-line flag) and one `anyConnectionEligible`**, the wallet snapshot, and the **market reference**: the **captured** raw indication (raw price, observed-at, source) and the **current** one — the newest observation for the trade's `delivery_start` across **every** product of the trade's shape and period type and **all sources**, labelled with its source ([DEC-167] (13)). There is **no markup and no customer price** anywhere on the desk.

**Actions.** *Offer* — the price is **typed**, the field starts empty (no prefill), above 0, at most 4 dp, and a value or gross reaching 1e12 is a 400 on `priceEurMwh`; the window is 5–1440 minutes (the portal defaults to 30); the company must be `ACTIVE` and the period not started. Offer mail goes to the requester and, at a four-eyes company, to every active admin, **after** the commit. **Every employee trade write — offer, decline, withdraw-offer, confirm and fail — opens an explicit transaction (`BeginTransactionAsync`) and commits it explicitly**, because the employee host's middleware opens none and a `FOR UPDATE` outside a transaction is released when its statement ends: without it a desk withdraw racing a customer accept would check stale state and surface as a 500 on `ux_trade_event_trade_sequence` instead of a 409 `trade-state-conflict`. *Offer* locks the company's `customer.customer` row `FOR SHARE`, then the trade; *decline and withdraw-offer* lock the trade alone; *confirm and fail* lock the company row `FOR SHARE`, then the trade, then the wallet (**company → trade → wallet**, never the wallet before the trade) **[DEC-167]** (7); confirm re-checks that **at least one** electricity connection of the company is still valid for the whole period (`metering-point-not-eligible` when none is — *fail the trade instead*; ⚠ 2026-09-30, [DEC-167] (16)), creates the account-level block (~~and allocations~~ none) and debits the stored gross in one save; while `AWAITING_APPROVAL` either is 409 `approval-required`; **no customer-`ACTIVE` check** applies, because the money is already committed. The actor's display name is a projection of `employee.employee` — never a materialised entity, because the employee role holds only a column grant there.


### 3.2 Customers, wallets, withdrawals, payments, invoicing, data, reference data

⚠ **New 2026-09-30 ([DEC-167] (17)):** `PUT /api/v1/customers/{customerId}/commercial-terms` — body `{ depositPct }` (0–100, at most two decimals; required), answers `{ depositPct }`. Anything else is a `400` validation problem on `depositPct`; an unknown company is `404`. Back office only (`.BackOffice`, any signed-in operator); there is **no customer write route**. It takes the company row `FOR UPDATE` and writes an audit record in the same transaction — action `COMMERCIAL_TERMS_CHANGED`, entity `Customer`, `before` and `after` `{ "depositPct": … }`. It governs trades accepted from now on; an accepted trade keeps its frozen percentage. The employee `CustomerDetailDto` gains `DepositPct`. The route table below carries it as the row after `/customers/{id}`.

⚠ **Reshaped 2026-08-19.** Four groups are new — withdrawal payout **[DEC-83]**, unmatched-payment
matching **[DEC-106]**, energiebelasting brackets and per-customer reductions **[DEC-74]**, and BRP
administration **[DEC-69]** — and four are struck: surcharge tariffs **[DEC-73]**, four-eyes
thresholds **[DEC-71]**, wallet thresholds **[DEC-90]** and manual wallet adjustments **[DEC-85]**.
The push endpoint replaces finalisation and the **returned number is stored, never minted**
**[DEC-88]**, **[F10-R44]**.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`/`POST`/`PATCH` | `/customers`, `/customers/{id}` | Administration |
| `PUT` | `/customers/{id}/commercial-terms` | ⚠ **New 2026-09-30 [DEC-167] (17)** — the company's deposit percentage on a bought block (default 20). Audited before and after. Back office only |
| `POST` | `/customers/{id}/metering-points` | Attach an EAN |
| `GET` | `/customers/{id}/accounts` | List the company's accounts |
| `POST` | `/customers/{id}/accounts` | Create an account and its membership together. ⚠ **Corrected 2026-09-10 by [DEC-152]: also names a role.** The request carries **`membershipRole`**; the handler writes the account and the `customer_membership` row in one transaction (`AccountEndpoints.cs:30`/`:125` @ debadda0). ~~and send the invitation~~ — ⚠ **struck: no route sends one, see the resend row below** |
| `PATCH` | ~~`/accounts/{accountId}`~~ **`/customers/{id}/accounts/{accountId}`** | Edit name, job title, phone, email and **`membershipRole`**. Username is immutable. ⚠ **Corrected 2026-09-10 by [DEC-152]: the route nests under the company** (`AccountEndpoints.cs:40`), and the role edit is **this** route, not a separate one — see the struck row below. There is **no admin-floor check on this path**: `CustomerMembership.ChangeRole` is a bare setter (`CustomerMembership.cs:86`) and `UpdateAsync` calls it unconditionally, unlike the customer-side `PATCH /company/memberships` above, which does check the floor. ⚠ **Amended 2026-09-23 by [DEC-157]: this route now checks the floor and refuses a demotion below it.** `UpdateAsync` guards the `admin`→non-admin case through the shared `CustomerMembershipCore.WouldBreachAdminFloorAsync` and answers **`409`**, race-safe by opening its own transaction on this transaction-less host so the `SELECT … FOR UPDATE` spans the save (the [DEC-154] lock-ownership fix). It is the back-office twin of the customer `PATCH /company/memberships` refusal and of the [DEC-154] remove-from-company floor; the "no admin-floor check" statement above is closed |
| `POST` | ~~`/accounts/{accountId}/deactivate`~~ **`/customers/{id}/accounts/{accountId}/deactivate`** | Deactivate and revoke sessions. ⚠ **Corrected 2026-09-10 by [DEC-152]: the route nests under the company** (`AccountEndpoints.cs:49`). ⚠ **Amended 2026-09-23 by [DEC-157]: warn + confirm + reason, never refused.** The request takes an optional body `{ acknowledged, reason }`. Deactivating an account that would leave a **four-eyes company with fewer than two active admins [F12-R43]**, or remove a **company's last active account [F12-R17]** — evaluated across **every** company the account is an active member of, because deactivation is person-wide — answers **`409` problem type `deactivation-requires-confirmation`** unless `acknowledged` carries a non-blank `reason` (a blank reason on an acknowledged call is `400`). It is **warned, not refused** — the account may be a leaver — and the forced path is **audited with the reason [F12 §5]**. A deactivation that breaches nothing stays silent `200`. Distinct from the plain `409` conflict an already-deactivated account still answers |
| ~~`POST`~~ | ~~`/accounts/{accountId}/resend-invitation`~~ | ~~Reissue; invalidates the previous link. Under four-eyes no invitation is sent until the second admin approves the addition [F01-R49]~~ ⚠ **Removed 2026-09-10 by [DEC-152] — not shipped.** No route on this host sends, reissues or invalidates an invitation; the back office's own `CreateAsync` sends no email at all. The open item this leaves is already registered on **[DEC-152]**: whether the back office keeps its own account-creation path or becomes the same invitation flow with an employee actor |
| ~~`PATCH`~~ | ~~`/accounts/{accountId}/admin`~~ | ~~set or clear the account's admin flag [F01-R47], [F12-R39]. Refused when it would leave a four-eyes company with fewer than two active admins [F01-R50]~~ ⚠ **Removed 2026-09-10 by [DEC-152]: there is no admin flag, and no route this narrow.** `membershipRole` is set on the general edit route above instead. ⚠ **Amended 2026-09-23 by [DEC-157]:** that general edit route **now enforces the admin-floor refusal on a demotion** — so this row's original `[F01-R50]` refusal is restored there rather than lost (see its own note) |
| ~~`POST`~~ | ~~`/customers/{id}/four-eyes/enable` \| `/disable`~~ | ~~⚠ **New 2026-08-19 [DEC-71]** — turn the mode on or off for a company **[F12-R40]**. Enabling with **fewer than two active admin accounts is refused** **[F12-R41]**. Audited before/after **[DEC-17]**; it takes effect for actions started after it, and does not release a trade already `AWAITING_APPROVAL`~~ ⚠ **Removed 2026-09-29 by [DEC-166].** It was built as one route, `POST /api/v1/customers/{customerId}/four-eyes` taking `{ enabled }` and answering `{ fourEyesEnabled }` — not the enable/disable pair drawn here — and it wrote no audit row. It is **deleted** with its contracts (the employee route count goes from 40 to 39): the mode is set by the company's own admins through `/api/v1/company/four-eyes` §2.7, and the back office only **reads** it — the employee customer detail keeps `FourEyesEnabled` and gains `FourEyesDisablePending` |
| `GET`/`POST` | `/customers/{id}/bank-accounts` | ⚠ **New 2026-08-19 [DEC-71]** — add a bank account. **No `PATCH`**: a bank account cannot be edited, only added or deactivated **[F01-R44]**. Under four-eyes it lands `PENDING_APPROVAL` §2.10 **[F01-R45]** |
| `POST` | `/bank-accounts/{id}/deactivate` | ⚠ **New 2026-08-19 [DEC-71]** — the other half of the pair; also a four-eyes action. A company holds **at most one `ACTIVE`** account, so replacing one activates the new and deactivates the old together **[F01-R46]** |
| `PATCH` | `/metering-points/{id}` | Master data, end-dating, **BRP assignment [DEC-69]**, **[F12-R50]**, and the **production expectation the customer declares at onboarding [DEC-112]**, **[F01-R41]** |
| `GET` | ~~`/wallets?belowThreshold=`~~ `/wallets` | Wallet overview. ⚠ **`belowThreshold` removed 2026-08-19 by [DEC-90]** — there is no threshold to be below. The list can still be **sorted** by lowest available balance; there is no colouring, no warning state and no alert behind it **[F06-R28]**, **[F06-R39]** |
| `GET` | `/wallets/{id}/ledger` | Ledger with actor detail |
| `POST` | `/wallets/{id}/deposits` | Register a bank transfer. ⚠ **Amended 2026-08-19 by [DEC-106]** — this is now the **exception path**, not the normal one: unmatched transfers, payments arriving outside the feed, and everything until **[OQ-93]** is answered **[F07-R17]** |
| ~~`POST`~~ | ~~`/wallets/{id}/adjustments`~~ | ~~Manual adjustment (reason required)~~ ⚠ **Removed 2026-08-19 by [DEC-85]** — chargebacks and reversals are the bookkeeping program's, and the manual-adjustment-with-a-reason path goes with them **[F06-R26]**, **[F06-R27]** retired. ⚠ **Known gap, recorded rather than papered over:** a charged-back iDEAL deposit leaves the wallet overstated and the platform has no entry type left to correct it |
| `GET` | `/withdrawals?state=` | ⚠ **New 2026-08-19 [DEC-83]** — the payout worklist: customer, amount, requester, age, destination bank account, four-eyes state **[F12-R53]**. ⚠ **Built 2026-09-29 by [DEC-166] as `GET /api/v1/wallet/withdrawals?status=&customerId=&page=&pageSize=`** — the withdrawals desk, across every company; shapes and rules below the table |
| `POST` | `/withdrawals/{id}/pay` | ⚠ **New [DEC-83]** — **record a transfer already made**: value date, amount actually transferred, bank reference. Posts `WITHDRAWAL_PAID` and releases the hold in one transaction **[F12-R54]**, **[F06-R36]**. It is **not** an instruction to the bank; the platform initiates no payment. ⚠ **Amended 2026-09-28 by [DEC-165]** — built as `POST /api/v1/customers/{customerId}/wallet/withdrawals/{id}/payout`: the pay-to is **re-resolved** from the company's `ACTIVE` bank account **after** the request's lock is taken and its status checked, never read from the request row, and the resolved IBAN is **persisted as the request's `destination`** and returned. With none `ACTIVE` it is a `409`, *"No bank account on file for this company. Cannot pay out."* The operator's manual transfer is outside the platform and is not checked against it, so it must go to the IBAN the payout resolved and showed. ⚠ **Amended 2026-09-29 by [DEC-166]:** the route takes an **optional** body `{ bankReference }` and records the acting staff member — see the block below the table. The value date and the amount actually transferred that this row lists are **not** recorded |
| `POST` | `/withdrawals/{id}/reject` | ⚠ **New [DEC-83]** — reason **mandatory**; releases the hold **[F07-R32]**. ⚠ **Not built 2026-09-29 — [DEC-166].** The user ruled that marking a withdrawal paid is the only staff action; there is no reject route and nothing writes `REJECTED` |
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
| ~~`GET`/`PUT`~~ | ~~`/reference/four-eyes-thresholds`~~ | ~~Four-eyes thresholds **[DEC-33]**, scoped `GLOBAL_DEFAULT` or per customer, with `valid_from`/`valid_to`. ⚠ **Ships with no rows — the value is not decided.** Until one is in force, acceptance returns `409 four-eyes-threshold-not-configured` **[F05-R53]**~~ ⚠ **Removed 2026-08-19 by [DEC-71]** — there is **no threshold**, in euros or in megawatts, so the table is **not built** rather than shipped empty **[F13-R42]**. Four-eyes is a **per-company flag**, set through `/customers/{id}/four-eyes/enable` above ⚠ **Amended 2026-09-29 by [DEC-166]:** that route is removed; the flag is set by the company's own admins through `/api/v1/company/four-eyes` §2.7 |
| `GET`/`PUT` | `/reference/price-products` | Montel mapping. ⚠ Under **[DEC-96]** the poll goes through the **existing PeakPower Montel service**, not the Montel API directly **[F04-R01]** |
| `GET`/`PUT` | `/reference/price-markup` | ⚠ **New 2026-08-19 [DEC-80]** — the **markup percentage** applied to every customer-facing indication: one platform-wide value, **default 2%**, effective-dated, changed **without a release**, audited before/after **[F12-R48]**, **[F04-R18]**. ⚠ It is now the platform's **only** margin instrument — **[DEC-73]** took the surcharge out — so a wrong value here is wrong on every quote |
| `GET`/`POST` | `/reference/brps` · `PATCH` `/reference/brps/{id}` | ⚠ **New 2026-08-19 [DEC-69]** — a **BRP** is reference data: name, endpoint, credentials, document format / adapter, and the direction and trigger of the exchange **[F12-R49]**. **Credentials are write-only** — replaced, never read back — and rotation is audited like any other reference-data change **[F12-R24]**. PVNed is the first row, not the only one **[F02-R44]** |
| ~~`GET`/`PUT`~~ | ~~`/reference/wallet-thresholds`~~ | ~~Alert rules~~ ⚠ **Removed 2026-08-19 by [DEC-90]**, reversing **[DEC-49]**. No warning amount, no critical amount, no low-balance alert and no `wallet_threshold_rule` **[F06-R39]** |
| `GET` | `/audit?…` | Audit search. Retention is the fiscal **seven years** **[DEC-95]**; the trail covers **actions**, and the financial record of record is the bookkeeping program's |
| `POST` | `/impersonation` | Start a read-only view-as session |

⚠ **The withdrawals desk and the payout body — new 2026-09-29 by [DEC-166].** Staff track withdrawals across every
company, pay them by manual bank transfer outside the platform, and **mark them as paid** — the only staff action, with
no approve and no reject **[DEC-83]**. Both routes carry the back-office policy, as the other wallet routes do.

`GET /api/v1/wallet/withdrawals?status=&customerId=&page=&pageSize=`

| Parameter | Rule |
| --- | --- |
| `status` | `to-pay` (the default; `REQUESTED`), `awaiting-approval` (`AWAITING_APPROVAL`), `paid` (`PAID`), `closed` (`CANCELLED`, `APPROVAL_DECLINED` or `REJECTED`) or `all`. Any other value is a `400`, a validation problem keyed **`status`**: *"Status must be one of: to-pay, awaiting-approval, paid, closed, all."* |
| `customerId` | Optional. Filters to one company |
| `page`, `pageSize` | `page` is 1-based; `pageSize` defaults to 50 with a maximum of 200. An out-of-range value is **clamped, not refused**: a page below 1 is 1, a size below 1 is 50, a size above 200 is 200 |

```jsonc
// 200 OK — WithdrawalDeskListResponse
{
  "items": [
    {
      "id": "0198…",
      "customerId": "0197…",
      "companyName": "Zonnedak Beheer B.V.",
      "amount": 25000.00,
      "status": "REQUESTED",
      "requestedByName": "M. Vandersteen",
      "requestedAt": "2026-09-29T09:10:00+02:00",
      "approvedByName": null,
      "destination": "NL00BANK0123456789",
      "payToIban": "NL00BANK0123456789",
      "payToHolderName": "Zonnedak Beheer B.V.",
      "bankReference": null,
      "paidByName": null,
      "resolvedAt": null
    }
  ],
  "total": 12,
  "counts": { "toPay": 12, "awaitingApproval": 3, "paid": 40, "closed": 9, "all": 64 }
}
```

- **Ordering.** `to-pay` and `awaiting-approval` are **oldest first**, first come first served; the rest are newest
  first; the id breaks ties, so a page boundary is stable between two loads.
- **`total` is the filtered count; `counts` are not.** ⚠ **As built 2026-10-01, [DEC-170] (16): `counts` gains `paid`, `closed` and `all`, each equal to the length of the desk's own filter of that name.** `counts.toPay` and `counts.awaitingApproval` are totals across
  **every company**, independent of `status` and `customerId`.
- **`status`** on an item is the existing withdrawal wire value (`REQUESTED`, `AWAITING_APPROVAL`, `APPROVAL_DECLINED`,
  `REJECTED`, `PAID`, `CANCELLED`). `companyName` is the trade name, falling back to the legal name.
- **`payToIban` and `payToHolderName` are the company's current `ACTIVE` bank account, read at query time** — both null
  when it has none — so a replace shows on the next load. **`destination` is the row's own column**: the request-time
  snapshot, re-pointed by a replace while the request is open **[DEC-165]**, and the account actually paid once `PAID`.
  The list is read-only and takes no lock: **where money goes is the payout's own re-resolution under the withdrawal
  lock, never this list.**
- **Names** come from the account records the back office already reads: `requestedByName`, and `approvedByName` when
  a second admin approved under four-eyes; a person it cannot resolve reads *"Unknown"*. `paidByName` is the staff
  member's display name **as a snapshot** and is null until `PAID`; `resolvedAt` is when the request left the open set.
  **Staff names never reach the customer contract** §2.5.

```jsonc
// POST /api/v1/customers/{customerId}/wallet/withdrawals/{id}/payout — the whole body is optional
{ "bankReference": "SEPA-20260929-0042" }
// 200 OK — the WithdrawalRequestDto, now carrying "bankReference"
```

- **`bankReference`** is trimmed; an absent body, an absent property, an empty value and a whitespace one all mean none;
  **more than 140 characters is a `400`** keyed `bankReference`, *"A bank reference must be at most 140 characters."*,
  checked before the request is locked. A call with **no body still works**.
- **Recorded on the payout:** `bank_reference`, `paid_by_employee_id` (the username on the employee's token) and
  `paid_by_employee_name` (the display name at that moment; the username when none is found) — migration 28. **No value
  date and no amount actually transferred** are recorded: the payout pays the requested amount in full.
- **`404`** for an unknown company wallet or withdrawal. **`409`**, the generic `conflict` problem type: *"This
  withdrawal is {STATUS}, not REQUESTED - it is not ready for payout."*, or, with no `ACTIVE` account,
  *"No bank account on file for this company. Cannot pay out."*
- **The payout still records the company's `ACTIVE` account as it is when the payout runs**, which is not necessarily
  the account the operator was shown; the desk warns after the fact when the two differ. An expected-IBAN precondition
  on this body is a possible follow-up and is **not built** **[DEC-166]**.

⚠ **Three endpoints that will never be added, stated so nobody adds them.**

| Never | Why |
| --- | --- |
| A feed-in tariff CRUD | **[DEC-87]** reverses the second half of **[DEC-44]**: exported volume is credited at the **day-ahead price, raw**, exactly as surplus is under **[DEC-23]**. There is no feed-in tariff and therefore no `MISSING_FEED_IN_TARIFF` and no skip **[F10-R42]** retired |
| An invoice-numbering endpoint | The bookkeeping program owns numbering **[DEC-88]**. The platform **stores** the returned number and never mints one, so there is no sequence to configure and no gap to repair |
| An invoice PDF or email endpoint | **[DEC-89]**. **[DEC-48]** (SendGrid) narrows to the platform's **own** notifications: offers, wallet events, alerts |

### 3.3 Operators — staff accounts **[DEC-155]**

⚠ **Added 2026-10-01 ([DEC-168]) for the desk-mail setting; the six routes themselves are [F13-R48]'s.** `/api/v1/operators` lists, creates (with an emailed set-password invite), edits, deactivates, reactivates and re-invites back-office staff. Every route is `.BackOffice(...)` **and** the `BackOfficeAdmin` policy: an ordinary operator is refused, as for every operator route.

| Route | Change for the desk-mail setting |
| --- | --- |
| `GET /api/v1/operators` | Each `OperatorResponse` carries **`receivesTradeDeskMail`** (boolean) beside `isAdmin` |
| `POST /api/v1/operators` | `CreateOperatorRequest` takes an **optional** `receivesTradeDeskMail`, **default `true`** when omitted. The create `INSERT` names only granted columns (never `password_hash`) |
| `PUT /api/v1/operators/{id}` | `EditOperatorRequest` takes `receivesTradeDeskMail` as **required**, because the `PUT` replaces the editable fields (display name, `isAdmin`, the setting). Flipping it either way takes effect for the next Worker tick |

The setting governs **only** the two trade-desk mails *new trade request* and *accepted — ready to confirm* **[DEC-168]**; the invite and password-reset mails ignore it. Deactivate, reactivate and resend-invite are unchanged, and a deactivated operator receives no desk mail whatever the stored setting says. The OpenAPI artifact the harness pins gains the field, and the generated employee client follows [§7](#7-openapi).

### 3.4 Legal documents — [DEC-174], added 2026-10-05

⚠ **Amended 2026-10-09 by [DEC-177] (2), (7):** a version is an edition with an English and a Dutch file. The version DTO's top-level `fileName`, `sizeBytes` and `sha256` are replaced by **`files`**, the upload takes two files, the download takes a language, and the upload limit is 22 MiB. This **breaks the employee contract on purpose**: it is internal, and the web is deployed right after the platform.

Reads need **any signed-in employee**. **Every write carries `.RequireAuthorization(BackOfficeAdmin)`** besides `.BackOffice(...)`, as for the operator routes (§3.3); an ordinary operator gets `403` from the authorization middleware before the body is read. An unauthenticated call is `401` on every route. Feature: [F16](../10-features/F16-legal-documents.md).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/legal-documents` | `200` `LegalDocumentSummaryDto[]`: each type (visible or not), ordered by `sortOrder` then `key`, with `key`, `title`, `publicUrl`, `visibleToCustomers`, `sortOrder`, `builtIn`, its **current** version, any **scheduled** version (metadata) and `versionCount` |
| `GET` | `/legal-documents/{key}` | `200` `LegalDocumentDetailDto`: the type (`key`, `title`, `publicUrl`, `visibleToCustomers`, `sortOrder`, `builtIn`) plus **all** versions' metadata, newest first, the scheduled one included. Each version has `versionNumber`, `files` (a list of `language`, `fileName`, `sizeBytes`, `sha256`, one per language), `effectiveFrom`, `uploadedAt`, `uploadedByEmployeeId` and `uploadedByName` (both null for a system import), `changeNote`, `isCurrent`, `isScheduled`. `404` for an unknown or malformed key |
| `GET` | `/legal-documents/{key}/versions/{n}/file` | `200`: the PDF of **any** version, scheduled included, in the language asked for with `?lang=en` or `?lang=nl` (for example `/legal-documents/terms-of-use/versions/3/file?lang=nl`; without `lang` the language rule of §2.12 applies; **an explicit `lang` is exact: a language the version lacks is `404`, with no fallback**; without `lang`, or with a value that is neither `en` nor `nl`, the rule of §2.12 picks the language **with** the fallback and the response sends `Vary: Accept-Language`), with `Content-Disposition: attachment` and the generated filename (the language code included), `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`. `404` for an unknown key or version (a non-integer `n` is a route miss, so also `404`). Needs the session's bearer token, so a client fetches it as a blob |
| `POST` | `/legal-documents/{key}/versions` | **Admin.** `multipart/form-data`: `fileEn` and `fileNl` (both required), `effectiveFrom` (exactly `yyyy-MM-dd`, optional), `changeNote` (optional, at most 500, trimmed, blank becomes null). `201` with the `LegalDocumentVersionDto` and `Location: /api/v1/legal-documents/{key}/versions/{n}/file` |
| `DELETE` | `/legal-documents/{key}/versions/{n}` | **Admin.** Withdraws a **scheduled** version: `204`, no body. `409` for an effective one (*This version is already effective, so it can never be changed or deleted. Upload a new version instead.*); `404` for an unknown key or version |
| `POST` | `/legal-documents` | **Admin.** Creates a custom type: `title`, an optional `key` (derived from the title when absent: accents folded, hyphenated, at most 64; `user-agreement` is reserved, whether explicit or derived, and is `422` under `key`), `visibleToCustomers` (default true). Its sort order is the highest existing one plus 10. `201` `LegalDocumentSummaryDto` and `Location: /api/v1/legal-documents/{key}`; `422` with errors under `title` or `key`; `409` when the key is already taken |
| `PATCH` | `/legal-documents/{key}` | **Admin.** `title`, `visibleToCustomers`, `sortOrder`; an absent or null field is left alone. `200` `LegalDocumentSummaryDto`. Hiding a built-in type is `422` under `visibleToCustomers`; a bad title is `422` under `title`; `404` for an unknown key |

**`publicUrl`** is `{CustomerPortal:BaseUrl}/legal/{key}` (the employee host's existing `CustomerPortal__BaseUrl` setting, trailing slash trimmed) and is **always present**, on the list, the detail, and the `201` and `200` summaries of `POST` and `PATCH`. It is the short public link of §2.12; it opens a document only while `visibleToCustomers` is true and the type has a current version, which the same response shows. The version DTO changes only as the note at the head of this section says.

**Upload status codes.** `201` created; `401` not signed in; `403` not an admin; `404` unknown key; `409` a scheduled version already exists (*A version of this document is already scheduled. Withdraw the scheduled version first.*), whatever the new upload's date; `413` (`title` *The file is too large*) when either file part is over 10 MiB (exactly 10 MiB is accepted); `422` with `errors` keyed `fileEn` or `fileNl` (that file is not a PDF — the `%PDF-` magic bytes decide — empty, or missing; each file is checked separately and nothing is stored unless both pass), `effectiveFrom` (malformed, or before today in Amsterdam), `key` (a malformed key in the path) or `changeNote` (over 500). The content, date and note are checked before the scheduled-version conflict, so a bad file is `422` even while a version is scheduled. A date equal to today means **now**; a later date means 00:00 Europe/Amsterdam on that date. Version numbers are max + 1 per type. The stored `fileName` is the upload's own name sanitised (`[A-Za-z0-9._ -]`, other runs become `_`, `.pdf` forced, at most 200 characters) and is display only. The endpoint carries request-size metadata of **22 MiB** (two files of 10 MiB plus the form) and the **proxy** raises its limit to 22 MB for this prefix on the admin host only ([deployment §4.6](09-deployment.md)); a body over that is cut off by nginx (its own HTML `413`) or Kestrel. The route is bearer-token authenticated, so antiforgery is disabled on it; no other employee `POST` uses antiforgery either. Upload, withdraw and `PATCH` take the type's row `FOR UPDATE` first.

**OpenAPI.** The employee host has its own `FileDownloadOperationTransformer` (a twin of the customer host's) so the download is documented as a binary PDF.

**Audit.** Each write is an `AuditRecord` with `customer_id` null and the actor `employee:{username}`: `LEGAL_DOCUMENT_UPLOADED` and `LEGAL_DOCUMENT_VERSION_WITHDRAWN` (entity `LegalDocumentVersion`; the payload names the employee, the type key, the version number, the effective-from time, `files` — a list of language, file name, size and SHA-256, one per language — and the change note; old payloads are not rewritten), and `LEGAL_DOCUMENT_TYPE_CREATED` and `LEGAL_DOCUMENT_TYPE_UPDATED` (entity `LegalDocumentType`; the payload names the employee, the type key, the title, the visibility and the sort order).

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
`totalValue` → `totalValueExVat` beside a larger `amountToReserve` **[DEC-78]** §2.4 (⚠ (17): then `amountToReserve` → `totalInclVat` **[DEC-167]** §2.4.3), the `fourEyes`
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
