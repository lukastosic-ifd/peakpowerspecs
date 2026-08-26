# PoC Slice 1 — "From sign-up to your connections"

> **Status:** design, for review · **Date:** 2026-08-26
> **Repositories built:** `peakpower-platform` (.NET), `peakpower-web` (Angular)
> **Specification:** `peakpowerspecs` · **Visual reference:** `trading-poc` + the
> `PeakPower Trading Design System` project in Claude Design

---

## 1. Why this slice

The specification already chose it. The roadmap's first buildable bar after Phase 0 is
`p1a` — *"Foundations · auth · customers"* ([roadmap §3](../../../specs/70-delivery/01-roadmap-and-phasing.md)) —
and `[DEC-20]` instructs that the `customer_id` / `account_id` context pipeline, the EF Core
global query filter and row-level security be **built and tested from the first commit**.
Skipping authentication is explicitly not permission to skip tenancy.

It is a genuine vertical slice: real PostgreSQL with real constraints, two real .NET API
hosts, two real Angular applications on the real design tokens, brought up with one command
and demonstrable in a browser. Every later slice contains it, so none of the work is thrown
away.

**The demo story.** A prospect completes the onboarding wizard → a company, an account and
its connections exist in Postgres → they sign in and see their connections → a PeakPower
employee sees the same company in the back office and can administer it.

---

## 2. Decisions taken for this slice

Four forks were settled before design. Three of them deviate from the specification and are
recorded here as proposed changes (§10).

| # | Decision | Consequence |
| --- | --- | --- |
| D1 | **Slice A — see your connections** is the first PoC | F01 is the feature; F02/F03/F05 follow |
| D2 | **EAN validation relaxed to 18 digits** for the PoC | Reverses the check-digit half of `[F01-R24]`; must be reinstated before go-live |
| D3 | **Self-onboarding as built in `trading-poc`** | Reverses `[DEC-16]`, `[DEC-29]`, `[F01-R12]`; the platform holds a customer credential |
| D4 | **Navigation follows the design, not the wireframes** | Amends `screens-customer.mjs`; labels move, route keys do not |

### 2.1 What D3 costs, stated plainly

The demo's wizard collects a password at step 1 with a twelve-character minimum. Three
recorded decisions currently forbid the platform from holding one:

- `[DEC-16]` — account creation stays with PeakPower employees
- `[DEC-29]` — the identity provider owns credentials; no credential storage, no reset flow
- `[F01-R12]` — the password is never set, stored or seen by the platform

Building the wizard as-is reverses all three for the customer-initiated path. It also has a
companion the demo already implements: customers claim EANs from a shared pool rather than an
employee attaching them, which amends `[F01-R23]`.

**How this slice contains the cost.** Credentials are hashed with **Argon2id** (memory 19 MiB,
iterations 2, parallelism 1 — OWASP's current floor), never logged, never returned by any
endpoint. `ICustomerContext` stays the single seam through which identity reaches the
application layer, so replacing the platform credential with an Entra token later is a change
of DI registration, not a change to the wizard, the portal or any query. **Password reset is in
scope** (§7) — a credential store without a reset path is not shippable beyond a PoC. Hard
account lockout and MFA are not; sign-in carries a progressive delay instead, and the policy
values are the narrowed `[OQ-98]`.

---

## 3. Scope

### In

**Onboarding (customer-initiated)**
- The ten-step wizard: personal information · company · registered address · industry ·
  electricity volume · bank verification · signing authority · authorised signatories ·
  sign · welcome
- Six-digit signing code, emailed through an `IEmailSender` port with a console sink
- On signing: `customer` + `customer_account` + `wallet` materialised in one transaction

**Customer portal**
- Sign in / sign out; JWT access + refresh tokens, ES256 with a JWKS endpoint
- Password reset by emailed single-use token, with sign-in rate limiting
- Connections: list `[F01-R35]`, free-text search `[F01-R36]`, detail `[F01-R38]`
- Friendly name ≤80 and description ≤500 `[F01-R29]`; name replaces the EAN as the primary
  label with the EAN secondary and copyable `[F01-R30]`; grouped-EAN fallback `[F01-R31]`
- Claim a connection from the shared EAN pool, declaring production expectation per EAN
  `[F01-R54]` with source `CUSTOMER_DECLARED`
- Read-only company profile `[F01-R09]` and account list `[F01-R21]`

**Employee portal**
- Customers: list, detail, create, edit `[F01-R01]`…`[F01-R07]`
- Accounts: create, edit, deactivate `[F01-R10]`…`[F01-R17]`
- Metering points: attach, edit, end-date `[F01-R23]`…`[F01-R27]`
- Reference data: BRPs `[F12-R49]` — enough to seed and display the PVNed row

**Platform**
- Aspire bring-up across two repositories, one command from either side
- Migrations run to completion before any API starts
- Tenancy: context pipeline, query filter, row-level security, 404-not-403, and the tests
  that prove all four
- OpenAPI emitted at build; typed clients as committed workspace packages `[DEC-116]`
- No CI, no remotes, no registry — slice 1 runs entirely on a developer machine

### Out

Ingestion and the BRP adapter (F02) · charts (F03) · prices (F04, F08) · trading (F05) ·
wallet movements and the ledger (F06) · payments (F07) · surcharges, invoicing, settlement
(F09, F10) · notifications beyond the signing code (F11) · four-eyes **behaviour** (F01-R42…R50)
· the public site (F14) · Hangfire, Redis, blob storage, SendGrid, Montel, PVNed, the
bookkeeping program · mobile and tablet layouts · hard account lockout · MFA.

Four-eyes **columns** are in scope; four-eyes **behaviour** is not. `[DEC-71]` and the roadmap
both say to ship `is_admin` and `four_eyes_enabled` in Phase 1 even though nothing reads them
until Phase 2, because retrofitting a role onto live accounts is worse than shipping an unused
column.

---

## 4. Architecture

### 4.1 Stack, as verified on 2026-08-26

| Layer | Choice | Source | Verified |
| --- | --- | --- | --- |
| Backend | .NET 10 / C# | `[architecture §7]` | SDK 10.0.400 installed, default |
| Web framework | ASP.NET Core Minimal APIs | `[architecture §7]` | — |
| ORM | EF Core 10 (+ Dapper later) | `[architecture §7]` | — |
| Database | PostgreSQL 17 | `[DEC-09]` | Docker 29.7.2 running |
| Orchestration | .NET Aspire **13.5.3** | `[architecture §7]` | ⚠ now a CLI + SDK, not a workload |
| Frontend | Angular 22 | `[DEC-54]` | `@angular/cli@22.1.6` is `latest` |
| Repositories | two, sibling checkout | `[DEC-55]` | already the folder layout |

> ⚠ **The Aspire delivery model changed after the spec was written.** Aspire is no longer a
> `dotnet workload`. It is the `aspire.cli` global tool plus the `Aspire.AppHost.Sdk` NuGet
> package, currently 13.5.3. Install with `dotnet tool install -g aspire.cli`. The AppHost
> `Program.cs` in [solution structure §4](../../../specs/20-architecture/02-solution-structure.md)
> must be checked against the 13.x API before it is copied — in particular `AddNpmApp`, which
> §10 already amends for a second reason.

### 4.2 Projects built in this slice

Fifteen projects — eleven source, four test. Everything else waits until something needs it.

> ⚠ **This is two more than the tree below first showed.** Writing the plans surfaced four
> infrastructure projects the design had left implicit, one of which (`Infrastructure.Time`)
> architecture fact 5 names directly. They are listed in
> [shared contract §3.1](../plans/2026-08-26-slice-1-shared-contract.md).

```
peakpower-platform/
├── PeakPower.sln
├── Directory.Build.props            # nullable, warnings-as-errors, analyzers
├── Directory.Packages.props         # central package versions
├── src/
│   ├── Hosts/
│   │   ├── PeakPower.AppHost/
│   │   ├── PeakPower.ServiceDefaults/
│   │   ├── PeakPower.Api.Customer/
│   │   ├── PeakPower.Api.Employee/
│   │   └── PeakPower.Migrator/
│   ├── Core/
│   │   ├── PeakPower.Domain/
│   │   ├── PeakPower.Application/
│   │   └── PeakPower.Contracts/
│   └── Infrastructure/
│       ├── PeakPower.Persistence/
│       ├── PeakPower.Time/            # IMarketCalendar — the ONLY clock  [arch fact 5]
│       ├── PeakPower.Web/             # the ONE context-provider assembly [arch fact 6]
│       ├── PeakPower.Identity/        # Argon2id + the token issuer
│       └── PeakPower.Email/           # console sink in slice 1
├── tests/
│   ├── PeakPower.Domain.Tests/
│   ├── PeakPower.Application.Tests/
│   ├── PeakPower.Integration.Tests/     # Testcontainers + real Postgres 17
│   └── PeakPower.Architecture.Tests/    # NetArchTest
└── artifacts/openapi/                   # customer.json, employee.json
```

**Deferred:** `Worker`, `Ingestion`, `Integration.Brp.Pvned`, `Integration.Montel`,
`Integration.Payments`, `Integration.Bookkeeping`, `Integration.Email`, `Jobs`, `DevStubs`,
`deploy/`.

Email in this slice is an `IEmailSender` port in `Application` with a console-sink adapter
registered in the Customer API's composition root. The wizard's signing code needs a channel,
not a vendor.

### 4.3 The three rules, enforced in week 1

`Domain` references nothing. `Application` references only `Domain` and defines ports.
Hosts reference infrastructure solely to register it in DI at the composition root.

These get NetArchTest facts in the first week, not at the end. The specification's own reason
is the right one: *without the test the seam closes again within two sprints, silently.*

### 4.4 Aspire resources for this slice

`postgres` (with data volume and pgAdmin) → database `peakpower` → `migrator` → `customer-api`
and `employee-api`, both `WaitForCompletion(migrator)` → two `AddNpmApp` front-ends resolved
through `PEAKPOWER_WEB_PATH`, defaulting to the sibling checkout.

Redis, the storage emulator, the `hangfire` database and `dev-stubs` are **not** added. They
have no consumer in this slice and an AppHost that starts unused containers trains people to
ignore it.

---

## 5. Data

### 5.1 Migration 1

Schemas `customer`, `metering`, `wallet`, `audit`. Tables:

| Table | Purpose |
| --- | --- |
| `customer.customer` | the company — `[F01-R01]`…`[F01-R07]`, incl. `four_eyes_enabled` |
| `customer.customer_account` | one person's login — incl. `is_admin`, `password_hash` (D3) |
| `customer.onboarding_application` | the wizard's accumulating answers |
| `customer.refresh_token` | rotating, single-use, revocable — hashed at rest |
| `customer.password_reset_token` | single-use, one-hour TTL — hashed at rest |
| `customer.metering_point` | EAN, BRP, production expectation, validity, `name`, `description` |
| `metering.brp` | reference data; the PVNed row is seeded **first** |
| `wallet.wallet` | stub — one EUR wallet per customer `[F01-R05]` |
| `audit.audit_record` | append-only, actor + before/after `[F01-R06]` |

**Migration 1 does not create all nine.** Three of them — `onboarding_application`,
`refresh_token`, `password_reset_token` — have column sets only the authentication work can
specify, so they arrive in migration 3. RLS roles and policies are migration 2, and the EAN
pool is migration 4. The split is tabulated in
[shared contract §3.2](../plans/2026-08-26-slice-1-shared-contract.md).

Three things go into migration 1 specifically because retrofitting them is expensive:

**a. The extensions the spec's DDL needs and never declares.**

```sql
CREATE EXTENSION IF NOT EXISTS citext;      -- username, email
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- equality inside a GiST exclusion constraint
```

**b. The EAN validity exclusion constraint**, in the database rather than the application:

```sql
EXCLUDE USING gist (ean WITH =, validity WITH &&)
```

with `validity` a half-open `[valid_from, valid_to)` range. `[F01-R26]` and `[AS-03]` require
that the same EAN may serve different customers over non-overlapping periods, and overlaps be
rejected. A database that permits the overlap has already lost the argument.

**c. The two dead boolean columns**, `customer.four_eyes_enabled` and
`customer_account.is_admin`, per `[DEC-71]`.

### 5.2 Conventions

`uuid` primary keys via `gen_random_uuid()` · snake_case, singular, schema-qualified ·
money `numeric(18,6)`, rounded to 2 only at presentation `[DEC-12]` · `timestamptz` in UTC,
business days in Europe/Amsterdam through one calendar service `[DEC-08]` · EF Core migrations
applied by the dedicated `Migrator` host, forward-only, expand/contract for breaking changes.

### 5.3 Enum spellings

The specification defines three enums twice, differently. This slice takes the **database
spelling** as normative and §10 amends the domain model to match.

| Enum | Domain model says | Database says | This slice uses |
| --- | --- | --- | --- |
| `ProductionExpectation` | `NotExpected` | `NEVER` | **`NEVER`** |
| `AccountStatus` | no `PendingApproval` | has `PENDING_APPROVAL` | **with** `PENDING_APPROVAL` |
| `FourEyesAction` | four arms | five, incl. `TRADE` | **five** |

### 5.4 The friendly name

Specified three incompatible ways: a `metering_point_label` table (F01 §6), a `Label` property
(domain model), and `name` + `description` columns (the DDL). This slice adopts the **physical
schema** — `name` and `description` on `customer.metering_point` — because that is what
`[F01-R29]`'s ≤80 and ≤500 limits actually describe. §10 proposes deleting the other two.

### 5.5 Seed data

Six companies, each with accounts and connections, mirroring `trading-poc`'s roster so the
built portal and the demo show the same names. The EAN pool is seeded from the demo's six
EANs plus enough unclaimed numbers to make the claim flow demonstrable.

Under D2 those EANs validate on length alone. They do **not** carry correct GS1 check digits —
all six fail — so §10 registers reinstating the check digit as an open question with an owner,
and the seed script carries a comment saying so at the point where it inserts them.

---

## 6. Tenancy

This is the deliverable the slice is judged on.

`[DEC-20]` expected tenancy to be proven with a development context provider because the PoC
would run unauthenticated. D3 gives us real sign-in instead, which is strictly stronger: the
same machinery is exercised by a real session rather than a switcher.

| Mechanism | Requirement |
| --- | --- |
| `ICustomerContext`, one interface, registration is the only variable | `[F13-R30]` |
| EF Core `HasQueryFilter` on every customer-owned entity | `[architecture §6]` |
| Postgres RLS, `app_customer_role`, `SET LOCAL app.customer_id` per request per transaction | `[security §2]` |
| Cross-tenant reads return **404, not 403** | `[F13-R19]` |
| Startup guard refusing to boot a non-production provider in Production | `[F13-R31]` |
| Architecture test banning `IgnoreQueryFilters()` | `[security §2]` |
| **Route-table test**: sign in as A, assert 404 on every one of B's objects | `[security §2]` |

The route-table test is driven off the registered endpoint table rather than a hand-written
list, so a new endpoint cannot silently escape it. That property is the point; a hand-written
list decays on the first busy sprint.

`[F13]` business rule 2 says reading a customer identifier from a route, query, body or header
for authorisation is a defect. §10 proposes hardening that into an architecture test rather
than leaving it as advice, since this slice is the one where it would be tempting.

---

## 7. API surface

REST, `/api/v1`, RFC 7807 problem details, no internal detail leaked to the customer API.
OpenAPI documents emitted at build into `artifacts/openapi/`; a snapshot test fails the build
on an unreviewed contract change.

### Customer API

```
POST   /onboarding/applications                 start — person + credential
PATCH  /onboarding/applications/{id}            save one step's answers
POST   /onboarding/applications/{id}/signatories
POST   /onboarding/applications/{id}/sign       verify code, materialise company
POST   /auth/sign-in                            → access token + refresh cookie
POST   /auth/refresh                            rotate; refresh cookie only
POST   /auth/sign-out                           revoke the refresh token
GET    /auth/me
GET    /.well-known/jwks.json                   public keys for ES256 validation
POST   /auth/password-reset/requests            always 202
POST   /auth/password-reset/completions         token + new password
GET    /company                                 read-only profile        [F01-R09]
GET    /company/accounts                        read-only account list   [F01-R21]
GET    /metering-points                         list + search            [F01-R35] [F01-R36]
GET    /metering-points/{id}                    detail                   [F01-R38]
PATCH  /metering-points/{id}/naming             name + description       [F01-R29]
GET    /ean-pool?q=                             unclaimed connections
POST   /metering-points                         claim one, declare expectation [F01-R54]
```

### Employee API

```
GET    /customers                       POST   /customers
GET    /customers/{id}                  PATCH  /customers/{id}
POST   /customers/{id}/accounts         PATCH  /accounts/{id}
POST   /accounts/{id}/deactivate
POST   /customers/{id}/metering-points  PATCH  /metering-points/{id}
POST   /metering-points/{id}/end-date
GET    /reference-data/brps
```

### Authentication — JWT

A short-lived **access token** (15 minutes) and a rotating, single-use, revocable **refresh
token** (14 days).

**Signed ES256 against a JWKS endpoint, not a shared secret.** This is the choice that pays
off later: `Api.Customer`'s token-validation path becomes the *same code* that will validate an
Entra token, and migrating means changing an issuer and a JWKS URL rather than replacing the
pipeline. HS256 would be simpler to stand up and would have to be thrown away.

**Claims mirror what Entra is expected to supply**, so the claim contract is rehearsed here
rather than invented during the identity slice:

| Claim | Holds | Later supplied by |
| --- | --- | --- |
| `sub` | account id | Entra `sub` |
| `customer_id` | the company | the claim mapping `[F13-R32]` |
| `is_admin` | the `[DEC-71]` flag | an app role or mapped claim |
| `amr` | how the person authenticated | Conditional Access `[DEC-92]` |
| `stamp` | credential version | PoC only — see revocation |

`ICustomerContext` reads `customer_id` from the validated token and from nowhere else.
`[F13]` business rule 2 makes reading it from a route, query, body or header a defect.

**Browser storage.** The access token lives **in memory only** — an Angular signal, never
`localStorage`, never `sessionStorage`. The refresh token is an HttpOnly, Secure,
`SameSite=Strict` cookie scoped to the refresh endpoint alone. This is the one part of the
design where getting it wrong is silently exploitable rather than visibly broken: a JWT in
`localStorage` is readable by any XSS, and §8.5 already records that the prototype builds all
its markup by string concatenation.

**Revocation, and a real conflict with `[F01-R16]`.** That requirement says deactivating an
account "revokes its sessions immediately". A stateless bearer token cannot be revoked before
it expires, so the honest reading is that a 15-minute access token leaves a 15-minute window.
Three ways out:

| | Approach | Verdict |
| --- | --- | --- |
| a | Accept the window, document it | Cheapest, and wrong for a requirement that says *immediately* |
| b | A denylist checked per request | Reintroduces exactly the state JWT was chosen to avoid |
| c | **A `stamp` claim compared to a `security_stamp` column on the account, per request** | **Chosen** |

(c) costs nothing measurable here, because every request already opens a transaction to
`SET LOCAL app.customer_id` for row-level security — the stamp check rides along on a row
already being touched. Deactivating an account, completing a password reset, or an employee
editing the account bumps the stamp, and every outstanding token for that account dies on its
next call. It satisfies `[F01-R16]` literally, and it makes refresh tokens revocable for free.

### Password reset

`[DEC-113]` puts a credential in the platform, so the reset path comes with it. A credential
store without one is not shippable past a demo.

```
POST /auth/password-reset/requests      { email }                 → always 202
POST /auth/password-reset/completions   { token, newPassword }
```

- The request endpoint **always** returns 202, whether or not the address exists. Anything else
  is an account-enumeration oracle.
- The token is 32 bytes from a CSPRNG, stored **hashed**, single-use, one-hour TTL.
- Completion bumps `security_stamp`, so every outstanding access and refresh token for that
  account dies immediately — the same mechanism the revocation design above already needs.
- Sign-in and reset requests are rate-limited per address **and** per source. Progressive delay
  rather than hard lockout: a hard lockout on a username is a denial-of-service primitive
  against a named customer.

The *policy values* — delay curve, token TTL, password composition beyond the wizard's
twelve-character minimum — are the narrowed `[OQ-98]`; the mechanism is not open.

### Cross-repository clients

**Slice 1 uses no package registry at all.** The two OpenAPI documents are emitted at build and
generated into two npm **workspace packages** inside `peakpower-web`, which are **committed**:

```
peakpower-web/libs/api-client-customer/    name: @peakpower/api-client-customer
peakpower-web/libs/api-client-employee/    name: @peakpower/api-client-employee
```

npm workspaces resolve a dependency by the `name` field in its `package.json`, not by registry
scope, so `import { … } from '@peakpower/api-client-customer'` works locally today and keeps
working unchanged the day the packages are published — provided the organisation is eventually
named `peakpower`. That is the reason to keep the specification's name rather than pick one
that matches an owner we happen to have now: **the migration is then a publish step and an
`.npmrc`, with not one import touched.**

This is the specification's own sanctioned fallback, not an invention:

> *"generate the clients in platform CI and open an automated pull request that commits them
> into `peakpower-web`. It is uglier and it works — the generated code is reviewable in the
> diff."* — [solution structure §5.1](../../../specs/20-architecture/02-solution-structure.md)

**What still has to hold.** The specification's real objection is to *each developer generating
clients locally*, because that is a build that differs per machine. Committing the output does
not by itself fix that; one more thing does:

| Mechanism | Slice 1 | Later |
| --- | --- | --- |
| Generation is a single scripted step, pinned generator version | `npm run generate:clients` | unchanged, moved into CI |
| **Staleness check** — regenerate and fail if the diff is non-empty | a `verify:clients` script, run by `dev-up` and before commit | a required CI check |
| Semver on a breaking OpenAPI diff | not applicable — no versions yet | enforced at publish |
| Contract snapshot test fails the build on an unreviewed change | ✅ in slice 1 | ✅ |
| Nightly build against the latest published client | not applicable | ✅ |

The staleness check is what replaces the registry. Without it, committed clients rot silently
and the two repositories drift exactly as `[DEC-55]` warns.

**Migration, when the organisation exists.** Add `.npmrc` mapping `@peakpower` to
`https://npm.pkg.github.com`, add a publish step to platform CI, replace the two workspace
entries with versioned dependencies, delete the committed source. Imports do not change. If the
organisation ends up named something other than `peakpower`, one find-and-replace across
`peakpower-web` does change them — which is the cost of `[OQ-100]` staying open, and it is
small and bounded.

---

## 8. Frontend

### 8.1 Workspace

```
peakpower-web/
├── package.json          # ONE workspace — start:customer-portal, start:employee-portal
├── angular.json
├── apps/
│   ├── customer-portal/
│   └── employee-portal/
├── libs/shared-ui/
└── tools/dev-up.*
```

`apps/public-site` is not created in this slice. It is the most expensive of the three and
`[DEC-93]` removed the CMS that would have justified starting it early.

### 8.2 Design system

The visual source is the **PeakPower Trading Design System** project in Claude Design, which
already holds `tokens/*.css`, 13 React primitives each with a `.d.ts` and a `.prompt.md`, 21
guideline specimen cards, and the Inter subsets. Porting to Angular is a translation, not a
redesign.

`libs/shared-ui` gets nine things first:

1. **Token module** — the SB-2026 custom properties as one source. Drop
   `--certainty-provisional-opacity`; the certainty layer was removed and the token is dead.
2. **AppShell** — 236px rail at `#2D3F54` with the five-stop spectrum hairline, 64px sticky
   topbar showing a crumb *or* a subtitle but never both, `.main` as the scroll container with
   `.app` at `height:100vh; overflow:hidden` so the body never scrolls, fixed gradient canvas.
3. **Card** — `18px 20px`, title 13.5/700, subtitle 11.5 as a **sibling** of the head, head
   `margin-bottom` 14px dropping to 4px when a subtitle follows, no `margin-top`.
4. **StatCard** — `14px 16px`, `min-width:160px`, label 11/600 at `.04em`, value 23/700 with
   `margin-top:8px`, sublabel 11 faint at `margin-top:6px`, **no `flex:1`**, 3px accent cap via
   `::before` with the tone class on the outer element, `overflow:hidden`.
5. **Badge** — 11/600, `4px 12px`, pill radius, `line-height:1.2`, no letter-spacing, a real
   1px border on every tone.
6. **Button** — 13/600 at `10px 20px`, `.btn-sm` at `7px 14px`/12px, `border:1px solid` on
   **every** variant so heights match, `.btn-danger` filled `--pp-red-value`.
7. **Banner** and **DsBanner** as two components, not one parameterised component. The design
   record is explicit that they are not interchangeable.
8. **GridTable** — `display:grid` divs, not `<table>`; two densities; per-screen
   `grid-template-columns` passed in as data and never tidied; and a hard rule that it is
   **never rendered with zero rows** — branch on row count and use the empty-card treatment.
9. **SearchInput** — with the one inline magnifier that is the product's only icon.

Two colour rules must survive the port, because breaking either silently drops an 11px badge
to 2:1 contrast:

- **A bright hex is a fill, a mark or a chart series.** Anything that becomes text or a numeral
  reads the paired darker tier. `--pp-cyan` has no pair; text falls back to `--pp-teal-text`.
- **`--pp-indigo` means violet / corrected, never the hedge line.**

Chart-role tokens are carried even though this slice draws no chart, so the later chart work
reads them rather than re-hardcoding hexes as the prototype does.

Formatting is nl-NL throughout `[AS-19]`: comma decimal, period thousands, U+2212 for minus,
power in MW at exactly two decimals, prices at four.

### 8.3 Screens

| Portal | Screen | Requirements |
| --- | --- | --- |
| Customer | Onboarding wizard, ten steps | D3 |
| Customer | Sign in | D3 |
| Customer | Dashboard — shell and placeholder only | — |
| Customer | Connections list + detail + naming | `[F01-R29]`…`[F01-R38]` |
| Customer | Claim a connection from the pool | D3, `[F01-R54]` |
| Customer | Company profile + accounts, read-only | `[F01-R09]`, `[F01-R21]` |
| Employee | Customers list + detail | `[F01-R01]`…`[F01-R22]` |
| Employee | Metering points | `[F01-R23]`…`[F01-R27]` |
| Employee | Reference data — BRPs | `[F12-R49]` |

### 8.4 Navigation (D4)

The customer rail follows the design: grouped, each row carrying a small domain-coloured dot,
with `Consumption → Volume`, `Trading → Trades`, `Wallet → Balance`, and `Settlements` in place
of the wireframes' `Invoices`. **Internal route keys keep the specification's names** — the
demo already does exactly this, and `PAGE_LABELS` is the single mapping.

Nav items outside this slice render **disabled, each with the sentence that explains why**.
That is a design-system rule, and it reads better than hiding them: a rail that grows between
demos looks unfinished, whereas a rail that is complete and honest looks planned.

Desktop only. The prototype has no small-screen layout and none is intended — it is a desk
tool. Recorded as explicit scope, not an omission.

### 8.5 What not to carry across from the prototype

- **String-concatenated `innerHTML` guarded by a hand-rolled `esc()`.** Angular's default
  escaping replaces it; `bypassSecurityTrust*` is banned by `[security §6]`.
- **The deliberately reproduced back-office bug** emitting `style="...;color:"`, with a comment
  instructing not to fix it. That instruction is about fidelity to a mockup and must not cross
  into production.
- **Hardcoded headline figures** sitting beside real computed data. Every derived figure is
  computed from real inputs or rendered unavailable — never fabricated to look plausible.

---

## 9. Testing

| Layer | What | Tooling |
| --- | --- | --- |
| Domain unit | EAN format, KvK, IBAN mod-97, status transitions, invariants | xUnit + FluentAssertions |
| Application | Use cases against in-memory ports | xUnit + NSubstitute |
| Persistence | Real Postgres 17, real migrations, constraint behaviour | Testcontainers |
| **Tenancy** | **Route-table: sign in as A, 404 on every one of B's objects** | Testcontainers |
| Integration | Onboarding application → signed → company materialised, idempotent | Testcontainers |
| **Auth** | **Token bumped by `security_stamp` is rejected on the next call; refresh rotation is single-use; reset completion kills every outstanding token; reset request is 202 for a non-existent address** | Testcontainers |
| Architecture | Module graph, domain purity, no `IgnoreQueryFilters()`, no `DateTime.Now` | NetArchTest |
| API contract | OpenAPI snapshot | Verify |
| Frontend unit | Components, pipes, signal stores | Vitest |
| E2E smoke | Onboard → sign in → see connections | Playwright |

Test-driven throughout: the EAN validator, the exclusion constraint and the tenancy test are
written before the code they constrain.

The Playwright suite lives in `peakpower-web` per `[DEC-55]`, and this slice contributes one
path to it rather than a full suite.

---

## 10. Proposed specification changes

One pull request against `peakpowerspecs`, raised **alongside** the first week of code so the
record and the build do not diverge.

### New decisions

| Id | Decision | Reverses |
| --- | --- | --- |
| `[DEC-113]` | Customer companies may be created by **self-service onboarding**. The platform stores an Argon2id credential hash for the customer realm **and owns the password-reset path**. Customers may claim metering points from a shared EAN pool. | `[DEC-16]`, `[DEC-29]`, `[F01-R12]`, `[F01-R23]` |
| `[DEC-114]` | EAN validation is **18 digits only** for the proof of concept. The GS1 check digit is reinstated before go-live. | the check-digit half of `[F01-R24]` |
| `[DEC-115]` | The customer portal's navigation and labels follow the design system. Route keys keep the specification's names. | `screens-customer.mjs:7` |
| `[DEC-116]` | **GitHub Packages** is the destination for generated API clients **once a `peakpower` organisation exists**. Until then slice 1 uses committed npm **workspace packages** — the specification's own §5.1 fallback — keeping the name `@peakpower/api-client-*` so the migration costs a publish step and an `.npmrc` and changes no imports. A scripted staleness check replaces the registry's drift protection. | settles the unnumbered feed question in [solution structure §8](../../../specs/20-architecture/02-solution-structure.md) |
| `[DEC-117]` | Customer authentication is a **JWT** access/refresh pair, ES256 over JWKS, with a `security_stamp` claim checked per request so `[F01-R16]`'s immediate revocation holds against a stateless token. | new ground — `[DEC-20]` assumed no authentication at all |

### Corrections

| Document | Change |
| --- | --- |
| `20-architecture/04-database-design.md` | New §0 declaring `citext` and `btree_gist` as the first statements of migration 1 |
| `20-architecture/02-solution-structure.md` §4 | ⚠ **`AddNpmApp` no longer exists.** Verified from the package's own XML docs: `Aspire.Hosting.NodeJs` is frozen at 9.5.2, and `Aspire.Hosting.JavaScript` 13.5.3 exposes `AddJavaScriptApp(name, appDirectory, runScriptName)` with `.WithNpm()`. The snippet will not compile. Replace it, point `appDirectory` at the workspace root (there is only one `package.json`), gate the throw on an actual `--backend-only` check, and note that Aspire is a CLI + SDK, not a workload |
| `20-architecture/02-solution-structure.md` §6 | Pin **FluentAssertions 7.2.0**. 8.x ships an Xceed Community License for **non-commercial use only**; 7.2.0 is the last `Apache-2.0` release. The table names the library with no version because it was written while it was still open source |
| `20-architecture/07-security.md` §2 | Row-level security needs database **roles**, which the document never mentions. A superuser or table owner bypasses RLS silently, so the APIs must run as non-owner login roles or the mechanism is off while every test still passes |
| `20-architecture/02-solution-structure.md` §1.1 | Add the four implied infrastructure projects — `Time`, `Web`, `Identity`, `Email` — and reconcile `dev-up`'s location: §8.1 shows `tools/dev-up.*`, §11 shows `./dev-up` |
| `20-architecture/03-domain-model.md` | Rename `NotExpected` → `Never`; add `PendingApproval` to `AccountStatus`; add `Trade` to `FourEyesAction` |
| `10-features/F01…` §6 | Delete `metering_point_label`; the friendly name is `name` + `description` on `metering_point`. Delete the "labels" line from database design §1 |
| `20-architecture/05-api-contracts.md` | Rename `PATCH /metering-points/{id}/label` to `/naming`, following §5.4 — the route has no consumers yet, so this is free now and awkward later |
| `10-features/F01…` §5 | Regenerate `employee-customer-admin.svg` from current requirements — it predates `[DEC-71]` and still shows editable bank details with an Edit button, no admin flag, no four-eyes toggle |
| `10-features/F13…` | Harden business rule 2 into an architecture test: no type outside the context-provider assembly reads a customer identifier from `HttpContext` |
| `70-delivery/01-roadmap…` §2.1 | Reconcile "five of the six rows" (:256) against "four of the six" (:796) |
| `60-mockups/README.md` | Record that labels come from the design system and route keys from the specifications |

### New open questions

| Id | Question | Why it must have an owner |
| --- | --- | --- |
| `[OQ-97]` | When is the GS1 check digit reinstated, and which weighting is normative? | Both conventions disagree on five of the six demo EANs; the spec says "GS1 check digit" without pinning the algorithm |
| `[OQ-98]` | Credential **policy values** — sign-in delay curve, reset-token TTL, password composition beyond twelve characters | The mechanism is designed (§7) and no longer open; only the numbers are, and they belong to whoever owns security policy rather than to the delivery team |
| `[OQ-99]` | The six-product entitlement gate in the demo's rail | A commercial model that appears nowhere in the specification set |
| `[OQ-101]` | Assertion library — stay on FluentAssertions 7.x, or move to Shouldly 4.3.0? | 7.2.0 is free and works today, but it is the end of the Apache-2.0 line and will stop getting fixes. Moving later is a mechanical but wide change. Not a decision a plan should take on its own |
| `[OQ-102]` | Who owns the RLS login-role credentials? | Slice 1 is local-only, so migration 2 carries two literal passwords with a comment saying so. That is fine on one machine and unacceptable anywhere else, and the first deployment is when it bites |
| `[OQ-100]` | Which GitHub organisation owns `peakpower-platform` and `peakpower-web`? | **Not blocking.** `[DEC-116]` defers publishing until a `peakpower` organisation exists; slice 1 needs no remote at all. It matters only when CI is stood up, and it stays cheap while nothing outside `peakpower-web` consumes the packages. Creating the organisation is not in the delivery team's gift, so it wants a named owner even though nothing waits on it today |

### Not changed, deliberately

`[DEC-20]`'s instruction that tenancy be built and tested from the first commit is **honoured,
not superseded**, by D3. Real sign-in exercises the same pipeline more strongly than a dev
switcher would. The dev context provider is still built, because the identity slice needs it
when the credential moves to Entra.

---

## 11. Local development

### Prerequisites

```bash
dotnet tool install -g aspire.cli
```

Verified present on 2026-08-26: .NET SDK 10.0.400 (default), Node 24.15.0, npm 11.12.1,
Docker 29.7.2 with the daemon running.

**Slice 1 is local-only.** Both target repositories are empty and not yet git-initialised;
`git init` is step one and **no remote is added**. There is no CI, no package registry and no
deployment in this slice. Nothing in the design depends on a GitHub organisation existing, and
the two things that eventually will — publishing clients `[DEC-116]` and the `deploy/`
pipelines — are both out of scope. Pushing to remotes is a later, separate step whose only
prerequisite is `[OQ-100]`.

The corporate Entra tenant access request (§13) is the exception worth repeating: it is a
non-code item, it has the longest lead time in Phase 1, and running locally is precisely the
condition under which it gets forgotten.

### One command, from either repository

```bash
./dev-up
```

`dev-up` exists in both repositories and does the same thing in reverse: in
`peakpower-platform` it checks for the sibling checkout and runs the AppHost; in
`peakpower-web` it does the same and then starts the workspace. Whichever repository a
developer cloned first, one command works.

The web root resolves as `PEAKPOWER_WEB_PATH` first, sibling checkout second, loud failure
third — naming the path it looked in and the two ways to fix it. Your existing layout
(`~/PeakPower/peakpower-platform` beside `~/PeakPower/peakpower-web`) is already the default.

---

## 12. Sequencing

| # | Step | Depends on |
| --- | --- | --- |
| 1 | `git init` both repos, no remotes; solution and workspace skeletons; `Directory.*.props`; architecture tests | — |
| 2 | Migration 1 — extensions, schemas, tables, exclusion constraint, BRP seed | 1 |
| 3 | Domain: `Customer`, `CustomerAccount`, `MeteringPoint`, `Ean`, `KvkNumber`, `Iban` + tests | 1 |
| 4 | Tenancy: `ICustomerContext`, query filters, RLS, 404-not-403, **the route-table test** | 2, 3 |
| 5 | Employee API + OpenAPI + contract snapshot | 3, 4 |
| 6 | AppHost, Migrator, ServiceDefaults, `dev-up` both sides | 2, 5 |
| 7 | `libs/shared-ui` — tokens + the nine primitives | — (parallel from step 1) |
| 8 | Employee portal — customers, accounts, metering points, BRPs | 5, 6, 7 |
| 9 | Onboarding: application aggregate, signing code, materialisation | 3, 4 |
| 10 | Customer API — auth, company, metering points, EAN pool | 4, 9 |
| 11 | Customer portal — wizard, sign-in, Connections, profile | 7, 10 |
| 12 | Seed data, E2E smoke, spec pull request | all |

Steps 7 and 1–6 run in parallel; the design-system port needs no backend.

**Rough size:** 6–8 weeks. Slice A alone is 3–4; the onboarding path adds ~3, with overlap
because both write the same tables.

---

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| The Aspire 13 API differs from the spec's 9.x-era snippet | Check `AddNpmApp` and `WaitForCompletion` against 13.5.3 in step 6; the spec amendment records what changed |
| A stateless JWT cannot satisfy `[F01-R16]`'s *immediate* session revocation | The `security_stamp` check (§7) rides on the transaction RLS already opens, so revocation stays immediate at no measurable cost |
| Committed clients rot silently, and the two repositories drift — the exact failure `[DEC-55]` warns about | The `verify:clients` staleness check runs in `dev-up` and before commit, and becomes a required CI check the day CI exists. Without it, committing the client is strictly worse than a registry |
| The organisation is eventually named something other than `peakpower`, so imports must change | One bounded find-and-replace across `peakpower-web`, while nothing external consumes the packages. Keeping the specification's name is the bet that costs nothing if it wins |
| The relaxed EAN rule outlives the PoC | `[OQ-97]` registered with an owner and a date; the seed script carries the reason inline |
| The component library `[OQ-49]` is chosen later and conflicts with nine hand-built primitives | Nine primitives against a fully specified token set is a small surface to own; spike `[OQ-49]` alongside `[OQ-22]` during this slice, decide before the chart slice |
| Corporate Entra tenant access is unowned, and running with our own credential removes the pressure to chase it | Name an owner and raise the request in week 1 as a non-code definition-of-done item. `[DEC-67]` forbids proving the claim mapping against a developer tenant, so there is no substitute and the lead time is real |
| The generated client lags the API across the repository boundary | Semver enforced on the OpenAPI diff; nightly build of `peakpower-web` against the latest published client; the E2E smoke as backstop |

---

## 14. Definition of done

1. `./dev-up` from either repository brings up Postgres, migrations, two APIs and two portals.
2. A prospect completes the wizard in the browser and lands in the customer portal.
3. That customer sees their connections, renames one, and claims one from the pool.
4. An employee sees the same company in the back office and edits it.
5. **The route-table test passes**: signed in as company A, every one of company B's objects
   returns 404.
6. The architecture tests pass: domain purity, module graph, no `IgnoreQueryFilters()`.
7. Deactivating an account invalidates its token on the **next** call, not in fifteen
   minutes — `[F01-R16]` satisfied against a stateless token.
8. A customer resets a forgotten password by email and signs in with the new one.
9. Migration 1 applies to an empty PostgreSQL 17 container, and the exclusion constraint
   rejects an overlapping EAN period.
10. `npm run verify:clients` passes — the committed clients match what the current OpenAPI
    documents generate.
11. The specification pull request is open, covering §10.
