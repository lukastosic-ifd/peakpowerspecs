# Migration 9 and Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land design §11 rows 1–3 as a recorded decision, then ship migration 9 — seven new
tables, the `metering.brp` configuration columns, the BRP-assignment history, the range-partition
routine that policies every partition it creates, the row-level-security policy pairs and the
explicit `REVOKE`s — together with the eight domain entities, their EF configurations, four global
query filters, and every pinned guard literal those four tables break.

**Architecture:** Tenancy stays two independent layers. Layer 1 is EF Core global query filters in
`PeakPowerDbContext.OnModelCreating`, shaped `!IsAuthenticated || x.CustomerId == …` exactly like
slice 1's five. Layer 2 is PostgreSQL row-level security written in raw SQL inside the migration,
in migration 2's two-policy form. **S2-D1** denormalises `customer_id` onto the four
customer-readable interval tables so that both coverage guards — which discover by
`property.Name.EndsWith("CustomerId")` and by `right(column_name, 11) = 'customer_id'` — can see
them at all; a table keyed only on `metering_point_id` is not merely unguarded, it is invisible,
and the guard then reports full coverage over unpoliced customer data. `metering.interval_reading`
is range-partitioned by month, and because neither `ENABLE ROW LEVEL SECURITY` nor a `GRANT` on a
partitioned parent reaches its partitions, a PL/pgSQL routine applies row-level security, both
policies and the grants to every partition it creates, with a catalog test that none lacks them.

**Tech Stack:** .NET SDK 10.0.400 · `net10.0` · `LangVersion latest` · `Nullable enable` ·
`TreatWarningsAsErrors` · `AnalysisMode Recommended` · EF Core 10.0.11
(`Microsoft.EntityFrameworkCore`, `.Design`, `.Relational`) · Npgsql 10.0.3
(`Npgsql`, `Npgsql.EntityFrameworkCore.PostgreSQL`) · `EFCore.NamingConventions` 10.0.1 ·
PostgreSQL 17 · xunit.v3 3.2.2 · `xunit.runner.visualstudio` 3.1.5 · `Microsoft.NET.Test.Sdk`
18.9.0 · Shouldly 4.3.0 (⚠ **never FluentAssertions** `[DEC-118]`) · NSubstitute 6.2.0 ·
Testcontainers.PostgreSql 4.14.0 · Dapper 2.1.66 · Verify.XunitV3 30.15.0 · Docker (daemon running)

**Spec:** docs/superpowers/specs/2026-09-07-poc-slice-2-design.md
**Shared contract:** docs/superpowers/plans/2026-09-07-slice-2-shared-contract.md

---

## Global Constraints

### Repositories

```
/Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9   # specs + plans
/Users/thinhhuynh/PeakPower/peakpower-platform                                            # .NET
/Users/thinhhuynh/PeakPower/peakpower-web                                                 # Angular (untouched by this plan)
```

Task 1 commits in the **spec** repository. Tasks 2–20 commit in **`peakpower-platform`**. This plan
touches `peakpower-web` nowhere.

### What this plan owns, and what it must not touch

Contract §17 assigns plan 2 exclusively:

- **All of contract §6** — migration 9, every table, index, policy, `REVOKE` and the partition
  routine.
- **The eight entity classes of contract §5**, their EF configurations, and the four global query
  filters.
- **Both .NET guard literals of contract §12.**
- The `CustomerAccount.ExternalSubjectId` drop.
- Design §11 rows 1–3, landed **before** the migration is written.

It may **read** contract §4, §5, §6 and §12 and must not restate them differently.

⚠ **Plan 2 is the only plan that declares an entity or writes migration SQL.** Two plans declaring
the same class is a duplicate-member compile error, not a merge — contract §17's closing warning.
Nothing in this plan declares a member of `IMarketCalendar` (plan 1 owns every one), an
`IBrpIngestionAdapter`, an `IRawPayloadStore`, an `IIngestionJobQueue`, a webhook route, an HTTP
endpoint, an Angular component, or `metering.ingestion_job` (contract §6.9 — plan 1's, and only on
the Hangfire fallback path).

### Naming

- .NET namespace root `PeakPower.` — the new entities live in `PeakPower.Domain.Metering`.
- Database: snake_case, singular, schema-qualified — `metering.interval_data_version`.
- C#: PascalCase; EF Core maps to snake_case through `UseSnakeCaseNamingConvention()`, **never**
  per-property attributes. Two properties in this plan carry an explicit fluent `HasColumnName`,
  for the reason given in Task 10; nothing else does.
- ⚠ **`delivery_date` is the column name for a metering day on every one of the seven new tables.**
  The published DDL calls it `local_date` on `daily_position`; contract §16 item 1 overrules that.

### Enums — the database spelling is normative, and it extends to JSON

All seven new enums persist as **text** through the existing
`EnumToScreamingSnakeConverter<T>`, applied by `EnumToTextConvention`
(`src/Infrastructure/PeakPower.Persistence/Conversions/EnumToTextConvention.cs`), which walks every
enum property in the model. Adding an enum property needs no persistence change.

⚠ **No slice-2 enum member may contain two adjacent capitals.** `EnumWireFormat`
(`JsonNamingPolicy.SnakeCaseUpper`, which treats a capital run as one word) and
`EnumToScreamingSnakeConverter` (which breaks before **every** capital) diverge the moment two
capitals sit together, and a stored wire spelling makes the read path **throw**, not merely
disagree — `EnumToScreamingSnakeConverter.FromScreamingSnake` ends in `Enum.Parse<TEnum>`, which
throws on an unknown name. `BrpFeed` → `BRP_FEED` under both. `UnknownEan` → `UNKNOWN_EAN` under
both. A member spelled `BRPFeed` or `EANValidity` would reopen the `LegalEntityType.BV` failure on
a table nobody has migrated.

```csharp
namespace PeakPower.Domain.Metering;

public enum InboundMessageStatus { Received, Processing, Processed, Failed, Duplicate }
// db/wire: RECEIVED | PROCESSING | PROCESSED | FAILED | DUPLICATE

public enum IntervalDataVersionSource { BrpFeed, Manual }
// db/wire: BRP_FEED | MANUAL          — S2-D2. MANUAL is storable and unreachable in slice 2.

public enum IntervalDirection { Consumption, Production }
// db/wire: CONSUMPTION | PRODUCTION

public enum QuarantineReason { UnknownEan, EanValidity, WrongBrp, NotElectricity }
// db/wire: UNKNOWN_EAN | EAN_VALIDITY | WRONG_BRP | NOT_ELECTRICITY

public enum MeteringDayState { NoData, Partial, Provisional, Final }
// db/wire: NO_DATA | PARTIAL | PROVISIONAL | FINAL     [F02-R22]
// ⚠ There is no COMPLETE member.

public enum OperationalAlertKind
{
    ValidationFailure,               // VALIDATION_FAILURE               [F02-R12]
    MeteringPointSilent,             // METERING_POINT_SILENT            [F02-R26]
    ProductionExpectationPromoted,   // PRODUCTION_EXPECTATION_PROMOTED  [F02-R34]
    MissingProductionDeclaration,    // MISSING_PRODUCTION_DECLARATION   [F02-R35]
    PostWindowReconciliation,        // POST_WINDOW_RECONCILIATION       [F02-R45]
}

public enum OperationalAlertStatus { Open, Resolved }
// db/wire: OPEN | RESOLVED
```

`ProductionExpectation` (`UNKNOWN | NEVER | EXPECTED`) and `ProductionExpectationSource`
(`CONTRACT | GRID_OPERATOR | OBSERVED | MANUAL | CUSTOMER_DECLARED`) are **slice 1's, unchanged —
no member is added or removed.**

⚠ **Neither `production_expectation` nor `expectation_source` carries a database `CHECK` today** —
verified against `20260827051436_InitialSchema.cs`; the value set is enforced by
`EnumToScreamingSnakeConverter` alone. Migration 9 adds **one** check touching them,
`ck_mp_never_has_no_observed_production`, and adds no value-set check.

⚠ The source column is named **`expectation_source`**, not `production_expectation_source` — the
published DDL disagrees with what shipped, and what shipped wins. The domain property is
`MeteringPoint.ExpectationSource`, not `ProductionExpectationSource`, which is the *enum type's*
name.

### Tenancy — the two layers, and why both

**Layer 1** — EF Core global query filters in `PeakPowerDbContext.OnModelCreating`. Correctness by
default, removable by one method call, and absent on any entity nobody remembered to configure.

**Layer 2** — PostgreSQL row-level security. Application code cannot remove it: the login roles are
never granted the right to disable RLS or bypass a policy.

Roles, from migration 2 (`20260827092246_TenancyRowLevelSecurity.cs`): `peakpower_app` and
`peakpower_employee` are LOGIN roles; `app_customer_role` and `app_employee_role` are NOLOGIN group
roles holding the grants and the policies. Both login roles are deliberately **non-owners** of every
table — the owner always bypasses row-level security regardless of policy, so non-ownership is what
makes `ENABLE ROW LEVEL SECURITY` mean anything.

Policy shape, verbatim from migration 2 and unchanged here:

```sql
ALTER TABLE metering.<t> ENABLE ROW LEVEL SECURITY;

CREATE POLICY metering_<t>_tenant_isolation ON metering.<t>
    FOR ALL TO app_customer_role
    USING      (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
    WITH CHECK (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid);

CREATE POLICY metering_<t>_back_office ON metering.<t>
    FOR ALL TO app_employee_role USING (true) WITH CHECK (true);
```

`NULLIF(…, '')` is not decoration: `''::uuid` raises `22P02`, whereas `NULL` matches nothing, which
is the fail-closed behaviour. `FORCE ROW LEVEL SECURITY` is deliberately **not** set — the owner runs
migrations, and no API host connects as the owner.

⚠ **`REVOKE` is the whole protection, not tidiness.** Migration 2 ran

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA customer, metering, wallet, audit
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
    TO app_customer_role, app_employee_role;
```

(lines 108–110 of `20260827092246_TenancyRowLevelSecurity.cs`). **The instant `CREATE TABLE` runs in
the `metering` schema, `app_customer_role` holds full DML on it.** Verified today against a
throwaway `postgres:17`: a table created after that statement carries
`relacl = {postgres=arwdDxtm/postgres,app_customer_role=arwd/postgres}` with no further grant, and
**so does a partition created with `CREATE TABLE … PARTITION OF`.** A policy decides which *rows* a
command may touch; it cannot forbid the command. Without the revokes a customer-scoped connection
can `INSERT` interval data.

### Partitioning — three facts verified against PostgreSQL 17 today

Each of these was established by running the statement against a throwaway `postgres:17` container,
not read from documentation. All three drive design decisions in Tasks 14–17.

1. **`ENABLE ROW LEVEL SECURITY` on a partitioned parent does not reach its partitions.** After
   `ALTER TABLE metering.ir ENABLE ROW LEVEL SECURITY`, `pg_class.relrowsecurity` reads `t` for the
   parent and `f` for the partition. Policies do not propagate either.
2. **A `GRANT` on the parent does not reach the partitions**, but `ALTER DEFAULT PRIVILEGES`
   **does** — a partition created after migration 2 arrives with `arwd` for `app_customer_role`.
3. **The combination is a live hole.** With the parent policed and the partition not, a
   `peakpower_app` connection with `app.customer_id` set to company A read **2** rows from
   `SELECT count(*) FROM metering.ir_2026_02` — both tenants' — and **1** row from
   `SELECT count(*) FROM metering.ir`. After the partition routine's `ENABLE ROW LEVEL SECURITY`,
   both policies and `REVOKE INSERT, UPDATE, DELETE`, the direct partition read returned **1** and
   the direct partition `INSERT` failed with `ERROR: permission denied for table ir_2026_02`
   (`42501`).

### Migration policy

**Roll forward only — S2-D7.** The deployed `DatabaseMigrator` calls only `MigrateAsync`, so
`Down()` is never invoked in the shipped path. Migration 9 still writes a correct `Down()` — a
developer may run `dotnet ef database update <earlier>` by hand — but **nothing may rely on it**.

⚠ **A migration must not depend on `now()` for the set of objects it creates.** The partition seed
loop creates a fixed 36-month window, 2025-01 through 2027-12, so two databases created a month
apart get the same schema and `verify-migrator.sh`'s double-run idempotence check keeps meaning
something.

⚠ **Migration 1 already seeds the `PVNED` row** — id `0199a1a0-0000-7000-8000-0000000000b1`, name
`PVNed B.V.`, and `ix_brp_code` is a **unique** index on `code`. Migration 9 **UPDATEs** that row.
A plan that writes `INSERT INTO metering.brp` gets Postgres `23505`.

### Testing

| Layer | Tooling |
| --- | --- |
| Domain unit | xUnit v3 + **Shouldly 4.3.0** — never FluentAssertions `[DEC-118]` |
| Model shape (no database) | `PeakPower.Integration.Tests`, a `DbContextOptionsBuilder` with a design-time connection string; building a model opens no connection |
| Persistence & RLS behaviour | Testcontainers, real PostgreSQL 17 |
| The migrator process | `tools/verify-migrator.sh`, twice, against a throwaway `postgres:17` |

Syntax is `actual.ShouldBe(expected)` and `await Should.ThrowAsync<T>(act)`. ⚠ **Shouldly's
`ShouldContain` is case-insensitive by default** and has silently broken three tests in this
repository; compare with `StringComparison.Ordinal` and assert on structured fields.

**Verify by mutation.** Break the specific behaviour, watch the test fail, **check the failure is
the one you predicted**, then restore. A mutation that breaks the *build* proves nothing about an
assertion — if removing a member orphans a `using`, remove that too. ⚠ **Mutate the case your
assertion is actually for, not the easy neighbouring one.**

**Pin counted invariants to a computed expectation, not a floor.** `assert count > 0` passes when a
discovery query silently returns the wrong set.

### Commands

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
docker info > /dev/null                                     # the daemon must be running
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln --nologo
dotnet test tests/PeakPower.Domain.Tests --nologo
dotnet test tests/PeakPower.Integration.Tests --nologo
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~Tenancy"
dotnet ef migrations add IngestionAndIntervalData \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator \
  --output-dir Migrations --context PeakPowerDbContext
tools/verify-migrator.sh
```

⚠ Integration tests use Testcontainers. Running several suites in parallel across worktrees can
exhaust connections and produce mass Postgres timeouts — retry before reporting a regression.
⚠ `cp -a` preserves mtimes and leaves MSBuild with stale binaries; use plain `cp` or `touch`.

### The eight migrations that precede this one

`InitialSchema`, `TenancyRowLevelSecurity`, `AuthAndOnboarding`, `AccountTokenForeignKeys`,
`EanPool`, `OnboardingTradeName`, `EmployeeIdentity`, `EmployeeSessions`. Migration 9 is
`<timestamp>_IngestionAndIntervalData`. **Three places pin that ordered list and all three grow by
one entry in the same commit:**

- `tools/verify-migrator.sh:51` (the `case` pattern) and `:52-56` (the failure message)
- `tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs:32` (the method name),
  `:39` (`migrationIds.Length.ShouldBe(8)`) and `:41-48`
- `tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs:33-40` and
  `:34` (`applied.Length.ShouldBe(8)`)

---

## Deviations from the shared contract, and open items

The contract is normative and this plan follows it. Five places needed a decision it does not make,
and four pinned literals break that contract §12 does not name. Both lists are here so a reviewer
finds them in one place rather than scattered through twenty tasks.

### Pinned literals contract §12 does not name — all four break, all four move in this plan

| # | Where | Before | After | Why |
| --: | --- | --- | --- | --- |
| 1 | `tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs:234` | `filtered.Length.ShouldBe(5)` | `.ShouldBe(9)` | The four new query filters. The test is `the_five_customer_owned_entities_in_todays_model_are_all_covered`; its name moves to `the_nine_customer_owned_entities…`. Task 11 |
| 2 | `tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs:895` | `customerIdTables.Count.ShouldBe(7)` | `.ShouldBe(11)` **and** the discovery query gains `AND NOT pc.relispartition` | Catalog discovery, not model discovery: `information_schema.tables` lists a partition as `BASE TABLE`, verified today, so without the filter this number would be **47** and would move every time the partition-maintenance job ran. Task 16 |
| 3 | `tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs:913` | `tables.Count.ShouldBe(7)` | `.ShouldBe(11)` | Same query, after `ExemptTables`. Task 16 |
| 4 | `tests/PeakPower.Integration.Tests/Contract/EnumWireAlgorithmDivergenceTests.cs:86-98` | ten names in `ExpectedEnumTypeNames` | seventeen | The seven new enums become EF-mapped properties, so `ModelEnumTypes()` discovers them. The test name `The_model_discovers_exactly_the_ten_enum_types_…` moves to `…the_seventeen_enum_types_…`. Task 10 |

Excluding partitions from the catalog guard's *count* would weaken it if nothing else looked at
them. Task 16 therefore adds `PartitionPolicyCoverageTests`, which enumerates **every** partition in
the four schemas — not just `interval_reading`'s — pins the set to the exact 36 names the migration
window produces, and holds each to the same RLS-plus-two-policies bar. The split is strictly more
coverage than one number, and the reason is written into both doc comments.

Two more files break on the `ExternalSubjectId` drop and move in Task 9:
`tests/PeakPower.Integration.Tests/Model/ModelShapeTests.cs:57` and
`tests/PeakPower.Domain.Tests/Customers/CustomerAccountTests.cs:30`.

### Decisions this plan takes that the contract does not

| # | Item | Decision |
| --: | --- | --- |
| A | `production_expectation_set_by` / `_set_at` column names vs `ExpectationSetBy` / `ExpectationSetAt` property names | Contract §6.2's SQL block spells the columns `production_expectation_set_by` and `production_expectation_set_at`; its prose says the properties are `ExpectationSetBy` and `ExpectationSetAt`. Under `UseSnakeCaseNamingConvention` those two do not meet. **Both halves are honoured literally**: the columns keep the SQL block's spelling and the properties keep the prose's, bridged by an explicit fluent `HasColumnName` in `MeteringPointConfiguration`, pinned by a model test so nobody "tidies" it. This is the only place in the plan with an explicit column name, and it is flagged for the contract owner |
| B | The eight `DbSet` names | `InboundMessages`, `IntervalDataVersions`, `IntervalReadings`, `MeteringPointDayStates`, `QuarantinedSeries`, `DailyPositions`, `OperationalAlerts`, `MeteringPointBrpAssignments`. Plans 3, 5 and 6 read them; they are in this plan's **Produces** list |
| C | The domain factories the contract does not spell out | `IntervalReading.Create`, `MeteringPointDayState.Compute`/`Recompute`, `QuarantinedSeries.Quarantine`/`Resolve`, `DailyPosition.Roll`/`Recompute`, `OperationalAlert.Raise`/`Resolve`, `MeteringPointBrpAssignment.Record`, and `MeteringPoint.RecordObservedProduction`/`DeclareProductionExpectation`/`ReassignBrp`. Exact signatures in the tasks and in **Produces**. ⚠ **`RecordObservedProduction` is the agreed name of a cross-plan seam**: plan 5 calls it from `[F02-R34]`'s same-transaction promotion. Plan 2 declares it (contract §17) and plan 5 consumes it. It promotes **only** when `ProductionExpectation == ProductionExpectation.Never` — `[F02-R34]` names the NEVER point and nothing else, and promoting `UNKNOWN` would silently empty `[F02-R35]`'s onboarding worklist. `MeteringPoint.IngestionPromotionActor` (`"system:ingestion"`) is the actor both plans pass |
| D | `Brp` gains six members and `Brp.Create` gains five parameters | Contract §9.3 has the Worker read `Environment.GetEnvironmentVariable(brp.CredentialRef)` and contract §7.2 resolve the adapter by `brp.AdapterKey`, so the entity must carry them. `Create` cannot default them: three of the columns lose their `DEFAULT` and gain a not-blank `CHECK`, so a row created without them fails at the database. Six call sites move, all listed in Task 3 |
| E | Store-generated `brp_assigned_at` and `brp.created_at` | Both are `NOT NULL DEFAULT now()`, and neither the `MeteringPoint.Attach` nor the `Brp.Create` factory may read a clock — architecture fact 5 is IL-enforced and confines that to `PeakPower.Infrastructure.Time`. Both are configured `.HasDefaultValueSql("now()").ValueGeneratedOnAdd()`, so EF omits the column when the property holds the CLR default and reads the generated value back. Adding a `DateTimeOffset` parameter to `MeteringPoint.Attach` instead would move ten call sites across four projects for no gain |

### Open items this plan records rather than closes

1. **Nothing yet writes a `metering_point_brp_assignment` row for a metering point created after
   migration 9 through an API.** The migration backfills one row per existing point and Task 19 adds
   one to `DemoDataSeeder`, but the two endpoint call sites —
   `src/Hosts/PeakPower.Api.Employee/Endpoints/MeteringPointEndpoints.cs:86` (attach) and
   `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs:269` (pool claim) — still do not,
   and neither does the employee edit path at `MeteringPointEndpoints.cs:151`, which can change
   `brp_id`. Wiring them is `F01` back-office work and is out of this slice's §3.1 scope.
   **Consequence for plan 3:** `[F02-R43]`'s "the assignment in force at **receipt** time decides
   `WRONG_BRP`" must read `customer.metering_point_brp_assignment` ordered by `assigned_at DESC` and
   **fall back to `customer.metering_point.brp_id` when the history is empty**, or a point attached
   through the back office quarantines everything.
2. **`[OQ-102]`** — the RLS login-role credentials are literals inside migration 2, so
   `EMPLOYEE_DATABASE_PASSWORD` cannot be rotated. This migration adds **six** more tables under
   those roles. It blocks nothing here and is not fixed here.
3. **`[OQ-97]`** — not one of the thirty-one demo EANs carries a valid GS1 check digit, and
   ingestion keys on EAN. Nothing in this plan reinstates it, and the blast radius grows with every
   ingested row.

---

## Domain terms used in this plan

- **EAN** — the eighteen-digit code identifying one electricity connection point in the Dutch grid.
  `[DEC-114]` relaxed validation to eighteen digits; the GS1 check digit is not enforced.
- **Metering point / connection** — one EAN belonging to one customer for one half-open period.
- **BRP (Balance Responsible Party)** — the market participant answerable to the grid operator for a
  connection's imbalance. Every metering point names one `[F01-R51]`. `[DEC-69]` makes it a
  configurable row carrying an endpoint, a credential reference and an adapter key.
- **Delivery date** — the Amsterdam calendar day a measurement belongs to. 92, 96 or 100
  quarter-hour intervals depending on daylight saving.
- **Direction** — `CONSUMPTION` (offtake from the grid) or `PRODUCTION` (feed-in). Two separate,
  non-negative series `[AS-05]`; net usage is derived per interval and never stored signed.
- **Version** — one direction of one day from one document. A correction is a **new** version;
  nothing is ever updated in place `[F02-R18]`, `[DEC-07]`.
- **Supersession** — marking the previous current version `is_current = false`. The current version
  is always the **last received**, never the newest by `CreatedDateTime` (design §4.2).
- **Quarantine** — a parsed series that could not be attached to a metering point. A storage state
  with a replay path, not a parse outcome.
- **Data state** — `NO_DATA` / `PARTIAL` / `PROVISIONAL` / `FINAL` per (metering point, delivery
  date). There is no `COMPLETE`.
- **Offtake / export** — `Σ max(cᵢ − pᵢ, 0)` and `Σ |min(cᵢ − pᵢ, 0)|`, accumulated **per interval**.
  Neither can be recovered from daily totals; design §4.1 is the worked case.
- **RLS** — PostgreSQL row-level security: per-row `USING` / `WITH CHECK` predicates attached to a
  table and a role.

---

## File Structure

### `/Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9`

| File | Responsibility |
| --- | --- |
| `specs/00-overview/04-assumptions-and-decisions.md` | Modify: append **DEC-143**, the `interval_data_version.source` decision (design §11 row 1) |
| `specs/20-architecture/04-database-design.md` | Modify `:550-561` and `:597`: correct the published DDL to S2-D2 (design §11 row 2) |
| `specs/10-features/F02-metering-data-ingestion.md` | Modify `:388`: the same correction from the other side (design §11 row 3) |

### `/Users/thinhhuynh/PeakPower/peakpower-platform`

| File | Responsibility |
| --- | --- |
| `src/Core/PeakPower.Domain/Metering/IngestionEnums.cs` | Create: the seven metering enums, database spelling normative |
| `src/Core/PeakPower.Domain/Metering/Brp.cs` | Modify: six configuration members and the widened `Create` |
| `src/Core/PeakPower.Domain/Metering/InboundMessage.cs` | Create: the stored raw document, one row per accepted POST |
| `src/Core/PeakPower.Domain/Metering/IntervalDataVersion.cs` | Create: one version of one direction of one day |
| `src/Core/PeakPower.Domain/Metering/IntervalReading.cs` | Create: one immutable point |
| `src/Core/PeakPower.Domain/Metering/MeteringPointDayState.cs` | Create: the materialised data state per (point, date) |
| `src/Core/PeakPower.Domain/Metering/DailyPosition.cs` | Create: the daily rollup with the design §4.1 accumulators |
| `src/Core/PeakPower.Domain/Metering/QuarantinedSeries.cs` | Create: a series that could not be attached |
| `src/Core/PeakPower.Domain/Metering/OperationalAlert.cs` | Create: the conditions of F02-R12/R26/R34/R35/R45 |
| `src/Core/PeakPower.Domain/Customers/MeteringPointBrpAssignment.cs` | Create: who moved a point to another BRP, when and why `[F02-R43]` |
| `src/Core/PeakPower.Domain/Customers/MeteringPoint.cs` | Modify: four new properties and three mutators |
| `src/Core/PeakPower.Domain/Customers/CustomerAccount.cs` | Modify `:49-54`: drop the dead `ExternalSubjectId` |
| `src/Infrastructure/PeakPower.Persistence/Configurations/BrpConfiguration.cs` | Modify: the six new columns and the composite unique index |
| `src/Infrastructure/PeakPower.Persistence/Configurations/MeteringPointConfiguration.cs` | Modify: four new properties, the partial index, the check constraint |
| `src/Infrastructure/PeakPower.Persistence/Configurations/CustomerAccountConfiguration.cs` | Modify `:40`: remove the `ExternalSubjectId` mapping |
| `src/Infrastructure/PeakPower.Persistence/Configurations/InboundMessageConfiguration.cs` | Create |
| `src/Infrastructure/PeakPower.Persistence/Configurations/IntervalDataVersionConfiguration.cs` | Create |
| `src/Infrastructure/PeakPower.Persistence/Configurations/IntervalReadingConfiguration.cs` | Create |
| `src/Infrastructure/PeakPower.Persistence/Configurations/MeteringPointDayStateConfiguration.cs` | Create |
| `src/Infrastructure/PeakPower.Persistence/Configurations/DailyPositionConfiguration.cs` | Create |
| `src/Infrastructure/PeakPower.Persistence/Configurations/QuarantinedSeriesConfiguration.cs` | Create |
| `src/Infrastructure/PeakPower.Persistence/Configurations/OperationalAlertConfiguration.cs` | Create |
| `src/Infrastructure/PeakPower.Persistence/Configurations/MeteringPointBrpAssignmentConfiguration.cs` | Create |
| `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs` | Modify: eight `DbSet`s and four global query filters |
| `src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_IngestionAndIntervalData.cs` | Create: migration 9, hand-written raw SQL |
| `src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_IngestionAndIntervalData.Designer.cs` | Create (generated) |
| `src/Infrastructure/PeakPower.Persistence/Migrations/PeakPowerDbContextModelSnapshot.cs` | Modify (regenerated) |
| `src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs` | Modify `:104` (the widened `Brp.Create`, Task 3), and `:49`, `:111`, `:163`, `:180` (one assignment row per seeded connection, Task 19) |
| `tools/verify-migrator.sh` | Modify `:51`, `:52-56`; append the migration-9 privilege and partition assertions |
| `tests/PeakPower.Domain.Tests/Metering/IngestionEnumSpellingTests.cs` | Create: the seven enums' member names and the adjacent-capital rule |
| `tests/PeakPower.Domain.Tests/Metering/InboundMessageTests.cs` | Create |
| `tests/PeakPower.Domain.Tests/Metering/IntervalDataVersionTests.cs` | Create |
| `tests/PeakPower.Domain.Tests/Metering/IntervalReadingTests.cs` | Create |
| `tests/PeakPower.Domain.Tests/Metering/MeteringPointDayStateTests.cs` | Create |
| `tests/PeakPower.Domain.Tests/Metering/DailyPositionTests.cs` | Create |
| `tests/PeakPower.Domain.Tests/Metering/QuarantinedSeriesTests.cs` | Create |
| `tests/PeakPower.Domain.Tests/Metering/OperationalAlertTests.cs` | Create |
| `tests/PeakPower.Domain.Tests/Customers/MeteringPointBrpAssignmentTests.cs` | Create |
| `tests/PeakPower.Domain.Tests/Customers/MeteringPointTests.cs` | Modify: the three new mutators |
| `tests/PeakPower.Domain.Tests/Customers/CustomerAccountTests.cs` | Modify `:30`: drop the `ExternalSubjectId` assertion |
| `tests/PeakPower.Domain.Tests/Supporting/SupportingTypeTests.cs` | Modify `:16`, `:27`, `:36`: the widened `Brp.Create` |
| `tests/PeakPower.Integration.Tests/Model/ModelShapeTests.cs` | Modify `:57`: the `ExternalSubjectId` assertion becomes an assertion of its absence. The migration-9 column shapes go in `IngestionModelShapeTests` instead — one file per concern, and this one is about slice 1's snake_case rule |
| `tests/PeakPower.Integration.Tests/Model/IngestionModelShapeTests.cs` | Create: table names, keys, indexes, converters for the eight new entities |
| `tests/PeakPower.Integration.Tests/Contract/EnumWireAlgorithmDivergenceTests.cs` | Modify `:53`, `:79-98`, `:155`, `:163`: ten → seventeen |
| `tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs` | Modify `:135-137`, `:143-147`, `:220`, `:234` |
| `tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs` | Modify `:643-653`, `:665-674`, `:779-780`, `:795-797`, `:808-836`, `:885-896`, `:906-913`; append members to `RowLevelSecurityTests` itself, and two new test classes — `EmployeeOnlyTablePrivilegeTests` (Task 13) and `PartitionPolicyCoverageTests` (Task 16) |
| `tests/PeakPower.Integration.Tests/Tenancy/TenancyFixture.cs` | Modify `:78` (four new ids), `:138` (an `OwnerContext(ICustomerContext)` overload), `:203` and `:219-226`: seed interval data for both companies |
| `tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs` | Modify `:32`, `:39`, `:41-48`; append the migration-9 script assertions |
| `tests/PeakPower.Integration.Tests/Migrations/IngestionSchemaTests.cs` | Create: the behavioural schema tests against a real container |
| `tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs` | Modify `:34`, `:41` |
| `tests/PeakPower.Integration.Tests/Database/IngestionRoundTripTests.cs` | Create: every new entity written and read through EF against PostgreSQL 17 |
| `tests/PeakPower.Integration.Tests/Portal/ClaimConnectionTests.cs` | Modify `:64`: the widened `Brp.Create` |
| `tests/PeakPower.Integration.Tests/Portal/ClaimConnectionBrpConfigurationTests.cs` | Modify `:68`: the widened `Brp.Create` |
| `tests/PeakPower.Integration.Tests/Portal/ConnectionDetailTests.cs` | Modify `:69`: the widened `Brp.Create` |
| `tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs` | Modify: assert one assignment row per seeded connection |

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

**Plan 1 must have landed.** This plan does not need `PeakPower.Ingestion`, the Worker, the AppHost
changes or `IMarketCalendar`'s new members to compile — nothing here references them — but it does
need the solution to be green, and plan 1 is what makes `verify-solution-layout.sh` agree with a
22-project solution.

---

### Task 1: Land design §11 rows 1–3 — the recorded decision that settles `interval_data_version`

Design §11 opens with *"Rows 1–3 must land **before** step 3"*, and design §12 item 2 makes it a
gate: *"A recorded decision on `interval_data_version.source` per **S2-D2**… **Before migration 9 is
written**."* This task is that gate, and it is the only task in this plan that touches the spec
repository.

The conflict being settled: the published DDL in
[database design §3.2](../../../specs/20-architecture/04-database-design.md) has
`document_id text NOT NULL`, `document_created timestamptz NOT NULL` and
`inbound_message_id uuid NOT NULL`, and **no `source` column** — which makes `[F02-R36]`'s manual
version unstorable. F02 §8 says the table carries `source` (`BRP_FEED` | `MANUAL`) **and** a
`brp_id`. The two documents contradict each other in two directions at once, and migration 9 cannot
be written against a contradiction.

**S2-D2 rules for F02 §8 on `source` and against it on `brp_id`.** A second BRP column can disagree
with the message it came from, and a manual version correctly has no BRP at all — the database
design's own argument, which this decision keeps.

The highest recorded decision today is **DEC-142** (`04-assumptions-and-decisions.md:257`, the last
line of the file), so the new one is **DEC-143**.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9/specs/00-overview/04-assumptions-and-decisions.md` (append after `:257`)
- Modify: `/Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9/specs/20-architecture/04-database-design.md:550-561` and `:597`
- Modify: `/Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9/specs/10-features/F02-metering-data-ingestion.md:388`
- Test: none — this is a specification change. Task 12's `ck_idv_brp_feed_has_message` and
  `ck_idv_manual_has_no_message`, and Task 15's tests that PostgreSQL actually refuses each
  violating row, are the executable form of it.

**Interfaces:**
- Consumes: nothing.
- Produces: `[DEC-143]`, the citable decision every later task and plan refers to when it writes
  `source NOT NULL CHECK (source IN ('BRP_FEED','MANUAL'))`, a nullable `inbound_message_id`, and no
  `brp_id` column on `metering.interval_data_version`.

- [ ] **Step 1: Confirm the three files say what this task expects before changing them**

```bash
cd /Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9
sed -n '550,561p' specs/20-architecture/04-database-design.md > /tmp/dd-before.txt
sed -n '388p'      specs/10-features/F02-metering-data-ingestion.md > /tmp/f02-before.txt
tail -1            specs/00-overview/04-assumptions-and-decisions.md > /tmp/dec-before.txt
grep -c 'DEC-143'  specs/00-overview/04-assumptions-and-decisions.md > /tmp/dec-count.txt
wc -l /tmp/dd-before.txt /tmp/f02-before.txt /tmp/dec-before.txt
cat /tmp/dec-count.txt
```

Expected: `/tmp/dd-before.txt` is 12 lines beginning
`CREATE TABLE metering.interval_data_version (` and ending `);`. `/tmp/dec-before.txt` begins
`| **DEC-142** |`. `/tmp/dec-count.txt` prints `0` — DEC-143 does not exist yet.

⚠ Read the files back rather than trusting the terminal: a shell hook in this environment rewrites
`grep`, `find` and `ls` through a filter that truncates output.

- [ ] **Step 2: Append DEC-143 to the decision register**

Append this single line to the **end** of
`specs/00-overview/04-assumptions-and-decisions.md`, after the `DEC-142` row:

```markdown
| **DEC-143** | **`metering.interval_data_version` carries `source text NOT NULL CHECK (source IN ('BRP_FEED','MANUAL'))`, a NULLABLE `inbound_message_id`, `document_id` and `document_created`, and NO `brp_id` column.** Two check constraints keep the pair honest: a `BRP_FEED` version must carry all three of `inbound_message_id`, `document_id` and `document_created`; a `MANUAL` version must carry no `inbound_message_id`. The BRP a stored version came from is read through `inbound_message.brp_id`, and a `MANUAL` version correctly has none | The published DDL's form — `document_id NOT NULL`, `document_created NOT NULL`, `inbound_message_id NOT NULL`, no `source` column; and F02 §8's form, which additionally puts a `brp_id` on the version row | **Settles a direct contradiction between two specifications.** [Database design](../20-architecture/04-database-design.md) §3.2 and [F02](../10-features/F02-metering-data-ingestion.md) §8 disagree, and migration 9 could not be written against both. The published DDL makes **[F02-R36]**'s manual reconciliation entry *unstorable* — there is no value of `inbound_message_id` a hand-entered version could carry — so it loses on `source`. F02 §8's `brp_id` loses for the database design's own stated reason: a second column can disagree with the message it came from, and **[DEC-07]**'s "a version is the document it came from" is exactly what the FK already says. ⚠ **The schema ships in slice 2; the screens do not.** Manual entry and reconciliation (**[F02-R36]**/**R37**/**R38**/**R47**) are deferred, so `MANUAL` is storable and unreachable — proven in slice 2 by a raw-SQL insert rather than by a code path. This is deliberate: adding the discriminator later means rewriting a populated table, and adding it now costs one column and two checks |
```

- [ ] **Step 3: Correct the published DDL — database design §3.2**

Replace lines `550-561` of `specs/20-architecture/04-database-design.md`, which currently read:

```sql
CREATE TABLE metering.interval_data_version (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    metering_point_id  uuid NOT NULL REFERENCES customer.metering_point(id),
    delivery_date      date NOT NULL,
    direction          text NOT NULL CHECK (direction IN ('CONSUMPTION','PRODUCTION')),
    document_id        text NOT NULL,
    document_created   timestamptz NOT NULL,
    received_at        timestamptz NOT NULL,
    inbound_message_id uuid NOT NULL REFERENCES metering.inbound_message(id),
    interval_count     smallint NOT NULL CHECK (interval_count IN (92, 96, 100)),
    is_current         boolean NOT NULL DEFAULT true
);
```

with:

```sql
-- ⚠ Corrected by [DEC-143]. The previous form had document_id, document_created and
--   inbound_message_id all NOT NULL and no `source` column, which made [F02-R36]'s manual
--   version unstorable. `source` is the discriminator; the two checks below are what stop it
--   becoming a column anybody can set to anything.
CREATE TABLE metering.interval_data_version (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    metering_point_id  uuid NOT NULL REFERENCES customer.metering_point(id),
    customer_id        uuid NOT NULL REFERENCES customer.customer(id),   -- S2-D1
    delivery_date      date NOT NULL,
    direction          text NOT NULL CHECK (direction IN ('CONSUMPTION','PRODUCTION')),
    source             text NOT NULL CHECK (source IN ('BRP_FEED','MANUAL')),
    document_id        text,
    document_created   timestamptz,
    received_at        timestamptz NOT NULL,
    inbound_message_id uuid REFERENCES metering.inbound_message(id),
    correlation_id     uuid NOT NULL,
    interval_count     smallint NOT NULL CHECK (interval_count IN (92, 96, 100)),
    is_current         boolean NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now(),

    -- A BRP_FEED version is the document it came from, so all three must be present.
    CONSTRAINT ck_idv_brp_feed_has_message CHECK (
        source <> 'BRP_FEED'
        OR (inbound_message_id IS NOT NULL
            AND document_id IS NOT NULL
            AND document_created IS NOT NULL)),

    -- A MANUAL version has no document and no message.  [F02-R36]
    CONSTRAINT ck_idv_manual_has_no_message CHECK (
        source <> 'MANUAL' OR inbound_message_id IS NULL)
);
```

Then replace the third row of the §3.2.1 table at line `597`, which currently reads:

```markdown
| A stored document keeps the BRP that produced it | `metering.inbound_message.brp_id`, `NOT NULL`. `interval_data_version` inherits it through `inbound_message_id`, which is already `NOT NULL`, so the version needs no column of its own and cannot disagree with the message it came from **[F02-R43]**, **[DEC-07]** |
```

with:

```markdown
| A stored document keeps the BRP that produced it | `metering.inbound_message.brp_id`, `NOT NULL`. `interval_data_version` reaches it through `inbound_message_id`, so the version needs no column of its own and cannot disagree with the message it came from **[F02-R43]**, **[DEC-07]**. ⚠ **[DEC-143]** makes that foreign key NULLABLE, because a `MANUAL` version has no message and no BRP; `ck_idv_brp_feed_has_message` is what keeps it `NOT NULL` in substance for every `BRP_FEED` row |
```

- [ ] **Step 4: Correct F02 §8, from the other side of the contradiction**

Replace line `388` of `specs/10-features/F02-metering-data-ingestion.md`, which currently reads:

```markdown
| `interval_data_version` | One per (metering point, delivery date, direction, document). Carries **`source`** (`BRP_FEED` \| `MANUAL`) and the **`brp_id`** that produced it **[F02-R16]**; for a manual version the entering employee and the mandatory reason **[DEC-60]**, and for a manual reconciliation the reason category `RECONCILIATION` and the retained source reference **[F02-R47]**. ⚠ The `PVNED` source value is renamed to `BRP_FEED` by **[DEC-69]** — the BRP is now a column, not a value |
```

with:

```markdown
| `interval_data_version` | One per (metering point, delivery date, direction, document). Carries **`source`** (`BRP_FEED` \| `MANUAL`) **[F02-R16]** and a nullable `inbound_message_id`; for a manual version the entering employee and the mandatory reason **[DEC-60]**, and for a manual reconciliation the reason category `RECONCILIATION` and the retained source reference **[F02-R47]**. ⚠ The `PVNED` source value is renamed to `BRP_FEED` by **[DEC-69]** — the BRP is now a column, not a value. ⚠ **[DEC-143]** removes the `brp_id` this row previously claimed: the BRP is read through `inbound_message_id`, a second column could disagree with the message it came from, and a `MANUAL` version has no BRP at all |
```

- [ ] **Step 5: Read the three edits back and confirm each landed**

```bash
cd /Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9
grep -c 'DEC-143' specs/00-overview/04-assumptions-and-decisions.md \
                  specs/20-architecture/04-database-design.md \
                  specs/10-features/F02-metering-data-ingestion.md > /tmp/dec143.txt
grep -n 'ck_idv_brp_feed_has_message\|ck_idv_manual_has_no_message' \
     specs/20-architecture/04-database-design.md >> /tmp/dec143.txt
grep -n 'inbound_message_id uuid NOT NULL' specs/20-architecture/04-database-design.md >> /tmp/dec143.txt
cat /tmp/dec143.txt
```

Expected, read from the file rather than the terminal:
`04-assumptions-and-decisions.md:1`, `04-database-design.md:2`, `F02-metering-data-ingestion.md:1`;
two hits for the constraint names; and **no hit at all** for `inbound_message_id uuid NOT NULL` —
the old, contradictory line is gone. A hit there means Step 3's replacement did not apply.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9
git add specs/00-overview/04-assumptions-and-decisions.md \
        specs/20-architecture/04-database-design.md \
        specs/10-features/F02-metering-data-ingestion.md
git commit -m "spec: record DEC-143, settling interval_data_version.source before migration 9

The published DDL and F02 section 8 contradicted each other: the DDL made [F02-R36]'s
manual version unstorable by making inbound_message_id NOT NULL and carrying no source
column, while F02 said the table carries source AND a brp_id. Migration 9 cannot be
written against a contradiction, and design section 11 rows 1-3 require this to land
first. S2-D2 rules for F02 on source and for the database design on brp_id.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The seven metering enums

Contract §4 fixes the member names and the database spelling. They go in one file, in
`PeakPower.Domain.Metering`, for the same reason slice 1's seven live in one file: the database
spelling is normative and they have to be read together to stay consistent.

The adjacent-capital rule is the one that bites. `EnumWireFormat.ToWire` uses
`JsonNamingPolicy.SnakeCaseUpper`, which treats a run of capitals as **one word**;
`EnumToScreamingSnakeConverter.ToScreamingSnake` inserts an underscore before **every** capital.
They agree only while every member has isolated capitals. `LegalEntityType.BV` is the standing
exception, already allow-listed. Nothing added here may join it — and unlike a display mismatch, a
stored wire spelling makes the read path **throw**: `FromScreamingSnake` ends in
`Enum.Parse<TEnum>`, which raises `ArgumentException` on a name it cannot resolve.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/IngestionEnums.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Metering/IngestionEnumSpellingTests.cs`

**Interfaces:**
- Consumes: nothing.
- Produces: `PeakPower.Domain.Metering.InboundMessageStatus`,
  `PeakPower.Domain.Metering.IntervalDataVersionSource`,
  `PeakPower.Domain.Metering.IntervalDirection`,
  `PeakPower.Domain.Metering.QuarantineReason`,
  `PeakPower.Domain.Metering.MeteringDayState`,
  `PeakPower.Domain.Metering.OperationalAlertKind`,
  `PeakPower.Domain.Metering.OperationalAlertStatus`.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Metering/IngestionEnumSpellingTests.cs`:

```csharp
using Shouldly;
using Xunit;
using PeakPower.Domain.Metering;

namespace PeakPower.Domain.Tests.Metering;

/// <summary>
/// Slice 2's seven metering enums, pinned by member name and by the one structural rule that
/// makes the two wire algorithms agree.
/// <para>
/// The member names are the contract's (shared contract section 4) and the database spelling is
/// normative — SCREAMING_SNAKE in the column and the same string on the wire. These tests are the
/// same shape as <c>EnumSpellingTests</c> for slice 1's seven, and exist for the same reason: the
/// specification names several of these value sets in more than one place, and a member quietly
/// renamed is a column CHECK violation on a table nobody has migrated.
/// </para>
/// </summary>
public sealed class IngestionEnumSpellingTests
{
    [Fact]
    public void InboundMessageStatus_has_the_five_members_the_published_DDL_check_constraint_names()
    {
        Enum.GetNames<InboundMessageStatus>()
            .ShouldBe(new[] { "Received", "Processing", "Processed", "Failed", "Duplicate" });
    }

    [Fact]
    public void IntervalDataVersionSource_has_exactly_BrpFeed_and_Manual()
    {
        // [DEC-143]/S2-D2. MANUAL is storable and unreachable in slice 2: the screens that would
        // write one are deferred, and the value exists so that adding them later is a screen and
        // not a rewrite of a populated table.
        Enum.GetNames<IntervalDataVersionSource>().ShouldBe(new[] { "BrpFeed", "Manual" });
    }

    [Fact]
    public void IntervalDirection_has_exactly_Consumption_and_Production()
    {
        // Consumption and Production remain two separate, non-negative series [AS-05]. There is
        // deliberately no NetUsage member: net usage is derived per interval and never stored as
        // a signed source series (position-and-coverage section 2.1).
        Enum.GetNames<IntervalDirection>().ShouldBe(new[] { "Consumption", "Production" });
    }

    [Fact]
    public void QuarantineReason_has_the_four_reasons_the_pipeline_can_decide()
    {
        Enum.GetNames<QuarantineReason>()
            .ShouldBe(new[] { "UnknownEan", "EanValidity", "WrongBrp", "NotElectricity" });
    }

    [Fact]
    public void MeteringDayState_has_four_members_and_no_COMPLETE()
    {
        // F02 section 6's state machine is NO_DATA -> PARTIAL -> PROVISIONAL -> FINAL. The word
        // "Complete" in integration-spec section 8.3 is the CONDITION that moves a day to
        // PROVISIONAL, not a fifth state. A COMPLETE member would break the day-state column's
        // CHECK constraint the first time it was written.
        Enum.GetNames<MeteringDayState>()
            .ShouldBe(new[] { "NoData", "Partial", "Provisional", "Final" });
    }

    [Fact]
    public void OperationalAlertKind_has_one_member_per_deferred_alert_condition()
    {
        // F02-R12, F02-R26, F02-R34, F02-R35, F02-R45. The conditions are built and tested in
        // slice 2; only the delivery channel is deferred (design section 3.2).
        Enum.GetNames<OperationalAlertKind>()
            .ShouldBe(new[]
            {
                "ValidationFailure",
                "MeteringPointSilent",
                "ProductionExpectationPromoted",
                "MissingProductionDeclaration",
                "PostWindowReconciliation",
            });
    }

    [Fact]
    public void OperationalAlertStatus_has_exactly_Open_and_Resolved()
    {
        Enum.GetNames<OperationalAlertStatus>().ShouldBe(new[] { "Open", "Resolved" });
    }

    /// <summary>
    /// The structural rule, not a spelling: no member of any slice-2 enum may contain two adjacent
    /// capitals. <c>EnumWireFormat.ToWire</c> (JsonNamingPolicy.SnakeCaseUpper) treats a capital
    /// run as ONE word; <c>EnumToScreamingSnakeConverter.ToScreamingSnake</c> breaks before EVERY
    /// capital. They agree only while every capital is isolated. <c>BrpFeed</c> gives BRP_FEED
    /// under both; <c>BRPFeed</c> would give BRP_FEED and B_R_P_FEED, and the stored spelling then
    /// makes the READ path throw, because FromScreamingSnake ends in Enum.Parse.
    /// <para>
    /// Asserted here, on the domain side, as well as through
    /// <c>EnumWireAlgorithmDivergenceTests</c> against the built model: this one needs no EF model
    /// and so goes red the moment the member is typed, before any configuration exists to map it.
    /// </para>
    /// </summary>
    [Theory]
    [InlineData(typeof(InboundMessageStatus))]
    [InlineData(typeof(IntervalDataVersionSource))]
    [InlineData(typeof(IntervalDirection))]
    [InlineData(typeof(QuarantineReason))]
    [InlineData(typeof(MeteringDayState))]
    [InlineData(typeof(OperationalAlertKind))]
    [InlineData(typeof(OperationalAlertStatus))]
    public void No_member_contains_two_adjacent_capitals(Type enumType)
    {
        var offenders = Enum.GetNames(enumType)
            .Where(name => name
                .Zip(name.Skip(1), (left, right) => char.IsUpper(left) && char.IsUpper(right))
                .Any(adjacent => adjacent))
            .ToArray();

        offenders.ShouldBeEmpty(
            $"{enumType.Name} has a member with two adjacent capitals. EnumWireFormat and " +
            "EnumToScreamingSnakeConverter disagree on such a name, and the disagreement is not " +
            "cosmetic: the stored spelling makes Enum.Parse throw on read. Rename the member so " +
            "every capital is isolated - BrpFeed, not BRPFeed; UnknownEan, not UnknownEAN.");
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: FAIL to **build**, with
`error CS0246: The type or namespace name 'InboundMessageStatus' could not be found (are you missing a using directive or an assembly reference?)`
and the same for the other six type names.

A build failure is the right red here — the assertion is about types that do not exist yet, so
there is no way to see it fail at runtime first. The runtime red comes in Step 4's mutation.

- [ ] **Step 3: Write the minimal implementation**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/IngestionEnums.cs`:

```csharp
namespace PeakPower.Domain.Metering;

/// <summary>
/// Every enum slice 2's ingestion domain adds, in one file, because the database spelling of each
/// is normative (shared contract section 4) and they must be read together to stay consistent.
/// EF Core persists all of them as SCREAMING_SNAKE text through one convention,
/// <c>EnumToTextConvention</c>, which walks every enum property in the model.
/// <para>
/// ⚠ No member here may contain two adjacent capitals. <c>EnumWireFormat</c>
/// (JsonNamingPolicy.SnakeCaseUpper, a capital run is one word) and
/// <c>EnumToScreamingSnakeConverter</c> (an underscore before every capital) diverge the moment
/// two capitals sit together, and a stored wire spelling makes the read path THROW rather than
/// merely disagree. <c>IngestionEnumSpellingTests</c> is the guard.
/// </para>
/// </summary>

/// <summary>
/// The lifecycle of one stored raw document.
/// db/wire: RECEIVED | PROCESSING | PROCESSED | FAILED | DUPLICATE.
/// The published DDL's CHECK constraint already fixes this set; do not add members.
/// </summary>
public enum InboundMessageStatus
{
    Received,
    Processing,
    Processed,
    Failed,
    Duplicate,
}

/// <summary>
/// Where a version of a day's readings came from. db/wire: BRP_FEED | MANUAL.
/// [DEC-143]/S2-D2 settles this against the published DDL, which had no such column and so made
/// [F02-R36]'s manual reconciliation entry unstorable. MANUAL is storable and unreachable in
/// slice 2: the screens that would write one are deferred.
/// </summary>
public enum IntervalDataVersionSource
{
    BrpFeed,
    Manual,
}

/// <summary>
/// Which way the energy flowed. db/wire: CONSUMPTION | PRODUCTION.
/// <para>
/// The PVNed mapping is A02 to Consumption and A01 to Production, and it is a financial control
/// rather than a display concern: under [DEC-22] a mis-mapped direction produces a wrong invoice.
/// The adapter owns that mapping (shared contract section 8.2); this enum is only the vocabulary.
/// </para>
/// <para>
/// There is deliberately no NetUsage member. Consumption and production remain two separate,
/// non-negative series [AS-05], and net usage is derived per interval, never stored as a signed
/// source series (position-and-coverage section 2.1).
/// </para>
/// </summary>
public enum IntervalDirection
{
    Consumption,
    Production,
}

/// <summary>
/// Why a parsed series could not be attached to a metering point.
/// db/wire: UNKNOWN_EAN | EAN_VALIDITY | WRONG_BRP | NOT_ELECTRICITY.
/// All four are PIPELINE decisions, never adapter decisions: an adapter that queried
/// customer.metering_point has reimplemented a pipeline stage, which [F02-R40] forbids.
/// </summary>
public enum QuarantineReason
{
    UnknownEan,
    EanValidity,
    WrongBrp,
    NotElectricity,
}

/// <summary>
/// The materialised data state of one (metering point, delivery date). [F02-R22]
/// db/wire: NO_DATA | PARTIAL | PROVISIONAL | FINAL.
/// <para>
/// ⚠ There is no COMPLETE member. F02 section 6's state machine runs NO_DATA to PARTIAL to
/// PROVISIONAL to FINAL, and integration-spec section 8.3's word "Complete" names the CONDITION
/// that moves a day to PROVISIONAL, not a fifth state.
/// </para>
/// <para>
/// [DEC-98] makes FINAL a status rather than a guarantee: a post-window reconciliation reopens the
/// date to PROVISIONAL and re-finalises, so nothing may archive, compact or cache on FINAL.
/// </para>
/// </summary>
public enum MeteringDayState
{
    NoData,
    Partial,
    Provisional,
    Final,
}

/// <summary>
/// The five conditions slice 2 builds and tests. db/wire: VALIDATION_FAILURE |
/// METERING_POINT_SILENT | PRODUCTION_EXPECTATION_PROMOTED | MISSING_PRODUCTION_DECLARATION |
/// POST_WINDOW_RECONCILIATION.
/// <para>
/// Only the delivery channel is deferred (design section 3.2): each condition writes an
/// operational_alert row that the employee data-health screens render, and no mail, pager or
/// webhook is wired. [DEC-104] is one operator with no rota, so a channel with no rota behind it
/// is decoration.
/// </para>
/// </summary>
public enum OperationalAlertKind
{
    /// <summary>A document failed validation and landed FAILED with zero readings. [F02-R12]</summary>
    ValidationFailure,

    /// <summary>A metering point received nothing for two of its BRP's cadence windows. [F02-R26]</summary>
    MeteringPointSilent,

    /// <summary>An A01 series promoted a NEVER point to EXPECTED with source OBSERVED. [F02-R34]</summary>
    ProductionExpectationPromoted,

    /// <summary>A metering point has no production declaration and needs one. [F02-R35]</summary>
    MissingProductionDeclaration,

    /// <summary>A correction landed after the 10-working-day window and reopened a FINAL day. [F02-R45]</summary>
    PostWindowReconciliation,
}

/// <summary>Whether an operational alert is still outstanding. db/wire: OPEN | RESOLVED.</summary>
public enum OperationalAlertStatus
{
    Open,
    Resolved,
}
```

- [ ] **Step 4: Run the test and watch it pass, then mutate the adjacent-capital guard**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS.

Now prove the guard bites, on the case it is actually for. Temporarily rename
`IngestionEnums.cs`'s `QuarantineReason.UnknownEan` to `UnknownEAN`, and rename it in the
`QuarantineReason_has_the_four_reasons_the_pipeline_can_decide` expectation too, so only the
structural test is under examination:

```csharp
public enum QuarantineReason
{
    UnknownEAN,          // MUTATION - restore to UnknownEan
    EanValidity,
    WrongBrp,
    NotElectricity,
}
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo --filter "FullyQualifiedName~No_member_contains_two_adjacent_capitals"`
Expected: FAIL — `No_member_contains_two_adjacent_capitals(enumType: typeof(QuarantineReason))`
fails with `offenders should be empty but was ["UnknownEAN"]` followed by the message
`QuarantineReason has a member with two adjacent capitals…`.

⚠ **Check the failure is the one predicted.** If the run instead fails on
`QuarantineReason_has_the_four_reasons…`, the expectation was not renamed and the mutation is
testing the wrong assertion — the easy neighbouring case, not this one.

Restore both `UnknownEAN` occurrences to `UnknownEan` and re-run:

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Metering/IngestionEnums.cs \
        tests/PeakPower.Domain.Tests/Metering/IngestionEnumSpellingTests.cs
git commit -m "feat(domain): add the seven metering enums slice 2 persists as text

Member names are the shared contract's, and the database spelling is normative. The
adjacent-capital guard is verified by mutation: renaming UnknownEan to UnknownEAN makes
No_member_contains_two_adjacent_capitals go red, which is the failure that would
otherwise surface as Enum.Parse throwing on a read of a stored row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `Brp` gains the six columns that make the `[DEC-69]` seam selectable

`metering.brp` has only `id / code / name / is_active` today, so the port seam has no data behind
it and cannot select an adapter. Contract §6.1 adds `endpoint_uri`, `credential_ref`,
`document_format`, `adapter_key`, `expected_cadence` and `created_at`, plus
`UNIQUE (adapter_key, code)` and five `CHECK`s.

Three of those columns lose their `DEFAULT` after the seed `UPDATE` and gain a not-blank `CHECK`,
so `Brp.Create` cannot leave them empty — a row created without them fails at the database, not in
review. `Create` therefore takes them, and six call sites move. That is deliberate: `[DEC-69]`'s
whole claim is that BRP configuration is **data**, and a factory that lets you omit it is a factory
that lets you create a BRP no adapter can serve.

⚠ **`credential_ref` holds the NAME of an environment variable, never a secret.** The seeded value
is the literal string `BRP_CREDENTIAL_PVNED`, and the Worker reads
`Environment.GetEnvironmentVariable(brp.CredentialRef)` at request time (contract §9.3). The
published DDL's comment says "Key Vault secret name"; there is no key vault (`[OQ-102]`), and an
environment-variable name is the same shape of indirection. `Create` enforces the
`BRP_CREDENTIAL_` prefix. **That is a naming-convention guard, not a secret guard** —
`BRP_CREDENTIAL_hunter2` would pass it — and it is worth having anyway, because it makes the wrong
thing look wrong at the call site.

⚠ **`CreatedAt` is store-generated.** The column is `NOT NULL DEFAULT now()`, and `Brp.Create` may
not read a clock: architecture fact 5 is IL-enforced and confines that to
`PeakPower.Infrastructure.Time`. Task 10 configures it `.HasDefaultValueSql("now()")
.ValueGeneratedOnAdd()`, so EF omits the column when the property holds the CLR default and reads
the generated value back.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/Brp.cs` (the whole file)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs:104`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/ClaimConnectionTests.cs:64`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/ClaimConnectionBrpConfigurationTests.cs:68`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/ConnectionDetailTests.cs:69`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Supporting/SupportingTypeTests.cs:13-37` (rewritten, extended)

**Interfaces:**
- Consumes: `PeakPower.Domain.Common.Result<T>`.
- Produces:
  - `Brp.EndpointUri`, `Brp.CredentialRef`, `Brp.DocumentFormat`, `Brp.AdapterKey`,
    `Brp.ExpectedCadence` — all `string`, non-null — and `Brp.CreatedAt` (`DateTimeOffset`).
  - `Brp.Create(string code, string name, bool isActive, string endpointUri, string credentialRef, string documentFormat, string adapterKey, string expectedCadence)` → `Result<Brp>`.
  - `Brp.PvnedAdapterKey` = `"PVNED_TIMESERIES_XML_V2P0"` — the string plans 1, 3 and 4 resolve on.
  - `Brp.PvnedTimeseriesXmlFormat` = `"PVNED_TIMESERIES_XML"`.
  - `Brp.DailyPerEanCadence` = `"DAILY_PER_EAN"`.
  - `Brp.CredentialRefPrefix` = `"BRP_CREDENTIAL_"`.
  - `Brp.CredentialRefFor(string code)` → `"BRP_CREDENTIAL_" + code.ToUpperInvariant()`.
  - `Brp.WebhookPathFor(string code)` → `"/webhooks/brp/" + code.ToUpperInvariant()`.

- [ ] **Step 1: Write the failing test**

Replace lines `13-37` of
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Supporting/SupportingTypeTests.cs`
— the three existing `Brp` tests — with these. Everything below line 37 in that file (the wallet and
audit tests) is untouched.

```csharp
    /// <summary>The configuration every BRP row must now carry, so the tests below read as one line.</summary>
    private static Result<Brp> CreatePvned(
        string code = "PVNED",
        string name = "PVNed B.V.",
        bool isActive = true,
        string? endpointUri = null,
        string? credentialRef = null,
        string documentFormat = Brp.PvnedTimeseriesXmlFormat,
        string adapterKey = Brp.PvnedAdapterKey,
        string expectedCadence = Brp.DailyPerEanCadence) =>
        Brp.Create(
            code,
            name,
            isActive,
            endpointUri ?? "/webhooks/brp/PVNED",
            credentialRef ?? "BRP_CREDENTIAL_PVNED",
            documentFormat,
            adapterKey,
            expectedCadence);

    [Fact]
    public void A_BRP_stores_its_code_upper_case_because_market_codes_are_case_insensitive()
    {
        var brp = CreatePvned(code: "pvned").Value;

        brp.Id.ShouldNotBe(Guid.Empty);
        brp.Code.ShouldBe("PVNED");
        brp.Name.ShouldBe("PVNed B.V.");
        brp.IsActive.ShouldBeTrue();
    }

    [Fact]
    public void A_BRP_without_a_code_is_rejected()
    {
        var result = CreatePvned(code: "  ");

        result.IsSuccess.ShouldBeFalse();
        result.Error.ShouldBe("BRP code is required.");
    }

    [Fact]
    public void A_BRP_without_a_name_is_rejected()
    {
        CreatePvned(name: "  ").Error.ShouldBe("BRP name is required.");
    }

    /// <summary>
    /// [DEC-69]: the endpoint, the credential reference and the adapter key are what turn the BRP
    /// port from a shape into something that can select an adapter. Migration 9 drops the DEFAULT
    /// off all three and adds a not-blank CHECK to each, so a row created without them is refused
    /// by PostgreSQL - this factory refuses it one layer earlier and with a readable reason.
    /// </summary>
    [Fact]
    public void A_BRP_carries_the_configuration_that_selects_its_adapter()
    {
        var brp = CreatePvned().Value;

        brp.EndpointUri.ShouldBe("/webhooks/brp/PVNED");
        brp.CredentialRef.ShouldBe("BRP_CREDENTIAL_PVNED");
        brp.DocumentFormat.ShouldBe("PVNED_TIMESERIES_XML");
        brp.AdapterKey.ShouldBe("PVNED_TIMESERIES_XML_V2P0");
        brp.ExpectedCadence.ShouldBe("DAILY_PER_EAN");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void A_BRP_without_an_endpoint_is_rejected(string endpointUri)
    {
        CreatePvned(endpointUri: endpointUri).Error
            .ShouldBe("BRP endpoint URI is required.");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void A_BRP_without_an_adapter_key_is_rejected(string adapterKey)
    {
        CreatePvned(adapterKey: adapterKey).Error
            .ShouldBe("BRP adapter key is required.");
    }

    /// <summary>
    /// ⚠ credential_ref holds the NAME of an environment variable, never a secret. The prefix rule
    /// is a NAMING guard and not a secret guard - "BRP_CREDENTIAL_hunter2" passes it - but it is
    /// what makes a pasted secret look wrong at the call site, which is where it would be pasted.
    /// </summary>
    [Fact]
    public void A_credential_reference_that_is_not_an_environment_variable_name_is_rejected()
    {
        CreatePvned(credentialRef: "s3cr3t-shared-key").Error.ShouldBe(
            "BRP credential reference must name an environment variable and start with " +
            "'BRP_CREDENTIAL_'. It must never hold a secret.");
    }

    [Fact]
    public void An_unsupported_document_format_is_rejected_because_only_one_adapter_exists()
    {
        CreatePvned(documentFormat: "EDIFACT").Error
            .ShouldBe("BRP document format must be one of: PVNED_TIMESERIES_XML.");
    }

    [Fact]
    public void An_unsupported_cadence_is_rejected()
    {
        CreatePvned(expectedCadence: "HOURLY").Error
            .ShouldBe("BRP expected cadence must be one of: DAILY_PER_EAN.");
    }

    /// <summary>
    /// The two conventions the Worker and DevStubs both derive from a code, kept on the entity so
    /// there is exactly one spelling of each. Shared contract sections 9.1 and 9.3.
    /// </summary>
    [Fact]
    public void The_webhook_path_and_the_credential_variable_are_derived_from_the_code()
    {
        Brp.WebhookPathFor("pvned").ShouldBe("/webhooks/brp/PVNED");
        Brp.CredentialRefFor("pvned").ShouldBe("BRP_CREDENTIAL_PVNED");
    }
```

Add `using PeakPower.Domain.Common;` to the file's using block (for `Result<T>` in the helper's
return type), so the top of the file reads:

```csharp
using Shouldly;
using Xunit;
using PeakPower.Domain.Auditing;
using PeakPower.Domain.Common;
using PeakPower.Domain.Metering;
using PeakPower.Domain.Wallets;
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: FAIL to build with
`error CS1501: No overload for method 'Create' takes 8 arguments`
and `error CS0117: 'Brp' does not contain a definition for 'PvnedTimeseriesXmlFormat'`.

- [ ] **Step 3: Write the implementation**

Replace the whole of
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/Brp.cs`:

```csharp
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Metering;

/// <summary>
/// A balance responsible party: the market participant answerable to the Dutch grid operator
/// for a connection's imbalance. Reference data. [F12-R49]
/// <para>
/// [DEC-69] makes the BRP the seam: the document format, the endpoint, the credential reference
/// and the adapter key are columns on this row rather than constants in code, so pointing the
/// platform at a real PVNed endpoint later is a data change plus a credential, and adding a second
/// BRP is a row.
/// </para>
/// </summary>
public sealed class Brp
{
    /// <summary>The only document format slice 2 has an adapter for.</summary>
    public const string PvnedTimeseriesXmlFormat = "PVNED_TIMESERIES_XML";

    /// <summary>
    /// The adapter key of the one adapter that exists. It matches
    /// <c>IBrpIngestionAdapter.AdapterKey</c> exactly - the pipeline resolves an adapter by the
    /// stored brp_id's adapter_key at dequeue time (S2-D3), never by a field in the payload.
    /// </summary>
    public const string PvnedAdapterKey = "PVNED_TIMESERIES_XML_V2P0";

    /// <summary>One document per EAN per day. [DEC-38]</summary>
    public const string DailyPerEanCadence = "DAILY_PER_EAN";

    /// <summary>
    /// ⚠ <see cref="CredentialRef"/> holds the NAME of an environment variable, never a secret.
    /// The Worker reads Environment.GetEnvironmentVariable(brp.CredentialRef) at request time, and
    /// an empty or absent value means every request to that BRP's route is 401 - fail closed. It
    /// must never mean "no credential required".
    /// </summary>
    public const string CredentialRefPrefix = "BRP_CREDENTIAL_";

    private static readonly string[] SupportedDocumentFormats = [PvnedTimeseriesXmlFormat];

    private static readonly string[] SupportedCadences = [DailyPerEanCadence];

    /// <summary>EF Core materialises through this; application code uses <see cref="Create"/>.</summary>
    private Brp()
    {
    }

    public Guid Id { get; private set; }

    /// <summary>The market party code, stored upper case. Also the {brpCode} route segment.</summary>
    public string Code { get; private set; } = string.Empty;

    public string Name { get; private set; } = string.Empty;

    public bool IsActive { get; private set; }

    /// <summary>The path this BRP posts to, e.g. <c>/webhooks/brp/PVNED</c>.</summary>
    public string EndpointUri { get; private set; } = string.Empty;

    /// <summary>
    /// The NAME of the environment variable holding this BRP's shared secret - never the secret.
    /// See <see cref="CredentialRefPrefix"/>.
    /// </summary>
    public string CredentialRef { get; private set; } = string.Empty;

    /// <summary>One of <see cref="SupportedDocumentFormats"/>.</summary>
    public string DocumentFormat { get; private set; } = string.Empty;

    /// <summary>
    /// Selects the adapter. The stored value on the message's brp_id decides at dequeue time, so a
    /// replay [F02-R27] is parsed by the same adapter that first parsed it - including after this
    /// BRP has been deactivated. [F02-R41], S2-D3
    /// </summary>
    public string AdapterKey { get; private set; } = string.Empty;

    /// <summary>
    /// How often a document is expected per metering point. Silence detection [F02-R26] reads it.
    /// One of <see cref="SupportedCadences"/>.
    /// </summary>
    public string ExpectedCadence { get; private set; } = string.Empty;

    /// <summary>
    /// Store-generated: the column is <c>NOT NULL DEFAULT now()</c>, and this factory may not read
    /// a clock - architecture fact 5 confines that to PeakPower.Infrastructure.Time and enforces it
    /// over the compiled IL. BrpConfiguration maps it ValueGeneratedOnAdd, so EF omits the column
    /// on insert and reads the database's answer back.
    /// </summary>
    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>The webhook path convention, derived from the code. Shared contract section 9.1.</summary>
    public static string WebhookPathFor(string code) =>
        "/webhooks/brp/" + code.Trim().ToUpperInvariant();

    /// <summary>The environment-variable naming convention. Shared contract section 9.3.</summary>
    public static string CredentialRefFor(string code) =>
        CredentialRefPrefix + code.Trim().ToUpperInvariant();

    public static Result<Brp> Create(
        string code,
        string name,
        bool isActive,
        string endpointUri,
        string credentialRef,
        string documentFormat,
        string adapterKey,
        string expectedCadence)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            return Result<Brp>.Failure("BRP code is required.");
        }

        if (string.IsNullOrWhiteSpace(name))
        {
            return Result<Brp>.Failure("BRP name is required.");
        }

        if (string.IsNullOrWhiteSpace(endpointUri))
        {
            return Result<Brp>.Failure("BRP endpoint URI is required.");
        }

        if (string.IsNullOrWhiteSpace(adapterKey))
        {
            return Result<Brp>.Failure("BRP adapter key is required.");
        }

        // ⚠ A naming guard, not a secret guard. It cannot tell BRP_CREDENTIAL_PVNED from
        // BRP_CREDENTIAL_hunter2. What it does do is make a pasted secret look wrong at the call
        // site, which is the only place a secret would ever be pasted.
        if (string.IsNullOrWhiteSpace(credentialRef)
            || !credentialRef.Trim().StartsWith(CredentialRefPrefix, StringComparison.Ordinal))
        {
            return Result<Brp>.Failure(
                "BRP credential reference must name an environment variable and start with " +
                $"'{CredentialRefPrefix}'. It must never hold a secret.");
        }

        if (!SupportedDocumentFormats.Contains(documentFormat, StringComparer.Ordinal))
        {
            return Result<Brp>.Failure(
                "BRP document format must be one of: " +
                string.Join(", ", SupportedDocumentFormats) + ".");
        }

        if (!SupportedCadences.Contains(expectedCadence, StringComparer.Ordinal))
        {
            return Result<Brp>.Failure(
                "BRP expected cadence must be one of: " + string.Join(", ", SupportedCadences) + ".");
        }

        return Result<Brp>.Success(new Brp
        {
            Id = Guid.CreateVersion7(),
            Code = code.Trim().ToUpperInvariant(),
            Name = name.Trim(),
            IsActive = isActive,
            EndpointUri = endpointUri.Trim(),
            CredentialRef = credentialRef.Trim(),
            DocumentFormat = documentFormat,
            AdapterKey = adapterKey.Trim(),
            ExpectedCadence = expectedCadence,
        });
    }

    /// <summary>
    /// Replaces the configuration an employee may change without recreating the row. The code and
    /// the id never change: a BRP's code is what the webhook route and the credential variable are
    /// named after, and renaming it would orphan both.
    /// </summary>
    public Result<Brp> Reconfigure(
        string endpointUri,
        string credentialRef,
        string documentFormat,
        string adapterKey,
        string expectedCadence)
    {
        var validated = Create(
            Code, Name, IsActive, endpointUri, credentialRef, documentFormat, adapterKey,
            expectedCadence);

        if (!validated.IsSuccess)
        {
            return Result<Brp>.Failure(validated.Error);
        }

        EndpointUri = validated.Value.EndpointUri;
        CredentialRef = validated.Value.CredentialRef;
        DocumentFormat = validated.Value.DocumentFormat;
        AdapterKey = validated.Value.AdapterKey;
        ExpectedCadence = validated.Value.ExpectedCadence;

        return Result<Brp>.Success(this);
    }
}
```

Add `using System.Linq;` only if the project does not already have implicit usings — it does
(`Directory.Build.props` sets `ImplicitUsings enable`), so `Contains` with a comparer resolves
without a using.

- [ ] **Step 4: Move the four other call sites**

`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs:104`
— before:

```csharp
            brp = Unwrap(Brp.Create("PVNED", "PVNed B.V.", isActive: true));
```

after:

```csharp
            // Only reachable on a database where migration 1's seeded row is missing, which is why
            // it is a fallback rather than the source of truth - but if it does run, the row it
            // writes must carry the same configuration migration 9's UPDATE gives the real one, or
            // the [DEC-69] seam has a row it cannot resolve an adapter for.
            brp = Unwrap(Brp.Create(
                "PVNED",
                "PVNed B.V.",
                isActive: true,
                Brp.WebhookPathFor("PVNED"),
                Brp.CredentialRefFor("PVNED"),
                Brp.PvnedTimeseriesXmlFormat,
                Brp.PvnedAdapterKey,
                Brp.DailyPerEanCadence));
```

`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/ClaimConnectionTests.cs:64`
— before:

```csharp
            db.Brps.Add(Brp.Create(RetiredBrpCode, "Aa Balans B.V. (retired)", isActive: false).Value);
```

after:

```csharp
            db.Brps.Add(Brp.Create(
                RetiredBrpCode,
                "Aa Balans B.V. (retired)",
                isActive: false,
                Brp.WebhookPathFor(RetiredBrpCode),
                Brp.CredentialRefFor(RetiredBrpCode),
                Brp.PvnedTimeseriesXmlFormat,
                Brp.PvnedAdapterKey,
                Brp.DailyPerEanCadence).Value);
```

`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/ClaimConnectionBrpConfigurationTests.cs:68`
— before:

```csharp
            db.Brps.Add(Brp.Create("ZZSECOND", "Tweede Balans B.V.", isActive: true).Value);
```

after:

```csharp
            db.Brps.Add(Brp.Create(
                "ZZSECOND",
                "Tweede Balans B.V.",
                isActive: true,
                Brp.WebhookPathFor("ZZSECOND"),
                Brp.CredentialRefFor("ZZSECOND"),
                Brp.PvnedTimeseriesXmlFormat,
                Brp.PvnedAdapterKey,
                Brp.DailyPerEanCadence).Value);
```

`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/ConnectionDetailTests.cs:69`
— before:

```csharp
            attached = Brp.Create(AttachedBrpCode, AttachedBrpName, isActive: true).Value;
```

after:

```csharp
            attached = Brp.Create(
                AttachedBrpCode,
                AttachedBrpName,
                isActive: true,
                Brp.WebhookPathFor(AttachedBrpCode),
                Brp.CredentialRefFor(AttachedBrpCode),
                Brp.PvnedTimeseriesXmlFormat,
                Brp.PvnedAdapterKey,
                Brp.DailyPerEanCadence).Value;
```

⚠ All three test BRPs use `Brp.PvnedAdapterKey`. That is safe against
`ux_brp_adapter_key_code UNIQUE (adapter_key, code)` — the constraint is on the **pair**, and the
codes differ. It is also honest: there is exactly one adapter in slice 2, and a second BRP in a test
fixture is a second *routing target*, not a second format.

- [ ] **Step 5: Run everything and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Domain.Tests --nologo
```

Expected: build clean; Domain tests PASS.

The integration tests still pass at this point because migration 9 does not exist yet — the new
columns are on the entity but not in the database, so EF would fail. **Do not run
`tests/PeakPower.Integration.Tests` until Task 12 lands the migration.** Task 10 wires the EF
configuration; between here and there the model and the schema disagree by design, and Task 12's
`dotnet ef migrations add` is what closes the gap.

- [ ] **Step 6: Mutate the credential-reference guard**

Temporarily delete the whole `credentialRef` guard block from `Brp.Create`:

```csharp
        // MUTATION - the entire block below is removed for one run
        // if (string.IsNullOrWhiteSpace(credentialRef)
        //     || !credentialRef.Trim().StartsWith(CredentialRefPrefix, StringComparison.Ordinal))
        // {
        //     return Result<Brp>.Failure(...);
        // }
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo --filter "FullyQualifiedName~A_credential_reference_that_is_not_an_environment_variable_name_is_rejected"`
Expected: FAIL — `Cannot read Value of a failed result` is **not** what appears; instead
`A_credential_reference_that_is_not_an_environment_variable_name_is_rejected` fails with
`result.Error should be "BRP credential reference must name an environment variable and start with 'BRP_CREDENTIAL_'. It must never hold a secret." but was ""` — because a successful `Result<Brp>`
carries `Error == string.Empty`.

Restore the block and re-run:

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Metering/Brp.cs \
        src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs \
        tests/PeakPower.Domain.Tests/Supporting/SupportingTypeTests.cs \
        tests/PeakPower.Integration.Tests/Portal/ClaimConnectionTests.cs \
        tests/PeakPower.Integration.Tests/Portal/ClaimConnectionBrpConfigurationTests.cs \
        tests/PeakPower.Integration.Tests/Portal/ConnectionDetailTests.cs
git commit -m "feat(domain): give Brp the configuration that makes the DEC-69 seam selectable

Endpoint, credential reference, document format, adapter key and cadence are columns on
the row rather than constants in code, so pointing at a real endpoint later is a data
change. Create takes all five because migration 9 drops the DEFAULT off three of them and
adds a not-blank CHECK to each - a row created without them is refused by PostgreSQL, and
this refuses it one layer earlier with a readable reason. credential_ref holds the NAME of
an environment variable; the prefix rule is verified by mutation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `InboundMessage` — the stored raw document

One row per POST that got past authentication and the size cap. Contract §5 fixes every property
name and both factory and mutator signatures, and this task must match them **exactly**: plans 3
and 6 call them and cannot see this file.

⚠ **The mutators return `void`, not `Result<T>`.** Slice 1's rule is that every fallible operation
returns `Result<T>`, and contract §5 overrides it here by pinning the signatures. An illegal status
transition therefore throws `InvalidOperationException`. That is the right shape anyway: a
transition that cannot happen is a programming error in the pipeline, not a validation outcome a
caller chooses between.

The legal transitions, and why:

| From | `BeginProcessing` | `MarkProcessed` | `MarkFailed` | `MarkDuplicate` |
| --- | --- | --- | --- | --- |
| `Received` | ✓ the normal enqueue | ✗ | ✗ | ✓ the 24 h byte-identical case, decided at receipt |
| `Processing` | ✗ | ✓ | ✓ | ✗ |
| `Processed` | ✓ **replay** `[F02-R27]` | ✗ | ✗ | ✗ |
| `Failed` | ✓ **replay** after a fix | ✗ | ✗ | ✗ |
| `Duplicate` | ✗ nothing was ever enqueued | ✗ | ✗ | ✗ |

`Processed → Processing` is not an oversight: contract §10.4's replay reads the stored raw payload
and goes through the same adapter, and the message it re-processes is by definition already
`PROCESSED`.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/InboundMessage.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Metering/InboundMessageTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Domain.Common.Result<T>`, `PeakPower.Domain.Metering.InboundMessageStatus`.
- Produces:
  - `InboundMessage` with `Id`, `BrpId`, `CorrelationId`, `ReceivedAt`, `PayloadHash`,
    `PayloadBytes`, `PayloadUri`, `HttpHeaders`, `RemoteIp`, `Status`, `FailureCode`,
    `FailureDetail`, `ProcessedAt`.
  - `InboundMessage.Receive(Guid brpId, Guid correlationId, DateTimeOffset receivedAt, byte[] payloadHash, long payloadBytes, string payloadUri, string? httpHeaders, string? remoteIp)` → `Result<InboundMessage>`
  - `void BeginProcessing()`, `void MarkProcessed(DateTimeOffset at)`,
    `void MarkFailed(string failureCode, string failureDetail, DateTimeOffset at)`,
    `void MarkDuplicate(DateTimeOffset at)`
  - `InboundMessage.PayloadHashLength` = `32`.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Metering/InboundMessageTests.cs`:

```csharp
using Shouldly;
using Xunit;
using PeakPower.Domain.Common;
using PeakPower.Domain.Metering;

namespace PeakPower.Domain.Tests.Metering;

public sealed class InboundMessageTests
{
    private static readonly Guid BrpId = Guid.Parse("0199a1a0-0000-7000-8000-0000000000b1");
    private static readonly Guid CorrelationId = Guid.Parse("0199a1a0-0000-7000-8000-00000000c0d1");
    private static readonly DateTimeOffset ReceivedAt =
        new(2026, 8, 13, 4, 2, 11, TimeSpan.Zero);

    private static byte[] Hash(byte fill = 0x2f)
    {
        var hash = new byte[InboundMessage.PayloadHashLength];
        Array.Fill(hash, fill);
        return hash;
    }

    private static Result<InboundMessage> Receive(
        byte[]? payloadHash = null,
        long payloadBytes = 41_822,
        string payloadUri = "file://0199a1a0/2026/08/13/0199a1a0-0000-7000-8000-00000000c0d1.bin",
        string? httpHeaders = """{"content-type":"text/xml"}""",
        string? remoteIp = "10.0.0.7") =>
        InboundMessage.Receive(
            BrpId, CorrelationId, ReceivedAt, payloadHash ?? Hash(), payloadBytes, payloadUri,
            httpHeaders, remoteIp);

    [Fact]
    public void A_received_message_is_RECEIVED_and_not_PROCESSED()
    {
        // Design section 7.2: at the moment the 200 is written the payload is durably stored with
        // headers, source IP, receipt time, correlation id and brp_id, and status is RECEIVED -
        // NOT PROCESSED. 200-before-processing is structural, not an optimisation: it is what
        // stops a parser bug becoming a redelivery flood [F02-R04], [F02-R05].
        var message = Receive().Value;

        message.Id.ShouldNotBe(Guid.Empty);
        message.BrpId.ShouldBe(BrpId);
        message.CorrelationId.ShouldBe(CorrelationId);
        message.ReceivedAt.ShouldBe(ReceivedAt);
        message.PayloadBytes.ShouldBe(41_822);
        message.PayloadUri.ShouldBe(
            "file://0199a1a0/2026/08/13/0199a1a0-0000-7000-8000-00000000c0d1.bin");
        message.HttpHeaders.ShouldBe("""{"content-type":"text/xml"}""");
        message.RemoteIp.ShouldBe("10.0.0.7");
        message.Status.ShouldBe(InboundMessageStatus.Received);
        message.ProcessedAt.ShouldBeNull();
        message.FailureCode.ShouldBeNull();
        message.FailureDetail.ShouldBeNull();
    }

    [Fact]
    public void Headers_and_remote_IP_are_optional_because_a_replayed_capture_may_carry_neither()
    {
        var message = Receive(httpHeaders: null, remoteIp: null).Value;

        message.HttpHeaders.ShouldBeNull();
        message.RemoteIp.ShouldBeNull();
    }

    [Fact]
    public void A_message_without_a_BRP_is_rejected()
    {
        InboundMessage.Receive(
            Guid.Empty, CorrelationId, ReceivedAt, Hash(), 1, "file://x", null, null)
            .Error.ShouldBe("An inbound message must name the BRP it arrived from.");
    }

    [Fact]
    public void A_message_without_a_correlation_id_is_rejected()
    {
        // The correlation id is stamped at receipt and carried through queue, adapter and apply.
        // It is in scope precisely because retrofitting one across an async hop rewrites every log
        // line, so a message that never got one is a bug worth refusing at the door.
        InboundMessage.Receive(BrpId, Guid.Empty, ReceivedAt, Hash(), 1, "file://x", null, null)
            .Error.ShouldBe("An inbound message must carry a correlation id.");
    }

    [Fact]
    public void A_payload_hash_that_is_not_thirty_two_bytes_is_rejected()
    {
        // SHA-256, 32 bytes. The 24-hour byte-identical dedupe [F02-R07] compares this column, so
        // a short or truncated hash is a dedupe that silently stops deduplicating.
        InboundMessage.Receive(
            BrpId, CorrelationId, ReceivedAt, new byte[16], 1, "file://x", null, null)
            .Error.ShouldBe("An inbound message payload hash must be 32 bytes of SHA-256.");
    }

    [Fact]
    public void A_negative_payload_size_is_rejected()
    {
        Receive(payloadBytes: -1).Error
            .ShouldBe("An inbound message payload size must not be negative.");
    }

    [Fact]
    public void A_message_without_a_payload_URI_is_rejected()
    {
        // [F02-R03]/[DEC-03]: the payload is durable BEFORE the webhook writes its 200. A row with
        // no payload_uri is a row whose raw document cannot be replayed, which is the one thing
        // the employee data-health screen exists to do.
        Receive(payloadUri: "   ").Error
            .ShouldBe("An inbound message must record where its payload was stored.");
    }

    [Fact]
    public void The_stored_hash_is_a_copy_so_a_caller_cannot_mutate_it_afterwards()
    {
        var hash = Hash();
        var message = Receive(payloadHash: hash).Value;

        hash[0] = 0xff;

        message.PayloadHash[0].ShouldBe((byte)0x2f);
    }

    [Fact]
    public void Processing_a_received_message_moves_it_to_PROCESSING()
    {
        var message = Receive().Value;

        message.BeginProcessing();

        message.Status.ShouldBe(InboundMessageStatus.Processing);
    }

    [Fact]
    public void A_processed_message_can_be_processed_again_because_replay_reruns_it()
    {
        // [F02-R27]: an employee replays a stored message from the log. The message it re-processes
        // is by definition already PROCESSED, so this transition is the replay path, not a bug.
        var message = Receive().Value;
        message.BeginProcessing();
        message.MarkProcessed(ReceivedAt.AddSeconds(1));

        message.BeginProcessing();

        message.Status.ShouldBe(InboundMessageStatus.Processing);
    }

    [Fact]
    public void A_failed_message_can_be_processed_again_once_the_cause_is_fixed()
    {
        var message = Receive().Value;
        message.BeginProcessing();
        message.MarkFailed("UNKNOWN_METERING_POINT", "EAN 871685900000000042 is registered nowhere.",
            ReceivedAt.AddSeconds(1));

        message.BeginProcessing();

        message.Status.ShouldBe(InboundMessageStatus.Processing);
    }

    [Fact]
    public void A_duplicate_is_never_processed_because_nothing_was_ever_enqueued()
    {
        var message = Receive().Value;
        message.MarkDuplicate(ReceivedAt);

        var act = () => message.BeginProcessing();

        Should.Throw<InvalidOperationException>(act).Message.ShouldBe(
            "An inbound message in status DUPLICATE cannot begin processing.");
    }

    [Fact]
    public void Marking_processed_without_beginning_is_refused()
    {
        var message = Receive().Value;

        var act = () => message.MarkProcessed(ReceivedAt);

        Should.Throw<InvalidOperationException>(act).Message.ShouldBe(
            "An inbound message in status RECEIVED cannot be marked processed.");
    }

    [Fact]
    public void Marking_processed_stamps_the_moment_and_clears_nothing_else()
    {
        var processedAt = ReceivedAt.AddSeconds(1);
        var message = Receive().Value;
        message.BeginProcessing();

        message.MarkProcessed(processedAt);

        message.Status.ShouldBe(InboundMessageStatus.Processed);
        message.ProcessedAt.ShouldBe(processedAt);
        message.FailureCode.ShouldBeNull();
    }

    [Fact]
    public void A_failure_carries_a_machine_readable_code_and_a_human_readable_message()
    {
        // Design section 7.3: a parser failure still returns 200 and lands the message FAILED with
        // a machine-readable code AND a human-readable message, zero interval rows written. The
        // column pair is enforced by ck_msg_failed_has_code in migration 9; this is the same rule
        // one layer up, where the error is readable.
        var failedAt = ReceivedAt.AddSeconds(2);
        var message = Receive().Value;
        message.BeginProcessing();

        message.MarkFailed("INCOMPLETE_PERIOD", "Expected 96 points for 2026-08-12, found 95.", failedAt);

        message.Status.ShouldBe(InboundMessageStatus.Failed);
        message.FailureCode.ShouldBe("INCOMPLETE_PERIOD");
        message.FailureDetail.ShouldBe("Expected 96 points for 2026-08-12, found 95.");
        message.ProcessedAt.ShouldBe(failedAt);
    }

    [Theory]
    [InlineData("", "detail")]
    [InlineData("   ", "detail")]
    [InlineData("CODE", "")]
    [InlineData("CODE", "   ")]
    public void A_failure_without_both_halves_is_refused(string code, string detail)
    {
        var message = Receive().Value;
        message.BeginProcessing();

        var act = () => message.MarkFailed(code, detail, ReceivedAt);

        Should.Throw<ArgumentException>(act).Message.ShouldStartWith(
            "A failed inbound message must carry both a failure code and a failure detail.");
    }

    [Fact]
    public void A_duplicate_records_the_moment_it_was_recognised()
    {
        // [F02-R07]: a byte-identical payload from the same BRP within 24 h records DUPLICATE and
        // creates no second version. The 200 is still written.
        var message = Receive().Value;

        message.MarkDuplicate(ReceivedAt);

        message.Status.ShouldBe(InboundMessageStatus.Duplicate);
        message.ProcessedAt.ShouldBe(ReceivedAt);
    }

    [Fact]
    public void A_message_already_being_processed_cannot_be_marked_duplicate()
    {
        var message = Receive().Value;
        message.BeginProcessing();

        var act = () => message.MarkDuplicate(ReceivedAt);

        Should.Throw<InvalidOperationException>(act).Message.ShouldBe(
            "An inbound message in status PROCESSING cannot be marked duplicate.");
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: FAIL to build with
`error CS0246: The type or namespace name 'InboundMessage' could not be found`.

- [ ] **Step 3: Write the implementation**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/InboundMessage.cs`:

```csharp
using System.Diagnostics.CodeAnalysis;
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Metering;

/// <summary>
/// The stored raw document. One row per POST that got past authentication and the size cap.
/// Aggregate root.
/// <para>
/// ⚠ The four mutators return <c>void</c> rather than <see cref="Result{T}"/>, which is the shared
/// contract's pinned shape (section 5) and a deliberate exception to slice 1's rule. An illegal
/// status transition is a programming error in the pipeline - there is no caller that would choose
/// between the two outcomes - so it throws rather than returning a value somebody can ignore.
/// </para>
/// </summary>
public sealed class InboundMessage
{
    /// <summary>SHA-256, so exactly 32 bytes. The 24-hour dedupe [F02-R07] compares this column.</summary>
    public const int PayloadHashLength = 32;

    /// <summary>EF Core materialises through this; application code uses <see cref="Receive"/>.</summary>
    private InboundMessage()
    {
    }

    public Guid Id { get; private set; }

    public Guid BrpId { get; private set; }

    /// <summary>
    /// Stamped at receipt and carried to every log line, to the queue, to the adapter, to the
    /// apply transaction and onto every interval_data_version this message produces. Unique.
    /// </summary>
    public Guid CorrelationId { get; private set; }

    public DateTimeOffset ReceivedAt { get; private set; }

    [SuppressMessage(
        "Performance",
        "CA1819:Properties should not return arrays",
        Justification = "The shared contract pins this property as byte[] (section 5) and it maps " +
            "straight onto a bytea column. Receive() copies the caller's array in, and this " +
            "getter is read by the dedupe query and by EF only.")]
    public byte[] PayloadHash { get; private set; } = [];

    public long PayloadBytes { get; private set; }

    /// <summary>
    /// IRawPayloadStore's opaque handle - <c>file://{relative path}</c> for the filesystem store.
    /// It is durable BEFORE the webhook writes its 200 [F02-R03], [DEC-03], and it is what makes a
    /// replay possible at all.
    /// </summary>
    public string PayloadUri { get; private set; } = string.Empty;

    /// <summary>The request headers as JSON, stored jsonb. Null when a caller had none to record.</summary>
    public string? HttpHeaders { get; private set; }

    /// <summary>The source address, stored inet. Null when a caller had none to record.</summary>
    public string? RemoteIp { get; private set; }

    public InboundMessageStatus Status { get; private set; }

    /// <summary>An adapter failure code, or a pipeline code. Set only with <see cref="FailureDetail"/>.</summary>
    public string? FailureCode { get; private set; }

    public string? FailureDetail { get; private set; }

    /// <summary>When the message reached a terminal status - PROCESSED, FAILED or DUPLICATE.</summary>
    public DateTimeOffset? ProcessedAt { get; private set; }

    public static Result<InboundMessage> Receive(
        Guid brpId,
        Guid correlationId,
        DateTimeOffset receivedAt,
        byte[] payloadHash,
        long payloadBytes,
        string payloadUri,
        string? httpHeaders,
        string? remoteIp)
    {
        if (brpId == Guid.Empty)
        {
            return Result<InboundMessage>.Failure(
                "An inbound message must name the BRP it arrived from.");
        }

        if (correlationId == Guid.Empty)
        {
            return Result<InboundMessage>.Failure(
                "An inbound message must carry a correlation id.");
        }

        if (payloadHash is null || payloadHash.Length != PayloadHashLength)
        {
            return Result<InboundMessage>.Failure(
                $"An inbound message payload hash must be {PayloadHashLength} bytes of SHA-256.");
        }

        if (payloadBytes < 0)
        {
            return Result<InboundMessage>.Failure(
                "An inbound message payload size must not be negative.");
        }

        if (string.IsNullOrWhiteSpace(payloadUri))
        {
            return Result<InboundMessage>.Failure(
                "An inbound message must record where its payload was stored.");
        }

        return Result<InboundMessage>.Success(new InboundMessage
        {
            Id = Guid.CreateVersion7(),
            BrpId = brpId,
            CorrelationId = correlationId,
            ReceivedAt = receivedAt,

            // A copy, not the caller's array: a byte[] property is reference-typed, and a pipeline
            // that pooled or reused its hash buffer would otherwise rewrite a stored row's dedupe
            // key from under it.
            PayloadHash = [.. payloadHash],
            PayloadBytes = payloadBytes,
            PayloadUri = payloadUri.Trim(),
            HttpHeaders = Blank(httpHeaders),
            RemoteIp = Blank(remoteIp),
            Status = InboundMessageStatus.Received,
        });
    }

    /// <summary>
    /// RECEIVED to PROCESSING on the normal path, and PROCESSED or FAILED to PROCESSING on a
    /// replay [F02-R27] - the message a replay re-processes is by definition already terminal. A
    /// DUPLICATE is never enqueued, so it can never begin.
    /// </summary>
    public void BeginProcessing()
    {
        if (Status is not (InboundMessageStatus.Received
            or InboundMessageStatus.Processed
            or InboundMessageStatus.Failed))
        {
            throw new InvalidOperationException(
                $"An inbound message in status {Wire(Status)} cannot begin processing.");
        }

        Status = InboundMessageStatus.Processing;
        FailureCode = null;
        FailureDetail = null;
        ProcessedAt = null;
    }

    public void MarkProcessed(DateTimeOffset at)
    {
        if (Status is not InboundMessageStatus.Processing)
        {
            throw new InvalidOperationException(
                $"An inbound message in status {Wire(Status)} cannot be marked processed.");
        }

        Status = InboundMessageStatus.Processed;
        ProcessedAt = at;
    }

    /// <summary>
    /// A validation failure still returns 200 to the sender [F02-R05] and writes zero interval
    /// rows [F02-R13]. Both halves of the failure are mandatory, which migration 9 also enforces
    /// as <c>ck_msg_failed_has_code</c>: a code with no message is unreadable on the employee
    /// screen, and a message with no code cannot be counted or filtered.
    /// </summary>
    public void MarkFailed(string failureCode, string failureDetail, DateTimeOffset at)
    {
        if (Status is not InboundMessageStatus.Processing)
        {
            throw new InvalidOperationException(
                $"An inbound message in status {Wire(Status)} cannot be marked failed.");
        }

        if (string.IsNullOrWhiteSpace(failureCode) || string.IsNullOrWhiteSpace(failureDetail))
        {
            throw new ArgumentException(
                "A failed inbound message must carry both a failure code and a failure detail.",
                nameof(failureCode));
        }

        Status = InboundMessageStatus.Failed;
        FailureCode = failureCode.Trim();
        FailureDetail = failureDetail.Trim();
        ProcessedAt = at;
    }

    /// <summary>
    /// A byte-identical payload from the same BRP within 24 hours [F02-R07]. Decided at receipt,
    /// before anything is enqueued, so RECEIVED is the only status this is reachable from.
    /// </summary>
    public void MarkDuplicate(DateTimeOffset at)
    {
        if (Status is not InboundMessageStatus.Received)
        {
            throw new InvalidOperationException(
                $"An inbound message in status {Wire(Status)} cannot be marked duplicate.");
        }

        Status = InboundMessageStatus.Duplicate;
        ProcessedAt = at;
    }

    /// <summary>
    /// The database spelling, so an exception message names the value an operator would see in the
    /// column and on the employee screen rather than the C# member name.
    /// </summary>
    private static string Wire(InboundMessageStatus status) => status switch
    {
        InboundMessageStatus.Received => "RECEIVED",
        InboundMessageStatus.Processing => "PROCESSING",
        InboundMessageStatus.Processed => "PROCESSED",
        InboundMessageStatus.Failed => "FAILED",
        InboundMessageStatus.Duplicate => "DUPLICATE",
        _ => status.ToString(),
    };

    private static string? Blank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS.

- [ ] **Step 5: Mutate the replay transition**

The transition that would be easiest to get wrong is `Processed → Processing`: a naive
implementation writes `if (Status is not InboundMessageStatus.Received) throw`, which reads
correctly and silently makes replay impossible. Make that mutation:

```csharp
    public void BeginProcessing()
    {
        // MUTATION - the "naive" guard
        if (Status is not InboundMessageStatus.Received)
        {
            throw new InvalidOperationException(
                $"An inbound message in status {Wire(Status)} cannot begin processing.");
        }
        ...
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo --filter "FullyQualifiedName~InboundMessageTests"`
Expected: FAIL — **two** tests go red, and both by name:
`A_processed_message_can_be_processed_again_because_replay_reruns_it` and
`A_failed_message_can_be_processed_again_once_the_cause_is_fixed`, each with
`System.InvalidOperationException: An inbound message in status PROCESSED cannot begin processing.`
(and `… FAILED …`).

⚠ **Check `A_duplicate_is_never_processed_because_nothing_was_ever_enqueued` still passes.** If it
goes red too, the mutation was applied somewhere else. The point of this mutation is that the
duplicate case is the *easy neighbouring* one — it passes under both implementations — and the
replay cases are the ones the guard is actually for.

Restore the three-arm guard and re-run:

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Metering/InboundMessage.cs \
        tests/PeakPower.Domain.Tests/Metering/InboundMessageTests.cs
git commit -m "feat(domain): add InboundMessage, the stored raw document

Status is RECEIVED at the moment the 200 is written, never PROCESSED - design section 7.2
asserts that at that moment, not afterwards. The PROCESSED-to-PROCESSING and
FAILED-to-PROCESSING transitions are the replay path [F02-R27] and are verified by
mutation: the naive 'only from RECEIVED' guard makes both replay tests go red while the
duplicate test stays green, which is why the duplicate case is not the one to mutate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `IntervalDataVersion` and `IntervalReading`

The two tables the whole slice exists to write correctly.

`IntervalDataVersion` is one version of one direction of one day, from one document `[DEC-07]`,
`[F02-R16]`. **`ReceivedAt` is the ordering key** — design §4.2: the current version is always the
last one *received*, never the newest by `CreatedDateTime`. The domain does not decide supersession
(plan 3's apply transaction does, inside the advisory lock); what the domain provides is
`Supersede()`, which sets `IsCurrent = false` and **never deletes** `[F02-R18]`, and the property
that makes the ordering question answerable.

`IntervalReading` is one point. Immutable once written: a correction is a new version, never an
`UPDATE`. `QuantityKwh >= 0` on **both** directions — consumption and production remain two
separate, non-negative series `[AS-05]`, and net usage is derived per interval and never stored as a
signed source series. A negative reading means a direction was mapped wrong, which under `[DEC-22]`
is a wrong invoice, not a wrong chart.

⚠ **`FromBrpFeed` is the only factory.** `IntervalDataVersionSource.Manual` is storable and
unreachable in slice 2 (`[F02-R36]`'s screens are deferred), and adding a `FromManualEntry` factory
nothing calls would be dead code that looks like a feature. Task 18 proves `MANUAL` is storable with
a raw-SQL insert instead, which is the honest way to test a value no code path can reach.

⚠ **`IntervalStart` is a stored column, resolved by `IMarketCalendar.IntervalStart`** (contract
§7.5, plan 1's). Storing it is what lets the `market.calendar_interval` spine be deferred — the
spine becomes a later pure join optimisation rather than a prerequisite. The domain accepts the
resolved instant; it never computes one, because architecture fact 5 confines the DST mapping to
`PeakPower.Infrastructure.Time` and a second copy would be a second answer.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/IntervalDataVersion.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/IntervalReading.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Metering/IntervalDataVersionTests.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Metering/IntervalReadingTests.cs`

**Interfaces:**
- Consumes: `Result<T>`, `IntervalDirection`, `IntervalDataVersionSource`.
- Produces:
  - `IntervalDataVersion` with `Id`, `MeteringPointId`, `CustomerId`, `DeliveryDate`, `Direction`,
    `Source`, `DocumentId`, `DocumentCreated`, `ReceivedAt`, `InboundMessageId`, `CorrelationId`,
    `IntervalCount`, `IsCurrent`, `CreatedAt`.
  - `IntervalDataVersion.FromBrpFeed(Guid meteringPointId, Guid customerId, DateOnly deliveryDate, IntervalDirection direction, string documentId, DateTimeOffset documentCreated, DateTimeOffset receivedAt, Guid inboundMessageId, Guid correlationId, short intervalCount)` → `Result<IntervalDataVersion>`
  - `void Supersede()`
  - `IntervalDataVersion.ValidIntervalCounts` = `[92, 96, 100]`
  - `IntervalReading` with `VersionId`, `DeliveryDate`, `CustomerId`, `Pos`, `IntervalStart`,
    `QuantityKwh`.
  - `IntervalReading.Create(Guid versionId, DateOnly deliveryDate, Guid customerId, short pos, DateTimeOffset intervalStart, decimal quantityKwh)` → `Result<IntervalReading>`
  - `IntervalReading.MinimumPos` = `1`, `IntervalReading.MaximumPos` = `100`.

- [ ] **Step 1: Write the failing tests**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Metering/IntervalDataVersionTests.cs`:

```csharp
using Shouldly;
using Xunit;
using PeakPower.Domain.Common;
using PeakPower.Domain.Metering;

namespace PeakPower.Domain.Tests.Metering;

public sealed class IntervalDataVersionTests
{
    private static readonly Guid MeteringPointId = Guid.Parse("0199a1a0-0000-7000-8000-000000000101");
    private static readonly Guid CustomerId = Guid.Parse("0199a1a0-0000-7000-8000-00000000c001");
    private static readonly Guid InboundMessageId = Guid.Parse("0199a1a0-0000-7000-8000-00000000d001");
    private static readonly Guid CorrelationId = Guid.Parse("0199a1a0-0000-7000-8000-00000000c0d1");
    private static readonly DateOnly DeliveryDate = new(2026, 8, 12);
    private static readonly DateTimeOffset DocumentCreated =
        new(2026, 8, 13, 3, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset ReceivedAt =
        new(2026, 8, 13, 4, 2, 11, TimeSpan.Zero);

    private static Result<IntervalDataVersion> FromFeed(
        IntervalDirection direction = IntervalDirection.Consumption,
        string documentId = "b6b2f0aa-7a3d-4f5e-9a1c-2f2b0a44d1c8",
        short intervalCount = 96,
        DateTimeOffset? documentCreated = null,
        DateTimeOffset? receivedAt = null,
        Guid? inboundMessageId = null,
        Guid? customerId = null) =>
        IntervalDataVersion.FromBrpFeed(
            MeteringPointId,
            customerId ?? CustomerId,
            DeliveryDate,
            direction,
            documentId,
            documentCreated ?? DocumentCreated,
            receivedAt ?? ReceivedAt,
            inboundMessageId ?? InboundMessageId,
            CorrelationId,
            intervalCount);

    [Fact]
    public void A_version_from_the_feed_is_current_and_carries_its_document()
    {
        var version = FromFeed().Value;

        version.Id.ShouldNotBe(Guid.Empty);
        version.MeteringPointId.ShouldBe(MeteringPointId);
        version.CustomerId.ShouldBe(CustomerId);
        version.DeliveryDate.ShouldBe(DeliveryDate);
        version.Direction.ShouldBe(IntervalDirection.Consumption);
        version.Source.ShouldBe(IntervalDataVersionSource.BrpFeed);
        version.DocumentId.ShouldBe("b6b2f0aa-7a3d-4f5e-9a1c-2f2b0a44d1c8");
        version.DocumentCreated.ShouldBe(DocumentCreated);
        version.ReceivedAt.ShouldBe(ReceivedAt);
        version.InboundMessageId.ShouldBe(InboundMessageId);
        version.CorrelationId.ShouldBe(CorrelationId);
        version.IntervalCount.ShouldBe((short)96);
        version.IsCurrent.ShouldBeTrue();
    }

    /// <summary>
    /// S2-D1. The reading belongs to whoever held the EAN on the delivery date, which the
    /// EAN_VALIDITY quarantine rule [F02-R15] has already decided by the time a version is
    /// written. Denormalising it here is what makes both row-level-security coverage guards SEE
    /// this table at all: they discover by a property name ending in CustomerId, so a table keyed
    /// only on metering_point_id is invisible to them and they report full coverage over it.
    /// </summary>
    [Fact]
    public void A_version_without_a_customer_is_rejected_because_the_guards_discover_by_that_column()
    {
        FromFeed(customerId: Guid.Empty).Error
            .ShouldBe("An interval data version must name the customer that held the EAN on the delivery date.");
    }

    [Fact]
    public void A_version_without_a_metering_point_is_rejected()
    {
        IntervalDataVersion.FromBrpFeed(
            Guid.Empty, CustomerId, DeliveryDate, IntervalDirection.Consumption,
            "doc", DocumentCreated, ReceivedAt, InboundMessageId, CorrelationId, 96)
            .Error.ShouldBe("An interval data version must name a metering point.");
    }

    [Fact]
    public void A_feed_version_without_its_message_is_rejected()
    {
        // ck_idv_brp_feed_has_message in migration 9 says the same thing at the database. [DEC-143]
        FromFeed(inboundMessageId: Guid.Empty).Error
            .ShouldBe("A BRP_FEED interval data version must name the inbound message it came from.");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void A_feed_version_without_a_document_identification_is_rejected(string documentId)
    {
        FromFeed(documentId: documentId).Error
            .ShouldBe("A BRP_FEED interval data version must carry its document identification.");
    }

    [Theory]
    [InlineData((short)0)]
    [InlineData((short)95)]
    [InlineData((short)97)]
    [InlineData((short)-96)]
    public void An_interval_count_that_is_not_92_96_or_100_is_rejected(short intervalCount)
    {
        // The three lengths an Amsterdam calendar day can have: 92 on the spring-forward Sunday,
        // 100 on the autumn fall-back Sunday, 96 otherwise. A 96-point document is REJECTED for
        // both DST dates, which is integration-spec section 8.2's point-count rule, and this is
        // the last place a wrong count can be stopped before it reaches a column CHECK.
        FromFeed(intervalCount: intervalCount).Error
            .ShouldBe("An interval data version must declare 92, 96 or 100 intervals.");
    }

    [Theory]
    [InlineData((short)92)]
    [InlineData((short)96)]
    [InlineData((short)100)]
    public void The_three_legal_day_lengths_are_accepted(short intervalCount)
    {
        FromFeed(intervalCount: intervalCount).IsSuccess.ShouldBeTrue();
    }

    [Fact]
    public void Superseding_marks_the_version_not_current_and_deletes_nothing()
    {
        // [F02-R18]: a superseded version remains queryable. Nothing in this aggregate can remove
        // a version, and design section 7.5 asserts the superseded row is still readable.
        var version = FromFeed().Value;

        version.Supersede();

        version.IsCurrent.ShouldBeFalse();
        version.DocumentId.ShouldBe("b6b2f0aa-7a3d-4f5e-9a1c-2f2b0a44d1c8");
        version.ReceivedAt.ShouldBe(ReceivedAt);
    }

    [Fact]
    public void Superseding_twice_is_harmless()
    {
        // The apply transaction supersedes the previous current version before inserting the new
        // one, inside an advisory lock. A retry that reached this twice must not throw: the
        // ux_idv_current partial unique index is what actually enforces "exactly one current", and
        // this method is not the place to re-litigate it.
        var version = FromFeed().Value;

        version.Supersede();
        version.Supersede();

        version.IsCurrent.ShouldBeFalse();
    }

    /// <summary>
    /// Design section 4.2, stated as a property of the aggregate rather than of the apply
    /// transaction: ReceivedAt is the ordering key, and DocumentCreated is NOT. This test does not
    /// prove supersession - plan 3's out-of-order pair test does, against a database - but it does
    /// pin that a version whose document is OLDER can be received LATER, which is the case the
    /// whole rule exists for and which a "received_at >= document_created" invariant would forbid.
    /// </summary>
    [Fact]
    public void A_correction_created_earlier_than_the_version_it_corrects_is_still_storable()
    {
        var late = FromFeed(
            documentCreated: new DateTimeOffset(2026, 8, 13, 1, 0, 0, TimeSpan.Zero),
            receivedAt: new DateTimeOffset(2026, 8, 13, 9, 0, 0, TimeSpan.Zero));

        late.IsSuccess.ShouldBeTrue();
        late.Value.DocumentCreated.ShouldBeLessThan(late.Value.ReceivedAt);

        var earlier = FromFeed(
            documentCreated: new DateTimeOffset(2026, 8, 13, 8, 0, 0, TimeSpan.Zero),
            receivedAt: new DateTimeOffset(2026, 8, 13, 5, 0, 0, TimeSpan.Zero));

        earlier.IsSuccess.ShouldBeTrue(
            "receipt order governs, so a document created after the moment it was received is odd " +
            "but storable - a clock-skewed sender must not be a rejected document");
    }

    [Fact]
    public void The_three_valid_interval_counts_are_exposed_as_a_named_set()
    {
        IntervalDataVersion.ValidIntervalCounts.ShouldBe(new short[] { 92, 96, 100 });
    }
}
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Metering/IntervalReadingTests.cs`:

```csharp
using Shouldly;
using Xunit;
using PeakPower.Domain.Common;
using PeakPower.Domain.Metering;

namespace PeakPower.Domain.Tests.Metering;

public sealed class IntervalReadingTests
{
    private static readonly Guid VersionId = Guid.Parse("0199a1a0-0000-7000-8000-00000000f001");
    private static readonly Guid CustomerId = Guid.Parse("0199a1a0-0000-7000-8000-00000000c001");
    private static readonly DateOnly DeliveryDate = new(2026, 8, 12);
    private static readonly DateTimeOffset IntervalStart =
        new(2026, 8, 12, 0, 0, 0, TimeSpan.FromHours(2));

    private static Result<IntervalReading> Create(
        short pos = 1,
        decimal quantityKwh = 180.000m,
        Guid? customerId = null,
        Guid? versionId = null,
        DateTimeOffset? intervalStart = null) =>
        IntervalReading.Create(
            versionId ?? VersionId,
            DeliveryDate,
            customerId ?? CustomerId,
            pos,
            intervalStart ?? IntervalStart,
            quantityKwh);

    [Fact]
    public void A_reading_carries_its_version_its_customer_and_its_resolved_instant()
    {
        var reading = Create().Value;

        reading.VersionId.ShouldBe(VersionId);
        reading.DeliveryDate.ShouldBe(DeliveryDate);
        reading.CustomerId.ShouldBe(CustomerId);
        reading.Pos.ShouldBe((short)1);
        reading.IntervalStart.ShouldBe(IntervalStart);
        reading.QuantityKwh.ShouldBe(180.000m);
    }

    /// <summary>
    /// The interval_start column is what lets the market.calendar_interval spine (35 040 rows a
    /// year) be deferred to a later pure join optimisation. It is RESOLVED by
    /// IMarketCalendar.IntervalStart and handed in - this aggregate never computes one, because
    /// architecture fact 5 confines the DST mapping to PeakPower.Infrastructure.Time and a second
    /// copy of it would be a second answer.
    /// </summary>
    [Fact]
    public void The_autumn_duplicate_hours_two_passes_are_two_different_instants()
    {
        var firstPass = Create(
            pos: 9,
            intervalStart: new DateTimeOffset(2026, 10, 25, 2, 0, 0, TimeSpan.FromHours(2))).Value;
        var secondPass = Create(
            pos: 13,
            intervalStart: new DateTimeOffset(2026, 10, 25, 2, 0, 0, TimeSpan.FromHours(1))).Value;

        firstPass.IntervalStart.ShouldNotBe(secondPass.IntervalStart);
        (secondPass.IntervalStart - firstPass.IntervalStart).ShouldBe(TimeSpan.FromHours(1));
    }

    [Theory]
    [InlineData((short)0)]
    [InlineData((short)-1)]
    [InlineData((short)101)]
    public void A_position_outside_one_to_a_hundred_is_rejected(short pos)
    {
        // 100 is the cap because that is the autumn DST day's length and the XSD's maxInclusive
        // (integration-spec section 9 row 3). The column CHECK says the same thing.
        Create(pos: pos).Error.ShouldBe("An interval reading position must be between 1 and 100.");
    }

    [Theory]
    [InlineData((short)1)]
    [InlineData((short)96)]
    [InlineData((short)100)]
    public void The_boundary_positions_are_accepted(short pos)
    {
        Create(pos: pos).IsSuccess.ShouldBeTrue();
    }

    /// <summary>
    /// [AS-05] and position-and-coverage section 2.1: consumption and production remain two
    /// separate, NON-NEGATIVE series. netUsage is computed from them per interval, and neither
    /// series is ever overwritten with a signed value. A negative reading means a direction was
    /// mapped wrong, which under [DEC-22] is a wrong invoice rather than a wrong chart.
    /// </summary>
    [Fact]
    public void A_negative_quantity_is_rejected_on_both_directions()
    {
        Create(quantityKwh: -0.001m).Error.ShouldBe(
            "An interval reading quantity must not be negative. Consumption and production are " +
            "two separate non-negative series [AS-05]; net usage is derived, never stored signed.");
    }

    [Fact]
    public void A_measured_zero_is_accepted_because_zero_is_a_measurement()
    {
        Create(quantityKwh: 0m).IsSuccess.ShouldBeTrue();
    }

    [Fact]
    public void A_reading_without_a_version_is_rejected()
    {
        Create(versionId: Guid.Empty).Error
            .ShouldBe("An interval reading must belong to a version.");
    }

    [Fact]
    public void A_reading_without_a_customer_is_rejected()
    {
        Create(customerId: Guid.Empty).Error
            .ShouldBe("An interval reading must name the customer that held the EAN on the delivery date.");
    }

    [Fact]
    public void The_position_bounds_are_exposed_as_named_constants()
    {
        IntervalReading.MinimumPos.ShouldBe((short)1);
        IntervalReading.MaximumPos.ShouldBe((short)100);
    }
}
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: FAIL to build with
`error CS0246: The type or namespace name 'IntervalDataVersion' could not be found` and
`error CS0246: The type or namespace name 'IntervalReading' could not be found`.

- [ ] **Step 3: Write `IntervalDataVersion`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/IntervalDataVersion.cs`:

```csharp
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Metering;

/// <summary>
/// One version of one direction of one day, from one document. [DEC-07], [F02-R16]
/// <para>
/// ⚠ <see cref="ReceivedAt"/> is THE ORDERING KEY, not <see cref="DocumentCreated"/>. Design
/// section 4.2: the current version of a (metering point, delivery date, direction) is always the
/// LAST ONE RECEIVED. Both receipt orders of the same pair therefore leave the second-received
/// version current, and a correction whose CreatedDateTime is earlier still supersedes. The rule
/// is enforced by the ux_idv_current partial unique index and by plan 3's apply transaction; this
/// aggregate's job is to carry the key that makes the question answerable.
/// </para>
/// <para>
/// A correction is a NEW version, never an UPDATE. <see cref="Supersede"/> flips a flag and
/// deletes nothing [F02-R18], so a superseded version stays queryable.
/// </para>
/// </summary>
public sealed class IntervalDataVersion
{
    /// <summary>
    /// 92 on the spring-forward Sunday, 100 on the autumn fall-back Sunday, 96 otherwise. The
    /// column CHECK in migration 9 carries the same set; this is the readable half of it.
    /// </summary>
    public static readonly short[] ValidIntervalCounts = [92, 96, 100];

    /// <summary>EF Core materialises through this; application code uses <see cref="FromBrpFeed"/>.</summary>
    private IntervalDataVersion()
    {
    }

    public Guid Id { get; private set; }

    public Guid MeteringPointId { get; private set; }

    /// <summary>
    /// ⚠ S2-D1. Denormalised and NOT NULL: resolved at apply time from the metering point's
    /// validity interval covering the delivery date. Two reasons, and the second is the sharper
    /// one. (1) Both row-level-security coverage guards discover a table by a property name ending
    /// in "CustomerId", so a table keyed only on metering_point_id is INVISIBLE to them and they
    /// report full coverage over it. (2) Migration 2's ALTER DEFAULT PRIVILEGES grants full DML on
    /// every new metering table to app_customer_role the instant CREATE TABLE runs, so a policy
    /// keyed on this column is what stands between a customer connection and every tenant's data.
    /// </summary>
    public Guid CustomerId { get; private set; }

    public DateOnly DeliveryDate { get; private set; }

    public IntervalDirection Direction { get; private set; }

    /// <summary>BRP_FEED or MANUAL. [DEC-143], S2-D2.</summary>
    public IntervalDataVersionSource Source { get; private set; }

    /// <summary>The PVNed DocumentIdentification. Null only when <see cref="Source"/> is MANUAL.</summary>
    public string? DocumentId { get; private set; }

    /// <summary>
    /// The document's own CreatedDateTime. ⚠ Recorded, and deliberately NOT the ordering key -
    /// see this type's remarks. Null only when <see cref="Source"/> is MANUAL.
    /// </summary>
    public DateTimeOffset? DocumentCreated { get; private set; }

    /// <summary>
    /// ⚠ THE ORDERING KEY. The MESSAGE's receipt time, never now() at apply time: a job that ran
    /// late must not overtake a message that arrived after it.
    /// </summary>
    public DateTimeOffset ReceivedAt { get; private set; }

    /// <summary>Null only when <see cref="Source"/> is MANUAL. [DEC-143]</summary>
    public Guid? InboundMessageId { get; private set; }

    /// <summary>Copied from the message, so a version can be traced back to the request that made it.</summary>
    public Guid CorrelationId { get; private set; }

    /// <summary>92, 96 or 100. See <see cref="ValidIntervalCounts"/>.</summary>
    public short IntervalCount { get; private set; }

    public bool IsCurrent { get; private set; }

    /// <summary>
    /// Store-generated: the column is <c>NOT NULL DEFAULT now()</c> and this factory may not read a
    /// clock. Distinct from <see cref="ReceivedAt"/> on purpose - one is when the document arrived,
    /// the other is when this row was written, and a replay makes them differ.
    /// </summary>
    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>
    /// The only factory slice 2 has. IntervalDataVersionSource.Manual is storable and unreachable:
    /// [F02-R36]'s manual-entry screens are deferred, and a FromManualEntry factory nothing calls
    /// would be dead code that looks like a feature. That the value IS storable is proven by a
    /// raw-SQL insert in IngestionSchemaTests, which is the honest way to test a value no code
    /// path can reach.
    /// </summary>
    public static Result<IntervalDataVersion> FromBrpFeed(
        Guid meteringPointId,
        Guid customerId,
        DateOnly deliveryDate,
        IntervalDirection direction,
        string documentId,
        DateTimeOffset documentCreated,
        DateTimeOffset receivedAt,
        Guid inboundMessageId,
        Guid correlationId,
        short intervalCount)
    {
        if (meteringPointId == Guid.Empty)
        {
            return Result<IntervalDataVersion>.Failure(
                "An interval data version must name a metering point.");
        }

        if (customerId == Guid.Empty)
        {
            return Result<IntervalDataVersion>.Failure(
                "An interval data version must name the customer that held the EAN on the delivery date.");
        }

        if (string.IsNullOrWhiteSpace(documentId))
        {
            return Result<IntervalDataVersion>.Failure(
                "A BRP_FEED interval data version must carry its document identification.");
        }

        if (inboundMessageId == Guid.Empty)
        {
            return Result<IntervalDataVersion>.Failure(
                "A BRP_FEED interval data version must name the inbound message it came from.");
        }

        if (correlationId == Guid.Empty)
        {
            return Result<IntervalDataVersion>.Failure(
                "An interval data version must carry a correlation id.");
        }

        if (!ValidIntervalCounts.Contains(intervalCount))
        {
            return Result<IntervalDataVersion>.Failure(
                "An interval data version must declare 92, 96 or 100 intervals.");
        }

        return Result<IntervalDataVersion>.Success(new IntervalDataVersion
        {
            Id = Guid.CreateVersion7(),
            MeteringPointId = meteringPointId,
            CustomerId = customerId,
            DeliveryDate = deliveryDate,
            Direction = direction,
            Source = IntervalDataVersionSource.BrpFeed,
            DocumentId = documentId.Trim(),
            DocumentCreated = documentCreated,
            ReceivedAt = receivedAt,
            InboundMessageId = inboundMessageId,
            CorrelationId = correlationId,
            IntervalCount = intervalCount,
            IsCurrent = true,
        });
    }

    /// <summary>
    /// Marks this version no longer current. NEVER deletes [F02-R18] - a superseded version stays
    /// queryable, which is what makes "which version was the invoice raised on" answerable.
    /// <para>
    /// Idempotent on purpose. The apply transaction supersedes the previous current version before
    /// inserting the new one, inside a per-(point, date) advisory lock, and ux_idv_current is what
    /// actually enforces "exactly one current". A retry that reached this twice must not throw.
    /// </para>
    /// </summary>
    public void Supersede() => IsCurrent = false;
}
```

- [ ] **Step 4: Write `IntervalReading`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/IntervalReading.cs`:

```csharp
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Metering;

/// <summary>
/// One point. Immutable once written: a correction is a new <see cref="IntervalDataVersion"/> with
/// its own readings, never an UPDATE of these.
/// <para>
/// The table is range-partitioned on <see cref="DeliveryDate"/>, which is why the delivery date is
/// part of the key and carried on the row rather than reached through the version.
/// </para>
/// </summary>
public sealed class IntervalReading
{
    /// <summary>1-based, like the PVNed <c>Pos</c> element.</summary>
    public const short MinimumPos = 1;

    /// <summary>
    /// 100, which is the autumn fall-back Sunday's length and the reconstructed XSD's
    /// maxInclusive (integration-spec section 9 row 3, where the guide's "max 6 characters" is
    /// read as the looser of the two).
    /// </summary>
    public const short MaximumPos = 100;

    /// <summary>EF Core materialises through this; application code uses <see cref="Create"/>.</summary>
    private IntervalReading()
    {
    }

    public Guid VersionId { get; private set; }

    /// <summary>The partition key, and part of the primary key.</summary>
    public DateOnly DeliveryDate { get; private set; }

    /// <summary>⚠ S2-D1. See <see cref="IntervalDataVersion.CustomerId"/> for the full argument.</summary>
    public Guid CustomerId { get; private set; }

    public short Pos { get; private set; }

    /// <summary>
    /// The Amsterdam-local start instant, resolved by <c>IMarketCalendar.IntervalStart</c> and
    /// handed in. Storing it is what lets the market.calendar_interval spine (35 040 rows a year)
    /// be deferred - the spine becomes a later pure join optimisation rather than a prerequisite.
    /// <para>
    /// ⚠ This aggregate never COMPUTES one. Architecture fact 5 is IL-enforced and confines clock
    /// and calendar work to PeakPower.Infrastructure.Time, and the autumn duplicate-hour mapping
    /// (Pos 9-12 the first pass, Pos 13-16 the second) is the single most likely silent
    /// correctness bug in this slice. One source of truth, read by parser, rollup and chart alike.
    /// </para>
    /// </summary>
    public DateTimeOffset IntervalStart { get; private set; }

    /// <summary>
    /// numeric(14,3), and never negative on either direction. [AS-05]: consumption and production
    /// remain two separate non-negative series, and net usage is derived per interval rather than
    /// stored as a signed source series (position-and-coverage section 2.1).
    /// </summary>
    public decimal QuantityKwh { get; private set; }

    public static Result<IntervalReading> Create(
        Guid versionId,
        DateOnly deliveryDate,
        Guid customerId,
        short pos,
        DateTimeOffset intervalStart,
        decimal quantityKwh)
    {
        if (versionId == Guid.Empty)
        {
            return Result<IntervalReading>.Failure("An interval reading must belong to a version.");
        }

        if (customerId == Guid.Empty)
        {
            return Result<IntervalReading>.Failure(
                "An interval reading must name the customer that held the EAN on the delivery date.");
        }

        if (pos is < MinimumPos or > MaximumPos)
        {
            return Result<IntervalReading>.Failure(
                $"An interval reading position must be between {MinimumPos} and {MaximumPos}.");
        }

        if (quantityKwh < 0m)
        {
            return Result<IntervalReading>.Failure(
                "An interval reading quantity must not be negative. Consumption and production are " +
                "two separate non-negative series [AS-05]; net usage is derived, never stored signed.");
        }

        return Result<IntervalReading>.Success(new IntervalReading
        {
            VersionId = versionId,
            DeliveryDate = deliveryDate,
            CustomerId = customerId,
            Pos = pos,
            IntervalStart = intervalStart,
            QuantityKwh = quantityKwh,
        });
    }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS.

- [ ] **Step 6: Mutate the non-negative quantity rule**

This is the guard that stops a mis-mapped direction becoming a wrong invoice. Change the check in
`IntervalReading.Create` to the plausible-looking wrong thing — allow a negative quantity on
production, on the reasoning that "production is feed-in, so it is negative":

```csharp
        // MUTATION
        if (quantityKwh < 0m && false)
        {
            return Result<IntervalReading>.Failure(...);
        }
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo --filter "FullyQualifiedName~A_negative_quantity_is_rejected_on_both_directions"`
Expected: FAIL — `A_negative_quantity_is_rejected_on_both_directions` fails with
`result.Error should be "An interval reading quantity must not be negative. …" but was ""`.

⚠ Check `A_measured_zero_is_accepted_because_zero_is_a_measurement` still passes: it does under
both implementations, and mutating a rule that also breaks the zero case would prove the wrong
thing.

Restore the check and re-run:

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Metering/IntervalDataVersion.cs \
        src/Core/PeakPower.Domain/Metering/IntervalReading.cs \
        tests/PeakPower.Domain.Tests/Metering/IntervalDataVersionTests.cs \
        tests/PeakPower.Domain.Tests/Metering/IntervalReadingTests.cs
git commit -m "feat(domain): add IntervalDataVersion and IntervalReading

ReceivedAt is the ordering key and DocumentCreated is not - design section 4.2. Supersede
flips a flag and deletes nothing [F02-R18], and is idempotent because ux_idv_current is
what actually enforces exactly-one-current. Quantities are non-negative on BOTH directions
[AS-05]; the guard is verified by mutation, with the measured-zero case checked to stay
green so the mutation proves the rule and not its neighbour.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `MeteringPointDayState` and `DailyPosition`

`MeteringPointDayState` is the materialised data state per (metering point, delivery date)
`[F02-R22]`. Plan 5 owns the *rule* that computes a state; this task owns the shape it is stored
in — including `ProductionIsDeclaredZero`, which is what lets the chart draw a `NEVER` connection's
production line as a **stated zero traceable to its source, setter and date** `[F02-R33]`,
`[F01-R40]`, rather than as an absence.

`DailyPosition` is the daily rollup, and design §4.1 is the reason it has the columns it has. The
naive reading says a daily total is enough: `Σ(cᵢ − pᵢ)` is arithmetically identical to `Σc − Σp`,
so the daily *net* figure survives a daily-totals rollup intact. **What does not survive is
everything that clamps per interval.** Phase 2's coverage maths is `max(U, 0)` per interval, and
`[DEC-23]` settles the negative part as a **separate sale line, never netted against purchase
lines** — uncovered and surplus volumes occur at different times and therefore at different prices.

The worked case, which becomes a fixture here and a mutation target in plan 5: a day of two
intervals, consumption `[10, 0]`, production `[0, 5]`.

| | per interval | from daily totals |
| --- | --- | --- |
| `U = c − p` | `[10, −5]` | — |
| `NetUsageKwh` = `ΣU` | **5** | `Σc − Σp` = **5** ✓ agrees |
| `OfftakeKwh` = `Σ max(U, 0)` | **10** | `max(5, 0)` = **5** ✗ |
| `ExportKwh` = `Σ |min(U, 0)|` | **5** | `max(−5, 0)` = **0** ✗ |

⚠ **`OfftakeKwh` is NOT `max(NetUsageKwh, 0)` and `ExportKwh` is NOT `max(−NetUsageKwh, 0)`.**
This aggregate cannot enforce that — it receives numbers, and both the right and the wrong
computation produce a well-formed row. Plan 5's mutation test against the fixture above is what
proves the accumulation, and design §10 requires it explicitly.

What this aggregate **can** enforce is the accounting identity `Offtake − Export == NetUsage`, which
holds for both computations (10 − 5 = 5, and 5 − 0 = 5) — so it is a genuine invariant and
**deliberately not** the §4.1 guard. It is written down here with that caveat so nobody later reads
it as one and stops looking for the real test.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/MeteringPointDayState.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/DailyPosition.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Metering/MeteringPointDayStateTests.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Metering/DailyPositionTests.cs`

**Interfaces:**
- Consumes: `Result<T>`, `MeteringDayState`.
- Produces:
  - `MeteringPointDayState` with `MeteringPointId`, `DeliveryDate`, `CustomerId`, `State`,
    `ExpectedIntervalCount`, `ConsumptionComplete`, `ProductionComplete`,
    `ProductionIsDeclaredZero`, `FinalisedAt`, `LastCorrectedAt`, `ComputedAt`.
  - `MeteringPointDayState.Compute(Guid meteringPointId, DateOnly deliveryDate, Guid customerId, MeteringDayState state, short expectedIntervalCount, bool consumptionComplete, bool productionComplete, bool productionIsDeclaredZero, DateTimeOffset? finalisedAt, DateTimeOffset? lastCorrectedAt, DateTimeOffset computedAt)` → `Result<MeteringPointDayState>`
  - `Result<MeteringPointDayState> Recompute(MeteringDayState state, short expectedIntervalCount, bool consumptionComplete, bool productionComplete, bool productionIsDeclaredZero, DateTimeOffset? finalisedAt, DateTimeOffset? lastCorrectedAt, DateTimeOffset computedAt)`
  - `DailyPosition` with `MeteringPointId`, `DeliveryDate`, `CustomerId`, `ConsumptionKwh`,
    `ProductionKwh`, `NetUsageKwh`, `OfftakeKwh`, `ExportKwh`, `DataState`, `SourceVersionIds`,
    `ComputedAt`.
  - `DailyPosition.Roll(Guid meteringPointId, DateOnly deliveryDate, Guid customerId, decimal consumptionKwh, decimal productionKwh, decimal netUsageKwh, decimal offtakeKwh, decimal exportKwh, MeteringDayState dataState, IReadOnlyList<Guid> sourceVersionIds, DateTimeOffset computedAt)` → `Result<DailyPosition>`
  - `Result<DailyPosition> Recompute(decimal consumptionKwh, decimal productionKwh, decimal netUsageKwh, decimal offtakeKwh, decimal exportKwh, MeteringDayState dataState, IReadOnlyList<Guid> sourceVersionIds, DateTimeOffset computedAt)`

- [ ] **Step 1: Write the failing tests**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Metering/MeteringPointDayStateTests.cs`:

```csharp
using Shouldly;
using Xunit;
using PeakPower.Domain.Common;
using PeakPower.Domain.Metering;

namespace PeakPower.Domain.Tests.Metering;

public sealed class MeteringPointDayStateTests
{
    private static readonly Guid MeteringPointId = Guid.Parse("0199a1a0-0000-7000-8000-000000000101");
    private static readonly Guid CustomerId = Guid.Parse("0199a1a0-0000-7000-8000-00000000c001");
    private static readonly DateOnly DeliveryDate = new(2026, 8, 12);
    private static readonly DateTimeOffset ComputedAt =
        new(2026, 8, 13, 4, 2, 12, TimeSpan.Zero);

    private static Result<MeteringPointDayState> Compute(
        MeteringDayState state = MeteringDayState.Provisional,
        short expectedIntervalCount = 96,
        bool consumptionComplete = true,
        bool productionComplete = true,
        bool productionIsDeclaredZero = false,
        DateTimeOffset? finalisedAt = null,
        DateTimeOffset? lastCorrectedAt = null,
        Guid? customerId = null) =>
        MeteringPointDayState.Compute(
            MeteringPointId,
            DeliveryDate,
            customerId ?? CustomerId,
            state,
            expectedIntervalCount,
            consumptionComplete,
            productionComplete,
            productionIsDeclaredZero,
            finalisedAt,
            lastCorrectedAt,
            ComputedAt);

    [Fact]
    public void A_day_state_carries_its_point_its_date_and_its_customer()
    {
        var day = Compute().Value;

        day.MeteringPointId.ShouldBe(MeteringPointId);
        day.DeliveryDate.ShouldBe(DeliveryDate);
        day.CustomerId.ShouldBe(CustomerId);
        day.State.ShouldBe(MeteringDayState.Provisional);
        day.ExpectedIntervalCount.ShouldBe((short)96);
        day.ConsumptionComplete.ShouldBeTrue();
        day.ProductionComplete.ShouldBeTrue();
        day.ProductionIsDeclaredZero.ShouldBeFalse();
        day.FinalisedAt.ShouldBeNull();
        day.LastCorrectedAt.ShouldBeNull();
        day.ComputedAt.ShouldBe(ComputedAt);
    }

    /// <summary>
    /// [F02-R33]: where production_expectation is NEVER, production for every interval is a
    /// DECLARED zero taken from master data, not an absence inferred as zero. This flag is what
    /// the chart reads to draw the fifth of the five data-state treatments - a stated zero
    /// traceable to its source, setter and date [F01-R40] - rather than a gap or an unlabelled
    /// flat line. Complete WITHOUT a production series is exactly the case.
    /// </summary>
    [Fact]
    public void A_declared_zero_day_is_production_complete_with_no_production_series_at_all()
    {
        var day = Compute(
            state: MeteringDayState.Provisional,
            consumptionComplete: true,
            productionComplete: true,
            productionIsDeclaredZero: true).Value;

        day.ProductionIsDeclaredZero.ShouldBeTrue();
        day.ProductionComplete.ShouldBeTrue();
        day.State.ShouldBe(MeteringDayState.Provisional);
    }

    /// <summary>
    /// ⚠ integration-spec section 8.3 names the prohibited implementation literally: "This check
    /// must not be written as directions.Count == 2". The aggregate cannot enforce the rule - it
    /// receives two booleans - but it CAN refuse the one combination the wrong implementation
    /// would produce and the right one never does: a day both complete and declared-zero cannot be
    /// PARTIAL, because a declared zero is a completed production series.
    /// </summary>
    [Fact]
    public void A_complete_declared_zero_day_cannot_be_recorded_PARTIAL()
    {
        Compute(
            state: MeteringDayState.Partial,
            consumptionComplete: true,
            productionComplete: true,
            productionIsDeclaredZero: true)
            .Error.ShouldBe(
                "A day whose consumption and production are both complete cannot be PARTIAL. A " +
                "declared zero IS a complete production series [F02-R33]; a day that reaches " +
                "PARTIAL here is the directions.Count == 2 mistake integration-spec section 8.3 " +
                "forbids by name.");
    }

    [Fact]
    public void An_incomplete_day_is_PARTIAL_and_that_is_accepted()
    {
        var day = Compute(
            state: MeteringDayState.Partial,
            consumptionComplete: true,
            productionComplete: false,
            productionIsDeclaredZero: false).Value;

        day.State.ShouldBe(MeteringDayState.Partial);
        day.ProductionComplete.ShouldBeFalse();
    }

    [Fact]
    public void A_day_with_nothing_at_all_is_NO_DATA()
    {
        var day = Compute(
            state: MeteringDayState.NoData,
            consumptionComplete: false,
            productionComplete: false).Value;

        day.State.ShouldBe(MeteringDayState.NoData);
    }

    [Theory]
    [InlineData((short)0)]
    [InlineData((short)95)]
    [InlineData((short)97)]
    public void An_expected_interval_count_that_is_not_92_96_or_100_is_rejected(short count)
    {
        Compute(expectedIntervalCount: count).Error
            .ShouldBe("A day state must expect 92, 96 or 100 intervals.");
    }

    [Fact]
    public void A_FINAL_day_must_record_when_it_was_finalised()
    {
        Compute(state: MeteringDayState.Final, finalisedAt: null).Error
            .ShouldBe("A FINAL day state must record when it was finalised.");
    }

    /// <summary>
    /// [DEC-98] makes FINAL a STATUS, not a guarantee: a post-window reconciliation reopens the
    /// date to PROVISIONAL and re-finalises, and nothing may archive, compact or cache on the
    /// strength of FINAL. The reopen edge therefore has to clear finalised_at, or a reopened day
    /// carries a moment that says it is still final.
    /// </summary>
    [Fact]
    public void Reopening_a_FINAL_day_to_PROVISIONAL_clears_the_finalised_moment()
    {
        var finalisedAt = new DateTimeOffset(2026, 8, 27, 3, 0, 0, TimeSpan.Zero);
        var reopenedAt = new DateTimeOffset(2026, 9, 4, 3, 0, 0, TimeSpan.Zero);
        var day = Compute(state: MeteringDayState.Final, finalisedAt: finalisedAt).Value;

        var reopened = day.Recompute(
            MeteringDayState.Provisional,
            expectedIntervalCount: 96,
            consumptionComplete: true,
            productionComplete: true,
            productionIsDeclaredZero: false,
            finalisedAt: null,
            lastCorrectedAt: reopenedAt,
            computedAt: reopenedAt).Value;

        reopened.State.ShouldBe(MeteringDayState.Provisional);
        reopened.FinalisedAt.ShouldBeNull();
        reopened.LastCorrectedAt.ShouldBe(reopenedAt);
        reopened.ComputedAt.ShouldBe(reopenedAt);
    }

    [Fact]
    public void A_non_FINAL_day_that_still_carries_a_finalised_moment_is_rejected()
    {
        Compute(
            state: MeteringDayState.Provisional,
            finalisedAt: new DateTimeOffset(2026, 8, 27, 3, 0, 0, TimeSpan.Zero))
            .Error.ShouldBe(
                "Only a FINAL day state may record a finalised moment. [DEC-98] makes a reopen to " +
                "PROVISIONAL routine, and a reopened day that keeps its finalised_at is a day that " +
                "reads as final to everything downstream.");
    }

    [Fact]
    public void Recomputing_never_moves_the_identity_of_the_row()
    {
        var day = Compute().Value;

        var recomputed = day.Recompute(
            MeteringDayState.Final,
            expectedIntervalCount: 96,
            consumptionComplete: true,
            productionComplete: true,
            productionIsDeclaredZero: false,
            finalisedAt: ComputedAt.AddDays(14),
            lastCorrectedAt: null,
            computedAt: ComputedAt.AddDays(14)).Value;

        recomputed.MeteringPointId.ShouldBe(MeteringPointId);
        recomputed.DeliveryDate.ShouldBe(DeliveryDate);
        recomputed.CustomerId.ShouldBe(CustomerId);
        recomputed.State.ShouldBe(MeteringDayState.Final);
    }

    [Fact]
    public void A_day_state_without_a_customer_is_rejected()
    {
        Compute(customerId: Guid.Empty).Error
            .ShouldBe("A day state must name the customer that held the EAN on the delivery date.");
    }
}
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Metering/DailyPositionTests.cs`:

```csharp
using Shouldly;
using Xunit;
using PeakPower.Domain.Common;
using PeakPower.Domain.Metering;

namespace PeakPower.Domain.Tests.Metering;

public sealed class DailyPositionTests
{
    private static readonly Guid MeteringPointId = Guid.Parse("0199a1a0-0000-7000-8000-000000000101");
    private static readonly Guid CustomerId = Guid.Parse("0199a1a0-0000-7000-8000-00000000c001");
    private static readonly Guid ConsumptionVersionId = Guid.Parse("0199a1a0-0000-7000-8000-00000000f001");
    private static readonly Guid ProductionVersionId = Guid.Parse("0199a1a0-0000-7000-8000-00000000f002");
    private static readonly DateOnly DeliveryDate = new(2026, 8, 12);
    private static readonly DateTimeOffset ComputedAt =
        new(2026, 8, 13, 4, 2, 12, TimeSpan.Zero);

    private static Result<DailyPosition> Roll(
        decimal consumptionKwh = 10m,
        decimal productionKwh = 5m,
        decimal netUsageKwh = 5m,
        decimal offtakeKwh = 10m,
        decimal exportKwh = 5m,
        MeteringDayState dataState = MeteringDayState.Provisional,
        IReadOnlyList<Guid>? sourceVersionIds = null,
        Guid? customerId = null) =>
        DailyPosition.Roll(
            MeteringPointId,
            DeliveryDate,
            customerId ?? CustomerId,
            consumptionKwh,
            productionKwh,
            netUsageKwh,
            offtakeKwh,
            exportKwh,
            dataState,
            sourceVersionIds ?? [ConsumptionVersionId, ProductionVersionId],
            ComputedAt);

    /// <summary>
    /// Design section 4.1's worked case, as a fixture. Two intervals, consumption [10, 0],
    /// production [0, 5]. Per interval U = [10, -5], so offtake is 10 and export is 5. From daily
    /// totals alone, sum(c) - sum(p) = 5 and max(5, 0) = 5, which disagrees and DISCARDS THE
    /// EXPORT ENTIRELY.
    /// <para>
    /// ⚠ This test does not prove the accumulation - this aggregate receives numbers, and both the
    /// right and the wrong computation produce a well-formed row. Plan 5's mutation test against
    /// this same fixture is what proves it, and design section 10 requires that mutation
    /// explicitly. What this test pins is that the SHAPE can hold the right answer: five separate
    /// columns, with offtake and export stored rather than derived.
    /// </para>
    /// </summary>
    [Fact]
    public void The_worked_case_of_design_section_4_1_is_storable_with_offtake_ten_and_export_five()
    {
        var position = Roll(
            consumptionKwh: 10m,
            productionKwh: 5m,
            netUsageKwh: 5m,
            offtakeKwh: 10m,
            exportKwh: 5m).Value;

        position.ConsumptionKwh.ShouldBe(10m);
        position.ProductionKwh.ShouldBe(5m);
        position.NetUsageKwh.ShouldBe(5m);
        position.OfftakeKwh.ShouldBe(10m,
            "offtake is the sum of max(c - p, 0) PER INTERVAL, not max(net usage, 0)");
        position.ExportKwh.ShouldBe(5m,
            "export is the sum of |min(c - p, 0)| PER INTERVAL; from daily totals it reads 0, " +
            "which is the whole reason this column exists");
        position.DataState.ShouldBe(MeteringDayState.Provisional);
        position.SourceVersionIds.ShouldBe(new[] { ConsumptionVersionId, ProductionVersionId });
        position.ComputedAt.ShouldBe(ComputedAt);
    }

    [Fact]
    public void Net_usage_may_be_negative_when_production_exceeds_consumption_over_the_day()
    {
        // [DEC-22]: net usage may be negative, treated as export and settled under [DEC-23].
        var position = Roll(
            consumptionKwh: 4m, productionKwh: 9m, netUsageKwh: -5m,
            offtakeKwh: 1m, exportKwh: 6m).Value;

        position.NetUsageKwh.ShouldBe(-5m);
    }

    [Fact]
    public void Net_usage_must_equal_consumption_minus_production()
    {
        // The one identity that survives daily totals, so it is a real invariant and worth having.
        Roll(consumptionKwh: 10m, productionKwh: 5m, netUsageKwh: 4m, offtakeKwh: 10m, exportKwh: 5m)
            .Error.ShouldBe(
                "A daily position's net usage must equal consumption minus production. " +
                "Expected 5, got 4.");
    }

    /// <summary>
    /// ⚠ This identity holds for BOTH the correct per-interval accumulation (10 - 5 = 5) and the
    /// incorrect daily-totals one (5 - 0 = 5), so it is deliberately NOT the design section 4.1
    /// guard. It is written down with that caveat so nobody later reads it as one and stops
    /// looking for plan 5's mutation test.
    /// </summary>
    [Fact]
    public void Offtake_minus_export_must_equal_net_usage()
    {
        Roll(consumptionKwh: 10m, productionKwh: 5m, netUsageKwh: 5m, offtakeKwh: 10m, exportKwh: 9m)
            .Error.ShouldBe(
                "A daily position's offtake minus export must equal its net usage. " +
                "Expected 5, got 1.");
    }

    [Fact]
    public void A_negative_offtake_is_rejected()
    {
        Roll(consumptionKwh: 0m, productionKwh: 0m, netUsageKwh: 0m, offtakeKwh: -1m, exportKwh: -1m)
            .Error.ShouldBe("A daily position's offtake must not be negative.");
    }

    [Fact]
    public void A_negative_export_is_rejected()
    {
        Roll(consumptionKwh: 0m, productionKwh: 0m, netUsageKwh: 0m, offtakeKwh: 0m, exportKwh: -1m)
            .Error.ShouldBe("A daily position's export must not be negative.");
    }

    [Fact]
    public void A_negative_gross_consumption_is_rejected()
    {
        Roll(consumptionKwh: -1m, productionKwh: 0m, netUsageKwh: -1m, offtakeKwh: 0m, exportKwh: 1m)
            .Error.ShouldBe("A daily position's gross consumption must not be negative.");
    }

    /// <summary>
    /// source_version_ids is what makes invalidation EXACT: when a correction supersedes one
    /// direction of one day, the rollups to recompute are the ones naming that version, not "every
    /// rollup for that point since". A rollup that names no version cannot be invalidated at all.
    /// </summary>
    [Fact]
    public void A_position_with_data_must_name_the_versions_it_was_rolled_from()
    {
        Roll(dataState: MeteringDayState.Provisional, sourceVersionIds: []).Error
            .ShouldBe(
                "A daily position that is not NO_DATA must name the versions it was rolled from, " +
                "or nothing can invalidate it when one of them is superseded.");
    }

    [Fact]
    public void A_NO_DATA_position_may_name_no_versions()
    {
        var position = Roll(
            consumptionKwh: 0m, productionKwh: 0m, netUsageKwh: 0m,
            offtakeKwh: 0m, exportKwh: 0m,
            dataState: MeteringDayState.NoData,
            sourceVersionIds: []).Value;

        position.SourceVersionIds.ShouldBeEmpty();
    }

    [Fact]
    public void The_stored_version_ids_are_a_copy_so_a_caller_cannot_mutate_them_afterwards()
    {
        var ids = new[] { ConsumptionVersionId, ProductionVersionId };
        var position = Roll(sourceVersionIds: ids).Value;

        ids[0] = Guid.Empty;

        position.SourceVersionIds[0].ShouldBe(ConsumptionVersionId);
    }

    [Fact]
    public void Recomputing_replaces_the_numbers_and_keeps_the_identity()
    {
        var recomputedAt = ComputedAt.AddDays(23);
        var position = Roll().Value;

        var recomputed = position.Recompute(
            consumptionKwh: 12m,
            productionKwh: 5m,
            netUsageKwh: 7m,
            offtakeKwh: 12m,
            exportKwh: 5m,
            dataState: MeteringDayState.Final,
            sourceVersionIds: [ConsumptionVersionId],
            computedAt: recomputedAt).Value;

        recomputed.MeteringPointId.ShouldBe(MeteringPointId);
        recomputed.DeliveryDate.ShouldBe(DeliveryDate);
        recomputed.CustomerId.ShouldBe(CustomerId);
        recomputed.ConsumptionKwh.ShouldBe(12m);
        recomputed.OfftakeKwh.ShouldBe(12m);
        recomputed.SourceVersionIds.ShouldBe(new[] { ConsumptionVersionId });
        recomputed.ComputedAt.ShouldBe(recomputedAt);
    }

    [Fact]
    public void A_position_without_a_customer_is_rejected()
    {
        Roll(customerId: Guid.Empty).Error
            .ShouldBe("A daily position must name the customer that held the EAN on the delivery date.");
    }
}
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: FAIL to build with
`error CS0246: The type or namespace name 'MeteringPointDayState' could not be found` and
`error CS0246: The type or namespace name 'DailyPosition' could not be found`.

- [ ] **Step 3: Write `MeteringPointDayState`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/MeteringPointDayState.cs`:

```csharp
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Metering;

/// <summary>
/// The materialised data state per (metering point, delivery date). [F02-R22]
/// <para>
/// ⚠ Completeness is judged against the metering point's <c>production_expectation</c>, NEVER
/// against "both directions present". [F02-R32] forbids that test [DEC-65], and integration-spec
/// section 8.3 names the prohibited implementation literally - "This check must not be written as
/// directions.Count == 2" - and says it fails SILENTLY: every non-producing connection stops
/// invoicing and the cause looks like a PVNed fault. Plan 5 owns the rule; this aggregate owns the
/// shape, and refuses the one combination the wrong rule produces and the right one never does.
/// </para>
/// <para>
/// [DEC-98] makes FINAL a STATUS rather than a guarantee. A post-window reconciliation reopens the
/// date to PROVISIONAL and re-finalises, so nothing may archive, compact or cache on FINAL, and a
/// reopened day must not keep the moment that says it is still final.
/// </para>
/// </summary>
public sealed class MeteringPointDayState
{
    /// <summary>EF Core materialises through this; application code uses <see cref="Compute"/>.</summary>
    private MeteringPointDayState()
    {
    }

    public Guid MeteringPointId { get; private set; }

    public DateOnly DeliveryDate { get; private set; }

    /// <summary>⚠ S2-D1. See <see cref="IntervalDataVersion.CustomerId"/> for the full argument.</summary>
    public Guid CustomerId { get; private set; }

    public MeteringDayState State { get; private set; }

    /// <summary>92, 96 or 100 - the day's length, from IMarketCalendar.ExpectedIntervalCount.</summary>
    public short ExpectedIntervalCount { get; private set; }

    public bool ConsumptionComplete { get; private set; }

    /// <summary>
    /// True when the production series is complete OR when it is a declared zero. A
    /// production_expectation of NEVER means a DECLARED zero, and UNKNOWN reads as EXPECTED.
    /// </summary>
    public bool ProductionComplete { get; private set; }

    /// <summary>
    /// production_expectation is NEVER. [F02-R33]: the chart draws this as a STATED zero traceable
    /// to its source, setter and date [F01-R40], not as a gap and not as an unlabelled flat line.
    /// It is the fifth of the five data-state treatments and the one most likely to be skipped.
    /// </summary>
    public bool ProductionIsDeclaredZero { get; private set; }

    /// <summary>Set only while <see cref="State"/> is FINAL. Cleared by a reopen.</summary>
    public DateTimeOffset? FinalisedAt { get; private set; }

    /// <summary>The chart's corrected-on marker.</summary>
    public DateTimeOffset? LastCorrectedAt { get; private set; }

    public DateTimeOffset ComputedAt { get; private set; }

    public static Result<MeteringPointDayState> Compute(
        Guid meteringPointId,
        DateOnly deliveryDate,
        Guid customerId,
        MeteringDayState state,
        short expectedIntervalCount,
        bool consumptionComplete,
        bool productionComplete,
        bool productionIsDeclaredZero,
        DateTimeOffset? finalisedAt,
        DateTimeOffset? lastCorrectedAt,
        DateTimeOffset computedAt)
    {
        if (meteringPointId == Guid.Empty)
        {
            return Result<MeteringPointDayState>.Failure("A day state must name a metering point.");
        }

        if (customerId == Guid.Empty)
        {
            return Result<MeteringPointDayState>.Failure(
                "A day state must name the customer that held the EAN on the delivery date.");
        }

        var invariants = Validate(
            state, expectedIntervalCount, consumptionComplete, productionComplete,
            productionIsDeclaredZero, finalisedAt);

        if (!invariants.IsSuccess)
        {
            return Result<MeteringPointDayState>.Failure(invariants.Error);
        }

        return Result<MeteringPointDayState>.Success(new MeteringPointDayState
        {
            MeteringPointId = meteringPointId,
            DeliveryDate = deliveryDate,
            CustomerId = customerId,
            State = state,
            ExpectedIntervalCount = expectedIntervalCount,
            ConsumptionComplete = consumptionComplete,
            ProductionComplete = productionComplete,
            ProductionIsDeclaredZero = productionIsDeclaredZero,
            FinalisedAt = finalisedAt,
            LastCorrectedAt = lastCorrectedAt,
            ComputedAt = computedAt,
        });
    }

    /// <summary>
    /// Replaces every computed field, keeping the identity. The rollup job recomputes a day state
    /// on every apply that touches its (point, date), including the FINAL-to-PROVISIONAL reopen.
    /// </summary>
    public Result<MeteringPointDayState> Recompute(
        MeteringDayState state,
        short expectedIntervalCount,
        bool consumptionComplete,
        bool productionComplete,
        bool productionIsDeclaredZero,
        DateTimeOffset? finalisedAt,
        DateTimeOffset? lastCorrectedAt,
        DateTimeOffset computedAt)
    {
        var invariants = Validate(
            state, expectedIntervalCount, consumptionComplete, productionComplete,
            productionIsDeclaredZero, finalisedAt);

        if (!invariants.IsSuccess)
        {
            return Result<MeteringPointDayState>.Failure(invariants.Error);
        }

        State = state;
        ExpectedIntervalCount = expectedIntervalCount;
        ConsumptionComplete = consumptionComplete;
        ProductionComplete = productionComplete;
        ProductionIsDeclaredZero = productionIsDeclaredZero;
        FinalisedAt = finalisedAt;
        LastCorrectedAt = lastCorrectedAt;
        ComputedAt = computedAt;

        return Result<MeteringPointDayState>.Success(this);
    }

    private static Result<bool> Validate(
        MeteringDayState state,
        short expectedIntervalCount,
        bool consumptionComplete,
        bool productionComplete,
        bool productionIsDeclaredZero,
        DateTimeOffset? finalisedAt)
    {
        if (!IntervalDataVersion.ValidIntervalCounts.Contains(expectedIntervalCount))
        {
            return Result<bool>.Failure("A day state must expect 92, 96 or 100 intervals.");
        }

        if (state is MeteringDayState.Final && finalisedAt is null)
        {
            return Result<bool>.Failure("A FINAL day state must record when it was finalised.");
        }

        if (state is not MeteringDayState.Final && finalisedAt is not null)
        {
            return Result<bool>.Failure(
                "Only a FINAL day state may record a finalised moment. [DEC-98] makes a reopen to " +
                "PROVISIONAL routine, and a reopened day that keeps its finalised_at is a day that " +
                "reads as final to everything downstream.");
        }

        // The one shape the directions.Count == 2 mistake produces and the correct rule never does:
        // a declared-zero connection whose consumption series is complete IS a complete day, and a
        // rule counting directions holds it at PARTIAL forever. This aggregate cannot see the
        // production expectation, but it can see the contradiction.
        if (state is MeteringDayState.Partial
            && consumptionComplete
            && productionComplete
            && productionIsDeclaredZero)
        {
            return Result<bool>.Failure(
                "A day whose consumption and production are both complete cannot be PARTIAL. A " +
                "declared zero IS a complete production series [F02-R33]; a day that reaches " +
                "PARTIAL here is the directions.Count == 2 mistake integration-spec section 8.3 " +
                "forbids by name.");
        }

        return Result<bool>.Success(true);
    }
}
```

- [ ] **Step 4: Write `DailyPosition`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/DailyPosition.cs`:

```csharp
using System.Diagnostics.CodeAnalysis;
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Metering;

/// <summary>
/// The daily rollup. <c>interval_reading</c> remains the source of truth; this is a rollup that
/// must not lose what Phase 2 will clamp.
/// <para>
/// Design section 4.1 is the whole argument, and it is worth being precise about, because a naive
/// reading says a daily total is enough: sum(c - p) is arithmetically identical to sum(c) - sum(p),
/// so the daily NET figure survives a daily-totals rollup intact. What does NOT survive is
/// everything that clamps per interval. Phase 2's coverage maths is max(U, 0) per interval, and
/// [DEC-23] settles the negative part as a separate sale line, never netted against purchase lines,
/// because uncovered and surplus volumes occur at different times and therefore at different
/// prices.
/// </para>
/// <para>
/// The worked case: consumption [10, 0], production [0, 5]. Per interval U = [10, -5], so offtake
/// is 10 and export is 5. From daily totals alone, sum(c) - sum(p) = 5 and max(5, 0) = 5 - which
/// disagrees, and discards the export entirely.
/// </para>
/// <para>
/// ⚠ <see cref="OfftakeKwh"/> is NOT max(NetUsageKwh, 0) and <see cref="ExportKwh"/> is NOT
/// max(-NetUsageKwh, 0). This aggregate cannot enforce that - it receives numbers, and both the
/// right and the wrong computation produce a well-formed row. Plan 5's mutation test against the
/// worked case is what proves the accumulation, and design section 10 requires it explicitly.
/// The <c>Offtake - Export == NetUsage</c> identity checked below holds under BOTH computations
/// and is therefore deliberately NOT that guard.
/// </para>
/// </summary>
public sealed class DailyPosition
{
    private Guid[] _sourceVersionIds = [];

    /// <summary>EF Core materialises through this; application code uses <see cref="Roll"/>.</summary>
    private DailyPosition()
    {
    }

    public Guid MeteringPointId { get; private set; }

    public DateOnly DeliveryDate { get; private set; }

    /// <summary>⚠ S2-D1. See <see cref="IntervalDataVersion.CustomerId"/> for the full argument.</summary>
    public Guid CustomerId { get; private set; }

    /// <summary>Sum of the consumption series. Non-negative [AS-05].</summary>
    public decimal ConsumptionKwh { get; private set; }

    /// <summary>Sum of the production series. Non-negative [AS-05].</summary>
    public decimal ProductionKwh { get; private set; }

    /// <summary>Sum of (c - p) per interval. May be negative [DEC-22].</summary>
    public decimal NetUsageKwh { get; private set; }

    /// <summary>⚠ Sum of max(c - p, 0) PER INTERVAL. Not max(NetUsageKwh, 0).</summary>
    public decimal OfftakeKwh { get; private set; }

    /// <summary>⚠ Sum of |min(c - p, 0)| PER INTERVAL. Not max(-NetUsageKwh, 0).</summary>
    public decimal ExportKwh { get; private set; }

    public MeteringDayState DataState { get; private set; }

    /// <summary>
    /// The versions this rollup was computed from, so invalidation is EXACT: when a correction
    /// supersedes one direction of one day, the rollups to recompute are the ones naming that
    /// version, not "every rollup for that point since".
    /// </summary>
    [SuppressMessage(
        "Performance",
        "CA1819:Properties should not return arrays",
        Justification = "The shared contract pins this property as Guid[] (section 5) and it maps " +
            "straight onto a uuid[] column. Roll() and Recompute() copy the caller's list in, and " +
            "the backing array is never handed out before that copy.")]
    public Guid[] SourceVersionIds => _sourceVersionIds;

    public DateTimeOffset ComputedAt { get; private set; }

    public static Result<DailyPosition> Roll(
        Guid meteringPointId,
        DateOnly deliveryDate,
        Guid customerId,
        decimal consumptionKwh,
        decimal productionKwh,
        decimal netUsageKwh,
        decimal offtakeKwh,
        decimal exportKwh,
        MeteringDayState dataState,
        IReadOnlyList<Guid> sourceVersionIds,
        DateTimeOffset computedAt)
    {
        if (meteringPointId == Guid.Empty)
        {
            return Result<DailyPosition>.Failure("A daily position must name a metering point.");
        }

        if (customerId == Guid.Empty)
        {
            return Result<DailyPosition>.Failure(
                "A daily position must name the customer that held the EAN on the delivery date.");
        }

        var invariants = Validate(
            consumptionKwh, productionKwh, netUsageKwh, offtakeKwh, exportKwh, dataState,
            sourceVersionIds);

        if (!invariants.IsSuccess)
        {
            return Result<DailyPosition>.Failure(invariants.Error);
        }

        return Result<DailyPosition>.Success(new DailyPosition
        {
            MeteringPointId = meteringPointId,
            DeliveryDate = deliveryDate,
            CustomerId = customerId,
            ConsumptionKwh = consumptionKwh,
            ProductionKwh = productionKwh,
            NetUsageKwh = netUsageKwh,
            OfftakeKwh = offtakeKwh,
            ExportKwh = exportKwh,
            DataState = dataState,
            _sourceVersionIds = [.. sourceVersionIds],
            ComputedAt = computedAt,
        });
    }

    public Result<DailyPosition> Recompute(
        decimal consumptionKwh,
        decimal productionKwh,
        decimal netUsageKwh,
        decimal offtakeKwh,
        decimal exportKwh,
        MeteringDayState dataState,
        IReadOnlyList<Guid> sourceVersionIds,
        DateTimeOffset computedAt)
    {
        var invariants = Validate(
            consumptionKwh, productionKwh, netUsageKwh, offtakeKwh, exportKwh, dataState,
            sourceVersionIds);

        if (!invariants.IsSuccess)
        {
            return Result<DailyPosition>.Failure(invariants.Error);
        }

        ConsumptionKwh = consumptionKwh;
        ProductionKwh = productionKwh;
        NetUsageKwh = netUsageKwh;
        OfftakeKwh = offtakeKwh;
        ExportKwh = exportKwh;
        DataState = dataState;
        _sourceVersionIds = [.. sourceVersionIds];
        ComputedAt = computedAt;

        return Result<DailyPosition>.Success(this);
    }

    private static Result<bool> Validate(
        decimal consumptionKwh,
        decimal productionKwh,
        decimal netUsageKwh,
        decimal offtakeKwh,
        decimal exportKwh,
        MeteringDayState dataState,
        IReadOnlyList<Guid> sourceVersionIds)
    {
        if (consumptionKwh < 0m)
        {
            return Result<bool>.Failure("A daily position's gross consumption must not be negative.");
        }

        if (productionKwh < 0m)
        {
            return Result<bool>.Failure("A daily position's gross production must not be negative.");
        }

        if (offtakeKwh < 0m)
        {
            return Result<bool>.Failure("A daily position's offtake must not be negative.");
        }

        if (exportKwh < 0m)
        {
            return Result<bool>.Failure("A daily position's export must not be negative.");
        }

        var expectedNet = consumptionKwh - productionKwh;
        if (netUsageKwh != expectedNet)
        {
            return Result<bool>.Failure(
                "A daily position's net usage must equal consumption minus production. " +
                $"Expected {expectedNet}, got {netUsageKwh}.");
        }

        // ⚠ True under BOTH the correct per-interval accumulation and the incorrect daily-totals
        // one - 10 - 5 = 5, and 5 - 0 = 5 - so this is a real invariant and NOT the design
        // section 4.1 guard. Plan 5's mutation against the worked case is that guard.
        var offtakeLessExport = offtakeKwh - exportKwh;
        if (offtakeLessExport != netUsageKwh)
        {
            return Result<bool>.Failure(
                "A daily position's offtake minus export must equal its net usage. " +
                $"Expected {netUsageKwh}, got {offtakeLessExport}.");
        }

        if (dataState is not MeteringDayState.NoData && sourceVersionIds.Count == 0)
        {
            return Result<bool>.Failure(
                "A daily position that is not NO_DATA must name the versions it was rolled from, " +
                "or nothing can invalidate it when one of them is superseded.");
        }

        return Result<bool>.Success(true);
    }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS.

- [ ] **Step 6: Mutate the reopen rule**

The `[DEC-98]` reopen edge is the one a reasonable implementer drops, because a reopened day that
keeps `finalised_at` looks harmless. Delete the second `finalisedAt` guard from
`MeteringPointDayState.Validate`:

```csharp
        // MUTATION - removed for one run
        // if (state is not MeteringDayState.Final && finalisedAt is not null)
        // {
        //     return Result<bool>.Failure("Only a FINAL day state may record a finalised moment. …");
        // }
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo --filter "FullyQualifiedName~MeteringPointDayStateTests"`
Expected: FAIL — `A_non_FINAL_day_that_still_carries_a_finalised_moment_is_rejected` fails with
`result.Error should be "Only a FINAL day state may record a finalised moment. …" but was ""`.

⚠ Check that `Reopening_a_FINAL_day_to_PROVISIONAL_clears_the_finalised_moment` still **passes**
under the mutation — it does, because it passes `finalisedAt: null` explicitly. That is exactly why
it is not the test this mutation is for: the reopen path can be correct at the call site while the
aggregate lets a wrong call site through.

Restore the guard, then mutate the day-state completeness refusal — replace it with the shape a
`directions.Count == 2` implementation would leave behind:

```csharp
        // MUTATION - the check that never fires
        if (state is MeteringDayState.Partial && consumptionComplete && productionComplete
            && productionIsDeclaredZero && false)
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo --filter "FullyQualifiedName~A_complete_declared_zero_day_cannot_be_recorded_PARTIAL"`
Expected: FAIL — `result.Error should be "A day whose consumption and production are both complete
cannot be PARTIAL. …" but was ""`.

Restore both guards and re-run:

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Metering/MeteringPointDayState.cs \
        src/Core/PeakPower.Domain/Metering/DailyPosition.cs \
        tests/PeakPower.Domain.Tests/Metering/MeteringPointDayStateTests.cs \
        tests/PeakPower.Domain.Tests/Metering/DailyPositionTests.cs
git commit -m "feat(domain): add MeteringPointDayState and DailyPosition

daily_position stores offtake and export SEPARATELY because neither survives a
daily-totals rollup - design section 4.1's worked case is a fixture here, with an explicit
note that the Offtake - Export == NetUsage identity holds under the WRONG computation too
and is therefore not that guard; plan 5's mutation is. The [DEC-98] reopen rule and the
declared-zero-cannot-be-PARTIAL refusal are both verified by mutation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `QuarantinedSeries` and `OperationalAlert`

Two employee-only tables. Neither carries a `CustomerId`, and **that is load-bearing**: contract §5
says exactly four of the eight new entities carry one, both coverage guards' arithmetic moves by
exactly four, and adding a convenient `CustomerId` to either of these would break Task 11's and
Task 16's pinned literals and every plan that pinned them.

`QuarantinedSeries` is a parsed series that could not be attached to a metering point `[F02-R14]`,
`[F02-R15]`. ⚠ **Quarantine is a storage state with a replay path, not a parse outcome.** The
message reaches `PROCESSED`, the series lands here, and registering the metering point then
replaying the stored message resolves the entry into readings. All four reasons are **pipeline**
decisions, never adapter decisions: `[F02-R40]` forbids an adapter reading
`customer.metering_point`.

`ResourceObject` is carried **verbatim**, whatever shape it had. `[F02-R11]`/`[AS-17]`: eighteen
digits is an EAN, and anything else is a descriptive resource label (`Prognosis`, `Realisation`,
`Imbalance`, …) that is never offered to the EAN resolver — otherwise a labelled document
quarantines as a false `UNKNOWN_EAN`. The quarantine row is where an employee reads what actually
arrived, so the raw string must survive.

`OperationalAlert` carries the conditions of `[F02-R12]`, `[F02-R26]`, `[F02-R34]`, `[F02-R35]` and
`[F02-R45]`. The **conditions** are built and tested in slice 2; **only the delivery channel is
deferred** (design §3.2). `[DEC-104]` is one operator with no rota, so a channel with no rota behind
it is decoration.

`Summary` follows contract §5's stated rule: **one sentence, sentence case, ends with a full stop.**
That is enforceable and worth enforcing — the employee screen renders it as a line of prose, and a
fragment without a stop reads as truncation.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/QuarantinedSeries.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/OperationalAlert.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Metering/QuarantinedSeriesTests.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Metering/OperationalAlertTests.cs`

**Interfaces:**
- Consumes: `Result<T>`, `QuarantineReason`, `IntervalDirection`, `OperationalAlertKind`,
  `OperationalAlertStatus`.
- Produces:
  - `QuarantinedSeries` with `Id`, `InboundMessageId`, `BrpId`, `Reason`, `ResourceObject`,
    `DeliveryDate`, `Direction`, `PointCount`, `ReceivedAt`, `ResolvedAt`, `ResolvedBy`,
    `ResolvedByReplayOfMessageId`.
  - `QuarantinedSeries.Quarantine(Guid inboundMessageId, Guid brpId, QuarantineReason reason, string resourceObject, DateOnly deliveryDate, IntervalDirection direction, short pointCount, DateTimeOffset receivedAt)` → `Result<QuarantinedSeries>`
  - `Result<QuarantinedSeries> Resolve(DateTimeOffset resolvedAt, string resolvedBy, Guid? resolvedByReplayOfMessageId)`
  - `OperationalAlert` with `Id`, `Kind`, `Status`, `MeteringPointId`, `BrpId`, `InboundMessageId`,
    `DeliveryDate`, `Summary`, `Detail`, `RaisedAt`, `ResolvedAt`.
  - `OperationalAlert.Raise(OperationalAlertKind kind, string summary, string? detail, DateTimeOffset raisedAt, Guid? meteringPointId = null, Guid? brpId = null, Guid? inboundMessageId = null, DateOnly? deliveryDate = null)` → `Result<OperationalAlert>`
  - `Result<OperationalAlert> Resolve(DateTimeOffset resolvedAt)`

- [ ] **Step 1: Write the failing tests**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Metering/QuarantinedSeriesTests.cs`:

```csharp
using Shouldly;
using Xunit;
using PeakPower.Domain.Common;
using PeakPower.Domain.Metering;

namespace PeakPower.Domain.Tests.Metering;

public sealed class QuarantinedSeriesTests
{
    private static readonly Guid InboundMessageId = Guid.Parse("0199a1a0-0000-7000-8000-00000000d001");
    private static readonly Guid ReplayMessageId = Guid.Parse("0199a1a0-0000-7000-8000-00000000d002");
    private static readonly Guid BrpId = Guid.Parse("0199a1a0-0000-7000-8000-0000000000b1");
    private static readonly DateOnly DeliveryDate = new(2026, 8, 12);
    private static readonly DateTimeOffset ReceivedAt =
        new(2026, 8, 13, 4, 2, 11, TimeSpan.Zero);

    private static Result<QuarantinedSeries> Quarantine(
        QuarantineReason reason = QuarantineReason.UnknownEan,
        string resourceObject = "871685900000000042",
        IntervalDirection direction = IntervalDirection.Consumption,
        short pointCount = 96,
        Guid? inboundMessageId = null,
        Guid? brpId = null) =>
        QuarantinedSeries.Quarantine(
            inboundMessageId ?? InboundMessageId,
            brpId ?? BrpId,
            reason,
            resourceObject,
            DeliveryDate,
            direction,
            pointCount,
            ReceivedAt);

    [Fact]
    public void A_quarantined_series_records_everything_an_employee_needs_to_act_on_it()
    {
        var series = Quarantine().Value;

        series.Id.ShouldNotBe(Guid.Empty);
        series.InboundMessageId.ShouldBe(InboundMessageId);
        series.BrpId.ShouldBe(BrpId);
        series.Reason.ShouldBe(QuarantineReason.UnknownEan);
        series.ResourceObject.ShouldBe("871685900000000042");
        series.DeliveryDate.ShouldBe(DeliveryDate);
        series.Direction.ShouldBe(IntervalDirection.Consumption);
        series.PointCount.ShouldBe((short)96);
        series.ReceivedAt.ShouldBe(ReceivedAt);
        series.ResolvedAt.ShouldBeNull();
        series.ResolvedBy.ShouldBeNull();
        series.ResolvedByReplayOfMessageId.ShouldBeNull();
    }

    /// <summary>
    /// [F02-R11]/[AS-17]: eighteen digits is an EAN, anything else is a DESCRIPTIVE RESOURCE LABEL
    /// and is never offered to the EAN resolver - otherwise a labelled document quarantines as a
    /// false UNKNOWN_EAN. The label is carried verbatim, whatever shape it had, because the
    /// quarantine row is where an employee reads what actually arrived. Trimming, upper-casing or
    /// "normalising" it here would destroy the evidence.
    /// </summary>
    [Theory]
    [InlineData("871685900000000042")]
    [InlineData("Prognosis")]
    [InlineData("Realisation")]
    [InlineData("Imbalance")]
    [InlineData("NL-PVNED-PORTFOLIO-01")]
    public void The_resource_object_is_carried_verbatim_whatever_shape_it_had(string resourceObject)
    {
        Quarantine(resourceObject: resourceObject).Value.ResourceObject.ShouldBe(resourceObject);
    }

    [Theory]
    [InlineData(QuarantineReason.UnknownEan)]
    [InlineData(QuarantineReason.EanValidity)]
    [InlineData(QuarantineReason.WrongBrp)]
    [InlineData(QuarantineReason.NotElectricity)]
    public void All_four_pipeline_reasons_are_storable(QuarantineReason reason)
    {
        Quarantine(reason: reason).Value.Reason.ShouldBe(reason);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void A_quarantine_without_a_resource_object_is_rejected(string resourceObject)
    {
        // A quarantine entry whose resource object is blank cannot be acted on: the employee
        // screen's only affordance is "register this EAN, then replay", and there is nothing to
        // register.
        Quarantine(resourceObject: resourceObject).Error
            .ShouldBe("A quarantined series must record the resource object it arrived under.");
    }

    [Fact]
    public void A_quarantine_without_its_message_is_rejected()
    {
        // Replay reads the stored raw payload through this foreign key. A quarantine entry with no
        // message is a dead end rather than a work item.
        Quarantine(inboundMessageId: Guid.Empty).Error
            .ShouldBe("A quarantined series must name the inbound message it arrived in.");
    }

    [Fact]
    public void A_quarantine_without_its_BRP_is_rejected()
    {
        Quarantine(brpId: Guid.Empty).Error
            .ShouldBe("A quarantined series must name the BRP it arrived from.");
    }

    [Fact]
    public void A_negative_point_count_is_rejected()
    {
        Quarantine(pointCount: -1).Error
            .ShouldBe("A quarantined series point count must not be negative.");
    }

    [Fact]
    public void A_zero_point_count_is_accepted_because_an_empty_series_can_still_arrive()
    {
        Quarantine(pointCount: 0).IsSuccess.ShouldBeTrue();
    }

    /// <summary>
    /// The resolution path design section 7.6 requires: an unknown EAN quarantines, the EAN is
    /// registered through the existing back office, the stored message is replayed from the log,
    /// and the entry resolves into readings. The replay's message id is recorded so a reviewer can
    /// see which run cleared it.
    /// </summary>
    [Fact]
    public void Resolving_records_who_when_and_which_replay_cleared_it()
    {
        var resolvedAt = ReceivedAt.AddHours(26);
        var series = Quarantine().Value;

        var resolved = series.Resolve(resolvedAt, "employee:thinh@kikker.nl", ReplayMessageId).Value;

        resolved.ResolvedAt.ShouldBe(resolvedAt);
        resolved.ResolvedBy.ShouldBe("employee:thinh@kikker.nl");
        resolved.ResolvedByReplayOfMessageId.ShouldBe(ReplayMessageId);
    }

    [Fact]
    public void Resolving_without_naming_who_did_it_is_rejected()
    {
        Quarantine().Value.Resolve(ReceivedAt, "  ", ReplayMessageId).Error
            .ShouldBe("A quarantined series must record who resolved it.");
    }

    [Fact]
    public void Resolving_an_already_resolved_series_is_rejected()
    {
        // Not idempotent on purpose: a second resolution would silently overwrite the first
        // resolver and the first replay, and the audit answer "who cleared this" would change.
        var series = Quarantine().Value;
        series.Resolve(ReceivedAt.AddHours(1), "employee:a", ReplayMessageId);

        series.Resolve(ReceivedAt.AddHours(2), "employee:b", ReplayMessageId).Error
            .ShouldBe("That quarantined series has already been resolved.");
    }

    [Fact]
    public void Resolving_before_it_arrived_is_rejected()
    {
        Quarantine().Value.Resolve(ReceivedAt.AddSeconds(-1), "employee:a", null).Error
            .ShouldBe("A quarantined series cannot be resolved before it was received.");
    }

    [Fact]
    public void A_series_may_be_resolved_without_a_replay_because_an_employee_may_simply_dismiss_it()
    {
        var resolved = Quarantine().Value
            .Resolve(ReceivedAt.AddHours(2), "employee:thinh@kikker.nl", null).Value;

        resolved.ResolvedByReplayOfMessageId.ShouldBeNull();
        resolved.ResolvedAt.ShouldBe(ReceivedAt.AddHours(2));
    }
}
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Metering/OperationalAlertTests.cs`:

```csharp
using Shouldly;
using Xunit;
using PeakPower.Domain.Common;
using PeakPower.Domain.Metering;

namespace PeakPower.Domain.Tests.Metering;

public sealed class OperationalAlertTests
{
    private static readonly Guid MeteringPointId = Guid.Parse("0199a1a0-0000-7000-8000-000000000101");
    private static readonly Guid BrpId = Guid.Parse("0199a1a0-0000-7000-8000-0000000000b1");
    private static readonly Guid InboundMessageId = Guid.Parse("0199a1a0-0000-7000-8000-00000000d001");
    private static readonly DateOnly DeliveryDate = new(2026, 8, 12);
    private static readonly DateTimeOffset RaisedAt =
        new(2026, 8, 13, 4, 2, 12, TimeSpan.Zero);

    private static Result<OperationalAlert> Raise(
        OperationalAlertKind kind = OperationalAlertKind.ValidationFailure,
        string summary = "A document for Rotterdam DC failed validation and wrote no readings.",
        string? detail = "INCOMPLETE_PERIOD: expected 96 points for 2026-08-12, found 95.") =>
        OperationalAlert.Raise(
            kind, summary, detail, RaisedAt,
            meteringPointId: MeteringPointId,
            brpId: BrpId,
            inboundMessageId: InboundMessageId,
            deliveryDate: DeliveryDate);

    [Fact]
    public void A_raised_alert_is_OPEN_and_carries_its_context()
    {
        var alert = Raise().Value;

        alert.Id.ShouldNotBe(Guid.Empty);
        alert.Kind.ShouldBe(OperationalAlertKind.ValidationFailure);
        alert.Status.ShouldBe(OperationalAlertStatus.Open);
        alert.MeteringPointId.ShouldBe(MeteringPointId);
        alert.BrpId.ShouldBe(BrpId);
        alert.InboundMessageId.ShouldBe(InboundMessageId);
        alert.DeliveryDate.ShouldBe(DeliveryDate);
        alert.Summary.ShouldBe("A document for Rotterdam DC failed validation and wrote no readings.");
        alert.Detail.ShouldBe("INCOMPLETE_PERIOD: expected 96 points for 2026-08-12, found 95.");
        alert.RaisedAt.ShouldBe(RaisedAt);
        alert.ResolvedAt.ShouldBeNull();
    }

    [Theory]
    [InlineData(OperationalAlertKind.ValidationFailure)]
    [InlineData(OperationalAlertKind.MeteringPointSilent)]
    [InlineData(OperationalAlertKind.ProductionExpectationPromoted)]
    [InlineData(OperationalAlertKind.MissingProductionDeclaration)]
    [InlineData(OperationalAlertKind.PostWindowReconciliation)]
    public void All_five_conditions_are_storable(OperationalAlertKind kind)
    {
        Raise(kind: kind).Value.Kind.ShouldBe(kind);
    }

    [Fact]
    public void Every_context_field_is_optional_because_a_condition_may_have_none_of_them()
    {
        // MISSING_PRODUCTION_DECLARATION names a metering point but no message and no date;
        // a future portfolio-level condition may name none at all. Every context column is
        // nullable in migration 9 for the same reason.
        var alert = OperationalAlert.Raise(
            OperationalAlertKind.MissingProductionDeclaration,
            "Rotterdam DC has no production declaration.",
            detail: null,
            RaisedAt).Value;

        alert.MeteringPointId.ShouldBeNull();
        alert.BrpId.ShouldBeNull();
        alert.InboundMessageId.ShouldBeNull();
        alert.DeliveryDate.ShouldBeNull();
        alert.Detail.ShouldBeNull();
    }

    /// <summary>
    /// Shared contract section 5's stated rule for this column: "one sentence, sentence case, ends
    /// with a full stop". It is enforceable and worth enforcing - the employee data-health screen
    /// renders it as a line of prose, and a fragment with no stop reads as truncation, which sends
    /// an operator looking for the rest of a message that was never cut.
    /// </summary>
    [Fact]
    public void A_summary_that_does_not_end_in_a_full_stop_is_rejected()
    {
        Raise(summary: "A document failed validation").Error
            .ShouldBe("An operational alert summary must be one sentence ending in a full stop.");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void A_blank_summary_is_rejected(string summary)
    {
        Raise(summary: summary).Error
            .ShouldBe("An operational alert must carry a summary.");
    }

    [Fact]
    public void A_summary_is_trimmed_but_never_reworded()
    {
        Raise(summary: "  Rotterdam DC has been silent for two cadence windows.  ").Value
            .Summary.ShouldBe("Rotterdam DC has been silent for two cadence windows.");
    }

    [Fact]
    public void Resolving_closes_the_alert_and_stamps_the_moment()
    {
        var resolvedAt = RaisedAt.AddHours(3);
        var alert = Raise().Value;

        var resolved = alert.Resolve(resolvedAt).Value;

        resolved.Status.ShouldBe(OperationalAlertStatus.Resolved);
        resolved.ResolvedAt.ShouldBe(resolvedAt);
    }

    [Fact]
    public void Resolving_an_already_resolved_alert_is_rejected()
    {
        var alert = Raise().Value;
        alert.Resolve(RaisedAt.AddHours(1));

        alert.Resolve(RaisedAt.AddHours(2)).Error
            .ShouldBe("That operational alert has already been resolved.");
    }

    [Fact]
    public void Resolving_before_it_was_raised_is_rejected()
    {
        Raise().Value.Resolve(RaisedAt.AddSeconds(-1)).Error
            .ShouldBe("An operational alert cannot be resolved before it was raised.");
    }
}
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: FAIL to build with
`error CS0246: The type or namespace name 'QuarantinedSeries' could not be found` and
`error CS0246: The type or namespace name 'OperationalAlert' could not be found`.

- [ ] **Step 3: Write `QuarantinedSeries`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/QuarantinedSeries.cs`:

```csharp
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Metering;

/// <summary>
/// A parsed series that could not be attached to a metering point. [F02-R14], [F02-R15]
/// <para>
/// ⚠ Quarantine is a STORAGE STATE with a replay path, not a parse outcome. The message still
/// reaches PROCESSED, the series lands here, and registering the metering point through the
/// existing back office and then replaying the stored message resolves the entry into readings.
/// Replaying an already-processed message produces no second version [F02-R27].
/// </para>
/// <para>
/// ⚠ This entity deliberately carries NO CustomerId. There is no customer: an unknown EAN belongs
/// to nobody, and a wrong-BRP EAN belongs to somebody this message had no right to write for.
/// Contract section 5 makes the count of CustomerId-bearing entities exactly four, and both
/// row-level-security coverage guards' arithmetic moves by exactly that. The table is
/// employee-only: REVOKE ALL from app_customer_role, and an app_employee_role policy.
/// </para>
/// </summary>
public sealed class QuarantinedSeries
{
    /// <summary>EF Core materialises through this; application code uses <see cref="Quarantine"/>.</summary>
    private QuarantinedSeries()
    {
    }

    public Guid Id { get; private set; }

    /// <summary>The message replay reads the raw payload back through.</summary>
    public Guid InboundMessageId { get; private set; }

    public Guid BrpId { get; private set; }

    public QuarantineReason Reason { get; private set; }

    /// <summary>
    /// Verbatim from the document, whatever shape it had: an eighteen-digit EAN, or a descriptive
    /// resource label such as Prognosis, Realisation or Imbalance [F02-R11], [AS-17]. Never
    /// normalised - this is where an employee reads what actually arrived.
    /// </summary>
    public string ResourceObject { get; private set; } = string.Empty;

    public DateOnly DeliveryDate { get; private set; }

    public IntervalDirection Direction { get; private set; }

    public short PointCount { get; private set; }

    public DateTimeOffset ReceivedAt { get; private set; }

    public DateTimeOffset? ResolvedAt { get; private set; }

    public string? ResolvedBy { get; private set; }

    /// <summary>Which replay run cleared it, so a reviewer can find the run in the message log.</summary>
    public Guid? ResolvedByReplayOfMessageId { get; private set; }

    public static Result<QuarantinedSeries> Quarantine(
        Guid inboundMessageId,
        Guid brpId,
        QuarantineReason reason,
        string resourceObject,
        DateOnly deliveryDate,
        IntervalDirection direction,
        short pointCount,
        DateTimeOffset receivedAt)
    {
        if (inboundMessageId == Guid.Empty)
        {
            return Result<QuarantinedSeries>.Failure(
                "A quarantined series must name the inbound message it arrived in.");
        }

        if (brpId == Guid.Empty)
        {
            return Result<QuarantinedSeries>.Failure(
                "A quarantined series must name the BRP it arrived from.");
        }

        if (string.IsNullOrWhiteSpace(resourceObject))
        {
            return Result<QuarantinedSeries>.Failure(
                "A quarantined series must record the resource object it arrived under.");
        }

        if (pointCount < 0)
        {
            return Result<QuarantinedSeries>.Failure(
                "A quarantined series point count must not be negative.");
        }

        return Result<QuarantinedSeries>.Success(new QuarantinedSeries
        {
            Id = Guid.CreateVersion7(),
            InboundMessageId = inboundMessageId,
            BrpId = brpId,
            Reason = reason,

            // Not trimmed, not upper-cased, not normalised: the point of this column is evidence.
            ResourceObject = resourceObject,
            DeliveryDate = deliveryDate,
            Direction = direction,
            PointCount = pointCount,
            ReceivedAt = receivedAt,
        });
    }

    /// <summary>
    /// Deliberately not idempotent. A second resolution would silently overwrite the first resolver
    /// and the first replay, and "who cleared this" would quietly change its answer.
    /// </summary>
    public Result<QuarantinedSeries> Resolve(
        DateTimeOffset resolvedAt,
        string resolvedBy,
        Guid? resolvedByReplayOfMessageId)
    {
        if (ResolvedAt is not null)
        {
            return Result<QuarantinedSeries>.Failure(
                "That quarantined series has already been resolved.");
        }

        if (string.IsNullOrWhiteSpace(resolvedBy))
        {
            return Result<QuarantinedSeries>.Failure(
                "A quarantined series must record who resolved it.");
        }

        if (resolvedAt < ReceivedAt)
        {
            return Result<QuarantinedSeries>.Failure(
                "A quarantined series cannot be resolved before it was received.");
        }

        ResolvedAt = resolvedAt;
        ResolvedBy = resolvedBy.Trim();
        ResolvedByReplayOfMessageId = resolvedByReplayOfMessageId;

        return Result<QuarantinedSeries>.Success(this);
    }
}
```

- [ ] **Step 4: Write `OperationalAlert`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Metering/OperationalAlert.cs`:

```csharp
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Metering;

/// <summary>
/// The conditions of [F02-R12], [F02-R26], [F02-R34], [F02-R35] and [F02-R45].
/// <para>
/// ⚠ The CONDITIONS are built and tested in slice 2; only the DELIVERY CHANNEL is deferred
/// (design section 3.2). Each condition writes a row here, the employee data-health screens render
/// it, and no mail, pager or webhook is wired. [DEC-104] is one operator with no rota, so a channel
/// with no rota behind it is decoration - and this is why the Phase-1 exit criterion "ingestion
/// alerting proven by a deliberate outage test" is NOT met (design section 1.1).
/// </para>
/// <para>
/// ⚠ This entity deliberately carries NO CustomerId, for the same reason
/// <see cref="QuarantinedSeries"/> does not: an alert is operational, not tenant data, and
/// contract section 5 makes the count of CustomerId-bearing entities exactly four.
/// </para>
/// </summary>
public sealed class OperationalAlert
{
    /// <summary>EF Core materialises through this; application code uses <see cref="Raise"/>.</summary>
    private OperationalAlert()
    {
    }

    public Guid Id { get; private set; }

    public OperationalAlertKind Kind { get; private set; }

    public OperationalAlertStatus Status { get; private set; }

    public Guid? MeteringPointId { get; private set; }

    public Guid? BrpId { get; private set; }

    public Guid? InboundMessageId { get; private set; }

    public DateOnly? DeliveryDate { get; private set; }

    /// <summary>One sentence, sentence case, ending in a full stop. Rendered as prose.</summary>
    public string Summary { get; private set; } = string.Empty;

    public string? Detail { get; private set; }

    public DateTimeOffset RaisedAt { get; private set; }

    public DateTimeOffset? ResolvedAt { get; private set; }

    /// <summary>
    /// Every context argument is optional because a condition may have none of them:
    /// MISSING_PRODUCTION_DECLARATION names a metering point but no message and no date, and a
    /// future portfolio-level condition may name nothing at all. Migration 9 makes every context
    /// column nullable for the same reason.
    /// </summary>
    public static Result<OperationalAlert> Raise(
        OperationalAlertKind kind,
        string summary,
        string? detail,
        DateTimeOffset raisedAt,
        Guid? meteringPointId = null,
        Guid? brpId = null,
        Guid? inboundMessageId = null,
        DateOnly? deliveryDate = null)
    {
        if (string.IsNullOrWhiteSpace(summary))
        {
            return Result<OperationalAlert>.Failure("An operational alert must carry a summary.");
        }

        var trimmed = summary.Trim();
        if (!trimmed.EndsWith('.'))
        {
            return Result<OperationalAlert>.Failure(
                "An operational alert summary must be one sentence ending in a full stop.");
        }

        return Result<OperationalAlert>.Success(new OperationalAlert
        {
            Id = Guid.CreateVersion7(),
            Kind = kind,
            Status = OperationalAlertStatus.Open,
            MeteringPointId = meteringPointId,
            BrpId = brpId,
            InboundMessageId = inboundMessageId,
            DeliveryDate = deliveryDate,
            Summary = trimmed,
            Detail = string.IsNullOrWhiteSpace(detail) ? null : detail.Trim(),
            RaisedAt = raisedAt,
        });
    }

    public Result<OperationalAlert> Resolve(DateTimeOffset resolvedAt)
    {
        if (ResolvedAt is not null)
        {
            return Result<OperationalAlert>.Failure(
                "That operational alert has already been resolved.");
        }

        if (resolvedAt < RaisedAt)
        {
            return Result<OperationalAlert>.Failure(
                "An operational alert cannot be resolved before it was raised.");
        }

        Status = OperationalAlertStatus.Resolved;
        ResolvedAt = resolvedAt;

        return Result<OperationalAlert>.Success(this);
    }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS.

- [ ] **Step 6: Mutate the verbatim-resource-object rule**

This is the rule that keeps a labelled document from becoming a false `UNKNOWN_EAN` in the
employee's eyes. Change `Quarantine` to "normalise" it, which is exactly what a well-meaning
implementer does:

```csharp
            // MUTATION
            ResourceObject = resourceObject.Trim().ToUpperInvariant(),
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo --filter "FullyQualifiedName~The_resource_object_is_carried_verbatim_whatever_shape_it_had"`
Expected: FAIL — three of the five theory cases go red:
`(resourceObject: "Prognosis")` with `series.ResourceObject should be "Prognosis" but was "PROGNOSIS"`,
and the same for `Realisation` and `NL-PVNED-PORTFOLIO-01`.

⚠ The `"871685900000000042"` case stays green under the mutation — an all-digit string is
unchanged by `ToUpperInvariant`. That is the easy neighbouring case, and it is why the theory
carries the label rows at all.

Restore the verbatim assignment, then mutate the full-stop rule:

```csharp
        // MUTATION - removed for one run
        // if (!trimmed.EndsWith('.'))
        // {
        //     return Result<OperationalAlert>.Failure(
        //         "An operational alert summary must be one sentence ending in a full stop.");
        // }
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo --filter "FullyQualifiedName~A_summary_that_does_not_end_in_a_full_stop_is_rejected"`
Expected: FAIL — `result.Error should be "An operational alert summary must be one sentence ending
in a full stop." but was ""`.

Restore both and re-run:

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Metering/QuarantinedSeries.cs \
        src/Core/PeakPower.Domain/Metering/OperationalAlert.cs \
        tests/PeakPower.Domain.Tests/Metering/QuarantinedSeriesTests.cs \
        tests/PeakPower.Domain.Tests/Metering/OperationalAlertTests.cs
git commit -m "feat(domain): add QuarantinedSeries and OperationalAlert

Neither carries a CustomerId, and that is load-bearing: the shared contract fixes the
count of CustomerId-bearing entities at four and both coverage guards' arithmetic moves by
exactly that. resource_object is carried verbatim [F02-R11]/[AS-17] - the mutation that
'normalises' it goes red on the three LABEL cases and stays green on the all-digit EAN,
which is why the theory carries labels at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `MeteringPointBrpAssignment`, and `MeteringPoint`'s four new properties

`[F02-R43]` asks for three things a `brp_assigned_at` timestamp alone cannot answer: **who** moved
the metering point, **when**, and **why**. The published DDL §3.2.1 says the change event is "an
ordinary `audit` row"; contract §16 item 3 overrules that and makes it a first-class table, because
`[F02-R43]` also says **the assignment in force at receipt time decides `WRONG_BRP`**, and an audit
payload is not a queryable history. Design §3.1 names the table explicitly.

`MeteringPoint` gains four columns:

| Column | Property | Why |
| --- | --- | --- |
| `brp_assigned_at` | `BrpAssignedAt` | When the current assignment started. `NOT NULL DEFAULT now()`, store-generated |
| `first_production_observed_at` | `FirstProductionObservedAt` | `[F02-R34]`'s promotion stamp |
| `production_expectation_set_by` | `ExpectationSetBy` | `[F02-R33]`/`[F01-R40]`: the declared zero must be traceable to its **setter** |
| `production_expectation_set_at` | `ExpectationSetAt` | …and to its **date** |

⚠ **Two of those columns and properties do not agree under snake_case, and both spellings are the
contract's.** Contract §6.2's SQL block spells the columns `production_expectation_set_by` /
`_set_at`; its prose names the properties `ExpectationSetBy` / `ExpectationSetAt`. Task 10 bridges
them with an explicit fluent `HasColumnName` — the only two in the plan — and pins the mapping with
a model test. This is deviation **A** in the front matter and is flagged for the contract owner.

And one check constraint:

```sql
ALTER TABLE customer.metering_point
    ADD CONSTRAINT ck_mp_never_has_no_observed_production
    CHECK (production_expectation <> 'NEVER' OR first_production_observed_at IS NULL);
```

⚠ **That constraint is what forces `[F02-R34]`'s promotion into the same transaction.** Observed
production contradicts `NEVER`, and the processor must **resolve** the contradiction rather than log
it. Making the combination unstorable means a `NEVER` point cannot be left carrying an observed
production stamp beside master data that disagrees with it — the database refuses the halfway state.
`RecordObservedProduction` therefore sets five fields at once, and Task 18 proves the halfway state is
refused by PostgreSQL.

⚠ **`MeteringPoint.Attach` keeps its signature.** `BrpAssignedAt` is store-generated
(deviation **E**): adding a `DateTimeOffset` parameter would move ten call sites across four
projects — `MeteringPointEndpoints.cs:86`, `ConnectionEndpoints.cs:269`, `DemoDataSeeder.cs:143`
and seven test files — for no gain, and `Attach` may not read a clock because architecture fact 5 is
IL-enforced.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/MeteringPointBrpAssignment.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/MeteringPoint.cs` (add after `:58`, and three methods after `:137`)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Customers/MeteringPointBrpAssignmentTests.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Customers/MeteringPointTests.cs` (append)

**Interfaces:**
- Consumes: `Result<T>`, `ProductionExpectation`, `ProductionExpectationSource`.
- Produces:
  - `PeakPower.Domain.Customers.MeteringPointBrpAssignment` with `Id`, `MeteringPointId`,
    `FromBrpId`, `ToBrpId`, `AssignedAt`, `AssignedBy`, `Reason`.
  - `MeteringPointBrpAssignment.Record(Guid meteringPointId, Guid? fromBrpId, Guid toBrpId, DateTimeOffset assignedAt, string assignedBy, string reason)` → `Result<MeteringPointBrpAssignment>`
  - `MeteringPointBrpAssignment.MigrationActor` = `"system:migration-9"`.
  - `MeteringPoint.BrpAssignedAt` (`DateTimeOffset`), `MeteringPoint.FirstProductionObservedAt`
    (`DateTimeOffset?`), `MeteringPoint.ExpectationSetBy` (`string?`),
    `MeteringPoint.ExpectationSetAt` (`DateTimeOffset?`).
  - `Result<MeteringPoint> MeteringPoint.RecordObservedProduction(DateTimeOffset observedAt, string setBy)`
    — ⚠ **a cross-plan seam.** Plan 5 calls exactly this from `[F02-R34]`'s same-transaction
    promotion; plan 2 declares it and plan 5 consumes it. It promotes **only** when
    `ProductionExpectation == ProductionExpectation.Never`.
  - `MeteringPoint.IngestionPromotionActor` = `"system:ingestion"` — the actor plan 5 passes as
    `setBy`, a constant so the two plans and the employee data-health screen cannot drift apart.
  - `Result<MeteringPoint> MeteringPoint.DeclareProductionExpectation(ProductionExpectation expectation, ProductionExpectationSource source, string setBy, DateTimeOffset setAt)`
  - `Result<MeteringPoint> MeteringPoint.ReassignBrp(Guid toBrpId, DateTimeOffset assignedAt)`

- [ ] **Step 1: Write the failing tests**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Customers/MeteringPointBrpAssignmentTests.cs`:

```csharp
using Shouldly;
using Xunit;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;

namespace PeakPower.Domain.Tests.Customers;

public sealed class MeteringPointBrpAssignmentTests
{
    private static readonly Guid MeteringPointId = Guid.Parse("0199a1a0-0000-7000-8000-000000000101");
    private static readonly Guid PvnedId = Guid.Parse("0199a1a0-0000-7000-8000-0000000000b1");
    private static readonly Guid SecondBrpId = Guid.Parse("0199a1a0-0000-7000-8000-0000000000b2");
    private static readonly DateTimeOffset AssignedAt =
        new(2026, 9, 1, 9, 0, 0, TimeSpan.Zero);

    private static Result<MeteringPointBrpAssignment> Record(
        Guid? fromBrpId = null,
        Guid? toBrpId = null,
        string assignedBy = "employee:thinh@kikker.nl",
        string reason = "The customer switched balance responsible party on 1 September.",
        Guid? meteringPointId = null) =>
        MeteringPointBrpAssignment.Record(
            meteringPointId ?? MeteringPointId,
            fromBrpId,
            toBrpId ?? SecondBrpId,
            AssignedAt,
            assignedBy,
            reason);

    /// <summary>
    /// [F02-R43] asks for three things brp_assigned_at alone cannot answer: WHO moved the point,
    /// WHEN, and WHY. The published DDL section 3.2.1 calls the event "an ordinary audit row";
    /// shared contract section 16 item 3 overrules it, because [F02-R43] also says the assignment
    /// IN FORCE AT RECEIPT TIME decides WRONG_BRP, and an audit payload is not a queryable
    /// history.
    /// </summary>
    [Fact]
    public void An_assignment_records_the_move_the_actor_and_the_reason()
    {
        var assignment = Record(fromBrpId: PvnedId).Value;

        assignment.Id.ShouldNotBe(Guid.Empty);
        assignment.MeteringPointId.ShouldBe(MeteringPointId);
        assignment.FromBrpId.ShouldBe(PvnedId);
        assignment.ToBrpId.ShouldBe(SecondBrpId);
        assignment.AssignedAt.ShouldBe(AssignedAt);
        assignment.AssignedBy.ShouldBe("employee:thinh@kikker.nl");
        assignment.Reason.ShouldBe("The customer switched balance responsible party on 1 September.");
    }

    [Fact]
    public void The_first_assignment_has_no_previous_BRP()
    {
        var assignment = Record(fromBrpId: null, toBrpId: PvnedId).Value;

        assignment.FromBrpId.ShouldBeNull();
        assignment.ToBrpId.ShouldBe(PvnedId);
    }

    [Fact]
    public void An_assignment_must_name_a_metering_point()
    {
        Record(meteringPointId: Guid.Empty).Error
            .ShouldBe("A BRP assignment must name a metering point.");
    }

    [Fact]
    public void An_assignment_must_name_the_BRP_it_moves_to()
    {
        Record(toBrpId: Guid.Empty).Error
            .ShouldBe("A BRP assignment must name the balance responsible party it moves to.");
    }

    [Fact]
    public void An_assignment_to_the_BRP_it_is_already_on_is_rejected()
    {
        // A "reassignment" to the same BRP is a no-op the history must not carry: it would make
        // "which assignment was in force at receipt time" ambiguous between two rows that say the
        // same thing, and it would let an employee manufacture an audit trail without changing
        // anything.
        Record(fromBrpId: SecondBrpId, toBrpId: SecondBrpId).Error
            .ShouldBe("A BRP assignment must move the metering point to a different party.");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void An_assignment_without_an_actor_is_rejected(string assignedBy)
    {
        Record(assignedBy: assignedBy).Error
            .ShouldBe("A BRP assignment must record who made it.");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void An_assignment_without_a_reason_is_rejected(string reason)
    {
        // Mandatory, because "why" is a third of what [F02-R43] asks for and the only part that
        // cannot be reconstructed afterwards from any other column.
        Record(reason: reason).Error
            .ShouldBe("A BRP assignment must record why it was made.");
    }

    [Fact]
    public void The_actor_and_the_reason_are_trimmed()
    {
        var assignment = Record(
            assignedBy: "  employee:thinh@kikker.nl  ",
            reason: "  A reason.  ").Value;

        assignment.AssignedBy.ShouldBe("employee:thinh@kikker.nl");
        assignment.Reason.ShouldBe("A reason.");
    }

    [Fact]
    public void The_migration_actor_is_a_named_constant_so_the_backfill_and_its_test_agree()
    {
        MeteringPointBrpAssignment.MigrationActor.ShouldBe("system:migration-9");
    }
}
```

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Customers/MeteringPointTests.cs`,
inside the existing class, immediately before its closing brace:

```csharp
    private static readonly Guid SecondBrpId = Guid.Parse("0199a1a0-0000-7000-8000-0000000000b2");

    private static readonly DateTimeOffset ObservedAt =
        new(2026, 8, 13, 4, 2, 12, TimeSpan.Zero);

    /// <summary>
    /// [F02-R34]: an A01 series arriving for a point recorded NEVER is stored and used normally -
    /// a document is never discarded because master data disagrees with it - and the SAME
    /// TRANSACTION resolves the contradiction, moving the point to EXPECTED with source OBSERVED
    /// and stamping first_production_observed_at.
    /// <para>
    /// Five fields move together because migration 9's ck_mp_never_has_no_observed_production
    /// makes the halfway state UNSTORABLE: production_expectation &lt;&gt; 'NEVER' OR
    /// first_production_observed_at IS NULL. A promotion that set only the stamp would be refused
    /// by PostgreSQL, which is the point of the constraint.
    /// </para>
    /// </summary>
    [Fact]
    public void Observed_production_promotes_a_NEVER_point_and_stamps_all_five_fields_at_once()
    {
        var point = MeteringPoint.Attach(
            CustomerId, Ean, BrpId, ProductionExpectation.Never,
            ProductionExpectationSource.CustomerDeclared, name: null, description: null,
            gridOperator: null, capacityKw: null, address: null,
            validFrom: new DateOnly(2026, 1, 1)).Value;

        var promoted = point.RecordObservedProduction(ObservedAt, MeteringPoint.IngestionPromotionActor).Value;

        promoted.ProductionExpectation.ShouldBe(ProductionExpectation.Expected);
        promoted.ExpectationSource.ShouldBe(ProductionExpectationSource.Observed);
        promoted.FirstProductionObservedAt.ShouldBe(ObservedAt);
        // The literal, deliberately, and only here: this is what pins the constant's VALUE. Plan
        // 5's recomputer and the employee data-health screen both read the same string, so a
        // constant nobody checks the spelling of is three copies with extra steps.
        promoted.ExpectationSetBy.ShouldBe("system:ingestion");
        promoted.ExpectationSetAt.ShouldBe(ObservedAt);
    }

    /// <summary>
    /// ⚠ The counterpart to the promotion above, and the reason the guard is
    /// <c>== ProductionExpectation.Never</c> rather than <c>is Never or Unknown</c>.
    /// <para>
    /// [F02-R34] names only the NEVER point: observed production CONTRADICTS a declared never, and
    /// the contradiction is what has to be resolved in the same transaction. An UNKNOWN point
    /// contradicts nothing - nobody has said anything about it yet - and it is exactly the set
    /// [F02-R35]'s onboarding worklist is built from. Promoting UNKNOWN here would empty that
    /// worklist silently: every connection that ever fed in would look declared, and the screen
    /// that exists to collect the missing declarations would have nothing to show. The stamp still
    /// lands, because the point HAS been observed producing; only the expectation is left alone.
    /// </para>
    /// </summary>
    [Fact]
    public void Observed_production_does_not_promote_an_UNKNOWN_point_because_that_would_empty_the_R35_worklist()
    {
        var point = MeteringPoint.Attach(
            CustomerId, Ean, BrpId, ProductionExpectation.Unknown,
            expectationSource: null, name: null, description: null,
            gridOperator: null, capacityKw: null, address: null,
            validFrom: new DateOnly(2026, 1, 1)).Value;

        point.RecordObservedProduction(ObservedAt, MeteringPoint.IngestionPromotionActor);

        point.ProductionExpectation.ShouldBe(ProductionExpectation.Unknown,
            "[F02-R34] promotes NEVER only; an UNKNOWN point stays on [F02-R35]'s worklist " +
            "until somebody declares it");
        point.ExpectationSource.ShouldBeNull();
        point.ExpectationSetBy.ShouldBeNull();
        point.FirstProductionObservedAt.ShouldBe(ObservedAt,
            "the stamp is not conditional on the promotion - the point HAS produced");
    }

    [Fact]
    public void Observing_production_twice_keeps_the_first_moment_because_it_is_the_FIRST_observation()
    {
        var point = MeteringPoint.Attach(
            CustomerId, Ean, BrpId, ProductionExpectation.Never,
            ProductionExpectationSource.CustomerDeclared, name: null, description: null,
            gridOperator: null, capacityKw: null, address: null,
            validFrom: new DateOnly(2026, 1, 1)).Value;
        point.RecordObservedProduction(ObservedAt, MeteringPoint.IngestionPromotionActor);

        point.RecordObservedProduction(ObservedAt.AddDays(30), MeteringPoint.IngestionPromotionActor);

        point.FirstProductionObservedAt.ShouldBe(ObservedAt,
            "the column is FIRST production observed - a later series must not overwrite it");
    }

    [Fact]
    public void Observing_production_on_an_already_EXPECTED_point_still_stamps_the_first_observation()
    {
        // The promotion alert is [F02-R34]'s, but the stamp is not conditional on the promotion:
        // a point recorded EXPECTED from its contract has still never been OBSERVED producing
        // until now, and the employee data-health screen shows the difference.
        var point = MeteringPoint.Attach(
            CustomerId, Ean, BrpId, ProductionExpectation.Expected,
            ProductionExpectationSource.Contract, name: null, description: null,
            gridOperator: null, capacityKw: null, address: null,
            validFrom: new DateOnly(2026, 1, 1)).Value;

        point.RecordObservedProduction(ObservedAt, MeteringPoint.IngestionPromotionActor);

        point.FirstProductionObservedAt.ShouldBe(ObservedAt);
        point.ProductionExpectation.ShouldBe(ProductionExpectation.Expected);
        point.ExpectationSource.ShouldBe(ProductionExpectationSource.Contract,
            "an EXPECTED point's source is not rewritten by an observation that agrees with it");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Observed_production_must_name_who_or_what_recorded_it(string setBy)
    {
        var point = MeteringPoint.Attach(
            CustomerId, Ean, BrpId, ProductionExpectation.Never,
            ProductionExpectationSource.CustomerDeclared, name: null, description: null,
            gridOperator: null, capacityKw: null, address: null,
            validFrom: new DateOnly(2026, 1, 1)).Value;

        point.RecordObservedProduction(ObservedAt, setBy).Error
            .ShouldBe("An observed production expectation must name what recorded it.");
    }

    /// <summary>
    /// [F02-R33]/[F01-R40]: a declared zero must be traceable to its SOURCE, its SETTER and its
    /// DATE. Slice 1 shipped only expectation_source, so without the two columns this method sets,
    /// the chart's declared-zero treatment is unbuildable and section 10.1's productionDeclaration
    /// has nothing to carry.
    /// </summary>
    [Fact]
    public void Declaring_a_production_expectation_records_its_source_its_setter_and_its_date()
    {
        var setAt = new DateTimeOffset(2026, 7, 1, 8, 14, 0, TimeSpan.Zero);
        var point = MeteringPoint.Attach(
            CustomerId, Ean, BrpId, ProductionExpectation.Unknown,
            expectationSource: null, name: null, description: null,
            gridOperator: null, capacityKw: null, address: null,
            validFrom: new DateOnly(2026, 1, 1)).Value;

        var declared = point.DeclareProductionExpectation(
            ProductionExpectation.Never,
            ProductionExpectationSource.CustomerDeclared,
            "p.devries@vandersteen.nl",
            setAt).Value;

        declared.ProductionExpectation.ShouldBe(ProductionExpectation.Never);
        declared.ExpectationSource.ShouldBe(ProductionExpectationSource.CustomerDeclared);
        declared.ExpectationSetBy.ShouldBe("p.devries@vandersteen.nl");
        declared.ExpectationSetAt.ShouldBe(setAt);
    }

    [Fact]
    public void Declaring_NEVER_on_a_point_that_has_already_produced_is_rejected()
    {
        // The application half of ck_mp_never_has_no_observed_production. The database refuses the
        // row; this refuses it with a sentence somebody can act on, and one layer earlier.
        var point = MeteringPoint.Attach(
            CustomerId, Ean, BrpId, ProductionExpectation.Expected,
            ProductionExpectationSource.Observed, name: null, description: null,
            gridOperator: null, capacityKw: null, address: null,
            validFrom: new DateOnly(2026, 1, 1)).Value;
        point.RecordObservedProduction(ObservedAt, MeteringPoint.IngestionPromotionActor);

        point.DeclareProductionExpectation(
            ProductionExpectation.Never,
            ProductionExpectationSource.CustomerDeclared,
            "p.devries@vandersteen.nl",
            ObservedAt.AddDays(1))
            .Error.ShouldBe(
                "This connection has already been observed producing, so its production " +
                "expectation cannot be set to NEVER.");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Declaring_a_production_expectation_must_name_its_setter(string setBy)
    {
        var point = MeteringPoint.Attach(
            CustomerId, Ean, BrpId, ProductionExpectation.Unknown,
            expectationSource: null, name: null, description: null,
            gridOperator: null, capacityKw: null, address: null,
            validFrom: new DateOnly(2026, 1, 1)).Value;

        point.DeclareProductionExpectation(
            ProductionExpectation.Never, ProductionExpectationSource.CustomerDeclared, setBy,
            ObservedAt).Error
            .ShouldBe("A production expectation must name who set it.");
    }

    [Fact]
    public void Reassigning_to_another_BRP_moves_the_point_and_stamps_the_moment()
    {
        var assignedAt = new DateTimeOffset(2026, 9, 1, 9, 0, 0, TimeSpan.Zero);
        var point = MeteringPoint.Attach(
            CustomerId, Ean, BrpId, ProductionExpectation.Unknown,
            expectationSource: null, name: null, description: null,
            gridOperator: null, capacityKw: null, address: null,
            validFrom: new DateOnly(2026, 1, 1)).Value;

        var reassigned = point.ReassignBrp(SecondBrpId, assignedAt).Value;

        reassigned.BrpId.ShouldBe(SecondBrpId);
        reassigned.BrpAssignedAt.ShouldBe(assignedAt);
    }

    [Fact]
    public void Reassigning_to_the_same_BRP_is_rejected()
    {
        var point = MeteringPoint.Attach(
            CustomerId, Ean, BrpId, ProductionExpectation.Unknown,
            expectationSource: null, name: null, description: null,
            gridOperator: null, capacityKw: null, address: null,
            validFrom: new DateOnly(2026, 1, 1)).Value;

        point.ReassignBrp(BrpId, ObservedAt).Error
            .ShouldBe("A metering point is already assigned to that balance responsible party.");
    }

    [Fact]
    public void Reassigning_to_no_BRP_is_rejected()
    {
        var point = MeteringPoint.Attach(
            CustomerId, Ean, BrpId, ProductionExpectation.Unknown,
            expectationSource: null, name: null, description: null,
            gridOperator: null, capacityKw: null, address: null,
            validFrom: new DateOnly(2026, 1, 1)).Value;

        point.ReassignBrp(Guid.Empty, ObservedAt).Error
            .ShouldBe("A metering point must name a balance responsible party.");
    }
```

⚠ `MeteringPointTests` already declares `CustomerId`, `Ean` and `BrpId` as private statics. Read
`tests/PeakPower.Domain.Tests/Customers/MeteringPointTests.cs:1-30` before pasting and reuse those
names; do not redeclare them. Add `SecondBrpId` and `ObservedAt` only.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: FAIL to build with
`error CS0246: The type or namespace name 'MeteringPointBrpAssignment' could not be found`,
`error CS1061: 'MeteringPoint' does not contain a definition for 'RecordObservedProduction'`,
`… 'DeclareProductionExpectation'`, `… 'ReassignBrp'`, `… 'FirstProductionObservedAt'`,
`… 'ExpectationSetBy'`, `… 'ExpectationSetAt'` and `… 'BrpAssignedAt'`.

- [ ] **Step 3: Write `MeteringPointBrpAssignment`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/MeteringPointBrpAssignment.cs`:

```csharp
using PeakPower.Domain.Common;

namespace PeakPower.Domain.Customers;

/// <summary>
/// Who moved a metering point to another balance responsible party, when, and why. [F02-R43]
/// <para>
/// A first-class table rather than the published DDL section 3.2.1's "ordinary audit row", because
/// [F02-R43] also says the assignment IN FORCE AT RECEIPT TIME decides WRONG_BRP, and an audit
/// payload is not a queryable history. Shared contract section 16 item 3; design section 3.1 names
/// the table explicitly.
/// </para>
/// <para>
/// Reassignment reads FORWARD [DEC-07]: nothing is rewritten, and versions already stored keep the
/// BRP that produced them. This table answers "which BRP was this point on at time T", which is
/// what an in-flight document from the previous BRP has to be judged against.
/// </para>
/// <para>
/// ⚠ Employee-only. It carries no CustomerId - contract section 5 fixes that count at four - so
/// migration 9 gives it REVOKE ALL from app_customer_role and an app_employee_role policy, and
/// neither coverage guard discovers it.
/// </para>
/// </summary>
public sealed class MeteringPointBrpAssignment
{
    /// <summary>
    /// The actor migration 9's backfill writes. A constant so the migration, the schema test and
    /// the verify script all name the same string rather than three copies of it.
    /// </summary>
    public const string MigrationActor = "system:migration-9";

    /// <summary>EF Core materialises through this; application code uses <see cref="Record"/>.</summary>
    private MeteringPointBrpAssignment()
    {
    }

    public Guid Id { get; private set; }

    public Guid MeteringPointId { get; private set; }

    /// <summary>Null on the first assignment - the point had no previous party.</summary>
    public Guid? FromBrpId { get; private set; }

    public Guid ToBrpId { get; private set; }

    public DateTimeOffset AssignedAt { get; private set; }

    /// <summary>An employee identifier, or <see cref="MigrationActor"/> for the backfilled rows.</summary>
    public string AssignedBy { get; private set; } = string.Empty;

    /// <summary>Mandatory and non-empty - "why" is the third of [F02-R43]'s three questions.</summary>
    public string Reason { get; private set; } = string.Empty;

    public static Result<MeteringPointBrpAssignment> Record(
        Guid meteringPointId,
        Guid? fromBrpId,
        Guid toBrpId,
        DateTimeOffset assignedAt,
        string assignedBy,
        string reason)
    {
        if (meteringPointId == Guid.Empty)
        {
            return Result<MeteringPointBrpAssignment>.Failure(
                "A BRP assignment must name a metering point.");
        }

        if (toBrpId == Guid.Empty)
        {
            return Result<MeteringPointBrpAssignment>.Failure(
                "A BRP assignment must name the balance responsible party it moves to.");
        }

        // A "reassignment" to the same party is a no-op the history must not carry: it would make
        // "which assignment was in force at receipt time" ambiguous between two rows saying the
        // same thing, and it would let an actor manufacture a trail without changing anything.
        if (fromBrpId == toBrpId)
        {
            return Result<MeteringPointBrpAssignment>.Failure(
                "A BRP assignment must move the metering point to a different party.");
        }

        if (string.IsNullOrWhiteSpace(assignedBy))
        {
            return Result<MeteringPointBrpAssignment>.Failure(
                "A BRP assignment must record who made it.");
        }

        if (string.IsNullOrWhiteSpace(reason))
        {
            return Result<MeteringPointBrpAssignment>.Failure(
                "A BRP assignment must record why it was made.");
        }

        return Result<MeteringPointBrpAssignment>.Success(new MeteringPointBrpAssignment
        {
            Id = Guid.CreateVersion7(),
            MeteringPointId = meteringPointId,
            FromBrpId = fromBrpId,
            ToBrpId = toBrpId,
            AssignedAt = assignedAt,
            AssignedBy = assignedBy.Trim(),
            Reason = reason.Trim(),
        });
    }
}
```

- [ ] **Step 4: Add the four properties and three mutators to `MeteringPoint`**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/MeteringPoint.cs`,
insert after line `58` (immediately after `public DateOnly? ValidTo { get; private set; }` and
before the `DisplayLabel` doc comment):

```csharp

    /// <summary>
    /// When the CURRENT balance-responsible-party assignment started. The full history - actor and
    /// reason included - is <see cref="MeteringPointBrpAssignment"/>, because this column alone
    /// cannot answer who moved the point or why, which is what [F02-R43] asks for.
    /// <para>
    /// Store-generated: the column is <c>NOT NULL DEFAULT now()</c> and <see cref="Attach"/> may
    /// not read a clock - architecture fact 5 is IL-enforced and confines that to
    /// PeakPower.Infrastructure.Time. MeteringPointConfiguration maps it ValueGeneratedOnAdd, so
    /// EF omits the column on insert and reads the database's answer back.
    /// <see cref="ReassignBrp"/> sets it explicitly, because an UPDATE has no store default.
    /// </para>
    /// </summary>
    public DateTimeOffset BrpAssignedAt { get; private set; }

    /// <summary>
    /// The first moment an A01 series was seen for this connection. [F02-R34]
    /// ⚠ FIRST, so it is never overwritten by a later observation.
    /// </summary>
    public DateTimeOffset? FirstProductionObservedAt { get; private set; }

    /// <summary>
    /// Who set <see cref="ProductionExpectation"/>. [F02-R33]/[F01-R40] require a declared zero to
    /// be traceable to its SOURCE, its SETTER and its DATE; slice 1 shipped only the source.
    /// ⚠ Mapped to the column <c>production_expectation_set_by</c> by an explicit HasColumnName -
    /// see MeteringPointConfiguration's comment.
    /// </summary>
    public string? ExpectationSetBy { get; private set; }

    /// <summary>
    /// When <see cref="ProductionExpectation"/> was set. ⚠ Mapped to the column
    /// <c>production_expectation_set_at</c> by an explicit HasColumnName.
    /// </summary>
    public DateTimeOffset? ExpectationSetAt { get; private set; }
```

Then insert the three mutators after line `137` — that is, after the closing brace of `Rename` and
before the `UpdateDetails` doc comment:

```csharp

    /// <summary>
    /// The actor the ingestion pipeline names when [F02-R34]'s promotion writes
    /// <see cref="ExpectationSetBy"/>. A constant rather than a literal at each call site, because
    /// plan 5's recomputer, plan 2's tests and the employee data-health screen all have to agree
    /// on the exact string, and three copies of <c>"system:ingestion"</c> is how they stop
    /// agreeing. The employee-set values are e-mail addresses, so a colon-prefixed actor is also
    /// what distinguishes "the pipeline decided this" from "a person did".
    /// </summary>
    public const string IngestionPromotionActor = "system:ingestion";

    /// <summary>
    /// [F02-R34]: an A01 series arrived for this connection. The document is stored and used
    /// normally - a document is never discarded because master data disagrees with it - and the
    /// SAME TRANSACTION resolves the contradiction.
    /// <para>
    /// ⚠ Five fields move together, and that is not tidiness: migration 9's
    /// <c>ck_mp_never_has_no_observed_production</c> makes the halfway state UNSTORABLE
    /// (<c>production_expectation &lt;&gt; 'NEVER' OR first_production_observed_at IS NULL</c>), so
    /// a promotion that set only the stamp would be refused by PostgreSQL. Making the combination
    /// unstorable is what forces the promotion into the same transaction rather than leaving a
    /// reading stored beside master data that disagrees with it.
    /// </para>
    /// <para>
    /// A point already recorded EXPECTED keeps its existing source: an observation that AGREES
    /// with the contract is not a reason to rewrite where the expectation came from. Only the
    /// contradiction - a NEVER point - is a promotion.
    /// </para>
    /// <para>
    /// ⚠ <b>UNKNOWN is deliberately NOT promoted.</b> [F02-R34] names only the NEVER point, and
    /// [F02-R35]'s onboarding worklist is precisely the set of points whose expectation is still
    /// UNKNOWN. Promoting UNKNOWN here would silently empty that worklist: every connection that
    /// ever fed in would look declared, and the employee screen that exists to collect the missing
    /// declarations would show nothing to collect. An UNKNOWN point that produces stays UNKNOWN
    /// until somebody declares it, and keeps its stamp.
    /// </para>
    /// </summary>
    public Result<MeteringPoint> RecordObservedProduction(DateTimeOffset observedAt, string setBy)
    {
        if (string.IsNullOrWhiteSpace(setBy))
        {
            return Result<MeteringPoint>.Failure(
                "An observed production expectation must name what recorded it.");
        }

        // FIRST production observed: a later series must never overwrite the moment.
        FirstProductionObservedAt ??= observedAt;

        if (ProductionExpectation == ProductionExpectation.Never)
        {
            ProductionExpectation = ProductionExpectation.Expected;
            ExpectationSource = ProductionExpectationSource.Observed;
            ExpectationSetBy = setBy.Trim();
            ExpectationSetAt = observedAt;
        }

        return Result<MeteringPoint>.Success(this);
    }

    /// <summary>
    /// Records a production expectation with the three things [F02-R33]/[F01-R40] require of a
    /// declared zero: its source, its setter and its date.
    /// </summary>
    public Result<MeteringPoint> DeclareProductionExpectation(
        ProductionExpectation expectation,
        ProductionExpectationSource source,
        string setBy,
        DateTimeOffset setAt)
    {
        if (string.IsNullOrWhiteSpace(setBy))
        {
            return Result<MeteringPoint>.Failure("A production expectation must name who set it.");
        }

        // The application half of ck_mp_never_has_no_observed_production. The database refuses the
        // row anyway; this refuses it one layer earlier and with a sentence somebody can act on.
        if (expectation is ProductionExpectation.Never && FirstProductionObservedAt is not null)
        {
            return Result<MeteringPoint>.Failure(
                "This connection has already been observed producing, so its production " +
                "expectation cannot be set to NEVER.");
        }

        ProductionExpectation = expectation;
        ExpectationSource = source;
        ExpectationSetBy = setBy.Trim();
        ExpectationSetAt = setAt;

        return Result<MeteringPoint>.Success(this);
    }

    /// <summary>
    /// Moves this point to another balance responsible party and stamps when the new assignment
    /// started. The caller must write a <see cref="MeteringPointBrpAssignment"/> in the same
    /// transaction - that row, not this column, is what [F02-R43] asks for, and it is what decides
    /// WRONG_BRP for an in-flight document from the previous party.
    /// </summary>
    public Result<MeteringPoint> ReassignBrp(Guid toBrpId, DateTimeOffset assignedAt)
    {
        if (toBrpId == Guid.Empty)
        {
            return Result<MeteringPoint>.Failure(
                "A metering point must name a balance responsible party.");
        }

        if (toBrpId == BrpId)
        {
            return Result<MeteringPoint>.Failure(
                "A metering point is already assigned to that balance responsible party.");
        }

        BrpId = toBrpId;
        BrpAssignedAt = assignedAt;

        return Result<MeteringPoint>.Success(this);
    }
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS.

- [ ] **Step 6: Mutate the first-observation rule**

`FirstProductionObservedAt ??= observedAt` is the line a reasonable implementer writes as a plain
assignment, because "the point produced, record it" reads correct. Make that mutation:

```csharp
        // MUTATION
        FirstProductionObservedAt = observedAt;
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo --filter "FullyQualifiedName~Observing_production_twice_keeps_the_first_moment"`
Expected: FAIL — `Observing_production_twice_keeps_the_first_moment_because_it_is_the_FIRST_observation`
fails with
`point.FirstProductionObservedAt should be 2026-08-13T04:02:12.0000000+00:00 but was 2026-09-12T04:02:12.0000000+00:00`
followed by `the column is FIRST production observed - a later series must not overwrite it`.

⚠ Check `Observed_production_promotes_a_NEVER_point_and_stamps_all_five_fields_at_once` still
passes: it does under both, because it observes once. That is the neighbouring case, and the
two-observations test is the one this rule is for.

Restore `??=`, then mutate the promotion guard the way a reasonable implementer widens it —
`UNKNOWN` "reads as `EXPECTED`" under `[DEC-65]`, so promoting it looks like tidying up a second
resolved unknown:

```csharp
        // MUTATION
        if (ProductionExpectation is ProductionExpectation.Never
            or ProductionExpectation.Unknown)
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo --filter "FullyQualifiedName~Observed_production_does_not_promote_an_UNKNOWN_point"`
Expected: FAIL — `Observed_production_does_not_promote_an_UNKNOWN_point_because_that_would_empty_the_R35_worklist`
fails with `point.ProductionExpectation should be Unknown but was Expected`, followed by
`[F02-R34] promotes NEVER only; an UNKNOWN point stays on [F02-R35]'s worklist until somebody declares it`.

⚠ **This is the mutation that matters most in the whole task**, and it is the one an independent
implementer actually made: `[DEC-65]`'s "UNKNOWN reads as EXPECTED for completeness" is about the
*completeness* calculation, not about master data, and carrying it across silently empties
`[F02-R35]`'s worklist. Nothing else in the suite goes red under this mutation — the promotion test
observes a `NEVER` point and passes either way — so this single test is the whole guard. Check that
`Observed_production_promotes_a_NEVER_point_and_stamps_all_five_fields_at_once` still passes under
the mutation: it does, and that is the neighbouring case, not this one.

Restore `== ProductionExpectation.Never` and re-run everything:

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests --nologo`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Customers/MeteringPointBrpAssignment.cs \
        src/Core/PeakPower.Domain/Customers/MeteringPoint.cs \
        tests/PeakPower.Domain.Tests/Customers/MeteringPointBrpAssignmentTests.cs \
        tests/PeakPower.Domain.Tests/Customers/MeteringPointTests.cs
git commit -m "feat(domain): add the BRP assignment history and MeteringPoint's four new columns

[F02-R43] wants actor, timestamp and reason; brp_assigned_at alone answers one of the
three, so the history is a first-class table rather than the published DDL's audit row -
it also has to be queryable, because the assignment in force at RECEIPT time decides
WRONG_BRP. RecordObservedProduction sets five fields at once because migration 9's
ck_mp_never_has_no_observed_production makes the halfway state unstorable. The
first-observation rule is verified by mutation, and so is the promotion guard: [F02-R34]
promotes NEVER only, because promoting UNKNOWN would silently empty [F02-R35]'s
onboarding worklist.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Drop `CustomerAccount.ExternalSubjectId`

`CLAUDE.md` and slice 1's contract §5 both assign this to the migration after slice 1. It is always
null; `[DEC-119]` removed the identity provider it was reserved for. The property, its EF mapping
and the two tests that pin it go now; the `DROP COLUMN` goes into migration 9 in Task 12.

⚠ **One `DROP COLUMN` statement, not two.** The published DDL shows
`CREATE UNIQUE INDEX ux_account_subject … WHERE external_subject_id IS NOT NULL`, but
`20260827051436_InitialSchema.cs` never created it — the three indexes on that table are
`ix_customer_account_customer_id`, `ix_customer_account_email` and `ix_customer_account_username`.
**There is no index to drop**, and a `DROP INDEX` without `IF EXISTS` fails the migration.

⚠ **Check both OpenAPI Verify snapshots and every mapper before calling this free.** Verified today
with a whole-tree search: the only references outside the migration `Designer.cs` files and the
model snapshot are the five listed below. `artifacts/openapi/customer.json`,
`artifacts/openapi/employee.json` and both `*.verified.json` snapshots contain **no**
`externalSubjectId` key, so no snapshot needs re-accepting.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/CustomerAccount.cs:48-54`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/CustomerAccountConfiguration.cs:40`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Customers/CustomerAccountTests.cs:30`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Model/ModelShapeTests.cs:57`

**Interfaces:**
- Consumes: nothing.
- Produces: `CustomerAccount` **without** `ExternalSubjectId`. Task 12's migration drops the column.

- [ ] **Step 1: Write the failing test**

Replace line `57` of
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Model/ModelShapeTests.cs`
— before:

```csharp
        account.GetProperty(nameof(CustomerAccount.ExternalSubjectId)).GetColumnName(storeObject).ShouldBe("external_subject_id");
```

after:

```csharp
        account.GetProperty(nameof(CustomerAccount.PasswordHash)).GetColumnName(storeObject).ShouldBe("password_hash");

        // [DEC-119] removed the identity provider external_subject_id was reserved for, and
        // migration 9 drops the column. Asserted as an ABSENCE as well as by the property being
        // gone: FindProperty returns null rather than throwing, so a property quietly reinstated
        // under the same name would otherwise pass unnoticed.
        account.FindProperty("ExternalSubjectId").ShouldBeNull(
            "[DEC-119] removed the external identity provider; migration 9 drops the column");
    }

    [Fact]
    public void The_dead_external_subject_column_is_gone_from_the_model_entirely()
    {
        var storeObject = Microsoft.EntityFrameworkCore.Metadata.StoreObjectIdentifier
            .Table("customer_account", "customer");

        _context.Model.FindEntityType(typeof(CustomerAccount))!
            .GetProperties()
            .Select(property => property.GetColumnName(storeObject))
            .ShouldNotContain("external_subject_id");
```

⚠ The replacement closes the existing `Columns_are_snake_case_without_a_single_attribute_in_the_domain`
method and opens a second one, so the closing brace already on line 58 becomes that second method's.
Read `:47-59` before editing and confirm the braces balance.

Then delete line `30` of
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Customers/CustomerAccountTests.cs`:

```csharp
        account.ExternalSubjectId.ShouldBeNull();      // DELETE this line
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~ModelShapeTests"`
Expected: FAIL — `The_dead_external_subject_column_is_gone_from_the_model_entirely` fails with
`… should not contain "external_subject_id" but was ["id", "customer_id", …, "external_subject_id", …]`,
and `Columns_are_snake_case_without_a_single_attribute_in_the_domain` fails with
`account.FindProperty("ExternalSubjectId") should be null but was Property: CustomerAccount.ExternalSubjectId (string)`.

- [ ] **Step 3: Remove the property**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/CustomerAccount.cs`,
delete lines `48-55` — the doc comment and the property, and the blank line after it:

```csharp
    /// <summary>
    /// Dead column. It was reserved for an external identity provider's subject identifier, which
    /// [DEC-119] drops: the platform owns identity outright, for staff as well as customers, and
    /// there is no external subject to hold. Always null - nothing reads or writes it. Drop the
    /// column in the migration that follows slice 1.
    /// </summary>
    public string? ExternalSubjectId { get; private set; }

```

Nothing else in `CustomerAccount.cs` references it — verified with a whole-file read, and the
`Create` factory never set it.

- [ ] **Step 4: Remove the EF mapping**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/CustomerAccountConfiguration.cs`,
delete line `40`:

```csharp
        builder.Property(account => account.ExternalSubjectId);     // DELETE this line
```

- [ ] **Step 5: Confirm nothing else references it**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -rni 'externalsubject' src tests artifacts > /tmp/ext-after.txt 2>&1
wc -l /tmp/ext-after.txt
```

Read `/tmp/ext-after.txt` — do not trust the terminal. Expected: only the ten
`src/Infrastructure/PeakPower.Persistence/Migrations/*.Designer.cs` hits and
`PeakPowerDbContextModelSnapshot.cs:168`. Those are historical snapshots of past models: a
`Designer.cs` records what the model looked like when its migration was written and is never
regenerated, so leaving them is correct. `PeakPowerDbContextModelSnapshot.cs` is regenerated by
Task 12's `dotnet ef migrations add` and the hit will be gone afterwards.

- [ ] **Step 6: Build and run the model tests**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Domain.Tests --nologo
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~ModelShapeTests"
```

Expected: build clean; both PASS. `ModelShapeTests` builds a model without opening a connection, so
it passes here even though the database still has the column — Task 12's migration and Task 18's
round-trip are what close that.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Customers/CustomerAccount.cs \
        src/Infrastructure/PeakPower.Persistence/Configurations/CustomerAccountConfiguration.cs \
        tests/PeakPower.Domain.Tests/Customers/CustomerAccountTests.cs \
        tests/PeakPower.Integration.Tests/Model/ModelShapeTests.cs
git commit -m "refactor(domain): drop the dead CustomerAccount.ExternalSubjectId property

[DEC-119] removed the identity provider it was reserved for, and CLAUDE.md assigned the
drop to the migration after slice 1. The absence is asserted as well as the removal:
FindProperty returns null rather than throwing, so a property reinstated under the same
name would otherwise pass unnoticed. Migration 9 drops the column - one statement, because
InitialSchema never created the ux_account_subject index the published DDL shows.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: The eight EF configurations, the eight `DbSet`s, and the enum-discovery literal

The model has to describe migration 9's schema exactly, because Task 12 writes the migration as
**hand-written raw SQL** rather than letting EF scaffold it. The reason is the partitioned table:
`migrationBuilder.CreateTable` cannot emit `PARTITION BY RANGE`, and half a scaffolded migration
plus half a hand-written one is worse than one of either. The model snapshot is still generated
from these configurations, so a future `dotnet ef migrations add` diffs cleanly — and Task 18's
round-trip through EF against a real container is what proves the model and the SQL agree, because
a column name or type that disagrees makes EF's `INSERT` fail.

Three things worth stating before the code:

⚠ **`remote_ip` is `inet`, and a `string` property cannot reach it.** Verified today against
`postgres:17`: a `text`-typed parameter into an `inet` column fails with
`ERROR: column "ip" is of type inet but expression is of type text` (SQLSTATE `42804`). Contract §5
pins the property as `string?`, so the configuration converts through `System.Net.IPAddress`, which
Npgsql maps to `inet` natively. EF applies a non-nullable converter to the non-null values of a
nullable property and handles the nulls itself.

⚠ **Three properties are store-generated**: `Brp.CreatedAt`, `MeteringPoint.BrpAssignedAt` and
`IntervalDataVersion.CreatedAt`. All three are `NOT NULL DEFAULT now()` and none of their factories
may read a clock. `.HasDefaultValueSql("now()").ValueGeneratedOnAdd()` makes EF omit the column when
the property holds the CLR default and read the generated value back.

⚠ **`ExpectationSetBy` and `ExpectationSetAt` carry the only two explicit `HasColumnName` calls in
the plan** — deviation **A**. Every other property maps by convention.

**Files:**
- Create: eight files under `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/BrpConfiguration.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/MeteringPointConfiguration.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs` (eight `DbSet`s)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract/EnumWireAlgorithmDivergenceTests.cs:53`, `:79-98`, `:155`, `:163`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Model/IngestionModelShapeTests.cs` (create)

**Interfaces:**
- Consumes: every entity from Tasks 3–9; `EnumToTextConvention` (applies the enum converter to every
  enum property in the model, so no configuration below declares one).
- Produces: `PeakPowerDbContext.InboundMessages`, `.IntervalDataVersions`, `.IntervalReadings`,
  `.MeteringPointDayStates`, `.QuarantinedSeries`, `.DailyPositions`, `.OperationalAlerts`,
  `.MeteringPointBrpAssignments` — read by plans 3, 5 and 6.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Model/IngestionModelShapeTests.cs`:

```csharp
using Shouldly;
using Xunit;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;

namespace PeakPower.Integration.Tests.Model;

/// <summary>
/// The shape of migration 9's half of the model, asserted without a database. A connection string
/// is needed to build the model because Npgsql supplies the type mappings, but nothing here opens
/// a connection.
/// <para>
/// This file matters more than the usual model test, because migration 9 is HAND-WRITTEN raw SQL
/// rather than scaffolded - <c>migrationBuilder.CreateTable</c> cannot emit PARTITION BY RANGE -
/// so the model and the DDL are two independent statements of the same schema. These tests pin the
/// model half; <c>IngestionRoundTripTests</c> proves the two agree by writing and reading every
/// entity through EF against a real container.
/// </para>
/// </summary>
public sealed class IngestionModelShapeTests : IDisposable
{
    private const string DesignTimeConnectionString =
        "Host=localhost;Port=5432;Database=peakpower;Username=postgres;Password=postgres";

    private readonly PeakPowerDbContext _context;

    public IngestionModelShapeTests()
    {
        var options = new DbContextOptionsBuilder<PeakPowerDbContext>();
        PersistenceServiceCollectionExtensions.ConfigureDbContext(options, DesignTimeConnectionString);
        _context = new PeakPowerDbContext(options.Options, new UnscopedCustomerContext());
    }

    private IEntityType Entity<T>() => _context.Model.FindEntityType(typeof(T))!;

    private static Microsoft.EntityFrameworkCore.Metadata.StoreObjectIdentifier Table(
        string table, string schema) =>
        Microsoft.EntityFrameworkCore.Metadata.StoreObjectIdentifier.Table(table, schema);

    [Theory]
    [InlineData(typeof(InboundMessage), "metering", "inbound_message")]
    [InlineData(typeof(IntervalDataVersion), "metering", "interval_data_version")]
    [InlineData(typeof(IntervalReading), "metering", "interval_reading")]
    [InlineData(typeof(MeteringPointDayState), "metering", "metering_point_day_state")]
    [InlineData(typeof(QuarantinedSeries), "metering", "quarantined_series")]
    [InlineData(typeof(DailyPosition), "metering", "daily_position")]
    [InlineData(typeof(OperationalAlert), "metering", "operational_alert")]
    [InlineData(typeof(MeteringPointBrpAssignment), "customer", "metering_point_brp_assignment")]
    public void Each_new_aggregate_maps_to_its_schema_qualified_singular_snake_case_table(
        Type clrType, string schema, string table)
    {
        var entityType = _context.Model.FindEntityType(clrType);

        entityType.ShouldNotBeNull();
        entityType!.GetSchema().ShouldBe(schema);
        entityType.GetTableName().ShouldBe(table);
    }

    /// <summary>
    /// ⚠ delivery_date is the column name for a metering day on EVERY one of the seven new tables.
    /// The published DDL calls it local_date on daily_position; shared contract section 16 item 1
    /// overrules that, so one word means one thing across all seven.
    /// </summary>
    [Theory]
    [InlineData(typeof(IntervalDataVersion), "metering", "interval_data_version")]
    [InlineData(typeof(IntervalReading), "metering", "interval_reading")]
    [InlineData(typeof(MeteringPointDayState), "metering", "metering_point_day_state")]
    [InlineData(typeof(DailyPosition), "metering", "daily_position")]
    [InlineData(typeof(QuarantinedSeries), "metering", "quarantined_series")]
    public void The_metering_day_column_is_called_delivery_date_on_every_table_that_has_one(
        Type clrType, string schema, string table)
    {
        _context.Model.FindEntityType(clrType)!
            .GetProperty("DeliveryDate")
            .GetColumnName(Table(table, schema))
            .ShouldBe("delivery_date");
    }

    /// <summary>
    /// ⚠ Exactly four of the eight new entities carry a CustomerId, and the NUMBER is load-bearing.
    /// Both row-level-security coverage guards discover entities by a property name ending in
    /// "CustomerId", and their pinned literals move by exactly four. Adding one to InboundMessage,
    /// QuarantinedSeries, OperationalAlert or MeteringPointBrpAssignment - however convenient it
    /// would look - breaks that arithmetic and every plan that pinned it.
    /// </summary>
    [Theory]
    [InlineData(typeof(IntervalDataVersion))]
    [InlineData(typeof(IntervalReading))]
    [InlineData(typeof(MeteringPointDayState))]
    [InlineData(typeof(DailyPosition))]
    public void The_four_customer_readable_tables_carry_a_denormalised_customer_id(Type clrType)
    {
        var property = _context.Model.FindEntityType(clrType)!.FindProperty("CustomerId");

        property.ShouldNotBeNull();
        property!.IsNullable.ShouldBeFalse("S2-D1 makes it NOT NULL on all four");
    }

    [Theory]
    [InlineData(typeof(InboundMessage))]
    [InlineData(typeof(QuarantinedSeries))]
    [InlineData(typeof(OperationalAlert))]
    [InlineData(typeof(MeteringPointBrpAssignment))]
    public void The_four_employee_only_tables_carry_no_customer_id_at_all(Type clrType)
    {
        _context.Model.FindEntityType(clrType)!
            .GetProperties()
            .Select(property => property.Name)
            .ShouldNotContain(
                name => name.EndsWith("CustomerId", StringComparison.Ordinal),
                "the coverage guards discover by this suffix, and their literals move by exactly " +
                "four - adding a fifth breaks Task 11's and Task 16's pinned numbers");
    }

    [Fact]
    public void The_interval_reading_key_starts_with_the_partition_key()
    {
        // PostgreSQL requires a partitioned table's primary key to include the partition key, and
        // delivery_date leading it is what lets a per-day query hit one partition.
        Entity<IntervalReading>().FindPrimaryKey()!.Properties
            .Select(property => property.Name)
            .ShouldBe(new[] { "DeliveryDate", "VersionId", "Pos" });
    }

    [Theory]
    [InlineData(typeof(MeteringPointDayState))]
    [InlineData(typeof(DailyPosition))]
    public void The_per_day_rollups_are_keyed_on_point_and_date(Type clrType)
    {
        _context.Model.FindEntityType(clrType)!.FindPrimaryKey()!.Properties
            .Select(property => property.Name)
            .ShouldBe(new[] { "MeteringPointId", "DeliveryDate" });
    }

    [Fact]
    public void The_correlation_id_is_unique_on_the_message()
    {
        // One correlation id per received request. It is copied onto every version the message
        // produces, so a duplicate would make "which request produced this row" unanswerable.
        Entity<InboundMessage>().GetIndexes()
            .Where(index => index.IsUnique)
            .SelectMany(index => index.Properties)
            .Select(property => property.Name)
            .ShouldContain("CorrelationId");
    }

    /// <summary>
    /// ⚠ ux_idv_current is the enforcement of receipt-order supersession, not a nicety. Design
    /// section 4.2: the current version is ALWAYS the last one received, never the newest by
    /// CreatedDateTime, and both receipt orders of the same pair leave the second-received version
    /// current. The partial index is what makes "exactly one current" a database fact.
    /// </summary>
    [Fact]
    public void Exactly_one_current_version_per_point_date_and_direction_is_a_partial_unique_index()
    {
        var index = Entity<IntervalDataVersion>().GetIndexes()
            .Single(index => index.GetDatabaseName() == "ux_idv_current");

        index.IsUnique.ShouldBeTrue();
        index.GetFilter().ShouldBe("is_current");
        index.Properties.Select(property => property.Name)
            .ShouldBe(new[] { "MeteringPointId", "DeliveryDate", "Direction" });
    }

    [Fact]
    public void The_reading_start_index_is_BRIN_because_the_column_is_append_ordered()
    {
        // A BRIN index over a monotonically increasing timestamp is a few pages rather than a few
        // hundred megabytes, and interval_start is written in near-order by construction.
        Entity<IntervalReading>().GetIndexes()
            .Single(index => index.GetDatabaseName() == "ix_reading_start")
            .GetMethod().ShouldBe("brin");
    }

    [Fact]
    public void The_open_quarantine_and_open_alert_indexes_are_partial()
    {
        Entity<QuarantinedSeries>().GetIndexes()
            .Single(index => index.GetDatabaseName() == "ix_quarantine_open")
            .GetFilter().ShouldBe("resolved_at IS NULL");

        Entity<OperationalAlert>().GetIndexes()
            .Single(index => index.GetDatabaseName() == "ix_alert_open")
            .GetFilter().ShouldBe("resolved_at IS NULL");
    }

    [Fact]
    public void The_completeness_jobs_driving_index_covers_only_the_expectations_that_can_be_faults()
    {
        // [DEC-65], [F02-R22], [F02-R26]: the points where a missing A01 is a fault or an unknown,
        // never a fact. A NEVER point's missing production series is a DECLARED zero and belongs
        // nowhere near this index.
        _context.Model.FindEntityType(typeof(MeteringPoint))!.GetIndexes()
            .Single(index => index.GetDatabaseName() == "ix_mp_production_expected")
            .GetFilter().ShouldBe("production_expectation IN ('EXPECTED','UNKNOWN')");
    }

    [Fact]
    public void Quantities_and_rollup_totals_carry_their_published_precisions()
    {
        Entity<IntervalReading>().GetProperty(nameof(IntervalReading.QuantityKwh))
            .GetColumnType().ShouldBe("numeric(14,3)");

        var position = Entity<DailyPosition>();
        foreach (var name in new[]
        {
            nameof(DailyPosition.ConsumptionKwh), nameof(DailyPosition.ProductionKwh),
            nameof(DailyPosition.NetUsageKwh), nameof(DailyPosition.OfftakeKwh),
            nameof(DailyPosition.ExportKwh),
        })
        {
            position.GetProperty(name).GetColumnType().ShouldBe("numeric(16,3)", name);
        }
    }

    [Fact]
    public void The_message_stores_its_headers_as_jsonb_and_its_source_address_as_inet()
    {
        // ⚠ A text-typed parameter into an inet column fails with 42804,
        // "column is of type inet but expression is of type text" - verified against postgres:17.
        // The property is string? per the shared contract, so the configuration converts through
        // System.Net.IPAddress, which Npgsql maps to inet natively.
        var message = Entity<InboundMessage>();

        message.GetProperty(nameof(InboundMessage.HttpHeaders)).GetColumnType().ShouldBe("jsonb");
        message.GetProperty(nameof(InboundMessage.RemoteIp)).GetColumnType().ShouldBe("inet");
        message.GetProperty(nameof(InboundMessage.RemoteIp))
            .GetValueConverter().ShouldNotBeNull("string cannot reach an inet column unconverted");
    }

    [Fact]
    public void The_source_version_ids_are_a_uuid_array_with_a_sequence_comparer()
    {
        // Without a value comparer EF compares Guid[] by reference, so loading a rollup and saving
        // it again would rewrite the column on every SaveChanges - the same failure JsonbComparer
        // exists to close for the address records.
        var property = Entity<DailyPosition>().GetProperty(nameof(DailyPosition.SourceVersionIds));

        property.GetColumnType().ShouldBe("uuid[]");
        property.GetValueComparer().ShouldNotBeNull();
    }

    /// <summary>
    /// ⚠ Deviation A. Shared contract section 6.2's SQL block spells these columns
    /// production_expectation_set_by / _set_at; its prose names the properties ExpectationSetBy /
    /// ExpectationSetAt. Under UseSnakeCaseNamingConvention those two do not meet, so the
    /// configuration bridges them with the only two explicit HasColumnName calls in this plan.
    /// Pinned here so nobody "tidies" one half and silently renames a column.
    /// </summary>
    [Theory]
    [InlineData("ExpectationSetBy", "production_expectation_set_by")]
    [InlineData("ExpectationSetAt", "production_expectation_set_at")]
    [InlineData("ExpectationSource", "expectation_source")]
    [InlineData("BrpAssignedAt", "brp_assigned_at")]
    [InlineData("FirstProductionObservedAt", "first_production_observed_at")]
    public void The_metering_point_expectation_columns_keep_their_published_names(
        string propertyName, string columnName)
    {
        _context.Model.FindEntityType(typeof(MeteringPoint))!
            .GetProperty(propertyName)
            .GetColumnName(Table("metering_point", "customer"))
            .ShouldBe(columnName);
    }

    [Theory]
    [InlineData(typeof(Brp), nameof(Brp.CreatedAt))]
    [InlineData(typeof(MeteringPoint), nameof(MeteringPoint.BrpAssignedAt))]
    [InlineData(typeof(IntervalDataVersion), nameof(IntervalDataVersion.CreatedAt))]
    public void The_three_store_generated_moments_carry_the_database_default(
        Type clrType, string propertyName)
    {
        // NOT NULL DEFAULT now(), and no factory may read a clock - architecture fact 5 confines
        // that to PeakPower.Infrastructure.Time and enforces it over the compiled IL.
        var property = _context.Model.FindEntityType(clrType)!.GetProperty(propertyName);

        property.GetDefaultValueSql().ShouldBe("now()");
        property.ValueGenerated.ShouldBe(ValueGenerated.OnAdd);
    }

    [Fact]
    public void Every_new_enum_property_gets_the_screaming_snake_converter_from_the_convention()
    {
        // EnumToTextConvention walks every enum property in the model, so adding an enum column
        // needs no persistence change. Asserted on one property per new enum rather than trusted.
        Entity<InboundMessage>().GetProperty(nameof(InboundMessage.Status))
            .GetValueConverter()!.ConvertToProvider(InboundMessageStatus.Received)
            .ShouldBe("RECEIVED");

        Entity<IntervalDataVersion>().GetProperty(nameof(IntervalDataVersion.Source))
            .GetValueConverter()!.ConvertToProvider(IntervalDataVersionSource.BrpFeed)
            .ShouldBe("BRP_FEED");

        Entity<IntervalDataVersion>().GetProperty(nameof(IntervalDataVersion.Direction))
            .GetValueConverter()!.ConvertToProvider(IntervalDirection.Consumption)
            .ShouldBe("CONSUMPTION");

        Entity<QuarantinedSeries>().GetProperty(nameof(QuarantinedSeries.Reason))
            .GetValueConverter()!.ConvertToProvider(QuarantineReason.UnknownEan)
            .ShouldBe("UNKNOWN_EAN");

        Entity<MeteringPointDayState>().GetProperty(nameof(MeteringPointDayState.State))
            .GetValueConverter()!.ConvertToProvider(MeteringDayState.NoData)
            .ShouldBe("NO_DATA");

        Entity<OperationalAlert>().GetProperty(nameof(OperationalAlert.Kind))
            .GetValueConverter()!.ConvertToProvider(
                OperationalAlertKind.ProductionExpectationPromoted)
            .ShouldBe("PRODUCTION_EXPECTATION_PROMOTED");

        Entity<OperationalAlert>().GetProperty(nameof(OperationalAlert.Status))
            .GetValueConverter()!.ConvertToProvider(OperationalAlertStatus.Open)
            .ShouldBe("OPEN");
    }

    [Fact]
    public void The_BRP_adapter_key_and_code_are_unique_together()
    {
        Entity<Brp>().GetIndexes()
            .Single(index => index.GetDatabaseName() == "ux_brp_adapter_key_code")
            .IsUnique.ShouldBeTrue();
    }

    public void Dispose() => _context.Dispose();
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~IngestionModelShapeTests"`
Expected: FAIL — `Each_new_aggregate_maps_to_its_schema_qualified_singular_snake_case_table` fails on
every case with `entityType should not be null` (the entity is not in the model at all, because no
configuration and no `DbSet` mentions it).

- [ ] **Step 3: Write the six pure metering configurations**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/InboundMessageConfiguration.cs`:

```csharp
using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Metering;

namespace PeakPower.Persistence.Configurations;

public sealed class InboundMessageConfiguration : IEntityTypeConfiguration<InboundMessage>
{
    public void Configure(EntityTypeBuilder<InboundMessage> builder)
    {
        builder.ToTable("inbound_message", "metering");

        builder.HasKey(message => message.Id);
        builder.Property(message => message.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedNever();

        builder.Property(message => message.BrpId).IsRequired();
        builder.HasOne<Brp>()
            .WithMany()
            .HasForeignKey(message => message.BrpId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(message => message.CorrelationId).IsRequired();

        // One correlation id per received request. It is copied onto every version the message
        // produces, so a duplicate would make "which request produced this row" unanswerable.
        builder.HasIndex(message => message.CorrelationId)
            .IsUnique()
            .HasDatabaseName("ux_msg_correlation");

        builder.Property(message => message.ReceivedAt).IsRequired();
        builder.Property(message => message.PayloadHash).IsRequired();
        builder.Property(message => message.PayloadBytes).IsRequired();
        builder.Property(message => message.PayloadUri).IsRequired();

        builder.Property(message => message.HttpHeaders).HasColumnType("jsonb");

        // ⚠ inet, not text. Verified against postgres:17: a text-typed parameter into an inet
        // column fails with 42804, "column is of type inet but expression is of type text". The
        // shared contract pins the property as string?, so it converts through IPAddress, which
        // Npgsql maps to inet natively. EF applies a non-nullable converter to the non-null values
        // of a nullable property and handles the nulls itself.
        //
        // IPAddress.Parse throws on a malformed string. The only writer is the webhook, which
        // takes the value from HttpContext.Connection.RemoteIpAddress?.ToString(), so a malformed
        // value would be a bug in that call site rather than user input.
        builder.Property(message => message.RemoteIp)
            .HasColumnType("inet")
            .HasConversion(
                value => IPAddress.Parse(value),
                address => address.ToString());

        builder.Property(message => message.Status).IsRequired();
        builder.Property(message => message.FailureCode);
        builder.Property(message => message.FailureDetail);
        builder.Property(message => message.ProcessedAt);

        // The 24-hour byte-identical dedupe [F02-R07] reads (payload_hash, received_at DESC).
        builder.HasIndex(message => new { message.PayloadHash, message.ReceivedAt })
            .IsDescending(false, true)
            .HasDatabaseName("ix_msg_hash_recent");

        builder.HasIndex(message => new { message.BrpId, message.ReceivedAt })
            .IsDescending(false, true)
            .HasDatabaseName("ix_msg_brp");

        builder.HasIndex(message => new { message.Status, message.ReceivedAt })
            .IsDescending(false, true)
            .HasDatabaseName("ix_msg_status");
    }
}
```

Create `…/Configurations/IntervalDataVersionConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;

namespace PeakPower.Persistence.Configurations;

public sealed class IntervalDataVersionConfiguration : IEntityTypeConfiguration<IntervalDataVersion>
{
    public void Configure(EntityTypeBuilder<IntervalDataVersion> builder)
    {
        builder.ToTable("interval_data_version", "metering");

        builder.HasKey(version => version.Id);
        builder.Property(version => version.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedNever();

        builder.Property(version => version.MeteringPointId).IsRequired();
        builder.HasOne<MeteringPoint>()
            .WithMany()
            .HasForeignKey(version => version.MeteringPointId)
            .OnDelete(DeleteBehavior.Restrict);

        // ⚠ S2-D1. NOT NULL, and with a real foreign key: this is tenant data, and the guards
        // discover the table through this property's name.
        builder.Property(version => version.CustomerId).IsRequired();
        builder.HasOne<Customer>()
            .WithMany()
            .HasForeignKey(version => version.CustomerId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(version => version.DeliveryDate).IsRequired();
        builder.Property(version => version.Direction).IsRequired();
        builder.Property(version => version.Source).IsRequired();

        // ⚠ [DEC-143]/S2-D2: all three are NULLABLE, because a MANUAL version has no document and
        // no message. ck_idv_brp_feed_has_message in migration 9 is what keeps them present in
        // substance for every BRP_FEED row.
        builder.Property(version => version.DocumentId);
        builder.Property(version => version.DocumentCreated);
        builder.Property(version => version.InboundMessageId);
        builder.HasOne<InboundMessage>()
            .WithMany()
            .HasForeignKey(version => version.InboundMessageId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(version => version.ReceivedAt).IsRequired();
        builder.Property(version => version.CorrelationId).IsRequired();
        builder.Property(version => version.IntervalCount).IsRequired();
        builder.Property(version => version.IsCurrent).IsRequired().HasDefaultValue(true);

        builder.Property(version => version.CreatedAt)
            .HasDefaultValueSql("now()")
            .ValueGeneratedOnAdd();

        // ⚠ The enforcement of receipt-order supersession, not a nicety. Design section 4.2: the
        // current version is always the LAST ONE RECEIVED, never the newest by CreatedDateTime,
        // and both receipt orders of the same pair leave the second-received version current.
        builder.HasIndex(version => new
            {
                version.MeteringPointId,
                version.DeliveryDate,
                version.Direction,
            })
            .IsUnique()
            .HasFilter("is_current")
            .HasDatabaseName("ux_idv_current");

        builder.HasIndex(version => new
            {
                version.MeteringPointId,
                version.DeliveryDate,
                version.Direction,
                version.ReceivedAt,
            })
            .IsDescending(false, false, false, true)
            .HasDatabaseName("ix_idv_point_date");

        builder.HasIndex(version => version.InboundMessageId).HasDatabaseName("ix_idv_message");

        builder.HasIndex(version => new { version.CustomerId, version.DeliveryDate })
            .HasDatabaseName("ix_idv_customer");
    }
}
```

Create `…/Configurations/IntervalReadingConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Metering;

namespace PeakPower.Persistence.Configurations;

public sealed class IntervalReadingConfiguration : IEntityTypeConfiguration<IntervalReading>
{
    public void Configure(EntityTypeBuilder<IntervalReading> builder)
    {
        builder.ToTable("interval_reading", "metering");

        // PostgreSQL requires a partitioned table's primary key to include the partition key, and
        // delivery_date leading it is what lets a per-day query hit exactly one partition.
        builder.HasKey(reading => new { reading.DeliveryDate, reading.VersionId, reading.Pos });

        builder.Property(reading => reading.VersionId).IsRequired();
        builder.HasOne<IntervalDataVersion>()
            .WithMany()
            .HasForeignKey(reading => reading.VersionId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(reading => reading.DeliveryDate).IsRequired();

        // ⚠ S2-D1, and deliberately WITHOUT a foreign key. Every partition would otherwise carry
        // its own constraint and its own trigger, which is a real cost on 36 partitions for a
        // column the apply transaction resolves from the metering point it just validated.
        builder.Property(reading => reading.CustomerId).IsRequired();

        builder.Property(reading => reading.Pos).IsRequired();
        builder.Property(reading => reading.IntervalStart).IsRequired();
        builder.Property(reading => reading.QuantityKwh)
            .HasColumnType("numeric(14,3)")
            .IsRequired();

        // BRIN over a near-monotonic timestamp: a few pages rather than a few hundred megabytes.
        builder.HasIndex(reading => reading.IntervalStart)
            .HasMethod("brin")
            .HasDatabaseName("ix_reading_start");

        builder.HasIndex(reading => new { reading.CustomerId, reading.DeliveryDate })
            .HasDatabaseName("ix_reading_customer");
    }
}
```

Create `…/Configurations/MeteringPointDayStateConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;

namespace PeakPower.Persistence.Configurations;

public sealed class MeteringPointDayStateConfiguration
    : IEntityTypeConfiguration<MeteringPointDayState>
{
    public void Configure(EntityTypeBuilder<MeteringPointDayState> builder)
    {
        builder.ToTable("metering_point_day_state", "metering");

        builder.HasKey(state => new { state.MeteringPointId, state.DeliveryDate });

        builder.HasOne<MeteringPoint>()
            .WithMany()
            .HasForeignKey(state => state.MeteringPointId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(state => state.CustomerId).IsRequired();      // ⚠ S2-D1
        builder.HasOne<Customer>()
            .WithMany()
            .HasForeignKey(state => state.CustomerId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(state => state.State).IsRequired();
        builder.Property(state => state.ExpectedIntervalCount).IsRequired();
        builder.Property(state => state.ConsumptionComplete).IsRequired().HasDefaultValue(false);
        builder.Property(state => state.ProductionComplete).IsRequired().HasDefaultValue(false);
        builder.Property(state => state.ProductionIsDeclaredZero).IsRequired().HasDefaultValue(false);
        builder.Property(state => state.FinalisedAt);
        builder.Property(state => state.LastCorrectedAt);
        builder.Property(state => state.ComputedAt).IsRequired();

        builder.HasIndex(state => new { state.State, state.DeliveryDate })
            .HasDatabaseName("ix_mpds_state");

        builder.HasIndex(state => new { state.CustomerId, state.DeliveryDate })
            .HasDatabaseName("ix_mpds_customer");
    }
}
```

Create `…/Configurations/DailyPositionConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;

namespace PeakPower.Persistence.Configurations;

public sealed class DailyPositionConfiguration : IEntityTypeConfiguration<DailyPosition>
{
    public void Configure(EntityTypeBuilder<DailyPosition> builder)
    {
        builder.ToTable("daily_position", "metering");

        builder.HasKey(position => new { position.MeteringPointId, position.DeliveryDate });

        builder.HasOne<MeteringPoint>()
            .WithMany()
            .HasForeignKey(position => position.MeteringPointId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(position => position.CustomerId).IsRequired();      // ⚠ S2-D1
        builder.HasOne<Customer>()
            .WithMany()
            .HasForeignKey(position => position.CustomerId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(position => position.ConsumptionKwh)
            .HasColumnType("numeric(16,3)").IsRequired();
        builder.Property(position => position.ProductionKwh)
            .HasColumnType("numeric(16,3)").IsRequired();
        builder.Property(position => position.NetUsageKwh)
            .HasColumnType("numeric(16,3)").IsRequired();

        // ⚠ Accumulated PER INTERVAL and NOT recoverable from the three totals above. Design
        // section 4.1's worked case: consumption [10, 0], production [0, 5] gives offtake 10 and
        // export 5, while daily totals give 5 and 0 - and discard the export entirely.
        builder.Property(position => position.OfftakeKwh)
            .HasColumnType("numeric(16,3)").IsRequired();
        builder.Property(position => position.ExportKwh)
            .HasColumnType("numeric(16,3)").IsRequired();

        builder.Property(position => position.DataState).IsRequired();

        // Without a comparer EF compares Guid[] by reference, so loading a rollup and saving it
        // again would rewrite the column on every SaveChanges - the same failure JsonbComparer
        // exists to close for the address records. The snapshot is a copy, because an array is
        // mutable and a shared reference would make the snapshot track the live value.
        builder.Property(position => position.SourceVersionIds)
            .HasColumnType("uuid[]")
            .IsRequired()
            .Metadata.SetValueComparer(new ValueComparer<Guid[]>(
                (left, right) => left != null && right != null && left.SequenceEqual(right),
                value => value.Aggregate(0, (hash, id) => HashCode.Combine(hash, id.GetHashCode())),
                value => value.ToArray()));

        builder.Property(position => position.ComputedAt).IsRequired();

        builder.HasIndex(position => new { position.CustomerId, position.DeliveryDate })
            .HasDatabaseName("ix_dp_customer");
    }
}
```

⚠ `SourceVersionIds` is an expression-bodied get-only property over a private field. EF Core maps it
through the backing field automatically (`_sourceVersionIds` matches the convention), so no
`UsePropertyAccessMode` call is needed. Task 18's round-trip is what proves it.

Create `…/Configurations/QuarantinedSeriesConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Metering;

namespace PeakPower.Persistence.Configurations;

public sealed class QuarantinedSeriesConfiguration : IEntityTypeConfiguration<QuarantinedSeries>
{
    public void Configure(EntityTypeBuilder<QuarantinedSeries> builder)
    {
        builder.ToTable("quarantined_series", "metering");

        builder.HasKey(series => series.Id);
        builder.Property(series => series.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedNever();

        builder.Property(series => series.InboundMessageId).IsRequired();
        builder.HasOne<InboundMessage>()
            .WithMany()
            .HasForeignKey(series => series.InboundMessageId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(series => series.BrpId).IsRequired();
        builder.HasOne<Brp>()
            .WithMany()
            .HasForeignKey(series => series.BrpId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(series => series.Reason).IsRequired();
        builder.Property(series => series.ResourceObject).IsRequired();
        builder.Property(series => series.DeliveryDate).IsRequired();
        builder.Property(series => series.Direction).IsRequired();
        builder.Property(series => series.PointCount).IsRequired();
        builder.Property(series => series.ReceivedAt).IsRequired();
        builder.Property(series => series.ResolvedAt);
        builder.Property(series => series.ResolvedBy);

        builder.Property(series => series.ResolvedByReplayOfMessageId);
        builder.HasOne<InboundMessage>()
            .WithMany()
            .HasForeignKey(series => series.ResolvedByReplayOfMessageId)
            .OnDelete(DeleteBehavior.Restrict);

        // The employee quarantine panel's driving query: open entries, newest first.
        builder.HasIndex(series => new { series.Reason, series.ReceivedAt })
            .IsDescending(false, true)
            .HasFilter("resolved_at IS NULL")
            .HasDatabaseName("ix_quarantine_open");

        builder.HasIndex(series => series.InboundMessageId)
            .HasDatabaseName("ix_quarantine_message");
    }
}
```

⚠ Two foreign keys from `QuarantinedSeries` to `InboundMessage` is deliberate: one is the message
the series **arrived in**, the other is the replay run that **cleared** it, and they are different
messages. EF needs both `HasOne<InboundMessage>()` calls to name their own foreign-key property,
which they do.

Create `…/Configurations/OperationalAlertConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;

namespace PeakPower.Persistence.Configurations;

public sealed class OperationalAlertConfiguration : IEntityTypeConfiguration<OperationalAlert>
{
    public void Configure(EntityTypeBuilder<OperationalAlert> builder)
    {
        builder.ToTable("operational_alert", "metering");

        builder.HasKey(alert => alert.Id);
        builder.Property(alert => alert.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedNever();

        builder.Property(alert => alert.Kind).IsRequired();
        builder.Property(alert => alert.Status).IsRequired().HasDefaultValue(OperationalAlertStatus.Open);

        // Every context column is nullable: a condition may name a metering point but no message
        // and no date, and a future portfolio-level condition may name none of them.
        builder.Property(alert => alert.MeteringPointId);
        builder.HasOne<MeteringPoint>()
            .WithMany()
            .HasForeignKey(alert => alert.MeteringPointId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(alert => alert.BrpId);
        builder.HasOne<Brp>()
            .WithMany()
            .HasForeignKey(alert => alert.BrpId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(alert => alert.InboundMessageId);
        builder.HasOne<InboundMessage>()
            .WithMany()
            .HasForeignKey(alert => alert.InboundMessageId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(alert => alert.DeliveryDate);
        builder.Property(alert => alert.Summary).IsRequired();
        builder.Property(alert => alert.Detail);
        builder.Property(alert => alert.RaisedAt).IsRequired();
        builder.Property(alert => alert.ResolvedAt);

        builder.HasIndex(alert => new { alert.Kind, alert.RaisedAt })
            .IsDescending(false, true)
            .HasFilter("resolved_at IS NULL")
            .HasDatabaseName("ix_alert_open");

        builder.HasIndex(alert => new { alert.MeteringPointId, alert.RaisedAt })
            .IsDescending(false, true)
            .HasDatabaseName("ix_alert_point");
    }
}
```

Create `…/Configurations/MeteringPointBrpAssignmentConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;

namespace PeakPower.Persistence.Configurations;

public sealed class MeteringPointBrpAssignmentConfiguration
    : IEntityTypeConfiguration<MeteringPointBrpAssignment>
{
    public void Configure(EntityTypeBuilder<MeteringPointBrpAssignment> builder)
    {
        // ⚠ The customer schema, not metering: the row is about a customer's connection, and
        // migration 9's REVOKE ALL / employee-only policy is what keeps it out of a customer
        // connection's reach.
        builder.ToTable("metering_point_brp_assignment", "customer");

        builder.HasKey(assignment => assignment.Id);
        builder.Property(assignment => assignment.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedNever();

        builder.Property(assignment => assignment.MeteringPointId).IsRequired();
        builder.HasOne<MeteringPoint>()
            .WithMany()
            .HasForeignKey(assignment => assignment.MeteringPointId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(assignment => assignment.FromBrpId);
        builder.HasOne<Brp>()
            .WithMany()
            .HasForeignKey(assignment => assignment.FromBrpId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(assignment => assignment.ToBrpId).IsRequired();
        builder.HasOne<Brp>()
            .WithMany()
            .HasForeignKey(assignment => assignment.ToBrpId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(assignment => assignment.AssignedAt)
            .IsRequired()
            .HasDefaultValueSql("now()");

        builder.Property(assignment => assignment.AssignedBy).IsRequired();
        builder.Property(assignment => assignment.Reason).IsRequired();

        // "Which assignment was in force at time T" is the query [F02-R43] exists for, and it is
        // the query WRONG_BRP is decided by: newest first, per point.
        builder.HasIndex(assignment => new { assignment.MeteringPointId, assignment.AssignedAt })
            .IsDescending(false, true)
            .HasDatabaseName("ix_mpba_point");
    }
}
```

- [ ] **Step 4: Extend the two existing configurations**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/BrpConfiguration.cs`,
insert after the `IsActive` line and before the closing braces:

```csharp

        // [DEC-69]: the format, the endpoint, the credentials and the adapter key belong to the
        // row, so pointing at a real endpoint later is a data change plus a credential.
        builder.Property(brp => brp.EndpointUri).IsRequired();

        // ⚠ The NAME of an environment variable, never a secret. Shared contract section 9.3.
        builder.Property(brp => brp.CredentialRef).IsRequired();

        builder.Property(brp => brp.DocumentFormat).IsRequired();
        builder.Property(brp => brp.AdapterKey).IsRequired();
        builder.Property(brp => brp.ExpectedCadence).IsRequired();

        builder.Property(brp => brp.CreatedAt)
            .HasDefaultValueSql("now()")
            .ValueGeneratedOnAdd();

        builder.HasIndex(brp => new { brp.AdapterKey, brp.Code })
            .IsUnique()
            .HasDatabaseName("ux_brp_adapter_key_code");
```

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/MeteringPointConfiguration.cs`,
insert after `builder.Property(point => point.ValidTo);` and before the `DisplayLabel` comment:

```csharp

        // Store-generated: NOT NULL DEFAULT now(), and Attach may not read a clock - architecture
        // fact 5 confines that to PeakPower.Infrastructure.Time and enforces it over the compiled
        // IL. EF omits the column on insert when the property holds the CLR default and reads the
        // database's answer back; ReassignBrp sets it explicitly, because an UPDATE has no
        // store default.
        builder.Property(point => point.BrpAssignedAt)
            .HasDefaultValueSql("now()")
            .ValueGeneratedOnAdd();

        builder.Property(point => point.FirstProductionObservedAt);

        // ⚠ The only two explicit column names in this plan, and they are deliberate. Shared
        // contract section 6.2's SQL block spells these columns production_expectation_set_by /
        // _set_at; its prose names the properties ExpectationSetBy / ExpectationSetAt. Under
        // UseSnakeCaseNamingConvention those two do not meet, so both halves of the contract are
        // honoured literally and bridged here. IngestionModelShapeTests pins the mapping so nobody
        // "tidies" one half and silently renames a column.
        builder.Property(point => point.ExpectationSetBy)
            .HasColumnName("production_expectation_set_by");
        builder.Property(point => point.ExpectationSetAt)
            .HasColumnName("production_expectation_set_at");

        // The completeness job's driving set: the points where a missing A01 is a fault or an
        // unknown, never a fact. A NEVER point's missing production series is a DECLARED zero and
        // belongs nowhere near this index. [DEC-65], [F02-R22], [F02-R26]
        builder.HasIndex(point => new { point.ProductionExpectation, point.CustomerId })
            .HasFilter("production_expectation IN ('EXPECTED','UNKNOWN')")
            .HasDatabaseName("ix_mp_production_expected");
```

- [ ] **Step 5: Add the eight `DbSet`s**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs`,
insert after the `EmployeeRefreshTokens` property (line `76`) and before `OnModelCreating`:

```csharp

    /// <summary>
    /// The stored raw documents. <b>Employee-only</b>: migration 9 revokes every privilege on
    /// metering.inbound_message from app_customer_role and gives it an app_employee_role policy,
    /// so a customer-scoped connection that reached this set fails closed at 42501 rather than
    /// returning rows. It carries no CustomerId and takes no global query filter.
    /// </summary>
    public DbSet<InboundMessage> InboundMessages => Set<InboundMessage>();

    /// <summary>One version of one direction of one day. Tenant data - filtered below.</summary>
    public DbSet<IntervalDataVersion> IntervalDataVersions => Set<IntervalDataVersion>();

    /// <summary>
    /// The points. Tenant data - filtered below. ⚠ The table is range-partitioned by month, which
    /// EF does not model: <c>GetTableName()</c> returns the parent, and migration 9's partition
    /// routine is what gives every partition its own row-level security and policies.
    /// </summary>
    public DbSet<IntervalReading> IntervalReadings => Set<IntervalReading>();

    /// <summary>The materialised data state per (point, date). Tenant data - filtered below.</summary>
    public DbSet<MeteringPointDayState> MeteringPointDayStates => Set<MeteringPointDayState>();

    /// <summary>
    /// Series that could not be attached to a metering point. <b>Employee-only</b>, like
    /// <see cref="InboundMessages"/>: there is no customer to scope an unknown EAN to.
    /// </summary>
    public DbSet<QuarantinedSeries> QuarantinedSeries => Set<QuarantinedSeries>();

    /// <summary>The daily rollup, design section 4.1. Tenant data - filtered below.</summary>
    public DbSet<DailyPosition> DailyPositions => Set<DailyPosition>();

    /// <summary>
    /// The conditions of F02-R12/R26/R34/R35/R45. <b>Employee-only</b>. The conditions are built
    /// and tested in slice 2; only the delivery channel is deferred (design section 3.2).
    /// </summary>
    public DbSet<OperationalAlert> OperationalAlerts => Set<OperationalAlert>();

    /// <summary>
    /// Who moved a metering point to another BRP, when and why [F02-R43]. <b>Employee-only</b>.
    /// The assignment in force at RECEIPT time is what decides WRONG_BRP, which is why this is a
    /// queryable table rather than an audit payload.
    /// </summary>
    public DbSet<MeteringPointBrpAssignment> MeteringPointBrpAssignments =>
        Set<MeteringPointBrpAssignment>();
```

The file already has `using PeakPower.Domain.Metering;` (line 6) and
`using PeakPower.Domain.Customers;` (line 4), so no new using is needed.

- [ ] **Step 6: Move the enum-discovery literal from ten to seventeen**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract/EnumWireAlgorithmDivergenceTests.cs`,
replace lines `75-98` — the `ExpectedEnumTypeNames` doc comment and array — with:

```csharp
    /// <summary>
    /// Every enum type <see cref="ModelEnumTypes"/> is expected to discover off the built model,
    /// by name, pinned exactly - not merely counted - so a mutation that narrows discovery (a
    /// tighter <c>.Where</c>, a filtered <c>GetEntityTypes()</c>) fails here directly instead of
    /// silently shrinking what <see cref="Divergences"/> ever compares.
    /// <para>
    /// Seventeen since migration 9: slice 1's ten plus slice 2's seven -
    /// <c>InboundMessageStatus</c>, <c>IntervalDataVersionSource</c>, <c>IntervalDirection</c>,
    /// <c>QuarantineReason</c>, <c>MeteringDayState</c>, <c>OperationalAlertKind</c> and
    /// <c>OperationalAlertStatus</c>. Still not the twenty <c>PeakPower.Domain</c> declares:
    /// <c>BankAccountStatus</c>, <c>FourEyesAction</c> and <c>ConnectionStatus</c> are never used
    /// as an EF-mapped property (<c>ConnectionStatus</c> is computed from
    /// <c>ValidFrom</c>/<c>ValidTo</c> at read time - see <c>PortalMappings</c>), so
    /// <see cref="EnumToScreamingSnakeConverter{TEnum}"/> never runs on them and this test has
    /// nothing to say about them.
    /// </para>
    /// <para>
    /// ⚠ Every slice-2 member was checked for adjacent capitals before it was written -
    /// <c>IngestionEnumSpellingTests.No_member_contains_two_adjacent_capitals</c> is the guard on
    /// the domain side - so the allow-list below does NOT grow. A slice-2 member appearing in
    /// <see cref="Divergences"/> means one was renamed into the <c>LegalEntityType.BV</c> failure
    /// mode, and the fix is the rename, not a new allow-list entry.
    /// </para>
    /// </summary>
    private static readonly string[] ExpectedEnumTypeNames =
    [
        "AccountStatus",
        "Commodity",
        "CustomerStatus",
        "FlowDirection",
        "InboundMessageStatus",
        "IntervalDataVersionSource",
        "IntervalDirection",
        "LegalEntityType",
        "MeteringDayState",
        "OnboardingStatus",
        "OperationalAlertKind",
        "OperationalAlertStatus",
        "ProductionExpectation",
        "ProductionExpectationSource",
        "QuarantineReason",
        "SigningAuthority",
        "VolumeBand",
    ];
```

Rename the method at line `155` and reword its message at `163`:

```csharp
    [Fact]
    public void The_model_discovers_exactly_the_seventeen_enum_types_EnumToTextConvention_converts()
    {
        ModelEnumTypes()
            .Select(type => type.Name)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ShouldBe(
                ExpectedEnumTypeNames.OrderBy(name => name, StringComparer.Ordinal),
                Case.Sensitive,
                "ModelEnumTypes() must discover exactly these seventeen types. A shorter list " +
                "means discovery narrowed (a tighter .Where, a filtered GetEntityTypes()) and " +
                "Divergences() below is now blind to whatever fell out; a longer or different " +
                "list means a new enum property was mapped and this list - and the divergence " +
                "comparison it gates - needs deliberate review, not a silent pass.");
    }
```

And at line `53`, in the class's own remarks, replace the cross-reference
`<see cref="The_model_discovers_exactly_the_ten_enum_types_EnumToTextConvention_converts"/>` with
`<see cref="The_model_discovers_exactly_the_seventeen_enum_types_EnumToTextConvention_converts"/>`.

- [ ] **Step 7: Run the model tests and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~IngestionModelShapeTests"
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~ModelShapeTests"
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~EnumWireAlgorithmDivergenceTests"
```

Expected: build clean; all three PASS. **Do not run the whole integration suite yet** — the model
now describes columns the database has not got, so every Testcontainers test that writes a
`metering_point`, a `brp` or a `customer_account` fails until Task 12's migration lands. That is the
one window in this plan where the suite is legitimately red, and Task 12 closes it.

- [ ] **Step 8: Mutate the enum-discovery guard**

Add `"BankAccountStatus"` to `ExpectedEnumTypeNames` — the plausible mistake, since the type exists
and looks as though it ought to be mapped:

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~The_model_discovers_exactly_the_seventeen_enum_types"`
Expected: FAIL — `… should be ["AccountStatus", "BankAccountStatus", …] but was ["AccountStatus", "Commodity", …]`
with `difference: … missing item [1] "BankAccountStatus"`.

Remove it again, then mutate the other way: delete `"QuarantineReason"` from the list.

Run: the same command.
Expected: FAIL — the discovered set now has one entry the expectation does not:
`… additional item "QuarantineReason"`.

Restore the seventeen and re-run:

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~EnumWireAlgorithmDivergenceTests"`
Expected: PASS.

⚠ Both directions matter, and only one of them is the interesting case: a **longer** list catches a
type nobody mapped, and a **shorter** one catches discovery silently narrowing — which is the
failure the class's own "Review round 2" remarks were written about.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence/Configurations \
        src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs \
        tests/PeakPower.Integration.Tests/Model/IngestionModelShapeTests.cs \
        tests/PeakPower.Integration.Tests/Contract/EnumWireAlgorithmDivergenceTests.cs
git commit -m "feat(persistence): map the eight new entities and grow the enum guard to seventeen

The model has to describe migration 9's schema exactly, because migration 9 is hand-written
raw SQL - CreateTable cannot emit PARTITION BY RANGE - so the two are independent
statements of one schema and the round-trip test is what proves they agree. remote_ip
converts through IPAddress because a text parameter into an inet column fails with 42804,
verified against postgres:17. The enum-discovery literal is verified by mutation in both
directions.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 11: The four global query filters, and the three `QueryFilterModelTests` literals

Tenancy layer 1. Contract §12 gives the four filters verbatim and the shape is **not** cosmetic:
`!_customerContext.IsAuthenticated || …` is what makes the filter collapse to `true` on every
anonymous path in this DbContext. A filter written as a bare `x.CustomerId == …` would return zero
rows for the back office, the Worker and the anonymous onboarding wizard, all of which read through
the same context.

Three literals in one file move with them. Two of the three are the **same fact pinned twice**, on
purpose — `:143-147` is a metadata walk that names every customer-owned entity, and `:234` is a
pinned snapshot of how many carry a filter. Its own message says so. Both move here.

⚠ **`InboundMessage`, `QuarantinedSeries`, `OperationalAlert` and `MeteringPointBrpAssignment` get
no filter and that is deliberate.** They carry no `CustomerId`, so `OwnsSomeCustomerId` never
discovers them, `:143-147` does not name them, and neither guard reports a hole. Their protection is
layer 2 — Task 13's `REVOKE ALL` — because there is no customer to scope an unknown EAN to.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs` (insert after `:109`, the `AuditRecord` filter, before `OnModelCreating`'s closing brace at `:110`)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs:135-137`, `:143-147`, `:220`, `:234`

**Interfaces:**
- Consumes: `IntervalDataVersion`, `IntervalReading`, `MeteringPointDayState`, `DailyPosition`
  (Tasks 5 and 6); the eight `DbSet`s (Task 10); `ICustomerContext`.
- Produces: four `HasQueryFilter` declarations on `PeakPowerDbContext`. Plans 3, 5 and 6 read
  through them; **plan 6's employee data-health endpoints must run on an unscoped context**, or the
  filter hides other tenants' rows from the back office.

- [ ] **Step 1: Write the failing test**

Replace lines `135-137` of
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs`
— before:

```csharp
        // Nine: migration 2's five (Customer, CustomerAccount, MeteringPoint, Wallet,
        // AuditRecord), migration 3's OnboardingApplication, RefreshToken and PasswordResetToken,
        // and migration 5's EanPoolEntry.
```

after:

```csharp
        // Thirteen: migration 2's five (Customer, CustomerAccount, MeteringPoint, Wallet,
        // AuditRecord), migration 3's OnboardingApplication, RefreshToken and PasswordResetToken,
        // migration 5's EanPoolEntry, and migration 9's four - IntervalDataVersion,
        // IntervalReading, MeteringPointDayState and DailyPosition.
        //
        // ⚠ Migration 9 adds EIGHT entities and exactly FOUR of them appear here. InboundMessage,
        // QuarantinedSeries, OperationalAlert and MeteringPointBrpAssignment carry no CustomerId
        // at all - there is no customer to scope an unknown EAN or a staff-only alert to - so
        // OwnsSomeCustomerId never discovers them and they need no filter. Their protection is
        // layer 2: migration 9 REVOKEs every privilege on all four from app_customer_role, so a
        // customer-scoped connection is refused with 42501 rather than filtered. The four that ARE
        // here carry a DENORMALISED customer_id (S2-D1) precisely so this walk can see them: a
        // table keyed only on metering_point_id is not merely unguarded, it is INVISIBLE, and this
        // guard would then report full coverage over unpoliced customer data.
```

Replace lines `143-147` — before:

```csharp
        string[] expected =
        [
            "AuditRecord", "Customer", "CustomerAccount", "EanPoolEntry", "MeteringPoint",
            "OnboardingApplication", "PasswordResetToken", "RefreshToken", "Wallet",
        ];
```

after (ordinal sort order — `StringComparer.Ordinal` puts every capital before every lower-case
letter, so the list is sorted by the whole name, not case-insensitively):

```csharp
        string[] expected =
        [
            "AuditRecord", "Customer", "CustomerAccount", "DailyPosition", "EanPoolEntry",
            "IntervalDataVersion", "IntervalReading", "MeteringPoint", "MeteringPointDayState",
            "OnboardingApplication", "PasswordResetToken", "RefreshToken", "Wallet",
        ];
```

Rename the method at line `220` and move its literal at line `234` — before:

```csharp
    public void the_five_customer_owned_entities_in_todays_model_are_all_covered()
```

after:

```csharp
    public void the_nine_customer_owned_entities_in_todays_model_are_all_covered()
```

and, inside it, add the four new `ShouldContain` calls and move the count — before:

```csharp
        filtered.ShouldContain("AuditRecord");
        filtered.Length.ShouldBe(5,
            "this is a pinned snapshot of today's model, not a substitute for the metadata walk " +
            "above - update it deliberately when a new customer-owned entity is added");
```

after:

```csharp
        filtered.ShouldContain("AuditRecord");
        filtered.ShouldContain("IntervalDataVersion");
        filtered.ShouldContain("IntervalReading");
        filtered.ShouldContain("MeteringPointDayState");
        filtered.ShouldContain("DailyPosition");
        filtered.Length.ShouldBe(9,
            "this is a pinned snapshot of today's model, not a substitute for the metadata walk " +
            "above - update it deliberately when a new customer-owned entity is added. Nine: " +
            "migration 2's five plus migration 9's four. The four employee-only tables migration " +
            "9 also adds carry no CustomerId and take no filter - see the walk above for why");
```

⚠ **The test's name moves with the number.** A method called `the_five_…` asserting nine is how the
next reader is misled, and this file is read by every plan that adds a table.

- [ ] **Step 2: Run the test and watch it fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~QueryFilterModelTests"`

Expected: FAIL, two tests, each with its own message.

`every_entity_type_that_owns_a_customer_id_has_a_global_query_filter` fails on the
`discovered.ShouldBe(expected)` comparison — the model now contains the four new entities (Task 10
mapped them) but the walk's `unfiltered` list is what breaks:

```
unfiltered
    should be empty but was
["IntervalDataVersion", "IntervalReading", "MeteringPointDayState", "DailyPosition"]
```

followed by `an entity with a CustomerId (or CustomerAccountId) and no global query filter is a
tenancy hole.`

`the_nine_customer_owned_entities_in_todays_model_are_all_covered` fails first on
`filtered.ShouldContain("IntervalDataVersion")` with
`filtered should contain "IntervalDataVersion" but was ["Customer", "CustomerAccount", "MeteringPoint", "Wallet", "AuditRecord"]`.

⚠ Both failures are about the **filters**, not the literals: the literals are already correct for
the model Task 10 built. That is the point of editing them first.

- [ ] **Step 3: Add the four global query filters**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs`,
insert after line `109` — that is, after the `AuditRecord` filter's closing `;` and before
`OnModelCreating`'s closing brace:

```csharp

        // ─────────────────────────────────────────────────────────────────────────────────
        // Migration 9's four. S2-D1 denormalises customer_id onto every one of them, and the
        // reason is this method plus its two coverage guards: a table keyed only on
        // metering_point_id is not merely unfiltered, it is INVISIBLE to both walks - one
        // discovers by a property name ending in "CustomerId", the other by a column whose last
        // eleven characters are "customer_id" - and a guard that cannot see a table reports full
        // coverage over unpoliced customer data. The join to reach the tenant is also the join
        // that would make every interval query touch customer.metering_point.
        //
        // The `!IsAuthenticated ||` prefix is not decoration. The back office, the Worker and the
        // anonymous onboarding wizard all read through this same context with no customer scope;
        // without the prefix each filter would evaluate `customer_id = Guid.Empty` and return
        // nothing at all. Layer 2 - the database's row-level security - is what stops the
        // collapse being a hole.
        // ─────────────────────────────────────────────────────────────────────────────────
        modelBuilder.Entity<IntervalDataVersion>()
            .HasQueryFilter(version =>
                !_customerContext.IsAuthenticated ||
                version.CustomerId == _customerContext.CustomerId);

        // ⚠ The table is range-partitioned by month. EF does not model partitions - the entity
        // maps to the parent - so this filter is applied to every partition automatically by
        // PostgreSQL's own partition routing. Migration 9's partition routine is what gives each
        // partition its own row-level security, which is the half EF cannot reach.
        modelBuilder.Entity<IntervalReading>()
            .HasQueryFilter(reading =>
                !_customerContext.IsAuthenticated ||
                reading.CustomerId == _customerContext.CustomerId);

        modelBuilder.Entity<MeteringPointDayState>()
            .HasQueryFilter(state =>
                !_customerContext.IsAuthenticated ||
                state.CustomerId == _customerContext.CustomerId);

        modelBuilder.Entity<DailyPosition>()
            .HasQueryFilter(position =>
                !_customerContext.IsAuthenticated ||
                position.CustomerId == _customerContext.CustomerId);
```

The file already has `using PeakPower.Domain.Metering;` (line 6), so no new using is needed.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~QueryFilterModelTests"
```

Expected: build clean; PASS. `QueryFilterModelTests` builds a model and opens no connection, so it
passes here even though migration 9 does not exist yet.

- [ ] **Step 5: Mutate one filter away and check BOTH pins go red**

The second pin at `:234` is deliberately redundant. A redundant pin that no mutation can move is
decoration, so prove it moves. Delete the `MeteringPointDayState` filter block from
`OnModelCreating`:

```csharp
        // MUTATION - the whole MeteringPointDayState block removed for one run
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~QueryFilterModelTests"`

Expected: **two** failures, not one.
- `every_entity_type_that_owns_a_customer_id_has_a_global_query_filter`:
  `unfiltered should be empty but was ["MeteringPointDayState"]`
- `the_nine_customer_owned_entities_in_todays_model_are_all_covered`:
  `filtered should contain "MeteringPointDayState" but was ["Customer", …, "IntervalReading", "DailyPosition"]`

Two independent walks going red on one deletion is what makes keeping both worth the maintenance.
Restore the block.

Now mutate the **shape** rather than the presence — drop the `!IsAuthenticated ||` prefix from
`IntervalReading`'s filter:

```csharp
        // MUTATION
        modelBuilder.Entity<IntervalReading>()
            .HasQueryFilter(reading => reading.CustomerId == _customerContext.CustomerId);
```

Run: the same command.
Expected: **PASS** — nothing goes red.

That is a real finding rather than a failed mutation, and it is written down here because it is the
honest limit of a model-only test: `GetDeclaredQueryFilters().Count > 0` proves a filter was
declared, never that its predicate is right. A filter that is present but backwards passes every
test in this file. **Task 17 is where the predicate is proven**, against a real database, by reading
company A's rows on a customer-scoped context and finding none of company B's. Restore the prefix
before moving on — leaving it out would return zero interval readings to the back office.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs \
        tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs
git commit -m "feat(persistence): add the four global query filters for migration 9's tenant tables

Tenancy layer 1 for interval_data_version, interval_reading, metering_point_day_state and
daily_position. S2-D1's denormalised customer_id is what lets the coverage walk see them at
all - a table keyed only on metering_point_id is invisible to it, and an invisible table is
reported as covered. The other four tables migration 9 adds carry no CustomerId and take no
filter; layer 2's REVOKE is their protection. Both pinned literals move, and deleting one
filter is verified to turn both of them red.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Migration 9 — every table, column, index and the partition routine

The centre of this plan. Contract §6 is normative and this task transcribes it; nothing here
invents a column.

⚠ **Hand-written raw SQL, not a scaffolded migration.** `migrationBuilder.CreateTable` cannot emit
`PARTITION BY RANGE`, cannot emit a `CREATE FUNCTION`, and cannot emit a partial unique index with a
bare boolean predicate. Half a scaffolded migration plus half a hand-written one is worse than one
of either — the reader cannot tell which half is authoritative. So the migration is generated for
its **timestamp, its `Designer.cs` and its model snapshot**, and then its `Up()` and `Down()` bodies
are replaced entirely.

⚠ **Read the real migrations before writing any DDL.** Three things the published database design
shows are not in the shipped schema, all verified against
`20260827051436_InitialSchema.cs` today:

| The published DDL shows | The shipped schema has | Consequence for this migration |
| --- | --- | --- |
| `customer.metering_point.brp_assigned_at` | **no such column** | migration 9 `ADD COLUMN`s it; it may not be `ALTER`ed |
| `customer.metering_point.first_production_observed_at` | **no such column** | same |
| `CREATE UNIQUE INDEX ux_account_subject … WHERE external_subject_id IS NOT NULL` | `InitialSchema` never created it — the three indexes on `customer.customer_account` are `ix_customer_account_customer_id`, `ix_customer_account_email`, `ix_customer_account_username` | the `ExternalSubjectId` drop is **one** statement. A `DROP INDEX ux_account_subject` without `IF EXISTS` fails migration 9 with `42P01` |

There is also **no `CHECK` on `production_expectation` or `expectation_source`** — the value set is
enforced by `EnumToScreamingSnakeConverter` alone. Migration 9 adds exactly one check touching
either of them, `ck_mp_never_has_no_observed_production`, and adds no value-set check.

⚠ **Migration 1 already seeds the `PVNED` row** (`id 0199a1a0-0000-7000-8000-0000000000b1`, name
`PVNed B.V.`) and `ix_brp_code` is a unique index on `code`. This migration **UPDATEs** it. An
`INSERT INTO metering.brp` gets Postgres `23505` on the very first run.

⚠ **No `now()` decides the SET of objects this migration creates.** The partition seed loop is a
fixed 36-month window, `2025-01-01` through `2027-12-01`, so two databases created a month apart get
the same schema and `verify-migrator.sh`'s double-run idempotence check keeps meaning something.
`DEFAULT now()` on a *column* is a different thing and is used freely.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_IngestionAndIntervalData.cs`
- Create (generated, left as generated): `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_IngestionAndIntervalData.Designer.cs`
- Modify (regenerated, left as regenerated): `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Migrations/PeakPowerDbContextModelSnapshot.cs`
- Test: none new in this task. Task 13 adds the privilege tests, Task 14 the ordered-list literals
  and Task 15 the behavioural schema tests. This task's own verification is the real migrator
  against a real container, in Step 11.

**Interfaces:**
- Consumes: the model Task 10 built (only for the snapshot and the `Designer.cs`);
  `MeteringPointBrpAssignment.MigrationActor` = `"system:migration-9"`, which the backfill's
  `assigned_by` literal must equal.
- Produces: the ninth migration, `<timestamp>_IngestionAndIntervalData`, and with it every table,
  column, index, constraint and function of contract §6.1–§6.7. Task 13 appends §6.8's policies and
  `REVOKE`s to the **same** migration.

- [ ] **Step 1: Confirm the shipped schema before writing a line of DDL**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -n 'brp_assigned_at\|first_production_observed_at\|ux_account_subject\|external_subject_id' \
  src/Infrastructure/PeakPower.Persistence/Migrations/20260827051436_InitialSchema.cs \
  > /tmp/initial-schema-facts.txt 2>&1
grep -n 'ALTER DEFAULT PRIVILEGES' -A 3 \
  src/Infrastructure/PeakPower.Persistence/Migrations/20260827092246_TenancyRowLevelSecurity.cs \
  >> /tmp/initial-schema-facts.txt 2>&1
wc -l /tmp/initial-schema-facts.txt
```

Read `/tmp/initial-schema-facts.txt` — **do not trust the terminal**, a shell hook here rewrites
`grep` through a filter that truncates. Expected: exactly one hit for `external_subject_id`
(`:111`), **no hit at all** for `brp_assigned_at`, `first_production_observed_at` or
`ux_account_subject`, and the `ALTER DEFAULT PRIVILEGES … GRANT SELECT, INSERT, UPDATE, DELETE ON
TABLES TO app_customer_role, app_employee_role` block at `:110-112` of migration 2. A hit for
`brp_assigned_at` means this plan's premise is wrong and the `ADD COLUMN` below must become an
`ALTER COLUMN`; stop and re-read the file rather than guessing.

- [ ] **Step 2: Generate the migration, for its timestamp and its snapshot**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet ef migrations add IngestionAndIntervalData \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator \
  --output-dir Migrations --context PeakPowerDbContext
ls src/Infrastructure/PeakPower.Persistence/Migrations > /tmp/migrations-after-add.txt 2>&1
cat /tmp/migrations-after-add.txt
```

Expected: three files changed — a new `<ts>_IngestionAndIntervalData.cs`, a new
`<ts>_IngestionAndIntervalData.Designer.cs`, and a rewritten
`PeakPowerDbContextModelSnapshot.cs`. Note the actual `<ts>` from the listing; every path below uses
it.

⚠ **Keep the `Designer.cs` and the snapshot exactly as generated.** They record what the model looks
like, which is what the *next* `dotnet ef migrations add` diffs against. Only the `.cs` file's
`Up()` and `Down()` bodies are replaced. ⚠ Confirm the snapshot no longer mentions
`external_subject_id` — Task 9 removed the property, and this regeneration is what drops it from
`PeakPowerDbContextModelSnapshot.cs:168`.

- [ ] **Step 3: Replace the generated file with the migration's shell and `metering.brp`**

Replace the **whole** contents of
`src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_IngestionAndIntervalData.cs` with the
following. Steps 4 through 9 each append one more `migrationBuilder.Sql(…)` block inside `Up()`, in
the order written, and Step 9 fills in `Down()`.

```csharp
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PeakPower.Persistence.Migrations
{
    /// <summary>
    /// Migration 9: ingestion and interval data. Seven new tables, six configuration columns on
    /// <c>metering.brp</c>, four on <c>customer.metering_point</c>, the BRP-assignment history,
    /// the range-partitioned <c>metering.interval_reading</c> and the routine that policies every
    /// partition it creates.
    ///
    /// <para>
    /// <b>Hand-written raw SQL, deliberately.</b> <c>migrationBuilder.CreateTable</c> cannot emit
    /// <c>PARTITION BY RANGE</c>, cannot emit a <c>CREATE FUNCTION</c>, and cannot emit a partial
    /// unique index whose predicate is a bare boolean column. Half a scaffolded migration beside
    /// half a hand-written one leaves a reader unable to tell which half is authoritative, so all
    /// of it is written out. The model snapshot is still generated from the EF configurations, so
    /// the next <c>dotnet ef migrations add</c> diffs cleanly; <c>IngestionRoundTripTests</c> is
    /// what proves the model and this SQL describe the same schema, because a column name or type
    /// that disagrees makes EF's INSERT fail.
    /// </para>
    ///
    /// <para>
    /// <b>Nothing here reads <c>now()</c> to decide what to create.</b> The partition seed loop
    /// covers a fixed 36-month window, 2025-01 through 2027-12, so two databases created a month
    /// apart reach the same schema and <c>tools/verify-migrator.sh</c>'s double-run idempotence
    /// check keeps meaning something. The maintenance job - which may read a clock, through
    /// <c>IMarketCalendar</c> - keeps three months ahead of today. <c>DEFAULT now()</c> on a
    /// COLUMN is a different thing and is used freely.
    /// </para>
    ///
    /// <para>
    /// <b>Roll forward only - S2-D7.</b> The deployed <c>DatabaseMigrator</c> calls only
    /// <c>MigrateAsync</c>, so <c>Down()</c> never runs in the shipped path. It is written
    /// correctly anyway, because a developer may run <c>dotnet ef database update</c> against an
    /// earlier migration by hand - but nothing may rely on it.
    /// </para>
    /// </summary>
    public partial class IngestionAndIntervalData : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ─────────────────────────────────────────────────────────────────────────────
            // 1. metering.brp - the six columns that make the [DEC-69] seam selectable.
            //
            // The table has only id / code / name / is_active today, so the adapter seam has no
            // data behind it and cannot resolve anything. The three columns that lose their
            // DEFAULT below get one only so the ADD COLUMN can be NOT NULL against existing
            // rows; the UPDATE then fills the real values in and the DEFAULT is dropped, so a
            // future INSERT that forgets them fails at the not-blank CHECK rather than quietly
            // creating a BRP that routes nowhere.
            //
            // ⚠ credential_ref holds the NAME of an environment variable, never a secret. §9.3
            // is the whole convention, and the seeded value is the literal string
            // BRP_CREDENTIAL_PVNED.
            //
            // ⚠ Migration 1 already seeded the PVNED row and ix_brp_code is UNIQUE on code, so
            // this UPDATEs. An INSERT here gets 23505 on the very first run.
            // ─────────────────────────────────────────────────────────────────────────────
            migrationBuilder.Sql(
                """
                ALTER TABLE metering.brp ADD COLUMN endpoint_uri     text NOT NULL DEFAULT '';
                ALTER TABLE metering.brp ADD COLUMN credential_ref   text NOT NULL DEFAULT '';
                ALTER TABLE metering.brp ADD COLUMN document_format  text NOT NULL DEFAULT 'PVNED_TIMESERIES_XML';
                ALTER TABLE metering.brp ADD COLUMN adapter_key      text NOT NULL DEFAULT '';
                ALTER TABLE metering.brp ADD COLUMN expected_cadence text NOT NULL DEFAULT 'DAILY_PER_EAN';
                ALTER TABLE metering.brp ADD COLUMN created_at       timestamptz NOT NULL DEFAULT now();

                UPDATE metering.brp
                   SET endpoint_uri   = '/webhooks/brp/PVNED',
                       credential_ref = 'BRP_CREDENTIAL_PVNED',
                       adapter_key    = 'PVNED_TIMESERIES_XML_V2P0'
                 WHERE code = 'PVNED';

                ALTER TABLE metering.brp ALTER COLUMN endpoint_uri   DROP DEFAULT;
                ALTER TABLE metering.brp ALTER COLUMN credential_ref DROP DEFAULT;
                ALTER TABLE metering.brp ALTER COLUMN adapter_key    DROP DEFAULT;

                ALTER TABLE metering.brp
                    ADD CONSTRAINT ck_brp_document_format CHECK (document_format IN ('PVNED_TIMESERIES_XML')),
                    ADD CONSTRAINT ck_brp_expected_cadence CHECK (expected_cadence IN ('DAILY_PER_EAN')),
                    ADD CONSTRAINT ck_brp_endpoint_uri_not_blank CHECK (length(btrim(endpoint_uri)) > 0),
                    ADD CONSTRAINT ck_brp_credential_ref_not_blank CHECK (length(btrim(credential_ref)) > 0),
                    ADD CONSTRAINT ck_brp_adapter_key_not_blank CHECK (length(btrim(adapter_key)) > 0),
                    ADD CONSTRAINT ux_brp_adapter_key_code UNIQUE (adapter_key, code);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
        }
    }
}
```

- [ ] **Step 4: Append `customer.metering_point`'s four columns and the assignment history**

Append inside `Up()`, after the `metering.brp` block:

```csharp
            // ─────────────────────────────────────────────────────────────────────────────
            // 2. customer.metering_point - four columns, one check, one partial index, and the
            //    BRP-assignment history [F02-R43].
            //
            // ⚠ NEITHER brp_assigned_at NOR first_production_observed_at exists today. The
            // published DDL shows both; 20260827051436_InitialSchema.cs creates neither. Both
            // are ADD COLUMN here, and brp_assigned_at is NOT NULL DEFAULT now() so the existing
            // rows get a value - MeteringPoint.Attach may not read a clock, architecture fact 5
            // confines that to PeakPower.Infrastructure.Time and enforces it over the IL, so the
            // store default is where the value comes from on insert too.
            //
            // ⚠ ck_mp_never_has_no_observed_production is what forces [F02-R34]'s promotion into
            // the SAME TRANSACTION as the readings. Observed production contradicts NEVER, and
            // the processor must RESOLVE the contradiction rather than log it; making the
            // halfway state unstorable is how the database refuses to hold a reading beside
            // master data that disagrees with it. It validates cleanly against existing rows
            // because first_production_observed_at is null on every one of them.
            //
            // ⚠ ix_mp_production_expected covers only the expectations where a missing A01 is a
            // FAULT or an UNKNOWN, never a fact. A NEVER point's missing production series is a
            // declared zero. [DEC-65], [F02-R22], [F02-R26]
            //
            // ⚠ The history is a first-class table, not "an ordinary audit row" as the published
            // DDL §3.2.1 says, because [F02-R43] also says the assignment IN FORCE AT RECEIPT
            // TIME decides WRONG_BRP - and an audit payload is not a queryable history. Shared
            // contract §16 item 3.
            // ─────────────────────────────────────────────────────────────────────────────
            migrationBuilder.Sql(
                """
                ALTER TABLE customer.metering_point
                    ADD COLUMN brp_assigned_at               timestamptz NOT NULL DEFAULT now(),
                    ADD COLUMN first_production_observed_at  timestamptz,
                    ADD COLUMN production_expectation_set_by text,
                    ADD COLUMN production_expectation_set_at timestamptz;

                ALTER TABLE customer.metering_point
                    ADD CONSTRAINT ck_mp_never_has_no_observed_production
                    CHECK (production_expectation <> 'NEVER' OR first_production_observed_at IS NULL);

                CREATE INDEX ix_mp_production_expected ON customer.metering_point
                    (production_expectation, customer_id)
                    WHERE production_expectation IN ('EXPECTED','UNKNOWN');

                CREATE TABLE customer.metering_point_brp_assignment (
                    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    metering_point_id  uuid NOT NULL REFERENCES customer.metering_point(id),
                    from_brp_id        uuid REFERENCES metering.brp(id),
                    to_brp_id          uuid NOT NULL REFERENCES metering.brp(id),
                    assigned_at        timestamptz NOT NULL DEFAULT now(),
                    assigned_by        text NOT NULL CHECK (length(btrim(assigned_by)) > 0),
                    reason             text NOT NULL CHECK (length(btrim(reason)) > 0)
                );

                CREATE INDEX ix_mpba_point ON customer.metering_point_brp_assignment
                    (metering_point_id, assigned_at DESC);

                INSERT INTO customer.metering_point_brp_assignment
                       (metering_point_id, from_brp_id, to_brp_id, assigned_at, assigned_by, reason)
                SELECT id, NULL, brp_id, brp_assigned_at, 'system:migration-9',
                       'Initial assignment, backfilled when the assignment history was introduced.'
                  FROM customer.metering_point;
                """);
```

⚠ `'system:migration-9'` is the literal value of `MeteringPointBrpAssignment.MigrationActor`
(Task 8). Task 15 asserts the two agree by comparing the backfilled rows against the constant, so a
rename of one without the other goes red rather than silently splitting the history in two.

- [ ] **Step 5: Append the `ExternalSubjectId` drop**

Append inside `Up()`:

```csharp
            // ─────────────────────────────────────────────────────────────────────────────
            // 3. customer.customer_account - the free drop. [DEC-119] removed the external
            //    identity provider this column was reserved for; it is null on every row.
            //
            // ⚠ ONE statement, not two. The published DDL shows a partial unique index
            // ux_account_subject over this column, but 20260827051436_InitialSchema.cs never
            // created it - the three indexes on this table are ix_customer_account_customer_id,
            // ix_customer_account_email and ix_customer_account_username. A DROP INDEX without
            // IF EXISTS would fail this migration with 42P01 against every existing database.
            // ─────────────────────────────────────────────────────────────────────────────
            migrationBuilder.Sql(
                """
                ALTER TABLE customer.customer_account DROP COLUMN external_subject_id;
                """);
```

- [ ] **Step 6: Append `metering.inbound_message` and `metering.interval_data_version`**

Append inside `Up()`:

```csharp
            // ─────────────────────────────────────────────────────────────────────────────
            // 4. metering.inbound_message - one row per accepted POST, the stored raw document.
            //
            // ⚠ The published DDL's nullable `source text` column is deliberately NOT created.
            // [DEC-69] made the BRP a row and F02 §8 says the constant source column "becomes
            // this reference"; carrying both is a second place the answer can disagree with
            // brp_id.
            //
            // remote_ip is inet, not text: a text-typed parameter into an inet column fails with
            // 42804, verified against postgres:17. The EF property is string? and converts
            // through System.Net.IPAddress, which Npgsql maps to inet natively.
            // ─────────────────────────────────────────────────────────────────────────────
            migrationBuilder.Sql(
                """
                CREATE TABLE metering.inbound_message (
                    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    brp_id         uuid NOT NULL REFERENCES metering.brp(id),
                    correlation_id uuid NOT NULL,
                    received_at    timestamptz NOT NULL DEFAULT now(),
                    payload_hash   bytea NOT NULL,
                    payload_bytes  bigint NOT NULL CHECK (payload_bytes >= 0),
                    payload_uri    text NOT NULL,
                    http_headers   jsonb,
                    remote_ip      inet,
                    status         text NOT NULL
                        CHECK (status IN ('RECEIVED','PROCESSING','PROCESSED','FAILED','DUPLICATE')),
                    failure_code   text,
                    failure_detail text,
                    processed_at   timestamptz,
                    CONSTRAINT ck_msg_failed_has_code
                        CHECK (status <> 'FAILED' OR (failure_code IS NOT NULL AND failure_detail IS NOT NULL))
                );

                CREATE INDEX ix_msg_hash_recent ON metering.inbound_message (payload_hash, received_at DESC);
                CREATE INDEX ix_msg_brp         ON metering.inbound_message (brp_id, received_at DESC);
                CREATE INDEX ix_msg_status      ON metering.inbound_message (status, received_at DESC);
                CREATE UNIQUE INDEX ux_msg_correlation ON metering.inbound_message (correlation_id);
                """);

            // ─────────────────────────────────────────────────────────────────────────────
            // 5. metering.interval_data_version - one version of one direction of one day, from
            //    one document [DEC-07], [F02-R16]. [DEC-143]/S2-D2 settles the shape:
            //    `source` is the discriminator, inbound_message_id is NULLABLE, and there is NO
            //    brp_id column - a second column can disagree with the message it came from, and
            //    a MANUAL version correctly has no BRP at all. The two checks are what stop
            //    `source` becoming a column anybody can set to anything.
            //
            // ⚠ ux_idv_current is the ENFORCEMENT of receipt-order supersession, not a nicety.
            // Design §4.2: the current version is always the LAST ONE RECEIVED, never the newest
            // by CreatedDateTime, and both receipt orders of the same pair must leave the
            // second-received version current. The partial unique index is what makes "exactly
            // one current" a database fact rather than an application convention.
            //
            // customer_id is denormalised here per S2-D1 - see this migration's policy block and
            // PeakPowerDbContext.OnModelCreating for why the join would not do.
            // ─────────────────────────────────────────────────────────────────────────────
            migrationBuilder.Sql(
                """
                CREATE TABLE metering.interval_data_version (
                    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    metering_point_id  uuid NOT NULL REFERENCES customer.metering_point(id),
                    customer_id        uuid NOT NULL REFERENCES customer.customer(id),
                    delivery_date      date NOT NULL,
                    direction          text NOT NULL CHECK (direction IN ('CONSUMPTION','PRODUCTION')),
                    source             text NOT NULL CHECK (source IN ('BRP_FEED','MANUAL')),
                    document_id        text,
                    document_created   timestamptz,
                    received_at        timestamptz NOT NULL,
                    inbound_message_id uuid REFERENCES metering.inbound_message(id),
                    correlation_id     uuid NOT NULL,
                    interval_count     smallint NOT NULL CHECK (interval_count IN (92, 96, 100)),
                    is_current         boolean NOT NULL DEFAULT true,
                    created_at         timestamptz NOT NULL DEFAULT now(),

                    CONSTRAINT ck_idv_brp_feed_has_message CHECK (
                        source <> 'BRP_FEED'
                        OR (inbound_message_id IS NOT NULL
                            AND document_id IS NOT NULL
                            AND document_created IS NOT NULL)),

                    CONSTRAINT ck_idv_manual_has_no_message CHECK (
                        source <> 'MANUAL' OR inbound_message_id IS NULL)
                );

                CREATE UNIQUE INDEX ux_idv_current
                    ON metering.interval_data_version (metering_point_id, delivery_date, direction)
                    WHERE is_current;

                CREATE INDEX ix_idv_point_date ON metering.interval_data_version
                    (metering_point_id, delivery_date, direction, received_at DESC);
                CREATE INDEX ix_idv_message  ON metering.interval_data_version (inbound_message_id);
                CREATE INDEX ix_idv_customer ON metering.interval_data_version (customer_id, delivery_date);
                """);
```

- [ ] **Step 7: Append `metering.interval_reading`, the partition routine and the fixed seed window**

Append inside `Up()`:

```csharp
            // ─────────────────────────────────────────────────────────────────────────────
            // 6. metering.interval_reading - range-partitioned by month, and the routine that
            //    policies every partition it creates.
            //
            // ⚠ Three facts about PostgreSQL 17, each established by running the statement
            // rather than by reading documentation, and together they are why the routine exists:
            //   (a) ENABLE ROW LEVEL SECURITY on a partitioned PARENT does not reach its
            //       partitions - pg_class.relrowsecurity reads t for the parent and f for the
            //       partition - and policies do not propagate either.
            //   (b) A GRANT on the parent does not reach the partitions, but migration 2's
            //       ALTER DEFAULT PRIVILEGES DOES: a partition created with
            //       CREATE TABLE ... PARTITION OF arrives with arwd for app_customer_role.
            //   (c) The combination is a live hole - the parent policed, the partition not, so a
            //       direct SELECT on the partition returned BOTH tenants' rows.
            // So the routine applies row-level security, both policies and the grants to every
            // partition it creates, and PartitionPolicyCoverageTests (Task 16) asserts that no
            // partition lacks them. Neither alone is enough: the routine is the mechanism, the
            // catalog test is what stops a hand-created partition becoming the hole again.
            //
            // ⚠ Policy names fit. metering_interval_reading_2026_08_tenant_isolation is 50
            // characters, comfortably inside PostgreSQL's 63-byte identifier limit. Do not
            // lengthen the prefix.
            //
            // customer_id carries NO foreign key here - S2-D1 - deliberately: an FK on a table
            // that gains a partition a month makes every partition attach take a lock on
            // customer.customer for nothing the four other tables' FKs do not already say.
            //
            // quantity_kwh >= 0 on BOTH directions. Consumption and production stay two separate
            // non-negative series [AS-05]; net usage is derived per interval and never stored as
            // a signed source series. A negative reading means a direction was mapped wrong,
            // which under [DEC-22] is a wrong invoice rather than a wrong chart.
            //
            // interval_start is STORED, resolved by IMarketCalendar.IntervalStart. Storing it is
            // what lets the market.calendar_interval spine be deferred - the spine becomes a
            // later pure join optimisation rather than a prerequisite.
            // ─────────────────────────────────────────────────────────────────────────────
            migrationBuilder.Sql(
                """
                CREATE TABLE metering.interval_reading (
                    version_id     uuid NOT NULL REFERENCES metering.interval_data_version(id),
                    delivery_date  date NOT NULL,
                    customer_id    uuid NOT NULL,
                    pos            smallint NOT NULL CHECK (pos BETWEEN 1 AND 100),
                    interval_start timestamptz NOT NULL,
                    quantity_kwh   numeric(14,3) NOT NULL CHECK (quantity_kwh >= 0),
                    PRIMARY KEY (delivery_date, version_id, pos)
                ) PARTITION BY RANGE (delivery_date);

                CREATE INDEX ix_reading_start    ON metering.interval_reading USING brin (interval_start);
                CREATE INDEX ix_reading_customer ON metering.interval_reading (customer_id, delivery_date);
                """);

            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION metering.ensure_interval_reading_partition(p_month date)
                RETURNS text
                LANGUAGE plpgsql
                AS $fn$
                DECLARE
                    v_from date := date_trunc('month', p_month)::date;
                    v_to   date := (date_trunc('month', p_month) + interval '1 month')::date;
                    v_name text := 'interval_reading_' || to_char(v_from, 'YYYY_MM');
                BEGIN
                    IF EXISTS (SELECT 1 FROM pg_class c
                                 JOIN pg_namespace n ON n.oid = c.relnamespace
                                WHERE n.nspname = 'metering' AND c.relname = v_name) THEN
                        RETURN v_name;
                    END IF;

                    EXECUTE format(
                        'CREATE TABLE metering.%I PARTITION OF metering.interval_reading '
                        'FOR VALUES FROM (%L) TO (%L)', v_name, v_from, v_to);

                    EXECUTE format('ALTER TABLE metering.%I ENABLE ROW LEVEL SECURITY', v_name);

                    EXECUTE format(
                        'CREATE POLICY metering_%s_tenant_isolation ON metering.%I '
                        'FOR ALL TO app_customer_role '
                        'USING (customer_id = NULLIF(current_setting(''app.customer_id'', true), '''')::uuid) '
                        'WITH CHECK (customer_id = NULLIF(current_setting(''app.customer_id'', true), '''')::uuid)',
                        v_name, v_name);

                    EXECUTE format(
                        'CREATE POLICY metering_%s_back_office ON metering.%I '
                        'FOR ALL TO app_employee_role USING (true) WITH CHECK (true)', v_name, v_name);

                    EXECUTE format('GRANT SELECT ON metering.%I TO app_customer_role', v_name);
                    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON metering.%I FROM app_customer_role', v_name);
                    EXECUTE format(
                        'GRANT SELECT, INSERT, UPDATE, DELETE ON metering.%I TO app_employee_role', v_name);

                    RETURN v_name;
                END;
                $fn$;
                """);

            // A FIXED 36-month window, 2025-01 .. 2027-12. Wide enough for DevStubs' 90-day
            // backfill and for the 100-EAN x 365-day load test, and it contains no call to now()
            // - so two databases created a month apart reach the same schema and the double-run
            // idempotence check in tools/verify-migrator.sh keeps meaning something.
            migrationBuilder.Sql(
                """
                DO $seed$
                DECLARE m date := DATE '2025-01-01';
                BEGIN
                    WHILE m < DATE '2028-01-01' LOOP
                        PERFORM metering.ensure_interval_reading_partition(m);
                        m := (m + interval '1 month')::date;
                    END LOOP;
                END
                $seed$;
                """);
```

⚠ **The `$fn$` and `$seed$` dollar-quote tags are load-bearing.** The routine's body itself contains
`''` escapes and a `%L` format specifier; a bare `$$` tag would end the literal at the first `$$`
inside. Use the named tags exactly as written. C# raw string literals (`"""…"""`) pass `$` through
untouched, and none of these blocks is interpolated — there is no `$"""`, so `{` and `}` need no
doubling either.

- [ ] **Step 8: Append the remaining four tables**

Append inside `Up()`:

```csharp
            // ─────────────────────────────────────────────────────────────────────────────
            // 7. The day state, the quarantine, the daily rollup and the alert.
            //
            // ⚠ delivery_date is the column name for a metering day on EVERY one of the seven
            // new tables. The published DDL §4 calls it local_date on daily_position; shared
            // contract §16 item 1 overrules that, so one word means one thing across all seven.
            //
            // ⚠ daily_position diverges from the published DDL §4 in three ways, all deliberate.
            // (a) delivery_date, above. (b) block_kwh, covered_kwh, uncovered_kwh, surplus_kwh
            // and spot_cost_eur are NOT created - blocks are F05/Phase 2 and every money figure
            // is out under S2-D6, and a column that is NULL on every row for a phase is a column
            // somebody eventually reads as zero. (c) offtake_kwh and export_kwh are NEW, and
            // they are the point of the table.
            //
            // ⚠ offtake_kwh and export_kwh are accumulated PER INTERVAL and cannot be recovered
            // from the three totals beside them. Design §4.1's worked case: consumption [10, 0],
            // production [0, 5] gives U = [10, -5], so offtake 10 and export 5 - while daily
            // totals give 5 and 0, and discard the export entirely.
            //
            // ⚠ metering_point_day_state has NO 'COMPLETE' state. F02 §6's machine is
            // NO_DATA -> PARTIAL -> PROVISIONAL -> FINAL; integration-spec §8.3's word
            // "Complete" names the CONDITION that moves a day to PROVISIONAL, not a fifth state.
            //
            // quarantined_series carries two references to inbound_message on purpose: the
            // message the series ARRIVED in, and the replay run that CLEARED it. They are
            // different messages, and collapsing them would lose the replay provenance
            // [F02-R14], [F02-R15].
            // ─────────────────────────────────────────────────────────────────────────────
            migrationBuilder.Sql(
                """
                CREATE TABLE metering.metering_point_day_state (
                    metering_point_id          uuid NOT NULL REFERENCES customer.metering_point(id),
                    delivery_date              date NOT NULL,
                    customer_id                uuid NOT NULL REFERENCES customer.customer(id),
                    state                      text NOT NULL
                        CHECK (state IN ('NO_DATA','PARTIAL','PROVISIONAL','FINAL')),
                    expected_interval_count    smallint NOT NULL CHECK (expected_interval_count IN (92,96,100)),
                    consumption_complete       boolean NOT NULL DEFAULT false,
                    production_complete        boolean NOT NULL DEFAULT false,
                    production_is_declared_zero boolean NOT NULL DEFAULT false,
                    finalised_at               timestamptz,
                    last_corrected_at          timestamptz,
                    computed_at                timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (metering_point_id, delivery_date)
                );

                CREATE INDEX ix_mpds_state    ON metering.metering_point_day_state (state, delivery_date);
                CREATE INDEX ix_mpds_customer ON metering.metering_point_day_state (customer_id, delivery_date);

                CREATE TABLE metering.quarantined_series (
                    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    inbound_message_id uuid NOT NULL REFERENCES metering.inbound_message(id),
                    brp_id             uuid NOT NULL REFERENCES metering.brp(id),
                    reason             text NOT NULL
                        CHECK (reason IN ('UNKNOWN_EAN','EAN_VALIDITY','WRONG_BRP','NOT_ELECTRICITY')),
                    resource_object    text NOT NULL,
                    delivery_date      date NOT NULL,
                    direction          text NOT NULL CHECK (direction IN ('CONSUMPTION','PRODUCTION')),
                    point_count        smallint NOT NULL,
                    received_at        timestamptz NOT NULL,
                    resolved_at        timestamptz,
                    resolved_by        text,
                    resolved_by_replay_of_message_id uuid REFERENCES metering.inbound_message(id)
                );

                CREATE INDEX ix_quarantine_open ON metering.quarantined_series (reason, received_at DESC)
                    WHERE resolved_at IS NULL;
                CREATE INDEX ix_quarantine_message ON metering.quarantined_series (inbound_message_id);

                CREATE TABLE metering.daily_position (
                    metering_point_id  uuid NOT NULL REFERENCES customer.metering_point(id),
                    delivery_date      date NOT NULL,
                    customer_id        uuid NOT NULL REFERENCES customer.customer(id),
                    consumption_kwh    numeric(16,3) NOT NULL,
                    production_kwh     numeric(16,3) NOT NULL,
                    net_usage_kwh      numeric(16,3) NOT NULL,
                    offtake_kwh        numeric(16,3) NOT NULL CHECK (offtake_kwh >= 0),
                    export_kwh         numeric(16,3) NOT NULL CHECK (export_kwh  >= 0),
                    data_state         text NOT NULL
                        CHECK (data_state IN ('NO_DATA','PARTIAL','PROVISIONAL','FINAL')),
                    source_version_ids uuid[] NOT NULL,
                    computed_at        timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (metering_point_id, delivery_date)
                );

                CREATE INDEX ix_dp_customer ON metering.daily_position (customer_id, delivery_date);

                CREATE TABLE metering.operational_alert (
                    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    kind               text NOT NULL CHECK (kind IN (
                        'VALIDATION_FAILURE','METERING_POINT_SILENT','PRODUCTION_EXPECTATION_PROMOTED',
                        'MISSING_PRODUCTION_DECLARATION','POST_WINDOW_RECONCILIATION')),
                    status             text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
                    metering_point_id  uuid REFERENCES customer.metering_point(id),
                    brp_id             uuid REFERENCES metering.brp(id),
                    inbound_message_id uuid REFERENCES metering.inbound_message(id),
                    delivery_date      date,
                    summary            text NOT NULL CHECK (length(btrim(summary)) > 0),
                    detail             text,
                    raised_at          timestamptz NOT NULL DEFAULT now(),
                    resolved_at        timestamptz
                );

                CREATE INDEX ix_alert_open  ON metering.operational_alert (kind, raised_at DESC)
                    WHERE resolved_at IS NULL;
                CREATE INDEX ix_alert_point ON metering.operational_alert (metering_point_id, raised_at DESC);
                """);
```

- [ ] **Step 9: Write `Down()`**

Replace the empty `Down()` body with:

```csharp
            // Roll forward only - S2-D7. The deployed DatabaseMigrator calls only MigrateAsync,
            // so this never runs in the shipped path; it is written correctly because a developer
            // may run `dotnet ef database update <earlier>` by hand, and nothing may RELY on it.
            //
            // Reverse dependency order. Dropping the partitioned parent takes its 36 partitions,
            // their policies and their grants with it - a partition has no independent existence
            // - so no partition is named here. The function is dropped after the table, because
            // dropping it first would leave a maintenance job with nothing to call and the table
            // with no way to gain a partition.
            //
            // ⚠ external_subject_id comes back NULLABLE with no index. It was null on every row
            // before the drop and [DEC-119] removed the provider it named, so restoring the
            // published DDL's ux_account_subject here would create an index that never existed.
            migrationBuilder.Sql(
                """
                DROP TABLE IF EXISTS metering.operational_alert;
                DROP TABLE IF EXISTS metering.daily_position;
                DROP TABLE IF EXISTS metering.quarantined_series;
                DROP TABLE IF EXISTS metering.metering_point_day_state;
                DROP TABLE IF EXISTS metering.interval_reading;
                DROP FUNCTION IF EXISTS metering.ensure_interval_reading_partition(date);
                DROP TABLE IF EXISTS metering.interval_data_version;
                DROP TABLE IF EXISTS metering.inbound_message;
                DROP TABLE IF EXISTS customer.metering_point_brp_assignment;

                ALTER TABLE customer.customer_account ADD COLUMN external_subject_id text;

                DROP INDEX IF EXISTS customer.ix_mp_production_expected;
                ALTER TABLE customer.metering_point
                    DROP CONSTRAINT IF EXISTS ck_mp_never_has_no_observed_production;
                ALTER TABLE customer.metering_point
                    DROP COLUMN IF EXISTS production_expectation_set_at,
                    DROP COLUMN IF EXISTS production_expectation_set_by,
                    DROP COLUMN IF EXISTS first_production_observed_at,
                    DROP COLUMN IF EXISTS brp_assigned_at;

                ALTER TABLE metering.brp
                    DROP CONSTRAINT IF EXISTS ux_brp_adapter_key_code,
                    DROP CONSTRAINT IF EXISTS ck_brp_adapter_key_not_blank,
                    DROP CONSTRAINT IF EXISTS ck_brp_credential_ref_not_blank,
                    DROP CONSTRAINT IF EXISTS ck_brp_endpoint_uri_not_blank,
                    DROP CONSTRAINT IF EXISTS ck_brp_expected_cadence,
                    DROP CONSTRAINT IF EXISTS ck_brp_document_format;
                ALTER TABLE metering.brp
                    DROP COLUMN IF EXISTS created_at,
                    DROP COLUMN IF EXISTS expected_cadence,
                    DROP COLUMN IF EXISTS adapter_key,
                    DROP COLUMN IF EXISTS document_format,
                    DROP COLUMN IF EXISTS credential_ref,
                    DROP COLUMN IF EXISTS endpoint_uri;
                """);
```

- [ ] **Step 10: Build, then apply the migration to a real container and read the schema back**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
docker info > /dev/null
docker run --detach --name migration9-check \
  --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=peakpower \
  --publish 0:5432 postgres:17 > /dev/null
port="$(docker port migration9-check 5432/tcp | head -1 | sed 's/.*://')"
for _ in $(seq 1 60); do
  docker exec migration9-check pg_isready --username postgres --dbname peakpower > /dev/null 2>&1 && break
  sleep 1
done
ConnectionStrings__peakpower="Host=localhost;Port=$port;Database=peakpower;Username=postgres;Password=postgres" \
  dotnet run --project src/Hosts/PeakPower.Migrator --no-launch-profile > /tmp/m9-run1.log 2>&1
echo "exit=$?" >> /tmp/m9-run1.log
tail -5 /tmp/m9-run1.log
docker exec migration9-check psql --username postgres --dbname peakpower \
  --tuples-only --no-align --command \
  "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'metering' AND c.relname LIKE 'interval_reading_2%';" > /tmp/m9-partitions.txt 2>&1
docker exec migration9-check psql --username postgres --dbname peakpower \
  --tuples-only --no-align --command \
  "SELECT assigned_by || ':' || count(*) FROM customer.metering_point_brp_assignment
    GROUP BY assigned_by;" >> /tmp/m9-partitions.txt 2>&1
cat /tmp/m9-partitions.txt
```

Expected: `exit=0` in `/tmp/m9-run1.log`; `/tmp/m9-partitions.txt` reads `36` on its first line.
The second query returns **nothing** on an unseeded database — there are no metering points to
backfill, which is correct and is why Task 15 asserts the backfill against a seeded one instead.

⚠ If the migrator exits non-zero, read `/tmp/m9-run1.log` rather than re-running: the two failures
this migration can produce are `23505` (an `INSERT INTO metering.brp` crept in where the `UPDATE`
belongs) and `42P01` (a `DROP INDEX ux_account_subject` crept in). Both are named in Step 1.

Leave the container running — Step 11 uses it — then remove it:

```bash
docker rm -f migration9-check > /dev/null
```

- [ ] **Step 11: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence/Migrations
git commit -m "feat(persistence): migration 9 - ingestion, interval data and the partition routine

Contract section 6.1-6.7, hand-written raw SQL because CreateTable cannot emit
PARTITION BY RANGE or CREATE FUNCTION, and half a scaffolded migration beside half a
hand-written one leaves nobody able to say which half is authoritative. The partition seed
window is fixed at 2025-01..2027-12 and contains no now(), so the schema is deterministic
and the double-run idempotence check keeps meaning something. brp_assigned_at and
first_production_observed_at are ADD COLUMN, not ALTER: InitialSchema never created either
despite the published DDL showing both. The ExternalSubjectId drop is one statement -
ux_account_subject does not exist, and a DROP INDEX without IF EXISTS would fail the
migration. Policies and REVOKEs follow in the next commit, on this same migration.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Migration 9's row-level security — the policy pairs and the explicit `REVOKE`s

⚠ **The `REVOKE`s are the whole protection, and they are not tidiness.** Migration 2 ran

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA customer, metering, wallet, audit
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
    TO app_customer_role, app_employee_role;
```

at `20260827092246_TenancyRowLevelSecurity.cs:110-112`. **The instant Task 12's `CREATE TABLE` ran,
`app_customer_role` held full DML on every one of the seven new tables** — verified against a
throwaway `postgres:17`: a table created after that statement carries
`relacl = {postgres=arwdDxtm/postgres,app_customer_role=arwd/postgres}` with no further grant, and
so does a partition created with `CREATE TABLE … PARTITION OF`. **A policy decides which *rows* a
command may touch; it cannot forbid the command.** Without the revokes a customer-scoped connection
can `INSERT` interval data for any tenant it likes, because its own `WITH CHECK` arm passes for rows
it stamps with its own `customer_id`.

Two shapes, from contract §6.8:

- **The four customer-owned tables** — `interval_data_version`, `interval_reading` (parent; the
  partitions get theirs from Task 12's routine), `metering_point_day_state`, `daily_position` — get
  `ENABLE ROW LEVEL SECURITY`, both policies, and `REVOKE INSERT, UPDATE, DELETE`, leaving
  `SELECT`. Only the Worker and the back office write interval data, and neither connects as
  `app_customer_role`.
- **The four employee-only tables** — `inbound_message`, `quarantined_series`, `operational_alert`
  and `customer.metering_point_brp_assignment` — get `REVOKE ALL` from `app_customer_role`,
  `ENABLE ROW LEVEL SECURITY` and a **single** back-office policy. There is no tenant-isolation
  policy because there is no tenant: an unknown EAN belongs to nobody, and a staff alert belongs to
  the platform.

`FORCE ROW LEVEL SECURITY` is deliberately **not** set — the owner runs migrations, and no API host
connects as the owner. `NULLIF(current_setting('app.customer_id', true), '')` is not decoration:
`''::uuid` raises `22P02`, whereas `NULL` matches nothing, which is the fail-closed behaviour.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_IngestionAndIntervalData.cs` (append one `Sql` block to `Up()`, after Step 8's block)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs` (append the class `EmployeeOnlyTablePrivilegeTests` at the end of the file)

**Interfaces:**
- Consumes: migration 2's `app_customer_role` and `app_employee_role` (NOLOGIN group roles) and its
  two LOGIN roles `peakpower_app` / `peakpower_employee`, through `TenancyFixture`.
- Produces: eight policed tables. **Plan 3 and plan 5 must write through the owner connection** —
  the Worker is the owner and is exempt from row-level security by design (design §4.3) — and
  plan 6's employee endpoints through `peakpower_employee`. Neither may reach these tables as
  `peakpower_app`.

- [ ] **Step 1: Write the failing tests**

Append to the **end** of
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`,
after `CatalogPolicyCoverageTests`' closing brace:

```csharp

/// <summary>
/// The POSITIVE tests contract §6.8 asks for: a customer-scoped connection is REFUSED on the four
/// employee-only tables, and refused the three writing verbs on the four customer-owned ones.
/// <para>
/// ⚠ These assert a PRIVILEGE, not a policy, and the difference is the whole point. A policy
/// decides which rows a command may touch; it cannot forbid the command. Migration 2's
/// <c>ALTER DEFAULT PRIVILEGES IN SCHEMA customer, metering, wallet, audit</c> hands
/// <c>app_customer_role</c> SELECT/INSERT/UPDATE/DELETE on every table created afterwards, the
/// instant CREATE TABLE runs - so without migration 9's explicit REVOKEs a customer-scoped
/// connection could INSERT interval data, and its own WITH CHECK arm would happily pass rows it
/// stamped with its own customer_id.
/// </para>
/// <para>
/// Every assertion connects as <c>peakpower_app</c>, never as the owner: row-level security and
/// table privileges both leave the owner alone, so an owner connection passes these regardless of
/// whether a single REVOKE was written.
/// </para>
/// </summary>
[Collection(nameof(TenancyCollection))]
public sealed class EmployeeOnlyTablePrivilegeTests
{
    private readonly TenancyFixture _fixture;

    public EmployeeOnlyTablePrivilegeTests(TenancyFixture fixture) => _fixture = fixture;

    /// <summary>
    /// PostgreSQL's SQLSTATE for insufficient_privilege. Compared as a code rather than on the
    /// message text, because the message is localised and the code is not.
    /// </summary>
    private const string InsufficientPrivilege = "42501";

    [Theory]
    [InlineData("metering.inbound_message")]
    [InlineData("metering.quarantined_series")]
    [InlineData("metering.operational_alert")]
    [InlineData("customer.metering_point_brp_assignment")]
    public async Task the_customer_role_is_refused_outright_on_an_employee_only_table(string qualifiedTable)
    {
        var ct = TestContext.Current.CancellationToken;
        await using var connection = TenancyFixture.Connect(_fixture.CustomerRoleConnectionString);
        await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await using (var setting = new NpgsqlCommand(
            "SELECT set_config('app.customer_id', @value, true)", connection, transaction))
        {
            setting.Parameters.AddWithValue("value", _fixture.CompanyAId.ToString());
            await setting.ExecuteNonQueryAsync(ct);
        }

        await using var select = new NpgsqlCommand(
            $"SELECT count(*) FROM {qualifiedTable}", connection, transaction);

        var thrown = await Should.ThrowAsync<PostgresException>(
            async () => await select.ExecuteScalarAsync(ct));

        thrown.SqlState.ShouldBe(
            InsufficientPrivilege,
            $"{qualifiedTable} is employee-only: there is no customer to scope it to, so the " +
            "customer role must be refused the command rather than filtered to zero rows. " +
            "Zero rows and 42501 look identical from the application and are not the same " +
            "guarantee - the first is one forgotten REVOKE away from returning everything");
    }

    [Theory]
    [InlineData("metering.interval_data_version")]
    [InlineData("metering.interval_reading")]
    [InlineData("metering.metering_point_day_state")]
    [InlineData("metering.daily_position")]
    public async Task the_customer_role_may_read_a_customer_owned_table_but_never_write_one(
        string qualifiedTable)
    {
        var ct = TestContext.Current.CancellationToken;
        await using var connection = TenancyFixture.Connect(_fixture.CustomerRoleConnectionString);
        await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await using (var setting = new NpgsqlCommand(
            "SELECT set_config('app.customer_id', @value, true)", connection, transaction))
        {
            setting.Parameters.AddWithValue("value", _fixture.CompanyAId.ToString());
            await setting.ExecuteNonQueryAsync(ct);
        }

        // SELECT is granted, so this must not throw. Asserted before the DELETE so a blanket
        // REVOKE ALL on these four - which would also pass the DELETE assertion below - fails
        // here instead of passing this class entirely.
        await using (var select = new NpgsqlCommand(
            $"SELECT count(*) FROM {qualifiedTable}", connection, transaction))
        {
            await select.ExecuteScalarAsync(ct);
        }

        await using var delete = new NpgsqlCommand($"DELETE FROM {qualifiedTable}", connection, transaction);

        var thrown = await Should.ThrowAsync<PostgresException>(
            async () => await delete.ExecuteNonQueryAsync(ct));

        thrown.SqlState.ShouldBe(
            InsufficientPrivilege,
            $"{qualifiedTable} must be SELECT-only for app_customer_role. A tenant-isolation " +
            "policy would let this DELETE remove every row the policy DOES match - the customer's " +
            "own - which is exactly the command nothing on a customer connection has any reason " +
            "to issue. Only the Worker (the owner) and the back office write interval data");
    }

    [Fact]
    public async Task the_customer_role_cannot_insert_an_interval_reading_for_itself()
    {
        // The specific case the REVOKEs exist for, and the one a policy CANNOT close: the row
        // below carries the connection's OWN customer_id, so the tenant-isolation policy's
        // WITH CHECK arm passes it. Only the absence of the INSERT privilege refuses it.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = TenancyFixture.Connect(_fixture.CustomerRoleConnectionString);
        await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await using (var setting = new NpgsqlCommand(
            "SELECT set_config('app.customer_id', @value, true)", connection, transaction))
        {
            setting.Parameters.AddWithValue("value", _fixture.CompanyAId.ToString());
            await setting.ExecuteNonQueryAsync(ct);
        }

        await using var insert = new NpgsqlCommand(
            """
            INSERT INTO metering.interval_reading
                   (version_id, delivery_date, customer_id, pos, interval_start, quantity_kwh)
            VALUES (gen_random_uuid(), DATE '2026-08-12', @customerId, 1,
                    TIMESTAMPTZ '2026-08-12 00:00:00+02', 1.250)
            """,
            connection,
            transaction);
        insert.Parameters.AddWithValue("customerId", _fixture.CompanyAId);

        var thrown = await Should.ThrowAsync<PostgresException>(
            async () => await insert.ExecuteNonQueryAsync(ct));

        thrown.SqlState.ShouldBe(
            InsufficientPrivilege,
            "the row names the connection's own customer, so the tenant-isolation policy's " +
            "WITH CHECK arm passes it - only the revoked INSERT privilege refuses it. This is " +
            "the assertion that proves the REVOKEs are protection rather than tidiness");
    }

    [Theory]
    [InlineData("metering", "inbound_message")]
    [InlineData("metering", "quarantined_series")]
    [InlineData("metering", "operational_alert")]
    [InlineData("customer", "metering_point_brp_assignment")]
    public async Task an_employee_only_table_carries_row_level_security_and_exactly_one_policy(
        string schema, string table)
    {
        // One policy, not two, and the count matters in both directions. A tenant-isolation
        // policy here would be meaningless - there is no customer_id to compare - and "no policy
        // at all" would leave a future accidental GRANT reading everything.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = TenancyFixture.Connect(_fixture.OwnerConnectionString);
        await connection.OpenAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT c.relrowsecurity || ':' ||
                   coalesce((SELECT string_agg(policyname, '|' ORDER BY policyname)
                             FROM pg_policies WHERE schemaname = @schema AND tablename = @table), 'NONE')
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = @schema AND c.relname = @table
            """,
            connection);
        command.Parameters.AddWithValue("schema", schema);
        command.Parameters.AddWithValue("table", table);

        var actual = (string?)await command.ExecuteScalarAsync(ct);

        actual.ShouldBe(
            $"true:{schema}_{table}_back_office",
            $"{schema}.{table} must have row-level security enabled and carry exactly one " +
            "policy, the back-office one. coalesce(..., 'NONE') rather than an empty-string " +
            "comparison, because a psql-shaped empty result and a legitimately empty policy " +
            "list both print nothing and only one of those is a pass");
    }
}
```

⚠ `RowLevelSecurityTests.cs` already has `using Npgsql;`, `using Shouldly;`, `using Xunit;` and
`using System.Globalization;` at the top — read `:1-20` and add nothing that is already there.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~EmployeeOnlyTablePrivilegeTests"`

Expected: FAIL, every test, and the failures are the interesting ones:

- `the_customer_role_is_refused_outright_on_an_employee_only_table` fails on all four cases with
  `Should.ThrowAsync<PostgresException>() … but no exception was thrown` — **the customer role can
  already read every one of them**, because `ALTER DEFAULT PRIVILEGES` granted it `arwd` the instant
  `CREATE TABLE` ran in Task 12. This is the hole, demonstrated.
- `the_customer_role_cannot_insert_an_interval_reading_for_itself` fails the same way: the `INSERT`
  **succeeds**.
- `an_employee_only_table_carries_row_level_security_and_exactly_one_policy` fails with
  `actual should be "true:metering_inbound_message_back_office" but was "false:NONE"`.
  (PostgreSQL renders a boolean cast to text as lowercase `true`/`false`, which is why the
  expectation is spelled that way and not with C#'s `True`.)

⚠ Read that first failure twice before writing the fix. It is not "the test is not wired up yet" —
it is a customer-scoped login role reading every stored raw document in the system.

- [ ] **Step 3: Append the policy and `REVOKE` block to migration 9**

Append inside `Up()` of
`src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_IngestionAndIntervalData.cs`, after
Step 8's block and before the closing brace:

```csharp
            // ─────────────────────────────────────────────────────────────────────────────
            // 8. Row-level security. Contract §6.8; the policy shape is migration 2's, verbatim.
            //
            // ⚠ THE REVOKES ARE THE PROTECTION, not tidiness. Migration 2's
            // ALTER DEFAULT PRIVILEGES IN SCHEMA customer, metering, wallet, audit
            //   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_customer_role, app_employee_role
            // (20260827092246_TenancyRowLevelSecurity.cs:110-112) fires on CREATE TABLE, so every
            // table created above arrived with arwd for app_customer_role BEFORE this block runs.
            // A policy decides which ROWS a command may touch; it cannot forbid the command. Left
            // alone, a customer-scoped connection could INSERT interval data - and its own
            // WITH CHECK arm would pass, because the row names its own customer.
            //
            // NULLIF(current_setting('app.customer_id', true), '') is the fail-closed guard:
            // ''::uuid raises 22P02, while NULL simply matches nothing. FORCE ROW LEVEL SECURITY
            // is deliberately NOT set - the owner runs migrations, and no API host connects as
            // the owner.
            //
            // ⚠ interval_reading's PARENT is policed here; its PARTITIONS are policed by
            // metering.ensure_interval_reading_partition, because neither ENABLE ROW LEVEL
            // SECURITY nor a GRANT on a partitioned parent reaches its partitions. Both, not
            // either: the parent's policy is what AutomaticPolicyCoverageTests and
            // CatalogPolicyCoverageTests see, and the partitions' are what a direct
            // SELECT ... FROM metering.interval_reading_2026_08 runs into.
            // ─────────────────────────────────────────────────────────────────────────────
            migrationBuilder.Sql(
                """
                -- The four customer-owned tables: two policies, and SELECT only.
                ALTER TABLE metering.interval_data_version ENABLE ROW LEVEL SECURITY;
                CREATE POLICY metering_interval_data_version_tenant_isolation ON metering.interval_data_version
                    FOR ALL TO app_customer_role
                    USING      (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
                    WITH CHECK (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid);
                CREATE POLICY metering_interval_data_version_back_office ON metering.interval_data_version
                    FOR ALL TO app_employee_role USING (true) WITH CHECK (true);
                REVOKE INSERT, UPDATE, DELETE ON metering.interval_data_version FROM app_customer_role;

                ALTER TABLE metering.interval_reading ENABLE ROW LEVEL SECURITY;
                CREATE POLICY metering_interval_reading_tenant_isolation ON metering.interval_reading
                    FOR ALL TO app_customer_role
                    USING      (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
                    WITH CHECK (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid);
                CREATE POLICY metering_interval_reading_back_office ON metering.interval_reading
                    FOR ALL TO app_employee_role USING (true) WITH CHECK (true);
                REVOKE INSERT, UPDATE, DELETE ON metering.interval_reading FROM app_customer_role;

                ALTER TABLE metering.metering_point_day_state ENABLE ROW LEVEL SECURITY;
                CREATE POLICY metering_metering_point_day_state_tenant_isolation ON metering.metering_point_day_state
                    FOR ALL TO app_customer_role
                    USING      (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
                    WITH CHECK (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid);
                CREATE POLICY metering_metering_point_day_state_back_office ON metering.metering_point_day_state
                    FOR ALL TO app_employee_role USING (true) WITH CHECK (true);
                REVOKE INSERT, UPDATE, DELETE ON metering.metering_point_day_state FROM app_customer_role;

                ALTER TABLE metering.daily_position ENABLE ROW LEVEL SECURITY;
                CREATE POLICY metering_daily_position_tenant_isolation ON metering.daily_position
                    FOR ALL TO app_customer_role
                    USING      (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
                    WITH CHECK (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid);
                CREATE POLICY metering_daily_position_back_office ON metering.daily_position
                    FOR ALL TO app_employee_role USING (true) WITH CHECK (true);
                REVOKE INSERT, UPDATE, DELETE ON metering.daily_position FROM app_customer_role;

                -- The four employee-only tables: nothing at all for the customer role, one policy.
                REVOKE ALL ON metering.inbound_message               FROM app_customer_role;
                REVOKE ALL ON metering.quarantined_series            FROM app_customer_role;
                REVOKE ALL ON metering.operational_alert             FROM app_customer_role;
                REVOKE ALL ON customer.metering_point_brp_assignment FROM app_customer_role;

                ALTER TABLE metering.inbound_message ENABLE ROW LEVEL SECURITY;
                CREATE POLICY metering_inbound_message_back_office ON metering.inbound_message
                    FOR ALL TO app_employee_role USING (true) WITH CHECK (true);

                ALTER TABLE metering.quarantined_series ENABLE ROW LEVEL SECURITY;
                CREATE POLICY metering_quarantined_series_back_office ON metering.quarantined_series
                    FOR ALL TO app_employee_role USING (true) WITH CHECK (true);

                ALTER TABLE metering.operational_alert ENABLE ROW LEVEL SECURITY;
                CREATE POLICY metering_operational_alert_back_office ON metering.operational_alert
                    FOR ALL TO app_employee_role USING (true) WITH CHECK (true);

                ALTER TABLE customer.metering_point_brp_assignment ENABLE ROW LEVEL SECURITY;
                CREATE POLICY customer_metering_point_brp_assignment_back_office
                    ON customer.metering_point_brp_assignment
                    FOR ALL TO app_employee_role USING (true) WITH CHECK (true);
                """);
```

⚠ The policy names follow migration 2's convention `{schema}_{table}_{tenant_isolation|back_office}`
exactly, because `an_employee_only_table_carries_row_level_security_and_exactly_one_policy` and
Task 16's `PartitionPolicyCoverageTests` both compute the expected name from schema and table rather
than listing it. The longest here,
`customer_metering_point_brp_assignment_back_office`, is 49 characters — inside PostgreSQL's 63-byte
identifier limit.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~EmployeeOnlyTablePrivilegeTests"
```

Expected: build clean; PASS, all ten cases.

⚠ **Do not run the whole integration suite yet.** Task 14's three ordered-list literals and Task 16's
four coverage literals are still at their pre-migration-9 values, so `MigrationScriptTests`,
`MigrationBehaviourTests` and both coverage guards are red by design until those tasks land.

- [ ] **Step 5: Mutate the `REVOKE ALL`, and then the `REVOKE INSERT, UPDATE, DELETE`**

Delete one line from the migration — `REVOKE ALL ON metering.inbound_message FROM
app_customer_role;` — and re-migrate a fresh container (the migration has already been applied to
any database you have used, so the change only takes effect on a new one):

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~the_customer_role_is_refused_outright_on_an_employee_only_table"
```

Expected: FAIL — the `metering.inbound_message` case only, with
`Should.ThrowAsync<PostgresException>() … but no exception was thrown`, followed by
`metering.inbound_message is employee-only: there is no customer to scope it to…`. The other three
cases still pass, which is what tells you the mutation was narrow.

⚠ The table still has row-level security enabled and a back-office policy at this point. **That
changes nothing** — the customer role matches no policy, so it reads zero rows rather than being
refused, and zero rows is indistinguishable from "there were none" at the call site. The test asserts
`42501` rather than a row count precisely because of this.

Restore that line. Now mutate the other shape: change
`REVOKE INSERT, UPDATE, DELETE ON metering.interval_reading FROM app_customer_role;` to
`REVOKE ALL ON metering.interval_reading FROM app_customer_role;` — the over-correction somebody
makes when copying the employee-only block.

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~the_customer_role_may_read_a_customer_owned_table_but_never_write_one"`
Expected: FAIL — the `metering.interval_reading` case, on the `SELECT`, with
`Npgsql.PostgresException : 42501: permission denied for table interval_reading` thrown from the
arrange block rather than from the `DELETE`. The customer portal cannot read its own consumption.

That is why the `SELECT` is asserted **before** the `DELETE` in that test: a blanket `REVOKE ALL`
satisfies the `DELETE` half perfectly and would pass a test that only checked the refusal. Restore
`REVOKE INSERT, UPDATE, DELETE` and re-run the whole class.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence/Migrations \
        tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs
git commit -m "feat(persistence): migration 9's policy pairs and the explicit REVOKEs

Migration 2's ALTER DEFAULT PRIVILEGES hands app_customer_role full DML on every table the
instant CREATE TABLE runs, so the REVOKEs are the protection and not tidiness - a policy
decides which rows a command may touch, never whether the command is allowed. The four
customer-owned tables keep SELECT and both policies; the four employee-only ones are
revoked outright and carry one back-office policy each. Verified by mutation in both
directions: dropping a REVOKE ALL lets the customer role read every stored raw document,
and over-revoking interval_reading takes the customer portal's own consumption away.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 14: The ordered migration list — three places, one commit

Three files pin the ordered list of migrations, and the front matter says all three grow by one
entry **in the same commit**. That is not a style preference: they are three independent statements
of the same fact — the generated script, the applied history, and a real container's
`__EFMigrationsHistory` — and a commit that moves two of them leaves the third as a failing test
nobody can attribute.

⚠ **Ordered, never counted.** `applied.Length.ShouldBe(9)` alone passes just as happily if a
migration is renamed, reordered, dropped or squashed and replaced by an unrelated one. Each list
asserts membership **and** position, which is why every one of them grows by a line rather than by a
number.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh:51` and `:52-56`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs:32` (the method name), `:39`, `:41-48`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs:33-40` and `:34`

**Interfaces:**
- Consumes: Task 12's migration id, `<timestamp>_IngestionAndIntervalData`.
- Produces: nothing other code reads. Task 20 appends the migration-9 privilege and partition
  assertions to the same shell script, in a **later** commit, because those are a different claim.

- [ ] **Step 1: Run the three and watch them fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MigrationScriptTests"
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MigrationBehaviourTests"
```

Expected: FAIL, one test in each.

`The_migrations_are_InitialSchema_then_…_then_EmployeeSessions_in_that_order`:
`migrationIds.Length should be 8 but was 9`.

`All_migrations_apply_cleanly_to_an_empty_PostgreSQL_17_container_in_order`:
`applied.Length should be 8 but was 9`.

⚠ Both fail on the **count** line before ever reaching the per-position assertions, which is exactly
what a count-first list is for: the reader is told how many arrived, not merely that position 8 was
wrong.

- [ ] **Step 2: Move `MigrationScriptTests`**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs`,
rename the method at line `32` — before:

```csharp
    public void The_migrations_are_InitialSchema_then_TenancyRowLevelSecurity_then_AuthAndOnboarding_then_AccountTokenForeignKeys_then_EanPool_then_OnboardingTradeName_then_EmployeeIdentity_then_EmployeeSessions_in_that_order()
```

after:

```csharp
    public void The_migrations_are_InitialSchema_then_TenancyRowLevelSecurity_then_AuthAndOnboarding_then_AccountTokenForeignKeys_then_EanPool_then_OnboardingTradeName_then_EmployeeIdentity_then_EmployeeSessions_then_IngestionAndIntervalData_in_that_order()
```

and move the literal at `:39` and add the ninth position after `:48`:

```csharp
        migrationIds.Length.ShouldBe(9);
```

```csharp
        migrationIds[7].ShouldEndWith("_EmployeeSessions");
        migrationIds[8].ShouldEndWith("_IngestionAndIntervalData");
```

- [ ] **Step 3: Move `MigrationBehaviourTests`**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs`,
move the literal at `:34` and add the ninth position after `:40`:

```csharp
        applied.Length.ShouldBe(9);
```

```csharp
        applied[7].ShouldEndWith("_EmployeeSessions");
        applied[8].ShouldEndWith("_IngestionAndIntervalData");
```

- [ ] **Step 4: Move `tools/verify-migrator.sh`**

Replace line `51` — before:

```bash
  *_InitialSchema\|*_TenancyRowLevelSecurity\|*_AuthAndOnboarding\|*_AccountTokenForeignKeys\|*_EanPool\|*_OnboardingTradeName\|*_EmployeeIdentity\|*_EmployeeSessions\|) ;;
```

after:

```bash
  *_InitialSchema\|*_TenancyRowLevelSecurity\|*_AuthAndOnboarding\|*_AccountTokenForeignKeys\|*_EanPool\|*_OnboardingTradeName\|*_EmployeeIdentity\|*_EmployeeSessions\|*_IngestionAndIntervalData\|) ;;
```

and replace lines `52-56` — before:

```bash
  *) fail "expected __EFMigrationsHistory to contain, in order, a migration ending _InitialSchema " \
       "then one ending _TenancyRowLevelSecurity then one ending _AuthAndOnboarding then one " \
       "ending _AccountTokenForeignKeys then one ending _EanPool then one ending " \
       "_OnboardingTradeName then one ending _EmployeeIdentity then one ending _EmployeeSessions " \
       "- found: $history_ids" ;;
```

after:

```bash
  *) fail "expected __EFMigrationsHistory to contain, in order, a migration ending _InitialSchema " \
       "then one ending _TenancyRowLevelSecurity then one ending _AuthAndOnboarding then one " \
       "ending _AccountTokenForeignKeys then one ending _EanPool then one ending " \
       "_OnboardingTradeName then one ending _EmployeeIdentity then one ending _EmployeeSessions " \
       "then one ending _IngestionAndIntervalData - found: $history_ids" ;;
```

⚠ The `case` pattern's `\|` are **escaped pipes matching the literal `|` separators**
`history_ids_normalised` was built with by `tr '\n' '|'` — they are not alternation. Adding an entry
means adding `*_IngestionAndIntervalData\|` **before** the final `\|)`, keeping the trailing
separator that anchors the end of the list. Dropping that trailing `\|` would make the pattern match
a history with extra migrations after the ninth.

- [ ] **Step 5: Append the migration-9 script assertions**

`MigrationScriptTests` reads the **generated script** and needs no container, which makes it the
cheapest place to assert that a statement is present or absent in the migration *text*. Append these
inside the class, before its closing brace:

```csharp

    /// <summary>
    /// Migration 9's three shapes that no scaffolded migration could have produced, asserted on
    /// the generated script because it runs in milliseconds without a container — and because two
    /// of them are the kind of thing a later edit removes without noticing.
    /// </summary>
    [Fact]
    public void Migration_9_partitions_the_reading_table_and_ships_the_routine_that_policies_a_partition()
    {
        _script.ShouldContain("PARTITION BY RANGE (delivery_date)", Case.Sensitive);
        _script.ShouldContain(
            "CREATE OR REPLACE FUNCTION metering.ensure_interval_reading_partition", Case.Sensitive);

        // The fixed window, in the text. A seed loop that read now() would still produce 36
        // partitions on any given day - see PartitionPolicyCoverageTests for the catalog half -
        // but the literal is what makes two databases created a month apart identical.
        _script.ShouldContain("DATE '2025-01-01'", Case.Sensitive);
        _script.ShouldContain("DATE '2028-01-01'", Case.Sensitive);
    }

    /// <summary>
    /// The REVOKEs, in the script. They are the whole protection on the four employee-only tables
    /// — migration 2's ALTER DEFAULT PRIVILEGES hands app_customer_role full DML the instant
    /// CREATE TABLE runs — and an omitted REVOKE leaves no trace anywhere: nothing fails, the
    /// table simply becomes readable and writable by every tenant.
    /// </summary>
    [Theory]
    [InlineData("REVOKE ALL ON metering.inbound_message")]
    [InlineData("REVOKE ALL ON metering.quarantined_series")]
    [InlineData("REVOKE ALL ON metering.operational_alert")]
    [InlineData("REVOKE ALL ON customer.metering_point_brp_assignment")]
    [InlineData("REVOKE INSERT, UPDATE, DELETE ON metering.interval_data_version")]
    [InlineData("REVOKE INSERT, UPDATE, DELETE ON metering.interval_reading")]
    [InlineData("REVOKE INSERT, UPDATE, DELETE ON metering.metering_point_day_state")]
    [InlineData("REVOKE INSERT, UPDATE, DELETE ON metering.daily_position")]
    public void Migration_9_revokes_what_ALTER_DEFAULT_PRIVILEGES_granted_automatically(string statement)
    {
        _script.ShouldContain(statement, Case.Sensitive);
    }

    /// <summary>
    /// Two absences, and both would fail the migration outright against a real database — which
    /// is exactly why they are worth asserting here, where no database is involved. A developer
    /// working from the published DDL writes either one without hesitation, and the feedback
    /// arrives in milliseconds rather than after a container start.
    /// </summary>
    [Fact]
    public void Migration_9_neither_inserts_a_second_BRP_row_nor_drops_an_index_that_never_existed()
    {
        // Migration 1 already seeds PVNED and ix_brp_code is UNIQUE on code: an INSERT here is
        // Postgres 23505 on the very first run.
        _script.ShouldNotContain("INSERT INTO metering.brp", Case.Sensitive);
        _script.ShouldContain("UPDATE metering.brp", Case.Sensitive);

        // InitialSchema never created ux_account_subject, whatever the published DDL shows, so a
        // DROP INDEX without IF EXISTS fails with 42P01 against every existing database.
        _script.ShouldNotContain("ux_account_subject", Case.Sensitive);
        _script.ShouldContain(
            "ALTER TABLE customer.customer_account DROP COLUMN external_subject_id", Case.Sensitive);
    }
```

⚠ `Case.Sensitive` on every one of these is not decoration. **Shouldly's `ShouldContain` is
case-insensitive by default** and has silently broken three tests in this repository; a SQL keyword
comparison that ignores case would pass on `revoke all on metering.inbound_message`, which is valid
SQL nobody in this file writes.

- [ ] **Step 6: Run all three and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MigrationScriptTests"
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~MigrationBehaviourTests"
tools/verify-migrator.sh
```

Expected: both test classes PASS; `verify-migrator.sh` prints `verify-migrator: OK`.

⚠ `verify-migrator.sh` starts its own `postgres:17`, runs the real Migrator **five times** and takes
several minutes. If it fails on anything other than the history list at this point, the failure
belongs to Task 12 or 13 — read the message before changing this script.

- [ ] **Step 7: Mutate the ordering claim, in the place a bare count would not catch**

Swap the last two positions in `MigrationBehaviourTests` — the mistake somebody makes when adding an
entry to a list they did not read:

```csharp
        // MUTATION
        applied[7].ShouldEndWith("_IngestionAndIntervalData");
        applied[8].ShouldEndWith("_EmployeeSessions");
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~All_migrations_apply_cleanly"`
Expected: FAIL —
`applied[7] should end with "_IngestionAndIntervalData" but was "20260905081526_EmployeeSessions"`.

⚠ Note what stayed green under that mutation: `applied.Length.ShouldBe(9)`. A count-only assertion
would have passed a history in the wrong order, which is precisely the failure mode a squash or a
rebase produces. Restore, and re-run.

Then mutate the script assertions' one absence: add
`migrationBuilder.Sql("DROP INDEX customer.ux_account_subject;");` to migration 9's `Up()` — the
statement a developer writes straight from the published DDL.

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~Migration_9_neither_inserts_a_second_BRP_row"`
Expected: FAIL — `_script should not contain "ux_account_subject" but was "…DROP INDEX customer.ux_account_subject;…"`.

⚠ That mutation would also fail every container-based test in the repository, with
`42P01: index "ux_account_subject" does not exist` — which is the point of catching it here, in
milliseconds, before a container start. Restore.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tools/verify-migrator.sh \
        tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs \
        tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs
git commit -m "test: add migration 9 to all three ordered migration lists, in one commit

The generated script, the applied history and a real container's __EFMigrationsHistory are
three independent statements of the same fact, so they move together or one of them is a
failing test nobody can attribute. Each grows by a LINE rather than by a number: a bare
count passes a renamed, reordered or squashed migration just as happily, which the ordering
mutation here demonstrates. The script assertions added alongside cover what only the
migration TEXT can say - PARTITION BY RANGE, the fixed seed window, every REVOKE, and the
two statements that must not be there.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: `IngestionSchemaTests` — what migration 9 actually did to a database

Model tests assert what EF was told. This asserts what PostgreSQL did, against a real container,
because migration 9 is hand-written SQL and the model is a second, independent statement of the same
schema. Everything here is a fact that only the database can answer: partition routing, a partial
unique index actually refusing a row, a `CHECK` actually rejecting one, the `UPDATE`-not-`INSERT` on
the seeded BRP row, and the backfilled assignment history.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/IngestionSchemaTests.cs`

**Interfaces:**
- Consumes: `PostgresFixture` (a `postgres:17` container with every migration applied) and
  `MeteringPointBrpAssignment.MigrationActor`.
- Produces: nothing other code reads.

- [ ] **Step 1: Write the failing tests**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/IngestionSchemaTests.cs`:

```csharp
using System.Globalization;
using Shouldly;
using Xunit;
using Npgsql;
using PeakPower.Domain.Customers;
using PeakPower.Integration.Tests.Database;

namespace PeakPower.Integration.Tests.Migrations;

/// <summary>
/// What migration 9 did to a real PostgreSQL 17 database, as opposed to what EF was told.
/// <para>
/// Migration 9 is hand-written raw SQL — <c>CreateTable</c> cannot emit <c>PARTITION BY RANGE</c> —
/// so the EF model and the DDL are two independent statements of one schema. <c>IngestionModelShapeTests</c>
/// pins the model half and <c>IngestionRoundTripTests</c> proves the two agree; this file pins the
/// half that only a database can answer: which partition a row lands in, whether a partial unique
/// index actually refuses the second row, and whether a CHECK actually rejects the state it names.
/// </para>
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class IngestionSchemaTests(PostgresFixture fixture)
{
    private static readonly Guid PvnedBrpId = Guid.Parse("0199a1a0-0000-7000-8000-0000000000b1");

    private async Task<T> ScalarAsync<T>(string sql, params (string Name, object Value)[] parameters)
    {
        var ct = TestContext.Current.CancellationToken;
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync(ct);
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        var result = await command.ExecuteScalarAsync(ct);
        return (T)Convert.ChangeType(result!, typeof(T), CultureInfo.InvariantCulture);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────
    // metering.brp — UPDATEd, never INSERTed.
    // ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Migration 1 seeds the PVNED row and <c>ix_brp_code</c> is UNIQUE on <c>code</c>, so an
    /// INSERT here raises 23505 on the very first run. Asserting the COUNT as well as the values
    /// is what catches the other half of that mistake: an INSERT guarded by
    /// <c>ON CONFLICT DO NOTHING</c> would leave the row uncorrected and every value below null
    /// or blank, with no error anywhere.
    /// </summary>
    [Fact]
    public async Task Migration_9_updated_the_seeded_PVNed_row_rather_than_inserting_a_second_one()
    {
        // Scoped to code = 'PVNED' rather than to the whole table: this fixture's container is
        // shared by every class in the postgres collection, and a later class adding a second BRP
        // must not turn this into a flake. Nothing is lost - ix_brp_code is UNIQUE on code, so a
        // second PVNED row is impossible and a plain INSERT would have failed migration 9 with
        // 23505. What this catches is the other mistake: an INSERT guarded by
        // ON CONFLICT DO NOTHING, which leaves the row uncorrected and every value below blank,
        // silently.
        (await ScalarAsync<int>("SELECT count(*) FROM metering.brp WHERE code = 'PVNED';")).ShouldBe(1);

        var row = await ScalarAsync<string>(
            """
            SELECT id::text || '|' || code || '|' || endpoint_uri || '|' || credential_ref
                   || '|' || document_format || '|' || adapter_key || '|' || expected_cadence
            FROM metering.brp WHERE code = 'PVNED';
            """);

        row.ShouldBe(
            "0199a1a0-0000-7000-8000-0000000000b1|PVNED|/webhooks/brp/PVNED|BRP_CREDENTIAL_PVNED"
            + "|PVNED_TIMESERIES_XML|PVNED_TIMESERIES_XML_V2P0|DAILY_PER_EAN",
            "the id is migration 1's own seeded row - a different one means migration 9 inserted "
            + "rather than updated, and the [DEC-69] seam now has two rows to choose between");
    }

    /// <summary>
    /// ⚠ <c>credential_ref</c> holds the NAME of an environment variable, never a secret (§9.3).
    /// The published DDL's comment calls it a "Key Vault secret name"; there is no key vault
    /// ([OQ-102]) and an environment-variable name is the same shape of indirection. This asserts
    /// the convention on the one row that exists, so a future BRP added with a literal credential
    /// in this column fails a test rather than shipping.
    /// </summary>
    [Fact]
    public async Task The_seeded_credential_reference_is_an_environment_variable_name_and_not_a_secret()
    {
        var credentialRef = await ScalarAsync<string>(
            "SELECT credential_ref FROM metering.brp WHERE code = 'PVNED';");

        credentialRef.StartsWith("BRP_CREDENTIAL_", StringComparison.Ordinal).ShouldBeTrue(
            $"credential_ref must name an environment variable, not hold one's value - found '{credentialRef}'");
    }

    [Fact]
    public async Task The_three_configuration_columns_lost_their_defaults_so_a_new_BRP_cannot_route_nowhere()
    {
        // The DEFAULT '' existed only so the ADD COLUMN could be NOT NULL against existing rows.
        // Left in place it would let an INSERT that forgets endpoint_uri succeed and create a BRP
        // that resolves to nothing - the not-blank CHECK is what refuses it, and the CHECK is
        // only reachable once the default is gone.
        var defaults = await ScalarAsync<string>(
            """
            SELECT coalesce(string_agg(column_name || '=' || coalesce(column_default, 'NONE'),
                                       '|' ORDER BY column_name), 'NOTHING')
            FROM information_schema.columns
            WHERE table_schema = 'metering' AND table_name = 'brp'
              AND column_name IN ('endpoint_uri', 'credential_ref', 'adapter_key');
            """);

        defaults.ShouldBe("adapter_key=NONE|credential_ref=NONE|endpoint_uri=NONE");
    }

    [Fact]
    public async Task A_BRP_with_a_blank_credential_reference_is_refused_by_the_database()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await using var insert = new NpgsqlCommand(
            """
            INSERT INTO metering.brp (id, code, name, is_active, endpoint_uri, credential_ref,
                                      document_format, adapter_key, expected_cadence)
            VALUES (gen_random_uuid(), 'BLANK', 'Blank B.V.', true, '/webhooks/brp/BLANK', '   ',
                    'PVNED_TIMESERIES_XML', 'PVNED_TIMESERIES_XML_V2P0', 'DAILY_PER_EAN')
            """,
            connection,
            transaction);

        var thrown = await Should.ThrowAsync<PostgresException>(
            async () => await insert.ExecuteNonQueryAsync(ct));

        thrown.SqlState.ShouldBe("23514");
        thrown.ConstraintName.ShouldBe("ck_brp_credential_ref_not_blank");
    }

    // ─────────────────────────────────────────────────────────────────────────────────────
    // customer.metering_point — the four columns, the check, and the assignment history.
    // ─────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("brp_assigned_at", "timestamp with time zone", "NO")]
    [InlineData("first_production_observed_at", "timestamp with time zone", "YES")]
    [InlineData("production_expectation_set_by", "text", "YES")]
    [InlineData("production_expectation_set_at", "timestamp with time zone", "YES")]
    public async Task The_four_new_metering_point_columns_landed_with_their_published_nullability(
        string column, string dataType, string isNullable)
    {
        // ⚠ NEITHER brp_assigned_at NOR first_production_observed_at existed before migration 9.
        // The published DDL shows both; 20260827051436_InitialSchema.cs creates neither. If this
        // assertion is ever reached by an ALTER COLUMN rather than an ADD COLUMN, the premise of
        // Task 12 has changed and the migration needs re-reading.
        var actual = await ScalarAsync<string>(
            """
            SELECT coalesce(data_type || ':' || is_nullable, 'MISSING')
            FROM information_schema.columns
            WHERE table_schema = 'customer' AND table_name = 'metering_point' AND column_name = @column;
            """,
            ("column", column));

        actual.ShouldBe($"{dataType}:{isNullable}");
    }

    [Fact]
    public async Task The_dead_external_subject_column_is_gone_from_the_database()
    {
        // ⚠ One DROP COLUMN, not two: InitialSchema never created the published DDL's
        // ux_account_subject index, so a DROP INDEX without IF EXISTS would have failed the whole
        // migration. Both halves are asserted - the column is gone AND the index never existed -
        // because a migration that dropped an index it had itself created would pass the first.
        (await ScalarAsync<int>(
            """
            SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'customer' AND table_name = 'customer_account'
              AND column_name = 'external_subject_id';
            """)).ShouldBe(0);

        (await ScalarAsync<int>(
            "SELECT count(*) FROM pg_indexes WHERE schemaname = 'customer' AND indexname = 'ux_account_subject';"))
            .ShouldBe(0, "ux_account_subject never existed - see 20260827051436_InitialSchema.cs");
    }

    [Fact]
    public async Task The_completeness_index_covers_only_the_expectations_that_can_be_faults()
    {
        // [DEC-65], [F02-R22], [F02-R26]. A NEVER point's missing production series is a DECLARED
        // zero and belongs nowhere near the completeness job's driving set.
        var definition = await ScalarAsync<string>(
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'customer' AND indexname = 'ix_mp_production_expected';");

        definition.ShouldContain("WHERE ((production_expectation)", Case.Sensitive);
        definition.ShouldContain("'EXPECTED'", Case.Sensitive);
        definition.ShouldContain("'UNKNOWN'", Case.Sensitive);
        definition.Contains("'NEVER'", StringComparison.Ordinal).ShouldBeFalse(
            "a NEVER point is a declared zero, not an incomplete day");
    }

    /// <summary>
    /// The backfill, asserted against a database that actually has metering points in it —
    /// <see cref="PostgresFixture"/> applies every migration to an EMPTY database, so this test
    /// inserts a point and then runs the same statement migration 9 ran, which is the only honest
    /// way to check a backfill whose input set was empty when it executed.
    /// <para>
    /// ⚠ The actor is compared against <see cref="MeteringPointBrpAssignment.MigrationActor"/>
    /// rather than against a literal, so a rename of one without the other goes red instead of
    /// silently splitting the history into rows nothing can group.
    /// </para>
    /// </summary>
    [Fact]
    public async Task The_backfill_writes_one_assignment_row_per_metering_point_naming_the_migration_actor()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await using (var arrange = new NpgsqlCommand(
            """
            INSERT INTO customer.customer (id, legal_name, kvk_number, status, locale,
                                           billing_address, primary_contact)
            VALUES (gen_random_uuid(), 'Backfill Probe B.V.', '81000099', 'ACTIVE', 'nl-NL',
                    '{}'::jsonb, '{}'::jsonb)
            RETURNING id
            """,
            connection,
            transaction))
        {
            var customerId = (Guid)(await arrange.ExecuteScalarAsync(ct))!;

            await using var point = new NpgsqlCommand(
                """
                INSERT INTO customer.metering_point
                       (id, customer_id, ean, commodity, brp_id, production_expectation, valid_from)
                VALUES (gen_random_uuid(), @customerId, '871687119900000099', 'ELECTRICITY',
                        @brpId, 'UNKNOWN', DATE '2026-01-01')
                """,
                connection,
                transaction);
            point.Parameters.AddWithValue("customerId", customerId);
            point.Parameters.AddWithValue("brpId", PvnedBrpId);
            await point.ExecuteNonQueryAsync(ct);
        }

        // ⚠ Scoped to this probe's own EAN, not to the whole table. Migration 9's real statement
        // has no WHERE clause - on a fresh database there is nothing to exclude - but this
        // fixture's container is shared by every class in the postgres collection, and
        // IngestionRoundTripTests commits metering points of its own. An unscoped backfill here
        // would return a row count that depends on which class ran first.
        await using (var backfill = new NpgsqlCommand(
            """
            INSERT INTO customer.metering_point_brp_assignment
                   (metering_point_id, from_brp_id, to_brp_id, assigned_at, assigned_by, reason)
            SELECT id, NULL, brp_id, brp_assigned_at, @actor,
                   'Initial assignment, backfilled when the assignment history was introduced.'
              FROM customer.metering_point
             WHERE ean = '871687119900000099'
            """,
            connection,
            transaction))
        {
            backfill.Parameters.AddWithValue("actor", MeteringPointBrpAssignment.MigrationActor);
            (await backfill.ExecuteNonQueryAsync(ct)).ShouldBe(1);
        }

        await using var check = new NpgsqlCommand(
            """
            SELECT (a.from_brp_id IS NULL)::text || '|' || a.to_brp_id::text || '|' || a.assigned_by
                   || '|' || (a.assigned_at = p.brp_assigned_at)::text
            FROM customer.metering_point_brp_assignment a
            JOIN customer.metering_point p ON p.id = a.metering_point_id
            WHERE p.ean = '871687119900000099'
            """,
            connection,
            transaction);

        var row = (string?)await check.ExecuteScalarAsync(ct);

        row.ShouldBe(
            $"true|{PvnedBrpId}|{MeteringPointBrpAssignment.MigrationActor}|true",
            "the first assignment has no previous party, names the point's current BRP, carries "
            + "the migration actor, and starts at exactly the moment brp_assigned_at records - "
            + "an assignment history that disagrees with the column it was derived from cannot "
            + "answer [F02-R43]'s 'which BRP was this point on at time T'");

        await transaction.RollbackAsync(ct);
    }

    [Fact]
    public async Task A_NEVER_point_carrying_an_observed_production_stamp_is_refused_by_the_database()
    {
        // ck_mp_never_has_no_observed_production. This is the constraint that forces [F02-R34]'s
        // promotion into the SAME TRANSACTION as the readings: a processor that stamped
        // first_production_observed_at and left production_expectation at NEVER would be refused
        // here, so the halfway state cannot be committed and then "fixed later".
        var ct = TestContext.Current.CancellationToken;
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await using var arrange = new NpgsqlCommand(
            """
            INSERT INTO customer.customer (id, legal_name, kvk_number, status, locale,
                                           billing_address, primary_contact)
            VALUES (gen_random_uuid(), 'Never Probe B.V.', '81000098', 'ACTIVE', 'nl-NL',
                    '{}'::jsonb, '{}'::jsonb)
            RETURNING id
            """,
            connection,
            transaction);
        var customerId = (Guid)(await arrange.ExecuteScalarAsync(ct))!;

        await using var insert = new NpgsqlCommand(
            """
            INSERT INTO customer.metering_point
                   (id, customer_id, ean, commodity, brp_id, production_expectation, valid_from,
                    first_production_observed_at)
            VALUES (gen_random_uuid(), @customerId, '871687119900000098', 'ELECTRICITY', @brpId,
                    'NEVER', DATE '2026-01-01', TIMESTAMPTZ '2026-08-13 04:02:12+00')
            """,
            connection,
            transaction);
        insert.Parameters.AddWithValue("customerId", customerId);
        insert.Parameters.AddWithValue("brpId", PvnedBrpId);

        var thrown = await Should.ThrowAsync<PostgresException>(
            async () => await insert.ExecuteNonQueryAsync(ct));

        thrown.SqlState.ShouldBe("23514");
        thrown.ConstraintName.ShouldBe("ck_mp_never_has_no_observed_production");

        await transaction.RollbackAsync(ct);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────
    // metering.interval_data_version — [DEC-143]'s two checks, and ux_idv_current.
    // ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_BRP_FEED_version_with_no_message_is_refused()
    {
        // The executable form of [DEC-143]. The published DDL made this unnecessary by declaring
        // inbound_message_id NOT NULL - and made [F02-R36]'s manual version unstorable in the
        // process. Nullable plus a CHECK keeps both halves: a fed version is the document it came
        // from, and a manual one has no document at all.
        var thrown = await InsertVersionAndCatchAsync(
            source: "BRP_FEED", withMessage: false, withDocument: false);

        thrown.SqlState.ShouldBe("23514");
        thrown.ConstraintName.ShouldBe("ck_idv_brp_feed_has_message");
    }

    [Fact]
    public async Task A_MANUAL_version_carrying_a_message_is_refused()
    {
        var thrown = await InsertVersionAndCatchAsync(
            source: "MANUAL", withMessage: true, withDocument: true);

        thrown.SqlState.ShouldBe("23514");
        thrown.ConstraintName.ShouldBe("ck_idv_manual_has_no_message");
    }

    /// <summary>
    /// Arranges a customer, a metering point and an inbound message inside a transaction that is
    /// always rolled back, inserts one <c>interval_data_version</c> in the requested shape, and
    /// returns the exception it raised. Shared by the two CHECK tests above so the arrange half —
    /// which is long and identical — is written once.
    /// </summary>
    private async Task<PostgresException> InsertVersionAndCatchAsync(
        string source, bool withMessage, bool withDocument)
    {
        var ct = TestContext.Current.CancellationToken;
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await using var arrange = new NpgsqlCommand(
            """
            WITH c AS (
                INSERT INTO customer.customer (id, legal_name, kvk_number, status, locale,
                                               billing_address, primary_contact)
                VALUES (gen_random_uuid(), 'Version Probe B.V.', '81000097', 'ACTIVE', 'nl-NL',
                        '{}'::jsonb, '{}'::jsonb)
                RETURNING id),
            p AS (
                INSERT INTO customer.metering_point
                       (id, customer_id, ean, commodity, brp_id, production_expectation, valid_from)
                SELECT gen_random_uuid(), c.id, '871687119900000097', 'ELECTRICITY', @brpId,
                       'UNKNOWN', DATE '2026-01-01' FROM c
                RETURNING id, customer_id),
            m AS (
                INSERT INTO metering.inbound_message
                       (id, brp_id, correlation_id, payload_hash, payload_bytes, payload_uri, status)
                VALUES (gen_random_uuid(), @brpId, gen_random_uuid(), '\x00'::bytea, 1,
                        'file://probe', 'RECEIVED')
                RETURNING id)
            SELECT p.id::text || '|' || p.customer_id::text || '|' || m.id::text FROM p, m
            """,
            connection,
            transaction);
        arrange.Parameters.AddWithValue("brpId", PvnedBrpId);
        var ids = ((string)(await arrange.ExecuteScalarAsync(ct))!).Split('|');

        await using var insert = new NpgsqlCommand(
            """
            INSERT INTO metering.interval_data_version
                   (metering_point_id, customer_id, delivery_date, direction, source,
                    document_id, document_created, received_at, inbound_message_id,
                    correlation_id, interval_count)
            VALUES (@pointId::uuid, @customerId::uuid, DATE '2026-08-12', 'CONSUMPTION', @source,
                    @documentId, @documentCreated, TIMESTAMPTZ '2026-08-13 04:02:11+00',
                    @messageId, gen_random_uuid(), 96)
            """,
            connection,
            transaction);
        insert.Parameters.AddWithValue("pointId", ids[0]);
        insert.Parameters.AddWithValue("customerId", ids[1]);
        insert.Parameters.AddWithValue("source", source);
        insert.Parameters.AddWithValue(
            "documentId", withDocument ? "b6b2f0aa-7a3d-4f5e-9a1c-2f2b0a44d1c8" : DBNull.Value);
        insert.Parameters.AddWithValue(
            "documentCreated",
            withDocument ? new DateTimeOffset(2026, 8, 13, 3, 0, 0, TimeSpan.Zero) : DBNull.Value);
        insert.Parameters.AddWithValue(
            "messageId", withMessage ? Guid.Parse(ids[2]) : (object)DBNull.Value);

        var thrown = await Should.ThrowAsync<PostgresException>(
            async () => await insert.ExecuteNonQueryAsync(ct));

        await transaction.RollbackAsync(ct);
        return thrown;
    }

    [Fact]
    public async Task ux_idv_current_is_a_partial_unique_index_on_point_date_and_direction()
    {
        // ⚠ The enforcement of receipt-order supersession, not a nicety. Design §4.2: the current
        // version is always the LAST ONE RECEIVED, never the newest by CreatedDateTime, and this
        // index is what makes "exactly one current" a database fact. Asserted on the definition
        // as well as behaviourally by plan 3's apply-transaction tests, because those run inside
        // an advisory lock and would still pass if the index were merely absent.
        var definition = await ScalarAsync<string>(
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'metering' AND indexname = 'ux_idv_current';");

        definition.ShouldContain("CREATE UNIQUE INDEX", Case.Sensitive);
        definition.ShouldContain("metering_point_id, delivery_date, direction", Case.Sensitive);
        definition.ShouldContain("WHERE is_current", Case.Sensitive);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────
    // metering.interval_reading — partitioning, and the routine.
    // ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task interval_reading_is_range_partitioned_by_delivery_date()
    {
        // 'r' is RANGE in pg_partitioned_table.partstrat. LIST or HASH would route rows perfectly
        // well and make every by-month query scan every partition.
        var strategy = await ScalarAsync<string>(
            """
            SELECT p.partstrat::text
            FROM pg_partitioned_table p
            JOIN pg_class c ON c.oid = p.partrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'metering' AND c.relname = 'interval_reading';
            """);

        strategy.ShouldBe("r");
    }

    [Fact]
    public async Task The_migration_created_exactly_the_thirty_six_partitions_of_its_fixed_window()
    {
        // ⚠ Pinned to the exact first and last names as well as the count, because a count alone
        // passes a window that is 36 months long and starts in the wrong year - which is what a
        // seed loop written against now() produces on a database created in a different month.
        // The whole reason the loop is a fixed 2025-01..2027-12 window is that two databases
        // created a month apart must reach the SAME schema, or verify-migrator.sh's double-run
        // idempotence check stops meaning anything.
        var summary = await ScalarAsync<string>(
            """
            SELECT count(*)::text || '|' || min(c.relname) || '|' || max(c.relname)
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'metering' AND c.relispartition AND c.relname LIKE 'interval_reading_%';
            """);

        summary.ShouldBe("36|interval_reading_2025_01|interval_reading_2027_12");
    }

    [Fact]
    public async Task A_reading_lands_in_the_partition_its_delivery_date_names()
    {
        // Partition routing is the whole reason for the PRIMARY KEY (delivery_date, version_id,
        // pos) ordering - PostgreSQL requires the partition key in the key, and delivery_date
        // leading it is what lets a per-day query touch one partition. tableoid is how a row
        // reports which partition it actually landed in.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await using var insert = new NpgsqlCommand(
            """
            INSERT INTO metering.interval_reading
                   (version_id, delivery_date, customer_id, pos, interval_start, quantity_kwh)
            VALUES (gen_random_uuid(), DATE '2026-08-12', gen_random_uuid(), 1,
                    TIMESTAMPTZ '2026-08-12 00:00:00+02', 1.250)
            """,
            connection,
            transaction);

        // ⚠ The version_id foreign key would refuse this row, so the constraint is deferred out
        // of the way for one statement rather than arranging a whole version: the claim under
        // test is partition ROUTING, and a real version proves nothing extra about it.
        await using (var drop = new NpgsqlCommand(
            "ALTER TABLE metering.interval_reading DROP CONSTRAINT interval_reading_version_id_fkey",
            connection,
            transaction))
        {
            await drop.ExecuteNonQueryAsync(ct);
        }

        await insert.ExecuteNonQueryAsync(ct);

        await using var where = new NpgsqlCommand(
            "SELECT tableoid::regclass::text FROM metering.interval_reading WHERE delivery_date = DATE '2026-08-12'",
            connection,
            transaction);
        var partition = (string?)await where.ExecuteScalarAsync(ct);

        partition.ShouldBe("metering.interval_reading_2026_08");

        await transaction.RollbackAsync(ct);
    }

    [Fact]
    public async Task The_partition_routine_is_idempotent_and_returns_the_existing_partitions_name()
    {
        // The maintenance job calls this every tick for a window that mostly already exists, and
        // the migration's own seed loop calls it 36 times. A routine that raised 42P07 on the
        // second call would make the job's first run its last.
        var name = await ScalarAsync<string>(
            "SELECT metering.ensure_interval_reading_partition(DATE '2026-08-17');");

        name.ShouldBe(
            "interval_reading_2026_08",
            "any date in the month resolves to that month's partition - date_trunc, not the day");

        (await ScalarAsync<int>(
            """
            SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'metering' AND c.relname LIKE 'interval_reading_%' AND c.relispartition;
            """)).ShouldBe(36, "calling the routine for an existing month must create nothing");
    }

    [Fact]
    public async Task A_partition_the_routine_creates_arrives_policed_and_read_only_for_the_customer_role()
    {
        // ⚠ The three verified facts in one assertion. ENABLE ROW LEVEL SECURITY on the PARENT
        // does not reach a partition, a GRANT on the parent does not either, but migration 2's
        // ALTER DEFAULT PRIVILEGES DOES - so a partition created without this routine arrives
        // unpoliced and with full DML for app_customer_role. That combination was demonstrated
        // live: a customer connection scoped to company A read BOTH tenants' rows from the
        // partition directly while reading one from the parent.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await using (var create = new NpgsqlCommand(
            "SELECT metering.ensure_interval_reading_partition(DATE '2028-03-09')",
            connection,
            transaction))
        {
            ((string?)await create.ExecuteScalarAsync(ct)).ShouldBe("interval_reading_2028_03");
        }

        await using var inspect = new NpgsqlCommand(
            """
            SELECT c.relrowsecurity::text || '|' ||
                   (SELECT string_agg(policyname, ',' ORDER BY policyname)
                      FROM pg_policies
                     WHERE schemaname = 'metering' AND tablename = 'interval_reading_2028_03') || '|' ||
                   (SELECT string_agg(privilege_type, ',' ORDER BY privilege_type)
                      FROM information_schema.role_table_grants
                     WHERE table_schema = 'metering' AND table_name = 'interval_reading_2028_03'
                       AND grantee = 'app_customer_role')
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'metering' AND c.relname = 'interval_reading_2028_03'
            """,
            connection,
            transaction);

        var actual = (string?)await inspect.ExecuteScalarAsync(ct);

        actual.ShouldBe(
            "true|metering_interval_reading_2028_03_back_office,"
            + "metering_interval_reading_2028_03_tenant_isolation|SELECT",
            "a partition must arrive with row-level security, BOTH policies and SELECT only - "
            + "ALTER DEFAULT PRIVILEGES hands it arwd the instant CREATE TABLE ... PARTITION OF "
            + "runs, and the routine's REVOKE is what takes the writing verbs back off");

        await transaction.RollbackAsync(ct);
    }
}
```

- [ ] **Step 2: Run the tests and watch them pass**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~IngestionSchemaTests"`
Expected: PASS.

⚠ **These pass on the first run**, and that is honest rather than lazy: migration 9 already landed in
Tasks 12 and 13, and this file's job is to pin what it did so a later edit cannot quietly undo it.
The red is produced deliberately in Step 3, one assertion at a time, and a test that cannot be made
to fail there does not belong in the file.

⚠ If `A_reading_lands_in_the_partition_its_delivery_date_names` fails with
`42704: constraint "interval_reading_version_id_fkey" of relation "interval_reading" does not
exist`, read the constraint's real name back before changing the test —
`SELECT conname FROM pg_constraint WHERE conrelid = 'metering.interval_reading'::regclass;` — and use
what it prints. PostgreSQL derives it from the table and column names, so it is
`interval_reading_version_id_fkey` unless the `REFERENCES` clause was written differently.

- [ ] **Step 3: Mutate the two claims that carry the most weight**

**Mutation 1 — the fixed partition window.** In migration 9, change the seed loop's start from a
literal to a clock-derived value, which is the shape somebody writes when "36 months around today"
sounds more useful than a fixed window:

```sql
                DECLARE m date := date_trunc('month', now() - interval '18 months')::date;
```

Re-run against a **fresh** container:
`dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~The_migration_created_exactly_the_thirty_six_partitions"`
Expected: FAIL —
`summary should be "36|interval_reading_2025_01|interval_reading_2027_12" but was "36|interval_reading_2025_03|interval_reading_2028_02"`.

⚠ Note that the **count** is still 36. A test that pinned only the number would have passed a
migration whose output depends on the day it ran, and `verify-migrator.sh`'s idempotence check would
have gone on printing OK while two deployments a month apart carried different schemas. Restore the
literal.

**Mutation 2 — the partition routine's `REVOKE`.** Delete this line from
`metering.ensure_interval_reading_partition`:

```sql
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON metering.%I FROM app_customer_role', v_name);
```

Re-run against a fresh container:
`dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~A_partition_the_routine_creates_arrives_policed"`
Expected: FAIL — `actual should be "true|…|SELECT" but was "true|…|DELETE,INSERT,SELECT,UPDATE"`,
followed by `a partition must arrive with row-level security, BOTH policies and SELECT only…`.

The partition is still policed and both policies are still there — the mutation takes nothing
visible away, which is exactly why the privilege is asserted beside them. Restore the line and
re-run the whole class.

- [ ] **Step 4: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Migrations/IngestionSchemaTests.cs
git commit -m "test: pin what migration 9 did to a real database, not what EF was told

Migration 9 is hand-written SQL, so the model is a second independent statement of the same
schema and neither proves the other. This pins the half only a database can answer:
partition routing by tableoid, the 36-partition fixed window, the routine's idempotence and
the privileges a partition arrives with, both [DEC-143] checks refusing their own violating
row, ck_mp_never_has_no_observed_production, and the PVNed row having been UPDATEd rather
than inserted. The fixed window is verified by mutation - a now()-derived seed loop still
produces 36 partitions, with different names.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 16: The two coverage guards move 7 → 11, and the partition exclusion that keeps them honest

Four pinned literals, in two classes, and one of them cannot simply be moved — it has to be moved
**and** the query beneath it changed, or the number is 47 rather than 11 and moves again every time
the partition-maintenance job runs.

`AutomaticPolicyCoverageTests` discovers from the **EF model**, by
`property.Name.EndsWith("CustomerId")`. Contract §5 gives migration 9 exactly four entities with such
a property, so `:653` and `:674` each move by exactly four: 7 → 11.

`CatalogPolicyCoverageTests` discovers from the **PostgreSQL catalog**, by
`right(column_name, 11) = 'customer_id'` over `information_schema.tables` filtered on
`t.table_type = 'BASE TABLE'`. ⚠ **PostgreSQL lists every partition as a `BASE TABLE`**, and each of
`interval_reading`'s 36 partitions carries `customer_id` — so without an exclusion the number is
`7 + 4 + 36 = 47`, and it changes with the calendar. A guard nobody can keep green is a guard
somebody eventually deletes.

⚠ **Excluding partitions from the count would weaken the guard if nothing else looked at them**, so
it does not stand alone. This task also adds `PartitionPolicyCoverageTests`, which enumerates
**every** partition in the four schemas — not only `interval_reading`'s — pins the set to the exact
36 names migration 9's fixed window produces, and holds each to the same
row-level-security-plus-two-policies bar. The count guards parents; the new class guards partitions.
Split, both are checkable; merged into one number, neither is.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs:643-653`, `:665-674`, `:779-780`, `:795-797`, `:808-836`, `:885-896`, `:906-913`; append `PartitionPolicyCoverageTests` at the end of the file

**Interfaces:**
- Consumes: `TenancyFixture` and the four new entities.
- Produces: nothing other code reads. Contract §12's two named guard literals, and two of the four
  "more literals that break", are settled here.

- [ ] **Step 1: Run the two guards and watch them fail — including at 47**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~PolicyCoverageTests"`

Expected: FAIL, one test in each class.

`every_customer_owned_entity_type_has_row_level_security_enabled_and_both_policies`:
`customerIdOwned.Length should be 7 but was 11`.

`every_table_carrying_a_customer_identifier_has_row_level_security_and_both_policies`:
`customerIdTables.Count should be 7 but was 47`.

⚠ **Forty-seven, not eleven.** Read that number before editing anything: it is the 11 real tables
plus `interval_reading`'s 36 partitions, each discovered on its own because
`information_schema.tables` reports a partition as a `BASE TABLE`. Moving the literal to 47 would
"fix" this test until the maintenance job created month 37.

- [ ] **Step 2: Move the model-driven guard**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`,
replace the comment at `:643-652` — before:

```csharp
        // Seven, not five: plan 5 task 15's OnboardingApplication carries a nullable CustomerId
        // (set only once task 17 signs the application) and plan 6 task 6's EanPoolEntry carries
        // ClaimedByCustomerId. Both are discovered here before ExemptTables removes them below -
        // see ExemptTables' own doc comment for why each is safe. EanPoolEntry is also the only
        // thing exercising the suffix half of CustomerIdOwned's predicate, so this number going
        // back to six is how a broken widening announces itself.
```

after:

```csharp
        // Eleven, not five: plan 5 task 15's OnboardingApplication carries a nullable CustomerId
        // (set only once task 17 signs the application), plan 6 task 6's EanPoolEntry carries
        // ClaimedByCustomerId, and migration 9 adds four - IntervalDataVersion, IntervalReading,
        // MeteringPointDayState and DailyPosition. The first two are discovered here before
        // ExemptTables removes them below; see ExemptTables' own doc comment for why each is
        // safe. EanPoolEntry is also the only thing exercising the suffix half of
        // CustomerIdOwned's predicate, so this number falling by one is how a broken widening
        // announces itself.
        //
        // ⚠ Migration 9 adds EIGHT entities and exactly FOUR of them are here. InboundMessage,
        // QuarantinedSeries, OperationalAlert and MeteringPointBrpAssignment carry no CustomerId
        // at all - there is no tenant to isolate an unknown EAN or a staff alert to - so this
        // predicate never sees them and they need no policy pair. Their protection is the
        // privilege set, asserted by EmployeeOnlyTablePrivilegeTests below: app_customer_role is
        // refused the COMMAND, which is a stronger guarantee than being filtered to no rows.
        //
        // ⚠ interval_reading is PARTITIONED and entityType.GetTableName() returns the parent, so
        // this walk checks the parent's policies only. That is correct here and insufficient on
        // its own: PartitionPolicyCoverageTests is what holds every partition to the same bar,
        // because neither ENABLE ROW LEVEL SECURITY nor a policy on a partitioned parent reaches
        // its partitions.
```

and move `:653`:

```csharp
        customerIdOwned.Length.ShouldBe(11);
```

⚠ `accountIdOwned.Length.ShouldBe(2)` at `:654` is **unchanged** — no slice-2 table is
account-scoped.

Replace the comment at `:665-673` — before:

```csharp
        // Pinned literal, not derived from the model: if the model-driven query above silently
        // returned an empty set (say, every CustomerId property vanished at once) this loop
        // would just never run and the test would report a hollow pass. Seven is the number of
        // tables that are customer- or account-owned AND must carry row-level security today:
        // migration 2's five (customer, customer_account, metering_point, wallet, audit_record)
        // plus migration 3's refresh_token and password_reset_token. onboarding_application and
        // migration 5's metering.ean_pool are discovered too (seven in customerIdOwned above)
        // but are deliberately exempt - see ExemptTables' own doc comment - so neither raises
        // this number.
```

after:

```csharp
        // Pinned literal, not derived from the model: if the model-driven query above silently
        // returned an empty set (say, every CustomerId property vanished at once) this loop
        // would just never run and the test would report a hollow pass. Eleven is the number of
        // tables that are customer- or account-owned AND must carry row-level security today:
        // migration 2's five (customer, customer_account, metering_point, wallet, audit_record),
        // migration 3's refresh_token and password_reset_token, and migration 9's four
        // (interval_data_version, interval_reading, metering_point_day_state, daily_position).
        // onboarding_application and migration 5's metering.ean_pool are discovered too (they are
        // two of the eleven in customerIdOwned above) but are deliberately exempt - see
        // ExemptTables' own doc comment - so neither raises this number: (11 + 2 distinct) - 2.
```

and move `:674`:

```csharp
        customerOwned.Length.ShouldBe(11);
```

- [ ] **Step 3: Add the partition exclusion to the catalog discovery query**

Replace `DiscoverTablesAsync` at `:808-836` — before:

```csharp
    private static async Task<List<(string Schema, string Table)>> DiscoverTablesAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        string columnPredicateSql,
        CancellationToken ct)
    {
        await using var discover = new NpgsqlCommand(
            $"""
            SELECT c.table_schema, c.table_name
            FROM information_schema.columns c
            JOIN information_schema.tables t
              ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            WHERE t.table_type = 'BASE TABLE'
              AND c.table_schema IN ('customer', 'metering', 'wallet', 'audit')
              AND {columnPredicateSql}
            ORDER BY c.table_schema, c.table_name
            """,
            connection,
            transaction);
```

after:

```csharp
    /// <summary>
    /// Every table in the four schemas carrying a column that matches
    /// <paramref name="columnPredicateSql"/>, EXCLUDING partitions.
    /// <para>
    /// ⚠ <c>information_schema.tables</c> reports a partition as a <c>BASE TABLE</c> — verified
    /// against postgres:17 — so from the moment migration 9 created
    /// <c>metering.interval_reading</c>'s 36 monthly partitions, each one was discovered here on
    /// its own and the pinned count below read 47 rather than 11. Worse than wrong: it would move
    /// every time the partition-maintenance job ran, and a guard nobody can keep green is a guard
    /// somebody eventually deletes. <c>pg_class.relispartition</c> is the only place the catalog
    /// says "this is a partition, not a table somebody declared", so the join to
    /// <c>pg_class</c>/<c>pg_namespace</c> is what makes the exclusion expressible at all.
    /// </para>
    /// <para>
    /// Excluding them here does NOT stop anything looking at them:
    /// <see cref="PartitionPolicyCoverageTests"/> enumerates every partition in these four
    /// schemas and holds each to the same row-level-security-plus-two-policies bar. This count
    /// guards the parents; that class guards the partitions. Split, both are checkable; merged
    /// into one number, neither is.
    /// </para>
    /// </summary>
    private static async Task<List<(string Schema, string Table)>> DiscoverTablesAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        string columnPredicateSql,
        CancellationToken ct)
    {
        await using var discover = new NpgsqlCommand(
            $"""
            SELECT c.table_schema, c.table_name
            FROM information_schema.columns c
            JOIN information_schema.tables t
              ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            JOIN pg_namespace pn ON pn.nspname = c.table_schema
            JOIN pg_class pc ON pc.relname = c.table_name AND pc.relnamespace = pn.oid
            WHERE t.table_type = 'BASE TABLE'
              AND NOT pc.relispartition
              AND c.table_schema IN ('customer', 'metering', 'wallet', 'audit')
              AND {columnPredicateSql}
            ORDER BY c.table_schema, c.table_name
            """,
            connection,
            transaction);
```

⚠ The join is on `(relname, relnamespace)`, not on `relname` alone: `pg_class` is database-wide, and
two schemas may hold a table of the same name. Joining through `pg_namespace.nspname` is what keeps
one row per discovered table, which is what leaves the counts below unchanged apart from the
partitions.

Then extend the two comments that explain the predicate. At `:779-780`, inside `ExemptTables`' doc
comment, append after *"…which is exactly what makes this an exemption a reviewer can find."*:

```csharp
    /// <para>
    /// ⚠ Migration 9's four employee-only tables - <c>metering.inbound_message</c>,
    /// <c>metering.quarantined_series</c>, <c>metering.operational_alert</c> and
    /// <c>customer.metering_point_brp_assignment</c> - are NOT here and do not need to be. They
    /// carry no customer_id-suffixed column, so this guard never discovers them; their protection
    /// is the privilege set (REVOKE ALL from app_customer_role), asserted by
    /// <c>EmployeeOnlyTablePrivilegeTests</c>. An exemption list is for tables the guard CAN see
    /// and deliberately lets past - putting an undiscoverable table in it would read as coverage
    /// this class does not provide.
    /// </para>
```

At `:795-797`, extend the `CustomerIdColumnPredicate` comment by appending after *"…and the two are
counted separately on purpose."*:

```csharp
    //
    // ⚠ This predicate matches migration 9's four customer-owned tables and also every PARTITION
    // of metering.interval_reading, each of which carries customer_id. DiscoverTablesAsync's
    // `AND NOT pc.relispartition` is what keeps the counts below at 11 rather than 47; see that
    // method's own doc comment for why excluding them here is not the same as ignoring them.
```

- [ ] **Step 4: Move the catalog guard's two literals**

Replace the comment at `:885-894` — before:

```csharp
        // Seven, not five: migration 3 creates customer.onboarding_application (task 15's table),
        // which carries a nullable customer_id, and migration 5 creates metering.ean_pool, which
        // carries claimed_by_customer_id. Both are discovered here before ExemptTables removes
        // them below. ean_pool is also the only table in the schema exercising the suffix half of
        // CustomerIdColumnPredicate, so this number falling back to six is how a broken widening
        // announces itself rather than passing quietly.
```

after:

```csharp
        // Eleven, not five: migration 3 creates customer.onboarding_application (task 15's
        // table), which carries a nullable customer_id, migration 5 creates metering.ean_pool,
        // which carries claimed_by_customer_id, and migration 9 creates four more -
        // interval_data_version, interval_reading, metering_point_day_state and daily_position -
        // each carrying the denormalised customer_id S2-D1 puts there. The first two are
        // discovered here before ExemptTables removes them below. ean_pool is also the only table
        // in the schema exercising the suffix half of CustomerIdColumnPredicate, so this number
        // falling by one is how a broken widening announces itself rather than passing quietly.
        //
        // ⚠ ELEVEN AND NOT FORTY-SEVEN, and the difference is DiscoverTablesAsync's
        // `AND NOT pc.relispartition`. information_schema.tables reports each of
        // metering.interval_reading's 36 monthly partitions as a BASE TABLE, and each carries
        // customer_id. Without the exclusion this literal would be 47 today and a different
        // number next month, because the partition-maintenance job creates one. The partitions
        // are not thereby unchecked: PartitionPolicyCoverageTests holds every one of them to the
        // same bar, by name.
```

and move `:895`:

```csharp
        customerIdTables.Count.ShouldBe(11);
```

⚠ `accountIdTables.Count.ShouldBe(2)` at `:896` is **unchanged**.

Replace the comment at `:906-912` — before:

```csharp
        // Pinned literal for the same reason the model-driven test pins one: if the discovery
        // query above silently matched nothing - a renamed column, a schema list that drifted -
        // the loop below would never run and the test would report a hollow pass. That exact
        // failure shipped once in this repository, in AssemblyProbe, against zero assemblies.
        // Seven: migration 2's five plus refresh_token and password_reset_token;
        // onboarding_application and metering.ean_pool are discovered (together raising
        // customerIdTables to seven above) but are exempt, so neither raises this number.
```

after:

```csharp
        // Pinned literal for the same reason the model-driven test pins one: if the discovery
        // query above silently matched nothing - a renamed column, a schema list that drifted, a
        // partition exclusion written as `AND pc.relispartition` by accident - the loop below
        // would never run and the test would report a hollow pass. That exact failure shipped
        // once in this repository, in AssemblyProbe, against zero assemblies.
        // Eleven: migration 2's five, plus refresh_token and password_reset_token, plus migration
        // 9's four; onboarding_application and metering.ean_pool are discovered (they are two of
        // the eleven in customerIdTables above) but are exempt, so neither raises this number.
```

and move `:913`:

```csharp
        tables.Count.ShouldBe(11);
```

- [ ] **Step 5: Add `PartitionPolicyCoverageTests`**

Append to the **end** of
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`,
after `EmployeeOnlyTablePrivilegeTests`' closing brace:

```csharp

/// <summary>
/// Every partition in the four application schemas, held to the same bar as a table:
/// row-level security enabled, both policies present, and SELECT-only for the customer role.
/// <para>
/// This class exists because <see cref="CatalogPolicyCoverageTests"/>' discovery query excludes
/// partitions — it has to, or its pinned count would read 47 today and something else next month
/// — and an exclusion with nothing behind it is a hole rather than a simplification. The count
/// guards parents; this guards partitions.
/// </para>
/// <para>
/// ⚠ The reason a partition can be a hole at all was established by running the statements, not
/// by reading documentation. <c>ENABLE ROW LEVEL SECURITY</c> on a partitioned PARENT leaves
/// <c>pg_class.relrowsecurity</c> reading <c>t</c> for the parent and <c>f</c> for the partition,
/// and policies do not propagate either — while migration 2's <c>ALTER DEFAULT PRIVILEGES</c>
/// DOES reach a partition, so one arrives with <c>arwd</c> for <c>app_customer_role</c>. Parent
/// policed, partition not, full DML: a customer connection scoped to company A read BOTH tenants'
/// rows straight out of the partition.
/// </para>
/// <para>
/// ⚠ It enumerates EVERY partition in the four schemas rather than only
/// <c>metering.interval_reading</c>'s, so the first partitioned table a later slice adds is
/// covered by this class on the day it lands rather than on the day somebody remembers to extend
/// the list.
/// </para>
/// </summary>
[Collection(nameof(TenancyCollection))]
public sealed class PartitionPolicyCoverageTests
{
    private readonly TenancyFixture _fixture;

    public PartitionPolicyCoverageTests(TenancyFixture fixture) => _fixture = fixture;

    /// <summary>
    /// The exact 36 partitions migration 9's FIXED seed window produces, 2025-01 through 2027-12.
    /// Pinned by name rather than counted, for the reason the window is fixed at all: a loop
    /// written against <c>now()</c> also produces 36, with different names, on a database created
    /// in a different month — and then two deployments a month apart carry different schemas
    /// while every count-based check goes on passing.
    /// </summary>
    private static string[] ExpectedPartitionNames() =>
        Enumerable.Range(0, 36)
            .Select(offset => new DateOnly(2025, 1, 1).AddMonths(offset))
            .Select(month => $"metering.interval_reading_{month.Year}_{month.Month:D2}")
            .ToArray();

    private async Task<List<(string Schema, string Table)>> DiscoverPartitionsAsync(
        NpgsqlConnection connection, CancellationToken ct)
    {
        await using var discover = new NpgsqlCommand(
            """
            SELECT n.nspname, c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relispartition
              AND n.nspname IN ('customer', 'metering', 'wallet', 'audit')
            ORDER BY n.nspname, c.relname
            """,
            connection);

        var partitions = new List<(string Schema, string Table)>();
        await using var reader = await discover.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            partitions.Add((reader.GetString(0), reader.GetString(1)));
        }

        return partitions;
    }

    [Fact]
    public async Task The_schemas_hold_exactly_the_thirty_six_partitions_the_fixed_window_produces()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var connection = TenancyFixture.Connect(_fixture.OwnerConnectionString);
        await connection.OpenAsync(ct);

        var discovered = (await DiscoverPartitionsAsync(connection, ct))
            .Select(partition => $"{partition.Schema}.{partition.Table}")
            .ToArray();

        discovered.ShouldBe(
            ExpectedPartitionNames(),
            Case.Sensitive,
            "migration 9's seed loop covers a FIXED 2025-01..2027-12 window and contains no call " +
            "to now(). A different first or last name means the loop reads a clock, two databases " +
            "created a month apart no longer reach the same schema, and verify-migrator.sh's " +
            "double-run idempotence check has stopped meaning anything. A different COUNT means " +
            "the maintenance job has run against this fixture, which it must not");
    }

    [Fact]
    public async Task No_partition_lacks_row_level_security_or_either_policy()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var connection = TenancyFixture.Connect(_fixture.OwnerConnectionString);
        await connection.OpenAsync(ct);

        var partitions = await DiscoverPartitionsAsync(connection, ct);

        // Not merely "> 0": a discovery query that silently matched nothing would leave the loop
        // below unrun and the test reporting a hollow pass, which is the failure this repository
        // has shipped once already (AssemblyProbe, against zero assemblies).
        partitions.Count.ShouldBe(36);

        foreach (var (schema, table) in partitions)
        {
            await using var command = new NpgsqlCommand(
                """
                SELECT c.relrowsecurity::text || '|' ||
                       coalesce((SELECT string_agg(policyname, ',' ORDER BY policyname)
                                 FROM pg_policies
                                 WHERE schemaname = @schema AND tablename = @table), 'NONE')
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = @schema AND c.relname = @table
                """,
                connection);
            command.Parameters.AddWithValue("schema", schema);
            command.Parameters.AddWithValue("table", table);

            var actual = (string?)await command.ExecuteScalarAsync(ct);

            actual.ShouldBe(
                $"true|{schema}_{table}_back_office,{schema}_{table}_tenant_isolation",
                $"{schema}.{table} is a partition and must carry row-level security and BOTH " +
                "policies of its own. Neither ENABLE ROW LEVEL SECURITY nor a policy on a " +
                "partitioned parent reaches its partitions, while ALTER DEFAULT PRIVILEGES DOES " +
                "hand the partition full DML - so a partition created outside " +
                "metering.ensure_interval_reading_partition is readable and writable by every " +
                "tenant at once, through a direct SELECT that never touches the parent");
        }
    }

    [Fact]
    public async Task No_partition_grants_the_customer_role_more_than_SELECT()
    {
        // The privilege half, asserted separately from the policies, because a partition can
        // carry both policies and still accept an INSERT: a policy decides which ROWS a command
        // may touch, never whether the command is allowed. The routine's
        // REVOKE INSERT, UPDATE, DELETE is the only thing standing between a customer-scoped
        // connection and writing interval data straight into a partition.
        var ct = TestContext.Current.CancellationToken;
        await using var connection = TenancyFixture.Connect(_fixture.OwnerConnectionString);
        await connection.OpenAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT coalesce(string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type), 'NONE')
            FROM information_schema.role_table_grants g
            JOIN pg_namespace n ON n.nspname = g.table_schema
            JOIN pg_class c ON c.relname = g.table_name AND c.relnamespace = n.oid
            WHERE c.relispartition
              AND g.table_schema IN ('customer', 'metering', 'wallet', 'audit')
              AND g.grantee = 'app_customer_role'
            """,
            connection);

        var privileges = (string?)await command.ExecuteScalarAsync(ct);

        privileges.ShouldBe(
            "SELECT",
            "across every partition in the four schemas, app_customer_role may hold SELECT and " +
            "nothing else. DELETE, INSERT or UPDATE appearing here means a partition was created " +
            "without metering.ensure_interval_reading_partition's REVOKE - ALTER DEFAULT " +
            "PRIVILEGES grants all four the instant CREATE TABLE ... PARTITION OF runs");
    }
}
```

- [ ] **Step 6: Run everything in the file and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~Tenancy"
```

Expected: build clean; PASS.

- [ ] **Step 7: Mutate the partition exclusion, then the partition guard**

**Mutation 1.** In `DiscoverTablesAsync`, delete `AND NOT pc.relispartition`.

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~every_table_carrying_a_customer_identifier"`
Expected: FAIL — `customerIdTables.Count should be 11 but was 47`, and, had the count passed, the
loop would then have checked 36 partitions the class does not claim to cover. Restore the clause.

**Mutation 2 — the interesting direction.** Put the clause back but invert it to
`AND pc.relispartition`, the typo that reads correct at a glance.

Run: the same command.
Expected: FAIL — `customerIdTables.Count should be 11 but was 36`, then
`tables.Count should be 11 but was 36`. Restore.

**Mutation 3 — the partition guard itself.** In migration 9's
`metering.ensure_interval_reading_partition`, delete the `metering_%s_tenant_isolation` policy
`EXECUTE format(...)` block and re-migrate a fresh container.

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~PartitionPolicyCoverageTests"`
Expected: FAIL — `No_partition_lacks_row_level_security_or_either_policy` on the first partition,
with
`actual should be "true|metering_interval_reading_2025_01_back_office,metering_interval_reading_2025_01_tenant_isolation" but was "true|metering_interval_reading_2025_01_back_office"`.

⚠ Check what stayed green under mutation 3: **both catalog counts, and every test in
`CatalogPolicyCoverageTests`.** They exclude partitions, so a partition with no tenant-isolation
policy is invisible to them — which is the entire argument for this class existing beside the
exclusion rather than instead of it. Restore the block and re-run the whole Tenancy filter.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs
git commit -m "test: move both coverage guards to eleven, and guard the partitions separately

The model-driven guard moves 7 to 11 by exactly the four entities contract section 5 gives a
CustomerId. The catalog-driven one cannot simply move: information_schema.tables reports
each of interval_reading's 36 partitions as a BASE TABLE, so without AND NOT
pc.relispartition the number is 47 and changes whenever the maintenance job runs. Excluding
them from the count would be a hole, so PartitionPolicyCoverageTests enumerates every
partition in the four schemas, pins the 36 names the fixed window produces, and holds each
to the same RLS-plus-two-policies-plus-SELECT-only bar. Verified by mutation: dropping the
tenant-isolation policy from the routine leaves every count green and only the new class
red.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: `TenancyFixture` seeds interval data, and the filters are proven against a real database

Task 11 ended on a finding rather than a mutation: a global query filter that is present but
backwards passes every model test there is. This task closes it. `TenancyFixture` gains one version,
one reading, one day state and one daily position **per company**, and the four new tables join the
behavioural row-level-security suite — where company A signs in as `peakpower_app` and goes looking
for company B.

⚠ **Two layers, proven separately.** Layer 1 is the EF filter, exercised through a
`PeakPowerDbContext` scoped to company A on the **owner** connection — which row-level security does
not apply to, so anything it hides was hidden by EF. Layer 2 is the policy, exercised through the
`peakpower_app` login role with raw SQL and no EF at all. A test that arranged data and asserted
isolation through the same connection would prove neither.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/TenancyFixture.cs` (four new properties beside `:78`; seeding after `:203`; the dictionary at `:219-226`)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs` (append members to the existing `RowLevelSecurityTests` class)

**Interfaces:**
- Consumes: `IntervalDataVersion.FromBrpFeed`, `IntervalReading.Create`,
  `MeteringPointDayState.Compute`, `DailyPosition.Roll`, `InboundMessage.Receive` (Tasks 4–6).
- Produces: `TenancyFixture.CompanyAVersionId` / `CompanyBVersionId`, `CompanyAInboundMessageId`,
  and four more entries in `CompanyBIds`. Later plans reuse this fixture rather than starting their
  own container.

- [ ] **Step 1: Write the failing tests**

Append to the **existing** `RowLevelSecurityTests` class in
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`,
immediately before its closing brace (`:392`):

```csharp

    /// <summary>
    /// Layer 2, on migration 9's four customer-owned tables. Company A declares itself and counts;
    /// each table holds exactly one row per company, so anything other than 1 is a policy that
    /// either leaks or over-blocks.
    /// <para>
    /// ⚠ <c>metering.interval_reading</c> is queried through the PARENT here. Reading it through a
    /// partition directly is a different claim - the parent's policy does not reach a partition -
    /// and is covered by <see cref="PartitionPolicyCoverageTests"/> and by
    /// <c>the_customer_role_reading_a_partition_directly_still_sees_only_its_own_rows</c> below.
    /// </para>
    /// </summary>
    [Theory]
    [InlineData("metering.interval_data_version")]
    [InlineData("metering.interval_reading")]
    [InlineData("metering.metering_point_day_state")]
    [InlineData("metering.daily_position")]
    public async Task the_customer_role_sees_only_its_own_rows_in_migration_9s_tenant_tables(
        string qualifiedTable)
    {
        var ct = TestContext.Current.CancellationToken;
        await using var connection = TenancyFixture.Connect(_fixture.CustomerRoleConnectionString);
        await connection.OpenAsync(ct);

        var seen = await CountRowsAsync(connection, qualifiedTable, _fixture.CompanyAId, ct);

        seen.ShouldBe(1, $"company A has exactly one row in {qualifiedTable}, and company B has one too");
    }

    [Theory]
    [InlineData("metering.interval_data_version")]
    [InlineData("metering.interval_reading")]
    [InlineData("metering.metering_point_day_state")]
    [InlineData("metering.daily_position")]
    public async Task the_customer_role_sees_nothing_in_migration_9s_tenant_tables_when_no_customer_is_declared(
        string qualifiedTable)
    {
        var ct = TestContext.Current.CancellationToken;
        await using var connection = TenancyFixture.Connect(_fixture.CustomerRoleConnectionString);
        await connection.OpenAsync(ct);

        var seen = await CountRowsAsync(connection, qualifiedTable, customerId: null, ct);

        seen.ShouldBe(0, $"an unset app.customer_id must fail closed on {qualifiedTable}, not open");
    }

    /// <summary>
    /// The hole the partition routine exists to close, asserted from the side an attacker would
    /// use. The parent's policy does not reach a partition; migration 2's ALTER DEFAULT
    /// PRIVILEGES does. Before the routine applied row-level security and both policies to every
    /// partition it creates, this same query returned BOTH companies' rows.
    /// </summary>
    [Fact]
    public async Task the_customer_role_reading_a_partition_directly_still_sees_only_its_own_rows()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var connection = TenancyFixture.Connect(_fixture.CustomerRoleConnectionString);
        await connection.OpenAsync(ct);

        var seen = await CountRowsAsync(
            connection, "metering.interval_reading_2026_08", _fixture.CompanyAId, ct);

        seen.ShouldBe(
            1,
            "the fixture seeds one reading per company on 2026-08-12, so both live in this " +
            "partition. Two means the partition carries no tenant-isolation policy and the " +
            "parent's does not reach it - which is exactly the state that was demonstrated live " +
            "before metering.ensure_interval_reading_partition existed");
    }

    /// <summary>
    /// Layer 1, on the OWNER connection - which row-level security never applies to - so what is
    /// hidden here was hidden by EF's global query filter and by nothing else. Task 11's mutation
    /// step found that a filter present but written without its <c>!IsAuthenticated ||</c> prefix
    /// passes every model-only test; this is where a filter that is present but WRONG is caught.
    /// </summary>
    [Fact]
    public async Task the_ef_query_filters_hide_the_other_companys_interval_data_on_an_owner_connection()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var scoped = _fixture.OwnerContext(new ScopedToCompany(_fixture.CompanyAId));

        (await scoped.IntervalDataVersions.CountAsync(ct)).ShouldBe(1);
        (await scoped.IntervalReadings.CountAsync(ct)).ShouldBe(1);
        (await scoped.MeteringPointDayStates.CountAsync(ct)).ShouldBe(1);
        (await scoped.DailyPositions.CountAsync(ct)).ShouldBe(1);

        (await scoped.DailyPositions.AnyAsync(
            position => position.CustomerId == _fixture.CompanyBId, ct))
            .ShouldBeFalse("the filter is on the owner connection, so RLS is not what hid this");
    }

    /// <summary>
    /// The other half of the <c>!IsAuthenticated ||</c> shape, and the reason it is written that
    /// way rather than as a bare comparison. The back office, the Worker and the anonymous
    /// onboarding wizard all read through this same DbContext with no customer scope; a filter
    /// without the prefix would return nothing at all to any of them, and every employee
    /// data-health screen would render empty with no error anywhere.
    /// </summary>
    [Fact]
    public async Task an_unscoped_context_sees_both_companies_interval_data()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var unscoped = _fixture.OwnerContext();

        (await unscoped.IntervalDataVersions.CountAsync(ct)).ShouldBe(2);
        (await unscoped.IntervalReadings.CountAsync(ct)).ShouldBe(2);
        (await unscoped.MeteringPointDayStates.CountAsync(ct)).ShouldBe(2);
        (await unscoped.DailyPositions.CountAsync(ct)).ShouldBe(2);
    }
```

and, at the **end of the file**, add the scoped context this needs:

```csharp

/// <summary>
/// An authenticated <see cref="ICustomerContext"/> scoped to one customer, so a test can prove the
/// global query filters actually filter rather than only that they were declared. Deliberately
/// used on the OWNER connection: row-level security does not apply to a table's owner, so
/// anything hidden under this context was hidden by EF.
/// </summary>
file sealed class ScopedToCompany(Guid customerId) : ICustomerContext
{
    public Guid CustomerId { get; } = customerId;

    public Guid AccountId => Guid.Empty;

    public bool IsAdmin => false;

    public bool IsAuthenticated => true;
}
```

⚠ `RowLevelSecurityTests.cs` needs `using PeakPower.Application.Abstractions;` for `ICustomerContext`
and already has `using Microsoft.EntityFrameworkCore;`. Read `:1-10` and add only what is missing.

⚠ `TenancyFixture` today exposes `OwnerContext()` (`:138`), which delegates to
`ContextFor(string)` (`:147`) and always builds an **unscoped** context. Step 3 adds an
`OwnerContext(ICustomerContext)` overload beside it; until then this file does not compile, which is
the build-level red Step 2 expects.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~RowLevelSecurityTests"`

Expected: FAIL to **build**, with
`error CS1501: No overload for method 'OwnerContext' takes 1 arguments`.

Comment out the two owner-connection tests for one run, so the raw-SQL half is seen failing at
runtime rather than only at compile time, then run again.
Expected: FAIL — every case of
`the_customer_role_sees_only_its_own_rows_in_migration_9s_tenant_tables` with
`seen should be 1 but was 0`, and
`the_customer_role_reading_a_partition_directly_still_sees_only_its_own_rows` with the same
`seen should be 1 but was 0`. The partition exists (migration 9's fixed window created it) and is
empty, because the fixture seeds no interval data yet — which is what Step 3 fixes. Restore the two
commented tests afterwards.

- [ ] **Step 3: Seed interval data for both companies**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/TenancyFixture.cs`,
add four properties beside `BrpId` at `:78`:

```csharp

    /// <summary>The one inbound message both companies' seeded versions came from.</summary>
    public Guid InboundMessageId { get; private set; }

    public Guid CompanyAVersionId { get; private set; }

    public Guid CompanyBVersionId { get; private set; }

    /// <summary>
    /// The delivery date every seeded interval row carries. A LITERAL, never a clock: the
    /// partition a reading lands in is decided by this date, and a fixture that drifted with the
    /// calendar would leave <c>the_customer_role_reading_a_partition_directly…</c> naming a
    /// partition that no longer holds its rows. 2026-08-12 sits inside migration 9's fixed
    /// 2025-01..2027-12 window, so it routes to metering.interval_reading_2026_08.
    /// </summary>
    public static readonly DateOnly SeededDeliveryDate = new(2026, 8, 12);
```

Then, in `SeedAsync`, insert after `db.AuditRecords.AddRange(auditA, auditB);` at `:203` and before
`await db.SaveChangesAsync();`:

```csharp

        // Migration 9's four customer-owned tables, one row per company, so every isolation
        // assertion is "exactly one" rather than "not zero" - a policy that over-blocks and a
        // policy that leaks are both caught by the same number.
        //
        // ⚠ One inbound_message shared by both versions, on purpose. It is employee-only and
        // carries no customer_id, so nothing about it is scoped; sharing it is also the honest
        // shape, because one BRP document routinely carries series for several customers.
        var message = InboundMessage.Receive(
            brp.Id,
            Guid.CreateVersion7(),
            new DateTimeOffset(2026, 8, 13, 4, 2, 11, TimeSpan.Zero),
            new byte[InboundMessage.PayloadHashLength],
            payloadBytes: 41_822,
            payloadUri: "file://tenancy-fixture/2026/08/13/seed.bin",
            httpHeaders: null,
            remoteIp: null).Value;
        db.InboundMessages.Add(message);

        var versionA = NewVersion(meteringPointA.Id, companyA.Id, message.Id);
        var versionB = NewVersion(meteringPointB.Id, companyB.Id, message.Id);
        db.IntervalDataVersions.AddRange(versionA, versionB);

        db.IntervalReadings.AddRange(
            NewReading(versionA.Id, companyA.Id),
            NewReading(versionB.Id, companyB.Id));

        db.MeteringPointDayStates.AddRange(
            NewDayState(meteringPointA.Id, companyA.Id),
            NewDayState(meteringPointB.Id, companyB.Id));

        db.DailyPositions.AddRange(
            NewDailyPosition(meteringPointA.Id, companyA.Id, versionA.Id),
            NewDailyPosition(meteringPointB.Id, companyB.Id, versionB.Id));
```

and record the ids after `await db.SaveChangesAsync();`, beside the existing assignments:

```csharp
        InboundMessageId = message.Id;
        CompanyAVersionId = versionA.Id;
        CompanyBVersionId = versionB.Id;
```

Extend the `CompanyBIds` dictionary at `:219-226`:

```csharp
        CompanyBIds = new Dictionary<string, Guid>(StringComparer.Ordinal)
        {
            ["Customer"] = CompanyBId,
            ["CustomerAccount"] = CompanyBAccountId,
            ["MeteringPoint"] = CompanyBMeteringPointId,
            ["Wallet"] = CompanyBWalletId,
            ["AuditRecord"] = CompanyBAuditRecordId,
            ["IntervalDataVersion"] = CompanyBVersionId,
            ["MeteringPointDayState"] = CompanyBMeteringPointId,
            ["DailyPosition"] = CompanyBMeteringPointId,
        };
```

⚠ `metering_point_day_state` and `daily_position` are keyed on `(metering_point_id, delivery_date)`
and have **no `id` column at all**, so their entry is company B's metering point id — the first half
of the key. `IntervalReading` is deliberately absent: its key is `(delivery_date, version_id, pos)`
and no single `Guid` names a row, so a "read another company's row by primary key" test for it would
have to take three values. Its isolation is covered by the count theories above and by the direct
partition read.

Add the four factories beside `NewMeteringPoint` at the end of the class:

```csharp

    private static IntervalDataVersion NewVersion(Guid meteringPointId, Guid customerId, Guid messageId) =>
        IntervalDataVersion.FromBrpFeed(
            meteringPointId,
            customerId,
            SeededDeliveryDate,
            IntervalDirection.Consumption,
            documentId: "b6b2f0aa-7a3d-4f5e-9a1c-2f2b0a44d1c8",
            documentCreated: new DateTimeOffset(2026, 8, 13, 3, 0, 0, TimeSpan.Zero),
            receivedAt: new DateTimeOffset(2026, 8, 13, 4, 2, 11, TimeSpan.Zero),
            inboundMessageId: messageId,
            correlationId: Guid.CreateVersion7(),
            intervalCount: 96).Value;

    private static IntervalReading NewReading(Guid versionId, Guid customerId) =>
        IntervalReading.Create(
            versionId,
            SeededDeliveryDate,
            customerId,
            pos: 1,
            // 2026-08-12 is inside CEST, so the day's first interval starts at 00:00+02:00.
            // A literal rather than IMarketCalendar: this fixture must not depend on plan 1.
            intervalStart: new DateTimeOffset(2026, 8, 12, 0, 0, 0, TimeSpan.FromHours(2)),
            quantityKwh: 1.250m).Value;

    private static MeteringPointDayState NewDayState(Guid meteringPointId, Guid customerId) =>
        MeteringPointDayState.Compute(
            meteringPointId,
            SeededDeliveryDate,
            customerId,
            MeteringDayState.Partial,
            expectedIntervalCount: 96,
            consumptionComplete: false,
            productionComplete: false,
            productionIsDeclaredZero: false,
            finalisedAt: null,
            lastCorrectedAt: null,
            computedAt: new DateTimeOffset(2026, 8, 13, 4, 2, 12, TimeSpan.Zero)).Value;

    private static DailyPosition NewDailyPosition(Guid meteringPointId, Guid customerId, Guid versionId) =>
        DailyPosition.Roll(
            meteringPointId,
            SeededDeliveryDate,
            customerId,
            consumptionKwh: 1.250m,
            productionKwh: 0m,
            netUsageKwh: 1.250m,
            offtakeKwh: 1.250m,
            exportKwh: 0m,
            dataState: MeteringDayState.Partial,
            sourceVersionIds: [versionId],
            computedAt: new DateTimeOffset(2026, 8, 13, 4, 2, 12, TimeSpan.Zero)).Value;
```

and add the `OwnerContext` overload immediately after the existing `OwnerContext()` at `:138`:

```csharp

    /// <summary>
    /// An owner context scoped however the caller needs. Row-level security does not apply to a
    /// table's owner, so anything a scoped context hides here was hidden by EF's global query
    /// filter and by nothing else - which is what makes this the right connection for proving
    /// layer 1, and the wrong one for proving layer 2.
    /// </summary>
    public PeakPowerDbContext OwnerContext(ICustomerContext customerContext)
    {
        var options = new DbContextOptionsBuilder<PeakPowerDbContext>();
        PersistenceServiceCollectionExtensions.ConfigureDbContext(options, OwnerConnectionString);
        return new PeakPowerDbContext(options.Options, customerContext);
    }
```

⚠ `TenancyFixture.cs` already has `using PeakPower.Domain.Metering;` (line 8) and
`using PeakPower.Domain.Customers;` (line 6). It needs `using PeakPower.Application.Abstractions;`
for the `ICustomerContext` parameter — read `:1-14` and add it if it is not there.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~Tenancy"
```

Expected: build clean; PASS.

⚠ If `the_customer_role_reading_a_partition_directly_still_sees_only_its_own_rows` fails with
`42P01: relation "metering.interval_reading_2026_08" does not exist`, the fixture's
`SeededDeliveryDate` has been changed to a date outside migration 9's fixed window. Change the date
back rather than the partition name — the window is fixed on purpose.

- [ ] **Step 5: Mutate the filter shape Task 11 could not catch**

This is the mutation Task 11's Step 5 deferred here. In `PeakPowerDbContext.OnModelCreating`, drop
the `!IsAuthenticated ||` prefix from `DailyPosition`'s filter:

```csharp
        // MUTATION
        modelBuilder.Entity<DailyPosition>()
            .HasQueryFilter(position => position.CustomerId == _customerContext.CustomerId);
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~RowLevelSecurityTests"`
Expected: FAIL — `an_unscoped_context_sees_both_companies_interval_data` with
`(await unscoped.DailyPositions.CountAsync(ct)) should be 2 but was 0`.

⚠ Check what stayed green: **every test in `QueryFilterModelTests`**, because the filter is still
declared, and `the_ef_query_filters_hide_the_other_companys_interval_data_on_an_owner_connection`,
because a scoped context gets the right answer under both shapes. The failure is the back office
reading zero daily positions — the exact silent breakage the prefix exists to prevent, and it is
only visible against a real database. Restore the prefix.

Now mutate the policy rather than the filter: in migration 9, change
`metering_daily_position_tenant_isolation`'s `USING` clause to `USING (true)` and re-migrate a fresh
container.

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~the_customer_role_sees_only_its_own_rows_in_migration_9s_tenant_tables"`
Expected: FAIL — the `metering.daily_position` case, with `seen should be 1 but was 2`, and
`company A has exactly one row in metering.daily_position, and company B has one too`. Restore.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Tenancy/TenancyFixture.cs \
        tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs
git commit -m "test: seed interval data for both companies and prove both tenancy layers on it

Layer 1 through a scoped context on the OWNER connection, which row-level security does not
apply to, so what is hidden was hidden by EF. Layer 2 through peakpower_app with raw SQL and
no EF at all - including a direct read of interval_reading_2026_08, which the parent's
policy does not reach. The bare-comparison filter shape that Task 11's model-only mutation
could not catch fails here, as the back office reading zero daily positions.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 18: `IngestionRoundTripTests` — the model and the SQL are one schema or they are two

Task 12 wrote migration 9 by hand and Task 10 wrote the EF configurations by hand. They are two
independent statements of the same schema, and neither proves the other: a column name, a type or a
converter that disagrees is invisible to `IngestionModelShapeTests` (which never opens a connection)
and invisible to `IngestionSchemaTests` (which never uses EF). **Writing every entity through EF into
a real PostgreSQL 17 and reading it back is what closes the gap** — because a disagreement makes
EF's `INSERT` fail, loudly, with the column named.

Two things only a database can answer are proven here as well:

- **`MANUAL` is storable and unreachable.** `IntervalDataVersionSource.Manual` has no factory —
  `[F02-R36]`'s screens are deferred, and a `FromManualEntry` nothing calls would be dead code
  dressed as a feature. So it is proven with a raw-SQL insert, which is the honest way to test a
  value no code path can reach. If the column, its `CHECK` or `[DEC-143]` were ever narrowed, the
  deferred screens would arrive to find a populated table that has to be rewritten.
- **The halfway state is refused by PostgreSQL**, not merely by the domain.
  `RecordObservedProduction` sets five fields at once because
  `ck_mp_never_has_no_observed_production` makes anything less unstorable; that claim is checked here
  through EF, on an aggregate the domain has already mutated, rather than by hand-writing the row.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Database/IngestionRoundTripTests.cs`

**Interfaces:**
- Consumes: `PostgresFixture`; every entity and factory from Tasks 3–8; the eight `DbSet`s from
  Task 10.
- Produces: nothing other code reads.

- [ ] **Step 1: Write the failing tests**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Database/IngestionRoundTripTests.cs`:

```csharp
using Shouldly;
using Xunit;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;

namespace PeakPower.Integration.Tests.Database;

/// <summary>
/// Every entity migration 9 adds, written through EF into a real PostgreSQL 17 and read back.
/// <para>
/// Migration 9 is hand-written raw SQL and the EF configurations are hand-written too, so they are
/// two independent statements of one schema and neither proves the other. A column name, a type or
/// a converter that disagrees is invisible to <c>IngestionModelShapeTests</c> (no connection) and
/// invisible to <c>IngestionSchemaTests</c> (no EF). Here it makes the INSERT fail with the column
/// named, which is the only cheap way to catch it.
/// </para>
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class IngestionRoundTripTests(PostgresFixture fixture)
{
    private static readonly Guid PvnedBrpId = Guid.Parse("0199a1a0-0000-7000-8000-0000000000b1");
    private static readonly DateOnly DeliveryDate = new(2026, 8, 12);
    private static readonly DateTimeOffset ReceivedAt = new(2026, 8, 13, 4, 2, 11, TimeSpan.Zero);
    private static readonly DateTimeOffset ComputedAt = new(2026, 8, 13, 4, 2, 12, TimeSpan.Zero);

    /// <summary>
    /// One customer and one metering point, committed so every test below has a tenant and a
    /// point to hang rows off. Each caller gets its own pair, keyed on <paramref name="discriminator"/>,
    /// because these tests share one container and the EAN validity exclusion constraint refuses
    /// two points with the same EAN over overlapping periods.
    /// </summary>
    private async Task<(Guid CustomerId, Guid MeteringPointId)> ArrangeTenantAsync(
        PeakPowerDbContext db, string discriminator, CancellationToken ct)
    {
        var customer = Customer.Create(
            $"Round Trip {discriminator} B.V.",
            tradeName: null,
            // ⚠ Eight digits exactly - customer.kvk_number is varchar(8) and KvkNumber.Create
            // validates the length. "810000" + the two-character discriminator.
            kvkNumber: KvkNumber.Create($"810000{discriminator}").Value,
            vatNumber: null,
            billingAddress: new Address("Havenweg", "12", null, "3011 AA", "Rotterdam", "NL"),
            visitingAddress: null,
            primaryContact: new ContactPerson("Els Bakker", "els@example.test", null),
            internalReference: null,
            locale: "nl-NL").Value;

        var point = MeteringPoint.Attach(
            customer.Id,
            // ⚠ Eighteen digits exactly - [DEC-114] relaxed validation to a length check, and the
            // length is still checked. "8716871199000000" + the two-character discriminator.
            EanCode.Create($"8716871199000000{discriminator}").Value,
            PvnedBrpId,
            ProductionExpectation.Unknown,
            expectationSource: null,
            name: null,
            description: null,
            gridOperator: null,
            capacityKw: null,
            address: null,
            validFrom: new DateOnly(2026, 1, 1)).Value;

        db.Customers.Add(customer);
        db.MeteringPoints.Add(point);
        await db.SaveChangesAsync(ct);

        return (customer.Id, point.Id);
    }

    private static InboundMessage NewMessage(string? httpHeaders, string? remoteIp) =>
        InboundMessage.Receive(
            PvnedBrpId,
            Guid.CreateVersion7(),
            ReceivedAt,
            new byte[InboundMessage.PayloadHashLength],
            payloadBytes: 41_822,
            payloadUri: "file://round-trip/2026/08/13/seed.bin",
            httpHeaders,
            remoteIp).Value;

    /// <summary>
    /// ⚠ <c>remote_ip</c> is <c>inet</c>, and a <c>string</c> property cannot reach it: a
    /// text-typed parameter into an inet column fails with 42804, <i>column "remote_ip" is of type
    /// inet but expression is of type text</i>, verified against postgres:17. Contract §5 pins the
    /// property as <c>string?</c>, so the configuration converts through
    /// <c>System.Net.IPAddress</c>. This is the assertion that catches the converter being dropped
    /// — no model test can, because a missing converter is a perfectly valid model.
    /// </summary>
    [Fact]
    public async Task An_inbound_message_round_trips_with_its_jsonb_headers_and_its_inet_address()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var write = fixture.CreateContext();

        var message = NewMessage("""{"content-type":"text/xml"}""", "10.0.0.7");
        write.InboundMessages.Add(message);
        await write.SaveChangesAsync(ct);

        await using var read = fixture.CreateContext();
        var stored = await read.InboundMessages.SingleAsync(m => m.Id == message.Id, ct);

        stored.BrpId.ShouldBe(PvnedBrpId);
        stored.CorrelationId.ShouldBe(message.CorrelationId);
        stored.ReceivedAt.ShouldBe(ReceivedAt);
        stored.PayloadBytes.ShouldBe(41_822);
        stored.PayloadUri.ShouldBe("file://round-trip/2026/08/13/seed.bin");
        stored.HttpHeaders.ShouldBe("""{"content-type":"text/xml"}""");
        stored.RemoteIp.ShouldBe("10.0.0.7");
        stored.Status.ShouldBe(InboundMessageStatus.Received);
    }

    [Fact]
    public async Task An_inbound_message_round_trips_with_no_headers_and_no_address()
    {
        // The nullable half of the same claim. EF applies a non-nullable converter to the
        // non-null values of a nullable property and handles the nulls itself, so a converter
        // that threw on null would break exactly this case and nothing else.
        var ct = TestContext.Current.CancellationToken;
        await using var write = fixture.CreateContext();

        var message = NewMessage(httpHeaders: null, remoteIp: null);
        write.InboundMessages.Add(message);
        await write.SaveChangesAsync(ct);

        await using var read = fixture.CreateContext();
        var stored = await read.InboundMessages.SingleAsync(m => m.Id == message.Id, ct);

        stored.HttpHeaders.ShouldBeNull();
        stored.RemoteIp.ShouldBeNull();
    }

    [Fact]
    public async Task A_version_and_its_readings_round_trip_through_the_partitioned_table()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var write = fixture.CreateContext();
        var (customerId, pointId) = await ArrangeTenantAsync(write, "01", ct);

        var message = NewMessage(null, null);
        write.InboundMessages.Add(message);

        var version = IntervalDataVersion.FromBrpFeed(
            pointId, customerId, DeliveryDate, IntervalDirection.Consumption,
            documentId: "b6b2f0aa-7a3d-4f5e-9a1c-2f2b0a44d1c8",
            documentCreated: new DateTimeOffset(2026, 8, 13, 3, 0, 0, TimeSpan.Zero),
            receivedAt: ReceivedAt,
            inboundMessageId: message.Id,
            correlationId: message.CorrelationId,
            intervalCount: 96).Value;
        write.IntervalDataVersions.Add(version);

        write.IntervalReadings.Add(IntervalReading.Create(
            version.Id, DeliveryDate, customerId, pos: 1,
            intervalStart: new DateTimeOffset(2026, 8, 12, 0, 0, 0, TimeSpan.FromHours(2)),
            quantityKwh: 1.250m).Value);

        await write.SaveChangesAsync(ct);

        await using var read = fixture.CreateContext();
        var stored = await read.IntervalDataVersions.SingleAsync(v => v.Id == version.Id, ct);

        stored.Source.ShouldBe(IntervalDataVersionSource.BrpFeed);
        stored.Direction.ShouldBe(IntervalDirection.Consumption);
        stored.DeliveryDate.ShouldBe(DeliveryDate);
        stored.IntervalCount.ShouldBe((short)96);
        stored.IsCurrent.ShouldBeTrue();

        // ⚠ Store-generated. created_at is NOT NULL DEFAULT now() and the factory may not read a
        // clock (architecture fact 5 is IL-enforced), so EF omits the column on insert and reads
        // the database's answer back. A configuration missing ValueGeneratedOnAdd would send
        // default(DateTimeOffset) and store 0001-01-01.
        stored.CreatedAt.ShouldBeGreaterThan(new DateTimeOffset(2020, 1, 1, 0, 0, 0, TimeSpan.Zero));

        var reading = await read.IntervalReadings
            .SingleAsync(r => r.VersionId == version.Id && r.Pos == 1, ct);

        reading.QuantityKwh.ShouldBe(1.250m);
        reading.CustomerId.ShouldBe(customerId);
        reading.IntervalStart.ShouldBe(new DateTimeOffset(2026, 8, 12, 0, 0, 0, TimeSpan.FromHours(2)));
    }

    /// <summary>
    /// ⚠ <c>MANUAL</c> is storable and unreachable, and this is where "storable" is proven.
    /// <c>IntervalDataVersion</c> has no <c>FromManualEntry</c> factory — [F02-R36]'s screens are
    /// deferred (S2-D6), and a factory nothing calls would be dead code that looks like a feature
    /// — so the row goes in by raw SQL, which is the honest way to test a value no code path can
    /// reach.
    /// <para>
    /// It matters because the alternative was to add the discriminator later, which means
    /// rewriting a populated table. Adding it now costs one column and two checks; a narrowing of
    /// either would surface here rather than when the deferred screens arrive.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_MANUAL_version_is_storable_by_raw_SQL_and_reads_back_through_EF()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var write = fixture.CreateContext();
        var (customerId, pointId) = await ArrangeTenantAsync(write, "02", ct);

        var manualId = Guid.CreateVersion7();

        await using (var connection = new NpgsqlConnection(fixture.ConnectionString))
        {
            await connection.OpenAsync(ct);
            await using var insert = new NpgsqlCommand(
                """
                INSERT INTO metering.interval_data_version
                       (id, metering_point_id, customer_id, delivery_date, direction, source,
                        document_id, document_created, received_at, inbound_message_id,
                        correlation_id, interval_count)
                VALUES (@id, @pointId, @customerId, @deliveryDate, 'CONSUMPTION', 'MANUAL',
                        NULL, NULL, @receivedAt, NULL, gen_random_uuid(), 96)
                """,
                connection);
            insert.Parameters.AddWithValue("id", manualId);
            insert.Parameters.AddWithValue("pointId", pointId);
            insert.Parameters.AddWithValue("customerId", customerId);
            insert.Parameters.AddWithValue("deliveryDate", DeliveryDate);
            insert.Parameters.AddWithValue("receivedAt", ReceivedAt);

            (await insert.ExecuteNonQueryAsync(ct)).ShouldBe(
                1,
                "a MANUAL version with no message and no document must be storable - the " +
                "published DDL's inbound_message_id NOT NULL is exactly what [DEC-143] removed, " +
                "because it made [F02-R36]'s manual reconciliation entry unstorable");
        }

        await using var read = fixture.CreateContext();
        var stored = await read.IntervalDataVersions.SingleAsync(v => v.Id == manualId, ct);

        // Reading it back through EF is half the point: EnumToScreamingSnakeConverter's read path
        // ends in Enum.Parse, so a wire-spelled or renamed member would THROW here rather than
        // merely disagree.
        stored.Source.ShouldBe(IntervalDataVersionSource.Manual);
        stored.InboundMessageId.ShouldBeNull();
        stored.DocumentId.ShouldBeNull();
        stored.DocumentCreated.ShouldBeNull();
    }

    [Fact]
    public async Task The_day_state_and_the_daily_rollup_round_trip_including_the_uuid_array()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var write = fixture.CreateContext();
        var (customerId, pointId) = await ArrangeTenantAsync(write, "03", ct);

        var versionId = Guid.CreateVersion7();

        write.MeteringPointDayStates.Add(MeteringPointDayState.Compute(
            pointId, DeliveryDate, customerId, MeteringDayState.Provisional,
            expectedIntervalCount: 96, consumptionComplete: true, productionComplete: true,
            productionIsDeclaredZero: true, finalisedAt: null, lastCorrectedAt: null,
            computedAt: ComputedAt).Value);

        write.DailyPositions.Add(DailyPosition.Roll(
            pointId, DeliveryDate, customerId,
            consumptionKwh: 10.000m, productionKwh: 5.000m, netUsageKwh: 5.000m,
            offtakeKwh: 10.000m, exportKwh: 5.000m,
            dataState: MeteringDayState.Provisional,
            sourceVersionIds: [versionId],
            computedAt: ComputedAt).Value);

        await write.SaveChangesAsync(ct);

        await using var read = fixture.CreateContext();
        var day = await read.MeteringPointDayStates
            .SingleAsync(s => s.MeteringPointId == pointId && s.DeliveryDate == DeliveryDate, ct);

        day.State.ShouldBe(MeteringDayState.Provisional);
        day.ExpectedIntervalCount.ShouldBe((short)96);
        day.ProductionIsDeclaredZero.ShouldBeTrue();

        var position = await read.DailyPositions
            .SingleAsync(p => p.MeteringPointId == pointId && p.DeliveryDate == DeliveryDate, ct);

        // Design §4.1's worked case, stored and read back: offtake 10 and export 5 for a day whose
        // totals are 10 and 5. Neither is recoverable from the totals - Σc − Σp = 5 gives offtake
        // 5 and export 0 - which is why both are columns.
        position.OfftakeKwh.ShouldBe(10.000m);
        position.ExportKwh.ShouldBe(5.000m);
        position.NetUsageKwh.ShouldBe(5.000m);
        position.SourceVersionIds.ShouldBe(new[] { versionId });
    }

    [Fact]
    public async Task Re_saving_an_unchanged_daily_position_writes_nothing()
    {
        // Without a value comparer EF compares Guid[] by reference, so loading a rollup and
        // saving it again rewrites source_version_ids on every SaveChanges - the same failure
        // JsonbComparer exists to close for the address records. Asserted as "SaveChanges
        // reported no changes", because the column would be rewritten with the SAME value and
        // reading it back proves nothing.
        var ct = TestContext.Current.CancellationToken;
        await using var write = fixture.CreateContext();
        var (customerId, pointId) = await ArrangeTenantAsync(write, "04", ct);

        write.DailyPositions.Add(DailyPosition.Roll(
            pointId, DeliveryDate, customerId,
            consumptionKwh: 1m, productionKwh: 0m, netUsageKwh: 1m,
            offtakeKwh: 1m, exportKwh: 0m, dataState: MeteringDayState.Partial,
            sourceVersionIds: [Guid.CreateVersion7()], computedAt: ComputedAt).Value);
        await write.SaveChangesAsync(ct);

        await using var read = fixture.CreateContext();
        var loaded = await read.DailyPositions
            .SingleAsync(p => p.MeteringPointId == pointId && p.DeliveryDate == DeliveryDate, ct);
        loaded.ShouldNotBeNull();

        (await read.SaveChangesAsync(ct)).ShouldBe(
            0,
            "a loaded-and-resaved rollup must be seen as unchanged - a Guid[] compared by " +
            "reference is reported as modified on every single SaveChanges");
    }

    [Fact]
    public async Task The_quarantine_the_alert_and_the_assignment_round_trip()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var write = fixture.CreateContext();
        var (_, pointId) = await ArrangeTenantAsync(write, "05", ct);

        var message = NewMessage(null, null);
        write.InboundMessages.Add(message);

        write.QuarantinedSeries.Add(QuarantinedSeries.Quarantine(
            message.Id, PvnedBrpId, QuarantineReason.UnknownEan,
            resourceObject: "Prognosis",
            deliveryDate: DeliveryDate,
            direction: IntervalDirection.Production,
            pointCount: 96,
            receivedAt: ReceivedAt).Value);

        write.OperationalAlerts.Add(OperationalAlert.Raise(
            OperationalAlertKind.ProductionExpectationPromoted,
            summary: "A production series arrived for a connection recorded as never producing.",
            detail: null,
            raisedAt: ReceivedAt,
            meteringPointId: pointId,
            brpId: PvnedBrpId,
            inboundMessageId: message.Id,
            deliveryDate: DeliveryDate).Value);

        write.MeteringPointBrpAssignments.Add(MeteringPointBrpAssignment.Record(
            pointId,
            fromBrpId: null,
            toBrpId: PvnedBrpId,
            assignedAt: ReceivedAt,
            assignedBy: MeteringPointBrpAssignment.MigrationActor,
            reason: "Initial assignment, written by the round-trip test.").Value);

        await write.SaveChangesAsync(ct);

        await using var read = fixture.CreateContext();

        var series = await read.QuarantinedSeries
            .SingleAsync(s => s.InboundMessageId == message.Id, ct);
        series.Reason.ShouldBe(QuarantineReason.UnknownEan);
        // [F02-R11]/[AS-17]: the label is carried VERBATIM. The quarantine row is where an
        // employee reads what actually arrived, so trimming or upper-casing it destroys evidence.
        series.ResourceObject.ShouldBe("Prognosis");
        series.Direction.ShouldBe(IntervalDirection.Production);

        var alert = await read.OperationalAlerts
            .SingleAsync(a => a.InboundMessageId == message.Id, ct);
        alert.Kind.ShouldBe(OperationalAlertKind.ProductionExpectationPromoted);
        alert.Status.ShouldBe(OperationalAlertStatus.Open);
        alert.ResolvedAt.ShouldBeNull();

        var assignment = await read.MeteringPointBrpAssignments
            .SingleAsync(a => a.MeteringPointId == pointId, ct);
        assignment.FromBrpId.ShouldBeNull();
        assignment.ToBrpId.ShouldBe(PvnedBrpId);
        assignment.AssignedBy.ShouldBe("system:migration-9");
    }

    /// <summary>
    /// <c>brp_assigned_at</c> is store-generated: the column is <c>NOT NULL DEFAULT now()</c> and
    /// <c>MeteringPoint.Attach</c> may not read a clock, because architecture fact 5 is
    /// IL-enforced and confines that to <c>PeakPower.Infrastructure.Time</c>. Adding a
    /// <c>DateTimeOffset</c> parameter to <c>Attach</c> instead would have moved ten call sites
    /// across four projects for no gain — deviation E.
    /// </summary>
    [Fact]
    public async Task A_metering_point_reads_its_store_generated_brp_assignment_moment_back()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var write = fixture.CreateContext();
        var (_, pointId) = await ArrangeTenantAsync(write, "06", ct);

        await using var read = fixture.CreateContext();
        var point = await read.MeteringPoints.SingleAsync(p => p.Id == pointId, ct);

        point.BrpAssignedAt.ShouldBeGreaterThan(
            new DateTimeOffset(2020, 1, 1, 0, 0, 0, TimeSpan.Zero),
            "ValueGeneratedOnAdd is what makes EF omit the column on insert and read the " +
            "database's now() back - without it the property holds default(DateTimeOffset) and " +
            "0001-01-01 is stored");
    }

    /// <summary>
    /// ⚠ The halfway state, refused by PostgreSQL rather than by the domain. This is the reason
    /// <c>ck_mp_never_has_no_observed_production</c> exists: it makes
    /// <c>production_expectation = 'NEVER'</c> beside a non-null
    /// <c>first_production_observed_at</c> unstorable, so [F02-R34]'s promotion HAS to happen in
    /// the same transaction as the readings that caused it. A processor that stamped the moment
    /// and left the expectation alone is refused at commit.
    /// <para>
    /// The row is built through the domain and then bent, rather than hand-written, because the
    /// claim under test is that the DATABASE refuses what the domain would never produce.
    /// </para>
    /// </summary>
    [Fact]
    public async Task PostgreSQL_refuses_a_NEVER_point_that_carries_an_observed_production_stamp()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var db = fixture.CreateContext();
        var (customerId, _) = await ArrangeTenantAsync(db, "07", ct);

        var never = MeteringPoint.Attach(
            customerId,
            EanCode.Create("871687119900007700").Value,
            PvnedBrpId,
            ProductionExpectation.Never,
            ProductionExpectationSource.CustomerDeclared,
            name: null, description: null, gridOperator: null, capacityKw: null, address: null,
            validFrom: new DateOnly(2026, 1, 1)).Value;
        db.MeteringPoints.Add(never);
        await db.SaveChangesAsync(ct);

        // The halfway state the domain cannot produce: RecordObservedProduction moves the
        // expectation and the stamp together. Written straight to the column to prove the
        // database is the backstop and not merely the domain's echo.
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync(ct);
        await using var update = new NpgsqlCommand(
            """
            UPDATE customer.metering_point
               SET first_production_observed_at = TIMESTAMPTZ '2026-08-13 04:02:12+00'
             WHERE id = @id
            """,
            connection);
        update.Parameters.AddWithValue("id", never.Id);

        var thrown = await Should.ThrowAsync<PostgresException>(
            async () => await update.ExecuteNonQueryAsync(ct));

        thrown.SqlState.ShouldBe("23514");
        thrown.ConstraintName.ShouldBe("ck_mp_never_has_no_observed_production");
    }

    [Fact]
    public async Task The_domain_promotion_and_its_stamp_commit_together()
    {
        // The same constraint from the passing side: RecordObservedProduction moves the
        // expectation to EXPECTED, the source to OBSERVED and the stamp in one aggregate change,
        // so one SaveChanges satisfies the check. If the domain ever set only the stamp, this
        // test - not a unit test - is where PostgreSQL says so.
        var ct = TestContext.Current.CancellationToken;
        await using var db = fixture.CreateContext();
        var (customerId, _) = await ArrangeTenantAsync(db, "08", ct);

        var point = MeteringPoint.Attach(
            customerId,
            EanCode.Create("871687119900008800").Value,
            PvnedBrpId,
            ProductionExpectation.Never,
            ProductionExpectationSource.CustomerDeclared,
            name: null, description: null, gridOperator: null, capacityKw: null, address: null,
            validFrom: new DateOnly(2026, 1, 1)).Value;
        db.MeteringPoints.Add(point);
        await db.SaveChangesAsync(ct);

        point.RecordObservedProduction(ReceivedAt, MeteringPoint.IngestionPromotionActor)
            .IsSuccess.ShouldBeTrue();
        await db.SaveChangesAsync(ct);

        await using var read = fixture.CreateContext();
        var promoted = await read.MeteringPoints.SingleAsync(p => p.Id == point.Id, ct);

        promoted.ProductionExpectation.ShouldBe(ProductionExpectation.Expected);
        promoted.ExpectationSource.ShouldBe(ProductionExpectationSource.Observed);
        promoted.FirstProductionObservedAt.ShouldBe(ReceivedAt);
        promoted.ExpectationSetBy.ShouldBe("system:ingestion");
        promoted.ExpectationSetAt.ShouldBe(ReceivedAt);
    }
}
```

- [ ] **Step 2: Run the tests and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~IngestionRoundTripTests"
```

Expected: build clean; PASS.

⚠ These pass on the first run for the same reason `IngestionSchemaTests` did — the schema and the
model both already landed. The red is produced deliberately in Step 3.

⚠ If `An_inbound_message_round_trips_with_its_jsonb_headers_and_its_inet_address` fails with
`42804: column "remote_ip" is of type inet but expression is of type text`, the `IPAddress`
converter in `InboundMessageConfiguration` (Task 10) is missing. That is the failure this test
exists for; do not "fix" it by changing the column to `text`.

- [ ] **Step 3: Mutate the converter, and then the `[DEC-143]` shape**

**Mutation 1.** In `InboundMessageConfiguration`, delete the `HasConversion` that maps `RemoteIp`
through `System.Net.IPAddress`.

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~An_inbound_message_round_trips_with_its_jsonb_headers"`
Expected: FAIL —
`Npgsql.PostgresException : 42804: column "remote_ip" is of type inet but expression is of type text`.

⚠ Check what stayed green: `IngestionModelShapeTests` has
`The_message_stores_its_headers_as_jsonb_and_its_source_address_as_inet`, which asserts
`GetValueConverter().ShouldNotBeNull()` — so that one goes red too, and it should. What does **not**
go red is every other model test, because a model without a converter is a perfectly valid model.
Restore.

**Mutation 2 — the shape `[DEC-143]` settles.** In migration 9, change
`inbound_message_id uuid REFERENCES metering.inbound_message(id)` to
`inbound_message_id uuid NOT NULL REFERENCES metering.inbound_message(id)` — the published DDL's
form — and re-migrate a fresh container.

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~A_MANUAL_version_is_storable"`
Expected: FAIL —
`Npgsql.PostgresException : 23502: null value in column "inbound_message_id" of relation "interval_data_version" violates not-null constraint`.

That is `[F02-R36]`'s manual reconciliation entry being unstorable, which is the exact contradiction
`[DEC-143]` was recorded to settle in Task 1 — and it is worth seeing once, because the published DDL
still reads plausibly. Restore, and re-run the whole class.

- [ ] **Step 4: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Database/IngestionRoundTripTests.cs
git commit -m "test: round-trip every migration 9 entity through EF against PostgreSQL 17

The hand-written migration and the hand-written EF configurations are two independent
statements of one schema, and neither proves the other - a disagreement is invisible to a
model test (no connection) and to a schema test (no EF), and shows up here as a failing
INSERT with the column named. MANUAL is proven storable by raw SQL, which is the honest way
to test a value no code path can reach, and the ck_mp_never halfway state is proven refused
by PostgreSQL rather than only by the domain. Verified by mutation: dropping the IPAddress
converter reproduces 42804, and restoring the published DDL's NOT NULL makes [F02-R36]
unstorable again.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 19: `DemoDataSeeder` writes an assignment row per seeded connection

Open item 1 in this plan's front matter says nothing yet writes a
`metering_point_brp_assignment` row for a metering point created **after** migration 9. The migration
backfills one row per point that existed when it ran; a point created afterwards — through the demo
seeder, through the employee attach endpoint, or through a pool claim — gets none. This task closes
the seeder's third of that, which is the third every developer and every demo actually looks at. The
two endpoint call sites stay open and stay recorded: wiring them is `F01` back-office work, outside
this slice's §3.1 scope.

⚠ **Consequence for plan 3, restated here because it is the reason this matters at all.**
`[F02-R43]`'s "the assignment in force at **receipt** time decides `WRONG_BRP`" must read
`customer.metering_point_brp_assignment` ordered by `assigned_at DESC` **and fall back to
`customer.metering_point.brp_id` when the history is empty**. A point attached through the back
office has no history, and without the fallback every document for it quarantines as `WRONG_BRP`.

⚠ **The seeder's actor is not the migration's.** `MeteringPointBrpAssignment.MigrationActor` is
`"system:migration-9"` and names the backfill; a demo row written by the seeder is a different
provenance and says so, or "which rows did the migration create" stops being answerable.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs` (a constant beside `:49`; a list beside `:141`; a second block after `:180`)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs` (append)

**Interfaces:**
- Consumes: `MeteringPointBrpAssignment.Record`, `PeakPowerDbContext.MeteringPointBrpAssignments`.
- Produces: `DemoDataSeeder.SeederActor` = `"system:demo-seeder"`, and eleven assignment rows on a
  seeded database — one per seeded connection.

- [ ] **Step 1: Write the failing tests**

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs`,
inside the existing class, immediately before its closing brace:

```csharp

    /// <summary>
    /// Migration 9 backfills one assignment row per metering point that existed when it ran — and
    /// on a fresh database that is none, because the seeder runs afterwards. Without this the
    /// demo database has eleven connections and an empty [F02-R43] history, and plan 3's
    /// WRONG_BRP check has nothing to read for any of them.
    /// </summary>
    [Fact]
    public async Task Every_seeded_connection_gets_its_first_BRP_assignment()
    {
        var ct = TestContext.Current.CancellationToken;
        await SeedAsync(ct);

        await using var db = factory.CreateOwnerDbContext();

        (await db.MeteringPointBrpAssignments.CountAsync(ct)).ShouldBe(
            11,
            "one per seeded connection - the same eleven MeteringPoints Running_it_twice_changes_nothing pins");

        var pointIds = await db.MeteringPoints.Select(point => point.Id).ToListAsync(ct);
        var assignedPointIds = await db.MeteringPointBrpAssignments
            .Select(assignment => assignment.MeteringPointId).ToListAsync(ct);

        assignedPointIds.OrderBy(id => id).ShouldBe(
            pointIds.OrderBy(id => id),
            "one row per point, and no point without one - a count alone would pass eleven rows " +
            "all naming the same connection");
    }

    [Fact]
    public async Task A_seeded_assignment_is_a_first_assignment_naming_the_seeder_and_not_the_migration()
    {
        var ct = TestContext.Current.CancellationToken;
        await SeedAsync(ct);

        await using var db = factory.CreateOwnerDbContext();
        var assignments = await db.MeteringPointBrpAssignments.ToListAsync(ct);

        assignments.ShouldAllBe(assignment => assignment.FromBrpId == null);

        // ⚠ Not the migration actor. "system:migration-9" names the backfill; a demo row is a
        // different provenance, and collapsing the two makes "which rows did migration 9 create"
        // unanswerable on the one database anybody actually looks at.
        assignments.Select(assignment => assignment.AssignedBy).Distinct()
            .ShouldBe(new[] { "system:demo-seeder" });
        assignments.Select(assignment => assignment.AssignedBy).ShouldNotContain(
            MeteringPointBrpAssignment.MigrationActor);
    }

    [Fact]
    public async Task A_seeded_assignment_starts_at_the_moment_its_connection_records()
    {
        // The assignment history and metering_point.brp_assigned_at must agree, or [F02-R43]'s
        // "which BRP was this point on at time T" has two answers. brp_assigned_at is
        // store-generated, so the rows are written in a second pass, after SaveChanges has read
        // the database's now() back.
        var ct = TestContext.Current.CancellationToken;
        await SeedAsync(ct);

        await using var db = factory.CreateOwnerDbContext();

        var mismatched = await db.MeteringPointBrpAssignments
            .Join(
                db.MeteringPoints,
                assignment => assignment.MeteringPointId,
                point => point.Id,
                (assignment, point) => new { assignment.AssignedAt, point.BrpAssignedAt, point.BrpId, assignment.ToBrpId })
            .Where(pair => pair.AssignedAt != pair.BrpAssignedAt || pair.ToBrpId != pair.BrpId)
            .CountAsync(ct);

        mismatched.ShouldBe(
            0,
            "an assignment that disagrees with the column it describes cannot answer which BRP " +
            "the point was on at a given time");
    }

    [Fact]
    public async Task Seeding_twice_does_not_double_the_assignment_history()
    {
        var ct = TestContext.Current.CancellationToken;
        await SeedAsync(ct);
        await SeedAsync(ct);

        await using var db = factory.CreateOwnerDbContext();

        (await db.MeteringPointBrpAssignments.CountAsync(ct)).ShouldBe(
            11,
            "the seeder is a demo convenience, not a migration - a second run must add nothing, " +
            "and a doubled history would make every point look reassigned to the BRP it was " +
            "already on, which MeteringPointBrpAssignment.Record refuses in the first place");
    }
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~DemoDataSeederTests"`

Expected: FAIL — `Every_seeded_connection_gets_its_first_BRP_assignment` with
`(await db.MeteringPointBrpAssignments.CountAsync(ct)) should be 11 but was 0`, and
`A_seeded_assignment_is_a_first_assignment_naming_the_seeder_and_not_the_migration` with
`assignments.Select(...).Distinct() should be ["system:demo-seeder"] but was []`.

`A_seeded_assignment_starts_at_the_moment_its_connection_records` and
`Seeding_twice_does_not_double_the_assignment_history` **pass vacuously** at this point — zero rows
mismatch and zero rows is not eleven, but the second one asserts 11 and so also fails. Note which
tests can pass on an empty table: `mismatched.ShouldBe(0)` is one of them, and it is kept because it
is the only assertion that catches a second pass writing the wrong moment once rows exist.

- [ ] **Step 3: Write the assignment rows**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs`,
add a constant beside `DemoPassword` at `:49`:

```csharp

    /// <summary>
    /// The actor on every assignment row this seeder writes. ⚠ Deliberately NOT
    /// <see cref="MeteringPointBrpAssignment.MigrationActor"/>: that string names migration 9's
    /// backfill, and a demo row is a different provenance. Collapsing the two would make "which
    /// rows did the migration create" unanswerable on the one database anybody looks at.
    /// </summary>
    public const string SeederActor = "system:demo-seeder";
```

Collect the points as they are created — declare the list immediately before the
`foreach (var company in Companies)` loop at `:111`:

```csharp
        // Collected rather than assigned inline, because metering_point.brp_assigned_at is
        // STORE-GENERATED (NOT NULL DEFAULT now(), and MeteringPoint.Attach may not read a clock
        // - architecture fact 5). Its value is not knowable until SaveChanges has read it back,
        // and the assignment row has to carry exactly that moment or the history disagrees with
        // the column it describes.
        var seededPoints = new List<MeteringPoint>();
```

and add one line inside the connection loop, immediately after `db.MeteringPoints.Add(point);`
at `:163`:

```csharp
                seededPoints.Add(point);
```

Then, after the existing `await db.SaveChangesAsync(ct);` at `:180` and before
`return Companies.Count;`:

```csharp

        // The [F02-R43] history for the connections this seeder just created. Migration 9's
        // backfill covers points that existed when IT ran, which on a fresh database is none -
        // the migrator migrates first and seeds afterwards. Without this the demo database has
        // eleven connections and an empty assignment history, and plan 3's WRONG_BRP check has
        // nothing to read for any of them.
        //
        // ⚠ Two SaveChanges, not one, and the reason is brp_assigned_at above: the assignment
        // must start at exactly the moment the column records, and that moment comes from the
        // database.
        foreach (var point in seededPoints)
        {
            db.MeteringPointBrpAssignments.Add(Unwrap(MeteringPointBrpAssignment.Record(
                point.Id,
                fromBrpId: null,
                toBrpId: point.BrpId,
                assignedAt: point.BrpAssignedAt,
                assignedBy: SeederActor,
                reason: "Initial assignment, recorded when the demo connection was seeded.")));
        }

        await db.SaveChangesAsync(ct);
```

⚠ Nothing about idempotence changes. The seeder's existing gate returns `0` without reaching any of
this when the database already holds companies — `Running_it_twice_changes_nothing` is the test that
pins it — so `seededPoints` is empty on a second run and the loop writes nothing.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~DemoDataSeederTests"
```

Expected: build clean; PASS.

- [ ] **Step 5: Mutate the moment, and then the actor**

Change `assignedAt: point.BrpAssignedAt` to a value that looks equally reasonable and is not the
column's:

```csharp
                assignedAt: DateTimeOffset.UtcNow,
```

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~A_seeded_assignment_starts_at_the_moment"`
Expected: FAIL — `mismatched should be 0 but was 11`, followed by `an assignment that disagrees with
the column it describes cannot answer which BRP the point was on at a given time`.

⚠ Two things stayed green: the count and the actor. A history that is present, complete and one
clock-tick out of step with the column it mirrors passes every test that only counts rows — and
`[F02-R43]`'s question is answered by an ordering, so a moment that is merely *close* is a moment
that can order wrongly. Restore.

Now change `assignedBy: SeederActor` to `assignedBy: MeteringPointBrpAssignment.MigrationActor` —
the tempting reuse, since the constant already exists and reads correct.

Run: `dotnet test /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~A_seeded_assignment_is_a_first_assignment"`
Expected: FAIL —
`assignments.Select(assignment => assignment.AssignedBy).Distinct() should be ["system:demo-seeder"] but was ["system:migration-9"]`.
Restore.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs \
        tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs
git commit -m "feat(seeding): write a first BRP assignment for every seeded demo connection

Migration 9 backfills the history for points that existed when it ran, which on a fresh
database is none - the migrator migrates and then seeds. Without this the demo database has
eleven connections and an empty [F02-R43] history. Written in a second pass because
brp_assigned_at is store-generated and the assignment must start at exactly the moment the
column records; verified by mutation, since a history one clock-tick out of step passes
every count. The actor is system:demo-seeder and deliberately not the migration's - the two
provenances have to stay distinguishable. The two endpoint call sites remain open and remain
recorded in this plan's front matter: they are F01 back-office work.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 20: `tools/verify-migrator.sh` — the privileges and the partitions, through the real process

The last task, and the one every downstream plan's Prerequisites block runs. `verify-migrator.sh`
starts a throwaway `postgres:17`, runs the **real** `PeakPower.Migrator` process against it — twice
for idempotence, and five times in all across the seeding cases — and asserts what the resulting
database actually looks like. Nothing else in the repository checks migration 9 through the shipped
process rather than through a test host.

Task 14 already added migration 9 to the script's ordered history list. This task adds the two
claims that need a real database and a real process:

1. **The privilege sets**, on all eight new tables. This is exactly the shape the script already
   asserts for `metering.ean_pool` and `customer.onboarding_application`, and for the same reason:
   `ALTER DEFAULT PRIVILEGES` fires on `CREATE TABLE` and hands out full DML automatically, so a
   `REVOKE` that was never written leaves **no trace anywhere else**. An absence is exactly what no
   other check notices going missing.
2. **The partitions**, which no other verification in the shipped path looks at: 36 of them, every
   one with row-level security, both policies and `SELECT` only.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh` (insert after `:210`, immediately before the second migrator run at `:212`)

**Interfaces:**
- Consumes: migration 9 as landed by Tasks 12 and 13.
- Produces: a green `tools/verify-migrator.sh`, which **every other slice-2 plan's Prerequisites
  block runs**. This is the last gate in this plan.

- [ ] **Step 1: Insert the migration-9 assertions**

Insert into `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh` after line
`210` — that is, after the `employee_token_policies` check and **before** the second
`dotnet run --project "$root/src/Hosts/PeakPower.Migrator/..."` at `:212`, so these run against the
first migration and the idempotence check still follows them:

```bash

# ---------------------------------------------------------------------------------------------
# Migration 9. Asserted here, through the real process against a real database, for exactly the
# reason metering.ean_pool and customer.onboarding_application are: migration 2's
# ALTER DEFAULT PRIVILEGES IN SCHEMA customer, metering, wallet, audit fires on CREATE TABLE and
# hands app_customer_role SELECT/INSERT/UPDATE/DELETE automatically. A REVOKE that was never
# written therefore leaves NO TRACE ANYWHERE ELSE - nothing fails, the table simply becomes
# writable by every tenant at once. An absence is what no other check notices going missing.
#
# The four customer-owned tables keep SELECT and lose the three writing verbs; the four
# employee-only ones lose everything. app_employee_role keeps the default grant it inherited,
# because the back office reads and writes across tenants by design (design section 4.3).
for table in interval_data_version interval_reading metering_point_day_state daily_position; do
  grants="$(docker exec "$container" psql --username postgres --dbname peakpower \
    --tuples-only --no-align --command \
    "SELECT coalesce(string_agg(grantee || ':' || privilege_type, '|' ORDER BY grantee, privilege_type), 'NONE')
     FROM information_schema.role_table_grants
     WHERE table_schema = 'metering' AND table_name = '$table'
       AND grantee IN ('app_customer_role', 'app_employee_role');" 2>/dev/null | tr -d '[:space:]')"
  expected_grants="app_customer_role:SELECT|app_employee_role:DELETE|app_employee_role:INSERT|app_employee_role:SELECT|app_employee_role:UPDATE"
  [[ "$grants" == "$expected_grants" ]] \
    || fail "metering.$table must grant app_customer_role SELECT and nothing else, and leave " \
         "app_employee_role its inherited default - expected '$expected_grants', found '$grants'"
done

# The four employee-only tables: app_customer_role holds nothing at all. There is no customer to
# scope an unknown EAN, a stored raw document, a staff alert or a BRP reassignment to, so the
# customer role must be refused the COMMAND rather than filtered to zero rows - zero rows and
# 42501 look identical from the application and are not the same guarantee.
for qualified in metering:inbound_message metering:quarantined_series metering:operational_alert \
                 customer:metering_point_brp_assignment; do
  schema="${qualified%%:*}"
  table="${qualified##*:}"
  customer_grants="$(docker exec "$container" psql --username postgres --dbname peakpower \
    --tuples-only --no-align --command \
    "SELECT coalesce(string_agg(privilege_type, '|' ORDER BY privilege_type), 'NONE')
     FROM information_schema.role_table_grants
     WHERE table_schema = '$schema' AND table_name = '$table'
       AND grantee = 'app_customer_role';" 2>/dev/null | tr -d '[:space:]')"
  [[ "$customer_grants" == "NONE" ]] \
    || fail "$schema.$table is employee-only and must grant app_customer_role nothing at all - " \
         "found '$customer_grants'. ALTER DEFAULT PRIVILEGES granted all four on CREATE TABLE; " \
         "migration 9's REVOKE ALL is the only thing that takes them away"
done

# The partitions, which nothing else in the shipped path looks at. Three separate facts in one
# query, and each is a different failure: the COUNT catches a seed loop that reads now() (36 is
# also what a clock-derived window produces, which is why the first and last NAMES are pinned
# too); relrowsecurity catches ENABLE ROW LEVEL SECURITY being applied to the parent only, which
# does NOT reach a partition; and the policy count catches the same for CREATE POLICY.
partition_summary="$(docker exec "$container" psql --username postgres --dbname peakpower \
  --tuples-only --no-align --command \
  "SELECT count(*)::text || '|' || min(c.relname) || '|' || max(c.relname) || '|' ||
          count(*) FILTER (WHERE NOT c.relrowsecurity)::text || '|' ||
          count(*) FILTER (WHERE (SELECT count(*) FROM pg_policies p
                                   WHERE p.schemaname = 'metering' AND p.tablename = c.relname) <> 2)::text
   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'metering' AND c.relispartition
     AND c.relname LIKE 'interval_reading_%';" 2>/dev/null | tr -d '[:space:]')"
expected_partition_summary="36|interval_reading_2025_01|interval_reading_2027_12|0|0"
[[ "$partition_summary" == "$expected_partition_summary" ]] \
  || fail "migration 9 must create exactly the 36 partitions of its FIXED 2025-01..2027-12 " \
       "window, every one with row-level security and both policies - expected " \
       "'$expected_partition_summary', found '$partition_summary'. A different first or last " \
       "name means the seed loop reads now(), so two databases created a month apart no longer " \
       "reach the same schema and the double-run check below stops meaning anything"

# And the partitions' privileges, separately, because a partition can carry both policies and
# still accept an INSERT: a policy decides which ROWS a command may touch, never whether the
# command is allowed. This aggregates across all 36, so one partition created without the
# routine's REVOKE fails it.
partition_grants="$(docker exec "$container" psql --username postgres --dbname peakpower \
  --tuples-only --no-align --command \
  "SELECT coalesce(string_agg(DISTINCT g.privilege_type, '|' ORDER BY g.privilege_type), 'NONE')
   FROM information_schema.role_table_grants g
   JOIN pg_namespace n ON n.nspname = g.table_schema
   JOIN pg_class c ON c.relname = g.table_name AND c.relnamespace = n.oid
   WHERE c.relispartition AND g.table_schema = 'metering' AND g.grantee = 'app_customer_role';" \
  2>/dev/null | tr -d '[:space:]')"
[[ "$partition_grants" == "SELECT" ]] \
  || fail "across every partition of metering.interval_reading, app_customer_role may hold " \
       "SELECT and nothing else - found '$partition_grants'. ALTER DEFAULT PRIVILEGES reaches a " \
       "CREATE TABLE ... PARTITION OF, so the routine's REVOKE INSERT, UPDATE, DELETE is what " \
       "takes the writing verbs back off"

# The partition routine itself, by name and signature. The maintenance job calls it and nothing
# else creates a partition, so a migration that dropped it would leave the table unable to accept
# a reading for month 37 - which fails in production, months from now, and nowhere in the suite.
partition_routine="$(docker exec "$container" psql --username postgres --dbname peakpower \
  --tuples-only --no-align --command \
  "SELECT coalesce(string_agg(p.proname || '(' || pg_get_function_arguments(p.oid) || ')', '|'), 'NONE')
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'metering' AND p.proname = 'ensure_interval_reading_partition';" \
  2>/dev/null | tr -d '[:space:]')"
[[ "$partition_routine" == "ensure_interval_reading_partition(p_monthdate)" ]] \
  || fail "metering.ensure_interval_reading_partition(date) must exist - it is the only thing " \
       "that creates a partition WITH row-level security, both policies and the right grants, " \
       "and the maintenance job calls it by this exact name. Found '$partition_routine'"

# The seeded BRP row, corrected rather than replaced. Migration 1 seeds PVNED and ix_brp_code is
# UNIQUE on code, so an INSERT here raises 23505 - but an INSERT guarded by ON CONFLICT DO NOTHING
# would leave the row uncorrected with a blank credential_ref and no error anywhere. The count and
# the values together are what catch both.
brp_row="$(docker exec "$container" psql --username postgres --dbname peakpower \
  --tuples-only --no-align --command \
  "SELECT count(*)::text || '|' || max(code) || '|' || max(credential_ref) || '|' || max(adapter_key)
   FROM metering.brp;" 2>/dev/null | tr -d '[:space:]')"
[[ "$brp_row" == "1|PVNED|BRP_CREDENTIAL_PVNED|PVNED_TIMESERIES_XML_V2P0" ]] \
  || fail "migration 9 must UPDATE migration 1's seeded PVNED row, not insert a second one, and " \
       "credential_ref must name an environment variable rather than hold a secret - expected " \
       "'1|PVNED|BRP_CREDENTIAL_PVNED|PVNED_TIMESERIES_XML_V2P0', found '$brp_row'"

# The dead column, gone. An ABSENCE again, and the published DDL's ux_account_subject index is
# asserted absent beside it: InitialSchema never created it, so a DROP INDEX without IF EXISTS
# would have failed this whole migration - and a migration that created the index in order to
# drop it would pass the first half of this check alone.
account_columns="$(docker exec "$container" psql --username postgres --dbname peakpower \
  --tuples-only --no-align --command \
  "SELECT (SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'customer' AND table_name = 'customer_account'
              AND column_name = 'external_subject_id')::text || ':' ||
          (SELECT count(*) FROM pg_indexes
            WHERE schemaname = 'customer' AND indexname = 'ux_account_subject')::text;" \
  2>/dev/null | tr -d '[:space:]')"
[[ "$account_columns" == "0:0" ]] \
  || fail "customer.customer_account.external_subject_id must be gone and ux_account_subject " \
       "must never have existed - expected '0:0' for (column, index), found '$account_columns'"
```

⚠ **Placement is the assertion.** These must sit **before** the second migrator run at `:212`, like
every existing schema and privilege check in this script, so that the double-run idempotence check
still comes last and still means "the second run changed nothing about any of this".

⚠ `pg_get_function_arguments` renders the parameter as `p_month date`; the surrounding
`tr -d '[:space:]'` removes the space, which is why the expected string reads
`ensure_interval_reading_partition(p_monthdate)`. That is deliberate — every other comparison in
this script is normalised the same way — and not a typo.

- [ ] **Step 2: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
docker info > /dev/null
tools/verify-migrator.sh
```

Expected: `verify-migrator: OK`, exit 0. This takes several minutes: it starts a container and runs
the real Migrator five times.

- [ ] **Step 3: Mutate the two claims that exist only here**

**Mutation 1.** In migration 9, delete
`REVOKE ALL ON metering.quarantined_series FROM app_customer_role;`.

Run: `tools/verify-migrator.sh`
Expected: FAIL —
`FAIL: metering.quarantined_series is employee-only and must grant app_customer_role nothing at all - found 'DELETE|INSERT|SELECT|UPDATE'.`
followed by `verify-migrator: 1 check(s) failed` and a non-zero exit.

⚠ Check what stayed green while that was broken: `dotnet test PeakPower.sln` catches it too, in
`EmployeeOnlyTablePrivilegeTests` — which is the point of having both. What this script adds is that
it runs the **shipped** process against a **fresh** database, so it also catches a migration that
only produces the right privileges when applied on top of a database some test fixture prepared
differently. Restore.

**Mutation 2.** In migration 9, delete the whole `DO $seed$ … $seed$;` partition seed loop, leaving
the routine in place — the shape somebody produces when "the maintenance job will create them
anyway" sounds reasonable.

Run: `tools/verify-migrator.sh`
Expected: FAIL —
`FAIL: migration 9 must create exactly the 36 partitions of its FIXED 2025-01..2027-12 window, every one with row-level security and both policies - expected '36|interval_reading_2025_01|interval_reading_2027_12|0|0', found '0|||0|0'`.

⚠ **Nothing else in the suite goes red under that mutation** except
`PartitionPolicyCoverageTests` and `IngestionSchemaTests` — and both of those would have passed if
the routine had merely been called with a different window, because they run against a fixture, not
against the shipped migrator. Restore, and re-run.

- [ ] **Step 4: Run everything, once, and read the result**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln --nologo
tools/verify-migrator.sh
```

Expected: build clean with no warnings; **every** test green; `verify-migrator: OK`.

⚠ Integration tests use Testcontainers. Running several suites in parallel across worktrees can
exhaust connections and produce mass Postgres timeouts — retry before reporting a regression.

This is the state every other slice-2 plan's Prerequisites block assumes. If `verify-migrator.sh` is
red here, no downstream plan can start.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tools/verify-migrator.sh
git commit -m "test: assert migration 9's privileges and partitions through the real migrator

ALTER DEFAULT PRIVILEGES fires on CREATE TABLE, so a REVOKE that was never written leaves no
trace anywhere else - nothing fails, the table simply becomes writable by every tenant. The
same absence-shaped argument the script already makes for ean_pool and
onboarding_application, extended to migration 9's eight tables, plus the 36 partitions,
their policies, their SELECT-only grants and the routine that creates them. Verified by
mutation: dropping the seed loop leaves every fixture-based test green and only this red.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done — what this plan leaves behind, and what it does not

**Landed.** `[DEC-143]` recorded; the seven metering enums; the eight entity classes and their EF
configurations; `Brp`'s six configuration columns; `MeteringPoint`'s four; the `ExternalSubjectId`
drop; migration 9 in full — every table, index, `CHECK`, policy, `REVOKE` and the partition routine
with its fixed 36-month window; the four global query filters; both contract §12 guard literals and
all four of the "more literals that break"; three ordered migration lists; and five verification
surfaces — model shape, schema behaviour, round-trip through EF, tenancy through both login roles,
and the real migrator process.

**Deliberately not landed, and recorded rather than forgotten.**

1. **The two endpoint call sites still write no assignment row** —
   `src/Hosts/PeakPower.Api.Employee/Endpoints/MeteringPointEndpoints.cs:86` (attach),
   `:151` (edit, which can change `brp_id`) and
   `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs:269` (pool claim). Migration 9
   backfills, Task 19 covers the seeder, and these three are `F01` back-office work outside this
   slice's §3.1 scope. ⚠ **Plan 3 must therefore fall back to `customer.metering_point.brp_id` when
   the assignment history for a point is empty**, or a connection attached through the back office
   quarantines every document it receives as `WRONG_BRP`.
2. **`[OQ-102]`** — the row-level-security login-role credentials are literals inside migration 2,
   so `EMPLOYEE_DATABASE_PASSWORD` cannot be rotated. Migration 9 puts **seven** more tables under
   those roles. It blocks nothing here and is not fixed here.
3. **`[OQ-97]`** — not one of the thirty-one demo EANs carries a valid GS1 check digit, and
   ingestion keys on EAN. The blast radius grows with every ingested row.
4. **Deviation A is flagged for the contract owner.** `production_expectation_set_by` / `_set_at`
   against `ExpectationSetBy` / `ExpectationSetAt` are bridged by the only two explicit
   `HasColumnName` calls in this plan, because contract §6.2's SQL block and its prose disagree and
   both are honoured literally.
5. **`MANUAL` is storable and unreachable.** `[F02-R36]`'s screens are deferred under S2-D6; the
   column, its `CHECK` and Task 18's raw-SQL insert are what keep adding them later a screen rather
   than a rewrite of a populated table.
