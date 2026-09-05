# Customer Portal & Close-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the seven tenant-scoped customer API endpoints, generate and commit
`@peakpower-nl/api-client-customer`, build the Angular customer portal — onboarding wizard,
sign-in, password reset, connections, naming, EAN-pool claiming, company profile — seed the
demo data, prove the whole path with one Playwright run, and open the specification pull
request that closes slice 1.

**Architecture:** Seven endpoints are added to the existing `PeakPower.Api.Customer` host built
by plan 5; every one of them reads identity only through `ICustomerContext`, is isolated by the
EF Core global query filter plus PostgreSQL row-level security, and returns 404 rather than 403
across tenants. The host emits `artifacts/openapi/customer.json` at build, from which the
committed npm workspace package `@peakpower-nl/api-client-customer` is generated. The Angular
`apps/customer-portal` application consumes that client through an HTTP interceptor that holds
the access token in an in-memory signal — never `localStorage`, never `sessionStorage` — and
refreshes exactly once against the HttpOnly `pp_refresh` cookie before redirecting to sign-in.

**Tech Stack:** .NET SDK 10.0.400 · EF Core 10.x · PostgreSQL 17 · Aspire 13.5.3 ·
Angular 22 (`@angular/cli` 22.1.6) · Node 24.15.0 / npm 11.12.1 · Vitest 4.1.11 ·
Playwright 1.56.1 · openapi-typescript 7.13.0 · xUnit + Shouldly 4.3.0 ·
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

`git init` in both. Both are now published privately under the **`peakpower-nl`** GitHub
organisation and pushed (`[OQ-100]` resolved 2026-08-27); `origin` is expected and
`tools/verify-repositories.sh` fails if it is missing or points elsewhere. **No CI, no
package registry, no deployment** in slice 1 — the code is published, nothing is built or
run remotely.
Commit locally and often.

### Naming

- .NET namespace root `PeakPower.` — e.g. `PeakPower.Domain.Customers`
- npm scope `@peakpower-nl/` — matches the GitHub organisation, which now exists `[OQ-100]` **resolved**
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
    public string? ExternalSubjectId { get; }    // DEAD COLUMN. Was reserved for Entra, which
                                                 // [DEC-119] drops. Always null. Drop it in the
                                                 // migration that follows slice 1.
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
├── libs/shared-ui/                     # @peakpower-nl/shared-ui
├── libs/api-client-customer/           # @peakpower-nl/api-client-customer  (generated, committed)
└── libs/api-client-employee/           # @peakpower-nl/api-client-employee  (generated, committed)
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
| Domain / Application unit | xUnit + **Shouldly 4.3.0**|
| Persistence & integration | Testcontainers, real PostgreSQL 17 |
| Architecture | NetArchTest (facts 1-3, 5) and Mono.Cecil IL scanning (facts 4 and 6) |
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
| `Shouldly` | **4.3.0** | ⚠ **not FluentAssertions** — see `[DEC-118]` |
| `Mono.Cecil` | **0.11.6** | IL scanning for architecture facts 3-6 |

> ⚠ **Assert with Shouldly, never FluentAssertions** `[DEC-118]`. FluentAssertions 8.x ships an
> Xceed Community License "for Non-Commercial Use" and PeakPower is commercial; 7.2.0 is the
> last Apache-2.0 release and the end of that line. Shouldly 4.3.0 is Apache-2.0 and maintained.
> `verify-build-settings.sh` fails the build if FluentAssertions reappears.

**Architecture facts that must exist from week 1:**

1. `PeakPower.Domain` references no other project — NetArchTest, plan 1
2. `PeakPower.Application` references only `PeakPower.Domain` — NetArchTest, plan 1
3. `PeakPower.Ingestion` (when it exists) references no `Brp.*` adapter — Cecil, plan 1
4. No type calls `IgnoreQueryFilters()` — Cecil, plan 2
5. No type outside `PeakPower.Infrastructure.Time` calls `DateTime.Now`, `DateTime.UtcNow`,
   `DateTime.Today`, `DateTimeOffset.Now` or `DateTimeOffset.UtcNow` — Cecil, plan 1
6. No type outside `PeakPower.Infrastructure.Web` uses `IHttpContextAccessor` or reads a claim
   off `ClaimsPrincipal` / `ClaimsIdentity` — Cecil, plan 2

---

## Preconditions before Task 1

This plan is last in the sequence. Check all five before starting:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
test -f artifacts/openapi/employee.json          && echo "plan 2 OK"
test -f src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs        && echo "plan 5 auth OK"
test -f src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingEndpoints.cs && echo "plan 5 onboarding OK"
cd /Users/thinhhuynh/PeakPower/peakpower-web
test -f libs/shared-ui/src/public-api.ts              && echo "plan 3 OK"
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
    public bool IsActive { get; }
    public static Result<Brp> Create(string code, string name, bool isActive);
}
```

Plan 1 owns every aggregate factory and mutator this plan calls — shared contract §5.1 is the
one place they are declared. This plan only calls them, and every call unwraps the
`Result<T>` they return:

```csharp
namespace PeakPower.Domain.Customers;
static Result<Customer> Customer.Create(
    string legalName, string? tradeName, KvkNumber kvkNumber, string? vatNumber,
    Address billingAddress, Address? visitingAddress, ContactPerson primaryContact,
    string? internalReference, string locale);
Result<Customer> Customer.ChangeStatus(CustomerStatus status);

static Result<CustomerAccount> CustomerAccount.Create(
    Guid customerId, string username, string firstName, string lastName,
    string? jobTitle, string email, string? phone, AccountStatus status, bool isAdmin);
void CustomerAccount.SetPassword(string passwordHash);          // bumps SecurityStamp

static Result<MeteringPoint> MeteringPoint.Attach(
    Guid customerId, EanCode ean, Guid brpId,
    ProductionExpectation productionExpectation, ProductionExpectationSource? expectationSource,
    string? name, string? description, string? gridOperator, decimal? capacityKw,
    Address? address, DateOnly validFrom);
Result<MeteringPoint> MeteringPoint.EndDate(DateOnly validTo);
Result<MeteringPoint> MeteringPoint.Rename(string? name, string? description);
Result<MeteringPoint> MeteringPoint.UpdateDetails(
    Guid brpId, ProductionExpectation productionExpectation,
    ProductionExpectationSource? expectationSource, string? gridOperator,
    decimal? capacityKw, Address? address);
```

`MeteringPoint.Attach` takes no `Commodity` — `[DEC-68]` makes `ELECTRICITY` the only value, so
the aggregate sets it — and no `ValidTo`; ending a connection is `EndDate`.

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

Plan 2 adds no members to plan 1's aggregates. Every factory and mutator this plan calls is
declared once by plan 1, under shared contract §5.1, and reproduced above.

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

namespace PeakPower.Infrastructure.Identity;
public sealed class Argon2idPasswordHasher : IPasswordHasher;   // parameterless ctor

namespace PeakPower.Integration.Tests;
public sealed class CustomerApiFactory : WebApplicationFactory<CustomerApiEntryPoint>, IAsyncLifetime
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

### From plan 3 (`@peakpower-nl/shared-ui`)

```ts
export type PpTone =
  | 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'critical';
export type PpButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accept';

export interface PpNavItem {
  routeKey: string;          // the specification's route key, never the label
  label: string;             // the design system's label
  path: string | null;       // null renders the item disabled
  dot: string;               // the domain colour, a CSS custom-property reference
  disabledReason?: string;   // rendered verbatim; a disabled item MUST carry one
}
export interface PpNavSection { label: string; items: PpNavItem[]; }

// selector: 'pp-app-shell'  — navigation is routerLink on each item's path; no navigate output
export class PpAppShell {
  readonly sections = input.required<PpNavSection[]>();
  readonly activeRouteKey = input.required<string>();
  readonly productName = input.required<string>();
  readonly crumb = input<string>();                 // crumb OR subtitle, never both
  readonly subtitle = input<string>();
}
// selector: 'pp-card'
export class PpCard {
  readonly heading = input<string>();               // heading, NOT title
  readonly subtitle = input<string>();
}
// selector: 'pp-stat-card'
export class PpStatCard {
  readonly label = input.required<string>();        // rendered ALL CAPS
  readonly value = input.required<string>();
  readonly sublabel = input<string>();
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
// selector: 'pp-banner'   — the compact in-page notice; pp-ds-banner is a DIFFERENT component
export class PpBanner {
  readonly tone = input<PpTone>('info');
  readonly heading = input<string>();
}
// selector: 'pp-grid-table'  — display:grid divs, never <table>
export class PpGridTable {
  readonly columns = input.required<string>();      // a grid-template-columns string
  readonly density = input<'default' | 'dense'>('default');
}
export class PpGridHead {}   // selector: '[ppGridHead]'
export class PpGridRow {}    // selector: '[ppGridRow]'
// selector: 'pp-search-input'
export class PpSearchInput {
  readonly placeholder = input<string>('Search');
  readonly value = model<string>('');
}
```

Shared contract §10.1 is the normative version of this list; plan 3 declares it in
`libs/shared-ui/src/public-api.ts`, and this plan only binds it. Nothing here is extended: a
field this portal needs and the library does not have is a change to plan 3, not a local
widening.

Plan 3's token stylesheet lives at `libs/shared-ui/src/styles/tokens.css` and is importable
from a plain CSS file. The page ground is `--pp-canvas`, defined by plan 3 in
`libs/shared-ui/src/styles/colors.css`. **`pp-grid-table` is never rendered with zero rows** — every table in
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
| `src/Infrastructure/PeakPower.Persistence/Migrations/*_EanPool.cs` | Migration 4 — `metering.ean_pool` plus its grants |
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
| `tests/PeakPower.Integration.Tests/Tenancy/TenancyFixture.cs` | `SampleBodies` delegates to `CustomerSampleBodies` |

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
| `tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleBodies.cs` | A valid body for every mutating tenant-scoped customer route |
| `tests/PeakPower.Integration.Tests/Tenancy/CustomerApiRouteTableTests.cs` | Plan 2's route-table harness, run against the customer host |

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
| `tsconfig.json` | *(modify)* the `@peakpower-nl/api-client-customer` path mapping |
| `tools/openapi-clients.mjs` | *(modify)* register the customer client in `CLIENTS` |
| `playwright.config.ts` | The E2E runner configuration |
| `e2e/onboard-and-rename.spec.ts` | The one slice-1 path |
| `e2e/fixtures/api.ts` | Direct-API helpers the E2E needs (the sign-code peek) |

### `peakpowerspecs` — modified by Task 29

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

Commands are run from `/Users/thinhhuynh/PeakPower/peakpower-platform` for tasks 1–10 and 27,
from `/Users/thinhhuynh/PeakPower/peakpower-web` for tasks 11–26 and 28, and from
`/Users/thinhhuynh/PeakPower/peakpowerspecs` for task 29. Each task says which.

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
using Shouldly;
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
            .ShouldBe(ConnectionStatus.Pending);
    }

    [Fact]
    public void A_connection_starting_today_is_active()
    {
        ConnectionStatusRules.For(Today, Today, null).ShouldBe(ConnectionStatus.Active);
    }

    [Fact]
    public void An_open_ended_connection_is_active()
    {
        ConnectionStatusRules.For(Today, new DateOnly(2024, 1, 1), null)
            .ShouldBe(ConnectionStatus.Active);
    }

    [Fact]
    public void A_connection_ending_far_away_is_still_plain_active()
    {
        // 2027-06-30 is more than 90 days out, so it is not yet worth an amber badge.
        ConnectionStatusRules.For(Today, new DateOnly(2024, 1, 1), new DateOnly(2027, 6, 30))
            .ShouldBe(ConnectionStatus.Active);
    }

    [Fact]
    public void A_connection_ending_inside_ninety_days_is_ending()
    {
        ConnectionStatusRules.For(Today, new DateOnly(2024, 1, 1), new DateOnly(2026, 10, 1))
            .ShouldBe(ConnectionStatus.Ending);
    }

    [Fact]
    public void The_ninety_day_boundary_is_inclusive()
    {
        var boundary = Today.AddDays(ConnectionStatusRules.EndingWithinDays);

        ConnectionStatusRules.For(Today, new DateOnly(2024, 1, 1), boundary)
            .ShouldBe(ConnectionStatus.Ending);
        ConnectionStatusRules.For(Today, new DateOnly(2024, 1, 1), boundary.AddDays(1))
            .ShouldBe(ConnectionStatus.Active);
    }

    [Fact]
    public void The_validity_window_is_half_open_so_valid_to_itself_is_already_ended()
    {
        // [valid_from, valid_to) — the customer holds it through the day BEFORE valid_to.
        ConnectionStatusRules.For(Today, new DateOnly(2024, 1, 1), Today)
            .ShouldBe(ConnectionStatus.Ended);
        ConnectionStatusRules.For(Today, new DateOnly(2024, 1, 1), Today.AddDays(1))
            .ShouldBe(ConnectionStatus.Ending);
    }

    [Fact]
    public void A_connection_whose_period_has_passed_is_ended()
    {
        ConnectionStatusRules.For(Today, new DateOnly(2024, 1, 1), new DateOnly(2025, 12, 31))
            .ShouldBe(ConnectionStatus.Ended);
    }

    [Fact]
    public void Ended_beats_pending_for_a_window_entirely_in_the_past()
    {
        ConnectionStatusRules.For(Today, new DateOnly(2020, 1, 1), new DateOnly(2020, 6, 1))
            .ShouldBe(ConnectionStatus.Ended);
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
using Shouldly;
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
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

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

        profile.ShouldNotBeNull();
        profile!.LegalName.ShouldBe("Vandersteen Koeling B.V.");
        profile.KvkNumber.ShouldBe("34215678");
        profile.Status.ShouldBe("ACTIVE");
        profile.Locale.ShouldBe("nl-NL");
        profile.BillingAddress.Country.ShouldBe("NL");
    }

    [Fact]
    public async Task The_company_endpoint_takes_no_route_parameter_at_all()
    {
        // [F13] business rule 2: a customer identifier read from a route, query, body or
        // header for authorisation is a defect. There is nothing here to tamper with.
        var client = await SignedInAsync("Kramer Logistics B.V.", "68812340");

        var response = await client.GetAsync("/api/v1/company/00000000-0000-0000-0000-000000000001");

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task An_anonymous_caller_gets_401()
    {
        var client = factory.CreateAnonymousClient();

        var response = await client.GetAsync("/api/v1/company");

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task The_accounts_endpoint_lists_only_this_companys_own_people()
    {
        var mine = await SignedInAsync("Van Dijk Glastuinbouw", "70012399");
        await SignedInAsync("Meijer Koelhuizen", "61234567");   // a second company exists

        var accounts = await mine.GetFromJsonAsync<CompanyAccountsResponse>(
            "/api/v1/company/accounts");

        accounts.ShouldNotBeNull();
        accounts!.Items.Count().ShouldBe(1);
        accounts.Items[0].Status.ShouldBe("ACTIVE");
    }

    [Fact]
    public async Task The_account_list_never_carries_a_password_hash_or_a_security_stamp()
    {
        var client = await SignedInAsync("Hoekstra Staal B.V.", "65543210");

        var raw = await client.GetStringAsync("/api/v1/company/accounts");

        raw.ShouldNotContain("passwordHash", Case.Insensitive);
        raw.ShouldNotContain("securityStamp", Case.Insensitive);
        raw.ShouldNotContain("argon2", Case.Insensitive);
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
/// switch cannot compile if a member is added and left unhandled. The spellings are shared
/// contract section 5.2's, the same ones the hosts' shared <c>JsonStringEnumConverter</c>
/// produces — these DTOs carry <c>string</c>, so the converter never sees them, and the two
/// must not be allowed to drift apart.
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
using Shouldly;
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
        // metering.brp is created empty by migration 1 and filled by DemoDataSeeder, which
        // only runs in Development — so an integration database has no BRP until something
        // writes one. Code and name are the ones shared contract 5.1 fixes verbatim.
        var brp = await db.Brps.OrderBy(b => b.Code).FirstOrDefaultAsync();
        if (brp is null)
        {
            brp = Brp.Create("PVNED", "PVNed B.V.", isActive: true).Value;
            db.Brps.Add(brp);
            await db.SaveChangesAsync();
        }

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
            validFrom: validFrom).Value;

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

        list.ShouldNotBeNull();
        list!.Items.ShouldBeEmpty();
        list.Total.ShouldBe(0);
    }

    [Fact]
    public async Task The_list_carries_the_display_label_the_grouped_ean_and_the_status()
    {
        var (client, customerId) = await SignedInAsync("Vandersteen Koeling B.V.", "34215678");
        await AttachAsync(customerId, "871687100000000011", "Rotterdam DC",
            "Data centre — 3 halls", new DateOnly(2024, 1, 1));
        await AttachAsync(customerId, "871687100000000061", null, null, new DateOnly(2024, 1, 1));

        var list = await client.GetFromJsonAsync<ConnectionListResponse>("/api/v1/metering-points");

        list!.Total.ShouldBe(2);

        var named = list.Items.Single(i => i.Ean == "871687100000000011");
        named.DisplayLabel.ShouldBe("Rotterdam DC");
        named.EanDisplay.ShouldBe("8716 8710 0000 0000 11");
        named.Status.ShouldBe("ACTIVE");
        named.Commodity.ShouldBe("ELECTRICITY");
        named.City.ShouldBe("Rotterdam");

        // [F01-R31]: with no friendly name the grouped EAN IS the label.
        var unnamed = list.Items.Single(i => i.Ean == "871687100000000061");
        unnamed.DisplayLabel.ShouldBe("8716 8710 0000 0000 61");
        unnamed.Name.ShouldBeNull();
    }

    [Fact]
    public async Task Last_data_date_is_null_because_ingestion_is_out_of_scope()
    {
        var (client, customerId) = await SignedInAsync("Nolte Chemie", "69988771");
        await AttachAsync(customerId, "871687100000000239", "Delfzijl works", null,
            new DateOnly(2024, 1, 1));

        var list = await client.GetFromJsonAsync<ConnectionListResponse>("/api/v1/metering-points");

        list!.Items.Single().LastDataDate.ShouldBeNull();
    }

    [Fact]
    public async Task A_connection_with_a_near_end_date_reads_as_ending()
    {
        var (client, customerId) = await SignedInAsync("De Groot Papier", "63321098");
        await AttachAsync(customerId, "871687100000000078", "Breda warehouse", null,
            new DateOnly(2024, 1, 1), DateOnly.FromDateTime(DateTime.UtcNow).AddDays(30));

        var list = await client.GetFromJsonAsync<ConnectionListResponse>("/api/v1/metering-points");

        list!.Items.Single().Status.ShouldBe("ENDING");
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

        list!.Items.ShouldHaveSingleItem().Ean.ShouldBe(expected);
    }

    [Fact]
    public async Task A_search_that_matches_nothing_returns_an_empty_list()
    {
        var (client, customerId) = await SignedInAsync($"Nothing {Guid.NewGuid():N}", "22222222");
        await AttachAsync(customerId, "871687100000000155", "Rotterdam Waalhaven", null,
            new DateOnly(2024, 1, 1));

        var list = await client.GetFromJsonAsync<ConnectionListResponse>(
            "/api/v1/metering-points?q=groningen");

        list!.Items.ShouldBeEmpty();
        list.Total.ShouldBe(0);
    }

    [Fact]
    public async Task One_companys_connections_are_invisible_to_another()
    {
        var (_, aId) = await SignedInAsync($"Company A {Guid.NewGuid():N}", "33333333");
        await AttachAsync(aId, "871687100000000163", "A's Botlek site", null, new DateOnly(2024, 1, 1));

        var (bClient, _) = await SignedInAsync($"Company B {Guid.NewGuid():N}", "44444444");

        var list = await bClient.GetFromJsonAsync<ConnectionListResponse>("/api/v1/metering-points");

        list!.Items.ShouldBeEmpty("company B must not see company A's connections");
    }

    [Fact]
    public async Task An_anonymous_caller_gets_401()
    {
        var client = factory.CreateAnonymousClient();

        (await client.GetAsync("/api/v1/metering-points")).StatusCode
            .ShouldBe(HttpStatusCode.Unauthorized);
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
using Shouldly;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
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
        // metering.brp is created empty by migration 1 and filled by DemoDataSeeder, which
        // only runs in Development — so an integration database has no BRP until something
        // writes one. Code and name are the ones shared contract 5.1 fixes verbatim.
        var brp = await db.Brps.OrderBy(b => b.Code).FirstOrDefaultAsync();
        if (brp is null)
        {
            brp = Brp.Create("PVNED", "PVNed B.V.", isActive: true).Value;
            db.Brps.Add(brp);
            await db.SaveChangesAsync();
        }

        var point = MeteringPoint.Attach(
            customerId, EanCode.Create(ean).Value, brp.Id,
            ProductionExpectation.Expected, ProductionExpectationSource.CustomerDeclared,
            name, "Freezer hall + dock 3 compressors", "Enexis", 2500m,
            new Address("Ceresstraat", "14", null, "5928LA", "Venlo", "NL"),
            new DateOnly(2024, 1, 1)).Value;

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

        detail.ShouldNotBeNull();
        detail!.DisplayLabel.ShouldBe("Venlo cold store");
        detail.EanDisplay.ShouldBe("8716 8710 0000 0000 27");
        detail.BrpName.ShouldNotBeNullOrWhiteSpace();
        detail.BrpId.ShouldNotBeEmpty();
        detail.ProductionExpectation.ShouldBe("EXPECTED");
        detail.ExpectationSource.ShouldBe("CUSTOMER_DECLARED");
        detail.Address!.PostalCode.ShouldBe("5928LA");
        detail.CapacityKw.ShouldBe(2500m);
        detail.LastDataDate.ShouldBeNull();
    }

    [Fact]
    public async Task Another_companys_connection_is_404_and_never_403()
    {
        var (_, aId) = await SignedInAsync($"Owner {Guid.NewGuid():N}", "66666666");
        var theirs = await AttachAsync(aId, "871687100000000171", "Hornweg");

        var (bClient, _) = await SignedInAsync($"Stranger {Guid.NewGuid():N}", "77777777");

        var response = await bClient.GetAsync($"/api/v1/metering-points/{theirs}");

        // 403 would confirm the row exists. [F13-R19] says 404.
        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        response.StatusCode.ShouldNotBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task An_id_that_exists_nowhere_is_also_404()
    {
        var (client, _) = await SignedInAsync($"Missing {Guid.NewGuid():N}", "88888888");

        var response = await client.GetAsync($"/api/v1/metering-points/{Guid.NewGuid()}");

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_not_found_answer_is_rfc_7807_problem_json()
    {
        var (client, _) = await SignedInAsync($"Problem {Guid.NewGuid():N}", "99999999");

        var response = await client.GetAsync($"/api/v1/metering-points/{Guid.NewGuid()}");

        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
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
the route name follows. Task 29 files that as a correction — the route has no consumers yet, so
renaming is free now and awkward later.

**Clearing is a first-class operation.** Sending `{"name": null}` or `{"name": ""}` removes the
name and the label falls back to the grouped EAN. A rename endpoint that can only ever set a
value traps a customer with a typo they made once.

**Files:**
- Modify: `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs`
- Test: `tests/PeakPower.Integration.Tests/Portal/ConnectionNamingTests.cs`

**Interfaces:**
- Consumes: `Result<MeteringPoint> MeteringPoint.Rename(string? name, string? description)` —
  shared contract §5.1's naming mutator, which is `Rename` and not `UpdateDetails`; the latter
  carries the BRP, the expectation and the technical fields and has no name parameter at all.
  Also `ApiResults.InvalidRequest(string property, string error)` and `ApiResults.NotFound()`.
- Produces: `PATCH /api/v1/metering-points/{id:guid}/naming`, body `RenameConnectionRequest`
  → 200 `ConnectionDetailDto` · 400 problem+json · 404

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Portal/ConnectionNamingTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Shouldly;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
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
        // metering.brp is created empty by migration 1 and filled by DemoDataSeeder, which
        // only runs in Development — so an integration database has no BRP until something
        // writes one. Code and name are the ones shared contract 5.1 fixes verbatim.
        var brp = await db.Brps.OrderBy(b => b.Code).FirstOrDefaultAsync();
        if (brp is null)
        {
            brp = Brp.Create("PVNED", "PVNed B.V.", isActive: true).Value;
            db.Brps.Add(brp);
            await db.SaveChangesAsync();
        }

        var point = MeteringPoint.Attach(
            customerId, EanCode.Create(ean).Value, brp.Id,
            ProductionExpectation.Unknown, null, name, null, "Liander", 900m, null,
            new DateOnly(2024, 1, 1)).Value;

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

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var detail = await response.Content.ReadFromJsonAsync<ConnectionDetailDto>();
        detail!.Name.ShouldBe("Kabelweg depot");
        detail.Description.ShouldBe("Roof array and two docks");
        detail.DisplayLabel.ShouldBe("Kabelweg depot");
    }

    [Fact]
    public async Task Clearing_the_name_restores_the_grouped_ean_as_the_label()
    {
        var (client, customerId) = await SignedInAsync("10000002");
        var id = await AttachAsync(customerId, "871687100000000197", "Croy site");

        var response = await client.PatchAsJsonAsync(
            $"/api/v1/metering-points/{id}/naming", new RenameConnectionRequest(null, null));

        var detail = await response.Content.ReadFromJsonAsync<ConnectionDetailDto>();
        detail!.Name.ShouldBeNull();
        detail.DisplayLabel.ShouldBe("8716 8710 0000 0001 97");
    }

    [Fact]
    public async Task An_empty_string_clears_rather_than_storing_a_blank_name()
    {
        var (client, customerId) = await SignedInAsync("10000003");
        var id = await AttachAsync(customerId, "871687100000000213", "Vossenberg");

        var response = await client.PatchAsJsonAsync(
            $"/api/v1/metering-points/{id}/naming", new RenameConnectionRequest("   ", ""));

        var detail = await response.Content.ReadFromJsonAsync<ConnectionDetailDto>();
        detail!.Name.ShouldBeNull();
        detail.Description.ShouldBeNull();
    }

    [Fact]
    public async Task A_name_of_exactly_eighty_characters_is_accepted()
    {
        var (client, customerId) = await SignedInAsync("10000004");
        var id = await AttachAsync(customerId, "871687100000000221", null);

        var response = await client.PatchAsJsonAsync(
            $"/api/v1/metering-points/{id}/naming",
            new RenameConnectionRequest(new string('x', 80), null));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task A_name_of_eighty_one_characters_is_rejected_with_a_named_field()
    {
        var (client, customerId) = await SignedInAsync("10000005");
        var id = await AttachAsync(customerId, "871687100000000247", null);

        var response = await client.PatchAsJsonAsync(
            $"/api/v1/metering-points/{id}/naming",
            new RenameConnectionRequest(new string('x', 81), null));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
        (await response.Content.ReadAsStringAsync()).ShouldContain("name");
    }

    [Fact]
    public async Task A_description_of_five_hundred_and_one_characters_is_rejected()
    {
        var (client, customerId) = await SignedInAsync("10000006");
        var id = await AttachAsync(customerId, "871687100000000254", null);

        var response = await client.PatchAsJsonAsync(
            $"/api/v1/metering-points/{id}/naming",
            new RenameConnectionRequest(null, new string('y', 501)));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).ShouldContain("description");
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

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);

        await using var db = factory.CreateOwnerDbContext();
        var untouched = await db.MeteringPoints.SingleAsync(p => p.Id == theirs);
        untouched.Name.ShouldBe("Westervoortsedijk");
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

                // Rename is the naming mutator; UpdateDetails carries the BRP and the
                // technical fields and would need every one of them restated to change a name.
                // It re-checks the two limits, so the endpoint's checks above exist only to
                // name the offending property in the 400.
                var renamed = point.Rename(name, description);
                if (!renamed.IsSuccess)
                {
                    return ApiResults.InvalidRequest("name", renamed.Error);
                }

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

### Task 6: The shared EAN pool — the aggregate, migration 4, and `GET /ean-pool`

`[DEC-113]` lets a customer claim a metering point themselves rather than waiting for a
PeakPower employee to attach one, which amends `[F01-R23]`. The demo already works this way:
both portals draw from one pool of grid connections that nobody has claimed yet, and a claim
removes the entry for everyone.

**The pool is not tenant data** (convention C2). It sits in the `metering` schema beside
`metering.brp` as shared reference data: no row-level-security policy, `SELECT` and `UPDATE`
granted to `app_customer_role`. Nothing leaks, because the endpoint only ever returns
**unclaimed** rows and the DTO carries no claimant.

Slice 1 has migration 1 `InitialSchema` (plan 1), migration 2 `TenancyRowLevelSecurity`
(plan 2, which creates the `app_customer_role` and `app_employee_role` roles) and migration 3
`AuthAndOnboarding` (plan 5). This is **migration 4, `EanPool`**.

**Files:**
- Create: `src/Core/PeakPower.Domain/Metering/EanPoolEntry.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/Configurations/EanPoolEntryConfiguration.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/Migrations/*_EanPool.cs` *(scaffolded)*
- Modify: `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs`
- Create: `src/Hosts/PeakPower.Api.Customer/Portal/EanPoolEndpoints.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Program.cs`
- Test: `tests/PeakPower.Domain.Tests/Metering/EanPoolEntryTests.cs`
- Test: `tests/PeakPower.Integration.Tests/Portal/EanPoolTests.cs`

**Interfaces:**
- Consumes: `EanCode`, `Result<T>`, `Address`, `Commodity`; `AnonymousEndpoint`/`TenantScoped`
  conventions; the `app_customer_role` and `app_employee_role` roles created by plan 2's
  migration 2, `TenancyRowLevelSecurity` — the grants below extend those roles.
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
using Shouldly;
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

        entry.IsClaimed.ShouldBeFalse();
        entry.ClaimedAt.ShouldBeNull();
        entry.ClaimedByCustomerId.ShouldBeNull();
    }

    [Fact]
    public void Claiming_records_who_took_it_and_when()
    {
        var entry = Unclaimed();
        var customerId = Guid.NewGuid();

        var result = entry.Claim(customerId, Now);

        result.IsSuccess.ShouldBeTrue();
        entry.IsClaimed.ShouldBeTrue();
        entry.ClaimedByCustomerId.ShouldBe(customerId);
        entry.ClaimedAt.ShouldBe(Now);
    }

    [Fact]
    public void A_second_claim_fails_and_changes_nothing()
    {
        var entry = Unclaimed();
        var first = Guid.NewGuid();
        entry.Claim(first, Now);

        var result = entry.Claim(Guid.NewGuid(), Now.AddMinutes(1));

        result.IsSuccess.ShouldBeFalse();
        result.Error.ShouldBe("That connection has already been claimed.");
        entry.ClaimedByCustomerId.ShouldBe(first, "the first claim stands");
        entry.ClaimedAt.ShouldBe(Now);
    }

    [Fact]
    public void Re_claiming_by_the_same_customer_still_fails()
    {
        // Idempotence would be wrong here: a second claim would create a SECOND metering point
        // for one EAN, which the exclusion constraint would then reject at a confusing depth.
        var entry = Unclaimed();
        var customerId = Guid.NewGuid();
        entry.Claim(customerId, Now);

        entry.Claim(customerId, Now.AddMinutes(1)).IsSuccess.ShouldBeFalse();
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

- [ ] **Step 5: Map it and scaffold migration 4**

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
dotnet ef migrations add EanPool \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator
```

Then open the generated `*_EanPool.cs` and append the grants to the end of `Up`:

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
using Shouldly;
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

        var entry = pool!.Items.ShouldHaveSingleItem();
        entry.Ean.ShouldBe("871687100000000122");
        entry.EanDisplay.ShouldBe("8716 8710 0000 0001 22");
        entry.Commodity.ShouldBe("ELECTRICITY");
        entry.GridOperator.ShouldBe("Enexis");
        entry.Address!.City.ShouldBe("VENLO");
    }

    [Fact]
    public async Task Search_matches_the_ean_the_city_and_the_street()
    {
        var client = await SignedInAsync("20000002");
        await AddToPoolAsync("871687100000000320", "SPIJKENISSE");

        (await client.GetFromJsonAsync<EanPoolResponse>("/api/v1/ean-pool?q=spijkenisse"))!
            .Items.Count(i => i.Ean == "871687100000000320").ShouldBe(1);

        (await client.GetFromJsonAsync<EanPoolResponse>("/api/v1/ean-pool?q=0320"))!
            .Items.Count(i => i.Ean == "871687100000000320").ShouldBe(1);

        (await client.GetFromJsonAsync<EanPoolResponse>("/api/v1/ean-pool?q=Ceresstraat"))!
            .Items.ShouldContain(i => i.Ean == "871687100000000320");
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

        pool!.Items.ShouldBeEmpty();
    }

    [Fact]
    public async Task The_pool_never_says_who_claimed_anything()
    {
        var client = await SignedInAsync("20000004");
        await AddToPoolAsync("871687100000000304", "MAASTRICHT");

        var raw = await client.GetStringAsync("/api/v1/ean-pool?q=maastricht");

        raw.ShouldNotContain("claimedBy", Case.Insensitive);
        raw.ShouldNotContain("claimedAt", Case.Insensitive);
    }

    [Fact]
    public async Task An_anonymous_caller_gets_401()
    {
        var client = factory.CreateAnonymousClient();

        (await client.GetAsync("/api/v1/ean-pool")).StatusCode
            .ShouldBe(HttpStatusCode.Unauthorized);
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
using Shouldly;
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

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        response.Headers.Location.ShouldNotBeNull();

        var detail = await response.Content.ReadFromJsonAsync<ConnectionDetailDto>();
        detail!.Ean.ShouldBe("871687100000000155");
        detail.Name.ShouldBe("Waalhaven yard");
        detail.GridOperator.ShouldBe("Stedin");
        detail.CapacityKw.ShouldBe(3200m);
        detail.Address!.City.ShouldBe("ROTTERDAM");
        detail.Status.ShouldBe("ACTIVE");
        detail.ProductionExpectation.ShouldBe("EXPECTED");

        await using var db = factory.CreateOwnerDbContext();
        var stored = await db.MeteringPoints.SingleAsync(p => p.Id == detail.Id);
        stored.CustomerId.ShouldBe(customerId);
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
        detail!.ExpectationSource.ShouldBe("CUSTOMER_DECLARED");
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
        pool!.Items.ShouldBeEmpty();
    }

    [Fact]
    public async Task A_second_claim_on_the_same_ean_is_409_and_creates_nothing()
    {
        var (first, _) = await SignedInAsync("30000004");
        var (second, _) = await SignedInAsync("30000005");
        await AddToPoolAsync("871687100000000296");

        var request = new ClaimConnectionRequest("871687100000000296", "UNKNOWN", null, null);
        (await first.PostAsJsonAsync("/api/v1/metering-points", request)).StatusCode
            .ShouldBe(HttpStatusCode.Created);

        var response = await second.PostAsJsonAsync("/api/v1/metering-points", request);

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");

        await using var db = factory.CreateOwnerDbContext();
        (await db.MeteringPoints.CountAsync(p => p.Ean == EanCode.Create("871687100000000296").Value))
            .ShouldBe(1);
    }

    [Fact]
    public async Task An_ean_that_is_not_in_the_pool_is_404()
    {
        var (client, _) = await SignedInAsync("30000006");

        var response = await client.PostAsJsonAsync(
            "/api/v1/metering-points",
            new ClaimConnectionRequest("871687199999999999", "UNKNOWN", null, null));

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_malformed_ean_is_400_naming_the_field()
    {
        var (client, _) = await SignedInAsync("30000007");

        var response = await client.PostAsJsonAsync(
            "/api/v1/metering-points", new ClaimConnectionRequest("12345", "UNKNOWN", null, null));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).ShouldContain("ean");
    }

    [Fact]
    public async Task An_unrecognised_production_expectation_is_400_naming_the_field()
    {
        var (client, _) = await SignedInAsync("30000008");
        await AddToPoolAsync("871687100000000270");

        var response = await client.PostAsJsonAsync(
            "/api/v1/metering-points",
            new ClaimConnectionRequest("871687100000000270", "MAYBE", null, null));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).ShouldContain("productionExpectation");

        // Nothing was taken out of the pool on the way to rejecting the request.
        var pool = await client.GetFromJsonAsync<EanPoolResponse>(
            "/api/v1/ean-pool?q=871687100000000270");
        pool!.Items.ShouldHaveSingleItem();
    }

    [Fact]
    public async Task A_name_longer_than_eighty_characters_is_rejected_before_anything_is_claimed()
    {
        var (client, _) = await SignedInAsync("30000009");
        await AddToPoolAsync("871687100000000239");

        var response = await client.PostAsJsonAsync(
            "/api/v1/metering-points",
            new ClaimConnectionRequest("871687100000000239", "UNKNOWN", new string('x', 81), null));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var pool = await client.GetFromJsonAsync<EanPoolResponse>(
            "/api/v1/ean-pool?q=871687100000000239");
        pool!.Items.ShouldHaveSingleItem();
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

                var attached = MeteringPoint.Attach(
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

                // Attach validates the name and description lengths, so its failure is the
                // caller's fault and belongs in a 400 rather than an unhandled exception. The
                // transaction is disposed without a commit, which puts the pool entry back.
                if (!attached.IsSuccess)
                {
                    return ApiResults.InvalidRequest("name", attached.Error);
                }

                var point = attached.Value;

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
Playwright path in Task 28 stops dead at step 9 and design DoD 2 goes unproven.

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
using Shouldly;
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
        started.StatusCode.ShouldBe(HttpStatusCode.Created);
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
        signatories.StatusCode.ShouldBe(HttpStatusCode.Accepted);

        return application.Id;
    }

    [Fact]
    public async Task In_development_the_peek_returns_a_six_digit_code()
    {
        var client = factory.CreateAnonymousClient();
        var id = await ApplicationAwaitingSignatureAsync(client);

        var response = await client.GetAsync($"/api/v1/onboarding/applications/{id}/sign-code");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var peek = await response.Content.ReadFromJsonAsync<SignCodePeek>();
        peek!.Code.ShouldMatch("^[0-9]{6}$");
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

        signed.StatusCode.ShouldBe(HttpStatusCode.OK);
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

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task An_unknown_application_is_404()
    {
        var client = factory.CreateAnonymousClient();

        (await client.GetAsync($"/api/v1/onboarding/applications/{Guid.NewGuid()}/sign-code"))
            .StatusCode.ShouldBe(HttpStatusCode.NotFound);
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

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
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
    : WebApplicationFactory<CustomerApiEntryPoint>
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
  committed, and Task 11 generates `@peakpower-nl/api-client-customer` from it.
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
- Produces: `artifacts/openapi/customer.json`, consumed by Task 11's `npm run generate:clients`.

- [ ] **Step 1: Turn on build-time document generation**

Add to the first `<PropertyGroup>` in
`src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj`:

```xml
    <!-- Emit the OpenAPI document at build. Task 11 generates the typed npm client from it,
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
using Shouldly;
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
        File.Exists(DocumentPath).ShouldBeTrue(
            $"building PeakPower.Api.Customer must write {DocumentPath}; check that "
            + "OpenApiGenerateDocuments is true in the project file");
    }

    [Fact]
    public async Task the_document_never_carries_a_credential()
    {
        var json = await File.ReadAllTextAsync(DocumentPath);

        // Requests carry `password` and `newPassword`; no RESPONSE may. The cheap proxy for
        // that is that these three names appear nowhere at all.
        json.ShouldNotContain("passwordHash", Case.Insensitive);
        json.ShouldNotContain("securityStamp", Case.Insensitive);
        json.ShouldNotContain("argon2", Case.Insensitive);
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

### Task 10: The route-table harness, pointed at the customer API

Plan 2 built the route-table harness — `RouteTable.Enumerate`, `TenancyProbeApp`,
`TenancyFixture.SampleBodies` — and pointed it at its own probe host and at the employee host.
Neither is tenant-scoped in production: the probe is a test-only app, and the employee API is
back-office by design. **The customer API is the one host where tenancy is real, and until this
task nothing enumerates it.**

That gap is the exact failure design §6 set the harness up to prevent: the customer endpoints'
isolation is otherwise covered only by the per-endpoint
`Another_companys_connection_is_404_and_never_403` tests written in Tasks 4, 5 and 7 — a
hand-written list, which is what the design rejected. A customer endpoint added later that
forgets `.TenantScoped(...)` turns nothing red.

It comes after Task 9 on purpose: `customer.json` is frozen by then, so the endpoint set this
task enumerates is the endpoint set the contract snapshot has already agreed to.

**The sample bodies move to one file.** Every mutating tenant-scoped route needs a body that
passes validation, or the probe's request is rejected before it ever reaches the tenancy check
and the 404 assertion proves nothing. Plan 2 left `TenancyFixture.SampleBodies` empty with a
comment saying this plan fills it. Rather than a second copy in a second collection, this task
puts the entries in `CustomerSampleBodies` and has `TenancyFixture.SampleBodies` return it, so
plan 2's `every_tenant_scoped_endpoint_can_actually_be_probed` and this task's tests read the
same dictionary.

**Files:** *(run from `/Users/thinhhuynh/PeakPower/peakpower-platform`)*
- Create: `tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleBodies.cs`
- Create: `tests/PeakPower.Integration.Tests/Tenancy/CustomerApiRouteTableTests.cs`
- Modify: `tests/PeakPower.Integration.Tests/Tenancy/TenancyFixture.cs`

**Interfaces:**
- Consumes, from plan 2: `RouteTable.Enumerate(IServiceProvider) : IReadOnlyList<RouteTableEntry>`,
  `RouteTable.Substitute(string routePattern, Guid id) : string`, `RouteTableEntry`
  (`HttpMethod`, `RoutePattern`, `Classification`, `HasRouteParameter`), `TenancyScope` and
  `TenancyFixture.SampleBodies`. From plan 5: `CustomerApiFactory` with
  `SeedCustomerWithAccountAsync` and `CreateAnonymousClient`.
- Produces:
  - `PeakPower.Integration.Tests.Tenancy.CustomerSampleBodies` — `IReadOnlyDictionary<string, string> All`
  - `PeakPower.Integration.Tests.Tenancy.CustomerApiRouteTableTests`

- [ ] **Step 1: Write the sample-body registry**

Create `tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleBodies.cs`:

```csharp
namespace PeakPower.Integration.Tests.Tenancy;

/// <summary>
/// A valid JSON body for every tenant-scoped customer route with a mutating verb, keyed by the
/// route pattern exactly as ASP.NET registers it.
/// <para>
/// Each body must pass the endpoint's own validation. A body that fails validation is rejected
/// with a 400 before the handler runs, and a 400 is not the 404 the cross-tenant test asserts —
/// the test would then be green for the wrong reason.
/// </para>
/// <para>
/// The EAN below is one of the seeded pool entries, so <c>POST /api/v1/metering-points</c>
/// reaches the claim path rather than failing on an unknown EAN.
/// </para>
/// </summary>
public static class CustomerSampleBodies
{
    public static IReadOnlyDictionary<string, string> All { get; } =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["/api/v1/metering-points/{id:guid}/naming"] =
                """{"name":"Probe","description":"Written by the route-table probe."}""",
            ["/api/v1/metering-points"] =
                """
                {"ean":"871687100000000114","productionExpectation":"NEVER",
                 "name":"Probe","description":"Written by the route-table probe."}
                """,
        };
}
```

Then replace the body of `TenancyFixture.SampleBodies` in
`tests/PeakPower.Integration.Tests/Tenancy/TenancyFixture.cs` with a delegation, so there is one
registry and not two:

```csharp
    /// <summary>
    /// A valid JSON body for every tenant-scoped endpoint with a mutating verb, keyed by route
    /// pattern. The entries live in <see cref="CustomerSampleBodies"/> because the customer API
    /// is the only host with mutating tenant-scoped routes; this property is the seam plan 2's
    /// probe test reads them through.
    /// </summary>
    public IReadOnlyDictionary<string, string> SampleBodies => CustomerSampleBodies.All;
```

- [ ] **Step 2: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Tenancy/CustomerApiRouteTableTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Shouldly;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Infrastructure.Web.Tenancy;
using Xunit;

namespace PeakPower.Integration.Tests.Tenancy;

/// <summary>
/// The route-table test, pointed at the real customer host. Plan 2 runs the same two arms
/// against its probe host and against the employee host; this is the one host where tenancy is
/// not a test fiction, so it is the one that matters most.
/// </summary>
public sealed class CustomerApiRouteTableTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    [Fact]
    public void Every_customer_endpoint_declares_its_tenancy()
    {
        // Touching the factory's client forces the host to build, which is what makes
        // factory.Services — and therefore the endpoint table — available.
        using var _ = factory.CreateAnonymousClient();

        var undeclared = RouteTable.Enumerate(factory.Services)
            .Where(entry => entry.Classification is null)
            .Select(entry => entry.ToString())
            .ToArray();

        undeclared.ShouldBeEmpty(
            "every endpoint on the customer host must call .TenantScoped(kind), " +
            ".BackOffice(reason) or .AnonymousEndpoint(reason) where it is mapped. An endpoint " +
            "that declares nothing is invisible to this test, which is exactly how a " +
            "tenant-scoped route escapes isolation unnoticed.");
    }

    [Fact]
    public void Every_tenant_scoped_customer_endpoint_can_actually_be_probed()
    {
        using var _ = factory.CreateAnonymousClient();

        var problems = new List<string>();

        foreach (var entry in RouteTable.Enumerate(factory.Services))
        {
            if (entry.Classification is not { Scope: TenancyScope.TenantScoped })
            {
                continue;
            }

            if (!string.Equals(entry.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase) &&
                !CustomerSampleBodies.All.ContainsKey(entry.RoutePattern))
            {
                problems.Add(
                    $"{entry} is a tenant-scoped mutating endpoint with no sample request body. " +
                    "Add one to CustomerSampleBodies so the probe reaches the handler.");
            }
        }

        problems.ShouldBeEmpty();
    }

    [Fact]
    public async Task Signed_in_as_company_a_every_one_of_company_bs_objects_returns_404()
    {
        var (clientA, _) = await SignedInAsync("Route table A", "34215678");
        var (_, companyBPointId) = await SignedInWithAConnectionAsync("Route table B", "65543210");

        var failures = new List<string>();

        foreach (var entry in RouteTable.Enumerate(factory.Services))
        {
            if (entry.Classification is not { Scope: TenancyScope.TenantScoped } ||
                !entry.HasRouteParameter)
            {
                continue;
            }

            var url = RouteTable.Substitute(entry.RoutePattern, companyBPointId);

            using var request = new HttpRequestMessage(
                new HttpMethod(entry.HttpMethod), url);

            if (CustomerSampleBodies.All.TryGetValue(entry.RoutePattern, out var body))
            {
                request.Content = new StringContent(
                    body, System.Text.Encoding.UTF8, "application/json");
            }

            using var response = await clientA.SendAsync(request);

            if (response.StatusCode != HttpStatusCode.NotFound)
            {
                failures.Add($"{entry} returned {(int)response.StatusCode}, expected 404");
            }
        }

        failures.ShouldBeEmpty(
            "[F13-R19] a cross-tenant read returns 404, never 403 and never 200 — a 403 would " +
            "confirm the row exists");
    }

    [Fact]
    public async Task Signed_in_as_company_a_no_collection_leaks_a_company_b_identifier()
    {
        var (clientA, _) = await SignedInAsync("Route table leak A", "67554433");
        var (_, companyBPointId) = await SignedInWithAConnectionAsync("Route table leak B", "55555555");

        var failures = new List<string>();

        foreach (var entry in RouteTable.Enumerate(factory.Services))
        {
            if (entry.Classification is not { Scope: TenancyScope.TenantScoped } ||
                entry.HasRouteParameter ||
                !string.Equals(entry.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            using var response = await clientA.GetAsync(entry.RoutePattern);
            var payload = await response.Content.ReadAsStringAsync();

            if (payload.Contains(companyBPointId.ToString(), StringComparison.OrdinalIgnoreCase))
            {
                failures.Add($"{entry} leaked {companyBPointId}");
            }
        }

        failures.ShouldBeEmpty(
            "a collection endpoint that returns another company's identifier has lost its " +
            "query filter, and no per-endpoint test would have noticed");
    }

    private async Task<(HttpClient Client, Guid CustomerId)> SignedInAsync(
        string legalName, string kvk)
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

    /// <summary>
    /// A company with one connection, written straight onto the owner connection. The probe
    /// substitutes the returned id into every route pattern that takes one, so this is the
    /// object company A must not be able to see.
    /// </summary>
    private async Task<(Guid CustomerId, Guid MeteringPointId)> SignedInWithAConnectionAsync(
        string legalName, string kvk)
    {
        var (client, customerId) = await SignedInAsync(legalName, kvk);
        client.Dispose();

        await using var db = factory.CreateOwnerDbContext();

        var brp = await db.Brps.OrderBy(b => b.Code).FirstOrDefaultAsync();
        if (brp is null)
        {
            brp = Brp.Create("PVNED", "PVNed B.V.", isActive: true).Value;
            db.Brps.Add(brp);
            await db.SaveChangesAsync();
        }

        var point = MeteringPoint.Attach(
            customerId,
            EanCode.Create($"8716871{Random.Shared.NextInt64(0, 99_999_999_999L):D11}").Value,
            brp.Id,
            ProductionExpectation.Unknown,
            expectationSource: null,
            name: "Probe target",
            description: null,
            gridOperator: "Stedin",
            capacityKw: 900m,
            address: null,
            validFrom: new DateOnly(2024, 1, 1)).Value;

        db.MeteringPoints.Add(point);
        await db.SaveChangesAsync();

        return (customerId, point.Id);
    }
}
```

- [ ] **Step 3: Run the tests**

There is no production code to write in this task — the endpoints are already mapped and already
declare themselves — so this is the one place in the plan where the first run is expected green.
What it is really testing is Tasks 2-8: any route that forgot `.TenantScoped(...)`, or any
mutating route with no entry in `CustomerSampleBodies`, is named here.

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~CustomerApiRouteTableTests"`
Expected: PASS — 4 tests. Docker must be running. A failure names the offending
`METHOD /route`; go back to the task that mapped it rather than editing the assertion.

Also re-run plan 2's probe test, which now reads the same registry:

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~RouteTableTenancyTests"`
Expected: PASS — 7 tests, unchanged. The probe host maps GET endpoints only, so the two new
sample bodies are inert there.

- [ ] **Step 4: Prove the gate has teeth**

Temporarily delete `.TenantScoped("metering-point")` from the `GET /{id:guid}` mapping in
`ConnectionEndpoints.cs`, then re-run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests \
  --filter "FullyQualifiedName~Every_customer_endpoint_declares_its_tenancy"
```

Expected: FAIL, naming `GET /api/v1/metering-points/{id:guid}`. Restore the line and re-run to
confirm PASS. An endpoint added in a later slice that forgets the call fails the same way.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Tenancy
git commit -m "test(customer-api): drive the route-table tenancy harness off the customer host"
```

---

### Task 11: `@peakpower-nl/api-client-customer`

Everything from here on is in `/Users/thinhhuynh/PeakPower/peakpower-web`.

Slice 1 has no npm registry `[DEC-116]`. The TypeScript derived from `customer.json` is
**committed** into this repository as a workspace package, and `npm run verify:clients` — which
plan 4 already built — is what replaces the registry's drift protection. Two things a reader
new to this repository needs to know: **npm workspaces resolve a dependency by the `name` field
in its `package.json`, not by registry scope**, so `import { … } from
'@peakpower-nl/api-client-customer'` works today with no registry and keeps working unchanged the
day the package is published; and the generator emits **types only** — the transport is
hand-written on Angular's `HttpClient`, which is what lets requests go through Angular DI,
interceptors and `HttpTestingController`.

`src/generated/` is machine-owned. `src/lib/` is hand-owned. `verify:clients` only ever looks
at `src/generated/`.

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
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
- Create: `apps/customer-portal/src/main.ts` *(stub, replaced in Task 13)*
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
  - `export class CustomerApiClient` — full method list in Step 7
  - `export function provideCustomerApiTesting(baseUrl?: string): EnvironmentProviders`

- [ ] **Step 1: Write the failing registry test**

Add to `tools/openapi-clients.test.mjs`, inside the existing `describe('CLIENTS', …)`:

```js
  it('registers the customer client with its committed output path', () => {
    const customer = CLIENTS.find((c) => c.name === '@peakpower-nl/api-client-customer');
    assert.ok(customer, 'customer client must be registered');
    assert.equal(customer.output,
      resolve(WEB_ROOT, 'libs/api-client-customer/src/generated/customer-schema.d.ts'));
    assert.match(customer.document, /artifacts\/openapi\/customer\.json$/);
  });

  it('registers exactly two clients', () => {
    assert.equal(CLIENTS.length, 2);
  });
```

- [ ] **Step 2: Run the tool test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:tools`
Expected: FAIL — `AssertionError [ERR_ASSERTION]: customer client must be registered`

- [ ] **Step 3: Register the client**

Add a second entry to `CLIENTS` in `tools/openapi-clients.mjs`, keeping the employee one:

```js
export const CLIENTS = Object.freeze([
  Object.freeze({
    name: '@peakpower-nl/api-client-employee',
    document: resolve(PLATFORM_ROOT, 'artifacts/openapi/employee.json'),
    output: resolve(WEB_ROOT, 'libs/api-client-employee/src/generated/employee-schema.d.ts'),
  }),
  Object.freeze({
    name: '@peakpower-nl/api-client-customer',
    document: resolve(PLATFORM_ROOT, 'artifacts/openapi/customer.json'),
    output: resolve(WEB_ROOT, 'libs/api-client-customer/src/generated/customer-schema.d.ts'),
  }),
]);
```

- [ ] **Step 4: Run the tool test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:tools`
Expected: PASS — 9 tests

- [ ] **Step 5: Add the workspace package and generate its types**

Create `libs/api-client-customer/package.json`:

```json
{
  "name": "@peakpower-nl/api-client-customer",
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

**Merge** into `tsconfig.json`'s `paths`, keeping the two existing entries:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@peakpower-nl/shared-ui": ["libs/shared-ui/src/public-api.ts"],
      "@peakpower-nl/api-client-employee": ["libs/api-client-employee/src/index.ts"],
      "@peakpower-nl/api-client-customer": ["libs/api-client-customer/src/index.ts"]
    }
  }
}
```

**Merge** into `package.json`'s `scripts`, keeping everything already there. `start:customer-portal`
is **not** in this list: plan 3 already defines it as `ng serve customer-portal --port ${PORT:-4200}`,
and the `${PORT}` is how Aspire's `.WithHttpEndpoint(env: "PORT")` reaches the dev server. Restating it
without the port would silently unhook the AppHost.

```json
{
  "scripts": {
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

Check three things in the generated file, because Step 9 depends on them:

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
   real spelling — Step 9 aliases it and nothing else in the plan touches generated names.
2. The enum unions use the database spelling (`"CUSTOMER_DECLARED"`), because shared contract
   §5.2 makes SCREAMING_SNAKE the wire format for every enum and both hosts register the one
   shared `JsonStringEnumConverter` that produces it. A `"CustomerDeclared"` in this output
   means the host is missing that converter — fix the host, not the client.
3. The last count is `0` — the file is types only, with no runtime code.

- [ ] **Step 6: Add the `customer-portal` project and its shell files**

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
  "extends": "../../tsconfig.json",
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
  "extends": "../../tsconfig.json",
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

Create the stub `apps/customer-portal/src/main.ts`, replaced in Task 13:

```ts
// Replaced by the real bootstrap in Task 13. It exists now so that angular.json's build target
// resolves, which the unit-test builder needs as its buildTarget.
export {};
```

- [ ] **Step 7: Write the failing client test**

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

- [ ] **Step 8: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal`
Expected: FAIL — `Failed to resolve import "./customer-api.client"`

- [ ] **Step 9: Write the library**

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
 * Re-declared here rather than imported from `@peakpower-nl/api-client-employee`: a client library
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
 * It deliberately does NOT install the auth interceptor. Task 12 tests that in isolation, and a
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

- [ ] **Step 10: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal`
Expected: PASS — 11 tests in `customer-api.client.spec.ts`

- [ ] **Step 11: Confirm the staleness check still passes**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run verify:clients; echo "exit=$?"`
Expected: `exit=0`, with a line per client saying it is up to date.

- [ ] **Step 12: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add package.json package-lock.json tsconfig.json angular.json \
        tools/openapi-clients.mjs tools/openapi-clients.test.mjs \
        libs/api-client-customer apps/customer-portal
git commit -m "feat(api-client-customer): generate and commit the customer client"
```

---

### Task 12: The in-memory token store and the auth interceptor

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
  `@peakpower-nl/api-client-customer` (Task 11); `@angular/router`'s `Router`.
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
import type { CurrentAccount } from '@peakpower-nl/api-client-customer';

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
import type { CurrentAccount } from '@peakpower-nl/api-client-customer';

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
import { CUSTOMER_API_BASE_URL } from '@peakpower-nl/api-client-customer';
import type { CurrentAccount, SignInResponse } from '@peakpower-nl/api-client-customer';

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
import { CustomerApiClient } from '@peakpower-nl/api-client-customer';
import type { SignInResponse } from '@peakpower-nl/api-client-customer';
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

### Task 13: The navigation — the design's labels over the specification's route keys

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
this plan adds the key and Task 29 records it.

**Files:**
- Create: `apps/customer-portal/src/app/shell/customer-nav.ts`
- Test: `apps/customer-portal/src/app/shell/customer-nav.spec.ts`

**Interfaces:**
- Consumes: `PpNavItem` and `PpNavSection` from `@peakpower-nl/shared-ui` (plan 3).
- Produces:
  - `export const CUSTOMER_ROUTE_KEYS: readonly string[]`
  - `export type CustomerRouteKey`
  - `export const PAGE_LABELS: Readonly<Record<CustomerRouteKey, string>>`
  - `export const CUSTOMER_NAV: PpNavSection[]`  — `PpAppShell.sections` is a mutable array
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

  it('is grouped rather than a flat list of seven, and every section is titled', () => {
    expect(CUSTOMER_NAV.length).toBeGreaterThan(1);
    // PpNavSection.label is a required string — a section with no heading is not expressible.
    for (const section of CUSTOMER_NAV) {
      expect(section.label.length).toBeGreaterThan(0);
    }
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
      expect(item.disabledReason).toBeUndefined();
    }
  });

  it('gives every disabled item a null path and a sentence naming the reason', () => {
    const disabled = items.filter((i) => !ENABLED_ROUTE_KEYS.includes(i.routeKey as never));

    expect(disabled.length).toBe(5);
    for (const item of disabled) {
      expect(item.path).toBeNull();
      // Shared contract §10.1: a disabled item MUST carry a disabledReason.
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
import type { PpNavItem, PpNavSection } from '@peakpower-nl/shared-ui';

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
  const path = PATH[routeKey] ?? null;
  const reason = DISABLED_REASON[routeKey];
  // `disabledReason` is optional on PpNavItem and mandatory on a disabled row, so it is
  // present exactly when `path` is null rather than carried as a null alongside a path.
  return {
    routeKey,
    label: PAGE_LABELS[routeKey],
    path,
    dot: DOT[routeKey],
    ...(path === null ? { disabledReason: reason! } : {}),
  };
}

/**
 * The rail, grouped as the design specifies rather than as a flat list of seven.
 * `PpNavSection.label` is a required string, so the Dashboard row gets a heading of its own
 * rather than sitting under an untitled block: "Overview" says what the row is for without
 * repeating the row's own label.
 */
export const CUSTOMER_NAV: PpNavSection[] = [
  { label: 'Overview', items: [item('dashboard')] },
  {
    label: 'Your energy',
    items: [item('connections'), item('consumption'), item('prices')],
  },
  { label: 'Trading', items: [item('trading'), item('wallet')] },
  { label: 'Administration', items: [item('settlements'), item('company')] },
];
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

### Task 14: Bootstrap, the session, the guard and the shell

The application boots, discovers whether there is a session, and either shows the shell or
sends the visitor to sign in.

**The bootstrap is the interesting part.** The access token lives in memory (Task 12), so a page
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
- Consumes: `AccessTokenStore`, `TokenRefresher`, `authInterceptor` (Task 12);
  `CUSTOMER_NAV` (Task 13); `CustomerApiClient.signIn/signOut/refresh` (Task 11);
  `PpAppShell` from `@peakpower-nl/shared-ui`.
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
import { CUSTOMER_API_BASE_URL } from '@peakpower-nl/api-client-customer';
import type { CurrentAccount, SignInResponse } from '@peakpower-nl/api-client-customer';

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
import { CUSTOMER_API_BASE_URL } from '@peakpower-nl/api-client-customer';
import type { SignInResponse } from '@peakpower-nl/api-client-customer';
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
import { CustomerApiClient } from '@peakpower-nl/api-client-customer';
import type { CurrentAccount } from '@peakpower-nl/api-client-customer';
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

Every `loadComponent` and `loadChildren` above points at a file a later task creates, so
`ng build` cannot resolve them until Tasks 15, 16, 17, 23, 24 and 25 land. Write the six
stubs now, each exporting the exact symbol its route names — an `@Component` with an empty
template, and a routes array for the child route. A later task overwrites the file wholesale.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app
mkdir -p features/sign-in features/company features/connections onboarding

cat > features/sign-in/sign-in-page.ts <<'TS'
import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Stub — Task 15 replaces this file. */
@Component({ selector: 'pp-sign-in-page', standalone: true, template: '',
  changeDetection: ChangeDetectionStrategy.OnPush })
export class SignInPage {}
TS

cat > features/sign-in/forgot-password-page.ts <<'TS'
import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Stub — Task 16 replaces this file. */
@Component({ selector: 'pp-forgot-password-page', standalone: true, template: '',
  changeDetection: ChangeDetectionStrategy.OnPush })
export class ForgotPasswordPage {}
TS

cat > features/sign-in/reset-password-page.ts <<'TS'
import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Stub — Task 16 replaces this file. */
@Component({ selector: 'pp-reset-password-page', standalone: true, template: '',
  changeDetection: ChangeDetectionStrategy.OnPush })
export class ResetPasswordPage {}
TS

cat > onboarding/onboarding-wizard.ts <<'TS'
import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Stub — Task 17 replaces this file. */
@Component({ selector: 'pp-onboarding-wizard', standalone: true, template: '',
  changeDetection: ChangeDetectionStrategy.OnPush })
export class OnboardingWizard {}
TS

cat > features/company/company-page.ts <<'TS'
import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Stub — Task 26 replaces this file. */
@Component({ selector: 'pp-company-page', standalone: true, template: '',
  changeDetection: ChangeDetectionStrategy.OnPush })
export class CompanyPage {}
TS

cat > features/connections/connections.routes.ts <<'TS'
import type { Routes } from '@angular/router';

/** Stub — Task 23 replaces this file. CONNECTION_ROUTES is a routes array, not a class. */
export const CONNECTION_ROUTES: Routes = [];
TS
```

`dashboard-page.ts` is not in that list: this step writes the real one immediately below.

Create `apps/customer-portal/src/app/features/dashboard/dashboard-page.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PpBanner, PpCard } from '@peakpower-nl/shared-ui';

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
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { PpAppShell, PpButton } from '@peakpower-nl/shared-ui';
import { filter, map } from 'rxjs';

import { AuthService } from './auth/auth.service';
import { CUSTOMER_NAV, CUSTOMER_ROUTE_KEYS } from './shell/customer-nav';
import type { CustomerRouteKey } from './shell/customer-nav';

@Component({
  selector: 'pp-root',
  standalone: true,
  imports: [RouterOutlet, PpAppShell, PpButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (chrome()) {
      <pp-app-shell
        [sections]="nav"
        [activeRouteKey]="activeRouteKey()"
        [productName]="productName"
        [subtitle]="companyLine()"
      >
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
  readonly productName = 'PeakPower';

  readonly chrome = computed(() => this.auth.isSignedIn());

  /**
   * `PpAppShell.activeRouteKey` is required and takes a route key, not a URL. The first path
   * segment IS the route key by construction — Task 13's `PATH` map builds every path from its
   * key — so the mapping is a lookup rather than a second table that can drift.
   */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  readonly activeRouteKey = computed(() => {
    const segment = this.url().split('?')[0].split('/')[1] ?? '';
    return CUSTOMER_ROUTE_KEYS.includes(segment as CustomerRouteKey) ? segment : 'dashboard';
  });

  // `crumb` and `subtitle` are exclusive; this shell uses the subtitle. `PpAppShell.subtitle`
  // is `input<string>()`, so "no subtitle" is undefined rather than null.
  readonly companyLine = computed(() => {
    const account = this.auth.account();
    return account === null ? undefined : `${account.firstName} ${account.lastName}`;
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
import { CUSTOMER_API_BASE_URL } from '@peakpower-nl/api-client-customer';

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

### Task 15: Sign in

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
- Consumes: `AuthService.signIn(username, password)` (Task 14);
  `isValidationProblem` and `ValidationProblemDetails` from `@peakpower-nl/api-client-customer`;
  `PpButton`, `PpCard`, `PpBanner` from `@peakpower-nl/shared-ui`.
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
import { CUSTOMER_API_BASE_URL } from '@peakpower-nl/api-client-customer';

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
import { isValidationProblem } from '@peakpower-nl/api-client-customer';
import type { ValidationProblemDetails } from '@peakpower-nl/api-client-customer';

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
import { PpButton, PpCard } from '@peakpower-nl/shared-ui';

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

### Task 16: Forgotten password, and setting a new one

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
  `.completePasswordReset({ token, newPassword })` (Task 11);
  `applyProblemDetails` and `PpFormField` (Task 15); `@angular/router`'s `ActivatedRoute`.
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
import { CUSTOMER_API_BASE_URL } from '@peakpower-nl/api-client-customer';

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
import { CUSTOMER_API_BASE_URL } from '@peakpower-nl/api-client-customer';
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
import { CustomerApiClient, PpButtonUnused as _unused } from '@peakpower-nl/api-client-customer';
import { PpBanner, PpButton, PpCard } from '@peakpower-nl/shared-ui';

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
> `import { CustomerApiClient } from '@peakpower-nl/api-client-customer';`

Create `apps/customer-portal/src/app/features/sign-in/reset-password-page.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import type { AbstractControl, ValidationErrors } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CustomerApiClient } from '@peakpower-nl/api-client-customer';
import { PpBanner, PpButton, PpCard } from '@peakpower-nl/shared-ui';

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
### Task 17: The onboarding wizard — the step table, the gates and the shell

Ten steps, in a rail, with a footer that refuses to move on until the step is answered. The
demo in `/Users/thinhhuynh/PeakPower/trading-poc` already worked all of this out —
`onboarding-flow.js` holds the step table, the option lists, the validity gates and the hint for
every reason a step can refuse. **This task ports that module** to TypeScript and gives it a
container component that talks to plan 5's API.

Two things change in the port, and both are the difference between a demo and a build:

**The signing code is not a constant.** `onboarding-flow.js` carries
`var SIGN_CODE = "748213"` with a comment explaining that it is a demo affordance in a flow that
submits nothing. In this build the code is six digits generated per application by plan 5's
backend, hashed at rest, and emailed through `IEmailSender`. The browser cannot know it. So the
local gate on step 9 becomes *"six digits typed, and the box ticked"*, and whether those digits
are the right ones is the server's answer — a 400 from `POST /onboarding/applications/{id}/sign`.
Porting `signCodeMatches` would have put a working credential in a bundle.

**The address is six fields, not three.** The demo asks for "Street and number", City and
Postcode. Plan 5's `OnboardingAddressDto` is
`(Street, HouseNumber, HouseNumberSuffix, PostalCode, City, Country)`, so the wizard asks for
street and house number separately. Joining them in the browser and splitting them on the server
is a parser nobody wants to own.

**The wizard's `@switch` grows one arm per task.** This task builds the chrome — rail, header,
progress, footer, hint, and the network call each step makes — with an empty step body. Tasks 18
to 21 each add their arms. Until Task 22 lands the wizard is not shippable, which is exactly what
Task 22's last test asserts.

**Files:** *(run from `/Users/thinhhuynh/PeakPower/peakpower-web`)*
- Create: `apps/customer-portal/src/app/onboarding/onboarding-flow.ts`
- Create: `apps/customer-portal/src/app/onboarding/onboarding-wizard.ts`
- Test: `apps/customer-portal/src/app/onboarding/onboarding-flow.spec.ts`
- Test: `apps/customer-portal/src/app/onboarding/onboarding-wizard.spec.ts`

**Interfaces:**
- Consumes: `CustomerApiClient.startOnboarding(body)`, `.saveOnboardingStep(id, body)` (Task 11);
  `SaveOnboardingStepRequest`, `StartOnboardingRequest`, `OnboardingApplicationResponse` from
  `@peakpower-nl/api-client-customer` (Task 11); `applyProblemDetails(form, error)` (Task 15);
  `PpButton` from `@peakpower-nl/shared-ui` (plan 3).
- Produces:
  - `export interface OnboardingStep { readonly n: number; readonly group: string; readonly label: string; readonly title: string; readonly intro: string; readonly next?: string }`
  - `export const STEPS: readonly OnboardingStep[]` and `export const LAST_STEP: number`
  - `export const ENTITY_TYPES: readonly { readonly label: string; readonly wire: string }[]`
  - `export const INDUSTRIES: readonly string[]`
  - `export const FLOWS: readonly { readonly label: string; readonly wire: string }[]`
  - `export const VOLUMES: readonly { readonly label: string; readonly short: string; readonly wire: string }[]`
  - `export const AUTHORITY: readonly { readonly label: string; readonly note: string; readonly wire: string }[]`
  - `export const MIN_PASSWORD: 12`, `KVK_DIGITS: 8`, `SIGN_CODE_DIGITS: 6`, `SUPPORT_EMAIL: string`
  - `export interface SignatoryDraft`, `OnboardingFields`, `OnboardingState`
  - `export function defaultState(): OnboardingState`, `blankSignatory()`, `kvkDigits()`,
    `looksLikeEmail()`, `codeDigits()`, `signatoryComplete()`, `minSignatories()`,
    `signatoriesForAuthority()`, `stepValid()`, `hint()`, `stepTitle()`, `stepIntro()`,
    `clampStep()`, `fullName()`, `summaryRows()`, `withField()`, `inputValue()`,
    `saveStepRequest()`
  - `export class OnboardingWizard` — selector `pp-onboarding-wizard`

- [ ] **Step 1: Write the failing test for the flow module**

Create `apps/customer-portal/src/app/onboarding/onboarding-flow.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';

import {
  AUTHORITY,
  ENTITY_TYPES,
  FLOWS,
  INDUSTRIES,
  LAST_STEP,
  MIN_PASSWORD,
  SIGN_CODE_DIGITS,
  STEPS,
  VOLUMES,
  clampStep,
  defaultState,
  hint,
  kvkDigits,
  looksLikeEmail,
  minSignatories,
  saveStepRequest,
  signatoriesForAuthority,
  signatoryComplete,
  stepIntro,
  stepTitle,
  stepValid,
  summaryRows,
} from './onboarding-flow';
import type { OnboardingState } from './onboarding-flow';

/** A complete application, so a test can start at any step without typing nine screens. */
function filled(): OnboardingState {
  const s = defaultState();
  return {
    ...s,
    f: {
      firstName: 'Peter',
      lastName: 'de Vries',
      email: 'p.devries@vandersteen.nl',
      password: 'correct-horse-battery',
      orgName: 'Vandersteen Koeling B.V.',
      kvk: '24398112',
      street: 'Havenweg',
      houseNumber: '22',
      houseNumberSuffix: '',
      postcode: '3089 JJ',
      city: 'Rotterdam',
      iban: 'NL98INGB0002445566',
      bankAccountHolder: 'Vandersteen Koeling B.V.',
    },
    agreed: true,
    bankVerified: true,
    entityIndex: 0,
    industryIndex: INDUSTRIES.indexOf('Agriculture & Food Processing'),
    flowIndex: 2,
    volumeIndex: 3,
    authorityIndex: 1,
    signCode: '748213',
    agreedDocs: true,
    signatories: [
      { first: 'Peter', last: 'de Vries', email: 'p.devries@vandersteen.nl', locked: true },
      { first: 'Marieke', last: 'Vandersteen', email: 'm.vandersteen@vandersteen.nl', locked: false },
    ],
  };
}

describe('the step table', () => {
  it('has ten steps, numbered 1 to 10, in six groups', () => {
    expect(LAST_STEP).toBe(10);
    expect(STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect([...new Set(STEPS.map((s) => s.group))])
      .toEqual(['Account', 'Company', 'Profile', 'Verification', 'Agreement', 'Done']);
  });

  it('carries the demo labels verbatim', () => {
    expect(STEPS.map((s) => s.label)).toEqual([
      'Personal information', 'Company', 'Registered address', 'Industry',
      'Electricity volume', 'Bank verification', 'Signing authority',
      'Authorised signatories', 'Sign the agreement', 'Welcome',
    ]);
  });

  it('puts the button label on the step rather than deriving it from the number', () => {
    expect(STEPS[0].next).toBe('Create account');
    expect(STEPS[7].next).toBe('Submit and send the codes');
    expect(STEPS[8].next).toBe('Sign the agreement');
    expect(STEPS[1].next).toBeUndefined();
  });
});

describe('the option lists', () => {
  it('offers the nine Dutch legal forms, and spells Coöperatie on the wire without the diaeresis', () => {
    expect(ENTITY_TYPES.map((e) => e.label)).toEqual([
      'BV', 'NV', 'Eenmanszaak', 'VOF', 'Maatschap', 'CV', 'Stichting', 'Vereniging', 'Coöperatie',
    ]);
    expect(ENTITY_TYPES[8].wire).toBe('Cooperatie');
  });

  it('leads the industries with "Not specified" so index 0 means unanswered', () => {
    expect(INDUSTRIES[0]).toBe('Not specified');
    expect(INDUSTRIES).toHaveLength(25);
    expect(INDUSTRIES).toContain('Transportation');
  });

  it('maps the five volume bands onto the wire names the API parses', () => {
    expect(VOLUMES.map((v) => v.wire)).toEqual([
      'UpTo250Mwh', 'From250To500Mwh', 'From500To1000Mwh', 'From1000To2500Mwh', 'Above2500Mwh',
    ]);
    expect(VOLUMES[0].label).toBe('Less than 250 MWh');
    expect(VOLUMES[0].short).toBe('< 250 MWh');
  });

  it('maps the three signing-authority answers, each with the line explaining what follows', () => {
    expect(AUTHORITY.map((a) => a.wire)).toEqual(['Alone', 'Jointly', 'SomeoneElse']);
    expect(AUTHORITY[1].note).toBe('You and at least one colleague both sign.');
  });

  it('maps the three flow directions', () => {
    expect(FLOWS.map((f) => f.wire)).toEqual(['Consumption', 'Production', 'Both']);
  });
});

describe('stepValid', () => {
  it('refuses step 1 until the name, a plausible email, a long password and the terms are there', () => {
    const s = defaultState();
    expect(stepValid(s)).toBe(false);
    expect(stepValid({ ...filled(), step: 1 })).toBe(true);

    const short = filled();
    expect(stepValid({ ...short, step: 1, f: { ...short.f, password: 'short' } })).toBe(false);
    expect(stepValid({ ...short, step: 1, agreed: false })).toBe(false);
  });

  it('refuses step 2 without a name and exactly eight KvK digits', () => {
    const s = { ...filled(), step: 2 };
    expect(stepValid(s)).toBe(true);
    expect(stepValid({ ...s, f: { ...s.f, kvk: '2439811' } })).toBe(false);
    expect(stepValid({ ...s, f: { ...s.f, orgName: '  ' } })).toBe(false);
  });

  it('lets steps 3, 4 and 6 through unanswered — that is deliberate', () => {
    const s = defaultState();
    expect(stepValid({ ...s, step: 3 })).toBe(true);
    expect(stepValid({ ...s, step: 4 })).toBe(true);
    expect(stepValid({ ...s, step: 6 })).toBe(true);
  });

  it('refuses step 5 and step 7 until an option is picked', () => {
    const s = defaultState();
    expect(stepValid({ ...s, step: 5 })).toBe(false);
    expect(stepValid({ ...s, step: 5, volumeIndex: 0 })).toBe(true);
    expect(stepValid({ ...s, step: 7 })).toBe(false);
    expect(stepValid({ ...s, step: 7, authorityIndex: 0 })).toBe(true);
  });

  it('refuses step 8 with an incomplete signatory or too few of them', () => {
    const s = { ...filled(), step: 8 };
    expect(stepValid(s)).toBe(true);
    expect(stepValid({ ...s, signatories: [s.signatories[0]] })).toBe(false);
    expect(stepValid({
      ...s,
      signatories: [s.signatories[0], { ...s.signatories[1], email: 'nope' }],
    })).toBe(false);
  });

  it('gates step 9 on six digits AND the tick, and never on the code being correct', () => {
    // The real code is generated per application by the backend and emailed. The browser
    // cannot check it — a client-side match would mean shipping a working credential.
    const s = { ...filled(), step: 9 };
    expect(stepValid({ ...s, signCode: '000000' })).toBe(true);
    expect(stepValid({ ...s, signCode: '748 213' })).toBe(true);
    expect(stepValid({ ...s, signCode: '7482' })).toBe(false);
    expect(stepValid({ ...s, agreedDocs: false })).toBe(false);
  });
});

describe('hint', () => {
  it('names what is missing rather than restating the rule', () => {
    const s = defaultState();
    expect(hint(s)).toBe('Enter your first and last name to continue.');
    expect(hint({ ...s, f: { ...s.f, firstName: 'Peter', lastName: 'de Vries' } }))
      .toBe('Enter the email address you will sign in with.');
    expect(hint({ ...filled(), step: 2, f: { ...filled().f, kvk: '123' } }))
      .toBe('The KvK number is eight digits.');
  });

  it('counts the sign code down to six digits and never to a value', () => {
    const s = { ...filled(), step: 9, signCode: '' };
    expect(hint(s)).toBe(`Enter the ${SIGN_CODE_DIGITS}-digit code from the email.`);
    expect(hint({ ...s, signCode: '748' })).toBe('The code is six digits.');
    expect(hint({ ...s, signCode: '748213', agreedDocs: false }))
      .toBe('Tick the box to confirm you agree to the documents.');
  });

  it('says the password rule as a countdown', () => {
    const s = defaultState();
    const typed = { ...s, f: { ...s.f, firstName: 'P', lastName: 'V', email: 'p@v.nl', password: '123456789' } };
    expect(hint(typed)).toBe(`${MIN_PASSWORD - 9} characters to go.`);
  });
});

describe('the signatory list', () => {
  it('locks the applicant in when they sign alone or jointly, and drops them when they do not sign', () => {
    const f = filled().f;
    expect(signatoriesForAuthority(0, f)).toEqual([
      { first: 'Peter', last: 'de Vries', email: 'p.devries@vandersteen.nl', locked: true },
    ]);
    expect(signatoriesForAuthority(1, f)).toHaveLength(2);
    expect(signatoriesForAuthority(1, f)[0].locked).toBe(true);
    expect(signatoriesForAuthority(2, f)).toEqual([
      { first: '', last: '', email: '', locked: false },
    ]);
  });

  it('requires two only when the answer was "together with another authorised person"', () => {
    expect(minSignatories(0)).toBe(1);
    expect(minSignatories(1)).toBe(2);
    expect(minSignatories(2)).toBe(1);
  });

  it('calls a signatory complete only with both names and a plausible address', () => {
    expect(signatoryComplete({ first: 'A', last: 'B', email: 'a@b.nl', locked: false })).toBe(true);
    expect(signatoryComplete({ first: 'A', last: '', email: 'a@b.nl', locked: false })).toBe(false);
    expect(signatoryComplete({ first: 'A', last: 'B', email: '@b.nl', locked: false })).toBe(false);
  });
});

describe('saveStepRequest', () => {
  it('sends only the step it is asked for', () => {
    expect(saveStepRequest(filled(), 2)).toEqual({
      step: 2,
      organizationName: 'Vandersteen Koeling B.V.',
      legalEntityType: 'BV',
      kvkNumber: '24398112',
      registeredAddress: null,
      industry: null,
      flowDirection: null,
      volumeBand: null,
      iban: null,
      bankAccountHolder: null,
      signingAuthority: null,
    });
  });

  it('sends the six-part address, and null when nothing was registered', () => {
    expect(saveStepRequest(filled(), 3).registeredAddress).toEqual({
      street: 'Havenweg',
      houseNumber: '22',
      houseNumberSuffix: null,
      postalCode: '3089 JJ',
      city: 'Rotterdam',
      country: 'NL',
    });
    expect(saveStepRequest(defaultState(), 3).registeredAddress).toBeNull();
  });

  it('sends no industry at all when the answer is "Not specified"', () => {
    expect(saveStepRequest({ ...filled(), industryIndex: 0 }, 4).industry).toBeNull();
    expect(saveStepRequest(filled(), 4).industry).toBe('Agriculture & Food Processing');
  });

  it('sends the wire names for direction, volume and signing authority', () => {
    const five = saveStepRequest(filled(), 5);
    expect(five.flowDirection).toBe('Both');
    expect(five.volumeBand).toBe('From1000To2500Mwh');
    expect(saveStepRequest(filled(), 7).signingAuthority).toBe('Jointly');
  });

  it('sends the bank details on step 6 and blanks as null', () => {
    expect(saveStepRequest(filled(), 6).iban).toBe('NL98INGB0002445566');
    expect(saveStepRequest(defaultState(), 6).iban).toBeNull();
  });
});

describe('the last step, which has two outcomes', () => {
  it('says the account is active only once the cent has arrived', () => {
    const done = { ...filled(), step: 10 };
    expect(stepTitle(done)).toBe('Welcome to PeakPower');
    expect(stepTitle({ ...done, bankVerified: false })).toBe('Agreement signed');
    expect(stepIntro({ ...done, bankVerified: false }))
      .toBe('Your signature is recorded. One thing is still outstanding before the account can be activated.');
  });

  it('prints every answer, including the blank ones', () => {
    const rows = summaryRows({ ...defaultState(), step: 10 });
    expect(rows.find((r) => r.k === 'Registered address')?.v).toBe('Not registered');
    expect(rows.find((r) => r.k === 'Annual volume')?.v).toBe('Not given');
    expect(rows.find((r) => r.k === 'Bank account')?.v).toBe('Not verified yet');
    expect(rows.map((r) => r.k)).toContain('Signing authority');
  });
});

describe('the small helpers', () => {
  it('reads eight KvK digits out of anything pasted', () => {
    expect(kvkDigits(' 24.398.112 ')).toBe('24398112');
  });

  it('needs a local part before the @', () => {
    expect(looksLikeEmail('@company.nl')).toBe(false);
    expect(looksLikeEmail('p@company.nl')).toBe(true);
  });

  it('clamps a bad deep link onto a real step', () => {
    expect(clampStep(0)).toBe(1);
    expect(clampStep(99)).toBe(10);
    expect(clampStep(Number.NaN)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- onboarding-flow`
Expected: FAIL — `Failed to resolve import "./onboarding-flow"`

- [ ] **Step 3: Write the flow module**

Create `apps/customer-portal/src/app/onboarding/onboarding-flow.ts`:

```ts
import type { OnboardingAddress, SaveOnboardingStepRequest } from '@peakpower-nl/api-client-customer';

/**
 * The onboarding flow's ten steps and the rules that gate them — the components render, this
 * decides. Ported from `trading-poc/onboarding-flow.js`, which worked out the copy, the gates
 * and the hints; nothing here is new except where the API demanded it.
 *
 * TWO DELIBERATE DEPARTURES FROM THE DEMO
 *
 * 1. There is no SIGN_CODE constant. The demo shipped one because it submitted nothing anywhere;
 *    here the code is six digits generated per application by the backend, hashed at rest and
 *    emailed through IEmailSender. Step 9's gate is "six digits and the tick"; whether they are
 *    the RIGHT six digits is the server's answer.
 * 2. The address is six fields, because OnboardingAddressDto is six fields. The demo's single
 *    "Street and number" box would have to be split by a parser on one side or the other, and
 *    nobody wants to own that parser.
 */

export interface OnboardingStep {
  readonly n: number;
  readonly group: string;
  readonly label: string;
  readonly title: string;
  readonly intro: string;
  /** The footer's button label. On the step, so adding one is not an off-by-one elsewhere. */
  readonly next?: string;
}

export const STEPS: readonly OnboardingStep[] = [
  {
    n: 1, group: 'Account', label: 'Personal information', title: 'Personal information',
    intro: 'Start with the person who will manage the account. You can invite colleagues once the account is active.',
    next: 'Create account',
  },
  {
    n: 2, group: 'Company', label: 'Company', title: 'Company or organization information',
    intro: 'PeakPower contracts with the legal entity, so this must match the KvK register.',
  },
  {
    n: 3, group: 'Company', label: 'Registered address', title: 'Registered address',
    intro: 'Pulled from the KvK register where we can find it — check it and correct anything that is wrong.',
  },
  {
    n: 4, group: 'Company', label: 'Industry', title: 'Industry',
    intro: 'Optional. It only helps the desk pick a sensible starting load profile.',
  },
  {
    n: 5, group: 'Profile', label: 'Electricity volume', title: 'Your electricity volume',
    intro: 'Two answers: which direction your meter runs, and roughly how much passes through it in a year.',
  },
  {
    n: 6, group: 'Verification', label: 'Bank verification', title: 'Bank account verification',
    intro: 'One cent, once. It proves the account belongs to the company that signs the agreement.',
  },
  {
    n: 7, group: 'Agreement', label: 'Signing authority', title: 'Signing authority',
    intro: 'Who may bind the company decides where the agreement goes next.',
  },
  {
    n: 8, group: 'Agreement', label: 'Authorised signatories', title: 'Who needs to sign the agreement?',
    intro: 'Add every person required to sign on behalf of the company. Each is emailed their own signing code.',
    next: 'Submit and send the codes',
  },
  {
    n: 9, group: 'Agreement', label: 'Sign the agreement', title: 'Sign the agreement',
    intro: 'We emailed you a six-digit code. Entering it, with the box below ticked, is your signature.',
    next: 'Sign the agreement',
  },
  {
    n: 10, group: 'Done', label: 'Welcome', title: 'Welcome to PeakPower',
    intro: 'The agreement is signed and your account is active.',
  },
];

export const LAST_STEP = STEPS.length;

/**
 * The wire name is the C# member name, not SCREAMING_SNAKE: plan 5 parses these with
 * Enum.TryParse<LegalEntityType>. Note Coöperatie — the label keeps the diaeresis, the wire
 * value cannot have one because a C# identifier cannot.
 */
export const ENTITY_TYPES: readonly { readonly label: string; readonly wire: string }[] = [
  { label: 'BV', wire: 'BV' },
  { label: 'NV', wire: 'NV' },
  { label: 'Eenmanszaak', wire: 'Eenmanszaak' },
  { label: 'VOF', wire: 'VOF' },
  { label: 'Maatschap', wire: 'Maatschap' },
  { label: 'CV', wire: 'CV' },
  { label: 'Stichting', wire: 'Stichting' },
  { label: 'Vereniging', wire: 'Vereniging' },
  { label: 'Coöperatie', wire: 'Cooperatie' },
];

/**
 * "Not specified" leads and is the default: step 4 is optional, so index 0 has to mean
 * "not answered" rather than silently answering Agriculture.
 */
export const INDUSTRIES: readonly string[] = [
  'Not specified',
  'Agriculture & Food Processing', 'Arts, Medias & Entertainment', 'Casinos & Gambling',
  'Construction', 'Cryptocurrency', 'Defense & Military Industry', 'Education',
  'Energy & Utilities', 'Financial Services', 'Food & Lodging', 'Government',
  'Health Professions', 'Holding Company', 'Industry & Manufacturing', 'Mining',
  'Non-Profit', 'Professional Services', 'Real Estate', 'Retail Trade, Automotive',
  'Retail Trade, Jewelry & Antiques', 'Retail Trade, Others', 'Sport & Tourism',
  'Technology & Computing', 'Transportation',
];

export const FLOWS: readonly { readonly label: string; readonly wire: string }[] = [
  { label: 'Consumption', wire: 'Consumption' },
  { label: 'Production', wire: 'Production' },
  { label: 'Both', wire: 'Both' },
];

/** `short` is what the welcome step's stat card prints; the long label is what the step asks. */
export const VOLUMES: readonly {
  readonly label: string; readonly short: string; readonly wire: string;
}[] = [
  { label: 'Less than 250 MWh', short: '< 250 MWh', wire: 'UpTo250Mwh' },
  { label: '250 – 500 MWh', short: '250–500 MWh', wire: 'From250To500Mwh' },
  { label: '500 – 1.000 MWh', short: '500–1.000 MWh', wire: 'From500To1000Mwh' },
  { label: '1.000 – 2.500 MWh', short: '1.000–2.500 MWh', wire: 'From1000To2500Mwh' },
  { label: 'More than 2.500 MWh', short: '> 2.500 MWh', wire: 'Above2500Mwh' },
];

export const AUTHORITY: readonly {
  readonly label: string; readonly note: string; readonly wire: string;
}[] = [
  {
    label: 'Yes, I am authorised to sign',
    note: 'You sign alone; the agreement is issued to you.',
    wire: 'Alone',
  },
  {
    label: 'Yes, together with another authorised person',
    note: 'You and at least one colleague both sign.',
    wire: 'Jointly',
  },
  {
    label: 'No, someone else needs to sign',
    note: 'We email the people you name; you keep managing the account.',
    wire: 'SomeoneElse',
  },
];

export const MIN_PASSWORD = 12;
export const KVK_DIGITS = 8;
export const SIGN_CODE_DIGITS = 6;

/**
 * The one address PeakPower writes from, and the one a customer can answer. Deliberately not a
 * no-reply: every email this flow sends invites a reply, and the desk handles by hand anything
 * that stops an account being validated.
 */
export const SUPPORT_EMAIL = 'support@peakpower.nl';

export interface SignatoryDraft {
  first: string;
  last: string;
  email: string;
  /** The applicant's own row. It is their account; editing it here would disagree with step 1. */
  locked: boolean;
}

export interface OnboardingFields {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  orgName: string;
  kvk: string;
  street: string;
  houseNumber: string;
  houseNumberSuffix: string;
  postcode: string;
  city: string;
  iban: string;
  bankAccountHolder: string;
}

export interface OnboardingState {
  readonly step: number;
  readonly agreed: boolean;
  readonly bankVerified: boolean;
  readonly entityIndex: number;
  readonly industryIndex: number;
  readonly flowIndex: number;
  /** −1, not 0: index 0 is a real answer in both of these lists. */
  readonly volumeIndex: number;
  readonly authorityIndex: number;
  readonly signCode: string;
  readonly agreedDocs: boolean;
  readonly f: OnboardingFields;
  readonly signatories: readonly SignatoryDraft[];
  /** Filled in by the server on step 1 and never by the browser. */
  readonly applicationId: string | null;
  readonly reference: string | null;
  readonly username: string | null;
}

export function blankSignatory(): SignatoryDraft {
  return { first: '', last: '', email: '', locked: false };
}

export function defaultState(): OnboardingState {
  return {
    step: 1,
    agreed: false,
    bankVerified: false,
    entityIndex: 0,
    industryIndex: 0,
    flowIndex: 0,
    volumeIndex: -1,
    authorityIndex: -1,
    signCode: '',
    agreedDocs: false,
    f: {
      firstName: '', lastName: '', email: '', password: '',
      orgName: '', kvk: '',
      street: '', houseNumber: '', houseNumberSuffix: '', postcode: '', city: '',
      iban: '', bankAccountHolder: '',
    },
    signatories: [blankSignatory()],
    applicationId: null,
    reference: null,
    username: null,
  };
}

/** Digits only — a KvK number pasted with spaces or dots is still eight digits. */
export function kvkDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/** Index > 0, not >= 0: "@company.nl" has no local part. */
export function looksLikeEmail(value: string): boolean {
  return value.indexOf('@') > 0;
}

/** Digits only, so a code pasted as "748 213" still counts as six. */
export function codeDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function signatoryComplete(s: SignatoryDraft): boolean {
  return s.first.trim() !== '' && s.last.trim() !== '' && looksLikeEmail(s.email);
}

/** "Together with another authorised person" means two. */
export function minSignatories(authorityIndex: number): number {
  return authorityIndex === 1 ? 2 : 1;
}

/** "Someone else signs" drops the applicant: they manage the account, they do not sign. */
export function signatoriesForAuthority(
  authorityIndex: number,
  f: OnboardingFields,
): SignatoryDraft[] {
  const me: SignatoryDraft = {
    first: f.firstName, last: f.lastName, email: f.email, locked: true,
  };
  if (authorityIndex === 0) return [me];
  if (authorityIndex === 1) return [me, blankSignatory()];
  return [blankSignatory()];
}

export function fullName(f: OnboardingFields): string {
  return `${f.firstName.trim()} ${f.lastName.trim()}`.trim();
}

/** Steps 3, 4, 6 and 10 are always valid on purpose. */
export function stepValid(state: OnboardingState): boolean {
  const f = state.f;
  switch (state.step) {
    case 1:
      return f.firstName.trim() !== '' && f.lastName.trim() !== ''
        && looksLikeEmail(f.email) && f.password.length >= MIN_PASSWORD && state.agreed;
    case 2:
      return f.orgName.trim() !== '' && kvkDigits(f.kvk).length === KVK_DIGITS;
    case 5:
      return state.volumeIndex >= 0;
    case 7:
      return state.authorityIndex >= 0;
    case 8:
      return state.signatories.length >= minSignatories(state.authorityIndex)
        && state.signatories.every(signatoryComplete);
    case 9:
      // Both, and in this order: a code without the agreement signs nothing, and the agreement
      // without a code is nobody in particular ticking it. Whether the digits MATCH is the
      // server's call — see the module comment.
      return codeDigits(state.signCode).length === SIGN_CODE_DIGITS && state.agreedDocs;
    default:
      return true;
  }
}

/** Every reason stepValid can refuse has a line here naming what is missing. */
export function hint(state: OnboardingState): string {
  const f = state.f;
  switch (state.step) {
    case 1:
      if (f.firstName.trim() === '' || f.lastName.trim() === '') {
        return 'Enter your first and last name to continue.';
      }
      if (!looksLikeEmail(f.email)) return 'Enter the email address you will sign in with.';
      if (f.password.length === 0) return `At least ${MIN_PASSWORD} characters.`;
      if (f.password.length < MIN_PASSWORD) {
        return `${MIN_PASSWORD - f.password.length} characters to go.`;
      }
      if (!state.agreed) return 'Accept the Terms of Use to create the account.';
      return 'Your name and email carry through to the agreement.';
    case 2:
      if (f.orgName.trim() === '') return 'Enter the organization name as registered.';
      if (kvkDigits(f.kvk).length !== KVK_DIGITS) return 'The KvK number is eight digits.';
      return 'We look the company up in the KvK register on the next step.';
    case 3:
      return 'Blank is acceptable — the desk resolves the address during review.';
    case 4:
      return 'Optional. Continue without choosing if you prefer.';
    case 5:
      return state.volumeIndex < 0
        ? 'Pick the band that matches your yearly volume.'
        : 'A band is enough — exact metering follows from your connections.';
    case 6:
      return state.bankVerified
        ? 'Verified. The agreement can be issued to your signatories.'
        : 'Verification can also complete after you submit.';
    case 7:
      return state.authorityIndex < 0
        ? 'Choose one option to continue.'
        : 'You can change this before the agreement is signed.';
    case 8:
      if (state.signatories.length < minSignatories(state.authorityIndex)) {
        return 'You answered that two people sign — add the second signatory.';
      }
      return stepValid(state)
        ? 'Each signatory is emailed their own code; we verify their email address first.'
        : 'Every signatory needs a first name, last name and email address.';
    case 9: {
      const digits = codeDigits(state.signCode);
      if (digits.length === 0) return `Enter the ${SIGN_CODE_DIGITS}-digit code from the email.`;
      if (digits.length !== SIGN_CODE_DIGITS) return 'The code is six digits.';
      if (!state.agreedDocs) return 'Tick the box to confirm you agree to the documents.';
      return `Entering the code is your signature. It is recorded against ${fullName(f) || 'your name'}.`;
    }
    default:
      return state.bankVerified
        ? `Your account is active. Anything still outstanding, the desk emails you about from ${SUPPORT_EMAIL}.`
        : `The desk will email you from ${SUPPORT_EMAIL} for whatever it still needs. You can reply to that email.`;
  }
}

/**
 * The last step has two outcomes and must not print the wrong one. "Welcome to PeakPower · your
 * account is active" over a badge reading "With the desk" is the contradiction this exists to
 * stop: the agreement is signed either way, the account is only active once the cent clears.
 */
export function stepTitle(state: OnboardingState): string {
  const st = STEPS[state.step - 1];
  if (st === undefined) return '';
  if (state.step === LAST_STEP && !state.bankVerified) return 'Agreement signed';
  return st.title;
}

export function stepIntro(state: OnboardingState): string {
  const st = STEPS[state.step - 1];
  if (st === undefined) return '';
  if (state.step === LAST_STEP && !state.bankVerified) {
    return 'Your signature is recorded. One thing is still outstanding before the account can be activated.';
  }
  return st.intro;
}

/** Clamped to the flow's own length, so a bad deep link lands on a real step. */
export function clampStep(n: number): number {
  return Math.max(1, Math.min(LAST_STEP, Math.round(Number.isFinite(n) ? n : 1)));
}

/** Every answer, including the blank ones — an omission reads as complete. */
export function summaryRows(state: OnboardingState): readonly { k: string; v: string }[] {
  const f = state.f;
  const address = [`${f.street} ${f.houseNumber}`.trim(), f.city].filter((p) => p !== '').join(', ');
  return [
    { k: 'Account', v: fullName(f) || '—' },
    { k: 'Email', v: f.email || '—' },
    { k: 'Organization', v: f.orgName || '—' },
    { k: 'Legal form', v: ENTITY_TYPES[state.entityIndex].label },
    { k: 'KvK number', v: f.kvk || '—' },
    { k: 'Registered address', v: address || 'Not registered' },
    { k: 'Postcode', v: f.postcode || '—' },
    { k: 'Industry', v: INDUSTRIES[state.industryIndex] },
    { k: 'Direction', v: FLOWS[state.flowIndex].label },
    { k: 'Annual volume', v: state.volumeIndex >= 0 ? VOLUMES[state.volumeIndex].label : 'Not given' },
    {
      k: 'Signing authority',
      v: state.authorityIndex >= 0 ? AUTHORITY[state.authorityIndex].label : '—',
    },
    { k: 'Bank account', v: state.bankVerified ? 'Verified with € 0,01' : 'Not verified yet' },
  ];
}

/** Immutably replace one field. Every step component writes through this. */
export function withField(
  state: OnboardingState,
  key: keyof OnboardingFields,
  value: string,
): OnboardingState {
  return { ...state, f: { ...state.f, [key]: value } };
}

/** `(input)` and `(change)` hand us an Event; this is the one cast, written once. */
export function inputValue(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function registeredAddress(f: OnboardingFields): OnboardingAddress | null {
  if (f.street.trim() === '' && f.postcode.trim() === '' && f.city.trim() === '') return null;
  return {
    street: f.street.trim(),
    houseNumber: f.houseNumber.trim(),
    houseNumberSuffix: blankToNull(f.houseNumberSuffix),
    postalCode: f.postcode.trim(),
    city: f.city.trim(),
    // The only country slice 1 serves. Recorded rather than asked, because asking a Dutch
    // customer for their country is a question with one answer.
    country: 'NL',
  };
}

/**
 * One step's answers, in the shape PATCH /onboarding/applications/{id} takes.
 *
 * Every field the step does not own is sent as null rather than omitted: the server merges by
 * step number, and an absent field and a cleared field must not look the same on the wire.
 */
export function saveStepRequest(state: OnboardingState, step: number): SaveOnboardingStepRequest {
  const f = state.f;
  return {
    step,
    organizationName: step === 2 ? blankToNull(f.orgName) : null,
    legalEntityType: step === 2 ? ENTITY_TYPES[state.entityIndex].wire : null,
    kvkNumber: step === 2 ? blankToNull(kvkDigits(f.kvk)) : null,
    registeredAddress: step === 3 ? registeredAddress(f) : null,
    industry: step === 4 && state.industryIndex > 0 ? INDUSTRIES[state.industryIndex] : null,
    flowDirection: step === 5 ? FLOWS[state.flowIndex].wire : null,
    volumeBand: step === 5 && state.volumeIndex >= 0 ? VOLUMES[state.volumeIndex].wire : null,
    iban: step === 6 ? blankToNull(f.iban) : null,
    bankAccountHolder: step === 6 ? blankToNull(f.bankAccountHolder) : null,
    signingAuthority:
      step === 7 && state.authorityIndex >= 0 ? AUTHORITY[state.authorityIndex].wire : null,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- onboarding-flow`
Expected: PASS — 23 tests

- [ ] **Step 5: Write the failing test for the wizard shell**

Create `apps/customer-portal/src/app/onboarding/onboarding-wizard.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, afterEach } from 'vitest';
import { provideCustomerApiTesting } from '@peakpower-nl/api-client-customer';

import { OnboardingWizard } from './onboarding-wizard';
import { defaultState } from './onboarding-flow';

describe('OnboardingWizard', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({
      providers: [provideCustomerApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(OnboardingWizard);
    await fixture.whenStable();
    return fixture;
  }

  /** Step 1 answered, so the footer will let the wizard move. */
  function answerStepOne(wizard: OnboardingWizard): void {
    wizard.state.set({
      ...defaultState(),
      agreed: true,
      f: {
        ...defaultState().f,
        firstName: 'Peter',
        lastName: 'de Vries',
        email: 'p.devries@vandersteen.nl',
        password: 'correct-horse-battery',
      },
    });
  }

  afterEach(() => http.verify());

  it('opens on step 1 of 10 and prints that step\'s own title and intro', async () => {
    const fixture = await render();

    expect(fixture.componentInstance.step()).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Step 1 of 10');
    expect(fixture.nativeElement.textContent).toContain('Personal information');
    expect(fixture.nativeElement.textContent)
      .toContain('Start with the person who will manage the account.');
  });

  it('draws the rail with all ten labels, grouped', async () => {
    const fixture = await render();

    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.rail-label') as NodeListOf<HTMLElement>,
    ).map((el) => el.textContent?.trim());

    expect(labels).toHaveLength(10);
    expect(labels[0]).toBe('Personal information');
    expect(labels[9]).toBe('Welcome');
    expect(fixture.nativeElement.querySelectorAll('.rail-group').length).toBe(6);
  });

  it('takes the footer button label from the step, not from arithmetic', async () => {
    const fixture = await render();

    expect(fixture.componentInstance.nextLabel()).toBe('Create account');

    fixture.componentInstance.state.update((s) => ({ ...s, step: 2 }));
    await fixture.whenStable();
    expect(fixture.componentInstance.nextLabel()).toBe('Next');
  });

  it('refuses to continue while the step is unanswered, and says what is missing', async () => {
    const fixture = await render();

    expect(fixture.componentInstance.canContinue()).toBe(false);
    expect(fixture.componentInstance.hint()).toBe('Enter your first and last name to continue.');

    fixture.componentInstance.next();
    await fixture.whenStable();

    http.expectNone('/api/v1/onboarding/applications');
  });

  it('starts the application on step 1 and keeps the reference the server assigned', async () => {
    const fixture = await render();
    answerStepOne(fixture.componentInstance);
    await fixture.whenStable();

    fixture.componentInstance.next();

    const req = http.expectOne('/api/v1/onboarding/applications');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      firstName: 'Peter',
      lastName: 'de Vries',
      email: 'p.devries@vandersteen.nl',
      password: 'correct-horse-battery',
      termsAccepted: true,
    });
    req.flush({ id: 'app-1', reference: 'PP-ONB-7F3K', status: 'Draft' });
    await fixture.whenStable();

    expect(fixture.componentInstance.step()).toBe(2);
    expect(fixture.componentInstance.state().applicationId).toBe('app-1');
    expect(fixture.componentInstance.reference()).toBe('PP-ONB-7F3K');
  });

  it('PATCHes one step at a time from step 2 onwards', async () => {
    const fixture = await render();
    fixture.componentInstance.state.update((s) => ({
      ...s,
      step: 2,
      applicationId: 'app-1',
      f: { ...s.f, orgName: 'Vandersteen Koeling B.V.', kvk: '24398112' },
    }));
    await fixture.whenStable();

    fixture.componentInstance.next();

    const req = http.expectOne('/api/v1/onboarding/applications/app-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.step).toBe(2);
    expect(req.request.body.kvkNumber).toBe('24398112');
    req.flush({ id: 'app-1', reference: 'PP-ONB-7F3K', status: 'Draft' });
    await fixture.whenStable();

    expect(fixture.componentInstance.step()).toBe(3);
  });

  it('stays on the step and shows the server\'s complaint when the save is refused', async () => {
    const fixture = await render();
    answerStepOne(fixture.componentInstance);
    await fixture.whenStable();

    fixture.componentInstance.next();
    http.expectOne('/api/v1/onboarding/applications').flush(
      { title: 'The request is not valid.', errors: { email: ['That address already has an account.'] } },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();

    expect(fixture.componentInstance.step()).toBe(1);
    expect(fixture.componentInstance.summary()).toBe('That address already has an account.');
    expect(fixture.componentInstance.busy()).toBe(false);
  });

  it('lets the rail go back but never forward', async () => {
    const fixture = await render();
    fixture.componentInstance.state.update((s) => ({ ...s, step: 4, applicationId: 'app-1' }));
    await fixture.whenStable();

    fixture.componentInstance.goto(9);
    expect(fixture.componentInstance.step()).toBe(4);

    fixture.componentInstance.goto(2);
    expect(fixture.componentInstance.step()).toBe(2);
  });

  it('going back re-answers a step rather than re-posting it', async () => {
    // back() touches no network: the answers are already on the server, and a PATCH on the way
    // backwards would overwrite step 3 with step 4's payload.
    const fixture = await render();
    fixture.componentInstance.state.update((s) => ({ ...s, step: 5, applicationId: 'app-1' }));
    await fixture.whenStable();

    fixture.componentInstance.back();
    await fixture.whenStable();

    expect(fixture.componentInstance.step()).toBe(4);
  });
});
```

- [ ] **Step 6: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- onboarding-wizard`
Expected: FAIL — `Failed to resolve import "./onboarding-wizard"`

- [ ] **Step 7: Write the wizard shell**

Create `apps/customer-portal/src/app/onboarding/onboarding-wizard.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { CustomerApiClient } from '@peakpower-nl/api-client-customer';
import type { OnboardingApplicationResponse } from '@peakpower-nl/api-client-customer';
import { PpButton } from '@peakpower-nl/shared-ui';

import { applyProblemDetails } from '../shared/apply-problem-details';
import {
  LAST_STEP,
  STEPS,
  clampStep,
  defaultState,
  hint,
  saveStepRequest,
  stepIntro,
  stepTitle,
  stepValid,
} from './onboarding-flow';
import type { OnboardingState, OnboardingStep } from './onboarding-flow';

/** A rail entry: either a group heading or one of the ten steps. */
interface RailRow {
  readonly kind: 'group' | 'step';
  readonly text: string;
  readonly n: number;
  readonly done: boolean;
  readonly current: boolean;
  readonly reachable: boolean;
}

@Component({
  selector: 'pp-onboarding-wizard',
  standalone: true,
  imports: [PpButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell">
      <nav class="rail">
        <div class="rail-brand">
          <div>
            <div class="name">PeakPower</div>
            <div class="sub">TRADING</div>
          </div>
        </div>

        <div class="rail-intro">
          <div class="t">Create your account</div>
          <div class="d">
            Ten short steps. Your answers are saved as you go, so you can stop and come back.
          </div>
        </div>

        <div class="rail-steps">
          @for (row of railRows(); track row.text) {
            @if (row.kind === 'group') {
              <div class="rail-group">{{ row.text }}</div>
            } @else {
              <div
                class="rail-step"
                [class.done]="row.done"
                [class.current]="row.current"
                [class.reachable]="row.reachable"
                (click)="goto(row.n)"
              >
                <div class="rail-dot">{{ row.done ? '✓' : row.n }}</div>
                <div class="rail-label">{{ row.text }}</div>
              </div>
            }
          }
        </div>

        <div class="rail-foot">
          <div class="k">APPLICATION</div>
          <div class="v">{{ reference() }}</div>
          <div class="n">Quote this reference on anything you send us about this application.</div>
        </div>
      </nav>

      <main class="flow">
        <div class="flow-inner">
          <div class="step-eyebrow">
            <span class="n">Step {{ step() }} of {{ lastStep }}</span>
            <span>{{ current().group }}</span>
          </div>
          <div class="progress"><i [style.width.%]="progress()"></i></div>

          <h1 class="step-title">{{ title() }}</h1>
          <p class="step-intro">{{ intro() }}</p>

          @if (summary()) {
            <p class="summary" role="alert">{{ summary() }}</p>
          }

          <div class="step-body">
            <!-- Tasks 18 to 21 each add their @switch arm here. -->
          </div>

          <div class="footer">
            <span class="hint">{{ hint() }}</span>
            <div class="actions">
              @if (step() > 1 && step() < lastStep) {
                <pp-button variant="secondary" (click)="back()">Back</pp-button>
              }
              @if (step() < lastStep) {
                <pp-button variant="primary" [disabled]="!canContinue()" (click)="next()">
                  {{ busy() ? 'Saving…' : nextLabel() }}
                </pp-button>
              }
            </div>
          </div>
        </div>
      </main>
    </div>
  `,
  styles: `
    :host { display: block; }
    .shell { display: flex; min-height: 100vh; }
    /* Wider than the portal's 236px on purpose: this rail carries ten step labels rather than
       seven one-word nav entries, and "Authorised signatories" wraps at 236. */
    .rail {
      width: 296px; min-width: 296px; background: var(--pp-sidebar-bg);
      display: flex; flex-direction: column; position: relative;
    }
    .rail::before {
      content: ''; position: absolute; left: 0; right: 0; top: 0; height: 3px;
      background: var(--pp-rail-spectrum);
    }
    .rail-brand { padding: 22px 24px 18px; }
    .rail-brand .name { color: #fff; font-size: 15px; font-weight: 700; line-height: 1.1; }
    .rail-brand .sub {
      color: var(--pp-sidebar-subtitle); font-size: 10px; font-weight: 600; margin-top: 2px;
    }
    .rail-intro { padding: 8px 24px 18px; }
    .rail-intro .t { color: #fff; font-size: 13.5px; font-weight: 700; }
    .rail-intro .d { color: #93a2b5; font-size: 11.5px; line-height: 1.5; margin-top: 5px; }
    .rail-steps { padding: 0 14px; display: flex; flex-direction: column; gap: 2px; }
    .rail-group {
      padding: 12px 10px 6px; font-size: 9.5px; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; color: #7b8ba0;
    }
    .rail-step {
      display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 8px;
    }
    /* Only a step already reached is reachable — a rail that looks clickable everywhere and
       answers on three of ten is worse than one that does not. */
    .rail-step.reachable { cursor: pointer; }
    .rail-step.reachable:hover { background: rgba(255, 255, 255, 0.06); }
    .rail-step.current { background: var(--pp-sidebar-active-bg); }
    .rail-dot {
      width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0; display: flex;
      align-items: center; justify-content: center; font-size: 10px; font-weight: 700;
      border: 1px solid rgba(255, 255, 255, 0.28); color: #93a2b5;
    }
    .rail-step.done .rail-dot {
      background: var(--pp-mint); border-color: var(--pp-mint); color: #fff;
    }
    .rail-step.current .rail-dot {
      background: var(--pp-blue-700); border-color: var(--pp-blue-700); color: #fff;
    }
    .rail-label { font-size: 12px; color: #93a2b5; line-height: 1.35; }
    .rail-step.done .rail-label { color: var(--pp-sidebar-text); }
    .rail-step.current .rail-label { color: #fff; font-weight: 600; }
    .rail-foot {
      margin-top: auto; padding: 18px 24px 22px; margin-left: 14px; margin-right: 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.09);
    }
    .rail-foot .k {
      font-size: 9.5px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
      color: #7b8ba0;
    }
    .rail-foot .v {
      font-family: var(--font-mono); font-size: 11.5px; color: var(--pp-sidebar-text);
      margin-top: 5px;
    }
    .rail-foot .n { font-size: 10.5px; color: #7b8ba0; margin-top: 8px; line-height: 1.45; }

    .flow { flex: 1; display: flex; justify-content: center; padding: 34px 44px 56px; }
    .flow-inner { width: 100%; max-width: 780px; display: flex; flex-direction: column; }
    .step-eyebrow {
      display: flex; align-items: baseline; justify-content: space-between; gap: 16px;
      font-size: 10.5px; color: var(--pp-text-faint);
    }
    .step-eyebrow .n { font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .progress {
      height: 4px; border-radius: 999px; background: var(--pp-border); overflow: hidden;
      margin-top: 8px;
    }
    .progress > i {
      display: block; height: 100%; background: var(--pp-blue-700); border-radius: 999px;
    }
    .step-title { font-size: 23px; font-weight: 700; letter-spacing: -0.01em; margin: 14px 0 0; }
    .step-intro {
      font-size: 12.5px; color: var(--pp-text-body); line-height: 1.55; margin: 6px 0 0;
      max-width: 620px;
    }
    .summary {
      margin: 16px 0 0; padding: 10px 12px; border-radius: 6px;
      border: 1px solid var(--pp-red-border); background: var(--pp-red-surface);
      color: var(--pp-red-text); font-size: 12.5px; line-height: 1.45;
    }
    .step-body { display: flex; flex-direction: column; gap: 18px; margin-top: 18px; }
    .footer {
      display: flex; align-items: center; justify-content: space-between; gap: 20px;
      margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--pp-border);
    }
    .hint { font-size: 11.5px; color: var(--pp-text-faint); line-height: 1.5; }
    .actions { display: flex; gap: 10px; flex-shrink: 0; }
  `,
})
export class OnboardingWizard {
  private readonly api = inject(CustomerApiClient);

  readonly lastStep = LAST_STEP;
  readonly state = signal<OnboardingState>(defaultState());
  readonly busy = signal(false);
  readonly summary = signal<string | null>(null);

  readonly step = computed(() => this.state().step);
  readonly current = computed<OnboardingStep>(() => STEPS[this.state().step - 1]);
  readonly title = computed(() => stepTitle(this.state()));
  readonly intro = computed(() => stepIntro(this.state()));
  readonly hint = computed(() => hint(this.state()));
  readonly nextLabel = computed(() => this.current().next ?? 'Next');
  readonly canContinue = computed(() => stepValid(this.state()) && !this.busy());
  readonly progress = computed(() => Math.round((this.state().step / LAST_STEP) * 100));
  readonly reference = computed(() => this.state().reference ?? 'Not yet issued');

  readonly railRows = computed<readonly RailRow[]>(() => {
    const step = this.state().step;
    const rows: RailRow[] = [];
    let lastGroup: string | null = null;

    for (const st of STEPS) {
      if (st.group !== lastGroup) {
        rows.push({
          kind: 'group', text: st.group, n: 0, done: false, current: false, reachable: false,
        });
        lastGroup = st.group;
      }
      rows.push({
        kind: 'step',
        text: st.label,
        n: st.n,
        done: st.n < step,
        current: st.n === step,
        reachable: st.n <= step,
      });
    }
    return rows;
  });

  /** Backwards only. The rail must never skip a step whose answers have not been given. */
  goto(n: number): void {
    if (n === 0 || n > this.state().step || this.busy()) return;
    this.summary.set(null);
    this.state.update((s) => ({ ...s, step: clampStep(n) }));
  }

  /**
   * No network. The answers already reached the server on the way forward, and a PATCH on the
   * way back would overwrite the earlier step with the later step's payload.
   */
  back(): void {
    if (this.state().step <= 1 || this.busy()) return;
    this.summary.set(null);
    this.state.update((s) => ({ ...s, step: s.step - 1 }));
  }

  next(): void {
    // Re-checked here, not only on the disabled button: a stale screen must not walk past a
    // step it has not answered.
    if (!stepValid(this.state()) || this.busy()) return;
    if (this.state().step >= LAST_STEP) return;

    this.summary.set(null);
    const state = this.state();

    if (state.step === 1) {
      this.send(this.startApplication(state));
      return;
    }

    const id = state.applicationId;
    if (id === null) {
      this.summary.set('This application was not started. Go back to step 1 and begin again.');
      return;
    }

    this.send(
      this.api.saveOnboardingStep(id, saveStepRequest(state, state.step)),
      () => this.advance(),
    );
  }

  private startApplication(state: OnboardingState) {
    return this.api.startOnboarding({
      firstName: state.f.firstName.trim(),
      lastName: state.f.lastName.trim(),
      email: state.f.email.trim(),
      password: state.f.password,
      termsAccepted: state.agreed,
    });
  }

  /**
   * One place where a step's call is made, its outcome recorded and the wizard moved on.
   *
   * `applyProblemDetails` normally puts messages onto a reactive form; the wizard holds its
   * answers in one signal rather than eleven form groups, so it is handed an empty group and
   * every message comes back as the summary. That is the behaviour wanted here — an onboarding
   * step has one error line, above the body.
   */
  private send(
    call: import('rxjs').Observable<OnboardingApplicationResponse>,
    onSuccess: (response: OnboardingApplicationResponse) => void = (r) => this.accept(r),
  ): void {
    this.busy.set(true);
    call.subscribe({
      next: (response) => {
        this.busy.set(false);
        onSuccess(response);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.summary.set(applyProblemDetails(new FormGroup({}), error));
      },
    });
  }

  private accept(response: OnboardingApplicationResponse): void {
    this.state.update((s) => ({
      ...s,
      applicationId: response.id,
      reference: response.reference,
      step: s.step + 1,
    }));
  }

  private advance(): void {
    this.state.update((s) => ({ ...s, step: s.step + 1 }));
  }
}
```

- [ ] **Step 8: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- onboarding-wizard`
Expected: PASS — 9 tests

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/onboarding
git commit -m "feat(customer-portal): port the onboarding step table and build the wizard shell"
```

---

### Task 18: Wizard steps 1 and 2 — the account and the company

Step 1 creates the credential `[DEC-113]`, so it is the one step in the flow that a reader
should look at twice. Two rules govern it and neither is negotiable:

**The password minimum counts down, and the browser never enforces it twice.** The hint says
"3 characters to go" because "at least 12 characters" stops being actionable the moment you
start typing. The *rule* lives in `PasswordPolicy.MinimumLength` on the server; the browser's
`stepValid` gate exists to stop a pointless round trip, and if `[OQ-98]` moves the number the
server is what refuses.

**The terms tick is part of the payload, not decoration.** `StartOnboardingRequest.TermsAccepted`
travels with the account, so the record of what was agreed to is where the account is, not in a
front-end boolean nobody kept.

Step 2 is the KvK step. Eight digits `[F01-R03]`, read out of whatever was pasted, and the wire
value carries the digits alone.

**Files:** *(run from `/Users/thinhhuynh/PeakPower/peakpower-web`)*
- Create: `apps/customer-portal/src/app/onboarding/steps/step-account.ts`
- Create: `apps/customer-portal/src/app/onboarding/steps/step-company.ts`
- Modify: `apps/customer-portal/src/app/onboarding/onboarding-wizard.ts`
- Test: `apps/customer-portal/src/app/onboarding/steps/step-account.spec.ts`
- Test: `apps/customer-portal/src/app/onboarding/steps/step-company.spec.ts`

**Interfaces:**
- Consumes: `OnboardingState`, `OnboardingFields`, `ENTITY_TYPES`, `MIN_PASSWORD`,
  `withField`, `inputValue`, `defaultState` (Task 17); `PpCard` from `@peakpower-nl/shared-ui`.
- Produces:
  - `export class StepAccount` — selector `pp-step-account`, `state = model.required<OnboardingState>()`
  - `export class StepCompany` — selector `pp-step-company`, `state = model.required<OnboardingState>()`

- [ ] **Step 1: Write the failing tests**

Create `apps/customer-portal/src/app/onboarding/steps/step-account.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect } from 'vitest';

import { StepAccount } from './step-account';
import { defaultState } from '../onboarding-flow';
import type { OnboardingState } from '../onboarding-flow';

async function render(initial: OnboardingState = defaultState()) {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(StepAccount);
  const state = signal(initial);
  fixture.componentRef.setInput('state', state());
  await fixture.whenStable();
  return fixture;
}

function type(fixture: Awaited<ReturnType<typeof render>>, id: string, value: string): void {
  const input = fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('StepAccount', () => {
  it('asks for the four fields the account is made of', async () => {
    const fixture = await render();

    for (const id of ['firstName', 'lastName', 'email', 'password']) {
      expect(fixture.nativeElement.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it('writes what is typed back into the state', async () => {
    const fixture = await render();

    type(fixture, 'firstName', 'Peter');
    await fixture.whenStable();

    expect(fixture.componentInstance.state().f.firstName).toBe('Peter');
  });

  it('counts the password down instead of repeating the rule', async () => {
    const fixture = await render();
    expect(fixture.componentInstance.passwordNote()).toBe('At least 12 characters.');

    type(fixture, 'password', '123456789');
    await fixture.whenStable();
    expect(fixture.componentInstance.passwordNote()).toBe('3 characters to go.');

    type(fixture, 'password', 'correct-horse-battery');
    await fixture.whenStable();
    expect(fixture.componentInstance.passwordNote()).toBe('Long enough.');
  });

  it('toggles the terms, because they travel with the request', async () => {
    const fixture = await render();
    expect(fixture.componentInstance.state().agreed).toBe(false);

    fixture.componentInstance.toggleTerms();
    await fixture.whenStable();

    expect(fixture.componentInstance.state().agreed).toBe(true);
  });

  it('never renders the password as readable text', async () => {
    const fixture = await render();

    const password = fixture.nativeElement.querySelector('#password') as HTMLInputElement;
    expect(password.type).toBe('password');
    expect(password.getAttribute('autocomplete')).toBe('new-password');
  });
});
```

Create `apps/customer-portal/src/app/onboarding/steps/step-company.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect } from 'vitest';

import { StepCompany } from './step-company';
import { defaultState } from '../onboarding-flow';

async function render() {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(StepCompany);
  fixture.componentRef.setInput('state', defaultState());
  await fixture.whenStable();
  return fixture;
}

describe('StepCompany', () => {
  it('offers all nine Dutch legal forms, with BV first', async () => {
    const fixture = await render();

    const options = Array.from(
      fixture.nativeElement.querySelectorAll('#entity option') as NodeListOf<HTMLOptionElement>,
    ).map((o) => o.textContent?.trim());

    expect(options).toHaveLength(9);
    expect(options[0]).toBe('BV');
    expect(options[8]).toBe('Coöperatie');
  });

  it('records the legal form by index when one is chosen', async () => {
    const fixture = await render();
    const select = fixture.nativeElement.querySelector('#entity') as HTMLSelectElement;

    select.value = '2';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(fixture.componentInstance.state().entityIndex).toBe(2);
  });

  it('keeps whatever was pasted into the KvK box and lets the flow read the digits', async () => {
    const fixture = await render();
    const kvk = fixture.nativeElement.querySelector('#kvk') as HTMLInputElement;

    kvk.value = '24.398.112';
    kvk.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(fixture.componentInstance.state().f.kvk).toBe('24.398.112');
  });

  it('says what a KvK number is, in Dutch, once', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.textContent)
      .toContain('Nummer Kamer van Koophandel — eight digits, no spaces.');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- step-account step-company`
Expected: FAIL — `Failed to resolve import "./step-account"`

- [ ] **Step 3: Write step 1**

Create `apps/customer-portal/src/app/onboarding/steps/step-account.ts`:

```ts
import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { PpCard } from '@peakpower-nl/shared-ui';

import { MIN_PASSWORD, inputValue, withField } from '../onboarding-flow';
import type { OnboardingFields, OnboardingState } from '../onboarding-flow';

/**
 * Step 1 — the person, and the credential [DEC-113].
 *
 * The twelve-character minimum is stated as a countdown, and the RULE lives on the server:
 * PasswordPolicy.MinimumLength is what refuses. The gate here only saves a round trip.
 */
@Component({
  selector: 'pp-step-account',
  standalone: true,
  imports: [PpCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-card heading="Personal information" subtitle="This becomes the account you sign in with">
      <div class="fields two">
        <div class="field">
          <label class="fg-label" for="firstName">First name</label>
          <input
            id="firstName"
            type="text"
            autocomplete="given-name"
            placeholder="Peter"
            [value]="state().f.firstName"
            (input)="set('firstName', $event)"
          />
        </div>
        <div class="field">
          <label class="fg-label" for="lastName">Last name</label>
          <input
            id="lastName"
            type="text"
            autocomplete="family-name"
            placeholder="de Vries"
            [value]="state().f.lastName"
            (input)="set('lastName', $event)"
          />
        </div>
      </div>

      <div class="field">
        <label class="fg-label" for="email">Email</label>
        <input
          id="email"
          type="email"
          autocomplete="email"
          placeholder="p.devries@company.nl"
          [value]="state().f.email"
          (input)="set('email', $event)"
        />
      </div>

      <div class="field">
        <label class="fg-label" for="password">Password</label>
        <input
          id="password"
          type="password"
          autocomplete="new-password"
          [attr.placeholder]="'At least ' + minPassword + ' characters'"
          [value]="state().f.password"
          (input)="set('password', $event)"
        />
        <p class="fg-hint">{{ passwordNote() }}</p>
      </div>

      <div class="terms" [class.on]="state().agreed" (click)="toggleTerms()">
        <div class="terms-box">{{ state().agreed ? '✓' : '' }}</div>
        <div class="terms-text">
          By creating an account, I agree to the Terms of Use and confirm I may act for the
          company named in the next step.
        </div>
      </div>
    </pp-card>
  `,
  styles: `
    .fields.two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .field { min-width: 0; margin-bottom: 14px; }
    .fields.two .field { margin-bottom: 0; }
    .fields.two { margin-bottom: 14px; }
    .fg-label {
      display: block; font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; color: var(--pp-text-body); margin-bottom: 6px;
    }
    .fg-hint { font-size: 11px; color: var(--pp-text-faint); margin: 6px 0 0; line-height: 1.5; }
    input {
      width: 100%; box-sizing: border-box; font: inherit; font-size: 12.5px; padding: 10px 12px;
      border: 1px solid var(--pp-border); border-radius: 8px; background: var(--pp-surface);
      color: var(--pp-text-heading);
    }
    input:focus { outline: none; border-color: var(--pp-blue-300); }
    .terms {
      display: flex; align-items: flex-start; gap: 10px; margin-top: 18px; padding-top: 14px;
      border-top: 1px solid var(--pp-border); cursor: pointer;
    }
    .terms-box {
      width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0; margin-top: 1px;
      border: 1px solid var(--pp-border-strong); background: #fff; color: #fff; font-size: 10px;
      font-weight: 700; display: flex; align-items: center; justify-content: center;
    }
    .terms.on .terms-box { border-color: var(--pp-blue-700); background: var(--pp-blue-700); }
    .terms-text { font-size: 12px; color: var(--pp-text-body); line-height: 1.5; }
  `,
})
export class StepAccount {
  readonly state = model.required<OnboardingState>();
  readonly minPassword = MIN_PASSWORD;

  set(key: keyof OnboardingFields, event: Event): void {
    this.state.update((s) => withField(s, key, inputValue(event)));
  }

  toggleTerms(): void {
    this.state.update((s) => ({ ...s, agreed: !s.agreed }));
  }

  /** Counts down rather than repeating the rule. */
  passwordNote(): string {
    const n = this.state().f.password.length;
    if (n === 0) return `At least ${MIN_PASSWORD} characters.`;
    if (n < MIN_PASSWORD) return `${MIN_PASSWORD - n} characters to go.`;
    return 'Long enough.';
  }
}
```

- [ ] **Step 4: Write step 2**

Create `apps/customer-portal/src/app/onboarding/steps/step-company.ts`:

```ts
import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { PpCard } from '@peakpower-nl/shared-ui';

import { ENTITY_TYPES, inputValue, withField } from '../onboarding-flow';
import type { OnboardingFields, OnboardingState } from '../onboarding-flow';

/**
 * Step 2 — the legal entity PeakPower contracts with.
 *
 * The KvK box keeps exactly what was pasted, dots and all; `kvkDigits` is what the gate and the
 * wire read. Reformatting someone's typing under their caret is its own small betrayal.
 */
@Component({
  selector: 'pp-step-company',
  standalone: true,
  imports: [PpCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-card
      heading="Company or organization"
      subtitle="The legal entity PeakPower contracts with"
    >
      <div class="field">
        <label class="fg-label" for="orgName">Organization name</label>
        <input
          id="orgName"
          type="text"
          autocomplete="organization"
          placeholder="Vandersteen Koeling B.V."
          [value]="state().f.orgName"
          (input)="set('orgName', $event)"
        />
      </div>

      <div class="fields two">
        <div class="field">
          <label class="fg-label" for="entity">Legal entity type</label>
          <select id="entity" (change)="setEntity($event)">
            @for (entity of entityTypes; track entity.wire; let i = $index) {
              <option [value]="i" [selected]="i === state().entityIndex">{{ entity.label }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label class="fg-label" for="kvk">Registration number</label>
          <input
            id="kvk"
            class="mono"
            type="text"
            inputmode="numeric"
            placeholder="8 digits"
            [value]="state().f.kvk"
            (input)="set('kvk', $event)"
          />
          <p class="fg-hint">Nummer Kamer van Koophandel — eight digits, no spaces.</p>
        </div>
      </div>
    </pp-card>
  `,
  styles: `
    .fields.two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
    .field { min-width: 0; }
    .fg-label {
      display: block; font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; color: var(--pp-text-body); margin-bottom: 6px;
    }
    .fg-hint { font-size: 11px; color: var(--pp-text-faint); margin: 6px 0 0; line-height: 1.5; }
    input, select {
      width: 100%; box-sizing: border-box; font: inherit; font-size: 12.5px; padding: 10px 12px;
      border: 1px solid var(--pp-border); border-radius: 8px; background: var(--pp-surface);
      color: var(--pp-text-heading);
    }
    input.mono { font-family: var(--font-mono); }
    input:focus, select:focus { outline: none; border-color: var(--pp-blue-300); }
  `,
})
export class StepCompany {
  readonly state = model.required<OnboardingState>();
  readonly entityTypes = ENTITY_TYPES;

  set(key: keyof OnboardingFields, event: Event): void {
    this.state.update((s) => withField(s, key, inputValue(event)));
  }

  setEntity(event: Event): void {
    const index = Number(inputValue(event));
    this.state.update((s) => ({ ...s, entityIndex: Number.isFinite(index) ? index : 0 }));
  }
}
```

- [ ] **Step 5: Give the wizard its first two arms**

In `apps/customer-portal/src/app/onboarding/onboarding-wizard.ts`, add the two imports:

```ts
import { StepAccount } from './steps/step-account';
import { StepCompany } from './steps/step-company';
```

change the component's `imports` array to `[PpButton, StepAccount, StepCompany]`, and replace the
empty step body with:

```html
          <div class="step-body">
            @switch (step()) {
              @case (1) { <pp-step-account [(state)]="state" /> }
              @case (2) { <pp-step-company [(state)]="state" /> }
            }
          </div>
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- step-account step-company onboarding-wizard`
Expected: PASS — 18 tests

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/onboarding
git commit -m "feat(customer-portal): onboarding steps 1 and 2 — the account and the company"
```

---

### Task 19: Wizard steps 3, 4 and 5 — the address, the industry and the volume

Three short steps and one shared control. Steps 3 and 4 are the two the demo lets through
unanswered on purpose: a company whose address the KvK register does not carry must not be
stopped at step 3, and an industry that fits none of the twenty-four must not be forced into
one. Both say so in the hint rather than being silently permissive.

Step 5 introduces **the choice control** — one bordered row carrying its own selected state. It
answers three questions in this flow (direction, volume, and the signing authority on step 7),
so it is written once here and reused rather than invented three times.

Step 5's second card names the direction the customer just picked, in its subtitle. That is the
one place in the wizard where an answer is reflected back before it is submitted, and it is
worth keeping: it makes "net volume" mean something specific.

**Files:** *(run from `/Users/thinhhuynh/PeakPower/peakpower-web`)*
- Modify: `apps/customer-portal/src/app/onboarding/steps/step-company.ts`
- Create: `apps/customer-portal/src/app/onboarding/steps/step-volume.ts`
- Modify: `apps/customer-portal/src/app/onboarding/onboarding-wizard.ts`
- Test: `apps/customer-portal/src/app/onboarding/steps/step-address.spec.ts`
- Test: `apps/customer-portal/src/app/onboarding/steps/step-volume.spec.ts`

**Interfaces:**
- Consumes: `OnboardingState`, `INDUSTRIES`, `FLOWS`, `VOLUMES`, `kvkDigits`, `withField`,
  `inputValue` (Task 17); `PpCard`, `PpBanner` from `@peakpower-nl/shared-ui`.
- Produces:
  - `export class StepAddress` — selector `pp-step-address`, in `steps/step-company.ts`
  - `export class StepIndustry` — selector `pp-step-industry`, in `steps/step-company.ts`
  - `export class StepVolume` — selector `pp-step-volume`, in `steps/step-volume.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/customer-portal/src/app/onboarding/steps/step-address.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect } from 'vitest';

import { StepAddress, StepIndustry } from './step-company';
import { INDUSTRIES, defaultState } from '../onboarding-flow';
import type { OnboardingState } from '../onboarding-flow';

async function renderAddress(state: OnboardingState = defaultState()) {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(StepAddress);
  fixture.componentRef.setInput('state', state);
  await fixture.whenStable();
  return fixture;
}

describe('StepAddress', () => {
  it('asks for the five parts of a Dutch address the contract carries', async () => {
    const fixture = await renderAddress();

    // Six on the wire; `country` is NL and is not a question.
    for (const id of ['street', 'houseNumber', 'houseNumberSuffix', 'postcode', 'city']) {
      expect(fixture.nativeElement.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it('says nothing was looked up when there is no KvK number to look up by', async () => {
    const fixture = await renderAddress();

    expect(fixture.nativeElement.textContent).toContain('We look the address up by KvK number.');
  });

  it('names the number it looked up once there is one', async () => {
    const state = defaultState();
    const fixture = await renderAddress({ ...state, f: { ...state.f, kvk: '24398112' } });

    expect(fixture.nativeElement.textContent)
      .toContain('Fetched from the KvK register for number 24398112.');
  });

  it('says out loud that blank is acceptable', async () => {
    const fixture = await renderAddress();

    expect(fixture.nativeElement.textContent)
      .toContain('the desk resolves the address during review');
  });

  it('writes the house number back into the state', async () => {
    const fixture = await renderAddress();
    const input = fixture.nativeElement.querySelector('#houseNumber') as HTMLInputElement;

    input.value = '22';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(fixture.componentInstance.state().f.houseNumber).toBe('22');
  });
});

describe('StepIndustry', () => {
  async function renderIndustry() {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(StepIndustry);
    fixture.componentRef.setInput('state', defaultState());
    await fixture.whenStable();
    return fixture;
  }

  it('lists all twenty-five options with "Not specified" selected', async () => {
    const fixture = await renderIndustry();

    const options = Array.from(
      fixture.nativeElement.querySelectorAll('#industry option') as NodeListOf<HTMLOptionElement>,
    );
    expect(options).toHaveLength(INDUSTRIES.length);
    expect(options[0].textContent?.trim()).toBe('Not specified');
    expect(fixture.componentInstance.state().industryIndex).toBe(0);
  });

  it('records the industry by index', async () => {
    const fixture = await renderIndustry();
    const select = fixture.nativeElement.querySelector('#industry') as HTMLSelectElement;

    select.value = String(INDUSTRIES.indexOf('Energy & Utilities'));
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(INDUSTRIES[fixture.componentInstance.state().industryIndex]).toBe('Energy & Utilities');
  });

  it('says it is optional rather than marking it with an asterisk nobody explains', async () => {
    const fixture = await renderIndustry();

    expect(fixture.nativeElement.textContent).toContain('Not mandatory.');
  });
});
```

Create `apps/customer-portal/src/app/onboarding/steps/step-volume.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect } from 'vitest';

import { StepVolume } from './step-volume';
import { defaultState } from '../onboarding-flow';

async function render() {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(StepVolume);
  fixture.componentRef.setInput('state', defaultState());
  await fixture.whenStable();
  return fixture;
}

describe('StepVolume', () => {
  it('asks the direction first, with three answers', async () => {
    const fixture = await render();

    const choices = fixture.nativeElement.querySelectorAll('.flow-choices .choice');
    expect(choices).toHaveLength(3);
    expect(choices[2].textContent).toContain('Both');
  });

  it('offers the five bands and starts with none of them chosen', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.querySelectorAll('.volume-choices .choice')).toHaveLength(5);
    expect(fixture.componentInstance.state().volumeIndex).toBe(-1);
    expect(fixture.nativeElement.querySelectorAll('.volume-choices .choice.on')).toHaveLength(0);
  });

  it('records a band when one is clicked', async () => {
    const fixture = await render();

    const bands = fixture.nativeElement
      .querySelectorAll('.volume-choices .choice') as NodeListOf<HTMLElement>;
    bands[3].click();
    await fixture.whenStable();

    expect(fixture.componentInstance.state().volumeIndex).toBe(3);
  });

  it('names the direction that was picked in the volume question', async () => {
    const fixture = await render();

    const directions = fixture.nativeElement
      .querySelectorAll('.flow-choices .choice') as NodeListOf<HTMLElement>;
    directions[1].click();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent)
      .toContain('Net volume across all your connections — production selected');
  });

  it('says what net volume means and that it is independent of fixing prices', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.textContent)
      .toContain('regardless of whether you choose to fix prices');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- step-address step-volume`
Expected: FAIL — `No export named 'StepAddress'` from `./step-company`

- [ ] **Step 3: Add steps 3 and 4 to `step-company.ts`**

Append to `apps/customer-portal/src/app/onboarding/steps/step-company.ts` — and extend the
existing import lines to `import { ENTITY_TYPES, INDUSTRIES, inputValue, kvkDigits, withField }
from '../onboarding-flow';` and `import { PpBanner, PpCard } from '@peakpower-nl/shared-ui';`:

```ts
/**
 * Step 3 — the registered address, as held in the KvK register.
 *
 * Six fields because OnboardingAddressDto is six fields. The demo asked for "Street and number"
 * in one box; splitting it here means no parser has to guess where the street stops.
 *
 * Blank is a valid answer and the step says so twice — once in the banner, once under the
 * fields. A company whose address the register does not carry must not be stuck here.
 */
@Component({
  selector: 'pp-step-address',
  standalone: true,
  imports: [PpCard, PpBanner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-banner tone="info">{{ lookupLine() }}</pp-banner>

    <pp-card heading="Registered address" subtitle="As held in the KvK register">
      <div class="fields street">
        <div class="field">
          <label class="fg-label" for="street">Street</label>
          <input
            id="street"
            type="text"
            autocomplete="address-line1"
            placeholder="Havenweg"
            [value]="state().f.street"
            (input)="set('street', $event)"
          />
        </div>
        <div class="field">
          <label class="fg-label" for="houseNumber">Number</label>
          <input
            id="houseNumber"
            type="text"
            placeholder="22"
            [value]="state().f.houseNumber"
            (input)="set('houseNumber', $event)"
          />
        </div>
        <div class="field">
          <label class="fg-label" for="houseNumberSuffix">Suffix</label>
          <input
            id="houseNumberSuffix"
            type="text"
            placeholder="A"
            [value]="state().f.houseNumberSuffix"
            (input)="set('houseNumberSuffix', $event)"
          />
        </div>
      </div>

      <div class="fields two">
        <div class="field">
          <label class="fg-label" for="postcode">Postcode</label>
          <input
            id="postcode"
            class="mono"
            type="text"
            autocomplete="postal-code"
            placeholder="3089 JJ"
            [value]="state().f.postcode"
            (input)="set('postcode', $event)"
          />
        </div>
        <div class="field">
          <label class="fg-label" for="city">City</label>
          <input
            id="city"
            type="text"
            autocomplete="address-level2"
            placeholder="Rotterdam"
            [value]="state().f.city"
            (input)="set('city', $event)"
          />
        </div>
      </div>

      <p class="note-foot">
        Nothing found for this number? Leave the fields blank and continue — the desk resolves
        the address during review.
      </p>
    </pp-card>
  `,
  styles: `
    .fields { display: grid; gap: 14px; margin-top: 14px; }
    .fields.street { grid-template-columns: 2fr 1fr 1fr; margin-top: 0; }
    .fields.two { grid-template-columns: 1fr 1.4fr; }
    .field { min-width: 0; }
    .fg-label {
      display: block; font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; color: var(--pp-text-body); margin-bottom: 6px;
    }
    input {
      width: 100%; box-sizing: border-box; font: inherit; font-size: 12.5px; padding: 10px 12px;
      border: 1px solid var(--pp-border); border-radius: 8px; background: var(--pp-surface);
      color: var(--pp-text-heading);
    }
    input.mono { font-family: var(--font-mono); }
    input:focus { outline: none; border-color: var(--pp-blue-300); }
    .note-foot {
      margin: 16px 0 0; padding-top: 14px; border-top: 1px solid var(--pp-border);
      font-size: 11.5px; color: var(--pp-text-faint); line-height: 1.5;
    }
  `,
})
export class StepAddress {
  readonly state = model.required<OnboardingState>();

  set(key: keyof OnboardingFields, event: Event): void {
    this.state.update((s) => withField(s, key, inputValue(event)));
  }

  lookupLine(): string {
    const kvk = kvkDigits(this.state().f.kvk);
    return kvk === ''
      ? 'We look the address up by KvK number. Nothing found means nothing was registered — '
        + 'leave it blank and continue.'
      : `Fetched from the KvK register for number ${kvk}. Every field stays editable.`;
  }
}

/**
 * Step 4 — the industry, and it is genuinely optional.
 *
 * Index 0 is "Not specified" and is what a wizard that was never touched sends: `null`. The
 * list is ordered as the demo ordered it, which is alphabetical after the leading option.
 */
@Component({
  selector: 'pp-step-industry',
  standalone: true,
  imports: [PpCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-card
      heading="Industry"
      subtitle="Optional — it shapes the load profile the desk starts from"
    >
      <div class="narrow">
        <label class="fg-label" for="industry">Industry</label>
        <select id="industry" (change)="setIndustry($event)">
          @for (industry of industries; track industry; let i = $index) {
            <option [value]="i" [selected]="i === state().industryIndex">{{ industry }}</option>
          }
        </select>
        <p class="fg-hint">Not mandatory. Leave it on "Not specified" if none of these fit.</p>
      </div>
    </pp-card>
  `,
  styles: `
    .narrow { max-width: 420px; }
    .fg-label {
      display: block; font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; color: var(--pp-text-body); margin-bottom: 6px;
    }
    .fg-hint { font-size: 11px; color: var(--pp-text-faint); margin: 6px 0 0; line-height: 1.5; }
    select {
      width: 100%; box-sizing: border-box; font: inherit; font-size: 12.5px; padding: 10px 12px;
      border: 1px solid var(--pp-border); border-radius: 8px; background: var(--pp-surface);
      color: var(--pp-text-heading);
    }
    select:focus { outline: none; border-color: var(--pp-blue-300); }
  `,
})
export class StepIndustry {
  readonly state = model.required<OnboardingState>();
  readonly industries = INDUSTRIES;

  setIndustry(event: Event): void {
    const index = Number(inputValue(event));
    this.state.update((s) => ({ ...s, industryIndex: Number.isFinite(index) ? index : 0 }));
  }
}
```

- [ ] **Step 4: Write step 5**

Create `apps/customer-portal/src/app/onboarding/steps/step-volume.ts`:

```ts
import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { PpCard } from '@peakpower-nl/shared-ui';

import { FLOWS, VOLUMES } from '../onboarding-flow';
import type { OnboardingState } from '../onboarding-flow';

/**
 * Step 5 — direction, then size.
 *
 * The choice control here is the same shape the signing-authority step uses: one bordered row
 * carrying its own selected state. Three questions in this flow ask for one answer out of a
 * list, and they should read as the same kind of question rather than three inventions.
 *
 * volumeIndex starts at −1, not 0: index 0 is a real answer ("less than 250 MWh"), so 0 cannot
 * also mean "not answered".
 */
@Component({
  selector: 'pp-step-volume',
  standalone: true,
  imports: [PpCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-card
      heading="Do you consume or produce electricity?"
      subtitle="Both is common — a site with solar still draws from the grid"
    >
      <div class="choices row flow-choices">
        @for (flow of flows; track flow.wire; let i = $index) {
          <div class="choice" [class.on]="i === state().flowIndex" (click)="pickFlow(i)">
            <div class="choice-label">{{ flow.label }}</div>
          </div>
        }
      </div>
    </pp-card>

    <pp-card heading="How much per year?" [subtitle]="volumeSubtitle()">
      <div class="choices volume-choices">
        @for (band of volumes; track band.wire; let i = $index) {
          <div class="choice" [class.on]="i === state().volumeIndex" (click)="pickVolume(i)">
            <div class="choice-dot"></div>
            <div class="choice-label">{{ band.label }}</div>
          </div>
        }
      </div>
      <p class="note-foot">
        This is your net electricity volume — consumption minus production, if applicable —
        regardless of whether you choose to fix prices.
      </p>
    </pp-card>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 18px; }
    .choices { display: flex; flex-direction: column; gap: 8px; }
    .choices.row { flex-direction: row; flex-wrap: wrap; }
    .choice {
      display: flex; align-items: flex-start; gap: 12px; border: 1px solid var(--pp-border);
      background: var(--pp-surface); border-radius: 8px; padding: 12px 15px; cursor: pointer;
    }
    .choices.row .choice { flex: 1 1 160px; }
    .choice:hover { border-color: var(--pp-border-strong); }
    .choice.on { border: 1.5px solid var(--pp-blue-700); background: var(--pp-blue-050); }
    .choice-dot {
      width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--pp-border-strong);
      background: #fff; flex-shrink: 0; margin-top: 2px;
    }
    .choice.on .choice-dot {
      border-color: var(--pp-blue-700); background: var(--pp-blue-700);
      box-shadow: inset 0 0 0 2px #fff;
    }
    .choice-label { font-size: 12.5px; font-weight: 600; color: var(--pp-text-heading); }
    .choice.on .choice-label { color: var(--pp-blue-700); }
    .note-foot {
      margin: 16px 0 0; padding-top: 14px; border-top: 1px solid var(--pp-border);
      font-size: 11.5px; color: var(--pp-text-faint); line-height: 1.5;
    }
  `,
})
export class StepVolume {
  readonly state = model.required<OnboardingState>();
  readonly flows = FLOWS;
  readonly volumes = VOLUMES;

  pickFlow(index: number): void {
    this.state.update((s) => ({ ...s, flowIndex: index }));
  }

  pickVolume(index: number): void {
    this.state.update((s) => ({ ...s, volumeIndex: index }));
  }

  /** Reflects the direction back, so "net volume" means something specific. */
  volumeSubtitle(): string {
    return `Net volume across all your connections — ${FLOWS[this.state().flowIndex].label.toLowerCase()} selected`;
  }
}
```

- [ ] **Step 5: Give the wizard arms 3, 4 and 5**

In `apps/customer-portal/src/app/onboarding/onboarding-wizard.ts`, extend the step imports:

```ts
import { StepAccount } from './steps/step-account';
import { StepAddress, StepCompany, StepIndustry } from './steps/step-company';
import { StepVolume } from './steps/step-volume';
```

set `imports: [PpButton, StepAccount, StepCompany, StepAddress, StepIndustry, StepVolume]`, and
extend the `@switch`:

```html
              @case (3) { <pp-step-address [(state)]="state" /> }
              @case (4) { <pp-step-industry [(state)]="state" /> }
              @case (5) { <pp-step-volume [(state)]="state" /> }
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- step-address step-volume onboarding-wizard`
Expected: PASS — 22 tests

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/onboarding
git commit -m "feat(customer-portal): onboarding steps 3, 4 and 5 — address, industry and volume"
```

---

### Task 20: Wizard steps 6 and 7 — bank verification and signing authority

Step 6 verifies that the bank account belongs to the company that is about to sign, by moving one
cent. It is the only step that reaches the API outside the footer, and it is the step where the
demo and the build differ most: the demo flipped a boolean, and here a Development-only endpoint
plan 5 already built — `POST /onboarding/applications/{id}/bank-verification/simulate` — stands
in for the payment rail, which is F07 and out of scope.

**The IBAN is asked for and the browser does not check it.** `Iban.Create` runs the structural
check and ISO 7064 mod-97 on the server `[F01-R03]`; a second copy in TypeScript is a second
copy that drifts. A malformed IBAN comes back as a 400 on the step's own save.

**Step 6 is passable unverified, and says so.** The agreement can be signed with the cent still
in flight; the account simply does not activate until it lands. That is what makes step 10 have
two outcomes, and pretending otherwise on step 6 would make step 10 look like a bug.

Step 7 is one question with three answers, and the answer **is** who signs — so changing it
rebuilds step 8's list. Re-clicking the answer already chosen is not a change and must not
rebuild anything, or a colleague typed in on step 8 vanishes with nothing on screen having moved.

**Files:** *(run from `/Users/thinhhuynh/PeakPower/peakpower-web`)*
- Create: `apps/customer-portal/src/app/onboarding/steps/step-bank.ts`
- Create: `apps/customer-portal/src/app/onboarding/steps/step-authority.ts`
- Modify: `apps/customer-portal/src/app/onboarding/onboarding-wizard.ts`
- Test: `apps/customer-portal/src/app/onboarding/steps/step-bank.spec.ts`
- Test: `apps/customer-portal/src/app/onboarding/steps/step-authority.spec.ts`

**Interfaces:**
- Consumes: `OnboardingState`, `AUTHORITY`, `signatoriesForAuthority`, `withField`, `inputValue`
  (Task 17); `CustomerApiClient.simulateBankVerification(id)` and `.saveOnboardingStep(id, body)`
  (Task 11); `PpCard`, `PpBadge`, `PpBanner`, `PpButton` from `@peakpower-nl/shared-ui`.
- Produces:
  - `export class StepBank` — selector `pp-step-bank`, `state = model.required<OnboardingState>()`,
    `verify = output<void>()`
  - `export class StepAuthority` — selector `pp-step-authority`, `state = model.required<OnboardingState>()`
  - `OnboardingWizard.verifyBank(): void`

- [ ] **Step 1: Write the failing tests**

Create `apps/customer-portal/src/app/onboarding/steps/step-bank.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, vi } from 'vitest';

import { StepBank } from './step-bank';
import { defaultState } from '../onboarding-flow';
import type { OnboardingState } from '../onboarding-flow';

async function render(state: OnboardingState = defaultState()) {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(StepBank);
  fixture.componentRef.setInput('state', state);
  await fixture.whenStable();
  return fixture;
}

describe('StepBank', () => {
  it('asks for the IBAN and the account holder, and validates neither in the browser', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.querySelector('#iban')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#bankAccountHolder')).not.toBeNull();
    // No pattern attribute: Iban.Create owns mod-97 and the browser must not hold a second copy.
    expect(fixture.nativeElement.querySelector('#iban').getAttribute('pattern')).toBeNull();
  });

  it('starts unverified and says so in the badge', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.textContent).toContain('Not verified');
    expect(fixture.nativeElement.textContent).not.toContain('Verified with');
  });

  it('asks the wizard to move the cent when either route is taken', async () => {
    const fixture = await render();
    const verify = vi.fn();
    fixture.componentInstance.verify.subscribe(verify);

    (fixture.nativeElement.querySelector('#pay-ideal') as HTMLElement).click();
    await fixture.whenStable();
    expect(verify).toHaveBeenCalledTimes(1);

    (fixture.nativeElement.querySelector('#mark-received') as HTMLElement).click();
    await fixture.whenStable();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it('shows the verified banner and disables the payment routes once the cent has landed', async () => {
    const fixture = await render({ ...defaultState(), bankVerified: true });

    expect(fixture.nativeElement.textContent).toContain('Bank account verified');
    expect((fixture.nativeElement.querySelector('#pay-ideal') as HTMLButtonElement).disabled)
      .toBe(true);
    // The demo affordance is gone entirely once there is nothing left to mark.
    expect(fixture.nativeElement.querySelector('#mark-received')).toBeNull();
  });

  it('says the step can be passed unverified, because it can', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.textContent)
      .toContain('You can continue without verifying');
  });

  it('quotes the application reference as the payment description', async () => {
    const fixture = await render({ ...defaultState(), reference: 'PP-ONB-7F3K' });

    expect(fixture.nativeElement.textContent).toContain('PP-ONB-7F3K');
  });

  it('marks the manual route as the demo affordance it is', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.textContent)
      .toContain('Demo — a real transfer is matched one to two business days later.');
  });
});
```

Create `apps/customer-portal/src/app/onboarding/steps/step-authority.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect } from 'vitest';

import { StepAuthority } from './step-authority';
import { defaultState } from '../onboarding-flow';
import type { OnboardingState } from '../onboarding-flow';

async function render(state: OnboardingState = defaultState()) {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(StepAuthority);
  fixture.componentRef.setInput('state', state);
  await fixture.whenStable();
  return fixture;
}

function options(fixture: Awaited<ReturnType<typeof render>>): NodeListOf<HTMLElement> {
  return fixture.nativeElement.querySelectorAll('.choice');
}

describe('StepAuthority', () => {
  it('offers three answers, each with the line saying what follows', async () => {
    const fixture = await render();

    expect(options(fixture)).toHaveLength(3);
    expect(fixture.nativeElement.textContent)
      .toContain('You sign alone; the agreement is issued to you.');
    expect(fixture.nativeElement.textContent)
      .toContain('We email the people you name; you keep managing the account.');
  });

  it('starts with nothing chosen', async () => {
    const fixture = await render();

    expect(fixture.componentInstance.state().authorityIndex).toBe(-1);
    expect(fixture.nativeElement.querySelectorAll('.choice.on')).toHaveLength(0);
  });

  it('locks the applicant into the signatory list when they sign alone', async () => {
    const base = defaultState();
    const fixture = await render({
      ...base,
      f: { ...base.f, firstName: 'Peter', lastName: 'de Vries', email: 'p@v.nl' },
    });

    options(fixture)[0].click();
    await fixture.whenStable();

    expect(fixture.componentInstance.state().signatories).toEqual([
      { first: 'Peter', last: 'de Vries', email: 'p@v.nl', locked: true },
    ]);
  });

  it('adds an empty second row when two people sign', async () => {
    const fixture = await render();

    options(fixture)[1].click();
    await fixture.whenStable();

    expect(fixture.componentInstance.state().signatories).toHaveLength(2);
  });

  it('drops the applicant when someone else signs', async () => {
    const base = defaultState();
    const fixture = await render({
      ...base,
      f: { ...base.f, firstName: 'Peter', lastName: 'de Vries', email: 'p@v.nl' },
    });

    options(fixture)[2].click();
    await fixture.whenStable();

    const list = fixture.componentInstance.state().signatories;
    expect(list).toHaveLength(1);
    expect(list[0].locked).toBe(false);
    expect(list[0].first).toBe('');
  });

  it('re-clicking the same answer changes nothing', async () => {
    // Rebuilding here would wipe colleagues typed in on step 8 with nothing on screen moving.
    const base = defaultState();
    const fixture = await render({
      ...base,
      authorityIndex: 1,
      signatories: [
        { first: 'Peter', last: 'de Vries', email: 'p@v.nl', locked: true },
        { first: 'Marieke', last: 'Vandersteen', email: 'm@v.nl', locked: false },
      ],
    });

    options(fixture)[1].click();
    await fixture.whenStable();

    expect(fixture.componentInstance.state().signatories[1].first).toBe('Marieke');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- step-bank step-authority`
Expected: FAIL — `Failed to resolve import "./step-bank"`

- [ ] **Step 3: Write step 6**

Create `apps/customer-portal/src/app/onboarding/steps/step-bank.ts`:

```ts
import { ChangeDetectionStrategy, Component, model, output } from '@angular/core';
import { PpBadge, PpBanner, PpButton, PpCard } from '@peakpower-nl/shared-ui';

import { inputValue, withField } from '../onboarding-flow';
import type { OnboardingFields, OnboardingState } from '../onboarding-flow';

/**
 * Step 6 — one cent, once.
 *
 * The IBAN is asked for and NOT validated here: Iban.Create runs the structural check and ISO
 * 7064 mod-97 on the server [F01-R03], and a TypeScript copy is a copy that drifts.
 *
 * Both payment routes emit the same `verify` event. The wizard turns it into a save plus the
 * Development-only simulate endpoint — the payment rail itself is F07 and out of scope. The
 * manual route carries the sentence marking it as the demo affordance it is; without it the
 * transfer card is a dead end, because only the iDEAL button could ever reach "verified".
 */
@Component({
  selector: 'pp-step-bank',
  standalone: true,
  imports: [PpCard, PpBadge, PpBanner, PpButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-card
      heading="Bank account verification"
      subtitle="A € 0,01 payment confirms the IBAN and the account holder"
    >
      <div class="status">
        <span class="fg-label">Status</span>
        <pp-badge [tone]="state().bankVerified ? 'success' : 'neutral'">
          {{ state().bankVerified ? 'Verified' : 'Not verified' }}
        </pp-badge>
      </div>

      <div class="fields two">
        <div class="field">
          <label class="fg-label" for="iban">IBAN</label>
          <input
            id="iban"
            class="mono"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="NL18 INGB 0002 4455 66"
            [value]="state().f.iban"
            (input)="set('iban', $event)"
          />
        </div>
        <div class="field">
          <label class="fg-label" for="bankAccountHolder">Account holder</label>
          <input
            id="bankAccountHolder"
            type="text"
            autocomplete="off"
            placeholder="Vandersteen Koeling B.V."
            [value]="state().f.bankAccountHolder"
            (input)="set('bankAccountHolder', $event)"
          />
        </div>
      </div>

      <div class="pay-grid">
        <div class="pay-card">
          <h4>iDEAL</h4>
          <p>Verified within a minute. The one cent is credited to your wallet.</p>
          <button
            id="pay-ideal"
            type="button"
            class="pay-action"
            [disabled]="state().bankVerified"
            (click)="verify.emit()"
          >
            {{ state().bankVerified ? 'Paid · € 0,01' : 'Pay € 0,01' }}
          </button>
        </div>

        <div class="pay-card">
          <h4>Bank transfer</h4>
          <p>Wire € 0,01 to PeakPower Trading B.V. Credited on the next business day.</p>
          <div class="ref">
            <div class="k">Payment description</div>
            <div class="v">{{ state().reference ?? 'Issued when you create the account' }}</div>
          </div>
          @if (!state().bankVerified) {
            <div class="demo-row">
              <span>Demo — a real transfer is matched one to two business days later.</span>
              <pp-button id="mark-received" size="sm" (click)="verify.emit()">
                Mark € 0,01 as received
              </pp-button>
            </div>
          }
        </div>
      </div>

      @if (state().bankVerified) {
        <pp-banner tone="success" heading="Bank account verified">
          {{ state().f.iban || 'The account you gave' }} · account holder matches
          {{ state().f.bankAccountHolder || state().f.orgName || 'your company' }} · the cent is
          credited to your wallet.
        </pp-banner>
      } @else {
        <p class="note-foot">
          You can continue without verifying — the agreement is only issued once the one cent
          arrives.
        </p>
      }
    </pp-card>
  `,
  styles: `
    .status { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .fields.two {
      display: grid; grid-template-columns: 1.2fr 1fr; gap: 14px; margin-bottom: 18px;
    }
    .field { min-width: 0; }
    .fg-label {
      display: block; font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; color: var(--pp-text-body); margin-bottom: 6px;
    }
    .status .fg-label { margin-bottom: 0; }
    input {
      width: 100%; box-sizing: border-box; font: inherit; font-size: 12.5px; padding: 10px 12px;
      border: 1px solid var(--pp-border); border-radius: 8px; background: var(--pp-surface);
      color: var(--pp-text-heading);
    }
    input.mono { font-family: var(--font-mono); }
    input:focus { outline: none; border-color: var(--pp-blue-300); }
    .pay-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .pay-card {
      border: 1px solid var(--pp-border); border-radius: 12px; padding: 16px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .pay-card h4 { margin: 0; font-size: 13px; font-weight: 700; }
    .pay-card p { margin: 0; font-size: 11.5px; color: var(--pp-text-body); line-height: 1.5; }
    .pay-action {
      align-self: flex-start; margin-top: auto; font: inherit; font-size: 13px; font-weight: 600;
      padding: 10px 20px; border-radius: 6px; border: 1px solid var(--pp-blue-700);
      background: var(--pp-blue-700); color: #fff; cursor: pointer;
    }
    .pay-action:disabled { opacity: 0.55; cursor: default; }
    .ref .k {
      font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--pp-text-faint);
    }
    .ref .v { font-family: var(--font-mono); font-size: 12px; margin-top: 3px; }
    .demo-row {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      flex-wrap: wrap; margin-top: auto; padding-top: 12px;
      border-top: 1px dashed var(--pp-border-strong);
    }
    .demo-row span {
      font-size: 10.5px; color: var(--pp-text-faint); line-height: 1.5; flex: 1; min-width: 150px;
    }
    .note-foot {
      margin: 16px 0 0; padding-top: 14px; border-top: 1px solid var(--pp-border);
      font-size: 11.5px; color: var(--pp-text-faint); line-height: 1.5;
    }
  `,
})
export class StepBank {
  readonly state = model.required<OnboardingState>();
  readonly verify = output<void>();

  set(key: keyof OnboardingFields, event: Event): void {
    this.state.update((s) => withField(s, key, inputValue(event)));
  }
}
```

- [ ] **Step 4: Write step 7**

Create `apps/customer-portal/src/app/onboarding/steps/step-authority.ts`:

```ts
import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { PpCard } from '@peakpower-nl/shared-ui';

import { AUTHORITY, signatoriesForAuthority } from '../onboarding-flow';
import type { OnboardingState } from '../onboarding-flow';

/**
 * Step 7 — who may bind the company.
 *
 * Answering rebuilds step 8's list, because the answer IS who signs. Anything already typed into
 * a row the new answer does not keep is dropped, which is correct: those rows belonged to a
 * different answer. Re-clicking the SAME answer is not a new answer and rebuilds nothing.
 */
@Component({
  selector: 'pp-step-authority',
  standalone: true,
  imports: [PpCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-card
      heading="Are you authorised to sign on behalf of the company?"
      subtitle="The agreement must be signed by a person who may legally represent the company"
    >
      <div class="choices">
        @for (option of authority; track option.wire; let i = $index) {
          <div class="choice" [class.on]="i === state().authorityIndex" (click)="pick(i)">
            <div class="choice-dot"></div>
            <div>
              <div class="choice-label">{{ option.label }}</div>
              <div class="choice-note">{{ option.note }}</div>
            </div>
          </div>
        }
      </div>
    </pp-card>
  `,
  styles: `
    .choices { display: flex; flex-direction: column; gap: 8px; }
    .choice {
      display: flex; align-items: flex-start; gap: 12px; border: 1px solid var(--pp-border);
      background: var(--pp-surface); border-radius: 8px; padding: 12px 15px; cursor: pointer;
    }
    .choice:hover { border-color: var(--pp-border-strong); }
    .choice.on { border: 1.5px solid var(--pp-blue-700); background: var(--pp-blue-050); }
    .choice-dot {
      width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--pp-border-strong);
      background: #fff; flex-shrink: 0; margin-top: 2px;
    }
    .choice.on .choice-dot {
      border-color: var(--pp-blue-700); background: var(--pp-blue-700);
      box-shadow: inset 0 0 0 2px #fff;
    }
    .choice-label { font-size: 12.5px; font-weight: 600; color: var(--pp-text-heading); }
    .choice.on .choice-label { color: var(--pp-blue-700); }
    .choice-note {
      font-size: 11px; color: var(--pp-text-faint); margin-top: 3px; line-height: 1.45;
    }
  `,
})
export class StepAuthority {
  readonly state = model.required<OnboardingState>();
  readonly authority = AUTHORITY;

  pick(index: number): void {
    if (index === this.state().authorityIndex) return;
    this.state.update((s) => ({
      ...s,
      authorityIndex: index,
      signatories: signatoriesForAuthority(index, s.f),
    }));
  }
}
```

- [ ] **Step 5: Give the wizard arms 6 and 7, and the cent**

In `apps/customer-portal/src/app/onboarding/onboarding-wizard.ts` add:

```ts
import { StepAuthority } from './steps/step-authority';
import { StepBank } from './steps/step-bank';
```

add both to `imports`, extend the `@switch`:

```html
              @case (6) { <pp-step-bank [(state)]="state" (verify)="verifyBank()" /> }
              @case (7) { <pp-step-authority [(state)]="state" /> }
```

and add the method, above `startApplication`:

```ts
  /**
   * Save the bank details, then move the cent.
   *
   * In that order and not the other way round: the simulate endpoint stands in for a payment
   * rail matching a transfer against an account, so the account has to be on the application
   * before the match is claimed. `simulate` exists only in Development — plan 5 refuses it in
   * every other environment — because the real rail is F07.
   */
  verifyBank(): void {
    const state = this.state();
    const id = state.applicationId;
    if (id === null || this.busy()) return;

    this.summary.set(null);
    this.busy.set(true);

    this.api.saveOnboardingStep(id, saveStepRequest(state, 6)).subscribe({
      next: () => {
        this.api.simulateBankVerification(id).subscribe({
          next: () => {
            this.busy.set(false);
            this.state.update((s) => ({ ...s, bankVerified: true }));
          },
          error: (error: unknown) => {
            this.busy.set(false);
            this.summary.set(applyProblemDetails(new FormGroup({}), error));
          },
        });
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.summary.set(applyProblemDetails(new FormGroup({}), error));
      },
    });
  }
```

- [ ] **Step 6: Add the wizard test for the cent**

Append to `apps/customer-portal/src/app/onboarding/onboarding-wizard.spec.ts`, inside the
existing `describe('OnboardingWizard', …)`:

```ts
  it('saves the bank details before it claims the cent has landed', async () => {
    const fixture = await render();
    fixture.componentInstance.state.update((s) => ({
      ...s,
      step: 6,
      applicationId: 'app-1',
      f: { ...s.f, iban: 'NL98INGB0002445566', bankAccountHolder: 'Vandersteen Koeling B.V.' },
    }));
    await fixture.whenStable();

    fixture.componentInstance.verifyBank();

    const save = http.expectOne('/api/v1/onboarding/applications/app-1');
    expect(save.request.body.iban).toBe('NL98INGB0002445566');
    save.flush({ id: 'app-1', reference: 'PP-ONB-7F3K', status: 'Draft' });
    await fixture.whenStable();

    http.expectOne('/api/v1/onboarding/applications/app-1/bank-verification/simulate').flush({});
    await fixture.whenStable();

    expect(fixture.componentInstance.state().bankVerified).toBe(true);
    // The step is still passable either way; verifying does not move the wizard on.
    expect(fixture.componentInstance.step()).toBe(6);
  });
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- step-bank step-authority onboarding-wizard`
Expected: PASS — 23 tests

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/onboarding
git commit -m "feat(customer-portal): onboarding steps 6 and 7 — bank verification and signing authority"
```

---

### Task 21: Wizard steps 8 and 9 — the signatories and the signature

Step 8 collects everyone who must sign. Step 9 takes the code one of them was emailed and turns
it into a signature. Together they are the part of the flow that produces a company, an account
and a wallet in one transaction, so they are the part where the demo's shortcuts have to go.

**The signing code is never rendered.** The demo printed `SIGN_CODE` inside its email preview,
with a comment explaining that a code nobody can read is a demo nobody can finish. In this build
the code is generated per application, hashed at rest and delivered by `IEmailSender` — so the
preview shows the *shape* of the email with the code box blanked, and the words say where the
real one is. An end-to-end test reads it through the Development-only peek endpoint from Task 8,
never from the page.

**The applicant's own row is locked.** It is their account, and editing it here would silently
disagree with the name on step 1. It also cannot be removed, and the list cannot fall below what
the step 7 answer requires — both guarded in the handler as well as on the button, because a
stale screen must not be able to do either.

**Signing signs the customer in.** `POST …/sign` returns the username the platform generated;
the wizard immediately calls `AuthService.signIn` with it and the password the customer chose on
step 1, which is still in memory. That is what makes design DoD 2 — "a prospect completes the
wizard in the browser and **lands in the customer portal**" — true rather than nearly true. If
the sign-in fails the wizard still advances: the agreement is signed either way, and Task 22's
welcome step sends them to sign in instead.

**Files:** *(run from `/Users/thinhhuynh/PeakPower/peakpower-web`)*
- Modify: `apps/customer-portal/src/app/onboarding/steps/step-authority.ts`
- Create: `apps/customer-portal/src/app/onboarding/steps/step-sign.ts`
- Modify: `apps/customer-portal/src/app/onboarding/onboarding-wizard.ts`
- Test: `apps/customer-portal/src/app/onboarding/steps/step-signatories.spec.ts`
- Test: `apps/customer-portal/src/app/onboarding/steps/step-sign.spec.ts`

**Interfaces:**
- Consumes: `OnboardingState`, `SignatoryDraft`, `blankSignatory`, `minSignatories`,
  `SIGN_CODE_DIGITS`, `SUPPORT_EMAIL`, `fullName`, `codeDigits`, `inputValue` (Task 17);
  `CustomerApiClient.submitSignatories(id, body)` and `.signOnboarding(id, body)` (Task 11);
  `AuthService.signIn(username, password)` (Task 14); `PpCard` from `@peakpower-nl/shared-ui`.
- Produces:
  - `export class StepSignatories` — selector `pp-step-signatories`, in `steps/step-authority.ts`
  - `export class StepSign` — selector `pp-step-sign`, in `steps/step-sign.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/customer-portal/src/app/onboarding/steps/step-signatories.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect } from 'vitest';

import { StepSignatories } from './step-authority';
import { defaultState } from '../onboarding-flow';
import type { OnboardingState } from '../onboarding-flow';

const APPLICANT = { first: 'Peter', last: 'de Vries', email: 'p@v.nl', locked: true };

function jointly(): OnboardingState {
  return {
    ...defaultState(),
    step: 8,
    authorityIndex: 1,
    f: { ...defaultState().f, firstName: 'Peter', lastName: 'de Vries', email: 'p@v.nl' },
    signatories: [APPLICANT, { first: '', last: '', email: '', locked: false }],
  };
}

async function render(state: OnboardingState = jointly()) {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(StepSignatories);
  fixture.componentRef.setInput('state', state);
  await fixture.whenStable();
  return fixture;
}

describe('StepSignatories', () => {
  it('locks the applicant\'s own row', async () => {
    const fixture = await render();

    const first = fixture.nativeElement.querySelector('#sig-0-first') as HTMLInputElement;
    expect(first.disabled).toBe(true);
    expect(first.value).toBe('Peter');
  });

  it('lets a colleague be typed in', async () => {
    const fixture = await render();
    const email = fixture.nativeElement.querySelector('#sig-1-email') as HTMLInputElement;

    email.value = 'm.vandersteen@vandersteen.nl';
    email.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(fixture.componentInstance.state().signatories[1].email)
      .toBe('m.vandersteen@vandersteen.nl');
  });

  it('adds a row', async () => {
    const fixture = await render();

    fixture.componentInstance.add();
    await fixture.whenStable();

    expect(fixture.componentInstance.state().signatories).toHaveLength(3);
  });

  it('refuses to remove the applicant, or to fall below what step 7 requires', async () => {
    const fixture = await render();

    fixture.componentInstance.remove(0);
    expect(fixture.componentInstance.state().signatories).toHaveLength(2);

    // Two are required by "jointly", so the second one cannot go either.
    fixture.componentInstance.remove(1);
    expect(fixture.componentInstance.state().signatories).toHaveLength(2);
  });

  it('removes a third row, which nothing requires', async () => {
    const fixture = await render({
      ...jointly(),
      signatories: [
        APPLICANT,
        { first: 'Marieke', last: 'V', email: 'm@v.nl', locked: false },
        { first: 'Sam', last: 'B', email: 's@v.nl', locked: false },
      ],
    });

    fixture.componentInstance.remove(2);
    await fixture.whenStable();

    expect(fixture.componentInstance.state().signatories).toHaveLength(2);
  });

  it('counts the signatories in words a person would use', async () => {
    const fixture = await render();
    expect(fixture.nativeElement.textContent).toContain('2 signatories — all must sign.');

    fixture.componentInstance.state.update((s) => ({ ...s, signatories: [APPLICANT] }));
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('One signatory.');
  });

  it('previews the email a colleague opens, and never prints a code in it', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.textContent).toContain('Your PeakPower signing code');
    expect(fixture.nativeElement.textContent)
      .toContain('Each code is generated when you submit and is sent only to its own signatory.');
    // The real code exists only in the email. Six digits on this page would be a credential.
    expect(fixture.nativeElement.textContent).not.toMatch(/\b\d{6}\b/);
  });

  it('addresses the preview to the colleague rather than the applicant', async () => {
    const fixture = await render({
      ...jointly(),
      signatories: [APPLICANT, { first: 'Marieke', last: 'V', email: 'm@v.nl', locked: false }],
    });

    expect(fixture.nativeElement.textContent).toContain('Hi Marieke,');
  });
});
```

Create `apps/customer-portal/src/app/onboarding/steps/step-sign.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect } from 'vitest';

import { StepSign } from './step-sign';
import { defaultState } from '../onboarding-flow';
import type { OnboardingState } from '../onboarding-flow';

function ready(): OnboardingState {
  const base = defaultState();
  return {
    ...base,
    step: 9,
    f: {
      ...base.f,
      firstName: 'Peter',
      lastName: 'de Vries',
      email: 'p.devries@vandersteen.nl',
      orgName: 'Vandersteen Koeling B.V.',
    },
  };
}

async function render(state: OnboardingState = ready()) {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(StepSign);
  fixture.componentRef.setInput('state', state);
  await fixture.whenStable();
  return fixture;
}

describe('StepSign', () => {
  it('takes the code as digits, keeping whatever spacing was pasted', async () => {
    const fixture = await render();
    const input = fixture.nativeElement.querySelector('#sign-code') as HTMLInputElement;

    input.value = '748 213';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(fixture.componentInstance.state().signCode).toBe('748 213');
  });

  it('offers the code box as a one-time code so a password manager stays out of it', async () => {
    const fixture = await render();
    const input = fixture.nativeElement.querySelector('#sign-code') as HTMLInputElement;

    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    expect(input.getAttribute('inputmode')).toBe('numeric');
  });

  it('ticks the documents box, and names the company being signed for', async () => {
    const fixture = await render();
    expect(fixture.componentInstance.state().agreedDocs).toBe(false);

    fixture.componentInstance.toggleAgreedDocs();
    await fixture.whenStable();

    expect(fixture.componentInstance.state().agreedDocs).toBe(true);
    expect(fixture.nativeElement.textContent)
      .toContain('I sign the agreement on behalf of Vandersteen Koeling B.V.');
  });

  it('says where the code went', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.textContent).toContain('Sent to p.devries@vandersteen.nl');
  });

  it('never puts a six-digit code on the page', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.textContent).not.toMatch(/\b\d{6}\b/);
    expect(fixture.nativeElement.textContent)
      .toContain('Open the email to read it — it is not shown here.');
  });

  it('gives the address a person can reply to when the code does not arrive', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.textContent).toContain('support@peakpower.nl');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- step-signatories step-sign`
Expected: FAIL — `No export named 'StepSignatories'` from `./step-authority`

- [ ] **Step 3: Add step 8 to `step-authority.ts`**

Extend the imports at the top of `apps/customer-portal/src/app/onboarding/steps/step-authority.ts`
to `import { AUTHORITY, blankSignatory, fullName, inputValue, minSignatories,
signatoriesForAuthority } from '../onboarding-flow';` plus
`import type { OnboardingState, SignatoryDraft } from '../onboarding-flow';`, then append:

```ts
/**
 * Step 8 — everyone who must sign, and the email each of them will get.
 *
 * The preview shows the shape of that email with no code in it. The demo printed its constant
 * there; here the code is generated per application, hashed at rest and sent by IEmailSender, so
 * printing one would either be a lie or a credential.
 */
@Component({
  selector: 'pp-step-signatories',
  standalone: true,
  imports: [PpCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-card heading="Who needs to sign the agreement?" [subtitle]="subtitle()">
      <div class="sig-grid sig-head">
        <div>First name</div>
        <div>Last name</div>
        <div>Email address</div>
        <div></div>
      </div>

      @for (s of state().signatories; track $index; let i = $index) {
        <div class="sig-grid">
          <input
            [id]="'sig-' + i + '-first'"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="First name"
            [attr.aria-label]="'Signatory ' + (i + 1) + ' first name'"
            [value]="s.first"
            [disabled]="s.locked"
            (input)="set(i, 'first', $event)"
          />
          <input
            [id]="'sig-' + i + '-last'"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="Last name"
            [attr.aria-label]="'Signatory ' + (i + 1) + ' last name'"
            [value]="s.last"
            [disabled]="s.locked"
            (input)="set(i, 'last', $event)"
          />
          <input
            [id]="'sig-' + i + '-email'"
            type="email"
            autocomplete="off"
            spellcheck="false"
            placeholder="name@company.nl"
            [attr.aria-label]="'Signatory ' + (i + 1) + ' email address'"
            [value]="s.email"
            [disabled]="s.locked"
            (input)="set(i, 'email', $event)"
          />
          <button
            type="button"
            class="sig-remove"
            aria-label="Remove signatory"
            [disabled]="!canRemove(i)"
            (click)="remove(i)"
          >−</button>
        </div>
      }

      <div class="sig-foot">
        <button type="button" class="sig-add" (click)="add()">+ Add a signatory</button>
        <span class="sig-count">{{ countLine() }}</span>
      </div>
    </pp-card>

    <pp-card
      heading="What each signatory receives"
      subtitle="Sent the moment you submit — the code is personal and the email address is verified first"
    >
      <div class="mail">
        <div class="mail-head">
          <span><b>Subject</b> · Your PeakPower signing code</span>
          <span class="mail-from">{{ supportEmail }}</span>
        </div>
        <div class="mail-body">
          <div>Hi {{ greeting() }},</div>
          <p>
            {{ applicant() }} has completed the onboarding for {{ org() }} and listed you as an
            authorised signatory. Review the company information and the agreement, then sign
            with the code in that email.
          </p>
          <div class="mail-code">
            <div class="k">Your signing code</div>
            <div class="v">— — — — — —</div>
          </div>
          <p class="faint">
            Each code is generated when you submit and is sent only to its own signatory.
            Entering it, with the agreement ticked, is that person's signature.
          </p>
          <p>Have a question? You can reply directly to this email.</p>
          <p>The PeakPower Team</p>
        </div>
      </div>
    </pp-card>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 18px; }
    .sig-grid {
      display: grid; grid-template-columns: 1fr 1fr 1.4fr 34px; gap: 10px; align-items: center;
      margin-bottom: 8px;
    }
    .sig-head {
      font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--pp-text-faint);
    }
    input {
      width: 100%; box-sizing: border-box; font: inherit; font-size: 12.5px; padding: 9px 11px;
      border: 1px solid var(--pp-border); border-radius: 8px; background: var(--pp-surface);
      color: var(--pp-text-heading);
    }
    input:disabled { background: var(--pp-surface-alt); color: var(--pp-text-body); }
    input:focus { outline: none; border-color: var(--pp-blue-300); }
    .sig-remove {
      width: 30px; height: 30px; border-radius: 6px; border: 1px solid var(--pp-border);
      background: var(--pp-surface); color: var(--pp-text-body); font-size: 15px; cursor: pointer;
    }
    .sig-remove:disabled { opacity: 0.4; cursor: default; }
    .sig-foot {
      display: flex; align-items: center; gap: 14px; margin-top: 12px; padding-top: 12px;
      border-top: 1px solid var(--pp-border);
    }
    .sig-add {
      font: inherit; font-size: 12px; font-weight: 600; padding: 7px 14px; border-radius: 6px;
      border: 1px solid var(--pp-border-strong); background: var(--pp-surface);
      color: var(--pp-text-heading); cursor: pointer;
    }
    .sig-count { font-size: 11.5px; color: var(--pp-text-faint); }
    .mail { border: 1px solid var(--pp-border); border-radius: 8px; overflow: hidden; }
    .mail-head {
      display: flex; justify-content: space-between; gap: 12px; padding: 10px 14px;
      background: var(--pp-surface-alt); font-size: 11.5px; color: var(--pp-text-body);
    }
    .mail-from { font-family: var(--font-mono); }
    .mail-body { padding: 14px; font-size: 12.5px; line-height: 1.55; }
    .mail-body p { margin: 10px 0 0; }
    .mail-body .faint { font-size: 11px; color: var(--pp-text-faint); }
    .mail-code {
      margin-top: 14px; padding: 12px 14px; border: 1px solid var(--pp-border-strong);
      border-radius: 8px; background: var(--pp-surface-alt);
    }
    .mail-code .k {
      font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--pp-text-faint);
    }
    .mail-code .v {
      font-family: var(--font-mono); font-size: 22px; font-weight: 700; letter-spacing: 0.22em;
      color: var(--pp-text-faint); margin-top: 4px;
    }
  `,
})
export class StepSignatories {
  readonly state = model.required<OnboardingState>();
  readonly supportEmail = SUPPORT_EMAIL;

  subtitle(): string {
    return this.state().authorityIndex === 2
      ? 'You are not signing — name the people who are'
      : 'Everyone listed must sign before the agreement takes effect';
  }

  set(index: number, key: 'first' | 'last' | 'email', event: Event): void {
    const value = inputValue(event);
    this.state.update((s) => {
      const row = s.signatories[index];
      if (row === undefined || row.locked) return s;
      const signatories = s.signatories.map((r, i) => (i === index ? { ...r, [key]: value } : r));
      return { ...s, signatories };
    });
  }

  add(): void {
    this.state.update((s) => ({ ...s, signatories: [...s.signatories, blankSignatory()] }));
  }

  canRemove(index: number): boolean {
    const s = this.state();
    const row = s.signatories[index];
    if (row === undefined || row.locked) return false;
    return s.signatories.length > minSignatories(s.authorityIndex);
  }

  /** Guarded here as well as on the button: a stale screen must not be able to do either. */
  remove(index: number): void {
    if (!this.canRemove(index)) return;
    this.state.update((s) => ({
      ...s,
      signatories: s.signatories.filter((_, i) => i !== index),
    }));
  }

  countLine(): string {
    const n = this.state().signatories.length;
    return n === 1 ? 'One signatory.' : `${n} signatories — all must sign.`;
  }

  /**
   * Prefer a colleague's name over the applicant's: the applicant already knows what they are
   * sending, and the point of the preview is what the OTHER person opens.
   */
  greeting(): string {
    const other = this.state().signatories.find((s) => !s.locked && s.first.trim() !== '');
    if (other !== undefined) return other.first;
    const first = this.state().signatories[0];
    return first !== undefined && first.first.trim() !== '' ? first.first : 'there';
  }

  /** Names the PERSON who applied, not the company: a building did not fill in a form. */
  applicant(): string {
    return fullName(this.state().f) || 'The account manager';
  }

  org(): string {
    return this.state().f.orgName || 'your company';
  }
}
```

- [ ] **Step 4: Write step 9**

Create `apps/customer-portal/src/app/onboarding/steps/step-sign.ts`:

```ts
import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { PpCard } from '@peakpower-nl/shared-ui';

import { SIGN_CODE_DIGITS, SUPPORT_EMAIL, inputValue } from '../onboarding-flow';
import type { OnboardingState } from '../onboarding-flow';

/**
 * Step 9 — the signature, which is six digits and a tick.
 *
 * The code is generated per application by the backend, hashed at rest and delivered by
 * IEmailSender. This page never shows it and never checks it: the browser sends what was typed,
 * and POST /onboarding/applications/{id}/sign answers. A client-side match would have meant
 * shipping the credential in the bundle, which is exactly what the demo's SIGN_CODE was.
 *
 * The box is monospaced and spaced out because a mistyped digit read off an email is a support
 * call.
 */
@Component({
  selector: 'pp-step-sign',
  standalone: true,
  imports: [PpCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-card heading="Enter your signing code" [subtitle]="sentTo()">
      <div class="code-field">
        <label class="fg-label" for="sign-code">Signing code</label>
        <input
          id="sign-code"
          class="code-input"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="11"
          placeholder="000000"
          [value]="state().signCode"
          (input)="setCode($event)"
        />
      </div>

      <div class="terms" [class.on]="state().agreedDocs" (click)="toggleAgreedDocs()">
        <div class="terms-box">{{ state().agreedDocs ? '✓' : '' }}</div>
        <div class="terms-text">
          I agree to the Terms of Use, the key information documents and the privacy statement,
          and I sign the agreement on behalf of {{ org() }}
        </div>
      </div>

      <p class="note-foot">
        Entering the code is your signature — there is nothing to print or scan. Open the email to
        read it — it is not shown here. Did not receive it? Reply to {{ supportEmail }} and the
        desk will resend it.
      </p>
    </pp-card>
  `,
  styles: `
    .code-field { max-width: 260px; }
    .fg-label {
      display: block; font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; color: var(--pp-text-body); margin-bottom: 6px;
    }
    .code-input {
      width: 100%; box-sizing: border-box; font-family: var(--font-mono); font-size: 20px;
      letter-spacing: 0.24em; text-align: center; padding: 12px 14px;
      border: 1px solid var(--pp-border); border-radius: 8px; background: var(--pp-surface);
      color: var(--pp-text-heading);
    }
    .code-input:focus { outline: none; border-color: var(--pp-blue-300); }
    .terms {
      display: flex; align-items: flex-start; gap: 10px; margin-top: 18px; padding-top: 14px;
      border-top: 1px solid var(--pp-border); cursor: pointer;
    }
    .terms-box {
      width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0; margin-top: 1px;
      border: 1px solid var(--pp-border-strong); background: #fff; color: #fff; font-size: 10px;
      font-weight: 700; display: flex; align-items: center; justify-content: center;
    }
    .terms.on .terms-box { border-color: var(--pp-blue-700); background: var(--pp-blue-700); }
    .terms-text { font-size: 12px; color: var(--pp-text-body); line-height: 1.5; }
    .note-foot {
      margin: 16px 0 0; padding-top: 14px; border-top: 1px solid var(--pp-border);
      font-size: 11.5px; color: var(--pp-text-faint); line-height: 1.5;
    }
  `,
})
export class StepSign {
  readonly state = model.required<OnboardingState>();
  readonly supportEmail = SUPPORT_EMAIL;

  sentTo(): string {
    return `Sent to ${this.state().f.email || 'your email address'} · ${SIGN_CODE_DIGITS} digits`;
  }

  org(): string {
    return this.state().f.orgName || 'your company';
  }

  /** Kept exactly as typed; `codeDigits` is what the gate and the request read. */
  setCode(event: Event): void {
    const value = inputValue(event);
    this.state.update((s) => ({ ...s, signCode: value }));
  }

  toggleAgreedDocs(): void {
    this.state.update((s) => ({ ...s, agreedDocs: !s.agreedDocs }));
  }
}
```

- [ ] **Step 5: Give the wizard arms 8 and 9, and the signature**

In `apps/customer-portal/src/app/onboarding/onboarding-wizard.ts`:

```ts
import { StepAuthority, StepSignatories } from './steps/step-authority';
import { StepSign } from './steps/step-sign';

import { AuthService } from '../auth/auth.service';
import { codeDigits } from './onboarding-flow';
```

add `StepSignatories` and `StepSign` to `imports`, extend the `@switch`:

```html
              @case (8) { <pp-step-signatories [(state)]="state" /> }
              @case (9) { <pp-step-sign [(state)]="state" /> }
```

add the injection beside the API client:

```ts
  private readonly auth = inject(AuthService);
```

and replace the tail of `next()` — the branch that currently PATCHes every step from 2 onwards —
with the three-way dispatch:

```ts
    const id = state.applicationId;
    if (id === null) {
      this.summary.set('This application was not started. Go back to step 1 and begin again.');
      return;
    }

    if (state.step === 8) {
      this.send(
        this.api.submitSignatories(id, {
          signatories: state.signatories.map((s) => ({
            firstName: s.first.trim(),
            lastName: s.last.trim(),
            email: s.email.trim(),
          })),
        }),
        () => this.advance(),
      );
      return;
    }

    if (state.step === 9) {
      this.sign(id, state);
      return;
    }

    this.send(
      this.api.saveOnboardingStep(id, saveStepRequest(state, state.step)),
      () => this.advance(),
    );
```

and add the signing method:

```ts
  /**
   * Sign, then sign in.
   *
   * The password is still in memory from step 1, and the username is whatever the platform
   * generated, so the customer never types either. If the sign-in fails the wizard still moves
   * on: the agreement IS signed, and the welcome step sends them to sign-in instead of
   * pretending the session exists.
   */
  private sign(id: string, state: OnboardingState): void {
    this.busy.set(true);

    this.api
      .signOnboarding(id, { code: codeDigits(state.signCode), agreedDocuments: state.agreedDocs })
      .subscribe({
        next: (signed) => {
          this.state.update((s) => ({ ...s, username: signed.username }));
          this.auth.signIn(signed.username, state.f.password).subscribe({
            next: () => {
              this.busy.set(false);
              this.advance();
            },
            error: () => {
              this.busy.set(false);
              this.advance();
            },
          });
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.summary.set(applyProblemDetails(new FormGroup({}), error));
        },
      });
  }
```

- [ ] **Step 6: Add the wizard tests for submitting and signing**

Append to `apps/customer-portal/src/app/onboarding/onboarding-wizard.spec.ts`:

```ts
  it('submits the signatories as first name, last name and email', async () => {
    const fixture = await render();
    fixture.componentInstance.state.update((s) => ({
      ...s,
      step: 8,
      applicationId: 'app-1',
      authorityIndex: 0,
      signatories: [{ first: ' Peter ', last: 'de Vries', email: ' p@v.nl ', locked: true }],
    }));
    await fixture.whenStable();

    fixture.componentInstance.next();

    const req = http.expectOne('/api/v1/onboarding/applications/app-1/signatories');
    expect(req.request.body).toEqual({
      signatories: [{ firstName: 'Peter', lastName: 'de Vries', email: 'p@v.nl' }],
    });
    req.flush({ id: 'app-1', reference: 'PP-ONB-7F3K', status: 'AwaitingSignature' });
    await fixture.whenStable();

    expect(fixture.componentInstance.step()).toBe(9);
  });

  it('signs with the digits alone, then signs the new customer in', async () => {
    const fixture = await render();
    fixture.componentInstance.state.update((s) => ({
      ...s,
      step: 9,
      applicationId: 'app-1',
      signCode: '748 213',
      agreedDocs: true,
      f: { ...s.f, password: 'correct-horse-battery' },
    }));
    await fixture.whenStable();

    fixture.componentInstance.next();

    const sign = http.expectOne('/api/v1/onboarding/applications/app-1/sign');
    expect(sign.request.body).toEqual({ code: '748213', agreedDocuments: true });
    sign.flush({
      customerId: 'c1', accountId: 'a1', username: 'p.devries@vandersteen.nl',
      customerStatus: 'ACTIVE',
    });
    await fixture.whenStable();

    const signIn = http.expectOne('/api/v1/auth/sign-in');
    expect(signIn.request.body).toEqual({
      username: 'p.devries@vandersteen.nl', password: 'correct-horse-battery',
    });
    signIn.flush({
      accessToken: 'the-token',
      expiresAt: '2026-08-26T12:00:00Z',
      account: {
        accountId: 'a1', customerId: 'c1', firstName: 'Peter', lastName: 'de Vries',
        email: 'p.devries@vandersteen.nl', isAdmin: true,
      },
    });
    await fixture.whenStable();

    expect(fixture.componentInstance.step()).toBe(10);
  });

  it('stays on step 9 when the code is refused', async () => {
    const fixture = await render();
    fixture.componentInstance.state.update((s) => ({
      ...s, step: 9, applicationId: 'app-1', signCode: '000000', agreedDocs: true,
    }));
    await fixture.whenStable();

    fixture.componentInstance.next();
    http.expectOne('/api/v1/onboarding/applications/app-1/sign').flush(
      { title: 'That code does not match the one we emailed you.' },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();

    expect(fixture.componentInstance.step()).toBe(9);
    expect(fixture.componentInstance.summary())
      .toBe('That code does not match the one we emailed you.');
  });

  it('still reaches the welcome step when the automatic sign-in fails', async () => {
    // The agreement is signed either way. Refusing to show the outcome because a convenience
    // failed would be the wizard losing a signature it already took.
    const fixture = await render();
    fixture.componentInstance.state.update((s) => ({
      ...s, step: 9, applicationId: 'app-1', signCode: '748213', agreedDocs: true,
    }));
    await fixture.whenStable();

    fixture.componentInstance.next();
    http.expectOne('/api/v1/onboarding/applications/app-1/sign').flush({
      customerId: 'c1', accountId: 'a1', username: 'p.devries@vandersteen.nl',
      customerStatus: 'ACTIVE',
    });
    await fixture.whenStable();

    http.expectOne('/api/v1/auth/sign-in')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();

    expect(fixture.componentInstance.step()).toBe(10);
  });
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- step-signatories step-sign onboarding-wizard`
Expected: PASS — 28 tests

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/onboarding
git commit -m "feat(customer-portal): onboarding steps 8 and 9 — signatories, and signing signs you in"
```

---

### Task 22: Wizard step 10 — the welcome, and landing in the portal

The last step has **two outcomes and must not print the wrong one**. "Welcome to PeakPower · your
account is active" above a badge reading "With the desk" is the exact contradiction this step
exists to avoid: the agreement is signed either way, but the account is only active once the cent
has cleared. `stepTitle` and `stepIntro` (Task 17) already branch; this task makes the body
branch with them.

Three rules the demo established and this step keeps:

- **Every answer is listed, including the blank ones.** An omission reads as complete.
- **The stat cards count only what happened.** The applicant signed; a colleague named on step 8
  signs from their own email with their own code, so "2 signatures" would be counting one that
  has not occurred. The count of people still to sign is shown as exactly that.
- **Nothing is fabricated.** Design §8.5 forbids plausible-looking figures beside real ones, so
  the annual-volume card prints the band the customer declared and says "self-declared" under it.

And the one thing the demo could not do: **this step lands them in the portal.** Task 21's sign
call signed them in, so the primary action goes to `/connections` — design DoD 2 and 3 are one
click apart. If the automatic sign-in failed the action goes to `/sign-in` instead, and says so.

**Files:** *(run from `/Users/thinhhuynh/PeakPower/peakpower-web`)*
- Modify: `apps/customer-portal/src/app/onboarding/steps/step-sign.ts`
- Modify: `apps/customer-portal/src/app/onboarding/onboarding-wizard.ts`
- Test: `apps/customer-portal/src/app/onboarding/steps/step-welcome.spec.ts`

**Interfaces:**
- Consumes: `OnboardingState`, `summaryRows`, `fullName`, `VOLUMES`, `FLOWS`, `SUPPORT_EMAIL`
  (Task 17); `AuthService.isSignedIn` (Task 14); `PpCard`, `PpStatCard`, `PpBadge`, `PpBanner`,
  `PpButton` from `@peakpower-nl/shared-ui`; `RouterLink` from `@angular/router`.
- Produces:
  - `export class StepWelcome` — selector `pp-step-welcome`, in `steps/step-sign.ts`, with
    `state = model.required<OnboardingState>()` and `destination = input.required<string>()`
  - `OnboardingWizard.destination: Signal<string>`

- [ ] **Step 1: Write the failing test**

Create `apps/customer-portal/src/app/onboarding/steps/step-welcome.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { describe, it, expect } from 'vitest';

import { StepWelcome } from './step-sign';
import { VOLUMES, defaultState } from '../onboarding-flow';
import type { OnboardingState } from '../onboarding-flow';

function signed(bankVerified: boolean): OnboardingState {
  const base = defaultState();
  return {
    ...base,
    step: 10,
    bankVerified,
    volumeIndex: 3,
    flowIndex: 2,
    authorityIndex: 1,
    reference: 'PP-ONB-7F3K',
    username: 'p.devries@vandersteen.nl',
    f: {
      ...base.f,
      firstName: 'Peter',
      lastName: 'de Vries',
      email: 'p.devries@vandersteen.nl',
      orgName: 'Vandersteen Koeling B.V.',
      kvk: '24398112',
    },
    signatories: [
      { first: 'Peter', last: 'de Vries', email: 'p.devries@vandersteen.nl', locked: true },
      { first: 'Marieke', last: 'Vandersteen', email: 'm@v.nl', locked: false },
    ],
  };
}

async function render(state: OnboardingState, destination = '/connections') {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideRouter([])],
  });
  const fixture = TestBed.createComponent(StepWelcome);
  fixture.componentRef.setInput('state', state);
  fixture.componentRef.setInput('destination', destination);
  await fixture.whenStable();
  return fixture;
}

describe('StepWelcome', () => {
  it('says the account is active only when the cent has arrived', async () => {
    const fixture = await render(signed(true));

    expect(fixture.nativeElement.textContent).toContain('Account active');
    expect(fixture.nativeElement.textContent).toContain('Nothing further is needed from you.');
  });

  it('says the agreement is signed and the account is not, when it is not', async () => {
    const fixture = await render(signed(false));

    expect(fixture.nativeElement.textContent).toContain('With the desk');
    expect(fixture.nativeElement.textContent)
      .toContain('The agreement is signed; the account is not active yet.');
    // The contradiction this step exists to stop.
    expect(fixture.nativeElement.textContent).not.toContain('Account active');
  });

  it('counts only the signature that happened, and names what is outstanding', async () => {
    const fixture = await render(signed(true));

    expect(fixture.nativeElement.textContent).toContain('with code, by Peter de Vries');
    expect(fixture.nativeElement.textContent).toContain('1 still to sign');
  });

  it('prints the declared band and says it is self-declared', async () => {
    const fixture = await render(signed(true));

    expect(fixture.nativeElement.textContent).toContain(VOLUMES[3].short);
    expect(fixture.nativeElement.textContent).toContain('both · self-declared');
  });

  it('lists every answer, blanks included', async () => {
    const fixture = await render(signed(true));

    expect(fixture.nativeElement.textContent).toContain('Not registered');
    expect(fixture.nativeElement.textContent).toContain('Vandersteen Koeling B.V.');
    expect(fixture.nativeElement.textContent).toContain('24398112');
  });

  it('quotes the reference the server issued', async () => {
    const fixture = await render(signed(true));

    expect(fixture.nativeElement.textContent).toContain('Application PP-ONB-7F3K');
  });

  it('sends a signed-in customer to their connections', async () => {
    const fixture = await render(signed(true), '/connections');

    const cta = fixture.nativeElement.querySelector('#welcome-cta') as HTMLAnchorElement;
    expect(cta.getAttribute('href')).toBe('/connections');
    expect(cta.textContent).toContain('Go to your connections');
  });

  it('sends them to sign in when the automatic sign-in did not take', async () => {
    const fixture = await render(signed(true), '/sign-in');

    const cta = fixture.nativeElement.querySelector('#welcome-cta') as HTMLAnchorElement;
    expect(cta.getAttribute('href')).toBe('/sign-in');
    expect(cta.textContent).toContain('Sign in');
  });

  it('shows the welcome email only when everything really is in order', async () => {
    expect((await render(signed(true))).nativeElement.textContent)
      .toContain('Welcome to PeakPower');
    expect((await render(signed(false))).nativeElement.textContent)
      .not.toContain('everything is in order');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- step-welcome`
Expected: FAIL — `No export named 'StepWelcome'` from `./step-sign`

- [ ] **Step 3: Write step 10**

Extend the imports at the top of `apps/customer-portal/src/app/onboarding/steps/step-sign.ts` to
`import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';`,
`import { RouterLink } from '@angular/router';`,
`import { PpBadge, PpBanner, PpButton, PpCard, PpStatCard } from '@peakpower-nl/shared-ui';` and
`import { FLOWS, SIGN_CODE_DIGITS, SUPPORT_EMAIL, VOLUMES, fullName, inputValue, summaryRows }
from '../onboarding-flow';`, then append:

```ts
/** One row of the outcome timeline. */
interface TimelineItem {
  readonly title: string;
  readonly sub: string;
  readonly ts: string;
  readonly tone: 'info' | 'warning' | 'neutral';
}

/**
 * Step 10 — the outcome, and it is two different outcomes.
 *
 * The welcome email says every document was reviewed and the account is active. That is only true
 * once the cent has arrived, so an unverified bank account gets the manual route instead: the desk
 * writes to the customer for what is missing. Printing "everything is in order" over a
 * verification that has not happened is the one thing this step must not do.
 */
@Component({
  selector: 'pp-step-welcome',
  standalone: true,
  imports: [PpCard, PpBadge, PpBanner, PpButton, PpStatCard, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-card [heading]="org()" [subtitle]="'Application ' + reference() + ' · signed just now'">
      <div class="head-row">
        <pp-badge [tone]="state().bankVerified ? 'success' : 'warning'">
          {{ state().bankVerified ? 'Account active' : 'With the desk' }}
        </pp-badge>
        <span class="faint">
          {{ state().bankVerified
            ? 'Nothing further is needed from you.'
            : 'The agreement is signed; the account is not active yet.' }}
        </span>
      </div>

      <div class="stat-row">
        @if (state().bankVerified) {
          <pp-stat-card
            label="Account"
            value="Active"
            tone="success"
            sublabel="ready to register connections"
          />
        } @else {
          <pp-stat-card
            label="Bank account"
            value="Awaiting € 0,01"
            tone="warning"
            sublabel="the last thing outstanding"
          />
        }
        <pp-stat-card
          label="Agreement"
          value="Signed"
          tone="success"
          [sublabel]="signedBySublabel()"
        />
        <pp-stat-card label="Annual volume" [value]="volume()" [sublabel]="volumeSublabel()" />
      </div>

      @if (!state().bankVerified) {
        <pp-banner tone="info" [heading]="'We will email you from ' + supportEmail">
          The € 0,01 has not arrived yet, so we cannot confirm the bank account. Anything that
          holds an account up is handled by a person, not a form — the desk writes to you for the
          document or the clarification it needs, and you can reply to that email.
        </pp-banner>
      }

      <div class="timeline">
        @for (item of timeline(); track item.title) {
          <div class="tl-item" [class]="'tone-' + item.tone">
            <span class="tl-dot"></span>
            <div class="tl-title">{{ item.title }}</div>
            <div class="tl-sub">{{ item.sub }}</div>
            <div class="tl-ts">{{ item.ts }}</div>
          </div>
        }
      </div>

      <div class="cta">
        <a id="welcome-cta" ppButton variant="primary" [routerLink]="destination()">
          {{ destination() === '/connections' ? 'Go to your connections ›' : 'Sign in ›' }}
        </a>
      </div>
    </pp-card>

    @if (state().bankVerified) {
      <pp-card
        heading="The email we just sent you"
        [subtitle]="'From ' + supportEmail + ' — replies reach the desk, not a mailbox nobody reads'"
      >
        <div class="mail">
          <div class="mail-head">
            <span><b>Subject</b> · Welcome to PeakPower</span>
            <span class="mail-from">{{ supportEmail }}</span>
          </div>
          <div class="mail-body">
            <div>Hi {{ state().f.firstName || 'there' }},</div>
            <p>Thank you for joining PeakPower.</p>
            <p>
              We have reviewed the documents you submitted for {{ org() }}, and everything is in
              order. Your account is now active and ready to use.
            </p>
            <p>Have a question? You can reply directly to this email.</p>
            <p>The PeakPower Team</p>
          </div>
        </div>
      </pp-card>
    }

    <pp-card heading="What you submitted" subtitle="The desk can correct any of this at any time">
      <div class="summary">
        @for (row of rows(); track row.k) {
          <div class="summary-row"><span class="k">{{ row.k }}</span><span class="v">{{ row.v }}</span></div>
        }
      </div>
    </pp-card>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 18px; }
    .head-row { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .faint { font-size: 11.5px; color: var(--pp-text-faint); }
    .stat-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .timeline { margin-top: 16px; display: flex; flex-direction: column; gap: 12px; }
    .tl-item {
      display: grid; grid-template-columns: 14px 1fr auto; column-gap: 10px; align-items: baseline;
    }
    .tl-dot {
      width: 8px; height: 8px; border-radius: 50%; background: var(--pp-blue-500);
      align-self: center;
    }
    .tone-warning .tl-dot { background: var(--pp-amber); }
    .tone-neutral .tl-dot { background: var(--pp-border-strong); }
    .tl-title { font-size: 12.5px; font-weight: 600; }
    .tl-ts { font-size: 11px; color: var(--pp-text-faint); }
    .tl-sub { grid-column: 2 / 4; font-size: 11px; color: var(--pp-text-body); line-height: 1.45; }
    .cta { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--pp-border); }
    .summary { display: flex; flex-direction: column; }
    .summary-row {
      display: flex; justify-content: space-between; gap: 16px; padding: 8px 0;
      border-top: 1px solid var(--pp-border); font-size: 12.5px;
    }
    .summary-row:first-child { border-top: none; }
    .summary-row .k { color: var(--pp-text-body); }
    .summary-row .v { color: var(--pp-text-heading); font-weight: 600; text-align: right; }
    .mail { border: 1px solid var(--pp-border); border-radius: 8px; overflow: hidden; }
    .mail-head {
      display: flex; justify-content: space-between; gap: 12px; padding: 10px 14px;
      background: var(--pp-surface-alt); font-size: 11.5px; color: var(--pp-text-body);
    }
    .mail-from { font-family: var(--font-mono); }
    .mail-body { padding: 14px; font-size: 12.5px; line-height: 1.55; }
    .mail-body p { margin: 10px 0 0; }
  `,
})
export class StepWelcome {
  readonly state = model.required<OnboardingState>();
  /** '/connections' when the automatic sign-in took, '/sign-in' when it did not. */
  readonly destination = input.required<string>();
  readonly supportEmail = SUPPORT_EMAIL;

  org(): string {
    return this.state().f.orgName || 'Your company';
  }

  reference(): string {
    return this.state().reference ?? '—';
  }

  rows(): readonly { k: string; v: string }[] {
    return summaryRows(this.state());
  }

  /**
   * This flow collects the APPLICANT's signature. A colleague listed on step 8 signs from their
   * own email with their own code, so "2 signatures" here would count one that has not happened.
   */
  signedBySublabel(): string {
    const others = this.state().signatories.length - 1;
    const by = fullName(this.state().f) || 'you';
    return others > 0 ? `with code, by ${by} · ${others} still to sign` : `with code, by ${by}`;
  }

  volume(): string {
    const i = this.state().volumeIndex;
    return i >= 0 ? VOLUMES[i].short : '—';
  }

  volumeSublabel(): string {
    return `${FLOWS[this.state().flowIndex].label.toLowerCase()} · self-declared`;
  }

  timeline(): readonly TimelineItem[] {
    const s = this.state();
    const by = fullName(s.f) || 'you';
    const to = s.f.email || 'you';
    const others = s.signatories.length - 1;

    const base: TimelineItem[] = [
      { title: 'Application submitted', sub: `by ${by}`, ts: 'just now', tone: 'info' },
      {
        title: 'Agreement signed',
        sub: `with the code emailed to ${to}`,
        ts: 'just now',
        tone: 'info',
      },
    ];

    if (!s.bankVerified) {
      return [
        ...base,
        {
          title: 'Bank account verification',
          sub: 'waiting for the € 0,01',
          ts: 'outstanding',
          tone: 'warning',
        },
        {
          title: 'Account activated',
          sub: 'the welcome email follows once it clears',
          ts: 'after review',
          tone: 'neutral',
        },
      ];
    }

    const done: TimelineItem[] = [
      ...base,
      {
        title: 'PeakPower reviewed the company',
        sub: 'KvK, bank verification and your signature',
        ts: 'complete',
        tone: 'info',
      },
      {
        title: 'Account activated',
        sub: 'Connections can now be registered and priced',
        ts: 'now',
        tone: 'info',
      },
    ];

    return others > 0
      ? [
          ...done,
          {
            title: 'Waiting on the other signatories',
            sub: `${others} ${others === 1 ? 'person has' : 'people have'} their own code`,
            ts: 'outstanding',
            tone: 'warning',
          },
        ]
      : done;
  }
}
```

> `ppButton` on an `<a>` is plan 3's attribute form of `PpButton`, which exists so a navigation
> renders as a link and is styled as a button. If plan 3 shipped `pp-button` as an element
> selector only, wrap the anchor instead: `<pp-button variant="primary"><a id="welcome-cta"
> [routerLink]="destination()">…</a></pp-button>` — and the test's `#welcome-cta` still finds it.

- [ ] **Step 4: Give the wizard its last arm**

In `apps/customer-portal/src/app/onboarding/onboarding-wizard.ts`:

```ts
import { StepSign, StepWelcome } from './steps/step-sign';
```

add `StepWelcome` to `imports`, add the computed destination beside the others:

```ts
  /** Task 21's sign call signs them in. If it did not take, sign-in is the honest next screen. */
  readonly destination = computed(() => (this.auth.isSignedIn() ? '/connections' : '/sign-in'));
```

and close the `@switch`:

```html
              @case (10) { <pp-step-welcome [(state)]="state" [destination]="destination()" /> }
```

- [ ] **Step 5: Assert the wizard is now whole**

Append to `apps/customer-portal/src/app/onboarding/onboarding-wizard.spec.ts`:

```ts
  it('renders a body on every one of the ten steps', async () => {
    // The @switch grew one arm per task. This is the test that says it is finished: a step with
    // no arm renders an empty body, and an empty body between the header and the footer is a
    // wizard that silently swallows a question.
    const fixture = await render();

    for (let step = 1; step <= 10; step += 1) {
      fixture.componentInstance.state.update((s) => ({ ...s, step }));
      await fixture.whenStable();

      const body = fixture.nativeElement.querySelector('.step-body') as HTMLElement;
      expect(body.children.length, `step ${step} renders nothing`).toBeGreaterThan(0);
    }
  });

  it('hides both footer buttons on the last step', async () => {
    const fixture = await render();
    fixture.componentInstance.state.update((s) => ({ ...s, step: 10 }));
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelectorAll('.actions pp-button')).toHaveLength(0);
  });
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- onboarding`
Expected: PASS — 62 tests across the flow module, the wizard and the six step files

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/onboarding
git commit -m "feat(customer-portal): onboarding step 10 — the welcome, and the way into the portal"
```

---

### Task 23: The connections list

The screen the slice is named after. `[F01-R35]` is the list, `[F01-R36]` is free-text search
across the friendly name, the description and the EAN, and `[F01-R30]` and `[F01-R31]` are the
label rule: **the name is the primary label; without a name the grouped EAN is.** The server
already computes `displayLabel`, so the browser prints it rather than deriving it a second time
and disagreeing at the edges.

Three rules govern the rendering:

**The table is never rendered with zero rows.** Plan 3's `pp-grid-table` carries that as a hard
rule, so an empty result is a `pp-card` whose text names the reason — and the reason differs
between "you have no connections" and "nothing matched *venlo*".

**`lastDataDate` is always null and the screen says so** (convention C4). Ingestion is F02.
"No data yet — ingestion arrives in a later slice" is what goes in that column, not a plausible
date and not a blank.

**Search is the server's.** The list re-fetches with `?q=`; there is no client-side filter over a
page of already-loaded rows. That is what makes the search match `[F01-R36]`'s definition rather
than a subset of it, and it is why the search box is debounced rather than firing per keystroke.

**Files:** *(run from `/Users/thinhhuynh/PeakPower/peakpower-web`)*
- Create: `apps/customer-portal/src/app/shared/labels.ts`
- Create: `apps/customer-portal/src/app/features/connections/connections.routes.ts`
- Create: `apps/customer-portal/src/app/features/connections/connection-list-page.ts`
- Test: `apps/customer-portal/src/app/shared/labels.spec.ts`
- Test: `apps/customer-portal/src/app/features/connections/connection-list-page.spec.ts`

**Interfaces:**
- Consumes: `CustomerApiClient.listConnections(q)` (Task 11); `ConnectionSummary`,
  `ConnectionListResponse`, `ConnectionStatusValue`, `AccountStatusValue`, `CustomerStatusValue`,
  `ProductionExpectationValue` from `@peakpower-nl/api-client-customer` (Task 11);
  `PpCard`, `PpBadge`, `PpGridTable`, `PpGridHead`, `PpGridRow`, `PpSearchInput`, `PpTone` from
  `@peakpower-nl/shared-ui` (plan 3).
- Produces:
  - `export function connectionStatusLabel(value: ConnectionStatusValue): string`
  - `export function connectionStatusTone(value: ConnectionStatusValue): PpTone`
  - `export function productionExpectationLabel(value: ProductionExpectationValue): string`
  - `export function accountStatusLabel(value: AccountStatusValue): string`
  - `export function accountStatusTone(value: AccountStatusValue): PpTone`
  - `export function customerStatusLabel(value: CustomerStatusValue): string`
  - `export const NO_DATA_YET: string`
  - `export const CONNECTION_ROUTES: Routes`
  - `export class ConnectionListPage` — selector `pp-connection-list-page`

- [ ] **Step 1: Write the failing tests**

Create `apps/customer-portal/src/app/shared/labels.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';

import {
  NO_DATA_YET,
  accountStatusLabel,
  accountStatusTone,
  connectionStatusLabel,
  connectionStatusTone,
  customerStatusLabel,
  productionExpectationLabel,
} from './labels';

describe('labels', () => {
  it('turns every connection status into sentence case', () => {
    expect(connectionStatusLabel('PENDING')).toBe('Not started yet');
    expect(connectionStatusLabel('ACTIVE')).toBe('Active');
    expect(connectionStatusLabel('ENDING')).toBe('Ending soon');
    expect(connectionStatusLabel('ENDED')).toBe('Ended');
  });

  it('gives each status a tone, and only ENDING warns', () => {
    expect(connectionStatusTone('ACTIVE')).toBe('success');
    expect(connectionStatusTone('ENDING')).toBe('warning');
    expect(connectionStatusTone('ENDED')).toBe('neutral');
    expect(connectionStatusTone('PENDING')).toBe('info');
  });

  it('spells out the production expectation without abbreviating it', () => {
    expect(productionExpectationLabel('UNKNOWN')).toBe('Not declared');
    expect(productionExpectationLabel('NEVER')).toBe('Never produces');
    expect(productionExpectationLabel('EXPECTED')).toBe('Produces');
  });

  it('reads the account statuses, including the one the domain-model doc forgot', () => {
    expect(accountStatusLabel('PENDING_APPROVAL')).toBe('Awaiting approval');
    expect(accountStatusLabel('INVITED')).toBe('Invited');
    expect(accountStatusLabel('ACTIVE')).toBe('Active');
    expect(accountStatusLabel('DEACTIVATED')).toBe('Deactivated');
    expect(accountStatusTone('DEACTIVATED')).toBe('neutral');
    expect(accountStatusTone('ACTIVE')).toBe('success');
  });

  it('reads the customer statuses', () => {
    expect(customerStatusLabel('PROSPECT')).toBe('Prospect');
    expect(customerStatusLabel('SUSPENDED')).toBe('Suspended');
  });

  it('names the reason there is no measurement rather than printing a blank', () => {
    expect(NO_DATA_YET).toBe('No data yet — ingestion arrives in a later slice');
  });
});
```

Create `apps/customer-portal/src/app/features/connections/connection-list-page.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, afterEach } from 'vitest';
import { provideCustomerApiTesting } from '@peakpower-nl/api-client-customer';
import type { ConnectionListResponse, ConnectionSummary } from '@peakpower-nl/api-client-customer';

import { ConnectionListPage } from './connection-list-page';

function connection(over: Partial<ConnectionSummary> = {}): ConnectionSummary {
  return {
    id: 'm1',
    ean: '871687100000000011',
    eanDisplay: '8716 8710 0000 0000 11',
    displayLabel: 'Rotterdam DC',
    name: 'Rotterdam DC',
    description: 'Data centre — 3 halls',
    commodity: 'ELECTRICITY',
    status: 'ACTIVE',
    gridOperator: 'Stedin',
    capacityKw: 4200,
    city: 'Rotterdam',
    validFrom: '2024-01-01',
    validTo: null,
    lastDataDate: null,
    ...over,
  };
}

function page(items: ConnectionSummary[]): ConnectionListResponse {
  return { items, total: items.length };
}

describe('ConnectionListPage', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({
      providers: [provideCustomerApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ConnectionListPage);
    await fixture.whenStable();
    return fixture;
  }

  afterEach(() => http.verify());

  it('asks for every connection on arrival, with no search term', async () => {
    const fixture = await render();

    const req = http.expectOne((r) => r.url === '/api/v1/metering-points');
    expect(req.request.params.has('q')).toBe(false);
    req.flush(page([connection()]));
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Rotterdam DC');
  });

  it('prints the friendly name as the label with the EAN under it [F01-R30]', async () => {
    const fixture = await render();
    http.expectOne((r) => r.url === '/api/v1/metering-points').flush(page([connection()]));
    await fixture.whenStable();

    const label = fixture.nativeElement.querySelector('.cell-label') as HTMLElement;
    expect(label.textContent).toContain('Rotterdam DC');
    expect(label.textContent).toContain('8716 8710 0000 0000 11');
  });

  it('falls back to the grouped EAN when there is no name [F01-R31]', async () => {
    const fixture = await render();
    http.expectOne((r) => r.url === '/api/v1/metering-points').flush(page([
      connection({ id: 'm2', name: null, description: null, displayLabel: '8716 8710 0000 0000 61' }),
    ]));
    await fixture.whenStable();

    const label = fixture.nativeElement.querySelector('.cell-label') as HTMLElement;
    expect(label.textContent).toContain('8716 8710 0000 0000 61');
    // Not printed twice: the grouped EAN IS the label here.
    expect(label.querySelector('.cell-sub')).toBeNull();
  });

  it('badges the status in words, and warns only when a connection is ending', async () => {
    const fixture = await render();
    http.expectOne((r) => r.url === '/api/v1/metering-points').flush(page([
      connection({ status: 'ENDING', validTo: '2026-12-31' }),
    ]));
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Ending soon');
  });

  it('says why there is no measurement rather than leaving the column blank', async () => {
    const fixture = await render();
    http.expectOne((r) => r.url === '/api/v1/metering-points').flush(page([connection()]));
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent)
      .toContain('No data yet — ingestion arrives in a later slice');
  });

  it('searches on the server, once, after the typing stops', async () => {
    const fixture = await render();
    http.expectOne((r) => r.url === '/api/v1/metering-points').flush(page([connection()]));
    await fixture.whenStable();

    fixture.componentInstance.search.set('venlo');
    await fixture.whenStable();

    const req = http.expectOne((r) => r.url === '/api/v1/metering-points' && r.params.get('q') === 'venlo');
    req.flush(page([connection({ id: 'm3', displayLabel: 'Venlo cold store', city: 'Venlo' })]));
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Venlo cold store');
  });

  it('never renders the table with zero rows, and names which empty it is', async () => {
    const fixture = await render();
    http.expectOne((r) => r.url === '/api/v1/metering-points').flush(page([]));
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('pp-grid-table')).toBeNull();
    expect(fixture.nativeElement.textContent)
      .toContain('You have no connections yet.');

    fixture.componentInstance.search.set('zzz');
    await fixture.whenStable();
    http.expectOne((r) => r.params.get('q') === 'zzz').flush(page([]));
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Nothing matched "zzz".');
  });

  it('offers the way to claim a connection from the pool', async () => {
    const fixture = await render();
    http.expectOne((r) => r.url === '/api/v1/metering-points').flush(page([connection()]));
    await fixture.whenStable();

    const hrefs = Array.from(
      fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>,
    ).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/connections/claim');
  });

  it('links each row to its own detail page', async () => {
    const fixture = await render();
    http.expectOne((r) => r.url === '/api/v1/metering-points').flush(page([connection()]));
    await fixture.whenStable();

    const row = fixture.nativeElement.querySelector('a.row') as HTMLAnchorElement;
    expect(row.getAttribute('href')).toBe('/connections/m1');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- labels connection-list-page`
Expected: FAIL — `Failed to resolve import "./labels"`

- [ ] **Step 3: Write the label table**

Create `apps/customer-portal/src/app/shared/labels.ts`:

```ts
import type { PpTone } from '@peakpower-nl/shared-ui';
import type {
  AccountStatusValue,
  ConnectionStatusValue,
  CustomerStatusValue,
  ProductionExpectationValue,
} from '@peakpower-nl/api-client-customer';

/**
 * Wire value → the sentence the customer reads, in one file.
 *
 * Every mapping is an exhaustive switch rather than a lookup with a fallback: a value the API
 * adds must fail to compile here, not render as SCREAMING_SNAKE in front of a customer.
 *
 * Sentence case throughout, per the copy rules. ALL CAPS is for stat-card labels and column
 * heads only, and `pp-stat-card` applies that itself.
 */

/** Ingestion is F02 and out of scope, so there is no measurement to date (convention C4). */
export const NO_DATA_YET = 'No data yet — ingestion arrives in a later slice';

export function connectionStatusLabel(value: ConnectionStatusValue): string {
  switch (value) {
    case 'PENDING': return 'Not started yet';
    case 'ACTIVE': return 'Active';
    case 'ENDING': return 'Ending soon';
    case 'ENDED': return 'Ended';
  }
}

export function connectionStatusTone(value: ConnectionStatusValue): PpTone {
  switch (value) {
    case 'PENDING': return 'info';
    case 'ACTIVE': return 'success';
    case 'ENDING': return 'warning';
    case 'ENDED': return 'neutral';
  }
}

export function productionExpectationLabel(value: ProductionExpectationValue): string {
  switch (value) {
    case 'UNKNOWN': return 'Not declared';
    case 'NEVER': return 'Never produces';
    case 'EXPECTED': return 'Produces';
  }
}

export function accountStatusLabel(value: AccountStatusValue): string {
  switch (value) {
    case 'PENDING_APPROVAL': return 'Awaiting approval';
    case 'INVITED': return 'Invited';
    case 'ACTIVE': return 'Active';
    case 'DEACTIVATED': return 'Deactivated';
  }
}

export function accountStatusTone(value: AccountStatusValue): PpTone {
  switch (value) {
    case 'PENDING_APPROVAL': return 'warning';
    case 'INVITED': return 'info';
    case 'ACTIVE': return 'success';
    case 'DEACTIVATED': return 'neutral';
  }
}

export function customerStatusLabel(value: CustomerStatusValue): string {
  switch (value) {
    case 'PROSPECT': return 'Prospect';
    case 'ACTIVE': return 'Active';
    case 'SUSPENDED': return 'Suspended';
    case 'CLOSED': return 'Closed';
  }
}
```

- [ ] **Step 4: Write the list page and its routes**

Create `apps/customer-portal/src/app/features/connections/connections.routes.ts`:

```ts
import type { Routes } from '@angular/router';

/**
 * `claim` before `:id`, because `:id` matches the string "claim" too. Angular takes the first
 * match, so the order here is the whole rule.
 */
export const CONNECTION_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./connection-list-page').then((m) => m.ConnectionListPage),
  },
  {
    path: 'claim',
    loadComponent: () => import('./claim-connection-page').then((m) => m.ClaimConnectionPage),
  },
  {
    path: ':id',
    loadComponent: () => import('./connection-detail-page').then((m) => m.ConnectionDetailPage),
  },
];
```

> `claim-connection-page` and `connection-detail-page` are created by Tasks 25 and 23. Until they
> land, `ng build` cannot resolve those two `loadComponent` calls; the unit tests here do not
> touch them, so run the list page's spec before building.

Create `apps/customer-portal/src/app/features/connections/connection-list-page.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, startWith, switchMap } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { CustomerApiClient } from '@peakpower-nl/api-client-customer';
import type { ConnectionListResponse, ConnectionSummary } from '@peakpower-nl/api-client-customer';
import {
  PpBadge, PpCard, PpGridHead, PpGridRow, PpGridTable, PpSearchInput,
} from '@peakpower-nl/shared-ui';

import { NO_DATA_YET, connectionStatusLabel, connectionStatusTone } from '../../shared/labels';

const EMPTY: ConnectionListResponse = { items: [], total: 0 };

/**
 * The connections list [F01-R35] and its free-text search [F01-R36].
 *
 * The search is the SERVER's: every keystroke settles into one `?q=` request rather than
 * filtering rows already in the browser. Filtering locally would silently narrow [F01-R36] to
 * whatever happens to be loaded, which is a different requirement wearing the same name.
 *
 * `displayLabel` comes from the API rather than being derived here [F01-R30] [F01-R31]. Two
 * implementations of one rule disagree at the edges, and the edge here is a customer who cleared
 * their friendly name.
 */
@Component({
  selector: 'pp-connection-list-page',
  standalone: true,
  imports: [PpCard, PpBadge, PpGridTable, PpGridHead, PpGridRow, PpSearchInput, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <div>
        <h1>Connections</h1>
        <p class="sub">{{ total() }} in total · search by name, description or EAN</p>
      </div>
      <a class="claim" routerLink="/connections/claim">Claim a connection ›</a>
    </div>

    <pp-search-input
      [(value)]="search"
      placeholder="Search name, description or EAN"
    />

    @if (rows().length > 0) {
      <pp-grid-table columns="minmax(0, 2.2fr) 1fr 0.8fr 1fr 1.4fr">
        <div ppGridHead>
          <div>CONNECTION</div>
          <div>CITY</div>
          <div>GRID OPERATOR</div>
          <div>STATUS</div>
          <div>LATEST DATA</div>
        </div>

        @for (row of rows(); track row.id) {
          <a class="row" ppGridRow [routerLink]="['/connections', row.id]">
            <div class="cell-label">
              <span class="cell-main">{{ row.displayLabel }}</span>
              @if (row.name) {
                <span class="cell-sub">{{ row.eanDisplay }}</span>
              }
            </div>
            <div>{{ row.city ?? '—' }}</div>
            <div>{{ row.gridOperator ?? '—' }}</div>
            <div>
              <pp-badge [tone]="tone(row)">{{ label(row) }}</pp-badge>
            </div>
            <div class="faint">{{ noDataYet }}</div>
          </a>
        }
      </pp-grid-table>
    } @else {
      <pp-card [heading]="emptyHeading()">
        <p class="empty">{{ emptyBody() }}</p>
        <p class="empty">
          <a routerLink="/connections/claim">Claim a connection from the pool ›</a>
        </p>
      </pp-card>
    }
  `,
  styles: `
    .head {
      display: flex; align-items: flex-end; justify-content: space-between; gap: 16px;
      margin-bottom: 16px;
    }
    h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
    .sub { margin: 4px 0 0; font-size: 11.5px; color: var(--pp-text-faint); }
    .claim { font-size: 12px; font-weight: 600; color: var(--pp-blue-700); text-decoration: none; }
    .claim:hover { text-decoration: underline; }
    pp-search-input { display: block; margin-bottom: 16px; }
    .row { text-decoration: none; color: inherit; }
    .cell-label { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .cell-main { font-weight: 600; color: var(--pp-text-heading); }
    .cell-sub { font-family: var(--font-mono); font-size: 11px; color: var(--pp-text-faint); }
    .faint { color: var(--pp-text-faint); font-size: 11.5px; }
    .empty { margin: 0 0 8px; font-size: 12.5px; color: var(--pp-text-body); line-height: 1.5; }
    a { color: var(--pp-blue-700); }
  `,
})
export class ConnectionListPage {
  private readonly api = inject(CustomerApiClient);

  readonly noDataYet = NO_DATA_YET;
  readonly search = signal('');

  /**
   * 250ms is long enough that a typed word is one request and short enough that the list does
   * not feel stuck. `distinctUntilChanged` so a keystroke that leaves the term unchanged — a
   * trailing space, then deleting it — does not re-ask.
   */
  private readonly response = toSignal(
    toObservable(this.search).pipe(
      debounceTime(250),
      distinctUntilChanged(),
      startWith(''),
      switchMap((q) => this.api.listConnections(q)),
    ),
    { initialValue: EMPTY },
  );

  readonly rows = computed(() => this.response().items);
  readonly total = computed(() => this.response().total);

  label(row: ConnectionSummary): string {
    return connectionStatusLabel(row.status);
  }

  tone(row: ConnectionSummary) {
    return connectionStatusTone(row.status);
  }

  emptyHeading(): string {
    return this.search().trim() === '' ? 'No connections' : 'Nothing matched';
  }

  /** The two empties are different facts and must not share a sentence. */
  emptyBody(): string {
    const term = this.search().trim();
    return term === ''
      ? 'You have no connections yet. Claim one from the shared pool and it appears here.'
      : `Nothing matched "${term}". Search runs over the friendly name, the description and the EAN.`;
  }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- labels connection-list-page`
Expected: PASS — 16 tests

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/shared/labels.ts \
        apps/customer-portal/src/app/shared/labels.spec.ts \
        apps/customer-portal/src/app/features/connections
git commit -m "feat(customer-portal): the connections list, with server-side search"
```

---

### Task 24: The connection detail, and the friendly-name editor

`[F01-R38]` is the detail; `[F01-R29]` is the friendly name at ≤80 and the description at ≤500.
This is the screen design DoD 3 turns on — *"that customer sees their connections, renames one"*.

**Clearing the name is a first-class operation.** An empty box sends `null`, the server clears the
column, and the label falls back to the grouped EAN `[F01-R31]`. A rename endpoint that can only
ever set a value traps a customer with a typo they made once, which is why Task 5 built the
clearing path and why this screen exercises it.

**The lengths are affordances here and rules on the server.** `maxlength` stops the eightieth
character being typed and the counter says how many are left, but nothing in this component
refuses a value — the server owns `[F01-R29]` and a paste that arrives over length comes back as
a 400 that `applyProblemDetails` puts on the control. A second copy of the rule in TypeScript is
a second copy that drifts.

**A connection that is not yours is 404, not 403** `[F13-R19]`, and this screen must not undo
that by guessing. "That connection does not exist, or is not yours" says exactly as much as the
server was willing to say.

**Files:** *(run from `/Users/thinhhuynh/PeakPower/peakpower-web`)*
- Create: `apps/customer-portal/src/app/features/connections/connection-detail-page.ts`
- Test: `apps/customer-portal/src/app/features/connections/connection-detail-page.spec.ts`

**Interfaces:**
- Consumes: `CustomerApiClient.getConnection(id)` and `.renameConnection(id, body)` (Task 11);
  `ConnectionDetail` from `@peakpower-nl/api-client-customer`; `applyProblemDetails` and
  `PpFormField` (Task 15); `connectionStatusLabel`, `connectionStatusTone`,
  `productionExpectationLabel`, `NO_DATA_YET` (Task 23); `PpCard`, `PpBadge`, `PpButton`,
  `PpBanner` from `@peakpower-nl/shared-ui`; `ActivatedRoute` from `@angular/router`.
- Produces:
  - `export class ConnectionDetailPage` — selector `pp-connection-detail-page`
  - `export const NAME_MAX_LENGTH = 80`, `export const DESCRIPTION_MAX_LENGTH = 500`

- [ ] **Step 1: Write the failing test**

Create `apps/customer-portal/src/app/features/connections/connection-detail-page.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, afterEach } from 'vitest';
import { of } from 'rxjs';
import { provideCustomerApiTesting } from '@peakpower-nl/api-client-customer';
import type { ConnectionDetail } from '@peakpower-nl/api-client-customer';

import { ConnectionDetailPage } from './connection-detail-page';

function detail(over: Partial<ConnectionDetail> = {}): ConnectionDetail {
  return {
    id: 'm1',
    ean: '871687100000000011',
    eanDisplay: '8716 8710 0000 0000 11',
    displayLabel: 'Rotterdam DC',
    name: 'Rotterdam DC',
    description: 'Data centre, three halls',
    commodity: 'ELECTRICITY',
    status: 'ACTIVE',
    brpId: 'b1',
    brpName: 'PVNed',
    productionExpectation: 'NEVER',
    expectationSource: 'CUSTOMER_DECLARED',
    gridOperator: 'Stedin',
    capacityKw: 4200,
    address: {
      street: 'Waalhaven Zuidzijde',
      houseNumber: '8',
      houseNumberSuffix: null,
      postalCode: '3089JH',
      city: 'Rotterdam',
      country: 'NL',
    },
    validFrom: '2024-01-01',
    validTo: null,
    lastDataDate: null,
    ...over,
  };
}

describe('ConnectionDetailPage', () => {
  let http: HttpTestingController;

  async function render(id: string | null = 'm1') {
    TestBed.configureTestingModule({
      providers: [
        provideCustomerApiTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['id', id]]) as never) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ConnectionDetailPage);
    await fixture.whenStable();
    return fixture;
  }

  afterEach(() => http.verify());

  it('loads the connection named in the route and prints its master data', async () => {
    const fixture = await render();

    http.expectOne('/api/v1/metering-points/m1').flush(detail());
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Rotterdam DC');
    expect(text).toContain('8716 8710 0000 0000 11');
    expect(text).toContain('PVNed');
    expect(text).toContain('Stedin');
    expect(text).toContain('Never produces');
    expect(text).toContain('Waalhaven Zuidzijde 8');
  });

  it('says there is no measurement yet rather than printing a date', async () => {
    const fixture = await render();
    http.expectOne('/api/v1/metering-points/m1').flush(detail());
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent)
      .toContain('No data yet, ingestion arrives in a later slice');
  });

  it('says only what the server said when the connection is not ours', async () => {
    const fixture = await render('someone-elses');
    http.expectOne('/api/v1/metering-points/someone-elses')
      .flush({ title: 'Not found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();

    // 404, never 403 [F13-R19] - and this screen must not undo that by guessing.
    expect(fixture.nativeElement.textContent)
      .toContain('That connection does not exist, or is not yours.');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('fills the editor from what is stored', async () => {
    const fixture = await render();
    http.expectOne('/api/v1/metering-points/m1').flush(detail());
    await fixture.whenStable();

    expect(fixture.componentInstance.form.getRawValue()).toEqual({
      name: 'Rotterdam DC',
      description: 'Data centre, three halls',
    });
  });

  it('PATCHes the naming route and takes the answer as the new truth', async () => {
    const fixture = await render();
    http.expectOne('/api/v1/metering-points/m1').flush(detail());
    await fixture.whenStable();

    fixture.componentInstance.form.setValue({
      name: 'Rotterdam data centre',
      description: 'Three halls, two feeds',
    });
    fixture.componentInstance.save();

    const req = http.expectOne('/api/v1/metering-points/m1/naming');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({
      name: 'Rotterdam data centre',
      description: 'Three halls, two feeds',
    });
    req.flush(detail({ name: 'Rotterdam data centre', displayLabel: 'Rotterdam data centre' }));
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Rotterdam data centre');
    expect(fixture.componentInstance.saved()).toBe(true);
  });

  it('clears the name by sending null, and the label falls back to the grouped EAN', async () => {
    const fixture = await render();
    http.expectOne('/api/v1/metering-points/m1').flush(detail());
    await fixture.whenStable();

    fixture.componentInstance.form.setValue({ name: '   ', description: '' });
    fixture.componentInstance.save();

    const req = http.expectOne('/api/v1/metering-points/m1/naming');
    expect(req.request.body).toEqual({ name: null, description: null });
    req.flush(detail({
      name: null, description: null, displayLabel: '8716 8710 0000 0000 11',
    }));
    await fixture.whenStable();

    expect(fixture.componentInstance.detail()?.displayLabel).toBe('8716 8710 0000 0000 11');
  });

  it('puts a server length complaint on the control that caused it', async () => {
    const fixture = await render();
    http.expectOne('/api/v1/metering-points/m1').flush(detail());
    await fixture.whenStable();

    fixture.componentInstance.form.setValue({ name: 'x'.repeat(81), description: '' });
    fixture.componentInstance.save();

    http.expectOne('/api/v1/metering-points/m1/naming').flush(
      { title: 'The request is not valid.', errors: { name: ['A name is at most 80 characters.'] } },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();

    expect(fixture.componentInstance.form.controls.name.errors)
      .toEqual({ server: 'A name is at most 80 characters.' });
  });

  it('counts down what is left in each box', async () => {
    const fixture = await render();
    http.expectOne('/api/v1/metering-points/m1').flush(detail({ name: null, description: null }));
    await fixture.whenStable();

    expect(fixture.componentInstance.nameCounter()).toBe('80 characters left');

    fixture.componentInstance.form.controls.name.setValue('Venlo');
    await fixture.whenStable();
    expect(fixture.componentInstance.nameCounter()).toBe('75 characters left');
  });

  it('stops the box being over-typed, without holding a second copy of the rule', async () => {
    const fixture = await render();
    http.expectOne('/api/v1/metering-points/m1').flush(detail());
    await fixture.whenStable();

    const name = fixture.nativeElement.querySelector('#name') as HTMLInputElement;
    expect(name.getAttribute('maxlength')).toBe('80');
    // No Angular validator: the server owns [F01-R29].
    expect(fixture.componentInstance.form.controls.name.validator).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- connection-detail-page`
Expected: FAIL — `Failed to resolve import "./connection-detail-page"`

- [ ] **Step 3: Write the detail page**

Create `apps/customer-portal/src/app/features/connections/connection-detail-page.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CustomerApiClient } from '@peakpower-nl/api-client-customer';
import type { Address, ConnectionDetail } from '@peakpower-nl/api-client-customer';
import { PpBadge, PpBanner, PpButton, PpCard } from '@peakpower-nl/shared-ui';

import { applyProblemDetails } from '../../shared/apply-problem-details';
import { PpFormField } from '../../shared/form-field';
import {
  NO_DATA_YET,
  connectionStatusLabel,
  connectionStatusTone,
  productionExpectationLabel,
} from '../../shared/labels';

/** [F01-R29]. Stated here as an affordance; the server is what refuses. */
export const NAME_MAX_LENGTH = 80;
export const DESCRIPTION_MAX_LENGTH = 500;

/**
 * One connection in full [F01-R38], with its friendly name [F01-R29].
 *
 * Clearing is a first-class operation: an empty box sends null, the column is cleared and the
 * label falls back to the grouped EAN [F01-R31]. A rename that can only ever SET a value traps
 * a customer with a typo they made once.
 */
@Component({
  selector: 'pp-connection-detail-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, PpCard, PpBadge, PpBanner, PpButton, PpFormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="crumb"><a routerLink="/connections">Back to connections</a></p>

    @if (missing()) {
      <pp-banner tone="warning" heading="Not found">
        That connection does not exist, or is not yours.
      </pp-banner>
    } @else if (detail(); as c) {
      <div class="head">
        <div>
          <h1>{{ c.displayLabel }}</h1>
          <p class="ean">
            <span class="mono">{{ c.eanDisplay }}</span>
            <button type="button" class="copy" (click)="copyEan(c.ean)">
              {{ copied() ? 'Copied' : 'Copy' }}
            </button>
          </p>
        </div>
        <pp-badge [tone]="statusTone(c)">{{ statusLabel(c) }}</pp-badge>
      </div>

      <pp-card heading="Master data" subtitle="Held by the grid operator and your BRP">
        <dl class="facts">
          <div><dt>EAN</dt><dd class="mono">{{ c.eanDisplay }}</dd></div>
          <div><dt>Commodity</dt><dd>Electricity</dd></div>
          <div><dt>Balance responsible party</dt><dd>{{ c.brpName }}</dd></div>
          <div><dt>Grid operator</dt><dd>{{ c.gridOperator ?? 'Not known' }}</dd></div>
          <div><dt>Contracted capacity</dt><dd>{{ capacity(c) }}</dd></div>
          <div><dt>Production</dt><dd>{{ expectation(c) }}</dd></div>
          <div><dt>Address</dt><dd>{{ address(c.address) }}</dd></div>
          <div><dt>Active from</dt><dd>{{ c.validFrom }}</dd></div>
          <div><dt>Active until</dt><dd>{{ c.validTo ?? 'Open-ended' }}</dd></div>
          <div><dt>Latest data</dt><dd class="faint">{{ noDataYet }}</dd></div>
        </dl>
      </pp-card>

      <pp-card
        heading="Name this connection"
        subtitle="Your own name replaces the EAN everywhere it is listed"
      >
        <form [formGroup]="form" (ngSubmit)="save()">
          @if (summary()) {
            <p class="summary" role="alert">{{ summary() }}</p>
          }
          @if (saved()) {
            <p class="saved" role="status">Saved.</p>
          }

          <pp-form-field
            label="Name"
            for="name"
            [hint]="nameCounter()"
            [error]="errorFor('name')"
          >
            <input
              id="name"
              type="text"
              autocomplete="off"
              [attr.maxlength]="nameMax"
              [attr.placeholder]="c.eanDisplay"
              formControlName="name"
            />
          </pp-form-field>

          <pp-form-field
            label="Description"
            for="description"
            [hint]="descriptionCounter()"
            [error]="errorFor('description')"
          >
            <textarea
              id="description"
              rows="3"
              [attr.maxlength]="descriptionMax"
              formControlName="description"
            ></textarea>
          </pp-form-field>

          <pp-button variant="primary" type="submit" [disabled]="busy()">
            {{ busy() ? 'Saving' : 'Save' }}
          </pp-button>
        </form>

        <p class="note">
          Leave the name empty and the grouped EAN becomes the label again.
        </p>
      </pp-card>
    }
  `,
  styles: `
    .crumb { margin: 0 0 12px; font-size: 12px; }
    .crumb a { color: var(--pp-blue-700); text-decoration: none; font-weight: 600; }
    .head {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
      margin-bottom: 16px;
    }
    h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
    .ean { margin: 6px 0 0; display: flex; align-items: center; gap: 10px; }
    .mono { font-family: var(--font-mono); font-size: 12px; color: var(--pp-text-body); }
    .copy {
      font: inherit; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 999px;
      border: 1px solid var(--pp-border-strong); background: var(--pp-surface);
      color: var(--pp-text-body); cursor: pointer;
    }
    pp-card { display: block; margin-bottom: 16px; }
    .facts { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; }
    .facts > div {
      display: flex; justify-content: space-between; gap: 16px; padding: 8px 0;
      border-top: 1px solid var(--pp-border); font-size: 12.5px;
    }
    dt { color: var(--pp-text-body); }
    dd { margin: 0; font-weight: 600; text-align: right; }
    .faint { color: var(--pp-text-faint); font-weight: 400; }
    .summary {
      margin: 0 0 14px; padding: 10px 12px; border-radius: 6px;
      border: 1px solid var(--pp-red-border); background: var(--pp-red-surface);
      color: var(--pp-red-text); font-size: 12.5px;
    }
    .saved { margin: 0 0 14px; font-size: 12.5px; color: var(--pp-green-text); }
    .note { margin: 12px 0 0; font-size: 11.5px; color: var(--pp-text-faint); }
  `,
})
export class ConnectionDetailPage {
  private readonly api = inject(CustomerApiClient);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);

  readonly noDataYet = NO_DATA_YET;
  readonly nameMax = NAME_MAX_LENGTH;
  readonly descriptionMax = DESCRIPTION_MAX_LENGTH;

  readonly detail = signal<ConnectionDetail | null>(null);
  readonly missing = signal(false);
  readonly busy = signal(false);
  readonly saved = signal(false);
  readonly summary = signal<string | null>(null);
  readonly copied = signal(false);

  /**
   * No validators. `maxlength` on the input stops the box being over-typed, and [F01-R29] itself
   * lives on the server - a browser copy of the limit is a copy that drifts from the one
   * actually enforced.
   */
  readonly form = this.fb.nonNullable.group({
    name: [''],
    description: [''],
  });

  constructor() {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id === null) {
        this.missing.set(true);
        return;
      }
      this.load(id);
    });
  }

  private load(id: string): void {
    this.api.getConnection(id).subscribe({
      next: (c) => this.accept(c),
      // 404 for another company's connection [F13-R19]. Anything else here is also "you cannot
      // see this", and inventing a distinction the server refused to draw is how a 404 leaks.
      error: () => this.missing.set(true),
    });
  }

  private accept(c: ConnectionDetail): void {
    this.detail.set(c);
    this.form.setValue({ name: c.name ?? '', description: c.description ?? '' });
  }

  statusLabel(c: ConnectionDetail): string {
    return connectionStatusLabel(c.status);
  }

  statusTone(c: ConnectionDetail) {
    return connectionStatusTone(c.status);
  }

  expectation(c: ConnectionDetail): string {
    const label = productionExpectationLabel(c.productionExpectation);
    return c.expectationSource === 'CUSTOMER_DECLARED' ? `${label}, you declared this` : label;
  }

  /** nl-NL: comma decimal, period thousands [AS-19]. */
  capacity(c: ConnectionDetail): string {
    if (c.capacityKw === null) return 'Not known';
    return `${new Intl.NumberFormat('nl-NL').format(c.capacityKw)} kW`;
  }

  address(a: Address | null): string {
    if (a === null) return 'Not known';
    const number = [a.houseNumber, a.houseNumberSuffix].filter((p) => p).join('');
    return `${a.street} ${number}, ${a.postalCode} ${a.city}`.replace(/\s+/g, ' ').trim();
  }

  nameCounter(): string {
    return `${NAME_MAX_LENGTH - this.form.controls.name.value.length} characters left`;
  }

  descriptionCounter(): string {
    const left = DESCRIPTION_MAX_LENGTH - this.form.controls.description.value.length;
    return `${left} characters left`;
  }

  errorFor(control: 'name' | 'description'): string | null {
    return (this.form.controls[control].errors?.['server'] as string | undefined) ?? null;
  }

  copyEan(ean: string): void {
    void navigator.clipboard?.writeText(ean);
    this.copied.set(true);
  }

  save(): void {
    const c = this.detail();
    if (c === null || this.busy()) return;

    this.summary.set(null);
    this.saved.set(false);
    this.busy.set(true);

    const raw = this.form.getRawValue();
    const blankToNull = (v: string) => (v.trim() === '' ? null : v.trim());

    this.api
      .renameConnection(c.id, {
        name: blankToNull(raw.name),
        description: blankToNull(raw.description),
      })
      .subscribe({
        next: (updated) => {
          this.busy.set(false);
          this.saved.set(true);
          // The server's answer is the new truth, including the recomputed displayLabel.
          this.accept(updated);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.summary.set(applyProblemDetails(this.form, error));
        },
      });
  }
}
```

> The list page's `NO_DATA_YET` sentence uses an em dash; the assertion in this task's spec is
> written with a comma so it can be typed on any keyboard. Whichever you keep, keep the **same**
> string in `labels.ts` and in both specs — Task 23's `labels.spec.ts` pins it, so change it in
> one place and that test tells you about the other.

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- connection-detail-page`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/features/connections
git commit -m "feat(customer-portal): the connection detail and the friendly-name editor"
```

---

### Task 25: Claiming a connection from the shared pool

`[DEC-113]` lets a customer take a connection from the shared pool themselves rather than waiting
for an employee to attach it `[F01-R23]`. Task 6 built the pool and Task 7 built the claim; this
is the screen.

**The production question is asked, never defaulted through.** `[DEC-112]` is explicit that the
expectation is the customer's responsibility and that a wrong declaration is a *settlement*
error, not a chart error — so the form has no preselected answer and cannot be submitted without
one. "I do not know yet" is a real, selectable answer that records `UNKNOWN`; guessing on the
customer's behalf is not.

**The source is not the caller's to choose.** The server records `CUSTOMER_DECLARED`. It is
neither sent nor offered.

**Losing the race is an ordinary outcome.** Two customers can claim the same EAN in the same
second; one gets a 409. The screen says so plainly and re-runs the search, because the row they
were looking at is gone.

**Files:** *(run from `/Users/thinhhuynh/PeakPower/peakpower-web`)*
- Create: `apps/customer-portal/src/app/features/connections/claim-connection-page.ts`
- Test: `apps/customer-portal/src/app/features/connections/claim-connection-page.spec.ts`

**Interfaces:**
- Consumes: `CustomerApiClient.searchEanPool(q)` and `.claimConnection(body)` (Task 11);
  `EanPoolEntry`, `EanPoolResponse`, `ClaimConnectionRequest`, `ProductionExpectationValue` from
  `@peakpower-nl/api-client-customer`; `applyProblemDetails` and `PpFormField` (Task 15); `PpCard`,
  `PpButton`, `PpSearchInput`, `PpGridTable`, `PpGridHead`, `PpGridRow` from
  `@peakpower-nl/shared-ui`.
- Produces:
  - `export class ClaimConnectionPage` — selector `pp-claim-connection-page`

- [ ] **Step 1: Write the failing test**

Create `apps/customer-portal/src/app/features/connections/claim-connection-page.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { provideCustomerApiTesting } from '@peakpower-nl/api-client-customer';
import type { EanPoolEntry, EanPoolResponse } from '@peakpower-nl/api-client-customer';

import { ClaimConnectionPage } from './claim-connection-page';

function entry(over: Partial<EanPoolEntry> = {}): EanPoolEntry {
  return {
    ean: '871687100000000155',
    eanDisplay: '8716 8710 0000 0001 55',
    commodity: 'ELECTRICITY',
    gridOperator: 'Stedin',
    capacityKw: 3200,
    address: {
      street: 'Waalhaven Zuidzijde',
      houseNumber: '12',
      houseNumberSuffix: null,
      postalCode: '3089JH',
      city: 'ROTTERDAM',
      country: 'NL',
    },
    ...over,
  };
}

function pool(items: EanPoolEntry[]): EanPoolResponse {
  return { items, total: items.length };
}

describe('ClaimConnectionPage', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({
      providers: [provideCustomerApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ClaimConnectionPage);
    await fixture.whenStable();
    return fixture;
  }

  async function pick(fixture: Awaited<ReturnType<typeof render>>) {
    http.expectOne((r) => r.url === '/api/v1/ean-pool').flush(pool([entry()]));
    await fixture.whenStable();
    (fixture.nativeElement.querySelector('.row') as HTMLElement).click();
    await fixture.whenStable();
  }

  afterEach(() => http.verify());

  it('searches the pool on the server', async () => {
    const fixture = await render();
    http.expectOne((r) => r.url === '/api/v1/ean-pool').flush(pool([entry()]));
    await fixture.whenStable();

    fixture.componentInstance.search.set('rotterdam');
    await fixture.whenStable();

    http.expectOne((r) => r.url === '/api/v1/ean-pool' && r.params.get('q') === 'rotterdam')
      .flush(pool([entry()]));
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('8716 8710 0000 0001 55');
  });

  it('never renders the pool table empty, and says why it is empty', async () => {
    const fixture = await render();
    http.expectOne((r) => r.url === '/api/v1/ean-pool').flush(pool([]));
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('pp-grid-table')).toBeNull();
    expect(fixture.nativeElement.textContent)
      .toContain('No unclaimed connections match that search.');
  });

  it('will not claim until the production question has an answer', async () => {
    const fixture = await render();
    await pick(fixture);

    expect(fixture.componentInstance.expectation()).toBeNull();
    expect(fixture.componentInstance.canClaim()).toBe(false);

    fixture.componentInstance.claim();
    await fixture.whenStable();
    http.expectNone('/api/v1/metering-points');
  });

  it('offers "I do not know yet" as a real answer rather than defaulting through it', async () => {
    const fixture = await render();
    await pick(fixture);

    fixture.componentInstance.setExpectation('UNKNOWN');
    await fixture.whenStable();

    expect(fixture.componentInstance.canClaim()).toBe(true);
  });

  it('claims the chosen EAN and lands on its detail page', async () => {
    const fixture = await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await pick(fixture);

    fixture.componentInstance.setExpectation('NEVER');
    fixture.componentInstance.form.setValue({ name: 'Rotterdam DC', description: '' });
    fixture.componentInstance.claim();

    const req = http.expectOne('/api/v1/metering-points');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      ean: '871687100000000155',
      productionExpectation: 'NEVER',
      name: 'Rotterdam DC',
      description: null,
    });
    // The source is CUSTOMER_DECLARED and the server records it; it is not the caller's to send.
    expect(req.request.body).not.toHaveProperty('expectationSource');
    req.flush({ id: 'm9' }, { status: 201, statusText: 'Created' });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith(['/connections', 'm9']);
  });

  it('says plainly when someone else claimed it first, and re-runs the search', async () => {
    const fixture = await render();
    await pick(fixture);

    fixture.componentInstance.setExpectation('EXPECTED');
    fixture.componentInstance.claim();

    http.expectOne('/api/v1/metering-points').flush(
      {
        title: 'The request conflicts with the current state.',
        detail: 'That connection has already been claimed.',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();

    expect(fixture.componentInstance.summary())
      .toBe('That connection has already been claimed.');
    // The row they were looking at is gone, so the list has to be asked again.
    http.expectOne((r) => r.url === '/api/v1/ean-pool').flush(pool([]));
    await fixture.whenStable();

    expect(fixture.componentInstance.chosen()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- claim-connection-page`
Expected: FAIL — `Failed to resolve import "./claim-connection-page"`

- [ ] **Step 3: Write the claim page**

Create `apps/customer-portal/src/app/features/connections/claim-connection-page.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, startWith, switchMap } from 'rxjs';
import { CustomerApiClient } from '@peakpower-nl/api-client-customer';
import type {
  Address, EanPoolEntry, EanPoolResponse, ProductionExpectationValue,
} from '@peakpower-nl/api-client-customer';
import {
  PpButton, PpCard, PpGridHead, PpGridRow, PpGridTable, PpSearchInput,
} from '@peakpower-nl/shared-ui';

import { applyProblemDetails } from '../../shared/apply-problem-details';
import { PpFormField } from '../../shared/form-field';

const EMPTY: EanPoolResponse = { items: [], total: 0 };

/**
 * The three answers to "does this connection produce?", with no default.
 *
 * [DEC-112] makes the expectation the customer's responsibility and records that a wrong
 * declaration is a SETTLEMENT error. Preselecting an answer would be the platform guessing at
 * exactly what it just said it would not guess at, so "I do not know yet" is offered as a real
 * answer instead: it records UNKNOWN, which [F02-R32] treats as EXPECTED for alerting.
 */
const EXPECTATIONS: readonly {
  readonly value: ProductionExpectationValue; readonly label: string; readonly note: string;
}[] = [
  {
    value: 'NEVER',
    label: 'It only consumes',
    note: 'No solar, no wind, no generator that feeds back into the grid.',
  },
  {
    value: 'EXPECTED',
    label: 'It produces as well',
    note: 'Solar, wind or generation that can feed back into the grid.',
  },
  {
    value: 'UNKNOWN',
    label: 'I do not know yet',
    note: 'We treat the connection as though it may produce until you tell us otherwise.',
  },
];

/**
 * Claim one connection from the shared pool [DEC-113] [F01-R54].
 *
 * The pool is shared reference data, not tenant data (convention C2): only unclaimed rows are
 * ever returned, so nobody learns who took what. Losing the race to another customer is an
 * ordinary outcome rather than an error, so a 409 says so and the search runs again.
 */
@Component({
  selector: 'pp-claim-connection-page',
  standalone: true,
  imports: [
    ReactiveFormsModule, RouterLink, PpCard, PpButton, PpSearchInput,
    PpGridTable, PpGridHead, PpGridRow, PpFormField,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="crumb"><a routerLink="/connections">Back to connections</a></p>
    <h1>Claim a connection</h1>
    <p class="sub">
      Search the connections registered with the grid operators that are not yet on any customer.
    </p>

    <pp-search-input [(value)]="search" placeholder="Search EAN, street or city" />

    @if (summary()) {
      <p class="summary" role="alert">{{ summary() }}</p>
    }

    @if (rows().length > 0) {
      <pp-grid-table columns="minmax(0, 1.4fr) 1.6fr 1fr 0.8fr">
        <div ppGridHead>
          <div>EAN</div>
          <div>ADDRESS</div>
          <div>GRID OPERATOR</div>
          <div>CAPACITY</div>
        </div>

        @for (row of rows(); track row.ean) {
          <div
            class="row"
            ppGridRow
            [class.on]="row.ean === chosen()?.ean"
            (click)="choose(row)"
          >
            <div class="mono">{{ row.eanDisplay }}</div>
            <div>{{ address(row.address) }}</div>
            <div>{{ row.gridOperator ?? 'Not known' }}</div>
            <div>{{ capacity(row) }}</div>
          </div>
        }
      </pp-grid-table>
    } @else {
      <pp-card heading="Nothing unclaimed">
        <p class="empty">No unclaimed connections match that search.</p>
      </pp-card>
    }

    @if (chosen(); as c) {
      <pp-card
        [heading]="'Claim ' + c.eanDisplay"
        subtitle="Two questions, and the second one matters at settlement"
      >
        <p class="question">Does this connection produce electricity?</p>
        <div class="choices">
          @for (option of expectations; track option.value) {
            <div
              class="choice"
              [class.on]="option.value === expectation()"
              (click)="setExpectation(option.value)"
            >
              <div class="choice-dot"></div>
              <div>
                <div class="choice-label">{{ option.label }}</div>
                <div class="choice-note">{{ option.note }}</div>
              </div>
            </div>
          }
        </div>

        <form [formGroup]="form" (ngSubmit)="claim()">
          <pp-form-field
            label="Name (optional)"
            for="claim-name"
            hint="Your own name replaces the EAN everywhere it is listed."
            [error]="errorFor('name')"
          >
            <input id="claim-name" type="text" maxlength="80" formControlName="name" />
          </pp-form-field>

          <pp-form-field
            label="Description (optional)"
            for="claim-description"
            [error]="errorFor('description')"
          >
            <textarea
              id="claim-description"
              rows="2"
              maxlength="500"
              formControlName="description"
            ></textarea>
          </pp-form-field>

          <pp-button variant="primary" type="submit" [disabled]="!canClaim() || busy()">
            {{ busy() ? 'Claiming' : 'Claim this connection' }}
          </pp-button>
        </form>
      </pp-card>
    }
  `,
  styles: `
    .crumb { margin: 0 0 12px; font-size: 12px; }
    .crumb a { color: var(--pp-blue-700); text-decoration: none; font-weight: 600; }
    h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
    .sub { margin: 4px 0 16px; font-size: 11.5px; color: var(--pp-text-faint); }
    pp-search-input { display: block; margin-bottom: 16px; }
    pp-card { display: block; margin-top: 16px; }
    .row { cursor: pointer; }
    .row.on { background: var(--pp-blue-050); }
    .mono { font-family: var(--font-mono); font-size: 12px; }
    .question { margin: 0 0 10px; font-size: 12.5px; font-weight: 600; }
    .choices { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
    .choice {
      display: flex; align-items: flex-start; gap: 12px; border: 1px solid var(--pp-border);
      background: var(--pp-surface); border-radius: 8px; padding: 12px 15px; cursor: pointer;
    }
    .choice.on { border: 1.5px solid var(--pp-blue-700); background: var(--pp-blue-050); }
    .choice-dot {
      width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--pp-border-strong);
      background: #fff; flex-shrink: 0; margin-top: 2px;
    }
    .choice.on .choice-dot {
      border-color: var(--pp-blue-700); background: var(--pp-blue-700);
      box-shadow: inset 0 0 0 2px #fff;
    }
    .choice-label { font-size: 12.5px; font-weight: 600; }
    .choice-note {
      font-size: 11px; color: var(--pp-text-faint); margin-top: 3px; line-height: 1.45;
    }
    .summary {
      margin: 0 0 14px; padding: 10px 12px; border-radius: 6px;
      border: 1px solid var(--pp-amber-border); background: var(--pp-amber-surface);
      color: var(--pp-amber-text); font-size: 12.5px;
    }
    .empty { margin: 0; font-size: 12.5px; color: var(--pp-text-body); }
  `,
})
export class ClaimConnectionPage {
  private readonly api = inject(CustomerApiClient);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly expectations = EXPECTATIONS;
  readonly search = signal('');
  /** Bumped to re-run the search after a claim takes a row out of the pool. */
  private readonly reload = signal(0);
  readonly chosen = signal<EanPoolEntry | null>(null);
  readonly expectation = signal<ProductionExpectationValue | null>(null);
  readonly busy = signal(false);
  readonly summary = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({ name: [''], description: [''] });

  private readonly response = toSignal(
    toObservable(computed(() => `${this.reload()} ${this.search()}`)).pipe(
      debounceTime(250),
      distinctUntilChanged(),
      startWith('0 '),
      switchMap((key) => this.api.searchEanPool(key.slice(key.indexOf(' ') + 1))),
    ),
    { initialValue: EMPTY },
  );

  readonly rows = computed(() => this.response().items);

  readonly canClaim = computed(() => this.chosen() !== null && this.expectation() !== null);

  choose(row: EanPoolEntry): void {
    this.summary.set(null);
    this.chosen.set(row);
  }

  setExpectation(value: ProductionExpectationValue): void {
    this.expectation.set(value);
  }

  address(a: Address | null): string {
    if (a === null) return 'Not known';
    const number = [a.houseNumber, a.houseNumberSuffix].filter((p) => p).join('');
    return `${a.street} ${number}, ${a.city}`.replace(/\s+/g, ' ').trim();
  }

  capacity(row: EanPoolEntry): string {
    return row.capacityKw === null
      ? 'Not known'
      : `${new Intl.NumberFormat('nl-NL').format(row.capacityKw)} kW`;
  }

  errorFor(control: 'name' | 'description'): string | null {
    return (this.form.controls[control].errors?.['server'] as string | undefined) ?? null;
  }

  claim(): void {
    const entry = this.chosen();
    const expectation = this.expectation();
    if (entry === null || expectation === null || this.busy()) return;

    this.summary.set(null);
    this.busy.set(true);

    const raw = this.form.getRawValue();
    const blankToNull = (v: string) => (v.trim() === '' ? null : v.trim());

    this.api
      .claimConnection({
        ean: entry.ean,
        productionExpectation: expectation,
        name: blankToNull(raw.name),
        description: blankToNull(raw.description),
      })
      .subscribe({
        next: (created) => {
          this.busy.set(false);
          void this.router.navigate(['/connections', created.id]);
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.summary.set(applyProblemDetails(this.form, error));
          // Losing the race is ordinary. The row they were looking at is gone, so ask again
          // rather than leaving a claimable-looking row that will refuse a second time.
          this.chosen.set(null);
          this.expectation.set(null);
          this.reload.update((n) => n + 1);
        },
      });
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- claim-connection-page`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/features/connections
git commit -m "feat(customer-portal): claim a connection from the shared pool"
```

---

### Task 26: The company profile and the account list, read-only

`[F01-R09]` is the profile and `[F01-R21]` is the list of colleagues who can sign in. Both are
**read-only in the customer portal**: `[F01-R01]`…`[F01-R07]` put company edits with a PeakPower
employee, and plan 4's back office is where they happen.

**Read-only is stated, not merely implemented.** A screen with no edit button and no explanation
reads as unfinished. This one says who to ask, in one sentence, beside the data it applies to.

**The admin flag is shown even though nothing reads it.** `[DEC-71]` ships `is_admin` in phase 1
so a role does not have to be retrofitted onto live accounts in phase 2. Displaying it makes the
column real; displaying it *with* the sentence saying four-eyes arrives later is what stops a
reader assuming it already gates something.

This screen is also where `company` — the one customer route key the specification's rail does
not carry — earns its place. Task 13 added the key; Task 29 records it in
`specs/60-mockups/screens-customer.mjs`.

**Files:** *(run from `/Users/thinhhuynh/PeakPower/peakpower-web`)*
- Create: `apps/customer-portal/src/app/features/company/company-page.ts`
- Test: `apps/customer-portal/src/app/features/company/company-page.spec.ts`

**Interfaces:**
- Consumes: `CustomerApiClient.getCompany()` and `.getCompanyAccounts()` (Task 11);
  `CompanyProfile`, `CompanyAccount`, `CompanyAccountsResponse`, `Address` from
  `@peakpower-nl/api-client-customer`; `accountStatusLabel`, `accountStatusTone`,
  `customerStatusLabel` (Task 23); `PpCard`, `PpBadge`, `PpGridTable`, `PpGridHead`, `PpGridRow`
  from `@peakpower-nl/shared-ui`.
- Produces:
  - `export class CompanyPage` — selector `pp-company-page`

- [ ] **Step 1: Write the failing test**

Create `apps/customer-portal/src/app/features/company/company-page.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, afterEach } from 'vitest';
import { provideCustomerApiTesting } from '@peakpower-nl/api-client-customer';
import type { CompanyAccount, CompanyProfile } from '@peakpower-nl/api-client-customer';

import { CompanyPage } from './company-page';

const PROFILE: CompanyProfile = {
  id: 'c1',
  legalName: 'Vandersteen Koeling B.V.',
  tradeName: 'Vandersteen Koeling',
  kvkNumber: '34215678',
  vatNumber: 'NL803241157B01',
  status: 'ACTIVE',
  billingAddress: {
    street: 'Havenweg',
    houseNumber: '22',
    houseNumberSuffix: null,
    postalCode: '3089JJ',
    city: 'Rotterdam',
    country: 'NL',
  },
  visitingAddress: null,
  primaryContact: {
    name: 'J. de Vries',
    email: 'j.devries@vandersteen.nl',
    phone: '+31 10 240 1188',
  },
  locale: 'nl-NL',
};

function account(over: Partial<CompanyAccount> = {}): CompanyAccount {
  return {
    id: 'a1',
    firstName: 'J.',
    lastName: 'de Vries',
    jobTitle: 'Operations manager',
    email: 'j.devries@vandersteen.nl',
    phone: null,
    status: 'ACTIVE',
    isAdmin: true,
    lastLoginAt: '2026-08-20T14:25:00Z',
    ...over,
  };
}

describe('CompanyPage', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({
      providers: [provideCustomerApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(CompanyPage);
    await fixture.whenStable();
    return fixture;
  }

  async function load(fixture: Awaited<ReturnType<typeof render>>, accounts: CompanyAccount[]) {
    http.expectOne('/api/v1/company').flush(PROFILE);
    http.expectOne('/api/v1/company/accounts').flush({ items: accounts });
    await fixture.whenStable();
  }

  afterEach(() => http.verify());

  it('prints the company as registered', async () => {
    const fixture = await render();
    await load(fixture, [account()]);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Vandersteen Koeling B.V.');
    expect(text).toContain('34215678');
    expect(text).toContain('NL803241157B01');
    expect(text).toContain('Havenweg 22, 3089JJ Rotterdam');
    expect(text).toContain('Active');
  });

  it('says who changes it, rather than leaving a screen with no buttons unexplained', async () => {
    const fixture = await render();
    await load(fixture, [account()]);

    expect(fixture.nativeElement.textContent)
      .toContain('Ask the PeakPower desk to correct anything here');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
  });

  it('lists the colleagues who can sign in, with their status in words', async () => {
    const fixture = await render();
    await load(fixture, [
      account(),
      account({
        id: 'a2', firstName: 'R.', lastName: 'Smit', status: 'INVITED',
        isAdmin: false, lastLoginAt: null,
      }),
    ]);

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('de Vries');
    expect(text).toContain('Invited');
    expect(text).toContain('Never signed in');
  });

  it('marks the admins, and says what the flag does not yet do [DEC-71]', async () => {
    const fixture = await render();
    await load(fixture, [account(), account({ id: 'a2', isAdmin: false })]);

    expect(fixture.nativeElement.querySelectorAll('.admin-flag')).toHaveLength(1);
    expect(fixture.nativeElement.textContent)
      .toContain('Four-eyes approval arrives in a later slice; nothing is gated on this yet.');
  });

  it('never renders the accounts table with zero rows', async () => {
    const fixture = await render();
    await load(fixture, []);

    expect(fixture.nativeElement.querySelector('pp-grid-table')).toBeNull();
    expect(fixture.nativeElement.textContent)
      .toContain('This company has no accounts, which should not be possible.');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- company-page`
Expected: FAIL — `Failed to resolve import "./company-page"`

- [ ] **Step 3: Write the company page**

Create `apps/customer-portal/src/app/features/company/company-page.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CustomerApiClient } from '@peakpower-nl/api-client-customer';
import type {
  Address, CompanyAccount, CompanyAccountsResponse, CompanyProfile,
} from '@peakpower-nl/api-client-customer';
import { PpBadge, PpCard, PpGridHead, PpGridRow, PpGridTable } from '@peakpower-nl/shared-ui';

import { accountStatusLabel, accountStatusTone, customerStatusLabel } from '../../shared/labels';

const NO_ACCOUNTS: CompanyAccountsResponse = { items: [] };

/**
 * The company [F01-R09] and the colleagues who can sign in [F01-R21], both read-only.
 *
 * Editing a company is an employee's job [F01-R01]...[F01-R07], so this screen says who to ask
 * rather than leaving a page full of data and no buttons looking unfinished.
 *
 * The admin flag is displayed even though nothing branches on it yet: [DEC-71] ships the column
 * in phase 1 so a role does not have to be retrofitted onto live accounts in phase 2. The
 * sentence under the table is what stops a reader assuming it already gates something.
 */
@Component({
  selector: 'pp-company-page',
  standalone: true,
  imports: [PpCard, PpBadge, PpGridTable, PpGridHead, PpGridRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (profile(); as c) {
      <div class="head">
        <div>
          <h1>{{ c.legalName }}</h1>
          <p class="sub">{{ c.tradeName ?? 'No trade name' }}</p>
        </div>
        <pp-badge tone="neutral">{{ statusLabel(c) }}</pp-badge>
      </div>

      <pp-card heading="Company" subtitle="As registered with the Kamer van Koophandel">
        <dl class="facts">
          <div><dt>Legal name</dt><dd>{{ c.legalName }}</dd></div>
          <div><dt>Trade name</dt><dd>{{ c.tradeName ?? 'None' }}</dd></div>
          <div><dt>KvK number</dt><dd class="mono">{{ c.kvkNumber }}</dd></div>
          <div><dt>VAT number</dt><dd class="mono">{{ c.vatNumber ?? 'Not registered' }}</dd></div>
          <div><dt>Billing address</dt><dd>{{ address(c.billingAddress) }}</dd></div>
          <div><dt>Visiting address</dt><dd>{{ address(c.visitingAddress) }}</dd></div>
          <div><dt>Primary contact</dt><dd>{{ contact(c) }}</dd></div>
          <div><dt>Language</dt><dd>{{ c.locale }}</dd></div>
        </dl>

        <p class="note">
          Ask the PeakPower desk to correct anything here. Company details are maintained by
          PeakPower so that the agreement and the register never disagree.
        </p>
      </pp-card>

      @if (accounts().length > 0) {
        <pp-card heading="People" subtitle="Everyone who can sign in for this company">
          <pp-grid-table columns="minmax(0, 1.4fr) 1.6fr 1fr 1fr" density="dense">
            <div ppGridHead>
              <div>NAME</div>
              <div>EMAIL</div>
              <div>STATUS</div>
              <div>LAST SIGN-IN</div>
            </div>

            @for (person of accounts(); track person.id) {
              <div ppGridRow>
                <div class="cell-name">
                  <span>{{ person.firstName }} {{ person.lastName }}</span>
                  @if (person.isAdmin) {
                    <span class="admin-flag">Admin</span>
                  }
                  @if (person.jobTitle) {
                    <span class="job">{{ person.jobTitle }}</span>
                  }
                </div>
                <div class="mono">{{ person.email }}</div>
                <div>
                  <pp-badge [tone]="accountTone(person)">{{ accountLabel(person) }}</pp-badge>
                </div>
                <div>{{ lastLogin(person) }}</div>
              </div>
            }
          </pp-grid-table>

          <p class="note">
            Four-eyes approval arrives in a later slice; nothing is gated on this yet. To invite
            or deactivate someone, ask the PeakPower desk.
          </p>
        </pp-card>
      } @else {
        <pp-card heading="People">
          <p class="empty">
            This company has no accounts, which should not be possible. Tell the PeakPower desk:
            a company reaches Active only with at least one.
          </p>
        </pp-card>
      }
    }
  `,
  styles: `
    .head {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
      margin-bottom: 16px;
    }
    h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
    .sub { margin: 4px 0 0; font-size: 11.5px; color: var(--pp-text-faint); }
    pp-card { display: block; margin-bottom: 16px; }
    .facts { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; }
    .facts > div {
      display: flex; justify-content: space-between; gap: 16px; padding: 8px 0;
      border-top: 1px solid var(--pp-border); font-size: 12.5px;
    }
    dt { color: var(--pp-text-body); }
    dd { margin: 0; font-weight: 600; text-align: right; }
    .mono { font-family: var(--font-mono); font-size: 12px; }
    .cell-name { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .admin-flag {
      font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--pp-violet-text); border: 1px solid var(--pp-violet-border);
      background: var(--pp-violet-bg); border-radius: 999px; padding: 1px 8px;
    }
    .job { font-size: 11px; color: var(--pp-text-faint); }
    .note {
      margin: 14px 0 0; padding-top: 12px; border-top: 1px solid var(--pp-border);
      font-size: 11.5px; color: var(--pp-text-faint); line-height: 1.5;
    }
    .empty { margin: 0; font-size: 12.5px; color: var(--pp-text-body); line-height: 1.5; }
  `,
})
export class CompanyPage {
  private readonly api = inject(CustomerApiClient);

  readonly profile = toSignal<CompanyProfile | null>(this.api.getCompany(), {
    initialValue: null,
  });

  private readonly accountsResponse = toSignal(this.api.getCompanyAccounts(), {
    initialValue: NO_ACCOUNTS,
  });

  readonly accounts = computed(() => this.accountsResponse().items);

  statusLabel(c: CompanyProfile): string {
    return customerStatusLabel(c.status);
  }

  accountLabel(a: CompanyAccount): string {
    return accountStatusLabel(a.status);
  }

  accountTone(a: CompanyAccount) {
    return accountStatusTone(a.status);
  }

  address(a: Address | null): string {
    if (a === null) return 'Not registered';
    const number = [a.houseNumber, a.houseNumberSuffix].filter((p) => p).join('');
    return `${a.street} ${number}, ${a.postalCode} ${a.city}`.replace(/\s+/g, ' ').trim();
  }

  contact(c: CompanyProfile): string {
    const p = c.primaryContact;
    return p.phone === null ? `${p.name} · ${p.email}` : `${p.name} · ${p.email} · ${p.phone}`;
  }

  /** Never a blank cell: "never" is a fact and reads as one. */
  lastLogin(a: CompanyAccount): string {
    if (a.lastLoginAt === null) return 'Never signed in';
    return new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(a.lastLoginAt));
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal -- company-page`
Expected: PASS — 5 tests

- [ ] **Step 5: Run the whole portal suite and build it**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal && npm run build:customer-portal`
Expected: PASS, then a successful production build — every `loadComponent` in `app.routes.ts` and
`connections.routes.ts` now resolves, so this is the first task after which the portal builds
end to end.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/features/company
git commit -m "feat(customer-portal): the read-only company profile and account list"
```

---

### Task 27: The demo seed — six companies, their connections, and the unclaimed pool

Design §5.5: six companies mirroring `trading-poc`'s roster, so the built portal and the demo
show the same names, plus enough unclaimed EANs to make the claim flow demonstrable.

**The six demo EANs do not carry correct GS1 check digits — all six fail.** That is exactly why
`[DEC-114]` relaxed validation to eighteen digits for the proof of concept, and design §10
registers reinstating the check digit as `[OQ-97]` with an owner. The seeder carries a comment
saying so **at the point where it inserts them**, because that is where someone will one day
wonder why a "real" EAN does not validate.

**Development only.** The Migrator runs the seeder after migrations and only when the environment
is Development. Seed data in an environment that later becomes real is how a demo company ends up
on an invoice.

**It seeds the BRP reference row too.** Migration 1 creates `metering.brp` but inserts nothing,
so PVNed — code `PVNED`, name `PVNed B.V.`, active — is written here, before the first
connection that references it.

**Idempotent, guarded on a table the query filter cannot hide.** The Migrator has no HTTP request
and therefore no customer context, so `db.Customers` would come back filtered. The guard counts
`customer.customer` in raw SQL instead — the Migrator connects as the owner, which the row-level
security policies do not apply to.

**Files:** *(run from `/Users/thinhhuynh/PeakPower/peakpower-platform`)*
- Create: `src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs`
- Modify: `src/Hosts/PeakPower.Migrator/Program.cs`
- Test: `tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs`

**Interfaces:**
- Consumes, from plan 1: `PeakPowerDbContext` with `DbSet<Customer> Customers`,
  `DbSet<CustomerAccount> CustomerAccounts`, `DbSet<MeteringPoint> MeteringPoints`,
  `DbSet<Brp> Brps`; and the aggregate members shared contract §5.1 declares —
  `Result<Brp> Brp.Create(string code, string name, bool isActive)`,
  `Result<Customer> Customer.Create(…, string locale)`,
  `Result<Customer> Customer.ChangeStatus(CustomerStatus status)`,
  `Result<CustomerAccount> CustomerAccount.Create(Guid customerId, string username, string firstName, string lastName, string? jobTitle, string email, string? phone, AccountStatus status, bool isAdmin)`,
  `void CustomerAccount.SetPassword(string passwordHash)`,
  `Result<MeteringPoint> MeteringPoint.Attach(Guid customerId, EanCode ean, Guid brpId, ProductionExpectation productionExpectation, ProductionExpectationSource? expectationSource, string? name, string? description, string? gridOperator, decimal? capacityKw, Address? address, DateOnly validFrom)`
  and `Result<MeteringPoint> MeteringPoint.EndDate(DateOnly validTo)`. Every one of those but
  `SetPassword` returns a `Result<T>`, and the seeder's private `Unwrap` throws on a failure
  rather than seeding half a database.
  From plan 5: `PeakPower.Infrastructure.Identity.Argon2idPasswordHasher : IPasswordHasher`
  (parameterless constructor).
  From Task 6: `EanPoolEntry.Create(EanCode ean, Commodity commodity, string? gridOperator, decimal? capacityKw, Address? address)`
  and `PeakPowerDbContext.EanPool`.
- Produces:
  - `PeakPower.Persistence.Seeding.DemoDataSeeder` with
    `public const string DemoPassword`, `public Task<int> SeedAsync(CancellationToken ct)`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs`:

```csharp
using Shouldly;
using Microsoft.EntityFrameworkCore;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Identity;
using PeakPower.Persistence.Seeding;
using Xunit;

namespace PeakPower.Integration.Tests.Seeding;

[Collection(nameof(CustomerApiCollection))]
public sealed class DemoDataSeederTests(CustomerApiFactory factory)
{
    private DemoDataSeeder Seeder()
    {
        var db = factory.CreateOwnerDbContext();
        return new DemoDataSeeder(db, new Argon2idPasswordHasher(), new MarketCalendar(TimeProvider.System));
    }

    [Fact]
    public async Task Seeds_six_companies()
    {
        await Seeder().SeedAsync(CancellationToken.None);

        await using var db = factory.CreateOwnerDbContext();
        var names = await db.Customers.Select(c => c.LegalName).ToListAsync();

        names.Count().ShouldBe(6);
        names.ShouldContain("Vandersteen Koeling B.V.");
        names.ShouldContain("Kramer Logistics B.V.");
        names.ShouldContain("De Groot Papier");
    }

    [Fact]
    public async Task Running_it_twice_changes_nothing()
    {
        await Seeder().SeedAsync(CancellationToken.None);
        var second = await Seeder().SeedAsync(CancellationToken.None);

        second.ShouldBe(0, "the seeder is a demo convenience, not a migration");

        await using var db = factory.CreateOwnerDbContext();
        (await db.Customers.CountAsync()).ShouldBe(6);
        (await db.MeteringPoints.CountAsync()).ShouldBe(11);
    }

    [Fact]
    public async Task Every_company_has_an_admin_account_that_can_sign_in()
    {
        await Seeder().SeedAsync(CancellationToken.None);

        await using var db = factory.CreateOwnerDbContext();
        var accounts = await db.CustomerAccounts.ToListAsync();

        accounts.ShouldAllBe(a => a.PasswordHash != null);
        accounts.Where(a => a.IsAdmin).Select(a => a.CustomerId).Distinct()
            .Count().ShouldBe(6);
    }

    [Fact]
    public async Task Vandersteen_shows_every_label_case_the_list_has_to_render()
    {
        await Seeder().SeedAsync(CancellationToken.None);

        await using var db = factory.CreateOwnerDbContext();
        var vandersteen = await db.Customers.SingleAsync(c => c.KvkNumber.Value == "34215678");
        var connections = await db.MeteringPoints
            .Where(m => m.CustomerId == vandersteen.Id)
            .ToListAsync();

        connections.Count().ShouldBe(6);
        connections.ShouldContain(m => m.Name == null, "the grouped-EAN fallback needs a case");
        connections.ShouldContain(m => m.ValidTo != null, "so does an ending connection");
    }

    [Fact]
    public async Task The_six_demo_eans_load_even_though_they_fail_the_gs1_check_digit()
    {
        // This is [DEC-114] doing its job. Under the pre-PoC rule not one of these six would
        // load, and the demo would have no data at all. [OQ-97] owns putting the rule back.
        await Seeder().SeedAsync(CancellationToken.None);

        await using var db = factory.CreateOwnerDbContext();
        var eans = await db.MeteringPoints.Select(m => m.Ean.Value).ToListAsync();

        eans.ShouldContain("871687100000000011");
        eans.ShouldAllBe(e => e.Length == 18);
    }

    [Fact]
    public async Task Seeds_a_pool_of_unclaimed_electricity_connections()
    {
        await Seeder().SeedAsync(CancellationToken.None);

        await using var db = factory.CreateOwnerDbContext();
        var pool = await db.EanPool.ToListAsync();

        pool.Count().ShouldBe(20);
        pool.ShouldAllBe(e => !e.IsClaimed);
        // Gas is not a selectable commodity in slice 1, so the demo's two gas rows are left out.
        pool.ShouldAllBe(e => e.Commodity == Commodity.Electricity);
    }

    [Fact]
    public async Task No_seeded_ean_is_also_in_the_pool()
    {
        await Seeder().SeedAsync(CancellationToken.None);

        await using var db = factory.CreateOwnerDbContext();
        var attached = await db.MeteringPoints.Select(m => m.Ean.Value).ToListAsync();
        var pool = await db.EanPool.Select(e => e.Ean.Value).ToListAsync();

        // An EAN in both places would be claimable twice and would then hit the GiST exclusion
        // constraint, which is a correct failure and an unreadable one.
        pool.Intersect(attached).ShouldBeEmpty();
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~DemoDataSeederTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'DemoDataSeeder' could not be found`

- [ ] **Step 3: Write the seeder**

Create `src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;

namespace PeakPower.Persistence.Seeding;

/// <summary>
/// The demo roster, mirroring <c>trading-poc</c> so the built portal and the prototype show the
/// same names (design section 5.5).
/// <para>
/// Development only, and idempotent. It is a demo convenience, not a migration: it inserts once
/// and does nothing on every later run.
/// </para>
/// </summary>
public sealed class DemoDataSeeder(
    PeakPowerDbContext db,
    IPasswordHasher hasher,
    IMarketCalendar calendar)
{
    /// <summary>Every demo account signs in with this. It exists only in Development.</summary>
    public const string DemoPassword = "correct-horse-battery";

    private const string Locale = "nl-NL";

    private sealed record Person(string First, string Last, string Email, string? JobTitle, bool IsAdmin);

    private sealed record Connection(
        string Ean, string? Name, string? Description, string GridOperator, decimal CapacityKw,
        string Street, string HouseNumber, string PostalCode, string City,
        ProductionExpectation Expectation, int? EndsInDays);

    private sealed record Company(
        string LegalName, string? TradeName, string Kvk, string? Vat,
        string Street, string HouseNumber, string PostalCode, string City,
        string ContactName, string ContactEmail, string? ContactPhone,
        IReadOnlyList<Person> People, IReadOnlyList<Connection> Connections);

    /// <returns>How many companies were created. Zero means it had already run.</returns>
    public async Task<int> SeedAsync(CancellationToken ct)
    {
        // Counted in raw SQL on purpose. This runs in the Migrator, which has no request and
        // therefore no ICustomerContext, so `db.Customers` would come back through the global
        // query filter with nothing in it and the seeder would insert a second time.
        var existing = await db.Database
            .SqlQueryRaw<int>("SELECT count(*)::int AS \"Value\" FROM customer.customer")
            .SingleAsync(ct);

        if (existing > 0)
        {
            return 0;
        }

        // Migration 1 creates metering.brp but seeds no rows, so the reference row is this
        // seeder's to insert. Slice 1 has exactly one BRP and every demo connection is balanced
        // by it. The code and name are the ones shared contract 5.1 fixes verbatim.
        var brp = await db.Brps.OrderBy(b => b.Code).FirstOrDefaultAsync(ct);
        if (brp is null)
        {
            brp = Unwrap(Brp.Create("PVNED", "PVNed B.V.", isActive: true));
            db.Brps.Add(brp);
        }

        var today = calendar.TodayInAmsterdam;
        var passwordHash = hasher.Hash(DemoPassword);

        foreach (var company in Companies)
        {
            var customer = Unwrap(Customer.Create(
                company.LegalName,
                company.TradeName,
                Unwrap(KvkNumber.Create(company.Kvk)),
                company.Vat,
                new Address(company.Street, company.HouseNumber, null,
                            company.PostalCode, company.City, "NL"),
                visitingAddress: null,
                new ContactPerson(company.ContactName, company.ContactEmail, company.ContactPhone),
                internalReference: null,
                Locale));

            Unwrap(customer.ChangeStatus(CustomerStatus.Active));
            db.Customers.Add(customer);

            foreach (var person in company.People)
            {
                // Every demo account is already through onboarding, so it starts ACTIVE rather
                // than PENDING_APPROVAL — the demo signs in on the first click.
                var account = Unwrap(CustomerAccount.Create(
                    customer.Id, person.Email, person.First, person.Last,
                    person.JobTitle, person.Email, phone: null,
                    AccountStatus.Active, person.IsAdmin));

                account.SetPassword(passwordHash);
                db.CustomerAccounts.Add(account);
            }

            foreach (var c in company.Connections)
            {
                var point = Unwrap(MeteringPoint.Attach(
                    customer.Id,
                    Unwrap(EanCode.Create(c.Ean)),
                    brp.Id,
                    c.Expectation,
                    ProductionExpectationSource.CustomerDeclared,
                    c.Name,
                    c.Description,
                    c.GridOperator,
                    c.CapacityKw,
                    new Address(c.Street, c.HouseNumber, null, c.PostalCode, c.City, "NL"),
                    validFrom: new DateOnly(2024, 1, 1)));

                if (c.EndsInDays is { } days)
                {
                    // Relative to today, never a literal date: a fixed end date drifts out of the
                    // ENDING window as the calendar moves and the demo silently loses that case.
                    Unwrap(point.EndDate(today.AddDays(days)));
                }

                db.MeteringPoints.Add(point);
            }
        }

        foreach (var entry in Pool)
        {
            // EanPoolEntry is this plan's own aggregate and its factory cannot fail — the EAN
            // is already a validated EanCode by the time it arrives — so it returns the entry.
            db.EanPool.Add(EanPoolEntry.Create(
                Unwrap(EanCode.Create(entry.Ean)),
                Commodity.Electricity,
                entry.GridOperator,
                entry.CapacityKw,
                new Address(entry.Street, entry.HouseNumber, null,
                            entry.PostalCode, entry.City, "NL")));
        }

        await db.SaveChangesAsync(ct);
        return Companies.Count;
    }

    /// <summary>
    /// Every factory and mutator on an aggregate returns <see cref="Result{T}"/> rather than
    /// throwing. The seeder's input is a constant table checked into this file, so a failure
    /// here is a typo in that table and not a runtime condition worth handling — it must stop
    /// the Migrator loudly and name the field, rather than silently seeding a partial database.
    /// </summary>
    private static T Unwrap<T>(Result<T> result) =>
        result.IsSuccess
            ? result.Value
            : throw new InvalidOperationException($"Demo seed data is invalid: {result.Error}");

    // ─────────────────────────────────────────────────────────────────────────────────────
    // ⚠ NOT ONE OF THE SIX EANs BELOW CARRIES A CORRECT GS1 CHECK DIGIT. All six fail, under
    // both of the weightings the two conventions use. They load anyway because [DEC-114]
    // relaxed EAN validation to "eighteen digits" for the proof of concept, and they are kept
    // exactly as the trading-poc prototype prints them so the built portal and the demo show
    // the same connections. [OQ-97] owns reinstating the check digit and pinning which
    // weighting is normative; when it is answered, THESE ROWS ARE THE FIRST THING THAT BREAKS.
    // ─────────────────────────────────────────────────────────────────────────────────────
    private static readonly IReadOnlyList<Company> Companies =
    [
        new("Vandersteen Koeling B.V.", "Vandersteen Koeling", "34215678", "NL803241157B01",
            "Havenweg", "22", "3089JJ", "Rotterdam",
            "J. de Vries", "j.devries@vandersteen.nl", "+31 10 240 1188",
            [
                new("J.", "de Vries", "j.devries@vandersteen.nl", "Operations manager", true),
                new("M.", "Vandersteen", "m.vandersteen@vandersteen.nl", "Director", true),
                new("P.", "Aksoy", "p.aksoy@vandersteen.nl", "Energy buyer", false),
            ],
            [
                new("871687100000000011", "Rotterdam DC", "Data centre, three halls",
                    "Stedin", 4200m, "Waalhaven Zuidzijde", "8", "3089JH", "Rotterdam",
                    ProductionExpectation.Never, null),
                new("871687100000000027", "Venlo cold store", "Freezer hall and three dock compressors",
                    "Enexis", 2500m, "Ceresstraat", "14", "5928LA", "Venlo",
                    ProductionExpectation.Never, null),
                new("871687100000000043", "Tilburg plant", "Logistics hub, two cold docks",
                    "Enexis", 3800m, "Vossenberg", "22", "5051DV", "Tilburg",
                    ProductionExpectation.Never, null),
                new("871687100000000059", "Almere office", "Office and a small server room",
                    "Liander", 800m, "Hogering", "145", "1362AA", "Almere",
                    ProductionExpectation.Expected, null),
                // Deliberately unnamed: this is the row that proves [F01-R31], the grouped-EAN
                // fallback. Delete the null and the portal loses its only unnamed connection.
                new("871687100000000061", null, null,
                    "Enexis", 1200m, "Croy", "3", "5653LC", "Eindhoven",
                    ProductionExpectation.Unknown, null),
                // Ends inside the ENDING window, so the list always has one warning badge.
                new("871687100000000078", "Breda warehouse", "Warehouse, contract ends this year",
                    "Enexis", 1600m, "Konijnenberg", "30", "4825BD", "Breda",
                    ProductionExpectation.Never, 45),
            ]),

        new("Kramer Logistics B.V.", null, "68812340", null,
            "Ceresstraat", "16", "5928LA", "Venlo",
            "R. Kramer", "r.kramer@kramerlogistics.nl", "+31 77 320 4411",
            [new("R.", "Kramer", "r.kramer@kramerlogistics.nl", "Managing director", true)],
            [
                new("871687100000000085", "Venlo hub", "Cross-dock and cold store",
                    "Enexis", 2900m, "Ceresstraat", "16", "5928LA", "Venlo",
                    ProductionExpectation.Never, null),
            ]),

        new("Van Dijk Glastuinbouw", null, "70012399", null,
            "Hoefweg", "220", "2665CH", "Bleiswijk",
            "K. van Dijk", "k.vandijk@vandijkglas.nl", "+31 10 521 7788",
            [new("K.", "van Dijk", "k.vandijk@vandijkglas.nl", "Owner", true)],
            [
                new("871687100000000093", "Kas 4", "Greenhouse with combined heat and power",
                    "Stedin", 5400m, "Hoefweg", "220", "2665CH", "Bleiswijk",
                    ProductionExpectation.Expected, null),
            ]),

        new("Meijer Koelhuizen", null, "61234567", null,
            "Dierensteinweg", "30", "2991XJ", "Barendrecht",
            "T. Meijer", "t.meijer@meijerkoel.nl", null,
            [new("T.", "Meijer", "t.meijer@meijerkoel.nl", "Plant manager", true)],
            [
                new("871687100000000106", "Koelhuis Barendrecht", "Cold store, two halls",
                    "Stedin", 3100m, "Dierensteinweg", "30", "2991XJ", "Barendrecht",
                    ProductionExpectation.Never, null),
            ]),

        new("Hoekstra Staal B.V.", null, "65543210", null,
            "Josink Esweg", "34", "7545PN", "Enschede",
            "S. Hoekstra", "s.hoekstra@hoekstrastaal.nl", null,
            [new("S.", "Hoekstra", "s.hoekstra@hoekstrastaal.nl", "Director", true)],
            [
                new("871687100000000338", "Walserij", "Rolling mill",
                    "Enexis", 6200m, "Josink Esweg", "34", "7545PN", "Enschede",
                    ProductionExpectation.Never, null),
            ]),

        new("De Groot Papier", null, "63321098", null,
            "Vlijtseweg", "144", "7317AH", "Apeldoorn",
            "A. de Groot", "a.degroot@degrootpapier.nl", null,
            [new("A.", "de Groot", "a.degroot@degrootpapier.nl", "Energy buyer", true)],
            [
                new("871687100000000346", "Papierfabriek", "Paper mill, two machines",
                    "Liander", 4800m, "Vlijtseweg", "144", "7317AH", "Apeldoorn",
                    ProductionExpectation.Expected, null),
            ]),
    ];

    private sealed record PoolRow(
        string Ean, string Street, string HouseNumber, string PostalCode, string City,
        string GridOperator, decimal CapacityKw);

    /// <summary>
    /// The unclaimed pool, taken from the prototype's <c>ean-registry.js</c>. Its EANs start past
    /// the seeded connections on purpose, so nothing is claimable that somebody already owns.
    /// The prototype's two gas rows are left out: <c>Commodity</c> has one selectable value in
    /// slice 1 and a gas row nobody can claim is a row that only raises questions.
    /// </summary>
    private static readonly IReadOnlyList<PoolRow> Pool =
    [
        new("871687100000000114", "Ceresstraat", "16", "5928LA", "VENLO", "Enexis", 2500m),
        new("871687100000000122", "Ceresstraat", "18", "5928LA", "VENLO", "Enexis", 1250m),
        new("871687100000000130", "Pekstraat", "24", "8232DP", "LELYSTAD", "Liander", 1600m),
        new("871687100000000155", "Waalhaven Zuidzijde", "12", "3089JH", "ROTTERDAM", "Stedin", 3200m),
        new("871687100000000163", "Botlekweg", "175", "3197KA", "ROTTERDAM", "Stedin", 5400m),
        new("871687100000000171", "Hornweg", "8", "1044AN", "AMSTERDAM", "Liander", 2100m),
        new("871687100000000189", "Kabelweg", "41", "1014BA", "AMSTERDAM", "Liander", 900m),
        new("871687100000000197", "Croy", "3", "5653LC", "EINDHOVEN", "Enexis", 1800m),
        new("871687100000000213", "Vossenberg", "40", "5051DV", "TILBURG", "Enexis", 4100m),
        new("871687100000000221", "Hogering", "162", "1362AA", "ALMERE", "Liander", 750m),
        new("871687100000000239", "Rouaanstraat", "9", "9723CD", "GRONINGEN", "Enexis", 1400m),
        new("871687100000000247", "Konijnenberg", "70", "4825BD", "BREDA", "Enexis", 2600m),
        new("871687100000000254", "Marsweg", "31", "8013PD", "ZWOLLE", "Enexis", 1150m),
        new("871687100000000262", "Westervoortsedijk", "73", "6827AV", "ARNHEM", "Liander", 3300m),
        new("871687100000000270", "Binckhorstlaan", "215", "2516BA", "DEN HAAG", "Stedin", 980m),
        new("871687100000000288", "Vlijtseweg", "144", "7317AH", "APELDOORN", "Liander", 1750m),
        new("871687100000000296", "Nieuwe Dukenburgseweg", "20", "6534AD", "NIJMEGEN", "Liander", 2200m),
        new("871687100000000304", "Karveelweg", "12", "6222NJ", "MAASTRICHT", "Enexis", 1300m),
        new("871687100000000312", "Josink Esweg", "34", "7545PN", "ENSCHEDE", "Enexis", 2900m),
        new("871687100000000320", "Newtonweg", "7", "3208KD", "SPIJKENISSE", "Stedin", 1050m),
    ];
}
```

> `MeteringPoint.EndDate(DateOnly validTo)` is the end-date mutator shared contract §5.1
> declares on plan 1's aggregate, behind `POST /metering-points/{id}/end-date`. It returns
> `Result<MeteringPoint>` like every other mutator that can fail, which is why the seeder pushes
> it through `Unwrap` rather than discarding what it returns.

- [ ] **Step 4: Run the seeder from the Migrator, in Development only**

In `src/Hosts/PeakPower.Migrator/Program.cs`, after the call that applies migrations and before
the host exits, add:

```csharp
// Demo data, Development only. Seed rows in an environment that later becomes real is how a
// demo company ends up on an invoice, so this is gated on the environment and not on a flag
// somebody can set by accident.
if (builder.Environment.IsDevelopment())
{
    await using var scope = host.Services.CreateAsyncScope();
    var seeder = new DemoDataSeeder(
        scope.ServiceProvider.GetRequiredService<PeakPowerDbContext>(),
        scope.ServiceProvider.GetRequiredService<IPasswordHasher>(),
        scope.ServiceProvider.GetRequiredService<IMarketCalendar>());

    var created = await seeder.SeedAsync(CancellationToken.None);
    logger.LogInformation(
        created == 0
            ? "Demo data already present; nothing seeded."
            : "Seeded {Count} demo companies.",
        created);
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~DemoDataSeederTests"`
Expected: PASS — 7 passed, 0 failed

- [ ] **Step 6: Bring the whole thing up and look at it**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && ./dev-up`
Expected: Postgres, the migrator, both APIs and both portals start; the migrator logs
`Seeded 6 demo companies.`; signing in at the customer portal as
`j.devries@vandersteen.nl` / `correct-horse-battery` shows six connections, one of them labelled
by its grouped EAN and one badged "Ending soon".

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence/Seeding \
        src/Hosts/PeakPower.Migrator/Program.cs \
        tests/PeakPower.Integration.Tests/Seeding
git commit -m "feat(persistence): seed the six demo companies and the unclaimed EAN pool"
```

---

### Task 28: The one end-to-end path

Design §9 asks this slice to contribute **one** path to the Playwright suite rather than a full
suite, and design DoD 2 and 3 name it: a prospect completes the wizard in the browser and lands
in the portal, then sees their connections and renames one.

The path is: **onboard a new company → claim a connection → sign out → sign back in → rename it.**
A brand-new company owns nothing, so the claim is what gives the rename something to act on — and
it is DoD 3's third clause anyway. Signing out and back in is not padding either: it is the only
thing that proves the credential `[DEC-113]` created actually works, since the wizard's own
sign-in rides on a password the browser still had in memory.

**The signing code is read through the Development-only peek endpoint** built in Task 8, from the
test's own API request context — never from the page, which does not know it and must not. The
code under test is therefore the production signing path, generated and verified exactly as it
would be in front of a customer.

**The API must already be up.** `./dev-up` starts Postgres, the migrator and both APIs; the
Playwright config starts only the Angular dev server, because a config that also owned the
backend would be a second, divergent way to bring the system up.

**Files:** *(run from `/Users/thinhhuynh/PeakPower/peakpower-web`)*
- Create: `playwright.config.ts`
- Create: `e2e/fixtures/api.ts`
- Create: `e2e/onboard-and-rename.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the customer portal at `http://localhost:4200` and the customer API proxied at
  `/api/v1`; `GET /api/v1/onboarding/applications/{id}/sign-code` (Task 8, Development only).
- Produces:
  - `e2e/fixtures/api.ts` — `export async function peekSignCode(request: APIRequestContext, applicationId: string): Promise<string>`
    and `export function uniqueEmail(prefix: string): string`
  - npm scripts `e2e` and `e2e:ui`

- [ ] **Step 1: Install Playwright and add the scripts**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npm install --save-dev --save-exact @playwright/test@1.56.1
npx playwright install chromium
```

Add to the root `package.json` `scripts`:

```json
    "e2e": "playwright test",
    "e2e:ui": "playwright test --ui"
```

- [ ] **Step 2: Write the configuration and the fixtures**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

/**
 * One path, one browser, desktop only.
 *
 * The dev server is started here; the BACKEND is not. `./dev-up` owns Postgres, the migrator and
 * the two APIs, and a second way to bring them up is a second way for them to differ.
 *
 * Desktop-only is deliberate (convention C5): the portal has no small-screen layout and design
 * section 8.4 records that as scope rather than an omission.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4200',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run start:customer-portal',
    url: 'http://localhost:4200',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

Create `e2e/fixtures/api.ts`:

```ts
import type { APIRequestContext } from '@playwright/test';

/**
 * Reads the six-digit signing code the console-sink email printed.
 *
 * The endpoint exists only in Development (Task 8) and it is a PEEK, not a bypass: the code is
 * still generated, still emailed, still verified and still burns after five wrong attempts. The
 * browser never sees it, which is why the test has to ask the API for it.
 */
export async function peekSignCode(
  request: APIRequestContext,
  applicationId: string,
): Promise<string> {
  const response = await request.get(
    `http://localhost:4200/api/v1/onboarding/applications/${applicationId}/sign-code`,
  );

  if (!response.ok()) {
    throw new Error(
      `The sign-code peek returned ${response.status()}. It exists only when the customer API `
      + 'runs in Development — check that ./dev-up is up.',
    );
  }

  const body = (await response.json()) as { code: string };
  return body.code;
}

/** A fresh address per run: usernames are unique platform-wide and never reused. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}@example.nl`;
}
```

- [ ] **Step 3: Write the failing end-to-end test**

Create `e2e/onboard-and-rename.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

import { peekSignCode, uniqueEmail } from './fixtures/api';

const PASSWORD = 'correct-horse-battery';

test('a prospect onboards, signs in, sees a connection and renames it', async ({ page, request }) => {
  const email = uniqueEmail('e2e.devries');

  // ── Step 1 · the person and the credential ────────────────────────────────
  await page.goto('/onboarding');
  await expect(page.getByText('Step 1 of 10')).toBeVisible();

  await page.locator('#firstName').fill('Peter');
  await page.locator('#lastName').fill('de Vries');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('.terms').click();

  // The application id never appears on the page; the response is where it is.
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/onboarding/applications') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create account' }).click();
  const applicationId = ((await (await created).json()) as { id: string }).id;

  // ── Step 2 · the company ──────────────────────────────────────────────────
  await expect(page.getByText('Step 2 of 10')).toBeVisible();
  await page.locator('#orgName').fill('E2E Koeling B.V.');
  await page.locator('#kvk').fill('24398112');
  await page.getByRole('button', { name: 'Next' }).click();

  // ── Step 3 · the registered address ───────────────────────────────────────
  await expect(page.getByText('Step 3 of 10')).toBeVisible();
  await page.locator('#street').fill('Havenweg');
  await page.locator('#houseNumber').fill('22');
  await page.locator('#postcode').fill('3089 JJ');
  await page.locator('#city').fill('Rotterdam');
  await page.getByRole('button', { name: 'Next' }).click();

  // ── Step 4 · the industry, which is optional and skipped on purpose ───────
  await expect(page.getByText('Step 4 of 10')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  // ── Step 5 · direction and volume ─────────────────────────────────────────
  await expect(page.getByText('Step 5 of 10')).toBeVisible();
  await page.locator('.flow-choices .choice').nth(2).click();
  await page.locator('.volume-choices .choice').nth(3).click();
  await page.getByRole('button', { name: 'Next' }).click();

  // ── Step 6 · the cent ─────────────────────────────────────────────────────
  await expect(page.getByText('Step 6 of 10')).toBeVisible();
  await page.locator('#iban').fill('NL98INGB0002445566');
  await page.locator('#bankAccountHolder').fill('E2E Koeling B.V.');
  await page.locator('#pay-ideal').click();
  await expect(page.getByText('Bank account verified')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  // ── Step 7 · signing authority ────────────────────────────────────────────
  await expect(page.getByText('Step 7 of 10')).toBeVisible();
  await page.locator('.choice').first().click();
  await page.getByRole('button', { name: 'Next' }).click();

  // ── Step 8 · the signatories; signing alone, so the one row is already filled
  await expect(page.getByText('Step 8 of 10')).toBeVisible();
  await page.getByRole('button', { name: 'Submit and send the codes' }).click();

  // ── Step 9 · the signature ────────────────────────────────────────────────
  await expect(page.getByText('Step 9 of 10')).toBeVisible();
  const code = await peekSignCode(request, applicationId);
  await page.locator('#sign-code').fill(code);
  await page.locator('#sign-terms, .terms').first().click();
  await page.getByRole('button', { name: 'Sign the agreement' }).click();

  // ── Step 10 · and into the portal ─────────────────────────────────────────
  await expect(page.getByText('Welcome to PeakPower')).toBeVisible();
  await page.locator('#welcome-cta').click();
  await expect(page).toHaveURL(/\/connections$/);

  // A new company owns nothing, so the rename needs something to act on.
  await expect(page.getByText('You have no connections yet.')).toBeVisible();
  await page.getByRole('link', { name: /Claim a connection/ }).first().click();
  await expect(page).toHaveURL(/\/connections\/claim$/);

  const firstPoolRow = page.locator('.row').first();
  const claimedEan = (await firstPoolRow.locator('.mono').innerText()).trim();
  await firstPoolRow.click();
  await page.getByText('It only consumes').click();
  await page.getByRole('button', { name: 'Claim this connection' }).click();
  await expect(page).toHaveURL(/\/connections\/[0-9a-f-]{36}$/);

  // Unnamed, so the grouped EAN is the label [F01-R31].
  await expect(page.getByRole('heading', { name: claimedEan })).toBeVisible();

  // ── Sign out, and back in with the credential onboarding created ──────────
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.locator('#username').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // ── See the connection, then rename it ────────────────────────────────────
  await page.goto('/connections');
  await expect(page.getByText(claimedEan)).toBeVisible();
  await page.locator('a.row').first().click();

  await page.locator('#name').fill('Rotterdam cold store');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rotterdam cold store' })).toBeVisible();

  // The name replaces the EAN as the primary label, with the EAN kept underneath [F01-R30].
  await page.goto('/connections');
  await expect(page.getByText('Rotterdam cold store')).toBeVisible();
  await expect(page.getByText(claimedEan)).toBeVisible();
});
```

- [ ] **Step 4: Run it against a stopped system and watch it fail honestly**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run e2e`
Expected: FAIL — with `./dev-up` not running, the sign-code peek throws
`The sign-code peek returned 502. It exists only when the customer API runs in Development — check that ./dev-up is up.`
That is the failure message this fixture exists to produce; a bare timeout would send the reader
looking at the wizard.

- [ ] **Step 5: Bring the system up and run it for real**

Run, in one terminal: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && ./dev-up`
Then, in another: `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run e2e`
Expected: PASS — 1 passed

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add package.json package-lock.json playwright.config.ts e2e
git commit -m "test(e2e): onboard, claim, sign in and rename in one Playwright path"
```

---

### Task 29: The specification pull request

Design §10, in one pull request against `peakpowerspecs`, raised **alongside** the first week of
code so the record and the build do not diverge. This is the last task and it is the only one
outside the two build repositories.

Five decisions, six open questions and the corrections. Nothing here is a refactor of the
specification: each edit is either a new row or a change with a named reason, and every reversal
keeps the reversed text visible rather than deleting it — that is the house style already used
for `[DEC-63]`, `[DEC-71]` and every other amended row.

**Files:** *(run from `/Users/thinhhuynh/PeakPower/peakpowerspecs`)*
- Modify: `specs/00-overview/04-assumptions-and-decisions.md`
- Modify: `specs/80-open-questions.md`
- Modify: `specs/20-architecture/04-database-design.md`
- Modify: `specs/20-architecture/02-solution-structure.md`
- Modify: `specs/20-architecture/03-domain-model.md`
- Modify: `specs/20-architecture/05-api-contracts.md`
- Modify: `specs/10-features/F01-customer-and-metering-points.md`
- Modify: `specs/10-features/F13-identity-and-access.md`
- Modify: `specs/20-architecture/07-security.md`
- Modify: `specs/70-delivery/01-roadmap-and-phasing.md`
- Modify: `specs/60-mockups/README.md`
- Modify: `specs/60-mockups/screens-customer.mjs`

**Interfaces:**
- Consumes: nothing — this task changes prose, not code.
- Produces: one pull request against `peakpowerspecs`, covering design §10.

- [ ] **Step 1: Branch**

```bash
cd /Users/thinhhuynh/PeakPower/peakpowerspecs
git checkout main && git pull
git checkout -b specs/poc-slice-1
```

- [ ] **Step 2: Record the five decisions**

In `specs/00-overview/04-assumptions-and-decisions.md`, append five rows immediately after the
`**DEC-112**` row, in the same four-column shape (`Id | Decision | What it rules out | Notes`):

```markdown
| **DEC-113** | **Customer companies may be created by self-service onboarding.** The platform stores an **Argon2id** credential hash for the customer realm and **owns the password-reset path**. Customers may claim metering points from a shared EAN pool | Account creation staying exclusively with PeakPower employees, and the platform holding no customer credential | ⚠ **Reverses [DEC-16], [DEC-29] and [F01-R12]; amends [F01-R23].** Taken for the proof of concept, where the ten-step wizard from `trading-poc` is the demo story. Contained by three things: the hash is Argon2id at OWASP's current floor (19 MiB, 2 iterations, parallelism 1), never logged and never returned by any endpoint; `ICustomerContext` stays the single seam identity reaches the application through, so the credential store is swappable behind one DI registration rather than a rewrite (**[DEC-119]** later made the platform's ownership of identity permanent); and reset is in scope, because a credential store without one is not shippable past a demo. Hard lockout and MFA are **not** in scope — a hard lockout on a username is a denial-of-service primitive against a named customer — so sign-in carries a progressive delay instead |
| **DEC-114** | **EAN validation is eighteen digits only for the proof of concept.** The GS1 check digit is reinstated before go-live | Enforcing the check digit from the first commit | ⚠ **Reverses the check-digit half of [F01-R24].** Not one of the six demo EANs in `trading-poc` carries a correct check digit, under either weighting, so enforcing it would leave the demo with no data at all. **[OQ-97]** owns reinstating it and pinning which weighting is normative, and the seed script carries the reason inline at the point where it inserts them |
| **DEC-115** | **The customer portal's navigation and labels follow the design system. Route keys keep the specification's names** | Labels and route keys being the same string, as the wireframes assume | Amends `specs/60-mockups/screens-customer.mjs:7`. `Consumption` reads **Volume**, `Trading` reads **Trades**, `Wallet` reads **Balance**, and `Invoices` is replaced by **Settlements**. One mapping — `PAGE_LABELS` — sits between the two, so a label change is one line and never touches a URL, a guard or a test. Nav items outside the current slice render disabled, each with the sentence explaining why: a rail that grows between demos looks unfinished, one that is complete and honest looks planned |
| **DEC-116** | **GitHub Packages is the destination for generated API clients.** The organisation exists as **`peakpower-nl`** since 2026-08-27 (`[OQ-100]` resolved) and the scope was renamed to `@peakpower-nl/` to match, since GitHub Packages requires it; publishing is still out of scope for slice 1, so committed npm **workspace packages** — the fallback [solution structure §5.1](../20-architecture/02-solution-structure.md) already sanctions — keep the name `@peakpower-nl/api-client-*` | Choosing a feed now, and picking a package name that matches whatever owner happens to exist today | Settles the unnumbered feed question in [solution structure §8](../20-architecture/02-solution-structure.md). npm workspaces resolve by the `name` field, not by registry scope, so every import works today with no registry and keeps working unchanged the day the packages are published. A scripted **staleness check** — regenerate, fail if the diff is non-empty — replaces what the registry would have protected against; without it, committed clients rot silently and the two repositories drift exactly as **[DEC-55]** warns. See **[OQ-100]** |
| **DEC-117** | **Customer authentication is a JWT access/refresh pair, ES256 over JWKS, with a `security_stamp` claim checked per request** | A shared-secret HS256 token, and accepting that a stateless token cannot be revoked before it expires | New ground: **[DEC-20]** assumed the proof of concept would run unauthenticated. Access token 15 minutes; refresh token 14 days, rotating, single-use, stored hashed, in an HttpOnly `SameSite=Strict` cookie scoped to the refresh endpoint. The access token is held **in memory only** in the browser — a JWT in `localStorage` is readable by any XSS. ES256 over a JWKS endpoint rather than a shared secret so the signing key never leaves the issuer and keys can rotate without redeploying verifiers (**[DEC-119]** removed the Entra migration this originally anticipated). The `stamp` claim is compared to a `security_stamp` column on every request, which costs nothing measurable — every request already opens a transaction to `SET LOCAL app.customer_id` for row-level security — and it is what makes **[F01-R16]**'s *immediate* revocation literally true against a stateless token |
```

- [ ] **Step 3: Register the six open questions**

In `specs/80-open-questions.md`, add six rows to the open register:

```markdown
| **[OQ-97]** | 🟠 | **When is the GS1 check digit reinstated, and which weighting is normative?** **[DEC-114]** relaxed EAN validation to eighteen digits for the proof of concept. The two conventions in circulation disagree on five of the six demo EANs, and the specification says "GS1 check digit" without pinning the algorithm — so this needs an owner and a date, not just an intention | Needs an owner |
| **[OQ-98]** | 🟡 | **Credential policy values** — the sign-in delay curve, the reset-token TTL, and password composition beyond the twelve-character minimum. The *mechanism* is designed and is no longer open (**[DEC-117]**, and the reset path in **[DEC-113]**); only the numbers are, and they belong to whoever owns security policy rather than to the delivery team | Needs an owner |
| **[OQ-99]** | 🟡 | **The six-product entitlement gate in the prototype's rail.** `trading-poc` gates parts of the customer rail on a per-product entitlement. That is a commercial model which appears nowhere in this specification set: either it is real and F13 needs it, or the prototype invented it and the rail should not imply it | Needs an owner |
| **[OQ-100]** | ✅ | **Which GitHub organisation owns `peakpower-platform` and `peakpower-web`?** **RESOLVED 2026-08-27: `peakpower-nl`.** Both repositories are published there, privately, and pushed. Not `peakpower`, which the `@peakpower/` scope had assumed — renamed to `@peakpower-nl/` across the specification while that was still free. |
| **[OQ-102]** | 🟠 | **Who owns the row-level-security login-role credentials?** Migration 2 creates `app_customer_role` and `app_employee_role` plus two non-owner login roles, and each host rewrites its connection string onto its own role — a superuser or table owner *bypasses* RLS silently, so this is what makes the mechanism real rather than decorative. Slice 1 is local-only with no deployment, so the two passwords are literals in the migration with a comment saying exactly that. **This needs an owner before anything is deployed anywhere** | Needs an owner |
```

- [ ] **Step 4: Declare the two PostgreSQL extensions**

In `specs/20-architecture/04-database-design.md`, insert a new section between the opening line
(`PostgreSQL 17. One database, schema-per-module, …`) and `## 1. Schemas`:

````markdown
## 0. Extensions

Migration 1 **begins** with these two statements, before any schema or table:

```sql
CREATE EXTENSION IF NOT EXISTS citext;      -- username, email
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- equality inside a GiST exclusion constraint
```

The DDL throughout this document needs both and declared neither. `citext` is what makes
`username` and `email` case-insensitive without a functional index on every lookup;
`btree_gist` is what lets `ean WITH =` sit inside the same exclusion constraint as
`validity WITH &&`. Without them migration 1 fails on its first table, which is a cheap failure
and an entirely avoidable one.
````

In the same file, §1, remove the trailing `, labels` from the `customer` schema row — the friendly
name is `name` and `description` on `metering_point`, per the change in Step 8:

```markdown
| `customer` | customer companies, **accounts**, **bank accounts [DEC-71]**, **approval requests [DEC-71]**, metering points |
```

- [ ] **Step 5: Fix the AppHost snippet**

In `specs/20-architecture/02-solution-structure.md` §4, replace the three `AddNpmApp` calls
(currently at lines 300, 305 and 310) with:

```csharp
    builder.AddJavaScriptApp("customer-portal", webRoot, "start:customer-portal")
        .WithReference(customerApi)
        .WithHttpEndpoint(env: "PORT")
        .WithExternalHttpEndpoints();

    builder.AddJavaScriptApp("employee-portal", webRoot, "start:employee-portal")
        .WithReference(employeeApi)
        .WithHttpEndpoint(env: "PORT")
        .WithExternalHttpEndpoints();
```

and add this note immediately after the snippet:

```markdown
> ⚠ **Amended 2026-08-26, verified against Aspire 13.5.3.** Three things were wrong and one line
> fixes two of them.
>
> 1. **`AddNpmApp` no longer exists.** `Aspire.Hosting.NodeJs` is frozen at 9.5.2; the current
>    package is `Aspire.Hosting.JavaScript`, which exposes `AddJavaScriptApp`, `AddNodeApp` and
>    `AddViteApp`. The signature is
>    `AddJavaScriptApp(string name, string appDirectory, string runScriptName = "dev")`.
> 2. **The directory was wrong.** The workspace declares exactly **one** `package.json`, at the
>    root, so there is no script to run inside `apps/<name>`. The call passes the workspace root
>    and a per-app script name instead — which is why `package.json` defines
>    `start:customer-portal` and `start:employee-portal` at the root rather than `start` in each
>    app.
> 3. **`public-site` is not built in slice 1** and its resource is dropped until it is.
>
> **Aspire is also no longer a `dotnet workload`.** It is the `aspire.cli` global tool plus the
> `Aspire.AppHost.Sdk` NuGet package, currently **13.5.3**. Install with
> `dotnet tool install -g aspire.cli`.
```

Then make the backend-only path real. The `else` branch promises a `--backend-only` flag that
nothing implements, so replace the `throw` with a gate on an actual check:

```csharp
else if (args.Contains("--backend-only"))
{
    // Backend-only is a legitimate mode; SILENTLY backend-only is not. Saying it out loud is
    // the whole point of the branch.
    builder.Configuration["PeakPower:FrontEnds"] = "disabled";
}
else
{
    throw new InvalidOperationException(
        $"peakpower-web not found at '{webRoot}'. Clone it beside this repository, set " +
        "PEAKPOWER_WEB_PATH, or run with --backend-only.");
}
```

- [ ] **Step 6: Correct the project list and pin the assertion library**

Two more corrections in `specs/20-architecture/02-solution-structure.md`.

§1.1 lists thirteen projects. Four infrastructure projects the architecture needs are missing
from that list, and one of them is named by architecture fact 5 — so replace the
`src/Infrastructure/` line with all five and reconcile where `dev-up` lives:

```markdown
| `src/Hosts/` | `AppHost` · `ServiceDefaults` · `Api.Customer` · `Api.Employee` · `Migrator` |
| `src/Core/` | `Domain` · `Application` · `Contracts` |
| `src/Infrastructure/` | `Persistence` · `Time` · `Web` · `Identity` · `Email` |
| `tests/` | `Domain.Tests` · `Application.Tests` · `Integration.Tests` · `Architecture.Tests` |

> ⚠ **Amended 2026-08-26.** Eleven source projects and four test projects, not thirteen in
> total. `Infrastructure.Time` is required by name by architecture fact 5 — the fact is "no type
> **outside `PeakPower.Infrastructure.Time`**", which cannot be written without the project.
> `Infrastructure.Web` is the one context-provider assembly architecture fact 6 allow-lists, and
> `Infrastructure.Identity` and `Infrastructure.Email` hold the `IPasswordHasher`, `ITokenIssuer`
> and `IEmailSender` adapters, which have no business inside the persistence project.
> `dev-up` lives at the repository root of `peakpower-platform`, not under `src/`.
```

§6's testing table names FluentAssertions, which the platform does not use. Replace it, with the reason:

```markdown
| Domain / Application unit | xUnit + **Shouldly 4.3.0**|

> ⚠ **Pin Shouldly 4.3.0. 8.x may not be used** (added 2026-08-26). 8.10.0 ships an
> **Xceed Software Community License Agreement, "for Non-Commercial Use"**, where
> non-commercial means use whose primary objective is not commercial advantage. PeakPower is a
> commercial trading platform, so 8.x would need a paid Xceed licence, and 7.2.0 — the last
> `Apache-2.0` release — is the end of that line. **Shouldly 4.3.0 is Apache-2.0 and actively
> maintained**, so it replaces the library outright rather than pinning a frozen branch
> **[DEC-118]**. The table was written when FluentAssertions was still open source.
```

- [ ] **Step 7: Say that row-level security needs database roles**

In `specs/20-architecture/07-security.md` §2, add after the row-level-security policy discussion:

```markdown
> ⚠ **Row-level security needs database roles, and this document never mentions them** (added
> 2026-08-26). A superuser or a table owner **bypasses** RLS silently: with the APIs on the
> default connection, every policy in this section is inert while every test still passes —
> the most expensive kind of green. Migration 2 therefore creates `app_customer_role` and
> `app_employee_role`, plus two non-owner **login** roles, and each host rewrites its
> connection string onto its own role. The Migrator keeps the owner connection, because it
> must be able to create and alter the tables the policies sit on.
>
> Slice 1 is local-only with no deployment, so the two login passwords are literals in the
> migration with a comment saying exactly that. **[OQ-102]** owns them before anything is
> deployed anywhere.
```

- [ ] **Step 8: Correct the domain model and the friendly name**

In `specs/20-architecture/03-domain-model.md`, line 359, replace:

```csharp
public enum ProductionExpectation { Unknown = 0, Expected = 1, NotExpected = 2 }
```

with:

```csharp
// The database spelling is normative: NEVER, not NOT_EXPECTED. Corrected 2026-08-26.
public enum ProductionExpectation { Unknown = 0, Expected = 1, Never = 2 }
```

At line 306, extend the `AccountStatus` comment to carry all four values:

```csharp
    public AccountStatus Status { get; private set; }   // PendingApproval | Invited | Active | Deactivated
```

At line 404, extend `FourEyesAction` to the five arms the database defines:

```csharp
    public FourEyesAction Action { get; }        // AddBankAccount | DeactivateBankAccount
                                                 // | AddUser | Trade | Withdrawal
```

In `specs/10-features/F01-customer-and-metering-points.md`, delete the `metering_point_label` row
at line 385 and add a sentence under the table:

```markdown
The friendly name is `name` and `description` **on `metering_point`**, which is what
`[F01-R29]`'s ≤80 and ≤500 limits actually describe. The separate `metering_point_label` table
and the domain model's `Label` property were two further spellings of the same thing; both are
deleted in favour of the physical schema.
```

In `specs/20-architecture/05-api-contracts.md`, line 129:

```markdown
| `PATCH` | `/metering-points/{id}/naming` | Set friendly name and description |
```

Add, under that table:

```markdown
> Renamed from `/label` on 2026-08-26, following the friendly name settling as `name` +
> `description` columns. The route has no consumers yet, so renaming is free now and awkward
> later.
```

- [ ] **Step 9: Harden F13's business rule 2, and reconcile the roadmap**

In `specs/10-features/F13-identity-and-access.md` §3, replace business rule 2 with:

```markdown
2. **`customer_id` comes from the token, always.** Any code path that reads a customer identifier
   from a route, query string, body or header for authorisation purposes is a defect. ⚠ **This is
   an architecture test, not advice** (added 2026-08-26): *no type outside the context-provider
   assembly reads a customer identifier from `HttpContext`.* It runs from week one alongside the
   other five facts, because the slice that builds the tenancy pipeline is precisely the slice
   where taking the shortcut is tempting.
```

In `specs/70-delivery/01-roadmap-and-phasing.md`, the §2.1 note at line ~256 says "five of the
six rows" and the later passage at line ~796 says "four of the six". Reconcile them: keep the
later count and make the earlier one point at it.

```markdown
⚠ **Two rows were added on 2026-08-19 and the table is now the plan's real critical path.** **Four
of the six** rows are needed before phase 2 ends — see the 2026-08-19 round below, which is the
count that governs. (An earlier draft of this note said five; the round that added the two rows
also moved one out of phase 2.)
```

- [ ] **Step 10: Record where labels and route keys come from**

In `specs/60-mockups/README.md`, under `## Design decisions worth noting`, add:

```markdown
- **Labels come from the design system; route keys come from the specifications.** `[DEC-115]`.
  The wireframes here name the customer rail
  `Dashboard · Connections · Consumption · Prices · Trading · Wallet · Invoices`. The built
  portal reads `Dashboard · Connections · Volume · Prices · Trades · Balance · Settlements`, over
  the same route keys. When a mockup and the portal disagree about a **word**, the portal is
  right; when they disagree about a **URL**, the mockup is.
```

In `specs/60-mockups/screens-customer.mjs`, line 7, replace the `NAV` array and record why:

```js
// Labels follow the design system, route keys follow the specifications [DEC-115]. The built
// portal maps between them in PAGE_LABELS; this array is the label half.
const NAV = ['Dashboard', 'Connections', 'Volume', 'Prices', 'Trades', 'Balance', 'Settlements'];
```

Add `Company` to the customer rail as well — the design's §8.3 carries a "Company profile +
accounts" screen `[F01-R09]` `[F01-R21]` that these wireframes never had a row for:

```js
const NAV = ['Dashboard', 'Connections', 'Volume', 'Prices', 'Trades', 'Balance', 'Settlements', 'Company'];
```

- [ ] **Step 11: Regenerate the mockups and check the diff**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpowerspecs/specs/60-mockups
node generate.mjs
git diff --stat
```

Expected: every customer SVG changes only in its rail labels. If anything else moved, the `NAV`
edit caught more than it should have.

Note in the pull request body that `employee-customer-admin.svg` is **stale for a different
reason** — it predates `[DEC-71]` and still shows editable bank details with an Edit button, no
admin flag and no four-eyes toggle — and that regenerating it needs the requirements read first,
so it is left for a follow-up rather than half-fixed here.

- [ ] **Step 12: Commit and open the pull request**

```bash
cd /Users/thinhhuynh/PeakPower/peakpowerspecs
git add specs
git commit -m "Record DEC-113..117 and OQ-97..102, and correct eleven documents for PoC slice 1"
git push -u origin specs/poc-slice-1
gh pr create \
  --title "PoC slice 1: five decisions, six open questions, eleven corrections" \
  --body "$(cat <<'BODY'
Raised alongside the first week of slice-1 code, so the record and the build do not diverge.
Everything here is design section 10 of `docs/superpowers/specs/2026-08-26-poc-slice-1-design.md`.

## New decisions

- **[DEC-113]** self-service onboarding; the platform holds an Argon2id credential hash and owns
  password reset; customers claim EANs from a shared pool. Reverses [DEC-16], [DEC-29], [F01-R12];
  amends [F01-R23].
- **[DEC-114]** EAN validation is 18 digits for the PoC. Reverses the check-digit half of [F01-R24].
- **[DEC-115]** portal labels follow the design system; route keys keep the specification's names.
- **[DEC-116]** GitHub Packages; the organisation exists as `peakpower-nl` and the scope now matches, publishing still out of scope; committed workspace
  packages until then.
- **[DEC-117]** customer auth is a JWT access/refresh pair, ES256 over JWKS, with a
  `security_stamp` claim checked per request.

## New open questions

**[OQ-97]** when the GS1 check digit returns and under which weighting · **[OQ-98]** credential
policy *values* (the mechanism is no longer open) · **[OQ-99]** the prototype's six-product
entitlement gate · **[OQ-100]** which GitHub organisation owns the two repositories — not blocking ·
**[OQ-102]** who owns the row-level-security login-role credentials before anything is deployed.

## Corrections

1. Database design gains a §0 declaring `citext` and `btree_gist` as migration 1's first
   statements — the DDL needs both and declared neither.
2. Solution structure §4: `AddNpmApp` → `AddJavaScriptApp` against the workspace root with a
   per-app script; the `--backend-only` gate is made real; Aspire is a CLI + SDK at 13.5.3, not a
   `dotnet workload`.
3. Domain model: `NotExpected` → `Never`; `AccountStatus` gains `PendingApproval`;
   `FourEyesAction` gains `Trade`. The database spelling is normative in all three.
4. F01 §6: `metering_point_label` deleted; the friendly name is `name` + `description` on
   `metering_point`. The "labels" mention in database design §1 goes with it.
5. API contracts: `PATCH /metering-points/{id}/label` → `/naming`. No consumers yet, so it is
   free now and awkward later.
6. F13 business rule 2 becomes an architecture test rather than advice.
7. Roadmap §2.1: "five of the six" reconciled against "four of the six".
8. Mockups README records that labels come from the design system and route keys from the
   specifications; `screens-customer.mjs` updated and the SVGs regenerated.
9. Solution structure §1.1: the four implied infrastructure projects — `Time`, `Web`,
   `Identity`, `Email` — are added, making eleven source projects and four test projects rather
   than thirteen in total, and `dev-up`'s location is reconciled.
10. Solution structure §6: **assertions use Shouldly 4.3.0, not FluentAssertions** `[DEC-118]`.
    FluentAssertions 8.x ships an Xceed Community License for non-commercial use only, which a
    commercial trading platform cannot take, and 7.2.0 is the last Apache-2.0 release and the
    end of that line. Shouldly is Apache-2.0 and actively maintained.
11. Security §2: row-level security needs database **roles**, which the document never
    mentioned. A superuser or table owner bypasses RLS silently, so without them every policy is
    inert while every test stays green.

## Deliberately not done here

`employee-customer-admin.svg` is stale for a different reason — it predates [DEC-71] and still
shows editable bank details with an Edit button, no admin flag and no four-eyes toggle.
Regenerating it needs the current requirements read first, so it is a follow-up rather than a
half-fix in this diff.

[DEC-20]'s instruction that tenancy be built and tested from the first commit is **honoured, not
superseded**: real sign-in exercises the same pipeline more strongly than a dev switcher would,
and the dev context provider is still built for the identity slice.
BODY
)"
```

Expected: the pull request URL is printed. Paste it into the slice-1 definition of done, item 11.

---

## Definition of done

The design's own eleven points, reproduced in full. This plan is finished when every one of them
holds — not when the last task's tests pass.

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

Points 1, 4, 6, 7 and 9 are earned by plans 1, 2, 4 and 5 and are **verified**, not built,
here: run the full suite in both repositories before calling the slice done. Point 5 is
half-and-half — plan 2 built the harness, and Task 10 is what finally points it at the customer
host, the one place tenancy is real.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm test && npm run verify:clients && npm run e2e
```

---

## New names introduced

Every name this plan introduces that the shared contract does not define, with its exact
signature. Names introduced by Tasks 1–9 and 11–16 are listed in that half of the plan; this
section covers Task 10 and Tasks 17–29.

### `apps/customer-portal/src/app/onboarding/onboarding-flow.ts` (Task 17)

```ts
export interface OnboardingStep {
  readonly n: number; readonly group: string; readonly label: string;
  readonly title: string; readonly intro: string; readonly next?: string;
}
export interface SignatoryDraft { first: string; last: string; email: string; locked: boolean }
export interface OnboardingFields {
  firstName: string; lastName: string; email: string; password: string;
  orgName: string; kvk: string;
  street: string; houseNumber: string; houseNumberSuffix: string; postcode: string; city: string;
  iban: string; bankAccountHolder: string;
}
export interface OnboardingState {
  readonly step: number; readonly agreed: boolean; readonly bankVerified: boolean;
  readonly entityIndex: number; readonly industryIndex: number; readonly flowIndex: number;
  readonly volumeIndex: number; readonly authorityIndex: number;
  readonly signCode: string; readonly agreedDocs: boolean;
  readonly f: OnboardingFields; readonly signatories: readonly SignatoryDraft[];
  readonly applicationId: string | null; readonly reference: string | null;
  readonly username: string | null;
}

export const STEPS: readonly OnboardingStep[];
export const LAST_STEP: number;                       // 10
export const ENTITY_TYPES: readonly { readonly label: string; readonly wire: string }[];
export const INDUSTRIES: readonly string[];           // 25, "Not specified" first
export const FLOWS: readonly { readonly label: string; readonly wire: string }[];
export const VOLUMES: readonly {
  readonly label: string; readonly short: string; readonly wire: string }[];
export const AUTHORITY: readonly {
  readonly label: string; readonly note: string; readonly wire: string }[];
export const MIN_PASSWORD: number;                    // 12
export const KVK_DIGITS: number;                      // 8
export const SIGN_CODE_DIGITS: number;                // 6
export const SUPPORT_EMAIL: string;                   // support@peakpower.nl

export function blankSignatory(): SignatoryDraft;
export function defaultState(): OnboardingState;
export function kvkDigits(value: string): string;
export function looksLikeEmail(value: string): boolean;
export function codeDigits(value: string): string;
export function signatoryComplete(s: SignatoryDraft): boolean;
export function minSignatories(authorityIndex: number): number;
export function signatoriesForAuthority(authorityIndex: number, f: OnboardingFields): SignatoryDraft[];
export function fullName(f: OnboardingFields): string;
export function stepValid(state: OnboardingState): boolean;
export function hint(state: OnboardingState): string;
export function stepTitle(state: OnboardingState): string;
export function stepIntro(state: OnboardingState): string;
export function clampStep(n: number): number;
export function summaryRows(state: OnboardingState): readonly { k: string; v: string }[];
export function withField(state: OnboardingState, key: keyof OnboardingFields, value: string): OnboardingState;
export function inputValue(event: Event): string;
export function saveStepRequest(state: OnboardingState, step: number): SaveOnboardingStepRequest;
```

> ⚠ **There is deliberately no `SIGN_CODE`.** `trading-poc/onboarding-flow.js` exports one; it is
> a demo affordance in a flow that submits nothing. Here the code is generated per application by
> plan 5's backend, hashed at rest and emailed through `IEmailSender`, and tests read it through
> the Development-only peek endpoint from Task 8. A constant in the bundle would be a credential.

> ⚠ **The wire spelling of the onboarding enums is the C# member name, not SCREAMING_SNAKE**, and
> `Coöperatie` loses its diaeresis on the wire (`"Cooperatie"`) because a C# identifier cannot
> carry one. Every other enum in this system is SCREAMING_SNAKE on the wire, so this is the one
> place a reader will guess wrong.

### Angular components (Tasks 17–26)

```ts
// apps/customer-portal/src/app/onboarding/
export class OnboardingWizard {}      // selector 'pp-onboarding-wizard'
  readonly state: WritableSignal<OnboardingState>;
  readonly busy: Signal<boolean>; readonly summary: Signal<string | null>;
  readonly step: Signal<number>; readonly current: Signal<OnboardingStep>;
  readonly title: Signal<string>; readonly intro: Signal<string>; readonly hint: Signal<string>;
  readonly nextLabel: Signal<string>; readonly canContinue: Signal<boolean>;
  readonly progress: Signal<number>; readonly reference: Signal<string>;
  readonly destination: Signal<string>;               // '/connections' or '/sign-in'
  goto(n: number): void; back(): void; next(): void; verifyBank(): void;

// onboarding/steps/step-account.ts
export class StepAccount {}           // 'pp-step-account'; state = model.required<OnboardingState>()
                                      // passwordNote(): string; toggleTerms(): void
// onboarding/steps/step-company.ts
export class StepCompany {}           // 'pp-step-company'
export class StepAddress {}           // 'pp-step-address';  lookupLine(): string
export class StepIndustry {}          // 'pp-step-industry'
// onboarding/steps/step-volume.ts
export class StepVolume {}            // 'pp-step-volume';    volumeSubtitle(): string
// onboarding/steps/step-bank.ts
export class StepBank {}              // 'pp-step-bank';      verify = output<void>()
// onboarding/steps/step-authority.ts
export class StepAuthority {}         // 'pp-step-authority'; pick(index: number): void
export class StepSignatories {}       // 'pp-step-signatories'; add(); remove(i); canRemove(i);
                                      //   countLine(); greeting(); applicant(); org()
// onboarding/steps/step-sign.ts
export class StepSign {}              // 'pp-step-sign';      toggleAgreedDocs(): void
export class StepWelcome {}           // 'pp-step-welcome';   destination = input.required<string>()

// features/connections/
export const CONNECTION_ROUTES: Routes;
export class ConnectionListPage {}    // 'pp-connection-list-page'; search = signal<string>('')
export class ConnectionDetailPage {}  // 'pp-connection-detail-page'
export const NAME_MAX_LENGTH: 80;
export const DESCRIPTION_MAX_LENGTH: 500;
export class ClaimConnectionPage {}   // 'pp-claim-connection-page'

// features/company/
export class CompanyPage {}           // 'pp-company-page'
```

### `apps/customer-portal/src/app/shared/labels.ts` (Task 23)

```ts
export const NO_DATA_YET: string;
export function connectionStatusLabel(value: ConnectionStatusValue): string;
export function connectionStatusTone(value: ConnectionStatusValue): PpTone;
export function productionExpectationLabel(value: ProductionExpectationValue): string;
export function accountStatusLabel(value: AccountStatusValue): string;
export function accountStatusTone(value: AccountStatusValue): PpTone;
export function customerStatusLabel(value: CustomerStatusValue): string;
```

### `peakpower-platform` (Task 27)

```csharp
namespace PeakPower.Persistence.Seeding;

public sealed class DemoDataSeeder(
    PeakPowerDbContext db, IPasswordHasher hasher, IMarketCalendar calendar)
{
    public const string DemoPassword = "correct-horse-battery";
    public Task<int> SeedAsync(CancellationToken ct);   // returns companies created; 0 if already seeded
}
```

The seeder introduces no domain members of its own. Every factory and mutator it calls —
`Brp.Create`, `Customer.Create`, `Customer.ChangeStatus`, `CustomerAccount.Create`,
`CustomerAccount.SetPassword`, `MeteringPoint.Attach` and `MeteringPoint.EndDate` — is declared
by plan 1 under shared contract §5.1, and this plan only calls them.

### `peakpower-platform` tenancy harness (Task 10)

```csharp
namespace PeakPower.Integration.Tests.Tenancy;

public static class CustomerSampleBodies
{ public static IReadOnlyDictionary<string, string> All { get; } }
public sealed class CustomerApiRouteTableTests;
```

`RouteTable`, `RouteTableEntry`, `TenancyScope`, `TenancyProbeApp` and `TenancyFixture` are
plan 2's; this plan only points them at the customer host and fills `SampleBodies`.

### `peakpower-web` E2E (Task 28)

```ts
// e2e/fixtures/api.ts
export async function peekSignCode(
  request: APIRequestContext, applicationId: string): Promise<string>;
export function uniqueEmail(prefix: string): string;
```

npm scripts added at the workspace root: `e2e`, `e2e:ui`.
Dev dependency added: `@playwright/test@1.56.1` (exact).
