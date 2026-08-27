# Tenancy & Employee API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the multi-tenancy machinery — context ports, EF Core global query filters,
PostgreSQL row-level security, 404-not-403 and the route-table test that proves all of it — and
the back-office `PeakPower.Api.Employee` HTTP surface that sits on top of it.

**Architecture:** Identity reaches the application through exactly one seam, `ICustomerContext`;
in this plan it is satisfied by a development provider that reads an HTTP header, and a startup
guard refuses to boot if that provider is present in Production. Every customer-owned entity
carries an EF Core global query filter, and every customer-owned *table* additionally carries a
PostgreSQL row-level-security policy keyed on a `SET LOCAL app.customer_id` issued per request
inside the request's transaction — the filter is correctness by default, RLS is the backstop that
still holds when the filter is bypassed. On top of that sits the employee API, which is
deliberately **not** tenant-scoped, and a route-table-driven integration test that forces every
registered endpoint to declare whether it is tenant-scoped or back-office and then proves the
tenant-scoped ones return an indistinguishable 404 for another company's objects.

**Tech Stack:** .NET SDK 10.0.400 · EF Core 10 · Npgsql.EntityFrameworkCore.PostgreSQL 10.0.0 ·
PostgreSQL 17 · ASP.NET Core Minimal APIs · FluentValidation 12.0.0 · Microsoft.Extensions.
ApiDescription.Server 10.0.0 · xUnit + Shouldly 4.3.0 · NSubstitute ·
Testcontainers.PostgreSql 4.14.0 · Microsoft.AspNetCore.Mvc.Testing 10.0.0 · Microsoft.AspNetCore.TestHost 10.0.0 ·
NetArchTest.Rules 1.3.2 · Mono.Cecil 0.11.6 · Verify.Xunit 30.15.0 · Aspire 13.5.3

**Spec:** `docs/superpowers/specs/2026-08-26-poc-slice-1-design.md`
**Shared contract:** `docs/superpowers/plans/2026-08-26-slice-1-shared-contract.md`

**Repository:** every path in this plan is relative to
`/Users/thinhhuynh/PeakPower/peakpower-platform`. Nothing in this plan touches
`peakpower-web`.

---

## Global Constraints

Copied verbatim from the shared contract. Every task in this plan implicitly includes this
section.

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

Package versions that the shared contract does not fix are pinned centrally in
`Directory.Packages.props`. The values named in this plan were the current releases on
2026-08-26; if `dotnet restore` reports that a version does not exist, pin the newest version
that restores, record it in `Directory.Packages.props`, and carry on — never leave a floating
version.

### Naming

- .NET namespace root `PeakPower.` — e.g. `PeakPower.Domain.Customers`
- npm scope `@peakpower/` — kept even though no such GitHub org exists yet `[OQ-100]`
- Database: snake_case, singular, schema-qualified — `customer.metering_point`
- C#: PascalCase; EF Core maps to snake_case via a naming convention, not per-property attributes

### Enums — the database spelling is normative

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

### Module rules — the architecture facts that must exist from week 1

1. `PeakPower.Domain` references no other project
2. `PeakPower.Application` references only `PeakPower.Domain`
3. `PeakPower.Ingestion` (when it exists) references no `Brp.*` adapter
4. No type calls `IgnoreQueryFilters()`
5. No type outside `PeakPower.Infrastructure.Time` uses `DateTime.Now` / `DateTime.UtcNow`
6. No type outside `PeakPower.Infrastructure.Web` uses `IHttpContextAccessor`, or reads a claim
   off `ClaimsPrincipal` / `ClaimsIdentity`

Facts 1, 2, 3 and 5 are Plan 1's. Facts **4 and 6 are this plan's** (Tasks 7 and 8) because
neither can be written before the query filters and the context-provider assembly exist. If Plan
1 already wrote a stub for 4 or 6, replace it with the version here rather than adding a second.

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

`uuid` primary keys via `gen_random_uuid()`. Money `numeric(18,6)`. Timestamps `timestamptz`.

### Copy rules

Sentence case everywhere. **No emoji, no icon set.** nl-NL numbers: `€ 19.722,00`, `385,4 MWh`,
minus is U+2212 `−`. (This plan emits JSON, not prose, but problem-detail `title` and `detail`
strings follow the same sentence-case rule.)

### Testing tooling

| Layer | Tooling |
| --- | --- |
| Domain / Application unit | xUnit + **Shouldly 4.3.0**|
| Persistence & integration | Testcontainers, real PostgreSQL 17 |
| Architecture | NetArchTest |
| OpenAPI contract | Verify snapshot |
| Frontend unit | Vitest |
| E2E | Playwright, in `peakpower-web` |

> ⚠ **Assert with Shouldly, never FluentAssertions** `[DEC-118]`. FluentAssertions 8.x ships an
> Xceed Community License "for Non-Commercial Use" and PeakPower is commercial; 7.2.0 is the
> last Apache-2.0 release and the end of that line. Shouldly 4.3.0 is Apache-2.0 and maintained.
> `verify-build-settings.sh` fails the build if FluentAssertions reappears.

---

## What this plan deliberately does not do

**The employee API is not tenant-scoped.** Back-office staff at PeakPower administer every
customer; an employee who could only see one company would be unable to do their job. So the
employee host registers `UnscopedCustomerContext` (Task 1), whose `IsAuthenticated` is `false`,
which makes every global query filter a no-op, and it connects to PostgreSQL as
`peakpower_employee`, a role holding an explicit "see everything" RLS policy (Task 4). **Do not
"fix" this by scoping the employee API to a tenant.** The filters and the RLS policies are built
in this plan anyway, because the entities and the `DbContext` are shared with the customer API
that Plan 5 will add, and because the route-table test needs the machinery to exist before it can
test it.

**There is no customer API host in this plan.** Plan 5 creates `PeakPower.Api.Customer` together
with JWT sign-in and the token-backed `ICustomerContext`; Plan 6 fills out its endpoints. To give
the route-table test a real positive arm today, Task 9 builds a *test-only* host,
`TenancyProbeApp`, inside `PeakPower.Integration.Tests`. It composes the **real** DbContext, the
**real** query filters, the **real** RLS middleware, the **real** development context provider and
the **real** 404 mapper, and maps four tenant-scoped endpoints over them. When Plan 5 creates the
customer host it adds one more test class that reuses the same harness — nothing in Task 9 needs
rewriting.

**No JWT, no sign-in, no onboarding.** In this plan the customer identity comes from the
development header provider only.

**No audit records are written, and that is a deferral rather than an oversight.** Migration 1
creates `audit.audit_record` — append-only, actor plus before-and-after image `[F01-R06]` — and
Plan 1 hands it forward expecting this plan's employee edits to land in it. They do not. The
mutating endpoints in Tasks 11–14 change customers, accounts and metering points without writing
an audit row, and no other slice-1 plan writes one either. Everything a writer would need already
exists — the table, the `audit` schema grant in migration 2, and the acting employee's identity on
`IEmployeeContext.EmployeeId` — so this is a self-contained follow-up, not a redesign. Do not read
the empty table as evidence that auditing was considered and rejected: `[F01-R06]` is still owed.

---

## Domain terms, for an engineer new to Dutch energy retail

| Term | Meaning |
| --- | --- |
| **EAN** | The 18-digit code that identifies one physical electricity connection in the Dutch grid. It is the primary key customers actually talk about. In slice 1 it is validated on length only (`[DEC-114]`); the GS1 check digit comes back before go-live. |
| **Metering point / connection** | One EAN belonging to one customer for a period of time. The same EAN can serve different customers over non-overlapping periods, which is why the database carries a `daterange` exclusion constraint rather than a unique index. |
| **BRP** | *Balance Responsible Party*. The party legally answerable to the Dutch grid operator for the imbalance on a connection. Every metering point must name one (`[F01-R51]`). In slice 1 it is reference data with one seeded row, PVNed. |
| **KvK number** | The 8-digit Dutch Chamber of Commerce company registration number. |
| **Tenant / customer** | A customer company. "Tenancy" here means one company must never see another company's rows. |
| **Back office / employee portal** | PeakPower's own staff tools. Not tenant-scoped. |

---

## File Structure

### Created by this plan

| File | Responsibility |
| --- | --- |
| `src/Core/PeakPower.Application/Abstractions/ICustomerContext.cs` | The tenancy seam. One interface, four members. |
| `src/Core/PeakPower.Application/Abstractions/IEmployeeContext.cs` | The back-office identity seam. |
| `src/Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj` | **The context-provider assembly.** The only assembly permitted to read a customer identifier from `HttpContext` (architecture fact 6). |
| `…/PeakPower.Infrastructure.Web/Tenancy/DevelopmentCustomerContext.cs` | Header-driven `ICustomerContext`. Registered outside Production only. |
| `…/PeakPower.Infrastructure.Web/Tenancy/UnscopedCustomerContext.cs` | `ICustomerContext` that is never authenticated — the back office's registration. |
| `…/PeakPower.Infrastructure.Web/Tenancy/HeaderEmployeeContext.cs` | Header-driven `IEmployeeContext`. Registered outside Production only. |
| `…/PeakPower.Infrastructure.Web/Tenancy/TenancyStartupGuard.cs` | Refuses to boot when a development provider is registered in Production `[F13-R31]`. |
| `…/PeakPower.Infrastructure.Web/Tenancy/TenancyClassification.cs` | Endpoint metadata: every endpoint declares tenant-scoped or back-office. |
| `…/PeakPower.Infrastructure.Web/Tenancy/TenantScopeMiddleware.cs` | Opens the request transaction and issues `set_config('app.customer_id', …, true)`. |
| `…/PeakPower.Infrastructure.Web/Tenancy/AppRoleConnectionString.cs` | Rewrites the Aspire connection string onto a non-owner login role. |
| `…/PeakPower.Infrastructure.Web/Http/ApiResults.cs` | The result-to-HTTP mapping. Has no 403 member, and its 404 body carries no discriminator. |
| `…/PeakPower.Infrastructure.Web/Http/ValidationFilter.cs` | FluentValidation at the boundary, emitting RFC 7807 validation problems. |
| `…/PeakPower.Infrastructure.Web/Http/EnumWireFormat.cs` | The one enum wire spelling both APIs use — SCREAMING_SNAKE, shared contract §5.2. |
| `src/Infrastructure/PeakPower.Persistence/Migrations/…_TenancyRowLevelSecurity.cs` | Migration 2: roles, grants, RLS policies. |
| `src/Core/PeakPower.Contracts/Employee/*.cs` | Employee request/response DTOs, one file per topic, including the `CustomerListResponse` envelope. |
| `src/Hosts/PeakPower.Api.Employee/Program.cs` | Employee host composition root. |
| `src/Hosts/PeakPower.Api.Employee/Mapping/EmployeeMappings.cs` | Domain → DTO mapping, in memory (value-converted properties do not project in SQL). |
| `src/Hosts/PeakPower.Api.Employee/Endpoints/ReferenceDataEndpoints.cs` | `GET /api/v1/reference-data/brps`. |
| `src/Hosts/PeakPower.Api.Employee/Endpoints/CustomerEndpoints.cs` | Customers list / detail / create / edit. |
| `src/Hosts/PeakPower.Api.Employee/Endpoints/AccountEndpoints.cs` | Accounts create / edit / deactivate. |
| `src/Hosts/PeakPower.Api.Employee/Endpoints/MeteringPointEndpoints.cs` | Metering points attach / edit / end-date. |
| `src/Hosts/PeakPower.Api.Employee/Validation/*.cs` | One FluentValidation validator per request DTO. |
| `tests/PeakPower.Integration.Tests/Tenancy/*.cs` | Context providers, startup guard, RLS, middleware, the route-table harness and the probe host. |
| `tests/PeakPower.Integration.Tests/Employee/*.cs` | Employee endpoint tests and the employee route-table gate. |
| `tests/PeakPower.Integration.Tests/Contract/EmployeeOpenApiSnapshotTests.cs` | Verify snapshot over `artifacts/openapi/employee.json`. |
| `tests/PeakPower.Architecture.Tests/IlScanner.cs` | Mono.Cecil helper: find call sites and string literals in compiled IL. |
| `tests/PeakPower.Architecture.Tests/TenancyArchitectureTests.cs` | Facts 4 and 6, plus the ban on 403. |
| `artifacts/openapi/employee.json` | The emitted OpenAPI document, committed. |

### Modified by this plan

| File | Change |
| --- | --- |
| `Directory.Packages.props` | Add the packages this plan needs. |
| `PeakPower.sln` | Add `PeakPower.Infrastructure.Web` and `PeakPower.Api.Employee`. |
| `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs` | Take `ICustomerContext`; add the three global query filters. |
| `src/Hosts/PeakPower.AppHost/AppHost.cs` | Add `employee-api` with `WaitForCompletion(migrator)`. |

---

## What this plan consumes from Plan 1

Plan 1 (`Platform Foundation`) produces these. Every signature below is reproduced exactly as
this plan uses it. If Plan 1 shipped a different shape, reconcile **before** starting Task 1 — do
not start guessing here.

```csharp
// PeakPower.Persistence
namespace PeakPower.Persistence;

public sealed class PeakPowerDbContext : DbContext
{
    public PeakPowerDbContext(DbContextOptions<PeakPowerDbContext> options);
    public DbSet<Customer> Customers { get; }
    public DbSet<CustomerAccount> CustomerAccounts { get; }
    public DbSet<MeteringPoint> MeteringPoints { get; }
    public DbSet<Brp> Brps { get; }
}

// PeakPower.Domain — reference data for metering points
namespace PeakPower.Domain.Metering;

public sealed class Brp                          // table metering.brp
{
    public Guid Id { get; }
    public string Code { get; }                  // "PVNED"
    public string Name { get; }                  // "PVNed B.V." — this exact string
    public bool IsActive { get; }                // Plan 4's reference-data screen renders it
    public static Result<Brp> Create(string code, string name, bool isActive);
}

// PeakPower.ServiceDefaults
namespace Microsoft.Extensions.Hosting;

public static class ServiceDefaultsExtensions
{
    public static TBuilder AddServiceDefaults<TBuilder>(this TBuilder builder)
        where TBuilder : IHostApplicationBuilder;
    public static WebApplication MapDefaultEndpoints(this WebApplication app);
}
```

Plan 1 also writes every aggregate factory and mutator this plan calls. **This plan declares
none of them** — two plans declaring one class is a duplicate-member compile error, not a merge —
and shared contract §5.1 is the normative spelling. Reproduced here exactly as this plan calls
them:

```csharp
namespace PeakPower.Domain.Customers;

// Every operation that can fail returns Result<T>. Unwrap with .Value only after checking
// .IsSuccess, or after the boundary validator has already made failure impossible.
static Result<Customer> Customer.Create(
    string legalName, string? tradeName, KvkNumber kvkNumber, string? vatNumber,
    Address billingAddress, Address? visitingAddress, ContactPerson primaryContact,
    string? internalReference, string locale);
Result<Customer> Customer.ChangeStatus(CustomerStatus status);          // NOT SetStatus
Result<Customer> Customer.UpdateDetails(
    string legalName, string? tradeName, string? vatNumber,
    Address billingAddress, Address? visitingAddress, ContactPerson primaryContact,
    string? internalReference, string locale);

static Result<CustomerAccount> CustomerAccount.Create(
    Guid customerId, string username, string firstName, string lastName,
    string? jobTitle, string email, string? phone, AccountStatus status, bool isAdmin);
Result<CustomerAccount> CustomerAccount.UpdateProfile(
    string firstName, string lastName, string? jobTitle, string email,
    string? phone, bool isAdmin);
Result<CustomerAccount> CustomerAccount.Deactivate();                   // bumps SecurityStamp
void CustomerAccount.BumpSecurityStamp();

// The factory is Attach, not Create: [F01-R23] is "attach a metering point to a customer".
// Commodity is not a parameter — [DEC-68] makes ELECTRICITY the only value, so the aggregate
// sets it. ValidTo is not a parameter either; closing a period is EndDate.
static Result<MeteringPoint> MeteringPoint.Attach(
    Guid customerId, EanCode ean, Guid brpId,
    ProductionExpectation productionExpectation, ProductionExpectationSource? expectationSource,
    string? name, string? description, string? gridOperator, decimal? capacityKw,
    Address? address, DateOnly validFrom);
Result<MeteringPoint> MeteringPoint.EndDate(DateOnly validTo);          // NOT EndOn
Result<MeteringPoint> MeteringPoint.Rename(string? name, string? description);   // <=80 / <=500
Result<MeteringPoint> MeteringPoint.UpdateDetails(
    Guid brpId, ProductionExpectation productionExpectation,
    ProductionExpectationSource? expectationSource, string? gridOperator,
    decimal? capacityKw, Address? address);
```

Note the split on the metering point: `UpdateDetails` carries the settlement facts and `Rename`
carries the two human-facing strings. `PATCH /api/v1/metering-points/{id}` accepts both in one
body, so the handler calls both mutators — see Task 14.

**Host entry points.** Shared contract §5.1 fixes a convention rather than a shared type: each
host declares its own marker and **no host declares `public partial class Program`**. The one
integration-test assembly references both API hosts, so a bare `WebApplicationFactory<Program>`
would be ambiguous between two global-namespace types.

```csharp
public sealed class EmployeeApiEntryPoint;    // PeakPower.Api.Employee — Task 11 declares this
public sealed class CustomerApiEntryPoint;    // PeakPower.Api.Customer — Plan 5 declares that
```

Tests use `WebApplicationFactory<EmployeeApiEntryPoint>`.

Plus, from the shared contract, the domain types `Customer`, `CustomerAccount`, `MeteringPoint`,
`Address`, `ContactPerson`, `EanCode`, `KvkNumber`, `Iban`, `Result<T>` and every enum; migration
1 with the `customer`, `metering`, `wallet` and `audit` schemas; and, in
`src/Hosts/PeakPower.AppHost/AppHost.cs`, an Aspire model already holding resources named
`postgres`, the database `peakpower`, and `migrator`.

---
## Tasks

### Task 1: The tenancy ports and the context providers

The whole of tenancy funnels through one interface. This task creates it, creates the assembly
that is allowed to know about HTTP, and gives that assembly the three implementations slice 1
needs: a header-driven one for development, a never-authenticated one for the back office, and a
header-driven employee identity.

**Files:**
- Create: `src/Core/PeakPower.Application/Abstractions/ICustomerContext.cs`
- Create: `src/Core/PeakPower.Application/Abstractions/IEmployeeContext.cs`
- Create: `src/Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj`
- Create: `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/DevelopmentCustomerContext.cs`
- Create: `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/UnscopedCustomerContext.cs`
- Create: `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/HeaderEmployeeContext.cs`
- Modify: `PeakPower.sln`
- Test: `tests/PeakPower.Integration.Tests/Tenancy/DevelopmentCustomerContextTests.cs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `PeakPower.Application.Abstractions.ICustomerContext` — `Guid CustomerId`, `Guid AccountId`, `bool IsAdmin`, `bool IsAuthenticated`
  - `PeakPower.Application.Abstractions.IEmployeeContext` — `string EmployeeId`, `bool IsAuthenticated`
  - `PeakPower.Infrastructure.Web.Tenancy.DevelopmentCustomerContext` — `public DevelopmentCustomerContext(IHttpContextAccessor accessor)`, constants `CustomerIdHeader = "X-PeakPower-Customer-Id"`, `AccountIdHeader = "X-PeakPower-Account-Id"`, `IsAdminHeader = "X-PeakPower-Is-Admin"`
  - `PeakPower.Infrastructure.Web.Tenancy.UnscopedCustomerContext` — `public UnscopedCustomerContext()`
  - `PeakPower.Infrastructure.Web.Tenancy.HeaderEmployeeContext` — `public HeaderEmployeeContext(IHttpContextAccessor accessor)`, constant `EmployeeIdHeader = "X-PeakPower-Employee-Id"`, `DefaultEmployeeId = "dev-employee"`

- [ ] **Step 1: Add the packages this plan needs to central package management**

Append these to the `<ItemGroup>` in `Directory.Packages.props`. Keep the file alphabetically
sorted if Plan 1 sorted it.

```xml
<PackageVersion Include="FluentValidation" Version="12.0.0" />
<PackageVersion Include="FluentValidation.DependencyInjectionExtensions" Version="12.0.0" />
<PackageVersion Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.0" />
<PackageVersion Include="Microsoft.AspNetCore.TestHost" Version="10.0.0" />
<PackageVersion Include="Microsoft.Extensions.ApiDescription.Server" Version="10.0.0" />
<PackageVersion Include="Mono.Cecil" Version="0.11.6" />
<PackageVersion Include="Verify.Xunit" Version="30.15.0" />
```

Commit nothing yet; this is scaffolding for the task's deliverable.

- [ ] **Step 2: Create the context-provider assembly**

Create `src/Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <!--
    This is THE context-provider assembly named by architecture fact 6. It is the only
    assembly permitted to read a customer identifier out of HttpContext. Task 8 enforces that.
  -->
  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="../../Core/PeakPower.Application/PeakPower.Application.csproj" />
    <ProjectReference Include="../PeakPower.Persistence/PeakPower.Persistence.csproj" />
  </ItemGroup>

</Project>
```

Then add it to the solution:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet sln add src/Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj \
  --solution-folder src/Infrastructure
dotnet add tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj reference \
  src/Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj
```

- [ ] **Step 3: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Tenancy/DevelopmentCustomerContextTests.cs`:

```csharp
using Shouldly;
using Microsoft.AspNetCore.Http;
using PeakPower.Infrastructure.Web.Tenancy;
using Xunit;

namespace PeakPower.Integration.Tests.Tenancy;

public sealed class DevelopmentCustomerContextTests
{
    private static IHttpContextAccessor AccessorWith(params (string Header, string Value)[] headers)
    {
        var httpContext = new DefaultHttpContext();
        foreach (var (header, value) in headers)
        {
            httpContext.Request.Headers[header] = value;
        }

        return new HttpContextAccessor { HttpContext = httpContext };
    }

    [Fact]
    public void reads_the_customer_and_account_from_the_development_headers()
    {
        var customerId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var accountId = Guid.Parse("22222222-2222-2222-2222-222222222222");

        var context = new DevelopmentCustomerContext(AccessorWith(
            (DevelopmentCustomerContext.CustomerIdHeader, customerId.ToString()),
            (DevelopmentCustomerContext.AccountIdHeader, accountId.ToString()),
            (DevelopmentCustomerContext.IsAdminHeader, "true")));

        context.IsAuthenticated.ShouldBeTrue();
        context.CustomerId.ShouldBe(customerId);
        context.AccountId.ShouldBe(accountId);
        context.IsAdmin.ShouldBeTrue();
    }

    [Fact]
    public void is_not_authenticated_when_the_customer_header_is_absent()
    {
        var context = new DevelopmentCustomerContext(AccessorWith());

        context.IsAuthenticated.ShouldBeFalse();
        context.CustomerId.ShouldBe(Guid.Empty);
        context.AccountId.ShouldBe(Guid.Empty);
        context.IsAdmin.ShouldBeFalse();
    }

    [Fact]
    public void is_not_authenticated_when_the_customer_header_is_not_a_guid()
    {
        var context = new DevelopmentCustomerContext(AccessorWith(
            (DevelopmentCustomerContext.CustomerIdHeader, "not-a-guid")));

        context.IsAuthenticated.ShouldBeFalse();
        context.CustomerId.ShouldBe(Guid.Empty);
    }

    [Fact]
    public void the_unscoped_context_is_never_authenticated()
    {
        var context = new UnscopedCustomerContext();

        context.IsAuthenticated.ShouldBeFalse();
        context.CustomerId.ShouldBe(Guid.Empty);
        context.AccountId.ShouldBe(Guid.Empty);
        context.IsAdmin.ShouldBeFalse();
    }

    [Fact]
    public void the_employee_context_falls_back_to_a_named_development_employee()
    {
        var context = new HeaderEmployeeContext(AccessorWith());

        context.IsAuthenticated.ShouldBeTrue();
        context.EmployeeId.ShouldBe(HeaderEmployeeContext.DefaultEmployeeId);
    }

    [Fact]
    public void the_employee_context_reads_the_employee_header_when_present()
    {
        var context = new HeaderEmployeeContext(AccessorWith(
            (HeaderEmployeeContext.EmployeeIdHeader, "iris.dekker")));

        context.EmployeeId.ShouldBe("iris.dekker");
    }
}
```

- [ ] **Step 4: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~DevelopmentCustomerContextTests"`
Expected: FAIL — the build breaks with `error CS0246: The type or namespace name 'DevelopmentCustomerContext' could not be found`.

- [ ] **Step 5: Write the two ports**

Create `src/Core/PeakPower.Application/Abstractions/ICustomerContext.cs`:

```csharp
namespace PeakPower.Application.Abstractions;

/// <summary>
/// THE tenancy seam <c>[F13-R30]</c>. Every piece of code that needs to know which customer
/// company a request belongs to reads it here and nowhere else. Swapping a development header
/// for an Entra token is a change of DI registration, not a change to any query.
/// </summary>
public interface ICustomerContext
{
    Guid CustomerId { get; }

    Guid AccountId { get; }

    bool IsAdmin { get; }

    /// <summary>
    /// False means "this request is not scoped to a customer". The global query filters read
    /// this: when it is false they are a no-op, which is exactly what the back office needs.
    /// The database's row-level security is what keeps that from being a hole — a connection
    /// that has not issued <c>set_config('app.customer_id', …)</c> sees nothing at all.
    /// </summary>
    bool IsAuthenticated { get; }
}
```

Create `src/Core/PeakPower.Application/Abstractions/IEmployeeContext.cs`:

```csharp
namespace PeakPower.Application.Abstractions;

/// <summary>
/// The back office is not tenant-scoped. PeakPower staff administer every customer, so this
/// context carries who the employee is for auditing, and nothing that narrows a query.
/// </summary>
public interface IEmployeeContext
{
    string EmployeeId { get; }

    bool IsAuthenticated { get; }
}
```

- [ ] **Step 6: Write the three implementations**

Create `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/DevelopmentCustomerContext.cs`:

```csharp
using Microsoft.AspNetCore.Http;
using PeakPower.Application.Abstractions;

namespace PeakPower.Infrastructure.Web.Tenancy;

/// <summary>
/// Development-only <see cref="ICustomerContext"/> driven by request headers, so that the
/// tenancy pipeline can be exercised before Plan 5 issues real tokens. Registered ONLY outside
/// Production; <see cref="TenancyStartupGuard"/> refuses to boot a Production host that has it.
/// </summary>
public sealed class DevelopmentCustomerContext : ICustomerContext
{
    public const string CustomerIdHeader = "X-PeakPower-Customer-Id";
    public const string AccountIdHeader = "X-PeakPower-Account-Id";
    public const string IsAdminHeader = "X-PeakPower-Is-Admin";

    private readonly IHttpContextAccessor _accessor;

    public DevelopmentCustomerContext(IHttpContextAccessor accessor) => _accessor = accessor;

    public Guid CustomerId => ReadGuid(CustomerIdHeader) ?? Guid.Empty;

    public Guid AccountId => IsAuthenticated ? ReadGuid(AccountIdHeader) ?? Guid.Empty : Guid.Empty;

    public bool IsAdmin =>
        IsAuthenticated &&
        string.Equals(ReadHeader(IsAdminHeader), "true", StringComparison.OrdinalIgnoreCase);

    public bool IsAuthenticated => ReadGuid(CustomerIdHeader) is not null;

    private Guid? ReadGuid(string header) =>
        Guid.TryParse(ReadHeader(header), out var value) ? value : null;

    private string? ReadHeader(string header)
    {
        var httpContext = _accessor.HttpContext;
        if (httpContext is null)
        {
            return null;
        }

        return httpContext.Request.Headers.TryGetValue(header, out var values)
            ? values.ToString()
            : null;
    }
}
```

Create `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/UnscopedCustomerContext.cs`:

```csharp
using PeakPower.Application.Abstractions;

namespace PeakPower.Infrastructure.Web.Tenancy;

/// <summary>
/// The registration the employee API uses. It is never authenticated, which makes every global
/// query filter a no-op, which is what lets back-office staff see every customer.
/// <para>
/// This is safe rather than reckless because it is paired with a database login role: the
/// employee host connects as <c>peakpower_employee</c>, which holds an explicit
/// "see everything" row-level-security policy. A host that registered this context but
/// connected as <c>peakpower_app</c> would see nothing at all, because <c>app.customer_id</c>
/// would never be set. Fail-closed in both directions.
/// </para>
/// </summary>
public sealed class UnscopedCustomerContext : ICustomerContext
{
    public Guid CustomerId => Guid.Empty;

    public Guid AccountId => Guid.Empty;

    public bool IsAdmin => false;

    public bool IsAuthenticated => false;
}
```

Create `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/HeaderEmployeeContext.cs`:

```csharp
using Microsoft.AspNetCore.Http;
using PeakPower.Application.Abstractions;

namespace PeakPower.Infrastructure.Web.Tenancy;

/// <summary>
/// Development-only <see cref="IEmployeeContext"/>. Back-office authentication (corporate Entra)
/// is out of slice 1, so the employee identity is a header with a named default, and
/// <see cref="TenancyStartupGuard"/> refuses to boot Production with this registered.
/// </summary>
public sealed class HeaderEmployeeContext : IEmployeeContext
{
    public const string EmployeeIdHeader = "X-PeakPower-Employee-Id";
    public const string DefaultEmployeeId = "dev-employee";

    private readonly IHttpContextAccessor _accessor;

    public HeaderEmployeeContext(IHttpContextAccessor accessor) => _accessor = accessor;

    public string EmployeeId
    {
        get
        {
            var httpContext = _accessor.HttpContext;
            if (httpContext is null)
            {
                return DefaultEmployeeId;
            }

            return httpContext.Request.Headers.TryGetValue(EmployeeIdHeader, out var values)
                   && !string.IsNullOrWhiteSpace(values.ToString())
                ? values.ToString()
                : DefaultEmployeeId;
        }
    }

    public bool IsAuthenticated => true;
}
```

- [ ] **Step 7: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~DevelopmentCustomerContextTests"`
Expected: PASS — 6 tests.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add Directory.Packages.props PeakPower.sln \
  src/Core/PeakPower.Application/Abstractions/ICustomerContext.cs \
  src/Core/PeakPower.Application/Abstractions/IEmployeeContext.cs \
  src/Infrastructure/PeakPower.Infrastructure.Web \
  tests/PeakPower.Integration.Tests/Tenancy/DevelopmentCustomerContextTests.cs \
  tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj
git commit -m "feat(tenancy): add ICustomerContext, IEmployeeContext and the development providers"
```

---

### Task 2: The startup guard — refuse to boot a development provider in Production

`[F13-R31]`. A development identity provider that survives into Production is a total tenancy
bypass, and the failure mode is silent. The guard runs before `builder.Build()`, inspects the
service collection itself, and throws.

**Files:**
- Create: `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/TenancyStartupGuard.cs`
- Test: `tests/PeakPower.Integration.Tests/Tenancy/TenancyStartupGuardTests.cs`

**Interfaces:**
- Consumes: `DevelopmentCustomerContext`, `HeaderEmployeeContext` (Task 1).
- Produces:
  - `public static class TenancyStartupGuard`
  - `public static void ThrowIfDevelopmentProvidersRegisteredInProduction(IServiceCollection services, IHostEnvironment environment)`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Tenancy/TenancyStartupGuardTests.cs`:

```csharp
using Shouldly;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using PeakPower.Application.Abstractions;
using PeakPower.Infrastructure.Web.Tenancy;
using Xunit;

namespace PeakPower.Integration.Tests.Tenancy;

public sealed class TenancyStartupGuardTests
{
    private sealed class StubEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "PeakPower.Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } =
            new Microsoft.Extensions.FileProviders.NullFileProvider();
    }

    [Fact]
    public void throws_when_the_development_customer_context_is_registered_in_production()
    {
        var services = new ServiceCollection();
        services.AddHttpContextAccessor();
        services.AddScoped<ICustomerContext, DevelopmentCustomerContext>();

        var act = () => TenancyStartupGuard.ThrowIfDevelopmentProvidersRegisteredInProduction(
            services,
            new StubEnvironment { EnvironmentName = Environments.Production });

        var message = Should.Throw<InvalidOperationException>(act).Message;
        message.ShouldContain("[F13-R31]");
        message.ShouldContain("DevelopmentCustomerContext");
    }

    [Fact]
    public void throws_when_the_header_employee_context_is_registered_in_production()
    {
        var services = new ServiceCollection();
        services.AddHttpContextAccessor();
        services.AddScoped<IEmployeeContext, HeaderEmployeeContext>();

        var act = () => TenancyStartupGuard.ThrowIfDevelopmentProvidersRegisteredInProduction(
            services,
            new StubEnvironment { EnvironmentName = Environments.Production });

        Should.Throw<InvalidOperationException>(act)
            .Message.ShouldContain("HeaderEmployeeContext");
    }

    [Fact]
    public void does_not_throw_outside_production()
    {
        var services = new ServiceCollection();
        services.AddScoped<ICustomerContext, DevelopmentCustomerContext>();

        var act = () => TenancyStartupGuard.ThrowIfDevelopmentProvidersRegisteredInProduction(
            services,
            new StubEnvironment { EnvironmentName = Environments.Development });

        Should.NotThrow(act);
    }

    [Fact]
    public void does_not_throw_in_production_when_only_production_providers_are_registered()
    {
        var services = new ServiceCollection();
        services.AddScoped<ICustomerContext, UnscopedCustomerContext>();

        var act = () => TenancyStartupGuard.ThrowIfDevelopmentProvidersRegisteredInProduction(
            services,
            new StubEnvironment { EnvironmentName = Environments.Production });

        Should.NotThrow(act);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~TenancyStartupGuardTests"`
Expected: FAIL — `error CS0103: The name 'TenancyStartupGuard' does not exist in the current context`.

- [ ] **Step 3: Write the guard**

Create `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/TenancyStartupGuard.cs`:

```csharp
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace PeakPower.Infrastructure.Web.Tenancy;

/// <summary>
/// <c>[F13-R31]</c> — a host must refuse to start if a development identity provider is
/// registered in Production. Call this immediately before <c>builder.Build()</c>, passing the
/// live service collection, so the failure is a boot failure and not a runtime surprise.
/// </summary>
public static class TenancyStartupGuard
{
    private static readonly Type[] DevelopmentOnlyImplementations =
    [
        typeof(DevelopmentCustomerContext),
        typeof(HeaderEmployeeContext),
    ];

    public static void ThrowIfDevelopmentProvidersRegisteredInProduction(
        IServiceCollection services,
        IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(environment);

        if (!environment.IsProduction())
        {
            return;
        }

        var offenders = services
            .Select(descriptor => descriptor.ImplementationType)
            .Where(type => type is not null && DevelopmentOnlyImplementations.Contains(type))
            .Select(type => type!.FullName!)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();

        if (offenders.Length == 0)
        {
            return;
        }

        throw new InvalidOperationException(
            "[F13-R31] Refusing to start. Development-only identity providers are registered in " +
            $"the Production environment: {string.Join(", ", offenders)}. " +
            "Register a token-backed ICustomerContext and a real IEmployeeContext instead.");
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~TenancyStartupGuardTests"`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/TenancyStartupGuard.cs \
  tests/PeakPower.Integration.Tests/Tenancy/TenancyStartupGuardTests.cs
git commit -m "feat(tenancy): refuse to boot a development identity provider in Production [F13-R31]"
```

---
### Task 3: EF Core global query filters

A global query filter is a predicate EF Core silently appends to every LINQ query against an
entity type. It is the *default-correct* half of tenancy: a developer who writes
`db.MeteringPoints.Where(m => m.Ean == ean)` gets tenant isolation without knowing it exists.

The filter is written as `!context.IsAuthenticated || x.CustomerId == context.CustomerId`, which
reads oddly until you see why: when the request is not scoped to a customer — the back office —
the filter must disappear entirely. EF parameterises both sides, so this is two query parameters,
not two query plans.

This task also adds the test that matters more than the filters themselves: **every entity type
that has a `CustomerId` must have a filter**, checked by walking the built model. A future
entity added without a filter fails this test.

**Files:**
- Modify: `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs`
- Test: `tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs`

**Interfaces:**
- Consumes: `ICustomerContext`, `UnscopedCustomerContext` (Task 1); `PeakPowerDbContext` (Plan 1).
- Produces:
  - `public PeakPowerDbContext(DbContextOptions<PeakPowerDbContext> options, ICustomerContext customerContext)` — the constructor gains a second parameter. Every caller in the solution resolves it from DI, so no call site changes, but Plan 1's `PeakPower.Migrator` may construct it by hand; if it does, pass `new UnscopedCustomerContext()` there.

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs`:

```csharp
using Shouldly;
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;
using Xunit;

namespace PeakPower.Integration.Tests.Tenancy;

/// <summary>
/// Model-only tests. Building an EF Core model does not open a connection, so these need no
/// container and run in milliseconds.
/// </summary>
public sealed class QueryFilterModelTests
{
    private static PeakPowerDbContext ModelOnlyContext(ICustomerContext customerContext)
    {
        var options = new DbContextOptionsBuilder<PeakPowerDbContext>()
            .UseNpgsql("Host=localhost;Port=5432;Database=model-only;Username=none;Password=none")
            .UseSnakeCaseNamingConvention()
            .Options;

        return new PeakPowerDbContext(options, customerContext);
    }

    [Fact]
    public void every_entity_type_that_owns_a_customer_id_has_a_global_query_filter()
    {
        using var db = ModelOnlyContext(new UnscopedCustomerContext());

        var customerOwned = db.Model.GetEntityTypes()
            .Where(entityType =>
                entityType.FindProperty("CustomerId") is not null ||
                entityType.ClrType == typeof(PeakPower.Domain.Customers.Customer))
            .ToArray();

        customerOwned.ShouldNotBeEmpty(
            "Customer, CustomerAccount and MeteringPoint are all customer-owned");

        var unfiltered = customerOwned
            .Where(entityType => entityType.GetDeclaredQueryFilters().Count == 0)
            .Select(entityType => entityType.ClrType.Name)
            .ToArray();

        unfiltered.ShouldBeEmpty(
            "an entity with a CustomerId and no global query filter is a tenancy hole");
    }

    [Fact]
    public void the_three_slice_one_entities_are_all_covered()
    {
        using var db = ModelOnlyContext(new UnscopedCustomerContext());

        var filtered = db.Model.GetEntityTypes()
            .Where(entityType => entityType.GetDeclaredQueryFilters().Count > 0)
            .Select(entityType => entityType.ClrType.Name)
            .ToArray();

        filtered.ShouldContain("Customer");
        filtered.ShouldContain("CustomerAccount");
        filtered.ShouldContain("MeteringPoint");
    }

    [Fact]
    public void reference_data_is_not_filtered()
    {
        using var db = ModelOnlyContext(new UnscopedCustomerContext());

        var brp = db.Model.FindEntityType(typeof(PeakPower.Domain.Metering.Brp));

        brp.ShouldNotBeNull();
        brp!.GetDeclaredQueryFilters().ShouldBeEmpty(
            "BRPs are platform reference data, shared by every customer");
    }
}
```

> `GetDeclaredQueryFilters()` is the EF Core 10 API. EF Core 10 replaced the single
> `GetQueryFilter()` with *named* filters and returns a collection; the older single-filter
> accessor is obsolete and would trip warnings-as-errors.

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~QueryFilterModelTests"`
Expected: FAIL — first a compile error, `error CS1729: 'PeakPowerDbContext' does not contain a constructor that takes 2 arguments`.

- [ ] **Step 3: Add the constructor parameter and the filters**

Modify `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs` so that the class reads:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;

namespace PeakPower.Persistence;

public sealed class PeakPowerDbContext : DbContext
{
    private readonly ICustomerContext _customerContext;

    public PeakPowerDbContext(
        DbContextOptions<PeakPowerDbContext> options,
        ICustomerContext customerContext)
        : base(options)
        => _customerContext = customerContext;

    public DbSet<Customer> Customers => Set<Customer>();

    public DbSet<CustomerAccount> CustomerAccounts => Set<CustomerAccount>();

    public DbSet<MeteringPoint> MeteringPoints => Set<MeteringPoint>();

    public DbSet<Brp> Brps => Set<Brp>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PeakPowerDbContext).Assembly);

        // Tenancy, layer 1 of 2. The predicate reads instance state, which EF Core turns into
        // query parameters — so there is one compiled plan, not one per tenant. When the
        // request is not customer-scoped (the back office) the filter collapses to `true`,
        // and layer 2 — the database's row-level security — is what stops that being a hole.
        modelBuilder.Entity<Customer>()
            .HasQueryFilter(customer =>
                !_customerContext.IsAuthenticated || customer.Id == _customerContext.CustomerId);

        modelBuilder.Entity<CustomerAccount>()
            .HasQueryFilter(account =>
                !_customerContext.IsAuthenticated || account.CustomerId == _customerContext.CustomerId);

        modelBuilder.Entity<MeteringPoint>()
            .HasQueryFilter(meteringPoint =>
                !_customerContext.IsAuthenticated ||
                meteringPoint.CustomerId == _customerContext.CustomerId);
    }
}
```

Keep whatever else Plan 1 already put in `OnModelCreating` — the enum-to-text convention and the
snake_case naming convention in particular. Only the constructor and the three
`HasQueryFilter` calls are new.

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~QueryFilterModelTests"`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs \
  tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs
git commit -m "feat(tenancy): add EF Core global query filters on every customer-owned entity"
```

---

### Task 4: Migration 2 — row-level security roles and policies

### Why RLS *as well as* the query filter, not instead of it

They fail differently, and that is the whole point.

The query filter is a property of the **object-relational mapper**. It is on by default, it
produces good SQL, and it is right in the common path. It is also removable: `IgnoreQueryFilters()`
turns it off, raw SQL and Dapper never had it (the architecture already plans Dapper for the
reporting path), and a new entity that nobody remembered to configure has no filter at all.

Row-level security is a property of the **database**. It applies to every statement issued on
that connection — EF, Dapper, a psql session, a stray migration — regardless of what the client
believed it was doing. It cannot be turned off by application code, because the login role has no
right to turn it off.

So: the filter is *correctness by default* and the RLS policy is *the backstop*. Neither is
sufficient alone. RLS alone would make a forgotten filter return an empty set rather than an
error, pushing every tenancy defect to production runtime; the filter alone can be switched off
by one method call. Together, escaping isolation requires deliberately doing two different
wrong things.

### How the two database roles work

| Role | Login | Sees | Used by |
| --- | --- | --- | --- |
| `app_customer_role` | no — a group role holding grants and the isolation policy | only rows matching `app.customer_id` | — |
| `app_employee_role` | no — a group role holding grants and a `USING (true)` policy | every row | — |
| `peakpower_app` | yes | via `app_customer_role` | the customer API (Plan 5) and the probe host (Task 9) |
| `peakpower_employee` | yes | via `app_employee_role` | the employee API (Task 11) |

Both login roles are **non-owners**, so `ENABLE ROW LEVEL SECURITY` applies to them. `FORCE ROW
LEVEL SECURITY` is deliberately *not* set: the table owner is the migration role, which must be
able to run migrations and seed data. No API ever connects as the owner.

If `app.customer_id` is not set, `current_setting('app.customer_id', true)` returns NULL, the
policy predicate is NULL, and no row qualifies. **Unset means see nothing** — fail-closed.

Two tables are deliberately left without a policy: `customer.refresh_token` and
`customer.password_reset_token`. Both are read *before* the caller's customer is known — that is
what sign-in and password reset are — so a policy keyed on `app.customer_id` would make them
unreadable. Plan 5, which owns those flows, must revisit them and scope them by account instead.
`customer.onboarding_application` is left open for the same reason: an application has no customer
until it is signed.

**Files:**
- Create: `src/Infrastructure/PeakPower.Persistence/Migrations/<timestamp>_TenancyRowLevelSecurity.cs`
- Test: `tests/PeakPower.Integration.Tests/Tenancy/TenancyFixture.cs`
- Test: `tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`

**Interfaces:**
- Consumes: migration 1 and the four schemas (Plan 1); `UnscopedCustomerContext` (Task 1).
- Produces:
  - Database roles `app_customer_role`, `app_employee_role`, `peakpower_app` (password `dev_only_app_password`), `peakpower_employee` (password `dev_only_employee_password`)
  - The runtime setting name `app.customer_id`
  - `PeakPower.Integration.Tests.Tenancy.TenancyFixture` — `PeakPowerDbContext OwnerContext()`, `PeakPowerDbContext ContextFor(string connectionString)`, `static NpgsqlConnection Connect(string connectionString)`, `string OwnerConnectionString { get; }`, `string CustomerRoleConnectionString { get; }`, `string EmployeeRoleConnectionString { get; }`, `Guid CompanyAId { get; }`, `Guid CompanyBId { get; }`, `Guid CompanyAMeteringPointId { get; }`, `Guid CompanyBMeteringPointId { get; }`, `Guid CompanyBAccountId { get; }`, `Guid BrpId { get; }`, `IReadOnlyDictionary<string, Guid> CompanyBIds { get; }`
  - `PeakPower.Integration.Tests.Tenancy.TenancyCollection` — the xUnit collection name every tenancy and employee test class joins

> **The role passwords are literals in a migration.** That is acceptable *only* because slice 1
> is local-only — no CI, no remotes, no deployment (design §11). Before anything is deployed, the
> passwords must move to a secret store and the migration must read them from a runtime
> parameter. Write that sentence as a comment in the migration itself.

- [ ] **Step 1: Create the empty migration**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet ef migrations add TenancyRowLevelSecurity \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator \
  --output-dir Migrations
```

This creates a migration class with empty `Up` and `Down` methods plus an updated model snapshot.

- [ ] **Step 2: Write the failing test — the fixture and the RLS assertions**

Create `tests/PeakPower.Integration.Tests/Tenancy/TenancyFixture.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;
using Testcontainers.PostgreSql;
using Xunit;

namespace PeakPower.Integration.Tests.Tenancy;

/// <summary>
/// One PostgreSQL 17 container, migrated, holding two customer companies: A and B. Every
/// tenancy test signs in as A and goes looking for B.
/// </summary>
public sealed class TenancyFixture : IAsyncLifetime
{
    public const string CustomerRole = "peakpower_app";
    public const string CustomerRolePassword = "dev_only_app_password";
    public const string EmployeeRole = "peakpower_employee";
    public const string EmployeeRolePassword = "dev_only_employee_password";

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder()
        .WithImage("postgres:17")
        .WithDatabase("peakpower")
        .Build();

    public string OwnerConnectionString { get; private set; } = string.Empty;

    public string CustomerRoleConnectionString { get; private set; } = string.Empty;

    public string EmployeeRoleConnectionString { get; private set; } = string.Empty;

    public Guid CompanyAId { get; private set; }

    public Guid CompanyBId { get; private set; }

    public Guid CompanyAMeteringPointId { get; private set; }

    public Guid CompanyBMeteringPointId { get; private set; }

    public Guid CompanyBAccountId { get; private set; }

    public Guid BrpId { get; private set; }

    /// <summary>
    /// Company B's object identifiers keyed by the resource kind an endpoint declares in its
    /// <c>TenancyClassification</c>. The route-table probe fails loudly when a tenant-scoped
    /// endpoint names a kind that is missing here.
    /// </summary>
    public IReadOnlyDictionary<string, Guid> CompanyBIds { get; private set; } =
        new Dictionary<string, Guid>();

    public async ValueTask InitializeAsync()
    {
        await _container.StartAsync();
        OwnerConnectionString = _container.GetConnectionString();

        await using (var db = OwnerContext())
        {
            await db.Database.MigrateAsync();
        }

        CustomerRoleConnectionString =
            AppRoleConnectionString.For(OwnerConnectionString, CustomerRole, CustomerRolePassword);
        EmployeeRoleConnectionString =
            AppRoleConnectionString.For(OwnerConnectionString, EmployeeRole, EmployeeRolePassword);

        await SeedAsync();
    }

    public async ValueTask DisposeAsync() => await _container.DisposeAsync();

    /// <summary>
    /// A context on the owning (superuser) connection with no customer scope. Row-level
    /// security does not apply to the table owner, so this is how tests arrange data.
    /// </summary>
    public PeakPowerDbContext OwnerContext() => ContextFor(OwnerConnectionString);

    public PeakPowerDbContext ContextFor(string connectionString) =>
        new(new DbContextOptionsBuilder<PeakPowerDbContext>()
                .UseNpgsql(connectionString)
                .UseSnakeCaseNamingConvention()
                .Options,
            new UnscopedCustomerContext());

    private async Task SeedAsync()
    {
        await using var db = OwnerContext();

        // Plan 1's factories return Result<T>; the fixture's inputs are all known-good, so
        // .Value is safe here and a regression in a factory surfaces as a clear test failure.
        var brp = Brp.Create("PVNED", "PVNed B.V.", isActive: true).Value;
        db.Brps.Add(brp);

        var companyA = NewCustomer("Zonneweide Beheer B.V.", "81000001");
        var companyB = NewCustomer("Windkracht Noord B.V.", "81000002");
        db.Customers.AddRange(companyA, companyB);

        var accountB = CustomerAccount.Create(
            companyB.Id, "b.jansen", "Bram", "Jansen", "Operations",
            "bram.jansen@windkrachtnoord.example", null,
            AccountStatus.Invited, isAdmin: false).Value;
        db.CustomerAccounts.Add(accountB);

        var meteringPointA = NewMeteringPoint(companyA.Id, brp.Id, "871687110000000101");
        var meteringPointB = NewMeteringPoint(companyB.Id, brp.Id, "871687110000000202");
        db.MeteringPoints.AddRange(meteringPointA, meteringPointB);

        await db.SaveChangesAsync();

        BrpId = brp.Id;
        CompanyAId = companyA.Id;
        CompanyBId = companyB.Id;
        CompanyAMeteringPointId = meteringPointA.Id;
        CompanyBMeteringPointId = meteringPointB.Id;
        CompanyBAccountId = accountB.Id;

        CompanyBIds = new Dictionary<string, Guid>(StringComparer.Ordinal)
        {
            ["Customer"] = CompanyBId,
            ["CustomerAccount"] = CompanyBAccountId,
            ["MeteringPoint"] = CompanyBMeteringPointId,
        };
    }

    private static Customer NewCustomer(string legalName, string kvk) =>
        Customer.Create(
            legalName,
            tradeName: null,
            kvkNumber: KvkNumber.Create(kvk).Value,
            vatNumber: null,
            billingAddress: new Address("Havenweg", "12", null, "3011 AA", "Rotterdam", "NL"),
            visitingAddress: null,
            primaryContact: new ContactPerson("Els Bakker", "els@example.test", null),
            internalReference: null,
            locale: "nl-NL").Value;

    private static MeteringPoint NewMeteringPoint(Guid customerId, Guid brpId, string ean) =>
        MeteringPoint.Attach(
            customerId,
            EanCode.Create(ean).Value,
            brpId,
            ProductionExpectation.Unknown,
            expectationSource: null,
            name: null,
            description: null,
            gridOperator: "Stedin",
            capacityKw: 250m,
            address: null,
            validFrom: new DateOnly(2026, 1, 1)).Value;

    public static NpgsqlConnection Connect(string connectionString) => new(connectionString);
}

[CollectionDefinition(nameof(TenancyCollection))]
public sealed class TenancyCollection : ICollectionFixture<TenancyFixture>;
```

Create `tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`:

```csharp
using Shouldly;
using Npgsql;
using Xunit;

namespace PeakPower.Integration.Tests.Tenancy;

[Collection(nameof(TenancyCollection))]
public sealed class RowLevelSecurityTests
{
    private readonly TenancyFixture _fixture;

    public RowLevelSecurityTests(TenancyFixture fixture) => _fixture = fixture;

    private static async Task<int> CountMeteringPointsAsync(
        NpgsqlConnection connection,
        Guid? customerId)
    {
        await using var transaction = await connection.BeginTransactionAsync();

        if (customerId is not null)
        {
            await using var setting = new NpgsqlCommand(
                "SELECT set_config('app.customer_id', @value, true)", connection, transaction);
            setting.Parameters.AddWithValue("value", customerId.Value.ToString());
            await setting.ExecuteNonQueryAsync();
        }

        await using var count = new NpgsqlCommand(
            "SELECT count(*) FROM customer.metering_point", connection, transaction);
        return Convert.ToInt32(await count.ExecuteScalarAsync());
    }

    [Fact]
    public async Task the_customer_role_sees_only_the_rows_of_the_customer_it_declared()
    {
        await using var connection = TenancyFixture.Connect(_fixture.CustomerRoleConnectionString);
        await connection.OpenAsync();

        var seen = await CountMeteringPointsAsync(connection, _fixture.CompanyAId);

        seen.ShouldBe(1, "company A has exactly one metering point in the fixture");
    }

    [Fact]
    public async Task the_customer_role_sees_nothing_when_no_customer_is_declared()
    {
        await using var connection = TenancyFixture.Connect(_fixture.CustomerRoleConnectionString);
        await connection.OpenAsync();

        var seen = await CountMeteringPointsAsync(connection, customerId: null);

        seen.ShouldBe(0, "an unset app.customer_id must fail closed, not open");
    }

    [Fact]
    public async Task the_customer_role_cannot_read_another_companys_row_by_primary_key()
    {
        await using var connection = TenancyFixture.Connect(_fixture.CustomerRoleConnectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        await using (var setting = new NpgsqlCommand(
            "SELECT set_config('app.customer_id', @value, true)", connection, transaction))
        {
            setting.Parameters.AddWithValue("value", _fixture.CompanyAId.ToString());
            await setting.ExecuteNonQueryAsync();
        }

        await using var command = new NpgsqlCommand(
            "SELECT count(*) FROM customer.metering_point WHERE id = @id", connection, transaction);
        command.Parameters.AddWithValue("id", _fixture.CompanyBMeteringPointId);

        Convert.ToInt32(await command.ExecuteScalarAsync()).ShouldBe(0);
    }

    [Fact]
    public async Task the_customer_role_cannot_insert_a_row_for_another_company()
    {
        await using var connection = TenancyFixture.Connect(_fixture.CustomerRoleConnectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        await using (var setting = new NpgsqlCommand(
            "SELECT set_config('app.customer_id', @value, true)", connection, transaction))
        {
            setting.Parameters.AddWithValue("value", _fixture.CompanyAId.ToString());
            await setting.ExecuteNonQueryAsync();
        }

        await using var insert = new NpgsqlCommand(
            """
            INSERT INTO customer.customer_account
                (id, customer_id, username, first_name, last_name, email, status, is_admin, security_stamp)
            VALUES
                (gen_random_uuid(), @customerId, 'smuggled', 'S', 'M', 's@example.test', 'INVITED', false, gen_random_uuid())
            """,
            connection, transaction);
        insert.Parameters.AddWithValue("customerId", _fixture.CompanyBId);

        var act = async () => await insert.ExecuteNonQueryAsync();

        (await Should.ThrowAsync<PostgresException>(act))
            .SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege,
                "the WITH CHECK arm of the policy must reject a cross-tenant write");
    }

    [Fact]
    public async Task the_employee_role_sees_every_company()
    {
        await using var connection = TenancyFixture.Connect(_fixture.EmployeeRoleConnectionString);
        await connection.OpenAsync();

        var seen = await CountMeteringPointsAsync(connection, customerId: null);

        seen.ShouldBe(2, "the back office is not tenant-scoped");
    }
}
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~RowLevelSecurityTests"`
Expected: FAIL — `error CS0103: The name 'AppRoleConnectionString' does not exist in the current
context`. The fixture seeds through Plan 1's factories, which already exist, but it rewrites the
container's connection string onto the two login roles, and that helper is written in Task 5.

> **Execution note.** This is the one place in the plan where a test cannot go green inside its
> own task. `AppRoleConnectionString` and the RLS policies are genuinely separate deliverables and
> each needs its own red-to-green step, so this task ends with the migration written and proven to
> apply (Step 5), and `RowLevelSecurityTests` turns green at the end of Task 5 — where it is the
> stated expected outcome.

- [ ] **Step 4: Write the migration**

Replace the generated `Up` and `Down` in
`src/Infrastructure/PeakPower.Persistence/Migrations/<timestamp>_TenancyRowLevelSecurity.cs`:

```csharp
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PeakPower.Persistence.Migrations;

/// <inheritdoc />
public partial class TenancyRowLevelSecurity : Migration
{
    // The four customer-owned tables. customer.customer keys on `id`; the rest on `customer_id`.
    private static readonly (string Table, string Column)[] CustomerOwnedTables =
    [
        ("customer.customer", "id"),
        ("customer.customer_account", "customer_id"),
        ("customer.metering_point", "customer_id"),
        ("wallet.wallet", "customer_id"),
    ];

    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // ---------------------------------------------------------------------------------
        // Roles.
        //
        // The two login passwords below are literals ONLY because slice 1 is local-only: no
        // CI, no remotes, no deployment (design section 11). Before anything is deployed these
        // must move to a secret store and this migration must read them from a runtime
        // parameter. Do not carry the literals forward.
        // ---------------------------------------------------------------------------------
        migrationBuilder.Sql(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_customer_role') THEN
                    CREATE ROLE app_customer_role NOLOGIN;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_employee_role') THEN
                    CREATE ROLE app_employee_role NOLOGIN;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peakpower_app') THEN
                    CREATE ROLE peakpower_app LOGIN PASSWORD 'dev_only_app_password';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peakpower_employee') THEN
                    CREATE ROLE peakpower_employee LOGIN PASSWORD 'dev_only_employee_password';
                END IF;
            END
            $$;
            """);

        migrationBuilder.Sql(
            """
            GRANT app_customer_role TO peakpower_app;
            GRANT app_employee_role TO peakpower_employee;

            GRANT USAGE ON SCHEMA customer, metering, wallet, audit
                TO app_customer_role, app_employee_role;

            GRANT SELECT, INSERT, UPDATE, DELETE
                ON ALL TABLES IN SCHEMA customer, metering, wallet, audit
                TO app_customer_role, app_employee_role;

            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA customer, metering, wallet, audit
                TO app_customer_role, app_employee_role;

            ALTER DEFAULT PRIVILEGES IN SCHEMA customer, metering, wallet, audit
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
                TO app_customer_role, app_employee_role;
            """);

        // ---------------------------------------------------------------------------------
        // Policies. NULLIF guards the case where app.customer_id is set to an empty string:
        // ''::uuid raises 22P02, whereas NULL simply matches nothing, which is what we want.
        //
        // FORCE ROW LEVEL SECURITY is deliberately NOT set. The table owner is the migration
        // role, which must be able to migrate and seed. No API connects as the owner.
        // ---------------------------------------------------------------------------------
        foreach (var (table, column) in CustomerOwnedTables)
        {
            var policyPrefix = table.Replace('.', '_');

            migrationBuilder.Sql($"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;");

            migrationBuilder.Sql(
                $"""
                CREATE POLICY {policyPrefix}_tenant_isolation ON {table}
                    FOR ALL TO app_customer_role
                    USING ({column} = NULLIF(current_setting('app.customer_id', true), '')::uuid)
                    WITH CHECK ({column} = NULLIF(current_setting('app.customer_id', true), '')::uuid);
                """);

            migrationBuilder.Sql(
                $"""
                CREATE POLICY {policyPrefix}_back_office ON {table}
                    FOR ALL TO app_employee_role
                    USING (true)
                    WITH CHECK (true);
                """);
        }
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        foreach (var (table, _) in CustomerOwnedTables)
        {
            var policyPrefix = table.Replace('.', '_');
            migrationBuilder.Sql($"DROP POLICY IF EXISTS {policyPrefix}_back_office ON {table};");
            migrationBuilder.Sql($"DROP POLICY IF EXISTS {policyPrefix}_tenant_isolation ON {table};");
            migrationBuilder.Sql($"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;");
        }

        migrationBuilder.Sql(
            """
            REVOKE ALL ON ALL TABLES IN SCHEMA customer, metering, wallet, audit
                FROM app_customer_role, app_employee_role;
            REVOKE USAGE ON SCHEMA customer, metering, wallet, audit
                FROM app_customer_role, app_employee_role;
            DROP ROLE IF EXISTS peakpower_app;
            DROP ROLE IF EXISTS peakpower_employee;
            DROP ROLE IF EXISTS app_customer_role;
            DROP ROLE IF EXISTS app_employee_role;
            """);
    }
}
```

- [ ] **Step 5: Confirm the migration applies to an empty PostgreSQL 17**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
docker run --rm -d --name pp-migration-check \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=peakpower -p 55432:5432 postgres:17
sleep 5
ConnectionStrings__peakpower="Host=localhost;Port=55432;Database=peakpower;Username=postgres;Password=postgres" \
  dotnet run --project src/Hosts/PeakPower.Migrator
docker exec pp-migration-check psql -U postgres -d peakpower \
  -c "SELECT tablename, policyname, roles FROM pg_policies ORDER BY tablename, policyname;"
docker rm -f pp-migration-check
```

Expected: eight rows — a `_tenant_isolation` and a `_back_office` policy for each of
`customer`, `customer_account`, `metering_point` and `wallet`.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence/Migrations \
  tests/PeakPower.Integration.Tests/Tenancy/TenancyFixture.cs \
  tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs
git commit -m "feat(tenancy): add row-level security roles and policies in migration 2"
```

---
### Task 5: The per-request tenant transaction, and role-scoped connection strings

`SET LOCAL` only exists inside a transaction, so the customer scope and the request transaction
are the same thing. This middleware opens the transaction, issues the setting, runs the request,
and commits — or rolls back if the request produced a server error. Design §7 leans on this: the
`security_stamp` check that Plan 5 adds "rides along on a row already being touched" precisely
because this transaction is already open.

`set_config(name, value, is_local)` is used rather than `SET LOCAL app.customer_id = …` because
`SET` will not take a parameter, and string-concatenating a value into `SET` is how you get SQL
injection into a tenancy control.

**Files:**
- Create: `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/AppRoleConnectionString.cs`
- Create: `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/TenantScopeMiddleware.cs`
- Test: `tests/PeakPower.Integration.Tests/Tenancy/AppRoleConnectionStringTests.cs`

**Interfaces:**
- Consumes: `ICustomerContext` (Task 1); `PeakPowerDbContext` (Task 3).
- Produces:
  - `public static class AppRoleConnectionString` — `public static string For(string baseConnectionString, string role, string password)`
  - `public sealed class TenantScopeMiddleware` — `public TenantScopeMiddleware(RequestDelegate next)`, `public Task InvokeAsync(HttpContext context, PeakPowerDbContext db, ICustomerContext tenancy)`, `public const string CustomerIdSetting = "app.customer_id"`
  - `public static class TenantScopeMiddlewareExtensions` — `public static IApplicationBuilder UseTenantScope(this IApplicationBuilder app)`

- [ ] **Step 1: Add the Npgsql package reference to the context-provider assembly**

`AppRoleConnectionString` needs `NpgsqlConnectionStringBuilder`. Add to
`src/Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj`, inside the
existing `<ItemGroup>` that holds the project references:

```xml
<PackageReference Include="Npgsql" />
```

and, if `Directory.Packages.props` does not already carry it (Plan 1 pulls it in transitively
through `Npgsql.EntityFrameworkCore.PostgreSQL`, which is not enough for a direct reference):

```xml
<PackageVersion Include="Npgsql" Version="10.0.0" />
```

- [ ] **Step 2: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Tenancy/AppRoleConnectionStringTests.cs`:

```csharp
using Shouldly;
using Npgsql;
using PeakPower.Infrastructure.Web.Tenancy;
using Xunit;

namespace PeakPower.Integration.Tests.Tenancy;

public sealed class AppRoleConnectionStringTests
{
    [Fact]
    public void swaps_the_login_role_and_leaves_host_and_database_alone()
    {
        const string aspireConnectionString =
            "Host=localhost;Port=51234;Database=peakpower;Username=postgres;Password=supersecret";

        var rewritten = AppRoleConnectionString.For(
            aspireConnectionString, "peakpower_app", "dev_only_app_password");

        var parsed = new NpgsqlConnectionStringBuilder(rewritten);
        parsed.Host.ShouldBe("localhost");
        parsed.Port.ShouldBe(51234);
        parsed.Database.ShouldBe("peakpower");
        parsed.Username.ShouldBe("peakpower_app");
        parsed.Password.ShouldBe("dev_only_app_password");
    }

    [Fact]
    public void rejects_an_empty_role_rather_than_silently_connecting_as_the_owner()
    {
        var act = () => AppRoleConnectionString.For(
            "Host=localhost;Database=peakpower;Username=postgres;Password=x", "  ", "p");

        Should.Throw<ArgumentException>(act).Message.ShouldContain("role");
    }
}
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~AppRoleConnectionStringTests"`
Expected: FAIL — `error CS0103: The name 'AppRoleConnectionString' does not exist in the current context`.

- [ ] **Step 4: Write the connection-string helper and the middleware**

Create `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/AppRoleConnectionString.cs`:

```csharp
using Npgsql;

namespace PeakPower.Infrastructure.Web.Tenancy;

/// <summary>
/// Aspire hands every consumer the owning connection string. Row-level security does not apply
/// to a table's owner, so an API that used it verbatim would silently have no tenancy at all.
/// Each host rewrites it onto its own non-owner login role before it builds a DbContext.
/// </summary>
public static class AppRoleConnectionString
{
    public static string For(string baseConnectionString, string role, string password)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(baseConnectionString);

        if (string.IsNullOrWhiteSpace(role))
        {
            throw new ArgumentException(
                "A database role is required; connecting as the table owner disables row-level security.",
                nameof(role));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(password);

        return new NpgsqlConnectionStringBuilder(baseConnectionString)
        {
            Username = role,
            Password = password,
        }.ConnectionString;
    }
}
```

Create `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/TenantScopeMiddleware.cs`:

```csharp
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions;
using PeakPower.Persistence;

namespace PeakPower.Infrastructure.Web.Tenancy;

/// <summary>
/// Tenancy, layer 2 of 2. Opens the request's transaction and declares which customer the
/// connection is acting for, so the row-level-security policies written in migration 2 have
/// something to match on. <c>SET LOCAL</c> is transaction-scoped, so the declaration cannot
/// leak onto the next request that borrows the same pooled connection.
/// </summary>
public sealed class TenantScopeMiddleware
{
    public const string CustomerIdSetting = "app.customer_id";

    private readonly RequestDelegate _next;

    public TenantScopeMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context, PeakPowerDbContext db, ICustomerContext tenancy)
    {
        if (!tenancy.IsAuthenticated)
        {
            // The back office. No customer scope to declare; the employee login role holds a
            // policy that permits every row, and the query filters collapse to `true`.
            await _next(context);
            return;
        }

        await using var transaction = await db.Database.BeginTransactionAsync(context.RequestAborted);

        // set_config, not SET LOCAL: SET does not accept a parameter, and concatenating a
        // value into a tenancy control is how injection gets in.
        await db.Database.ExecuteSqlRawAsync(
            "SELECT set_config({0}, {1}, true)",
            [CustomerIdSetting, tenancy.CustomerId.ToString()],
            context.RequestAborted);

        await _next(context);

        if (context.Response.StatusCode >= StatusCodes.Status500InternalServerError)
        {
            await transaction.RollbackAsync(context.RequestAborted);
            return;
        }

        await transaction.CommitAsync(context.RequestAborted);
    }
}

public static class TenantScopeMiddlewareExtensions
{
    /// <summary>
    /// Place this after routing and authentication and before the endpoints, so that
    /// <see cref="ICustomerContext"/> is resolvable and every handler runs inside the scope.
    /// </summary>
    public static IApplicationBuilder UseTenantScope(this IApplicationBuilder app) =>
        app.UseMiddleware<TenantScopeMiddleware>();
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~AppRoleConnectionStringTests"`
Expected: PASS — 2 tests. (The middleware itself is exercised end-to-end by Task 9's probe host.)

- [ ] **Step 6: Run the row-level-security tests deferred from Task 4**

`TenancyFixture` now compiles, so migration 2 can finally be proven end to end.

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~RowLevelSecurityTests"`
Expected: PASS — 5 tests. `peakpower_app` sees one company's rows with `app.customer_id` set and
none with it unset; `peakpower_employee` sees both.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Infrastructure.Web \
  Directory.Packages.props \
  tests/PeakPower.Integration.Tests/Tenancy/AppRoleConnectionStringTests.cs
git commit -m "feat(tenancy): issue SET LOCAL app.customer_id per request and scope hosts to a login role"
```

---

### Task 6: 404-not-403, the enum wire format, and the boundary validation filter

`[F13-R19]` says a cross-tenant read returns **404, never 403**. A 403 is an admission that the
object exists — it turns any endpoint into an existence oracle for another company's data.

The way to make that structural rather than a matter of discipline is to route every "I looked
and did not find it" through one type that has **no 403 member at all**, and to make its 404 body
a constant with no identifier and no discriminator in it. Then a row filtered away by tenancy and
a row that never existed produce byte-identical responses, and no amount of careless coding can
tell them apart. Task 8 adds the compiled-IL check that nobody reintroduces a 403 elsewhere.

The validation filter is here too because it shares the problem-details plumbing.

`EnumWireFormat` is here for the same reason — it is a property of the wire, shared by both APIs.
Shared contract §4 makes the **database** spelling of every enum normative and §5.2 extends that
to JSON: `ACTIVE`, never `"Active"`. `PeakPower.Contracts` references nothing, so its DTOs carry
`string`, and the PascalCase CLR name must be converted somewhere. Doing it with `.ToString()` at
each mapping site is how the two APIs end up disagreeing with each other; doing it once here, with
the same `JsonNamingPolicy` the hosts hand to `JsonStringEnumConverter`, means the mappers, the
validators' allowed-value lists and any future enum-typed property all produce one spelling.

**Files:**
- Create: `src/Infrastructure/PeakPower.Infrastructure.Web/Http/ApiResults.cs`
- Create: `src/Infrastructure/PeakPower.Infrastructure.Web/Http/EnumWireFormat.cs`
- Create: `src/Infrastructure/PeakPower.Infrastructure.Web/Http/ValidationFilter.cs`
- Test: `tests/PeakPower.Integration.Tests/Tenancy/ApiResultsTests.cs`
- Test: `tests/PeakPower.Integration.Tests/Tenancy/EnumWireFormatTests.cs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `public static class ApiResults` with `IResult Found<T>(T? value) where T : class`, `IResult NotFound()`, `IResult InvalidRequest(string property, string error)`, `IResult Conflict(string detail)`
  - constants `ApiResults.NotFoundType = "https://peakpower.dev/problems/not-found"`, `NotFoundTitle = "Not found"`, `NotFoundDetail = "The requested resource does not exist."`, `ValidationType = "https://peakpower.dev/problems/validation"`, `ValidationTitle = "The request is not valid."`, `ConflictType = "https://peakpower.dev/problems/conflict"`, `ConflictTitle = "The request conflicts with the current state."`
  - `public static class EnumWireFormat` — `JsonNamingPolicy Naming`, `JsonStringEnumConverter Converter`, `string ToWire<TEnum>(TEnum value)`, `bool TryParse<TEnum>(string? wire, out TEnum value)`, `TEnum Parse<TEnum>(string wire)`, `string[] Names<TEnum>()`, all `where TEnum : struct, Enum`
  - `public sealed class ValidationFilter<TRequest> : IEndpointFilter where TRequest : class`
  - `public static class ValidationFilterExtensions` — `public static RouteHandlerBuilder Validate<TRequest>(this RouteHandlerBuilder builder) where TRequest : class`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Tenancy/ApiResultsTests.cs`:

```csharp
using System.Reflection;
using System.Text.Json;
using Shouldly;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Infrastructure.Web.Http;
using Xunit;

namespace PeakPower.Integration.Tests.Tenancy;

public sealed class ApiResultsTests
{
    // IResult.ExecuteAsync resolves ILoggerFactory and IProblemDetailsService from the request
    // services, so this needs a real container rather than a stub that returns null.
    private static readonly IServiceProvider Services = new ServiceCollection()
        .AddLogging()
        .AddProblemDetails()
        .BuildServiceProvider();

    private static async Task<(int Status, string Body)> ExecuteAsync(IResult result)
    {
        var httpContext = new DefaultHttpContext { RequestServices = Services };
        using var body = new MemoryStream();
        httpContext.Response.Body = body;

        await result.ExecuteAsync(httpContext);

        body.Position = 0;
        using var reader = new StreamReader(body);
        return (httpContext.Response.StatusCode, await reader.ReadToEndAsync());
    }

    [Fact]
    public async Task a_missing_row_and_a_filtered_away_row_produce_byte_identical_bodies()
    {
        var missing = await ExecuteAsync(ApiResults.Found<string>(null));
        var filteredAway = await ExecuteAsync(ApiResults.NotFound());

        missing.Status.ShouldBe(StatusCodes.Status404NotFound);
        filteredAway.Status.ShouldBe(StatusCodes.Status404NotFound);
        missing.Body.ShouldBe(filteredAway.Body,
            "[F13-R19] a 404 must never reveal whether the object exists for someone else");
    }

    [Fact]
    public async Task the_not_found_body_carries_no_identifier()
    {
        var (_, body) = await ExecuteAsync(ApiResults.NotFound());

        using var document = JsonDocument.Parse(body);
        document.RootElement.GetProperty("status").GetInt32().ShouldBe(404);
        document.RootElement.GetProperty("title").GetString().ShouldBe(ApiResults.NotFoundTitle);
        document.RootElement.GetProperty("detail").GetString().ShouldBe(ApiResults.NotFoundDetail);
    }

    [Fact]
    public async Task a_present_value_is_returned_as_two_hundred()
    {
        var (status, body) = await ExecuteAsync(ApiResults.Found("payload"));

        status.ShouldBe(StatusCodes.Status200OK);
        body.ShouldContain("payload");
    }

    [Fact]
    public void the_result_helper_offers_no_way_to_produce_a_forbidden()
    {
        var members = typeof(ApiResults)
            .GetMethods(BindingFlags.Public | BindingFlags.Static)
            .Select(method => method.Name)
            .ToArray();

        members.ShouldNotContain(name => name.Contains("Forbid", StringComparison.OrdinalIgnoreCase));
        members.ShouldNotContain(name => name.Contains("Denied", StringComparison.OrdinalIgnoreCase));
    }
}
```

Create `tests/PeakPower.Integration.Tests/Tenancy/EnumWireFormatTests.cs`:

```csharp
using System.Text.Json;
using Shouldly;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Web.Http;
using Xunit;

namespace PeakPower.Integration.Tests.Tenancy;

public sealed class EnumWireFormatTests
{
    [Theory]
    [InlineData(AccountStatus.PendingApproval, "PENDING_APPROVAL")]
    [InlineData(AccountStatus.Active, "ACTIVE")]
    [InlineData(AccountStatus.Deactivated, "DEACTIVATED")]
    public void an_enum_goes_onto_the_wire_in_the_database_spelling(AccountStatus status, string wire)
    {
        EnumWireFormat.ToWire(status).ShouldBe(wire,
            "shared contract §4 makes the database spelling normative and §5.2 extends it to JSON");
    }

    [Fact]
    public void a_multi_word_source_keeps_its_underscore()
    {
        EnumWireFormat.ToWire(ProductionExpectationSource.CustomerDeclared)
            .ShouldBe("CUSTOMER_DECLARED");
        EnumWireFormat.ToWire(ProductionExpectationSource.GridOperator)
            .ShouldBe("GRID_OPERATOR");
    }

    [Fact]
    public void the_wire_spelling_round_trips_and_pascal_case_is_rejected()
    {
        EnumWireFormat.TryParse<CustomerStatus>("SUSPENDED", out var parsed).ShouldBeTrue();
        parsed.ShouldBe(CustomerStatus.Suspended);

        EnumWireFormat.TryParse<CustomerStatus>("Suspended", out _).ShouldBeFalse(
            "accepting PascalCase on the way in is how the two spellings survive side by side");
    }

    [Fact]
    public void the_names_helper_lists_every_value_in_wire_spelling()
    {
        EnumWireFormat.Names<ProductionExpectation>()
            .ShouldBe(new[] { "UNKNOWN", "NEVER", "EXPECTED" });
    }

    [Fact]
    public void the_shared_converter_serialises_an_enum_typed_property_the_same_way()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(EnumWireFormat.Converter);

        JsonSerializer.Serialize(AccountStatus.PendingApproval, options)
            .ShouldBe("\"PENDING_APPROVAL\"",
                "the mappers and the serializer must never disagree about one enum");
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ApiResultsTests|FullyQualifiedName~EnumWireFormatTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'ApiResults' could not be found`.

- [ ] **Step 3: Write the result mapping, the enum wire format and the validation filter**

Create `src/Infrastructure/PeakPower.Infrastructure.Web/Http/ApiResults.cs`:

```csharp
using Microsoft.AspNetCore.Http;

namespace PeakPower.Infrastructure.Web.Http;

/// <summary>
/// The one place a lookup turns into an HTTP response.
/// <para>
/// It has no <c>Forbidden</c>, and it never will. <c>[F13-R19]</c>: a cross-tenant read returns
/// 404, never 403, because a 403 confirms the object exists. The 404 body is a constant — no
/// identifier, no reason, no discriminator — so "filtered away by tenancy" and "never existed"
/// are byte-identical to the caller. That property is what makes this mapping safe by
/// construction rather than by care.
/// </para>
/// </summary>
public static class ApiResults
{
    public const string NotFoundType = "https://peakpower.dev/problems/not-found";
    public const string NotFoundTitle = "Not found";
    public const string NotFoundDetail = "The requested resource does not exist.";

    public const string ValidationType = "https://peakpower.dev/problems/validation";
    public const string ValidationTitle = "The request is not valid.";

    public const string ConflictType = "https://peakpower.dev/problems/conflict";
    public const string ConflictTitle = "The request conflicts with the current state.";

    /// <summary>
    /// 200 with the value, or the constant 404. Because the caller's query ran through the
    /// global query filter, a row belonging to another customer arrives here as null and is
    /// indistinguishable from a row that was never inserted.
    /// </summary>
    public static IResult Found<T>(T? value)
        where T : class
        => value is null ? NotFound() : TypedResults.Ok(value);

    public static IResult NotFound() =>
        TypedResults.Problem(
            detail: NotFoundDetail,
            statusCode: StatusCodes.Status404NotFound,
            title: NotFoundTitle,
            type: NotFoundType);

    public static IResult InvalidRequest(string property, string error) =>
        TypedResults.ValidationProblem(
            new Dictionary<string, string[]> { [property] = [error] },
            statusCode: StatusCodes.Status400BadRequest,
            title: ValidationTitle,
            type: ValidationType);

    public static IResult Conflict(string detail) =>
        TypedResults.Problem(
            detail: detail,
            statusCode: StatusCodes.Status409Conflict,
            title: ConflictTitle,
            type: ConflictType);
}
```

Create `src/Infrastructure/PeakPower.Infrastructure.Web/Http/EnumWireFormat.cs`:

```csharp
using System.Collections.Frozen;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PeakPower.Infrastructure.Web.Http;

/// <summary>
/// The single enum spelling both APIs put on the wire, shared contract §5.2.
/// <para>
/// <see cref="JsonNamingPolicy.SnakeCaseUpper"/> turns <c>PendingApproval</c> into
/// <c>PENDING_APPROVAL</c>, which is exactly the database spelling shared contract §4 makes
/// normative — so a value read out of PostgreSQL, a value serialised by
/// <see cref="Converter"/> and a value written by a mapper are all the same string. Nothing in
/// either host may call <c>.ToString()</c> on an enum destined for JSON: that is the one call
/// that reintroduces PascalCase.
/// </para>
/// <para>
/// Parsing is deliberately strict and case-sensitive. Accepting <c>"Active"</c> as well as
/// <c>"ACTIVE"</c> would let a client keep using the wrong spelling indefinitely, and the two
/// would drift apart unnoticed.
/// </para>
/// </summary>
public static class EnumWireFormat
{
    public static readonly JsonNamingPolicy Naming = JsonNamingPolicy.SnakeCaseUpper;

    /// <summary>Register this on both hosts' JSON options; do not construct a second one.</summary>
    public static readonly JsonStringEnumConverter Converter = new(Naming);

    private static class Map<TEnum>
        where TEnum : struct, Enum
    {
        public static readonly string[] Wire =
            Enum.GetNames<TEnum>().Select(Naming.ConvertName).ToArray();

        public static readonly FrozenDictionary<string, TEnum> ByWire =
            Enum.GetValues<TEnum>()
                .Select((value, index) => (Wire[index], value))
                .ToFrozenDictionary(pair => pair.Item1, pair => pair.value, StringComparer.Ordinal);
    }

    public static string ToWire<TEnum>(TEnum value)
        where TEnum : struct, Enum
        => Naming.ConvertName(value.ToString());

    public static bool TryParse<TEnum>(string? wire, out TEnum value)
        where TEnum : struct, Enum
    {
        if (wire is not null && Map<TEnum>.ByWire.TryGetValue(wire, out value))
        {
            return true;
        }

        value = default;
        return false;
    }

    /// <summary>
    /// For call sites the boundary validator has already checked. An unknown value here is a
    /// bug in the validator, not a bad request, so it throws rather than guessing.
    /// </summary>
    public static TEnum Parse<TEnum>(string wire)
        where TEnum : struct, Enum
        => TryParse<TEnum>(wire, out var value)
            ? value
            : throw new ArgumentOutOfRangeException(
                nameof(wire),
                wire,
                $"'{wire}' is not one of: {string.Join(", ", Names<TEnum>())}.");

    /// <summary>Every value of the enum, in wire spelling and declaration order.</summary>
    public static string[] Names<TEnum>()
        where TEnum : struct, Enum
        => [.. Map<TEnum>.Wire];
}
```

Create `src/Infrastructure/PeakPower.Infrastructure.Web/Http/ValidationFilter.cs`:

```csharp
using FluentValidation;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace PeakPower.Infrastructure.Web.Http;

/// <summary>
/// FluentValidation at the HTTP boundary. Failures become an RFC 7807
/// <c>application/problem+json</c> validation problem, so the shape of a bad request is the same
/// on every endpoint in both APIs.
/// </summary>
public sealed class ValidationFilter<TRequest> : IEndpointFilter
    where TRequest : class
{
    private readonly IValidator<TRequest> _validator;

    public ValidationFilter(IValidator<TRequest> validator) => _validator = validator;

    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        var request = context.Arguments.OfType<TRequest>().FirstOrDefault();
        if (request is null)
        {
            return await next(context);
        }

        var result = await _validator.ValidateAsync(request, context.HttpContext.RequestAborted);
        if (result.IsValid)
        {
            return await next(context);
        }

        var errors = result.Errors
            .GroupBy(failure => failure.PropertyName, StringComparer.Ordinal)
            .ToDictionary(
                group => group.Key,
                group => group.Select(failure => failure.ErrorMessage).ToArray(),
                StringComparer.Ordinal);

        return TypedResults.ValidationProblem(
            errors,
            statusCode: StatusCodes.Status400BadRequest,
            title: ApiResults.ValidationTitle,
            type: ApiResults.ValidationType);
    }
}

public static class ValidationFilterExtensions
{
    public static RouteHandlerBuilder Validate<TRequest>(this RouteHandlerBuilder builder)
        where TRequest : class
        => builder
            .AddEndpointFilter<ValidationFilter<TRequest>>()
            .ProducesValidationProblem();
}
```

Add FluentValidation to `src/Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj`:

```xml
<PackageReference Include="FluentValidation" />
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ApiResultsTests|FullyQualifiedName~EnumWireFormatTests"`
Expected: PASS — 11 tests (4 result-mapping, 7 enum wire format including the three theory cases).

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Infrastructure.Web \
  tests/PeakPower.Integration.Tests/Tenancy/ApiResultsTests.cs \
  tests/PeakPower.Integration.Tests/Tenancy/EnumWireFormatTests.cs
git commit -m "feat(api): add the 404-not-403 result mapping, the SCREAMING_SNAKE enum wire format and the boundary validation filter [F13-R19]"
```

---
### Task 7: Architecture fact 4 — nobody calls `IgnoreQueryFilters()`

NetArchTest reasons about types and their dependencies; it cannot see inside a method body. But
`IgnoreQueryFilters()` is a *call*, so the check has to read compiled IL. Mono.Cecil — which
NetArchTest itself is built on — does that in about thirty lines, and the result is exact: no
regular expression over source, no false positive from a comment, no false negative from a
`using` alias.

**Files:**
- Create: `tests/PeakPower.Architecture.Tests/IlScanner.cs`
- Create: `tests/PeakPower.Architecture.Tests/TenancyArchitectureTests.cs`
- Modify: `tests/PeakPower.Architecture.Tests/PeakPower.Architecture.Tests.csproj`

**Interfaces:**
- Consumes: `PeakPowerDbContext` (Task 3), `ApiResults` (Task 6).
- Produces:
  - `internal static class IlScanner` — `IReadOnlyList<string> FindCalls(IEnumerable<Assembly> assemblies, string declaringTypeSuffix, string methodName)`, `IReadOnlyList<string> FindStringLiteral(IEnumerable<Assembly> assemblies, string literal)`, `IReadOnlyList<Assembly> ProductionAssemblies()`

- [ ] **Step 1: Reference every production assembly from the architecture test project**

Add to `tests/PeakPower.Architecture.Tests/PeakPower.Architecture.Tests.csproj`:

```xml
<ItemGroup>
  <PackageReference Include="Mono.Cecil" />
</ItemGroup>

<ItemGroup>
  <ProjectReference Include="../../src/Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj" />
</ItemGroup>
```

Plan 1 already references `PeakPower.Domain`, `PeakPower.Application` and `PeakPower.Persistence`
from this project. `PeakPower.Api.Employee` is added in Task 11; until then `ProductionAssemblies()`
below simply will not find it, and the scan still runs over everything that exists.

- [ ] **Step 2: Write the failing test**

Create `tests/PeakPower.Architecture.Tests/TenancyArchitectureTests.cs`:

```csharp
using Shouldly;
using Xunit;

namespace PeakPower.Architecture.Tests;

public sealed class TenancyArchitectureTests
{
    /// <summary>
    /// Architecture fact 4. IgnoreQueryFilters() removes the global query filter for one query.
    /// There is no legitimate use of it in this codebase: the back office already sees every row
    /// because its ICustomerContext is never authenticated, so a call here means somebody is
    /// stepping around tenancy rather than through it.
    /// </summary>
    [Fact]
    public void no_type_calls_ignore_query_filters()
    {
        var offenders = IlScanner.FindCalls(
            IlScanner.ProductionAssemblies(),
            declaringTypeSuffix: "EntityFrameworkQueryableExtensions",
            methodName: "IgnoreQueryFilters");

        offenders.ShouldBeEmpty(
            "the global query filter is the default-correct half of tenancy; " +
            "turning it off is how a cross-tenant read gets shipped");
    }

    /// <summary>
    /// [F13-R19] hardened. A 403 admits that the object exists. Everything that fails to find a
    /// row goes through ApiResults.NotFound(), which has no 403 path.
    /// </summary>
    [Fact]
    public void no_type_produces_a_forbidden_response()
    {
        var assemblies = IlScanner.ProductionAssemblies();

        var forbidCalls = IlScanner.FindCalls(assemblies, "Results", "Forbid")
            .Concat(IlScanner.FindCalls(assemblies, "TypedResults", "Forbid"))
            .Concat(IlScanner.FindCalls(assemblies, "HttpContext", "ForbidAsync"))
            .ToArray();

        forbidCalls.ShouldBeEmpty(
            "[F13-R19] a cross-tenant read returns 404, never 403");
    }
}
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Architecture.Tests --filter "FullyQualifiedName~TenancyArchitectureTests"`
Expected: FAIL — `error CS0103: The name 'IlScanner' does not exist in the current context`.

- [ ] **Step 4: Write the IL scanner**

Create `tests/PeakPower.Architecture.Tests/IlScanner.cs`:

```csharp
using System.Reflection;
using Mono.Cecil;
using Mono.Cecil.Cil;

namespace PeakPower.Architecture.Tests;

/// <summary>
/// NetArchTest answers questions about types and their dependencies. Some of the rules this
/// codebase needs are about <em>calls</em> and <em>literals</em>, which only exist inside method
/// bodies. Mono.Cecil reads the compiled IL, so these checks are exact rather than textual.
/// </summary>
internal static class IlScanner
{
    /// <summary>
    /// The eleven source projects of shared contract §3.1, minus the AppHost, which is a
    /// build-time composition model rather than a running assembly. Keep this list complete:
    /// an assembly that is missing here is silently exempt from every fact below. When a later
    /// plan adds a source project, it adds the name here in the same commit.
    /// </summary>
    private static readonly string[] ProductionAssemblyNames =
    [
        "PeakPower.Domain",
        "PeakPower.Application",
        "PeakPower.Contracts",
        "PeakPower.Persistence",
        "PeakPower.Infrastructure.Time",
        "PeakPower.Infrastructure.Web",
        "PeakPower.Infrastructure.Identity",
        "PeakPower.Infrastructure.Email",
        "PeakPower.ServiceDefaults",
        "PeakPower.Migrator",
        "PeakPower.Api.Employee",
        "PeakPower.Api.Customer",
    ];

    /// <summary>
    /// Every production assembly that has actually been built into the test output directory.
    /// Assemblies that a later plan adds are simply absent until they exist.
    /// </summary>
    public static IReadOnlyList<Assembly> ProductionAssemblies()
    {
        var directory = AppContext.BaseDirectory;
        var loaded = new List<Assembly>();

        foreach (var name in ProductionAssemblyNames)
        {
            var path = Path.Combine(directory, name + ".dll");
            if (File.Exists(path))
            {
                loaded.Add(Assembly.LoadFrom(path));
            }
        }

        if (loaded.Count == 0)
        {
            throw new InvalidOperationException(
                $"No production assemblies found in {directory}. The architecture test project " +
                "must reference every project it is asked to police.");
        }

        return loaded;
    }

    /// <summary>
    /// Returns "Namespace.Type.Method" for every call site invoking
    /// <paramref name="methodName"/> on a type whose full name ends with
    /// <paramref name="declaringTypeSuffix"/>.
    /// </summary>
    public static IReadOnlyList<string> FindCalls(
        IEnumerable<Assembly> assemblies,
        string declaringTypeSuffix,
        string methodName)
    {
        var offenders = new List<string>();

        foreach (var assembly in assemblies)
        {
            using var module = ModuleDefinition.ReadModule(assembly.Location);

            foreach (var type in module.GetTypes())
            {
                foreach (var method in type.Methods)
                {
                    if (!method.HasBody)
                    {
                        continue;
                    }

                    foreach (var instruction in method.Body.Instructions)
                    {
                        if (instruction.OpCode.Code is not (Code.Call or Code.Callvirt))
                        {
                            continue;
                        }

                        if (instruction.Operand is not MethodReference called)
                        {
                            continue;
                        }

                        if (!string.Equals(called.Name, methodName, StringComparison.Ordinal))
                        {
                            continue;
                        }

                        if (!called.DeclaringType.FullName.EndsWith(declaringTypeSuffix, StringComparison.Ordinal))
                        {
                            continue;
                        }

                        offenders.Add($"{type.FullName}.{method.Name}");
                    }
                }
            }
        }

        return offenders.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
    }

    /// <summary>
    /// Returns "Namespace.Type.Method" for every method body that loads
    /// <paramref name="literal"/> as a string constant.
    /// </summary>
    public static IReadOnlyList<string> FindStringLiteral(
        IEnumerable<Assembly> assemblies,
        string literal)
    {
        var offenders = new List<string>();

        foreach (var assembly in assemblies)
        {
            using var module = ModuleDefinition.ReadModule(assembly.Location);

            foreach (var type in module.GetTypes())
            {
                foreach (var method in type.Methods)
                {
                    if (!method.HasBody)
                    {
                        continue;
                    }

                    foreach (var instruction in method.Body.Instructions)
                    {
                        if (instruction.OpCode.Code is Code.Ldstr &&
                            instruction.Operand is string value &&
                            string.Equals(value, literal, StringComparison.Ordinal))
                        {
                            offenders.Add($"{type.FullName}.{method.Name}");
                        }
                    }
                }
            }
        }

        return offenders.Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray();
    }
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Architecture.Tests --filter "FullyQualifiedName~TenancyArchitectureTests"`
Expected: PASS — 2 tests.

- [ ] **Step 6: Prove the test has teeth**

Temporarily add this method to `PeakPowerDbContext`:

```csharp
    // TEMPORARY — delete after watching the architecture test fail.
    public IQueryable<Domain.Customers.MeteringPoint> EveryTenantsMeteringPoints() =>
        MeteringPoints.IgnoreQueryFilters();
```

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Architecture.Tests --filter "FullyQualifiedName~no_type_calls_ignore_query_filters"`
Expected: FAIL with `Expected offenders to be empty, but found {"PeakPower.Persistence.PeakPowerDbContext.EveryTenantsMeteringPoints"}`.

Then delete the temporary method and re-run to confirm PASS. Do not commit the temporary method.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Architecture.Tests
git commit -m "test(arch): ban IgnoreQueryFilters() and any 403 response in compiled IL"
```

---

### Task 8: Architecture fact 6 — only the context-provider assembly reads a customer identifier from `HttpContext`

`[F13]` business rule 2 says that reading a customer identifier from a route, query, body or
header for authorisation is a defect. Design §10 proposes hardening that from advice into a test,
"since this slice is the one where it would be tempting" — the development provider does exactly
that, and once one class does it, the next one looks reasonable.

Shared contract §13 states fact 6 as its **mechanisms**, not as intent, and that is deliberate:
"reads a customer identifier from `HttpContext`" is unenforceable, because a minimal-API handler
may legitimately take an `HttpContext`. Banning the ways a customer identifier can actually arrive
is enforceable and has the same effect. Encoded three ways, because each alone leaks:

1. **Dependency ban.** No type outside `PeakPower.Infrastructure.Web` may depend on `HttpContext`
   or `IHttpContextAccessor` at all. Minimal API handlers bind their parameters, so no endpoint
   needs `HttpContext` to do its job.
2. **Claim-read ban.** No type outside `PeakPower.Infrastructure.Web` may *read* a claim off a
   `ClaimsPrincipal` or a `ClaimsIdentity`. This is a call-site ban rather than a dependency ban
   on purpose: Plan 5's token issuer, in `PeakPower.Infrastructure.Identity`, legitimately
   **constructs** a `ClaimsIdentity` to sign, and banning the type outright would forbid that
   while missing the thing that actually matters.
3. **Literal ban.** No type outside `PeakPower.Infrastructure.Web` may contain the string
   `X-PeakPower-Customer-Id` or the claim name `customer_id`. That catches the case where someone
   reads the header through something other than `HttpContext` — a delegating handler, an
   `IHeaderDictionary` passed in, an `HttpRequest` extension.

**Files:**
- Modify: `tests/PeakPower.Architecture.Tests/TenancyArchitectureTests.cs`

**Interfaces:**
- Consumes: `IlScanner` (Task 7); `DevelopmentCustomerContext.CustomerIdHeader` (Task 1).
- Produces: nothing consumed by later tasks. Plan 5 must keep all three arms green when it adds
  the token-backed `ICustomerContext` — which means that class, its session middleware and the
  `pp_refresh` cookie writer live in `PeakPower.Infrastructure.Web`, not in
  `PeakPower.Api.Customer`. Shared contract §6 says so in as many words: "Do NOT put a
  provider inside an API host."

- [ ] **Step 1: Write the failing test**

Append these two tests to the `TenancyArchitectureTests` class in
`tests/PeakPower.Architecture.Tests/TenancyArchitectureTests.cs`, and add the two `using`
directives at the top of the file: `using System.Reflection;` and `using NetArchTest.Rules;`.

```csharp
    /// <summary>
    /// Architecture fact 6, arm one. PeakPower.Infrastructure.Web is the context-provider
    /// assembly; it is the only one that gets to know HTTP exists.
    /// </summary>
    [Fact]
    public void no_type_outside_the_context_provider_assembly_depends_on_http_context()
    {
        var policed = IlScanner.ProductionAssemblies()
            .Where(assembly => assembly.GetName().Name != "PeakPower.Infrastructure.Web")
            .ToArray();

        var result = Types.InAssemblies(policed)
            .That()
            .DoNotResideInNamespaceStartingWith("PeakPower.Infrastructure.Web")
            .ShouldNot()
            .HaveDependencyOnAny(
                "Microsoft.AspNetCore.Http.HttpContext",
                "Microsoft.AspNetCore.Http.IHttpContextAccessor",
                "Microsoft.AspNetCore.Http.HttpContextAccessor")
            .GetResult();

        result.IsSuccessful.ShouldBeTrue(
            "[F13] business rule 2 — only the context-provider assembly may touch HttpContext. " +
            "Offenders: " + string.Join(", ", result.FailingTypeNames ?? []));
    }

    /// <summary>
    /// Architecture fact 6, arm two. A bearer token arrives as a ClaimsPrincipal rather than as
    /// a header, so the dependency ban above does not see it. Reading a claim is banned by call
    /// site, not by type: Plan 5's token issuer builds a ClaimsIdentity to sign, which is
    /// writing, and must stay legal in PeakPower.Infrastructure.Identity.
    /// </summary>
    [Fact]
    public void no_type_outside_the_context_provider_assembly_reads_a_claim()
    {
        var policed = IlScanner.ProductionAssemblies()
            .Where(assembly => assembly.GetName().Name != "PeakPower.Infrastructure.Web")
            .ToArray();

        string[] readers = ["FindFirst", "FindFirstValue", "FindAll", "HasClaim", "get_Claims"];

        var offenders = readers
            .SelectMany(reader => IlScanner.FindCalls(policed, "ClaimsPrincipal", reader)
                .Concat(IlScanner.FindCalls(policed, "ClaimsIdentity", reader)))
            .ToArray();

        offenders.ShouldBeEmpty(
            "a customer identifier that arrives in a token is still a customer identifier; " +
            "ICustomerContext is the one seam allowed to read it");
    }

    /// <summary>
    /// Architecture fact 6, arm three. The two bans above miss code that reads the header
    /// through some other handle, so ban the identifiers themselves as well.
    /// </summary>
    [Theory]
    [InlineData("X-PeakPower-Customer-Id")]
    [InlineData("customer_id")]
    public void no_type_outside_the_context_provider_assembly_names_a_customer_identifier(string literal)
    {
        var policed = IlScanner.ProductionAssemblies()
            .Where(assembly => assembly.GetName().Name != "PeakPower.Infrastructure.Web")
            .ToArray();

        var offenders = IlScanner.FindStringLiteral(policed, literal);

        offenders.ShouldBeEmpty(
            $"'{literal}' is how a request declares its customer. Reading it anywhere but the " +
            "context-provider assembly bypasses ICustomerContext, which is the whole seam.");
    }
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Architecture.Tests --filter "FullyQualifiedName~TenancyArchitectureTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'Types' could not be found` if
`NetArchTest.Rules` is not yet referenced by the project.

- [ ] **Step 3: Make the tests pass**

Two possible causes, and both are real fixes rather than test edits:

1. `NetArchTest.Rules` is missing from `tests/PeakPower.Architecture.Tests/PeakPower.Architecture.Tests.csproj`. Add `<PackageReference Include="NetArchTest.Rules" />`, and `<PackageVersion Include="NetArchTest.Rules" Version="1.3.2" />` to `Directory.Packages.props` if Plan 1 did not add it.
2. A production type outside `PeakPower.Infrastructure.Web` genuinely touches `HttpContext`. Move it into `PeakPower.Infrastructure.Web`, or rewrite it to take what it needs as a parameter. Do not add an exemption.

At this point in the plan there is no such type, so the expected outcome after fixing the package
reference is that both tests pass with no production change.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Architecture.Tests --filter "FullyQualifiedName~TenancyArchitectureTests"`
Expected: PASS — 6 tests (2 from Task 7, 1 dependency ban, 1 claim-read ban, 2 theory cases).

- [ ] **Step 5: Prove the literal ban has teeth**

Temporarily add this to `src/Core/PeakPower.Application/Abstractions/ICustomerContext.cs`, below
the interface:

```csharp
// TEMPORARY — delete after watching the architecture test fail.
public static class SmuggledClaimNames
{
    public const string CustomerId = "customer_id";
}
```

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Architecture.Tests --filter "FullyQualifiedName~names_a_customer_identifier"`

> A `const string` is inlined at every use site rather than emitted as a `ldstr` in the declaring
> type, so add a use of it in the same file for the check to see it:
> `public static string Read() => SmuggledClaimNames.CustomerId;`

Expected: FAIL naming `PeakPower.Application.Abstractions.SmuggledClaimNames.Read`.

Delete both temporary members and re-run to confirm PASS. Do not commit them.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Architecture.Tests Directory.Packages.props
git commit -m "test(arch): only the context-provider assembly may read a customer identifier [F13]"
```

---
### Task 9: The route-table test

**This is the test the slice is judged on** (design §6, definition of done item 5). Everything
before it is machinery; this is the proof.

The idea: do not write a list of endpoints to check. Ask the running application for its
**endpoint table** — the same `EndpointDataSource` that ASP.NET Core routes against — and check
every entry in it. A hand-written list decays on the first busy sprint; a table-driven test
cannot, because a new endpoint appears in the table the moment it is mapped.

For that to work, "check every entry" has to mean something for entries that are *not* tenant
scoped. So every endpoint declares itself, once, at the point it is mapped:

```csharp
.TenantScoped("MeteringPoint")     // this endpoint serves one customer's data
.BackOffice("reason")              // this endpoint serves PeakPower staff across all customers
.AnonymousEndpoint("reason")       // sign-in, JWKS, the onboarding wizard before signing
```

and the gate fails on any endpoint that declares nothing. **That is the property that makes a new
endpoint unable to escape**: it is not that someone remembers to add a test, it is that the build
goes red until they say which kind of endpoint they just wrote.

The positive arm then runs, per tenant-scoped entry:

| Route shape | Probe | Assertion |
| --- | --- | --- |
| has `{id}` | substitute company B's identifier for the declared resource kind, call as company A | 404, and the body identical to a genuinely-missing 404 |
| no route parameter (a collection) | call as company A | 200, and no company-B identifier anywhere in the body |

Two failure modes are wired in on purpose: a tenant-scoped endpoint naming a resource kind the
fixture has never heard of fails, and a tenant-scoped endpoint with a mutating verb and no
registered sample body fails. Both mean "somebody added an endpoint and the probe cannot reach
it", which is exactly the silence this test exists to break.

**Where it runs today.** The employee API is not tenant-scoped, so it exercises the gate but not
the positive arm — Task 15 covers that. To exercise the positive arm now, this task builds
`TenancyProbeApp`, a host that lives **inside the test project** and composes the real
`PeakPowerDbContext`, the real query filters, the real `TenantScopeMiddleware`, the real
`DevelopmentCustomerContext` and the real `ApiResults`. When Plan 5 creates
`PeakPower.Api.Customer`, it adds a test class that points this same harness at it. Nothing here
gets rewritten.

**Files:**
- Create: `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/TenancyClassification.cs`
- Create: `tests/PeakPower.Integration.Tests/Tenancy/RouteTable.cs`
- Create: `tests/PeakPower.Integration.Tests/Tenancy/TenancyProbeApp.cs`
- Create: `tests/PeakPower.Integration.Tests/Tenancy/RouteTableTenancyTests.cs`
- Modify: `tests/PeakPower.Integration.Tests/Tenancy/TenancyFixture.cs`

**Interfaces:**
- Consumes: `DevelopmentCustomerContext`, `UnscopedCustomerContext` (Task 1); `TenancyStartupGuard` (Task 2); `PeakPowerDbContext` with filters (Task 3); `TenancyFixture`, roles from migration 2 (Task 4); `AppRoleConnectionString`, `TenantScopeMiddleware.UseTenantScope()` (Task 5); `ApiResults` (Task 6).
- Produces:
  - `public enum TenancyScope { TenantScoped, BackOffice, Anonymous }`
  - `public sealed record TenancyClassification(TenancyScope Scope, string ResourceKind, string Reason)`
  - `public static class TenancyEndpointExtensions` — `TBuilder TenantScoped<TBuilder>(this TBuilder builder, string resourceKind)`, `TBuilder BackOffice<TBuilder>(this TBuilder builder, string reason)`, `TBuilder AnonymousEndpoint<TBuilder>(this TBuilder builder, string reason)`, all `where TBuilder : IEndpointConventionBuilder`
  - `public sealed record RouteTableEntry(string HttpMethod, string RoutePattern, TenancyClassification? Classification)`
  - `public static class RouteTable` — `IReadOnlyList<RouteTableEntry> Enumerate(IServiceProvider services)`, `string Substitute(string routePattern, Guid id)`
  - `public sealed class TenancyProbeApp : IAsyncDisposable` — `static Task<TenancyProbeApp> StartAsync(string connectionString)`, `HttpClient Client`, `IServiceProvider Services`, `HttpRequestMessage RequestAs(Guid customerId, string method, string url)`
  - `TenancyFixture.SampleBodies` — `IReadOnlyDictionary<string, string>` keyed by route pattern

> **xUnit version note.** `IAsyncLifetime` returns `ValueTask` in xUnit v3 and `Task` in v2. This
> plan is written for v3. If Plan 1 pinned v2, change the two lifetime methods in
> `TenancyFixture` and `RouteTableTenancyTests` to return `Task` and drop `ValueTask`.

- [ ] **Step 1: Write the endpoint classification metadata**

Create `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/TenancyClassification.cs`:

```csharp
using Microsoft.AspNetCore.Builder;

namespace PeakPower.Infrastructure.Web.Tenancy;

public enum TenancyScope
{
    /// <summary>Serves one customer company's data. The route-table probe attacks these.</summary>
    TenantScoped,

    /// <summary>Serves PeakPower staff across every customer. Deliberately not tenant-scoped.</summary>
    BackOffice,

    /// <summary>Reachable before anyone is known — sign-in, JWKS, the onboarding wizard.</summary>
    Anonymous,
}

/// <summary>
/// Every endpoint declares one of these when it is mapped. The route-table test reads the
/// endpoint table and fails on any endpoint that declared nothing, which is what stops a new
/// endpoint from quietly escaping the tenancy proof.
/// </summary>
/// <param name="Scope">Which kind of endpoint this is.</param>
/// <param name="ResourceKind">
/// For a tenant-scoped endpoint, the name of the thing its route identifies — "Customer",
/// "CustomerAccount", "MeteringPoint". The probe uses it to look up another company's object
/// of that kind. Empty for the other two scopes.
/// </param>
/// <param name="Reason">Why this endpoint is not tenant-scoped. Empty for tenant-scoped.</param>
public sealed record TenancyClassification(TenancyScope Scope, string ResourceKind, string Reason);

public static class TenancyEndpointExtensions
{
    public static TBuilder TenantScoped<TBuilder>(this TBuilder builder, string resourceKind)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(resourceKind);
        return builder.WithMetadata(
            new TenancyClassification(TenancyScope.TenantScoped, resourceKind, string.Empty));
    }

    public static TBuilder BackOffice<TBuilder>(this TBuilder builder, string reason)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);
        return builder.WithMetadata(
            new TenancyClassification(TenancyScope.BackOffice, string.Empty, reason));
    }

    public static TBuilder AnonymousEndpoint<TBuilder>(this TBuilder builder, string reason)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);
        return builder.WithMetadata(
            new TenancyClassification(TenancyScope.Anonymous, string.Empty, reason));
    }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Tenancy/RouteTableTenancyTests.cs`:

```csharp
using System.Net;
using System.Text.Json;
using Shouldly;
using PeakPower.Infrastructure.Web.Tenancy;
using Xunit;

namespace PeakPower.Integration.Tests.Tenancy;

/// <summary>
/// The route-table test. Driven off the registered endpoint table, not a hand-written list, so
/// a new endpoint cannot silently escape it.
/// </summary>
[Collection(nameof(TenancyCollection))]
public sealed class RouteTableTenancyTests : IAsyncLifetime
{
    private readonly TenancyFixture _fixture;
    private TenancyProbeApp _probe = null!;

    public RouteTableTenancyTests(TenancyFixture fixture) => _fixture = fixture;

    public async ValueTask InitializeAsync() =>
        _probe = await TenancyProbeApp.StartAsync(_fixture.CustomerRoleConnectionString);

    public async ValueTask DisposeAsync() => await _probe.DisposeAsync();

    [Fact]
    public void every_registered_endpoint_declares_its_tenancy()
    {
        var undeclared = RouteTable.Enumerate(_probe.Services)
            .Where(entry => entry.Classification is null)
            .Select(entry => entry.ToString())
            .ToArray();

        undeclared.ShouldBeEmpty(
            "every endpoint must say whether it is tenant-scoped, back-office or anonymous, " +
            "by calling .TenantScoped(kind), .BackOffice(reason) or .AnonymousEndpoint(reason) " +
            "where it is mapped. Until it does, the route-table test cannot prove anything " +
            "about it, so the build stays red.");
    }

    [Fact]
    public void every_tenant_scoped_endpoint_can_actually_be_probed()
    {
        var problems = new List<string>();

        foreach (var entry in RouteTable.Enumerate(_probe.Services))
        {
            if (entry.Classification is not { Scope: TenancyScope.TenantScoped } classification)
            {
                continue;
            }

            if (entry.HasRouteParameter &&
                !_fixture.CompanyBIds.ContainsKey(classification.ResourceKind))
            {
                problems.Add(
                    $"{entry} declares resource kind '{classification.ResourceKind}', which the " +
                    "fixture has no company-B object for. Seed one in TenancyFixture.CompanyBIds.");
            }

            if (!string.Equals(entry.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase) &&
                !_fixture.SampleBodies.ContainsKey(entry.RoutePattern))
            {
                problems.Add(
                    $"{entry} is a tenant-scoped mutating endpoint with no sample request body. " +
                    "Register one in TenancyFixture.SampleBodies so the probe can reach the handler.");
            }
        }

        problems.ShouldBeEmpty();
    }

    [Fact]
    public async Task signed_in_as_company_a_every_one_of_company_bs_objects_returns_404()
    {
        var failures = new List<string>();

        foreach (var entry in RouteTable.Enumerate(_probe.Services))
        {
            if (entry.Classification is not { Scope: TenancyScope.TenantScoped } classification ||
                !entry.HasRouteParameter)
            {
                continue;
            }

            var companyBId = _fixture.CompanyBIds[classification.ResourceKind];
            var url = RouteTable.Substitute(entry.RoutePattern, companyBId);

            using var request = _probe.RequestAs(_fixture.CompanyAId, entry.HttpMethod, url);
            if (_fixture.SampleBodies.TryGetValue(entry.RoutePattern, out var body))
            {
                request.Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
            }

            using var response = await _probe.Client.SendAsync(request);

            if (response.StatusCode != HttpStatusCode.NotFound)
            {
                failures.Add($"{entry} returned {(int)response.StatusCode}, expected 404");
            }
        }

        failures.ShouldBeEmpty(
            "[F13-R19] every cross-tenant read returns 404, never 403 and never 200");
    }

    [Fact]
    public async Task signed_in_as_company_a_no_collection_leaks_a_company_b_identifier()
    {
        var failures = new List<string>();
        var companyBIdentifiers = _fixture.CompanyBIds.Values
            .Select(id => id.ToString())
            .Append(_fixture.CompanyBId.ToString())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        foreach (var entry in RouteTable.Enumerate(_probe.Services))
        {
            if (entry.Classification is not { Scope: TenancyScope.TenantScoped } ||
                entry.HasRouteParameter ||
                !string.Equals(entry.HttpMethod, "GET", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            using var request = _probe.RequestAs(_fixture.CompanyAId, entry.HttpMethod, entry.RoutePattern);
            using var response = await _probe.Client.SendAsync(request);
            var payload = await response.Content.ReadAsStringAsync();

            foreach (var identifier in companyBIdentifiers)
            {
                if (payload.Contains(identifier, StringComparison.OrdinalIgnoreCase))
                {
                    failures.Add($"{entry} leaked {identifier}");
                }
            }
        }

        failures.ShouldBeEmpty();
    }

    [Fact]
    public async Task the_cross_tenant_404_is_indistinguishable_from_a_missing_row_404()
    {
        var crossTenantUrl = $"/api/v1/metering-points/{_fixture.CompanyBMeteringPointId}";
        var nonexistentUrl = $"/api/v1/metering-points/{Guid.NewGuid()}";

        using var crossTenantRequest = _probe.RequestAs(_fixture.CompanyAId, "GET", crossTenantUrl);
        using var crossTenantResponse = await _probe.Client.SendAsync(crossTenantRequest);
        var crossTenantBody = await crossTenantResponse.Content.ReadAsStringAsync();

        using var nonexistentRequest = _probe.RequestAs(_fixture.CompanyAId, "GET", nonexistentUrl);
        using var nonexistentResponse = await _probe.Client.SendAsync(nonexistentRequest);
        var nonexistentBody = await nonexistentResponse.Content.ReadAsStringAsync();

        crossTenantResponse.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        nonexistentResponse.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        crossTenantBody.ShouldBe(nonexistentBody,
            "a caller must not be able to tell 'someone else owns this' from 'this never existed'");
    }

    [Fact]
    public async Task company_a_can_still_read_its_own_objects()
    {
        using var request = _probe.RequestAs(
            _fixture.CompanyAId, "GET", $"/api/v1/metering-points/{_fixture.CompanyAMeteringPointId}");
        using var response = await _probe.Client.SendAsync(request);

        response.StatusCode.ShouldBe(HttpStatusCode.OK,
            "a tenancy test that passes because everything returns 404 proves nothing");

        var payload = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(payload);
        document.RootElement.GetProperty("id").GetGuid()
            .ShouldBe(_fixture.CompanyAMeteringPointId);
    }

    [Fact]
    public async Task a_request_with_no_customer_header_sees_nothing_at_all()
    {
        // The query filter collapses to `true` when the context is not authenticated, so this
        // request reaches the database unfiltered. Row-level security is what stops it: no
        // app.customer_id was set, so no row qualifies. This is the defence-in-depth assertion.
        using var response = await _probe.Client.GetAsync("/api/v1/metering-points");
        var payload = await response.Content.ReadAsStringAsync();

        using var document = JsonDocument.Parse(payload);
        document.RootElement.GetArrayLength().ShouldBe(0,
            "an unscoped connection on the customer login role must fail closed");
    }
}
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~RouteTableTenancyTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'RouteTable' could not be found`.

- [ ] **Step 4: Write the route-table harness**

Create `tests/PeakPower.Integration.Tests/Tenancy/RouteTable.cs`:

```csharp
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Infrastructure.Web.Tenancy;

namespace PeakPower.Integration.Tests.Tenancy;

public sealed record RouteTableEntry(
    string HttpMethod,
    string RoutePattern,
    TenancyClassification? Classification)
{
    public bool HasRouteParameter => RoutePattern.Contains('{', StringComparison.Ordinal);

    public override string ToString() => $"{HttpMethod} {RoutePattern}";
}

/// <summary>
/// Reads the application's own endpoint table. This is the same <see cref="EndpointDataSource"/>
/// ASP.NET Core routes against, so nothing that is reachable over HTTP is missing from it.
/// </summary>
public static class RouteTable
{
    /// <summary>
    /// Endpoints the framework maps and whose metadata we do not control. Keep this list short
    /// and visible; every entry is a hole in the proof, so adding one is a decision, not a tidy-up.
    /// </summary>
    public static readonly string[] FrameworkRoutePrefixes =
    [
        "/openapi",
        "/health",
        "/alive",
    ];

    private static readonly Regex RouteParameter =
        new(@"\{[^}]+\}", RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static IReadOnlyList<RouteTableEntry> Enumerate(IServiceProvider services)
    {
        var source = services.GetRequiredService<EndpointDataSource>();
        var entries = new List<RouteTableEntry>();

        foreach (var endpoint in source.Endpoints.OfType<RouteEndpoint>())
        {
            var pattern = "/" + (endpoint.RoutePattern.RawText ?? string.Empty).TrimStart('/');

            if (FrameworkRoutePrefixes.Any(prefix =>
                    pattern.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            var classification = endpoint.Metadata.GetMetadata<TenancyClassification>();
            var methods = endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods
                          ?? ["GET"];

            foreach (var method in methods)
            {
                entries.Add(new RouteTableEntry(method, pattern, classification));
            }
        }

        return entries
            .DistinctBy(entry => entry.ToString(), StringComparer.Ordinal)
            .OrderBy(entry => entry.RoutePattern, StringComparer.Ordinal)
            .ThenBy(entry => entry.HttpMethod, StringComparer.Ordinal)
            .ToArray();
    }

    /// <summary>
    /// Turns "/api/v1/metering-points/{id:guid}" into "/api/v1/metering-points/&lt;id&gt;".
    /// Every tenant-scoped route in this codebase identifies exactly one object, so a single
    /// substitution is enough; a route with two parameters would need the fixture extended,
    /// which is why <c>every_tenant_scoped_endpoint_can_actually_be_probed</c> exists.
    /// </summary>
    public static string Substitute(string routePattern, Guid id) =>
        RouteParameter.Replace(routePattern, id.ToString());
}
```

- [ ] **Step 5: Write the probe host**

Create `tests/PeakPower.Integration.Tests/Tenancy/TenancyProbeApp.cs`:

```csharp
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using PeakPower.Application.Abstractions;
using PeakPower.Infrastructure.Web.Http;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;

namespace PeakPower.Integration.Tests.Tenancy;

/// <summary>
/// A tenant-scoped host built out of the REAL pieces — the real DbContext with its real global
/// query filters, the real TenantScopeMiddleware issuing set_config('app.customer_id', …), the
/// real DevelopmentCustomerContext and the real ApiResults mapping — over a real PostgreSQL 17.
/// <para>
/// It exists because Plan 2 has no customer-facing API of its own: Plan 5 creates
/// PeakPower.Api.Customer, and Plan 6 Task 10 points this same RouteTable harness at that host
/// once its full endpoint set exists. Nothing here changes when it does.
/// </para>
/// </summary>
public sealed class TenancyProbeApp : IAsyncDisposable
{
    private readonly WebApplication _app;

    private TenancyProbeApp(WebApplication app)
    {
        _app = app;
        Client = app.GetTestClient();
    }

    public HttpClient Client { get; }

    public IServiceProvider Services => _app.Services;

    public static async Task<TenancyProbeApp> StartAsync(string connectionString)
    {
        var builder = WebApplication.CreateBuilder();
        builder.Environment.EnvironmentName = Environments.Development;
        builder.WebHost.UseTestServer();

        builder.Services.AddHttpContextAccessor();
        builder.Services.AddScoped<ICustomerContext, DevelopmentCustomerContext>();
        builder.Services.AddProblemDetails();
        builder.Services.AddDbContext<PeakPowerDbContext>(options => options
            .UseNpgsql(connectionString)
            .UseSnakeCaseNamingConvention());

        TenancyStartupGuard.ThrowIfDevelopmentProvidersRegisteredInProduction(
            builder.Services, builder.Environment);

        var app = builder.Build();

        app.UseRouting();
        app.UseTenantScope();

        app.MapGet("/api/v1/metering-points", async (
                PeakPowerDbContext db,
                CancellationToken cancellationToken) =>
            {
                var meteringPoints = await db.MeteringPoints
                    .AsNoTracking()
                    .OrderBy(meteringPoint => meteringPoint.ValidFrom)
                    .Select(meteringPoint => new ProbeMeteringPoint(
                        meteringPoint.Id, meteringPoint.CustomerId))
                    .ToListAsync(cancellationToken);

                return Results.Ok(meteringPoints);
            })
            .TenantScoped("MeteringPointCollection");

        app.MapGet("/api/v1/metering-points/{id:guid}", async (
                Guid id,
                PeakPowerDbContext db,
                CancellationToken cancellationToken) =>
            {
                var meteringPoint = await db.MeteringPoints
                    .AsNoTracking()
                    .Where(candidate => candidate.Id == id)
                    .Select(candidate => new ProbeMeteringPoint(candidate.Id, candidate.CustomerId))
                    .FirstOrDefaultAsync(cancellationToken);

                return ApiResults.Found(meteringPoint);
            })
            .TenantScoped("MeteringPoint");

        app.MapGet("/api/v1/company/{id:guid}", async (
                Guid id,
                PeakPowerDbContext db,
                CancellationToken cancellationToken) =>
            {
                var customer = await db.Customers
                    .AsNoTracking()
                    .Where(candidate => candidate.Id == id)
                    .Select(candidate => new ProbeCustomer(candidate.Id, candidate.LegalName))
                    .FirstOrDefaultAsync(cancellationToken);

                return ApiResults.Found(customer);
            })
            .TenantScoped("Customer");

        app.MapGet("/api/v1/company/accounts/{id:guid}", async (
                Guid id,
                PeakPowerDbContext db,
                CancellationToken cancellationToken) =>
            {
                var account = await db.CustomerAccounts
                    .AsNoTracking()
                    .Where(candidate => candidate.Id == id)
                    .Select(candidate => new ProbeAccount(candidate.Id, candidate.Username))
                    .FirstOrDefaultAsync(cancellationToken);

                return ApiResults.Found(account);
            })
            .TenantScoped("CustomerAccount");

        await app.StartAsync();
        return new TenancyProbeApp(app);
    }

    /// <summary>
    /// Signing in, in this plan: a header. Plan 5 replaces it with a bearer token and the
    /// harness above does not change.
    /// </summary>
    public HttpRequestMessage RequestAs(Guid customerId, string method, string url)
    {
        var request = new HttpRequestMessage(new HttpMethod(method), url);
        request.Headers.TryAddWithoutValidation(
            DevelopmentCustomerContext.CustomerIdHeader, customerId.ToString());
        return request;
    }

    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        await _app.StopAsync();
        await _app.DisposeAsync();
    }

    private sealed record ProbeMeteringPoint(Guid Id, Guid CustomerId);

    private sealed record ProbeCustomer(Guid Id, string LegalName);

    private sealed record ProbeAccount(Guid Id, string Username);
}
```

Add the test-host packages to `tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj`:

```xml
<ItemGroup>
  <PackageReference Include="Microsoft.AspNetCore.TestHost" />
  <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" />
</ItemGroup>
```

- [ ] **Step 6: Add the sample-body registry to the fixture**

Add this property to `TenancyFixture` in
`tests/PeakPower.Integration.Tests/Tenancy/TenancyFixture.cs`, next to `CompanyBIds`:

```csharp
    /// <summary>
    /// A valid JSON body for every tenant-scoped endpoint with a mutating verb, keyed by route
    /// pattern. Without one, the probe's request would be rejected by validation before it ever
    /// reached the tenancy check, and the 404 assertion would be meaningless. Plan 6 adds an
    /// entry here for every PATCH and POST it maps on the customer API.
    /// </summary>
    public IReadOnlyDictionary<string, string> SampleBodies { get; } =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            // Plan 2's probe host maps GET endpoints only, so this starts empty and the
            // "can actually be probed" test guards it from staying empty by accident.
        };
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~RouteTableTenancyTests"`
Expected: PASS — 7 tests. Docker must be running; the fixture starts a `postgres:17` container.

- [ ] **Step 8: Prove the gate has teeth**

Temporarily add an endpoint to `TenancyProbeApp.StartAsync` with **no** classification:

```csharp
        // TEMPORARY — delete after watching the gate fail.
        app.MapGet("/api/v1/undeclared", () => Results.Ok(new { ok = true }));
```

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~every_registered_endpoint_declares_its_tenancy"`
Expected: FAIL with `Expected undeclared to be empty, but found {"GET /api/v1/undeclared"}`.

Then change it to a `.TenantScoped("Sprocket")` endpoint — a resource kind the fixture has never
heard of — and run:

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~every_tenant_scoped_endpoint_can_actually_be_probed"`
Expected: FAIL naming `GET /api/v1/undeclared declares resource kind 'Sprocket'`.

Delete the temporary endpoint and re-run the whole class to confirm PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/TenancyClassification.cs \
  tests/PeakPower.Integration.Tests
git commit -m "test(tenancy): drive the cross-tenant 404 proof off the registered endpoint table"
```

---
### Task 10: `PeakPower.Contracts` — the employee DTOs

The wire types. They are separate from the domain on purpose: the domain has value objects
(`EanCode`, `KvkNumber`) and behaviour, and the wire has strings and no behaviour. Keeping them
apart is what lets the OpenAPI document be stable while the aggregates change shape.

`PeakPower.Contracts` references **nothing** — not the domain, not EF Core. Mapping lives in the
API host (Task 11), which is allowed to know about both.

**Files:**
- Create: `src/Core/PeakPower.Contracts/Employee/AddressDto.cs`
- Create: `src/Core/PeakPower.Contracts/Employee/CustomerDtos.cs`
- Create: `src/Core/PeakPower.Contracts/Employee/AccountDtos.cs`
- Create: `src/Core/PeakPower.Contracts/Employee/MeteringPointDtos.cs`
- Create: `src/Core/PeakPower.Contracts/Employee/BrpDto.cs`
- Test: `tests/PeakPower.Domain.Tests/Contracts/ContractPurityTests.cs`

**Interfaces:**
- Consumes: nothing.
- Produces: every type below, all in namespace `PeakPower.Contracts.Employee`.

> **The list envelope is `CustomerListResponse`, not a generic `PagedResult<T>`.** Plan 4's
> employee portal binds `CustomerListResponse { items, total }` and `CustomerListItemDto` by name
> out of the generated OpenAPI client, and a generic envelope reaches that client as
> `PagedResultOfCustomerSummaryDto` — a name nobody chose and nobody can rely on. The list page
> also renders an account count and a city per row, so both are on the row type. `page` and
> `pageSize` stay query parameters; the response carries the rows and the total only.

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Domain.Tests/Contracts/ContractPurityTests.cs`:

```csharp
using Shouldly;
using PeakPower.Contracts.Employee;
using Xunit;

namespace PeakPower.Domain.Tests.Contracts;

public sealed class ContractPurityTests
{
    [Fact]
    public void the_contracts_assembly_references_no_other_peakpower_assembly()
    {
        var references = typeof(CustomerListItemDto).Assembly
            .GetReferencedAssemblies()
            .Select(name => name.Name!)
            .Where(name => name.StartsWith("PeakPower.", StringComparison.Ordinal))
            .ToArray();

        references.ShouldBeEmpty(
            "wire types must not drag the domain across the boundary; " +
            "mapping belongs in the API host");
    }

    [Fact]
    public void the_customer_list_carries_its_rows_and_the_total_across_every_page()
    {
        var response = new CustomerListResponse(
            [new CustomerListItemDto(
                Guid.NewGuid(), "Zonneweide Beheer B.V.", null, "81000001",
                "ACTIVE", "Rotterdam", AccountCount: 3, MeteringPointCount: 7)],
            Total: 51);

        response.Items.ShouldHaveSingleItem();
        response.Items[0].AccountCount.ShouldBe(3);
        response.Items[0].Status.ShouldBe("ACTIVE",
            "shared contract §5.2 — the wire spelling is the database spelling");
        response.Total.ShouldBe(51,
            "the pager needs the total across every page, not just this one");
    }

    [Fact]
    public void every_employee_request_type_is_a_record_so_it_is_value_compared_in_tests()
    {
        var requestTypes = typeof(CreateCustomerRequest).Assembly
            .GetTypes()
            .Where(type => type.IsClass && type.Name.EndsWith("Request", StringComparison.Ordinal))
            .ToArray();

        requestTypes.ShouldNotBeEmpty();
        requestTypes.ShouldAllBe(
            type => type.GetMethod("<Clone>$", System.Reflection.BindingFlags.Instance
                                                | System.Reflection.BindingFlags.Public
                                                | System.Reflection.BindingFlags.NonPublic) != null,
            "records carry a compiler-generated <Clone>$ method");
    }
}
```

Add a project reference so the domain test project can see the contracts:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet add tests/PeakPower.Domain.Tests/PeakPower.Domain.Tests.csproj reference \
  src/Core/PeakPower.Contracts/PeakPower.Contracts.csproj
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Domain.Tests --filter "FullyQualifiedName~ContractPurityTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'CustomerListItemDto' could not be found`.

- [ ] **Step 3: Write the DTOs**

Create `src/Core/PeakPower.Contracts/Employee/AddressDto.cs`:

```csharp
namespace PeakPower.Contracts.Employee;

/// <summary>A Dutch postal address. Stored as jsonb, carried on the wire as an object.</summary>
public sealed record AddressDto(
    string Street,
    string HouseNumber,
    string? HouseNumberSuffix,
    string PostalCode,
    string City,
    string Country);

/// <summary>The named human PeakPower contacts about this company.</summary>
public sealed record ContactPersonDto(string Name, string Email, string? Phone);
```

Create `src/Core/PeakPower.Contracts/Employee/CustomerDtos.cs`:

```csharp
namespace PeakPower.Contracts.Employee;

/// <summary>One row in the back office's customer list.</summary>
/// <param name="Status">The wire spelling of <c>CustomerStatus</c> — <c>PROSPECT</c>,
/// <c>ACTIVE</c>, <c>SUSPENDED</c> or <c>CLOSED</c>.</param>
/// <param name="City">The billing address's city, which is what the list column shows.</param>
public sealed record CustomerListItemDto(
    Guid Id,
    string LegalName,
    string? TradeName,
    string KvkNumber,
    string Status,
    string City,
    int AccountCount,
    int MeteringPointCount);

/// <summary>
/// The customer list. One page of rows plus the total across every page — enough for the pager.
/// The page number and size are not echoed back: they were the caller's own query parameters.
/// </summary>
public sealed record CustomerListResponse(IReadOnlyList<CustomerListItemDto> Items, int Total);

public sealed record CustomerDetailDto(
    Guid Id,
    string LegalName,
    string? TradeName,
    string KvkNumber,
    string? VatNumber,
    string Status,
    bool FourEyesEnabled,
    AddressDto BillingAddress,
    AddressDto? VisitingAddress,
    ContactPersonDto PrimaryContact,
    string? InternalReference,
    string Locale,
    IReadOnlyList<AccountDto> Accounts,
    IReadOnlyList<MeteringPointDto> MeteringPoints);

public sealed record CreateCustomerRequest(
    string LegalName,
    string? TradeName,
    string KvkNumber,
    string? VatNumber,
    AddressDto BillingAddress,
    AddressDto? VisitingAddress,
    ContactPersonDto PrimaryContact,
    string? InternalReference,
    string Locale);

/// <summary>
/// The KvK number is absent on purpose — it is the company's registration and is never edited.
/// </summary>
public sealed record UpdateCustomerRequest(
    string LegalName,
    string? TradeName,
    string? VatNumber,
    AddressDto BillingAddress,
    AddressDto? VisitingAddress,
    ContactPersonDto PrimaryContact,
    string? InternalReference,
    string Locale,
    string Status);
```

Create `src/Core/PeakPower.Contracts/Employee/AccountDtos.cs`:

```csharp
namespace PeakPower.Contracts.Employee;

/// <summary>
/// One person's login. The password hash is never on the wire, in either direction.
/// </summary>
public sealed record AccountDto(
    Guid Id,
    Guid CustomerId,
    string Username,
    string FirstName,
    string LastName,
    string? JobTitle,
    string Email,
    string? Phone,
    string Status,
    bool IsAdmin,
    DateTimeOffset? LastLoginAt);

public sealed record CreateAccountRequest(
    string Username,
    string FirstName,
    string LastName,
    string? JobTitle,
    string Email,
    string? Phone,
    bool IsAdmin);

/// <summary>The username is absent on purpose — it is immutable <c>[F01-R14]</c>.</summary>
public sealed record UpdateAccountRequest(
    string FirstName,
    string LastName,
    string? JobTitle,
    string Email,
    string? Phone,
    bool IsAdmin);
```

Create `src/Core/PeakPower.Contracts/Employee/MeteringPointDtos.cs`:

```csharp
namespace PeakPower.Contracts.Employee;

/// <param name="Ean">The raw 18 digits.</param>
/// <param name="EanDisplay">The same digits grouped for reading <c>[F01-R31]</c>.</param>
/// <param name="DisplayLabel">The friendly name if there is one, otherwise EanDisplay <c>[F01-R30]</c>.</param>
/// <param name="ValidTo">Exclusive upper bound; null means open-ended.</param>
public sealed record MeteringPointDto(
    Guid Id,
    Guid CustomerId,
    string Ean,
    string EanDisplay,
    string Commodity,
    Guid BrpId,
    string BrpName,
    string ProductionExpectation,
    string? ExpectationSource,
    string? Name,
    string? Description,
    string DisplayLabel,
    string? GridOperator,
    decimal? CapacityKw,
    AddressDto? Address,
    DateOnly ValidFrom,
    DateOnly? ValidTo);

public sealed record AttachMeteringPointRequest(
    string Ean,
    Guid BrpId,
    string ProductionExpectation,
    string? ExpectationSource,
    string? Name,
    string? Description,
    string? GridOperator,
    decimal? CapacityKw,
    AddressDto? Address,
    DateOnly ValidFrom);

/// <summary>The EAN and the customer are absent on purpose — neither is editable in place.</summary>
public sealed record UpdateMeteringPointRequest(
    Guid BrpId,
    string ProductionExpectation,
    string? ExpectationSource,
    string? Name,
    string? Description,
    string? GridOperator,
    decimal? CapacityKw,
    AddressDto? Address);

public sealed record EndDateMeteringPointRequest(DateOnly ValidTo);
```

Create `src/Core/PeakPower.Contracts/Employee/BrpDto.cs`:

```csharp
namespace PeakPower.Contracts.Employee;

/// <summary>
/// A balance responsible party — the party answerable to the grid operator for the imbalance on
/// a connection. Platform reference data, shared by every customer <c>[F12-R49]</c>.
/// </summary>
/// <param name="IsActive">Plan 4's reference-data screen renders active and retired parties
/// differently, and filters the metering-point form's picker down to the active ones.</param>
public sealed record BrpDto(Guid Id, string Code, string Name, bool IsActive);
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Domain.Tests --filter "FullyQualifiedName~ContractPurityTests"`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Contracts tests/PeakPower.Domain.Tests
git commit -m "feat(contracts): add the employee API request and response types"
```

---

### Task 11: The employee host, problem details, and the BRP reference-data endpoint

The smallest complete vertical through the employee API: a host that boots, connects on the
employee login role, emits RFC 7807 for everything that goes wrong, and serves one endpoint.

**Read this before writing the composition root.** The employee API registers
`UnscopedCustomerContext`, not `DevelopmentCustomerContext`. Back-office staff administer every
customer; an employee scoped to one company cannot do the job. The two mechanisms that make that
safe rather than reckless are both already in place: the query filters collapse to `true` only
when the context says it is not customer-scoped, and this host connects as `peakpower_employee`,
whose row-level-security policy is an explicit `USING (true)` written in migration 2 and visible
in `pg_policies`. **Do not scope this API to a tenant.**

**Files:**
- Create: `src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj`
- Create: `src/Hosts/PeakPower.Api.Employee/Program.cs`
- Create: `src/Hosts/PeakPower.Api.Employee/EmployeeApiEntryPoint.cs`
- Create: `src/Hosts/PeakPower.Api.Employee/appsettings.json`
- Create: `src/Hosts/PeakPower.Api.Employee/Mapping/EmployeeMappings.cs`
- Create: `src/Hosts/PeakPower.Api.Employee/Endpoints/ReferenceDataEndpoints.cs`
- Modify: `PeakPower.sln`
- Test: `tests/PeakPower.Integration.Tests/Employee/EmployeeApiFactory.cs`
- Test: `tests/PeakPower.Integration.Tests/Employee/ReferenceDataEndpointTests.cs`

**Interfaces:**
- Consumes: `UnscopedCustomerContext`, `HeaderEmployeeContext` (Task 1); `TenancyStartupGuard` (Task 2); `PeakPowerDbContext` (Task 3); `TenancyFixture` (Task 4); `AppRoleConnectionString` (Task 5); `ApiResults`, `ValidationFilterExtensions.Validate<T>()` (Task 6); `TenancyEndpointExtensions.BackOffice()` (Task 9); `EnumWireFormat` (Task 6); `Brp` (Plan 1); `BrpDto`, `AddressDto`, `ContactPersonDto`, `AccountDto`, `MeteringPointDto` (Task 10).
- Produces:
  - `public sealed class EmployeeApiEntryPoint` in `PeakPower.Api.Employee` — the marker type `WebApplicationFactory<T>` is pointed at (shared contract §5.1; **no host declares `public partial class Program`**)
  - `public static class ReferenceDataEndpoints` — `IEndpointRouteBuilder MapReferenceDataEndpoints(this IEndpointRouteBuilder routes)`
  - `public static class EmployeeMappings` — `AddressDto? ToDto(Address? address)`, `Address ToDomain(AddressDto dto)`, `ContactPersonDto ToDto(ContactPerson contact)`, `ContactPerson ToDomain(ContactPersonDto dto)`, `AccountDto ToDto(CustomerAccount account)`, `MeteringPointDto ToDto(MeteringPoint meteringPoint, string brpName)`, `CustomerListItemDto ToListItem(Customer customer, int accountCount, int meteringPointCount)`, `CustomerDetailDto ToDetail(Customer customer, IReadOnlyList<AccountDto> accounts, IReadOnlyList<MeteringPointDto> meteringPoints)`
  - `public sealed class EmployeeApiFactory : WebApplicationFactory<EmployeeApiEntryPoint>` — `EmployeeApiFactory(string connectionString)`, `HttpClient CreateEmployeeClient()`

- [ ] **Step 1: Create the project**

Create `src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <ProjectReference Include="../../Core/PeakPower.Contracts/PeakPower.Contracts.csproj" />
    <ProjectReference Include="../../Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj" />
    <ProjectReference Include="../PeakPower.ServiceDefaults/PeakPower.ServiceDefaults.csproj" />
  </ItemGroup>

  <ItemGroup>
    <PackageReference Include="FluentValidation" />
    <PackageReference Include="FluentValidation.DependencyInjectionExtensions" />
    <!-- Direct, because Task 14 catches PostgresException to turn the EAN exclusion
         constraint into a 409 rather than a 500. -->
    <PackageReference Include="Npgsql" />
  </ItemGroup>

</Project>
```

Create `src/Hosts/PeakPower.Api.Employee/appsettings.json`:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*",
  "Tenancy": {
    "DatabaseRole": "peakpower_employee",
    "DatabasePassword": "dev_only_employee_password"
  }
}
```

Add it to the solution:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet sln add src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj --solution-folder src/Hosts
dotnet add tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj reference \
  src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj
dotnet add tests/PeakPower.Architecture.Tests/PeakPower.Architecture.Tests.csproj reference \
  src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj
```

- [ ] **Step 2: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Employee/EmployeeApiFactory.cs`:

```csharp
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using PeakPower.Api.Employee;
using PeakPower.Infrastructure.Web.Tenancy;

namespace PeakPower.Integration.Tests.Employee;

/// <summary>
/// Boots the real employee host against the fixture's PostgreSQL container. The host resolves
/// its own login role from configuration, so nothing here overrides tenancy — only the address
/// of the database.
/// </summary>
public sealed class EmployeeApiFactory : WebApplicationFactory<EmployeeApiEntryPoint>
{
    private readonly string _ownerConnectionString;

    public EmployeeApiFactory(string ownerConnectionString) =>
        _ownerConnectionString = ownerConnectionString;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:peakpower", _ownerConnectionString);
        builder.UseEnvironment("Development");
    }

    public HttpClient CreateEmployeeClient()
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.TryAddWithoutValidation(
            HeaderEmployeeContext.EmployeeIdHeader, "iris.dekker");
        return client;
    }
}
```

Create `tests/PeakPower.Integration.Tests/Employee/ReferenceDataEndpointTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Shouldly;
using PeakPower.Contracts.Employee;
using PeakPower.Integration.Tests.Tenancy;
using Xunit;

namespace PeakPower.Integration.Tests.Employee;

[Collection(nameof(TenancyCollection))]
public sealed class ReferenceDataEndpointTests : IAsyncLifetime
{
    private readonly TenancyFixture _fixture;
    private EmployeeApiFactory _factory = null!;
    private HttpClient _client = null!;

    public ReferenceDataEndpointTests(TenancyFixture fixture) => _fixture = fixture;

    public ValueTask InitializeAsync()
    {
        _factory = new EmployeeApiFactory(_fixture.OwnerConnectionString);
        _client = _factory.CreateEmployeeClient();
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    [Fact]
    public async Task lists_the_balance_responsible_parties()
    {
        var brps = await _client.GetFromJsonAsync<List<BrpDto>>("/api/v1/reference-data/brps");

        brps.ShouldNotBeNull();
        var pvned = brps!.Single(brp => brp.Code == "PVNED");
        pvned.Name.ShouldBe("PVNed B.V.");
        pvned.IsActive.ShouldBeTrue(
            "Plan 4's reference-data screen renders the flag and filters the metering-point " +
            "form's picker on it, so it has to reach the wire");
    }

    [Fact]
    public async Task an_unknown_route_returns_a_problem_document()
    {
        using var response = await _client.GetAsync("/api/v1/reference-data/nothing-here");

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
    }
}
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ReferenceDataEndpointTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'EmployeeApiEntryPoint' could not be found`.

- [ ] **Step 4: Write the mapping and the reference-data endpoint**

Create `src/Hosts/PeakPower.Api.Employee/Mapping/EmployeeMappings.cs`:

```csharp
using PeakPower.Contracts.Employee;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Web.Http;

namespace PeakPower.Api.Employee.Mapping;

/// <summary>
/// Domain to wire, in memory.
/// <para>
/// Deliberately not an EF projection: EanCode, KvkNumber and the enums are persisted through
/// value converters, and a <c>Select</c> that reaches inside a converted property does not
/// translate to SQL. Slice 1's page sizes are small, so materialising the entity and mapping
/// here is both simpler and correct.
/// </para>
/// <para>
/// Every enum leaves through <see cref="EnumWireFormat.ToWire"/>, never through
/// <c>ToString()</c>. Shared contract §5.2: the wire spelling is the database spelling, so an
/// account is <c>PENDING_APPROVAL</c> and not <c>PendingApproval</c>. One <c>ToString()</c> here
/// is all it takes for the employee API and the customer API to start disagreeing about the same
/// value, and for Plan 4's label maps to fall through to the raw string.
/// </para>
/// </summary>
public static class EmployeeMappings
{
    public static AddressDto? ToDto(Address? address) =>
        address is null
            ? null
            : new AddressDto(
                address.Street, address.HouseNumber, address.HouseNumberSuffix,
                address.PostalCode, address.City, address.Country);

    public static Address ToDomain(AddressDto dto) =>
        new(dto.Street, dto.HouseNumber, dto.HouseNumberSuffix, dto.PostalCode, dto.City, dto.Country);

    public static ContactPersonDto ToDto(ContactPerson contact) =>
        new(contact.Name, contact.Email, contact.Phone);

    public static ContactPerson ToDomain(ContactPersonDto dto) =>
        new(dto.Name, dto.Email, dto.Phone);

    public static AccountDto ToDto(CustomerAccount account) =>
        new(account.Id, account.CustomerId, account.Username, account.FirstName, account.LastName,
            account.JobTitle, account.Email, account.Phone,
            EnumWireFormat.ToWire(account.Status),
            account.IsAdmin, account.LastLoginAt);

    public static MeteringPointDto ToDto(MeteringPoint meteringPoint, string brpName) =>
        new(meteringPoint.Id,
            meteringPoint.CustomerId,
            meteringPoint.Ean.Value,
            meteringPoint.Ean.ToDisplayString(),
            EnumWireFormat.ToWire(meteringPoint.Commodity),
            meteringPoint.BrpId,
            brpName,
            EnumWireFormat.ToWire(meteringPoint.ProductionExpectation),
            meteringPoint.ExpectationSource is { } source ? EnumWireFormat.ToWire(source) : null,
            meteringPoint.Name,
            meteringPoint.Description,
            meteringPoint.DisplayLabel,
            meteringPoint.GridOperator,
            meteringPoint.CapacityKw,
            ToDto(meteringPoint.Address),
            meteringPoint.ValidFrom,
            meteringPoint.ValidTo);

    public static CustomerListItemDto ToListItem(
        Customer customer, int accountCount, int meteringPointCount) =>
        new(customer.Id, customer.LegalName, customer.TradeName, customer.KvkNumber.Value,
            EnumWireFormat.ToWire(customer.Status), customer.BillingAddress.City,
            accountCount, meteringPointCount);

    public static CustomerDetailDto ToDetail(
        Customer customer,
        IReadOnlyList<AccountDto> accounts,
        IReadOnlyList<MeteringPointDto> meteringPoints) =>
        new(customer.Id,
            customer.LegalName,
            customer.TradeName,
            customer.KvkNumber.Value,
            customer.VatNumber,
            EnumWireFormat.ToWire(customer.Status),
            customer.FourEyesEnabled,
            ToDto(customer.BillingAddress)!,
            ToDto(customer.VisitingAddress),
            ToDto(customer.PrimaryContact),
            customer.InternalReference,
            customer.Locale,
            accounts,
            meteringPoints);
}
```

Create `src/Hosts/PeakPower.Api.Employee/Endpoints/ReferenceDataEndpoints.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Employee;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;

namespace PeakPower.Api.Employee.Endpoints;

public static class ReferenceDataEndpoints
{
    public static IEndpointRouteBuilder MapReferenceDataEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/v1/reference-data").WithTags("Reference data");

        group.MapGet("/brps", async (PeakPowerDbContext db, CancellationToken cancellationToken) =>
            {
                var brps = await db.Brps
                    .AsNoTracking()
                    .OrderBy(brp => brp.Name)
                    .Select(brp => new BrpDto(brp.Id, brp.Code, brp.Name, brp.IsActive))
                    .ToListAsync(cancellationToken);

                return Results.Ok(brps);
            })
            .WithName("ListBalanceResponsibleParties")
            .WithSummary("Lists the balance responsible parties. [F12-R49]")
            .Produces<List<BrpDto>>()
            .BackOffice("Reference data is platform-wide and shared by every customer.");

        return routes;
    }
}
```

- [ ] **Step 5: Write the composition root**

Create `src/Hosts/PeakPower.Api.Employee/Program.cs`:

```csharp
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using PeakPower.Api.Employee;
using PeakPower.Api.Employee.Endpoints;
using PeakPower.Application.Abstractions;
using PeakPower.Infrastructure.Web.Http;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

// ---------------------------------------------------------------------------------------------
// Identity.
//
// The employee API is NOT tenant-scoped. PeakPower staff administer every customer, so the
// customer context registered here is never authenticated, which makes every EF Core global
// query filter a no-op. That is safe because this host connects as `peakpower_employee`, a role
// whose row-level-security policy is an explicit USING (true) written in migration 2. Scoping
// this API to a tenant would break the back office; removing the employee policy would blind it.
// ---------------------------------------------------------------------------------------------
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton<ICustomerContext, UnscopedCustomerContext>();
builder.Services.AddScoped<IEmployeeContext, HeaderEmployeeContext>();

// ---------------------------------------------------------------------------------------------
// Database.
//
// Aspire hands us the owning connection string. Row-level security does not apply to a table's
// owner, so the host rewrites it onto its own non-owner login role before anything opens a
// connection. The fallback address exists so the build-time OpenAPI generator can construct the
// host without a database; it never resolves at run time because Aspire always supplies the
// real value.
// ---------------------------------------------------------------------------------------------
var ownerConnectionString = builder.Configuration.GetConnectionString("peakpower")
                            ?? "Host=localhost;Port=5432;Database=peakpower;Username=postgres;Password=postgres";

var connectionString = AppRoleConnectionString.For(
    ownerConnectionString,
    builder.Configuration["Tenancy:DatabaseRole"] ?? "peakpower_employee",
    builder.Configuration["Tenancy:DatabasePassword"] ?? "dev_only_employee_password");

builder.Services.AddDbContext<PeakPowerDbContext>(options => options
    .UseNpgsql(connectionString)
    .UseSnakeCaseNamingConvention());

// Shared contract §5.2 — one converter, the database spelling, in both APIs. Every DTO in
// PeakPower.Contracts carries `string` because that assembly references nothing, so the mappers
// call EnumWireFormat.ToWire directly; this registration keeps any enum-typed property that
// appears later on exactly the same spelling instead of quietly reverting to PascalCase.
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(EnumWireFormat.Converter));

// RFC 7807 for every failure, including the ones the framework raises.
builder.Services.AddProblemDetails();
builder.Services.AddValidatorsFromAssemblyContaining<EmployeeApiEntryPoint>(includeInternalTypes: true);
builder.Services.AddOpenApi("employee");

// [F13-R31] — refuse to boot a development identity provider in Production.
TenancyStartupGuard.ThrowIfDevelopmentProvidersRegisteredInProduction(
    builder.Services, builder.Environment);

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();

app.MapDefaultEndpoints();
app.MapOpenApi();

app.MapReferenceDataEndpoints();

app.Run();

```

Create `src/Hosts/PeakPower.Api.Employee/EmployeeApiEntryPoint.cs`:

```csharp
namespace PeakPower.Api.Employee;

/// <summary>
/// The type <c>WebApplicationFactory&lt;T&gt;</c> is pointed at, so the integration-test
/// assembly can boot this host. It is a named marker rather than the usual
/// <c>public partial class Program</c> because that assembly references both API hosts, and two
/// global-namespace <c>Program</c> types make a bare <c>WebApplicationFactory&lt;Program&gt;</c>
/// ambiguous (CS0104). Shared contract §5.1: no host declares <c>public partial class Program</c>.
/// It lives in its own file because <c>Program.cs</c> uses top-level statements, which may not be
/// followed by a file-scoped namespace declaration.
/// </summary>
public sealed class EmployeeApiEntryPoint;
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ReferenceDataEndpointTests"`
Expected: PASS — 2 tests.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add PeakPower.sln src/Hosts/PeakPower.Api.Employee \
  tests/PeakPower.Integration.Tests tests/PeakPower.Architecture.Tests
git commit -m "feat(employee-api): add the host, problem details and the BRP reference-data endpoint"
```

---
### Task 12: Customer endpoints — list, detail, create, edit

`[F01-R01]`…`[F01-R07]`. Four endpoints, one FluentValidation validator per request body.

Two details worth stating, because both look like mistakes if you have not seen the reason:

- **The list search branches on shape.** A KvK number is exactly 8 digits, so an 8-digit search
  term is an exact KvK match; anything else is a case-insensitive `ILIKE` over the legal and trade
  names. Searching a value-converted property with `ILIKE` does not translate to SQL, and
  branching is both faster and clearer than forcing it.
- **The per-row counts are two more queries, not two correlated subqueries.** The list shows an
  account count and a connection count per row `[F01-R01]`. Counting inside the projection would
  produce a correlated subquery per row per count; one grouped count over the page's identifiers
  is one round trip each.

**Files:**
- Create: `src/Hosts/PeakPower.Api.Employee/Endpoints/CustomerEndpoints.cs`
- Create: `src/Hosts/PeakPower.Api.Employee/Validation/CustomerValidators.cs`
- Modify: `src/Hosts/PeakPower.Api.Employee/Program.cs`
- Test: `tests/PeakPower.Integration.Tests/Employee/CustomerEndpointTests.cs`

**Interfaces:**
- Consumes: `ApiResults`, `Validate<T>()` and `EnumWireFormat` (Task 6); `BackOffice()` (Task 9); `Customer.Create`, `Customer.UpdateDetails`, `Customer.ChangeStatus` (Plan 1, shared contract §5.1 — all three return `Result<T>`); `CustomerListItemDto`, `CustomerListResponse`, `CustomerDetailDto`, `CreateCustomerRequest`, `UpdateCustomerRequest` (Task 10); `EmployeeMappings` (Task 11).
- Produces:
  - `public static class CustomerEndpoints` — `IEndpointRouteBuilder MapCustomerEndpoints(this IEndpointRouteBuilder routes)`
  - routes `GET /api/v1/customers`, `POST /api/v1/customers`, `GET /api/v1/customers/{id:guid}`, `PATCH /api/v1/customers/{id:guid}`
  - `public sealed class CreateCustomerRequestValidator : AbstractValidator<CreateCustomerRequest>`
  - `public sealed class UpdateCustomerRequestValidator : AbstractValidator<UpdateCustomerRequest>`
  - `public sealed class AddressDtoValidator : AbstractValidator<AddressDto>`
  - `public sealed class ContactPersonDtoValidator : AbstractValidator<ContactPersonDto>`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Employee/CustomerEndpointTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Shouldly;
using PeakPower.Contracts.Employee;
using PeakPower.Integration.Tests.Tenancy;
using Xunit;

namespace PeakPower.Integration.Tests.Employee;

[Collection(nameof(TenancyCollection))]
public sealed class CustomerEndpointTests : IAsyncLifetime
{
    private readonly TenancyFixture _fixture;
    private EmployeeApiFactory _factory = null!;
    private HttpClient _client = null!;

    public CustomerEndpointTests(TenancyFixture fixture) => _fixture = fixture;

    public ValueTask InitializeAsync()
    {
        _factory = new EmployeeApiFactory(_fixture.OwnerConnectionString);
        _client = _factory.CreateEmployeeClient();
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private static AddressDto AnyAddress =>
        new("Havenweg", "12", null, "3011 AA", "Rotterdam", "NL");

    private static ContactPersonDto AnyContact =>
        new("Els Bakker", "els@example.test", null);

    [Fact]
    public async Task the_list_shows_every_customer_because_the_back_office_is_not_tenant_scoped()
    {
        var list = await _client.GetFromJsonAsync<CustomerListResponse>("/api/v1/customers");

        list.ShouldNotBeNull();
        list!.Items.Select(customer => customer.Id)
            .ShouldContain([_fixture.CompanyAId, _fixture.CompanyBId]);
        list.Total.ShouldBeGreaterThanOrEqualTo(2, "the total spans every page, not this one");
    }

    [Fact]
    public async Task the_list_can_be_searched_by_name()
    {
        var list = await _client.GetFromJsonAsync<CustomerListResponse>(
            "/api/v1/customers?q=windkracht");

        var row = list!.Items.ShouldHaveSingleItem();
        row.Id.ShouldBe(_fixture.CompanyBId);
        row.City.ShouldBe("Rotterdam");
        row.AccountCount.ShouldBe(1, "company B was seeded with one account");
        row.MeteringPointCount.ShouldBe(1);
    }

    [Fact]
    public async Task the_list_can_be_searched_by_kvk_number()
    {
        var list = await _client.GetFromJsonAsync<CustomerListResponse>(
            "/api/v1/customers?q=81000001");

        list!.Items.ShouldHaveSingleItem()
            .Id.ShouldBe(_fixture.CompanyAId);
    }

    [Fact]
    public async Task the_detail_carries_the_accounts_and_the_connections()
    {
        var detail = await _client.GetFromJsonAsync<CustomerDetailDto>(
            $"/api/v1/customers/{_fixture.CompanyBId}");

        detail.ShouldNotBeNull();
        detail!.KvkNumber.ShouldBe("81000002");
        detail.Accounts.Count(account => account.Id == _fixture.CompanyBAccountId).ShouldBe(1);
        detail.MeteringPoints.Count(
            meteringPoint => meteringPoint.Id == _fixture.CompanyBMeteringPointId).ShouldBe(1);
        detail.MeteringPoints[0].BrpName.ShouldBe("PVNed B.V.");
    }

    [Fact]
    public async Task an_unknown_customer_is_not_found()
    {
        using var response = await _client.GetAsync($"/api/v1/customers/{Guid.NewGuid()}");

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task a_new_customer_starts_as_a_prospect()
    {
        var request = new CreateCustomerRequest(
            "Getijdenstroom B.V.", "Getijdenstroom", "81000003", null,
            AnyAddress, null, AnyContact, "CRM-9001", "nl-NL");

        using var response = await _client.PostAsJsonAsync("/api/v1/customers", request);

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var created = await response.Content.ReadFromJsonAsync<CustomerDetailDto>();
        created!.Status.ShouldBe("PROSPECT",
            "shared contract §5.2 — the wire spelling is the database spelling");
        created.KvkNumber.ShouldBe("81000003");
        response.Headers.Location!.ToString().ShouldEndWith(created.Id.ToString());
    }

    [Fact]
    public async Task a_malformed_kvk_number_is_rejected_at_the_boundary()
    {
        var request = new CreateCustomerRequest(
            "Kort B.V.", null, "123", null, AnyAddress, null, AnyContact, null, "nl-NL");

        using var response = await _client.PostAsJsonAsync("/api/v1/customers", request);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
        var body = await response.Content.ReadAsStringAsync();
        body.ShouldContain("KvkNumber");
    }

    [Fact]
    public async Task editing_a_customer_leaves_the_kvk_number_alone()
    {
        var create = new CreateCustomerRequest(
            "Duinwind B.V.", null, "81000004", null, AnyAddress, null, AnyContact, null, "nl-NL");
        using var createResponse = await _client.PostAsJsonAsync("/api/v1/customers", create);
        var created = await createResponse.Content.ReadFromJsonAsync<CustomerDetailDto>();

        var update = new UpdateCustomerRequest(
            "Duinwind Holding B.V.", "Duinwind", "NL810000045B01",
            AnyAddress, AnyAddress, AnyContact, "CRM-9002", "nl-NL", "ACTIVE");

        using var response = await _client.PatchAsJsonAsync($"/api/v1/customers/{created!.Id}", update);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var updated = await response.Content.ReadFromJsonAsync<CustomerDetailDto>();
        updated!.LegalName.ShouldBe("Duinwind Holding B.V.");
        updated.KvkNumber.ShouldBe("81000004");
        updated.Status.ShouldBe("ACTIVE");
    }
}
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~CustomerEndpointTests"`
Expected: FAIL — every test returns 404 because `/api/v1/customers` is not mapped, so the first
assertion fails with `System.Net.Http.HttpRequestException: Response status code does not indicate success: 404 (Not Found)`.

- [ ] **Step 3: Write the validators**

Create `src/Hosts/PeakPower.Api.Employee/Validation/CustomerValidators.cs`:

```csharp
using FluentValidation;
using PeakPower.Contracts.Employee;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Web.Http;

namespace PeakPower.Api.Employee.Validation;

public sealed class AddressDtoValidator : AbstractValidator<AddressDto>
{
    public AddressDtoValidator()
    {
        RuleFor(address => address.Street).NotEmpty().MaximumLength(200);
        RuleFor(address => address.HouseNumber).NotEmpty().MaximumLength(20);
        RuleFor(address => address.HouseNumberSuffix).MaximumLength(20);
        RuleFor(address => address.PostalCode).NotEmpty().MaximumLength(20);
        RuleFor(address => address.City).NotEmpty().MaximumLength(120);
        RuleFor(address => address.Country)
            .NotEmpty()
            .Length(2)
            .WithMessage("Use the two-letter ISO 3166-1 country code, for example NL.");
    }
}

public sealed class ContactPersonDtoValidator : AbstractValidator<ContactPersonDto>
{
    public ContactPersonDtoValidator()
    {
        RuleFor(contact => contact.Name).NotEmpty().MaximumLength(200);
        RuleFor(contact => contact.Email).NotEmpty().EmailAddress().MaximumLength(320);
        RuleFor(contact => contact.Phone).MaximumLength(40);
    }
}

public sealed class CreateCustomerRequestValidator : AbstractValidator<CreateCustomerRequest>
{
    public CreateCustomerRequestValidator()
    {
        RuleFor(request => request.LegalName).NotEmpty().MaximumLength(200);
        RuleFor(request => request.TradeName).MaximumLength(200);

        // [F01-R03] — the Dutch Chamber of Commerce number is exactly eight digits.
        RuleFor(request => request.KvkNumber)
            .NotEmpty()
            .Matches("^[0-9]{8}$")
            .WithMessage("A KvK number is exactly eight digits.");

        RuleFor(request => request.VatNumber).MaximumLength(20);
        RuleFor(request => request.BillingAddress).NotNull().SetValidator(new AddressDtoValidator());
        RuleFor(request => request.VisitingAddress!)
            .SetValidator(new AddressDtoValidator())
            .When(request => request.VisitingAddress is not null);
        RuleFor(request => request.PrimaryContact).NotNull().SetValidator(new ContactPersonDtoValidator());
        RuleFor(request => request.InternalReference).MaximumLength(60);
        RuleFor(request => request.Locale).NotEmpty().MaximumLength(10);
    }
}

public sealed class UpdateCustomerRequestValidator : AbstractValidator<UpdateCustomerRequest>
{
    // Shared contract §5.2 — the wire spelling, generated from the enum so the two cannot drift.
    private static readonly string[] AllowedStatuses = EnumWireFormat.Names<CustomerStatus>();

    public UpdateCustomerRequestValidator()
    {
        RuleFor(request => request.LegalName).NotEmpty().MaximumLength(200);
        RuleFor(request => request.TradeName).MaximumLength(200);
        RuleFor(request => request.VatNumber).MaximumLength(20);
        RuleFor(request => request.BillingAddress).NotNull().SetValidator(new AddressDtoValidator());
        RuleFor(request => request.VisitingAddress!)
            .SetValidator(new AddressDtoValidator())
            .When(request => request.VisitingAddress is not null);
        RuleFor(request => request.PrimaryContact).NotNull().SetValidator(new ContactPersonDtoValidator());
        RuleFor(request => request.InternalReference).MaximumLength(60);
        RuleFor(request => request.Locale).NotEmpty().MaximumLength(10);
        RuleFor(request => request.Status)
            .Must(status => AllowedStatuses.Contains(status, StringComparer.Ordinal))
            .WithMessage($"Status must be one of: {string.Join(", ", AllowedStatuses)}.");
    }
}
```

- [ ] **Step 4: Write the endpoints**

Create `src/Hosts/PeakPower.Api.Employee/Endpoints/CustomerEndpoints.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Api.Employee.Mapping;
using PeakPower.Contracts.Employee;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Web.Http;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;

namespace PeakPower.Api.Employee.Endpoints;

public static class CustomerEndpoints
{
    private const int MaximumPageSize = 100;

    public static IEndpointRouteBuilder MapCustomerEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/v1/customers").WithTags("Customers");

        group.MapGet("/", ListAsync)
            .WithName("ListCustomers")
            .WithSummary("Lists customer companies, newest first. [F01-R01]")
            .Produces<CustomerListResponse>()
            .BackOffice("Back-office staff administer every customer company.");

        group.MapGet("/{id:guid}", DetailAsync)
            .WithName("GetCustomer")
            .WithSummary("One customer with its accounts and connections. [F01-R07]")
            .Produces<CustomerDetailDto>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .BackOffice("Back-office staff administer every customer company.");

        group.MapPost("/", CreateAsync)
            .WithName("CreateCustomer")
            .WithSummary("Registers a new customer company as a prospect. [F01-R02]")
            .Produces<CustomerDetailDto>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .Validate<CreateCustomerRequest>()
            .BackOffice("Back-office staff administer every customer company.");

        group.MapPatch("/{id:guid}", UpdateAsync)
            .WithName("UpdateCustomer")
            .WithSummary("Edits a customer company. The KvK number is immutable. [F01-R04]")
            .Produces<CustomerDetailDto>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .Validate<UpdateCustomerRequest>()
            .BackOffice("Back-office staff administer every customer company.");

        return routes;
    }

    private static async Task<IResult> ListAsync(
        string? q,
        int page,
        int pageSize,
        PeakPowerDbContext db,
        CancellationToken cancellationToken)
    {
        page = page < 1 ? 1 : page;
        pageSize = pageSize is < 1 or > MaximumPageSize ? 25 : pageSize;

        var query = db.Customers.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim();
            var kvk = KvkNumber.Create(term);

            // An eight-digit term is a KvK number, which is stored through a value converter and
            // therefore compares by equality but does not translate under ILIKE.
            query = kvk.IsSuccess
                ? query.Where(customer => customer.KvkNumber == kvk.Value)
                : query.Where(customer =>
                    EF.Functions.ILike(customer.LegalName, $"%{term}%") ||
                    (customer.TradeName != null && EF.Functions.ILike(customer.TradeName, $"%{term}%")));
        }

        var total = await query.CountAsync(cancellationToken);

        var customers = await query
            .OrderBy(customer => customer.LegalName)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        var identifiers = customers.Select(customer => customer.Id).ToArray();

        var meteringPointCounts = await db.MeteringPoints
            .AsNoTracking()
            .Where(meteringPoint => identifiers.Contains(meteringPoint.CustomerId))
            .GroupBy(meteringPoint => meteringPoint.CustomerId)
            .Select(grouping => new { CustomerId = grouping.Key, Count = grouping.Count() })
            .ToDictionaryAsync(row => row.CustomerId, row => row.Count, cancellationToken);

        var accountCounts = await db.CustomerAccounts
            .AsNoTracking()
            .Where(account => identifiers.Contains(account.CustomerId))
            .GroupBy(account => account.CustomerId)
            .Select(grouping => new { CustomerId = grouping.Key, Count = grouping.Count() })
            .ToDictionaryAsync(row => row.CustomerId, row => row.Count, cancellationToken);

        var items = customers
            .Select(customer => EmployeeMappings.ToListItem(
                customer,
                accountCounts.TryGetValue(customer.Id, out var accounts) ? accounts : 0,
                meteringPointCounts.TryGetValue(customer.Id, out var points) ? points : 0))
            .ToArray();

        // `page` and `pageSize` were the caller's own query parameters, so the envelope carries
        // the rows and the total across every page and nothing else.
        return Results.Ok(new CustomerListResponse(items, total));
    }

    private static async Task<IResult> DetailAsync(
        Guid id,
        PeakPowerDbContext db,
        CancellationToken cancellationToken)
    {
        var detail = await BuildDetailAsync(id, db, cancellationToken);
        return ApiResults.Found(detail);
    }

    private static async Task<IResult> CreateAsync(
        CreateCustomerRequest request,
        PeakPowerDbContext db,
        CancellationToken cancellationToken)
    {
        var kvk = KvkNumber.Create(request.KvkNumber);
        if (!kvk.IsSuccess)
        {
            return ApiResults.InvalidRequest(nameof(request.KvkNumber), kvk.Error);
        }

        var alreadyRegistered = await db.Customers
            .AsNoTracking()
            .AnyAsync(customer => customer.KvkNumber == kvk.Value, cancellationToken);

        if (alreadyRegistered)
        {
            return ApiResults.Conflict(
                $"A customer with KvK number {request.KvkNumber} is already registered.");
        }

        // The aggregate returns Result<T> rather than throwing: a validation failure is a 400,
        // not a 500. The boundary validator has already checked most of this, so a failure here
        // is a rule the aggregate holds and the DTO validator does not.
        var created = Customer.Create(
            request.LegalName,
            request.TradeName,
            kvk.Value,
            request.VatNumber,
            EmployeeMappings.ToDomain(request.BillingAddress),
            request.VisitingAddress is null ? null : EmployeeMappings.ToDomain(request.VisitingAddress),
            EmployeeMappings.ToDomain(request.PrimaryContact),
            request.InternalReference,
            request.Locale);

        if (!created.IsSuccess)
        {
            return ApiResults.InvalidRequest(nameof(request.LegalName), created.Error);
        }

        var customer = created.Value;

        db.Customers.Add(customer);
        await db.SaveChangesAsync(cancellationToken);

        var detail = await BuildDetailAsync(customer.Id, db, cancellationToken);
        return Results.Created($"/api/v1/customers/{customer.Id}", detail);
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateCustomerRequest request,
        PeakPowerDbContext db,
        CancellationToken cancellationToken)
    {
        var customer = await db.Customers
            .FirstOrDefaultAsync(candidate => candidate.Id == id, cancellationToken);

        if (customer is null)
        {
            return ApiResults.NotFound();
        }

        var updated = customer.UpdateDetails(
            request.LegalName,
            request.TradeName,
            request.VatNumber,
            EmployeeMappings.ToDomain(request.BillingAddress),
            request.VisitingAddress is null ? null : EmployeeMappings.ToDomain(request.VisitingAddress),
            EmployeeMappings.ToDomain(request.PrimaryContact),
            request.InternalReference,
            request.Locale);

        if (!updated.IsSuccess)
        {
            return ApiResults.InvalidRequest(nameof(request.LegalName), updated.Error);
        }

        // The mutator is ChangeStatus, not SetStatus, and the request carries the wire spelling,
        // so this parse goes through EnumWireFormat rather than Enum.Parse. The validator has
        // already rejected anything that is not one of the four.
        var statusChanged = customer.ChangeStatus(
            EnumWireFormat.Parse<CustomerStatus>(request.Status));

        if (!statusChanged.IsSuccess)
        {
            return ApiResults.InvalidRequest(nameof(request.Status), statusChanged.Error);
        }

        await db.SaveChangesAsync(cancellationToken);

        var detail = await BuildDetailAsync(id, db, cancellationToken);
        return ApiResults.Found(detail);
    }

    private static async Task<CustomerDetailDto?> BuildDetailAsync(
        Guid id,
        PeakPowerDbContext db,
        CancellationToken cancellationToken)
    {
        var customer = await db.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(candidate => candidate.Id == id, cancellationToken);

        if (customer is null)
        {
            return null;
        }

        var accounts = await db.CustomerAccounts
            .AsNoTracking()
            .Where(account => account.CustomerId == id)
            .OrderBy(account => account.Username)
            .ToListAsync(cancellationToken);

        var meteringPoints = await db.MeteringPoints
            .AsNoTracking()
            .Where(meteringPoint => meteringPoint.CustomerId == id)
            .OrderBy(meteringPoint => meteringPoint.ValidFrom)
            .ToListAsync(cancellationToken);

        var brpNames = await db.Brps
            .AsNoTracking()
            .ToDictionaryAsync(brp => brp.Id, brp => brp.Name, cancellationToken);

        return EmployeeMappings.ToDetail(
            customer,
            accounts.Select(EmployeeMappings.ToDto).ToArray(),
            meteringPoints
                .Select(meteringPoint => EmployeeMappings.ToDto(
                    meteringPoint,
                    brpNames.TryGetValue(meteringPoint.BrpId, out var name) ? name : string.Empty))
                .ToArray());
    }
}
```

- [ ] **Step 5: Map the endpoints in the composition root**

In `src/Hosts/PeakPower.Api.Employee/Program.cs`, add below `app.MapReferenceDataEndpoints();`:

```csharp
app.MapCustomerEndpoints();
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~CustomerEndpointTests"`
Expected: PASS — 8 tests.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Employee tests/PeakPower.Integration.Tests/Employee/CustomerEndpointTests.cs
git commit -m "feat(employee-api): add customer list, detail, create and edit endpoints [F01-R01..R07]"
```

---
### Task 13: Account endpoints — create, edit, deactivate

`[F01-R10]`…`[F01-R17]`. An account is one person's login inside a customer company.

**Every edit and every deactivation bumps the account's `SecurityStamp`.** `[F01-R16]` says a
change to an account revokes its sessions *immediately*, and design §7 chose the stamp claim to
make that true against a stateless JWT that Plan 5 will not re-check for another fifteen minutes.
`Deactivate()` bumps on its own; shared contract §5.1 gives `UpdateProfile` no implicit bump, so
the edit endpoint calls `BumpSecurityStamp()` itself. Forget it and an employee's revocation of an
admin flag silently does nothing until the token expires.

The username is unique **platform-wide**, not per customer, and it is immutable. That is why the
uniqueness check queries `db.CustomerAccounts` with no customer predicate — and why it works: this
host's customer context is never authenticated, so the global query filter does not narrow it, and
the employee login role's policy permits every row. A host that got either of those wrong would
return a false "available" and then fail on the database's unique index.

**Files:**
- Create: `src/Hosts/PeakPower.Api.Employee/Endpoints/AccountEndpoints.cs`
- Create: `src/Hosts/PeakPower.Api.Employee/Validation/AccountValidators.cs`
- Modify: `src/Hosts/PeakPower.Api.Employee/Program.cs`
- Test: `tests/PeakPower.Integration.Tests/Employee/AccountEndpointTests.cs`

**Interfaces:**
- Consumes: `ApiResults`, `Validate<T>()` (Task 6); `BackOffice()` (Task 9); `CustomerAccount.Create`, `UpdateProfile`, `Deactivate` (Plan 1, shared contract §5.1 — all three return `Result<T>`, and `Create` takes the initial `AccountStatus`); `AccountDto`, `CreateAccountRequest`, `UpdateAccountRequest` (Task 10); `EmployeeMappings.ToDto(CustomerAccount)` (Task 11).
- Produces:
  - `public static class AccountEndpoints` — `IEndpointRouteBuilder MapAccountEndpoints(this IEndpointRouteBuilder routes)`
  - routes `POST /api/v1/customers/{customerId:guid}/accounts`, `PATCH /api/v1/accounts/{id:guid}`, `POST /api/v1/accounts/{id:guid}/deactivate`
  - `public sealed class CreateAccountRequestValidator : AbstractValidator<CreateAccountRequest>`
  - `public sealed class UpdateAccountRequestValidator : AbstractValidator<UpdateAccountRequest>`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Employee/AccountEndpointTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Shouldly;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Employee;
using PeakPower.Integration.Tests.Tenancy;
using Xunit;

namespace PeakPower.Integration.Tests.Employee;

[Collection(nameof(TenancyCollection))]
public sealed class AccountEndpointTests : IAsyncLifetime
{
    private readonly TenancyFixture _fixture;
    private EmployeeApiFactory _factory = null!;
    private HttpClient _client = null!;

    public AccountEndpointTests(TenancyFixture fixture) => _fixture = fixture;

    public ValueTask InitializeAsync()
    {
        _factory = new EmployeeApiFactory(_fixture.OwnerConnectionString);
        _client = _factory.CreateEmployeeClient();
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private async Task<AccountDto> CreateAccountAsync(string username)
    {
        var request = new CreateAccountRequest(
            username, "Nina", "Vos", "Analyst", $"{username}@example.test", null, IsAdmin: false);

        using var response = await _client.PostAsJsonAsync(
            $"/api/v1/customers/{_fixture.CompanyAId}/accounts", request);

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        return (await response.Content.ReadFromJsonAsync<AccountDto>())!;
    }

    [Fact]
    public async Task a_new_account_is_invited_and_belongs_to_the_customer_in_the_route()
    {
        var account = await CreateAccountAsync("n.vos");

        account.Status.ShouldBe("INVITED",
            "shared contract §5.2 — the wire spelling is the database spelling");
        account.CustomerId.ShouldBe(_fixture.CompanyAId);
        account.Username.ShouldBe("n.vos");
    }

    [Fact]
    public async Task an_account_cannot_be_created_for_an_unknown_customer()
    {
        var request = new CreateAccountRequest(
            "ghost", "G", "Host", null, "ghost@example.test", null, false);

        using var response = await _client.PostAsJsonAsync(
            $"/api/v1/customers/{Guid.NewGuid()}/accounts", request);

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task a_username_is_unique_across_the_whole_platform()
    {
        await CreateAccountAsync("shared.name");

        var request = new CreateAccountRequest(
            "shared.name", "Other", "Person", null, "other@example.test", null, false);

        using var response = await _client.PostAsJsonAsync(
            $"/api/v1/customers/{_fixture.CompanyBId}/accounts", request);

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
    }

    [Fact]
    public async Task editing_an_account_bumps_the_security_stamp_so_its_tokens_die()
    {
        var account = await CreateAccountAsync("e.stamp");

        await using var beforeDb = _fixture.OwnerContext();
        var before = await beforeDb.CustomerAccounts
            .AsNoTracking()
            .Where(candidate => candidate.Id == account.Id)
            .Select(candidate => candidate.SecurityStamp)
            .SingleAsync();

        var update = new UpdateAccountRequest(
            "Nina", "Vos-Jansen", "Senior analyst", "n.vos@example.test", "+31612345678", true);

        using var response = await _client.PatchAsJsonAsync($"/api/v1/accounts/{account.Id}", update);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        await using var afterDb = _fixture.OwnerContext();
        var after = await afterDb.CustomerAccounts
            .AsNoTracking()
            .Where(candidate => candidate.Id == account.Id)
            .Select(candidate => candidate.SecurityStamp)
            .SingleAsync();

        after.ShouldNotBe(before, "[F01-R16] an edit revokes the account's outstanding tokens");
    }

    [Fact]
    public async Task deactivating_an_account_sets_the_status_and_bumps_the_stamp()
    {
        var account = await CreateAccountAsync("d.eactivate");

        await using var beforeDb = _fixture.OwnerContext();
        var before = await beforeDb.CustomerAccounts
            .AsNoTracking()
            .Where(candidate => candidate.Id == account.Id)
            .Select(candidate => candidate.SecurityStamp)
            .SingleAsync();

        using var response = await _client.PostAsync($"/api/v1/accounts/{account.Id}/deactivate", null);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var deactivated = await response.Content.ReadFromJsonAsync<AccountDto>();
        deactivated!.Status.ShouldBe("DEACTIVATED");

        await using var afterDb = _fixture.OwnerContext();
        var after = await afterDb.CustomerAccounts
            .AsNoTracking()
            .Where(candidate => candidate.Id == account.Id)
            .Select(candidate => candidate.SecurityStamp)
            .SingleAsync();

        after.ShouldNotBe(before);
    }

    [Fact]
    public async Task deactivating_an_unknown_account_is_not_found()
    {
        using var response = await _client.PostAsync($"/api/v1/accounts/{Guid.NewGuid()}/deactivate", null);

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task a_malformed_email_is_rejected_at_the_boundary()
    {
        var request = new CreateAccountRequest(
            "bad.email", "Bad", "Email", null, "not-an-email", null, false);

        using var response = await _client.PostAsJsonAsync(
            $"/api/v1/customers/{_fixture.CompanyAId}/accounts", request);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).ShouldContain("Email");
    }
}
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~AccountEndpointTests"`
Expected: FAIL — `Expected response.StatusCode to be HttpStatusCode.Created, but found HttpStatusCode.NotFound` on every test, because the routes are not mapped.

- [ ] **Step 3: Write the validators**

Create `src/Hosts/PeakPower.Api.Employee/Validation/AccountValidators.cs`:

```csharp
using FluentValidation;
using PeakPower.Contracts.Employee;

namespace PeakPower.Api.Employee.Validation;

public sealed class CreateAccountRequestValidator : AbstractValidator<CreateAccountRequest>
{
    public CreateAccountRequestValidator()
    {
        RuleFor(request => request.Username)
            .NotEmpty()
            .MaximumLength(64)
            .Matches("^[a-zA-Z0-9._-]+$")
            .WithMessage("A username may contain letters, digits, dot, underscore and hyphen only.");

        RuleFor(request => request.FirstName).NotEmpty().MaximumLength(100);
        RuleFor(request => request.LastName).NotEmpty().MaximumLength(100);

        // [F01-R13] — the job title is descriptive only and is never checked for authorisation.
        RuleFor(request => request.JobTitle).MaximumLength(120);

        RuleFor(request => request.Email).NotEmpty().EmailAddress().MaximumLength(320);
        RuleFor(request => request.Phone).MaximumLength(40);
    }
}

public sealed class UpdateAccountRequestValidator : AbstractValidator<UpdateAccountRequest>
{
    public UpdateAccountRequestValidator()
    {
        RuleFor(request => request.FirstName).NotEmpty().MaximumLength(100);
        RuleFor(request => request.LastName).NotEmpty().MaximumLength(100);
        RuleFor(request => request.JobTitle).MaximumLength(120);
        RuleFor(request => request.Email).NotEmpty().EmailAddress().MaximumLength(320);
        RuleFor(request => request.Phone).MaximumLength(40);
    }
}
```

- [ ] **Step 4: Write the endpoints**

Create `src/Hosts/PeakPower.Api.Employee/Endpoints/AccountEndpoints.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Api.Employee.Mapping;
using PeakPower.Contracts.Employee;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Web.Http;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;

namespace PeakPower.Api.Employee.Endpoints;

public static class AccountEndpoints
{
    private const string BackOfficeReason =
        "Back-office staff administer the accounts of every customer company.";

    public static IEndpointRouteBuilder MapAccountEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapPost("/api/v1/customers/{customerId:guid}/accounts", CreateAsync)
            .WithTags("Accounts")
            .WithName("CreateAccount")
            .WithSummary("Invites a person to a customer company. [F01-R10]")
            .Produces<AccountDto>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .Validate<CreateAccountRequest>()
            .BackOffice(BackOfficeReason);

        routes.MapPatch("/api/v1/accounts/{id:guid}", UpdateAsync)
            .WithTags("Accounts")
            .WithName("UpdateAccount")
            .WithSummary("Edits an account. The username is immutable. [F01-R14]")
            .Produces<AccountDto>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .Validate<UpdateAccountRequest>()
            .BackOffice(BackOfficeReason);

        routes.MapPost("/api/v1/accounts/{id:guid}/deactivate", DeactivateAsync)
            .WithTags("Accounts")
            .WithName("DeactivateAccount")
            .WithSummary("Deactivates an account and revokes its sessions. [F01-R16]")
            .Produces<AccountDto>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .BackOffice(BackOfficeReason);

        return routes;
    }

    private static async Task<IResult> CreateAsync(
        Guid customerId,
        CreateAccountRequest request,
        PeakPowerDbContext db,
        CancellationToken cancellationToken)
    {
        var customerExists = await db.Customers
            .AsNoTracking()
            .AnyAsync(customer => customer.Id == customerId, cancellationToken);

        if (!customerExists)
        {
            return ApiResults.NotFound();
        }

        // The username is unique platform-wide, not per customer. This query is deliberately
        // unscoped: the employee host's ICustomerContext is never authenticated, so the global
        // query filter does not narrow it, and the employee login role sees every row.
        var usernameTaken = await db.CustomerAccounts
            .AsNoTracking()
            .AnyAsync(account => account.Username == request.Username, cancellationToken);

        if (usernameTaken)
        {
            return ApiResults.Conflict($"The username {request.Username} is already in use.");
        }

        // AccountStatus is a parameter of the factory, not a decision the factory makes: Plan 5
        // creates accounts in other states from the onboarding flow. An account an employee
        // invites has no credential yet, so it starts Invited. [F01-R10]
        var created = CustomerAccount.Create(
            customerId,
            request.Username,
            request.FirstName,
            request.LastName,
            request.JobTitle,
            request.Email,
            request.Phone,
            AccountStatus.Invited,
            request.IsAdmin);

        if (!created.IsSuccess)
        {
            return ApiResults.InvalidRequest(nameof(request.Username), created.Error);
        }

        var account = created.Value;

        db.CustomerAccounts.Add(account);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created(
            $"/api/v1/accounts/{account.Id}", EmployeeMappings.ToDto(account));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateAccountRequest request,
        PeakPowerDbContext db,
        CancellationToken cancellationToken)
    {
        var account = await db.CustomerAccounts
            .FirstOrDefaultAsync(candidate => candidate.Id == id, cancellationToken);

        if (account is null)
        {
            return ApiResults.NotFound();
        }

        var updated = account.UpdateProfile(
            request.FirstName,
            request.LastName,
            request.JobTitle,
            request.Email,
            request.Phone,
            request.IsAdmin);

        if (!updated.IsSuccess)
        {
            return ApiResults.InvalidRequest(nameof(request.Email), updated.Error);
        }

        // [F01-R16] — an edit must take effect on the account's next call, not in fifteen
        // minutes. Against a stateless bearer token the stamp is what makes that true, and
        // shared contract §5.1 gives UpdateProfile no implicit bump: Deactivate and SetPassword
        // bump, everything else asks. `IsAdmin` in particular is an authorisation change and a
        // live token must not outlive it.
        account.BumpSecurityStamp();

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(EmployeeMappings.ToDto(account));
    }

    private static async Task<IResult> DeactivateAsync(
        Guid id,
        PeakPowerDbContext db,
        CancellationToken cancellationToken)
    {
        var account = await db.CustomerAccounts
            .FirstOrDefaultAsync(candidate => candidate.Id == id, cancellationToken);

        if (account is null)
        {
            return ApiResults.NotFound();
        }

        var deactivated = account.Deactivate();
        if (!deactivated.IsSuccess)
        {
            // Deactivating an already-deactivated account is the only way this fails, and the
            // caller asked for a state the account is already in — that is a conflict, not a 500.
            return ApiResults.Conflict(deactivated.Error);
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(EmployeeMappings.ToDto(account));
    }
}
```

- [ ] **Step 5: Map the endpoints in the composition root**

In `src/Hosts/PeakPower.Api.Employee/Program.cs`, add below `app.MapCustomerEndpoints();`:

```csharp
app.MapAccountEndpoints();
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~AccountEndpointTests"`
Expected: PASS — 7 tests.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Employee tests/PeakPower.Integration.Tests/Employee/AccountEndpointTests.cs
git commit -m "feat(employee-api): add account create, edit and deactivate endpoints [F01-R10..R17]"
```

---

### Task 14: Metering point endpoints — attach, edit, end-date

`[F01-R23]`…`[F01-R27]`. Attaching a connection to a customer, editing it, and closing its
validity period.

The interesting case is the overlap. `[F01-R26]` and `[AS-03]` say the same EAN may serve
different customers over non-overlapping periods, and that an overlap must be rejected. Migration
1 enforces that with `EXCLUDE USING gist (ean WITH =, validity WITH &&)` over a generated
half-open `daterange`. PostgreSQL raises SQLSTATE **23P01** (`exclusion_violation`) when the
constraint bites, and the endpoint turns that into a 409 with a sentence a human can act on. The
check is not repeated in application code: a database that permits the overlap has already lost
the argument, and a second check in C# would race.

**Files:**
- Create: `src/Hosts/PeakPower.Api.Employee/Endpoints/MeteringPointEndpoints.cs`
- Create: `src/Hosts/PeakPower.Api.Employee/Validation/MeteringPointValidators.cs`
- Modify: `src/Hosts/PeakPower.Api.Employee/Program.cs`
- Test: `tests/PeakPower.Integration.Tests/Employee/MeteringPointEndpointTests.cs`

**Interfaces:**
- Consumes: `ApiResults`, `Validate<T>()` and `EnumWireFormat` (Task 6); `BackOffice()` (Task 9); `MeteringPoint.Attach`, `UpdateDetails`, `Rename`, `EndDate`, `EanCode.Create` (Plan 1, shared contract §5.1 — all return `Result<T>`); `MeteringPointDto`, `AttachMeteringPointRequest`, `UpdateMeteringPointRequest`, `EndDateMeteringPointRequest` (Task 10); `EmployeeMappings.ToDto(MeteringPoint, string)` (Task 11).
- Produces:
  - `public static class MeteringPointEndpoints` — `IEndpointRouteBuilder MapMeteringPointEndpoints(this IEndpointRouteBuilder routes)`
  - routes `POST /api/v1/customers/{customerId:guid}/metering-points`, `PATCH /api/v1/metering-points/{id:guid}`, `POST /api/v1/metering-points/{id:guid}/end-date`
  - `public sealed class AttachMeteringPointRequestValidator : AbstractValidator<AttachMeteringPointRequest>`
  - `public sealed class UpdateMeteringPointRequestValidator : AbstractValidator<UpdateMeteringPointRequest>`
  - `public sealed class EndDateMeteringPointRequestValidator : AbstractValidator<EndDateMeteringPointRequest>`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Employee/MeteringPointEndpointTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Shouldly;
using PeakPower.Contracts.Employee;
using PeakPower.Integration.Tests.Tenancy;
using Xunit;

namespace PeakPower.Integration.Tests.Employee;

[Collection(nameof(TenancyCollection))]
public sealed class MeteringPointEndpointTests : IAsyncLifetime
{
    private readonly TenancyFixture _fixture;
    private EmployeeApiFactory _factory = null!;
    private HttpClient _client = null!;

    public MeteringPointEndpointTests(TenancyFixture fixture) => _fixture = fixture;

    public ValueTask InitializeAsync()
    {
        _factory = new EmployeeApiFactory(_fixture.OwnerConnectionString);
        _client = _factory.CreateEmployeeClient();
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private AttachMeteringPointRequest Attach(string ean, DateOnly validFrom) =>
        new(ean, _fixture.BrpId, "UNKNOWN", null, null, null, "Stedin", 250m, null, validFrom);

    [Fact]
    public async Task attaching_a_connection_returns_it_with_a_grouped_ean_and_a_brp_name()
    {
        using var response = await _client.PostAsJsonAsync(
            $"/api/v1/customers/{_fixture.CompanyAId}/metering-points",
            Attach("871687110000000301", new DateOnly(2026, 2, 1)));

        response.StatusCode.ShouldBe(HttpStatusCode.Created);
        var created = await response.Content.ReadFromJsonAsync<MeteringPointDto>();
        created!.Ean.ShouldBe("871687110000000301");
        created.EanDisplay.ShouldNotBe(created.Ean, "[F01-R31] the EAN is grouped for reading");
        created.BrpName.ShouldBe("PVNed B.V.");
        created.Commodity.ShouldBe("ELECTRICITY",
            "shared contract §5.2 — the wire spelling is the database spelling");
        created.ValidTo.ShouldBeNull();
        created.DisplayLabel.ShouldBe(created.EanDisplay, "[F01-R30] there is no friendly name yet");
    }

    [Fact]
    public async Task an_ean_that_is_not_eighteen_digits_is_rejected_at_the_boundary()
    {
        using var response = await _client.PostAsJsonAsync(
            $"/api/v1/customers/{_fixture.CompanyAId}/metering-points",
            Attach("8716871", new DateOnly(2026, 2, 1)));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).ShouldContain("Ean");
    }

    [Fact]
    public async Task an_overlapping_period_for_the_same_ean_is_a_conflict()
    {
        const string ean = "871687110000000401";

        using var first = await _client.PostAsJsonAsync(
            $"/api/v1/customers/{_fixture.CompanyAId}/metering-points",
            Attach(ean, new DateOnly(2026, 1, 1)));
        first.StatusCode.ShouldBe(HttpStatusCode.Created);

        using var second = await _client.PostAsJsonAsync(
            $"/api/v1/customers/{_fixture.CompanyBId}/metering-points",
            Attach(ean, new DateOnly(2026, 3, 1)));

        second.StatusCode.ShouldBe(HttpStatusCode.Conflict,
            "[F01-R26] the same EAN may not serve two customers over overlapping periods");
        (await second.Content.ReadAsStringAsync()).ShouldContain(ean);
    }

    [Fact]
    public async Task the_same_ean_may_move_to_another_customer_once_the_period_is_closed()
    {
        const string ean = "871687110000000501";

        using var first = await _client.PostAsJsonAsync(
            $"/api/v1/customers/{_fixture.CompanyAId}/metering-points",
            Attach(ean, new DateOnly(2026, 1, 1)));
        var original = await first.Content.ReadFromJsonAsync<MeteringPointDto>();

        using var endDated = await _client.PostAsJsonAsync(
            $"/api/v1/metering-points/{original!.Id}/end-date",
            new EndDateMeteringPointRequest(new DateOnly(2026, 6, 1)));
        endDated.StatusCode.ShouldBe(HttpStatusCode.OK);

        using var second = await _client.PostAsJsonAsync(
            $"/api/v1/customers/{_fixture.CompanyBId}/metering-points",
            Attach(ean, new DateOnly(2026, 6, 1)));

        second.StatusCode.ShouldBe(HttpStatusCode.Created,
            "the range is half-open, so 1 June is the first day of the new period");
    }

    [Fact]
    public async Task editing_a_connection_sets_the_friendly_name_and_the_display_label_follows()
    {
        using var created = await _client.PostAsJsonAsync(
            $"/api/v1/customers/{_fixture.CompanyAId}/metering-points",
            Attach("871687110000000601", new DateOnly(2026, 2, 1)));
        var meteringPoint = await created.Content.ReadFromJsonAsync<MeteringPointDto>();

        var update = new UpdateMeteringPointRequest(
            _fixture.BrpId, "EXPECTED", "CONTRACT", "Dakinstallatie noord",
            "Zonnepanelen op het noorddak", "Stedin", 300m, null);

        using var response = await _client.PatchAsJsonAsync(
            $"/api/v1/metering-points/{meteringPoint!.Id}", update);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var updated = await response.Content.ReadFromJsonAsync<MeteringPointDto>();
        updated!.Name.ShouldBe("Dakinstallatie noord");
        updated.DisplayLabel.ShouldBe("Dakinstallatie noord", "[F01-R30]");
        updated.ProductionExpectation.ShouldBe("EXPECTED");
        updated.ExpectationSource.ShouldBe("CONTRACT");
        updated.CapacityKw.ShouldBe(300m);
    }

    [Fact]
    public async Task a_friendly_name_over_eighty_characters_is_rejected()
    {
        using var created = await _client.PostAsJsonAsync(
            $"/api/v1/customers/{_fixture.CompanyAId}/metering-points",
            Attach("871687110000000701", new DateOnly(2026, 2, 1)));
        var meteringPoint = await created.Content.ReadFromJsonAsync<MeteringPointDto>();

        var update = new UpdateMeteringPointRequest(
            _fixture.BrpId, "UNKNOWN", null, new string('x', 81), null, null, null, null);

        using var response = await _client.PatchAsJsonAsync(
            $"/api/v1/metering-points/{meteringPoint!.Id}", update);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest, "[F01-R29] the name is at most 80");
    }

    [Fact]
    public async Task an_end_date_before_the_start_date_is_a_bad_request()
    {
        using var created = await _client.PostAsJsonAsync(
            $"/api/v1/customers/{_fixture.CompanyAId}/metering-points",
            Attach("871687110000000801", new DateOnly(2026, 5, 1)));
        var meteringPoint = await created.Content.ReadFromJsonAsync<MeteringPointDto>();

        using var response = await _client.PostAsJsonAsync(
            $"/api/v1/metering-points/{meteringPoint!.Id}/end-date",
            new EndDateMeteringPointRequest(new DateOnly(2026, 1, 1)));

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task an_unknown_connection_is_not_found()
    {
        using var response = await _client.PostAsJsonAsync(
            $"/api/v1/metering-points/{Guid.NewGuid()}/end-date",
            new EndDateMeteringPointRequest(new DateOnly(2026, 12, 1)));

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }
}
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~MeteringPointEndpointTests"`
Expected: FAIL — `Expected response.StatusCode to be HttpStatusCode.Created, but found HttpStatusCode.NotFound`.

- [ ] **Step 3: Write the validators**

Create `src/Hosts/PeakPower.Api.Employee/Validation/MeteringPointValidators.cs`:

```csharp
using FluentValidation;
using PeakPower.Contracts.Employee;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Web.Http;

namespace PeakPower.Api.Employee.Validation;

internal static class MeteringPointRules
{
    // Generated from the enums in the wire spelling, so the accepted values, the error message
    // and what the mappers emit are one list. Shared contract §5.2: UNKNOWN, NEVER, EXPECTED and
    // CONTRACT, GRID_OPERATOR, OBSERVED, MANUAL, CUSTOMER_DECLARED.
    internal static readonly string[] Expectations =
        EnumWireFormat.Names<ProductionExpectation>();

    internal static readonly string[] ExpectationSources =
        EnumWireFormat.Names<ProductionExpectationSource>();
}

public sealed class AttachMeteringPointRequestValidator : AbstractValidator<AttachMeteringPointRequest>
{
    public AttachMeteringPointRequestValidator()
    {
        // [DEC-114] — the proof of concept validates the EAN on length only. The GS1 check
        // digit is reinstated before go-live; see [OQ-97].
        RuleFor(request => request.Ean)
            .NotEmpty()
            .Matches("^[0-9]{18}$")
            .WithMessage("An EAN is exactly eighteen digits.");

        RuleFor(request => request.BrpId)
            .NotEmpty()
            .WithMessage("A balance responsible party is required. [F01-R51]");

        RuleFor(request => request.ProductionExpectation)
            .Must(value => MeteringPointRules.Expectations.Contains(value, StringComparer.Ordinal))
            .WithMessage($"Production expectation must be one of: {string.Join(", ", MeteringPointRules.Expectations)}.");

        RuleFor(request => request.ExpectationSource!)
            .Must(value => MeteringPointRules.ExpectationSources.Contains(value, StringComparer.Ordinal))
            .When(request => request.ExpectationSource is not null)
            .WithMessage($"Expectation source must be one of: {string.Join(", ", MeteringPointRules.ExpectationSources)}.");

        // [F01-R29] — the friendly name is at most 80 and the description at most 500.
        RuleFor(request => request.Name).MaximumLength(80);
        RuleFor(request => request.Description).MaximumLength(500);
        RuleFor(request => request.GridOperator).MaximumLength(120);
        RuleFor(request => request.CapacityKw).GreaterThan(0).When(request => request.CapacityKw is not null);
    }
}

public sealed class UpdateMeteringPointRequestValidator : AbstractValidator<UpdateMeteringPointRequest>
{
    public UpdateMeteringPointRequestValidator()
    {
        RuleFor(request => request.BrpId)
            .NotEmpty()
            .WithMessage("A balance responsible party is required. [F01-R51]");

        RuleFor(request => request.ProductionExpectation)
            .Must(value => MeteringPointRules.Expectations.Contains(value, StringComparer.Ordinal))
            .WithMessage($"Production expectation must be one of: {string.Join(", ", MeteringPointRules.Expectations)}.");

        RuleFor(request => request.ExpectationSource!)
            .Must(value => MeteringPointRules.ExpectationSources.Contains(value, StringComparer.Ordinal))
            .When(request => request.ExpectationSource is not null)
            .WithMessage($"Expectation source must be one of: {string.Join(", ", MeteringPointRules.ExpectationSources)}.");

        RuleFor(request => request.Name).MaximumLength(80);
        RuleFor(request => request.Description).MaximumLength(500);
        RuleFor(request => request.GridOperator).MaximumLength(120);
        RuleFor(request => request.CapacityKw).GreaterThan(0).When(request => request.CapacityKw is not null);
    }
}

public sealed class EndDateMeteringPointRequestValidator : AbstractValidator<EndDateMeteringPointRequest>
{
    public EndDateMeteringPointRequestValidator() =>
        RuleFor(request => request.ValidTo).NotEmpty();
}
```

- [ ] **Step 4: Write the endpoints**

Create `src/Hosts/PeakPower.Api.Employee/Endpoints/MeteringPointEndpoints.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PeakPower.Api.Employee.Mapping;
using PeakPower.Contracts.Employee;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Web.Http;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;

namespace PeakPower.Api.Employee.Endpoints;

public static class MeteringPointEndpoints
{
    private const string BackOfficeReason =
        "Back-office staff attach and administer connections for every customer company.";

    public static IEndpointRouteBuilder MapMeteringPointEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapPost("/api/v1/customers/{customerId:guid}/metering-points", AttachAsync)
            .WithTags("Metering points")
            .WithName("AttachMeteringPoint")
            .WithSummary("Attaches an electricity connection to a customer. [F01-R23]")
            .Produces<MeteringPointDto>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .Validate<AttachMeteringPointRequest>()
            .BackOffice(BackOfficeReason);

        routes.MapPatch("/api/v1/metering-points/{id:guid}", UpdateAsync)
            .WithTags("Metering points")
            .WithName("UpdateMeteringPoint")
            .WithSummary("Edits a connection. The EAN and the customer are immutable. [F01-R25]")
            .Produces<MeteringPointDto>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .Validate<UpdateMeteringPointRequest>()
            .BackOffice(BackOfficeReason);

        routes.MapPost("/api/v1/metering-points/{id:guid}/end-date", EndDateAsync)
            .WithTags("Metering points")
            .WithName("EndDateMeteringPoint")
            .WithSummary("Closes a connection's validity period. [F01-R27]")
            .Produces<MeteringPointDto>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .Validate<EndDateMeteringPointRequest>()
            .BackOffice(BackOfficeReason);

        return routes;
    }

    private static async Task<IResult> AttachAsync(
        Guid customerId,
        AttachMeteringPointRequest request,
        PeakPowerDbContext db,
        CancellationToken cancellationToken)
    {
        var customerExists = await db.Customers
            .AsNoTracking()
            .AnyAsync(customer => customer.Id == customerId, cancellationToken);

        if (!customerExists)
        {
            return ApiResults.NotFound();
        }

        var ean = EanCode.Create(request.Ean);
        if (!ean.IsSuccess)
        {
            return ApiResults.InvalidRequest(nameof(request.Ean), ean.Error);
        }

        var brp = await db.Brps
            .AsNoTracking()
            .FirstOrDefaultAsync(candidate => candidate.Id == request.BrpId, cancellationToken);

        if (brp is null)
        {
            return ApiResults.InvalidRequest(
                nameof(request.BrpId), "No balance responsible party has that identifier.");
        }

        // The factory is Attach, not Create — [F01-R23] is "attach a connection to a customer".
        // Commodity is not a parameter: [DEC-68] makes ELECTRICITY the only value, so the
        // aggregate sets it. The request carries the wire spelling of both enums, so the parse
        // goes through EnumWireFormat; the validator has already rejected anything unknown.
        var attached = MeteringPoint.Attach(
            customerId,
            ean.Value,
            request.BrpId,
            EnumWireFormat.Parse<ProductionExpectation>(request.ProductionExpectation),
            request.ExpectationSource is null
                ? null
                : EnumWireFormat.Parse<ProductionExpectationSource>(request.ExpectationSource),
            request.Name,
            request.Description,
            request.GridOperator,
            request.CapacityKw,
            request.Address is null ? null : EmployeeMappings.ToDomain(request.Address),
            request.ValidFrom);

        if (!attached.IsSuccess)
        {
            return ApiResults.InvalidRequest(nameof(request.ValidFrom), attached.Error);
        }

        var meteringPoint = attached.Value;

        db.MeteringPoints.Add(meteringPoint);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsExclusionViolation(exception))
        {
            // [F01-R26] / [AS-03] — enforced by
            // EXCLUDE USING gist (ean WITH =, validity WITH &&) in migration 1, not in C#.
            // A second check here would race with a concurrent insert.
            db.ChangeTracker.Clear();
            return ApiResults.Conflict(
                $"EAN {request.Ean} is already attached to a customer over a period that overlaps " +
                $"{request.ValidFrom:yyyy-MM-dd}. End-date the existing connection first.");
        }

        return Results.Created(
            $"/api/v1/metering-points/{meteringPoint.Id}",
            EmployeeMappings.ToDto(meteringPoint, brp.Name));
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        UpdateMeteringPointRequest request,
        PeakPowerDbContext db,
        CancellationToken cancellationToken)
    {
        var meteringPoint = await db.MeteringPoints
            .FirstOrDefaultAsync(candidate => candidate.Id == id, cancellationToken);

        if (meteringPoint is null)
        {
            return ApiResults.NotFound();
        }

        var brp = await db.Brps
            .AsNoTracking()
            .FirstOrDefaultAsync(candidate => candidate.Id == request.BrpId, cancellationToken);

        if (brp is null)
        {
            return ApiResults.InvalidRequest(
                nameof(request.BrpId), "No balance responsible party has that identifier.");
        }

        // Two mutators, one request body. Shared contract §5.1 splits the aggregate's edit into
        // UpdateDetails, which carries the settlement facts, and Rename, which carries the two
        // human-facing strings and owns the 80/500 limits [F01-R29]. PATCH accepts both at once,
        // so the endpoint calls both and returns on the first failure. Nothing is persisted
        // unless both succeed: SaveChangesAsync is below them, so a rejected rename leaves the
        // tracked entity dirty but the row untouched, and the request is a 400.
        var detailsUpdated = meteringPoint.UpdateDetails(
            request.BrpId,
            EnumWireFormat.Parse<ProductionExpectation>(request.ProductionExpectation),
            request.ExpectationSource is null
                ? null
                : EnumWireFormat.Parse<ProductionExpectationSource>(request.ExpectationSource),
            request.GridOperator,
            request.CapacityKw,
            request.Address is null ? null : EmployeeMappings.ToDomain(request.Address));

        if (!detailsUpdated.IsSuccess)
        {
            return ApiResults.InvalidRequest(nameof(request.BrpId), detailsUpdated.Error);
        }

        var renamed = meteringPoint.Rename(request.Name, request.Description);
        if (!renamed.IsSuccess)
        {
            return ApiResults.InvalidRequest(nameof(request.Name), renamed.Error);
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(EmployeeMappings.ToDto(meteringPoint, brp.Name));
    }

    private static async Task<IResult> EndDateAsync(
        Guid id,
        EndDateMeteringPointRequest request,
        PeakPowerDbContext db,
        CancellationToken cancellationToken)
    {
        var meteringPoint = await db.MeteringPoints
            .FirstOrDefaultAsync(candidate => candidate.Id == id, cancellationToken);

        if (meteringPoint is null)
        {
            return ApiResults.NotFound();
        }

        var result = meteringPoint.EndDate(request.ValidTo);
        if (!result.IsSuccess)
        {
            return ApiResults.InvalidRequest(nameof(request.ValidTo), result.Error);
        }

        await db.SaveChangesAsync(cancellationToken);

        var brpName = await db.Brps
            .AsNoTracking()
            .Where(brp => brp.Id == meteringPoint.BrpId)
            .Select(brp => brp.Name)
            .FirstOrDefaultAsync(cancellationToken) ?? string.Empty;

        return Results.Ok(EmployeeMappings.ToDto(meteringPoint, brpName));
    }

    private static bool IsExclusionViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.ExclusionViolation,
        };
}
```

- [ ] **Step 5: Map the endpoints in the composition root**

In `src/Hosts/PeakPower.Api.Employee/Program.cs`, add below `app.MapAccountEndpoints();`:

```csharp
app.MapMeteringPointEndpoints();
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~MeteringPointEndpointTests"`
Expected: PASS — 8 tests.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Employee tests/PeakPower.Integration.Tests/Employee/MeteringPointEndpointTests.cs
git commit -m "feat(employee-api): add metering point attach, edit and end-date endpoints [F01-R23..R27]"
```

---
### Task 15: The employee API route-table gate

Point the Task 9 harness at the real employee host. Two things get proved:

1. **Every endpoint the employee API registers has declared itself.** Today they are all
   `.BackOffice(reason)`. The moment someone maps an endpoint and forgets, the build goes red with
   the route printed. This is the property that survives the sprint.
2. **The employee API really is not tenant-scoped.** An assertion that an employee sees both
   companies' objects, so that a well-meaning future change that scopes this host to a tenant
   fails loudly rather than quietly breaking the back office.

**Files:**
- Test: `tests/PeakPower.Integration.Tests/Employee/EmployeeRouteTableTests.cs`

**Interfaces:**
- Consumes: `RouteTable.Enumerate` (Task 9); `EmployeeApiFactory` (Task 11); `TenancyFixture` (Task 4).
- Produces: nothing consumed by later tasks. Plans 5 and 6 add one more class of this shape per host.

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Employee/EmployeeRouteTableTests.cs`:

```csharp
using System.Net.Http.Json;
using Shouldly;
using PeakPower.Contracts.Employee;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Integration.Tests.Tenancy;
using Xunit;

namespace PeakPower.Integration.Tests.Employee;

[Collection(nameof(TenancyCollection))]
public sealed class EmployeeRouteTableTests : IAsyncLifetime
{
    private readonly TenancyFixture _fixture;
    private EmployeeApiFactory _factory = null!;
    private HttpClient _client = null!;

    public EmployeeRouteTableTests(TenancyFixture fixture) => _fixture = fixture;

    public ValueTask InitializeAsync()
    {
        _factory = new EmployeeApiFactory(_fixture.OwnerConnectionString);
        _client = _factory.CreateEmployeeClient();

        // WebApplicationFactory builds its host lazily; creating a client forces it, which is
        // what makes factory.Services — and therefore the endpoint table — available.
        return ValueTask.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    [Fact]
    public void every_employee_endpoint_declares_its_tenancy()
    {
        var undeclared = RouteTable.Enumerate(_factory.Services)
            .Where(entry => entry.Classification is null)
            .Select(entry => entry.ToString())
            .ToArray();

        undeclared.ShouldBeEmpty(
            "every endpoint must call .TenantScoped(kind), .BackOffice(reason) or " +
            ".AnonymousEndpoint(reason) where it is mapped, so the route-table test can reason " +
            "about it. A new endpoint that declares nothing fails here, by design.");
    }

    [Fact]
    public void every_employee_endpoint_is_back_office_and_says_why()
    {
        var entries = RouteTable.Enumerate(_factory.Services);

        entries.ShouldNotBeEmpty("the employee API maps eleven endpoints under /api/v1");

        entries.ShouldAllBe(
            entry => entry.Classification!.Scope == TenancyScope.BackOffice,
            "the employee API is deliberately not tenant-scoped; a tenant-scoped endpoint here " +
            "would mean somebody narrowed the back office to one customer");

        entries.ShouldAllBe(
            entry => !string.IsNullOrWhiteSpace(entry.Classification!.Reason),
            "an exemption without a stated reason is an exemption nobody will ever revisit");
    }

    [Fact]
    public async Task an_employee_sees_the_objects_of_every_customer()
    {
        var list = await _client.GetFromJsonAsync<CustomerListResponse>(
            "/api/v1/customers?pageSize=100");

        list!.Items.Select(customer => customer.Id)
            .ShouldContain([_fixture.CompanyAId, _fixture.CompanyBId],
                "back-office staff administer every customer company; scoping this API to one " +
                "tenant would break it");
    }

    [Fact]
    public async Task an_employee_can_open_the_detail_of_any_customer()
    {
        var companyA = await _client.GetFromJsonAsync<CustomerDetailDto>(
            $"/api/v1/customers/{_fixture.CompanyAId}");
        var companyB = await _client.GetFromJsonAsync<CustomerDetailDto>(
            $"/api/v1/customers/{_fixture.CompanyBId}");

        companyA!.Id.ShouldBe(_fixture.CompanyAId);
        companyB!.Id.ShouldBe(_fixture.CompanyBId);
    }
}
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~EmployeeRouteTableTests"`
Expected: FAIL if any endpoint mapped in Tasks 11–14 is missing its `.BackOffice(...)` call, with
the offending `METHOD /route` printed. If all four endpoint modules were written as specified,
these pass first time — in which case go to Step 3 and confirm the gate actually bites.

- [ ] **Step 3: Prove the gate bites on the real host**

Temporarily delete the `.BackOffice(BackOfficeReason)` line from the `DeactivateAccount` mapping
in `src/Hosts/PeakPower.Api.Employee/Endpoints/AccountEndpoints.cs`.

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~every_employee_endpoint_declares_its_tenancy"`
Expected: FAIL with `Expected undeclared to be empty, but found {"POST /api/v1/accounts/{id:guid}/deactivate"}`.

Restore the line and re-run to confirm PASS.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~EmployeeRouteTableTests"`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Employee/EmployeeRouteTableTests.cs
git commit -m "test(employee-api): gate every endpoint on a tenancy declaration"
```

---

### Task 16: OpenAPI emitted at build, and the contract snapshot

Two separate things, both needed:

- **Emission at build.** `Microsoft.Extensions.ApiDescription.Server` runs the host's document
  generation as an MSBuild step and writes `artifacts/openapi/employee.json`. That file is
  committed, and Plan 4 generates `@peakpower/api-client-employee` from it.
- **A Verify snapshot.** The emitted document is compared against a reviewed copy. Any change to
  a route, a status code or a DTO shape turns the test red, and the only way to make it green is
  to look at the diff and accept it. That is the point: an API contract change should cost a
  deliberate act, because a second repository is generated from it.

**Files:**
- Modify: `src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj`
- Create: `artifacts/openapi/employee.json` (generated, committed)
- Create: `tests/PeakPower.Integration.Tests/Contract/RepositoryRoot.cs`
- Create: `tests/PeakPower.Integration.Tests/Contract/EmployeeOpenApiSnapshotTests.cs`
- Create: `tests/PeakPower.Integration.Tests/Contract/EmployeeOpenApiSnapshotTests.the_employee_openapi_document_matches_the_reviewed_snapshot.verified.json` (generated, committed)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the employee host and all its endpoints (Tasks 11–14).
- Produces:
  - `artifacts/openapi/employee.json` — consumed by Plan 4's `npm run generate:clients`
  - `internal static class RepositoryRoot` — `public static string Find()`

- [ ] **Step 1: Turn on build-time document generation**

Add to the first `<PropertyGroup>` in
`src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj`:

```xml
    <!-- Emit the OpenAPI document at build. Plan 4 generates the typed npm client from it,
         and the snapshot test below fails the build on an unreviewed contract change. -->
    <OpenApiGenerateDocuments>true</OpenApiGenerateDocuments>
    <OpenApiDocumentsDirectory>$(MSBuildProjectDirectory)/../../../artifacts/openapi</OpenApiDocumentsDirectory>
    <OpenApiGenerateDocumentsOptions>--file-name employee</OpenApiGenerateDocumentsOptions>
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

Make sure `artifacts/` is not ignored wholesale. If `.gitignore` contains `artifacts/`, change it
to keep the OpenAPI documents:

```gitignore
artifacts/
!artifacts/openapi/
!artifacts/openapi/*.json
```

- [ ] **Step 2: Build and confirm the document is emitted**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build src/Hosts/PeakPower.Api.Employee
ls -l artifacts/openapi/employee.json
python3 -c "import json,sys; d=json.load(open('artifacts/openapi/employee.json')); print('\n'.join(sorted(d['paths'])))"
```

Expected: `employee.json` exists, and the path list is exactly:

```
/api/v1/accounts/{id}
/api/v1/accounts/{id}/deactivate
/api/v1/customers
/api/v1/customers/{customerId}/accounts
/api/v1/customers/{customerId}/metering-points
/api/v1/customers/{id}
/api/v1/metering-points/{id}
/api/v1/metering-points/{id}/end-date
/api/v1/reference-data/brps
```

- [ ] **Step 3: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Contract/RepositoryRoot.cs`:

```csharp
namespace PeakPower.Integration.Tests.Contract;

internal static class RepositoryRoot
{
    /// <summary>
    /// Walks up from the test binaries until it finds the solution file. Tests run from
    /// bin/Debug/net10.0, so a relative path from the current directory would be brittle.
    /// </summary>
    public static string Find()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "PeakPower.sln")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        throw new InvalidOperationException(
            $"PeakPower.sln was not found above {AppContext.BaseDirectory}.");
    }
}
```

Create `tests/PeakPower.Integration.Tests/Contract/EmployeeOpenApiSnapshotTests.cs`:

```csharp
using System.Text.Json;
using Shouldly;
using VerifyXunit;
using Xunit;

namespace PeakPower.Integration.Tests.Contract;

/// <summary>
/// The employee API's contract, frozen. `peakpower-web` generates a typed client from this
/// document, so an unreviewed change here silently breaks a second repository. Turning that into
/// a red build is the cheapest place to catch it.
/// </summary>
public sealed class EmployeeOpenApiSnapshotTests
{
    private static string DocumentPath =>
        Path.Combine(RepositoryRoot.Find(), "artifacts", "openapi", "employee.json");

    [Fact]
    public void the_document_is_emitted_at_build()
    {
        File.Exists(DocumentPath).ShouldBeTrue(
            $"building PeakPower.Api.Employee must write {DocumentPath}; check that " +
            "OpenApiGenerateDocuments is true in the project file");
    }

    [Fact]
    public async Task the_employee_openapi_document_matches_the_reviewed_snapshot()
    {
        var json = await File.ReadAllTextAsync(DocumentPath);

        // Re-serialise with sorted, indented output so a whitespace or ordering change in the
        // generator does not read as a contract change.
        using var document = JsonDocument.Parse(json);
        var normalised = JsonSerializer.Serialize(
            document.RootElement,
            new JsonSerializerOptions { WriteIndented = true });

        await Verify(normalised).UseExtension("json");
    }
}
```

Add the package and the `Verify` global using to
`tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj`:

```xml
<ItemGroup>
  <PackageReference Include="Verify.Xunit" />
</ItemGroup>

<ItemGroup>
  <Using Include="VerifyXunit.Verifier" Static="true" />
</ItemGroup>
```

- [ ] **Step 4: Run the test and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~EmployeeOpenApiSnapshotTests"`
Expected: FAIL — `VerifyException: Directory: …/Contract` with `New: EmployeeOpenApiSnapshotTests.the_employee_openapi_document_matches_the_reviewed_snapshot.received.json`, because no verified snapshot exists yet.

- [ ] **Step 5: Review the received document and accept it**

Read the received file. Check, specifically:

- nine paths, matching the list in Step 2
- no path outside `/api/v1`
- no `password`, `passwordHash` or `securityStamp` anywhere in the document
- every mutating endpoint declares a `400` with `application/problem+json`

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -ci "password\|securitystamp" \
  tests/PeakPower.Integration.Tests/Contract/EmployeeOpenApiSnapshotTests.the_employee_openapi_document_matches_the_reviewed_snapshot.received.json
```

Expected: `0`.

Then accept it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract
mv EmployeeOpenApiSnapshotTests.the_employee_openapi_document_matches_the_reviewed_snapshot.received.json \
   EmployeeOpenApiSnapshotTests.the_employee_openapi_document_matches_the_reviewed_snapshot.verified.json
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~EmployeeOpenApiSnapshotTests"`
Expected: PASS — 2 tests.

- [ ] **Step 7: Prove the snapshot bites**

Temporarily add `.WithSummary("changed")` to the `ListBalanceResponsibleParties` mapping in
`src/Hosts/PeakPower.Api.Employee/Endpoints/ReferenceDataEndpoints.cs`, rebuild, and re-run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build src/Hosts/PeakPower.Api.Employee
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~matches_the_reviewed_snapshot"
```

Expected: FAIL with a diff showing the changed summary. Revert the change, rebuild, delete any
`.received.json`, and re-run to confirm PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add .gitignore src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj \
  artifacts/openapi/employee.json \
  tests/PeakPower.Integration.Tests/Contract \
  tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj
git commit -m "feat(employee-api): emit employee.json at build and freeze it behind a snapshot test"
```

---

### Task 17: Wire the employee API into the AppHost

The last piece: `./dev-up` must bring the employee API up behind the migrator. `WaitForCompletion`
rather than `WaitFor` — the migrator is a job that runs to exit, not a service that stays up, and
an API that starts before migration 2 has applied would connect as a role that does not exist yet.

**Files:**
- Modify: `src/Hosts/PeakPower.AppHost/AppHost.cs`
- Modify: `src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj`
- Test: `tests/PeakPower.Integration.Tests/Hosting/AppHostWiringTests.cs`

**Interfaces:**
- Consumes: Plan 1's AppHost with resources `postgres`, the `peakpower` database and `migrator`; the employee host (Task 11).
- Produces: an Aspire resource named `employee-api`. Plan 4's employee portal reads its address through `PEAKPOWER_EMPLOYEE_API` (added there, not here).

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Hosting/AppHostWiringTests.cs`:

```csharp
using Aspire.Hosting;
using Aspire.Hosting.ApplicationModel;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Hosting;

/// <summary>
/// Builds the distributed application model without starting any container, and asserts the
/// resource graph. Cheap, and it catches the failure that costs an afternoon: an API that boots
/// before the migrator has finished.
/// </summary>
public sealed class AppHostWiringTests
{
    [Fact]
    public async Task the_employee_api_is_registered_and_waits_for_the_migrator_to_complete()
    {
        var builder = await DistributedApplicationTestingBuilder
            .CreateAsync<Projects.PeakPower_AppHost>();

        var employeeApi = builder.Resources
            .SingleOrDefault(resource => resource.Name == "employee-api");

        employeeApi.ShouldNotBeNull("dev-up must bring the employee API up");

        var waits = employeeApi!.Annotations.OfType<WaitAnnotation>().ToArray();

        waits.ShouldContain(
            wait => wait.Resource.Name == "migrator"
                    && wait.WaitType == WaitType.WaitForCompletion,
            "the employee API connects as peakpower_employee, a role that migration 2 creates");
    }

    [Fact]
    public async Task the_employee_api_is_told_which_database_role_to_use()
    {
        var builder = await DistributedApplicationTestingBuilder
            .CreateAsync<Projects.PeakPower_AppHost>();

        var employeeApi = builder.Resources.Single(resource => resource.Name == "employee-api");

        employeeApi.Annotations.OfType<EnvironmentCallbackAnnotation>()
            .ShouldNotBeEmpty(
                "the host must receive Tenancy__DatabaseRole, or it will connect as the table " +
                "owner and row-level security will not apply to it");
    }
}
```

Add the Aspire testing package to
`tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj`:

```xml
<ItemGroup>
  <PackageReference Include="Aspire.Hosting.Testing" />
  <ProjectReference Include="../../src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj">
    <IsAspireProjectResource>false</IsAspireProjectResource>
  </ProjectReference>
</ItemGroup>
```

and to `Directory.Packages.props`:

```xml
<PackageVersion Include="Aspire.Hosting.Testing" Version="13.5.3" />
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~AppHostWiringTests"`
Expected: FAIL — `Expected employeeApi not to be <null> because dev-up must bring the employee API up`.

- [ ] **Step 3: Reference the employee host from the AppHost**

Add to `src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj`:

```xml
<ItemGroup>
  <ProjectReference Include="../PeakPower.Api.Employee/PeakPower.Api.Employee.csproj" />
</ItemGroup>
```

- [ ] **Step 4: Add the resource**

In `src/Hosts/PeakPower.AppHost/AppHost.cs`, after the `migrator` resource that Plan 1 declared
and before `builder.Build().Run();`:

```csharp
// The employee API connects as `peakpower_employee`, a login role that migration 2 creates, so
// it must not start until the migrator has run to completion. WaitForCompletion, not WaitFor:
// the migrator is a job that exits, not a service that stays up.
var employeeApi = builder.AddProject<Projects.PeakPower_Api_Employee>("employee-api")
    .WithReference(peakpowerDb)
    .WaitForCompletion(migrator)
    .WithEnvironment("Tenancy__DatabaseRole", "peakpower_employee")
    .WithEnvironment("Tenancy__DatabasePassword", "dev_only_employee_password")
    .WithHttpHealthCheck("/health");
```

`peakpowerDb` and `migrator` are the variables Plan 1 assigned to the `peakpower` database
resource and the `migrator` project resource. If Plan 1 named them differently, use its names —
the resource *names* (`"peakpower"`, `"migrator"`) are what the shared contract fixes, not the
C# variable names.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~AppHostWiringTests"`
Expected: PASS — 2 tests.

- [ ] **Step 6: Bring the whole thing up by hand once**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
./dev-up
```

Then, in another terminal:

```bash
curl -s -H "X-PeakPower-Employee-Id: iris.dekker" \
  "$(aspire --version >/dev/null 2>&1; echo http://localhost:5100)/api/v1/reference-data/brps" | head
```

Expected: a JSON array containing the PVNed row. Read the actual employee-api address off the
Aspire dashboard rather than assuming the port; the dashboard URL is printed by `dev-up`.

Stop it with Ctrl-C.

- [ ] **Step 7: Run every test in the solution**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test`
Expected: PASS — every project, no skips.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.AppHost Directory.Packages.props \
  tests/PeakPower.Integration.Tests
git commit -m "feat(apphost): run the employee API behind WaitForCompletion(migrator)"
```

---
## Handoff to the plans that follow

Read this before starting Plan 5 or Plan 6.

| Plan | What it must do with this plan's work |
| --- | --- |
| 4 · Employee portal | Generate `@peakpower/api-client-employee` from `artifacts/openapi/employee.json`. Send `X-PeakPower-Employee-Id` on every request until back-office authentication exists. The customer list is `CustomerListResponse { items, total }` over `CustomerListItemDto`, whose rows carry `city`, `accountCount` and `meteringPointCount`; every enum on the wire is the database spelling (`ACTIVE`, `PENDING_APPROVAL`, `CUSTOMER_DECLARED`), so build label maps on those literals and never on PascalCase. `BrpDto` carries `isActive` and no EAN — the aggregate has none. `UpdateCustomerRequest` takes `status` and omits `kvkNumber`, and no request on this API carries a bank account: bank details belong to Plan 5's onboarding. The two nested POSTs are `/customers/{customerId}/accounts` and `/customers/{customerId}/metering-points`. |
| 5 · Auth & onboarding | Put the token-backed `ICustomerContext` in **`PeakPower.Infrastructure.Web`**, not in `PeakPower.Api.Customer` — architecture fact 6 forbids reading `customer_id` anywhere else, and Task 8 enforces it. Register it in place of `DevelopmentCustomerContext` outside Development. Connect `PeakPower.Api.Customer` as **`peakpower_app`** with `Tenancy:DatabaseRole`, call `app.UseTenantScope()`, and add the `security_stamp` comparison inside the transaction that middleware already opens. Revisit `customer.refresh_token`, `customer.password_reset_token` and `customer.onboarding_application`, which migration 2 deliberately left without a policy because all three are read before the caller's customer is known. |
| 6 · Customer portal | Every new customer endpoint calls `.TenantScoped(kind)`, and every mutating one gets an entry in `TenancyFixture.SampleBodies`. Add `CustomerApiRouteTableTests` running **both** arms of the harness — `every_registered_endpoint_declares_its_tenancy` and the cross-tenant 404 arm — against `WebApplicationFactory<CustomerApiEntryPoint>`; the harness is already written, and until something points it at the customer host that host's tenancy rests on hand-written per-endpoint tests, which is the decaying list design §6 rejected. Register `EnumWireFormat.Converter` on that host too, and map its enums with `EnumWireFormat.ToWire` so the two APIs cannot disagree about one value. Any new customer-owned entity needs a `HasQueryFilter` (Task 3's model test catches it) **and** a policy pair in a new migration (nothing catches that automatically; add the table to `RowLevelSecurityTests`). |

---

## Definition of done

1. `dotnet test` passes across every project in `peakpower-platform`, with no skipped tests.
2. `dotnet build src/Hosts/PeakPower.Api.Employee` writes `artifacts/openapi/employee.json`, and
   that file is committed together with its `.verified.json` snapshot.
3. `RouteTableTenancyTests` passes: signed in as company A, every one of company B's objects
   returns 404, the collection endpoint returns none of company B's identifiers, and the
   cross-tenant 404 body is byte-identical to a genuinely-missing 404 body.
4. `every_registered_endpoint_declares_its_tenancy` passes on both the probe host and the real
   employee host, and removing a `.BackOffice(...)` call from any endpoint turns it red.
5. `RowLevelSecurityTests` passes: `peakpower_app` sees one company's rows with
   `app.customer_id` set, **zero** rows with it unset, cannot read another company's row by
   primary key, and is refused by SQLSTATE 42501 when it tries to insert a row for another
   company. `peakpower_employee` sees both companies.
6. `TenancyArchitectureTests` passes — no `IgnoreQueryFilters()`, no 403, and outside
   `PeakPower.Infrastructure.Web` no `HttpContext` dependency, no claim read off a
   `ClaimsPrincipal` or `ClaimsIdentity`, and no customer-identifier literal — and the
   `IgnoreQueryFilters()`, 403 and literal bans have each been watched to fail once against a
   deliberate violation.
7. `QueryFilterModelTests` passes: every entity type with a `CustomerId` has a global query filter,
   and `Brp` does not.
8. `TenancyStartupGuardTests` passes: a host with `DevelopmentCustomerContext` or
   `HeaderEmployeeContext` registered refuses to boot in Production `[F13-R31]`.
9. The employee API serves all nine paths listed in Task 16 Step 2, returns
   `application/problem+json` for every failure, and **is not tenant-scoped**:
   `an_employee_sees_the_objects_of_every_customer` passes.
10. Attaching an EAN whose validity period overlaps an existing one returns 409, and attaching it
    from the first day after the previous period was end-dated returns 201 `[F01-R26]`.
11. Editing or deactivating an account changes its `security_stamp` `[F01-R16]`.
12. Every enum on the wire is the database spelling: `EnumWireFormatTests` passes, and in
    `artifacts/openapi/employee.json` `grep -o '"PENDING_APPROVAL"'` finds a match while
    `grep -o '"PendingApproval"'` finds none.
13. `GET /api/v1/customers` returns `CustomerListResponse { items, total }` whose rows carry
    `city`, `accountCount` and `meteringPointCount`, and `GET /api/v1/reference-data/brps`
    returns `isActive` on every row — the fields Plan 4 binds by name.
14. `./dev-up` brings up postgres → migrator → employee-api, with the employee API waiting for the
    migrator to complete, and `GET /api/v1/reference-data/brps` returns the PVNed row in a browser.
15. Every commit in this plan is on the branch, and `git status` is clean.

---

## New names introduced

Names this plan invents that the shared contract does not define. The consistency pass should
check these against the other five plans.

### Projects and assemblies

| Name | Notes |
| --- | --- |
| `PeakPower.Infrastructure.Web` | New project at `src/Infrastructure/PeakPower.Infrastructure.Web`. **This is "the context-provider assembly"** named by architecture fact 6. Plan 5's token-backed `ICustomerContext` belongs here. |

### Application and infrastructure types

```csharp
namespace PeakPower.Infrastructure.Web.Tenancy;

public sealed class DevelopmentCustomerContext : ICustomerContext
{
    public const string CustomerIdHeader = "X-PeakPower-Customer-Id";
    public const string AccountIdHeader  = "X-PeakPower-Account-Id";
    public const string IsAdminHeader    = "X-PeakPower-Is-Admin";
    public DevelopmentCustomerContext(IHttpContextAccessor accessor);
}

public sealed class UnscopedCustomerContext : ICustomerContext;

public sealed class HeaderEmployeeContext : IEmployeeContext
{
    public const string EmployeeIdHeader  = "X-PeakPower-Employee-Id";
    public const string DefaultEmployeeId = "dev-employee";
    public HeaderEmployeeContext(IHttpContextAccessor accessor);
}

public static class TenancyStartupGuard
{
    public static void ThrowIfDevelopmentProvidersRegisteredInProduction(
        IServiceCollection services, IHostEnvironment environment);
}

public enum TenancyScope { TenantScoped, BackOffice, Anonymous }

public sealed record TenancyClassification(TenancyScope Scope, string ResourceKind, string Reason);

public static class TenancyEndpointExtensions
{
    public static TBuilder TenantScoped<TBuilder>(this TBuilder builder, string resourceKind)
        where TBuilder : IEndpointConventionBuilder;
    public static TBuilder BackOffice<TBuilder>(this TBuilder builder, string reason)
        where TBuilder : IEndpointConventionBuilder;
    public static TBuilder AnonymousEndpoint<TBuilder>(this TBuilder builder, string reason)
        where TBuilder : IEndpointConventionBuilder;
}

public sealed class TenantScopeMiddleware
{
    public const string CustomerIdSetting = "app.customer_id";
    public TenantScopeMiddleware(RequestDelegate next);
    public Task InvokeAsync(HttpContext context, PeakPowerDbContext db, ICustomerContext tenancy);
}

public static class TenantScopeMiddlewareExtensions
{
    public static IApplicationBuilder UseTenantScope(this IApplicationBuilder app);
}

public static class AppRoleConnectionString
{
    public static string For(string baseConnectionString, string role, string password);
}
```

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

public sealed class ValidationFilter<TRequest> : IEndpointFilter where TRequest : class
{
    public ValidationFilter(IValidator<TRequest> validator);
}

public static class ValidationFilterExtensions
{
    public static RouteHandlerBuilder Validate<TRequest>(this RouteHandlerBuilder builder)
        where TRequest : class;
}

/// The one enum wire spelling both APIs use — shared contract §5.2.
public static class EnumWireFormat
{
    public static readonly JsonNamingPolicy Naming;          // JsonNamingPolicy.SnakeCaseUpper
    public static readonly JsonStringEnumConverter Converter;
    public static string ToWire<TEnum>(TEnum value) where TEnum : struct, Enum;
    public static bool TryParse<TEnum>(string? wire, out TEnum value) where TEnum : struct, Enum;
    public static TEnum Parse<TEnum>(string wire) where TEnum : struct, Enum;
    public static string[] Names<TEnum>() where TEnum : struct, Enum;
}
```

### Persistence

```csharp
// PeakPowerDbContext gains a second constructor parameter.
public PeakPowerDbContext(DbContextOptions<PeakPowerDbContext> options, ICustomerContext customerContext);
```

Migration `TenancyRowLevelSecurity` (migration 2) introduces, in the database:

| Name | Kind |
| --- | --- |
| `app_customer_role` | group role — tenant-isolated |
| `app_employee_role` | group role — back office, `USING (true)` |
| `peakpower_app` | login role, password `dev_only_app_password` (local-only) |
| `peakpower_employee` | login role, password `dev_only_employee_password` (local-only) |
| `app.customer_id` | runtime setting, written with `set_config(…, true)` |
| `customer_customer_tenant_isolation`, `customer_customer_account_tenant_isolation`, `customer_metering_point_tenant_isolation`, `wallet_wallet_tenant_isolation` | RLS policies |
| `customer_customer_back_office`, `customer_customer_account_back_office`, `customer_metering_point_back_office`, `wallet_wallet_back_office` | RLS policies |

### Contracts

```csharp
namespace PeakPower.Contracts.Employee;

public sealed record AddressDto(string Street, string HouseNumber, string? HouseNumberSuffix,
    string PostalCode, string City, string Country);
public sealed record ContactPersonDto(string Name, string Email, string? Phone);

public sealed record CustomerListItemDto(Guid Id, string LegalName, string? TradeName,
    string KvkNumber, string Status, string City, int AccountCount, int MeteringPointCount);
public sealed record CustomerListResponse(IReadOnlyList<CustomerListItemDto> Items, int Total);
public sealed record CustomerDetailDto(Guid Id, string LegalName, string? TradeName,
    string KvkNumber, string? VatNumber, string Status, bool FourEyesEnabled,
    AddressDto BillingAddress, AddressDto? VisitingAddress, ContactPersonDto PrimaryContact,
    string? InternalReference, string Locale, IReadOnlyList<AccountDto> Accounts,
    IReadOnlyList<MeteringPointDto> MeteringPoints);
public sealed record CreateCustomerRequest(string LegalName, string? TradeName, string KvkNumber,
    string? VatNumber, AddressDto BillingAddress, AddressDto? VisitingAddress,
    ContactPersonDto PrimaryContact, string? InternalReference, string Locale);
public sealed record UpdateCustomerRequest(string LegalName, string? TradeName, string? VatNumber,
    AddressDto BillingAddress, AddressDto? VisitingAddress, ContactPersonDto PrimaryContact,
    string? InternalReference, string Locale, string Status);

public sealed record AccountDto(Guid Id, Guid CustomerId, string Username, string FirstName,
    string LastName, string? JobTitle, string Email, string? Phone, string Status, bool IsAdmin,
    DateTimeOffset? LastLoginAt);
public sealed record CreateAccountRequest(string Username, string FirstName, string LastName,
    string? JobTitle, string Email, string? Phone, bool IsAdmin);
public sealed record UpdateAccountRequest(string FirstName, string LastName, string? JobTitle,
    string Email, string? Phone, bool IsAdmin);

public sealed record MeteringPointDto(Guid Id, Guid CustomerId, string Ean, string EanDisplay,
    string Commodity, Guid BrpId, string BrpName, string ProductionExpectation,
    string? ExpectationSource, string? Name, string? Description, string DisplayLabel,
    string? GridOperator, decimal? CapacityKw, AddressDto? Address, DateOnly ValidFrom,
    DateOnly? ValidTo);
public sealed record AttachMeteringPointRequest(string Ean, Guid BrpId,
    string ProductionExpectation, string? ExpectationSource, string? Name, string? Description,
    string? GridOperator, decimal? CapacityKw, AddressDto? Address, DateOnly ValidFrom);
public sealed record UpdateMeteringPointRequest(Guid BrpId, string ProductionExpectation,
    string? ExpectationSource, string? Name, string? Description, string? GridOperator,
    decimal? CapacityKw, AddressDto? Address);
public sealed record EndDateMeteringPointRequest(DateOnly ValidTo);

public sealed record BrpDto(Guid Id, string Code, string Name, bool IsActive);
```

Every `string` above that carries an enum holds the **wire spelling**, which is the database
spelling: `PROSPECT`, `PENDING_APPROVAL`, `ELECTRICITY`, `CUSTOMER_DECLARED`. Shared contract §5.2.

### Employee API

```csharp
namespace PeakPower.Api.Employee;

/// The type WebApplicationFactory<T> is pointed at. This host declares no `partial class Program`.
public sealed class EmployeeApiEntryPoint;

namespace PeakPower.Api.Employee.Endpoints;

public static class ReferenceDataEndpoints
{ public static IEndpointRouteBuilder MapReferenceDataEndpoints(this IEndpointRouteBuilder routes); }
public static class CustomerEndpoints
{ public static IEndpointRouteBuilder MapCustomerEndpoints(this IEndpointRouteBuilder routes); }
public static class AccountEndpoints
{ public static IEndpointRouteBuilder MapAccountEndpoints(this IEndpointRouteBuilder routes); }
public static class MeteringPointEndpoints
{ public static IEndpointRouteBuilder MapMeteringPointEndpoints(this IEndpointRouteBuilder routes); }

namespace PeakPower.Api.Employee.Mapping;
public static class EmployeeMappings;   // ToDto / ToDomain / ToListItem / ToDetail

namespace PeakPower.Api.Employee.Validation;
public sealed class AddressDtoValidator, ContactPersonDtoValidator,
    CreateCustomerRequestValidator, UpdateCustomerRequestValidator,
    CreateAccountRequestValidator, UpdateAccountRequestValidator,
    AttachMeteringPointRequestValidator, UpdateMeteringPointRequestValidator,
    EndDateMeteringPointRequestValidator;
```

**Routes.** The design's employee API sketch writes `POST /customers/{id}/metering-points` and
`POST /customers/{id}/accounts`. This plan names the parameter `{customerId}` on those two,
because `{id}` on a nested route reads as the child's identifier and would collide in the
generated client. Every route is prefixed `/api/v1` per the shared contract.

```
GET    /api/v1/customers                                 ListCustomers
POST   /api/v1/customers                                 CreateCustomer
GET    /api/v1/customers/{id}                            GetCustomer
PATCH  /api/v1/customers/{id}                            UpdateCustomer
POST   /api/v1/customers/{customerId}/accounts           CreateAccount
PATCH  /api/v1/accounts/{id}                             UpdateAccount
POST   /api/v1/accounts/{id}/deactivate                  DeactivateAccount
POST   /api/v1/customers/{customerId}/metering-points    AttachMeteringPoint
PATCH  /api/v1/metering-points/{id}                      UpdateMeteringPoint
POST   /api/v1/metering-points/{id}/end-date             EndDateMeteringPoint
GET    /api/v1/reference-data/brps                       ListBalanceResponsibleParties
```

### Configuration and hosting

| Name | Meaning |
| --- | --- |
| `ConnectionStrings:peakpower` | the Aspire-supplied owning connection string |
| `Tenancy:DatabaseRole` | the non-owner login role this host connects as |
| `Tenancy:DatabasePassword` | that role's password (local-only in slice 1) |
| Aspire resource `employee-api` | added to the AppHost in Task 17 |

### Test-only types

| Name | File |
| --- | --- |
| `TenancyFixture`, `TenancyCollection` | `tests/PeakPower.Integration.Tests/Tenancy/TenancyFixture.cs` |
| `RouteTableEntry`, `RouteTable` | `tests/PeakPower.Integration.Tests/Tenancy/RouteTable.cs` |
| `TenancyProbeApp` | `tests/PeakPower.Integration.Tests/Tenancy/TenancyProbeApp.cs` |
| `EmployeeApiFactory` | `tests/PeakPower.Integration.Tests/Employee/EmployeeApiFactory.cs` |
| `RepositoryRoot` | `tests/PeakPower.Integration.Tests/Contract/RepositoryRoot.cs` |
| `IlScanner` | `tests/PeakPower.Architecture.Tests/IlScanner.cs` |
