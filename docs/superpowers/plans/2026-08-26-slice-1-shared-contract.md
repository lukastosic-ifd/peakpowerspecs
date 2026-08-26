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

## 6. Application ports

```csharp
namespace PeakPower.Application.Abstractions;

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
| Domain / Application unit | xUnit + FluentAssertions (+ NSubstitute for ports) |
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

**Architecture facts that must exist from week 1:**

1. `PeakPower.Domain` references no other project
2. `PeakPower.Application` references only `PeakPower.Domain`
3. `PeakPower.Ingestion` (when it exists) references no `Brp.*` adapter
4. No type calls `IgnoreQueryFilters()`
5. No type outside `PeakPower.Infrastructure.Time` uses `DateTime.Now` / `DateTime.UtcNow`
6. No type outside the context-provider assembly reads a customer identifier from `HttpContext`

## 14. Plan map

| Plan | Covers | Depends on |
| --- | --- | --- |
| 1 · Platform foundation | solution, arch tests, migration 1, domain, Aspire, `dev-up` | — |
| 2 · Tenancy & employee API | `ICustomerContext`, query filters, RLS, 404-not-403, employee endpoints, OpenAPI | 1 |
| 3 · Design system | `libs/shared-ui` — tokens + nine primitives | — (parallel with 1 and 2) |
| 4 · Employee portal | Angular app over plan 2's API using plan 3's primitives | 2, 3 |
| 5 · Auth & onboarding | JWT, password reset, the onboarding aggregate, customer auth API | 2 |
| 6 · Customer portal & close-out | customer API surface, the portal, seed data, E2E, spec PR | 3, 5 |
