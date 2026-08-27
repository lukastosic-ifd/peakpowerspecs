# Authentication & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the customer realm a real credential — Argon2id password hashing, ES256
JWT access/refresh tokens with per-request revocation, a password-reset path — and the
ten-step self-service onboarding aggregate that materialises a company, its first account and
its wallet in one transaction.

**Architecture:** Credentials are hashed with Argon2id and never leave the server. Access
tokens are 15-minute ES256 JWTs signed by a locally generated P-256 key published at
`/.well-known/jwks.json`; refresh tokens are 32 random bytes, stored SHA-256 hashed, rotating
and single-use. Every authenticated request opens the transaction that row-level security
already needs, and in the *same* network round trip sets `app.customer_id` and reads the
account's `security_stamp` — so bumping the stamp kills every outstanding token on its next
call. Onboarding is an anonymous aggregate (`OnboardingApplication`) that accumulates the
wizard's answers and, on a verified six-digit signing code, writes `customer`,
`customer_account` and `wallet` inside a single transaction.

**Tech Stack:** .NET 10 (SDK 10.0.400) · ASP.NET Core Minimal APIs · EF Core 10 ·
PostgreSQL 17 · Aspire 13.5.3 · `Konscious.Security.Cryptography.Argon2` 1.3.1 ·
`Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.0 ·
`Microsoft.IdentityModel.JsonWebTokens` 8.16.0 · Npgsql 10.0.0 · xUnit +
**Shouldly 4.3.0**
Mono.Cecil

**Spec:** `docs/superpowers/specs/2026-08-26-poc-slice-1-design.md`
**Shared contract:** `docs/superpowers/plans/2026-08-26-slice-1-shared-contract.md`

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
not one converter per property. **The wire spelling is the database spelling** (shared contract
§5.2): `ACTIVE`, never `"Active"`. Both APIs register plan 2's one shared
`JsonStringEnumConverter`; no mapper in this plan calls `.ToString()` on an enum.

### Application ports (declared by plan 1 in `PeakPower.Application.Abstractions`)

Shared contract §6 fixes where each one is implemented. This plan writes three of them, and
none of them go in `PeakPower.Persistence`:

| Port | Implementation lives in | Written by |
| --- | --- | --- |
| `ICustomerContext` | `PeakPower.Infrastructure.Web` | plan 2 (dev), **this plan** (token-backed) |
| `IEmployeeContext` | `PeakPower.Infrastructure.Web` | plan 2 |
| `IMarketCalendar` | `PeakPower.Infrastructure.Time` | plan 1 |
| `IEmailSender` | `PeakPower.Infrastructure.Email` (console sink) | **this plan** |
| `IPasswordHasher` | `PeakPower.Infrastructure.Identity` | **this plan** |
| `ITokenIssuer` | `PeakPower.Infrastructure.Identity` | **this plan** |

```csharp
namespace PeakPower.Application.Abstractions;

public interface ICustomerContext                // THE tenancy seam  [F13-R30]
{
    Guid CustomerId { get; }
    Guid AccountId { get; }
    bool IsAdmin { get; }
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

`uuid` primary keys via `gen_random_uuid()`. Money `numeric(18,6)`. Timestamps `timestamptz`.

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

**Architecture facts that must exist from week 1** (shared contract §13; facts 3-6 are
Mono.Cecil IL scans, because their subject is a call site rather than a type reference):

1. `PeakPower.Domain` references no other project — plan 1
2. `PeakPower.Application` references only `PeakPower.Domain` — plan 1
3. `PeakPower.Ingestion` (when it exists) references no `Brp.*` adapter — plan 1
4. No type calls `IgnoreQueryFilters()` — plan 2
5. No type outside `PeakPower.Infrastructure.Time` calls `DateTime.Now`, `DateTime.UtcNow`,
   `DateTime.Today`, `DateTimeOffset.Now` or `DateTimeOffset.UtcNow` — plan 1
6. No type outside `PeakPower.Infrastructure.Web` uses `IHttpContextAccessor` or reads a claim
   off `ClaimsPrincipal` / `ClaimsIdentity` — plan 2

**This plan writes none of them.** Fact 6 is the one it must keep green, and Task 6 explains how.

### Copy rules

Sentence case everywhere. **No emoji, no icon set.** nl-NL numbers: `€ 19.722,00`,
`385,4 MWh`, minus is U+2212 `−`. Empty and disabled states name the reason.

---

## Conventions this plan adds

Three mechanical rules that apply to every task below. They are not in the shared contract
because they only matter inside this plan's boundary, but they are load-bearing.

**C1 — Where the security adapters live.** The shared contract fixes fifteen projects, five of
them under `src/Infrastructure/` — `Persistence`, `Time`, `Web`, `Identity` and `Email` (§3.1).
Adapters that are *not* persistence do not belong in the persistence assembly, so this plan
fills two projects plan 1 created empty: `PeakPower.Infrastructure.Identity` takes everything
that hashes a password or mints a token, and `PeakPower.Infrastructure.Email` takes the console
sink. Contract §6 assigns exactly that: `IPasswordHasher` and `ITokenIssuer` are implemented in
`PeakPower.Infrastructure.Identity`, `IEmailSender` in `PeakPower.Infrastructure.Email`. So
`Argon2idPasswordHasher` lives at
`src/Infrastructure/PeakPower.Infrastructure.Identity/Argon2idPasswordHasher.cs` with namespace
`PeakPower.Infrastructure.Identity` — folder, project and namespace all agree, and the employee
host never links the ES256 key store because it never references the project.

A third project the contract names, `PeakPower.Infrastructure.Web`, already exists: plan 2 put
the development `ICustomerContext` there, and Tasks 6 and 7 below add the token-backed provider
and the session middleware beside it. Contract §6 is explicit — "Do NOT put a provider inside
an API host" — and architecture fact 6 (plan 2) fails the build if one does.

**C2 — Migration ownership.** Shared contract §3.2 numbers the four slice-1 migrations: plan 1
owns migration 1, `InitialSchema`; plan 2 owns migration 2, `TenancyRowLevelSecurity`; plan 6
owns migration 4, the EAN pool. **This plan owns migration 3, `AuthAndOnboarding`.** Every table
this plan touches beyond `customer.customer` and `customer.customer_account` is described by an
`IEntityTypeConfiguration<T>` written here, and migration 3 is produced by
`dotnet ef migrations add`, which emits only the delta against whatever migrations 1 and 2
already created. If migration 1 created a table in exactly the shape this plan's configuration
describes, the generated migration will be empty for that table — that is the correct outcome,
not a mistake.

**C3 — Which database role a request runs as.** The customer API's connection string logs in as
the *owner* role, which bypasses row-level security. Anonymous endpoints (sign-in, refresh,
password reset, all of onboarding) therefore run unrestricted, which is what they need —
onboarding writes rows for a customer that does not exist yet, and sign-in reads an account
before any tenant is known. Authenticated requests pass through `CustomerSessionMiddleware`
(Task 7), which issues `SET LOCAL ROLE app_customer_role` and `SET LOCAL app.customer_id`
before any handler runs, so from that point on RLS is in force. The safety net that keeps an
endpoint from silently escaping into owner-role territory is the allow-list test in Task 8:
every endpoint must either require authorization or be named in an explicit list.

**Domain terms, once.** *KvK* (Kamer van Koophandel) is the Dutch chamber of commerce; a KvK
number is exactly eight digits and identifies a legal entity. *IBAN* is the international bank
account number; Dutch ones look like `NL18INGB0002445566`. *BRP* (balance responsible party) is
the market participant answerable for a connection's imbalance. An *EAN* is the 18-digit code
identifying a grid connection point. A *connection* and a *metering point* are the same thing;
the portal says connection, the schema says metering point.

---

## File Structure

### `peakpower-platform` — created by this plan

| File | Responsibility |
| --- | --- |
| `src/Infrastructure/PeakPower.Infrastructure.Identity/Argon2idPasswordHasher.cs` | `IPasswordHasher` over Argon2id at the OWASP floor; PHC-string encoding |
| `src/Infrastructure/PeakPower.Infrastructure.Identity/ISigningKeyStore.cs` | The port for the ES256 key pair and its public JWK |
| `src/Infrastructure/PeakPower.Infrastructure.Identity/FileSigningKeyStore.cs` | Generates or loads the P-256 key from a mode-0600 dev file |
| `src/Infrastructure/PeakPower.Infrastructure.Identity/JwtTokenIssuer.cs` | `ITokenIssuer` — the five claims, 15-minute ES256 access token, 32-byte refresh token |
| `src/Infrastructure/PeakPower.Infrastructure.Identity/CustomerTokenValidation.cs` | The single `TokenValidationParameters` factory, shared by the host and its tests |
| `src/Infrastructure/PeakPower.Infrastructure.Identity/OpaqueToken.cs` | CSPRNG generation and SHA-256 hashing for refresh and reset tokens |
| `src/Infrastructure/PeakPower.Infrastructure.Email/ConsoleEmailSender.cs` | `IEmailSender` console sink |
| `src/Infrastructure/PeakPower.Persistence/Configurations/RefreshTokenConfiguration.cs` | EF mapping for `customer.refresh_token` |
| `src/Infrastructure/PeakPower.Persistence/Configurations/PasswordResetTokenConfiguration.cs` | EF mapping for `customer.password_reset_token` |
| `src/Infrastructure/PeakPower.Persistence/Configurations/OnboardingApplicationConfiguration.cs` | EF mapping for `customer.onboarding_application`, incl. the two jsonb columns |
| `src/Infrastructure/PeakPower.Persistence/Migrations/*_AuthAndOnboarding.cs` | Migration 3 — the delta plus the RLS grants and policies |
| `src/Core/PeakPower.Domain/Customers/RefreshToken.cs` | The rotating refresh-token record and its state transitions |
| `src/Core/PeakPower.Domain/Customers/PasswordResetToken.cs` | The single-use reset token and its state transitions |
| `src/Core/PeakPower.Domain/Onboarding/OnboardingEnums.cs` | `OnboardingStatus`, `LegalEntityType`, `FlowDirection`, `VolumeBand`, `SigningAuthority` |
| `src/Core/PeakPower.Domain/Onboarding/OnboardingReferenceData.cs` | The 24-industry list, the volume-band labels, the authority options, the step table |
| `src/Core/PeakPower.Domain/Onboarding/OnboardingSignatory.cs` | One person who must sign, as stored in the signatories jsonb |
| `src/Core/PeakPower.Domain/Onboarding/OnboardingApplication.cs` | The aggregate — every step's answers and every rule that gates them |
| `src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs` | Request/response DTOs for the six auth endpoints |
| `src/Core/PeakPower.Contracts/Customer/Onboarding/OnboardingContracts.cs` | Request/response DTOs for the four onboarding endpoints |
| `src/Hosts/PeakPower.Api.Customer/Program.cs` | Composition root — DI, authentication, middleware order, endpoint mapping |
| `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/JwtCustomerContext.cs` | `ICustomerContext` read from the validated token and nothing else |
| `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerSessionMiddleware.cs` | One round trip: role switch, `app.customer_id`, and the stamp check |
| `src/Hosts/PeakPower.Api.Customer/Auth/ISignInThrottle.cs` | The progressive-delay port |
| `src/Hosts/PeakPower.Api.Customer/Auth/InMemorySignInThrottle.cs` | Sliding-window failure counters per username and per source |
| `src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs` | sign-in, refresh, sign-out, me, and the two password-reset endpoints |
| `src/Hosts/PeakPower.Api.Customer/Auth/RefreshCookie.cs` | The one place that writes or clears `pp_refresh` |
| `src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingService.cs` | Orchestration: transaction, code issuance, email, materialisation |
| `src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingEndpoints.cs` | The four onboarding routes plus the development-only bank simulator |

### `peakpower-platform` — modified by this plan

| File | Change |
| --- | --- |
| `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs` | Add three `DbSet`s: refresh tokens, reset tokens, onboarding applications |
| `src/Hosts/PeakPower.AppHost/AppHost.cs` | Add the `customer-api` resource, waiting on the migrator |
| `Directory.Packages.props` | Add the Argon2, JwtBearer, JsonWebTokens and Npgsql package versions |

### `peakpower-platform` — tests created by this plan

| File | Responsibility |
| --- | --- |
| `tests/PeakPower.Application.Tests/Security/Argon2idPasswordHasherTests.cs` | Hash shape, verify round trip, wrong password, tampered hash |
| `tests/PeakPower.Application.Tests/Security/JwtTokenIssuerTests.cs` | The five claims, the 15-minute expiry, the refresh-token shape |
| `tests/PeakPower.Application.Tests/Security/CustomerTokenValidationTests.cs` | A foreign-key token is rejected; `sub` is not remapped |
| `tests/PeakPower.Application.Tests/Auth/InMemorySignInThrottleTests.cs` | The delay curve, the cap, the reset on success |
| `tests/PeakPower.Domain.Tests/Onboarding/OnboardingApplicationTests.cs` | Every step's gate, the signatory minimum, the code attempt cap |
| `tests/PeakPower.Integration.Tests/Auth/JwksEndpointTests.cs` | The JWKS document's shape and stability across restarts |
| `tests/PeakPower.Integration.Tests/Auth/SecurityStampTests.cs` | **The headline test:** a bumped stamp kills the token on the next call |
| `tests/PeakPower.Integration.Tests/Auth/SignInTests.cs` | Success, wrong password, unknown username, the delay |
| `tests/PeakPower.Integration.Tests/Auth/RefreshRotationTests.cs` | Rotation, single use, replay revokes the chain |
| `tests/PeakPower.Integration.Tests/Auth/SignOutTests.cs` | Sign-out revokes every refresh token and clears the cookie |
| `tests/PeakPower.Integration.Tests/Auth/PasswordResetTests.cs` | 202 for an unknown address; completion bumps the stamp |
| `tests/PeakPower.Integration.Tests/Auth/AnonymousEndpointAllowListTests.cs` | Every endpoint is authorized unless explicitly listed |
| `tests/PeakPower.Integration.Tests/Onboarding/OnboardingMaterialisationTests.cs` | One transaction, idempotent, wallet created, RLS-visible afterwards |
| `tests/PeakPower.Integration.Tests/Onboarding/OnboardingEndpointTests.cs` | The whole wizard over HTTP, end to end |
| `tests/PeakPower.Integration.Tests/Migrations/AuthSchemaTests.cs` | Migration 3 applies and produces the expected columns and policies |
| `tests/PeakPower.Integration.Tests/CustomerApiFactory.cs` | The `WebApplicationFactory` bound to the Testcontainers database |

---

## Tasks

Every command below is run from `/Users/thinhhuynh/PeakPower/peakpower-platform` unless the
step says otherwise.

---

### Task 1: The Argon2id password hasher

`[DEC-113]` puts a customer credential in the platform. Argon2id is the memory-hard hash OWASP
recommends; the three numbers below (19 MiB of memory, 2 iterations, 1 lane) are OWASP's
current *floor* for Argon2id and are fixed by the design, not tunable here. The output is a PHC
string — the standard `$argon2id$v=19$m=…,t=…,p=…$salt$hash` format — so the parameters travel
with the hash and a future parameter bump can still verify old hashes.

**Files:**
- Modify: `Directory.Packages.props`
- Create: `src/Infrastructure/PeakPower.Infrastructure.Identity/Argon2idPasswordHasher.cs`
- Test: `tests/PeakPower.Application.Tests/Security/Argon2idPasswordHasherTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Application.Abstractions.IPasswordHasher` — `string Hash(string password)`,
  `bool Verify(string password, string hash)` (shared contract §6, defined by plan 1).
- Produces: `PeakPower.Infrastructure.Identity.Argon2idPasswordHasher : IPasswordHasher`,
  a public parameterless-constructible sealed class.

- [ ] **Step 1: Add the package version**

Add to the `<ItemGroup>` in `Directory.Packages.props`:

```xml
<PackageVersion Include="Konscious.Security.Cryptography.Argon2" Version="1.3.1" />
```

Then reference it from the identity project — plan 1 created
`src/Infrastructure/PeakPower.Infrastructure.Identity/PeakPower.Infrastructure.Identity.csproj`
already referencing `PeakPower.Application`, so this is the only addition:

```xml
<ItemGroup>
  <PackageReference Include="Konscious.Security.Cryptography.Argon2" />
</ItemGroup>
```

Persistence is deliberately untouched: shared contract §6 puts `IPasswordHasher` in
`PeakPower.Infrastructure.Identity`, and keeping it out of Persistence is what stops the
employee host from linking the customer realm's credential code.

The unit tests need to see the new assembly, so add to
`tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj`:

```xml
<ItemGroup>
  <ProjectReference Include="../../src/Infrastructure/PeakPower.Infrastructure.Identity/PeakPower.Infrastructure.Identity.csproj" />
</ItemGroup>
```

- [ ] **Step 2: Write the failing test**

Create `tests/PeakPower.Application.Tests/Security/Argon2idPasswordHasherTests.cs`:

```csharp
using Shouldly;
using PeakPower.Infrastructure.Identity;
using Xunit;

namespace PeakPower.Application.Tests.Security;

public sealed class Argon2idPasswordHasherTests
{
    private readonly Argon2idPasswordHasher _hasher = new();

    [Fact]
    public void Hash_writes_the_phc_string_with_the_owasp_floor_parameters()
    {
        var hash = _hasher.Hash("correct-horse-battery");

        hash.ShouldStartWith("$argon2id$v=19$m=19456,t=2,p=1$");
        hash.Split('$').Count().ShouldBe(6);
    }

    [Fact]
    public void Hash_salts_so_the_same_password_never_produces_the_same_string()
    {
        _hasher.Hash("correct-horse-battery")
            .ShouldNotBe(_hasher.Hash("correct-horse-battery"));
    }

    [Fact]
    public void Verify_accepts_the_password_it_hashed()
    {
        var hash = _hasher.Hash("correct-horse-battery");

        _hasher.Verify("correct-horse-battery", hash).ShouldBeTrue();
    }

    [Fact]
    public void Verify_rejects_a_different_password()
    {
        var hash = _hasher.Hash("correct-horse-battery");

        _hasher.Verify("correct-horse-batteri", hash).ShouldBeFalse();
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-hash")]
    [InlineData("$argon2i$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==")]
    [InlineData("$argon2id$v=19$m=19456,t=2$c2FsdA==$aGFzaA==")]
    public void Verify_returns_false_for_anything_that_is_not_one_of_our_hashes(string hash)
    {
        _hasher.Verify("correct-horse-battery", hash).ShouldBeFalse();
    }
}
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~Argon2idPasswordHasherTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'Argon2idPasswordHasher' could not be found`

- [ ] **Step 4: Write the minimal implementation**

Create `src/Infrastructure/PeakPower.Infrastructure.Identity/Argon2idPasswordHasher.cs`:

```csharp
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Konscious.Security.Cryptography;
using PeakPower.Application.Abstractions;

namespace PeakPower.Infrastructure.Identity;

/// <summary>
/// Argon2id at OWASP's current floor — 19 MiB of memory, two iterations, one lane.
/// The output is a PHC string, so the parameters travel with the hash and a later
/// parameter bump can still verify credentials created today.
/// </summary>
public sealed class Argon2idPasswordHasher : IPasswordHasher
{
    private const int MemoryKib = 19456;   // 19 MiB
    private const int Iterations = 2;
    private const int Parallelism = 1;
    private const int SaltBytes = 16;
    private const int HashBytes = 32;

    private static readonly string Prefix =
        $"$argon2id$v=19$m={MemoryKib},t={Iterations},p={Parallelism}$";

    public string Hash(string password)
    {
        ArgumentNullException.ThrowIfNull(password);
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var derived = Derive(password, salt, MemoryKib, Iterations, Parallelism, HashBytes);
        return Prefix + Convert.ToBase64String(salt) + "$" + Convert.ToBase64String(derived);
    }

    public bool Verify(string password, string hash)
    {
        if (password is null || string.IsNullOrEmpty(hash)) return false;

        // "" / "argon2id" / "v=19" / "m=…,t=…,p=…" / salt / hash
        var parts = hash.Split('$');
        if (parts.Length != 6) return false;
        if (parts[1] != "argon2id") return false;
        if (parts[2] != "v=19") return false;
        if (!TryReadParameters(parts[3], out var memory, out var iterations, out var lanes))
            return false;

        byte[] salt, expected;
        try
        {
            salt = Convert.FromBase64String(parts[4]);
            expected = Convert.FromBase64String(parts[5]);
        }
        catch (FormatException)
        {
            return false;
        }

        if (salt.Length == 0 || expected.Length == 0) return false;

        var actual = Derive(password, salt, memory, iterations, lanes, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    private static bool TryReadParameters(
        string segment, out int memory, out int iterations, out int lanes)
    {
        memory = iterations = lanes = 0;
        var fields = segment.Split(',');
        if (fields.Length != 3) return false;
        return TryReadOne(fields[0], "m=", out memory)
            && TryReadOne(fields[1], "t=", out iterations)
            && TryReadOne(fields[2], "p=", out lanes);

        static bool TryReadOne(string field, string key, out int value)
        {
            value = 0;
            return field.StartsWith(key, StringComparison.Ordinal)
                && int.TryParse(field[key.Length..], NumberStyles.None,
                                CultureInfo.InvariantCulture, out value)
                && value > 0;
        }
    }

    private static byte[] Derive(
        string password, byte[] salt, int memoryKib, int iterations, int lanes, int outputBytes)
    {
        using var argon = new Argon2id(Encoding.UTF8.GetBytes(password))
        {
            Salt = salt,
            MemorySize = memoryKib,
            Iterations = iterations,
            DegreeOfParallelism = lanes,
        };
        return argon.GetBytes(outputBytes);
    }
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~Argon2idPasswordHasherTests"`
Expected: PASS — 8 passed

- [ ] **Step 6: Commit**

```bash
git add Directory.Packages.props \
        src/Infrastructure/PeakPower.Infrastructure.Identity \
        tests/PeakPower.Application.Tests/Security/Argon2idPasswordHasherTests.cs
git commit -m "feat(auth): hash customer passwords with Argon2id at the OWASP floor"
```

---

### Task 2: The customer API host, the ES256 signing key, and the JWKS endpoint

This task stands up `PeakPower.Api.Customer` for the first time and gives it one endpoint:
`/.well-known/jwks.json`, the public half of the key that signs every access token.

**Where the private key lives, and why a file.** The key is generated on first start into
`<content root>/.local/customer-signing-key.pkcs8`, mode 0600, gitignored. Not the database,
for three reasons. First, the shared contract fixes the table list and a signing key is not
customer, metering, wallet or audit data — it has no home in the four schemas, and adding one
would mean reopening plan 1's migration. Second, the key is read once at startup and never
again, so it costs no query and never interacts with row-level security. Third, the boundary
should be loud: a file under `.local/` is obviously not how a deployment holds a private key,
where it belongs in a managed secret store. Nothing outside this class knows where the key came
from, so replacing `FileSigningKeyStore` with a vault-backed one later is a DI registration.

**Files:**
- Modify: `Directory.Packages.props`, `PeakPower.sln`, `.gitignore`
- Modify: `src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj` *(plan 1 Task 3 created it)*
- Create: `src/Hosts/PeakPower.Api.Customer/Program.cs`
- Create: `src/Hosts/PeakPower.Api.Customer/appsettings.json`
- Create: `src/Infrastructure/PeakPower.Infrastructure.Identity/ISigningKeyStore.cs`
- Create: `src/Infrastructure/PeakPower.Infrastructure.Identity/FileSigningKeyStore.cs`
- Create: `tests/PeakPower.Integration.Tests/CustomerApiFactory.cs`
- Test: `tests/PeakPower.Integration.Tests/Auth/JwksEndpointTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Persistence.PeakPowerDbContext` (plan 1) — registered via
  `AddNpgsqlDbContext<PeakPowerDbContext>("peakpower")` from `Aspire.Npgsql.EntityFrameworkCore.PostgreSQL`;
  `PeakPower.ServiceDefaults` extension `IHostApplicationBuilder.AddServiceDefaults()` (plan 1);
  `PostgreSqlContainer` fixture conventions from `tests/PeakPower.Integration.Tests` (plan 2).
- Produces:
  - `PeakPower.Infrastructure.Identity.ISigningKeyStore` with
    `ECDsaSecurityKey SigningKey { get; }`, `ECDsaSecurityKey PublicKey { get; }`,
    `string KeyId { get; }`, `JwksDocument PublicJwks { get; }`
  - `PeakPower.Infrastructure.Identity.JwksDocument(IReadOnlyList<JwkDocument> keys)` and
    `JwkDocument(string kty, string crv, string use, string alg, string kid, string x, string y)`
  - `PeakPower.Infrastructure.Identity.FileSigningKeyStore(string filePath) : ISigningKeyStore`
  - `PeakPower.Integration.Tests.CustomerApiFactory : WebApplicationFactory<CustomerApiEntryPoint>`
    with
    `Task InitializeAsync()`, `HttpClient CreateAnonymousClient()`,
    `PeakPowerDbContext CreateOwnerDbContext()`, `IServiceProvider Services`

- [ ] **Step 1: Add the package versions and the gitignore line**

Add to `Directory.Packages.props`:

```xml
<PackageVersion Include="Microsoft.AspNetCore.Authentication.JwtBearer" Version="10.0.0" />
<PackageVersion Include="Microsoft.IdentityModel.JsonWebTokens" Version="8.16.0" />
<PackageVersion Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.0" />
```

Add to `.gitignore`:

```gitignore
# Development-only ES256 signing key. Never committed, never deployed.
.local/
```

Add to
`src/Infrastructure/PeakPower.Infrastructure.Identity/PeakPower.Infrastructure.Identity.csproj`:

```xml
<ItemGroup>
  <PackageReference Include="Microsoft.IdentityModel.JsonWebTokens" />
</ItemGroup>
```

- [ ] **Step 2: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Auth/JwksEndpointTests.cs`:

```csharp
using System.Net;
using System.Text.Json;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Auth;

public sealed class JwksEndpointTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    [Fact]
    public async Task Jwks_serves_one_p256_verification_key()
    {
        var client = factory.CreateAnonymousClient();

        var response = await client.GetAsync("/.well-known/jwks.json");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/json");

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var keys = document.RootElement.GetProperty("keys");
        keys.GetArrayLength().ShouldBe(1);

        var key = keys[0];
        key.GetProperty("kty").GetString().ShouldBe("EC");
        key.GetProperty("crv").GetString().ShouldBe("P-256");
        key.GetProperty("alg").GetString().ShouldBe("ES256");
        key.GetProperty("use").GetString().ShouldBe("sig");
        key.GetProperty("kid").GetString().ShouldNotBeNullOrWhiteSpace();
        key.GetProperty("x").GetString().ShouldNotBeNullOrWhiteSpace();
        key.GetProperty("y").GetString().ShouldNotBeNullOrWhiteSpace();
        key.TryGetProperty("d", out _).ShouldBeFalse("the private scalar must never be published");
    }

    [Fact]
    public async Task The_same_key_file_yields_the_same_key_id_on_a_second_load()
    {
        var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"), "key.pkcs8");

        var first = new PeakPower.Infrastructure.Identity.FileSigningKeyStore(path);
        var second = new PeakPower.Infrastructure.Identity.FileSigningKeyStore(path);

        second.KeyId.ShouldBe(first.KeyId);
        second.PublicJwks.Keys[0].X.ShouldBe(first.PublicJwks.Keys[0].X);
    }
}
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~JwksEndpointTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'CustomerApiFactory' could not be found`

- [ ] **Step 4: Write the key store**

Create `src/Infrastructure/PeakPower.Infrastructure.Identity/ISigningKeyStore.cs`:

```csharp
using System.Text.Json.Serialization;
using Microsoft.IdentityModel.Tokens;

namespace PeakPower.Infrastructure.Identity;

/// <summary>The ES256 key pair the customer realm signs and verifies with.</summary>
public interface ISigningKeyStore
{
    string KeyId { get; }

    /// <summary>The private key. Only <see cref="JwtTokenIssuer"/> should ever ask for it.</summary>
    ECDsaSecurityKey SigningKey { get; }

    /// <summary>The public key, for token validation inside this process.</summary>
    ECDsaSecurityKey PublicKey { get; }

    /// <summary>The public key, in the shape RFC 7517 wants it served in.</summary>
    JwksDocument PublicJwks { get; }
}

/// <summary>RFC 7517 §5 — the JWK Set served at /.well-known/jwks.json.</summary>
public sealed record JwksDocument(
    [property: JsonPropertyName("keys")] IReadOnlyList<JwkDocument> Keys);

/// <summary>RFC 7518 §6.2.1 — a public EC key. There is deliberately no "d".</summary>
public sealed record JwkDocument(
    [property: JsonPropertyName("kty")] string Kty,
    [property: JsonPropertyName("crv")] string Crv,
    [property: JsonPropertyName("use")] string Use,
    [property: JsonPropertyName("alg")] string Alg,
    [property: JsonPropertyName("kid")] string Kid,
    [property: JsonPropertyName("x")] string X,
    [property: JsonPropertyName("y")] string Y);
```

Create `src/Infrastructure/PeakPower.Infrastructure.Identity/FileSigningKeyStore.cs`:

```csharp
using System.Security.Cryptography;
using Microsoft.IdentityModel.Tokens;

namespace PeakPower.Infrastructure.Identity;

/// <summary>
/// Slice 1 holds the ES256 private key in a mode-0600 file under the content root, created on
/// first start. Not the database: a signing key is not customer, metering, wallet or audit
/// data, so it has no schema to live in, and it is read once at startup rather than per
/// request. The file makes the "this is not production" boundary loud — a deployment puts the
/// key in a managed secret store, which is a different implementation of this same interface
/// and nothing else changes.
/// </summary>
public sealed class FileSigningKeyStore : ISigningKeyStore, IDisposable
{
    private readonly ECDsa _privateKey;
    private readonly ECDsa _publicKey;

    public FileSigningKeyStore(string filePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(filePath);

        if (File.Exists(filePath))
        {
            _privateKey = ECDsa.Create();
            _privateKey.ImportPkcs8PrivateKey(
                Convert.FromBase64String(File.ReadAllText(filePath).Trim()), out _);
        }
        else
        {
            _privateKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
            var directory = Path.GetDirectoryName(Path.GetFullPath(filePath))!;
            Directory.CreateDirectory(directory);
            File.WriteAllText(filePath, Convert.ToBase64String(_privateKey.ExportPkcs8PrivateKey()));
            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(filePath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            }
        }

        var parameters = _privateKey.ExportParameters(includePrivateParameters: false);
        if (parameters.Q.X is null || parameters.Q.Y is null)
        {
            throw new InvalidOperationException("The signing key has no public point.");
        }

        _publicKey = ECDsa.Create(parameters);

        // A stable identifier derived from the public point alone, so restarting the process
        // over the same file yields the same kid and cached JWKS stay valid.
        KeyId = Base64UrlEncoder.Encode(
            SHA256.HashData([.. parameters.Q.X, .. parameters.Q.Y]));

        PublicJwks = new JwksDocument(
        [
            new JwkDocument(
                Kty: "EC",
                Crv: "P-256",
                Use: "sig",
                Alg: "ES256",
                Kid: KeyId,
                X: Base64UrlEncoder.Encode(parameters.Q.X),
                Y: Base64UrlEncoder.Encode(parameters.Q.Y)),
        ]);
    }

    public string KeyId { get; }

    public ECDsaSecurityKey SigningKey => new(_privateKey) { KeyId = KeyId };

    public ECDsaSecurityKey PublicKey => new(_publicKey) { KeyId = KeyId };

    public JwksDocument PublicJwks { get; }

    public void Dispose()
    {
        _privateKey.Dispose();
        _publicKey.Dispose();
    }
}
```

- [ ] **Step 5: Write the host project and its composition root**

**Plan 1 Task 3 already wrote this file** with every `ProjectReference` the host needs, and
already added it to the solution. Do not recreate it — two plans writing one csproj is how the
reference lists diverge. Append two item groups to the existing file:

```xml
  <!-- Add to src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj -->
  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.Authentication.JwtBearer" />
  </ItemGroup>

  <ItemGroup>
    <InternalsVisibleTo Include="PeakPower.Integration.Tests" />
  </ItemGroup>
```

Create `src/Hosts/PeakPower.Api.Customer/appsettings.json`:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "Auth": {
    "SigningKeyPath": ".local/customer-signing-key.pkcs8"
  }
}
```

Create `src/Hosts/PeakPower.Api.Customer/Program.cs`:

```csharp
using PeakPower.Infrastructure.Identity;
using PeakPower.Infrastructure.Web.Http;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();
builder.AddNpgsqlDbContext<PeakPower.Persistence.PeakPowerDbContext>("peakpower");

builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();

// Shared contract §5.2 — enums go on the wire in their database spelling, ACTIVE not "Active".
// EnumWireFormat is plan 2's; the employee API registers the same converter instance, which is
// what keeps the two APIs from drifting into two spellings of one enum.
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(EnumWireFormat.Converter));

// One key per process, loaded once. The path is relative to the content root so a test host
// and the real host can each point somewhere of their own.
builder.Services.AddSingleton<ISigningKeyStore>(sp =>
{
    var environment = sp.GetRequiredService<IHostEnvironment>();
    var configured = builder.Configuration["Auth:SigningKeyPath"]
                     ?? ".local/customer-signing-key.pkcs8";
    var path = Path.IsPathRooted(configured)
        ? configured
        : Path.Combine(environment.ContentRootPath, configured);
    return new FileSigningKeyStore(path);
});

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();

app.MapGet("/.well-known/jwks.json", (ISigningKeyStore keys) => Results.Json(keys.PublicJwks))
   .WithName("Jwks")
   .WithSummary("The public keys access tokens are verified against.");

app.MapDefaultEndpoints();

app.Run();
```

Do **not** append `public partial class Program;`. Shared contract §5.1 forbids it in both API
hosts: the integration-test assembly references `PeakPower.Api.Customer` and
`PeakPower.Api.Employee`, and two global-namespace `Program` types make a bare
`WebApplicationFactory<Program>` ambiguous (CS0104). Plan 1 ships the marker type
`PeakPower.Api.Customer.CustomerApiEntryPoint` for exactly this, and the factory binds to that.

Register the project in the solution:

```bash
```

- [ ] **Step 6: Write the test factory**

Create `tests/PeakPower.Integration.Tests/CustomerApiFactory.cs`:

```csharp
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using PeakPower.Api.Customer;
using PeakPower.Persistence;
using Testcontainers.PostgreSql;
using Xunit;

namespace PeakPower.Integration.Tests;

/// <summary>
/// The customer API bound to a throwaway PostgreSQL 17 container. The connection string logs
/// in as the container's owner role, which is exactly what the real host does — see the plan's
/// convention C3: anonymous endpoints run unrestricted, and CustomerSessionMiddleware drops to
/// app_customer_role for authenticated ones.
/// </summary>
public sealed class CustomerApiFactory
    : WebApplicationFactory<CustomerApiEntryPoint>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder()
        .WithImage("postgres:17")
        .WithDatabase("peakpower")
        .WithUsername("peakpower_owner")
        .WithPassword("peakpower")
        .Build();

    private readonly string _signingKeyPath =
        Path.Combine(Path.GetTempPath(), "pp-tests", Guid.NewGuid().ToString("N"), "key.pkcs8");

    public string ConnectionString => _postgres.GetConnectionString();

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();

        // Apply every migration, exactly as the Migrator host does at bring-up.
        await using var db = CreateOwnerDbContext();
        await db.Database.MigrateAsync();
    }

    public new async Task DisposeAsync()
    {
        await base.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(Environments.Development);
        builder.UseSetting("ConnectionStrings:peakpower", ConnectionString);
        builder.UseSetting("Auth:SigningKeyPath", _signingKeyPath);
    }

    public HttpClient CreateAnonymousClient() =>
        CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    /// <summary>A context on the owner role — no RLS, for arranging and asserting in tests.</summary>
    public PeakPowerDbContext CreateOwnerDbContext()
    {
        var options = new DbContextOptionsBuilder<PeakPowerDbContext>()
            .UseNpgsql(ConnectionString)
            .Options;
        return new PeakPowerDbContext(options);
    }
}
```

Add to `tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj`:

```xml
<ItemGroup>
  <ProjectReference Include="../../src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj" />
</ItemGroup>
<ItemGroup>
  <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" />
</ItemGroup>
```

- [ ] **Step 7: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~JwksEndpointTests"`
Expected: PASS — 2 passed

- [ ] **Step 8: Commit**

```bash
git add .gitignore Directory.Packages.props PeakPower.sln \
        src/Hosts/PeakPower.Api.Customer \
        src/Infrastructure/PeakPower.Infrastructure.Identity \
        tests/PeakPower.Integration.Tests
git commit -m "feat(auth): stand up the customer API and publish the ES256 verification key"
```

---

### Task 3: The token issuer — five claims, fifteen minutes, ES256

`ITokenIssuer` mints the access token and the raw refresh token. The refresh token is not a
JWT: it is 32 bytes from a CSPRNG, base64url-encoded, and it carries no information at all. Its
meaning lives in the `customer.refresh_token` row (Task 4), which is what makes it revocable.

**Files:**
- Create: `src/Infrastructure/PeakPower.Infrastructure.Identity/OpaqueToken.cs`
- Create: `src/Infrastructure/PeakPower.Infrastructure.Identity/JwtTokenIssuer.cs`
- Test: `tests/PeakPower.Application.Tests/Security/JwtTokenIssuerTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Application.Abstractions.ITokenIssuer` and
  `PeakPower.Application.Abstractions.AccessToken(string Jwt, DateTimeOffset ExpiresAt)`
  (shared contract §6, plan 1); `PeakPower.Application.Abstractions.IMarketCalendar` with
  `DateTimeOffset UtcNow { get; }` (plan 1); `PeakPower.Domain.Customers.CustomerAccount`
  (shared contract §5, plan 1); `ISigningKeyStore` (Task 2).
- Produces:
  - `PeakPower.Infrastructure.Identity.OpaqueToken` — `static string Create()`,
    `static string HashOf(string token)`, `static bool Matches(string token, string hash)`
  - `PeakPower.Infrastructure.Identity.JwtTokenIssuer(ISigningKeyStore, IMarketCalendar) : ITokenIssuer`
    with `const string Issuer`, `const string Audience`,
    `static readonly TimeSpan AccessTokenLifetime`, `static readonly TimeSpan RefreshTokenLifetime`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Application.Tests/Security/JwtTokenIssuerTests.cs`:

```csharp
using Shouldly;
using Microsoft.IdentityModel.JsonWebTokens;
using NSubstitute;
using PeakPower.Application.Abstractions;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Identity;
using Xunit;

namespace PeakPower.Application.Tests.Security;

public sealed class JwtTokenIssuerTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 26, 9, 0, 0, TimeSpan.Zero);

    private readonly string _keyPath =
        Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"), "key.pkcs8");

    private JwtTokenIssuer CreateIssuer()
    {
        var clock = Substitute.For<IMarketCalendar>();
        clock.UtcNow.Returns(Now);
        return new JwtTokenIssuer(new FileSigningKeyStore(_keyPath), clock);
    }

    // Plan 1's factory, shared contract §5.1: nine parameters, and it returns Result<T>.
    // The issuer reads Id, CustomerId, IsAdmin and SecurityStamp, all of which the factory
    // assigns, so each test asserts against the account it just built rather than a
    // pre-chosen guid.
    private static CustomerAccount SampleAccount(bool isAdmin = true) =>
        CustomerAccount.Create(
            customerId: Guid.NewGuid(),
            username: "p.devries@vandersteen.nl",
            firstName: "Peter",
            lastName: "de Vries",
            jobTitle: null,
            email: "p.devries@vandersteen.nl",
            phone: null,
            status: AccountStatus.Active,
            isAdmin: isAdmin).Value;

    [Fact]
    public void The_access_token_carries_exactly_the_five_contract_claims()
    {
        var account = SampleAccount();

        var token = CreateIssuer().IssueAccessToken(account);

        var jwt = new JsonWebToken(token.Jwt);
        jwt.Alg.ShouldBe("ES256");
        jwt.GetClaim("sub").Value.ShouldBe(account.Id.ToString());
        jwt.GetClaim("customer_id").Value.ShouldBe(account.CustomerId.ToString());
        jwt.GetClaim("is_admin").Value.ShouldBe("true");
        jwt.GetClaim("stamp").Value.ShouldBe(account.SecurityStamp.ToString());
        jwt.GetPayloadValue<string[]>("amr").ShouldBe(new[] { "pwd" });
    }

    [Fact]
    public void The_access_token_expires_fifteen_minutes_after_the_calendar_says_now()
    {
        var token = CreateIssuer().IssueAccessToken(SampleAccount());

        token.ExpiresAt.ShouldBe(Now.AddMinutes(15));
        new JsonWebToken(token.Jwt).ValidTo.ShouldBe(
            Now.AddMinutes(15).UtcDateTime, TimeSpan.FromSeconds(1));
    }

    [Fact]
    public void Is_admin_false_is_written_as_the_string_false_not_omitted()
    {
        var jwt = new JsonWebToken(
            CreateIssuer().IssueAccessToken(SampleAccount(isAdmin: false)).Jwt);

        jwt.GetClaim("is_admin").Value.ShouldBe("false");
    }

    [Fact]
    public void The_refresh_token_is_opaque_high_entropy_and_expires_in_fourteen_days()
    {
        var issuer = CreateIssuer();

        var first = issuer.IssueRefreshToken(Guid.NewGuid(), out var expiresAt);
        var second = issuer.IssueRefreshToken(Guid.NewGuid(), out _);

        expiresAt.ShouldBe(Now.AddDays(14));
        first.ShouldNotBe(second);
        first.ShouldNotContain(".", "a refresh token is not a JWT");
        Microsoft.IdentityModel.Tokens.Base64UrlEncoder.DecodeBytes(first)
            .Count().ShouldBe(32);
    }

    [Fact]
    public void Opaque_token_hashes_are_hex_sha256_and_compare_in_fixed_time()
    {
        var token = OpaqueToken.Create();
        var hash = OpaqueToken.HashOf(token);

        hash.ShouldMatch("^[0-9A-F]{64}$");
        OpaqueToken.Matches(token, hash).ShouldBeTrue();
        OpaqueToken.Matches(OpaqueToken.Create(), hash).ShouldBeFalse();
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~JwtTokenIssuerTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'JwtTokenIssuer' could not be found`
(`CustomerAccount.Create` and `AccountStatus` already exist — plan 1 shipped both, so the only
missing names are this task's.)

- [ ] **Step 3: Write the opaque-token helper**

Create `src/Infrastructure/PeakPower.Infrastructure.Identity/OpaqueToken.cs`:

```csharp
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace PeakPower.Infrastructure.Identity;

/// <summary>
/// Refresh tokens and password-reset tokens are 32 bytes from a CSPRNG, stored as a SHA-256
/// hex digest.
///
/// SHA-256, deliberately, and not Argon2id. Argon2id exists to make guessing a *low-entropy*
/// secret expensive — a human-chosen password. A 256-bit random token cannot be guessed at any
/// price, so a slow hash would buy nothing and would put 40ms of latency on every token
/// refresh. What the hash is for here is that a stolen database dump must not yield usable
/// tokens, and a single pass of SHA-256 achieves exactly that.
/// </summary>
public static class OpaqueToken
{
    public const int Bytes = 32;

    public static string Create() =>
        Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(Bytes));

    public static string HashOf(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public static bool Matches(string token, string hash)
    {
        if (string.IsNullOrEmpty(token) || string.IsNullOrEmpty(hash)) return false;
        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(HashOf(token)),
            Encoding.ASCII.GetBytes(hash));
    }
}
```

- [ ] **Step 4: Write the token issuer**

Create `src/Infrastructure/PeakPower.Infrastructure.Identity/JwtTokenIssuer.cs`:

```csharp
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using PeakPower.Application.Abstractions;
using PeakPower.Domain.Customers;

namespace PeakPower.Infrastructure.Identity;

/// <summary>
/// ES256 over a local JWKS, not HS256 over a shared secret. The point is that the validation
/// path here is the same code that will one day validate an Entra token: migrating means
/// changing an issuer and pointing at a remote JWKS URL, not replacing the pipeline.
/// </summary>
public sealed class JwtTokenIssuer(ISigningKeyStore keys, IMarketCalendar calendar) : ITokenIssuer
{
    public const string Issuer = "https://peakpower.local/customer";
    public const string Audience = "peakpower-customer-api";

    public static readonly TimeSpan AccessTokenLifetime = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan RefreshTokenLifetime = TimeSpan.FromDays(14);

    private static readonly JsonWebTokenHandler Handler = new();

    public AccessToken IssueAccessToken(CustomerAccount account)
    {
        ArgumentNullException.ThrowIfNull(account);

        var now = calendar.UtcNow;
        var expiresAt = now + AccessTokenLifetime;

        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = expiresAt.UtcDateTime,
            Claims = new Dictionary<string, object>
            {
                ["sub"] = account.Id.ToString(),
                ["customer_id"] = account.CustomerId.ToString(),
                ["is_admin"] = account.IsAdmin ? "true" : "false",
                ["amr"] = new[] { "pwd" },
                ["stamp"] = account.SecurityStamp.ToString(),
            },
            SigningCredentials =
                new SigningCredentials(keys.SigningKey, SecurityAlgorithms.EcdsaSha256),
        };

        return new AccessToken(Handler.CreateToken(descriptor), expiresAt);
    }

    /// <remarks>
    /// <paramref name="accountId"/> is not mixed into the token — the token is pure entropy and
    /// the binding to an account lives in the customer.refresh_token row. The parameter is on
    /// the contract so a later scheme can bind them without changing every caller.
    /// </remarks>
    public string IssueRefreshToken(Guid accountId, out DateTimeOffset expiresAt)
    {
        expiresAt = calendar.UtcNow + RefreshTokenLifetime;
        return OpaqueToken.Create();
    }
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~JwtTokenIssuerTests"`
Expected: PASS — 5 passed

- [ ] **Step 6: Commit**

```bash
git add src/Infrastructure/PeakPower.Infrastructure.Identity/OpaqueToken.cs \
        src/Infrastructure/PeakPower.Infrastructure.Identity/JwtTokenIssuer.cs \
        tests/PeakPower.Application.Tests/Security/JwtTokenIssuerTests.cs
git commit -m "feat(auth): issue ES256 access tokens and opaque refresh tokens"
```

---

### Task 4: The token tables and migration 3

Two things at once, because they are one schema change and one reviewer gate: the two token
entities, and the migration that puts them in PostgreSQL with the right row-level-security
posture. The migration also sets the posture for `customer.onboarding_application` (Task 15's
table) and for `wallet.wallet`, which plan 1's `InitialSchema` already created.

**What this task does not touch.** `Wallet`, `WalletConfiguration` and `DbSet<Wallet> Wallets`
are plan 1's — shared contract §3.2 puts `wallet.wallet` in migration 1 and §5.1 gives the
aggregate one factory, `Wallet.CreateEuroWallet(Guid customerId)`, returning `Result<Wallet>`.
The account mutators are plan 1's too: §5.1 declares `SetPassword`, `BumpSecurityStamp` and
`RecordSuccessfulSignIn` on `CustomerAccount`, and this plan only calls them. Writing either
here would be a duplicate member, not a merge.

**RLS posture, stated once.** `customer.refresh_token` gets a policy that reaches through
`account_id` to the account's `customer_id`, so a signed-in tenant can revoke its own tokens
and nobody else's. `customer.password_reset_token` and `customer.onboarding_application` are
only ever touched by anonymous endpoints on the owner role, so `app_customer_role` is granted
nothing on them at all and RLS is enabled with no policy — deny by default.

**Files:**
- Create: `src/Core/PeakPower.Domain/Customers/RefreshToken.cs`
- Create: `src/Core/PeakPower.Domain/Customers/PasswordResetToken.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/Configurations/RefreshTokenConfiguration.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/Configurations/PasswordResetTokenConfiguration.cs`
- Modify: `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/Migrations/*_AuthAndOnboarding.cs` (generated)
- Test: `tests/PeakPower.Integration.Tests/Migrations/AuthSchemaTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Persistence.PeakPowerDbContext` with its existing `DbSet<Wallet> Wallets`
  (plan 1); `AccountStatus` (shared contract §4); `CustomerAccount.SetPassword(string)`,
  `CustomerAccount.BumpSecurityStamp()` and `CustomerAccount.RecordSuccessfulSignIn(DateTimeOffset)`
  (shared contract §5.1, plan 1); the `app_customer_role` database role and the
  `app.customer_id` setting created by plan 2's migration 2.
- Produces:
  - `PeakPower.Domain.Customers.RefreshToken` — `static RefreshToken Issue(Guid accountId, string tokenHash, DateTimeOffset issuedAt, DateTimeOffset expiresAt)`,
    `bool IsUsable(DateTimeOffset at)`, `void MarkUsed(DateTimeOffset at, Guid replacedByTokenId)`,
    `void Revoke(DateTimeOffset at)`
  - `PeakPower.Domain.Customers.PasswordResetToken` — `static PasswordResetToken Issue(Guid accountId, string tokenHash, DateTimeOffset issuedAt, DateTimeOffset expiresAt)`,
    `bool IsUsable(DateTimeOffset at)`, `void MarkUsed(DateTimeOffset at)`
  - On `PeakPowerDbContext`: `DbSet<RefreshToken> RefreshTokens` and
    `DbSet<PasswordResetToken> PasswordResetTokens` — and nothing else; `Wallets` is already there

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Migrations/AuthSchemaTests.cs`:

```csharp
using Dapper;
using Shouldly;
using Npgsql;
using Xunit;

namespace PeakPower.Integration.Tests.Migrations;

public sealed class AuthSchemaTests(CustomerApiFactory factory) : IClassFixture<CustomerApiFactory>
{
    private async Task<NpgsqlConnection> OpenAsync()
    {
        var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();
        return connection;
    }

    [Theory]
    [InlineData("customer", "refresh_token", "token_hash")]
    [InlineData("customer", "refresh_token", "used_at")]
    [InlineData("customer", "refresh_token", "revoked_at")]
    [InlineData("customer", "refresh_token", "replaced_by_token_id")]
    [InlineData("customer", "password_reset_token", "token_hash")]
    [InlineData("customer", "password_reset_token", "used_at")]
    [InlineData("wallet", "wallet", "currency")]
    [InlineData("wallet", "wallet", "balance")]
    public async Task Migration_two_creates_the_column(string schema, string table, string column)
    {
        await using var connection = await OpenAsync();

        var exists = await connection.ExecuteScalarAsync<bool>(
            """
            SELECT EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema = @schema AND table_name = @table
                             AND column_name = @column)
            """,
            new { schema, table, column });

        exists.ShouldBeTrue();
    }

    [Fact]
    public async Task The_refresh_token_hash_is_unique()
    {
        await using var connection = await OpenAsync();

        var exists = await connection.ExecuteScalarAsync<bool>(
            """
            SELECT EXISTS (SELECT 1 FROM pg_indexes
                           WHERE schemaname = 'customer' AND tablename = 'refresh_token'
                             AND indexdef LIKE '%UNIQUE%token_hash%')
            """);

        exists.ShouldBeTrue();
    }

    [Theory]
    [InlineData("customer", "refresh_token")]
    [InlineData("customer", "password_reset_token")]
    [InlineData("customer", "onboarding_application")]
    public async Task Row_level_security_is_enabled(string schema, string table)
    {
        await using var connection = await OpenAsync();

        var enabled = await connection.ExecuteScalarAsync<bool>(
            """
            SELECT c.relrowsecurity FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = @schema AND c.relname = @table
            """,
            new { schema, table });

        enabled.ShouldBeTrue();
    }

    [Fact]
    public async Task The_tenant_role_can_reach_its_own_refresh_tokens_and_nothing_else()
    {
        await using var connection = await OpenAsync();

        var policy = await connection.ExecuteScalarAsync<string>(
            """
            SELECT qual FROM pg_policies
            WHERE schemaname = 'customer' AND tablename = 'refresh_token'
              AND policyname = 'refresh_token_tenant_isolation'
            """);

        policy.ShouldNotBeNull();
        policy.ShouldContain("app.customer_id");
    }

    [Fact]
    public async Task The_tenant_role_is_granted_nothing_on_the_reset_tokens()
    {
        await using var connection = await OpenAsync();

        var granted = await connection.ExecuteScalarAsync<bool>(
            """
            SELECT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                           WHERE table_schema = 'customer'
                             AND table_name = 'password_reset_token'
                             AND grantee = 'app_customer_role')
            """);

        granted.ShouldBeFalse();
    }
}
```

Add `Dapper` to `Directory.Packages.props` and to the integration test project if plan 2 has
not already:

```xml
<PackageVersion Include="Dapper" Version="2.1.66" />
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~AuthSchemaTests"`
Expected: FAIL — every case throws
`Npgsql.PostgresException: 42P01: relation "customer.refresh_token" does not exist`, because
`InitialSchema` created neither token table. If instead the run stops at
`error CS0246: The type or namespace name 'RefreshToken' could not be found`, that is the same
failure one layer earlier and is equally correct at this point.

- [ ] **Step 3: Write the two token entities**

Create `src/Core/PeakPower.Domain/Customers/RefreshToken.cs`:

```csharp
namespace PeakPower.Domain.Customers;

/// <summary>
/// One issued refresh token. Rotating and single use: presenting it mints a replacement and
/// marks this row used. Presenting an already-used row is a replay, which the refresh endpoint
/// treats as theft and answers by revoking the whole chain.
/// </summary>
public sealed class RefreshToken
{
    private RefreshToken() { }   // EF

    public Guid Id { get; private set; }
    public Guid AccountId { get; private set; }

    /// <summary>SHA-256 hex of the token. The token itself is never stored.</summary>
    public string TokenHash { get; private set; } = string.Empty;

    public DateTimeOffset IssuedAt { get; private set; }
    public DateTimeOffset ExpiresAt { get; private set; }
    public DateTimeOffset? UsedAt { get; private set; }
    public DateTimeOffset? RevokedAt { get; private set; }
    public Guid? ReplacedByTokenId { get; private set; }

    public static RefreshToken Issue(
        Guid accountId, string tokenHash, DateTimeOffset issuedAt, DateTimeOffset expiresAt) =>
        new()
        {
            Id = Guid.NewGuid(),
            AccountId = accountId,
            TokenHash = tokenHash,
            IssuedAt = issuedAt,
            ExpiresAt = expiresAt,
        };

    public bool IsUsable(DateTimeOffset at) =>
        UsedAt is null && RevokedAt is null && at < ExpiresAt;

    public void MarkUsed(DateTimeOffset at, Guid replacedByTokenId)
    {
        UsedAt = at;
        ReplacedByTokenId = replacedByTokenId;
    }

    public void Revoke(DateTimeOffset at) => RevokedAt ??= at;
}
```

Create `src/Core/PeakPower.Domain/Customers/PasswordResetToken.cs`:

```csharp
namespace PeakPower.Domain.Customers;

/// <summary>A single-use password-reset token with a one-hour life, stored hashed.</summary>
public sealed class PasswordResetToken
{
    private PasswordResetToken() { }   // EF

    public Guid Id { get; private set; }
    public Guid AccountId { get; private set; }
    public string TokenHash { get; private set; } = string.Empty;
    public DateTimeOffset IssuedAt { get; private set; }
    public DateTimeOffset ExpiresAt { get; private set; }
    public DateTimeOffset? UsedAt { get; private set; }

    public static PasswordResetToken Issue(
        Guid accountId, string tokenHash, DateTimeOffset issuedAt, DateTimeOffset expiresAt) =>
        new()
        {
            Id = Guid.NewGuid(),
            AccountId = accountId,
            TokenHash = tokenHash,
            IssuedAt = issuedAt,
            ExpiresAt = expiresAt,
        };

    public bool IsUsable(DateTimeOffset at) => UsedAt is null && at < ExpiresAt;

    public void MarkUsed(DateTimeOffset at) => UsedAt = at;
}
```

Do not open `CustomerAccount.cs`. Shared contract §5.1 declares its whole surface and plan 1
writes it: `static Result<CustomerAccount> Create(Guid customerId, string username, string
firstName, string lastName, string? jobTitle, string email, string? phone, AccountStatus status,
bool isAdmin)`, and the three book-keeping mutators this plan leans on —
`void SetPassword(string passwordHash)` (which bumps the stamp), `void BumpSecurityStamp()` and
`void RecordSuccessfulSignIn(DateTimeOffset at)`. The self-service path is therefore two calls,
not a second factory: build the account `Active`, then set the hash.

```csharp
    var account = CustomerAccount.Create(
        customerId, username, firstName, lastName, jobTitle: null, email, phone,
        AccountStatus.Active, isAdmin).Value;
    account.SetPassword(passwordHash);
```

`SetPassword` bumping the stamp is what makes a completed reset kill every outstanding access
and refresh token — design §7's requirement comes for free rather than being a second thing a
caller has to remember.

- [ ] **Step 4: Write the EF configurations and register the sets**

Create `src/Infrastructure/PeakPower.Persistence/Configurations/RefreshTokenConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Customers;

namespace PeakPower.Persistence.Configurations;

public sealed class RefreshTokenConfiguration : IEntityTypeConfiguration<RefreshToken>
{
    public void Configure(EntityTypeBuilder<RefreshToken> builder)
    {
        builder.ToTable("refresh_token", "customer");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Id).HasDefaultValueSql("gen_random_uuid()");
        builder.Property(t => t.TokenHash).HasMaxLength(64).IsRequired();
        builder.HasIndex(t => t.TokenHash).IsUnique();
        builder.HasIndex(t => t.AccountId);
    }
}
```

Create `src/Infrastructure/PeakPower.Persistence/Configurations/PasswordResetTokenConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Customers;

namespace PeakPower.Persistence.Configurations;

public sealed class PasswordResetTokenConfiguration : IEntityTypeConfiguration<PasswordResetToken>
{
    public void Configure(EntityTypeBuilder<PasswordResetToken> builder)
    {
        builder.ToTable("password_reset_token", "customer");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Id).HasDefaultValueSql("gen_random_uuid()");
        builder.Property(t => t.TokenHash).HasMaxLength(64).IsRequired();
        builder.HasIndex(t => t.TokenHash).IsUnique();
        builder.HasIndex(t => t.AccountId);
    }
}
```

There is no third configuration. `WalletConfiguration` already exists — plan 1 wrote it
alongside migration 1's `wallet.wallet` table, including the tenancy query filter plan 2 later
made central. Adding a second one here would map the entity twice.

Modify `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs` — add exactly two sets,
and leave the existing `Wallets` alone:

```csharp
    public DbSet<PeakPower.Domain.Customers.RefreshToken> RefreshTokens => Set<PeakPower.Domain.Customers.RefreshToken>();
    public DbSet<PeakPower.Domain.Customers.PasswordResetToken> PasswordResetTokens => Set<PeakPower.Domain.Customers.PasswordResetToken>();
```

> A second `public DbSet<Wallet> Wallets` is CS0102, not a merge. If the property is missing,
> plan 1 is unfinished — stop and reconcile rather than adding it here.

- [ ] **Step 5: Generate migration 3**

```bash
dotnet ef migrations add AuthAndOnboarding \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator \
  --output-dir Migrations
```

Open the generated `*_AuthAndOnboarding.cs`. If plan 1's `InitialSchema` already created
`customer.refresh_token` and `customer.password_reset_token` in this shape, the `Up` body will
be empty for those tables — that is correct, leave it. Then append the security posture to the
end of `Up`:

```csharp
        migrationBuilder.Sql("""
            -- The tenant role may reach its own refresh tokens, so sign-out works under RLS.
            GRANT SELECT, INSERT, UPDATE ON customer.refresh_token TO app_customer_role;
            ALTER TABLE customer.refresh_token ENABLE ROW LEVEL SECURITY;
            ALTER TABLE customer.refresh_token FORCE ROW LEVEL SECURITY;
            CREATE POLICY refresh_token_tenant_isolation ON customer.refresh_token
                USING (EXISTS (
                    SELECT 1 FROM customer.customer_account a
                    WHERE a.id = customer.refresh_token.account_id
                      AND a.customer_id = current_setting('app.customer_id', true)::uuid))
                WITH CHECK (EXISTS (
                    SELECT 1 FROM customer.customer_account a
                    WHERE a.id = customer.refresh_token.account_id
                      AND a.customer_id = current_setting('app.customer_id', true)::uuid));

            -- Reset tokens and onboarding applications are touched only by anonymous endpoints
            -- on the owner role. The tenant role is granted nothing and RLS is on with no
            -- policy, which denies by default.
            REVOKE ALL ON customer.password_reset_token FROM app_customer_role;
            ALTER TABLE customer.password_reset_token ENABLE ROW LEVEL SECURITY;
            ALTER TABLE customer.password_reset_token FORCE ROW LEVEL SECURITY;

            REVOKE ALL ON customer.onboarding_application FROM app_customer_role;
            ALTER TABLE customer.onboarding_application ENABLE ROW LEVEL SECURITY;
            ALTER TABLE customer.onboarding_application FORCE ROW LEVEL SECURITY;

            -- The wallet is customer-owned like every other tenant table.
            GRANT SELECT ON wallet.wallet TO app_customer_role;
            ALTER TABLE wallet.wallet ENABLE ROW LEVEL SECURITY;
            ALTER TABLE wallet.wallet FORCE ROW LEVEL SECURITY;
            CREATE POLICY wallet_tenant_isolation ON wallet.wallet
                USING (customer_id = current_setting('app.customer_id', true)::uuid);
            """);
```

and the matching teardown at the end of `Down`:

```csharp
        migrationBuilder.Sql("""
            DROP POLICY IF EXISTS wallet_tenant_isolation ON wallet.wallet;
            DROP POLICY IF EXISTS refresh_token_tenant_isolation ON customer.refresh_token;
            """);
```

> `customer.onboarding_application` must exist before this SQL runs. Plan 1's `InitialSchema`
> does not create it — shared contract §3.2 leaves it to this migration — so run Task 15 first,
> which defines the entity, then regenerate this migration so the `CREATE TABLE` lands ahead of
> the `ALTER`.

- [ ] **Step 6: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~AuthSchemaTests"`
Expected: PASS — 13 passed

- [ ] **Step 7: Commit**

```bash
git add src/Core/PeakPower.Domain/Customers \
        src/Infrastructure/PeakPower.Persistence/Configurations \
        src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs \
        src/Infrastructure/PeakPower.Persistence/Migrations \
        Directory.Packages.props \
        tests/PeakPower.Integration.Tests/Migrations/AuthSchemaTests.cs
git commit -m "feat(auth): add the refresh and reset tables with their RLS posture"
```

---

### Task 5: Token validation parameters, and the JWT bearer handler

One factory produces the `TokenValidationParameters`, and both the host and its tests use it —
so there is no way for the tests to be validating under rules the host does not apply.

Two settings deserve a note. `MapInboundClaims = false` stops the handler rewriting `sub` into
the WS-Federation URI `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier`;
without it, `User.FindFirst("sub")` returns nothing and the tenancy seam silently reads null.
`ValidAlgorithms` is pinned to ES256 alone, so a token that claims `"alg":"none"` or an HMAC
algorithm is rejected before any signature check is attempted — the classic JWT algorithm
confusion attack.

**Files:**
- Create: `src/Infrastructure/PeakPower.Infrastructure.Identity/CustomerTokenValidation.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Program.cs`
- Test: `tests/PeakPower.Application.Tests/Security/CustomerTokenValidationTests.cs`

**Interfaces:**
- Consumes: `ISigningKeyStore` (Task 2), `JwtTokenIssuer.Issuer`, `JwtTokenIssuer.Audience`
  (Task 3).
- Produces: `PeakPower.Infrastructure.Identity.CustomerTokenValidation` with
  `static TokenValidationParameters Parameters(ISigningKeyStore keys)`.

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Application.Tests/Security/CustomerTokenValidationTests.cs`:

```csharp
using Shouldly;
using Microsoft.IdentityModel.JsonWebTokens;
using NSubstitute;
using PeakPower.Application.Abstractions;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Identity;
using Xunit;

namespace PeakPower.Application.Tests.Security;

public sealed class CustomerTokenValidationTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 26, 9, 0, 0, TimeSpan.Zero);

    private static (JwtTokenIssuer Issuer, FileSigningKeyStore Keys) NewRealm()
    {
        var clock = Substitute.For<IMarketCalendar>();
        clock.UtcNow.Returns(Now);
        var keys = new FileSigningKeyStore(
            Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"), "key.pkcs8"));
        return (new JwtTokenIssuer(keys, clock), keys);
    }

    private static CustomerAccount Account() => CustomerAccount.Create(
        Guid.NewGuid(), "a@b.nl", "A", "B", jobTitle: null, "a@b.nl", phone: null,
        AccountStatus.Active, isAdmin: false).Value;

    [Fact]
    public async Task A_token_from_our_key_validates_and_keeps_sub_as_sub()
    {
        var (issuer, keys) = NewRealm();
        var token = issuer.IssueAccessToken(Account());

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(
            token.Jwt, CustomerTokenValidation.Parameters(keys));

        result.IsValid.ShouldBeTrue();
        result.ClaimsIdentity.FindFirst("sub").ShouldNotBeNull();
        result.ClaimsIdentity.FindFirst("customer_id").ShouldNotBeNull();
    }

    [Fact]
    public async Task A_token_signed_by_a_different_key_is_rejected()
    {
        var (issuer, _) = NewRealm();
        var (_, otherKeys) = NewRealm();
        var token = issuer.IssueAccessToken(Account());

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(
            token.Jwt, CustomerTokenValidation.Parameters(otherKeys));

        result.IsValid.ShouldBeFalse();
    }

    [Fact]
    public async Task An_unsigned_token_is_rejected_even_though_its_claims_are_perfect()
    {
        var (_, keys) = NewRealm();
        var unsigned = new JsonWebTokenHandler().CreateToken(
            new Microsoft.IdentityModel.Tokens.SecurityTokenDescriptor
            {
                Issuer = JwtTokenIssuer.Issuer,
                Audience = JwtTokenIssuer.Audience,
                Expires = Now.AddMinutes(15).UtcDateTime,
                Claims = new Dictionary<string, object> { ["sub"] = Guid.NewGuid().ToString() },
            });

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(
            unsigned, CustomerTokenValidation.Parameters(keys));

        result.IsValid.ShouldBeFalse();
    }

    [Fact]
    public async Task An_expired_token_is_rejected()
    {
        var clock = Substitute.For<IMarketCalendar>();
        clock.UtcNow.Returns(Now.AddHours(-2));
        var keys = new FileSigningKeyStore(
            Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"), "key.pkcs8"));
        var token = new JwtTokenIssuer(keys, clock).IssueAccessToken(Account());

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(
            token.Jwt, CustomerTokenValidation.Parameters(keys));

        result.IsValid.ShouldBeFalse();
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~CustomerTokenValidationTests"`
Expected: FAIL — `error CS0103: The name 'CustomerTokenValidation' does not exist in the current context`

- [ ] **Step 3: Write the validation parameters and wire the handler**

Create `src/Infrastructure/PeakPower.Infrastructure.Identity/CustomerTokenValidation.cs`:

```csharp
using Microsoft.IdentityModel.Tokens;

namespace PeakPower.Infrastructure.Identity;

/// <summary>
/// One place defines how a customer access token is validated, so the host and its tests can
/// never drift apart on the rules. When the credential moves to Entra, only the two lines that
/// supply the issuer and the keys change: <c>ValidIssuer</c> becomes the tenant's issuer and
/// <c>IssuerSigningKeys</c> is replaced by an <c>Authority</c> that fetches the remote JWKS.
/// Everything else here is already what an Entra token needs.
/// </summary>
public static class CustomerTokenValidation
{
    public static TokenValidationParameters Parameters(ISigningKeyStore keys) => new()
    {
        ValidateIssuer = true,
        ValidIssuer = JwtTokenIssuer.Issuer,

        ValidateAudience = true,
        ValidAudience = JwtTokenIssuer.Audience,

        ValidateLifetime = true,
        ClockSkew = TimeSpan.FromSeconds(30),

        ValidateIssuerSigningKey = true,
        IssuerSigningKeys = [keys.PublicKey],

        // Pinned, so "alg": "none" and HMAC confusion are rejected before a signature is
        // even attempted.
        ValidAlgorithms = [SecurityAlgorithms.EcdsaSha256],

        // Keep 'sub' spelled 'sub'. Without this the handler rewrites it to the WS-Federation
        // nameidentifier URI and the tenancy seam quietly reads null.
        NameClaimType = "sub",
    };
}
```

Modify `src/Hosts/PeakPower.Api.Customer/Program.cs` — add the authentication registration
after the `ISigningKeyStore` registration and before `var app = builder.Build();`:

```csharp
builder.Services.AddSingleton<ITokenIssuer, JwtTokenIssuer>();
builder.Services.AddSingleton<IPasswordHasher, Argon2idPasswordHasher>();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
        options.RequireHttpsMetadata = false;   // localhost only; slice 1 has no deployment
        options.TokenValidationParameters = CustomerTokenValidation.Parameters(
            builder.Services.BuildServiceProvider().GetRequiredService<ISigningKeyStore>());
    });

builder.Services.AddAuthorization();
```

> `BuildServiceProvider()` inside a registration is normally a smell, but the key store is a
> singleton with no dependencies of its own and the alternative — an
> `IConfigureOptions<JwtBearerOptions>` — buys nothing here. If the analyzer set flags it, move
> the construction to a local variable above the registration and close over it instead.

and add, after `app.UseStatusCodePages();`:

```csharp
app.UseAuthentication();
app.UseAuthorization();
```

Add the usings at the top of `Program.cs`:

```csharp
using Microsoft.AspNetCore.Authentication.JwtBearer;
using PeakPower.Application.Abstractions;
using PeakPower.Infrastructure.Identity;
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~CustomerTokenValidationTests"`
Expected: PASS — 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/Infrastructure/PeakPower.Infrastructure.Identity/CustomerTokenValidation.cs \
        src/Hosts/PeakPower.Api.Customer/Program.cs \
        tests/PeakPower.Application.Tests/Security/CustomerTokenValidationTests.cs
git commit -m "feat(auth): validate customer access tokens against the local ES256 key"
```

---

### Task 6: The token-backed `ICustomerContext`

`ICustomerContext` is the one seam identity crosses into the application through. `[F13]`
business rule 2 makes reading a customer identifier from a route, query, body or header a
defect, and architecture fact 6 already hardens that into a test — plan 2 wrote it, and it is
the reason this class does not live in the API host.

The fence is drawn as an assembly: no type outside `PeakPower.Infrastructure.Web` may use
`IHttpContextAccessor` or read a claim off `ClaimsPrincipal`. Shared contract §6 names that
assembly as the one context-provider home — "Do NOT put a provider inside an API host" — and
plan 2 already put the development provider there under `PeakPower.Infrastructure.Web.Tenancy`.
The token-backed provider goes beside it. An endpoint handler that wants to know who is calling
takes `ICustomerContext`; if it reaches for `ClaimsPrincipal` instead, plan 2's fact-6 test
fails the build. **Do not write a second fence here** — a namespace-scoped copy inside this plan
would restate fact 6 with weaker terms and the two would drift.

**Files:**
- Create: `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/JwtCustomerContext.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Program.cs`
- Test: `tests/PeakPower.Application.Tests/Auth/JwtCustomerContextTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Application.Abstractions.ICustomerContext` (shared contract §6, plan 2);
  `Microsoft.AspNetCore.Http.IHttpContextAccessor`; the `PeakPower.Infrastructure.Web` project
  plan 2 created.
- Produces: `PeakPower.Infrastructure.Web.Tenancy.JwtCustomerContext(IHttpContextAccessor) : ICustomerContext`.

- [ ] **Step 1: Write the failing unit test**

Create `tests/PeakPower.Application.Tests/Auth/JwtCustomerContextTests.cs`:

```csharp
using System.Security.Claims;
using Shouldly;
using Microsoft.AspNetCore.Http;
using PeakPower.Infrastructure.Web.Tenancy;
using Xunit;

namespace PeakPower.Application.Tests.Auth;

public sealed class JwtCustomerContextTests
{
    private static JwtCustomerContext ContextFor(params Claim[] claims)
    {
        var http = new DefaultHttpContext
        {
            User = claims.Length == 0
                ? new ClaimsPrincipal(new ClaimsIdentity())
                : new ClaimsPrincipal(new ClaimsIdentity(claims, "Bearer")),
        };
        return new JwtCustomerContext(new HttpContextAccessor { HttpContext = http });
    }

    [Fact]
    public void It_reads_the_customer_and_account_from_the_token()
    {
        var accountId = Guid.NewGuid();
        var customerId = Guid.NewGuid();

        var context = ContextFor(
            new Claim("sub", accountId.ToString()),
            new Claim("customer_id", customerId.ToString()),
            new Claim("is_admin", "true"));

        context.IsAuthenticated.ShouldBeTrue();
        context.AccountId.ShouldBe(accountId);
        context.CustomerId.ShouldBe(customerId);
        context.IsAdmin.ShouldBeTrue();
    }

    [Fact]
    public void Is_admin_is_false_when_the_claim_says_false()
    {
        var context = ContextFor(
            new Claim("sub", Guid.NewGuid().ToString()),
            new Claim("customer_id", Guid.NewGuid().ToString()),
            new Claim("is_admin", "false"));

        context.IsAdmin.ShouldBeFalse();
    }

    [Fact]
    public void An_unauthenticated_request_has_no_identity_and_no_ids()
    {
        var context = ContextFor();

        context.IsAuthenticated.ShouldBeFalse();
        context.CustomerId.ShouldBe(Guid.Empty);
        context.AccountId.ShouldBe(Guid.Empty);
        context.IsAdmin.ShouldBeFalse();
    }

    [Fact]
    public void A_query_string_customer_id_is_ignored_entirely()
    {
        var real = Guid.NewGuid();
        var http = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
            [
                new Claim("sub", Guid.NewGuid().ToString()),
                new Claim("customer_id", real.ToString()),
            ], "Bearer")),
        };
        http.Request.QueryString = new QueryString($"?customerId={Guid.NewGuid()}");

        new JwtCustomerContext(new HttpContextAccessor { HttpContext = http })
            .CustomerId.ShouldBe(real);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~JwtCustomerContextTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'JwtCustomerContext' could not be found`

- [ ] **Step 3: Write the context provider and register it**

Create `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/JwtCustomerContext.cs`, beside
plan 2's `DevelopmentCustomerContext`:

```csharp
using System.Security.Claims;
using PeakPower.Application.Abstractions;

namespace PeakPower.Infrastructure.Web.Tenancy;

/// <summary>
/// The customer realm's tenancy seam  [F13-R30]. Every value comes from the validated access
/// token and from nowhere else: <c>[F13]</c> business rule 2 makes reading a customer
/// identifier out of a route, a query string, a body or a header a defect, and architecture
/// fact 6 keeps that honest by forbidding any type outside this assembly from touching
/// <see cref="ClaimsPrincipal"/> or <see cref="IHttpContextAccessor"/> at all.
/// </summary>
public sealed class JwtCustomerContext(IHttpContextAccessor accessor) : ICustomerContext
{
    private ClaimsPrincipal? Principal =>
        accessor.HttpContext?.User is { Identity.IsAuthenticated: true } user ? user : null;

    public bool IsAuthenticated => Principal is not null;

    public Guid CustomerId => ReadGuid("customer_id");

    public Guid AccountId => ReadGuid("sub");

    public bool IsAdmin =>
        string.Equals(Principal?.FindFirst("is_admin")?.Value, "true", StringComparison.Ordinal);

    private Guid ReadGuid(string claimType) =>
        Guid.TryParse(Principal?.FindFirst(claimType)?.Value, out var value) ? value : Guid.Empty;
}
```

Modify `src/Hosts/PeakPower.Api.Customer/Program.cs` — add after `builder.Services.AddAuthorization();`:

```csharp
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICustomerContext, PeakPower.Infrastructure.Web.Tenancy.JwtCustomerContext>();
```

The unit test lives in `PeakPower.Application.Tests`, which does not yet see plan 2's assembly.
Add to `tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj`:

```xml
<ItemGroup>
  <ProjectReference Include="../../src/Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj" />
</ItemGroup>
```

- [ ] **Step 4: Run the unit test and watch it pass**

Run: `dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~JwtCustomerContextTests"`
Expected: PASS — 4 passed

- [ ] **Step 5: Run plan 2's architecture facts and watch them stay green**

The provider that just landed is the exact shape architecture fact 6 exists to police, so run
plan 2's suite rather than writing a second one.

Run: `dotnet test tests/PeakPower.Architecture.Tests`
Expected: PASS — every fact, including
`no_type_outside_the_context_provider_assembly_depends_on_http_context` and
`no_type_outside_the_context_provider_assembly_names_a_customer_identifier`.

If either goes red, the file is in the wrong assembly. Move it into
`src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/` — do not widen the allow-list.

- [ ] **Step 6: Commit**

```bash
git add src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/JwtCustomerContext.cs \
        src/Hosts/PeakPower.Api.Customer/Program.cs \
        tests/PeakPower.Application.Tests
git commit -m "feat(tenancy): read the customer context from the token, and fence off claims"
```

---

### Task 7: `CustomerSessionMiddleware` — the stamp check, on the round trip RLS already pays for

**This is the task the design's revocation argument rests on.** `[F01-R16]` says deactivating
an account revokes its sessions *immediately*. A stateless bearer token cannot be revoked
before it expires, so a 15-minute access token would ordinarily leave a 15-minute hole. The
design's answer is a `stamp` claim compared against `customer_account.security_stamp` on every
request — and the reason it costs nothing measurable is that every authenticated request
**already** has to open a transaction and issue `SET LOCAL app.customer_id` for row-level
security. The stamp lives on a row that transaction is about to touch anyway.

**Why it is one network round trip, and why the statement order is not negotiable.** Npgsql's
`NpgsqlBatch` sends every batch command in a single protocol exchange and returns one result
set per command, in order. The three commands must run in this order:

1. `SET LOCAL ROLE app_customer_role` — drop from the owner role, so RLS starts applying.
2. `SELECT set_config('app.customer_id', $1, true)` — tell the policies which tenant this is.
3. `SELECT security_stamp, status FROM customer.customer_account WHERE id = $1` — read the row.

Statement 3 is now filtered by the policy that statement 2 configured, which is exactly what we
want: if the token's `customer_id` does not match the account's real `customer_id`, the row is
invisible and we answer 401. Folding statement 2 into statement 3's target list — tempting,
because `set_config` is a function — is **wrong**: the policy is evaluated when the row is
scanned, and whether that happens before or after the target-list expression is not something
PostgreSQL promises. Keep them separate.

The transaction stays open for the whole request and commits when the pipeline unwinds, so
`SET LOCAL` remains in force for every query a handler runs.

**Files:**
- Create: `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerSessionMiddleware.cs`
- Create: `src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`
- Create: `src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Program.cs`
- Test: `tests/PeakPower.Integration.Tests/Auth/SecurityStampTests.cs`

**Interfaces:**
- Consumes: `PeakPowerDbContext` (plan 1); `ICustomerContext` / `JwtCustomerContext` (Task 6);
  `ITokenIssuer.IssueAccessToken(CustomerAccount)` (Task 3);
  `CustomerAccount.BumpSecurityStamp()` (shared contract §5.1, plan 1); the `app_customer_role`
  role and the `app.customer_id` setting (plan 2).
- Produces:
  - `PeakPower.Infrastructure.Web.Tenancy.CustomerSessionMiddleware` and the extension
    `IApplicationBuilder UseCustomerSession(this IApplicationBuilder app)`
  - `PeakPower.Contracts.Customer.Auth.CurrentAccountResponse(Guid AccountId, Guid CustomerId, string FirstName, string LastName, string Email, bool IsAdmin)`
  - `GET /api/v1/auth/me`, authenticated, 200 `CurrentAccountResponse`
  - `PeakPower.Api.Customer.Auth.AuthEndpoints.Map(IEndpointRouteBuilder)`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Auth/SecurityStampTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using Shouldly;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Application.Abstractions;
using PeakPower.Domain.Customers;
using Xunit;

namespace PeakPower.Integration.Tests.Auth;

public sealed class SecurityStampTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    /// <summary>Creates a company and one account, and returns a client already carrying a token.</summary>
    private async Task<(HttpClient Client, Guid AccountId)> SignedInClientAsync()
    {
        var account = await factory.SeedCustomerWithAccountAsync(
            legalName: "Vandersteen Koeling B.V.",
            kvk: "24398112",
            email: $"{Guid.NewGuid():N}@vandersteen.nl",
            password: "correct-horse-battery");

        using var scope = factory.Services.CreateScope();
        var issuer = scope.ServiceProvider.GetRequiredService<ITokenIssuer>();
        var jwt = issuer.IssueAccessToken(account).Jwt;

        var client = factory.CreateAnonymousClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwt);
        return (client, account.Id);
    }

    [Fact]
    public async Task A_fresh_token_is_accepted()
    {
        var (client, accountId) = await SignedInClientAsync();

        var response = await client.GetAsync("/api/v1/auth/me");

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await response.Content
            .ReadFromJsonAsync<PeakPower.Contracts.Customer.Auth.CurrentAccountResponse>();
        body!.AccountId.ShouldBe(accountId);
    }

    [Fact]
    public async Task Bumping_the_security_stamp_kills_the_token_on_the_very_next_call()
    {
        var (client, accountId) = await SignedInClientAsync();
        (await client.GetAsync("/api/v1/auth/me")).StatusCode.ShouldBe(HttpStatusCode.OK);

        await using (var db = factory.CreateOwnerDbContext())
        {
            var account = await db.CustomerAccounts.SingleAsync(a => a.Id == accountId);
            account.BumpSecurityStamp();          // what deactivation and reset both do
            await db.SaveChangesAsync();
        }

        var after = await client.GetAsync("/api/v1/auth/me");

        after.StatusCode.ShouldBe(HttpStatusCode.Unauthorized,
            "[F01-R16] says revocation is immediate, not in fifteen minutes");
    }

    [Fact]
    public async Task Deactivating_the_account_also_closes_the_session()
    {
        var (client, accountId) = await SignedInClientAsync();

        await using (var db = factory.CreateOwnerDbContext())
        {
            var account = await db.CustomerAccounts.SingleAsync(a => a.Id == accountId);
            await db.Database.ExecuteSqlAsync(
                $"UPDATE customer.customer_account SET status = 'DEACTIVATED' WHERE id = {accountId}");
        }

        (await client.GetAsync("/api/v1/auth/me")).StatusCode
            .ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task A_request_with_no_token_is_rejected()
    {
        var response = await factory.CreateAnonymousClient().GetAsync("/api/v1/auth/me");

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
```

Add the seeding helper to `tests/PeakPower.Integration.Tests/CustomerApiFactory.cs`:

```csharp
    /// <summary>Arranges a company with one admin account, on the owner role.</summary>
    public async Task<PeakPower.Domain.Customers.CustomerAccount> SeedCustomerWithAccountAsync(
        string legalName, string kvk, string email, string password)
    {
        using var scope = Services.CreateScope();
        var hasher = scope.ServiceProvider
            .GetRequiredService<PeakPower.Application.Abstractions.IPasswordHasher>();

        await using var db = CreateOwnerDbContext();

        var customer = PeakPower.Domain.Customers.Customer.Create(
            legalName: legalName,
            tradeName: null,
            kvkNumber: PeakPower.Domain.Common.KvkNumber.Create(kvk).Value,
            vatNumber: null,
            billingAddress: new PeakPower.Domain.Customers.Address(
                "Havenweg", "22", null, "3089 JJ", "Rotterdam", "NL"),
            visitingAddress: null,
            primaryContact: new PeakPower.Domain.Customers.ContactPerson(
                "Peter de Vries", email, null),
            internalReference: null,
            locale: "nl-NL").Value;
        db.Customers.Add(customer);

        var account = PeakPower.Domain.Customers.CustomerAccount.Create(
            customerId: customer.Id,
            username: email,
            firstName: "Peter",
            lastName: "de Vries",
            jobTitle: null,
            email: email,
            phone: null,
            status: PeakPower.Domain.Customers.AccountStatus.Active,
            isAdmin: true).Value;
        account.SetPassword(hasher.Hash(password));
        db.CustomerAccounts.Add(account);

        await db.SaveChangesAsync();
        return account;
    }
```

> Both factories are plan 1's, in the shape shared contract §5.1 fixes: nine parameters each,
> both returning `Result<T>`. `.Value` is safe here because the arrangement is well-formed by
> construction — a failure would mean the fixture itself is wrong, and the `NullReferenceException`
> says so loudly enough. `SetPassword` is the second call because the factory takes no hash; it
> also bumps the security stamp, which is exactly what a freshly seeded account wants.

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~SecurityStampTests"`
Expected: FAIL — all four fail with `404 Not Found` for `/api/v1/auth/me`

- [ ] **Step 3: Write the middleware**

Create `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerSessionMiddleware.cs`.
It reads `stamp` off the `ClaimsPrincipal`, so architecture fact 6 requires it here rather than
in the host, next to `JwtCustomerContext`:

```csharp
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using PeakPower.Persistence;

namespace PeakPower.Infrastructure.Web.Tenancy;

/// <summary>
/// Opens the per-request transaction row-level security needs, and checks the token's stamp on
/// the same round trip.
///
/// [F01-R16] wants session revocation to be immediate, and a stateless bearer token cannot be
/// recalled. The way out is to compare the token's <c>stamp</c> claim against the account's
/// <c>security_stamp</c> column on every call. That would be an extra query — except that every
/// authenticated request already has to open a transaction and set <c>app.customer_id</c>, so
/// the stamp read rides along on a row we are touching anyway.
/// </summary>
public sealed class CustomerSessionMiddleware(RequestDelegate next)
{
    private const string SetRole = "SET LOCAL ROLE app_customer_role";
    private const string SetTenant = "SELECT set_config('app.customer_id', $1, true)";
    private const string ReadAccount =
        "SELECT security_stamp, status FROM customer.customer_account WHERE id = $1";

    public async Task InvokeAsync(HttpContext context, PeakPowerDbContext db)
    {
        if (context.User?.Identity?.IsAuthenticated != true)
        {
            // Anonymous endpoints — sign-in, refresh, password reset, onboarding — run on the
            // owner role with no tenant set. Task 8's allow-list test is what stops an endpoint
            // getting here by accident.
            await next(context);
            return;
        }

        if (!TryReadIdentity(context.User, out var customerId, out var accountId, out var stamp))
        {
            await RejectAsync(context, "The access token is malformed.");
            return;
        }

        var cancellationToken = context.RequestAborted;
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        var dbTransaction = (NpgsqlTransaction)transaction.GetDbTransaction();

        Guid storedStamp;
        string status;

        await using (var batch = new NpgsqlBatch(connection, dbTransaction))
        {
            batch.BatchCommands.Add(new NpgsqlBatchCommand(SetRole));
            batch.BatchCommands.Add(new NpgsqlBatchCommand(SetTenant)
            {
                Parameters = { new NpgsqlParameter { Value = customerId.ToString() } },
            });
            batch.BatchCommands.Add(new NpgsqlBatchCommand(ReadAccount)
            {
                Parameters = { new NpgsqlParameter { Value = accountId } },
            });

            await using var reader = await batch.ExecuteReaderAsync(cancellationToken);

            // One result set per batch command, in order. Skip SET LOCAL ROLE and set_config.
            await reader.NextResultAsync(cancellationToken);
            await reader.NextResultAsync(cancellationToken);

            if (!await reader.ReadAsync(cancellationToken))
            {
                // Either the account is gone, or its customer_id does not match the token's —
                // in which case the tenant policy configured two statements ago hid the row.
                await RejectAsync(context, "The account in this token no longer exists.");
                return;
            }

            storedStamp = reader.GetGuid(0);
            status = reader.GetString(1);
        }

        if (storedStamp != stamp)
        {
            await RejectAsync(context, "This session has been revoked. Sign in again.");
            return;
        }

        if (!string.Equals(status, "ACTIVE", StringComparison.Ordinal))
        {
            await RejectAsync(context, "This account is not active.");
            return;
        }

        await next(context);

        // Reads only in slice 1's authenticated surface, but committing rather than rolling
        // back keeps the door open for handlers that write, and releases the snapshot either
        // way. A handler that threw never reaches here and the transaction disposes as a
        // rollback.
        await transaction.CommitAsync(cancellationToken);
    }

    private static bool TryReadIdentity(
        ClaimsPrincipal user, out Guid customerId, out Guid accountId, out Guid stamp)
    {
        customerId = accountId = stamp = Guid.Empty;
        return Guid.TryParse(user.FindFirst("customer_id")?.Value, out customerId)
            && Guid.TryParse(user.FindFirst("sub")?.Value, out accountId)
            && Guid.TryParse(user.FindFirst("stamp")?.Value, out stamp);
    }

    private static async Task RejectAsync(HttpContext context, string detail)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(
            new Microsoft.AspNetCore.Mvc.ProblemDetails
            {
                Status = StatusCodes.Status401Unauthorized,
                Title = "Not signed in",
                Detail = detail,
            },
            contentType: "application/problem+json");
    }
}

public static class CustomerSessionMiddlewareExtensions
{
    /// <summary>Must sit after UseAuthentication and before UseAuthorization.</summary>
    public static IApplicationBuilder UseCustomerSession(this IApplicationBuilder app) =>
        app.UseMiddleware<CustomerSessionMiddleware>();
}
```

- [ ] **Step 4: Write `GET /auth/me` and wire the middleware**

Create `src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs`:

```csharp
namespace PeakPower.Contracts.Customer.Auth;

/// <summary>Who the caller is, as the portal's shell needs it.</summary>
public sealed record CurrentAccountResponse(
    Guid AccountId,
    Guid CustomerId,
    string FirstName,
    string LastName,
    string Email,
    bool IsAdmin);
```

Create `src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Persistence;

namespace PeakPower.Api.Customer.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/v1/auth").WithTags("Auth");

        group.MapGet("/me", async (
                ICustomerContext customer,
                PeakPowerDbContext db,
                CancellationToken cancellationToken) =>
            {
                var account = await db.CustomerAccounts
                    .AsNoTracking()
                    .SingleOrDefaultAsync(a => a.Id == customer.AccountId, cancellationToken);

                // The row is behind the tenant policy, so "missing" already means "not yours" —
                // 404, never 403  [F13-R19].
                return account is null
                    ? Results.NotFound()
                    : Results.Ok(new CurrentAccountResponse(
                        account.Id, account.CustomerId, account.FirstName,
                        account.LastName, account.Email, account.IsAdmin));
            })
            .RequireAuthorization()
            .WithName("GetCurrentAccount")
            .WithSummary("The signed-in account.");

        return routes;
    }
}
```

Modify `src/Hosts/PeakPower.Api.Customer/Program.cs` — replace the pipeline block so it reads:

```csharp
app.UseExceptionHandler();
app.UseStatusCodePages();

app.UseAuthentication();
app.UseCustomerSession();     // transaction + app.customer_id + the stamp check
app.UseAuthorization();

app.MapGet("/.well-known/jwks.json", (ISigningKeyStore keys) => Results.Json(keys.PublicJwks))
   .WithName("Jwks")
   .WithSummary("The public keys access tokens are verified against.");

app.MapAuthEndpoints();

app.MapDefaultEndpoints();

app.Run();
```

and add the usings:

```csharp
using PeakPower.Api.Customer.Auth;
using PeakPower.Infrastructure.Web.Tenancy;
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~SecurityStampTests"`
Expected: PASS — 4 passed

- [ ] **Step 6: Commit**

```bash
git add src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerSessionMiddleware.cs \
        src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs \
        src/Hosts/PeakPower.Api.Customer/Program.cs \
        src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs \
        tests/PeakPower.Integration.Tests
git commit -m "feat(auth): check the security stamp on the round trip RLS already pays for"
```

---

### Task 8: The anonymous allow-list test

Convention C3 means the customer API's connection logs in as the owner role and only drops to
`app_customer_role` inside `CustomerSessionMiddleware`. That is the right shape — onboarding
writes rows for a company that does not exist yet — but it has one failure mode: an endpoint
added without `RequireAuthorization()` never reaches the middleware, so it runs with row-level
security disabled and no tenant set. It would look like it worked.

This test closes that. It reads the registered endpoint table (not a hand-written list, so a
new route cannot escape it) and asserts that the set of anonymous endpoints is *exactly* the
set named here. Adding an endpoint means either requiring authorization or adding a line to
this list and explaining it in review.

**Files:**
- Test: `tests/PeakPower.Integration.Tests/Auth/AnonymousEndpointAllowListTests.cs`

**Interfaces:**
- Consumes: `CustomerApiFactory.Services` (Task 2);
  `Microsoft.AspNetCore.Routing.EndpointDataSource`.
- Produces: nothing consumed elsewhere. Later tasks in this plan **and plan 6** must extend
  `Expected` when they add an anonymous route.

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Auth/AnonymousEndpointAllowListTests.cs`:

```csharp
using Shouldly;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace PeakPower.Integration.Tests.Auth;

/// <summary>
/// The customer API's connection logs in as the owner role, which bypasses row-level security;
/// CustomerSessionMiddleware is what drops an authenticated request to app_customer_role. An
/// endpoint that forgets RequireAuthorization() therefore runs unrestricted and looks fine.
/// This test is the only thing standing between that mistake and production.
/// </summary>
public sealed class AnonymousEndpointAllowListTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    /// <summary>
    /// Every route that is allowed to run without a token, and why.
    /// Adding a line here is a decision a reviewer must agree with.
    /// </summary>
    private static readonly string[] Expected =
    [
        "GET /.well-known/jwks.json",                                       // public by design
        "POST /api/v1/auth/password-reset/completions",                     // the token is the credential
        "POST /api/v1/auth/password-reset/requests",                        // no session yet
        "POST /api/v1/auth/refresh",                                        // the cookie is the credential
        "POST /api/v1/auth/sign-in",                                        // no session yet
        "PATCH /api/v1/onboarding/applications/{id}",                       // the id is the capability
        "POST /api/v1/onboarding/applications",                             // there is no customer yet
        "POST /api/v1/onboarding/applications/{id}/bank-verification/simulate", // Development only
        "POST /api/v1/onboarding/applications/{id}/sign",                   // the code is the credential
        "POST /api/v1/onboarding/applications/{id}/signatories",            // the id is the capability
    ];

    [Fact]
    public void Every_endpoint_requires_a_token_unless_it_is_on_the_allow_list()
    {
        using var scope = factory.Services.CreateScope();
        var endpoints = scope.ServiceProvider.GetRequiredService<EndpointDataSource>().Endpoints;

        var anonymous = endpoints
            .OfType<RouteEndpoint>()
            .Where(IsAnonymous)
            .Where(e => !IsInfrastructure(e))
            .Select(Describe)
            .OrderBy(x => x, StringComparer.Ordinal)
            .ToArray();

        anonymous.ShouldBe(Expected,
            "an endpoint that skips CustomerSessionMiddleware runs with RLS disabled");
    }

    private static bool IsAnonymous(RouteEndpoint endpoint) =>
        endpoint.Metadata.GetMetadata<IAuthorizeData>() is null
        || endpoint.Metadata.GetMetadata<IAllowAnonymous>() is not null;

    /// <summary>Health and liveness come from ServiceDefaults and are Aspire's, not ours.</summary>
    private static bool IsInfrastructure(RouteEndpoint endpoint) =>
        endpoint.RoutePattern.RawText is "/health" or "/alive" or "/openapi/{documentName}.json";

    private static string Describe(RouteEndpoint endpoint)
    {
        var methods = endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods
                      ?? ["ANY"];
        return $"{string.Join(",", methods.OrderBy(m => m, StringComparer.Ordinal))} "
             + $"/{endpoint.RoutePattern.RawText?.TrimStart('/')}";
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~AnonymousEndpointAllowListTests"`
Expected: FAIL — the JWKS route is present but the nine `/api/v1/…` routes are missing, so
Shouldly reports the element-by-element difference between the two collections

- [ ] **Step 3: Mark the test as pending the endpoints it guards**

The endpoints it names are built in Tasks 10 to 19. Keep the assertion honest in the meantime by
comparing only against the routes that exist:

```csharp
        anonymous.ShouldBeSubsetOf(Expected,
            "an endpoint that skips CustomerSessionMiddleware runs with RLS disabled");
```

Leave the `Expected` array complete — it is the specification of what may be anonymous — and
restore the `BeEquivalentTo` assertion in Task 19 Step 6, when the last of those routes exists.

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~AnonymousEndpointAllowListTests"`
Expected: PASS — 1 passed

- [ ] **Step 5: Commit**

```bash
git add tests/PeakPower.Integration.Tests/Auth/AnonymousEndpointAllowListTests.cs
git commit -m "test(auth): fail the build when an endpoint escapes the tenant session"
```

---

### Task 9: Progressive sign-in delay

**Why a delay and not a lockout.** A hard lockout after N failures is a denial-of-service
primitive aimed at a named customer: anyone who knows an energy trader's email address can
lock them out of their own account during a price spike, at no cost, from anywhere. A
progressive delay costs an attacker the same time it costs a legitimate user who mistyped
once, but grows fast enough that an online guessing campaign becomes worthless. Design §7 makes
this an explicit choice; the numbers below are the narrowed `[OQ-98]` and are the only part
that is open.

The counters are keyed by **both** the username and the source address, and the applied delay
is the larger of the two — so a spray across many accounts from one address is throttled by the
source counter even though no single username has failed often.

**The curve:** failures 0 → 0 ms, 1 → 250 ms, 2 → 500 ms, 3 → 1 s, 4 → 2 s, 5 → 4 s, 6 or more
→ 8 s (capped). Counters slide over 15 minutes and are cleared on a successful sign-in.

**Files:**
- Create: `src/Hosts/PeakPower.Api.Customer/Auth/ISignInThrottle.cs`
- Create: `src/Hosts/PeakPower.Api.Customer/Auth/InMemorySignInThrottle.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Program.cs`
- Test: `tests/PeakPower.Application.Tests/Auth/InMemorySignInThrottleTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Application.Abstractions.IMarketCalendar` (plan 1).
- Produces:
  - `PeakPower.Api.Customer.Auth.ISignInThrottle` —
    `TimeSpan DelayFor(string username, string source)`,
    `void RecordFailure(string username, string source)`,
    `void RecordSuccess(string username, string source)`
  - `PeakPower.Api.Customer.Auth.InMemorySignInThrottle(IMarketCalendar) : ISignInThrottle`
    with `static readonly TimeSpan Window` and `static readonly IReadOnlyList<TimeSpan> Curve`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Application.Tests/Auth/InMemorySignInThrottleTests.cs`:

```csharp
using Shouldly;
using NSubstitute;
using PeakPower.Api.Customer.Auth;
using PeakPower.Application.Abstractions;
using Xunit;

namespace PeakPower.Application.Tests.Auth;

public sealed class InMemorySignInThrottleTests
{
    private readonly IMarketCalendar _calendar = Substitute.For<IMarketCalendar>();
    private DateTimeOffset _now = new(2026, 8, 26, 9, 0, 0, TimeSpan.Zero);

    private InMemorySignInThrottle Create()
    {
        _calendar.UtcNow.Returns(_ => _now);
        return new InMemorySignInThrottle(_calendar);
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(1, 250)]
    [InlineData(2, 500)]
    [InlineData(3, 1000)]
    [InlineData(4, 2000)]
    [InlineData(5, 4000)]
    [InlineData(6, 8000)]
    [InlineData(20, 8000)]
    public void The_delay_grows_with_the_failure_count_and_caps_at_eight_seconds(
        int failures, int expectedMilliseconds)
    {
        var throttle = Create();
        for (var i = 0; i < failures; i++) throttle.RecordFailure("p@vandersteen.nl", "10.0.0.1");

        throttle.DelayFor("p@vandersteen.nl", "10.0.0.1")
            .ShouldBe(TimeSpan.FromMilliseconds(expectedMilliseconds));
    }

    [Fact]
    public void A_successful_sign_in_clears_the_counter()
    {
        var throttle = Create();
        for (var i = 0; i < 4; i++) throttle.RecordFailure("p@vandersteen.nl", "10.0.0.1");

        throttle.RecordSuccess("p@vandersteen.nl", "10.0.0.1");

        throttle.DelayFor("p@vandersteen.nl", "10.0.0.1").ShouldBe(TimeSpan.Zero);
    }

    [Fact]
    public void A_spray_across_many_usernames_is_still_throttled_by_the_source()
    {
        var throttle = Create();
        for (var i = 0; i < 5; i++) throttle.RecordFailure($"victim{i}@example.nl", "10.0.0.1");

        throttle.DelayFor("someone-new@example.nl", "10.0.0.1")
            .ShouldBe(TimeSpan.FromSeconds(4));
    }

    [Fact]
    public void Failures_older_than_the_window_stop_counting()
    {
        var throttle = Create();
        for (var i = 0; i < 6; i++) throttle.RecordFailure("p@vandersteen.nl", "10.0.0.1");

        _now = _now.AddMinutes(16);

        throttle.DelayFor("p@vandersteen.nl", "10.0.0.1").ShouldBe(TimeSpan.Zero);
    }

    [Fact]
    public void The_username_key_is_case_insensitive_because_the_column_is_citext()
    {
        var throttle = Create();
        for (var i = 0; i < 3; i++) throttle.RecordFailure("P@Vandersteen.NL", "10.0.0.1");

        throttle.DelayFor("p@vandersteen.nl", "10.0.0.2")
            .ShouldBe(TimeSpan.FromSeconds(1));
    }
}
```

Add to `tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj`:

```xml
<ItemGroup>
  <ProjectReference Include="../../src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj" />
</ItemGroup>
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~InMemorySignInThrottleTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'InMemorySignInThrottle' could not be found`

- [ ] **Step 3: Write the throttle**

Create `src/Hosts/PeakPower.Api.Customer/Auth/ISignInThrottle.cs`:

```csharp
namespace PeakPower.Api.Customer.Auth;

/// <summary>
/// Rate-limits sign-in by delaying the answer rather than locking the account. A hard lockout
/// on a username is a denial-of-service primitive: anyone who knows a customer's email address
/// could lock them out during a price spike, for free. A delay costs an attacker the same time
/// it costs a user who mistyped, and grows fast enough that online guessing is worthless.
/// </summary>
public interface ISignInThrottle
{
    TimeSpan DelayFor(string username, string source);
    void RecordFailure(string username, string source);
    void RecordSuccess(string username, string source);
}
```

Create `src/Hosts/PeakPower.Api.Customer/Auth/InMemorySignInThrottle.cs`:

```csharp
using System.Collections.Concurrent;
using PeakPower.Application.Abstractions;

namespace PeakPower.Api.Customer.Auth;

/// <summary>
/// A process-local sliding-window counter. Slice 1 runs one instance of the API, so process
/// memory is the right store; a multi-instance deployment moves this to Redis behind the same
/// interface. The curve values are the narrowed [OQ-98] — the mechanism is settled, the numbers
/// belong to whoever owns security policy.
/// </summary>
public sealed class InMemorySignInThrottle(IMarketCalendar calendar) : ISignInThrottle
{
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(15);

    public static readonly IReadOnlyList<TimeSpan> Curve =
    [
        TimeSpan.Zero,
        TimeSpan.FromMilliseconds(250),
        TimeSpan.FromMilliseconds(500),
        TimeSpan.FromSeconds(1),
        TimeSpan.FromSeconds(2),
        TimeSpan.FromSeconds(4),
        TimeSpan.FromSeconds(8),
    ];

    private readonly ConcurrentDictionary<string, List<DateTimeOffset>> _failures = new();

    public TimeSpan DelayFor(string username, string source)
    {
        var byUsername = CountWithinWindow(UsernameKey(username));
        var bySource = CountWithinWindow(SourceKey(source));
        return Delay(Math.Max(byUsername, bySource));
    }

    public void RecordFailure(string username, string source)
    {
        Add(UsernameKey(username));
        Add(SourceKey(source));
    }

    public void RecordSuccess(string username, string source)
    {
        _failures.TryRemove(UsernameKey(username), out _);
        _failures.TryRemove(SourceKey(source), out _);
    }

    private static TimeSpan Delay(int failures) =>
        Curve[Math.Min(failures, Curve.Count - 1)];

    // The username column is citext, so the counter must be case-insensitive too — otherwise
    // varying the capitalisation resets the delay.
    private static string UsernameKey(string username) => "u:" + username.Trim().ToLowerInvariant();

    private static string SourceKey(string source) => "s:" + source;

    private void Add(string key)
    {
        var bucket = _failures.GetOrAdd(key, _ => []);
        lock (bucket)
        {
            bucket.Add(calendar.UtcNow);
        }
    }

    private int CountWithinWindow(string key)
    {
        if (!_failures.TryGetValue(key, out var bucket)) return 0;

        var cutoff = calendar.UtcNow - Window;
        lock (bucket)
        {
            bucket.RemoveAll(at => at < cutoff);
            return bucket.Count;
        }
    }
}
```

Modify `src/Hosts/PeakPower.Api.Customer/Program.cs` — add beside the other singletons:

```csharp
builder.Services.AddSingleton<ISignInThrottle, InMemorySignInThrottle>();
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~InMemorySignInThrottleTests"`
Expected: PASS — 12 passed

- [ ] **Step 5: Commit**

```bash
git add src/Hosts/PeakPower.Api.Customer/Auth/ISignInThrottle.cs \
        src/Hosts/PeakPower.Api.Customer/Auth/InMemorySignInThrottle.cs \
        src/Hosts/PeakPower.Api.Customer/Program.cs \
        tests/PeakPower.Application.Tests \
        tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj
git commit -m "feat(auth): delay repeated sign-in failures instead of locking the account"
```

---

### Task 10: `POST /auth/sign-in`

Two anti-enumeration measures that are easy to leave out and expensive to add later.

**Constant work for an unknown username.** If the handler returns early when no account
matches, the response is measurably faster than for a real account, and an attacker can
enumerate valid addresses with a stopwatch. So the handler verifies the presented password
against a fixed dummy Argon2id hash when the account does not exist — the same 19 MiB of work,
the same answer.

**One error, whatever went wrong.** Wrong password, unknown username and deactivated account
all produce the same 401 with the same body.

**Files:**
- Modify: `src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`
- Modify: `src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs`
- Create: `src/Hosts/PeakPower.Api.Customer/Auth/RefreshCookie.cs`
- Test: `tests/PeakPower.Integration.Tests/Auth/SignInTests.cs`

**Interfaces:**
- Consumes: `IPasswordHasher` (Task 1), `ITokenIssuer` (Task 3), `ISignInThrottle` (Task 9),
  `RefreshToken.Issue(...)` (Task 4) and `CustomerAccount.RecordSuccessfulSignIn(...)`
  (shared contract §5.1, plan 1),
  `OpaqueToken.HashOf(...)` (Task 3), `IMarketCalendar` (plan 1).
- Produces:
  - `PeakPower.Contracts.Customer.Auth.SignInRequest(string Username, string Password)`
  - `PeakPower.Contracts.Customer.Auth.SignInResponse(string AccessToken, DateTimeOffset ExpiresAt, CurrentAccountResponse Account)`
  - `PeakPower.Api.Customer.Auth.RefreshCookie` — `const string Name = "pp_refresh"`,
    `const string Path = "/api/v1/auth/refresh"`,
    `static void Write(HttpResponse response, string token, DateTimeOffset expiresAt)`,
    `static void Clear(HttpResponse response)`
  - `POST /api/v1/auth/sign-in`, anonymous, 200 `SignInResponse` + `Set-Cookie: pp_refresh`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Auth/SignInTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Shouldly;
using PeakPower.Contracts.Customer.Auth;
using Xunit;

namespace PeakPower.Integration.Tests.Auth;

public sealed class SignInTests(CustomerApiFactory factory) : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    private async Task<string> SeedAccountAsync()
    {
        var email = $"{Guid.NewGuid():N}@vandersteen.nl";
        await factory.SeedCustomerWithAccountAsync(
            "Vandersteen Koeling B.V.", "24398112", email, Password);
        return email;
    }

    [Fact]
    public async Task Correct_credentials_return_a_token_and_a_scoped_refresh_cookie()
    {
        var email = await SeedAccountAsync();
        var client = factory.CreateAnonymousClient();

        var response = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<SignInResponse>();
        body!.AccessToken.ShouldNotBeNullOrWhiteSpace();
        body.Account.Email.ShouldBe(email);

        var cookie = response.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("pp_refresh="));
        cookie.ShouldContain("httponly", AtLeast.Once());
        cookie.ToLowerInvariant().ShouldContain("path=/api/v1/auth/refresh");
        cookie.ToLowerInvariant().ShouldContain("samesite=strict");
        cookie.ToLowerInvariant().ShouldContain("secure");
    }

    [Fact]
    public async Task The_wrong_password_is_rejected_with_a_problem_document()
    {
        var email = await SeedAccountAsync();

        var response = await factory.CreateAnonymousClient().PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, "correct-horse-batteri"));

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
        response.Headers.Contains("Set-Cookie").ShouldBeFalse();
    }

    [Fact]
    public async Task An_unknown_username_gets_the_same_answer_as_a_wrong_password()
    {
        var known = await SeedAccountAsync();
        var client = factory.CreateAnonymousClient();

        var wrongPassword = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(known, "nope-nope-nope"));
        var unknownUser = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest("nobody@example.nl", "nope-nope-nope"));

        unknownUser.StatusCode.ShouldBe(wrongPassword.StatusCode);
        (await unknownUser.Content.ReadAsStringAsync())
            .ShouldBe(await wrongPassword.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Repeated_failures_get_progressively_slower()
    {
        var email = await SeedAccountAsync();
        var client = factory.CreateAnonymousClient();

        for (var i = 0; i < 3; i++)
        {
            await client.PostAsJsonAsync("/api/v1/auth/sign-in", new SignInRequest(email, "wrong"));
        }

        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        await client.PostAsJsonAsync("/api/v1/auth/sign-in", new SignInRequest(email, "wrong"));
        stopwatch.Stop();

        stopwatch.Elapsed.ShouldBeGreaterThan(TimeSpan.FromMilliseconds(900),
            "three prior failures buy a one-second delay");
    }

    [Fact]
    public async Task A_deactivated_account_cannot_sign_in()
    {
        var email = await SeedAccountAsync();
        await using (var db = factory.CreateOwnerDbContext())
        {
            await db.Database.ExecuteSqlAsync(
                $"UPDATE customer.customer_account SET status = 'DEACTIVATED' WHERE username = {email}");
        }

        var response = await factory.CreateAnonymousClient().PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password));

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~SignInTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'SignInRequest' could not be found`

- [ ] **Step 3: Write the cookie helper and the contracts**

Create `src/Hosts/PeakPower.Api.Customer/Auth/RefreshCookie.cs`:

```csharp
namespace PeakPower.Api.Customer.Auth;

/// <summary>
/// The one place that writes or clears the refresh cookie.
///
/// The cookie is path-scoped to the refresh endpoint alone, so it is not attached to any other
/// request and an XSS that can make requests still cannot exfiltrate it. Note the asymmetry:
/// a browser only *sends* the cookie to that path, but a *Set-Cookie* for that path can be
/// issued from anywhere — which is how sign-out, at a different path, still clears it.
/// </summary>
public static class RefreshCookie
{
    public const string Name = "pp_refresh";
    public const string Path = "/api/v1/auth/refresh";

    public static void Write(HttpResponse response, string token, DateTimeOffset expiresAt) =>
        response.Cookies.Append(Name, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = true,
            SameSite = SameSiteMode.Strict,
            Path = Path,
            Expires = expiresAt,
            IsEssential = true,
        });

    public static void Clear(HttpResponse response) =>
        response.Cookies.Append(Name, string.Empty, new CookieOptions
        {
            HttpOnly = true,
            Secure = true,
            SameSite = SameSiteMode.Strict,
            Path = Path,
            Expires = DateTimeOffset.UnixEpoch,
            IsEssential = true,
        });
}
```

Add to `src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs`:

```csharp
/// <summary>The username is the email address the person signed up with.</summary>
public sealed record SignInRequest(string Username, string Password);

public sealed record SignInResponse(
    string AccessToken,
    DateTimeOffset ExpiresAt,
    CurrentAccountResponse Account);
```

- [ ] **Step 4: Write the sign-in handler**

Add to `MapAuthEndpoints` in `src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`, before
`return routes;`:

```csharp
        group.MapPost("/sign-in", async (
                SignInRequest request,
                HttpContext http,
                PeakPowerDbContext db,
                IPasswordHasher hasher,
                ITokenIssuer tokens,
                ISignInThrottle throttle,
                IMarketCalendar calendar,
                CancellationToken cancellationToken) =>
            {
                var username = (request.Username ?? string.Empty).Trim();
                var source = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";

                var delay = throttle.DelayFor(username, source);
                if (delay > TimeSpan.Zero)
                {
                    await Task.Delay(delay, cancellationToken);
                }

                var account = await db.CustomerAccounts
                    .SingleOrDefaultAsync(a => a.Username == username, cancellationToken);

                // Verify against a fixed hash when there is no account, so an unknown username
                // costs the same 19 MiB of Argon2id as a real one. Without this, a stopwatch
                // enumerates our customer list.
                var passwordIsRight = account?.PasswordHash is { } stored
                    ? hasher.Verify(request.Password ?? string.Empty, stored)
                    : hasher.Verify(request.Password ?? string.Empty, DummyHash) && false;

                if (account is null || !passwordIsRight || account.Status != AccountStatus.Active)
                {
                    throttle.RecordFailure(username, source);
                    return Results.Problem(
                        title: "Sign-in failed",
                        detail: "That username and password do not match an active account.",
                        statusCode: StatusCodes.Status401Unauthorized);
                }

                throttle.RecordSuccess(username, source);

                var now = calendar.UtcNow;
                account.RecordSuccessfulSignIn(now);

                var access = tokens.IssueAccessToken(account);
                var refresh = tokens.IssueRefreshToken(account.Id, out var refreshExpiresAt);
                db.RefreshTokens.Add(RefreshToken.Issue(
                    account.Id, OpaqueToken.HashOf(refresh), now, refreshExpiresAt));

                await db.SaveChangesAsync(cancellationToken);

                RefreshCookie.Write(http.Response, refresh, refreshExpiresAt);

                return Results.Ok(new SignInResponse(
                    access.Jwt,
                    access.ExpiresAt,
                    new CurrentAccountResponse(
                        account.Id, account.CustomerId, account.FirstName,
                        account.LastName, account.Email, account.IsAdmin)));
            })
            .AllowAnonymous()
            .WithName("SignIn")
            .WithSummary("Exchange a username and password for an access token.");
```

and add at the top of the class, above `MapAuthEndpoints`:

```csharp
    /// <summary>
    /// A real Argon2id hash of a value nobody knows, so verifying against it does the same work
    /// as verifying a real credential and takes the same time. It can never match: the plaintext
    /// was generated once and discarded.
    /// </summary>
    private const string DummyHash =
        "$argon2id$v=19$m=19456,t=2,p=1$"
        + "wLPPHtV5eeCQmpxDQ4XQtA==$3Nb0R1Wq0nQ0DkzZQyKq0i2f7yV0y1nQqk2gGZ7pJ8Q=";
```

with the extra usings at the top of the file:

```csharp
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Identity;
```

> The `&& false` in the dummy-hash branch is deliberate and load-bearing: the call must happen
> for its timing, and its result must never grant access. Add a comment saying so; a reviewer
> who "simplifies" it away reintroduces the oracle.

- [ ] **Step 5: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~SignInTests"`
Expected: PASS — 5 passed

- [ ] **Step 6: Commit**

```bash
git add src/Hosts/PeakPower.Api.Customer/Auth \
        src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs \
        tests/PeakPower.Integration.Tests/Auth/SignInTests.cs
git commit -m "feat(auth): sign in with a constant-time answer and a progressive delay"
```

---

### Task 11: `POST /auth/refresh` — rotation, single use, and replay detection

Rotation means every refresh consumes the presented token and issues a new one. That gives a
free theft detector: if a token that has **already been used** is presented again, either the
legitimate client or an attacker is holding a stale copy, and there is no way to tell which. The
safe answer is to assume theft and revoke the entire chain for that account, forcing a fresh
sign-in. This is the standard OAuth refresh-token-rotation response and it is worth a test of
its own.

**Files:**
- Modify: `src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`
- Modify: `src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs`
- Test: `tests/PeakPower.Integration.Tests/Auth/RefreshRotationTests.cs`

**Interfaces:**
- Consumes: `RefreshCookie.Name/Path/Write/Clear` (Task 10);
  `RefreshToken.IsUsable(DateTimeOffset)`, `RefreshToken.MarkUsed(DateTimeOffset, Guid)`,
  `RefreshToken.Revoke(DateTimeOffset)` (Task 4); `ITokenIssuer` (Task 3);
  `OpaqueToken.HashOf(string)` (Task 3).
- Produces: `POST /api/v1/auth/refresh`, anonymous, 200 `SignInResponse` + a rotated
  `Set-Cookie: pp_refresh`.

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Auth/RefreshRotationTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Shouldly;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Auth;
using Xunit;

namespace PeakPower.Integration.Tests.Auth;

public sealed class RefreshRotationTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    /// <summary>Signs in and hands back the raw refresh token, read out of the Set-Cookie header.</summary>
    private async Task<(HttpClient Client, string Refresh, Guid AccountId)> SignInAsync()
    {
        var email = $"{Guid.NewGuid():N}@vandersteen.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            "Vandersteen Koeling B.V.", "24398112", email, Password);

        var client = factory.CreateAnonymousClient();
        var response = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password));

        var header = response.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith("pp_refresh="));
        var token = header["pp_refresh=".Length..].Split(';')[0];
        return (client, token, account.Id);
    }

    private static HttpRequestMessage RefreshRequest(string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/refresh");
        request.Headers.Add("Cookie", $"pp_refresh={token}");
        return request;
    }

    [Fact]
    public async Task A_valid_refresh_token_returns_a_new_pair()
    {
        var (client, refresh, _) = await SignInAsync();

        var response = await client.SendAsync(RefreshRequest(refresh));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<SignInResponse>();
        body!.AccessToken.ShouldNotBeNullOrWhiteSpace();

        var rotated = response.Headers.GetValues("Set-Cookie")
            .Single(c => c.StartsWith("pp_refresh="))["pp_refresh=".Length..].Split(';')[0];
        rotated.ShouldNotBe(refresh, "rotation means the old token is spent");
    }

    [Fact]
    public async Task Presenting_the_same_token_twice_is_treated_as_theft()
    {
        var (client, refresh, accountId) = await SignInAsync();
        (await client.SendAsync(RefreshRequest(refresh))).StatusCode
            .ShouldBe(HttpStatusCode.OK);

        var replay = await client.SendAsync(RefreshRequest(refresh));

        replay.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        await using var db = factory.CreateOwnerDbContext();
        var live = await db.RefreshTokens
            .Where(t => t.AccountId == accountId && t.RevokedAt == null && t.UsedAt == null)
            .CountAsync();
        live.ShouldBe(0, "a replay revokes the whole chain, including the rotated token");
    }

    [Fact]
    public async Task A_token_that_was_never_issued_is_rejected()
    {
        var (client, _, _) = await SignInAsync();

        var response = await client.SendAsync(RefreshRequest("not-a-real-token"));

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task An_expired_token_is_rejected()
    {
        var (client, refresh, accountId) = await SignInAsync();

        await using (var db = factory.CreateOwnerDbContext())
        {
            await db.Database.ExecuteSqlAsync(
                $"UPDATE customer.refresh_token SET expires_at = now() - interval '1 day' WHERE account_id = {accountId}");
        }

        (await client.SendAsync(RefreshRequest(refresh))).StatusCode
            .ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task A_request_with_no_cookie_is_rejected()
    {
        var (client, _, _) = await SignInAsync();

        var response = await client.PostAsync("/api/v1/auth/refresh", content: null);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~RefreshRotationTests"`
Expected: FAIL — every case returns `404 Not Found`; there is no `/api/v1/auth/refresh` yet

- [ ] **Step 3: Write the refresh handler**

Add to `MapAuthEndpoints` in `src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`:

```csharp
        group.MapPost("/refresh", async (
                HttpContext http,
                PeakPowerDbContext db,
                ITokenIssuer tokens,
                IMarketCalendar calendar,
                CancellationToken cancellationToken) =>
            {
                var presented = http.Request.Cookies[RefreshCookie.Name];
                if (string.IsNullOrWhiteSpace(presented))
                {
                    return RefreshRejected(http);
                }

                var now = calendar.UtcNow;
                var hash = OpaqueToken.HashOf(presented);

                var stored = await db.RefreshTokens
                    .SingleOrDefaultAsync(t => t.TokenHash == hash, cancellationToken);

                if (stored is null)
                {
                    return RefreshRejected(http);
                }

                if (stored.UsedAt is not null)
                {
                    // A spent token came back. Either the client kept a stale copy or somebody
                    // stole one, and there is no way to tell which — so assume theft and end
                    // every session this account has. The customer signs in again; an attacker
                    // gets nothing.
                    var chain = await db.RefreshTokens
                        .Where(t => t.AccountId == stored.AccountId)
                        .ToListAsync(cancellationToken);
                    foreach (var link in chain) link.Revoke(now);
                    await db.SaveChangesAsync(cancellationToken);

                    return RefreshRejected(http);
                }

                if (!stored.IsUsable(now))
                {
                    return RefreshRejected(http);
                }

                var account = await db.CustomerAccounts
                    .SingleOrDefaultAsync(a => a.Id == stored.AccountId, cancellationToken);

                if (account is null || account.Status != AccountStatus.Active)
                {
                    stored.Revoke(now);
                    await db.SaveChangesAsync(cancellationToken);
                    return RefreshRejected(http);
                }

                var refresh = tokens.IssueRefreshToken(account.Id, out var refreshExpiresAt);
                var replacement = RefreshToken.Issue(
                    account.Id, OpaqueToken.HashOf(refresh), now, refreshExpiresAt);
                db.RefreshTokens.Add(replacement);
                stored.MarkUsed(now, replacement.Id);

                var access = tokens.IssueAccessToken(account);
                await db.SaveChangesAsync(cancellationToken);

                RefreshCookie.Write(http.Response, refresh, refreshExpiresAt);

                return Results.Ok(new SignInResponse(
                    access.Jwt,
                    access.ExpiresAt,
                    new CurrentAccountResponse(
                        account.Id, account.CustomerId, account.FirstName,
                        account.LastName, account.Email, account.IsAdmin)));
            })
            .AllowAnonymous()
            .WithName("Refresh")
            .WithSummary("Rotate the refresh cookie for a new access token.");
```

and add the shared rejection helper beside `DummyHash`:

```csharp
    /// <summary>
    /// One answer for every refresh failure, and always clear the cookie — a client holding a
    /// token we will not honour should stop sending it.
    /// </summary>
    private static IResult RefreshRejected(HttpContext http)
    {
        RefreshCookie.Clear(http.Response);
        return Results.Problem(
            title: "Session expired",
            detail: "Sign in again.",
            statusCode: StatusCodes.Status401Unauthorized);
    }
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~RefreshRotationTests"`
Expected: PASS — 5 passed

- [ ] **Step 5: Commit**

```bash
git add src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs \
        tests/PeakPower.Integration.Tests/Auth/RefreshRotationTests.cs
git commit -m "feat(auth): rotate refresh tokens and treat a replay as theft"
```

---

### Task 12: `POST /auth/sign-out`

Sign-out is authenticated: the caller proves who they are with the access token, so the handler
needs no cookie. That matters because the refresh cookie is path-scoped to `/api/v1/auth/refresh`
and a browser will not send it to `/api/v1/auth/sign-out` — but a `Set-Cookie` *for* that path
can be issued from here, so the cookie still gets cleared.

Sign-out revokes **every** outstanding refresh token for the account, not only the one this
browser holds. That is the honest reading of "sign me out": a person who signs out on a shared
machine expects the session gone, and this request runs under the tenant policy, so it can only
ever reach that account's own rows. The access token itself is left alone — it expires within
fifteen minutes, and bumping the stamp here would sign the person out of their other devices
too, which is a different action with a different button.

**Files:**
- Modify: `src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`
- Test: `tests/PeakPower.Integration.Tests/Auth/SignOutTests.cs`

**Interfaces:**
- Consumes: `ICustomerContext.AccountId` (Task 6); `RefreshToken.Revoke(DateTimeOffset)`
  (Task 4); `RefreshCookie.Clear(HttpResponse)` (Task 10).
- Produces: `POST /api/v1/auth/sign-out`, authenticated, 204.

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Auth/SignOutTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Shouldly;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Auth;
using Xunit;

namespace PeakPower.Integration.Tests.Auth;

public sealed class SignOutTests(CustomerApiFactory factory) : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    [Fact]
    public async Task Signing_out_revokes_every_refresh_token_and_clears_the_cookie()
    {
        var email = $"{Guid.NewGuid():N}@vandersteen.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            "Vandersteen Koeling B.V.", "24398112", email, Password);

        var client = factory.CreateAnonymousClient();

        // Two sessions, as if from two browsers.
        var first = await client.PostAsJsonAsync("/api/v1/auth/sign-in", new SignInRequest(email, Password));
        await client.PostAsJsonAsync("/api/v1/auth/sign-in", new SignInRequest(email, Password));

        var access = (await first.Content.ReadFromJsonAsync<SignInResponse>())!.AccessToken;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", access);

        var response = await client.PostAsync("/api/v1/auth/sign-out", content: null);

        response.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        response.Headers.GetValues("Set-Cookie")
            .ShouldContain(c => c.StartsWith("pp_refresh=;")
                                || c.StartsWith("pp_refresh=") && c.Contains("expires=Thu, 01 Jan 1970"));

        await using var db = factory.CreateOwnerDbContext();
        var live = await db.RefreshTokens
            .Where(t => t.AccountId == account.Id && t.RevokedAt == null)
            .CountAsync();
        live.ShouldBe(0, "signing out ends every session, not only this browser's");
    }

    [Fact]
    public async Task Signing_out_without_a_token_is_rejected()
    {
        var response = await factory.CreateAnonymousClient()
            .PostAsync("/api/v1/auth/sign-out", content: null);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~SignOutTests"`
Expected: FAIL — the first case gets `404 Not Found` instead of `204 No Content`

- [ ] **Step 3: Write the sign-out handler**

Add to `MapAuthEndpoints` in `src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`:

```csharp
        group.MapPost("/sign-out", async (
                HttpContext http,
                ICustomerContext customer,
                PeakPowerDbContext db,
                IMarketCalendar calendar,
                CancellationToken cancellationToken) =>
            {
                var now = calendar.UtcNow;

                // Under app_customer_role with app.customer_id set, so the policy on
                // customer.refresh_token already limits this to the caller's own company.
                var tokens = await db.RefreshTokens
                    .Where(t => t.AccountId == customer.AccountId && t.RevokedAt == null)
                    .ToListAsync(cancellationToken);

                foreach (var token in tokens) token.Revoke(now);
                await db.SaveChangesAsync(cancellationToken);

                // A browser never sends this cookie here — it is scoped to the refresh path —
                // but Set-Cookie for that path works from anywhere, so this clears it.
                RefreshCookie.Clear(http.Response);

                return Results.NoContent();
            })
            .RequireAuthorization()
            .WithName("SignOut")
            .WithSummary("End every session for this account.");
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~SignOutTests"`
Expected: PASS — 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs \
        tests/PeakPower.Integration.Tests/Auth/SignOutTests.cs
git commit -m "feat(auth): sign out by revoking every refresh token for the account"
```

---

### Task 13: `POST /auth/password-reset/requests` — always 202

**Why "always".** If the endpoint answered 202 for a known address and 404 for an unknown one,
it would be a free membership oracle: anybody could feed it a list of email addresses and learn
exactly which companies are PeakPower customers. That is commercially sensitive on its own, and
it is the first step of a targeted phishing campaign. So the endpoint returns 202 whatever
happens, and the difference between the two cases is only whether an email is sent.

The delay curve from Task 9 applies here too, keyed the same way, because a reset endpoint that
answers instantly for everyone is still an unlimited email-sending machine pointed at one
address.

The console email sink lands here because this is the first thing that needs to send anything.

**Files:**
- Create: `src/Infrastructure/PeakPower.Infrastructure.Email/ConsoleEmailSender.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`
- Modify: `src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Program.cs`
- Test: `tests/PeakPower.Integration.Tests/Auth/PasswordResetTests.cs` (first two cases)

**Interfaces:**
- Consumes: `PeakPower.Application.Abstractions.IEmailSender` (shared contract §6, plan 1);
  `PasswordResetToken.Issue(...)` (Task 4); `OpaqueToken.Create()` / `HashOf(...)` (Task 3);
  `ISignInThrottle` (Task 9); `IMarketCalendar` (plan 1).
- Produces:
  - `PeakPower.Infrastructure.Email.ConsoleEmailSender(ILogger<ConsoleEmailSender>) : IEmailSender`
  - `PeakPower.Contracts.Customer.Auth.PasswordResetRequest(string Email)`
  - `POST /api/v1/auth/password-reset/requests`, anonymous, always 202 with an empty body

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Auth/PasswordResetTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Shouldly;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Auth;
using Xunit;

namespace PeakPower.Integration.Tests.Auth;

public sealed class PasswordResetTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    [Fact]
    public async Task A_request_for_a_real_address_is_accepted_and_stores_a_hashed_token()
    {
        var email = $"{Guid.NewGuid():N}@vandersteen.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            "Vandersteen Koeling B.V.", "24398112", email, Password);

        var response = await factory.CreateAnonymousClient().PostAsJsonAsync(
            "/api/v1/auth/password-reset/requests", new PasswordResetRequest(email));

        response.StatusCode.ShouldBe(HttpStatusCode.Accepted);

        await using var db = factory.CreateOwnerDbContext();
        var token = await db.PasswordResetTokens.SingleAsync(t => t.AccountId == account.Id);
        token.TokenHash.ShouldMatch("^[0-9A-F]{64}$", "the token is stored hashed");
        (token.ExpiresAt - token.IssuedAt).ShouldBe(TimeSpan.FromHours(1), TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task A_request_for_an_address_we_have_never_seen_looks_identical()
    {
        var known = $"{Guid.NewGuid():N}@vandersteen.nl";
        await factory.SeedCustomerWithAccountAsync(
            "Vandersteen Koeling B.V.", "24398112", known, Password);
        var client = factory.CreateAnonymousClient();

        var forKnown = await client.PostAsJsonAsync(
            "/api/v1/auth/password-reset/requests", new PasswordResetRequest(known));
        var forUnknown = await client.PostAsJsonAsync(
            "/api/v1/auth/password-reset/requests", new PasswordResetRequest("nobody@example.nl"));

        forUnknown.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        forUnknown.StatusCode.ShouldBe(forKnown.StatusCode);
        (await forUnknown.Content.ReadAsStringAsync())
            .ShouldBe(await forKnown.Content.ReadAsStringAsync(),
                "anything else is an account-enumeration oracle");

        await using var db = factory.CreateOwnerDbContext();
        (await db.PasswordResetTokens.CountAsync()).ShouldBeGreaterThan(0);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~PasswordResetTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'PasswordResetRequest' could not be found`

- [ ] **Step 3: Write the console email sink**

Create `src/Infrastructure/PeakPower.Infrastructure.Email/ConsoleEmailSender.cs`:

```csharp
using Microsoft.Extensions.Logging;
using PeakPower.Application.Abstractions;

namespace PeakPower.Infrastructure.Email;

/// <summary>
/// Slice 1's only mail transport: the message goes to the log. The wizard's signing code and
/// the reset link need a channel, not a vendor — swapping in a real provider later is a DI
/// registration and nothing else.
/// </summary>
public sealed class ConsoleEmailSender(ILogger<ConsoleEmailSender> logger) : IEmailSender
{
    public Task SendAsync(string to, string subject, string body, CancellationToken ct)
    {
        logger.LogInformation(
            "Email to {Recipient}\n  Subject: {Subject}\n{Body}", to, subject, body);
        return Task.CompletedTask;
    }
}
```

Register it in `src/Hosts/PeakPower.Api.Customer/Program.cs`:

```csharp
builder.Services.AddSingleton<IEmailSender, PeakPower.Infrastructure.Email.ConsoleEmailSender>();
```

- [ ] **Step 4: Write the request endpoint**

Add to `src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs`:

```csharp
/// <summary>Ask for a reset link. The answer is 202 whether or not the address exists.</summary>
public sealed record PasswordResetRequest(string Email);
```

Add to `MapAuthEndpoints` in `src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`:

```csharp
        group.MapPost("/password-reset/requests", async (
                PasswordResetRequest request,
                HttpContext http,
                PeakPowerDbContext db,
                IEmailSender email,
                ISignInThrottle throttle,
                IMarketCalendar calendar,
                CancellationToken cancellationToken) =>
            {
                var address = (request.Email ?? string.Empty).Trim();
                var source = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";

                var delay = throttle.DelayFor(address, source);
                if (delay > TimeSpan.Zero) await Task.Delay(delay, cancellationToken);
                throttle.RecordFailure(address, source);   // every request counts, none is "success"

                var account = await db.CustomerAccounts
                    .SingleOrDefaultAsync(
                        a => a.Email == address && a.Status == AccountStatus.Active,
                        cancellationToken);

                if (account is not null)
                {
                    var now = calendar.UtcNow;
                    var token = OpaqueToken.Create();

                    db.PasswordResetTokens.Add(PasswordResetToken.Issue(
                        account.Id, OpaqueToken.HashOf(token), now, now.Add(ResetTokenLifetime)));
                    await db.SaveChangesAsync(cancellationToken);

                    await email.SendAsync(
                        account.Email,
                        "Reset your PeakPower password",
                        $"""
                         Hello {account.FirstName},

                         Use this code to choose a new password. It works once and expires in one hour.

                         {token}

                         If you did not ask for this, nothing has changed and you can ignore this message.
                         """,
                        cancellationToken);
                }

                // 202 either way. Answering 404 for an unknown address would tell anyone with a
                // list of email addresses exactly which companies are PeakPower customers.
                return Results.Accepted();
            })
            .AllowAnonymous()
            .WithName("RequestPasswordReset")
            .WithSummary("Send a password-reset code, if the address belongs to an active account.");
```

and add the lifetime constant beside `DummyHash`:

```csharp
    /// <summary>One hour — the narrowed [OQ-98]. The mechanism is settled; the number is policy.</summary>
    private static readonly TimeSpan ResetTokenLifetime = TimeSpan.FromHours(1);
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~PasswordResetTests"`
Expected: PASS — 2 passed

- [ ] **Step 6: Commit**

```bash
git add src/Infrastructure/PeakPower.Infrastructure.Email/ConsoleEmailSender.cs \
        src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs \
        src/Hosts/PeakPower.Api.Customer/Program.cs \
        src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs \
        tests/PeakPower.Integration.Tests/Auth/PasswordResetTests.cs
git commit -m "feat(auth): accept password-reset requests without leaking who has an account"
```

---

### Task 14: `POST /auth/password-reset/completions` — and the stamp bump that kills every token

Completion is where the revocation mechanism from Task 7 earns its keep a second time. Setting
a new password calls `CustomerAccount.SetPassword`, which bumps the security stamp — so every
access token outstanding for that account fails its next call, and every refresh token is
revoked in the same transaction. Somebody who reset their password because they believed it was
stolen is actually protected, immediately, rather than fifteen minutes later.

**Files:**
- Modify: `src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`
- Modify: `src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs`
- Test: `tests/PeakPower.Integration.Tests/Auth/PasswordResetTests.cs` (four more cases)

**Interfaces:**
- Consumes: `IPasswordHasher.Hash(string)` (Task 1);
  `CustomerAccount.SetPassword(string)` (shared contract §5.1, plan 1);
  `PasswordResetToken.IsUsable/MarkUsed` (Task 4);
  `RefreshToken.Revoke(DateTimeOffset)` (Task 4).
- Produces:
  - `PeakPower.Contracts.Customer.Auth.PasswordResetCompletion(string Token, string NewPassword)`
  - `POST /api/v1/auth/password-reset/completions`, anonymous, 204 on success,
    400 problem+json on a bad or spent token, 422 problem+json on a short password
  - `PeakPower.Contracts.Customer.Auth.PasswordPolicy.MinimumLength = 12`

- [ ] **Step 1: Write the failing test**

Add to `tests/PeakPower.Integration.Tests/Auth/PasswordResetTests.cs`:

```csharp
    /// <summary>Requests a reset and digs the raw token out of the log-only email.</summary>
    private async Task<(Guid AccountId, string Token, string Email)> RequestResetAsync()
    {
        var email = $"{Guid.NewGuid():N}@vandersteen.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            "Vandersteen Koeling B.V.", "24398112", email, Password);

        // The console sink cannot be read back, so the test mints its own token by the same
        // route the endpoint uses, and stores it exactly as the endpoint would.
        var raw = PeakPower.Infrastructure.Identity.OpaqueToken.Create();
        await using (var db = factory.CreateOwnerDbContext())
        {
            var now = DateTimeOffset.UtcNow;
            db.PasswordResetTokens.Add(PeakPower.Domain.Customers.PasswordResetToken.Issue(
                account.Id,
                PeakPower.Infrastructure.Identity.OpaqueToken.HashOf(raw),
                now,
                now.AddHours(1)));
            await db.SaveChangesAsync();
        }

        return (account.Id, raw, email);
    }

    [Fact]
    public async Task Completing_a_reset_sets_the_new_password_and_bumps_the_stamp()
    {
        var (accountId, token, email) = await RequestResetAsync();

        Guid stampBefore;
        await using (var db = factory.CreateOwnerDbContext())
        {
            stampBefore = (await db.CustomerAccounts.SingleAsync(a => a.Id == accountId)).SecurityStamp;
        }

        var response = await factory.CreateAnonymousClient().PostAsJsonAsync(
            "/api/v1/auth/password-reset/completions",
            new PasswordResetCompletion(token, "a-brand-new-passphrase"));

        response.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        await using var after = factory.CreateOwnerDbContext();
        var account = await after.CustomerAccounts.SingleAsync(a => a.Id == accountId);
        account.SecurityStamp.ShouldNotBe(stampBefore,
            "every outstanding token for this account must die");

        var signIn = await factory.CreateAnonymousClient().PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, "a-brand-new-passphrase"));
        signIn.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Completing_a_reset_revokes_every_outstanding_refresh_token()
    {
        var (accountId, token, email) = await RequestResetAsync();
        await factory.CreateAnonymousClient().PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password));

        await factory.CreateAnonymousClient().PostAsJsonAsync(
            "/api/v1/auth/password-reset/completions",
            new PasswordResetCompletion(token, "a-brand-new-passphrase"));

        await using var db = factory.CreateOwnerDbContext();
        var live = await db.RefreshTokens
            .Where(t => t.AccountId == accountId && t.RevokedAt == null)
            .CountAsync();
        live.ShouldBe(0);
    }

    [Fact]
    public async Task A_reset_token_works_exactly_once()
    {
        var (_, token, _) = await RequestResetAsync();
        var client = factory.CreateAnonymousClient();

        var first = await client.PostAsJsonAsync(
            "/api/v1/auth/password-reset/completions",
            new PasswordResetCompletion(token, "a-brand-new-passphrase"));
        var second = await client.PostAsJsonAsync(
            "/api/v1/auth/password-reset/completions",
            new PasswordResetCompletion(token, "another-brand-new-one"));

        first.StatusCode.ShouldBe(HttpStatusCode.NoContent);
        second.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task A_password_shorter_than_twelve_characters_is_refused()
    {
        var (_, token, _) = await RequestResetAsync();

        var response = await factory.CreateAnonymousClient().PostAsJsonAsync(
            "/api/v1/auth/password-reset/completions",
            new PasswordResetCompletion(token, "short"));

        response.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
    }
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~PasswordResetTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'PasswordResetCompletion' could not be found`

- [ ] **Step 3: Write the completion endpoint**

Add to `src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs`:

```csharp
/// <summary>Redeem a reset code and choose a new password.</summary>
public sealed record PasswordResetCompletion(string Token, string NewPassword);

/// <summary>
/// The wizard's twelve-character minimum, in one place so the reset path and the onboarding
/// path cannot drift apart. Composition rules beyond length are the narrowed [OQ-98].
/// </summary>
public static class PasswordPolicy
{
    public const int MinimumLength = 12;

    public static bool IsAcceptable(string? password) =>
        password is not null && password.Length >= MinimumLength;
}
```

Add to `MapAuthEndpoints` in `src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`:

```csharp
        group.MapPost("/password-reset/completions", async (
                PasswordResetCompletion request,
                PeakPowerDbContext db,
                IPasswordHasher hasher,
                IMarketCalendar calendar,
                CancellationToken cancellationToken) =>
            {
                if (!PasswordPolicy.IsAcceptable(request.NewPassword))
                {
                    return Results.Problem(
                        title: "Password too short",
                        detail: $"Choose a password of at least {PasswordPolicy.MinimumLength} characters.",
                        statusCode: StatusCodes.Status422UnprocessableEntity);
                }

                var now = calendar.UtcNow;
                var hash = OpaqueToken.HashOf(request.Token ?? string.Empty);

                var resetToken = await db.PasswordResetTokens
                    .SingleOrDefaultAsync(t => t.TokenHash == hash, cancellationToken);

                if (resetToken is null || !resetToken.IsUsable(now))
                {
                    return Results.Problem(
                        title: "That reset code cannot be used",
                        detail: "It has already been used or it has expired. Ask for a new one.",
                        statusCode: StatusCodes.Status400BadRequest);
                }

                var account = await db.CustomerAccounts
                    .SingleOrDefaultAsync(a => a.Id == resetToken.AccountId, cancellationToken);

                if (account is null)
                {
                    return Results.Problem(
                        title: "That reset code cannot be used",
                        detail: "It has already been used or it has expired. Ask for a new one.",
                        statusCode: StatusCodes.Status400BadRequest);
                }

                // SetPassword bumps the security stamp, which is what makes every access token
                // for this account fail its next call — see CustomerSessionMiddleware.
                account.SetPassword(hasher.Hash(request.NewPassword));
                resetToken.MarkUsed(now);

                var refreshTokens = await db.RefreshTokens
                    .Where(t => t.AccountId == account.Id && t.RevokedAt == null)
                    .ToListAsync(cancellationToken);
                foreach (var token in refreshTokens) token.Revoke(now);

                await db.SaveChangesAsync(cancellationToken);

                return Results.NoContent();
            })
            .AllowAnonymous()
            .WithName("CompletePasswordReset")
            .WithSummary("Redeem a reset code and set a new password.");
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~PasswordResetTests"`
Expected: PASS — 6 passed

- [ ] **Step 5: Run the whole auth suite**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~PeakPower.Integration.Tests.Auth"`
Expected: PASS — all auth integration tests green

- [ ] **Step 6: Commit**

```bash
git add src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs \
        src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs \
        tests/PeakPower.Integration.Tests/Auth/PasswordResetTests.cs
git commit -m "feat(auth): complete a password reset and kill every outstanding token"
```

---

### Task 15: `OnboardingApplication` — the aggregate and steps one to seven

The wizard has ten steps (`trading-poc/onboarding-flow.js`, `STEPS`). Step 10 is a welcome
screen with no answers, so nine steps carry data and this task covers steps one to seven.
Steps eight and nine are Task 16; signing and materialisation are Task 17.

| Step | Group | Collects | Gate |
| --- | --- | --- | --- |
| 1 | Account | first name, last name, email, password, terms accepted | all five |
| 2 | Company | organization name, legal entity type, KvK number | name present, KvK exactly 8 digits |
| 3 | Company | registered address | none — may be left blank |
| 4 | Company | industry | none — optional |
| 5 | Profile | flow direction, annual volume band | a band must be chosen |
| 6 | Verification | IBAN, account holder | IBAN must pass mod-97 if given |
| 7 | Agreement | signing authority | one option must be chosen |

**Two deliberate departures from the demo, both worth the reviewer's attention.**

*The address is six fields, not one.* The demo has a single "Street and number" input. The
shared contract's `Address` is a value object with six components, and splitting `Havenweg 22`
in the server is a localisation trap — Dutch house numbers carry letter suffixes, and other
countries put the number first. So the API takes the six components and the wizard UI (plan 6)
presents whatever it likes on top of them.

*A blank address is allowed at step 3 but not at signing.* The demo says blank is acceptable
because "the desk resolves the address during review". But `Customer.BillingAddress` is
non-nullable, and design §8.5 forbids fabricating data to look plausible — so a blank address
cannot be carried into a materialised company. The compromise: step 3 saves blank happily, and
`POST /sign` (Task 17) refuses with a problem document naming step 3 if the address is still
missing. The person is never blocked mid-wizard, and no company is ever created with an invented
address.

**Files:**
- Create: `src/Core/PeakPower.Domain/Onboarding/OnboardingEnums.cs`
- Create: `src/Core/PeakPower.Domain/Onboarding/OnboardingReferenceData.cs`
- Create: `src/Core/PeakPower.Domain/Onboarding/OnboardingSignatory.cs`
- Create: `src/Core/PeakPower.Domain/Onboarding/OnboardingApplication.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/Configurations/OnboardingApplicationConfiguration.cs`
- Modify: `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs`
- Test: `tests/PeakPower.Domain.Tests/Onboarding/OnboardingApplicationTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Domain.Common.Result<T>` with `IsSuccess`, `Value`, `Error`,
  `Success(T)`, `Failure(string)`; `KvkNumber.Create(string)`; `Iban.Create(string)`;
  `PeakPower.Domain.Customers.Address(string Street, string HouseNumber, string? HouseNumberSuffix, string PostalCode, string City, string Country)`
  — all shared contract §5, plan 1.
- Produces:
  - Enums `OnboardingStatus { Draft, AwaitingSignature, Signed }`,
    `LegalEntityType { BV, NV, Eenmanszaak, VOF, Maatschap, CV, Stichting, Vereniging, Cooperatie }`,
    `FlowDirection { Consumption, Production, Both }`,
    `VolumeBand { UpTo250Mwh, From250To500Mwh, From500To1000Mwh, From1000To2500Mwh, Above2500Mwh }`,
    `SigningAuthority { Alone, Jointly, SomeoneElse }`
  - `OnboardingReferenceData` — `static IReadOnlyList<string> Industries`,
    `static string DisplayName(LegalEntityType)`, `static string DisplayName(VolumeBand)`,
    `static string DisplayName(SigningAuthority)`, `static string Note(SigningAuthority)`,
    `static int MinimumSignatories(SigningAuthority)`
  - `OnboardingSignatory(string FirstName, string LastName, string Email, bool IsApplicant)`
  - `OnboardingApplication` with
    `static Result<OnboardingApplication> Start(string firstName, string lastName, string email, string passwordHash, bool termsAccepted, DateTimeOffset now)`,
    `Result<OnboardingApplication> ApplyCompany(string? organizationName, LegalEntityType entityType, string? kvkNumber)`,
    `Result<OnboardingApplication> ApplyRegisteredAddress(Address? address)`,
    `Result<OnboardingApplication> ApplyIndustry(string? industry)`,
    `Result<OnboardingApplication> ApplyVolume(FlowDirection flow, VolumeBand band)`,
    `Result<OnboardingApplication> ApplyBankAccount(string? iban, string? accountHolder)`,
    `Result<OnboardingApplication> ApplySigningAuthority(SigningAuthority authority)`,
    `void MarkBankVerified(DateTimeOffset at)`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Domain.Tests/Onboarding/OnboardingApplicationTests.cs`:

```csharp
using Shouldly;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Onboarding;
using Xunit;

namespace PeakPower.Domain.Tests.Onboarding;

public sealed class OnboardingApplicationTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 26, 9, 0, 0, TimeSpan.Zero);
    private const string Hash = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==";

    private static OnboardingApplication Started() =>
        OnboardingApplication.Start(
            "Peter", "de Vries", "p.devries@vandersteen.nl", Hash, termsAccepted: true, Now).Value;

    [Fact]
    public void Start_records_the_applicant_and_a_quotable_reference()
    {
        var application = Started();

        application.Status.ShouldBe(OnboardingStatus.Draft);
        application.FirstName.ShouldBe("Peter");
        application.Email.ShouldBe("p.devries@vandersteen.nl");
        application.PasswordHash.ShouldBe(Hash);
        application.TermsAcceptedAt.ShouldBe(Now);
        application.Reference.ShouldMatch("^PP-ONB-[0-9A-HJ-NP-TV-Z]{4}$");
    }

    [Fact]
    public void Start_refuses_without_the_terms()
    {
        var result = OnboardingApplication.Start(
            "Peter", "de Vries", "p.devries@vandersteen.nl", Hash, termsAccepted: false, Now);

        result.IsSuccess.ShouldBeFalse();
        result.Error.ShouldBe("Accept the Terms of Use to create the account.");
    }

    [Theory]
    [InlineData("", "de Vries", "p@vandersteen.nl", "Enter your first and last name to continue.")]
    [InlineData("Peter", "  ", "p@vandersteen.nl", "Enter your first and last name to continue.")]
    [InlineData("Peter", "de Vries", "@vandersteen.nl", "Enter the email address you will sign in with.")]
    [InlineData("Peter", "de Vries", "nope", "Enter the email address you will sign in with.")]
    public void Start_names_what_is_missing(string first, string last, string email, string expected)
    {
        var result = OnboardingApplication.Start(first, last, email, Hash, true, Now);

        result.IsSuccess.ShouldBeFalse();
        result.Error.ShouldBe(expected);
    }

    [Fact]
    public void Step_two_accepts_a_kvk_number_pasted_with_spaces()
    {
        var result = Started().ApplyCompany("Vandersteen Koeling B.V.", LegalEntityType.BV, "2439 8112");

        result.IsSuccess.ShouldBeTrue();
        result.Value.OrganizationName.ShouldBe("Vandersteen Koeling B.V.");
        result.Value.KvkNumber.ShouldBe("24398112");
        result.Value.LegalEntityType.ShouldBe(LegalEntityType.BV);
    }

    [Theory]
    [InlineData("", "24398112", "Enter the organization name as registered.")]
    [InlineData("Vandersteen Koeling B.V.", "2439811", "The KvK number is eight digits.")]
    [InlineData("Vandersteen Koeling B.V.", "243981123", "The KvK number is eight digits.")]
    public void Step_two_names_what_is_wrong(string name, string kvk, string expected)
    {
        var result = Started().ApplyCompany(name, LegalEntityType.BV, kvk);

        result.IsSuccess.ShouldBeFalse();
        result.Error.ShouldBe(expected);
    }

    [Fact]
    public void Step_three_accepts_a_blank_address_because_the_desk_resolves_it_later()
    {
        var result = Started().ApplyRegisteredAddress(null);

        result.IsSuccess.ShouldBeTrue();
        result.Value.RegisteredAddress.ShouldBeNull();
    }

    [Fact]
    public void Step_three_keeps_the_six_address_components()
    {
        var address = new Address("Havenweg", "22", "A", "3089 JJ", "Rotterdam", "NL");

        var result = Started().ApplyRegisteredAddress(address);

        result.Value.RegisteredAddress.ShouldBe(address);
    }

    [Fact]
    public void Step_four_is_optional_and_null_means_not_specified()
    {
        Started().ApplyIndustry(null).Value.Industry.ShouldBeNull();
        Started().ApplyIndustry("Not specified").Value.Industry.ShouldBeNull();
        Started().ApplyIndustry("Agriculture & Food Processing").Value.Industry
            .ShouldBe("Agriculture & Food Processing");
    }

    [Fact]
    public void Step_four_refuses_an_industry_that_is_not_on_the_list()
    {
        var result = Started().ApplyIndustry("Interstellar Freight");

        result.IsSuccess.ShouldBeFalse();
        result.Error.ShouldBe("Choose an industry from the list, or leave it unspecified.");
    }

    [Fact]
    public void The_industry_list_is_the_demos_twenty_four_plus_the_unspecified_lead()
    {
        OnboardingReferenceData.Industries.Count().ShouldBe(24);
        OnboardingReferenceData.Industries.ShouldContain("Cryptocurrency");
        OnboardingReferenceData.Industries.ShouldContain("Transportation");
        OnboardingReferenceData.Industries.ShouldNotContain("Not specified");
    }

    [Fact]
    public void Step_five_records_the_direction_and_the_band()
    {
        var result = Started().ApplyVolume(FlowDirection.Both, VolumeBand.From1000To2500Mwh);

        result.Value.FlowDirection.ShouldBe(FlowDirection.Both);
        result.Value.VolumeBand.ShouldBe(VolumeBand.From1000To2500Mwh);
    }

    [Fact]
    public void The_volume_bands_read_in_dutch_number_format()
    {
        OnboardingReferenceData.DisplayName(VolumeBand.UpTo250Mwh).ShouldBe("Less than 250 MWh");
        OnboardingReferenceData.DisplayName(VolumeBand.From500To1000Mwh).ShouldBe("500 – 1.000 MWh");
        OnboardingReferenceData.DisplayName(VolumeBand.Above2500Mwh).ShouldBe("More than 2.500 MWh");
    }

    [Fact]
    public void Step_six_validates_the_iban_with_mod_97()
    {
        var good = Started().ApplyBankAccount("NL18 INGB 0002 4455 66", "Vandersteen Koeling B.V.");
        good.IsSuccess.ShouldBeTrue();
        good.Value.Iban.ShouldBe("NL18INGB0002445566");
        good.Value.BankVerifiedAt.ShouldBeNull("no payment rail exists in slice 1");

        var bad = Started().ApplyBankAccount("NL19 INGB 0002 4455 66", "Vandersteen Koeling B.V.");
        bad.IsSuccess.ShouldBeFalse();
    }

    [Fact]
    public void Step_seven_requires_one_of_the_three_authority_answers()
    {
        var result = Started().ApplySigningAuthority(SigningAuthority.Jointly);

        result.Value.SigningAuthority.ShouldBe(SigningAuthority.Jointly);
        OnboardingReferenceData.MinimumSignatories(SigningAuthority.Alone).ShouldBe(1);
        OnboardingReferenceData.MinimumSignatories(SigningAuthority.Jointly).ShouldBe(2);
        OnboardingReferenceData.MinimumSignatories(SigningAuthority.SomeoneElse).ShouldBe(1);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Domain.Tests --filter "FullyQualifiedName~OnboardingApplicationTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'OnboardingApplication' could not be found`

- [ ] **Step 3: Write the enums and the reference data**

Create `src/Core/PeakPower.Domain/Onboarding/OnboardingEnums.cs`:

```csharp
namespace PeakPower.Domain.Onboarding;

/// <summary>Draft while the wizard is being filled in; AwaitingSignature once the signing code
/// has gone out; Signed once the company exists.</summary>
public enum OnboardingStatus { Draft, AwaitingSignature, Signed }

/// <summary>
/// Dutch legal forms, from the demo's ENTITY_TYPES. Cooperatie is spelled without the diaeresis
/// as an identifier; OnboardingReferenceData.DisplayName restores the "Coöperatie" the customer
/// sees.
/// </summary>
public enum LegalEntityType
{ BV, NV, Eenmanszaak, VOF, Maatschap, CV, Stichting, Vereniging, Cooperatie }

/// <summary>Which way the meter runs. "Both" is common — a site with solar still draws.</summary>
public enum FlowDirection { Consumption, Production, Both }

/// <summary>Net yearly volume across all connections, as a band. Exact metering follows later.</summary>
public enum VolumeBand
{ UpTo250Mwh, From250To500Mwh, From500To1000Mwh, From1000To2500Mwh, Above2500Mwh }

/// <summary>Who may bind the company, which decides where the agreement goes next.</summary>
public enum SigningAuthority { Alone, Jointly, SomeoneElse }
```

Create `src/Core/PeakPower.Domain/Onboarding/OnboardingReferenceData.cs`:

```csharp
namespace PeakPower.Domain.Onboarding;

/// <summary>
/// The lists the wizard shows, in one place so the API, the portal and the tests cannot drift.
/// Ported from trading-poc/onboarding-flow.js.
/// </summary>
public static class OnboardingReferenceData
{
    /// <summary>
    /// The demo's INDUSTRIES minus its leading "Not specified" sentinel — here, not answering is
    /// a null column rather than a magic list entry.
    /// </summary>
    public static IReadOnlyList<string> Industries { get; } =
    [
        "Agriculture & Food Processing",
        "Arts, Medias & Entertainment",
        "Casinos & Gambling",
        "Construction",
        "Cryptocurrency",
        "Defense & Military Industry",
        "Education",
        "Energy & Utilities",
        "Financial Services",
        "Food & Lodging",
        "Government",
        "Health Professions",
        "Holding Company",
        "Industry & Manufacturing",
        "Mining",
        "Non-Profit",
        "Professional Services",
        "Real Estate",
        "Retail Trade, Automotive",
        "Retail Trade, Jewelry & Antiques",
        "Retail Trade, Others",
        "Sport & Tourism",
        "Technology & Computing",
        "Transportation",
    ];

    public const string NotSpecified = "Not specified";

    public static string DisplayName(LegalEntityType type) => type switch
    {
        LegalEntityType.BV => "BV",
        LegalEntityType.NV => "NV",
        LegalEntityType.Eenmanszaak => "Eenmanszaak",
        LegalEntityType.VOF => "VOF",
        LegalEntityType.Maatschap => "Maatschap",
        LegalEntityType.CV => "CV",
        LegalEntityType.Stichting => "Stichting",
        LegalEntityType.Vereniging => "Vereniging",
        LegalEntityType.Cooperatie => "Coöperatie",
        _ => throw new ArgumentOutOfRangeException(nameof(type)),
    };

    /// <summary>nl-NL number format: period for thousands, en dash for the range  [AS-19].</summary>
    public static string DisplayName(VolumeBand band) => band switch
    {
        VolumeBand.UpTo250Mwh => "Less than 250 MWh",
        VolumeBand.From250To500Mwh => "250 – 500 MWh",
        VolumeBand.From500To1000Mwh => "500 – 1.000 MWh",
        VolumeBand.From1000To2500Mwh => "1.000 – 2.500 MWh",
        VolumeBand.Above2500Mwh => "More than 2.500 MWh",
        _ => throw new ArgumentOutOfRangeException(nameof(band)),
    };

    public static string DisplayName(SigningAuthority authority) => authority switch
    {
        SigningAuthority.Alone => "Yes, I am authorised to sign",
        SigningAuthority.Jointly => "Yes, together with another authorised person",
        SigningAuthority.SomeoneElse => "No, someone else needs to sign",
        _ => throw new ArgumentOutOfRangeException(nameof(authority)),
    };

    public static string Note(SigningAuthority authority) => authority switch
    {
        SigningAuthority.Alone => "You sign alone; the agreement is issued to you.",
        SigningAuthority.Jointly => "You and at least one colleague both sign.",
        SigningAuthority.SomeoneElse =>
            "We email the people you name; you keep managing the account.",
        _ => throw new ArgumentOutOfRangeException(nameof(authority)),
    };

    /// <summary>"Together with another authorised person" means two.</summary>
    public static int MinimumSignatories(SigningAuthority authority) =>
        authority == SigningAuthority.Jointly ? 2 : 1;
}
```

Create `src/Core/PeakPower.Domain/Onboarding/OnboardingSignatory.cs`:

```csharp
namespace PeakPower.Domain.Onboarding;

/// <summary>
/// One person who must sign on behalf of the company. Stored inside the application's
/// signatories jsonb column rather than as its own table — the shared contract fixes the table
/// list, and a signatory has no life outside the application it belongs to.
/// </summary>
/// <param name="IsApplicant">
/// True for the person filling in the wizard. "Someone else signs" drops them: they manage the
/// account, they do not sign it.
/// </param>
public sealed record OnboardingSignatory(
    string FirstName,
    string LastName,
    string Email,
    bool IsApplicant);
```

- [ ] **Step 4: Write the aggregate**

Create `src/Core/PeakPower.Domain/Onboarding/OnboardingApplication.cs`:

```csharp
using System.Security.Cryptography;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;

namespace PeakPower.Domain.Onboarding;

/// <summary>
/// The self-service wizard's accumulating answers  [DEC-113]. Anonymous: there is no customer
/// yet, and the application's own id is the capability that lets a browser come back to it.
///
/// Every step returns Result&lt;OnboardingApplication&gt; carrying <c>this</c>, so a caller can
/// chain and an invalid answer never throws — validation failures are values, per the shared
/// contract's Result type.
/// </summary>
public sealed class OnboardingApplication
{
    private OnboardingApplication() { }   // EF

    private readonly List<OnboardingSignatory> _signatories = [];

    public Guid Id { get; private set; }

    /// <summary>"PP-ONB-7F3K" — one per application, quoted on the bank transfer.</summary>
    public string Reference { get; private set; } = string.Empty;

    public OnboardingStatus Status { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }

    // Step 1 — personal information
    public string FirstName { get; private set; } = string.Empty;
    public string LastName { get; private set; } = string.Empty;
    public string Email { get; private set; } = string.Empty;
    public string PasswordHash { get; private set; } = string.Empty;
    public DateTimeOffset TermsAcceptedAt { get; private set; }

    // Step 2 — company
    public string? OrganizationName { get; private set; }
    public LegalEntityType? LegalEntityType { get; private set; }
    public string? KvkNumber { get; private set; }

    // Step 3 — registered address
    public Address? RegisteredAddress { get; private set; }

    // Step 4 — industry (null means the customer left it unspecified)
    public string? Industry { get; private set; }

    // Step 5 — electricity volume
    public FlowDirection? FlowDirection { get; private set; }
    public VolumeBand? VolumeBand { get; private set; }

    // Step 6 — bank verification
    public string? Iban { get; private set; }
    public string? BankAccountHolder { get; private set; }
    public DateTimeOffset? BankVerifiedAt { get; private set; }

    // Step 7 — signing authority
    public SigningAuthority? SigningAuthority { get; private set; }

    // Step 8 — authorised signatories
    public IReadOnlyList<OnboardingSignatory> Signatories => _signatories;

    // Step 9 — signing
    public string? SignCodeHash { get; private set; }
    public DateTimeOffset? SignCodeExpiresAt { get; private set; }
    public int SignCodeAttempts { get; private set; }
    public DateTimeOffset? SignedAt { get; private set; }

    // Outcome
    public Guid? CustomerId { get; private set; }
    public Guid? AccountId { get; private set; }

    public static Result<OnboardingApplication> Start(
        string firstName,
        string lastName,
        string email,
        string passwordHash,
        bool termsAccepted,
        DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(firstName) || string.IsNullOrWhiteSpace(lastName))
        {
            return Result<OnboardingApplication>.Failure(
                "Enter your first and last name to continue.");
        }

        if (!LooksLikeEmail(email))
        {
            return Result<OnboardingApplication>.Failure(
                "Enter the email address you will sign in with.");
        }

        if (string.IsNullOrWhiteSpace(passwordHash))
        {
            return Result<OnboardingApplication>.Failure("The password was not set.");
        }

        if (!termsAccepted)
        {
            return Result<OnboardingApplication>.Failure(
                "Accept the Terms of Use to create the account.");
        }

        return Result<OnboardingApplication>.Success(new OnboardingApplication
        {
            Id = Guid.NewGuid(),
            Reference = NextReference(),
            Status = OnboardingStatus.Draft,
            CreatedAt = now,
            FirstName = firstName.Trim(),
            LastName = lastName.Trim(),
            Email = email.Trim(),
            PasswordHash = passwordHash,
            TermsAcceptedAt = now,
        });
    }

    public Result<OnboardingApplication> ApplyCompany(
        string? organizationName, LegalEntityType entityType, string? kvkNumber)
    {
        if (Status != OnboardingStatus.Draft) return NotDraft();

        if (string.IsNullOrWhiteSpace(organizationName))
        {
            return Result<OnboardingApplication>.Failure(
                "Enter the organization name as registered.");
        }

        // Digits only — a KvK number pasted with spaces or dots is still eight digits.
        var digits = new string((kvkNumber ?? string.Empty).Where(char.IsAsciiDigit).ToArray());
        var kvk = KvkNumber.Create(digits);
        if (!kvk.IsSuccess)
        {
            return Result<OnboardingApplication>.Failure("The KvK number is eight digits.");
        }

        OrganizationName = organizationName.Trim();
        LegalEntityType = entityType;
        KvkNumber = kvk.Value.Value;
        return Ok();
    }

    /// <summary>
    /// Blank is acceptable here — the demo's step 3 says the desk resolves the address during
    /// review. Signing is where a complete address becomes mandatory, because
    /// Customer.BillingAddress is not nullable and inventing one is forbidden.
    /// </summary>
    public Result<OnboardingApplication> ApplyRegisteredAddress(Address? address)
    {
        if (Status != OnboardingStatus.Draft) return NotDraft();
        RegisteredAddress = address;
        return Ok();
    }

    public Result<OnboardingApplication> ApplyIndustry(string? industry)
    {
        if (Status != OnboardingStatus.Draft) return NotDraft();

        var trimmed = industry?.Trim();
        if (string.IsNullOrEmpty(trimmed)
            || string.Equals(trimmed, OnboardingReferenceData.NotSpecified, StringComparison.Ordinal))
        {
            Industry = null;
            return Ok();
        }

        if (!OnboardingReferenceData.Industries.Contains(trimmed, StringComparer.Ordinal))
        {
            return Result<OnboardingApplication>.Failure(
                "Choose an industry from the list, or leave it unspecified.");
        }

        Industry = trimmed;
        return Ok();
    }

    public Result<OnboardingApplication> ApplyVolume(FlowDirection flow, VolumeBand band)
    {
        if (Status != OnboardingStatus.Draft) return NotDraft();
        FlowDirection = flow;
        VolumeBand = band;
        return Ok();
    }

    public Result<OnboardingApplication> ApplyBankAccount(string? iban, string? accountHolder)
    {
        if (Status != OnboardingStatus.Draft) return NotDraft();

        if (string.IsNullOrWhiteSpace(iban))
        {
            Iban = null;
            BankAccountHolder = null;
            return Ok();
        }

        // Fully qualified on purpose: the property below is also called Iban, and an
        // unqualified `Iban.Create` binds to the property and does not compile. The same
        // shadowing applies to LegalEntityType and SigningAuthority, whose properties share a
        // name with their enum — qualify those too wherever the enum is meant.
        var parsed = PeakPower.Domain.Common.Iban.Create(iban);
        if (!parsed.IsSuccess)
        {
            return Result<OnboardingApplication>.Failure(parsed.Error);
        }

        Iban = parsed.Value.Value;
        BankAccountHolder = string.IsNullOrWhiteSpace(accountHolder) ? null : accountHolder.Trim();
        return Ok();
    }

    public Result<OnboardingApplication> ApplySigningAuthority(SigningAuthority authority)
    {
        if (Status != OnboardingStatus.Draft) return NotDraft();
        SigningAuthority = authority;
        return Ok();
    }

    /// <summary>
    /// Slice 1 has no payment rail, so nothing sets this on its own. The development-only
    /// simulator endpoint calls it, standing in for the demo's "Mark € 0,01 as received".
    /// </summary>
    public void MarkBankVerified(DateTimeOffset at) => BankVerifiedAt ??= at;

    private Result<OnboardingApplication> Ok() => Result<OnboardingApplication>.Success(this);

    private static Result<OnboardingApplication> NotDraft() =>
        Result<OnboardingApplication>.Failure(
            "This application has already been submitted and can no longer be changed.");

    /// <summary>Index &gt; 0, not &gt;= 0: "@company.nl" has no local part.</summary>
    private static bool LooksLikeEmail(string? value) =>
        value is not null && value.IndexOf('@') > 0 && value.IndexOf('@') < value.Length - 1;

    /// <summary>
    /// Crockford base32 without I, L, O and U, so a reference read aloud over the phone cannot
    /// be confused with a digit.
    /// </summary>
    private const string ReferenceAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    private static string NextReference()
    {
        Span<char> suffix = stackalloc char[4];
        for (var i = 0; i < suffix.Length; i++)
        {
            suffix[i] = ReferenceAlphabet[RandomNumberGenerator.GetInt32(ReferenceAlphabet.Length)];
        }
        return string.Concat("PP-ONB-", suffix);
    }
}
```

> The test's regex `^PP-ONB-[0-9A-HJ-NP-TV-Z]{4}$` is the character class above written as a
> range: digits, then A–H, J–N, P–T, V–Z. It excludes I, L, O and U exactly as the alphabet does.

- [ ] **Step 5: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Domain.Tests --filter "FullyQualifiedName~OnboardingApplicationTests"`
Expected: PASS — 20 passed

- [ ] **Step 6: Write the EF configuration**

Create `src/Infrastructure/PeakPower.Persistence/Configurations/OnboardingApplicationConfiguration.cs`:

```csharp
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Onboarding;

namespace PeakPower.Persistence.Configurations;

public sealed class OnboardingApplicationConfiguration
    : IEntityTypeConfiguration<OnboardingApplication>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public void Configure(EntityTypeBuilder<OnboardingApplication> builder)
    {
        builder.ToTable("onboarding_application", "customer");
        builder.HasKey(a => a.Id);

        builder.Property(a => a.Reference).HasMaxLength(16).IsRequired();
        builder.HasIndex(a => a.Reference).IsUnique();

        builder.Property(a => a.FirstName).HasMaxLength(100).IsRequired();
        builder.Property(a => a.LastName).HasMaxLength(100).IsRequired();
        builder.Property(a => a.Email).HasColumnType("citext").IsRequired();
        builder.Property(a => a.PasswordHash).HasMaxLength(200).IsRequired();

        builder.Property(a => a.OrganizationName).HasMaxLength(200);
        builder.Property(a => a.KvkNumber).HasMaxLength(8);
        builder.Property(a => a.Industry).HasMaxLength(60);
        builder.Property(a => a.Iban).HasMaxLength(34);
        builder.Property(a => a.BankAccountHolder).HasMaxLength(200);
        builder.Property(a => a.SignCodeHash).HasMaxLength(64);

        // Address is a record, stored as jsonb — the same treatment customer.customer gives it.
        builder.Property(a => a.RegisteredAddress)
            .HasColumnName("registered_address")
            .HasColumnType("jsonb")
            .HasConversion(
                value => value == null ? null : JsonSerializer.Serialize(value, Json),
                value => value == null ? null : JsonSerializer.Deserialize<Address>(value, Json));

        // Signatories live in one jsonb column rather than a table of their own: the shared
        // contract fixes the table list, and a signatory has no life outside its application.
        builder.Property<List<OnboardingSignatory>>("_signatories")
            .HasField("_signatories")
            .UsePropertyAccessMode(PropertyAccessMode.Field)
            .HasColumnName("signatories")
            .HasColumnType("jsonb")
            .IsRequired()
            .HasConversion(
                value => JsonSerializer.Serialize(value, Json),
                value => JsonSerializer.Deserialize<List<OnboardingSignatory>>(value, Json)!,
                new ValueComparer<List<OnboardingSignatory>>(
                    (left, right) => JsonSerializer.Serialize(left, Json)
                                  == JsonSerializer.Serialize(right, Json),
                    value => JsonSerializer.Serialize(value, Json).GetHashCode(),
                    value => JsonSerializer.Deserialize<List<OnboardingSignatory>>(
                        JsonSerializer.Serialize(value, Json), Json)!));

        builder.Ignore(a => a.Signatories);
    }
}
```

Add to `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs`:

```csharp
    public DbSet<PeakPower.Domain.Onboarding.OnboardingApplication> OnboardingApplications =>
        Set<PeakPower.Domain.Onboarding.OnboardingApplication>();
```

Regenerate the migration so the table matches:

```bash
dotnet ef migrations remove \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator

dotnet ef migrations add AuthAndOnboarding \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator \
  --output-dir Migrations
```

Re-apply the raw SQL block from Task 4 Step 5 to the end of the regenerated `Up`, and the
`DROP POLICY` block to the end of `Down`.

- [ ] **Step 7: Run the schema test and watch it still pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~AuthSchemaTests"`
Expected: PASS — 13 passed

- [ ] **Step 8: Commit**

```bash
git add src/Core/PeakPower.Domain/Onboarding \
        src/Infrastructure/PeakPower.Persistence/Configurations/OnboardingApplicationConfiguration.cs \
        src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs \
        src/Infrastructure/PeakPower.Persistence/Migrations \
        tests/PeakPower.Domain.Tests/Onboarding/OnboardingApplicationTests.cs
git commit -m "feat(onboarding): the application aggregate and the wizard's first seven steps"
```

---

### Task 16: Signatories and the signing code (steps eight and nine)

**The demo's `SIGN_CODE` is a demo affordance, not a credential.** `onboarding-flow.js` says so
in a comment: it is a constant shipped to the browser in a flow that submits nothing, printed in
the email preview because a code nobody can read is a demo nobody can finish. Here the code is
generated per application, from a CSPRNG, stored hashed, and delivered only by email.

**Why SHA-256 is enough for six digits, given three other rules.** A six-digit code is one of a
million — brute-forceable in principle. Three things make that irrelevant: the code lives thirty
minutes, five wrong attempts burn it permanently, and the application id needed to attempt it at
all is an unguessable GUID delivered only to the person who started the wizard. Hashing protects
the database dump; the attempt cap protects the code.

**One code per application, not one per signatory.** The demo's step 8 says each signatory is
emailed their own code, but its step 9 accepts a single code and completes. Multi-party signing —
several codes, several completion events, a partially signed agreement — is real work with no
requirement behind it in slice 1, so this plan sends the *same* code to every signatory and one
correct entry signs. Recorded here so a reader does not mistake it for an oversight.

**Files:**
- Modify: `src/Core/PeakPower.Domain/Onboarding/OnboardingApplication.cs`
- Test: `tests/PeakPower.Domain.Tests/Onboarding/OnboardingSigningTests.cs`

**Interfaces:**
- Consumes: `OnboardingReferenceData.MinimumSignatories(SigningAuthority)` (Task 15);
  `Result<OnboardingApplication>` (Task 15).
- Produces, on `OnboardingApplication`:
  - `Result<OnboardingApplication> SetSignatories(IReadOnlyList<OnboardingSignatory> signatories)`
  - `static IReadOnlyList<OnboardingSignatory> SignatoriesForAuthority(SigningAuthority authority, string firstName, string lastName, string email)`
  - `Result<OnboardingApplication> IssueSignCode(string codeHash, DateTimeOffset expiresAt)`
  - `Result<OnboardingApplication> VerifySignCode(string presentedHash, bool agreedDocuments, DateTimeOffset now)`
  - `const int MaximumSignCodeAttempts = 5`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Domain.Tests/Onboarding/OnboardingSigningTests.cs`:

```csharp
using Shouldly;
using PeakPower.Domain.Onboarding;
using Xunit;

namespace PeakPower.Domain.Tests.Onboarding;

public sealed class OnboardingSigningTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 26, 9, 0, 0, TimeSpan.Zero);
    private const string Hash = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaA==";
    private const string CodeHash = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789";

    private static OnboardingApplication Ready(SigningAuthority authority)
    {
        var application = OnboardingApplication.Start(
            "Peter", "de Vries", "p.devries@vandersteen.nl", Hash, true, Now).Value;
        application.ApplyCompany("Vandersteen Koeling B.V.", LegalEntityType.BV, "24398112");
        application.ApplySigningAuthority(authority);
        return application;
    }

    [Fact]
    public void Signing_alone_pre_fills_the_applicant_as_the_only_signatory()
    {
        var suggested = OnboardingApplication.SignatoriesForAuthority(
            SigningAuthority.Alone, "Peter", "de Vries", "p.devries@vandersteen.nl");

        suggested.Count().ShouldBe(1);
        suggested[0].IsApplicant.ShouldBeTrue();
        suggested[0].Email.ShouldBe("p.devries@vandersteen.nl");
    }

    [Fact]
    public void Signing_jointly_pre_fills_the_applicant_and_leaves_room_for_a_colleague()
    {
        var suggested = OnboardingApplication.SignatoriesForAuthority(
            SigningAuthority.Jointly, "Peter", "de Vries", "p.devries@vandersteen.nl");

        suggested.Count().ShouldBe(1, "the second person is added by the customer");
        suggested[0].IsApplicant.ShouldBeTrue();
    }

    [Fact]
    public void Someone_else_signing_drops_the_applicant_entirely()
    {
        var suggested = OnboardingApplication.SignatoriesForAuthority(
            SigningAuthority.SomeoneElse, "Peter", "de Vries", "p.devries@vandersteen.nl");

        suggested.ShouldBeEmpty("they manage the account, they do not sign it");
    }

    [Fact]
    public void Joint_authority_refuses_a_single_signatory()
    {
        var result = Ready(SigningAuthority.Jointly).SetSignatories(
            [new OnboardingSignatory("Peter", "de Vries", "p.devries@vandersteen.nl", true)]);

        result.IsSuccess.ShouldBeFalse();
        result.Error.ShouldBe("You answered that two people sign — add the second signatory.");
    }

    [Fact]
    public void Every_signatory_needs_a_name_and_an_email()
    {
        var result = Ready(SigningAuthority.Alone).SetSignatories(
            [new OnboardingSignatory("Peter", "", "p.devries@vandersteen.nl", true)]);

        result.IsSuccess.ShouldBeFalse();
        result.Error.ShouldBe(
            "Every signatory needs a first name, last name and email address.");
    }

    [Fact]
    public void A_complete_signatory_list_moves_the_application_to_awaiting_signature()
    {
        var application = Ready(SigningAuthority.Jointly);

        application.SetSignatories(
        [
            new OnboardingSignatory("Peter", "de Vries", "p.devries@vandersteen.nl", true),
            new OnboardingSignatory("Marieke", "Vandersteen", "m.vandersteen@vandersteen.nl", false),
        ]).IsSuccess.ShouldBeTrue();

        application.IssueSignCode(CodeHash, Now.AddMinutes(30)).IsSuccess.ShouldBeTrue();
        application.Status.ShouldBe(OnboardingStatus.AwaitingSignature);
        application.SignCodeAttempts.ShouldBe(0);
    }

    private static OnboardingApplication AwaitingSignature()
    {
        var application = Ready(SigningAuthority.Alone);
        application.SetSignatories(
            [new OnboardingSignatory("Peter", "de Vries", "p.devries@vandersteen.nl", true)]);
        application.IssueSignCode(CodeHash, Now.AddMinutes(30));
        return application;
    }

    [Fact]
    public void The_right_code_with_the_box_ticked_verifies()
    {
        var result = AwaitingSignature().VerifySignCode(CodeHash, agreedDocuments: true, Now);

        result.IsSuccess.ShouldBeTrue();
    }

    [Fact]
    public void A_code_without_the_agreement_signs_nothing()
    {
        var result = AwaitingSignature().VerifySignCode(CodeHash, agreedDocuments: false, Now);

        result.IsSuccess.ShouldBeFalse();
        result.Error.ShouldBe("Tick the box to confirm you agree to the documents.");
    }

    [Fact]
    public void A_wrong_code_is_counted()
    {
        var application = AwaitingSignature();

        var result = application.VerifySignCode("0".PadLeft(64, '0'), true, Now);

        result.IsSuccess.ShouldBeFalse();
        result.Error.ShouldBe("That code does not match the one we emailed you.");
        application.SignCodeAttempts.ShouldBe(1);
    }

    [Fact]
    public void Five_wrong_codes_burn_the_code_permanently()
    {
        var application = AwaitingSignature();
        for (var i = 0; i < 5; i++) application.VerifySignCode("0".PadLeft(64, '0'), true, Now);

        var withTheRightCode = application.VerifySignCode(CodeHash, true, Now);

        withTheRightCode.IsSuccess.ShouldBeFalse();
        withTheRightCode.Error.ShouldBe(
            "Too many attempts. Ask for a new code to be sent.");
    }

    [Fact]
    public void An_expired_code_is_refused()
    {
        var application = AwaitingSignature();

        var result = application.VerifySignCode(CodeHash, true, Now.AddMinutes(31));

        result.IsSuccess.ShouldBeFalse();
        result.Error.ShouldBe("That code has expired. Ask for a new one to be sent.");
    }

    [Fact]
    public void A_new_code_clears_the_attempt_counter()
    {
        var application = AwaitingSignature();
        for (var i = 0; i < 5; i++) application.VerifySignCode("0".PadLeft(64, '0'), true, Now);

        application.IssueSignCode(CodeHash, Now.AddMinutes(30));

        application.SignCodeAttempts.ShouldBe(0);
        application.VerifySignCode(CodeHash, true, Now).IsSuccess.ShouldBeTrue();
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Domain.Tests --filter "FullyQualifiedName~OnboardingSigningTests"`
Expected: FAIL — `error CS0117: 'OnboardingApplication' does not contain a definition for 'SignatoriesForAuthority'`

- [ ] **Step 3: Write the signatory and signing-code rules**

Add to `src/Core/PeakPower.Domain/Onboarding/OnboardingApplication.cs`, inside the class:

```csharp
    /// <summary>
    /// Five, then the code is dead. A six-digit code is one of a million, which would be
    /// brute-forceable if anything let you try a million times.
    /// </summary>
    public const int MaximumSignCodeAttempts = 5;

    /// <summary>
    /// What the wizard should show on step 8 before the customer edits it.
    /// "Someone else signs" returns nothing: they manage the account, they do not sign it.
    /// </summary>
    public static IReadOnlyList<OnboardingSignatory> SignatoriesForAuthority(
        SigningAuthority authority, string firstName, string lastName, string email) =>
        authority == SigningAuthority.SomeoneElse
            ? []
            : [new OnboardingSignatory(firstName, lastName, email, IsApplicant: true)];

    public Result<OnboardingApplication> SetSignatories(
        IReadOnlyList<OnboardingSignatory> signatories)
    {
        if (Status != OnboardingStatus.Draft) return NotDraft();

        if (SigningAuthority is not { } authority)
        {
            return Result<OnboardingApplication>.Failure(
                "Answer the signing-authority question first.");
        }

        if (signatories.Count < OnboardingReferenceData.MinimumSignatories(authority))
        {
            return Result<OnboardingApplication>.Failure(
                authority == Onboarding.SigningAuthority.Jointly
                    ? "You answered that two people sign — add the second signatory."
                    : "Add at least one person who will sign the agreement.");
        }

        if (signatories.Any(s => string.IsNullOrWhiteSpace(s.FirstName)
                              || string.IsNullOrWhiteSpace(s.LastName)
                              || !LooksLikeEmail(s.Email)))
        {
            return Result<OnboardingApplication>.Failure(
                "Every signatory needs a first name, last name and email address.");
        }

        _signatories.Clear();
        _signatories.AddRange(signatories);
        return Ok();
    }

    /// <summary>
    /// Records a freshly generated code and moves the application to AwaitingSignature. The
    /// attempt counter resets, so asking for a new code is the way out of a burnt one.
    /// </summary>
    public Result<OnboardingApplication> IssueSignCode(string codeHash, DateTimeOffset expiresAt)
    {
        if (Status == OnboardingStatus.Signed)
        {
            return Result<OnboardingApplication>.Failure(
                "This agreement has already been signed.");
        }

        if (_signatories.Count == 0)
        {
            return Result<OnboardingApplication>.Failure(
                "Add at least one person who will sign the agreement.");
        }

        SignCodeHash = codeHash;
        SignCodeExpiresAt = expiresAt;
        SignCodeAttempts = 0;
        Status = OnboardingStatus.AwaitingSignature;
        return Ok();
    }

    /// <summary>
    /// Both conditions, and in this order: a code without the agreement signs nothing, and the
    /// agreement without the code is nobody in particular ticking it.
    /// </summary>
    public Result<OnboardingApplication> VerifySignCode(
        string presentedHash, bool agreedDocuments, DateTimeOffset now)
    {
        if (Status == OnboardingStatus.Signed) return Ok();   // idempotent by design

        if (Status != OnboardingStatus.AwaitingSignature || SignCodeHash is null)
        {
            return Result<OnboardingApplication>.Failure(
                "No signing code has been sent for this application yet.");
        }

        if (SignCodeAttempts >= MaximumSignCodeAttempts)
        {
            return Result<OnboardingApplication>.Failure(
                "Too many attempts. Ask for a new code to be sent.");
        }

        if (SignCodeExpiresAt is { } expiry && now >= expiry)
        {
            return Result<OnboardingApplication>.Failure(
                "That code has expired. Ask for a new one to be sent.");
        }

        if (!string.Equals(presentedHash, SignCodeHash, StringComparison.Ordinal))
        {
            SignCodeAttempts++;
            return Result<OnboardingApplication>.Failure(
                "That code does not match the one we emailed you.");
        }

        if (!agreedDocuments)
        {
            return Result<OnboardingApplication>.Failure(
                "Tick the box to confirm you agree to the documents.");
        }

        return Ok();
    }
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Domain.Tests --filter "FullyQualifiedName~OnboardingSigningTests"`
Expected: PASS — 12 passed

- [ ] **Step 5: Commit**

```bash
git add src/Core/PeakPower.Domain/Onboarding/OnboardingApplication.cs \
        tests/PeakPower.Domain.Tests/Onboarding/OnboardingSigningTests.cs
git commit -m "feat(onboarding): signatory rules and a real per-application signing code"
```

---

### Task 17: Signing — the company, the account and the wallet in one transaction

Everything the wizard collected becomes three rows: `customer.customer`,
`customer.customer_account` and `wallet.wallet`. Either all three exist or none do, which is
what "one transaction" buys — a half-created company that can sign in but has no wallet is worse
than a failed sign-up.

**Idempotency.** A person who reloads the confirmation page, or a client that retries a timed-out
request, must not create a second company. The application records the ids it created, so a
second call on a Signed application returns the same three ids without touching the database.

**What the customer's status ends up as.** The demo's last step has two outcomes: "Welcome to
PeakPower · your account is active" when the one-cent bank verification cleared, and "Agreement
signed" with the account held for review when it did not. That maps exactly onto the shared
contract's `CustomerStatus`: `Active` when `BankVerifiedAt` is set, `Prospect` when it is not.
The *account* is `Active` either way — the person just chose a password and signed, and design
DoD 2 has them land in the portal.

**The account is `IsAdmin = true`.** The first account of a company must be able to administer
it; there is nobody else. The `[DEC-71]` flag has no behaviour in slice 1, but writing it
correctly now is the whole point of shipping the column early.

**Files:**
- Modify: `src/Core/PeakPower.Domain/Onboarding/OnboardingApplication.cs`
- Create: `src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingService.cs`
- Test: `tests/PeakPower.Integration.Tests/Onboarding/OnboardingMaterialisationTests.cs`

**Interfaces:**
- Consumes, all from shared contract §5.1 and written by plan 1:
  `static Result<Customer> Customer.Create(string legalName, string? tradeName, KvkNumber kvkNumber, string? vatNumber, Address billingAddress, Address? visitingAddress, ContactPerson primaryContact, string? internalReference, string locale)`,
  `Result<Customer> Customer.ChangeStatus(CustomerStatus)`,
  `static Result<CustomerAccount> CustomerAccount.Create(Guid customerId, string username, string firstName, string lastName, string? jobTitle, string email, string? phone, AccountStatus status, bool isAdmin)`,
  `void CustomerAccount.SetPassword(string)`, and
  `static Result<Wallet> Wallet.CreateEuroWallet(Guid customerId)`.
  Also `PeakPower.Infrastructure.Web.Http.EnumWireFormat.ToWire<TEnum>` (plan 2);
  `OnboardingApplication.VerifySignCode(...)` (Task 16); `IEmailSender` (Task 13);
  `IMarketCalendar` (plan 1); `OpaqueToken.HashOf(string)` (Task 3).
- Produces:
  - On `OnboardingApplication`: `void MarkSigned(Guid customerId, Guid accountId, DateTimeOffset at)`,
    `Result<OnboardingApplication> ReadyToSign()`
  - `PeakPower.Api.Customer.Onboarding.SignedOnboardingResult(Guid CustomerId, Guid AccountId, Guid WalletId, string Username, string CustomerStatus)`
  - `PeakPower.Api.Customer.Onboarding.OnboardingService` with
    `Task<Result<OnboardingApplication>> StartAsync(string firstName, string lastName, string email, string password, bool termsAccepted, CancellationToken ct)`,
    `Task<Result<OnboardingApplication>> IssueAndSendSignCodeAsync(OnboardingApplication application, CancellationToken ct)`,
    `Task<Result<SignedOnboardingResult>> SignAsync(Guid applicationId, string code, bool agreedDocuments, CancellationToken ct)`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Onboarding/OnboardingMaterialisationTests.cs`:

```csharp
using Shouldly;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Api.Customer.Onboarding;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Onboarding;
using Xunit;

namespace PeakPower.Integration.Tests.Onboarding;

public sealed class OnboardingMaterialisationTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    /// <summary>Drives the aggregate to AwaitingSignature and hands back the raw six digits.</summary>
    private async Task<(Guid ApplicationId, string Code)> ReadyToSignAsync(bool bankVerified)
    {
        using var scope = factory.Services.CreateScope();
        var service = scope.ServiceProvider.GetRequiredService<OnboardingService>();

        var started = await service.StartAsync(
            "Peter", "de Vries", $"{Guid.NewGuid():N}@vandersteen.nl",
            "correct-horse-battery", termsAccepted: true, TestContext.Current.CancellationToken);
        var application = started.Value;

        application.ApplyCompany("Vandersteen Koeling B.V.", LegalEntityType.BV, "24398112");
        application.ApplyRegisteredAddress(
            new Address("Havenweg", "22", null, "3089 JJ", "Rotterdam", "NL"));
        application.ApplyIndustry("Agriculture & Food Processing");
        application.ApplyVolume(FlowDirection.Both, VolumeBand.From1000To2500Mwh);
        application.ApplyBankAccount("NL18INGB0002445566", "Vandersteen Koeling B.V.");
        application.ApplySigningAuthority(SigningAuthority.Alone);
        application.SetSignatories(
            [new OnboardingSignatory("Peter", "de Vries", application.Email, true)]);
        if (bankVerified) application.MarkBankVerified(DateTimeOffset.UtcNow);

        var code = OnboardingService.NewSignCode();
        application.IssueSignCode(
            PeakPower.Infrastructure.Identity.OpaqueToken.HashOf(code),
            DateTimeOffset.UtcNow.AddMinutes(30));

        await using var db = factory.CreateOwnerDbContext();
        db.OnboardingApplications.Add(application);
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);

        return (application.Id, code);
    }

    private OnboardingService Service(IServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<OnboardingService>();

    [Fact]
    public async Task Signing_creates_the_company_the_account_and_the_wallet()
    {
        var (applicationId, code) = await ReadyToSignAsync(bankVerified: true);

        using var scope = factory.Services.CreateScope();
        var result = await Service(scope).SignAsync(
            applicationId, code, agreedDocuments: true, TestContext.Current.CancellationToken);

        result.IsSuccess.ShouldBeTrue(result.Error);

        await using var db = factory.CreateOwnerDbContext();
        var customer = await db.Customers.SingleAsync(c => c.Id == result.Value.CustomerId);
        customer.LegalName.ShouldBe("Vandersteen Koeling B.V.");
        customer.KvkNumber.Value.ShouldBe("24398112");
        customer.Status.ShouldBe(CustomerStatus.Active, "the one cent cleared");
        customer.Locale.ShouldBe("nl-NL");

        var account = await db.CustomerAccounts.SingleAsync(a => a.Id == result.Value.AccountId);
        account.CustomerId.ShouldBe(customer.Id);
        account.IsAdmin.ShouldBeTrue("the first account has to administer the company");
        account.Status.ShouldBe(AccountStatus.Active);
        account.PasswordHash.ShouldStartWith("$argon2id$");

        var wallet = await db.Wallets.SingleAsync(w => w.CustomerId == customer.Id);
        wallet.Currency.ShouldBe("EUR");
        wallet.Balance.ShouldBe(0m);
    }

    [Fact]
    public async Task An_unverified_bank_account_lands_the_company_as_a_prospect()
    {
        var (applicationId, code) = await ReadyToSignAsync(bankVerified: false);

        using var scope = factory.Services.CreateScope();
        var result = await Service(scope).SignAsync(
            applicationId, code, true, TestContext.Current.CancellationToken);

        await using var db = factory.CreateOwnerDbContext();
        var customer = await db.Customers.SingleAsync(c => c.Id == result.Value.CustomerId);
        customer.Status.ShouldBe(CustomerStatus.Prospect,
            "the agreement is signed but the one cent has not arrived");
    }

    [Fact]
    public async Task Signing_twice_returns_the_same_company_rather_than_a_second_one()
    {
        var (applicationId, code) = await ReadyToSignAsync(bankVerified: true);

        using var scope = factory.Services.CreateScope();
        var first = await Service(scope).SignAsync(
            applicationId, code, true, TestContext.Current.CancellationToken);
        var second = await Service(scope).SignAsync(
            applicationId, code, true, TestContext.Current.CancellationToken);

        second.IsSuccess.ShouldBeTrue();
        second.Value.CustomerId.ShouldBe(first.Value.CustomerId);
        second.Value.AccountId.ShouldBe(first.Value.AccountId);

        await using var db = factory.CreateOwnerDbContext();
        (await db.Customers.CountAsync(c => c.Id == first.Value.CustomerId)).ShouldBe(1);
        (await db.Wallets.CountAsync(w => w.CustomerId == first.Value.CustomerId)).ShouldBe(1);
    }

    [Fact]
    public async Task The_wrong_code_creates_nothing_at_all()
    {
        var (applicationId, _) = await ReadyToSignAsync(bankVerified: true);

        using var scope = factory.Services.CreateScope();
        var before = await CountCustomersAsync();

        var result = await Service(scope).SignAsync(
            applicationId, "000000", true, TestContext.Current.CancellationToken);

        result.IsSuccess.ShouldBeFalse();
        (await CountCustomersAsync()).ShouldBe(before);

        async Task<int> CountCustomersAsync()
        {
            await using var db = factory.CreateOwnerDbContext();
            return await db.Customers.CountAsync(TestContext.Current.CancellationToken);
        }
    }

    [Fact]
    public async Task Signing_without_a_registered_address_names_the_step_that_is_missing()
    {
        using var scope = factory.Services.CreateScope();
        var service = Service(scope);

        var application = (await service.StartAsync(
            "Peter", "de Vries", $"{Guid.NewGuid():N}@vandersteen.nl",
            "correct-horse-battery", true, TestContext.Current.CancellationToken)).Value;
        application.ApplyCompany("Vandersteen Koeling B.V.", LegalEntityType.BV, "24398112");
        application.ApplySigningAuthority(SigningAuthority.Alone);
        application.SetSignatories(
            [new OnboardingSignatory("Peter", "de Vries", application.Email, true)]);

        var code = OnboardingService.NewSignCode();
        application.IssueSignCode(
            PeakPower.Infrastructure.Identity.OpaqueToken.HashOf(code),
            DateTimeOffset.UtcNow.AddMinutes(30));

        await using (var db = factory.CreateOwnerDbContext())
        {
            db.OnboardingApplications.Add(application);
            await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        }

        var result = await service.SignAsync(
            application.Id, code, true, TestContext.Current.CancellationToken);

        result.IsSuccess.ShouldBeFalse();
        result.Error.ShouldContain("registered address");
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~OnboardingMaterialisationTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'OnboardingService' could not be found`

- [ ] **Step 3: Add the aggregate's remaining two methods**

Add to `src/Core/PeakPower.Domain/Onboarding/OnboardingApplication.cs`, inside the class:

```csharp
    /// <summary>
    /// Everything signing needs that a step did not already insist on.
    ///
    /// The registered address is the interesting one: step 3 lets a customer continue with it
    /// blank, because the demo says the desk resolves it during review. But
    /// Customer.BillingAddress is not nullable and design §8.5 forbids inventing plausible
    /// data, so the address becomes mandatory here rather than there. The customer is never
    /// blocked mid-wizard and no company is ever created with a fabricated address.
    /// </summary>
    public Result<OnboardingApplication> ReadyToSign()
    {
        if (string.IsNullOrWhiteSpace(OrganizationName) || KvkNumber is null)
        {
            return Result<OnboardingApplication>.Failure(
                "Go back to the company step — the organization name and KvK number are needed.");
        }

        if (RegisteredAddress is null)
        {
            return Result<OnboardingApplication>.Failure(
                "Go back to the registered address step — an address is needed before "
                + "the agreement can be issued.");
        }

        if (SigningAuthority is null)
        {
            return Result<OnboardingApplication>.Failure(
                "Go back to the signing-authority step and choose one option.");
        }

        return Ok();
    }

    /// <summary>Records the three rows this application produced, which is what makes signing idempotent.</summary>
    public void MarkSigned(Guid customerId, Guid accountId, DateTimeOffset at)
    {
        CustomerId = customerId;
        AccountId = accountId;
        SignedAt = at;
        Status = OnboardingStatus.Signed;
    }
```

- [ ] **Step 4: Write the onboarding service**

Create `src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingService.cs`:

```csharp
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Onboarding;
using PeakPower.Domain.Wallets;
using PeakPower.Infrastructure.Identity;
using PeakPower.Infrastructure.Web.Http;
using PeakPower.Persistence;

namespace PeakPower.Api.Customer.Onboarding;

/// <summary>What signing produced, for the wizard's welcome screen and the portal handover.</summary>
public sealed record SignedOnboardingResult(
    Guid CustomerId,
    Guid AccountId,
    Guid WalletId,
    string Username,
    string CustomerStatus);

/// <summary>
/// Orchestration for the onboarding wizard. The rules live in the aggregate; this class owns the
/// transaction, the signing code's generation and delivery, and the one place where a company is
/// brought into existence.
/// </summary>
public sealed class OnboardingService(
    PeakPowerDbContext db,
    IPasswordHasher hasher,
    IEmailSender email,
    IMarketCalendar calendar)
{
    /// <summary>Thirty minutes — long enough to fetch an email, short enough to matter.</summary>
    public static readonly TimeSpan SignCodeLifetime = TimeSpan.FromMinutes(30);

    /// <summary>
    /// Six digits from a CSPRNG.
    ///
    /// The demo's SIGN_CODE is the constant "748213", and its own comment says why that is fine
    /// there: it ships to a browser in a flow that submits nothing. Here the code is a real
    /// one-time secret, so it is generated per application, stored hashed and delivered only by
    /// email.
    /// </summary>
    public static string NewSignCode() =>
        RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");

    public async Task<Result<OnboardingApplication>> StartAsync(
        string firstName,
        string lastName,
        string email_,
        string password,
        bool termsAccepted,
        CancellationToken ct)
    {
        if (!PeakPower.Contracts.Customer.Auth.PasswordPolicy.IsAcceptable(password))
        {
            return Result<OnboardingApplication>.Failure(
                "Choose a password of at least "
                + $"{PeakPower.Contracts.Customer.Auth.PasswordPolicy.MinimumLength} characters.");
        }

        var address = (email_ ?? string.Empty).Trim();
        if (await db.CustomerAccounts.AnyAsync(a => a.Username == address, ct))
        {
            // Not an enumeration oracle worth hiding: the wizard has to tell someone that the
            // address is taken, or they cannot proceed. It points at sign-in instead.
            return Result<OnboardingApplication>.Failure(
                "An account already exists for this email address. Sign in instead.");
        }

        return OnboardingApplication.Start(
            firstName, lastName, address, hasher.Hash(password), termsAccepted, calendar.UtcNow);
    }

    /// <summary>Generates a code, stores its hash, and emails the same code to every signatory.</summary>
    public async Task<Result<OnboardingApplication>> IssueAndSendSignCodeAsync(
        OnboardingApplication application, CancellationToken ct)
    {
        var code = NewSignCode();
        var issued = application.IssueSignCode(
            OpaqueToken.HashOf(code), calendar.UtcNow + SignCodeLifetime);

        if (!issued.IsSuccess) return issued;

        foreach (var signatory in application.Signatories)
        {
            await email.SendAsync(
                signatory.Email,
                $"Your PeakPower signing code — {application.Reference}",
                $"""
                 Hello {signatory.FirstName},

                 Entering this six-digit code on the signing step is your signature on the
                 agreement for {application.OrganizationName}.

                 {code}

                 The code expires in 30 minutes. Quote {application.Reference} if you write to us.
                 """,
                ct);
        }

        return issued;
    }

    /// <summary>
    /// Verifies the code and, if it is right, brings the company into existence: customer,
    /// account and wallet, in one transaction. Calling it twice on a signed application returns
    /// the same three ids and writes nothing.
    /// </summary>
    public async Task<Result<SignedOnboardingResult>> SignAsync(
        Guid applicationId, string code, bool agreedDocuments, CancellationToken ct)
    {
        var application = await db.OnboardingApplications
            .SingleOrDefaultAsync(a => a.Id == applicationId, ct);

        if (application is null)
        {
            return Result<SignedOnboardingResult>.Failure("That application does not exist.");
        }

        if (application.Status == OnboardingStatus.Signed)
        {
            return await AlreadySignedAsync(application, ct);
        }

        var verified = application.VerifySignCode(
            OpaqueToken.HashOf(code ?? string.Empty), agreedDocuments, calendar.UtcNow);

        if (!verified.IsSuccess)
        {
            // Persist the incremented attempt counter even though the sign failed — otherwise
            // the five-attempt cap counts nothing.
            await db.SaveChangesAsync(ct);
            return Result<SignedOnboardingResult>.Failure(verified.Error);
        }

        var ready = application.ReadyToSign();
        if (!ready.IsSuccess)
        {
            return Result<SignedOnboardingResult>.Failure(ready.Error);
        }

        var now = calendar.UtcNow;

        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        var customer = Customer.Create(
            legalName: application.OrganizationName!,
            tradeName: null,
            kvkNumber: KvkNumber.Create(application.KvkNumber!).Value,
            vatNumber: null,
            billingAddress: application.RegisteredAddress!,
            visitingAddress: null,
            primaryContact: new ContactPerson(
                $"{application.FirstName} {application.LastName}", application.Email, null),
            internalReference: application.Reference,
            locale: "nl-NL").Value;

        // The demo's last step has two outcomes and must not print the wrong one: the agreement
        // is signed either way, but the company is only Active once the one cent has cleared.
        customer.ChangeStatus(application.BankVerifiedAt is null
            ? PeakPower.Domain.Customers.CustomerStatus.Prospect
            : PeakPower.Domain.Customers.CustomerStatus.Active);

        var account = CustomerAccount.Create(
            customerId: customer.Id,
            username: application.Email,
            firstName: application.FirstName,
            lastName: application.LastName,
            jobTitle: null,
            email: application.Email,
            phone: null,
            status: AccountStatus.Active,
            isAdmin: true).Value;   // the first account has to be able to administer the company
        account.SetPassword(application.PasswordHash);

        var wallet = Wallet.CreateEuroWallet(customer.Id).Value;

        db.Customers.Add(customer);
        db.CustomerAccounts.Add(account);
        db.Wallets.Add(wallet);

        application.MarkSigned(customer.Id, account.Id, now);

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return Result<SignedOnboardingResult>.Success(new SignedOnboardingResult(
            customer.Id, account.Id, wallet.Id, account.Username,
            EnumWireFormat.ToWire(customer.Status)));
    }

    private async Task<Result<SignedOnboardingResult>> AlreadySignedAsync(
        OnboardingApplication application, CancellationToken ct)
    {
        var wallet = await db.Wallets
            .SingleAsync(w => w.CustomerId == application.CustomerId!.Value, ct);
        var customer = await db.Customers
            .SingleAsync(c => c.Id == application.CustomerId!.Value, ct);

        return Result<SignedOnboardingResult>.Success(new SignedOnboardingResult(
            application.CustomerId!.Value,
            application.AccountId!.Value,
            wallet.Id,
            application.Email,
            EnumWireFormat.ToWire(customer.Status)));
    }
}
```

Register it in `src/Hosts/PeakPower.Api.Customer/Program.cs`:

```csharp
builder.Services.AddScoped<PeakPower.Api.Customer.Onboarding.OnboardingService>();
```

> `Customer.ChangeStatus(CustomerStatus)` is plan 1's, and shared contract §5.1 fixes the name —
> it is `ChangeStatus`, not `SetStatus`. Like every other operation that can fail it returns
> `Result<Customer>`; the value is discarded here because the only transition this plan makes is
> from the freshly created `Prospect` and cannot be rejected. This is the only place in the plan
> that sets a customer's status.
>
> `EnumWireFormat.ToWire` is plan 2's, in `PeakPower.Infrastructure.Web.Http`. Shared contract
> §5.2 is why it is here rather than `customer.Status.ToString()`: `CustomerStatus` reaches the
> portal as `ACTIVE`, and plan 6's wizard branches on that exact spelling.

- [ ] **Step 5: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~OnboardingMaterialisationTests"`
Expected: PASS — 5 passed

- [ ] **Step 6: Commit**

```bash
git add src/Core/PeakPower.Domain/Onboarding/OnboardingApplication.cs \
        src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingService.cs \
        src/Hosts/PeakPower.Api.Customer/Program.cs \
        tests/PeakPower.Integration.Tests/Onboarding/OnboardingMaterialisationTests.cs
git commit -m "feat(onboarding): materialise customer, account and wallet in one transaction"
```

---

### Task 18: The onboarding endpoints, and wiring the customer API into the AppHost

Five routes and one Aspire resource. All five onboarding routes are anonymous — there is no
customer yet, so there is nobody to authenticate as. The application's `Guid` is the capability
that lets a browser come back to its own draft; no endpoint reads an application, so there is no
enumeration surface, and every route refuses once the application is Signed.

The bank-verification route is a **development-only** stand-in for the demo's "Mark € 0,01 as
received" button. Slice 1 has no payment integration — iDEAL and bank feeds are F07 and are out
of scope — so without it the `Active` half of the demo's two outcomes could never be shown. It
returns 404 outside Development, and that is tested.

**Files:**
- Create: `src/Core/PeakPower.Contracts/Customer/Onboarding/OnboardingContracts.cs`
- Create: `src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingEndpoints.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Program.cs`
- Modify: `src/Hosts/PeakPower.AppHost/AppHost.cs`
- Modify: `tests/PeakPower.Integration.Tests/Auth/AnonymousEndpointAllowListTests.cs`
- Test: `tests/PeakPower.Integration.Tests/Onboarding/OnboardingEndpointTests.cs`

**Interfaces:**
- Consumes: `OnboardingService` and `SignedOnboardingResult` (Task 17); the aggregate's
  `Apply*` methods (Task 15) and `SetSignatories` (Task 16); `PasswordPolicy` (Task 14);
  the AppHost's `postgres`/`peakpowerDb`/`migrator` resource variables (plan 1).
- Produces:
  - `StartOnboardingRequest(string FirstName, string LastName, string Email, string Password, bool TermsAccepted)`
  - `OnboardingAddressDto(string Street, string HouseNumber, string? HouseNumberSuffix, string PostalCode, string City, string Country)`
  - `SaveOnboardingStepRequest(int Step, string? OrganizationName, string? LegalEntityType, string? KvkNumber, OnboardingAddressDto? RegisteredAddress, string? Industry, string? FlowDirection, string? VolumeBand, string? Iban, string? BankAccountHolder, string? SigningAuthority)`
  - `SignatoryDto(string FirstName, string LastName, string Email)`
  - `SubmitSignatoriesRequest(IReadOnlyList<SignatoryDto> Signatories)`
  - `SignOnboardingRequest(string Code, bool AgreedDocuments)`
  - `OnboardingApplicationResponse(Guid Id, string Reference, string Status)`
  - `SignedOnboardingResponse(Guid CustomerId, Guid AccountId, string Username, string CustomerStatus)`
  - Routes: `POST /api/v1/onboarding/applications`,
    `PATCH /api/v1/onboarding/applications/{id}`,
    `POST /api/v1/onboarding/applications/{id}/signatories`,
    `POST /api/v1/onboarding/applications/{id}/sign`,
    `POST /api/v1/onboarding/applications/{id}/bank-verification/simulate`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Onboarding/OnboardingEndpointTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Shouldly;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Contracts.Customer.Onboarding;
using Xunit;

namespace PeakPower.Integration.Tests.Onboarding;

public sealed class OnboardingEndpointTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private static readonly OnboardingAddressDto Address =
        new("Havenweg", "22", null, "3089 JJ", "Rotterdam", "NL");

    private static SaveOnboardingStepRequest Step(int step) =>
        new(step, null, null, null, null, null, null, null, null, null, null);

    [Fact]
    public async Task The_whole_wizard_runs_end_to_end_and_the_new_account_can_sign_in()
    {
        var client = factory.CreateAnonymousClient();
        var email = $"{Guid.NewGuid():N}@vandersteen.nl";

        var created = await client.PostAsJsonAsync("/api/v1/onboarding/applications",
            new StartOnboardingRequest("Peter", "de Vries", email, "correct-horse-battery", true));
        created.StatusCode.ShouldBe(HttpStatusCode.Created);

        var application = (await created.Content
            .ReadFromJsonAsync<OnboardingApplicationResponse>())!;
        application.Reference.ShouldStartWith("PP-ONB-");
        application.Status.ShouldBe("DRAFT");

        var url = $"/api/v1/onboarding/applications/{application.Id}";

        (await client.PatchAsJsonAsync(url, Step(2) with
        {
            OrganizationName = "Vandersteen Koeling B.V.",
            LegalEntityType = "BV",
            KvkNumber = "2439 8112",
        })).StatusCode.ShouldBe(HttpStatusCode.OK);

        (await client.PatchAsJsonAsync(url, Step(3) with { RegisteredAddress = Address }))
            .StatusCode.ShouldBe(HttpStatusCode.OK);

        (await client.PatchAsJsonAsync(url, Step(4) with { Industry = "Agriculture & Food Processing" }))
            .StatusCode.ShouldBe(HttpStatusCode.OK);

        (await client.PatchAsJsonAsync(url, Step(5) with
        {
            FlowDirection = "Both",
            VolumeBand = "From1000To2500Mwh",
        })).StatusCode.ShouldBe(HttpStatusCode.OK);

        (await client.PatchAsJsonAsync(url, Step(6) with
        {
            Iban = "NL18INGB0002445566",
            BankAccountHolder = "Vandersteen Koeling B.V.",
        })).StatusCode.ShouldBe(HttpStatusCode.OK);

        (await client.PatchAsJsonAsync(url, Step(7) with { SigningAuthority = "Alone" }))
            .StatusCode.ShouldBe(HttpStatusCode.OK);

        var signatories = await client.PostAsJsonAsync($"{url}/signatories",
            new SubmitSignatoriesRequest([new SignatoryDto("Peter", "de Vries", email)]));
        signatories.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        (await signatories.Content.ReadFromJsonAsync<OnboardingApplicationResponse>())!
            .Status.ShouldBe("AWAITING_SIGNATURE");

        var code = await ReadSignCodeAsync(application.Id);

        var signed = await client.PostAsJsonAsync($"{url}/sign",
            new SignOnboardingRequest(code, AgreedDocuments: true));
        signed.StatusCode.ShouldBe(HttpStatusCode.OK);

        var outcome = (await signed.Content.ReadFromJsonAsync<SignedOnboardingResponse>())!;
        outcome.Username.ShouldBe(email);
        outcome.CustomerStatus.ShouldBe("PROSPECT", "no one cent has arrived");

        var signIn = await client.PostAsJsonAsync("/api/v1/auth/sign-in",
            new SignInRequest(email, "correct-horse-battery"));
        signIn.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    /// <summary>
    /// The code only exists hashed in the database and in a log line, so the test re-issues a
    /// known one through the same aggregate method the endpoint uses.
    /// </summary>
    private async Task<string> ReadSignCodeAsync(Guid applicationId)
    {
        var code = PeakPower.Api.Customer.Onboarding.OnboardingService.NewSignCode();
        await using var db = factory.CreateOwnerDbContext();
        var application = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions
            .SingleAsync(db.OnboardingApplications, a => a.Id == applicationId);
        application.IssueSignCode(
            PeakPower.Infrastructure.Identity.OpaqueToken.HashOf(code),
            DateTimeOffset.UtcNow.AddMinutes(30));
        await db.SaveChangesAsync();
        return code;
    }

    [Fact]
    public async Task A_password_under_twelve_characters_is_refused_with_a_problem_document()
    {
        var response = await factory.CreateAnonymousClient().PostAsJsonAsync(
            "/api/v1/onboarding/applications",
            new StartOnboardingRequest(
                "Peter", "de Vries", $"{Guid.NewGuid():N}@vandersteen.nl", "short", true));

        response.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");
    }

    [Fact]
    public async Task An_unaccepted_terms_box_stops_the_application_being_created()
    {
        var response = await factory.CreateAnonymousClient().PostAsJsonAsync(
            "/api/v1/onboarding/applications",
            new StartOnboardingRequest(
                "Peter", "de Vries", $"{Guid.NewGuid():N}@vandersteen.nl",
                "correct-horse-battery", TermsAccepted: false));

        response.StatusCode.ShouldBe(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task An_unknown_application_id_is_a_404()
    {
        var response = await factory.CreateAnonymousClient().PatchAsJsonAsync(
            $"/api/v1/onboarding/applications/{Guid.NewGuid()}",
            Step(4) with { Industry = "Mining" });

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task The_bank_simulator_marks_the_account_verified_in_development()
    {
        var client = factory.CreateAnonymousClient();
        var created = await client.PostAsJsonAsync("/api/v1/onboarding/applications",
            new StartOnboardingRequest(
                "Peter", "de Vries", $"{Guid.NewGuid():N}@vandersteen.nl",
                "correct-horse-battery", true));
        var application = (await created.Content
            .ReadFromJsonAsync<OnboardingApplicationResponse>())!;

        var response = await client.PostAsync(
            $"/api/v1/onboarding/applications/{application.Id}/bank-verification/simulate",
            content: null);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        await using var db = factory.CreateOwnerDbContext();
        var stored = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions
            .SingleAsync(db.OnboardingApplications, a => a.Id == application.Id);
        stored.BankVerifiedAt.ShouldNotBeNull();
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~OnboardingEndpointTests"`
Expected: FAIL — `error CS0246: The type or namespace name 'StartOnboardingRequest' could not be found`

- [ ] **Step 3: Write the contracts**

Create `src/Core/PeakPower.Contracts/Customer/Onboarding/OnboardingContracts.cs`:

```csharp
namespace PeakPower.Contracts.Customer.Onboarding;

/// <summary>Step 1 — the person who will manage the account, and the credential they choose.</summary>
public sealed record StartOnboardingRequest(
    string FirstName,
    string LastName,
    string Email,
    string Password,
    bool TermsAccepted);

/// <summary>
/// The six components of a Dutch address. The wizard's demo has one "Street and number" field;
/// splitting that server-side is a localisation trap — Dutch house numbers carry letter
/// suffixes and other countries put the number first — so the API takes the components and the
/// UI presents whatever it likes on top of them.
/// </summary>
public sealed record OnboardingAddressDto(
    string Street,
    string HouseNumber,
    string? HouseNumberSuffix,
    string PostalCode,
    string City,
    string Country);

/// <summary>
/// One step's answers. <paramref name="Step"/> says which of steps 2 to 7 this is; the fields
/// that step does not use are ignored.
/// </summary>
public sealed record SaveOnboardingStepRequest(
    int Step,
    string? OrganizationName,
    string? LegalEntityType,
    string? KvkNumber,
    OnboardingAddressDto? RegisteredAddress,
    string? Industry,
    string? FlowDirection,
    string? VolumeBand,
    string? Iban,
    string? BankAccountHolder,
    string? SigningAuthority);

public sealed record SignatoryDto(string FirstName, string LastName, string Email);

/// <summary>Step 8 — everyone required to sign. Submitting sends the signing code.</summary>
public sealed record SubmitSignatoriesRequest(IReadOnlyList<SignatoryDto> Signatories);

/// <summary>Step 9 — the code from the email, and the agreement tickbox.</summary>
public sealed record SignOnboardingRequest(string Code, bool AgreedDocuments);

public sealed record OnboardingApplicationResponse(Guid Id, string Reference, string Status);

/// <summary>
/// Step 10. <paramref name="CustomerStatus"/> is the database spelling of
/// <c>PeakPower.Domain.Customers.CustomerStatus</c>, per shared contract §5.2: "ACTIVE" when
/// the € 0,01 has cleared and "PROSPECT" when it has not — the demo's two outcomes, which the
/// welcome screen must not mix up.
/// </summary>
public sealed record SignedOnboardingResponse(
    Guid CustomerId,
    Guid AccountId,
    string Username,
    string CustomerStatus);
```

- [ ] **Step 4: Write the endpoints**

Create `src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingEndpoints.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Onboarding;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Onboarding;
using PeakPower.Infrastructure.Web.Http;
using PeakPower.Persistence;

namespace PeakPower.Api.Customer.Onboarding;

public static class OnboardingEndpoints
{
    public static IEndpointRouteBuilder MapOnboardingEndpoints(this IEndpointRouteBuilder routes)
    {
        // Anonymous throughout: there is no customer yet, so there is nobody to authenticate
        // as. The application's Guid is the capability that lets a browser return to its own
        // draft, and no route reads an application back, so there is no enumeration surface.
        var group = routes.MapGroup("/api/v1/onboarding/applications").WithTags("Onboarding");

        group.MapPost("/", async (
                StartOnboardingRequest request,
                OnboardingService service,
                PeakPowerDbContext db,
                CancellationToken ct) =>
            {
                var started = await service.StartAsync(
                    request.FirstName, request.LastName, request.Email,
                    request.Password, request.TermsAccepted, ct);

                if (!started.IsSuccess) return Unprocessable(started.Error);

                db.OnboardingApplications.Add(started.Value);
                await db.SaveChangesAsync(ct);

                var response = Describe(started.Value);
                return Results.Created($"/api/v1/onboarding/applications/{response.Id}", response);
            })
            .AllowAnonymous()
            .WithName("StartOnboarding")
            .WithSummary("Begin an application with the applicant's details and password.");

        group.MapPatch("/{id:guid}", async (
                Guid id,
                SaveOnboardingStepRequest request,
                PeakPowerDbContext db,
                CancellationToken ct) =>
            {
                var application = await db.OnboardingApplications
                    .SingleOrDefaultAsync(a => a.Id == id, ct);
                if (application is null) return Results.NotFound();

                var applied = ApplyStep(application, request);
                if (!applied.IsSuccess) return Unprocessable(applied.Error);

                await db.SaveChangesAsync(ct);
                return Results.Ok(Describe(application));
            })
            .AllowAnonymous()
            .WithName("SaveOnboardingStep")
            .WithSummary("Save one step's answers.");

        group.MapPost("/{id:guid}/signatories", async (
                Guid id,
                SubmitSignatoriesRequest request,
                OnboardingService service,
                PeakPowerDbContext db,
                CancellationToken ct) =>
            {
                var application = await db.OnboardingApplications
                    .SingleOrDefaultAsync(a => a.Id == id, ct);
                if (application is null) return Results.NotFound();

                var applicantEmail = application.Email;
                var signatories = request.Signatories
                    .Select(s => new OnboardingSignatory(
                        s.FirstName, s.LastName, s.Email,
                        IsApplicant: string.Equals(
                            s.Email, applicantEmail, StringComparison.OrdinalIgnoreCase)))
                    .ToList();

                var set = application.SetSignatories(signatories);
                if (!set.IsSuccess) return Unprocessable(set.Error);

                var issued = await service.IssueAndSendSignCodeAsync(application, ct);
                if (!issued.IsSuccess) return Unprocessable(issued.Error);

                await db.SaveChangesAsync(ct);
                return Results.Accepted(
                    $"/api/v1/onboarding/applications/{id}", Describe(application));
            })
            .AllowAnonymous()
            .WithName("SubmitSignatories")
            .WithSummary("Name everyone who must sign, and send them the code.");

        group.MapPost("/{id:guid}/sign", async (
                Guid id,
                SignOnboardingRequest request,
                OnboardingService service,
                CancellationToken ct) =>
            {
                var result = await service.SignAsync(id, request.Code, request.AgreedDocuments, ct);

                if (!result.IsSuccess)
                {
                    return result.Error == "That application does not exist."
                        ? Results.NotFound()
                        : Unprocessable(result.Error);
                }

                return Results.Ok(new SignedOnboardingResponse(
                    result.Value.CustomerId,
                    result.Value.AccountId,
                    result.Value.Username,
                    result.Value.CustomerStatus));
            })
            .AllowAnonymous()
            .WithName("SignOnboarding")
            .WithSummary("Verify the code and create the company.");

        group.MapPost("/{id:guid}/bank-verification/simulate", async (
                Guid id,
                PeakPowerDbContext db,
                IHostEnvironment environment,
                PeakPower.Application.Abstractions.IMarketCalendar calendar,
                CancellationToken ct) =>
            {
                // Slice 1 has no payment rail — iDEAL and bank feeds are F07 and out of scope —
                // so this stands in for the demo's "Mark € 0,01 as received" button and exists
                // only in Development. Without it the Active half of the demo's two outcomes
                // could never be demonstrated.
                if (!environment.IsDevelopment()) return Results.NotFound();

                var application = await db.OnboardingApplications
                    .SingleOrDefaultAsync(a => a.Id == id, ct);
                if (application is null) return Results.NotFound();

                application.MarkBankVerified(calendar.UtcNow);
                await db.SaveChangesAsync(ct);

                return Results.Ok(new { bankVerifiedAt = application.BankVerifiedAt });
            })
            .AllowAnonymous()
            .WithName("SimulateBankVerification")
            .WithSummary("Development only: pretend the € 0,01 arrived.");

        return routes;
    }

    // Shared contract §5.2 — the wire spelling is the database spelling, so DRAFT and
    // AWAITING_SIGNATURE, never the PascalCase .ToString() of the enum.
    private static OnboardingApplicationResponse Describe(OnboardingApplication application) =>
        new(application.Id, application.Reference, EnumWireFormat.ToWire(application.Status));

    private static IResult Unprocessable(string detail) =>
        Results.Problem(
            title: "That answer cannot be accepted",
            detail: detail,
            statusCode: StatusCodes.Status422UnprocessableEntity);

    private static Result<OnboardingApplication> ApplyStep(
        OnboardingApplication application, SaveOnboardingStepRequest request) =>
        request.Step switch
        {
            2 => Enum.TryParse<LegalEntityType>(request.LegalEntityType, out var entity)
                ? application.ApplyCompany(request.OrganizationName, entity, request.KvkNumber)
                : Result<OnboardingApplication>.Failure("Choose a legal entity type."),

            3 => application.ApplyRegisteredAddress(ToAddress(request.RegisteredAddress)),

            4 => application.ApplyIndustry(request.Industry),

            5 => Enum.TryParse<FlowDirection>(request.FlowDirection, out var flow)
                 && Enum.TryParse<VolumeBand>(request.VolumeBand, out var band)
                ? application.ApplyVolume(flow, band)
                : Result<OnboardingApplication>.Failure(
                    "Pick the band that matches your yearly volume."),

            6 => application.ApplyBankAccount(request.Iban, request.BankAccountHolder),

            7 => Enum.TryParse<SigningAuthority>(request.SigningAuthority, out var authority)
                ? application.ApplySigningAuthority(authority)
                : Result<OnboardingApplication>.Failure("Choose one option to continue."),

            _ => Result<OnboardingApplication>.Failure(
                "That step does not accept answers through this endpoint."),
        };

    private static Address? ToAddress(OnboardingAddressDto? dto) =>
        dto is null
            ? null
            : new Address(dto.Street, dto.HouseNumber, dto.HouseNumberSuffix,
                          dto.PostalCode, dto.City, dto.Country);
}
```

Add to `src/Hosts/PeakPower.Api.Customer/Program.cs`, beside `app.MapAuthEndpoints();`:

```csharp
app.MapOnboardingEndpoints();
```

with the using:

```csharp
using PeakPower.Api.Customer.Onboarding;
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~OnboardingEndpointTests"`
Expected: PASS — 5 passed

- [ ] **Step 6: Restore the allow-list test to an exact match**

Now that every anonymous route exists, change the assertion in
`tests/PeakPower.Integration.Tests/Auth/AnonymousEndpointAllowListTests.cs` back from
`BeSubsetOf` to the exact form:

```csharp
        anonymous.ShouldBe(Expected,
            "an endpoint that skips CustomerSessionMiddleware runs with RLS disabled");
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~AnonymousEndpointAllowListTests"`
Expected: PASS — 1 passed

- [ ] **Step 7: Wire the customer API into the AppHost**

Modify `src/Hosts/PeakPower.AppHost/AppHost.cs` — add beside the existing `employee-api`
registration:

```csharp
var customerApi = builder.AddProject<Projects.PeakPower_Api_Customer>("customer-api")
    .WithReference(peakpowerDb)
    .WaitForCompletion(migrator);
```

> `peakpowerDb` and `migrator` are plan 1's variable names for the database resource and the
> migrator project. `WaitForCompletion(migrator)` is what makes migrations finish before the API
> accepts a request; the design calls that out as a bring-up requirement.

- [ ] **Step 8: Run the whole platform test suite**

Run: `dotnet test`
Expected: PASS — every project green: Domain, Application, Integration, Architecture

- [ ] **Step 9: Bring the stack up and sign a real application by hand**

```bash
./dev-up
```

In the Aspire dashboard, open `customer-api`'s logs, then from another terminal:

Take `customer-api`'s HTTPS endpoint from the dashboard's Resources table and use it as
`$BASE` — Aspire assigns the port, so it is not fixed:

```bash
BASE=https://localhost:<port-from-the-dashboard>

curl -skX POST "$BASE/api/v1/onboarding/applications" \
  -H 'content-type: application/json' \
  -d '{"firstName":"Peter","lastName":"de Vries","email":"p.devries@vandersteen.nl","password":"correct-horse-battery","termsAccepted":true}'
```

Follow the wizard through `PATCH` steps 2 to 7 and `POST /signatories`, read the six-digit code
out of the `customer-api` log (the `ConsoleEmailSender` prints it), then `POST /sign`. Confirm
the log shows one email per signatory and that `POST /api/v1/auth/sign-in` with the same
credentials returns a token.

- [ ] **Step 10: Commit**

```bash
git add src/Core/PeakPower.Contracts/Customer/Onboarding/OnboardingContracts.cs \
        src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingEndpoints.cs \
        src/Hosts/PeakPower.Api.Customer/Program.cs \
        src/Hosts/PeakPower.AppHost/AppHost.cs \
        tests/PeakPower.Integration.Tests
git commit -m "feat(onboarding): expose the wizard over HTTP and run the customer API in Aspire"
```

---

## Definition of done

1. `dotnet test` is green across `PeakPower.Domain.Tests`, `PeakPower.Application.Tests`,
   `PeakPower.Integration.Tests` and `PeakPower.Architecture.Tests`.
2. `GET /.well-known/jwks.json` serves exactly one P-256 `use: "sig"`, `alg: "ES256"` key, and
   the document contains no `d` member.
3. A signed-in account's access token carries `sub`, `customer_id`, `is_admin`, `amr` and
   `stamp`, expires in 15 minutes, and is signed ES256.
4. **`SecurityStampTests.Bumping_the_security_stamp_kills_the_token_on_the_very_next_call`
   passes** — design DoD 7, and `[F01-R16]` satisfied against a stateless token.
5. The refresh cookie is `pp_refresh`, HttpOnly, Secure, `SameSite=Strict`, path
   `/api/v1/auth/refresh`; refresh rotates it, a used token cannot be presented twice, and a
   replay revokes the entire chain.
6. `POST /auth/password-reset/requests` returns 202 with a byte-identical body for a real and a
   fictitious address; completion bumps the security stamp and revokes every refresh token —
   design DoD 8.
7. Repeated sign-in failures are answered progressively more slowly, capped at 8 seconds; no
   account is ever locked.
8. `AnonymousEndpointAllowListTests` passes with `BeEquivalentTo`, so the set of anonymous
   endpoints is exactly the ten named in the test.
9. Plan 2's architecture fact 6 stays green with this plan's code in the tree: `JwtCustomerContext`
   and `CustomerSessionMiddleware` are the only new types that touch `ClaimsPrincipal` or
   `IHttpContextAccessor`, and both live in `PeakPower.Infrastructure.Web`. No type in
   `PeakPower.Api.Customer` references `System.Security.Claims`.
10. The ten-step wizard runs end to end over HTTP: an application is started, steps 2 to 7 save,
    signatories submit, a real generated code arrives through `IEmailSender`, and signing creates
    `customer` + `customer_account` + `wallet` in one transaction.
11. Signing is idempotent — a second `POST /sign` returns the same three ids and creates nothing.
12. A wrong code creates nothing, and five wrong codes burn the code permanently.
13. The materialised company is `Active` when the bank account was verified and `Prospect` when
    it was not; the account is `Active` and `IsAdmin` either way.
14. `POST /auth/sign-in` with the credentials chosen during onboarding returns a token — the
    handover the customer portal (plan 6) depends on.
15. Migration 3 applies to an empty PostgreSQL 17 container, `customer.refresh_token` carries a
    tenant-isolation policy, and `app_customer_role` is granted nothing on
    `customer.password_reset_token` or `customer.onboarding_application`.
16. `./dev-up` starts `customer-api` as an Aspire resource that waits for the migrator.

---

## New names introduced

Names this plan invents that the shared contract does not define. The consistency pass should
check these against the other five plans.

### Types

| Name | Signature | Home |
| --- | --- | --- |
| `Argon2idPasswordHasher` | `sealed class Argon2idPasswordHasher : IPasswordHasher` | `PeakPower.Infrastructure.Identity` |
| `ISigningKeyStore` | `string KeyId { get; }` · `ECDsaSecurityKey SigningKey { get; }` · `ECDsaSecurityKey PublicKey { get; }` · `JwksDocument PublicJwks { get; }` | `PeakPower.Infrastructure.Identity` |
| `FileSigningKeyStore` | `sealed class FileSigningKeyStore(string filePath) : ISigningKeyStore, IDisposable` | `PeakPower.Infrastructure.Identity` |
| `JwksDocument` | `sealed record JwksDocument(IReadOnlyList<JwkDocument> Keys)` | `PeakPower.Infrastructure.Identity` |
| `JwkDocument` | `sealed record JwkDocument(string Kty, string Crv, string Use, string Alg, string Kid, string X, string Y)` | `PeakPower.Infrastructure.Identity` |
| `JwtTokenIssuer` | `sealed class JwtTokenIssuer(ISigningKeyStore, IMarketCalendar) : ITokenIssuer` · `const string Issuer = "https://peakpower.local/customer"` · `const string Audience = "peakpower-customer-api"` | `PeakPower.Infrastructure.Identity` |
| `CustomerTokenValidation` | `static TokenValidationParameters Parameters(ISigningKeyStore keys)` | `PeakPower.Infrastructure.Identity` |
| `OpaqueToken` | `static string Create()` · `static string HashOf(string token)` · `static bool Matches(string token, string hash)` · `const int Bytes = 32` | `PeakPower.Infrastructure.Identity` |
| `ConsoleEmailSender` | `sealed class ConsoleEmailSender(ILogger<ConsoleEmailSender>) : IEmailSender` | `PeakPower.Infrastructure.Email` |
| `RefreshToken` | `sealed class` · `static RefreshToken Issue(Guid accountId, string tokenHash, DateTimeOffset issuedAt, DateTimeOffset expiresAt)` · `bool IsUsable(DateTimeOffset at)` · `void MarkUsed(DateTimeOffset at, Guid replacedByTokenId)` · `void Revoke(DateTimeOffset at)` | `PeakPower.Domain.Customers` |
| `PasswordResetToken` | `sealed class` · `static PasswordResetToken Issue(Guid accountId, string tokenHash, DateTimeOffset issuedAt, DateTimeOffset expiresAt)` · `bool IsUsable(DateTimeOffset at)` · `void MarkUsed(DateTimeOffset at)` | `PeakPower.Domain.Customers` |
| `OnboardingStatus` | `enum { Draft, AwaitingSignature, Signed }` — db `DRAFT \| AWAITING_SIGNATURE \| SIGNED` | `PeakPower.Domain.Onboarding` |
| `LegalEntityType` | `enum { BV, NV, Eenmanszaak, VOF, Maatschap, CV, Stichting, Vereniging, Cooperatie }` | `PeakPower.Domain.Onboarding` |
| `FlowDirection` | `enum { Consumption, Production, Both }` | `PeakPower.Domain.Onboarding` |
| `VolumeBand` | `enum { UpTo250Mwh, From250To500Mwh, From500To1000Mwh, From1000To2500Mwh, Above2500Mwh }` | `PeakPower.Domain.Onboarding` |
| `SigningAuthority` | `enum { Alone, Jointly, SomeoneElse }` | `PeakPower.Domain.Onboarding` |
| `OnboardingReferenceData` | `static IReadOnlyList<string> Industries` · `const string NotSpecified` · `static string DisplayName(LegalEntityType)` · `static string DisplayName(VolumeBand)` · `static string DisplayName(SigningAuthority)` · `static string Note(SigningAuthority)` · `static int MinimumSignatories(SigningAuthority)` | `PeakPower.Domain.Onboarding` |
| `OnboardingSignatory` | `sealed record OnboardingSignatory(string FirstName, string LastName, string Email, bool IsApplicant)` | `PeakPower.Domain.Onboarding` |
| `OnboardingApplication` | `sealed class` — full member list in Tasks 15–17 | `PeakPower.Domain.Onboarding` |
| `JwtCustomerContext` | `sealed class JwtCustomerContext(IHttpContextAccessor) : ICustomerContext` | `PeakPower.Infrastructure.Web.Tenancy` |
| `CustomerSessionMiddleware` | `sealed class CustomerSessionMiddleware(RequestDelegate)` · `IApplicationBuilder UseCustomerSession(this IApplicationBuilder)` | `PeakPower.Infrastructure.Web.Tenancy` |
| `ISignInThrottle` | `TimeSpan DelayFor(string username, string source)` · `void RecordFailure(string username, string source)` · `void RecordSuccess(string username, string source)` | `PeakPower.Api.Customer.Auth` |
| `InMemorySignInThrottle` | `sealed class InMemorySignInThrottle(IMarketCalendar) : ISignInThrottle` · `static readonly TimeSpan Window` · `static readonly IReadOnlyList<TimeSpan> Curve` | `PeakPower.Api.Customer.Auth` |
| `RefreshCookie` | `const string Name = "pp_refresh"` · `const string Path = "/api/v1/auth/refresh"` · `static void Write(HttpResponse, string, DateTimeOffset)` · `static void Clear(HttpResponse)` | `PeakPower.Api.Customer.Auth` |
| `AuthEndpoints` | `static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder)` | `PeakPower.Api.Customer.Auth` |
| `OnboardingService` | `sealed class OnboardingService(PeakPowerDbContext, IPasswordHasher, IEmailSender, IMarketCalendar)` · `static readonly TimeSpan SignCodeLifetime` · `static string NewSignCode()` · the three async methods in Task 17 | `PeakPower.Api.Customer.Onboarding` |
| `SignedOnboardingResult` | `sealed record SignedOnboardingResult(Guid CustomerId, Guid AccountId, Guid WalletId, string Username, string CustomerStatus)` | `PeakPower.Api.Customer.Onboarding` |
| `OnboardingEndpoints` | `static IEndpointRouteBuilder MapOnboardingEndpoints(this IEndpointRouteBuilder)` | `PeakPower.Api.Customer.Onboarding` |
| `CustomerApiFactory` | `sealed class CustomerApiFactory : WebApplicationFactory<CustomerApiEntryPoint>, IAsyncLifetime` · `CreateAnonymousClient()` · `CreateOwnerDbContext()` · `SeedCustomerWithAccountAsync(...)` · `ConnectionString` | `PeakPower.Integration.Tests` |

### Contracts (`PeakPower.Contracts`)

| Name | Signature |
| --- | --- |
| `CurrentAccountResponse` | `(Guid AccountId, Guid CustomerId, string FirstName, string LastName, string Email, bool IsAdmin)` |
| `SignInRequest` | `(string Username, string Password)` |
| `SignInResponse` | `(string AccessToken, DateTimeOffset ExpiresAt, CurrentAccountResponse Account)` |
| `PasswordResetRequest` | `(string Email)` |
| `PasswordResetCompletion` | `(string Token, string NewPassword)` |
| `PasswordPolicy` | `const int MinimumLength = 12` · `static bool IsAcceptable(string? password)` |
| `StartOnboardingRequest` | `(string FirstName, string LastName, string Email, string Password, bool TermsAccepted)` |
| `OnboardingAddressDto` | `(string Street, string HouseNumber, string? HouseNumberSuffix, string PostalCode, string City, string Country)` |
| `SaveOnboardingStepRequest` | `(int Step, string? OrganizationName, string? LegalEntityType, string? KvkNumber, OnboardingAddressDto? RegisteredAddress, string? Industry, string? FlowDirection, string? VolumeBand, string? Iban, string? BankAccountHolder, string? SigningAuthority)` |
| `SignatoryDto` | `(string FirstName, string LastName, string Email)` |
| `SubmitSignatoriesRequest` | `(IReadOnlyList<SignatoryDto> Signatories)` |
| `SignOnboardingRequest` | `(string Code, bool AgreedDocuments)` |
| `OnboardingApplicationResponse` | `(Guid Id, string Reference, string Status)` |
| `SignedOnboardingResponse` | `(Guid CustomerId, Guid AccountId, string Username, string CustomerStatus)` — `CustomerStatus` carries the database spelling, `ACTIVE` / `PROSPECT` |

### Members added to types the shared contract defines

None. Shared contract §5.1 makes plan 1 the only plan that declares an aggregate's members, so
everything this plan needs on `Customer`, `CustomerAccount` and `Wallet` is listed under
**Names assumed from other plans** instead.

### Names assumed from other plans

These are **not** invented here — this plan consumes them and needs the consistency pass to
confirm the spelling.

| Name | Assumed signature | Assumed owner |
| --- | --- | --- |
| `PeakPowerDbContext` | `PeakPower.Persistence.PeakPowerDbContext` with `DbSet<Customer> Customers`, `DbSet<CustomerAccount> CustomerAccounts` | Plan 1 |
| `Customer.Create` | `static Result<Customer> Create(string legalName, string? tradeName, KvkNumber kvkNumber, string? vatNumber, Address billingAddress, Address? visitingAddress, ContactPerson primaryContact, string? internalReference, string locale)` — contract §5.1 | Plan 1 |
| `Customer.ChangeStatus` | `Result<Customer> ChangeStatus(CustomerStatus status)` — contract §5.1 | Plan 1 |
| `CustomerAccount.Create` | `static Result<CustomerAccount> Create(Guid customerId, string username, string firstName, string lastName, string? jobTitle, string email, string? phone, AccountStatus status, bool isAdmin)` — contract §5.1 | Plan 1 |
| `CustomerAccount.SetPassword` | `void SetPassword(string passwordHash)` — bumps `SecurityStamp`; contract §5.1 | Plan 1 |
| `CustomerAccount.BumpSecurityStamp` | `void BumpSecurityStamp()` — contract §5.1 | Plan 1 |
| `CustomerAccount.RecordSuccessfulSignIn` | `void RecordSuccessfulSignIn(DateTimeOffset at)` — contract §5.1 | Plan 1 |
| `Wallet` | `PeakPower.Domain.Wallets.Wallet` with `static Result<Wallet> CreateEuroWallet(Guid customerId)`, its `WalletConfiguration` and `PeakPowerDbContext.Wallets` — contract §3.2, §5.1 | Plan 1 |
| `CustomerApiEntryPoint` | `public sealed class CustomerApiEntryPoint;` in `PeakPower.Api.Customer` — the type `WebApplicationFactory<T>` binds to; contract §5.1 | Plan 1 |
| `IPasswordHasher` · `ITokenIssuer` · `AccessToken` · `IEmailSender` | declared in `PeakPower.Application.Abstractions`; contract §6 | Plan 1 |
| `PeakPower.Infrastructure.Identity` · `PeakPower.Infrastructure.Email` · `PeakPower.Infrastructure.Web` | the three infrastructure projects this plan fills; contract §3.1 | Plans 1 and 2 |
| `EnumWireFormat` | `PeakPower.Infrastructure.Web.Http.EnumWireFormat` — `JsonStringEnumConverter Converter`, `string ToWire<TEnum>(TEnum)`; contract §5.2 | Plan 2 |
| `InitialSchema` · `TenancyRowLevelSecurity` | migrations 1 and 2, which migration 3 lands on top of; contract §3.2 | Plans 1 and 2 |
| `app_customer_role` | PostgreSQL role, member of the API's login role, with the tenant policies on `customer.*` | Plan 2 |
| `app.customer_id` | The `SET LOCAL` setting the RLS policies read | Plan 2 |
| `PeakPower.ServiceDefaults` | `IHostApplicationBuilder.AddServiceDefaults()` · `WebApplication.MapDefaultEndpoints()` | Plan 1 |
| AppHost variables | `peakpowerDb`, `migrator` | Plan 1 |
