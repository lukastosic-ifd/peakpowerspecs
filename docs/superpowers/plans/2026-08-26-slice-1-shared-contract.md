# Slice 1 — Shared Contract

> Referenced by every slice-1 plan. **This file is normative.** Where a plan and this
> file disagree, this file wins and the plan is wrong. Names here are the ones that cross
> plan boundaries, so changing one is a change to several plans at once.

**Design:** [`../specs/2026-08-26-poc-slice-1-design.md`](../specs/2026-08-26-poc-slice-1-design.md)

---

## 1. Versions — exact, verified 2026-08-26

| | |
| --- | --- |
| .NET SDK | **10.0.400** (installed, default) |
| EF Core | **10.x** |
| PostgreSQL | **17** (Testcontainers + Aspire) |
| Aspire | **13.5.3** — `aspire.cli` global tool + `Aspire.AppHost.Sdk`. **NOT a `dotnet workload`.** |
| Angular | **22** (`@angular/cli` 22.1.6) |
| Node / npm | **24.15.0 / 11.12.1** |
| Docker | 29.7.2, daemon must be running |

## 2. Repositories

```
/Users/thinhhuynh/PeakPower/peakpower-platform      # .NET   — siblings, and the
/Users/thinhhuynh/PeakPower/peakpower-web           # Angular — AppHost relies on it
```

`git init` in both. **No remotes, no CI, no package registry, no deployment** in slice 1.
Commit locally and often.

## 3. Naming

- .NET namespace root `PeakPower.` — e.g. `PeakPower.Domain.Customers`
- npm scope `@peakpower/` — kept even though no such GitHub org exists yet `[OQ-100]`
- Database: snake_case, singular, schema-qualified — `customer.metering_point`
- C#: PascalCase; EF Core maps to snake_case via a naming convention, not per-property attributes

## 3.1 Projects — fifteen, not thirteen

Design §4.2 lists thirteen. Four infrastructure projects are implied by this contract but
missing from that list, and one of them (`Infrastructure.Time`) is named by architecture fact 5.

```
src/Hosts/          AppHost · ServiceDefaults · Api.Customer · Api.Employee · Migrator
src/Core/           Domain · Application · Contracts
src/Infrastructure/ Persistence · Time · Web · Identity · Email
tests/              Domain.Tests · Application.Tests · Integration.Tests · Architecture.Tests
```

Eleven source projects, four test projects. Design §10 proposes the correction upstream.

## 3.2 Migrations — migration 1 does not create every table

Design §5.1 lists nine tables under "migration 1", but three of them —
`onboarding_application`, `refresh_token`, `password_reset_token` — have column sets only plan 5
can specify. Guessing them in plan 1 would be inventing plan 5's work.

| Migration | Creates | Written by |
| --- | --- | --- |
| 1 | extensions, schemas, `customer`, `customer_account`, `metering_point`, `brp`, `wallet`, `audit_record` | plan 1 |
| 2 | RLS roles and policies | plan 2 |
| 3 | `onboarding_application`, `refresh_token`, `password_reset_token`, and their policies | plan 5 |
| 4 | the shared EAN pool | plan 6 |

⚠ **RLS needs database roles the design never mentions.** A superuser or table owner *bypasses*
RLS silently, so running the APIs on Aspire's default connection would disable the whole
mechanism while every test still passed. Migration 2 creates `app_customer_role` and
`app_employee_role` plus two non-owner **login** roles, and each host rewrites its connection
string onto its own role. Slice 1 is local-only with no deployment, so those two passwords are
literals in the migration with a comment saying exactly that — **this needs an owner before
anything is deployed anywhere.** Registered as `[OQ-102]`.

## 4. Enums — the database spelling is normative

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

All enums persist as **text**, via a single EF Core value converter registered by convention,
not one converter per property.

## 5. Domain — types that cross plan boundaries

```csharp
namespace PeakPower.Domain.Common;

public readonly record struct EanCode           // 18 digits. Slice 1 does NOT check the
{                                               // GS1 check digit — [DEC-114].
    public string Value { get; }
    public static Result<EanCode> Create(string raw);
    public string ToDisplayString();            // grouped for reading  [F01-R31]
}

public readonly record struct KvkNumber          // exactly 8 digits  [F01-R03]
{
    public string Value { get; }
    public static Result<KvkNumber> Create(string raw);
}

public readonly record struct Iban               // structural + ISO 7064 mod-97  [F01-R03]
{
    public string Value { get; }
    public static Result<Iban> Create(string raw);
}

public sealed class Result<T>                    // no exceptions for validation failures
{
    public bool IsSuccess { get; }
    public T Value { get; }
    public string Error { get; }
    public static Result<T> Success(T value);
    public static Result<T> Failure(string error);
}
```

```csharp
namespace PeakPower.Domain.Customers;

public sealed class Customer                     // aggregate root
{
    public Guid Id { get; }
    public string LegalName { get; }
    public string? TradeName { get; }
    public KvkNumber KvkNumber { get; }
    public string? VatNumber { get; }
    public CustomerStatus Status { get; }
    public bool FourEyesEnabled { get; }         // [DEC-71] — column only in slice 1
    public Address BillingAddress { get; }
    public Address? VisitingAddress { get; }
    public ContactPerson PrimaryContact { get; }
    public string? InternalReference { get; }
    public string Locale { get; }                // default "nl-NL"
}

public sealed class CustomerAccount              // aggregate root
{
    public Guid Id { get; }
    public Guid CustomerId { get; }
    public string Username { get; }              // citext, unique platform-wide, immutable
    public string FirstName { get; }
    public string LastName { get; }
    public string? JobTitle { get; }             // descriptive only, never checked
    public string Email { get; }                 // citext
    public string? Phone { get; }
    public AccountStatus Status { get; }
    public bool IsAdmin { get; }                 // [DEC-71] — column only in slice 1
    public string? PasswordHash { get; }         // Argon2id  [DEC-113]
    public Guid SecurityStamp { get; }           // bumped to revoke every token  [DEC-117]
    public string? ExternalSubjectId { get; }    // reserved for Entra; null in slice 1
    public DateTimeOffset? LastLoginAt { get; }
}

public sealed class MeteringPoint                // aggregate root
{
    public Guid Id { get; }
    public Guid CustomerId { get; }
    public EanCode Ean { get; }
    public Commodity Commodity { get; }
    public Guid BrpId { get; }                                    // mandatory  [F01-R51]
    public ProductionExpectation ProductionExpectation { get; }
    public ProductionExpectationSource? ExpectationSource { get; }
    public string? Name { get; }                 // <= 80   [F01-R29]
    public string? Description { get; }          // <= 500  [F01-R29]
    public string? GridOperator { get; }
    public decimal? CapacityKw { get; }
    public Address? Address { get; }
    public DateOnly ValidFrom { get; }
    public DateOnly? ValidTo { get; }            // half-open [ValidFrom, ValidTo)

    public string DisplayLabel { get; }          // Name ?? Ean.ToDisplayString()  [F01-R30/31]
}

public sealed record Address(
    string Street, string HouseNumber, string? HouseNumberSuffix,
    string PostalCode, string City, string Country);            // stored as jsonb

public sealed record ContactPerson(
    string Name, string Email, string? Phone);                  // stored as jsonb
```

## 5.1 Aggregate behaviour — NORMATIVE, and owned by plan 1 alone

⚠ **Plan 1 is the only plan that declares an aggregate's members.** Plans 2, 5 and 6 *call* these
and must never re-declare them — two plans writing the same class is a duplicate-member compile
error, not a merge.

Every operation that can fail returns `Result<T>`. Only the two book-keeping mutators return
`void`, because neither can fail.

```csharp
// ── Customer ────────────────────────────────────────────────────────────────
static Result<Customer> Create(
    string legalName, string? tradeName, KvkNumber kvkNumber, string? vatNumber,
    Address billingAddress, Address? visitingAddress, ContactPerson primaryContact,
    string? internalReference, string locale);          // locale: pass "nl-NL"

Result<Customer> ChangeStatus(CustomerStatus status);   // NOT SetStatus
Result<Customer> UpdateDetails(
    string legalName, string? tradeName, string? vatNumber,
    Address billingAddress, Address? visitingAddress, ContactPerson primaryContact,
    string? internalReference, string locale);

// ── CustomerAccount ─────────────────────────────────────────────────────────
static Result<CustomerAccount> Create(
    Guid customerId, string username, string firstName, string lastName,
    string? jobTitle, string email, string? phone, AccountStatus status, bool isAdmin);

Result<CustomerAccount> UpdateProfile(
    string firstName, string lastName, string? jobTitle, string email,
    string? phone, bool isAdmin);
Result<CustomerAccount> Deactivate();                   // also bumps SecurityStamp

void SetPassword(string passwordHash);                  // bumps SecurityStamp
void RecordSuccessfulSignIn(DateTimeOffset at);
void BumpSecurityStamp();

// ── MeteringPoint ───────────────────────────────────────────────────────────
// The factory is Attach, NOT Create — [F01-R23] is "attach a metering point to a
// customer". Commodity is not a parameter: [DEC-68] makes ELECTRICITY the only value,
// so the aggregate sets it. ValidTo is not a parameter either; use EndDate.
static Result<MeteringPoint> Attach(
    Guid customerId, EanCode ean, Guid brpId,
    ProductionExpectation productionExpectation, ProductionExpectationSource? expectationSource,
    string? name, string? description, string? gridOperator, decimal? capacityKw,
    Address? address, DateOnly validFrom);

Result<MeteringPoint> EndDate(DateOnly validTo);        // NOT EndOn
Result<MeteringPoint> Rename(string? name, string? description);   // <=80 / <=500
Result<MeteringPoint> UpdateDetails(
    Guid brpId, ProductionExpectation productionExpectation,
    ProductionExpectationSource? expectationSource, string? gridOperator,
    decimal? capacityKw, Address? address);

// ── Brp (PeakPower.Domain.Metering) ─────────────────────────────────────────
public sealed class Brp
{
    public Guid Id { get; }
    public string Code { get; }        // "PVNED"
    public string Name { get; }        // "PVNed B.V."  — this exact string
    public bool IsActive { get; }      // plan 4's reference-data screen renders it
}
static Result<Brp> Create(string code, string name, bool isActive);

// ── Wallet ──────────────────────────────────────────────────────────────────
static Result<Wallet> CreateEuroWallet(Guid customerId);   // NOT CreateFor
```

**Host entry-point marker types.** Both API hosts would otherwise declare
`public partial class Program`, and the integration-test assembly references both — a bare
`WebApplicationFactory<Program>` is then ambiguous. Each host declares a marker instead:

```csharp
public sealed class CustomerApiEntryPoint;    // PeakPower.Api.Customer
public sealed class EmployeeApiEntryPoint;    // PeakPower.Api.Employee
```

Tests use `WebApplicationFactory<CustomerApiEntryPoint>` / `<EmployeeApiEntryPoint>`. **No host
declares `public partial class Program`.**

## 5.2 Enum wire format — SCREAMING_SNAKE, everywhere

§4 makes the database spelling normative, and that extends to JSON. `ACTIVE`, not `"Active"`.
Both APIs register **one shared `JsonStringEnumConverter`** mapping each enum to its database
spelling; no mapper calls `.ToString()` on an enum, and no client hard-codes PascalCase.

## 6. Application ports

**Where each port is declared and implemented.** Every interface below is *declared* in
`PeakPower.Application.Abstractions`. They are *implemented* in:

| Port | Implementation lives in | Written by |
| --- | --- | --- |
| `ICustomerContext` | `PeakPower.Infrastructure.Web` | plan 2 (dev), plan 5 (token-backed) |
| `IEmployeeContext` | `PeakPower.Infrastructure.Web` | plan 2 |
| `IMarketCalendar` | `PeakPower.Infrastructure.Time` | plan 1 |
| `IEmailSender` | `PeakPower.Infrastructure.Email` (console sink) | plan 5 |
| `IPasswordHasher` | `PeakPower.Infrastructure.Identity` | plan 5 |
| `ITokenIssuer` | `PeakPower.Infrastructure.Identity` | plan 5 |

```csharp
namespace PeakPower.Application.Abstractions;

// Declared in PeakPower.Application.Abstractions. IMPLEMENTED in
// PeakPower.Infrastructure.Web — the ONE context-provider assembly, allow-listed by
// architecture fact 6. Both the development provider (plan 2) and the token-backed provider
// (plan 5) live there. Do NOT put a provider inside an API host.
public interface ICustomerContext                // THE tenancy seam  [F13-R30]
{
    Guid CustomerId { get; }
    Guid AccountId { get; }
    bool IsAdmin { get; }
    bool IsAuthenticated { get; }
}

public interface IEmployeeContext                // the back office is not tenant-scoped
{
    string EmployeeId { get; }
    bool IsAuthenticated { get; }
}

public interface IEmailSender                    // console sink in slice 1
{
    Task SendAsync(string to, string subject, string body, CancellationToken ct);
}

public interface IMarketCalendar                 // the ONLY source of "now"
{
    DateTimeOffset UtcNow { get; }
    DateOnly TodayInAmsterdam { get; }
}

public interface IPasswordHasher                 // Argon2id  [DEC-113]
{
    string Hash(string password);
    bool Verify(string password, string hash);
}

public interface ITokenIssuer                    // ES256 over JWKS  [DEC-117]
{
    AccessToken IssueAccessToken(CustomerAccount account);
    string IssueRefreshToken(Guid accountId, out DateTimeOffset expiresAt);
}

public sealed record AccessToken(string Jwt, DateTimeOffset ExpiresAt);
```

## 7. JWT claims — `[DEC-117]`

| Claim | Type | Meaning |
| --- | --- | --- |
| `sub` | guid string | `CustomerAccount.Id` |
| `customer_id` | guid string | the company — the ONLY source `ICustomerContext` may read |
| `is_admin` | `"true"` / `"false"` | the `[DEC-71]` flag |
| `amr` | string array | how they authenticated — `["pwd"]` in slice 1 |
| `stamp` | guid string | `CustomerAccount.SecurityStamp`, compared per request |

Access token 15 minutes, ES256. Refresh token 14 days, rotating, single-use, stored hashed.

## 8. HTTP

- Base path `/api/v1`; errors are RFC 7807 `application/problem+json`
- Cross-tenant reads return **404, never 403** `[F13-R19]`
- Access token in `Authorization: Bearer`; refresh token in an HttpOnly, `Secure`,
  `SameSite=Strict` cookie named `pp_refresh`, path-scoped to `/api/v1/auth/refresh`
- The customer access token is held **in memory only** in the browser — never `localStorage`

## 9. Database

Schemas `customer`, `metering`, `wallet`, `audit`.

```
customer.customer                 customer.customer_account
customer.onboarding_application   customer.refresh_token
customer.password_reset_token     customer.metering_point
metering.brp                      wallet.wallet
audit.audit_record
```

Migration 1 **must** begin with:

```sql
CREATE EXTENSION IF NOT EXISTS citext;      -- username, email
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- equality inside a GiST exclusion constraint
```

and `customer.metering_point` **must** carry:

```sql
validity daterange GENERATED ALWAYS AS (daterange(valid_from, valid_to, '[)')) STORED,
EXCLUDE USING gist (ean WITH =, validity WITH &&)
```

`uuid` primary keys via `gen_random_uuid()`. Money `numeric(18,6)`. Timestamps `timestamptz`.

## 10. Angular

```
peakpower-web/
├── package.json                        # ONE workspace at the root
├── apps/customer-portal/               # start:customer-portal
├── apps/employee-portal/               # start:employee-portal
├── libs/shared-ui/                     # @peakpower/shared-ui
├── libs/api-client-customer/           # @peakpower/api-client-customer  (generated, committed)
└── libs/api-client-employee/           # @peakpower/api-client-employee  (generated, committed)
```

Standalone components throughout · signals for state · lazy-loaded feature routes ·
strictly typed reactive forms · **no** `NgModule`.

Component selectors are prefixed `pp-`: `pp-card`, `pp-stat-card`, `pp-badge`, `pp-button`,
`pp-banner`, `pp-ds-banner`, `pp-grid-table`, `pp-search-input`, `pp-app-shell`.

> ⚠ **`AddNpmApp` does not exist in Aspire 13.5.3.** Verified 2026-08-26 by reading the XML
> documentation inside `Aspire.Hosting.JavaScript` 13.5.3: `Aspire.Hosting.NodeJs` is frozen at
> 9.5.2, and the current package exposes only `AddJavaScriptApp`, `AddNodeApp` and `AddViteApp`.
> The specification's AppHost snippet is written against the 9.x API and **will not compile**.
>
> The replacement is:
>
> ```csharp
> // Aspire.Hosting.JavaScriptHostingExtensions
> AddJavaScriptApp(this IDistributedApplicationBuilder builder,
>                  string name, string appDirectory, string runScriptName /* default "dev" */)
> ```
>
> Two things are wrong with the specification's call and both are fixed by the same line. It
> passes `$"{webRoot}/apps/customer-portal"` as the directory, but the workspace declares
> exactly **one** `package.json`, at the root — so there is no script to run in that folder.
> Use the workspace root plus a per-app script name:
>
> ```csharp
> builder.AddJavaScriptApp("customer-portal", webRoot, "start:customer-portal")
>        .WithReference(customerApi)
>        .WithHttpEndpoint(env: "PORT")
>        .WithExternalHttpEndpoints();
> ```
>
> This is why `package.json` must define `start:customer-portal` and `start:employee-portal` at
> the **root**, not `start` inside each app.

## 10.1 `@peakpower/shared-ui` public API — NORMATIVE

⚠ **Plan 3 owns these components; plans 4 and 6 only consume them.** Where the two sides
disagreed, the consumers' shape won, because two plans call it and one defines it.

```ts
// libs/shared-ui/src/public-api.ts   ← this filename. NOT index.ts.
// The workspace TypeScript config is tsconfig.json. NOT tsconfig.base.json.

export type PpTone =
  | 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'critical';
// Map the design system's vocabulary onto these. 'positive' is 'success';
// 'danger' is 'critical'. Those two spellings must not appear anywhere.

@Component({ selector: 'pp-card' })
class PpCard { heading = input<string>(); subtitle = input<string>(); }   // heading, NOT title

@Component({ selector: 'pp-stat-card' })
class PpStatCard {
  label = input.required<string>(); value = input.required<string>();
  sublabel = input<string>(); tone = input<PpTone>('neutral');
}

@Component({ selector: 'pp-badge' })
class PpBadge { tone = input<PpTone>('neutral'); }

@Component({ selector: 'pp-button' })
class PpButton {
  variant = input<'primary'|'secondary'|'ghost'|'danger'|'accept'>('secondary');
  size = input<'md'|'sm'>('md'); disabled = input(false);
}

@Component({ selector: 'pp-banner' })     // the compact in-page notice
class PpBanner { tone = input<PpTone>('info'); heading = input<string>(); }

@Component({ selector: 'pp-ds-banner' })  // the larger 22px-dot banner — a DIFFERENT component
class PpDsBanner { tone = input<PpTone>('info'); heading = input.required<string>(); }

@Component({ selector: 'pp-grid-table' })
class PpGridTable {
  columns = input.required<string>();          // the verbatim grid-template-columns string
  density = input<'default'|'dense'>('default');
  // Head and rows are CONTENT-PROJECTED. There is no rows input.
}
@Directive({ selector: '[ppGridHead]' }) class PpGridHead {}   // ALL-CAPS column heads
@Directive({ selector: '[ppGridRow]' })  class PpGridRow {}

@Component({ selector: 'pp-search-input' })
class PpSearchInput { placeholder = input('Search'); value = model<string>(''); }

export interface PpNavItem {
  routeKey: string;          // the SPECIFICATION's key: 'consumption', 'trading', 'wallet'
  label: string;             // the DESIGN's label: 'Volume', 'Trades', 'Balance'
  path: string | null;       // null when the item is disabled
  dot: string;               // the domain colour, a CSS custom-property reference
  disabledReason?: string;   // rendered verbatim; a disabled item MUST carry one
}
export interface PpNavSection { label: string; items: PpNavItem[]; }

@Component({ selector: 'pp-app-shell' })
class PpAppShell {
  sections = input.required<PpNavSection[]>();   // the grouped rail — design §8.4
  activeRouteKey = input.required<string>();
  productName = input.required<string>();
  crumb = input<string>(); subtitle = input<string>();   // a crumb OR a subtitle, never both
}
```

Navigation is by `routerLink` on each item's `path`; `PpAppShell` has **no `navigate` output**.

One extra token plans 4 and 6 both use: **`--pp-canvas`**, defined in
`libs/shared-ui/src/styles/colors.css` as the page ground (`var(--pp-bg-gradient)`).

## 11. Design tokens — SB-2026

Source of truth is the **PeakPower Trading Design System** project in Claude Design
(`tokens/*.css`, 13 primitives each with a `.d.ts`). Port those files; do not re-derive values
from the prototype HTML.

Two rules that must survive the port, because breaking either silently drops an 11px badge
to 2:1 contrast:

1. **A bright hex is a fill, a mark or a chart series.** Anything that becomes text or a
   numeral reads the paired darker tier. `--pp-cyan` (`#00D4C6`) has **no** pair — text falls
   back to `--pp-teal-text`.
2. **`--pp-indigo` means violet / corrected, never the hedge line.**

Drop `--certainty-provisional-opacity`; the certainty layer was removed and the token is dead.

Key metrics: sidebar 236px · topbar 64px · card `18px 20px` · stat card `14px 16px`
(no `flex:1`, 3px `::before` accent cap) · badge 11px/600 `4px 12px` pill, 1px border on every
tone · button 13px/600 `10px 20px`, `border:1px solid` on **every** variant · page gap 16px
(20px on Dashboard only) · radii 6/8/12/pill.

## 12. Copy rules

Sentence case everywhere. ALL CAPS only for stat-card labels and table column heads.
**No emoji, no icon set** — the only glyphs are the brand mark, one magnifier, `▲▼`, `→›`.
Every number carries its provenance in a faint sublabel. **"Projected"** = not yet measured;
**"Provisional"** = not yet accepted — never swap them. Empty and disabled states name the
reason. nl-NL numbers: `€ 19.722,00`, `385,4 MWh`, minus is U+2212 `−`.

## 13. Testing

| Layer | Tooling |
| --- | --- |
| Domain / Application unit | xUnit + **Shouldly 4.3.0** + NSubstitute — **never FluentAssertions**, see below |
| Persistence & integration | Testcontainers, real PostgreSQL 17 |
| Architecture | NetArchTest |
| OpenAPI contract | Verify snapshot |
| Frontend unit | Vitest |
| E2E | Playwright, in `peakpower-web` |

**Package versions verified on nuget.org, 2026-08-26** — use these, do not guess:

| Package | Version | Note |
| --- | --- | --- |
| `Aspire.AppHost.Sdk` | **13.5.3** | |
| `Aspire.Hosting.JavaScript` | **13.5.3** | ⚠ `Aspire.Hosting.NodeJs` is frozen at 9.5.2 — do not use it |
| `Konscious.Security.Cryptography.Argon2` | **1.3.1** | the Argon2id hasher `[DEC-113]` |
| `NetArchTest.Rules` | **1.3.2** | the six architecture facts |
| `Testcontainers.PostgreSql` | **4.14.0** | real PostgreSQL 17 in tests |
| `Shouldly` | **4.3.0** | ⚠ **not FluentAssertions** `[DEC-118]` |
| `Mono.Cecil` | **0.11.6** | IL scanning for architecture facts 3-6 |

> ⚠ **Assert with Shouldly. FluentAssertions is not used at all** — `[DEC-118]`.
> Verified 2026-08-26 by reading the licence file inside the package: FluentAssertions 8.10.0
> ships an **Xceed Software Community License Agreement, "for Non-Commercial Use"**, where
> non-commercial means use whose primary objective is not commercial advantage. PeakPower is a
> commercial trading platform, so 8.x would need a paid Xceed licence. 7.2.0 is the last
> `Apache-2.0` release (confirmed from its `.nuspec`) — free, but the end of that line and no
> longer maintained. **Shouldly 4.3.0 is Apache-2.0 and actively maintained**, so it is the
> assertion library rather than a fallback. `verify-build-settings.sh` fails the build if
> FluentAssertions reappears in `Directory.Packages.props`.
>
> The syntax is `actual.ShouldBe(expected)`, not `actual.Should().Be(expected)`. Throwing is
> `Should.Throw<T>(act)` / `await Should.ThrowAsync<T>(act)`, which takes the delegate as an
> argument rather than extending it. The specification's testing table names FluentAssertions
> because it was written when the library was still open source; design §10 corrects it.


**Architecture facts.** Six of them, and they are not all NetArchTest — its model is
type-level dependency, and facts 3-6 are about *call sites*. `System.DateTime` is referenced
legitimately almost everywhere; only the `get_UtcNow` **call** is forbidden. Facts 3-6 therefore
use **Mono.Cecil** IL scanning.

| # | Fact | Tool | Owned by |
| --- | --- | --- | --- |
| 1 | `PeakPower.Domain` references no other project | NetArchTest | Plan 1 |
| 2 | `PeakPower.Application` references only `PeakPower.Domain` | NetArchTest | Plan 1 |
| 3 | `PeakPower.Ingestion` (when it exists) references no `Brp.*` adapter | Cecil | Plan 1 |
| 4 | No type calls `IgnoreQueryFilters()` | Cecil | **Plan 2** |
| 5 | No type outside `PeakPower.Infrastructure.Time` calls `DateTime.Now`, `DateTime.UtcNow`, `DateTime.Today`, `DateTimeOffset.Now` or `DateTimeOffset.UtcNow` | Cecil | Plan 1 |
| 6 | No type outside `PeakPower.Infrastructure.Web` uses `IHttpContextAccessor` or reads a claim off `ClaimsPrincipal` / `ClaimsIdentity` | Cecil | **Plan 2** |

Facts 4 and 6 belong to plan 2 because neither can be written before query filters and the
context-provider assembly exist. Plan 1 writes facts 1, 2, 3 and 5.

⚠ **Fact 6 is stated as its two mechanisms, not as intent.** "Reads a customer identifier from
`HttpContext`" is unenforceable — minimal-API handlers legitimately take `HttpContext`. Banning
the two ways a customer identifier can actually arrive is enforceable, and has the same effect.

## 14. Plan map

| Plan | Covers | Depends on |
| --- | --- | --- |
| 1 · Platform foundation | solution, arch tests, migration 1, domain, Aspire, `dev-up` | — |
| 2 · Tenancy & employee API | `ICustomerContext`, query filters, RLS, 404-not-403, employee endpoints, OpenAPI | 1 |
| 3 · Design system | `libs/shared-ui` — tokens + nine primitives | — (parallel with 1 and 2) |
| 4 · Employee portal | Angular app over plan 2's API using plan 3's primitives | 2, 3 |
| 5 · Auth & onboarding | JWT, password reset, the onboarding aggregate, customer auth API | 2 |
| 6 · Customer portal & close-out | customer API surface, the portal, seed data, E2E, spec PR | 3, 5 |
