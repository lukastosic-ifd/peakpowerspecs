# Membership Plan 1 — Tenancy Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change what a tenancy claim *means*. Today `customer_account.customer_id` says which
company an account belongs to, `customer_account.is_admin` says whether it administers that
company, and both facts ride in the access token. After this plan a row in
`customer.customer_membership` is the only answer to both questions, it is proved from the database
on every authenticated request, and the two columns are gone. Migration 15 is written here and
nowhere else, and plans 2, 3 and 4 assume the new meaning.

**Architecture:** Tenancy stays two independent layers and both change. **Layer 1** is the EF Core
global query filter on `CustomerAccount` in `PeakPowerDbContext.OnModelCreating`, which today reads
`account.CustomerId == ctx.CustomerId` and becomes a collection navigation
`account.Memberships.Any(m => m.CustomerId == ctx.CustomerId && m.RemovedAt == null)` — keeping its
`!ctx.IsAuthenticated ||` prefix, without which the back office, the Worker and anonymous onboarding
all collapse to zero rows. **Layer 2** is PostgreSQL row-level security: three policies keyed on the
dropped column are re-pointed, `customer.customer_membership` arrives with `ENABLE ROW LEVEL
SECURITY`, an explicit `REVOKE ALL`, `SELECT/INSERT/UPDATE` and **no `DELETE` grant to either
role**, a `SECURITY DEFINER` admin predicate with a pinned `search_path`, and both policies the
coverage guards demand. The request path gains a second setting, `app.account_id`, and a membership
read that is the proof a claimed tenancy is real; a forged `customer_id` finds no row and 401s. Role
leaves the token entirely, so a demotion bites on the next request rather than at the next
fifteen-minute boundary.

**Tech Stack:** .NET SDK 10.0.400 · `net10.0` · `LangVersion latest` · `Nullable enable` ·
`TreatWarningsAsErrors` · `AnalysisMode Recommended` · EF Core 10.0.11 · Npgsql 10.0.3 ·
`EFCore.NamingConventions` · PostgreSQL 17 · xunit.v3 · Shouldly 4.3.0 (⚠ **never
FluentAssertions** `[DEC-118]`) · NSubstitute · Testcontainers.PostgreSql · Dapper · Verify.XunitV3 ·
Docker (daemon running)

**Spec:** `docs/superpowers/specs/2026-09-10-multi-business-membership-design.md`
**Shared contract:** `docs/superpowers/plans/2026-09-10-membership-shared-contract.md`

---

## Global Constraints

### Repositories

```
platform = /Users/thinhhuynh/PeakPower/peakpower-platform     # every task in this plan
web      = /Users/thinhhuynh/PeakPower/peakpower-web          # NOT touched by this plan
specs    = /Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9
```

Always `git -C <path>` and absolute paths — the shell working directory is not stable between calls
in this environment.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
docker info > /dev/null                                  # the daemon must be running
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln --nologo
dotnet test tests/PeakPower.Domain.Tests --nologo
dotnet test tests/PeakPower.Integration.Tests --nologo
dotnet ef migrations add MultiBusinessMembership \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator \
  --output-dir Migrations --context PeakPowerDbContext
tools/verify-migrator.sh
```

⚠ **rtk truncates and sometimes fabricates shell output.** Redirect to a file and read the file back
before concluding anything. Never conclude from a bare `grep`/`find`/`ls` that scrolled.

⚠ **Verify by mutation.** A green test is not evidence. Break the thing under test on purpose,
predict the exact failure, run it, confirm it failed as predicted, restore, prove the restore with
`git diff`. Report the mutation output. A mutation that breaks the *build* proves nothing about an
assertion — if removing a member orphans a `using`, remove that too.

⚠ **A migration's `Up()` runs once per database.** Every task below that appends SQL to migration 15
must be tested against a **fresh** container. Testcontainers gives each `dotnet test` run its own,
so a plain re-run is enough; a long-lived local database is not. `docker volume rm
peakpower-postgres-data && ./dev-up` if you point anything at one.

⚠ `cp -a` preserves mtimes and leaves MSBuild with stale binaries; use plain `cp` or `touch`.

### Naming — copied verbatim from shared contract §3

| Thing | Name | Why not the obvious name |
| --- | --- | --- |
| The table | `customer.customer_membership` | |
| The role column | `customer_membership.role` | |
| The wire field | **`membershipRole`** | `role` is already **job title** on the account record, and `[F01-R13]` says it is *"descriptive only… never checked"* |
| The preference column | **`last_active_business_id`** | ⚠ **Never `last_customer_id`.** The RLS coverage guards discover tenant columns by the suffix `customer_id` (`right(column_name, 11)`) and CLR properties by `EndsWith("CustomerId")`. A preference column matching that suffix keeps `customer_account` in tenancy discovery keyed on something that is not a tenancy key |
| The soft-delete column | `removed_at` | |
| The admin predicate | `customer.is_admin_of(uuid, uuid)` | |
| Role values | `'admin'`, `'trader'`, `'viewer'` | ⚠ `trader`/`viewer` collide with the **employee** vocabulary `[F13-R12]`. Accepted; any code naming both spells `membershipRole` and `employeeRole` explicitly |

Policy names follow `{schema}_{table}_tenant_isolation` and `{schema}_{table}_back_office`.

### Migration 15 DDL — copied verbatim from shared contract §4, and NORMATIVE

Statement order matters. Nothing in this plan invents a column.

```sql
-- 1. the preference column, BEFORE anything writes to it
ALTER TABLE customer.customer_account ADD COLUMN last_active_business_id uuid NULL
    REFERENCES customer.customer(id);

-- 2. the membership table
CREATE TABLE customer.customer_membership (
    account_id  uuid NOT NULL REFERENCES customer.customer_account(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES customer.customer(id)         ON DELETE RESTRICT,
    role        text NOT NULL CHECK (role IN ('admin', 'trader', 'viewer')),
    created_at  timestamptz NOT NULL,
    removed_at  timestamptz NULL,
    PRIMARY KEY (account_id, customer_id)
);
CREATE INDEX ix_customer_membership_customer_id ON customer.customer_membership (customer_id);

-- 3. grants and RLS — see §5. NO DELETE GRANT, EVER, TO EITHER ROLE.

-- 4. backfill: one membership per existing account
INSERT INTO customer.customer_membership (account_id, customer_id, role, created_at)
SELECT id, customer_id, CASE WHEN is_admin THEN 'admin' ELSE 'trader' END, created_at
FROM customer.customer_account;

-- 5. first-admin repair — see §4.1

-- 6. backfill the preference column
UPDATE customer.customer_account SET last_active_business_id = customer_id;

-- 7. drop the three policies that depend on customer_account.customer_id,
--    create their replacements (§5), add refresh_token.customer_id and its policy pair

-- 8. ONLY NOW drop the columns
ALTER TABLE customer.customer_account DROP COLUMN customer_id;   -- with its index and FK
ALTER TABLE customer.customer_account DROP COLUMN is_admin;
```

⚠ Dropping the column before step 7 errors on dependent objects. `CASCADE` would silently drop all
three policies, leaving `customer_account` with RLS enabled and **no policy** — every authenticated
request then 401s, because the middleware's own account read returns nothing.

⚠ **Step 4's `created_at` and §4.1's `ORDER BY a.created_at` do not exist.** See Deviation D1 below.
This is the one place this plan departs from the contract's literal SQL, and it departs because the
column it names is not in the schema.

### The first-admin repair — shared contract §4.1

```sql
UPDATE customer.customer_membership m SET role = 'admin'
WHERE m.account_id = (
    SELECT a.id FROM customer.customer_account a
    JOIN customer.customer_membership m2 ON m2.account_id = a.id AND m2.customer_id = m.customer_id
    WHERE a.status = 'ACTIVE'
    ORDER BY a.created_at
    LIMIT 1)
AND NOT EXISTS (SELECT 1 FROM customer.customer_membership x
                WHERE x.customer_id = m.customer_id AND x.role = 'admin');
```

Each promotion writes an `audit.audit_record` naming a migration actor. ⚠ `[F13-R41]` forbids a
*"first account of a company is admin"* rule, so this departure is auditable rather than silent.
Companies with **zero** active accounts are listed in the migration output and left alone.

### Grants and policies — copied verbatim from shared contract §5, and NORMATIVE

```sql
ALTER TABLE customer.customer_membership ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer.customer_membership FROM app_customer_role, app_employee_role;
GRANT SELECT, INSERT, UPDATE ON customer.customer_membership TO app_customer_role;
GRANT SELECT, INSERT, UPDATE ON customer.customer_membership TO app_employee_role;

CREATE FUNCTION customer.is_admin_of(account uuid, business uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER STABLE
    SET search_path = customer, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM customer.customer_membership
                   WHERE account_id = account AND customer_id = business
                     AND role = 'admin' AND removed_at IS NULL) $$;
REVOKE EXECUTE ON FUNCTION customer.is_admin_of(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION customer.is_admin_of(uuid, uuid) TO app_customer_role;

CREATE POLICY customer_customer_membership_tenant_isolation ON customer.customer_membership
    FOR ALL TO app_customer_role
    USING      (account_id  = NULLIF(current_setting('app.account_id',  true), '')::uuid
             OR customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
    WITH CHECK (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid
            AND customer.is_admin_of(NULLIF(current_setting('app.account_id', true), '')::uuid,
                                     NULLIF(current_setting('app.customer_id', true), '')::uuid));

CREATE POLICY customer_customer_membership_back_office ON customer.customer_membership
    FOR ALL TO app_employee_role USING (true) WITH CHECK (true);
```

**Three things about this block are load-bearing.**

1. ⚠ **`ENABLE ROW LEVEL SECURITY` and `REVOKE` are the whole protection.** Migration 2's
   `ALTER DEFAULT PRIVILEGES IN SCHEMA customer, metering, wallet, audit GRANT SELECT, INSERT,
   UPDATE, DELETE ON TABLES` (`20260827092246_TenancyRowLevelSecurity.cs:110-112`) fires the instant
   `CREATE TABLE` runs. Without the revoke, every signed-in customer holds full DML on the table
   that is the sole proof of tenancy. This repo already found that trap live on `refresh_token`.
2. ⚠ **No `DELETE` grant, ever.** Postgres evaluates `WITH CHECK` for `INSERT` and for an `UPDATE`'s
   new row and **never for `DELETE`**, which `USING` alone governs — and this `USING` has no admin
   term. Removal is an `UPDATE` setting `removed_at`. Task 7 asserts the **absent privilege**,
   because no policy can guard a `DELETE`.
3. ⚠ **`SET search_path` is not decoration.** A `SECURITY DEFINER` function with a mutable
   `search_path` lets the caller choose which `customer_membership` it means.

### The three replaced policies — shared contract §5.2

| Table | New predicate |
| --- | --- |
| `customer.customer_account` | `EXISTS (SELECT 1 FROM customer.customer_membership m WHERE m.account_id = customer_account.id AND m.customer_id = <app.customer_id> AND m.removed_at IS NULL)` |
| `customer.password_reset_token` | the same `EXISTS`, joined through `customer_account_id` |
| `customer.refresh_token` | ⚠ **NOT the `EXISTS` shape** — it gains its own `customer_id` column and uses the uniform `customer_id = <app.customer_id>` |

⚠ `refresh_token` must key on its own column. Under an `EXISTS`-through-membership policy, plan 4's
removal — which revokes the member's tokens in the same transaction as the removal — would see its
own removal, find no active membership, and **revoke zero rows silently**.

### Column-scoped grants — shared contract §5.3

```sql
REVOKE UPDATE, DELETE ON customer.customer_account FROM app_customer_role;
GRANT  UPDATE (last_active_business_id) ON customer.customer_account TO app_customer_role;
-- refresh_token today holds SELECT + UPDATE (revoked_at) only; rotation needs more:
GRANT  INSERT ON customer.refresh_token TO app_customer_role;
GRANT  UPDATE (used_at, replaced_by_token_id) ON customer.refresh_token TO app_customer_role;
```

⚠ A blanket `REVOKE UPDATE` on `customer_account` is correct against every call site that exists
today and **wrong** against plan 2's `active-business`, which is authenticated and must write the
preference column. Column scoping lets exactly that through while `password_hash` and
`security_stamp` stay unreachable.

### The request path — copied verbatim from shared contract §6, and NORMATIVE

```
1. token verified -> account id claim, customer id claim. NO role claim.
   Both Guid.TryParse'd before they touch a statement.
2. SET LOCAL ROLE app_customer_role
   SELECT set_config('app.account_id',  $1, true)
   SELECT set_config('app.customer_id', $2, true)     -- CLAIMED, not yet proven
3. SELECT role FROM customer.customer_membership
     WHERE account_id  = current_setting('app.account_id')::uuid
       AND customer_id = current_setting('app.customer_id')::uuid
       AND removed_at IS NULL
4. no row -> 401. row -> role onto ICustomerContext.
5. SELECT security_stamp, status FROM customer.customer_account
     WHERE id = current_setting('app.account_id')::uuid
```

- ⚠ **`set_config`, never `SET LOCAL <name> = <value>`.** House rule, stated in the existing code:
  *"`SET` does not accept a parameter, and concatenating a value into a tenancy control is how
  injection gets in."* The statement text is pinned by a test; the new `app.account_id` line joins
  that pinning.
- ⚠ **Setting `app.customer_id` before the proof keeps one batch and stays fail-closed.** The real
  middleware issues its statements as a single `NpgsqlBatch`; a conditional statement could not be
  batched. A forged claim has no membership row, so step 4 refuses, and meanwhile every policy keyed
  on that value shows the forged tenant nothing.
- ⚠ **Step 5 must run after step 4's setting**, or the new `EXISTS` policy hides the account row and
  every authenticated request 401s. It is a second read on a second table.

### Types that cross plan boundaries — copied verbatim from shared contract §7

```csharp
// PeakPower.Domain/Customers/MembershipRole.cs
public enum MembershipRole { Admin, Trader, Viewer }   // db spelling: 'admin' | 'trader' | 'viewer'

// PeakPower.Domain/Customers/MembershipRoleWire.cs — contract §13.2.1 pins this shape exactly:
// plan 1 owns it, ONE definition, seven members, and plans 2 and 4 consume every one of them.
public static class MembershipRoleWire
{
    public const string Admin  = "admin";
    public const string Trader = "trader";
    public const string Viewer = "viewer";

    public static IReadOnlyList<string> Values { get; }  // ["admin", "trader", "viewer"]

    public static string Of(MembershipRole role);        // MembershipRole.Admin -> "admin", never throws
    public static MembershipRole Parse(string value);    // "admin" -> MembershipRole.Admin, else throws
    public static bool TryParse(string? value, out MembershipRole role);  // for untrusted wire input
}

// PeakPower.Domain/Customers/CustomerMembership.cs — its own aggregate relationship
public sealed class CustomerMembership
{
    public Guid AccountId { get; private set; }
    public Guid CustomerId { get; private set; }
    public MembershipRole Role { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset? RemovedAt { get; private set; }

    public bool IsActive => RemovedAt is null;
    // ⚠ Result<T>, not the bare type — the house pattern for a factory that can refuse (contract §7).
    public static Result<CustomerMembership> Create(Guid accountId, Guid customerId, MembershipRole role, DateTimeOffset at);
    public void ChangeRole(MembershipRole role);
    public void Remove(DateTimeOffset at);
    public void Restore(DateTimeOffset at);
}

// PeakPower.Application/Abstractions/ICustomerContext.cs — MODIFIED
public interface ICustomerContext
{
    Guid CustomerId { get; }
    Guid AccountId { get; }               // already present today
    MembershipRole Role { get; }          // REPLACES bool IsAdmin
    bool IsAuthenticated { get; }
}
```

⚠ `IsAdmin` is **removed** from `ICustomerContext`, not kept alongside `Role`. Two sources of truth
for the same fact is how a demoted admin keeps admin rights for fifteen minutes.

⚠ `ITokenIssuer.IssueAccessToken` becomes `IssueAccessToken(CustomerAccount account, Guid customerId)`
— **no role argument**, because the role is not in the token. Every call site changes: sign-in,
refresh, and plan 2's switch.

### The five symbols plan 1 owns for plans 2 and 4 — shared contract §13.2

Contract §13.2 rules that **one definition** of each of these exists and it is plan 1's. Every one is
a named `Produces` on the task that ships it, so plans 2 and 4 consume rather than redefine — three of
them were previously defined twice, which is `CS0111`, `TS2300` and a silent behaviour fork.

| Symbol | Task | Where it lives |
| --- | --- | --- |
| `MembershipRoleWire` — `Admin` / `Trader` / `Viewer` / `.Values` / `.Of` / `.Parse` / `.TryParse` | 1 | `src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs` |
| `CustomerMembership.Create` → `Result<CustomerMembership>` | 1 | `src/Core/PeakPower.Domain/Customers/CustomerMembership.cs` |
| `CustomerAccount.RecordActiveBusiness(Guid)` | 2 | `src/Core/PeakPower.Domain/Customers/CustomerAccount.cs` |
| `AuthEndpoints.SelectBusinessAsync` + `NotAMemberOfAnyBusiness()` | 15 | `src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs` |
| `MembershipRoleValue` (web) | — | **plan 3's**, not this plan's |

⚠ **`MembershipRoleWire` is the only role-spelling helper this plan ships.** An earlier revision had
three in parallel — a `RoleToDatabase`/`RoleFromDatabase` pair on `CustomerMembershipConfiguration`,
an inline conversion in `PortalMappings`, and a private `ParseMembershipRole` in the employee
`AccountEndpoints`. They are collapsed onto this one. It lives in `PeakPower.Domain` and not beside
`EnumWireFormat` in `PeakPower.Infrastructure.Web` because `PeakPower.Persistence`'s
`CustomerMembershipConfiguration` needs it for its value converter and Persistence references
Application → Domain only; a helper in `Infrastructure.Web` would be unreachable from the converter
and the second definition would grow back there. Domain referencing nothing (architecture fact 1) is
preserved: it is three `const string`s and three static members over `string` and `MembershipRole`.

⚠ **`MembershipRoleWire`, not `EnumWireFormat.ToWire`.** `EnumWireFormat`
(`src/Infrastructure/PeakPower.Infrastructure.Web/Http/EnumWireFormat.cs`) is
`JsonNamingPolicy.SnakeCaseUpper` and would spell `ADMIN`. `MembershipRole` is the one enum in this
codebase whose wire spelling and column spelling are both **lower case** (contract §3, §8), and
`MembershipRoleWire` exists so that one fact has one home. Its shape deliberately mirrors
`EnumWireFormat`'s (`ToWire`/`Parse`/`TryParse`/`Names`) so the house pattern is recognisable —
including `Parse` delegating to `TryParse` and throwing only when it returns `false`.

⚠ **Contract §13.2.1 pins seven members, and all seven ship in Task 1.** Beside `Of`, `Parse` and
`Values` there are `const string Admin` / `Trader` / `Viewer` — plan 4's constants, folded in here so
they are not declared a second time — and `TryParse(string?, out MembershipRole)`. `TryParse` exists
because plan 4 wanted `Parse(string?) -> MembershipRole?` beside plan 1's
`Parse(string) -> MembershipRole`, and reference nullability does not differentiate an overload, so
that pair is `CS0111`. Anything parsing untrusted wire input calls `TryParse`; `Parse` stays for call
sites a validator has already checked, and it still throws.

### Guards that will fail, and how each must be answered — shared contract §9

1. **`policyCount == 2`** per tenant table. `customer_membership` ships both.
2. **Discovery by `customer_id` suffix**, model-side and catalogue-side. A test must additionally
   assert `customer_account` is still policied **by name**, because the pinned totals can stay
   arithmetically right while a table silently loses its policy. (They do: Task 17 shows the
   arithmetic.)
3. **Every customer-owned entity needs a global query filter or an argued exemption.**
   `CustomerMembership` cannot carry the standard filter — the switcher must read across businesses
   — so it takes a **`QueryFilterModelTests.ExemptEntityTypes`** entry naming that reason.
   ⚠ **Not `RowLevelSecurityTests.ExemptTables`** — that is the policy-coverage set, a different
   list, and `customer_membership` is not exempt from *that* one: it ships both policies (§5).

### Testing

| Layer | Tooling |
| --- | --- |
| Domain unit | xUnit v3 + **Shouldly** — never FluentAssertions `[DEC-118]` |
| Model shape (no database) | `PeakPower.Integration.Tests`, a `DbContextOptionsBuilder` with a design-time connection string; building a model opens no connection |
| Persistence, grants & RLS behaviour | Testcontainers, real PostgreSQL 17, through `TenancyFixture`'s non-owner login roles |
| Request path end to end | `CustomerApiFactory` (a real `WebApplicationFactory` over a real container) |
| The migrator process | `tools/verify-migrator.sh`, twice, against a throwaway `postgres:17` |

⚠ **Shouldly's `ShouldContain` is case-insensitive by default** and has silently broken three tests
in this repository; compare with `StringComparison.Ordinal` and assert on structured fields.

⚠ **Pin counted invariants to a computed expectation, not a floor.** `assert count > 0` passes when
a discovery query silently returns the wrong set.

⚠ Integration tests use Testcontainers. Running several suites in parallel across worktrees can
exhaust connections and produce mass Postgres timeouts — retry before reporting a regression.

### The fourteen migrations that precede this one

`InitialSchema`, `TenancyRowLevelSecurity`, `AuthAndOnboarding`, `AccountTokenForeignKeys`,
`EanPool`, `OnboardingTradeName`, `EmployeeIdentity`, `EmployeeSessions`, `IngestionAndIntervalData`,
`EmployeePasswordReset`, `CustomerEntitlements`, `DayAheadPrices`, `EanPoolReleaseGrant`,
`DayAheadPriceSource`. Migration 15 is `<timestamp>_MultiBusinessMembership`. **Three places pin that
ordered list and all three grow by one entry in Task 3:**

- `tools/verify-migrator.sh:51` (the `case` pattern) and `:52-59` (the failure message)
- `tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs:32` (the method name),
  `:39` (`migrationIds.Length.ShouldBe(14)`) and `:40-53`
- `tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs:32`
  (`applied.Length.ShouldBe(14)`) and `:33-46`

---
## Deviations from the shared contract, and open items

The contract is normative and this plan follows it. Six places needed a decision it does not make or
could not be followed literally. All are here so a reviewer finds them in one place rather than
scattered through seventeen tasks.

### D1 — ⚠ `customer.customer_account` has no `created_at` column, and the contract's backfill reads one

Verified against `20260827051436_InitialSchema.cs:95-124` and against
`PeakPowerDbContextModelSnapshot.cs:152-228`: the table's columns are `id`, `customer_id`,
`username`, `first_name`, `last_name`, `job_title`, `email`, `phone`, `status`, `is_admin`,
`password_hash`, `security_stamp`, `last_login_at`. There is **no `created_at`**
(`external_subject_id` existed and was dropped by migration 9).

Contract §4 step 4 selects `created_at` from that table, and §4.1 orders by `a.created_at`. Both are
`42703 column "created_at" does not exist` as written.

**Resolution, and it is two different substitutions because the two uses want different things:**

- The membership row's own `created_at` is `now()`. It is a real fact — this membership was created
  by the migration, at migration time — and the alternative (inventing a per-account timestamp) is
  worse than honest.
- "the **oldest** active account" orders by `a.id`. `CustomerAccount.Create` sets
  `Id = Guid.CreateVersion7()` (`CustomerAccount.cs:83`), and a UUIDv7's leading 48 bits are a
  millisecond timestamp in RFC 9562 byte order, which is exactly the order PostgreSQL's `uuid`
  comparison uses. So `ORDER BY a.id` **is** creation order for every account the application has
  ever created. It is a proxy, it is named as one in the migration's own comment, and Task 4 proves
  it selects the oldest of three seeded accounts.

Flagged for the contract owner: §4 step 4 and §4.1 should read `now()` and `ORDER BY a.id`.

### D2 — ⚠ the role values are lower-case, and every other enum in this schema is SCREAMING_SNAKE

`EnumToTextConvention` (`src/Infrastructure/PeakPower.Persistence/Conversions/EnumToTextConvention.cs:13-34`)
is an `IModelFinalizingConvention` that walks **every** enum property in the model and applies
`EnumToScreamingSnakeConverter<T>`. Left alone, `CustomerMembership.Role` would store `ADMIN` and
violate the contract's `CHECK (role IN ('admin','trader','viewer'))` on the first insert — and the
`is_admin_of` function and the `WITH CHECK` arm both compare against `'admin'`.

**Resolution:** `CustomerMembershipConfiguration` declares its own `HasConversion` mapping
`MembershipRole.Admin` to `"admin"`. An explicit configuration is `ConfigurationSource.Explicit` and
a convention's `IConventionPropertyBuilder.HasConversion` is `ConfigurationSource.Convention`, which
cannot override it — so the explicit one wins, and Task 2 proves that by reading the built model's
converter rather than by assuming it. The contract's SQL is followed exactly; the C# bends.

### D3 — `CurrentAccountResponse` is split across two plans

Contract §8 gives the end state: `isAdmin` out, `membershipRole` in, `memberships[]` in. The
`memberships[]` half needs `/auth/me` to read across businesses, which contract §8's own route table
assigns to **plan 2**. Plan 1 therefore lands only the non-additive half — `bool IsAdmin` becomes
`string MembershipRole` — and plan 2 adds `memberships[]` additively on top. The type ends up exactly
as §8 spells it; it gets there in two commits, not one.

### D4 — `refresh_token` and `password_reset_token` keep their existing, unprefixed policy names

Their policies are named `refresh_token_tenant_isolation` / `refresh_token_back_office` and
`password_reset_token_tenant_isolation` / `password_reset_token_back_office`
(`20260828100211_AuthAndOnboarding.cs:205`, `:216`, `:241`, `:252`) — no `customer_` prefix, unlike
migration 2's five. Contract §3's `{schema}_{table}_…` convention is applied to the **new** table
only. Re-pointing an existing policy under its existing name is a `DROP POLICY` + `CREATE POLICY`
pair; renaming it as well would additionally break
`AuthSchemaTests.The_tenant_role_can_reach_its_own_refresh_tokens_and_nothing_else:88`, which pins
the old name, and buys nothing.

### D5 — `CustomerMembership` uses `AccountId`, not `CustomerAccountId`, and that changes which guard sees it

Contract §7 spells the property `AccountId`. `AutomaticPolicyCoverageTests.AccountIdOwned`
(`RowLevelSecurityTests.cs:732-733`) discovers by `FindProperty("CustomerAccountId")`, so it will
**not** see the membership table — deliberately. `CustomerIdOwned` does see it, via the `CustomerId`
property, and holds it to the same two-policy bar. Named here so nobody "fixes" the property name
into the account-scoped guard and then wonders why the counts moved twice.

### D6 — this plan changes four employee-and-portal wire contracts; plan 3 owns the web fallout

`AccountDto`, `CreateAccountRequest`, `UpdateAccountRequest` (`PeakPower.Contracts/Employee/AccountDtos.cs`)
and `CompanyAccountDto` (`PeakPower.Contracts/Customer/Portal/PortalContracts.cs:35-45`) all lose
`isAdmin` and gain `membershipRole`. Both OpenAPI snapshots move
(`CustomerOpenApiSnapshotTests…verified.json` lines 1605, 1644, 2456, 2477 and
`EmployeeOpenApiSnapshotTests…verified.json` lines 1158, 1204, 1391, 1419, 2601, 2626) and are
re-approved in this plan.

⚠ **The web repo reads `isAdmin` in fourteen places** — `apps/employee-portal/.../account-form-page.ts`
(a checkbox bound to `isAdmin`), `apps/employee-portal/.../customer-detail-page.ts`,
`apps/customer-portal/.../company-page.ts`, `e2e/fixtures/api.ts` and their specs. ⚠ **Contract
§13.3 gives every one of those to plan 3** — Task 2 for the customer portal, Task 3 for the
employee portal, including turning that checkbox into a three-value select. Recorded, and owned: `npm run generate:clients` in the web repo will start
failing to compile the moment this plan's OpenAPI lands, and that is the intended, loud signal
rather than a silent runtime `undefined`.

### D7 — the migration is one file built up across five tasks

Contract §4 is one migration with eight numbered steps, and §0 forbids plans 2–4 adding to it. This
plan writes it in five sittings — Task 3 (steps 1–3), Task 4 (steps 4–6), Task 8 (step 7, the
account and reset-token policies), Task 9 (step 7, `refresh_token`) and Task 17 (step 8) — because
the design's own sequencing (§9) makes steps 1–3 additive and reversible and the column drop last.
Each task appends to `Up()` and **prepends** to `Down()`. The file is one migration and one commit
per task; what is reversible is the *landing order of the code*, which is what §9 is about.

### D8 — ⚠ the contract's `refresh_token` grant re-opens a hole migration 3 closed, and this plan adds a trigger

Shared contract §5.3 adds `GRANT UPDATE (used_at, replaced_by_token_id) ON customer.refresh_token`.
That table already holds `UPDATE (revoked_at)`. With all three granted, the exact statement migration
3 narrowed this table for —

```sql
UPDATE customer.refresh_token SET used_at = NULL, revoked_at = NULL, replaced_by_token_id = NULL
```

— names only granted columns, and the `FOR ALL` policy's `USING` arm passes for the caller's own
rows, so nothing refuses it. It unmarks a used, revoked, replaced token and hands it back as a live
credential. Migration 3's own comment (`20260828100211_AuthAndOnboarding.cs:165-170`) is explicit:
*"nulling `revoked_at` is worse than deleting: it resurrects a token password-reset completion had
just killed."* The existing test
`AuthSchemaTests.The_tenant_role_cannot_rewrite_the_rotation_chain_of_its_own_refresh_token:290-312`
is what would have gone red.

The grant is still needed — plan 2's switch rotates a token and cannot do that without it — and a
`GRANT` structurally cannot express *"you may set this column, not clear it"*. **A trigger can, and
this repository already uses exactly that mechanism for exactly this class of problem**: migration
10 keeps `customer_entitlement` append-only with `trg_customer_entitlement_append_only`
(`20260908080123_CustomerEntitlements.cs:138-169`), whose own comment makes the argument that a
trigger is the only thing that can say it and that binding the owner as well is the point.

Task 9 therefore adds `trg_refresh_token_evidence_monotonic`, forbidding any non-null-to-null
transition on `used_at`, `revoked_at` or `replaced_by_token_id`. Migration 3's test moves from
`42501` to `23001` and becomes **stronger**: a privilege leaves the owner free and a trigger does
not, so the Worker, the seeders and every fixture are covered too.

Flagged for the contract owner: §5.3's grant needs the trigger beside it, or it is a regression.

### D9 — dropping `customer_id` forces plan 1 to implement sign-in's business selection

The contract's plan table gives *"sign-in fallback"* to plan 2. It cannot wait: the moment
`customer_account.customer_id` is gone, sign-in has nothing to name in the token it mints, and
`AuthEndpoints` does not compile. So Task 15 ships the minimum design §5 specifies —
`last_active_business_id` if it is still an **active** membership, otherwise the **oldest**
membership by `created_at`, otherwise a named refusal — and plan 2 refines it.

⚠ **"Otherwise the oldest", never "otherwise any".** An arbitrary pick lands somebody in an
arbitrary business to take audited actions in, and design §5 says so in terms. The
`ORDER BY created_at` is what makes it deterministic, and every membership has one because Task 4's
backfill wrote `now()` for all of them.

What plan 1 does **not** do, and plan 2 still owns: `memberships[]` on `CurrentAccountResponse`, the
`active-business` endpoint, refresh's re-proof, and the final wording and probe for the
zero-membership answer (contract §11 assigns that probe to plan 2). Plan 1 makes zero memberships a
named 401 rather than a crash, which is the floor, not the finished answer.

### Open items this plan records rather than closes

1. **`[OQ-105]`** — the back office has no membership screen at all. Support cannot answer *"which
   businesses is this person in?"* without SQL. Contract §12 records it; nothing here closes it.
2. **`[OQ-102]`** — the RLS login-role passwords are literals inside migration 2. This migration adds
   one more table under those roles. It blocks nothing here and is not fixed here.
3. **`CustomerAccount.Deactivate()` still revokes no refresh token.** Documented in the platform
   `CLAUDE.md` as an open gap; membership does not change it, and plan 2's refresh re-proof is what
   will finally close the equivalent hole for removal.

---

## Domain terms used in this plan

- **Membership** — one row of `customer.customer_membership`: this account, in this business, with
  this role, from this moment, until `removed_at` if ever. The composite primary key
  `(account_id, customer_id)` means a person is in a business at most once.
- **Active membership** — `removed_at IS NULL`. Every predicate in the design carries it.
- **Business** — a `customer.customer` row seen from the membership side. The design uses "business"
  where the schema says "customer" precisely because one person now has several.
- **The active business** — the one the current access token names in its `customer_id` claim, and
  the one `app.customer_id` is set to for the request.
- **`app.account_id` / `app.customer_id`** — PostgreSQL run-time configuration settings, set
  transaction-locally with `set_config(name, value, true)`, that every row-level-security policy
  reads through `current_setting(name, true)`.
- **Owner connection** — a connection as the table-owning superuser role, which row-level security
  does not apply to. Anonymous auth flows and migrations run on it; nothing authenticated does.
- **`app_customer_role` / `app_employee_role`** — NOLOGIN group roles holding every grant and policy.
  `peakpower_app` and `peakpower_employee` are the LOGIN roles that inherit them, and both are
  deliberately non-owners.
- **RLS** — PostgreSQL row-level security: per-row `USING` (which rows a command may see) and
  `WITH CHECK` (which rows it may write) predicates attached to a table and a role.
- **`42501`** — PostgreSQL `insufficient_privilege`. A refused *command*, as opposed to a policy
  filtering a command down to zero rows. The two look identical from the application and are not the
  same guarantee.

---

## File Structure

### `/Users/thinhhuynh/PeakPower/peakpower-platform`

| File | Responsibility |
| --- | --- |
| `src/Core/PeakPower.Domain/Customers/MembershipRole.cs` | Create: the three-value enum, database spelling normative |
| `src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs` | Create: `Admin` / `Trader` / `Viewer` / `Values` / `Of` / `Parse` / `TryParse` — the ONE role-spelling helper, the seven members contract §13.2.1 pins, consumed by the EF converter, both hosts and plans 2 and 4 |
| `src/Core/PeakPower.Domain/Customers/CustomerMembership.cs` | Create: the membership aggregate, contract §7 verbatim, `Create` returning `Result<CustomerMembership>` |
| `src/Core/PeakPower.Domain/Customers/CustomerAccount.cs` | Modify: gain `LastActiveBusinessId` and the `Memberships` navigation (Task 2); lose `IsAdmin` (Task 15); lose `CustomerId` (Task 17) |
| `src/Core/PeakPower.Domain/Customers/RefreshToken.cs` | Modify: gain `CustomerId`, widened `Issue` (Task 9) |
| `src/Core/PeakPower.Application/Abstractions/ICustomerContext.cs` | Modify: `MembershipRole Role` replaces `bool IsAdmin` |
| `src/Core/PeakPower.Application/Abstractions/ITokenIssuer.cs` | Modify: `IssueAccessToken(CustomerAccount, Guid customerId)` |
| `src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs` | Modify `:7-13`: `CurrentAccountResponse` loses `IsAdmin`, gains `MembershipRole` |
| `src/Core/PeakPower.Contracts/Customer/Portal/PortalContracts.cs` | Modify `:35-45`: `CompanyAccountDto` loses `IsAdmin`, gains `MembershipRole` |
| `src/Core/PeakPower.Contracts/Employee/AccountDtos.cs` | Modify: all three records lose `IsAdmin`, gain `MembershipRole` |
| `src/Infrastructure/PeakPower.Persistence/Configurations/CustomerMembershipConfiguration.cs` | Create: composite key, the `HasConversion` over `MembershipRoleWire`, the two indexes |
| `src/Infrastructure/PeakPower.Persistence/Configurations/CustomerAccountConfiguration.cs` | Modify `:37`, `:18-22`, `:42`: `is_admin` and `customer_id` mappings leave; `last_active_business_id` and the `Memberships` navigation arrive |
| `src/Infrastructure/PeakPower.Persistence/Configurations/RefreshTokenConfiguration.cs` | Modify: the `CustomerId` mapping and its index |
| `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs` | Modify `:25`, `:169-171`: the `CustomerMemberships` set and the re-pointed `CustomerAccount` filter |
| `src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_MultiBusinessMembership.cs` | Create: migration 15, hand-written raw SQL, built up over Tasks 3, 4, 8, 9 and 17 |
| `src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_MultiBusinessMembership.Designer.cs` | Create (generated) |
| `src/Infrastructure/PeakPower.Persistence/Migrations/PeakPowerDbContextModelSnapshot.cs` | Modify (regenerated) |
| `src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs` | Modify `:61`, `:155-166`: a membership per seeded person, `MembershipRole` on `Person` |
| `src/Infrastructure/PeakPower.Persistence/NullCustomerContext.cs` | Modify `:34`, `:70`: `Role` replaces `IsAdmin` on both stubs |
| `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/JwtCustomerContext.cs` | Modify `:25-26`: `Role` reads the proven role the session middleware wrote |
| `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/UnscopedCustomerContext.cs` | Modify `:22` |
| `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/DevelopmentCustomerContext.cs` | Modify `:15`, `:25-27`: the admin header goes, the proven role arrives |
| `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerSessionMiddleware.cs` | Modify `:37-40`, `:68-103`: five statements, the membership proof, the role hand-off |
| `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/TenantScopeMiddleware.cs` | Modify `:29-41`, `:47-75`: the same proof for the tenancy probe app |
| `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerAuthorizationPolicies.cs` | Modify: an authorization requirement over `ICustomerContext` replaces the claim check |
| `src/Infrastructure/PeakPower.Infrastructure.Identity/JwtTokenIssuer.cs` | Modify `:24-51`: the `is_admin` claim leaves, `customerId` becomes a parameter |
| `src/Hosts/PeakPower.Api.Customer/Program.cs` | Modify `:355`: register the `CompanyAdmin` handler |
| `src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs` | Modify `:173`, `:185-187`, `:216-218`, `:322`, `:356`, `:367-369`: the widened issuer and the new response field |
| `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs` | Modify `:147-156`: `ToAccountDto` takes the role |
| `src/Hosts/PeakPower.Api.Customer/Portal/CompanyEndpoints.cs` | Modify `:70-90`: the colleague list joins membership |
| `src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingService.cs` | Modify `:420-435`: the first account gets an admin membership |
| `src/Hosts/PeakPower.Api.Employee/Mapping/EmployeeMappings.cs` | Modify `:42-46`: `ToDto` takes the business and the role |
| `src/Hosts/PeakPower.Api.Employee/Endpoints/AccountEndpoints.cs` | Modify `:85-94`, `:154-160`: create writes a membership, update changes its role |
| `src/Hosts/PeakPower.Api.Employee/Endpoints/CustomerEndpoints.cs` | Modify `:130-135`, `:289-294`: count and list by membership |
| `tools/verify-migrator.sh` | Modify `:51`, `:52-59`; append the migration-15 privilege assertions |
| `tests/PeakPower.Domain.Tests/Customers/CustomerMembershipTests.cs` | Create |
| `tests/PeakPower.Domain.Tests/Customers/CustomerAccountTests.cs` | Modify `:12-19`, `:22-32`, `:74-82`, `:132-147`, `:150-156` |
| `tests/PeakPower.Integration.Tests/Model/MembershipModelShapeTests.cs` | Create: table, key, index, the lower-case converter |
| `tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs` | Modify `:102-107`, `:117-122`, `:135-160`, `:233-258`, `:591-600` |
| `tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs` | Modify `:28-40`, `:47-54`, `:102-110`, `:219-236`, `:707-708`, `:768-769`, `:789`, `:894-895`, `:1050-1051`, `:1070`, `:465-486`; append `CustomerMembershipPolicyTests`, `MembershipRemovalPrivilegeTests` and `CrossTenantAccountReachTests` |
| `tests/PeakPower.Integration.Tests/Tenancy/TestMemberships.cs` | Create (Task 5): `TestMemberships.Active(accountId, customerId, role)` — the one seam every fixture in this assembly seeds a membership through, so Task 17 changes one file rather than nine |
| `tests/PeakPower.Integration.Tests/Tenancy/TenancyFixture.cs` | Modify `:47-78`, `:183-227`: memberships for both companies, a shared member, and the ids the probes need |
| `tests/PeakPower.Integration.Tests/Tenancy/AppRoleConnectionStringTests.cs` | Modify: pin the two new statement literals |
| `tests/PeakPower.Integration.Tests/Migrations/MembershipSchemaTests.cs` | Create: what migration 15 did to a database |
| `tests/PeakPower.Integration.Tests/Migrations/MembershipBackfillTests.cs` | Create: the backfill and the first-admin repair |
| `tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs` | Modify `:32`, `:39`, `:40-53` |
| `tests/PeakPower.Integration.Tests/Migrations/AuthSchemaTests.cs` | Modify `:142-147`, `:429-434`: the widened factory, plus memberships |
| `tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs` | Modify `:32`, `:33-46` |
| `tests/PeakPower.Integration.Tests/Contract/EnumWireAlgorithmDivergenceTests.cs` | Modify `:78-118`, `:172`, `:183` |
| `tests/PeakPower.Integration.Tests/Contract/*OpenApiSnapshotTests*.verified.json` | Modify (re-approved) |
| `tests/PeakPower.Integration.Tests/Auth/SecurityStampTests.cs` | Modify `:32`, `:165-179`; append the cross-tenant and no-membership probes |
| `tests/PeakPower.Integration.Tests/Auth/MembershipRequestPathTests.cs` | Create: the cross-tenant probe and the no-membership probe |
| `tests/PeakPower.Integration.Tests/CustomerApiFactory.cs` | Modify `:152-197`: seed a membership beside the account |
| `tests/PeakPower.Integration.Tests/Employee/EmployeeMappingsTests.cs` | Modify `:44-72` |
| `tests/PeakPower.Integration.Tests/Employee/AccountEndpointTests.cs` | Modify `:72`, `:157` |
| `tests/PeakPower.Integration.Tests/Portal/CompanyEndpointTests.cs` | Modify `:56`, `:184` |
| `tests/PeakPower.Integration.Tests/Portal/EntitlementEndpointTests.cs` | Modify (Task 12) `:330-345`: `A_non_admin_cannot_change_an_entitlement` — the 403 now comes from the proven role rather than the `is_admin` claim, so `SignedInAsync(isAdmin: …)` seeds a membership role |
| `tests/PeakPower.Integration.Tests/Tenancy/CompanyAdminPolicyTests.cs` | Create (Task 12) |
| `tests/PeakPower.Integration.Tests/Onboarding/OnboardingMaterialisationTests.cs` | Modify `:127`, `:265` |
| `tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs` | Modify `:84`, `:236` |
| `tests/PeakPower.Integration.Tests/Auth/SignOutTests.cs` | Modify `:155` |
| `tests/PeakPower.Integration.Tests/Tenancy/DevelopmentCustomerContextTests.cs` | Modify `:29`, `:45-98` |
| `tests/PeakPower.Application.Tests/Auth/JwtCustomerContextTests.cs` | Modify `:25-58` |
| `tests/PeakPower.Application.Tests/Security/JwtTokenIssuerTests.cs` | Modify `:27-31`, `:53`, `:83` |
| `tests/PeakPower.Application.Tests/Security/CustomerTokenValidationTests.cs` | Modify `:39` |
| `tests/PeakPower.Application.Tests/Abstractions/PortShapeTests.cs` | Modify `:43` |

---

## Prerequisites — do this before Task 1

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet --version            # must print 10.0.400
docker info > /dev/null     # must exit 0 — the daemon must be running
dotnet tool install -g dotnet-ef --version 10.0.11    # or: dotnet tool update -g dotnet-ef
dotnet build PeakPower.sln --nologo -warnaserror      # must be green before anything below
dotnet test PeakPower.sln --nologo                    # must be green before anything below
```

`dotnet-ef` installs into `~/.dotnet/tools`. If `dotnet ef` is not found afterwards, add that
directory to `PATH`.

Confirm the starting numbers this plan moves, and read them from a file rather than from a terminal
that may have scrolled:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
{
  grep -n 'migrationIds.Length.ShouldBe' tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs
  grep -n 'applied.Length.ShouldBe'      tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs
  grep -n 'customerIdOwned.Length.ShouldBe\|accountIdOwned.Length.ShouldBe\|customerOwned.Length.ShouldBe' \
      tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs
  grep -n 'customerIdTables.Count.ShouldBe\|accountIdTables.Count.ShouldBe\|tables.Count.ShouldBe' \
      tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs
  grep -n 'filtered.Length.ShouldBe' tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs
} > /tmp/membership-baseline.txt
cat /tmp/membership-baseline.txt
```

Expected: `14`, `14`, `12`/`2`/`12`, `12`/`2`/`12`, `10`. If any differs, someone has landed work
this plan does not know about — stop and re-read those files before continuing.

---
### Task 1: `MembershipRole` and `CustomerMembership` — the two types every later task consumes

Shared contract §7 fixes both, member for member and signature for signature. Nothing here invents a
member.

Two things about the enum are worth reading before writing it. First, `trader` and `viewer` collide
with the **employee** vocabulary `[F13-R12]`; the collision is accepted and the resolution is
naming discipline, so the wire field is `membershipRole` and never `role`. Second, its database
spelling is **lower case** — `'admin'`, not `'ADMIN'` — which is the opposite of every other enum in
this schema and is the subject of Deviation D2. Nothing in *this* task feels that: the enum is a
plain CLR enum, and the storage spelling is Task 2's configuration problem. It is mentioned here so
that whoever reads `MembershipRole` next does not "correct" the doc comment.

`Restore` exists on the contract's list and is unreachable from anything plan 1 ships — plan 4's
re-invitation is its first caller. It is declared here anyway, because the contract puts it on the
type and because "re-inviting a removed person clears the column rather than inserting a duplicate,
which the composite key would refuse anyway" (design §3.1) is the reason the column exists at all.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/MembershipRole.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/CustomerMembership.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Customers/CustomerMembershipTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Domain.Common.Result<T>` (`src/Core/PeakPower.Domain/Common/Result.cs`) —
  `Result<T>.Success(T)`, `Result<T>.Failure(string)`, `.IsSuccess`, `.Value`, `.Error`.
- Produces: `PeakPower.Domain.Customers.MembershipRole` (`Admin`, `Trader`, `Viewer`).
- Produces: **`PeakPower.Domain.Customers.MembershipRoleWire`** — shared contract §13.2.1 names plan 1
  its owner, pins this file and this namespace, and pins the shape. Static, **seven** members, all of
  them shipped by this task so plans 2 and 4 can consume every one:
  `const string Admin = "admin"`, `const string Trader = "trader"`, `const string Viewer = "viewer"`
  (plan 4's constants, folded in here rather than declared a second time),
  `static IReadOnlyList<string> Values { get; }` (`["admin", "trader", "viewer"]`, declaration
  order),
  `static string Of(MembershipRole role)` (`MembershipRole.Admin` → `"admin"`; never throws),
  `static MembershipRole Parse(string value)` (`"admin"` → `MembershipRole.Admin`; throws
  `ArgumentOutOfRangeException` on anything else), and
  `static bool TryParse(string? value, out MembershipRole role)` — the member for untrusted wire
  input, `false` and `default` on `null` or an unknown spelling.
  ⚠ **`TryParse`, not a nullable-returning `Parse` overload** (§13.2.1): reference nullability does
  not differentiate an overload, so `Parse(string?)` beside `Parse(string)` is `CS0111`. Plans 2 and
  4 consume all seven; **plan 4 does not add constants, a `Parse` or a nullable parse of its own**,
  because every one of them ships here. Task 2's value converter, Task 15's four endpoints and
  Task 16's mapping call these rather than defining a second pair.
- Produces: `PeakPower.Domain.Customers.CustomerMembership` with
  `Guid AccountId`, `Guid CustomerId`, `MembershipRole Role`, `DateTimeOffset CreatedAt`,
  `DateTimeOffset? RemovedAt`, `bool IsActive`,
  **`static Result<CustomerMembership> Create(Guid accountId, Guid customerId, MembershipRole role, DateTimeOffset at)`**
  — contract §7 and §13.2 fix the `Result<T>` return; every caller in plans 1, 2 and 4 writes
  `.Value` —
  `void ChangeRole(MembershipRole role)`, `void Remove(DateTimeOffset at)`,
  `void Restore(DateTimeOffset at)`.

⚠ The contract writes `Create` as returning `CustomerMembership`. It returns `Result<CustomerMembership>`
here for the same reason every other factory in `PeakPower.Domain.Customers` does — an empty
`accountId` is an expected wrong answer, not an exceptional condition — and because
`CustomerAccount.Create` and `MeteringPoint.Attach`, the two factories every caller in this plan
already sits beside, both do. Callers write `.Value` exactly as they already do for those.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Customers/CustomerMembershipTests.cs`:

```csharp
using PeakPower.Domain.Customers;
using Shouldly;
using Xunit;

namespace PeakPower.Domain.Tests.Customers;

/// <summary>
/// The membership aggregate, shared contract section 7. One person, one business, one role, and a
/// removal that is a timestamp rather than a DELETE.
/// <para>
/// ⚠ The soft delete is not bookkeeping. Postgres evaluates a policy's WITH CHECK for INSERT and
/// for an UPDATE's new row and NEVER for DELETE, which USING alone governs - so a membership that
/// could be DELETEd could be deleted by anyone the USING arm lets see it, admins included. The
/// migration grants no DELETE at all and removal is an UPDATE of <see cref="CustomerMembership.RemovedAt"/>.
/// These tests pin the domain half of that; MembershipRemovalPrivilegeTests pins the database half.
/// </para>
/// </summary>
public sealed class CustomerMembershipTests
{
    private static readonly Guid AccountId = Guid.Parse("0199a1a0-0000-7000-8000-0000000000a1");
    private static readonly Guid BusinessId = Guid.Parse("0199a1a0-0000-7000-8000-0000000000c1");
    private static readonly DateTimeOffset At = new(2026, 9, 10, 8, 30, 0, TimeSpan.Zero);

    private static CustomerMembership Membership(MembershipRole role = MembershipRole.Trader) =>
        CustomerMembership.Create(AccountId, BusinessId, role, At).Value;

    [Fact]
    public void The_three_roles_are_spelled_exactly_as_the_database_check_constraint_names_them()
    {
        // Pinned by name, not by count: the CHECK constraint in migration 15 lists
        // ('admin','trader','viewer') and customer.is_admin_of compares against 'admin'. A member
        // renamed here is a 23514 on the first insert, on a table nobody has migrated.
        Enum.GetNames<MembershipRole>().ShouldBe(["Admin", "Trader", "Viewer"]);
    }

    [Fact]
    public void A_new_membership_is_active_and_carries_the_moment_it_was_created()
    {
        var membership = Membership(MembershipRole.Admin);

        membership.AccountId.ShouldBe(AccountId);
        membership.CustomerId.ShouldBe(BusinessId);
        membership.Role.ShouldBe(MembershipRole.Admin);
        membership.CreatedAt.ShouldBe(At);
        membership.RemovedAt.ShouldBeNull();
        membership.IsActive.ShouldBeTrue();
    }

    [Fact]
    public void A_membership_without_an_account_is_rejected()
    {
        var result = CustomerMembership.Create(Guid.Empty, BusinessId, MembershipRole.Trader, At);

        result.IsSuccess.ShouldBeFalse();
        result.Error.ShouldBe("A membership must name an account.");
    }

    [Fact]
    public void A_membership_without_a_business_is_rejected()
    {
        var result = CustomerMembership.Create(AccountId, Guid.Empty, MembershipRole.Trader, At);

        result.IsSuccess.ShouldBeFalse();
        result.Error.ShouldBe("A membership must name a business.");
    }

    [Fact]
    public void Changing_the_role_leaves_the_two_identifiers_and_the_creation_moment_alone()
    {
        var membership = Membership();

        membership.ChangeRole(MembershipRole.Admin);

        membership.Role.ShouldBe(MembershipRole.Admin);
        membership.AccountId.ShouldBe(AccountId);
        membership.CustomerId.ShouldBe(BusinessId);
        membership.CreatedAt.ShouldBe(At);
    }

    [Fact]
    public void Removing_records_the_moment_and_makes_the_membership_inactive()
    {
        var membership = Membership();
        var removedAt = At.AddDays(30);

        membership.Remove(removedAt);

        membership.RemovedAt.ShouldBe(removedAt);
        membership.IsActive.ShouldBeFalse();
    }

    [Fact]
    public void Removing_twice_keeps_the_FIRST_moment()
    {
        // The same shape as RefreshToken.Revoke's `RevokedAt ??= at`, and for the same reason: the
        // moment somebody lost access is the audit answer, and a second removal must not move it
        // forward. Plan 4's removal endpoint is idempotent because of this line.
        var membership = Membership();
        var first = At.AddDays(30);

        membership.Remove(first);
        membership.Remove(At.AddDays(60));

        membership.RemovedAt.ShouldBe(first);
    }

    [Fact]
    public void Restoring_a_removed_membership_clears_the_removal_and_re_dates_the_creation()
    {
        // Design section 3.1: "Re-inviting a removed person clears the column rather than inserting
        // a duplicate, which the composite key would refuse anyway." CreatedAt moves to the moment
        // of the restore, because the question the column answers - "since when has this person
        // been in this business" - has a new answer.
        var membership = Membership();
        membership.Remove(At.AddDays(30));
        var restoredAt = At.AddDays(45);

        membership.Restore(restoredAt);

        membership.RemovedAt.ShouldBeNull();
        membership.IsActive.ShouldBeTrue();
        membership.CreatedAt.ShouldBe(restoredAt);
    }

    [Fact]
    public void Restoring_a_membership_that_was_never_removed_changes_nothing()
    {
        var membership = Membership();

        membership.Restore(At.AddDays(45));

        membership.RemovedAt.ShouldBeNull();
        membership.CreatedAt.ShouldBe(At, "an active membership has nothing to restore");
    }

    [Theory]
    [InlineData(MembershipRole.Admin, "admin")]
    [InlineData(MembershipRole.Trader, "trader")]
    [InlineData(MembershipRole.Viewer, "viewer")]
    public void The_wire_and_column_spelling_of_a_role_is_LOWER_case(
        MembershipRole role, string spelling)
    {
        // ⚠ The ONE definition of this spelling, shared contract section 13.2. Migration 15's
        // CHECK (role IN ('admin','trader','viewer')) and customer.is_admin_of both compare
        // against the lower-case literal, and section 8 puts the same literal on the wire - so one
        // helper serves the value converter, both hosts and plans 2 and 4. EnumWireFormat is
        // JsonNamingPolicy.SnakeCaseUpper and would say ADMIN; this is why MembershipRoleWire
        // exists rather than a call to it.
        MembershipRoleWire.Of(role).ShouldBe(spelling, Case.Sensitive);
        MembershipRoleWire.Parse(spelling).ShouldBe(role);
    }

    [Fact]
    public void An_unknown_role_string_throws_rather_than_becoming_member_zero()
    {
        // A row or a request body carrying a role this build does not know is a mismatch, and
        // silently reading it as Admin - member zero - would be the worst possible default.
        // MembershipModelShapeTests asserts the same thing through the EF value converter, which
        // is this same method.
        Should.Throw<ArgumentOutOfRangeException>(() => MembershipRoleWire.Parse("owner"));
    }

    [Fact]
    public void Values_lists_every_role_in_declaration_order_so_a_validator_can_quote_them()
    {
        // Task 15's CreateAccountRequestValidator and UpdateAccountRequestValidator name these
        // three in their message; plan 4's invitation validator names the same three. Reading them
        // off the enum means a fourth role cannot be added without every message following.
        MembershipRoleWire.Values.ShouldBe(["admin", "trader", "viewer"]);
    }

    [Fact]
    public void TryParse_reads_the_three_constants_back_and_refuses_anything_else()
    {
        // The remaining four of the seven members shared contract section 13.2.1 pins - the three
        // constants and TryParse; Of, Parse and Values are covered above. The constants
        // are what plans 2 and 4 name instead of repeating "admin" - so they have to BE what Of
        // returns, and round-tripping them through TryParse (which compares against Of) is what
        // stops the two drifting apart. TryParse rather than a nullable-returning Parse overload:
        // reference nullability does not differentiate an overload, so that pair is CS0111.
        MembershipRoleWire.TryParse(MembershipRoleWire.Admin, out var admin).ShouldBeTrue();
        admin.ShouldBe(MembershipRole.Admin);
        MembershipRoleWire.TryParse(MembershipRoleWire.Trader, out var trader).ShouldBeTrue();
        trader.ShouldBe(MembershipRole.Trader);
        MembershipRoleWire.TryParse(MembershipRoleWire.Viewer, out var viewer).ShouldBeTrue();
        viewer.ShouldBe(MembershipRole.Viewer);

        // Wire input nothing has checked yet: unknown and null both refuse rather than throwing,
        // which is why anything reading a request body calls this and not Parse.
        MembershipRoleWire.TryParse("owner", out _).ShouldBeFalse();
        MembershipRoleWire.TryParse("Admin", out _).ShouldBeFalse();
        MembershipRoleWire.TryParse(null, out _).ShouldBeFalse();
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo --filter "FullyQualifiedName~CustomerMembershipTests"`

Expected: **the build fails**, not the assertions —
`error CS0246: The type or namespace name 'CustomerMembership' could not be found`,
`error CS0246: The type or namespace name 'MembershipRole' could not be found` and
`error CS0103: The name 'MembershipRoleWire' does not exist in the current context`, once per
reference. That is the correct first failure for a type that does not exist yet; the assertion-level
failures arrive in Step 6's mutation.

- [ ] **Step 3: Write the enum and its one wire spelling**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/MembershipRole.cs`:

```csharp
namespace PeakPower.Domain.Customers;

/// <summary>
/// What one person may do in one business. Shared contract section 3 and section 7.
/// <para>
/// ⚠ <b>The database spelling is LOWER CASE</b> - <c>'admin' | 'trader' | 'viewer'</c> - and it is
/// the only enum in this schema that is. Migration 15's
/// <c>CHECK (role IN ('admin','trader','viewer'))</c> and its <c>customer.is_admin_of</c> function
/// both compare against those literals, and both are normative in the shared contract, so the C#
/// side is what bends: <see cref="MembershipRoleWire"/> is the one place that spelling lives, and
/// <c>CustomerMembershipConfiguration</c> declares an explicit value converter over it that beats
/// <c>EnumToTextConvention</c>'s SCREAMING_SNAKE one. Do not "tidy" this into the convention - the
/// first insert would raise 23514.
/// </para>
/// <para>
/// ⚠ <c>Trader</c> and <c>Viewer</c> collide with the EMPLOYEE vocabulary <c>[F13-R12]</c>. The
/// collision is accepted (shared contract section 3); the resolution is that any code naming both
/// spells <c>membershipRole</c> and <c>employeeRole</c> explicitly, and that the wire field is
/// never called <c>role</c> - <c>role</c> is already JOB TITLE on the account record, which
/// <c>[F01-R13]</c> says is "descriptive only... never checked".
/// </para>
/// <para>
/// Only <see cref="Admin"/> gates anything (design section 3.3): entitlements, invitations, role
/// changes and removals. <see cref="Trader"/> and <see cref="Viewer"/> are recorded and displayed
/// and are behaviourally identical to today's single customer role, which is what keeps
/// <c>[F01-R14]</c> true.
/// </para>
/// </summary>
public enum MembershipRole
{
    Admin,
    Trader,
    Viewer,
}
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs`:

```csharp
namespace PeakPower.Domain.Customers;

/// <summary>
/// The one spelling of a <see cref="MembershipRole"/> outside C#. Shared contract section 13.2
/// names plan 1 its owner and this is the single definition: plans 2 and 4 call it, and no second
/// converter, mapper or parser may exist.
/// <para>
/// ⚠ <b>Not <c>EnumWireFormat</c>.</b> That helper
/// (<c>PeakPower.Infrastructure.Web/Http/EnumWireFormat.cs</c>) is
/// <c>JsonNamingPolicy.SnakeCaseUpper</c> and would say <c>ADMIN</c>. This is the one enum in the
/// codebase whose spelling is LOWER case, in the column and on the wire alike - shared contract
/// section 3 fixes <c>'admin' | 'trader' | 'viewer'</c> for the <c>CHECK</c> constraint and
/// <c>customer.is_admin_of</c>, and section 8 puts the same literal on <c>membershipRole</c>. One
/// string, one home. The member names here deliberately mirror <c>EnumWireFormat</c>'s
/// <c>ToWire</c>/<c>Parse</c>/<c>Names</c> so the house pattern is recognisable.
/// </para>
/// <para>
/// ⚠ <b>It lives in <c>PeakPower.Domain</c>, not in <c>PeakPower.Infrastructure.Web</c>.</b>
/// <c>CustomerMembershipConfiguration</c>'s value converter needs it, and
/// <c>PeakPower.Persistence</c> references <c>PeakPower.Application</c> - and through it
/// <c>PeakPower.Domain</c> - and nothing else. A helper beside <c>EnumWireFormat</c> would be
/// unreachable from the converter, and a second pair would grow back in Persistence within a
/// commit. Architecture fact 1 is intact: this file references nothing.
/// </para>
/// </summary>
public static class MembershipRoleWire
{
    /// <summary>
    /// The three spellings as compile-time constants, so a <c>switch</c> arm, an attribute, a
    /// seeded row or a test can name a role without a fourth copy of the literal appearing.
    /// <para>
    /// ⚠ These are the constants plan 4 wanted to declare beside its own copy of this type. Shared
    /// contract section 13.2.1 folds them in HERE instead - one home, seven members - so plan 4
    /// consumes <c>MembershipRoleWire.Admin</c> rather than declaring it a second time.
    /// <see cref="Of"/> must agree with them, and
    /// <c>TryParse_reads_the_three_constants_back_and_refuses_anything_else</c> is the test that
    /// says so: it round-trips each constant through <see cref="TryParse"/>, which compares
    /// against <see cref="Of"/>, so the two cannot drift apart silently.
    /// </para>
    /// </summary>
    public const string Admin = "admin";

    /// <inheritdoc cref="Admin"/>
    public const string Trader = "trader";

    /// <inheritdoc cref="Admin"/>
    public const string Viewer = "viewer";

    /// <summary>
    /// Every role, in wire spelling and declaration order. Task 15's two employee validators and
    /// plan 4's invitation validator quote this rather than repeating three literals, so a fourth
    /// role cannot be added without every message following.
    /// <para>
    /// ⚠ Read off the enum through <see cref="Of"/> rather than written out as
    /// <c>[Admin, Trader, Viewer]</c>, deliberately: a fourth enum member then appears here without
    /// anyone remembering to add it, and a change to <see cref="Of"/>'s spelling is caught by this
    /// list's test as well as by the round-trip theory. Task 1's third mutation depends on exactly
    /// that.
    /// </para>
    /// </summary>
    public static IReadOnlyList<string> Values { get; } =
        [.. Enum.GetValues<MembershipRole>().Select(Of)];

    /// <summary>
    /// Lower-casing the member name rather than a switch, so a member added to
    /// <see cref="MembershipRole"/> without a matching database CHECK value fails on the insert
    /// (23514) instead of falling through a default arm. No member has adjacent capitals, so the
    /// round trip through <see cref="Parse"/> is exact. Never throws.
    /// </summary>
    public static string Of(MembershipRole role) => role.ToString().ToLowerInvariant();

    /// <summary>
    /// The read half, for a column value or a body a validator has already checked.
    /// <para>
    /// ⚠ Case-SENSITIVE and throwing, both deliberately. Accepting <c>"Admin"</c> would let a
    /// caller keep the wrong spelling indefinitely until the two drifted apart unnoticed - the
    /// argument <c>EnumWireFormat</c>'s own doc comment already makes - and an unknown value must
    /// not silently become member zero, which is <see cref="MembershipRole.Admin"/>. The throw is
    /// the backstop behind validation, not the error message a client sees.
    /// </para>
    /// <para>
    /// ⚠ There is no <c>Parse(string?)</c> overload returning <c>MembershipRole?</c>. Reference
    /// nullability does not differentiate an overload, so that pair is <c>CS0111</c> (shared
    /// contract section 13.2.1). Untrusted input goes through <see cref="TryParse"/>.
    /// </para>
    /// </summary>
    public static MembershipRole Parse(string value)
        => TryParse(value, out var role)
            ? role
            : throw new ArgumentOutOfRangeException(
                nameof(value), value, $"'{value}' is not one of: {string.Join(", ", Values)}.");

    /// <summary>
    /// The member for wire input nothing has checked yet - a request body, a query string, a
    /// column read from a build that knew a role this one does not. Returns <c>false</c> for
    /// <c>null</c> and for any spelling outside <see cref="Values"/>.
    /// <para>
    /// ⚠ On <c>false</c>, <paramref name="role"/> is <c>default</c>, which is
    /// <see cref="MembershipRole.Admin"/> - member zero. Callers MUST branch on the return value
    /// and never read the out parameter after a <c>false</c>; that is the whole reason an unknown
    /// value does not quietly parse. <c>EnumWireFormat.TryParse</c> has the same shape and the
    /// same hazard.
    /// </para>
    /// </summary>
    public static bool TryParse(string? value, out MembershipRole role)
    {
        foreach (var candidate in Enum.GetValues<MembershipRole>())
        {
            if (string.Equals(Of(candidate), value, StringComparison.Ordinal))
            {
                role = candidate;
                return true;
            }
        }

        role = default;
        return false;
    }
}
```

- [ ] **Step 4: Write the aggregate**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/CustomerMembership.cs`:

```csharp
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Customers;

/// <summary>
/// One person's place in one business: the account, the business, the role, and the window it has
/// been true for. Shared contract section 7.
/// <para>
/// This table is now the sole answer to "which company does this account belong to" and "does it
/// administer that company" - both of which used to be columns on <c>customer_account</c>. The
/// primary key is the pair <c>(AccountId, CustomerId)</c>, so a person is in a business at most
/// once and re-inviting somebody who was removed clears <see cref="RemovedAt"/> rather than
/// inserting a duplicate the key would refuse anyway.
/// </para>
/// <para>
/// ⚠ <b>A membership is never DELETEd, and that is a security property rather than a preference.</b>
/// PostgreSQL evaluates a policy's <c>WITH CHECK</c> arm for <c>INSERT</c> and for an
/// <c>UPDATE</c>'s new row and <b>never for <c>DELETE</c></b>, which <c>USING</c> alone governs.
/// Migration 15's <c>USING</c> arm is deliberately permissive - it has an <c>OR account_id = me</c>
/// term so the business switcher can read memberships in other businesses - so a granted
/// <c>DELETE</c> would let a plain <c>viewer</c> wipe every membership in their business, admins
/// included, and let anybody drop their own memberships in businesses their token does not name.
/// The migration grants no <c>DELETE</c> to either application role, and removal is
/// <see cref="Remove"/>, an <c>UPDATE</c> that <c>WITH CHECK</c> does guard.
/// </para>
/// <para>
/// ⚠ The property is <c>AccountId</c> and not <c>CustomerAccountId</c>, which the shared contract
/// fixes and which changes which coverage guard sees this type:
/// <c>AutomaticPolicyCoverageTests.AccountIdOwned</c> discovers by the literal name
/// <c>CustomerAccountId</c> and will not find this one. <c>CustomerIdOwned</c> does find it, through
/// <see cref="CustomerId"/>, and holds it to the same two-policy bar. Renaming this property would
/// move two guard counts instead of one for no gain.
/// </para>
/// </summary>
public sealed class CustomerMembership
{
    /// <summary>EF Core materialises through this; application code uses <see cref="Create"/>.</summary>
    private CustomerMembership()
    {
    }

    public Guid AccountId { get; private set; }

    public Guid CustomerId { get; private set; }

    public MembershipRole Role { get; private set; }

    /// <summary>
    /// Since when this person has been in this business. <see cref="Restore"/> moves it, because
    /// after a removal and a re-invitation the honest answer to that question is the newer date.
    /// </summary>
    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>
    /// Null while the membership is live. Every predicate in the design carries
    /// <c>removed_at IS NULL</c> - the policies, the function, the request path's proof and the EF
    /// query filter - so a removed membership is invisible to everything except an explicit query
    /// for history.
    /// </summary>
    public DateTimeOffset? RemovedAt { get; private set; }

    public bool IsActive => RemovedAt is null;

    public static Result<CustomerMembership> Create(
        Guid accountId, Guid customerId, MembershipRole role, DateTimeOffset at)
    {
        if (accountId == Guid.Empty)
        {
            return Result<CustomerMembership>.Failure("A membership must name an account.");
        }

        if (customerId == Guid.Empty)
        {
            return Result<CustomerMembership>.Failure("A membership must name a business.");
        }

        return Result<CustomerMembership>.Success(new CustomerMembership
        {
            AccountId = accountId,
            CustomerId = customerId,
            Role = role,
            CreatedAt = at,
        });
    }

    public void ChangeRole(MembershipRole role) => Role = role;

    /// <summary>
    /// The removal, which is an <c>UPDATE</c> and not a <c>DELETE</c> - see this type's own remarks
    /// for why that is the whole reason removal is guarded at all.
    /// <para>
    /// <c>??=</c>, not <c>=</c>: the moment somebody lost access is the audit answer, and a second
    /// removal must not move it forward. The same shape as <see cref="RefreshToken.Revoke"/>.
    /// </para>
    /// </summary>
    public void Remove(DateTimeOffset at) => RemovedAt ??= at;

    /// <summary>
    /// Re-invites somebody who was removed. Unreachable from plan 1 - plan 4's invitation accept is
    /// the first caller - and declared here because the composite primary key makes it the ONLY way
    /// a removed person comes back: an INSERT would raise 23505.
    /// </summary>
    public void Restore(DateTimeOffset at)
    {
        if (RemovedAt is null)
        {
            return;
        }

        RemovedAt = null;
        CreatedAt = at;
    }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Domain.Tests --nologo --filter "FullyQualifiedName~CustomerMembershipTests"
```

Expected: build clean; PASS, **fifteen** cases — the nine aggregate facts, the three
`MembershipRoleWire` theory rows, and the unknown-value, `Values` and constants/`TryParse` facts.

- [ ] **Step 6: Mutate `Remove` from `??=` to `=`, and check the right test bites**

Change one character in `CustomerMembership.Remove`:

```csharp
    // MUTATION
    public void Remove(DateTimeOffset at) => RemovedAt = at;
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo --filter "FullyQualifiedName~CustomerMembershipTests"`

Expected: **exactly one** failure — `Removing_twice_keeps_the_FIRST_moment`, with

```
membership.RemovedAt
    should be
2026-10-10T08:30:00.0000000+00:00
    but was
2026-11-09T08:30:00.0000000+00:00
```

`Removing_records_the_moment_and_makes_the_membership_inactive` must stay **green** — it removes
once, so it cannot tell the two operators apart. One failing test and one passing one is what proves
the mutation was narrow and that the idempotence claim has its own coverage rather than riding on
the neighbouring assertion.

Restore `??=`. Now mutate the other direction — make `Restore` leave `CreatedAt` alone:

```csharp
    public void Restore(DateTimeOffset at)
    {
        if (RemovedAt is null)
        {
            return;
        }

        RemovedAt = null;
        // MUTATION: CreatedAt = at; removed
    }
```

Run the same command.
Expected: **one** failure, `Restoring_a_removed_membership_clears_the_removal_and_re_dates_the_creation`:

```
membership.CreatedAt
    should be
2026-10-25T08:30:00.0000000+00:00
    but was
2026-09-10T08:30:00.0000000+00:00
```

Restore the line. Now the third mutation, on the spelling every later task depends on — make
`MembershipRoleWire.Of` follow the schema's SCREAMING_SNAKE grain:

```csharp
    // MUTATION
    public static string Of(MembershipRole role) => role.ToString().ToUpperInvariant();
```

Run the same command.
Expected: **five** failures — all three rows of
`The_wire_and_column_spelling_of_a_role_is_LOWER_case` (`should be "admin" but was "ADMIN"`, and the
same for `trader` and `viewer`), `Values_lists_every_role_in_declaration_order…`
(`should be ["admin", "trader", "viewer"] but was ["ADMIN", "TRADER", "VIEWER"]`) and
`TryParse_reads_the_three_constants_back_and_refuses_anything_else` (the first
`ShouldBeTrue()`: `MembershipRoleWire.Admin` is still `"admin"` while `Of` now returns `"ADMIN"`,
so nothing matches). That last one is the finding that the constants are not a fourth copy of the
literal — they are checked against `Of`, so the mutation cannot leave them agreeing.
⚠ `An_unknown_role_string_throws_rather_than_becoming_member_zero` stays **green**, and that is the
finding: `Parse("owner")` throws under either spelling, so that test alone would let this ship. The
round-trip theory is the one carrying the claim, which is why the two are separate tests.

Restore it and prove all three restores. ⚠ `git diff` cannot prove this — all three files are new
and untracked, so it prints nothing whether or not a mutation is still in place. Grep for the
restored text instead:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
{
  grep -c 'RemovedAt ??= at' src/Core/PeakPower.Domain/Customers/CustomerMembership.cs
  grep -c 'CreatedAt = at;'  src/Core/PeakPower.Domain/Customers/CustomerMembership.cs
  grep -c 'ToLowerInvariant' src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs
  grep -rc 'MUTATION' src/Core/PeakPower.Domain/Customers/
} > /tmp/task1-restore.txt 2>&1; cat /tmp/task1-restore.txt
```

Expected: `1`, `1`, `1`, and **zero** `MUTATION` matches in any of the three files. If a `MUTATION`
comment survives, so does the mutation.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Customers/MembershipRole.cs \
        src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs \
        src/Core/PeakPower.Domain/Customers/CustomerMembership.cs \
        tests/PeakPower.Domain.Tests/Customers/CustomerMembershipTests.cs
git commit -m "feat(domain): add CustomerMembership, MembershipRole and MembershipRoleWire

One person, several businesses, a role in each - the type that replaces
customer_account.customer_id and customer_account.is_admin. Shared contract section 7,
member for member, with Create returning Result<CustomerMembership> the way every other
factory in this namespace does.

MembershipRoleWire is the ONE spelling of a role outside C#, which shared contract section
13.2 makes plan 1's to own: the EF value converter, both hosts and plans 2 and 4 all call
it, and no second converter or parser may exist. It is not EnumWireFormat - that is
SnakeCaseUpper and would say ADMIN, and this is the one enum here that is lower case in the
column and on the wire alike. It lives in Domain rather than Infrastructure.Web because
Persistence's value converter needs it and Persistence cannot see Infrastructure.Web.

Removal is a timestamp rather than a DELETE, and that is a security property: Postgres
evaluates a policy's WITH CHECK for INSERT and for an UPDATE's new row and never for
DELETE, so a deletable membership would be deletable by anyone the permissive USING arm
lets see it. Remove() uses ??= so a second removal cannot move the moment somebody lost
access forward; verified by mutation - changing it to = fails Removing_twice_keeps_the_
FIRST_moment and leaves the single-removal test green.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 2: The EF mapping, the `Memberships` navigation, and the model-side guards

Three things land together because they are one fact seen from three angles: the table exists in the
model, `CustomerAccount` can reach it through a collection navigation (which is what makes Task 8's
replacement query filter expressible at all — `HasQueryFilter` cannot reference `Set<T>()`), and the
model-driven coverage guards discover it.

⚠ **`CustomerAccount.Memberships` is the first collection navigation in this model.** Verified: a
`grep` for `HasMany` and `Navigation(` across `src/Core/PeakPower.Domain/Customers/Customer.cs` and
every file in `src/Infrastructure/PeakPower.Persistence/Configurations/` returns nothing. Every
relationship declared so far is `HasOne<T>().WithMany()` with no navigation on either side. So there
is no house precedent to copy and the configuration below is written out in full, including the
backing-field access mode, rather than trusting a convention nothing in this repository exercises.

⚠ **The lower-case value converter is the reason this task exists at all** (Deviation D2).
`EnumToTextConvention` walks every enum property in the model at finalization and applies
`EnumToScreamingSnakeConverter<T>`, which would store `ADMIN`. Migration 15's `CHECK` and its
`is_admin_of` function both compare against `'admin'`. An explicit `HasConversion` in an
`IEntityTypeConfiguration` is `ConfigurationSource.Explicit`; the convention's
`IConventionPropertyBuilder.HasConversion` is `ConfigurationSource.Convention` and cannot override
it. Step 1 asserts the resulting stored value rather than assuming that ordering.

⚠ **This task ends with two integration test classes red, by design.** Adding `CustomerMembership`
to the model makes `AutomaticPolicyCoverageTests` discover thirteen customer-owned entity types
where it pins twelve, and then try to read `pg_class` for a table migration 15 has not created yet.
Task 3 lands the table and moves both numbers. Nothing between here and there is a surprise, and the
exact failures are written out in Step 5.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/CustomerMembershipConfiguration.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/CustomerAccount.cs` (insert after `:48`)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/CustomerAccountConfiguration.cs` (insert after `:40`)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs` (insert after `:25`)
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Model/MembershipModelShapeTests.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs:102-107`, `:117-122`, `:135-160`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract/EnumWireAlgorithmDivergenceTests.cs:78-118`, `:172`, `:183`

**Interfaces:**
- Consumes: `CustomerMembership`, `MembershipRole`, **`MembershipRoleWire.Of` / `.Parse`** (Task 1) —
  the configuration's `HasConversion` is the *first* consumer of that helper and declares no
  converter pair of its own. ⚠ An earlier revision put `RoleToDatabase`/`RoleFromDatabase` on
  `CustomerMembershipConfiguration`; contract §13.2 collapses them onto `MembershipRoleWire`, so
  nothing below defines a second spelling.
- Produces: `PeakPowerDbContext.CustomerMemberships` (`DbSet<CustomerMembership>`);
  `CustomerAccount.Memberships` (`IReadOnlyCollection<CustomerMembership>`);
  `CustomerAccount.LastActiveBusinessId` (`Guid?`).
- Produces: **`CustomerAccount.RecordActiveBusiness(Guid customerId)`** — shared contract §13.2 names
  plan 1 its owner and this task is where it lands. **Plan 2 consumes it**: `POST
  /api/v1/auth/active-business` is its first and only caller, and plan 2 must not re-declare it on
  the aggregate (`CS0111`). Throws `ArgumentException` on `Guid.Empty`; migration 15 backfills the
  column in SQL and does not go through this method.
- Produces: `CustomerMembershipConfiguration.BusinessIndexName` (`const string`), the one place the
  index name is spelled for the migration, the configuration and the model-shape test.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Model/MembershipModelShapeTests.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;
using PeakPower.Persistence.Configurations;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Model;

/// <summary>
/// The shape migration 15 has to match, asserted without a database. Building a model needs a
/// connection string for Npgsql's type mappings but opens no connection.
/// </summary>
public sealed class MembershipModelShapeTests : IDisposable
{
    private const string DesignTimeConnectionString =
        "Host=localhost;Port=5432;Database=peakpower;Username=postgres;Password=postgres";

    private readonly PeakPowerDbContext _context;

    public MembershipModelShapeTests()
    {
        var options = new DbContextOptionsBuilder<PeakPowerDbContext>();
        PersistenceServiceCollectionExtensions.ConfigureDbContext(options, DesignTimeConnectionString);
        _context = new PeakPowerDbContext(options.Options, new UnscopedCustomerContext());
    }

    private IEntityType Membership => _context.Model.FindEntityType(typeof(CustomerMembership))!;

    private static StoreObjectIdentifier Table =>
        StoreObjectIdentifier.Table("customer_membership", "customer");

    [Fact]
    public void The_membership_maps_to_customer_customer_membership()
    {
        var entityType = _context.Model.FindEntityType(typeof(CustomerMembership));

        entityType.ShouldNotBeNull();
        entityType!.GetSchema().ShouldBe("customer");
        entityType.GetTableName().ShouldBe("customer_membership");
    }

    [Fact]
    public void The_primary_key_is_the_pair_and_not_a_surrogate()
    {
        // The composite key is what makes "one person is in a business at most once" a database
        // fact rather than a convention, and it is why re-inviting a removed person has to clear
        // removed_at instead of inserting: an INSERT would raise 23505.
        Membership.FindPrimaryKey()!.Properties
            .Select(property => property.Name)
            .ShouldBe(["AccountId", "CustomerId"]);
    }

    [Theory]
    [InlineData("AccountId", "account_id")]
    [InlineData("CustomerId", "customer_id")]
    [InlineData("Role", "role")]
    [InlineData("CreatedAt", "created_at")]
    [InlineData("RemovedAt", "removed_at")]
    public void Every_column_is_snake_case_without_an_attribute_in_the_domain(
        string propertyName, string columnName)
    {
        Membership.GetProperty(propertyName).GetColumnName(Table).ShouldBe(columnName);
    }

    [Fact]
    public void The_customer_id_column_is_spelled_so_both_coverage_guards_can_see_it()
    {
        // Not a duplicate of the theory above. CatalogPolicyCoverageTests discovers a tenant table
        // by right(column_name, 11) = 'customer_id' and AutomaticPolicyCoverageTests by a property
        // name ending in "CustomerId". A table that named its tenant column anything else would be
        // INVISIBLE to both - full coverage reported over an unpoliced table - which is the exact
        // failure the last_active_business_id naming rule exists to avoid on the other side.
        Membership.GetProperty("CustomerId").GetColumnName(Table)![^11..].ShouldBe("customer_id");
    }

    [Fact]
    public void The_role_is_stored_in_LOWER_case_because_the_check_constraint_is()
    {
        // ⚠ The whole point of CustomerMembershipConfiguration's explicit HasConversion.
        // EnumToTextConvention applies EnumToScreamingSnakeConverter to every enum property in the
        // model at finalization and would store 'ADMIN'; migration 15's
        // CHECK (role IN ('admin','trader','viewer')) and customer.is_admin_of both compare against
        // the lower-case literal. An explicit configuration is ConfigurationSource.Explicit and the
        // convention's is ConfigurationSource.Convention, which cannot override it - this test is
        // what proves that ordering rather than assuming it.
        var converter = Membership.GetProperty("Role").GetValueConverter();

        converter.ShouldNotBeNull();
        converter!.ConvertToProvider(MembershipRole.Admin).ShouldBe("admin");
        converter.ConvertToProvider(MembershipRole.Trader).ShouldBe("trader");
        converter.ConvertToProvider(MembershipRole.Viewer).ShouldBe("viewer");
        converter.ConvertFromProvider("admin").ShouldBe(MembershipRole.Admin);
        converter.ConvertFromProvider("viewer").ShouldBe(MembershipRole.Viewer);
    }

    [Fact]
    public void An_unknown_role_string_throws_through_the_converter_too()
    {
        // The converter's read half IS MembershipRoleWire.Parse - CustomerMembershipConfiguration
        // declares no parser of its own (shared contract 13.2, one definition). Asserted THROUGH
        // EF's converter rather than by calling MembershipRoleWire directly, which
        // CustomerMembershipTests already does: what this pins is the wiring, that a row carrying
        // a role this build does not know throws on materialisation instead of silently becoming
        // member zero - MembershipRole.Admin.
        Should.Throw<ArgumentOutOfRangeException>(
            () => Membership.GetProperty("Role").GetValueConverter()!.ConvertFromProvider("owner"));
    }

    [Fact]
    public void The_business_index_exists_so_the_member_list_does_not_scan()
    {
        // Plan 4's member list and the floor count both read WHERE customer_id = @active. The
        // composite primary key leads on account_id, so it cannot serve that predicate.
        Membership.GetIndexes()
            .Select(index => index.GetDatabaseName())
            .ShouldContain("ix_customer_membership_customer_id");
    }

    [Fact]
    public void An_account_can_reach_its_memberships_through_a_collection_navigation()
    {
        // Task 8's replacement query filter on CustomerAccount is
        // account.Memberships.Any(m => m.CustomerId == ctx.CustomerId && m.RemovedAt == null),
        // and HasQueryFilter cannot reference Set<T>() - the navigation is the only expressible
        // form. Asserted on the model rather than on the CLR property so that a navigation the
        // domain declares but EF never maps fails here.
        var navigation = _context.Model.FindEntityType(typeof(CustomerAccount))!
            .FindNavigation(nameof(CustomerAccount.Memberships));

        navigation.ShouldNotBeNull();
        navigation!.IsCollection.ShouldBeTrue();
        navigation.TargetEntityType.ClrType.ShouldBe(typeof(CustomerMembership));
        navigation.ForeignKey.Properties.Single().Name.ShouldBe("AccountId");
    }

    [Fact]
    public void The_preference_column_does_NOT_end_in_customer_id()
    {
        // ⚠ Shared contract section 3. The obvious name - last_customer_id - would keep
        // customer_account inside both coverage guards' discovery AFTER its real tenancy key has
        // been dropped, keyed on something that is not a tenancy key: a guard reporting coverage it
        // does not have. Asserted as a negative because that is the failure mode.
        var column = _context.Model.FindEntityType(typeof(CustomerAccount))!
            .GetProperty(nameof(CustomerAccount.LastActiveBusinessId))
            .GetColumnName(StoreObjectIdentifier.Table("customer_account", "customer"))!;

        column.ShouldBe("last_active_business_id");
        column.EndsWith("customer_id", StringComparison.Ordinal).ShouldBeFalse(
            "a preference column matching the tenancy suffix is discovered as a tenancy key");
    }

    public void Dispose() => _context.Dispose();
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MembershipModelShapeTests"`

Expected: **the build fails** with
`error CS0117: 'CustomerAccount' does not contain a definition for 'Memberships'`,
`error CS0117: 'CustomerAccount' does not contain a definition for 'LastActiveBusinessId'` and
`error CS0246: The type or namespace name 'CustomerMembershipConfiguration' could not be found`.
`CustomerMembership` itself resolves — Task 1 created it — so the only missing pieces are the ones
this task adds.

- [ ] **Step 3: Add the two members to `CustomerAccount`**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/CustomerAccount.cs`,
insert after line `48` (`public DateTimeOffset? LastLoginAt { get; private set; }`) and before the
`Create` factory at `:50`:

```csharp

    /// <summary>
    /// Which business this person was last acting for, so a sign-in lands where they left off
    /// (design section 5). Null until the first switch, and null is a legitimate value - sign-in
    /// then falls back to the OLDEST membership by created_at, which plan 2 implements.
    /// <para>
    /// ⚠ <b>The name is deliberate and must not be "tidied" to <c>LastCustomerId</c>.</b> Both
    /// row-level-security coverage guards discover tenancy keys by suffix -
    /// <c>right(column_name, 11) = 'customer_id'</c> in the catalogue and
    /// <c>Name.EndsWith("CustomerId")</c> in the model - so a preference column matching that
    /// suffix would keep <c>customer_account</c> in tenancy discovery keyed on something that is
    /// not a tenancy key, after its real one has been dropped. A guard reporting coverage it does
    /// not have is worse than a guard that fails.
    /// </para>
    /// </summary>
    public Guid? LastActiveBusinessId { get; private set; }

    /// <summary>
    /// This account's memberships, including removed ones. The collection is read-only from
    /// outside: memberships are created and changed through <see cref="CustomerMembership"/> and
    /// written through <c>PeakPowerDbContext.CustomerMemberships</c>, not by mutating this list.
    /// <para>
    /// It exists for one reason beyond convenience: the EF global query filter on this entity is
    /// <c>account.Memberships.Any(m =&gt; m.CustomerId == ctx.CustomerId &amp;&amp; m.RemovedAt == null)</c>,
    /// and <c>HasQueryFilter</c> cannot reference <c>Set&lt;T&gt;()</c>. A collection navigation is
    /// the only expressible form of layer-1 tenancy for an entity whose tenancy lives in another
    /// table.
    /// </para>
    /// </summary>
    public IReadOnlyCollection<CustomerMembership> Memberships => _memberships;

    /// <summary>
    /// Records the business this person was last acting for. Plan 2's
    /// <c>POST /api/v1/auth/active-business</c> is the first and only caller; it is declared here so
    /// plan 2 changes an endpoint rather than an aggregate. Migration 15 backfills the column in
    /// SQL and does not go through this method.
    /// </summary>
    public void RecordActiveBusiness(Guid customerId)
    {
        if (customerId == Guid.Empty)
        {
            throw new ArgumentException("An active business must be named.", nameof(customerId));
        }

        LastActiveBusinessId = customerId;
    }
```

and add the backing field immediately after the private constructor, replacing lines `10-13`:

```csharp
    /// <summary>
    /// The backing field EF Core writes memberships into. Declared as a field with a read-only
    /// property over it so nothing outside this type can add or remove a membership without going
    /// through <see cref="CustomerMembership"/> - <c>CustomerMembershipConfiguration</c> sets
    /// <c>PropertyAccessMode.Field</c> so EF never looks for a setter that is not there.
    /// </summary>
    private readonly List<CustomerMembership> _memberships = [];

    /// <summary>EF Core materialises through this; application code uses <see cref="Create"/>.</summary>
    private CustomerAccount()
    {
    }
```

- [ ] **Step 4: Write the configuration, the `DbSet` and the account-side navigation**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/CustomerMembershipConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Customers;

namespace PeakPower.Persistence.Configurations;

public sealed class CustomerMembershipConfiguration : IEntityTypeConfiguration<CustomerMembership>
{
    /// <summary>
    /// The index plan 4's member list and floor count read through. Named here as a constant so the
    /// migration, this configuration and the model-shape test all mean one string.
    /// </summary>
    public const string BusinessIndexName = "ix_customer_membership_customer_id";

    public void Configure(EntityTypeBuilder<CustomerMembership> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable("customer_membership", "customer");

        // The composite key, not a surrogate id: one person is in one business at most once, and
        // that has to be a database fact because it is what makes re-invitation a Restore rather
        // than an INSERT.
        builder.HasKey(membership => new { membership.AccountId, membership.CustomerId });

        // ⚠ The database spelling of a role is LOWER CASE, and this line is why.
        //
        // EnumToTextConvention is an IModelFinalizingConvention that walks every enum property in
        // the model and applies EnumToScreamingSnakeConverter<T>, which would store ADMIN.
        // Migration 15's CHECK (role IN ('admin','trader','viewer')) and its customer.is_admin_of
        // function both compare against the lower-case literal, and both are NORMATIVE in the
        // shared contract - so the C# bends, not the SQL. An explicit HasConversion is
        // ConfigurationSource.Explicit; the convention's is ConfigurationSource.Convention and
        // cannot override it.
        //
        // ⚠ MembershipRoleWire, not a converter pair declared here. Shared contract 13.2 makes
        // that helper the ONE definition of this spelling, shared with both hosts and plans 2 and
        // 4; a private pair on this class was the second of three parallel definitions the
        // contract collapsed.
        builder.Property(membership => membership.Role)
            .IsRequired()
            .HasConversion(role => MembershipRoleWire.Of(role), value => MembershipRoleWire.Parse(value));

        builder.Property(membership => membership.CreatedAt)
            .HasColumnType("timestamptz")
            .IsRequired();

        builder.Property(membership => membership.RemovedAt)
            .HasColumnType("timestamptz");

        // The business a membership names. RESTRICT, not CASCADE: deleting a company out from
        // under its members is not something this schema should make easy, and the migration's own
        // DDL says REFERENCES customer.customer(id) ON DELETE RESTRICT.
        builder.HasOne<Customer>()
            .WithMany()
            .HasForeignKey(membership => membership.CustomerId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(membership => membership.CustomerId)
            .HasDatabaseName(BusinessIndexName);
    }
}
```

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/CustomerAccountConfiguration.cs`,
insert after line `40` (`builder.Property(account => account.LastLoginAt);`) and before the index at
`:42`:

```csharp

        builder.Property(account => account.LastActiveBusinessId);

        // No foreign key declared in EF for last_active_business_id, deliberately. The migration
        // writes REFERENCES customer.customer(id) in DDL, which is where the constraint belongs;
        // declaring the relationship here as well would give CustomerAccount a second navigation
        // to Customer that nothing reads and would put customer rows into the insert ordering of
        // every account save.

        // The account side of the membership relationship, and the reason it is declared HERE
        // rather than only on CustomerMembership: the global query filter on this entity (task 8)
        // is account.Memberships.Any(...), and HasQueryFilter cannot reference Set<T>().
        //
        // CASCADE matches the migration's REFERENCES customer.customer_account(id) ON DELETE
        // CASCADE: a membership is meaningless without its account, exactly as a refresh token is,
        // and RESTRICT would make deleting an account fail against its own memberships.
        //
        // UsePropertyAccessMode(Field) because CustomerAccount.Memberships is an
        // IReadOnlyCollection over a private List - EF writes the field directly and never looks
        // for a setter that is not there.
        builder.HasMany(account => account.Memberships)
            .WithOne()
            .HasForeignKey(membership => membership.AccountId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Navigation(account => account.Memberships)
            .UsePropertyAccessMode(PropertyAccessMode.Field);
```

and add the two usings the file now needs, replacing lines `1-3`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Customers;
```

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs`,
insert after line `25` (`public DbSet<CustomerAccount> CustomerAccounts => Set<CustomerAccount>();`):

```csharp

    /// <summary>
    /// Who is in which business, and with what role. Tenant data, and the ONE table that decides
    /// what tenancy means - but deliberately <b>not</b> filtered below.
    /// <para>
    /// ⚠ Every other customer-owned entity in this context carries
    /// <c>!IsAuthenticated || x.CustomerId == ctx.CustomerId</c>. This one cannot: the business
    /// switcher has to read the caller's memberships in businesses that are NOT the active one, and
    /// a filter of the usual shape would hide exactly those. It is named in
    /// <c>QueryFilterModelTests.ExemptEntityTypes</c> with that reason, which is what makes the
    /// omission a decision somebody can review rather than something that merely happened.
    /// </para>
    /// <para>
    /// Layer 2 is not weakened by that. Migration 15's tenant-isolation policy has the same
    /// permissive <c>OR</c> on the READ side, so the switcher works, and a <c>WITH CHECK</c> arm
    /// that pins every WRITE to the active business AND requires the writer to be an admin of it -
    /// so a handler that forgets <c>AND customer_id = @active</c> is caught by the database rather
    /// than by review.
    /// </para>
    /// </summary>
    public DbSet<CustomerMembership> CustomerMemberships => Set<CustomerMembership>();
```

- [ ] **Step 5: Run the model tests and watch them pass, then read the declared red window**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MembershipModelShapeTests"
```

Expected: build clean; PASS, twelve cases.

Now run the two guard suites that are red on purpose:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~QueryFilterModelTests|FullyQualifiedName~EnumWireAlgorithmDivergenceTests" \
  > /tmp/task2-guards.txt 2>&1; cat /tmp/task2-guards.txt
```

Expected: **three** failures, and read them from the file rather than the terminal.

1. `every_entity_type_that_owns_a_customer_id_has_a_global_query_filter` — the discovered list gained
   `CustomerMembership`:
   `discovered should be ["AuditRecord", "Customer", …] but was ["AuditRecord", "Customer", "CustomerAccount", "CustomerEntitlement", "CustomerMembership", "DailyPosition", …]`
2. the same test's second assertion would fail too, but the first `ShouldBe` short-circuits it.
3. `The_model_discovers_exactly_the_seventeen_enum_types_EnumToTextConvention_converts` —
   `MembershipRole` is now an EF-mapped enum property, so `ModelEnumTypes()` finds eighteen types.

⚠ `Every_divergence_between_the_two_algorithms_is_on_the_pinned_allow_list` must stay **green**.
`EnumWireFormat.ToWire(MembershipRole.Admin)` is `"ADMIN"` and
`EnumToScreamingSnakeConverter<MembershipRole>.ToScreamingSnake(MembershipRole.Admin)` is also
`"ADMIN"` — no member has adjacent capitals, so the two algorithms agree and the allow-list does not
grow. That the *stored* value is neither of those is this table's own business, proven by
`The_role_is_stored_in_LOWER_case_because_the_check_constraint_is`, and is why the divergence guard
has nothing to say here.

- [ ] **Step 6: Move the four model-side literals**

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs`,
replace lines `102-107` — before:

```csharp
    private static readonly HashSet<Type> ExemptEntityTypes =
        [
            typeof(OnboardingApplication),
            typeof(RefreshToken),
            typeof(PasswordResetToken),
            typeof(PeakPower.Domain.Metering.EanPoolEntry),
        ];
```

after:

```csharp
    /// <para>
    /// <c>PeakPower.Domain.Customers.CustomerMembership</c> (membership plan 1): carries a real
    /// <c>CustomerId</c> and a real policy pair, and is exempt from LAYER ONE only. A filter of
    /// this DbContext's usual shape - <c>!IsAuthenticated || m.CustomerId == ctx.CustomerId</c> -
    /// would hide the caller's memberships in every business except the active one, which is
    /// precisely the set the business switcher exists to show; the filter would be worse than
    /// none, the same way EanPoolEntry's would be. What replaces it is not "nothing": migration
    /// 15's tenant-isolation policy reads
    /// <c>account_id = app.account_id OR customer_id = app.customer_id</c>, so a caller sees their
    /// own memberships and their active business's and no others, and its <c>WITH CHECK</c> arm
    /// additionally requires the writer to be an admin of the active business. ⚠ That permissive
    /// <c>OR</c> is also why every admin query in plan 4 must carry an explicit
    /// <c>AND customer_id = @active</c> - RLS does not scope a COUNT here.
    /// </para>
    private static readonly HashSet<Type> ExemptEntityTypes =
        [
            typeof(OnboardingApplication),
            typeof(RefreshToken),
            typeof(PasswordResetToken),
            typeof(PeakPower.Domain.Metering.EanPoolEntry),
            typeof(CustomerMembership),
        ];
```

Replace lines `117-122` — before:

```csharp
    private static bool OwnsSomeCustomerId(Microsoft.EntityFrameworkCore.Metadata.IEntityType entityType) =>
        entityType.GetProperties()
            .Any(property => property.Name.EndsWith("CustomerId", StringComparison.Ordinal)) ||
        entityType.FindProperty("CustomerAccountId") is not null ||
        entityType.ClrType == typeof(Customer);
```

after:

```csharp
    private static bool OwnsSomeCustomerId(Microsoft.EntityFrameworkCore.Metadata.IEntityType entityType) =>
        entityType.GetProperties()
            .Any(property => property.Name.EndsWith("CustomerId", StringComparison.Ordinal)) ||
        entityType.FindProperty("CustomerAccountId") is not null ||
        entityType.ClrType == typeof(Customer) ||
        entityType.ClrType == typeof(CustomerAccount);
```

⚠ The `CustomerAccount` clause is added **now**, before Task 17 drops the property, and it is not
belt-and-braces. `Customer` is already named explicitly here because it keys on its own `Id` rather
than on a `CustomerId` column; `CustomerAccount` is about to join it, keying on a row in another
table. Without this clause, the moment Task 17 removes `CustomerAccount.CustomerId` the single most
security-sensitive entity in the model - the one carrying `password_hash` and `security_stamp` -
drops silently out of the layer-1 coverage walk, and this guard reports full coverage over it
forever after.

Replace lines `135-160` — before:

```csharp
        // Fourteen: migration 2's five (Customer, CustomerAccount, MeteringPoint, Wallet,
        // AuditRecord), migration 3's OnboardingApplication, RefreshToken and PasswordResetToken,
        // migration 5's EanPoolEntry, migration 9's four - IntervalDataVersion, IntervalReading,
        // MeteringPointDayState and DailyPosition - and migration 10's CustomerEntitlement.
```

after:

```csharp
        // Fifteen: migration 2's five (Customer, CustomerAccount, MeteringPoint, Wallet,
        // AuditRecord), migration 3's OnboardingApplication, RefreshToken and PasswordResetToken,
        // migration 5's EanPoolEntry, migration 9's four - IntervalDataVersion, IntervalReading,
        // MeteringPointDayState and DailyPosition - migration 10's CustomerEntitlement, and
        // migration 15's CustomerMembership.
        //
        // ⚠ CustomerAccount is in this list for a DIFFERENT reason than it used to be. It carried
        // a CustomerId property until migration 15 dropped the column; it is now named explicitly
        // in OwnsSomeCustomerId, the same way Customer always has been, because its tenancy lives
        // in customer_membership rather than in a column of its own. Without that clause the most
        // privilege-bearing entity in the model would fall out of this walk silently.
```

and, further down in the same method, replace the `expected` array at `:155-160` — before:

```csharp
        string[] expected =
        [
            "AuditRecord", "Customer", "CustomerAccount", "CustomerEntitlement", "DailyPosition",
            "EanPoolEntry", "IntervalDataVersion", "IntervalReading", "MeteringPoint",
            "MeteringPointDayState", "OnboardingApplication", "PasswordResetToken", "RefreshToken",
            "Wallet",
        ];
```

after (ordinal sort order — `StringComparer.Ordinal` sorts by the whole name, not
case-insensitively):

```csharp
        string[] expected =
        [
            "AuditRecord", "Customer", "CustomerAccount", "CustomerEntitlement", "CustomerMembership",
            "DailyPosition", "EanPoolEntry", "IntervalDataVersion", "IntervalReading", "MeteringPoint",
            "MeteringPointDayState", "OnboardingApplication", "PasswordResetToken", "RefreshToken",
            "Wallet",
        ];
```

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract/EnumWireAlgorithmDivergenceTests.cs`,
add `"MembershipRole"` to `ExpectedEnumTypeNames` at `:99-118` (ordinal order puts it between
`MeteringDayState` and `OnboardingStatus`):

```csharp
        "LegalEntityType",
        "MembershipRole",
        "MeteringDayState",
```

rename the method at `:172` — before:

```csharp
    public void The_model_discovers_exactly_the_seventeen_enum_types_EnumToTextConvention_converts()
```

after:

```csharp
    public void The_model_discovers_exactly_the_eighteen_enum_types_EnumToTextConvention_converts()
```

and move its message at `:183` — before:

```csharp
                "ModelEnumTypes() must discover exactly these seventeen types. A shorter list " +
```

after:

```csharp
                "ModelEnumTypes() must discover exactly these eighteen types. A shorter list " +
```

⚠ Also correct the class's own remarks at `:78-98`, which say "Seventeen since migration 9": append
a sentence rather than rewriting the paragraph, immediately before `</summary>`:

```csharp
    /// <para>
    /// ⚠ Eighteen since migration 15: <c>MembershipRole</c>. It is discovered here because
    /// <c>ModelEnumTypes()</c> keys on a property's CLR type, which a value converter does not
    /// change - and it is discovered even though <c>CustomerMembershipConfiguration</c> takes it
    /// OFF <c>EnumToScreamingSnakeConverter</c> and onto a lower-case converter of its own
    /// (migration 15's CHECK constraint is lower case). That is not a contradiction: this test's
    /// job is to compare the two SCREAMING_SNAKE algorithms wherever both could apply, and they
    /// agree on all three members - <c>ADMIN</c>, <c>TRADER</c>, <c>VIEWER</c>, no adjacent
    /// capitals anywhere - so the allow-list does not grow. What the column actually stores is
    /// pinned by <c>MembershipModelShapeTests.The_role_is_stored_in_LOWER_case_because_the_check_constraint_is</c>.
    /// </para>
```

- [ ] **Step 7: Run the model-only guards and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~QueryFilterModelTests|FullyQualifiedName~EnumWireAlgorithmDivergenceTests|FullyQualifiedName~MembershipModelShapeTests" \
  > /tmp/task2-after.txt 2>&1; cat /tmp/task2-after.txt
```

Expected: PASS for every model-only test in those three classes.
⚠ `QueryFilterEnforcementTests` lives in the same file and needs a container; it will run and pass —
it touches no membership. `AutomaticPolicyCoverageTests` and `CatalogPolicyCoverageTests` are **not**
in this filter and are still red; Task 3 is where they go green.

- [ ] **Step 8: Mutate the wiring, and prove the guard bites on the right thing**

⚠ Task 1 already mutated `MembershipRoleWire.Of` itself and watched the domain tests bite. What is
unproven **here** is the wiring — that this configuration really is what puts that spelling into the
model, and that the convention really would take over without it. So mutate the wiring, not the
helper. Delete the whole `.HasConversion(...)` call from `Configure`, leaving
`EnumToTextConvention` to supply one:

```csharp
        builder.Property(membership => membership.Role)
            .IsRequired();
        // MUTATION: .HasConversion(role => MembershipRoleWire.Of(role), value => MembershipRoleWire.Parse(value)) removed
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MembershipModelShapeTests"`

Expected: **two** failures.
`The_role_is_stored_in_LOWER_case_because_the_check_constraint_is`:

```
converter.ConvertToProvider(MembershipRole.Admin)
    should be
"admin"
    but was
"ADMIN"
```

and `An_unknown_role_string_throws_through_the_converter_too`, because
`EnumToScreamingSnakeConverter` accepts `"owner"` differently from `MembershipRoleWire.Parse` — read
the actual exception type from the file rather than predicting it, and if it happens to throw
`ArgumentOutOfRangeException` too, note that this second test is then **not** distinguishing the two
states and say so.

That first failure is the finding worth having: it proves the convention really would take over,
that the explicit configuration really is what stops it, and that this test distinguishes the two
states rather than merely asserting a converter exists — which is the 23514 this would otherwise
have shipped.

Restore the call, then prove the restore. ⚠ `git diff` cannot prove it — the file is new and
untracked, so it prints nothing either way:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
{
  grep -c 'MembershipRoleWire.Of(role)' \
    src/Infrastructure/PeakPower.Persistence/Configurations/CustomerMembershipConfiguration.cs
  grep -c 'MUTATION' \
    src/Infrastructure/PeakPower.Persistence/Configurations/CustomerMembershipConfiguration.cs
} > /tmp/task2-restore.txt 2>&1; cat /tmp/task2-restore.txt
```

Expected: `1` then `0`.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Customers/CustomerAccount.cs \
        src/Infrastructure/PeakPower.Persistence/Configurations/CustomerMembershipConfiguration.cs \
        src/Infrastructure/PeakPower.Persistence/Configurations/CustomerAccountConfiguration.cs \
        src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs \
        tests/PeakPower.Integration.Tests/Model/MembershipModelShapeTests.cs \
        tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs \
        tests/PeakPower.Integration.Tests/Contract/EnumWireAlgorithmDivergenceTests.cs
git commit -m "feat(persistence): map customer_membership and give CustomerAccount a Memberships navigation

The first collection navigation in this model, and it exists for a specific reason: the
replacement global query filter on CustomerAccount is Memberships.Any(...), and
HasQueryFilter cannot reference Set<T>().

The role column is stored LOWER CASE, against the grain of every other enum here, because
migration 15's CHECK (role IN ('admin','trader','viewer')) and customer.is_admin_of are
normative in the shared contract. An explicit HasConversion is ConfigurationSource.Explicit
and beats EnumToTextConvention's SCREAMING_SNAKE one; verified by mutation - deleting the
explicit call makes the model store ADMIN, which is the 23514 this would have shipped.

OwnsSomeCustomerId now names CustomerAccount explicitly, the way it already names Customer.
Without that, dropping customer_account.customer_id in task 17 would silently remove the
entity carrying password_hash and security_stamp from the layer-1 coverage walk.

AutomaticPolicyCoverageTests and CatalogPolicyCoverageTests are red until migration 15
creates the table; that is the next commit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: Migration 15, steps 1–3 — the column, the table, the grants, the function and both policies

The centre of the plan. Contract §4 steps 1–3 and all of §5 are normative and this task transcribes
them; nothing here invents a column, a grant or a predicate.

⚠ **Hand-written raw SQL, not a scaffolded migration.** `migrationBuilder.CreateTable` cannot emit a
`CHECK` inside the table definition the way §4's DDL spells it, cannot emit `CREATE FUNCTION`, and
cannot emit `GRANT`/`REVOKE`/`CREATE POLICY` at all. Half a scaffolded migration plus half a
hand-written one is worse than either — the reader cannot tell which half is authoritative. So the
migration is generated for its **timestamp, its `Designer.cs` and its model snapshot**, and then its
`Up()` and `Down()` bodies are replaced entirely.

⚠ **`REVOKE ALL` first, then `GRANT`.** Migration 2's
`ALTER DEFAULT PRIVILEGES IN SCHEMA customer, metering, wallet, audit GRANT SELECT, INSERT, UPDATE,
DELETE ON TABLES` (`20260827092246_TenancyRowLevelSecurity.cs:110-112`) fires the instant
`CREATE TABLE` runs, so `customer_membership` arrives carrying `arwd` for **both** application roles
before a single statement of §5 executes. Enumerating the grants it should have does not remove the
one it must never have. That is exactly how `customer.refresh_token` sat on a `DELETE` grant its own
migration never asked for.

⚠ **The `DELETE` is the one that matters.** PostgreSQL evaluates `WITH CHECK` for `INSERT` and for an
`UPDATE`'s new row and **never for `DELETE`**, which `USING` alone governs — and this `USING` is
deliberately permissive so the switcher can read across businesses. A granted `DELETE` would let a
plain `viewer` acting for B run `DELETE FROM customer_membership WHERE customer_id = <B>` and wipe
every membership in B, admins included. There is no policy that can close that; only the absent
privilege can. Task 7 asserts it directly.

⚠ **Three places pin the ordered migration list and all three grow by one entry in this commit.**
`tools/verify-migrator.sh:51` and its failure message, `MigrationScriptTests.cs:32/:39/:40-53`, and
`MigrationBehaviourTests.cs:32/:33-46`.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_MultiBusinessMembership.cs`
- Create (generated): `…/Migrations/<ts>_MultiBusinessMembership.Designer.cs`
- Modify (regenerated): `…/Migrations/PeakPowerDbContextModelSnapshot.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh:51`, `:52-60`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MembershipSchemaTests.cs` (create)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs:32`, `:39`, `:40-53`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs:32`, `:33-46`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs:719-730`, `:768-769`, `:789`, `:1050-1051`, `:1070`

**Interfaces:**
- Consumes: `CustomerMembership`, `CustomerMembershipConfiguration` (Task 2); migration 2's
  `app_customer_role`, `app_employee_role`, `peakpower_app`, `peakpower_employee`.
- Produces: the table `customer.customer_membership`; the index
  `ix_customer_membership_customer_id`; the column `customer.customer_account.last_active_business_id`;
  the function `customer.is_admin_of(uuid, uuid)`; the policies
  `customer_customer_membership_tenant_isolation` and `customer_customer_membership_back_office`;
  the migration id ending `_MultiBusinessMembership`.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MembershipSchemaTests.cs`:

```csharp
using System.Globalization;
using Npgsql;
using PeakPower.Integration.Tests.Tenancy;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Migrations;

/// <summary>
/// What migration 15 steps 1-3 actually did to a database, read out of PostgreSQL's own catalogues
/// rather than out of the migration file. Shared contract sections 4 and 5 are normative and these
/// are their executable form.
/// <para>
/// ⚠ Every privilege assertion here is a claim about a GRANT, not about a policy, and the
/// difference is the whole point. A policy decides which ROWS a command may touch; it cannot forbid
/// the command. Migration 2's ALTER DEFAULT PRIVILEGES hands both application roles
/// SELECT/INSERT/UPDATE/DELETE on every table created afterwards, the instant CREATE TABLE runs, so
/// the REVOKE ALL in migration 15 is what strips DELETE back off - and a migration that granted
/// without revoking first would leave no trace anywhere else.
/// </para>
/// </summary>
[Collection(nameof(TenancyCollection))]
public sealed class MembershipSchemaTests
{
    private readonly TenancyFixture _fixture;

    public MembershipSchemaTests(TenancyFixture fixture) => _fixture = fixture;

    private async Task<NpgsqlConnection> OpenOwnerAsync(CancellationToken ct)
    {
        var connection = TenancyFixture.Connect(_fixture.OwnerConnectionString);
        await connection.OpenAsync(ct);
        return connection;
    }

    [Theory]
    [InlineData("app_customer_role")]
    [InlineData("app_employee_role")]
    public async Task The_role_holds_exactly_SELECT_INSERT_and_UPDATE_and_never_DELETE(string role)
    {
        // Pinned as the exact set, not as "does not contain DELETE": a grant that had lost UPDATE
        // would leave removal (which is an UPDATE of removed_at) impossible, and a grant that had
        // lost SELECT would make the tenant-isolation policy untestable - both pass a
        // does-not-contain assertion.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = await OpenOwnerAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT string_agg(privilege_type, ',' ORDER BY privilege_type)
            FROM information_schema.role_table_grants
            WHERE table_schema = 'customer' AND table_name = 'customer_membership'
              AND grantee = @role
            """,
            connection);
        command.Parameters.AddWithValue("role", role);

        var privileges = (string?)await command.ExecuteScalarAsync(ct);

        privileges.ShouldBe(
            "INSERT,SELECT,UPDATE",
            $"{role} must hold exactly SELECT, INSERT and UPDATE on customer.customer_membership. " +
            "A DELETE grant cannot be guarded: Postgres evaluates WITH CHECK for INSERT and for an " +
            "UPDATE's new row and NEVER for DELETE, and this table's USING arm is deliberately " +
            "permissive so the business switcher can read across businesses - so a viewer acting " +
            "for B could delete every membership in B, admins included");
    }

    [Fact]
    public async Task Row_level_security_is_enabled_and_the_table_carries_exactly_its_two_literal_policy_names()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var connection = await OpenOwnerAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT c.relrowsecurity || ':' ||
                   coalesce((SELECT string_agg(policyname, '|' ORDER BY policyname)
                             FROM pg_policies
                             WHERE schemaname = 'customer' AND tablename = 'customer_membership'), 'NONE')
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'customer' AND c.relname = 'customer_membership'
            """,
            connection);

        var actual = (string?)await command.ExecuteScalarAsync(ct);

        // coalesce(..., 'NONE') rather than comparing an empty string: a table that does not exist
        // and a table with no policies both come back as nothing, and only one of those is a pass.
        // PostgreSQL renders a boolean cast to text lower case, which is why it is "true" and not
        // C#'s "True".
        actual.ShouldBe(
            "true:customer_customer_membership_back_office|customer_customer_membership_tenant_isolation",
            "both coverage guards assert exactly two policies per tenant table, and the names are " +
            "the {schema}_{table}_{tenant_isolation|back_office} convention the slice-2 contract " +
            "made normative. Without the back-office one the employee host reads ZERO membership " +
            "rows, silently, and the F12 account surface is in scope");
    }

    [Fact]
    public async Task The_tenant_isolation_policy_reads_BOTH_settings_and_calls_the_admin_predicate()
    {
        // Asserted on the policy's own expression text rather than behaviourally, because the three
        // terms are independently droppable and each drop is silent: without the account_id arm in
        // USING the switcher goes blind; without the customer_id term in WITH CHECK a write lands
        // in another business; without is_admin_of a trader promotes themselves.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = await OpenOwnerAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT qual, with_check FROM pg_policies
            WHERE schemaname = 'customer' AND tablename = 'customer_membership'
              AND policyname = 'customer_customer_membership_tenant_isolation'
            """,
            connection);
        await using var reader = await command.ExecuteReaderAsync(ct);
        (await reader.ReadAsync(ct)).ShouldBeTrue("the tenant-isolation policy must exist");

        var usingClause = reader.GetString(0);
        var withCheckClause = reader.GetString(1);

        usingClause.ShouldContain("app.account_id", Case.Sensitive);
        usingClause.ShouldContain("app.customer_id", Case.Sensitive);
        withCheckClause.ShouldContain("app.customer_id", Case.Sensitive);
        withCheckClause.ShouldContain("is_admin_of", Case.Sensitive);

        // The READ arm must NOT require admin - a trader has to be able to see their own
        // membership, which is what the request path's step 3 reads on every single request.
        usingClause.ShouldNotContain("is_admin_of", Case.Sensitive);
    }

    [Fact]
    public async Task The_admin_predicate_is_SECURITY_DEFINER_with_a_pinned_search_path()
    {
        // ⚠ A SECURITY DEFINER function with a mutable search_path is an escalation vector: the
        // CALLER chooses which customer.customer_membership the body means. Pinned as the exact
        // proconfig array, not as "contains customer", so a search_path widened to include a
        // schema the caller can create in fails here.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = await OpenOwnerAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT p.prosecdef::text || ':' || p.provolatile || ':' ||
                   coalesce(array_to_string(p.proconfig, ','), 'NONE')
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'customer' AND p.proname = 'is_admin_of'
            """,
            connection);

        var actual = (string?)await command.ExecuteScalarAsync(ct);

        actual.ShouldBe(
            "true:s:search_path=customer, pg_temp",
            "SECURITY DEFINER (prosecdef true), STABLE (provolatile 's') and a pinned search_path. " +
            "SECURITY DEFINER is what makes the admin predicate legal at all - a policy on " +
            "customer_membership that subqueried customer_membership directly raises 'infinite " +
            "recursion detected in policy'");
    }

    [Fact]
    public async Task Only_the_customer_role_may_execute_the_admin_predicate()
    {
        // REVOKE ... FROM PUBLIC is load-bearing: a SECURITY DEFINER function executable by PUBLIC
        // is executable by every login role in the cluster.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = await OpenOwnerAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT has_function_privilege('app_customer_role',
                       'customer.is_admin_of(uuid,uuid)', 'EXECUTE')::text || ':' ||
                   has_function_privilege('public',
                       'customer.is_admin_of(uuid,uuid)', 'EXECUTE')::text
            """,
            connection);

        ((string?)await command.ExecuteScalarAsync(ct)).ShouldBe("true:false");
    }

    [Fact]
    public async Task The_check_constraint_refuses_a_role_the_enum_does_not_have()
    {
        // On the OWNER connection deliberately: a CHECK binds the owner too, so this proves the
        // constraint is what refused the row rather than a policy or a missing grant.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = await OpenOwnerAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await using var insert = new NpgsqlCommand(
            """
            INSERT INTO customer.customer_membership (account_id, customer_id, role, created_at)
            VALUES (@accountId, @customerId, 'owner', now())
            """,
            connection,
            transaction);
        insert.Parameters.AddWithValue("accountId", _fixture.CompanyAAccountId);
        insert.Parameters.AddWithValue("customerId", _fixture.CompanyAId);

        var thrown = await Should.ThrowAsync<PostgresException>(
            async () => await insert.ExecuteNonQueryAsync(ct));

        thrown.SqlState.ShouldBe(PostgresErrorCodes.CheckViolation);
        await transaction.RollbackAsync(ct);
    }

    [Fact]
    public async Task The_composite_key_refuses_a_second_membership_of_the_same_person_in_the_same_business()
    {
        // The reason re-invitation is CustomerMembership.Restore rather than an INSERT.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = await OpenOwnerAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await using var insert = new NpgsqlCommand(
            """
            INSERT INTO customer.customer_membership (account_id, customer_id, role, created_at)
            VALUES (@accountId, @customerId, 'viewer', now())
            """,
            connection,
            transaction);
        insert.Parameters.AddWithValue("accountId", _fixture.CompanyAAccountId);
        insert.Parameters.AddWithValue("customerId", _fixture.CompanyAId);

        var thrown = await Should.ThrowAsync<PostgresException>(
            async () => await insert.ExecuteNonQueryAsync(ct));

        thrown.SqlState.ShouldBe(PostgresErrorCodes.UniqueViolation);
        thrown.ConstraintName.ShouldBe("pk_customer_membership");
        await transaction.RollbackAsync(ct);
    }

    [Fact]
    public async Task The_preference_column_exists_on_customer_account_and_is_nullable()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var connection = await OpenOwnerAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT data_type || ':' || is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'customer' AND table_name = 'customer_account'
              AND column_name = 'last_active_business_id'
            """,
            connection);

        ((string?)await command.ExecuteScalarAsync(ct)).ShouldBe(
            "uuid:YES",
            "null is a legitimate value - an account that has never switched has no preference, " +
            "and sign-in falls back to the oldest membership");
    }

    [Fact]
    public async Task No_column_on_customer_account_other_than_customer_id_ends_in_customer_id()
    {
        // ⚠ Shared contract section 3, asserted against the CATALOGUE rather than the model,
        // because CatalogPolicyCoverageTests discovers by right(column_name, 11) and would be the
        // thing fooled. Today customer_id itself is still here (task 17 drops it); the claim is
        // that migration 15 added nothing ELSE matching the suffix.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = await OpenOwnerAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT coalesce(string_agg(column_name, ',' ORDER BY column_name), 'NONE')
            FROM information_schema.columns
            WHERE table_schema = 'customer' AND table_name = 'customer_account'
              AND right(column_name, 11) = 'customer_id'
            """,
            connection);

        ((string?)await command.ExecuteScalarAsync(ct)).ShouldBe(
            "customer_id",
            "a preference column named last_customer_id would keep customer_account inside the " +
            "catalogue coverage guard's discovery keyed on something that is not a tenancy key");
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MembershipSchemaTests" > /tmp/task3-before.txt 2>&1; cat /tmp/task3-before.txt`

Expected: FAIL, every test, and the failures say the table is not there rather than that it is
misconfigured:

- both `The_role_holds_exactly_SELECT_INSERT_and_UPDATE_and_never_DELETE` cases:
  `privileges should be "INSERT,SELECT,UPDATE" but was null` — `string_agg` over no rows is `NULL`.
- `Row_level_security_is_enabled_and_the_table_carries_exactly_its_two_literal_policy_names`:
  `actual should be "true:customer_customer_membership_back_office|…" but was null` — the outer
  `SELECT` from `pg_class` matched no row at all.
- `The_admin_predicate_is_SECURITY_DEFINER_with_a_pinned_search_path`: `actual should be "true:s:…"
  but was null`.
- `Only_the_customer_role_may_execute_the_admin_predicate`: `Npgsql.PostgresException : 42883:
  function "customer.is_admin_of(uuid,uuid)" does not exist` — `has_function_privilege` throws
  rather than returning false for a function that is not there.
- both insert tests: `42P01: relation "customer.customer_membership" does not exist`.
- `The_preference_column_exists_on_customer_account_and_is_nullable`: `should be "uuid:YES" but was
  null`.
- `No_column_on_customer_account_other_than_customer_id_ends_in_customer_id`: **PASSES** already —
  the column it forbids has not been added, which is the point of asserting it as a set rather than
  as a presence.

- [ ] **Step 3: Scaffold the migration for its timestamp, Designer and snapshot**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet ef migrations add MultiBusinessMembership \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator \
  --output-dir Migrations --context PeakPowerDbContext
ls src/Infrastructure/PeakPower.Persistence/Migrations/ > /tmp/task3-migrations.txt
cat /tmp/task3-migrations.txt
```

Expected: two new files, `<timestamp>_MultiBusinessMembership.cs` and
`<timestamp>_MultiBusinessMembership.Designer.cs`, and a modified
`PeakPowerDbContextModelSnapshot.cs`. The scaffolded `Up()` will contain an `AddColumn` for
`last_active_business_id` and a `CreateTable` for `customer_membership`; both are replaced wholesale
in the next step. **Do not edit the `.Designer.cs` or the snapshot** — they are generated and
correct.

⚠ If `dotnet ef` reports *"No changes"*, Task 2's `DbSet` or configuration did not land. Re-read
`PeakPowerDbContext.cs:26-45` before doing anything else.

- [ ] **Step 4: Replace `Up()` and `Down()` with the contract's SQL**

Replace the whole body of
`src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_MultiBusinessMembership.cs` with:

```csharp
﻿using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PeakPower.Persistence.Migrations
{
    /// <summary>
    /// Migration 15: one login, several businesses, a role in each.
    /// <para>
    /// <c>customer.customer_membership</c> becomes the sole answer to "which company does this
    /// account belong to" and "does it administer that company", both of which were columns on
    /// <c>customer_account</c>. The statement ORDER in this file is normative (shared contract
    /// section 4) and is not an accident: the preference column is added before anything writes to
    /// it, the table and its policies exist before the backfill, the three policies that DEPEND on
    /// <c>customer_account.customer_id</c> are re-pointed before that column is dropped, and the
    /// drop is last.
    /// </para>
    /// <para>
    /// ⚠ Dropping the column before the policies are re-pointed errors on dependent objects, and
    /// <c>CASCADE</c> would silently drop all three - leaving <c>customer_account</c> with row-level
    /// security enabled and NO policy, so every authenticated request 401s because the session
    /// middleware's own account read returns nothing.
    /// </para>
    /// <para>
    /// Hand-written raw SQL rather than a scaffolded migration: <c>CreateTable</c> cannot emit the
    /// table-level CHECK, and nothing in <c>MigrationBuilder</c> emits <c>CREATE FUNCTION</c>,
    /// <c>GRANT</c>, <c>REVOKE</c> or <c>CREATE POLICY</c>. Half of each would leave a reader unable
    /// to tell which half is authoritative.
    /// </para>
    /// </summary>
    public partial class MultiBusinessMembership : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // -----------------------------------------------------------------------------------
            // 1. The preference column, BEFORE anything writes to it.
            //
            // ⚠ The name is load-bearing. Both row-level-security coverage guards discover tenancy
            // keys by suffix - right(column_name, 11) = 'customer_id' in the catalogue and
            // Name.EndsWith("CustomerId") in the EF model - so the obvious name, last_customer_id,
            // would keep customer_account inside tenancy discovery keyed on something that is NOT a
            // tenancy key, after step 8 drops the real one. A guard that reports coverage it does
            // not have is worse than a guard that fails.
            //
            // Nullable, deliberately: an account that has never switched has no preference, and
            // sign-in then falls back to the OLDEST membership by created_at (design section 5).
            // -----------------------------------------------------------------------------------
            migrationBuilder.Sql(
                """
                ALTER TABLE customer.customer_account ADD COLUMN last_active_business_id uuid NULL
                    REFERENCES customer.customer(id);
                """);

            // -----------------------------------------------------------------------------------
            // 2. The membership table.
            //
            // The primary key is the PAIR, not a surrogate: one person is in one business at most
            // once. That is what makes re-inviting somebody who was removed a matter of clearing
            // removed_at rather than inserting a row the key would refuse with 23505.
            //
            // ⚠ removed_at is not bookkeeping - it is what makes removal safe. A membership is
            // NEVER deleted; see the REVOKE in step 3.
            //
            // The role values are LOWER CASE, against the grain of every other enum column in this
            // schema, and customer.is_admin_of below compares against 'admin'. The C# side bends to
            // match: CustomerMembershipConfiguration declares an explicit value converter, which is
            // ConfigurationSource.Explicit and beats EnumToTextConvention's SCREAMING_SNAKE one.
            //
            // ON DELETE CASCADE to the account (a membership is meaningless without its person, the
            // same reasoning refresh_token uses) and ON DELETE RESTRICT to the business (deleting a
            // company out from under its members is not something this schema should make easy).
            //
            // The index on customer_id is not decoration: the composite key leads on account_id, so
            // it cannot serve plan 4's member list or its admin floor count, both of which read
            // WHERE customer_id = @active.
            // -----------------------------------------------------------------------------------
            migrationBuilder.Sql(
                """
                CREATE TABLE customer.customer_membership (
                    account_id  uuid NOT NULL REFERENCES customer.customer_account(id) ON DELETE CASCADE,
                    customer_id uuid NOT NULL REFERENCES customer.customer(id)         ON DELETE RESTRICT,
                    role        text NOT NULL CHECK (role IN ('admin', 'trader', 'viewer')),
                    created_at  timestamptz NOT NULL,
                    removed_at  timestamptz NULL,
                    CONSTRAINT pk_customer_membership PRIMARY KEY (account_id, customer_id)
                );

                CREATE INDEX ix_customer_membership_customer_id
                    ON customer.customer_membership (customer_id);
                """);

            // -----------------------------------------------------------------------------------
            // 3. Grants, the admin predicate and both policies. Shared contract section 5, verbatim.
            //
            // ⚠ REVOKE ALL FIRST. Migration 2's
            //     ALTER DEFAULT PRIVILEGES IN SCHEMA customer, metering, wallet, audit
            //         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
            //         TO app_customer_role, app_employee_role
            // (20260827092246_TenancyRowLevelSecurity.cs:110-112) fired the instant CREATE TABLE ran
            // above, so this table ALREADY carries arwd for both roles. Enumerating what it should
            // have does not remove what it must not - which is exactly how customer.refresh_token
            // sat on a DELETE grant its own migration never asked for.
            //
            // ⚠ NO DELETE GRANT, EVER, TO EITHER ROLE. Postgres evaluates WITH CHECK for INSERT and
            // for an UPDATE's new row and NEVER for DELETE, which USING alone governs - and this
            // USING has an OR account_id = me arm so the business switcher can read across
            // businesses. With DELETE granted, a plain viewer acting for B could run
            //     DELETE FROM customer.customer_membership WHERE customer_id = <B>
            // and wipe every membership in B including its admins, and anyone could run
            //     DELETE FROM customer.customer_membership WHERE account_id = <self>
            // to drop their memberships in businesses their token does not even name. No policy can
            // close that. Removal is an UPDATE setting removed_at, which WITH CHECK does guard.
            //
            // app_employee_role needs INSERT and UPDATE, not just SELECT: the F12 back-office
            // account surface is in scope and it writes memberships - creating a customer account
            // with a company is an INSERT and changing its role is an UPDATE - and both run as
            // app_employee_role, where a SELECT-only grant fails with 42501.
            //
            // ⚠ SECURITY DEFINER is what makes the admin predicate legal at all: a policy ON
            // customer_membership that subqueried customer_membership directly raises "infinite
            // recursion detected in policy". SET search_path is not decoration - a SECURITY DEFINER
            // function with a mutable search_path lets the CALLER choose which
            // customer_membership the body means.
            //
            // ⚠ The permissive OR in USING does NOT scope a count. The account_id arm makes the
            // caller's memberships in OTHER businesses visible while acting for this one, which is
            // exactly what the switcher needs and exactly what makes plan 4's admin floor count
            // exploitable if it trusts RLS: an admin of a four-eyes business who also self-registers
            // a shell business where she is sole admin would see a count of two where the business
            // has one. Every admin-surface query must carry an explicit AND customer_id = @active.
            // -----------------------------------------------------------------------------------
            migrationBuilder.Sql(
                """
                ALTER TABLE customer.customer_membership ENABLE ROW LEVEL SECURITY;
                REVOKE ALL ON customer.customer_membership FROM app_customer_role, app_employee_role;
                GRANT SELECT, INSERT, UPDATE ON customer.customer_membership TO app_customer_role;
                GRANT SELECT, INSERT, UPDATE ON customer.customer_membership TO app_employee_role;

                CREATE FUNCTION customer.is_admin_of(account uuid, business uuid) RETURNS boolean
                    LANGUAGE sql SECURITY DEFINER STABLE
                    SET search_path = customer, pg_temp AS $fn$
                    SELECT EXISTS (SELECT 1 FROM customer.customer_membership
                                   WHERE account_id = account AND customer_id = business
                                     AND role = 'admin' AND removed_at IS NULL) $fn$;
                REVOKE EXECUTE ON FUNCTION customer.is_admin_of(uuid, uuid) FROM PUBLIC;
                GRANT  EXECUTE ON FUNCTION customer.is_admin_of(uuid, uuid) TO app_customer_role;

                CREATE POLICY customer_customer_membership_tenant_isolation ON customer.customer_membership
                    FOR ALL TO app_customer_role
                    USING      (account_id  = NULLIF(current_setting('app.account_id',  true), '')::uuid
                             OR customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
                    WITH CHECK (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid
                            AND customer.is_admin_of(NULLIF(current_setting('app.account_id', true), '')::uuid,
                                                     NULLIF(current_setting('app.customer_id', true), '')::uuid));

                CREATE POLICY customer_customer_membership_back_office ON customer.customer_membership
                    FOR ALL TO app_employee_role USING (true) WITH CHECK (true);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Roll forward only. The deployed DatabaseMigrator calls only MigrateAsync, so this
            // never runs in the shipped path; it is written correctly because a developer may run
            // `dotnet ef database update <earlier>` by hand, and nothing may RELY on it.
            //
            // The grants are revoked explicitly rather than left to DROP TABLE. Dropping the table
            // does remove them, but migration 2's ALTER DEFAULT PRIVILEGES is still standing, so a
            // re-run of Up() lands on a freshly granted table again - which is what the REVOKE ALL
            // up there is for, and saying so here keeps the pair readable together.
            migrationBuilder.Sql(
                """
                DROP POLICY IF EXISTS customer_customer_membership_back_office
                    ON customer.customer_membership;
                DROP POLICY IF EXISTS customer_customer_membership_tenant_isolation
                    ON customer.customer_membership;
                REVOKE ALL ON customer.customer_membership FROM app_customer_role, app_employee_role;
                DROP TABLE IF EXISTS customer.customer_membership;
                DROP FUNCTION IF EXISTS customer.is_admin_of(uuid, uuid);
                ALTER TABLE customer.customer_account DROP COLUMN IF EXISTS last_active_business_id;
                """);
        }
    }
}
```

⚠ The dollar-quote tag is `$fn$` and not `$$`. The contract writes `$$`; inside a C# raw string
literal either works, but `$fn$` matches the house precedent
(`20260908080123_CustomerEntitlements.cs:143`) and survives a future nested dollar-quote. This is a
lexical detail of the same statement, not a change to it.

- [ ] **Step 5: Move the three ordered-migration-list literals**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs`,
rename the method at `:32` — before:

```csharp
    public void The_migrations_are_InitialSchema_then_TenancyRowLevelSecurity_then_AuthAndOnboarding_then_AccountTokenForeignKeys_then_EanPool_then_OnboardingTradeName_then_EmployeeIdentity_then_EmployeeSessions_then_IngestionAndIntervalData_then_EmployeePasswordReset_then_CustomerEntitlements_then_DayAheadPrices_then_EanPoolReleaseGrant_then_DayAheadPriceSource_in_that_order()
```

after:

```csharp
    public void The_migrations_are_InitialSchema_then_TenancyRowLevelSecurity_then_AuthAndOnboarding_then_AccountTokenForeignKeys_then_EanPool_then_OnboardingTradeName_then_EmployeeIdentity_then_EmployeeSessions_then_IngestionAndIntervalData_then_EmployeePasswordReset_then_CustomerEntitlements_then_DayAheadPrices_then_EanPoolReleaseGrant_then_DayAheadPriceSource_then_MultiBusinessMembership_in_that_order()
```

and, inside it, replace `:39` and append one line after `:53` — before:

```csharp
        migrationIds.Length.ShouldBe(14);
```

after:

```csharp
        migrationIds.Length.ShouldBe(15);
```

before:

```csharp
        migrationIds[13].ShouldEndWith("_DayAheadPriceSource");
    }
```

after:

```csharp
        migrationIds[13].ShouldEndWith("_DayAheadPriceSource");
        migrationIds[14].ShouldEndWith("_MultiBusinessMembership");
    }
```

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs`,
replace `:32` and append one line after `:46` — before:

```csharp
        applied.Length.ShouldBe(14);
```

after:

```csharp
        applied.Length.ShouldBe(15);
```

before:

```csharp
        applied[13].ShouldEndWith("_DayAheadPriceSource");
    }
```

after:

```csharp
        applied[13].ShouldEndWith("_DayAheadPriceSource");
        applied[14].ShouldEndWith("_MultiBusinessMembership");
    }
```

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh`, replace lines `51-60`
— before:

```bash
  *_InitialSchema\|*_TenancyRowLevelSecurity\|*_AuthAndOnboarding\|*_AccountTokenForeignKeys\|*_EanPool\|*_OnboardingTradeName\|*_EmployeeIdentity\|*_EmployeeSessions\|*_IngestionAndIntervalData\|*_EmployeePasswordReset\|*_CustomerEntitlements\|*_DayAheadPrices\|*_EanPoolReleaseGrant\|*_DayAheadPriceSource\|) ;;
  *) fail "expected __EFMigrationsHistory to contain, in order, a migration ending _InitialSchema " \
       "then one ending _TenancyRowLevelSecurity then one ending _AuthAndOnboarding then one " \
       "ending _AccountTokenForeignKeys then one ending _EanPool then one ending " \
       "_OnboardingTradeName then one ending _EmployeeIdentity then one ending _EmployeeSessions " \
       "then one ending _IngestionAndIntervalData then one ending _EmployeePasswordReset then " \
       "one ending _CustomerEntitlements then one ending _DayAheadPrices then one ending " \
       "_EanPoolReleaseGrant - found: " \
       "$history_ids" ;;
esac
```

after:

```bash
  *_InitialSchema\|*_TenancyRowLevelSecurity\|*_AuthAndOnboarding\|*_AccountTokenForeignKeys\|*_EanPool\|*_OnboardingTradeName\|*_EmployeeIdentity\|*_EmployeeSessions\|*_IngestionAndIntervalData\|*_EmployeePasswordReset\|*_CustomerEntitlements\|*_DayAheadPrices\|*_EanPoolReleaseGrant\|*_DayAheadPriceSource\|*_MultiBusinessMembership\|) ;;
  *) fail "expected __EFMigrationsHistory to contain, in order, a migration ending _InitialSchema " \
       "then one ending _TenancyRowLevelSecurity then one ending _AuthAndOnboarding then one " \
       "ending _AccountTokenForeignKeys then one ending _EanPool then one ending " \
       "_OnboardingTradeName then one ending _EmployeeIdentity then one ending _EmployeeSessions " \
       "then one ending _IngestionAndIntervalData then one ending _EmployeePasswordReset then " \
       "one ending _CustomerEntitlements then one ending _DayAheadPrices then one ending " \
       "_EanPoolReleaseGrant then one ending _DayAheadPriceSource then one ending " \
       "_MultiBusinessMembership - found: " \
       "$history_ids" ;;
esac
```

⚠ The old failure message stopped at `_EanPoolReleaseGrant` while the `case` pattern already listed
`_DayAheadPriceSource` — the message was one entry behind the pattern it explains. Both are correct
after this edit; that is a drive-by fix and it is named here so a reviewer is not surprised by it.

Append, immediately after the `esac` above, the privilege assertion migration 15 is really about:

```bash
# ⚠ The one privilege in this schema that CANNOT be guarded by a policy, asserted through the real
# migrator process rather than only in the test suite. Postgres evaluates WITH CHECK for INSERT and
# for an UPDATE's new row and never for DELETE, and migration 15's USING arm is deliberately
# permissive (OR account_id = me) so the business switcher can read across businesses - so a DELETE
# grant here would let a plain viewer wipe every membership in their business, admins included.
# Migration 2's ALTER DEFAULT PRIVILEGES grants it automatically on CREATE TABLE; only migration
# 15's REVOKE ALL takes it away, and a migration that granted without revoking first would leave no
# trace anywhere else.
membership_grants="$(docker exec "$container" psql --username postgres --dbname peakpower \
  --tuples-only --no-align --command \
  "SELECT grantee || '=' || string_agg(privilege_type, ',' ORDER BY privilege_type)
     FROM information_schema.role_table_grants
    WHERE table_schema = 'customer' AND table_name = 'customer_membership'
      AND grantee IN ('app_customer_role', 'app_employee_role')
    GROUP BY grantee ORDER BY grantee;" 2>/dev/null | tr '\n' '|')"
case "$membership_grants" in
  "app_customer_role=INSERT,SELECT,UPDATE|app_employee_role=INSERT,SELECT,UPDATE|") ;;
  *) fail "customer.customer_membership must grant exactly SELECT, INSERT and UPDATE to each " \
       "application role and DELETE to neither - found: $membership_grants" ;;
esac
```

- [ ] **Step 6: Move the two coverage-guard numbers and widen the model-side predicate**

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`,
replace `AutomaticPolicyCoverageTests.CustomerIdOwned` at `:719-722` — before:

```csharp
    private static bool CustomerIdOwned(IEntityType entityType) =>
        entityType.GetProperties()
            .Any(property => property.Name.EndsWith("CustomerId", StringComparison.Ordinal))
        || entityType.ClrType == typeof(Customer);
```

after:

```csharp
    private static bool CustomerIdOwned(IEntityType entityType) =>
        entityType.GetProperties()
            .Any(property => property.Name.EndsWith("CustomerId", StringComparison.Ordinal))
        || entityType.ClrType == typeof(Customer)
        || entityType.ClrType == typeof(CustomerAccount);
```

⚠ `CustomerAccount` is named explicitly here for the same reason `Customer` always has been: it does
not key on a `CustomerId` column. Today it still has one; migration 15 step 8 (Task 17) drops it,
and without this clause the entity carrying `password_hash` and `security_stamp` would fall out of
this guard silently at that moment - the pinned totals staying arithmetically right while a table
lost its coverage is precisely what shared contract §9 item 2 warns about. Added now, before the
drop, so the clause is proved by an existing green suite rather than introduced in the same commit
that would have hidden the regression.

Replace `:768-769` — before:

```csharp
        customerIdOwned.Length.ShouldBe(12);
        accountIdOwned.Length.ShouldBe(2);
```

after:

```csharp
        // Thirteen since migration 15's CustomerMembership. ⚠ CustomerAccount is counted by BOTH
        // arms of CustomerIdOwned today - it still has a CustomerId property AND is named
        // explicitly - and by the explicit arm alone once task 17 drops the column. A single Where
        // over entity types cannot double-count it, so this number does not move again.
        customerIdOwned.Length.ShouldBe(13);
        accountIdOwned.Length.ShouldBe(2);
```

Replace `:789` — before:

```csharp
        customerOwned.Length.ShouldBe(12);
```

after:

```csharp
        // Thirteen: migration 2's five, migration 3's refresh_token and password_reset_token,
        // migration 9's four, migration 10's customer_entitlement and migration 15's
        // customer_membership. onboarding_application and metering.ean_pool are discovered above
        // but exempt, so neither raises this number. ⚠ customer_membership is NOT exempt here even
        // though it IS exempt from the layer-1 query-filter requirement - it carries a real
        // customer_id and a real policy pair; what it cannot carry is a filter of this DbContext's
        // usual shape, because the switcher must read across businesses.
        customerOwned.Length.ShouldBe(13);
```

Replace `CatalogPolicyCoverageTests`' numbers at `:1050-1051` — before:

```csharp
        customerIdTables.Count.ShouldBe(12);
        accountIdTables.Count.ShouldBe(2);
```

after:

```csharp
        // Thirteen since migration 15 created customer.customer_membership, which carries a real
        // customer_id column.
        customerIdTables.Count.ShouldBe(13);
        accountIdTables.Count.ShouldBe(2);
```

and `:1070` — before:

```csharp
        tables.Count.ShouldBe(12);
```

after:

```csharp
        tables.Count.ShouldBe(13);
```

- [ ] **Step 7: Run everything and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo > /tmp/task3-after.txt 2>&1; tail -30 /tmp/task3-after.txt
tools/verify-migrator.sh
```

Expected: build clean; the **whole** integration suite green — the red window Task 2 opened is
closed here; `verify-migrator.sh` green, twice (it runs the migrator twice itself).

⚠ **The whole existing suite staying green is the test for this task's additive half.** Nothing
observable has changed: no policy that existed before behaves differently, no column has been
dropped, no code reads the new table. The only new behaviour is what `MembershipSchemaTests` asserts
directly.

- [ ] **Step 8: Mutate the `REVOKE ALL`, then the `search_path`**

Delete one clause from the migration's step 3 — the `REVOKE ALL` line — and re-run against a fresh
container (Testcontainers builds one per run, so no manual cleanup is needed):

```csharp
                ALTER TABLE customer.customer_membership ENABLE ROW LEVEL SECURITY;
                -- MUTATION: REVOKE ALL ON customer.customer_membership FROM app_customer_role, app_employee_role;
                GRANT SELECT, INSERT, UPDATE ON customer.customer_membership TO app_customer_role;
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~The_role_holds_exactly_SELECT_INSERT_and_UPDATE_and_never_DELETE"`

Expected: FAIL, **both** cases:

```
privileges
    should be
"INSERT,SELECT,UPDATE"
    but was
"DELETE,INSERT,SELECT,UPDATE"
```

followed by `app_customer_role must hold exactly SELECT, INSERT and UPDATE…`. That is the hole
demonstrated: `ALTER DEFAULT PRIVILEGES` handed both roles `DELETE` and the enumerated `GRANT` did
not take it away. ⚠ Note that `verify-migrator.sh` would catch the same thing independently —
Step 5's new `case` block — which is the point of asserting it in two places that share no code.

Restore the line. Now mutate the `search_path` instead — the "simplification" somebody makes when a
`SET` clause looks like noise:

```csharp
                CREATE FUNCTION customer.is_admin_of(account uuid, business uuid) RETURNS boolean
                    LANGUAGE sql SECURITY DEFINER STABLE
                    AS $fn$
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~The_admin_predicate_is_SECURITY_DEFINER_with_a_pinned_search_path"`

Expected: FAIL —

```
actual
    should be
"true:s:search_path=customer, pg_temp"
    but was
"true:s:NONE"
```

`proconfig` is `NULL` for a function with no `SET`, and the `coalesce` is what turns that into a
readable `NONE` rather than a null-versus-empty puzzle. Restore, then prove the restore:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git diff --stat src/Infrastructure/PeakPower.Persistence/Migrations/
```

Expected: only the two new files and the snapshot appear as *untracked/modified* in `git status`;
`git diff --stat` prints nothing for the migration file itself if you have not staged it yet, so
confirm with `git status --short src/Infrastructure/PeakPower.Persistence/Migrations/` and re-read
the `Up()` body to see both mutations gone.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence/Migrations \
        tools/verify-migrator.sh \
        tests/PeakPower.Integration.Tests/Migrations/MembershipSchemaTests.cs \
        tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs \
        tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs \
        tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs
git commit -m "feat(persistence): migration 15 creates customer_membership with both policies and no DELETE grant

Shared contract sections 4 and 5, transcribed. Additive and reversible: both old columns
stay, nothing reads the new table, and the whole existing suite staying green is the test
for that half.

The REVOKE ALL is the protection, not tidiness. Migration 2's ALTER DEFAULT PRIVILEGES
hands both application roles full DML the instant CREATE TABLE runs; verified by mutation -
deleting the REVOKE leaves app_customer_role holding DELETE, which no policy can guard,
because Postgres evaluates WITH CHECK for INSERT and for an UPDATE's new row and never for
DELETE. A viewer acting for B could then have wiped every membership in B, admins included.

customer.is_admin_of is SECURITY DEFINER because a policy on customer_membership that
subqueried customer_membership raises infinite recursion; its search_path is pinned because
a SECURITY DEFINER function with a mutable one lets the caller choose which table the body
means. Deleting the SET clause is verified to turn the schema test red.

AutomaticPolicyCoverageTests.CustomerIdOwned now names CustomerAccount explicitly, ahead of
the column drop, so the entity carrying password_hash does not fall out of the guard
silently later.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: Migration 15, steps 4–6 — the backfill, the first-admin repair, and the preference column

Three `UPDATE`/`INSERT` statements, and one of them departs from a written requirement on purpose.

⚠ **`[F13-R41]` forbids by name a *"first account of a company is admin"* rule.** The backfill sets
`role = 'admin'` from `is_admin`, which defaults false — so a company whose accounts are all
non-admin gets **no admin membership at all**, violating decision 7's floor on the day this deploys
and leaving a business that can never invite anyone, because every admin verb plan 4 ships is
`CompanyAdmin`-gated. The repair promotes the oldest active account of any admin-less company and
**writes an `audit.audit_record` for each promotion**, so the departure from R41 is auditable rather
than silent. Companies with zero active accounts are left alone and named in the migration's output.

⚠ **Deviation D1 applies to both statements in this task.** `customer.customer_account` has no
`created_at` column — verified against `20260827051436_InitialSchema.cs:95-124`, whose columns are
`id, customer_id, username, first_name, last_name, job_title, email, phone, status, is_admin,
password_hash, security_stamp, external_subject_id, last_login_at`, and against
`PeakPowerDbContextModelSnapshot.cs:152-228` after migration 9 dropped `external_subject_id`.
Contract §4 step 4 selects `created_at` from it and §4.1 orders by it; both are `42703` as written.
So the membership's own `created_at` is `now()`, and "oldest" orders by `a.id`, which is a UUIDv7
(`CustomerAccount.cs:83`, `Guid.CreateVersion7()`) whose leading 48 bits are a millisecond timestamp
in the same byte order PostgreSQL's `uuid` comparison uses. Step 1 proves that ordering picks the
oldest of three rather than asserting it.

⚠ **A migration that ran once does not run again.** These statements only ever see rows that existed
*before* migration 15 applied. `TenancyFixture` and `PostgresFixture` migrate a fresh, **empty**
container and then seed, so neither of them exercises a single line of this task — the backfill is a
no-op there, and a test written against those fixtures would be green over a deleted statement. The
test below therefore runs its own container, migrates to migration **14**, inserts rows in raw SQL,
and only then migrates to 15.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_MultiBusinessMembership.cs` (append to `Up()`, after step 3's block)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MembershipBackfillTests.cs` (create)

**Interfaces:**
- Consumes: the table, the index, the grants and both policies (Task 3); migration 1's
  `audit.audit_record` (`id, occurred_at, actor, action, entity_type, entity_id, customer_id,
  before, after` — `20260827051436_InitialSchema.cs:37-54`).
- Produces: one membership row per pre-existing account; the actor literal `system:migration-15` on
  every promotion audit record; `last_active_business_id` populated for every pre-existing account.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MembershipBackfillTests.cs`:

```csharp
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;
using Shouldly;
using Testcontainers.PostgreSql;
using Xunit;

namespace PeakPower.Integration.Tests.Migrations;

/// <summary>
/// Migration 15 steps 4-6, against rows that existed BEFORE it ran.
/// <para>
/// ⚠ This class runs its own container and cannot use <c>PostgresFixture</c> or
/// <c>TenancyFixture</c>, and the reason is the whole point of the test. Both of those migrate a
/// fresh, EMPTY database all the way to the latest migration and only then seed, so migration 15's
/// backfill sees zero accounts there and every assertion about it would be green over a deleted
/// statement. Here the database is migrated to migration 14, rows are inserted in raw SQL, and only
/// then is migration 15 applied - which is the only arrangement in which the backfill has anything
/// to do.
/// </para>
/// <para>
/// Everything is inserted in raw SQL rather than through EF, deliberately: at migration 14 the
/// model this assembly compiles against no longer matches the schema (it knows about
/// <c>customer_membership</c> and <c>last_active_business_id</c>, which do not exist yet), so an EF
/// save would fail on columns the database has not got.
/// </para>
/// </summary>
public sealed class MembershipBackfillTests : IAsyncLifetime
{
    /// <summary>The actor migration 15's first-admin repair writes. One string, three readers.</summary>
    private const string MigrationActor = "system:migration-15";

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:17")
        .WithDatabase("peakpower")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .Build();

    // Fixed ids, and their ORDER matters: "oldest" is ORDER BY a.id, because customer_account has
    // no created_at column and CustomerAccount.Create mints a UUIDv7 whose leading 48 bits are a
    // millisecond timestamp in the byte order PostgreSQL's uuid comparison uses. The three accounts
    // of company B below are numbered so the OLDEST is unambiguous.
    private static readonly Guid CompanyA = Guid.Parse("0199a1a0-0000-7000-8000-0000000015a0");
    private static readonly Guid CompanyB = Guid.Parse("0199a1a0-0000-7000-8000-0000000015b0");
    private static readonly Guid CompanyC = Guid.Parse("0199a1a0-0000-7000-8000-0000000015c0");

    private static readonly Guid AdminOfA = Guid.Parse("0199a1a0-0000-7000-8000-0000000015a1");
    private static readonly Guid PlainOfA = Guid.Parse("0199a1a0-0000-7000-8000-0000000015a2");

    private static readonly Guid OldestOfB = Guid.Parse("0199a1a0-0000-7000-8000-0000000015b1");
    private static readonly Guid MiddleOfB = Guid.Parse("0199a1a0-0000-7000-8000-0000000015b2");
    private static readonly Guid NewestOfB = Guid.Parse("0199a1a0-0000-7000-8000-0000000015b3");

    private static readonly Guid DeactivatedOfC = Guid.Parse("0199a1a0-0000-7000-8000-0000000015c1");

    private string ConnectionString => _container.GetConnectionString();

    public async ValueTask InitializeAsync()
    {
        await _container.StartAsync();

        var migrationIds = Migrations();
        var migrationFourteen = migrationIds.Single(id => id.EndsWith("_DayAheadPriceSource", StringComparison.Ordinal));
        var migrationFifteen = migrationIds.Single(id => id.EndsWith("_MultiBusinessMembership", StringComparison.Ordinal));

        await using (var toFourteen = Context())
        {
            await toFourteen.GetService<IMigrator>().MigrateAsync(migrationFourteen);
        }

        await SeedPreMigrationRowsAsync();

        await using (var toFifteen = Context())
        {
            await toFifteen.GetService<IMigrator>().MigrateAsync(migrationFifteen);
        }
    }

    public async ValueTask DisposeAsync() => await _container.DisposeAsync();

    private PeakPowerDbContext Context()
    {
        var options = new DbContextOptionsBuilder<PeakPowerDbContext>();
        PersistenceServiceCollectionExtensions.ConfigureDbContext(options, ConnectionString);
        return new PeakPowerDbContext(options.Options, new UnscopedCustomerContext());
    }

    private string[] Migrations()
    {
        using var context = Context();
        return context.Database.GetMigrations().ToArray();
    }

    /// <summary>
    /// Three companies that between them cover every branch of steps 4 and 5: one that already has
    /// an admin, one that has none and three active accounts, and one whose only account is
    /// deactivated.
    /// </summary>
    private async Task SeedPreMigrationRowsAsync()
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();

        await using var command = new NpgsqlCommand(
            """
            INSERT INTO customer.customer
                (id, legal_name, kvk_number, status, billing_address, primary_contact, locale)
            VALUES
                (@companyA, 'Zonneweide Beheer B.V.', '81000101', 'ACTIVE',
                 '{"Street":"Havenweg","HouseNumber":"12","PostalCode":"3011 AA","City":"Rotterdam","Country":"NL"}',
                 '{"Name":"Els Bakker","Email":"els@example.test"}', 'nl-NL'),
                (@companyB, 'Windkracht Noord B.V.', '81000102', 'ACTIVE',
                 '{"Street":"Havenweg","HouseNumber":"14","PostalCode":"3011 AA","City":"Rotterdam","Country":"NL"}',
                 '{"Name":"Els Bakker","Email":"els@example.test"}', 'nl-NL'),
                (@companyC, 'Stilte Energie B.V.', '81000103', 'ACTIVE',
                 '{"Street":"Havenweg","HouseNumber":"16","PostalCode":"3011 AA","City":"Rotterdam","Country":"NL"}',
                 '{"Name":"Els Bakker","Email":"els@example.test"}', 'nl-NL');

            INSERT INTO customer.customer_account
                (id, customer_id, username, first_name, last_name, email, status, is_admin, security_stamp)
            VALUES
                (@adminOfA, @companyA, 'a.admin',  'Anneke', 'de Vries', 'a.admin@example.test',  'ACTIVE', true,  gen_random_uuid()),
                (@plainOfA, @companyA, 'a.plain',  'Bram',   'Jansen',   'a.plain@example.test',  'ACTIVE', false, gen_random_uuid()),
                (@oldestB,  @companyB, 'b.oldest', 'Chantal','Smit',     'b.oldest@example.test', 'ACTIVE', false, gen_random_uuid()),
                (@middleB,  @companyB, 'b.middle', 'Daan',   'Peters',   'b.middle@example.test', 'ACTIVE', false, gen_random_uuid()),
                (@newestB,  @companyB, 'b.newest', 'Eva',    'Mulder',   'b.newest@example.test', 'ACTIVE', false, gen_random_uuid()),
                (@deadC,    @companyC, 'c.gone',   'Femke',  'Vos',      'c.gone@example.test',   'DEACTIVATED', false, gen_random_uuid());
            """,
            connection);

        command.Parameters.AddWithValue("companyA", CompanyA);
        command.Parameters.AddWithValue("companyB", CompanyB);
        command.Parameters.AddWithValue("companyC", CompanyC);
        command.Parameters.AddWithValue("adminOfA", AdminOfA);
        command.Parameters.AddWithValue("plainOfA", PlainOfA);
        command.Parameters.AddWithValue("oldestB", OldestOfB);
        command.Parameters.AddWithValue("middleB", MiddleOfB);
        command.Parameters.AddWithValue("newestB", NewestOfB);
        command.Parameters.AddWithValue("deadC", DeactivatedOfC);

        await command.ExecuteNonQueryAsync();
    }

    private async Task<string?> ScalarAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        var value = await command.ExecuteScalarAsync();
        return value is null or DBNull ? null : Convert.ToString(value, CultureInfo.InvariantCulture);
    }

    [Fact]
    public async Task Every_pre_existing_account_got_exactly_one_membership_in_its_own_company()
    {
        // Six accounts in, six memberships out, each naming the company its account named. Compared
        // as a count of MISMATCHES rather than as a total, so a backfill that produced six rows all
        // pointing at one company fails here rather than passing a count.
        (await ScalarAsync(
            """
            SELECT count(*)::text FROM customer.customer_account a
            WHERE NOT EXISTS (
                SELECT 1 FROM customer.customer_membership m
                WHERE m.account_id = a.id AND m.customer_id = a.customer_id)
            """)).ShouldBe("0");

        (await ScalarAsync("SELECT count(*)::text FROM customer.customer_membership")).ShouldBe("6");
    }

    [Fact]
    public async Task An_account_that_was_is_admin_became_an_admin_and_the_rest_became_traders()
    {
        (await ScalarAsync(
            $"SELECT role FROM customer.customer_membership WHERE account_id = '{AdminOfA}'"))
            .ShouldBe("admin");

        (await ScalarAsync(
            $"SELECT role FROM customer.customer_membership WHERE account_id = '{PlainOfA}'"))
            .ShouldBe("trader", Case.Sensitive);
    }

    [Fact]
    public async Task A_company_with_no_admin_gets_its_OLDEST_ACTIVE_account_promoted_and_nobody_else()
    {
        // The [F13-R41] departure, and the assertion that makes it narrow: exactly one of company
        // B's three accounts is an admin, and it is the oldest. A repair that promoted all three -
        // the obvious mistake, because the correlated UPDATE's WHERE runs per row - passes a
        // "company B has an admin" assertion and fails this one.
        (await ScalarAsync(
            $"""
            SELECT string_agg(account_id::text, ',' ORDER BY account_id)
            FROM customer.customer_membership
            WHERE customer_id = '{CompanyB}' AND role = 'admin'
            """)).ShouldBe(OldestOfB.ToString());
    }

    [Fact]
    public async Task A_company_whose_only_account_is_deactivated_is_left_alone()
    {
        // No active account means nobody may be promoted, and the migration says so in its output
        // rather than inventing an admin. The membership row still exists - the account is
        // deactivated, not absent - it is just a trader.
        (await ScalarAsync(
            $"""
            SELECT role FROM customer.customer_membership
            WHERE customer_id = '{CompanyC}'
            """)).ShouldBe("trader");

        (await ScalarAsync(
            $"""
            SELECT count(*)::text FROM customer.customer_membership
            WHERE customer_id = '{CompanyC}' AND role = 'admin'
            """)).ShouldBe("0");
    }

    [Fact]
    public async Task Every_promotion_wrote_an_audit_record_naming_the_migration_actor()
    {
        // ⚠ [F13-R41] forbids a "first account of a company is admin" rule by name. This migration
        // needs one anyway, or a company with no admin can never invite anybody, because every
        // admin verb is CompanyAdmin-gated. The audit row is what makes the departure reviewable
        // instead of silent, so it is asserted as a row rather than trusted to a comment.
        (await ScalarAsync(
            $"""
            SELECT actor || '|' || action || '|' || entity_type || '|' ||
                   entity_id::text || '|' || customer_id::text
            FROM audit.audit_record
            WHERE actor = '{MigrationActor}'
            """)).ShouldBe(
            $"{MigrationActor}|MEMBERSHIP_ROLE_CHANGED|CustomerMembership|{OldestOfB}|{CompanyB}");

        // Exactly one, not "at least one": company A already had an admin and company C had no
        // active account, so a migration that audited every membership rather than every promotion
        // fails here.
        (await ScalarAsync(
            $"SELECT count(*)::text FROM audit.audit_record WHERE actor = '{MigrationActor}'"))
            .ShouldBe("1");
    }

    [Fact]
    public async Task The_preference_column_was_backfilled_from_the_column_it_is_about_to_replace()
    {
        (await ScalarAsync(
            """
            SELECT count(*)::text FROM customer.customer_account
            WHERE last_active_business_id IS DISTINCT FROM customer_id
            """)).ShouldBe(
            "0",
            "sign-in lands in the business last used, and for an account that predates the switcher " +
            "the only honest answer is the one company it was in");
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MembershipBackfillTests" > /tmp/task4-before.txt 2>&1; cat /tmp/task4-before.txt`

Expected: FAIL, six tests, and every failure is "the statement is not there" rather than "it did the
wrong thing":

- `Every_pre_existing_account_got_exactly_one_membership_in_its_own_company`: the first assertion
  fails with `should be "0" but was "6"` — every account is missing a membership.
- `An_account_that_was_is_admin_became_an_admin_and_the_rest_became_traders`: `should be "admin" but
  was null` — `ExecuteScalarAsync` over no rows returns null.
- `A_company_with_no_admin_gets_its_OLDEST_ACTIVE_account_promoted_and_nobody_else`: `should be
  "0199a1a0-0000-7000-8000-0000000015b1" but was null`.
- `A_company_whose_only_account_is_deactivated_is_left_alone`: `should be "trader" but was null`.
- `Every_promotion_wrote_an_audit_record_naming_the_migration_actor`: `should be
  "system:migration-15|MEMBERSHIP_ROLE_CHANGED|…" but was null`.
- `The_preference_column_was_backfilled_from_the_column_it_is_about_to_replace`: `should be "0" but
  was "6"` — the column exists (Task 3 added it) and is null on every row.

⚠ If instead the whole class errors in `InitializeAsync` with
`Sequence contains no matching element`, the migration name in Task 3 was not
`MultiBusinessMembership`. Fix the name rather than the test.

- [ ] **Step 3: Append steps 4–6 to the migration**

In `src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_MultiBusinessMembership.cs`, append
inside `Up()`, after step 3's `migrationBuilder.Sql(...)` block:

```csharp
            // -----------------------------------------------------------------------------------
            // 4. Backfill: one membership per existing account.
            //
            // ⚠ created_at is now() and NOT the account's own creation moment, because
            // customer.customer_account HAS NO created_at COLUMN - verified against
            // 20260827051436_InitialSchema.cs:95-124, whose columns are id, customer_id, username,
            // first_name, last_name, job_title, email, phone, status, is_admin, password_hash,
            // security_stamp, external_subject_id (dropped by migration 9) and last_login_at. The
            // shared contract's step 4 selects a created_at that does not exist; now() is the
            // honest substitute, because "this membership was created by the migration, at
            // migration time" is a true statement and an invented per-account timestamp is not.
            //
            // is_admin defaults false, so a company whose accounts are all non-admin gets NO admin
            // membership here. Step 5 is the repair; without it, decision 7's floor is violated on
            // deploy and that business can never invite anybody, because every admin verb plan 4
            // ships is CompanyAdmin-gated.
            // -----------------------------------------------------------------------------------
            migrationBuilder.Sql(
                """
                INSERT INTO customer.customer_membership (account_id, customer_id, role, created_at)
                SELECT id, customer_id, CASE WHEN is_admin THEN 'admin' ELSE 'trader' END, now()
                FROM customer.customer_account;
                """);

            // -----------------------------------------------------------------------------------
            // 5. First-admin repair, and its audit trail.
            //
            // ⚠ [F13-R41] forbids a "first account of a company is admin" rule BY NAME. This
            // migration needs one anyway - see step 4 - so the departure is made auditable rather
            // than silent: every promotion writes an audit.audit_record naming a migration actor,
            // and the RAISE NOTICE at the end lists any company that could not be repaired.
            //
            // ⚠ ORDER BY a.id, not a.created_at: see step 4 for why that column does not exist.
            // CustomerAccount.Create mints Guid.CreateVersion7(), whose leading 48 bits are a
            // millisecond timestamp laid out in exactly the byte order PostgreSQL's uuid comparison
            // uses - so ordering by the primary key IS creation order for every account this
            // application has ever created. It is a proxy and it is named as one here.
            //
            // Written as PL/pgSQL rather than as the contract's single correlated UPDATE for one
            // reason: the audit rows. A plain UPDATE cannot also insert one audit record per
            // promoted row, and a second statement recomputing "which ones did I just promote"
            // after the fact would be a different query that could disagree with the first.
            // -----------------------------------------------------------------------------------
            migrationBuilder.Sql(
                """
                DO $repair$
                DECLARE
                    business  uuid;
                    promoted  uuid;
                    orphaned  text;
                BEGIN
                    FOR business IN
                        SELECT DISTINCT m.customer_id
                        FROM customer.customer_membership m
                        WHERE NOT EXISTS (SELECT 1 FROM customer.customer_membership x
                                          WHERE x.customer_id = m.customer_id AND x.role = 'admin')
                    LOOP
                        SELECT a.id INTO promoted
                        FROM customer.customer_account a
                        JOIN customer.customer_membership m2
                          ON m2.account_id = a.id AND m2.customer_id = business
                        WHERE a.status = 'ACTIVE'
                        ORDER BY a.id
                        LIMIT 1;

                        IF promoted IS NULL THEN
                            CONTINUE;
                        END IF;

                        UPDATE customer.customer_membership
                        SET role = 'admin'
                        WHERE account_id = promoted AND customer_id = business;

                        INSERT INTO audit.audit_record
                            (occurred_at, actor, action, entity_type, entity_id, customer_id, before, after)
                        VALUES
                            (now(), 'system:migration-15', 'MEMBERSHIP_ROLE_CHANGED',
                             'CustomerMembership', promoted, business,
                             '{"role":"trader"}'::jsonb, '{"role":"admin"}'::jsonb);
                    END LOOP;

                    -- A company with no ACTIVE account cannot be repaired and must not be invented
                    -- an admin for. Named in the migrator's output so it is a known state rather
                    -- than a surprise the first time somebody tries to invite into it.
                    SELECT string_agg(DISTINCT m.customer_id::text, ', ')
                    INTO orphaned
                    FROM customer.customer_membership m
                    WHERE NOT EXISTS (SELECT 1 FROM customer.customer_membership x
                                      WHERE x.customer_id = m.customer_id AND x.role = 'admin');

                    IF orphaned IS NOT NULL THEN
                        RAISE NOTICE
                            'migration 15: these businesses have no active account and therefore no admin: %',
                            orphaned;
                    END IF;
                END
                $repair$;
                """);

            // -----------------------------------------------------------------------------------
            // 6. Backfill the preference column.
            //
            // Sign-in lands in the business last used (design section 5). For an account that
            // predates the switcher the only honest answer is the one company it was ever in, so
            // this is a straight copy - and it has to happen while customer_id is still there,
            // which is why step 8's drop is last.
            // -----------------------------------------------------------------------------------
            migrationBuilder.Sql(
                "UPDATE customer.customer_account SET last_active_business_id = customer_id;");
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MembershipBackfillTests"
```

Expected: build clean; PASS, six tests.

Then confirm nothing else moved:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo > /tmp/task4-full.txt 2>&1; tail -20 /tmp/task4-full.txt
```

Expected: green. Steps 4–6 are writes to a table nothing reads yet, so **the whole existing suite
staying green is the test** that they disturbed nothing.

- [ ] **Step 5: Mutate the repair's `LIMIT 1` away, then its `status = 'ACTIVE'`**

Delete the `LIMIT 1` from the repair's inner `SELECT … INTO promoted`:

```sql
                        SELECT a.id INTO promoted
                        FROM customer.customer_account a
                        JOIN customer.customer_membership m2
                          ON m2.account_id = a.id AND m2.customer_id = business
                        WHERE a.status = 'ACTIVE'
                        ORDER BY a.id;
                        -- MUTATION: LIMIT 1 removed
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MembershipBackfillTests"`

Expected: **PASS**, all six — and that is a real finding rather than a failed mutation. PL/pgSQL's
`SELECT … INTO` takes the **first** row and discards the rest without erroring, so `LIMIT 1` is
documentation here rather than behaviour. It is kept because the day somebody turns this into a
plain `UPDATE … WHERE account_id = (SELECT …)` the sub-select **does** need it — a scalar sub-query
returning three rows raises `21000 more than one row returned by a subquery used as an expression`.
Written down rather than deleted, because a reader who removes it later will not have run this
experiment. Restore it.

Now mutate the case the test is actually named for — drop the `status = 'ACTIVE'` filter:

```sql
                        WHERE true
                        -- MUTATION: a.status = 'ACTIVE' removed
```

Run the same command.
Expected: **one** failure, `A_company_whose_only_account_is_deactivated_is_left_alone`:

```
    should be
"trader"
    but was
"admin"
```

followed by the second assertion never running. Company C's deactivated account is promoted, which
is exactly the state `[F13-R41]` is protecting against — an admin nobody can sign in as.
⚠ `A_company_with_no_admin_gets_its_OLDEST_ACTIVE_account_promoted_and_nobody_else` stays **green**
under this mutation, because all three of company B's accounts are active. One test moving and one
not is what proves the deactivated case has its own coverage rather than riding on the neighbouring
assertion.

Restore, and prove the ordering claim is load-bearing too — change `ORDER BY a.id` to
`ORDER BY a.id DESC`:

Expected: **one** failure,
`A_company_with_no_admin_gets_its_OLDEST_ACTIVE_account_promoted_and_nobody_else`:

```
    should be
"0199a1a0-0000-7000-8000-0000000015b1"
    but was
"0199a1a0-0000-7000-8000-0000000015b3"
```

which is the proof that the UUIDv7 ordering substitution actually orders, rather than the test
passing because there happened to be only one candidate. Restore and confirm:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -c "ORDER BY a.id$" src/Infrastructure/PeakPower.Persistence/Migrations/*_MultiBusinessMembership.cs > /tmp/task4-restore.txt
grep -c "a.status = 'ACTIVE'" src/Infrastructure/PeakPower.Persistence/Migrations/*_MultiBusinessMembership.cs >> /tmp/task4-restore.txt
cat /tmp/task4-restore.txt
```

Expected: `1` and `1`, read from the file.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence/Migrations \
        tests/PeakPower.Integration.Tests/Migrations/MembershipBackfillTests.cs
git commit -m "feat(persistence): migration 15 backfills memberships and repairs admin-less companies

One membership per pre-existing account, role from is_admin, then the [F13-R41] departure
made auditable: a company whose accounts are all non-admin gets its oldest active account
promoted and an audit.audit_record naming system:migration-15. Without that repair the
floor is violated on deploy and that business can never invite anybody, because every admin
verb is CompanyAdmin-gated. Companies with no active account are left alone and named in
the migrator's output.

Two substitutions the shared contract's SQL needs and does not have:
customer.customer_account HAS NO created_at column (verified against InitialSchema and the
model snapshot), so the membership's created_at is now() and "oldest" is ORDER BY a.id -
Guid.CreateVersion7 lays a millisecond timestamp in the leading 48 bits, in the byte order
Postgres compares uuids in. Flagged for the contract owner.

Tested against its own container, migrated to migration 14 and seeded in raw SQL before 15
applies: TenancyFixture and PostgresFixture migrate an EMPTY database, so every assertion
about a backfill would be green there over a deleted statement. Verified by mutation -
dropping status = 'ACTIVE' promotes a deactivated account, and ORDER BY a.id DESC promotes
the newest.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 5: Every path that creates an account now also writes a membership

Migration 15's backfill covered every account that existed when it ran. Nothing has yet been taught
to write a membership for an account created **after** it. That is invisible today and fatal at
Task 8: the moment `customer_account`'s policy becomes an `EXISTS` over `customer_membership`, an
account with no membership is invisible to `app_customer_role` — its own sign-in 401s, and every
fixture that seeded one goes red at once, in a commit whose subject line is about a policy.

So the writes land here, while both columns still exist, both facts are still written, and nothing
reads the new table. **The whole existing suite staying green is the test for the additive half**;
the new assertions are the test for the membership half.

⚠ `CustomerAccount.Memberships` is read-only from outside on purpose. A seed adds to
`db.CustomerMemberships`, never to `account.Memberships`. EF orders the account before its membership
because the relationship is declared (Task 2), so one `SaveChangesAsync` is enough and no explicit
ordering is needed.

⚠ **The employee create endpoint is touched twice.** Here it gains the membership write and keeps
`request.IsAdmin`; Task 16 is where `IsAdmin` leaves its wire contract and the role becomes the
request's own field. Splitting it that way keeps this commit purely additive.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingService.cs:420-435`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Employee/Endpoints/AccountEndpoints.cs:85-108`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs:159-166`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/TestMemberships.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/CustomerApiFactory.cs:157-196`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/TenancyFixture.cs:47-78`, `:183-227`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs:415-442`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/AuthSchemaTests.cs:133-157`, `:420-445`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/CompanyEndpointTests.cs:53-70`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/SignOutTests.cs:145-170`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Onboarding/OnboardingMaterialisationTests.cs:265-272`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs` (append), `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Onboarding/OnboardingMaterialisationTests.cs` (append), `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Employee/AccountEndpointTests.cs` (append)

**Interfaces:**
- Consumes: `CustomerMembership.Create(Guid, Guid, MembershipRole, DateTimeOffset)`;
  `PeakPowerDbContext.CustomerMemberships`; `IMarketCalendar.UtcNow` (already injected into
  `OnboardingService` and available to the employee endpoint by adding a parameter).
- Produces: `PeakPower.Integration.Tests.Tenancy.TestMemberships.Active(Guid accountId, Guid customerId, MembershipRole role)`
  — the one seam every fixture in this assembly uses, so Task 17 changes one file rather than nine.

- [ ] **Step 1: Write the failing tests**

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Onboarding/OnboardingMaterialisationTests.cs`,
inside the existing class:

```csharp
    [Fact]
    public async Task Signing_gives_the_first_account_an_ADMIN_membership_of_the_new_company()
    {
        // [F13-R23] has no owner account: owning is being an admin. The first account of a company
        // therefore has to be an admin membership, and not because a "first account is admin" rule
        // fires later - [F13-R41] forbids that by name - but because this is the one moment the
        // platform knows it is creating a company and the person who signed for it in one breath.
        var ct = TestContext.Current.CancellationToken;
        var (applicationId, code, _) = await ReadyToSignAsync(bankVerified: true);

        using var scope = factory.Services.CreateScope();
        var result = await Service(scope).SignAsync(applicationId, code, agreedDocuments: true, ct);

        result.IsSuccess.ShouldBeTrue(result.Error);

        await using var db = factory.CreateOwnerDbContext();
        var membership = await db.CustomerMemberships
            .SingleAsync(m => m.AccountId == result.Value.AccountId, ct);

        membership.CustomerId.ShouldBe(result.Value.CustomerId);
        membership.Role.ShouldBe(MembershipRole.Admin);
        membership.RemovedAt.ShouldBeNull();
    }
```

⚠ **The helper is `ReadyToSignAsync(bool bankVerified)`**, at
`OnboardingMaterialisationTests.cs:55` — `private async Task<(Guid ApplicationId, string Code, string Kvk)>`.
It drives the aggregate to `AwaitingSignature`, persists it, and hands back the raw six-digit code;
the third element is a fresh KvK number this test does not need, hence the `_`. Do not add a second
arrangement helper: this class is an `IClassFixture<CustomerApiFactory>`, so every `[Fact]` shares
one database, and `FreshKvkNumber()` inside `ReadyToSignAsync` is what stops a second `SignAsync`
colliding on `ix_customer_kvk_number` (23505) — a real failure this file's own doc comment records.

⚠ `SignAsync` returns a `Result` whose `.Value` carries `CustomerId` and `AccountId`
(`Signing_creates_the_company_the_account_and_the_wallet:99-125` reads them exactly this way), so
this test needs no `OnboardingApplications` read at all. `Service(scope)` at `:94` is the existing
`scope.ServiceProvider.GetRequiredService<OnboardingService>()` shorthand.

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs`,
inside the existing class:

```csharp
    [Fact]
    public async Task Every_seeded_person_has_exactly_one_membership_of_their_own_company()
    {
        // The demo database is the one anybody actually looks at. An account with no membership is
        // invisible to its own sign-in once task 8 re-points the policy, so this is not a tidiness
        // assertion - it is the demo working at all.
        await using var db = Fixture.CreateContext();
        var ct = TestContext.Current.CancellationToken;

        var accountsWithoutMembership = await db.CustomerAccounts
            .Where(account => !db.CustomerMemberships.Any(m => m.AccountId == account.Id))
            .CountAsync(ct);

        accountsWithoutMembership.ShouldBe(0);

        // And the admin flag became an admin ROLE rather than being dropped on the floor.
        var admins = await db.CustomerMemberships
            .Where(m => m.Role == MembershipRole.Admin)
            .Select(m => m.CustomerId)
            .Distinct()
            .CountAsync(ct);

        var companies = await db.Customers.CountAsync(ct);
        admins.ShouldBe(companies, "every seeded company has at least one admin");
    }
```

⚠ `Fixture` is whatever this class already calls its `PostgresFixture`; read `:1-40` and use the
existing name.

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Employee/AccountEndpointTests.cs`,
inside the existing class:

```csharp
    [Fact]
    public async Task Creating_an_account_through_the_back_office_also_creates_its_membership()
    {
        var ct = TestContext.Current.CancellationToken;
        var customerId = await SeedCustomerAsync(ct);
        var username = $"{Guid.NewGuid():N}@example.test";

        var request = new CreateAccountRequest(
            username, "Nina", "Vos", "Analyst", username, null, IsAdmin: true);

        var response = await Client.PostAsJsonAsync(
            $"/api/v1/customers/{customerId}/accounts", request, ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Created);

        var created = await response.Content.ReadFromJsonAsync<AccountDto>(ct);

        await using var db = Factory.CreateOwnerDbContext();
        var membership = await db.CustomerMemberships
            .SingleAsync(m => m.AccountId == created!.Id, ct);

        membership.CustomerId.ShouldBe(customerId);
        membership.Role.ShouldBe(
            MembershipRole.Admin,
            "the back office asked for an admin, and admin is now a membership role rather than a " +
            "column on the account");
    }
```

⚠ `SeedCustomerAsync`, `Client` and `Factory` are whatever this class already calls them; read
`:1-80` and use the existing names rather than introducing new ones.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~Signing_gives_the_first_account_an_ADMIN_membership_of_the_new_company|FullyQualifiedName~Every_seeded_person_has_exactly_one_membership_of_their_own_company|FullyQualifiedName~Creating_an_account_through_the_back_office_also_creates_its_membership" > /tmp/task5-before.txt 2>&1; cat /tmp/task5-before.txt`

Expected: FAIL, three tests.

- `Signing_gives_the_first_account_an_ADMIN_membership_of_the_new_company`:
  `System.InvalidOperationException : Sequence contains no elements` from `SingleAsync`.
- `Every_seeded_person_has_exactly_one_membership_of_their_own_company`:
  `accountsWithoutMembership should be 0 but was 9` (the seeder's person count — read the number
  the run actually prints rather than trusting this one; what matters is that it is not zero).
- `Creating_an_account_through_the_back_office_also_creates_its_membership`:
  `System.InvalidOperationException : Sequence contains no elements`.

- [ ] **Step 3: Write the membership beside the account, in the three production paths**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingService.cs`,
replace lines `420-436` — before:

```csharp
            var account = CustomerAccount.Create(
                customerId: customer.Id,
                username: trackedApplication.Email,
                firstName: trackedApplication.FirstName,
                lastName: trackedApplication.LastName,
                jobTitle: null,
                email: trackedApplication.Email,
                phone: null,
                status: AccountStatus.Active,
                isAdmin: true).Value;   // the first account has to be able to administer the company
            account.SetPassword(trackedApplication.PasswordHash);

            var wallet = Wallet.CreateEuroWallet(customer.Id).Value;

            db.Customers.Add(customer);
            db.CustomerAccounts.Add(account);
            db.Wallets.Add(wallet);
```

after:

```csharp
            var account = CustomerAccount.Create(
                customerId: customer.Id,
                username: trackedApplication.Email,
                firstName: trackedApplication.FirstName,
                lastName: trackedApplication.LastName,
                jobTitle: null,
                email: trackedApplication.Email,
                phone: null,
                status: AccountStatus.Active,
                isAdmin: true).Value;   // the first account has to be able to administer the company
            account.SetPassword(trackedApplication.PasswordHash);

            // The same fact as isAdmin: true above, written where it will still be true after
            // migration 15 drops that column. [F13-R23] has no owner account - owning is being an
            // admin - and this is the one moment the platform knows it is creating a company and
            // the person who signed for it in the same breath, which is why this is NOT the "first
            // account of a company is admin" rule [F13-R41] forbids: nothing is being inferred
            // after the fact.
            var membership = CustomerMembership.Create(
                account.Id, customer.Id, MembershipRole.Admin, now).Value;

            var wallet = Wallet.CreateEuroWallet(customer.Id).Value;

            db.Customers.Add(customer);
            db.CustomerAccounts.Add(account);
            db.CustomerMemberships.Add(membership);
            db.Wallets.Add(wallet);
```

⚠ `now` is the local this method already holds for `MarkSigned(customer.Id, account.Id, now)` a few
lines below. If the name differs in the file as it stands, use whatever it is — the requirement is
that the moment comes from `IMarketCalendar` and not from `DateTimeOffset.UtcNow`, which
architecture fact 5 confines to `PeakPower.Infrastructure.Time` and an IL scan enforces.

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Employee/Endpoints/AccountEndpoints.cs`,
replace the signature at `:53-57` — before:

```csharp
    private static async Task<IResult> CreateAsync(
        Guid customerId,
        CreateAccountRequest request,
        PeakPowerDbContext db,
        CancellationToken cancellationToken)
```

after:

```csharp
    private static async Task<IResult> CreateAsync(
        Guid customerId,
        CreateAccountRequest request,
        PeakPowerDbContext db,
        IMarketCalendar calendar,
        CancellationToken cancellationToken)
```

and replace `:106-108` — before:

```csharp
        var account = created.Value;

        db.CustomerAccounts.Add(account);
```

after:

```csharp
        var account = created.Value;

        // The membership is the account's tenancy from migration 15 onwards; the customerId route
        // segment is where the back office says which business it means, exactly as it always has.
        // Written here rather than left to task 16 so that this commit is purely additive - both
        // facts are recorded, and nothing reads the new one yet.
        //
        // This runs as app_employee_role, whose back-office policy on customer_membership is
        // USING (true) WITH CHECK (true) - the tenant-isolation policy's is_admin_of term does not
        // apply to it, which is why shared contract section 5 grants that role INSERT and UPDATE
        // rather than SELECT alone.
        db.CustomerAccounts.Add(account);
        db.CustomerMemberships.Add(CustomerMembership.Create(
            account.Id,
            customerId,
            request.IsAdmin ? MembershipRole.Admin : MembershipRole.Trader,
            calendar.UtcNow).Value);
```

adding the using the file now needs, after `:5`:

```csharp
using PeakPower.Application.Abstractions;
```

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs`,
replace `:159-166` — before:

```csharp
                var account = Unwrap(CustomerAccount.Create(
                    customer.Id, person.Email, person.First, person.Last,
                    person.JobTitle, person.Email, phone: null,
                    AccountStatus.Active, person.IsAdmin));

                account.SetPassword(passwordHash);
                db.CustomerAccounts.Add(account);
```

after:

```csharp
                var account = Unwrap(CustomerAccount.Create(
                    customer.Id, person.Email, person.First, person.Last,
                    person.JobTitle, person.Email, phone: null,
                    AccountStatus.Active, person.IsAdmin));

                account.SetPassword(passwordHash);
                db.CustomerAccounts.Add(account);

                // The demo database is the one anybody actually looks at, and from task 8 onwards
                // an account with no membership cannot see itself: customer_account's policy
                // becomes an EXISTS over customer_membership, so the very first sign-in 401s.
                db.CustomerMemberships.Add(Unwrap(CustomerMembership.Create(
                    account.Id,
                    customer.Id,
                    person.IsAdmin ? MembershipRole.Admin : MembershipRole.Trader,
                    SeedMoment)));
```

and add the constant the seeder needs, immediately after `SeederActor` at `:56`:

```csharp

    /// <summary>
    /// The moment every seeded membership records. A fixed literal rather than a clock: this
    /// assembly may not read the system clock (architecture fact 5 confines that to
    /// <c>PeakPower.Infrastructure.Time</c>, IL-enforced), the seeder takes no
    /// <c>IMarketCalendar</c>, and a demo row's exact timestamp carries no meaning. It is
    /// deliberately BEFORE any plausible test moment so that ordering assertions elsewhere are not
    /// accidentally sensitive to when the demo was seeded.
    /// </summary>
    private static readonly DateTimeOffset SeedMoment =
        new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
```

- [ ] **Step 4: Give the test assembly one seam, and use it in every fixture**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/TestMemberships.cs`:

```csharp
using PeakPower.Domain.Customers;

namespace PeakPower.Integration.Tests.Tenancy;

/// <summary>
/// The one place this assembly builds a membership for a seeded account.
/// <para>
/// Nine fixtures across seven files create a <see cref="CustomerAccount"/> and persist it. From
/// task 8 onwards every one of them also needs a membership, or the account is invisible to
/// <c>app_customer_role</c> - <c>customer_account</c>'s policy becomes an <c>EXISTS</c> over
/// <c>customer_membership</c> - and the failure surfaces as an unrelated 401 in whichever test
/// happens to sign in first. Routing all nine through one method means task 17's column drop
/// changes one file rather than nine, and means a fixture that forgot is visible as a call site
/// that is missing rather than as a subtly different inline expression.
/// </para>
/// </summary>
internal static class TestMemberships
{
    /// <summary>
    /// A live membership. The moment is a fixed literal rather than a clock: nothing in these
    /// tests asserts on it, and a fixed value keeps two accounts seeded in the same test from
    /// differing only by microseconds.
    /// </summary>
    public static readonly DateTimeOffset SeededAt =
        new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    public static CustomerMembership Active(
        Guid accountId, Guid customerId, MembershipRole role = MembershipRole.Trader) =>
        CustomerMembership.Create(accountId, customerId, role, SeededAt).Value;
}
```

Now add one line to each seeding fixture. Every edit is the same shape — an
`Add(TestMemberships.Active(...))` beside the existing `CustomerAccounts.Add(...)`, before the
`SaveChangesAsync` — so they are listed rather than repeated in full.

| File | Edit |
| --- | --- |
| `tests/PeakPower.Integration.Tests/CustomerApiFactory.cs:194` | after `db.CustomerAccounts.Add(account);` add `db.CustomerMemberships.Add(TestMemberships.Active(account.Id, customer.Id, isAdmin ? MembershipRole.Admin : MembershipRole.Trader));` |
| `tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs:435` | after `seed.CustomerAccounts.AddRange(a.Account, b.Account);` add `seed.CustomerMemberships.AddRange(TestMemberships.Active(a.Account.Id, a.Customer.Id), TestMemberships.Active(b.Account.Id, b.Customer.Id));` |
| `tests/PeakPower.Integration.Tests/Migrations/AuthSchemaTests.cs:147` | after `db.CustomerAccounts.AddRange(accountA, accountB);` add `db.CustomerMemberships.AddRange(TestMemberships.Active(accountA.Id, customerA.Id, MembershipRole.Admin), TestMemberships.Active(accountB.Id, customerB.Id));` |
| `tests/PeakPower.Integration.Tests/Migrations/AuthSchemaTests.cs:434` | the same two lines against `accountA`/`accountB` in `SeedTwoAccountsWithBothTokenKindsAsync` |
| `tests/PeakPower.Integration.Tests/Portal/CompanyEndpointTests.cs:68` | after `db.CustomerAccounts.Add(colleague);` add `db.CustomerMemberships.Add(TestMemberships.Active(colleague.Id, customerId));` |
| `tests/PeakPower.Integration.Tests/Auth/SignOutTests.cs:166` | after `db.CustomerAccounts.Add(account);` add `db.CustomerMemberships.Add(TestMemberships.Active(account.Id, customerId));` |
| `tests/PeakPower.Integration.Tests/Onboarding/OnboardingMaterialisationTests.cs:272` | after `setup.CustomerAccounts.Add(otherAccount);` add `setup.CustomerMemberships.Add(TestMemberships.Active(otherAccount.Id, otherCustomer.Id));` |

Each file needs `using PeakPower.Domain.Customers;` (most already have it) and
`using PeakPower.Integration.Tests.Tenancy;` — except the two files already in that namespace, which
need neither.

`TenancyFixture` gets more than one line, because Task 6, Task 7 and Task 10 all need a person who
is a member of **two** businesses. Replace `:183-227` — before:

```csharp
        var accountA = CustomerAccount.Create(
            companyA.Id, "a.devries", "Anneke", "de Vries", "Finance",
            "anneke.devries@zonneweidebeheer.example", null,
            AccountStatus.Active, isAdmin: true).Value;
        var accountB = CustomerAccount.Create(
            companyB.Id, "b.jansen", "Bram", "Jansen", "Operations",
            "bram.jansen@windkrachtnoord.example", null,
            AccountStatus.Invited, isAdmin: false).Value;
        db.CustomerAccounts.AddRange(accountA, accountB);
```

after:

```csharp
        var accountA = CustomerAccount.Create(
            companyA.Id, "a.devries", "Anneke", "de Vries", "Finance",
            "anneke.devries@zonneweidebeheer.example", null,
            AccountStatus.Active, isAdmin: true).Value;
        var accountB = CustomerAccount.Create(
            companyB.Id, "b.jansen", "Bram", "Jansen", "Operations",
            "bram.jansen@windkrachtnoord.example", null,
            AccountStatus.Invited, isAdmin: false).Value;

        // ⚠ The person this whole design exists for: a TRADER in company A who is also a member of
        // company B. Every probe from task 6 onwards needs her - the escalation probe acts as her,
        // the removal probe acts as her, and the cross-tenant account-reach probe is about company
        // B's admin trying to rewrite her password hash while she is also in A. Her account row
        // itself is REACHABLE from both businesses once customer_account's policy becomes an
        // EXISTS over membership, which is the overlap that partition-shaped tenancy never had.
        var sharedAccount = CustomerAccount.Create(
            companyA.Id, "s.dubois", "Sofie", "Dubois", "Trading",
            "sofie.dubois@zonneweidebeheer.example", null,
            AccountStatus.Active, isAdmin: false).Value;

        db.CustomerAccounts.AddRange(accountA, accountB, sharedAccount);

        // accountA administers A, accountB administers B, and Sofie is an ordinary member of both -
        // a TRADER in A and a VIEWER in B. Each company has exactly one admin and it is not Sofie,
        // which is what lets the escalation probe act as a genuine non-admin and the cross-tenant
        // account-reach probe act as a genuine admin of the OTHER business.
        db.CustomerMemberships.AddRange(
            TestMemberships.Active(accountA.Id, companyA.Id, MembershipRole.Admin),
            TestMemberships.Active(accountB.Id, companyB.Id, MembershipRole.Admin),
            TestMemberships.Active(sharedAccount.Id, companyA.Id),
            TestMemberships.Active(sharedAccount.Id, companyB.Id, MembershipRole.Viewer));
```

and expose the new id, adding after `:63` (`public Guid CompanyAAccountId { get; private set; }`):

```csharp

    /// <summary>
    /// An account that is a member of BOTH companies - a trader in A and a viewer in B. The one
    /// row that makes membership-shaped tenancy different from the column-shaped tenancy it
    /// replaces: under the old model two companies' reachable account sets were disjoint, and
    /// under this one they OVERLAP. Every probe from task 6 onwards is about that overlap.
    /// </summary>
    public Guid SharedAccountId { get; private set; }
```

and set it in `SeedAsync` beside the other assignments, after `:213`
(`CompanyBAccountId = accountB.Id;`):

```csharp
        SharedAccountId = sharedAccount.Id;
```

- [ ] **Step 5: Run everything and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln --nologo > /tmp/task5-after.txt 2>&1; tail -30 /tmp/task5-after.txt
```

Expected: build clean; the **whole solution** green, including the three new tests.

⚠ `RowLevelSecurityTests.the_customer_role_sees_only_the_rows_of_the_customer_it_declared` compares
what the customer role sees against `OwnerRowsForTenantAsync`, which counts
`WHERE customer_id = @tenantId` on the owner connection. Sofie's account row carries
`customer_id = companyA` (she was created there), so company A's count goes from one to two on both
sides and the test stays green. That symmetry is the reason that test compares against an owner
count rather than the literal `1` it used to pin — and it is why adding a third account to the
fixture is safe here and would not have been two migrations ago.

- [ ] **Step 6: Mutate the onboarding write away, then the seeder's**

Comment out the membership `Add` in `OnboardingService`:

```csharp
            db.Customers.Add(customer);
            db.CustomerAccounts.Add(account);
            // MUTATION: db.CustomerMemberships.Add(membership);
            db.Wallets.Add(wallet);
```

The local `membership` is then unused, which is a `warnaserror` build failure and would prove
nothing — so delete its declaration too:

```csharp
            // MUTATION: var membership = CustomerMembership.Create(...) removed as well, or the
            // unused local fails the build and the mutation proves nothing about the assertion.
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~Signing_gives_the_first_account_an_ADMIN_membership_of_the_new_company"`

Expected: FAIL — `System.InvalidOperationException : Sequence contains no elements`, thrown from
`db.CustomerMemberships.SingleAsync`. ⚠ Every other onboarding test stays green, which is the
finding: today nothing else in the suite can tell whether a membership was written, and that is
exactly why this assertion had to be added in the same commit as the write.

Restore both lines. Now mutate the seeder's **role** rather than its presence — make every seeded
membership a trader:

```csharp
                db.CustomerMemberships.Add(Unwrap(CustomerMembership.Create(
                    account.Id,
                    customer.Id,
                    MembershipRole.Trader,   // MUTATION: person.IsAdmin ? Admin : Trader
                    SeedMoment)));
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~Every_seeded_person_has_exactly_one_membership_of_their_own_company"`

Expected: FAIL on the **second** assertion, not the first —

```
admins
    should be
3
    but was
0
```

followed by `every seeded company has at least one admin`. The first assertion is about presence and
cannot see a wrong role; the second is what makes the demo's admin screens reachable. Read the
company count the run actually prints rather than trusting the `3` here. Restore, and prove it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git diff --stat src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingService.cs \
                src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs
```

Expected: both files show a diff against `HEAD` (this task's real edits are in them and are not
committed yet). Confirm the mutations specifically are gone:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -c "MUTATION" src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingService.cs \
                   src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs \
  > /tmp/task5-restore.txt; cat /tmp/task5-restore.txt
```

Expected: `0` for both files.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingService.cs \
        src/Hosts/PeakPower.Api.Employee/Endpoints/AccountEndpoints.cs \
        src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs \
        tests/PeakPower.Integration.Tests
git commit -m "feat: write a membership wherever an account is created

Migration 15 backfilled every account that existed when it ran; nothing yet wrote one for
an account created afterwards. That is invisible today and fatal at the next task: once
customer_account's policy becomes an EXISTS over customer_membership, an account with no
membership cannot see itself, its own sign-in 401s, and every fixture that seeded one goes
red inside a commit about a policy.

Three production paths (onboarding's first account as an admin, the back-office create, the
demo seeder) and nine test fixtures, the latter routed through one TestMemberships seam so
task 17's column drop changes one file rather than nine. TenancyFixture also gains Sofie
Dubois, a member of BOTH companies - the overlap that membership-shaped tenancy has and
column-shaped tenancy never did, and the subject of every probe from here on.

Purely additive: both facts are written, nothing reads the new one, and the whole suite
staying green is the test for that half. Verified by mutation - removing the onboarding
write leaves every other onboarding test green, which is exactly why the assertion had to
land in the same commit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6: PROBE — escalation. A `trader` cannot promote herself, and the test asserts the grant and the `WITH CHECK`

Shared contract §11 names this probe and says exactly what it must prove: *"A `trader` cannot
`UPDATE … SET role='admin'` nor `INSERT` naming another company — asserting the **grant and the
`WITH CHECK`**, not the outcome."*

The distinction is the whole task. A test that only watched an `UPDATE` fail would stay green if
somebody "fixed" the problem by revoking `UPDATE` outright — which would also break removal, since
removal **is** an `UPDATE` of `removed_at`, and plan 4 would then be a `42501` nobody could explain.
So this class asserts three separate things: that `UPDATE` **is** granted, that the refusal
therefore came from the policy, and that an admin doing the identical statement **succeeds**.

⚠ No production code changes in this task. Task 3 shipped the policy; this is the probe that proves
it. The TDD cycle is inverted accordingly: the test is written, it passes, and then the *migration*
is mutated to show the test bites. A probe whose mutation step is skipped is decoration.

**Files:**
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs` (append the class `CustomerMembershipPolicyTests` at the end of the file)

**Interfaces:**
- Consumes: `TenancyFixture.CustomerRoleConnectionString`, `.OwnerConnectionString`, `.CompanyAId`,
  `.CompanyBId`, `.CompanyAAccountId`, `.SharedAccountId` (Task 5); the policy
  `customer_customer_membership_tenant_isolation` and the function `customer.is_admin_of` (Task 3).
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Write the test**

Append to the **end** of
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`,
after `PartitionPolicyCoverageTests`' closing brace:

```csharp

/// <summary>
/// The ESCALATION probe (shared contract section 11). An ordinary member cannot make herself an
/// admin, and cannot write a membership into a business her token does not name.
/// <para>
/// ⚠ These assert the GRANT and the WITH CHECK, not merely the outcome, and the difference is
/// what stops the suite certifying the wrong fix. A test that only watched an UPDATE fail would
/// stay green under <c>REVOKE UPDATE ON customer_membership FROM app_customer_role</c> - which
/// looks like a tightening and is a catastrophe, because REMOVAL is an UPDATE of
/// <c>removed_at</c>. Plan 4's removal endpoint would then be a 42501 with no explanation in any
/// test name. So: <see cref="The_customer_role_really_does_hold_UPDATE_so_the_refusals_below_are_the_policy"/>
/// pins the privilege, <see cref="An_ADMIN_can_run_the_very_statement_the_trader_was_refused"/>
/// pins that the statement itself is legal, and only then do the refusals mean what they say.
/// </para>
/// <para>
/// Every assertion connects as <c>peakpower_app</c>, never as the owner: row-level security does
/// not apply to a table's owner, so an owner connection passes every one of these regardless of
/// whether a single policy exists.
/// </para>
/// </summary>
[Collection(nameof(TenancyCollection))]
public sealed class CustomerMembershipPolicyTests
{
    private readonly TenancyFixture _fixture;

    public CustomerMembershipPolicyTests(TenancyFixture fixture) => _fixture = fixture;

    /// <summary>
    /// Opens a customer-role connection inside a transaction, with both settings declared exactly
    /// as CustomerSessionMiddleware declares them. Rolled back by the caller - this fixture's
    /// container is shared by every tenancy test in the collection.
    /// </summary>
    private async Task<(NpgsqlConnection Connection, NpgsqlTransaction Transaction)> ActingAsAsync(
        Guid accountId, Guid customerId, CancellationToken ct)
    {
        var connection = TenancyFixture.Connect(_fixture.CustomerRoleConnectionString);
        await connection.OpenAsync(ct);
        var transaction = await connection.BeginTransactionAsync(ct);

        await using var settings = new NpgsqlCommand(
            """
            SELECT set_config('app.account_id',  @accountId,  true),
                   set_config('app.customer_id', @customerId, true)
            """,
            connection,
            transaction);
        settings.Parameters.AddWithValue("accountId", accountId.ToString());
        settings.Parameters.AddWithValue("customerId", customerId.ToString());
        await settings.ExecuteNonQueryAsync(ct);

        return (connection, transaction);
    }

    [Fact]
    public async Task The_customer_role_really_does_hold_UPDATE_so_the_refusals_below_are_the_policy()
    {
        // The floor under this whole class. Without it, a REVOKE UPDATE - which would also break
        // removal, because removal IS an UPDATE of removed_at - satisfies every refusal below.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = TenancyFixture.Connect(_fixture.OwnerConnectionString);
        await connection.OpenAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT has_table_privilege('app_customer_role', 'customer.customer_membership', 'UPDATE')::text
                || ':' ||
                   has_table_privilege('app_customer_role', 'customer.customer_membership', 'INSERT')::text
            """,
            connection);

        ((string?)await command.ExecuteScalarAsync(ct)).ShouldBe(
            "true:true",
            "both writing verbs must be GRANTED, so that every refusal in this class is the " +
            "policy's WITH CHECK arm speaking and not a missing privilege. Removal is an UPDATE of " +
            "removed_at, so revoking UPDATE here would break plan 4 while making these tests pass");
    }

    [Fact]
    public async Task The_WITH_CHECK_arm_names_the_admin_predicate_and_the_USING_arm_does_not()
    {
        // Read out of pg_policies rather than inferred from behaviour, because the two arms fail
        // differently and silently: without is_admin_of in WITH CHECK a trader promotes herself,
        // and WITH is_admin_of in USING a trader cannot even READ her own membership - which the
        // request path does on every single request, so every non-admin would be locked out.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = TenancyFixture.Connect(_fixture.OwnerConnectionString);
        await connection.OpenAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT qual, with_check FROM pg_policies
            WHERE schemaname = 'customer' AND tablename = 'customer_membership'
              AND policyname = 'customer_customer_membership_tenant_isolation'
            """,
            connection);
        await using var reader = await command.ExecuteReaderAsync(ct);
        (await reader.ReadAsync(ct)).ShouldBeTrue();

        reader.GetString(1).ShouldContain("is_admin_of", Case.Sensitive);
        reader.GetString(0).ShouldNotContain("is_admin_of", Case.Sensitive);
    }

    [Fact]
    public async Task A_trader_cannot_promote_herself_in_her_own_business()
    {
        // Sofie is a trader in company A. The row is HERS, in the business her token names, so the
        // USING arm finds it and the tenancy half of WITH CHECK passes - only is_admin_of refuses
        // this. That is the case worth testing: a cross-tenant write is refused by three different
        // things at once and proves nothing about any of them.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.SharedAccountId, _fixture.CompanyAId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var update = new NpgsqlCommand(
                """
                UPDATE customer.customer_membership SET role = 'admin'
                WHERE account_id = @accountId AND customer_id = @customerId
                """,
                connection,
                transaction);
            update.Parameters.AddWithValue("accountId", _fixture.SharedAccountId);
            update.Parameters.AddWithValue("customerId", _fixture.CompanyAId);

            var thrown = await Should.ThrowAsync<PostgresException>(
                async () => await update.ExecuteNonQueryAsync(ct));

            thrown.SqlState.ShouldBe(
                PostgresErrorCodes.InsufficientPrivilege,
                "a trader promoting herself must be refused by the policy, not by a missing " +
                "grant - the previous test proves UPDATE is granted");
            thrown.MessageText.ShouldContain("row-level security policy", Case.Sensitive);

            await transaction.RollbackAsync(ct);
        }
    }

    [Fact]
    public async Task A_trader_cannot_change_a_COLLEAGUES_role_either()
    {
        // The same refusal from the other direction, and not a duplicate: the row above was hers,
        // this one is somebody else's in the same business. Both are inside the USING arm, so both
        // reach WITH CHECK, and only is_admin_of separates "may read" from "may write" here.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.SharedAccountId, _fixture.CompanyAId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var update = new NpgsqlCommand(
                """
                UPDATE customer.customer_membership SET role = 'viewer'
                WHERE account_id = @accountId AND customer_id = @customerId
                """,
                connection,
                transaction);
            update.Parameters.AddWithValue("accountId", _fixture.CompanyAAccountId);
            update.Parameters.AddWithValue("customerId", _fixture.CompanyAId);

            var thrown = await Should.ThrowAsync<PostgresException>(
                async () => await update.ExecuteNonQueryAsync(ct));

            thrown.SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege);
            await transaction.RollbackAsync(ct);
        }
    }

    [Fact]
    public async Task Nobody_can_INSERT_a_membership_into_a_business_their_token_does_not_name()
    {
        // Acting for A, an ADMIN of A tries to write a membership into B. Deliberately the admin
        // and not the trader: is_admin_of(adminOfA, A) is TRUE, so the admin half of WITH CHECK
        // passes and the refusal can only come from the tenancy half. A trader here would be
        // refused twice over and would prove neither.
        //
        // The account named is adminOfA, who has no membership in B at all, so the composite
        // primary key has nothing to say and cannot be what refuses the row.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.CompanyAAccountId, _fixture.CompanyAId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var insert = new NpgsqlCommand(
                """
                INSERT INTO customer.customer_membership (account_id, customer_id, role, created_at)
                VALUES (@accountId, @otherBusiness, 'admin', now())
                """,
                connection,
                transaction);
            insert.Parameters.AddWithValue("accountId", _fixture.CompanyAAccountId);
            insert.Parameters.AddWithValue("otherBusiness", _fixture.CompanyBId);

            var thrown = await Should.ThrowAsync<PostgresException>(
                async () => await insert.ExecuteNonQueryAsync(ct));

            thrown.SqlState.ShouldBe(
                PostgresErrorCodes.InsufficientPrivilege,
                "the WITH CHECK arm pins every write to app.customer_id. Without it, an admin of " +
                "one business could grant themselves any role in any other business in the system");
            thrown.MessageText.ShouldContain("row-level security policy", Case.Sensitive);

            await transaction.RollbackAsync(ct);
        }
    }

    [Fact]
    public async Task An_ADMIN_can_run_the_very_statement_the_trader_was_refused()
    {
        // The positive control, and the reason the negatives mean anything. Without it, REVOKE
        // UPDATE or a WITH CHECK of `false` passes every other test in this class.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.CompanyAAccountId, _fixture.CompanyAId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var update = new NpgsqlCommand(
                """
                UPDATE customer.customer_membership SET role = 'admin'
                WHERE account_id = @accountId AND customer_id = @customerId
                """,
                connection,
                transaction);
            update.Parameters.AddWithValue("accountId", _fixture.SharedAccountId);
            update.Parameters.AddWithValue("customerId", _fixture.CompanyAId);

            var affected = await update.ExecuteNonQueryAsync(ct);

            // Pinned to 1, not "did not throw": zero rows would mean the USING arm hid the target
            // and the WITH CHECK arm was never exercised at all, which passes just as quietly.
            affected.ShouldBe(1, "an admin of this business may change a member's role");

            await transaction.RollbackAsync(ct);
        }
    }

    [Fact]
    public async Task An_admin_of_ANOTHER_business_is_not_an_admin_here()
    {
        // is_admin_of takes both arguments for a reason. The account that administers A has no
        // membership in B at all, while company B does have an admin of its own - so "there is an
        // admin here" is true and "this caller is it" is false. Acting for B as the admin of A, the
        // tenancy half of WITH CHECK passes - app.customer_id IS B - and is_admin_of(adminOfA, B) is
        // what refuses. A predicate that only asked "is this person an admin anywhere" would let it
        // straight through.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.CompanyAAccountId, _fixture.CompanyBId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var update = new NpgsqlCommand(
                """
                UPDATE customer.customer_membership SET role = 'admin'
                WHERE account_id = @accountId AND customer_id = @customerId
                """,
                connection,
                transaction);
            update.Parameters.AddWithValue("accountId", _fixture.SharedAccountId);
            update.Parameters.AddWithValue("customerId", _fixture.CompanyBId);

            var thrown = await Should.ThrowAsync<PostgresException>(
                async () => await update.ExecuteNonQueryAsync(ct));

            thrown.SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege);
            await transaction.RollbackAsync(ct);
        }
    }

    [Fact]
    public async Task A_member_can_READ_her_membership_in_a_business_her_token_does_not_name()
    {
        // The permissive OR in USING, asserted as a REQUIREMENT rather than tolerated. Plan 2's
        // /auth/me and plan 3's switcher both need exactly this: Sofie, acting for A, must be able
        // to see that she is also in B, or the rail has nothing to draw.
        //
        // ⚠ It is also the reason plan 4's admin floor count must carry an explicit
        // AND customer_id = @active. Trusting RLS to scope that count is exploitable: an admin of a
        // four-eyes business who also self-registers a shell business where she is sole admin can
        // make the count read two when the business has one.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.SharedAccountId, _fixture.CompanyAId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var read = new NpgsqlCommand(
                """
                SELECT string_agg(customer_id::text, ',' ORDER BY customer_id)
                FROM customer.customer_membership
                WHERE account_id = @accountId
                """,
                connection,
                transaction);
            read.Parameters.AddWithValue("accountId", _fixture.SharedAccountId);

            var businesses = (string?)await read.ExecuteScalarAsync(ct);

            var expected = new[] { _fixture.CompanyAId, _fixture.CompanyBId }
                .OrderBy(id => id.ToString(), StringComparer.Ordinal)
                .Select(id => id.ToString());

            businesses.ShouldBe(
                string.Join(',', expected),
                "the switcher reads across businesses; a filter or policy that scoped this to the " +
                "active business would leave the rail with nothing to draw");

            await transaction.RollbackAsync(ct);
        }
    }
}
```

- [ ] **Step 2: Run the tests and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~CustomerMembershipPolicyTests"
```

Expected: PASS, eight tests. ⚠ They pass on the first run because Task 3 already shipped the policy
this class probes. That is not a broken TDD cycle — it is why Step 3 exists, and a probe that never
watched the thing it probes fail has proved nothing.

- [ ] **Step 3: Mutate the `WITH CHECK` arm, three ways**

**(a) Drop the admin term.** In migration 15's step-3 block, shorten the policy to what a reviewer
writes when `is_admin_of` looks like belt-and-braces:

```sql
                CREATE POLICY customer_customer_membership_tenant_isolation ON customer.customer_membership
                    FOR ALL TO app_customer_role
                    USING      (account_id  = NULLIF(current_setting('app.account_id',  true), '')::uuid
                             OR customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
                    WITH CHECK (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid);
                    -- MUTATION: the is_admin_of conjunct removed
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~CustomerMembershipPolicyTests" > /tmp/task6-mutant-a.txt 2>&1; cat /tmp/task6-mutant-a.txt`

Expected: **three** failures.
- `A_trader_cannot_promote_herself_in_her_own_business`:
  `Should.ThrowAsync<PostgresException>() … but no exception was thrown`. Sofie is an admin of
  company A now, and nothing anywhere said so.
- `A_trader_cannot_change_a_COLLEAGUES_role_either`: the same, from the other direction.
- `The_WITH_CHECK_arm_names_the_admin_predicate_and_the_USING_arm_does_not`:
  `with_check should contain "is_admin_of" but was "(customer_id = (NULLIF(current_setting('app.customer_id'::text, true), ''::text))::uuid)"`.

The last of those is the one that matters: two behavioural tests and one structural test going red
on one deletion is why the class asserts the policy text as well as the behaviour.

⚠ `An_admin_of_ANOTHER_business_is_not_an_admin_here` also fails under this mutation, for a fourth
failure — the admin of A writing into B is now allowed. If you see three rather than four, re-read
the mutation; you removed the tenancy term instead.

**(b) Drop the tenancy term instead**, keeping the admin one:

```sql
                    WITH CHECK (customer.is_admin_of(NULLIF(current_setting('app.account_id', true), '')::uuid,
                                                     NULLIF(current_setting('app.customer_id', true), '')::uuid));
                    -- MUTATION: the customer_id conjunct removed
```

Expected: **one** failure,
`Nobody_can_INSERT_a_membership_into_a_business_their_token_does_not_name` —
`but no exception was thrown`. An admin of A has just written an admin membership into company B.
Everything else stays green, which is what proves the two conjuncts have separate coverage rather
than one test standing in for both.

**(c) Move `is_admin_of` into `USING` as well** — the "surely reads should be symmetric" mistake:

```sql
                    USING      ((account_id  = NULLIF(current_setting('app.account_id',  true), '')::uuid
                             OR  customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
                             AND customer.is_admin_of(NULLIF(current_setting('app.account_id', true), '')::uuid,
                                                      NULLIF(current_setting('app.customer_id', true), '')::uuid))
```

Expected: **two** failures.
- `The_WITH_CHECK_arm_names_the_admin_predicate_and_the_USING_arm_does_not`:
  `qual should not contain "is_admin_of" but was …`.
- `A_member_can_READ_her_membership_in_a_business_her_token_does_not_name`:
  `businesses should be "<A>,<B>" but was null` — `string_agg` over zero rows. Sofie cannot see her
  own membership at all, which means the request path's step 3 would 401 every non-admin in the
  system on their very next request.

Restore the policy to the Task 3 text and confirm:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -c "is_admin_of" src/Infrastructure/PeakPower.Persistence/Migrations/*_MultiBusinessMembership.cs \
  > /tmp/task6-restore.txt
grep -c "MUTATION" src/Infrastructure/PeakPower.Persistence/Migrations/*_MultiBusinessMembership.cs \
  >> /tmp/task6-restore.txt
cat /tmp/task6-restore.txt
```

Expected: `4` (the `CREATE FUNCTION` name, the body's own reference, the `REVOKE`/`GRANT` pair
counts as two lines naming it, and the policy's `WITH CHECK` — read the number the file actually
gives and check it against a fresh `grep -n`), then `0`.

- [ ] **Step 4: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs
git commit -m "test(tenancy): the escalation probe, asserting the grant and the WITH CHECK

Shared contract section 11. A trader cannot promote herself or a colleague, and nobody can
write a membership into a business their token does not name.

The class asserts three things a bare refusal test would not: that UPDATE and INSERT are
actually GRANTED (so every refusal is the policy speaking, and so nobody 'fixes' this by
revoking UPDATE - removal IS an UPDATE of removed_at and plan 4 would become an unexplained
42501); that WITH CHECK names is_admin_of and USING does not; and that an ADMIN succeeds at
the identical statement, without which a WITH CHECK of false passes everything.

Verified by mutation three ways: dropping the admin conjunct lets a trader promote herself,
dropping the tenancy conjunct lets an admin of A write into B, and moving is_admin_of into
USING blinds the switcher and would 401 every non-admin on their next request.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: PROBE — removal. The absent `DELETE` privilege, asserted directly

Shared contract §11 again, and the design's §10 is emphatic about why this is a separate probe from
Task 6's: *"r3's own escalation probe would have stayed green over it, because it tested only
`UPDATE` and `INSERT`."* A `DELETE` cannot be guarded by a policy — PostgreSQL evaluates `WITH CHECK`
for `INSERT` and for an `UPDATE`'s new row and **never** for `DELETE`, which `USING` alone governs —
and this table's `USING` is deliberately permissive. So there is no policy argument to have. The only
thing standing between a `viewer` and every membership row her `USING` arm can see is the fact that
`DELETE` was never granted, and that is what this class asserts.

⚠ **This repo has already proved this exact `FOR ALL`/`USING` behaviour against PostgreSQL 17 and
written it down**, on `refresh_token` (`20260828100211_AuthAndOnboarding.cs:160-168`: *"as
peakpower_app with SET LOCAL ROLE app_customer_role and app.customer_id set, both `DELETE FROM
customer.refresh_token` and `UPDATE … SET used_at = NULL …` succeeded on the caller's own rows — the
FOR ALL policy's USING arm passes for those, so RLS never stood in the way"*). Membership is the same
shape with a wider `USING`.

**Files:**
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs` (append the class `MembershipRemovalPrivilegeTests` at the end of the file)

**Interfaces:**
- Consumes: `TenancyFixture.CustomerRoleConnectionString`, `.EmployeeRoleConnectionString`,
  `.OwnerConnectionString`, `.CompanyAId`, `.CompanyBId`, `.CompanyAAccountId`, `.SharedAccountId`.
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Write the test**

Append to the **end** of
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`,
after `CustomerMembershipPolicyTests`' closing brace:

```csharp

/// <summary>
/// The REMOVAL probe (shared contract section 11), and it asserts an ABSENT PRIVILEGE rather than a
/// policy, because no policy can guard a DELETE.
/// <para>
/// ⚠ PostgreSQL evaluates a policy's WITH CHECK arm for INSERT and for an UPDATE's new row and
/// NEVER for DELETE, which USING alone governs. This table's USING is deliberately permissive -
/// <c>account_id = app.account_id OR customer_id = app.customer_id</c> - so that the business
/// switcher can read across businesses. With DELETE granted, a plain VIEWER acting for B could run
/// <c>DELETE FROM customer.customer_membership WHERE customer_id = &lt;B&gt;</c> and wipe every
/// membership in B including its admins, and anybody could run
/// <c>DELETE ... WHERE account_id = &lt;self&gt;</c> to drop their memberships in businesses their
/// token does not even name. There is no WITH CHECK argument to have about either.
/// </para>
/// <para>
/// ⚠ This repository has already proved that exact FOR ALL/USING behaviour against postgres 17 and
/// written it into a migration comment
/// (20260828100211_AuthAndOnboarding.cs, on customer.refresh_token). An earlier revision of this
/// very design granted DELETE and put the admin proof in WITH CHECK, reproducing the bug its own
/// migration documents - which is why this class exists separately from the escalation probe, whose
/// UPDATE and INSERT cases would have stayed green over it.
/// </para>
/// </summary>
[Collection(nameof(TenancyCollection))]
public sealed class MembershipRemovalPrivilegeTests
{
    private readonly TenancyFixture _fixture;

    public MembershipRemovalPrivilegeTests(TenancyFixture fixture) => _fixture = fixture;

    private async Task<(NpgsqlConnection Connection, NpgsqlTransaction Transaction)> ActingAsAsync(
        Guid accountId, Guid customerId, CancellationToken ct)
    {
        var connection = TenancyFixture.Connect(_fixture.CustomerRoleConnectionString);
        await connection.OpenAsync(ct);
        var transaction = await connection.BeginTransactionAsync(ct);

        await using var settings = new NpgsqlCommand(
            """
            SELECT set_config('app.account_id',  @accountId,  true),
                   set_config('app.customer_id', @customerId, true)
            """,
            connection,
            transaction);
        settings.Parameters.AddWithValue("accountId", accountId.ToString());
        settings.Parameters.AddWithValue("customerId", customerId.ToString());
        await settings.ExecuteNonQueryAsync(ct);

        return (connection, transaction);
    }

    [Theory]
    [InlineData("app_customer_role")]
    [InlineData("app_employee_role")]
    public async Task Neither_application_role_holds_DELETE_on_the_membership_table(string role)
    {
        // The assertion the design asks for, made directly against the catalogue: there is no
        // DELETE grant to have a policy argument about. Asserted for BOTH roles - the F12
        // back-office surface writes memberships as app_employee_role, and its policy is
        // USING (true) WITH CHECK (true), so a DELETE grant there would be even less guarded than
        // one on the customer role.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = TenancyFixture.Connect(_fixture.OwnerConnectionString);
        await connection.OpenAsync(ct);

        await using var command = new NpgsqlCommand(
            "SELECT has_table_privilege(@role, 'customer.customer_membership', 'DELETE')::text",
            connection);
        command.Parameters.AddWithValue("role", role);

        ((string?)await command.ExecuteScalarAsync(ct)).ShouldBe(
            "false",
            $"{role} must never hold DELETE on customer.customer_membership. Postgres evaluates " +
            "WITH CHECK for INSERT and for an UPDATE's new row and NEVER for DELETE, and this " +
            "table's USING arm is deliberately permissive so the switcher can read across " +
            "businesses - so the privilege is the only thing standing in the way");
    }

    [Fact]
    public async Task A_viewer_cannot_delete_every_membership_in_the_business_she_is_acting_for()
    {
        // The exploit, run as a statement rather than argued about. Sofie is a VIEWER in company B;
        // the predicate is exactly the one the USING arm satisfies, so a granted DELETE would have
        // removed every membership in B - its admins included - and left a business nobody can
        // administer, which is the state [F13-R41] forbids repairing with a "first account is
        // admin" rule.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.SharedAccountId, _fixture.CompanyBId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var delete = new NpgsqlCommand(
                "DELETE FROM customer.customer_membership WHERE customer_id = @customerId",
                connection,
                transaction);
            delete.Parameters.AddWithValue("customerId", _fixture.CompanyBId);

            var thrown = await Should.ThrowAsync<PostgresException>(
                async () => await delete.ExecuteNonQueryAsync(ct));

            thrown.SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege);

            // ⚠ NOT "row-level security policy" - the message must be a PRIVILEGE refusal. A
            // policy-shaped message here would mean somebody granted DELETE and tried to guard it,
            // which cannot work.
            thrown.MessageText.ShouldContain("permission denied", Case.Sensitive);

            await transaction.RollbackAsync(ct);
        }
    }

    [Fact]
    public async Task A_member_cannot_delete_her_own_memberships_in_businesses_her_token_does_not_name()
    {
        // The second half of the same hole. Acting for A, the predicate `account_id = self` matches
        // Sofie's membership in B as well - the USING arm's OR sees it, which is exactly what the
        // switcher needs it to do - so a granted DELETE would let her leave a business by an
        // unaudited side door rather than through plan 4's removal endpoint.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.SharedAccountId, _fixture.CompanyAId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var delete = new NpgsqlCommand(
                "DELETE FROM customer.customer_membership WHERE account_id = @accountId",
                connection,
                transaction);
            delete.Parameters.AddWithValue("accountId", _fixture.SharedAccountId);

            var thrown = await Should.ThrowAsync<PostgresException>(
                async () => await delete.ExecuteNonQueryAsync(ct));

            thrown.SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege);
            thrown.MessageText.ShouldContain("permission denied", Case.Sensitive);

            await transaction.RollbackAsync(ct);
        }
    }

    [Fact]
    public async Task An_unqualified_DELETE_is_refused_before_any_predicate_is_even_considered()
    {
        // No WHERE clause at all. A privilege refusal does not care what the statement would have
        // matched, which is the property that makes it stronger than any policy: this fails
        // identically whether the USING arm would have shown one row or every row in the table.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.SharedAccountId, _fixture.CompanyBId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var delete = new NpgsqlCommand(
                "DELETE FROM customer.customer_membership", connection, transaction);

            (await Should.ThrowAsync<PostgresException>(
                async () => await delete.ExecuteNonQueryAsync(ct)))
                .SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege);

            await transaction.RollbackAsync(ct);
        }
    }

    [Fact]
    public async Task Removal_as_an_UPDATE_of_removed_at_is_allowed_for_an_admin_and_IS_guarded()
    {
        // The positive half, and the reason the absent DELETE grant is not simply a lockout:
        // removal is an UPDATE, WITH CHECK does guard an UPDATE, and an admin of this business may
        // do it. Without this test, REVOKE ALL would satisfy every assertion above.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.CompanyAAccountId, _fixture.CompanyAId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var remove = new NpgsqlCommand(
                """
                UPDATE customer.customer_membership SET removed_at = now()
                WHERE account_id = @accountId AND customer_id = @customerId
                """,
                connection,
                transaction);
            remove.Parameters.AddWithValue("accountId", _fixture.SharedAccountId);
            remove.Parameters.AddWithValue("customerId", _fixture.CompanyAId);

            (await remove.ExecuteNonQueryAsync(ct)).ShouldBe(
                1,
                "removal is an UPDATE of removed_at precisely so that WITH CHECK can guard it - " +
                "and an admin of this business is who WITH CHECK admits");

            await transaction.RollbackAsync(ct);
        }
    }

    [Fact]
    public async Task A_viewer_cannot_remove_anybody_because_the_UPDATE_is_the_guarded_verb()
    {
        // The other side of the same statement: the verb removal uses IS guarded, so a viewer
        // running it is refused by the policy rather than by a privilege. Both messages are worth
        // pinning - a 42501 from a missing grant and a 42501 from a policy read identically at the
        // SQLSTATE level and mean very different things about which mechanism is holding.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.SharedAccountId, _fixture.CompanyBId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var remove = new NpgsqlCommand(
                """
                UPDATE customer.customer_membership SET removed_at = now()
                WHERE account_id = @accountId AND customer_id = @customerId
                """,
                connection,
                transaction);
            remove.Parameters.AddWithValue("accountId", _fixture.SharedAccountId);
            remove.Parameters.AddWithValue("customerId", _fixture.CompanyBId);

            var thrown = await Should.ThrowAsync<PostgresException>(
                async () => await remove.ExecuteNonQueryAsync(ct));

            thrown.SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege);
            thrown.MessageText.ShouldContain("row-level security policy", Case.Sensitive);

            await transaction.RollbackAsync(ct);
        }
    }
}
```

- [ ] **Step 2: Run the tests and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MembershipRemovalPrivilegeTests"
```

Expected: PASS, seven cases.

- [ ] **Step 3: Mutate the migration to grant `DELETE`, and watch the hole open**

In migration 15's step-3 block, add the verb an implementer reaches for when they read *"the verb is
`DELETE`"* in the API contract and take it literally:

```sql
                GRANT SELECT, INSERT, UPDATE, DELETE ON customer.customer_membership TO app_customer_role;
                -- MUTATION: DELETE granted
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MembershipRemovalPrivilegeTests" > /tmp/task7-mutant.txt 2>&1; cat /tmp/task7-mutant.txt`

Expected: **four** failures.
- `Neither_application_role_holds_DELETE_on_the_membership_table(role: "app_customer_role")`:
  `should be "false" but was "true"`. The `app_employee_role` case still passes, which is what
  proves the theory is per-role rather than a single global assertion.
- `A_viewer_cannot_delete_every_membership_in_the_business_she_is_acting_for`:
  `Should.ThrowAsync<PostgresException>() … but no exception was thrown`. ⚠ Read that twice. A plain
  viewer has just deleted every membership in company B, admins included, on a connection whose
  policy was in force the whole time.
- `A_member_cannot_delete_her_own_memberships_in_businesses_her_token_does_not_name`: the same.
- `An_unqualified_DELETE_is_refused_before_any_predicate_is_even_considered`: the same.

⚠ **Now run the escalation probe under the same mutation**, because the design says in terms that an
earlier revision's escalation probe would have stayed green over exactly this:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~CustomerMembershipPolicyTests"
```

Expected: **PASS, all eight.** That is the finding this task exists to record: Task 6's class tests
only `UPDATE` and `INSERT`, so it cannot see a `DELETE` grant at all, and a suite that had only that
class would have gone green over a viewer wiping a business. Two probes, not one.

Restore the `GRANT` to three verbs and confirm:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -n "GRANT SELECT, INSERT, UPDATE" src/Infrastructure/PeakPower.Persistence/Migrations/*_MultiBusinessMembership.cs \
  > /tmp/task7-restore.txt
grep -c "DELETE ON customer.customer_membership" src/Infrastructure/PeakPower.Persistence/Migrations/*_MultiBusinessMembership.cs \
  >> /tmp/task7-restore.txt
cat /tmp/task7-restore.txt
```

Expected: two `GRANT SELECT, INSERT, UPDATE` lines (one per role) and `0` occurrences of
`DELETE ON customer.customer_membership`.

- [ ] **Step 4: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs
git commit -m "test(tenancy): the removal probe, asserting the ABSENT DELETE privilege

Shared contract section 11. No policy can guard a DELETE: Postgres evaluates WITH CHECK for
INSERT and for an UPDATE's new row and never for DELETE, which USING alone governs - and
this table's USING is deliberately permissive so the switcher can read across businesses. So
the class asserts has_table_privilege(...,'DELETE') is false for BOTH application roles, and
then runs the two statements a grant would have allowed: a viewer wiping every membership in
the business she is acting for, and anybody dropping their memberships in businesses their
token does not name.

Verified by mutation, and the second half of that mutation is the point: granting DELETE
turns four tests in THIS class red and leaves all eight of the escalation probe GREEN,
because that class tests only UPDATE and INSERT. That is precisely how an earlier revision
of this design shipped a viewer-can-wipe-a-business hole past its own escalation test.

The positive control is here too - removal as an UPDATE of removed_at succeeds for an admin
and is refused for a viewer by the policy rather than by a privilege - so REVOKE ALL cannot
satisfy this class either.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 8: Migration 15, step 7a — re-point `customer_account` and `password_reset_token`, and the EF filter with them

Design §9 step 2, and the first task in this plan where an existing behaviour changes. **Both proofs
move at once, deliberately.** A forged `customer_id` is caught twice today — by `customer_account`'s
own `_tenant_isolation` policy and by the EF global query filter on `CustomerAccount`, which
`SecurityStampTests` proves by mutation still catches a forged claim even with `SET LOCAL ROLE`
removed. Both key on the column about to be dropped. Re-pointing one without the other would leave
the suite green with one defence where there were two.

⚠ **The rewrite is not equivalent, and the difference is a privilege boundary.** The old policies
were *partition*-shaped: an account lived in one company, so two tenants' reachable account sets
were disjoint. Under membership they **overlap** — Sofie is reachable from both A and B. With
`customer_account`'s policy still `FOR ALL` and `app_customer_role` still holding full DML on a table
carrying `password_hash` and `security_stamp`, an admin of B could reach the account row of somebody
who is also a member of A. Hence the column-scoped grant in this same task, and the probe in Task 10.

⚠ **`REVOKE UPDATE` must be column-scoped, not blanket.** A blanket revoke is correct against every
call site that exists **today** — every authenticated path leaves `customer_account` alone; sign-in,
password reset, stamp bumps and onboarding are anonymous routes on the owner connection, and
deactivation is the employee host — and **wrong** against plan 2's `active-business`, which is
authenticated by definition, runs as `app_customer_role`, and must write `last_active_business_id`.
Column scoping lets exactly that one preference column through while `password_hash` and
`security_stamp` stay unreachable. This is the pattern migration 2 already uses on
`audit.audit_record` and `metering.brp`, and migration 3 on `refresh_token`.

⚠ **`password_reset_token` re-points through a two-level `EXISTS`** — token → account → membership —
and its policy keeps the name `password_reset_token_tenant_isolation` it has had since migration 3
(Deviation D4). It is inert either way: `app_customer_role` is granted nothing at all on that table
(`AuthSchemaTests.The_tenant_role_is_granted_nothing_on_the_reset_tokens`). It is re-pointed anyway
because leaving a policy keyed on a dropped column is a `DROP COLUMN` failure at step 8, and because
the coverage guards hold it to the two-policy bar so that a future accidental `GRANT` lands scoped.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_MultiBusinessMembership.cs` (append to `Up()`, prepend to `Down()`)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs:169-171`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs:19-64`, `:227-236`, `:465-486`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MembershipSchemaTests.cs` (append)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs` (append to `QueryFilterEnforcementTests`)

**Interfaces:**
- Consumes: the membership table and both its policies (Task 3); memberships on every seeded account
  (Task 5); `CustomerAccount.Memberships` (Task 2).
- Produces: `customer_customer_account_tenant_isolation` keyed on membership;
  `password_reset_token_tenant_isolation` keyed on membership;
  `GRANT UPDATE (last_active_business_id) ON customer.customer_account TO app_customer_role` — plan
  2's `active-business` writes through exactly that grant and no other;
  `CustomerOwnedTableCases.Row.TenantPredicate`, the SQL fragment every yardstick query in
  `RowLevelSecurityTests` now uses instead of `{column} = @tenantId`.

- [ ] **Step 1: Write the failing tests**

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MembershipSchemaTests.cs`,
inside the existing class:

```csharp
    [Fact]
    public async Task The_account_policy_now_asks_membership_rather_than_a_column()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var connection = await OpenOwnerAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT qual FROM pg_policies
            WHERE schemaname = 'customer' AND tablename = 'customer_account'
              AND policyname = 'customer_customer_account_tenant_isolation'
            """,
            connection);

        var usingClause = (string?)await command.ExecuteScalarAsync(ct);

        usingClause.ShouldNotBeNull("customer_account must keep a tenant-isolation policy by name");
        usingClause!.ShouldContain("customer_membership", Case.Sensitive);
        usingClause.ShouldContain("removed_at", Case.Sensitive);
        usingClause.ShouldContain("app.customer_id", Case.Sensitive);
    }

    [Fact]
    public async Task The_reset_token_policy_reaches_membership_through_the_account()
    {
        // Inert today - app_customer_role is granted nothing on this table - and re-pointed anyway,
        // because a policy keyed on customer_account.customer_id makes step 8's DROP COLUMN fail on
        // a dependent object, and because both coverage guards hold this table to the two-policy
        // bar so a future accidental GRANT lands scoped rather than wide open.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = await OpenOwnerAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT qual FROM pg_policies
            WHERE schemaname = 'customer' AND tablename = 'password_reset_token'
              AND policyname = 'password_reset_token_tenant_isolation'
            """,
            connection);

        var usingClause = (string?)await command.ExecuteScalarAsync(ct);

        usingClause.ShouldNotBeNull();
        usingClause!.ShouldContain("customer_membership", Case.Sensitive);
        usingClause.ShouldContain("customer_account_id", Case.Sensitive);
    }

    [Fact]
    public async Task No_policy_anywhere_still_reads_customer_account_dot_customer_id()
    {
        // ⚠ The assertion that makes step 8 possible. DROP COLUMN errors on a dependent object, and
        // CASCADE would silently drop all three policies - leaving customer_account with row-level
        // security enabled and NO policy, so every authenticated request 401s because the session
        // middleware's own account read returns nothing. Discovered across every policy in the
        // database rather than checked on the three this plan knows about.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = await OpenOwnerAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname,
                                       ',' ORDER BY policyname), 'NONE')
            FROM pg_policies
            WHERE coalesce(qual, '') || ' ' || coalesce(with_check, '') LIKE '%customer_account%'
              AND coalesce(qual, '') || ' ' || coalesce(with_check, '') LIKE '%a.customer_id%'
            """,
            connection);

        ((string?)await command.ExecuteScalarAsync(ct)).ShouldBe(
            "NONE",
            "no policy may still derive tenancy from customer_account.customer_id, or step 8's " +
            "DROP COLUMN fails on a dependent object");
    }

    [Fact]
    public async Task The_customer_role_may_update_the_preference_column_and_nothing_else_on_an_account()
    {
        // ⚠ Column-scoped, not blanket. A blanket REVOKE UPDATE is right for every call site that
        // exists today and wrong for plan 2's /auth/active-business, which is authenticated by
        // definition and therefore runs as app_customer_role. Asserted as the exact column set, so
        // a grant widened to the table - or to password_hash "while we are here" - fails.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = await OpenOwnerAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT coalesce(string_agg(column_name, ',' ORDER BY column_name), 'NONE')
            FROM information_schema.column_privileges
            WHERE table_schema = 'customer' AND table_name = 'customer_account'
              AND grantee = 'app_customer_role' AND privilege_type = 'UPDATE'
            """,
            connection);

        ((string?)await command.ExecuteScalarAsync(ct)).ShouldBe(
            "last_active_business_id",
            "exactly one column, and it is the preference one. password_hash and security_stamp " +
            "must stay unreachable to an authenticated customer connection now that two businesses " +
            "can reach the same account row");
    }

    [Fact]
    public async Task The_customer_role_holds_no_DELETE_on_an_account_at_all()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var connection = await OpenOwnerAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT has_table_privilege('app_customer_role', 'customer.customer_account', 'DELETE')::text
                || ':' ||
                   has_table_privilege('app_customer_role', 'customer.customer_account', 'SELECT')::text
            """,
            connection);

        ((string?)await command.ExecuteScalarAsync(ct)).ShouldBe(
            "false:true",
            "SELECT must stay - the session middleware's own account read runs on this connection - " +
            "and DELETE must go, because the tenant-isolation policy's USING arm passes for every " +
            "row the caller CAN see, which now includes people who are also in another business");
    }
```

Append to `QueryFilterEnforcementTests` in
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs`:

```csharp
    /// <summary>
    /// Layer 1 under membership, and the property the old filter could not have had: one account is
    /// visible from TWO businesses. Under <c>account.CustomerId == ctx.CustomerId</c> the two
    /// tenants' reachable sets were disjoint by construction; under
    /// <c>account.Memberships.Any(...)</c> they overlap, and this is the test that says so out loud
    /// rather than leaving it to be discovered by a support ticket.
    /// </summary>
    [Fact]
    public async Task A_person_who_is_a_member_of_both_companies_is_visible_from_both()
    {
        var seeded = await SeedTwoCustomersAsync();
        var ct = TestContext.Current.CancellationToken;

        await using (var owner = fixture.CreateContext())
        {
            owner.CustomerMemberships.Add(CustomerMembership.Create(
                seeded.A.Account.Id,
                seeded.B.Customer.Id,
                MembershipRole.Viewer,
                new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero)).Value);
            await owner.SaveChangesAsync(ct);
        }

        await using var asA = fixture.CreateContext(new ScopedCustomerContext(seeded.A.Customer.Id));
        await using var asB = fixture.CreateContext(new ScopedCustomerContext(seeded.B.Customer.Id));

        (await asA.CustomerAccounts.Where(a => a.Id == seeded.A.Account.Id).CountAsync(ct))
            .ShouldBe(1, "her original business still sees her");
        (await asB.CustomerAccounts.Where(a => a.Id == seeded.A.Account.Id).CountAsync(ct))
            .ShouldBe(1, "and so does the one she was invited into");
    }

    /// <summary>
    /// The half of the filter that is easy to write and easy to get wrong: a REMOVED membership
    /// must not keep the account visible. Without <c>m.RemovedAt == null</c> the filter would
    /// silently un-remove everybody plan 4 ever removes.
    /// </summary>
    [Fact]
    public async Task A_removed_membership_does_not_keep_the_account_visible()
    {
        var seeded = await SeedTwoCustomersAsync();
        var ct = TestContext.Current.CancellationToken;

        await using (var owner = fixture.CreateContext())
        {
            var membership = CustomerMembership.Create(
                seeded.A.Account.Id,
                seeded.B.Customer.Id,
                MembershipRole.Viewer,
                new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero)).Value;
            membership.Remove(new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero));
            owner.CustomerMemberships.Add(membership);
            await owner.SaveChangesAsync(ct);
        }

        await using var asB = fixture.CreateContext(new ScopedCustomerContext(seeded.B.Customer.Id));

        (await asB.CustomerAccounts.Where(a => a.Id == seeded.A.Account.Id).CountAsync(ct))
            .ShouldBe(0, "removal is a timestamp, and every predicate in this design carries it");
    }
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MembershipSchemaTests|FullyQualifiedName~QueryFilterEnforcementTests" > /tmp/task8-before.txt 2>&1; cat /tmp/task8-before.txt`

Expected: FAIL, seven tests.

- `The_account_policy_now_asks_membership_rather_than_a_column`:
  `usingClause should contain "customer_membership" but was "(customer_id = (NULLIF(current_setting('app.customer_id'::text, true), ''::text))::uuid)"`.
- `The_reset_token_policy_reaches_membership_through_the_account`: the same shape, against the
  existing two-table `EXISTS`.
- `No_policy_anywhere_still_reads_customer_account_dot_customer_id`: `should be "NONE" but was
  "customer.password_reset_token.password_reset_token_tenant_isolation,customer.refresh_token.refresh_token_tenant_isolation"`
  — those two derive tenancy through `a.customer_id` today. ⚠ `refresh_token` is Task 9's, not this
  task's, so this test stays red until then; that is stated in Step 5.
- `The_customer_role_may_update_the_preference_column_and_nothing_else_on_an_account`:
  `should be "last_active_business_id" but was` a long comma-separated list of every column, because
  a table-level `UPDATE` grant is reported per column by `information_schema.column_privileges`.
- `The_customer_role_holds_no_DELETE_on_an_account_at_all`: `should be "false:true" but was
  "true:true"`.
- `A_person_who_is_a_member_of_both_companies_is_visible_from_both`: the `asB` assertion fails,
  `should be 1 but was 0` — today's filter compares a column.
- `A_removed_membership_does_not_keep_the_account_visible`: **passes** already, for the wrong reason
  (today's filter never looked at membership at all). It is kept because it becomes load-bearing the
  moment the next step lands, and Step 6 mutates it.

- [ ] **Step 3: Append step 7a to the migration**

Append inside `Up()`, after step 6's `UPDATE`:

```csharp
            // -----------------------------------------------------------------------------------
            // 7a. Re-point the two policies that derive tenancy from customer_account.customer_id.
            //     (refresh_token, the third, is step 7b - it does NOT use this shape.)
            //
            // ⚠ The rewrite is not equivalent, and the difference is a privilege boundary. The old
            // policies were PARTITION-shaped: an account lived in one company, so two tenants'
            // reachable account sets were disjoint by construction. Under membership they OVERLAP -
            // a shared member is reachable from both businesses - and customer_account carries
            // password_hash and security_stamp. Hence the column-scoped grant below, without which
            // an admin of B could rewrite the credentials of somebody who is also a member of A.
            //
            // ⚠ REVOKE UPDATE must be COLUMN-SCOPED and not blanket. A blanket revoke is correct
            // against every call site that exists today - every authenticated path leaves this
            // table alone; sign-in, password reset, stamp bumps and onboarding are anonymous routes
            // on the owner connection, and deactivation is the employee host - and WRONG against
            // plan 2's POST /api/v1/auth/active-business, which is authenticated by definition, runs
            // as app_customer_role, and must write last_active_business_id. Column scoping lets
            // exactly that one column through. Same pattern as migration 2 on audit.audit_record and
            // metering.brp, and migration 3 on refresh_token.
            //
            // SELECT stays granted, deliberately: CustomerSessionMiddleware's own account read runs
            // on this connection, and a policy nothing may exercise is a policy nothing can test.
            //
            // password_reset_token reaches membership through customer_account_id - two levels of
            // EXISTS. It is INERT today (app_customer_role is granted nothing on that table at all,
            // see AuthSchemaTests.The_tenant_role_is_granted_nothing_on_the_reset_tokens) and it is
            // re-pointed anyway for two reasons: a policy keyed on customer_account.customer_id
            // makes step 8's DROP COLUMN fail on a dependent object, and both coverage guards hold
            // this table to the two-policy bar precisely so that a future accidental GRANT lands
            // scoped by membership rather than wide open.
            //
            // The policy NAMES are unchanged. customer_account's follows migration 2's
            // {schema}_{table}_{arm} convention; password_reset_token's has been unprefixed since
            // migration 3 and AuthSchemaTests pins the refresh_token twin by name. Renaming would
            // buy nothing and break a test that is about something else.
            // -----------------------------------------------------------------------------------
            migrationBuilder.Sql(
                """
                DROP POLICY customer_customer_account_tenant_isolation ON customer.customer_account;

                CREATE POLICY customer_customer_account_tenant_isolation ON customer.customer_account
                    FOR ALL TO app_customer_role
                    USING (EXISTS (
                        SELECT 1 FROM customer.customer_membership m
                        WHERE m.account_id  = customer_account.id
                          AND m.customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid
                          AND m.removed_at IS NULL))
                    WITH CHECK (EXISTS (
                        SELECT 1 FROM customer.customer_membership m
                        WHERE m.account_id  = customer_account.id
                          AND m.customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid
                          AND m.removed_at IS NULL));

                REVOKE UPDATE, DELETE ON customer.customer_account FROM app_customer_role;
                GRANT  UPDATE (last_active_business_id) ON customer.customer_account TO app_customer_role;

                DROP POLICY password_reset_token_tenant_isolation ON customer.password_reset_token;

                CREATE POLICY password_reset_token_tenant_isolation ON customer.password_reset_token
                    FOR ALL TO app_customer_role
                    USING (EXISTS (
                        SELECT 1 FROM customer.customer_membership m
                        WHERE m.account_id  = customer.password_reset_token.customer_account_id
                          AND m.customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid
                          AND m.removed_at IS NULL))
                    WITH CHECK (EXISTS (
                        SELECT 1 FROM customer.customer_membership m
                        WHERE m.account_id  = customer.password_reset_token.customer_account_id
                          AND m.customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid
                          AND m.removed_at IS NULL));
                """);
```

and **prepend** to `Down()`, before the block Task 3 wrote:

```csharp
            // Undo 7a, in reverse. The original predicates are migration 2's and migration 3's,
            // restored verbatim so a hand-run downgrade lands on the schema those migrations
            // describe rather than on something that merely works.
            migrationBuilder.Sql(
                """
                DROP POLICY IF EXISTS password_reset_token_tenant_isolation
                    ON customer.password_reset_token;
                CREATE POLICY password_reset_token_tenant_isolation ON customer.password_reset_token
                    FOR ALL TO app_customer_role
                    USING (EXISTS (
                        SELECT 1 FROM customer.customer_account a
                        WHERE a.id = customer.password_reset_token.customer_account_id
                          AND a.customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid))
                    WITH CHECK (EXISTS (
                        SELECT 1 FROM customer.customer_account a
                        WHERE a.id = customer.password_reset_token.customer_account_id
                          AND a.customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid));

                REVOKE UPDATE (last_active_business_id) ON customer.customer_account FROM app_customer_role;
                GRANT  UPDATE, DELETE ON customer.customer_account TO app_customer_role;

                DROP POLICY IF EXISTS customer_customer_account_tenant_isolation
                    ON customer.customer_account;
                CREATE POLICY customer_customer_account_tenant_isolation ON customer.customer_account
                    FOR ALL TO app_customer_role
                    USING      (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
                    WITH CHECK (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid);
                """);
```

- [ ] **Step 4: Re-point the EF query filter**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs`,
replace lines `169-171` — before:

```csharp
        modelBuilder.Entity<CustomerAccount>()
            .HasQueryFilter(account =>
                !_customerContext.IsAuthenticated || account.CustomerId == _customerContext.CustomerId);
```

after:

```csharp
        // Layer 1, re-pointed at membership. ⚠ A collection navigation, not Set<CustomerMembership>():
        // HasQueryFilter cannot reference Set<T>(), which is the entire reason CustomerAccount
        // carries a Memberships navigation at all.
        //
        // ⚠ The `!_customerContext.IsAuthenticated ||` prefix MUST stay. The back office, the Worker
        // and the anonymous onboarding wizard all read through this same context with no customer
        // scope; without it every one of them would see zero accounts - not "fewer", zero, because
        // an unauthenticated context has CustomerId Guid.Empty and nobody is a member of that.
        //
        // ⚠ m.RemovedAt == null is not optional. Removal is a timestamp rather than a DELETE
        // (migration 15 grants no DELETE on customer_membership at all), so a filter that omitted it
        // would silently un-remove everybody plan 4 ever removes.
        //
        // This filter and customer_customer_account_tenant_isolation are now the same predicate in
        // two places, which is the point: SecurityStampTests proves by mutation that the filter
        // still catches a forged customer_id even with SET LOCAL ROLE removed from the middleware's
        // batch. Two independent defences, both re-pointed in one commit, because leaving one on the
        // dropped column would have left the suite green with one where there were two.
        modelBuilder.Entity<CustomerAccount>()
            .HasQueryFilter(account =>
                !_customerContext.IsAuthenticated ||
                account.Memberships.Any(membership =>
                    membership.CustomerId == _customerContext.CustomerId &&
                    membership.RemovedAt == null));
```

- [ ] **Step 5: Move the yardstick the RLS tests measure against**

⚠ Three tests in `RowLevelSecurityTests` compare what `app_customer_role` sees against an owner-side
count written as `WHERE {column} = @tenantId`. For `customer_account` that column no longer describes
the policy: Sofie's row carries `customer_id = A` and she is a member of B as well, so the owner
count for B says one and the policy shows two. The yardstick has to ask the same question the policy
asks.

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`,
replace `CustomerOwnedTableCases` at `:19-64` — before:

```csharp
internal static class CustomerOwnedTableCases
{
    internal sealed record Row(
        string Schema,
        string Table,
        string Column,
        string TenantIsolationPolicy,
        string BackOfficePolicy);

    internal static readonly Row[] All =
    [
        new("customer", "customer", "id",
            "customer_customer_tenant_isolation", "customer_customer_back_office"),
        new("customer", "customer_account", "customer_id",
            "customer_customer_account_tenant_isolation", "customer_customer_account_back_office"),
        new("customer", "metering_point", "customer_id",
            "customer_metering_point_tenant_isolation", "customer_metering_point_back_office"),
        new("wallet", "wallet", "customer_id",
            "wallet_wallet_tenant_isolation", "wallet_wallet_back_office"),
        new("audit", "audit_record", "customer_id",
            "audit_audit_record_tenant_isolation", "audit_audit_record_back_office"),
    ];
```

after:

```csharp
internal static class CustomerOwnedTableCases
{
    /// <summary>
    /// <paramref name="TenantPredicate"/> is the SQL a test uses on the OWNER connection to ask
    /// "which of these rows belong to @tenantId" - the yardstick the policy's answer is measured
    /// against.
    /// <para>
    /// ⚠ It exists because <c>customer_account</c> stopped having a tenancy COLUMN. Its policy is
    /// now an EXISTS over <c>customer_membership</c>, and a yardstick still written as
    /// <c>customer_id = @tenantId</c> would ask a different question than the policy answers: a
    /// person who is a member of two businesses carries the customer_id of the one she was created
    /// in, and is legitimately visible from both. The old form would then report a mismatch that is
    /// not a leak, or - worse, after task 17 - fail with 42703.
    /// </para>
    /// </summary>
    internal sealed record Row(
        string Schema,
        string Table,
        string Column,
        string TenantPredicate,
        string TenantIsolationPolicy,
        string BackOfficePolicy);

    private const string AccountBelongsToTenant =
        """
        EXISTS (SELECT 1 FROM customer.customer_membership m
                WHERE m.account_id = customer_account.id
                  AND m.customer_id = @tenantId
                  AND m.removed_at IS NULL)
        """;

    internal static readonly Row[] All =
    [
        new("customer", "customer", "id", "id = @tenantId",
            "customer_customer_tenant_isolation", "customer_customer_back_office"),
        new("customer", "customer_account", "customer_id", AccountBelongsToTenant,
            "customer_customer_account_tenant_isolation", "customer_customer_account_back_office"),
        new("customer", "metering_point", "customer_id", "customer_id = @tenantId",
            "customer_metering_point_tenant_isolation", "customer_metering_point_back_office"),
        new("wallet", "wallet", "customer_id", "customer_id = @tenantId",
            "wallet_wallet_tenant_isolation", "wallet_wallet_back_office"),
        new("audit", "audit_record", "customer_id", "customer_id = @tenantId",
            "audit_audit_record_tenant_isolation", "audit_audit_record_back_office"),
    ];
```

Replace `ForUpdatableTableAndColumn` at `:44-54` — before:

```csharp
    /// <summary>
    /// Excludes audit_record: UPDATE is revoked outright for app_customer_role on that table (the
    /// migration's append-only guarantee), so a cross-tenant UPDATE there throws 42501 rather than
    /// affecting zero rows. That is proven instead by
    /// <see cref="RowLevelSecurityTests.the_customer_role_cannot_update_its_own_audit_record_because_the_log_is_append_only"/>,
    /// which is a strictly stronger property: UPDATE is refused even on the caller's own row.
    /// </summary>
    public static IEnumerable<object[]> ForUpdatableTableAndColumn() =>
        All.Where(row => row.Table != "audit_record")
            .Select(row => new object[] { row.Schema, row.Table, row.Column });
```

after:

```csharp
    /// <summary>
    /// Excludes audit_record: UPDATE is revoked outright for app_customer_role on that table (the
    /// migration's append-only guarantee), so a cross-tenant UPDATE there throws 42501 rather than
    /// affecting zero rows. That is proven instead by
    /// <see cref="RowLevelSecurityTests.the_customer_role_cannot_update_its_own_audit_record_because_the_log_is_append_only"/>,
    /// which is a strictly stronger property: UPDATE is refused even on the caller's own row.
    /// <para>
    /// ⚠ Excludes customer_account for the SAME reason since migration 15: the table-level UPDATE
    /// grant is revoked and replaced by <c>UPDATE (last_active_business_id)</c>, so a cross-tenant
    /// UPDATE of any other column throws 42501 rather than affecting zero rows. The stronger
    /// property is proven by <c>CrossTenantAccountReachTests</c>, which shows an ADMIN of one
    /// business cannot rewrite the password hash of somebody who is also a member of another -
    /// the case column-shaped tenancy could not produce at all, because two tenants' account sets
    /// used to be disjoint.
    /// </para>
    /// </summary>
    public static IEnumerable<object[]> ForUpdatableTableAndColumn() =>
        All.Where(row => row.Table is not ("audit_record" or "customer_account"))
            .Select(row => new object[] { row.Schema, row.Table, row.Column });
```

Replace `OwnerRowsForTenantAsync` at `:461-486` — before:

```csharp
        var column = CustomerOwnedTableCases.All
            .Single(row => row.Schema == schema && row.Table == table)
            .Column;

        await using var owner = TenancyFixture.Connect(_fixture.OwnerConnectionString);
        await owner.OpenAsync(ct);

        // Schema, table and column all come from CustomerOwnedTableCases, a closed list of
        // literals in this assembly; the tenant id is a parameter.
        await using var read = new NpgsqlCommand(
            $"SELECT count(*) FROM {schema}.{table} WHERE {column} = @tenantId", owner);
        read.Parameters.AddWithValue("tenantId", tenantId);
```

after:

```csharp
        var predicate = CustomerOwnedTableCases.All
            .Single(row => row.Schema == schema && row.Table == table)
            .TenantPredicate;

        await using var owner = TenancyFixture.Connect(_fixture.OwnerConnectionString);
        await owner.OpenAsync(ct);

        // Schema, table and the predicate all come from CustomerOwnedTableCases, a closed list of
        // literals in this assembly; the tenant id is a parameter. ⚠ The predicate, not a column
        // name: customer_account's tenancy is an EXISTS over customer_membership since migration
        // 15, and a yardstick still asking `customer_id = @tenantId` would ask a different question
        // than the policy answers for anybody who is a member of two businesses.
        await using var read = new NpgsqlCommand(
            $"SELECT count(*) FROM {schema}.{table} WHERE {predicate}", owner);
        read.Parameters.AddWithValue("tenantId", tenantId);
```

Finally, correct the message on the cross-tenant insert test at `:236` — before:

```csharp
            .SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege,
                "the WITH CHECK arm of the policy must reject a cross-tenant write");
```

after:

```csharp
            .SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege,
                "the WITH CHECK arm of the policy must reject a cross-tenant write. Since " +
                "migration 15 that arm is an EXISTS over customer_membership, so this row is " +
                "refused because a brand-new account has no membership yet - which is the same " +
                "refusal for a better reason: it also refuses an INSERT naming the caller's OWN " +
                "company, and an account genuinely must be created on the owner connection");
```

- [ ] **Step 6: Run everything and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln --nologo > /tmp/task8-after.txt 2>&1; tail -40 /tmp/task8-after.txt
```

Expected: everything green **except** `No_policy_anywhere_still_reads_customer_account_dot_customer_id`,
which fails with

```
    should be
"NONE"
    but was
"customer.refresh_token.refresh_token_tenant_isolation"
```

`refresh_token` is Task 9's, and this is the declared red window for this commit — one test, named,
with the exact remaining offender in its message. It goes green in the next commit.

- [ ] **Step 7: Mutate the filter's prefix, then its removal term**

Drop the `!IsAuthenticated ||` prefix from the new filter — the "surely that is redundant now"
simplification:

```csharp
        modelBuilder.Entity<CustomerAccount>()
            .HasQueryFilter(account =>
                account.Memberships.Any(membership =>          // MUTATION: prefix removed
                    membership.CustomerId == _customerContext.CustomerId &&
                    membership.RemovedAt == null));
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~QueryFilterEnforcementTests" > /tmp/task8-mutant-a.txt 2>&1; cat /tmp/task8-mutant-a.txt`

Expected: FAIL, `The_back_office_unscoped_context_still_sees_every_customers_rows` —

```
accounts.Length
    should be
2
    but was
0
```

Every back-office screen that lists a customer's people has just gone blank, and so has the Worker
and the anonymous onboarding wizard. ⚠ Note which tests do **not** move: every
`A_customer_scoped_context_sees_only_its_own_*` test stays green, because a scoped context takes the
right-hand branch either way. A suite without the unscoped test would have shipped this.

Restore the prefix. Now mutate the removal term instead:

```csharp
                account.Memberships.Any(membership =>
                    membership.CustomerId == _customerContext.CustomerId));  // MUTATION: RemovedAt dropped
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~QueryFilterEnforcementTests"`

Expected: FAIL, `A_removed_membership_does_not_keep_the_account_visible` —
`should be 0 but was 1`, with `removal is a timestamp, and every predicate in this design carries
it`. That is the test that was passing for the wrong reason in Step 2 and is load-bearing now.

Restore. Finally mutate the **migration's** policy rather than the filter — drop
`AND m.removed_at IS NULL` from `customer_customer_account_tenant_isolation`:

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~The_account_policy_now_asks_membership_rather_than_a_column"`

Expected: FAIL —
`usingClause should contain "removed_at" but was "(EXISTS ( SELECT 1 FROM customer.customer_membership m WHERE ((m.account_id = customer_account.id) AND (m.customer_id = …))))"`.
⚠ The behavioural tests stay green under this one, because nothing in the suite reads
`customer_account` as `app_customer_role` with a removed membership in play — which is why the
structural assertion is there as well as the behavioural ones. Restore, and confirm:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -c "MUTATION" src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs \
                   src/Infrastructure/PeakPower.Persistence/Migrations/*_MultiBusinessMembership.cs \
  > /tmp/task8-restore.txt; cat /tmp/task8-restore.txt
```

Expected: `0` for both.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence/Migrations \
        src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs \
        tests/PeakPower.Integration.Tests
git commit -m "feat: re-point the account and reset-token policies, and the EF filter, at membership

Design section 9 step 2. Both proofs move in one commit on purpose: a forged customer_id is
caught twice today - by customer_account's own policy and by the EF global query filter,
which SecurityStampTests proves by mutation still catches it even with SET LOCAL ROLE
removed - and both keyed on the column about to be dropped. Re-pointing one would have left
the suite green with one defence where there were two.

The rewrite is not equivalent and the difference is a privilege boundary: the old policies
were partition-shaped, so two tenants' reachable account sets were disjoint; under
membership they OVERLAP, on a table carrying password_hash and security_stamp. So UPDATE and
DELETE are revoked and exactly one column is granted back - last_active_business_id, which
plan 2's authenticated /auth/active-business must write. A blanket revoke is right for every
call site that exists today and wrong for that one.

The RLS yardstick moves with the policy: CustomerOwnedTableCases gains a TenantPredicate,
because an owner-side count of `customer_id = @tenantId` asks a different question than the
policy answers for a person who is a member of two businesses.

Verified by mutation: dropping the filter's !IsAuthenticated prefix blanks every back-office
account list while leaving every scoped test green, and dropping m.RemovedAt == null
silently un-removes everybody plan 4 will ever remove.

One test is red until the next commit and says so in its own message:
No_policy_anywhere_still_reads_customer_account_dot_customer_id names refresh_token, which
is step 7b.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 9: Migration 15, step 7b — `refresh_token` gets its own `customer_id`, and the grants rotation needs

⚠ **`refresh_token` does NOT get the `EXISTS` shape, and that is the load-bearing part of this task.**
Shared contract §5.2 is explicit, and the design says why: plan 4's removal revokes the member's
refresh tokens **in the same transaction as the removal**, and under an `EXISTS`-through-membership
policy that transaction sees its own removal, finds no active membership, and **revokes zero rows —
silently**. Removal would become re-pointing rather than revocation. Keying the token on its own
column makes revocation independent of the membership's state, which is the property that matters.

A session belongs to a business as well as to a person: after plan 2's switcher, one account can hold
two live refresh chains for two businesses, and a refresh has to know which one it is renewing.

⚠ **The grants change too, and §5.3 is the reason.** `refresh_token` holds `SELECT` plus
`UPDATE (revoked_at)` only. Rotating a token on a switch needs `INSERT` and needs `UPDATE` of
`used_at` and `replaced_by_token_id`. Without them plan 2's step 5 is three `42501`s — and the
one-line fix a hurried implementer reaches for is the owner connection, which is exactly what this
codebase already rejected by name for sign-out: *"that bypasses RLS entirely, leaving the handler's
own WHERE clause as the only thing deciding whose tokens get revoked."*

⚠ **The column arrives nullable and becomes `NOT NULL` in three statements**, because
`ADD COLUMN … NOT NULL` with no default fails on a table with rows.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_MultiBusinessMembership.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/RefreshToken.cs:22-43`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/RefreshTokenConfiguration.cs:11-17`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs:175-176`, `:351-352`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/AuthSchemaTests.cs:151-152`, `:290-312`, `:438-439`, and append
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs:768`, `:1050`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs:155-161`

**Interfaces:**
- Consumes: the membership backfill (Task 4) — the column is backfilled from
  `customer_account.customer_id`, which still exists at this point and does not after Task 17.
- Produces: `RefreshToken.CustomerId` (`Guid`);
  `RefreshToken.Issue(Guid accountId, Guid customerId, string tokenHash, DateTimeOffset issuedAt, DateTimeOffset expiresAt)`
  — **plan 2's switcher calls exactly this**; `customer.refresh_token.customer_id` with
  `ix_refresh_token_customer_id`; `refresh_token_tenant_isolation` keyed on that column;
  `GRANT INSERT` and `GRANT UPDATE (used_at, replaced_by_token_id)` for `app_customer_role`.

- [ ] **Step 1: Write the failing tests**

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/AuthSchemaTests.cs`,
inside the existing class:

```csharp
    [Fact]
    public async Task The_refresh_token_policy_keys_on_its_OWN_customer_id_and_not_on_membership()
    {
        // ⚠ Shared contract section 5.2, and the reason is a silent failure rather than a style
        // preference. Plan 4's removal revokes the member's refresh tokens in the SAME TRANSACTION
        // as the removal. Under an EXISTS-through-membership policy that transaction sees its own
        // removal, finds no active membership, and revokes ZERO ROWS - with no error anywhere.
        // Removal would become re-pointing rather than revocation, and a stolen cookie bound to A
        // would become a valid session for B.
        await using var connection = await OpenAsync();

        var policy = await connection.ExecuteScalarAsync<string>(
            """
            SELECT qual FROM pg_policies
            WHERE schemaname = 'customer' AND tablename = 'refresh_token'
              AND policyname = 'refresh_token_tenant_isolation'
            """);

        policy.ShouldNotBeNull();
        policy!.ShouldContain("app.customer_id", Case.Sensitive);
        policy.ShouldNotContain(
            "customer_membership",
            Case.Sensitive,
            "revocation must be independent of the membership's state, or plan 4's removal " +
            "silently revokes nothing");
        policy.ShouldNotContain(
            "customer_account",
            Case.Sensitive,
            "and independent of the account join too - the column is the token's own");
    }

    [Fact]
    public async Task Every_refresh_token_row_names_a_business()
    {
        await using var connection = await OpenAsync();

        var nullable = await connection.ExecuteScalarAsync<string>(
            """
            SELECT is_nullable FROM information_schema.columns
            WHERE table_schema = 'customer' AND table_name = 'refresh_token'
              AND column_name = 'customer_id'
            """);

        nullable.ShouldBe("NO", "a session belongs to a business; there is no such thing as one that does not");
    }

    [Fact]
    public async Task The_tenant_role_can_rotate_a_token_but_still_cannot_rewrite_the_chain()
    {
        // Shared contract section 5.3. Plan 2's switch INSERTs a replacement and marks the old row
        // used, which needs three privileges refresh_token did not have. Asserted as the exact
        // column set on UPDATE, so a grant widened to the table - which would hand back the ability
        // to null revoked_at and resurrect a killed session - fails here.
        await using var connection = await OpenAsync();

        var insertable = await connection.ExecuteScalarAsync<bool>(
            "SELECT has_table_privilege('app_customer_role', 'customer.refresh_token', 'INSERT')");
        insertable.ShouldBeTrue("a rotation inserts the replacement");

        var updatable = await connection.ExecuteScalarAsync<string>(
            """
            SELECT string_agg(column_name, ',' ORDER BY column_name)
            FROM information_schema.column_privileges
            WHERE table_schema = 'customer' AND table_name = 'refresh_token'
              AND grantee = 'app_customer_role' AND privilege_type = 'UPDATE'
            """);

        updatable.ShouldBe(
            "replaced_by_token_id,revoked_at,used_at",
            "exactly the three a rotation and a sign-out need, and NOT the table - a table grant " +
            "would also hand back token_hash and expires_at");
    }

    [Fact]
    public async Task The_evidence_columns_may_be_SET_but_never_CLEARED()
    {
        // ⚠ Deviation D8. Shared contract section 5.3's grant re-opens the hole migration 3's own
        // comment documents: with used_at, revoked_at AND replaced_by_token_id all granted, the
        // statement that motivated narrowing this table in the first place -
        //     SET used_at = NULL, revoked_at = NULL, replaced_by_token_id = NULL
        // - names only granted columns and succeeds. A column grant cannot say "you may set this,
        // not clear it". A trigger can, and migration 10 already uses exactly that mechanism on
        // customer_entitlement for exactly this class of problem.
        //
        // Asserted on the OWNER connection deliberately: the trigger binds the owner too, which is
        // the point. The Worker, the seeders and every test fixture write this table on the owner
        // connection, and an invariant the owner may break is one a fixture breaks first and
        // production second.
        var (a, _) = await SeedTwoAccountsWithRefreshTokensAsync();
        await using var connection = await OpenAsync();

        await connection.ExecuteAsync(
            "UPDATE customer.refresh_token SET revoked_at = now() WHERE id = @id",
            new { id = a.RefreshTokenId });

        var resurrect = async () => await connection.ExecuteAsync(
            "UPDATE customer.refresh_token SET revoked_at = NULL WHERE id = @id",
            new { id = a.RefreshTokenId });

        var thrown = await Should.ThrowAsync<PostgresException>(resurrect);

        thrown.SqlState.ShouldBe(
            "23001",
            "restrict_violation. Nulling revoked_at is worse than deleting the row: it resurrects " +
            "a session password-reset completion had just killed");
    }

    [Fact]
    public async Task A_token_issued_for_one_business_is_invisible_to_the_other()
    {
        // The behavioural half. Both tokens belong to the SAME account - the case column-shaped
        // tenancy could not produce - and only the one issued for the declared business is visible.
        var (a, _) = await SeedTwoAccountsWithRefreshTokensAsync();
        var ct = TestContext.Current.CancellationToken;

        Guid otherBusinessTokenId;
        await using (var db = factory.CreateOwnerDbContext())
        {
            var otherBusiness = NewCustomer("Tweede Zaak B.V.", KvkFor("B"));
            db.Customers.Add(otherBusiness);
            db.CustomerMemberships.Add(CustomerMembership.Create(
                a.AccountId, otherBusiness.Id, MembershipRole.Trader,
                new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero)).Value);

            var now = DateTimeOffset.UtcNow;
            var token = RefreshToken.Issue(
                a.AccountId, otherBusiness.Id, RandomTokenHash(), now, now.AddDays(30));
            db.RefreshTokens.Add(token);
            await db.SaveChangesAsync();
            otherBusinessTokenId = token.Id;
        }

        await using var connection = new NpgsqlConnection(CustomerRoleConnectionString(factory.ConnectionString));
        await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await connection.ExecuteAsync(
            "SELECT set_config('app.customer_id', @value, true)",
            new { value = a.CustomerId.ToString() },
            transaction);

        var visibleIds = (await connection.QueryAsync<Guid>(
            "SELECT id FROM customer.refresh_token WHERE id = ANY(@ids)",
            new { ids = new[] { a.RefreshTokenId, otherBusinessTokenId } },
            transaction)).ToArray();

        visibleIds.ShouldHaveSingleItem().ShouldBe(
            a.RefreshTokenId,
            "one person, two businesses, two session chains - and a token for the business the " +
            "caller is not acting for must not be reachable, or a switch back would resurrect it");
    }
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~AuthSchemaTests" > /tmp/task9-before.txt 2>&1; cat /tmp/task9-before.txt`

Expected: **the build fails first** —
`error CS1501: No overload for method 'Issue' takes 5 arguments` in
`A_token_issued_for_one_business_is_invisible_to_the_other`. Fix that by writing the production code
(Steps 3–5); the assertion-level failures below are what you see on the run after the build is clean
but before the migration is appended:

- `The_refresh_token_policy_keys_on_its_OWN_customer_id_and_not_on_membership`:
  `policy should not contain "customer_account" but was "(EXISTS ( SELECT 1 FROM customer.customer_account a WHERE ((a.id = refresh_token.customer_account_id) AND …)))"`.
- `Every_refresh_token_row_names_a_business`: `should be "NO" but was null` — the column is not there.
- `The_tenant_role_can_rotate_a_token_but_still_cannot_rewrite_the_chain`:
  `insertable should be true but was false`.
- `A_token_issued_for_one_business_is_invisible_to_the_other`: `Npgsql.PostgresException : 42703:
  column "customer_id" of relation "refresh_token" does not exist` from the EF insert.

- [ ] **Step 3: Widen the domain type**

In `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/RefreshToken.cs`,
replace `:22-43` — before:

```csharp
    public Guid Id { get; private set; }
    public Guid CustomerAccountId { get; private set; }

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
            CustomerAccountId = accountId,
            TokenHash = tokenHash,
            IssuedAt = issuedAt,
            ExpiresAt = expiresAt,
        };
```

after:

```csharp
    public Guid Id { get; private set; }
    public Guid CustomerAccountId { get; private set; }

    /// <summary>
    /// The business this session is for. A session belongs to a business as well as to a person:
    /// after the switcher, one account can hold two live chains at once and a refresh has to know
    /// which one it is renewing.
    /// <para>
    /// ⚠ Its own column, NOT a join through <see cref="CustomerAccountId"/> to a membership, and
    /// the reason is a silent failure. Plan 4's removal revokes the member's tokens in the same
    /// transaction as the removal; under a policy that reached membership, that transaction would
    /// see its own removal, find no active membership, and revoke ZERO ROWS with no error anywhere -
    /// turning removal into re-pointing, so that a stolen cookie bound to one business became a
    /// valid session for another. Keying on this column makes revocation independent of the
    /// membership's state, which is the property that matters.
    /// </para>
    /// </summary>
    public Guid CustomerId { get; private set; }

    /// <summary>SHA-256 hex of the token. The token itself is never stored.</summary>
    public string TokenHash { get; private set; } = string.Empty;

    public DateTimeOffset IssuedAt { get; private set; }
    public DateTimeOffset ExpiresAt { get; private set; }
    public DateTimeOffset? UsedAt { get; private set; }
    public DateTimeOffset? RevokedAt { get; private set; }
    public Guid? ReplacedByTokenId { get; private set; }

    /// <param name="customerId">
    /// The business the session is for. Plan 2's <c>POST /api/v1/auth/active-business</c> passes the
    /// business being switched TO; sign-in and refresh pass the one the caller is already in.
    /// </param>
    public static RefreshToken Issue(
        Guid accountId,
        Guid customerId,
        string tokenHash,
        DateTimeOffset issuedAt,
        DateTimeOffset expiresAt) =>
        new()
        {
            Id = Guid.NewGuid(),
            CustomerAccountId = accountId,
            CustomerId = customerId,
            TokenHash = tokenHash,
            IssuedAt = issuedAt,
            ExpiresAt = expiresAt,
        };
```

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/RefreshTokenConfiguration.cs`,
insert after `:16` (`builder.HasIndex(t => t.CustomerAccountId);`):

```csharp

        // The business this session is for. Discovered by both coverage guards through the
        // customer_id suffix, which is deliberate: it makes this table's policy pair reviewable in
        // the same walk as every other tenant table's, where the old account-scoped-only shape
        // needed a widened predicate to be seen at all.
        //
        // No EF relationship to Customer declared: the constraint is in the migration's DDL, and a
        // navigation here would put customer rows into the insert ordering of every sign-in.
        builder.Property(t => t.CustomerId).IsRequired();
        builder.HasIndex(t => t.CustomerId);
```

- [ ] **Step 4: Move the four production and test call sites**

In `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`,
replace `:175-176` — before:

```csharp
                db.RefreshTokens.Add(RefreshToken.Issue(
                    account.Id, OpaqueToken.HashOf(refresh), now, refreshExpiresAt));
```

after:

```csharp
                db.RefreshTokens.Add(RefreshToken.Issue(
                    account.Id, account.CustomerId, OpaqueToken.HashOf(refresh), now, refreshExpiresAt));
```

and `:351-352` — before:

```csharp
        var replacement = RefreshToken.Issue(
            account.Id, OpaqueToken.HashOf(refresh), now, refreshExpiresAt);
```

after:

```csharp
        // The business the presented token was for, carried forward rather than re-derived: a
        // rotation renews a session, it does not change which business it belongs to. Plan 2's
        // switch is the only thing that changes it, and it mints a new chain rather than rotating
        // this one.
        var replacement = RefreshToken.Issue(
            account.Id, stored.CustomerId, OpaqueToken.HashOf(refresh), now, refreshExpiresAt);
```

⚠ `account.CustomerId` at the sign-in site is deliberate and temporary: it is still the right answer
while an account has exactly one business, and **Task 15** replaces it with the business sign-in
chooses from the account's memberships. It is written as `account.CustomerId` rather than hoisted
into a local so that Task 15's edit lands exactly here.

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/AuthSchemaTests.cs`,
replace `:151-152` — before:

```csharp
        var tokenA = RefreshToken.Issue(accountA.Id, RandomTokenHash(), now, now.AddDays(30));
        var tokenB = RefreshToken.Issue(accountB.Id, RandomTokenHash(), now, now.AddDays(30));
```

after:

```csharp
        var tokenA = RefreshToken.Issue(accountA.Id, customerA.Id, RandomTokenHash(), now, now.AddDays(30));
        var tokenB = RefreshToken.Issue(accountB.Id, customerB.Id, RandomTokenHash(), now, now.AddDays(30));
```

and `:438-439` — before:

```csharp
        var refreshA = RefreshToken.Issue(accountA.Id, RandomTokenHash(), now, now.AddDays(30));
        var refreshB = RefreshToken.Issue(accountB.Id, RandomTokenHash(), now, now.AddDays(30));
```

after:

```csharp
        var refreshA = RefreshToken.Issue(accountA.Id, customerA.Id, RandomTokenHash(), now, now.AddDays(30));
        var refreshB = RefreshToken.Issue(accountB.Id, customerB.Id, RandomTokenHash(), now, now.AddDays(30));
```

- [ ] **Step 5: Append step 7b to the migration**

Append inside `Up()`, after step 7a's block:

```csharp
            // -----------------------------------------------------------------------------------
            // 7b. refresh_token gets its own customer_id - and NOT the EXISTS shape 7a uses.
            //
            // ⚠ Shared contract section 5.2 is explicit about this, and the reason is a SILENT
            // failure. Plan 4's removal revokes the member's refresh tokens in the SAME TRANSACTION
            // as the removal. Under an EXISTS-through-membership policy that transaction sees its
            // own removal, finds no active membership, and revokes ZERO ROWS - with no error
            // anywhere. Removal would become re-pointing rather than revocation, and a stolen
            // cookie bound to business A would become a valid session for business B.
            //
            // Three statements to reach NOT NULL, because ADD COLUMN ... NOT NULL with no default
            // fails outright on a table with rows. The backfill reads
            // customer_account.customer_id, which still exists at this point and does not after
            // step 8 - which is the whole reason step 8 is last.
            //
            // ⚠ The grants. This table holds SELECT plus UPDATE (revoked_at) only - migration 3
            // narrowed it deliberately, because the FOR ALL policy's USING arm passes for the
            // caller's OWN rows, so RLS never stopped a customer connection deleting a used token
            // or nulling used_at/revoked_at/replaced_by_token_id, which is the evidence replay
            // detection reads. Rotating a token on a business switch needs INSERT and needs UPDATE
            // of used_at and replaced_by_token_id; both are added COLUMN-SCOPED, so the statement
            // that motivated the original narrowing is still refused and nulling revoked_at alone
            // is still all a sign-out may do. Without these three grants plan 2's switch is three
            // 42501s - and the one-line fix a hurried implementer reaches for is the owner
            // connection, which this codebase rejected by name for sign-out: "that bypasses RLS
            // entirely, leaving the handler's own WHERE clause as the only thing deciding whose
            // tokens get revoked."
            //
            // The policy keeps its migration-3 name, refresh_token_tenant_isolation, which
            // AuthSchemaTests pins by hand.
            // -----------------------------------------------------------------------------------
            migrationBuilder.Sql(
                """
                ALTER TABLE customer.refresh_token
                    ADD COLUMN customer_id uuid NULL REFERENCES customer.customer(id);

                UPDATE customer.refresh_token t
                SET customer_id = a.customer_id
                FROM customer.customer_account a
                WHERE a.id = t.customer_account_id;

                ALTER TABLE customer.refresh_token ALTER COLUMN customer_id SET NOT NULL;

                CREATE INDEX ix_refresh_token_customer_id
                    ON customer.refresh_token (customer_id);

                DROP POLICY refresh_token_tenant_isolation ON customer.refresh_token;

                CREATE POLICY refresh_token_tenant_isolation ON customer.refresh_token
                    FOR ALL TO app_customer_role
                    USING      (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
                    WITH CHECK (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid);

                GRANT INSERT ON customer.refresh_token TO app_customer_role;
                GRANT UPDATE (used_at, replaced_by_token_id) ON customer.refresh_token TO app_customer_role;
                """);

            // -----------------------------------------------------------------------------------
            // 7b (continued). The evidence columns may be SET and never CLEARED.
            //
            // ⚠ NOT in the shared contract, and it is here because the contract's own grant above
            // re-opens a hole migration 3 closed and documented. With used_at, revoked_at AND
            // replaced_by_token_id all granted to app_customer_role, the exact statement migration
            // 3 narrowed this table for -
            //     UPDATE customer.refresh_token
            //     SET used_at = NULL, revoked_at = NULL, replaced_by_token_id = NULL
            // - names only granted columns, and the FOR ALL policy's USING arm passes for the
            // caller's own rows, so nothing refuses it. It unmarks a used, revoked, replaced token
            // and hands it back as a live credential. Migration 3's comment is explicit that
            // "nulling revoked_at is worse than deleting: it resurrects a token password-reset
            // completion had just killed."
            //
            // A GRANT cannot express "you may set this column, not clear it". A trigger can, and
            // this repository already uses exactly that mechanism for exactly this class of
            // problem: 20260908080123_CustomerEntitlements.cs:138-169 keeps that table append-only
            // the same way, with the same reasoning about the owner - the trigger binds the owner
            // too, DELIBERATELY, because the Worker, the seeders and every test fixture write on
            // the owner connection and an invariant the owner may break is one a fixture breaks
            // first and production second.
            //
            // What stays legal is exactly what a rotation and a sign-out do: NULL -> a value on any
            // of the three. Setting used_at to a DIFFERENT non-null value is also legal and is not
            // worth forbidding - it is not the resurrection this exists to stop, and forbidding it
            // would make an idempotent retry of a rotation fail.
            // -----------------------------------------------------------------------------------
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION customer.refresh_token_evidence_is_monotonic()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $fn$
                BEGIN
                    IF (OLD.used_at              IS NOT NULL AND NEW.used_at              IS NULL)
                    OR (OLD.revoked_at           IS NOT NULL AND NEW.revoked_at           IS NULL)
                    OR (OLD.replaced_by_token_id IS NOT NULL AND NEW.replaced_by_token_id IS NULL) THEN
                        RAISE EXCEPTION
                            'customer.refresh_token records evidence: used_at, revoked_at and replaced_by_token_id may be set, never cleared'
                            USING ERRCODE = 'restrict_violation';
                    END IF;

                    RETURN NEW;
                END
                $fn$;

                CREATE TRIGGER trg_refresh_token_evidence_monotonic
                    BEFORE UPDATE ON customer.refresh_token
                    FOR EACH ROW
                    EXECUTE FUNCTION customer.refresh_token_evidence_is_monotonic();
                """);
```

and **prepend** to `Down()`, before Task 8's block:

```csharp
            // Undo 7b. The original predicate is migration 3's, restored verbatim.
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS trg_refresh_token_evidence_monotonic ON customer.refresh_token;
                DROP FUNCTION IF EXISTS customer.refresh_token_evidence_is_monotonic();

                REVOKE INSERT ON customer.refresh_token FROM app_customer_role;
                REVOKE UPDATE (used_at, replaced_by_token_id) ON customer.refresh_token FROM app_customer_role;

                DROP POLICY IF EXISTS refresh_token_tenant_isolation ON customer.refresh_token;
                CREATE POLICY refresh_token_tenant_isolation ON customer.refresh_token
                    FOR ALL TO app_customer_role
                    USING (EXISTS (
                        SELECT 1 FROM customer.customer_account a
                        WHERE a.id = customer.refresh_token.customer_account_id
                          AND a.customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid))
                    WITH CHECK (EXISTS (
                        SELECT 1 FROM customer.customer_account a
                        WHERE a.id = customer.refresh_token.customer_account_id
                          AND a.customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid));

                DROP INDEX IF EXISTS customer.ix_refresh_token_customer_id;
                ALTER TABLE customer.refresh_token DROP COLUMN IF EXISTS customer_id;
                """);
```

- [ ] **Step 6: Re-point migration 3's chain-rewrite test at the mechanism that now holds it**

⚠ `AuthSchemaTests.The_tenant_role_cannot_rewrite_the_rotation_chain_of_its_own_refresh_token`
(`:290-312`) asserts that `SET used_at = NULL, revoked_at = NULL, replaced_by_token_id = NULL` fails
with `42501`. It did, because `used_at` and `replaced_by_token_id` were not granted. They are now,
so a **privilege** no longer refuses that statement — the **trigger** does, with
`restrict_violation` (`23001`). The property is strictly stronger than before: a privilege leaves
the owner free, and the trigger does not.

Replace `:308-311` — before:

```csharp
        var exception = await Should.ThrowAsync<PostgresException>(update);
        exception.SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege, StaleDatabaseHint);
    }
```

after:

```csharp
        var exception = await Should.ThrowAsync<PostgresException>(update);

        // ⚠ 23001 (restrict_violation), not 42501, since migration 15 - and the change is a
        // strengthening rather than a weakening. Shared contract section 5.3 grants
        // UPDATE (used_at, replaced_by_token_id) so plan 2's business switch can rotate a token,
        // which means a PRIVILEGE no longer refuses this statement: all three columns it names are
        // granted now. What refuses it is trg_refresh_token_evidence_monotonic, which forbids any
        // non-null-to-null transition on the three evidence columns - and unlike a grant, a trigger
        // binds the OWNER too, so the Worker, the seeders and every fixture are covered as well.
        exception.SqlState.ShouldBe(
            "23001",
            "restrict_violation from trg_refresh_token_evidence_monotonic. " + StaleDatabaseHint);
    }
```

⚠ Do **not** also change
`The_tenant_role_cannot_delete_its_own_refresh_token` (`:266-288`) or
`The_tenant_role_can_revoke_its_own_refresh_token_because_that_is_what_signing_out_is` (`:322-352`).
`DELETE` is still ungranted, so the first stays `42501`; a sign-out is a null-to-value transition,
so the second still reports one row affected. Both must stay green under this task, and a run in
which either moves means the trigger is too wide.

- [ ] **Step 7: Move the three discovery counts the new column changes**

`refresh_token` now carries a `customer_id` column and a `CustomerId` property, so it is discovered by
the `CustomerId` arm of both coverage guards as well as by the `CustomerAccountId` arm. The union is
unchanged — it was already in it — so only the two per-predicate numbers move.

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`,
replace `:768` — before:

```csharp
        customerIdOwned.Length.ShouldBe(13);
```

after:

```csharp
        // Fourteen: RefreshToken joins, because migration 15 gives it its own CustomerId rather
        // than deriving one through the account join. ⚠ customerOwned below does NOT move - the
        // union already contained it through AccountIdOwned - which is precisely why these two
        // predicates are pinned separately rather than only as a total.
        customerIdOwned.Length.ShouldBe(14);
```

and `:1050` — before:

```csharp
        customerIdTables.Count.ShouldBe(13);
```

after:

```csharp
        // Fourteen: customer.refresh_token now carries a customer_id column of its own.
        customerIdTables.Count.ShouldBe(14);
```

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs`,
the `expected` array at `:155-161` is **unchanged** — `RefreshToken` is already in it, discovered
through `CustomerAccountId`. ⚠ Confirm that by running the test rather than by reasoning about it;
if it moves, the walk found something else and that is worth knowing.

- [ ] **Step 8: Run everything and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln --nologo > /tmp/task9-after.txt 2>&1; tail -30 /tmp/task9-after.txt
tools/verify-migrator.sh
```

Expected: build clean; the **whole solution** green — including
`No_policy_anywhere_still_reads_customer_account_dot_customer_id`, which was the one declared red
test at the end of Task 8. `verify-migrator.sh` green.

- [ ] **Step 9: Mutate the policy to the shape the contract forbids**

Replace `refresh_token_tenant_isolation`'s predicate with the `EXISTS` shape 7a uses — the
"consistency" a reviewer will ask for:

```sql
                CREATE POLICY refresh_token_tenant_isolation ON customer.refresh_token
                    FOR ALL TO app_customer_role
                    USING (EXISTS (
                        SELECT 1 FROM customer.customer_membership m
                        WHERE m.account_id = customer.refresh_token.customer_account_id
                          AND m.customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid
                          AND m.removed_at IS NULL))
                    WITH CHECK (EXISTS (
                        SELECT 1 FROM customer.customer_membership m
                        WHERE m.account_id = customer.refresh_token.customer_account_id
                          AND m.customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid
                          AND m.removed_at IS NULL));
                    -- MUTATION
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~AuthSchemaTests" > /tmp/task9-mutant.txt 2>&1; cat /tmp/task9-mutant.txt`

Expected: FAIL, `The_refresh_token_policy_keys_on_its_OWN_customer_id_and_not_on_membership` —

```
policy
    should not contain
"customer_membership"
    but was
"(EXISTS ( SELECT 1 FROM customer.customer_membership m WHERE …))"
```

followed by `revocation must be independent of the membership's state, or plan 4's removal silently
revokes nothing`.

⚠ **Every other test in the suite stays green**, and that is the finding worth writing down. The
mutant behaves identically for every operation plan 1 ships; the failure it introduces is entirely
in plan 4's future, inside one transaction, revoking zero rows without raising anything. Nothing
behavioural in this plan can catch it, which is exactly why this test reads the policy's text.

Restore. Now mutate the grant instead — widen `UPDATE (used_at, replaced_by_token_id)` to the table:

```sql
                GRANT UPDATE ON customer.refresh_token TO app_customer_role;   -- MUTATION
```

Expected: **one** failure,
`The_tenant_role_can_rotate_a_token_but_still_cannot_rewrite_the_chain` —
`updatable should be "replaced_by_token_id,revoked_at,used_at" but was` the full column list,
`token_hash`, `expires_at` and `issued_at` among them.

⚠ `The_tenant_role_cannot_rewrite_the_rotation_chain_of_its_own_refresh_token` stays **green** under
this mutation, and that is worth reading twice: since Step 6 it is held by the trigger, which a
wider grant does not touch. The two mechanisms now guard different things — the grant decides which
columns may be written at all, the trigger decides which direction they may move — and each has its
own test. Before this task, one test stood for both.

Finally mutate the trigger rather than the grant — invert one comparison so a cleared `revoked_at`
slips through:

```sql
                    IF (OLD.used_at              IS NOT NULL AND NEW.used_at              IS NULL)
                    OR (OLD.replaced_by_token_id IS NOT NULL AND NEW.replaced_by_token_id IS NULL) THEN
                    -- MUTATION: the revoked_at arm removed
```

Expected: **two** failures.
- `The_evidence_columns_may_be_SET_but_never_CLEARED`:
  `Should.ThrowAsync<PostgresException>() … but no exception was thrown`.
- `The_tenant_role_cannot_rewrite_the_rotation_chain_of_its_own_refresh_token`: the same — its
  statement nulls all three, and with the `revoked_at` arm gone the other two arms still fire, so
  ⚠ **check which**: if this one stays green the mutation was wrong and you removed a different arm.
  Re-read before concluding.

Restore and confirm:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -c "MUTATION" src/Infrastructure/PeakPower.Persistence/Migrations/*_MultiBusinessMembership.cs \
  > /tmp/task9-restore.txt; cat /tmp/task9-restore.txt
```

Expected: `0`.

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence/Migrations \
        src/Core/PeakPower.Domain/Customers/RefreshToken.cs \
        src/Infrastructure/PeakPower.Persistence/Configurations/RefreshTokenConfiguration.cs \
        src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs \
        tests/PeakPower.Integration.Tests
git commit -m "feat: refresh_token gets its own customer_id, and the grants a rotation needs

A session belongs to a business as well as to a person: after the switcher one account holds
two live chains and a refresh has to know which it is renewing.

⚠ Its own column and NOT the EXISTS-through-membership shape the account policy uses, and
the reason is a silent failure rather than a style preference. Plan 4's removal revokes the
member's tokens in the SAME transaction as the removal; under a membership-derived policy
that transaction sees its own removal, finds no active membership, and revokes zero rows
with no error - removal becomes re-pointing, and a stolen cookie bound to A becomes a valid
session for B. Verified by mutation: switching to that shape turns exactly one test red, the
one that reads the policy's own text, and leaves every behavioural test in the suite green -
because the damage is entirely in plan 4's future.

The grants move too: rotation needs INSERT and UPDATE of used_at and replaced_by_token_id,
column-scoped. ⚠ That re-opens the hole migration 3 documented - with all three evidence
columns granted, SET used_at = NULL, revoked_at = NULL, replaced_by_token_id = NULL names
only granted columns and succeeds, resurrecting a session password-reset completion had just
killed. A GRANT cannot say "you may set this, not clear it". A trigger can, and migration 10
already uses exactly that mechanism on customer_entitlement, so this migration adds
trg_refresh_token_evidence_monotonic. It binds the owner too, deliberately. Migration 3's
own chain-rewrite test moves from 42501 to 23001 and is strictly stronger for it.

Deviation D8, recorded for the contract owner: shared contract section 5.3's grant needs the
trigger beside it or it is a regression.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 10: PROBE — cross-tenant account reach. An admin of B cannot rewrite a shared member's credentials

Shared contract §11: *"An admin of B cannot update `password_hash` or `security_stamp` of a person
who is also in A."*

⚠ **This probe could not have been written before this plan.** Under column-shaped tenancy an account
lived in exactly one company, so two tenants' reachable account sets were **disjoint by
construction** and "an admin of B reaching a member of A" was not a state the schema could produce.
Under membership they **overlap**, on a table carrying `password_hash` and `security_stamp`. Task 8's
column-scoped grant is the answer; this is the test that says the answer works, and it is deliberately
written so that it fails loudly if somebody ever "simplifies" the grant back to the table.

⚠ **The positive control is the whole test.** A refusal here proves nothing on its own — the row
might simply be invisible, which is the case for every *other* account in company A and is not what
this probe is about. So the class first proves the row **is** reachable from B (it must be: Sofie is
a member of B, the member list shows her, and plan 4 will let B's admin change her role), and only
then that the credential columns are refused. Reachable **and** unwritable is the property; either
half alone is a different, weaker claim.

**Files:**
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs` (append the class `CrossTenantAccountReachTests` at the end of the file)

**Interfaces:**
- Consumes: `TenancyFixture.SharedAccountId`, `.CompanyAAccountId`, `.CompanyBAccountId`,
  `.CompanyAId`, `.CompanyBId`, `.CustomerRoleConnectionString`, `.OwnerConnectionString`;
  the column-scoped grant from Task 8.
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Write the test**

Append to the **end** of
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`:

```csharp

/// <summary>
/// The CROSS-TENANT ACCOUNT REACH probe (shared contract section 11), and the one probe in this
/// plan that had no meaning before it.
/// <para>
/// ⚠ Under the tenancy this migration replaces, an account belonged to exactly one company, so two
/// tenants' reachable account sets were DISJOINT BY CONSTRUCTION and this scenario could not
/// exist. Under membership they OVERLAP - Sofie Dubois is a trader in company A and a viewer in
/// company B - on a table carrying <c>password_hash</c> and <c>security_stamp</c>. With
/// <c>customer_account</c>'s policy still FOR ALL and <c>app_customer_role</c> still holding full
/// DML, an admin of B could have rewritten the credentials of somebody who is also a member of A.
/// </para>
/// <para>
/// ⚠ Every negative below is worthless without <see cref="The_shared_members_row_IS_reachable_from_the_other_business"/>.
/// A refusal proves nothing on its own: it would look identical if the row were simply invisible,
/// which is true of every OTHER account in company A and is not what this probe is about. Reachable
/// AND unwritable is the property.
/// </para>
/// </summary>
[Collection(nameof(TenancyCollection))]
public sealed class CrossTenantAccountReachTests
{
    private readonly TenancyFixture _fixture;

    public CrossTenantAccountReachTests(TenancyFixture fixture) => _fixture = fixture;

    private async Task<(NpgsqlConnection Connection, NpgsqlTransaction Transaction)> ActingAsAsync(
        Guid accountId, Guid customerId, CancellationToken ct)
    {
        var connection = TenancyFixture.Connect(_fixture.CustomerRoleConnectionString);
        await connection.OpenAsync(ct);
        var transaction = await connection.BeginTransactionAsync(ct);

        await using var settings = new NpgsqlCommand(
            """
            SELECT set_config('app.account_id',  @accountId,  true),
                   set_config('app.customer_id', @customerId, true)
            """,
            connection,
            transaction);
        settings.Parameters.AddWithValue("accountId", accountId.ToString());
        settings.Parameters.AddWithValue("customerId", customerId.ToString());
        await settings.ExecuteNonQueryAsync(ct);

        return (connection, transaction);
    }

    [Fact]
    public async Task The_shared_members_row_IS_reachable_from_the_other_business()
    {
        // The floor under this class. It must be reachable - plan 4's member list shows her and
        // plan 4's role change writes her membership - and every refusal below only means something
        // because of it.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.CompanyBAccountId, _fixture.CompanyBId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var read = new NpgsqlCommand(
                "SELECT count(*) FROM customer.customer_account WHERE id = @id",
                connection,
                transaction);
            read.Parameters.AddWithValue("id", _fixture.SharedAccountId);

            Convert.ToInt32(await read.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture)
                .ShouldBe(
                    1,
                    "she is a member of this business, so her row is visible from it. Every " +
                    "refusal in this class is a PRIVILEGE, not the policy hiding the row - which " +
                    "is a much stronger claim and the only one worth making here");

            await transaction.RollbackAsync(ct);
        }
    }

    [Fact]
    public async Task An_account_in_company_A_that_is_NOT_a_member_of_B_is_invisible_from_B()
    {
        // The contrast that gives the test above its meaning: reachability is membership, not
        // "any account anywhere". Company A's admin is not in B and must not be visible from it.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.CompanyBAccountId, _fixture.CompanyBId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var read = new NpgsqlCommand(
                "SELECT count(*) FROM customer.customer_account WHERE id = @id",
                connection,
                transaction);
            read.Parameters.AddWithValue("id", _fixture.CompanyAAccountId);

            Convert.ToInt32(await read.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture)
                .ShouldBe(0);

            await transaction.RollbackAsync(ct);
        }
    }

    [Theory]
    [InlineData("password_hash = 'not-a-real-hash'")]
    [InlineData("security_stamp = gen_random_uuid()")]
    [InlineData("email = 'hijacked@example.test'")]
    [InlineData("status = 'DEACTIVATED'")]
    public async Task An_admin_of_B_cannot_write_any_column_of_a_shared_members_account(string assignment)
    {
        // ⚠ The credential columns are the headline and the other two are not padding. Rewriting
        // `email` re-points a password-reset link at an address the attacker controls, and setting
        // `status` locks somebody out of a business the attacker has no say in. All four are
        // refused by the same absent table-level UPDATE grant, and the theory is what stops a
        // future "just this one column" grant passing quietly.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.CompanyBAccountId, _fixture.CompanyBId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var update = new NpgsqlCommand(
                $"UPDATE customer.customer_account SET {assignment} WHERE id = @id",
                connection,
                transaction);
            update.Parameters.AddWithValue("id", _fixture.SharedAccountId);

            var thrown = await Should.ThrowAsync<PostgresException>(
                async () => await update.ExecuteNonQueryAsync(ct));

            thrown.SqlState.ShouldBe(
                PostgresErrorCodes.InsufficientPrivilege,
                "the row is visible to this connection - the first test in this class proves it - " +
                "so nothing but the absent column privilege refuses this write");
            thrown.MessageText.ShouldContain("permission denied", Case.Sensitive);

            await transaction.RollbackAsync(ct);
        }
    }

    [Fact]
    public async Task An_admin_of_B_cannot_delete_a_shared_members_account_either()
    {
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.CompanyBAccountId, _fixture.CompanyBId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var delete = new NpgsqlCommand(
                "DELETE FROM customer.customer_account WHERE id = @id", connection, transaction);
            delete.Parameters.AddWithValue("id", _fixture.SharedAccountId);

            (await Should.ThrowAsync<PostgresException>(
                async () => await delete.ExecuteNonQueryAsync(ct)))
                .SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege);

            await transaction.RollbackAsync(ct);
        }
    }

    [Fact]
    public async Task Nobody_can_write_their_OWN_credential_columns_either()
    {
        // Not a cross-tenant case at all, and here because a grant is not role-aware: the refusal
        // above is the ABSENCE of a table-level UPDATE privilege, so it holds for the caller's own
        // row too. Stated as its own test so that a future "surely you may change your own
        // password" grant has something to break. Changing a password is a password-reset
        // completion, which is anonymous and runs on the owner connection.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.CompanyAAccountId, _fixture.CompanyAId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var update = new NpgsqlCommand(
                "UPDATE customer.customer_account SET password_hash = 'mine' WHERE id = @id",
                connection,
                transaction);
            update.Parameters.AddWithValue("id", _fixture.CompanyAAccountId);

            (await Should.ThrowAsync<PostgresException>(
                async () => await update.ExecuteNonQueryAsync(ct)))
                .SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege);

            await transaction.RollbackAsync(ct);
        }
    }

    [Fact]
    public async Task The_one_column_an_authenticated_caller_MAY_write_is_the_preference_column()
    {
        // The positive control for the grant, and the reason it is column-scoped rather than a
        // blanket REVOKE. Plan 2's POST /api/v1/auth/active-business is authenticated by
        // definition, so it runs as app_customer_role and writes exactly this column and no other.
        // Without this test, a blanket revoke passes every other assertion in this class and plan 2
        // discovers the problem as a 42501 in an endpoint whose name explains nothing.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.SharedAccountId, _fixture.CompanyBId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var update = new NpgsqlCommand(
                """
                UPDATE customer.customer_account SET last_active_business_id = @business
                WHERE id = @id
                """,
                connection,
                transaction);
            update.Parameters.AddWithValue("business", _fixture.CompanyBId);
            update.Parameters.AddWithValue("id", _fixture.SharedAccountId);

            (await update.ExecuteNonQueryAsync(ct)).ShouldBe(
                1,
                "plan 2's business switch writes this column on an authenticated connection; a " +
                "blanket REVOKE UPDATE would make that endpoint a 42501");

            await transaction.RollbackAsync(ct);
        }
    }
}
```

- [ ] **Step 2: Run the tests and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~CrossTenantAccountReachTests"
```

Expected: PASS, nine cases (four theory cases plus five facts).

- [ ] **Step 3: Mutate the grant back to the table, then to a blanket revoke**

**(a) The regression this probe exists for.** In migration 15's step 7a, replace the column grant
with the table-level `UPDATE` that was there before:

```sql
                -- MUTATION
                GRANT UPDATE ON customer.customer_account TO app_customer_role;
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~CrossTenantAccountReachTests" > /tmp/task10-mutant-a.txt 2>&1; cat /tmp/task10-mutant-a.txt`

Expected: **six** failures — all four theory cases, plus
`Nobody_can_write_their_OWN_credential_columns_either`, each with
`Should.ThrowAsync<PostgresException>() … but no exception was thrown`, and
`An_admin_of_B_cannot_delete_a_shared_members_account_either` staying green because `DELETE` was
revoked separately.

⚠ Read the first of those twice before restoring. An admin of company B has just rewritten the
Argon2id hash of somebody whose primary business is company A, on a connection whose row-level
security was in force the entire time, and every other test in the solution stayed green. That is
the exact consequence of the tenancy rewrite not being equivalent.

Then confirm the blast radius elsewhere:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~RowLevelSecurityTests|FullyQualifiedName~AuthSchemaTests|FullyQualifiedName~SecurityStampTests"
```

Expected: **PASS**. Nothing else in the suite can see this. Two migrations' worth of tenancy tests,
none of which is about a table two tenants can both reach.

**(b) The over-correction.** Restore, then replace the column grant with nothing at all:

```sql
                REVOKE UPDATE, DELETE ON customer.customer_account FROM app_customer_role;
                -- MUTATION: GRANT UPDATE (last_active_business_id) removed
```

Run the same filter.
Expected: **one** failure,
`The_one_column_an_authenticated_caller_MAY_write_is_the_preference_column` —
`Npgsql.PostgresException : 42501: permission denied for table customer_account`, thrown from the
`UPDATE` rather than caught. Plan 2's business switch would be that error, in an endpoint whose name
explains nothing about it.

Restore and confirm:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -n "GRANT  UPDATE (last_active_business_id)" src/Infrastructure/PeakPower.Persistence/Migrations/*_MultiBusinessMembership.cs \
  > /tmp/task10-restore.txt
grep -c "MUTATION" src/Infrastructure/PeakPower.Persistence/Migrations/*_MultiBusinessMembership.cs \
  >> /tmp/task10-restore.txt
cat /tmp/task10-restore.txt
```

Expected: one hit for the grant, `0` for `MUTATION`.

- [ ] **Step 4: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs
git commit -m "test(tenancy): the cross-tenant account-reach probe

Shared contract section 11, and the one probe here that had no meaning before this plan.
Under column-shaped tenancy two companies' reachable account sets were disjoint by
construction; under membership they overlap, on the table carrying password_hash and
security_stamp.

The positive control is the test: it first proves the shared member's row IS visible from
the other business - it has to be, the member list shows her - and only then that every
credential column is refused. Reachable and unwritable is the property; a refusal alone
would look identical to the row simply being hidden, which is true of every other account in
that company and is not what this is about.

Verified by mutation: granting table-level UPDATE back turns six cases in this class red -
an admin of B rewriting the Argon2id hash of somebody whose business is A, under a policy
that was in force the whole time - while RowLevelSecurityTests, AuthSchemaTests and
SecurityStampTests all stay green. Nothing else in the suite can see it. The over-correction
is covered too: dropping the last_active_business_id column grant makes plan 2's business
switch a 42501.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 11: `ICustomerContext.Role`, and the two-setting request path in both middlewares

Design §9 step 3. **Observable for the first time in this plan, and the observable change is an
improvement**: a demotion takes effect on the next request rather than at the next fifteen-minute
token boundary. That matters more than it sounds, because the mechanism that covers it today —
bumping the security stamp on a privilege change — is being removed with the column.

The request path, shared contract §6, becomes five statements in one `NpgsqlBatch`:

```
1. SET LOCAL ROLE app_customer_role                     (no result set)
2. SELECT set_config('app.account_id',  $1, true)       (identity)
3. SELECT set_config('app.customer_id', $2, true)       (CLAIMED tenancy, not yet proven)
4. SELECT role FROM customer.customer_membership WHERE … (the proof)
5. SELECT security_stamp, status FROM customer.customer_account WHERE …
```

⚠ **Setting `app.customer_id` before the proof is deliberate and stays fail-closed.** The middleware
issues its statements as one batch, and a step that ran only conditionally on an earlier step's
result could not be batched — and the batch shape is the part earlier rounds got wrong empirically.
Setting the claimed value up front costs nothing: if the claim is forged there is no membership row,
step 4 refuses, and in the meantime every policy keyed on `app.customer_id` shows that tenant
nothing. **The proof is step 4's refusal, not the withholding of the setting.**

⚠ **Step 5's placement is load-bearing.** It must run **after** `app.customer_id` is set, or Task 8's
`EXISTS` policy hides the account row and every authenticated request 401s.

⚠ **`NpgsqlDataReader` result positioning is the empirical risk in this task.** `SET LOCAL ROLE`
returns no columns, so Npgsql does not surface it as an addressable result — the reader starts
already positioned on statement 2's one-column result. Today's three-statement batch therefore needs
exactly **one** `NextResultAsync` to reach statement 3, and the existing code says so in a comment
that records this being verified against real PostgreSQL 17, and records that getting it wrong
fails **closed** ("the account in this token no longer exists" for every request, not only a forged
one). Five statements therefore need **three** `NextResultAsync` calls: 2 → 3 → 4, read the
membership, then one more to reach 5. Step 5 below verifies that empirically rather than trusting the
arithmetic.

⚠ **`TenantScopeMiddleware` is not dead code and must not be deleted.** Its only user is the tenancy
probe app, which is how `RouteTableTenancyTests` proves the cross-tenant 404 contract for every
route. If it keeps writing `app.customer_id` from an unproven value and never writes
`app.account_id`, the probe exercises half the new predicate and stays green while covering less
than it did before.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/ICustomerContext.cs:8-23`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/ProvenMembership.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerSessionMiddleware.cs:35-133`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/TenantScopeMiddleware.cs:29-75`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/JwtCustomerContext.cs:25-26`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/UnscopedCustomerContext.cs:22`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/DevelopmentCustomerContext.cs:15`, `:25-27`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/NullCustomerContext.cs:34`, `:70`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/AppRoleConnectionStringTests.cs` (append)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/TenancyProbeApp.cs:189-195`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RouteTableTenancyTests.cs:159`, `:208`, `:237`, `:241`, `:271`, `:318`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/DevelopmentCustomerContextTests.cs:29`, `:45-98`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Auth/JwtCustomerContextTests.cs:25-58`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs:591-600`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs:236`

**Interfaces:**
- Consumes: `MembershipRole` (Task 1); `MembershipRoleWire.Parse` (Task 2);
  the membership table and its tenant-isolation policy (Task 3); memberships everywhere (Task 5).
- Produces: `ICustomerContext.Role` (`MembershipRole`) and the **removal** of
  `ICustomerContext.IsAdmin`;
  `ProvenMembership.HttpContextItemKey`, `.Record(HttpContext, MembershipRole)`,
  `.Read(HttpContext?)`;
  `CustomerSessionMiddleware.SetAccountScope`, `.SetTenantScope`, `.ReadMembership`, `.ReadAccount`
  (public statement constants, pinned by test);
  `TenantScopeMiddleware.AccountIdSetting`;
  `TenancyProbeApp.RequestAs(Guid customerId, Guid accountId, string method, string url)`.

- [ ] **Step 1: Write the failing tests**

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/AppRoleConnectionStringTests.cs`,
inside the existing class:

```csharp
    [Fact]
    public void the_account_id_setting_the_middleware_declares_matches_the_literal_the_policies_are_keyed_on()
    {
        // Pinned against a hard-coded literal, not the constant compared to itself. Migration 15's
        // customer_customer_membership_tenant_isolation is written against this exact string in
        // SQL and cannot see this file: a spelling drift does not raise anything anywhere, it just
        // makes the USING arm's account_id branch match nothing - so the switcher goes blind and
        // nobody finds out until a rail is empty.
        TenantScopeMiddleware.AccountIdSetting.ShouldBe("app.account_id");
    }

    [Fact]
    public void the_session_middleware_declares_both_scopes_with_set_config_and_never_with_SET_LOCAL()
    {
        // ⚠ House rule, stated in the existing code: "set_config, not SET LOCAL: SET does not
        // accept a parameter, and concatenating a value into a tenancy control is how injection
        // gets in." The new app.account_id line joins that pinning rather than being exempt from
        // it - it carries a value straight off a token.
        CustomerSessionMiddleware.SetAccountScope
            .ShouldBe("SELECT set_config('app.account_id', $1, true)");
        CustomerSessionMiddleware.SetTenantScope
            .ShouldBe("SELECT set_config('app.customer_id', $1, true)");
    }

    [Fact]
    public void the_membership_proof_reads_the_settings_rather_than_re_sending_the_claims()
    {
        // Shared contract section 6 step 3 reads current_setting, not a parameter, and the
        // difference is not cosmetic: reading the SETTING proves the setting is what the policies
        // will see. A parameterised version could agree with the claim and disagree with the
        // session state - which is precisely the class of bug the whole batch exists to avoid.
        CustomerSessionMiddleware.ReadMembership.ShouldContain(
            "current_setting('app.account_id')", Case.Sensitive);
        CustomerSessionMiddleware.ReadMembership.ShouldContain(
            "current_setting('app.customer_id')", Case.Sensitive);
        CustomerSessionMiddleware.ReadMembership.ShouldContain(
            "removed_at IS NULL", Case.Sensitive);
    }

    [Fact]
    public void the_account_read_is_keyed_on_the_setting_so_it_runs_AFTER_the_tenant_is_declared()
    {
        // ⚠ Step 5 must run after step 3's setting, or task 8's EXISTS policy hides the account row
        // and EVERY authenticated request 401s. Keying it on current_setting rather than on a
        // parameter is what makes that ordering visible in the statement itself.
        CustomerSessionMiddleware.ReadAccount.ShouldContain(
            "current_setting('app.account_id')", Case.Sensitive);
        CustomerSessionMiddleware.ReadAccount.ShouldContain("security_stamp", Case.Sensitive);
        CustomerSessionMiddleware.ReadAccount.ShouldContain("status", Case.Sensitive);
    }
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~AppRoleConnectionStringTests"`

Expected: **the build fails** —
`error CS0117: 'TenantScopeMiddleware' does not contain a definition for 'AccountIdSetting'` and
four `error CS0122: 'CustomerSessionMiddleware.SetTenant' is inaccessible due to its protection
level` / `CS0117` for `SetAccountScope`, `SetTenantScope`, `ReadMembership`, `ReadAccount`.

- [ ] **Step 3: Change the interface and its five implementations**

Replace
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/ICustomerContext.cs`
in full:

```csharp
using PeakPower.Domain.Customers;

namespace PeakPower.Application.Abstractions;

/// <summary>
/// THE tenancy seam <c>[F13-R30]</c>. Every piece of code that needs to know which customer
/// company a request belongs to reads it here and nowhere else.
/// </summary>
public interface ICustomerContext
{
    Guid CustomerId { get; }

    Guid AccountId { get; }

    /// <summary>
    /// What this account may do in the business it is acting for, PROVEN FROM THE DATABASE on this
    /// request rather than read off the token.
    /// <para>
    /// ⚠ This REPLACES <c>bool IsAdmin</c>; it is not added beside it. Two sources of truth for the
    /// same fact is how a demoted admin keeps admin rights for fifteen minutes - and the mechanism
    /// that covered that until now, bumping the security stamp on a privilege change, went away
    /// with the <c>is_admin</c> column it was bumping for.
    /// </para>
    /// <para>
    /// ⚠ There is no <c>role</c> claim on the access token. The database is the sole authority
    /// (design decision 8), which is why <c>CustomerSessionMiddleware</c> reads
    /// <c>customer_membership</c> on every authenticated request and why a request whose claimed
    /// business has no active membership is a 401 before any handler sees it.
    /// </para>
    /// </summary>
    MembershipRole Role { get; }

    /// <summary>
    /// False means "this request is not scoped to a customer". The global query filters read
    /// this: when it is false they are a no-op, which is exactly what the back office needs.
    /// The database's row-level security is what keeps that from being a hole — a connection
    /// that has not issued <c>set_config('app.customer_id', …)</c> sees nothing at all.
    /// </summary>
    bool IsAuthenticated { get; }
}
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/ProvenMembership.cs`:

```csharp
using Microsoft.AspNetCore.Http;
using PeakPower.Domain.Customers;

namespace PeakPower.Infrastructure.Web.Tenancy;

/// <summary>
/// The hand-off between the middleware that PROVES a role against the database and the
/// <c>ICustomerContext</c> implementation that reports it.
/// <para>
/// Both live in this assembly, which is the one architecture fact 6 allows to touch
/// <c>HttpContext</c> at all (<c>TenancyArchitectureTests.no_type_outside_the_context_provider_assembly_reads_a_claim</c>
/// and its <c>HttpContext</c> twin are the IL scans that enforce it). Passing the role through
/// <c>HttpContext.Items</c> rather than through a mutable property on the context keeps
/// <c>ICustomerContext</c> read-only for every consumer, which is what stops a handler "correcting"
/// its own role.
/// </para>
/// <para>
/// ⚠ Absence is not <c>Viewer</c>. An authenticated request that reaches a handler with nothing
/// recorded here means the middleware did not run, and the honest answer is an exception rather
/// than a quiet least-privilege guess that would make <c>CompanyAdmin</c> silently unreachable and
/// look like a permissions bug for as long as it took somebody to notice.
/// </para>
/// </summary>
public static class ProvenMembership
{
    /// <summary>
    /// The <c>HttpContext.Items</c> key. A literal string rather than a type-keyed entry because
    /// two middlewares write it and two contexts read it, and a shared constant is the only form
    /// in which all four provably mean the same thing.
    /// </summary>
    public const string HttpContextItemKey = "PeakPower.Tenancy.ProvenMembershipRole";

    public static void Record(HttpContext context, MembershipRole role)
    {
        ArgumentNullException.ThrowIfNull(context);
        context.Items[HttpContextItemKey] = role;
    }

    /// <summary>Null when nothing has been proven on this request.</summary>
    public static MembershipRole? Read(HttpContext? context) =>
        context is not null
        && context.Items.TryGetValue(HttpContextItemKey, out var value)
        && value is MembershipRole role
            ? role
            : null;
}
```

Replace `JwtCustomerContext.cs:25-26` — before:

```csharp
    public bool IsAdmin =>
        string.Equals(Principal?.FindFirst("is_admin")?.Value, "true", StringComparison.Ordinal);
```

after:

```csharp
    /// <summary>
    /// The role <c>CustomerSessionMiddleware</c> proved against <c>customer_membership</c> earlier
    /// in this request.
    /// <para>
    /// ⚠ Not a claim. There is no <c>role</c> claim on the token and there must not be one: the
    /// database is the sole authority (design decision 8), so a demotion bites on the very next
    /// request instead of at the next fifteen-minute boundary.
    /// </para>
    /// <para>
    /// Throws rather than defaulting when nothing was proven on an authenticated request. That
    /// state means <c>UseCustomerSession()</c> did not run - a pipeline ordering bug - and a quiet
    /// <c>Viewer</c> would make every <c>CompanyAdmin</c> endpoint refuse for a reason nobody could
    /// find.
    /// </para>
    /// </summary>
    public MembershipRole Role =>
        ProvenMembership.Read(accessor.HttpContext)
        ?? throw new InvalidOperationException(
            "No membership role has been proven for this request. UseCustomerSession() must run " +
            "after UseAuthentication() and before UseAuthorization(); it is what reads " +
            "customer.customer_membership and records the role.");
```

Replace `UnscopedCustomerContext.cs:22` — before:

```csharp
    public bool IsAdmin => false;
```

after:

```csharp
    /// <summary>
    /// The least-privileged value, and it is never consulted. This context is the employee host's,
    /// and the employee host does not register <c>CustomerAuthorizationPolicies.CompanyAdmin</c> at
    /// all - back-office authority comes from the employee realm, not from a customer membership.
    /// <c>Viewer</c> rather than <c>Admin</c> so that a future customer-side reader wiring this
    /// context by mistake is refused rather than waved through.
    /// </summary>
    public MembershipRole Role => MembershipRole.Viewer;
```

Replace `DevelopmentCustomerContext.cs:15` and `:25-27` — before:

```csharp
    public const string IsAdminHeader = "X-PeakPower-Is-Admin";
```

after: **delete that line entirely.**

before:

```csharp
    public bool IsAdmin =>
        IsAuthenticated &&
        string.Equals(ReadHeader(IsAdminHeader), "true", StringComparison.OrdinalIgnoreCase);
```

after:

```csharp
    /// <summary>
    /// ⚠ The <c>X-PeakPower-Is-Admin</c> header is GONE, and its absence is the point. A role a
    /// caller can assert about itself is exactly what design decision 8 abolishes: the database is
    /// the sole authority. <c>TenantScopeMiddleware</c> proves the role against
    /// <c>customer_membership</c> for this context the same way <c>CustomerSessionMiddleware</c>
    /// does for the token-backed one, and records it through <see cref="ProvenMembership"/>.
    /// </summary>
    public MembershipRole Role =>
        ProvenMembership.Read(_accessor.HttpContext)
        ?? throw new InvalidOperationException(
            "No membership role has been proven for this request. UseTenantScope() is what reads " +
            "customer.customer_membership and records it.");
```

Replace `NullCustomerContext.cs:34` and `:70` — before:

```csharp
    public bool IsAdmin => false;
```

after:

```csharp
    /// <summary>Least privilege, and never consulted: the migrator answers no HTTP request.</summary>
    public MembershipRole Role => MembershipRole.Viewer;
```

and before:

```csharp
    public bool IsAdmin => throw new InvalidOperationException(Message);
```

after:

```csharp
    public MembershipRole Role => throw new InvalidOperationException(Message);
```

Both need `using PeakPower.Domain.Customers;` at the top of `NullCustomerContext.cs`.

- [ ] **Step 4: Rewrite `CustomerSessionMiddleware`**

Replace `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerSessionMiddleware.cs:35-133` — that is, from `public sealed class` down to the end of `TryReadIdentity`:

```csharp
public sealed class CustomerSessionMiddleware(RequestDelegate next)
{
    private const string SetRole = "SET LOCAL ROLE app_customer_role";

    /// <summary>
    /// ⚠ <c>set_config</c>, never <c>SET LOCAL &lt;name&gt; = &lt;value&gt;</c>. House rule, and the
    /// reason is in the existing code in terms: "SET does not accept a parameter, and concatenating
    /// a value into a tenancy control is how injection gets in." Public and pinned by
    /// <c>AppRoleConnectionStringTests</c> against a hard-coded literal, because migration 15's
    /// policies are written against these exact strings in SQL and cannot see this file - a
    /// spelling drift raises nothing anywhere, it just makes a policy match nothing.
    /// </summary>
    public const string SetAccountScope = "SELECT set_config('app.account_id', $1, true)";

    public const string SetTenantScope = "SELECT set_config('app.customer_id', $1, true)";

    /// <summary>
    /// The proof. Reads <c>current_setting</c> rather than re-sending the claims as parameters, so
    /// that what is proven is what the POLICIES will see - a parameterised version could agree with
    /// the claim and disagree with the session state.
    /// </summary>
    public const string ReadMembership =
        """
        SELECT role FROM customer.customer_membership
        WHERE account_id  = current_setting('app.account_id')::uuid
          AND customer_id = current_setting('app.customer_id')::uuid
          AND removed_at IS NULL
        """;

    /// <summary>
    /// ⚠ Keyed on the SETTING, which is what makes its position in the batch visible in the
    /// statement itself: it must run AFTER <see cref="SetTenantScope"/>, or migration 15's EXISTS
    /// policy on <c>customer_account</c> hides the row and every authenticated request 401s.
    /// </summary>
    public const string ReadAccount =
        """
        SELECT security_stamp, status FROM customer.customer_account
        WHERE id = current_setting('app.account_id')::uuid
        """;

    public async Task InvokeAsync(HttpContext context, PeakPowerDbContext db)
    {
        if (context.User?.Identity?.IsAuthenticated != true)
        {
            // Anonymous endpoints — sign-in, refresh, password reset, onboarding — run on the
            // owner role with no tenant set. The allow-list test in
            // PeakPower.Integration.Tests.Auth.AnonymousEndpointAllowListTests is what stops an
            // endpoint getting here by accident.
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

        MembershipRole role;
        Guid storedStamp;
        string status;

        await using (var batch = new NpgsqlBatch(connection, dbTransaction))
        {
            batch.BatchCommands.Add(new NpgsqlBatchCommand(SetRole));
            batch.BatchCommands.Add(new NpgsqlBatchCommand(SetAccountScope)
            {
                Parameters = { new NpgsqlParameter { Value = accountId.ToString() } },
            });
            batch.BatchCommands.Add(new NpgsqlBatchCommand(SetTenantScope)
            {
                Parameters = { new NpgsqlParameter { Value = customerId.ToString() } },
            });
            batch.BatchCommands.Add(new NpgsqlBatchCommand(ReadMembership));
            batch.BatchCommands.Add(new NpgsqlBatchCommand(ReadAccount));

            await using var reader = await batch.ExecuteReaderAsync(cancellationToken);

            // ⚠ THREE NextResultAsync calls, not four. SET LOCAL ROLE has no target list, so
            // Npgsql's NpgsqlDataReader never surfaces it as an addressable result the way it does
            // for a command that returns columns — the reader's initial position (no
            // NextResultAsync call at all) already lands on SetAccountScope's own one-column
            // result. That was verified empirically against real PostgreSQL 17 when this batch had
            // three statements, and the failure mode of getting it wrong is documented there: it
            // fails CLOSED, rejecting every authenticated request with "the account in this token
            // no longer exists" rather than opening a hole. So:
            //   (initial)          -> SetAccountScope
            //   NextResultAsync #1 -> SetTenantScope
            //   NextResultAsync #2 -> ReadMembership   <- read here
            //   NextResultAsync #3 -> ReadAccount      <- and here
            await reader.NextResultAsync(cancellationToken);
            await reader.NextResultAsync(cancellationToken);

            if (!await reader.ReadAsync(cancellationToken))
            {
                // ⚠ THE PROOF. The customer_id claim was set two statements ago but never
                // believed; this is where it is either confirmed or refused. No active membership
                // means the token names a business this account is not in — a forged claim, a
                // replayed token from before a removal, or a switch that was reverted — and every
                // one of those is "not signed in" rather than "forbidden": [F13-R19] makes a 403 an
                // existence oracle for a cross-tenant read.
                await RejectAsync(context, "This account is not a member of that business.");
                return;
            }

            // One spelling of the three role literals, shared with the EF value converter, so the
            // middleware and the model cannot drift apart. Throws on an unknown name rather than
            // silently reading member zero, which is Admin.
            role = MembershipRoleWire.Parse(reader.GetString(0));

            await reader.NextResultAsync(cancellationToken);

            if (!await reader.ReadAsync(cancellationToken))
            {
                // The account is gone. Not "hidden by the tenant policy" any more - the membership
                // above already proved the tenancy - so this really is a deleted row.
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

        // Recorded only once every refusal above is behind us, so that a handler can never see a
        // role from a request that was going to be rejected anyway.
        ProvenMembership.Record(context, role);

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
        // ⚠ Both ids are Guid.TryParse'd before they touch a statement, and that is the whole
        // input validation on a value that is about to be handed to set_config. There is no role
        // claim to read: design decision 8 takes the role off the token entirely.
        customerId = accountId = stamp = Guid.Empty;
        return Guid.TryParse(user.FindFirst("customer_id")?.Value, out customerId)
            && Guid.TryParse(user.FindFirst("sub")?.Value, out accountId)
            && Guid.TryParse(user.FindFirst("stamp")?.Value, out stamp);
    }
```

and add the two usings the file needs, after `:7`:

```csharp
using PeakPower.Domain.Customers;
using PeakPower.Persistence.Configurations;
```

- [ ] **Step 5: Verify the reader positioning empirically before believing it**

⚠ Do this **before** running the whole suite, because if the count is wrong every authenticated test
fails at once with the same message and the cause is not obvious from any of them.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~SecurityStampTests.A_fresh_token_is_accepted" \
  > /tmp/task11-positioning.txt 2>&1; cat /tmp/task11-positioning.txt
```

Expected: PASS.

If it fails with `This account is not a member of that business.` on an account that demonstrably
has one, the reader is one result short or one too far. Do **not** guess: add one `NextResultAsync`,
re-run, and if that gives `The account in this token no longer exists.` instead, you have gone one
too far. The two messages are distinguishable on purpose and between them they say which direction
to move. Record what the correct number turned out to be in the comment above the calls, replacing
the reasoning rather than adding to it.

- [ ] **Step 6: Give `TenantScopeMiddleware` the same proof**

Replace `TenantScopeMiddleware.cs:29-75` — that is, from `public const string CustomerIdSetting`
through the end of `InvokeAsync`:

```csharp
    public const string CustomerIdSetting = "app.customer_id";

    /// <summary>
    /// The identity half of the pair, new in migration 15. Migration 15's
    /// <c>customer_customer_membership_tenant_isolation</c> reads
    /// <c>current_setting('app.account_id', true)</c> in its <c>USING</c> arm - that is the branch
    /// the business switcher needs - and in both terms of its <c>WITH CHECK</c> arm. Pinned as a
    /// literal for the same reason <see cref="CustomerIdSetting"/> is: the SQL is written in
    /// parallel and cannot see this file, and a drift makes a policy match nothing rather than
    /// raising anything.
    /// </summary>
    public const string AccountIdSetting = "app.account_id";

    /// <summary>
    /// The <c>set_config</c> call that declares a scope. The third argument, <c>is_local</c>, must
    /// stay <c>true</c>: that is what makes the setting transaction-local (<c>SET LOCAL</c>
    /// semantics) rather than session-local. Npgsql pools physical connections, so a session-local
    /// setting would survive past the transaction that set it and leak the previous request's
    /// customer id onto whichever request borrows that connection next - a silent cross-tenant
    /// read, not an error anywhere.
    /// </summary>
    public const string SetCustomerScopeSql = "SELECT set_config({0}, {1}, true)";

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
        //
        // ⚠ BOTH settings, and app.account_id first. This middleware is not production wiring - its
        // only user is the tenancy probe app - but it must perform the SAME proof as
        // CustomerSessionMiddleware, or the probe exercises half of migration 15's predicate and
        // stays green while covering less than it did before. Declaring only the tenant and never
        // the identity would leave the USING arm's account_id branch permanently unmatched.
        await db.Database.ExecuteSqlRawAsync(
            SetCustomerScopeSql,
            [AccountIdSetting, tenancy.AccountId.ToString()],
            context.RequestAborted);

        await db.Database.ExecuteSqlRawAsync(
            SetCustomerScopeSql,
            [CustomerIdSetting, tenancy.CustomerId.ToString()],
            context.RequestAborted);

        // ⚠ The proof, exactly as shared contract section 6 step 3 specifies it. The claimed
        // tenancy above is not believed until a live membership says so. Read through EF rather
        // than as raw SQL because this middleware is EF-shaped already and because the entity
        // carries no query filter (the switcher must read across businesses), so what comes back is
        // what the POLICY permits and nothing narrower.
        var role = await db.CustomerMemberships
            .Where(membership =>
                membership.AccountId == tenancy.AccountId &&
                membership.CustomerId == tenancy.CustomerId &&
                membership.RemovedAt == null)
            .Select(membership => (MembershipRole?)membership.Role)
            .FirstOrDefaultAsync(context.RequestAborted);

        if (role is null)
        {
            // 401, never 403: [F13-R19] makes a 403 an existence oracle for a cross-tenant read,
            // and "you named a business you are not in" is exactly the question a probe would ask.
            await transaction.RollbackAsync(context.RequestAborted);
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            context.Response.ContentType = "application/problem+json";
            await context.Response.WriteAsJsonAsync(
                new Microsoft.AspNetCore.Mvc.ProblemDetails
                {
                    Status = StatusCodes.Status401Unauthorized,
                    Title = "Not signed in",
                    Detail = "This account is not a member of that business.",
                });
            return;
        }

        ProvenMembership.Record(context, role.Value);

        await _next(context);

        if (context.Response.StatusCode >= StatusCodes.Status500InternalServerError)
        {
            await transaction.RollbackAsync(context.RequestAborted);
            return;
        }

        await transaction.CommitAsync(context.RequestAborted);
    }
```

adding the usings the file now needs, after `:5`:

```csharp
using PeakPower.Domain.Customers;
```

- [ ] **Step 7: Teach the probe app to send an account, and move the four context test doubles**

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/TenancyProbeApp.cs`,
replace `:189-195` — before:

```csharp
    public HttpRequestMessage RequestAs(Guid customerId, string method, string url)
    {
        var request = new HttpRequestMessage(new HttpMethod(method), url);
        request.Headers.TryAddWithoutValidation(
            DevelopmentCustomerContext.CustomerIdHeader, customerId.ToString());
        return request;
    }
```

after:

```csharp
    /// <param name="accountId">
    /// ⚠ New in migration 15, and not optional. <c>TenantScopeMiddleware</c> now proves the claimed
    /// business against <c>customer_membership</c> before any handler runs, which needs an identity
    /// as well as a tenant - a request carrying only the customer header would be 401'd by the
    /// proof rather than reaching the route under test, and every route assertion in
    /// <c>RouteTableTenancyTests</c> would fail for a reason that has nothing to do with routes.
    /// </param>
    public HttpRequestMessage RequestAs(Guid customerId, Guid accountId, string method, string url)
    {
        var request = new HttpRequestMessage(new HttpMethod(method), url);
        request.Headers.TryAddWithoutValidation(
            DevelopmentCustomerContext.CustomerIdHeader, customerId.ToString());
        request.Headers.TryAddWithoutValidation(
            DevelopmentCustomerContext.AccountIdHeader, accountId.ToString());
        return request;
    }
```

and update its six call sites in
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RouteTableTenancyTests.cs`
(`:159`, `:208`, `:237`, `:241`, `:271`, `:318`), inserting `_fixture.CompanyAAccountId` as the
second argument in each. For example, `:159` — before:

```csharp
            using var request = _probe.RequestAs(_fixture.CompanyAId, entry.HttpMethod, url);
```

after:

```csharp
            using var request = _probe.RequestAs(
                _fixture.CompanyAId, _fixture.CompanyAAccountId, entry.HttpMethod, url);
```

Move the four `ICustomerContext` test doubles. In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs:591-600`
— before:

```csharp
file sealed class ScopedCustomerContext(Guid customerId) : ICustomerContext
{
    public Guid CustomerId { get; } = customerId;

    public Guid AccountId => Guid.Empty;

    public bool IsAdmin => false;

    public bool IsAuthenticated => true;
}
```

after:

```csharp
file sealed class ScopedCustomerContext(Guid customerId) : ICustomerContext
{
    public Guid CustomerId { get; } = customerId;

    public Guid AccountId => Guid.Empty;

    /// <summary>
    /// Least privilege. These tests are about the QUERY FILTER, which never reads the role - and a
    /// double that reported Admin would make an accidental role-dependent filter pass quietly.
    /// </summary>
    public MembershipRole Role => MembershipRole.Viewer;

    public bool IsAuthenticated => true;
}
```

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs:236`
— before:

```csharp
        public bool IsAdmin => throw new InvalidOperationException(
```

after:

```csharp
        public MembershipRole Role => throw new InvalidOperationException(
```

keeping whatever message follows it on the next line.

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/DevelopmentCustomerContextTests.cs`,
replace `:29` — before:

```csharp
        DevelopmentCustomerContext.IsAdminHeader.ShouldBe("X-PeakPower-Is-Admin");
```

after:

```csharp
        // ⚠ Asserted as an ABSENCE. A role a caller can assert about itself is exactly what design
        // decision 8 abolishes - the database is the sole authority - so this header must not come
        // back under any name. A reflection check rather than a comment, because a re-added constant
        // is the kind of thing a merge reinstates.
        typeof(DevelopmentCustomerContext)
            .GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)
            .Select(field => field.Name)
            .ShouldBe(["CustomerIdHeader", "AccountIdHeader"], ignoreOrder: true);
```

and replace the four `IsAdmin` assertions at `:51`, `:62`, `:87` and `:98` with a single test — delete
those four assertions from their tests and append:

```csharp
    [Fact]
    public void The_role_is_not_readable_until_a_middleware_has_proven_one()
    {
        // The development context is header-driven, and there is deliberately no header for this.
        // Nothing has run TenantScopeMiddleware here, so nothing has been recorded, and the honest
        // answer is an exception naming the middleware rather than a quiet Viewer that would make
        // every CompanyAdmin endpoint refuse for an unfindable reason.
        var accessor = new HttpContextAccessor { HttpContext = new DefaultHttpContext() };
        var context = new DevelopmentCustomerContext(accessor);

        Should.Throw<InvalidOperationException>(() => _ = context.Role)
            .Message.ShouldContain("UseTenantScope", Case.Sensitive);
    }

    [Fact]
    public void A_proven_role_is_what_the_context_reports()
    {
        var accessor = new HttpContextAccessor { HttpContext = new DefaultHttpContext() };
        ProvenMembership.Record(accessor.HttpContext!, MembershipRole.Admin);
        var context = new DevelopmentCustomerContext(accessor);

        context.Role.ShouldBe(MembershipRole.Admin);
    }
```

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Auth/JwtCustomerContextTests.cs:25-58`,
replace the three `IsAdmin` tests with two that assert the new behaviour:

```csharp
    [Fact]
    public void The_role_comes_from_the_middlewares_proof_and_not_from_a_claim()
    {
        // ⚠ Even a token that CARRIES an is_admin claim must not produce an Admin role. Design
        // decision 8 takes the role off the token; a context that still read one would reinstate
        // the fifteen-minute demotion window this whole change exists to close.
        var accessor = ContextFor(
            new Claim("sub", Guid.NewGuid().ToString()),
            new Claim("customer_id", Guid.NewGuid().ToString()),
            new Claim("is_admin", "true"));
        ProvenMembership.Record(accessor.HttpContext!, MembershipRole.Trader);

        new JwtCustomerContext(accessor).Role.ShouldBe(MembershipRole.Trader);
    }

    [Fact]
    public void Reading_the_role_before_the_middleware_has_proven_one_throws()
    {
        var accessor = ContextFor(
            new Claim("sub", Guid.NewGuid().ToString()),
            new Claim("customer_id", Guid.NewGuid().ToString()));

        Should.Throw<InvalidOperationException>(() => _ = new JwtCustomerContext(accessor).Role)
            .Message.ShouldContain("UseCustomerSession", Case.Sensitive);
    }
```

⚠ `ContextFor` is whatever this file already calls its principal-building helper; read `:1-30` and
use the existing name rather than adding a second one. If it returns a `ClaimsPrincipal` rather than
an accessor, keep its shape and build the accessor beside it.

- [ ] **Step 8: Run everything and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln --nologo > /tmp/task11-after.txt 2>&1; tail -40 /tmp/task11-after.txt
```

Expected: build clean; the whole solution green.

⚠ If `RouteTableTenancyTests` fails wholesale with `This account is not a member of that business.`,
the probe's account header is not reaching `DevelopmentCustomerContext.AccountId` — read
`DevelopmentCustomerContext.cs:23`, which gates `AccountId` on `IsAuthenticated`, and confirm the
customer header is present on the same request.

- [ ] **Step 9: Mutate the proof away, then the ordering**

**(a) Delete the proof.** In `CustomerSessionMiddleware`, drop `ReadMembership` from the batch and
hard-code a role, adjusting the reader calls so the batch still lines up:

```csharp
            batch.BatchCommands.Add(new NpgsqlBatchCommand(ReadAccount));
            // MUTATION: ReadMembership removed from the batch

            await using var reader = await batch.ExecuteReaderAsync(cancellationToken);
            await reader.NextResultAsync(cancellationToken);
            await reader.NextResultAsync(cancellationToken);
            role = MembershipRole.Trader;   // MUTATION
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~SecurityStampTests" > /tmp/task11-mutant-a.txt 2>&1; cat /tmp/task11-mutant-a.txt`

Expected: FAIL,
`A_token_whose_customer_id_does_not_match_the_accounts_real_tenant_is_rejected` —
`body.Contains("no longer exists") should be true but was false`, because the request now reaches the
handler and the EF query filter refuses it at the endpoint with a **404** rather than the middleware
refusing it with a 401. ⚠ That is the same finding `SecurityStampTests`' own doc comment already
records about removing `SET LOCAL ROLE`: two independent layers, and killing one shifts the failure
one layer out rather than opening a hole. Task 13 is where a probe that distinguishes them lands.

**(b) Move the account read before the tenant setting** — the ordering shared contract §6's third
bullet is about:

```csharp
            batch.BatchCommands.Add(new NpgsqlBatchCommand(SetAccountScope) { … });
            batch.BatchCommands.Add(new NpgsqlBatchCommand(ReadAccount));      // MUTATION: moved up
            batch.BatchCommands.Add(new NpgsqlBatchCommand(SetTenantScope) { … });
            batch.BatchCommands.Add(new NpgsqlBatchCommand(ReadMembership));
```

Restore the reader's positioning to match, then run:
`dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~SecurityStampTests|FullyQualifiedName~CompanyEndpointTests"`

Expected: FAIL, and **broadly** —
`A_fresh_token_is_accepted` reports `HttpStatusCode.Unauthorized` where `OK` was expected, with
`The account in this token no longer exists.` in the body, for a perfectly ordinary account. The
`EXISTS` policy hid the row because `app.customer_id` was still unset when statement 3 ran. That is
the fail-closed behaviour the contract predicts, and it is why the ordering is written into the
statement text through `current_setting` rather than left to the order of a list.

Restore both, and confirm:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -c "MUTATION" src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerSessionMiddleware.cs \
  > /tmp/task11-restore.txt; cat /tmp/task11-restore.txt
```

Expected: `0`.

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Application/Abstractions/ICustomerContext.cs \
        src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy \
        src/Infrastructure/PeakPower.Persistence/NullCustomerContext.cs \
        tests/PeakPower.Integration.Tests tests/PeakPower.Application.Tests
git commit -m "feat(tenancy): prove the role from the database on every request

Design section 9 step 3, and the first observable change in this plan - a demotion now bites
on the next request instead of at the next fifteen-minute token boundary. That matters
because the mechanism covering it until now, bumping the security stamp on a privilege
change, goes away with the column it was bumping for.

Five statements in one batch: SET LOCAL ROLE, both set_configs, the membership proof, the
account read. app.customer_id is set BEFORE it is proven, deliberately - a conditional
statement cannot be batched, and a forged claim has no membership row so step 4 refuses while
every policy keyed on that value shows the forged tenant nothing. The account read is keyed
on current_setting rather than a parameter so its position is visible in the statement: run
it before the tenant is declared and the new EXISTS policy hides the row and 401s every
authenticated request. Verified by mutation, exactly that way.

ICustomerContext.Role REPLACES IsAdmin rather than joining it - two sources of truth for one
fact is the fifteen-minute window - and the role travels through HttpContext.Items inside the
one assembly allowed to touch HttpContext, so the interface stays read-only for consumers.
Absence throws rather than defaulting to Viewer: a quiet least-privilege guess makes
CompanyAdmin unreachable for a reason nobody can find.

TenantScopeMiddleware gets the same proof rather than being deleted. Its only user is the
tenancy probe app, and a probe that declared a tenant but never an identity would exercise
half of migration 15's predicate and stay green while covering less than before.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 12: `CompanyAdmin` reads the proven role, and the `is_admin` claim leaves the token

The second half of design §9 step 3. Two changes, and they must land together: the moment the claim
stops being written, a policy that still requires it refuses every admin — and the moment the policy
stops requiring it, a claim still on the token is a lie nothing reads.

⚠ **A policy, still, and not an `if` in the handler.** The honest answer to *"signed in, and this is
not yours to change"* is a 403, and **no type in this codebase may produce one**:
`TenancyArchitectureTests.no_type_produces_a_forbidden_response` scans compiled IL for
`Results.Forbid`, `ForbidAsync` and the Int32 constant `403` however it was spelled, because
`[F13-R19]` makes a 403 an existence oracle for a cross-tenant read. That ban has one documented
exception — *"a 403 produced by ASP.NET Core's authorization middleware (an `[Authorize]` attribute
or a failed policy)"* — and this is that case. The refusal says "you are inside your own company and
this is not yours to change", which discloses nothing about whether any row exists.

⚠ **`RequireAssertion` reading `HttpContext`, not a DI-resolved `ICustomerContext`.** Both read the
same value — `ProvenMembership` is what `ICustomerContext.Role` reads too — and the assertion form
has one registration instead of two. A DI handler would need `services.AddScoped<IAuthorizationHandler, …>()`
**in addition to** `options.AddPolicy(...)`, in a different call on a different builder, and a policy
whose handler nobody registered fails **open on the requirement it cannot evaluate** in exactly the
way this codebase's own `AddCustomerCompanyAdminPolicy` doc comment already worries about for a
policy name that is never registered. One call, in one place, is the safer shape. Both types live in
`PeakPower.Infrastructure.Web`, which is the one assembly architecture fact 6 allows to touch
`HttpContext`.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerAuthorizationPolicies.cs:31-67`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/ITokenIssuer.cs:11-23`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Identity/JwtTokenIssuer.cs:24-51`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs:173`, `:322`, `:356`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Security/JwtTokenIssuerTests.cs:27-39`, `:41-56`, `:79-86`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Abstractions/PortShapeTests.cs:41-64`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/SecurityStampTests.cs:32`, `:165-179`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/EntitlementEndpointTests.cs:330-345`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/CompanyAdminPolicyTests.cs` (create)

**Interfaces:**
- Consumes: `ProvenMembership.Read` and `ICustomerContext.Role` (Task 11).
- Produces: `CustomerAuthorizationPolicies.CompanyAdmin` (unchanged name, new mechanism) with
  `AdminClaimType` and `AdminClaimValue` **removed**;
  `ITokenIssuer.IssueAccessToken(CustomerAccount account, Guid customerId)` — **plan 2's switch
  calls exactly this**; an access token carrying `sub`, `customer_id`, `amr`, `stamp` and **no**
  `is_admin`.

- [ ] **Step 1: Write the failing tests**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/CompanyAdminPolicyTests.cs`:

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Web.Tenancy;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Tenancy;

/// <summary>
/// The CompanyAdmin policy, evaluated the way the authorization middleware evaluates it, with no
/// database and no host.
/// <para>
/// ⚠ It reads the role <c>CustomerSessionMiddleware</c> PROVED on this request, not a token claim.
/// Design decision 8 makes the database the sole authority on role, which is what turns a demotion
/// from "effective within fifteen minutes" into "effective on the next request" - and matters
/// because the mechanism that covered that before, bumping the security stamp on a privilege
/// change, disappeared with the column it was bumping for.
/// </para>
/// </summary>
public sealed class CompanyAdminPolicyTests
{
    private static AuthorizationPolicy Policy()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddAuthorization(options => options.AddCustomerCompanyAdminPolicy());

        using var provider = services.BuildServiceProvider();
        var policies = provider.GetRequiredService<IAuthorizationPolicyProvider>();

        return policies.GetPolicyAsync(CustomerAuthorizationPolicies.CompanyAdmin)
            .GetAwaiter().GetResult()!;
    }

    private static async Task<bool> SucceedsAsync(MembershipRole? provenRole, bool authenticated = true)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddAuthorization(options => options.AddCustomerCompanyAdminPolicy());
        using var provider = services.BuildServiceProvider();
        var authorization = provider.GetRequiredService<IAuthorizationService>();

        var httpContext = new DefaultHttpContext();
        if (provenRole is { } role)
        {
            ProvenMembership.Record(httpContext, role);
        }

        var user = authenticated
            ? new System.Security.Claims.ClaimsPrincipal(
                new System.Security.Claims.ClaimsIdentity(
                    [new System.Security.Claims.Claim("sub", Guid.NewGuid().ToString())], "test"))
            : new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity());

        var result = await authorization.AuthorizeAsync(
            user, httpContext, CustomerAuthorizationPolicies.CompanyAdmin);

        return result.Succeeded;
    }

    [Fact]
    public void The_policy_no_longer_requires_a_claim_of_any_kind()
    {
        // Asserted structurally as well as behaviourally, because a policy that ALSO kept the old
        // RequireClaim would behave identically for every test below - the claim is still minted
        // until this task's other half lands - and then refuse every admin the moment it stops
        // being minted. The two halves have to move together and this is what says so.
        Policy().Requirements
            .OfType<ClaimsAuthorizationRequirement>()
            .ShouldBeEmpty("the database is the sole authority on role; no claim carries it");
    }

    [Fact]
    public async Task An_admin_of_the_business_being_acted_for_is_admitted()
        => (await SucceedsAsync(MembershipRole.Admin)).ShouldBeTrue();

    [Theory]
    [InlineData(MembershipRole.Trader)]
    [InlineData(MembershipRole.Viewer)]
    public async Task Every_other_role_is_refused(MembershipRole role)
        => (await SucceedsAsync(role)).ShouldBeFalse();

    [Fact]
    public async Task A_request_with_no_proven_role_is_refused_rather_than_admitted()
    {
        // Fail-closed. Nothing proven means the session middleware did not run, and the policy must
        // not read that as "no objection".
        (await SucceedsAsync(provenRole: null)).ShouldBeFalse();
    }

    [Fact]
    public async Task An_anonymous_request_is_refused_even_carrying_an_admin_role()
    {
        // RequireAuthenticatedUser as well as the role, and not for tidiness: without it an
        // anonymous request that somehow reached the endpoint would be refused for "not an admin"
        // rather than "not signed in", and those are different answers.
        (await SucceedsAsync(MembershipRole.Admin, authenticated: false)).ShouldBeFalse();
    }
}
```

Replace the three claim assertions in
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Security/JwtTokenIssuerTests.cs`.
Replace `:27-39` — before:

```csharp
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
```

after:

```csharp
    /// <summary>The business the token is minted FOR - a parameter now, not a column on the account.</summary>
    private static readonly Guid Business = Guid.Parse("0199a1a0-0000-7000-8000-0000000015d0");

    // The issuer reads Id and SecurityStamp off the account and takes the business as an argument.
    // ⚠ It reads NO role: design decision 8 takes it off the token, so a demotion bites on the next
    // request rather than at the next fifteen-minute boundary.
    private static CustomerAccount SampleAccount() =>
        CustomerAccount.Create(
            customerId: Guid.NewGuid(),
            username: "p.devries@vandersteen.nl",
            firstName: "Peter",
            lastName: "de Vries",
            jobTitle: null,
            email: "p.devries@vandersteen.nl",
            phone: null,
            status: AccountStatus.Active,
            isAdmin: false).Value;
```

Replace `:41-56` — before:

```csharp
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
```

after:

```csharp
    [Fact]
    public void The_access_token_carries_exactly_the_four_contract_claims()
    {
        var account = SampleAccount();

        var token = CreateIssuer().IssueAccessToken(account, Business);

        var jwt = new JsonWebToken(token.Jwt);
        jwt.Alg.ShouldBe("ES256");
        jwt.GetClaim("sub").Value.ShouldBe(account.Id.ToString());
        jwt.GetClaim("customer_id").Value.ShouldBe(Business.ToString());
        jwt.GetClaim("stamp").Value.ShouldBe(account.SecurityStamp.ToString());
        jwt.GetPayloadValue<string[]>("amr").ShouldBe(new[] { "pwd" });
    }

    [Fact]
    public void The_token_carries_NO_role_claim_under_any_spelling()
    {
        // ⚠ Asserted as an absence, and against three spellings rather than one. A role on the
        // token is what design decision 8 abolishes: it would reinstate the fifteen-minute window
        // in which a demoted admin keeps admin rights, and the mechanism that used to close that -
        // bumping the security stamp on a privilege change - went away with the is_admin column.
        var jwt = new JsonWebToken(CreateIssuer().IssueAccessToken(SampleAccount(), Business).Jwt);

        jwt.TryGetClaim("is_admin", out _).ShouldBeFalse();
        jwt.TryGetClaim("role", out _).ShouldBeFalse();
        jwt.TryGetClaim("membership_role", out _).ShouldBeFalse();
    }

    [Fact]
    public void The_customer_id_claim_is_the_business_ARGUMENT_and_not_anything_on_the_account()
    {
        // The distinction plan 2's switcher lives on: the same account, minted for a different
        // business, gets a different token. If the issuer went on reading a column, a switch would
        // silently re-mint for the business the person came from.
        var account = SampleAccount();
        var other = Guid.Parse("0199a1a0-0000-7000-8000-0000000015d1");

        var first = new JsonWebToken(CreateIssuer().IssueAccessToken(account, Business).Jwt);
        var second = new JsonWebToken(CreateIssuer().IssueAccessToken(account, other).Jwt);

        first.GetClaim("customer_id").Value.ShouldBe(Business.ToString());
        second.GetClaim("customer_id").Value.ShouldBe(other.ToString());
    }
```

Delete `Is_admin_false_is_written_as_the_string_false_not_omitted` at `:79-86` outright — the claim it
is about no longer exists, and `The_token_carries_NO_role_claim_under_any_spelling` is its
replacement.

⚠ Every other `IssueAccessToken(...)` call in that file (`:62`, `:65`, and the signature test below
it) gains `, Business` as a second argument.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~JwtTokenIssuerTests" > /tmp/task12-before.txt 2>&1; cat /tmp/task12-before.txt`

Expected: **the build fails** with
`error CS1501: No overload for method 'IssueAccessToken' takes 2 arguments`, repeated at each call
site, and
`error CS0117: 'CustomerAuthorizationPolicies' does not contain a definition for …` is **not**
raised — `AddCustomerCompanyAdminPolicy` still exists, it just does the wrong thing, which is why
`CompanyAdminPolicyTests` compiles and fails at runtime instead:

```
The_policy_no_longer_requires_a_claim_of_any_kind
    should be empty but was
[Microsoft.AspNetCore.Authorization.Infrastructure.ClaimsAuthorizationRequirement]
```

and `An_admin_of_the_business_being_acted_for_is_admitted` `should be True but was False` — the
policy is still looking for a claim the test never supplies.

- [ ] **Step 3: Rewrite the policy**

Replace
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerAuthorizationPolicies.cs:31-67`
— that is, the whole class body:

```csharp
public static class CustomerAuthorizationPolicies
{
    /// <summary>
    /// "The signed-in account administers the business it is acting for." Applied with
    /// <c>.RequireAuthorization(CustomerAuthorizationPolicies.CompanyAdmin)</c>.
    /// </summary>
    public const string CompanyAdmin = "customer-company-admin";

    /// <summary>
    /// Registers <see cref="CompanyAdmin"/>. Called from the customer host's
    /// <c>AddAuthorization</c> callback; a policy name used by an endpoint and never registered is
    /// an <see cref="InvalidOperationException"/> on that endpoint's first request, so the two
    /// belong to one extension method rather than to two files that can drift.
    /// </summary>
    public static AuthorizationOptions AddCustomerCompanyAdminPolicy(this AuthorizationOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        options.AddPolicy(CompanyAdmin, policy => policy
            // RequireAuthenticatedUser as well as the role, and not only for tidiness: without
            // it an anonymous request that somehow reached this endpoint would be refused for
            // "not an admin" rather than "not signed in", and the two are different answers.
            .RequireAuthenticatedUser()
            // ⚠ The PROVEN role, not a claim. CustomerSessionMiddleware reads
            // customer.customer_membership on every authenticated request and records the answer
            // through ProvenMembership; ICustomerContext.Role reads the same value. Design
            // decision 8 makes the database the sole authority, so a demotion takes effect on the
            // very next request instead of at the next fifteen-minute token boundary - which
            // matters because the mechanism that used to cover that gap, bumping the security
            // stamp on a privilege change, went away with the is_admin column it was bumping for.
            //
            // An assertion over HttpContext rather than a DI-resolved handler, deliberately: an
            // IAuthorizationHandler needs a SECOND registration, on a different builder, in a
            // different call - and a policy whose handler nobody registered is the same class of
            // failure this method's own existence is meant to prevent. Both types live in this
            // assembly, which is the one architecture fact 6 permits to touch HttpContext at all.
            //
            // Nothing proven means the session middleware did not run: fail closed.
            .RequireAssertion(context =>
                context.Resource is HttpContext httpContext
                && ProvenMembership.Read(httpContext) == MembershipRole.Admin));

        return options;
    }
}
```

and replace the file's `using` list and class-level remarks at `:1-30`:

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using PeakPower.Domain.Customers;

namespace PeakPower.Infrastructure.Web.Tenancy;

/// <summary>
/// The customer realm's named authorization policies.
/// </summary>
/// <remarks>
/// <para>
/// <b>In this assembly, beside <see cref="JwtCustomerContext"/> and <see cref="ProvenMembership"/>,
/// because they are the same fact.</b> The role is proved against <c>customer.customer_membership</c>
/// by <see cref="CustomerSessionMiddleware"/> and read back by both this policy and
/// <see cref="JwtCustomerContext.Role"/>; a third spelling of it in an endpoint file is how two of
/// the three quietly stop agreeing. Architecture fact 6 puts <c>HttpContext</c> access here and
/// nowhere else.
/// </para>
/// <para>
/// ⚠ <b>There is no <c>is_admin</c> claim any more.</b> It was written by <c>JwtTokenIssuer</c> and
/// read here and by <c>JwtCustomerContext</c>; design decision 8 removes it from the token, because
/// a role that rides a fifteen-minute bearer token cannot be revoked in less than fifteen minutes,
/// and the stamp bump that used to paper over that went away with the column.
/// </para>
/// <para>
/// <b>Why an authorization policy rather than an <c>if</c> in the handler.</b> A handler that
/// checked <c>ICustomerContext.Role</c> itself would have to answer the refusal, and the only
/// honest answer is 403 — which no type in this codebase may produce.
/// <c>TenancyArchitectureTests.no_type_produces_a_forbidden_response</c> scans compiled IL for
/// <c>Results.Forbid</c>, <c>ForbidAsync</c> and the Int32 constant 403 however it was spelled,
/// because [F13-R19] makes 403 an existence oracle for a cross-tenant read. That ban has one
/// documented exception, named in its own doc comment as out of an IL scan's reach: "a 403
/// produced by ASP.NET Core's authorization middleware (an [Authorize] attribute or a failed
/// policy)". This is that case, and it is not a loophole — a policy refusal says "you are signed
/// in and this is not yours to change", which discloses nothing about whether any row exists. The
/// 404-not-403 rule is about a caller probing for OTHER companies' objects; this caller is
/// already inside its own company.
/// </para>
/// </remarks>
```

- [ ] **Step 4: Take the claim off the token and widen the issuer**

Replace `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/ITokenIssuer.cs:11-23`
— before:

```csharp
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
```

after:

```csharp
/// <remarks>
/// The access token carries sub, customer_id, amr and stamp and lives fifteen minutes; the refresh
/// token is opaque, lives fourteen days, rotates and is stored hashed. Nothing in the application
/// layer may build a JWT itself.
/// <para>
/// ⚠ <b>Four claims, not five: <c>is_admin</c> is gone.</b> Design decision 8 makes the database the
/// sole authority on role. A role that rides a fifteen-minute bearer token cannot be revoked in less
/// than fifteen minutes, and the mechanism that used to paper over that - bumping the security stamp
/// on a privilege change - disappeared with the <c>is_admin</c> column it was bumping for.
/// <c>CustomerSessionMiddleware</c> reads <c>customer.customer_membership</c> on every authenticated
/// request instead.
/// </para>
/// </remarks>
public interface ITokenIssuer
{
    /// <summary>
    /// Issues an access token for one account, acting for one business.
    /// </summary>
    /// <param name="account">
    /// The aggregate rather than loose values, so the <c>stamp</c> claim cannot drift away from the
    /// row it revokes against.
    /// </param>
    /// <param name="customerId">
    /// The business this token acts for. ⚠ An ARGUMENT and not a column read off
    /// <paramref name="account"/>: one account now has several businesses, and plan 2's
    /// <c>POST /api/v1/auth/active-business</c> mints a token for the one being switched TO. An
    /// issuer that read a column would silently re-mint for the business the person came from.
    /// </param>
    AccessToken IssueAccessToken(CustomerAccount account, Guid customerId);
```

Replace `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Identity/JwtTokenIssuer.cs:24-51`
— before:

```csharp
    public AccessToken IssueAccessToken(CustomerAccount account)
    {
        ArgumentNullException.ThrowIfNull(account);
```

after:

```csharp
    public AccessToken IssueAccessToken(CustomerAccount account, Guid customerId)
    {
        ArgumentNullException.ThrowIfNull(account);

        if (customerId == Guid.Empty)
        {
            // A token that named no business would set app.customer_id to the empty guid, which
            // NULLIF does not catch (it guards the empty STRING) and which matches no membership -
            // so every request on it would 401 with "not a member of that business" and the cause
            // would be three layers away. Fail here instead.
            throw new ArgumentException(
                "An access token must name the business it acts for.", nameof(customerId));
        }
```

and, in the same method, replace the claim dictionary at `:38-45` — before:

```csharp
            Claims = new Dictionary<string, object>
            {
                ["sub"] = account.Id.ToString(),
                ["customer_id"] = account.CustomerId.ToString(),
                ["is_admin"] = account.IsAdmin ? "true" : "false",
                ["amr"] = new[] { "pwd" },
                ["stamp"] = account.SecurityStamp.ToString(),
            },
```

after:

```csharp
            Claims = new Dictionary<string, object>
            {
                ["sub"] = account.Id.ToString(),
                // The ARGUMENT, not account.CustomerId: one account, several businesses.
                ["customer_id"] = customerId.ToString(),
                // ⚠ No is_admin, and no role claim under any other spelling. Design decision 8:
                // the database is the sole authority, and CustomerSessionMiddleware proves the
                // role from customer.customer_membership on every authenticated request.
                ["amr"] = new[] { "pwd" },
                ["stamp"] = account.SecurityStamp.ToString(),
            },
```

- [ ] **Step 5: Move the four call sites**

In `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`:

`:173` — before `var access = tokens.IssueAccessToken(account);`
after `var access = tokens.IssueAccessToken(account, account.CustomerId);`

`:322` — before `var raced = tokens.IssueAccessToken(account);`
after `var raced = tokens.IssueAccessToken(account, stored.CustomerId);`

`:356` — before `var access = tokens.IssueAccessToken(account);`
after `var access = tokens.IssueAccessToken(account, stored.CustomerId);`

⚠ The two refresh sites read `stored.CustomerId` — the business the presented refresh token was for
(Task 9) — and not the account's column, because a refresh renews **this** session rather than
re-deriving one. The sign-in site still reads `account.CustomerId` and is the one **Task 15**
replaces with the business sign-in chooses from the account's memberships.

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/SecurityStampTests.cs:32`
— before `var jwt = issuer.IssueAccessToken(account).Jwt;`
after `var jwt = issuer.IssueAccessToken(account, account.CustomerId).Jwt;`

and delete `:174` from the hand-built forged token — before:

```csharp
                ["is_admin"] = "true",
```

after: **remove the line**, and add above the dictionary:

```csharp
                // No is_admin: the issuer no longer writes one and the middleware no longer reads
                // one. A forged token's power now comes entirely from the customer_id claim, which
                // is exactly what this test is about.
```

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Abstractions/PortShapeTests.cs`,
replace `:53` and `:58` — before:

```csharp
        issuer.IssueAccessToken(account).Returns(new AccessToken("header.payload.signature", accessExpiry));
```
```csharp
        var access = issuer.IssueAccessToken(account);
```

after:

```csharp
        issuer.IssueAccessToken(account, account.CustomerId)
            .Returns(new AccessToken("header.payload.signature", accessExpiry));
```
```csharp
        var access = issuer.IssueAccessToken(account, account.CustomerId);
```

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/EntitlementEndpointTests.cs`,
the test around `:330-345` signs in as a non-admin and expects the `CompanyAdmin` policy to refuse.
It keeps working unchanged — the account is seeded through
`CustomerApiFactory.SeedCustomerWithAccountAsync(isAdmin: false)`, which since Task 5 gives it a
`Trader` membership, and the policy now reads that. ⚠ Confirm by running it rather than assuming;
if it fails, the fixture's `isAdmin` argument is not reaching the membership role and Task 5's edit
to `CustomerApiFactory.cs:194` is wrong.

- [ ] **Step 6: Run everything and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln --nologo > /tmp/task12-after.txt 2>&1; tail -40 /tmp/task12-after.txt
```

Expected: build clean; the whole solution green.

⚠ Both OpenAPI snapshots are **unchanged** by this task — `is_admin` is a JWT claim, not a schema
property, and `CurrentAccountResponse.IsAdmin` is still there until Task 15. If Verify reports a
diff here, something else moved and it is worth reading before approving.

- [ ] **Step 7: Mutate the policy back to a claim, and the issuer back to the column**

**(a) Reinstate the claim requirement** beside the assertion — the shape a merge produces:

```csharp
            .RequireAuthenticatedUser()
            .RequireClaim("is_admin", "true")   // MUTATION
            .RequireAssertion(context => …));
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~CompanyAdminPolicyTests|FullyQualifiedName~EntitlementEndpointTests" > /tmp/task12-mutant-a.txt 2>&1; cat /tmp/task12-mutant-a.txt`

Expected: **four** failures — `The_policy_no_longer_requires_a_claim_of_any_kind`
(`should be empty but was [ClaimsAuthorizationRequirement]`),
`An_admin_of_the_business_being_acted_for_is_admitted` (`should be True but was False`), and the two
`EntitlementEndpointTests` cases that exercise the admin path, which now refuse every admin because
nothing mints the claim any more. The last two are the important ones: they are what a reviewer
would have seen if the two halves of this task had been split across two commits.

**(b) Make the issuer read the column again**:

```csharp
                ["customer_id"] = account.CustomerId.ToString(),   // MUTATION
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~JwtTokenIssuerTests"`

Expected: **two** failures.
- `The_access_token_carries_exactly_the_four_contract_claims`: `customer_id should be
  "0199a1a0-0000-7000-8000-0000000015d0" but was` the account's own random guid.
- `The_customer_id_claim_is_the_business_ARGUMENT_and_not_anything_on_the_account`: the same, and
  crucially `first` and `second` are now equal — the switcher's whole premise gone.

⚠ Note that the **integration** suite stays green under (b), because every call site today passes
the account's own business. The failure it introduces is entirely in plan 2's future, which is why
the unit test asserts the argument rather than the outcome. Restore both, and confirm:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -c "MUTATION" src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerAuthorizationPolicies.cs \
                   src/Infrastructure/PeakPower.Infrastructure.Identity/JwtTokenIssuer.cs \
  > /tmp/task12-restore.txt; cat /tmp/task12-restore.txt
```

Expected: `0` for both.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerAuthorizationPolicies.cs \
        src/Core/PeakPower.Application/Abstractions/ITokenIssuer.cs \
        src/Infrastructure/PeakPower.Infrastructure.Identity/JwtTokenIssuer.cs \
        src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs \
        tests/PeakPower.Application.Tests tests/PeakPower.Integration.Tests
git commit -m "feat(auth): CompanyAdmin reads the proven role, and is_admin leaves the token

Two changes in one commit because either alone is broken: a policy still requiring a claim
nobody mints refuses every admin, and a claim nobody reads is a lie on a bearer token.
Verified by mutation - reinstating RequireClaim turns four tests red, two of them the
entitlement endpoint's admin path, which is exactly what splitting this across two commits
would have shipped.

The policy is an assertion over the role CustomerSessionMiddleware proved against
customer_membership, not a DI handler: a handler needs a second registration on a different
builder, and a policy whose handler nobody registered is the same failure this method
exists to prevent. Still a policy rather than an if in the handler, because the honest
refusal is a 403 and no TYPE here may produce one - the authorization middleware's own 403
is the documented exception.

IssueAccessToken takes the business as an ARGUMENT rather than reading a column, which is
what makes plan 2's switch possible: the same account minted for a different business gets a
different token. Verified by mutation - reading the column again makes two mints identical
while the entire integration suite stays green, because every call site today happens to
pass the account's own business.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 13: PROBE — cross-tenant. A valid token for A cannot reach B, even held by a member of B

Shared contract §11: *"A valid token for A cannot read B by any route — forged claim, replayed
token."* Design §10 adds the shape that makes it interesting: *"An account with memberships in A and
B, holding a valid token for A, cannot read B by any route."*

⚠ **The person is a legitimate member of both, and that is the point.** Every cross-tenant test that
existed before this plan used a stranger — an account of company B, reached from company A — and a
stranger is refused by four mechanisms at once. This probe uses somebody who is genuinely entitled to
B's data, just not *on this request*, so the only thing standing between her token and B's rows is
that the token names A. If tenancy has quietly become "who you are" rather than "who you are acting
for", every other test in the suite still passes and this one does not.

⚠ **The symmetry assertion is half the probe.** Proving she cannot see B from A is worth little
without proving she *can* see B from B — otherwise a filter that simply hid everything would pass.

**Files:**
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/MembershipRequestPathTests.cs` (create)

**Interfaces:**
- Consumes: `CustomerApiFactory` (`.Services`, `.CreateAnonymousClient()`, `.CreateOwnerDbContext()`,
  `.SeedCustomerWithAccountAsync(...)`); `ITokenIssuer.IssueAccessToken(account, customerId)`
  (Task 12); `CustomerMembership.Create` (Task 1).
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Write the test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/MembershipRequestPathTests.cs`:

```csharp
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Application.Abstractions;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Auth;

/// <summary>
/// The CROSS-TENANT probe (shared contract section 11), run end to end through the real customer
/// host.
/// <para>
/// ⚠ The person here is a legitimate member of BOTH businesses, and that is what makes the probe
/// worth having. Every cross-tenant test written before this plan used a stranger - an account of
/// company B reached from company A - and a stranger is refused by four mechanisms at once, so such
/// a test cannot tell which one is holding. This one uses somebody genuinely entitled to B's data,
/// just not on this request: the only thing between her token and B's rows is that the token names
/// A. If tenancy ever quietly becomes "who you are" rather than "who you are acting for", every
/// other test in this suite still passes and this one does not.
/// </para>
/// </summary>
public sealed class MembershipRequestPathTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    private sealed record TwoBusinesses(
        CustomerAccount Account, Guid BusinessA, Guid BusinessB, Guid ColleagueInBId);

    private static string RandomKvk() =>
        "90" + RandomNumberGenerator.GetInt32(0, 999_999).ToString("D6", CultureInfo.InvariantCulture);

    /// <summary>
    /// One person, two businesses: a trader in A and a viewer in B. B also holds a colleague who is
    /// NOT in A, so "did the list leak across" has something visible to leak.
    /// </summary>
    private async Task<TwoBusinesses> SeedMemberOfBothAsync(CancellationToken ct)
    {
        var account = await factory.SeedCustomerWithAccountAsync(
            legalName: "Zonneweide Beheer B.V.",
            kvkNumber: RandomKvk(),
            email: $"{Guid.NewGuid():N}@zonneweide.nl",
            password: Password);

        await using var db = factory.CreateOwnerDbContext();

        var businessB = Customer.Create(
            "Windkracht Noord B.V.",
            tradeName: null,
            kvkNumber: KvkNumber.Create(RandomKvk()).Value,
            vatNumber: null,
            billingAddress: new Address("Havenweg", "12", null, "3011 AA", "Rotterdam", "NL"),
            visitingAddress: null,
            primaryContact: new ContactPerson("Els Bakker", "els@example.test", null),
            internalReference: null,
            locale: "nl-NL").Value;
        db.Customers.Add(businessB);

        var colleagueEmail = $"{Guid.NewGuid():N}@windkracht.nl";
        var colleagueInB = CustomerAccount.Create(
            businessB.Id, colleagueEmail, "Bram", "Jansen", jobTitle: null,
            colleagueEmail, phone: null, AccountStatus.Active, isAdmin: false).Value;
        db.CustomerAccounts.Add(colleagueInB);

        var at = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        db.CustomerMemberships.AddRange(
            CustomerMembership.Create(account.Id, businessB.Id, MembershipRole.Viewer, at).Value,
            CustomerMembership.Create(colleagueInB.Id, businessB.Id, MembershipRole.Trader, at).Value);

        await db.SaveChangesAsync(ct);

        return new TwoBusinesses(account, account.CustomerId, businessB.Id, colleagueInB.Id);
    }

    private HttpClient ClientActingFor(CustomerAccount account, Guid businessId)
    {
        using var scope = factory.Services.CreateScope();
        var issuer = scope.ServiceProvider.GetRequiredService<ITokenIssuer>();
        var jwt = issuer.IssueAccessToken(account, businessId).Jwt;

        var client = factory.CreateAnonymousClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", jwt);
        return client;
    }

    [Fact]
    public async Task Acting_for_A_she_sees_As_company_and_not_Bs()
    {
        var ct = TestContext.Current.CancellationToken;
        var seeded = await SeedMemberOfBothAsync(ct);
        var client = ClientActingFor(seeded.Account, seeded.BusinessA);

        var response = await client.GetAsync("/api/v1/company", ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var company = await response.Content.ReadFromJsonAsync<CompanyProfileResponse>(ct);
        company!.Id.ShouldBe(
            seeded.BusinessA,
            "the token names the business, and the business names the rows - not the person");
    }

    [Fact]
    public async Task Acting_for_A_the_colleague_list_does_not_include_anybody_from_B()
    {
        // The leak that membership makes possible and column tenancy could not: she is entitled to
        // read B's people, so a filter keyed on HER rather than on the active business would hand
        // company A a list containing company B's staff.
        var ct = TestContext.Current.CancellationToken;
        var seeded = await SeedMemberOfBothAsync(ct);
        var client = ClientActingFor(seeded.Account, seeded.BusinessA);

        var accounts = await client.GetFromJsonAsync<CompanyAccountsResponse>(
            "/api/v1/company/accounts", ct);

        accounts!.Items.Select(item => item.Id).ShouldNotContain(seeded.ColleagueInBId);
        accounts.Items.Select(item => item.Id).ShouldContain(seeded.Account.Id);
    }

    [Fact]
    public async Task Acting_for_B_she_sees_Bs_company_and_Bs_colleague()
    {
        // ⚠ The symmetry half, and without it the two tests above prove almost nothing: a filter
        // that returned an empty set for everybody would pass both.
        var ct = TestContext.Current.CancellationToken;
        var seeded = await SeedMemberOfBothAsync(ct);
        var client = ClientActingFor(seeded.Account, seeded.BusinessB);

        var company = await client.GetFromJsonAsync<CompanyProfileResponse>("/api/v1/company", ct);
        company!.Id.ShouldBe(seeded.BusinessB);

        var accounts = await client.GetFromJsonAsync<CompanyAccountsResponse>(
            "/api/v1/company/accounts", ct);
        accounts!.Items.Select(item => item.Id).ShouldContain(seeded.ColleagueInBId);
    }

    [Fact]
    public async Task The_same_account_gets_a_different_scope_from_a_different_token_and_nothing_else_changes()
    {
        // One account, two clients, two answers, with no state of any kind changed in between. The
        // scope is the token: not the account, not a session, not a header, not anything a handler
        // decides. This is the property plan 2's switcher will lean on entirely.
        var ct = TestContext.Current.CancellationToken;
        var seeded = await SeedMemberOfBothAsync(ct);

        var asA = ClientActingFor(seeded.Account, seeded.BusinessA);
        var asB = ClientActingFor(seeded.Account, seeded.BusinessB);

        var fromA = await asA.GetFromJsonAsync<CurrentAccountResponse>("/api/v1/auth/me", ct);
        var fromB = await asB.GetFromJsonAsync<CurrentAccountResponse>("/api/v1/auth/me", ct);

        fromA!.AccountId.ShouldBe(fromB!.AccountId, "it is the same person either way");
        fromA.CustomerId.ShouldBe(seeded.BusinessA);
        fromB.CustomerId.ShouldBe(seeded.BusinessB);
    }

    [Fact]
    public async Task A_token_for_A_cannot_reach_a_connection_that_belongs_to_B()
    {
        // A route that addresses a row by id, so the refusal is a 404 rather than a short list -
        // and 404, never 403 [F13-R19], because a 403 is an existence oracle.
        var ct = TestContext.Current.CancellationToken;
        var seeded = await SeedMemberOfBothAsync(ct);

        Guid connectionInB;
        await using (var db = factory.CreateOwnerDbContext())
        {
            var brpId = await db.Brps.Select(brp => brp.Id).FirstAsync(ct);
            var point = MeteringPoint.Attach(
                seeded.BusinessB,
                EanCode.Create("87" + RandomNumberGenerator.GetInt32(0, 999_999)
                    .ToString("D6", CultureInfo.InvariantCulture) + "0000000000").Value,
                brpId,
                ProductionExpectation.Unknown,
                expectationSource: null,
                name: null,
                description: null,
                gridOperator: null,
                capacityKw: null,
                address: null,
                validFrom: new DateOnly(2026, 1, 1)).Value;
            db.MeteringPoints.Add(point);
            await db.SaveChangesAsync(ct);
            connectionInB = point.Id;
        }

        var asA = ClientActingFor(seeded.Account, seeded.BusinessA);

        var response = await asA.GetAsync($"/api/v1/connections/{connectionInB}", ct);

        response.StatusCode.ShouldBe(
            HttpStatusCode.NotFound,
            "she may read this connection while acting for B and must not while acting for A - " +
            "and the refusal is a 404 because a 403 would confirm the row exists");
    }
}
```

⚠ `CompanyProfileResponse`, `CompanyAccountsResponse` and the connections route are read from
`PeakPower.Contracts.Customer.Portal` and `CompanyEndpoints`/`ConnectionEndpoints` as they stand.
Read `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs`'s route table before writing
the last test and use the pattern it actually maps; if the detail route is not
`/api/v1/connections/{id:guid}`, use the one that is. The claim being made is about *a route that
addresses a row by id*, not about that specific string.

- [ ] **Step 2: Run the test and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MembershipRequestPathTests"
```

Expected: PASS, five tests.

- [ ] **Step 3: Mutate the scope from the token to the person**

The failure this probe exists for is a filter that answers "who are you" instead of "who are you
acting for". Make the query filter on `CustomerAccount` do exactly that — drop the business term:

```csharp
        modelBuilder.Entity<CustomerAccount>()
            .HasQueryFilter(account =>
                !_customerContext.IsAuthenticated ||
                account.Memberships.Any(membership => membership.RemovedAt == null));  // MUTATION
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MembershipRequestPathTests" > /tmp/task13-mutant.txt 2>&1; cat /tmp/task13-mutant.txt`

Expected: FAIL, `Acting_for_A_the_colleague_list_does_not_include_anybody_from_B` —

```
accounts.Items.Select(item => item.Id)
    should not contain
<the colleague in B>
```

Company A has just been shown a member of company B's staff, over the API, on a request that was
authenticated, scoped and policied throughout.

⚠ Now run the rest of the tenancy suite under the same mutation:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~QueryFilterEnforcementTests|FullyQualifiedName~RowLevelSecurityTests|FullyQualifiedName~RouteTableTenancyTests" \
  > /tmp/task13-blast.txt 2>&1; tail -20 /tmp/task13-blast.txt
```

Expected: `QueryFilterEnforcementTests.A_customer_scoped_context_sees_only_its_own_account` fails too
— it seeds two tenants with one account each — but **`RowLevelSecurityTests` and
`RouteTableTenancyTests` stay green**, because layer 2 is untouched and every account they use is in
exactly one business. That is the shape of the finding: a layer-1 regression of this kind is visible
only where an account belongs to more than one business, which is a state that did not exist before
this plan and which only this probe and one enforcement test construct.

Restore the business term, and confirm:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -c "MUTATION" src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs > /tmp/task13-restore.txt
cat /tmp/task13-restore.txt
```

Expected: `0`.

- [ ] **Step 4: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Auth/MembershipRequestPathTests.cs
git commit -m "test(auth): the cross-tenant probe, using somebody who is a member of both

Shared contract section 11, end to end through the real host. The person is a legitimate
member of BOTH businesses, which is what makes it worth having: every cross-tenant test
written before this plan used a stranger, and a stranger is refused by four mechanisms at
once, so none of them tells you which is holding. Here the only thing between her token and
B's rows is that the token names A.

The symmetry half is not optional - acting for B she must SEE B's colleague - or a filter
returning nothing at all would pass. And one account with two tokens gets two scopes with no
state changed in between, which is the property plan 2's switcher leans on entirely.

Verified by mutation: dropping the business term from the query filter, so it answers 'who
are you' rather than 'who are you acting for', shows company A a member of company B's staff
over the API - while RowLevelSecurityTests and RouteTableTenancyTests both stay green,
because every account they use is in exactly one business. That state did not exist before
this plan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: PROBE — no membership. A business you are not in is refused before the claim is honoured

Shared contract §11: *"A company named without membership is refused **before** `app.customer_id` is
honoured."*

Two claims, and the second is the subtle one. The middleware sets `app.customer_id` from the token
**before** proving anything, because the five statements go out as one `NpgsqlBatch` and a
conditional statement cannot be batched. That looks like trusting an unproven value, and the design
answers it in terms: *"the proof is step 4's refusal, not the withholding of the setting"* — a forged
tenant has no rows the caller can reach, so the interval between setting and proving discloses
nothing. This probe makes both halves concrete: the request is refused with the middleware's own
membership message, and separately, a connection that declares a business it has no membership in
reads **zero rows** from every policied table while that setting is in force.

**Files:**
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/MembershipRequestPathTests.cs` (append)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs` (append to `CustomerMembershipPolicyTests`)

**Interfaces:**
- Consumes: `ISigningKeyStore` and `JwtTokenIssuer.Issuer`/`.Audience` (for the hand-minted token);
  `TenancyFixture` (for the database-level half).
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Write the test**

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/MembershipRequestPathTests.cs`,
inside the existing class:

```csharp
    /// <summary>
    /// The NO-MEMBERSHIP probe. The token is real - correctly signed, a real <c>sub</c>, the
    /// account's real <c>stamp</c> - and names a business the account has no membership in.
    /// </summary>
    /// <remarks>
    /// ⚠ Built by hand rather than through <see cref="ITokenIssuer"/> on purpose: the issuer would
    /// happily mint this, because it takes the business as an argument and asks no questions. That
    /// is correct - the issuer's job is to sign, and the check belongs where it can be re-run on
    /// every request rather than once at mint time. Which is exactly the property being tested.
    /// </remarks>
    [Fact]
    public async Task A_token_naming_a_business_the_account_is_not_in_is_refused_with_the_membership_message()
    {
        var ct = TestContext.Current.CancellationToken;
        var seeded = await SeedMemberOfBothAsync(ct);

        Guid businessSheIsNotIn;
        await using (var db = factory.CreateOwnerDbContext())
        {
            var stranger = Customer.Create(
                "Derde Partij B.V.",
                tradeName: null,
                kvkNumber: KvkNumber.Create(RandomKvk()).Value,
                vatNumber: null,
                billingAddress: new Address("Kade", "1", null, "1000 AA", "Amsterdam", "NL"),
                visitingAddress: null,
                primaryContact: new ContactPerson("Iemand Anders", "anders@example.test", null),
                internalReference: null,
                locale: "nl-NL").Value;
            db.Customers.Add(stranger);
            await db.SaveChangesAsync(ct);
            businessSheIsNotIn = stranger.Id;
        }

        var client = ClientActingFor(seeded.Account, businessSheIsNotIn);

        var response = await client.GetAsync("/api/v1/auth/me", ct);

        response.StatusCode.ShouldBe(
            HttpStatusCode.Unauthorized,
            "401 and not 403: [F13-R19] makes a 403 an existence oracle, and 'you named a business " +
            "you are not in' is precisely the question a probe would ask");

        var body = await response.Content.ReadAsStringAsync(ct);
        body.Contains("not a member of that business", StringComparison.Ordinal).ShouldBeTrue(
            "pins the refusal to CustomerSessionMiddleware's own membership branch. No handler " +
            "emits this text and neither does ASP.NET's authorization challenge, so it is only " +
            "reachable if the membership read ran and came back empty - which is the proof, and " +
            "not merely 'a 401 arrived from somewhere in the pipeline'");
    }

    [Fact]
    public async Task A_business_that_does_not_exist_at_all_is_refused_the_SAME_way()
    {
        // Byte-identical to the test above, deliberately. A different message for "no such
        // business" than for "not your business" would be an existence oracle in the response body
        // rather than in the status code - the same leak [F13-R19] is about, one layer down.
        var ct = TestContext.Current.CancellationToken;
        var seeded = await SeedMemberOfBothAsync(ct);

        var client = ClientActingFor(seeded.Account, Guid.NewGuid());

        var response = await client.GetAsync("/api/v1/auth/me", ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await response.Content.ReadAsStringAsync(ct))
            .Contains("not a member of that business", StringComparison.Ordinal)
            .ShouldBeTrue("a business that does not exist and one you are not in are the same answer");
    }

    [Fact]
    public async Task Removing_the_membership_refuses_the_very_next_request_on_a_token_that_still_verifies()
    {
        // The reason the role and the tenancy are proved on EVERY request rather than at mint time.
        // The token is untouched - same signature, same stamp, still inside its fifteen minutes -
        // and the answer changes because the database changed. Plan 2 owns the refresh side of
        // this; the access-token side is plan 1's and is proven here.
        var ct = TestContext.Current.CancellationToken;
        var seeded = await SeedMemberOfBothAsync(ct);
        var client = ClientActingFor(seeded.Account, seeded.BusinessB);

        (await client.GetAsync("/api/v1/auth/me", ct)).StatusCode.ShouldBe(HttpStatusCode.OK);

        await using (var db = factory.CreateOwnerDbContext())
        {
            var membership = await db.CustomerMemberships.SingleAsync(
                m => m.AccountId == seeded.Account.Id && m.CustomerId == seeded.BusinessB, ct);
            membership.Remove(DateTimeOffset.UtcNow);
            await db.SaveChangesAsync(ct);
        }

        var after = await client.GetAsync("/api/v1/auth/me", ct);

        after.StatusCode.ShouldBe(
            HttpStatusCode.Unauthorized,
            "removal takes effect on the next request, not at the next fifteen-minute boundary");
        (await after.Content.ReadAsStringAsync(ct))
            .Contains("not a member of that business", StringComparison.Ordinal).ShouldBeTrue();

        // And her OTHER business is undisturbed - removal from B is not a sign-out from A.
        var stillInA = ClientActingFor(seeded.Account, seeded.BusinessA);
        (await stillInA.GetAsync("/api/v1/auth/me", ct)).StatusCode.ShouldBe(HttpStatusCode.OK);
    }
```

Append to `CustomerMembershipPolicyTests` in
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`:

```csharp
    [Theory]
    [InlineData("customer.customer")]
    [InlineData("customer.customer_account")]
    [InlineData("customer.metering_point")]
    [InlineData("customer.customer_membership")]
    [InlineData("wallet.wallet")]
    [InlineData("audit.audit_record")]
    public async Task Declaring_a_business_you_are_not_in_shows_you_nothing_at_all(string qualifiedTable)
    {
        // ⚠ The second half of the no-membership probe, and the half that answers the objection to
        // shared contract section 6: the middleware sets app.customer_id from an UNPROVEN claim,
        // two statements before it proves anything, because the five statements go out as one
        // NpgsqlBatch and a conditional statement cannot be batched.
        //
        // The design's answer is that the proof is step 4's refusal and not the withholding of the
        // setting - "a forged tenant has no rows the caller can reach" - and this is that claim
        // made concrete rather than argued. Company A's own admin declares company B, which she is
        // not a member of, and every policied table shows her zero rows for the whole window
        // between the setting and the refusal.
        var ct = TestContext.Current.CancellationToken;
        var (connection, transaction) =
            await ActingAsAsync(_fixture.CompanyAAccountId, _fixture.CompanyBId, ct);

        await using (connection)
        await using (transaction)
        {
            await using var count = new NpgsqlCommand(
                $"SELECT count(*) FROM {qualifiedTable}", connection, transaction);

            Convert.ToInt32(await count.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture)
                .ShouldBe(
                    0,
                    $"{qualifiedTable} must show nothing to a connection that declared a business " +
                    "its account is not a member of. Setting app.customer_id before proving it is " +
                    "safe precisely because of this");

            await transaction.RollbackAsync(ct);
        }
    }
```

⚠ `customer.customer_membership` is in that list and its expected count is **zero**, which is worth
reading twice: the tenant-isolation policy's `USING` arm has an `OR account_id = app.account_id`
branch, so company A's admin *can* see her own memberships — but she has none in company B and the
`customer_id` branch matches nothing, so the count for this particular caller is zero either way.
If this case ever returns a non-zero number, the `OR` has been widened past what the switcher needs.

- [ ] **Step 2: Run the tests and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~MembershipRequestPathTests|FullyQualifiedName~CustomerMembershipPolicyTests"
```

Expected: PASS — eight in `MembershipRequestPathTests` and fourteen in
`CustomerMembershipPolicyTests` (eight from Task 6 plus six theory cases).

⚠ `Declaring_a_business_you_are_not_in_shows_you_nothing_at_all(qualifiedTable: "customer.customer_membership")`
is the one to read the output for: if it is the only failure, re-read the note above before
concluding anything about the policy.

- [ ] **Step 3: Mutate the refusal into a fall-through, then into a 403**

**(a) Fail open.** In `CustomerSessionMiddleware`, treat a missing membership as an ordinary role
rather than a refusal:

```csharp
            if (!await reader.ReadAsync(cancellationToken))
            {
                role = MembershipRole.Viewer;   // MUTATION: was RejectAsync + return
            }
            else
            {
                role = MembershipRoleWire.Parse(reader.GetString(0));
            }
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MembershipRequestPathTests" > /tmp/task14-mutant-a.txt 2>&1; cat /tmp/task14-mutant-a.txt`

Expected: **three** failures — the two no-membership tests and
`Removing_the_membership_refuses_the_very_next_request_on_a_token_that_still_verifies`, each with

```
response.StatusCode
    should be
Unauthorized
    but was
NotFound
```

⚠ **404, not 200**, and the reason is worth recording: the request now reaches the handler, and
`GET /api/v1/auth/me` finds no account row because Task 8's `EXISTS` query filter is a second,
independent defence that also asks about membership. So the mutant is not a data leak — it is a
**layered** system losing one layer and reporting the wrong reason for the refusal. That is the same
finding `SecurityStampTests`' own doc comment records about deleting `SET LOCAL ROLE`, and it is why
these tests assert the **body text** as well as the status: only the middleware's own branch emits
"not a member of that business".

**(b) Refuse with the wrong code.** Restore, then change `RejectAsync`'s status for this one branch
to `403`:

```csharp
                context.Response.StatusCode = StatusCodes.Status403Forbidden;   // MUTATION
```

Run: `dotnet test PeakPower.sln --nologo --filter "FullyQualifiedName~TenancyArchitectureTests"`

Expected: FAIL, `no_type_produces_a_forbidden_response` — the IL scan finds the Int32 constant `403`
in `CustomerSessionMiddleware`, whichever way it was spelled, and reports it by type and method name.
⚠ The HTTP tests would fail too, but this is the guard that catches it without anybody having to
write a test for the specific route: `[F13-R19]` makes a 403 an existence oracle, and "you named a
business you are not in" is exactly the question the oracle would answer.

Restore, and confirm:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -c "MUTATION" src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerSessionMiddleware.cs \
  > /tmp/task14-restore.txt; cat /tmp/task14-restore.txt
```

Expected: `0`.

- [ ] **Step 4: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Auth/MembershipRequestPathTests.cs \
        tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs
git commit -m "test(auth): the no-membership probe, both halves of it

Shared contract section 11. A correctly signed token with a real sub and a real stamp,
naming a business the account is not in, is refused with the middleware's own membership
message - asserted on the body text and not only the status, because only that branch emits
it and a bare 401 could come from anywhere in the pipeline. A business that does not exist
gets the byte-identical answer, so the body is not an existence oracle one layer below the
status code.

The second half answers the objection to shared contract section 6: the middleware sets
app.customer_id from an unproven claim two statements before proving it, because the batch
cannot carry a conditional. The design's answer is that the proof is the refusal and not the
withholding of the setting; this makes that concrete rather than argued, by declaring a
business you are not in and reading zero rows from every policied table for the whole window.

Verified by mutation, and the mutation is instructive: treating a missing membership as
Viewer gives 404 rather than 200, because the EF query filter is a second independent
defence that also asks about membership. Losing one layer reports the wrong reason rather
than opening a hole - the same finding SecurityStampTests already records about SET LOCAL
ROLE - which is exactly why these assert the body text.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 15: The `is_admin` sweep — the column's last reader, and sign-in learns to choose a business

Design §9 step 4, first half. Shared contract §10 is blunt about the size of this: *"Roughly a dozen
production sites, **not one**… the column is read and written in the domain type, the token issuer,
three auth endpoints, portal and employee mappings, two employee endpoints that create and update
it, four wire contracts, the EF configuration and the demo seeder."* The token issuer and the policy
went in Task 12; everything else is here.

⚠ **`isAdmin` stops being a boolean anywhere.** Wherever it was one, a `MembershipRole` takes its
place — never `Role`, which is already **job title** on the account record and which `[F01-R13]` says
is *"descriptive only… never checked"*. On the wire the field is **`membershipRole`** (shared
contract §3), lower-cased to `admin` / `trader` / `viewer` to match the column.

⚠ **Sign-in has to choose a business, and that is Deviation D9.** Reporting `membershipRole` means
reading a membership, and once you are reading memberships there is no reason left to consult
`account.CustomerId` — which disappears two tasks from now anyway. So sign-in gets design §5's
selection: `last_active_business_id` if it is still an **active** membership, otherwise the
**oldest** membership by `created_at`, otherwise a named refusal. Never "any membership": an
arbitrary pick lands somebody in an arbitrary business to take audited actions in.

⚠ **Both OpenAPI snapshots move**, and this is the commit that moves them. `isAdmin` leaves five
schemas and `membershipRole` arrives in four.

⚠ **The web repo breaks here, loudly, and plan 3 owns fixing it** — Deviation D6. Fourteen call
sites across both portals read `isAdmin`, including a checkbox bound to it in the employee portal's
account form. `npm run generate:clients` will regenerate a client whose type no longer has that
field and the Angular build will stop compiling. That is the intended signal.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/CustomerAccount.cs:35-36`, `:50-97`, `:111-138`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/CustomerAccountConfiguration.cs:37`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs:7-13`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Contracts/Customer/Portal/PortalContracts.cs:35-45`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Contracts/Employee/AccountDtos.cs:6-35`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs:147-156`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Portal/CompanyEndpoints.cs:70-90`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs:115-190`, `:206-220`, `:315-370`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingService.cs:420-429`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Employee/Mapping/EmployeeMappings.cs:42-46`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Employee/Endpoints/AccountEndpoints.cs:85-112`, `:141-172`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Employee/Endpoints/CustomerEndpoints.cs:289-312`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs:61`, `:155-170`
- Test: the twelve fixtures listed in Step 5, plus both `*OpenApiSnapshotTests*.verified.json`

**Interfaces:**
- Consumes: `MembershipRole`, `CustomerMembership`, **`MembershipRoleWire.Of` / `.Parse` /
  `.Values`** (Task 1) — every role that leaves this task on the wire goes through `Of`, every role
  that arrives on it goes through `Parse`, and the two employee validators quote `Values`. No
  endpoint, mapper or validator here declares a spelling of its own (contract §13.2);
  `ITokenIssuer.IssueAccessToken(account, customerId)` (Task 12);
  `RefreshToken.Issue(accountId, customerId, …)` (Task 9).
- Produces: `CustomerAccount.Create(Guid customerId, string username, string firstName, string lastName, string? jobTitle, string email, string? phone, AccountStatus status)`
  — **`isAdmin` gone, `customerId` still there until Task 17**;
  `CustomerAccount.UpdateProfile(string firstName, string lastName, string? jobTitle, string email, string? phone)`;
  `CurrentAccountResponse(Guid AccountId, Guid CustomerId, string FirstName, string LastName, string Email, string MembershipRole)`;
  `CompanyAccountDto(… string MembershipRole, DateTimeOffset? LastLoginAt)`;
  `AccountDto(… string MembershipRole, DateTimeOffset? LastLoginAt)`;
  `CreateAccountRequest(… string MembershipRole)`; `UpdateAccountRequest(… string MembershipRole)`;
  `EmployeeMappings.ToDto(CustomerAccount account, Guid customerId, MembershipRole membershipRole)`;
  `PortalMappings.ToAccountDto(CustomerAccount account, MembershipRole membershipRole)`.
- Produces: **`AuthEndpoints.SelectBusinessAsync(PeakPowerDbContext db, CustomerAccount account, CancellationToken cancellationToken)`
  → `Task<CustomerMembership?>`, and the no-business problem document it returns through,
  `AuthEndpoints.NotAMemberOfAnyBusiness()` → `IResult`.** Shared contract §13.2 names plan 1 their
  owner — forced, because dropping `customer_id` breaks sign-in inside this plan — and Deviation D9
  says why. Both are `private static` members of `AuthEndpoints`; **plan 2's `/auth/me`,
  `/auth/active-business` and refresh re-proof live in that same class and call these, and must not
  declare a second selection helper or a second problem document.** The document is
  `ProblemDetails { Status = 401, Title = "Not signed in", Detail = "This account is not a member of
  any business." }` served as `application/problem+json`; plan 2 owns its final wording and the
  zero-membership probe (contract §11), and refines this body rather than adding a parallel one.

- [ ] **Step 1: Write the failing tests**

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/MembershipRequestPathTests.cs`:

```csharp
    [Fact]
    public async Task Sign_in_reports_the_membership_role_and_lands_in_the_last_active_business()
    {
        var ct = TestContext.Current.CancellationToken;
        var seeded = await SeedMemberOfBothAsync(ct);

        // She last acted for B. Migration 15 backfilled this column for accounts that predate the
        // switcher; for one created afterwards it is null until plan 2's endpoint writes it, which
        // is what the oldest-membership fallback below is for.
        await using (var db = factory.CreateOwnerDbContext())
        {
            var account = await db.CustomerAccounts.SingleAsync(a => a.Id == seeded.Account.Id, ct);
            account.RecordActiveBusiness(seeded.BusinessB);
            await db.SaveChangesAsync(ct);
        }

        var response = await factory.CreateAnonymousClient().PostAsJsonAsync(
            "/api/v1/auth/sign-in",
            new SignInRequest(seeded.Account.Username, Password),
            ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<SignInResponse>(ct);

        body!.Account.CustomerId.ShouldBe(
            seeded.BusinessB, "sign-in lands in the business last used (design section 5)");
        body.Account.MembershipRole.ShouldBe(
            "viewer", "she is a viewer in B and a trader in A - the role is per business");
    }

    [Fact]
    public async Task Sign_in_falls_back_to_the_OLDEST_membership_and_not_to_an_arbitrary_one()
    {
        // ⚠ Never "any membership". An arbitrary pick lands somebody in an arbitrary business to
        // take audited actions in. Her A membership was created by CustomerApiFactory's seed and
        // her B membership afterwards, so A is the older one, and last_active_business_id is null.
        var ct = TestContext.Current.CancellationToken;
        var seeded = await SeedMemberOfBothAsync(ct);

        var response = await factory.CreateAnonymousClient().PostAsJsonAsync(
            "/api/v1/auth/sign-in",
            new SignInRequest(seeded.Account.Username, Password),
            ct);

        var body = await response.Content.ReadFromJsonAsync<SignInResponse>(ct);
        body!.Account.CustomerId.ShouldBe(seeded.BusinessA);
        body.Account.MembershipRole.ShouldBe("trader");
    }

    [Fact]
    public async Task Sign_in_ignores_a_last_active_business_the_person_has_been_removed_from()
    {
        // The preference is a preference, not an entitlement. A removed membership must not decide
        // where somebody lands, or removal would be reversible by a stale column.
        var ct = TestContext.Current.CancellationToken;
        var seeded = await SeedMemberOfBothAsync(ct);

        await using (var db = factory.CreateOwnerDbContext())
        {
            var account = await db.CustomerAccounts.SingleAsync(a => a.Id == seeded.Account.Id, ct);
            account.RecordActiveBusiness(seeded.BusinessB);

            var membership = await db.CustomerMemberships.SingleAsync(
                m => m.AccountId == seeded.Account.Id && m.CustomerId == seeded.BusinessB, ct);
            membership.Remove(DateTimeOffset.UtcNow);
            await db.SaveChangesAsync(ct);
        }

        var response = await factory.CreateAnonymousClient().PostAsJsonAsync(
            "/api/v1/auth/sign-in",
            new SignInRequest(seeded.Account.Username, Password),
            ct);

        var body = await response.Content.ReadFromJsonAsync<SignInResponse>(ct);
        body!.Account.CustomerId.ShouldBe(seeded.BusinessA);
    }

    [Fact]
    public async Task An_account_with_no_membership_at_all_gets_a_named_answer_rather_than_a_crash()
    {
        // ⚠ A state that has never existed before this plan, and every entry point has to handle
        // it. Plan 1's floor is a named 401; plan 2 owns the final wording and the probe that
        // shared contract section 11 assigns it.
        var ct = TestContext.Current.CancellationToken;
        var seeded = await SeedMemberOfBothAsync(ct);

        await using (var db = factory.CreateOwnerDbContext())
        {
            var memberships = await db.CustomerMemberships
                .Where(m => m.AccountId == seeded.Account.Id)
                .ToListAsync(ct);
            foreach (var membership in memberships)
            {
                membership.Remove(DateTimeOffset.UtcNow);
            }

            await db.SaveChangesAsync(ct);
        }

        var response = await factory.CreateAnonymousClient().PostAsJsonAsync(
            "/api/v1/auth/sign-in",
            new SignInRequest(seeded.Account.Username, Password),
            ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await response.Content.ReadAsStringAsync(ct))
            .Contains("not a member of any business", StringComparison.Ordinal)
            .ShouldBeTrue("a named answer, distinguishable from a wrong password");
    }

    [Fact]
    public async Task The_colleague_list_reports_each_persons_role_in_THIS_business()
    {
        // The same person, two businesses, two roles - and the list must report the one for the
        // business the caller is acting for, not "her role" as if she had only one.
        var ct = TestContext.Current.CancellationToken;
        var seeded = await SeedMemberOfBothAsync(ct);

        var asA = ClientActingFor(seeded.Account, seeded.BusinessA);
        var asB = ClientActingFor(seeded.Account, seeded.BusinessB);

        var fromA = await asA.GetFromJsonAsync<CompanyAccountsResponse>("/api/v1/company/accounts", ct);
        var fromB = await asB.GetFromJsonAsync<CompanyAccountsResponse>("/api/v1/company/accounts", ct);

        fromA!.Items.Single(item => item.Id == seeded.Account.Id).MembershipRole.ShouldBe("trader");
        fromB!.Items.Single(item => item.Id == seeded.Account.Id).MembershipRole.ShouldBe("viewer");
    }
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MembershipRequestPathTests"`

Expected: **the build fails** —
`error CS1061: 'CurrentAccountResponse' does not contain a definition for 'MembershipRole'` and
`error CS1061: 'CompanyAccountDto' does not contain a definition for 'MembershipRole'`.

- [ ] **Step 3: Take the column out of the domain type**

In `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/CustomerAccount.cs`,
delete `:35-36`:

```csharp
    /// <summary>[DEC-71] — a column in slice 1. Nothing reads it until four-eyes ships in phase 2.</summary>
    public bool IsAdmin { get; private set; }
```

replace the `Create` signature and body at `:50-97` — before (the parameter list and the two lines
that use it):

```csharp
        AccountStatus status,
        bool isAdmin)
```
```csharp
            Status = status,
            IsAdmin = isAdmin,
            SecurityStamp = Guid.CreateVersion7(),
```

after:

```csharp
        AccountStatus status)
```
```csharp
            Status = status,
            SecurityStamp = Guid.CreateVersion7(),
```

and add above the factory:

```csharp
    /// <summary>
    /// ⚠ There is no <c>isAdmin</c> parameter, and there is no role parameter either. An account
    /// does not have a role; a MEMBERSHIP does, and one account now has several. Whoever creates an
    /// account creates its first membership in the same transaction -
    /// <c>OnboardingService.SignAsync</c>, the back office's create endpoint and the demo seeder are
    /// the three - and that is where the role is decided.
    /// </summary>
```

replace `UpdateProfile` at `:111-138` — before:

```csharp
    public Result<CustomerAccount> UpdateProfile(
        string firstName,
        string lastName,
        string? jobTitle,
        string email,
        string? phone,
        bool isAdmin)
```
```csharp
        Phone = Blank(phone);
        IsAdmin = isAdmin;
        BumpSecurityStamp();
```

after:

```csharp
    /// <summary>
    /// ⚠ No <c>isAdmin</c> parameter. Changing what somebody may do is a role change on their
    /// MEMBERSHIP of a particular business, not an edit to their person - and the same person can
    /// be an admin in one business and a viewer in another, which a boolean on this row cannot say.
    /// </summary>
    public Result<CustomerAccount> UpdateProfile(
        string firstName,
        string lastName,
        string? jobTitle,
        string email,
        string? phone)
```
```csharp
        Phone = Blank(phone);
        BumpSecurityStamp();
```

⚠ Keep the `BumpSecurityStamp()` call. `[F01-R16]` is why it is there — an employee edit revokes
sessions — and the fact that a *role* change no longer travels through this method does not make an
email change less session-revoking.

Delete `CustomerAccountConfiguration.cs:37`:

```csharp
        builder.Property(account => account.IsAdmin).IsRequired().HasDefaultValue(false);
```

⚠ The **column** stays until Task 17 and that is safe: `is_admin boolean NOT NULL DEFAULT false`
has a default, so an insert that omits it succeeds. (`customer_id` has **no** default, which is why
it cannot be un-mapped until the same commit that drops it.)

- [ ] **Step 4: Move the five wire contracts and their mappings**

`AuthContracts.cs:7-13` — before:

```csharp
public sealed record CurrentAccountResponse(
    Guid AccountId,
    Guid CustomerId,
    string FirstName,
    string LastName,
    string Email,
    bool IsAdmin);
```

after:

```csharp
/// <summary>
/// Who the caller is, as the portal's shell needs it.
/// <para>
/// ⚠ <c>isAdmin</c> is GONE and <c>membershipRole</c> replaces it — not additive, and shared
/// contract §8 says so. <paramref name="CustomerId"/> is the business this session is acting for,
/// and <paramref name="MembershipRole"/> is what this person may do IN THAT BUSINESS; the same
/// account signed in for another business returns a different value in both fields.
/// </para>
/// <para>
/// Plan 2 adds <c>memberships[]</c> — <c>{ customerId, tradeName, membershipRole }</c> — on top of
/// this, which is what the rail switcher draws from. That half is additive and is deliberately not
/// here: it needs a read across businesses, which is the route plan 2 owns.
/// </para>
/// </summary>
public sealed record CurrentAccountResponse(
    Guid AccountId,
    Guid CustomerId,
    string FirstName,
    string LastName,
    string Email,
    string MembershipRole);
```

`PortalContracts.cs:40-45` — replace `bool IsAdmin,` with `string MembershipRole,` and extend the
record's doc comment with:

```csharp
/// <para>
/// ⚠ <c>membershipRole</c> and never <c>role</c>: <c>role</c> is already JOB TITLE on the account
/// record, which <c>[F01-R13]</c> says is "descriptive only… never checked". The value is this
/// person's role in the business the CALLER is acting for; the same colleague may be an admin
/// somewhere else, and this list is not the place that says so.
/// </para>
```

`AccountDtos.cs` — replace `bool IsAdmin,` with `string MembershipRole,` in all three records, and
add to `CreateAccountRequest`:

```csharp
/// <param name="MembershipRole">
/// ⚠ <c>admin</c>, <c>trader</c> or <c>viewer</c>. Replaces the <c>isAdmin</c> boolean: an account
/// no longer has a role, a membership does, and this is the role of the membership being created in
/// the company named by the route.
/// </param>
```

`PortalMappings.cs:147-156` — before:

```csharp
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
```

after:

```csharp
    /// <param name="membershipRole">
    /// This person's role in the business the caller is acting for. Passed in rather than read off
    /// <paramref name="account"/> for the reason the whole plan exists: an account has no role, a
    /// membership does, and one account has several.
    /// </param>
    public static CompanyAccountDto ToAccountDto(CustomerAccount account, MembershipRole membershipRole) =>
        new(account.Id,
            account.FirstName,
            account.LastName,
            account.JobTitle,
            account.Email,
            account.Phone,
            Wire(account.Status),
            MembershipRoleWire.Of(membershipRole),
            account.LastLoginAt);
```

⚠ `MembershipRoleWire.Of`, not `EnumWireFormat.ToWire`, and **not** an inline
`role.ToString().ToLowerInvariant()` here. The wire spelling of this one enum is the **column's**
spelling — lower case — and shared contract §13.2 makes `MembershipRoleWire` (Task 1) the one place
it lives, so the mapper, the EF value converter and every endpoint below all call the same method.
`EnumWireFormat.ToWire` would emit `ADMIN` and disagree with everything the database, the policies
and the OpenAPI enum list say.

`EmployeeMappings.cs:42-46` — before:

```csharp
    public static AccountDto ToDto(CustomerAccount account) =>
        new(account.Id, account.CustomerId, account.Username, account.FirstName, account.LastName,
            account.JobTitle, account.Email, account.Phone,
            EnumWireFormat.ToWire(account.Status),
            account.IsAdmin, account.LastLoginAt);
```

after:

```csharp
    /// <param name="customerId">
    /// The business this account is being shown as part of. ⚠ An argument rather than
    /// <c>account.CustomerId</c>, which task 17 removes: the back office always knows which company
    /// it is looking at, from the route or from the query it just ran.
    /// </param>
    public static AccountDto ToDto(
        CustomerAccount account, Guid customerId, MembershipRole membershipRole) =>
        new(account.Id, customerId, account.Username, account.FirstName, account.LastName,
            account.JobTitle, account.Email, account.Phone,
            EnumWireFormat.ToWire(account.Status),
            MembershipRoleWire.Of(membershipRole), account.LastLoginAt);
```

- [ ] **Step 5: Move the four endpoints, the seeder and the twelve fixtures**

**`AuthEndpoints`.** Add the selection helper next to `SessionFor` (around `:363`):

```csharp
    /// <summary>
    /// Which business this sign-in lands in, and with what role. Design section 5: the one last
    /// used if it is still an ACTIVE membership, otherwise the OLDEST membership by
    /// <c>created_at</c>.
    /// </summary>
    /// <remarks>
    /// ⚠ "Otherwise the OLDEST", never "otherwise any". An arbitrary pick lands somebody in an
    /// arbitrary business to take audited actions in, and two sign-ins a minute apart would land
    /// them in different ones.
    /// <para>
    /// ⚠ <c>last_active_business_id</c> is a PREFERENCE and not an entitlement: it is only honoured
    /// if the membership it names is still active. Otherwise removal would be reversible by a stale
    /// column.
    /// </para>
    /// <para>
    /// Null means zero active memberships — a state that has never existed before this design, and
    /// which every entry point has to handle. This one answers with a named 401; plan 2 owns the
    /// final wording and the probe.
    /// </para>
    /// </remarks>
    private static async Task<CustomerMembership?> SelectBusinessAsync(
        PeakPowerDbContext db, CustomerAccount account, CancellationToken cancellationToken)
    {
        // No query filter narrows this: sign-in is anonymous, so every filter in this DbContext
        // collapses to true, and the connection is the owner's. That is correct here - the caller
        // has just proved the password, and the whole point is to find which businesses they are
        // in before any tenancy is declared.
        var active = await db.CustomerMemberships
            .Where(membership => membership.AccountId == account.Id && membership.RemovedAt == null)
            .OrderBy(membership => membership.CreatedAt)
            .ToListAsync(cancellationToken);

        return active.FirstOrDefault(
                   membership => membership.CustomerId == account.LastActiveBusinessId)
               ?? active.FirstOrDefault();
    }
```

Replace the sign-in block at `:170-187` — before:

```csharp
                var access = tokens.IssueAccessToken(account, account.CustomerId);
                var refresh = tokens.IssueRefreshToken(account.Id, out var refreshExpiresAt);
                db.RefreshTokens.Add(RefreshToken.Issue(
                    account.Id, account.CustomerId, OpaqueToken.HashOf(refresh), now, refreshExpiresAt));

                await db.SaveChangesAsync(cancellationToken);

                RefreshCookie.Write(response, refresh, refreshExpiresAt);

                return Results.Ok(new SignInResponse(
                    access.Jwt,
                    access.ExpiresAt,
                    new CurrentAccountResponse(
                        account.Id, account.CustomerId, account.FirstName,
                        account.LastName, account.Email, account.IsAdmin)));
```

after:

```csharp
                var membership = await SelectBusinessAsync(db, account, cancellationToken);
                if (membership is null)
                {
                    // ⚠ Deliberately NOT SignInFailed(): the password was right and saying
                    // otherwise would send somebody to reset a password that is fine. It is still a
                    // 401 rather than a 403 - [F13-R19] - and it is a named, terminal answer rather
                    // than a crash, which is the floor design section 5 asks for.
                    return NotAMemberOfAnyBusiness();
                }

                var access = tokens.IssueAccessToken(account, membership.CustomerId);
                var refresh = tokens.IssueRefreshToken(account.Id, out var refreshExpiresAt);
                db.RefreshTokens.Add(RefreshToken.Issue(
                    account.Id, membership.CustomerId, OpaqueToken.HashOf(refresh), now, refreshExpiresAt));

                await db.SaveChangesAsync(cancellationToken);

                RefreshCookie.Write(response, refresh, refreshExpiresAt);

                return Results.Ok(new SignInResponse(
                    access.Jwt,
                    access.ExpiresAt,
                    new CurrentAccountResponse(
                        account.Id, membership.CustomerId, account.FirstName,
                        account.LastName, account.Email,
                        MembershipRoleWire.Of(membership.Role))));
```

and add the refusal beside `SignInFailed`:

```csharp
    /// <summary>
    /// Zero active memberships. Distinguishable from a wrong password on purpose - the credential
    /// was right - and identical for "removed from your last business" and "never invited into
    /// one", because those differ by nothing the caller may learn.
    /// </summary>
    private static IResult NotAMemberOfAnyBusiness() =>
        Results.Json(
            new Microsoft.AspNetCore.Mvc.ProblemDetails
            {
                Status = StatusCodes.Status401Unauthorized,
                Title = "Not signed in",
                Detail = "This account is not a member of any business.",
            },
            statusCode: StatusCodes.Status401Unauthorized,
            contentType: "application/problem+json");
```

`/me` at `:206-219` — the role is already proven on this request, so read it from the context rather
than querying again. Add `ICustomerContext customer` is already a parameter; replace the response
construction — before:

```csharp
                    : new CurrentAccountResponse(
                        account.Id, account.CustomerId, account.FirstName,
                        account.LastName, account.Email, account.IsAdmin));
```

after:

```csharp
                    : new CurrentAccountResponse(
                        account.Id, customer.CustomerId, account.FirstName,
                        account.LastName, account.Email,
                        // The role CustomerSessionMiddleware proved for THIS request. No second
                        // query: it already read customer_membership, and re-reading it here could
                        // disagree with what the CompanyAdmin policy is using on the same request.
                        MembershipRoleWire.Of(customer.Role)));
```

`SessionFor` at `:363-369` — it is called from the two refresh paths, which hold a `stored` token
naming its business. Change it to take both — before:

```csharp
    private static SignInResponse SessionFor(CustomerAccount account, AccessToken access) =>
        new(access.Jwt,
            access.ExpiresAt,
            new CurrentAccountResponse(
                account.Id, account.CustomerId, account.FirstName,
                account.LastName, account.Email, account.IsAdmin));
```

after:

```csharp
    private static SignInResponse SessionFor(
        CustomerAccount account, AccessToken access, CustomerMembership membership) =>
        new(access.Jwt,
            access.ExpiresAt,
            new CurrentAccountResponse(
                account.Id, membership.CustomerId, account.FirstName,
                account.LastName, account.Email,
                MembershipRoleWire.Of(membership.Role)));
```

and at both refresh call sites (`:323` and `:361`), load the membership for the token's own business
before building the response:

```csharp
        // The business this refresh chain belongs to, and the role in it AS IT IS NOW - a refresh
        // that re-reported a role captured at sign-in would be a fifteen-minute window by another
        // name. ⚠ Plan 2 turns a null here into a distinct TERMINAL signal so a removed member's
        // client signs out instead of looping; plan 1's floor is the same rejection refresh already
        // gives an unusable token.
        var membership = await db.CustomerMemberships.SingleOrDefaultAsync(
            m => m.AccountId == account.Id && m.CustomerId == stored.CustomerId && m.RemovedAt == null,
            cancellationToken);

        if (membership is null)
        {
            return RefreshRejected(response);
        }
```

**`CompanyEndpoints`** at `:70-90` — the colleague list must report each person's role in the active
business, which means joining membership rather than reading a column. Before:

```csharp
                var accounts = await db.CustomerAccounts
                    .AsNoTracking()
                    .OrderBy(a => a.LastName).ThenBy(a => a.FirstName)
                    .ToListAsync(cancellationToken);

                return Results.Ok(new CompanyAccountsResponse(
                    accounts.Select(PortalMappings.ToAccountDto).ToList()));
```

after:

```csharp
                // ⚠ An explicit customer_id predicate on the MEMBERSHIP, even though the global
                // query filter already narrows the accounts. CustomerMembership deliberately
                // carries no query filter - the switcher must read across businesses - and its
                // row-level-security policy's USING arm is permissive for the same reason, so
                // nothing narrows this join but the join itself. This is the "every admin-surface
                // query must carry AND customer_id = @active" rule from design section 4.2, and
                // this list is the first query it applies to.
                var rows = await db.CustomerAccounts
                    .AsNoTracking()
                    .Join(
                        db.CustomerMemberships.Where(membership =>
                            membership.CustomerId == customer.CustomerId &&
                            membership.RemovedAt == null),
                        account => account.Id,
                        membership => membership.AccountId,
                        (account, membership) => new { Account = account, membership.Role })
                    .OrderBy(row => row.Account.LastName).ThenBy(row => row.Account.FirstName)
                    .ToListAsync(cancellationToken);

                return Results.Ok(new CompanyAccountsResponse(
                    rows.Select(row => PortalMappings.ToAccountDto(row.Account, row.Role)).ToList()));
```

adding `ICustomerContext customer` to that handler's parameter list.

**`OnboardingService`** at `:428` — delete `isAdmin: true).Value;` from the `CustomerAccount.Create`
argument list, leaving `status: AccountStatus.Active).Value;`. The admin fact now lives entirely in
the `CustomerMembership.Create(..., MembershipRole.Admin, now)` that Task 5 added three lines below,
and the comment there already says so.

**`AccountEndpoints`** (employee) at `:85-94` — drop `request.IsAdmin` from `Create` and read the
role from the request instead:

```csharp
        var created = CustomerAccount.Create(
            customerId,
            request.Username,
            request.FirstName,
            request.LastName,
            request.JobTitle,
            request.Email,
            request.Phone,
            AccountStatus.Invited);
```

and, in the membership `Add` Task 5 wrote, replace the ternary with the request's role:

```csharp
        db.CustomerMemberships.Add(CustomerMembership.Create(
            account.Id,
            customerId,
            MembershipRoleWire.Parse(request.MembershipRole),
            calendar.UtcNow).Value);
```

at `:154-160`, `UpdateAsync` loses `request.IsAdmin` and changes the membership's role instead:

```csharp
        var updated = account.UpdateProfile(
            request.FirstName,
            request.LastName,
            request.JobTitle,
            request.Email,
            request.Phone);

        if (!updated.IsSuccess)
        {
            return ApiResults.InvalidRequest("request", updated.Error);
        }

        // ⚠ The role is not on the account any more, so this is a second write to a second table -
        // in the same SaveChangesAsync, so a half-applied edit is not a state this endpoint can
        // produce. The back office edits the account's membership OF THE COMPANY IT BELONGS TO,
        // which is unambiguous today because the route addresses one account; task 16 is where the
        // employee host learns to say which business it means when there is more than one.
        var membership = await db.CustomerMemberships
            .FirstOrDefaultAsync(m => m.AccountId == id && m.RemovedAt == null, cancellationToken);

        if (membership is null)
        {
            return ApiResults.NotFound();
        }

        membership.ChangeRole(MembershipRoleWire.Parse(request.MembershipRole));

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(EmployeeMappings.ToDto(account, membership.CustomerId, membership.Role));
```

⚠ **No private `ParseMembershipRole` helper on this class.** An earlier revision added one wrapping
the converter; shared contract §13.2 collapses all three parallel role helpers onto
`MembershipRoleWire`, so both call sites above name `MembershipRoleWire.Parse` directly and the file
gains `using PeakPower.Domain.Customers;` if it does not already have it.

⚠ `CreateAccountRequestValidator` and `UpdateAccountRequestValidator` must gain a rule that
`MembershipRole` is one of the three literals, or `MembershipRoleWire.Parse` throws an
`ArgumentOutOfRangeException` that surfaces as a 500 instead of a 400. Read
`src/Hosts/PeakPower.Api.Employee/Validation/` (or wherever `Validate<CreateAccountRequest>()`
resolves its validator) and add

```csharp
        RuleFor(request => request.MembershipRole)
            .Must(MembershipRoleWire.Values.Contains)
            .WithMessage($"membershipRole must be one of: {string.Join(", ", MembershipRoleWire.Values)}.");
```

⚠ `MembershipRoleWire.Values`, not three literals repeated here — that is the third member of the
helper Task 1 ships, and it exists so a fourth role cannot be added without this message following.

**`CustomerEndpoints`** (employee) at `:289-294` — `BuildDetailAsync` maps accounts through `ToDto`,
which now needs a role. Join membership the same way the portal does:

```csharp
        var accounts = await db.CustomerAccounts
            .AsNoTracking()
            .Join(
                db.CustomerMemberships.Where(membership =>
                    membership.CustomerId == id && membership.RemovedAt == null),
                account => account.Id,
                membership => membership.AccountId,
                (account, membership) => new { Account = account, membership.Role })
            .OrderBy(row => row.Account.Username)
            .ToListAsync(cancellationToken);
```

and its use two blocks down:

```csharp
            accounts.Select(row => EmployeeMappings.ToDto(row.Account, id, row.Role)).ToArray(),
```

**`DemoDataSeeder`** at `:61` — `Person`'s last field becomes the role:

```csharp
    private sealed record Person(
        string First, string Last, string Email, string? JobTitle, MembershipRole MembershipRole);
```

at `:159-170`, drop `person.IsAdmin` from `Create` and pass `person.MembershipRole` to the
membership. Every `new Person(...)` literal in the file changes its last argument from `true`/`false`
to `MembershipRole.Admin`/`MembershipRole.Trader` — read the file and change each; the literals are
in the `Company` table further up.

**The twelve fixtures.** Every `CustomerAccount.Create(...)` call drops its `isAdmin:` argument and
every `UpdateProfile(...)` call drops its last one. The files, with the line the call starts on:

| File | Line |
| --- | --- |
| `tests/PeakPower.Integration.Tests/CustomerApiFactory.cs` | `176` |
| `tests/PeakPower.Integration.Tests/Tenancy/TenancyFixture.cs` | `183`, `187`, and the shared account Task 5 added |
| `tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs` | `457` |
| `tests/PeakPower.Integration.Tests/Migrations/AuthSchemaTests.cs` | `142`, `145`, `429`, `432` |
| `tests/PeakPower.Integration.Tests/Portal/CompanyEndpointTests.cs` | `56` |
| `tests/PeakPower.Integration.Tests/Auth/SignOutTests.cs` | `155` |
| `tests/PeakPower.Integration.Tests/Employee/EmployeeMappingsTests.cs` | `44` |
| `tests/PeakPower.Integration.Tests/Onboarding/OnboardingMaterialisationTests.cs` | `265` |
| `tests/PeakPower.Integration.Tests/Auth/MembershipRequestPathTests.cs` | the colleague in `SeedMemberOfBothAsync` |
| `tests/PeakPower.Application.Tests/Security/CustomerTokenValidationTests.cs` | `39` |
| `tests/PeakPower.Application.Tests/Security/JwtTokenIssuerTests.cs` | `31` |
| `tests/PeakPower.Application.Tests/Abstractions/PortShapeTests.cs` | `43` |
| `tests/PeakPower.Domain.Tests/Customers/CustomerAccountTests.cs` | `17`, `76` |

⚠ `CustomerApiFactory.SeedCustomerWithAccountAsync`'s `bool isAdmin = false` parameter stays — it now
decides only the **membership's** role in the `TestMemberships.Active(...)` call Task 5 added. Its
doc comment at `:152-156` should say so; the default is still false and still the point.

⚠ `CustomerAccountTests` needs more than a mechanical edit. `:22-32`'s
`account.IsAdmin.ShouldBeFalse()` and `:132-147`'s `account.IsAdmin.ShouldBeTrue()` are assertions
about a member that no longer exists; delete those two lines, and add:

```csharp
    [Fact]
    public void An_account_carries_no_role_of_its_own()
    {
        // ⚠ Asserted as an ABSENCE. One person is now in several businesses with a different role
        // in each, which no boolean or enum on this row can say - and a property quietly reinstated
        // here would be a second source of truth for the fact CustomerMembership owns, which is how
        // a demoted admin keeps admin rights for fifteen minutes.
        typeof(CustomerAccount).GetProperty("IsAdmin").ShouldBeNull();
        typeof(CustomerAccount).GetProperty("Role").ShouldBeNull();
        typeof(CustomerAccount).GetProperty("MembershipRole").ShouldBeNull();
    }
```

- [ ] **Step 6: Re-approve both OpenAPI snapshots**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~OpenApiSnapshotTests" > /tmp/task15-snapshots.txt 2>&1
cat /tmp/task15-snapshots.txt
```

Expected: FAIL, both, with Verify writing `.received.json` beside each `.verified.json`.

**Read the diff before approving it.** The only changes must be `isAdmin` (a `boolean`) leaving five
schemas and `membershipRole` (a `string`) arriving in four — `CurrentAccountResponse`,
`CompanyAccountDto`, `AccountDto`, `CreateAccountRequest`, `UpdateAccountRequest`. Anything else in
the diff is a change this task did not intend:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
diff tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json \
     tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.received.json \
  > /tmp/task15-customer-diff.txt; cat /tmp/task15-customer-diff.txt
diff tests/PeakPower.Integration.Tests/Contract/EmployeeOpenApiSnapshotTests.the_employee_openapi_document_matches_the_reviewed_snapshot.verified.json \
     tests/PeakPower.Integration.Tests/Contract/EmployeeOpenApiSnapshotTests.the_employee_openapi_document_matches_the_reviewed_snapshot.received.json \
  > /tmp/task15-employee-diff.txt; cat /tmp/task15-employee-diff.txt
```

Then approve by replacing each `.verified.json` with its `.received.json` and deleting the received
files.

- [ ] **Step 7: Run everything and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln --nologo > /tmp/task15-after.txt 2>&1; tail -40 /tmp/task15-after.txt
```

Expected: build clean; the whole solution green.

- [ ] **Step 8: Mutate sign-in's selection twice**

**(a) "Any membership" instead of the oldest.** Reverse the ordering in `SelectBusinessAsync`:

```csharp
            .OrderByDescending(membership => membership.CreatedAt)   // MUTATION
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MembershipRequestPathTests"`

Expected: FAIL, `Sign_in_falls_back_to_the_OLDEST_membership_and_not_to_an_arbitrary_one` —
`body!.Account.CustomerId should be <A> but was <B>`, and `membershipRole should be "trader" but was
"viewer"`. ⚠ `Sign_in_reports_the_membership_role_and_lands_in_the_last_active_business` stays
**green**, because the preference wins before the ordering is consulted — which is exactly why the
fallback needs its own test rather than riding on the preference one.

**(b) Honour a removed preference.** Restore, then drop the active check from the preference lookup:

```csharp
        var all = await db.CustomerMemberships
            .Where(membership => membership.AccountId == account.Id)   // MUTATION: RemovedAt filter gone
```

Expected: FAIL, `Sign_in_ignores_a_last_active_business_the_person_has_been_removed_from` —
`should be <A> but was <B>`. Somebody removed from a business has just been signed into it, and the
access token that comes back names it. ⚠ The request would then 401 on its very next call, because
`CustomerSessionMiddleware` proves membership again — so the mutant is not a data leak either, it is
a sign-in that hands out a token nothing accepts. Restore, and confirm:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -c "MUTATION" src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs > /tmp/task15-restore.txt
cat /tmp/task15-restore.txt
```

Expected: `0`.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src tests tools
git commit -m "feat: the is_admin sweep, and sign-in learns to choose a business

Shared contract section 10: roughly a dozen production sites, not one. The domain property,
the EF mapping, five wire contracts, both mappings, four endpoints, the demo seeder and
thirteen fixtures. isAdmin stops being a boolean anywhere; membershipRole - admin, trader or
viewer, lower case to match the column - takes its place, and never 'role', which is already
job title on the account record and which [F01-R13] says is never checked.

⚠ Deviation D9: dropping the column forces sign-in's business selection into plan 1 rather
than plan 2. It ships design section 5's rule and no more - last_active_business_id if that
membership is still ACTIVE, otherwise the OLDEST by created_at, otherwise a named 401 that is
deliberately distinguishable from a wrong password. Never 'any membership': an arbitrary pick
lands somebody in an arbitrary business to take audited actions in. Verified by mutation both
ways - reversing the ordering fails the fallback test while the preference test stays green,
and honouring a removed preference signs somebody into a business they were removed from.

The colleague list joins membership with an explicit AND customer_id = @active. CustomerMembership
carries no query filter and its policy's USING arm is permissive, both so the switcher can
read across businesses - so nothing narrows that join but the join itself. This is the first
query design section 4.2's rule applies to and it will not be the last.

Both OpenAPI snapshots re-approved: isAdmin leaves five schemas, membershipRole arrives in
four. ⚠ The web repo's fourteen isAdmin call sites will stop compiling after
npm run generate:clients. Plan 3 owns every one of them - Task 2 for the customer portal, Task 3
for the employee portal (contract 13.3) - and the compile break is the intended handoff signal
rather than a silent undefined.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 16: The F12 employee surface — counting and listing people by membership

Shared contract §10: *"The **whole F12 employee surface for customer accounts is in scope** — create
account with a company, update the admin flag, list and count accounts by company."* Create and
update landed in Tasks 5 and 15. What is left is the reading half, and it is the last thing in the
employee host that answers "which people belong to this company" by looking at a column.

⚠ **`GroupBy(account => account.CustomerId)` is the site the contract means by "count by company".**
It is one line, it feeds the customer list's `accountCount` badge, and it is the last reader of that
column in the employee host. After this task the number means *active memberships of this company*,
which is both the right question and a different number from before for anybody in two businesses —
they now count in both, which is correct and was previously unrepresentable.

⚠ **The employee host runs as `app_employee_role`**, whose membership policy is
`USING (true) WITH CHECK (true)`. Nothing narrows these reads but the predicates written here, which
is exactly the situation `AND customer_id = @active` exists for on the customer side — the same
discipline, for the same reason, on a connection that has no tenant at all.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Employee/Endpoints/CustomerEndpoints.cs:130-135`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Employee/EmployeeMappingsTests.cs:44-72`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Employee/AccountEndpointTests.cs` (append)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs:84`

**Interfaces:**
- Consumes: `EmployeeMappings.ToDto(account, customerId, membershipRole)` (Task 15);
  `PeakPowerDbContext.CustomerMemberships`.
- Produces: nothing consumed by a later task. This is the last reader of
  `CustomerAccount.CustomerId` outside `Create`, which is what makes Task 17 possible.

- [ ] **Step 1: Write the failing test**

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Employee/AccountEndpointTests.cs`:

```csharp
    [Fact]
    public async Task A_person_in_two_companies_is_counted_in_both()
    {
        // ⚠ A number that was previously unrepresentable. accountCount used to be "rows whose
        // customer_id is this company", which could only ever count somebody once; it is now
        // "active memberships of this company", which counts them in each. That is the right
        // question - the badge means "people who can sign in here" - and it is the one the old
        // column could not answer.
        var ct = TestContext.Current.CancellationToken;
        var firstCompany = await SeedCustomerAsync(ct);
        var secondCompany = await SeedCustomerAsync(ct);

        var username = $"{Guid.NewGuid():N}@example.test";
        var created = await Client.PostAsJsonAsync(
            $"/api/v1/customers/{firstCompany}/accounts",
            new CreateAccountRequest(username, "Nina", "Vos", "Analyst", username, null, "trader"),
            ct);
        created.StatusCode.ShouldBe(HttpStatusCode.Created);
        var account = await created.Content.ReadFromJsonAsync<AccountDto>(ct);

        await using (var db = Factory.CreateOwnerDbContext())
        {
            db.CustomerMemberships.Add(CustomerMembership.Create(
                account!.Id,
                secondCompany,
                MembershipRole.Admin,
                new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero)).Value);
            await db.SaveChangesAsync(ct);
        }

        var list = await Client.GetFromJsonAsync<CustomerListResponse>(
            "/api/v1/customers?page=1&pageSize=100", ct);

        list!.Items.Single(item => item.Id == firstCompany).AccountCount.ShouldBe(1);
        list.Items.Single(item => item.Id == secondCompany).AccountCount.ShouldBe(1);
    }

    [Fact]
    public async Task A_removed_membership_stops_counting_and_stops_being_listed()
    {
        // Removal is a timestamp, so a count that forgot removed_at would keep counting leavers
        // for ever - and the detail list would keep showing them, which is worse.
        var ct = TestContext.Current.CancellationToken;
        var customerId = await SeedCustomerAsync(ct);

        var username = $"{Guid.NewGuid():N}@example.test";
        var created = await Client.PostAsJsonAsync(
            $"/api/v1/customers/{customerId}/accounts",
            new CreateAccountRequest(username, "Joost", "Peters", null, username, null, "viewer"),
            ct);
        var account = await created.Content.ReadFromJsonAsync<AccountDto>(ct);

        await using (var db = Factory.CreateOwnerDbContext())
        {
            var membership = await db.CustomerMemberships.SingleAsync(
                m => m.AccountId == account!.Id && m.CustomerId == customerId, ct);
            membership.Remove(DateTimeOffset.UtcNow);
            await db.SaveChangesAsync(ct);
        }

        var list = await Client.GetFromJsonAsync<CustomerListResponse>(
            "/api/v1/customers?page=1&pageSize=100", ct);
        list!.Items.Single(item => item.Id == customerId).AccountCount.ShouldBe(0);

        var detail = await Client.GetFromJsonAsync<CustomerDetailDto>(
            $"/api/v1/customers/{customerId}", ct);
        detail!.Accounts.ShouldBeEmpty();
    }

    [Fact]
    public async Task The_back_office_reports_the_membership_role_it_was_asked_for()
    {
        var ct = TestContext.Current.CancellationToken;
        var customerId = await SeedCustomerAsync(ct);

        var username = $"{Guid.NewGuid():N}@example.test";
        var created = await Client.PostAsJsonAsync(
            $"/api/v1/customers/{customerId}/accounts",
            new CreateAccountRequest(username, "Nina", "Vos", "Analyst", username, null, "admin"),
            ct);

        var account = await created.Content.ReadFromJsonAsync<AccountDto>(ct);
        account!.MembershipRole.ShouldBe("admin", Case.Sensitive);
        account.CustomerId.ShouldBe(customerId);

        // And the update path changes the MEMBERSHIP rather than a column on the account.
        var updated = await Client.PatchAsJsonAsync(
            $"/api/v1/accounts/{account.Id}",
            new UpdateAccountRequest("Nina", "Vos", "Analyst", username, null, "viewer"),
            ct);
        updated.StatusCode.ShouldBe(HttpStatusCode.OK);

        (await updated.Content.ReadFromJsonAsync<AccountDto>(ct))!
            .MembershipRole.ShouldBe("viewer", Case.Sensitive);
    }

    [Theory]
    [InlineData("owner")]
    [InlineData("ADMIN")]
    [InlineData("")]
    public async Task A_membership_role_the_enum_does_not_have_is_a_400_and_not_a_500(string role)
    {
        // ⚠ MembershipRoleWire.Parse throws on an unknown name rather than defaulting to member
        // zero, which is Admin. That is the right default and the wrong RESPONSE - an unhandled
        // ArgumentOutOfRangeException is a 500 - so the validator has to reject it first. "ADMIN"
        // is in the theory deliberately: the column's spelling is lower case, Parse is
        // case-SENSITIVE, and a case-insensitive parse would let the wire drift away from the
        // column one screen at a time.
        var ct = TestContext.Current.CancellationToken;
        var customerId = await SeedCustomerAsync(ct);
        var username = $"{Guid.NewGuid():N}@example.test";

        var response = await Client.PostAsJsonAsync(
            $"/api/v1/customers/{customerId}/accounts",
            new CreateAccountRequest(username, "Nina", "Vos", null, username, null, role),
            ct);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }
```

⚠ `SeedCustomerAsync`, `Client`, `Factory`, `CustomerListResponse` and `CustomerDetailDto` are
whatever this class and `PeakPower.Contracts.Employee` already call them; read `:1-80` and the
contracts file and use the existing names. `AccountCount` is the property `CustomerListItemDto`
already exposes (`EmployeeMappings.ToListItem` passes it at `:67-71`).

- [ ] **Step 2: Run the tests and watch them fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~AccountEndpointTests" > /tmp/task16-before.txt 2>&1; cat /tmp/task16-before.txt`

Expected: FAIL, three of the four.

- `A_person_in_two_companies_is_counted_in_both`: the second company's badge is
  `should be 1 but was 0` — the count groups on the account's own column, which names only the first.
- `A_removed_membership_stops_counting_and_stops_being_listed`: the count is
  `should be 0 but was 1` — the account row is untouched by a removal, so a column-based count keeps
  counting a leaver for ever. ⚠ The detail assertion **passes** already, because Task 15 rewrote
  `BuildDetailAsync` to join membership; only the count is left.
- `A_membership_role_the_enum_does_not_have_is_a_400_and_not_a_500`: all three cases fail with
  `should be BadRequest but was InternalServerError` unless Task 15's validator rule landed —
  if they pass, it did, and this test is now the thing that keeps it there.
- `The_back_office_reports_the_membership_role_it_was_asked_for` passes — Task 15 built it.

- [ ] **Step 3: Count by membership**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Employee/Endpoints/CustomerEndpoints.cs`,
replace `:130-135` — before:

```csharp
        var accountCounts = await db.CustomerAccounts
            .AsNoTracking()
            .Where(account => identifiers.Contains(account.CustomerId))
            .GroupBy(account => account.CustomerId)
            .Select(grouping => new { CustomerId = grouping.Key, Count = grouping.Count() })
            .ToDictionaryAsync(row => row.CustomerId, row => row.Count, cancellationToken);
```

after:

```csharp
        // ⚠ Counted off customer_membership, not off customer_account, and the number is different
        // for anybody in two businesses: they now count in EACH, which is what the badge means -
        // "people who can sign in here" - and which the old column structurally could not say.
        //
        // removed_at IS NULL is not optional. Removal is a timestamp rather than a delete, so a
        // count without it keeps counting leavers for ever.
        //
        // ⚠ This runs as app_employee_role, whose membership policy is USING (true) WITH CHECK
        // (true). Nothing narrows this read but the predicate written here - the same situation
        // the customer side's "AND customer_id = @active" rule exists for, on a connection that
        // has no tenant at all.
        var accountCounts = await db.CustomerMemberships
            .AsNoTracking()
            .Where(membership =>
                identifiers.Contains(membership.CustomerId) && membership.RemovedAt == null)
            .GroupBy(membership => membership.CustomerId)
            .Select(grouping => new { CustomerId = grouping.Key, Count = grouping.Count() })
            .ToDictionaryAsync(row => row.CustomerId, row => row.Count, cancellationToken);
```

- [ ] **Step 4: Move the two remaining fixtures**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Employee/EmployeeMappingsTests.cs`,
the test at `:44-72` builds an account and asserts `dto.IsAdmin.ShouldBeFalse()`. Replace `:72` —
before:

```csharp
        dto.IsAdmin.ShouldBeFalse();
```

after:

```csharp
        dto.MembershipRole.ShouldBe("trader", Case.Sensitive);
```

and pass the two new arguments at the `ToDto` call a few lines above:

```csharp
        var dto = EmployeeMappings.ToDto(account, CustomerId, MembershipRole.Trader);
```

⚠ `CustomerId` is whatever local that test already uses for the company; read `:40-50`. The point of
the assertion is that the mapping reports the role it was **given**, not one it looked up — which is
what makes it safe for the two endpoints to pass different values for the same account.

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs`,
replace `:84` — before:

```csharp
        accounts.Where(a => a.IsAdmin).Select(a => a.CustomerId).Distinct()
```

after:

```csharp
        // Reads memberships rather than accounts: "which companies have an admin" is a question
        // about memberships now, and the account row has nothing to say about it.
        memberships.Where(m => m.Role == MembershipRole.Admin).Select(m => m.CustomerId).Distinct()
```

loading `memberships` beside the `accounts` the test already loads:

```csharp
        var memberships = await db.CustomerMemberships.AsNoTracking().ToListAsync(ct);
```

- [ ] **Step 5: Run everything and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln --nologo > /tmp/task16-after.txt 2>&1; tail -30 /tmp/task16-after.txt
```

Expected: build clean; the whole solution green.

Now confirm the claim that makes Task 17 possible — nothing outside `CustomerAccount.Create` reads
the property any more:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -rn "account\.CustomerId\|\.Account\.CustomerId\|a\.CustomerId" src > /tmp/task16-readers.txt
cat /tmp/task16-readers.txt
```

Expected: **no output**. Every remaining `CustomerId` in `src` belongs to another entity
(`MeteringPoint`, `Wallet`, `AuditRecord`, `CustomerEntitlement`, `RefreshToken`,
`CustomerMembership`) or to `ICustomerContext`. If a line does come back, it is a reader Task 17
would have broken and this is the moment to find it.

- [ ] **Step 6: Mutate the count's removal term, then its grouping**

Drop `&& membership.RemovedAt == null`:

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~A_removed_membership_stops_counting_and_stops_being_listed"`

Expected: FAIL — `AccountCount should be 0 but was 1`. The badge keeps counting a leaver.

Restore, then group on the wrong key — `membership.AccountId`:

Expected: FAIL, `A_person_in_two_companies_is_counted_in_both`, with a
`System.Collections.Generic.KeyNotFoundException` or a badge of `0` depending on how the dictionary
lookup falls — read the actual output. ⚠ Either way the failure is loud, which is the property
worth having: a count keyed on the wrong column is the kind of thing that otherwise reads as
plausible for months. Restore and confirm:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -c "GroupBy(membership => membership.CustomerId)" src/Hosts/PeakPower.Api.Employee/Endpoints/CustomerEndpoints.cs \
  > /tmp/task16-restore.txt; cat /tmp/task16-restore.txt
```

Expected: `1`.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Employee/Endpoints/CustomerEndpoints.cs tests/PeakPower.Integration.Tests
git commit -m "feat(back-office): count and list customer accounts by membership

The last reader of customer_account.customer_id in the employee host. Shared contract
section 10 put the whole F12 account surface in scope; create and update landed earlier, and
this is the reading half.

The accountCount badge now means active memberships of this company, which is both the right
question - 'people who can sign in here' - and a different number for anybody in two
businesses: they count in each, which the old column structurally could not say. Verified by
mutation: dropping removed_at IS NULL keeps counting leavers for ever.

grep for account.CustomerId across src now returns nothing, which is what makes the next
commit's column drop possible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 17: Migration 15, step 8 — drop `customer_id` and `is_admin`, and hold the guards honest

Design §9 step 4, and the only irreversible thing in this plan. It is last on purpose.

⚠ **`ALTER TABLE … DROP COLUMN customer_id` errors on a dependent object if any policy still reads
it**, and `CASCADE` would silently drop all three — leaving `customer_account` with row-level
security **enabled and no policy**, so every authenticated request 401s because the session
middleware's own account read returns nothing. Tasks 8 and 9 re-pointed all three, and
`MembershipSchemaTests.No_policy_anywhere_still_reads_customer_account_dot_customer_id` is the
assertion that says so. Run it before writing a line of this task.

⚠ **`customer_id` has no default, which is why the property and the column go in the same commit.**
`is_admin boolean NOT NULL DEFAULT false` could be un-mapped early and was, in Task 15; `customer_id
uuid NOT NULL` with no default would make every account insert a `23502` the moment EF stopped
supplying it.

⚠ **The pinned totals stay arithmetically right while `customer_account` loses its coverage** — which
is exactly what shared contract §9 item 2 warns about, and this is where it happens. The catalogue
guard discovers by `right(column_name, 11) = 'customer_id'`; after this commit `customer_account` has
no such column and drops out of the walk. Its policy is still there, still correct, and nothing would
notice if it were not. Hence the by-name assertion below. On the model side the same hole was closed
in advance: `AutomaticPolicyCoverageTests.CustomerIdOwned` has named `CustomerAccount` explicitly
since Task 3, so **its** numbers do not move here at all.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_MultiBusinessMembership.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/CustomerAccount.cs:17`, `:50-97`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/CustomerAccountConfiguration.cs:18-22`, `:42`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Employee/Endpoints/AccountEndpoints.cs:85-94`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Onboarding/OnboardingService.cs:420-429`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs:159-163`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh` (append)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs:219-236`, `:1050`, `:1070`, and append to `CatalogPolicyCoverageTests`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MembershipSchemaTests.cs` (the suffix test's expectation)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Model/ModelShapeTests.cs` (append)
- Test: the thirteen `CustomerAccount.Create` fixtures listed in Task 15's Step 5

**Interfaces:**
- Consumes: everything. This task is the one that makes the rest true.
- Produces: `CustomerAccount.Create(string username, string firstName, string lastName, string? jobTitle, string email, string? phone, AccountStatus status)`
  — **seven parameters, no `customerId`, no `isAdmin`**; a `customer.customer_account` with neither
  column.

- [ ] **Step 1: Prove the precondition before touching anything**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~No_policy_anywhere_still_reads_customer_account_dot_customer_id" \
  > /tmp/task17-precondition.txt 2>&1; cat /tmp/task17-precondition.txt
```

Expected: PASS. If it fails, a policy still depends on the column and this task's `DROP COLUMN` will
either error or — with a `CASCADE` somebody adds in frustration — silently unpolice the most
privilege-bearing table in the schema. Fix that first.

- [ ] **Step 2: Write the failing tests**

Change the expectation in
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MembershipSchemaTests.cs`
— before:

```csharp
        ((string?)await command.ExecuteScalarAsync(ct)).ShouldBe(
            "customer_id",
            "a preference column named last_customer_id would keep customer_account inside the " +
            "catalogue coverage guard's discovery keyed on something that is not a tenancy key");
```

after:

```csharp
        ((string?)await command.ExecuteScalarAsync(ct)).ShouldBe(
            "NONE",
            "⚠ customer_account now carries NO column ending in customer_id at all, which means the " +
            "catalogue coverage guard no longer discovers it. Its policy is still there and still " +
            "correct - customer_account_is_still_policied_by_name is what says so, because the " +
            "pinned totals stay arithmetically right while a table silently loses its coverage. " +
            "A preference column named last_customer_id would have hidden that by keeping the " +
            "table in discovery keyed on something that is not a tenancy key");
```

Append to `CatalogPolicyCoverageTests` in
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`:

```csharp
    /// <summary>
    /// ⚠ Shared contract section 9 item 2, and the reason it is written down there: after migration
    /// 15, <c>customer.customer_account</c> carries no column ending in <c>customer_id</c>, so
    /// <see cref="DiscoverTablesAsync"/> does not find it and the pinned totals above stay
    /// arithmetically right while the most privilege-bearing table in the schema drops out of the
    /// walk entirely. Its tenancy is an EXISTS over <c>customer_membership</c>, which no
    /// column-suffix predicate can see.
    /// <para>
    /// Named explicitly here rather than by widening the discovery query, because widening it to
    /// "tables an EXISTS mentions" would sweep in every table any policy happens to join through
    /// and turn a precise guard into a vague one. An explicit assertion is reviewable; a fuzzy
    /// predicate is not.
    /// </para>
    /// </summary>
    [Theory]
    [InlineData("customer", "customer_account", "customer_customer_account_tenant_isolation",
        "customer_customer_account_back_office")]
    public async Task A_table_the_suffix_predicate_can_no_longer_see_is_still_policied_by_name(
        string schema, string table, string tenantIsolationPolicy, string backOfficePolicy)
    {
        var ct = TestContext.Current.CancellationToken;
        await using var connection = TenancyFixture.Connect(_fixture.OwnerConnectionString);
        await connection.OpenAsync(ct);

        // Proves the premise as well as the conclusion: this table must genuinely be invisible to
        // the suffix walk, or the assertion below is redundant and somebody will delete it.
        var discovered = await DiscoverTablesAsync(connection, null, CustomerIdColumnPredicate, ct);
        discovered.ShouldNotContain(
            (schema, table),
            "if the suffix predicate can see this table again, a column ending in customer_id has " +
            "come back - and it is not a tenancy key, which is the trap the last_active_business_id " +
            "naming rule exists to avoid");

        var (rlsEnabled, policyCount) = await ReadCoverageAsync(connection, null, schema, table, ct);
        rlsEnabled.ShouldBeTrue();
        policyCount.ShouldBe(2);

        await using var names = new NpgsqlCommand(
            "SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies " +
            "WHERE schemaname = @schema AND tablename = @table",
            connection);
        names.Parameters.AddWithValue("schema", schema);
        names.Parameters.AddWithValue("table", table);

        var expected = new[] { backOfficePolicy, tenantIsolationPolicy }
            .OrderBy(name => name, StringComparer.Ordinal);

        ((string?)await names.ExecuteScalarAsync(ct)).ShouldBe(string.Join(',', expected));
    }
```

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Model/ModelShapeTests.cs`:

```csharp
    [Fact]
    public void The_account_carries_neither_of_the_columns_membership_replaced()
    {
        // ⚠ Asserted as an absence on the MODEL, alongside the domain-side reflection assertion in
        // CustomerAccountTests. FindProperty returns null rather than throwing, so a property
        // quietly reinstated under either name would otherwise pass unnoticed - and either one
        // coming back is a second source of truth for a fact customer_membership owns.
        var account = _context.Model.FindEntityType(typeof(CustomerAccount))!;

        account.FindProperty("CustomerId").ShouldBeNull(
            "an account belongs to no single company any more; customer_membership says which ones");
        account.FindProperty("IsAdmin").ShouldBeNull(
            "a role belongs to a membership, and one person has several");
    }

    [Fact]
    public void The_account_reaches_its_businesses_only_through_memberships()
    {
        // The positive half: the navigation is the ONLY link left, and the query filter is written
        // against it. A model where the navigation had also gone would pass the absence test above
        // and leave layer 1 with nothing to key on.
        var account = _context.Model.FindEntityType(typeof(CustomerAccount))!;

        account.GetNavigations()
            .Select(navigation => navigation.Name)
            .ShouldBe([nameof(CustomerAccount.Memberships)]);

        account.GetDeclaredQueryFilters().Count.ShouldBeGreaterThan(
            0, "layer 1 must still narrow this entity, through the navigation rather than a column");
    }
```

- [ ] **Step 3: Run them and watch them fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~ModelShapeTests|FullyQualifiedName~CatalogPolicyCoverageTests|FullyQualifiedName~No_column_on_customer_account_other_than_customer_id_ends_in_customer_id" > /tmp/task17-before.txt 2>&1; cat /tmp/task17-before.txt`

Expected: FAIL, four tests.

- `The_account_carries_neither_of_the_columns_membership_replaced`:
  `account.FindProperty("CustomerId") should be null but was CustomerId (Guid)`.
- `The_account_reaches_its_businesses_only_through_memberships`: `should be ["Memberships"] but was
  ["Memberships"]` — ⚠ this one may already **pass**: `HasOne<Customer>().WithMany()` declares no
  navigation on either side, so the only navigation today is already `Memberships`. Read the output;
  a pass here is correct and the test earns its place at Step 5's mutation.
- `A_table_the_suffix_predicate_can_no_longer_see_is_still_policied_by_name`:
  `discovered should not contain ("customer", "customer_account")` — the column is still there.
- `No_column_on_customer_account_other_than_customer_id_ends_in_customer_id`:
  `should be "NONE" but was "customer_id"`.

- [ ] **Step 4: Append step 8 to the migration, and take the property out**

Append inside `Up()`, after step 7b's trigger block:

```csharp
            // -----------------------------------------------------------------------------------
            // 8. ONLY NOW drop the two columns.
            //
            // ⚠ Last, and irreversible. Every policy that derived tenancy from
            // customer_account.customer_id was re-pointed in step 7 - DROP COLUMN errors on a
            // dependent object otherwise, and CASCADE would silently drop all three, leaving this
            // table with row-level security ENABLED and NO POLICY. Every authenticated request
            // would then 401, because the session middleware's own account read returns nothing,
            // and the cause would be three migrations away from the symptom.
            //
            // The index (ix_customer_account_customer_id) and the foreign key
            // (fk_customer_account_customers_customer_id) go with the column: PostgreSQL drops an
            // index and a constraint whose only column is being dropped. They are named here rather
            // than dropped explicitly because an explicit DROP INDEX without IF EXISTS would fail
            // 42P01 on any database where the order differed, and naming them is what a reader
            // needs - not a second statement.
            //
            // is_admin could have gone earlier - it is NOT NULL DEFAULT false, so an insert that
            // omits it succeeds, and task 15 un-mapped it. customer_id could not: NOT NULL with no
            // default means the property and the column have to go in one commit.
            // -----------------------------------------------------------------------------------
            migrationBuilder.Sql(
                """
                ALTER TABLE customer.customer_account DROP COLUMN customer_id;
                ALTER TABLE customer.customer_account DROP COLUMN is_admin;
                """);
```

and **prepend** to `Down()`, before Task 9's block:

```csharp
            // Undo 8. ⚠ The data is GONE - a dropped column takes its values with it - so this
            // restores the SHAPE and reconstructs the values from customer_membership, which is the
            // best a downgrade can do and is why nothing may rely on Down(). An account with two
            // memberships gets the oldest, arbitrarily, because the old schema cannot express two.
            migrationBuilder.Sql(
                """
                ALTER TABLE customer.customer_account
                    ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
                ALTER TABLE customer.customer_account
                    ADD COLUMN customer_id uuid NULL;

                UPDATE customer.customer_account a
                SET customer_id = m.customer_id,
                    is_admin    = (m.role = 'admin')
                FROM (SELECT DISTINCT ON (account_id) account_id, customer_id, role
                      FROM customer.customer_membership
                      WHERE removed_at IS NULL
                      ORDER BY account_id, created_at) m
                WHERE m.account_id = a.id;

                DELETE FROM customer.customer_account WHERE customer_id IS NULL;

                ALTER TABLE customer.customer_account ALTER COLUMN customer_id SET NOT NULL;
                ALTER TABLE customer.customer_account
                    ADD CONSTRAINT fk_customer_account_customers_customer_id
                    FOREIGN KEY (customer_id) REFERENCES customer.customer(id);
                CREATE INDEX ix_customer_account_customer_id
                    ON customer.customer_account (customer_id);
                """);
```

⚠ The `DELETE` is deliberate and is stated rather than hidden: an account with **zero** active
memberships cannot be represented in the old schema at all, and leaving it with a null
`customer_id` would fail the `SET NOT NULL` two lines later. A downgrade that silently deletes
accounts is a very good reason for nothing to rely on `Down()`.

In `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/CustomerAccount.cs`,
delete `:17`:

```csharp
    public Guid CustomerId { get; private set; }
```

and drop the parameter and the assignment from `Create` — before:

```csharp
    public static Result<CustomerAccount> Create(
        Guid customerId,
        string username,
```
```csharp
        if (customerId == Guid.Empty)
        {
            return Result<CustomerAccount>.Failure("An account must belong to a customer.");
        }

        if (string.IsNullOrWhiteSpace(username))
```
```csharp
            Id = Guid.CreateVersion7(),
            CustomerId = customerId,
            Username = username.Trim().ToLowerInvariant(),
```

after:

```csharp
    /// <summary>
    /// ⚠ Seven parameters, and neither <c>customerId</c> nor <c>isAdmin</c> among them. An account
    /// is now its own aggregate root: it belongs to no single company, and which companies it may
    /// act for is <see cref="CustomerMembership"/>'s to say. Whoever creates an account creates its
    /// first membership in the same transaction.
    /// </summary>
    public static Result<CustomerAccount> Create(
        string username,
```
```csharp
        if (string.IsNullOrWhiteSpace(username))
```
```csharp
            Id = Guid.CreateVersion7(),
            Username = username.Trim().ToLowerInvariant(),
```

In `CustomerAccountConfiguration.cs`, delete `:18-22` (the `CustomerId` property and the
`HasOne<Customer>()` relationship) and `:42` (`builder.HasIndex(account => account.CustomerId);`),
replacing them with:

```csharp
        // ⚠ No customer_id and no foreign key to Customer. An account belongs to no single company;
        // the Memberships collection configured below is the only link, and the global query filter
        // in OnModelCreating is written against it because HasQueryFilter cannot reference Set<T>().
```

Then move the three remaining `Create` call sites in `src`:

- `AccountEndpoints.cs:85-94`: delete the `customerId,` first argument. The route's `customerId` is
  still used, two statements down, by the `CustomerMembership.Create(...)` Task 5 added — which is
  now the only thing that ties the new account to a company.
- `OnboardingService.cs:420-429`: delete `customerId: customer.Id,`. Same reasoning: the membership
  three lines below carries it.
- `DemoDataSeeder.cs:159-163`: delete `customer.Id,` from the `Create` call; the membership below
  keeps it.

and the thirteen fixtures from Task 15's Step 5 table, each dropping its first argument.

- [ ] **Step 5: Move the last two guard literals and the cross-tenant insert**

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`,
replace `CatalogPolicyCoverageTests`' `:1050` — before:

```csharp
        customerIdTables.Count.ShouldBe(14);
```

after:

```csharp
        // ⚠ THIRTEEN, and the one that left is customer.customer_account. Migration 15 dropped its
        // customer_id column, so right(column_name, 11) no longer finds it - its tenancy is an
        // EXISTS over customer_membership, which no column-suffix predicate can see.
        // A_table_the_suffix_predicate_can_no_longer_see_is_still_policied_by_name is what holds it
        // to the two-policy bar now, by name, because these totals stay arithmetically right while
        // a table silently loses its coverage.
        customerIdTables.Count.ShouldBe(13);
```

and `:1070` — before:

```csharp
        tables.Count.ShouldBe(13);
```

after:

```csharp
        // Twelve, and it was twelve before this plan started too - which is the whole reason the
        // by-name assertion below exists. customer_account left the walk and customer_membership
        // joined it, so the number is unchanged and the SET is not.
        tables.Count.ShouldBe(12);
```

⚠ `AutomaticPolicyCoverageTests`' three numbers (`14`, `2`, `13`) do **not** move here.
`CustomerIdOwned` has named `CustomerAccount` explicitly since Task 3, which is exactly why that
clause was added ahead of the drop rather than in the same commit that would have hidden the
regression. Run it and confirm rather than assuming.

Replace the cross-tenant insert at `:219-236` — before:

```csharp
        await using var insert = new NpgsqlCommand(
            """
            INSERT INTO customer.customer_account
                (id, customer_id, username, first_name, last_name, email, status, is_admin, security_stamp)
            VALUES
                (gen_random_uuid(), @customerId, 'smuggled', 'S', 'M', 's@example.test', 'INVITED', false, gen_random_uuid())
            """,
            connection, transaction);
        insert.Parameters.AddWithValue("customerId", _fixture.CompanyBId);
```

after:

```csharp
        // ⚠ Neither column exists any more, so a "cross-tenant" INSERT is no longer expressible as
        // a wrong value in a column - which is itself the point. What refuses this row is the
        // WITH CHECK arm's EXISTS: a brand-new account has no membership, so it belongs to nobody
        // and app_customer_role may not create it. Creating an account is an owner-connection
        // operation (onboarding) or a back-office one, and both write the membership in the same
        // transaction.
        await using var insert = new NpgsqlCommand(
            """
            INSERT INTO customer.customer_account
                (id, username, first_name, last_name, email, status, security_stamp)
            VALUES
                (gen_random_uuid(), 'smuggled', 'S', 'M', 's@example.test', 'INVITED', gen_random_uuid())
            """,
            connection, transaction);
```

⚠ Rename the test with the meaning: `the_customer_role_cannot_insert_a_row_for_another_company`
becomes `the_customer_role_cannot_insert_an_account_that_belongs_to_nobody`, and its message becomes

```csharp
            .SqlState.ShouldBe(PostgresErrorCodes.InsufficientPrivilege,
                "the WITH CHECK arm is an EXISTS over customer_membership, so an account with no " +
                "membership is refused - which is stronger than the cross-tenant check it " +
                "replaces, because it also refuses one naming the caller's OWN company");
```

Finally, append the shape assertion to `verify-migrator.sh`, after the membership-grants block Task 3
added:

```bash
# The two columns membership replaced, asserted absent through the real migrator process rather than
# only in the test suite. A column that came back would be a second source of truth for a fact
# customer_membership owns - which is how a demoted admin keeps admin rights for fifteen minutes.
dropped_columns="$(docker exec "$container" psql --username postgres --dbname peakpower \
  --tuples-only --no-align --command \
  "SELECT coalesce(string_agg(column_name, ',' ORDER BY column_name), 'NONE')
     FROM information_schema.columns
    WHERE table_schema = 'customer' AND table_name = 'customer_account'
      AND column_name IN ('customer_id', 'is_admin');" 2>/dev/null | tr -d '[:space:]')"
[[ "$dropped_columns" == "NONE" ]] \
  || fail "customer.customer_account must carry neither customer_id nor is_admin - found: $dropped_columns"

# And the policy that replaced them is still there, BY NAME. The catalogue coverage guard discovers
# tenant tables by a customer_id column suffix and can no longer see this table at all, so its
# pinned totals stay right whether or not this policy exists.
account_policies="$(docker exec "$container" psql --username postgres --dbname peakpower \
  --tuples-only --no-align --command \
  "SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies
    WHERE schemaname = 'customer' AND tablename = 'customer_account';" 2>/dev/null | tr -d '[:space:]')"
[[ "$account_policies" == "customer_customer_account_back_office,customer_customer_account_tenant_isolation" ]] \
  || fail "customer.customer_account must keep both policies by name - found: $account_policies"
```

- [ ] **Step 6: Run everything and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln --nologo > /tmp/task17-after.txt 2>&1; tail -40 /tmp/task17-after.txt
tools/verify-migrator.sh
tools/verify-solution-layout.sh
tools/verify-repositories.sh
tools/verify-build-settings.sh
tools/verify-aspire-api.sh
```

Expected: build clean; the **whole solution** green; all five guard scripts green.

⚠ **The suite staying green is the test that Tasks 1–16 were complete.** Nothing else in this plan
proves it: every earlier task added behaviour beside the columns, and this is the commit where the
columns stop existing. A failure here names a reader nobody found, and the right response is to fix
that reader rather than to keep the column.

- [ ] **Step 7: Mutate the by-name guard, and then the drop's ordering**

**(a) Prove the by-name assertion is not decoration.** Drop `customer_account`'s tenant-isolation
policy at the very end of the migration's `Up()` — the state a `DROP COLUMN … CASCADE` would have
produced:

```csharp
            migrationBuilder.Sql(
                "DROP POLICY customer_customer_account_tenant_isolation ON customer.customer_account;");
            // MUTATION
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~CatalogPolicyCoverageTests|FullyQualifiedName~AutomaticPolicyCoverageTests" > /tmp/task17-mutant-a.txt 2>&1; cat /tmp/task17-mutant-a.txt`

Expected: **two** failures, and the pairing is the finding.
- `A_table_the_suffix_predicate_can_no_longer_see_is_still_policied_by_name`:
  `policyCount should be 2 but was 1`.
- `every_customer_owned_entity_type_has_row_level_security_enabled_and_both_policies`: the same, from
  the model side, because Task 3's explicit `CustomerAccount` clause kept it in that walk.

⚠ `every_table_carrying_a_customer_identifier_has_row_level_security_and_both_policies` — the
catalogue walk — stays **GREEN**. It cannot see the table any more. That is shared contract §9
item 2 demonstrated: without the by-name assertion and without Task 3's model-side clause, the most
privilege-bearing table in the schema would have lost half its row-level security and the two
coverage guards would both have reported full coverage.

**(b) Prove the ordering.** Restore, then move step 8's `DROP COLUMN customer_id` to run **before**
step 7a's policy re-point, and re-run against a fresh container:

Expected: the migration itself fails, and the whole integration suite errors on fixture start-up
with

```
Npgsql.PostgresException : 2BP01: cannot drop column customer_id of table customer.customer_account because other objects depend on it
```

naming `policy customer_customer_account_tenant_isolation on table customer.customer_account` in its
detail. ⚠ That is the good outcome. The bad one is what `CASCADE` would have done instead, which
raises nothing at all. Restore the ordering, and confirm:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -n "DROP COLUMN customer_id\|DROP POLICY customer_customer_account_tenant_isolation" \
  src/Infrastructure/PeakPower.Persistence/Migrations/*_MultiBusinessMembership.cs \
  > /tmp/task17-order.txt; cat /tmp/task17-order.txt
grep -c "MUTATION" src/Infrastructure/PeakPower.Persistence/Migrations/*_MultiBusinessMembership.cs \
  >> /tmp/task17-order.txt; cat /tmp/task17-order.txt
```

Expected: the `DROP POLICY` line number is **lower** than the `DROP COLUMN customer_id` line number,
and `MUTATION` counts `0`. Read the line numbers from the file rather than from a scrolled terminal.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src tests tools
git commit -m "feat: drop customer_account.customer_id and customer_account.is_admin

The irreversible step, and it is last. Every policy that derived tenancy from customer_id
was re-pointed two commits ago; DROP COLUMN errors on a dependent object otherwise, and
CASCADE would silently drop all three and leave the table with row-level security enabled
and no policy - every authenticated request 401ing for a reason three migrations away.
Verified by mutation: moving the drop ahead of the re-point raises 2BP01 naming the policy,
which is the good outcome; CASCADE raises nothing.

CustomerAccount.Create is down to seven parameters and the account is its own aggregate
root. is_admin could have been un-mapped earlier and was, because it has a DEFAULT; customer_id
could not - NOT NULL with no default means the property and the column go together.

⚠ The catalogue coverage guard's totals stay arithmetically right while customer_account
drops out of its walk entirely - it discovers by a customer_id column suffix and this table
no longer has one. That is shared contract section 9 item 2, and the answer is an explicit
by-name assertion plus the model-side clause added back in task 3, ahead of the drop.
Verified by mutation: deleting the account's tenant-isolation policy turns those two red
while the catalogue walk stays green, which is exactly the blindness the guards would
otherwise have shipped.

The whole suite staying green is the test that tasks 1-16 were complete.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done — what this plan leaves behind, and what it does not

**What is true after Task 17.** One person can be a member of several businesses with a different
role in each. Tenancy is a row in `customer.customer_membership`, proved against the database on
every authenticated request, and a claimed business with no active membership is a 401 before any
handler runs. A demotion or a removal takes effect on the **next request**. `customer_account`
carries neither `customer_id` nor `is_admin`, and no policy, filter, endpoint, mapping, contract,
seeder or fixture reads either. The membership table can be read across businesses by the person it
belongs to — which is what the switcher will need — and written only by an admin of the business
being written to, and **deleted by nobody**.

**The five probes shared contract §11 assigns to plan 1**, and where each lives:

| Probe | Class | Task |
| --- | --- | --- |
| Cross-tenant | `MembershipRequestPathTests` | 13 |
| No-membership | `MembershipRequestPathTests` + `CustomerMembershipPolicyTests` | 14 |
| Escalation | `CustomerMembershipPolicyTests` | 6 |
| Removal | `MembershipRemovalPrivilegeTests` | 7 |
| Cross-tenant account reach | `CrossTenantAccountReachTests` | 10 |

**What plan 2 can now assume, and the exact seams it consumes:**

- `ICustomerContext.Role` is the proven role for the request; there is no role claim to read.
- `ITokenIssuer.IssueAccessToken(CustomerAccount account, Guid customerId)` mints for **a** business,
  chosen by the caller — which is what makes a switch expressible.
- `RefreshToken.Issue(Guid accountId, Guid customerId, string tokenHash, DateTimeOffset issuedAt, DateTimeOffset expiresAt)`,
  and `customer.refresh_token` keyed on its own `customer_id` so revocation is independent of the
  membership's state.
- `GRANT UPDATE (last_active_business_id) ON customer.customer_account TO app_customer_role` and
  `CustomerAccount.RecordActiveBusiness(Guid)` — the write `POST /api/v1/auth/active-business` needs,
  and the only one an authenticated connection has on that table.
- `GRANT INSERT` and `GRANT UPDATE (used_at, replaced_by_token_id)` on `customer.refresh_token` — the
  three a rotation needs — with `trg_refresh_token_evidence_monotonic` still forbidding a clear.
- `AuthEndpoints.SelectBusinessAsync`, which already implements design §5's landing rule.
- `CustomerMembership.Restore(DateTimeOffset)`, declared and unused, for plan 4's re-invitation.

**What this plan deliberately does not do.** No `memberships[]` on `CurrentAccountResponse` and no
`/auth/me` change beyond the field swap (plan 2). No `active-business` endpoint, no refresh re-proof
beyond rejecting a token whose membership is gone, no zero-membership probe (plan 2). No rail
switcher, no store invalidation (plan 3). No invitations, no member list endpoint, no role-change or
removal endpoint, no admin floor, no concurrency serialisation (plan 4). No back-office membership
screen at all — `[OQ-105]`, recorded and not designed.

**The three things a reviewer should check first**, because they are the ones an earlier revision of
this design got wrong:

1. `has_table_privilege('app_customer_role', 'customer.customer_membership', 'DELETE')` is `false`,
   and `MembershipRemovalPrivilegeTests` asserts it. A `DELETE` grant cannot be guarded.
2. `refresh_token_tenant_isolation` keys on `customer.refresh_token.customer_id` and **not** on
   membership, and `AuthSchemaTests.The_refresh_token_policy_keys_on_its_OWN_customer_id_and_not_on_membership`
   asserts the policy's own text. The `EXISTS` shape revokes zero rows, silently, inside plan 4's
   removal transaction.
3. `customer.customer_account` still carries both policies **by name**, and
   `CatalogPolicyCoverageTests.A_table_the_suffix_predicate_can_no_longer_see_is_still_policied_by_name`
   is the only catalogue-side thing that says so — the discovery walk cannot see the table any more,
   and its pinned totals are unchanged either way.

**And the two that need somebody outside this plan.** The web repo's fourteen `isAdmin` call sites
(Deviation D6) belong to no plan and will stop compiling on the next `npm run generate:clients`.
Shared contract §4 step 4 and §4.1 name a `customer_account.created_at` that does not exist
(Deviation D1), and §5.3's `refresh_token` grant needs the trigger beside it or it is a regression
(Deviation D8) — all three are for the contract owner.
