# Employee Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Angular back-office application for PeakPower employees — customers,
accounts, metering points and BRP reference data — on top of a typed API client generated from
the employee OpenAPI document and committed to the repository, with a staleness check that stops
the client rotting.

**Architecture:** `libs/api-client-employee` is an npm workspace package named
`@peakpower-nl/api-client-employee`. Its `src/generated/` directory holds TypeScript types emitted
from `peakpower-platform/artifacts/openapi/employee.json` by a pinned generator; those files are
committed and `npm run verify:clients` regenerates them into a temporary directory and fails if
a single byte differs. Its `src/lib/` directory holds a small hand-written Angular transport
layer (`EmployeeApiClient`) built on Angular's own `HttpClient`, so requests flow through Angular
DI, interceptors and `HttpTestingController` while every request and response shape is derived
from the contract rather than retyped. `apps/employee-portal` is a standalone-component,
zoneless, signal-driven Angular 22 application that renders the design system's `pp-*` primitives
from `@peakpower-nl/shared-ui`.

**Tech Stack:** Angular 22.1.3 (`@angular/cli` / `@angular/build` 22.1.6) · TypeScript 6.0.3 ·
Node 24.15.0 / npm 11.12.1 · Vitest 4.1.11 through the `@angular/build:unit-test` builder ·
jsdom 30.0.1 · `openapi-typescript` 7.13.0 (pinned generator) · rxjs 7.8.2 · `node --test` (Node
built-in runner) for the two build scripts.

**Spec:** `docs/superpowers/specs/2026-08-26-poc-slice-1-design.md`
**Shared contract:** `docs/superpowers/plans/2026-08-26-slice-1-shared-contract.md`

---

## Global Constraints

Every task implicitly includes this section.

### Versions — exact, verified 2026-08-26 (from the shared contract §1)

| | |
| --- | --- |
| .NET SDK | **10.0.400** (installed, default) |
| EF Core | **10.x** |
| PostgreSQL | **17** (Testcontainers + Aspire) |
| Aspire | **13.5.3** — `aspire.cli` global tool + `Aspire.AppHost.Sdk`. **NOT a `dotnet workload`.** |
| Angular | **22** (`@angular/cli` 22.1.6) |
| Node / npm | **24.15.0 / 11.12.1** |
| Docker | 29.7.2, daemon must be running |

Exact npm versions this plan pins (all `@angular/*` runtime packages are 22.1.3, all
`@angular/*` build packages are 22.1.6):

```
@angular/common 22.1.3 · @angular/compiler 22.1.3 · @angular/core 22.1.3
@angular/forms 22.1.3 · @angular/platform-browser 22.1.3 · @angular/router 22.1.3
@angular/build 22.1.6 · @angular/cli 22.1.6 · @angular/compiler-cli 22.1.3
typescript 6.0.3 (Angular 22 peer range is >=6.0 <6.1 — do NOT install TypeScript 7)
rxjs 7.8.2 · tslib 2.8.1 · vitest 4.1.11 · jsdom 30.0.1 · openapi-typescript 7.13.0
```

### Repositories (shared contract §2)

```
/Users/thinhhuynh/PeakPower/peakpower-platform      # .NET   — siblings, and the
/Users/thinhhuynh/PeakPower/peakpower-web           # Angular — AppHost relies on it
```

`git init` in both. **No remotes, no CI, no package registry, no deployment** in slice 1.
Commit locally and often. Every path in this plan that is not absolute is relative to
`/Users/thinhhuynh/PeakPower/peakpower-web`, and every `git` and `npm` command in this plan is
run from that directory.

### Naming (shared contract §3)

- .NET namespace root `PeakPower.` — e.g. `PeakPower.Domain.Customers`
- npm scope `@peakpower-nl/` — matches the GitHub organisation, which now exists `[OQ-100]` **resolved**
- Database: snake_case, singular, schema-qualified — `customer.metering_point`
- C#: PascalCase; EF Core maps to snake_case via a naming convention, not per-property attributes

### Enums — the database spelling is normative (shared contract §4)

The specification defines three of these twice, differently. These are the values to use.

```csharp
public enum CustomerStatus { Prospect, Active, Suspended, Closed }
// db: PROSPECT | ACTIVE | SUSPENDED | CLOSED

public enum AccountStatus { PendingApproval, Invited, Active, Deactivated }
// db: PENDING_APPROVAL | INVITED | ACTIVE | DEACTIVATED
// NOTE: the domain model doc omits PendingApproval. It is wrong; include it.

public enum ProductionExpectation { Unknown, Never, Expected }
// db: UNKNOWN | NEVER | EXPECTED
// NOTE: the domain model doc calls the middle value NotExpected. It is wrong; use Never.

public enum ProductionExpectationSource
{ Contract, GridOperator, Observed, Manual, CustomerDeclared }
// db: CONTRACT | GRID_OPERATOR | OBSERVED | MANUAL | CUSTOMER_DECLARED

public enum Commodity { Electricity }
// db: ELECTRICITY. The discriminator stays; GAS is not a selectable value.

public enum BankAccountStatus { PendingApproval, Active, Deactivated }

public enum FourEyesAction
{ AddBankAccount, DeactivateBankAccount, AddUser, Trade, Withdrawal }
// db: ADD_BANK_ACCOUNT | DEACTIVATE_BANK_ACCOUNT | ADD_USER | TRADE | WITHDRAWAL
// NOTE: the domain model doc has four arms. It is wrong; there are five.
```

**On the wire the spelling is SCREAMING_SNAKE** — `"ACTIVE"`, `"PENDING_APPROVAL"`,
`"CUSTOMER_DECLARED"`. Shared contract §5.2 settles this for both APIs: they register one shared
`JsonStringEnumConverter` that maps each enum to its database spelling, no mapper calls
`.ToString()` on an enum, and no client hard-codes PascalCase. The generated types confirm it:
after Task 1 you can read the exact string unions out of
`libs/api-client-employee/src/generated/employee-schema.d.ts`, and Task 1 Step 6 asserts the
spelling rather than trusting it.

### HTTP (shared contract §8)

- Base path `/api/v1`; errors are RFC 7807 `application/problem+json`
- Cross-tenant reads return **404, never 403** `[F13-R19]`
- Access token in `Authorization: Bearer`; refresh token in an HttpOnly, `Secure`,
  `SameSite=Strict` cookie named `pp_refresh`, path-scoped to `/api/v1/auth/refresh`
- The customer access token is held **in memory only** in the browser — never `localStorage`

**The employee API is not tenant-scoped.** There is no company switcher in this application, no
`customer_id` claim, and no `ICustomerContext`. `IEmployeeContext` is the seam on the server side
and this plan never touches it. Slice 1 ships the employee portal without a sign-in screen —
`IEmployeeContext` is satisfied by Plan 2's development provider.

### Angular workspace layout (shared contract §10)

```
peakpower-web/
├── package.json                        # ONE workspace at the root
├── apps/customer-portal/               # start:customer-portal
├── apps/employee-portal/               # start:employee-portal
├── libs/shared-ui/                     # @peakpower-nl/shared-ui
├── libs/api-client-customer/           # @peakpower-nl/api-client-customer  (generated, committed)
└── libs/api-client-employee/           # @peakpower-nl/api-client-employee  (generated, committed)
```

Standalone components throughout · signals for state · lazy-loaded feature routes ·
strictly typed reactive forms · **no** `NgModule`.

Component selectors are prefixed `pp-`: `pp-card`, `pp-stat-card`, `pp-badge`, `pp-button`,
`pp-banner`, `pp-ds-banner`, `pp-grid-table`, `pp-search-input`, `pp-app-shell`.

This plan adds one convention the contract does not forbid: every component **class** this plan
writes is a page or a fragment inside `apps/employee-portal` and therefore carries the selector
prefix `pp-` too (e.g. `pp-customer-list-page`), because `angular.json` sets `"prefix": "pp"` for
the project and the Angular linting default would otherwise complain.

### Design tokens — SB-2026 (shared contract §11)

Source of truth is the **PeakPower Trading Design System** project in Claude Design
(`tokens/*.css`, 13 primitives each with a `.d.ts`). Port those files; do not re-derive values
from the prototype HTML. Two rules that must survive the port:

1. **A bright hex is a fill, a mark or a chart series.** Anything that becomes text or a
   numeral reads the paired darker tier. `--pp-cyan` (`#00D4C6`) has **no** pair — text falls
   back to `--pp-teal-text`.
2. **`--pp-indigo` means violet / corrected, never the hedge line.**

Key metrics: sidebar 236px · topbar 64px · card `18px 20px` · stat card `14px 16px`
(no `flex:1`, 3px `::before` accent cap) · badge 11px/600 `4px 12px` pill, 1px border on every
tone · button 13px/600 `10px 20px`, `border:1px solid` on **every** variant · page gap 16px
(20px on Dashboard only) · radii 6/8/12/pill.

Plan 3 owns all of that. This plan consumes it and adds exactly one layout rule of its own,
which the design system specifies for detail screens: **detail screens are a two-column grid,
`grid-template-columns: 1.6fr 1fr`, `gap: 16px`.**

### Copy rules (shared contract §12)

Sentence case everywhere. ALL CAPS only for stat-card labels and table column heads.
**No emoji, no icon set** — the only glyphs are the brand mark, one magnifier, `▲▼`, `→›`.
Every number carries its provenance in a faint sublabel. **"Projected"** = not yet measured;
**"Provisional"** = not yet accepted — never swap them. Empty and disabled states name the
reason. nl-NL numbers: `€ 19.722,00`, `385,4 MWh`, minus is U+2212 `−`.

The employee portal renders no energy figures, so it formats numbers and dates with Angular's
built-in `DecimalPipe` and `DatePipe` under `LOCALE_ID: 'nl-NL'`. Plan 3's `ppNumber` pipe (which
exists to force U+2212 and MW-at-two-decimals) belongs to the customer portal; this plan does not
depend on it.

### Testing (shared contract §13)

| Layer | Tooling |
| --- | --- |
| Domain / Application unit | xUnit + **Shouldly 4.3.0**|
| Persistence & integration | Testcontainers, real PostgreSQL 17 |
| Architecture | NetArchTest 1.3.2 and Mono.Cecil 0.11.6 |
| OpenAPI contract | Verify snapshot |
| Frontend unit | Vitest |
| E2E | Playwright, in `peakpower-web` |

> ⚠ **Assert with Shouldly, never FluentAssertions** `[DEC-118]`. FluentAssertions 8.x ships an
> Xceed Community License "for Non-Commercial Use" and PeakPower is commercial; 7.2.0 is the
> last Apache-2.0 release and the end of that line. Shouldly 4.3.0 is Apache-2.0 and maintained.
> `verify-build-settings.sh` fails the build if FluentAssertions reappears.

**The six architecture facts, with the tool that enforces each and the plan that owns it**
(shared contract §13). Facts 3-6 are about *call sites*, which NetArchTest's type-level model
cannot see, so they are Mono.Cecil IL scans:

| # | Fact | Tool | Owned by |
| --- | --- | --- | --- |
| 1 | `PeakPower.Domain` references no other project | NetArchTest | Plan 1 |
| 2 | `PeakPower.Application` references only `PeakPower.Domain` | NetArchTest | Plan 1 |
| 3 | `PeakPower.Ingestion` (when it exists) references no `Brp.*` adapter | Cecil | Plan 1 |
| 4 | No type calls `IgnoreQueryFilters()` | Cecil | Plan 2 |
| 5 | No type outside `PeakPower.Infrastructure.Time` calls `DateTime.Now`, `DateTime.UtcNow`, `DateTime.Today`, `DateTimeOffset.Now` or `DateTimeOffset.UtcNow` | Cecil | Plan 1 |
| 6 | No type outside `PeakPower.Infrastructure.Web` uses `IHttpContextAccessor` or reads a claim off `ClaimsPrincipal` / `ClaimsIdentity` | Cecil | Plan 2 |

They are listed here because they constrain what Plan 2 may expose, which in turn constrains what
this plan may consume. Nothing in this plan runs them.

Two runners are used in this repository and they are not interchangeable:

- **Vitest through `@angular/build:unit-test`** for everything under `apps/` and `libs/`.
  Run it with `npm run test:employee-portal`. Never invoke `vitest` directly — the builder
  compiles the Angular templates first and hands Vitest the compiled output.
- **`node --test`** for the two build scripts under `tools/`, which are plain ESM modules with
  no Angular in them. Run it with `npm run test:workspace`.

### Preconditions before Task 1

1. `peakpower-platform` has been built by Plan 2 and
   `/Users/thinhhuynh/PeakPower/peakpower-platform/artifacts/openapi/employee.json` exists.
   Check it: `test -f ../peakpower-platform/artifacts/openapi/employee.json && echo present`
2. `peakpower-web` exists, is a git repository, and contains Plan 3's `package.json`,
   `angular.json`, `tsconfig.json` and `libs/shared-ui`. Check it:
   `ls package.json angular.json tsconfig.json libs/shared-ui/src/public-api.ts`

If (1) fails, Plan 2 is not finished and this plan cannot start. If (2) fails, Plan 3 is not
finished and this plan cannot start.

### What this plan consumes from Plan 3 (`@peakpower-nl/shared-ui`)

Plan 3 owns these; this plan only imports them. **Shared contract §10.1 is the normative
declaration** — it is reproduced verbatim below so that the templates in this plan can be read
without a second file open. If a binding here disagrees with §10.1, §10.1 wins.

```ts
// libs/shared-ui/src/public-api.ts   ← this filename. NOT index.ts.

export type PpTone =
  | 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'critical';
// 'positive' and 'danger' are NOT tone values — they are spelled 'success' and 'critical'.
// Neither spelling may appear anywhere in this plan's templates or specs.

export interface PpNavItem {
  routeKey: string;          // the specification's key, never the label
  label: string;             // the design system's label
  path: string | null;       // null when the item is disabled
  dot: string;               // the domain colour, a CSS custom-property reference
  disabledReason?: string;   // rendered verbatim; a disabled item MUST carry one
}
export interface PpNavSection { label: string; items: PpNavItem[]; }

// selector: 'pp-app-shell'
export class PpAppShell {
  readonly sections = input.required<PpNavSection[]>();     // the grouped rail
  readonly activeRouteKey = input.required<string>();
  readonly productName = input.required<string>();
  readonly crumb = input<string>();
  readonly subtitle = input<string>();                      // a crumb OR a subtitle, never both
}

// selector: 'pp-card'
export class PpCard {
  readonly heading = input<string>();      // heading, NOT title
  readonly subtitle = input<string>();
}

// selector: 'pp-badge'
export class PpBadge { readonly tone = input<PpTone>('neutral'); }

// selector: 'pp-button'
export class PpButton {
  readonly variant = input<'primary'|'secondary'|'ghost'|'danger'|'accept'>('secondary');
  readonly size = input<'md' | 'sm'>('md');
  readonly disabled = input(false);
}

// selector: 'pp-banner'  — the compact in-page notice
export class PpBanner {
  readonly tone = input<PpTone>('info');
  readonly heading = input<string>();
}

// selector: 'pp-grid-table'  — display:grid divs, never <table>
export class PpGridTable {
  readonly columns = input.required<string>();   // the verbatim grid-template-columns string
  readonly density = input<'default' | 'dense'>('default');
  // Head and rows are CONTENT-PROJECTED. There is no rows input.
}
// selector: '[ppGridHead]'   — one row of ALL-CAPS column heads
export class PpGridHead {}
// selector: '[ppGridRow]'    — one data row
export class PpGridRow {}

// selector: 'pp-search-input'
export class PpSearchInput {
  readonly placeholder = input('Search');
  readonly value = model<string>('');
}
```

**§10.1 gives `PpButton` no `type` input**, so no template in this plan binds one. Every form
here keeps `(ngSubmit)` on its `<form>` — which is what makes Enter in a text input submit — and
its primary button calls the component's `submit()` method directly with `(click)`. Nothing is
lost: the specs already drive submission through `fixture.componentInstance.submit()`.

Navigation is by `routerLink` on each item's `path`; `PpAppShell` has **no `navigate` output**.
`PpAppShell.activeRouteKey` and `PpAppShell.productName` are both **required**, so every
`<pp-app-shell>` in this plan binds them.

Plan 3's rule that **`pp-grid-table` is never rendered with zero rows** is enforced by every
screen in this plan: each table is wrapped in `@if (rows().length > 0) { … } @else { … }` and the
empty branch is a `pp-card` whose text names the reason.

Plan 3's token stylesheet is at `libs/shared-ui/src/styles/tokens.css`. One further token this
plan uses, `--pp-canvas` — the page ground — is defined by Plan 3 in
`libs/shared-ui/src/styles/colors.css` (shared contract §10.1).

### What this plan consumes from Plan 2 (the employee API)

Plan 2 owns the endpoints and the DTOs. This plan reads them through generated types, so the
*shapes* are not restated by hand anywhere in the source — but the *names* have to match, and
they are assumed here and repeated in **New names introduced**.

Endpoints, all under `/api/v1` (design §7):

```
GET    /customers?q=                            POST   /customers
GET    /customers/{id}                          PATCH  /customers/{id}
POST   /customers/{customerId}/accounts         PATCH  /accounts/{id}
POST   /accounts/{id}/deactivate
POST   /customers/{customerId}/metering-points  PATCH  /metering-points/{id}
POST   /metering-points/{id}/end-date
GET    /reference-data/brps
```

The two nested POSTs name their parameter **`{customerId}`**, not `{id}`: on a nested route `{id}`
reads as the child's identifier and would collide in the generated client. Plan 2's route table
uses the same spelling.

Schema names in `employee.json` (the keys under `components.schemas`):

```
CustomerListResponse   { items: CustomerListItemDto[]; total: number }
CustomerListItemDto    { id, legalName, tradeName, kvkNumber, status, city,
                         accountCount, meteringPointCount }
CustomerDetailDto      { id, legalName, tradeName, kvkNumber, vatNumber, status,
                         fourEyesEnabled, billingAddress, visitingAddress, primaryContact,
                         internalReference, locale,
                         accounts: AccountDto[], meteringPoints: MeteringPointDto[] }
AccountDto             { id, customerId, username, firstName, lastName, jobTitle,
                         email, phone, status, isAdmin, lastLoginAt }
MeteringPointDto       { id, customerId, ean, eanDisplay, commodity, brpId, brpName,
                         productionExpectation, expectationSource, name, description,
                         gridOperator, capacityKw, address, validFrom, validTo, displayLabel }
BrpDto                 { id, code, name, isActive }
AddressDto             { street, houseNumber, houseNumberSuffix, postalCode, city, country }
ContactPersonDto       { name, email, phone }
CreateCustomerRequest  { legalName, tradeName?, kvkNumber, vatNumber?,
                         internalReference?, locale, billingAddress, visitingAddress?,
                         primaryContact }
UpdateCustomerRequest  { legalName, tradeName?, vatNumber?, internalReference?, locale,
                         billingAddress, visitingAddress?, primaryContact, status }
                       — NOT the same shape: no kvkNumber (a KvK number is immutable once
                         registered), plus status
CreateAccountRequest   { username, firstName, lastName, jobTitle?, email, phone?, isAdmin }
UpdateAccountRequest   { firstName, lastName, jobTitle?, email, phone?, isAdmin }
AttachMeteringPointRequest { ean, brpId, productionExpectation, expectationSource?, name?,
                             description?, gridOperator?, capacityKw?, address?, validFrom }
UpdateMeteringPointRequest { brpId, productionExpectation, expectationSource?, name?,
                             description?, gridOperator?, capacityKw?, address? }
EndDateMeteringPointRequest { validTo }
```

> **There is no bank account on this screen.** Shared contract §5 gives `Customer` no IBAN and
> migration 1 has no bank-account table: bank details are collected once, during onboarding, and
> belong to Plan 5's `SaveOnboardingStepRequest.Iban`. The employee create and edit forms in
> Task 9 therefore carry no IBAN control and send none.

---

## File Structure

Every path is relative to `/Users/thinhhuynh/PeakPower/peakpower-web`.

### Workspace plumbing

| File | Responsibility |
| --- | --- |
| `package.json` | *(modify, key-level)* Plan 3's one workspace manifest gains three keys: the `generate:clients` and `verify:clients` scripts and the `openapi-typescript` devDependency |
| `angular.json` | *(modify, key-level)* Plan 3's `employee-portal` project gains `serve.options` (port + proxy) and `test.options` (runner + include globs) |
| `tsconfig.json` | *(modify)* adds the `@peakpower-nl/api-client-employee` path mapping |
| `tools/openapi-clients.mjs` | the client registry and the three pure functions the two scripts share: `generateTypes`, `checkClient`, `firstDifferenceLine` |
| `tools/generate-clients.mjs` | writes the generated types to their committed locations |
| `tools/verify-clients.mjs` | the staleness check — regenerates to a temp dir and fails on any difference |
| `tools/__fixtures__/tiny-openapi.json` | a three-line OpenAPI document so the tool tests never depend on the platform build |
| `tools/openapi-clients.test.mjs` | `node --test` coverage for generation |
| `tools/verify-clients.test.mjs` | `node --test` coverage for the staleness check |

### `libs/api-client-employee` — `@peakpower-nl/api-client-employee`

| File | Responsibility |
| --- | --- |
| `package.json` | the workspace package manifest; its `name` is what `import` statements resolve |
| `src/generated/employee-schema.d.ts` | **machine-owned.** Types emitted from `employee.json`. Committed, and diffed byte-for-byte by `verify:clients` |
| `src/lib/employee-api.tokens.ts` | `EMPLOYEE_API_BASE_URL` injection token |
| `src/lib/employee-api.types.ts` | readable aliases over `components['schemas'][…]` — the only file that knows the generated shape |
| `src/lib/employee-api.client.ts` | `EmployeeApiClient` — URL builders plus one method per endpoint |
| `src/lib/problem-details.ts` | the RFC 7807 shape and `isValidationProblem()` |
| `src/lib/employee-api.testing.ts` | `provideEmployeeApiTesting()` — the HttpClient/httpResource test harness |
| `src/index.ts` | the public barrel |

### `apps/employee-portal`

| File | Responsibility |
| --- | --- |
| `src/index.html` | *(modify)* the document shell Plan 3 scaffolded |
| `src/main.ts` | *(modify)* bootstrap |
| `src/styles.css` | *(modify)* sets the page canvas from Plan 3's tokens, which `angular.json` loads ahead of it |
| `proxy.conf.mjs` | dev-server proxy from `/api` to the employee API, resolved from Aspire's env |
| `tsconfig.app.json` / `tsconfig.spec.json` | compiler configuration for build and test |
| `src/app/app.ts` | the root component — `pp-app-shell` plus `router-outlet` |
| `src/app/app.config.ts` | providers: zoneless CD, router, HttpClient, `LOCALE_ID`, base URL |
| `src/app/app.routes.ts` | top-level routes; feature routes are lazy |
| `src/app/shell/employee-nav.ts` | `EMPLOYEE_NAV` — one `PpNavSection` over the eight back-office items, five disabled with their reasons, plus `routeKeyForUrl` and `crumbForUrl` |
| `src/app/shared/labels.ts` | wire-value → sentence-case label and `PpTone` for every enum |
| `src/app/shared/apply-problem-details.ts` | RFC 7807 `errors` → reactive-form control errors |
| `src/app/shared/form-field.ts` | `PpFormField` — label, control slot, and the server error message |
| `src/app/features/home/home-page.ts` | the landing page: what this slice contains |
| `src/app/features/customers/customers.routes.ts` | the customers feature's lazy route table |
| `src/app/features/customers/customer-list-page.ts` | list + search + status badges |
| `src/app/features/customers/customer-detail-page.ts` | 1.6fr/1fr detail: accounts, metering points, company panel |
| `src/app/features/customers/customer-form-page.ts` | create and edit a customer |
| `src/app/features/customers/account-form-page.ts` | create and edit an account |
| `src/app/features/customers/metering-point-form-page.ts` | attach, edit and end-date a metering point |
| `src/app/features/reference-data/reference-data.routes.ts` | the reference-data feature's lazy route table |
| `src/app/features/reference-data/brp-list-page.ts` | the BRP list |

Each of those page files carries its own `*.spec.ts` beside it.

---

## Task 1: The generated employee client

The employee API's OpenAPI document is emitted by the .NET build into
`peakpower-platform/artifacts/openapi/employee.json`. Slice 1 has no npm registry, so the
TypeScript derived from it is **committed** into this repository as a workspace package. This
task builds the generator; Task 2 builds the check that stops the committed copy rotting.

Two things a reader new to this repository needs to know. First, **npm workspaces resolve a
dependency by the `name` field in its `package.json`, not by registry scope** — so
`import { … } from '@peakpower-nl/api-client-employee'` works today with no registry and keeps
working unchanged the day the package is published. Second, the generator emits **types only**
(`openapi-typescript` produces a `.d.ts` with zero runtime code). The transport is hand-written
on Angular's `HttpClient` in Task 3, which is what lets requests go through Angular DI,
interceptors and `HttpTestingController`. `src/generated/` is machine-owned; `src/lib/` is
hand-owned; `verify:clients` only ever looks at `src/generated/`.

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `tools/openapi-clients.mjs`
- Create: `tools/generate-clients.mjs`
- Create: `tools/__fixtures__/tiny-openapi.json`
- Create: `libs/api-client-employee/package.json`
- Create: `libs/api-client-employee/src/generated/employee-schema.d.ts` *(generated)*
- Test: `tools/openapi-clients.test.mjs`

**Interfaces:**
- Consumes: `/Users/thinhhuynh/PeakPower/peakpower-platform/artifacts/openapi/employee.json`,
  emitted by Plan 2. Consumes Plan 3's existing `package.json` and `tsconfig.json`.
- Produces:
  - `export const BANNER: string`
  - `export const WEB_ROOT: string`
  - `export function resolvePlatformRoot(env?: NodeJS.ProcessEnv): string`
  - `export const CLIENTS: readonly { name: string; document: string; output: string }[]`
  - `export async function generateTypes(documentPath: string): Promise<string>`
  - `export async function writeClient(client): Promise<string>`
  - npm scripts `generate:clients` and `verify:clients`
  - the committed file `libs/api-client-employee/src/generated/employee-schema.d.ts`

- [ ] **Step 1: Add the workspace plumbing and install**

**Plan 3 owns the root `package.json`.** It already declares the workspace globs, `"type":
"module"`, every `@angular/*` and `typescript` pin, `start:employee-portal`,
`build:employee-portal`, `test:employee-portal` and `test:workspace`. Do **not** paste a
competing manifest over it and do not restate a key it already sets — in particular, leave
`start:employee-portal` exactly as Plan 3 wrote it (`ng serve employee-portal --port ${PORT:-4201}`),
because shared contract §10's AppHost call is `.WithHttpEndpoint(env: "PORT")` and dropping
`--port ${PORT:-4201}` takes the port away from Aspire.

Make these three key-level edits and nothing else:

1. `scripts["generate:clients"] = "node tools/generate-clients.mjs"` — new key.
2. `scripts["verify:clients"] = "node tools/verify-clients.mjs"` — new key.
3. `devDependencies["openapi-typescript"] = "7.13.0"` — new key.

The tool tests run under Plan 3's existing `test:workspace` (`node --test tools/*.test.mjs`),
which already picks up `tools/openapi-clients.test.mjs` and `tools/verify-clients.test.mjs`; this
plan adds no second script for the same job.

Check the result before moving on:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
node -e "const p=require('./package.json');
  for (const k of ['generate:clients','verify:clients','test:workspace','start:employee-portal'])
    console.log(k, '=', p.scripts[k]);
  console.log('openapi-typescript =', p.devDependencies['openapi-typescript']);"
```

Expected: all five print a value, and `start:employee-portal` still contains `--port`.

Create the workspace package manifest:

```json
{
  "name": "@peakpower-nl/api-client-employee",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

Add one key to `compilerOptions.paths` in the workspace `tsconfig.json` — Plan 3 created that
file and its `@peakpower-nl/shared-ui` entry, which points at `public-api.ts` and must be left
alone. The result reads:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@peakpower-nl/shared-ui": ["libs/shared-ui/src/public-api.ts"],
      "@peakpower-nl/api-client-employee": ["libs/api-client-employee/src/index.ts"]
    }
  }
}
```

The workspace entry and the path mapping do different jobs and you need both: npm links
`node_modules/@peakpower-nl/api-client-employee` so tooling can find the package by name, while the
TypeScript path mapping is what makes the Angular compiler build the library from source rather
than looking for a `dist`.

Then install:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npm install
```

- [ ] **Step 2: Write the failing test**

Create `tools/__fixtures__/tiny-openapi.json`:

```json
{
  "openapi": "3.0.1",
  "info": { "title": "Fixture", "version": "1.0" },
  "paths": {
    "/customers": {
      "get": {
        "operationId": "listCustomers",
        "responses": {
          "200": {
            "description": "OK",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/CustomerListItemDto" }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "CustomerListItemDto": {
        "type": "object",
        "properties": {
          "id": { "type": "string", "format": "uuid" },
          "legalName": { "type": "string" },
          "status": { "type": "string", "enum": ["PROSPECT", "ACTIVE", "SUSPENDED", "CLOSED"] }
        },
        "required": ["id", "legalName", "status"]
      }
    }
  }
}
```

Create `tools/openapi-clients.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BANNER,
  CLIENTS,
  generateTypes,
  resolvePlatformRoot,
  WEB_ROOT,
} from './openapi-clients.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, '__fixtures__/tiny-openapi.json');

describe('generateTypes', () => {
  it('emits the schema names from the document', async () => {
    const source = await generateTypes(FIXTURE);
    assert.match(source, /CustomerListItemDto/);
  });

  it('emits the enum members as a string union', async () => {
    const source = await generateTypes(FIXTURE);
    assert.match(source, /"PENDING"|"PROSPECT"/);
  });

  it('starts with the do-not-edit banner', async () => {
    const source = await generateTypes(FIXTURE);
    assert.ok(source.startsWith(BANNER), 'generated source must start with BANNER');
  });

  it('is byte-for-byte stable across two runs', async () => {
    const first = await generateTypes(FIXTURE);
    const second = await generateTypes(FIXTURE);
    assert.equal(first, second);
  });
});

describe('resolvePlatformRoot', () => {
  it('prefers PEAKPOWER_PLATFORM_PATH when it is set', () => {
    assert.equal(resolvePlatformRoot({ PEAKPOWER_PLATFORM_PATH: '/somewhere/else' }),
      '/somewhere/else');
  });

  it('falls back to the sibling checkout', () => {
    assert.equal(resolvePlatformRoot({}), resolve(WEB_ROOT, '..', 'peakpower-platform'));
  });
});

describe('CLIENTS', () => {
  it('registers the employee client with its committed output path', () => {
    const employee = CLIENTS.find((c) => c.name === '@peakpower-nl/api-client-employee');
    assert.ok(employee, 'employee client must be registered');
    assert.equal(employee.output,
      resolve(WEB_ROOT, 'libs/api-client-employee/src/generated/employee-schema.d.ts'));
    assert.match(employee.document, /artifacts\/openapi\/employee\.json$/);
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:workspace`
Expected: FAIL with `Cannot find module '.../tools/openapi-clients.mjs'`

- [ ] **Step 4: Write the minimal implementation**

Create `tools/openapi-clients.mjs`:

```js
// Shared registry and helpers for the committed OpenAPI clients.
//
// Slice 1 has no npm registry [DEC-116]. The TypeScript derived from the platform's OpenAPI
// documents is committed into this repository instead, and `npm run verify:clients` is what
// replaces the registry's drift protection. Without that check, committed clients rot silently
// and the two repositories drift — the exact failure [DEC-55] warns about.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import openapiTS, { astToString } from 'openapi-typescript';

export const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const BANNER = [
  '// AUTO-GENERATED by tools/generate-clients.mjs. Do not edit by hand.',
  '// Source: peakpower-platform/artifacts/openapi/<document>.json',
  '// `npm run verify:clients` fails the build on any drift between this file and the document.',
  '',
  '',
].join('\n');

export function resolvePlatformRoot(env = process.env) {
  return env.PEAKPOWER_PLATFORM_PATH
    ? resolve(env.PEAKPOWER_PLATFORM_PATH)
    : resolve(WEB_ROOT, '..', 'peakpower-platform');
}

const PLATFORM_ROOT = resolvePlatformRoot();

export const CLIENTS = Object.freeze([
  Object.freeze({
    name: '@peakpower-nl/api-client-employee',
    document: resolve(PLATFORM_ROOT, 'artifacts/openapi/employee.json'),
    output: resolve(WEB_ROOT, 'libs/api-client-employee/src/generated/employee-schema.d.ts'),
  }),
]);

export async function generateTypes(documentPath) {
  if (!existsSync(documentPath)) {
    throw new Error(
      `OpenAPI document not found: ${documentPath}\n` +
        'Build peakpower-platform first, or set PEAKPOWER_PLATFORM_PATH to its checkout.',
    );
  }
  const ast = await openapiTS(pathToFileURL(documentPath));
  return BANNER + astToString(ast);
}

export async function writeClient(client) {
  const source = await generateTypes(client.document);
  await mkdir(dirname(client.output), { recursive: true });
  await writeFile(client.output, source, 'utf8');
  return source;
}

export async function readCommitted(client) {
  if (!existsSync(client.output)) return null;
  return readFile(client.output, 'utf8');
}
```

Create `tools/generate-clients.mjs`:

```js
#!/usr/bin/env node
// Regenerates every committed OpenAPI client from the platform's emitted documents.
// Run it, review the diff, commit it. `npm run verify:clients` enforces that you did.

import { relative } from 'node:path';

import { CLIENTS, WEB_ROOT, writeClient } from './openapi-clients.mjs';

let failed = false;

for (const client of CLIENTS) {
  try {
    const source = await writeClient(client);
    const lines = source.split('\n').length;
    console.log(`${client.name}: wrote ${relative(WEB_ROOT, client.output)} (${lines} lines)`);
  } catch (error) {
    failed = true;
    console.error(`${client.name}: ${error.message}`);
  }
}

process.exit(failed ? 1 : 0);
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:workspace`
Expected: PASS — 7 tests across `generateTypes`, `resolvePlatformRoot` and `CLIENTS`.

- [ ] **Step 6: Generate the committed client and read it**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npm run generate:clients
```

Expected: `@peakpower-nl/api-client-employee: wrote libs/api-client-employee/src/generated/employee-schema.d.ts (NNN lines)`

Then open the generated file and check three things, because Task 3 depends on them:

```bash
grep -c 'CustomerDetailDto\|MeteringPointDto\|BrpDto' \
  libs/api-client-employee/src/generated/employee-schema.d.ts
grep -o '"PENDING_APPROVAL"\|"PendingApproval"' \
  libs/api-client-employee/src/generated/employee-schema.d.ts | sort -u
```

1. Every schema name listed in **What this plan consumes from Plan 2** is present. If one is
   spelled differently, note the real spelling — Task 3 aliases it and nothing else in the plan
   touches the generated names.
2. The enum unions use the database spelling (`"PENDING_APPROVAL"`). The second `grep` must print
   `"PENDING_APPROVAL"` and nothing else. `"PendingApproval"` appearing at all means Plan 2's
   shared `JsonStringEnumConverter` is not registered, which is a Plan 2 defect against shared
   contract §5.2 — fix it there rather than re-keying Task 5's label maps here.
3. There is no runtime code — the file is types only.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add package.json package-lock.json tsconfig.json \
  tools/openapi-clients.mjs tools/generate-clients.mjs tools/openapi-clients.test.mjs \
  tools/__fixtures__/tiny-openapi.json \
  libs/api-client-employee/package.json \
  libs/api-client-employee/src/generated/employee-schema.d.ts
git commit -m "feat(api-client-employee): generate and commit the employee OpenAPI types"
```

---

## Task 2: The staleness check

Committing generated code without a check is strictly worse than a registry: the copy in the
repository silently stops matching the API it claims to describe, and nothing tells you until a
runtime 400. `verify:clients` regenerates every client into memory and fails if a single byte
differs from what is committed. It runs from Plan 1's `dev-up` and before every commit, and it
becomes a required CI check the day CI exists.

**Files:**
- Modify: `tools/openapi-clients.mjs`
- Create: `tools/verify-clients.mjs`
- Test: `tools/verify-clients.test.mjs`

**Interfaces:**
- Consumes (Task 1): `BANNER`, `CLIENTS`, `WEB_ROOT`, `generateTypes(documentPath)`,
  `readCommitted(client)`.
- Produces:
  - `export function firstDifferenceLine(expected: string, actual: string): number` — 1-based,
    `0` when the two strings are identical
  - `export async function checkClient(client): Promise<{ name: string; stale: boolean; reason: 'ok' | 'missing' | 'drift'; line: number }>`
  - npm script `verify:clients`, exit code 1 on drift

- [ ] **Step 1: Write the failing test**

Create `tools/verify-clients.test.mjs`:

```js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkClient, firstDifferenceLine, generateTypes } from './openapi-clients.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, '__fixtures__/tiny-openapi.json');

describe('firstDifferenceLine', () => {
  it('returns 0 for identical strings', () => {
    assert.equal(firstDifferenceLine('a\nb\nc', 'a\nb\nc'), 0);
  });

  it('returns the 1-based line of the first difference', () => {
    assert.equal(firstDifferenceLine('a\nb\nc', 'a\nX\nc'), 2);
  });

  it('reports the first extra line when the actual is longer', () => {
    assert.equal(firstDifferenceLine('a\nb', 'a\nb\nc'), 3);
  });

  it('reports the first missing line when the actual is shorter', () => {
    assert.equal(firstDifferenceLine('a\nb\nc', 'a\nb'), 3);
  });
});

describe('checkClient', () => {
  let dir;
  let client;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pp-verify-'));
    client = { name: '@peakpower-nl/test', document: FIXTURE, output: join(dir, 'schema.d.ts') };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reports missing when nothing is committed', async () => {
    const result = await checkClient(client);
    assert.equal(result.stale, true);
    assert.equal(result.reason, 'missing');
  });

  it('reports ok when the committed file matches the document', async () => {
    await writeFile(client.output, await generateTypes(FIXTURE), 'utf8');
    const result = await checkClient(client);
    assert.equal(result.stale, false);
    assert.equal(result.reason, 'ok');
    assert.equal(result.line, 0);
  });

  it('reports drift with a line number when the committed file was edited', async () => {
    const fresh = await generateTypes(FIXTURE);
    const edited = fresh.replace('CustomerListItemDto', 'CustomerListItemDtoHandEdited');
    assert.notEqual(edited, fresh, 'the fixture must contain CustomerListItemDto');
    await writeFile(client.output, edited, 'utf8');
    const result = await checkClient(client);
    assert.equal(result.stale, true);
    assert.equal(result.reason, 'drift');
    assert.ok(result.line > 0, 'drift must report a 1-based line number');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:workspace`
Expected: FAIL with `SyntaxError: The requested module './openapi-clients.mjs' does not provide an export named 'checkClient'`

- [ ] **Step 3: Write the minimal implementation**

Append to `tools/openapi-clients.mjs`:

```js
/**
 * The 1-based line number of the first difference between two strings, or 0 when they match.
 * A line number is enough to find hand-edits and OpenAPI changes without shelling out to diff.
 */
export function firstDifferenceLine(expected, actual) {
  if (expected === actual) return 0;
  const a = expected.split('\n');
  const b = actual.split('\n');
  const shorter = Math.min(a.length, b.length);
  for (let i = 0; i < shorter; i += 1) {
    if (a[i] !== b[i]) return i + 1;
  }
  return shorter + 1;
}

export async function checkClient(client) {
  const fresh = await generateTypes(client.document);
  const committed = await readCommitted(client);
  if (committed === null) {
    return { name: client.name, stale: true, reason: 'missing', line: 0 };
  }
  const line = firstDifferenceLine(fresh, committed);
  return line === 0
    ? { name: client.name, stale: false, reason: 'ok', line: 0 }
    : { name: client.name, stale: true, reason: 'drift', line };
}
```

Create `tools/verify-clients.mjs`:

```js
#!/usr/bin/env node
// The staleness check that replaces the package registry [DEC-116].
//
// It regenerates every committed client in memory and compares it byte-for-byte with what is on
// disk. It never writes. Run it from dev-up and before every commit; make it a required check
// the day CI exists.

import { relative } from 'node:path';

import { CLIENTS, WEB_ROOT, checkClient } from './openapi-clients.mjs';

let stale = false;

for (const client of CLIENTS) {
  let result;
  try {
    result = await checkClient(client);
  } catch (error) {
    stale = true;
    console.error(`${client.name}: ${error.message}`);
    continue;
  }

  if (!result.stale) {
    console.log(`${client.name}: up to date`);
    continue;
  }

  stale = true;
  console.error(`${client.name} is stale.`);
  console.error(`  committed: ${relative(WEB_ROOT, client.output)}`);
  console.error(`  document:  ${relative(WEB_ROOT, client.document)}`);
  console.error(
    result.reason === 'missing'
      ? '  the committed file does not exist'
      : `  first difference at line ${result.line}`,
  );
  console.error('  Run `npm run generate:clients`, review the diff, and commit it.');
}

process.exit(stale ? 1 : 0);
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:workspace`
Expected: PASS — 14 tests total across both tool test files.

- [ ] **Step 5: Prove the check catches a real hand-edit**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npm run verify:clients
printf '\n// hand edit\n' >> libs/api-client-employee/src/generated/employee-schema.d.ts
npm run verify:clients; echo "exit=$?"
git checkout -- libs/api-client-employee/src/generated/employee-schema.d.ts
npm run verify:clients
```

Expected: `up to date` → then `@peakpower-nl/api-client-employee is stale.` with a line number and
`exit=1` → then `up to date` again.

- [ ] **Step 6: Record the dev-up hook**

Plan 1 owns `dev-up` in both repositories. Add this line to
`/Users/thinhhuynh/PeakPower/peakpower-web/dev-up` immediately before it starts the workspace, so
that a stale client stops the day rather than surfacing as a runtime 400:

```bash
npm run verify:clients || {
  echo "The committed API clients are stale. Run 'npm run generate:clients' and commit." >&2
  exit 1
}
```

If `dev-up` does not exist yet because Plan 1 has not landed, create
`docs/dev-up-verify-clients.snippet.sh` containing exactly those five lines and a one-line
comment saying where they belong, so the hook is not lost.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add tools/openapi-clients.mjs tools/verify-clients.mjs tools/verify-clients.test.mjs
git add dev-up docs/dev-up-verify-clients.snippet.sh 2>/dev/null || true
git commit -m "feat(tools): fail the build when a committed API client is stale"
```

---

## Task 3: `EmployeeApiClient` and the HTTP test harness

The generated file is types only. This task adds the transport: one injectable service with a
URL builder and a method per endpoint, plus the testing helper every later task uses.

Angular's `HttpClient` is deliberately the transport rather than a generator-supplied `fetch`
wrapper. It is what makes `HttpTestingController` able to intercept requests in a unit test, what
lets Plan 5's auth interceptor be added later without touching a single call site, and what
`httpResource()` builds on — so the read screens and the write screens share one pipeline.

**Files:**
- Create: `libs/api-client-employee/src/lib/employee-api.tokens.ts`
- Create: `libs/api-client-employee/src/lib/employee-api.types.ts`
- Create: `libs/api-client-employee/src/lib/problem-details.ts`
- Create: `libs/api-client-employee/src/lib/employee-api.client.ts`
- Create: `libs/api-client-employee/src/lib/employee-api.testing.ts`
- Create: `libs/api-client-employee/src/index.ts`
- Modify: `angular.json` (two key-level edits inside the existing `employee-portal` project)
- Modify: `apps/employee-portal/tsconfig.spec.json`
- Modify: `apps/employee-portal/tsconfig.app.json`
- Modify: `apps/employee-portal/src/index.html`
- Modify: `apps/employee-portal/src/styles.css`
- Modify: `apps/employee-portal/src/main.ts`
- Test: `libs/api-client-employee/src/lib/employee-api.client.spec.ts`

> Plan 3 scaffolded `apps/employee-portal` — the two tsconfigs, `index.html`, `styles.css` and
> `main.ts` all exist, copied from the customer portal. This task replaces the contents of each
> with the employee portal's own, which is why every one of them is a *modify*. The `main.ts`
> written here is a two-line stub so that `angular.json`'s build target — which the unit-test
> builder needs as its `buildTarget` — resolves. Task 6 replaces it with the real bootstrap.

**Interfaces:**
- Consumes: the generated `components['schemas'][…]` names from Task 1;
  `@angular/common/http`'s `HttpClient`, `provideHttpClient`;
  `@angular/common/http/testing`'s `provideHttpClientTesting`.
- Produces:
  - `export const EMPLOYEE_API_BASE_URL: InjectionToken<string>`
  - `export type CustomerListItem, CustomerListResponse, CustomerDetail, Account, MeteringPoint, Brp, Address, ContactPerson, CreateCustomerRequest, UpdateCustomerRequest, CreateAccountRequest, UpdateAccountRequest, AttachMeteringPointRequest, UpdateMeteringPointRequest, EndDateMeteringPointRequest, CustomerStatusValue, AccountStatusValue, ProductionExpectationValue, ProductionExpectationSourceValue`
  - `export interface ValidationProblemDetails { type?: string; title?: string; status?: number; detail?: string; errors?: Record<string, string[]> }`
  - `export function isValidationProblem(value: unknown): value is ValidationProblemDetails`
  - `export class EmployeeApiClient` with:
    - `readonly baseUrl: string`
    - `customersUrl(): string`
    - `customerUrl(id: string): string`
    - `customerAccountsUrl(customerId: string): string`
    - `accountUrl(accountId: string): string`
    - `customerMeteringPointsUrl(customerId: string): string`
    - `meteringPointUrl(id: string): string`
    - `brpsUrl(): string`
    - `listCustomers(q: string): Observable<CustomerListResponse>`
    - `getCustomer(id: string): Observable<CustomerDetail>`
    - `createCustomer(body: CreateCustomerRequest): Observable<CustomerDetail>`
    - `updateCustomer(id: string, body: UpdateCustomerRequest): Observable<CustomerDetail>`
    - `createAccount(customerId: string, body: CreateAccountRequest): Observable<Account>`
    - `updateAccount(accountId: string, body: UpdateAccountRequest): Observable<Account>`
    - `deactivateAccount(accountId: string): Observable<Account>`
    - `attachMeteringPoint(customerId: string, body: AttachMeteringPointRequest): Observable<MeteringPoint>`
    - `updateMeteringPoint(id: string, body: UpdateMeteringPointRequest): Observable<MeteringPoint>`
    - `endDateMeteringPoint(id: string, body: EndDateMeteringPointRequest): Observable<MeteringPoint>`
    - `listBrps(): Observable<Brp[]>`
  - `export function provideEmployeeApiTesting(): EnvironmentProviders[]`

- [ ] **Step 1: Point the `employee-portal` project at the proxy and the client specs**

**Plan 3 already created the `employee-portal` project in `angular.json`** — `"prefix": "pp"`, a
`"targets"` object (not `"architect"`), `libs/shared-ui/src/styles/tokens.css` ahead of the app
stylesheet, the `public/` asset glob and the production budgets. Do not paste a competing project
object over it. This plan makes exactly two key-level edits, both inside
`projects["employee-portal"].targets`:

1. **`serve.options`** — Plan 3's serve target has configurations but no `options`. Add one, so
   the dev server binds the port the shell expects and forwards `/api`:

```json
"options": {
  "port": 4201,
  "proxyConfig": "apps/employee-portal/proxy.conf.mjs"
}
```

2. **`test.options`** — Plan 3 set only `tsConfig`. Add the runner and the include list, because
   the transport layer's specs live in `libs/api-client-employee`, outside the app root, and
   would otherwise never run:

```json
"runner": "vitest",
"include": [
  "apps/employee-portal/src/**/*.spec.ts",
  "libs/api-client-employee/src/**/*.spec.ts"
]
```

Leave `build` untouched: its styles array, budgets and assets are Plan 3's and this plan has no
reason to change any of them.

Check the result before moving on:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
node -e "const a=require('./angular.json').projects['employee-portal'];
  console.log('prefix', a.prefix, '| targets', Object.keys(a.targets).join(','));
  console.log('styles', a.targets.build.options.styles.join(' '));
  console.log('serve', JSON.stringify(a.targets.serve.options));
  console.log('test', JSON.stringify(a.targets.test.options.include));"
```

Expected: `prefix pp`, a `targets` key (never `architect`), `tokens.css` still first in `styles`,
the two serve options, and both include globs.

Replace `apps/employee-portal/tsconfig.app.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../out-tsc/employee-portal",
    "types": []
  },
  "files": ["src/main.ts"],
  "include": ["src/**/*.d.ts"]
}
```

Replace `apps/employee-portal/tsconfig.spec.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../out-tsc/employee-portal-spec",
    "types": ["vitest/globals", "node"]
  },
  "include": [
    "src/**/*.spec.ts",
    "src/**/*.d.ts",
    "../../libs/api-client-employee/src/**/*.spec.ts"
  ]
}
```

Replace `apps/employee-portal/src/index.html`:

```html
<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8" />
    <title>PeakPower back office</title>
    <meta name="viewport" content="width=1280" />
  </head>
  <body>
    <pp-root></pp-root>
  </body>
</html>
```

The viewport is a fixed 1280 on purpose. The back office is desktop only — design §8.4 records
that as explicit scope, not an omission.

Replace `apps/employee-portal/src/styles.css`:

```css
/* Plan 3 owns every token, and angular.json already loads tokens.css ahead of this file, so
   there is no @import here. This file only wires those tokens to the page canvas. */
html,
body {
  margin: 0;
  padding: 0;
}

body {
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 13px;
  color: var(--pp-text);
  background: var(--pp-canvas);
}
```

Replace `apps/employee-portal/src/main.ts` with a stub, itself replaced in Task 6:

```ts
// Replaced by the real bootstrap in Task 6. It exists now so that angular.json's build target
// resolves, which the unit-test builder needs as its buildTarget.
export {};
```

- [ ] **Step 2: Write the failing test**

Create `libs/api-client-employee/src/lib/employee-api.client.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { EmployeeApiClient } from './employee-api.client';
import { provideEmployeeApiTesting } from './employee-api.testing';
import { isValidationProblem } from './problem-details';
import type { CreateAccountRequest, CustomerListResponse } from './employee-api.types';

describe('EmployeeApiClient', () => {
  let api: EmployeeApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideEmployeeApiTesting()] });
    api = TestBed.inject(EmployeeApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('builds every URL under the injected base path', () => {
    expect(api.customersUrl()).toBe('/api/v1/customers');
    expect(api.customerUrl('c1')).toBe('/api/v1/customers/c1');
    expect(api.customerAccountsUrl('c1')).toBe('/api/v1/customers/c1/accounts');
    expect(api.accountUrl('a1')).toBe('/api/v1/accounts/a1');
    expect(api.customerMeteringPointsUrl('c1')).toBe('/api/v1/customers/c1/metering-points');
    expect(api.meteringPointUrl('m1')).toBe('/api/v1/metering-points/m1');
    expect(api.brpsUrl()).toBe('/api/v1/reference-data/brps');
  });

  it('sends the search term as the q parameter', () => {
    const payload: CustomerListResponse = { items: [], total: 0 };
    let received: CustomerListResponse | undefined;
    api.listCustomers('acme').subscribe((r) => (received = r));

    const req = http.expectOne((r) => r.url === '/api/v1/customers');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('acme');
    req.flush(payload);

    expect(received).toEqual(payload);
  });

  it('omits the q parameter when the search term is blank', () => {
    api.listCustomers('   ').subscribe();
    const req = http.expectOne((r) => r.url === '/api/v1/customers');
    expect(req.request.params.has('q')).toBe(false);
    req.flush({ items: [], total: 0 });
  });

  it('POSTs an account to the customer accounts collection', () => {
    const body = {
      username: 'j.jansen',
      firstName: 'Jan',
      lastName: 'Jansen',
      jobTitle: null,
      email: 'jan@example.nl',
      phone: null,
      isAdmin: true,
    } as CreateAccountRequest;

    api.createAccount('c1', body).subscribe();

    const req = http.expectOne('/api/v1/customers/c1/accounts');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush({});
  });

  it('POSTs an empty body to deactivate an account', () => {
    api.deactivateAccount('a1').subscribe();
    const req = http.expectOne('/api/v1/accounts/a1/deactivate');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({});
  });

  it('PATCHes a metering point', () => {
    api
      .updateMeteringPoint('m1', {
        brpId: 'b1',
        productionExpectation: 'EXPECTED',
        expectationSource: 'MANUAL',
        name: 'Rooftop',
        description: null,
        gridOperator: null,
        capacityKw: null,
        address: null,
      } as never)
      .subscribe();

    const req = http.expectOne('/api/v1/metering-points/m1');
    expect(req.request.method).toBe('PATCH');
    req.flush({});
  });
});

describe('isValidationProblem', () => {
  it('accepts an RFC 7807 body carrying an errors map', () => {
    expect(
      isValidationProblem({
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: { kvkNumber: ['KvK number must be exactly 8 digits.'] },
      }),
    ).toBe(true);
  });

  it('rejects a problem document with no errors map', () => {
    expect(isValidationProblem({ title: 'Not found', status: 404 })).toBe(false);
  });

  it('rejects null and strings', () => {
    expect(isValidationProblem(null)).toBe(false);
    expect(isValidationProblem('nope')).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: FAIL — `Failed to resolve import "./employee-api.client"` (the module does not exist).

- [ ] **Step 4: Write the minimal implementation**

Create `libs/api-client-employee/src/lib/employee-api.tokens.ts`:

```ts
import { InjectionToken } from '@angular/core';

/**
 * Root of the employee API, without a trailing slash — '/api/v1' in the browser, where the
 * dev-server proxy forwards it to the ASP.NET host Aspire started.
 */
export const EMPLOYEE_API_BASE_URL = new InjectionToken<string>('EMPLOYEE_API_BASE_URL');
```

Create `libs/api-client-employee/src/lib/employee-api.types.ts`:

```ts
// Readable aliases over the generated schema. This is the ONLY file in the workspace that knows
// how openapi-typescript names things, so a change in the generator costs one file.
import type { components } from '../generated/employee-schema';

type Schemas = components['schemas'];

export type Address = Schemas['AddressDto'];
export type ContactPerson = Schemas['ContactPersonDto'];

export type CustomerListItem = Schemas['CustomerListItemDto'];
export type CustomerListResponse = Schemas['CustomerListResponse'];
export type CustomerDetail = Schemas['CustomerDetailDto'];
export type Account = Schemas['AccountDto'];
export type MeteringPoint = Schemas['MeteringPointDto'];
export type Brp = Schemas['BrpDto'];

export type CreateCustomerRequest = Schemas['CreateCustomerRequest'];
export type UpdateCustomerRequest = Schemas['UpdateCustomerRequest'];
export type CreateAccountRequest = Schemas['CreateAccountRequest'];
export type UpdateAccountRequest = Schemas['UpdateAccountRequest'];
export type AttachMeteringPointRequest = Schemas['AttachMeteringPointRequest'];
export type UpdateMeteringPointRequest = Schemas['UpdateMeteringPointRequest'];
export type EndDateMeteringPointRequest = Schemas['EndDateMeteringPointRequest'];

// The enum string unions, pulled off the DTOs so they can never drift from the contract.
export type CustomerStatusValue = CustomerListItem['status'];
export type AccountStatusValue = Account['status'];
export type ProductionExpectationValue = MeteringPoint['productionExpectation'];
export type ProductionExpectationSourceValue = NonNullable<MeteringPoint['expectationSource']>;
```

Create `libs/api-client-employee/src/lib/problem-details.ts`:

```ts
/**
 * RFC 7807 `application/problem+json`. ASP.NET Core adds `errors` for a validation failure:
 * a map from a property path to one or more human-readable messages.
 */
export interface ValidationProblemDetails {
  readonly type?: string;
  readonly title?: string;
  readonly status?: number;
  readonly detail?: string;
  readonly instance?: string;
  readonly errors?: Record<string, string[]>;
}

export function isValidationProblem(value: unknown): value is ValidationProblemDetails {
  if (typeof value !== 'object' || value === null) return false;
  const errors = (value as { errors?: unknown }).errors;
  return typeof errors === 'object' && errors !== null && !Array.isArray(errors);
}
```

Create `libs/api-client-employee/src/lib/employee-api.client.ts`:

```ts
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import { EMPLOYEE_API_BASE_URL } from './employee-api.tokens';
import type {
  Account,
  AttachMeteringPointRequest,
  Brp,
  CreateAccountRequest,
  CreateCustomerRequest,
  CustomerDetail,
  CustomerListResponse,
  EndDateMeteringPointRequest,
  MeteringPoint,
  UpdateAccountRequest,
  UpdateCustomerRequest,
  UpdateMeteringPointRequest,
} from './employee-api.types';

/**
 * The employee API is NOT tenant-scoped: there is no customer_id claim, no company switcher and
 * no query filter behind these calls. Cross-customer reads are ordinary reads here.
 */
@Injectable({ providedIn: 'root' })
export class EmployeeApiClient {
  private readonly http = inject(HttpClient);
  readonly baseUrl = inject(EMPLOYEE_API_BASE_URL);

  customersUrl(): string {
    return `${this.baseUrl}/customers`;
  }
  customerUrl(id: string): string {
    return `${this.baseUrl}/customers/${id}`;
  }
  customerAccountsUrl(customerId: string): string {
    return `${this.baseUrl}/customers/${customerId}/accounts`;
  }
  accountUrl(accountId: string): string {
    return `${this.baseUrl}/accounts/${accountId}`;
  }
  customerMeteringPointsUrl(customerId: string): string {
    return `${this.baseUrl}/customers/${customerId}/metering-points`;
  }
  meteringPointUrl(id: string): string {
    return `${this.baseUrl}/metering-points/${id}`;
  }
  brpsUrl(): string {
    return `${this.baseUrl}/reference-data/brps`;
  }

  /** Free-text search across legal name, trade name and KvK number. */
  listCustomers(q: string): Observable<CustomerListResponse> {
    const trimmed = q.trim();
    const params = trimmed.length > 0 ? new HttpParams().set('q', trimmed) : new HttpParams();
    return this.http.get<CustomerListResponse>(this.customersUrl(), { params });
  }

  getCustomer(id: string): Observable<CustomerDetail> {
    return this.http.get<CustomerDetail>(this.customerUrl(id));
  }

  createCustomer(body: CreateCustomerRequest): Observable<CustomerDetail> {
    return this.http.post<CustomerDetail>(this.customersUrl(), body);
  }

  updateCustomer(id: string, body: UpdateCustomerRequest): Observable<CustomerDetail> {
    return this.http.patch<CustomerDetail>(this.customerUrl(id), body);
  }

  createAccount(customerId: string, body: CreateAccountRequest): Observable<Account> {
    return this.http.post<Account>(this.customerAccountsUrl(customerId), body);
  }

  updateAccount(accountId: string, body: UpdateAccountRequest): Observable<Account> {
    return this.http.patch<Account>(this.accountUrl(accountId), body);
  }

  deactivateAccount(accountId: string): Observable<Account> {
    return this.http.post<Account>(`${this.accountUrl(accountId)}/deactivate`, {});
  }

  attachMeteringPoint(
    customerId: string,
    body: AttachMeteringPointRequest,
  ): Observable<MeteringPoint> {
    return this.http.post<MeteringPoint>(this.customerMeteringPointsUrl(customerId), body);
  }

  updateMeteringPoint(
    id: string,
    body: UpdateMeteringPointRequest,
  ): Observable<MeteringPoint> {
    return this.http.patch<MeteringPoint>(this.meteringPointUrl(id), body);
  }

  endDateMeteringPoint(
    id: string,
    body: EndDateMeteringPointRequest,
  ): Observable<MeteringPoint> {
    return this.http.post<MeteringPoint>(`${this.meteringPointUrl(id)}/end-date`, body);
  }

  listBrps(): Observable<Brp[]> {
    return this.http.get<Brp[]>(this.brpsUrl());
  }
}
```

Create `libs/api-client-employee/src/lib/employee-api.testing.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { makeEnvironmentProviders, provideZonelessChangeDetection } from '@angular/core';
import type { EnvironmentProviders } from '@angular/core';

import { EMPLOYEE_API_BASE_URL } from './employee-api.tokens';

/**
 * The harness every spec in the employee portal uses.
 *
 * `provideHttpClientTesting` intercepts the real HttpBackend, so it captures BOTH the imperative
 * `EmployeeApiClient` calls and anything `httpResource()` issues — httpResource is built on
 * HttpClient, so one controller sees every request in the application.
 *
 * `provideZonelessChangeDetection` is required: this workspace ships no zone.js, so a TestBed
 * without it has no scheduler and `fixture.whenStable()` never settles.
 */
export function provideEmployeeApiTesting(baseUrl = '/api/v1'): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideZonelessChangeDetection(),
    provideHttpClient(),
    provideHttpClientTesting(),
    { provide: EMPLOYEE_API_BASE_URL, useValue: baseUrl },
  ]);
}
```

Create `libs/api-client-employee/src/index.ts`:

```ts
export * from './lib/employee-api.tokens';
export * from './lib/employee-api.types';
export * from './lib/employee-api.client';
export * from './lib/problem-details';
export * from './lib/employee-api.testing';
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: PASS — 9 tests in `employee-api.client.spec.ts`.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add angular.json apps/employee-portal libs/api-client-employee
git commit -m "feat(api-client-employee): add EmployeeApiClient and the HTTP test harness"
```

---

## Task 4: RFC 7807 errors onto reactive-form controls

The design is explicit that KvK and IBAN validation is **not** duplicated in the browser: the
API owns the rule and the form surfaces what it returns. A KvK number is the eight-digit
registration number every Dutch company has with the Chamber of Commerce (Kamer van Koophandel);
an IBAN is the international bank account number, validated with an ISO 7064 mod-97 checksum.
Both rules already exist in `PeakPower.Domain.Common`, and re-implementing them in TypeScript
would guarantee the two copies disagree.

So the browser sends the form and, on a 400, walks the `errors` map onto the matching controls.
This task is that walk — a pure function with no Angular HTTP in it, which is why it gets its own
test cycle.

**Files:**
- Create: `apps/employee-portal/src/app/shared/apply-problem-details.ts`
- Test: `apps/employee-portal/src/app/shared/apply-problem-details.spec.ts`

**Interfaces:**
- Consumes (Task 3): `ValidationProblemDetails` from `@peakpower-nl/api-client-employee`.
- Produces:
  - `export const SERVER_ERROR_KEY = 'server'`
  - `export function normaliseProblemKey(key: string): string`
  - `export function applyProblemDetails(form: FormGroup, problem: ValidationProblemDetails): string[]`
    — sets `{ server: string }` on each matched control, marks it touched, and returns the
    messages that matched no control so the page can show them in a `pp-banner`.
  - `export function serverError(control: AbstractControl | null): string | null`

- [ ] **Step 1: Write the failing test**

Create `apps/employee-portal/src/app/shared/apply-problem-details.spec.ts`:

```ts
import { FormControl, FormGroup } from '@angular/forms';
import { describe, it, expect } from 'vitest';

import {
  applyProblemDetails,
  normaliseProblemKey,
  serverError,
} from './apply-problem-details';

function buildForm() {
  return new FormGroup({
    legalName: new FormControl('', { nonNullable: true }),
    kvkNumber: new FormControl('', { nonNullable: true }),
    ean: new FormControl('', { nonNullable: true }),
    billingAddress: new FormGroup({
      postalCode: new FormControl('', { nonNullable: true }),
    }),
  });
}

describe('normaliseProblemKey', () => {
  it('leaves a camelCase path alone', () => {
    expect(normaliseProblemKey('kvkNumber')).toBe('kvkNumber');
  });

  it('lower-cases the first letter of each PascalCase segment', () => {
    expect(normaliseProblemKey('BillingAddress.PostalCode')).toBe('billingAddress.postalCode');
  });

  it('strips the $. prefix System.Text.Json adds', () => {
    expect(normaliseProblemKey('$.KvkNumber')).toBe('kvkNumber');
  });

  it('rewrites indexer syntax into a dotted path', () => {
    expect(normaliseProblemKey('Signatories[0].Email')).toBe('signatories.0.email');
  });
});

describe('applyProblemDetails', () => {
  it('sets a server error on the matching control', () => {
    const form = buildForm();
    const unmatched = applyProblemDetails(form, {
      status: 400,
      errors: { kvkNumber: ['KvK number must be exactly 8 digits.'] },
    });

    expect(unmatched).toEqual([]);
    expect(serverError(form.controls.kvkNumber)).toBe('KvK number must be exactly 8 digits.');
    expect(form.controls.kvkNumber.touched).toBe(true);
    expect(form.controls.kvkNumber.valid).toBe(false);
  });

  it('surfaces an EAN failure without a client-side EAN rule', () => {
    const form = buildForm();
    applyProblemDetails(form, {
      status: 400,
      errors: { ean: ['EAN must be exactly 18 digits.'] },
    });
    expect(serverError(form.controls.ean)).toBe('EAN must be exactly 18 digits.');
  });

  it('reaches a nested control through a dotted path', () => {
    const form = buildForm();
    applyProblemDetails(form, {
      status: 400,
      errors: { 'BillingAddress.PostalCode': ['Postal code is required.'] },
    });
    expect(serverError(form.controls.billingAddress.controls.postalCode))
      .toBe('Postal code is required.');
  });

  it('joins several messages for one control into one sentence run', () => {
    const form = buildForm();
    applyProblemDetails(form, {
      status: 400,
      errors: { legalName: ['Legal name is required.', 'Legal name must be under 200 characters.'] },
    });
    expect(serverError(form.controls.legalName))
      .toBe('Legal name is required. Legal name must be under 200 characters.');
  });

  it('returns messages that match no control instead of dropping them', () => {
    const form = buildForm();
    const unmatched = applyProblemDetails(form, {
      status: 409,
      errors: { '': ['A customer with this KvK number already exists.'] },
    });
    expect(unmatched).toEqual(['A customer with this KvK number already exists.']);
  });

  it('returns the problem title when there is no errors map at all', () => {
    const form = buildForm();
    const unmatched = applyProblemDetails(form, {
      status: 500,
      title: 'An unexpected error occurred.',
    });
    expect(unmatched).toEqual(['An unexpected error occurred.']);
  });

  it('keeps errors already on the control', () => {
    const form = buildForm();
    form.controls.legalName.setErrors({ required: true });
    applyProblemDetails(form, { status: 400, errors: { legalName: ['Legal name is required.'] } });
    expect(form.controls.legalName.errors).toEqual({
      required: true,
      server: 'Legal name is required.',
    });
  });
});

describe('serverError', () => {
  it('returns null for a control with no server error', () => {
    expect(serverError(new FormControl(''))).toBeNull();
  });

  it('returns null for a null control', () => {
    expect(serverError(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: FAIL — `Failed to resolve import "./apply-problem-details"`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/employee-portal/src/app/shared/apply-problem-details.ts`:

```ts
import type { AbstractControl, FormGroup } from '@angular/forms';
import type { ValidationProblemDetails } from '@peakpower-nl/api-client-employee';

/** The single error key every server-side validation message lands under. */
export const SERVER_ERROR_KEY = 'server';

/**
 * ASP.NET Core spells its validation keys several ways depending on where the failure came from:
 * `KvkNumber` from model binding, `$.kvkNumber` from System.Text.Json, `Signatories[0].Email`
 * from a collection. Reactive forms want `kvkNumber`, `signatories.0.email`. This is the bridge.
 */
export function normaliseProblemKey(key: string): string {
  const withoutRoot = key.startsWith('$.') ? key.slice(2) : key;
  const dotted = withoutRoot.replace(/\[(\d+)\]/g, '.$1');
  return dotted
    .split('.')
    .map((segment) =>
      segment.length > 0 && segment[0] === segment[0].toUpperCase()
        ? segment[0].toLowerCase() + segment.slice(1)
        : segment,
    )
    .join('.');
}

/**
 * Walks an RFC 7807 body onto a reactive form.
 *
 * Returns the messages that matched no control. The caller shows those in a pp-banner rather
 * than dropping them — a message the user never sees is worse than an ugly one.
 */
export function applyProblemDetails(
  form: FormGroup,
  problem: ValidationProblemDetails,
): string[] {
  const entries = Object.entries(problem.errors ?? {});
  if (entries.length === 0) {
    return problem.title ? [problem.title] : [];
  }

  const unmatched: string[] = [];

  for (const [rawKey, messages] of entries) {
    const text = messages.join(' ');
    const path = normaliseProblemKey(rawKey);
    const control = path.length > 0 ? form.get(path) : null;

    if (control === null) {
      unmatched.push(text);
      continue;
    }

    control.setErrors({ ...(control.errors ?? {}), [SERVER_ERROR_KEY]: text });
    control.markAsTouched();
  }

  return unmatched;
}

/** The server message on a control, or null. Templates read this; they never index errors. */
export function serverError(control: AbstractControl | null): string | null {
  const value = control?.errors?.[SERVER_ERROR_KEY];
  return typeof value === 'string' ? value : null;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: PASS — 13 tests in `apply-problem-details.spec.ts`, 9 still passing in
`employee-api.client.spec.ts`.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/employee-portal/src/app/shared/apply-problem-details.ts \
  apps/employee-portal/src/app/shared/apply-problem-details.spec.ts
git commit -m "feat(employee-portal): map RFC 7807 validation errors onto form controls"
```

---

## Task 5: Enum labels and badge tones

Every enum this portal renders arrives as a wire string in the database spelling
(`PENDING_APPROVAL`). Screens must never print that string — the copy rules say sentence case
everywhere. One module owns the translation so that a spelling change in Plan 2 costs one file,
and so that a status has the same colour on the list as on the detail.

Domain terms a reader may not know:

- **BRP** — Balance Responsible Party. In the Dutch electricity market every connection is
  assigned to a party that is financially responsible for keeping its planned and actual volumes
  in balance. `[F01-R51]` makes it mandatory on a metering point.
- **Metering point** — a physical connection to the grid, identified by an 18-digit EAN code.
- **Production expectation** — whether the connection is expected to feed electricity back into
  the grid (solar, wind), which changes how its volumes are read.

**Files:**
- Create: `apps/employee-portal/src/app/shared/labels.ts`
- Test: `apps/employee-portal/src/app/shared/labels.spec.ts`

**Interfaces:**
- Consumes (Task 3): `CustomerStatusValue`, `AccountStatusValue`, `ProductionExpectationValue`,
  `ProductionExpectationSourceValue`, and `PpTone` from `@peakpower-nl/shared-ui`.
- Produces:
  - `export function customerStatusLabel(value: CustomerStatusValue): string`
  - `export function customerStatusTone(value: CustomerStatusValue): PpTone`
  - `export function accountStatusLabel(value: AccountStatusValue): string`
  - `export function accountStatusTone(value: AccountStatusValue): PpTone`
  - `export function productionExpectationLabel(value: ProductionExpectationValue): string`
  - `export function expectationSourceLabel(value: ProductionExpectationSourceValue | null | undefined): string`
  - `export const CUSTOMER_STATUS_OPTIONS: readonly { value: CustomerStatusValue; label: string }[]`
  - `export const PRODUCTION_EXPECTATION_OPTIONS: readonly { value: ProductionExpectationValue; label: string }[]`
  - `export const EXPECTATION_SOURCE_OPTIONS: readonly { value: ProductionExpectationSourceValue; label: string }[]`

- [ ] **Step 1: Write the failing test**

Create `apps/employee-portal/src/app/shared/labels.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';

import {
  CUSTOMER_STATUS_OPTIONS,
  EXPECTATION_SOURCE_OPTIONS,
  PRODUCTION_EXPECTATION_OPTIONS,
  accountStatusLabel,
  accountStatusTone,
  customerStatusLabel,
  customerStatusTone,
  expectationSourceLabel,
  productionExpectationLabel,
} from './labels';

describe('customer status', () => {
  it('renders every value in sentence case', () => {
    expect(customerStatusLabel('PROSPECT')).toBe('Prospect');
    expect(customerStatusLabel('ACTIVE')).toBe('Active');
    expect(customerStatusLabel('SUSPENDED')).toBe('Suspended');
    expect(customerStatusLabel('CLOSED')).toBe('Closed');
  });

  it('gives an active company a success tone and a suspended one a warning tone', () => {
    expect(customerStatusTone('ACTIVE')).toBe('success');
    expect(customerStatusTone('SUSPENDED')).toBe('warning');
    expect(customerStatusTone('PROSPECT')).toBe('info');
    expect(customerStatusTone('CLOSED')).toBe('neutral');
  });

  it('offers all four statuses to the edit form, in the order the domain declares them', () => {
    expect(CUSTOMER_STATUS_OPTIONS.map((o) => o.value))
      .toEqual(['PROSPECT', 'ACTIVE', 'SUSPENDED', 'CLOSED']);
    expect(CUSTOMER_STATUS_OPTIONS.map((o) => o.label))
      .toEqual(['Prospect', 'Active', 'Suspended', 'Closed']);
  });
});

describe('account status', () => {
  it('covers all four values including PENDING_APPROVAL', () => {
    expect(accountStatusLabel('PENDING_APPROVAL')).toBe('Pending approval');
    expect(accountStatusLabel('INVITED')).toBe('Invited');
    expect(accountStatusLabel('ACTIVE')).toBe('Active');
    expect(accountStatusLabel('DEACTIVATED')).toBe('Deactivated');
  });

  it('tones a deactivated account neutral, not critical', () => {
    expect(accountStatusTone('DEACTIVATED')).toBe('neutral');
    expect(accountStatusTone('PENDING_APPROVAL')).toBe('warning');
    expect(accountStatusTone('INVITED')).toBe('info');
    expect(accountStatusTone('ACTIVE')).toBe('success');
  });
});

describe('production expectation', () => {
  it('uses NEVER, not NotExpected', () => {
    expect(productionExpectationLabel('UNKNOWN')).toBe('Unknown');
    expect(productionExpectationLabel('NEVER')).toBe('Never produces');
    expect(productionExpectationLabel('EXPECTED')).toBe('Production expected');
  });

  it('offers exactly three options in the order the domain declares them', () => {
    expect(PRODUCTION_EXPECTATION_OPTIONS.map((o) => o.value))
      .toEqual(['UNKNOWN', 'NEVER', 'EXPECTED']);
  });
});

describe('expectation source', () => {
  it('renders all five sources', () => {
    expect(expectationSourceLabel('CONTRACT')).toBe('Contract');
    expect(expectationSourceLabel('GRID_OPERATOR')).toBe('Grid operator');
    expect(expectationSourceLabel('OBSERVED')).toBe('Observed');
    expect(expectationSourceLabel('MANUAL')).toBe('Manual');
    expect(expectationSourceLabel('CUSTOMER_DECLARED')).toBe('Customer declared');
  });

  it('names the reason when there is no source rather than printing a dash', () => {
    expect(expectationSourceLabel(null)).toBe('Not recorded');
    expect(expectationSourceLabel(undefined)).toBe('Not recorded');
  });

  it('offers all five options', () => {
    expect(EXPECTATION_SOURCE_OPTIONS).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: FAIL — `Failed to resolve import "./labels"`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/employee-portal/src/app/shared/labels.ts`:

```ts
import type { PpTone } from '@peakpower-nl/shared-ui';
import type {
  AccountStatusValue,
  CustomerStatusValue,
  ProductionExpectationSourceValue,
  ProductionExpectationValue,
} from '@peakpower-nl/api-client-employee';

// Wire values are the database spelling (shared contract §4). Screens never print them.
// Copy rule: sentence case everywhere.

const CUSTOMER_STATUS_LABELS: Record<CustomerStatusValue, string> = {
  PROSPECT: 'Prospect',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  CLOSED: 'Closed',
};

const CUSTOMER_STATUS_TONES: Record<CustomerStatusValue, PpTone> = {
  PROSPECT: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CLOSED: 'neutral',
};

const ACCOUNT_STATUS_LABELS: Record<AccountStatusValue, string> = {
  PENDING_APPROVAL: 'Pending approval',
  INVITED: 'Invited',
  ACTIVE: 'Active',
  DEACTIVATED: 'Deactivated',
};

// Deactivated is neutral, not critical: it is a normal end state, not a fault.
const ACCOUNT_STATUS_TONES: Record<AccountStatusValue, PpTone> = {
  PENDING_APPROVAL: 'warning',
  INVITED: 'info',
  ACTIVE: 'success',
  DEACTIVATED: 'neutral',
};

const PRODUCTION_EXPECTATION_LABELS: Record<ProductionExpectationValue, string> = {
  UNKNOWN: 'Unknown',
  NEVER: 'Never produces',
  EXPECTED: 'Production expected',
};

const EXPECTATION_SOURCE_LABELS: Record<ProductionExpectationSourceValue, string> = {
  CONTRACT: 'Contract',
  GRID_OPERATOR: 'Grid operator',
  OBSERVED: 'Observed',
  MANUAL: 'Manual',
  CUSTOMER_DECLARED: 'Customer declared',
};

export function customerStatusLabel(value: CustomerStatusValue): string {
  return CUSTOMER_STATUS_LABELS[value];
}

export function customerStatusTone(value: CustomerStatusValue): PpTone {
  return CUSTOMER_STATUS_TONES[value];
}

export function accountStatusLabel(value: AccountStatusValue): string {
  return ACCOUNT_STATUS_LABELS[value];
}

export function accountStatusTone(value: AccountStatusValue): PpTone {
  return ACCOUNT_STATUS_TONES[value];
}

export function productionExpectationLabel(value: ProductionExpectationValue): string {
  return PRODUCTION_EXPECTATION_LABELS[value];
}

/** Empty states name the reason — 'Not recorded', never an em dash. */
export function expectationSourceLabel(
  value: ProductionExpectationSourceValue | null | undefined,
): string {
  return value == null ? 'Not recorded' : EXPECTATION_SOURCE_LABELS[value];
}

/** The four statuses the customer edit form may send back as UpdateCustomerRequest.status. */
export const CUSTOMER_STATUS_OPTIONS: readonly {
  value: CustomerStatusValue;
  label: string;
}[] = (['PROSPECT', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const).map((value) => ({
  value,
  label: CUSTOMER_STATUS_LABELS[value],
}));

export const PRODUCTION_EXPECTATION_OPTIONS: readonly {
  value: ProductionExpectationValue;
  label: string;
}[] = (['UNKNOWN', 'NEVER', 'EXPECTED'] as const).map((value) => ({
  value,
  label: PRODUCTION_EXPECTATION_LABELS[value],
}));

export const EXPECTATION_SOURCE_OPTIONS: readonly {
  value: ProductionExpectationSourceValue;
  label: string;
}[] = (
  ['CONTRACT', 'GRID_OPERATOR', 'OBSERVED', 'MANUAL', 'CUSTOMER_DECLARED'] as const
).map((value) => ({ value, label: EXPECTATION_SOURCE_LABELS[value] }));
```

Because each map is typed `Record<…Value, string>`, TypeScript fails the build if Plan 2 adds an
enum member and nobody gives it a label. That is the point of typing them rather than using a
plain object.

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: PASS — 10 tests in `labels.spec.ts`.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/employee-portal/src/app/shared/labels.ts \
  apps/employee-portal/src/app/shared/labels.spec.ts
git commit -m "feat(employee-portal): add enum labels and badge tones"
```

---

## Task 6: Bootstrap, shell and the back-office navigation

The back-office rail carries eight items: Home, Trade desk, Customers, Wallets, Settlements,
Data & feeds, Reference data, Audit. **Only Customers and Reference data are live features in
this slice.** The other five feature areas render disabled, each with the sentence that explains
why.

That is a design-system rule, not decoration, and design §8.4 gives the reason: *a rail that
grows between demos looks unfinished, whereas a rail that is complete and honest looks planned.*
The copy rule that empty and disabled states name the reason is the same rule seen from the other
side.

Home is the exception among the non-feature rows: it stays enabled, because it is the shell's
landing route rather than a feature, and its page is where the honest statement of scope lives. A
disabled Home with nothing behind `/` would read as broken rather than as planned.

Internal route keys keep the specification's names; the labels come from the design system. That
split is `[DEC-115]`, and `EMPLOYEE_NAV` is the single mapping between the two.

**Files:**
- Create: `apps/employee-portal/src/app/shell/employee-nav.ts`
- Create: `apps/employee-portal/src/app/app.ts`
- Create: `apps/employee-portal/src/app/app.config.ts`
- Create: `apps/employee-portal/src/app/app.routes.ts`
- Create: `apps/employee-portal/src/app/features/home/home-page.ts`
- Create: `apps/employee-portal/proxy.conf.mjs`
- Modify: `apps/employee-portal/src/main.ts` (replaces the Task 3 stub)
- Test: `apps/employee-portal/src/app/shell/employee-nav.spec.ts`
- Test: `apps/employee-portal/src/app/features/home/home-page.spec.ts`

**Interfaces:**
- Consumes (Plan 3): `PpAppShell`, `PpNavSection`, `PpNavItem`, `PpCard`, `PpBanner`.
  Consumes (Task 3): `EMPLOYEE_API_BASE_URL`, `provideEmployeeApiTesting`.
- Produces:
  - `export const EMPLOYEE_NAV: PpNavSection[]`
  - `export function routeKeyForUrl(url: string): string`
  - `export function crumbForUrl(url: string): string`
  - `export const routes: Routes`
  - `export const appConfig: ApplicationConfig`
  - `export class App` (selector `pp-root`)
  - `export class HomePage` (selector `pp-home-page`)

- [ ] **Step 1: Write the failing test**

Create `apps/employee-portal/src/app/shell/employee-nav.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';

import { EMPLOYEE_NAV, crumbForUrl, routeKeyForUrl } from './employee-nav';

const items = EMPLOYEE_NAV.flatMap((section) => section.items);

describe('EMPLOYEE_NAV', () => {
  it('lists the eight back-office areas in order', () => {
    expect(items.map((i) => i.label)).toEqual([
      'Home',
      'Trade desk',
      'Customers',
      'Wallets',
      'Settlements',
      'Data & feeds',
      'Reference data',
      'Audit',
    ]);
  });

  it('keeps the specification route keys, not the labels', () => {
    expect(items.map((i) => i.routeKey)).toEqual([
      'home',
      'trade-desk',
      'customers',
      'wallets',
      'settlements',
      'data-feeds',
      'reference-data',
      'audit',
    ]);
  });

  it('enables only Home, Customers and Reference data', () => {
    const enabled = items.filter((i) => i.path !== null).map((i) => i.routeKey);
    expect(enabled).toEqual(['home', 'customers', 'reference-data']);
  });

  it('gives every disabled item a sentence that explains why', () => {
    for (const item of items.filter((i) => i.path === null)) {
      expect(item.disabledReason, `${item.routeKey} needs a reason`).toBeTruthy();
      expect(item.disabledReason!.endsWith('.'), `${item.routeKey} reason is a sentence`)
        .toBe(true);
      expect(item.disabledReason!.length).toBeGreaterThan(20);
    }
  });

  it('gives every enabled item no reason and a real path', () => {
    for (const item of items.filter((i) => i.path !== null)) {
      expect(item.disabledReason).toBeUndefined();
      expect(item.path!.startsWith('/')).toBe(true);
    }
  });

  it('gives every item a domain dot expressed as a token reference', () => {
    for (const item of items) {
      expect(item.dot, `${item.routeKey} needs a dot`).toMatch(/^var\(--pp-[a-z0-9-]+\)$/);
    }
  });

  it('groups the eight rows under one named section', () => {
    expect(EMPLOYEE_NAV.map((section) => section.label)).toEqual(['Back office']);
  });

  it('uses no emoji or icon glyphs in any label', () => {
    for (const item of items) {
      expect(item.label).toMatch(/^[A-Za-z& ]+$/);
    }
  });
});

describe('routeKeyForUrl', () => {
  it('names the route key a URL belongs to, not its label', () => {
    expect(routeKeyForUrl('/customers/abc-123/edit')).toBe('customers');
    expect(routeKeyForUrl('/reference-data/brps')).toBe('reference-data');
  });

  it('falls back to home for an unknown URL', () => {
    expect(routeKeyForUrl('/nowhere')).toBe('home');
    expect(routeKeyForUrl('/')).toBe('home');
  });
});

describe('crumbForUrl', () => {
  it('names the area a URL belongs to', () => {
    expect(crumbForUrl('/customers')).toBe('Customers');
    expect(crumbForUrl('/customers/abc-123')).toBe('Customers');
    expect(crumbForUrl('/customers/abc-123/edit')).toBe('Customers');
    expect(crumbForUrl('/reference-data/brps')).toBe('Reference data');
    expect(crumbForUrl('/home')).toBe('Home');
  });

  it('ignores a query string', () => {
    expect(crumbForUrl('/customers?q=acme')).toBe('Customers');
  });

  it('falls back to Home for an unknown URL', () => {
    expect(crumbForUrl('/nowhere')).toBe('Home');
    expect(crumbForUrl('/')).toBe('Home');
  });
});
```

Create `apps/employee-portal/src/app/features/home/home-page.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach } from 'vitest';
import { provideEmployeeApiTesting } from '@peakpower-nl/api-client-employee';

import { HomePage } from './home-page';

describe('HomePage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideEmployeeApiTesting(), provideRouter([])],
    });
  });

  it('names the two live areas and every deferred one', async () => {
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Customers');
    expect(text).toContain('Reference data');
    expect(text).toContain('Trade desk');
    expect(text).toContain('Wallets');
    expect(text).toContain('Settlements');
    expect(text).toContain('Data & feeds');
    expect(text).toContain('Audit');
  });

  it('links to the customers area', async () => {
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    await fixture.whenStable();

    const link = (fixture.nativeElement as HTMLElement).querySelector('a[href="/customers"]');
    expect(link).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: FAIL — `Failed to resolve import "./employee-nav"` and `"./home-page"`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/employee-portal/src/app/shell/employee-nav.ts`:

```ts
import type { PpNavItem, PpNavSection } from '@peakpower-nl/shared-ui';

// Labels come from the design system; routeKey keeps the specification's name [DEC-115].
// Every item outside this slice renders disabled WITH the sentence that explains why: a rail
// that is complete and honest looks planned, whereas one that grows between demos looks broken.

// `dot` is required by PpNavItem: the domain colour of the row, a token reference, never a
// literal hex. `disabledReason` is optional and is present exactly on the rows whose path is null.

const ITEMS: PpNavItem[] = [
  {
    routeKey: 'home',
    label: 'Home',
    path: '/home',
    dot: 'var(--pp-blue-500)',
  },
  {
    routeKey: 'trade-desk',
    label: 'Trade desk',
    path: null,
    dot: 'var(--pp-blue-700)',
    disabledReason: 'Trading arrives with feature F05. This slice stops at customer administration.',
  },
  {
    routeKey: 'customers',
    label: 'Customers',
    path: '/customers',
    dot: 'var(--pp-mint)',
  },
  {
    routeKey: 'wallets',
    label: 'Wallets',
    path: null,
    dot: 'var(--pp-teal)',
    disabledReason: 'Wallet movements and the ledger arrive with feature F06. A wallet row is created per customer, but nothing reads it yet.',
  },
  {
    routeKey: 'settlements',
    label: 'Settlements',
    path: null,
    dot: 'var(--pp-amber)',
    disabledReason: 'Surcharges, invoicing and settlement arrive with features F09 and F10.',
  },
  {
    routeKey: 'data-feeds',
    label: 'Data & feeds',
    path: null,
    dot: 'var(--pp-violet)',
    disabledReason: 'Ingestion and the BRP feed arrive with feature F02. Reference data is editable in the meantime.',
  },
  {
    routeKey: 'reference-data',
    label: 'Reference data',
    path: '/reference-data',
    dot: 'var(--pp-blue-300)',
  },
  {
    routeKey: 'audit',
    label: 'Audit',
    path: null,
    dot: 'var(--pp-coral)',
    disabledReason: 'Audit records are written from this slice onwards, but the viewer arrives in Phase 2.',
  },
];

// PpNavSection.label is required, so the single back-office group is named rather than blank.
export const EMPLOYEE_NAV: PpNavSection[] = [{ label: 'Back office', items: ITEMS }];

/**
 * The route key a URL belongs to. `PpAppShell.activeRouteKey` is a required input and is keyed on
 * the specification's route key, never on the label [DEC-115].
 */
export function routeKeyForUrl(url: string): string {
  const firstSegment = url.split('?')[0].split('/').filter(Boolean)[0];
  const match = ITEMS.find((item) => item.routeKey === firstSegment && item.path !== null);
  return match?.routeKey ?? 'home';
}

/**
 * The area a URL belongs to, for the topbar crumb. The shell shows a crumb OR a subtitle, never
 * both, so the pages that want a subtitle pass one and leave the crumb alone.
 */
export function crumbForUrl(url: string): string {
  const key = routeKeyForUrl(url);
  return ITEMS.find((item) => item.routeKey === key)!.label;
}
```

Create `apps/employee-portal/src/app/features/home/home-page.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PpBanner, PpCard } from '@peakpower-nl/shared-ui';

import { EMPLOYEE_NAV } from '../../shell/employee-nav';

@Component({
  selector: 'pp-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PpBanner, PpCard],
  styles: `
    :host { display: grid; gap: 16px; }
    .areas { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
    .areas li { display: grid; grid-template-columns: 160px 1fr; gap: 12px; align-items: baseline; }
    .name { font-weight: 600; }
    .reason { color: var(--pp-text-faint); }
  `,
  template: `
    <pp-banner tone="info" heading="Slice 1 — from sign-up to your connections">
      Two areas are live in the back office: Customers and Reference data. The rest of the rail is
      shown so the shape of the product is visible, and each row states when it arrives.
    </pp-banner>

    <pp-card heading="Live now">
      <ul class="areas">
        <li>
          <span class="name"><a routerLink="/customers">Customers</a></span>
          <span class="reason">
            Companies, their accounts and their metering points — create, edit, deactivate and
            end-date.
          </span>
        </li>
        <li>
          <span class="name"><a routerLink="/reference-data">Reference data</a></span>
          <span class="reason">
            The balance responsible parties a metering point can be assigned to.
          </span>
        </li>
      </ul>
    </pp-card>

    <pp-card heading="Not yet" subtitle="Each row names the feature it waits on">
      <ul class="areas">
        @for (item of deferred; track item.routeKey) {
          <li>
            <span class="name">{{ item.label }}</span>
            <span class="reason">{{ item.disabledReason }}</span>
          </li>
        }
      </ul>
    </pp-card>
  `,
})
export class HomePage {
  protected readonly deferred = EMPLOYEE_NAV.flatMap((section) => section.items).filter(
    (item) => item.path === null,
  );
}
```

Create `apps/employee-portal/src/app/app.routes.ts`:

```ts
import type { Routes } from '@angular/router';

// Feature areas are lazy. Tasks 7 and 12 add the customers and reference-data children.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: 'home',
    title: 'Home · PeakPower back office',
    loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage),
  },
  { path: '**', redirectTo: 'home' },
];
```

Create `apps/employee-portal/src/app/app.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { PpAppShell } from '@peakpower-nl/shared-ui';

import { EMPLOYEE_NAV, crumbForUrl, routeKeyForUrl } from './shell/employee-nav';

// productName and activeRouteKey are both REQUIRED inputs on PpAppShell (shared contract §10.1),
// so they are bound here rather than defaulted inside the shell.
@Component({
  selector: 'pp-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, PpAppShell],
  template: `
    <pp-app-shell
      [sections]="sections"
      [activeRouteKey]="activeRouteKey()"
      productName="PeakPower back office"
      [crumb]="crumb()"
    >
      <router-outlet />
    </pp-app-shell>
  `,
})
export class App {
  private readonly router = inject(Router);

  protected readonly sections = EMPLOYEE_NAV;
  protected readonly crumb = signal(crumbForUrl(this.router.url));
  protected readonly activeRouteKey = signal(routeKeyForUrl(this.router.url));

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        this.crumb.set(crumbForUrl(event.urlAfterRedirects));
        this.activeRouteKey.set(routeKeyForUrl(event.urlAfterRedirects));
      });
  }
}
```

Create `apps/employee-portal/src/app/app.config.ts`:

```ts
import { registerLocaleData } from '@angular/common';
import localeNl from '@angular/common/locales/nl';
import { provideHttpClient, withFetch } from '@angular/common/http';
import {
  LOCALE_ID,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import type { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { EMPLOYEE_API_BASE_URL } from '@peakpower-nl/api-client-employee';

import { routes } from './app.routes';

registerLocaleData(localeNl);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // withComponentInputBinding lets a route parameter arrive as a component input signal,
    // which is how every detail and edit page reads its id.
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
    // Formatting is nl-NL throughout [AS-19]: comma decimal, period thousands.
    { provide: LOCALE_ID, useValue: 'nl-NL' },
    // The dev-server proxy forwards /api to whichever port Aspire gave the employee API.
    { provide: EMPLOYEE_API_BASE_URL, useValue: '/api/v1' },
  ],
};
```

Replace `apps/employee-portal/src/main.ts`:

```ts
import { bootstrapApplication } from '@angular/platform-browser';

import { App } from './app/app';
import { appConfig } from './app/app.config';

bootstrapApplication(App, appConfig).catch((error: unknown) => console.error(error));
```

Create `apps/employee-portal/proxy.conf.mjs`:

```js
// Aspire hands an npm app the URLs of the resources it depends on as environment variables named
// services__<resource>__<scheme>__<index>. That name contains a dash, which is a legal
// environment-variable name on every platform we run on but is not a legal JavaScript
// identifier — hence the bracket lookup.
const target =
  process.env['services__employee-api__http__0'] ??
  process.env.EMPLOYEE_API_URL ??
  'http://localhost:5102';

export default {
  '/api': {
    target,
    secure: false,
    changeOrigin: true,
  },
};
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: PASS — 13 tests in `employee-nav.spec.ts` and 2 in `home-page.spec.ts`.

- [ ] **Step 5: See it in a browser**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npm run start:employee-portal
```

Open `http://localhost:4201`. Expected: the 236px rail with eight rows, five of them visibly
disabled; the topbar reading `Home`; the two cards on the home page. Stop the server with
Ctrl-C.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/employee-portal
git commit -m "feat(employee-portal): bootstrap the shell and the back-office navigation"
```

---

## Task 7: Customers list

The first live screen: every company PeakPower has, searchable, each with its status.

Search is server-side — the API takes `?q=` and matches legal name, trade name and KvK number.
The request is driven straight off the search signal with no debounce, and that is deliberate
rather than an omission: `httpResource` aborts the in-flight request whenever its request
signal changes, so typing produces one completed round trip (the last one) and a string of
cancelled ones. A debounce would trade a little network for a little latency; at six companies
neither is worth the extra moving part.

**Files:**
- Create: `apps/employee-portal/src/app/features/customers/customers.routes.ts`
- Create: `apps/employee-portal/src/app/features/customers/customer-list-page.ts`
- Modify: `apps/employee-portal/src/app/app.routes.ts`
- Test: `apps/employee-portal/src/app/features/customers/customer-list-page.spec.ts`

**Interfaces:**
- Consumes (Task 3): `EmployeeApiClient.customersUrl()`, `CustomerListItem`,
  `CustomerListResponse`, `provideEmployeeApiTesting()`.
  Consumes (Task 5): `customerStatusLabel`, `customerStatusTone`.
  Consumes (Plan 3): `PpBadge`, `PpButton`, `PpCard`, `PpGridTable`, `PpGridHead`, `PpGridRow`,
  `PpSearchInput`.
- Produces:
  - `export const CUSTOMERS_ROUTES: Routes`
  - `export class CustomerListPage` (selector `pp-customer-list-page`) with
    `readonly search: WritableSignal<string>` and `readonly rows: Signal<CustomerListItem[]>`

- [ ] **Step 1: Write the failing test**

Create `apps/employee-portal/src/app/features/customers/customer-list-page.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  provideEmployeeApiTesting,
  type CustomerListResponse,
} from '@peakpower-nl/api-client-employee';

import { CustomerListPage } from './customer-list-page';

const TWO_CUSTOMERS: CustomerListResponse = {
  items: [
    {
      id: 'c1',
      legalName: 'Acme Energie B.V.',
      tradeName: 'Acme',
      kvkNumber: '12345678',
      status: 'ACTIVE',
      city: 'Utrecht',
      accountCount: 3,
      meteringPointCount: 2,
    },
    {
      id: 'c2',
      legalName: 'Batavia Staal N.V.',
      tradeName: null,
      kvkNumber: '87654321',
      status: 'SUSPENDED',
      city: 'Rotterdam',
      accountCount: 1,
      meteringPointCount: 0,
    },
  ],
  total: 2,
} as CustomerListResponse;

const EMPTY: CustomerListResponse = { items: [], total: 0 } as CustomerListResponse;

describe('CustomerListPage', () => {
  let fixture: ComponentFixture<CustomerListPage>;
  let http: HttpTestingController;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text() {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideEmployeeApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CustomerListPage);
  });

  afterEach(() => http.verify());

  it('loads the customer list on first render', async () => {
    await settle();
    const req = http.expectOne((r) => r.url === '/api/v1/customers');
    expect(req.request.method).toBe('GET');
    req.flush(TWO_CUSTOMERS);
    await settle();

    expect(text()).toContain('Acme Energie B.V.');
    expect(text()).toContain('Batavia Staal N.V.');
  });

  it('renders the status as a sentence-case badge, never the wire value', async () => {
    await settle();
    http.expectOne((r) => r.url === '/api/v1/customers').flush(TWO_CUSTOMERS);
    await settle();

    expect(text()).toContain('Active');
    expect(text()).toContain('Suspended');
    expect(text()).not.toContain('SUSPENDED');
  });

  it('sends the search term to the API', async () => {
    await settle();
    http.expectOne((r) => r.url === '/api/v1/customers').flush(TWO_CUSTOMERS);
    await settle();

    fixture.componentInstance.search.set('batavia');
    await settle();

    const req = http.expectOne((r) => r.url === '/api/v1/customers' && r.params.get('q') === 'batavia');
    req.flush({ items: [TWO_CUSTOMERS.items[1]], total: 1 } as CustomerListResponse);
    await settle();

    expect(text()).toContain('Batavia Staal N.V.');
    expect(text()).not.toContain('Acme Energie B.V.');
  });

  it('names the search term in the empty state', async () => {
    await settle();
    http.expectOne((r) => r.url === '/api/v1/customers').flush(EMPTY);
    await settle();

    fixture.componentInstance.search.set('zzz');
    await settle();
    http.expectOne((r) => r.params.get('q') === 'zzz').flush(EMPTY);
    await settle();

    expect(text()).toContain('No customers match');
    expect(text()).toContain('zzz');
  });

  it('never renders a grid table with zero rows', async () => {
    await settle();
    http.expectOne((r) => r.url === '/api/v1/customers').flush(EMPTY);
    await settle();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('pp-grid-table')).toBeNull();
    expect(text()).toContain('No customers yet');
  });

  it('names the reason when the request fails', async () => {
    await settle();
    http
      .expectOne((r) => r.url === '/api/v1/customers')
      .flush({ title: 'Service unavailable' }, { status: 503, statusText: 'Service Unavailable' });
    await settle();

    expect(text()).toContain('could not be loaded');
  });

  it('links each row to the customer detail screen', async () => {
    await settle();
    http.expectOne((r) => r.url === '/api/v1/customers').flush(TWO_CUSTOMERS);
    await settle();

    const link = (fixture.nativeElement as HTMLElement).querySelector('a[href="/customers/c1"]');
    expect(link).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: FAIL — `Failed to resolve import "./customer-list-page"`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/employee-portal/src/app/features/customers/customer-list-page.ts`:

```ts
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  PpBadge,
  PpButton,
  PpCard,
  PpGridHead,
  PpGridRow,
  PpGridTable,
  PpSearchInput,
} from '@peakpower-nl/shared-ui';
import {
  EmployeeApiClient,
  type CustomerListItem,
  type CustomerListResponse,
} from '@peakpower-nl/api-client-employee';

import { customerStatusLabel, customerStatusTone } from '../../shared/labels';

@Component({
  selector: 'pp-customer-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    PpBadge,
    PpButton,
    PpCard,
    PpGridHead,
    PpGridRow,
    PpGridTable,
    PpSearchInput,
  ],
  styles: `
    :host { display: grid; gap: 16px; }
    .toolbar { display: flex; align-items: center; gap: 12px; justify-content: space-between; }
    .count { color: var(--pp-text-faint); font-size: 11.5px; }
    .empty { margin: 0; color: var(--pp-text-faint); }
    .chevron { justify-self: end; }
  `,
  template: `
    <div class="toolbar">
      <pp-search-input
        [(value)]="search"
        placeholder="Search by company name or KvK number"
      />
      <a routerLink="/customers/new">
        <pp-button variant="primary">New customer</pp-button>
      </a>
    </div>

    @if (customers.error()) {
      <pp-card heading="Customers">
        <p class="empty">
          The customer list could not be loaded. The employee API did not answer; try again, and
          check that it is running.
        </p>
      </pp-card>
    } @else if (customers.isLoading()) {
      <pp-card heading="Customers">
        <p class="empty">Loading customers…</p>
      </pp-card>
    } @else if (rows().length > 0) {
      <pp-card heading="Customers">
        <span class="count">{{ total() }} companies</span>
        <pp-grid-table columns="2.2fr 1fr 1fr 0.8fr 0.8fr 0.9fr 24px">
          <div ppGridHead>
            <span>Company</span>
            <span>KvK number</span>
            <span>City</span>
            <span>Accounts</span>
            <span>Connections</span>
            <span>Status</span>
            <span></span>
          </div>
          @for (customer of rows(); track customer.id) {
            <div ppGridRow>
              <a [routerLink]="['/customers', customer.id]">{{ customer.legalName }}</a>
              <span>{{ customer.kvkNumber }}</span>
              <span>{{ customer.city }}</span>
              <span>{{ customer.accountCount }}</span>
              <span>{{ customer.meteringPointCount }}</span>
              <span>
                <pp-badge [tone]="tone(customer.status)">{{ label(customer.status) }}</pp-badge>
              </span>
              <a class="chevron" [routerLink]="['/customers', customer.id]">›</a>
            </div>
          }
        </pp-grid-table>
      </pp-card>
    } @else {
      <pp-card heading="Customers">
        <p class="empty">{{ emptyReason() }}</p>
      </pp-card>
    }
  `,
})
export class CustomerListPage {
  private readonly api = inject(EmployeeApiClient);

  readonly search = signal('');

  /**
   * httpResource re-issues whenever the request signal changes and aborts the previous request,
   * so typing costs cancelled round trips rather than a queue of stale responses.
   */
  readonly customers = httpResource<CustomerListResponse>(() => ({
    url: this.api.customersUrl(),
    params: { q: this.search().trim() },
  }));

  readonly rows = computed<CustomerListItem[]>(() => this.customers.value()?.items ?? []);
  readonly total = computed(() => this.customers.value()?.total ?? 0);

  readonly emptyReason = computed(() => {
    const term = this.search().trim();
    return term.length > 0
      ? `No customers match “${term}”. Clear the search to see every company.`
      : 'No customers yet. Use New customer to add the first one.';
  });

  protected readonly label = customerStatusLabel;
  protected readonly tone = customerStatusTone;
}
```

Create `apps/employee-portal/src/app/features/customers/customers.routes.ts`:

```ts
import type { Routes } from '@angular/router';

// Tasks 8, 9, 10 and 11 add the detail, form, account and metering-point children.
export const CUSTOMERS_ROUTES: Routes = [
  {
    path: '',
    title: 'Customers · PeakPower back office',
    loadComponent: () => import('./customer-list-page').then((m) => m.CustomerListPage),
  },
];
```

Modify `apps/employee-portal/src/app/app.routes.ts` — insert the customers route before the
wildcard, leaving the rest of the file exactly as Task 6 wrote it:

```ts
import type { Routes } from '@angular/router';

// Feature areas are lazy. Task 12 adds the reference-data children.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: 'home',
    title: 'Home · PeakPower back office',
    loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage),
  },
  {
    path: 'customers',
    loadChildren: () =>
      import('./features/customers/customers.routes').then((m) => m.CUSTOMERS_ROUTES),
  },
  { path: '**', redirectTo: 'home' },
];
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: PASS — 7 tests in `customer-list-page.spec.ts`.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/employee-portal/src/app/app.routes.ts \
  apps/employee-portal/src/app/features/customers
git commit -m "feat(employee-portal): add the customers list with server-side search"
```

---

## Task 8: Customer detail

One request returns the company, its accounts and its metering points, so this screen is one
`httpResource`. The design system specifies a two-column split for detail screens —
`1.6fr 1fr` — with the working tables in the wide column and the company panel in the narrow one.

The **admin flag** in the accounts table is `[DEC-71]`: `is_admin` and `four_eyes_enabled` ship
in Phase 1 as columns that nothing reads until Phase 2, because retrofitting a role onto live
accounts is worse than shipping an unused column. The portal displays them for the same reason —
an invisible column is a column nobody notices is wrong.

Both edit links point at routes nested under the customer — `/customers/:customerId/accounts/:accountId/edit`,
not `/accounts/:accountId/edit`. The employee API has `PATCH /accounts/{id}` but **no
`GET /accounts/{id}`**, so the only way to read one account is to read the customer that owns it.
Nesting the route means the edit page has the customer id it needs to do that. The same holds for
metering points.

**Files:**
- Create: `apps/employee-portal/src/app/features/customers/customer-detail-page.ts`
- Modify: `apps/employee-portal/src/app/features/customers/customers.routes.ts`
- Test: `apps/employee-portal/src/app/features/customers/customer-detail-page.spec.ts`

**Interfaces:**
- Consumes (Task 3): `EmployeeApiClient.customerUrl(id)`, `CustomerDetail`, `Account`,
  `MeteringPoint`, `provideEmployeeApiTesting()`.
  Consumes (Task 5): `customerStatusLabel`, `customerStatusTone`, `accountStatusLabel`,
  `accountStatusTone`, `productionExpectationLabel`, `expectationSourceLabel`.
  Consumes (Plan 3): `PpBadge`, `PpButton`, `PpCard`, `PpGridTable`, `PpGridHead`, `PpGridRow`.
- Produces:
  - `export const DETAIL_GRID = '1.6fr 1fr'`
  - `export class CustomerDetailPage` (selector `pp-customer-detail-page`) with
    `readonly customerId = input.required<string>()` and
    `readonly customer = httpResource<CustomerDetail>(…)`

- [ ] **Step 1: Write the failing test**

Create `apps/employee-portal/src/app/features/customers/customer-detail-page.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  provideEmployeeApiTesting,
  type CustomerDetail,
} from '@peakpower-nl/api-client-employee';

import { CustomerDetailPage, DETAIL_GRID } from './customer-detail-page';

const ACME = {
  id: 'c1',
  legalName: 'Acme Energie B.V.',
  tradeName: 'Acme',
  kvkNumber: '12345678',
  vatNumber: 'NL001234567B01',
  status: 'ACTIVE',
  fourEyesEnabled: true,
  locale: 'nl-NL',
  internalReference: 'CRM-4471',
  billingAddress: {
    street: 'Keizersgracht',
    houseNumber: '117',
    houseNumberSuffix: null,
    postalCode: '1015 CJ',
    city: 'Amsterdam',
    country: 'NL',
  },
  visitingAddress: null,
  primaryContact: { name: 'Jan Jansen', email: 'jan@acme.nl', phone: '+31 20 123 4567' },
  accounts: [
    {
      id: 'a1',
      customerId: 'c1',
      username: 'j.jansen',
      firstName: 'Jan',
      lastName: 'Jansen',
      jobTitle: 'Head of energy',
      email: 'jan@acme.nl',
      phone: null,
      status: 'ACTIVE',
      isAdmin: true,
      lastLoginAt: '2026-08-25T08:14:00+02:00',
    },
    {
      id: 'a2',
      customerId: 'c1',
      username: 'p.pietersen',
      firstName: 'Piet',
      lastName: 'Pietersen',
      jobTitle: null,
      email: 'piet@acme.nl',
      phone: null,
      status: 'PENDING_APPROVAL',
      isAdmin: false,
      lastLoginAt: null,
    },
  ],
  meteringPoints: [
    {
      id: 'm1',
      customerId: 'c1',
      ean: '871687110000000123',
      eanDisplay: '8716 8711 0000 0001 23',
      commodity: 'ELECTRICITY',
      brpId: 'b1',
      brpName: 'PVNed',
      productionExpectation: 'EXPECTED',
      expectationSource: 'CONTRACT',
      name: 'Rooftop Amsterdam',
      description: null,
      gridOperator: 'Liander',
      capacityKw: 1250.5,
      address: null,
      validFrom: '2026-01-01',
      validTo: null,
      displayLabel: 'Rooftop Amsterdam',
    },
  ],
} as unknown as CustomerDetail;

const NO_CHILDREN = { ...ACME, accounts: [], meteringPoints: [] } as CustomerDetail;

describe('CustomerDetailPage', () => {
  let fixture: ComponentFixture<CustomerDetailPage>;
  let http: HttpTestingController;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function element() {
    return fixture.nativeElement as HTMLElement;
  }

  function text() {
    return element().textContent ?? '';
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideEmployeeApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CustomerDetailPage);
    fixture.componentRef.setInput('customerId', 'c1');
  });

  afterEach(() => http.verify());

  it('loads the customer by id', async () => {
    await settle();
    const req = http.expectOne('/api/v1/customers/c1');
    expect(req.request.method).toBe('GET');
    req.flush(ACME);
    await settle();
    expect(text()).toContain('Acme Energie B.V.');
  });

  it('lays the screen out as the design system 1.6fr / 1fr detail grid', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush(ACME);
    await settle();

    expect(DETAIL_GRID).toBe('1.6fr 1fr');
    const layout = element().querySelector<HTMLElement>('.detail');
    expect(layout).not.toBeNull();
    expect(layout!.style.gridTemplateColumns).toBe('1.6fr 1fr');
  });

  it('shows the company panel fields', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush(ACME);
    await settle();

    expect(text()).toContain('12345678');
    expect(text()).toContain('NL001234567B01');
    expect(text()).toContain('CRM-4471');
    expect(text()).toContain('Keizersgracht');
    expect(text()).toContain('Jan Jansen');
    expect(text()).toContain('Four-eyes approval');
  });

  it('marks the admin account and only the admin account', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush(ACME);
    await settle();

    const adminBadges = element().querySelectorAll('[data-testid="admin-flag"]');
    expect(adminBadges).toHaveLength(1);
    expect(adminBadges[0].textContent).toContain('Admin');
  });

  it('renders account statuses in sentence case', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush(ACME);
    await settle();

    expect(text()).toContain('Pending approval');
    expect(text()).not.toContain('PENDING_APPROVAL');
  });

  it('shows the grouped EAN and the BRP for each metering point', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush(ACME);
    await settle();

    expect(text()).toContain('8716 8711 0000 0001 23');
    expect(text()).toContain('PVNed');
    expect(text()).toContain('Production expected');
    expect(text()).toContain('Rooftop Amsterdam');
  });

  it('shows an open-ended validity as Open rather than an empty cell', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush(ACME);
    await settle();
    expect(text()).toContain('Open');
  });

  it('replaces each empty table with a card that names the reason', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush(NO_CHILDREN);
    await settle();

    expect(element().querySelectorAll('pp-grid-table')).toHaveLength(0);
    expect(text()).toContain('No accounts yet');
    expect(text()).toContain('No connections yet');
  });

  it('names the reason when the customer cannot be loaded', async () => {
    await settle();
    http
      .expectOne('/api/v1/customers/c1')
      .flush({ title: 'Not Found' }, { status: 404, statusText: 'Not Found' });
    await settle();

    expect(text()).toContain('could not be loaded');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: FAIL — `Failed to resolve import "./customer-detail-page"`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/employee-portal/src/app/features/customers/customer-detail-page.ts`:

```ts
import { DecimalPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  PpBadge,
  PpButton,
  PpCard,
  PpGridHead,
  PpGridRow,
  PpGridTable,
} from '@peakpower-nl/shared-ui';
import {
  EmployeeApiClient,
  type Account,
  type CustomerDetail,
  type MeteringPoint,
} from '@peakpower-nl/api-client-employee';

import {
  accountStatusLabel,
  accountStatusTone,
  customerStatusLabel,
  customerStatusTone,
  expectationSourceLabel,
  productionExpectationLabel,
} from '../../shared/labels';

/**
 * The design system's detail-screen split: working tables in the wide column, the identity panel
 * in the narrow one. It is bound as an inline style rather than written in the stylesheet so the
 * layout rule is a value the component owns and a test can assert.
 */
export const DETAIL_GRID = '1.6fr 1fr';

@Component({
  selector: 'pp-customer-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    RouterLink,
    PpBadge,
    PpButton,
    PpCard,
    PpGridHead,
    PpGridRow,
    PpGridTable,
  ],
  styles: `
    :host { display: block; }
    .detail { display: grid; gap: 16px; align-items: start; }
    .column { display: grid; gap: 16px; }
    .head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .head h1 { font-size: 18px; font-weight: 700; margin: 0; }
    .facts { display: grid; grid-template-columns: 1fr; gap: 10px; margin: 0; }
    .facts div { display: grid; gap: 2px; }
    .facts dt { color: var(--pp-text-faint); font-size: 11px; }
    .facts dd { margin: 0; }
    .empty { margin: 0; color: var(--pp-text-faint); }
    .actions { display: flex; gap: 8px; }
  `,
  template: `
    @if (customer.error()) {
      <pp-card heading="Customer">
        <p class="empty">
          This customer could not be loaded. It may have been removed, or the employee API did not
          answer.
        </p>
      </pp-card>
    } @else if (customer.isLoading()) {
      <pp-card heading="Customer"><p class="empty">Loading customer…</p></pp-card>
    } @else if (company(); as c) {
      <div class="head">
        <h1>{{ c.legalName }}</h1>
        <pp-badge [tone]="companyTone(c.status)">{{ companyLabel(c.status) }}</pp-badge>
      </div>

      <div class="detail" [style.grid-template-columns]="detailGrid">
        <div class="column">
          <pp-card heading="Accounts" subtitle="People who can sign in for this company">
            <div class="actions">
              <a [routerLink]="['/customers', c.id, 'accounts', 'new']">
                <pp-button size="sm">New account</pp-button>
              </a>
            </div>
            @if (accounts().length > 0) {
              <pp-grid-table columns="1.4fr 1.1fr 1.6fr 0.8fr 1fr 0.8fr" density="dense">
                <div ppGridHead>
                  <span>Name</span>
                  <span>Username</span>
                  <span>Email</span>
                  <span>Role</span>
                  <span>Status</span>
                  <span></span>
                </div>
                @for (account of accounts(); track account.id) {
                  <div ppGridRow>
                    <span>{{ account.firstName }} {{ account.lastName }}</span>
                    <span>{{ account.username }}</span>
                    <span>{{ account.email }}</span>
                    <span>
                      @if (account.isAdmin) {
                        <pp-badge data-testid="admin-flag" tone="info">Admin</pp-badge>
                      } @else {
                        <span class="empty">User</span>
                      }
                    </span>
                    <span>
                      <pp-badge [tone]="accountTone(account.status)">
                        {{ accountLabel(account.status) }}
                      </pp-badge>
                    </span>
                    <span class="actions">
                      <a [routerLink]="['/customers', c.id, 'accounts', account.id, 'edit']">
                        <pp-button size="sm">Edit</pp-button>
                      </a>
                    </span>
                  </div>
                }
              </pp-grid-table>
            } @else {
              <p class="empty">
                No accounts yet. Use New account to invite the first person at this company.
              </p>
            }
          </pp-card>

          <pp-card heading="Connections" subtitle="Metering points attached to this company">
            <div class="actions">
              <a [routerLink]="['/customers', c.id, 'metering-points', 'new']">
                <pp-button size="sm">Attach connection</pp-button>
              </a>
            </div>
            @if (meteringPoints().length > 0) {
              <pp-grid-table
                columns="1.6fr 1.5fr 0.9fr 1.2fr 0.8fr 0.8fr 0.9fr"
                density="dense"
              >
                <div ppGridHead>
                  <span>Name</span>
                  <span>EAN</span>
                  <span>BRP</span>
                  <span>Production</span>
                  <span>Capacity kW</span>
                  <span>Valid from</span>
                  <span>Valid to</span>
                </div>
                @for (point of meteringPoints(); track point.id) {
                  <div ppGridRow>
                    <a
                      [routerLink]="['/customers', c.id, 'metering-points', point.id, 'edit']"
                    >
                      {{ point.displayLabel }}
                    </a>
                    <span>{{ point.eanDisplay }}</span>
                    <span>{{ point.brpName }}</span>
                    <span>
                      {{ expectationLabel(point.productionExpectation) }}
                      <br />
                      <span class="empty">{{ sourceLabel(point.expectationSource) }}</span>
                    </span>
                    <span>
                      @if (point.capacityKw !== null && point.capacityKw !== undefined) {
                        {{ point.capacityKw | number: '1.0-2' }}
                      } @else {
                        <span class="empty">Not recorded</span>
                      }
                    </span>
                    <span>{{ point.validFrom }}</span>
                    <span>
                      @if (point.validTo) {
                        {{ point.validTo }}
                      } @else {
                        Open
                      }
                    </span>
                  </div>
                }
              </pp-grid-table>
            } @else {
              <p class="empty">
                No connections yet. Use Attach connection to add the company's first metering
                point.
              </p>
            }
          </pp-card>
        </div>

        <div class="column">
          <pp-card heading="Company">
            <div class="actions">
              <a [routerLink]="['/customers', c.id, 'edit']">
                <pp-button size="sm" variant="primary">Edit company</pp-button>
              </a>
            </div>
            <dl class="facts">
              <div><dt>Legal name</dt><dd>{{ c.legalName }}</dd></div>
              <div>
                <dt>Trade name</dt>
                <dd>{{ c.tradeName ?? 'Not recorded' }}</dd>
              </div>
              <div><dt>KvK number</dt><dd>{{ c.kvkNumber }}</dd></div>
              <div><dt>VAT number</dt><dd>{{ c.vatNumber ?? 'Not recorded' }}</dd></div>
              <div>
                <dt>Internal reference</dt>
                <dd>{{ c.internalReference ?? 'Not recorded' }}</dd>
              </div>
              <div><dt>Locale</dt><dd>{{ c.locale }}</dd></div>
              <div>
                <dt>Four-eyes approval</dt>
                <dd>{{ c.fourEyesEnabled ? 'Enabled' : 'Disabled' }}</dd>
              </div>
              <div>
                <dt>Billing address</dt>
                <dd>
                  {{ c.billingAddress.street }} {{ c.billingAddress.houseNumber
                  }}{{ c.billingAddress.houseNumberSuffix ?? '' }}<br />
                  {{ c.billingAddress.postalCode }} {{ c.billingAddress.city }}<br />
                  {{ c.billingAddress.country }}
                </dd>
              </div>
              <div>
                <dt>Visiting address</dt>
                <dd>
                  @if (c.visitingAddress; as v) {
                    {{ v.street }} {{ v.houseNumber }}{{ v.houseNumberSuffix ?? '' }}<br />
                    {{ v.postalCode }} {{ v.city }}
                  } @else {
                    Same as the billing address
                  }
                </dd>
              </div>
              <div>
                <dt>Primary contact</dt>
                <dd>
                  {{ c.primaryContact.name }}<br />
                  {{ c.primaryContact.email }}<br />
                  {{ c.primaryContact.phone ?? 'No phone recorded' }}
                </dd>
              </div>
            </dl>
          </pp-card>
        </div>
      </div>
    }
  `,
})
export class CustomerDetailPage {
  private readonly api = inject(EmployeeApiClient);

  /** Bound from the route parameter by withComponentInputBinding. */
  readonly customerId = input.required<string>();

  readonly customer = httpResource<CustomerDetail>(() => this.api.customerUrl(this.customerId()));

  readonly company = computed<CustomerDetail | undefined>(() => this.customer.value());
  readonly accounts = computed<Account[]>(() => this.customer.value()?.accounts ?? []);
  readonly meteringPoints = computed<MeteringPoint[]>(
    () => this.customer.value()?.meteringPoints ?? [],
  );

  protected readonly detailGrid = DETAIL_GRID;
  protected readonly companyLabel = customerStatusLabel;
  protected readonly companyTone = customerStatusTone;
  protected readonly accountLabel = accountStatusLabel;
  protected readonly accountTone = accountStatusTone;
  protected readonly expectationLabel = productionExpectationLabel;
  protected readonly sourceLabel = expectationSourceLabel;
}
```

Modify `apps/employee-portal/src/app/features/customers/customers.routes.ts` to the full file
below — the `''` route is unchanged from Task 7, the `:customerId` route is new:

```ts
import type { Routes } from '@angular/router';

// Tasks 9, 10 and 11 add the form, account and metering-point children.
export const CUSTOMERS_ROUTES: Routes = [
  {
    path: '',
    title: 'Customers · PeakPower back office',
    loadComponent: () => import('./customer-list-page').then((m) => m.CustomerListPage),
  },
  {
    path: ':customerId',
    title: 'Customer · PeakPower back office',
    loadComponent: () => import('./customer-detail-page').then((m) => m.CustomerDetailPage),
  },
];
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: PASS — 9 tests in `customer-detail-page.spec.ts`.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/employee-portal/src/app/features/customers
git commit -m "feat(employee-portal): add the customer detail screen"
```

---

## Task 9: Create and edit a customer

One component serves both `/customers/new` and `/customers/:customerId/edit`, because the fields,
the mapping and the error handling are identical and only the verb differs.

The form is **strictly typed**: every control is declared with its value type, so a typo in a
control name is a compile error rather than a silent `undefined` at runtime. That is what
`FormGroup<{ … }>` with `FormControl<string>` buys, and it is the reason Angular's untyped
`FormBuilder.group({})` is not used anywhere in this plan.

The form deliberately carries **no client-side KvK rule**. A KvK number is the eight-digit Dutch
Chamber of Commerce registration number, and that rule already exists in
`PeakPower.Domain.Common.KvkNumber`; a second copy in TypeScript would drift from the first. The
API returns RFC 7807 and Task 4's `applyProblemDetails` puts each message on its control.

The two verbs do **not** send the same body. `CreateCustomerRequest` carries `kvkNumber` and no
status; `UpdateCustomerRequest` carries `status` and **no** `kvkNumber`, because a KvK number is
immutable once the company is registered and status is the one thing an employee changes after
the fact. The form therefore renders the KvK control read-only in edit mode and the status select
only in edit mode, and `toRequest()` has one arm per verb.

**Files:**
- Create: `apps/employee-portal/src/app/shared/form-field.ts`
- Create: `apps/employee-portal/src/app/shared/address-fields.ts`
- Create: `apps/employee-portal/src/app/features/customers/customer-form-page.ts`
- Modify: `apps/employee-portal/src/app/features/customers/customers.routes.ts`
- Test: `apps/employee-portal/src/app/features/customers/customer-form-page.spec.ts`

**Interfaces:**
- Consumes (Task 3): `EmployeeApiClient.createCustomer/updateCustomer/getCustomer`,
  `isValidationProblem`, `CustomerDetail`, `CreateCustomerRequest`, `UpdateCustomerRequest`.
  Consumes (Task 4): `applyProblemDetails`, `serverError`.
  Consumes (Task 5): `CUSTOMER_STATUS_OPTIONS`.
  Consumes (Plan 3): `PpBanner`, `PpButton`, `PpCard`.
- Produces:
  - `export class PpFormField` (selector `pp-form-field`) with inputs `label`, `for`, `hint`,
    `error`
  - `export type AddressFormGroup = FormGroup<{ street: FormControl<string>; houseNumber: FormControl<string>; houseNumberSuffix: FormControl<string>; postalCode: FormControl<string>; city: FormControl<string>; country: FormControl<string> }>`
  - `export function buildAddressGroup(): AddressFormGroup`
  - `export class PpAddressFields` (selector `pp-address-fields`) with inputs `group`, `idPrefix`,
    `pathPrefix`
  - `export class CustomerFormPage` (selector `pp-customer-form-page`) with
    `readonly customerId = input<string | undefined>()`

- [ ] **Step 1: Write the failing test**

Create `apps/employee-portal/src/app/features/customers/customer-form-page.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  provideEmployeeApiTesting,
  type CustomerDetail,
} from '@peakpower-nl/api-client-employee';

import { CustomerFormPage } from './customer-form-page';

const EXISTING = {
  id: 'c1',
  legalName: 'Acme Energie B.V.',
  tradeName: 'Acme',
  kvkNumber: '12345678',
  vatNumber: 'NL001234567B01',
  status: 'ACTIVE',
  fourEyesEnabled: false,
  locale: 'nl-NL',
  internalReference: 'CRM-4471',
  billingAddress: {
    street: 'Keizersgracht',
    houseNumber: '117',
    houseNumberSuffix: null,
    postalCode: '1015 CJ',
    city: 'Amsterdam',
    country: 'NL',
  },
  visitingAddress: null,
  primaryContact: { name: 'Jan Jansen', email: 'jan@acme.nl', phone: null },
  accounts: [],
  meteringPoints: [],
} as unknown as CustomerDetail;

function fillMinimum(page: CustomerFormPage) {
  page.form.patchValue({
    legalName: 'Nieuwe Energie B.V.',
    kvkNumber: '123',
    locale: 'nl-NL',
    billingAddress: {
      street: 'Damrak',
      houseNumber: '1',
      houseNumberSuffix: '',
      postalCode: '1012 LG',
      city: 'Amsterdam',
      country: 'NL',
    },
    primaryContact: { name: 'Ada Boers', email: 'ada@nieuwe.nl', phone: '' },
  });
}

describe('CustomerFormPage — create', () => {
  let fixture: ComponentFixture<CustomerFormPage>;
  let http: HttpTestingController;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text() {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideEmployeeApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CustomerFormPage);
    await settle();
  });

  afterEach(() => http.verify());

  it('issues no request while creating', () => {
    http.expectNone(() => true);
  });

  it('applies no client-side rule to the KvK number', () => {
    fillMinimum(fixture.componentInstance);
    expect(fixture.componentInstance.form.controls.kvkNumber.valid).toBe(true);
    expect(fixture.componentInstance.form.valid).toBe(true);
  });

  it('POSTs the mapped request, sending null rather than empty strings', async () => {
    fillMinimum(fixture.componentInstance);
    fixture.componentInstance.submit();
    await settle();

    const req = http.expectOne('/api/v1/customers');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      legalName: 'Nieuwe Energie B.V.',
      kvkNumber: '123',
      tradeName: null,
      vatNumber: null,
      internalReference: null,
      locale: 'nl-NL',
      primaryContact: { name: 'Ada Boers', email: 'ada@nieuwe.nl', phone: null },
    });
    expect(req.request.body.billingAddress.houseNumberSuffix).toBeNull();
    req.flush(EXISTING);
  });

  it('puts a KvK problem detail on the KvK control and shows it', async () => {
    fillMinimum(fixture.componentInstance);
    fixture.componentInstance.submit();
    await settle();

    http.expectOne('/api/v1/customers').flush(
      {
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: { kvkNumber: ['KvK number must be exactly 8 digits.'] },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle();

    expect(fixture.componentInstance.form.controls.kvkNumber.valid).toBe(false);
    expect(text()).toContain('KvK number must be exactly 8 digits.');
  });

  it('sends no status when creating — a new company is always a prospect', async () => {
    fillMinimum(fixture.componentInstance);
    fixture.componentInstance.submit();
    await settle();

    const req = http.expectOne('/api/v1/customers');
    expect('status' in req.request.body).toBe(false);
    req.flush(EXISTING);
  });

  it('shows a message that matches no control in a banner', async () => {
    fillMinimum(fixture.componentInstance);
    fixture.componentInstance.submit();
    await settle();

    http.expectOne('/api/v1/customers').flush(
      { status: 409, errors: { '': ['A customer with this KvK number already exists.'] } },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();

    expect(text()).toContain('A customer with this KvK number already exists.');
  });

  it('names the reason when the server fails without a problem document', async () => {
    fillMinimum(fixture.componentInstance);
    fixture.componentInstance.submit();
    await settle();

    http
      .expectOne('/api/v1/customers')
      .flush('boom', { status: 500, statusText: 'Internal Server Error' });
    await settle();

    expect(text()).toContain('could not be saved');
  });
});

describe('CustomerFormPage — edit', () => {
  let fixture: ComponentFixture<CustomerFormPage>;
  let http: HttpTestingController;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideEmployeeApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CustomerFormPage);
    fixture.componentRef.setInput('customerId', 'c1');
  });

  afterEach(() => http.verify());

  it('loads the customer and fills the form', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush(EXISTING);
    await settle();

    expect(fixture.componentInstance.form.controls.legalName.value).toBe('Acme Energie B.V.');
    expect(fixture.componentInstance.form.controls.kvkNumber.value).toBe('12345678');
    expect(fixture.componentInstance.form.controls.billingAddress.controls.city.value)
      .toBe('Amsterdam');
    expect(fixture.componentInstance.form.controls.billingAddress.controls.houseNumberSuffix.value)
      .toBe('');
  });

  it('PATCHes the customer on submit', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush(EXISTING);
    await settle();

    fixture.componentInstance.form.controls.legalName.setValue('Acme Energie N.V.');
    fixture.componentInstance.submit();
    await settle();

    const req = http.expectOne('/api/v1/customers/c1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.legalName).toBe('Acme Energie N.V.');
    req.flush(EXISTING);
  });

  it('sends status and omits kvkNumber on update', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush(EXISTING);
    await settle();

    fixture.componentInstance.form.controls.status.setValue('SUSPENDED');
    fixture.componentInstance.submit();
    await settle();

    const req = http.expectOne('/api/v1/customers/c1');
    expect(req.request.body.status).toBe('SUSPENDED');
    expect('kvkNumber' in req.request.body).toBe(false);
    req.flush(EXISTING);
  });

  it('fills the status control from the loaded customer', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush(EXISTING);
    await settle();

    expect(fixture.componentInstance.form.controls.status.value).toBe('ACTIVE');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: FAIL — `Failed to resolve import "./customer-form-page"`.

- [ ] **Step 3: Write the two shared form components**

Create `apps/employee-portal/src/app/shared/form-field.ts`:

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * One labelled control with its server message underneath. The message always comes from the API
 * (Task 4), so the label and the error live together and no screen formats an error itself.
 */
@Component({
  selector: 'pp-form-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: grid; gap: 4px; }
    label { font-size: 11px; font-weight: 600; color: var(--pp-text-faint); }
    .message { margin: 0; font-size: 11.5px; }
    .error { color: var(--pp-red-text); }
    .hint { color: var(--pp-text-faint); }
  `,
  template: `
    <label [attr.for]="for()">{{ label() }}</label>
    <ng-content />
    @if (error(); as message) {
      <p class="message error">{{ message }}</p>
    } @else if (hint(); as text) {
      <p class="message hint">{{ text }}</p>
    }
  `,
})
export class PpFormField {
  readonly label = input.required<string>();
  readonly for = input<string | null>(null);
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);
}
```

Create `apps/employee-portal/src/app/shared/address-fields.ts`:

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { PpFormField } from './form-field';
import { serverError } from './apply-problem-details';

export type AddressFormGroup = FormGroup<{
  street: FormControl<string>;
  houseNumber: FormControl<string>;
  houseNumberSuffix: FormControl<string>;
  postalCode: FormControl<string>;
  city: FormControl<string>;
  country: FormControl<string>;
}>;

export function buildAddressGroup(): AddressFormGroup {
  return new FormGroup({
    street: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    houseNumber: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    houseNumberSuffix: new FormControl('', { nonNullable: true }),
    postalCode: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    city: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    country: new FormControl('NL', { nonNullable: true, validators: [Validators.required] }),
  });
}

@Component({
  selector: 'pp-address-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, PpFormField],
  styles: `
    :host { display: grid; grid-template-columns: 2fr 0.7fr 0.7fr; gap: 12px; }
    .wide { grid-column: 1 / -1; }
  `,
  template: `
    <div [formGroup]="group()" style="display: contents">
      <pp-form-field
        label="Street"
        [for]="idPrefix() + '-street'"
        [error]="message('street')"
      >
        <input [id]="idPrefix() + '-street'" type="text" formControlName="street" />
      </pp-form-field>
      <pp-form-field
        label="House number"
        [for]="idPrefix() + '-house-number'"
        [error]="message('houseNumber')"
      >
        <input [id]="idPrefix() + '-house-number'" type="text" formControlName="houseNumber" />
      </pp-form-field>
      <pp-form-field
        label="Suffix"
        [for]="idPrefix() + '-suffix'"
        hint="Optional"
        [error]="message('houseNumberSuffix')"
      >
        <input
          [id]="idPrefix() + '-suffix'"
          type="text"
          formControlName="houseNumberSuffix"
        />
      </pp-form-field>
      <pp-form-field
        label="Postal code"
        [for]="idPrefix() + '-postal-code'"
        [error]="message('postalCode')"
      >
        <input [id]="idPrefix() + '-postal-code'" type="text" formControlName="postalCode" />
      </pp-form-field>
      <pp-form-field label="City" [for]="idPrefix() + '-city'" [error]="message('city')">
        <input [id]="idPrefix() + '-city'" type="text" formControlName="city" />
      </pp-form-field>
      <pp-form-field
        label="Country"
        [for]="idPrefix() + '-country'"
        hint="Two-letter code"
        [error]="message('country')"
      >
        <input [id]="idPrefix() + '-country'" type="text" formControlName="country" />
      </pp-form-field>
    </div>
  `,
})
export class PpAddressFields {
  readonly group = input.required<AddressFormGroup>();
  /** Prefix for the generated element ids, so two address blocks on one page stay distinct. */
  readonly idPrefix = input.required<string>();

  protected message(name: keyof AddressFormGroup['controls']): string | null {
    return serverError(this.group().controls[name]);
  }
}
```

- [ ] **Step 4: Write the customer form page**

Create `apps/employee-portal/src/app/features/customers/customer-form-page.ts`:

```ts
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PpBanner, PpButton, PpCard } from '@peakpower-nl/shared-ui';
import {
  EmployeeApiClient,
  isValidationProblem,
  type CreateCustomerRequest,
  type CustomerDetail,
  type CustomerStatusValue,
  type UpdateCustomerRequest,
} from '@peakpower-nl/api-client-employee';

import { applyProblemDetails, serverError } from '../../shared/apply-problem-details';
import { PpAddressFields, buildAddressGroup } from '../../shared/address-fields';
import { PpFormField } from '../../shared/form-field';
import { CUSTOMER_STATUS_OPTIONS } from '../../shared/labels';

@Component({
  selector: 'pp-customer-form-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, PpAddressFields, PpBanner, PpButton, PpCard, PpFormField],
  styles: `
    :host { display: grid; gap: 16px; max-width: 880px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .actions { display: flex; gap: 8px; margin-top: 16px; }
    .empty { margin: 0; color: var(--pp-text-faint); }
  `,
  template: `
    <h1>{{ isEdit() ? 'Edit company' : 'New company' }}</h1>

    @for (message of bannerMessages(); track message) {
      <pp-banner tone="critical" heading="This company was not saved">{{ message }}</pp-banner>
    }

    <form [formGroup]="form" (ngSubmit)="submit()">
      <pp-card heading="Identity">
        <div class="grid">
          <pp-form-field label="Legal name" for="legal-name" [error]="message('legalName')">
            <input id="legal-name" type="text" formControlName="legalName" />
          </pp-form-field>
          <pp-form-field
            label="Trade name"
            for="trade-name"
            hint="Optional"
            [error]="message('tradeName')"
          >
            <input id="trade-name" type="text" formControlName="tradeName" />
          </pp-form-field>
          <pp-form-field
            label="KvK number"
            for="kvk-number"
            [hint]="isEdit()
              ? 'A KvK number cannot be changed once the company is registered.'
              : 'Eight digits, checked by the platform'"
            [error]="message('kvkNumber')"
          >
            <input
              id="kvk-number"
              type="text"
              formControlName="kvkNumber"
              [readOnly]="isEdit()"
            />
          </pp-form-field>
          <pp-form-field
            label="VAT number"
            for="vat-number"
            hint="Optional"
            [error]="message('vatNumber')"
          >
            <input id="vat-number" type="text" formControlName="vatNumber" />
          </pp-form-field>
          @if (isEdit()) {
            <pp-form-field
              label="Status"
              for="status"
              hint="Only an edit changes a status; a new company starts as a prospect."
              [error]="message('status')"
            >
              <select id="status" formControlName="status">
                @for (option of statusOptions; track option.value) {
                  <option [value]="option.value">{{ option.label }}</option>
                }
              </select>
            </pp-form-field>
          }
          <pp-form-field
            label="Internal reference"
            for="internal-reference"
            hint="Optional"
            [error]="message('internalReference')"
          >
            <input id="internal-reference" type="text" formControlName="internalReference" />
          </pp-form-field>
          <pp-form-field label="Locale" for="locale" [error]="message('locale')">
            <input id="locale" type="text" formControlName="locale" />
          </pp-form-field>
        </div>
      </pp-card>

      <pp-card heading="Billing address">
        <pp-address-fields [group]="form.controls.billingAddress" idPrefix="billing" />
      </pp-card>

      <pp-card heading="Primary contact">
        <div class="grid" formGroupName="primaryContact">
          <pp-form-field label="Name" for="contact-name" [error]="message('primaryContact.name')">
            <input id="contact-name" type="text" formControlName="name" />
          </pp-form-field>
          <pp-form-field
            label="Email"
            for="contact-email"
            [error]="message('primaryContact.email')"
          >
            <input id="contact-email" type="email" formControlName="email" />
          </pp-form-field>
          <pp-form-field
            label="Phone"
            for="contact-phone"
            hint="Optional"
            [error]="message('primaryContact.phone')"
          >
            <input id="contact-phone" type="tel" formControlName="phone" />
          </pp-form-field>
        </div>
      </pp-card>

      <div class="actions">
        <pp-button variant="primary" [disabled]="saving()" (click)="submit()">
          {{ isEdit() ? 'Save changes' : 'Create company' }}
        </pp-button>
        <a [routerLink]="cancelTarget()">
          <pp-button>Cancel</pp-button>
        </a>
      </div>
    </form>
  `,
})
export class CustomerFormPage {
  private readonly api = inject(EmployeeApiClient);
  private readonly router = inject(Router);

  /** Absent on /customers/new, present on /customers/:customerId/edit. */
  readonly customerId = input<string | undefined>(undefined);

  readonly isEdit = computed(() => this.customerId() !== undefined);
  readonly saving = signal(false);
  protected readonly statusOptions = CUSTOMER_STATUS_OPTIONS;
  readonly bannerMessages = signal<string[]>([]);

  readonly form = new FormGroup({
    legalName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    tradeName: new FormControl('', { nonNullable: true }),
    // No client-side KvK rule: the domain owns it and a second copy would drift.
    kvkNumber: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    vatNumber: new FormControl('', { nonNullable: true }),
    // Sent only by the update arm; UpdateCustomerRequest requires it and the create request
    // has no such property.
    status: new FormControl<CustomerStatusValue>('PROSPECT', { nonNullable: true }),
    internalReference: new FormControl('', { nonNullable: true }),
    locale: new FormControl('nl-NL', { nonNullable: true, validators: [Validators.required] }),
    billingAddress: buildAddressGroup(),
    primaryContact: new FormGroup({
      name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      email: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      phone: new FormControl('', { nonNullable: true }),
    }),
  });

  constructor() {
    effect((onCleanup) => {
      const id = this.customerId();
      if (id === undefined) return;
      const subscription = this.api.getCustomer(id).subscribe({
        next: (customer) => this.fill(customer),
        error: () =>
          this.bannerMessages.set([
            'This company could not be loaded, so the form is empty. Go back and try again.',
          ]),
      });
      onCleanup(() => subscription.unsubscribe());
    });
  }

  cancelTarget(): unknown[] {
    const id = this.customerId();
    return id === undefined ? ['/customers'] : ['/customers', id];
  }

  message(path: string): string | null {
    return serverError(this.form.get(path));
  }

  submit(): void {
    this.bannerMessages.set([]);
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.saving.set(true);
    const id = this.customerId();
    const call = id === undefined
      ? this.api.createCustomer(this.toCreateRequest())
      : this.api.updateCustomer(id, this.toUpdateRequest());

    call.subscribe({
      next: (customer) => {
        this.saving.set(false);
        void this.router.navigate(['/customers', customer.id]);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.handleError(error);
      },
    });
  }

  private handleError(error: unknown): void {
    if (error instanceof HttpErrorResponse && isValidationProblem(error.error)) {
      this.bannerMessages.set(applyProblemDetails(this.form, error.error));
      return;
    }
    this.bannerMessages.set([
      'This company could not be saved. The employee API returned an error; try again.',
    ]);
  }

  /** Empty text means "not provided", which the API expects as null rather than "". */
  private shared() {
    const value = this.form.getRawValue();
    const blankToNull = (text: string): string | null => (text.trim() === '' ? null : text.trim());

    return {
      legalName: value.legalName.trim(),
      tradeName: blankToNull(value.tradeName),
      vatNumber: blankToNull(value.vatNumber),
      internalReference: blankToNull(value.internalReference),
      locale: value.locale.trim(),
      billingAddress: {
        street: value.billingAddress.street.trim(),
        houseNumber: value.billingAddress.houseNumber.trim(),
        houseNumberSuffix: blankToNull(value.billingAddress.houseNumberSuffix),
        postalCode: value.billingAddress.postalCode.trim(),
        city: value.billingAddress.city.trim(),
        country: value.billingAddress.country.trim(),
      },
      visitingAddress: null,
      primaryContact: {
        name: value.primaryContact.name.trim(),
        email: value.primaryContact.email.trim(),
        phone: blankToNull(value.primaryContact.phone),
      },
    };
  }

  /** Create carries the KvK number and no status: a new company is always a prospect. */
  private toCreateRequest(): CreateCustomerRequest {
    return {
      ...this.shared(),
      kvkNumber: this.form.controls.kvkNumber.value.trim(),
    } as CreateCustomerRequest;
  }

  /** Update carries the status and NO KvK number — it is immutable once registered. */
  private toUpdateRequest(): UpdateCustomerRequest {
    return {
      ...this.shared(),
      status: this.form.controls.status.value,
    } as UpdateCustomerRequest;
  }

  private fill(customer: CustomerDetail): void {
    this.form.setValue({
      legalName: customer.legalName,
      tradeName: customer.tradeName ?? '',
      kvkNumber: customer.kvkNumber,
      vatNumber: customer.vatNumber ?? '',
      status: customer.status as CustomerStatusValue,
      internalReference: customer.internalReference ?? '',
      locale: customer.locale,
      billingAddress: {
        street: customer.billingAddress.street,
        houseNumber: customer.billingAddress.houseNumber,
        houseNumberSuffix: customer.billingAddress.houseNumberSuffix ?? '',
        postalCode: customer.billingAddress.postalCode,
        city: customer.billingAddress.city,
        country: customer.billingAddress.country,
      },
      primaryContact: {
        name: customer.primaryContact.name,
        email: customer.primaryContact.email,
        phone: customer.primaryContact.phone ?? '',
      },
    });
  }
}
```

Modify `apps/employee-portal/src/app/features/customers/customers.routes.ts` to the full file
below. **`new` and `:customerId/edit` must both come before `:customerId`,** or the router
matches `/customers/new` as a customer whose id is the word `new`:

```ts
import type { Routes } from '@angular/router';

// Tasks 10 and 11 add the account and metering-point children.
export const CUSTOMERS_ROUTES: Routes = [
  {
    path: '',
    title: 'Customers · PeakPower back office',
    loadComponent: () => import('./customer-list-page').then((m) => m.CustomerListPage),
  },
  {
    path: 'new',
    title: 'New company · PeakPower back office',
    loadComponent: () => import('./customer-form-page').then((m) => m.CustomerFormPage),
  },
  {
    path: ':customerId/edit',
    title: 'Edit company · PeakPower back office',
    loadComponent: () => import('./customer-form-page').then((m) => m.CustomerFormPage),
  },
  {
    path: ':customerId',
    title: 'Customer · PeakPower back office',
    loadComponent: () => import('./customer-detail-page').then((m) => m.CustomerDetailPage),
  },
];
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: PASS — 7 tests in `CustomerFormPage — create` and 4 in `CustomerFormPage — edit`.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/employee-portal/src/app/shared apps/employee-portal/src/app/features/customers
git commit -m "feat(employee-portal): create and edit a customer with server-side validation"
```

---

## Task 10: Create, edit and deactivate an account

An **account** is one person's login at a customer company — `[F01-R10]`…`[F01-R17]`. Slice 1
creates it from the back office and from the onboarding wizard (Plan 5); here it is the employee
path.

Three rules from the shared contract shape this screen:

- **`Username` is immutable.** It is unique platform-wide and it is the identity a token is
  issued against, so the edit form shows it read-only rather than pretending it can change.
- **`is_admin` is a `[DEC-71]` column** — nothing enforces it until Phase 2, and it is still
  editable here, because a role retrofitted onto live accounts is worse than an unused column.
- **Deactivating revokes sessions immediately** `[F01-R16]`. The server does that by bumping
  `security_stamp`; the portal's job is only to say so honestly in the confirmation.

Because the employee API has no `GET /accounts/{id}`, the edit page reads the owning customer and
picks the account out of it. That is one request either way, and it keeps the API surface as Plan
2 defined it.

**Files:**
- Create: `apps/employee-portal/src/app/features/customers/account-form-page.ts`
- Modify: `apps/employee-portal/src/app/features/customers/customers.routes.ts`
- Test: `apps/employee-portal/src/app/features/customers/account-form-page.spec.ts`

**Interfaces:**
- Consumes (Task 3): `EmployeeApiClient.getCustomer/createAccount/updateAccount/deactivateAccount`,
  `isValidationProblem`, `Account`, `CustomerDetail`, `CreateAccountRequest`,
  `UpdateAccountRequest`.
  Consumes (Task 4): `applyProblemDetails`, `serverError`.
  Consumes (Task 5): `accountStatusLabel`, `accountStatusTone`.
  Consumes (Task 9): `PpFormField`.
  Consumes (Plan 3): `PpBadge`, `PpBanner`, `PpButton`, `PpCard`.
- Produces:
  - `export class AccountFormPage` (selector `pp-account-form-page`) with
    `readonly customerId = input.required<string>()` and
    `readonly accountId = input<string | undefined>()`

- [ ] **Step 1: Write the failing test**

Create `apps/employee-portal/src/app/features/customers/account-form-page.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  provideEmployeeApiTesting,
  type CustomerDetail,
} from '@peakpower-nl/api-client-employee';

import { AccountFormPage } from './account-form-page';

const CUSTOMER = {
  id: 'c1',
  legalName: 'Acme Energie B.V.',
  tradeName: null,
  kvkNumber: '12345678',
  vatNumber: null,
  status: 'ACTIVE',
  fourEyesEnabled: false,
  locale: 'nl-NL',
  internalReference: null,
  billingAddress: {
    street: 'Keizersgracht',
    houseNumber: '117',
    houseNumberSuffix: null,
    postalCode: '1015 CJ',
    city: 'Amsterdam',
    country: 'NL',
  },
  visitingAddress: null,
  primaryContact: { name: 'Jan Jansen', email: 'jan@acme.nl', phone: null },
  accounts: [
    {
      id: 'a1',
      customerId: 'c1',
      username: 'j.jansen',
      firstName: 'Jan',
      lastName: 'Jansen',
      jobTitle: 'Head of energy',
      email: 'jan@acme.nl',
      phone: '+31 6 1234 5678',
      status: 'ACTIVE',
      isAdmin: true,
      lastLoginAt: null,
    },
  ],
  meteringPoints: [],
} as unknown as CustomerDetail;

describe('AccountFormPage — create', () => {
  let fixture: ComponentFixture<AccountFormPage>;
  let http: HttpTestingController;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text() {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideEmployeeApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AccountFormPage);
    fixture.componentRef.setInput('customerId', 'c1');
    await settle();
  });

  afterEach(() => http.verify());

  it('does not read the customer when creating', () => {
    http.expectNone(() => true);
  });

  it('lets the username be edited when creating', () => {
    expect(fixture.componentInstance.form.controls.username.disabled).toBe(false);
  });

  it('POSTs the account to the customer accounts collection', async () => {
    fixture.componentInstance.form.setValue({
      username: 'a.boers',
      firstName: 'Ada',
      lastName: 'Boers',
      jobTitle: '',
      email: 'ada@acme.nl',
      phone: '',
      isAdmin: true,
    });
    fixture.componentInstance.submit();
    await settle();

    const req = http.expectOne('/api/v1/customers/c1/accounts');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      username: 'a.boers',
      firstName: 'Ada',
      lastName: 'Boers',
      jobTitle: null,
      email: 'ada@acme.nl',
      phone: null,
      isAdmin: true,
    });
    req.flush(CUSTOMER.accounts[0]);
  });

  it('shows a duplicate username as a message on the username control', async () => {
    fixture.componentInstance.form.setValue({
      username: 'j.jansen',
      firstName: 'Jan',
      lastName: 'Jansen',
      jobTitle: '',
      email: 'jan2@acme.nl',
      phone: '',
      isAdmin: false,
    });
    fixture.componentInstance.submit();
    await settle();

    http.expectOne('/api/v1/customers/c1/accounts').flush(
      { status: 409, errors: { username: ['This username is already taken.'] } },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();

    expect(text()).toContain('This username is already taken.');
  });
});

describe('AccountFormPage — edit', () => {
  let fixture: ComponentFixture<AccountFormPage>;
  let http: HttpTestingController;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text() {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideEmployeeApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AccountFormPage);
    fixture.componentRef.setInput('customerId', 'c1');
    fixture.componentRef.setInput('accountId', 'a1');
  });

  afterEach(() => http.verify());

  it('reads the owning customer and fills the form from the matching account', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush(CUSTOMER);
    await settle();

    expect(fixture.componentInstance.form.controls.firstName.value).toBe('Jan');
    expect(fixture.componentInstance.form.controls.jobTitle.value).toBe('Head of energy');
    expect(fixture.componentInstance.form.controls.isAdmin.value).toBe(true);
  });

  it('shows the username read-only, because it is immutable', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush(CUSTOMER);
    await settle();

    expect(fixture.componentInstance.form.controls.username.disabled).toBe(true);
    expect(text()).toContain('j.jansen');
    expect(text()).toContain('cannot be changed');
  });

  it('PATCHes the account without the username', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush(CUSTOMER);
    await settle();

    fixture.componentInstance.form.controls.lastName.setValue('Janssen');
    fixture.componentInstance.submit();
    await settle();

    const req = http.expectOne('/api/v1/accounts/a1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({
      firstName: 'Jan',
      lastName: 'Janssen',
      jobTitle: 'Head of energy',
      email: 'jan@acme.nl',
      phone: '+31 6 1234 5678',
      isAdmin: true,
    });
    expect(Object.keys(req.request.body)).not.toContain('username');
    req.flush(CUSTOMER.accounts[0]);
  });

  it('asks for confirmation before deactivating and says what it costs', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush(CUSTOMER);
    await settle();

    fixture.componentInstance.askToDeactivate();
    await settle();

    expect(text()).toContain('sign in');
    expect(text()).toContain('next call');
    http.expectNone('/api/v1/accounts/a1/deactivate');
  });

  it('POSTs the deactivation once confirmed', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush(CUSTOMER);
    await settle();

    fixture.componentInstance.askToDeactivate();
    await settle();
    fixture.componentInstance.confirmDeactivate();
    await settle();

    const req = http.expectOne('/api/v1/accounts/a1/deactivate');
    expect(req.request.method).toBe('POST');
    req.flush({ ...CUSTOMER.accounts[0], status: 'DEACTIVATED' });
  });

  it('offers no deactivation for an account that is already deactivated', async () => {
    await settle();
    http.expectOne('/api/v1/customers/c1').flush({
      ...CUSTOMER,
      accounts: [{ ...CUSTOMER.accounts[0], status: 'DEACTIVATED' }],
    } as CustomerDetail);
    await settle();

    expect(fixture.componentInstance.canDeactivate()).toBe(false);
    expect(text()).toContain('Deactivated');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: FAIL — `Failed to resolve import "./account-form-page"`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/employee-portal/src/app/features/customers/account-form-page.ts`:

```ts
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PpBadge, PpBanner, PpButton, PpCard } from '@peakpower-nl/shared-ui';
import {
  EmployeeApiClient,
  isValidationProblem,
  type Account,
  type CreateAccountRequest,
  type UpdateAccountRequest,
} from '@peakpower-nl/api-client-employee';

import { applyProblemDetails, serverError } from '../../shared/apply-problem-details';
import { PpFormField } from '../../shared/form-field';
import { accountStatusLabel, accountStatusTone } from '../../shared/labels';

@Component({
  selector: 'pp-account-form-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, PpBadge, PpBanner, PpButton, PpCard, PpFormField],
  styles: `
    :host { display: grid; gap: 16px; max-width: 720px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .actions { display: flex; gap: 8px; margin-top: 16px; }
    .status { display: flex; align-items: center; gap: 8px; }
    .empty { margin: 0; color: var(--pp-text-faint); }
    .checkbox { display: flex; align-items: center; gap: 8px; }
  `,
  template: `
    <h1>{{ isEdit() ? 'Edit account' : 'New account' }}</h1>

    @for (message of bannerMessages(); track message) {
      <pp-banner tone="critical" heading="This account was not saved">{{ message }}</pp-banner>
    }

    @if (account(); as existing) {
      <div class="status">
        <span class="empty">Status</span>
        <pp-badge [tone]="statusTone(existing.status)">{{ statusLabel(existing.status) }}</pp-badge>
      </div>
    }

    <form [formGroup]="form" (ngSubmit)="submit()">
      <pp-card heading="Person">
        <div class="grid">
          <pp-form-field
            label="Username"
            for="username"
            [hint]="isEdit() ? 'The username is the account identity and cannot be changed.' : 'Unique across the whole platform.'"
            [error]="message('username')"
          >
            <input id="username" type="text" formControlName="username" />
          </pp-form-field>
          <pp-form-field label="Email" for="email" [error]="message('email')">
            <input id="email" type="email" formControlName="email" />
          </pp-form-field>
          <pp-form-field label="First name" for="first-name" [error]="message('firstName')">
            <input id="first-name" type="text" formControlName="firstName" />
          </pp-form-field>
          <pp-form-field label="Last name" for="last-name" [error]="message('lastName')">
            <input id="last-name" type="text" formControlName="lastName" />
          </pp-form-field>
          <pp-form-field
            label="Job title"
            for="job-title"
            hint="Descriptive only. It is never checked against anything."
            [error]="message('jobTitle')"
          >
            <input id="job-title" type="text" formControlName="jobTitle" />
          </pp-form-field>
          <pp-form-field label="Phone" for="phone" hint="Optional" [error]="message('phone')">
            <input id="phone" type="tel" formControlName="phone" />
          </pp-form-field>
        </div>
      </pp-card>

      <pp-card heading="Permissions">
        <div class="checkbox">
          <input id="is-admin" type="checkbox" formControlName="isAdmin" />
          <label for="is-admin">This person administers the company</label>
        </div>
        <p class="empty">
          The flag is recorded now and enforced from Phase 2, when four-eyes approval arrives.
        </p>
      </pp-card>

      <div class="actions">
        <pp-button variant="primary" [disabled]="saving()" (click)="submit()">
          {{ isEdit() ? 'Save changes' : 'Create account' }}
        </pp-button>
        <a [routerLink]="['/customers', customerId()]">
          <pp-button>Cancel</pp-button>
        </a>
        @if (canDeactivate()) {
          <pp-button variant="danger" (click)="askToDeactivate()">
            Deactivate
          </pp-button>
        }
      </div>
    </form>

    @if (confirmingDeactivation()) {
      <pp-banner tone="critical" heading="Deactivate this account?">
        <p>
          The person will no longer be able to sign in, and any token they already hold stops
          working on its next call rather than when it expires.
        </p>
        <div class="actions">
          <pp-button variant="danger" (click)="confirmDeactivate()">Yes, deactivate</pp-button>
          <pp-button (click)="cancelDeactivate()">Keep the account</pp-button>
        </div>
      </pp-banner>
    }
  `,
})
export class AccountFormPage {
  private readonly api = inject(EmployeeApiClient);
  private readonly router = inject(Router);

  readonly customerId = input.required<string>();
  /** Absent when creating. */
  readonly accountId = input<string | undefined>(undefined);

  readonly isEdit = computed(() => this.accountId() !== undefined);
  readonly account = signal<Account | undefined>(undefined);
  readonly saving = signal(false);
  readonly confirmingDeactivation = signal(false);
  readonly bannerMessages = signal<string[]>([]);

  readonly canDeactivate = computed(() => {
    const existing = this.account();
    return existing !== undefined && existing.status !== 'DEACTIVATED';
  });

  readonly form = new FormGroup({
    username: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    firstName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    lastName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    jobTitle: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    phone: new FormControl('', { nonNullable: true }),
    isAdmin: new FormControl(false, { nonNullable: true }),
  });

  constructor() {
    effect((onCleanup) => {
      const accountId = this.accountId();
      if (accountId === undefined) return;

      // There is no GET /accounts/{id}; the owning customer carries its accounts.
      const subscription = this.api.getCustomer(this.customerId()).subscribe({
        next: (customer) => {
          const found = customer.accounts.find((a) => a.id === accountId);
          if (found === undefined) {
            this.bannerMessages.set([
              'This account is no longer attached to this company. Go back to the customer.',
            ]);
            return;
          }
          this.fill(found);
        },
        error: () =>
          this.bannerMessages.set([
            'This account could not be loaded, so the form is empty. Go back and try again.',
          ]),
      });
      onCleanup(() => subscription.unsubscribe());
    });
  }

  message(name: string): string | null {
    return serverError(this.form.get(name));
  }

  submit(): void {
    this.bannerMessages.set([]);
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.saving.set(true);
    const accountId = this.accountId();
    const call =
      accountId === undefined
        ? this.api.createAccount(this.customerId(), this.toCreateRequest())
        : this.api.updateAccount(accountId, this.toUpdateRequest());

    call.subscribe({
      next: () => {
        this.saving.set(false);
        void this.router.navigate(['/customers', this.customerId()]);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.handleError(error);
      },
    });
  }

  askToDeactivate(): void {
    this.confirmingDeactivation.set(true);
  }

  cancelDeactivate(): void {
    this.confirmingDeactivation.set(false);
  }

  confirmDeactivate(): void {
    const accountId = this.accountId();
    if (accountId === undefined) return;
    this.confirmingDeactivation.set(false);
    this.api.deactivateAccount(accountId).subscribe({
      next: () => void this.router.navigate(['/customers', this.customerId()]),
      error: (error: unknown) => this.handleError(error),
    });
  }

  private handleError(error: unknown): void {
    if (error instanceof HttpErrorResponse && isValidationProblem(error.error)) {
      this.bannerMessages.set(applyProblemDetails(this.form, error.error));
      return;
    }
    this.bannerMessages.set([
      'This account could not be saved. The employee API returned an error; try again.',
    ]);
  }

  private blankToNull(text: string): string | null {
    return text.trim() === '' ? null : text.trim();
  }

  private toCreateRequest(): CreateAccountRequest {
    const value = this.form.getRawValue();
    return {
      username: value.username.trim(),
      firstName: value.firstName.trim(),
      lastName: value.lastName.trim(),
      jobTitle: this.blankToNull(value.jobTitle),
      email: value.email.trim(),
      phone: this.blankToNull(value.phone),
      isAdmin: value.isAdmin,
    } as CreateAccountRequest;
  }

  private toUpdateRequest(): UpdateAccountRequest {
    const value = this.form.getRawValue();
    // The username is deliberately absent: it is immutable and the endpoint rejects it.
    return {
      firstName: value.firstName.trim(),
      lastName: value.lastName.trim(),
      jobTitle: this.blankToNull(value.jobTitle),
      email: value.email.trim(),
      phone: this.blankToNull(value.phone),
      isAdmin: value.isAdmin,
    } as UpdateAccountRequest;
  }

  private fill(account: Account): void {
    this.account.set(account);
    this.form.setValue({
      username: account.username,
      firstName: account.firstName,
      lastName: account.lastName,
      jobTitle: account.jobTitle ?? '',
      email: account.email,
      phone: account.phone ?? '',
      isAdmin: account.isAdmin,
    });
    this.form.controls.username.disable();
  }

  protected readonly statusLabel = accountStatusLabel;
  protected readonly statusTone = accountStatusTone;
}
```

Modify `apps/employee-portal/src/app/features/customers/customers.routes.ts` — insert the two
account routes between `':customerId/edit'` and `':customerId'`, leaving every other entry as
Task 9 wrote it:

```ts
  {
    path: ':customerId/accounts/new',
    title: 'New account · PeakPower back office',
    loadComponent: () => import('./account-form-page').then((m) => m.AccountFormPage),
  },
  {
    path: ':customerId/accounts/:accountId/edit',
    title: 'Edit account · PeakPower back office',
    loadComponent: () => import('./account-form-page').then((m) => m.AccountFormPage),
  },
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: PASS — 4 tests in `AccountFormPage — create` and 6 in `AccountFormPage — edit`.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/employee-portal/src/app/features/customers
git commit -m "feat(employee-portal): create, edit and deactivate a customer account"
```

---

## Task 11: Attach, edit and end-date a metering point

A **metering point** is a physical grid connection, identified by an 18-digit **EAN code**.
Attaching one to a customer is `[F01-R23]`…`[F01-R27]`. Three things about this screen are
domain rules rather than UI choices:

- **The BRP is mandatory** `[F01-R51]`. A metering point with no balance responsible party is
  not a valid record, so the select has no blank option and the page will not submit without one.
- **EAN validation is 18 digits only in the PoC** `[DEC-114]`. The GS1 check digit is *not*
  checked, and `[OQ-97]` tracks reinstating it. The form does not validate the EAN at all: as
  with KvK and IBAN, the domain owns the rule and the browser surfaces what the API returns.
- **Validity is half-open, `[valid_from, valid_to)`.** End-dating sets `valid_to`; the database
  enforces with a GiST exclusion constraint that the same EAN never overlaps itself across
  customers. So "end-date" is a distinct operation from "edit", and it has its own endpoint.

Name is capped at 80 characters and description at 500 `[F01-R29]`. Those two *are* enforced in
the browser, because they are presentation limits with no domain meaning — a `maxlength` that
stops typing is friendlier than a round trip, and the API enforces them again anyway.

**Files:**
- Create: `apps/employee-portal/src/app/features/customers/metering-point-form-page.ts`
- Modify: `apps/employee-portal/src/app/features/customers/customers.routes.ts`
- Test: `apps/employee-portal/src/app/features/customers/metering-point-form-page.spec.ts`

**Interfaces:**
- Consumes (Task 3): `EmployeeApiClient.getCustomer/listBrps/attachMeteringPoint/updateMeteringPoint/endDateMeteringPoint`,
  `isValidationProblem`, `Brp`, `MeteringPoint`, `AttachMeteringPointRequest`,
  `UpdateMeteringPointRequest`, `EndDateMeteringPointRequest`.
  Consumes (Task 4): `applyProblemDetails`, `serverError`.
  Consumes (Task 5): `PRODUCTION_EXPECTATION_OPTIONS`, `EXPECTATION_SOURCE_OPTIONS`.
  Consumes (Task 9): `PpFormField`.
  Consumes (Plan 3): `PpBanner`, `PpButton`, `PpCard`.
- Produces:
  - `export class MeteringPointFormPage` (selector `pp-metering-point-form-page`) with
    `readonly customerId = input.required<string>()` and
    `readonly meteringPointId = input<string | undefined>()`

- [ ] **Step 1: Write the failing test**

Create `apps/employee-portal/src/app/features/customers/metering-point-form-page.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  provideEmployeeApiTesting,
  type Brp,
  type CustomerDetail,
} from '@peakpower-nl/api-client-employee';

import { MeteringPointFormPage } from './metering-point-form-page';

const BRPS = [
  { id: 'b1', code: 'PVNED', name: 'PVNed', isActive: true },
  { id: 'b2', code: 'ENECO', name: 'Eneco', isActive: true },
] as unknown as Brp[];

const POINT = {
  id: 'm1',
  customerId: 'c1',
  ean: '871687110000000123',
  eanDisplay: '8716 8711 0000 0001 23',
  commodity: 'ELECTRICITY',
  brpId: 'b1',
  brpName: 'PVNed',
  productionExpectation: 'EXPECTED',
  expectationSource: 'CONTRACT',
  name: 'Rooftop Amsterdam',
  description: 'Solar on the north building',
  gridOperator: 'Liander',
  capacityKw: 1250.5,
  address: null,
  validFrom: '2026-01-01',
  validTo: null,
  displayLabel: 'Rooftop Amsterdam',
};

const CUSTOMER = {
  id: 'c1',
  legalName: 'Acme Energie B.V.',
  accounts: [],
  meteringPoints: [POINT],
} as unknown as CustomerDetail;

describe('MeteringPointFormPage — attach', () => {
  let fixture: ComponentFixture<MeteringPointFormPage>;
  let http: HttpTestingController;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text() {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideEmployeeApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(MeteringPointFormPage);
    fixture.componentRef.setInput('customerId', 'c1');
    await settle();
    http.expectOne('/api/v1/reference-data/brps').flush(BRPS);
    await settle();
  });

  afterEach(() => http.verify());

  it('loads the BRP list so the mandatory choice can be made', () => {
    expect(fixture.componentInstance.brps()).toHaveLength(2);
    expect(text()).toContain('PVNed');
  });

  it('will not submit without a BRP, because the BRP is mandatory', async () => {
    fixture.componentInstance.form.patchValue({
      ean: '871687110000000123',
      brpId: '',
      productionExpectation: 'UNKNOWN',
      validFrom: '2026-09-01',
    });
    fixture.componentInstance.submit();
    await settle();

    expect(fixture.componentInstance.form.controls.brpId.valid).toBe(false);
    http.expectNone('/api/v1/customers/c1/metering-points');
  });

  it('applies no client-side EAN rule, because the PoC checks 18 digits server-side', () => {
    fixture.componentInstance.form.controls.ean.setValue('123');
    expect(fixture.componentInstance.form.controls.ean.valid).toBe(true);
  });

  it('POSTs the attachment with the declared production expectation', async () => {
    fixture.componentInstance.form.patchValue({
      ean: '871687110000000123',
      brpId: 'b1',
      productionExpectation: 'EXPECTED',
      expectationSource: 'CONTRACT',
      name: 'Rooftop Amsterdam',
      description: '',
      gridOperator: 'Liander',
      capacityKw: '1250.5',
      validFrom: '2026-09-01',
    });
    fixture.componentInstance.submit();
    await settle();

    const req = http.expectOne('/api/v1/customers/c1/metering-points');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      ean: '871687110000000123',
      brpId: 'b1',
      productionExpectation: 'EXPECTED',
      expectationSource: 'CONTRACT',
      name: 'Rooftop Amsterdam',
      description: null,
      gridOperator: 'Liander',
      capacityKw: 1250.5,
      address: null,
      validFrom: '2026-09-01',
    });
    req.flush(POINT);
  });

  it('surfaces the overlapping-period rejection as a message on the EAN control', async () => {
    fixture.componentInstance.form.patchValue({
      ean: '871687110000000123',
      brpId: 'b1',
      productionExpectation: 'UNKNOWN',
      validFrom: '2026-09-01',
    });
    fixture.componentInstance.submit();
    await settle();

    http.expectOne('/api/v1/customers/c1/metering-points').flush(
      {
        status: 409,
        errors: { ean: ['This EAN is already attached to another customer for that period.'] },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();

    expect(text()).toContain('already attached to another customer');
  });

  it('caps the friendly name at 80 and the description at 500 characters', () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('#name')?.getAttribute('maxlength')).toBe('80');
    expect(element.querySelector('#description')?.getAttribute('maxlength')).toBe('500');
  });
});

describe('MeteringPointFormPage — edit and end-date', () => {
  let fixture: ComponentFixture<MeteringPointFormPage>;
  let http: HttpTestingController;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideEmployeeApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(MeteringPointFormPage);
    fixture.componentRef.setInput('customerId', 'c1');
    fixture.componentRef.setInput('meteringPointId', 'm1');
    await settle();
    http.expectOne('/api/v1/reference-data/brps').flush(BRPS);
    http.expectOne('/api/v1/customers/c1').flush(CUSTOMER);
    await settle();
  });

  afterEach(() => http.verify());

  it('fills the form from the attached metering point', () => {
    const controls = fixture.componentInstance.form.controls;
    expect(controls.ean.value).toBe('871687110000000123');
    expect(controls.brpId.value).toBe('b1');
    expect(controls.productionExpectation.value).toBe('EXPECTED');
    expect(controls.name.value).toBe('Rooftop Amsterdam');
    expect(controls.capacityKw.value).toBe('1250.5');
  });

  it('shows the EAN read-only, because changing it is an attach, not an edit', () => {
    expect(fixture.componentInstance.form.controls.ean.disabled).toBe(true);
  });

  it('PATCHes the metering point without the EAN or the validity', async () => {
    fixture.componentInstance.form.controls.name.setValue('Rooftop Amsterdam noord');
    fixture.componentInstance.submit();
    await settle();

    const req = http.expectOne('/api/v1/metering-points/m1');
    expect(req.request.method).toBe('PATCH');
    expect(Object.keys(req.request.body).sort()).toEqual([
      'address',
      'brpId',
      'capacityKw',
      'description',
      'expectationSource',
      'gridOperator',
      'name',
      'productionExpectation',
    ]);
    expect(req.request.body.name).toBe('Rooftop Amsterdam noord');
    req.flush(POINT);
  });

  it('POSTs an end date to its own endpoint', async () => {
    fixture.componentInstance.endDateForm.controls.validTo.setValue('2026-12-31');
    fixture.componentInstance.endDate();
    await settle();

    const req = http.expectOne('/api/v1/metering-points/m1/end-date');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ validTo: '2026-12-31' });
    req.flush({ ...POINT, validTo: '2026-12-31' });
  });

  it('explains that the end date is exclusive', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('last day');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: FAIL — `Failed to resolve import "./metering-point-form-page"`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/employee-portal/src/app/features/customers/metering-point-form-page.ts`:

```ts
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PpBanner, PpButton, PpCard } from '@peakpower-nl/shared-ui';
import {
  EmployeeApiClient,
  isValidationProblem,
  type AttachMeteringPointRequest,
  type Brp,
  type EndDateMeteringPointRequest,
  type MeteringPoint,
  type ProductionExpectationSourceValue,
  type ProductionExpectationValue,
  type UpdateMeteringPointRequest,
} from '@peakpower-nl/api-client-employee';

import { applyProblemDetails, serverError } from '../../shared/apply-problem-details';
import { PpFormField } from '../../shared/form-field';
import {
  EXPECTATION_SOURCE_OPTIONS,
  PRODUCTION_EXPECTATION_OPTIONS,
} from '../../shared/labels';

@Component({
  selector: 'pp-metering-point-form-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, PpBanner, PpButton, PpCard, PpFormField],
  styles: `
    :host { display: grid; gap: 16px; max-width: 880px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .wide { grid-column: 1 / -1; }
    .actions { display: flex; gap: 8px; margin-top: 16px; }
    .empty { margin: 0; color: var(--pp-text-faint); }
  `,
  template: `
    <h1>{{ isEdit() ? 'Edit connection' : 'Attach a connection' }}</h1>

    @for (message of bannerMessages(); track message) {
      <pp-banner tone="critical" heading="This connection was not saved">{{ message }}</pp-banner>
    }

    <form [formGroup]="form" (ngSubmit)="submit()">
      <pp-card heading="Connection">
        <div class="grid">
          <pp-form-field
            label="EAN code"
            for="ean"
            [hint]="isEdit()
              ? 'The EAN identifies the connection and cannot be changed. Attach a new connection instead.'
              : 'Eighteen digits. The check digit is not verified in the proof of concept.'"
            [error]="message('ean')"
          >
            <input id="ean" type="text" formControlName="ean" />
          </pp-form-field>
          <pp-form-field
            label="Balance responsible party"
            for="brp"
            hint="Mandatory. Every connection is assigned to a BRP."
            [error]="message('brpId')"
          >
            <select id="brp" formControlName="brpId">
              <option value="" disabled>Choose a BRP</option>
              @for (brp of brps(); track brp.id) {
                <option [value]="brp.id">{{ brp.name }}</option>
              }
            </select>
          </pp-form-field>
          <pp-form-field
            label="Friendly name"
            for="name"
            hint="Optional. Shown instead of the EAN, up to 80 characters."
            [error]="message('name')"
          >
            <input id="name" type="text" maxlength="80" formControlName="name" />
          </pp-form-field>
          <pp-form-field
            label="Grid operator"
            for="grid-operator"
            hint="Optional"
            [error]="message('gridOperator')"
          >
            <input id="grid-operator" type="text" formControlName="gridOperator" />
          </pp-form-field>
          <pp-form-field
            label="Capacity in kW"
            for="capacity"
            hint="Optional"
            [error]="message('capacityKw')"
          >
            <input id="capacity" type="number" step="0.01" formControlName="capacityKw" />
          </pp-form-field>
          @if (!isEdit()) {
            <pp-form-field
              label="Valid from"
              for="valid-from"
              hint="The first day this customer holds the connection."
              [error]="message('validFrom')"
            >
              <input id="valid-from" type="date" formControlName="validFrom" />
            </pp-form-field>
          }
          <div class="wide">
            <pp-form-field
              label="Description"
              for="description"
              hint="Optional, up to 500 characters."
              [error]="message('description')"
            >
              <textarea id="description" maxlength="500" rows="3" formControlName="description">
              </textarea>
            </pp-form-field>
          </div>
        </div>
      </pp-card>

      <pp-card heading="Production" subtitle="Whether this connection feeds electricity back">
        <div class="grid">
          <pp-form-field
            label="Production expectation"
            for="production-expectation"
            [error]="message('productionExpectation')"
          >
            <select id="production-expectation" formControlName="productionExpectation">
              @for (option of expectationOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </pp-form-field>
          <pp-form-field
            label="Where that came from"
            for="expectation-source"
            hint="Optional. It records the provenance of the expectation, not the expectation."
            [error]="message('expectationSource')"
          >
            <select id="expectation-source" formControlName="expectationSource">
              <option value="">Not recorded</option>
              @for (option of sourceOptions; track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </pp-form-field>
        </div>
      </pp-card>

      <div class="actions">
        <pp-button variant="primary" [disabled]="saving()" (click)="submit()">
          {{ isEdit() ? 'Save changes' : 'Attach connection' }}
        </pp-button>
        <a [routerLink]="['/customers', customerId()]">
          <pp-button>Cancel</pp-button>
        </a>
      </div>
    </form>

    @if (isEdit()) {
      <pp-card heading="End this connection" subtitle="The customer stops holding it">
        <form [formGroup]="endDateForm" (ngSubmit)="endDate()">
          <pp-form-field
            label="Valid to"
            for="valid-to"
            hint="Validity is half-open: the connection is held up to but not including this date, so enter the day after the last day."
            [error]="endDateMessage()"
          >
            <input id="valid-to" type="date" formControlName="validTo" />
          </pp-form-field>
          <div class="actions">
            <pp-button variant="danger" (click)="endDate()">End connection</pp-button>
          </div>
        </form>
      </pp-card>
    }
  `,
})
export class MeteringPointFormPage {
  private readonly api = inject(EmployeeApiClient);
  private readonly router = inject(Router);

  readonly customerId = input.required<string>();
  /** Absent when attaching. */
  readonly meteringPointId = input<string | undefined>(undefined);

  readonly isEdit = computed(() => this.meteringPointId() !== undefined);
  readonly brps = signal<Brp[]>([]);
  readonly saving = signal(false);
  readonly bannerMessages = signal<string[]>([]);

  protected readonly expectationOptions = PRODUCTION_EXPECTATION_OPTIONS;
  protected readonly sourceOptions = EXPECTATION_SOURCE_OPTIONS;

  // capacityKw is a text control because <input type="number"> yields '' for an empty box, and
  // the request wants null. The conversion happens once, in toAttachRequest/toUpdateRequest.
  readonly form = new FormGroup({
    ean: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    brpId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    productionExpectation: new FormControl<ProductionExpectationValue>('UNKNOWN', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    expectationSource: new FormControl<ProductionExpectationSourceValue | ''>('', {
      nonNullable: true,
    }),
    name: new FormControl('', { nonNullable: true }),
    description: new FormControl('', { nonNullable: true }),
    gridOperator: new FormControl('', { nonNullable: true }),
    capacityKw: new FormControl('', { nonNullable: true }),
    validFrom: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  readonly endDateForm = new FormGroup({
    validTo: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    // The BRP list is needed in both modes: the select is mandatory.
    effect((onCleanup) => {
      const subscription = this.api.listBrps().subscribe({
        next: (brps) => this.brps.set(brps.filter((brp) => brp.isActive)),
        error: () =>
          this.bannerMessages.set([
            'The list of balance responsible parties could not be loaded, so no connection can be attached yet.',
          ]),
      });
      onCleanup(() => subscription.unsubscribe());
    });

    effect((onCleanup) => {
      const id = this.meteringPointId();
      if (id === undefined) return;
      const subscription = this.api.getCustomer(this.customerId()).subscribe({
        next: (customer) => {
          const found = customer.meteringPoints.find((point) => point.id === id);
          if (found === undefined) {
            this.bannerMessages.set([
              'This connection is no longer attached to this company. Go back to the customer.',
            ]);
            return;
          }
          this.fill(found);
        },
        error: () =>
          this.bannerMessages.set([
            'This connection could not be loaded, so the form is empty. Go back and try again.',
          ]),
      });
      onCleanup(() => subscription.unsubscribe());
    });
  }

  message(name: string): string | null {
    return serverError(this.form.get(name));
  }

  endDateMessage(): string | null {
    return serverError(this.endDateForm.controls.validTo);
  }

  submit(): void {
    this.bannerMessages.set([]);
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.saving.set(true);
    const id = this.meteringPointId();
    const call =
      id === undefined
        ? this.api.attachMeteringPoint(this.customerId(), this.toAttachRequest())
        : this.api.updateMeteringPoint(id, this.toUpdateRequest());

    call.subscribe({
      next: () => {
        this.saving.set(false);
        void this.router.navigate(['/customers', this.customerId()]);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.handleError(error, this.form);
      },
    });
  }

  endDate(): void {
    this.bannerMessages.set([]);
    this.endDateForm.markAllAsTouched();
    const id = this.meteringPointId();
    if (id === undefined || this.endDateForm.invalid) return;

    const body = { validTo: this.endDateForm.controls.validTo.value } as EndDateMeteringPointRequest;
    this.api.endDateMeteringPoint(id, body).subscribe({
      next: () => void this.router.navigate(['/customers', this.customerId()]),
      error: (error: unknown) => this.handleError(error, this.endDateForm),
    });
  }

  private handleError(error: unknown, form: FormGroup): void {
    if (error instanceof HttpErrorResponse && isValidationProblem(error.error)) {
      this.bannerMessages.set(applyProblemDetails(form, error.error));
      return;
    }
    this.bannerMessages.set([
      'This connection could not be saved. The employee API returned an error; try again.',
    ]);
  }

  private blankToNull(text: string): string | null {
    return text.trim() === '' ? null : text.trim();
  }

  private capacity(): number | null {
    const raw = this.form.getRawValue().capacityKw.trim();
    if (raw === '') return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private source(): ProductionExpectationSourceValue | null {
    const value = this.form.getRawValue().expectationSource;
    return value === '' ? null : value;
  }

  private toAttachRequest(): AttachMeteringPointRequest {
    const value = this.form.getRawValue();
    return {
      ean: value.ean.trim(),
      brpId: value.brpId,
      productionExpectation: value.productionExpectation,
      expectationSource: this.source(),
      name: this.blankToNull(value.name),
      description: this.blankToNull(value.description),
      gridOperator: this.blankToNull(value.gridOperator),
      capacityKw: this.capacity(),
      address: null,
      validFrom: value.validFrom,
    } as AttachMeteringPointRequest;
  }

  private toUpdateRequest(): UpdateMeteringPointRequest {
    const value = this.form.getRawValue();
    // Neither the EAN nor the validity is editable: changing the EAN is an attach, and changing
    // the validity is an end-date, which the exclusion constraint has to arbitrate separately.
    return {
      brpId: value.brpId,
      productionExpectation: value.productionExpectation,
      expectationSource: this.source(),
      name: this.blankToNull(value.name),
      description: this.blankToNull(value.description),
      gridOperator: this.blankToNull(value.gridOperator),
      capacityKw: this.capacity(),
      address: null,
    } as UpdateMeteringPointRequest;
  }

  private fill(point: MeteringPoint): void {
    this.form.setValue({
      ean: point.ean,
      brpId: point.brpId,
      productionExpectation: point.productionExpectation,
      expectationSource: point.expectationSource ?? '',
      name: point.name ?? '',
      description: point.description ?? '',
      gridOperator: point.gridOperator ?? '',
      capacityKw: point.capacityKw === null || point.capacityKw === undefined
        ? ''
        : String(point.capacityKw),
      validFrom: point.validFrom,
    });
    this.form.controls.ean.disable();
    if (point.validTo) {
      this.endDateForm.controls.validTo.setValue(point.validTo);
    }
  }
}
```

Modify `apps/employee-portal/src/app/features/customers/customers.routes.ts` — insert the two
metering-point routes after the account routes and before `':customerId'`:

```ts
  {
    path: ':customerId/metering-points/new',
    title: 'Attach a connection · PeakPower back office',
    loadComponent: () =>
      import('./metering-point-form-page').then((m) => m.MeteringPointFormPage),
  },
  {
    path: ':customerId/metering-points/:meteringPointId/edit',
    title: 'Edit connection · PeakPower back office',
    loadComponent: () =>
      import('./metering-point-form-page').then((m) => m.MeteringPointFormPage),
  },
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: PASS — 6 tests in `MeteringPointFormPage — attach` and 5 in
`MeteringPointFormPage — edit and end-date`.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/employee-portal/src/app/features/customers
git commit -m "feat(employee-portal): attach, edit and end-date a metering point"
```

---

## Task 12: Reference data — the BRP list

The second live area. A **BRP** — balance responsible party — is the market participant that
carries financial responsibility for the difference between a connection's planned and actual
electricity volumes. Every metering point is assigned to one `[F01-R51]`, so the list has to be
visible even before anything edits it. `[F12-R49]` asks for the reference data; migration 1 seeds
the PVNed row first, so this screen has content from the first `dev-up`.

The list is read-only in slice 1. That is stated on the screen rather than left to be discovered
by a missing button, per the rule that disabled states name the reason.

**Files:**
- Create: `apps/employee-portal/src/app/features/reference-data/reference-data.routes.ts`
- Create: `apps/employee-portal/src/app/features/reference-data/brp-list-page.ts`
- Modify: `apps/employee-portal/src/app/app.routes.ts`
- Test: `apps/employee-portal/src/app/features/reference-data/brp-list-page.spec.ts`

**Interfaces:**
- Consumes (Task 3): `EmployeeApiClient.brpsUrl()`, `Brp`, `provideEmployeeApiTesting()`.
  Consumes (Plan 3): `PpBadge`, `PpCard`, `PpGridTable`, `PpGridHead`, `PpGridRow`.
- Produces:
  - `export const REFERENCE_DATA_ROUTES: Routes`
  - `export class BrpListPage` (selector `pp-brp-list-page`) with `readonly rows: Signal<Brp[]>`

- [ ] **Step 1: Write the failing test**

Create `apps/employee-portal/src/app/features/reference-data/brp-list-page.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { provideEmployeeApiTesting, type Brp } from '@peakpower-nl/api-client-employee';

import { BrpListPage } from './brp-list-page';

const BRPS = [
  { id: 'b1', code: 'PVNED', name: 'PVNed', isActive: true },
  { id: 'b2', code: 'OLD', name: 'Retired party', isActive: false },
] as unknown as Brp[];

describe('BrpListPage', () => {
  let fixture: ComponentFixture<BrpListPage>;
  let http: HttpTestingController;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function text() {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideEmployeeApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(BrpListPage);
  });

  afterEach(() => http.verify());

  it('loads the BRPs', async () => {
    await settle();
    const req = http.expectOne('/api/v1/reference-data/brps');
    expect(req.request.method).toBe('GET');
    req.flush(BRPS);
    await settle();

    expect(text()).toContain('PVNed');
    expect(text()).toContain('PVNED');
  });

  it('shows inactive parties as inactive rather than hiding them', async () => {
    await settle();
    http.expectOne('/api/v1/reference-data/brps').flush(BRPS);
    await settle();

    expect(text()).toContain('Retired party');
    expect(text()).toContain('Inactive');
  });

  it('names the reason the list cannot be edited here', async () => {
    await settle();
    http.expectOne('/api/v1/reference-data/brps').flush(BRPS);
    await settle();

    expect(text()).toContain('read-only');
  });

  it('never renders a grid table with zero rows', async () => {
    await settle();
    http.expectOne('/api/v1/reference-data/brps').flush([]);
    await settle();

    expect((fixture.nativeElement as HTMLElement).querySelector('pp-grid-table')).toBeNull();
    expect(text()).toContain('No balance responsible parties');
  });

  it('names the reason when the list cannot be loaded', async () => {
    await settle();
    http
      .expectOne('/api/v1/reference-data/brps')
      .flush({ title: 'Bad gateway' }, { status: 502, statusText: 'Bad Gateway' });
    await settle();

    expect(text()).toContain('could not be loaded');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: FAIL — `Failed to resolve import "./brp-list-page"`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/employee-portal/src/app/features/reference-data/brp-list-page.ts`:

```ts
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { PpBadge, PpCard, PpGridHead, PpGridRow, PpGridTable } from '@peakpower-nl/shared-ui';
import { EmployeeApiClient, type Brp } from '@peakpower-nl/api-client-employee';

@Component({
  selector: 'pp-brp-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PpBadge, PpCard, PpGridHead, PpGridRow, PpGridTable],
  styles: `
    :host { display: grid; gap: 16px; }
    .empty { margin: 0; color: var(--pp-text-faint); }
  `,
  template: `
    <pp-card
      heading="Balance responsible parties"
      subtitle="The party financially responsible for a connection's imbalance"
    >
      <p class="empty">
        This list is read-only in this slice. Parties are seeded with the database and editing
        arrives with the reference-data feature.
      </p>

      @if (brps.error()) {
        <p class="empty">
          The list of balance responsible parties could not be loaded. The employee API did not
          answer; try again, and check that it is running.
        </p>
      } @else if (brps.isLoading()) {
        <p class="empty">Loading balance responsible parties…</p>
      } @else if (rows().length > 0) {
        <pp-grid-table columns="0.8fr 2fr 0.8fr">
          <div ppGridHead>
            <span>Code</span>
            <span>Name</span>
            <span>Status</span>
          </div>
          @for (brp of rows(); track brp.id) {
            <div ppGridRow>
              <span>{{ brp.code }}</span>
              <span>{{ brp.name }}</span>
              <span>
                <pp-badge [tone]="brp.isActive ? 'success' : 'neutral'">
                  {{ brp.isActive ? 'Active' : 'Inactive' }}
                </pp-badge>
              </span>
            </div>
          }
        </pp-grid-table>
      } @else {
        <p class="empty">
          No balance responsible parties are seeded yet. Migration 1 seeds the PVNed row; run the
          migrator and reload.
        </p>
      }
    </pp-card>
  `,
})
export class BrpListPage {
  private readonly api = inject(EmployeeApiClient);

  readonly brps = httpResource<Brp[]>(() => this.api.brpsUrl());
  readonly rows = computed<Brp[]>(() => this.brps.value() ?? []);
}
```

Create `apps/employee-portal/src/app/features/reference-data/reference-data.routes.ts`:

```ts
import type { Routes } from '@angular/router';

export const REFERENCE_DATA_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'brps' },
  {
    path: 'brps',
    title: 'Balance responsible parties · PeakPower back office',
    loadComponent: () => import('./brp-list-page').then((m) => m.BrpListPage),
  },
];
```

Modify `apps/employee-portal/src/app/app.routes.ts` to the full file below — the only change from
Task 7 is the `reference-data` entry:

```ts
import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: 'home',
    title: 'Home · PeakPower back office',
    loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage),
  },
  {
    path: 'customers',
    loadChildren: () =>
      import('./features/customers/customers.routes').then((m) => m.CUSTOMERS_ROUTES),
  },
  {
    path: 'reference-data',
    loadChildren: () =>
      import('./features/reference-data/reference-data.routes').then(
        (m) => m.REFERENCE_DATA_ROUTES,
      ),
  },
  { path: '**', redirectTo: 'home' },
];
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal`
Expected: PASS — 5 tests in `brp-list-page.spec.ts`, and every earlier spec still green.

- [ ] **Step 5: Walk the whole portal against the running API**

Run, from `peakpower-platform`, `./dev-up`, then open `http://localhost:4201` and walk this path:

1. Home shows eight nav rows, five disabled with their sentences.
2. Customers lists the seeded companies; typing filters them; an unmatched term names itself in
   the empty state.
3. Open a customer: the two columns are 1.6fr / 1fr, the accounts table marks the admin, the
   connections table shows the grouped EAN and the BRP.
4. Edit the company, submit a KvK number of `123`, and see the API's message appear under the KvK
   field rather than a browser-side one.
5. Create an account, then deactivate it and confirm the badge changes.
6. Attach a connection with an EAN already held by another customer for an overlapping period,
   and see the exclusion constraint's rejection appear under the EAN field.
7. Reference data lists the seeded PVNed row.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/employee-portal/src/app/app.routes.ts \
  apps/employee-portal/src/app/features/reference-data
git commit -m "feat(employee-portal): add the balance responsible party reference list"
```

---

## Definition of done

1. `npm run test:workspace` passes — 14 tests across `tools/openapi-clients.test.mjs` and
   `tools/verify-clients.test.mjs`.
2. `npm run test:employee-portal` passes — every spec listed in this plan, with no skipped tests.
3. `npm run generate:clients` writes
   `libs/api-client-employee/src/generated/employee-schema.d.ts`, and that file is committed.
4. `npm run verify:clients` exits 0 on a clean tree, and exits 1 naming a line number after any
   hand-edit of the generated file or any change to `employee.json` that has not been regenerated.
   This is the condition that replaces the package registry; without it the committed client rots
   silently and the two repositories drift.
5. `npm run build:employee-portal` completes with no TypeScript errors under
   `typescript@6.0.3`.
6. `npm run start:employee-portal` serves the application on port 4201, proxying `/api` to the
   employee API.
7. The rail shows all eight back-office areas. Customers and Reference data navigate; Trade desk,
   Wallets, Settlements, Data & feeds and Audit render disabled, each with a sentence naming the
   feature it waits on.
8. An employee can list and search customers, open one, create and edit a company, create, edit
   and deactivate an account, and attach, edit and end-date a metering point.
9. No screen prints a wire enum value — every status, expectation and source renders through
   `apps/employee-portal/src/app/shared/labels.ts` in sentence case.
10. No screen renders `pp-grid-table` with zero rows; every empty state names its reason, and
    every disabled state names why.
11. No KvK or EAN rule exists in TypeScript. Every one of those messages on screen came from an
    RFC 7807 response. There is no IBAN on any employee screen at all — bank details are
    collected once, in Plan 5's onboarding.
12. The customer detail screen's layout element carries `grid-template-columns: 1.6fr 1fr`.
13. There is no company switcher and no `customer_id` anywhere in `apps/employee-portal` — the
    employee API is not tenant-scoped. Check it:
    `grep -rn "customer_id\|switcher" apps/employee-portal/src` returns nothing.
14. `grep -rn "localStorage\|sessionStorage" apps/employee-portal/src` returns nothing.
15. `grep -rn "bypassSecurityTrust\|innerHTML" apps/employee-portal/src` returns nothing —
    design §8.5 bans both, and `[security §6]` bans the first outright.
16. No tone is spelled the design system's old way. Check it:
    `grep -rn "tone=\"positive\"\|tone=\"danger\"\|'positive'\|'danger'" apps/employee-portal/src`
    returns nothing — shared contract §10.1 spells them `'success'` and `'critical'`, and
    `danger` survives only as a `pp-button` **variant**, never as a tone.
17. Every `<pp-app-shell>` binds `sections`, `activeRouteKey` and `productName`; §10.1 makes the
    last two required, so a missing one is a strict-template compile error rather than a blank
    rail.

## New names introduced

Names this plan uses that the shared contract does not define. Each is listed with its exact
signature so the consistency pass can reconcile it against the plan that owns it.

### Owned by this plan — no other plan needs to agree

```ts
// tools/openapi-clients.mjs
export const BANNER: string;
export const WEB_ROOT: string;
export const CLIENTS: readonly { name: string; document: string; output: string }[];
export function resolvePlatformRoot(env?: NodeJS.ProcessEnv): string;
export function generateTypes(documentPath: string): Promise<string>;
export function writeClient(client): Promise<string>;
export function readCommitted(client): Promise<string | null>;
export function firstDifferenceLine(expected: string, actual: string): number;
export function checkClient(client): Promise<{
  name: string; stale: boolean; reason: 'ok' | 'missing' | 'drift'; line: number;
}>;

// npm scripts on the peakpower-web root package.json
"generate:clients" | "verify:clients"      // the only two scripts this plan adds;
                                          // start/build/test:employee-portal and
                                          // test:workspace are Plan 3's

// libs/api-client-employee — @peakpower-nl/api-client-employee
export const EMPLOYEE_API_BASE_URL: InjectionToken<string>;
export class EmployeeApiClient { /* see Task 3 Interfaces for every member */ }
export interface ValidationProblemDetails {
  type?: string; title?: string; status?: number; detail?: string; instance?: string;
  errors?: Record<string, string[]>;
}
export function isValidationProblem(value: unknown): value is ValidationProblemDetails;
export function provideEmployeeApiTesting(baseUrl?: string): EnvironmentProviders;
// type aliases over the generated schema
export type Address, ContactPerson, CustomerListItem, CustomerListResponse, CustomerDetail,
  Account, MeteringPoint, Brp, CreateCustomerRequest, UpdateCustomerRequest,
  CreateAccountRequest, UpdateAccountRequest, AttachMeteringPointRequest,
  UpdateMeteringPointRequest, EndDateMeteringPointRequest, CustomerStatusValue,
  AccountStatusValue, ProductionExpectationValue, ProductionExpectationSourceValue;

// apps/employee-portal
export const EMPLOYEE_NAV: PpNavSection[];
export function routeKeyForUrl(url: string): string;
export function crumbForUrl(url: string): string;
export const SERVER_ERROR_KEY = 'server';
export function normaliseProblemKey(key: string): string;
export function applyProblemDetails(form: FormGroup, problem: ValidationProblemDetails): string[];
export function serverError(control: AbstractControl | null): string | null;
export function customerStatusLabel(value: CustomerStatusValue): string;
export function customerStatusTone(value: CustomerStatusValue): PpTone;
export function accountStatusLabel(value: AccountStatusValue): string;
export function accountStatusTone(value: AccountStatusValue): PpTone;
export function productionExpectationLabel(value: ProductionExpectationValue): string;
export function expectationSourceLabel(
  value: ProductionExpectationSourceValue | null | undefined): string;
export const CUSTOMER_STATUS_OPTIONS: readonly {
  value: CustomerStatusValue; label: string }[];
export const PRODUCTION_EXPECTATION_OPTIONS: readonly {
  value: ProductionExpectationValue; label: string }[];
export const EXPECTATION_SOURCE_OPTIONS: readonly {
  value: ProductionExpectationSourceValue; label: string }[];
export const DETAIL_GRID = '1.6fr 1fr';
export type AddressFormGroup = FormGroup<{
  street: FormControl<string>; houseNumber: FormControl<string>;
  houseNumberSuffix: FormControl<string>; postalCode: FormControl<string>;
  city: FormControl<string>; country: FormControl<string>;
}>;
export function buildAddressGroup(): AddressFormGroup;
export class PpFormField;        // selector 'pp-form-field',  inputs: label, for, hint, error
export class PpAddressFields;    // selector 'pp-address-fields', inputs: group, idPrefix
export class App;                // selector 'pp-root'
export class HomePage;           // selector 'pp-home-page'
export class CustomerListPage;   // selector 'pp-customer-list-page'
export class CustomerDetailPage; // selector 'pp-customer-detail-page'
export class CustomerFormPage;   // selector 'pp-customer-form-page'
export class AccountFormPage;    // selector 'pp-account-form-page'
export class MeteringPointFormPage; // selector 'pp-metering-point-form-page'
export class BrpListPage;        // selector 'pp-brp-list-page'
export const routes: Routes;
export const CUSTOMERS_ROUTES: Routes;
export const REFERENCE_DATA_ROUTES: Routes;
export const appConfig: ApplicationConfig;
```

### Assumed from Plan 3 (`@peakpower-nl/shared-ui`)

**Nothing.** The whole `@peakpower-nl/shared-ui` surface this plan binds — `PpTone`, `PpNavItem`,
`PpNavSection`, `PpAppShell`, `PpCard`, `PpBadge`, `PpButton`, `PpBanner`, `PpGridTable`,
`PpGridHead`, `PpGridRow`, `PpSearchInput` — is declared normatively in shared contract §10.1 and
reproduced under **What this plan consumes from Plan 3** above. Plan 3 implements it; this plan
only imports it; neither plan may vary it. The same section fixes the two file names this plan
depends on: the barrel is `libs/shared-ui/src/public-api.ts`, and the workspace TypeScript config
is `tsconfig.json`.

Two token names, also from §10.1 and §11 rather than from this plan: `--pp-canvas`, the page
ground, defined by Plan 3 in `libs/shared-ui/src/styles/colors.css`; and `--pp-text`,
`--pp-text-faint` and `--pp-red-text` in `libs/shared-ui/src/styles/tokens.css`.

### Assumed from Plan 2 (the employee API) — Plan 2 must agree

The `components.schemas` keys in `artifacts/openapi/employee.json`, and the property names on
each. Task 1 Step 6 checks every one of them against the real document before any screen is
written.

```
CustomerListResponse { items: CustomerListItemDto[]; total: number }
CustomerListItemDto  { id; legalName; tradeName; kvkNumber; status; city; accountCount;
                       meteringPointCount }
CustomerDetailDto    { id; legalName; tradeName; kvkNumber; vatNumber; status; fourEyesEnabled;
                       billingAddress; visitingAddress; primaryContact; internalReference;
                       locale; accounts: AccountDto[]; meteringPoints: MeteringPointDto[] }
AccountDto           { id; customerId; username; firstName; lastName; jobTitle; email; phone;
                       status; isAdmin; lastLoginAt }
MeteringPointDto     { id; customerId; ean; eanDisplay; commodity; brpId; brpName;
                       productionExpectation; expectationSource; name; description;
                       gridOperator; capacityKw; address; validFrom; validTo; displayLabel }
BrpDto               { id; code; name; isActive }
AddressDto           { street; houseNumber; houseNumberSuffix; postalCode; city; country }
ContactPersonDto     { name; email; phone }
CreateCustomerRequest { legalName; tradeName; kvkNumber; vatNumber;
                        internalReference; locale; billingAddress; visitingAddress;
                        primaryContact }
UpdateCustomerRequest { legalName; tradeName; vatNumber; internalReference; locale;
                        billingAddress; visitingAddress; primaryContact; status }
                      — NOT the same shape as CreateCustomerRequest: no kvkNumber, plus status
CreateAccountRequest  { username; firstName; lastName; jobTitle; email; phone; isAdmin }
UpdateAccountRequest  { firstName; lastName; jobTitle; email; phone; isAdmin }
AttachMeteringPointRequest { ean; brpId; productionExpectation; expectationSource; name;
                             description; gridOperator; capacityKw; address; validFrom }
UpdateMeteringPointRequest { brpId; productionExpectation; expectationSource; name;
                             description; gridOperator; capacityKw; address }
EndDateMeteringPointRequest { validTo }
```

Two of those go beyond what the shared contract states, and each one is a convenience Plan 2
supplies rather than a shape the contract fixes:

- **`MeteringPointDto.eanDisplay`** — the grouped EAN string `[F01-R31]`. The contract puts
  `ToDisplayString()` on the domain type, so the DTO carries its output rather than have the
  browser re-implement the grouping.
- **`MeteringPointDto.brpName`** — so the connections table does not need a second request per
  row to name the BRP.

Two further assumptions that are not names but are load-bearing:

- Enum values cross the wire in the **database spelling** (`PENDING_APPROVAL`, not
  `PendingApproval`). That is shared contract §5.2 rather than an assumption of this plan's, and
  Task 1 Step 6 verifies it against the generated file.
- `GET /customers` accepts `?q=` and returns every customer when it is absent.
