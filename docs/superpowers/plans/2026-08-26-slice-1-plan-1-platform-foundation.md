# Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the two empty repositories, the .NET solution, the architecture guard rails,
the domain layer, migration 1 against real PostgreSQL 17, the Aspire AppHost and `dev-up`, so
that every later slice-1 plan has a compiling, migrating, orchestrated platform to build on.

**Architecture:** A layered .NET 10 solution — `PeakPower.Domain` depends on nothing,
`PeakPower.Application` depends only on `PeakPower.Domain`, and hosts reference infrastructure
solely to register it in dependency injection at the composition root. Those three rules are
enforced from week one by executable architecture facts rather than by convention — four of the
six here, and the two that need plan 2's query filters and context-provider assembly there.
PostgreSQL is the source of truth for the hard invariants (an EAN may serve different customers
over non-overlapping periods, and the database rejects overlaps), and .NET Aspire brings up
Postgres, the migrator, the two API hosts and — once they exist — the two Angular front-ends
with a single `./dev-up` from either repository.

**Tech Stack:** .NET SDK 10.0.400 · C# `latest` · EF Core 10.0.11 ·
Npgsql.EntityFrameworkCore.PostgreSQL 10.0.3 · EFCore.NamingConventions 10.0.1 ·
PostgreSQL 17 · .NET Aspire 13.5.3 (`aspire.cli` global tool + `Aspire.AppHost.Sdk`) ·
xUnit v3 3.2.2 · FluentAssertions 7.2.0 · NSubstitute 6.2.0 · NetArchTest.Rules 1.3.2 ·
Mono.Cecil 0.11.6 · Testcontainers.PostgreSql 4.14.0 · Node 24.15.0 / npm 11.12.1 ·
Docker 29.7.2

**Spec:** `docs/superpowers/specs/2026-08-26-poc-slice-1-design.md`
**Shared contract:** `docs/superpowers/plans/2026-08-26-slice-1-shared-contract.md`

## Global Constraints

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
not one converter per property.

### Module rules — the three rules, enforced in week 1

`Domain` references nothing. `Application` references only `Domain` and defines ports.
Hosts reference infrastructure solely to register it in DI at the composition root.

**Architecture facts that must exist from week 1:**

1. `PeakPower.Domain` references no other project
2. `PeakPower.Application` references only `PeakPower.Domain`
3. `PeakPower.Ingestion` (when it exists) references no `Brp.*` adapter
4. No type calls `IgnoreQueryFilters()`
5. No type outside `PeakPower.Infrastructure.Time` uses `DateTime.Now` / `DateTime.UtcNow`
6. No type outside `PeakPower.Infrastructure.Web` uses `IHttpContextAccessor` or reads a claim
   off `ClaimsPrincipal` / `ClaimsIdentity`

Contract §13 splits the ownership: **this plan writes facts 1, 2, 3 and 5; plan 2 writes facts 4
and 6**, because neither the query filters fact 4 protects nor the context-provider assembly
fact 6 fences exists until plan 2 lands. Plan 1 leaves plan 2 the `AssemblyProbe` those two
facts scan with.

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

### Testing tooling

| Layer | Tooling |
| --- | --- |
| Domain / Application unit | xUnit + **FluentAssertions 7.2.0** (+ NSubstitute for ports) — 7.x is pinned because 8.x is licensed for non-commercial use only; see the note in `Directory.Packages.props` |
| Persistence & integration | Testcontainers, real PostgreSQL 17 |
| Architecture | NetArchTest |
| OpenAPI contract | Verify snapshot |
| Frontend unit | Vitest |
| E2E | Playwright, in `peakpower-web` |

### HTTP

- Base path `/api/v1`; errors are RFC 7807 `application/problem+json`
- Cross-tenant reads return **404, never 403** `[F13-R19]`

---

## Scope boundary for this plan

This is **plan 1 of 6**. It builds the solution skeleton, architecture facts 1, 2, 3 and 5,
`PeakPower.Domain`, the `PeakPower.Application` ports, `PeakPower.Persistence` with migration 1,
`PeakPower.Migrator`, `PeakPower.ServiceDefaults`, the two empty API hosts, `PeakPower.AppHost`,
`PeakPower.Infrastructure.Time`, the three empty infrastructure projects contract §3.1 names
(`Web`, `Identity`, `Email`), and `dev-up` in both repositories.

It deliberately does **not** build: tenancy (`ICustomerContext`, query filters, RLS,
404-not-403 — plan 2), any `/api/v1` endpoint (plan 2), authentication or onboarding (plan 5),
architecture facts 4 and 6 (plan 2 owns both — contract §13 — because neither can be written
before the query filters and the context-provider assembly exist), or any Angular code
(plans 3, 4, 6).

**Two places where this plan follows the shared contract rather than the design:**

1. Design §4.2's tree names thirteen source projects, four of them infrastructure projects the
   design had left implicit. Contract §3.1 is the normative list and this plan builds every one
   of them, plus the fifth test project `PeakPower.AppHost.Tests`. Three of the infrastructure
   projects — `Web`, `Identity` and `Email` — are created empty here and filled by plans 2
   and 5, because a project invented mid-plan gets invented in the wrong place.
2. Design §5.1 puts nine tables in migration 1. This plan's migration 1 creates six —
   `customer.customer`, `customer.customer_account`, `customer.metering_point`,
   `metering.brp`, `wallet.wallet`, `audit.audit_record`. The three auth/onboarding tables
   (`customer.onboarding_application`, `customer.refresh_token`,
   `customer.password_reset_token`) belong to plan 5, which owns their column sets, and land in
   **migration 3** (contract §3.2; migration 2 is plan 2's row-level security). Migrations are
   forward-only and additive `[design §5.2]`, so this
   costs nothing and avoids inventing a twenty-column onboarding table that plan 5 would
   immediately rewrite.

## Domain terms used in this plan

Assume no knowledge of Dutch energy trading. The words that appear below mean:

- **EAN** — the eighteen-digit code that identifies one electricity connection point in the
  Dutch grid. It is the thing a customer's electricity bill is about. In slice 1 we validate
  the length only, not the GS1 check digit `[DEC-114]`.
- **Metering point / connection** — one EAN belonging to one customer for one period. The same
  EAN can move between customers over time, which is why the validity period matters.
- **BRP (Balance Responsible Party)** — the market participant answerable to the Dutch grid
  operator for a connection's imbalance. Every metering point must name one `[F01-R51]`.
- **KvK number** — the eight-digit Dutch Chamber of Commerce company registration number.
- **IBAN** — international bank account number; its last check is the ISO 7064 mod-97 test.
- **Grid operator** — the regional network company that physically owns the cable.
- **Tenancy** — one customer company must never see another's data. Not built here; plan 2.

---

## File Structure

### `/Users/thinhhuynh/PeakPower/peakpower-platform`

| File | Responsibility |
| --- | --- |
| `.gitignore` | .NET build output, user secrets, IDE noise |
| `docs/entra-tenant-access-request.md` | the week-1 non-code deliverable: owner, date, status |
| `global.json` | pins SDK 10.0.400 |
| `Directory.Build.props` | `net10.0`, nullable, warnings-as-errors, analyzers, one place |
| `Directory.Packages.props` | every NuGet version, central package management |
| `PeakPower.sln` | the solution (classic `.sln` format, not `.slnx`) |
| `dev-up` | one-command bring-up from the platform side |
| `tools/dev-up.test.sh` | asserts `dev-up`'s loud failure when the web checkout is missing |
| `tools/verify-repositories.sh` | asserts both repositories are git repos on `main` with no remotes |
| `tools/verify-build-settings.sh` | asserts the solution-wide build settings and pinned versions |
| `tools/verify-solution-layout.sh` | asserts the eighteen projects exist and the solution builds |
| `tools/verify-aspire-api.sh` | asserts the Aspire 13.5.3 API surface we depend on |
| `tools/verify-migrator.sh` | runs the migrator host against a throwaway Postgres 17 |
| `artifacts/openapi/.gitkeep` | where plan 2 emits `customer.json` and `employee.json` |
| `src/Core/PeakPower.Domain/Common/Result.cs` | `Result<T>` — validation without exceptions |
| `src/Core/PeakPower.Domain/Common/EanCode.cs` | 18-digit EAN, grouped display form |
| `src/Core/PeakPower.Domain/Common/KvkNumber.cs` | 8-digit Chamber of Commerce number |
| `src/Core/PeakPower.Domain/Common/Iban.cs` | structural + ISO 7064 mod-97 |
| `src/Core/PeakPower.Domain/Common/Address.cs` | address record, stored as jsonb |
| `src/Core/PeakPower.Domain/Common/ContactPerson.cs` | contact record, stored as jsonb |
| `src/Core/PeakPower.Domain/Customers/Enums.cs` | the seven enums, database spelling normative |
| `src/Core/PeakPower.Domain/Customers/Customer.cs` | the company aggregate root |
| `src/Core/PeakPower.Domain/Customers/CustomerAccount.cs` | one person's login, aggregate root |
| `src/Core/PeakPower.Domain/Customers/MeteringPoint.cs` | one EAN for one period, aggregate root |
| `src/Core/PeakPower.Domain/Metering/Brp.cs` | balance responsible party reference row |
| `src/Core/PeakPower.Domain/Wallets/Wallet.cs` | one EUR wallet per customer (stub) |
| `src/Core/PeakPower.Domain/Auditing/AuditRecord.cs` | append-only actor + before/after |
| `src/Core/PeakPower.Domain/AssemblyMarker.cs` | anchor for architecture tests |
| `src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs` | the only source of "now" |
| `src/Core/PeakPower.Application/Abstractions/IPasswordHasher.cs` | Argon2id port; plan 5 implements it |
| `src/Core/PeakPower.Application/Abstractions/ITokenIssuer.cs` | token port plus the `AccessToken` record |
| `src/Core/PeakPower.Application/Abstractions/IEmailSender.cs` | outbound mail port; plan 5 implements it |
| `src/Core/PeakPower.Application/AssemblyMarker.cs` | anchor for architecture tests |
| `src/Core/PeakPower.Contracts/AssemblyMarker.cs` | empty shell; plan 2 fills it with DTOs |
| `src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs` | the only clock reader |
| `src/Infrastructure/PeakPower.Infrastructure.Web/AssemblyMarker.cs` | the ONE context-provider assembly; plan 2 and plan 5 fill it |
| `src/Infrastructure/PeakPower.Infrastructure.Identity/AssemblyMarker.cs` | Argon2id and the token issuer; plan 5 fills it |
| `src/Infrastructure/PeakPower.Infrastructure.Email/AssemblyMarker.cs` | the console mail sink; plan 5 fills it |
| `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs` | the one DbContext |
| `src/Infrastructure/PeakPower.Persistence/DatabaseMigrator.cs` | applies migrations to completion |
| `src/Infrastructure/PeakPower.Persistence/PersistenceServiceCollectionExtensions.cs` | one DI entry point |
| `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContextFactory.cs` | design-time factory for `dotnet ef` |
| `src/Infrastructure/PeakPower.Persistence/Conversions/EnumToScreamingSnakeConverter.cs` | `PendingApproval` ⇄ `PENDING_APPROVAL` |
| `src/Infrastructure/PeakPower.Persistence/Conversions/EnumToTextConvention.cs` | applies it to every enum property |
| `src/Infrastructure/PeakPower.Persistence/Conversions/JsonbConverter.cs` | record ⇄ jsonb text |
| `src/Infrastructure/PeakPower.Persistence/Configurations/*.cs` | one file per aggregate |
| `src/Infrastructure/PeakPower.Persistence/Migrations/*_InitialSchema.cs` | migration 1 |
| `src/Hosts/PeakPower.ServiceDefaults/Extensions.cs` | OpenTelemetry, health checks, resilience |
| `src/Hosts/PeakPower.Api.Customer/Program.cs` | empty host; plan 5 and 6 fill it |
| `src/Hosts/PeakPower.Api.Employee/Program.cs` | empty host; plan 2 fills it |
| `src/Hosts/PeakPower.Migrator/Program.cs` | applies migrations and exits |
| `src/Hosts/PeakPower.AppHost/Program.cs` | the Aspire resource graph |
| `src/Hosts/PeakPower.AppHost/WebRootLocator.cs` | `PEAKPOWER_WEB_PATH` → sibling → loud failure |
| `src/Hosts/PeakPower.AppHost/AppHostOptions.cs` | the `--backend-only` flag |
| `tests/Directory.Build.props` | test-only analyzer relaxations |
| `tests/PeakPower.Domain.Tests/**` | value objects and aggregate invariants |
| `tests/PeakPower.Application.Tests/**` | ports; and `MarketCalendar` |
| `tests/PeakPower.Integration.Tests/**` | model shape, migration script, Testcontainers |
| `tests/PeakPower.Architecture.Tests/**` | the six facts |
| `tests/PeakPower.AppHost.Tests/**` | `WebRootLocator`, `AppHostOptions` |

### `/Users/thinhhuynh/PeakPower/peakpower-web`

| File | Responsibility |
| --- | --- |
| `.gitignore` | Node, Angular and editor noise |
| `dev-up` | one-command bring-up from the web side; delegates to the platform's `dev-up` |
| `tools/dev-up.test.sh` | asserts `dev-up`'s loud failure when the platform checkout is missing |

---

## Prerequisites — do this before Task 1

```bash
dotnet --version          # must print 10.0.400
node --version            # must print v24.15.0
npm --version             # must print 11.12.1
docker info > /dev/null   # must exit 0 — the daemon must be running
dotnet tool install -g aspire.cli
dotnet tool install -g dotnet-ef --version 10.0.11
```

`aspire.cli` and `dotnet-ef` install into `~/.dotnet/tools`. If `aspire` or `dotnet-ef` is not
found afterwards, add `~/.dotnet/tools` to `PATH`.

**Aspire is not a `dotnet workload`.** Do not run `dotnet workload install aspire`; it no longer
exists. Aspire 13.5.3 is the `aspire.cli` global tool plus the `Aspire.AppHost.Sdk` MSBuild SDK
referenced from the AppHost project file.

---

### Task 1: Both repositories, git-initialised with no remotes

Both target directories exist and are empty. This task makes them git repositories and gives
each an ignore file. **No remote is added** — slice 1 is local-only `[design §11]`.

It also carries the one non-code deliverable of week 1. Design §13 asks for the corporate Entra
tenant access request to be raised in week 1 with a named owner, because it has the longest lead
time in phase 1 and `[DEC-67]` forbids proving the claim mapping against a developer tenant —
there is no substitute and no way to shorten it. Design §11 predicts exactly how it gets missed:
*running locally is precisely the condition under which it gets forgotten.* Step 6 below is that
request, and definition-of-done item 13 is the check that it was actually raised.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/.gitignore`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-web/.gitignore`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/docs/entra-tenant-access-request.md`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-repositories.sh`

**Interfaces:**
- Consumes: nothing.
- Produces: two git repositories on branch `main` with no remotes, at
  `/Users/thinhhuynh/PeakPower/peakpower-platform` and
  `/Users/thinhhuynh/PeakPower/peakpower-web`.

- [ ] **Step 1: Write the failing test**

```bash
mkdir -p /Users/thinhhuynh/PeakPower/peakpower-platform/tools
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-repositories.sh`:

```bash
#!/usr/bin/env bash
# Asserts that both slice-1 repositories are git repositories on `main`, with no remotes,
# and that each ignores its build output. Slice 1 is local-only: a remote here is a defect.
set -uo pipefail

platform="/Users/thinhhuynh/PeakPower/peakpower-platform"
web="/Users/thinhhuynh/PeakPower/peakpower-web"
failures=0

fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }

for repo in "$platform" "$web"; do
  if [[ ! -d "$repo/.git" ]]; then
    fail "$repo is not a git repository"
    continue
  fi
  branch="$(git -C "$repo" symbolic-ref --quiet --short HEAD || echo '<detached>')"
  [[ "$branch" == "main" ]] || fail "$repo is on branch '$branch', expected 'main'"
  remotes="$(git -C "$repo" remote)"
  [[ -z "$remotes" ]] || fail "$repo has remotes configured: $remotes"
  [[ -f "$repo/.gitignore" ]] || fail "$repo has no .gitignore"
done

grep -q '^bin/$' "$platform/.gitignore" 2>/dev/null || fail "platform .gitignore does not ignore bin/"
grep -q '^node_modules/$' "$web/.gitignore" 2>/dev/null || fail "web .gitignore does not ignore node_modules/"

if [[ $failures -gt 0 ]]; then
  echo "verify-repositories: $failures check(s) failed" >&2
  exit 1
fi
echo "verify-repositories: OK"
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
chmod +x /Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-repositories.sh
/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-repositories.sh
```

Expected: FAIL with
`FAIL: /Users/thinhhuynh/PeakPower/peakpower-platform is not a git repository`

- [ ] **Step 3: Write the minimal implementation**

```bash
git init -b main /Users/thinhhuynh/PeakPower/peakpower-platform
git init -b main /Users/thinhhuynh/PeakPower/peakpower-web

cat > /Users/thinhhuynh/PeakPower/peakpower-platform/.gitignore <<'GITIGNORE'
# Build output
bin/
obj/

# artifacts/openapi is committed on purpose - it holds the OpenAPI documents plan 2 emits
# at build and the contract snapshot test compares against. Do not ignore it.

# User-specific and secrets
*.user
*.suo
secrets.json
.env
.env.local

# IDE
.vs/
.vscode/
.idea/
*.DotSettings.user

# Test output
TestResults/
*.trx
coverage.*.json
*.coverage

# OS
.DS_Store
GITIGNORE

cat > /Users/thinhhuynh/PeakPower/peakpower-web/.gitignore <<'GITIGNORE'
# Dependencies
node_modules/
.npm/

# Build output
dist/
.angular/
out-tsc/
*.tsbuildinfo

# Test and tooling output
coverage/
playwright-report/
test-results/
.vitest/

# Environment
.env
.env.local

# IDE
.vscode/
.idea/

# OS
.DS_Store
GITIGNORE
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-repositories.sh`
Expected: PASS — prints `verify-repositories: OK`

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add .gitignore tools/verify-repositories.sh
git commit -m "chore: initialise the platform repository with an ignore file"

cd /Users/thinhhuynh/PeakPower/peakpower-web
git add .gitignore
git commit -m "chore: initialise the web repository with an ignore file"
```

- [ ] **Step 6: Raise the corporate Entra tenant access request — non-code, and today**

No test precedes this one because there is nothing to assert about someone else's ticket queue.
Raise the request **before** starting Task 2, not at the end of the slice: nothing in slice 1
blocks on it, and that is precisely why it slips.

**Owner: Thinh Huynh** (`thinh@kikker.nl`). Ask the corporate IT service desk for a service
principal and app registration in the **corporate** Entra tenant, with permission to read the
claims PeakPower's employee sign-in will map — not a developer tenant, which `[DEC-67]` rules
out as evidence. Then record it, so the next person does not have to ask whether it was done:

```bash
mkdir -p /Users/thinhhuynh/PeakPower/peakpower-platform/docs
cd /Users/thinhhuynh/PeakPower/peakpower-platform
cat > docs/entra-tenant-access-request.md <<MD
# Corporate Entra tenant access request

Design §13's week-1 non-code deliverable. Longest lead time in phase 1; [DEC-67] forbids
proving the claim mapping against a developer tenant, so nothing here can be simulated.

- Owner: Thinh Huynh <thinh@kikker.nl>
- Raised: $(date -I)
- Asked of: corporate IT service desk
- Asked for: app registration and service principal in the corporate Entra tenant, with the
  claims the employee sign-in maps (\`oid\`, \`upn\`, group membership)
- Needed by: the slice that puts employee sign-in behind Entra. Slice 1 stores
  \`CustomerAccount.ExternalSubjectId\` as null and does not use it.
- Status: raised, awaiting the tenant administrator

Update the status line when it is granted. Until then this file is the answer to "did anyone
actually ask?"
MD
git add docs/entra-tenant-access-request.md
git commit -m "chore: record the corporate Entra tenant access request raised in week 1"
```

---

### Task 2: Solution skeleton and build settings

One place for the target framework, nullability, warnings-as-errors and analyzers; one place
for every NuGet version. The analyzer suppressions below are deliberate and minimal: with
`TreatWarningsAsErrors` on, `CA1000` (static members on a generic type) would reject
`Result<T>.Success`, and `CA1707` (underscores in identifiers) would reject every test name
written in the `Method_does_thing` style this plan uses.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/global.json`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/Directory.Build.props`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/Directory.Packages.props`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/Directory.Build.props`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/PeakPower.sln`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-build-settings.sh`

**Interfaces:**
- Consumes: the two git repositories from Task 1.
- Produces: `PeakPower.sln` in classic `.sln` format; central package management with every
  version this plan and plans 2–6 need; `net10.0`, `Nullable=enable`,
  `TreatWarningsAsErrors=true` for every project below the repository root.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-build-settings.sh`:

```bash
#!/usr/bin/env bash
# Asserts the solution-wide build settings the whole slice depends on.
set -uo pipefail

root="/Users/thinhhuynh/PeakPower/peakpower-platform"
failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }

[[ -f "$root/PeakPower.sln" ]] || fail "PeakPower.sln is missing (a .slnx is not acceptable)"
[[ -f "$root/global.json" ]] || fail "global.json is missing"
grep -q '"version": "10.0.400"' "$root/global.json" 2>/dev/null \
  || fail "global.json does not pin SDK 10.0.400"

props="$root/Directory.Build.props"
[[ -f "$props" ]] || fail "Directory.Build.props is missing"
grep -q '<TargetFramework>net10.0</TargetFramework>' "$props" 2>/dev/null \
  || fail "Directory.Build.props does not target net10.0"
grep -q '<Nullable>enable</Nullable>' "$props" 2>/dev/null \
  || fail "Directory.Build.props does not enable nullable reference types"
grep -q '<TreatWarningsAsErrors>true</TreatWarningsAsErrors>' "$props" 2>/dev/null \
  || fail "Directory.Build.props does not treat warnings as errors"
grep -q '<EnableNETAnalyzers>true</EnableNETAnalyzers>' "$props" 2>/dev/null \
  || fail "Directory.Build.props does not enable the .NET analyzers"

packages="$root/Directory.Packages.props"
[[ -f "$packages" ]] || fail "Directory.Packages.props is missing"
grep -q '<ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>' "$packages" 2>/dev/null \
  || fail "Directory.Packages.props does not turn on central package management"
for pinned in \
  'Include="Microsoft.EntityFrameworkCore" Version="10.0.11"' \
  'Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="10.0.3"' \
  'Include="Aspire.Hosting.AppHost" Version="13.5.3"' \
  'Include="Aspire.Hosting.JavaScript" Version="13.5.3"' \
  'Include="Testcontainers.PostgreSql" Version="4.14.0"' \
  'Include="NetArchTest.Rules" Version="1.3.2"' \
  'Include="FluentAssertions" Version="7.2.0"' ; do
  grep -q "$pinned" "$packages" 2>/dev/null || fail "Directory.Packages.props is missing: $pinned"
done

# FluentAssertions 8.x is licensed for non-commercial use only. This is a licence check, not a
# style preference, so it is asserted rather than left to a comment.
grep -q 'Include="FluentAssertions" Version="8' "$packages" 2>/dev/null \
  && fail "FluentAssertions 8.x is an Xceed non-commercial licence; pin 7.2.0"

if [[ $failures -gt 0 ]]; then
  echo "verify-build-settings: $failures check(s) failed" >&2
  exit 1
fi
echo "verify-build-settings: OK"
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
chmod +x /Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-build-settings.sh
/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-build-settings.sh
```

Expected: FAIL with `FAIL: PeakPower.sln is missing (a .slnx is not acceptable)`

- [ ] **Step 3: Write the minimal implementation**

`dotnet new sln` defaults to the XML `.slnx` format on SDK 10. The contract names
`PeakPower.sln`, so pass `--format sln` explicitly.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet new sln --name PeakPower --format sln

cat > global.json <<'JSON'
{
  "sdk": {
    "version": "10.0.400",
    "rollForward": "latestFeature"
  }
}
JSON

cat > Directory.Build.props <<'XML'
<Project>

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <LangVersion>latest</LangVersion>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <EnableNETAnalyzers>true</EnableNETAnalyzers>
    <AnalysisLevel>latest</AnalysisLevel>
    <AnalysisMode>Recommended</AnalysisMode>
    <GenerateDocumentationFile>false</GenerateDocumentationFile>
    <InvariantGlobalization>false</InvariantGlobalization>
  </PropertyGroup>

  <!--
    Deliberate suppressions. Everything else stays an error.
      CA1000 - static members on a generic type: Result<T>.Success / Result<T>.Failure are the
               contract's own shape (shared contract section 5).
      CA1031 - catching Exception: the Migrator host's top-level handler must turn any failure
               into a non-zero exit code, which is the whole point of a migration gate.
      CA1062 - null checks on public arguments: nullable reference types already carry this.
      CA1515 - "make this type internal": the domain types are public by design.
      CA1848 - LoggerMessage source generators: not worth it at slice-1 volumes.
      CA2007 - ConfigureAwait(false): no synchronisation context in ASP.NET Core or the console.
  -->
  <PropertyGroup>
    <NoWarn>$(NoWarn);CA1000;CA1031;CA1062;CA1515;CA1848;CA2007</NoWarn>
  </PropertyGroup>

</Project>
XML

cat > Directory.Packages.props <<'XML'
<Project>

  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>

  <ItemGroup Label="Aspire 13.5.3 - a CLI plus an MSBuild SDK, not a dotnet workload">
    <PackageVersion Include="Aspire.Hosting.AppHost" Version="13.5.3" />
    <PackageVersion Include="Aspire.Hosting.PostgreSQL" Version="13.5.3" />
    <PackageVersion Include="Aspire.Hosting.JavaScript" Version="13.5.3" />
  </ItemGroup>

  <ItemGroup Label="Entity Framework Core 10 and PostgreSQL">
    <PackageVersion Include="Microsoft.EntityFrameworkCore" Version="10.0.11" />
    <PackageVersion Include="Microsoft.EntityFrameworkCore.Design" Version="10.0.11" />
    <PackageVersion Include="Microsoft.EntityFrameworkCore.Relational" Version="10.0.11" />
    <PackageVersion Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="10.0.3" />
    <PackageVersion Include="Npgsql" Version="10.0.3" />
    <PackageVersion Include="EFCore.NamingConventions" Version="10.0.1" />
  </ItemGroup>

  <ItemGroup Label="Hosting, telemetry and resilience">
    <PackageVersion Include="Microsoft.Extensions.Hosting" Version="10.0.11" />
    <PackageVersion Include="Microsoft.Extensions.Logging.Abstractions" Version="10.0.11" />
    <PackageVersion Include="Microsoft.Extensions.Http.Resilience" Version="10.9.0" />
    <PackageVersion Include="Microsoft.Extensions.ServiceDiscovery" Version="10.9.0" />
    <PackageVersion Include="OpenTelemetry.Extensions.Hosting" Version="1.18.0" />
    <PackageVersion Include="OpenTelemetry.Exporter.OpenTelemetryProtocol" Version="1.18.0" />
    <PackageVersion Include="OpenTelemetry.Instrumentation.AspNetCore" Version="1.18.0" />
    <PackageVersion Include="OpenTelemetry.Instrumentation.Http" Version="1.18.0" />
    <PackageVersion Include="OpenTelemetry.Instrumentation.Runtime" Version="1.18.0" />
  </ItemGroup>

  <ItemGroup Label="Testing">
    <PackageVersion Include="Microsoft.NET.Test.Sdk" Version="18.9.0" />
    <PackageVersion Include="xunit.v3" Version="3.2.2" />
    <PackageVersion Include="xunit.runner.visualstudio" Version="3.1.5" />
    <!--
      Pinned to 7.x on purpose. FluentAssertions 8.x ships an Xceed Software Community License
      Agreement "for Non-Commercial Use"; PeakPower is a commercial trading platform, so 8.x
      would need a paid Xceed licence. 7.2.0 is the last Apache-2.0 release. Do not let
      `dotnet outdated` walk this forward.  [shared contract section 13]
    -->
    <PackageVersion Include="FluentAssertions" Version="7.2.0" />
    <PackageVersion Include="NSubstitute" Version="6.2.0" />
    <PackageVersion Include="NetArchTest.Rules" Version="1.3.2" />
    <PackageVersion Include="Mono.Cecil" Version="0.11.6" />
    <PackageVersion Include="Testcontainers.PostgreSql" Version="4.14.0" />
    <PackageVersion Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.11" />
    <PackageVersion Include="Microsoft.Extensions.TimeProvider.Testing" Version="10.9.0" />
    <PackageVersion Include="coverlet.collector" Version="10.0.1" />
  </ItemGroup>

</Project>
XML

mkdir -p tests
cat > tests/Directory.Build.props <<'XML'
<Project>

  <Import Project="$([MSBuild]::GetPathOfFileAbove('Directory.Build.props', '$(MSBuildThisFileDirectory)../'))" />

  <PropertyGroup>
    <IsPackable>false</IsPackable>
    <OutputType>Exe</OutputType>
    <!--
      Test-only relaxations.
        CA1707 - underscores in identifiers: test names read as sentences in this solution.
        CA1861 - constant arrays as arguments: normal and readable inside a test body.
        CA1034 - nested public types: xUnit fixtures and theory data classes.
        CA5394 - insecure randomness: tests use Random for sample data, never for secrets.
    -->
    <NoWarn>$(NoWarn);CA1707;CA1861;CA1034;CA5394</NoWarn>
  </PropertyGroup>

</Project>
XML

mkdir -p artifacts/openapi
touch artifacts/openapi/.gitkeep
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-build-settings.sh`
Expected: PASS — prints `verify-build-settings: OK`

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add global.json Directory.Build.props Directory.Packages.props PeakPower.sln \
        tests/Directory.Build.props tools/verify-build-settings.sh artifacts/openapi/.gitkeep
git commit -m "build: add the solution, SDK pin and central package versions"
```

---

### Task 3: The thirteen source projects, the five test projects, and the reference graph

Every project file is written by hand rather than generated from a template, because the
templates shipped with SDK 10 differ from what this solution needs (`dotnet new xunit` still
scaffolds xUnit v2, and there is no first-party Aspire AppHost template outside `aspire new`).

The reference graph below **is** architecture facts 1 and 2 expressed in MSBuild; Task 4 makes
them executable so they cannot decay.

**Files:**
- Create: eighteen `.csproj` files plus eight `AssemblyMarker.cs` files (listed in Step 3)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-solution-layout.sh`

Shared contract §3.1 names five infrastructure projects — `Persistence`, `Time`, `Web`,
`Identity` and `Email`. Three of them hold no code until a later plan fills them: plan 2 puts
its context providers in `PeakPower.Infrastructure.Web`, and plan 5 puts the Argon2id hasher
and the token issuer in `PeakPower.Infrastructure.Identity` and the console sink in
`PeakPower.Infrastructure.Email`. They are created here anyway, for the same reason
`PeakPower.Contracts` is: a project that has to be invented mid-plan gets invented in the wrong
place, and `PeakPower.Infrastructure.Web` in particular is the assembly architecture fact 6
fences.

**Interfaces:**
- Consumes: `Directory.Build.props`, `Directory.Packages.props`, `PeakPower.sln` from Task 2.
- Produces:
  - `PeakPower.Domain.AssemblyMarker`, `PeakPower.Application.AssemblyMarker`,
    `PeakPower.Contracts.AssemblyMarker`, `PeakPower.Persistence.AssemblyMarker`,
    `PeakPower.Infrastructure.Time.AssemblyMarker`, `PeakPower.Infrastructure.Web.AssemblyMarker`,
    `PeakPower.Infrastructure.Identity.AssemblyMarker`,
    `PeakPower.Infrastructure.Email.AssemblyMarker` — each `public sealed class AssemblyMarker;`,
    used by the architecture tests to obtain an `Assembly` without depending on a real type.
  - Eighteen projects in `PeakPower.sln` with this reference graph:

| Project | References |
| --- | --- |
| `PeakPower.Domain` | *(nothing)* |
| `PeakPower.Application` | `PeakPower.Domain` |
| `PeakPower.Contracts` | *(nothing)* |
| `PeakPower.Persistence` | `PeakPower.Application` |
| `PeakPower.Infrastructure.Time` | `PeakPower.Application` |
| `PeakPower.Infrastructure.Web` | `PeakPower.Application` |
| `PeakPower.Infrastructure.Identity` | `PeakPower.Application` |
| `PeakPower.Infrastructure.Email` | `PeakPower.Application` |
| `PeakPower.ServiceDefaults` | *(framework only)* |
| `PeakPower.Api.Customer` | `Application`, `Contracts`, `Persistence`, `Infrastructure.Time`, `Infrastructure.Web`, `Infrastructure.Identity`, `Infrastructure.Email`, `ServiceDefaults` |
| `PeakPower.Api.Employee` | `Application`, `Contracts`, `Persistence`, `Infrastructure.Time`, `Infrastructure.Web`, `ServiceDefaults` |
| `PeakPower.Migrator` | `Persistence`, `ServiceDefaults` |
| `PeakPower.AppHost` | `Api.Customer`, `Api.Employee`, `Migrator` |
| `PeakPower.Domain.Tests` | `Domain` |
| `PeakPower.Application.Tests` | `Application`, `Infrastructure.Time` |
| `PeakPower.Integration.Tests` | `Domain`, `Persistence`, `Api.Customer`, `Api.Employee` |
| `PeakPower.Architecture.Tests` | every source project **except** `AppHost` |
| `PeakPower.AppHost.Tests` | `AppHost` |

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-solution-layout.sh`:

```bash
#!/usr/bin/env bash
# Asserts that the eighteen slice-1 projects are in the solution and that the whole thing builds.
set -uo pipefail

root="/Users/thinhhuynh/PeakPower/peakpower-platform"
cd "$root" || exit 1
failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }

listing="$(dotnet sln PeakPower.sln list 2>/dev/null)"

expected=(
  "src/Core/PeakPower.Domain/PeakPower.Domain.csproj"
  "src/Core/PeakPower.Application/PeakPower.Application.csproj"
  "src/Core/PeakPower.Contracts/PeakPower.Contracts.csproj"
  "src/Infrastructure/PeakPower.Persistence/PeakPower.Persistence.csproj"
  "src/Infrastructure/PeakPower.Infrastructure.Time/PeakPower.Infrastructure.Time.csproj"
  "src/Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj"
  "src/Infrastructure/PeakPower.Infrastructure.Identity/PeakPower.Infrastructure.Identity.csproj"
  "src/Infrastructure/PeakPower.Infrastructure.Email/PeakPower.Infrastructure.Email.csproj"
  "src/Hosts/PeakPower.ServiceDefaults/PeakPower.ServiceDefaults.csproj"
  "src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj"
  "src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj"
  "src/Hosts/PeakPower.Migrator/PeakPower.Migrator.csproj"
  "src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj"
  "tests/PeakPower.Domain.Tests/PeakPower.Domain.Tests.csproj"
  "tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj"
  "tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj"
  "tests/PeakPower.Architecture.Tests/PeakPower.Architecture.Tests.csproj"
  "tests/PeakPower.AppHost.Tests/PeakPower.AppHost.Tests.csproj"
)

for project in "${expected[@]}"; do
  normalised="${project//\//[\\/]}"
  echo "$listing" | grep -Eq "$normalised" || fail "not in the solution: $project"
done

# The domain must not reference anything. This is architecture fact 1 stated in MSBuild;
# Task 4 makes it executable against the compiled IL as well.
if grep -q "ProjectReference" "$root/src/Core/PeakPower.Domain/PeakPower.Domain.csproj" 2>/dev/null; then
  fail "PeakPower.Domain has a ProjectReference; it must reference nothing"
fi

if ! dotnet build PeakPower.sln --nologo -warnaserror > /tmp/peakpower-build.log 2>&1; then
  fail "dotnet build failed; see /tmp/peakpower-build.log"
  tail -30 /tmp/peakpower-build.log >&2
fi

if [[ $failures -gt 0 ]]; then
  echo "verify-solution-layout: $failures check(s) failed" >&2
  exit 1
fi
echo "verify-solution-layout: OK"
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
chmod +x /Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-solution-layout.sh
/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-solution-layout.sh
```

Expected: FAIL with
`FAIL: not in the solution: src/Core/PeakPower.Domain/PeakPower.Domain.csproj`
(eighteen such lines, then the build failure).

- [ ] **Step 3: Write the minimal implementation**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform

mkdir -p src/Core/PeakPower.Domain src/Core/PeakPower.Application src/Core/PeakPower.Contracts \
         src/Infrastructure/PeakPower.Persistence src/Infrastructure/PeakPower.Infrastructure.Time \
         src/Infrastructure/PeakPower.Infrastructure.Web \
         src/Infrastructure/PeakPower.Infrastructure.Identity \
         src/Infrastructure/PeakPower.Infrastructure.Email \
         src/Hosts/PeakPower.ServiceDefaults src/Hosts/PeakPower.Api.Customer \
         src/Hosts/PeakPower.Api.Employee src/Hosts/PeakPower.Migrator src/Hosts/PeakPower.AppHost \
         tests/PeakPower.Domain.Tests tests/PeakPower.Application.Tests \
         tests/PeakPower.Integration.Tests tests/PeakPower.Architecture.Tests \
         tests/PeakPower.AppHost.Tests

# ---------- Core ----------

cat > src/Core/PeakPower.Domain/PeakPower.Domain.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <!-- Architecture fact 1: this project references nothing. Do not add a ProjectReference here. -->
</Project>
XML

cat > src/Core/PeakPower.Domain/AssemblyMarker.cs <<'CS'
namespace PeakPower.Domain;

/// <summary>Anchor type so tests can obtain this assembly without depending on a real type.</summary>
public sealed class AssemblyMarker;
CS

cat > src/Core/PeakPower.Application/PeakPower.Application.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <!-- Architecture fact 2: only PeakPower.Domain may appear here. -->
  <ItemGroup>
    <ProjectReference Include="../PeakPower.Domain/PeakPower.Domain.csproj" />
  </ItemGroup>
</Project>
XML

cat > src/Core/PeakPower.Application/AssemblyMarker.cs <<'CS'
namespace PeakPower.Application;

/// <summary>Anchor type so tests can obtain this assembly without depending on a real type.</summary>
public sealed class AssemblyMarker;
CS

cat > src/Core/PeakPower.Contracts/PeakPower.Contracts.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <!-- Wire DTOs live here. Plan 2 fills this project; slice 1 plan 1 only creates it. -->
</Project>
XML

cat > src/Core/PeakPower.Contracts/AssemblyMarker.cs <<'CS'
namespace PeakPower.Contracts;

/// <summary>Anchor type so tests can obtain this assembly without depending on a real type.</summary>
public sealed class AssemblyMarker;
CS

# ---------- Infrastructure ----------

cat > src/Infrastructure/PeakPower.Persistence/PeakPower.Persistence.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <ProjectReference Include="../../Core/PeakPower.Application/PeakPower.Application.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.EntityFrameworkCore" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Relational" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design" />
    <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" />
    <PackageReference Include="EFCore.NamingConventions" />
    <PackageReference Include="Microsoft.Extensions.Logging.Abstractions" />
  </ItemGroup>
</Project>
XML

cat > src/Infrastructure/PeakPower.Persistence/AssemblyMarker.cs <<'CS'
namespace PeakPower.Persistence;

/// <summary>Anchor type so tests can obtain this assembly without depending on a real type.</summary>
public sealed class AssemblyMarker;
CS

cat > src/Infrastructure/PeakPower.Infrastructure.Time/PeakPower.Infrastructure.Time.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <!--
    Architecture fact 5 names this assembly as the ONLY place allowed to read the system clock.
    Nothing else in the solution may call DateTime.Now, DateTime.UtcNow, DateTimeOffset.Now,
    DateTimeOffset.UtcNow or DateTime.Today.
  -->
  <ItemGroup>
    <ProjectReference Include="../../Core/PeakPower.Application/PeakPower.Application.csproj" />
  </ItemGroup>
</Project>
XML

cat > src/Infrastructure/PeakPower.Infrastructure.Time/AssemblyMarker.cs <<'CS'
namespace PeakPower.Infrastructure.Time;

/// <summary>Anchor type so tests can obtain this assembly without depending on a real type.</summary>
public sealed class AssemblyMarker;
CS

cat > src/Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <!--
    Shared contract section 6: the ONE context-provider assembly. Architecture fact 6 allow-lists
    this assembly and no other, so every ICustomerContext and IEmployeeContext implementation
    lives here - the development one plan 2 writes and the token-backed one plan 5 writes.
    A provider inside an API host turns fact 6 red. It needs ASP.NET Core because reading the
    request is the entire job.
  -->
  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="../../Core/PeakPower.Application/PeakPower.Application.csproj" />
  </ItemGroup>
</Project>
XML

cat > src/Infrastructure/PeakPower.Infrastructure.Web/AssemblyMarker.cs <<'CS'
namespace PeakPower.Infrastructure.Web;

/// <summary>Anchor type so tests can obtain this assembly without depending on a real type.</summary>
public sealed class AssemblyMarker;
CS

cat > src/Infrastructure/PeakPower.Infrastructure.Identity/PeakPower.Infrastructure.Identity.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <!--
    Shared contract section 6: IPasswordHasher and ITokenIssuer are implemented here. Plan 5 adds
    the Argon2id hasher and the ES256 token issuer, and the package references they need. Empty
    but for its AssemblyMarker in plan 1.
  -->
  <ItemGroup>
    <ProjectReference Include="../../Core/PeakPower.Application/PeakPower.Application.csproj" />
  </ItemGroup>
</Project>
XML

cat > src/Infrastructure/PeakPower.Infrastructure.Identity/AssemblyMarker.cs <<'CS'
namespace PeakPower.Infrastructure.Identity;

/// <summary>Anchor type so tests can obtain this assembly without depending on a real type.</summary>
public sealed class AssemblyMarker;
CS

cat > src/Infrastructure/PeakPower.Infrastructure.Email/PeakPower.Infrastructure.Email.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <!--
    Shared contract section 6: IEmailSender is implemented here, as a console sink in slice 1.
    Plan 5 writes it. Empty but for its AssemblyMarker in plan 1.
  -->
  <ItemGroup>
    <ProjectReference Include="../../Core/PeakPower.Application/PeakPower.Application.csproj" />
  </ItemGroup>
</Project>
XML

cat > src/Infrastructure/PeakPower.Infrastructure.Email/AssemblyMarker.cs <<'CS'
namespace PeakPower.Infrastructure.Email;

/// <summary>Anchor type so tests can obtain this assembly without depending on a real type.</summary>
public sealed class AssemblyMarker;
CS

# ---------- Hosts ----------

cat > src/Hosts/PeakPower.ServiceDefaults/PeakPower.ServiceDefaults.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <IsAspireSharedProject>true</IsAspireSharedProject>
  </PropertyGroup>
  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.Http.Resilience" />
    <PackageReference Include="Microsoft.Extensions.ServiceDiscovery" />
    <PackageReference Include="OpenTelemetry.Extensions.Hosting" />
    <PackageReference Include="OpenTelemetry.Exporter.OpenTelemetryProtocol" />
    <PackageReference Include="OpenTelemetry.Instrumentation.AspNetCore" />
    <PackageReference Include="OpenTelemetry.Instrumentation.Http" />
    <PackageReference Include="OpenTelemetry.Instrumentation.Runtime" />
  </ItemGroup>
</Project>
XML

for api in Customer Employee; do
cat > "src/Hosts/PeakPower.Api.$api/PeakPower.Api.$api.csproj" <<XML
<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <ProjectReference Include="../../Core/PeakPower.Application/PeakPower.Application.csproj" />
    <ProjectReference Include="../../Core/PeakPower.Contracts/PeakPower.Contracts.csproj" />
    <ProjectReference Include="../../Infrastructure/PeakPower.Persistence/PeakPower.Persistence.csproj" />
    <ProjectReference Include="../../Infrastructure/PeakPower.Infrastructure.Time/PeakPower.Infrastructure.Time.csproj" />
    <ProjectReference Include="../../Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj" />
    <ProjectReference Include="../PeakPower.ServiceDefaults/PeakPower.ServiceDefaults.csproj" />
  </ItemGroup>
</Project>
XML
cat > "src/Hosts/PeakPower.Api.$api/Program.cs" <<CS
// Slice 1, plan 1 builds this host empty on purpose. Plan 2 adds the employee endpoints,
// plans 5 and 6 add the customer endpoints. Only the platform wiring belongs here today.
using PeakPower.ServiceDefaults;

var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults();

var app = builder.Build();
app.MapDefaultEndpoints();
app.Run();
CS
cat > "src/Hosts/PeakPower.Api.$api/${api}ApiEntryPoint.cs" <<CS
namespace PeakPower.Api.$api;

/// <summary>
/// The type WebApplicationFactory&lt;T&gt; is pointed at to boot this host in tests. A named
/// type in a namespace rather than the top-level Program class, because a test project that
/// references both API assemblies would otherwise see two types called Program in the global
/// namespace and the reference would be ambiguous.
/// </summary>
public sealed class ${api}ApiEntryPoint;
CS
done

# The customer host is the only one that signs people in and sends them mail, so it is the only
# one that composes the Identity and Email adapters. Keeping the ES256 signing key store out of
# the employee host is the whole point of splitting them out.
cat > src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <ProjectReference Include="../../Core/PeakPower.Application/PeakPower.Application.csproj" />
    <ProjectReference Include="../../Core/PeakPower.Contracts/PeakPower.Contracts.csproj" />
    <ProjectReference Include="../../Infrastructure/PeakPower.Persistence/PeakPower.Persistence.csproj" />
    <ProjectReference Include="../../Infrastructure/PeakPower.Infrastructure.Time/PeakPower.Infrastructure.Time.csproj" />
    <ProjectReference Include="../../Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj" />
    <ProjectReference Include="../../Infrastructure/PeakPower.Infrastructure.Identity/PeakPower.Infrastructure.Identity.csproj" />
    <ProjectReference Include="../../Infrastructure/PeakPower.Infrastructure.Email/PeakPower.Infrastructure.Email.csproj" />
    <ProjectReference Include="../PeakPower.ServiceDefaults/PeakPower.ServiceDefaults.csproj" />
  </ItemGroup>
</Project>
XML

cat > src/Hosts/PeakPower.Migrator/PeakPower.Migrator.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="../../Infrastructure/PeakPower.Persistence/PeakPower.Persistence.csproj" />
    <ProjectReference Include="../PeakPower.ServiceDefaults/PeakPower.ServiceDefaults.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.Hosting" />
  </ItemGroup>
</Project>
XML

cat > src/Hosts/PeakPower.Migrator/Program.cs <<'CS'
// Task 23 replaces this with the real migration runner.
await Task.CompletedTask;
CS

cat > src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">

  <!--
    Aspire 13.5.3 is an MSBuild SDK plus a CLI global tool, NOT a dotnet workload.
    The Sdk element below is what generates the strongly typed `Projects.*` classes from the
    ProjectReference items; SDK versions are not covered by central package management, so the
    version is written here and nowhere else.
  -->
  <Sdk Name="Aspire.AppHost.Sdk" Version="13.5.3" />

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <IsAspireHost>true</IsAspireHost>
    <UserSecretsId>peakpower-apphost</UserSecretsId>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Aspire.Hosting.AppHost" />
    <PackageReference Include="Aspire.Hosting.PostgreSQL" />
    <PackageReference Include="Aspire.Hosting.JavaScript" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="../PeakPower.Api.Customer/PeakPower.Api.Customer.csproj" />
    <ProjectReference Include="../PeakPower.Api.Employee/PeakPower.Api.Employee.csproj" />
    <ProjectReference Include="../PeakPower.Migrator/PeakPower.Migrator.csproj" />
  </ItemGroup>

</Project>
XML

cat > src/Hosts/PeakPower.AppHost/Program.cs <<'CS'
// Task 27 replaces this with the real Aspire resource graph.
var builder = DistributedApplication.CreateBuilder(args);
builder.Build().Run();
CS

# ---------- Tests ----------

cat > tests/PeakPower.Domain.Tests/PeakPower.Domain.Tests.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <ProjectReference Include="../../src/Core/PeakPower.Domain/PeakPower.Domain.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="xunit.v3" />
    <PackageReference Include="xunit.runner.visualstudio" />
    <PackageReference Include="FluentAssertions" />
    <PackageReference Include="coverlet.collector" />
  </ItemGroup>
</Project>
XML

cat > tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <ProjectReference Include="../../src/Core/PeakPower.Application/PeakPower.Application.csproj" />
    <ProjectReference Include="../../src/Infrastructure/PeakPower.Infrastructure.Time/PeakPower.Infrastructure.Time.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="xunit.v3" />
    <PackageReference Include="xunit.runner.visualstudio" />
    <PackageReference Include="FluentAssertions" />
    <PackageReference Include="NSubstitute" />
    <PackageReference Include="Microsoft.Extensions.TimeProvider.Testing" />
    <PackageReference Include="coverlet.collector" />
  </ItemGroup>
</Project>
XML

cat > tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <ProjectReference Include="../../src/Core/PeakPower.Domain/PeakPower.Domain.csproj" />
    <ProjectReference Include="../../src/Infrastructure/PeakPower.Persistence/PeakPower.Persistence.csproj" />
    <ProjectReference Include="../../src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj" />
    <ProjectReference Include="../../src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="xunit.v3" />
    <PackageReference Include="xunit.runner.visualstudio" />
    <PackageReference Include="FluentAssertions" />
    <PackageReference Include="Testcontainers.PostgreSql" />
    <PackageReference Include="Npgsql" />
    <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" />
    <PackageReference Include="coverlet.collector" />
  </ItemGroup>
</Project>
XML

cat > tests/PeakPower.Architecture.Tests/PeakPower.Architecture.Tests.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <!--
    Every source assembly except the AppHost is referenced so that its DLL lands in this
    project's output directory, where the Mono.Cecil scan in ArchitectureFacts can read it.
    The AppHost is excluded on purpose: it is orchestration, it ships no domain code, and
    referencing an Aspire host from a scanner project buys nothing.
  -->
  <ItemGroup>
    <ProjectReference Include="../../src/Core/PeakPower.Domain/PeakPower.Domain.csproj" />
    <ProjectReference Include="../../src/Core/PeakPower.Application/PeakPower.Application.csproj" />
    <ProjectReference Include="../../src/Core/PeakPower.Contracts/PeakPower.Contracts.csproj" />
    <ProjectReference Include="../../src/Infrastructure/PeakPower.Persistence/PeakPower.Persistence.csproj" />
    <ProjectReference Include="../../src/Infrastructure/PeakPower.Infrastructure.Time/PeakPower.Infrastructure.Time.csproj" />
    <ProjectReference Include="../../src/Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj" />
    <ProjectReference Include="../../src/Infrastructure/PeakPower.Infrastructure.Identity/PeakPower.Infrastructure.Identity.csproj" />
    <ProjectReference Include="../../src/Infrastructure/PeakPower.Infrastructure.Email/PeakPower.Infrastructure.Email.csproj" />
    <ProjectReference Include="../../src/Hosts/PeakPower.ServiceDefaults/PeakPower.ServiceDefaults.csproj" />
    <ProjectReference Include="../../src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj" />
    <ProjectReference Include="../../src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj" />
    <ProjectReference Include="../../src/Hosts/PeakPower.Migrator/PeakPower.Migrator.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="xunit.v3" />
    <PackageReference Include="xunit.runner.visualstudio" />
    <PackageReference Include="FluentAssertions" />
    <PackageReference Include="NetArchTest.Rules" />
    <PackageReference Include="Mono.Cecil" />
    <PackageReference Include="coverlet.collector" />
  </ItemGroup>
</Project>
XML

cat > tests/PeakPower.AppHost.Tests/PeakPower.AppHost.Tests.csproj <<'XML'
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <ProjectReference Include="../../src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="xunit.v3" />
    <PackageReference Include="xunit.runner.visualstudio" />
    <PackageReference Include="FluentAssertions" />
    <PackageReference Include="coverlet.collector" />
  </ItemGroup>
</Project>
XML

dotnet sln PeakPower.sln add \
  src/Core/PeakPower.Domain/PeakPower.Domain.csproj \
  src/Core/PeakPower.Application/PeakPower.Application.csproj \
  src/Core/PeakPower.Contracts/PeakPower.Contracts.csproj \
  src/Infrastructure/PeakPower.Persistence/PeakPower.Persistence.csproj \
  src/Infrastructure/PeakPower.Infrastructure.Time/PeakPower.Infrastructure.Time.csproj \
  src/Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj \
  src/Infrastructure/PeakPower.Infrastructure.Identity/PeakPower.Infrastructure.Identity.csproj \
  src/Infrastructure/PeakPower.Infrastructure.Email/PeakPower.Infrastructure.Email.csproj \
  src/Hosts/PeakPower.ServiceDefaults/PeakPower.ServiceDefaults.csproj \
  src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj \
  src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj \
  src/Hosts/PeakPower.Migrator/PeakPower.Migrator.csproj \
  src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj \
  tests/PeakPower.Domain.Tests/PeakPower.Domain.Tests.csproj \
  tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj \
  tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj \
  tests/PeakPower.Architecture.Tests/PeakPower.Architecture.Tests.csproj \
  tests/PeakPower.AppHost.Tests/PeakPower.AppHost.Tests.csproj
```

Note: `PeakPower.ServiceDefaults` has no `Extensions.cs` yet, so `builder.AddServiceDefaults()`
and `app.MapDefaultEndpoints()` in the two API `Program.cs` files will not compile. Add the
stub below now so the solution builds; Task 24 replaces it with the real implementation.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
cat > src/Hosts/PeakPower.ServiceDefaults/Extensions.cs <<'CS'
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Hosting;

namespace PeakPower.ServiceDefaults;

/// <summary>Cross-cutting host wiring. Task 24 fills these in with the real behaviour.</summary>
public static class Extensions
{
    public static TBuilder AddServiceDefaults<TBuilder>(this TBuilder builder)
        where TBuilder : IHostApplicationBuilder => builder;

    public static WebApplication MapDefaultEndpoints(this WebApplication app) => app;
}
CS
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-solution-layout.sh`
Expected: PASS — prints `verify-solution-layout: OK`

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add PeakPower.sln src tests tools/verify-solution-layout.sh
git commit -m "build: add the thirteen source projects, five test projects and the reference graph"
```

---

### Task 4: Architecture facts 1 and 2 — the module graph

Shared contract §13 requires six executable architecture facts from week one. The design's own
reason for writing them first is the right one: *without the test the seam closes again within
two sprints, silently.* This task does facts 1 and 2 with NetArchTest; Task 5 does 3 and 5.
Facts 4 and 6 are plan 2's, per contract §13's ownership table.

**Files:**
- Create: `tests/PeakPower.Architecture.Tests/ModuleGraphFacts.cs`
- Test: the same file — architecture tests are their own test

**Interfaces:**
- Consumes: `PeakPower.Domain.AssemblyMarker`, `PeakPower.Application.AssemblyMarker` (Task 3).
- Produces: nothing other plans consume; these tests run on every `dotnet test`.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Architecture.Tests/ModuleGraphFacts.cs`:

```csharp
using System.Reflection;
using FluentAssertions;
using NetArchTest.Rules;

namespace PeakPower.Architecture.Tests;

/// <summary>
/// Shared contract section 13, facts 1 and 2. The three module rules are: Domain references
/// nothing, Application references only Domain, and hosts reference infrastructure solely to
/// register it in DI at the composition root.
/// </summary>
public sealed class ModuleGraphFacts
{
    private static readonly Assembly DomainAssembly = typeof(PeakPower.Domain.AssemblyMarker).Assembly;
    private static readonly Assembly ApplicationAssembly = typeof(PeakPower.Application.AssemblyMarker).Assembly;

    private static readonly string[] EverythingOutsideTheDomain =
    [
        "PeakPower.Application",
        "PeakPower.Contracts",
        "PeakPower.Persistence",
        "PeakPower.Infrastructure",
        "PeakPower.ServiceDefaults",
        "PeakPower.Api",
        "PeakPower.Migrator",
        "PeakPower.AppHost",
    ];

    private static readonly string[] EverythingOutsideTheApplicationAndDomain =
    [
        "PeakPower.Contracts",
        "PeakPower.Persistence",
        "PeakPower.Infrastructure",
        "PeakPower.ServiceDefaults",
        "PeakPower.Api",
        "PeakPower.Migrator",
        "PeakPower.AppHost",
    ];

    [Fact]
    public void Fact_1_the_domain_references_no_other_project()
    {
        var result = Types.InAssembly(DomainAssembly)
            .ShouldNot()
            .HaveDependencyOnAny(EverythingOutsideTheDomain)
            .GetResult();

        result.IsSuccessful.Should().BeTrue(
            "PeakPower.Domain must reference nothing. Offending types: {0}",
            string.Join(", ", result.FailingTypeNames ?? []));
    }

    [Fact]
    public void Fact_1_the_domain_assembly_has_no_PeakPower_assembly_references()
    {
        PeakPowerReferencesOf(DomainAssembly).Should().BeEmpty(
            "PeakPower.Domain must reference nothing at all, not even transitively");
    }

    [Fact]
    public void Fact_2_the_application_references_only_the_domain()
    {
        var result = Types.InAssembly(ApplicationAssembly)
            .ShouldNot()
            .HaveDependencyOnAny(EverythingOutsideTheApplicationAndDomain)
            .GetResult();

        result.IsSuccessful.Should().BeTrue(
            "PeakPower.Application may reference only PeakPower.Domain. Offending types: {0}",
            string.Join(", ", result.FailingTypeNames ?? []));
    }

    [Fact]
    public void Fact_2_the_application_assembly_references_at_most_the_domain()
    {
        // "At most", not "exactly": the C# compiler drops an assembly reference that no IL uses,
        // so an Application that happens not to touch a Domain type yet still satisfies the rule.
        PeakPowerReferencesOf(ApplicationAssembly).Should().BeSubsetOf(["PeakPower.Domain"]);
    }

    private static IReadOnlyList<string> PeakPowerReferencesOf(Assembly assembly) =>
        [.. assembly.GetReferencedAssemblies()
             .Select(reference => reference.Name ?? string.Empty)
             .Where(name => name.StartsWith("PeakPower.", StringComparison.Ordinal))
             .Order(StringComparer.Ordinal)];
}
```

- [ ] **Step 2: Run the test and watch it fail**

First prove the guard rail bites. Temporarily add a forbidden reference:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet add src/Core/PeakPower.Domain/PeakPower.Domain.csproj \
  reference src/Core/PeakPower.Contracts/PeakPower.Contracts.csproj
cat > src/Core/PeakPower.Domain/TemporaryViolation.cs <<'CS'
namespace PeakPower.Domain;

internal sealed class TemporaryViolation
{
    public PeakPower.Contracts.AssemblyMarker? Marker { get; init; }
}
CS
dotnet test tests/PeakPower.Architecture.Tests --nologo
```

Expected: FAIL — `Fact_1_the_domain_references_no_other_project` and
`Fact_1_the_domain_assembly_has_no_PeakPower_assembly_references` both fail, the latter with
`Expected collection to be empty, but found {"PeakPower.Contracts"}`.

- [ ] **Step 3: Write the minimal implementation**

Remove the deliberate violation. The "implementation" of an architecture fact is the absence of
the thing it forbids.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
rm src/Core/PeakPower.Domain/TemporaryViolation.cs
dotnet remove src/Core/PeakPower.Domain/PeakPower.Domain.csproj \
  reference src/Core/PeakPower.Contracts/PeakPower.Contracts.csproj
```

Then confirm `src/Core/PeakPower.Domain/PeakPower.Domain.csproj` reads exactly:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <!-- Architecture fact 1: this project references nothing. Do not add a ProjectReference here. -->
</Project>
```

(`dotnet remove reference` leaves an empty `<ItemGroup />` behind; delete it.)

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Architecture.Tests --nologo`
Expected: PASS — 4 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Architecture.Tests/ModuleGraphFacts.cs src/Core/PeakPower.Domain/PeakPower.Domain.csproj
git commit -m "test: assert architecture facts 1 and 2, the module graph"
```

---

### Task 5: Architecture facts 3 and 5 — the IL scan

Facts 3 to 6 are about what code *calls*, not what a project references, so NetArchTest's
type-dependency model is the wrong instrument: `System.DateTime` is referenced legitimately
everywhere, and only the `DateTime.UtcNow` **call** is forbidden. Mono.Cecil (which NetArchTest
already carries) reads the actual IL instructions, so these facts are exact.

This task writes the two of them plan 1 can write — 3 and 5 — plus the `AssemblyProbe` all four
share. **Facts 4 and 6 belong to plan 2** (contract §13's ownership table): fact 4 forbids
`IgnoreQueryFilters()`, which nothing can call until plan 2 installs the query filters, and
fact 6 fences `PeakPower.Infrastructure.Web` — the ONE context-provider assembly, still empty
at the end of this plan. Plan 2 adds both to `CallSiteFacts` using the probe below, and
`PeakPower.Infrastructure.Web` is the single allow-listed assembly: contract §6 is explicit
that no provider goes inside an API host.

**Files:**
- Create: `tests/PeakPower.Architecture.Tests/AssemblyProbe.cs`
- Create: `tests/PeakPower.Architecture.Tests/CallSiteFacts.cs`
- Test: the same files

**Interfaces:**
- Consumes: the twelve source assemblies referenced by `PeakPower.Architecture.Tests` (Task 3).
- Produces: `PeakPower.Architecture.Tests.AssemblyProbe` with
  `IReadOnlyList<AssemblyDefinition> ProductionAssemblies()`,
  `IEnumerable<CallSite> CallSites(AssemblyDefinition assembly)` and
  `readonly record struct CallSite(string AssemblyName, string TypeFullName, string TypeNamespace, string MethodName, MethodReference Called)`.
  Plan 2 adds facts 4 and 6 to `CallSiteFacts` using the same probe, fencing
  `PeakPower.Infrastructure.Web`.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Architecture.Tests/AssemblyProbe.cs`:

```csharp
using Mono.Cecil;
using Mono.Cecil.Cil;

namespace PeakPower.Architecture.Tests;

/// <summary>One call instruction found in one method of one production assembly.</summary>
public readonly record struct CallSite(
    string AssemblyName,
    string TypeFullName,
    string TypeNamespace,
    string MethodName,
    MethodReference Called)
{
    public override string ToString() => $"{TypeFullName}.{MethodName} -> {Called.FullName}";
}

/// <summary>
/// Reads the compiled IL of every production assembly that sits next to this test assembly.
/// The Architecture.Tests project references all of them, which is what puts their DLLs here.
/// </summary>
public static class AssemblyProbe
{
    private static readonly string[] ProductionAssemblyFileNames =
    [
        "PeakPower.Domain.dll",
        "PeakPower.Application.dll",
        "PeakPower.Contracts.dll",
        "PeakPower.Persistence.dll",
        "PeakPower.Infrastructure.Time.dll",
        "PeakPower.Infrastructure.Web.dll",
        "PeakPower.Infrastructure.Identity.dll",
        "PeakPower.Infrastructure.Email.dll",
        "PeakPower.ServiceDefaults.dll",
        "PeakPower.Api.Customer.dll",
        "PeakPower.Api.Employee.dll",
        "PeakPower.Migrator.dll",
    ];

    public static string OutputDirectory =>
        Path.GetDirectoryName(typeof(AssemblyProbe).Assembly.Location)!;

    public static IReadOnlyList<AssemblyDefinition> ProductionAssemblies() =>
        [.. ProductionAssemblyFileNames
             .Select(name => Path.Combine(OutputDirectory, name))
             .Where(File.Exists)
             .Select(path => AssemblyDefinition.ReadAssembly(path))];

    public static IEnumerable<CallSite> CallSites(AssemblyDefinition assembly)
    {
        foreach (var type in AllTypes(assembly.MainModule))
        {
            var typeNamespace = OutermostNamespaceOf(type);
            foreach (var method in type.Methods)
            {
                if (!method.HasBody)
                {
                    continue;
                }

                foreach (var instruction in method.Body.Instructions)
                {
                    if (instruction.OpCode.Code is not (Code.Call or Code.Callvirt or Code.Newobj))
                    {
                        continue;
                    }

                    if (instruction.Operand is MethodReference called)
                    {
                        yield return new CallSite(
                            assembly.Name.Name,
                            type.FullName,
                            typeNamespace,
                            method.Name,
                            called);
                    }
                }
            }
        }
    }

    private static IEnumerable<TypeDefinition> AllTypes(ModuleDefinition module)
    {
        foreach (var type in module.Types)
        {
            foreach (var nested in Flatten(type))
            {
                yield return nested;
            }
        }
    }

    private static IEnumerable<TypeDefinition> Flatten(TypeDefinition type)
    {
        yield return type;
        foreach (var nested in type.NestedTypes)
        {
            foreach (var deeper in Flatten(nested))
            {
                yield return deeper;
            }
        }
    }

    /// <summary>Nested types carry an empty Namespace, so walk out to the declaring type.</summary>
    private static string OutermostNamespaceOf(TypeDefinition type)
    {
        var current = type;
        while (current.DeclaringType is not null)
        {
            current = current.DeclaringType;
        }

        return current.Namespace ?? string.Empty;
    }
}
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Architecture.Tests/CallSiteFacts.cs`:

```csharp
using FluentAssertions;
using Mono.Cecil;

namespace PeakPower.Architecture.Tests;

/// <summary>
/// Shared contract section 13, facts 3 and 5. Facts 4 and 6 are plan 2's and land in this same
/// class, against the same AssemblyProbe: fact 4 bans IgnoreQueryFilters() once the query
/// filters exist, and fact 6 allow-lists exactly one assembly, PeakPower.Infrastructure.Web.
/// </summary>
public sealed class CallSiteFacts
{
    private static readonly string[] ClockDeclaringTypes =
    [
        "System.DateTime",
        "System.DateTimeOffset",
    ];

    private static readonly string[] ClockMembers =
    [
        "get_Now",
        "get_UtcNow",
        "get_Today",
    ];

    [Fact]
    public void Fact_3_ingestion_references_no_Brp_adapter()
    {
        var ingestionPath = Path.Combine(AssemblyProbe.OutputDirectory, "PeakPower.Ingestion.dll");
        if (!File.Exists(ingestionPath))
        {
            Assert.Skip("PeakPower.Ingestion is deferred past slice 1. This fact is armed for the day it lands.");
        }

        using var ingestion = AssemblyDefinition.ReadAssembly(ingestionPath);

        var brpReferences = ingestion.MainModule.AssemblyReferences
            .Select(reference => reference.Name)
            .Where(name => name.StartsWith("PeakPower.Integration.Brp", StringComparison.Ordinal))
            .ToArray();

        brpReferences.Should().BeEmpty(
            "PeakPower.Ingestion must talk to BRP adapters through a port, never by referencing one");
    }

    [Fact]
    public void Fact_5_only_Infrastructure_Time_reads_the_system_clock()
    {
        var offenders = AllCallSites()
            .Where(site => site.AssemblyName != "PeakPower.Infrastructure.Time")
            .Where(site => ClockDeclaringTypes.Contains(site.Called.DeclaringType.FullName, StringComparer.Ordinal))
            .Where(site => ClockMembers.Contains(site.Called.Name, StringComparer.Ordinal))
            .Select(site => site.ToString())
            .ToArray();

        offenders.Should().BeEmpty(
            "IMarketCalendar is the only source of \"now\". Anything else makes a test that depends "
            + "on the wall clock, and business days are Europe/Amsterdam, not the machine's zone.");
    }

    private static IEnumerable<CallSite> AllCallSites()
    {
        foreach (var assembly in AssemblyProbe.ProductionAssemblies())
        {
            using (assembly)
            {
                foreach (var site in AssemblyProbe.CallSites(assembly))
                {
                    yield return site;
                }
            }
        }
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Prove fact 5 bites by adding one deliberate violation of it. Fact 3 has nothing to violate
until `PeakPower.Ingestion` exists, which is why it reports as skipped rather than green.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
cat > src/Core/PeakPower.Application/TemporaryViolation.cs <<'CS'
namespace PeakPower.Application;

internal static class TemporaryViolation
{
    public static DateTime Clock() => DateTime.UtcNow;
}
CS
dotnet test tests/PeakPower.Architecture.Tests --nologo
```

Expected: FAIL — `Fact_5_only_Infrastructure_Time_reads_the_system_clock` fails with
`Expected offenders to be empty, but found {"PeakPower.Application.TemporaryViolation.Clock -> System.DateTime System.DateTime::get_UtcNow()"}`.
`Fact_3_ingestion_references_no_Brp_adapter` is reported as skipped.

- [ ] **Step 3: Write the minimal implementation**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
rm src/Core/PeakPower.Application/TemporaryViolation.cs
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Architecture.Tests --nologo`
Expected: PASS — 5 passed, 1 skipped, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Architecture.Tests/AssemblyProbe.cs \
        tests/PeakPower.Architecture.Tests/CallSiteFacts.cs
git commit -m "test: assert architecture facts 3 and 5 against the compiled IL"
```

---

### Task 6: `Result<T>` — validation without exceptions

The domain never throws for a validation failure; it returns `Result<T>`. Endpoints in plans 2,
5 and 6 turn a failed `Result<T>` into an RFC 7807 problem document.

**Files:**
- Create: `src/Core/PeakPower.Domain/Common/Result.cs`
- Test: `tests/PeakPower.Domain.Tests/Common/ResultTests.cs`

**Interfaces:**
- Consumes: nothing.
- Produces: `PeakPower.Domain.Common.Result<T>` with
  `bool IsSuccess`, `T Value`, `string Error`,
  `static Result<T> Success(T value)`, `static Result<T> Failure(string error)`.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Common/ResultTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Tests.Common;

public sealed class ResultTests
{
    [Fact]
    public void Success_carries_the_value_and_an_empty_error()
    {
        var result = Result<int>.Success(42);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().Be(42);
        result.Error.Should().BeEmpty();
    }

    [Fact]
    public void Failure_carries_the_error_and_is_not_successful()
    {
        var result = Result<int>.Failure("KvK number must be exactly 8 digits.");

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("KvK number must be exactly 8 digits.");
    }

    [Fact]
    public void Reading_the_value_of_a_failure_throws_rather_than_handing_back_a_default()
    {
        var result = Result<string>.Failure("nope");

        var act = () => result.Value;

        act.Should().Throw<InvalidOperationException>()
           .WithMessage("Cannot read Value of a failed result. Error: nope");
    }

    [Fact]
    public void Failure_rejects_a_blank_error_because_a_failure_without_a_reason_is_useless()
    {
        var act = () => Result<int>.Failure("   ");

        act.Should().Throw<ArgumentException>();
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: FAIL with `error CS0246: The type or namespace name 'Result<>' could not be found`

- [ ] **Step 3: Write the minimal implementation**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Common/Result.cs`:

```csharp
namespace PeakPower.Domain.Common;

/// <summary>
/// The outcome of a domain operation. Validation failures are values, not exceptions: an
/// invalid IBAN is an expected answer to "is this an IBAN", not an exceptional condition.
/// </summary>
public sealed class Result<T>
{
    private readonly T? _value;

    private Result(bool isSuccess, T? value, string error)
    {
        IsSuccess = isSuccess;
        _value = value;
        Error = error;
    }

    public bool IsSuccess { get; }

    public T Value => IsSuccess
        ? _value!
        : throw new InvalidOperationException($"Cannot read Value of a failed result. Error: {Error}");

    public string Error { get; }

    public static Result<T> Success(T value) => new(true, value, string.Empty);

    public static Result<T> Failure(string error)
    {
        if (string.IsNullOrWhiteSpace(error))
        {
            throw new ArgumentException("A failure must carry a reason.", nameof(error));
        }

        return new Result<T>(false, default, error);
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS — 4 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Common/Result.cs tests/PeakPower.Domain.Tests/Common/ResultTests.cs
git commit -m "feat(domain): add Result<T> for validation without exceptions"
```

---

### Task 7: `EanCode` — eighteen digits, no check digit

An EAN identifies one electricity connection point in the Dutch grid. `[F01-R24]` originally
demanded a GS1 check digit; `[DEC-114]` relaxes that to a length check for the proof of concept
because both GS1 weighting conventions disagree on five of the six demo EANs `[OQ-97]`. **Do not
add check-digit validation in slice 1** — the seed data would stop loading.

`ToDisplayString()` groups the digits in fours, which is the form both portals display
`[F01-R31]`: `871687100000000011` reads as `8716 8710 0000 0000 11`.

**Files:**
- Create: `src/Core/PeakPower.Domain/Common/EanCode.cs`
- Test: `tests/PeakPower.Domain.Tests/Common/EanCodeTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Domain.Common.Result<T>` (Task 6).
- Produces: `PeakPower.Domain.Common.EanCode` — `readonly record struct` with
  `string Value`, `static Result<EanCode> Create(string raw)`, `string ToDisplayString()`,
  and `static EanCode FromPersistedValue(string value)` (used only by the EF value converter,
  which reads rows the database already accepted).

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Common/EanCodeTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Tests.Common;

public sealed class EanCodeTests
{
    [Fact]
    public void Eighteen_digits_are_accepted()
    {
        var result = EanCode.Create("871687100000000011");

        result.IsSuccess.Should().BeTrue();
        result.Value.Value.Should().Be("871687100000000011");
    }

    [Fact]
    public void Grouping_spaces_are_stripped_before_validation()
    {
        var result = EanCode.Create("8716 8710 0000 0000 11");

        result.IsSuccess.Should().BeTrue();
        result.Value.Value.Should().Be("871687100000000011");
    }

    [Theory]
    [InlineData("87168710000000001")]      // seventeen
    [InlineData("8716871000000000111")]    // nineteen
    [InlineData("87168710000000001A")]     // a letter
    public void Anything_that_is_not_eighteen_digits_is_rejected(string raw)
    {
        var result = EanCode.Create(raw);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("EAN must be exactly 18 digits.");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void A_blank_EAN_is_rejected_with_its_own_message(string raw)
    {
        var result = EanCode.Create(raw);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("EAN must not be blank.");
    }

    [Fact]
    public void A_wrong_GS1_check_digit_is_accepted_because_DEC_114_relaxed_it_for_the_PoC()
    {
        // 871687100000000019 fails every GS1 weighting. Slice 1 must still accept it,
        // because five of the six demo EANs are in exactly this position. See [OQ-97].
        EanCode.Create("871687100000000019").IsSuccess.Should().BeTrue();
    }

    [Fact]
    public void ToDisplayString_groups_the_digits_in_fours()
    {
        var ean = EanCode.Create("871687100000000011").Value;

        ean.ToDisplayString().Should().Be("8716 8710 0000 0000 11");
    }

    [Fact]
    public void Two_EANs_with_the_same_digits_are_equal()
    {
        var first = EanCode.Create("871687100000000011").Value;
        var second = EanCode.Create("8716 8710 0000 0000 11").Value;

        first.Should().Be(second);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: FAIL with `error CS0246: The type or namespace name 'EanCode' could not be found`

- [ ] **Step 3: Write the minimal implementation**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Common/EanCode.cs`:

```csharp
using System.Text;

namespace PeakPower.Domain.Common;

/// <summary>
/// The eighteen-digit code identifying one electricity connection point in the Dutch grid.
/// Slice 1 validates the length only; the GS1 check digit is reinstated before go-live
/// (decision [DEC-114], open question [OQ-97]).
/// </summary>
public readonly record struct EanCode
{
    private const int RequiredDigits = 18;
    private const int GroupSize = 4;

    private readonly string? _value;

    private EanCode(string value) => _value = value;

    public string Value => _value ?? string.Empty;

    public static Result<EanCode> Create(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return Result<EanCode>.Failure("EAN must not be blank.");
        }

        var compact = Compact(raw);

        return compact.Length == RequiredDigits && compact.All(char.IsAsciiDigit)
            ? Result<EanCode>.Success(new EanCode(compact))
            : Result<EanCode>.Failure("EAN must be exactly 18 digits.");
    }

    /// <summary>
    /// Rehydrates a value the database already holds. Only the EF Core value converter should
    /// call this; everything else goes through <see cref="Create"/>.
    /// </summary>
    public static EanCode FromPersistedValue(string value) => new(value);

    /// <summary>Groups the digits in fours: 8716 8710 0000 0000 11. [F01-R31]</summary>
    public string ToDisplayString()
    {
        var digits = Value;
        if (digits.Length == 0)
        {
            return string.Empty;
        }

        var builder = new StringBuilder(digits.Length + (digits.Length / GroupSize));
        for (var index = 0; index < digits.Length; index++)
        {
            if (index > 0 && index % GroupSize == 0)
            {
                builder.Append(' ');
            }

            builder.Append(digits[index]);
        }

        return builder.ToString();
    }

    public override string ToString() => Value;

    private static string Compact(string raw)
    {
        var builder = new StringBuilder(raw.Length);
        foreach (var character in raw)
        {
            if (!char.IsWhiteSpace(character))
            {
                builder.Append(character);
            }
        }

        return builder.ToString();
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS — 14 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Common/EanCode.cs tests/PeakPower.Domain.Tests/Common/EanCodeTests.cs
git commit -m "feat(domain): add EanCode, 18 digits with no check digit per DEC-114"
```

---

### Task 8: `KvkNumber` — exactly eight digits

The KvK number is the Dutch Chamber of Commerce registration number of a company. `[F01-R03]`
requires exactly eight digits.

**Files:**
- Create: `src/Core/PeakPower.Domain/Common/KvkNumber.cs`
- Test: `tests/PeakPower.Domain.Tests/Common/KvkNumberTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Domain.Common.Result<T>` (Task 6).
- Produces: `PeakPower.Domain.Common.KvkNumber` — `readonly record struct` with
  `string Value`, `static Result<KvkNumber> Create(string raw)`,
  `static KvkNumber FromPersistedValue(string value)`.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Common/KvkNumberTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Tests.Common;

public sealed class KvkNumberTests
{
    [Fact]
    public void Eight_digits_are_accepted()
    {
        var result = KvkNumber.Create("12345678");

        result.IsSuccess.Should().BeTrue();
        result.Value.Value.Should().Be("12345678");
    }

    [Fact]
    public void Surrounding_whitespace_is_stripped()
    {
        KvkNumber.Create(" 1234 5678 ").Value.Value.Should().Be("12345678");
    }

    [Theory]
    [InlineData("1234567")]      // seven
    [InlineData("123456789")]    // nine
    [InlineData("1234567A")]     // a letter
    public void Anything_that_is_not_eight_digits_is_rejected(string raw)
    {
        var result = KvkNumber.Create(raw);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("KvK number must be exactly 8 digits.");
    }

    [Fact]
    public void A_blank_KvK_number_is_rejected_with_its_own_message()
    {
        var result = KvkNumber.Create("  ");

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("KvK number must not be blank.");
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: FAIL with `error CS0246: The type or namespace name 'KvkNumber' could not be found`

- [ ] **Step 3: Write the minimal implementation**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Common/KvkNumber.cs`:

```csharp
using System.Text;

namespace PeakPower.Domain.Common;

/// <summary>The eight-digit Dutch Chamber of Commerce registration number. [F01-R03]</summary>
public readonly record struct KvkNumber
{
    private const int RequiredDigits = 8;

    private readonly string? _value;

    private KvkNumber(string value) => _value = value;

    public string Value => _value ?? string.Empty;

    public static Result<KvkNumber> Create(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return Result<KvkNumber>.Failure("KvK number must not be blank.");
        }

        var builder = new StringBuilder(raw.Length);
        foreach (var character in raw)
        {
            if (!char.IsWhiteSpace(character))
            {
                builder.Append(character);
            }
        }

        var compact = builder.ToString();

        return compact.Length == RequiredDigits && compact.All(char.IsAsciiDigit)
            ? Result<KvkNumber>.Success(new KvkNumber(compact))
            : Result<KvkNumber>.Failure("KvK number must be exactly 8 digits.");
    }

    /// <summary>Rehydrates a value the database already holds. EF Core value converter only.</summary>
    public static KvkNumber FromPersistedValue(string value) => new(value);

    public override string ToString() => Value;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS — 20 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Common/KvkNumber.cs tests/PeakPower.Domain.Tests/Common/KvkNumberTests.cs
git commit -m "feat(domain): add KvkNumber with the eight-digit rule from F01-R03"
```

---

### Task 9: `Iban` — structural check plus ISO 7064 mod-97

`[F01-R03]` requires a real IBAN check, not a regular expression. The mod-97 test is the
standard one: move the first four characters to the end, replace each letter with its position
in the alphabet plus nine (`A` = 10 … `Z` = 35), and the resulting integer must leave remainder
1 when divided by 97.

**Files:**
- Create: `src/Core/PeakPower.Domain/Common/Iban.cs`
- Test: `tests/PeakPower.Domain.Tests/Common/IbanTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Domain.Common.Result<T>` (Task 6).
- Produces: `PeakPower.Domain.Common.Iban` — `readonly record struct` with
  `string Value` (uppercase, no spaces), `static Result<Iban> Create(string raw)`,
  `static Iban FromPersistedValue(string value)`.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Common/IbanTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Tests.Common;

public sealed class IbanTests
{
    [Theory]
    [InlineData("NL91ABNA0417164300")]
    [InlineData("NL39RABO0300065264")]
    [InlineData("DE89370400440532013000")]
    public void A_valid_IBAN_passes_the_mod_97_check(string raw)
    {
        var result = Iban.Create(raw);

        result.IsSuccess.Should().BeTrue(result.IsSuccess ? string.Empty : result.Error);
        result.Value.Value.Should().Be(raw);
    }

    [Fact]
    public void Grouping_spaces_and_lower_case_are_normalised_away()
    {
        var result = Iban.Create("nl91 abna 0417 1643 00");

        result.IsSuccess.Should().BeTrue();
        result.Value.Value.Should().Be("NL91ABNA0417164300");
    }

    [Fact]
    public void An_IBAN_with_a_wrong_check_number_is_rejected()
    {
        var result = Iban.Create("NL91ABNA0417164301");

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("IBAN failed the ISO 7064 mod-97 check.");
    }

    [Theory]
    [InlineData("NL91ABNA04171")]                        // too short
    [InlineData("9L91ABNA0417164300")]                   // first character is not a letter
    [InlineData("NLX1ABNA0417164300")]                   // third character is not a digit
    [InlineData("NL91-ABNA-0417-1643-00")]               // punctuation
    public void An_IBAN_with_the_wrong_shape_is_rejected_before_the_mod_97_check(string raw)
    {
        var result = Iban.Create(raw);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be(
            "IBAN must be 15 to 34 characters: two letters, two digits, then letters or digits.");
    }

    [Fact]
    public void A_blank_IBAN_is_rejected_with_its_own_message()
    {
        Iban.Create("   ").Error.Should().Be("IBAN must not be blank.");
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: FAIL with `error CS0246: The type or namespace name 'Iban' could not be found`

- [ ] **Step 3: Write the minimal implementation**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Common/Iban.cs`:

```csharp
using System.Text;

namespace PeakPower.Domain.Common;

/// <summary>An international bank account number, checked structurally and by ISO 7064 mod-97. [F01-R03]</summary>
public readonly record struct Iban
{
    private const int MinimumLength = 15;
    private const int MaximumLength = 34;

    private readonly string? _value;

    private Iban(string value) => _value = value;

    public string Value => _value ?? string.Empty;

    public static Result<Iban> Create(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return Result<Iban>.Failure("IBAN must not be blank.");
        }

        var compact = Normalise(raw);

        if (!HasIbanShape(compact))
        {
            return Result<Iban>.Failure(
                "IBAN must be 15 to 34 characters: two letters, two digits, then letters or digits.");
        }

        return PassesMod97(compact)
            ? Result<Iban>.Success(new Iban(compact))
            : Result<Iban>.Failure("IBAN failed the ISO 7064 mod-97 check.");
    }

    /// <summary>Rehydrates a value the database already holds. EF Core value converter only.</summary>
    public static Iban FromPersistedValue(string value) => new(value);

    public override string ToString() => Value;

    private static string Normalise(string raw)
    {
        var builder = new StringBuilder(raw.Length);
        foreach (var character in raw)
        {
            if (!char.IsWhiteSpace(character))
            {
                builder.Append(char.ToUpperInvariant(character));
            }
        }

        return builder.ToString();
    }

    private static bool HasIbanShape(string compact) =>
        compact.Length is >= MinimumLength and <= MaximumLength
        && char.IsAsciiLetterUpper(compact[0])
        && char.IsAsciiLetterUpper(compact[1])
        && char.IsAsciiDigit(compact[2])
        && char.IsAsciiDigit(compact[3])
        && compact.All(character => char.IsAsciiDigit(character) || char.IsAsciiLetterUpper(character));

    /// <summary>
    /// Moves the country code and check digits to the end, maps A..Z to 10..35, and requires
    /// the resulting number to be congruent to 1 modulo 97. The remainder is accumulated a
    /// character at a time so no big-integer arithmetic is needed.
    /// </summary>
    private static bool PassesMod97(string compact)
    {
        var remainder = 0;

        for (var offset = 0; offset < compact.Length; offset++)
        {
            var character = compact[(offset + 4) % compact.Length];
            var characterValue = char.IsAsciiDigit(character)
                ? character - '0'
                : character - 'A' + 10;

            remainder = characterValue > 9
                ? ((remainder * 100) + characterValue) % 97
                : ((remainder * 10) + characterValue) % 97;
        }

        return remainder == 1;
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS — 30 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Common/Iban.cs tests/PeakPower.Domain.Tests/Common/IbanTests.cs
git commit -m "feat(domain): add Iban with the ISO 7064 mod-97 check"
```

---

### Task 10: The seven enums, `Address` and `ContactPerson`

The specification defines three of these enums twice, differently. The shared contract settles
it: the **database spelling is normative**, and the domain-model document is wrong in three
places. The test below pins the exact members so the wrong spellings cannot creep back.

`Address` and `ContactPerson` are immutable records stored as a single `jsonb` column each
(Task 19 wires the conversion). Being records matters: EF Core's change tracker compares them
by value, so a record with the same field values is the same address.

**Files:**
- Create: `src/Core/PeakPower.Domain/Customers/Enums.cs`
- Create: `src/Core/PeakPower.Domain/Common/Address.cs`
- Create: `src/Core/PeakPower.Domain/Common/ContactPerson.cs`
- Test: `tests/PeakPower.Domain.Tests/Customers/EnumSpellingTests.cs`
- Test: `tests/PeakPower.Domain.Tests/Common/ValueRecordTests.cs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PeakPower.Domain.Customers.CustomerStatus { Prospect, Active, Suspended, Closed }`
  - `PeakPower.Domain.Customers.AccountStatus { PendingApproval, Invited, Active, Deactivated }`
  - `PeakPower.Domain.Customers.ProductionExpectation { Unknown, Never, Expected }`
  - `PeakPower.Domain.Customers.ProductionExpectationSource { Contract, GridOperator, Observed, Manual, CustomerDeclared }`
  - `PeakPower.Domain.Customers.Commodity { Electricity }`
  - `PeakPower.Domain.Customers.BankAccountStatus { PendingApproval, Active, Deactivated }`
  - `PeakPower.Domain.Customers.FourEyesAction { AddBankAccount, DeactivateBankAccount, AddUser, Trade, Withdrawal }`
  - `PeakPower.Domain.Common.Address(string Street, string HouseNumber, string? HouseNumberSuffix, string PostalCode, string City, string Country)`
  - `PeakPower.Domain.Common.ContactPerson(string Name, string Email, string? Phone)`

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Customers/EnumSpellingTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.Domain.Customers;

namespace PeakPower.Domain.Tests.Customers;

/// <summary>
/// The specification defines CustomerStatus, AccountStatus, ProductionExpectation and
/// FourEyesAction in two places with different members. Shared contract section 4 takes the
/// database spelling as normative. These tests pin it so the other spelling cannot return.
/// </summary>
public sealed class EnumSpellingTests
{
    [Fact]
    public void CustomerStatus_has_exactly_four_members()
    {
        Enum.GetNames<CustomerStatus>().Should().Equal("Prospect", "Active", "Suspended", "Closed");
    }

    [Fact]
    public void AccountStatus_includes_PendingApproval_which_the_domain_model_document_omits()
    {
        Enum.GetNames<AccountStatus>().Should().Equal("PendingApproval", "Invited", "Active", "Deactivated");
    }

    [Fact]
    public void ProductionExpectation_calls_the_middle_value_Never_not_NotExpected()
    {
        Enum.GetNames<ProductionExpectation>().Should().Equal("Unknown", "Never", "Expected");
    }

    [Fact]
    public void ProductionExpectationSource_has_five_members_including_CustomerDeclared()
    {
        Enum.GetNames<ProductionExpectationSource>().Should()
            .Equal("Contract", "GridOperator", "Observed", "Manual", "CustomerDeclared");
    }

    [Fact]
    public void Commodity_keeps_the_discriminator_but_offers_only_electricity()
    {
        Enum.GetNames<Commodity>().Should().Equal("Electricity");
    }

    [Fact]
    public void BankAccountStatus_has_exactly_three_members()
    {
        Enum.GetNames<BankAccountStatus>().Should().Equal("PendingApproval", "Active", "Deactivated");
    }

    [Fact]
    public void FourEyesAction_has_five_arms_not_four()
    {
        Enum.GetNames<FourEyesAction>().Should()
            .Equal("AddBankAccount", "DeactivateBankAccount", "AddUser", "Trade", "Withdrawal");
    }
}
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Common/ValueRecordTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Tests.Common;

public sealed class ValueRecordTests
{
    [Fact]
    public void Two_addresses_with_the_same_fields_are_equal()
    {
        var first = new Address("Keizersgracht", "104", "B", "1015 CV", "Amsterdam", "NL");
        var second = new Address("Keizersgracht", "104", "B", "1015 CV", "Amsterdam", "NL");

        first.Should().Be(second);
    }

    [Fact]
    public void An_address_that_differs_only_in_its_suffix_is_a_different_address()
    {
        var withSuffix = new Address("Keizersgracht", "104", "B", "1015 CV", "Amsterdam", "NL");
        var withoutSuffix = new Address("Keizersgracht", "104", null, "1015 CV", "Amsterdam", "NL");

        withSuffix.Should().NotBe(withoutSuffix);
    }

    [Fact]
    public void Two_contact_people_with_the_same_fields_are_equal()
    {
        var first = new ContactPerson("Sanne de Vries", "sanne@example.nl", "+31 6 12345678");
        var second = new ContactPerson("Sanne de Vries", "sanne@example.nl", "+31 6 12345678");

        first.Should().Be(second);
    }

    [Fact]
    public void A_contact_person_without_a_phone_number_is_a_different_contact()
    {
        var withPhone = new ContactPerson("Sanne de Vries", "sanne@example.nl", "+31 6 12345678");
        var withoutPhone = new ContactPerson("Sanne de Vries", "sanne@example.nl", null);

        withPhone.Should().NotBe(withoutPhone);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: FAIL with `error CS0246: The type or namespace name 'CustomerStatus' could not be found`

- [ ] **Step 3: Write the minimal implementation**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/Enums.cs`:

```csharp
namespace PeakPower.Domain.Customers;

/// <summary>
/// Every enum in the slice-1 domain, in one file, because the database spelling of each is
/// normative (shared contract section 4) and they must be read together to stay consistent.
/// EF Core persists all of them as SCREAMING_SNAKE text through one convention (Task 18).
/// </summary>

/// <summary>Lifecycle of a customer company. db: PROSPECT | ACTIVE | SUSPENDED | CLOSED</summary>
public enum CustomerStatus
{
    Prospect,
    Active,
    Suspended,
    Closed,
}

/// <summary>
/// Lifecycle of one person's login. db: PENDING_APPROVAL | INVITED | ACTIVE | DEACTIVATED.
/// The domain-model document omits PendingApproval; it is wrong.
/// </summary>
public enum AccountStatus
{
    PendingApproval,
    Invited,
    Active,
    Deactivated,
}

/// <summary>
/// Whether a connection is expected to feed electricity back into the grid.
/// db: UNKNOWN | NEVER | EXPECTED. The domain-model document calls the middle value
/// NotExpected; it is wrong.
/// </summary>
public enum ProductionExpectation
{
    Unknown,
    Never,
    Expected,
}

/// <summary>
/// Where a production expectation came from.
/// db: CONTRACT | GRID_OPERATOR | OBSERVED | MANUAL | CUSTOMER_DECLARED.
/// A customer claiming a connection from the shared pool declares CustomerDeclared. [F01-R54]
/// </summary>
public enum ProductionExpectationSource
{
    Contract,
    GridOperator,
    Observed,
    Manual,
    CustomerDeclared,
}

/// <summary>
/// The traded commodity. db: ELECTRICITY. The discriminator stays so gas can be added later,
/// but GAS is not a selectable value in slice 1.
/// </summary>
public enum Commodity
{
    Electricity,
}

/// <summary>Lifecycle of a customer's bank account record.</summary>
public enum BankAccountStatus
{
    PendingApproval,
    Active,
    Deactivated,
}

/// <summary>
/// Actions that will require a second pair of eyes once four-eyes behaviour ships in phase 2.
/// db: ADD_BANK_ACCOUNT | DEACTIVATE_BANK_ACCOUNT | ADD_USER | TRADE | WITHDRAWAL.
/// The domain-model document lists four arms; it is wrong, there are five.
/// </summary>
public enum FourEyesAction
{
    AddBankAccount,
    DeactivateBankAccount,
    AddUser,
    Trade,
    Withdrawal,
}
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Common/Address.cs`:

```csharp
namespace PeakPower.Domain.Common;

/// <summary>
/// A Dutch postal address. Stored as one jsonb column rather than six flat columns, because
/// nothing in slice 1 queries by street and an address is always read whole.
/// </summary>
/// <param name="Country">ISO 3166-1 alpha-2, "NL" for every slice-1 customer.</param>
public sealed record Address(
    string Street,
    string HouseNumber,
    string? HouseNumberSuffix,
    string PostalCode,
    string City,
    string Country);
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Common/ContactPerson.cs`:

```csharp
namespace PeakPower.Domain.Common;

/// <summary>
/// The named human PeakPower talks to at a customer company. Stored as one jsonb column.
/// This is not a login: <see cref="PeakPower.Domain.Customers.CustomerAccount"/> is.
/// </summary>
public sealed record ContactPerson(
    string Name,
    string Email,
    string? Phone);
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS — 41 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Customers/Enums.cs \
        src/Core/PeakPower.Domain/Common/Address.cs \
        src/Core/PeakPower.Domain/Common/ContactPerson.cs \
        tests/PeakPower.Domain.Tests/Customers/EnumSpellingTests.cs \
        tests/PeakPower.Domain.Tests/Common/ValueRecordTests.cs
git commit -m "feat(domain): add the seven enums in their normative spelling, Address and ContactPerson"
```

---

### Task 11: The `Customer` aggregate

The company. `four_eyes_enabled` is a `[DEC-71]` column that nothing reads until phase 2 — it
ships now because retrofitting a role onto live accounts is worse than shipping an unused
column.

**Files:**
- Create: `src/Core/PeakPower.Domain/Customers/Customer.cs`
- Test: `tests/PeakPower.Domain.Tests/Customers/CustomerTests.cs`

**Interfaces:**
- Consumes: `Result<T>`, `KvkNumber`, `Address`, `ContactPerson`, `CustomerStatus` (Tasks 6, 8, 10).
- Produces: `PeakPower.Domain.Customers.Customer` with the contract's properties plus
  - `static Result<Customer> Create(string legalName, string? tradeName, KvkNumber kvkNumber, string? vatNumber, Address billingAddress, Address? visitingAddress, ContactPerson primaryContact, string? internalReference, string locale)`
  - `Result<Customer> ChangeStatus(CustomerStatus status)`
  - `Result<Customer> UpdateDetails(string legalName, string? tradeName, string? vatNumber, Address billingAddress, Address? visitingAddress, ContactPerson primaryContact, string? internalReference, string locale)`

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Customers/CustomerTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;

namespace PeakPower.Domain.Tests.Customers;

public sealed class CustomerTests
{
    private static readonly Address BillingAddress =
        new("Keizersgracht", "104", null, "1015 CV", "Amsterdam", "NL");

    private static readonly ContactPerson PrimaryContact =
        new("Sanne de Vries", "sanne@example.nl", "+31 6 12345678");

    private static Customer AValidCustomer() => Create("Zonnedak Beheer B.V.").Value;

    private static Result<Customer> Create(string legalName) =>
        Customer.Create(
            legalName,
            tradeName: "Zonnedak",
            kvkNumber: KvkNumber.Create("12345678").Value,
            vatNumber: "NL812345678B01",
            billingAddress: BillingAddress,
            visitingAddress: null,
            primaryContact: PrimaryContact,
            internalReference: null,
            locale: "nl-NL");

    [Fact]
    public void A_new_customer_starts_as_a_prospect_with_four_eyes_off()
    {
        var customer = AValidCustomer();

        customer.Status.Should().Be(CustomerStatus.Prospect);
        customer.FourEyesEnabled.Should().BeFalse();
    }

    [Fact]
    public void A_new_customer_gets_an_identifier()
    {
        AValidCustomer().Id.Should().NotBe(Guid.Empty);
    }

    [Fact]
    public void A_new_customer_keeps_the_details_it_was_created_with()
    {
        var customer = AValidCustomer();

        customer.LegalName.Should().Be("Zonnedak Beheer B.V.");
        customer.TradeName.Should().Be("Zonnedak");
        customer.KvkNumber.Value.Should().Be("12345678");
        customer.BillingAddress.Should().Be(BillingAddress);
        customer.PrimaryContact.Should().Be(PrimaryContact);
        customer.Locale.Should().Be("nl-NL");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void A_customer_without_a_legal_name_is_rejected(string legalName)
    {
        var result = Create(legalName);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Legal name is required.");
    }

    [Fact]
    public void A_blank_locale_falls_back_to_nl_NL()
    {
        var result = Customer.Create(
            "Zonnedak Beheer B.V.", null, KvkNumber.Create("12345678").Value, null,
            BillingAddress, null, PrimaryContact, null, locale: "  ");

        result.Value.Locale.Should().Be("nl-NL");
    }

    [Fact]
    public void A_blank_trade_name_is_stored_as_null_rather_than_whitespace()
    {
        var result = Customer.Create(
            "Zonnedak Beheer B.V.", "   ", KvkNumber.Create("12345678").Value, null,
            BillingAddress, null, PrimaryContact, null, "nl-NL");

        result.Value.TradeName.Should().BeNull();
    }

    [Fact]
    public void A_prospect_can_be_activated()
    {
        var customer = AValidCustomer();

        var result = customer.ChangeStatus(CustomerStatus.Active);

        result.IsSuccess.Should().BeTrue();
        customer.Status.Should().Be(CustomerStatus.Active);
    }

    [Fact]
    public void A_closed_customer_cannot_be_reopened()
    {
        var customer = AValidCustomer();
        customer.ChangeStatus(CustomerStatus.Closed);

        var result = customer.ChangeStatus(CustomerStatus.Active);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("A closed customer cannot change status.");
        customer.Status.Should().Be(CustomerStatus.Closed);
    }

    [Fact]
    public void Updating_the_details_replaces_them_and_leaves_the_KvK_number_alone()
    {
        var customer = AValidCustomer();
        var newAddress = new Address("Prinsengracht", "263", "A", "1016 GV", "Amsterdam", "NL");

        var result = customer.UpdateDetails(
            "Zonnedak Holding B.V.", null, "NL812345678B02", newAddress, null, PrimaryContact,
            "CRM-9911", "nl-NL");

        result.IsSuccess.Should().BeTrue();
        customer.LegalName.Should().Be("Zonnedak Holding B.V.");
        customer.TradeName.Should().BeNull();
        customer.BillingAddress.Should().Be(newAddress);
        customer.InternalReference.Should().Be("CRM-9911");
        customer.KvkNumber.Value.Should().Be("12345678");
    }

    [Fact]
    public void Updating_the_details_to_a_blank_legal_name_is_rejected_and_changes_nothing()
    {
        var customer = AValidCustomer();

        var result = customer.UpdateDetails(
            "  ", null, null, BillingAddress, null, PrimaryContact, null, "nl-NL");

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Legal name is required.");
        customer.LegalName.Should().Be("Zonnedak Beheer B.V.");
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: FAIL with `error CS0246: The type or namespace name 'Customer' could not be found`

- [ ] **Step 3: Write the minimal implementation**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/Customer.cs`:

```csharp
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Customers;

/// <summary>
/// A customer company. Aggregate root. [F01-R01] to [F01-R07]
/// </summary>
public sealed class Customer
{
    /// <summary>EF Core materialises through this; application code uses <see cref="Create"/>.</summary>
    private Customer()
    {
    }

    public Guid Id { get; private set; }

    public string LegalName { get; private set; } = string.Empty;

    public string? TradeName { get; private set; }

    public KvkNumber KvkNumber { get; private set; }

    public string? VatNumber { get; private set; }

    public CustomerStatus Status { get; private set; }

    /// <summary>[DEC-71] — a column in slice 1. Nothing reads it until four-eyes ships in phase 2.</summary>
    public bool FourEyesEnabled { get; private set; }

    public Address BillingAddress { get; private set; } = null!;

    public Address? VisitingAddress { get; private set; }

    public ContactPerson PrimaryContact { get; private set; } = null!;

    public string? InternalReference { get; private set; }

    /// <summary>BCP 47 tag driving number and date formatting. "nl-NL" for every slice-1 customer.</summary>
    public string Locale { get; private set; } = "nl-NL";

    public static Result<Customer> Create(
        string legalName,
        string? tradeName,
        KvkNumber kvkNumber,
        string? vatNumber,
        Address billingAddress,
        Address? visitingAddress,
        ContactPerson primaryContact,
        string? internalReference,
        string locale)
    {
        if (string.IsNullOrWhiteSpace(legalName))
        {
            return Result<Customer>.Failure("Legal name is required.");
        }

        var customer = new Customer
        {
            Id = Guid.CreateVersion7(),
            LegalName = legalName.Trim(),
            TradeName = Blank(tradeName),
            KvkNumber = kvkNumber,
            VatNumber = Blank(vatNumber),
            Status = CustomerStatus.Prospect,
            FourEyesEnabled = false,
            BillingAddress = billingAddress,
            VisitingAddress = visitingAddress,
            PrimaryContact = primaryContact,
            InternalReference = Blank(internalReference),
            Locale = string.IsNullOrWhiteSpace(locale) ? "nl-NL" : locale.Trim(),
        };

        return Result<Customer>.Success(customer);
    }

    public Result<Customer> ChangeStatus(CustomerStatus status)
    {
        if (Status == CustomerStatus.Closed && status != CustomerStatus.Closed)
        {
            return Result<Customer>.Failure("A closed customer cannot change status.");
        }

        Status = status;
        return Result<Customer>.Success(this);
    }

    public Result<Customer> UpdateDetails(
        string legalName,
        string? tradeName,
        string? vatNumber,
        Address billingAddress,
        Address? visitingAddress,
        ContactPerson primaryContact,
        string? internalReference,
        string locale)
    {
        if (string.IsNullOrWhiteSpace(legalName))
        {
            return Result<Customer>.Failure("Legal name is required.");
        }

        LegalName = legalName.Trim();
        TradeName = Blank(tradeName);
        VatNumber = Blank(vatNumber);
        BillingAddress = billingAddress;
        VisitingAddress = visitingAddress;
        PrimaryContact = primaryContact;
        InternalReference = Blank(internalReference);
        Locale = string.IsNullOrWhiteSpace(locale) ? "nl-NL" : locale.Trim();

        return Result<Customer>.Success(this);
    }

    /// <summary>Whitespace-only optional text is null, never "   ".</summary>
    private static string? Blank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS — 52 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Customers/Customer.cs \
        tests/PeakPower.Domain.Tests/Customers/CustomerTests.cs
git commit -m "feat(domain): add the Customer aggregate with its status and detail invariants"
```

---

### Task 12: The `CustomerAccount` aggregate

One person's login at a customer company. `SecurityStamp` is the mechanism that makes
`[F01-R16]`'s *immediate* session revocation hold against a stateless JWT `[DEC-117]`: the stamp
travels in the token, is compared against the row on every request, and bumping it kills every
outstanding token for that account on its next call. Plan 5 wires the check; plan 1 owns the
column and the bump.

`PasswordHash` is nullable because an account created by an employee has no credential until
the person sets one, and because `[DEC-113]`'s Argon2id hashing itself belongs to plan 5.

`SetPassword` and `RecordSuccessfulSignIn` return `void` — contract §5.1's two book-keeping
mutators, neither of which can fail. The hash `SetPassword` stores comes out of
`IPasswordHasher`, never off a form, so a blank one is a caller bug and throws rather than
returning a `Result<T>` nobody would inspect.

**Files:**
- Create: `src/Core/PeakPower.Domain/Customers/CustomerAccount.cs`
- Test: `tests/PeakPower.Domain.Tests/Customers/CustomerAccountTests.cs`

**Interfaces:**
- Consumes: `Result<T>` (Task 6), `AccountStatus` (Task 10).
- Produces: `PeakPower.Domain.Customers.CustomerAccount` with the contract's properties plus
  - `static Result<CustomerAccount> Create(Guid customerId, string username, string firstName, string lastName, string? jobTitle, string email, string? phone, AccountStatus status, bool isAdmin)`
  - `void SetPassword(string passwordHash)` — bumps `SecurityStamp`
  - `Result<CustomerAccount> UpdateProfile(string firstName, string lastName, string? jobTitle, string email, string? phone, bool isAdmin)` — bumps `SecurityStamp`
  - `Result<CustomerAccount> Deactivate()` — bumps `SecurityStamp`
  - `void RecordSuccessfulSignIn(DateTimeOffset at)`
  - `void BumpSecurityStamp()` — plan 5 calls it directly when a password reset revokes sessions

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Customers/CustomerAccountTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;

namespace PeakPower.Domain.Tests.Customers;

public sealed class CustomerAccountTests
{
    private static readonly Guid CustomerId = Guid.Parse("0199a1a0-0000-7000-8000-000000000001");

    private static Result<CustomerAccount> Create(
        string username = "sanne.devries",
        string email = "sanne@example.nl",
        AccountStatus status = AccountStatus.PendingApproval) =>
        CustomerAccount.Create(
            CustomerId, username, "Sanne", "de Vries", "Finance manager", email, "+31 6 12345678",
            status, isAdmin: false);

    [Fact]
    public void A_new_account_belongs_to_its_customer_and_carries_a_security_stamp()
    {
        var account = Create().Value;

        account.Id.Should().NotBe(Guid.Empty);
        account.CustomerId.Should().Be(CustomerId);
        account.SecurityStamp.Should().NotBe(Guid.Empty);
        account.PasswordHash.Should().BeNull();
        account.ExternalSubjectId.Should().BeNull();
        account.LastLoginAt.Should().BeNull();
        account.IsAdmin.Should().BeFalse();
    }

    [Fact]
    public void A_username_is_stored_lower_case_because_the_column_is_citext_and_immutable()
    {
        Create(username: "Sanne.DeVries").Value.Username.Should().Be("sanne.devries");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void An_account_without_a_username_is_rejected(string username)
    {
        var result = Create(username: username);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Username is required.");
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-an-address")]
    public void An_account_without_a_plausible_email_address_is_rejected(string email)
    {
        var result = Create(email: email);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Email address is required and must contain an @.");
    }

    [Fact]
    public void Setting_a_password_bumps_the_security_stamp()
    {
        var account = Create().Value;
        var before = account.SecurityStamp;

        account.SetPassword("$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaA");

        account.PasswordHash.Should().StartWith("$argon2id$");
        account.SecurityStamp.Should().NotBe(before);
    }

    [Fact]
    public void An_empty_password_hash_is_a_caller_bug_and_throws_rather_than_returning_a_failure()
    {
        var account = Create().Value;
        var before = account.SecurityStamp;

        var setting = () => account.SetPassword("   ");

        setting.Should().Throw<ArgumentException>();
        account.SecurityStamp.Should().Be(before);
    }

    [Fact]
    public void Deactivating_an_account_bumps_the_stamp_so_every_outstanding_token_dies()
    {
        var account = Create(status: AccountStatus.Active).Value;
        var before = account.SecurityStamp;

        var result = account.Deactivate();

        result.IsSuccess.Should().BeTrue();
        account.Status.Should().Be(AccountStatus.Deactivated);
        account.SecurityStamp.Should().NotBe(before);
    }

    [Fact]
    public void Deactivating_an_already_deactivated_account_is_rejected()
    {
        var account = Create(status: AccountStatus.Deactivated).Value;

        var result = account.Deactivate();

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Account is already deactivated.");
    }

    [Fact]
    public void Editing_the_profile_bumps_the_stamp_because_F01_R16_says_an_employee_edit_revokes_sessions()
    {
        var account = Create().Value;
        var before = account.SecurityStamp;

        var result = account.UpdateProfile(
            "Sanne", "de Vries-Jansen", null, "sanne.new@example.nl", null, isAdmin: true);

        result.IsSuccess.Should().BeTrue();
        account.LastName.Should().Be("de Vries-Jansen");
        account.JobTitle.Should().BeNull();
        account.Email.Should().Be("sanne.new@example.nl");
        account.IsAdmin.Should().BeTrue();
        account.SecurityStamp.Should().NotBe(before);
    }

    [Fact]
    public void Recording_a_successful_sign_in_stores_the_moment_and_leaves_the_stamp_alone()
    {
        var account = Create().Value;
        var before = account.SecurityStamp;
        var moment = new DateTimeOffset(2026, 8, 26, 9, 30, 0, TimeSpan.Zero);

        account.RecordSuccessfulSignIn(moment);

        account.LastLoginAt.Should().Be(moment);
        account.SecurityStamp.Should().Be(before);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: FAIL with `error CS0246: The type or namespace name 'CustomerAccount' could not be found`

- [ ] **Step 3: Write the minimal implementation**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/CustomerAccount.cs`:

```csharp
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Customers;

/// <summary>
/// One person's login at a customer company. Aggregate root. [F01-R10] to [F01-R21]
/// </summary>
public sealed class CustomerAccount
{
    /// <summary>EF Core materialises through this; application code uses <see cref="Create"/>.</summary>
    private CustomerAccount()
    {
    }

    public Guid Id { get; private set; }

    public Guid CustomerId { get; private set; }

    /// <summary>Unique platform-wide, case-insensitive (citext), and never changed after creation.</summary>
    public string Username { get; private set; } = string.Empty;

    public string FirstName { get; private set; } = string.Empty;

    public string LastName { get; private set; } = string.Empty;

    /// <summary>Descriptive only. Nothing in the platform ever checks it. [F01-R13]</summary>
    public string? JobTitle { get; private set; }

    public string Email { get; private set; } = string.Empty;

    public string? Phone { get; private set; }

    public AccountStatus Status { get; private set; }

    /// <summary>[DEC-71] — a column in slice 1. Nothing reads it until four-eyes ships in phase 2.</summary>
    public bool IsAdmin { get; private set; }

    /// <summary>Argon2id, produced by plan 5's IPasswordHasher. Null until a credential is set. [DEC-113]</summary>
    public string? PasswordHash { get; private set; }

    /// <summary>
    /// Travels in the access token as the "stamp" claim and is compared on every request.
    /// Bumping it kills every outstanding access and refresh token for this account on its
    /// next call, which is how [F01-R16]'s "immediately" holds against a stateless JWT. [DEC-117]
    /// </summary>
    public Guid SecurityStamp { get; private set; }

    /// <summary>Reserved for the Entra subject identifier. Null throughout slice 1.</summary>
    public string? ExternalSubjectId { get; private set; }

    public DateTimeOffset? LastLoginAt { get; private set; }

    public static Result<CustomerAccount> Create(
        Guid customerId,
        string username,
        string firstName,
        string lastName,
        string? jobTitle,
        string email,
        string? phone,
        AccountStatus status,
        bool isAdmin)
    {
        if (customerId == Guid.Empty)
        {
            return Result<CustomerAccount>.Failure("An account must belong to a customer.");
        }

        if (string.IsNullOrWhiteSpace(username))
        {
            return Result<CustomerAccount>.Failure("Username is required.");
        }

        if (string.IsNullOrWhiteSpace(firstName) || string.IsNullOrWhiteSpace(lastName))
        {
            return Result<CustomerAccount>.Failure("First and last name are required.");
        }

        if (!LooksLikeAnEmailAddress(email))
        {
            return Result<CustomerAccount>.Failure("Email address is required and must contain an @.");
        }

        var account = new CustomerAccount
        {
            Id = Guid.CreateVersion7(),
            CustomerId = customerId,
            Username = username.Trim().ToLowerInvariant(),
            FirstName = firstName.Trim(),
            LastName = lastName.Trim(),
            JobTitle = Blank(jobTitle),
            Email = email.Trim(),
            Phone = Blank(phone),
            Status = status,
            IsAdmin = isAdmin,
            SecurityStamp = Guid.CreateVersion7(),
        };

        return Result<CustomerAccount>.Success(account);
    }

    /// <summary>
    /// The hash comes from IPasswordHasher, never from user input, so this cannot fail on a
    /// value a person typed. A blank hash is a caller bug and throws.  [contract section 5.1]
    /// </summary>
    public void SetPassword(string passwordHash)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(passwordHash);

        PasswordHash = passwordHash;
        BumpSecurityStamp();
    }

    public Result<CustomerAccount> UpdateProfile(
        string firstName,
        string lastName,
        string? jobTitle,
        string email,
        string? phone,
        bool isAdmin)
    {
        if (string.IsNullOrWhiteSpace(firstName) || string.IsNullOrWhiteSpace(lastName))
        {
            return Result<CustomerAccount>.Failure("First and last name are required.");
        }

        if (!LooksLikeAnEmailAddress(email))
        {
            return Result<CustomerAccount>.Failure("Email address is required and must contain an @.");
        }

        FirstName = firstName.Trim();
        LastName = lastName.Trim();
        JobTitle = Blank(jobTitle);
        Email = email.Trim();
        Phone = Blank(phone);
        IsAdmin = isAdmin;
        BumpSecurityStamp();

        return Result<CustomerAccount>.Success(this);
    }

    public Result<CustomerAccount> Deactivate()
    {
        if (Status == AccountStatus.Deactivated)
        {
            return Result<CustomerAccount>.Failure("Account is already deactivated.");
        }

        Status = AccountStatus.Deactivated;
        BumpSecurityStamp();
        return Result<CustomerAccount>.Success(this);
    }

    /// <summary>
    /// The moment comes from IMarketCalendar, never from the system clock: architecture fact 5
    /// forbids anything outside PeakPower.Infrastructure.Time from reading it.
    /// </summary>
    public void RecordSuccessfulSignIn(DateTimeOffset at) => LastLoginAt = at;

    /// <summary>
    /// Kills every outstanding token for this account on its next call. Public because plan 5's
    /// password reset revokes sessions without going through any of the mutators above.
    /// </summary>
    public void BumpSecurityStamp() => SecurityStamp = Guid.CreateVersion7();

    private static bool LooksLikeAnEmailAddress(string email) =>
        !string.IsNullOrWhiteSpace(email)
        && email.Contains('@', StringComparison.Ordinal)
        && email.Trim().Length > 2;

    private static string? Blank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS — 64 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Customers/CustomerAccount.cs \
        tests/PeakPower.Domain.Tests/Customers/CustomerAccountTests.cs
git commit -m "feat(domain): add the CustomerAccount aggregate with the security stamp"
```

---

### Task 13: The `MeteringPoint` aggregate

One EAN belonging to one customer for one half-open period `[ValidFrom, ValidTo)`. `[F01-R26]`
and `[AS-03]` require that the same EAN may serve different customers over non-overlapping
periods, and that overlaps be rejected — the database enforces that (Tasks 21 and 22); the
aggregate enforces the single-row invariants.

`DisplayLabel` is `[F01-R30]` and `[F01-R31]` in one line: the friendly name replaces the EAN as
the primary label, and when there is no name the grouped EAN is used instead.

The factory is `Attach`, not `Create`, because `[F01-R23]` is *attach a metering point to a
customer* — the connection exists in the grid whether or not PeakPower knows about it.
`Commodity` is not a parameter: `[DEC-68]` leaves `ELECTRICITY` as the only selectable value, so
the aggregate sets it. Neither is `ValidTo`: a period is closed later, through `EndDate`.
`[contract §5.1]`

**Files:**
- Create: `src/Core/PeakPower.Domain/Customers/MeteringPoint.cs`
- Test: `tests/PeakPower.Domain.Tests/Customers/MeteringPointTests.cs`

**Interfaces:**
- Consumes: `Result<T>`, `EanCode`, `Address` (Tasks 6, 7, 10), `Commodity`,
  `ProductionExpectation`, `ProductionExpectationSource` (Task 10).
- Produces: `PeakPower.Domain.Customers.MeteringPoint` with the contract's properties plus
  - `static Result<MeteringPoint> Attach(Guid customerId, EanCode ean, Guid brpId, ProductionExpectation productionExpectation, ProductionExpectationSource? expectationSource, string? name, string? description, string? gridOperator, decimal? capacityKw, Address? address, DateOnly validFrom)`
  - `Result<MeteringPoint> Rename(string? name, string? description)`
  - `Result<MeteringPoint> UpdateDetails(Guid brpId, ProductionExpectation productionExpectation, ProductionExpectationSource? expectationSource, string? gridOperator, decimal? capacityKw, Address? address)`
  - `Result<MeteringPoint> EndDate(DateOnly validTo)`
  - `string DisplayLabel { get; }`
  - `const int MaximumNameLength = 80` and `const int MaximumDescriptionLength = 500`

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Customers/MeteringPointTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;

namespace PeakPower.Domain.Tests.Customers;

public sealed class MeteringPointTests
{
    private static readonly Guid CustomerId = Guid.Parse("0199a1a0-0000-7000-8000-000000000001");
    private static readonly Guid BrpId = Guid.Parse("0199a1a0-0000-7000-8000-0000000000b1");
    private static readonly EanCode Ean = EanCode.Create("871687100000000011").Value;
    private static readonly DateOnly ValidFrom = new(2026, 1, 1);

    private static Result<MeteringPoint> Attach(
        string? name = null,
        string? description = null,
        Guid? brpId = null,
        decimal? capacityKw = 630m) =>
        MeteringPoint.Attach(
            CustomerId, Ean, brpId ?? BrpId,
            ProductionExpectation.Expected, ProductionExpectationSource.CustomerDeclared,
            name, description, "Liander", capacityKw, address: null, ValidFrom);

    [Fact]
    public void A_new_metering_point_belongs_to_a_customer_and_a_BRP()
    {
        var point = Attach().Value;

        point.Id.Should().NotBe(Guid.Empty);
        point.CustomerId.Should().Be(CustomerId);
        point.BrpId.Should().Be(BrpId);
        point.Ean.Value.Should().Be("871687100000000011");
        point.Commodity.Should().Be(Commodity.Electricity);
        point.ValidFrom.Should().Be(ValidFrom);
        point.ValidTo.Should().BeNull();
    }

    [Fact]
    public void A_metering_point_without_a_BRP_is_rejected_because_F01_R51_makes_it_mandatory()
    {
        var result = Attach(brpId: Guid.Empty);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("A metering point must name a balance responsible party.");
    }

    [Fact]
    public void A_name_of_eighty_characters_is_accepted()
    {
        var name = new string('a', 80);

        Attach(name: name).Value.Name.Should().Be(name);
    }

    [Fact]
    public void A_name_of_eighty_one_characters_is_rejected()
    {
        var result = Attach(name: new string('a', 81));

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Name must be 80 characters or fewer.");
    }

    [Fact]
    public void A_description_of_five_hundred_characters_is_accepted()
    {
        var description = new string('a', 500);

        Attach(description: description).Value.Description.Should().Be(description);
    }

    [Fact]
    public void A_description_of_five_hundred_and_one_characters_is_rejected()
    {
        var result = Attach(description: new string('a', 501));

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Description must be 500 characters or fewer.");
    }

    [Fact]
    public void A_negative_capacity_is_rejected()
    {
        var result = Attach(capacityKw: -1m);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Capacity must not be negative.");
    }

    [Fact]
    public void An_attached_metering_point_is_open_ended_until_someone_end_dates_it()
    {
        Attach().Value.ValidTo.Should().BeNull();
    }

    [Fact]
    public void End_dating_on_the_start_date_is_rejected_because_the_range_is_half_open()
    {
        var point = Attach().Value;

        var result = point.EndDate(ValidFrom);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("The end date must be after the start date.");
        point.ValidTo.Should().BeNull();
    }

    [Fact]
    public void DisplayLabel_is_the_friendly_name_when_there_is_one()
    {
        Attach(name: "Zonnedak dak 1").Value.DisplayLabel.Should().Be("Zonnedak dak 1");
    }

    [Fact]
    public void DisplayLabel_falls_back_to_the_grouped_EAN_when_there_is_no_name()
    {
        Attach().Value.DisplayLabel.Should().Be("8716 8710 0000 0000 11");
    }

    [Fact]
    public void Renaming_replaces_the_name_and_description()
    {
        var point = Attach(name: "Old", description: "Old description").Value;

        var result = point.Rename("Zonnedak dak 2", "Rooftop array, south facing");

        result.IsSuccess.Should().BeTrue();
        point.Name.Should().Be("Zonnedak dak 2");
        point.Description.Should().Be("Rooftop array, south facing");
    }

    [Fact]
    public void Renaming_to_blank_clears_the_name_and_the_label_falls_back_to_the_EAN()
    {
        var point = Attach(name: "Old").Value;

        point.Rename("   ", null);

        point.Name.Should().BeNull();
        point.DisplayLabel.Should().Be("8716 8710 0000 0000 11");
    }

    [Fact]
    public void Renaming_past_eighty_characters_is_rejected_and_changes_nothing()
    {
        var point = Attach(name: "Zonnedak dak 1").Value;

        var result = point.Rename(new string('a', 81), null);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("Name must be 80 characters or fewer.");
        point.Name.Should().Be("Zonnedak dak 1");
    }

    [Fact]
    public void Updating_the_details_replaces_the_BRP_the_expectation_and_the_technical_fields()
    {
        var point = Attach(name: "Zonnedak dak 1").Value;
        var otherBrp = Guid.Parse("0199a1a0-0000-7000-8000-0000000000b2");
        var address = new Address("Keizersgracht", "104", null, "1015 CV", "Amsterdam", "NL");

        var result = point.UpdateDetails(
            otherBrp, ProductionExpectation.Never, ProductionExpectationSource.GridOperator,
            "Stedin", 450m, address);

        result.IsSuccess.Should().BeTrue();
        point.BrpId.Should().Be(otherBrp);
        point.ProductionExpectation.Should().Be(ProductionExpectation.Never);
        point.ExpectationSource.Should().Be(ProductionExpectationSource.GridOperator);
        point.GridOperator.Should().Be("Stedin");
        point.CapacityKw.Should().Be(450m);
        point.Address.Should().Be(address);
        point.Name.Should().Be("Zonnedak dak 1");
    }

    [Fact]
    public void Updating_the_details_without_a_BRP_is_rejected_and_changes_nothing()
    {
        var point = Attach().Value;

        var result = point.UpdateDetails(
            Guid.Empty, ProductionExpectation.Never, null, "Stedin", 450m, address: null);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("A metering point must name a balance responsible party.");
        point.BrpId.Should().Be(BrpId);
    }

    [Fact]
    public void End_dating_sets_the_exclusive_upper_bound()
    {
        var point = Attach().Value;

        var result = point.EndDate(new DateOnly(2026, 7, 1));

        result.IsSuccess.Should().BeTrue();
        point.ValidTo.Should().Be(new DateOnly(2026, 7, 1));
    }

    [Fact]
    public void End_dating_before_the_start_date_is_rejected()
    {
        var point = Attach().Value;

        var result = point.EndDate(new DateOnly(2025, 6, 1));

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("The end date must be after the start date.");
        point.ValidTo.Should().BeNull();
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: FAIL with `error CS0246: The type or namespace name 'MeteringPoint' could not be found`

- [ ] **Step 3: Write the minimal implementation**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/MeteringPoint.cs`:

```csharp
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Customers;

/// <summary>
/// One electricity connection (one EAN) belonging to one customer for one half-open period
/// [ValidFrom, ValidTo). Aggregate root. [F01-R23] to [F01-R31], [F01-R51], [F01-R54]
/// </summary>
/// <remarks>
/// The rule that the same EAN may serve different customers over non-overlapping periods, and
/// that overlaps are rejected, lives in the database as an EXCLUDE USING gist constraint
/// (migration 1). It cannot live here: one aggregate cannot see the others.
/// </remarks>
public sealed class MeteringPoint
{
    public const int MaximumNameLength = 80;
    public const int MaximumDescriptionLength = 500;

    /// <summary>EF Core materialises through this; application code uses <see cref="Attach"/>.</summary>
    private MeteringPoint()
    {
    }

    public Guid Id { get; private set; }

    public Guid CustomerId { get; private set; }

    public EanCode Ean { get; private set; }

    /// <summary>
    /// ELECTRICITY, always. The discriminator stays so the column does not have to be added
    /// later, but [DEC-68] makes it the only selectable value, so Attach sets it.
    /// </summary>
    public Commodity Commodity { get; private set; }

    /// <summary>The balance responsible party. Mandatory. [F01-R51]</summary>
    public Guid BrpId { get; private set; }

    public ProductionExpectation ProductionExpectation { get; private set; }

    public ProductionExpectationSource? ExpectationSource { get; private set; }

    /// <summary>Friendly name, 80 characters or fewer. [F01-R29]</summary>
    public string? Name { get; private set; }

    /// <summary>Free description, 500 characters or fewer. [F01-R29]</summary>
    public string? Description { get; private set; }

    public string? GridOperator { get; private set; }

    public decimal? CapacityKw { get; private set; }

    public Address? Address { get; private set; }

    public DateOnly ValidFrom { get; private set; }

    /// <summary>Exclusive upper bound. Null means "still current".</summary>
    public DateOnly? ValidTo { get; private set; }

    /// <summary>
    /// The name replaces the EAN as the primary label; with no name, the grouped EAN is used
    /// instead. [F01-R30] [F01-R31]
    /// </summary>
    public string DisplayLabel => Name ?? Ean.ToDisplayString();

    /// <summary>
    /// Attaches an existing grid connection to a customer from <paramref name="validFrom"/>
    /// onwards. [F01-R23] The period is open-ended; EndDate closes it.
    /// </summary>
    public static Result<MeteringPoint> Attach(
        Guid customerId,
        EanCode ean,
        Guid brpId,
        ProductionExpectation productionExpectation,
        ProductionExpectationSource? expectationSource,
        string? name,
        string? description,
        string? gridOperator,
        decimal? capacityKw,
        Address? address,
        DateOnly validFrom)
    {
        if (customerId == Guid.Empty)
        {
            return Result<MeteringPoint>.Failure("A metering point must belong to a customer.");
        }

        if (brpId == Guid.Empty)
        {
            return Result<MeteringPoint>.Failure("A metering point must name a balance responsible party.");
        }

        var naming = ValidateNaming(name, description);
        if (!naming.IsSuccess)
        {
            return Result<MeteringPoint>.Failure(naming.Error);
        }

        if (capacityKw is < 0m)
        {
            return Result<MeteringPoint>.Failure("Capacity must not be negative.");
        }

        var point = new MeteringPoint
        {
            Id = Guid.CreateVersion7(),
            CustomerId = customerId,
            Ean = ean,
            Commodity = Commodity.Electricity,
            BrpId = brpId,
            ProductionExpectation = productionExpectation,
            ExpectationSource = expectationSource,
            Name = Blank(name),
            Description = Blank(description),
            GridOperator = Blank(gridOperator),
            CapacityKw = capacityKw,
            Address = address,
            ValidFrom = validFrom,
            ValidTo = null,
        };

        return Result<MeteringPoint>.Success(point);
    }

    /// <summary>Sets the friendly name and description. [F01-R29]</summary>
    public Result<MeteringPoint> Rename(string? name, string? description)
    {
        var naming = ValidateNaming(name, description);
        if (!naming.IsSuccess)
        {
            return Result<MeteringPoint>.Failure(naming.Error);
        }

        Name = Blank(name);
        Description = Blank(description);
        return Result<MeteringPoint>.Success(this);
    }

    /// <summary>
    /// Replaces the fields an employee may edit on an existing connection. The EAN, the customer
    /// and the validity period are not among them: moving an EAN is a new attachment, not an
    /// edit. Name and description are Rename's job.  [F01-R28]
    /// </summary>
    public Result<MeteringPoint> UpdateDetails(
        Guid brpId,
        ProductionExpectation productionExpectation,
        ProductionExpectationSource? expectationSource,
        string? gridOperator,
        decimal? capacityKw,
        Address? address)
    {
        if (brpId == Guid.Empty)
        {
            return Result<MeteringPoint>.Failure("A metering point must name a balance responsible party.");
        }

        if (capacityKw is < 0m)
        {
            return Result<MeteringPoint>.Failure("Capacity must not be negative.");
        }

        BrpId = brpId;
        ProductionExpectation = productionExpectation;
        ExpectationSource = expectationSource;
        GridOperator = Blank(gridOperator);
        CapacityKw = capacityKw;
        Address = address;

        return Result<MeteringPoint>.Success(this);
    }

    /// <summary>Closes the validity period at an exclusive upper bound. [F01-R27]</summary>
    public Result<MeteringPoint> EndDate(DateOnly validTo)
    {
        if (validTo <= ValidFrom)
        {
            return Result<MeteringPoint>.Failure("The end date must be after the start date.");
        }

        ValidTo = validTo;
        return Result<MeteringPoint>.Success(this);
    }

    private static Result<bool> ValidateNaming(string? name, string? description)
    {
        if (Blank(name)?.Length > MaximumNameLength)
        {
            return Result<bool>.Failure($"Name must be {MaximumNameLength} characters or fewer.");
        }

        if (Blank(description)?.Length > MaximumDescriptionLength)
        {
            return Result<bool>.Failure($"Description must be {MaximumDescriptionLength} characters or fewer.");
        }

        return Result<bool>.Success(true);
    }

    private static string? Blank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS — 82 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Customers/MeteringPoint.cs \
        tests/PeakPower.Domain.Tests/Customers/MeteringPointTests.cs
git commit -m "feat(domain): add the MeteringPoint aggregate with naming limits and the EAN fallback label"
```

---

### Task 14: `Brp`, `Wallet` and `AuditRecord`

Three supporting types that migration 1 needs tables for. They are deliberately thin: nothing
in slice 1 puts behaviour on them, and inventing behaviour now would be guessing at plans 2
and 6's work.

- **BRP** — the market participant answerable to the Dutch grid operator for a connection's
  imbalance. Reference data `[F12-R49]`. Contract §3.2 puts `metering.brp` in migration 1, so
  migration 1 also inserts the one row slice 1 has: code `PVNED`, name **`PVNed B.V.`** — that
  exact string, which plan 2's fixture asserts on and plan 6's seeder reads back.
- **Wallet** — one EUR wallet per customer `[F01-R05]`. A stub: movements and the ledger are
  F06 and out of scope. The balance is `numeric(18,6)` and is rounded to two decimals only at
  presentation `[DEC-12]`.
- **AuditRecord** — append-only actor plus before/after `[F01-R06]`. Nothing writes one in
  slice 1: the table and the type exist so `[F01-R06]` has a shape to land in when auditing is
  taken up, and so migration 1 does not have to be amended then.

**Files:**
- Create: `src/Core/PeakPower.Domain/Metering/Brp.cs`
- Create: `src/Core/PeakPower.Domain/Wallets/Wallet.cs`
- Create: `src/Core/PeakPower.Domain/Auditing/AuditRecord.cs`
- Test: `tests/PeakPower.Domain.Tests/Supporting/SupportingTypeTests.cs`

**Interfaces:**
- Consumes: `Result<T>` (Task 6).
- Produces:
  - `PeakPower.Domain.Metering.Brp` — `Guid Id`, `string Code`, `string Name`, `bool IsActive`,
    `static Result<Brp> Create(string code, string name, bool isActive)`
  - `PeakPower.Domain.Wallets.Wallet` — `Guid Id`, `Guid CustomerId`, `string Currency`,
    `decimal Balance`, `static Result<Wallet> CreateEuroWallet(Guid customerId)`
  - `PeakPower.Domain.Auditing.AuditRecord` — `Guid Id`, `DateTimeOffset OccurredAt`,
    `string Actor`, `string Action`, `string EntityType`, `Guid EntityId`, `Guid? CustomerId`,
    `string? Before`, `string? After`,
    `static Result<AuditRecord> Create(DateTimeOffset occurredAt, string actor, string action, string entityType, Guid entityId, Guid? customerId, string? before, string? after)`

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Supporting/SupportingTypeTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.Domain.Auditing;
using PeakPower.Domain.Metering;
using PeakPower.Domain.Wallets;

namespace PeakPower.Domain.Tests.Supporting;

public sealed class SupportingTypeTests
{
    private static readonly Guid CustomerId = Guid.Parse("0199a1a0-0000-7000-8000-000000000001");

    [Fact]
    public void A_BRP_stores_its_code_upper_case_because_market_codes_are_case_insensitive()
    {
        var brp = Brp.Create("pvned", "PVNed B.V.", isActive: true).Value;

        brp.Id.Should().NotBe(Guid.Empty);
        brp.Code.Should().Be("PVNED");
        brp.Name.Should().Be("PVNed B.V.");
        brp.IsActive.Should().BeTrue();
    }

    [Fact]
    public void A_BRP_without_a_code_is_rejected()
    {
        var result = Brp.Create("  ", "PVNed B.V.", isActive: true);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("BRP code is required.");
    }

    [Fact]
    public void A_BRP_without_a_name_is_rejected()
    {
        Brp.Create("PVNED", "  ", isActive: true).Error.Should().Be("BRP name is required.");
    }

    [Fact]
    public void A_new_wallet_is_a_zero_balance_euro_wallet()
    {
        var wallet = Wallet.CreateEuroWallet(CustomerId).Value;

        wallet.Id.Should().NotBe(Guid.Empty);
        wallet.CustomerId.Should().Be(CustomerId);
        wallet.Currency.Should().Be("EUR");
        wallet.Balance.Should().Be(0m);
    }

    [Fact]
    public void A_wallet_without_a_customer_is_rejected()
    {
        var result = Wallet.CreateEuroWallet(Guid.Empty);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("A wallet must belong to a customer.");
    }

    [Fact]
    public void An_audit_record_keeps_the_actor_the_action_and_both_sides_of_the_change()
    {
        var occurredAt = new DateTimeOffset(2026, 8, 26, 9, 30, 0, TimeSpan.Zero);

        var record = AuditRecord.Create(
            occurredAt, "employee:jdoe", "customer.update", "Customer", CustomerId, CustomerId,
            before: "{\"legalName\":\"Old\"}", after: "{\"legalName\":\"New\"}").Value;

        record.Id.Should().NotBe(Guid.Empty);
        record.OccurredAt.Should().Be(occurredAt);
        record.Actor.Should().Be("employee:jdoe");
        record.Action.Should().Be("customer.update");
        record.EntityType.Should().Be("Customer");
        record.EntityId.Should().Be(CustomerId);
        record.CustomerId.Should().Be(CustomerId);
        record.Before.Should().Be("{\"legalName\":\"Old\"}");
        record.After.Should().Be("{\"legalName\":\"New\"}");
    }

    [Fact]
    public void An_audit_record_without_an_actor_is_rejected_because_an_anonymous_audit_is_no_audit()
    {
        var result = AuditRecord.Create(
            DateTimeOffset.UnixEpoch, "  ", "customer.update", "Customer", CustomerId, null, null, null);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be("An audit record must name its actor.");
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: FAIL with `error CS0246: The type or namespace name 'Brp' could not be found`

- [ ] **Step 3: Write the minimal implementation**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/Brp.cs`:

```csharp
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Metering;

/// <summary>
/// A balance responsible party: the market participant answerable to the Dutch grid operator
/// for a connection's imbalance. Reference data. [F12-R49]
/// </summary>
public sealed class Brp
{
    /// <summary>EF Core materialises through this; application code uses <see cref="Create"/>.</summary>
    private Brp()
    {
    }

    public Guid Id { get; private set; }

    /// <summary>The market party code, stored upper case.</summary>
    public string Code { get; private set; } = string.Empty;

    public string Name { get; private set; } = string.Empty;

    public bool IsActive { get; private set; }

    public static Result<Brp> Create(string code, string name, bool isActive)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            return Result<Brp>.Failure("BRP code is required.");
        }

        if (string.IsNullOrWhiteSpace(name))
        {
            return Result<Brp>.Failure("BRP name is required.");
        }

        return Result<Brp>.Success(new Brp
        {
            Id = Guid.CreateVersion7(),
            Code = code.Trim().ToUpperInvariant(),
            Name = name.Trim(),
            IsActive = isActive,
        });
    }
}
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Wallets/Wallet.cs`:

```csharp
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Wallets;

/// <summary>
/// One EUR wallet per customer. [F01-R05] A stub in slice 1: movements and the ledger are F06
/// and out of scope. The balance is numeric(18,6) and is rounded to two decimals only at
/// presentation. [DEC-12]
/// </summary>
public sealed class Wallet
{
    /// <summary>EF Core materialises through this; application code uses <see cref="CreateEuroWallet"/>.</summary>
    private Wallet()
    {
    }

    public Guid Id { get; private set; }

    public Guid CustomerId { get; private set; }

    /// <summary>ISO 4217. "EUR" for every slice-1 wallet.</summary>
    public string Currency { get; private set; } = "EUR";

    public decimal Balance { get; private set; }

    public static Result<Wallet> CreateEuroWallet(Guid customerId)
    {
        if (customerId == Guid.Empty)
        {
            return Result<Wallet>.Failure("A wallet must belong to a customer.");
        }

        return Result<Wallet>.Success(new Wallet
        {
            Id = Guid.CreateVersion7(),
            CustomerId = customerId,
            Currency = "EUR",
            Balance = 0m,
        });
    }
}
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Auditing/AuditRecord.cs`:

```csharp
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Auditing;

/// <summary>
/// One append-only audit entry: who did what to which entity, and what it looked like on both
/// sides of the change. [F01-R06] Before and After hold JSON documents as text; the column is
/// jsonb, so the database parses and validates them.
/// </summary>
public sealed class AuditRecord
{
    /// <summary>EF Core materialises through this; application code uses <see cref="Create"/>.</summary>
    private AuditRecord()
    {
    }

    public Guid Id { get; private set; }

    /// <summary>Supplied by IMarketCalendar, never by the system clock (architecture fact 5).</summary>
    public DateTimeOffset OccurredAt { get; private set; }

    /// <summary>Who acted, for example "employee:jdoe" or "account:0199a1a0-...".</summary>
    public string Actor { get; private set; } = string.Empty;

    public string Action { get; private set; } = string.Empty;

    public string EntityType { get; private set; } = string.Empty;

    public Guid EntityId { get; private set; }

    /// <summary>The tenant the change belongs to, when there is one.</summary>
    public Guid? CustomerId { get; private set; }

    public string? Before { get; private set; }

    public string? After { get; private set; }

    public static Result<AuditRecord> Create(
        DateTimeOffset occurredAt,
        string actor,
        string action,
        string entityType,
        Guid entityId,
        Guid? customerId,
        string? before,
        string? after)
    {
        if (string.IsNullOrWhiteSpace(actor))
        {
            return Result<AuditRecord>.Failure("An audit record must name its actor.");
        }

        if (string.IsNullOrWhiteSpace(action))
        {
            return Result<AuditRecord>.Failure("An audit record must name its action.");
        }

        if (string.IsNullOrWhiteSpace(entityType))
        {
            return Result<AuditRecord>.Failure("An audit record must name the entity type it describes.");
        }

        return Result<AuditRecord>.Success(new AuditRecord
        {
            Id = Guid.CreateVersion7(),
            OccurredAt = occurredAt,
            Actor = actor.Trim(),
            Action = action.Trim(),
            EntityType = entityType.Trim(),
            EntityId = entityId,
            CustomerId = customerId,
            Before = before,
            After = after,
        });
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS — 89 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Metering/Brp.cs \
        src/Core/PeakPower.Domain/Wallets/Wallet.cs \
        src/Core/PeakPower.Domain/Auditing/AuditRecord.cs \
        tests/PeakPower.Domain.Tests/Supporting/SupportingTypeTests.cs
git commit -m "feat(domain): add Brp, Wallet and AuditRecord"
```

---

### Task 15: `IMarketCalendar` — the only source of "now"

`[DEC-08]` puts business days in Europe/Amsterdam behind one calendar service, and architecture
fact 5 makes that the only place in the solution allowed to read the system clock. This task
declares the port; Task 17 implements it.

The two members are what the contract says and nothing more. `UtcNow` is what timestamps are
written with — the database stores `timestamptz` in UTC `[design §5.2]`. `TodayInAmsterdam` is
what business dates are compared against, because a Dutch working day is not a UTC day: on
2026-08-26 at 23:30 UTC it is already 2026-08-27 in Amsterdam.

**Files:**
- Create: `src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs`
- Test: `tests/PeakPower.Application.Tests/Abstractions/MarketCalendarPortTests.cs`

**Interfaces:**
- Consumes: nothing.
- Produces: `PeakPower.Application.Abstractions.IMarketCalendar` with
  `DateTimeOffset UtcNow { get; }` and `DateOnly TodayInAmsterdam { get; }`.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Abstractions/MarketCalendarPortTests.cs`:

```csharp
using FluentAssertions;
using NSubstitute;
using PeakPower.Application.Abstractions;

namespace PeakPower.Application.Tests.Abstractions;

/// <summary>
/// The port must be substitutable, because every use case that needs a date takes it as a
/// dependency rather than reading the clock. If this stops compiling, architecture fact 5 has
/// nowhere to send callers.
/// </summary>
public sealed class MarketCalendarPortTests
{
    [Fact]
    public void The_calendar_can_be_substituted_so_use_cases_never_need_the_wall_clock()
    {
        var calendar = Substitute.For<IMarketCalendar>();
        calendar.UtcNow.Returns(new DateTimeOffset(2026, 8, 26, 21, 30, 0, TimeSpan.Zero));
        calendar.TodayInAmsterdam.Returns(new DateOnly(2026, 8, 26));

        calendar.UtcNow.Should().Be(new DateTimeOffset(2026, 8, 26, 21, 30, 0, TimeSpan.Zero));
        calendar.TodayInAmsterdam.Should().Be(new DateOnly(2026, 8, 26));
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests --nologo`
Expected: FAIL with `error CS0246: The type or namespace name 'IMarketCalendar' could not be found`

- [ ] **Step 3: Write the minimal implementation**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs`:

```csharp
namespace PeakPower.Application.Abstractions;

/// <summary>
/// The only source of "now" in the platform. [DEC-08]
/// </summary>
/// <remarks>
/// Architecture fact 5 forbids any type outside PeakPower.Infrastructure.Time from calling
/// DateTime.Now, DateTime.UtcNow, DateTimeOffset.Now, DateTimeOffset.UtcNow or DateTime.Today.
/// Everything that needs a moment or a date takes this port instead, which is what makes the
/// tests deterministic and business days Dutch rather than whatever the machine is set to.
/// </remarks>
public interface IMarketCalendar
{
    /// <summary>The current instant in UTC. Timestamps are stored as timestamptz in UTC.</summary>
    DateTimeOffset UtcNow { get; }

    /// <summary>
    /// Today's date in Europe/Amsterdam. Not the same as UtcNow.Date: at 23:30 UTC on
    /// 26 August 2026 it is already 27 August in Amsterdam.
    /// </summary>
    DateOnly TodayInAmsterdam { get; }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests --nologo`
Expected: PASS — 1 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs \
        tests/PeakPower.Application.Tests/Abstractions/MarketCalendarPortTests.cs
git commit -m "feat(application): add the IMarketCalendar port, the only source of now"
```

---

### Task 16: The three ports plan 5 implements — hashing, tokens and mail

Contract §6 declares six ports in `PeakPower.Application.Abstractions`. `IMarketCalendar` is
Task 15's; plan 2 writes `ICustomerContext` and `IEmployeeContext` when it has something to put
behind them. The remaining three — `IPasswordHasher`, `ITokenIssuer` and `IEmailSender` — are
declared here, in this plan, even though plan 5 writes every implementation, because a port is
part of the module graph rather than part of the feature: `PeakPower.Application` is the only
project allowed to name them (architecture fact 2), and a plan that both declares and implements
its own port has no seam to test against.

They are inert until plan 5 arrives. That is the point: the interfaces compile, they are
substitutable, and `PeakPower.Infrastructure.Identity` and `PeakPower.Infrastructure.Email` are
already in the solution waiting for them.

`AccessToken` travels with `ITokenIssuer`, in the same file, because it has no meaning apart
from it. `IssueRefreshToken` reports its expiry through an `out` parameter rather than a second
record: the refresh token is an opaque string, and plan 5 stores its hash and its expiry as two
columns.

**Files:**
- Create: `src/Core/PeakPower.Application/Abstractions/IPasswordHasher.cs`
- Create: `src/Core/PeakPower.Application/Abstractions/ITokenIssuer.cs`
- Create: `src/Core/PeakPower.Application/Abstractions/IEmailSender.cs`
- Test: `tests/PeakPower.Application.Tests/Abstractions/PortShapeTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Domain.Customers.CustomerAccount` (Task 12) — `ITokenIssuer` issues a
  token *for an account*, so the port names the aggregate.
- Produces, all in `PeakPower.Application.Abstractions`:
  - `IPasswordHasher` with `string Hash(string password)` and
    `bool Verify(string password, string hash)` — Argon2id `[DEC-113]`, implemented by plan 5 in
    `PeakPower.Infrastructure.Identity`
  - `ITokenIssuer` with `AccessToken IssueAccessToken(CustomerAccount account)` and
    `string IssueRefreshToken(Guid accountId, out DateTimeOffset expiresAt)` — ES256 over JWKS
    `[DEC-117]`, implemented by plan 5 in `PeakPower.Infrastructure.Identity`
  - `sealed record AccessToken(string Jwt, DateTimeOffset ExpiresAt)`
  - `IEmailSender` with
    `Task SendAsync(string to, string subject, string body, CancellationToken ct)` — implemented
    by plan 5 in `PeakPower.Infrastructure.Email` as a console sink

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Abstractions/PortShapeTests.cs`:

```csharp
using FluentAssertions;
using NSubstitute;
using PeakPower.Application.Abstractions;
using PeakPower.Domain.Customers;

namespace PeakPower.Application.Tests.Abstractions;

/// <summary>
/// Plan 5 implements all three of these. This plan only has to prove they are declared where
/// the contract says, and that they are substitutable — a port that cannot be faked is not a
/// seam, it is a dependency wearing an interface.
/// </summary>
public sealed class PortShapeTests
{
    [Fact]
    public void The_password_hasher_hashes_and_verifies_without_the_caller_knowing_Argon2id()
    {
        var hasher = Substitute.For<IPasswordHasher>();
        hasher.Hash("correct horse").Returns("$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaA");
        hasher.Verify("correct horse", Arg.Any<string>()).Returns(true);

        var hash = hasher.Hash("correct horse");

        hash.Should().StartWith("$argon2id$");
        hasher.Verify("correct horse", hash).Should().BeTrue();
    }

    [Fact]
    public void An_access_token_carries_its_own_expiry_so_nobody_re_derives_the_fifteen_minutes()
    {
        var expiresAt = new DateTimeOffset(2026, 8, 26, 21, 45, 0, TimeSpan.Zero);

        var token = new AccessToken("header.payload.signature", expiresAt);

        token.Jwt.Should().Be("header.payload.signature");
        token.ExpiresAt.Should().Be(expiresAt);
    }

    [Fact]
    public void The_token_issuer_issues_an_access_token_for_an_account_and_a_refresh_token_with_an_expiry()
    {
        var account = CustomerAccount.Create(
            Guid.Parse("0199a1a0-0000-7000-8000-000000000001"), "sanne.devries", "Sanne",
            "de Vries", null, "sanne@example.nl", null, AccountStatus.Active, isAdmin: false).Value;

        var accessExpiry = new DateTimeOffset(2026, 8, 26, 21, 45, 0, TimeSpan.Zero);
        var refreshExpiry = new DateTimeOffset(2026, 9, 9, 21, 30, 0, TimeSpan.Zero);

        var issuer = Substitute.For<ITokenIssuer>();
        issuer.IssueAccessToken(account).Returns(new AccessToken("header.payload.signature", accessExpiry));
        issuer.IssueRefreshToken(account.Id, out Arg.Any<DateTimeOffset>())
            .Returns(call =>
            {
                call[1] = refreshExpiry;
                return "opaque-refresh-token";
            });

        var access = issuer.IssueAccessToken(account);
        var refresh = issuer.IssueRefreshToken(account.Id, out var actualRefreshExpiry);

        access.ExpiresAt.Should().Be(accessExpiry);
        refresh.Should().Be("opaque-refresh-token");
        actualRefreshExpiry.Should().Be(refreshExpiry);
    }

    [Fact]
    public async Task The_email_sender_takes_a_cancellation_token_because_it_talks_to_the_outside()
    {
        var sender = Substitute.For<IEmailSender>();

        await sender.SendAsync(
            "sanne@example.nl", "Set your password", "Follow the link.", TestContext.Current.CancellationToken);

        await sender.Received(1).SendAsync(
            "sanne@example.nl", "Set your password", "Follow the link.", Arg.Any<CancellationToken>());
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests --nologo`
Expected: FAIL with `error CS0246: The type or namespace name 'IPasswordHasher' could not be found`

- [ ] **Step 3: Write the minimal implementation**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/IPasswordHasher.cs`:

```csharp
namespace PeakPower.Application.Abstractions;

/// <summary>
/// Argon2id password hashing. [DEC-113]
/// </summary>
/// <remarks>
/// Declared here so that nothing in the application layer names a hashing library. Plan 5
/// implements it in PeakPower.Infrastructure.Identity over Konscious.Security.Cryptography.Argon2;
/// the parameters (memory, iterations, parallelism) are the implementation's business and never
/// leak through this port.
/// </remarks>
public interface IPasswordHasher
{
    /// <summary>Returns an encoded hash that carries its own salt and parameters.</summary>
    string Hash(string password);

    /// <summary>Constant-time comparison against an encoded hash produced by <see cref="Hash"/>.</summary>
    bool Verify(string password, string hash);
}
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/ITokenIssuer.cs`:

```csharp
using PeakPower.Domain.Customers;

namespace PeakPower.Application.Abstractions;

/// <summary>One issued access token and the moment it stops being accepted.</summary>
public sealed record AccessToken(string Jwt, DateTimeOffset ExpiresAt);

/// <summary>
/// Issues the customer session credentials. ES256 over JWKS. [DEC-117]
/// </summary>
/// <remarks>
/// The access token carries sub, customer_id, is_admin, amr and stamp (shared contract section 7)
/// and lives fifteen minutes; the refresh token is opaque, lives fourteen days, rotates and is
/// stored hashed. Plan 5 implements this in PeakPower.Infrastructure.Identity. Nothing in the
/// application layer may build a JWT itself.
/// </remarks>
public interface ITokenIssuer
{
    /// <summary>
    /// Issues an access token for one account. Takes the aggregate rather than loose values so
    /// that the SecurityStamp claim cannot drift away from the row it revokes against.
    /// </summary>
    AccessToken IssueAccessToken(CustomerAccount account);

    /// <summary>
    /// Issues an opaque refresh token and reports when it expires. The caller stores the hash
    /// and the expiry; the plaintext goes into the pp_refresh cookie and is never persisted.
    /// </summary>
    string IssueRefreshToken(Guid accountId, out DateTimeOffset expiresAt);
}
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/IEmailSender.cs`:

```csharp
namespace PeakPower.Application.Abstractions;

/// <summary>
/// Outbound mail. A console sink in slice 1 [design §4.2]; a real transport later.
/// </summary>
/// <remarks>
/// The onboarding wizard and the password-reset flow need a channel, not a vendor, so this is
/// deliberately the smallest thing that can carry one message. Plan 5 implements it in
/// PeakPower.Infrastructure.Email.
/// </remarks>
public interface IEmailSender
{
    Task SendAsync(string to, string subject, string body, CancellationToken ct);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests --nologo`
Expected: PASS — 5 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Application/Abstractions/IPasswordHasher.cs \
        src/Core/PeakPower.Application/Abstractions/ITokenIssuer.cs \
        src/Core/PeakPower.Application/Abstractions/IEmailSender.cs \
        tests/PeakPower.Application.Tests/Abstractions/PortShapeTests.cs
git commit -m "feat(application): declare the password hasher, token issuer and email sender ports"
```

---

### Task 17: `MarketCalendar` — the one place allowed to read the clock

`PeakPower.Infrastructure.Time` is the assembly architecture fact 5 exempts. Even here the
implementation takes `TimeProvider` rather than calling `DateTimeOffset.UtcNow` directly, so
the test can move time without moving the machine — and because `TimeProvider.System` is a BCL
call, not a `get_UtcNow` call in our IL, fact 5 stays satisfied for the right reason.

**Files:**
- Create: `src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs`
- Create: `src/Infrastructure/PeakPower.Infrastructure.Time/TimeServiceCollectionExtensions.cs`
- Test: `tests/PeakPower.Application.Tests/Time/MarketCalendarTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Application.Abstractions.IMarketCalendar` (Task 15).
- Produces:
  - `PeakPower.Infrastructure.Time.MarketCalendar : IMarketCalendar` with the constructor
    `MarketCalendar(TimeProvider timeProvider)` and
    `public static readonly TimeZoneInfo AmsterdamTimeZone`
  - `PeakPower.Infrastructure.Time.TimeServiceCollectionExtensions.AddMarketCalendar(IServiceCollection services)`
    — registers `TimeProvider.System` and `IMarketCalendar` as singletons. Plans 2, 5 and 6 call
    this from their composition root.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Time/MarketCalendarTests.cs`:

```csharp
using FluentAssertions;
using Microsoft.Extensions.Time.Testing;
using PeakPower.Infrastructure.Time;

namespace PeakPower.Application.Tests.Time;

public sealed class MarketCalendarTests
{
    [Fact]
    public void UtcNow_is_whatever_the_time_provider_says()
    {
        var moment = new DateTimeOffset(2026, 8, 26, 21, 30, 0, TimeSpan.Zero);
        var calendar = new MarketCalendar(new FakeTimeProvider(moment));

        calendar.UtcNow.Should().Be(moment);
    }

    [Fact]
    public void Today_in_Amsterdam_is_the_next_day_when_UTC_is_still_on_the_previous_evening()
    {
        // 21:30 UTC in August is 23:30 in Amsterdam (CEST, UTC+2) - still the 26th.
        var stillTheTwentySixth = new MarketCalendar(
            new FakeTimeProvider(new DateTimeOffset(2026, 8, 26, 21, 30, 0, TimeSpan.Zero)));

        // 22:30 UTC in August is 00:30 in Amsterdam - already the 27th.
        var alreadyTheTwentySeventh = new MarketCalendar(
            new FakeTimeProvider(new DateTimeOffset(2026, 8, 26, 22, 30, 0, TimeSpan.Zero)));

        stillTheTwentySixth.TodayInAmsterdam.Should().Be(new DateOnly(2026, 8, 26));
        alreadyTheTwentySeventh.TodayInAmsterdam.Should().Be(new DateOnly(2026, 8, 27));
    }

    [Fact]
    public void Today_in_Amsterdam_uses_winter_time_in_January()
    {
        // 23:30 UTC in January is 00:30 in Amsterdam (CET, UTC+1) - already the next day.
        var calendar = new MarketCalendar(
            new FakeTimeProvider(new DateTimeOffset(2026, 1, 15, 23, 30, 0, TimeSpan.Zero)));

        calendar.TodayInAmsterdam.Should().Be(new DateOnly(2026, 1, 16));
    }

    [Fact]
    public void The_Amsterdam_time_zone_resolves_on_this_machine()
    {
        MarketCalendar.AmsterdamTimeZone.Id.Should().BeOneOf("Europe/Amsterdam", "W. Europe Standard Time");
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests --nologo`
Expected: FAIL with `error CS0246: The type or namespace name 'MarketCalendar' could not be found`

- [ ] **Step 3: Write the minimal implementation**

First add the DI package the extension needs:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
python3 - <<'PY'
from pathlib import Path
path = Path("src/Infrastructure/PeakPower.Infrastructure.Time/PeakPower.Infrastructure.Time.csproj")
text = path.read_text()
addition = """  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
  </ItemGroup>
</Project>"""
path.write_text(text.replace("</Project>", addition))
PY
```

`Microsoft.Extensions.DependencyInjection.Abstractions` ships in the ASP.NET Core shared
framework, so the `FrameworkReference` above is all that is needed for `IServiceCollection`.

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs`:

```csharp
using PeakPower.Application.Abstractions;

namespace PeakPower.Infrastructure.Time;

/// <summary>
/// The single implementation of <see cref="IMarketCalendar"/>, and the only type in the
/// solution allowed to reach the clock at all (architecture fact 5).
/// </summary>
/// <remarks>
/// It reads <see cref="TimeProvider"/> rather than the static clock properties, which keeps the
/// class itself testable and keeps our IL free of get_UtcNow call sites.
/// </remarks>
public sealed class MarketCalendar(TimeProvider timeProvider) : IMarketCalendar
{
    /// <summary>
    /// Europe/Amsterdam. .NET resolves IANA identifiers on every supported platform through
    /// ICU, so this works on macOS, Linux and Windows alike.
    /// </summary>
    public static readonly TimeZoneInfo AmsterdamTimeZone =
        TimeZoneInfo.FindSystemTimeZoneById("Europe/Amsterdam");

    public DateTimeOffset UtcNow => timeProvider.GetUtcNow();

    public DateOnly TodayInAmsterdam =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(UtcNow, AmsterdamTimeZone).DateTime);
}
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/TimeServiceCollectionExtensions.cs`:

```csharp
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PeakPower.Application.Abstractions;

namespace PeakPower.Infrastructure.Time;

/// <summary>Composition-root registration for the calendar. Every host calls this once.</summary>
public static class TimeServiceCollectionExtensions
{
    public static IServiceCollection AddMarketCalendar(this IServiceCollection services)
    {
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<IMarketCalendar, MarketCalendar>();
        return services;
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests --nologo`
Expected: PASS — 9 passed, 0 failed

Then confirm the guard rail still holds, because this task is the one that touches time:

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Architecture.Tests --nologo`
Expected: PASS — 5 passed, 1 skipped, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Infrastructure.Time \
        tests/PeakPower.Application.Tests/Time/MarketCalendarTests.cs
git commit -m "feat(time): add MarketCalendar, the only type allowed to read the clock"
```

---

### Task 18: The enum-to-text converter and the convention that applies it

Shared contract §4: *all enums persist as text, via a single EF Core value converter registered
by convention, not one converter per property.* The database spelling is SCREAMING_SNAKE, so
`AccountStatus.PendingApproval` is stored as `PENDING_APPROVAL`.

`PeakPower.Persistence` unit tests that need no database live in `PeakPower.Integration.Tests`;
the design's four test projects have no separate persistence project, and splitting one out for
two files would be worse.

**Files:**
- Create: `src/Infrastructure/PeakPower.Persistence/Conversions/EnumToScreamingSnakeConverter.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/Conversions/EnumToTextConvention.cs`
- Test: `tests/PeakPower.Integration.Tests/Conversions/EnumToScreamingSnakeConverterTests.cs`

**Interfaces:**
- Consumes: the seven enums from Task 10.
- Produces:
  - `PeakPower.Persistence.Conversions.EnumToScreamingSnakeConverter<TEnum> : ValueConverter<TEnum, string> where TEnum : struct, Enum`
    with `static string ToScreamingSnake(TEnum value)` and `static TEnum FromScreamingSnake(string text)`
  - `PeakPower.Persistence.Conversions.EnumToTextConvention : IModelFinalizingConvention`

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Conversions/EnumToScreamingSnakeConverterTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.Domain.Customers;
using PeakPower.Persistence.Conversions;

namespace PeakPower.Integration.Tests.Conversions;

public sealed class EnumToScreamingSnakeConverterTests
{
    [Theory]
    [InlineData(AccountStatus.PendingApproval, "PENDING_APPROVAL")]
    [InlineData(AccountStatus.Invited, "INVITED")]
    [InlineData(AccountStatus.Active, "ACTIVE")]
    [InlineData(AccountStatus.Deactivated, "DEACTIVATED")]
    public void AccountStatus_uses_the_database_spelling(AccountStatus value, string expected)
    {
        EnumToScreamingSnakeConverter<AccountStatus>.ToScreamingSnake(value).Should().Be(expected);
    }

    [Theory]
    [InlineData(ProductionExpectationSource.GridOperator, "GRID_OPERATOR")]
    [InlineData(ProductionExpectationSource.CustomerDeclared, "CUSTOMER_DECLARED")]
    [InlineData(ProductionExpectationSource.Contract, "CONTRACT")]
    public void ProductionExpectationSource_uses_the_database_spelling(
        ProductionExpectationSource value, string expected)
    {
        EnumToScreamingSnakeConverter<ProductionExpectationSource>.ToScreamingSnake(value).Should().Be(expected);
    }

    [Theory]
    [InlineData(FourEyesAction.AddBankAccount, "ADD_BANK_ACCOUNT")]
    [InlineData(FourEyesAction.DeactivateBankAccount, "DEACTIVATE_BANK_ACCOUNT")]
    [InlineData(FourEyesAction.Trade, "TRADE")]
    public void FourEyesAction_uses_the_database_spelling(FourEyesAction value, string expected)
    {
        EnumToScreamingSnakeConverter<FourEyesAction>.ToScreamingSnake(value).Should().Be(expected);
    }

    [Fact]
    public void ProductionExpectation_stores_the_middle_value_as_NEVER()
    {
        EnumToScreamingSnakeConverter<ProductionExpectation>.ToScreamingSnake(ProductionExpectation.Never)
            .Should().Be("NEVER");
    }

    [Fact]
    public void Commodity_stores_as_ELECTRICITY()
    {
        EnumToScreamingSnakeConverter<Commodity>.ToScreamingSnake(Commodity.Electricity)
            .Should().Be("ELECTRICITY");
    }

    [Theory]
    [InlineData("PENDING_APPROVAL", AccountStatus.PendingApproval)]
    [InlineData("DEACTIVATED", AccountStatus.Deactivated)]
    public void The_database_spelling_reads_back_as_the_enum(string text, AccountStatus expected)
    {
        EnumToScreamingSnakeConverter<AccountStatus>.FromScreamingSnake(text).Should().Be(expected);
    }

    [Fact]
    public void Every_member_of_every_slice_1_enum_round_trips()
    {
        RoundTrips<CustomerStatus>();
        RoundTrips<AccountStatus>();
        RoundTrips<ProductionExpectation>();
        RoundTrips<ProductionExpectationSource>();
        RoundTrips<Commodity>();
        RoundTrips<BankAccountStatus>();
        RoundTrips<FourEyesAction>();
    }

    [Fact]
    public void The_converter_itself_maps_the_model_value_to_the_provider_value()
    {
        var converter = new EnumToScreamingSnakeConverter<CustomerStatus>();

        converter.ConvertToProvider(CustomerStatus.Suspended).Should().Be("SUSPENDED");
        converter.ConvertFromProvider("SUSPENDED").Should().Be(CustomerStatus.Suspended);
    }

    private static void RoundTrips<TEnum>() where TEnum : struct, Enum
    {
        foreach (var value in Enum.GetValues<TEnum>())
        {
            var text = EnumToScreamingSnakeConverter<TEnum>.ToScreamingSnake(value);
            EnumToScreamingSnakeConverter<TEnum>.FromScreamingSnake(text)
                .Should().Be(value, "{0} must survive a round trip through \"{1}\"", value, text);
        }
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo`
Expected: FAIL with
`error CS0246: The type or namespace name 'EnumToScreamingSnakeConverter<>' could not be found`

- [ ] **Step 3: Write the minimal implementation**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Conversions/EnumToScreamingSnakeConverter.cs`:

```csharp
using System.Text;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace PeakPower.Persistence.Conversions;

/// <summary>
/// Stores an enum as its SCREAMING_SNAKE database spelling: PendingApproval becomes
/// PENDING_APPROVAL. Shared contract section 4 makes the database spelling normative.
/// </summary>
/// <remarks>
/// Text, not an integer, because a migration that renumbers an enum is silent and catastrophic,
/// and because a human reading the table should be able to tell what a row means.
/// </remarks>
public sealed class EnumToScreamingSnakeConverter<TEnum> : ValueConverter<TEnum, string>
    where TEnum : struct, Enum
{
    public EnumToScreamingSnakeConverter()
        : base(value => ToScreamingSnake(value), text => FromScreamingSnake(text))
    {
    }

    public static string ToScreamingSnake(TEnum value)
    {
        var name = value.ToString();
        var builder = new StringBuilder(name.Length + 4);

        for (var index = 0; index < name.Length; index++)
        {
            if (index > 0 && char.IsUpper(name[index]))
            {
                builder.Append('_');
            }

            builder.Append(char.ToUpperInvariant(name[index]));
        }

        return builder.ToString();
    }

    public static TEnum FromScreamingSnake(string text)
    {
        var builder = new StringBuilder(text.Length);
        var startOfWord = true;

        foreach (var character in text)
        {
            if (character == '_')
            {
                startOfWord = true;
                continue;
            }

            builder.Append(startOfWord ? char.ToUpperInvariant(character) : char.ToLowerInvariant(character));
            startOfWord = false;
        }

        return Enum.Parse<TEnum>(builder.ToString());
    }
}
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Conversions/EnumToTextConvention.cs`:

```csharp
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Metadata.Conventions;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace PeakPower.Persistence.Conversions;

/// <summary>
/// Applies <see cref="EnumToScreamingSnakeConverter{TEnum}"/> to every enum property in the
/// model, including nullable ones. This is the "single value converter registered by
/// convention, not one converter per property" the shared contract asks for: adding an enum
/// property to an entity needs no persistence change at all.
/// </summary>
public sealed class EnumToTextConvention : IModelFinalizingConvention
{
    public void ProcessModelFinalizing(
        IConventionModelBuilder modelBuilder,
        IConventionContext<IConventionModelBuilder> context)
    {
        foreach (var entityType in modelBuilder.Metadata.GetEntityTypes())
        {
            foreach (var property in entityType.GetDeclaredProperties())
            {
                var clrType = Nullable.GetUnderlyingType(property.ClrType) ?? property.ClrType;
                if (!clrType.IsEnum)
                {
                    continue;
                }

                var converterType = typeof(EnumToScreamingSnakeConverter<>).MakeGenericType(clrType);
                var converter = (ValueConverter)Activator.CreateInstance(converterType)!;
                property.Builder.HasConversion(converter);
            }
        }
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo`
Expected: PASS — 16 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence/Conversions \
        tests/PeakPower.Integration.Tests/Conversions
git commit -m "feat(persistence): store enums as SCREAMING_SNAKE text through one convention"
```

---

### Task 19: The jsonb converter for `Address` and `ContactPerson`

`Address` and `ContactPerson` are stored as one `jsonb` column each. A value converter plus a
value comparer is used rather than EF's owned-entity JSON mapping, because the converter is
explicit about what lands in the column and the comparer makes EF's change tracker treat two
structurally equal records as unchanged.

The comparer matters more than it looks: without it EF compares reference identity, so loading
a customer and saving it again would rewrite the address column every time.

**Files:**
- Create: `src/Infrastructure/PeakPower.Persistence/Conversions/JsonbConverter.cs`
- Test: `tests/PeakPower.Integration.Tests/Conversions/JsonbConverterTests.cs`

**Interfaces:**
- Consumes: `Address`, `ContactPerson` (Task 10).
- Produces:
  - `PeakPower.Persistence.Conversions.JsonbSerialization.Options` — a shared `JsonSerializerOptions`
  - `PeakPower.Persistence.Conversions.JsonbConverter<T> : ValueConverter<T?, string?> where T : class`
  - `PeakPower.Persistence.Conversions.JsonbComparer<T> : ValueComparer<T?> where T : class`

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Conversions/JsonbConverterTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.Domain.Common;
using PeakPower.Persistence.Conversions;

namespace PeakPower.Integration.Tests.Conversions;

public sealed class JsonbConverterTests
{
    private static readonly Address AnAddress =
        new("Keizersgracht", "104", "B", "1015 CV", "Amsterdam", "NL");

    [Fact]
    public void An_address_round_trips_through_the_converter()
    {
        var converter = new JsonbConverter<Address>();

        var json = (string?)converter.ConvertToProvider(AnAddress);
        var back = (Address?)converter.ConvertFromProvider(json);

        back.Should().Be(AnAddress);
    }

    [Fact]
    public void The_json_uses_camel_case_names_so_it_reads_the_way_the_API_does()
    {
        var converter = new JsonbConverter<Address>();

        var json = (string?)converter.ConvertToProvider(AnAddress);

        json.Should().Contain("\"houseNumberSuffix\":\"B\"");
        json.Should().Contain("\"postalCode\":\"1015 CV\"");
    }

    [Fact]
    public void A_null_address_converts_to_a_null_column_value_and_back()
    {
        var converter = new JsonbConverter<Address>();

        converter.ConvertToProvider(null).Should().BeNull();
        converter.ConvertFromProvider(null).Should().BeNull();
    }

    [Fact]
    public void A_contact_person_round_trips_through_the_converter()
    {
        var converter = new JsonbConverter<ContactPerson>();
        var contact = new ContactPerson("Sanne de Vries", "sanne@example.nl", null);

        var json = (string?)converter.ConvertToProvider(contact);

        ((ContactPerson?)converter.ConvertFromProvider(json)).Should().Be(contact);
    }

    [Fact]
    public void The_comparer_treats_two_structurally_equal_addresses_as_unchanged()
    {
        var comparer = new JsonbComparer<Address>();
        var other = new Address("Keizersgracht", "104", "B", "1015 CV", "Amsterdam", "NL");

        comparer.Equals(AnAddress, other).Should().BeTrue();
        comparer.GetHashCode(AnAddress).Should().Be(comparer.GetHashCode(other));
    }

    [Fact]
    public void The_comparer_sees_a_changed_city_as_a_change()
    {
        var comparer = new JsonbComparer<Address>();
        var moved = AnAddress with { City = "Rotterdam" };

        comparer.Equals(AnAddress, moved).Should().BeFalse();
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo`
Expected: FAIL with `error CS0246: The type or namespace name 'JsonbConverter<>' could not be found`

- [ ] **Step 3: Write the minimal implementation**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Conversions/JsonbConverter.cs`:

```csharp
using System.Text.Json;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace PeakPower.Persistence.Conversions;

/// <summary>The one serialiser configuration used for every jsonb column.</summary>
public static class JsonbSerialization
{
    /// <summary>
    /// Web defaults, so a jsonb column reads with the same camelCase names the API emits.
    /// Held as a single static instance: creating JsonSerializerOptions per call is slow.
    /// </summary>
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
}

/// <summary>Stores an immutable record as one jsonb column.</summary>
public sealed class JsonbConverter<T> : ValueConverter<T?, string?>
    where T : class
{
    public JsonbConverter()
        : base(
            model => model == null ? null : JsonSerializer.Serialize(model, JsonbSerialization.Options),
            provider => provider == null ? null : JsonSerializer.Deserialize<T>(provider, JsonbSerialization.Options))
    {
    }
}

/// <summary>
/// Compares jsonb-stored records by value. Without this EF compares by reference, so loading a
/// customer and saving it again would rewrite the address column on every SaveChanges.
/// The snapshot is the instance itself, which is safe because these records are immutable.
/// </summary>
public sealed class JsonbComparer<T> : ValueComparer<T?>
    where T : class
{
    public JsonbComparer()
        : base(
            (left, right) => Equals(left, right),
            instance => instance == null ? 0 : instance.GetHashCode(),
            instance => instance)
    {
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo`
Expected: PASS — 22 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence/Conversions/JsonbConverter.cs \
        tests/PeakPower.Integration.Tests/Conversions/JsonbConverterTests.cs
git commit -m "feat(persistence): store Address and ContactPerson as jsonb with a value comparer"
```

---

### Task 20: `PeakPowerDbContext`, the entity configurations and the composition-root entry point

One `DbContext`, one file per aggregate configuration, one DI extension every host calls, one
design-time factory so `dotnet ef` works, and one `DatabaseMigrator` so the Migrator host and
the Testcontainers fixture apply migrations through the *same* code path.

Table and column names come from `EFCore.NamingConventions` (`UseSnakeCaseNamingConvention`),
never from per-property attributes. Schemas are given explicitly per entity.

**Files:**
- Create: `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/PersistenceServiceCollectionExtensions.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContextFactory.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/DatabaseMigrator.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/Configurations/CustomerConfiguration.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/Configurations/CustomerAccountConfiguration.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/Configurations/MeteringPointConfiguration.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/Configurations/BrpConfiguration.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/Configurations/WalletConfiguration.cs`
- Create: `src/Infrastructure/PeakPower.Persistence/Configurations/AuditRecordConfiguration.cs`
- Test: `tests/PeakPower.Integration.Tests/Model/ModelShapeTests.cs`

**Interfaces:**
- Consumes: every domain type (Tasks 6 to 14), the two converter files (Tasks 18, 19).
- Produces:
  - `PeakPower.Persistence.PeakPowerDbContext(DbContextOptions<PeakPowerDbContext> options)` with
    `DbSet<Customer> Customers`, `DbSet<CustomerAccount> CustomerAccounts`,
    `DbSet<MeteringPoint> MeteringPoints`, `DbSet<Brp> Brps`, `DbSet<Wallet> Wallets`,
    `DbSet<AuditRecord> AuditRecords`
  - `PeakPower.Persistence.PersistenceServiceCollectionExtensions.AddPeakPowerPersistence(IServiceCollection services, string connectionString)`
  - `PeakPower.Persistence.PersistenceServiceCollectionExtensions.ConfigureDbContext(DbContextOptionsBuilder options, string connectionString)`
  - `PeakPower.Persistence.DatabaseMigrator(PeakPowerDbContext context, ILogger<DatabaseMigrator> logger)`
    with `Task<int> RunAsync(CancellationToken cancellationToken)` returning the number of
    migrations applied
  - `PeakPower.Persistence.PeakPowerDbContextFactory : IDesignTimeDbContextFactory<PeakPowerDbContext>`

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Model/ModelShapeTests.cs`:

```csharp
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using PeakPower.Domain.Auditing;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Domain.Wallets;
using PeakPower.Persistence;

namespace PeakPower.Integration.Tests.Model;

/// <summary>
/// The shape of the model, asserted without a database. A connection string is needed to build
/// the model because Npgsql supplies the type mappings, but nothing here opens a connection.
/// </summary>
public sealed class ModelShapeTests : IDisposable
{
    private const string DesignTimeConnectionString =
        "Host=localhost;Port=5432;Database=peakpower;Username=postgres;Password=postgres";

    private readonly PeakPowerDbContext _context;

    public ModelShapeTests()
    {
        var options = new DbContextOptionsBuilder<PeakPowerDbContext>();
        PersistenceServiceCollectionExtensions.ConfigureDbContext(options, DesignTimeConnectionString);
        _context = new PeakPowerDbContext(options.Options);
    }

    [Theory]
    [InlineData(typeof(Customer), "customer", "customer")]
    [InlineData(typeof(CustomerAccount), "customer", "customer_account")]
    [InlineData(typeof(MeteringPoint), "customer", "metering_point")]
    [InlineData(typeof(Brp), "metering", "brp")]
    [InlineData(typeof(Wallet), "wallet", "wallet")]
    [InlineData(typeof(AuditRecord), "audit", "audit_record")]
    public void Each_aggregate_maps_to_its_schema_qualified_singular_snake_case_table(
        Type clrType, string schema, string table)
    {
        var entityType = _context.Model.FindEntityType(clrType);

        entityType.Should().NotBeNull();
        entityType!.GetSchema().Should().Be(schema);
        entityType.GetTableName().Should().Be(table);
    }

    [Fact]
    public void Columns_are_snake_case_without_a_single_attribute_in_the_domain()
    {
        var account = _context.Model.FindEntityType(typeof(CustomerAccount))!;
        var storeObject = Microsoft.EntityFrameworkCore.Metadata.StoreObjectIdentifier
            .Table("customer_account", "customer");

        account.GetProperty(nameof(CustomerAccount.FirstName)).GetColumnName(storeObject).Should().Be("first_name");
        account.GetProperty(nameof(CustomerAccount.SecurityStamp)).GetColumnName(storeObject).Should().Be("security_stamp");
        account.GetProperty(nameof(CustomerAccount.ExternalSubjectId)).GetColumnName(storeObject).Should().Be("external_subject_id");
    }

    [Fact]
    public void Enum_properties_get_the_screaming_snake_converter_from_the_convention()
    {
        var status = _context.Model.FindEntityType(typeof(CustomerAccount))!
            .GetProperty(nameof(CustomerAccount.Status));

        var converter = status.GetValueConverter();

        converter.Should().NotBeNull();
        converter!.ConvertToProvider(AccountStatus.PendingApproval).Should().Be("PENDING_APPROVAL");
    }

    [Fact]
    public void A_nullable_enum_property_also_gets_the_converter()
    {
        var source = _context.Model.FindEntityType(typeof(MeteringPoint))!
            .GetProperty(nameof(MeteringPoint.ExpectationSource));

        source.GetValueConverter().Should().NotBeNull();
    }

    [Fact]
    public void Username_and_email_are_citext_so_uniqueness_is_case_insensitive()
    {
        var account = _context.Model.FindEntityType(typeof(CustomerAccount))!;

        account.GetProperty(nameof(CustomerAccount.Username)).GetColumnType().Should().Be("citext");
        account.GetProperty(nameof(CustomerAccount.Email)).GetColumnType().Should().Be("citext");
    }

    [Fact]
    public void Addresses_and_contacts_are_jsonb()
    {
        var customer = _context.Model.FindEntityType(typeof(Customer))!;

        customer.GetProperty(nameof(Customer.BillingAddress)).GetColumnType().Should().Be("jsonb");
        customer.GetProperty(nameof(Customer.VisitingAddress)).GetColumnType().Should().Be("jsonb");
        customer.GetProperty(nameof(Customer.PrimaryContact)).GetColumnType().Should().Be("jsonb");
    }

    [Fact]
    public void Money_and_capacity_are_numeric_18_6()
    {
        _context.Model.FindEntityType(typeof(Wallet))!
            .GetProperty(nameof(Wallet.Balance)).GetColumnType().Should().Be("numeric(18,6)");

        _context.Model.FindEntityType(typeof(MeteringPoint))!
            .GetProperty(nameof(MeteringPoint.CapacityKw)).GetColumnType().Should().Be("numeric(18,6)");
    }

    [Fact]
    public void The_EAN_is_stored_as_its_eighteen_digit_string()
    {
        var ean = _context.Model.FindEntityType(typeof(MeteringPoint))!
            .GetProperty(nameof(MeteringPoint.Ean));

        ean.GetMaxLength().Should().Be(18);
        ean.GetValueConverter().Should().NotBeNull();
    }

    [Fact]
    public void DisplayLabel_is_computed_and_never_stored()
    {
        _context.Model.FindEntityType(typeof(MeteringPoint))!
            .FindProperty(nameof(MeteringPoint.DisplayLabel)).Should().BeNull();
    }

    [Fact]
    public void A_KvK_number_is_unique_across_the_platform()
    {
        var customer = _context.Model.FindEntityType(typeof(Customer))!;

        customer.GetIndexes()
            .Where(index => index.IsUnique)
            .SelectMany(index => index.Properties)
            .Select(property => property.Name)
            .Should().Contain(nameof(Customer.KvkNumber));
    }

    [Fact]
    public void A_customer_has_at_most_one_wallet()
    {
        _context.Model.FindEntityType(typeof(Wallet))!
            .GetIndexes()
            .Should().ContainSingle(index => index.IsUnique
                && index.Properties.Count == 1
                && index.Properties[0].Name == nameof(Wallet.CustomerId));
    }

    public void Dispose() => _context.Dispose();
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo`
Expected: FAIL with `error CS0246: The type or namespace name 'PeakPowerDbContext' could not be found`

- [ ] **Step 3: Write the minimal implementation**

Create `.../src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Domain.Auditing;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Domain.Wallets;
using PeakPower.Persistence.Conversions;

namespace PeakPower.Persistence;

/// <summary>The one DbContext. Plan 2 adds the tenancy query filters to it.</summary>
public sealed class PeakPowerDbContext(DbContextOptions<PeakPowerDbContext> options) : DbContext(options)
{
    public DbSet<Customer> Customers => Set<Customer>();

    public DbSet<CustomerAccount> CustomerAccounts => Set<CustomerAccount>();

    public DbSet<MeteringPoint> MeteringPoints => Set<MeteringPoint>();

    public DbSet<Brp> Brps => Set<Brp>();

    public DbSet<Wallet> Wallets => Set<Wallet>();

    public DbSet<AuditRecord> AuditRecords => Set<AuditRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PeakPowerDbContext).Assembly);

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder) =>
        configurationBuilder.Conventions.Add(_ => new EnumToTextConvention());
}
```

Create `.../src/Infrastructure/PeakPower.Persistence/PersistenceServiceCollectionExtensions.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace PeakPower.Persistence;

/// <summary>
/// The single composition-root entry point for persistence. Hosts reference infrastructure
/// only to call this; nothing else in a host touches EF Core configuration.
/// </summary>
public static class PersistenceServiceCollectionExtensions
{
    public static IServiceCollection AddPeakPowerPersistence(
        this IServiceCollection services,
        string connectionString)
    {
        services.AddDbContext<PeakPowerDbContext>(options => ConfigureDbContext(options, connectionString));
        services.AddScoped<DatabaseMigrator>();
        return services;
    }

    /// <summary>
    /// Also used by the design-time factory and by the tests, so there is exactly one place
    /// where snake_case naming and the Npgsql provider are turned on.
    /// </summary>
    public static void ConfigureDbContext(DbContextOptionsBuilder options, string connectionString)
    {
        options.UseNpgsql(
            connectionString,
            npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "public"));
        options.UseSnakeCaseNamingConvention();
    }
}
```

Create `.../src/Infrastructure/PeakPower.Persistence/DatabaseMigrator.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace PeakPower.Persistence;

/// <summary>
/// Applies every pending migration to completion. The Migrator host and the Testcontainers
/// fixture both go through this, so the tests exercise the same code the AppHost runs.
/// </summary>
public sealed class DatabaseMigrator(PeakPowerDbContext context, ILogger<DatabaseMigrator> logger)
{
    /// <returns>The number of migrations that were pending before this call.</returns>
    public async Task<int> RunAsync(CancellationToken cancellationToken)
    {
        var pending = (await context.Database.GetPendingMigrationsAsync(cancellationToken)).ToArray();

        if (pending.Length == 0)
        {
            logger.LogInformation("The database is already up to date; no migrations to apply.");
            return 0;
        }

        logger.LogInformation(
            "Applying {Count} pending migration(s): {Migrations}",
            pending.Length,
            string.Join(", ", pending));

        await context.Database.MigrateAsync(cancellationToken);
        return pending.Length;
    }
}
```

Create `.../src/Infrastructure/PeakPower.Persistence/PeakPowerDbContextFactory.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace PeakPower.Persistence;

/// <summary>
/// Lets `dotnet ef migrations add` build the model without a running host. It never opens a
/// connection, so the placeholder connection string below does not have to point anywhere.
/// </summary>
public sealed class PeakPowerDbContextFactory : IDesignTimeDbContextFactory<PeakPowerDbContext>
{
    public PeakPowerDbContext CreateDbContext(string[] args)
    {
        var connectionString =
            Environment.GetEnvironmentVariable("PEAKPOWER_DESIGN_TIME_CONNECTION")
            ?? "Host=localhost;Port=5432;Database=peakpower;Username=postgres;Password=postgres";

        var options = new DbContextOptionsBuilder<PeakPowerDbContext>();
        PersistenceServiceCollectionExtensions.ConfigureDbContext(options, connectionString);
        return new PeakPowerDbContext(options.Options);
    }
}
```

Create `.../src/Infrastructure/PeakPower.Persistence/Configurations/CustomerConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Persistence.Conversions;

namespace PeakPower.Persistence.Configurations;

public sealed class CustomerConfiguration : IEntityTypeConfiguration<Customer>
{
    public void Configure(EntityTypeBuilder<Customer> builder)
    {
        builder.ToTable("customer", "customer");

        builder.HasKey(customer => customer.Id);
        builder.Property(customer => customer.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedNever();

        builder.Property(customer => customer.LegalName).IsRequired();
        builder.Property(customer => customer.TradeName);

        builder.Property(customer => customer.KvkNumber)
            .HasConversion(kvk => kvk.Value, value => KvkNumber.FromPersistedValue(value))
            .HasMaxLength(8)
            .IsRequired();
        builder.HasIndex(customer => customer.KvkNumber).IsUnique();

        builder.Property(customer => customer.VatNumber);
        builder.Property(customer => customer.Status).IsRequired();
        builder.Property(customer => customer.FourEyesEnabled).IsRequired().HasDefaultValue(false);

        builder.Property(customer => customer.BillingAddress)
            .HasConversion(new JsonbConverter<Address>(), new JsonbComparer<Address>())
            .HasColumnType("jsonb")
            .IsRequired();

        builder.Property(customer => customer.VisitingAddress)
            .HasConversion(new JsonbConverter<Address>(), new JsonbComparer<Address>())
            .HasColumnType("jsonb");

        builder.Property(customer => customer.PrimaryContact)
            .HasConversion(new JsonbConverter<ContactPerson>(), new JsonbComparer<ContactPerson>())
            .HasColumnType("jsonb")
            .IsRequired();

        builder.Property(customer => customer.InternalReference);
        builder.Property(customer => customer.Locale).IsRequired().HasDefaultValue("nl-NL");
    }
}
```

Create `.../src/Infrastructure/PeakPower.Persistence/Configurations/CustomerAccountConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Customers;

namespace PeakPower.Persistence.Configurations;

public sealed class CustomerAccountConfiguration : IEntityTypeConfiguration<CustomerAccount>
{
    public void Configure(EntityTypeBuilder<CustomerAccount> builder)
    {
        builder.ToTable("customer_account", "customer");

        builder.HasKey(account => account.Id);
        builder.Property(account => account.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedNever();

        builder.Property(account => account.CustomerId).IsRequired();
        builder.HasOne<Customer>()
            .WithMany()
            .HasForeignKey(account => account.CustomerId)
            .OnDelete(DeleteBehavior.Restrict);

        // citext, so "Sanne.DeVries" and "sanne.devries" are the same username to the database.
        builder.Property(account => account.Username).HasColumnType("citext").IsRequired();
        builder.HasIndex(account => account.Username).IsUnique();

        builder.Property(account => account.FirstName).IsRequired();
        builder.Property(account => account.LastName).IsRequired();
        builder.Property(account => account.JobTitle);

        builder.Property(account => account.Email).HasColumnType("citext").IsRequired();
        builder.HasIndex(account => account.Email);

        builder.Property(account => account.Phone);
        builder.Property(account => account.Status).IsRequired();
        builder.Property(account => account.IsAdmin).IsRequired().HasDefaultValue(false);
        builder.Property(account => account.PasswordHash);
        builder.Property(account => account.SecurityStamp).IsRequired();
        builder.Property(account => account.ExternalSubjectId);
        builder.Property(account => account.LastLoginAt);

        builder.HasIndex(account => account.CustomerId);
    }
}
```

Create `.../src/Infrastructure/PeakPower.Persistence/Configurations/MeteringPointConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Persistence.Conversions;

namespace PeakPower.Persistence.Configurations;

public sealed class MeteringPointConfiguration : IEntityTypeConfiguration<MeteringPoint>
{
    public void Configure(EntityTypeBuilder<MeteringPoint> builder)
    {
        builder.ToTable("metering_point", "customer");

        builder.HasKey(point => point.Id);
        builder.Property(point => point.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedNever();

        builder.Property(point => point.CustomerId).IsRequired();
        builder.HasOne<Customer>()
            .WithMany()
            .HasForeignKey(point => point.CustomerId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(point => point.Ean)
            .HasConversion(ean => ean.Value, value => EanCode.FromPersistedValue(value))
            .HasMaxLength(18)
            .IsRequired();
        builder.HasIndex(point => point.Ean);

        builder.Property(point => point.Commodity).IsRequired();

        builder.Property(point => point.BrpId).IsRequired();
        builder.HasOne<Brp>()
            .WithMany()
            .HasForeignKey(point => point.BrpId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(point => point.ProductionExpectation).IsRequired();
        builder.Property(point => point.ExpectationSource);

        builder.Property(point => point.Name).HasMaxLength(MeteringPoint.MaximumNameLength);
        builder.Property(point => point.Description).HasMaxLength(MeteringPoint.MaximumDescriptionLength);
        builder.Property(point => point.GridOperator);
        builder.Property(point => point.CapacityKw).HasColumnType("numeric(18,6)");

        builder.Property(point => point.Address)
            .HasConversion(new JsonbConverter<Address>(), new JsonbComparer<Address>())
            .HasColumnType("jsonb");

        builder.Property(point => point.ValidFrom).IsRequired();
        builder.Property(point => point.ValidTo);

        // DisplayLabel is computed from Name and Ean; it is never a column.
        builder.Ignore(point => point.DisplayLabel);

        builder.HasIndex(point => point.CustomerId);
    }
}
```

Create `.../src/Infrastructure/PeakPower.Persistence/Configurations/BrpConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Metering;

namespace PeakPower.Persistence.Configurations;

public sealed class BrpConfiguration : IEntityTypeConfiguration<Brp>
{
    public void Configure(EntityTypeBuilder<Brp> builder)
    {
        builder.ToTable("brp", "metering");

        builder.HasKey(brp => brp.Id);
        builder.Property(brp => brp.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedNever();

        builder.Property(brp => brp.Code).IsRequired().HasMaxLength(32);
        builder.HasIndex(brp => brp.Code).IsUnique();

        builder.Property(brp => brp.Name).IsRequired();
        builder.Property(brp => brp.IsActive).IsRequired().HasDefaultValue(true);
    }
}
```

Create `.../src/Infrastructure/PeakPower.Persistence/Configurations/WalletConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Wallets;

namespace PeakPower.Persistence.Configurations;

public sealed class WalletConfiguration : IEntityTypeConfiguration<Wallet>
{
    public void Configure(EntityTypeBuilder<Wallet> builder)
    {
        builder.ToTable("wallet", "wallet");

        builder.HasKey(wallet => wallet.Id);
        builder.Property(wallet => wallet.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedNever();

        builder.Property(wallet => wallet.CustomerId).IsRequired();
        builder.HasOne<Customer>()
            .WithMany()
            .HasForeignKey(wallet => wallet.CustomerId)
            .OnDelete(DeleteBehavior.Restrict);

        // One EUR wallet per customer. [F01-R05]
        builder.HasIndex(wallet => wallet.CustomerId).IsUnique();

        builder.Property(wallet => wallet.Currency).IsRequired().HasMaxLength(3).HasDefaultValue("EUR");

        // Money is numeric(18,6) and is rounded to two decimals only at presentation. [DEC-12]
        builder.Property(wallet => wallet.Balance)
            .HasColumnType("numeric(18,6)")
            .IsRequired()
            .HasDefaultValue(0m);
    }
}
```

Create `.../src/Infrastructure/PeakPower.Persistence/Configurations/AuditRecordConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Auditing;

namespace PeakPower.Persistence.Configurations;

public sealed class AuditRecordConfiguration : IEntityTypeConfiguration<AuditRecord>
{
    public void Configure(EntityTypeBuilder<AuditRecord> builder)
    {
        builder.ToTable("audit_record", "audit");

        builder.HasKey(record => record.Id);
        builder.Property(record => record.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedNever();

        builder.Property(record => record.OccurredAt).IsRequired();
        builder.Property(record => record.Actor).IsRequired();
        builder.Property(record => record.Action).IsRequired();
        builder.Property(record => record.EntityType).IsRequired();
        builder.Property(record => record.EntityId).IsRequired();
        builder.Property(record => record.CustomerId);

        // jsonb rather than text, so the database validates the documents it is handed.
        builder.Property(record => record.Before).HasColumnType("jsonb");
        builder.Property(record => record.After).HasColumnType("jsonb");

        builder.HasIndex(record => new { record.EntityType, record.EntityId });
        builder.HasIndex(record => record.OccurredAt);
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo`
Expected: PASS — 38 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence \
        tests/PeakPower.Integration.Tests/Model
git commit -m "feat(persistence): add PeakPowerDbContext, the entity configurations and the DI entry point"
```

---

### Task 21: Migration 1 — extensions, schemas, tables, the generated `validity` column and the exclusion constraint

Three things go into migration 1 specifically because retrofitting them is expensive
`[design §5.1]`:

**a. The two extensions the specification's DDL needs and never declares.** `citext` gives
case-insensitive `username` and `email`; `btree_gist` is what allows plain equality (`ean WITH =`)
to sit inside a GiST exclusion constraint alongside a range overlap test. Without `btree_gist`
the constraint below simply will not create.

**b. The EAN validity exclusion constraint**, in the database rather than the application.
`[F01-R26]` and `[AS-03]` require that the same EAN may serve different customers over
non-overlapping periods, and overlaps be rejected. A database that permits the overlap has
already lost the argument — and no single aggregate can see the others, so this cannot live in
`MeteringPoint`.

**c. The two dead boolean columns**, `customer.four_eyes_enabled` and
`customer_account.is_admin`, per `[DEC-71]` — already carried by Task 20's configurations.

**d. The one BRP row.** Contract §3.2 puts `metering.brp` in migration 1, and every metering
point must name a BRP `[F01-R51]`, so an empty `brp` table makes the schema unusable the moment
it is migrated. PVNed is the only balance responsible party in slice 1 `[F12-R49]`. It is
reference data, not demo data: plan 2's fixture asserts on the name `PVNed B.V.` and plan 6's
seeder reads the row rather than writing it, so it belongs in the migration and nowhere else.

**Migration 1 in this plan creates six tables.** `customer.onboarding_application`,
`customer.refresh_token` and `customer.password_reset_token` belong to plan 5, which owns their
columns, and land in plan 5's own migration. Migrations are forward-only and additive.

**Files:**
- Create: `src/Infrastructure/PeakPower.Persistence/Migrations/<timestamp>_InitialSchema.cs` (generated, then edited)
- Create: `src/Infrastructure/PeakPower.Persistence/Migrations/<timestamp>_InitialSchema.Designer.cs` (generated)
- Create: `src/Infrastructure/PeakPower.Persistence/Migrations/PeakPowerDbContextModelSnapshot.cs` (generated)
- Test: `tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs`

**Interfaces:**
- Consumes: `PeakPowerDbContext`, `PersistenceServiceCollectionExtensions.ConfigureDbContext` (Task 20).
- Produces: one EF Core migration named `InitialSchema`, discoverable by
  `context.Database.GetPendingMigrations()` and by `IMigrator.GenerateScript()`.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs`:

```csharp
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using PeakPower.Persistence;

namespace PeakPower.Integration.Tests.Migrations;

/// <summary>
/// Asserts what migration 1 contains, without a database. Task 22 asserts what it does to one.
/// </summary>
public sealed class MigrationScriptTests : IDisposable
{
    private const string DesignTimeConnectionString =
        "Host=localhost;Port=5432;Database=peakpower;Username=postgres;Password=postgres";

    private readonly PeakPowerDbContext _context;
    private readonly string _script;

    public MigrationScriptTests()
    {
        var options = new DbContextOptionsBuilder<PeakPowerDbContext>();
        PersistenceServiceCollectionExtensions.ConfigureDbContext(options, DesignTimeConnectionString);
        _context = new PeakPowerDbContext(options.Options);
        _script = _context.GetService<IMigrator>().GenerateScript();
    }

    [Fact]
    public void There_is_exactly_one_migration_and_it_is_called_InitialSchema()
    {
        _context.Database.GetMigrations().Should().ContainSingle()
            .Which.Should().EndWith("_InitialSchema");
    }

    [Fact]
    public void The_migration_declares_citext_and_btree_gist()
    {
        _script.Should().Contain("CREATE EXTENSION IF NOT EXISTS citext");
        _script.Should().Contain("CREATE EXTENSION IF NOT EXISTS btree_gist");
    }

    [Fact]
    public void The_extensions_come_before_the_first_schema_because_the_columns_depend_on_them()
    {
        var citext = _script.IndexOf("CREATE EXTENSION IF NOT EXISTS citext", StringComparison.Ordinal);
        var btreeGist = _script.IndexOf("CREATE EXTENSION IF NOT EXISTS btree_gist", StringComparison.Ordinal);
        var firstSchema = _script.IndexOf("CREATE SCHEMA", StringComparison.Ordinal);

        citext.Should().BeGreaterThan(-1);
        btreeGist.Should().BeGreaterThan(-1);
        firstSchema.Should().BeGreaterThan(-1);
        citext.Should().BeLessThan(firstSchema);
        btreeGist.Should().BeLessThan(firstSchema);
    }

    [Theory]
    [InlineData("customer")]
    [InlineData("metering")]
    [InlineData("wallet")]
    [InlineData("audit")]
    public void All_four_schemas_are_created(string schema)
    {
        _script.Should().Contain($"CREATE SCHEMA IF NOT EXISTS {schema}");
    }

    [Fact]
    public void The_validity_column_is_a_generated_half_open_daterange()
    {
        _script.Should().Contain(
            "GENERATED ALWAYS AS (daterange(valid_from, valid_to, '[)')) STORED");
    }

    [Fact]
    public void The_same_EAN_cannot_overlap_itself_in_time()
    {
        _script.Should().Contain("EXCLUDE USING gist (ean WITH =, validity WITH &&)");
    }

    [Fact]
    public void The_generated_column_and_the_constraint_come_after_the_metering_point_table_exists()
    {
        var table = _script.IndexOf("metering_point", StringComparison.Ordinal);
        var validity = _script.IndexOf("GENERATED ALWAYS AS (daterange", StringComparison.Ordinal);
        var exclusion = _script.IndexOf("EXCLUDE USING gist", StringComparison.Ordinal);

        table.Should().BeLessThan(validity);
        validity.Should().BeLessThan(exclusion);
    }

    [Fact]
    public void The_one_BRP_reference_row_is_seeded_because_every_metering_point_must_name_one()
    {
        _script.Should().Contain("INSERT INTO metering.brp");
        _script.Should().Contain("'PVNed B.V.'");
    }

    [Fact]
    public void The_three_auth_tables_are_deliberately_absent_because_plan_5_owns_them()
    {
        _script.Should().NotContain("onboarding_application");
        _script.Should().NotContain("refresh_token");
        _script.Should().NotContain("password_reset_token");
    }

    public void Dispose() => _context.Dispose();
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo`
Expected: FAIL — `There_is_exactly_one_migration_and_it_is_called_InitialSchema` fails with
`Expected _context.Database.GetMigrations() to contain a single item, but the collection is empty.`

- [ ] **Step 3: Write the minimal implementation**

Generate the migration from the model:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet ef migrations add InitialSchema \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Infrastructure/PeakPower.Persistence \
  --output-dir Migrations \
  --context PeakPowerDbContext
```

That writes three files into `src/Infrastructure/PeakPower.Persistence/Migrations/`. Now make
the three additions EF cannot express. Open the generated
`<timestamp>_InitialSchema.cs` and edit `Up`:

**Insert immediately after the opening brace of `protected override void Up(MigrationBuilder migrationBuilder)`:**

```csharp
            // citext gives case-insensitive username and email columns.
            // btree_gist is what lets plain equality (ean WITH =) sit inside a GiST exclusion
            // constraint next to a range overlap test. Without it the EXCLUDE below cannot be
            // created at all. Neither extension is declared anywhere in the specification's DDL.
            migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS citext;");
            migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS btree_gist;");
```

**Append immediately before the closing brace of the same `Up` method:**

```csharp
            // The validity of a metering point is the half-open interval [valid_from, valid_to).
            // A generated column rather than an application-computed one, so the constraint below
            // can never disagree with the two date columns.
            migrationBuilder.Sql(
                """
                ALTER TABLE customer.metering_point
                    ADD COLUMN validity daterange
                    GENERATED ALWAYS AS (daterange(valid_from, valid_to, '[)')) STORED;
                """);

            // [F01-R26] and [AS-03]: the same EAN may serve different customers over
            // non-overlapping periods, and overlaps must be rejected. This is the database's
            // job, not the application's: no single aggregate can see the others.
            migrationBuilder.Sql(
                """
                ALTER TABLE customer.metering_point
                    ADD CONSTRAINT metering_point_ean_validity_excl
                    EXCLUDE USING gist (ean WITH =, validity WITH &&);
                """);

            // Reference data, not demo data. PVNed is the only balance responsible party in
            // slice 1 [F12-R49], every metering point must name one [F01-R51], and the name is
            // this exact string - plan 2 asserts on it and plan 6 reads the row back. The id is
            // a literal so tests and seeds can name the row without a lookup; ON CONFLICT keeps
            // a re-run of the migration on a populated database harmless.
            migrationBuilder.Sql(
                """
                INSERT INTO metering.brp (id, code, name, is_active)
                VALUES ('0199a1a0-0000-7000-8000-0000000000b1', 'PVNED', 'PVNed B.V.', TRUE)
                ON CONFLICT (code) DO NOTHING;
                """);
```

**Insert immediately after the opening brace of `protected override void Down(MigrationBuilder migrationBuilder)`:**

```csharp
            migrationBuilder.Sql("DELETE FROM metering.brp WHERE code = 'PVNED';");
            migrationBuilder.Sql(
                "ALTER TABLE customer.metering_point DROP CONSTRAINT IF EXISTS metering_point_ean_validity_excl;");
            migrationBuilder.Sql(
                "ALTER TABLE customer.metering_point DROP COLUMN IF EXISTS validity;");
```

The extensions are deliberately **not** dropped in `Down`: another database object may depend on
them, and `CREATE EXTENSION IF NOT EXISTS` is idempotent so leaving them costs nothing.

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo`
Expected: PASS — 50 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence/Migrations \
        tests/PeakPower.Integration.Tests/Migrations
git commit -m "feat(persistence): add migration 1 with citext, btree_gist and the EAN validity exclusion"
```

---

### Task 22: Migration 1 against a real PostgreSQL 17 container

Definition of done item 9: *migration 1 applies to an empty PostgreSQL 17 container, and the
exclusion constraint rejects an overlapping EAN period.* This task is that item.

The inserts are raw SQL rather than EF, on purpose: the point is what the **database** does, and
raw SQL also proves the `gen_random_uuid()` defaults and the `jsonb` casts work for anything
that talks to the schema without going through our model.

Docker must be running. `Testcontainers` starts and disposes the container itself.

**Files:**
- Create: `tests/PeakPower.Integration.Tests/Database/PostgresFixture.cs`
- Create: `tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs`
- Test: the same files

**Interfaces:**
- Consumes: `DatabaseMigrator`, `PeakPowerDbContext`, `ConfigureDbContext` (Task 20); the
  `InitialSchema` migration (Task 21).
- Produces: `PeakPower.Integration.Tests.Database.PostgresFixture` — an `IAsyncLifetime` fixture
  exposing `string ConnectionString`, reusable by plan 2's tenancy tests and plan 5's auth tests.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Database/PostgresFixture.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using PeakPower.Persistence;
using Testcontainers.PostgreSql;

namespace PeakPower.Integration.Tests.Database;

/// <summary>
/// A throwaway PostgreSQL 17 container with migration 1 applied, shared by every test in the
/// "postgres" collection. Later plans reuse this fixture rather than starting their own.
/// </summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder()
        .WithImage("postgres:17")
        .WithDatabase("peakpower")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .Build();

    public string ConnectionString => _container.GetConnectionString();

    public async ValueTask InitializeAsync()
    {
        await _container.StartAsync();

        await using var context = CreateContext();
        var migrator = new DatabaseMigrator(context, NullLogger<DatabaseMigrator>.Instance);
        await migrator.RunAsync(CancellationToken.None);
    }

    public PeakPowerDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<PeakPowerDbContext>();
        PersistenceServiceCollectionExtensions.ConfigureDbContext(options, ConnectionString);
        return new PeakPowerDbContext(options.Options);
    }

    public async ValueTask DisposeAsync() => await _container.DisposeAsync();
}

/// <summary>Keeps every database test on the one container.</summary>
[CollectionDefinition(PostgresCollection.Name)]
public sealed class PostgresCollection : ICollectionFixture<PostgresFixture>
{
    public const string Name = "postgres";
}
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs`:

```csharp
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using PeakPower.Persistence;

namespace PeakPower.Integration.Tests.Database;

[Collection(PostgresCollection.Name)]
public sealed class MigrationBehaviourTests(PostgresFixture fixture)
{
    private static readonly Guid CustomerId = Guid.Parse("0199a1a0-0000-7000-8000-00000000c001");

    /// <summary>The PVNed row migration 1 seeds. Nothing here creates a second BRP.</summary>
    private static readonly Guid BrpId = Guid.Parse("0199a1a0-0000-7000-8000-0000000000b1");

    [Fact]
    public async Task Migration_1_applies_to_an_empty_PostgreSQL_17_container()
    {
        await using var context = fixture.CreateContext();

        var pending = await context.Database.GetPendingMigrationsAsync(TestContext.Current.CancellationToken);
        var applied = await context.Database.GetAppliedMigrationsAsync(TestContext.Current.CancellationToken);

        pending.Should().BeEmpty();
        applied.Should().ContainSingle().Which.Should().EndWith("_InitialSchema");
    }

    [Fact]
    public async Task Running_the_migrator_a_second_time_is_a_no_op()
    {
        await using var context = fixture.CreateContext();
        var migrator = new DatabaseMigrator(context, NullLogger<DatabaseMigrator>.Instance);

        var applied = await migrator.RunAsync(TestContext.Current.CancellationToken);

        applied.Should().Be(0);
    }

    [Theory]
    [InlineData("citext")]
    [InlineData("btree_gist")]
    public async Task The_extension_is_installed(string extension)
    {
        var present = await ScalarAsync<bool>(
            "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = @name);",
            ("name", extension));

        present.Should().BeTrue();
    }

    [Theory]
    [InlineData("customer", "customer")]
    [InlineData("customer", "customer_account")]
    [InlineData("customer", "metering_point")]
    [InlineData("metering", "brp")]
    [InlineData("wallet", "wallet")]
    [InlineData("audit", "audit_record")]
    public async Task The_table_exists(string schema, string table)
    {
        var present = await ScalarAsync<bool>(
            """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = @schema AND table_name = @table);
            """,
            ("schema", schema),
            ("table", table));

        present.Should().BeTrue();
    }

    [Fact]
    public async Task The_validity_column_is_generated_by_the_database()
    {
        var generated = await ScalarAsync<string>(
            """
            SELECT is_generated FROM information_schema.columns
            WHERE table_schema = 'customer' AND table_name = 'metering_point' AND column_name = 'validity';
            """);

        generated.Should().Be("ALWAYS");
    }

    [Fact]
    public async Task Migration_1_seeded_the_one_BRP_slice_1_has()
    {
        var name = await ScalarAsync<string>(
            "SELECT name FROM metering.brp WHERE code = 'PVNED';");

        name.Should().Be("PVNed B.V.");
    }

    [Fact]
    public async Task Two_overlapping_validity_periods_for_the_same_EAN_are_rejected_by_the_database()
    {
        const string ean = "871687100000000041";
        await SeedCustomerAsync();
        await InsertMeteringPointAsync(ean, "2026-01-01", "2026-07-01");

        // 2026-06-01 falls inside [2026-01-01, 2026-07-01).
        var act = async () => await InsertMeteringPointAsync(ean, "2026-06-01", null);

        var exception = await act.Should().ThrowAsync<PostgresException>();
        exception.Which.SqlState.Should().Be(PostgresErrorCodes.ExclusionViolation);
        exception.Which.ConstraintName.Should().Be("metering_point_ean_validity_excl");
    }

    [Fact]
    public async Task Two_touching_but_non_overlapping_periods_for_the_same_EAN_are_accepted()
    {
        const string ean = "871687100000000042";
        await SeedCustomerAsync();

        // The range is half-open, so [2026-01-01, 2026-07-01) and [2026-07-01, null) do not overlap.
        await InsertMeteringPointAsync(ean, "2026-01-01", "2026-07-01");
        await InsertMeteringPointAsync(ean, "2026-07-01", null);

        var count = await ScalarAsync<long>(
            "SELECT count(*) FROM customer.metering_point WHERE ean = @ean;",
            ("ean", ean));

        count.Should().Be(2);
    }

    [Fact]
    public async Task Two_different_EANs_may_hold_the_same_period()
    {
        await SeedCustomerAsync();

        await InsertMeteringPointAsync("871687100000000043", "2026-01-01", null);
        await InsertMeteringPointAsync("871687100000000044", "2026-01-01", null);

        var count = await ScalarAsync<long>(
            "SELECT count(*) FROM customer.metering_point WHERE valid_from = DATE '2026-01-01';");

        count.Should().BeGreaterThanOrEqualTo(2);
    }

    /// <summary>
    /// Only the customer: migration 1 already seeded the one BRP, and inserting a second row
    /// with code 'PVNED' would trip the unique index rather than the constraint under test.
    /// </summary>
    private async Task SeedCustomerAsync()
    {
        await ExecuteAsync(
            """
            INSERT INTO customer.customer
                (id, legal_name, kvk_number, status, four_eyes_enabled,
                 billing_address, primary_contact, locale)
            VALUES
                (@customerId, 'Zonnedak Beheer B.V.', '12345678', 'PROSPECT', false,
                 '{"street":"Keizersgracht","houseNumber":"104","houseNumberSuffix":null,
                    "postalCode":"1015 CV","city":"Amsterdam","country":"NL"}'::jsonb,
                 '{"name":"Sanne de Vries","email":"sanne@example.nl","phone":null}'::jsonb,
                 'nl-NL')
            ON CONFLICT (id) DO NOTHING;
            """,
            ("customerId", CustomerId));
    }

    private async Task InsertMeteringPointAsync(string ean, string validFrom, string? validTo)
    {
        await ExecuteAsync(
            """
            INSERT INTO customer.metering_point
                (id, customer_id, ean, commodity, brp_id, production_expectation,
                 name, valid_from, valid_to)
            VALUES
                (gen_random_uuid(), @customerId, @ean, 'ELECTRICITY', @brpId, 'UNKNOWN',
                 NULL, CAST(@validFrom AS date), CAST(@validTo AS date));
            """,
            ("customerId", CustomerId),
            ("ean", ean),
            ("brpId", BrpId),
            ("validFrom", validFrom),
            ("validTo", (object?)validTo ?? DBNull.Value));
    }

    private async Task ExecuteAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync(TestContext.Current.CancellationToken);
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        await command.ExecuteNonQueryAsync(TestContext.Current.CancellationToken);
    }

    private async Task<T> ScalarAsync<T>(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync(TestContext.Current.CancellationToken);
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        var result = await command.ExecuteScalarAsync(TestContext.Current.CancellationToken);
        return (T)result!;
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

First confirm the guard rail bites by proving the constraint is the thing doing the work.
Temporarily comment out the exclusion-constraint `migrationBuilder.Sql(...)` block in
`src/Infrastructure/PeakPower.Persistence/Migrations/<timestamp>_InitialSchema.cs`, then run:

```bash
docker info > /dev/null || echo "start Docker first"
dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo
```

Expected: FAIL — `Two_overlapping_validity_periods_for_the_same_EAN_are_rejected_by_the_database`
fails with `Expected a <Npgsql.PostgresException> to be thrown, but no exception was thrown.`
(`MigrationScriptTests.The_same_EAN_cannot_overlap_itself_in_time` fails too, which is the point:
two independent tests cover the same rule from different sides.)

- [ ] **Step 3: Write the minimal implementation**

Restore the exclusion-constraint block exactly as Task 21 wrote it:

```csharp
            migrationBuilder.Sql(
                """
                ALTER TABLE customer.metering_point
                    ADD CONSTRAINT metering_point_ean_validity_excl
                    EXCLUDE USING gist (ean WITH =, validity WITH &&);
                """);
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo`
Expected: PASS — 65 passed, 0 failed (the first run pulls the `postgres:17` image, so allow a
few minutes)

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Database \
        src/Infrastructure/PeakPower.Persistence/Migrations
git commit -m "test: prove migration 1 applies and the EAN exclusion constraint rejects overlaps"
```

---

### Task 23: The `PeakPower.Migrator` host

*Migrations run to completion before any API starts* `[design §3]`. That is why migration is a
separate host rather than something an API does at boot: the AppHost can then make both APIs
`WaitForCompletion(migrator)`, and a failed migration stops the whole graph instead of leaving
one API up against a half-migrated schema.

It exits 0 on success and 1 on failure. Nothing else.

**Files:**
- Modify: `src/Hosts/PeakPower.Migrator/Program.cs`
- Test: `tools/verify-migrator.sh`

**Interfaces:**
- Consumes: `PersistenceServiceCollectionExtensions.AddPeakPowerPersistence(IServiceCollection, string)`
  and `DatabaseMigrator.RunAsync(CancellationToken)` (Task 20); `Extensions.AddServiceDefaults`
  (Task 3's stub, Task 24's real one).
- Produces: an executable that reads the connection string named `peakpower` from configuration
  (`ConnectionStrings__peakpower` as an environment variable, or Aspire's `WithReference`),
  applies every pending migration, and exits.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh`:

```bash
#!/usr/bin/env bash
# Runs the Migrator host against a throwaway PostgreSQL 17 container and asserts that it
# migrates to completion, exits 0, and is idempotent on a second run.
set -uo pipefail

root="/Users/thinhhuynh/PeakPower/peakpower-platform"
container="peakpower-migrator-check-$$"
failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
cleanup() { docker rm -f "$container" > /dev/null 2>&1 || true; }
trap cleanup EXIT

docker info > /dev/null 2>&1 || { echo "FAIL: the Docker daemon is not running" >&2; exit 1; }

docker run --detach --name "$container" \
  --env POSTGRES_PASSWORD=postgres \
  --env POSTGRES_DB=peakpower \
  --publish 0:5432 \
  postgres:17 > /dev/null || { echo "FAIL: could not start postgres:17" >&2; exit 1; }

port="$(docker port "$container" 5432/tcp | head -1 | sed 's/.*://')"

ready=0
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready --username postgres --dbname peakpower > /dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[[ $ready -eq 1 ]] || { echo "FAIL: postgres did not become ready within 60 seconds" >&2; exit 1; }

export ConnectionStrings__peakpower="Host=localhost;Port=$port;Database=peakpower;Username=postgres;Password=postgres"

dotnet run --project "$root/src/Hosts/PeakPower.Migrator/PeakPower.Migrator.csproj" \
  --no-launch-profile > /tmp/peakpower-migrator-first.log 2>&1
first_exit=$?
[[ $first_exit -eq 0 ]] || { fail "the first migrator run exited $first_exit"; tail -20 /tmp/peakpower-migrator-first.log >&2; }

history_rows="$(docker exec "$container" psql --username postgres --dbname peakpower \
  --tuples-only --no-align --command 'SELECT count(*) FROM "__EFMigrationsHistory";' 2>/dev/null | tr -d '[:space:]')"
[[ "$history_rows" == "1" ]] || fail "expected 1 row in __EFMigrationsHistory, found '$history_rows'"

constraint="$(docker exec "$container" psql --username postgres --dbname peakpower \
  --tuples-only --no-align --command \
  "SELECT conname FROM pg_constraint WHERE conname = 'metering_point_ean_validity_excl';" 2>/dev/null | tr -d '[:space:]')"
[[ "$constraint" == "metering_point_ean_validity_excl" ]] \
  || fail "the EAN validity exclusion constraint is missing after migration"

dotnet run --project "$root/src/Hosts/PeakPower.Migrator/PeakPower.Migrator.csproj" \
  --no-launch-profile > /tmp/peakpower-migrator-second.log 2>&1
second_exit=$?
[[ $second_exit -eq 0 ]] || { fail "the second migrator run exited $second_exit"; tail -20 /tmp/peakpower-migrator-second.log >&2; }

grep -q "already up to date" /tmp/peakpower-migrator-second.log \
  || fail "the second run did not report that the database is already up to date"

# No connection string at all must be a loud failure, not a silent success.
env -u ConnectionStrings__peakpower dotnet run \
  --project "$root/src/Hosts/PeakPower.Migrator/PeakPower.Migrator.csproj" \
  --no-launch-profile > /tmp/peakpower-migrator-nocs.log 2>&1
missing_exit=$?
[[ $missing_exit -ne 0 ]] || fail "the migrator succeeded with no connection string configured"
grep -q "ConnectionStrings__peakpower" /tmp/peakpower-migrator-nocs.log \
  || fail "the missing-connection-string message does not name the environment variable to set"

if [[ $failures -gt 0 ]]; then
  echo "verify-migrator: $failures check(s) failed" >&2
  exit 1
fi
echo "verify-migrator: OK"
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
chmod +x /Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh
/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh
```

Expected: FAIL with
`FAIL: expected 1 row in __EFMigrationsHistory, found ''` — the placeholder `Program.cs` from
Task 3 does nothing at all, so the table does not exist.

- [ ] **Step 3: Write the minimal implementation**

Replace `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Migrator/Program.cs`:

```csharp
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using PeakPower.Persistence;
using PeakPower.ServiceDefaults;

var builder = Host.CreateApplicationBuilder(args);
builder.AddServiceDefaults();

var connectionString = builder.Configuration.GetConnectionString("peakpower");
if (string.IsNullOrWhiteSpace(connectionString))
{
    Console.Error.WriteLine(
        "The connection string named 'peakpower' is not configured.\n"
        + "  Inside Aspire it arrives through WithReference(peakpowerDb).\n"
        + "  Outside Aspire, set the environment variable ConnectionStrings__peakpower, for example:\n"
        + "    ConnectionStrings__peakpower=\"Host=localhost;Port=5432;Database=peakpower;Username=postgres;Password=postgres\"");
    return 1;
}

builder.Services.AddPeakPowerPersistence(connectionString);

using var host = builder.Build();
var logger = host.Services.GetRequiredService<ILoggerFactory>().CreateLogger("PeakPower.Migrator");

await using var scope = host.Services.CreateAsyncScope();
var migrator = scope.ServiceProvider.GetRequiredService<DatabaseMigrator>();

try
{
    var applied = await migrator.RunAsync(CancellationToken.None);
    logger.LogInformation("Migrator finished. {Count} migration(s) applied.", applied);
    return 0;
}
catch (Exception exception)
{
    logger.LogCritical(exception, "Migrator failed. No API may start against this database.");
    return 1;
}
```

`DatabaseMigrator` already logs `"The database is already up to date; no migrations to apply."`
on a second run, which is the line the test greps for.

- [ ] **Step 4: Run the test and watch it pass**

Run: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh`
Expected: PASS — prints `verify-migrator: OK`

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Migrator/Program.cs tools/verify-migrator.sh
git commit -m "feat(migrator): apply migrations to completion and exit with a meaningful code"
```

---

### Task 24: `PeakPower.ServiceDefaults` and the two API shells

Aspire's shared host wiring: OpenTelemetry (traces, metrics, logs over OTLP), health checks and
standard HTTP resilience, applied identically by every host. The two API projects stay empty
beyond this — plan 2 adds the employee endpoints, plans 5 and 6 the customer ones — but they
must boot, because the AppHost references them and `WaitForCompletion` needs something to wait
for.

Two health endpoints, following Aspire's convention: `/health` means "ready to take traffic"
(every check passes) and `/alive` means "the process is not wedged" (only checks tagged `live`).

**Files:**
- Modify: `src/Hosts/PeakPower.ServiceDefaults/Extensions.cs`
- Test: `tests/PeakPower.Integration.Tests/Hosts/ApiShellTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Api.Customer.CustomerApiEntryPoint` and
  `PeakPower.Api.Employee.EmployeeApiEntryPoint` (Task 3) — `WebApplicationFactory<T>` boots a
  host from any public type in that host's assembly, so these named markers avoid the
  ambiguity two top-level `Program` classes would create in one test project.
- Produces:
  - `PeakPower.ServiceDefaults.Extensions.AddServiceDefaults<TBuilder>(TBuilder builder) where TBuilder : IHostApplicationBuilder`
  - `PeakPower.ServiceDefaults.Extensions.ConfigureOpenTelemetry<TBuilder>(TBuilder builder) where TBuilder : IHostApplicationBuilder`
  - `PeakPower.ServiceDefaults.Extensions.AddDefaultHealthChecks<TBuilder>(TBuilder builder) where TBuilder : IHostApplicationBuilder`
  - `PeakPower.ServiceDefaults.Extensions.MapDefaultEndpoints(WebApplication app)` — maps
    `/health` (every check) and `/alive` (checks tagged `live`)

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Hosts/ApiShellTests.cs`:

```csharp
using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using PeakPower.Api.Customer;
using PeakPower.Api.Employee;

namespace PeakPower.Integration.Tests.Hosts;

/// <summary>
/// Both API hosts must boot and answer the two health endpoints ServiceDefaults maps. They hold
/// no business endpoints in plan 1 on purpose; plans 2, 5 and 6 fill them.
/// </summary>
public sealed class ApiShellTests
{
    [Theory]
    [InlineData("/health")]
    [InlineData("/alive")]
    public Task The_customer_API_answers_the_health_endpoint(string path) =>
        AssertOkAsync<CustomerApiEntryPoint>(path);

    [Theory]
    [InlineData("/health")]
    [InlineData("/alive")]
    public Task The_employee_API_answers_the_health_endpoint(string path) =>
        AssertOkAsync<EmployeeApiEntryPoint>(path);

    [Fact]
    public async Task The_customer_API_has_no_business_endpoints_yet()
    {
        using var factory = new WebApplicationFactory<CustomerApiEntryPoint>();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(
            "/api/v1/metering-points", TestContext.Current.CancellationToken);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task The_employee_API_has_no_business_endpoints_yet()
    {
        using var factory = new WebApplicationFactory<EmployeeApiEntryPoint>();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(
            "/api/v1/customers", TestContext.Current.CancellationToken);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    private static async Task AssertOkAsync<TEntryPoint>(string path)
        where TEntryPoint : class
    {
        using var factory = new WebApplicationFactory<TEntryPoint>();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(path, TestContext.Current.CancellationToken);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo`
Expected: FAIL — every health test fails with
`Expected response.StatusCode to be HttpStatusCode.OK, but found HttpStatusCode.NotFound`,
because Task 3's `MapDefaultEndpoints` stub maps nothing.

- [ ] **Step 3: Write the minimal implementation**

Replace `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.ServiceDefaults/Extensions.cs`:

```csharp
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OpenTelemetry;
using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;

namespace PeakPower.ServiceDefaults;

/// <summary>
/// Cross-cutting host wiring shared by every PeakPower host: telemetry, health and resilience.
/// A host references infrastructure only to register it at the composition root, and this is
/// the composition root's shared half.
/// </summary>
public static class Extensions
{
    private const string HealthEndpointPath = "/health";
    private const string LivenessEndpointPath = "/alive";
    private const string LivenessTag = "live";

    public static TBuilder AddServiceDefaults<TBuilder>(this TBuilder builder)
        where TBuilder : IHostApplicationBuilder
    {
        builder.ConfigureOpenTelemetry();
        builder.AddDefaultHealthChecks();

        // Every host gets the calendar. Architecture fact 5 forbids reading the system clock
        // anywhere else, so a host that forgot this line fails at resolve time rather than
        // quietly using DateTime.UtcNow.
        builder.Services.AddMarketCalendar();

        builder.Services.AddServiceDiscovery();
        builder.Services.ConfigureHttpClientDefaults(http =>
        {
            // Retries, circuit breaker and timeout on every outbound HttpClient by default.
            http.AddStandardResilienceHandler();
            http.AddServiceDiscovery();
        });

        return builder;
    }

    public static TBuilder ConfigureOpenTelemetry<TBuilder>(this TBuilder builder)
        where TBuilder : IHostApplicationBuilder
    {
        builder.Logging.AddOpenTelemetry(logging =>
        {
            logging.IncludeFormattedMessage = true;
            logging.IncludeScopes = true;
        });

        builder.Services.AddOpenTelemetry()
            .WithMetrics(metrics => metrics
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation()
                .AddRuntimeInstrumentation())
            .WithTracing(tracing => tracing
                .AddAspNetCoreInstrumentation()
                .AddHttpClientInstrumentation());

        // Aspire sets OTEL_EXPORTER_OTLP_ENDPOINT; outside Aspire there is nowhere to export to.
        if (!string.IsNullOrWhiteSpace(builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"]))
        {
            builder.Services.AddOpenTelemetry().UseOtlpExporter();
        }

        return builder;
    }

    public static TBuilder AddDefaultHealthChecks<TBuilder>(this TBuilder builder)
        where TBuilder : IHostApplicationBuilder
    {
        builder.Services.AddHealthChecks()
            .AddCheck("self", () => HealthCheckResult.Healthy(), tags: [LivenessTag]);

        return builder;
    }

    /// <summary>
    /// /health means "ready to take traffic" - every check passes.
    /// /alive means "the process is not wedged" - only checks tagged "live".
    /// </summary>
    public static WebApplication MapDefaultEndpoints(this WebApplication app)
    {
        app.MapHealthChecks(HealthEndpointPath);

        app.MapHealthChecks(LivenessEndpointPath, new HealthCheckOptions
        {
            Predicate = registration => registration.Tags.Contains(LivenessTag),
        });

        return app;
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo`
Expected: PASS — 71 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.ServiceDefaults/Extensions.cs \
        tests/PeakPower.Integration.Tests/Hosts
git commit -m "feat(hosts): add ServiceDefaults telemetry, health and resilience, and boot both API shells"
```

---

### Task 25: Assert the Aspire 13.5.3 API surface before writing the AppHost

The specification's AppHost snippet was written against Aspire 9.x. **Three things changed and
all three break the snippet.** Verify them before writing code rather than after:

1. Aspire is no longer a `dotnet workload`. It is `aspire.cli` plus the `Aspire.AppHost.Sdk`
   MSBuild SDK, currently 13.5.3.
2. `Aspire.Hosting.NodeJs` stopped at 9.5.2 and was replaced by **`Aspire.Hosting.JavaScript`**
   at 13.x. **`AddNpmApp` no longer exists.** The 13.5.3 replacement is
   `AddJavaScriptApp(name, appDirectory, runScriptName)` combined with `WithNpm()` and, when the
   script name is not the default `dev`, `WithRunScript(scriptName)`.
3. Shared contract §10 already amends the snippet for a second, independent reason: it points
   `AddNpmApp` at `apps/customer-portal`, where there is **no `package.json`** — the Angular
   workspace declares exactly one, at the root.

The script below turns all of that into an assertion that runs in two seconds and fails loudly
if a future Aspire version moves the API again.

**Files:**
- Create: `tools/verify-aspire-api.sh`
- Test: the same file

**Interfaces:**
- Consumes: `src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj` (Task 3).
- Produces: a check that `AddJavaScriptApp`, `WithNpm`, `WithRunScript`, `WaitForCompletion`,
  `WaitFor`, `AddPostgres`, `WithDataVolume`, `WithPgAdmin` and `AddDatabase` all exist at
  13.5.3, and that `AddNpmApp` does not.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-aspire-api.sh`:

```bash
#!/usr/bin/env bash
# Asserts the Aspire 13.5.3 API surface the AppHost depends on, by reading the XML
# documentation shipped inside the restored NuGet packages. Two seconds, no build.
set -uo pipefail

root="/Users/thinhhuynh/PeakPower/peakpower-platform"
packages="${NUGET_PACKAGES:-$HOME/.nuget/packages}"
version="13.5.3"
failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }

core="$packages/aspire.hosting/$version/lib/net8.0/Aspire.Hosting.xml"
javascript="$packages/aspire.hosting.javascript/$version/lib/net8.0/Aspire.Hosting.JavaScript.xml"
postgres="$packages/aspire.hosting.postgresql/$version/lib/net8.0/Aspire.Hosting.PostgreSQL.xml"

for file in "$core" "$javascript" "$postgres"; do
  if [[ ! -f "$file" ]]; then
    echo "FAIL: $file is missing. Run:" >&2
    echo "  dotnet restore $root/src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj" >&2
    exit 1
  fi
done

present() { grep -q "name=\"M:$2" "$1"; }

for member in \
  "Aspire.Hosting.ResourceBuilderExtensions.WaitForCompletion" \
  "Aspire.Hosting.ResourceBuilderExtensions.WaitFor\`\`1" \
  "Aspire.Hosting.ResourceBuilderExtensions.WithReference" \
  "Aspire.Hosting.ResourceBuilderExtensions.WithExternalHttpEndpoints" \
  "Aspire.Hosting.ContainerResourceBuilderExtensions.WithImageTag" \
  "Aspire.Hosting.ProjectResourceBuilderExtensions.AddProject" ; do
  present "$core" "$member" || fail "Aspire.Hosting $version no longer exposes $member"
done

grep -q 'name="P:Aspire.Hosting.IDistributedApplicationBuilder.AppHostDirectory"' "$core" \
  || fail "IDistributedApplicationBuilder.AppHostDirectory is gone; WebRootLocator depends on it"

for member in \
  "Aspire.Hosting.JavaScriptHostingExtensions.AddJavaScriptApp" \
  "Aspire.Hosting.JavaScriptHostingExtensions.WithNpm" \
  "Aspire.Hosting.JavaScriptHostingExtensions.WithRunScript" ; do
  present "$javascript" "$member" || fail "Aspire.Hosting.JavaScript $version no longer exposes $member"
done

# The specification's 9.x-era snippet calls AddNpmApp. It does not exist at 13.x.
if grep -q "AddNpmApp" "$javascript"; then
  fail "AddNpmApp reappeared at $version; re-read the AppHost against the current API"
fi

for member in \
  "Aspire.Hosting.PostgresBuilderExtensions.AddPostgres" \
  "Aspire.Hosting.PostgresBuilderExtensions.AddDatabase" \
  "Aspire.Hosting.PostgresBuilderExtensions.WithDataVolume" \
  "Aspire.Hosting.PostgresBuilderExtensions.WithPgAdmin" ; do
  present "$postgres" "$member" || fail "Aspire.Hosting.PostgreSQL $version no longer exposes $member"
done

if [[ $failures -gt 0 ]]; then
  echo "verify-aspire-api: $failures check(s) failed" >&2
  exit 1
fi
echo "verify-aspire-api: OK"
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
chmod +x /Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-aspire-api.sh
NUGET_PACKAGES=/tmp/peakpower-empty-nuget /Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-aspire-api.sh
```

Expected: FAIL with
`FAIL: /tmp/peakpower-empty-nuget/aspire.hosting/13.5.3/lib/net8.0/Aspire.Hosting.xml is missing. Run:`
followed by the `dotnet restore` command to fix it.

- [ ] **Step 3: Write the minimal implementation**

Restore the AppHost so the packages are on disk:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet restore src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj
```

Record what was found, so the next person does not have to rediscover it. Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost/README.md`:

```markdown
# PeakPower.AppHost

Aspire **13.5.3**. Aspire is a CLI global tool (`dotnet tool install -g aspire.cli`) plus the
`Aspire.AppHost.Sdk` MSBuild SDK. It is **not** a `dotnet workload`; `dotnet workload install
aspire` no longer exists.

## What changed since the specification's 9.x-era snippet

| Specification says | Aspire 13.5.3 |
| --- | --- |
| `AddNpmApp(name, dir, script)` from `Aspire.Hosting.NodeJs` | `AddJavaScriptApp(name, appDirectory, runScriptName)` from `Aspire.Hosting.JavaScript`, with `.WithNpm()` |
| `AddNpmApp(name, $"{webRoot}/apps/customer-portal", "start")` | the workspace has one `package.json`, at the root: point at `webRoot` and use the per-app script |
| a `--backend-only` flag that is promised and never checked | `AppHostOptions.IsBackendOnly(args)`, actually checked |

`tools/verify-aspire-api.sh` asserts all of this and fails if a future Aspire moves it again.
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-aspire-api.sh`
Expected: PASS — prints `verify-aspire-api: OK`

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tools/verify-aspire-api.sh src/Hosts/PeakPower.AppHost/README.md
git commit -m "test: assert the Aspire 13.5.3 API surface the AppHost depends on"
```

---

### Task 26: `WebRootLocator` and `AppHostOptions`

`[design §11]`: *the web root resolves as `PEAKPOWER_WEB_PATH` first, sibling checkout second,
loud failure third — naming the path it looked in and the two ways to fix it.*

`--backend-only` is the flag the specification's snippet promises and never checks. It is
implemented here and actually checked in Task 27, so a developer who has not cloned
`peakpower-web` can still bring the backend up.

Both are pure functions with no Aspire dependency, so they are unit-testable without starting a
distributed application.

**Files:**
- Create: `src/Hosts/PeakPower.AppHost/WebRootLocator.cs`
- Create: `src/Hosts/PeakPower.AppHost/AppHostOptions.cs`
- Test: `tests/PeakPower.AppHost.Tests/WebRootLocatorTests.cs`
- Test: `tests/PeakPower.AppHost.Tests/AppHostOptionsTests.cs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PeakPower.AppHost.WebRootLocator.Locate(string? environmentValue, string appHostDirectory, Func<string, bool> directoryExists)`
    returning the absolute web root, throwing `InvalidOperationException` when it cannot be found
  - `PeakPower.AppHost.WebRootLocator.SiblingCheckoutPath(string appHostDirectory)` returning the
    absolute default location
  - `PeakPower.AppHost.AppHostOptions.IsBackendOnly(string[] args)`

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests/WebRootLocatorTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.AppHost;

namespace PeakPower.AppHost.Tests;

public sealed class WebRootLocatorTests
{
    private const string AppHostDirectory =
        "/Users/someone/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost";

    private const string SiblingCheckout = "/Users/someone/PeakPower/peakpower-web";

    [Fact]
    public void PEAKPOWER_WEB_PATH_wins_when_it_points_at_a_directory_that_exists()
    {
        var located = WebRootLocator.Locate(
            "/elsewhere/peakpower-web", AppHostDirectory, path => path == "/elsewhere/peakpower-web");

        located.Should().Be("/elsewhere/peakpower-web");
    }

    [Fact]
    public void The_sibling_checkout_is_used_when_PEAKPOWER_WEB_PATH_is_not_set()
    {
        var located = WebRootLocator.Locate(null, AppHostDirectory, path => path == SiblingCheckout);

        located.Should().Be(SiblingCheckout);
    }

    [Fact]
    public void A_blank_PEAKPOWER_WEB_PATH_is_treated_as_not_set()
    {
        var located = WebRootLocator.Locate("   ", AppHostDirectory, path => path == SiblingCheckout);

        located.Should().Be(SiblingCheckout);
    }

    [Fact]
    public void The_sibling_checkout_sits_beside_the_platform_repository()
    {
        WebRootLocator.SiblingCheckoutPath(AppHostDirectory).Should().Be(SiblingCheckout);
    }

    [Fact]
    public void A_PEAKPOWER_WEB_PATH_that_does_not_exist_fails_loudly_and_names_the_path()
    {
        var act = () => WebRootLocator.Locate("/nowhere/peakpower-web", AppHostDirectory, _ => false);

        act.Should().Throw<InvalidOperationException>()
           .WithMessage("*/nowhere/peakpower-web*")
           .WithMessage("*PEAKPOWER_WEB_PATH*")
           .WithMessage("*--backend-only*");
    }

    [Fact]
    public void A_missing_sibling_checkout_fails_loudly_and_names_both_ways_to_fix_it()
    {
        var act = () => WebRootLocator.Locate(null, AppHostDirectory, _ => false);

        act.Should().Throw<InvalidOperationException>()
           .WithMessage($"*{SiblingCheckout}*")
           .WithMessage("*clone peakpower-web next to peakpower-platform*")
           .WithMessage("*PEAKPOWER_WEB_PATH*")
           .WithMessage("*--backend-only*");
    }
}
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests/AppHostOptionsTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.AppHost;

namespace PeakPower.AppHost.Tests;

public sealed class AppHostOptionsTests
{
    [Fact]
    public void The_flag_is_off_when_no_arguments_are_passed()
    {
        AppHostOptions.IsBackendOnly([]).Should().BeFalse();
    }

    [Fact]
    public void The_flag_is_on_when_it_is_passed()
    {
        AppHostOptions.IsBackendOnly(["--backend-only"]).Should().BeTrue();
    }

    [Fact]
    public void The_flag_is_on_when_it_is_passed_among_other_arguments()
    {
        AppHostOptions.IsBackendOnly(["--launch-profile", "https", "--backend-only"]).Should().BeTrue();
    }

    [Fact]
    public void An_unrelated_argument_does_not_turn_the_flag_on()
    {
        AppHostOptions.IsBackendOnly(["--backend"]).Should().BeFalse();
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests --nologo`
Expected: FAIL with `error CS0234: The type or namespace name 'WebRootLocator' does not exist in
the namespace 'PeakPower.AppHost'`

- [ ] **Step 3: Write the minimal implementation**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost/WebRootLocator.cs`:

```csharp
namespace PeakPower.AppHost;

/// <summary>
/// Finds the peakpower-web checkout: PEAKPOWER_WEB_PATH first, the sibling checkout second,
/// a loud failure third. [design section 11]
/// </summary>
public static class WebRootLocator
{
    private const string WebRepositoryFolderName = "peakpower-web";

    /// <param name="environmentValue">The value of PEAKPOWER_WEB_PATH, or null when unset.</param>
    /// <param name="appHostDirectory">
    /// The AppHost project directory, which Aspire exposes as
    /// IDistributedApplicationBuilder.AppHostDirectory.
    /// </param>
    /// <param name="directoryExists">
    /// Injected so the resolution rules can be tested without a filesystem. Production passes
    /// Directory.Exists.
    /// </param>
    /// <exception cref="InvalidOperationException">
    /// Thrown when no checkout can be found, naming the path it looked in and both fixes.
    /// </exception>
    public static string Locate(
        string? environmentValue,
        string appHostDirectory,
        Func<string, bool> directoryExists)
    {
        if (!string.IsNullOrWhiteSpace(environmentValue))
        {
            var fromEnvironment = Path.GetFullPath(environmentValue.Trim());
            return directoryExists(fromEnvironment)
                ? fromEnvironment
                : throw new InvalidOperationException(CouldNotFind(fromEnvironment));
        }

        var sibling = SiblingCheckoutPath(appHostDirectory);
        return directoryExists(sibling)
            ? sibling
            : throw new InvalidOperationException(CouldNotFind(sibling));
    }

    /// <summary>
    /// The default location: peakpower-web beside peakpower-platform. The AppHost project sits
    /// four levels below the platform repository root
    /// (repository/src/Hosts/PeakPower.AppHost), so five levels up and across is the sibling.
    /// </summary>
    public static string SiblingCheckoutPath(string appHostDirectory) =>
        Path.GetFullPath(Path.Combine(appHostDirectory, "..", "..", "..", "..", WebRepositoryFolderName));

    private static string CouldNotFind(string path) =>
        $"""
         PeakPower cannot find the {WebRepositoryFolderName} checkout.
           Looked in: {path}
           Fix it either way:
             1. clone peakpower-web next to peakpower-platform, or
             2. set PEAKPOWER_WEB_PATH to the absolute path of the peakpower-web checkout.
           Or start the backend on its own:  ./dev-up --backend-only
         """;
}
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost/AppHostOptions.cs`:

```csharp
namespace PeakPower.AppHost;

/// <summary>
/// The AppHost's own command-line flags. The specification's snippet promises --backend-only
/// and never checks it; here it is checked.
/// </summary>
public static class AppHostOptions
{
    public const string BackendOnlyFlag = "--backend-only";

    /// <summary>
    /// True when the developer asked for Postgres, the migrator and the two APIs, and no
    /// front-ends. Useful before peakpower-web exists, and when working on the backend alone.
    /// </summary>
    public static bool IsBackendOnly(string[] args) =>
        args.Contains(BackendOnlyFlag, StringComparer.Ordinal);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests --nologo`
Expected: PASS — 10 passed, 0 failed

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.AppHost/WebRootLocator.cs \
        src/Hosts/PeakPower.AppHost/AppHostOptions.cs \
        tests/PeakPower.AppHost.Tests
git commit -m "feat(apphost): resolve the web root loudly and honour --backend-only"
```

---

### Task 27: The AppHost resource graph

`[design §4.4]`: `postgres` (with a data volume and pgAdmin) → database `peakpower` → `migrator`
→ `customer-api` and `employee-api`, both `WaitForCompletion(migrator)` → two front-ends
resolved through `PEAKPOWER_WEB_PATH`.

Redis, the storage emulator, the `hangfire` database and `dev-stubs` are **not** added. They
have no consumer in this slice, and an AppHost that starts unused containers trains people to
ignore it.

The front-ends are registered only when the resolved web root actually contains a
`package.json`. In plan 1 it does not — plans 3, 4 and 6 create the Angular workspace — so the
AppHost says so on stdout and brings up the backend. That decision is `FrontEndPlan`, which is
pure and therefore tested; the Aspire calls around it are verified by the build and by
`./dev-up` in Task 28.

**Files:**
- Create: `src/Hosts/PeakPower.AppHost/FrontEndPlan.cs`
- Modify: `src/Hosts/PeakPower.AppHost/Program.cs`
- Test: `tests/PeakPower.AppHost.Tests/FrontEndPlanTests.cs`

**Interfaces:**
- Consumes: `WebRootLocator.Locate`, `WebRootLocator.SiblingCheckoutPath`,
  `AppHostOptions.IsBackendOnly` (Task 26); `Projects.PeakPower_Migrator`,
  `Projects.PeakPower_Api_Customer`, `Projects.PeakPower_Api_Employee` (generated by
  `Aspire.AppHost.Sdk` from the AppHost's `ProjectReference` items, Task 3).
- Produces:
  - `PeakPower.AppHost.FrontEndPlan(bool Include, string? WebRoot, string Reason)` with
    `static FrontEndPlan Decide(string[] args, string? environmentValue, string appHostDirectory, Func<string, bool> directoryExists, Func<string, bool> fileExists)`
  - Aspire resource names other plans and `dev-up` refer to: `postgres`, `peakpower`,
    `migrator`, `customer-api`, `employee-api`, `customer-portal`, `employee-portal`

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests/FrontEndPlanTests.cs`:

```csharp
using FluentAssertions;
using PeakPower.AppHost;

namespace PeakPower.AppHost.Tests;

public sealed class FrontEndPlanTests
{
    private const string AppHostDirectory =
        "/Users/someone/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost";

    private const string SiblingCheckout = "/Users/someone/PeakPower/peakpower-web";
    private const string SiblingPackageJson = "/Users/someone/PeakPower/peakpower-web/package.json";

    [Fact]
    public void Backend_only_skips_the_front_ends_without_looking_for_a_checkout_at_all()
    {
        var plan = FrontEndPlan.Decide(
            ["--backend-only"],
            environmentValue: null,
            AppHostDirectory,
            directoryExists: _ => throw new InvalidOperationException("must not be consulted"),
            fileExists: _ => throw new InvalidOperationException("must not be consulted"));

        plan.Include.Should().BeFalse();
        plan.WebRoot.Should().BeNull();
        plan.Reason.Should().Contain("--backend-only");
    }

    [Fact]
    public void A_checkout_with_a_package_json_gets_both_front_ends()
    {
        var plan = FrontEndPlan.Decide(
            [],
            environmentValue: null,
            AppHostDirectory,
            directoryExists: path => path == SiblingCheckout,
            fileExists: path => path == SiblingPackageJson);

        plan.Include.Should().BeTrue();
        plan.WebRoot.Should().Be(SiblingCheckout);
    }

    [Fact]
    public void A_checkout_without_a_package_json_starts_the_backend_and_says_why()
    {
        var plan = FrontEndPlan.Decide(
            [],
            environmentValue: null,
            AppHostDirectory,
            directoryExists: path => path == SiblingCheckout,
            fileExists: _ => false);

        plan.Include.Should().BeFalse();
        plan.WebRoot.Should().Be(SiblingCheckout);
        plan.Reason.Should().Contain(SiblingPackageJson);
        plan.Reason.Should().Contain("Angular workspace");
    }

    [Fact]
    public void No_checkout_at_all_fails_loudly_rather_than_quietly_skipping_the_front_ends()
    {
        var act = () => FrontEndPlan.Decide(
            [],
            environmentValue: null,
            AppHostDirectory,
            directoryExists: _ => false,
            fileExists: _ => false);

        act.Should().Throw<InvalidOperationException>()
           .WithMessage($"*{SiblingCheckout}*")
           .WithMessage("*--backend-only*");
    }

    [Fact]
    public void PEAKPOWER_WEB_PATH_overrides_the_sibling_checkout()
    {
        var plan = FrontEndPlan.Decide(
            [],
            environmentValue: "/elsewhere/peakpower-web",
            AppHostDirectory,
            directoryExists: path => path == "/elsewhere/peakpower-web",
            fileExists: path => path == "/elsewhere/peakpower-web/package.json");

        plan.Include.Should().BeTrue();
        plan.WebRoot.Should().Be("/elsewhere/peakpower-web");
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests --nologo`
Expected: FAIL with `error CS0234: The type or namespace name 'FrontEndPlan' does not exist in
the namespace 'PeakPower.AppHost'`

- [ ] **Step 3: Write the minimal implementation**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost/FrontEndPlan.cs`:

```csharp
namespace PeakPower.AppHost;

/// <summary>
/// Whether the AppHost adds the two Angular front-ends, and from where.
/// </summary>
/// <param name="Include">True when both front-ends should be registered.</param>
/// <param name="WebRoot">The resolved peakpower-web checkout, or null under --backend-only.</param>
/// <param name="Reason">A sentence printed at start-up, so the choice is never silent.</param>
public sealed record FrontEndPlan(bool Include, string? WebRoot, string Reason)
{
    public static FrontEndPlan Decide(
        string[] args,
        string? environmentValue,
        string appHostDirectory,
        Func<string, bool> directoryExists,
        Func<string, bool> fileExists)
    {
        if (AppHostOptions.IsBackendOnly(args))
        {
            return new FrontEndPlan(
                Include: false,
                WebRoot: null,
                Reason: $"{AppHostOptions.BackendOnlyFlag} was passed: starting Postgres, the migrator "
                        + "and the two APIs, and no front-ends.");
        }

        // Throws with the path it looked in and both fixes when there is no checkout at all.
        var webRoot = WebRootLocator.Locate(environmentValue, appHostDirectory, directoryExists);

        var packageJson = Path.Combine(webRoot, "package.json");
        if (!fileExists(packageJson))
        {
            return new FrontEndPlan(
                Include: false,
                WebRoot: webRoot,
                Reason: $"No package.json at {packageJson}: the Angular workspace does not exist yet "
                        + "(it arrives with plans 3, 4 and 6). Starting the backend only.");
        }

        return new FrontEndPlan(
            Include: true,
            WebRoot: webRoot,
            Reason: $"Starting the Angular workspace from {webRoot}.");
    }
}
```

Replace `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost/Program.cs`:

```csharp
using PeakPower.AppHost;

var builder = DistributedApplication.CreateBuilder(args);

// PostgreSQL 17 with a named data volume, so the database survives a restart of the AppHost,
// and pgAdmin, so there is a way to look at it without a client on the machine.
// The generated superuser password is persisted through the project's UserSecretsId, which is
// what keeps the data volume usable across runs.
var postgres = builder.AddPostgres("postgres")
    .WithImageTag("17")
    .WithDataVolume("peakpower-postgres-data")
    .WithPgAdmin();

var peakpowerDb = postgres.AddDatabase("peakpower");

// Migrations run to completion before any API starts. A failed migration stops the graph
// instead of leaving one API up against a half-migrated schema.
var migrator = builder.AddProject<Projects.PeakPower_Migrator>("migrator")
    .WithReference(peakpowerDb)
    .WaitFor(peakpowerDb);

var customerApi = builder.AddProject<Projects.PeakPower_Api_Customer>("customer-api")
    .WithReference(peakpowerDb)
    .WaitForCompletion(migrator)
    .WithExternalHttpEndpoints();

var employeeApi = builder.AddProject<Projects.PeakPower_Api_Employee>("employee-api")
    .WithReference(peakpowerDb)
    .WaitForCompletion(migrator)
    .WithExternalHttpEndpoints();

var frontEnds = FrontEndPlan.Decide(
    args,
    Environment.GetEnvironmentVariable("PEAKPOWER_WEB_PATH"),
    builder.AppHostDirectory,
    Directory.Exists,
    File.Exists);

Console.WriteLine($"[apphost] {frontEnds.Reason}");

if (frontEnds.Include)
{
    // Aspire 13.5.3: AddJavaScriptApp, not AddNpmApp - see src/Hosts/PeakPower.AppHost/README.md.
    // The workspace declares exactly one package.json, at the root, so both apps point at the
    // web root and differ only by npm script.
    builder.AddJavaScriptApp("customer-portal", frontEnds.WebRoot!, "start:customer-portal")
        .WithNpm()
        .WithReference(customerApi)
        .WaitFor(customerApi)
        .WithExternalHttpEndpoints();

    builder.AddJavaScriptApp("employee-portal", frontEnds.WebRoot!, "start:employee-portal")
        .WithNpm()
        .WithReference(employeeApi)
        .WaitFor(employeeApi)
        .WithExternalHttpEndpoints();
}

builder.Build().Run();
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests --nologo`
Expected: PASS — 15 passed, 0 failed

Then confirm the Aspire calls themselves compile against 13.5.3:

Run: `dotnet build /Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost --nologo -warnaserror`
Expected: `Build succeeded` with 0 warnings. If `AddJavaScriptApp`, `WithNpm`, `WithImageTag`,
`WithDataVolume`, `WithPgAdmin`, `WaitFor` or `WaitForCompletion` does not resolve, run
`tools/verify-aspire-api.sh` — the Aspire API has moved again and the README table needs updating.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.AppHost/FrontEndPlan.cs \
        src/Hosts/PeakPower.AppHost/Program.cs \
        tests/PeakPower.AppHost.Tests/FrontEndPlanTests.cs
git commit -m "feat(apphost): add the Aspire resource graph for Postgres, the migrator and both APIs"
```

---

### Task 28: `dev-up` in `peakpower-platform`

`[design §11]`: *`dev-up` exists in both repositories and does the same thing in reverse.*
In `peakpower-platform` it checks for the sibling checkout and runs the AppHost.

`PEAKPOWER_DEV_UP_DRY_RUN=1` makes the script print the command it would run and exit, so the
test below can assert the resolution rules without starting Docker containers.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/dev-up`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/dev-up.test.sh`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/dev-up.test.sh`

**Interfaces:**
- Consumes: `src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj` (Task 27).
- Produces: an executable `./dev-up` accepting `--backend-only` and honouring
  `PEAKPOWER_WEB_PATH` and `PEAKPOWER_DEV_UP_DRY_RUN`.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/dev-up.test.sh`:

```bash
#!/usr/bin/env bash
# Asserts the resolution rules of ./dev-up without starting anything.
set -uo pipefail

root="/Users/thinhhuynh/PeakPower/peakpower-platform"
failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }

[[ -x "$root/dev-up" ]] || { echo "FAIL: $root/dev-up is missing or not executable" >&2; exit 1; }

# 1. A missing web checkout fails loudly, names the path, and names both fixes.
output="$(PEAKPOWER_WEB_PATH=/nowhere/peakpower-web "$root/dev-up" 2>&1)"
code=$?
[[ $code -eq 1 ]] || fail "expected exit 1 with a missing web checkout, got $code"
grep -q "/nowhere/peakpower-web" <<< "$output" || fail "the failure does not name the path it looked in"
grep -q "PEAKPOWER_WEB_PATH" <<< "$output" || fail "the failure does not mention PEAKPOWER_WEB_PATH"
grep -q -- "--backend-only" <<< "$output" || fail "the failure does not mention --backend-only"

# 2. --backend-only skips the web checkout entirely.
output="$(PEAKPOWER_WEB_PATH=/nowhere/peakpower-web PEAKPOWER_DEV_UP_DRY_RUN=1 \
  "$root/dev-up" --backend-only 2>&1)"
code=$?
[[ $code -eq 0 ]] || fail "--backend-only should not need a web checkout, got exit $code"
grep -q -- "--backend-only" <<< "$output" || fail "--backend-only was not passed through to the AppHost"

# 3. The sibling checkout is the default and is exported to the AppHost.
output="$(PEAKPOWER_DEV_UP_DRY_RUN=1 "$root/dev-up" 2>&1)"
code=$?
[[ $code -eq 0 ]] || fail "expected exit 0 with the sibling checkout present, got $code"
grep -q "web root: /Users/thinhhuynh/PeakPower/peakpower-web" <<< "$output" \
  || fail "the sibling checkout was not resolved as the web root"

# 4. It runs the AppHost, not something else.
grep -q "src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj" <<< "$output" \
  || fail "dev-up does not run the AppHost project"

if [[ $failures -gt 0 ]]; then
  echo "dev-up.test: $failures check(s) failed" >&2
  exit 1
fi
echo "dev-up.test: OK"
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
chmod +x /Users/thinhhuynh/PeakPower/peakpower-platform/tools/dev-up.test.sh
/Users/thinhhuynh/PeakPower/peakpower-platform/tools/dev-up.test.sh
```

Expected: FAIL with
`FAIL: /Users/thinhhuynh/PeakPower/peakpower-platform/dev-up is missing or not executable`

- [ ] **Step 3: Write the minimal implementation**

```bash
cat > /Users/thinhhuynh/PeakPower/peakpower-platform/dev-up <<'DEVUP'
#!/usr/bin/env bash
#
# Brings the whole slice-1 stack up from the platform side: PostgreSQL 17, pgAdmin, the
# migrator, the two APIs and - once peakpower-web has a package.json - the two Angular
# front-ends. The same command exists in peakpower-web and does the same thing in reverse.
#
#   ./dev-up                  everything
#   ./dev-up --backend-only   Postgres, the migrator and the two APIs only
#
# Environment:
#   PEAKPOWER_WEB_PATH        absolute path to the peakpower-web checkout
#   PEAKPOWER_DEV_UP_DRY_RUN  set to 1 to print the command instead of running it
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
apphost="$here/src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj"

backend_only=0
for argument in "$@"; do
  if [[ "$argument" == "--backend-only" ]]; then
    backend_only=1
  fi
done

if [[ $backend_only -eq 0 ]]; then
  web="${PEAKPOWER_WEB_PATH:-$(cd "$here/.." && pwd)/peakpower-web}"

  if [[ ! -d "$web" ]]; then
    cat >&2 <<MESSAGE
dev-up: cannot find the peakpower-web checkout.
  Looked in: $web
  Fix it either way:
    1. clone peakpower-web next to peakpower-platform, or
    2. set PEAKPOWER_WEB_PATH to the absolute path of the peakpower-web checkout.
  Or start the backend on its own:  ./dev-up --backend-only
MESSAGE
    exit 1
  fi

  export PEAKPOWER_WEB_PATH="$web"
  echo "dev-up: web root: $web"
fi

if [[ "${PEAKPOWER_DEV_UP_DRY_RUN:-0}" == "1" ]]; then
  echo "dev-up: dry run, would run: dotnet run --project $apphost -- $*"
  exit 0
fi

exec dotnet run --project "$apphost" -- "$@"
DEVUP
chmod +x /Users/thinhhuynh/PeakPower/peakpower-platform/dev-up
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/dev-up.test.sh`
Expected: PASS — prints `dev-up.test: OK`

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add dev-up tools/dev-up.test.sh
git commit -m "feat(dev): add ./dev-up with web-root resolution and --backend-only"
```

---

### Task 29: `dev-up` in `peakpower-web`

The mirror image: it finds the platform checkout, exports its own directory as
`PEAKPOWER_WEB_PATH`, and hands over. Whichever repository a developer cloned first, one command
works `[design §11]`.

Delegating rather than duplicating is deliberate: the AppHost already starts the workspace
through `AddJavaScriptApp`, so a second `npm start` here would race it for the port.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-web/dev-up`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-web/tools/dev-up.test.sh`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-web/tools/dev-up.test.sh`

**Interfaces:**
- Consumes: `/Users/thinhhuynh/PeakPower/peakpower-platform/dev-up` (Task 28).
- Produces: an executable `./dev-up` in `peakpower-web` honouring `PEAKPOWER_PLATFORM_PATH` and
  `PEAKPOWER_DEV_UP_DRY_RUN`, and passing every argument through unchanged.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-web/tools/dev-up.test.sh`:

```bash
#!/usr/bin/env bash
# Asserts that peakpower-web's ./dev-up finds the platform checkout and hands over to it.
set -uo pipefail

root="/Users/thinhhuynh/PeakPower/peakpower-web"
failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }

[[ -x "$root/dev-up" ]] || { echo "FAIL: $root/dev-up is missing or not executable" >&2; exit 1; }

# 1. A missing platform checkout fails loudly, names the path, and names both fixes.
output="$(PEAKPOWER_PLATFORM_PATH=/nowhere/peakpower-platform "$root/dev-up" 2>&1)"
code=$?
[[ $code -eq 1 ]] || fail "expected exit 1 with a missing platform checkout, got $code"
grep -q "/nowhere/peakpower-platform" <<< "$output" || fail "the failure does not name the path it looked in"
grep -q "PEAKPOWER_PLATFORM_PATH" <<< "$output" || fail "the failure does not mention PEAKPOWER_PLATFORM_PATH"
grep -q "clone peakpower-platform next to peakpower-web" <<< "$output" \
  || fail "the failure does not mention cloning the sibling"

# 2. It hands over to the platform's dev-up with this checkout as the web root.
output="$(PEAKPOWER_DEV_UP_DRY_RUN=1 "$root/dev-up" 2>&1)"
code=$?
[[ $code -eq 0 ]] || fail "expected exit 0 with the sibling platform checkout present, got $code"
grep -q "web root: /Users/thinhhuynh/PeakPower/peakpower-web" <<< "$output" \
  || fail "this checkout was not exported as the web root"
grep -q "PeakPower.AppHost.csproj" <<< "$output" || fail "it did not hand over to the AppHost"

# 3. Arguments are passed through unchanged.
output="$(PEAKPOWER_DEV_UP_DRY_RUN=1 "$root/dev-up" --backend-only 2>&1)"
code=$?
[[ $code -eq 0 ]] || fail "expected exit 0 with --backend-only, got $code"
grep -q -- "--backend-only" <<< "$output" || fail "--backend-only was not passed through"

if [[ $failures -gt 0 ]]; then
  echo "dev-up.test: $failures check(s) failed" >&2
  exit 1
fi
echo "dev-up.test: OK"
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
mkdir -p /Users/thinhhuynh/PeakPower/peakpower-web/tools
chmod +x /Users/thinhhuynh/PeakPower/peakpower-web/tools/dev-up.test.sh
/Users/thinhhuynh/PeakPower/peakpower-web/tools/dev-up.test.sh
```

Expected: FAIL with
`FAIL: /Users/thinhhuynh/PeakPower/peakpower-web/dev-up is missing or not executable`

- [ ] **Step 3: Write the minimal implementation**

```bash
cat > /Users/thinhhuynh/PeakPower/peakpower-web/dev-up <<'DEVUP'
#!/usr/bin/env bash
#
# Brings the whole slice-1 stack up from the web side. The AppHost in peakpower-platform owns
# the resource graph - including this workspace, which it starts through AddJavaScriptApp - so
# this script finds the platform checkout, tells it where the web root is, and hands over.
# Starting npm here as well would race the AppHost for the port.
#
#   ./dev-up                  everything
#   ./dev-up --backend-only   Postgres, the migrator and the two APIs only
#
# Environment:
#   PEAKPOWER_PLATFORM_PATH   absolute path to the peakpower-platform checkout
#   PEAKPOWER_DEV_UP_DRY_RUN  set to 1 to print the command instead of running it
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
platform="${PEAKPOWER_PLATFORM_PATH:-$(cd "$here/.." && pwd)/peakpower-platform}"

if [[ ! -x "$platform/dev-up" ]]; then
  cat >&2 <<MESSAGE
dev-up: cannot find the peakpower-platform checkout.
  Looked in: $platform
  Fix it either way:
    1. clone peakpower-platform next to peakpower-web, or
    2. set PEAKPOWER_PLATFORM_PATH to the absolute path of the peakpower-platform checkout.
MESSAGE
  exit 1
fi

export PEAKPOWER_WEB_PATH="$here"
exec "$platform/dev-up" "$@"
DEVUP
chmod +x /Users/thinhhuynh/PeakPower/peakpower-web/dev-up
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `/Users/thinhhuynh/PeakPower/peakpower-web/tools/dev-up.test.sh`
Expected: PASS — prints `dev-up.test: OK`

Then prove both directions work, which is the point of having two scripts:

Run: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/dev-up.test.sh`
Expected: PASS — prints `dev-up.test: OK`

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add dev-up tools/dev-up.test.sh
git commit -m "feat(dev): add ./dev-up which hands over to the platform AppHost"
```

---

## Definition of done

Run every one of these from a clean checkout. All of them must hold before plan 2 starts.

1. **Both repositories exist, on `main`, with no remotes.**
   `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-repositories.sh` prints
   `verify-repositories: OK`.

2. **The solution builds with warnings as errors.**
   `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-solution-layout.sh` prints
   `verify-solution-layout: OK`. Eighteen projects are in `PeakPower.sln` — every project
   contract §3.1 names plus `PeakPower.AppHost.Tests` — in the classic `.sln` format, and
   `PeakPower.Domain.csproj` contains no `ProjectReference`.

3. **Architecture facts 1, 2, 3 and 5 pass.**
   `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Architecture.Tests`
   reports 5 passed and 1 skipped — the skip is fact 3, which is armed for the day
   `PeakPower.Ingestion` exists. Facts 4 and 6 are plan 2's (contract §13) and are not asserted
   here.

4. **The whole test suite passes.**
   `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test PeakPower.sln --nologo`
   reports 0 failed across `PeakPower.Domain.Tests`, `PeakPower.Application.Tests`,
   `PeakPower.Integration.Tests`, `PeakPower.Architecture.Tests` and `PeakPower.AppHost.Tests`.
   Docker must be running: the integration tests start a real `postgres:17` container.

5. **Migration 1 applies to an empty PostgreSQL 17 container, and the exclusion constraint
   rejects an overlapping EAN period** — design definition-of-done item 9.
   `MigrationBehaviourTests.Two_overlapping_validity_periods_for_the_same_EAN_are_rejected_by_the_database`
   passes, and the exception it catches carries SQL state `23P01` on constraint
   `metering_point_ean_validity_excl`.

6. **`citext` and `btree_gist` are the first statements of migration 1**, before any
   `CREATE SCHEMA` — `MigrationScriptTests.The_extensions_come_before_the_first_schema_because_the_columns_depend_on_them`
   passes.

7. **The migrator host migrates and exits.**
   `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh` prints
   `verify-migrator: OK`: exit code 0, one row in `__EFMigrationsHistory`, the exclusion
   constraint present, idempotent on a second run, and a non-zero exit with a message naming
   `ConnectionStrings__peakpower` when no connection string is configured.

8. **The Aspire 13.5.3 API surface is what the AppHost assumes.**
   `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-aspire-api.sh` prints
   `verify-aspire-api: OK`, including the assertion that `AddNpmApp` does **not** exist.

9. **`./dev-up` works from both repositories, in both directions.**
   `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/dev-up.test.sh` and
   `/Users/thinhhuynh/PeakPower/peakpower-web/tools/dev-up.test.sh` both print `dev-up.test: OK`.

10. **`./dev-up --backend-only` actually brings the backend up.** From either repository, run
    `./dev-up --backend-only`. The Aspire dashboard opens; `postgres`, `pgadmin`, `peakpower`,
    `migrator`, `customer-api` and `employee-api` all reach a healthy or completed state;
    `migrator` shows `Exited (0)`; `customer-api` and `employee-api` both answer `/health` and
    `/alive` with 200; the console printed one `[apphost]` line explaining that the Angular
    workspace does not exist yet. Stop it with Ctrl-C.

11. **`./dev-up` with no arguments prints the same `[apphost]` line and does not fail**, because
    `/Users/thinhhuynh/PeakPower/peakpower-web` exists but has no `package.json` yet. It starts
    failing usefully — that is, starting the portals — the moment plan 3 lands the workspace.

12. **Every commit is local.** `git -C /Users/thinhhuynh/PeakPower/peakpower-platform remote`
    and `git -C /Users/thinhhuynh/PeakPower/peakpower-web remote` both print nothing.

13. **The corporate Entra tenant access request has been raised**, by a named owner, on a
    recorded date — design §13's week-1 non-code deliverable.
    `/Users/thinhhuynh/PeakPower/peakpower-platform/docs/entra-tenant-access-request.md` exists,
    is committed, names Thinh Huynh as the owner and carries the date it was raised. This is the
    one item on this list that cannot be caught up later: the lead time is somebody else's.

## New names introduced

Names this plan invents that the shared contract does not define. Every one of them is either
scaffolding the contract implies but does not name, or a supporting type migration 1 needs.

### Projects and test projects

| Name | Why |
| --- | --- |
| `PeakPower.AppHost.Tests` | A fifth test project, beyond the four contract §3.1 names, so the Aspire dependency stays out of `PeakPower.Integration.Tests` and `PeakPower.Architecture.Tests`. Tests `WebRootLocator`, `AppHostOptions` and `FrontEndPlan`. |

Every other project this plan creates is named by contract §3.1, including the four
infrastructure projects (`Persistence`, `Time`, `Web`, `Identity`, `Email`) — this plan creates
them, it does not invent them.

### Domain types migration 1 needs

| Name | Signature |
| --- | --- |
| `PeakPower.Domain.Auditing.AuditRecord` | `Guid Id`, `DateTimeOffset OccurredAt`, `string Actor`, `string Action`, `string EntityType`, `Guid EntityId`, `Guid? CustomerId`, `string? Before`, `string? After`; `static Result<AuditRecord> Create(DateTimeOffset occurredAt, string actor, string action, string entityType, Guid entityId, Guid? customerId, string? before, string? after)` |

### Domain members added to contract types

| Name | Signature |
| --- | --- |
| `EanCode.FromPersistedValue` | `static EanCode FromPersistedValue(string value)` — EF value converter only |
| `KvkNumber.FromPersistedValue` | `static KvkNumber FromPersistedValue(string value)` |
| `Iban.FromPersistedValue` | `static Iban FromPersistedValue(string value)` |
| `MeteringPoint.MaximumNameLength` | `const int MaximumNameLength = 80` |
| `MeteringPoint.MaximumDescriptionLength` | `const int MaximumDescriptionLength = 500` |
| `AssemblyMarker` | `public sealed class AssemblyMarker;` in each of `PeakPower.Domain`, `PeakPower.Application`, `PeakPower.Contracts`, `PeakPower.Persistence`, `PeakPower.Infrastructure.Time`, `PeakPower.Infrastructure.Web`, `PeakPower.Infrastructure.Identity`, `PeakPower.Infrastructure.Email` |

Every factory and mutator on `Customer`, `CustomerAccount`, `MeteringPoint`, `Brp` and `Wallet`
is declared by **contract §5.1**, not here. This plan writes them; it does not name them, and no
other plan may re-declare them.

### Persistence types

| Name | Signature |
| --- | --- |
| `PeakPower.Persistence.PeakPowerDbContext` | `PeakPowerDbContext(DbContextOptions<PeakPowerDbContext> options)` with `DbSet<Customer> Customers`, `DbSet<CustomerAccount> CustomerAccounts`, `DbSet<MeteringPoint> MeteringPoints`, `DbSet<Brp> Brps`, `DbSet<Wallet> Wallets`, `DbSet<AuditRecord> AuditRecords` |
| `PeakPower.Persistence.PersistenceServiceCollectionExtensions.AddPeakPowerPersistence` | `static IServiceCollection AddPeakPowerPersistence(this IServiceCollection services, string connectionString)` |
| `PeakPower.Persistence.PersistenceServiceCollectionExtensions.ConfigureDbContext` | `static void ConfigureDbContext(DbContextOptionsBuilder options, string connectionString)` |
| `PeakPower.Persistence.DatabaseMigrator` | `DatabaseMigrator(PeakPowerDbContext context, ILogger<DatabaseMigrator> logger)` with `Task<int> RunAsync(CancellationToken cancellationToken)` |
| `PeakPower.Persistence.PeakPowerDbContextFactory` | `IDesignTimeDbContextFactory<PeakPowerDbContext>` |
| `PeakPower.Persistence.Conversions.EnumToScreamingSnakeConverter<TEnum>` | `ValueConverter<TEnum, string> where TEnum : struct, Enum`; `static string ToScreamingSnake(TEnum value)`, `static TEnum FromScreamingSnake(string text)` |
| `PeakPower.Persistence.Conversions.EnumToTextConvention` | `IModelFinalizingConvention` |
| `PeakPower.Persistence.Conversions.JsonbSerialization.Options` | `static readonly JsonSerializerOptions Options` |
| `PeakPower.Persistence.Conversions.JsonbConverter<T>` | `ValueConverter<T?, string?> where T : class` |
| `PeakPower.Persistence.Conversions.JsonbComparer<T>` | `ValueComparer<T?> where T : class` |
| Configuration classes | `CustomerConfiguration`, `CustomerAccountConfiguration`, `MeteringPointConfiguration`, `BrpConfiguration`, `WalletConfiguration`, `AuditRecordConfiguration`, all `IEntityTypeConfiguration<T>` in `PeakPower.Persistence.Configurations` |
| Migration name | `InitialSchema` |
| Database constraint name | `metering_point_ean_validity_excl` |

### Host and tooling types

| Name | Signature |
| --- | --- |
| `PeakPower.ServiceDefaults.Extensions` | `AddServiceDefaults<TBuilder>`, `ConfigureOpenTelemetry<TBuilder>`, `AddDefaultHealthChecks<TBuilder>` (all `where TBuilder : IHostApplicationBuilder`), `MapDefaultEndpoints(WebApplication app)` |
| `PeakPower.AppHost.WebRootLocator` | `static string Locate(string? environmentValue, string appHostDirectory, Func<string, bool> directoryExists)`, `static string SiblingCheckoutPath(string appHostDirectory)` |
| `PeakPower.AppHost.AppHostOptions` | `const string BackendOnlyFlag = "--backend-only"`, `static bool IsBackendOnly(string[] args)` |
| `PeakPower.AppHost.FrontEndPlan` | `sealed record FrontEndPlan(bool Include, string? WebRoot, string Reason)` with `static FrontEndPlan Decide(string[] args, string? environmentValue, string appHostDirectory, Func<string, bool> directoryExists, Func<string, bool> fileExists)` |
| `PeakPower.Integration.Tests.Database.PostgresFixture` | `IAsyncLifetime` with `string ConnectionString`, `PeakPowerDbContext CreateContext()` — plans 2 and 5 reuse it |
| `PeakPower.Integration.Tests.Database.PostgresCollection` | `const string Name = "postgres"`, `ICollectionFixture<PostgresFixture>` |

### Aspire resource names

`postgres` · `pgadmin` (added by `WithPgAdmin()`) · `peakpower` (the database) · `migrator` ·
`customer-api` · `employee-api` · `customer-portal` · `employee-portal`

### Environment variables

| Name | Meaning |
| --- | --- |
| `PEAKPOWER_WEB_PATH` | Absolute path to the `peakpower-web` checkout. Named in design §11. |
| `PEAKPOWER_PLATFORM_PATH` | Absolute path to the `peakpower-platform` checkout, used by `peakpower-web/dev-up`. **New.** |
| `PEAKPOWER_DEV_UP_DRY_RUN` | `1` makes `dev-up` print the command instead of running it, so the resolution rules are testable. **New.** |
| `PEAKPOWER_DESIGN_TIME_CONNECTION` | Overrides the placeholder connection string `dotnet ef` uses. **New.** |
| `ConnectionStrings__peakpower` | Standard ASP.NET Core configuration key. Aspire sets it through `WithReference(peakpowerDb)`; the migrator's verification script sets it by hand. |
