# Customer Portal & Close-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the seven tenant-scoped customer API endpoints, generate and commit
`@peakpower/api-client-customer`, build the Angular customer portal — onboarding wizard,
sign-in, password reset, connections, naming, EAN-pool claiming, company profile — seed the
demo data, prove the whole path with one Playwright run, and open the specification pull
request that closes slice 1.

**Architecture:** Seven endpoints are added to the existing `PeakPower.Api.Customer` host built
by plan 5; every one of them reads identity only through `ICustomerContext`, is isolated by the
EF Core global query filter plus PostgreSQL row-level security, and returns 404 rather than 403
across tenants. The host emits `artifacts/openapi/customer.json` at build, from which the
committed npm workspace package `@peakpower/api-client-customer` is generated. The Angular
`apps/customer-portal` application consumes that client through an HTTP interceptor that holds
the access token in an in-memory signal — never `localStorage`, never `sessionStorage` — and
refreshes exactly once against the HttpOnly `pp_refresh` cookie before redirecting to sign-in.

**Tech Stack:** .NET SDK 10.0.400 · EF Core 10.x · PostgreSQL 17 · Aspire 13.5.3 ·
Angular 22 (`@angular/cli` 22.1.6) · Node 24.15.0 / npm 11.12.1 · Vitest 4.1.11 ·
Playwright 1.56.1 · openapi-typescript 7.13.0 · xUnit + FluentAssertions ·
Testcontainers.PostgreSql 4.14.0 · Verify.Xunit 30.15.0

**Spec:** `docs/superpowers/specs/2026-08-26-poc-slice-1-design.md`
**Shared contract:** `docs/superpowers/plans/2026-08-26-slice-1-shared-contract.md`

---

## Global Constraints

Copied verbatim from the shared contract. **Every task implicitly includes this section.**

### Versions — exact, verified 2026-08-26

| | |
| --- | --- |
| .NET SDK | **10.0.400** (installed, default) |
| EF Core | **10.x** |
| PostgreSQL | **17** (Testcontainers + Aspire) |
| Aspire | **13.5.3** — `aspire.cli` global tool + `Aspire.AppHost.Sdk`. **NOT a `dotnet workload`.** |
| Angular | **22** (`@angular/cli` 22.1.6) |
| Node / npm | **24.15.0 / 11.12.1** |
| Docker | 29.7.2, daemon must be running |

### Repositories

```
/Users/thinhhuynh/PeakPower/peakpower-platform      # .NET   — siblings, and the
/Users/thinhhuynh/PeakPower/peakpower-web           # Angular — AppHost relies on it
```

`git init` in both. **No remotes, no CI, no package registry, no deployment** in slice 1.
Commit locally and often.

### Naming

- .NET namespace root `PeakPower.` — e.g. `PeakPower.Domain.Customers`
- npm scope `@peakpower/` — kept even though no such GitHub org exists yet `[OQ-100]`
- Database: snake_case, singular, schema-qualified — `customer.metering_point`
- C#: PascalCase; EF Core maps to snake_case via a naming convention, not per-property attributes

### Enums — the database spelling is normative

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

### Domain — types that cross plan boundaries

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

### Application ports

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

### JWT claims — `[DEC-117]`

| Claim | Type | Meaning |
| --- | --- | --- |
| `sub` | guid string | `CustomerAccount.Id` |
| `customer_id` | guid string | the company — the ONLY source `ICustomerContext` may read |
| `is_admin` | `"true"` / `"false"` | the `[DEC-71]` flag |
| `amr` | string array | how they authenticated — `["pwd"]` in slice 1 |
| `stamp` | guid string | `CustomerAccount.SecurityStamp`, compared per request |

Access token 15 minutes, ES256. Refresh token 14 days, rotating, single-use, stored hashed.

### HTTP

- Base path `/api/v1`; errors are RFC 7807 `application/problem+json`
- Cross-tenant reads return **404, never 403** `[F13-R19]`
- Access token in `Authorization: Bearer`; refresh token in an HttpOnly, `Secure`,
  `SameSite=Strict` cookie named `pp_refresh`, path-scoped to `/api/v1/auth/refresh`
- The customer access token is held **in memory only** in the browser — never `localStorage`

### Database

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

### Angular

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

> ⚠ **`AddNpmApp` does not exist in Aspire 13.5.3.** The replacement is
> `AddJavaScriptApp(name, appDirectory, runScriptName)`, pointed at the workspace **root** with
> a per-app script name. This is why `package.json` must define `start:customer-portal` and
> `start:employee-portal` at the root, not `start` inside each app. Plan 1 already registers
> `customer-portal` in the AppHost this way; this plan does not touch the AppHost.

### Design tokens — SB-2026

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

### Copy rules

Sentence case everywhere. ALL CAPS only for stat-card labels and table column heads.
**No emoji, no icon set** — the only glyphs are the brand mark, one magnifier, `▲▼`, `→›`.
Every number carries its provenance in a faint sublabel. **"Projected"** = not yet measured;
**"Provisional"** = not yet accepted — never swap them. Empty and disabled states name the
reason. nl-NL numbers: `€ 19.722,00`, `385,4 MWh`, minus is U+2212 `−`.

### Testing

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

---

## Preconditions before Task 1

This plan is last in the sequence. Check all five before starting:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
test -f artifacts/openapi/employee.json          && echo "plan 2 OK"
test -f src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs        && echo "plan 5 auth OK"
test -f src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingEndpoints.cs && echo "plan 5 onboarding OK"
cd /Users/thinhhuynh/PeakPower/peakpower-web
test -f libs/shared-ui/src/index.ts              && echo "plan 3 OK"
test -f libs/api-client-employee/src/index.ts    && echo "plan 4 OK"
```

Five `OK` lines. If any is missing, the plan it names is unfinished and this plan cannot start.

---

## What this plan consumes from other plans

Reproduced here with exact signatures so a consistency pass can reconcile them, and repeated in
**New names introduced** at the end.

### From plan 1 (platform foundation)

```csharp
namespace PeakPower.Persistence;
public sealed class PeakPowerDbContext(DbContextOptions<PeakPowerDbContext> options,
                                       ICustomerContext customerContext) : DbContext
{
    public DbSet<Customer> Customers { get; }
    public DbSet<CustomerAccount> CustomerAccounts { get; }
    public DbSet<MeteringPoint> MeteringPoints { get; }
    public DbSet<Brp> Brps { get; }
    public DbSet<Wallet> Wallets { get; }
    public DbSet<AuditRecord> AuditRecords { get; }
}
public sealed class DatabaseMigrator { public Task<int> RunAsync(CancellationToken ct); }
public static class PersistenceServiceCollectionExtensions
{ public static IServiceCollection AddPeakPowerPersistence(this IServiceCollection services, string connectionString); }
```

```csharp
namespace PeakPower.Domain.Metering;
public sealed class Brp
{
    public Guid Id { get; }
    public string Code { get; }
    public string Name { get; }
    public static Brp Create(string code, string name);
}
```

Aspire resource names: `postgres`, `peakpower`, `migrator`, `customer-api`, `employee-api`,
`customer-portal`, `employee-portal`. Plan 1 already registers `customer-portal` with
`AddJavaScriptApp("customer-portal", frontEnds.WebRoot!, "start:customer-portal")`.

### From plan 2 (tenancy and employee API)

```csharp
namespace PeakPower.Infrastructure.Web.Http;
public static class ApiResults
{
    public const string NotFoundType   = "https://peakpower.dev/problems/not-found";
    public const string NotFoundTitle  = "Not found";
    public const string NotFoundDetail = "The requested resource does not exist.";
    public const string ValidationType  = "https://peakpower.dev/problems/validation";
    public const string ValidationTitle = "The request is not valid.";
    public const string ConflictType   = "https://peakpower.dev/problems/conflict";
    public const string ConflictTitle  = "The request conflicts with the current state.";

    public static IResult Found<T>(T? value) where T : class;
    public static IResult NotFound();
    public static IResult InvalidRequest(string property, string error);
    public static IResult Conflict(string detail);
}

namespace PeakPower.Infrastructure.Web.Tenancy;
public static class TenancyEndpointExtensions
{
    public static TBuilder TenantScoped<TBuilder>(this TBuilder builder, string resourceKind)
        where TBuilder : IEndpointConventionBuilder;
    public static TBuilder BackOffice<TBuilder>(this TBuilder builder, string reason)
        where TBuilder : IEndpointConventionBuilder;
    public static TBuilder AnonymousEndpoint<TBuilder>(this TBuilder builder, string reason)
        where TBuilder : IEndpointConventionBuilder;
}
```

```csharp
namespace PeakPower.Domain.Customers;   // members plan 2 added to plan 1's aggregates
public static MeteringPoint MeteringPoint.Attach(Guid customerId, EanCode ean, Guid brpId,
    ProductionExpectation productionExpectation, ProductionExpectationSource? expectationSource,
    string? name, string? description, string? gridOperator, decimal? capacityKw,
    Address? address, DateOnly validFrom);
public void MeteringPoint.UpdateDetails(Guid brpId, ProductionExpectation productionExpectation,
    ProductionExpectationSource? expectationSource, string? name, string? description,
    string? gridOperator, decimal? capacityKw, Address? address);
public static Customer Customer.Create(string legalName, string? tradeName, KvkNumber kvkNumber,
    string? vatNumber, Address billingAddress, Address? visitingAddress,
    ContactPerson primaryContact, string? internalReference, string locale);
public void Customer.ChangeStatus(CustomerStatus status);
public static CustomerAccount CustomerAccount.Create(Guid customerId, string username,
    string firstName, string lastName, string? jobTitle, string email, string? phone, bool isAdmin);
```

### From plan 5 (auth and onboarding)

```csharp
namespace PeakPower.Contracts.Customer.Auth;
public sealed record CurrentAccountResponse(Guid AccountId, Guid CustomerId, string FirstName,
    string LastName, string Email, bool IsAdmin);
public sealed record SignInRequest(string Username, string Password);
public sealed record SignInResponse(string AccessToken, DateTimeOffset ExpiresAt,
    CurrentAccountResponse Account);
public sealed record PasswordResetRequest(string Email);
public sealed record PasswordResetCompletion(string Token, string NewPassword);
public static class PasswordPolicy
{ public const int MinimumLength = 12; public static bool IsAcceptable(string? password); }

namespace PeakPower.Contracts.Customer.Onboarding;
public sealed record StartOnboardingRequest(string FirstName, string LastName, string Email,
    string Password, bool TermsAccepted);
public sealed record OnboardingAddressDto(string Street, string HouseNumber,
    string? HouseNumberSuffix, string PostalCode, string City, string Country);
public sealed record SaveOnboardingStepRequest(int Step, string? OrganizationName,
    string? LegalEntityType, string? KvkNumber, OnboardingAddressDto? RegisteredAddress,
    string? Industry, string? FlowDirection, string? VolumeBand, string? Iban,
    string? BankAccountHolder, string? SigningAuthority);
public sealed record SignatoryDto(string FirstName, string LastName, string Email);
public sealed record SubmitSignatoriesRequest(IReadOnlyList<SignatoryDto> Signatories);
public sealed record SignOnboardingRequest(string Code, bool AgreedDocuments);
public sealed record OnboardingApplicationResponse(Guid Id, string Reference, string Status);
public sealed record SignedOnboardingResponse(Guid CustomerId, Guid AccountId, string Username,
    string CustomerStatus);
```

Endpoints already mapped on `PeakPower.Api.Customer`, all under `/api/v1`:

```
POST   /onboarding/applications                             anonymous
PATCH  /onboarding/applications/{id}                        anonymous
POST   /onboarding/applications/{id}/signatories            anonymous
POST   /onboarding/applications/{id}/sign                   anonymous
POST   /onboarding/applications/{id}/bank-verification/simulate   anonymous, Development only
POST   /auth/sign-in            POST /auth/refresh          anonymous
POST   /auth/sign-out           GET  /auth/me               authenticated
POST   /auth/password-reset/requests                        anonymous
POST   /auth/password-reset/completions                     anonymous
GET    /.well-known/jwks.json                               anonymous
```

Plus, from plan 5's composition root and middleware:

```csharp
namespace PeakPower.Api.Customer.Auth;
public static class RefreshCookie
{ public const string Name = "pp_refresh"; public const string Path = "/api/v1/auth/refresh"; }
public static class AuthEndpoints
{ public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder routes); }

namespace PeakPower.Api.Customer.Onboarding;
public static class OnboardingEndpoints
{ public static IEndpointRouteBuilder MapOnboardingEndpoints(this IEndpointRouteBuilder routes); }
public sealed class OnboardingService
{ public static string NewSignCode(); }

namespace PeakPower.Domain.Onboarding;
public enum OnboardingStatus { Draft, AwaitingSignature, Signed }
public enum LegalEntityType { BV, NV, Eenmanszaak, VOF, Maatschap, CV, Stichting, Vereniging, Cooperatie }
public enum FlowDirection { Consumption, Production, Both }
public enum VolumeBand { UpTo250Mwh, From250To500Mwh, From500To1000Mwh, From1000To2500Mwh, Above2500Mwh }
public enum SigningAuthority { Alone, Jointly, SomeoneElse }
public sealed class OnboardingApplication
{
    public Guid Id { get; }
    public string Reference { get; }
    public string Email { get; }
    public OnboardingStatus Status { get; }
    public DateTimeOffset? BankVerifiedAt { get; }
    public string? SignCodeHash { get; }
    public void MarkBankVerified(DateTimeOffset at);
}

namespace PeakPower.Infrastructure.Security;
public sealed class Argon2idPasswordHasher : IPasswordHasher;   // parameterless ctor

namespace PeakPower.Integration.Tests;
public sealed class CustomerApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public string ConnectionString { get; }
    public HttpClient CreateAnonymousClient();
    public PeakPowerDbContext CreateOwnerDbContext();
    public Task<CustomerAccount> SeedCustomerWithAccountAsync(
        string legalName, string kvkNumber, string email, string password);
}
```

> ⚠ **The wire spelling of the onboarding enums is the C# member name, not SCREAMING_SNAKE.**
> Plan 5's `SaveOnboardingStepRequest` carries them as `string?` and parses with
> `Enum.TryParse<SigningAuthority>(…)`, which matches the C# member name. So the wizard sends
> `"Jointly"`, `"Both"`, `"From1000To2500Mwh"`, `"BV"` — **not** `"JOINTLY"`. Every other enum
> on the wire in this system is SCREAMING_SNAKE, so this is the one place a reader will guess
> wrong. It is flagged in **New names introduced** for the consistency pass.

### From plan 3 (`@peakpower/shared-ui`)

```ts
export type PpTone = 'neutral' | 'positive' | 'warning' | 'danger' | 'info';
export type PpButtonVariant = 'primary' | 'secondary' | 'danger';

export interface PpNavItem {
  readonly routeKey: string;               // the specification's route key, never the label
  readonly label: string;                  // the design system's label
  readonly path: string | null;            // null renders the item disabled
  readonly disabledReason: string | null;  // the sentence shown when path is null
  readonly dot?: string | null;            // ⚠ ADDED BY THIS PLAN — see New names
}
export interface PpNavSection {
  readonly title: string | null;
  readonly items: readonly PpNavItem[];
}

// selector: 'pp-app-shell'
export class PpAppShell {
  readonly sections = input.required<readonly PpNavSection[]>();
  readonly crumb = input<string | null>(null);      // crumb OR subtitle, never both
  readonly subtitle = input<string | null>(null);
}
// selector: 'pp-card'
export class PpCard {
  readonly heading = input<string | null>(null);
  readonly subtitle = input<string | null>(null);
}
// selector: 'pp-stat-card'
export class PpStatCard {
  readonly label = input.required<string>();        // rendered ALL CAPS
  readonly value = input.required<string>();
  readonly sublabel = input<string | null>(null);
  readonly tone = input<PpTone>('neutral');
}
// selector: 'pp-badge'
export class PpBadge { readonly tone = input<PpTone>('neutral'); }
// selector: 'pp-button'
export class PpButton {
  readonly variant = input<PpButtonVariant>('secondary');
  readonly size = input<'md' | 'sm'>('md');
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input<boolean>(false);
}
// selector: 'pp-banner'
export class PpBanner {
  readonly tone = input<PpTone>('info');
  readonly heading = input<string | null>(null);
}
// selector: 'pp-grid-table'  — display:grid divs, never <table>
export class PpGridTable {
  readonly columns = input.required<string>();      // a grid-template-columns string
  readonly density = input<'default' | 'compact'>('default');
}
export class PpGridHead {}   // selector: '[ppGridHead]'
export class PpGridRow {}    // selector: '[ppGridRow]'
// selector: 'pp-search-input'
export class PpSearchInput {
  readonly placeholder = input<string>('');
  readonly value = model<string>('');
}
```

Plan 3's token stylesheet lives at `libs/shared-ui/src/styles/tokens.css` and is importable
from a plain CSS file. **`pp-grid-table` is never rendered with zero rows** — every table in
this plan is wrapped in `@if (rows().length > 0) { … } @else { … }` and the empty branch is a
`pp-card` whose text names the reason.

### From plan 4 (employee portal — the tooling this plan extends)

```js
// tools/openapi-clients.mjs
export const WEB_ROOT: string;
export const BANNER: string;
export function resolvePlatformRoot(env?: NodeJS.ProcessEnv): string;
export const CLIENTS: readonly { name: string; document: string; output: string }[];
export async function generateTypes(documentPath: string): Promise<string>;
export async function writeClient(client): Promise<string>;
export async function readCommitted(client): Promise<string | null>;
```

npm scripts that already exist: `generate:clients`, `verify:clients`, `test:tools`,
`start:employee-portal`, `build:employee-portal`, `test:employee-portal`.

Plan 4 also owns `apps/employee-portal/src/app/shared/apply-problem-details.ts` and
`form-field.ts`. Those are **app-local to the employee portal**; this plan writes its own
copies under `apps/customer-portal/src/app/shared/`. That is deliberate duplication of about
sixty lines rather than a premature shared library — the two portals' error surfaces diverge
(the customer portal has no four-eyes fields and no IBAN form) and a shared abstraction would
have to be un-shared the first time they do.

---

## Conventions this plan adds

**C1 — one address DTO per document, and there are two.** `PeakPower.Contracts.Customer.Portal`
defines its own `AddressDto`. The customer OpenAPI document therefore carries two structurally
identical address schemas: plan 5's `OnboardingAddressDto` and this plan's `AddressDto`.
Consolidating them would rewrite plan 5's frozen contract for cosmetics, so they stay separate
and this note is the record of why.

**C2 — the EAN pool is not tenant data.** `metering.ean_pool` sits beside `metering.brp` as
shared reference data: no `customer_id` on the read path, no RLS policy, `SELECT` and `UPDATE`
granted to `app_customer_role`. Only unclaimed rows are ever returned, so no customer learns
who took what.

**C3 — connection status is derived, never stored.** A metering point's status comes from its
half-open validity window compared against `IMarketCalendar.TodayInAmsterdam`. There is no
`status` column, and adding one would be a second source of truth that drifts at midnight.

**C4 — `lastDataDate` is always null in slice 1, and the UI says so.** Ingestion is F02 and out
of scope, so there is no measurement to date. The field exists in the contract, is always null,
and the portal renders "No data yet — ingestion arrives in a later slice" rather than a
plausible-looking date. Design §8.5 forbids fabricated figures beside real ones.

**C5 — desktop only.** `<meta name="viewport" content="width=1280">`, no media queries below
1280px. Design §8.4 records that as explicit scope, not an omission.

---

## File Structure

### `peakpower-platform` — created by this plan

| File | Responsibility |
| --- | --- |
| `src/Core/PeakPower.Domain/Metering/EanPoolEntry.cs` | One unclaimed grid connection; `Claim` is the only mutator |
| `src/Core/PeakPower.Domain/Customers/ConnectionStatus.cs` | Derives `Pending` / `Active` / `Ending` / `Ended` from a validity window and today |
| `src/Core/PeakPower.Contracts/Customer/Portal/PortalContracts.cs` | Every request and response DTO for the seven customer endpoints |
| `src/Infrastructure/PeakPower.Persistence/Configurations/EanPoolEntryConfiguration.cs` | EF mapping for `metering.ean_pool` |
| `src/Infrastructure/PeakPower.Persistence/Migrations/*_M3_EanPool.cs` | Migration 3 — `metering.ean_pool` plus its grants |
| `src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs` | The six companies, their accounts and connections, and the EAN pool |
| `src/Hosts/PeakPower.Api.Customer/Portal/CompanyEndpoints.cs` | `GET /company`, `GET /company/accounts` |
| `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs` | The four `/metering-points` routes |
| `src/Hosts/PeakPower.Api.Customer/Portal/EanPoolEndpoints.cs` | `GET /ean-pool` |
| `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs` | Domain → DTO, in one place |
| `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionSearch.cs` | The one free-text search predicate `[F01-R36]` |

### `peakpower-platform` — modified by this plan

| File | Change |
| --- | --- |
| `src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj` | Emit `customer.json` at build |
| `src/Hosts/PeakPower.Api.Customer/Program.cs` | Map the three new endpoint groups |
| `src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingEndpoints.cs` | Add the Development-only sign-code peek the E2E needs |
| `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs` | Add `DbSet<EanPoolEntry> EanPool` |
| `src/Hosts/PeakPower.Migrator/Program.cs` | Run `DemoDataSeeder` after migrations in Development |
| `tests/PeakPower.Integration.Tests/Auth/AnonymousEndpointAllowListTests.cs` | Add the sign-code peek to the expected set |

### `peakpower-platform` — tests created by this plan

| File | Responsibility |
| --- | --- |
| `tests/PeakPower.Domain.Tests/Customers/ConnectionStatusTests.cs` | Every arm of the derivation, including the half-open boundary |
| `tests/PeakPower.Domain.Tests/Metering/EanPoolEntryTests.cs` | Claim once, never twice |
| `tests/PeakPower.Integration.Tests/Portal/CompanyEndpointTests.cs` | Profile and accounts, and 404 across tenants |
| `tests/PeakPower.Integration.Tests/Portal/ConnectionListTests.cs` | List, search over name / description / EAN, tenant isolation |
| `tests/PeakPower.Integration.Tests/Portal/ConnectionDetailTests.cs` | Detail, and 404 for another company's connection |
| `tests/PeakPower.Integration.Tests/Portal/ConnectionNamingTests.cs` | Length limits, clearing, the label falling back to the EAN |
| `tests/PeakPower.Integration.Tests/Portal/EanPoolTests.cs` | Search, and claimed rows never appearing |
| `tests/PeakPower.Integration.Tests/Portal/ClaimConnectionTests.cs` | The claim, `CUSTOMER_DECLARED`, and the double-claim conflict |
| `tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.cs` | The customer contract, frozen |
| `tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs` | Six companies, idempotent, pool loads under `[DEC-114]` |

### `peakpower-web` — `libs/api-client-customer`

| File | Responsibility |
| --- | --- |
| `package.json` | The workspace package manifest; its `name` is what `import` resolves |
| `src/generated/customer-schema.d.ts` | **machine-owned.** Types from `customer.json`, diffed by `verify:clients` |
| `src/lib/customer-api.tokens.ts` | `CUSTOMER_API_BASE_URL` |
| `src/lib/customer-api.types.ts` | Readable aliases over `components['schemas'][…]` |
| `src/lib/customer-api.client.ts` | `CustomerApiClient` — URL builders plus one method per endpoint |
| `src/lib/customer-api.testing.ts` | `provideCustomerApiTesting()` |
| `src/index.ts` | The public barrel |

### `peakpower-web` — `apps/customer-portal`

| File | Responsibility |
| --- | --- |
| `src/index.html`, `src/main.ts`, `src/styles.css` | Document shell, bootstrap, page canvas |
| `proxy.conf.mjs` | Dev-server proxy from `/api` to the customer API |
| `tsconfig.app.json`, `tsconfig.spec.json` | Compiler configuration for build and test |
| `src/app/app.ts` | Root component — `pp-app-shell` plus `router-outlet`, or a bare outlet when signed out |
| `src/app/app.config.ts` | Providers: zoneless CD, router, HttpClient + interceptor, `LOCALE_ID`, base URL |
| `src/app/app.routes.ts` | Top-level routes; feature routes lazy |
| `src/app/auth/access-token.store.ts` | The in-memory token signal — the only place a token is held |
| `src/app/auth/token-refresher.ts` | One shared in-flight refresh, so N parallel 401s cost one call |
| `src/app/auth/auth.interceptor.ts` | Bearer attach, refresh-once, then redirect |
| `src/app/auth/auth.service.ts` | Sign in, sign out, bootstrap the session, request and complete a reset |
| `src/app/auth/authenticated.guard.ts` | `CanActivateFn` that bootstraps once, then admits or redirects |
| `src/app/shell/customer-nav.ts` | `CUSTOMER_ROUTE_KEYS`, `PAGE_LABELS`, `CUSTOMER_NAV` |
| `src/app/shared/apply-problem-details.ts` | RFC 7807 `errors` → reactive-form control errors |
| `src/app/shared/form-field.ts` | `PpFormField` — label, control slot, server error |
| `src/app/shared/labels.ts` | Wire value → sentence-case label and `PpTone`, for every customer enum |
| `src/app/features/sign-in/sign-in-page.ts` | Sign in |
| `src/app/features/sign-in/forgot-password-page.ts` | Request a reset — always the same answer |
| `src/app/features/sign-in/reset-password-page.ts` | Complete a reset from the emailed token |
| `src/app/features/dashboard/dashboard-page.ts` | Shell and placeholder only |
| `src/app/features/connections/connections.routes.ts` | The connections feature's lazy route table |
| `src/app/features/connections/connection-list-page.ts` | List, search, status, last-data placeholder |
| `src/app/features/connections/connection-detail-page.ts` | Detail plus the friendly-name editor |
| `src/app/features/connections/claim-connection-page.ts` | Search the pool and claim one |
| `src/app/features/company/company-page.ts` | Read-only profile and account list |
| `src/app/onboarding/onboarding-flow.ts` | The ported step table, gates and hints — pure, no Angular |
| `src/app/onboarding/onboarding-wizard.ts` | The wizard shell: rail, header, footer, step dispatch |
| `src/app/onboarding/steps/step-account.ts` | Step 1 |
| `src/app/onboarding/steps/step-company.ts` | Steps 2, 3 and 4 |
| `src/app/onboarding/steps/step-volume.ts` | Step 5 |
| `src/app/onboarding/steps/step-bank.ts` | Step 6 |
| `src/app/onboarding/steps/step-authority.ts` | Steps 7 and 8 |
| `src/app/onboarding/steps/step-sign.ts` | Steps 9 and 10 |

Each page file carries its own `*.spec.ts` beside it.

### `peakpower-web` — E2E and workspace plumbing

| File | Responsibility |
| --- | --- |
| `package.json` | *(modify)* customer-portal scripts, Playwright, the customer client workspace entry |
| `angular.json` | *(modify)* the `customer-portal` project |
| `tsconfig.base.json` | *(modify)* the `@peakpower/api-client-customer` path mapping |
| `tools/openapi-clients.mjs` | *(modify)* register the customer client in `CLIENTS` |
| `playwright.config.ts` | The E2E runner configuration |
| `e2e/onboard-and-rename.spec.ts` | The one slice-1 path |
| `e2e/fixtures/api.ts` | Direct-API helpers the E2E needs (the sign-code peek) |

### `peakpowerspecs` — modified by Task 22

| File | Change |
| --- | --- |
| `specs/00-overview/04-assumptions-and-decisions.md` | `[DEC-113]`…`[DEC-117]` |
| `specs/80-open-questions.md` | `[OQ-97]`…`[OQ-100]` |
| `specs/20-architecture/04-database-design.md` | New §0 — the two extensions |
| `specs/20-architecture/02-solution-structure.md` | `AddNpmApp` → `AddJavaScriptApp`; the `--backend-only` gate; Aspire is a CLI + SDK; §8's feed row closes |
| `specs/20-architecture/03-domain-model.md` | `NotExpected` → `Never`; `AccountStatus`; `FourEyesAction` |
| `specs/20-architecture/05-api-contracts.md` | `/label` → `/naming` |
| `specs/10-features/F01-customer-and-metering-points.md` | Delete `metering_point_label`; note the stale SVG |
| `specs/10-features/F13-identity-and-access.md` | Business rule 2 becomes an architecture test |
| `specs/70-delivery/01-roadmap-and-phasing.md` | Reconcile "five of the six" against "four of the six" |
| `specs/60-mockups/README.md` | Labels from the design system, route keys from the specifications |
| `specs/60-mockups/screens-customer.mjs` | The `NAV` array |

---

## Tasks

Commands are run from `/Users/thinhhuynh/PeakPower/peakpower-platform` for tasks 1–8,
from `/Users/thinhhuynh/PeakPower/peakpower-web` for tasks 9–21, and from
`/Users/thinhhuynh/PeakPower/peakpowerspecs` for task 22. Each task says which.

---

### Task 1: Connection status, derived from the validity window

A **metering point** is one electricity connection point in the Dutch grid, identified by an
18-digit **EAN**. It belongs to a customer for a half-open period `[valid_from, valid_to)` — so
a connection whose `valid_to` is 1 January 2027 is the customer's through 31 December 2026 and
not on 1 January. `[F01-R26]` requires the same EAN to serve different customers over
non-overlapping periods, which is why the period is half-open and why the database enforces it
with a GiST exclusion constraint.

The portal shows a status badge on every connection. That status is **derived**, never stored
(convention C3): a stored column would be stale from the midnight after it was written. The
derivation is the smallest thing in this plan that can be tested on its own, so it goes first.

"Ending" is the state the demo shows as `Ending 31 Dec`: a connection with a known end date
that has not yet arrived. Ninety days is the window — long enough that a customer sees it
before their planning horizon closes, short enough that it is not permanently amber.

**Files:**
- Create: `src/Core/PeakPower.Domain/Customers/ConnectionStatus.cs`
- Test: `tests/PeakPower.Domain.Tests/Customers/ConnectionStatusTests.cs`

**Interfaces:**
- Consumes: nothing. `PeakPower.Domain` references no other project (architecture fact 1).
- Produces:
  - `public enum ConnectionStatus { Pending, Active, Ending, Ended }` in `PeakPower.Domain.Customers`
  - `public static class ConnectionStatusRules` with
    `public const int EndingWithinDays = 90` and
    `public static ConnectionStatus For(DateOnly today, DateOnly validFrom, DateOnly? validTo)`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Domain.Tests/Customers/ConnectionStatusTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.Domain.Customers;
using Xunit;

namespace PeakPower.Domain.Tests.Customers;

public sealed class ConnectionStatusTests
{
    private static readonly DateOnly Today = new(2026, 8, 26);

    [Fact]
    public void A_connection_that_has_not_started_is_pending()
    {
        ConnectionStatusRules.For(Today, new DateOnly(2026, 9, 1), null)
            .Should().Be(ConnectionStatus.Pending);
    }

    [Fact]
    public void A_connection_starting_today_is_active()
    {
        ConnectionStatusRules.For(Today, Today, null).Should().Be(ConnectionStatus.Active);
    }

    [Fact]
    public void An_open_ended_connection_is_active()
    {
        ConnectionStatusRules.For(Today, new DateOnly(2024, 1, 1), null)
            .Should().Be(ConnectionStatus.Active);
    }

    [Fact]
    public void A_connection_ending_far_away_is_still_plain_active()
    {
        // 2027-06-30 is more than 90 days out, so it is not yet worth an amber badge.
        ConnectionStatusRules.For(Today, new DateOnly(2024, 1, 1), new DateOnly(2027, 6, 30))
            .Should().Be(ConnectionStatus.Active);
    }

    [Fact]
    public void A_connection_ending_inside_ninety_days_is_ending()
    {
        ConnectionStatusRules.For(Today, new DateOnly(2024, 1, 1), new DateOnly(2026, 10, 1))
            .Should().Be(ConnectionStatus.Ending);
    }

    [Fact]
    public void The_ninety_day_boundary_is_inclusive()
    {
        var boundary = Today.AddDays(ConnectionStatusRules.EndingWithinDays);

        ConnectionStatusRules.For(Today, new DateOnly(2024, 1, 1), boundary)
            .Should().Be(ConnectionStatus.Ending);
        ConnectionStatusRules.For(Today, new DateOnly(2024, 1, 1), boundary.AddDays(1))
            .Should().Be(ConnectionStatus.Active);
    }

    [Fact]
    public void The_validity_window_is_half_open_so_valid_to_itself_is_already_ended()
    {
        // [valid_from, valid_to) — the customer holds it through the day BEFORE valid_to.
        ConnectionStatusRules.For(Today, new DateOnly(2024, 1, 1), Today)
            .Should().Be(ConnectionStatus.Ended);
        ConnectionStatusRules.For(Today, new DateOnly(2024, 1, 1), Today.AddDays(1))
            .Should().Be(ConnectionStatus.Ending);
    }

    [Fact]
    public void A_connection_whose_period_has_passed_is_ended()
    {
        ConnectionStatusRules.For(Today, new DateOnly(2024, 1, 1), new DateOnly(2025, 12, 31))
            .Should().Be(ConnectionStatus.Ended);
    }

    [Fact]
    public void Ended_beats_pending_for_a_window_entirely_in_the_past()
    {
        ConnectionStatusRules.For(Today, new DateOnly(2020, 1, 1), new DateOnly(2020, 6, 1))
            .Should().Be(ConnectionStatus.Ended);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Domain.Tests --filter "FullyQualifiedName~ConnectionStatusTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'ConnectionStatusRules' could not be found`

- [ ] **Step 3: Write the minimal implementation**

Create `src/Core/PeakPower.Domain/Customers/ConnectionStatus.cs`:

```csharp
namespace PeakPower.Domain.Customers;

/// <summary>
/// What the portal's status badge says about a connection. Derived from the validity window,
/// never stored: a stored column is wrong from the midnight after it was written.
/// </summary>
public enum ConnectionStatus
{
    /// <summary>The period has not started yet.</summary>
    Pending,

    /// <summary>Live, with no end date in sight.</summary>
    Active,

    /// <summary>Live, but a known end date is inside the warning window.</summary>
    Ending,

    /// <summary>The period is over. [valid_from, valid_to) — valid_to itself is already out.</summary>
    Ended,
}

public static class ConnectionStatusRules
{
    /// <summary>
    /// How far ahead an end date has to be before it stops being worth an amber badge. Long
    /// enough that a customer sees it before their planning horizon closes; short enough that
    /// a connection ending in two years is not permanently flagged.
    /// </summary>
    public const int EndingWithinDays = 90;

    /// <summary>
    /// The validity window is half-open — <paramref name="validTo"/> is the first day the
    /// connection is NOT the customer's, which is what the database's
    /// <c>daterange(valid_from, valid_to, '[)')</c> means and what [F01-R26] requires so the
    /// same EAN can pass between customers without a gap or an overlap.
    /// </summary>
    public static ConnectionStatus For(DateOnly today, DateOnly validFrom, DateOnly? validTo)
    {
        if (validTo is { } end && today >= end)
        {
            // Checked before Pending: a window entirely in the past is Ended, not Pending.
            return ConnectionStatus.Ended;
        }

        if (today < validFrom)
        {
            return ConnectionStatus.Pending;
        }

        if (validTo is { } ending && ending <= today.AddDays(EndingWithinDays))
        {
            return ConnectionStatus.Ending;
        }

        return ConnectionStatus.Active;
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Domain.Tests --filter "FullyQualifiedName~ConnectionStatusTests"`
Expected: PASS — 9 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Customers/ConnectionStatus.cs \
        tests/PeakPower.Domain.Tests/Customers/ConnectionStatusTests.cs
git commit -m "feat(domain): derive connection status from the half-open validity window"
```

---

### Task 2: The customer portal contracts, and the two company endpoints

`GET /company` `[F01-R09]` and `GET /company/accounts` `[F01-R21]` are read-only: a customer
sees their own company record and the colleagues who can sign in, and can change neither. Both
are tenant-scoped through the EF Core global query filter and PostgreSQL row-level security,
and neither takes an id — the company is whichever one the token says, and there is no route
parameter to tamper with. That is `[F13]` business rule 2 made structural rather than checked.

This task also lands the whole contract file, because the mapping helpers the later endpoints
need are written once and every subsequent task adds one method to them.

**Note on `Username`.** `CompanyAccountDto` deliberately omits it. In this build the username
*is* the email address, so listing both would print the same string twice under two headings;
and the employee API — which is where an account is administered — already exposes it.

**Files:**
- Create: `src/Core/PeakPower.Contracts/Customer/Portal/PortalContracts.cs`
- Create: `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs`
- Create: `src/Hosts/PeakPower.Api.Customer/Portal/CompanyEndpoints.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Program.cs`
- Test: `tests/PeakPower.Integration.Tests/Portal/CompanyEndpointTests.cs`

**Interfaces:**
- Consumes: `ICustomerContext` (`Guid CustomerId`, `Guid AccountId`, `bool IsAdmin`,
  `bool IsAuthenticated`); `PeakPowerDbContext.Customers`, `.CustomerAccounts`;
  `ApiResults.Found<T>(T?)` and `ApiResults.NotFound()`;
  `TenancyEndpointExtensions.TenantScoped<TBuilder>(this TBuilder, string resourceKind)`;
  `CustomerApiFactory.SeedCustomerWithAccountAsync(string legalName, string kvkNumber, string email, string password)`.
- Produces:
  - `PeakPower.Contracts.Customer.Portal.AddressDto(string Street, string HouseNumber, string? HouseNumberSuffix, string PostalCode, string City, string Country)`
  - `ContactPersonDto(string Name, string Email, string? Phone)`
  - `CompanyProfileResponse(Guid Id, string LegalName, string? TradeName, string KvkNumber, string? VatNumber, string Status, AddressDto BillingAddress, AddressDto? VisitingAddress, ContactPersonDto PrimaryContact, string Locale)`
  - `CompanyAccountDto(Guid Id, string FirstName, string LastName, string? JobTitle, string Email, string? Phone, string Status, bool IsAdmin, DateTimeOffset? LastLoginAt)`
  - `CompanyAccountsResponse(IReadOnlyList<CompanyAccountDto> Items)`
  - `ConnectionSummaryDto`, `ConnectionListResponse`, `ConnectionDetailDto`,
    `RenameConnectionRequest`, `EanPoolEntryDto`, `EanPoolResponse`, `ClaimConnectionRequest`
    — full signatures in Step 3
  - `PeakPower.Api.Customer.Portal.PortalMappings` with `ToDto(Address?)`, `ToDto(ContactPerson)`,
    `Wire(CustomerStatus)`, `Wire(AccountStatus)`, `Wire(Commodity)`,
    `Wire(ProductionExpectation)`, `Wire(ProductionExpectationSource?)`, `Wire(ConnectionStatus)`,
    `ToProfile(Customer)`, `ToAccountDto(CustomerAccount)`
  - `PeakPower.Api.Customer.Portal.CompanyEndpoints.MapCompanyEndpoints(this IEndpointRouteBuilder)`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Portal/CompanyEndpointTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Contracts.Customer.Portal;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

public sealed class CompanyEndpointTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    /// <summary>Seeds a company with one account and returns a client already carrying its token.</summary>
    private async Task<HttpClient> SignedInAsync(string legalName, string kvk)
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        await factory.SeedCustomerWithAccountAsync(legalName, kvk, email, Password);

        var client = factory.CreateAnonymousClient();
        var response = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password));
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<SignInResponse>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body!.AccessToken);
        return client;
    }

    [Fact]
    public async Task The_company_endpoint_returns_the_signed_in_companys_own_profile()
    {
        var client = await SignedInAsync("Vandersteen Koeling B.V.", "34215678");

        var profile = await client.GetFromJsonAsync<CompanyProfileResponse>("/api/v1/company");

        profile.Should().NotBeNull();
        profile!.LegalName.Should().Be("Vandersteen Koeling B.V.");
        profile.KvkNumber.Should().Be("34215678");
        profile.Status.Should().Be("ACTIVE");
        profile.Locale.Should().Be("nl-NL");
        profile.BillingAddress.Country.Should().Be("NL");
    }

    [Fact]
    public async Task The_company_endpoint_takes_no_route_parameter_at_all()
    {
        // [F13] business rule 2: a customer identifier read from a route, query, body or
        // header for authorisation is a defect. There is nothing here to tamper with.
        var client = await SignedInAsync("Kramer Logistics B.V.", "68812340");

        var response = await client.GetAsync("/api/v1/company/00000000-0000-0000-0000-000000000001");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task An_anonymous_caller_gets_401()
    {
        var client = factory.CreateAnonymousClient();

        var response = await client.GetAsync("/api/v1/company");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task The_accounts_endpoint_lists_only_this_companys_own_people()
    {
        var mine = await SignedInAsync("Van Dijk Glastuinbouw", "70012399");
        await SignedInAsync("Meijer Koelhuizen", "61234567");   // a second company exists

        var accounts = await mine.GetFromJsonAsync<CompanyAccountsResponse>(
            "/api/v1/company/accounts");

        accounts.Should().NotBeNull();
        accounts!.Items.Should().HaveCount(1);
        accounts.Items[0].Status.Should().Be("ACTIVE");
    }

    [Fact]
    public async Task The_account_list_never_carries_a_password_hash_or_a_security_stamp()
    {
        var client = await SignedInAsync("Hoekstra Staal B.V.", "65543210");

        var raw = await client.GetStringAsync("/api/v1/company/accounts");

        raw.Should().NotContainEquivalentOf("passwordHash");
        raw.Should().NotContainEquivalentOf("securityStamp");
        raw.Should().NotContainEquivalentOf("argon2");
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~CompanyEndpointTests"`
Expected: FAIL — `error CS0234: The type or namespace name 'Portal' does not exist in the namespace 'PeakPower.Contracts.Customer'`

- [ ] **Step 3: Write the contracts**

Create `src/Core/PeakPower.Contracts/Customer/Portal/PortalContracts.cs`:

```csharp
namespace PeakPower.Contracts.Customer.Portal;

/// <summary>
/// The six components of a Dutch address. Structurally identical to
/// <c>PeakPower.Contracts.Customer.Onboarding.OnboardingAddressDto</c> on purpose: consolidating
/// them would rewrite plan 5's frozen OpenAPI snapshot for cosmetics. See convention C1.
/// </summary>
public sealed record AddressDto(
    string Street,
    string HouseNumber,
    string? HouseNumberSuffix,
    string PostalCode,
    string City,
    string Country);

public sealed record ContactPersonDto(string Name, string Email, string? Phone);

/// <summary>The company the caller belongs to, read-only [F01-R09].</summary>
public sealed record CompanyProfileResponse(
    Guid Id,
    string LegalName,
    string? TradeName,
    string KvkNumber,
    string? VatNumber,
    string Status,
    AddressDto BillingAddress,
    AddressDto? VisitingAddress,
    ContactPersonDto PrimaryContact,
    string Locale);

/// <summary>
/// One colleague who can sign in [F01-R21]. No username: in this build the username IS the
/// email address, so carrying both would print the same string twice.
/// </summary>
public sealed record CompanyAccountDto(
    Guid Id,
    string FirstName,
    string LastName,
    string? JobTitle,
    string Email,
    string? Phone,
    string Status,
    bool IsAdmin,
    DateTimeOffset? LastLoginAt);

public sealed record CompanyAccountsResponse(IReadOnlyList<CompanyAccountDto> Items);

/// <summary>
/// One connection as the list shows it [F01-R35].
/// <para>
/// <paramref name="LastDataDate"/> is ALWAYS null in slice 1 and the portal says so rather than
/// printing a plausible date — metering-data ingestion is F02 and out of scope. The field is in
/// the contract now so the shape does not change when ingestion lands. See convention C4.
/// </para>
/// </summary>
public sealed record ConnectionSummaryDto(
    Guid Id,
    string Ean,
    string EanDisplay,
    string DisplayLabel,
    string? Name,
    string? Description,
    string Commodity,
    string Status,
    string? GridOperator,
    decimal? CapacityKw,
    string? City,
    DateOnly ValidFrom,
    DateOnly? ValidTo,
    DateOnly? LastDataDate);

public sealed record ConnectionListResponse(IReadOnlyList<ConnectionSummaryDto> Items, int Total);

/// <summary>One connection in full [F01-R38].</summary>
public sealed record ConnectionDetailDto(
    Guid Id,
    string Ean,
    string EanDisplay,
    string DisplayLabel,
    string? Name,
    string? Description,
    string Commodity,
    string Status,
    Guid BrpId,
    string BrpName,
    string ProductionExpectation,
    string? ExpectationSource,
    string? GridOperator,
    decimal? CapacityKw,
    AddressDto? Address,
    DateOnly ValidFrom,
    DateOnly? ValidTo,
    DateOnly? LastDataDate);

/// <summary>
/// The friendly name and description [F01-R29]. Both are nullable and both may be cleared:
/// clearing the name restores the grouped EAN as the primary label [F01-R30] [F01-R31].
/// </summary>
public sealed record RenameConnectionRequest(string? Name, string? Description);

/// <summary>An unclaimed connection in the shared pool.</summary>
public sealed record EanPoolEntryDto(
    string Ean,
    string EanDisplay,
    string Commodity,
    string? GridOperator,
    decimal? CapacityKw,
    AddressDto? Address);

public sealed record EanPoolResponse(IReadOnlyList<EanPoolEntryDto> Items, int Total);

/// <summary>
/// Claim one connection from the pool [DEC-113], declaring whether it produces [F01-R54].
/// The source is recorded as CUSTOMER_DECLARED and is not the caller's to choose.
/// </summary>
public sealed record ClaimConnectionRequest(
    string Ean,
    string ProductionExpectation,
    string? Name,
    string? Description);
```

- [ ] **Step 4: Write the mappings**

Create `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs`:

```csharp
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Customers;
using DomainAddress = PeakPower.Domain.Common;

namespace PeakPower.Api.Customer.Portal;

/// <summary>
/// Domain to DTO, in one place.
/// <para>
/// The <c>Wire</c> overloads spell every enum explicitly rather than deriving SCREAMING_SNAKE
/// from the C# name. A derivation looks tidier and gets <c>UpTo250Mwh</c> wrong; an explicit
/// switch cannot compile if a member is added and left unhandled.
/// </para>
/// </summary>
public static class PortalMappings
{
    public static AddressDto? ToDto(Address? address) =>
        address is null
            ? null
            : new AddressDto(address.Street, address.HouseNumber, address.HouseNumberSuffix,
                             address.PostalCode, address.City, address.Country);

    public static AddressDto ToDto(Address address) =>
        new(address.Street, address.HouseNumber, address.HouseNumberSuffix,
            address.PostalCode, address.City, address.Country);

    public static ContactPersonDto ToDto(ContactPerson contact) =>
        new(contact.Name, contact.Email, contact.Phone);

    public static string Wire(CustomerStatus value) => value switch
    {
        CustomerStatus.Prospect => "PROSPECT",
        CustomerStatus.Active => "ACTIVE",
        CustomerStatus.Suspended => "SUSPENDED",
        CustomerStatus.Closed => "CLOSED",
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, null),
    };

    public static string Wire(AccountStatus value) => value switch
    {
        AccountStatus.PendingApproval => "PENDING_APPROVAL",
        AccountStatus.Invited => "INVITED",
        AccountStatus.Active => "ACTIVE",
        AccountStatus.Deactivated => "DEACTIVATED",
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, null),
    };

    public static string Wire(Commodity value) => value switch
    {
        Commodity.Electricity => "ELECTRICITY",
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, null),
    };

    public static string Wire(ProductionExpectation value) => value switch
    {
        ProductionExpectation.Unknown => "UNKNOWN",
        ProductionExpectation.Never => "NEVER",
        ProductionExpectation.Expected => "EXPECTED",
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, null),
    };

    public static string? Wire(ProductionExpectationSource? value) => value switch
    {
        null => null,
        ProductionExpectationSource.Contract => "CONTRACT",
        ProductionExpectationSource.GridOperator => "GRID_OPERATOR",
        ProductionExpectationSource.Observed => "OBSERVED",
        ProductionExpectationSource.Manual => "MANUAL",
        ProductionExpectationSource.CustomerDeclared => "CUSTOMER_DECLARED",
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, null),
    };

    public static string Wire(ConnectionStatus value) => value switch
    {
        ConnectionStatus.Pending => "PENDING",
        ConnectionStatus.Active => "ACTIVE",
        ConnectionStatus.Ending => "ENDING",
        ConnectionStatus.Ended => "ENDED",
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, null),
    };

    /// <summary>Parses the wire spelling a customer may send for a production expectation.</summary>
    public static ProductionExpectation? ParseProductionExpectation(string? raw) => raw switch
    {
        "UNKNOWN" => ProductionExpectation.Unknown,
        "NEVER" => ProductionExpectation.Never,
        "EXPECTED" => ProductionExpectation.Expected,
        _ => null,
    };

    public static CompanyProfileResponse ToProfile(Customer customer) =>
        new(customer.Id,
            customer.LegalName,
            customer.TradeName,
            customer.KvkNumber.Value,
            customer.VatNumber,
            Wire(customer.Status),
            ToDto(customer.BillingAddress),
            ToDto(customer.VisitingAddress),
            ToDto(customer.PrimaryContact),
            customer.Locale);

    public static CompanyAccountDto ToAccountDto(CustomerAccount account) =>
        new(account.Id,
            account.FirstName,
            account.LastName,
            account.JobTitle,
            account.Email,
            account.Phone,
            Wire(account.Status),
            account.IsAdmin,
            account.LastLoginAt);
}
```

- [ ] **Step 5: Write the endpoints**

Create `src/Hosts/PeakPower.Api.Customer/Portal/CompanyEndpoints.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Infrastructure.Web.Http;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;

namespace PeakPower.Api.Customer.Portal;

public static class CompanyEndpoints
{
    public static IEndpointRouteBuilder MapCompanyEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/v1/company").WithTags("Company");

        group.MapGet("/", async (
                ICustomerContext tenancy,
                PeakPowerDbContext db,
                CancellationToken cancellationToken) =>
            {
                // No route parameter, by design. The company is whichever one the token names
                // and there is nothing here for a caller to substitute — [F13] business rule 2
                // made structural rather than merely checked.
                var customer = await db.Customers
                    .AsNoTracking()
                    .SingleOrDefaultAsync(c => c.Id == tenancy.CustomerId, cancellationToken);

                // The query filter already restricts this set, so "missing" can only mean
                // "not yours" — 404, never 403  [F13-R19].
                return customer is null
                    ? ApiResults.NotFound()
                    : Results.Ok(PortalMappings.ToProfile(customer));
            })
            .TenantScoped("customer")
            .WithName("GetCompany")
            .WithSummary("The signed-in customer's own company profile.");

        group.MapGet("/accounts", async (
                PeakPowerDbContext db,
                CancellationToken cancellationToken) =>
            {
                var accounts = await db.CustomerAccounts
                    .AsNoTracking()
                    .OrderBy(a => a.LastName).ThenBy(a => a.FirstName)
                    .ToListAsync(cancellationToken);

                return Results.Ok(new CompanyAccountsResponse(
                    accounts.Select(PortalMappings.ToAccountDto).ToList()));
            })
            .TenantScoped("customer-account")
            .WithName("GetCompanyAccounts")
            .WithSummary("The colleagues who can sign in at this company.");

        return routes;
    }
}
```

Add to `src/Hosts/PeakPower.Api.Customer/Program.cs`, beside `app.MapAuthEndpoints();`:

```csharp
app.MapCompanyEndpoints();
```

with the using:

```csharp
using PeakPower.Api.Customer.Portal;
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~CompanyEndpointTests"`
Expected: PASS — 5 passed, 0 failed

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Contracts/Customer/Portal \
        src/Hosts/PeakPower.Api.Customer/Portal \
        src/Hosts/PeakPower.Api.Customer/Program.cs \
        tests/PeakPower.Integration.Tests/Portal
git commit -m "feat(customer-api): expose the read-only company profile and account list"
```

---

### Task 3: `GET /metering-points` — the connections list and its free-text search

`[F01-R35]` is the list; `[F01-R36]` is free-text search across the friendly name, the
description and the EAN. Typing `8716` finds the EAN; typing `koel` finds "Venlo cold store"
if that is what it is called or described as.

**The search runs in memory, deliberately.** The EF Core global query filter and PostgreSQL
row-level security have already reduced the set to one company's connections — tens of rows,
not millions — and `EanCode` is a value-converted struct that will not translate a `LIKE`
against `mp.Ean.Value` without a shadow column. Materialising a company's own connections and
filtering them with a plain predicate is correct, is unit-testable without a database, and
costs nothing at this size. When it stops being free, the swap is a `search_text` generated
column with a trigram index — not a rewrite of this endpoint's contract.

`[F01-R30]` and `[F01-R31]`: the friendly name is the primary label and the EAN is secondary;
with no name, the label is the EAN grouped in fours — `8716 8710 0000 0000 11`. That is
`MeteringPoint.DisplayLabel`, which the domain already computes.

**Files:**
- Create: `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionSearch.cs`
- Create: `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Program.cs`
- Test: `tests/PeakPower.Integration.Tests/Portal/ConnectionListTests.cs`

**Interfaces:**
- Consumes: `MeteringPoint.Ean` (`EanCode`, with `Value` and `ToDisplayString()`),
  `MeteringPoint.Name`, `.Description`, `.DisplayLabel`, `.ValidFrom`, `.ValidTo`,
  `.GridOperator`, `.CapacityKw`, `.Address`, `.Commodity`;
  `ConnectionStatusRules.For(DateOnly, DateOnly, DateOnly?)` (Task 1);
  `IMarketCalendar.TodayInAmsterdam`; `PortalMappings` (Task 2);
  `PeakPowerDbContext.MeteringPoints`.
- Produces:
  - `PeakPower.Api.Customer.Portal.ConnectionSearch` with
    `public static string Normalise(string? raw)`,
    `public static bool Matches(MeteringPoint point, string normalisedQuery)`,
    `public static IReadOnlyList<MeteringPoint> Filter(IEnumerable<MeteringPoint> points, string? query)`
  - `PortalMappings.ToSummary(MeteringPoint point, DateOnly today) : ConnectionSummaryDto`
  - `PeakPower.Api.Customer.Portal.ConnectionEndpoints.MapConnectionEndpoints(this IEndpointRouteBuilder)`
  - `GET /api/v1/metering-points?q=` → 200 `ConnectionListResponse`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Portal/ConnectionListTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

public sealed class ConnectionListTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    private async Task<(HttpClient Client, Guid CustomerId)> SignedInAsync(string legalName, string kvk)
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(legalName, kvk, email, Password);

        var client = factory.CreateAnonymousClient();
        var signIn = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password));
        var body = await signIn.Content.ReadFromJsonAsync<SignInResponse>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body!.AccessToken);

        return (client, account.CustomerId);
    }

    /// <summary>Writes a metering point straight onto the owner connection, bypassing the API.</summary>
    private async Task<Guid> AttachAsync(
        Guid customerId, string ean, string? name, string? description,
        DateOnly validFrom, DateOnly? validTo = null)
    {
        await using var db = factory.CreateOwnerDbContext();
        var brp = await db.Brps.OrderBy(b => b.Code).FirstAsync();

        var point = MeteringPoint.Attach(
            customerId,
            EanCode.Create(ean).Value,
            brp.Id,
            ProductionExpectation.Unknown,
            expectationSource: null,
            name: name,
            description: description,
            gridOperator: "Stedin",
            capacityKw: 4200m,
            address: new Address("Waalhaven Zuidzijde", "8", null, "3089JH", "Rotterdam", "NL"),
            validFrom: validFrom);

        if (validTo is { } end) point.EndDate(end);

        db.MeteringPoints.Add(point);
        await db.SaveChangesAsync();
        return point.Id;
    }

    [Fact]
    public async Task An_empty_company_gets_an_empty_list_and_not_an_error()
    {
        var (client, _) = await SignedInAsync("Bosman Tuinbouw", "67554433");

        var list = await client.GetFromJsonAsync<ConnectionListResponse>("/api/v1/metering-points");

        list.Should().NotBeNull();
        list!.Items.Should().BeEmpty();
        list.Total.Should().Be(0);
    }

    [Fact]
    public async Task The_list_carries_the_display_label_the_grouped_ean_and_the_status()
    {
        var (client, customerId) = await SignedInAsync("Vandersteen Koeling B.V.", "34215678");
        await AttachAsync(customerId, "871687100000000011", "Rotterdam DC",
            "Data centre — 3 halls", new DateOnly(2024, 1, 1));
        await AttachAsync(customerId, "871687100000000061", null, null, new DateOnly(2024, 1, 1));

        var list = await client.GetFromJsonAsync<ConnectionListResponse>("/api/v1/metering-points");

        list!.Total.Should().Be(2);

        var named = list.Items.Single(i => i.Ean == "871687100000000011");
        named.DisplayLabel.Should().Be("Rotterdam DC");
        named.EanDisplay.Should().Be("8716 8710 0000 0000 11");
        named.Status.Should().Be("ACTIVE");
        named.Commodity.Should().Be("ELECTRICITY");
        named.City.Should().Be("Rotterdam");

        // [F01-R31]: with no friendly name the grouped EAN IS the label.
        var unnamed = list.Items.Single(i => i.Ean == "871687100000000061");
        unnamed.DisplayLabel.Should().Be("8716 8710 0000 0000 61");
        unnamed.Name.Should().BeNull();
    }

    [Fact]
    public async Task Last_data_date_is_null_because_ingestion_is_out_of_scope()
    {
        var (client, customerId) = await SignedInAsync("Nolte Chemie", "69988771");
        await AttachAsync(customerId, "871687100000000239", "Delfzijl works", null,
            new DateOnly(2024, 1, 1));

        var list = await client.GetFromJsonAsync<ConnectionListResponse>("/api/v1/metering-points");

        list!.Items.Single().LastDataDate.Should().BeNull();
    }

    [Fact]
    public async Task A_connection_with_a_near_end_date_reads_as_ending()
    {
        var (client, customerId) = await SignedInAsync("De Groot Papier", "63321098");
        await AttachAsync(customerId, "871687100000000078", "Breda warehouse", null,
            new DateOnly(2024, 1, 1), DateOnly.FromDateTime(DateTime.UtcNow).AddDays(30));

        var list = await client.GetFromJsonAsync<ConnectionListResponse>("/api/v1/metering-points");

        list!.Items.Single().Status.Should().Be("ENDING");
    }

    [Theory]
    [InlineData("Venlo", "871687100000000027")]        // the name
    [InlineData("freezer", "871687100000000027")]      // the description
    [InlineData("0043", "871687100000000043")]         // a fragment of the EAN
    [InlineData("8716 8710 0000 0000 43", "871687100000000043")]  // the grouped form, pasted
    [InlineData("VENLO", "871687100000000027")]        // case-insensitive
    public async Task Search_covers_the_name_the_description_and_the_ean(string query, string expected)
    {
        var (client, customerId) = await SignedInAsync($"Searchable {Guid.NewGuid():N}", "11111111");
        await AttachAsync(customerId, "871687100000000027", "Venlo cold store",
            "Freezer hall + dock 3 compressors", new DateOnly(2024, 1, 1));
        await AttachAsync(customerId, "871687100000000043", "Tilburg plant",
            "Logistics hub — 2 cold docks", new DateOnly(2024, 1, 1));

        var list = await client.GetFromJsonAsync<ConnectionListResponse>(
            $"/api/v1/metering-points?q={Uri.EscapeDataString(query)}");

        list!.Items.Should().ContainSingle().Which.Ean.Should().Be(expected);
    }

    [Fact]
    public async Task A_search_that_matches_nothing_returns_an_empty_list()
    {
        var (client, customerId) = await SignedInAsync($"Nothing {Guid.NewGuid():N}", "22222222");
        await AttachAsync(customerId, "871687100000000155", "Rotterdam Waalhaven", null,
            new DateOnly(2024, 1, 1));

        var list = await client.GetFromJsonAsync<ConnectionListResponse>(
            "/api/v1/metering-points?q=groningen");

        list!.Items.Should().BeEmpty();
        list.Total.Should().Be(0);
    }

    [Fact]
    public async Task One_companys_connections_are_invisible_to_another()
    {
        var (_, aId) = await SignedInAsync($"Company A {Guid.NewGuid():N}", "33333333");
        await AttachAsync(aId, "871687100000000163", "A's Botlek site", null, new DateOnly(2024, 1, 1));

        var (bClient, _) = await SignedInAsync($"Company B {Guid.NewGuid():N}", "44444444");

        var list = await bClient.GetFromJsonAsync<ConnectionListResponse>("/api/v1/metering-points");

        list!.Items.Should().BeEmpty("company B must not see company A's connections");
    }

    [Fact]
    public async Task An_anonymous_caller_gets_401()
    {
        var client = factory.CreateAnonymousClient();

        (await client.GetAsync("/api/v1/metering-points")).StatusCode
            .Should().Be(HttpStatusCode.Unauthorized);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConnectionListTests"`
Expected: FAIL — every case returns `404 Not Found`; there is no `/api/v1/metering-points` yet

- [ ] **Step 3: Write the search predicate**

Create `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionSearch.cs`:

```csharp
using PeakPower.Domain.Customers;

namespace PeakPower.Api.Customer.Portal;

/// <summary>
/// Free-text search over a company's own connections [F01-R36] — the friendly name, the
/// description and the EAN.
/// <para>
/// Runs in memory on purpose. The query filter and row-level security have already reduced the
/// set to one company's connections, which is tens of rows; and <c>EanCode</c> is a
/// value-converted struct, so a <c>LIKE</c> against <c>Ean.Value</c> does not translate without
/// a shadow column. A plain predicate is correct, testable without a database, and free at this
/// size. When it stops being free the answer is a <c>search_text</c> generated column with a
/// trigram index, not a change to this endpoint's contract.
/// </para>
/// </summary>
public static class ConnectionSearch
{
    /// <summary>
    /// Trims and lower-cases. Returns the empty string for a query that asks for everything, so
    /// callers have one thing to test rather than null, empty and whitespace.
    /// </summary>
    public static string Normalise(string? raw) => (raw ?? string.Empty).Trim().ToLowerInvariant();

    /// <summary>Digits only, so "8716 8710 0000 0000 43" and "871687100000000043" agree.</summary>
    private static string DigitsOnly(string value) =>
        string.Concat(value.Where(char.IsAsciiDigit));

    public static bool Matches(MeteringPoint point, string normalisedQuery)
    {
        if (normalisedQuery.Length == 0) return true;

        var digits = DigitsOnly(normalisedQuery);

        // A query that is nothing but digits and separators is an EAN fragment. Nothing else in
        // this data is a bare number, so there is no ambiguity to resolve.
        if (digits.Length > 0 && normalisedQuery.All(c => char.IsAsciiDigit(c) || c is ' ' or '-' or '.'))
        {
            return point.Ean.Value.Contains(digits, StringComparison.Ordinal);
        }

        return (point.Name is { } name
                && name.Contains(normalisedQuery, StringComparison.OrdinalIgnoreCase))
            || (point.Description is { } description
                && description.Contains(normalisedQuery, StringComparison.OrdinalIgnoreCase))
            || point.Ean.Value.Contains(normalisedQuery, StringComparison.OrdinalIgnoreCase);
    }

    public static IReadOnlyList<MeteringPoint> Filter(IEnumerable<MeteringPoint> points, string? query)
    {
        var normalised = Normalise(query);
        return points.Where(p => Matches(p, normalised)).ToList();
    }
}
```

- [ ] **Step 4: Add the summary mapping and the endpoint**

Add to `PortalMappings` in `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs`:

```csharp
    public static ConnectionSummaryDto ToSummary(MeteringPoint point, DateOnly today) =>
        new(point.Id,
            point.Ean.Value,
            point.Ean.ToDisplayString(),
            point.DisplayLabel,
            point.Name,
            point.Description,
            Wire(point.Commodity),
            Wire(ConnectionStatusRules.For(today, point.ValidFrom, point.ValidTo)),
            point.GridOperator,
            point.CapacityKw,
            point.Address?.City,
            point.ValidFrom,
            point.ValidTo,
            // Always null in slice 1 — ingestion is F02. The portal prints the reason rather
            // than a plausible date. Convention C4.
            LastDataDate: null);
```

Create `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;

namespace PeakPower.Api.Customer.Portal;

public static class ConnectionEndpoints
{
    public static IEndpointRouteBuilder MapConnectionEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/v1/metering-points").WithTags("Connections");

        group.MapGet("/", async (
                string? q,
                PeakPowerDbContext db,
                IMarketCalendar calendar,
                CancellationToken cancellationToken) =>
            {
                var points = await db.MeteringPoints
                    .AsNoTracking()
                    .OrderBy(p => p.ValidFrom).ThenBy(p => p.Id)
                    .ToListAsync(cancellationToken);

                var matched = ConnectionSearch.Filter(points, q);
                var today = calendar.TodayInAmsterdam;

                var items = matched
                    .Select(p => PortalMappings.ToSummary(p, today))
                    // Name first, then the unnamed by EAN — the named ones are the ones a
                    // person recognises, so they lead.
                    .OrderBy(i => i.Name is null)
                    .ThenBy(i => i.DisplayLabel, StringComparer.OrdinalIgnoreCase)
                    .ToList();

                return Results.Ok(new ConnectionListResponse(items, items.Count));
            })
            .TenantScoped("metering-point")
            .WithName("ListConnections")
            .WithSummary("This company's connections, with free-text search.");

        return routes;
    }
}
```

Add to `src/Hosts/PeakPower.Api.Customer/Program.cs`, beside `app.MapCompanyEndpoints();`:

```csharp
app.MapConnectionEndpoints();
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConnectionListTests"`
Expected: PASS — 12 passed, 0 failed (the `[Theory]` contributes five)

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Customer/Portal src/Hosts/PeakPower.Api.Customer/Program.cs \
        tests/PeakPower.Integration.Tests/Portal/ConnectionListTests.cs
git commit -m "feat(customer-api): list a company's connections with free-text search"
```

---

### Task 4: `GET /metering-points/{id}` — the connection detail, and 404 across tenants

`[F01-R38]`. This is the endpoint the route-table test in plan 2 exercises hardest, because it
is the first customer-facing route with an id in it: an id belonging to another company must
return **404, not 403** `[F13-R19]`. A 403 confirms that the object exists, which is a
cross-tenant information leak dressed up as good manners.

The detail carries the **BRP** — the *balance responsible party*, the market participant
answerable for the imbalance on this connection. Every metering point has exactly one and it is
mandatory `[F01-R51]`; PVNed is the first and, in slice 1, only row.

**Files:**
- Modify: `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs`
- Test: `tests/PeakPower.Integration.Tests/Portal/ConnectionDetailTests.cs`

**Interfaces:**
- Consumes: `PeakPowerDbContext.Brps` (`Brp.Id`, `.Code`, `.Name`); `ApiResults.NotFound()`;
  `PortalMappings.Wire(...)` and `ToDto(Address?)` (Task 2).
- Produces:
  - `PortalMappings.ToDetail(MeteringPoint point, string brpName, DateOnly today) : ConnectionDetailDto`
  - `GET /api/v1/metering-points/{id:guid}` → 200 `ConnectionDetailDto` · 404 for anything else

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Portal/ConnectionDetailTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

public sealed class ConnectionDetailTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    private async Task<(HttpClient Client, Guid CustomerId)> SignedInAsync(string legalName, string kvk)
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(legalName, kvk, email, Password);

        var client = factory.CreateAnonymousClient();
        var signIn = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password));
        var body = await signIn.Content.ReadFromJsonAsync<SignInResponse>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body!.AccessToken);

        return (client, account.CustomerId);
    }

    private async Task<Guid> AttachAsync(Guid customerId, string ean, string? name)
    {
        await using var db = factory.CreateOwnerDbContext();
        var brp = await db.Brps.OrderBy(b => b.Code).FirstAsync();

        var point = MeteringPoint.Attach(
            customerId, EanCode.Create(ean).Value, brp.Id,
            ProductionExpectation.Expected, ProductionExpectationSource.CustomerDeclared,
            name, "Freezer hall + dock 3 compressors", "Enexis", 2500m,
            new Address("Ceresstraat", "14", null, "5928LA", "Venlo", "NL"),
            new DateOnly(2024, 1, 1));

        db.MeteringPoints.Add(point);
        await db.SaveChangesAsync();
        return point.Id;
    }

    [Fact]
    public async Task The_detail_carries_the_brp_the_expectation_and_the_address()
    {
        var (client, customerId) = await SignedInAsync($"Detail {Guid.NewGuid():N}", "55555555");
        var id = await AttachAsync(customerId, "871687100000000027", "Venlo cold store");

        var detail = await client.GetFromJsonAsync<ConnectionDetailDto>(
            $"/api/v1/metering-points/{id}");

        detail.Should().NotBeNull();
        detail!.DisplayLabel.Should().Be("Venlo cold store");
        detail.EanDisplay.Should().Be("8716 8710 0000 0000 27");
        detail.BrpName.Should().NotBeNullOrWhiteSpace();
        detail.BrpId.Should().NotBeEmpty();
        detail.ProductionExpectation.Should().Be("EXPECTED");
        detail.ExpectationSource.Should().Be("CUSTOMER_DECLARED");
        detail.Address!.PostalCode.Should().Be("5928LA");
        detail.CapacityKw.Should().Be(2500m);
        detail.LastDataDate.Should().BeNull();
    }

    [Fact]
    public async Task Another_companys_connection_is_404_and_never_403()
    {
        var (_, aId) = await SignedInAsync($"Owner {Guid.NewGuid():N}", "66666666");
        var theirs = await AttachAsync(aId, "871687100000000171", "Hornweg");

        var (bClient, _) = await SignedInAsync($"Stranger {Guid.NewGuid():N}", "77777777");

        var response = await bClient.GetAsync($"/api/v1/metering-points/{theirs}");

        // 403 would confirm the row exists. [F13-R19] says 404.
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        response.StatusCode.Should().NotBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task An_id_that_exists_nowhere_is_also_404()
    {
        var (client, _) = await SignedInAsync($"Missing {Guid.NewGuid():N}", "88888888");

        var response = await client.GetAsync($"/api/v1/metering-points/{Guid.NewGuid()}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_not_found_answer_is_rfc_7807_problem_json()
    {
        var (client, _) = await SignedInAsync($"Problem {Guid.NewGuid():N}", "99999999");

        var response = await client.GetAsync($"/api/v1/metering-points/{Guid.NewGuid()}");

        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConnectionDetailTests"`
Expected: FAIL — the first case throws because the body is empty; the route does not exist yet

- [ ] **Step 3: Write the mapping and the endpoint**

Add to `PortalMappings`:

```csharp
    public static ConnectionDetailDto ToDetail(MeteringPoint point, string brpName, DateOnly today) =>
        new(point.Id,
            point.Ean.Value,
            point.Ean.ToDisplayString(),
            point.DisplayLabel,
            point.Name,
            point.Description,
            Wire(point.Commodity),
            Wire(ConnectionStatusRules.For(today, point.ValidFrom, point.ValidTo)),
            point.BrpId,
            brpName,
            Wire(point.ProductionExpectation),
            Wire(point.ExpectationSource),
            point.GridOperator,
            point.CapacityKw,
            ToDto(point.Address),
            point.ValidFrom,
            point.ValidTo,
            LastDataDate: null);
```

Add to `MapConnectionEndpoints` in `ConnectionEndpoints.cs`, before `return routes;`:

```csharp
        group.MapGet("/{id:guid}", async (
                Guid id,
                PeakPowerDbContext db,
                IMarketCalendar calendar,
                CancellationToken cancellationToken) =>
            {
                var point = await db.MeteringPoints
                    .AsNoTracking()
                    .SingleOrDefaultAsync(p => p.Id == id, cancellationToken);

                // The global query filter has already excluded every other company's rows, so
                // this null covers "does not exist" and "is not yours" with one answer. That is
                // the point: 404, never 403  [F13-R19].
                if (point is null) return ApiResults.NotFound();

                // The BRP — the balance responsible party answerable for this connection's
                // imbalance — is reference data, so it is not behind the tenant filter.
                var brpName = await db.Brps
                    .AsNoTracking()
                    .Where(b => b.Id == point.BrpId)
                    .Select(b => b.Name)
                    .SingleOrDefaultAsync(cancellationToken) ?? "Unknown";

                return Results.Ok(PortalMappings.ToDetail(point, brpName, calendar.TodayInAmsterdam));
            })
            .TenantScoped("metering-point")
            .WithName("GetConnection")
            .WithSummary("One of this company's connections in full.");
```

with the using added at the top of the file:

```csharp
using PeakPower.Infrastructure.Web.Http;
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConnectionDetailTests"`
Expected: PASS — 4 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Customer/Portal \
        tests/PeakPower.Integration.Tests/Portal/ConnectionDetailTests.cs
git commit -m "feat(customer-api): serve connection detail, 404 across tenants"
```

---

### Task 5: `PATCH /metering-points/{id}/naming` — the friendly name

`[F01-R29]`: a name of at most 80 characters and a description of at most 500. `[F01-R30]`: the
name replaces the EAN as the primary label, with the EAN secondary and copyable. `[F01-R31]`:
with no name, the grouped EAN is the label.

The route is `/naming`, not `/label`. The specification writes `/label`; §5.4 of the design
settles the friendly name as `name` + `description` columns rather than a `Label` property, so
the route name follows. Task 22 files that as a correction — the route has no consumers yet, so
renaming is free now and awkward later.

**Clearing is a first-class operation.** Sending `{"name": null}` or `{"name": ""}` removes the
name and the label falls back to the grouped EAN. A rename endpoint that can only ever set a
value traps a customer with a typo they made once.

**Files:**
- Modify: `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs`
- Test: `tests/PeakPower.Integration.Tests/Portal/ConnectionNamingTests.cs`

**Interfaces:**
- Consumes: `MeteringPoint.UpdateDetails(Guid brpId, ProductionExpectation, ProductionExpectationSource?, string? name, string? description, string? gridOperator, decimal? capacityKw, Address?)`;
  `ApiResults.InvalidRequest(string property, string error)` and `ApiResults.NotFound()`.
- Produces: `PATCH /api/v1/metering-points/{id:guid}/naming`, body `RenameConnectionRequest`
  → 200 `ConnectionDetailDto` · 400 problem+json · 404

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Portal/ConnectionNamingTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

public sealed class ConnectionNamingTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    private async Task<(HttpClient Client, Guid CustomerId)> SignedInAsync(string kvk)
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Naming {Guid.NewGuid():N}", kvk, email, Password);

        var client = factory.CreateAnonymousClient();
        var signIn = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password));
        var body = await signIn.Content.ReadFromJsonAsync<SignInResponse>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body!.AccessToken);

        return (client, account.CustomerId);
    }

    private async Task<Guid> AttachAsync(Guid customerId, string ean, string? name)
    {
        await using var db = factory.CreateOwnerDbContext();
        var brp = await db.Brps.OrderBy(b => b.Code).FirstAsync();

        var point = MeteringPoint.Attach(
            customerId, EanCode.Create(ean).Value, brp.Id,
            ProductionExpectation.Unknown, null, name, null, "Liander", 900m, null,
            new DateOnly(2024, 1, 1));

        db.MeteringPoints.Add(point);
        await db.SaveChangesAsync();
        return point.Id;
    }

    [Fact]
    public async Task Setting_a_name_makes_it_the_display_label()
    {
        var (client, customerId) = await SignedInAsync("10000001");
        var id = await AttachAsync(customerId, "871687100000000189", null);

        var response = await client.PatchAsJsonAsync(
            $"/api/v1/metering-points/{id}/naming",
            new RenameConnectionRequest("Kabelweg depot", "Roof array and two docks"));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var detail = await response.Content.ReadFromJsonAsync<ConnectionDetailDto>();
        detail!.Name.Should().Be("Kabelweg depot");
        detail.Description.Should().Be("Roof array and two docks");
        detail.DisplayLabel.Should().Be("Kabelweg depot");
    }

    [Fact]
    public async Task Clearing_the_name_restores_the_grouped_ean_as_the_label()
    {
        var (client, customerId) = await SignedInAsync("10000002");
        var id = await AttachAsync(customerId, "871687100000000197", "Croy site");

        var response = await client.PatchAsJsonAsync(
            $"/api/v1/metering-points/{id}/naming", new RenameConnectionRequest(null, null));

        var detail = await response.Content.ReadFromJsonAsync<ConnectionDetailDto>();
        detail!.Name.Should().BeNull();
        detail.DisplayLabel.Should().Be("8716 8710 0000 0001 97");
    }

    [Fact]
    public async Task An_empty_string_clears_rather_than_storing_a_blank_name()
    {
        var (client, customerId) = await SignedInAsync("10000003");
        var id = await AttachAsync(customerId, "871687100000000213", "Vossenberg");

        var response = await client.PatchAsJsonAsync(
            $"/api/v1/metering-points/{id}/naming", new RenameConnectionRequest("   ", ""));

        var detail = await response.Content.ReadFromJsonAsync<ConnectionDetailDto>();
        detail!.Name.Should().BeNull();
        detail.Description.Should().BeNull();
    }

    [Fact]
    public async Task A_name_of_exactly_eighty_characters_is_accepted()
    {
        var (client, customerId) = await SignedInAsync("10000004");
        var id = await AttachAsync(customerId, "871687100000000221", null);

        var response = await client.PatchAsJsonAsync(
            $"/api/v1/metering-points/{id}/naming",
            new RenameConnectionRequest(new string('x', 80), null));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task A_name_of_eighty_one_characters_is_rejected_with_a_named_field()
    {
        var (client, customerId) = await SignedInAsync("10000005");
        var id = await AttachAsync(customerId, "871687100000000247", null);

        var response = await client.PatchAsJsonAsync(
            $"/api/v1/metering-points/{id}/naming",
            new RenameConnectionRequest(new string('x', 81), null));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");
        (await response.Content.ReadAsStringAsync()).Should().Contain("name");
    }

    [Fact]
    public async Task A_description_of_five_hundred_and_one_characters_is_rejected()
    {
        var (client, customerId) = await SignedInAsync("10000006");
        var id = await AttachAsync(customerId, "871687100000000254", null);

        var response = await client.PatchAsJsonAsync(
            $"/api/v1/metering-points/{id}/naming",
            new RenameConnectionRequest(null, new string('y', 501)));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("description");
    }

    [Fact]
    public async Task Renaming_another_companys_connection_is_404()
    {
        var (_, aId) = await SignedInAsync("10000007");
        var theirs = await AttachAsync(aId, "871687100000000262", "Westervoortsedijk");

        var (bClient, _) = await SignedInAsync("10000008");

        var response = await bClient.PatchAsJsonAsync(
            $"/api/v1/metering-points/{theirs}/naming",
            new RenameConnectionRequest("Mine now", null));

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);

        await using var db = factory.CreateOwnerDbContext();
        var untouched = await db.MeteringPoints.SingleAsync(p => p.Id == theirs);
        untouched.Name.Should().Be("Westervoortsedijk");
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConnectionNamingTests"`
Expected: FAIL — every case returns `405 Method Not Allowed` or `404`; the route does not exist

- [ ] **Step 3: Write the endpoint**

Add to `MapConnectionEndpoints` in `ConnectionEndpoints.cs`, before `return routes;`:

```csharp
        group.MapPatch("/{id:guid}/naming", async (
                Guid id,
                RenameConnectionRequest request,
                PeakPowerDbContext db,
                IMarketCalendar calendar,
                CancellationToken cancellationToken) =>
            {
                // Blank is not a name. Whitespace-only input clears the field rather than
                // storing an invisible string that renders as an empty label.
                var name = Blank(request.Name);
                var description = Blank(request.Description);

                if (name is { Length: > MaxNameLength })
                {
                    return ApiResults.InvalidRequest(
                        "name", $"A name is at most {MaxNameLength} characters.");
                }

                if (description is { Length: > MaxDescriptionLength })
                {
                    return ApiResults.InvalidRequest(
                        "description",
                        $"A description is at most {MaxDescriptionLength} characters.");
                }

                var point = await db.MeteringPoints
                    .SingleOrDefaultAsync(p => p.Id == id, cancellationToken);
                if (point is null) return ApiResults.NotFound();

                point.UpdateDetails(
                    point.BrpId,
                    point.ProductionExpectation,
                    point.ExpectationSource,
                    name,
                    description,
                    point.GridOperator,
                    point.CapacityKw,
                    point.Address);

                await db.SaveChangesAsync(cancellationToken);

                var brpName = await db.Brps
                    .AsNoTracking()
                    .Where(b => b.Id == point.BrpId)
                    .Select(b => b.Name)
                    .SingleOrDefaultAsync(cancellationToken) ?? "Unknown";

                return Results.Ok(
                    PortalMappings.ToDetail(point, brpName, calendar.TodayInAmsterdam));
            })
            .TenantScoped("metering-point")
            .WithName("RenameConnection")
            .WithSummary("Set or clear this connection's friendly name and description.");
```

and add the two limits plus the helper as members of `ConnectionEndpoints`:

```csharp
    /// <summary>[F01-R29] — the friendly name.</summary>
    private const int MaxNameLength = 80;

    /// <summary>[F01-R29] — the description.</summary>
    private const int MaxDescriptionLength = 500;

    private static string? Blank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConnectionNamingTests"`
Expected: PASS — 7 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs \
        tests/PeakPower.Integration.Tests/Portal/ConnectionNamingTests.cs
git commit -m "feat(customer-api): name and describe a connection at PATCH /naming"
```

---

### Task 6: The shared EAN pool — the aggregate, migration 3, and `GET /ean-pool`

`[DEC-113]` lets a customer claim a metering point themselves rather than waiting for a
PeakPower employee to attach one, which amends `[F01-R23]`. The demo already works this way:
both portals draw from one pool of grid connections that nobody has claimed yet, and a claim
removes the entry for everyone.

**The pool is not tenant data** (convention C2). It sits in the `metering` schema beside
`metering.brp` as shared reference data: no row-level-security policy, `SELECT` and `UPDATE`
granted to `app_customer_role`. Nothing leaks, because the endpoint only ever returns
**unclaimed** rows and the DTO carries no claimant.

Slice 1 has migration 1 (plan 1) and migration 2 (plan 5). This is **migration 3**.

**Files:**
- Create: `src/Core/PeakPower.Domain/Metering/EanPoolEntry.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/Configurations/EanPoolEntryConfiguration.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/Migrations/*_M3_EanPool.cs` *(scaffolded)*
- Modify: `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs`
- Create: `src/Hosts/PeakPower.Api.Customer/Portal/EanPoolEndpoints.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Program.cs`
- Test: `tests/PeakPower.Domain.Tests/Metering/EanPoolEntryTests.cs`
- Test: `tests/PeakPower.Integration.Tests/Portal/EanPoolTests.cs`

**Interfaces:**
- Consumes: `EanCode`, `Result<T>`, `Address`, `Commodity`; `AnonymousEndpoint`/`TenantScoped`
  conventions; the `app_customer_role` and `app_employee_role` roles created by plan 2's
  migration 2.
- Produces:
  - `PeakPower.Domain.Metering.EanPoolEntry` — see Step 3 for the full member list
  - `PeakPowerDbContext.EanPool` — `DbSet<EanPoolEntry>`
  - table `metering.ean_pool`
  - `PortalMappings.ToPoolEntryDto(EanPoolEntry) : EanPoolEntryDto`
  - `PeakPower.Api.Customer.Portal.EanPoolEndpoints.MapEanPoolEndpoints(this IEndpointRouteBuilder)`
  - `GET /api/v1/ean-pool?q=` → 200 `EanPoolResponse`

- [ ] **Step 1: Write the failing domain test**

Create `tests/PeakPower.Domain.Tests/Metering/EanPoolEntryTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using Xunit;

namespace PeakPower.Domain.Tests.Metering;

public sealed class EanPoolEntryTests
{
    private static readonly DateTimeOffset Now =
        new(2026, 8, 26, 10, 0, 0, TimeSpan.Zero);

    private static EanPoolEntry Unclaimed() => EanPoolEntry.Create(
        EanCode.Create("871687100000000114").Value,
        Commodity.Electricity,
        "Enexis",
        2500m,
        new Address("Ceresstraat", "16", null, "5928LA", "Venlo", "NL"));

    [Fact]
    public void A_new_entry_is_unclaimed()
    {
        var entry = Unclaimed();

        entry.IsClaimed.Should().BeFalse();
        entry.ClaimedAt.Should().BeNull();
        entry.ClaimedByCustomerId.Should().BeNull();
    }

    [Fact]
    public void Claiming_records_who_took_it_and_when()
    {
        var entry = Unclaimed();
        var customerId = Guid.NewGuid();

        var result = entry.Claim(customerId, Now);

        result.IsSuccess.Should().BeTrue();
        entry.IsClaimed.Should().BeTrue();
        entry.ClaimedByCustomerId.Should().Be(customerId);
        entry.ClaimedAt.Should().Be(Now);
    }

    [Fact]
    public void A_second_claim_fails_and_changes_nothing()
    {
        var entry = Unclaimed();
        var first = Guid.NewGuid();
        entry.Claim(first, Now);

        var result = entry.Claim(Guid.NewGuid(), Now.AddMinutes(1));

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("That connection has already been claimed.");
        entry.ClaimedByCustomerId.Should().Be(first, "the first claim stands");
        entry.ClaimedAt.Should().Be(Now);
    }

    [Fact]
    public void Re_claiming_by_the_same_customer_still_fails()
    {
        // Idempotence would be wrong here: a second claim would create a SECOND metering point
        // for one EAN, which the exclusion constraint would then reject at a confusing depth.
        var entry = Unclaimed();
        var customerId = Guid.NewGuid();
        entry.Claim(customerId, Now);

        entry.Claim(customerId, Now.AddMinutes(1)).IsSuccess.Should().BeFalse();
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Domain.Tests --filter "FullyQualifiedName~EanPoolEntryTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'EanPoolEntry' could not be found`

- [ ] **Step 3: Write the aggregate**

Create `src/Core/PeakPower.Domain/Metering/EanPoolEntry.cs`:

```csharp
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;

namespace PeakPower.Domain.Metering;

/// <summary>
/// One grid connection that is registered with a grid operator and belongs to nobody yet.
/// <para>
/// Both portals draw from this one pool [DEC-113]: the desk assigns an entry to a customer, or
/// a customer claims one themselves, and either way it leaves the pool for everyone. It is
/// shared reference data, not tenant data — there is no row-level-security policy on it, and
/// the API only ever returns unclaimed rows.
/// </para>
/// </summary>
public sealed class EanPoolEntry
{
    // EF Core materialises through this; nothing else may.
    private EanPoolEntry() { }

    public Guid Id { get; private set; }
    public EanCode Ean { get; private set; }
    public Commodity Commodity { get; private set; }
    public string? GridOperator { get; private set; }
    public decimal? CapacityKw { get; private set; }
    public Address? Address { get; private set; }
    public DateTimeOffset? ClaimedAt { get; private set; }
    public Guid? ClaimedByCustomerId { get; private set; }

    public bool IsClaimed => ClaimedAt is not null;

    public static EanPoolEntry Create(
        EanCode ean,
        Commodity commodity,
        string? gridOperator,
        decimal? capacityKw,
        Address? address) =>
        new()
        {
            Id = Guid.NewGuid(),
            Ean = ean,
            Commodity = commodity,
            GridOperator = gridOperator,
            CapacityKw = capacityKw,
            Address = address,
        };

    /// <summary>
    /// Takes this entry out of the pool.
    /// <para>
    /// Deliberately NOT idempotent, even for the same customer: a silently successful second
    /// claim would create a second metering point for one EAN, and the failure would then
    /// surface as the GiST exclusion constraint rejecting an overlapping validity period —
    /// technically correct and impossible to read.
    /// </para>
    /// </summary>
    public Result<EanPoolEntry> Claim(Guid customerId, DateTimeOffset at)
    {
        if (IsClaimed)
        {
            return Result<EanPoolEntry>.Failure("That connection has already been claimed.");
        }

        ClaimedByCustomerId = customerId;
        ClaimedAt = at;
        return Result<EanPoolEntry>.Success(this);
    }
}
```

- [ ] **Step 4: Run the domain test and watch it pass**

Run: `dotnet test tests/PeakPower.Domain.Tests --filter "FullyQualifiedName~EanPoolEntryTests"`
Expected: PASS — 4 passed, 0 failed

- [ ] **Step 5: Map it and scaffold migration 3**

Create `src/Infrastructure/PeakPower.Persistence/Configurations/EanPoolEntryConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Common;
using PeakPower.Domain.Metering;

namespace PeakPower.Persistence.Configurations;

public sealed class EanPoolEntryConfiguration : IEntityTypeConfiguration<EanPoolEntry>
{
    public void Configure(EntityTypeBuilder<EanPoolEntry> builder)
    {
        builder.ToTable("ean_pool", "metering");

        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).HasDefaultValueSql("gen_random_uuid()");

        builder.Property(e => e.Ean)
            .HasConversion(v => v.Value, v => EanCode.Create(v).Value)
            .HasMaxLength(18)
            .IsRequired();

        // One row per EAN. The pool is a registry, not a queue.
        builder.HasIndex(e => e.Ean).IsUnique();

        builder.Property(e => e.Commodity).HasColumnType("text").IsRequired();
        builder.Property(e => e.GridOperator).HasMaxLength(120);
        builder.Property(e => e.CapacityKw).HasColumnType("numeric(18,6)");
        builder.OwnsOne(e => e.Address, a => a.ToJson());

        builder.Property(e => e.ClaimedAt).HasColumnType("timestamptz");

        // Deliberately NOT a foreign key to customer.customer. The pool is reference data in
        // another schema and must stay readable by a role that has no rights on customer.*;
        // a foreign key would drag that table into the grant.
        builder.Property(e => e.ClaimedByCustomerId);

        // The only query the API runs is "unclaimed, maybe matching a string".
        builder.HasIndex(e => e.ClaimedAt).HasFilter("claimed_at IS NULL");
    }
}
```

Add to `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs`:

```csharp
    /// <summary>
    /// Unclaimed grid connections [DEC-113]. NOT tenant data — see the plan's convention C2 —
    /// so this set carries no global query filter.
    /// </summary>
    public DbSet<EanPoolEntry> EanPool => Set<EanPoolEntry>();
```

with `using PeakPower.Domain.Metering;` at the top.

Scaffold the migration:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet ef migrations add M3_EanPool \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator
```

Then open the generated `*_M3_EanPool.cs` and append the grants to the end of `Up`:

```csharp
        // The pool is shared reference data, like metering.brp: no row-level security, because
        // there is no tenant column to filter on and the API never returns a claimed row.
        // UPDATE is granted because claiming is an update; INSERT and DELETE are not, because
        // only the seeder and the back office add or remove entries.
        migrationBuilder.Sql("""
            GRANT SELECT, UPDATE ON metering.ean_pool TO app_customer_role;
            GRANT SELECT           ON metering.ean_pool TO app_employee_role;
            """);
```

and the matching revocation to `Down`, above the generated `DropTable`:

```csharp
        migrationBuilder.Sql("""
            REVOKE ALL ON metering.ean_pool FROM app_customer_role;
            REVOKE ALL ON metering.ean_pool FROM app_employee_role;
            """);
```

- [ ] **Step 6: Write the failing endpoint test**

Create `tests/PeakPower.Integration.Tests/Portal/EanPoolTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

public sealed class EanPoolTests(CustomerApiFactory factory) : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    private async Task<HttpClient> SignedInAsync(string kvk)
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        await factory.SeedCustomerWithAccountAsync($"Pool {Guid.NewGuid():N}", kvk, email, Password);

        var client = factory.CreateAnonymousClient();
        var signIn = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password));
        var body = await signIn.Content.ReadFromJsonAsync<SignInResponse>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body!.AccessToken);
        return client;
    }

    private async Task<EanPoolEntry> AddToPoolAsync(
        string ean, string city, string? gridOperator = "Enexis")
    {
        await using var db = factory.CreateOwnerDbContext();
        var entry = EanPoolEntry.Create(
            EanCode.Create(ean).Value,
            Commodity.Electricity,
            gridOperator,
            1250m,
            new Address("Ceresstraat", "18", null, "5928LA", city, "NL"));
        db.EanPool.Add(entry);
        await db.SaveChangesAsync();
        return entry;
    }

    [Fact]
    public async Task The_pool_lists_unclaimed_connections_with_the_grouped_ean()
    {
        var client = await SignedInAsync("20000001");
        await AddToPoolAsync("871687100000000122", "VENLO");

        var pool = await client.GetFromJsonAsync<EanPoolResponse>(
            "/api/v1/ean-pool?q=871687100000000122");

        var entry = pool!.Items.Should().ContainSingle().Subject;
        entry.Ean.Should().Be("871687100000000122");
        entry.EanDisplay.Should().Be("8716 8710 0000 0001 22");
        entry.Commodity.Should().Be("ELECTRICITY");
        entry.GridOperator.Should().Be("Enexis");
        entry.Address!.City.Should().Be("VENLO");
    }

    [Fact]
    public async Task Search_matches_the_ean_the_city_and_the_street()
    {
        var client = await SignedInAsync("20000002");
        await AddToPoolAsync("871687100000000320", "SPIJKENISSE");

        (await client.GetFromJsonAsync<EanPoolResponse>("/api/v1/ean-pool?q=spijkenisse"))!
            .Items.Should().ContainSingle(i => i.Ean == "871687100000000320");

        (await client.GetFromJsonAsync<EanPoolResponse>("/api/v1/ean-pool?q=0320"))!
            .Items.Should().ContainSingle(i => i.Ean == "871687100000000320");

        (await client.GetFromJsonAsync<EanPoolResponse>("/api/v1/ean-pool?q=Ceresstraat"))!
            .Items.Should().Contain(i => i.Ean == "871687100000000320");
    }

    [Fact]
    public async Task A_claimed_entry_never_appears_again()
    {
        var client = await SignedInAsync("20000003");
        var entry = await AddToPoolAsync("871687100000000312", "ENSCHEDE");

        await using (var db = factory.CreateOwnerDbContext())
        {
            var tracked = await db.EanPool.FindAsync(entry.Id);
            tracked!.Claim(Guid.NewGuid(), DateTimeOffset.UtcNow);
            await db.SaveChangesAsync();
        }

        var pool = await client.GetFromJsonAsync<EanPoolResponse>(
            "/api/v1/ean-pool?q=871687100000000312");

        pool!.Items.Should().BeEmpty();
    }

    [Fact]
    public async Task The_pool_never_says_who_claimed_anything()
    {
        var client = await SignedInAsync("20000004");
        await AddToPoolAsync("871687100000000304", "MAASTRICHT");

        var raw = await client.GetStringAsync("/api/v1/ean-pool?q=maastricht");

        raw.Should().NotContainEquivalentOf("claimedBy");
        raw.Should().NotContainEquivalentOf("claimedAt");
    }

    [Fact]
    public async Task An_anonymous_caller_gets_401()
    {
        var client = factory.CreateAnonymousClient();

        (await client.GetAsync("/api/v1/ean-pool")).StatusCode
            .Should().Be(HttpStatusCode.Unauthorized);
    }
}
```

- [ ] **Step 7: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~EanPoolTests"`
Expected: FAIL — `404 Not Found`; there is no `/api/v1/ean-pool` yet

- [ ] **Step 8: Write the endpoint**

Add to `PortalMappings`:

```csharp
    public static EanPoolEntryDto ToPoolEntryDto(EanPoolEntry entry) =>
        new(entry.Ean.Value,
            entry.Ean.ToDisplayString(),
            Wire(entry.Commodity),
            entry.GridOperator,
            entry.CapacityKw,
            ToDto(entry.Address));
```

with `using PeakPower.Domain.Metering;` at the top of the file.

Create `src/Hosts/PeakPower.Api.Customer/Portal/EanPoolEndpoints.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Metering;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;

namespace PeakPower.Api.Customer.Portal;

public static class EanPoolEndpoints
{
    /// <summary>
    /// How many pool entries one search returns. The pool is a national registry, so an
    /// unfiltered listing is not a useful screen; the cap makes the search box the way in
    /// rather than a decoration beside an endless list.
    /// </summary>
    private const int MaxResults = 50;

    public static IEndpointRouteBuilder MapEanPoolEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/api/v1/ean-pool", async (
                string? q,
                PeakPowerDbContext db,
                CancellationToken cancellationToken) =>
            {
                var query = (q ?? string.Empty).Trim();
                var digits = string.Concat(query.Where(char.IsAsciiDigit));

                // Unclaimed only. A claimed row is invisible here, which is why the pool needs
                // no row-level security to keep one customer's choices private from another.
                var candidates = db.EanPool
                    .AsNoTracking()
                    .Where(e => e.ClaimedAt == null);

                var entries = await candidates
                    .OrderBy(e => e.Ean)
                    .ToListAsync(cancellationToken);

                var matched = entries.Where(e => Matches(e, query, digits)).ToList();

                var items = matched
                    .Take(MaxResults)
                    .Select(PortalMappings.ToPoolEntryDto)
                    .ToList();

                return Results.Ok(new EanPoolResponse(items, matched.Count));
            })
            .TenantScoped("ean-pool")
            .WithName("SearchEanPool")
            .WithSummary("Grid connections nobody has claimed yet.");

        return routes;
    }

    /// <summary>
    /// Free text over the EAN, the street and the city — the three things somebody holding a
    /// grid-operator letter can actually read off it.
    /// </summary>
    private static bool Matches(EanPoolEntry entry, string query, string digits)
    {
        if (query.Length == 0) return true;

        if (digits.Length > 0 && entry.Ean.Value.Contains(digits, StringComparison.Ordinal))
        {
            return true;
        }

        if (entry.Address is not { } address) return false;

        return address.City.Contains(query, StringComparison.OrdinalIgnoreCase)
            || address.Street.Contains(query, StringComparison.OrdinalIgnoreCase)
            || address.PostalCode.Replace(" ", "")
                .Contains(query.Replace(" ", ""), StringComparison.OrdinalIgnoreCase);
    }
}
```

Add to `src/Hosts/PeakPower.Api.Customer/Program.cs`:

```csharp
app.MapEanPoolEndpoints();
```

- [ ] **Step 9: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~EanPoolTests"`
Expected: PASS — 5 passed, 0 failed

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Metering/EanPoolEntry.cs \
        src/Infrastructure/PeakPower.Persistence \
        src/Hosts/PeakPower.Api.Customer/Portal \
        src/Hosts/PeakPower.Api.Customer/Program.cs \
        tests/PeakPower.Domain.Tests/Metering \
        tests/PeakPower.Integration.Tests/Portal/EanPoolTests.cs
git commit -m "feat(customer-api): add the shared EAN pool and its search endpoint"
```

---

### Task 7: `POST /metering-points` — claim one from the pool

`[F01-R54]` and `[DEC-113]`. The customer picks an unclaimed EAN and declares whether that
connection **produces** electricity — whether it ever feeds power back into the grid, typically
from solar panels. `[DEC-112]` makes that declaration the customer's responsibility, and a
wrong answer is a settlement error rather than a chart error, so the wizard asks deliberately
rather than defaulting through it.

The source is recorded as `CUSTOMER_DECLARED` and is **not** the caller's to choose: a client
that could send `CONTRACT` could launder its own guess into something that reads as
contractual.

Four things happen in one transaction: the pool entry is claimed, a `metering_point` is
created, the BRP is attached (mandatory, `[F01-R51]`), and the validity window opens today. If
two customers race for the same EAN, one gets a 409 and no metering point.

**Files:**
- Modify: `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs`
- Test: `tests/PeakPower.Integration.Tests/Portal/ClaimConnectionTests.cs`

**Interfaces:**
- Consumes: `EanPoolEntry.Claim(Guid customerId, DateTimeOffset at) : Result<EanPoolEntry>`
  (Task 6); `MeteringPoint.Attach(...)` (plan 2); `ICustomerContext.CustomerId`;
  `IMarketCalendar.UtcNow` and `.TodayInAmsterdam`; `ApiResults.Conflict(string detail)` and
  `ApiResults.InvalidRequest(string, string)`; `PortalMappings.ParseProductionExpectation(string?)`.
- Produces: `POST /api/v1/metering-points`, body `ClaimConnectionRequest`
  → 201 `ConnectionDetailDto` with a `Location` header · 400 · 409

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Portal/ClaimConnectionTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

public sealed class ClaimConnectionTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    private async Task<(HttpClient Client, Guid CustomerId)> SignedInAsync(string kvk)
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Claim {Guid.NewGuid():N}", kvk, email, Password);

        var client = factory.CreateAnonymousClient();
        var signIn = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password));
        var body = await signIn.Content.ReadFromJsonAsync<SignInResponse>();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body!.AccessToken);

        return (client, account.CustomerId);
    }

    private async Task AddToPoolAsync(string ean)
    {
        await using var db = factory.CreateOwnerDbContext();
        db.EanPool.Add(EanPoolEntry.Create(
            EanCode.Create(ean).Value, Commodity.Electricity, "Stedin", 3200m,
            new Address("Waalhaven Zuidzijde", "12", null, "3089JH", "ROTTERDAM", "NL")));
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Claiming_creates_a_connection_carrying_the_pool_entrys_facts()
    {
        var (client, customerId) = await SignedInAsync("30000001");
        await AddToPoolAsync("871687100000000155");

        var response = await client.PostAsJsonAsync(
            "/api/v1/metering-points",
            new ClaimConnectionRequest("871687100000000155", "EXPECTED", "Waalhaven yard", null));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        response.Headers.Location.Should().NotBeNull();

        var detail = await response.Content.ReadFromJsonAsync<ConnectionDetailDto>();
        detail!.Ean.Should().Be("871687100000000155");
        detail.Name.Should().Be("Waalhaven yard");
        detail.GridOperator.Should().Be("Stedin");
        detail.CapacityKw.Should().Be(3200m);
        detail.Address!.City.Should().Be("ROTTERDAM");
        detail.Status.Should().Be("ACTIVE");
        detail.ProductionExpectation.Should().Be("EXPECTED");

        await using var db = factory.CreateOwnerDbContext();
        var stored = await db.MeteringPoints.SingleAsync(p => p.Id == detail.Id);
        stored.CustomerId.Should().Be(customerId);
    }

    [Fact]
    public async Task The_source_is_always_customer_declared_and_never_the_callers_choice()
    {
        var (client, _) = await SignedInAsync("30000002");
        await AddToPoolAsync("871687100000000163");

        var response = await client.PostAsJsonAsync(
            "/api/v1/metering-points",
            new ClaimConnectionRequest("871687100000000163", "NEVER", null, null));

        var detail = await response.Content.ReadFromJsonAsync<ConnectionDetailDto>();
        detail!.ExpectationSource.Should().Be("CUSTOMER_DECLARED");
    }

    [Fact]
    public async Task The_claimed_entry_leaves_the_pool()
    {
        var (client, _) = await SignedInAsync("30000003");
        await AddToPoolAsync("871687100000000288");

        await client.PostAsJsonAsync(
            "/api/v1/metering-points",
            new ClaimConnectionRequest("871687100000000288", "UNKNOWN", null, null));

        var pool = await client.GetFromJsonAsync<EanPoolResponse>(
            "/api/v1/ean-pool?q=871687100000000288");
        pool!.Items.Should().BeEmpty();
    }

    [Fact]
    public async Task A_second_claim_on_the_same_ean_is_409_and_creates_nothing()
    {
        var (first, _) = await SignedInAsync("30000004");
        var (second, _) = await SignedInAsync("30000005");
        await AddToPoolAsync("871687100000000296");

        var request = new ClaimConnectionRequest("871687100000000296", "UNKNOWN", null, null);
        (await first.PostAsJsonAsync("/api/v1/metering-points", request)).StatusCode
            .Should().Be(HttpStatusCode.Created);

        var response = await second.PostAsJsonAsync("/api/v1/metering-points", request);

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        response.Content.Headers.ContentType!.MediaType.Should().Be("application/problem+json");

        await using var db = factory.CreateOwnerDbContext();
        (await db.MeteringPoints.CountAsync(p => p.Ean == EanCode.Create("871687100000000296").Value))
            .Should().Be(1);
    }

    [Fact]
    public async Task An_ean_that_is_not_in_the_pool_is_404()
    {
        var (client, _) = await SignedInAsync("30000006");

        var response = await client.PostAsJsonAsync(
            "/api/v1/metering-points",
            new ClaimConnectionRequest("871687199999999999", "UNKNOWN", null, null));

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_malformed_ean_is_400_naming_the_field()
    {
        var (client, _) = await SignedInAsync("30000007");

        var response = await client.PostAsJsonAsync(
            "/api/v1/metering-points", new ClaimConnectionRequest("12345", "UNKNOWN", null, null));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("ean");
    }

    [Fact]
    public async Task An_unrecognised_production_expectation_is_400_naming_the_field()
    {
        var (client, _) = await SignedInAsync("30000008");
        await AddToPoolAsync("871687100000000270");

        var response = await client.PostAsJsonAsync(
            "/api/v1/metering-points",
            new ClaimConnectionRequest("871687100000000270", "MAYBE", null, null));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("productionExpectation");

        // Nothing was taken out of the pool on the way to rejecting the request.
        var pool = await client.GetFromJsonAsync<EanPoolResponse>(
            "/api/v1/ean-pool?q=871687100000000270");
        pool!.Items.Should().ContainSingle();
    }

    [Fact]
    public async Task A_name_longer_than_eighty_characters_is_rejected_before_anything_is_claimed()
    {
        var (client, _) = await SignedInAsync("30000009");
        await AddToPoolAsync("871687100000000239");

        var response = await client.PostAsJsonAsync(
            "/api/v1/metering-points",
            new ClaimConnectionRequest("871687100000000239", "UNKNOWN", new string('x', 81), null));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        var pool = await client.GetFromJsonAsync<EanPoolResponse>(
            "/api/v1/ean-pool?q=871687100000000239");
        pool!.Items.Should().ContainSingle();
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ClaimConnectionTests"`
Expected: FAIL — `405 Method Not Allowed`; `/api/v1/metering-points` has no POST

- [ ] **Step 3: Write the endpoint**

Add to `MapConnectionEndpoints` in `ConnectionEndpoints.cs`, before `return routes;`:

```csharp
        group.MapPost("/", async (
                ClaimConnectionRequest request,
                ICustomerContext tenancy,
                PeakPowerDbContext db,
                IMarketCalendar calendar,
                CancellationToken cancellationToken) =>
            {
                // Validate everything the caller sent BEFORE touching the pool, so a rejected
                // request never leaves an entry half-claimed.
                var ean = EanCode.Create(request.Ean ?? string.Empty);
                if (!ean.IsSuccess) return ApiResults.InvalidRequest("ean", ean.Error);

                var expectation = PortalMappings.ParseProductionExpectation(request.ProductionExpectation);
                if (expectation is null)
                {
                    return ApiResults.InvalidRequest(
                        "productionExpectation",
                        "Choose UNKNOWN, NEVER or EXPECTED — whether this connection ever feeds "
                        + "power back into the grid.");
                }

                var name = Blank(request.Name);
                var description = Blank(request.Description);

                if (name is { Length: > MaxNameLength })
                {
                    return ApiResults.InvalidRequest(
                        "name", $"A name is at most {MaxNameLength} characters.");
                }

                if (description is { Length: > MaxDescriptionLength })
                {
                    return ApiResults.InvalidRequest(
                        "description",
                        $"A description is at most {MaxDescriptionLength} characters.");
                }

                var brp = await db.Brps
                    .AsNoTracking()
                    .OrderBy(b => b.Code)
                    .FirstOrDefaultAsync(cancellationToken);
                if (brp is null)
                {
                    // [F01-R51]: a metering point without a balance responsible party is not a
                    // thing the market can settle. Migration 1 seeds PVNed, so this is a
                    // misconfiguration rather than a user error.
                    return ApiResults.Conflict(
                        "No balance responsible party is configured. Contact PeakPower.");
                }

                // One transaction: claim, attach, save. A crash between the two writes would
                // otherwise leave an EAN nobody can claim and nobody owns.
                await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

                var entry = await db.EanPool
                    .SingleOrDefaultAsync(e => e.Ean == ean.Value, cancellationToken);
                if (entry is null) return ApiResults.NotFound();

                var claimed = entry.Claim(tenancy.CustomerId, calendar.UtcNow);
                if (!claimed.IsSuccess) return ApiResults.Conflict(claimed.Error);

                var point = MeteringPoint.Attach(
                    tenancy.CustomerId,
                    ean.Value,
                    brp.Id,
                    expectation.Value,
                    // Not the caller's to choose: a client that could send CONTRACT could
                    // launder its own guess into something that reads as contractual.
                    ProductionExpectationSource.CustomerDeclared,
                    name,
                    description,
                    entry.GridOperator,
                    entry.CapacityKw,
                    entry.Address,
                    calendar.TodayInAmsterdam);

                db.MeteringPoints.Add(point);
                await db.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);

                var detail = PortalMappings.ToDetail(point, brp.Name, calendar.TodayInAmsterdam);
                return Results.Created($"/api/v1/metering-points/{point.Id}", detail);
            })
            .TenantScoped("metering-point")
            .WithName("ClaimConnection")
            .WithSummary("Claim an unclaimed connection and declare whether it produces.");
```

with these usings added to the top of `ConnectionEndpoints.cs`:

```csharp
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ClaimConnectionTests"`
Expected: PASS — 8 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs \
        tests/PeakPower.Integration.Tests/Portal/ClaimConnectionTests.cs
git commit -m "feat(customer-api): claim a connection from the pool as CUSTOMER_DECLARED"
```

---

### Task 8: The Development-only sign-code peek the E2E run needs

The onboarding wizard emails a six-digit signing code through `IEmailSender`, whose slice-1
adapter is a **console sink** — it writes the message to the customer API's log and nothing
else. A browser-driven end-to-end test cannot read a log line, so without a second way in, the
Playwright path in Task 23 stops dead at step 9 and design DoD 2 goes unproven.

Plan 5 already set the precedent with
`POST /onboarding/applications/{id}/bank-verification/simulate`, which exists only in
Development for exactly this reason. This adds the second one, on the same terms: **404 in
every environment except Development**, and covered by a test that proves it.

It is deliberately a *peek* and not a *bypass*: the code is still generated, still emailed,
still verified, and still burns after five wrong attempts. The test reads the real code and
types it, so the signing path under test is the production one.

**Files:**
- Modify: `src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingEndpoints.cs`
- Modify: `tests/PeakPower.Integration.Tests/Auth/AnonymousEndpointAllowListTests.cs`
- Test: `tests/PeakPower.Integration.Tests/Onboarding/SignCodePeekTests.cs`

**Interfaces:**
- Consumes: `OnboardingApplication.Id`, `.Status`, `.SignCode` (see the note in Step 3);
  `IHostEnvironment.IsDevelopment()`; `PeakPowerDbContext.OnboardingApplications`.
- Produces: `GET /api/v1/onboarding/applications/{id:guid}/sign-code` → 200
  `{ "code": "748213" }` in Development, 404 everywhere else.

> ⚠ **One assumption to check before writing the handler.** Plan 5 stores the signing code
> **hashed** (`OnboardingApplication.SignCodeHash`), which cannot be read back. Open
> `src/Core/PeakPower.Domain/Onboarding/OnboardingApplication.cs` and look:
> - If there is a plaintext `SignCode` property, read it.
> - If there is only `SignCodeHash`, add a `DevelopmentSignCode` property that
>   `IssueAndSendSignCodeAsync` sets alongside the hash **only when the environment is
>   Development**, defaulting to null. Persist it as a nullable `text` column in a fourth
>   migration, `M4_DevelopmentSignCode`. A plaintext code that only ever exists on a developer's
>   machine is a smaller cost than an untestable signing path — but it must be null in every
>   other environment, and Step 2's test is what proves it.
>
> The rest of this task is written against a `string? DevelopmentSignCode` property. If plan 5
> already exposes the plaintext under another name, substitute it and change nothing else.

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Onboarding/SignCodePeekTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using PeakPower.Contracts.Customer.Onboarding;
using Xunit;

namespace PeakPower.Integration.Tests.Onboarding;

public sealed class SignCodePeekTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private sealed record SignCodePeek(string Code);

    /// <summary>Runs the wizard as far as step 8, which is where the code is issued.</summary>
    private async Task<Guid> ApplicationAwaitingSignatureAsync(HttpClient client)
    {
        var email = $"{Guid.NewGuid():N}@vandersteen.nl";

        var started = await client.PostAsJsonAsync(
            "/api/v1/onboarding/applications",
            new StartOnboardingRequest("Peter", "de Vries", email, "correct-horse-battery", true));
        started.StatusCode.Should().Be(HttpStatusCode.Created);
        var application = await started.Content.ReadFromJsonAsync<OnboardingApplicationResponse>();

        await client.PatchAsJsonAsync(
            $"/api/v1/onboarding/applications/{application!.Id}",
            new SaveOnboardingStepRequest(2, "Vandersteen Koeling B.V.", "BV", "24398112",
                null, null, null, null, null, null, null));
        await client.PatchAsJsonAsync(
            $"/api/v1/onboarding/applications/{application.Id}",
            new SaveOnboardingStepRequest(5, null, null, null, null, null,
                "Both", "From1000To2500Mwh", null, null, null));
        await client.PatchAsJsonAsync(
            $"/api/v1/onboarding/applications/{application.Id}",
            new SaveOnboardingStepRequest(7, null, null, null, null, null, null, null,
                null, null, "Alone"));

        var signatories = await client.PostAsJsonAsync(
            $"/api/v1/onboarding/applications/{application.Id}/signatories",
            new SubmitSignatoriesRequest([new SignatoryDto("Peter", "de Vries", email)]));
        signatories.StatusCode.Should().Be(HttpStatusCode.Accepted);

        return application.Id;
    }

    [Fact]
    public async Task In_development_the_peek_returns_a_six_digit_code()
    {
        var client = factory.CreateAnonymousClient();
        var id = await ApplicationAwaitingSignatureAsync(client);

        var response = await client.GetAsync($"/api/v1/onboarding/applications/{id}/sign-code");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var peek = await response.Content.ReadFromJsonAsync<SignCodePeek>();
        peek!.Code.Should().MatchRegex("^[0-9]{6}$");
    }

    [Fact]
    public async Task The_peeked_code_is_the_one_that_actually_signs()
    {
        var client = factory.CreateAnonymousClient();
        var id = await ApplicationAwaitingSignatureAsync(client);

        var peek = await client.GetFromJsonAsync<SignCodePeek>(
            $"/api/v1/onboarding/applications/{id}/sign-code");

        var signed = await client.PostAsJsonAsync(
            $"/api/v1/onboarding/applications/{id}/sign",
            new SignOnboardingRequest(peek!.Code, true));

        signed.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Peeking_before_the_code_is_issued_is_404()
    {
        var client = factory.CreateAnonymousClient();
        var started = await client.PostAsJsonAsync(
            "/api/v1/onboarding/applications",
            new StartOnboardingRequest("Early", "Bird", $"{Guid.NewGuid():N}@example.nl",
                "correct-horse-battery", true));
        var application = await started.Content.ReadFromJsonAsync<OnboardingApplicationResponse>();

        var response = await client.GetAsync(
            $"/api/v1/onboarding/applications/{application!.Id}/sign-code");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task An_unknown_application_is_404()
    {
        var client = factory.CreateAnonymousClient();

        (await client.GetAsync($"/api/v1/onboarding/applications/{Guid.NewGuid()}/sign-code"))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Outside_development_the_route_does_not_exist()
    {
        // The factory boots Development; this one boots Production, so the environment gate is
        // exercised rather than assumed.
        await using var production = new ProductionCustomerApiFactory(factory.ConnectionString);
        var client = production.CreateAnonymousClient();

        var response = await client.GetAsync(
            $"/api/v1/onboarding/applications/{Guid.NewGuid()}/sign-code");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
```

Create the production-environment factory beside it, in the same file's namespace —
`tests/PeakPower.Integration.Tests/Onboarding/ProductionCustomerApiFactory.cs`:

```csharp
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Hosting;

namespace PeakPower.Integration.Tests.Onboarding;

/// <summary>
/// The customer API booted as Production against an already-migrated database. It exists to
/// prove that the two development-only onboarding routes really are gated on the environment
/// rather than on a comment saying they are.
/// </summary>
public sealed class ProductionCustomerApiFactory(string connectionString)
    : WebApplicationFactory<Program>
{
    private readonly string _signingKeyPath =
        Path.Combine(Path.GetTempPath(), "pp-tests", Guid.NewGuid().ToString("N"), "key.pkcs8");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(Environments.Production);
        builder.UseSetting("ConnectionStrings:peakpower", connectionString);
        builder.UseSetting("Auth:SigningKeyPath", _signingKeyPath);
    }

    public HttpClient CreateAnonymousClient() =>
        CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~SignCodePeekTests"`
Expected: FAIL — the first two cases get `404 Not Found` for the peek route

- [ ] **Step 3: Write the endpoint**

Add to `MapOnboardingEndpoints` in
`src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingEndpoints.cs`, beside the existing
`bank-verification/simulate` mapping:

```csharp
        group.MapGet("/{id:guid}/sign-code", async (
                Guid id,
                PeakPowerDbContext db,
                IHostEnvironment environment,
                CancellationToken ct) =>
            {
                // Development only, on the same terms as the bank simulator above. The signing
                // code is emailed through IEmailSender, whose slice-1 adapter writes to the log
                // — which a browser-driven test cannot read. This is a peek, not a bypass: the
                // code is still generated, still emailed, still verified, and still burns after
                // five wrong attempts, so the path under test is the production one.
                if (!environment.IsDevelopment()) return Results.NotFound();

                var application = await db.OnboardingApplications
                    .AsNoTracking()
                    .SingleOrDefaultAsync(a => a.Id == id, ct);

                if (application?.DevelopmentSignCode is not { } code) return Results.NotFound();

                return Results.Ok(new { code });
            })
            .AllowAnonymous()
            .WithName("PeekSignCode")
            .WithSummary("Development only: read the signing code the console sink emailed.");
```

- [ ] **Step 4: Update the anonymous allow-list**

Plan 5's `AnonymousEndpointAllowListTests` asserts the anonymous route set **exactly** — that
is the point of it, so a new anonymous endpoint has to be declared rather than discovered. Add
one line to the `Expected` set in
`tests/PeakPower.Integration.Tests/Auth/AnonymousEndpointAllowListTests.cs`:

```csharp
        "GET /api/v1/onboarding/applications/{id:guid}/sign-code",
```

- [ ] **Step 5: Run the tests and watch them pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests \
  --filter "FullyQualifiedName~SignCodePeekTests|FullyQualifiedName~AnonymousEndpointAllowListTests"
```

Expected: PASS — 6 passed, 0 failed

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingEndpoints.cs \
        src/Core/PeakPower.Domain/Onboarding/OnboardingApplication.cs \
        src/Infrastructure/PeakPower.Persistence \
        tests/PeakPower.Integration.Tests
git commit -m "feat(onboarding): add a Development-only sign-code peek for the E2E path"
```

---

### Task 9: `customer.json` emitted at build, and frozen behind a snapshot

Two separate things, both needed, and both mirror what plan 2 did for the employee API:

- **Emission at build.** `Microsoft.Extensions.ApiDescription.Server` runs the host's document
  generation as an MSBuild step and writes `artifacts/openapi/customer.json`. That file is
  committed, and Task 10 generates `@peakpower/api-client-customer` from it.
- **A Verify snapshot.** The emitted document is compared against a reviewed copy. Any change
  to a route, a status code or a DTO shape turns the test red, and the only way to make it green
  is to look at the diff and accept it. An API contract change should cost a deliberate act,
  because a second repository is generated from it.

**Files:**
- Modify: `src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj`
- Create: `artifacts/openapi/customer.json` *(generated, committed)*
- Create: `tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.cs`
- Create: `tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json` *(generated, committed)*

**Interfaces:**
- Consumes: `RepositoryRoot.Find()` from plan 2's
  `tests/PeakPower.Integration.Tests/Contract/RepositoryRoot.cs`; `Verify.Xunit` 30.15.0,
  already referenced by plan 2.
- Produces: `artifacts/openapi/customer.json`, consumed by Task 10's `npm run generate:clients`.

- [ ] **Step 1: Turn on build-time document generation**

Add to the first `<PropertyGroup>` in
`src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj`:

```xml
    <!-- Emit the OpenAPI document at build. Task 10 generates the typed npm client from it,
         and the snapshot test below fails the build on an unreviewed contract change. -->
    <OpenApiGenerateDocuments>true</OpenApiGenerateDocuments>
    <OpenApiDocumentsDirectory>$(MSBuildProjectDirectory)/../../../artifacts/openapi</OpenApiDocumentsDirectory>
    <OpenApiGenerateDocumentsOptions>--file-name customer</OpenApiGenerateDocumentsOptions>
```

and a new `<ItemGroup>`:

```xml
  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.ApiDescription.Server">
      <PrivateAssets>all</PrivateAssets>
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
    </PackageReference>
  </ItemGroup>
```

Plan 2 already fixed `.gitignore` to keep `artifacts/openapi/*.json`; no change is needed there.

- [ ] **Step 2: Build and confirm the document is emitted**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build src/Hosts/PeakPower.Api.Customer
ls -l artifacts/openapi/customer.json
python3 -c "import json; d=json.load(open('artifacts/openapi/customer.json')); print('\n'.join(sorted(d['paths'])))"
```

Expected: `customer.json` exists, and the path list is exactly:

```
/.well-known/jwks.json
/api/v1/auth/me
/api/v1/auth/password-reset/completions
/api/v1/auth/password-reset/requests
/api/v1/auth/refresh
/api/v1/auth/sign-in
/api/v1/auth/sign-out
/api/v1/company
/api/v1/company/accounts
/api/v1/ean-pool
/api/v1/metering-points
/api/v1/metering-points/{id}
/api/v1/metering-points/{id}/naming
/api/v1/onboarding/applications
/api/v1/onboarding/applications/{id}
/api/v1/onboarding/applications/{id}/bank-verification/simulate
/api/v1/onboarding/applications/{id}/sign
/api/v1/onboarding/applications/{id}/sign-code
/api/v1/onboarding/applications/{id}/signatories
```

Nineteen paths. If a path is missing, the corresponding `app.Map…Endpoints()` call is absent
from `Program.cs`.

- [ ] **Step 3: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.cs`:

```csharp
using System.Text.Json;
using FluentAssertions;
using VerifyXunit;
using Xunit;

namespace PeakPower.Integration.Tests.Contract;

/// <summary>
/// The customer API's contract, frozen. `peakpower-web` generates a typed client from this
/// document, so an unreviewed change here silently breaks a second repository. Turning that
/// into a red build is the cheapest place to catch it.
/// </summary>
public sealed class CustomerOpenApiSnapshotTests
{
    private static string DocumentPath =>
        Path.Combine(RepositoryRoot.Find(), "artifacts", "openapi", "customer.json");

    [Fact]
    public void the_document_is_emitted_at_build()
    {
        File.Exists(DocumentPath).Should().BeTrue(
            $"building PeakPower.Api.Customer must write {DocumentPath}; check that "
            + "OpenApiGenerateDocuments is true in the project file");
    }

    [Fact]
    public async Task the_document_never_carries_a_credential()
    {
        var json = await File.ReadAllTextAsync(DocumentPath);

        // Requests carry `password` and `newPassword`; no RESPONSE may. The cheap proxy for
        // that is that these three names appear nowhere at all.
        json.Should().NotContainEquivalentOf("passwordHash");
        json.Should().NotContainEquivalentOf("securityStamp");
        json.Should().NotContainEquivalentOf("argon2");
    }

    [Fact]
    public async Task the_customer_openapi_document_matches_the_reviewed_snapshot()
    {
        var json = await File.ReadAllTextAsync(DocumentPath);

        // Re-serialise with indented output so a whitespace change in the generator does not
        // read as a contract change.
        using var document = JsonDocument.Parse(json);
        var normalised = JsonSerializer.Serialize(
            document.RootElement,
            new JsonSerializerOptions { WriteIndented = true });

        await Verify(normalised).UseExtension("json");
    }
}
```

- [ ] **Step 4: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~CustomerOpenApiSnapshotTests"`
Expected: FAIL — `VerifyException: Directory: …/Contract` naming
`CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.received.json`,
because no verified snapshot exists yet

- [ ] **Step 5: Review the received document and accept it**

Read the received file and check five things:

1. Nineteen paths, matching Step 2's list.
2. No path outside `/api/v1` except `/.well-known/jwks.json`.
3. `ConnectionSummaryDto` and `ConnectionDetailDto` both carry `lastDataDate` as a nullable
   date — the field exists and is always null, which is the contract (convention C4).
4. `ClaimConnectionRequest` has no `expectationSource` property. If it does, the endpoint is
   letting the caller choose its own provenance and Task 7 was written wrong.
5. Both `AddressDto` and `OnboardingAddressDto` are present. That is convention C1 and is
   expected, not a bug.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -c 'expectationSource' \
  tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.received.json
```

Expected: a small number, all inside `ConnectionDetailDto` — never inside
`ClaimConnectionRequest`.

Then accept it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract
mv CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.received.json \
   CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~CustomerOpenApiSnapshotTests"`
Expected: PASS — 3 passed, 0 failed

- [ ] **Step 7: Prove the snapshot bites**

Temporarily change `.WithSummary("Grid connections nobody has claimed yet.")` in
`EanPoolEndpoints.cs` to `.WithSummary("changed")`, then:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build src/Hosts/PeakPower.Api.Customer
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~the_customer_openapi_document_matches"
```

Expected: FAIL with a diff showing the changed summary. Revert the change, rebuild, delete any
`.received.json`, and re-run to confirm PASS.

- [ ] **Step 8: Run the whole platform suite**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test`
Expected: PASS — Domain, Application, Integration, Architecture and AppHost all green

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj \
        artifacts/openapi/customer.json \
        tests/PeakPower.Integration.Tests/Contract
git commit -m "feat(customer-api): emit customer.json at build and freeze it behind a snapshot"
```

---

### Task 10: `@peakpower/api-client-customer`

Everything from here on is in `/Users/thinhhuynh/PeakPower/peakpower-web`.

Slice 1 has no npm registry `[DEC-116]`. The TypeScript derived from `customer.json` is
**committed** into this repository as a workspace package, and `npm run verify:clients` — which
plan 4 already built — is what replaces the registry's drift protection. Two things a reader
new to this repository needs to know: **npm workspaces resolve a dependency by the `name` field
in its `package.json`, not by registry scope**, so `import { … } from
'@peakpower/api-client-customer'` works today with no registry and keeps working unchanged the
day the package is published; and the generator emits **types only** — the transport is
hand-written on Angular's `HttpClient`, which is what lets requests go through Angular DI,
interceptors and `HttpTestingController`.

`src/generated/` is machine-owned. `src/lib/` is hand-owned. `verify:clients` only ever looks
at `src/generated/`.

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.base.json`
- Modify: `angular.json`
- Modify: `tools/openapi-clients.mjs`
- Modify: `tools/openapi-clients.test.mjs`
- Create: `libs/api-client-customer/package.json`
- Create: `libs/api-client-customer/src/generated/customer-schema.d.ts` *(generated)*
- Create: `libs/api-client-customer/src/lib/customer-api.tokens.ts`
- Create: `libs/api-client-customer/src/lib/customer-api.types.ts`
- Create: `libs/api-client-customer/src/lib/customer-api.client.ts`
- Create: `libs/api-client-customer/src/lib/customer-api.testing.ts`
- Create: `libs/api-client-customer/src/index.ts`
- Create: `apps/customer-portal/src/index.html`
- Create: `apps/customer-portal/src/main.ts` *(stub, replaced in Task 12)*
- Create: `apps/customer-portal/src/styles.css`
- Create: `apps/customer-portal/proxy.conf.mjs`
- Create: `apps/customer-portal/tsconfig.app.json`
- Create: `apps/customer-portal/tsconfig.spec.json`
- Test: `libs/api-client-customer/src/lib/customer-api.client.spec.ts`

**Interfaces:**
- Consumes: plan 4's `tools/openapi-clients.mjs` (`WEB_ROOT`, `BANNER`, `CLIENTS`,
  `generateTypes`, `writeClient`, `resolvePlatformRoot`);
  `/Users/thinhhuynh/PeakPower/peakpower-platform/artifacts/openapi/customer.json` from Task 9;
  plan 4's `problem-details.ts` shape, which this package re-declares rather than importing —
  a client library that depended on another client library would make the two OpenAPI documents
  co-dependent for no gain.
- Produces:
  - `export const CUSTOMER_API_BASE_URL: InjectionToken<string>`
  - types `Address, ContactPerson, CompanyProfile, CompanyAccount, CompanyAccountsResponse,
    ConnectionSummary, ConnectionListResponse, ConnectionDetail, RenameConnectionRequest,
    EanPoolEntry, EanPoolResponse, ClaimConnectionRequest, SignInRequest, SignInResponse,
    CurrentAccount, PasswordResetRequest, PasswordResetCompletion, StartOnboardingRequest,
    OnboardingAddress, SaveOnboardingStepRequest, Signatory, SubmitSignatoriesRequest,
    SignOnboardingRequest, OnboardingApplicationResponse, SignedOnboardingResponse,
    ConnectionStatusValue, ProductionExpectationValue, AccountStatusValue, CustomerStatusValue`
  - `export interface ValidationProblemDetails` and
    `export function isValidationProblem(value: unknown): value is ValidationProblemDetails`
  - `export class CustomerApiClient` — full method list in Step 5
  - `export function provideCustomerApiTesting(baseUrl?: string): EnvironmentProviders`

- [ ] **Step 1: Register the client and extend the registry test**

Add a second entry to `CLIENTS` in `tools/openapi-clients.mjs`, keeping the employee one:

```js
export const CLIENTS = Object.freeze([
  Object.freeze({
    name: '@peakpower/api-client-employee',
    document: resolve(PLATFORM_ROOT, 'artifacts/openapi/employee.json'),
    output: resolve(WEB_ROOT, 'libs/api-client-employee/src/generated/employee-schema.d.ts'),
  }),
  Object.freeze({
    name: '@peakpower/api-client-customer',
    document: resolve(PLATFORM_ROOT, 'artifacts/openapi/customer.json'),
    output: resolve(WEB_ROOT, 'libs/api-client-customer/src/generated/customer-schema.d.ts'),
  }),
]);
```

Add to `tools/openapi-clients.test.mjs`, inside the existing `describe('CLIENTS', …)`:

```js
  it('registers the customer client with its committed output path', () => {
    const customer = CLIENTS.find((c) => c.name === '@peakpower/api-client-customer');
    assert.ok(customer, 'customer client must be registered');
    assert.equal(customer.output,
      resolve(WEB_ROOT, 'libs/api-client-customer/src/generated/customer-schema.d.ts'));
    assert.match(customer.document, /artifacts\/openapi\/customer\.json$/);
  });

  it('registers exactly two clients', () => {
    assert.equal(CLIENTS.length, 2);
  });
```

- [ ] **Step 2: Run the tool test and watch it fail, then pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:tools`

Run it **before** editing `openapi-clients.mjs` to see
`AssertionError [ERR_ASSERTION]: customer client must be registered`, then after, to see PASS —
9 tests.

- [ ] **Step 3: Add the workspace package and generate its types**

Create `libs/api-client-customer/package.json`:

```json
{
  "name": "@peakpower/api-client-customer",
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

**Merge** into `tsconfig.base.json`'s `paths`, keeping the two existing entries:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@peakpower/shared-ui": ["libs/shared-ui/src/index.ts"],
      "@peakpower/api-client-employee": ["libs/api-client-employee/src/index.ts"],
      "@peakpower/api-client-customer": ["libs/api-client-customer/src/index.ts"]
    }
  }
}
```

**Merge** into `package.json`'s `scripts`, keeping everything already there:

```json
{
  "scripts": {
    "start:customer-portal": "ng serve customer-portal",
    "build:customer-portal": "ng build customer-portal",
    "test:customer-portal": "ng test customer-portal",
    "e2e": "playwright test"
  }
}
```

and into `devDependencies`:

```json
{
  "devDependencies": {
    "@playwright/test": "1.56.1"
  }
}
```

Then install and generate:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npm install
npm run generate:clients
```

Expected: two `wrote …` lines, one per client.

Check three things in the generated file, because Step 5 depends on them:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
grep -c 'ConnectionDetailDto\|ConnectionSummaryDto\|EanPoolEntryDto\|CompanyProfileResponse' \
  libs/api-client-customer/src/generated/customer-schema.d.ts
grep -o '"CUSTOMER_DECLARED"\|"CustomerDeclared"' \
  libs/api-client-customer/src/generated/customer-schema.d.ts | sort -u
grep -c 'export const\|export function\|export class' \
  libs/api-client-customer/src/generated/customer-schema.d.ts
```

1. Every schema name in **Produces** above is present. If one is spelled differently, note the
   real spelling — Step 5 aliases it and nothing else in the plan touches generated names.
2. The enum unions use the database spelling (`"CUSTOMER_DECLARED"`). If they use the C#
   spelling, Task 12's label maps key on that instead.
3. The last count is `0` — the file is types only, with no runtime code.

- [ ] **Step 4: Add the `customer-portal` project and its shell files**

Merge this project into `angular.json`'s `projects`, keeping everything already there:

```json
{
  "customer-portal": {
    "projectType": "application",
    "root": "apps/customer-portal",
    "sourceRoot": "apps/customer-portal/src",
    "prefix": "pp",
    "architect": {
      "build": {
        "builder": "@angular/build:application",
        "options": {
          "browser": "apps/customer-portal/src/main.ts",
          "index": "apps/customer-portal/src/index.html",
          "tsConfig": "apps/customer-portal/tsconfig.app.json",
          "outputPath": "dist/customer-portal",
          "styles": ["apps/customer-portal/src/styles.css"]
        },
        "configurations": {
          "development": { "optimization": false, "sourceMap": true, "namedChunks": true },
          "production": { "optimization": true, "outputHashing": "all" }
        },
        "defaultConfiguration": "development"
      },
      "serve": {
        "builder": "@angular/build:dev-server",
        "options": {
          "buildTarget": "customer-portal:build:development",
          "port": 4200,
          "proxyConfig": "apps/customer-portal/proxy.conf.mjs"
        }
      },
      "test": {
        "builder": "@angular/build:unit-test",
        "options": {
          "buildTarget": "customer-portal:build:development",
          "runner": "vitest",
          "include": [
            "apps/customer-portal/src/**/*.spec.ts",
            "libs/api-client-customer/src/**/*.spec.ts"
          ]
        }
      }
    }
  }
}
```

Create `apps/customer-portal/tsconfig.app.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../../out-tsc/customer-portal",
    "types": []
  },
  "files": ["src/main.ts"],
  "include": ["src/**/*.d.ts"]
}
```

Create `apps/customer-portal/tsconfig.spec.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../../out-tsc/customer-portal-spec",
    "types": ["vitest/globals", "node"]
  },
  "include": [
    "src/**/*.spec.ts",
    "src/**/*.d.ts",
    "../../libs/api-client-customer/src/**/*.spec.ts"
  ]
}
```

Create `apps/customer-portal/src/index.html`:

```html
<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8" />
    <title>PeakPower</title>
    <meta name="viewport" content="width=1280" />
  </head>
  <body>
    <pp-root></pp-root>
  </body>
</html>
```

The viewport is a fixed 1280. The portal is desktop only — design §8.4 records that as explicit
scope, not an omission (convention C5).

Create `apps/customer-portal/src/styles.css`:

```css
/* Plan 3 owns every token in here. This file only wires them to the page canvas. */
@import '../../../libs/shared-ui/src/styles/tokens.css';

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

Create `apps/customer-portal/proxy.conf.mjs`:

```js
// The dev server forwards /api and /.well-known to the customer API that Aspire started.
// Aspire assigns the port, and injects it as services__customer-api__https__0 through
// WithReference; the localhost fallback is for running `ng serve` on its own.
const target =
  process.env['services__customer-api__https__0'] ??
  process.env['services__customer-api__http__0'] ??
  'http://localhost:5100';

export default {
  '/api': { target, secure: false, changeOrigin: true },
  '/.well-known': { target, secure: false, changeOrigin: true },
};
```

Create the stub `apps/customer-portal/src/main.ts`, replaced in Task 12:

```ts
// Replaced by the real bootstrap in Task 12. It exists now so that angular.json's build target
// resolves, which the unit-test builder needs as its buildTarget.
export {};
```

- [ ] **Step 5: Write the failing client test**

Create `libs/api-client-customer/src/lib/customer-api.client.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CustomerApiClient } from './customer-api.client';
import { provideCustomerApiTesting } from './customer-api.testing';
import { isValidationProblem } from './customer-api.types';
import type { ConnectionListResponse } from './customer-api.types';

describe('CustomerApiClient', () => {
  let api: CustomerApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideCustomerApiTesting()] });
    api = TestBed.inject(CustomerApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('builds every URL under the injected base path', () => {
    expect(api.companyUrl()).toBe('/api/v1/company');
    expect(api.companyAccountsUrl()).toBe('/api/v1/company/accounts');
    expect(api.connectionsUrl()).toBe('/api/v1/metering-points');
    expect(api.connectionUrl('m1')).toBe('/api/v1/metering-points/m1');
    expect(api.connectionNamingUrl('m1')).toBe('/api/v1/metering-points/m1/naming');
    expect(api.eanPoolUrl()).toBe('/api/v1/ean-pool');
    expect(api.signInUrl()).toBe('/api/v1/auth/sign-in');
    expect(api.refreshUrl()).toBe('/api/v1/auth/refresh');
    expect(api.signOutUrl()).toBe('/api/v1/auth/sign-out');
    expect(api.meUrl()).toBe('/api/v1/auth/me');
    expect(api.onboardingUrl()).toBe('/api/v1/onboarding/applications');
    expect(api.onboardingApplicationUrl('a1')).toBe('/api/v1/onboarding/applications/a1');
  });

  it('sends the search term as the q parameter', () => {
    const payload: ConnectionListResponse = { items: [], total: 0 };
    let received: ConnectionListResponse | undefined;
    api.listConnections('venlo').subscribe((r) => (received = r));

    const req = http.expectOne((r) => r.url === '/api/v1/metering-points');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('venlo');
    req.flush(payload);

    expect(received).toEqual(payload);
  });

  it('omits the q parameter when the search term is blank', () => {
    api.listConnections('   ').subscribe();
    const req = http.expectOne((r) => r.url === '/api/v1/metering-points');
    expect(req.request.params.has('q')).toBe(false);
    req.flush({ items: [], total: 0 });
  });

  it('PATCHes the naming route with both fields, nulls included', () => {
    api.renameConnection('m1', { name: null, description: null }).subscribe();

    const req = http.expectOne('/api/v1/metering-points/m1/naming');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: null, description: null });
    req.flush({});
  });

  it('POSTs a claim to the connections collection', () => {
    api
      .claimConnection({
        ean: '871687100000000155',
        productionExpectation: 'EXPECTED',
        name: 'Waalhaven yard',
        description: null,
      })
      .subscribe();

    const req = http.expectOne('/api/v1/metering-points');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.ean).toBe('871687100000000155');
    req.flush({});
  });

  it('sends credentials on sign-in, refresh and sign-out so the pp_refresh cookie travels', () => {
    api.signIn({ username: 'a@b.nl', password: 'correct-horse-battery' }).subscribe();
    expect(http.expectOne('/api/v1/auth/sign-in').request.withCredentials).toBe(true);
    http.verify();

    api.refresh().subscribe({ error: () => undefined });
    expect(http.expectOne('/api/v1/auth/refresh').request.withCredentials).toBe(true);
    http.verify();

    api.signOut().subscribe({ error: () => undefined });
    expect(http.expectOne('/api/v1/auth/sign-out').request.withCredentials).toBe(true);
  });

  it('walks the onboarding routes', () => {
    api.startOnboarding({
      firstName: 'Peter', lastName: 'de Vries', email: 'p@v.nl',
      password: 'correct-horse-battery', termsAccepted: true,
    }).subscribe();
    expect(http.expectOne('/api/v1/onboarding/applications').request.method).toBe('POST');
    http.verify();

    api.saveOnboardingStep('a1', { step: 2 } as never).subscribe();
    expect(http.expectOne('/api/v1/onboarding/applications/a1').request.method).toBe('PATCH');
    http.verify();

    api.submitSignatories('a1', { signatories: [] }).subscribe();
    expect(http.expectOne('/api/v1/onboarding/applications/a1/signatories').request.method)
      .toBe('POST');
    http.verify();

    api.signOnboarding('a1', { code: '748213', agreedDocuments: true }).subscribe();
    expect(http.expectOne('/api/v1/onboarding/applications/a1/sign').request.method).toBe('POST');
  });

  it('reads the development sign code', () => {
    let code: string | undefined;
    api.peekSignCode('a1').subscribe((r) => (code = r.code));

    const req = http.expectOne('/api/v1/onboarding/applications/a1/sign-code');
    expect(req.request.method).toBe('GET');
    req.flush({ code: '748213' });

    expect(code).toBe('748213');
  });
});

describe('isValidationProblem', () => {
  it('accepts an RFC 7807 body carrying an errors map', () => {
    expect(
      isValidationProblem({
        title: 'The request is not valid.',
        status: 400,
        errors: { name: ['A name is at most 80 characters.'] },
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

- [ ] **Step 6: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal`
Expected: FAIL — `Failed to resolve import "./customer-api.client"`

- [ ] **Step 7: Write the library**

Create `libs/api-client-customer/src/lib/customer-api.tokens.ts`:

```ts
import { InjectionToken } from '@angular/core';

/**
 * Root of the customer API, without a trailing slash — '/api/v1' in the browser, where the
 * dev-server proxy forwards it to the ASP.NET host Aspire started.
 */
export const CUSTOMER_API_BASE_URL = new InjectionToken<string>('CUSTOMER_API_BASE_URL');
```

Create `libs/api-client-customer/src/lib/customer-api.types.ts`:

```ts
// Readable aliases over the generated schema. This is the ONLY file in the workspace that knows
// how openapi-typescript names things, so a change in the generator costs one file.
import type { components } from '../generated/customer-schema';

type Schemas = components['schemas'];

export type Address = Schemas['AddressDto'];
export type ContactPerson = Schemas['ContactPersonDto'];

export type CompanyProfile = Schemas['CompanyProfileResponse'];
export type CompanyAccount = Schemas['CompanyAccountDto'];
export type CompanyAccountsResponse = Schemas['CompanyAccountsResponse'];

export type ConnectionSummary = Schemas['ConnectionSummaryDto'];
export type ConnectionListResponse = Schemas['ConnectionListResponse'];
export type ConnectionDetail = Schemas['ConnectionDetailDto'];
export type RenameConnectionRequest = Schemas['RenameConnectionRequest'];

export type EanPoolEntry = Schemas['EanPoolEntryDto'];
export type EanPoolResponse = Schemas['EanPoolResponse'];
export type ClaimConnectionRequest = Schemas['ClaimConnectionRequest'];

export type SignInRequest = Schemas['SignInRequest'];
export type SignInResponse = Schemas['SignInResponse'];
export type CurrentAccount = Schemas['CurrentAccountResponse'];
export type PasswordResetRequest = Schemas['PasswordResetRequest'];
export type PasswordResetCompletion = Schemas['PasswordResetCompletion'];

export type StartOnboardingRequest = Schemas['StartOnboardingRequest'];
export type OnboardingAddress = Schemas['OnboardingAddressDto'];
export type SaveOnboardingStepRequest = Schemas['SaveOnboardingStepRequest'];
export type Signatory = Schemas['SignatoryDto'];
export type SubmitSignatoriesRequest = Schemas['SubmitSignatoriesRequest'];
export type SignOnboardingRequest = Schemas['SignOnboardingRequest'];
export type OnboardingApplicationResponse = Schemas['OnboardingApplicationResponse'];
export type SignedOnboardingResponse = Schemas['SignedOnboardingResponse'];

// The enum string unions, pulled off the DTOs so they can never drift from the contract.
export type ConnectionStatusValue = ConnectionSummary['status'];
export type ProductionExpectationValue = ConnectionDetail['productionExpectation'];
export type ProductionExpectationSourceValue = NonNullable<ConnectionDetail['expectationSource']>;
export type AccountStatusValue = CompanyAccount['status'];
export type CustomerStatusValue = CompanyProfile['status'];

/** The development-only sign-code peek. Not in the generated schema; it returns a loose object. */
export interface SignCodePeek {
  readonly code: string;
}

/**
 * RFC 7807 `application/problem+json`. ASP.NET Core adds `errors` for a validation failure: a
 * map from a property path to one or more human-readable messages.
 *
 * Re-declared here rather than imported from `@peakpower/api-client-employee`: a client library
 * that depended on another client library would make the two OpenAPI documents co-dependent for
 * no gain.
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

Create `libs/api-client-customer/src/lib/customer-api.client.ts`:

```ts
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

import { CUSTOMER_API_BASE_URL } from './customer-api.tokens';
import type {
  ClaimConnectionRequest,
  CompanyAccountsResponse,
  CompanyProfile,
  ConnectionDetail,
  ConnectionListResponse,
  CurrentAccount,
  EanPoolResponse,
  OnboardingApplicationResponse,
  PasswordResetCompletion,
  PasswordResetRequest,
  RenameConnectionRequest,
  SaveOnboardingStepRequest,
  SignCodePeek,
  SignInRequest,
  SignInResponse,
  SignOnboardingRequest,
  SignedOnboardingResponse,
  StartOnboardingRequest,
  SubmitSignatoriesRequest,
} from './customer-api.types';

/**
 * Every call here is tenant-scoped by the server: the company comes from the access token's
 * `customer_id` claim and from nowhere else, so there is no company id to pass and no company
 * switcher to build. The three onboarding calls and the two auth entry points are the
 * exceptions — they run before there is a session.
 */
@Injectable({ providedIn: 'root' })
export class CustomerApiClient {
  private readonly http = inject(HttpClient);
  readonly baseUrl = inject(CUSTOMER_API_BASE_URL);

  // ── URLs ────────────────────────────────────────────────────────────────
  companyUrl(): string { return `${this.baseUrl}/company`; }
  companyAccountsUrl(): string { return `${this.baseUrl}/company/accounts`; }
  connectionsUrl(): string { return `${this.baseUrl}/metering-points`; }
  connectionUrl(id: string): string { return `${this.baseUrl}/metering-points/${id}`; }
  connectionNamingUrl(id: string): string { return `${this.connectionUrl(id)}/naming`; }
  eanPoolUrl(): string { return `${this.baseUrl}/ean-pool`; }
  signInUrl(): string { return `${this.baseUrl}/auth/sign-in`; }
  refreshUrl(): string { return `${this.baseUrl}/auth/refresh`; }
  signOutUrl(): string { return `${this.baseUrl}/auth/sign-out`; }
  meUrl(): string { return `${this.baseUrl}/auth/me`; }
  passwordResetRequestsUrl(): string { return `${this.baseUrl}/auth/password-reset/requests`; }
  passwordResetCompletionsUrl(): string { return `${this.baseUrl}/auth/password-reset/completions`; }
  onboardingUrl(): string { return `${this.baseUrl}/onboarding/applications`; }
  onboardingApplicationUrl(id: string): string { return `${this.onboardingUrl()}/${id}`; }

  // ── Auth ────────────────────────────────────────────────────────────────
  // withCredentials so the HttpOnly pp_refresh cookie travels. Same-origin requests would send
  // it anyway; saying so explicitly means the calls keep working the day the API moves to its
  // own host.
  signIn(body: SignInRequest): Observable<SignInResponse> {
    return this.http.post<SignInResponse>(this.signInUrl(), body, { withCredentials: true });
  }

  refresh(): Observable<SignInResponse> {
    return this.http.post<SignInResponse>(this.refreshUrl(), {}, { withCredentials: true });
  }

  signOut(): Observable<void> {
    return this.http.post<void>(this.signOutUrl(), {}, { withCredentials: true });
  }

  me(): Observable<CurrentAccount> {
    return this.http.get<CurrentAccount>(this.meUrl());
  }

  requestPasswordReset(body: PasswordResetRequest): Observable<void> {
    return this.http.post<void>(this.passwordResetRequestsUrl(), body);
  }

  completePasswordReset(body: PasswordResetCompletion): Observable<void> {
    return this.http.post<void>(this.passwordResetCompletionsUrl(), body);
  }

  // ── Company ─────────────────────────────────────────────────────────────
  getCompany(): Observable<CompanyProfile> {
    return this.http.get<CompanyProfile>(this.companyUrl());
  }

  getCompanyAccounts(): Observable<CompanyAccountsResponse> {
    return this.http.get<CompanyAccountsResponse>(this.companyAccountsUrl());
  }

  // ── Connections ─────────────────────────────────────────────────────────
  /** Free-text search across the friendly name, the description and the EAN [F01-R36]. */
  listConnections(q: string): Observable<ConnectionListResponse> {
    const trimmed = q.trim();
    const params = trimmed.length > 0 ? new HttpParams().set('q', trimmed) : new HttpParams();
    return this.http.get<ConnectionListResponse>(this.connectionsUrl(), { params });
  }

  getConnection(id: string): Observable<ConnectionDetail> {
    return this.http.get<ConnectionDetail>(this.connectionUrl(id));
  }

  renameConnection(id: string, body: RenameConnectionRequest): Observable<ConnectionDetail> {
    return this.http.patch<ConnectionDetail>(this.connectionNamingUrl(id), body);
  }

  claimConnection(body: ClaimConnectionRequest): Observable<ConnectionDetail> {
    return this.http.post<ConnectionDetail>(this.connectionsUrl(), body);
  }

  searchEanPool(q: string): Observable<EanPoolResponse> {
    const trimmed = q.trim();
    const params = trimmed.length > 0 ? new HttpParams().set('q', trimmed) : new HttpParams();
    return this.http.get<EanPoolResponse>(this.eanPoolUrl(), { params });
  }

  // ── Onboarding ──────────────────────────────────────────────────────────
  startOnboarding(body: StartOnboardingRequest): Observable<OnboardingApplicationResponse> {
    return this.http.post<OnboardingApplicationResponse>(this.onboardingUrl(), body);
  }

  saveOnboardingStep(
    id: string,
    body: SaveOnboardingStepRequest,
  ): Observable<OnboardingApplicationResponse> {
    return this.http.patch<OnboardingApplicationResponse>(
      this.onboardingApplicationUrl(id), body);
  }

  submitSignatories(
    id: string,
    body: SubmitSignatoriesRequest,
  ): Observable<OnboardingApplicationResponse> {
    return this.http.post<OnboardingApplicationResponse>(
      `${this.onboardingApplicationUrl(id)}/signatories`, body);
  }

  signOnboarding(id: string, body: SignOnboardingRequest): Observable<SignedOnboardingResponse> {
    return this.http.post<SignedOnboardingResponse>(
      `${this.onboardingApplicationUrl(id)}/sign`, body);
  }

  /** Development only — stands in for the payment rail, which is F07 and out of scope. */
  simulateBankVerification(id: string): Observable<unknown> {
    return this.http.post(
      `${this.onboardingApplicationUrl(id)}/bank-verification/simulate`, {});
  }

  /** Development only — reads the code the console-sink email printed. Used by the E2E run. */
  peekSignCode(id: string): Observable<SignCodePeek> {
    return this.http.get<SignCodePeek>(`${this.onboardingApplicationUrl(id)}/sign-code`);
  }
}
```

Create `libs/api-client-customer/src/lib/customer-api.testing.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { makeEnvironmentProviders, provideZonelessChangeDetection } from '@angular/core';
import type { EnvironmentProviders } from '@angular/core';

import { CUSTOMER_API_BASE_URL } from './customer-api.tokens';

/**
 * The harness every spec in the customer portal uses.
 *
 * `provideHttpClientTesting` intercepts the real HttpBackend, so it captures both the imperative
 * `CustomerApiClient` calls and anything `httpResource()` issues.
 *
 * `provideZonelessChangeDetection` is required: this workspace ships no zone.js, so a TestBed
 * without it has no scheduler and `fixture.whenStable()` never settles.
 *
 * It deliberately does NOT install the auth interceptor. Task 11 tests that in isolation, and a
 * screen spec that silently refreshed a token would hide the request it meant to assert on.
 */
export function provideCustomerApiTesting(baseUrl = '/api/v1'): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideZonelessChangeDetection(),
    provideHttpClient(),
    provideHttpClientTesting(),
    { provide: CUSTOMER_API_BASE_URL, useValue: baseUrl },
  ]);
}
```

Create `libs/api-client-customer/src/index.ts`:

```ts
export * from './lib/customer-api.tokens';
export * from './lib/customer-api.types';
export * from './lib/customer-api.client';
export * from './lib/customer-api.testing';
```

- [ ] **Step 8: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal`
Expected: PASS — 11 tests in `customer-api.client.spec.ts`

- [ ] **Step 9: Confirm the staleness check still passes**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run verify:clients; echo "exit=$?"`
Expected: `exit=0`, with a line per client saying it is up to date.

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add package.json package-lock.json tsconfig.base.json angular.json \
        tools/openapi-clients.mjs tools/openapi-clients.test.mjs \
        libs/api-client-customer apps/customer-portal
git commit -m "feat(api-client-customer): generate and commit the customer client"
```

---

### Task 11: The in-memory token store and the auth interceptor

This is the one part of the design where getting it wrong is **silently exploitable rather than
visibly broken**, so it gets a task of its own.

Two rules, both from design §7:

1. **The access token lives in memory only** — an Angular signal, never `localStorage`, never
   `sessionStorage`. A JWT in `localStorage` is readable by any cross-site script, and §8.5
   already records that the prototype builds all its markup by string concatenation. The refresh
   token is an HttpOnly, Secure, `SameSite=Strict` cookie named `pp_refresh`, scoped to
   `/api/v1/auth/refresh` alone, which JavaScript cannot read at all.
2. **A 401 triggers exactly one refresh attempt, then a redirect to sign-in.** A naive
   implementation loops: the retry 401s, which triggers a refresh, which 401s, which triggers a
   retry. On a revoked security stamp `[DEC-117]` that is an infinite request storm against a
   server that will never say yes. Three mechanisms stop it, and each has a test below:
   - the refresh endpoint itself is on the anonymous list, so its own 401 never re-enters the
     handler;
   - the retried request is re-issued **past** this interceptor, so its 401 lands in the inner
     `catchError` rather than starting a second cycle;
   - `TokenRefresher` shares one in-flight call, so N parallel 401s cost one refresh.

**Files:**
- Create: `apps/customer-portal/src/app/auth/access-token.store.ts`
- Create: `apps/customer-portal/src/app/auth/token-refresher.ts`
- Create: `apps/customer-portal/src/app/auth/auth.interceptor.ts`
- Test: `apps/customer-portal/src/app/auth/access-token.store.spec.ts`
- Test: `apps/customer-portal/src/app/auth/auth.interceptor.spec.ts`

**Interfaces:**
- Consumes: `CustomerApiClient.refresh(): Observable<SignInResponse>`,
  `CUSTOMER_API_BASE_URL`, `CurrentAccount`, `SignInResponse` from
  `@peakpower/api-client-customer` (Task 10); `@angular/router`'s `Router`.
- Produces:
  - `export class AccessTokenStore` with `readonly token: Signal<string | null>`,
    `readonly account: Signal<CurrentAccount | null>`,
    `readonly isSignedIn: Signal<boolean>`,
    `set(token: string, account: CurrentAccount): void`, `clear(): void`
  - `export class TokenRefresher` with `refresh(): Observable<SignInResponse>`
  - `export const PP_RETRIED: HttpContextToken<boolean>`
  - `export const authInterceptor: HttpInterceptorFn`

- [ ] **Step 1: Write the failing store test**

Create `apps/customer-portal/src/app/auth/access-token.store.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import type { CurrentAccount } from '@peakpower/api-client-customer';

import { AccessTokenStore } from './access-token.store';

const ACCOUNT: CurrentAccount = {
  accountId: 'a1',
  customerId: 'c1',
  firstName: 'Peter',
  lastName: 'de Vries',
  email: 'p.devries@vandersteen.nl',
  isAdmin: true,
};

describe('AccessTokenStore', () => {
  let store: AccessTokenStore;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    store = TestBed.inject(AccessTokenStore);
  });

  it('starts signed out', () => {
    expect(store.token()).toBeNull();
    expect(store.account()).toBeNull();
    expect(store.isSignedIn()).toBe(false);
  });

  it('holds the token and the account after a sign-in', () => {
    store.set('header.payload.signature', ACCOUNT);

    expect(store.token()).toBe('header.payload.signature');
    expect(store.account()).toEqual(ACCOUNT);
    expect(store.isSignedIn()).toBe(true);
  });

  it('NEVER writes the token to localStorage or sessionStorage', () => {
    // Design §7: a JWT in web storage is readable by any XSS. This is the test that fails the
    // day somebody adds a "stay signed in" checkbox the cheap way.
    store.set('header.payload.signature', ACCOUNT);

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(JSON.stringify(localStorage)).not.toContain('header.payload.signature');
    expect(JSON.stringify(sessionStorage)).not.toContain('header.payload.signature');
  });

  it('forgets everything on clear', () => {
    store.set('header.payload.signature', ACCOUNT);

    store.clear();

    expect(store.token()).toBeNull();
    expect(store.account()).toBeNull();
    expect(store.isSignedIn()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- access-token`
Expected: FAIL — `Failed to resolve import "./access-token.store"`

- [ ] **Step 3: Write the store**

Create `apps/customer-portal/src/app/auth/access-token.store.ts`:

```ts
import { Injectable, computed, signal } from '@angular/core';
import type { CurrentAccount } from '@peakpower/api-client-customer';

/**
 * The one place an access token is held, and it is memory.
 *
 * Design §7 is explicit: never `localStorage`, never `sessionStorage`. A JWT in web storage is
 * readable by any cross-site script; a signal dies with the tab. The cost is that a page reload
 * has no token — which is exactly what `AuthService.bootstrap()` uses the HttpOnly `pp_refresh`
 * cookie for. The cookie is scoped to `/api/v1/auth/refresh` alone and JavaScript cannot read
 * it at all, so an XSS can at most ride an open session rather than steal a portable one.
 */
@Injectable({ providedIn: 'root' })
export class AccessTokenStore {
  private readonly _token = signal<string | null>(null);
  private readonly _account = signal<CurrentAccount | null>(null);

  readonly token = this._token.asReadonly();
  readonly account = this._account.asReadonly();
  readonly isSignedIn = computed(() => this._token() !== null);

  set(token: string, account: CurrentAccount): void {
    this._token.set(token);
    this._account.set(account);
  }

  clear(): void {
    this._token.set(null);
    this._account.set(null);
  }
}
```

- [ ] **Step 4: Run the store test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- access-token`
Expected: PASS — 4 tests

- [ ] **Step 5: Write the failing interceptor test**

Create `apps/customer-portal/src/app/auth/auth.interceptor.spec.ts`:

```ts
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CUSTOMER_API_BASE_URL } from '@peakpower/api-client-customer';
import type { CurrentAccount, SignInResponse } from '@peakpower/api-client-customer';

import { AccessTokenStore } from './access-token.store';
import { authInterceptor } from './auth.interceptor';

const ACCOUNT: CurrentAccount = {
  accountId: 'a1',
  customerId: 'c1',
  firstName: 'Peter',
  lastName: 'de Vries',
  email: 'p.devries@vandersteen.nl',
  isAdmin: true,
};

function refreshed(token: string): SignInResponse {
  return { accessToken: token, expiresAt: '2026-08-26T12:00:00Z', account: ACCOUNT };
}

describe('authInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let tokens: AccessTokenStore;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: CUSTOMER_API_BASE_URL, useValue: '/api/v1' },
      ],
    });

    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
    tokens = TestBed.inject(AccessTokenStore);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    controller.verify();
    vi.restoreAllMocks();
  });

  it('attaches the bearer token when there is one', () => {
    tokens.set('the-token', ACCOUNT);

    http.get('/api/v1/company').subscribe();

    const req = controller.expectOne('/api/v1/company');
    expect(req.request.headers.get('Authorization')).toBe('Bearer the-token');
    req.flush({});
  });

  it('attaches nothing when signed out', () => {
    http.get('/api/v1/company').subscribe({ error: () => undefined });

    const req = controller.expectOne('/api/v1/company');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({}, { status: 401, statusText: 'Unauthorized' });

    controller.expectOne('/api/v1/auth/refresh')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
  });

  it('never attaches a token to an anonymous route', () => {
    tokens.set('the-token', ACCOUNT);

    for (const url of [
      '/api/v1/auth/sign-in',
      '/api/v1/auth/refresh',
      '/api/v1/auth/password-reset/requests',
      '/api/v1/onboarding/applications',
      '/.well-known/jwks.json',
    ]) {
      http.post(url, {}).subscribe({ error: () => undefined });
      const req = controller.expectOne(url);
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
    }
  });

  it('refreshes once on a 401 and replays the original request with the new token', () => {
    tokens.set('stale-token', ACCOUNT);
    let body: unknown;

    http.get('/api/v1/company').subscribe((r) => (body = r));

    const first = controller.expectOne('/api/v1/company');
    expect(first.request.headers.get('Authorization')).toBe('Bearer stale-token');
    first.flush({}, { status: 401, statusText: 'Unauthorized' });

    controller.expectOne('/api/v1/auth/refresh').flush(refreshed('fresh-token'));

    const replay = controller.expectOne('/api/v1/company');
    expect(replay.request.headers.get('Authorization')).toBe('Bearer fresh-token');
    replay.flush({ legalName: 'Vandersteen Koeling B.V.' });

    expect(body).toEqual({ legalName: 'Vandersteen Koeling B.V.' });
    expect(tokens.token()).toBe('fresh-token');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('refreshes ONCE and then gives up when the refresh itself fails', () => {
    // The anti-loop test. A naive implementation retries the refresh, whose 401 triggers
    // another refresh, forever, against a server that will never say yes.
    tokens.set('revoked-token', ACCOUNT);
    let failed: unknown;

    http.get('/api/v1/company').subscribe({ error: (e) => (failed = e) });

    controller.expectOne('/api/v1/company')
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    controller.expectOne('/api/v1/auth/refresh')
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    // Exactly one refresh, and nothing else in flight.
    controller.expectNone('/api/v1/auth/refresh');
    controller.expectNone('/api/v1/company');

    expect(failed).toBeTruthy();
    expect(tokens.token()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/sign-in']);
  });

  it('gives up when the REPLAYED request 401s again', () => {
    // The security stamp was bumped between the refresh and the replay. One more cycle here
    // would be the same loop by a different route.
    tokens.set('stale-token', ACCOUNT);
    let failed: unknown;

    http.get('/api/v1/company').subscribe({ error: (e) => (failed = e) });

    controller.expectOne('/api/v1/company')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    controller.expectOne('/api/v1/auth/refresh').flush(refreshed('fresh-token'));
    controller.expectOne('/api/v1/company')
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    controller.expectNone('/api/v1/auth/refresh');
    controller.expectNone('/api/v1/company');

    expect(failed).toBeTruthy();
    expect(tokens.token()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/sign-in']);
  });

  it('collapses N parallel 401s into ONE refresh', () => {
    tokens.set('stale-token', ACCOUNT);

    http.get('/api/v1/company').subscribe({ error: () => undefined });
    http.get('/api/v1/metering-points').subscribe({ error: () => undefined });
    http.get('/api/v1/ean-pool').subscribe({ error: () => undefined });

    for (const url of ['/api/v1/company', '/api/v1/metering-points', '/api/v1/ean-pool']) {
      controller.expectOne(url).flush({}, { status: 401, statusText: 'Unauthorized' });
    }

    // One refresh for three failures, not three.
    controller.expectOne('/api/v1/auth/refresh').flush(refreshed('fresh-token'));

    for (const url of ['/api/v1/company', '/api/v1/metering-points', '/api/v1/ean-pool']) {
      const replay = controller.expectOne(url);
      expect(replay.request.headers.get('Authorization')).toBe('Bearer fresh-token');
      replay.flush({});
    }
  });

  it('lets a 403, a 404 and a 500 through untouched', () => {
    tokens.set('the-token', ACCOUNT);

    for (const status of [403, 404, 500]) {
      let failed: unknown;
      http.get('/api/v1/company').subscribe({ error: (e) => (failed = e) });
      controller.expectOne('/api/v1/company').flush({}, { status, statusText: 'x' });

      expect(failed).toBeTruthy();
      controller.expectNone('/api/v1/auth/refresh');
    }

    expect(tokens.token()).toBe('the-token');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not refresh when the refresh endpoint itself returns 401', () => {
    http.post('/api/v1/auth/refresh', {}).subscribe({ error: () => undefined });

    controller.expectOne('/api/v1/auth/refresh')
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    controller.expectNone('/api/v1/auth/refresh');
  });
});
```

- [ ] **Step 6: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- auth.interceptor`
Expected: FAIL — `Failed to resolve import "./auth.interceptor"`

- [ ] **Step 7: Write the refresher and the interceptor**

Create `apps/customer-portal/src/app/auth/token-refresher.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { CustomerApiClient } from '@peakpower/api-client-customer';
import type { SignInResponse } from '@peakpower/api-client-customer';
import { finalize, shareReplay, tap } from 'rxjs/operators';
import type { Observable } from 'rxjs';

import { AccessTokenStore } from './access-token.store';

/**
 * One in-flight refresh at a time.
 *
 * Without this, a page that fires five requests on load and gets five 401s makes five refresh
 * calls — and because refresh tokens rotate and are single-use [DEC-117], four of them present a
 * token the first has already spent. The server reads that as replay and revokes the entire
 * chain, so the naive version does not merely waste calls: it signs the customer out.
 *
 * `shareReplay({ refCount: false })` keeps the answer for callers that arrive after it lands;
 * `finalize` clears the slot so a LATER 401, after a fresh sign-in, gets its own attempt.
 */
@Injectable({ providedIn: 'root' })
export class TokenRefresher {
  private readonly api = inject(CustomerApiClient);
  private readonly tokens = inject(AccessTokenStore);

  private inFlight: Observable<SignInResponse> | null = null;

  refresh(): Observable<SignInResponse> {
    if (this.inFlight !== null) return this.inFlight;

    this.inFlight = this.api.refresh().pipe(
      tap((response) => this.tokens.set(response.accessToken, response.account)),
      finalize(() => {
        this.inFlight = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    return this.inFlight;
  }
}
```

Create `apps/customer-portal/src/app/auth/auth.interceptor.ts`:

```ts
import { HttpContextToken, HttpErrorResponse, HttpRequest } from '@angular/common/http';
import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { AccessTokenStore } from './access-token.store';
import { TokenRefresher } from './token-refresher';

/** Set on the replayed request so a caller cannot start a second refresh cycle by hand. */
export const PP_RETRIED = new HttpContextToken<boolean>(() => false);

/**
 * Routes that run before there is a session. They carry no bearer token, and — critically —
 * a 401 from any of them never re-enters the refresh path. `/auth/refresh` being on this list
 * is the first of the three things that stop the loop.
 */
const ANONYMOUS_PATHS = [
  '/auth/sign-in',
  '/auth/refresh',
  '/auth/password-reset/',
  '/onboarding/applications',
  '/.well-known/',
] as const;

function isAnonymous(url: string): boolean {
  return ANONYMOUS_PATHS.some((path) => url.includes(path));
}

function withBearer<T>(request: HttpRequest<T>, token: string): HttpRequest<T> {
  return request.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const tokens = inject(AccessTokenStore);
  const refresher = inject(TokenRefresher);
  const router = inject(Router);

  if (isAnonymous(request.url)) {
    return next(request);
  }

  const token = tokens.token();
  const outbound = token === null ? request : withBearer(request, token);

  const abandonSession = (error: unknown) => {
    tokens.clear();
    void router.navigate(['/sign-in']);
    return throwError(() => error);
  };

  return next(outbound).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }

      if (request.context.get(PP_RETRIED)) {
        return abandonSession(error);
      }

      return refresher.refresh().pipe(
        switchMap((fresh) =>
          // Re-issued PAST this interceptor, so a second 401 lands in the catchError below
          // rather than starting another cycle. That is the second of the three loop guards.
          next(
            withBearer(
              request.clone({ context: request.context.set(PP_RETRIED, true) }),
              fresh.accessToken,
            ),
          ),
        ),
        // Catches both a failed refresh and a replayed request that 401s again. Either way the
        // session is over: clear the token and send the customer to sign in.
        catchError(abandonSession),
      );
    }),
  );
};
```

- [ ] **Step 8: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- auth.interceptor`
Expected: PASS — 9 tests

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/auth
git commit -m "feat(customer-portal): hold the token in memory and refresh exactly once on a 401"
```

---

### Task 12: The navigation — the design's labels over the specification's route keys

This is `D4` / `[DEC-115]`, and it is a small file that settles an argument, so it gets its own
task and its own test.

The wireframes in `specs/60-mockups/screens-customer.mjs` name the rail
`Dashboard · Connections · Consumption · Prices · Trading · Wallet · Invoices`. The design
system names it `Dashboard · Connections · Volume · Prices · Trades · Balance · Settlements`.
**The labels follow the design; the internal route keys keep the specification's names.** That
is what the demo already does, and `PAGE_LABELS` is the single mapping between the two — so a
label change is one line and never touches a URL, a guard or a test.

Nav items outside this slice render **disabled, each with the sentence that explains why**. That
is a design-system rule and it reads better than hiding them: a rail that grows between demos
looks unfinished; a rail that is complete and honest looks planned.

Three items work in slice 1: `dashboard` (a shell and a placeholder), `connections`, and
`company`. `company` is the one key the specification's list does not contain — the design's
§8.3 has a "Company profile + accounts" screen but the wireframe rail does not carry it, so
this plan adds the key and Task 25 records it.

**Files:**
- Create: `apps/customer-portal/src/app/shell/customer-nav.ts`
- Test: `apps/customer-portal/src/app/shell/customer-nav.spec.ts`

**Interfaces:**
- Consumes: `PpNavItem` and `PpNavSection` from `@peakpower/shared-ui` (plan 3).
- Produces:
  - `export const CUSTOMER_ROUTE_KEYS: readonly string[]`
  - `export type CustomerRouteKey`
  - `export const PAGE_LABELS: Readonly<Record<CustomerRouteKey, string>>`
  - `export const CUSTOMER_NAV: readonly PpNavSection[]`
  - `export const ENABLED_ROUTE_KEYS: readonly CustomerRouteKey[]`

- [ ] **Step 1: Write the failing test**

Create `apps/customer-portal/src/app/shell/customer-nav.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';

import { CUSTOMER_NAV, CUSTOMER_ROUTE_KEYS, ENABLED_ROUTE_KEYS, PAGE_LABELS } from './customer-nav';

const items = CUSTOMER_NAV.flatMap((section) => section.items);

describe('PAGE_LABELS', () => {
  it('keeps the specification route keys and applies the design system labels [DEC-115]', () => {
    // The three renames the design makes. Getting one of these backwards is the whole point of
    // the test: the KEY is the specification's, the LABEL is the design's.
    expect(PAGE_LABELS.consumption).toBe('Volume');
    expect(PAGE_LABELS.trading).toBe('Trades');
    expect(PAGE_LABELS.wallet).toBe('Balance');

    // And the one replacement: the wireframes say Invoices, the design says Settlements.
    expect(PAGE_LABELS.settlements).toBe('Settlements');
    expect(Object.values(PAGE_LABELS)).not.toContain('Invoices');
  });

  it('carries the specification names as keys, not as labels', () => {
    expect(CUSTOMER_ROUTE_KEYS).toContain('consumption');
    expect(CUSTOMER_ROUTE_KEYS).toContain('trading');
    expect(CUSTOMER_ROUTE_KEYS).toContain('wallet');
    expect(CUSTOMER_ROUTE_KEYS).toContain('settlements');
  });

  it('labels every route key exactly once', () => {
    expect(Object.keys(PAGE_LABELS).sort()).toEqual([...CUSTOMER_ROUTE_KEYS].sort());
  });
});

describe('CUSTOMER_NAV', () => {
  it('renders every route key exactly once, in one section or another', () => {
    expect(items.map((i) => i.routeKey).sort()).toEqual([...CUSTOMER_ROUTE_KEYS].sort());
  });

  it('takes every label from PAGE_LABELS and nowhere else', () => {
    for (const item of items) {
      expect(item.label).toBe(PAGE_LABELS[item.routeKey as keyof typeof PAGE_LABELS]);
    }
  });

  it('is grouped rather than a flat list of seven', () => {
    expect(CUSTOMER_NAV.length).toBeGreaterThan(1);
    expect(CUSTOMER_NAV.some((s) => s.title !== null)).toBe(true);
  });

  it('gives every row a domain-coloured dot', () => {
    for (const item of items) {
      expect(item.dot).toMatch(/^var\(--pp-/);
    }
  });

  it('enables exactly dashboard, connections and company in slice 1', () => {
    expect([...ENABLED_ROUTE_KEYS].sort()).toEqual(['company', 'connections', 'dashboard']);
  });

  it('gives every enabled item a path and no disabled reason', () => {
    for (const item of items.filter((i) => ENABLED_ROUTE_KEYS.includes(i.routeKey as never))) {
      expect(item.path).toBeTruthy();
      expect(item.disabledReason).toBeNull();
    }
  });

  it('gives every disabled item a null path and a sentence naming the reason', () => {
    const disabled = items.filter((i) => !ENABLED_ROUTE_KEYS.includes(i.routeKey as never));

    expect(disabled.length).toBe(5);
    for (const item of disabled) {
      expect(item.path).toBeNull();
      expect(item.disabledReason).toBeTruthy();
      // Sentence case with a full stop — "Empty and disabled states name the reason."
      expect(item.disabledReason!.endsWith('.')).toBe(true);
      expect(item.disabledReason!.length).toBeGreaterThan(20);
    }
  });

  it('uses no emoji and no icon glyphs in any label', () => {
    // Copy rule: no emoji, no icon set. The only glyphs are the brand mark, one magnifier,
    // the sort arrows and the chevrons.
    for (const item of items) {
      expect(item.label).toMatch(/^[A-Za-z ]+$/);
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- customer-nav`
Expected: FAIL — `Failed to resolve import "./customer-nav"`

- [ ] **Step 3: Write the navigation**

Create `apps/customer-portal/src/app/shell/customer-nav.ts`:

```ts
import type { PpNavItem, PpNavSection } from '@peakpower/shared-ui';

/**
 * The specification's route keys, unchanged [DEC-115].
 *
 * `company` is the one addition: design §8.3 has a "Company profile + accounts" screen that the
 * wireframe rail does not carry. Everything else is verbatim from
 * `specs/60-mockups/screens-customer.mjs`.
 */
export const CUSTOMER_ROUTE_KEYS = [
  'dashboard',
  'connections',
  'consumption',
  'prices',
  'trading',
  'wallet',
  'settlements',
  'company',
] as const;

export type CustomerRouteKey = (typeof CUSTOMER_ROUTE_KEYS)[number];

/**
 * The single mapping from the specification's route key to the design system's label
 * [DEC-115]. A label change is one line here and touches no URL, no guard and no test.
 *
 * Three renames and one replacement: Consumption becomes Volume, Trading becomes Trades,
 * Wallet becomes Balance, and Invoices becomes Settlements.
 */
export const PAGE_LABELS: Readonly<Record<CustomerRouteKey, string>> = Object.freeze({
  dashboard: 'Dashboard',
  connections: 'Connections',
  consumption: 'Volume',
  prices: 'Prices',
  trading: 'Trades',
  wallet: 'Balance',
  settlements: 'Settlements',
  company: 'Company',
});

/** What slice 1 actually ships. Everything else renders disabled with its reason. */
export const ENABLED_ROUTE_KEYS: readonly CustomerRouteKey[] = [
  'dashboard',
  'connections',
  'company',
];

/**
 * The domain colour each row's dot carries. Plan 3 owns the token values; this file only
 * chooses which domain gets which. A bright hex is a fill or a mark, never text — a 6px dot is
 * a mark, so these are the bright tiers rather than the text tiers.
 */
const DOT: Readonly<Record<CustomerRouteKey, string>> = Object.freeze({
  dashboard: 'var(--pp-blue-500)',
  connections: 'var(--pp-teal-text)',
  consumption: 'var(--pp-teal-text)',
  prices: 'var(--pp-amber)',
  trading: 'var(--pp-indigo)',
  wallet: 'var(--pp-indigo)',
  settlements: 'var(--pp-border-strong)',
  company: 'var(--pp-border-strong)',
});

/**
 * Why a row is disabled, in one sentence. "Empty and disabled states name the reason" is a copy
 * rule, and it reads better than hiding the row: a rail that grows between demos looks
 * unfinished, whereas a rail that is complete and honest looks planned.
 */
const DISABLED_REASON: Readonly<Partial<Record<CustomerRouteKey, string>>> = Object.freeze({
  consumption: 'Consumption charts arrive with metering-data ingestion.',
  prices: 'Price indications arrive once the day-ahead price feed is connected.',
  trading: 'Trading opens once price indications are live.',
  wallet: 'The balance follows the wallet ledger.',
  settlements: 'Settlements follow invoicing.',
});

/** Where an enabled row goes. Route keys and paths agree by construction. */
const PATH: Readonly<Partial<Record<CustomerRouteKey, string>>> = Object.freeze({
  dashboard: '/dashboard',
  connections: '/connections',
  company: '/company',
});

function item(routeKey: CustomerRouteKey): PpNavItem {
  return {
    routeKey,
    label: PAGE_LABELS[routeKey],
    path: PATH[routeKey] ?? null,
    disabledReason: DISABLED_REASON[routeKey] ?? null,
    dot: DOT[routeKey],
  };
}

/**
 * The rail, grouped as the design specifies rather than as a flat list of seven. The first
 * section has no title: a single Dashboard row under a heading reading "Dashboard" is a
 * heading that says nothing.
 */
export const CUSTOMER_NAV: readonly PpNavSection[] = Object.freeze([
  Object.freeze({ title: null, items: Object.freeze([item('dashboard')]) }),
  Object.freeze({
    title: 'Your energy',
    items: Object.freeze([item('connections'), item('consumption'), item('prices')]),
  }),
  Object.freeze({
    title: 'Trading',
    items: Object.freeze([item('trading'), item('wallet')]),
  }),
  Object.freeze({
    title: 'Administration',
    items: Object.freeze([item('settlements'), item('company')]),
  }),
]);
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- customer-nav`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/shell
git commit -m "feat(customer-portal): the design's labels over the specification's route keys"
```

---

### Task 13: Bootstrap, the session, the guard and the shell

The application boots, discovers whether there is a session, and either shows the shell or
sends the visitor to sign in.

**The bootstrap is the interesting part.** The access token lives in memory (Task 11), so a page
reload has none. But the `pp_refresh` cookie survives — it is HttpOnly and scoped to
`/api/v1/auth/refresh`, so the browser sends it and JavaScript never sees it. On the first
guarded navigation the guard calls refresh **once**: if it succeeds the customer is signed in
and never noticed the reload; if it fails they go to sign-in. That single attempt is why a
refresh must be cheap and why its failure must be quiet — a failed bootstrap is the ordinary
case for anyone arriving cold.

**Files:**
- Create: `apps/customer-portal/src/app/auth/auth.service.ts`
- Create: `apps/customer-portal/src/app/auth/authenticated.guard.ts`
- Create: `apps/customer-portal/src/app/app.config.ts`
- Create: `apps/customer-portal/src/app/app.routes.ts`
- Create: `apps/customer-portal/src/app/app.ts`
- Create: `apps/customer-portal/src/app/features/dashboard/dashboard-page.ts`
- Modify: `apps/customer-portal/src/main.ts`
- Test: `apps/customer-portal/src/app/auth/auth.service.spec.ts`
- Test: `apps/customer-portal/src/app/auth/authenticated.guard.spec.ts`

**Interfaces:**
- Consumes: `AccessTokenStore`, `TokenRefresher`, `authInterceptor` (Task 11);
  `CUSTOMER_NAV` (Task 12); `CustomerApiClient.signIn/signOut/refresh` (Task 10);
  `PpAppShell` from `@peakpower/shared-ui`.
- Produces:
  - `export class AuthService` with
    `readonly account: Signal<CurrentAccount | null>`,
    `readonly isSignedIn: Signal<boolean>`,
    `signIn(username: string, password: string): Observable<CurrentAccount>`,
    `signOut(): Observable<void>`,
    `bootstrap(): Observable<boolean>`
  - `export const authenticatedGuard: CanActivateFn`
  - `export const appConfig: ApplicationConfig`
  - `export const APP_ROUTES: Routes`
  - `export class App` — selector `pp-root`
  - `export class DashboardPage` — selector `pp-dashboard-page`

- [ ] **Step 1: Write the failing tests**

Create `apps/customer-portal/src/app/auth/auth.service.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CUSTOMER_API_BASE_URL } from '@peakpower/api-client-customer';
import type { CurrentAccount, SignInResponse } from '@peakpower/api-client-customer';

import { AccessTokenStore } from './access-token.store';
import { AuthService } from './auth.service';

const ACCOUNT: CurrentAccount = {
  accountId: 'a1',
  customerId: 'c1',
  firstName: 'Peter',
  lastName: 'de Vries',
  email: 'p.devries@vandersteen.nl',
  isAdmin: true,
};

const RESPONSE: SignInResponse = {
  accessToken: 'the-token',
  expiresAt: '2026-08-26T12:00:00Z',
  account: ACCOUNT,
};

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let tokens: AccessTokenStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CUSTOMER_API_BASE_URL, useValue: '/api/v1' },
      ],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    tokens = TestBed.inject(AccessTokenStore);
  });

  afterEach(() => http.verify());

  it('stores the token and the account on a successful sign-in', () => {
    let account: CurrentAccount | undefined;
    auth.signIn('p.devries@vandersteen.nl', 'correct-horse-battery')
      .subscribe((a) => (account = a));

    const req = http.expectOne('/api/v1/auth/sign-in');
    expect(req.request.body).toEqual({
      username: 'p.devries@vandersteen.nl',
      password: 'correct-horse-battery',
    });
    req.flush(RESPONSE);

    expect(account).toEqual(ACCOUNT);
    expect(tokens.token()).toBe('the-token');
    expect(auth.isSignedIn()).toBe(true);
    expect(auth.account()).toEqual(ACCOUNT);
  });

  it('stores nothing when sign-in is refused', () => {
    let failed = false;
    auth.signIn('p.devries@vandersteen.nl', 'wrong').subscribe({ error: () => (failed = true) });

    http.expectOne('/api/v1/auth/sign-in')
      .flush({ title: 'Sign-in failed' }, { status: 401, statusText: 'Unauthorized' });

    expect(failed).toBe(true);
    expect(tokens.token()).toBeNull();
    expect(auth.isSignedIn()).toBe(false);
  });

  it('trims the username, because a pasted address carries a space', () => {
    auth.signIn('  p.devries@vandersteen.nl  ', 'correct-horse-battery').subscribe();

    const req = http.expectOne('/api/v1/auth/sign-in');
    expect(req.request.body.username).toBe('p.devries@vandersteen.nl');
    req.flush(RESPONSE);
  });

  it('clears the session on sign-out even when the call fails', () => {
    tokens.set('the-token', ACCOUNT);

    auth.signOut().subscribe({ error: () => undefined });
    http.expectOne('/api/v1/auth/sign-out')
      .flush({}, { status: 500, statusText: 'Server Error' });

    // A network failure must not leave a signed-out customer looking signed in.
    expect(tokens.token()).toBeNull();
    expect(auth.isSignedIn()).toBe(false);
  });

  it('bootstrap succeeds when the pp_refresh cookie is still good', () => {
    let signedIn: boolean | undefined;
    auth.bootstrap().subscribe((r) => (signedIn = r));

    http.expectOne('/api/v1/auth/refresh').flush(RESPONSE);

    expect(signedIn).toBe(true);
    expect(auth.account()).toEqual(ACCOUNT);
  });

  it('bootstrap fails QUIETLY when there is no cookie — that is the ordinary case', () => {
    let signedIn: boolean | undefined;
    let errored = false;
    auth.bootstrap().subscribe({
      next: (r) => (signedIn = r),
      error: () => (errored = true),
    });

    http.expectOne('/api/v1/auth/refresh')
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(signedIn).toBe(false);
    expect(errored).toBe(false);
  });

  it('bootstrap does not call refresh again once a session exists', () => {
    tokens.set('the-token', ACCOUNT);

    let signedIn: boolean | undefined;
    auth.bootstrap().subscribe((r) => (signedIn = r));

    http.expectNone('/api/v1/auth/refresh');
    expect(signedIn).toBe(true);
  });
});
```

Create `apps/customer-portal/src/app/auth/authenticated.guard.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, runInInjectionContext, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CUSTOMER_API_BASE_URL } from '@peakpower/api-client-customer';
import type { SignInResponse } from '@peakpower/api-client-customer';
import { isObservable, firstValueFrom, of } from 'rxjs';

import { authenticatedGuard } from './authenticated.guard';

const RESPONSE: SignInResponse = {
  accessToken: 'the-token',
  expiresAt: '2026-08-26T12:00:00Z',
  account: {
    accountId: 'a1', customerId: 'c1', firstName: 'Peter', lastName: 'de Vries',
    email: 'p.devries@vandersteen.nl', isAdmin: true,
  },
};

describe('authenticatedGuard', () => {
  let http: HttpTestingController;
  let injector: EnvironmentInjector;

  const run = () =>
    runInInjectionContext(injector, () =>
      authenticatedGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CUSTOMER_API_BASE_URL, useValue: '/api/v1' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    injector = TestBed.inject(EnvironmentInjector);
  });

  afterEach(() => http.verify());

  it('admits a visitor whose refresh cookie is still good', async () => {
    const result = run();
    const settled = isObservable(result) ? firstValueFrom(result) : Promise.resolve(result);

    http.expectOne('/api/v1/auth/refresh').flush(RESPONSE);

    expect(await settled).toBe(true);
  });

  it('sends a visitor with no session to sign-in', async () => {
    const router = TestBed.inject(Router);
    const tree = router.parseUrl('/sign-in');
    vi.spyOn(router, 'parseUrl').mockReturnValue(tree);

    const result = run();
    const settled = isObservable(result) ? firstValueFrom(result) : Promise.resolve(result);

    http.expectOne('/api/v1/auth/refresh')
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(await settled).toBe(tree);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- auth.service authenticated.guard`
Expected: FAIL — `Failed to resolve import "./auth.service"`

- [ ] **Step 3: Write the session service and the guard**

Create `apps/customer-portal/src/app/auth/auth.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { CustomerApiClient } from '@peakpower/api-client-customer';
import type { CurrentAccount } from '@peakpower/api-client-customer';
import { of, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import type { Observable } from 'rxjs';

import { AccessTokenStore } from './access-token.store';
import { TokenRefresher } from './token-refresher';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(CustomerApiClient);
  private readonly tokens = inject(AccessTokenStore);
  private readonly refresher = inject(TokenRefresher);

  readonly account = this.tokens.account;
  readonly isSignedIn = this.tokens.isSignedIn;

  /** The username is the email address the person signed up with. */
  signIn(username: string, password: string): Observable<CurrentAccount> {
    return this.api.signIn({ username: username.trim(), password }).pipe(
      tap((response) => this.tokens.set(response.accessToken, response.account)),
      map((response) => response.account),
    );
  }

  /**
   * Clears the session first and asks the server second. A network failure must not leave a
   * signed-out customer looking signed in — the refresh token dies on the server's side
   * whenever the call does land, and the access token expires in fifteen minutes regardless.
   */
  signOut(): Observable<void> {
    this.tokens.clear();
    return this.api.signOut();
  }

  /**
   * Is there still a session?
   *
   * The access token lives in memory, so a page reload has none — but the HttpOnly `pp_refresh`
   * cookie survives, and the browser sends it whether or not JavaScript knows about it. One
   * refresh attempt answers the question. Failure is the ORDINARY case for anyone arriving
   * cold, so it resolves to `false` rather than erroring: an error here would light up the
   * console on every first visit.
   */
  bootstrap(): Observable<boolean> {
    if (this.tokens.isSignedIn()) return of(true);

    return this.refresher.refresh().pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }
}
```

Create `apps/customer-portal/src/app/auth/authenticated.guard.ts`:

```ts
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import type { CanActivateFn } from '@angular/router';
import { map } from 'rxjs/operators';

import { AuthService } from './auth.service';

/**
 * Admits a visitor who has a session, or who can still get one from the `pp_refresh` cookie.
 * Everyone else is redirected rather than shown an error — arriving at a bookmarked page with
 * no session is a normal thing to do, not a failure.
 */
export const authenticatedGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.bootstrap().pipe(
    map((signedIn) => (signedIn ? true : router.parseUrl('/sign-in'))),
  );
};
```

- [ ] **Step 4: Write the routes, the root component and the bootstrap**

Create `apps/customer-portal/src/app/app.routes.ts`:

```ts
import type { Routes } from '@angular/router';

import { authenticatedGuard } from './auth/authenticated.guard';

export const APP_ROUTES: Routes = [
  {
    path: 'sign-in',
    loadComponent: () =>
      import('./features/sign-in/sign-in-page').then((m) => m.SignInPage),
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./features/sign-in/forgot-password-page').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./features/sign-in/reset-password-page').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'onboarding',
    loadComponent: () =>
      import('./onboarding/onboarding-wizard').then((m) => m.OnboardingWizard),
  },
  {
    path: 'dashboard',
    canActivate: [authenticatedGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage),
  },
  {
    path: 'connections',
    canActivate: [authenticatedGuard],
    loadChildren: () =>
      import('./features/connections/connections.routes').then((m) => m.CONNECTION_ROUTES),
  },
  {
    path: 'company',
    canActivate: [authenticatedGuard],
    loadComponent: () =>
      import('./features/company/company-page').then((m) => m.CompanyPage),
  },
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: '**', redirectTo: 'dashboard' },
];
```

> Every `loadComponent` above points at a file a later task creates. Until Tasks 14, 15, 17,
> 19 and 22 land, `ng build` fails on the missing modules. Create each file as an empty
> placeholder now if you need an intermediate green build:
> `echo 'export class X {}' > …` is enough to compile; the real component replaces it.

Create `apps/customer-portal/src/app/features/dashboard/dashboard-page.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PpBanner, PpCard } from '@peakpower/shared-ui';

import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'pp-dashboard-page',
  standalone: true,
  imports: [PpCard, PpBanner, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <pp-card
        [heading]="'Welcome' + (firstName() ? ', ' + firstName() : '')"
        subtitle="Slice 1 of the PeakPower platform"
      >
        <p class="lede">
          Your company and its connections are live. Consumption, prices, trading, balance and
          settlements arrive in later slices — the rail shows each of them with the reason it is
          not ready yet.
        </p>
        <p><a routerLink="/connections">Go to your connections ›</a></p>
      </pp-card>

      <pp-banner tone="info" heading="No figures are shown here on purpose">
        Every number in this product is computed from real data or rendered unavailable. There is
        no metering data yet, so this page has nothing to total.
      </pp-banner>
    </div>
  `,
  styles: `
    /* 20px on Dashboard only — every other page uses the 16px page gap. */
    .page { display: flex; flex-direction: column; gap: 20px; }
    .lede { margin: 0 0 12px; font-size: 13px; line-height: 1.6; color: var(--pp-text-muted); }
    a { color: var(--pp-blue-700); text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
  `,
})
export class DashboardPage {
  private readonly auth = inject(AuthService);
  readonly firstName = () => this.auth.account()?.firstName ?? '';
}
```

Create `apps/customer-portal/src/app/app.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { PpAppShell, PpButton } from '@peakpower/shared-ui';

import { AuthService } from './auth/auth.service';
import { CUSTOMER_NAV } from './shell/customer-nav';

@Component({
  selector: 'pp-root',
  standalone: true,
  imports: [RouterOutlet, PpAppShell, PpButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (chrome()) {
      <pp-app-shell [sections]="nav" [subtitle]="companyLine()">
        <router-outlet />
        <pp-button slot="topbar-actions" variant="secondary" size="sm" (click)="signOut()">
          Sign out
        </pp-button>
      </pp-app-shell>
    } @else {
      <!-- Sign-in, password reset and the onboarding wizard have no rail: there is no session
           yet, so a navigation rail would be seven disabled rows and a sign-out button. -->
      <router-outlet />
    }
  `,
})
export class App {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly nav = CUSTOMER_NAV;

  readonly chrome = computed(() => this.auth.isSignedIn());

  readonly companyLine = computed(() => {
    const account = this.auth.account();
    return account === null ? null : `${account.firstName} ${account.lastName}`;
  });

  signOut(): void {
    this.auth.signOut().subscribe({
      complete: () => void this.router.navigate(['/sign-in']),
      error: () => void this.router.navigate(['/sign-in']),
    });
  }
}
```

Create `apps/customer-portal/src/app/app.config.ts`:

```ts
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import type { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { CUSTOMER_API_BASE_URL } from '@peakpower/api-client-customer';

import { APP_ROUTES } from './app.routes';
import { authInterceptor } from './auth/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(APP_ROUTES, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Dutch formatting throughout [AS-19]: comma decimal, period thousands.
    { provide: LOCALE_ID, useValue: 'nl-NL' },
    // The dev server proxies /api to whatever host Aspire started — see proxy.conf.mjs.
    { provide: CUSTOMER_API_BASE_URL, useValue: '/api/v1' },
  ],
};
```

Replace `apps/customer-portal/src/main.ts`:

```ts
import { registerLocaleData } from '@angular/common';
import localeNl from '@angular/common/locales/nl';
import { bootstrapApplication } from '@angular/platform-browser';

import { App } from './app/app';
import { appConfig } from './app/app.config';

// LOCALE_ID alone is not enough: DecimalPipe and DatePipe need the locale DATA registered too,
// or they fall back to en-US and print 19,722.00 where the design says € 19.722,00.
registerLocaleData(localeNl, 'nl-NL');

void bootstrapApplication(App, appConfig);
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- auth.service authenticated.guard`
Expected: PASS — 9 tests

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src
git commit -m "feat(customer-portal): bootstrap the session from the refresh cookie and mount the shell"
```

---

### Task 14: Sign in

The first screen a returning customer sees, and the first place the portal has to render a
server error. Two small shared pieces land here because this is where they are first needed: a
form-field wrapper and the RFC 7807 mapping that turns a problem document's `errors` map into
control errors.

**The browser does not duplicate server validation.** The API owns every rule; the form
surfaces what it returns. A password minimum re-implemented in TypeScript is a rule that drifts
from the one that is actually enforced.

**Sign-in failure never says which half was wrong.** "That username and password do not match"
covers both, because "no such account" is an account-enumeration oracle — the same reason
design §7 makes the password-reset request always return 202.

**Files:**
- Create: `apps/customer-portal/src/app/shared/form-field.ts`
- Create: `apps/customer-portal/src/app/shared/apply-problem-details.ts`
- Create: `apps/customer-portal/src/app/features/sign-in/sign-in-page.ts`
- Test: `apps/customer-portal/src/app/shared/apply-problem-details.spec.ts`
- Test: `apps/customer-portal/src/app/features/sign-in/sign-in-page.spec.ts`

**Interfaces:**
- Consumes: `AuthService.signIn(username, password)` (Task 13);
  `isValidationProblem` and `ValidationProblemDetails` from `@peakpower/api-client-customer`;
  `PpButton`, `PpCard`, `PpBanner` from `@peakpower/shared-ui`.
- Produces:
  - `export function applyProblemDetails(form: FormGroup, error: unknown): string | null`
  - `export class PpFormField` — selector `pp-form-field`, inputs `label`, `for`, `hint`, `error`
  - `export class SignInPage` — selector `pp-sign-in-page`

- [ ] **Step 1: Write the failing tests**

Create `apps/customer-portal/src/app/shared/apply-problem-details.spec.ts`:

```ts
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup } from '@angular/forms';
import { describe, it, expect } from 'vitest';

import { applyProblemDetails } from './apply-problem-details';

function form() {
  return new FormGroup({
    name: new FormControl(''),
    description: new FormControl(''),
  });
}

function problem(body: unknown, status = 400) {
  return new HttpErrorResponse({ error: body, status, statusText: 'Bad Request' });
}

describe('applyProblemDetails', () => {
  it('puts a message on the control it names', () => {
    const f = form();

    const summary = applyProblemDetails(f, problem({
      title: 'The request is not valid.',
      errors: { name: ['A name is at most 80 characters.'] },
    }));

    expect(f.controls.name.errors).toEqual({ server: 'A name is at most 80 characters.' });
    expect(f.controls.description.errors).toBeNull();
    expect(summary).toBeNull();
  });

  it('matches a control regardless of the case the server used', () => {
    // ASP.NET Core writes PascalCase property paths; the form uses camelCase.
    const f = form();

    applyProblemDetails(f, problem({ errors: { Name: ['Too long.'] } }));

    expect(f.controls.name.errors).toEqual({ server: 'Too long.' });
  });

  it('joins several messages for one control', () => {
    const f = form();

    applyProblemDetails(f, problem({ errors: { name: ['Too long.', 'Not unique.'] } }));

    expect(f.controls.name.errors).toEqual({ server: 'Too long. Not unique.' });
  });

  it('returns a summary for an error naming no control we have', () => {
    const f = form();

    const summary = applyProblemDetails(f, problem({
      title: 'The request is not valid.',
      errors: { ean: ['That connection is already claimed.'] },
    }));

    // An error that lands on nothing must still be visible, or the form looks stuck.
    expect(summary).toBe('That connection is already claimed.');
    expect(f.controls.name.errors).toBeNull();
  });

  it('falls back to detail, then title, then a plain sentence', () => {
    expect(applyProblemDetails(form(), problem({ detail: 'Try again later.', title: 'Oops' })))
      .toBe('Try again later.');
    expect(applyProblemDetails(form(), problem({ title: 'Oops' }))).toBe('Oops');
    expect(applyProblemDetails(form(), problem(null, 500)))
      .toBe('Something went wrong. Try again.');
  });

  it('says so plainly when the network is down', () => {
    const offline = new HttpErrorResponse({ error: new ProgressEvent('error'), status: 0 });

    expect(applyProblemDetails(form(), offline))
      .toBe('PeakPower could not be reached. Check your connection and try again.');
  });

  it('clears a previous server error before applying a new one', () => {
    const f = form();
    applyProblemDetails(f, problem({ errors: { name: ['Too long.'] } }));

    applyProblemDetails(f, problem({ errors: { description: ['Too long.'] } }));

    expect(f.controls.name.errors).toBeNull();
    expect(f.controls.description.errors).toEqual({ server: 'Too long.' });
  });
});
```

Create `apps/customer-portal/src/app/features/sign-in/sign-in-page.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CUSTOMER_API_BASE_URL } from '@peakpower/api-client-customer';

import { SignInPage } from './sign-in-page';

describe('SignInPage', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CUSTOMER_API_BASE_URL, useValue: '/api/v1' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SignInPage);
    await fixture.whenStable();
    return fixture;
  }

  afterEach(() => http.verify());

  it('refuses to submit an empty form and never calls the API', async () => {
    const fixture = await render();

    fixture.componentInstance.submit();
    await fixture.whenStable();

    http.expectNone('/api/v1/auth/sign-in');
    expect(fixture.componentInstance.form.invalid).toBe(true);
  });

  it('signs in and lands on the dashboard', async () => {
    const fixture = await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.form.setValue({
      username: 'p.devries@vandersteen.nl',
      password: 'correct-horse-battery',
    });
    fixture.componentInstance.submit();

    http.expectOne('/api/v1/auth/sign-in').flush({
      accessToken: 'the-token',
      expiresAt: '2026-08-26T12:00:00Z',
      account: {
        accountId: 'a1', customerId: 'c1', firstName: 'Peter', lastName: 'de Vries',
        email: 'p.devries@vandersteen.nl', isAdmin: true,
      },
    });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('says one thing for a wrong password and a missing account alike', async () => {
    const fixture = await render();

    fixture.componentInstance.form.setValue({
      username: 'nobody@nowhere.nl',
      password: 'correct-horse-battery',
    });
    fixture.componentInstance.submit();

    http.expectOne('/api/v1/auth/sign-in')
      .flush({ title: 'Sign-in failed' }, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();

    // Never "no such account": that is an enumeration oracle.
    expect(fixture.componentInstance.summary())
      .toBe('That username and password do not match.');
    expect(fixture.nativeElement.textContent).not.toContain('no such');
  });

  it('stops showing the busy state after a failure', async () => {
    const fixture = await render();

    fixture.componentInstance.form.setValue({
      username: 'p.devries@vandersteen.nl', password: 'wrong-password-here',
    });
    fixture.componentInstance.submit();
    expect(fixture.componentInstance.busy()).toBe(true);

    http.expectOne('/api/v1/auth/sign-in')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();

    expect(fixture.componentInstance.busy()).toBe(false);
  });

  it('offers the way to a forgotten password and the way to sign up', async () => {
    const fixture = await render();

    const hrefs = Array.from(
      fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>,
    ).map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/forgot-password');
    expect(hrefs).toContain('/onboarding');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- apply-problem-details sign-in-page`
Expected: FAIL — `Failed to resolve import "./apply-problem-details"`

- [ ] **Step 3: Write the shared pieces**

Create `apps/customer-portal/src/app/shared/apply-problem-details.ts`:

```ts
import { HttpErrorResponse } from '@angular/common/http';
import type { FormGroup } from '@angular/forms';
import { isValidationProblem } from '@peakpower/api-client-customer';
import type { ValidationProblemDetails } from '@peakpower/api-client-customer';

/**
 * Puts an RFC 7807 problem document onto a reactive form.
 *
 * The API owns every validation rule and this is how the browser surfaces them. A rule
 * re-implemented in TypeScript is a rule that drifts from the one actually enforced, so the
 * only client-side validators in this portal are "required" and "matches the other field".
 *
 * Returns a summary sentence for anything that lands on no control — an error nobody can see
 * makes a form look stuck.
 */
export function applyProblemDetails(form: FormGroup, error: unknown): string | null {
  clearServerErrors(form);

  if (!(error instanceof HttpErrorResponse)) {
    return 'Something went wrong. Try again.';
  }

  if (error.status === 0) {
    return 'PeakPower could not be reached. Check your connection and try again.';
  }

  const body: unknown = error.error;

  if (isValidationProblem(body)) {
    const unmatched: string[] = [];

    for (const [property, messages] of Object.entries(body.errors ?? {})) {
      const control = findControl(form, property);
      const message = messages.join(' ');

      if (control === null) {
        unmatched.push(message);
      } else {
        control.setErrors({ ...(control.errors ?? {}), server: message });
        control.markAsTouched();
      }
    }

    if (unmatched.length > 0) return unmatched.join(' ');
    return null;
  }

  const problem = body as ValidationProblemDetails | null;
  return problem?.detail ?? problem?.title ?? 'Something went wrong. Try again.';
}

/** ASP.NET Core writes PascalCase property paths; a reactive form uses camelCase. */
function findControl(form: FormGroup, property: string) {
  const direct = form.get(property);
  if (direct !== null) return direct;

  const wanted = property.toLowerCase();
  const key = Object.keys(form.controls).find((c) => c.toLowerCase() === wanted);
  return key === undefined ? null : form.controls[key];
}

function clearServerErrors(form: FormGroup): void {
  for (const control of Object.values(form.controls)) {
    if (control.errors === null) continue;
    const { server: _dropped, ...rest } = control.errors;
    control.setErrors(Object.keys(rest).length > 0 ? rest : null);
  }
}
```

Create `apps/customer-portal/src/app/shared/form-field.ts`:

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A label, a control and the one message under it. The message is whatever the server said —
 * this component never decides what is wrong, only where the answer goes.
 */
@Component({
  selector: 'pp-form-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field">
      <label class="fg-label" [attr.for]="for()">{{ label() }}</label>
      <ng-content />
      @if (error()) {
        <p class="msg error">{{ error() }}</p>
      } @else if (hint()) {
        <p class="msg hint">{{ hint() }}</p>
      }
    </div>
  `,
  styles: `
    .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    .fg-label {
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; color: var(--pp-text-muted);
    }
    .msg { margin: 0; font-size: 11.5px; line-height: 1.45; }
    .hint { color: var(--pp-text-faint); }
    .error { color: var(--pp-red-text); }
    ::ng-deep .field input,
    ::ng-deep .field select,
    ::ng-deep .field textarea {
      width: 100%; box-sizing: border-box; font: inherit; font-size: 13px;
      padding: 9px 11px; border: 1px solid var(--pp-border); border-radius: 6px;
      background: var(--pp-surface); color: var(--pp-text);
    }
    ::ng-deep .field input:focus,
    ::ng-deep .field select:focus,
    ::ng-deep .field textarea:focus {
      outline: none; border-color: var(--pp-blue-500);
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

- [ ] **Step 4: Write the sign-in page**

Create `apps/customer-portal/src/app/features/sign-in/sign-in-page.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { PpButton, PpCard } from '@peakpower/shared-ui';

import { AuthService } from '../../auth/auth.service';
import { PpFormField } from '../../shared/form-field';

@Component({
  selector: 'pp-sign-in-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, PpCard, PpButton, PpFormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="frame">
      <div class="brand">PeakPower</div>

      <pp-card heading="Sign in" subtitle="Your energy, your connections, your figures">
        <form [formGroup]="form" (ngSubmit)="submit()">
          @if (summary()) {
            <p class="summary" role="alert">{{ summary() }}</p>
          }

          <pp-form-field
            label="Email"
            for="username"
            [error]="errorFor('username')"
          >
            <input
              id="username"
              type="email"
              autocomplete="username"
              formControlName="username"
              placeholder="p.devries@company.nl"
            />
          </pp-form-field>

          <pp-form-field
            label="Password"
            for="password"
            [error]="errorFor('password')"
          >
            <input
              id="password"
              type="password"
              autocomplete="current-password"
              formControlName="password"
            />
          </pp-form-field>

          <pp-button variant="primary" type="submit" [disabled]="busy()">
            {{ busy() ? 'Signing in…' : 'Sign in' }}
          </pp-button>
        </form>

        <p class="foot">
          <a routerLink="/forgot-password">Forgotten your password?</a>
        </p>
      </pp-card>

      <p class="alt">
        No account yet? <a routerLink="/onboarding">Set your company up ›</a>
      </p>
    </div>
  `,
  styles: `
    .frame {
      max-width: 420px; margin: 8vh auto 0; display: flex; flex-direction: column; gap: 16px;
    }
    .brand { font-size: 18px; font-weight: 700; letter-spacing: -0.01em; color: var(--pp-text); }
    .summary {
      margin: 0 0 14px; padding: 10px 12px; border-radius: 6px;
      border: 1px solid var(--pp-red-border); background: var(--pp-red-surface);
      color: var(--pp-red-text); font-size: 12.5px; line-height: 1.45;
    }
    .foot { margin: 14px 0 0; font-size: 12px; }
    .alt { margin: 0; font-size: 12px; color: var(--pp-text-muted); }
    a { color: var(--pp-blue-700); text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
  `,
})
export class SignInPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly busy = signal(false);
  readonly summary = signal<string | null>(null);

  /**
   * `required` only. Every other rule belongs to the API — the browser must not hold a second,
   * drifting copy of the password policy.
   */
  readonly form = this.fb.nonNullable.group({
    username: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });

  errorFor(control: 'username' | 'password'): string | null {
    const c = this.form.controls[control];
    if (!c.touched) return null;
    if (c.hasError('required')) {
      return control === 'username'
        ? 'Enter the email address you sign in with.'
        : 'Enter your password.';
    }
    return null;
  }

  submit(): void {
    this.summary.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    const { username, password } = this.form.getRawValue();

    this.auth.signIn(username, password).subscribe({
      next: () => {
        this.busy.set(false);
        void this.router.navigate(['/dashboard']);
      },
      error: () => {
        this.busy.set(false);
        // One sentence for both halves. "No such account" would let anyone enumerate our
        // customer list with a password field — the same reason the reset request is always 202.
        this.summary.set('That username and password do not match.');
      },
    });
  }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- apply-problem-details sign-in-page`
Expected: PASS — 12 tests

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/shared apps/customer-portal/src/app/features/sign-in
git commit -m "feat(customer-portal): sign in, with server-owned validation and no enumeration oracle"
```

---

### Task 15: Forgotten password, and setting a new one

`[DEC-113]` puts a credential in the platform, so the reset path comes with it — a credential
store without one is not shippable past a demo.

Two screens and one rule that governs the first of them: **the request endpoint always returns
202**, whether or not the address exists, so the screen must always print the same sentence.
An answer that varies is an account-enumeration oracle, and a screen that says "we have sent
you an email" only when the address is real defeats the API's care entirely.

Completion bumps `security_stamp`, so every outstanding access and refresh token for that
account dies immediately `[DEC-117]` — which is why the reset screen sends the customer to sign
in rather than straight into the portal.

**Files:**
- Create: `apps/customer-portal/src/app/features/sign-in/forgot-password-page.ts`
- Create: `apps/customer-portal/src/app/features/sign-in/reset-password-page.ts`
- Test: `apps/customer-portal/src/app/features/sign-in/forgot-password-page.spec.ts`
- Test: `apps/customer-portal/src/app/features/sign-in/reset-password-page.spec.ts`

**Interfaces:**
- Consumes: `CustomerApiClient.requestPasswordReset({ email })` and
  `.completePasswordReset({ token, newPassword })` (Task 10);
  `applyProblemDetails` and `PpFormField` (Task 14); `@angular/router`'s `ActivatedRoute`.
- Produces:
  - `export class ForgotPasswordPage` — selector `pp-forgot-password-page`
  - `export class ResetPasswordPage` — selector `pp-reset-password-page`
  - `export const MINIMUM_PASSWORD_LENGTH = 12`

- [ ] **Step 1: Write the failing tests**

Create `apps/customer-portal/src/app/features/sign-in/forgot-password-page.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, afterEach } from 'vitest';
import { CUSTOMER_API_BASE_URL } from '@peakpower/api-client-customer';

import { ForgotPasswordPage } from './forgot-password-page';

describe('ForgotPasswordPage', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CUSTOMER_API_BASE_URL, useValue: '/api/v1' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ForgotPasswordPage);
    await fixture.whenStable();
    return fixture;
  }

  afterEach(() => http.verify());

  const CONFIRMATION =
    'If that address belongs to a PeakPower account, we have sent it a link to set a new '
    + 'password. The link is valid for one hour.';

  it('posts the address and confirms', async () => {
    const fixture = await render();

    fixture.componentInstance.form.setValue({ email: 'p.devries@vandersteen.nl' });
    fixture.componentInstance.submit();

    const req = http.expectOne('/api/v1/auth/password-reset/requests');
    expect(req.request.body).toEqual({ email: 'p.devries@vandersteen.nl' });
    req.flush(null, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();

    expect(fixture.componentInstance.confirmation()).toBe(CONFIRMATION);
  });

  it('prints the SAME sentence for an address that does not exist', async () => {
    // The API answers 202 either way; a screen that distinguished them would put the
    // enumeration oracle back that the API just removed.
    const fixture = await render();

    fixture.componentInstance.form.setValue({ email: 'nobody@nowhere.nl' });
    fixture.componentInstance.submit();
    http.expectOne('/api/v1/auth/password-reset/requests')
      .flush(null, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();

    expect(fixture.componentInstance.confirmation()).toBe(CONFIRMATION);
    expect(fixture.nativeElement.textContent).not.toContain('not found');
    expect(fixture.nativeElement.textContent).not.toContain('no account');
  });

  it('hides the form once the request is confirmed, so it cannot be sent twice by reflex', async () => {
    const fixture = await render();

    fixture.componentInstance.form.setValue({ email: 'p.devries@vandersteen.nl' });
    fixture.componentInstance.submit();
    http.expectOne('/api/v1/auth/password-reset/requests')
      .flush(null, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('does not call the API for an empty address', async () => {
    const fixture = await render();

    fixture.componentInstance.submit();
    await fixture.whenStable();

    http.expectNone('/api/v1/auth/password-reset/requests');
  });
});
```

Create `apps/customer-portal/src/app/features/sign-in/reset-password-page.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CUSTOMER_API_BASE_URL } from '@peakpower/api-client-customer';
import { of } from 'rxjs';

import { ResetPasswordPage } from './reset-password-page';

describe('ResetPasswordPage', () => {
  let http: HttpTestingController;

  async function render(token: string | null) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CUSTOMER_API_BASE_URL, useValue: '/api/v1' },
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(new Map([['token', token]]) as never) },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ResetPasswordPage);
    fixture.componentInstance.token.set(token);
    await fixture.whenStable();
    return fixture;
  }

  afterEach(() => http.verify());

  it('refuses to submit when the two passwords differ', async () => {
    const fixture = await render('a-real-token');

    fixture.componentInstance.form.setValue({
      newPassword: 'correct-horse-battery',
      confirmPassword: 'correct-horse-batteries',
    });
    fixture.componentInstance.submit();
    await fixture.whenStable();

    http.expectNone('/api/v1/auth/password-reset/completions');
    expect(fixture.componentInstance.form.hasError('mismatch')).toBe(true);
  });

  it('sends the token with the new password and returns the customer to sign-in', async () => {
    const fixture = await render('a-real-token');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.form.setValue({
      newPassword: 'correct-horse-battery',
      confirmPassword: 'correct-horse-battery',
    });
    fixture.componentInstance.submit();

    const req = http.expectOne('/api/v1/auth/password-reset/completions');
    expect(req.request.body).toEqual({
      token: 'a-real-token',
      newPassword: 'correct-horse-battery',
    });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();

    // Completion bumps the security stamp, so every outstanding token is already dead:
    // the only honest next screen is sign-in.
    expect(navigate).toHaveBeenCalledWith(['/sign-in']);
  });

  it('surfaces a spent or expired token from the server rather than guessing', async () => {
    const fixture = await render('a-spent-token');

    fixture.componentInstance.form.setValue({
      newPassword: 'correct-horse-battery',
      confirmPassword: 'correct-horse-battery',
    });
    fixture.componentInstance.submit();

    http.expectOne('/api/v1/auth/password-reset/completions').flush(
      { title: 'That link has expired or has already been used.' },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();

    expect(fixture.componentInstance.summary())
      .toBe('That link has expired or has already been used.');
  });

  it('says what is wrong when the link carries no token at all', async () => {
    const fixture = await render(null);

    expect(fixture.nativeElement.textContent)
      .toContain('This link is incomplete');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- password-page`
Expected: FAIL — `Failed to resolve import "./forgot-password-page"`

- [ ] **Step 3: Write the two screens**

Create `apps/customer-portal/src/app/features/sign-in/forgot-password-page.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CustomerApiClient, PpButtonUnused as _unused } from '@peakpower/api-client-customer';
import { PpBanner, PpButton, PpCard } from '@peakpower/shared-ui';

import { PpFormField } from '../../shared/form-field';

/**
 * The one sentence this screen ever prints on success.
 *
 * The API returns 202 whether or not the address exists, precisely so that nobody can use this
 * form to discover who banks with PeakPower. A screen that said "we have sent you an email"
 * only for real addresses would put that oracle straight back.
 */
const CONFIRMATION =
  'If that address belongs to a PeakPower account, we have sent it a link to set a new '
  + 'password. The link is valid for one hour.';

@Component({
  selector: 'pp-forgot-password-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, PpCard, PpButton, PpBanner, PpFormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="frame">
      <div class="brand">PeakPower</div>

      <pp-card heading="Forgotten your password?" subtitle="We will email you a link to set a new one">
        @if (confirmation()) {
          <pp-banner tone="info" heading="Check your email">{{ confirmation() }}</pp-banner>
          <p class="foot"><a routerLink="/sign-in">Back to sign in</a></p>
        } @else {
          <form [formGroup]="form" (ngSubmit)="submit()">
            <pp-form-field label="Email" for="email" [error]="emailError()">
              <input
                id="email"
                type="email"
                autocomplete="email"
                formControlName="email"
                placeholder="p.devries@company.nl"
              />
            </pp-form-field>

            <pp-button variant="primary" type="submit" [disabled]="busy()">
              {{ busy() ? 'Sending…' : 'Email me a link' }}
            </pp-button>
          </form>

          <p class="foot"><a routerLink="/sign-in">Back to sign in</a></p>
        }
      </pp-card>
    </div>
  `,
  styles: `
    .frame { max-width: 420px; margin: 8vh auto 0; display: flex; flex-direction: column; gap: 16px; }
    .brand { font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
    .foot { margin: 14px 0 0; font-size: 12px; }
    a { color: var(--pp-blue-700); text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
  `,
})
export class ForgotPasswordPage {
  private readonly api = inject(CustomerApiClient);
  private readonly fb = inject(FormBuilder);

  readonly busy = signal(false);
  readonly confirmation = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required]],
  });

  emailError(): string | null {
    const c = this.form.controls.email;
    return c.touched && c.hasError('required') ? 'Enter your email address.' : null;
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.busy.set(true);

    // Same outcome on success and on failure. There is nothing this screen may reveal about
    // whether the address exists, and a network error is not worth revealing it for.
    const settle = () => {
      this.busy.set(false);
      this.confirmation.set(CONFIRMATION);
    };

    this.api
      .requestPasswordReset({ email: this.form.getRawValue().email.trim() })
      .subscribe({ next: settle, error: settle });
  }
}
```

> Delete the `PpButtonUnused as _unused` import above — it is not a real export and is written
> here only so a copy-paste that leaves it in fails loudly at compile time rather than
> silently. The correct import line is:
> `import { CustomerApiClient } from '@peakpower/api-client-customer';`

Create `apps/customer-portal/src/app/features/sign-in/reset-password-page.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import type { AbstractControl, ValidationErrors } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CustomerApiClient } from '@peakpower/api-client-customer';
import { PpBanner, PpButton, PpCard } from '@peakpower/shared-ui';

import { applyProblemDetails } from '../../shared/apply-problem-details';
import { PpFormField } from '../../shared/form-field';

/**
 * The wizard's twelve-character minimum, repeated here only to COUNT DOWN in the hint. The rule
 * itself is the API's and this screen never refuses on it — [OQ-98] may change the number, and
 * a browser copy that disagreed with the server would refuse passwords the server accepts.
 */
export const MINIMUM_PASSWORD_LENGTH = 12;

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const a = group.get('newPassword')?.value;
  const b = group.get('confirmPassword')?.value;
  return a === b ? null : { mismatch: true };
}

@Component({
  selector: 'pp-reset-password-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, PpCard, PpButton, PpBanner, PpFormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="frame">
      <div class="brand">PeakPower</div>

      <pp-card heading="Set a new password" subtitle="Then sign in with it">
        @if (token() === null) {
          <pp-banner tone="warning" heading="This link is incomplete">
            The address is missing its one-time token, so we cannot tell which account it is for.
            Open the link from the email again, or ask for a new one.
          </pp-banner>
          <p class="foot"><a routerLink="/forgot-password">Ask for a new link</a></p>
        } @else {
          <form [formGroup]="form" (ngSubmit)="submit()">
            @if (summary()) {
              <p class="summary" role="alert">{{ summary() }}</p>
            }

            <pp-form-field
              label="New password"
              for="newPassword"
              [hint]="countdown()"
              [error]="controlError('newPassword')"
            >
              <input
                id="newPassword"
                type="password"
                autocomplete="new-password"
                formControlName="newPassword"
              />
            </pp-form-field>

            <pp-form-field
              label="New password again"
              for="confirmPassword"
              [error]="confirmError()"
            >
              <input
                id="confirmPassword"
                type="password"
                autocomplete="new-password"
                formControlName="confirmPassword"
              />
            </pp-form-field>

            <pp-button variant="primary" type="submit" [disabled]="busy()">
              {{ busy() ? 'Saving…' : 'Set the password' }}
            </pp-button>
          </form>
        }
      </pp-card>
    </div>
  `,
  styles: `
    .frame { max-width: 420px; margin: 8vh auto 0; display: flex; flex-direction: column; gap: 16px; }
    .brand { font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
    .summary {
      margin: 0 0 14px; padding: 10px 12px; border-radius: 6px;
      border: 1px solid var(--pp-red-border); background: var(--pp-red-surface);
      color: var(--pp-red-text); font-size: 12.5px; line-height: 1.45;
    }
    .foot { margin: 14px 0 0; font-size: 12px; }
    a { color: var(--pp-blue-700); text-decoration: none; font-weight: 600; }
    a:hover { text-decoration: underline; }
  `,
})
export class ResetPasswordPage {
  private readonly api = inject(CustomerApiClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly busy = signal(false);
  readonly summary = signal<string | null>(null);
  readonly token = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group(
    {
      newPassword: ['', [Validators.required]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: passwordsMatch },
  );

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      const value = params.get('token');
      this.token.set(value !== null && value.length > 0 ? value : null);
    });
  }

  /**
   * Counts down rather than repeating the rule — "3 characters to go" stays actionable in a way
   * "at least 12 characters" stops being once you start typing.
   */
  countdown(): string {
    const length = this.form.controls.newPassword.value.length;
    if (length === 0) return `At least ${MINIMUM_PASSWORD_LENGTH} characters.`;
    if (length < MINIMUM_PASSWORD_LENGTH) {
      return `${MINIMUM_PASSWORD_LENGTH - length} characters to go.`;
    }
    return 'Long enough.';
  }

  controlError(name: 'newPassword' | 'confirmPassword'): string | null {
    const c = this.form.controls[name];
    if (!c.touched) return null;
    if (c.hasError('required')) return 'This is required.';
    return (c.errors?.['server'] as string | undefined) ?? null;
  }

  confirmError(): string | null {
    if (!this.form.controls.confirmPassword.touched) return null;
    if (this.form.hasError('mismatch')) return 'The two passwords do not match.';
    return this.controlError('confirmPassword');
  }

  submit(): void {
    this.summary.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const token = this.token();
    if (token === null) return;

    this.busy.set(true);

    this.api
      .completePasswordReset({ token, newPassword: this.form.getRawValue().newPassword })
      .subscribe({
        next: () => {
          this.busy.set(false);
          // Completion bumps the security stamp [DEC-117], so every outstanding access and
          // refresh token for this account is already dead. Sign-in is the only honest next
          // screen — sending them into the portal would 401 on the first request.
          void this.router.navigate(['/sign-in']);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.summary.set(applyProblemDetails(this.form, error));
        },
      });
  }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- password-page`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/features/sign-in
git commit -m "feat(customer-portal): request a password reset and set a new password"
```

---
