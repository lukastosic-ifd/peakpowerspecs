# Day State, Rollup and DevStubs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn applied interval data into an honest day — a completeness verdict judged against
`production_expectation` and never against "both directions present", a `daily_position` rollup whose
offtake and export accumulators are computed per interval and therefore survive Phase 2's clamps, a
FINAL job that can be reopened, silence detection that writes an `operational_alert` row — and build
`PeakPower.DevStubs`, the generator that drives all of it over the real webhook with templated PVNed
XML text.

**Architecture:** The pure maths (`DayCompleteness`, `DailyPositionCalculator`) lives in
`src/Core/PeakPower.Application/Ingestion/` where it has no I/O and can be unit-tested with no
container; the database-touching half (`DayStateRecomputer`, `OperationalAlertRaiser`,
`DayFinalisationJob`, `SilenceDetectionJob`) lives in `src/Infrastructure/PeakPower.Ingestion/` behind
two ports declared in `PeakPower.Application.Abstractions.Ingestion` so plan 3's apply transaction can
call the recomputer and the alert raiser without either project seeing the other's internals.
`PeakPower.DevStubs` is a console host that references `PeakPower.Contracts` and nothing else in this
solution: it emits **templated XML text** (S2-D4), computes the 92/96/100 interval count from
`TimeZoneInfo` itself as a deliberate second opinion, and posts every document over
`POST /webhooks/brp/PVNED` because `[F02-R30]` forbids any code path that writes readings directly.

**Tech Stack:** .NET SDK 10.0.400 · C# `latest` · net10.0 · EF Core 10.0.11 ·
Npgsql.EntityFrameworkCore.PostgreSQL 10.0.3 · Npgsql 10.0.3 · PostgreSQL 17 ·
Microsoft.Extensions.Hosting 10.0.11 · Microsoft.Extensions.Hosting.Abstractions 10.0.11 ·
Microsoft.Extensions.Http 10.0.11 · xUnit v3 3.2.2 · Shouldly 4.3.0 ·
Microsoft.Extensions.TimeProvider.Testing 10.9.0 · Testcontainers.PostgreSql 4.14.0 ·
Microsoft.AspNetCore.Mvc.Testing 10.0.11 · Dapper 2.1.66

**Spec:** docs/superpowers/specs/2026-09-07-poc-slice-2-design.md
**Shared contract:** docs/superpowers/plans/2026-09-07-slice-2-shared-contract.md

## Global Constraints

### Versions — exact, from the shared contract §1, verified 2026-09-07

| | |
| --- | --- |
| .NET SDK | **10.0.400** (`global.json`, `rollForward: latestFeature`) |
| Target framework | **net10.0**, `LangVersion latest`, `Nullable enable`, `TreatWarningsAsErrors`, `AnalysisMode Recommended` |
| EF Core | **10.0.11** |
| Npgsql / `Npgsql.EntityFrameworkCore.PostgreSQL` | **10.0.3** |
| PostgreSQL | **17** (Testcontainers image) |
| `xunit.v3` | **3.2.2** (+ `xunit.runner.visualstudio` 3.1.5, `Microsoft.NET.Test.Sdk` 18.9.0) |
| `Shouldly` | **4.3.0** — ⚠ **never FluentAssertions** `[DEC-118]` |
| `Testcontainers.PostgreSql` | **4.14.0** |
| `Microsoft.Extensions.TimeProvider.Testing` | **10.9.0** |
| `Microsoft.Extensions.Http` / `.Hosting` / `.Hosting.Abstractions` | **10.0.11** |
| `Microsoft.AspNetCore.Mvc.Testing` | **10.0.11** |
| `Dapper` | **2.1.66** |

Every one of these is already pinned in
`/Users/thinhhuynh/PeakPower/peakpower-platform/Directory.Packages.props`. **Do not re-pin and do not
bump.** This plan adds **no** new NuGet package to the solution.

### Build settings that constrain every line of code below

`Directory.Build.props` sets `TreatWarningsAsErrors=true`, `AnalysisMode=Recommended` and suppresses
exactly `CA1000;CA1031;CA1062;CA1515;CA1848;CA2007`. `tests/Directory.Build.props` adds
`CA1707;CA1861;CA1034;CA5394` for test projects only. Two consequences bind this plan:

- **`CA5394` (insecure randomness) is NOT suppressed for `src/`.** `PeakPower.DevStubs` therefore
  contains **no `System.Random` and no `Random.Shared`**. The load shape is a pure deterministic
  function of `(ean, date, pos)`, which is what also makes the byte-identical-dedupe scenario
  reproducible.
- **`CA1819` (properties should not return arrays) is NOT suppressed.** Public members in this plan
  expose `IReadOnlyList<T>`, never `T[]`.

### Architecture facts that bind this plan

- **Fact 5 — nothing outside `PeakPower.Infrastructure.Time` may read the clock.**
  `tests/PeakPower.Architecture.Tests/CallSiteFacts.cs:54-67` scans compiled IL for `get_Now`,
  `get_UtcNow` and `get_Today` on `System.DateTime` and `System.DateTimeOffset` across every assembly
  `AssemblyProbe.ProductionAssemblies()` lists. **`PeakPower.Ingestion` reads the clock only through
  `IMarketCalendar`. `PeakPower.DevStubs` cannot reference `PeakPower.Infrastructure.Time` (contract
  §3.1), so it takes `TimeProvider` from DI and calls `TimeProvider.GetUtcNow()`** — a method on
  `System.TimeProvider`, which is on neither banned type. `MarketCalendar` uses the same escape hatch
  for the same reason (`src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs:20`).
- **Fact 3 — `PeakPower.Ingestion` references no `PeakPower.Integration.Brp.*` assembly.** Nothing in
  this plan adds one.
- **Fact 4 — no type calls `IgnoreQueryFilters()`.** The Worker is unscoped by construction
  (`AddUnscopedCustomerContext()`), so every filter in `PeakPowerDbContext` collapses to `true` and
  nothing here needs to bypass one.

### Enums — the database spelling is normative, and it extends to JSON

Declared by **plan 2** in `PeakPower.Domain.Metering`. This plan **reads** them and declares none:

```csharp
public enum IntervalDirection { Consumption, Production }     // CONSUMPTION | PRODUCTION
public enum MeteringDayState { NoData, Partial, Provisional, Final }
// NO_DATA | PARTIAL | PROVISIONAL | FINAL   [F02-R22]
// ⚠ There is no COMPLETE member. "Complete" is the CONDITION that moves a day to PROVISIONAL
//   (integration-spec §8.3), not a fifth state. Adding one breaks the day-state column CHECK.

public enum OperationalAlertKind
{
    ValidationFailure,               // VALIDATION_FAILURE               [F02-R12]
    MeteringPointSilent,             // METERING_POINT_SILENT            [F02-R26]
    ProductionExpectationPromoted,   // PRODUCTION_EXPECTATION_PROMOTED  [F02-R34]
    MissingProductionDeclaration,    // MISSING_PRODUCTION_DECLARATION   [F02-R35]
    PostWindowReconciliation,        // POST_WINDOW_RECONCILIATION       [F02-R45]
}

public enum OperationalAlertStatus { Open, Resolved }          // OPEN | RESOLVED
```

Slice 1's, unchanged, in `PeakPower.Domain.Customers`
(`src/Core/PeakPower.Domain/Customers/Enums.cs`):

```csharp
public enum ProductionExpectation { Unknown, Never, Expected }          // UNKNOWN | NEVER | EXPECTED
public enum ProductionExpectationSource
{ Contract, GridOperator, Observed, Manual, CustomerDeclared }
// CONTRACT | GRID_OPERATOR | OBSERVED | MANUAL | CUSTOMER_DECLARED
```

⚠ **`EXPECTED` is the value; `OBSERVED` is the source.** `[F02-R34]`'s promotion writes
`ProductionExpectation.Expected` into `production_expectation` **and**
`ProductionExpectationSource.Observed` into `expectation_source`. Writing `OBSERVED` into
`production_expectation` is the single most likely way to get this wrong, and the column has no
`CHECK` to catch it — the value set is enforced by `EnumToScreamingSnakeConverter` alone (contract §4).

⚠ **The source column is named `expectation_source`, not `production_expectation_source`**, and the
domain property is `MeteringPoint.ExpectationSource`
(`src/Core/PeakPower.Domain/Customers/MeteringPoint.cs:41`). The published DDL disagrees with what
shipped, and what shipped wins.

⚠ **No slice-2 enum member may contain two adjacent capitals** (contract §4). Nothing in this plan
adds an enum member.

### The DDL this plan writes rows into — NORMATIVE, owned by plan 2, restated here as a read-only reference

**This plan writes no migration SQL.** These four tables exist by the time task 1 starts. The columns
below are copied verbatim from contract §6.7 and §6.2 because every raw-SQL statement in this plan
names them:

```sql
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

CREATE TABLE metering.daily_position (
    metering_point_id  uuid NOT NULL REFERENCES customer.metering_point(id),
    delivery_date      date NOT NULL,
    customer_id        uuid NOT NULL REFERENCES customer.customer(id),
    consumption_kwh    numeric(16,3) NOT NULL,
    production_kwh     numeric(16,3) NOT NULL,
    net_usage_kwh      numeric(16,3) NOT NULL,               -- may be negative
    offtake_kwh        numeric(16,3) NOT NULL CHECK (offtake_kwh >= 0),
    export_kwh         numeric(16,3) NOT NULL CHECK (export_kwh  >= 0),
    data_state         text NOT NULL
        CHECK (data_state IN ('NO_DATA','PARTIAL','PROVISIONAL','FINAL')),
    source_version_ids uuid[] NOT NULL,
    computed_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (metering_point_id, delivery_date)
);

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

-- customer.metering_point, added by migration 9 (contract §6.2)
ALTER TABLE customer.metering_point
    ADD COLUMN brp_assigned_at               timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN first_production_observed_at  timestamptz,
    ADD COLUMN production_expectation_set_by text,
    ADD COLUMN production_expectation_set_at timestamptz;

ALTER TABLE customer.metering_point
    ADD CONSTRAINT ck_mp_never_has_no_observed_production
    CHECK (production_expectation <> 'NEVER' OR first_production_observed_at IS NULL);
```

⚠ **`ck_mp_never_has_no_observed_production` is what forces `[F02-R34]`'s promotion into the same
transaction.** Stamping `first_production_observed_at` while leaving `production_expectation = 'NEVER'`
raises PostgreSQL `23514`. Task 4 asserts exactly that, and it is the reason the promotion cannot be
deferred to a follow-up job.

### The DbSet names this plan uses

⚠ **The shared contract pins the entity class names (§5) but not the `DbSet` property names on
`PeakPowerDbContext`.** Plan 2 declares them. This plan reads them and uses the names below, which
follow slice 1's existing convention exactly (`Customers`, `CustomerAccounts`, `MeteringPoints`,
`Brps`, `EanPool`, `Wallets`, `AuditRecords`, `OnboardingApplications`, `RefreshTokens`,
`PasswordResetTokens`, `Employees`, `EmployeeRefreshTokens` — see
`src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs:22-75`):

| Entity (contract §5) | `DbSet` property |
| --- | --- |
| `InboundMessage` | `db.InboundMessages` |
| `IntervalDataVersion` | `db.IntervalDataVersions` |
| `IntervalReading` | `db.IntervalReadings` |
| `MeteringPointDayState` | `db.MeteringPointDayStates` |
| `QuarantinedSeries` | `db.QuarantinedSeries` |
| `DailyPosition` | `db.DailyPositions` |
| `OperationalAlert` | `db.OperationalAlerts` |
| `MeteringPointBrpAssignment` | `db.MeteringPointBrpAssignments` |

If plan 2 landed different names, change **only** the property names at the call sites in
`PeakPower.Ingestion` — no other part of this plan depends on them.

### The two `metering.brp` columns this plan reads

Migration 9 adds six (contract §6.1). This plan reads exactly two, through the `Brp` entity's new
properties: `Brp.ExpectedCadence` (mapped to `expected_cadence`, seeded `'DAILY_PER_EAN'`) and
`Brp.Code` (slice 1's, `'PVNED'`). It reads no others and writes none.

### Reads through LINQ, writes through raw SQL — and why the split

Every **read** in this plan goes through `PeakPowerDbContext`'s typed `DbSet`s, so a renamed property
is a compile error rather than a runtime one. Every **write** to `metering_point_day_state`,
`metering.daily_position` and `metering.operational_alert` is raw SQL through
`db.Database.ExecuteSqlInterpolatedAsync`, for three reasons that are not style:

1. All three writes are **upserts or conditional inserts** (`ON CONFLICT DO UPDATE`,
   `WHERE NOT EXISTS`). EF Core has no upsert, and a read-modify-write through the change tracker is
   a lost-update race the advisory lock does not cover for the alert table, which is written by two
   different jobs.
2. Contract §5 gives `MeteringPointDayState`, `DailyPosition` and `OperationalAlert` **properties
   only — no factory method and no public constructor**. Plan 2 owns those classes and this plan may
   not add members to them.
3. `daily_position.source_version_ids` is a `uuid[]`. Writing it as a parameter with an explicit
   `::uuid[]` cast is unambiguous; the EF mapping for a `Guid[]` property is plan 2's business.

Raw SQL through `db.Database` uses the context's own connection and **enlists in the ambient
transaction**, which is what makes step 7 of contract §9.6 ("in the same transaction") true.

### Tenancy

The Worker connects as the database owner and is **exempt from RLS by design** (design §4.3): it
writes across tenants and serves no customer-facing route. It registers
`AddUnscopedCustomerContext()`, so `ICustomerContext.IsAuthenticated` is `false` and every
`!IsAuthenticated || …` query filter collapses to `true`
(`src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs:86-110`). Nothing in this plan calls
`IgnoreQueryFilters()`.

Every row this plan writes to `metering_point_day_state` and `daily_position` carries
`customer_id`, resolved from the metering point (**S2-D1**). It is `NOT NULL` in both tables and the
RLS policies key on it, so a row written without it is a 23502 rather than a silent hole.

### Testing

| Layer | Project | Tooling |
| --- | --- | --- |
| The rollup maths, the completeness rule, the XML template, the load shape, the gate | `tests/PeakPower.Application.Tests` | xUnit v3 + Shouldly + `FakeTimeProvider` |
| Anything touching PostgreSQL, the webhook or the queue | `tests/PeakPower.Integration.Tests` | Testcontainers, real PostgreSQL 17 |

Syntax is `actual.ShouldBe(expected)` and `await Should.ThrowAsync<T>(act)`.
⚠ **Shouldly's `ShouldContain` is case-insensitive by default** and has silently broken three tests in
this repository. Compare with `StringComparison.Ordinal` and assert on structured fields.

### Mutation verification — this repository's stated standard

**Break it first, predict the failure, watch it go red, check the failure is the one you predicted,
then fix it. A green test that was never seen red is not evidence.** A mutation that breaks the
*build* proves nothing about an assertion — if removing a member orphans a `using`, remove that too.
⚠ **Mutate the case your assertion is actually for, not the easy neighbouring one.**

**Two of the four mutations design §10 requires explicitly are this plan's**, and each has its own
numbered step below:

| # | Assertion | The mutation | What must go red | Task |
| --: | --- | --- | --- | --- |
| 1 | **Completeness** (design §7.8) | Write `directions.Count == 2` as the completeness test | The `NEVER` + `A02`-only day, which must reach complete, instead stays `PARTIAL` | Task 2, step 6 |
| 4 | **The §4.1 rollup shape** (design §7.11) | Replace per-interval accumulation with daily-total subtraction | The mixed-export day: `offtake` reads 5 where the fixture says 10, and `export` reads 0 where it says 5 | Task 3, step 6 |

Mutations 2 (receipt-order supersession) and 3 (the DST Pos mapping) belong to plans 3 and 1.

### Copy rules for every `operational_alert` summary this plan writes

Slice 1's rules, binding: **sentence case**; **no emoji and no icon set**; one sentence ending with a
full stop; the number carries its provenance. Two more that this plan leans on:

- **"Projected" = not yet measured; "Provisional" = not yet accepted. Never swap them.**
- **A declared zero is not an absence.** `[F02-R33]`: where `production_expectation` is `NEVER`, the
  production line reads as a **stated zero traceable to its source, setter and date** `[F01-R40]`.

### Commands

```bash
# from /Users/thinhhuynh/PeakPower/peakpower-platform
./dev-up
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln
dotnet test tests/PeakPower.Application.Tests
dotnet test tests/PeakPower.Integration.Tests
dotnet test tests/PeakPower.Architecture.Tests
tools/verify-solution-layout.sh
```

⚠ **Integration tests use Testcontainers.** Running several suites in parallel across worktrees can
exhaust connections and produce mass Postgres timeouts — retry before reporting a regression.
⚠ **`cp -a` preserves mtimes and leaves MSBuild with stale binaries**; use plain `cp` or `touch`.

---

## Scope boundary for this plan

This is **plan 5 of 8**, and it covers design §5 steps **7** and **8**.

**It builds:** the completeness rule against `production_expectation`; `[F02-R34]`'s same-transaction
promotion; the `daily_position` rollup with design §4.1's offtake and export accumulators; the FINAL
job on `AddWorkingDays(deliveryDate, 10)` with the routine `FINAL → PROVISIONAL` reopen edge;
per-metering-point silence detection; the `operational_alert` **conditions** for `[F02-R12]`,
`[F02-R26]`, `[F02-R34]`, `[F02-R35]` and `[F02-R45]`; and **all of `PeakPower.DevStubs`** — the
templated XML builder, the load-shape generator, the fourteen in-scope integration-spec §11 scenarios,
the 90-day backfill and the cadence pusher.

**It does not build, and must not touch:**

| Not this plan | Whose |
| --- | --- |
| Migration 9, any entity class of contract §5, any EF configuration, any query filter, either guard literal | plan 2 |
| The webhook route, credential auth, the 413, dedupe, the correlation id, the advisory lock, supersession, the four quarantine reasons, `IBrpIngestionAdapter`/`IRawPayloadStore`/`IIngestionJobQueue` **declarations** | plan 3 |
| Anything inside `PeakPower.Integration.Brp.Pvned` — the reconstructed XSD, `SchemaProvenance`, the SOAP unwrap, the hand-written negative fixtures | plan 4 |
| `GET /api/v1/consumption/*`, `LastDataDate`, `RecentDataStates`, the four employee data-health responses, replay, the OpenAPI snapshots | plan 6 |
| Every line of Angular | plan 7 |
| The 100-EAN × 365-day load test, the deployment, the "what this slice does not prove" note | plan 8 |
| The four `.csproj` files of the new projects, the solution entries, `verify-solution-layout.sh`, the AppHost, the compose file, `env.example`, **every member of `IMarketCalendar`** | plan 1 |

**Alert *delivery* is deferred** (design §3.2). This plan writes `operational_alert` rows and wires no
mail, pager or webhook. `[DEC-104]` is one operator with no rota, so a channel with no rota behind it
is decoration. Design §1.1 records that this is why the Phase-1 exit criterion "ingestion alerting
proven by a deliberate outage test" is **not met**.

**Two out of integration-spec §11's sixteen scenarios are out** and DevStubs does not generate them:
the imbalance report (`[DEC-25]`, design §3.2 — an A12 document is recognised, stored and closed with
zero readings, which is plan 4's assertion) and the manual reconciliation entry (`[F02-R36]`, whose
screens are deferred though **S2-D2**'s schema is not).

## Domain terms used in this plan

- **Delivery date** — the Amsterdam calendar day a reading is *for*, as distinct from the day it
  arrived. Every one of migration 9's seven tables calls this column `delivery_date`.
- **Direction** — `A02` consumption / `A01` production on the wire; `CONSUMPTION` / `PRODUCTION` in
  the platform. ⚠ **A01 is PRODUCTION.** Under `[DEC-22]` a mis-mapped direction produces a wrong
  invoice, not a wrong chart.
- **Net usage** — `consumption − production`, **per interval per metering point** `[DEC-22]`. It may
  be negative, and the negative part is settled as a separate sale line `[DEC-23]`.
- **Offtake** — `Σ max(cᵢ − pᵢ, 0)`. **Not** `max(Σcᵢ − Σpᵢ, 0)`.
- **Export** — `Σ |min(cᵢ − pᵢ, 0)|`. **Not** `max(−(Σcᵢ − Σpᵢ), 0)`.
- **Production expectation** — a recorded property of the metering point: `UNKNOWN`, `NEVER` or
  `EXPECTED`. `NEVER` means a **declared zero**; `UNKNOWN` reads as `EXPECTED` because the
  conservative failure is a false alarm rather than a hidden gap `[F02-R32]`.
- **DST day** — the last Sunday in March has **92** intervals (02:00–03:00 local does not exist) and
  the last Sunday in October has **100** (it happens twice; `Pos` 9–12 are the first pass, 13–16 the
  second).
- **Cadence** — `[DEC-38]`: **one document per EAN per day**. `metering.brp.expected_cadence` carries
  it as `'DAILY_PER_EAN'`, and silence is detected per metering point rather than inferred from a
  batch.

---

## File Structure

### Created by this plan

⚠ **The two port files are NOT created here.** Contract §7.6 gives their declaration to **plan 3**,
which codes against them first and keeps compiling on `NoOpDayStateRecomputer` /
`DbOperationalAlertRaiser` until this plan lands. Task 1 below **verifies** the shapes plan 3
declared rather than declaring them a second time — two plans declaring one interface is a
duplicate-member compile error, not a merge.

| File | Responsibility |
| --- | --- |
| `src/Core/PeakPower.Application/Ingestion/DayCompleteness.cs` | the completeness rule, pure. **The single highest-value function in the slice** |
| `src/Core/PeakPower.Application/Ingestion/DailyPositionCalculator.cs` | design §4.1's five accumulators, pure, per interval |
| `src/Infrastructure/PeakPower.Ingestion/Rollup/DayStateRecomputer.cs` | the database half: reads current versions, promotes, upserts both rollup tables |
| `src/Infrastructure/PeakPower.Ingestion/Rollup/RollupServiceCollectionExtensions.cs` | `AddIngestionRollup` / `AddIngestionSchedule` — additive to plan 3's own DI entry point |
| `src/Infrastructure/PeakPower.Ingestion/Alerts/OperationalAlertRaiser.cs` | deduped insert and resolve, and the enum→text mapping the raw SQL needs |
| `src/Infrastructure/PeakPower.Ingestion/Alerts/AlertCopy.cs` | every alert sentence in one file, so the copy rules are reviewable in one place |
| `src/Infrastructure/PeakPower.Ingestion/Jobs/DayFinalisationJob.cs` | the 10-working-day rule, per **S2-D8** |
| `src/Infrastructure/PeakPower.Ingestion/Jobs/SilenceDetectionJob.cs` | two cadence windows of silence, per BRP |
| `src/Infrastructure/PeakPower.Ingestion/Jobs/IngestionScheduleHost.cs` | a `BackgroundService` on a `PeriodicTimer`, scheduler-agnostic |
| `src/Hosts/PeakPower.DevStubs/DevStubsGate.cs` | the confirmation-phrase gate, on `SeedingGate`'s pattern |
| `src/Hosts/PeakPower.DevStubs/AmsterdamDay.cs` | the generator's own 92/96/100 computation — a deliberate second opinion |
| `src/Hosts/PeakPower.DevStubs/LoadShape.cs` | a plausible, deterministic load shape and a solar bell curve |
| `src/Hosts/PeakPower.DevStubs/DocumentSpec.cs` | the record shapes the template renders from |
| `src/Hosts/PeakPower.DevStubs/PvnedDocumentTemplate.cs` | **templated XML text** — S2-D4 |
| `src/Hosts/PeakPower.DevStubs/SeededConnections.cs` | the eleven demo EANs, transcribed |
| `src/Hosts/PeakPower.DevStubs/ScenarioCatalogue.cs` | the fourteen in-scope integration-spec §11 scenarios |
| `src/Hosts/PeakPower.DevStubs/PvnedWebhookClient.cs` | posts over the real webhook with the BRP credential header |
| `src/Hosts/PeakPower.DevStubs/ScenarioRunner.cs` | drives the catalogue, reports per-post outcomes |
| `src/Hosts/PeakPower.DevStubs/BackfillCommand.cs` | 90 days × eleven connections, behind the gate |
| `src/Hosts/PeakPower.DevStubs/CadenceCommand.cs` | the pusher, behind the gate |
| `src/Hosts/PeakPower.DevStubs/DevStubsOptions.cs` | webhook base URI, BRP code, credential variable name, GLNs |
| `src/Hosts/PeakPower.DevStubs/Program.cs` | the console entry point and its verbs |
| `src/Hosts/PeakPower.DevStubs/DevStubsVerbs.cs` | the verb and option parser, and `DevStubsUsageException` |
| `src/Hosts/PeakPower.DevStubs/README.md` | how to run it against a local stack and against the deployed webhook |
| `tests/PeakPower.Application.Tests/Ingestion/DayCompletenessTests.cs` | the completeness matrix, and the `directions.Count == 2` mutation |
| `tests/PeakPower.Application.Tests/Ingestion/DailyPositionCalculatorTests.cs` | design §4.1's worked case, and the daily-totals mutation |
| `tests/PeakPower.Application.Tests/DevStubs/AmsterdamDayTests.cs` | six DST transitions across three years |
| `tests/PeakPower.Application.Tests/DevStubs/LoadShapeTests.cs` | determinism, non-negativity, plausibility |
| `tests/PeakPower.Application.Tests/DevStubs/PvnedDocumentTemplateTests.cs` | element order, escaping, `RecourceName`, exact byte padding |
| `tests/PeakPower.Application.Tests/DevStubs/ScenarioCatalogueTests.cs` | fourteen families; the `invalid-<code>` family's thirteen documents — eleven adapter codes and the two size boundaries; no duplicate keys |
| `tests/PeakPower.Application.Tests/DevStubs/DevStubsGateTests.cs` | the decision matrix and the phrase disjointness |
| `tests/PeakPower.Integration.Tests/Rollup/RollupFixture.cs` | a container plus the seed helpers every rollup test uses |
| `tests/PeakPower.Integration.Tests/Rollup/DayStateRecomputerTests.cs` | the four `production_expectation` cases against a real database |
| `tests/PeakPower.Integration.Tests/Rollup/ProductionPromotionTests.cs` | `[F02-R34]` in the same transaction, and the `23514` proof |
| `tests/PeakPower.Integration.Tests/Rollup/DailyPositionPersistenceTests.cs` | the stored accumulators and `source_version_ids` |
| `tests/PeakPower.Integration.Tests/Rollup/DayFinalisationJobTests.cs` | the 10-working-day rule, the reopen edge, and "nothing archives on FINAL" |
| `tests/PeakPower.Integration.Tests/Rollup/SilenceDetectionJobTests.cs` | silent, not silent, and resolution |
| `tests/PeakPower.Integration.Tests/Rollup/OperationalAlertRaiserTests.cs` | dedupe, resolve, and the kind→text mapping against the DDL CHECK |
| `tests/PeakPower.Integration.Tests/DevStubs/DevStubsScenarioFixture.cs` | the Worker under `WebApplicationFactory<WorkerEntryPoint>`, with a drainable queue |
| `tests/PeakPower.Integration.Tests/DevStubs/ScenarioEndToEndTests.cs` | the fourteen scenarios through the real webhook |
| `tests/PeakPower.Integration.Tests/DevStubs/SizeBoundaryTests.cs` | 26 214 400 accepted, 26 214 401 refused |
| `tests/PeakPower.Integration.Tests/Rollup/RollupRegistrationTests.cs` | plan 5's recomputer and raiser replace plan 3's stand-ins, whatever the registration order |
| `tests/PeakPower.Application.Tests/DevStubs/SeededConnectionsTests.cs` | the eleven transcribed EANs still match `DemoDataSeeder` |
| `tests/PeakPower.Application.Tests/DevStubs/DemoDataSeederProbe.cs` | reads the seeder's own private roster by reflection, so the guard above has something to compare with |
| `tests/PeakPower.Application.Tests/DevStubs/PvnedWebhookClientTests.cs` | route, credential header, correlation id, and the empty-credential refusal |
| `tests/PeakPower.Application.Tests/DevStubs/ScenarioRunnerTests.cs` | every catalogue document posted once, outcomes reported per key |
| `tests/PeakPower.Application.Tests/DevStubs/BackfillAndCadenceCommandTests.cs` | the gate refuses, the plan is eleven streams of ninety dates (1 260 documents), the cadence pushes one day |
| `tests/PeakPower.Application.Tests/DevStubs/DevStubsProgramTests.cs` | the verb table, and the exit code for an unknown verb |

### Modified by this plan

⚠ **`MeteringPoint.RecordObservedProduction` is NOT declared here.** Plan 2 owns every member of
every entity of contract §5 and of `MeteringPoint` itself. Task 4 below keeps the tests and the two
mutations, which are stronger than plan 2's, and **verifies** the behaviour plan 2 declared.

| File | Change |
| --- | --- |
| `src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj` | add `<PackageReference Include="Microsoft.Extensions.Hosting.Abstractions" />` for `BackgroundService` |
| `src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj` | add `<PackageReference Include="Microsoft.Extensions.Http" />` and `<PackageReference Include="Microsoft.Extensions.Hosting" />` if plan 1 did not |
| `tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj:12` | add a `ProjectReference` to `PeakPower.DevStubs`, so the generator's pure units are tested where the contract's §3.1 table puts them |
| `tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj:15` | add `ProjectReference`s to `PeakPower.Ingestion`, `PeakPower.Worker` and `PeakPower.DevStubs` |

---

## Prerequisites — do this before Task 1

Plans 1, 2, 3 and 4 have landed. Verify, do not assume:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform

# Plan 1: 22 projects, and the calendar's four new members exist.
tools/verify-solution-layout.sh
grep -c 'ExpectedIntervalCount\|IntervalStart\|IsDstDuplicate\|AddWorkingDays' \
  src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs   # must print 4 or more

# Plan 2: migration 9 is the ninth, and the four tables exist.
tools/verify-migrator.sh

# Plans 3 and 4: the webhook and the adapter.
grep -rn 'webhooks/brp' src/Hosts/PeakPower.Worker/ | head
ls src/Infrastructure/PeakPower.Integration.Brp.Pvned/

dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln
```

If `dotnet test` is not green before task 1, stop. Nothing below distinguishes a failure it caused
from one it inherited.

---

### Task 1: verify the two ports plan 3 declared — `IDayStateRecomputer` and `IOperationalAlertRaiser`

Contract §9.6 step 7 says the apply transaction recomputes `metering_point_day_state` and
`daily_position` "in the same transaction", and contract §8.4 says a validation failure "raises a
`VALIDATION_FAILURE` alert". Neither names a type. Contract §7.6 settles the two that do — and gives
their **declaration to plan 3** and their **implementation to this plan**. Plan 3 codes against them
before this plan exists and keeps compiling on `NoOpDayStateRecomputer` and
`DbOperationalAlertRaiser` until task 12 replaces both.

⚠ **Do not create either file.** If they are missing, plan 3 has not landed and the prerequisite
check above should have stopped you. Two plans declaring one interface is a duplicate-member compile
error, not a merge, and contract §17 names it the single most likely way eight parallel plans fail to
assemble.

They live in `PeakPower.Application.Abstractions.Ingestion` for the same reason every other port in
contract §7 does: `PeakPower.Ingestion` and `PeakPower.Integration.Brp.Pvned` can both see it without
seeing each other — architecture fact 3.

⚠ **`DayRecomputeRequest.NewVersionReceivedAt` is nullable and the nullability is load-bearing.**
`[DEC-98]` makes `FINAL` a status, not a guarantee, so a version arriving after the window **reopens**
the date. But a *recompute with nothing new* — a replay that produced `NO_CHANGE` `[F02-R27]`, or a
maintenance sweep — must **not** reopen it. A recomputer that cannot tell the two apart either never
reopens (breaking `[F02-R45]`) or reopens on every replay (breaking `FINAL` for no reason). The
parameter is what tells them apart, and task 8 asserts both arms.

**Files:**
- Read (declared by plan 3, contract §7.6): `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/Ingestion/IDayStateRecomputer.cs`
- Read (declared by plan 3, contract §7.6): `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/Ingestion/IOperationalAlertRaiser.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/RollupPortShapeTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Domain.Metering.MeteringDayState`, `.OperationalAlertKind` (plan 2, contract §4);
  the two port declarations above (plan 3).
- Produces (the test file only — every type below is plan 3's):
  - `PeakPower.Application.Abstractions.Ingestion.IDayStateRecomputer` with
    `Task<DayRecomputeResult> RecomputeAsync(DayRecomputeRequest request, CancellationToken ct)`
  - `DayRecomputeRequest(Guid MeteringPointId, DateOnly DeliveryDate, Guid CorrelationId, DateTimeOffset? NewVersionReceivedAt)`
  - `DayRecomputeResult(MeteringDayState State, short ExpectedIntervalCount, bool ConsumptionComplete, bool ProductionComplete, bool ProductionIsDeclaredZero, bool ProductionExpectationPromoted, bool ReopenedFromFinal, decimal ConsumptionKwh, decimal ProductionKwh, decimal NetUsageKwh, decimal OfftakeKwh, decimal ExportKwh)`
  - `PeakPower.Application.Abstractions.Ingestion.IOperationalAlertRaiser` with
    `Task<bool> RaiseAsync(OperationalAlertRequest request, CancellationToken ct)` and
    `Task<int> ResolveOpenAsync(OperationalAlertKind kind, Guid meteringPointId, DateOnly? deliveryDate, DateTimeOffset resolvedAt, CancellationToken ct)`
  - `OperationalAlertRequest(OperationalAlertKind Kind, string Summary, string? Detail, Guid? MeteringPointId, Guid? BrpId, Guid? InboundMessageId, DateOnly? DeliveryDate, DateTimeOffset RaisedAt)`

- [ ] **Step 1: Write the shape test that verifies the port plan 3 declared**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/RollupPortShapeTests.cs`:

```csharp
using System.Reflection;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Metering;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion;

/// <summary>
/// The two ports plan 3's apply transaction calls, pinned by shape rather than by behaviour.
/// <para>
/// This file exists because eight plans are written in parallel: plan 3 codes against
/// <see cref="IDayStateRecomputer"/> and <see cref="IOperationalAlertRaiser"/> without seeing this
/// plan's implementation, so a renamed member here is a compile error in a repository the author of
/// that rename never opened. A shape test is cheap insurance against exactly that.
/// </para>
/// </summary>
public sealed class RollupPortShapeTests
{
    [Fact]
    public void The_recomputer_port_takes_a_request_and_a_cancellation_token()
    {
        var method = typeof(IDayStateRecomputer).GetMethod(nameof(IDayStateRecomputer.RecomputeAsync));

        method.ShouldNotBeNull();
        method.ReturnType.ShouldBe(typeof(Task<DayRecomputeResult>));

        var parameters = method.GetParameters();
        parameters.Length.ShouldBe(2);
        parameters[0].ParameterType.ShouldBe(typeof(DayRecomputeRequest));
        parameters[1].ParameterType.ShouldBe(typeof(CancellationToken));
    }

    /// <summary>
    /// The one property whose nullability is a decision rather than a detail. [DEC-98] makes a
    /// post-window version reopen a FINAL date; a replay that changed nothing must not. Null is
    /// what says "nothing new landed".
    /// </summary>
    [Fact]
    public void A_recompute_request_can_say_that_nothing_new_arrived()
    {
        var property = typeof(DayRecomputeRequest)
            .GetProperty(nameof(DayRecomputeRequest.NewVersionReceivedAt));

        property.ShouldNotBeNull();
        property.PropertyType.ShouldBe(typeof(DateTimeOffset?));
    }

    [Fact]
    public void The_recompute_result_carries_the_five_daily_position_figures()
    {
        var names = typeof(DayRecomputeResult)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(property => property.Name)
            .ToArray();

        names.ShouldContain(nameof(DayRecomputeResult.ConsumptionKwh));
        names.ShouldContain(nameof(DayRecomputeResult.ProductionKwh));
        names.ShouldContain(nameof(DayRecomputeResult.NetUsageKwh));
        names.ShouldContain(nameof(DayRecomputeResult.OfftakeKwh));
        names.ShouldContain(nameof(DayRecomputeResult.ExportKwh));
    }

    [Fact]
    public void The_alert_port_raises_and_resolves()
    {
        var raise = typeof(IOperationalAlertRaiser).GetMethod(nameof(IOperationalAlertRaiser.RaiseAsync));
        var resolve = typeof(IOperationalAlertRaiser).GetMethod(nameof(IOperationalAlertRaiser.ResolveOpenAsync));

        raise.ShouldNotBeNull();
        // bool, not void: a deduped alert is a different outcome from a written one, and the
        // silence sweep counts them separately.
        raise.ReturnType.ShouldBe(typeof(Task<bool>));

        resolve.ShouldNotBeNull();
        resolve.ReturnType.ShouldBe(typeof(Task<int>));
        resolve.GetParameters()[0].ParameterType.ShouldBe(typeof(OperationalAlertKind));
    }

    [Fact]
    public void An_alert_request_carries_its_own_moment_rather_than_reading_a_clock()
    {
        // Architecture fact 5: nothing outside PeakPower.Infrastructure.Time reads the clock, so
        // the raiser cannot default raised_at itself and the caller has to say when.
        var property = typeof(OperationalAlertRequest)
            .GetProperty(nameof(OperationalAlertRequest.RaisedAt));

        property.ShouldNotBeNull();
        property.PropertyType.ShouldBe(typeof(DateTimeOffset));
    }
}
```

- [ ] **Step 2: Run the test and read which of three things it tells you**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~RollupPortShapeTests"
```

Three outcomes, and they mean different things:

| What you see | What it means | What to do |
| --- | --- | --- |
| **PASS**, 5 tests | Plan 3 declared both ports at contract §7.6's shapes | Skip to step 5 |
| `error CS0234: The type or namespace name 'Ingestion' does not exist in the namespace 'PeakPower.Application.Abstractions'`, or `error CS0246: The type or namespace name 'IDayStateRecomputer' could not be found` | **Plan 3 has not landed.** The prerequisite check above should have caught this | **Stop.** Do not declare the ports here — that is the duplicate-member collision contract §17 warns about |
| A Shouldly assertion failure naming a member | Plan 3 landed a **different** shape — most likely the dead `IDerivedDataRecomputer` / `IOperationalAlertSink` names, or `RecomputeAsync(IReadOnlyList<MeteringPointDay>, …)`, which contract §7.6 retires in so many words | Reconcile plan 3's file to the shapes in steps 3 and 4, which are contract §7.6 verbatim |

- [ ] **Step 3: The shape `IDayStateRecomputer` must carry — contract §7.6, verbatim**

This is **plan 3's file**, restated here so a reconciliation in step 2's third row has an exact
target and does not become a negotiation. If step 2 passed, read it and change nothing.

`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/Ingestion/IDayStateRecomputer.cs`:

```csharp
using PeakPower.Domain.Metering;

namespace PeakPower.Application.Abstractions.Ingestion;

/// <summary>
/// Recomputes the materialised data state and the daily rollup for one (metering point, delivery
/// date). Shared contract §9.6 step 7 calls this from inside the apply transaction, and the
/// <c>[F02-R34]</c> promotion is why "inside" is a requirement rather than a preference.
/// </summary>
/// <remarks>
/// <para>
/// <b>It opens no transaction of its own.</b> It writes through the caller's
/// <c>PeakPowerDbContext</c>, so whatever transaction the caller has open is the one that commits
/// the day state, the daily position, the promoted metering point and the interval readings
/// together. A recomputer that opened its own transaction would commit a promotion whose readings
/// then rolled back, which is the state <c>ck_mp_never_has_no_observed_production</c> exists to
/// make unstorable.
/// </para>
/// <para>
/// <b>Completeness here is a DAY question, not a document question.</b> Integration-spec §8.3:
/// §8.1 and §8.2 validate a document; this evaluates a (metering point, delivery date) after the
/// document has been applied, because under <c>[DEC-38]</c> the day's data may arrive in more than
/// one document and under <c>[DEC-65]</c> one of the expected series may never arrive at all.
/// </para>
/// </remarks>
public interface IDayStateRecomputer
{
    Task<DayRecomputeResult> RecomputeAsync(DayRecomputeRequest request, CancellationToken ct);
}

/// <param name="MeteringPointId">The point whose day is being recomputed.</param>
/// <param name="DeliveryDate">The Amsterdam calendar day the readings are for.</param>
/// <param name="CorrelationId">
/// Stamped at receipt by the webhook and carried through queue, adapter and apply. It goes on the
/// logger scope here so a day-state change can be traced back to the POST that caused it.
/// </param>
/// <param name="NewVersionReceivedAt">
/// The receipt time of the version this recompute follows, or <c>null</c> when nothing new landed.
/// <para>
/// ⚠ <b>This is the reopen switch.</b> <c>[DEC-98]</c> makes <c>FINAL</c> a status rather than a
/// guarantee, so a post-window version returns the date to <c>PROVISIONAL</c> and re-finalises
/// <c>[F02-R45]</c>. A replay that produced no new version <c>[F02-R27]</c>, or a maintenance
/// sweep, must leave a finalised date exactly as it found it. Passing a non-null value on a
/// no-change replay reopens dates for no reason; passing null after a real version leaves a stale
/// <c>FINAL</c> on a date that has just changed. Both are silent.
/// </para>
/// </param>
public sealed record DayRecomputeRequest(
    Guid MeteringPointId,
    DateOnly DeliveryDate,
    Guid CorrelationId,
    DateTimeOffset? NewVersionReceivedAt);

/// <summary>
/// What the recompute decided. Returned rather than left in the database because the apply
/// transaction logs it, the replay endpoint reports it and the tests assert on it — and reading it
/// back out of the row would not prove the row was written by this call.
/// </summary>
/// <param name="State">NO_DATA, PARTIAL, PROVISIONAL or FINAL. There is no COMPLETE.</param>
/// <param name="ExpectedIntervalCount">92, 96 or 100, from <c>IMarketCalendar</c>.</param>
/// <param name="ConsumptionComplete">The A02 series is present with the full expected count.</param>
/// <param name="ProductionComplete">
/// The A01 series is present with the full expected count, <b>or</b> production is a declared zero.
/// </param>
/// <param name="ProductionIsDeclaredZero">
/// <c>production_expectation = 'NEVER'</c> <c>[F02-R33]</c>. The production line reads as a stated
/// zero traceable to its source, setter and date — not as an absence.
/// </param>
/// <param name="ProductionExpectationPromoted">
/// <c>[F02-R34]</c> fired: an A01 series arrived for a point recorded NEVER, so the point moved to
/// EXPECTED with source OBSERVED in this same transaction.
/// </param>
/// <param name="ReopenedFromFinal">
/// The date was FINAL and a newer version returned it to PROVISIONAL. Routine, not an alarm.
/// </param>
public sealed record DayRecomputeResult(
    MeteringDayState State,
    short ExpectedIntervalCount,
    bool ConsumptionComplete,
    bool ProductionComplete,
    bool ProductionIsDeclaredZero,
    bool ProductionExpectationPromoted,
    bool ReopenedFromFinal,
    decimal ConsumptionKwh,
    decimal ProductionKwh,
    decimal NetUsageKwh,
    decimal OfftakeKwh,
    decimal ExportKwh);
```

- [ ] **Step 4: The shape `IOperationalAlertRaiser` must carry — contract §7.6, verbatim**

Also plan 3's file. Same rule: read it, and reconcile only if step 2 named a member.

`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/Ingestion/IOperationalAlertRaiser.cs`:

```csharp
using PeakPower.Domain.Metering;

namespace PeakPower.Application.Abstractions.Ingestion;

/// <summary>
/// Writes the <b>conditions</b> of <c>[F02-R12]</c>, <c>[F02-R26]</c>, <c>[F02-R34]</c>,
/// <c>[F02-R35]</c> and <c>[F02-R45]</c> into <c>metering.operational_alert</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>No channel delivers them, and that is a decision rather than an omission</b> (design §3.2).
/// The conditions are built and tested; the employee data-health screens render the rows; no mail,
/// pager or webhook is wired. <c>[DEC-104]</c> is one operator with no rota, so a channel with no
/// rota behind it is decoration. Design §1.1 records that this is why the Phase-1 exit criterion
/// "ingestion alerting proven by a deliberate outage test" is not met.
/// </para>
/// <para>
/// <b>Raising is idempotent by (kind, metering point, delivery date) while an alert is open.</b> A
/// PARTIAL day is recomputed every time a document touches it, and a silent point is swept on every
/// schedule tick; without the dedupe the table would hold one row per sweep and the employee screen
/// would be unreadable within a day.
/// </para>
/// </remarks>
public interface IOperationalAlertRaiser
{
    /// <returns><c>true</c> if a row was written; <c>false</c> if an equivalent alert was already open.</returns>
    Task<bool> RaiseAsync(OperationalAlertRequest request, CancellationToken ct);

    /// <param name="deliveryDate">
    /// <c>null</c> resolves every open alert of that kind for that point, whatever date each names —
    /// which is what silence recovery wants, because a point that went quiet and came back is one
    /// recovery and not one per day it missed. A non-null value resolves only that day's, which is
    /// what a day completing wants: one day filling in says nothing about another day that is still
    /// short.
    /// </param>
    /// <returns>How many open alerts were resolved.</returns>
    Task<int> ResolveOpenAsync(
        OperationalAlertKind kind,
        Guid meteringPointId,
        DateOnly? deliveryDate,
        DateTimeOffset resolvedAt,
        CancellationToken ct);
}

/// <param name="Summary">
/// One sentence, sentence case, ending with a full stop. Slice 1's copy rules bind here: no emoji,
/// no icon set, and every number carries its provenance.
/// </param>
/// <param name="RaisedAt">
/// Supplied by the caller, never read from a clock here — architecture fact 5 puts the only clock
/// in <c>PeakPower.Infrastructure.Time</c>, and this type lives in <c>PeakPower.Application</c>.
/// </param>
public sealed record OperationalAlertRequest(
    OperationalAlertKind Kind,
    string Summary,
    string? Detail,
    Guid? MeteringPointId,
    Guid? BrpId,
    Guid? InboundMessageId,
    DateOnly? DeliveryDate,
    DateTimeOffset RaisedAt);
```

- [ ] **Step 5: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~RollupPortShapeTests"
```

Expected: PASS — 5 tests.

- [ ] **Step 6: Verify by mutation that the shape test has teeth**

Rename `DayRecomputeRequest.NewVersionReceivedAt` to `ReceivedAt` in **plan 3's**
`src/Core/PeakPower.Application/Abstractions/Ingestion/IDayStateRecomputer.cs` and re-run the filter.

Predict: `A_recompute_request_can_say_that_nothing_new_arrived` fails with
`property.ShouldNotBeNull() ... but was null`.

Watch it go red, confirm the message is that one, then restore the name. ⚠ Restore it exactly —
this is another plan's file and it must leave this task byte-identical to how it arrived.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git status --porcelain src/Core/PeakPower.Application/Abstractions/Ingestion/
# Expect NO output. Anything listed means step 6's mutation was not restored, or step 2's third
# row was hit and plan 3's declaration was reconciled - in which case say so in the message below.
git add tests/PeakPower.Application.Tests/Ingestion/RollupPortShapeTests.cs
git commit -m "Pin the shape of the two ports plan 3 declared for this plan to implement

Shared contract 7.6 gives IDayStateRecomputer and IOperationalAlertRaiser to plan 3 to DECLARE
and to this plan to IMPLEMENT, because plan 3 codes against them first and its NoOp stand-ins
keep it compiling until the real ones land. This adds no declaration - it adds the shape test
that fails in THIS repository if that declaration drifts, which is the failure eight plans
written in parallel cannot otherwise see.

DayRecomputeRequest.NewVersionReceivedAt is nullable on purpose: DEC-98 makes a post-window
version reopen a FINAL date, and a replay that changed nothing must not. Verified by mutation -
renaming that property turns the shape test red on the assertion written for it."
```

---

### Task 2: `DayCompleteness` — the completeness rule, and the test that fails against `directions.Count == 2`

**This is the single highest-value test in the slice.** Integration-spec §8.3 names the prohibited
implementation literally — *"This check must not be written as `directions.Count == 2`"* — and says
what happens when it is: **every non-producing connection stops invoicing and the cause looks like a
PVNed fault.** Design §10.1 requires a test that **fails** against that implementation, verified by
writing it and watching it go red. Step 9 below is that verification and it is not optional.

The rule, transcribed from integration-spec §8.3's table:

| Condition | Result |
| --- | --- |
| `A02` present with the expected interval count and `production_expectation = 'NEVER'` | **Complete.** Production is a declared zero `[F02-R33]` |
| `A02` and `A01` both present with the expected count | **Complete**, whatever the expectation says |
| `EXPECTED` and `A01` absent, or short of the expected count | **`PARTIAL`** — alert naming **PVNed** first `[F02-R35]` |
| `UNKNOWN` and `A01` absent | **`PARTIAL`** — treated as `EXPECTED`, but the alert names the **missing customer declaration** `[DEC-112]` |
| `A02` absent or short | **`PARTIAL`** regardless of the expectation |

⚠ **`UNKNOWN` reads as `EXPECTED`, and the asymmetry is deliberate.** `[F02-R32]`: the alternative is
invoicing a producing site on consumption alone. A false alarm is recoverable; a hidden gap that
reaches an invoice is not.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Ingestion/DayCompleteness.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/DayCompletenessTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Domain.Customers.ProductionExpectation`, `PeakPower.Domain.Metering.MeteringDayState`.
- Produces:
  - `PeakPower.Application.Ingestion.DayCompleteness` with
    `static DayCompletenessResult Evaluate(DayCompletenessInput input)` and
    `static bool ProductionSeriesIsRequired(ProductionExpectation expectation)`
  - `DayCompletenessInput(int ExpectedIntervalCount, bool ConsumptionVersionPresent, int ConsumptionPointCount, bool ProductionVersionPresent, int ProductionPointCount, ProductionExpectation ProductionExpectation)`
  - `DayCompletenessResult(bool ConsumptionComplete, bool ProductionComplete, bool ProductionIsDeclaredZero, bool ProductionSeriesRequired, bool Complete, MeteringDayState State)`

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/DayCompletenessTests.cs`:

```csharp
using PeakPower.Application.Ingestion;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion;

/// <summary>
/// Integration-spec §8.3, in full, as a table.
/// <para>
/// <b>The most important test in slice 2 is <see cref="A_never_point_with_only_a_consumption_series_is_complete"/>.</b>
/// [DEC-65] was raised to stop this check being written as <c>directions.Count == 2</c>, and
/// integration-spec §8.3 names that line literally. Applied, it holds every non-producing
/// connection at PARTIAL forever and blocks its invoicing — and because PVNed genuinely sends no
/// A01 series for a connection that never produces, the symptom looks like a supplier fault rather
/// than like our bug. Design §10.1 requires this test to be mutation-verified against exactly that
/// implementation.
/// </para>
/// </summary>
public sealed class DayCompletenessTests
{
    private const int Normal = 96;

    private static DayCompletenessInput Day(
        ProductionExpectation expectation,
        int consumptionPoints,
        int? productionPoints,
        int expected = Normal) =>
        new(
            ExpectedIntervalCount: expected,
            ConsumptionVersionPresent: consumptionPoints >= 0,
            ConsumptionPointCount: Math.Max(consumptionPoints, 0),
            ProductionVersionPresent: productionPoints is not null,
            ProductionPointCount: productionPoints ?? 0,
            ProductionExpectation: expectation);

    // ── The row [DEC-65] exists for ────────────────────────────────────────────────────────

    /// <summary>
    /// Integration-spec §8.3 row 1. PVNed sends NO A01 series at all for a connection that never
    /// produces — the series is absent, not present-and-zero — so "both directions present" is
    /// not merely a poor test, it is a test this day can never pass.
    /// </summary>
    [Fact]
    public void A_never_point_with_only_a_consumption_series_is_complete()
    {
        var result = DayCompleteness.Evaluate(
            Day(ProductionExpectation.Never, consumptionPoints: 96, productionPoints: null));

        result.ProductionSeriesRequired.ShouldBeFalse();
        result.ProductionIsDeclaredZero.ShouldBeTrue();
        result.ConsumptionComplete.ShouldBeTrue();
        result.ProductionComplete.ShouldBeTrue();
        result.Complete.ShouldBeTrue();
        result.State.ShouldBe(MeteringDayState.Provisional);
    }

    // ── The rest of §8.3's table ───────────────────────────────────────────────────────────

    [Fact]
    public void Both_directions_present_and_full_is_complete_whatever_the_expectation_says()
    {
        foreach (var expectation in Enum.GetValues<ProductionExpectation>())
        {
            var result = DayCompleteness.Evaluate(
                Day(expectation, consumptionPoints: 96, productionPoints: 96));

            result.Complete.ShouldBeTrue($"{expectation} with both full series");
            result.State.ShouldBe(MeteringDayState.Provisional);
        }
    }

    [Fact]
    public void An_expected_point_with_no_production_series_stays_partial()
    {
        var result = DayCompleteness.Evaluate(
            Day(ProductionExpectation.Expected, consumptionPoints: 96, productionPoints: null));

        result.ProductionSeriesRequired.ShouldBeTrue();
        result.ProductionIsDeclaredZero.ShouldBeFalse();
        result.ProductionComplete.ShouldBeFalse();
        result.Complete.ShouldBeFalse();
        result.State.ShouldBe(MeteringDayState.Partial);
    }

    /// <summary>
    /// [F02-R32], confirmed by [DEC-112]: UNKNOWN is read as EXPECTED. The conservative direction,
    /// because the alternative is invoicing a producing site on consumption alone.
    /// </summary>
    [Fact]
    public void An_unknown_point_is_treated_exactly_as_an_expected_one()
    {
        var unknown = DayCompleteness.Evaluate(
            Day(ProductionExpectation.Unknown, consumptionPoints: 96, productionPoints: null));
        var expected = DayCompleteness.Evaluate(
            Day(ProductionExpectation.Expected, consumptionPoints: 96, productionPoints: null));

        unknown.ProductionSeriesRequired.ShouldBe(expected.ProductionSeriesRequired);
        unknown.ProductionComplete.ShouldBe(expected.ProductionComplete);
        unknown.Complete.ShouldBe(expected.Complete);
        unknown.State.ShouldBe(expected.State);
    }

    [Fact]
    public void An_expected_point_with_a_short_production_series_stays_partial()
    {
        var result = DayCompleteness.Evaluate(
            Day(ProductionExpectation.Expected, consumptionPoints: 96, productionPoints: 95));

        result.ProductionComplete.ShouldBeFalse();
        result.State.ShouldBe(MeteringDayState.Partial);
    }

    [Fact]
    public void A_short_consumption_series_is_partial_whatever_the_expectation_says()
    {
        foreach (var expectation in Enum.GetValues<ProductionExpectation>())
        {
            var result = DayCompleteness.Evaluate(
                Day(expectation, consumptionPoints: 95, productionPoints: 96));

            result.ConsumptionComplete.ShouldBeFalse($"{expectation} with a 95-point A02");
            result.Complete.ShouldBeFalse();
            result.State.ShouldBe(MeteringDayState.Partial);
        }
    }

    [Fact]
    public void A_missing_consumption_series_is_partial_even_for_a_never_point()
    {
        var result = DayCompleteness.Evaluate(
            new DayCompletenessInput(
                ExpectedIntervalCount: Normal,
                ConsumptionVersionPresent: false,
                ConsumptionPointCount: 0,
                ProductionVersionPresent: true,
                ProductionPointCount: 96,
                ProductionExpectation: ProductionExpectation.Never));

        result.ConsumptionComplete.ShouldBeFalse();
        result.Complete.ShouldBeFalse();
        result.State.ShouldBe(MeteringDayState.Partial);
    }

    [Fact]
    public void Neither_series_present_is_no_data_rather_than_partial()
    {
        var result = DayCompleteness.Evaluate(
            new DayCompletenessInput(
                ExpectedIntervalCount: Normal,
                ConsumptionVersionPresent: false,
                ConsumptionPointCount: 0,
                ProductionVersionPresent: false,
                ProductionPointCount: 0,
                ProductionExpectation: ProductionExpectation.Never));

        result.Complete.ShouldBeFalse();
        // NO_DATA and PARTIAL are different answers to different questions: nothing has arrived,
        // versus something has arrived and it is not enough. The chart and the employee heat map
        // both draw them differently, and F02 §6's state machine has a separate edge for each.
        result.State.ShouldBe(MeteringDayState.NoData);
    }

    // ── The counts are the date's, not 96 ──────────────────────────────────────────────────

    [Theory]
    [InlineData(92)]
    [InlineData(96)]
    [InlineData(100)]
    public void The_expected_count_comes_from_the_date_and_a_full_day_matches_it(int expected)
    {
        var result = DayCompleteness.Evaluate(
            Day(ProductionExpectation.Never, consumptionPoints: expected, productionPoints: null, expected: expected));

        result.ConsumptionComplete.ShouldBeTrue();
        result.Complete.ShouldBeTrue();
    }

    /// <summary>
    /// A 96-point document on a 100-point autumn day is short, and on a 92-point spring day it is
    /// over-length. Design §7.10 requires both to be caught; the adapter rejects the document
    /// under integration-spec §8.2's point-count rule, and this is the day-level backstop.
    /// </summary>
    [Theory]
    [InlineData(100, 96)]
    [InlineData(92, 96)]
    public void A_ninety_six_point_day_is_not_complete_on_a_DST_date(int expected, int supplied)
    {
        var result = DayCompleteness.Evaluate(
            Day(ProductionExpectation.Never, consumptionPoints: supplied, productionPoints: null, expected: expected));

        result.ConsumptionComplete.ShouldBeFalse();
        result.Complete.ShouldBeFalse();
        result.State.ShouldBe(MeteringDayState.Partial);
    }

    // ── The predicate on its own ───────────────────────────────────────────────────────────

    [Theory]
    [InlineData(ProductionExpectation.Never, false)]
    [InlineData(ProductionExpectation.Expected, true)]
    [InlineData(ProductionExpectation.Unknown, true)]
    public void Only_a_never_point_is_excused_the_production_series(
        ProductionExpectation expectation, bool required) =>
        DayCompleteness.ProductionSeriesIsRequired(expectation).ShouldBe(required);
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~DayCompletenessTests"
```

Expected: FAIL — build error
`error CS0234: The type or namespace name 'Ingestion' does not exist in the namespace 'PeakPower.Application'`.

- [ ] **Step 3: Write `DayCompleteness`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Ingestion/DayCompleteness.cs`:

```csharp
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;

namespace PeakPower.Application.Ingestion;

/// <summary>What is known about one (metering point, delivery date) after a document was applied.</summary>
/// <param name="ExpectedIntervalCount">
/// 92, 96 or 100 for that date, from <c>IMarketCalendar.ExpectedIntervalCount</c>. Never assumed.
/// </param>
/// <param name="ConsumptionVersionPresent">A current A02 version exists for this (point, date).</param>
/// <param name="ConsumptionPointCount">How many readings that version actually holds.</param>
/// <param name="ProductionVersionPresent">A current A01 version exists for this (point, date).</param>
/// <param name="ProductionPointCount">How many readings that version actually holds.</param>
/// <param name="ProductionExpectation">
/// The metering point's recorded expectation <b>after</b> any <c>[F02-R34]</c> promotion this
/// transaction performed. Passing the pre-promotion value would mark a point that has just been
/// proven to produce as a declared zero.
/// </param>
public readonly record struct DayCompletenessInput(
    int ExpectedIntervalCount,
    bool ConsumptionVersionPresent,
    int ConsumptionPointCount,
    bool ProductionVersionPresent,
    int ProductionPointCount,
    ProductionExpectation ProductionExpectation);

/// <param name="ProductionComplete">
/// True when the A01 series is full <b>or</b> production is a declared zero. The disjunction is the
/// whole of <c>[DEC-65]</c>.
/// </param>
/// <param name="Complete">
/// Integration-spec §8.3's word. ⚠ It is a <b>condition</b>, not a state: it is what moves a day to
/// <see cref="MeteringDayState.Provisional"/>. There is no COMPLETE member of
/// <see cref="MeteringDayState"/> and adding one breaks the day-state column CHECK.
/// </param>
public readonly record struct DayCompletenessResult(
    bool ConsumptionComplete,
    bool ProductionComplete,
    bool ProductionIsDeclaredZero,
    bool ProductionSeriesRequired,
    bool Complete,
    MeteringDayState State);

/// <summary>
/// Integration-spec §8.3 — day completeness, judged against master data and <b>never</b> against
/// "both directions present".
/// </summary>
/// <remarks>
/// <para>
/// ⚠ <b>This must never be written as <c>directions.Count == 2</c>.</b> Integration-spec §8.3 names
/// that line literally, and <c>[DEC-65]</c> was raised to prevent it. PVNed sends no A01 series at
/// all for a connection that never produces — absent, not present-and-zero — so the count test
/// holds every non-producing connection at PARTIAL forever and blocks its invoicing. It fails
/// <i>silently</i>: the data looks like a supplier that stopped sending, so the investigation
/// starts at PVNed and never reaches this file.
/// </para>
/// <para>
/// <b>The two rows that are byte-identical on the wire</b> (integration-spec §4.1.1) are "A02
/// present, A01 absent, connection does not produce" and "A02 present, A01 absent, connection does
/// produce". Nothing in the document, the header or the code lists separates them. The
/// discriminator can only be master data, which is why this function takes
/// <see cref="DayCompletenessInput.ProductionExpectation"/> and not a list of directions.
/// </para>
/// <para>
/// It is a pure function on purpose: no database, no clock, no logger. That is what lets the case
/// that matters most be asserted in a millisecond, and what makes design §10.1's mutation cheap
/// enough to actually run.
/// </para>
/// </remarks>
public static class DayCompleteness
{
    /// <summary>
    /// <c>[F02-R32]</c>. Only <c>NEVER</c> excuses the A01 series. <c>UNKNOWN</c> is treated as
    /// <c>EXPECTED</c> — the conservative reading, because the alternative is invoicing a producing
    /// site on consumption alone. Confirmed by <c>[DEC-112]</c>, which gave the declaration an
    /// owner without changing the reading.
    /// </summary>
    public static bool ProductionSeriesIsRequired(ProductionExpectation expectation) =>
        expectation is not ProductionExpectation.Never;

    public static DayCompletenessResult Evaluate(DayCompletenessInput input)
    {
        var expected = input.ExpectedIntervalCount;

        // Present AND full. A version with 95 of 96 readings is not a complete series, and the
        // equality is deliberate on both sides: a 96-point document for a 92-point spring date is
        // over-length, and design §7.10 requires that to be caught as well as the short case.
        var consumptionComplete =
            input.ConsumptionVersionPresent && input.ConsumptionPointCount == expected;

        var productionSeriesRequired = ProductionSeriesIsRequired(input.ProductionExpectation);
        var productionIsDeclaredZero = !productionSeriesRequired;

        var productionSeriesFull =
            input.ProductionVersionPresent && input.ProductionPointCount == expected;

        // [DEC-65] in one line. A declared zero is COMPLETE production, not absent production:
        // [F02-R33] makes production zero for every interval of that date, traceable to its
        // source, setter and date [F01-R40].
        var productionComplete = productionIsDeclaredZero || productionSeriesFull;

        var complete = consumptionComplete && productionComplete;

        var anythingArrived = input.ConsumptionVersionPresent || input.ProductionVersionPresent;

        var state = anythingArrived
            ? complete ? MeteringDayState.Provisional : MeteringDayState.Partial
            : MeteringDayState.NoData;

        return new DayCompletenessResult(
            ConsumptionComplete: consumptionComplete,
            ProductionComplete: productionComplete,
            ProductionIsDeclaredZero: productionIsDeclaredZero,
            ProductionSeriesRequired: productionSeriesRequired,
            Complete: complete,
            State: state);
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~DayCompletenessTests"
```

Expected: PASS — 12 test cases (three theories expand).

- [ ] **Step 5: Commit the rule before mutating it**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Application/Ingestion/DayCompleteness.cs \
        tests/PeakPower.Application.Tests/Ingestion/DayCompletenessTests.cs
git commit -m "Judge day completeness against production_expectation, never against two directions

Integration-spec 8.3 names the prohibited implementation literally - directions.Count == 2 -
and says what it costs: every non-producing connection stops invoicing and the cause looks
like a PVNed fault. PVNed sends no A01 series at all for a connection that never produces,
so the two wire cases that matter are byte-identical and the discriminator can only be
master data. UNKNOWN reads as EXPECTED per F02-R32, confirmed by DEC-112.

The next commit records the mutation this rule was verified against."
```

- [ ] **Step 6: MUTATION 1 of design §10 — write `directions.Count == 2` and predict the failure**

This is design §10.1 and §7.8, and it is the highest-value mutation in the slice. **Predict first,
then run.**

Replace the body of `Evaluate` in
`src/Core/PeakPower.Application/Ingestion/DayCompleteness.cs` with the forbidden implementation —
the one an implementer reaches for when they have not read `[DEC-65]`:

```csharp
    public static DayCompletenessResult Evaluate(DayCompletenessInput input)
    {
        // MUTATION - the implementation integration-spec §8.3 forbids by name. DO NOT KEEP.
        var directions = 0;
        if (input.ConsumptionVersionPresent) { directions++; }
        if (input.ProductionVersionPresent) { directions++; }

        var complete = directions == 2;

        var anythingArrived = directions > 0;
        var state = anythingArrived
            ? complete ? MeteringDayState.Provisional : MeteringDayState.Partial
            : MeteringDayState.NoData;

        return new DayCompletenessResult(
            ConsumptionComplete: input.ConsumptionVersionPresent,
            ProductionComplete: input.ProductionVersionPresent,
            ProductionIsDeclaredZero: false,
            ProductionSeriesRequired: true,
            Complete: complete,
            State: state);
    }
```

**Predicted failure**, before running anything:

`DayCompletenessTests.A_never_point_with_only_a_consumption_series_is_complete` fails on the first
assertion it reaches:

```
Shouldly.ShouldAssertException : result.ProductionSeriesRequired
    should be
False
    but was
True
```

and, with that assertion removed, the day would reach `MeteringDayState.Partial` where the test
demands `Provisional` — which is exactly the "every non-producing connection stops invoicing"
failure, reproduced.

- [ ] **Step 7: Run it and watch it go red**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~DayCompletenessTests"
```

Expected: FAIL. **Check the failure is the one predicted in step 6**, on
`A_never_point_with_only_a_consumption_series_is_complete`, and note which other cases also went
red: `Only_a_never_point_is_excused_the_production_series`,
`A_missing_consumption_series_is_partial_even_for_a_never_point`,
`A_ninety_six_point_day_is_not_complete_on_a_DST_date` (the count test disappeared entirely),
`A_short_consumption_series_is_partial_whatever_the_expectation_says` and
`The_expected_count_comes_from_the_date_and_a_full_day_matches_it`.

⚠ **If the `NEVER` case did not go red, the mutation did not land** — check you replaced `Evaluate`
and not a neighbour. The whole point of design §10.1 is that this specific case must be the one that
catches it.

- [ ] **Step 8: Restore the real implementation and watch it go green**

Restore `Evaluate` to the version from step 3.

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git checkout src/Core/PeakPower.Application/Ingestion/DayCompleteness.cs
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~DayCompletenessTests"
```

Expected: PASS — 12 test cases.

- [ ] **Step 9: Record the mutation in the repository, not only in this plan**

A mutation nobody can find later is a mutation nobody can repeat. Append the record to the test
file's class doc comment so it sits beside the assertion it certifies.

Edit
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/DayCompletenessTests.cs`,
replacing the closing `/// </summary>` of the class doc comment with:

```csharp
/// <para>
/// <b>Mutation-verified 2026-09-07, design §10 row 1.</b> <c>DayCompleteness.Evaluate</c> was
/// replaced with <c>directions.Count == 2</c> — counting the present directions and requiring two.
/// <see cref="A_never_point_with_only_a_consumption_series_is_complete"/> went red on
/// <c>result.ProductionSeriesRequired should be False but was True</c>, and the day fell to PARTIAL
/// where it must reach PROVISIONAL. Five further cases went red with it, because the mutation also
/// discards the interval-count comparison. Restored and green.
/// </para>
/// </summary>
```

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
git add tests/PeakPower.Application.Tests/Ingestion/DayCompletenessTests.cs
git commit -m "Record the directions.Count == 2 mutation the completeness rule was verified against

Design section 10 row 1 requires this one explicitly. Written, run, watched red on the NEVER
plus A02-only day - ProductionSeriesRequired should be False but was True, and the day fell to
PARTIAL where integration-spec 8.3 says it is complete. Five further cases went red because the
forbidden implementation also throws away the interval-count comparison. Restored and green.

The record sits on the test class rather than only in the plan, so the next person can repeat it
without finding the plan first."
```

---

### Task 3: `DailyPositionCalculator` — design §4.1's five accumulators, per interval

Design §4.1 is worth reading twice, because the naive reading says this table is unnecessary and the
naive reading is half right. **Σ(cᵢ − pᵢ) is arithmetically identical to Σc − Σp**, so the daily *net*
figure survives a daily-totals rollup intact. What does **not** survive is everything that clamps per
interval: Phase 2's coverage maths is built on `max(U, 0)` per interval, and `[DEC-23]` settles the
negative part as a **separate sale line, never netted against purchase lines** — "uncovered and
surplus volumes occur at different times and therefore at different prices".

Design §4.1's worked case, which is the fixture below verbatim:

> A day of two intervals with consumption `[10, 0]` and production `[0, 5]`.
> Per interval, `U = [10, −5]`, so `Σ max(U,0) = 10` and the export volume is **5**.
> From daily totals alone, `Σc − Σp = 5`, and `max(5, 0) = 5`. The two disagree, and the second
> **discards the export entirely**.

⚠ **Missing propagates.** Position-and-coverage §2.1: "If either the consumption or the production
interval is missing, `netUsage` for that interval is **missing**, not the other series' value. A
derived figure is never more complete than its least complete input." An interval where only
consumption arrived contributes to `consumption_kwh` and to **nothing else**.

⚠ **A declared zero is not missing.** Where `production_expectation` is `NEVER`, production is `0` for
every interval `[F02-R33]`, so every interval with a consumption reading has a full net-usage pair.
That distinction is one boolean in this function and the whole of `[DEC-65]` behind it.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Ingestion/DailyPositionCalculator.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/DailyPositionCalculatorTests.cs`

**Interfaces:**
- Consumes: nothing outside the BCL.
- Produces:
  - `PeakPower.Application.Ingestion.IntervalPoint(short Pos, decimal QuantityKwh)`
  - `PeakPower.Application.Ingestion.DailyPositionTotals(decimal ConsumptionKwh, decimal ProductionKwh, decimal NetUsageKwh, decimal OfftakeKwh, decimal ExportKwh, int IntervalsWithBothSeries)`
  - `PeakPower.Application.Ingestion.DailyPositionCalculator` with
    `static DailyPositionTotals Accumulate(IReadOnlyList<IntervalPoint> consumption, IReadOnlyList<IntervalPoint> production, bool productionIsDeclaredZero, int expectedIntervalCount)`

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/DailyPositionCalculatorTests.cs`:

```csharp
using PeakPower.Application.Ingestion;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion;

/// <summary>
/// Design §4.1 — the rollup shape, and why the offtake and export accumulators cannot be recovered
/// from the daily totals.
/// <para>
/// The arithmetic that makes this subtle: Σ(cᵢ − pᵢ) really is Σc − Σp, so the daily NET figure
/// survives a daily-totals rollup intact and a reader who checks only that will conclude this table
/// is over-engineered. What does not survive is everything that clamps per interval — Phase 2's
/// coverage maths is built on max(U, 0), and [DEC-23] settles the negative part as a separate sale
/// line that is never netted against purchases, because "uncovered and surplus volumes occur at
/// different times and therefore at different prices".
/// </para>
/// </summary>
public sealed class DailyPositionCalculatorTests
{
    private static IReadOnlyList<IntervalPoint> Points(params (int Pos, decimal Kwh)[] points) =>
        [.. points.Select(point => new IntervalPoint((short)point.Pos, point.Kwh))];

    /// <summary>
    /// Design §4.1's worked case, transcribed. Two intervals: consumption [10, 0], production [0, 5].
    /// Per interval U = [10, −5]. Offtake 10, export 5, net 5.
    /// From daily totals alone the answer would be offtake 5 and export 0 — and the second figure
    /// is a volume the customer is owed money for.
    /// </summary>
    [Fact]
    public void The_worked_case_from_design_4_1()
    {
        var totals = DailyPositionCalculator.Accumulate(
            consumption: Points((1, 10m), (2, 0m)),
            production: Points((1, 0m), (2, 5m)),
            productionIsDeclaredZero: false,
            expectedIntervalCount: 2);

        totals.ConsumptionKwh.ShouldBe(10.000m);
        totals.ProductionKwh.ShouldBe(5.000m);
        totals.NetUsageKwh.ShouldBe(5.000m);

        // The two figures a daily-totals rollup gets wrong. These are the assertions design §10
        // row 4 requires to be mutation-verified.
        totals.OfftakeKwh.ShouldBe(10.000m);
        totals.ExportKwh.ShouldBe(5.000m);

        totals.IntervalsWithBothSeries.ShouldBe(2);
    }

    /// <summary>
    /// The identity that makes the mutation tempting, asserted so nobody "fixes" the calculator by
    /// deriving offtake from the net total: the NET figure is the same either way. It is the
    /// clamped pair that differs.
    /// </summary>
    [Fact]
    public void The_net_total_agrees_with_the_daily_subtraction_even_though_offtake_does_not()
    {
        var totals = DailyPositionCalculator.Accumulate(
            consumption: Points((1, 10m), (2, 0m)),
            production: Points((1, 0m), (2, 5m)),
            productionIsDeclaredZero: false,
            expectedIntervalCount: 2);

        var fromDailyTotals = totals.ConsumptionKwh - totals.ProductionKwh;

        totals.NetUsageKwh.ShouldBe(fromDailyTotals);
        totals.OfftakeKwh.ShouldNotBe(Math.Max(fromDailyTotals, 0m));
        totals.ExportKwh.ShouldNotBe(Math.Max(-fromDailyTotals, 0m));
    }

    [Fact]
    public void A_day_that_only_ever_imports_has_no_export()
    {
        var totals = DailyPositionCalculator.Accumulate(
            consumption: Points((1, 4m), (2, 6m), (3, 2m)),
            production: Points((1, 1m), (2, 1m), (3, 1m)),
            productionIsDeclaredZero: false,
            expectedIntervalCount: 3);

        totals.ConsumptionKwh.ShouldBe(12.000m);
        totals.ProductionKwh.ShouldBe(3.000m);
        totals.NetUsageKwh.ShouldBe(9.000m);
        totals.OfftakeKwh.ShouldBe(9.000m);
        totals.ExportKwh.ShouldBe(0.000m);
    }

    [Fact]
    public void A_day_that_exports_overall_carries_a_negative_net_usage()
    {
        // [DEC-22] records that net usage MAY be negative, and [DEC-23] settles it as export.
        var totals = DailyPositionCalculator.Accumulate(
            consumption: Points((1, 1m), (2, 1m)),
            production: Points((1, 4m), (2, 6m)),
            productionIsDeclaredZero: false,
            expectedIntervalCount: 2);

        totals.NetUsageKwh.ShouldBe(-8.000m);
        totals.OfftakeKwh.ShouldBe(0.000m);
        totals.ExportKwh.ShouldBe(8.000m);
    }

    // ── Missing propagates ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// Position-and-coverage §2.1: if either side of an interval is missing, netUsage for that
    /// interval is MISSING, not the other series' value. Interval 2 here has consumption and no
    /// production, so it contributes 7 to consumption_kwh and nothing to net, offtake or export.
    /// </summary>
    [Fact]
    public void An_interval_with_only_one_series_contributes_to_that_series_and_to_nothing_derived()
    {
        var totals = DailyPositionCalculator.Accumulate(
            consumption: Points((1, 10m), (2, 7m)),
            production: Points((1, 4m)),
            productionIsDeclaredZero: false,
            expectedIntervalCount: 2);

        totals.ConsumptionKwh.ShouldBe(17.000m);
        totals.ProductionKwh.ShouldBe(4.000m);

        // NOT 13. Interval 2's net usage is unknown, and an unknown is not a six.
        totals.NetUsageKwh.ShouldBe(6.000m);
        totals.OfftakeKwh.ShouldBe(6.000m);
        totals.ExportKwh.ShouldBe(0.000m);
        totals.IntervalsWithBothSeries.ShouldBe(1);
    }

    [Fact]
    public void An_interval_with_only_production_contributes_to_production_alone()
    {
        var totals = DailyPositionCalculator.Accumulate(
            consumption: Points((1, 10m)),
            production: Points((1, 4m), (2, 9m)),
            productionIsDeclaredZero: false,
            expectedIntervalCount: 2);

        totals.ConsumptionKwh.ShouldBe(10.000m);
        totals.ProductionKwh.ShouldBe(13.000m);
        totals.NetUsageKwh.ShouldBe(6.000m);
        totals.IntervalsWithBothSeries.ShouldBe(1);
    }

    // ── The declared zero ──────────────────────────────────────────────────────────────────

    /// <summary>
    /// [F02-R33] and [DEC-65]. A NEVER connection has no A01 series at all, and that is not a
    /// missing interval — production is structurally zero, so every consumption interval has a
    /// complete net-usage pair. Getting this wrong makes a whole day's net usage unknown and the
    /// customer's chart empty.
    /// </summary>
    [Fact]
    public void A_declared_zero_completes_every_interval_rather_than_leaving_it_missing()
    {
        var totals = DailyPositionCalculator.Accumulate(
            consumption: Points((1, 10m), (2, 7m), (3, 3m)),
            production: [],
            productionIsDeclaredZero: true,
            expectedIntervalCount: 3);

        totals.ConsumptionKwh.ShouldBe(20.000m);
        totals.ProductionKwh.ShouldBe(0.000m);
        totals.NetUsageKwh.ShouldBe(20.000m);
        totals.OfftakeKwh.ShouldBe(20.000m);
        totals.ExportKwh.ShouldBe(0.000m);
        totals.IntervalsWithBothSeries.ShouldBe(3);
    }

    [Fact]
    public void Without_a_declared_zero_a_missing_production_series_leaves_every_interval_unknown()
    {
        var totals = DailyPositionCalculator.Accumulate(
            consumption: Points((1, 10m), (2, 7m), (3, 3m)),
            production: [],
            productionIsDeclaredZero: false,
            expectedIntervalCount: 3);

        totals.ConsumptionKwh.ShouldBe(20.000m);
        totals.ProductionKwh.ShouldBe(0.000m);
        totals.NetUsageKwh.ShouldBe(0.000m);
        totals.OfftakeKwh.ShouldBe(0.000m);
        totals.ExportKwh.ShouldBe(0.000m);

        // The honest marker. The caller stores data_state = PARTIAL beside these zeros, and the
        // read surfaces never present a total whose IntervalsWithBothSeries is short of the day.
        totals.IntervalsWithBothSeries.ShouldBe(0);
    }

    // ── Shape and scale ────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_position_outside_the_expected_range_is_ignored_rather_than_throwing()
    {
        // The adapter and the pipeline both reject out-of-range positions long before this point
        // (integration-spec §8.2's INVALID_POSITIONS). This is a backstop, not a validation: a
        // rollup that throws would take down an apply transaction over a row that cannot exist.
        var totals = DailyPositionCalculator.Accumulate(
            consumption: Points((1, 10m), (99, 1000m)),
            production: [],
            productionIsDeclaredZero: true,
            expectedIntervalCount: 2);

        totals.ConsumptionKwh.ShouldBe(10.000m);
    }

    [Fact]
    public void Every_total_is_stored_at_three_decimals()
    {
        var totals = DailyPositionCalculator.Accumulate(
            consumption: Points((1, 0.125m), (2, 0.125m)),
            production: Points((1, 0.001m), (2, 0m)),
            productionIsDeclaredZero: false,
            expectedIntervalCount: 2);

        // numeric(16,3) on daily_position; numeric(14,3) on interval_reading. The inputs are
        // already at three decimals, so the sums are exact and the scale is pinned rather than
        // rounded into.
        decimal.Round(totals.ConsumptionKwh, 3).ShouldBe(totals.ConsumptionKwh);
        decimal.Round(totals.NetUsageKwh, 3).ShouldBe(totals.NetUsageKwh);
        totals.ConsumptionKwh.ShouldBe(0.250m);
        totals.NetUsageKwh.ShouldBe(0.249m);
    }

    [Fact]
    public void An_empty_day_is_all_zeroes_and_says_so()
    {
        var totals = DailyPositionCalculator.Accumulate(
            consumption: [], production: [], productionIsDeclaredZero: false, expectedIntervalCount: 96);

        totals.ConsumptionKwh.ShouldBe(0m);
        totals.ProductionKwh.ShouldBe(0m);
        totals.NetUsageKwh.ShouldBe(0m);
        totals.OfftakeKwh.ShouldBe(0m);
        totals.ExportKwh.ShouldBe(0m);
        totals.IntervalsWithBothSeries.ShouldBe(0);
    }

    /// <summary>
    /// A hundred-point autumn day, so the accumulator is exercised at the length that actually
    /// varies. Consumption 1 kWh flat, production 2 kWh in the first ten intervals only.
    /// </summary>
    [Fact]
    public void A_hundred_point_autumn_day_accumulates_over_all_hundred_intervals()
    {
        var consumption = Enumerable.Range(1, 100)
            .Select(pos => new IntervalPoint((short)pos, 1m))
            .ToArray();
        var production = Enumerable.Range(1, 10)
            .Select(pos => new IntervalPoint((short)pos, 2m))
            .ToArray();

        var totals = DailyPositionCalculator.Accumulate(
            consumption, production, productionIsDeclaredZero: false, expectedIntervalCount: 100);

        totals.ConsumptionKwh.ShouldBe(100.000m);
        totals.ProductionKwh.ShouldBe(20.000m);
        totals.NetUsageKwh.ShouldBe(80.000m);
        // Ten intervals at −1, ninety at +1 — but only the ten have production, so the other
        // ninety have no pair at all and contribute nothing derived.
        totals.OfftakeKwh.ShouldBe(0.000m);
        totals.ExportKwh.ShouldBe(10.000m);
        totals.IntervalsWithBothSeries.ShouldBe(10);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~DailyPositionCalculatorTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'DailyPositionCalculator' could not be found`.

- [ ] **Step 3: Write `DailyPositionCalculator`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Ingestion/DailyPositionCalculator.cs`:

```csharp
namespace PeakPower.Application.Ingestion;

/// <summary>One reading. <c>Pos</c> is 1-based and runs to the date's expected interval count.</summary>
public readonly record struct IntervalPoint(short Pos, decimal QuantityKwh);

/// <summary>
/// The five figures <c>metering.daily_position</c> stores, plus the count that says how much of the
/// day they actually cover.
/// </summary>
/// <param name="ConsumptionKwh">Σ cᵢ over the intervals that have a consumption reading.</param>
/// <param name="ProductionKwh">Σ pᵢ. A declared zero contributes 0 for every interval.</param>
/// <param name="NetUsageKwh">Σ (cᵢ − pᵢ) over intervals where BOTH sides are known. May be negative.</param>
/// <param name="OfftakeKwh">
/// Σ max(cᵢ − pᵢ, 0). ⚠ <b>Not</b> <c>max(NetUsageKwh, 0)</c>. Design §4.1.
/// </param>
/// <param name="ExportKwh">
/// Σ |min(cᵢ − pᵢ, 0)|. ⚠ <b>Not</b> <c>max(−NetUsageKwh, 0)</c>. Design §4.1.
/// </param>
/// <param name="IntervalsWithBothSeries">
/// How many of the day's intervals had a value on both sides. It is what makes the four derived
/// figures honest: a day with 4 of 96 pairs has a net usage that is arithmetically correct and
/// substantively meaningless, and the caller stores <c>data_state = 'PARTIAL'</c> beside it.
/// Deliberately not a column — the DDL's column set is closed (contract §6.7) and the day state
/// already carries the answer.
/// </param>
public readonly record struct DailyPositionTotals(
    decimal ConsumptionKwh,
    decimal ProductionKwh,
    decimal NetUsageKwh,
    decimal OfftakeKwh,
    decimal ExportKwh,
    int IntervalsWithBothSeries);

/// <summary>
/// Design §4.1's rollup, accumulated <b>per interval</b>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this cannot be daily totals, precisely.</b> Σ(cᵢ − pᵢ) is arithmetically identical to
/// Σc − Σp, so the daily NET figure survives a daily-totals rollup intact and a reader who checks
/// only that concludes the per-interval pass is over-engineering. What does not survive is
/// everything that clamps per interval. Phase 2's coverage maths is built on <c>max(U, 0)</c> per
/// interval (position-and-coverage §4), and <c>[DEC-23]</c> settles the negative part as a separate
/// sale line that is never netted against purchase lines, because "uncovered and surplus volumes
/// occur at different times and therefore at different prices".
/// </para>
/// <para>
/// Design §4.1's worked case: consumption <c>[10, 0]</c>, production <c>[0, 5]</c>. Per interval
/// <c>U = [10, −5]</c>, so offtake is <b>10</b> and export is <b>5</b>. From daily totals alone,
/// <c>Σc − Σp = 5</c> and <c>max(5, 0) = 5</c> — which disagrees on the offtake and discards the
/// export entirely. The export is a volume the customer is owed money for.
/// </para>
/// <para>
/// <b>Missing propagates</b> (position-and-coverage §2.1). If either side of an interval is
/// missing, that interval's net usage is missing — not the other series' value. A derived figure is
/// never more complete than its least complete input.
/// </para>
/// <para>
/// <b>A declared zero is not missing</b> (<c>[F02-R33]</c>, <c>[DEC-65]</c>). Where
/// <c>production_expectation</c> is <c>NEVER</c>, production is zero for every interval of the date,
/// so every consumption interval has a complete pair. That is the single boolean parameter below,
/// and treating it as "missing" would empty the customer's chart for every non-producing connection
/// in the portfolio.
/// </para>
/// </remarks>
public static class DailyPositionCalculator
{
    public static DailyPositionTotals Accumulate(
        IReadOnlyList<IntervalPoint> consumption,
        IReadOnlyList<IntervalPoint> production,
        bool productionIsDeclaredZero,
        int expectedIntervalCount)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(expectedIntervalCount);

        // Indexed by Pos, 1-based, so slot 0 is unused. An array rather than a dictionary because
        // the day is at most 100 intervals and this runs inside an apply transaction holding an
        // advisory lock.
        var consumptionByPos = new decimal?[expectedIntervalCount + 1];
        var productionByPos = new decimal?[expectedIntervalCount + 1];

        Fill(consumptionByPos, consumption, expectedIntervalCount);
        Fill(productionByPos, production, expectedIntervalCount);

        var consumptionTotal = 0m;
        var productionTotal = 0m;
        var netTotal = 0m;
        var offtakeTotal = 0m;
        var exportTotal = 0m;
        var pairs = 0;

        for (var pos = 1; pos <= expectedIntervalCount; pos++)
        {
            var c = consumptionByPos[pos];

            // The declared zero. Not a fallback for a gap: it is master data saying production is
            // structurally zero on this connection, so the pair is complete.
            var p = productionIsDeclaredZero ? productionByPos[pos] ?? 0m : productionByPos[pos];

            if (c is { } consumed)
            {
                consumptionTotal += consumed;
            }

            if (p is { } produced)
            {
                productionTotal += produced;
            }

            if (c is not { } cValue || p is not { } pValue)
            {
                // Missing propagates. This interval's net usage is unknown, so it contributes to
                // neither the net total nor either clamp.
                continue;
            }

            var netUsage = cValue - pValue;
            netTotal += netUsage;
            pairs++;

            // ⚠ The two lines design §10 row 4 is about. They clamp the INTERVAL, and no
            // rearrangement of the daily totals reproduces them.
            if (netUsage > 0m)
            {
                offtakeTotal += netUsage;
            }
            else
            {
                exportTotal += -netUsage;
            }
        }

        // Inputs are numeric(14,3), so these sums are already exact at three decimals; the rounds
        // pin the stored scale rather than change a value. daily_position is numeric(16,3).
        return new DailyPositionTotals(
            ConsumptionKwh: decimal.Round(consumptionTotal, 3, MidpointRounding.AwayFromZero),
            ProductionKwh: decimal.Round(productionTotal, 3, MidpointRounding.AwayFromZero),
            NetUsageKwh: decimal.Round(netTotal, 3, MidpointRounding.AwayFromZero),
            OfftakeKwh: decimal.Round(offtakeTotal, 3, MidpointRounding.AwayFromZero),
            ExportKwh: decimal.Round(exportTotal, 3, MidpointRounding.AwayFromZero),
            IntervalsWithBothSeries: pairs);
    }

    /// <summary>
    /// A position outside 1..expected is dropped rather than thrown on. The adapter rejects those
    /// documents under integration-spec §8.2's <c>INVALID_POSITIONS</c> and the pipeline never
    /// stores one, so this is a backstop; throwing here would abort an apply transaction over a
    /// row that cannot exist.
    /// </summary>
    private static void Fill(
        decimal?[] slots, IReadOnlyList<IntervalPoint> points, int expectedIntervalCount)
    {
        foreach (var point in points)
        {
            if (point.Pos >= 1 && point.Pos <= expectedIntervalCount)
            {
                slots[point.Pos] = point.QuantityKwh;
            }
        }
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~DailyPositionCalculatorTests"
```

Expected: PASS — 12 tests.

- [ ] **Step 5: Commit before mutating**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Application/Ingestion/DailyPositionCalculator.cs \
        tests/PeakPower.Application.Tests/Ingestion/DailyPositionCalculatorTests.cs
git commit -m "Accumulate offtake and export per interval, because daily totals discard the export

Design 4.1: the daily NET figure survives a daily-totals rollup - the sum of the differences is
the difference of the sums - so the naive reading says this pass is unnecessary. What does not
survive is everything that clamps per interval. DEC-23 settles the negative part as a separate
sale line that is never netted against purchases, and the worked case shows a day where daily
totals report offtake 5 and export 0 against a true 10 and 5.

Missing propagates per position-and-coverage 2.1; a declared zero does not, per F02-R33."
```

- [ ] **Step 6: MUTATION 4 of design §10 — replace per-interval accumulation with daily-total subtraction, and predict the failure**

Contract §15.2 row 4 states the prediction: *"The mixed-export day: `offtake` reads 5 where the
fixture says 10, and `export` reads 0 where it says 5."*

Replace the two clamping lines in
`src/Core/PeakPower.Application/Ingestion/DailyPositionCalculator.cs` with a daily-total derivation.
Delete the `if (netUsage > 0m) … else …` block inside the loop and, immediately before the `return`,
insert:

```csharp
        // MUTATION - derive the clamps from the daily totals. DO NOT KEEP.
        var dailyNet = consumptionTotal - productionTotal;
        offtakeTotal = Math.Max(dailyNet, 0m);
        exportTotal = Math.Max(-dailyNet, 0m);
```

**Predicted failure**, before running:

`DailyPositionCalculatorTests.The_worked_case_from_design_4_1` fails on the offtake assertion:

```
Shouldly.ShouldAssertException : totals.OfftakeKwh
    should be
10.000m
    but was
5.000m
```

and, with that removed, `totals.ExportKwh should be 5.000m but was 0.000m`. Also predicted red:
`The_net_total_agrees_with_the_daily_subtraction_even_though_offtake_does_not` (both `ShouldNotBe`
assertions become equalities — which is the point of that test),
`An_interval_with_only_one_series_contributes_to_that_series_and_to_nothing_derived` (offtake 6 → 13)
and `A_hundred_point_autumn_day_accumulates_over_all_hundred_intervals` (offtake 0 → 80, export 10 → 0).
`A_day_that_only_ever_imports_has_no_export` and `A_day_that_exports_overall_carries_a_negative_net_usage`
stay **green** — every interval in each has the same sign, which is exactly why a test written only
against those two would certify the mutation.

- [ ] **Step 7: Run it and watch it go red**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~DailyPositionCalculatorTests"
```

Expected: FAIL. **Check the failure is the one predicted** — `OfftakeKwh should be 10.000m but was
5.000m` on `The_worked_case_from_design_4_1` — and check that the two single-sign days stayed green.
⚠ If they went red too, the mutation is broader than the one design §10 names and the evidence is
weaker, not stronger: re-read what you changed.

- [ ] **Step 8: Restore, watch it go green, and record the mutation**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git checkout src/Core/PeakPower.Application/Ingestion/DailyPositionCalculator.cs
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~DailyPositionCalculatorTests"
```

Expected: PASS — 12 tests.

Then edit
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/DailyPositionCalculatorTests.cs`,
replacing the closing `/// </summary>` of the class doc comment with:

```csharp
/// <para>
/// <b>Mutation-verified 2026-09-07, design §10 row 4.</b> The per-interval clamps were replaced with
/// <c>offtake = max(Σc − Σp, 0)</c> and <c>export = max(−(Σc − Σp), 0)</c>.
/// <see cref="The_worked_case_from_design_4_1"/> went red on
/// <c>totals.OfftakeKwh should be 10.000m but was 5.000m</c>, and export read 0 against a true 5.
/// The two single-sign days — <see cref="A_day_that_only_ever_imports_has_no_export"/> and
/// <see cref="A_day_that_exports_overall_carries_a_negative_net_usage"/> — stayed GREEN under the
/// mutation, which is why a suite written only from those would have certified it. Restored and green.
/// </para>
/// </summary>
```

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
git add tests/PeakPower.Application.Tests/Ingestion/DailyPositionCalculatorTests.cs
git commit -m "Record the daily-totals mutation the 4.1 accumulators were verified against

Design section 10 row 4. Replaced the per-interval clamps with max of the daily net; the worked
case went red reading offtake 5 against a true 10 and export 0 against a true 5. The two
single-sign days stayed green under the mutation, which is the reason the mixed-export fixture
exists at all - a suite written from uniform days would have certified the wrong implementation."
```

---

### Task 4: verify `MeteringPoint.RecordObservedProduction` — `[F02-R34]`'s promotion, as domain behaviour

`[F02-R34]`: an `A01` series arriving for a metering point recorded as `NEVER` is **stored and used
normally** — a document is never discarded because master data disagrees with it — and the **same
transaction resolves the contradiction**: the point moves to `EXPECTED` with source `OBSERVED`,
`first_production_observed_at` is stamped, and an alert is raised. *"Observed production is evidence
and a claim is not, so the platform believes the data."*

⚠ **`EXPECTED` is the value, `OBSERVED` is the source.** Two columns, two enums, and neither has a
database `CHECK` on its value set (contract §4) — `EnumToScreamingSnakeConverter` is the only
enforcement. Writing `OBSERVED` into `production_expectation` would round-trip through the converter
and fail on read, at some later date, in a different process.

⚠ **The promotion is not merely logged.** Database-design §3.1.1, quoted by `[F02-R34]`: "a reading
that contradicts its own master data must not be left stored beside it". Migration 9's
`ck_mp_never_has_no_observed_production` makes the contradictory combination **unstorable**, which is
what forces this into the same transaction rather than a follow-up job. Task 8 proves the constraint
bites.

⚠ **`UNKNOWN` is not promoted.** `[F02-R34]` names `NEVER` and only `NEVER`. An `UNKNOWN` point still
gets `first_production_observed_at` stamped — it is a fact about the connection either way, and the
constraint permits it because the expectation is not `NEVER` — but the declaration stays the
customer's to make `[DEC-112]`, and `UNKNOWN` already reads as `EXPECTED` for completeness, so
nothing downstream is waiting on a value change.

⚠ **This task declares nothing on `MeteringPoint`.** Contract §17 gives **plan 2** every member of
every entity, `MeteringPoint` included, and contract §5 is where its shape is settled. What this task
owns is the **evidence**: eight test cases and two mutations neither of which is the easy one, which
plan 2 does not write. If the method is missing, plan 2 has a gap — fill it against the body in
`git log` for plan 2's commit, not by inventing a second shape here.

**Files:**
- Read (declared by plan 2): `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/MeteringPoint.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Customers/MeteringPointProductionTests.cs`

**Interfaces:**
- Consumes: `MeteringPoint.ProductionExpectation`, `.ExpectationSource`, the three properties
  migration 9 added — `FirstProductionObservedAt`, `ExpectationSetBy`, `ExpectationSetAt`
  (contract §6.2, declared by plan 2) — and
  `MeteringPoint.RecordObservedProduction(DateTimeOffset observedAt, string setBy)` returning
  `Result<MeteringPoint>`, plus the constant
  `MeteringPoint.IngestionPromotionActor = "system:ingestion"` (also plan 2's).
- Produces: `PeakPower.Domain.Tests.Customers.MeteringPointProductionTests` — a test class and
  nothing else.

⚠ **Check plan 2 landed the four properties before starting.** Run
`grep -n 'FirstProductionObservedAt\|ExpectationSetBy\|ExpectationSetAt\|BrpAssignedAt' src/Core/PeakPower.Domain/Customers/MeteringPoint.cs`.
If they are absent, add exactly these four beside `ExpectationSource` at line 41 — they are contract
§6.2's, and their absence is a plan-2 gap rather than a licence to invent different ones:

```csharp
    /// <summary>When this point was last assigned to a BRP. [F02-R43]</summary>
    public DateTimeOffset BrpAssignedAt { get; private set; }

    /// <summary>
    /// The first moment an A01 series was seen for this point. [F02-R34]
    /// ⚠ <c>ck_mp_never_has_no_observed_production</c> makes a non-null value here unstorable
    /// while <see cref="ProductionExpectation"/> is NEVER.
    /// </summary>
    public DateTimeOffset? FirstProductionObservedAt { get; private set; }

    /// <summary>Who set the production expectation. [F01-R40], [F02-R33]</summary>
    public string? ExpectationSetBy { get; private set; }

    /// <summary>When the production expectation was set. [F01-R40], [F02-R33]</summary>
    public DateTimeOffset? ExpectationSetAt { get; private set; }
```

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Customers/MeteringPointProductionTests.cs`:

```csharp
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using Shouldly;
using Xunit;

namespace PeakPower.Domain.Tests.Customers;

/// <summary>
/// [F02-R34] as domain behaviour: observed production is evidence and a claim is not, so the
/// platform believes the data and corrects the master record.
/// </summary>
public sealed class MeteringPointProductionTests
{
    private static readonly Guid CustomerId = Guid.Parse("0199a1a0-0000-7000-8000-00000000c001");
    private static readonly Guid BrpId = Guid.Parse("0199a1a0-0000-7000-8000-0000000000b1");
    private static readonly DateTimeOffset Observed = new(2026, 8, 13, 4, 2, 11, TimeSpan.Zero);

    private static MeteringPoint Point(ProductionExpectation expectation) =>
        MeteringPoint.Attach(
            CustomerId,
            EanCode.Create("871687100000000011").Value,
            BrpId,
            expectation,
            ProductionExpectationSource.CustomerDeclared,
            "Rotterdam DC",
            description: null,
            gridOperator: "Stedin",
            capacityKw: 4200m,
            address: null,
            validFrom: new DateOnly(2024, 1, 1)).Value;

    [Fact]
    public void A_never_point_that_produces_becomes_expected_with_source_observed()
    {
        var point = Point(ProductionExpectation.Never);

        var result = point.RecordObservedProduction(Observed, MeteringPoint.IngestionPromotionActor);

        result.IsSuccess.ShouldBeTrue();

        // EXPECTED is the value. OBSERVED is the source. Two columns, two enums, and neither
        // carries a database CHECK - EnumToScreamingSnakeConverter is the only enforcement, so
        // a value written into the wrong column fails on READ, later, somewhere else.
        point.ProductionExpectation.ShouldBe(ProductionExpectation.Expected);
        point.ExpectationSource.ShouldBe(ProductionExpectationSource.Observed);

        point.FirstProductionObservedAt.ShouldBe(Observed);
        point.ExpectationSetBy.ShouldBe("system:ingestion");
        point.ExpectationSetAt.ShouldBe(Observed);
    }

    [Fact]
    public void The_promoted_point_no_longer_reads_as_a_declared_zero()
    {
        var point = Point(ProductionExpectation.Never);

        point.RecordObservedProduction(Observed, MeteringPoint.IngestionPromotionActor);

        // [F02-R33]'s declared zero applies to NEVER points only. The whole reason the promotion
        // has to happen inside the apply transaction is that the completeness check immediately
        // after it reads this property.
        point.ProductionExpectation.ShouldNotBe(ProductionExpectation.Never);
    }

    /// <summary>
    /// The first observation is the one recorded. A later A01 series must not overwrite it — the
    /// column answers "since when do we know this connection produces", and re-stamping it every
    /// day makes it answer "when did we last see production", which is a different question the
    /// day state already answers.
    /// </summary>
    [Fact]
    public void A_second_observation_does_not_move_the_first_observed_moment()
    {
        var point = Point(ProductionExpectation.Never);
        point.RecordObservedProduction(Observed, MeteringPoint.IngestionPromotionActor);

        point.RecordObservedProduction(
            Observed.AddDays(30), MeteringPoint.IngestionPromotionActor);

        point.FirstProductionObservedAt.ShouldBe(Observed);
        point.ProductionExpectation.ShouldBe(ProductionExpectation.Expected);
    }

    /// <summary>
    /// [F02-R34] names NEVER and only NEVER. UNKNOWN already reads as EXPECTED for completeness
    /// [F02-R32], and the declaration stays the customer's to make [DEC-112], so nothing downstream
    /// is waiting on a value change. The observation is still recorded, because it is a fact about
    /// the connection either way and ck_mp_never_has_no_observed_production permits it here.
    /// </summary>
    [Fact]
    public void An_unknown_point_records_the_observation_without_being_promoted()
    {
        var point = Point(ProductionExpectation.Unknown);

        point.RecordObservedProduction(Observed, MeteringPoint.IngestionPromotionActor);

        point.FirstProductionObservedAt.ShouldBe(Observed);
        point.ProductionExpectation.ShouldBe(ProductionExpectation.Unknown);
        // Untouched: the customer's declaration is not overwritten by an observation that agrees
        // with the reading UNKNOWN already gets.
        point.ExpectationSource.ShouldBe(ProductionExpectationSource.CustomerDeclared);
    }

    [Fact]
    public void An_expected_point_records_the_observation_and_keeps_its_source()
    {
        var point = Point(ProductionExpectation.Expected);

        point.RecordObservedProduction(Observed, MeteringPoint.IngestionPromotionActor);

        point.FirstProductionObservedAt.ShouldBe(Observed);
        point.ProductionExpectation.ShouldBe(ProductionExpectation.Expected);
        point.ExpectationSource.ShouldBe(ProductionExpectationSource.CustomerDeclared);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void A_promotion_must_name_who_recorded_it(string setBy)
    {
        var point = Point(ProductionExpectation.Never);

        var result = point.RecordObservedProduction(Observed, setBy);

        result.IsSuccess.ShouldBeFalse();
        // [F01-R40]: the declared zero has to trace to its source, setter and date. So does the
        // value that replaces it.
        result.Error.ShouldBe("An observed-production promotion must name who recorded it.");
        point.ProductionExpectation.ShouldBe(ProductionExpectation.Never);
        point.FirstProductionObservedAt.ShouldBeNull();
    }

    [Fact]
    public void The_ingestion_actor_is_the_string_the_alert_and_the_audit_will_show()
    {
        // Pinned rather than left to a literal at the call site: it appears on the metering point,
        // in the PRODUCTION_EXPECTATION_PROMOTED alert's detail and on the employee screen, and
        // three spellings of the same actor is three actors to whoever reads them.
        MeteringPoint.IngestionPromotionActor.ShouldBe("system:ingestion");
    }
}
```

- [ ] **Step 2: Run the test and watch it pass against plan 2's implementation**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Domain.Tests --nologo --filter "FullyQualifiedName~MeteringPointProductionTests"
```

Expected: PASS — 8 test cases.

⚠ **`error CS1061: 'MeteringPoint' does not contain a definition for 'RecordObservedProduction'`
means plan 2 has a gap**, not that this task should declare the method. Contract §17: plan 2 is the
only plan that declares an entity member. Go and close it there, then come back — steps 3 and 4 below
are what proves it was closed correctly rather than plausibly.

- [ ] **Step 3: Verify by mutation that the two-column trap is actually caught**

CLAUDE.md's warning applies here word for word: *mutate the case your assertion is actually for, not
the easy neighbouring one.* The easy mutation is deleting the whole promotion; the mutation that
matters is writing the right value into the wrong column.

In `MeteringPoint.RecordObservedProduction`, swap the source line to the one a hurried reader writes:

```csharp
            ExpectationSource = ProductionExpectationSource.CustomerDeclared;   // MUTATION
```

Predict: `A_never_point_that_produces_becomes_expected_with_source_observed` fails with

```
Shouldly.ShouldAssertException : point.ExpectationSource
    should be
ProductionExpectationSource.Observed
    but was
ProductionExpectationSource.CustomerDeclared
```

and **nothing else goes red** — the expectation value, the stamp and the actor are all still correct,
which is exactly why the source needs its own assertion rather than being folded into a "promotion
happened" check.

Run the filter, confirm the message, then restore.

- [ ] **Step 4: Second mutation — prove the first-observation rule is not vacuous**

Change `FirstProductionObservedAt ??= observedAt;` to `FirstProductionObservedAt = observedAt;`.

Predict: `A_second_observation_does_not_move_the_first_observed_moment` fails with
`point.FirstProductionObservedAt should be 2026-08-13T04:02:11+00:00 but was 2026-09-12T04:02:11+00:00`.

Run, confirm, restore.

- [ ] **Step 5: Run the whole domain suite and commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Domain.Tests --nologo
git status --porcelain src/Core/PeakPower.Domain/Customers/MeteringPoint.cs
# Expect NO output: steps 3 and 4 mutated another plan's file and both restored it.
git add tests/PeakPower.Domain.Tests/Customers/MeteringPointProductionTests.cs
git commit -m "Prove the observed-production promotion, in the two ways it silently breaks

F02-R34. An A01 series arriving for a point recorded NEVER is stored and used normally, and the
same transaction moves the point to EXPECTED with source OBSERVED and stamps
first_production_observed_at. Migration 9's ck_mp_never_has_no_observed_production makes the
contradictory pair unstorable, which is what turns database design 3.1.1's should into a cannot.

The behaviour is plan 2's, per shared contract 17: it declares every entity member. What was
missing was the evidence, and these are the two mutations that supply it - neither of them the
easy one. Writing CUSTOMER_DECLARED into expectation_source turns exactly ONE assertion red and
leaves the rest green, which is why the source needs an assertion of its own rather than being
folded into a promotion-happened check; and dropping the ??= re-stamps the first-observed moment
on every later series, turning since-when-do-we-know into when-did-we-last-see."
```

---

### Task 5: `RollupFixture` — the seeded world every rollup test recomputes against

Every integration test from task 6 onwards needs the same five things in a real PostgreSQL 17:
a customer, a metering point with a chosen `production_expectation`, an `inbound_message`, an
`interval_data_version` and its readings. Writing that inline five times is how five tests end up
seeding four different worlds.

⚠ **It seeds through raw SQL, not through the entities.** Contract §5 gives `IntervalReading` and
`MeteringPointDayState` properties only — no factory, no public constructor — and those classes are
plan 2's. A seeder that needed to construct them would couple this plan to member signatures the
contract does not pin. Raw SQL names only the columns contract §6 pins, which it does exhaustively.

⚠ **It reuses `PostgresFixture`'s container** (`tests/PeakPower.Integration.Tests/Database/PostgresFixture.cs:16`)
rather than starting its own. The shared contract's own warning applies: running several suites in
parallel across worktrees can exhaust connections and produce mass Postgres timeouts, and a second
container per test class is the fastest way there.

⚠ **`interval_start` is computed by `IMarketCalendar.IntervalStart`, never by adding fifteen minutes.**
The seeder deliberately goes through plan 1's calendar so that a 100-point autumn fixture in these
tests is placed by the same code the parser and the chart use. A seeder with its own arithmetic would
make the DST tests below prove nothing about the system.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/RollupFixture.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj:15`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/RollupFixtureSelfTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Integration.Tests.Database.PostgresFixture` (`CreateContext()`, `ConnectionString`),
  `PeakPower.Infrastructure.Time.MarketCalendar`, `PeakPower.Application.Abstractions.IMarketCalendar`.
- Produces:
  - `RollupFixture(PostgresFixture postgres, IMarketCalendar calendar)` with
    `Task<Guid> SeedCustomerAsync(CancellationToken ct)`,
    `Task<Guid> SeedMeteringPointAsync(Guid customerId, string ean, ProductionExpectation expectation, CancellationToken ct)`,
    `Task<Guid> SeedInboundMessageAsync(DateTimeOffset receivedAt, CancellationToken ct)`,
    `Task<Guid> SeedVersionAsync(Guid meteringPointId, Guid customerId, DateOnly deliveryDate, IntervalDirection direction, Guid inboundMessageId, DateTimeOffset receivedAt, IReadOnlyList<decimal> quantitiesByPos, CancellationToken ct)`,
    `Task SupersedeAsync(Guid versionId, CancellationToken ct)`,
    and the read-back helpers `Task<DayStateRow?> ReadDayStateAsync(...)`,
    `Task<DailyPositionRow?> ReadDailyPositionAsync(...)`,
    `Task<IReadOnlyList<AlertRow>> ReadAlertsAsync(...)`,
    `Task<long> CountIntervalReadingsAsync(...)`
  - `RollupFixture.PvnedBrpId` — `0199a1a0-0000-7000-8000-0000000000b1`, migration 1's seeded row
  - the row records `DayStateRow`, `DailyPositionRow`, `AlertRow`

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/RollupFixtureSelfTests.cs`:

```csharp
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Infrastructure.Time;
using PeakPower.Integration.Tests.Database;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Rollup;

/// <summary>
/// The seeding helper, tested before anything relies on it.
/// <para>
/// A fixture that silently seeds nothing makes every test built on it pass vacuously — the same
/// failure <c>AssemblyProbe</c>'s two-directional check exists to prevent on the architecture side.
/// These four assertions are what stop that here.
/// </para>
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class RollupFixtureSelfTests(PostgresFixture postgres)
{
    private RollupFixture NewWorld() => new(postgres, new MarketCalendar(TimeProvider.System));

    [Fact]
    public async Task A_seeded_version_writes_one_reading_per_supplied_quantity()
    {
        var ct = TestContext.Current.CancellationToken;
        var world = NewWorld();

        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(
            customerId, world.NextEan(), ProductionExpectation.Never, ct);
        var messageId = await world.SeedInboundMessageAsync(
            new DateTimeOffset(2026, 8, 13, 4, 0, 0, TimeSpan.Zero), ct);

        var versionId = await world.SeedVersionAsync(
            pointId, customerId, new DateOnly(2026, 8, 12), IntervalDirection.Consumption,
            messageId, new DateTimeOffset(2026, 8, 13, 4, 0, 0, TimeSpan.Zero),
            Quantities(96, 1m), ct);

        (await world.CountIntervalReadingsAsync(versionId, new DateOnly(2026, 8, 12), ct))
            .ShouldBe(96L);
        versionId.ShouldNotBe(Guid.Empty);
    }

    /// <summary>
    /// The autumn day, seeded at its real length of 100 and placed by IMarketCalendar.
    /// <para>
    /// ⚠ <b>Note carefully what this does and does not assert.</b> Stored as <c>timestamptz</c>,
    /// the hundred interval starts of the autumn day ARE a contiguous run of fifteen-minute steps —
    /// the repeated local hour is repeated in local labelling, not in elapsed time, and Npgsql
    /// hands back a <see cref="DateTimeOffset"/> at UTC either way. So the Pos-to-local-label
    /// mapping is <b>plan 1's</b> assertion, on <c>IMarketCalendar.IsDstDuplicate</c> and
    /// <c>IntervalStart</c>, and design §10 row 3 is plan 1's mutation. What this test owns is that
    /// the seeder writes the DATE'S length — a hundred rows spanning exactly twenty-five hours —
    /// rather than a hard-coded ninety-six, because every day-state test below compares a reading
    /// count against <c>ExpectedIntervalCount</c> and a seeder that truncated at 96 would make the
    /// autumn day permanently PARTIAL for a reason that has nothing to do with the rule under test.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_hundred_point_autumn_day_is_seeded_at_the_dates_own_length()
    {
        var ct = TestContext.Current.CancellationToken;
        var world = NewWorld();
        var autumn = new DateOnly(2026, 10, 25);

        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(
            customerId, world.NextEan(), ProductionExpectation.Never, ct);
        var messageId = await world.SeedInboundMessageAsync(
            new DateTimeOffset(2026, 10, 26, 4, 0, 0, TimeSpan.Zero), ct);

        var versionId = await world.SeedVersionAsync(
            pointId, customerId, autumn, IntervalDirection.Consumption, messageId,
            new DateTimeOffset(2026, 10, 26, 4, 0, 0, TimeSpan.Zero), Quantities(100, 1m), ct);

        (await world.CountIntervalReadingsAsync(versionId, autumn, ct)).ShouldBe(100L);

        // Amsterdam local midnight on 25 October 2026 is 22:00Z on the 24th (CEST, +02:00), and
        // the day runs twenty-five hours, so Pos 100 starts at 22:45Z on the 25th (CET, +01:00).
        var first = await world.ReadIntervalStartAsync(versionId, autumn, pos: 1, ct);
        var last = await world.ReadIntervalStartAsync(versionId, autumn, pos: 100, ct);

        first.ToUniversalTime().ShouldBe(new DateTimeOffset(2026, 10, 24, 22, 0, 0, TimeSpan.Zero));
        last.ToUniversalTime().ShouldBe(new DateTimeOffset(2026, 10, 25, 22, 45, 0, TimeSpan.Zero));
        (last - first).ShouldBe(TimeSpan.FromHours(24.75));
    }

    [Fact]
    public async Task A_ninety_two_point_spring_day_is_seeded_at_the_dates_own_length()
    {
        var ct = TestContext.Current.CancellationToken;
        var world = NewWorld();
        var spring = new DateOnly(2026, 3, 29);

        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(
            customerId, world.NextEan(), ProductionExpectation.Never, ct);
        var messageId = await world.SeedInboundMessageAsync(
            new DateTimeOffset(2026, 3, 30, 4, 0, 0, TimeSpan.Zero), ct);

        var versionId = await world.SeedVersionAsync(
            pointId, customerId, spring, IntervalDirection.Consumption, messageId,
            new DateTimeOffset(2026, 3, 30, 4, 0, 0, TimeSpan.Zero), Quantities(92, 1m), ct);

        (await world.CountIntervalReadingsAsync(versionId, spring, ct)).ShouldBe(92L);

        // Local midnight on 29 March 2026 is 23:00Z on the 28th (CET, +01:00); the day is
        // twenty-three hours, so Pos 92 starts at 21:45Z on the 29th (CEST, +02:00).
        var first = await world.ReadIntervalStartAsync(versionId, spring, pos: 1, ct);
        var last = await world.ReadIntervalStartAsync(versionId, spring, pos: 92, ct);

        first.ToUniversalTime().ShouldBe(new DateTimeOffset(2026, 3, 28, 23, 0, 0, TimeSpan.Zero));
        last.ToUniversalTime().ShouldBe(new DateTimeOffset(2026, 3, 29, 21, 45, 0, TimeSpan.Zero));
    }

    [Fact]
    public async Task Superseding_a_version_leaves_it_queryable_and_clears_is_current()
    {
        var ct = TestContext.Current.CancellationToken;
        var world = NewWorld();

        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(
            customerId, world.NextEan(), ProductionExpectation.Never, ct);
        var messageId = await world.SeedInboundMessageAsync(
            new DateTimeOffset(2026, 8, 13, 4, 0, 0, TimeSpan.Zero), ct);

        var first = await world.SeedVersionAsync(
            pointId, customerId, new DateOnly(2026, 8, 12), IntervalDirection.Consumption,
            messageId, new DateTimeOffset(2026, 8, 13, 4, 0, 0, TimeSpan.Zero), Quantities(96, 1m), ct);

        await world.SupersedeAsync(first, ct);

        // [F02-R18]: superseding never deletes. The readings stay, which is what makes a version
        // history queryable at all.
        (await world.CountIntervalReadingsAsync(first, new DateOnly(2026, 8, 12), ct)).ShouldBe(96L);
        (await world.IsCurrentAsync(first, ct)).ShouldBeFalse();
    }

    [Fact]
    public async Task Two_worlds_do_not_collide_on_the_same_container()
    {
        var ct = TestContext.Current.CancellationToken;
        var a = NewWorld();
        var b = NewWorld();

        var eanA = a.NextEan();
        var eanB = b.NextEan();

        eanA.ShouldNotBe(eanB);
        eanA.Length.ShouldBe(18);

        var customerA = await a.SeedCustomerAsync(ct);
        var customerB = await b.SeedCustomerAsync(ct);
        customerA.ShouldNotBe(customerB);
    }

    private static IReadOnlyList<decimal> Quantities(int count, decimal each) =>
        [.. Enumerable.Repeat(each, count)];
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~RollupFixtureSelfTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'RollupFixture' could not be found`.

- [ ] **Step 3: Add the three project references the rollup and DevStubs tests need**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj`,
inserting after line 15 (`<ProjectReference Include="../../src/Hosts/PeakPower.Migrator/PeakPower.Migrator.csproj" />`):

```xml
    <!-- Plan 5: DayStateRecomputer, the two jobs and OperationalAlertRaiser are exercised against
         a real PostgreSQL 17 here rather than mocked, because every one of them is an upsert or a
         conditional insert whose behaviour is the SQL. -->
    <ProjectReference Include="../../src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj" />
    <!-- Plan 5: the DevStubs scenario suite drives the real webhook through
         WebApplicationFactory<WorkerEntryPoint>, which needs the Worker host in the graph. -->
    <ProjectReference Include="../../src/Hosts/PeakPower.Worker/PeakPower.Worker.csproj" />
    <!-- Plan 5: the generated documents come from PeakPower.DevStubs itself, so the end-to-end
         suite posts exactly what a developer's `devstubs scenarios` run posts. A test that built
         its own XML would prove the pipeline works on XML the generator never emits. -->
    <ProjectReference Include="../../src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj" />
```

- [ ] **Step 4: Write `RollupFixture`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/RollupFixture.cs`:

```csharp
using System.Globalization;
using Npgsql;
using PeakPower.Application.Abstractions;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Integration.Tests.Database;
using Xunit;

namespace PeakPower.Integration.Tests.Rollup;

/// <summary>One row of <c>metering.metering_point_day_state</c>, read back.</summary>
public sealed record DayStateRow(
    string State,
    short ExpectedIntervalCount,
    bool ConsumptionComplete,
    bool ProductionComplete,
    bool ProductionIsDeclaredZero,
    DateTimeOffset? FinalisedAt,
    DateTimeOffset? LastCorrectedAt);

/// <summary>One row of <c>metering.daily_position</c>, read back.</summary>
public sealed record DailyPositionRow(
    decimal ConsumptionKwh,
    decimal ProductionKwh,
    decimal NetUsageKwh,
    decimal OfftakeKwh,
    decimal ExportKwh,
    string DataState,
    IReadOnlyList<Guid> SourceVersionIds);

/// <summary>One row of <c>metering.operational_alert</c>, read back.</summary>
public sealed record AlertRow(
    Guid Id,
    string Kind,
    string Status,
    Guid? MeteringPointId,
    Guid? BrpId,
    DateOnly? DeliveryDate,
    string Summary,
    string? Detail,
    DateTimeOffset? ResolvedAt);

/// <summary>
/// Seeds the world a rollup test recomputes against, and reads back what the recompute wrote.
/// </summary>
/// <remarks>
/// <para>
/// <b>Raw SQL, on purpose.</b> Shared contract §5 gives <c>IntervalReading</c>,
/// <c>MeteringPointDayState</c>, <c>DailyPosition</c> and <c>OperationalAlert</c> properties only —
/// no factory and no public constructor — and those classes belong to plan 2. Seeding through the
/// entities would couple this plan to member signatures the contract does not pin; naming columns
/// couples it only to §6, which pins them exhaustively.
/// </para>
/// <para>
/// <b>It shares <see cref="PostgresFixture"/>'s container.</b> Every id it writes is fresh, so
/// classes in the "postgres" collection do not collide. A container per test class is the shortest
/// route to the connection exhaustion the shared contract warns about.
/// </para>
/// <para>
/// <b>The interval count and the interval starts both come from <see cref="IMarketCalendar"/>.</b>
/// The count is the load-bearing one: a seeder that wrote a fixed ninety-six rows would hold the
/// autumn day at PARTIAL forever, and every completeness test below would look broken for a reason
/// that has nothing to do with the rule under test. The instants go through
/// <see cref="IMarketCalendar.IntervalStart"/> for a weaker but still real reason — this fixture
/// must not carry a second answer to a question <c>PeakPower.Infrastructure.Time</c> already owns.
/// <b>Mutation-verified 2026-09-07:</b> replacing the call with a UTC-elapsed fifteen-minute walk
/// from the day's first instant turns NOTHING red, because stored as <c>timestamptz</c> the autumn
/// day's hundred starts genuinely are contiguous — the repeated hour repeats in local labelling,
/// not in elapsed time. The DST failure design §10 row 3 names lives in the Pos-to-local-label
/// mapping and is <b>plan 1's</b> to mutate, on <c>IMarketCalendar</c> itself.
/// </para>
/// </remarks>
public sealed class RollupFixture(PostgresFixture postgres, IMarketCalendar calendar)
{
    /// <summary>The PVNed row migration 1 seeds. Nothing here creates a second BRP.</summary>
    public static readonly Guid PvnedBrpId = Guid.Parse("0199a1a0-0000-7000-8000-0000000000b1");

    private int _eanSequence;
    private readonly string _eanPrefix = BuildEanPrefix();

    /// <summary>
    /// A fresh 18-digit EAN, unique across every fixture instance in the process.
    /// </summary>
    /// <remarks>
    /// ⚠ It carries no valid GS1 check digit and neither does any of the thirty-one demo EANs
    /// ([DEC-114] relaxed validation to eighteen digits; [OQ-97] owns reinstating it). Do not
    /// "fix" these — when [OQ-97] is answered the demo rows break first and these with them, and
    /// making the test data pass a check the production data fails would hide that.
    /// </remarks>
    public string NextEan()
    {
        var next = Interlocked.Increment(ref _eanSequence);
        return _eanPrefix + next.ToString("D4", CultureInfo.InvariantCulture);
    }

    public async Task<Guid> SeedCustomerAsync(CancellationToken ct)
    {
        var id = Guid.CreateVersion7();
        await ExecuteAsync(
            """
            INSERT INTO customer.customer
                (id, legal_name, kvk_number, status, four_eyes_enabled,
                 billing_address, primary_contact, locale)
            VALUES
                (@id, 'Rollup Test B.V.', '12345678', 'ACTIVE', false,
                 '{"street":"Havenweg","houseNumber":"22","houseNumberSuffix":null,
                    "postalCode":"3089JJ","city":"Rotterdam","country":"NL"}'::jsonb,
                 '{"name":"J. de Vries","email":"j.devries@example.nl","phone":null}'::jsonb,
                 'nl-NL');
            """,
            ct,
            ("id", id));
        return id;
    }

    public async Task<Guid> SeedMeteringPointAsync(
        Guid customerId,
        string ean,
        ProductionExpectation expectation,
        CancellationToken ct,
        Guid? brpId = null,
        DateOnly? validFrom = null,
        DateOnly? validTo = null)
    {
        var id = Guid.CreateVersion7();
        await ExecuteAsync(
            """
            INSERT INTO customer.metering_point
                (id, customer_id, ean, commodity, brp_id, production_expectation,
                 expectation_source, name, valid_from, valid_to)
            VALUES
                (@id, @customerId, @ean, 'ELECTRICITY', @brpId, @expectation,
                 'CUSTOMER_DECLARED', 'Rollup point', @validFrom, @validTo);
            """,
            ct,
            ("id", id),
            ("customerId", customerId),
            ("ean", ean),
            ("brpId", brpId ?? PvnedBrpId),
            // SCREAMING_SNAKE, the database spelling, which is normative and extends to JSON.
            ("expectation", ExpectationText(expectation)),
            ("validFrom", validFrom ?? new DateOnly(2024, 1, 1)),
            ("validTo", (object?)validTo ?? DBNull.Value));
        return id;
    }

    public async Task<Guid> SeedInboundMessageAsync(
        DateTimeOffset receivedAt, CancellationToken ct, Guid? brpId = null)
    {
        var id = Guid.CreateVersion7();
        await ExecuteAsync(
            """
            INSERT INTO metering.inbound_message
                (id, brp_id, correlation_id, received_at, payload_hash, payload_bytes,
                 payload_uri, status)
            VALUES
                (@id, @brpId, @correlationId, @receivedAt, @hash, 4096,
                 'file://test/' || @id::text || '.bin', 'PROCESSED');
            """,
            ct,
            ("id", id),
            ("brpId", brpId ?? PvnedBrpId),
            ("correlationId", Guid.CreateVersion7()),
            ("receivedAt", receivedAt),
            ("hash", System.Security.Cryptography.SHA256.HashData(id.ToByteArray())));
        return id;
    }

    /// <summary>
    /// Writes one <c>interval_data_version</c> and one reading per supplied quantity, at Pos 1..n.
    /// The version is <c>is_current = true</c>; <see cref="SupersedeAsync"/> is how a test makes an
    /// older one stop being current, exactly as the pipeline does.
    /// </summary>
    public async Task<Guid> SeedVersionAsync(
        Guid meteringPointId,
        Guid customerId,
        DateOnly deliveryDate,
        IntervalDirection direction,
        Guid inboundMessageId,
        DateTimeOffset receivedAt,
        IReadOnlyList<decimal> quantitiesByPos,
        CancellationToken ct,
        DateTimeOffset? documentCreated = null)
    {
        var versionId = Guid.CreateVersion7();
        var intervalCount = calendar.ExpectedIntervalCount(deliveryDate);

        await ExecuteAsync(
            """
            INSERT INTO metering.interval_data_version
                (id, metering_point_id, customer_id, delivery_date, direction, source,
                 document_id, document_created, received_at, inbound_message_id, correlation_id,
                 interval_count, is_current)
            VALUES
                (@id, @meteringPointId, @customerId, @deliveryDate, @direction, 'BRP_FEED',
                 @documentId, @documentCreated, @receivedAt, @inboundMessageId, @correlationId,
                 @intervalCount, true);
            """,
            ct,
            ("id", versionId),
            ("meteringPointId", meteringPointId),
            ("customerId", customerId),
            ("deliveryDate", deliveryDate),
            ("direction", direction == IntervalDirection.Production ? "PRODUCTION" : "CONSUMPTION"),
            ("documentId", versionId.ToString()),
            ("documentCreated", documentCreated ?? receivedAt.AddMinutes(-5)),
            ("receivedAt", receivedAt),
            ("inboundMessageId", inboundMessageId),
            ("correlationId", Guid.CreateVersion7()),
            ("intervalCount", (short)intervalCount));

        for (var index = 0; index < quantitiesByPos.Count; index++)
        {
            var pos = index + 1;
            await ExecuteAsync(
                """
                INSERT INTO metering.interval_reading
                    (version_id, delivery_date, customer_id, pos, interval_start, quantity_kwh)
                VALUES
                    (@versionId, @deliveryDate, @customerId, @pos, @intervalStart, @quantity);
                """,
                ct,
                ("versionId", versionId),
                ("deliveryDate", deliveryDate),
                ("customerId", customerId),
                ("pos", (short)pos),
                // Through the calendar, never a fifteen-minute loop. See the class remarks.
                ("intervalStart", calendar.IntervalStart(deliveryDate, pos)),
                ("quantity", quantitiesByPos[index]));
        }

        return versionId;
    }

    /// <summary>[F02-R18]: superseding never deletes. Only the flag moves.</summary>
    public Task SupersedeAsync(Guid versionId, CancellationToken ct) =>
        ExecuteAsync(
            "UPDATE metering.interval_data_version SET is_current = false WHERE id = @id;",
            ct,
            ("id", versionId));

    public async Task<bool> IsCurrentAsync(Guid versionId, CancellationToken ct) =>
        await ScalarAsync<bool>(
            "SELECT is_current FROM metering.interval_data_version WHERE id = @id;",
            ct,
            ("id", versionId));

    public async Task<long> CountIntervalReadingsAsync(
        Guid versionId, DateOnly deliveryDate, CancellationToken ct) =>
        await ScalarAsync<long>(
            """
            SELECT count(*) FROM metering.interval_reading
             WHERE version_id = @versionId AND delivery_date = @deliveryDate;
            """,
            ct,
            ("versionId", versionId),
            ("deliveryDate", deliveryDate));

    public async Task<DateTimeOffset> ReadIntervalStartAsync(
        Guid versionId, DateOnly deliveryDate, int pos, CancellationToken ct) =>
        await ScalarAsync<DateTimeOffset>(
            """
            SELECT interval_start FROM metering.interval_reading
             WHERE version_id = @versionId AND delivery_date = @deliveryDate AND pos = @pos;
            """,
            ct,
            ("versionId", versionId),
            ("deliveryDate", deliveryDate),
            ("pos", (short)pos));

    public async Task<DayStateRow?> ReadDayStateAsync(
        Guid meteringPointId, DateOnly deliveryDate, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var command = new NpgsqlCommand(
            """
            SELECT state, expected_interval_count, consumption_complete, production_complete,
                   production_is_declared_zero, finalised_at, last_corrected_at
              FROM metering.metering_point_day_state
             WHERE metering_point_id = @pointId AND delivery_date = @deliveryDate;
            """,
            connection);
        command.Parameters.AddWithValue("pointId", meteringPointId);
        command.Parameters.AddWithValue("deliveryDate", deliveryDate);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return null;
        }

        return new DayStateRow(
            reader.GetString(0),
            reader.GetInt16(1),
            reader.GetBoolean(2),
            reader.GetBoolean(3),
            reader.GetBoolean(4),
            reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5),
            reader.IsDBNull(6) ? null : reader.GetFieldValue<DateTimeOffset>(6));
    }

    public async Task<DailyPositionRow?> ReadDailyPositionAsync(
        Guid meteringPointId, DateOnly deliveryDate, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var command = new NpgsqlCommand(
            """
            SELECT consumption_kwh, production_kwh, net_usage_kwh, offtake_kwh, export_kwh,
                   data_state, source_version_ids
              FROM metering.daily_position
             WHERE metering_point_id = @pointId AND delivery_date = @deliveryDate;
            """,
            connection);
        command.Parameters.AddWithValue("pointId", meteringPointId);
        command.Parameters.AddWithValue("deliveryDate", deliveryDate);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct))
        {
            return null;
        }

        return new DailyPositionRow(
            reader.GetDecimal(0),
            reader.GetDecimal(1),
            reader.GetDecimal(2),
            reader.GetDecimal(3),
            reader.GetDecimal(4),
            reader.GetString(5),
            reader.GetFieldValue<Guid[]>(6));
    }

    public async Task<IReadOnlyList<AlertRow>> ReadAlertsAsync(
        Guid meteringPointId, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var command = new NpgsqlCommand(
            """
            SELECT id, kind, status, metering_point_id, brp_id, delivery_date, summary, detail,
                   resolved_at
              FROM metering.operational_alert
             WHERE metering_point_id = @pointId
             ORDER BY raised_at, kind;
            """,
            connection);
        command.Parameters.AddWithValue("pointId", meteringPointId);

        var rows = new List<AlertRow>();
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            rows.Add(new AlertRow(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetGuid(3),
                reader.IsDBNull(4) ? null : reader.GetGuid(4),
                reader.IsDBNull(5) ? null : reader.GetFieldValue<DateOnly>(5),
                reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.IsDBNull(8) ? null : reader.GetFieldValue<DateTimeOffset>(8)));
        }

        return rows;
    }

    public async Task<string> ReadProductionExpectationAsync(Guid meteringPointId, CancellationToken ct) =>
        await ScalarAsync<string>(
            "SELECT production_expectation FROM customer.metering_point WHERE id = @id;",
            ct,
            ("id", meteringPointId));

    public async Task<string?> ReadExpectationSourceAsync(Guid meteringPointId, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var command = new NpgsqlCommand(
            "SELECT expectation_source FROM customer.metering_point WHERE id = @id;", connection);
        command.Parameters.AddWithValue("id", meteringPointId);
        var value = await command.ExecuteScalarAsync(ct);
        return value is DBNull or null ? null : (string)value;
    }

    public async Task<DateTimeOffset?> ReadFirstProductionObservedAtAsync(
        Guid meteringPointId, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await using var command = new NpgsqlCommand(
            "SELECT first_production_observed_at FROM customer.metering_point WHERE id = @id;",
            connection);
        command.Parameters.AddWithValue("id", meteringPointId);
        var value = await command.ExecuteScalarAsync(ct);
        return value is DBNull or null ? null : (DateTimeOffset)value;
    }

    /// <summary>
    /// The database spelling, written out rather than taken from the EF converter: this seeder
    /// bypasses EF entirely, so borrowing the converter would make the fixture agree with the
    /// mapping by construction instead of by test.
    /// </summary>
    private static string ExpectationText(ProductionExpectation expectation) => expectation switch
    {
        ProductionExpectation.Never => "NEVER",
        ProductionExpectation.Expected => "EXPECTED",
        ProductionExpectation.Unknown => "UNKNOWN",
        _ => throw new ArgumentOutOfRangeException(nameof(expectation)),
    };

    /// <summary>
    /// Thirteen fixed digits plus a five-digit sequence keeps every generated EAN eighteen digits
    /// and unique per process. The prefix is derived from a fresh GUID so two test processes
    /// against one container do not collide.
    /// </summary>
    private static string BuildEanPrefix()
    {
        var noise = (uint)Guid.NewGuid().GetHashCode();
        return "8716" + (noise % 1_000_000_000u).ToString("D9", CultureInfo.InvariantCulture) + "9";
    }

    private async Task<NpgsqlConnection> OpenAsync(CancellationToken ct)
    {
        var connection = new NpgsqlConnection(postgres.ConnectionString);
        await connection.OpenAsync(ct);
        return connection;
    }

    private async Task ExecuteAsync(
        string sql, CancellationToken ct, params (string Name, object Value)[] parameters)
    {
        await using var connection = await OpenAsync(ct);
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        await command.ExecuteNonQueryAsync(ct);
    }

    private async Task<T> ScalarAsync<T>(
        string sql, CancellationToken ct, params (string Name, object Value)[] parameters)
    {
        await using var connection = await OpenAsync(ct);
        await using var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        var result = await command.ExecuteScalarAsync(ct);
        return (T)result!;
    }
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
docker info > /dev/null
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~RollupFixtureSelfTests"
```

Expected: PASS — 5 tests.
⚠ If Postgres times out, retry once before investigating: Testcontainers under parallel suites is the
usual cause, not a regression.

- [ ] **Step 6: Verify by mutation that the length self-tests are not vacuous**

The failure this fixture must not have is seeding a fixed ninety-six rows on a date that is not
ninety-six intervals long — every day-state test below compares a reading count against
`ExpectedIntervalCount`, so a truncating seeder would hold the autumn day at `PARTIAL` for a reason
that has nothing to do with the rule under test, and the completeness suite would look broken.

In `SeedVersionAsync`, truncate the reading loop:

```csharp
        for (var index = 0; index < Math.Min(quantitiesByPos.Count, 96); index++)   // MUTATION
```

Predict: `A_hundred_point_autumn_day_is_seeded_at_the_dates_own_length` fails first on

```
Shouldly.ShouldAssertException : await world.CountIntervalReadingsAsync(versionId, autumn, ct)
    should be
100L
    but was
96L
```

and `A_ninety_two_point_spring_day_is_seeded_at_the_dates_own_length` stays **green** — 92 is under
the cap. That asymmetry is the point: a suite written only against the spring day would certify the
truncation.

Run it, confirm both, restore.

- [ ] **Step 7: Second mutation — prove the instants are the calendar's**

Change the `intervalStart` argument to a UTC-elapsed walk from the day's own first instant:

```csharp
                ("intervalStart", calendar.IntervalStart(deliveryDate, 1).AddMinutes(15 * (pos - 1))),
```

Predict: **nothing goes red**, and that is the honest result to record. Stored as `timestamptz`, the
autumn day's hundred interval starts really are a contiguous run of fifteen-minute steps — the
repeated hour repeats in *local labelling*, not in elapsed time, and Npgsql hands back a
`DateTimeOffset` at UTC in either case. The DST failure design §10 row 3 names lives in the
`Pos → local label` mapping and in `IsDstDuplicate`, and **plan 1 owns that mutation**, on
`IMarketCalendar` itself.

Record the null result in the fixture's class remarks rather than deleting it — a mutation that
found nothing is evidence about where the risk is not, and the next reader would otherwise re-derive
it. Restore the calendar call regardless: the fixture must not carry a second answer to a question
`Infrastructure.Time` already owns.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
git add tests/PeakPower.Integration.Tests/Rollup/RollupFixture.cs \
        tests/PeakPower.Integration.Tests/Rollup/RollupFixtureSelfTests.cs \
        tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj
git commit -m "Seed the rollup world through raw SQL and the market calendar

Contract section 5 gives IntervalReading, MeteringPointDayState, DailyPosition and
OperationalAlert properties only, so a seeder built on the entities would couple this plan to
member signatures the contract does not pin. Column names it does pin, exhaustively, in
section 6.

Verified by two mutations. Truncating the reading loop at 96 turns the autumn self-test red
reading 96 against 100 and leaves the spring one green, which is why both lengths are seeded.
Replacing IntervalStart with a UTC-elapsed walk turns nothing red - recorded rather than
deleted, because stored as timestamptz the autumn day's hundred starts really are contiguous
and the DST failure lives in the local labelling, which is plan 1's to mutate."

---

### Task 6: `OperationalAlertRaiser` and `AlertCopy` — the conditions, deduped, with no channel behind them

Design §3.2 defers alert **delivery**, not alert **conditions**: `[F02-R12]`, `[F02-R26]`,
`[F02-R34]`, `[F02-R35]` and `[F02-R45]` each write an `operational_alert` row that the employee
data-health screens render, and no mail, pager or webhook is wired. `[DEC-104]` is one operator with
no rota, so a channel with no rota behind it is decoration.

⚠ **Raising is idempotent while an alert is open.** A `PARTIAL` day is recomputed every time a
document touches it and a silent point is swept on every schedule tick. Without a dedupe the table
holds one row per sweep and the employee screen is unreadable inside a day — which is how an alert
system stops being read, which is worse than not having one.

⚠ **The dedupe key is `(kind, metering_point_id, delivery_date)` among rows with
`resolved_at IS NULL`**, compared with `IS NOT DISTINCT FROM` so that two nulls match. Plain `=`
against a null yields null, the `WHERE NOT EXISTS` then finds nothing, and every silence sweep writes
a fresh row — a bug that looks exactly like the dedupe working until you count.

⚠ **The kind is written as SCREAMING_SNAKE text by a hand-written switch, not by the EF converter.**
Raw SQL bypasses `EnumToScreamingSnakeConverter` entirely. A test asserts the switch is total over
the enum and that its five strings are exactly the five in `ck` on `metering.operational_alert`.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Alerts/OperationalAlertRaiser.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Alerts/AlertCopy.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/OperationalAlertRaiserTests.cs`

**Interfaces:**
- Consumes: `IOperationalAlertRaiser`, `OperationalAlertRequest` (task 1);
  `PeakPower.Persistence.PeakPowerDbContext`; `PeakPower.Domain.Metering.OperationalAlertKind`.
- Produces:
  - `PeakPower.Ingestion.Alerts.OperationalAlertRaiser : IOperationalAlertRaiser`, constructed as
    `new OperationalAlertRaiser(PeakPowerDbContext db, ILogger<OperationalAlertRaiser> logger)`
  - `PeakPower.Ingestion.Alerts.OperationalAlertRaiser.KindText(OperationalAlertKind kind)` — `public static string`
  - `PeakPower.Ingestion.Alerts.AlertCopy` with
    `MissingProductionSeriesFromBrp(string ean, DateOnly date, string brpCode)`,
    `MissingProductionDeclaration(string ean, DateOnly date)`,
    `ProductionExpectationPromoted(string ean, DateOnly date)`,
    `PostWindowReconciliation(string ean, DateOnly date)`,
    `MeteringPointSilent(string ean, string brpCode, int days)` — each returning
    `(string Summary, string Detail)`

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/OperationalAlertRaiserTests.cs`:

```csharp
using Microsoft.Extensions.Logging.Abstractions;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Infrastructure.Time;
using PeakPower.Ingestion.Alerts;
using PeakPower.Integration.Tests.Database;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Rollup;

/// <summary>
/// The alert conditions of [F02-R12], [F02-R26], [F02-R34], [F02-R35] and [F02-R45], against a real
/// database.
/// <para>
/// <b>No channel delivers these</b> (design §3.2) — the conditions are built and tested, the
/// employee data-health screens render the rows, and no mail, pager or webhook is wired. Design §1.1
/// records that this is why the Phase-1 exit criterion "ingestion alerting proven by a deliberate
/// outage test" is not met, and that it is deferred in writing rather than quietly.
/// </para>
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class OperationalAlertRaiserTests(PostgresFixture postgres)
{
    private static readonly DateTimeOffset RaisedAt = new(2026, 8, 13, 4, 2, 11, TimeSpan.Zero);
    private static readonly DateOnly Delivery = new(2026, 8, 12);

    private RollupFixture NewWorld() => new(postgres, new MarketCalendar(TimeProvider.System));

    private (OperationalAlertRaiser Raiser, PeakPower.Persistence.PeakPowerDbContext Db) NewRaiser()
    {
        var db = postgres.CreateContext();
        return (new OperationalAlertRaiser(db, NullLogger<OperationalAlertRaiser>.Instance), db);
    }

    [Fact]
    public async Task Raising_writes_one_open_row()
    {
        var ct = TestContext.Current.CancellationToken;
        var world = NewWorld();
        var (customerId, pointId) = await SeedPointAsync(world, ct);
        var (raiser, db) = NewRaiser();
        await using var _ = db;

        var written = await raiser.RaiseAsync(
            Request(OperationalAlertKind.MissingProductionDeclaration, pointId), ct);

        written.ShouldBeTrue();

        var alerts = await world.ReadAlertsAsync(pointId, ct);
        alerts.Count.ShouldBe(1);
        alerts[0].Kind.ShouldBe("MISSING_PRODUCTION_DECLARATION");
        alerts[0].Status.ShouldBe("OPEN");
        alerts[0].DeliveryDate.ShouldBe(Delivery);
        alerts[0].ResolvedAt.ShouldBeNull();
        customerId.ShouldNotBe(Guid.Empty);
    }

    /// <summary>
    /// The assertion the whole design rests on. A PARTIAL day is recomputed on every document that
    /// touches it, and a silent point is swept on every schedule tick.
    /// </summary>
    [Fact]
    public async Task Raising_the_same_condition_twice_writes_one_row_and_says_so()
    {
        var ct = TestContext.Current.CancellationToken;
        var world = NewWorld();
        var (_, pointId) = await SeedPointAsync(world, ct);
        var (raiser, db) = NewRaiser();
        await using var _ = db;

        var first = await raiser.RaiseAsync(
            Request(OperationalAlertKind.MissingProductionDeclaration, pointId), ct);
        var second = await raiser.RaiseAsync(
            Request(OperationalAlertKind.MissingProductionDeclaration, pointId), ct);
        var third = await raiser.RaiseAsync(
            Request(OperationalAlertKind.MissingProductionDeclaration, pointId), ct);

        first.ShouldBeTrue();
        second.ShouldBeFalse();
        third.ShouldBeFalse();

        (await world.ReadAlertsAsync(pointId, ct)).Count.ShouldBe(1);
    }

    [Fact]
    public async Task A_different_delivery_date_is_a_different_condition()
    {
        var ct = TestContext.Current.CancellationToken;
        var world = NewWorld();
        var (_, pointId) = await SeedPointAsync(world, ct);
        var (raiser, db) = NewRaiser();
        await using var _ = db;

        await raiser.RaiseAsync(
            Request(OperationalAlertKind.MissingProductionDeclaration, pointId), ct);
        await raiser.RaiseAsync(
            Request(OperationalAlertKind.MissingProductionDeclaration, pointId,
                    deliveryDate: Delivery.AddDays(-1)), ct);

        (await world.ReadAlertsAsync(pointId, ct)).Count.ShouldBe(2);
    }

    [Fact]
    public async Task A_different_kind_is_a_different_condition()
    {
        var ct = TestContext.Current.CancellationToken;
        var world = NewWorld();
        var (_, pointId) = await SeedPointAsync(world, ct);
        var (raiser, db) = NewRaiser();
        await using var _ = db;

        await raiser.RaiseAsync(
            Request(OperationalAlertKind.MissingProductionDeclaration, pointId), ct);
        await raiser.RaiseAsync(
            Request(OperationalAlertKind.PostWindowReconciliation, pointId), ct);

        (await world.ReadAlertsAsync(pointId, ct)).Count.ShouldBe(2);
    }

    /// <summary>
    /// A silence alert carries no delivery date — silence is about a point, not a day. Two nulls
    /// must match for the dedupe to work, which is why the SQL uses IS NOT DISTINCT FROM and not =.
    /// </summary>
    [Fact]
    public async Task A_condition_with_no_delivery_date_still_dedupes()
    {
        var ct = TestContext.Current.CancellationToken;
        var world = NewWorld();
        var (_, pointId) = await SeedPointAsync(world, ct);
        var (raiser, db) = NewRaiser();
        await using var _ = db;

        await raiser.RaiseAsync(
            Request(OperationalAlertKind.MeteringPointSilent, pointId, deliveryDate: null), ct);
        var second = await raiser.RaiseAsync(
            Request(OperationalAlertKind.MeteringPointSilent, pointId, deliveryDate: null), ct);

        second.ShouldBeFalse();
        (await world.ReadAlertsAsync(pointId, ct)).Count.ShouldBe(1);
    }

    [Fact]
    public async Task Resolving_closes_every_open_alert_of_that_kind_for_that_point()
    {
        var ct = TestContext.Current.CancellationToken;
        var world = NewWorld();
        var (_, pointId) = await SeedPointAsync(world, ct);
        var (raiser, db) = NewRaiser();
        await using var _ = db;

        await raiser.RaiseAsync(
            Request(OperationalAlertKind.MeteringPointSilent, pointId, deliveryDate: null), ct);

        var resolvedAt = RaisedAt.AddDays(2);
        var closed = await raiser.ResolveOpenAsync(
            OperationalAlertKind.MeteringPointSilent, pointId, deliveryDate: null, resolvedAt, ct);

        closed.ShouldBe(1);

        var alerts = await world.ReadAlertsAsync(pointId, ct);
        alerts[0].Status.ShouldBe("RESOLVED");
        alerts[0].ResolvedAt.ShouldNotBeNull();
    }

    /// <summary>
    /// After a resolve, the same condition can be raised again — the point went silent, came back,
    /// and went silent once more. A dedupe that keyed on resolved rows too would hide the second
    /// outage completely.
    /// </summary>
    [Fact]
    public async Task A_resolved_condition_can_be_raised_again()
    {
        var ct = TestContext.Current.CancellationToken;
        var world = NewWorld();
        var (_, pointId) = await SeedPointAsync(world, ct);
        var (raiser, db) = NewRaiser();
        await using var _ = db;

        await raiser.RaiseAsync(
            Request(OperationalAlertKind.MeteringPointSilent, pointId, deliveryDate: null), ct);
        await raiser.ResolveOpenAsync(
            OperationalAlertKind.MeteringPointSilent, pointId, deliveryDate: null, RaisedAt.AddDays(1), ct);

        var raisedAgain = await raiser.RaiseAsync(
            Request(OperationalAlertKind.MeteringPointSilent, pointId, deliveryDate: null), ct);

        raisedAgain.ShouldBeTrue();
        (await world.ReadAlertsAsync(pointId, ct)).Count.ShouldBe(2);
    }

    // ── The five strings the CHECK constraint allows ───────────────────────────────────────

    [Theory]
    [InlineData(OperationalAlertKind.ValidationFailure, "VALIDATION_FAILURE")]
    [InlineData(OperationalAlertKind.MeteringPointSilent, "METERING_POINT_SILENT")]
    [InlineData(OperationalAlertKind.ProductionExpectationPromoted, "PRODUCTION_EXPECTATION_PROMOTED")]
    [InlineData(OperationalAlertKind.MissingProductionDeclaration, "MISSING_PRODUCTION_DECLARATION")]
    [InlineData(OperationalAlertKind.PostWindowReconciliation, "POST_WINDOW_RECONCILIATION")]
    public void The_kind_maps_to_the_database_spelling(OperationalAlertKind kind, string text) =>
        OperationalAlertRaiser.KindText(kind).ShouldBe(text, StringCompareShould.IgnoreLineEndings);

    /// <summary>
    /// Every member, and no member left to a default arm. Raw SQL bypasses
    /// EnumToScreamingSnakeConverter, so this switch is the only thing keeping the written text and
    /// the CHECK constraint in agreement — and an unmapped member would be a 23514 in production
    /// rather than a compile error.
    /// </summary>
    [Fact]
    public void Every_alert_kind_has_a_database_spelling()
    {
        foreach (var kind in Enum.GetValues<OperationalAlertKind>())
        {
            var text = OperationalAlertRaiser.KindText(kind);
            text.ShouldNotBeNullOrWhiteSpace();
            text.ShouldBe(text.ToUpperInvariant(), StringCompareShould.IgnoreLineEndings);
        }
    }

    /// <summary>
    /// Every one of the five reaches the database. The CHECK constraint on
    /// metering.operational_alert.kind is what fails if a spelling is wrong, so this is the test
    /// that actually exercises the agreement rather than asserting it against itself.
    /// </summary>
    [Fact]
    public async Task Every_alert_kind_is_accepted_by_the_check_constraint()
    {
        var ct = TestContext.Current.CancellationToken;
        var world = NewWorld();
        var (_, pointId) = await SeedPointAsync(world, ct);
        var (raiser, db) = NewRaiser();
        await using var _ = db;

        foreach (var kind in Enum.GetValues<OperationalAlertKind>())
        {
            (await raiser.RaiseAsync(Request(kind, pointId), ct)).ShouldBeTrue($"{kind}");
        }

        (await world.ReadAlertsAsync(pointId, ct)).Count.ShouldBe(Enum.GetValues<OperationalAlertKind>().Length);
    }

    // ── Copy ───────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Slice 1's copy rules, on every sentence this plan writes: sentence case, no emoji, no icon
    /// set, one sentence ending in a full stop.
    /// </summary>
    [Fact]
    public void Every_alert_sentence_follows_the_copy_rules()
    {
        var sentences = new[]
        {
            AlertCopy.MissingProductionSeriesFromBrp("871687100000000059", Delivery, "PVNED"),
            AlertCopy.MissingProductionDeclaration("871687100000000061", Delivery),
            AlertCopy.ProductionExpectationPromoted("871687100000000011", Delivery),
            AlertCopy.PostWindowReconciliation("871687100000000011", Delivery),
            AlertCopy.MeteringPointSilent("871687100000000027", "PVNED", 3),
        };

        foreach (var (summary, detail) in sentences)
        {
            summary.ShouldEndWith(".");
            summary.ShouldNotContain("  ", Case.Sensitive);
            summary.Length.ShouldBeLessThanOrEqualTo(160);
            detail.ShouldNotBeNullOrWhiteSpace();
            // Sentence case: the first character is a capital and the rest is not shouted.
            char.IsUpper(summary[0]).ShouldBeTrue();
            summary.ShouldNotBe(summary.ToUpperInvariant(), StringCompareShould.IgnoreLineEndings);
        }
    }

    /// <summary>
    /// [F02-R35] and [DEC-112]. The two PARTIAL cases are the same day state and different
    /// sentences, because the fix is different: an EXPECTED point with no A01 is a resend to chase
    /// from the BRP, and an UNKNOWN one is a declaration to obtain from the customer. A single
    /// sentence for both routes half the worklist to the wrong desk.
    /// </summary>
    [Fact]
    public void The_two_missing_production_sentences_name_different_owners()
    {
        var fromBrp = AlertCopy.MissingProductionSeriesFromBrp("871687100000000059", Delivery, "PVNED");
        var fromCustomer = AlertCopy.MissingProductionDeclaration("871687100000000061", Delivery);

        fromBrp.Summary.ShouldContain("PVNED", Case.Sensitive);
        fromCustomer.Summary.ShouldNotContain("PVNED", Case.Sensitive);
        fromCustomer.Summary.ShouldContain("declaration", Case.Sensitive);
    }

    /// <summary>
    /// A date-scoped resolve closes that day and leaves every other day open. One day filling in
    /// says nothing about another day that is still short, and a resolve that closed the whole
    /// point would empty the onboarding worklist [F02-R35] on the strength of an unrelated day.
    /// </summary>
    [Fact]
    public async Task Resolving_one_delivery_date_leaves_the_other_days_open()
    {
        var ct = TestContext.Current.CancellationToken;
        var world = NewWorld();
        var (_, pointId) = await SeedPointAsync(world, ct);
        var (raiser, db) = NewRaiser();
        await using var _ = db;

        await raiser.RaiseAsync(
            Request(OperationalAlertKind.MissingProductionDeclaration, pointId, Delivery), ct);
        await raiser.RaiseAsync(
            Request(OperationalAlertKind.MissingProductionDeclaration, pointId,
                    Delivery.AddDays(-1)), ct);

        var closed = await raiser.ResolveOpenAsync(
            OperationalAlertKind.MissingProductionDeclaration, pointId, Delivery,
            RaisedAt.AddDays(1), ct);

        closed.ShouldBe(1);

        var alerts = await world.ReadAlertsAsync(pointId, ct);
        alerts.Count.ShouldBe(2);
        alerts.Count(alert => alert.Status == "OPEN").ShouldBe(1);
        alerts.Single(alert => alert.Status == "OPEN").DeliveryDate.ShouldBe(Delivery.AddDays(-1));
    }

    private static OperationalAlertRequest Request(
        OperationalAlertKind kind, Guid pointId, DateOnly? deliveryDate = null) =>
        new(
            Kind: kind,
            Summary: "A test condition fired.",
            Detail: "Written by OperationalAlertRaiserTests.",
            MeteringPointId: pointId,
            BrpId: RollupFixture.PvnedBrpId,
            InboundMessageId: null,
            DeliveryDate: deliveryDate ?? Delivery,
            RaisedAt: RaisedAt);

    private static async Task<(Guid CustomerId, Guid PointId)> SeedPointAsync(
        RollupFixture world, CancellationToken ct)
    {
        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(
            customerId, world.NextEan(), ProductionExpectation.Unknown, ct);
        return (customerId, pointId);
    }
}
```

⚠ **Note the `Request` helper passes the same `DeliveryDate` default to every kind.** That is
deliberate for the dedupe tests; the real callers pass `null` for `METERING_POINT_SILENT`, because
silence is a property of a point rather than of a day.

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~OperationalAlertRaiserTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'OperationalAlertRaiser' could not be found`.

- [ ] **Step 3: Write `AlertCopy`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Alerts/AlertCopy.cs`:

```csharp
using System.Globalization;

namespace PeakPower.Ingestion.Alerts;

/// <summary>
/// Every sentence this plan writes into <c>metering.operational_alert</c>, in one file.
/// </summary>
/// <remarks>
/// <para>
/// One file so the copy rules are reviewable in one place. Slice 1's rules bind: sentence case
/// everywhere; ALL CAPS only for stat-card labels and table column heads; <b>no emoji and no icon
/// set</b>; every number carries its provenance; empty and disabled states name the reason.
/// </para>
/// <para>
/// ⚠ <b>"Projected" means not yet measured; "provisional" means not yet accepted. Never swap them.</b>
/// Nothing in this file says "projected", because none of these conditions is about a forecast.
/// </para>
/// <para>
/// <b>The two missing-production sentences are deliberately different</b>, and both are
/// <c>[F02-R35]</c>. An EXPECTED point with no A01 series is a resend to chase from the BRP; an
/// UNKNOWN one is a declaration to obtain from the customer <c>[DEC-112]</c>, routed to onboarding,
/// which owns it <c>[F01-R54]</c>. They share a day state and an alert kind — the enum set is fixed
/// by the column's CHECK — so the sentence is the only thing that routes them, and one sentence for
/// both sends half the worklist to the wrong desk.
/// </para>
/// </remarks>
public static class AlertCopy
{
    /// <summary>
    /// <c>[F02-R35]</c>, the EXPECTED arm. Integration-spec §8.3: "alert naming <b>PVNed</b> first".
    /// </summary>
    public static (string Summary, string Detail) MissingProductionSeriesFromBrp(
        string ean, DateOnly deliveryDate, string brpCode) =>
        (
            $"No production series arrived from {brpCode} for {ean} on {Date(deliveryDate)}.",
            $"The connection's production expectation is EXPECTED, so the A01 series is required "
            + $"for the day to be complete. The day is held at PARTIAL and is not invoiced. The fix "
            + $"is a resend from {brpCode}; the raw message log shows what did arrive."
        );

    /// <summary>
    /// <c>[F02-R35]</c>, the UNKNOWN arm, amended by <c>[DEC-112]</c>. The alert names the missing
    /// customer declaration, not the BRP, because the fix is to obtain the declaration rather than
    /// to chase a resend.
    /// </summary>
    public static (string Summary, string Detail) MissingProductionDeclaration(
        string ean, DateOnly deliveryDate) =>
        (
            $"No production declaration is recorded for {ean}, so its day on {Date(deliveryDate)} "
            + $"cannot be judged complete.",
            "The production expectation is UNKNOWN, which is read as EXPECTED for completeness "
            + "[F02-R32] - the conservative direction, because the alternative is invoicing a "
            + "producing site on consumption alone. The fix belongs to onboarding, not to the BRP: "
            + "the customer declares whether this connection produces [F01-R54]. SJV and profile "
            + "fractions may sanity-check that declaration; they never set it."
        );

    /// <summary>
    /// <c>[F02-R34]</c>. The document was stored and used normally, and the master record moved to
    /// match it in the same transaction.
    /// </summary>
    public static (string Summary, string Detail) ProductionExpectationPromoted(
        string ean, DateOnly deliveryDate) =>
        (
            $"Production was observed on {ean} for {Date(deliveryDate)}, which was recorded as "
            + $"never producing.",
            "The reading is stored and used normally - a document is never discarded because master "
            + "data disagrees with it - and the same transaction moved the connection to EXPECTED "
            + "with source OBSERVED and stamped first_production_observed_at. Observed production "
            + "is evidence and a declaration is not, so the platform believes the data. Nothing "
            + "needs doing unless the customer disputes it."
        );

    /// <summary>
    /// <c>[F02-R45]</c>, and the reason it is an informational notice rather than an operator
    /// alert: under <c>[DEC-98]</c> a post-window version is expected behaviour, not a
    /// contradiction of what the BRP says it sends.
    /// </summary>
    public static (string Summary, string Detail) PostWindowReconciliation(
        string ean, DateOnly deliveryDate) =>
        (
            $"A finalised day reopened: {ean} on {Date(deliveryDate)} received a newer version "
            + $"after its correction window.",
            "This is routine under DEC-98. FINAL means only that nothing newer arrived within the "
            + "ten-working-day window - a status, not a guarantee - so the date returns to "
            + "PROVISIONAL, the rollup is recomputed and it re-finalises on the same rule. It is an "
            + "informational notice to Finance rather than an operator alert, because any invoice "
            + "covering the date is flagged and the delta becomes a correction invoice [DEC-99]."
        );

    /// <summary>
    /// <c>[F02-R26]</c>, amended by <c>[DEC-69]</c>: the expected cadence is a property of the
    /// metering point's BRP, and the alert names the BRP that owes the data.
    /// </summary>
    public static (string Summary, string Detail) MeteringPointSilent(
        string ean, string brpCode, int daysSilent) =>
        (
            $"Nothing has arrived for {ean} from {brpCode} in {daysSilent} days.",
            $"Under DEC-38 the expectation is exact - one document per EAN per day - so silence is "
            + $"detected per connection rather than inferred from a batch. Two cadence windows have "
            + $"passed with no version. {brpCode} owes the data; the inbound message log shows "
            + $"whether anything at all is arriving from that BRP."
        );

    /// <summary>
    /// The date, written the way the rest of the platform writes a machine-readable date in an
    /// operational record: ISO, invariant, unambiguous. The employee screen formats it for display;
    /// this string is what a log grep has to match.
    /// </summary>
    private static string Date(DateOnly date) =>
        date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
```

- [ ] **Step 4: Write `OperationalAlertRaiser`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Alerts/OperationalAlertRaiser.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Metering;
using PeakPower.Persistence;

namespace PeakPower.Ingestion.Alerts;

/// <summary>
/// Writes and closes rows in <c>metering.operational_alert</c>. No channel delivers them
/// (design §3.2); the employee data-health screens are the whole of the delivery in slice 2.
/// </summary>
/// <remarks>
/// <para>
/// <b>Raw SQL rather than the change tracker</b>, for two reasons. The insert is conditional —
/// "write this unless an equivalent one is already open" — which is a single statement in
/// PostgreSQL and a lost-update race in a read-modify-write, and <c>operational_alert</c> is
/// written by the apply transaction and by two background jobs that do not coordinate. And shared
/// contract §5 gives <c>OperationalAlert</c> properties only, with no factory: the class is plan
/// 2's and this plan may not add members to it.
/// </para>
/// <para>
/// Both statements go through <c>db.Database</c>, so they use the context's connection and enlist
/// in whatever transaction the caller has open. That is what makes a promotion alert commit or roll
/// back with the readings that caused it.
/// </para>
/// </remarks>
public sealed class OperationalAlertRaiser(
    PeakPowerDbContext db, ILogger<OperationalAlertRaiser> logger) : IOperationalAlertRaiser
{
    /// <summary>
    /// The database spelling of each kind, as a total switch.
    /// </summary>
    /// <remarks>
    /// ⚠ <b>Raw SQL bypasses <c>EnumToScreamingSnakeConverter</c> entirely</b>, so this switch is
    /// the only thing keeping the written text and the column's CHECK constraint in agreement. It
    /// has no default arm that guesses: an unmapped member throws here rather than reaching the
    /// database as a 23514 whose message names a constraint rather than a missing case.
    /// </remarks>
    public static string KindText(OperationalAlertKind kind) => kind switch
    {
        OperationalAlertKind.ValidationFailure => "VALIDATION_FAILURE",
        OperationalAlertKind.MeteringPointSilent => "METERING_POINT_SILENT",
        OperationalAlertKind.ProductionExpectationPromoted => "PRODUCTION_EXPECTATION_PROMOTED",
        OperationalAlertKind.MissingProductionDeclaration => "MISSING_PRODUCTION_DECLARATION",
        OperationalAlertKind.PostWindowReconciliation => "POST_WINDOW_RECONCILIATION",
        _ => throw new ArgumentOutOfRangeException(
            nameof(kind),
            kind,
            "Every OperationalAlertKind needs a database spelling here; the column's CHECK "
            + "constraint lists exactly five and an unmapped member is a 23514 at run time."),
    };

    public async Task<bool> RaiseAsync(OperationalAlertRequest request, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(request.Summary);

        var kind = KindText(request.Kind);

        // ⚠ IS NOT DISTINCT FROM, not =. A silence alert carries no delivery_date, and `NULL = NULL`
        // is NULL, so the NOT EXISTS would find nothing and every sweep would write a fresh row -
        // a bug that looks exactly like the dedupe working until somebody counts.
        var written = await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO metering.operational_alert
                    (kind, status, metering_point_id, brp_id, inbound_message_id, delivery_date,
                     summary, detail, raised_at)
             SELECT {kind}, 'OPEN', {request.MeteringPointId}::uuid, {request.BrpId}::uuid,
                    {request.InboundMessageId}::uuid, {request.DeliveryDate}::date,
                    {request.Summary}, {request.Detail}, {request.RaisedAt}
              WHERE NOT EXISTS (
                    SELECT 1
                      FROM metering.operational_alert existing
                     WHERE existing.kind = {kind}
                       AND existing.resolved_at IS NULL
                       AND existing.metering_point_id IS NOT DISTINCT FROM {request.MeteringPointId}::uuid
                       AND existing.delivery_date     IS NOT DISTINCT FROM {request.DeliveryDate}::date);
             """,
            ct);

        if (written == 0)
        {
            logger.LogDebug(
                "An open {Kind} alert already covers metering point {MeteringPointId} on {DeliveryDate}; "
                + "no second row written.",
                kind, request.MeteringPointId, request.DeliveryDate);
            return false;
        }

        logger.LogInformation(
            "Raised {Kind} for metering point {MeteringPointId} on {DeliveryDate}: {Summary}",
            kind, request.MeteringPointId, request.DeliveryDate, request.Summary);
        return true;
    }

    public async Task<int> ResolveOpenAsync(
        OperationalAlertKind kind,
        Guid meteringPointId,
        DateOnly? deliveryDate,
        DateTimeOffset resolvedAt,
        CancellationToken ct)
    {
        var kindText = KindText(kind);

        // A null deliveryDate resolves every open alert of this kind for this point, whatever date
        // each names - a point that went silent and came back is one recovery, not one per day it
        // missed. A non-null one resolves that day alone, because one day filling in says nothing
        // about another day that is still short.
        var closed = await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE metering.operational_alert
                SET status = 'RESOLVED', resolved_at = {resolvedAt}
              WHERE kind = {kindText}
                AND resolved_at IS NULL
                AND metering_point_id = {meteringPointId}
                AND ({deliveryDate}::date IS NULL
                     OR delivery_date IS NOT DISTINCT FROM {deliveryDate}::date);
             """,
            ct);

        if (closed > 0)
        {
            logger.LogInformation(
                "Resolved {Count} open {Kind} alert(s) for metering point {MeteringPointId}.",
                closed, kindText, meteringPointId);
        }

        return closed;
    }
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~OperationalAlertRaiserTests"
```

Expected: PASS — 16 test cases (the five-row theory expands).

If `ExecuteSqlInterpolatedAsync` reports
`42P18: could not determine data type of parameter`, a null argument reached a position without a
cast — re-check that every nullable interpolation carries its `::uuid` or `::date`.

- [ ] **Step 6: MUTATION — swap `IS NOT DISTINCT FROM` for `=` and predict the failure**

This is the mutation the dedupe actually needs, and it is not the obvious one. Deleting the whole
`WHERE NOT EXISTS` clause turns four tests red at once and proves only that a dedupe exists. The
failure that reaches production is the null-comparison one.

In `RaiseAsync`, change the two dedupe comparisons:

```csharp
                       AND existing.metering_point_id = {request.MeteringPointId}::uuid
                       AND existing.delivery_date     = {request.DeliveryDate}::date);
```

**Predicted failure:** `A_condition_with_no_delivery_date_still_dedupes` fails with

```
Shouldly.ShouldAssertException : second
    should be
False
    but was
True
```

and `(await world.ReadAlertsAsync(pointId, ct)).Count should be 1 but was 2`.
**`Raising_the_same_condition_twice_writes_one_row_and_says_so` stays green** — it passes a non-null
delivery date, where `=` and `IS NOT DISTINCT FROM` agree. That asymmetry is why the no-delivery-date
test exists at all.

Run it, confirm both halves of the prediction, restore.

- [ ] **Step 7: Second mutation — prove the resolve is scoped to open rows**

Change `ResolveOpenAsync`'s `WHERE` to drop `AND resolved_at IS NULL`.

Predict: `A_resolved_condition_can_be_raised_again` stays green (nothing about raising changed) and
`Resolving_closes_every_open_alert_of_that_kind_for_that_point` **also** stays green — the mutation
is invisible to both. Add the case that catches it before restoring: resolve twice and assert the
second returns `0`.

Append to `OperationalAlertRaiserTests`:

```csharp
    /// <summary>
    /// Resolving an already-resolved alert changes nothing and says so. The count matters: the
    /// silence sweep resolves on every tick for every point that is no longer silent, and a resolve
    /// that kept re-stamping resolved_at would move the recovery moment forward every minute and
    /// destroy the one figure an operator would use to measure the outage.
    /// </summary>
    [Fact]
    public async Task Resolving_twice_closes_nothing_the_second_time()
    {
        var ct = TestContext.Current.CancellationToken;
        var world = NewWorld();
        var (_, pointId) = await SeedPointAsync(world, ct);
        var (raiser, db) = NewRaiser();
        await using var _ = db;

        await raiser.RaiseAsync(
            Request(OperationalAlertKind.MeteringPointSilent, pointId, deliveryDate: null), ct);

        var firstResolvedAt = RaisedAt.AddDays(1);
        (await raiser.ResolveOpenAsync(
            OperationalAlertKind.MeteringPointSilent, pointId, deliveryDate: null,
            firstResolvedAt, ct)).ShouldBe(1);
        (await raiser.ResolveOpenAsync(
            OperationalAlertKind.MeteringPointSilent, pointId, deliveryDate: null,
            RaisedAt.AddDays(5), ct)).ShouldBe(0);

        var alerts = await world.ReadAlertsAsync(pointId, ct);
        alerts[0].ResolvedAt!.Value.ToUniversalTime().ShouldBe(firstResolvedAt);
    }
```

Re-run with the mutation in place and predict:
`Resolving_twice_closes_nothing_the_second_time` fails on `should be 0 but was 1`, and then on
`alerts[0].ResolvedAt` reading `2026-08-18T04:02:11Z` where the fixture demands
`2026-08-14T04:02:11Z`. Run, confirm, restore `AND resolved_at IS NULL`, re-run green.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~OperationalAlertRaiserTests"
git add src/Infrastructure/PeakPower.Ingestion/Alerts/ \
        tests/PeakPower.Integration.Tests/Rollup/OperationalAlertRaiserTests.cs
git commit -m "Write the alert conditions, deduped while open, with no channel behind them

Design 3.2 defers alert DELIVERY, not the conditions. F02-R12, R26, R34, R35 and R45 each write
an operational_alert row the employee screens render; no mail, pager or webhook is wired,
because DEC-104 is one operator with no rota and a channel with no rota is decoration.

Deduped on (kind, metering point, delivery date) among open rows. Verified by mutation: swapping
IS NOT DISTINCT FROM for = leaves the delivery-dated case green and turns the silence case red,
because NULL = NULL is NULL and every sweep would then write a fresh row. Dropping
'resolved_at IS NULL' from the resolve was invisible to the suite until a resolve-twice case was
added, which is why that case is there.

The kind-to-text switch is hand-written and total: raw SQL bypasses EnumToScreamingSnakeConverter,
so it is the only thing agreeing with the column's CHECK, and all five are driven through a real
database rather than compared against themselves."

---

### Task 7: `DayStateRecomputer` — the four `production_expectation` cases against a real database

Task 2 proved the rule in isolation. This is the rule wired to `customer.metering_point`,
`metering.interval_data_version` and `metering.interval_reading`, writing
`metering.metering_point_day_state`, with the alerts and the reopen edge attached. Design §5 step 7's
"independently testable by" reads: *"Including the case where an A01 series promotes a `NEVER` point
in the same transaction, and the §4.1 worked case."* Those are tasks 8 and 9; this task is the four
expectation cases and the state machine around them.

⚠ **It opens no transaction.** The apply transaction that calls it owns one (contract §9.6), and
opening a second would commit a promotion whose readings then rolled back.

⚠ **It reads the metering point's expectation *after* any promotion this call performed.** Passing
the pre-promotion value into `DayCompleteness` would mark a connection that has just been proven to
produce as a declared zero, which is the exact inversion `[F02-R34]` exists to prevent.

⚠ **`last_corrected_at` is stamped whenever a superseded version exists for that (point, date).** It
drives the chart's corrected-on marker (contract §5), so it is about supersession in general, not
about the post-window case specifically.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Rollup/DayStateRecomputer.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/DayStateRecomputerTests.cs`

**Interfaces:**
- Consumes: `IDayStateRecomputer`, `DayRecomputeRequest`, `DayRecomputeResult` (task 1);
  `DayCompleteness`, `DailyPositionCalculator`, `IntervalPoint`, `DailyPositionTotals` (tasks 2, 3);
  `MeteringPoint.RecordObservedProduction`, `.IngestionPromotionActor` (task 4);
  `IOperationalAlertRaiser`, `AlertCopy` (task 6); `IMarketCalendar`; `PeakPowerDbContext`.
- Produces:
  - `PeakPower.Ingestion.Rollup.DayStateRecomputer : IDayStateRecomputer`, constructed as
    `new DayStateRecomputer(PeakPowerDbContext db, IMarketCalendar calendar, IOperationalAlertRaiser alerts, ILogger<DayStateRecomputer> logger)`
  - `DayStateRecomputer.DayStateText(MeteringDayState state)` — `public static string`

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/DayStateRecomputerTests.cs`:

```csharp
using Microsoft.Extensions.Logging.Abstractions;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Infrastructure.Time;
using PeakPower.Ingestion.Alerts;
using PeakPower.Ingestion.Rollup;
using PeakPower.Integration.Tests.Database;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Rollup;

/// <summary>
/// Integration-spec §8.3's completeness table, wired to a real database — and design §7.8's two
/// halves in particular: a NEVER point with only an A02 series reaches complete, and an EXPECTED or
/// UNKNOWN one with only an A02 series stays PARTIAL and writes an operational_alert row.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class DayStateRecomputerTests(PostgresFixture postgres)
{
    private static readonly DateOnly Delivery = new(2026, 8, 12);
    private static readonly DateTimeOffset ReceivedAt = new(2026, 8, 13, 4, 2, 11, TimeSpan.Zero);

    private sealed record Harness(
        RollupFixture World,
        DayStateRecomputer Recomputer,
        PeakPower.Persistence.PeakPowerDbContext Db,
        Guid CustomerId,
        Guid PointId,
        Guid MessageId);

    private async Task<Harness> ArrangeAsync(ProductionExpectation expectation, CancellationToken ct)
    {
        var calendar = new MarketCalendar(TimeProvider.System);
        var world = new RollupFixture(postgres, calendar);
        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(customerId, world.NextEan(), expectation, ct);
        var messageId = await world.SeedInboundMessageAsync(ReceivedAt, ct);

        var db = postgres.CreateContext();
        var recomputer = new DayStateRecomputer(
            db,
            calendar,
            new OperationalAlertRaiser(db, NullLogger<OperationalAlertRaiser>.Instance),
            NullLogger<DayStateRecomputer>.Instance);

        return new Harness(world, recomputer, db, customerId, pointId, messageId);
    }

    private static DayRecomputeRequest Request(Guid pointId, DateTimeOffset? newVersionReceivedAt) =>
        new(pointId, Delivery, Guid.CreateVersion7(), newVersionReceivedAt);

    private static IReadOnlyList<decimal> Flat(int count, decimal each) =>
        [.. Enumerable.Repeat(each, count)];

    // ── Design §7.8, first half ────────────────────────────────────────────────────────────

    /// <summary>
    /// The case [DEC-65] exists for, end to end. PVNed sends no A01 series at all for a connection
    /// that never produces, so a completeness test written as "both directions present" would hold
    /// this day at PARTIAL forever and block its invoicing — and the symptom would look like a
    /// PVNed fault.
    /// </summary>
    [Fact]
    public async Task A_never_point_with_only_a_consumption_series_reaches_provisional()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ProductionExpectation.Never, ct);
        await using var _ = h.Db;

        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            ReceivedAt, Flat(96, 1m), ct);

        var result = await h.Recomputer.RecomputeAsync(Request(h.PointId, ReceivedAt), ct);

        result.State.ShouldBe(MeteringDayState.Provisional);
        result.ConsumptionComplete.ShouldBeTrue();
        result.ProductionComplete.ShouldBeTrue();
        result.ProductionIsDeclaredZero.ShouldBeTrue();

        var row = await h.World.ReadDayStateAsync(h.PointId, Delivery, ct);
        row.ShouldNotBeNull();
        row.State.ShouldBe("PROVISIONAL");
        row.ExpectedIntervalCount.ShouldBe((short)96);
        row.ProductionIsDeclaredZero.ShouldBeTrue();

        // [F02-R33]'s declared zero is not an absence, so there is nothing to alert about.
        (await h.World.ReadAlertsAsync(h.PointId, ct)).ShouldBeEmpty();
    }

    // ── Design §7.8, second half ───────────────────────────────────────────────────────────

    [Fact]
    public async Task An_expected_point_with_only_a_consumption_series_stays_partial_and_alerts()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ProductionExpectation.Expected, ct);
        await using var _ = h.Db;

        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            ReceivedAt, Flat(96, 1m), ct);

        var result = await h.Recomputer.RecomputeAsync(Request(h.PointId, ReceivedAt), ct);

        result.State.ShouldBe(MeteringDayState.Partial);
        result.ProductionComplete.ShouldBeFalse();
        result.ProductionIsDeclaredZero.ShouldBeFalse();

        var alerts = await h.World.ReadAlertsAsync(h.PointId, ct);
        alerts.Count.ShouldBe(1);
        alerts[0].Kind.ShouldBe("MISSING_PRODUCTION_DECLARATION");
        alerts[0].DeliveryDate.ShouldBe(Delivery);
        // Integration-spec §8.3: the EXPECTED arm names PVNed first, because the fix is a resend.
        alerts[0].Summary.ShouldContain("PVNED", Case.Sensitive);
        alerts[0].BrpId.ShouldBe(RollupFixture.PvnedBrpId);
    }

    [Fact]
    public async Task An_unknown_point_with_only_a_consumption_series_alerts_about_the_declaration()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ProductionExpectation.Unknown, ct);
        await using var _ = h.Db;

        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            ReceivedAt, Flat(96, 1m), ct);

        var result = await h.Recomputer.RecomputeAsync(Request(h.PointId, ReceivedAt), ct);

        // UNKNOWN reads as EXPECTED for completeness [F02-R32] ...
        result.State.ShouldBe(MeteringDayState.Partial);
        result.ProductionIsDeclaredZero.ShouldBeFalse();

        // ... and the alert routes differently, because the fix is different [DEC-112].
        var alerts = await h.World.ReadAlertsAsync(h.PointId, ct);
        alerts.Count.ShouldBe(1);
        alerts[0].Kind.ShouldBe("MISSING_PRODUCTION_DECLARATION");
        alerts[0].Summary.ShouldContain("declaration", Case.Sensitive);
        alerts[0].Summary.ShouldNotContain("PVNED", Case.Sensitive);
        alerts[0].BrpId.ShouldBeNull();
    }

    [Fact]
    public async Task Both_series_full_reaches_provisional_and_raises_nothing()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ProductionExpectation.Expected, ct);
        await using var _ = h.Db;

        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            ReceivedAt, Flat(96, 4m), ct);
        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Production, h.MessageId,
            ReceivedAt, Flat(96, 1m), ct);

        var result = await h.Recomputer.RecomputeAsync(Request(h.PointId, ReceivedAt), ct);

        result.State.ShouldBe(MeteringDayState.Provisional);
        result.ConsumptionComplete.ShouldBeTrue();
        result.ProductionComplete.ShouldBeTrue();
        (await h.World.ReadAlertsAsync(h.PointId, ct)).ShouldBeEmpty();
    }

    // ── The state machine ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_short_consumption_series_is_partial()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ProductionExpectation.Never, ct);
        await using var _ = h.Db;

        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            ReceivedAt, Flat(95, 1m), ct);

        var result = await h.Recomputer.RecomputeAsync(Request(h.PointId, ReceivedAt), ct);

        result.State.ShouldBe(MeteringDayState.Partial);
        result.ConsumptionComplete.ShouldBeFalse();
    }

    [Fact]
    public async Task A_day_with_no_versions_at_all_is_no_data_and_stores_no_daily_position()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ProductionExpectation.Never, ct);
        await using var _ = h.Db;

        var result = await h.Recomputer.RecomputeAsync(Request(h.PointId, newVersionReceivedAt: null), ct);

        result.State.ShouldBe(MeteringDayState.NoData);
        (await h.World.ReadDayStateAsync(h.PointId, Delivery, ct))!.State.ShouldBe("NO_DATA");

        // A rollup row of five zeroes is a figure somebody will read as a measurement. There is
        // nothing to roll up, so there is no row.
        (await h.World.ReadDailyPositionAsync(h.PointId, Delivery, ct)).ShouldBeNull();
    }

    /// <summary>
    /// PARTIAL to PROVISIONAL, F02 §6's "completing document received" edge, and the alert closing
    /// with it — for that day only.
    /// </summary>
    [Fact]
    public async Task A_completing_production_series_moves_the_day_on_and_resolves_that_days_alert()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ProductionExpectation.Expected, ct);
        await using var _ = h.Db;

        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            ReceivedAt, Flat(96, 4m), ct);
        await h.Recomputer.RecomputeAsync(Request(h.PointId, ReceivedAt), ct);

        (await h.World.ReadAlertsAsync(h.PointId, ct))[0].Status.ShouldBe("OPEN");

        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Production, h.MessageId,
            ReceivedAt.AddHours(1), Flat(96, 1m), ct);
        var result = await h.Recomputer.RecomputeAsync(Request(h.PointId, ReceivedAt.AddHours(1)), ct);

        result.State.ShouldBe(MeteringDayState.Provisional);

        var alerts = await h.World.ReadAlertsAsync(h.PointId, ct);
        alerts.Count.ShouldBe(1);
        alerts[0].Status.ShouldBe("RESOLVED");
    }

    /// <summary>
    /// Recomputing is idempotent. It runs on every document that touches the day, and a second run
    /// over unchanged data must produce the same row rather than a second one — the primary key
    /// (metering_point_id, delivery_date) makes a duplicate impossible, so the failure mode being
    /// excluded is a 23505 taking down an apply transaction.
    /// </summary>
    [Fact]
    public async Task Recomputing_twice_upserts_rather_than_inserting_twice()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ProductionExpectation.Never, ct);
        await using var _ = h.Db;

        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            ReceivedAt, Flat(96, 1m), ct);

        await h.Recomputer.RecomputeAsync(Request(h.PointId, ReceivedAt), ct);
        var second = await h.Recomputer.RecomputeAsync(Request(h.PointId, ReceivedAt), ct);

        second.State.ShouldBe(MeteringDayState.Provisional);
        (await h.World.ReadDayStateAsync(h.PointId, Delivery, ct))!.State.ShouldBe("PROVISIONAL");
    }

    /// <summary>
    /// [F02-R18] and the chart's corrected-on marker (contract §5). A superseded version anywhere in
    /// this (point, date) stamps last_corrected_at, whether or not the correction was post-window —
    /// a customer looking at yesterday's chart needs to know the figure moved just as much as
    /// Finance does.
    /// </summary>
    [Fact]
    public async Task A_superseded_version_stamps_the_corrected_on_marker()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ProductionExpectation.Never, ct);
        await using var _ = h.Db;

        var first = await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            ReceivedAt, Flat(96, 1m), ct);
        await h.Recomputer.RecomputeAsync(Request(h.PointId, ReceivedAt), ct);

        (await h.World.ReadDayStateAsync(h.PointId, Delivery, ct))!.LastCorrectedAt.ShouldBeNull();

        await h.World.SupersedeAsync(first, ct);
        var correctionAt = ReceivedAt.AddDays(1);
        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            correctionAt, Flat(96, 2m), ct);

        await h.Recomputer.RecomputeAsync(Request(h.PointId, correctionAt), ct);

        var row = await h.World.ReadDayStateAsync(h.PointId, Delivery, ct);
        row!.LastCorrectedAt.ShouldNotBeNull();
        row.LastCorrectedAt!.Value.ToUniversalTime().ShouldBe(correctionAt);
    }

    // ── The DST lengths, through the database ──────────────────────────────────────────────

    [Theory]
    [InlineData("2026-03-29", 92)]
    [InlineData("2026-08-12", 96)]
    [InlineData("2026-10-25", 100)]
    public async Task The_expected_interval_count_stored_is_the_dates_own(string date, int expected)
    {
        var ct = TestContext.Current.CancellationToken;
        var deliveryDate = DateOnly.Parse(date, System.Globalization.CultureInfo.InvariantCulture);
        var calendar = new MarketCalendar(TimeProvider.System);
        var world = new RollupFixture(postgres, calendar);
        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(
            customerId, world.NextEan(), ProductionExpectation.Never, ct);
        var messageId = await world.SeedInboundMessageAsync(ReceivedAt, ct);

        await using var db = postgres.CreateContext();
        var recomputer = new DayStateRecomputer(
            db, calendar, new OperationalAlertRaiser(db, NullLogger<OperationalAlertRaiser>.Instance),
            NullLogger<DayStateRecomputer>.Instance);

        await world.SeedVersionAsync(
            pointId, customerId, deliveryDate, IntervalDirection.Consumption, messageId,
            ReceivedAt, Flat(expected, 1m), ct);

        var result = await recomputer.RecomputeAsync(
            new DayRecomputeRequest(pointId, deliveryDate, Guid.CreateVersion7(), ReceivedAt), ct);

        result.ExpectedIntervalCount.ShouldBe((short)expected);
        result.State.ShouldBe(MeteringDayState.Provisional);
        (await world.ReadDayStateAsync(pointId, deliveryDate, ct))!
            .ExpectedIntervalCount.ShouldBe((short)expected);
    }

    /// <summary>
    /// Design §7.10's day-level half: a 96-point document is wrong for both DST dates — short for
    /// the autumn one and over-length for the spring one. The adapter rejects it under
    /// integration-spec §8.2's point-count rule; this proves the day would not silently accept it
    /// either.
    /// </summary>
    [Theory]
    [InlineData("2026-03-29")]
    [InlineData("2026-10-25")]
    public async Task A_ninety_six_point_series_never_completes_a_DST_day(string date)
    {
        var ct = TestContext.Current.CancellationToken;
        var deliveryDate = DateOnly.Parse(date, System.Globalization.CultureInfo.InvariantCulture);
        var calendar = new MarketCalendar(TimeProvider.System);
        var world = new RollupFixture(postgres, calendar);
        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(
            customerId, world.NextEan(), ProductionExpectation.Never, ct);
        var messageId = await world.SeedInboundMessageAsync(ReceivedAt, ct);

        await using var db = postgres.CreateContext();
        var recomputer = new DayStateRecomputer(
            db, calendar, new OperationalAlertRaiser(db, NullLogger<OperationalAlertRaiser>.Instance),
            NullLogger<DayStateRecomputer>.Instance);

        await world.SeedVersionAsync(
            pointId, customerId, deliveryDate, IntervalDirection.Consumption, messageId,
            ReceivedAt, Flat(96, 1m), ct);

        var result = await recomputer.RecomputeAsync(
            new DayRecomputeRequest(pointId, deliveryDate, Guid.CreateVersion7(), ReceivedAt), ct);

        result.ConsumptionComplete.ShouldBeFalse();
        result.State.ShouldBe(MeteringDayState.Partial);
    }

    // ── The four database spellings ────────────────────────────────────────────────────────

    [Theory]
    [InlineData(MeteringDayState.NoData, "NO_DATA")]
    [InlineData(MeteringDayState.Partial, "PARTIAL")]
    [InlineData(MeteringDayState.Provisional, "PROVISIONAL")]
    [InlineData(MeteringDayState.Final, "FINAL")]
    public void The_day_state_maps_to_the_database_spelling(MeteringDayState state, string text) =>
        DayStateRecomputer.DayStateText(state).ShouldBe(text, StringCompareShould.IgnoreLineEndings);
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~DayStateRecomputerTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'DayStateRecomputer' could not be found`.

- [ ] **Step 3: Write `DayStateRecomputer`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Rollup/DayStateRecomputer.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using PeakPower.Application.Abstractions;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Application.Ingestion;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Alerts;
using PeakPower.Persistence;

namespace PeakPower.Ingestion.Rollup;

/// <summary>
/// Recomputes <c>metering.metering_point_day_state</c> and <c>metering.daily_position</c> for one
/// (metering point, delivery date), and resolves <c>[F02-R34]</c>'s contradiction on the way past.
/// </summary>
/// <remarks>
/// <para>
/// <b>It opens no transaction.</b> Contract §9.6 step 7 calls it from inside the apply transaction,
/// and the whole reason <c>[F02-R34]</c>'s promotion lives here rather than in a follow-up job is
/// that migration 9's <c>ck_mp_never_has_no_observed_production</c> makes the intermediate state
/// unstorable. A second transaction would commit a promotion whose readings then rolled back.
/// </para>
/// <para>
/// <b>Reads go through the typed DbSets; the two upserts are raw SQL.</b> EF Core has no upsert, a
/// read-modify-write on a row two background jobs also touch is a lost update, and contract §5 gives
/// <c>MeteringPointDayState</c> and <c>DailyPosition</c> properties only — they are plan 2's classes
/// and this plan may not add a factory to them. <c>ExecuteSqlInterpolatedAsync</c> uses the
/// context's connection, so both statements enlist in the caller's transaction.
/// </para>
/// <para>
/// <b>The Worker is unscoped and exempt from RLS by design</b> (design §4.3): it writes across
/// tenants and serves no customer-facing route, so every <c>!IsAuthenticated || …</c> query filter
/// collapses to <c>true</c>. Nothing here calls <c>IgnoreQueryFilters()</c> — architecture fact 4
/// forbids it and there is nothing to bypass.
/// </para>
/// </remarks>
public sealed class DayStateRecomputer(
    PeakPowerDbContext db,
    IMarketCalendar calendar,
    IOperationalAlertRaiser alerts,
    ILogger<DayStateRecomputer> logger) : IDayStateRecomputer
{
    /// <summary>
    /// The database spelling of each state, as a total switch. Raw SQL bypasses
    /// <c>EnumToScreamingSnakeConverter</c>, so this is the only thing agreeing with the CHECK
    /// constraints on <c>metering_point_day_state.state</c> and <c>daily_position.data_state</c>.
    /// </summary>
    public static string DayStateText(MeteringDayState state) => state switch
    {
        MeteringDayState.NoData => "NO_DATA",
        MeteringDayState.Partial => "PARTIAL",
        MeteringDayState.Provisional => "PROVISIONAL",
        MeteringDayState.Final => "FINAL",
        _ => throw new ArgumentOutOfRangeException(
            nameof(state),
            state,
            "Every MeteringDayState needs a database spelling here; both CHECK constraints list "
            + "exactly four and an unmapped member is a 23514 at run time."),
    };

    public async Task<DayRecomputeResult> RecomputeAsync(
        DayRecomputeRequest request, CancellationToken ct)
    {
        // The correlation id stamped at receipt, carried through queue, adapter and apply, and now
        // onto every line this recompute logs. Contract §9.5: in scope precisely because
        // retrofitting one across an async hop later rewrites every log line.
        using var scope = logger.BeginScope(new Dictionary<string, object>
        {
            ["CorrelationId"] = request.CorrelationId,
            ["MeteringPointId"] = request.MeteringPointId,
            ["DeliveryDate"] = request.DeliveryDate,
        });

        var point = await db.MeteringPoints
            .SingleOrDefaultAsync(candidate => candidate.Id == request.MeteringPointId, ct);

        if (point is null)
        {
            throw new InvalidOperationException(
                $"Metering point {request.MeteringPointId} does not exist, so its day state cannot "
                + "be recomputed. The apply transaction resolves the point before writing a "
                + "version, so reaching here means a version outlived its metering point.");
        }

        var brpCode = await db.Brps
            .Where(brp => brp.Id == point.BrpId)
            .Select(brp => brp.Code)
            .SingleAsync(ct);

        var expectedIntervalCount = calendar.ExpectedIntervalCount(request.DeliveryDate);

        var versionRows = await db.IntervalDataVersions
            .Where(version => version.MeteringPointId == request.MeteringPointId
                              && version.DeliveryDate == request.DeliveryDate)
            .Select(version => new
            {
                version.Id,
                version.Direction,
                version.IsCurrent,
                version.ReceivedAt,
            })
            .ToListAsync(ct);

        var currentConsumption = versionRows.SingleOrDefault(
            version => version.IsCurrent && version.Direction == IntervalDirection.Consumption);
        var currentProduction = versionRows.SingleOrDefault(
            version => version.IsCurrent && version.Direction == IntervalDirection.Production);

        var consumptionPoints = currentConsumption is null
            ? []
            : await ReadPointsAsync(currentConsumption.Id, request.DeliveryDate, ct);
        var productionPoints = currentProduction is null
            ? []
            : await ReadPointsAsync(currentProduction.Id, request.DeliveryDate, ct);

        // ── [F02-R34], and it happens BEFORE completeness is judged ────────────────────────
        // A promotion changes the answer to "is production required", so evaluating completeness
        // against the pre-promotion value would mark a connection that has just been proven to
        // produce as a declared zero - the exact inversion the requirement exists to prevent.
        var promoted = false;
        if (currentProduction is not null
            && point.ProductionExpectation == ProductionExpectation.Never)
        {
            var promotion = point.RecordObservedProduction(
                currentProduction.ReceivedAt, MeteringPoint.IngestionPromotionActor);

            if (!promotion.IsSuccess)
            {
                throw new InvalidOperationException(
                    $"Recording observed production on metering point {point.Id} failed: "
                    + promotion.Error);
            }

            // Flushed here rather than left to the caller so that
            // ck_mp_never_has_no_observed_production is exercised at the point of the change. Still
            // inside the caller's transaction, so it commits or rolls back with the readings.
            await db.SaveChangesAsync(ct);
            promoted = true;

            logger.LogWarning(
                "Metering point {MeteringPointId} was recorded as never producing and an A01 series "
                + "arrived for {DeliveryDate}. Promoted to EXPECTED with source OBSERVED in this "
                + "transaction; the readings are stored and used normally.",
                point.Id, request.DeliveryDate);
        }

        var completeness = DayCompleteness.Evaluate(new DayCompletenessInput(
            ExpectedIntervalCount: expectedIntervalCount,
            ConsumptionVersionPresent: currentConsumption is not null,
            ConsumptionPointCount: consumptionPoints.Count,
            ProductionVersionPresent: currentProduction is not null,
            ProductionPointCount: productionPoints.Count,
            // Read AFTER the promotion above.
            ProductionExpectation: point.ProductionExpectation));

        var previous = await db.MeteringPointDayStates
            .SingleOrDefaultAsync(
                state => state.MeteringPointId == request.MeteringPointId
                         && state.DeliveryDate == request.DeliveryDate,
                ct);

        var (state, finalisedAt, reopened) = ResolveState(previous, completeness.State, request);

        // The chart's corrected-on marker (contract §5). Any superseded version for this (point,
        // date) means a figure moved, post-window or not.
        DateTimeOffset? lastCorrectedAt = versionRows.Exists(version => !version.IsCurrent)
            ? versionRows.Where(version => version.IsCurrent)
                .Select(version => (DateTimeOffset?)version.ReceivedAt)
                .Max()
            : null;

        var totals = DailyPositionCalculator.Accumulate(
            consumptionPoints,
            productionPoints,
            completeness.ProductionIsDeclaredZero,
            expectedIntervalCount);

        await UpsertDayStateAsync(
            request, point.CustomerId, state, (short)expectedIntervalCount, completeness,
            finalisedAt, lastCorrectedAt, ct);

        var sourceVersionIds = versionRows
            .Where(version => version.IsCurrent)
            .Select(version => version.Id)
            .Order()
            .ToArray();

        if (state == MeteringDayState.NoData)
        {
            // Five zeroes in a rollup table is a figure somebody reads as a measurement. Nothing
            // arrived, so there is no row.
            await DeleteDailyPositionAsync(request, ct);
        }
        else
        {
            await UpsertDailyPositionAsync(
                request, point.CustomerId, state, totals, sourceVersionIds, ct);
        }

        await RaiseOrResolveAlertsAsync(
            request, point, brpCode, completeness, promoted, reopened, ct);

        return new DayRecomputeResult(
            State: state,
            ExpectedIntervalCount: (short)expectedIntervalCount,
            ConsumptionComplete: completeness.ConsumptionComplete,
            ProductionComplete: completeness.ProductionComplete,
            ProductionIsDeclaredZero: completeness.ProductionIsDeclaredZero,
            ProductionExpectationPromoted: promoted,
            ReopenedFromFinal: reopened,
            ConsumptionKwh: totals.ConsumptionKwh,
            ProductionKwh: totals.ProductionKwh,
            NetUsageKwh: totals.NetUsageKwh,
            OfftakeKwh: totals.OfftakeKwh,
            ExportKwh: totals.ExportKwh);
    }

    /// <summary>
    /// The FINAL edges, and the one place <c>[DEC-98]</c> is implemented.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>FINAL</c> is a <b>status, not a guarantee</b>: it means only that nothing newer arrived
    /// within the correction window. A newer version reopens the date to <c>PROVISIONAL</c> and it
    /// re-finalises on the same ten-working-day rule <c>[F02-R45]</c> — F02 §6 draws that as an
    /// ordinary edge, traversable more than once, not as an exception.
    /// </para>
    /// <para>
    /// A recompute with <b>nothing new</b> (a replay that produced no version <c>[F02-R27]</c>, or a
    /// maintenance sweep) leaves a finalised date exactly as it was. Without that arm, replaying an
    /// old message to inspect it would silently unfinalise the day.
    /// </para>
    /// <para>
    /// ⚠ <b>Nothing here archives, compacts or caches on the strength of FINAL</b> (design §7.12).
    /// The rollup is recomputed in every branch, including this one; the state is the only thing
    /// that varies.
    /// </para>
    /// </remarks>
    private static (MeteringDayState State, DateTimeOffset? FinalisedAt, bool Reopened) ResolveState(
        MeteringPointDayState? previous,
        MeteringDayState computed,
        DayRecomputeRequest request)
    {
        if (previous?.State != MeteringDayState.Final)
        {
            return (computed, null, false);
        }

        return request.NewVersionReceivedAt is null
            ? (MeteringDayState.Final, previous.FinalisedAt, false)
            : (computed, null, true);
    }

    private async Task<IReadOnlyList<IntervalPoint>> ReadPointsAsync(
        Guid versionId, DateOnly deliveryDate, CancellationToken ct)
    {
        var rows = await db.IntervalReadings
            .Where(reading => reading.VersionId == versionId && reading.DeliveryDate == deliveryDate)
            .Select(reading => new { reading.Pos, reading.QuantityKwh })
            .ToListAsync(ct);

        return [.. rows.Select(row => new IntervalPoint(row.Pos, row.QuantityKwh))];
    }

    private Task UpsertDayStateAsync(
        DayRecomputeRequest request,
        Guid customerId,
        MeteringDayState state,
        short expectedIntervalCount,
        DayCompletenessResult completeness,
        DateTimeOffset? finalisedAt,
        DateTimeOffset? lastCorrectedAt,
        CancellationToken ct)
    {
        var stateText = DayStateText(state);
        var computedAt = calendar.UtcNow;

        return db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO metering.metering_point_day_state
                    (metering_point_id, delivery_date, customer_id, state, expected_interval_count,
                     consumption_complete, production_complete, production_is_declared_zero,
                     finalised_at, last_corrected_at, computed_at)
             VALUES ({request.MeteringPointId}, {request.DeliveryDate}, {customerId}, {stateText},
                     {expectedIntervalCount}, {completeness.ConsumptionComplete},
                     {completeness.ProductionComplete}, {completeness.ProductionIsDeclaredZero},
                     {finalisedAt}::timestamptz, {lastCorrectedAt}::timestamptz, {computedAt})
             ON CONFLICT (metering_point_id, delivery_date) DO UPDATE
                SET customer_id                 = EXCLUDED.customer_id,
                    state                       = EXCLUDED.state,
                    expected_interval_count     = EXCLUDED.expected_interval_count,
                    consumption_complete        = EXCLUDED.consumption_complete,
                    production_complete         = EXCLUDED.production_complete,
                    production_is_declared_zero = EXCLUDED.production_is_declared_zero,
                    finalised_at                = EXCLUDED.finalised_at,
                    last_corrected_at           = EXCLUDED.last_corrected_at,
                    computed_at                 = EXCLUDED.computed_at;
             """,
            ct);
    }

    private Task UpsertDailyPositionAsync(
        DayRecomputeRequest request,
        Guid customerId,
        MeteringDayState state,
        DailyPositionTotals totals,
        Guid[] sourceVersionIds,
        CancellationToken ct)
    {
        var stateText = DayStateText(state);
        var computedAt = calendar.UtcNow;

        return db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO metering.daily_position
                    (metering_point_id, delivery_date, customer_id, consumption_kwh, production_kwh,
                     net_usage_kwh, offtake_kwh, export_kwh, data_state, source_version_ids,
                     computed_at)
             VALUES ({request.MeteringPointId}, {request.DeliveryDate}, {customerId},
                     {totals.ConsumptionKwh}, {totals.ProductionKwh}, {totals.NetUsageKwh},
                     {totals.OfftakeKwh}, {totals.ExportKwh}, {stateText},
                     {sourceVersionIds}::uuid[], {computedAt})
             ON CONFLICT (metering_point_id, delivery_date) DO UPDATE
                SET customer_id        = EXCLUDED.customer_id,
                    consumption_kwh    = EXCLUDED.consumption_kwh,
                    production_kwh     = EXCLUDED.production_kwh,
                    net_usage_kwh      = EXCLUDED.net_usage_kwh,
                    offtake_kwh        = EXCLUDED.offtake_kwh,
                    export_kwh         = EXCLUDED.export_kwh,
                    data_state         = EXCLUDED.data_state,
                    source_version_ids = EXCLUDED.source_version_ids,
                    computed_at        = EXCLUDED.computed_at;
             """,
            ct);
    }

    private Task DeleteDailyPositionAsync(DayRecomputeRequest request, CancellationToken ct) =>
        db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             DELETE FROM metering.daily_position
              WHERE metering_point_id = {request.MeteringPointId}
                AND delivery_date = {request.DeliveryDate};
             """,
            ct);

    /// <summary>
    /// The alert conditions this recompute owns. Delivery is deferred (design §3.2); these are rows.
    /// </summary>
    private async Task RaiseOrResolveAlertsAsync(
        DayRecomputeRequest request,
        MeteringPoint point,
        string brpCode,
        DayCompletenessResult completeness,
        bool promoted,
        bool reopened,
        CancellationToken ct)
    {
        var at = request.NewVersionReceivedAt ?? calendar.UtcNow;
        var ean = point.Ean.Value;

        if (promoted)
        {
            var (summary, detail) = AlertCopy.ProductionExpectationPromoted(ean, request.DeliveryDate);
            await alerts.RaiseAsync(
                new OperationalAlertRequest(
                    OperationalAlertKind.ProductionExpectationPromoted, summary, detail,
                    point.Id, point.BrpId, InboundMessageId: null, request.DeliveryDate, at),
                ct);
        }

        if (reopened)
        {
            var (summary, detail) = AlertCopy.PostWindowReconciliation(ean, request.DeliveryDate);
            await alerts.RaiseAsync(
                new OperationalAlertRequest(
                    OperationalAlertKind.PostWindowReconciliation, summary, detail,
                    point.Id, point.BrpId, InboundMessageId: null, request.DeliveryDate, at),
                ct);
        }

        if (completeness.ProductionSeriesRequired && !completeness.ProductionComplete)
        {
            // [F02-R35]. Same day state, same alert kind - the enum set is fixed by the column's
            // CHECK - and deliberately different sentences, because the fix is different. EXPECTED
            // is a resend to chase from the BRP; UNKNOWN is a declaration to obtain from the
            // customer [DEC-112], routed to onboarding, which owns it [F01-R54]. The BRP id is set
            // on the first and left null on the second for the same reason.
            var namesTheBrp = point.ProductionExpectation == ProductionExpectation.Expected;

            var (summary, detail) = namesTheBrp
                ? AlertCopy.MissingProductionSeriesFromBrp(ean, request.DeliveryDate, brpCode)
                : AlertCopy.MissingProductionDeclaration(ean, request.DeliveryDate);

            await alerts.RaiseAsync(
                new OperationalAlertRequest(
                    OperationalAlertKind.MissingProductionDeclaration, summary, detail,
                    point.Id, namesTheBrp ? point.BrpId : null,
                    InboundMessageId: null, request.DeliveryDate, at),
                ct);
        }
        else if (completeness.Complete)
        {
            // That day only. One day filling in says nothing about another day still short, and a
            // point-wide resolve would empty the onboarding worklist on the strength of an
            // unrelated date.
            await alerts.ResolveOpenAsync(
                OperationalAlertKind.MissingProductionDeclaration,
                point.Id,
                request.DeliveryDate,
                at,
                ct);
        }
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~DayStateRecomputerTests"
```

Expected: PASS — 18 test cases (three theories expand).

Two failures worth naming in advance:

- `Npgsql.PostgresException: 42804: column "source_version_ids" is of type uuid[] but expression is
  of type text` — the `::uuid[]` cast is missing or the parameter arrived as a `List<Guid>`. It must
  be `Guid[]`.
- `System.InvalidOperationException: The LINQ expression … could not be translated` on
  `ReadPointsAsync` — project to an anonymous type first, as written, rather than straight into
  `IntervalPoint`.

- [ ] **Step 5: Verify by mutation that the promotion happens BEFORE completeness is judged**

This is the ordering bug that produces a plausible wrong answer, and it is invisible to a test that
only checks the point was promoted.

Move the `DayCompleteness.Evaluate` call **above** the `if (currentProduction is not null && …)`
promotion block, so it reads the pre-promotion expectation.

Predict: nothing in *this* file goes red — every case here has either no production series or a
non-`NEVER` point. **That is the finding**, and it is why task 8 exists: the ordering is only visible
on a `NEVER` point that receives an A01 series, and that case has its own file. Record the null result
and move on; do not weaken task 8 by folding its case in here.

Restore the ordering.

- [ ] **Step 6: Second mutation — prove the no-new-version arm of `ResolveState`**

Change `ResolveState`'s final expression to reopen unconditionally:

```csharp
        return (computed, null, true);   // MUTATION
```

Predict: nothing here goes red either — no test in this file starts from a `FINAL` row. Task 10 owns
that case. Again, record and restore rather than folding the case in: a state machine tested in the
file that happens to be open is a state machine tested nowhere in particular.

- [ ] **Step 7: Third mutation — prove the two missing-production sentences really do differ**

In `RaiseOrResolveAlertsAsync`, replace `namesTheBrp` with the constant `true`.

Predict: `An_unknown_point_with_only_a_consumption_series_alerts_about_the_declaration` fails with

```
Shouldly.ShouldAssertException : alerts[0].Summary
    should contain
"declaration"
    but was
"No production series arrived from PVNED for 8716… on 2026-08-12."
```

and then on `alerts[0].BrpId should be null but was 0199a1a0-0000-7000-8000-0000000000b1`.
`An_expected_point_with_only_a_consumption_series_stays_partial_and_alerts` stays green.

Run, confirm, restore.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~DayStateRecomputerTests"
git add src/Infrastructure/PeakPower.Ingestion/Rollup/DayStateRecomputer.cs \
        tests/PeakPower.Integration.Tests/Rollup/DayStateRecomputerTests.cs
git commit -m "Compute the day state against production_expectation, wired to a real database

Integration-spec 8.3's table end to end: a NEVER point with only an A02 series reaches
PROVISIONAL and raises nothing, an EXPECTED one stays PARTIAL and the alert names PVNed, an
UNKNOWN one stays PARTIAL and the alert names the missing customer declaration instead, because
DEC-112 puts that fix with onboarding rather than with the BRP.

Reads go through the typed DbSets, the two rollup writes are raw-SQL upserts: EF has no upsert,
the rows are also touched by two background jobs, and contract section 5 gives those entities
properties with no factory.

Three mutations. Making the alert always name the BRP turns the UNKNOWN case red on both the
sentence and the null brp_id and leaves the EXPECTED one green. Moving the completeness call
above the promotion, and making the FINAL arm reopen unconditionally, both turn NOTHING red
here - recorded as null results, because those two cases belong to the next two tasks and
folding them in would test a state machine in whichever file happened to be open."

---

### Task 8: `[F02-R34]` in the same transaction, and the constraint that makes it compulsory

Design §7.9: *"An A01 series arriving for a point recorded `NEVER` is stored and used normally, and
the **same transaction** moves it to `production_expectation = EXPECTED` with source `OBSERVED` and
stamps `first_production_observed_at`."*

Task 7 wrote the code. This task proves the three things that make it more than a log line:

1. The reading is **stored and used normally** — a document is never discarded because master data
   disagrees with it.
2. The completeness verdict is computed against the **post**-promotion expectation, so the day does
   not silently reach `PROVISIONAL` as a declared zero on a connection that has just been proven to
   produce.
3. The whole thing **rolls back together**. Migration 9's `ck_mp_never_has_no_observed_production`
   makes the intermediate state unstorable, and this task fires it deliberately to show it bites.

⚠ **This is where task 7's step-5 null result is paid off.** The ordering mutation is invisible in
`DayStateRecomputerTests` because no case there is a `NEVER` point receiving production. Here it is
the only thing the file is about.

**Files:**
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/ProductionPromotionTests.cs`

**Interfaces:**
- Consumes: `DayStateRecomputer` (task 7); `RollupFixture` (task 5);
  `MeteringPoint.RecordObservedProduction`, `.IngestionPromotionActor` (task 4).
- Produces: nothing. This task adds tests only.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/ProductionPromotionTests.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Infrastructure.Time;
using PeakPower.Ingestion.Alerts;
using PeakPower.Ingestion.Rollup;
using PeakPower.Integration.Tests.Database;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Rollup;

/// <summary>
/// [F02-R34]. Observed production is evidence and a declaration is not, so the platform believes
/// the data — and resolves the contradiction rather than logging it, because database design §3.1.1
/// says a reading that contradicts its own master data must not be left stored beside it.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class ProductionPromotionTests(PostgresFixture postgres)
{
    private static readonly DateOnly Delivery = new(2026, 8, 12);
    private static readonly DateTimeOffset ReceivedAt = new(2026, 8, 13, 4, 2, 11, TimeSpan.Zero);

    private static IReadOnlyList<decimal> Flat(int count, decimal each) =>
        [.. Enumerable.Repeat(each, count)];

    /// <summary>
    /// The whole requirement in one test: the day is complete, the readings are all there, the
    /// master record has moved, and the alert says so.
    /// </summary>
    [Fact]
    public async Task An_A01_series_on_a_never_point_promotes_it_and_the_readings_stay()
    {
        var ct = TestContext.Current.CancellationToken;
        var calendar = new MarketCalendar(TimeProvider.System);
        var world = new RollupFixture(postgres, calendar);

        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(
            customerId, world.NextEan(), ProductionExpectation.Never, ct);
        var messageId = await world.SeedInboundMessageAsync(ReceivedAt, ct);

        await using var db = postgres.CreateContext();
        var recomputer = new DayStateRecomputer(
            db, calendar, new OperationalAlertRaiser(db, NullLogger<OperationalAlertRaiser>.Instance),
            NullLogger<DayStateRecomputer>.Instance);

        await world.SeedVersionAsync(
            pointId, customerId, Delivery, IntervalDirection.Consumption, messageId,
            ReceivedAt, Flat(96, 4m), ct);
        var productionVersion = await world.SeedVersionAsync(
            pointId, customerId, Delivery, IntervalDirection.Production, messageId,
            ReceivedAt, Flat(96, 1m), ct);

        var result = await recomputer.RecomputeAsync(
            new DayRecomputeRequest(pointId, Delivery, Guid.CreateVersion7(), ReceivedAt), ct);

        result.ProductionExpectationPromoted.ShouldBeTrue();

        // EXPECTED is the value; OBSERVED is the source. Read straight out of the columns rather
        // than off the entity, because the failure this guards against is a value written into the
        // wrong column and surviving the write.
        (await world.ReadProductionExpectationAsync(pointId, ct)).ShouldBe("EXPECTED");
        (await world.ReadExpectationSourceAsync(pointId, ct)).ShouldBe("OBSERVED");
        (await world.ReadFirstProductionObservedAtAsync(pointId, ct))!.Value.ToUniversalTime()
            .ShouldBe(ReceivedAt);

        // "Stored and used normally": the document was not discarded, and it counts towards the day.
        (await world.CountIntervalReadingsAsync(productionVersion, Delivery, ct)).ShouldBe(96L);
        result.ProductionKwh.ShouldBe(96.000m);
    }

    /// <summary>
    /// <b>The ordering assertion, and the reason this file exists separately.</b> Completeness is
    /// judged against the expectation AFTER the promotion. Judged against the pre-promotion value,
    /// the day still reaches PROVISIONAL — but as a DECLARED ZERO, so
    /// production_is_declared_zero would be true on a connection that has just been proven to
    /// produce, and [F02-R33]'s treatment would print a stated zero over a real production series.
    /// The day state is the same; the meaning is inverted.
    /// </summary>
    [Fact]
    public async Task The_promoted_day_is_not_recorded_as_a_declared_zero()
    {
        var ct = TestContext.Current.CancellationToken;
        var calendar = new MarketCalendar(TimeProvider.System);
        var world = new RollupFixture(postgres, calendar);

        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(
            customerId, world.NextEan(), ProductionExpectation.Never, ct);
        var messageId = await world.SeedInboundMessageAsync(ReceivedAt, ct);

        await using var db = postgres.CreateContext();
        var recomputer = new DayStateRecomputer(
            db, calendar, new OperationalAlertRaiser(db, NullLogger<OperationalAlertRaiser>.Instance),
            NullLogger<DayStateRecomputer>.Instance);

        await world.SeedVersionAsync(
            pointId, customerId, Delivery, IntervalDirection.Consumption, messageId,
            ReceivedAt, Flat(96, 4m), ct);
        await world.SeedVersionAsync(
            pointId, customerId, Delivery, IntervalDirection.Production, messageId,
            ReceivedAt, Flat(96, 1m), ct);

        var result = await recomputer.RecomputeAsync(
            new DayRecomputeRequest(pointId, Delivery, Guid.CreateVersion7(), ReceivedAt), ct);

        result.ProductionIsDeclaredZero.ShouldBeFalse();
        result.State.ShouldBe(MeteringDayState.Provisional);

        var row = await world.ReadDayStateAsync(pointId, Delivery, ct);
        row!.ProductionIsDeclaredZero.ShouldBeFalse();
        row.ProductionComplete.ShouldBeTrue();
    }

    /// <summary>
    /// A partial promotion is worse than none: the readings would sit beside master data that
    /// contradicts them, which is exactly what database design §3.1.1 forbids.
    /// </summary>
    [Fact]
    public async Task The_promotion_and_the_readings_commit_or_roll_back_together()
    {
        var ct = TestContext.Current.CancellationToken;
        var calendar = new MarketCalendar(TimeProvider.System);
        var world = new RollupFixture(postgres, calendar);

        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(
            customerId, world.NextEan(), ProductionExpectation.Never, ct);
        var messageId = await world.SeedInboundMessageAsync(ReceivedAt, ct);

        await using var db = postgres.CreateContext();
        var recomputer = new DayStateRecomputer(
            db, calendar, new OperationalAlertRaiser(db, NullLogger<OperationalAlertRaiser>.Instance),
            NullLogger<DayStateRecomputer>.Instance);

        await world.SeedVersionAsync(
            pointId, customerId, Delivery, IntervalDirection.Production, messageId,
            ReceivedAt, Flat(96, 1m), ct);

        await using (var transaction = await db.Database.BeginTransactionAsync(ct))
        {
            var result = await recomputer.RecomputeAsync(
                new DayRecomputeRequest(pointId, Delivery, Guid.CreateVersion7(), ReceivedAt), ct);

            result.ProductionExpectationPromoted.ShouldBeTrue();

            // The caller decides. The recomputer opened nothing, so this rolls its writes back too.
            await transaction.RollbackAsync(ct);
        }

        (await world.ReadProductionExpectationAsync(pointId, ct)).ShouldBe("NEVER");
        (await world.ReadFirstProductionObservedAtAsync(pointId, ct)).ShouldBeNull();
        (await world.ReadDayStateAsync(pointId, Delivery, ct)).ShouldBeNull();
    }

    /// <summary>
    /// <b>The constraint, fired deliberately.</b> Stamping first_production_observed_at while
    /// leaving production_expectation at NEVER is what a "log it and fix it later" implementation
    /// produces, and migration 9 makes it unstorable. Without this test the constraint is a line of
    /// DDL nobody has watched work.
    /// </summary>
    [Fact]
    public async Task Stamping_the_observation_without_promoting_is_refused_by_the_database()
    {
        var ct = TestContext.Current.CancellationToken;
        var calendar = new MarketCalendar(TimeProvider.System);
        var world = new RollupFixture(postgres, calendar);

        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(
            customerId, world.NextEan(), ProductionExpectation.Never, ct);

        await using var connection = new NpgsqlConnection(postgres.ConnectionString);
        await connection.OpenAsync(ct);
        await using var command = new NpgsqlCommand(
            """
            UPDATE customer.metering_point
               SET first_production_observed_at = @observedAt
             WHERE id = @id;
            """,
            connection);
        command.Parameters.AddWithValue("observedAt", ReceivedAt);
        command.Parameters.AddWithValue("id", pointId);

        var exception = await Should.ThrowAsync<PostgresException>(
            async () => await command.ExecuteNonQueryAsync(ct));

        exception.SqlState.ShouldBe("23514");
        exception.ConstraintName.ShouldBe("ck_mp_never_has_no_observed_production");
        customerId.ShouldNotBe(Guid.Empty);
    }

    /// <summary>
    /// A second document for the same connection does not re-promote or re-stamp. The alert
    /// dedupes on (kind, point, date), so a day that receives three corrections raises one notice.
    /// </summary>
    [Fact]
    public async Task A_second_production_series_does_not_promote_again()
    {
        var ct = TestContext.Current.CancellationToken;
        var calendar = new MarketCalendar(TimeProvider.System);
        var world = new RollupFixture(postgres, calendar);

        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(
            customerId, world.NextEan(), ProductionExpectation.Never, ct);
        var messageId = await world.SeedInboundMessageAsync(ReceivedAt, ct);

        await using var db = postgres.CreateContext();
        var recomputer = new DayStateRecomputer(
            db, calendar, new OperationalAlertRaiser(db, NullLogger<OperationalAlertRaiser>.Instance),
            NullLogger<DayStateRecomputer>.Instance);

        var first = await world.SeedVersionAsync(
            pointId, customerId, Delivery, IntervalDirection.Production, messageId,
            ReceivedAt, Flat(96, 1m), ct);
        await recomputer.RecomputeAsync(
            new DayRecomputeRequest(pointId, Delivery, Guid.CreateVersion7(), ReceivedAt), ct);

        await world.SupersedeAsync(first, ct);
        var correctionAt = ReceivedAt.AddDays(1);
        await world.SeedVersionAsync(
            pointId, customerId, Delivery, IntervalDirection.Production, messageId,
            correctionAt, Flat(96, 2m), ct);

        var second = await recomputer.RecomputeAsync(
            new DayRecomputeRequest(pointId, Delivery, Guid.CreateVersion7(), correctionAt), ct);

        second.ProductionExpectationPromoted.ShouldBeFalse();
        (await world.ReadFirstProductionObservedAtAsync(pointId, ct))!.Value.ToUniversalTime()
            .ShouldBe(ReceivedAt);

        var promotions = (await world.ReadAlertsAsync(pointId, ct))
            .Where(alert => alert.Kind == "PRODUCTION_EXPECTATION_PROMOTED")
            .ToArray();
        promotions.Length.ShouldBe(1);
    }

    /// <summary>
    /// The alert names the connection and says the reading was kept. An operator reading it must
    /// not conclude that something needs undoing.
    /// </summary>
    [Fact]
    public async Task The_promotion_alert_says_the_reading_was_kept()
    {
        var ct = TestContext.Current.CancellationToken;
        var calendar = new MarketCalendar(TimeProvider.System);
        var world = new RollupFixture(postgres, calendar);

        var customerId = await world.SeedCustomerAsync(ct);
        var ean = world.NextEan();
        var pointId = await world.SeedMeteringPointAsync(
            customerId, ean, ProductionExpectation.Never, ct);
        var messageId = await world.SeedInboundMessageAsync(ReceivedAt, ct);

        await using var db = postgres.CreateContext();
        var recomputer = new DayStateRecomputer(
            db, calendar, new OperationalAlertRaiser(db, NullLogger<OperationalAlertRaiser>.Instance),
            NullLogger<DayStateRecomputer>.Instance);

        await world.SeedVersionAsync(
            pointId, customerId, Delivery, IntervalDirection.Production, messageId,
            ReceivedAt, Flat(96, 1m), ct);
        await recomputer.RecomputeAsync(
            new DayRecomputeRequest(pointId, Delivery, Guid.CreateVersion7(), ReceivedAt), ct);

        var alert = (await world.ReadAlertsAsync(pointId, ct))
            .Single(row => row.Kind == "PRODUCTION_EXPECTATION_PROMOTED");

        alert.Summary.ShouldContain(ean, Case.Sensitive);
        alert.Detail.ShouldNotBeNull();
        alert.Detail!.ShouldContain("stored and used normally", Case.Sensitive);
        alert.Detail.ShouldContain("OBSERVED", Case.Sensitive);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~ProductionPromotionTests"
```

Expected: FAIL — the file does not exist yet in the assembly's compiled output on the first run of
step 1, so this step is the confirmation that the six new cases actually execute. If task 7's
implementation is correct they should already pass; **if every one passes on the first run, mutate
before believing it** (step 3).

⚠ If `Stamping_the_observation_without_promoting_is_refused_by_the_database` fails with
`exception.ConstraintName should be "ck_mp_never_has_no_observed_production" but was ""`, migration 9
named the constraint differently. Read
`src/Infrastructure/PeakPower.Persistence/Migrations/*_IngestionAndIntervalData.cs` and use the real
name — do **not** relax the assertion to `SqlState` alone, because `23514` is raised by every check
on the table.

- [ ] **Step 3: MUTATION — judge completeness before the promotion, and predict the failure**

This is the mutation task 7's step 5 could not land. In
`src/Infrastructure/PeakPower.Ingestion/Rollup/DayStateRecomputer.cs`, move the
`DayCompleteness.Evaluate(...)` call **above** the `if (currentProduction is not null && …)`
promotion block.

**Predicted failure:** `The_promoted_day_is_not_recorded_as_a_declared_zero` fails with

```
Shouldly.ShouldAssertException : result.ProductionIsDeclaredZero
    should be
False
    but was
True
```

and `An_A01_series_on_a_never_point_promotes_it_and_the_readings_stay` stays **green** — the point is
still promoted, the readings are still there, `result.ProductionExpectationPromoted` is still true.
The day state is still `PROVISIONAL`. Only the *meaning* is inverted, and only one assertion in one
test sees it.

Run it, confirm the prediction including the green half, then restore.

- [ ] **Step 4: Second mutation — take the promotion out of the transaction**

Replace the `await db.SaveChangesAsync(ct);` inside the promotion block with a save on a **second**
context:

```csharp
            await using (var separate = new PeakPowerDbContext(
                new DbContextOptionsBuilder<PeakPowerDbContext>()
                    .UseNpgsql(db.Database.GetConnectionString()).Options,
                new PeakPower.Infrastructure.Web.Tenancy.UnscopedCustomerContext()))
            {
                await separate.Database.ExecuteSqlInterpolatedAsync(
                    $"""
                     UPDATE customer.metering_point
                        SET production_expectation = 'EXPECTED', expectation_source = 'OBSERVED',
                            first_production_observed_at = {currentProduction.ReceivedAt}
                      WHERE id = {point.Id};
                     """,
                    ct);
            }
```

Predict: `The_promotion_and_the_readings_commit_or_roll_back_together` fails with

```
Shouldly.ShouldAssertException : await world.ReadProductionExpectationAsync(pointId, ct)
    should be
"NEVER"
    but was
"EXPECTED"
```

— the promotion survived a rollback, which is the state database design §3.1.1 forbids: a corrected
master record beside readings that no longer exist.

⚠ This mutation is verbose and touches a `using` block. If it fails to compile, that proves nothing —
fix the compile error and run it, or the mutation is not evidence.

Run, confirm, restore.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~ProductionPromotionTests"
git add tests/PeakPower.Integration.Tests/Rollup/ProductionPromotionTests.cs
git commit -m "Prove F02-R34 promotes inside the transaction, and that the constraint bites

Three things that make the promotion more than a log line. The readings stay - a document is
never discarded because master data disagrees with it. Completeness is judged AFTER the
promotion, so the day is not recorded as a declared zero on a connection just proven to produce.
And the whole thing rolls back together.

The ordering mutation is the one worth naming: judging completeness first leaves the point
promoted, the readings stored and the day PROVISIONAL, and turns exactly one assertion red -
production_is_declared_zero. The state is identical and the meaning is inverted, which is why
that assertion is separate from the promotion one.

ck_mp_never_has_no_observed_production is fired deliberately, so the DDL is a constraint somebody
has watched work rather than a line nobody has tested."

---

### Task 9: `daily_position` persisted — the §4.1 worked case through the database, and `source_version_ids`

Task 3 proved the accumulators in isolation. This proves the row that reaches PostgreSQL, including
the three things only a real database can show: that `offtake_kwh >= 0` and `export_kwh >= 0` hold,
that `source_version_ids` is a `uuid[]` naming exactly the current versions, and that a
recompute after a supersession **replaces** the row rather than appending a second.

⚠ **`source_version_ids` "makes invalidation exact"** (contract §5). It is the list of **current**
version ids the row was computed from — not every version ever seen for that day. Phase 2 will use it
to decide which rollups a new version invalidates, and a list that includes superseded ids would
invalidate rows that never depended on them.

⚠ **The two `CHECK` constraints are not decoration.** `offtake_kwh >= 0` and `export_kwh >= 0` are
the database's own statement that these are accumulated magnitudes, not signed positions. A sign
error in `DailyPositionCalculator` reaches PostgreSQL as a `23514` rather than as a plausible number.

**Files:**
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/DailyPositionPersistenceTests.cs`

**Interfaces:**
- Consumes: `DayStateRecomputer` (task 7), `RollupFixture` (task 5),
  `DailyPositionCalculator` (task 3).
- Produces: nothing. This task adds tests only.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/DailyPositionPersistenceTests.cs`:

```csharp
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Infrastructure.Time;
using PeakPower.Ingestion.Alerts;
using PeakPower.Ingestion.Rollup;
using PeakPower.Integration.Tests.Database;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Rollup;

/// <summary>
/// Design §4.1's rollup as a stored row, and design §7.11 in particular: on a day where production
/// exceeds consumption in some intervals but not overall, the stored offtake and export match the
/// per-interval computation and <b>not</b> the value obtained from daily gross totals.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class DailyPositionPersistenceTests(PostgresFixture postgres)
{
    private static readonly DateOnly Delivery = new(2026, 8, 12);
    private static readonly DateTimeOffset ReceivedAt = new(2026, 8, 13, 4, 2, 11, TimeSpan.Zero);

    private sealed record Harness(
        RollupFixture World,
        DayStateRecomputer Recomputer,
        PeakPower.Persistence.PeakPowerDbContext Db,
        Guid CustomerId,
        Guid PointId,
        Guid MessageId);

    private async Task<Harness> ArrangeAsync(ProductionExpectation expectation, CancellationToken ct)
    {
        var calendar = new MarketCalendar(TimeProvider.System);
        var world = new RollupFixture(postgres, calendar);
        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(customerId, world.NextEan(), expectation, ct);
        var messageId = await world.SeedInboundMessageAsync(ReceivedAt, ct);
        var db = postgres.CreateContext();
        var recomputer = new DayStateRecomputer(
            db, calendar, new OperationalAlertRaiser(db, NullLogger<OperationalAlertRaiser>.Instance),
            NullLogger<DayStateRecomputer>.Instance);
        return new Harness(world, recomputer, db, customerId, pointId, messageId);
    }

    private static DayRecomputeRequest Request(Guid pointId) =>
        new(pointId, Delivery, Guid.CreateVersion7(), ReceivedAt);

    /// <summary>
    /// <b>Design §7.11, stored.</b> A 96-interval day whose first 48 intervals import 10 kWh and
    /// whose last 48 export: consumption 10 in each of the first 48 and 0 in the rest; production 0
    /// in the first 48 and 5 in the rest.
    /// <para>
    /// Per interval: U = +10 for 48 intervals and −5 for 48. Offtake 480, export 240, net 240,
    /// consumption 480, production 240.
    /// From daily totals alone: 480 − 240 = 240, so offtake would read 240 and export 0. Both wrong,
    /// and the second is a volume [DEC-23] settles as a sale line the customer is paid for.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_mixed_export_day_stores_the_per_interval_accumulators()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ProductionExpectation.Expected, ct);
        await using var _ = h.Db;

        var consumption = Enumerable.Range(1, 96).Select(pos => pos <= 48 ? 10m : 0m).ToArray();
        var production = Enumerable.Range(1, 96).Select(pos => pos <= 48 ? 0m : 5m).ToArray();

        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            ReceivedAt, consumption, ct);
        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Production, h.MessageId,
            ReceivedAt, production, ct);

        await h.Recomputer.RecomputeAsync(Request(h.PointId), ct);

        var row = await h.World.ReadDailyPositionAsync(h.PointId, Delivery, ct);
        row.ShouldNotBeNull();

        row.ConsumptionKwh.ShouldBe(480.000m);
        row.ProductionKwh.ShouldBe(240.000m);
        row.NetUsageKwh.ShouldBe(240.000m);

        // The two figures a daily-totals rollup gets wrong.
        row.OfftakeKwh.ShouldBe(480.000m);
        row.ExportKwh.ShouldBe(240.000m);

        // And the arithmetic that makes them tempting to derive: the NET total does agree.
        (row.ConsumptionKwh - row.ProductionKwh).ShouldBe(row.NetUsageKwh);
        row.OfftakeKwh.ShouldNotBe(row.NetUsageKwh);
    }

    [Fact]
    public async Task The_row_names_exactly_the_current_versions_it_was_computed_from()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ProductionExpectation.Expected, ct);
        await using var _ = h.Db;

        var consumption = await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            ReceivedAt, Enumerable.Repeat(4m, 96).ToArray(), ct);
        var production = await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Production, h.MessageId,
            ReceivedAt, Enumerable.Repeat(1m, 96).ToArray(), ct);

        await h.Recomputer.RecomputeAsync(Request(h.PointId), ct);

        var row = await h.World.ReadDailyPositionAsync(h.PointId, Delivery, ct);
        row!.SourceVersionIds.Order().ShouldBe(new[] { consumption, production }.Order());
    }

    /// <summary>
    /// After a supersession the row names the NEW version and not the old one. contract §5:
    /// source_version_ids "makes invalidation exact", and a list carrying superseded ids would have
    /// Phase 2 invalidating rollups that never depended on them.
    /// </summary>
    [Fact]
    public async Task A_superseded_version_drops_out_of_the_source_list()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ProductionExpectation.Never, ct);
        await using var _ = h.Db;

        var first = await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            ReceivedAt, Enumerable.Repeat(1m, 96).ToArray(), ct);
        await h.Recomputer.RecomputeAsync(Request(h.PointId), ct);

        await h.World.SupersedeAsync(first, ct);
        var second = await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            ReceivedAt.AddHours(1), Enumerable.Repeat(3m, 96).ToArray(), ct);

        await h.Recomputer.RecomputeAsync(
            new DayRecomputeRequest(h.PointId, Delivery, Guid.CreateVersion7(), ReceivedAt.AddHours(1)),
            ct);

        var row = await h.World.ReadDailyPositionAsync(h.PointId, Delivery, ct);
        row!.SourceVersionIds.ShouldBe(new[] { second });
        row.SourceVersionIds.ShouldNotContain(first);

        // And the figures follow the current version, not the sum of both.
        row.ConsumptionKwh.ShouldBe(288.000m);
    }

    /// <summary>
    /// [F02-R33]. A NEVER connection's production line is a stated zero, so every consumption
    /// interval has a complete pair and net usage equals consumption. Read as an absence instead,
    /// the whole day's net usage would be unknown and the customer's chart empty.
    /// </summary>
    [Fact]
    public async Task A_declared_zero_day_rolls_up_with_net_usage_equal_to_consumption()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ProductionExpectation.Never, ct);
        await using var _ = h.Db;

        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            ReceivedAt, Enumerable.Repeat(2.5m, 96).ToArray(), ct);

        await h.Recomputer.RecomputeAsync(Request(h.PointId), ct);

        var row = await h.World.ReadDailyPositionAsync(h.PointId, Delivery, ct);
        row!.ConsumptionKwh.ShouldBe(240.000m);
        row.ProductionKwh.ShouldBe(0.000m);
        row.NetUsageKwh.ShouldBe(240.000m);
        row.OfftakeKwh.ShouldBe(240.000m);
        row.ExportKwh.ShouldBe(0.000m);
        row.DataState.ShouldBe("PROVISIONAL");
    }

    /// <summary>
    /// A PARTIAL day still stores a rollup, and the data_state on the row is what says the figures
    /// cover less than the day. The read surfaces label every figure with its state [F02-R24], so a
    /// row with no state would be a number with no provenance.
    /// </summary>
    [Fact]
    public async Task A_partial_day_stores_its_rollup_carrying_the_partial_state()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ProductionExpectation.Never, ct);
        await using var _ = h.Db;

        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            ReceivedAt, Enumerable.Repeat(1m, 40).ToArray(), ct);

        await h.Recomputer.RecomputeAsync(Request(h.PointId), ct);

        var row = await h.World.ReadDailyPositionAsync(h.PointId, Delivery, ct);
        row!.DataState.ShouldBe("PARTIAL");
        row.ConsumptionKwh.ShouldBe(40.000m);
    }

    /// <summary>
    /// The two CHECK constraints, fired deliberately. They are the database's own statement that
    /// offtake and export are accumulated magnitudes rather than signed positions, so a sign error
    /// in DailyPositionCalculator arrives as a 23514 rather than as a plausible number.
    /// </summary>
    [Theory]
    [InlineData("offtake_kwh", "daily_position_offtake_kwh_check")]
    [InlineData("export_kwh", "daily_position_export_kwh_check")]
    public async Task A_negative_accumulator_is_refused_by_the_database(string column, string _)
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ProductionExpectation.Never, ct);
        await using var __ = h.Db;

        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            ReceivedAt, Enumerable.Repeat(1m, 96).ToArray(), ct);
        await h.Recomputer.RecomputeAsync(Request(h.PointId), ct);

        await using var connection = new NpgsqlConnection(postgres.ConnectionString);
        await connection.OpenAsync(ct);
        await using var command = new NpgsqlCommand(
            $"""
             UPDATE metering.daily_position SET {column} = -1
              WHERE metering_point_id = @pointId AND delivery_date = @deliveryDate;
             """,
            connection);
        command.Parameters.AddWithValue("pointId", h.PointId);
        command.Parameters.AddWithValue("deliveryDate", Delivery);

        var exception = await Should.ThrowAsync<PostgresException>(
            async () => await command.ExecuteNonQueryAsync(ct));

        exception.SqlState.ShouldBe("23514");
    }

    /// <summary>
    /// S2-D1. Every rollup row carries customer_id, resolved from the metering point, because both
    /// RLS coverage guards discover a table by that property and a table without one is invisible
    /// to them — reporting full coverage over unpoliced customer data.
    /// </summary>
    [Fact]
    public async Task Both_rollup_rows_carry_the_metering_points_customer()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ProductionExpectation.Never, ct);
        await using var _ = h.Db;

        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, Delivery, IntervalDirection.Consumption, h.MessageId,
            ReceivedAt, Enumerable.Repeat(1m, 96).ToArray(), ct);
        await h.Recomputer.RecomputeAsync(Request(h.PointId), ct);

        await using var connection = new NpgsqlConnection(postgres.ConnectionString);
        await connection.OpenAsync(ct);

        await using var dayState = new NpgsqlCommand(
            """
            SELECT customer_id FROM metering.metering_point_day_state
             WHERE metering_point_id = @pointId AND delivery_date = @deliveryDate;
            """,
            connection);
        dayState.Parameters.AddWithValue("pointId", h.PointId);
        dayState.Parameters.AddWithValue("deliveryDate", Delivery);
        ((Guid)(await dayState.ExecuteScalarAsync(ct))!).ShouldBe(h.CustomerId);

        await using var position = new NpgsqlCommand(
            """
            SELECT customer_id FROM metering.daily_position
             WHERE metering_point_id = @pointId AND delivery_date = @deliveryDate;
            """,
            connection);
        position.Parameters.AddWithValue("pointId", h.PointId);
        position.Parameters.AddWithValue("deliveryDate", Delivery);
        ((Guid)(await position.ExecuteScalarAsync(ct))!).ShouldBe(h.CustomerId);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail, or watch it pass and then mutate**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~DailyPositionPersistenceTests"
```

Task 7's recomputer already writes the row, so these should pass on the first run. **That is not
evidence.** Step 3 is.

⚠ If `A_negative_accumulator_is_refused_by_the_database` reports
`Should.ThrowAsync ... but no exception was thrown`, migration 9 shipped without the two `CHECK`
constraints contract §6.7 specifies. That is a **plan 2 defect and a blocker**, not something to work
around here: without them a sign error stores a plausible number. Stop and report it.

- [ ] **Step 3: MUTATION — swap the offtake and export accumulators, and predict the failure**

In `src/Core/PeakPower.Application/Ingestion/DailyPositionCalculator.cs`, invert the clamp:

```csharp
            if (netUsage > 0m)
            {
                exportTotal += netUsage;        // MUTATION
            }
            else
            {
                offtakeTotal += -netUsage;      // MUTATION
            }
```

Predict: `A_mixed_export_day_stores_the_per_interval_accumulators` fails with

```
Shouldly.ShouldAssertException : row.OfftakeKwh
    should be
480.000m
    but was
240.000m
```

and `A_declared_zero_day_rolls_up_with_net_usage_equal_to_consumption` fails on
`row.OfftakeKwh should be 240.000m but was 0.000m`. Both `CHECK` constraints stay satisfied — the
mutation swaps two non-negative magnitudes, it does not make either negative, which is why the
constraint test is not sufficient on its own and the mixed-export fixture is.

Run, confirm, restore.

- [ ] **Step 4: Second mutation — put every version in `source_version_ids`**

In `DayStateRecomputer.RecomputeAsync`, drop the `.Where(version => version.IsCurrent)` from the
`sourceVersionIds` projection.

Predict: `A_superseded_version_drops_out_of_the_source_list` fails with
`row.SourceVersionIds should be [<second>] but was [<first>, <second>]`, and
`The_row_names_exactly_the_current_versions_it_was_computed_from` stays green (nothing is superseded
there). Run, confirm, restore.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~DailyPositionPersistenceTests"
git add tests/PeakPower.Integration.Tests/Rollup/DailyPositionPersistenceTests.cs
git commit -m "Store the 4.1 accumulators, and name only the versions the row was computed from

Design 7.11 as a stored row: a day importing in its first 48 intervals and exporting in its last
48 stores offtake 480 and export 240, where daily totals would give 240 and 0. The net total
agrees either way, which is the whole reason the pair needs its own fixture.

source_version_ids lists the CURRENT versions only - contract 5 says it makes invalidation exact,
and superseded ids would have Phase 2 invalidating rollups that never depended on them. Verified
by mutation: dropping the IsCurrent filter turns the supersession case red and leaves the
first-write case green.

Swapping the two accumulators satisfies both CHECK constraints and turns the mixed-export day red
- the constraints catch a sign error, not a transposition, so the fixture has to."

---

### Task 10: `DayFinalisationJob` — ten working days, and the reopen edge that makes FINAL a status

`[F02-R23]`, as amended by `[DEC-98]`: *"A date becomes `FINAL` when 10 working days have passed
since the delivery date with no newer version, using the platform's working-day calendar. …`FINAL`
therefore means **"nothing newer arrived within the correction window"** — a status, not a guarantee.
A later version reopens the date to `PROVISIONAL` and it re-finalises on the same 10-working-day
rule."*

**S2-D8** settles the calendar the requirement invokes with the definite article and nothing defines:
**Monday–Friday, empty exclusion list, holidays ignored**. What makes ignoring them safe is `[DEC-98]`
itself — before it, finalising early across Christmas would have shut a correction window that should
have stayed open; after it, a post-window version simply reopens the date.

⚠ **Nothing archives, compacts or caches on the strength of `FINAL`** (design §7.12). The job moves a
status column and touches no reading. Step 6 asserts the row count is unchanged, because a status
field can be wrong and a row count cannot.

⚠ **The pre-filter is `delivery_date <= today − 14 calendar days`, and 14 is exact.** Ten weekdays
span at least fourteen calendar days (Monday to the Monday a fortnight later), so nothing due can be
excluded — and a 15-day filter would silently skip every date whose span is exactly the minimum,
which is every date falling on a Monday. The precise test is `AddWorkingDays(date, 10) <= today`,
applied in memory to the pre-filtered set.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Jobs/DayFinalisationJob.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj` (the `<PackageReference>` group)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/DayFinalisationJobTests.cs`

**Interfaces:**
- Consumes: `IMarketCalendar.AddWorkingDays`, `.TodayInAmsterdam`, `.UtcNow` (plan 1);
  `PeakPowerDbContext`; `DayStateRecomputer.DayStateText` (task 7).
- Produces:
  - `PeakPower.Ingestion.Jobs.DayFinalisationJob`, constructed as
    `new DayFinalisationJob(PeakPowerDbContext db, IMarketCalendar calendar, ILogger<DayFinalisationJob> logger)`,
    with `Task<int> RunAsync(CancellationToken ct)`
  - `DayFinalisationJob.WorkingDaysToFinal = 10`
  - `DayFinalisationJob.MinimumCalendarDaysToFinal = 14`

- [ ] **Step 1: Add the fake-clock package reference the test needs**

`Microsoft.Extensions.TimeProvider.Testing` is pinned at **10.9.0** in `Directory.Packages.props` and
already used by `PeakPower.Application.Tests`, but `PeakPower.Integration.Tests` does not reference
it. Edit
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj`,
adding to the `<PackageReference>` `ItemGroup`:

```xml
    <!-- Plan 5: DayFinalisationJob and SilenceDetectionJob are both "what does the calendar say
         today", so both are tested against a fixed clock rather than against the machine's. -->
    <PackageReference Include="Microsoft.Extensions.TimeProvider.Testing" />
```

- [ ] **Step 2: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/DayFinalisationJobTests.cs`:

```csharp
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using PeakPower.Application.Abstractions;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Infrastructure.Time;
using PeakPower.Ingestion.Alerts;
using PeakPower.Ingestion.Jobs;
using PeakPower.Ingestion.Rollup;
using PeakPower.Integration.Tests.Database;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Rollup;

/// <summary>
/// [F02-R23] on S2-D8's calendar, and [DEC-98]'s reopen edge.
/// <para>
/// <b>FINAL is a status, not a guarantee.</b> F02 §6 draws FINAL → PROVISIONAL as an ordinary edge
/// that a date may traverse more than once — reconciliation can arrive twice, and nothing in
/// [DEC-98] bounds how late. What finance relies on is [F02-R46], that whatever moves gets invoiced,
/// not that nothing moves.
/// </para>
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class DayFinalisationJobTests(PostgresFixture postgres)
{
    // Wednesday 12 August 2026. Ten working days later is Wednesday 26 August 2026 -
    // Thu 13, Fri 14, Mon 17, Tue 18, Wed 19, Thu 20, Fri 21, Mon 24, Tue 25, Wed 26.
    private static readonly DateOnly Delivery = new(2026, 8, 12);
    private static readonly DateOnly TenWorkingDaysLater = new(2026, 8, 26);
    private static readonly DateTimeOffset ReceivedAt = new(2026, 8, 13, 4, 2, 11, TimeSpan.Zero);

    /// <summary>
    /// A calendar whose "today" is the given Amsterdam date. 12:00 UTC is midday in Amsterdam in
    /// both CET and CEST, so the date never depends on which side of the DST boundary the fixture
    /// sits.
    /// </summary>
    private static IMarketCalendar CalendarOn(DateOnly today) =>
        new MarketCalendar(new FakeTimeProvider(
            new DateTimeOffset(today.Year, today.Month, today.Day, 12, 0, 0, TimeSpan.Zero)));

    private static IReadOnlyList<decimal> Flat(int count, decimal each) =>
        [.. Enumerable.Repeat(each, count)];

    private async Task<(RollupFixture World, Guid CustomerId, Guid PointId, Guid MessageId)>
        SeedProvisionalDayAsync(IMarketCalendar calendar, CancellationToken ct)
    {
        var world = new RollupFixture(postgres, calendar);
        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(
            customerId, world.NextEan(), ProductionExpectation.Never, ct);
        var messageId = await world.SeedInboundMessageAsync(ReceivedAt, ct);

        await using var db = postgres.CreateContext();
        var recomputer = new DayStateRecomputer(
            db, calendar, new OperationalAlertRaiser(db, NullLogger<OperationalAlertRaiser>.Instance),
            NullLogger<DayStateRecomputer>.Instance);

        await world.SeedVersionAsync(
            pointId, customerId, Delivery, IntervalDirection.Consumption, messageId,
            ReceivedAt, Flat(96, 1m), ct);
        await recomputer.RecomputeAsync(
            new DayRecomputeRequest(pointId, Delivery, Guid.CreateVersion7(), ReceivedAt), ct);

        return (world, customerId, pointId, messageId);
    }

    private DayFinalisationJob JobOn(
        IMarketCalendar calendar, out PeakPower.Persistence.PeakPowerDbContext db)
    {
        db = postgres.CreateContext();
        return new DayFinalisationJob(db, calendar, NullLogger<DayFinalisationJob>.Instance);
    }

    // ── The rule ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_provisional_day_finalises_on_the_tenth_working_day()
    {
        var ct = TestContext.Current.CancellationToken;
        var calendar = CalendarOn(TenWorkingDaysLater);
        var (world, _, pointId, _) = await SeedProvisionalDayAsync(calendar, ct);

        var job = JobOn(calendar, out var db);
        await using var _1 = db;

        var finalised = await job.RunAsync(ct);

        finalised.ShouldBeGreaterThanOrEqualTo(1);

        var row = await world.ReadDayStateAsync(pointId, Delivery, ct);
        row!.State.ShouldBe("FINAL");
        row.FinalisedAt.ShouldNotBeNull();

        // The rollup's own state moves with it, or the two tables disagree about the same day and
        // whichever one the read surface happens to join wins.
        (await world.ReadDailyPositionAsync(pointId, Delivery, ct))!.DataState.ShouldBe("FINAL");
    }

    [Fact]
    public async Task A_provisional_day_does_not_finalise_on_the_ninth_working_day()
    {
        var ct = TestContext.Current.CancellationToken;
        var calendar = CalendarOn(TenWorkingDaysLater.AddDays(-1));   // Tuesday 25 August 2026
        var (world, _, pointId, _) = await SeedProvisionalDayAsync(calendar, ct);

        var job = JobOn(calendar, out var db);
        await using var _1 = db;

        await job.RunAsync(ct);

        (await world.ReadDayStateAsync(pointId, Delivery, ct))!.State.ShouldBe("PROVISIONAL");
    }

    /// <summary>
    /// A day that is not complete has nothing to finalise. F02 §6's state machine has no
    /// PARTIAL → FINAL edge, and inventing one would invoice a day that is missing intervals.
    /// </summary>
    [Fact]
    public async Task A_partial_day_is_never_finalised_however_old_it_is()
    {
        var ct = TestContext.Current.CancellationToken;
        var calendar = CalendarOn(TenWorkingDaysLater.AddMonths(3));
        var world = new RollupFixture(postgres, calendar);
        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(
            customerId, world.NextEan(), ProductionExpectation.Never, ct);
        var messageId = await world.SeedInboundMessageAsync(ReceivedAt, ct);

        await using (var setupDb = postgres.CreateContext())
        {
            var recomputer = new DayStateRecomputer(
                setupDb, calendar,
                new OperationalAlertRaiser(setupDb, NullLogger<OperationalAlertRaiser>.Instance),
                NullLogger<DayStateRecomputer>.Instance);

            await world.SeedVersionAsync(
                pointId, customerId, Delivery, IntervalDirection.Consumption, messageId,
                ReceivedAt, Flat(40, 1m), ct);
            await recomputer.RecomputeAsync(
                new DayRecomputeRequest(pointId, Delivery, Guid.CreateVersion7(), ReceivedAt), ct);
        }

        var job = JobOn(calendar, out var db);
        await using var _1 = db;
        await job.RunAsync(ct);

        (await world.ReadDayStateAsync(pointId, Delivery, ct))!.State.ShouldBe("PARTIAL");
    }

    // ── S2-D8: holidays are working days, and the span proves it ───────────────────────────

    /// <summary>
    /// A ten-working-day span that crosses Christmas and New Year. Delivery Friday 18 December 2026;
    /// the ten weekdays are Mon 21, Tue 22, Wed 23, Thu 24, <b>Fri 25</b>, Mon 28, Tue 29, Wed 30,
    /// Thu 31 and <b>Fri 1 January 2027</b> — so the date finalises on 2027-01-01.
    /// <para>
    /// A holiday-aware calendar would push it into the following week. S2-D8 says holidays are
    /// ignored, and [DEC-98] is what makes that safe: a late reconciliation reopens the date rather
    /// than being locked out of a window that closed early.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_span_across_Christmas_finalises_on_the_weekday_count()
    {
        var ct = TestContext.Current.CancellationToken;
        var christmasDelivery = new DateOnly(2026, 12, 18);
        var dueOn = new DateOnly(2027, 1, 1);

        var onTheDayBefore = CalendarOn(dueOn.AddDays(-1));
        onTheDayBefore.AddWorkingDays(christmasDelivery, DayFinalisationJob.WorkingDaysToFinal)
            .ShouldBe(dueOn);

        var (world, _, pointId, _) = await SeedDayAsync(christmasDelivery, onTheDayBefore, ct);

        var early = JobOn(onTheDayBefore, out var earlyDb);
        await using (earlyDb)
        {
            await early.RunAsync(ct);
        }

        (await world.ReadDayStateAsync(pointId, christmasDelivery, ct))!.State.ShouldBe("PROVISIONAL");

        var onTheDay = CalendarOn(dueOn);
        var due = JobOn(onTheDay, out var dueDb);
        await using (dueDb)
        {
            await due.RunAsync(ct);
        }

        (await world.ReadDayStateAsync(pointId, christmasDelivery, ct))!.State.ShouldBe("FINAL");
    }

    /// <summary>
    /// King's Day, 27 April, is a Monday in 2026. Delivery Monday 20 April 2026; the ten weekdays
    /// are Tue 21, Wed 22, Thu 23, Fri 24, <b>Mon 27</b>, Tue 28, Wed 29, Thu 30, Fri 1 May and
    /// Mon 4 May — so the date finalises on 2026-05-04, not 2026-05-05.
    /// </summary>
    [Fact]
    public async Task A_span_across_Kings_Day_finalises_on_the_weekday_count()
    {
        var ct = TestContext.Current.CancellationToken;
        var kingsDelivery = new DateOnly(2026, 4, 20);
        var dueOn = new DateOnly(2026, 5, 4);

        var calendar = CalendarOn(dueOn);
        calendar.AddWorkingDays(kingsDelivery, DayFinalisationJob.WorkingDaysToFinal).ShouldBe(dueOn);

        var (world, _, pointId, _) = await SeedDayAsync(kingsDelivery, calendar, ct);

        var job = JobOn(calendar, out var db);
        await using var _1 = db;
        await job.RunAsync(ct);

        (await world.ReadDayStateAsync(pointId, kingsDelivery, ct))!.State.ShouldBe("FINAL");
    }

    // ── [DEC-98]: the reopen edge ──────────────────────────────────────────────────────────

    /// <summary>
    /// Design §7.12. A post-window reconciliation reopens the date to PROVISIONAL, recomputes the
    /// rollup, raises the informational notice and re-finalises on the same rule.
    /// </summary>
    [Fact]
    public async Task A_post_window_version_reopens_a_finalised_day_and_it_refinalises()
    {
        var ct = TestContext.Current.CancellationToken;
        var calendar = CalendarOn(TenWorkingDaysLater);
        var (world, customerId, pointId, messageId) = await SeedProvisionalDayAsync(calendar, ct);

        var job = JobOn(calendar, out var jobDb);
        await using (jobDb)
        {
            await job.RunAsync(ct);
        }

        var beforeCorrection = await world.ReadDayStateAsync(pointId, Delivery, ct);
        beforeCorrection!.State.ShouldBe("FINAL");
        var originalRollup = await world.ReadDailyPositionAsync(pointId, Delivery, ct);
        originalRollup!.ConsumptionKwh.ShouldBe(96.000m);

        // A reconciliation arrives a month after the window closed.
        var lateCalendar = CalendarOn(TenWorkingDaysLater.AddMonths(1));
        var lateWorld = new RollupFixture(postgres, lateCalendar);
        var correctionAt = new DateTimeOffset(2026, 9, 26, 9, 0, 0, TimeSpan.Zero);

        await using var db = postgres.CreateContext();
        var recomputer = new DayStateRecomputer(
            db, lateCalendar,
            new OperationalAlertRaiser(db, NullLogger<OperationalAlertRaiser>.Instance),
            NullLogger<DayStateRecomputer>.Instance);

        var current = await FindCurrentConsumptionVersionAsync(pointId, ct);
        await world.SupersedeAsync(current, ct);
        await lateWorld.SeedVersionAsync(
            pointId, customerId, Delivery, IntervalDirection.Consumption, messageId,
            correctionAt, Flat(96, 3m), ct);

        var reopened = await recomputer.RecomputeAsync(
            new DayRecomputeRequest(pointId, Delivery, Guid.CreateVersion7(), correctionAt), ct);

        reopened.ReopenedFromFinal.ShouldBeTrue();
        reopened.State.ShouldBe(MeteringDayState.Provisional);

        var row = await world.ReadDayStateAsync(pointId, Delivery, ct);
        row!.State.ShouldBe("PROVISIONAL");
        // The date is no longer finalised, so the moment it was finalised is no longer true of it.
        row.FinalisedAt.ShouldBeNull();
        row.LastCorrectedAt.ShouldNotBeNull();

        // The rollup was recomputed, not left stale. [DEC-98]: nothing may cache on FINAL.
        (await world.ReadDailyPositionAsync(pointId, Delivery, ct))!.ConsumptionKwh.ShouldBe(288.000m);

        // [F02-R45]: an informational notice to Finance, not an operator alert.
        var notices = (await world.ReadAlertsAsync(pointId, ct))
            .Where(alert => alert.Kind == "POST_WINDOW_RECONCILIATION")
            .ToArray();
        notices.Length.ShouldBe(1);
        notices[0].Summary.ShouldContain("reopened", Case.Sensitive);

        // And it re-finalises on the same rule, from the correction's own ten working days.
        var refinaliseCalendar = CalendarOn(new DateOnly(2026, 10, 12));
        var refinalise = JobOn(refinaliseCalendar, out var refinaliseDb);
        await using (refinaliseDb)
        {
            await refinalise.RunAsync(ct);
        }

        (await world.ReadDayStateAsync(pointId, Delivery, ct))!.State.ShouldBe("FINAL");
    }

    /// <summary>
    /// The other arm, and the reason DayRecomputeRequest.NewVersionReceivedAt is nullable. A replay
    /// that produced no new version [F02-R27], or a maintenance sweep, must leave a finalised date
    /// exactly as it was — otherwise inspecting an old message silently unfinalises the day it
    /// belongs to.
    /// </summary>
    [Fact]
    public async Task A_recompute_with_nothing_new_leaves_a_finalised_day_alone()
    {
        var ct = TestContext.Current.CancellationToken;
        var calendar = CalendarOn(TenWorkingDaysLater);
        var (world, _, pointId, _) = await SeedProvisionalDayAsync(calendar, ct);

        var job = JobOn(calendar, out var jobDb);
        await using (jobDb)
        {
            await job.RunAsync(ct);
        }

        var finalisedAt = (await world.ReadDayStateAsync(pointId, Delivery, ct))!.FinalisedAt;
        finalisedAt.ShouldNotBeNull();

        await using var db = postgres.CreateContext();
        var recomputer = new DayStateRecomputer(
            db, calendar, new OperationalAlertRaiser(db, NullLogger<OperationalAlertRaiser>.Instance),
            NullLogger<DayStateRecomputer>.Instance);

        var result = await recomputer.RecomputeAsync(
            new DayRecomputeRequest(pointId, Delivery, Guid.CreateVersion7(), newVersionReceivedAt: null),
            ct);

        result.ReopenedFromFinal.ShouldBeFalse();
        result.State.ShouldBe(MeteringDayState.Final);

        var row = await world.ReadDayStateAsync(pointId, Delivery, ct);
        row!.State.ShouldBe("FINAL");
        row.FinalisedAt!.Value.ToUniversalTime().ShouldBe(finalisedAt!.Value.ToUniversalTime());

        (await world.ReadAlertsAsync(pointId, ct))
            .ShouldNotContain(alert => alert.Kind == "POST_WINDOW_RECONCILIATION");
    }

    // ── Design §7.12: nothing archives, compacts or caches on FINAL ────────────────────────

    /// <summary>
    /// Asserted by row count rather than by reading the job's source, because the whole class of
    /// bug [DEC-98] creates is code that treats FINAL as permission to discard. A status field can
    /// be wrong about what happened; a row count cannot.
    /// </summary>
    [Fact]
    public async Task Finalising_deletes_no_readings_and_no_versions()
    {
        var ct = TestContext.Current.CancellationToken;
        var calendar = CalendarOn(TenWorkingDaysLater);
        var (world, _, pointId, _) = await SeedProvisionalDayAsync(calendar, ct);

        var versionId = await FindCurrentConsumptionVersionAsync(pointId, ct);
        var before = await world.CountIntervalReadingsAsync(versionId, Delivery, ct);
        before.ShouldBe(96L);

        var job = JobOn(calendar, out var db);
        await using var _1 = db;
        await job.RunAsync(ct);

        (await world.CountIntervalReadingsAsync(versionId, Delivery, ct)).ShouldBe(96L);
        (await world.IsCurrentAsync(versionId, ct)).ShouldBeTrue();
    }

    [Fact]
    public async Task Running_the_job_twice_finalises_nothing_the_second_time()
    {
        var ct = TestContext.Current.CancellationToken;
        var calendar = CalendarOn(TenWorkingDaysLater);
        var (_, _, pointId, _) = await SeedProvisionalDayAsync(calendar, ct);

        var job = JobOn(calendar, out var db);
        await using var _1 = db;

        var first = await job.RunAsync(ct);
        var second = await job.RunAsync(ct);

        first.ShouldBeGreaterThanOrEqualTo(1);
        // Not merely "does not throw": a job that re-finalises every FINAL day on every tick would
        // re-stamp finalised_at forever and destroy the one date an auditor would read.
        second.ShouldBe(0);
        pointId.ShouldNotBe(Guid.Empty);
    }

    [Fact]
    public void The_two_constants_are_the_rule_and_its_safe_prefilter()
    {
        DayFinalisationJob.WorkingDaysToFinal.ShouldBe(10);
        // Ten weekdays span at least fourteen calendar days - Monday to the Monday a fortnight
        // later - so a fourteen-day pre-filter can exclude nothing that is due. Fifteen would skip
        // every date whose span is exactly the minimum, which is every Monday.
        DayFinalisationJob.MinimumCalendarDaysToFinal.ShouldBe(14);
    }

    private async Task<(RollupFixture World, Guid CustomerId, Guid PointId, Guid MessageId)>
        SeedDayAsync(DateOnly deliveryDate, IMarketCalendar calendar, CancellationToken ct)
    {
        var world = new RollupFixture(postgres, calendar);
        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(
            customerId, world.NextEan(), ProductionExpectation.Never, ct);
        var receivedAt = new DateTimeOffset(
            deliveryDate.Year, deliveryDate.Month, deliveryDate.Day, 4, 0, 0, TimeSpan.Zero)
            .AddDays(1);
        var messageId = await world.SeedInboundMessageAsync(receivedAt, ct);

        await using var db = postgres.CreateContext();
        var recomputer = new DayStateRecomputer(
            db, calendar, new OperationalAlertRaiser(db, NullLogger<OperationalAlertRaiser>.Instance),
            NullLogger<DayStateRecomputer>.Instance);

        await world.SeedVersionAsync(
            pointId, customerId, deliveryDate, IntervalDirection.Consumption, messageId,
            receivedAt, Flat(calendar.ExpectedIntervalCount(deliveryDate), 1m), ct);
        await recomputer.RecomputeAsync(
            new DayRecomputeRequest(pointId, deliveryDate, Guid.CreateVersion7(), receivedAt), ct);

        return (world, customerId, pointId, messageId);
    }

    private async Task<Guid> FindCurrentConsumptionVersionAsync(Guid pointId, CancellationToken ct)
    {
        await using var connection = new Npgsql.NpgsqlConnection(postgres.ConnectionString);
        await connection.OpenAsync(ct);
        await using var command = new Npgsql.NpgsqlCommand(
            """
            SELECT id FROM metering.interval_data_version
             WHERE metering_point_id = @pointId AND direction = 'CONSUMPTION' AND is_current;
            """,
            connection);
        command.Parameters.AddWithValue("pointId", pointId);
        return (Guid)(await command.ExecuteScalarAsync(ct))!;
    }
}
```

- [ ] **Step 3: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~DayFinalisationJobTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'DayFinalisationJob' could not be found`.

- [ ] **Step 4: Write `DayFinalisationJob`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Jobs/DayFinalisationJob.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using PeakPower.Application.Abstractions;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Rollup;
using PeakPower.Persistence;

namespace PeakPower.Ingestion.Jobs;

/// <summary>
/// Moves PROVISIONAL days to FINAL once ten working days have passed with no newer version.
/// <c>[F02-R23]</c>, on <b>S2-D8</b>'s calendar.
/// </summary>
/// <remarks>
/// <para>
/// <b>FINAL is a status, not a guarantee</b> <c>[DEC-98]</c>. It means only that nothing newer
/// arrived within the correction window. A later version reopens the date to PROVISIONAL — that is
/// <c>DayStateRecomputer</c>'s job, not this one — and it re-finalises here on the same rule. F02 §6
/// draws the edge as ordinary and a date may traverse it more than once.
/// </para>
/// <para>
/// ⚠ <b>Nothing here archives, compacts or caches.</b> The job moves a status column on two tables
/// and touches no <c>interval_reading</c> and no <c>interval_data_version</c>. Design §7.12 requires
/// that, and it is asserted by row count rather than by inspection.
/// </para>
/// <para>
/// <b>S2-D8: Monday to Friday, empty exclusion list, holidays ignored.</b> The weekday set and the
/// exclusion list live in the <c>[DEC-14]</c> calendar behind
/// <see cref="IMarketCalendar.AddWorkingDays"/>, so populating the list later is a row rather than a
/// release. What makes ignoring holidays safe is <c>[DEC-98]</c> itself: before it, finalising early
/// across Christmas would have shut a correction window that should have stayed open.
/// </para>
/// </remarks>
public sealed class DayFinalisationJob(
    PeakPowerDbContext db, IMarketCalendar calendar, ILogger<DayFinalisationJob> logger)
{
    /// <summary><c>[F02-R23]</c>'s ten.</summary>
    public const int WorkingDaysToFinal = 10;

    /// <summary>
    /// The safe calendar-day pre-filter, and fourteen is exact rather than generous.
    /// </summary>
    /// <remarks>
    /// Ten weekdays span at least fourteen calendar days — Monday to the Monday a fortnight later —
    /// so nothing due can be excluded by it. <b>Fifteen would silently skip every date whose span is
    /// exactly the minimum, which is every date falling on a Monday</b>, and the symptom would be
    /// one weekday's worth of days that never finalise.
    /// </remarks>
    public const int MinimumCalendarDaysToFinal = 14;

    /// <returns>How many (metering point, delivery date) pairs moved to FINAL.</returns>
    public async Task<int> RunAsync(CancellationToken ct)
    {
        var today = calendar.TodayInAmsterdam;
        var cutoff = today.AddDays(-MinimumCalendarDaysToFinal);

        var provisionalState = DayStateRecomputer.DayStateText(MeteringDayState.Provisional);

        // The pre-filter keeps the scan proportional to the correction window rather than to the
        // whole history; the exact rule is applied in memory below, because AddWorkingDays is a
        // calendar the database does not have.
        var candidates = await db.MeteringPointDayStates
            .Where(state => state.State == MeteringDayState.Provisional
                            && state.DeliveryDate <= cutoff)
            .Select(state => new { state.MeteringPointId, state.DeliveryDate })
            .ToListAsync(ct);

        var due = candidates
            .Where(candidate =>
                calendar.AddWorkingDays(candidate.DeliveryDate, WorkingDaysToFinal) <= today)
            .ToList();

        if (due.Count == 0)
        {
            logger.LogDebug(
                "Finalisation swept {Candidates} provisional day(s) on or before {Cutoff}; none had "
                + "reached ten working days.",
                candidates.Count, cutoff);
            return 0;
        }

        var pointIds = due.ConvertAll(candidate => candidate.MeteringPointId).ToArray();
        var dates = due.ConvertAll(candidate => candidate.DeliveryDate).ToArray();
        var finalisedAt = calendar.UtcNow;
        var finalState = DayStateRecomputer.DayStateText(MeteringDayState.Final);

        // One statement rather than a loop: a partial sweep would leave the day state and the
        // rollup disagreeing about the same day, and whichever table a read surface happened to
        // join would win.
        var moved = await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE metering.metering_point_day_state existing
                SET state = {finalState}, finalised_at = {finalisedAt}, computed_at = {finalisedAt}
               FROM unnest({pointIds}::uuid[], {dates}::date[]) AS due(metering_point_id, delivery_date)
              WHERE existing.metering_point_id = due.metering_point_id
                AND existing.delivery_date = due.delivery_date
                AND existing.state = {provisionalState};
             """,
            ct);

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE metering.daily_position existing
                SET data_state = {finalState}, computed_at = {finalisedAt}
               FROM unnest({pointIds}::uuid[], {dates}::date[]) AS due(metering_point_id, delivery_date)
              WHERE existing.metering_point_id = due.metering_point_id
                AND existing.delivery_date = due.delivery_date
                AND existing.data_state = {provisionalState};
             """,
            ct);

        logger.LogInformation(
            "Finalised {Moved} (metering point, delivery date) pair(s) that reached ten working days "
            + "on or before {Today}. FINAL is a status, not a guarantee - a later version reopens the "
            + "date and it re-finalises on the same rule [DEC-98].",
            moved, today);

        return moved;
    }
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~DayFinalisationJobTests"
```

Expected: PASS — 10 tests.

⚠ If `A_span_across_Christmas_finalises_on_the_weekday_count` fails on the very first assertion —
`onTheDayBefore.AddWorkingDays(...) should be 2027-01-01 but was 2027-01-06` — plan 1 implemented
`AddWorkingDays` against a **holiday-aware** calendar. That contradicts **S2-D8** and design §11
row 8. Stop and report it rather than adjusting the fixture: the expected date here is hand-checked
against the weekday count and the requirement, not derived from the implementation.

- [ ] **Step 6: MUTATION — widen the pre-filter to fifteen days, and predict the failure**

This is the off-by-one that is invisible on almost every date. In `DayFinalisationJob`, change
`MinimumCalendarDaysToFinal` to `15`.

Predict: `The_two_constants_are_the_rule_and_its_safe_prefilter` fails immediately on
`DayFinalisationJob.MinimumCalendarDaysToFinal should be 14 but was 15` — which proves only that the
constant is pinned. The behavioural failure is the one to look for, and **on this fixture there is
none**: 12 August 2026 to 26 August 2026 is fourteen calendar days, and `<= today.AddDays(-15)` is
`<= 2026-08-11`, which excludes it. So
`A_provisional_day_finalises_on_the_tenth_working_day` **also** goes red with
`finalised should be greater than or equal to 1 but was 0`.

Run, confirm **both** failures, restore. If only the constant test went red, the fixture's delivery
date is not on the minimum span and the behavioural half is not being exercised — change the fixture,
not the assertion.

- [ ] **Step 7: Second mutation — leave `daily_position` behind**

Delete the second `ExecuteSqlInterpolatedAsync` in `RunAsync`.

Predict: `A_provisional_day_finalises_on_the_tenth_working_day` fails with

```
Shouldly.ShouldAssertException : (await world.ReadDailyPositionAsync(pointId, Delivery, ct))!.DataState
    should be
"FINAL"
    but was
"PROVISIONAL"
```

— the two tables now disagree about the same day, and which one a read surface believes depends on
which it happens to join. Run, confirm, restore.

- [ ] **Step 8: Third mutation — re-finalise days that are already FINAL**

Remove `AND existing.state = {provisionalState}` from the first statement and drop the
`state.State == MeteringDayState.Provisional` predicate from the LINQ query.

Predict: `Running_the_job_twice_finalises_nothing_the_second_time` fails with
`second should be 0 but was 1`, and `A_partial_day_is_never_finalised_however_old_it_is` fails with
`should be "PARTIAL" but was "FINAL"` — a day missing 56 intervals would be finalised and invoiced.
Run, confirm, restore.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~DayFinalisationJobTests"
git add src/Infrastructure/PeakPower.Ingestion/Jobs/DayFinalisationJob.cs \
        tests/PeakPower.Integration.Tests/Rollup/DayFinalisationJobTests.cs \
        tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj
git commit -m "Finalise on ten working days, and reopen on the eleventh if something arrives

F02-R23 on S2-D8's calendar: Monday to Friday, empty exclusion list, holidays ignored. Two
hand-checked spans prove the last part - 18 December 2026 finalises on 1 January 2027 and
20 April 2026 on 4 May 2026, both counting the public holiday inside them as a working day.
DEC-98 is what makes that safe: a late reconciliation reopens the date rather than being locked
out of a window that closed early.

Nothing archives, compacts or caches on FINAL, asserted by reading count rather than by
inspection - a status field can be wrong about what happened and a row count cannot.

Three mutations. A fifteen-day pre-filter turns the fixture red, because ten weekdays span
exactly fourteen calendar days from a Monday and fifteen skips every one of them. Dropping the
daily_position update leaves the two tables disagreeing about the same day. Dropping the
PROVISIONAL predicate finalises a day missing 56 intervals."

---

### Task 11: `SilenceDetectionJob` — two cadence windows, per metering point, naming the BRP that owes the data

`[F02-R26]`, as amended by `[DEC-69]`: *"A monitoring job detects metering points with no data for
more than N days… Under `[DEC-38]` the expectation is exact — **one document per EAN per day** — so
silence is detected **per metering point** rather than inferred from a batch… the expected cadence is
a property of the metering point's BRP adapter and N is configurable per BRP; the detector itself is
BRP-agnostic and the alert names the BRP that owes the data."*

Design §7.21: *"A metering point that receives nothing for two of the BRP's `expected_cadence`
windows appears as silent on the employee data-health screen; one that receives on cadence does not."*

⚠ **Silence is measured from `interval_data_version.received_at`, not from `delivery_date`.** The
question is whether documents are arriving, and allocation data for day *D* legitimately arrives on
*D+1*. Measuring from the delivery date would fold that normal one-day lag into the threshold and
make every healthy connection look one window closer to silent than it is.

⚠ **A metering point that has never received anything is silent too, after a grace of two windows
from its `valid_from`.** A connection registered a fortnight ago that has never had a document is
exactly the case `[F02-R26]` is for; excluding it because it has no baseline would make the detector
blind to the worst case.

⚠ **The detector is BRP-agnostic** `[F02-R40]`. It branches on `metering.brp.expected_cadence`, which
is data, and on nothing else. The only cadence migration 9 seeds is `DAILY_PER_EAN`, and an
unrecognised value throws rather than defaulting — a default here would silently give a new BRP a
cadence nobody chose.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Jobs/SilenceDetectionJob.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/SilenceDetectionJobTests.cs`

**Interfaces:**
- Consumes: `IMarketCalendar.UtcNow`, `.TodayInAmsterdam`; `IOperationalAlertRaiser` (task 1);
  `AlertCopy.MeteringPointSilent` (task 6); `PeakPowerDbContext`; `Brp.ExpectedCadence`, `Brp.Code`.
- Produces:
  - `PeakPower.Ingestion.Jobs.SilenceDetectionJob`, constructed as
    `new SilenceDetectionJob(PeakPowerDbContext db, IMarketCalendar calendar, IOperationalAlertRaiser alerts, ILogger<SilenceDetectionJob> logger)`,
    with `Task<SilenceSweepResult> RunAsync(CancellationToken ct)`
  - `SilenceDetectionJob.CadenceWindowsBeforeSilent = 2`
  - `SilenceDetectionJob.CadenceWindow(string expectedCadence)` — `public static TimeSpan`
  - `PeakPower.Ingestion.Jobs.SilenceSweepResult(int Examined, int Silent, int Raised, int Resolved)`

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/SilenceDetectionJobTests.cs`:

```csharp
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using PeakPower.Application.Abstractions;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Infrastructure.Time;
using PeakPower.Ingestion.Alerts;
using PeakPower.Ingestion.Jobs;
using PeakPower.Integration.Tests.Database;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Rollup;

/// <summary>
/// [F02-R26] and design §7.21: a metering point that receives nothing for two of its BRP's cadence
/// windows appears as silent; one that receives on cadence does not.
/// <para>
/// <b>Silence is measured from when a document last ARRIVED, not from the day it was about.</b>
/// Allocation data for day D legitimately arrives on D+1, so measuring from the delivery date would
/// fold that normal lag into the threshold and make every healthy connection look a window closer
/// to silent than it is.
/// </para>
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class SilenceDetectionJobTests(PostgresFixture postgres)
{
    private static readonly DateTimeOffset Now = new(2026, 8, 20, 6, 0, 0, TimeSpan.Zero);

    private static IMarketCalendar CalendarAt(DateTimeOffset now) =>
        new MarketCalendar(new FakeTimeProvider(now));

    private sealed record Harness(
        RollupFixture World,
        SilenceDetectionJob Job,
        PeakPower.Persistence.PeakPowerDbContext Db,
        Guid CustomerId,
        Guid PointId,
        string Ean);

    private async Task<Harness> ArrangeAsync(
        CancellationToken ct, DateTimeOffset? now = null, DateOnly? validFrom = null)
    {
        var calendar = CalendarAt(now ?? Now);
        var world = new RollupFixture(postgres, calendar);
        var customerId = await world.SeedCustomerAsync(ct);
        var ean = world.NextEan();
        var pointId = await world.SeedMeteringPointAsync(
            customerId, ean, ProductionExpectation.Never, ct,
            validFrom: validFrom ?? new DateOnly(2024, 1, 1));

        var db = postgres.CreateContext();
        var job = new SilenceDetectionJob(
            db,
            calendar,
            new OperationalAlertRaiser(db, NullLogger<OperationalAlertRaiser>.Instance),
            NullLogger<SilenceDetectionJob>.Instance);

        return new Harness(world, job, db, customerId, pointId, ean);
    }

    private static IReadOnlyList<decimal> Flat(int count, decimal each) =>
        [.. Enumerable.Repeat(each, count)];

    private async Task ReceiveAsync(Harness h, DateTimeOffset receivedAt, CancellationToken ct)
    {
        var messageId = await h.World.SeedInboundMessageAsync(receivedAt, ct);
        await h.World.SeedVersionAsync(
            h.PointId, h.CustomerId, DateOnly.FromDateTime(receivedAt.UtcDateTime).AddDays(-1),
            IntervalDirection.Consumption, messageId, receivedAt, Flat(96, 1m), ct);
    }

    // ── Design §7.21, both halves ──────────────────────────────────────────────────────────

    [Fact]
    public async Task A_point_that_received_yesterday_is_not_silent()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ct);
        await using var _ = h.Db;

        await ReceiveAsync(h, Now.AddDays(-1), ct);

        var result = await h.Job.RunAsync(ct);

        result.Examined.ShouldBeGreaterThanOrEqualTo(1);
        (await h.World.ReadAlertsAsync(h.PointId, ct))
            .ShouldNotContain(alert => alert.Kind == "METERING_POINT_SILENT");
        result.Raised.ShouldBe(0);
    }

    [Fact]
    public async Task A_point_that_last_received_three_days_ago_is_silent_and_the_alert_names_the_BRP()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ct);
        await using var _ = h.Db;

        await ReceiveAsync(h, Now.AddDays(-3), ct);

        var result = await h.Job.RunAsync(ct);

        result.Raised.ShouldBe(1);

        var alert = (await h.World.ReadAlertsAsync(h.PointId, ct))
            .Single(row => row.Kind == "METERING_POINT_SILENT");

        alert.Status.ShouldBe("OPEN");
        alert.Summary.ShouldContain(h.Ean, Case.Sensitive);
        // [DEC-69]: the alert names the BRP that owes the data.
        alert.Summary.ShouldContain("PVNED", Case.Sensitive);
        alert.BrpId.ShouldBe(RollupFixture.PvnedBrpId);
        // Silence is about a point, not a day. A delivery date here would be a guess about which
        // day is missing, and the point may be missing all of them.
        alert.DeliveryDate.ShouldBeNull();
    }

    /// <summary>
    /// The boundary, both sides. Two windows of one day is 48 hours: 47 hours 59 minutes is not
    /// silent, 48 hours exactly is.
    /// </summary>
    [Theory]
    [InlineData(-47.9, false)]
    [InlineData(-48.0, true)]
    [InlineData(-72.0, true)]
    public async Task Two_cadence_windows_is_the_threshold(double hoursAgo, bool silent)
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ct);
        await using var _ = h.Db;

        await ReceiveAsync(h, Now.AddHours(hoursAgo), ct);

        var result = await h.Job.RunAsync(ct);

        result.Raised.ShouldBe(silent ? 1 : 0);
    }

    // ── Never heard from at all ────────────────────────────────────────────────────────────

    /// <summary>
    /// The worst case, and the one a baseline-requiring detector would miss entirely: a connection
    /// registered and routed to a BRP that has never sent a single document for it.
    /// </summary>
    [Fact]
    public async Task A_point_that_has_never_received_anything_is_silent_after_its_grace()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ct, validFrom: new DateOnly(2026, 8, 1));
        await using var _ = h.Db;

        var result = await h.Job.RunAsync(ct);

        result.Raised.ShouldBe(1);
        (await h.World.ReadAlertsAsync(h.PointId, ct))
            .ShouldContain(alert => alert.Kind == "METERING_POINT_SILENT");
    }

    /// <summary>
    /// A connection registered this morning is not silent. Without the grace, every newly claimed
    /// EAN would raise an alert before the BRP has had a chance to send anything at all - and an
    /// alert channel that fires on every onboarding is one nobody reads.
    /// </summary>
    [Fact]
    public async Task A_point_registered_today_is_not_yet_silent()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ct, validFrom: new DateOnly(2026, 8, 20));
        await using var _ = h.Db;

        var result = await h.Job.RunAsync(ct);

        result.Raised.ShouldBe(0);
    }

    /// <summary>
    /// A connection whose validity period has closed owes nothing. [F01-R27]'s end date is
    /// exclusive, so a point that ended yesterday is out of scope today.
    /// </summary>
    [Fact]
    public async Task A_point_whose_validity_has_ended_is_not_examined()
    {
        var ct = TestContext.Current.CancellationToken;
        var calendar = CalendarAt(Now);
        var world = new RollupFixture(postgres, calendar);
        var customerId = await world.SeedCustomerAsync(ct);
        var pointId = await world.SeedMeteringPointAsync(
            customerId, world.NextEan(), ProductionExpectation.Never, ct,
            validFrom: new DateOnly(2024, 1, 1), validTo: new DateOnly(2026, 8, 1));

        await using var db = postgres.CreateContext();
        var job = new SilenceDetectionJob(
            db, calendar, new OperationalAlertRaiser(db, NullLogger<OperationalAlertRaiser>.Instance),
            NullLogger<SilenceDetectionJob>.Instance);

        await job.RunAsync(ct);

        (await world.ReadAlertsAsync(pointId, ct)).ShouldBeEmpty();
    }

    // ── Recovery ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_point_that_starts_receiving_again_has_its_alert_resolved()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ct);
        await using var _ = h.Db;

        await ReceiveAsync(h, Now.AddDays(-3), ct);
        (await h.Job.RunAsync(ct)).Raised.ShouldBe(1);

        // The BRP catches up. A new calendar, because "now" has moved on.
        await ReceiveAsync(h, Now.AddHours(1), ct);

        await using var laterDb = postgres.CreateContext();
        var laterCalendar = CalendarAt(Now.AddHours(2));
        var laterJob = new SilenceDetectionJob(
            laterDb, laterCalendar,
            new OperationalAlertRaiser(laterDb, NullLogger<OperationalAlertRaiser>.Instance),
            NullLogger<SilenceDetectionJob>.Instance);

        var recovery = await laterJob.RunAsync(ct);

        recovery.Resolved.ShouldBeGreaterThanOrEqualTo(1);

        var alert = (await h.World.ReadAlertsAsync(h.PointId, ct))
            .Single(row => row.Kind == "METERING_POINT_SILENT");
        alert.Status.ShouldBe("RESOLVED");
        alert.ResolvedAt.ShouldNotBeNull();
    }

    /// <summary>
    /// The sweep runs on a schedule, so it runs against a still-silent point many times. One row.
    /// </summary>
    [Fact]
    public async Task Sweeping_twice_raises_one_alert()
    {
        var ct = TestContext.Current.CancellationToken;
        var h = await ArrangeAsync(ct);
        await using var _ = h.Db;

        await ReceiveAsync(h, Now.AddDays(-5), ct);

        (await h.Job.RunAsync(ct)).Raised.ShouldBe(1);
        (await h.Job.RunAsync(ct)).Raised.ShouldBe(0);

        (await h.World.ReadAlertsAsync(h.PointId, ct))
            .Count(alert => alert.Kind == "METERING_POINT_SILENT")
            .ShouldBe(1);
    }

    // ── The cadence is data, and unknown data is refused ───────────────────────────────────

    [Fact]
    public void The_seeded_cadence_is_one_document_per_EAN_per_day() =>
        SilenceDetectionJob.CadenceWindow("DAILY_PER_EAN").ShouldBe(TimeSpan.FromDays(1));

    [Fact]
    public void Two_windows_is_the_threshold_constant() =>
        SilenceDetectionJob.CadenceWindowsBeforeSilent.ShouldBe(2);

    /// <summary>
    /// A default arm here would silently give a new BRP a cadence nobody chose, and the first
    /// symptom would be alerts that never fire.
    /// </summary>
    [Fact]
    public void An_unrecognised_cadence_is_refused_rather_than_defaulted() =>
        Should.Throw<ArgumentOutOfRangeException>(
            () => SilenceDetectionJob.CadenceWindow("HOURLY_PER_PORTFOLIO"));
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~SilenceDetectionJobTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'SilenceDetectionJob' could not be found`.

- [ ] **Step 3: Write `SilenceDetectionJob`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Jobs/SilenceDetectionJob.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using PeakPower.Application.Abstractions;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Alerts;
using PeakPower.Persistence;

namespace PeakPower.Ingestion.Jobs;

/// <param name="Examined">Metering points in scope: valid today and routed to a BRP.</param>
/// <param name="Silent">How many of those are currently silent.</param>
/// <param name="Raised">How many alerts this sweep actually wrote (the rest were already open).</param>
/// <param name="Resolved">How many open silence alerts this sweep closed because data resumed.</param>
public sealed record SilenceSweepResult(int Examined, int Silent, int Raised, int Resolved);

/// <summary>
/// Detects metering points that have gone quiet, per point and per BRP cadence. <c>[F02-R26]</c>,
/// amended by <c>[DEC-69]</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Per metering point, not per batch.</b> Under <c>[DEC-38]</c> the expectation is exact — one
/// document per EAN per day — so a connection that stops arriving is detectable on its own rather
/// than inferred from a day's volume.
/// </para>
/// <para>
/// <b>Measured from receipt, not from delivery date.</b> The question is whether documents are
/// arriving. Allocation data for day D legitimately arrives on D+1, so a threshold applied to the
/// delivery date would fold that normal lag in and make every healthy connection look one window
/// closer to silent than it is.
/// </para>
/// <para>
/// <b>BRP-agnostic</b> <c>[F02-R40]</c>: it branches on <c>metering.brp.expected_cadence</c>, which
/// is data, and on nothing else. The alert names the BRP that owes the data.
/// </para>
/// <para>
/// <b>No channel delivers the alert</b> (design §3.2). It is a row the employee data-health screen
/// renders, and design §1.1 records that this is why the Phase-1 exit criterion "ingestion alerting
/// proven by a deliberate outage test" is not met.
/// </para>
/// </remarks>
public sealed class SilenceDetectionJob(
    PeakPowerDbContext db,
    IMarketCalendar calendar,
    IOperationalAlertRaiser alerts,
    ILogger<SilenceDetectionJob> logger)
{
    /// <summary>Design §7.21: two of the BRP's cadence windows.</summary>
    public const int CadenceWindowsBeforeSilent = 2;

    /// <summary>
    /// The cadence, as a window. <c>DAILY_PER_EAN</c> is the only value migration 9 seeds and the
    /// only one <c>ck_brp_expected_cadence</c> allows.
    /// </summary>
    /// <remarks>
    /// ⚠ <b>No default arm.</b> A default would silently give a new BRP a cadence nobody chose, and
    /// the first symptom would be alerts that never fire — the quietest possible failure in a
    /// detector whose whole job is noticing quiet.
    /// </remarks>
    public static TimeSpan CadenceWindow(string expectedCadence) => expectedCadence switch
    {
        "DAILY_PER_EAN" => TimeSpan.FromDays(1),
        _ => throw new ArgumentOutOfRangeException(
            nameof(expectedCadence),
            expectedCadence,
            "Only DAILY_PER_EAN is defined. Add the new cadence here and to "
            + "ck_brp_expected_cadence in the same commit; defaulting would give a BRP a window "
            + "nobody chose."),
    };

    public async Task<SilenceSweepResult> RunAsync(CancellationToken ct)
    {
        var now = calendar.UtcNow;
        var today = calendar.TodayInAmsterdam;

        // Valid today. ValidTo is an EXCLUSIVE upper bound [F01-R27], so a point that ended today
        // is already out of scope.
        var points = await (
            from point in db.MeteringPoints
            join brp in db.Brps on point.BrpId equals brp.Id
            where point.ValidFrom <= today && (point.ValidTo == null || point.ValidTo > today)
            select new
            {
                point.Id,
                point.Ean,
                point.ValidFrom,
                BrpId = brp.Id,
                BrpCode = brp.Code,
                brp.ExpectedCadence,
            })
            .ToListAsync(ct);

        if (points.Count == 0)
        {
            return new SilenceSweepResult(0, 0, 0, 0);
        }

        var lastReceived = await db.IntervalDataVersions
            .GroupBy(version => version.MeteringPointId)
            .Select(group => new
            {
                MeteringPointId = group.Key,
                LastReceivedAt = group.Max(version => version.ReceivedAt),
            })
            .ToDictionaryAsync(row => row.MeteringPointId, row => row.LastReceivedAt, ct);

        var silent = 0;
        var raised = 0;
        var resolved = 0;

        foreach (var point in points)
        {
            var threshold = CadenceWindow(point.ExpectedCadence) * CadenceWindowsBeforeSilent;

            var isSilent = lastReceived.TryGetValue(point.Id, out var last)
                ? now - last >= threshold
                // Never heard from at all. The grace runs from the connection's own validity start,
                // so a newly claimed EAN is not alerted before the BRP has had a chance to send
                // anything - and a connection registered a fortnight ago that has never received a
                // document is exactly the case [F02-R26] exists for.
                : today.ToDateTime(TimeOnly.MinValue) - point.ValidFrom.ToDateTime(TimeOnly.MinValue)
                  >= threshold;

            if (!isSilent)
            {
                // Data resumed, or never stopped. A point that went quiet and came back is one
                // recovery, so every open silence alert for it closes, whatever date each names.
                resolved += await alerts.ResolveOpenAsync(
                    OperationalAlertKind.MeteringPointSilent, point.Id, deliveryDate: null, now, ct);
                continue;
            }

            silent++;

            var daysSilent = lastReceived.TryGetValue(point.Id, out var lastSeen)
                ? (int)Math.Floor((now - lastSeen).TotalDays)
                : today.DayNumber - point.ValidFrom.DayNumber;

            var (summary, detail) = AlertCopy.MeteringPointSilent(
                point.Ean.Value, point.BrpCode, daysSilent);

            var wrote = await alerts.RaiseAsync(
                new OperationalAlertRequest(
                    OperationalAlertKind.MeteringPointSilent,
                    summary,
                    detail,
                    point.Id,
                    point.BrpId,
                    InboundMessageId: null,
                    // ⚠ Null on purpose. Silence is a property of a connection, not of a day, and a
                    // delivery date here would be a guess about which day is missing when the point
                    // may be missing all of them. It is also what makes the raiser's
                    // IS NOT DISTINCT FROM dedupe load-bearing.
                    DeliveryDate: null,
                    RaisedAt: now),
                ct);

            if (wrote)
            {
                raised++;
            }
        }

        logger.LogInformation(
            "Silence sweep at {Now}: examined {Examined} metering point(s), {Silent} silent, "
            + "{Raised} new alert(s), {Resolved} resolved.",
            now, points.Count, silent, raised, resolved);

        return new SilenceSweepResult(points.Count, silent, raised, resolved);
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~SilenceDetectionJobTests"
```

Expected: PASS — 12 test cases (the three-row theory expands).

⚠ Two failures worth naming in advance:

- `The LINQ expression … GroupBy … could not be translated` — the `GroupBy`/`Max` projection must
  stay in that exact shape; EF Core translates a key-plus-aggregate `Select` and nothing looser.
- `Examined` larger than expected, or an unrelated point going silent, because other test classes in
  the `postgres` collection seeded metering points. **That is correct behaviour and the assertions
  above are written for it** — every count assertion is either `ShouldBeGreaterThanOrEqualTo` or
  scoped to `h.PointId`, except `Raised`, which is safe because a point another class seeded either
  has data (not silent) or was already alerted on a previous sweep.
  If `Raised` proves flaky in practice, scope it by reading the alert rows for `h.PointId` instead of
  trusting the counter — do **not** relax it to `ShouldBeGreaterThanOrEqualTo(1)`, which would pass
  against a detector that alerts on everything.

- [ ] **Step 5: MUTATION — measure silence from the delivery date instead of the receipt time**

This is the plausible wrong implementation: it reads more naturally, and it is wrong by exactly the
normal one-day lag.

Replace the `lastReceived` query with one over `DeliveryDate`:

```csharp
        var lastReceived = await db.IntervalDataVersions
            .GroupBy(version => version.MeteringPointId)
            .Select(group => new
            {
                MeteringPointId = group.Key,
                LastReceivedAt = new DateTimeOffset(
                    group.Max(version => version.DeliveryDate).ToDateTime(TimeOnly.MinValue),
                    TimeSpan.Zero),
            })
            .ToDictionaryAsync(row => row.MeteringPointId, row => row.LastReceivedAt, ct);
```

Predict: `A_point_that_received_yesterday_is_not_silent` fails with
`result.Raised should be 0 but was 1` — the fixture's version is *for* the day before it arrived, so
under the mutation the point looks two days quiet the moment it is perfectly healthy. And
`Two_cadence_windows_is_the_threshold` fails on its `-47.9` row for the same reason.

⚠ If EF cannot translate that projection, do the mutation in memory instead — a mutation that fails
to compile or to run proves nothing.

Run, confirm, restore.

- [ ] **Step 6: Second mutation — treat "never received anything" as not silent**

Replace the `else` branch of the `isSilent` ternary with `false`.

Predict: `A_point_that_has_never_received_anything_is_silent_after_its_grace` fails with
`result.Raised should be 1 but was 0`, and `A_point_registered_today_is_not_yet_silent` stays green —
which is the asymmetry that makes the pair worth having: a detector that skips points with no
baseline is blind to the worst case and looks perfectly correct on every point that has one.

Run, confirm, restore.

- [ ] **Step 7: Third mutation — give the silence alert a delivery date**

Change `DeliveryDate: null` to `DeliveryDate: today.AddDays(-1)`.

Predict: `A_point_that_last_received_three_days_ago_is_silent_and_the_alert_names_the_BRP` fails on
`alert.DeliveryDate should be null but was 2026-08-19`, and `Sweeping_twice_raises_one_alert` **also**
fails — with a moving delivery date the dedupe key changes every day, so a point silent for a week
accumulates seven rows. Run, confirm both, restore.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~SilenceDetectionJobTests"
git add src/Infrastructure/PeakPower.Ingestion/Jobs/SilenceDetectionJob.cs \
        tests/PeakPower.Integration.Tests/Rollup/SilenceDetectionJobTests.cs
git commit -m "Detect silence per metering point, from receipt time, at two BRP cadence windows

F02-R26 amended by DEC-69: the cadence is a property of the point's BRP, the detector branches on
metering.brp.expected_cadence and on nothing else, and the alert names the BRP that owes the data.

Measured from interval_data_version.received_at rather than from delivery_date. Verified by
mutation: measuring from the delivery date makes a connection that received yesterday's data this
morning look two days quiet, because allocation data for day D legitimately arrives on D+1.

A point that has never received anything is silent after a two-window grace from its validity
start. Dropping that arm leaves every test with a baseline green and blinds the detector to the
worst case, which is why the pair is written both ways.

The silence alert carries no delivery date. Giving it one turns the dedupe key into a moving
target and a point quiet for a week accumulates seven rows."
```

---

### Task 12: `RollupServiceCollectionExtensions` and `IngestionScheduleHost` — the registrations that replace plan 3's stand-ins, and the timer that runs the two jobs

Tasks 6 to 11 built four classes that nothing constructs. Plan 3's `AddPeakPowerIngestion` registers
a **stand-in for each of the two ports** so that plan 3 compiles and runs before this plan exists —
`NoOpDayStateRecomputer` behind `TryAddScoped`, and `DbOperationalAlertRaiser` behind a plain
`AddScoped` (plan 3, `IngestionServiceCollectionExtensions`). Contract §7.6 gives the
**implementation** of both ports to this plan, so both stand-ins have to go.

⚠ **`AddScoped` is not enough here, in either direction.** `TryAddScoped` after plan 3 would lose,
because plan 3's descriptor is already in the collection; a plain `AddScoped` would leave **two**
descriptors live and let `GetRequiredService` pick the last one registered — which makes the choice
depend on the order two `Add*` calls appear in `Program.cs`, in two different files, in two different
plans. `ServiceCollectionDescriptorExtensions.Replace` removes the existing descriptor and appends
this one, so there is exactly one and the order stops mattering. Step 6 mutates it back to
`AddScoped` and the descriptor-count assertion is what goes red.

⚠ **The schedule host is scheduler-agnostic on purpose.** Contract §7.4: whether a Hangfire server or
a `BackgroundService` sits behind `IIngestionJobQueue` is plan 1's decision and nobody else's. The
two jobs here are **not** queue work — they are sweeps over the whole table on a wall-clock interval,
with no message behind them — so they run on their own `PeriodicTimer` on the pattern
`src/Infrastructure/PeakPower.Infrastructure.Email/OutboundMailService.cs:27-38` already establishes
in this repository, and they neither know nor care what plan 1 chose.

⚠ **Architecture fact 5 binds the host.** It takes `TimeProvider` from DI and passes it to
`PeriodicTimer`; it never touches `DateTime.UtcNow`. `MarketCalendar` already takes a `TimeProvider`
the same way (`src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs:20`), so the
registration exists.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Rollup/RollupServiceCollectionExtensions.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Jobs/IngestionScheduleHost.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj` (the `<PackageReference>` group)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/RollupRegistrationTests.cs`

**Interfaces:**
- Consumes: `IDayStateRecomputer`, `IOperationalAlertRaiser` (plan 3's declarations, contract §7.6);
  `DayStateRecomputer` (task 7); `OperationalAlertRaiser` (task 6); `DayFinalisationJob` (task 10);
  `SilenceDetectionJob` (task 11); `PeakPower.Ingestion.IngestionServiceCollectionExtensions.AddPeakPowerIngestion`
  (plan 3); `TimeProvider`.
- Produces:
  - `PeakPower.Ingestion.Rollup.RollupServiceCollectionExtensions.AddIngestionRollup(IServiceCollection)` — `public static IServiceCollection`
  - `.AddIngestionSchedule(IServiceCollection, IngestionScheduleOptions? options = null)` — `public static IServiceCollection`
  - `PeakPower.Ingestion.Jobs.IngestionScheduleOptions` with `TimeSpan Interval` (default one hour) and `bool RunOnStartup` (default `false`)
  - `PeakPower.Ingestion.Jobs.IngestionScheduleHost : BackgroundService`, constructed as
    `new IngestionScheduleHost(IServiceScopeFactory scopes, TimeProvider time, IngestionScheduleOptions options, ILogger<IngestionScheduleHost> logger)`
  - `IngestionScheduleHost.SweepOnceAsync(IServiceScopeFactory scopes, ILogger logger, CancellationToken ct)` — `public static Task<IngestionSweepResult>`
  - `PeakPower.Ingestion.Jobs.IngestionSweepResult(int Finalised, SilenceSweepResult Silence)`

- [ ] **Step 1: Add the hosting package reference `BackgroundService` needs**

`Microsoft.Extensions.Hosting.Abstractions` is pinned at **10.0.11** in `Directory.Packages.props`.
Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj`,
adding to the `<PackageReference>` `ItemGroup`:

```xml
    <!-- Plan 5: IngestionScheduleHost is a BackgroundService. Abstractions only - PeakPower.Ingestion
         is infrastructure and must not pull in a host builder. -->
    <PackageReference Include="Microsoft.Extensions.Hosting.Abstractions" />
```

- [ ] **Step 2: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Rollup/RollupRegistrationTests.cs`:

```csharp
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Ingestion;
using PeakPower.Ingestion.Alerts;
using PeakPower.Ingestion.Jobs;
using PeakPower.Ingestion.Rollup;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Rollup;

/// <summary>
/// Plan 3 registers a stand-in for each of the two ports contract §7.6 gives this plan to implement,
/// so that plan 3 compiles and runs before this plan exists. This class is the proof that both
/// stand-ins are gone once <c>AddIngestionRollup</c> has run — and, more importantly, that the
/// answer does not depend on which of the two <c>Add*</c> calls appears first in a host's
/// <c>Program.cs</c>.
/// <para>
/// <b>The descriptor COUNT is the assertion that matters</b>, not the resolved type. A plain
/// <c>AddScoped</c> leaves two descriptors live and resolves to the last one registered, which is
/// green in one order and red in the other — and the order lives in a file this plan does not own.
/// </para>
/// </summary>
public sealed class RollupRegistrationTests
{
    private static IServiceCollection Base()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(TimeProvider.System);
        return services;
    }

    private static IConfiguration EmptyConfiguration() => new ConfigurationBuilder().Build();

    [Fact]
    public void The_rollup_recomputer_replaces_plan_3_s_no_op()
    {
        var services = Base();
        IngestionServiceCollectionExtensions.AddPeakPowerIngestion(services, EmptyConfiguration());
        RollupServiceCollectionExtensions.AddIngestionRollup(services);

        var descriptors = services
            .Where(descriptor => descriptor.ServiceType == typeof(IDayStateRecomputer))
            .ToArray();

        descriptors.Length.ShouldBe(1);
        descriptors[0].ImplementationType.ShouldBe(typeof(DayStateRecomputer));
        descriptors[0].Lifetime.ShouldBe(ServiceLifetime.Scoped);
    }

    [Fact]
    public void The_alert_raiser_replaces_plan_3_s_stand_in()
    {
        var services = Base();
        IngestionServiceCollectionExtensions.AddPeakPowerIngestion(services, EmptyConfiguration());
        RollupServiceCollectionExtensions.AddIngestionRollup(services);

        var descriptors = services
            .Where(descriptor => descriptor.ServiceType == typeof(IOperationalAlertRaiser))
            .ToArray();

        descriptors.Length.ShouldBe(1);
        descriptors[0].ImplementationType.ShouldBe(typeof(OperationalAlertRaiser));
    }

    /// <summary>
    /// The same two assertions with the calls the other way round. This is the one that would catch
    /// a TryAdd here: TryAdd loses to whatever plan 3 registered first, and wins when it did not,
    /// so a TryAdd implementation passes the two tests above and fails this one.
    /// </summary>
    [Fact]
    public void The_order_of_the_two_Add_calls_does_not_decide_the_answer()
    {
        var services = Base();
        RollupServiceCollectionExtensions.AddIngestionRollup(services);
        IngestionServiceCollectionExtensions.AddPeakPowerIngestion(services, EmptyConfiguration());

        services.Count(descriptor => descriptor.ServiceType == typeof(IDayStateRecomputer))
            .ShouldBe(1);
        services.Count(descriptor => descriptor.ServiceType == typeof(IOperationalAlertRaiser))
            .ShouldBe(1);

        // Resolving needs a PeakPowerDbContext, which this collection has not got, so assert on
        // the descriptor rather than on an instance. The descriptor is what the container will
        // use, and it is the thing that can be wrong.
        services.Single(descriptor => descriptor.ServiceType == typeof(IDayStateRecomputer))
            .ImplementationType.ShouldBe(typeof(DayStateRecomputer));
    }

    [Fact]
    public void Both_sweep_jobs_are_resolvable_as_scoped_services()
    {
        var services = Base();
        RollupServiceCollectionExtensions.AddIngestionRollup(services);

        services.Single(descriptor => descriptor.ServiceType == typeof(DayFinalisationJob))
            .Lifetime.ShouldBe(ServiceLifetime.Scoped);
        services.Single(descriptor => descriptor.ServiceType == typeof(SilenceDetectionJob))
            .Lifetime.ShouldBe(ServiceLifetime.Scoped);
    }

    /// <summary>
    /// The schedule is a SEPARATE call from the rollup. The Worker wants both; a test host, the
    /// Migrator and PeakPower.Api.Employee want the rollup registrations without a timer waking up
    /// mid-assertion and finalising the day a test just arranged.
    /// </summary>
    [Fact]
    public void The_schedule_is_opt_in_and_the_rollup_alone_starts_nothing()
    {
        var withoutSchedule = Base();
        RollupServiceCollectionExtensions.AddIngestionRollup(withoutSchedule);
        withoutSchedule.Any(descriptor => descriptor.ServiceType == typeof(IHostedService))
            .ShouldBeFalse();

        var withSchedule = Base();
        RollupServiceCollectionExtensions.AddIngestionRollup(withSchedule);
        RollupServiceCollectionExtensions.AddIngestionSchedule(withSchedule);
        withSchedule.Count(descriptor =>
                descriptor.ServiceType == typeof(IHostedService)
                && descriptor.ImplementationType == typeof(IngestionScheduleHost))
            .ShouldBe(1);
    }

    [Fact]
    public void The_default_sweep_interval_is_one_hour_and_it_does_not_sweep_on_startup()
    {
        var options = new IngestionScheduleOptions();

        // An hour, because the 10-working-day rule has a resolution of a day and silence has a
        // resolution of a cadence window. A minute would be a hundred sweeps for one state change;
        // a day would mean a redeploy at 09:00 finalises nothing until 09:00 tomorrow.
        options.Interval.ShouldBe(TimeSpan.FromHours(1));

        // False, because a rolling deploy would otherwise run two full-table sweeps concurrently
        // while the old container drains. The first tick is one interval away.
        options.RunOnStartup.ShouldBeFalse();
    }
}
```

- [ ] **Step 3: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~RollupRegistrationTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'RollupServiceCollectionExtensions' could not be found`.

- [ ] **Step 4: Write `IngestionScheduleHost`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Jobs/IngestionScheduleHost.cs`:

```csharp
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace PeakPower.Ingestion.Jobs;

/// <summary>
/// How often the two sweeps run, and whether the first one is immediate.
/// </summary>
/// <remarks>
/// A plain options class rather than <c>IOptions&lt;T&gt;</c>: it is read once, at construction,
/// by one type, and binding it to configuration would invite a deployment to set an interval of
/// seconds against a table that grows by a row per connection per day.
/// </remarks>
public sealed class IngestionScheduleOptions
{
    /// <summary>
    /// One hour. The <c>[F02-R23]</c> rule has a resolution of a working day and
    /// <c>[F02-R26]</c>'s has a resolution of a cadence window, so an hour is already an order of
    /// magnitude finer than either question. A minute would be a hundred full-table sweeps per
    /// state change; a day would mean a redeploy at 09:00 finalises nothing until 09:00 tomorrow.
    /// </summary>
    public TimeSpan Interval { get; set; } = TimeSpan.FromHours(1);

    /// <summary>
    /// <c>false</c>. During a rolling deploy the old container is still draining, and a sweep on
    /// startup would put two full-table passes on the same rows at once — both of them writing
    /// <c>metering_point_day_state</c>. The first tick is one <see cref="Interval"/> away.
    /// </summary>
    public bool RunOnStartup { get; set; }
}

/// <summary>What one sweep did. Returned so a test can assert on it and a log line can name it.</summary>
public sealed record IngestionSweepResult(int Finalised, SilenceSweepResult Silence);

/// <summary>
/// Runs <see cref="DayFinalisationJob"/> and then <see cref="SilenceDetectionJob"/> on a wall-clock
/// interval.
/// </summary>
/// <remarks>
/// <para>
/// <b>Deliberately not on <c>IIngestionJobQueue</c>.</b> Contract §7.4 puts the queue behind a port
/// precisely so plan 1's Hangfire decision is invisible to every other plan — and these two jobs are
/// not queue work in the first place. There is no message behind them: they are sweeps over the
/// whole table on a clock, and a queue that is drained by a claim loop has no schedule to hang them
/// on. A <see cref="BackgroundService"/> on a <see cref="PeriodicTimer"/> is the shape this
/// repository already uses for exactly this
/// (<c>PeakPower.Infrastructure.Email/OutboundMailService.cs</c>), and it survives the spike going
/// either way.
/// </para>
/// <para>
/// <b>A scope per tick, never a captured context.</b> <c>PeakPowerDbContext</c> is scoped and its
/// change tracker is per-unit-of-work; a long-lived service that captured one would accumulate every
/// entity it ever loaded and would still be holding yesterday's day states tomorrow.
/// </para>
/// <para>
/// <b>Order is finalise, then detect silence, and it is not arbitrary.</b> Finalisation moves days
/// to <c>FINAL</c>; silence detection reads <c>interval_data_version.received_at</c> and is
/// unaffected by day state, so either order is correct today — but a finalisation that throws must
/// not swallow the silence sweep with it, which is why each is wrapped separately below.
/// </para>
/// <para>
/// <b>Every failure is caught and logged.</b> An exception escaping <c>ExecuteAsync</c> ends the
/// service for the lifetime of the process, and a Worker that quietly stopped finalising is exactly
/// the silent failure this slice is built to avoid. The alternative — crashing the host — takes the
/// webhook down with it, and a stored payload that can be replayed is worth more than a sweep that
/// runs on time.
/// </para>
/// </remarks>
public sealed class IngestionScheduleHost(
    IServiceScopeFactory scopes,
    TimeProvider time,
    IngestionScheduleOptions options,
    ILogger<IngestionScheduleHost> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (options.RunOnStartup)
        {
            await RunSweepAsync(stoppingToken);
        }

        // PeriodicTimer's TimeProvider overload, so a test drives this with FakeTimeProvider and
        // architecture fact 5 stays satisfied: nothing here reads DateTime.UtcNow.
        using var timer = new PeriodicTimer(options.Interval, time);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await RunSweepAsync(stoppingToken);
        }
    }

    private async Task RunSweepAsync(CancellationToken ct)
    {
        try
        {
            var result = await SweepOnceAsync(scopes, logger, ct);

            logger.LogInformation(
                "Ingestion sweep finalised {Finalised} delivery dates, examined {Examined} metering "
                + "points for silence, raised {Raised} and resolved {Resolved} silence alerts.",
                result.Finalised,
                result.Silence.Examined,
                result.Silence.Raised,
                result.Silence.Resolved);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // The host is stopping. Not a failure, and not worth a log line at warning.
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "An ingestion sweep failed. The next tick will try again; nothing is lost, because "
                + "both jobs recompute from the tables rather than from where the last sweep got to.");
        }
    }

    /// <summary>
    /// One sweep, in its own scope. Public and static so a test can run exactly what the timer runs
    /// without waiting for a tick, and so the <c>devstubs</c> and back-office paths that want a
    /// sweep on demand call the same code rather than a copy of it.
    /// </summary>
    public static async Task<IngestionSweepResult> SweepOnceAsync(
        IServiceScopeFactory scopes, ILogger logger, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(scopes);
        ArgumentNullException.ThrowIfNull(logger);

        await using var scope = scopes.CreateAsyncScope();

        var finalisation = scope.ServiceProvider.GetRequiredService<DayFinalisationJob>();
        var finalised = await finalisation.RunAsync(ct);

        var silence = scope.ServiceProvider.GetRequiredService<SilenceDetectionJob>();
        var silenceResult = await silence.RunAsync(ct);

        return new IngestionSweepResult(finalised, silenceResult);
    }
}
```

- [ ] **Step 5: Write `RollupServiceCollectionExtensions`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Rollup/RollupServiceCollectionExtensions.cs`:

```csharp
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Ingestion.Alerts;
using PeakPower.Ingestion.Jobs;

namespace PeakPower.Ingestion.Rollup;

/// <summary>
/// Binds contract §7.6's two ports to this plan's implementations, and offers the sweep schedule
/// as a separate opt-in.
/// </summary>
/// <remarks>
/// Two entry points rather than one, because the two hosts that need these registrations want
/// different halves. The <b>Worker</b> wants both: it applies documents (so it needs the recomputer
/// and the raiser) and it is the only process that should be sweeping. <b>PeakPower.Api.Employee</b>
/// wants <see cref="AddIngestionRollup"/> alone — contract §3.1 has it composing the ingestion side
/// solely so §10.4's replay can answer with real counts, and a back office that also finalised days
/// on a timer would mean two processes writing <c>metering_point_day_state</c> for no reason.
/// </remarks>
public static class RollupServiceCollectionExtensions
{
    /// <summary>
    /// Replaces plan 3's two stand-ins with the real implementations, and registers the two sweep
    /// jobs.
    /// </summary>
    /// <remarks>
    /// ⚠ <b><see cref="ServiceCollectionDescriptorExtensions.Replace"/>, not <c>Add</c> and not
    /// <c>TryAdd</c>, and the choice is load-bearing.</b> Plan 3's
    /// <c>AddPeakPowerIngestion</c> already puts a descriptor in the collection for both ports —
    /// <c>NoOpDayStateRecomputer</c> behind <c>TryAddScoped</c> and <c>DbOperationalAlertRaiser</c>
    /// behind a plain <c>AddScoped</c>. <c>TryAdd</c> here would silently lose to whichever of them
    /// ran first; a plain <c>Add</c> would leave two descriptors live and let
    /// <c>GetRequiredService</c> resolve the last one registered, so the answer would depend on the
    /// order of two lines in a <c>Program.cs</c> that neither plan owns. <c>Replace</c> removes the
    /// existing descriptor and appends this one: exactly one, whatever the order.
    /// </remarks>
    public static IServiceCollection AddIngestionRollup(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.Replace(ServiceDescriptor.Scoped<IDayStateRecomputer, DayStateRecomputer>());
        services.Replace(ServiceDescriptor.Scoped<IOperationalAlertRaiser, OperationalAlertRaiser>());

        // Scoped, like the DbContext they take. Both are resolved once per sweep from a fresh
        // scope, and both are also resolvable inside an apply transaction's scope.
        services.AddScoped<DayFinalisationJob>();
        services.AddScoped<SilenceDetectionJob>();

        return services;
    }

    /// <summary>
    /// Adds the hosted timer that runs both sweeps. Separate from
    /// <see cref="AddIngestionRollup"/> so a test host, or any process that only wants to apply
    /// documents, does not get a background timer that finalises the day a test just arranged.
    /// </summary>
    public static IServiceCollection AddIngestionSchedule(
        this IServiceCollection services, IngestionScheduleOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddSingleton(options ?? new IngestionScheduleOptions());
        services.AddHostedService<IngestionScheduleHost>();

        return services;
    }
}
```

- [ ] **Step 6: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~RollupRegistrationTests"
```

Expected: PASS — 6 tests.

⚠ If `AddPeakPowerIngestion` throws because the collection has no `PeakPowerDbContext`, it is
reading configuration it was not given. Pass the same empty `IConfiguration` plan 3's own
`IngestionWiringTests` passes; do not add a container here, because the assertion is about
descriptors and not about resolution.

- [ ] **Step 7: MUTATION — register with `AddScoped` and watch the count assertion go red**

The easy mutation is deleting a registration, and it proves nothing: every assertion goes red at
once and the message says "sequence contains no elements". Mutate the thing the assertion is
actually for. In `AddIngestionRollup`, replace both `Replace` calls:

```csharp
        services.AddScoped<IDayStateRecomputer, DayStateRecomputer>();               // MUTATION
        services.AddScoped<IOperationalAlertRaiser, OperationalAlertRaiser>();       // MUTATION
```

Predict: `The_rollup_recomputer_replaces_plan_3_s_no_op` fails with

```
Shouldly.ShouldAssertException : descriptors.Length
    should be
1
    but was
2
```

and `The_alert_raiser_replaces_plan_3_s_stand_in` fails identically — while
`The_order_of_the_two_Add_calls_does_not_decide_the_answer` fails on **its** count assertion, which
is the point: with two descriptors live, one call order resolves plan 5's type and the other
resolves plan 3's, and both look correct from inside a single test.

Run, confirm all three messages, then restore.

- [ ] **Step 8: Second mutation — `TryAdd` instead, and watch only the order test go red**

Replace both `Replace` calls with `TryAddScoped`. Predict: the first two tests **stay green** (they
call `AddPeakPowerIngestion` first, so the `TryAdd` loses… but `NoOpDayStateRecomputer` is what
resolves, so `descriptors[0].ImplementationType.ShouldBe(typeof(DayStateRecomputer))` fails with
`should be DayStateRecomputer but was NoOpDayStateRecomputer` while the **count** stays 1), and
`The_order_of_the_two_Add_calls_does_not_decide_the_answer` **passes**, because in that order the
`TryAdd` wins.

That asymmetry is the whole reason both orders are tested: a `TryAdd` implementation is green in one
of them. Run, confirm which assertion fails in which test, then restore.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~RollupRegistrationTests"
git add src/Infrastructure/PeakPower.Ingestion/Rollup/RollupServiceCollectionExtensions.cs \
        src/Infrastructure/PeakPower.Ingestion/Jobs/IngestionScheduleHost.cs \
        src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj \
        tests/PeakPower.Integration.Tests/Rollup/RollupRegistrationTests.cs
git commit -m "Replace plan 3's two ingestion stand-ins, and sweep on a timer that is not the queue

Shared contract 7.6 gives IDayStateRecomputer and IOperationalAlertRaiser to plan 3 to declare and
to plan 5 to implement, so plan 3 registers a NoOp and a stand-in to keep itself compiling. Both
are removed here with ServiceCollectionDescriptorExtensions.Replace rather than Add or TryAdd:
Add leaves two descriptors live and resolves the last one registered, TryAdd loses to whichever
Add ran first, and either way the answer depends on the order of two lines in a Program.cs that
neither plan owns. Verified by both mutations, and by testing both call orders - a TryAdd
implementation is green in one of them.

The finalisation and silence sweeps run on a PeriodicTimer in a BackgroundService, on the pattern
OutboundMailService already establishes here, and NOT on IIngestionJobQueue: contract 7.4 keeps
plan 1's Hangfire decision invisible to every other plan, and a table sweep on a clock has no
message behind it to enqueue. TimeProvider comes from DI so architecture fact 5 holds and a test
can drive the tick.

AddIngestionSchedule is a separate call from AddIngestionRollup so PeakPower.Api.Employee, which
composes the ingestion side only so the replay endpoint can answer with real counts, does not get
a second process finalising days on a timer."
```

---

### Task 13: `DevStubsOptions` and `DevStubsGate` — where the generator points, and the sentence that lets it fire

Everything from here to the end of this plan is `PeakPower.DevStubs`, design §5 step **8**. Read
contract §13 before the first line: it is short, and both of its warnings decide the shape of every
task below.

⚠ **S2-D4 — the generator emits templated XML *text* and never serialises the parser's model.**
Contract §3.1 enforces it by reference list: `PeakPower.DevStubs` may reference
**`PeakPower.Contracts` only**, plus `Microsoft.Extensions.Http` and `.Hosting`. Not
`PeakPower.Domain` — so there is no `EanCode` here, no `ProductionExpectation` enum, no
`IntervalDirection`; every one of those is a **string** in this project, and that is the point. Not
`PeakPower.Infrastructure.Time` — so the 92/96/100 count is computed again from `TimeZoneInfo` in
task 14, as a deliberate second opinion. Not `PeakPower.Integration.Brp.Pvned`, and not
`PeakPower.Ingestion`.

⚠ **`[F02-R30]`: every document goes over the real webhook.** There is no database code in this
project and no `PeakPower.Persistence` reference to write one with.

⚠ **`CA5394` is not suppressed for `src/`** (Global Constraints above), so this project contains no
`System.Random` and no `Random.Shared`. Every value below is a pure function of its inputs — which is
also what makes the byte-identical-dedupe scenario reproducible across runs.

⚠ **`DevStubsSubject` has two members here and a third that is NOT this plan's.** Contract §13.2
names `LoadTest` and pins its key and phrase, and **plan 8 task 2 adds it**. Adding it here as well
is a duplicate-member compile error. Do not write a count assertion either: plan 8 adds
`There_are_exactly_three_subjects_a_developer_can_confirm`, and a `ShouldBe(2)` written here would go
red the day that lands. The disjointness test below iterates `Enum.GetValues<DevStubsSubject>()`
precisely so it keeps working when the enum grows.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/DevStubsOptions.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/DevStubsGate.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj` (the `<PackageReference>` group, if plan 1 did not add them)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj` (after line 12, the last `<ProjectReference>`)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/DevStubsGateTests.cs`

**Interfaces:**
- Consumes: `Microsoft.Extensions.Configuration.IConfiguration`, `Microsoft.Extensions.Hosting.IHostEnvironment`,
  `Microsoft.Extensions.Logging.ILogger` — the same three `SeedingGate` takes.
- Produces:
  - `PeakPower.DevStubs.DevStubsOptions` with `SectionName = "DevStubs"`, `WebhookBaseUri`,
    `BrpCode`, `CredentialVariable`, `SenderGln`, `ReceiverGln`, `MaxInFlight`
  - `DevStubsOptions.ReadCredential()` — `public string`, throws `InvalidOperationException` when empty
  - `PeakPower.DevStubs.DevStubsSubject { Backfill, Cadence }`
  - `PeakPower.DevStubs.DevStubsVerdict { EnabledByConfiguration, Off, RefusedUnconfirmed }`
  - `PeakPower.DevStubs.DevStubsDecision(DevStubsVerdict Verdict, DevStubsSubject Subject)` with `bool Posts`
  - `PeakPower.DevStubs.DevStubsGate` with `BackfillKey`, `CadenceKey`, `BackfillConfirmation`,
    `CadenceConfirmation`, `KeyFor`, `ConfirmationFor`, `Describe`, `Decide`, `Announce`

- [ ] **Step 1: Add the two references this project's tests need**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj`,
inserting after line 12 (`<ProjectReference Include="../../src/Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj" />`):

```xml
    <!-- Plan 5: PeakPower.DevStubs' pure units - the gate, the day length, the load shape, the XML
         template and the scenario catalogue - are tested here, where contract §3.1's table puts
         anything with no I/O in it. The end-to-end half lives in PeakPower.Integration.Tests. -->
    <ProjectReference Include="../../src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj" />
```

Then check the generator project itself has what it needs. Edit
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj`
and add either of these two if plan 1 did not (both are pinned at **10.0.11**, do not add a version):

```xml
    <PackageReference Include="Microsoft.Extensions.Hosting" />
    <PackageReference Include="Microsoft.Extensions.Http" />
```

⚠ **Do not add a `ProjectReference` to `PeakPower.Domain`, `PeakPower.Ingestion` or
`PeakPower.Integration.Brp.Pvned`.** Contract §3.1's reference table for this project is closed, and
S2-D4 is the whole reason.

- [ ] **Step 2: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/DevStubsGateTests.cs`:

```csharp
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using PeakPower.DevStubs;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.DevStubs;

/// <summary>
/// The confirmation-phrase gate, on the pattern <c>PeakPower.Migrator.SeedingGate</c> establishes.
/// <para>
/// <b>DevStubs cannot reuse <c>SeedingGate</c> itself</b> — it lives in another host, and a host may
/// not reference another host (contract §13.2, §16 item 8). What it reuses is the argument: the key
/// is not a boolean, it carries an ordinary English sentence that says what it does, and
/// <c>true</c>, <c>1</c>, <c>yes</c> and the OTHER subject's phrase all leave it off and are refused
/// audibly.
/// </para>
/// </summary>
public sealed class DevStubsGateTests
{
    private static IConfiguration ConfigurationWith(string key, string? value) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [key] = value })
            .Build();

    private static IHostEnvironment Environment(string name)
    {
        var environment = Substitute.For<IHostEnvironment>();
        environment.EnvironmentName.Returns(name);
        return environment;
    }

    [Fact]
    public void The_two_keys_are_the_ones_the_contract_pins()
    {
        DevStubsGate.KeyFor(DevStubsSubject.Backfill).ShouldBe("DevStubs:Backfill");
        DevStubsGate.KeyFor(DevStubsSubject.Cadence).ShouldBe("DevStubs:Cadence");
    }

    [Fact]
    public void The_two_phrases_are_the_ones_the_contract_pins_character_for_character()
    {
        DevStubsGate.ConfirmationFor(DevStubsSubject.Backfill)
            .ShouldBe("yes, post ninety days of generated documents to this webhook");
        DevStubsGate.ConfirmationFor(DevStubsSubject.Cadence)
            .ShouldBe("yes, keep posting generated documents on the cadence");
    }

    [Fact]
    public void The_confirmation_phrase_turns_the_subject_on()
    {
        var decision = DevStubsGate.Decide(
            DevStubsSubject.Backfill,
            Environment("Development"),
            ConfigurationWith("DevStubs:Backfill", DevStubsGate.BackfillConfirmation));

        decision.Verdict.ShouldBe(DevStubsVerdict.EnabledByConfiguration);
        decision.Posts.ShouldBeTrue();
    }

    /// <summary>
    /// ⚠ The one place this gate deliberately differs from <c>SeedingGate</c>: there is <b>no
    /// Development short-circuit</b>. <c>SeedingGate</c> has one because <c>./dev-up</c> has always
    /// seeded and taking that away would break every developer's loop. This program posts documents
    /// at a URL the operator supplies, and on a developer's machine that URL is as likely to be the
    /// deployed box as localhost — <c>PeakPower.DevStubs</c> does not ship in the compose file and
    /// is run from a developer machine against the deployed webhook (design §3.1). An environment
    /// name is not evidence about which webhook is on the other end of that URI.
    /// </summary>
    [Fact]
    public void Development_does_not_turn_it_on_by_itself()
    {
        var decision = DevStubsGate.Decide(
            DevStubsSubject.Backfill,
            Environment("Development"),
            new ConfigurationBuilder().Build());

        decision.Verdict.ShouldBe(DevStubsVerdict.Off);
        decision.Posts.ShouldBeFalse();
    }

    [Theory]
    [InlineData("true")]
    [InlineData("1")]
    [InlineData("yes")]
    [InlineData("enabled")]
    [InlineData("yes, post ninety days of generated documents to this webhook.")]
    [InlineData("Yes, post ninety days of generated documents to this webhook")]
    public void A_near_miss_is_refused_audibly_rather_than_ignored(string configured)
    {
        var decision = DevStubsGate.Decide(
            DevStubsSubject.Backfill,
            Environment("Production"),
            ConfigurationWith("DevStubs:Backfill", configured));

        // RefusedUnconfirmed and not Off: the operator plainly meant to turn it on, and silence
        // here is a run that posts nothing and a person who has no idea why.
        decision.Verdict.ShouldBe(DevStubsVerdict.RefusedUnconfirmed);
        decision.Posts.ShouldBeFalse();
    }

    [Fact]
    public void The_other_subject_s_phrase_is_refused()
    {
        var decision = DevStubsGate.Decide(
            DevStubsSubject.Cadence,
            Environment("Production"),
            ConfigurationWith("DevStubs:Cadence", DevStubsGate.BackfillConfirmation));

        decision.Verdict.ShouldBe(DevStubsVerdict.RefusedUnconfirmed);
    }

    /// <summary>
    /// Trimmed, because the leading and trailing whitespace a YAML block or a shell heredoc adds is
    /// not something an operator chose — but compared ORDINALLY, because the letters and their case
    /// are. This is <c>SeedingGate</c>'s rule, restated so the two gates cannot drift.
    /// </summary>
    [Fact]
    public void Surrounding_whitespace_is_forgiven_and_nothing_else_is()
    {
        var decision = DevStubsGate.Decide(
            DevStubsSubject.Cadence,
            Environment("Production"),
            ConfigurationWith("DevStubs:Cadence", $"  {DevStubsGate.CadenceConfirmation}\n"));

        decision.Verdict.ShouldBe(DevStubsVerdict.EnabledByConfiguration);
    }

    /// <summary>
    /// Iterated over the enum rather than written as literals, so it keeps its meaning when plan 8
    /// adds <c>DevStubsSubject.LoadTest</c>. ⚠ Do NOT pin the member count here — plan 8 owns that
    /// assertion, and a <c>ShouldBe(2)</c> written here goes red the day the third subject lands.
    /// </summary>
    [Fact]
    public void Every_subject_has_a_key_and_a_phrase_and_they_are_all_distinct()
    {
        var subjects = Enum.GetValues<DevStubsSubject>();

        var keys = subjects.Select(DevStubsGate.KeyFor).ToArray();
        var phrases = subjects.Select(DevStubsGate.ConfirmationFor).ToArray();

        keys.Distinct(StringComparer.Ordinal).Count().ShouldBe(subjects.Length);
        phrases.Distinct(StringComparer.Ordinal).Count().ShouldBe(subjects.Length);

        foreach (var key in keys)
        {
            key.StartsWith("DevStubs:", StringComparison.Ordinal).ShouldBeTrue();
        }

        foreach (var phrase in phrases)
        {
            phrase.StartsWith("yes, ", StringComparison.Ordinal).ShouldBeTrue();
            phrase.Trim().ShouldBe(phrase);
        }
    }

    /// <summary>
    /// Contract §13.2's disjointness rule, across BOTH gates. The two <c>SeedingGate</c> strings are
    /// duplicated as literals rather than referenced because <c>PeakPower.DevStubs</c> cannot see
    /// <c>PeakPower.Migrator</c> — a test project can see both, and this is the one place that is
    /// worth using.
    /// <para>
    /// ⚠ Plan 8 appends a wider version of this test that also covers the load-test phrase. This one
    /// stays: it is what makes the property true for the two phrases this task adds, on the day it
    /// adds them, rather than three plans later.
    /// </para>
    /// </summary>
    [Fact]
    public void No_confirmation_phrase_contains_any_other()
    {
        string[] phrases =
        [
            "yes, seed demo companies with a published password",   // SeedingGate.DemoCompanies
            "yes, seed the named staff accounts",                   // SeedingGate.StaffAccounts
            .. Enum.GetValues<DevStubsSubject>().Select(DevStubsGate.ConfirmationFor),
        ];

        foreach (var one in phrases)
        {
            foreach (var other in phrases)
            {
                if (string.Equals(one, other, StringComparison.Ordinal))
                {
                    continue;
                }

                one.Contains(other, StringComparison.Ordinal).ShouldBeFalse(
                    $"'{one}' contains '{other}', so an operator who pasted the second into the "
                    + "first's key would be granted rather than refused");
            }
        }
    }

    [Fact]
    public void An_unknown_subject_throws_rather_than_resolving_to_a_key()
    {
        // A gate whose unknown subject resolves to SOME key is a gate that can be turned on by a
        // typo. Plan 8's third-subject test depends on this throwing.
        Should.Throw<ArgumentOutOfRangeException>(
            () => DevStubsGate.KeyFor((DevStubsSubject)97));
        Should.Throw<ArgumentOutOfRangeException>(
            () => DevStubsGate.ConfirmationFor((DevStubsSubject)97));
    }

    [Fact]
    public void The_options_default_to_the_local_worker_and_the_seeded_brp_row()
    {
        var options = new DevStubsOptions();

        options.BrpCode.ShouldBe("PVNED");
        // The NAME of an environment variable, never a secret - the same convention
        // metering.brp.credential_ref carries (contract §9.3).
        options.CredentialVariable.ShouldBe("BRP_CREDENTIAL_PVNED");
        options.SenderGln.ShouldBe("8714252005776");
        options.ReceiverGln.ShouldBe("8712423456789");
    }

    [Fact]
    public void An_absent_credential_fails_loudly_before_a_single_document_is_posted()
    {
        var options = new DevStubsOptions
        {
            CredentialVariable = "PP_DEVSTUBS_TEST_CREDENTIAL_THAT_IS_NOT_SET",
        };

        var thrown = Should.Throw<InvalidOperationException>(options.ReadCredential);

        // Fail closed and say which variable, because contract §9.3 makes an empty credential a
        // 401 on EVERY request - and a backfill that discovers this on document one of nine
        // hundred and ninety is nine hundred and ninety 401s in a log.
        // ⚠ Shouldly's ShouldContain is case-insensitive by default (contract §15) and has broken
        // three tests in this repository. Compare ordinally, explicitly.
        thrown.Message
            .Contains("PP_DEVSTUBS_TEST_CREDENTIAL_THAT_IS_NOT_SET", StringComparison.Ordinal)
            .ShouldBeTrue();
    }
}
```

- [ ] **Step 3: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~DevStubsGateTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'DevStubsGate' could not be found (are you missing a using directive or an assembly reference?)`.

⚠ If it instead fails with `error CS0234: The type or namespace name 'DevStubs' does not exist in
the namespace 'PeakPower'`, step 1's `ProjectReference` did not land.

- [ ] **Step 4: Write `DevStubsOptions`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/DevStubsOptions.cs`:

```csharp
namespace PeakPower.DevStubs;

/// <summary>
/// Where the generator posts, as whom, and with which credential.
/// </summary>
/// <remarks>
/// <para>
/// Bound from configuration section <c>DevStubs</c>, which as environment variables is
/// <c>DevStubs__WebhookBaseUri</c> and friends. Defaults point at a locally-running Worker, so a
/// developer with <c>./dev-up</c> up needs only the credential.
/// </para>
/// <para>
/// ⚠ <b><see cref="CredentialVariable"/> holds the NAME of an environment variable, never a
/// secret</b> — deliberately the same convention <c>metering.brp.credential_ref</c> carries
/// (contract §9.3), so the two sides of the webhook name the credential the same way and a reader
/// comparing them is comparing like with like.
/// </para>
/// </remarks>
public sealed class DevStubsOptions
{
    /// <summary>The configuration section: <c>DevStubs__*</c> as environment variables.</summary>
    public const string SectionName = "DevStubs";

    /// <summary>
    /// The Worker's base address. The route itself is contract §9.1's
    /// <c>POST /webhooks/brp/{brpCode}</c> and is built from <see cref="BrpCode"/>, so this carries
    /// no path.
    /// </summary>
    public Uri WebhookBaseUri { get; set; } = new("http://localhost:5300");

    /// <summary>
    /// <c>metering.brp.code</c>, uppercase. The seeded row is <c>PVNED</c>, so the route is
    /// <c>POST /webhooks/brp/PVNED</c> — which design §7.2 names exactly.
    /// </summary>
    public string BrpCode { get; set; } = "PVNED";

    /// <summary>
    /// The name of the environment variable holding the shared secret, matching the seeded row's
    /// <c>credential_ref</c>. Not the secret.
    /// </summary>
    public string CredentialVariable { get; set; } = "BRP_CREDENTIAL_PVNED";

    /// <summary>PVNed's GLN, integration-spec §6. Matches <c>PvnedAdapterOptions.SenderGln</c>.</summary>
    public string SenderGln { get; set; } = "8714252005776";

    /// <summary>PeakPower's own GLN, integration-spec §6. Matches <c>PvnedAdapterOptions.ReceiverGln</c>.</summary>
    public string ReceiverGln { get; set; } = "8712423456789";

    /// <summary>
    /// How many documents are in flight at once. Four rather than one because ninety days across
    /// eleven connections is nine hundred and ninety serial round trips; four rather than forty
    /// because the receipt path takes a transaction-scoped advisory lock per (metering point,
    /// delivery date) and a flood is a queue with extra steps.
    /// </summary>
    public int MaxInFlight { get; set; } = 4;

    /// <summary>
    /// The shared secret, read from the environment variable <see cref="CredentialVariable"/> names.
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// The variable is absent or empty. ⚠ <b>Fail closed and fail early.</b> Contract §9.3: an empty
    /// credential means the Worker answers <b>401 to every request</b> on that BRP's route — it must
    /// never mean "no credential required". A backfill that found this out on the first of nine
    /// hundred and ninety posts would produce nine hundred and ninety 401s and one confused reader,
    /// so it is read once, before anything is posted.
    /// </exception>
    public string ReadCredential()
    {
        var value = Environment.GetEnvironmentVariable(CredentialVariable);

        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException(
                $"The environment variable {CredentialVariable} is not set, so every request to "
                + $"/webhooks/brp/{BrpCode} would be answered 401. Set it to the same value the "
                + "Worker has, which deploy/env.example names BRP_CREDENTIAL_PVNED.");
        }

        return value;
    }
}
```

- [ ] **Step 5: Write `DevStubsGate`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/DevStubsGate.cs`:

```csharp
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace PeakPower.DevStubs;

/// <summary>
/// The things this program can be asked to do that post a large number of documents at a webhook,
/// and which are decided <b>separately</b>.
/// </summary>
/// <remarks>
/// ⚠ <b>Plan 8 appends a third member, <c>LoadTest</c>, with the key and phrase contract §13.2
/// pins.</b> Append, never insert, so the two below keep their ordinal values.
/// </remarks>
public enum DevStubsSubject
{
    /// <summary>
    /// Ninety days of documents across the eleven seeded connections — nine hundred and ninety
    /// posts, at least, and more where a connection produces.
    /// </summary>
    Backfill,

    /// <summary>
    /// The cadence pusher: one document per EAN per day <c>[DEC-38]</c>, on a loop, until it is
    /// stopped. Unbounded by construction, which is why it has its own phrase.
    /// </summary>
    Cadence,
}

/// <summary>Why <see cref="DevStubsGate"/> reached the answer it did.</summary>
public enum DevStubsVerdict
{
    /// <summary>This subject's own key carries its confirmation phrase. It runs, and says so.</summary>
    EnabledByConfiguration,

    /// <summary>Nothing asked for it. The ordinary state, and the state a mistyped verb lands in.</summary>
    Off,

    /// <summary>
    /// The key is set to something that is not this subject's confirmation phrase — <c>true</c>,
    /// most likely, or another subject's phrase. It does <b>not</b> run, and this is its own verdict
    /// rather than folded into <see cref="Off"/> because the operator plainly meant to turn it on:
    /// silence here is a run that posts nothing and a person who has no idea why.
    /// </summary>
    RefusedUnconfirmed,
}

/// <summary>The gate's answer for one subject, and enough of the question to log it.</summary>
public readonly record struct DevStubsDecision(DevStubsVerdict Verdict, DevStubsSubject Subject)
{
    /// <summary>
    /// Whether this subject posts. Derived from <see cref="Verdict"/> rather than carried beside it:
    /// two fields that can disagree are two fields that eventually do.
    /// </summary>
    public bool Posts => Verdict is DevStubsVerdict.EnabledByConfiguration;
}

/// <summary>
/// Decides whether <c>PeakPower.DevStubs</c> may post a large number of generated documents at a
/// webhook, on the confirmation-phrase pattern <c>PeakPower.Migrator.SeedingGate</c> establishes.
/// <para>
/// <b>Why this is a second gate rather than a reuse.</b> <c>SeedingGate</c> lives in
/// <c>PeakPower.Migrator</c>, and a host may not reference another host (contract §3.1). Reuse is
/// not available, so this type takes the same shape deliberately — the same three arguments, the
/// same trim-then-ordinal comparison, the same audible refusal — and contract §13.2 makes the
/// disjointness of all five phrases across <b>both</b> gates a normative property with a test behind
/// it.
/// </para>
/// <para>
/// <b>There is no Development short-circuit, and its absence is the one deliberate difference.</b>
/// <c>SeedingGate</c> short-circuits on <c>IsDevelopment()</c> because <c>./dev-up</c> has always
/// seeded and taking that away would break every developer's loop. This program takes a webhook URI
/// as configuration and <b>does not ship in the compose file</b> — design §3.1 has it run from a
/// developer machine against the <b>deployed</b> webhook. So the environment name says nothing about
/// what is on the other end of <see cref="DevStubsOptions.WebhookBaseUri"/>, and a
/// Development-shaped short-circuit would be an opt-out from the very case the gate exists for.
/// </para>
/// </summary>
public static class DevStubsGate
{
    /// <summary>The backfill's configuration key: <c>DevStubs__Backfill</c> as an environment variable.</summary>
    public const string BackfillKey = "DevStubs:Backfill";

    /// <summary>The cadence pusher's key: <c>DevStubs__Cadence</c> as an environment variable.</summary>
    public const string CadenceKey = "DevStubs:Cadence";

    /// <summary>
    /// What <see cref="BackfillKey"/> must contain, verbatim.
    /// </summary>
    /// <remarks>
    /// Compared ordinally after trimming: the whitespace a YAML block or a shell heredoc adds is not
    /// something an operator chose, but the letters and their case are. It names the SIZE and the
    /// destination on purpose — ninety days, this webhook — so an operator who pastes this sentence
    /// somewhere has read what it does. Contract §13.2 pins it character for character; no plan may
    /// respell it.
    /// </remarks>
    public const string BackfillConfirmation =
        "yes, post ninety days of generated documents to this webhook";

    /// <summary>
    /// What <see cref="CadenceKey"/> must contain, verbatim. Deliberately not a substring or a
    /// prefix of <see cref="BackfillConfirmation"/>, nor of either <c>SeedingGate</c> phrase: an
    /// operator who copies one key's value into another gets a refusal that names the phrase that
    /// would have worked. Contract §13.2 makes that property normative across both gates.
    /// </summary>
    public const string CadenceConfirmation =
        "yes, keep posting generated documents on the cadence";

    /// <summary>The configuration key this subject is turned on by.</summary>
    public static string KeyFor(DevStubsSubject subject) => subject switch
    {
        DevStubsSubject.Backfill => BackfillKey,
        DevStubsSubject.Cadence => CadenceKey,
        _ => throw new ArgumentOutOfRangeException(nameof(subject)),
    };

    /// <summary>The phrase <see cref="KeyFor"/> must carry, verbatim.</summary>
    public static string ConfirmationFor(DevStubsSubject subject) => subject switch
    {
        DevStubsSubject.Backfill => BackfillConfirmation,
        DevStubsSubject.Cadence => CadenceConfirmation,
        _ => throw new ArgumentOutOfRangeException(nameof(subject)),
    };

    /// <summary>
    /// What this subject actually does, in the words the announcement uses. "The gate was open" does
    /// not tell somebody reading a log a week later what landed in the database on the other side of
    /// that webhook.
    /// </summary>
    public static string Describe(DevStubsSubject subject) => subject switch
    {
        DevStubsSubject.Backfill =>
            "ninety delivery dates of generated PVNed documents for each of the eleven seeded "
            + "connections, posted over the real webhook",
        DevStubsSubject.Cadence =>
            "one generated PVNed document per seeded connection per delivery date, on a loop that "
            + "does not stop by itself",
        _ => throw new ArgumentOutOfRangeException(nameof(subject)),
    };

    /// <summary>
    /// Take the decision for one subject. Reads exactly one configuration key, and has no side
    /// effect — <see cref="Announce"/> is what says it out loud, so a caller cannot accidentally
    /// decide twice while logging once.
    /// </summary>
    /// <param name="environment">
    /// Carried so the announcement can name it, and for no other purpose. See the class remarks:
    /// unlike <c>SeedingGate</c>, this gate does <b>not</b> short-circuit on Development.
    /// </param>
    public static DevStubsDecision Decide(
        DevStubsSubject subject, IHostEnvironment environment, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(environment);
        ArgumentNullException.ThrowIfNull(configuration);

        var configured = configuration[KeyFor(subject)];

        if (string.IsNullOrWhiteSpace(configured))
        {
            return new DevStubsDecision(DevStubsVerdict.Off, subject);
        }

        return string.Equals(configured.Trim(), ConfirmationFor(subject), StringComparison.Ordinal)
            ? new DevStubsDecision(DevStubsVerdict.EnabledByConfiguration, subject)
            : new DevStubsDecision(DevStubsVerdict.RefusedUnconfirmed, subject);
    }

    /// <summary>Say one subject's decision out loud, once, before anything is posted.</summary>
    public static void Announce(DevStubsDecision decision, DevStubsOptions options, ILogger logger)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(logger);

        var key = KeyFor(decision.Subject);
        var what = Describe(decision.Subject);

        switch (decision.Verdict)
        {
            case DevStubsVerdict.EnabledByConfiguration:
                logger.LogWarning(
                    "POSTING IS ON BECAUSE THE CONFIGURATION KEY {Key} CARRIES ITS CONFIRMATION "
                    + "PHRASE. About to send {What} to {Webhook}. If that is not the webhook you "
                    + "meant, stop now: every document lands in whatever database is behind it.",
                    key, what, options.WebhookBaseUri);
                break;

            case DevStubsVerdict.RefusedUnconfirmed:
                logger.LogWarning(
                    "The configuration key {Key} is set to something that is not its confirmation "
                    + "phrase, so NOTHING will be posted - this run will not send {What}. That key "
                    + "is not a boolean, and it does not accept another subject's phrase either. To "
                    + "turn it on, set it to exactly: {Confirmation}",
                    key, what, ConfirmationFor(decision.Subject));
                break;

            default:
                logger.LogInformation(
                    "Not posting {What}. {Key} is not set. To turn it on, set it to exactly: "
                    + "{Confirmation}",
                    what, key, ConfirmationFor(decision.Subject));
                break;
        }
    }
}
```

- [ ] **Step 6: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~DevStubsGateTests"
```

Expected: PASS — 17 test cases (the six-row theory expands).

- [ ] **Step 7: MUTATION — make the comparison a containment check and watch the near-miss row go red**

The assertion this task exists for is not "the phrase works"; it is "**a phrase that is nearly right
is refused**". Break exactly that. In `Decide`, replace the comparison:

```csharp
        return configured.Trim().Contains(ConfirmationFor(subject), StringComparison.OrdinalIgnoreCase)
            ? new DevStubsDecision(DevStubsVerdict.EnabledByConfiguration, subject)   // MUTATION
            : new DevStubsDecision(DevStubsVerdict.RefusedUnconfirmed, subject);
```

Predict: `A_near_miss_is_refused_audibly_rather_than_ignored` fails on **two** of its six rows —
the trailing full stop and the capitalised `Yes` — with

```
decision.Verdict
    should be
DevStubsVerdict.RefusedUnconfirmed
    but was
DevStubsVerdict.EnabledByConfiguration
```

and the four boolean rows stay green, which is the asymmetry worth seeing: a containment check
refuses `true` perfectly well and still turns the gate on for a sentence nobody typed.

Run, confirm both failing rows, then restore.

- [ ] **Step 8: Second mutation — let the unknown subject resolve to a key**

Replace both `_ => throw new ArgumentOutOfRangeException(nameof(subject))` arms with
`_ => BackfillKey` and `_ => BackfillConfirmation`.

Predict: `An_unknown_subject_throws_rather_than_resolving_to_a_key` fails with
`Should.Throw<ArgumentOutOfRangeException> ... but no exception was thrown`.

⚠ This is the arm **plan 8 task 2's step 2 depends on**: its first red expects
`System.ArgumentOutOfRangeException` from `KeyFor((DevStubsSubject)…)` before the third member
exists. A defaulting `switch` would give plan 8 a green test for a subject that does not exist.

Run, confirm, restore.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~DevStubsGateTests"
git add src/Hosts/PeakPower.DevStubs/DevStubsOptions.cs \
        src/Hosts/PeakPower.DevStubs/DevStubsGate.cs \
        src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj \
        tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj \
        tests/PeakPower.Application.Tests/DevStubs/DevStubsGateTests.cs
git commit -m "Gate the generator behind a sentence, not a boolean

Contract 13.2. DevStubs cannot reuse PeakPower.Migrator.SeedingGate - a host may not reference
another host - so it declares its own gate on the same pattern, with the two keys and the two
phrases the contract pins character for character. Plan 8 appends the third subject.

One deliberate difference from SeedingGate: no Development short-circuit. SeedingGate has one
because dev-up has always seeded. This program does not ship in the compose file and is run from
a developer machine against the DEPLOYED webhook, so an environment name says nothing about what
is on the other end of the URI it was handed.

Verified by mutation: turning the ordinal comparison into a case-insensitive containment check
leaves the four boolean rows refused and quietly accepts a capitalised phrase and one with a
trailing full stop - which is the failure a confirmation phrase exists to prevent. And a KeyFor
that defaults instead of throwing is a gate a typo can open, which plan 8's first red depends on.

DevStubsOptions.CredentialVariable holds the NAME of an environment variable, never a secret -
the same convention metering.brp.credential_ref carries - and reading it fails closed and early,
because contract 9.3 makes an empty credential a 401 on every request rather than an open door."
```

---

### Task 14: `AmsterdamDay` — the generator's own 92/96/100, computed a second time on purpose

Contract §3.1 forbids `PeakPower.DevStubs` from referencing `PeakPower.Infrastructure.Time`, so it
cannot call `IMarketCalendar.ExpectedIntervalCount`. **That is the design, not an inconvenience.**

⚠ **This is S2-D4 applied to arithmetic.** Design §8's first risk row: the generator and the parser
share an author and a source document, so a shared misreading passes every test in the slice. If the
generator asked the calendar how many intervals a day has, a calendar that answered 96 on the autumn
Sunday would produce a 96-point document for a 100-point date and the pipeline would accept it
happily — the two halves would agree, and the agreement would prove nothing. Computing it again from
`TimeZoneInfo`, in a project that cannot see the calendar, is what makes design §7.10's
"a 96-point document is **rejected** for both dates" a real assertion rather than a tautology.

⚠ **Not an add-15-minutes loop either.** The count is the **length of the local day in minutes**,
taken as the difference between two UTC instants, so the DST arithmetic is the platform's rather than
this file's. Midnight local is never ambiguous and never invalid in Amsterdam — both transitions
happen at 02:00 and 03:00 local — so `GetUtcOffset` on the local midnight is safe, which is exactly
the reason the day boundary and not the interval boundary is the thing being converted.

⚠ **`TimeZoneInfo.FindSystemTimeZoneById("Europe/Amsterdam")` and not `"W. Europe Standard Time"`.**
.NET 6 and later resolves IANA ids on Windows too, and the IANA id is what the rest of this
repository uses.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/AmsterdamDay.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/AmsterdamDayTests.cs`

**Interfaces:**
- Consumes: `System.TimeZoneInfo` only. No project reference, no clock — every method takes the date
  it is asked about.
- Produces:
  - `PeakPower.DevStubs.AmsterdamDay.Zone` — `public static TimeZoneInfo`
  - `AmsterdamDay.IntervalCount(DateOnly date)` — `public static int`, 92 | 96 | 100
  - `AmsterdamDay.StartUtc(DateOnly date)` — `public static DateTimeOffset`, local midnight
  - `AmsterdamDay.EndUtc(DateOnly date)` — `public static DateTimeOffset`, the next local midnight
  - `AmsterdamDay.ToPvnedInstant(DateTimeOffset instant)` — `public static string`, `yyyy-MM-ddTHH:mm:ssZ`

⚠ **`IntervalCount` is the member plan 8 task 3's pinned surface names.** Its signature is frozen
there; do not add a parameter to it.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/AmsterdamDayTests.cs`:

```csharp
using PeakPower.DevStubs;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.DevStubs;

/// <summary>
/// The generator's own day length, and the six DST transitions across three years that design §8
/// asks for by name.
/// <para>
/// <b>This deliberately does not call <c>IMarketCalendar</c>.</b> Contract §3.1 keeps
/// <c>PeakPower.Infrastructure.Time</c> out of <c>PeakPower.DevStubs</c>' reference list precisely so
/// this number is computed twice, from two sources, by code that cannot see the other answer. A
/// generator that asked the parser how long a day is could not disagree with it, and design §7.10's
/// "a 96-point document is rejected for both dates" would be a tautology.
/// </para>
/// </summary>
public sealed class AmsterdamDayTests
{
    /// <summary>
    /// Six transitions, three years. The spring dates are the last Sunday in March and the autumn
    /// dates the last Sunday in October, both hand-checked against a calendar rather than computed
    /// by the rule under test.
    /// </summary>
    [Theory]
    [InlineData(2025, 3, 30, 92)]
    [InlineData(2025, 10, 26, 100)]
    [InlineData(2026, 3, 29, 92)]
    [InlineData(2026, 10, 25, 100)]
    [InlineData(2027, 3, 28, 92)]
    [InlineData(2027, 10, 31, 100)]
    public void The_six_transitions_across_three_years(int year, int month, int day, int expected)
    {
        AmsterdamDay.IntervalCount(new DateOnly(year, month, day)).ShouldBe(expected);
    }

    /// <summary>
    /// The days on either side of every transition are ordinary. This is the assertion that catches
    /// an off-by-one in "which Sunday": a rule that fires a day early is green on the six rows above
    /// only if it also makes one of these twelve wrong.
    /// </summary>
    [Theory]
    [InlineData(2025, 3, 29)]
    [InlineData(2025, 3, 31)]
    [InlineData(2025, 10, 25)]
    [InlineData(2025, 10, 27)]
    [InlineData(2026, 3, 28)]
    [InlineData(2026, 3, 30)]
    [InlineData(2026, 10, 24)]
    [InlineData(2026, 10, 26)]
    [InlineData(2027, 3, 27)]
    [InlineData(2027, 3, 29)]
    [InlineData(2027, 10, 30)]
    [InlineData(2027, 11, 1)]
    public void The_day_on_either_side_of_every_transition_is_ninety_six(int year, int month, int day)
    {
        AmsterdamDay.IntervalCount(new DateOnly(year, month, day)).ShouldBe(96);
    }

    [Theory]
    [InlineData(2026, 1, 15)]
    [InlineData(2026, 6, 21)]
    [InlineData(2026, 12, 25)]   // A holiday is an ordinary metering day. S2-D8, and DEC-14's
    [InlineData(2026, 4, 27)]    // exclusion list is empty - King's Day is 96 intervals like any other.
    public void An_ordinary_day_is_ninety_six(int year, int month, int day)
    {
        AmsterdamDay.IntervalCount(new DateOnly(year, month, day)).ShouldBe(96);
    }

    /// <summary>
    /// Every day of three whole years, so a rule that is right on the twenty-two dates above and
    /// wrong on some other Sunday cannot hide. Exactly six 92s, six 100s, and everything else 96.
    /// </summary>
    [Fact]
    public void Across_three_years_there_are_exactly_six_short_days_and_six_long_ones()
    {
        var counts = new Dictionary<int, int>();

        for (var date = new DateOnly(2025, 1, 1); date <= new DateOnly(2027, 12, 31); date = date.AddDays(1))
        {
            var count = AmsterdamDay.IntervalCount(date);
            counts[count] = counts.TryGetValue(count, out var seen) ? seen + 1 : 1;
        }

        counts.Keys.Order().ShouldBe([92, 96, 100]);
        counts[92].ShouldBe(3);
        counts[100].ShouldBe(3);
        counts[96].ShouldBe(1095 - 6);   // 3 x 365, none of these years is a leap year
    }

    /// <summary>
    /// The two instants the document's MeasurementPeriode carries. On the autumn day they are
    /// twenty-five hours apart and on the spring day twenty-three, which is the same fact
    /// <see cref="AmsterdamDay.IntervalCount"/> reports and the reason it is derived from these
    /// rather than from a table of dates.
    /// </summary>
    [Theory]
    [InlineData(2026, 3, 29, 23)]
    [InlineData(2026, 10, 25, 25)]
    [InlineData(2026, 6, 21, 24)]
    public void The_day_boundaries_are_the_local_midnights(int year, int month, int day, int hours)
    {
        var date = new DateOnly(year, month, day);

        (AmsterdamDay.EndUtc(date) - AmsterdamDay.StartUtc(date)).ShouldBe(TimeSpan.FromHours(hours));
    }

    /// <summary>
    /// Midnight local on 21 June 2026 is 22:00Z on the 20th (CEST, +02:00). Hand-computed, and the
    /// assertion that catches a StartUtc built by pretending local midnight is midnight UTC.
    /// </summary>
    [Fact]
    public void Local_midnight_is_not_midnight_utc()
    {
        AmsterdamDay.StartUtc(new DateOnly(2026, 6, 21))
            .ShouldBe(new DateTimeOffset(2026, 6, 20, 22, 0, 0, TimeSpan.Zero));

        // And in winter, +01:00: integration-spec §5's own worked example is 2024-12-27T23:00:00Z
        // being midnight on 2024-12-28 local.
        AmsterdamDay.StartUtc(new DateOnly(2024, 12, 28))
            .ShouldBe(new DateTimeOffset(2024, 12, 27, 23, 0, 0, TimeSpan.Zero));
    }

    [Fact]
    public void The_wire_format_is_the_sample_document_s()
    {
        // Integration-spec §6 writes them exactly this way: seconds, a Z, and no fractional part.
        AmsterdamDay.ToPvnedInstant(new DateTimeOffset(2024, 12, 27, 23, 0, 0, TimeSpan.Zero))
            .ShouldBe("2024-12-27T23:00:00Z");

        // Given an offset instant, it converts rather than truncating.
        AmsterdamDay.ToPvnedInstant(new DateTimeOffset(2026, 6, 21, 0, 0, 0, TimeSpan.FromHours(2)))
            .ShouldBe("2026-06-20T22:00:00Z");
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~AmsterdamDayTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'AmsterdamDay' could not be found`.

- [ ] **Step 3: Write `AmsterdamDay`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/AmsterdamDay.cs`:

```csharp
using System.Globalization;

namespace PeakPower.DevStubs;

/// <summary>
/// How long an Amsterdam metering day is, computed by this project from
/// <see cref="TimeZoneInfo"/> alone.
/// </summary>
/// <remarks>
/// <para>
/// ⚠ <b>A deliberate SECOND opinion, and never <c>IMarketCalendar</c>.</b>
/// <c>PeakPower.DevStubs</c> may not reference <c>PeakPower.Infrastructure.Time</c> (contract §3.1),
/// and S2-D4 is why: the generator and the parser share an author and a source document, so a
/// generator that asked the parser how long a day is could not disagree with it. A calendar that
/// answered 96 on the autumn Sunday would then be handed a 96-point document for a 100-point date
/// and both halves would pass. Design §7.10 asks for a 96-point document to be <b>rejected</b> for
/// both DST dates; that assertion only means something if the two counts come from two places.
/// </para>
/// <para>
/// <b>The count is the length of the local day, not a loop.</b> It is the difference between two UTC
/// instants — this local midnight and the next — divided by fifteen minutes, so the DST arithmetic
/// belongs to the platform rather than to this file. Local midnight is never ambiguous and never
/// invalid in Amsterdam, because both transitions happen at 02:00 and 03:00 local, which is exactly
/// why the DAY boundary is the safe thing to convert and an interval boundary is not.
/// </para>
/// </remarks>
public static class AmsterdamDay
{
    /// <summary>
    /// The IANA id, not the Windows one. .NET 6 and later resolves IANA ids on Windows too, and the
    /// IANA spelling is what the rest of this repository uses.
    /// </summary>
    public static TimeZoneInfo Zone { get; } =
        TimeZoneInfo.FindSystemTimeZoneById("Europe/Amsterdam");

    /// <summary>
    /// 92 on the spring-forward Sunday, 100 on the autumn fall-back Sunday, 96 on every other day.
    /// </summary>
    public static int IntervalCount(DateOnly date) =>
        (int)((EndUtc(date) - StartUtc(date)).TotalMinutes / 15);

    /// <summary>The instant Amsterdam-local midnight on <paramref name="date"/> occurs.</summary>
    public static DateTimeOffset StartUtc(DateOnly date) => LocalMidnight(date);

    /// <summary>The instant Amsterdam-local midnight on the FOLLOWING day occurs.</summary>
    public static DateTimeOffset EndUtc(DateOnly date) => LocalMidnight(date.AddDays(1));

    /// <summary>
    /// The wire spelling integration-spec §6's sample uses: seconds, a <c>Z</c>, no fractional part.
    /// </summary>
    public static string ToPvnedInstant(DateTimeOffset instant) =>
        instant.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss'Z'", CultureInfo.InvariantCulture);

    private static DateTimeOffset LocalMidnight(DateOnly date)
    {
        // DateTimeKind.Unspecified, which is what GetUtcOffset(DateTime) wants: it means "this is a
        // local wall-clock reading in that zone", and it is the only kind that makes the question
        // well posed.
        var wallClock = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);

        // Safe without an ambiguity check because both Amsterdam transitions happen at 02:00 and
        // 03:00 local. Midnight is neither skipped nor repeated on any date, in any year in the
        // current rule set - and if that ever changes, the assertion in AmsterdamDayTests that
        // counts three 92s and three 100s across three years is what notices.
        return new DateTimeOffset(wallClock, Zone.GetUtcOffset(wallClock)).ToUniversalTime();
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~AmsterdamDayTests"
```

Expected: PASS — 28 test cases (the four theories expand to 6 + 12 + 4 + 3, plus two facts).

- [ ] **Step 5: MUTATION — the add-15-minutes loop, in the generator this time**

Design §10's third required mutation is against `IMarketCalendar.IntervalStart` and belongs to plan
1. This is its twin on the generator side, and it is worth doing because the two halves fail
differently: plan 1's mutation writes plausible data to the wrong times, and this one emits a
document of the wrong length.

Replace `IntervalCount`'s body with the loop a hurried reader writes:

```csharp
    public static int IntervalCount(DateOnly date) => 96;   // MUTATION
```

Predict: `The_six_transitions_across_three_years` fails on **all six** rows —

```
AmsterdamDay.IntervalCount(new DateOnly(2025, 3, 30))
    should be
92
    but was
96
```

— and `Across_three_years_there_are_exactly_six_short_days_and_six_long_ones` fails with
`counts.Keys should be [92, 96, 100] but was [96]`, while the twelve neighbouring-day rows and the
four ordinary-day rows stay **green**. That asymmetry is the point: a constant 96 is right 1089 days
out of 1095, and the six it is wrong on are the six that matter.

Run, confirm, restore.

- [ ] **Step 6: Second mutation — treat local midnight as midnight UTC**

Replace `LocalMidnight`'s body with
`new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero)`.

Predict: `Local_midnight_is_not_midnight_utc` fails on its **first** assertion with
`should be 2026-06-20T22:00:00+00:00 but was 2026-06-21T00:00:00+00:00`, and
`The_day_boundaries_are_the_local_midnights` fails on the two DST rows with `should be 23:00:00 but
was 1.00:00:00` — while `IntervalCount` **stays green on every ordinary day**, because two identical
errors twenty-four hours apart cancel.

⚠ That cancellation is why this mutation is worth its own step. A day length computed from two wrong
instants is right whenever the two are wrong by the same amount, so the count assertions alone do not
prove the instants are the ones the document will carry — and the document carries them.

Run, confirm, restore.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~AmsterdamDayTests"
git add src/Hosts/PeakPower.DevStubs/AmsterdamDay.cs \
        tests/PeakPower.Application.Tests/DevStubs/AmsterdamDayTests.cs
git commit -m "Compute the generator's day length a second time, from TimeZoneInfo

S2-D4 applied to arithmetic. PeakPower.DevStubs may not reference PeakPower.Infrastructure.Time
(contract 3.1), so it works out 92/96/100 itself - as the length of the local day between two
UTC midnights, not as an add-15-minutes loop. A generator that asked the calendar how long a day
is could not disagree with it, and design 7.10's 'a 96-point document is rejected for both DST
dates' would be a tautology instead of an assertion.

Six transitions across three years, the day either side of each one, and a sweep of all 1095 days
asserting exactly three 92s and three 100s. Verified by two mutations: a constant 96 is correct on
1089 of those days and wrong on the six that matter; and treating local midnight as midnight UTC
leaves every interval count green, because two identical errors twenty-four hours apart cancel -
which is why the instants have their own hand-computed assertion."
```

---

### Task 15: `LoadShape` — a plausible day, deterministic in `(ean, date, pos)`, with no `Random` anywhere

`CA5394` is **not** suppressed for `src/` (Global Constraints above), so `System.Random` and
`Random.Shared` are build errors in this project. That constraint is doing real work here rather than
being an obstacle:

⚠ **Determinism is what makes the dedupe scenario reproducible.** Contract §9.4 records `DUPLICATE`
for a **byte-identical** payload from the same BRP within 24 h. A load shape with any randomness in
it would produce a different document on the second run, the re-post would be `RECEIVED` rather than
`DUPLICATE`, and the scenario would fail intermittently — the worst possible failure mode for the
thing that is supposed to be the slice's evidence.

⚠ **`string.GetHashCode()` is NOT deterministic across processes.** .NET randomises the string hash
seed per process by default, so a shape seeded from it would differ between two runs of the same
command on the same machine. The seed below is an explicit FNV-1a, written out, for that reason
alone.

⚠ **Every quantity is ≥ 0.** Contract §8.4 rule 9 rejects a document with a negative `Qty`
(`NEGATIVE_QUANTITY`), and consumption and production remain two separate **non-negative** series
(design §4.1, `[AS-05]`). The signed quantity is `netUsage`, and it is computed by the platform from
these two — never sent.

⚠ **Every quantity is ≤ capacity × 0.25 kWh.** Contract §8.3 row 4 takes the permissive reading on
`Qty`: no hard cap, but plausibility is validated against the metering point's capacity and
**alerted**. A generator that emitted 40 MWh for a 800 kW office would spend the slice raising
alerts about itself.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/LoadShape.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/LoadShapeTests.cs`

**Interfaces:**
- Consumes: `AmsterdamDay` (task 14) — only for the caller's convenience in choosing an interval
  count; `LoadShape` itself takes the count as a parameter so it can be asked for a 92-, 96- or
  100-point day without knowing which date it is.
- Produces:
  - `PeakPower.DevStubs.LoadShape.Consumption(string ean, DateOnly date, int intervalCount, decimal capacityKw)` — `public static IReadOnlyList<decimal>`
  - `LoadShape.Production(string ean, DateOnly date, int intervalCount, decimal capacityKw)` — `public static IReadOnlyList<decimal>`
  - `LoadShape.Seed(string ean, DateOnly date)` — `public static uint`, the FNV-1a
  - `LoadShape.Decimals = 3`

⚠ **These two signatures are the ones plan 8 task 3's pinned surface names.** Frozen there; if a
parameter must change, change plan 8's block in the same edit.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/LoadShapeTests.cs`:

```csharp
using PeakPower.DevStubs;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.DevStubs;

/// <summary>
/// The generated day: deterministic, non-negative, plausible against the connection's capacity, and
/// shaped like something a cold store or an office would actually draw.
/// </summary>
public sealed class LoadShapeTests
{
    private const string Ean = "871687100000000011";
    private static readonly DateOnly Day = new(2026, 6, 21);
    private const decimal Capacity = 4200m;

    [Fact]
    public void The_same_inputs_always_produce_the_same_series()
    {
        var first = LoadShape.Consumption(Ean, Day, 96, Capacity);
        var second = LoadShape.Consumption(Ean, Day, 96, Capacity);

        // ⚠ This is the assertion the byte-identical dedupe scenario rests on. Contract §9.4 records
        // DUPLICATE only for a byte-identical payload, so any randomness here would make
        // `duplicate` an intermittently failing test rather than evidence.
        second.ShouldBe(first);
    }

    /// <summary>
    /// ⚠ And it holds ACROSS PROCESSES, which is the reason the seed is a written-out FNV-1a and not
    /// <c>string.GetHashCode()</c>: .NET randomises the string hash seed per process, so a shape
    /// seeded from it would differ between two runs of the same command on the same machine — and
    /// the dedupe scenario would pass in a single test run and fail from the command line.
    /// </summary>
    [Fact]
    public void The_seed_is_a_written_out_hash_with_a_value_that_can_be_pinned()
    {
        // Hand-computed FNV-1a (32-bit, offset basis 2166136261, prime 16777619) over
        // "871687100000000011|2026-06-21", "…|2026-06-22" and "871687100000000027|2026-06-21".
        // ⚠ Recompute these three if the key format ever changes; do NOT paste in whatever the code
        // prints, which would make this test agree with any implementation including a broken one.
        LoadShape.Seed(Ean, Day).ShouldBe(3_045_511_168u);
        LoadShape.Seed(Ean, Day.AddDays(1)).ShouldBe(3_095_844_025u);
        LoadShape.Seed("871687100000000027", Day).ShouldBe(3_225_887_695u);
    }

    [Fact]
    public void A_different_connection_draws_a_different_day()
    {
        var one = LoadShape.Consumption("871687100000000011", Day, 96, Capacity);
        var other = LoadShape.Consumption("871687100000000027", Day, 96, Capacity);

        one.ShouldNotBe(other);
    }

    [Theory]
    [InlineData(92)]
    [InlineData(96)]
    [InlineData(100)]
    public void The_series_is_exactly_as_long_as_it_was_asked_for(int intervalCount)
    {
        LoadShape.Consumption(Ean, Day, intervalCount, Capacity).Count.ShouldBe(intervalCount);
        LoadShape.Production(Ean, Day, intervalCount, Capacity).Count.ShouldBe(intervalCount);
    }

    /// <summary>
    /// Contract §8.4 rule 9: a negative <c>Qty</c> is <c>NEGATIVE_QUANTITY</c> and the document is
    /// rejected whole. Consumption and production stay two separate NON-NEGATIVE series
    /// (design §4.1, [AS-05]); the signed number is netUsage, which the platform computes and the
    /// generator never sends.
    /// </summary>
    [Fact]
    public void No_quantity_is_ever_negative()
    {
        foreach (var day in Enumerable.Range(0, 400).Select(Day.AddDays))
        {
            var count = AmsterdamDay.IntervalCount(day);

            LoadShape.Consumption(Ean, day, count, Capacity).ShouldAllBe(quantity => quantity >= 0m);
            LoadShape.Production(Ean, day, count, Capacity).ShouldAllBe(quantity => quantity >= 0m);
        }
    }

    /// <summary>
    /// Contract §8.3 row 4 takes the permissive reading on <c>Qty</c>: no hard cap, validated
    /// against the metering point's capacity and ALERTED. A generator that emitted more than the
    /// connection can physically draw would spend the slice raising alerts about itself.
    /// </summary>
    [Fact]
    public void No_quantity_exceeds_a_quarter_hour_at_full_capacity()
    {
        var ceiling = Capacity * 0.25m;

        LoadShape.Consumption(Ean, Day, 96, Capacity).ShouldAllBe(quantity => quantity <= ceiling);
        LoadShape.Production(Ean, Day, 96, Capacity).ShouldAllBe(quantity => quantity <= ceiling);
    }

    [Fact]
    public void Every_quantity_carries_three_decimals_and_no_more()
    {
        // numeric(16,3) on interval_reading.quantity_kwh (contract §6.6). A fourth decimal would be
        // rounded by PostgreSQL, and a fixture computed here would then disagree with the row.
        foreach (var quantity in LoadShape.Consumption(Ean, Day, 96, Capacity))
        {
            decimal.Round(quantity, LoadShape.Decimals).ShouldBe(quantity);
        }
    }

    /// <summary>
    /// The shape has to be a shape. A flat line would pass every assertion above and would make the
    /// day chart, the KPI strip and the §4.1 accumulators all indistinguishable from a constant.
    /// </summary>
    [Fact]
    public void The_working_day_draws_more_than_the_small_hours()
    {
        var series = LoadShape.Consumption(Ean, Day, 96, Capacity);

        // Pos 1-16 is 00:00-04:00 local; Pos 41-56 is 10:00-14:00.
        var night = series.Take(16).Sum();
        var midday = series.Skip(40).Take(16).Sum();

        midday.ShouldBeGreaterThan(night * 1.5m);
    }

    /// <summary>
    /// Production is a solar bell: zero overnight, peaking around local noon. Pos 41-56 is
    /// 10:00-14:00 local, which straddles it on any interval count.
    /// </summary>
    [Fact]
    public void Production_is_zero_at_night_and_peaks_around_noon()
    {
        var series = LoadShape.Production(Ean, Day, 96, Capacity);

        series.Take(8).ShouldAllBe(quantity => quantity == 0m);          // 00:00-02:00
        series.Skip(88).ShouldAllBe(quantity => quantity == 0m);         // 22:00-24:00
        series.Skip(40).Take(16).Sum().ShouldBeGreaterThan(0m);
    }

    /// <summary>
    /// A connection whose <c>production_expectation</c> is NEVER is asked for no production series
    /// at all — the catalogue decides that, not this file. What this asserts is that a zero capacity
    /// cannot produce a document full of zeros that would read as a declared zero on the wire and be
    /// indistinguishable from one.
    /// </summary>
    [Fact]
    public void A_zero_capacity_connection_produces_a_zero_series_rather_than_a_negative_one()
    {
        LoadShape.Production(Ean, Day, 96, capacityKw: 0m).ShouldAllBe(quantity => quantity == 0m);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~LoadShapeTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'LoadShape' could not be found`.

- [ ] **Step 3: Write `LoadShape`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/LoadShape.cs`:

```csharp
using System.Globalization;

namespace PeakPower.DevStubs;

/// <summary>
/// A plausible day of consumption and, where the connection has panels, of production — as a pure
/// function of <c>(ean, date, pos)</c>.
/// </summary>
/// <remarks>
/// <para>
/// ⚠ <b>There is no <c>Random</c> here, and there cannot be.</b> <c>CA5394</c> is not suppressed for
/// <c>src/</c>, so <c>System.Random</c> is a build error in this project — and the constraint is
/// doing real work: contract §9.4 records <c>DUPLICATE</c> only for a <b>byte-identical</b> payload,
/// so a shape with any randomness in it would make the dedupe scenario pass or fail depending on
/// whether the document happened to come out the same twice.
/// </para>
/// <para>
/// ⚠ <b>And no <c>string.GetHashCode()</c>.</b> .NET randomises the string hash seed per process, so
/// a shape seeded from it is deterministic within one run and different between two — which is the
/// worst of both, because every test passes and the command line disagrees. <see cref="Seed"/> is a
/// written-out FNV-1a for that reason and no other.
/// </para>
/// <para>
/// <b>Both series are non-negative</b> (contract §8.4 rule 9, design §4.1, <c>[AS-05]</c>) and both
/// are bounded by a quarter of an hour at the connection's capacity (contract §8.3 row 4's
/// plausibility reading). The signed number is <c>netUsage</c>; the platform computes it from these
/// two, and the generator never sends it.
/// </para>
/// </remarks>
public static class LoadShape
{
    /// <summary><c>interval_reading.quantity_kwh</c> is <c>numeric(16,3)</c> (contract §6.6).</summary>
    public const int Decimals = 3;

    private const uint FnvOffsetBasis = 2166136261;
    private const uint FnvPrime = 16777619;

    /// <summary>
    /// A stable 32-bit FNV-1a over <c>"{ean}|{yyyy-MM-dd}"</c>. Written out rather than delegated so
    /// its value does not change between processes, framework versions or machines.
    /// </summary>
    public static uint Seed(string ean, DateOnly date)
    {
        ArgumentNullException.ThrowIfNull(ean);

        var key = string.Create(
            CultureInfo.InvariantCulture, $"{ean}|{date:yyyy-MM-dd}");

        var hash = FnvOffsetBasis;

        foreach (var character in key)
        {
            hash ^= character;
            hash *= FnvPrime;
        }

        return hash;
    }

    /// <summary>
    /// A consumption day: a base load that never stops, a working-day plateau between roughly 07:00
    /// and 19:00 local, and a per-connection, per-interval wobble so no two connections and no two
    /// days are the same curve.
    /// </summary>
    public static IReadOnlyList<decimal> Consumption(
        string ean, DateOnly date, int intervalCount, decimal capacityKw)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(intervalCount, 1);

        var ceiling = capacityKw * 0.25m;
        var seed = Seed(ean, date);
        var series = new decimal[intervalCount];

        for (var index = 0; index < intervalCount; index++)
        {
            // Fraction of the way through the local day, so a 92- and a 100-interval day have the
            // same SHAPE and only differ in resolution. Reading it off Pos alone would slide the
            // working-day plateau by an hour on each DST day.
            var throughDay = (index + 0.5) / intervalCount;

            // 0.32 of capacity overnight, rising to 0.86 across the working day. A plateau rather
            // than a sine, because that is what a cold store or a data centre actually draws.
            var plateau = throughDay is > 0.29 and < 0.79 ? 0.86 : 0.32;

            // ±6%, deterministic in (ean, date, pos). Enough that no two connections share a curve;
            // small enough that the plateau stays a plateau.
            var wobble = 1.0 + (Wobble(seed, index) * 0.06);

            var value = (decimal)(plateau * wobble) * ceiling;

            series[index] = Clamp(value, ceiling);
        }

        return series;
    }

    /// <summary>
    /// A production day: a solar bell centred on local noon and zero outside roughly 06:00-20:00,
    /// scaled so the peak interval is about 70% of capacity — a real array is sized below the
    /// connection.
    /// </summary>
    /// <remarks>
    /// Whether a connection gets a production series at all is <c>ScenarioCatalogue</c>'s decision,
    /// not this method's: <c>[DEC-65]</c> says PVNed sends <b>no A01 series at all</b> for a
    /// connection that never produces — absent, not present-and-zero — and a series of zeros here
    /// would be a different document making a different claim.
    /// </remarks>
    public static IReadOnlyList<decimal> Production(
        string ean, DateOnly date, int intervalCount, decimal capacityKw)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(intervalCount, 1);

        var ceiling = capacityKw * 0.25m;
        var seed = Seed(ean, date) ^ 0x5F5F5F5F;   // A different curve from the same connection's load
        var series = new decimal[intervalCount];

        for (var index = 0; index < intervalCount; index++)
        {
            var throughDay = (index + 0.5) / intervalCount;

            // Zero before 06:00 and after 20:00 local, as fractions of the day.
            if (throughDay is <= 0.25 or >= 0.8333)
            {
                series[index] = 0m;
                continue;
            }

            // A bell on [0.25, 0.8333] peaking at its midpoint, which is local noon.
            var progress = (throughDay - 0.25) / (0.8333 - 0.25);
            var bell = Math.Sin(progress * Math.PI);

            var wobble = 1.0 + (Wobble(seed, index) * 0.08);

            var value = (decimal)(bell * bell * 0.70 * wobble) * ceiling;

            series[index] = Clamp(value, ceiling);
        }

        return series;
    }

    /// <summary>A value in [-1, 1], deterministic in the seed and the position.</summary>
    private static double Wobble(uint seed, int index)
    {
        var mixed = seed ^ (uint)((index + 1) * 2654435761);

        mixed ^= mixed >> 15;
        mixed *= FnvPrime;
        mixed ^= mixed >> 13;

        return ((mixed % 2001) / 1000.0) - 1.0;
    }

    /// <summary>
    /// Rounded to three decimals and held inside <c>[0, ceiling]</c>. Both bounds are assertions
    /// elsewhere — contract §8.4 rule 9 for the floor, contract §8.3 row 4 for the ceiling — and
    /// clamping here is what makes them true for every input rather than for the ones that were
    /// tried.
    /// </summary>
    private static decimal Clamp(decimal value, decimal ceiling) =>
        decimal.Round(Math.Clamp(value, 0m, ceiling), Decimals, MidpointRounding.AwayFromZero);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~LoadShapeTests"
```

Expected: PASS — 12 test cases (the one theory expands to three).

⚠ If `-warnaserror` reports `CA5394`, something in this file reached for `Random`. There is no
suppression to add: rewrite it as a function of the seed.

- [ ] **Step 5: MUTATION — seed from `string.GetHashCode()` and watch nothing fail**

This mutation is here because it is the one that **does not** go red in a single test run, and
knowing that is worth a step. Replace `Seed`'s body with

```csharp
        return (uint)HashCode.Combine(ean, date);   // MUTATION
```

Predict: **every test in this class still passes.** `HashCode.Combine` is stable within a process, so
`The_same_inputs_always_produce_the_same_series` is green and so is every other assertion.

Now run it twice from the command line and compare across processes:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet run --project src/Hosts/PeakPower.DevStubs -- scenarios --dry-run --print normal-day > /tmp/pp-shape-a.xml
dotnet run --project src/Hosts/PeakPower.DevStubs -- scenarios --dry-run --print normal-day > /tmp/pp-shape-b.xml
diff /tmp/pp-shape-a.xml /tmp/pp-shape-b.xml
```

(The `--dry-run --print` verb arrives in task 22. Until then, run the comparison as a scratch
`dotnet fsi`-style throwaway that calls `LoadShape.Consumption` twice in two processes — the point is
that the comparison is **between processes**, which is the only place this failure exists.)

Predict: `diff` reports differences. Restore the FNV-1a and re-run: the two files are identical.

⚠ **Record this in the repository, not only here.** Add the two-process comparison as a comment above
`Seed` naming what was observed, because the unit test genuinely cannot catch it and a future reader
will otherwise "simplify" the hash back.

- [ ] **Step 6: Second mutation — drop the clamp and watch the plausibility ceiling go red**

Replace `Clamp`'s body with `decimal.Round(value, Decimals, MidpointRounding.AwayFromZero)`, and
raise the consumption wobble from `0.06` to `0.40` in the same edit so the plateau can exceed the
ceiling.

Predict: `No_quantity_exceeds_a_quarter_hour_at_full_capacity` fails with
`series should all be quantity <= 1050 but [1129.887, …] do not`, while
`No_quantity_is_ever_negative` **stays green** — because the wobble is symmetric and the base load
never gets near zero. The two bounds fail independently, which is why they are two assertions.

Run, confirm, restore both edits.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~LoadShapeTests"
git add src/Hosts/PeakPower.DevStubs/LoadShape.cs \
        tests/PeakPower.Application.Tests/DevStubs/LoadShapeTests.cs
git commit -m "Generate a plausible day as a pure function of (ean, date, pos)

CA5394 is not suppressed for src/, so there is no Random here - and the constraint is load-bearing
rather than an obstacle. Contract 9.4 records DUPLICATE only for a byte-identical payload, so any
randomness would make the dedupe scenario pass or fail on whether the document happened to come
out the same twice.

The seed is a written-out FNV-1a and NOT string.GetHashCode(), because .NET randomises the string
hash seed per process: a shape seeded from it is deterministic inside one test run and different
between two, which is the one failure a unit test cannot see. Verified by running the generator in
two processes and diffing the output - the mutation leaves every test in the class green.

Both series are non-negative (contract 8.4 rule 9) and bounded by a quarter hour at capacity
(contract 8.3 row 4's plausibility reading, which alerts rather than rejects). Verified by mutation:
dropping the clamp breaks the ceiling assertion and leaves the floor green, which is why they are
two assertions and not one."
```

---

### Task 16: `DocumentSpec` and `PvnedDocumentTemplate` — templated XML **text**, which is the point of the whole component

**S2-D4 is this file.** Design §2: *"The generator emits templated XML **text**, never a serialisation
of the parser's own model — otherwise generator and parser share a type, and a shared misreading of
the PVNed format passes every test in the slice."* Contract §13 repeats it, and contract §3.1 enforces
it by keeping `PeakPower.Integration.Brp.Pvned` out of this project's reference list.

Concretely, what that forbids:

| Not this | Because |
| --- | --- |
| `new XDocument(...)` built from `CanonicalSeries` | `CanonicalSeries` is the parser's model; a shared shape is a shared misreading |
| `XmlSerializer` over a type the adapter also uses | Same, with a round trip to hide it |
| Calling anything in `PeakPower.Integration.Brp.Pvned` | The reference does not exist and must not be added |
| Validating the output against `TimeSeriesDocument-v2p0.reconstructed.xsd` here | The XSD is the parser's nine guesses. A generator that validated against it would only ever emit what those guesses allow, and the `invalid-*` documents could not exist |

What it requires is a `StringBuilder` and the element order of integration-spec **§3** and **§6**,
transcribed by hand from the specification rather than derived from any code in this repository.

⚠ **`RecourceName` is spelled that way in PVNed's schema.** Contract §8.1: *"It is normative. Do not
'fix' it."* A test below asserts the misspelling is present, because a helpful autocorrect here would
produce documents the real integration rejects while every test in this slice passed.

⚠ **`BusinessType` is a different code list from `Direction`, and they overlap.** Contract §8.2:
`Direction` `A01` is **production**; `BusinessType` `A01` is also production but `A04` — not `A02` —
is consumption (integration-spec §4.2). Reading one list as the other is the exact trap the contract
names, and it has its own assertion below.

⚠ **`Period.TimeInterval` is emitted, and the parser must ignore it.** Contract §8.2: `MeasurementPeriode`
plus `Pos` are authoritative and `Period.TimeInterval` is logged as a discrepancy, never used to place
a point (integration-spec §9 row 7, the interim answer to `[OQ-20]`). The generator emits both,
agreeing, because a real document has both — and because a generator that omitted the one the parser
must ignore would never exercise the ignoring.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/DocumentSpec.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/PvnedDocumentTemplate.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/PvnedDocumentTemplateTests.cs`

**Interfaces:**
- Consumes: `AmsterdamDay.StartUtc`, `.EndUtc`, `.ToPvnedInstant` (task 14).
- Produces:
  - `PeakPower.DevStubs.DocumentSpec(string DocumentId, DateTimeOffset DocumentCreated, string DocumentType, string ProcessType, string SenderGln, string ReceiverGln, string ResourceObject, DateOnly DeliveryDate, string Direction, string Resolution, string CurveType, string MeasurementUnit, IReadOnlyList<decimal> Quantities)`
  - `PeakPower.DevStubs.PvnedDocumentTemplate.Render(DocumentSpec spec)` — `public static string`
  - `PvnedDocumentTemplate.PadTo(string xml, int totalBytes)` — `public static string`
  - `PvnedDocumentTemplate.ByteCount(string xml)` — `public static int`
  - `PvnedDocumentTemplate.BusinessTypeFor(string direction)` — `public static string`
  - `PvnedDocumentTemplate.Namespace` and `.SoapNamespace` — `public const string`

⚠ **`DocumentSpec`'s member list and `Render`'s signature are plan 8 task 3's pinned surface.**
Frozen there. If a field must change, change plan 8's block in the same edit and say so.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/PvnedDocumentTemplateTests.cs`:

```csharp
using System.Text;
using System.Xml.Linq;
using PeakPower.DevStubs;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.DevStubs;

/// <summary>
/// The templated XML text — S2-D4.
/// <para>
/// <b>Every assertion here reads the OUTPUT, and several of them read it as text rather than as
/// XML.</b> That is deliberate. The value of this component is that it does not share a type with the
/// parser, so a test that only round-tripped the document through <c>XDocument</c> would check the
/// generator against the same library the parser uses and prove rather less than it looks.
/// </para>
/// </summary>
public sealed class PvnedDocumentTemplateTests
{
    private static readonly DateTimeOffset Created = new(2026, 6, 22, 5, 30, 0, TimeSpan.Zero);

    private static DocumentSpec Spec(
        string direction = "A02",
        DateOnly? deliveryDate = null,
        IReadOnlyList<decimal>? quantities = null,
        string resourceObject = "871687100000000011") =>
        new(
            DocumentId: "8ff18bca-9e80-41aa-bd9f-3202f2fcc6c8",
            DocumentCreated: Created,
            DocumentType: "A23",
            ProcessType: "A05",
            SenderGln: "8714252005776",
            ReceiverGln: "8712423456789",
            ResourceObject: resourceObject,
            DeliveryDate: deliveryDate ?? new DateOnly(2026, 6, 21),
            Direction: direction,
            Resolution: "PT15M",
            CurveType: "A01",
            MeasurementUnit: "KWH",
            Quantities: quantities ?? [.. Enumerable.Repeat(1.500m, 96)]);

    private static XElement Body(string xml) =>
        XDocument.Parse(xml).Root!
            .Element(XName.Get("Body", PvnedDocumentTemplate.SoapNamespace))!;

    private static XElement Document(string xml) =>
        Body(xml).Element(XName.Get("TimeSeriesDocument", PvnedDocumentTemplate.Namespace))!;

    private static XElement Series(string xml) =>
        Document(xml).Element(XName.Get("TimeSeries", PvnedDocumentTemplate.Namespace))!;

    private static string Value(XElement parent, string name) =>
        parent.Element(XName.Get(name, PvnedDocumentTemplate.Namespace))!.Value;

    [Fact]
    public void The_document_is_well_formed_inside_a_soap_envelope_in_the_pvned_namespace()
    {
        var xml = PvnedDocumentTemplate.Render(Spec());

        // Parsed here only to prove well-formedness. Nothing below trusts the parse to tell it
        // whether the ELEMENT ORDER is right, because XDocument does not care and the XSD does.
        var document = Document(xml);

        document.Name.NamespaceName.ShouldBe("http://www.pvned.eu/CustomerIntegrations/External/v2p0");
        Body(xml).Name.NamespaceName.ShouldBe("http://schemas.xmlsoap.org/soap/envelope/");
    }

    /// <summary>
    /// Element order, read off the text. Integration-spec §3's class diagram and §6's sample are the
    /// source, and the XSD is a sequence — so an out-of-order document is invalid even though it
    /// parses.
    /// </summary>
    [Fact]
    public void The_document_header_is_in_schema_element_order()
    {
        var xml = PvnedDocumentTemplate.Render(Spec());

        int At(string element) => xml.IndexOf($"<{element}>", StringComparison.Ordinal);

        At("DocumentIdentification").ShouldBeLessThan(At("DocumentVersion"));
        At("DocumentVersion").ShouldBeLessThan(At("DocumentType"));
        At("DocumentType").ShouldBeLessThan(At("ProcessType"));
        At("ProcessType").ShouldBeLessThan(At("SenderIdentification"));
        At("SenderIdentification").ShouldBeLessThan(At("ReceiverIdentification"));
        At("ReceiverIdentification").ShouldBeLessThan(At("CreatedDateTime"));
        At("CreatedDateTime").ShouldBeLessThan(At("ReportPeriode"));
        At("ReportPeriode").ShouldBeLessThan(At("TimeSeries"));
    }

    [Fact]
    public void The_series_is_in_schema_element_order()
    {
        var xml = PvnedDocumentTemplate.Render(Spec());

        int At(string element) => xml.IndexOf($"<{element}>", StringComparison.Ordinal);

        At("mRID").ShouldBeLessThan(At("BusinessType"));
        At("BusinessType").ShouldBeLessThan(At("MeasurementPeriode"));
        At("MeasurementPeriode").ShouldBeLessThan(At("Direction"));
        At("Direction").ShouldBeLessThan(At("MeasurementUnit"));
        At("MeasurementUnit").ShouldBeLessThan(At("CurveType"));
        At("CurveType").ShouldBeLessThan(At("Resource"));
        At("Resource").ShouldBeLessThan(At("Period"));
        At("Period").ShouldBeLessThan(At("TimeInterval"));
        At("TimeInterval").ShouldBeLessThan(At("Resolution"));
        At("Resolution").ShouldBeLessThan(At("Point"));
    }

    /// <summary>
    /// ⚠ <c>RecourceName</c> is PVNed's own misspelling and contract §8.1 makes it normative. This
    /// assertion exists because the correction is the single most tempting one-character edit in the
    /// file, and making it would produce documents the real integration rejects while every test in
    /// this slice went on passing.
    /// </summary>
    [Fact]
    public void The_misspelling_pvned_ships_is_reproduced_exactly()
    {
        var xml = PvnedDocumentTemplate.Render(Spec());

        xml.Contains("<RecourceName>", StringComparison.Ordinal).ShouldBeTrue();
        xml.Contains("<ResourceName>", StringComparison.Ordinal).ShouldBeFalse();
    }

    /// <summary>
    /// ⚠ Contract §8.2's named trap: <c>Direction</c> A01 is production and A02 is consumption, but
    /// on <c>BusinessType</c> production is A01 and consumption is <b>A04</b>. Two lists, one
    /// overlapping code.
    /// </summary>
    [Theory]
    [InlineData("A01", "A01")]
    [InlineData("A02", "A04")]
    [InlineData("A03", "A07")]
    public void BusinessType_is_a_different_code_list_from_Direction(
        string direction, string expectedBusinessType)
    {
        PvnedDocumentTemplate.BusinessTypeFor(direction).ShouldBe(expectedBusinessType);

        Value(Series(PvnedDocumentTemplate.Render(Spec(direction))), "BusinessType")
            .ShouldBe(expectedBusinessType);
    }

    [Fact]
    public void The_points_are_numbered_from_one_contiguously_and_carry_three_decimals()
    {
        var quantities = new decimal[] { 0m, 1.25m, 3.5m, 12.345m };
        var xml = PvnedDocumentTemplate.Render(Spec(quantities: quantities));

        var points = Series(xml)
            .Element(XName.Get("Period", PvnedDocumentTemplate.Namespace))!
            .Elements(XName.Get("Point", PvnedDocumentTemplate.Namespace))
            .ToArray();

        points.Length.ShouldBe(4);
        points.Select(point => Value(point, "Pos")).ShouldBe(["1", "2", "3", "4"]);

        // Invariant culture, three decimals, and a decimal POINT. A machine in nl-NL would otherwise
        // emit 12,345 - which is well-formed XML, a valid decimal to nobody, and a thousand times
        // the intended value to anyone who guessed.
        points.Select(point => Value(point, "Qty"))
            .ShouldBe(["0.000", "1.250", "3.500", "12.345"]);
    }

    /// <summary>
    /// <c>Qty2</c> and <c>Price</c> are both optional and neither is used by the platform
    /// (contract §8.3 row 8). Emitting a <c>Qty2</c> would give the parser a field it is required to
    /// ignore and no way to prove it does — which is worth having, but not here: it belongs to the
    /// hand-written fixtures design §8 keeps out of the generator's hands.
    /// </summary>
    [Fact]
    public void A_point_carries_only_Pos_and_Qty()
    {
        var xml = PvnedDocumentTemplate.Render(Spec());

        xml.Contains("<Qty2>", StringComparison.Ordinal).ShouldBeFalse();
        xml.Contains("<Price>", StringComparison.Ordinal).ShouldBeFalse();
    }

    /// <summary>
    /// The periods are the local day, in UTC, in the sample's own spelling. Integration-spec §5's
    /// worked example: 2024-12-27T23:00:00Z is midnight on 2024-12-28 local.
    /// </summary>
    [Fact]
    public void Every_period_is_the_amsterdam_local_day_in_utc()
    {
        var xml = PvnedDocumentTemplate.Render(Spec(deliveryDate: new DateOnly(2024, 12, 28)));

        var occurrences = xml.Split("2024-12-27T23:00:00Z", StringSplitOptions.None).Length - 1;
        var ends = xml.Split("2024-12-28T23:00:00Z", StringSplitOptions.None).Length - 1;

        // ReportPeriode, MeasurementPeriode and Period.TimeInterval - three starts and three ends.
        occurrences.ShouldBe(3);
        ends.ShouldBe(3);
    }

    /// <summary>
    /// ⚠ <c>Period.TimeInterval</c> is emitted and AGREES with <c>MeasurementPeriode</c>. Contract
    /// §8.2 makes <c>MeasurementPeriode</c> plus <c>Pos</c> authoritative and requires
    /// <c>Period.TimeInterval</c> to be logged as a discrepancy and never used to place a point. A
    /// generator that omitted it would never exercise the ignoring, and one that made it disagree
    /// would turn every ordinary scenario into a discrepancy log.
    /// </summary>
    [Fact]
    public void The_period_time_interval_agrees_with_the_measurement_periode()
    {
        var series = Series(PvnedDocumentTemplate.Render(Spec()));

        var measurement = series.Element(XName.Get("MeasurementPeriode", PvnedDocumentTemplate.Namespace))!;
        var interval = series
            .Element(XName.Get("Period", PvnedDocumentTemplate.Namespace))!
            .Element(XName.Get("TimeInterval", PvnedDocumentTemplate.Namespace))!;

        Value(interval, "StartPeriod").ShouldBe(Value(measurement, "StartPeriod"));
        Value(interval, "EndPeriod").ShouldBe(Value(measurement, "EndPeriod"));
    }

    /// <summary>
    /// The same spec renders the same bytes, every time, in every process. This is the second half of
    /// the dedupe scenario's foundation — <see cref="LoadShapeTests"/> pins the quantities and this
    /// pins everything around them, including <c>mRID</c>, which is the one field a careless
    /// implementation would fill with <c>Guid.NewGuid()</c>.
    /// </summary>
    [Fact]
    public void The_same_spec_always_renders_the_same_bytes()
    {
        var spec = Spec();

        PvnedDocumentTemplate.Render(spec).ShouldBe(PvnedDocumentTemplate.Render(spec));
    }

    [Fact]
    public void The_series_id_is_derived_from_the_document_and_the_direction_rather_than_generated()
    {
        var consumption = Value(Series(PvnedDocumentTemplate.Render(Spec("A02"))), "mRID");
        var production = Value(Series(PvnedDocumentTemplate.Render(Spec("A01"))), "mRID");

        // A GUID's canonical form, and DIFFERENT for the two directions of one document - a real
        // document's two series do not share an mRID.
        Guid.TryParseExact(consumption, "D", out _).ShouldBeTrue();
        consumption.ShouldNotBe(production);
    }

    /// <summary>
    /// The eighteen-digit EAN goes in <c>ResourceObject</c> verbatim. <c>[F02-R11]</c>/<c>[AS-17]</c>:
    /// eighteen digits is an EAN and anything else is a descriptive label, so this field is the one
    /// the pipeline's resolver reads and it must not be reformatted, padded or prefixed.
    /// </summary>
    [Fact]
    public void The_resource_object_is_the_ean_verbatim()
    {
        var resource = Series(PvnedDocumentTemplate.Render(Spec()))
            .Element(XName.Get("Resource", PvnedDocumentTemplate.Namespace))!;

        Value(resource, "ResourceObject").ShouldBe("871687100000000011");
    }

    /// <summary>
    /// XML escaping, on a field an operator can put anything in. It is exercised through
    /// <c>ResourceObject</c> because that is the only free-text field a scenario supplies, and a
    /// generator that emitted a raw ampersand would produce a document the parser rejects as
    /// malformed rather than as the thing the scenario meant to test.
    /// </summary>
    [Fact]
    public void Text_is_escaped_rather_than_pasted()
    {
        var xml = PvnedDocumentTemplate.Render(Spec(resourceObject: "Prognosis & <Realisation>"));

        xml.Contains("&amp;", StringComparison.Ordinal).ShouldBeTrue();
        xml.Contains("&lt;Realisation&gt;", StringComparison.Ordinal).ShouldBeTrue();

        // And it is still well-formed, which is the assertion that actually matters.
        Value(
            Series(xml).Element(XName.Get("Resource", PvnedDocumentTemplate.Namespace))!,
            "ResourceObject")
            .ShouldBe("Prognosis & <Realisation>");
    }

    /// <summary>
    /// Contract §9.4: <b>exactly 26 214 400 bytes is accepted and 26 214 401 is refused.</b> Both
    /// documents have to exist, so the padding has to land on an exact byte count — not
    /// approximately, and not in characters.
    /// </summary>
    [Theory]
    [InlineData(26_214_400)]
    [InlineData(26_214_401)]
    public void Padding_lands_on_an_exact_byte_count(int totalBytes)
    {
        var padded = PvnedDocumentTemplate.PadTo(PvnedDocumentTemplate.Render(Spec()), totalBytes);

        PvnedDocumentTemplate.ByteCount(padded).ShouldBe(totalBytes);
        Encoding.UTF8.GetByteCount(padded).ShouldBe(totalBytes);
    }

    [Fact]
    public void A_padded_document_is_still_well_formed_and_still_says_the_same_thing()
    {
        var padded = PvnedDocumentTemplate.PadTo(PvnedDocumentTemplate.Render(Spec()), 2_000_000);

        // The padding is an XML comment, which is legal in element content and carries no data - so
        // the size-boundary scenarios test the SIZE and nothing else.
        Value(Document(padded), "DocumentIdentification")
            .ShouldBe("8ff18bca-9e80-41aa-bd9f-3202f2fcc6c8");
        Series(padded)
            .Element(XName.Get("Period", PvnedDocumentTemplate.Namespace))!
            .Elements(XName.Get("Point", PvnedDocumentTemplate.Namespace))
            .Count()
            .ShouldBe(96);
    }

    [Fact]
    public void Padding_below_the_documents_own_size_is_refused_rather_than_truncating()
    {
        var xml = PvnedDocumentTemplate.Render(Spec());

        Should.Throw<ArgumentOutOfRangeException>(() => PvnedDocumentTemplate.PadTo(xml, 10));
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDocumentTemplateTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'DocumentSpec' could not be found`.

- [ ] **Step 3: Write `DocumentSpec`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/DocumentSpec.cs`:

```csharp
namespace PeakPower.DevStubs;

/// <summary>
/// One PVNed <c>TimeSeriesDocument</c> to render: one document, one series, one period.
/// </summary>
/// <remarks>
/// <para>
/// ⚠ <b>Every code below is the PVNed CODE, not a platform enum.</b> <c>DocumentType</c> is
/// <c>"A23"</c>, <c>Direction</c> is <c>"A01"</c> or <c>"A02"</c>, and neither is
/// <c>BrpDocumentKind</c> or <c>IntervalDirection</c>. S2-D4: the generator emits templated XML
/// <b>text</b> and never a serialisation of the parser's model, and <c>PeakPower.DevStubs</c>
/// cannot see those types in the first place (contract §3.1). Strings here are not laziness — they
/// are the thing being tested, because an invalid document is expressed by putting a code in a field
/// that no enum has a member for.
/// </para>
/// <para>
/// <b>One series per document, deliberately.</b> <c>[DEC-38]</c>'s cadence is one document per EAN
/// per day, and a producing connection sends two documents rather than one document with two series.
/// The "second timeseries is one point short" case design §7.4 requires is plan 3's assertion, built
/// from a hand-written fixture; a generator that could emit it would need a second series and no
/// scenario in contract §13.1 asks for one.
/// </para>
/// </remarks>
/// <param name="DocumentId">
/// Goes on <c>DocumentIdentification</c> and reaches <c>interval_data_version.document_id</c>.
/// Contract §8.3 row 1: 36 characters are accepted, so a GUID fits.
/// </param>
/// <param name="DocumentCreated">
/// <c>CreatedDateTime</c>, reaching <c>interval_data_version.document_created</c>. ⚠ <b>Not the
/// ordering key</b> — receipt order is (§4.2), and the <c>out-of-order-pair</c> scenario is built by
/// posting the LATER of two of these FIRST.
/// </param>
/// <param name="ResourceObject">
/// Eighteen digits for an EAN, anything else for a descriptive label. <c>[F02-R11]</c>/<c>[AS-17]</c>:
/// the discrimination is "is it 18 digits", and a label is never offered to the EAN resolver.
/// </param>
/// <param name="DeliveryDate">
/// The Amsterdam calendar day. Every period in the rendered document is derived from it through
/// <see cref="AmsterdamDay"/>, and so is the expected point count.
/// </param>
/// <param name="Quantities">
/// kWh per interval, in <c>Pos</c> order from 1. ⚠ <b>The COUNT is what makes a document complete or
/// short</b> — contract §8.4 rule 7 rejects a count that is not the expected 92/96/100 for that date
/// with <c>INCOMPLETE_PERIOD</c>, and the <c>invalid-INCOMPLETE_PERIOD</c> scenario is one short
/// list.
/// </param>
public sealed record DocumentSpec(
    string DocumentId,
    DateTimeOffset DocumentCreated,
    string DocumentType,          // "A23"
    string ProcessType,
    string SenderGln,
    string ReceiverGln,
    string ResourceObject,        // the eighteen-digit EAN
    DateOnly DeliveryDate,
    string Direction,             // "A01" production | "A02" consumption
    string Resolution,            // "PT15M"
    string CurveType,             // "A01"
    string MeasurementUnit,       // "KWH"
    IReadOnlyList<decimal> Quantities);
```

- [ ] **Step 4: Write `PvnedDocumentTemplate`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/PvnedDocumentTemplate.cs`:

```csharp
using System.Globalization;
using System.Security;
using System.Security.Cryptography;
using System.Text;

namespace PeakPower.DevStubs;

/// <summary>
/// Renders a <see cref="DocumentSpec"/> as PVNed <c>TimeSeriesDocument</c> XML <b>text</b>.
/// </summary>
/// <remarks>
/// <para>
/// ⚠ <b>S2-D4, and this file is what it means.</b> A <see cref="StringBuilder"/> and the element
/// order of integration-spec §3 and §6, transcribed by hand from the specification. Not
/// <c>XmlSerializer</c>, not <c>XDocument</c> built from the parser's model, and not one line of
/// <c>PeakPower.Integration.Brp.Pvned</c> — which contract §3.1 keeps out of this project's
/// reference list for exactly this reason. If the generator and the parser shared a type, a shared
/// misreading of the format would pass every test in the slice and fail on day one of the real
/// integration.
/// </para>
/// <para>
/// <b>It does not validate against the reconstructed XSD either.</b> That schema encodes the nine
/// guesses of contract §8.3. A generator that validated against it could only ever emit what those
/// guesses allow, so the <c>invalid-*</c> scenarios could not exist and the nine guesses would never
/// be tested against anything but themselves.
/// </para>
/// <para>
/// <b>Deterministic in its input.</b> No clock, no <c>Guid.NewGuid()</c>, no culture-sensitive
/// formatting. The same spec renders the same bytes in every process, which is what makes contract
/// §9.4's byte-identical <c>DUPLICATE</c> reproducible.
/// </para>
/// </remarks>
public static class PvnedDocumentTemplate
{
    /// <summary>Contract §8.1.</summary>
    public const string Namespace = "http://www.pvned.eu/CustomerIntegrations/External/v2p0";

    /// <summary>Contract §8.1: the document arrives inside a SOAP envelope.</summary>
    public const string SoapNamespace = "http://schemas.xmlsoap.org/soap/envelope/";

    /// <summary>
    /// The <c>BusinessType</c> that goes with a <c>Direction</c>.
    /// </summary>
    /// <remarks>
    /// ⚠ <b>Two code lists that share a code and mean different things.</b> Contract §8.2 names the
    /// trap: on <c>Direction</c>, <c>A01</c> is production and <c>A02</c> is consumption; on
    /// <c>BusinessType</c> (integration-spec §4.2), <c>A01</c> is production and consumption is
    /// <c>A04</c>. Copying the direction across would put <c>A02</c> in a field where it means
    /// "Realisation, on an imbalance report".
    /// </remarks>
    public static string BusinessTypeFor(string direction) => direction switch
    {
        "A01" => "A01",   // Production
        "A02" => "A04",   // Consumption - NOT A02
        _ => "A07",       // Net production/consumption: the honest code for a direction we are
                          // deliberately sending wrong, so the document fails on Direction alone.
    };

    /// <summary>The UTF-8 byte length, which is what contract §9.4's 26 214 400 counts.</summary>
    public static int ByteCount(string xml) => Encoding.UTF8.GetByteCount(xml);

    /// <summary>Render one document.</summary>
    public static string Render(DocumentSpec spec)
    {
        ArgumentNullException.ThrowIfNull(spec);

        var start = AmsterdamDay.ToPvnedInstant(AmsterdamDay.StartUtc(spec.DeliveryDate));
        var end = AmsterdamDay.ToPvnedInstant(AmsterdamDay.EndUtc(spec.DeliveryDate));

        var builder = new StringBuilder(64 * spec.Quantities.Count + 2048);

        builder.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        builder.Append(CultureInfo.InvariantCulture, $"<soap:Envelope xmlns:soap=\"{SoapNamespace}\">\n");
        builder.Append("  <soap:Body>\n");
        builder.Append(CultureInfo.InvariantCulture, $"    <TimeSeriesDocument xmlns=\"{Namespace}\">\n");

        // Header, in integration-spec §3's element order. The XSD is a sequence, so an out-of-order
        // document parses and fails validation - which is a rejection nobody asked for.
        Element(builder, 6, "DocumentIdentification", spec.DocumentId);
        Element(builder, 6, "DocumentVersion", "1");
        Element(builder, 6, "DocumentType", spec.DocumentType);
        Element(builder, 6, "ProcessType", spec.ProcessType);
        Element(builder, 6, "SenderIdentification", spec.SenderGln);
        Element(builder, 6, "ReceiverIdentification", spec.ReceiverGln);
        Element(builder, 6, "CreatedDateTime", AmsterdamDay.ToPvnedInstant(spec.DocumentCreated));
        Period(builder, 6, "ReportPeriode", start, end);

        builder.Append("      <TimeSeries>\n");
        Element(builder, 8, "mRID", SeriesId(spec));
        Element(builder, 8, "BusinessType", BusinessTypeFor(spec.Direction));
        Period(builder, 8, "MeasurementPeriode", start, end);
        Element(builder, 8, "Direction", spec.Direction);
        Element(builder, 8, "MeasurementUnit", spec.MeasurementUnit);
        Element(builder, 8, "CurveType", spec.CurveType);

        builder.Append("        <Resource>\n");
        Element(builder, 10, "ResourceObject", spec.ResourceObject);
        // ⚠ RecourceName. PVNed's own misspelling, normative per contract §8.1. Do not "fix" it.
        Element(builder, 10, "RecourceName", "Allocation");
        builder.Append("        </Resource>\n");

        builder.Append("        <Period>\n");
        Period(builder, 10, "TimeInterval", start, end);
        Element(builder, 10, "Resolution", spec.Resolution);

        for (var index = 0; index < spec.Quantities.Count; index++)
        {
            var pos = (index + 1).ToString(CultureInfo.InvariantCulture);
            var qty = spec.Quantities[index].ToString("0.000", CultureInfo.InvariantCulture);

            builder.Append(CultureInfo.InvariantCulture,
                $"          <Point><Pos>{pos}</Pos><Qty>{qty}</Qty></Point>\n");
        }

        builder.Append("        </Period>\n");
        builder.Append("      </TimeSeries>\n");
        builder.Append("    </TimeSeriesDocument>\n");
        builder.Append("  </soap:Body>\n");
        builder.Append("</soap:Envelope>\n");

        return builder.ToString();
    }

    /// <summary>
    /// Grow <paramref name="xml"/> to exactly <paramref name="totalBytes"/> UTF-8 bytes by inserting
    /// an XML comment before the closing document element.
    /// </summary>
    /// <remarks>
    /// A comment because it is legal in element content, carries no data, and survives the parse — so
    /// the two size scenarios test the SIZE and nothing else. Filled with <c>x</c> because a comment
    /// may not contain <c>--</c>, and every character used is one UTF-8 byte, which is what makes the
    /// arithmetic exact rather than approximate. Contract §9.4 pins both sides of the boundary —
    /// 26 214 400 accepted, 26 214 401 refused — so "about 25 MB" is not good enough.
    /// </remarks>
    /// <exception cref="ArgumentOutOfRangeException">
    /// The document is already larger than <paramref name="totalBytes"/>. Truncating it would produce
    /// something that is not a document, and a size test on a malformed document proves nothing.
    /// </exception>
    public static string PadTo(string xml, int totalBytes)
    {
        ArgumentNullException.ThrowIfNull(xml);

        const string anchor = "    </TimeSeriesDocument>";
        const int commentOverhead = 7;   // "<!--" + "-->"

        var current = ByteCount(xml);
        var needed = totalBytes - current - commentOverhead - 1;   // -1 for the newline after it

        ArgumentOutOfRangeException.ThrowIfLessThan(needed, 0, nameof(totalBytes));

        var at = xml.IndexOf(anchor, StringComparison.Ordinal);

        if (at < 0)
        {
            throw new ArgumentException(
                "The document does not end with a TimeSeriesDocument element, so there is nowhere "
                + "to put the padding comment.",
                nameof(xml));
        }

        return string.Concat(
            xml.AsSpan(0, at),
            "<!--",
            new string('x', needed),
            "-->\n",
            xml.AsSpan(at));
    }

    /// <summary>
    /// A GUID derived from the document id and the direction rather than generated.
    /// </summary>
    /// <remarks>
    /// <c>Guid.NewGuid()</c> here would be the one line that makes two runs of the same command
    /// produce different bytes — and contract §9.4 records <c>DUPLICATE</c> only for a byte-identical
    /// payload, so the dedupe scenario would fail intermittently and the cause would be four files
    /// away. SHA-256 of <c>"{documentId}|{direction}"</c>, first sixteen bytes.
    /// </remarks>
    private static string SeriesId(DocumentSpec spec)
    {
        var digest = SHA256.HashData(
            Encoding.UTF8.GetBytes($"{spec.DocumentId}|{spec.Direction}"));

        return new Guid(digest.AsSpan(0, 16)).ToString("D", CultureInfo.InvariantCulture);
    }

    private static void Element(StringBuilder builder, int indent, string name, string value)
    {
        builder.Append(' ', indent);
        builder.Append(CultureInfo.InvariantCulture,
            $"<{name}>{SecurityElement.Escape(value)}</{name}>\n");
    }

    private static void Period(
        StringBuilder builder, int indent, string name, string start, string end)
    {
        builder.Append(' ', indent);
        builder.Append(CultureInfo.InvariantCulture, $"<{name}>\n");
        Element(builder, indent + 2, "StartPeriod", start);
        Element(builder, indent + 2, "EndPeriod", end);
        builder.Append(' ', indent);
        builder.Append(CultureInfo.InvariantCulture, $"</{name}>\n");
    }
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDocumentTemplateTests"
```

Expected: PASS — 18 test cases (the two theories expand to three and two).

⚠ The two padding rows allocate a 26 MB string each. That is deliberate — it is the size the webhook
is being asked about — but it is also why they are the only two rows in this class that are not
instant.

- [ ] **Step 6: MUTATION 1 — "fix" the misspelling**

Change `"RecourceName"` to `"ResourceName"`.

Predict: `The_misspelling_pvned_ships_is_reproduced_exactly` fails on its **first** assertion with

```
xml.Contains("<RecourceName>", StringComparison.Ordinal)
    should be
True
    but was
False
```

and **nothing else fails** — every other test in this class, and every scenario end-to-end test in
task 23, stays green, because the platform's own parser reads `ResourceObject` and does not need
`RecourceName` at all. That is the entire reason this assertion exists: the correction is invisible
here and fatal against the real integration.

Run, confirm exactly one failure, then restore.

- [ ] **Step 7: MUTATION 2 — copy the direction into `BusinessType`**

Replace `BusinessTypeFor`'s `"A02" => "A04"` arm with `"A02" => "A02"`.

Predict: `BusinessType_is_a_different_code_list_from_Direction` fails on its **A02 row only**, with
`should be A04 but was A02`, and the A01 row stays green — which is the shape of the trap: the two
lists agree on production and disagree on consumption, so a copy is right half the time.

Run, confirm, restore.

- [ ] **Step 8: MUTATION 3 — generate the `mRID`**

Replace `SeriesId`'s body with `Guid.NewGuid().ToString("D", CultureInfo.InvariantCulture)`.

Predict: `The_same_spec_always_renders_the_same_bytes` fails with a Shouldly string diff pointing at
the `mRID` element, and `The_series_id_is_derived_from_the_document_and_the_direction_rather_than_generated`
**stays green** — it is still a GUID and still different between the two directions.

⚠ That is why the determinism assertion is a separate test from the shape one. Run, confirm, restore.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDocumentTemplateTests"
git add src/Hosts/PeakPower.DevStubs/DocumentSpec.cs \
        src/Hosts/PeakPower.DevStubs/PvnedDocumentTemplate.cs \
        tests/PeakPower.Application.Tests/DevStubs/PvnedDocumentTemplateTests.cs
git commit -m "Emit PVNed documents as templated text, never as a serialisation of the parser's model

S2-D4, and this is the file it is about. A StringBuilder and integration-spec 3 and 6's element
order, transcribed by hand - not XmlSerializer, not XDocument over a shared type, and not a line
of PeakPower.Integration.Brp.Pvned, which contract 3.1 keeps out of this project's references for
exactly this reason. It does not validate against the reconstructed XSD either: that schema encodes
the nine guesses of contract 8.3, and a generator held to them could not emit the invalid documents
that test them.

Three mutations, each of which fails somewhere different. Correcting PVNed's own RecourceName
misspelling turns exactly ONE assertion red and leaves every other test and every end-to-end
scenario green, because our parser never reads that field - which is what makes it fatal against
the real integration and invisible here. Copying Direction into BusinessType is right for
production and wrong for consumption, so it fails one theory row out of three. And a generated
mRID leaves the shape assertion green and breaks only the byte-determinism one, which is why
those are two tests.

Padding lands on an exact UTF-8 byte count, because contract 9.4 pins both sides of the boundary:
26 214 400 accepted, 26 214 401 refused."
```

---

### Task 17: `SeededConnections` — the eleven demo EANs, transcribed, with a guard that keeps them true

The backfill, the cadence pusher and eleven of the fourteen scenarios all post for **the eleven
connections `DemoDataSeeder` attaches to the six demo companies**. `PeakPower.DevStubs` cannot read
the database and cannot reference `PeakPower.Persistence`, so it carries them as data.

⚠ **A transcription that nothing checks is a copy that silently goes stale.** The `Modified by this
plan` table does not name `DemoDataSeeder.cs`, and it must not — this plan does not change the demo
roster. What it adds is a test in `PeakPower.Application.Tests`, which **can** see both projects, that
compares the eleven transcribed rows against the seeder's own list. When somebody adds a twelfth demo
connection, that test goes red and names it, rather than the backfill quietly missing a connection
that appears on the customer's screen with no data.

⚠ **`ProductionExpectation` is a `string` here.** Contract §3.1 keeps `PeakPower.Domain` out of this
project's reference list, so `"NEVER"` / `"UNKNOWN"` / `"EXPECTED"` are the database spellings
(contract §4) carried as text. The guard test does the enum comparison, on the test project's side of
the reference boundary.

⚠ **None of the eleven carries a valid GS1 check digit** — design §8's last risk row, `[OQ-97]`, and
`[DEC-114]` relaxed validation to eighteen digits. Transcribe them exactly as they are; do not
"correct" one.

**The eleven, read today from
`src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs:214-284`:**

| Line | EAN | Name | Capacity kW | `production_expectation` |
| --: | --- | --- | --: | --- |
| 214 | `871687100000000011` | Rotterdam DC | 4200 | `NEVER` |
| 217 | `871687100000000027` | Venlo cold store | 2500 | `NEVER` |
| 220 | `871687100000000043` | Tilburg plant | 3800 | `NEVER` |
| 223 | `871687100000000059` | Almere office | 800 | `EXPECTED` |
| 228 | `871687100000000061` | *(deliberately unnamed — `[F01-R31]`)* | 1200 | `UNKNOWN` |
| 232 | `871687100000000078` | Breda warehouse | 1600 | `NEVER` |
| 242 | `871687100000000085` | Venlo hub | 2900 | `NEVER` |
| 252 | `871687100000000093` | Kas 4 | 5400 | `EXPECTED` |
| 262 | `871687100000000106` | Koelhuis Barendrecht | 3100 | `NEVER` |
| 272 | `871687100000000338` | Walserij | 6200 | `NEVER` |
| 282 | `871687100000000346` | Papierfabriek | 4800 | `EXPECTED` |

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/SeededConnections.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/SeededConnectionsTests.cs`

**Interfaces:**
- Consumes: nothing. It is data.
- Produces:
  - `PeakPower.DevStubs.SeededConnection(string Ean, string Name, decimal CapacityKw, string ProductionExpectation)`
  - `PeakPower.DevStubs.SeededConnections.All` — `public static IReadOnlyList<SeededConnection>`, eleven rows
  - `SeededConnections.Producing` / `.NeverProduces` — `public static IReadOnlyList<SeededConnection>`
  - `SeededConnections.ByEan(string ean)` — `public static SeededConnection`, throws on an unknown EAN
  - `SeededConnections.Count = 11`

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/SeededConnectionsTests.cs`:

```csharp
using PeakPower.DevStubs;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.DevStubs;

/// <summary>
/// The eleven demo connections, and the guard that stops the transcription going stale.
/// <para>
/// <c>PeakPower.DevStubs</c> cannot read the database and cannot reference
/// <c>PeakPower.Persistence</c> (contract §3.1), so it carries the roster as data. A transcription
/// nothing checks is a copy that silently drifts, and the failure it drifts into is quiet: a twelfth
/// demo connection appears on the customer's screen with no data on it, and the backfill that was
/// supposed to fill it never knew it existed.
/// </para>
/// </summary>
public sealed class SeededConnectionsTests
{
    [Fact]
    public void There_are_eleven()
    {
        SeededConnections.All.Count.ShouldBe(11);
        SeededConnections.Count.ShouldBe(11);
    }

    [Fact]
    public void Every_ean_is_eighteen_digits_and_distinct()
    {
        foreach (var connection in SeededConnections.All)
        {
            connection.Ean.Length.ShouldBe(18);
            connection.Ean.ShouldAllBe(character => char.IsAsciiDigit(character));
        }

        SeededConnections.All
            .Select(connection => connection.Ean)
            .Distinct(StringComparer.Ordinal)
            .Count()
            .ShouldBe(11);
    }

    /// <summary>
    /// Three producing connections and eight that never do — which is what makes
    /// <c>no-production-series</c> and <c>missing-production-series</c> two different scenarios over
    /// two different connections rather than one scenario asserted twice.
    /// </summary>
    [Fact]
    public void The_split_is_three_producing_and_eight_that_never_do()
    {
        SeededConnections.Producing.Count.ShouldBe(3);
        SeededConnections.NeverProduces.Count.ShouldBe(8);

        // UNKNOWN is not NEVER. [F02-R32]: UNKNOWN reads as EXPECTED for completeness, because the
        // conservative failure is a false alarm rather than a hidden gap - so the UNKNOWN row is in
        // neither list above, and that is on purpose.
        SeededConnections.All
            .Count(connection => connection.ProductionExpectation == "UNKNOWN")
            .ShouldBe(1);
    }

    [Fact]
    public void The_expectation_is_the_database_spelling()
    {
        // SCREAMING_SNAKE, contract §4, because that is what the column holds and what the wire
        // carries. PeakPower.DevStubs cannot see ProductionExpectation the enum (contract §3.1), so
        // this is text - and the test below is what ties the text to the enum.
        SeededConnections.All
            .Select(connection => connection.ProductionExpectation)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ShouldBe(["EXPECTED", "NEVER", "UNKNOWN"]);
    }

    [Fact]
    public void An_unknown_ean_throws_rather_than_returning_a_default_connection()
    {
        // A default here would give the backfill a plausible capacity for a connection that does not
        // exist, and the documents would quarantine as UNKNOWN_EAN eighty-nine days later.
        Should.Throw<KeyNotFoundException>(() => SeededConnections.ByEan("871687109900000001"));
    }

    [Fact]
    public void Rotterdam_dc_is_transcribed_exactly()
    {
        var connection = SeededConnections.ByEan("871687100000000011");

        connection.Name.ShouldBe("Rotterdam DC");
        connection.CapacityKw.ShouldBe(4200m);
        connection.ProductionExpectation.ShouldBe("NEVER");
    }

    /// <summary>
    /// ⚠ <b>The guard.</b> This is the only assertion in the class that reads the seeder, and it is
    /// the reason the class exists. It runs in <c>PeakPower.Application.Tests</c>, which can see both
    /// <c>PeakPower.DevStubs</c> and <c>PeakPower.Persistence</c> — a boundary the generator itself
    /// may not cross.
    /// <para>
    /// If this goes red, somebody changed the demo roster. Update
    /// <c>SeededConnections.All</c> to match; do <b>not</b> relax the assertion, and do not change
    /// <c>DemoDataSeeder</c> to match the transcription — the seeder is the source and this is the
    /// copy.
    /// </para>
    /// </summary>
    [Fact]
    public void The_transcription_still_matches_the_seeder()
    {
        var seeded = DemoDataSeederProbe.AttachedConnections();

        seeded.Count.ShouldBe(SeededConnections.Count);

        foreach (var connection in SeededConnections.All)
        {
            var match = seeded.SingleOrDefault(
                row => string.Equals(row.Ean, connection.Ean, StringComparison.Ordinal));

            match.ShouldNotBeNull(
                $"{connection.Ean} is transcribed in SeededConnections but DemoDataSeeder no longer "
                + "attaches it");

            match.CapacityKw.ShouldBe(connection.CapacityKw);

            // Unknown -> UNKNOWN, Never -> NEVER, Expected -> EXPECTED. No member of this enum has
            // two words in it, so upper-casing IS the database spelling here (contract §4) - and a
            // member that did would break this line loudly rather than quietly, which is right.
            match.ProductionExpectation.ToString().ToUpperInvariant()
                .ShouldBe(connection.ProductionExpectation);
        }
    }
}
```

⚠ **`DemoDataSeederProbe` does not exist yet and this test will not compile without it.** That is
step 2's failure, and step 4 is where it is written — as a tiny reflection helper in the test project,
**not** as a new public member on `DemoDataSeeder`, which is slice 1's file and not this plan's.

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~SeededConnectionsTests"
```

Expected: FAIL — build errors
`error CS0246: The type or namespace name 'SeededConnections' could not be found` **and**
`error CS0103: The name 'DemoDataSeederProbe' does not exist in the current context`.

- [ ] **Step 3: Write `SeededConnections`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/SeededConnections.cs`:

```csharp
namespace PeakPower.DevStubs;

/// <summary>
/// One demo connection, as much of it as the generator needs.
/// </summary>
/// <param name="ProductionExpectation">
/// The DATABASE spelling — <c>NEVER</c>, <c>UNKNOWN</c> or <c>EXPECTED</c> (contract §4) — carried as
/// text because <c>PeakPower.DevStubs</c> may not reference <c>PeakPower.Domain</c> (contract §3.1).
/// <c>SeededConnectionsTests</c> is what ties the text back to the enum, on the test project's side
/// of that boundary.
/// </param>
public sealed record SeededConnection(
    string Ean, string Name, decimal CapacityKw, string ProductionExpectation);

/// <summary>
/// The eleven metering points <c>PeakPower.Persistence.Seeding.DemoDataSeeder</c> attaches to the six
/// demo companies, transcribed.
/// </summary>
/// <remarks>
/// <para>
/// Transcribed rather than read, because this project cannot see the database or
/// <c>PeakPower.Persistence</c> — and because <c>[F02-R30]</c> means it never should: the only route
/// from here to a reading is a POST to the real webhook.
/// </para>
/// <para>
/// ⚠ <b>A transcription nothing checks is a copy that silently goes stale.</b>
/// <c>SeededConnectionsTests.The_transcription_still_matches_the_seeder</c> compares this list with
/// the seeder's own, in a test project that can see both. If it is red, the seeder changed and this
/// list has not; the seeder is the source and this is the copy.
/// </para>
/// <para>
/// ⚠ <b>None of these EANs carries a valid GS1 check digit</b> — <c>[DEC-114]</c> relaxed validation
/// to eighteen digits and <c>[OQ-97]</c> is open (design §8, last row). They are transcribed as they
/// are. Do not "correct" one: ingestion keys on EAN, and a corrected digit here is a connection the
/// customer's portal cannot find.
/// </para>
/// </remarks>
public static class SeededConnections
{
    /// <summary>Eleven. Design §3.1 and contract §13.2 both say so, and the guard test pins it.</summary>
    public const int Count = 11;

    /// <summary>
    /// In the seeder's own order, so a reader comparing the two files reads down both at once.
    /// Source: <c>src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs:214-284</c>.
    /// </summary>
    public static IReadOnlyList<SeededConnection> All { get; } =
    [
        // Vandersteen Koeling B.V. - six connections
        new("871687100000000011", "Rotterdam DC", 4200m, "NEVER"),
        new("871687100000000027", "Venlo cold store", 2500m, "NEVER"),
        new("871687100000000043", "Tilburg plant", 3800m, "NEVER"),
        new("871687100000000059", "Almere office", 800m, "EXPECTED"),
        // Deliberately unnamed in the seeder - it is the row that proves [F01-R31]'s grouped-EAN
        // fallback. It has a name HERE because a log line saying which connection is being posted
        // for is worth more than a faithful null.
        new("871687100000000061", "Croy (unnamed)", 1200m, "UNKNOWN"),
        new("871687100000000078", "Breda warehouse", 1600m, "NEVER"),

        // Kramer Logistics B.V.
        new("871687100000000085", "Venlo hub", 2900m, "NEVER"),

        // Van Dijk Glastuinbouw
        new("871687100000000093", "Kas 4", 5400m, "EXPECTED"),

        // Meijer Koelhuizen
        new("871687100000000106", "Koelhuis Barendrecht", 3100m, "NEVER"),

        // Hoekstra Staal B.V.
        new("871687100000000338", "Walserij", 6200m, "NEVER"),

        // De Groot Papier
        new("871687100000000346", "Papierfabriek", 4800m, "EXPECTED"),
    ];

    /// <summary>
    /// The three recorded <c>EXPECTED</c>. These are the ones that get an A01 series as well as an
    /// A02, which is what <c>both-directions</c> and <c>production-exceeds-consumption</c> need.
    /// </summary>
    public static IReadOnlyList<SeededConnection> Producing { get; } =
        [.. All.Where(connection =>
            string.Equals(connection.ProductionExpectation, "EXPECTED", StringComparison.Ordinal))];

    /// <summary>
    /// The eight recorded <c>NEVER</c>. <c>[DEC-65]</c>: PVNed sends <b>no A01 series at all</b> for
    /// these — absent, not present-and-zero — which is what <c>no-production-series</c> posts.
    /// </summary>
    /// <remarks>
    /// ⚠ The <c>UNKNOWN</c> connection is in neither list, and that is deliberate. <c>[F02-R32]</c>:
    /// <c>UNKNOWN</c> reads as <c>EXPECTED</c> for completeness, because the conservative failure is
    /// a false alarm rather than a hidden gap — but it is not a declared zero either, so it belongs
    /// in neither "send production" nor "declared zero".
    /// </remarks>
    public static IReadOnlyList<SeededConnection> NeverProduces { get; } =
        [.. All.Where(connection =>
            string.Equals(connection.ProductionExpectation, "NEVER", StringComparison.Ordinal))];

    /// <summary>
    /// One connection by EAN.
    /// </summary>
    /// <exception cref="KeyNotFoundException">
    /// No such connection. Deliberately not a default: a default would give the backfill a plausible
    /// capacity for a connection that does not exist, and ninety days of documents would quarantine
    /// as <c>UNKNOWN_EAN</c> before anybody noticed.
    /// </exception>
    public static SeededConnection ByEan(string ean) =>
        All.SingleOrDefault(connection => string.Equals(connection.Ean, ean, StringComparison.Ordinal))
        ?? throw new KeyNotFoundException(
            $"{ean} is not one of the {Count} seeded demo connections.");
}
```

- [ ] **Step 4: Write the probe that reads the seeder's own list**

`DemoDataSeeder`'s roster is a `private static readonly` field of a private record type, and this plan
does **not** own that file — slice 1 does, and making the roster public to satisfy a test would be a
production change made for a test's convenience. Read it by reflection instead, in the test project.

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/DemoDataSeederProbe.cs`:

```csharp
using System.Reflection;
using PeakPower.Domain.Customers;
using PeakPower.Persistence.Seeding;

namespace PeakPower.Application.Tests.DevStubs;

/// <summary>
/// Reads <c>DemoDataSeeder</c>'s own connection roster, so the transcription in
/// <c>PeakPower.DevStubs.SeededConnections</c> can be compared with it.
/// </summary>
/// <remarks>
/// <para>
/// Reflection, deliberately. The roster is a private static field of a private nested record, and
/// this plan does not own <c>DemoDataSeeder.cs</c> — slice 1 does. Widening a production type's
/// visibility so a test can read it is a production change made for a test's convenience, and the
/// alternative here costs eight lines.
/// </para>
/// <para>
/// ⚠ <b>If this throws, the seeder's shape changed</b> — a renamed field or a restructured roster.
/// That is a real signal and not a flaky test: fix the probe, and while you are in there check
/// whether the eleven connections changed too.
/// </para>
/// </remarks>
public static class DemoDataSeederProbe
{
    public sealed record Row(string Ean, decimal CapacityKw, ProductionExpectation ProductionExpectation);

    public static IReadOnlyList<Row> AttachedConnections()
    {
        var companiesField =
            typeof(DemoDataSeeder).GetField("Companies", BindingFlags.NonPublic | BindingFlags.Static)
            ?? throw new InvalidOperationException(
                "DemoDataSeeder no longer has a private static Companies field. The roster moved; "
                + "fix this probe, then check whether the eleven connections moved with it.");

        var companies = (System.Collections.IEnumerable)companiesField.GetValue(null)!;

        var rows = new List<Row>();

        foreach (var company in companies)
        {
            var connections = (System.Collections.IEnumerable)Property(company, "Connections")!;

            foreach (var connection in connections)
            {
                rows.Add(new Row(
                    (string)Property(connection, "Ean")!,
                    (decimal)Property(connection, "CapacityKw")!,
                    (ProductionExpectation)Property(connection, "Expectation")!));
            }
        }

        return rows;
    }

    private static object Property(object instance, string name) =>
        instance.GetType()
            .GetProperty(name, BindingFlags.Public | BindingFlags.Instance)
            ?.GetValue(instance)
        ?? throw new InvalidOperationException(
            $"DemoDataSeeder's connection record no longer has a {name} property.");
}
```

The field name is exact, read today:
`src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs:203` declares
`private static readonly IReadOnlyList<Company> Companies =`, and the connection record at `:55-58`
declares `Ean`, `CapacityKw` and `Expectation` in that spelling. (`:305` declares a second
`private static readonly IReadOnlyList<PoolRow> Pool` — the twenty **unclaimed** pool rows, which
are not attached to a company and are **not** part of the eleven.)

⚠ **`PeakPower.Application.Tests` must reference `PeakPower.Persistence`** for this file. It does not
today. Add it beside the `PeakPower.DevStubs` reference from task 13 step 1:

```xml
    <!-- Plan 5: DemoDataSeederProbe compares PeakPower.DevStubs' transcribed eleven connections
         with the seeder's own roster. The generator may not see Persistence (contract §3.1); a
         test project may, and this is the one place that is worth using. -->
    <ProjectReference Include="../../src/Infrastructure/PeakPower.Persistence/PeakPower.Persistence.csproj" />
```

- [ ] **Step 5: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~SeededConnectionsTests"
```

Expected: PASS — 7 tests.

- [ ] **Step 6: MUTATION — change one capacity and watch the guard name the connection**

Change `new("871687100000000093", "Kas 4", 5400m, "EXPECTED")` to `4400m`.

Predict: `The_transcription_still_matches_the_seeder` fails with
`match.CapacityKw should be 4400 but was 5400`, and `Rotterdam_dc_is_transcribed_exactly` stays green
— the guard catches a drift the hand-written spot check never would, which is the difference between
the two tests.

Run, confirm, restore.

- [ ] **Step 7: Second mutation — drop a connection from the transcription**

Delete the `871687100000000078` row.

Predict: **two** failures — `There_are_eleven` with `should be 11 but was 10`, and
`The_transcription_still_matches_the_seeder` with `seeded.Count should be 10 but was 11`. The second
is the one that would still fire if somebody had also updated the constant, which is why the count is
asserted against the seeder rather than against a literal in both places.

Run, confirm, restore.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~SeededConnectionsTests"
git add src/Hosts/PeakPower.DevStubs/SeededConnections.cs \
        tests/PeakPower.Application.Tests/DevStubs/SeededConnectionsTests.cs \
        tests/PeakPower.Application.Tests/DevStubs/DemoDataSeederProbe.cs \
        tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj
git commit -m "Transcribe the eleven demo connections, and guard the transcription

PeakPower.DevStubs cannot read the database and cannot reference PeakPower.Persistence
(contract 3.1), so it carries the roster as data - production_expectation included, as the
database spelling in a string, because it cannot see the enum either.

A transcription nothing checks is a copy that silently drifts, and the drift is quiet: a twelfth
demo connection appears on a customer's screen with no data and the backfill never knew it
existed. DemoDataSeederProbe reads the seeder's own private roster by reflection, from a test
project that can see both sides of the boundary the generator may not cross. Widening
DemoDataSeeder's visibility instead would have been a production change made for a test.

Verified by mutation: changing one capacity turns the guard red and leaves the hand-written spot
check green, and dropping a row fails the count against the SEEDER rather than against a literal
this file also owns."
```

---

### Task 18: `ScenarioCatalogue` — all fourteen of contract §13.1, by key, with the outcome each one expects

Contract §13.1 names fourteen scenarios and the **key** each carries *"so plans 5, 6 and 8 name them
identically"*. This task is that table, as code.

| # | Key | Documents | What the pipeline must do |
| --: | --- | --: | --- |
| 1 | `normal-day` | 1 | 200, applied, 96 readings |
| 2 | `daily-cadence` | 14 | 200 each — one A02 per connection, plus an A01 for each of the three producing ones `[DEC-38]` |
| 3 | `both-directions` | 2 | 200 each, and the day reaches complete |
| 4 | `no-production-series` | 1 | 200; the `NEVER` connection's day reaches complete on A02 alone `[F02-R32]` |
| 5 | `production-exceeds-consumption` | 2 | 200; `net_usage_kwh` negative in some intervals, `export_kwh` > 0 |
| 6 | `missing-production-series` | 1 | 200; the `EXPECTED` connection stays `PARTIAL` and an alert is raised |
| 7 | `dst-spring-92` | 1 | 200, 92 readings |
| 8 | `dst-autumn-100` | 1 | 200, 100 readings |
| 9 | `correction-supersedes` | 2 | 200 each; two versions, the second current |
| 10 | `out-of-order-pair` | 2 | 200 each; the **earlier-created, later-received** version is current (§4.2) |
| 11 | `post-window-reconciliation` | 1 | 200; a `FINAL` date returns to `PROVISIONAL` `[F02-R45]` |
| 12 | `unknown-ean` | 1 | 200, `PROCESSED`, one `quarantined_series` row reading `UNKNOWN_EAN` |
| 13 | `wrong-brp` | 1 | 200, `PROCESSED`, one `quarantined_series` row reading `WRONG_BRP` |
| 14 | `invalid-<code>` | 13 | eleven `FAILED` with the named code and **zero** readings, plus `size-25mb` (200) and `size-26mb` (413) |

⚠ **Eleven codes, not thirteen.** Contract §8.4 lists thirteen, but two of them —
`UNKNOWN_METERING_POINT` and `WRONG_BRP_FOR_METERING_POINT` — are marked *"quarantine, not reject"*
and are **the pipeline's decision, not the adapter's** (contract §7.1: no adapter may read
`customer.metering_point`). They are scenarios **12** and **13** above, under their pipeline names.
Generating an `invalid-UNKNOWN_METERING_POINT` document as well would be the same document twice
under two names, and the second one would fail an assertion that expects `FAILED` on a message that
correctly reaches `PROCESSED`.

⚠ **`size-25mb` and `size-26mb` are the exact byte counts, not "about 25 MB".** Contract §9.4:
**26 214 400 is accepted and 26 214 401 is refused.** The keys keep contract §13.1's spellings; the
numbers are the contract's.

⚠ **The catalogue produces `DocumentSpec`s and edits, and posts nothing.** Task 20's `ScenarioRunner`
renders and posts. That split is what lets every assertion in this task run with no HTTP and no
container.

⚠ **Two of the eleven invalid documents need a text edit rather than a spec field.** `DocumentSpec`'s
member list is frozen by plan 8 task 3, and two rules cannot be expressed through it:
`INVALID_MEASUREMENT_PERIOD` (the period must span two days) and `INVALID_POSITIONS` (a `Pos` must
repeat). Both are done as an ordinal find-and-replace on the **rendered text** — which is not a
workaround but the honest shape: S2-D4 makes the artefact text, and a deliberately corrupt document is
corrupt text.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/ScenarioCatalogue.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/ScenarioCatalogueTests.cs`

**Interfaces:**
- Consumes: `SeededConnections` (task 17), `LoadShape` (task 15), `AmsterdamDay` (task 14),
  `DocumentSpec` (task 16), `DevStubsOptions` (task 13).
- Produces:
  - `PeakPower.DevStubs.RenderedEdit(string Find, string Replace)`
  - `PeakPower.DevStubs.ScenarioDocument(string Family, string ScenarioKey, DocumentSpec Spec, IReadOnlyList<RenderedEdit> Edits, int? PadToBytes, int ExpectedStatusCode, string? ExpectedFailureCode, string? ExpectedQuarantineReason, string Note)`
  - `PeakPower.DevStubs.ScenarioContext(DateOnly Today, string SenderGln, string ReceiverGln, string UnknownEan, string WrongBrpEan)` with `ScenarioContext.From(DateOnly today, DevStubsOptions options)`
  - `PeakPower.DevStubs.ScenarioCatalogue.Keys` — `public static IReadOnlyList<string>`, fourteen
  - `ScenarioCatalogue.AdapterFailureCodes` — `public static IReadOnlyList<string>`, eleven
  - `ScenarioCatalogue.ProcessType` — `public const string`, `"A05"`
  - `ScenarioCatalogue.SizeAccepted = 26_214_400` and `.SizeRefused = 26_214_401`
  - `ScenarioCatalogue.For(string family, ScenarioContext context)` — `public static IReadOnlyList<ScenarioDocument>`
  - `ScenarioCatalogue.All(ScenarioContext context)` — `public static IReadOnlyList<ScenarioDocument>`
  - `ScenarioCatalogue.SpringForwardOnOrBefore(DateOnly)` / `.FallBackOnOrBefore(DateOnly)` — `public static DateOnly`

⚠ **`ProcessType` is one constant in one place, and it is a guess.** Contract §8.4 rule 1 is
*"`DocumentType`/`ProcessType` is a handled combination"* and **plan 4 decides which combination**.
Integration-spec §3 allows `A05 | A06 | A14 | A16 | A24` and its only sample is an `A12` imbalance
document carrying `A06`; nothing in the specification pins the pair for an `A23` allocation. `A05` is
the value here. **If plan 4's handled set does not contain `A23`/`A05`, this constant is the single
line to change** — and `invalid-UNSUPPORTED_DOCUMENT_TYPE` is what proves the pair is checked at all
rather than waved through.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/ScenarioCatalogueTests.cs`:

```csharp
using PeakPower.DevStubs;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.DevStubs;

/// <summary>
/// Contract §13.1's fourteen scenarios, by the key each one carries so plans 5, 6 and 8 name them
/// identically.
/// </summary>
public sealed class ScenarioCatalogueTests
{
    private static readonly ScenarioContext Context =
        ScenarioContext.From(new DateOnly(2026, 9, 7), new DevStubsOptions());

    /// <summary>
    /// The keys, verbatim from contract §13.1's table. ⚠ Written out here rather than read from the
    /// catalogue, because a test that asked the catalogue for its own key list would agree with any
    /// spelling — including one plan 6's employee screen and plan 8's load test cannot find.
    /// </summary>
    [Fact]
    public void The_fourteen_keys_are_the_contract_s_own_spellings()
    {
        ScenarioCatalogue.Keys.ShouldBe(
        [
            "normal-day",
            "daily-cadence",
            "both-directions",
            "no-production-series",
            "production-exceeds-consumption",
            "missing-production-series",
            "dst-spring-92",
            "dst-autumn-100",
            "correction-supersedes",
            "out-of-order-pair",
            "post-window-reconciliation",
            "unknown-ean",
            "wrong-brp",
            "invalid-<code>",
        ]);
    }

    /// <summary>
    /// ⚠ ELEVEN, not thirteen. Contract §8.4 lists thirteen codes, but <c>UNKNOWN_METERING_POINT</c>
    /// and <c>WRONG_BRP_FOR_METERING_POINT</c> are marked "quarantine, not reject" and are decided by
    /// the PIPELINE, not the adapter (contract §7.1) — they are the <c>unknown-ean</c> and
    /// <c>wrong-brp</c> scenarios, under their pipeline names. Generating them here as well would be
    /// the same document twice, and the second copy would assert FAILED on a message that correctly
    /// reaches PROCESSED.
    /// </summary>
    [Fact]
    public void The_eleven_adapter_codes_are_the_nine_reject_rules_plus_the_two_the_contract_adds()
    {
        ScenarioCatalogue.AdapterFailureCodes.ShouldBe(
        [
            "UNSUPPORTED_DOCUMENT_TYPE",
            "WRONG_RECEIVER",
            "UNKNOWN_SENDER",
            "UNSUPPORTED_RESOLUTION",
            "UNSUPPORTED_CURVE_TYPE",
            "INVALID_MEASUREMENT_PERIOD",
            "INCOMPLETE_PERIOD",
            "INVALID_POSITIONS",
            "NEGATIVE_QUANTITY",
            "UNSUPPORTED_DIRECTION",
            "UNSUPPORTED_MEASUREMENT_UNIT",
        ]);

        ScenarioCatalogue.AdapterFailureCodes.ShouldNotContain("UNKNOWN_METERING_POINT");
        ScenarioCatalogue.AdapterFailureCodes.ShouldNotContain("WRONG_BRP_FOR_METERING_POINT");
    }

    [Fact]
    public void Every_family_produces_at_least_one_document_and_no_key_repeats()
    {
        var documents = ScenarioCatalogue.All(Context);

        foreach (var family in ScenarioCatalogue.Keys)
        {
            documents.ShouldContain(document => document.Family == family);
        }

        // Every document id in a run is distinct. Two byte-identical payloads in one run would be
        // swallowed by contract §9.4's 24-hour dedupe, and every count assertion downstream would
        // quietly be one short.
        documents
            .Select(document => document.Spec.DocumentId)
            .Distinct(StringComparer.Ordinal)
            .Count()
            .ShouldBe(documents.Count);

        // The invalid family's thirteen documents share a family and must not share a KEY, or the
        // runner's report has thirteen lines all saying "invalid-<code>". The other thirteen
        // families deliberately reuse their family key across their documents - daily-cadence posts
        // fourteen documents and is one scenario.
        var invalidKeys = documents
            .Where(document => document.Family == "invalid-<code>")
            .Select(document => document.ScenarioKey)
            .ToArray();

        invalidKeys.Distinct(StringComparer.Ordinal).Count().ShouldBe(invalidKeys.Length);
    }

    [Fact]
    public void The_invalid_family_is_eleven_codes_and_the_two_size_boundaries()
    {
        var invalid = ScenarioCatalogue.For("invalid-<code>", Context);

        invalid.Count.ShouldBe(13);

        foreach (var code in ScenarioCatalogue.AdapterFailureCodes)
        {
            var document = invalid.Single(
                candidate => candidate.ScenarioKey == $"invalid-{code}");

            // 200, always. [F02-R05]: once the payload is stored, no PROCESSING failure may produce
            // a non-2xx. A rejected document still gets a 200 and lands FAILED.
            document.ExpectedStatusCode.ShouldBe(200);
            document.ExpectedFailureCode.ShouldBe(code);
        }

        invalid.Select(document => document.ScenarioKey).ShouldContain("size-25mb");
        invalid.Select(document => document.ScenarioKey).ShouldContain("size-26mb");
    }

    /// <summary>
    /// Contract §9.4, both sides of the boundary: 26 214 400 is ACCEPTED and 26 214 401 is REFUSED.
    /// Design §7.3 pins both, and "about 25 MB" would test neither.
    /// </summary>
    [Fact]
    public void The_two_size_documents_sit_on_either_side_of_the_exact_byte_limit()
    {
        var invalid = ScenarioCatalogue.For("invalid-<code>", Context);

        var accepted = invalid.Single(document => document.ScenarioKey == "size-25mb");
        var refused = invalid.Single(document => document.ScenarioKey == "size-26mb");

        accepted.PadToBytes.ShouldBe(26_214_400);
        accepted.ExpectedStatusCode.ShouldBe(200);
        accepted.ExpectedFailureCode.ShouldBeNull();

        refused.PadToBytes.ShouldBe(26_214_401);
        refused.ExpectedStatusCode.ShouldBe(413);

        (refused.PadToBytes - accepted.PadToBytes).ShouldBe(1);
    }

    /// <summary>
    /// <c>[DEC-38]</c>: one document per EAN per day. Eleven connections, plus an A01 for each of the
    /// three recorded EXPECTED, is fourteen documents for one delivery date.
    /// </summary>
    [Fact]
    public void The_daily_cadence_is_one_document_per_ean_plus_production_where_there_is_any()
    {
        var cadence = ScenarioCatalogue.For("daily-cadence", Context);

        cadence.Count.ShouldBe(SeededConnections.Count + SeededConnections.Producing.Count);
        cadence.Count(document => document.Spec.Direction == "A02").ShouldBe(11);
        cadence.Count(document => document.Spec.Direction == "A01").ShouldBe(3);

        cadence.Select(document => document.Spec.DeliveryDate).Distinct().Count().ShouldBe(1);
    }

    /// <summary>
    /// ⚠ <c>[DEC-65]</c>: PVNed sends <b>no A01 series at all</b> for a connection that never
    /// produces — absent, not present-and-zero. A document full of zeros would be a different claim,
    /// and it would let a completeness check written as "both directions present" pass.
    /// </summary>
    [Fact]
    public void A_never_producing_connection_gets_no_production_document_at_all()
    {
        var scenario = ScenarioCatalogue.For("no-production-series", Context);

        scenario.ShouldAllBe(document => document.Spec.Direction == "A02");

        var connection = SeededConnections.ByEan(scenario[0].Spec.ResourceObject);
        connection.ProductionExpectation.ShouldBe("NEVER");
    }

    /// <summary>
    /// The two scenarios that are byte-identical on the wire and mean opposite things
    /// (integration-spec §4.1.1). The ONLY difference is which connection they name, which is why the
    /// discriminator has to be master data.
    /// </summary>
    [Fact]
    public void The_missing_production_series_differs_from_the_declared_zero_only_by_connection()
    {
        var declaredZero = ScenarioCatalogue.For("no-production-series", Context).Single();
        var missing = ScenarioCatalogue.For("missing-production-series", Context).Single();

        missing.Spec.Direction.ShouldBe(declaredZero.Spec.Direction);
        missing.Spec.Quantities.Count.ShouldBe(declaredZero.Spec.Quantities.Count);

        SeededConnections.ByEan(missing.Spec.ResourceObject)
            .ProductionExpectation.ShouldBe("EXPECTED");
    }

    [Fact]
    public void The_two_dst_days_carry_the_point_counts_their_dates_require()
    {
        var spring = ScenarioCatalogue.For("dst-spring-92", Context).Single();
        var autumn = ScenarioCatalogue.For("dst-autumn-100", Context).Single();

        spring.Spec.Quantities.Count.ShouldBe(92);
        AmsterdamDay.IntervalCount(spring.Spec.DeliveryDate).ShouldBe(92);

        autumn.Spec.Quantities.Count.ShouldBe(100);
        AmsterdamDay.IntervalCount(autumn.Spec.DeliveryDate).ShouldBe(100);
    }

    /// <summary>
    /// Both transition dates are in the PAST relative to the context's today. A delivery date in the
    /// future would be a document about a day that has not happened, which the pipeline has no reason
    /// to accept and no rule against — the worst kind of test input.
    /// </summary>
    [Theory]
    [InlineData(2026, 9, 7)]
    [InlineData(2026, 1, 15)]
    [InlineData(2026, 10, 26)]
    public void The_dst_dates_are_always_behind_the_run_date(int year, int month, int day)
    {
        var today = new DateOnly(year, month, day);

        ScenarioCatalogue.SpringForwardOnOrBefore(today).ShouldBeLessThanOrEqualTo(today);
        ScenarioCatalogue.FallBackOnOrBefore(today).ShouldBeLessThanOrEqualTo(today);

        AmsterdamDay.IntervalCount(ScenarioCatalogue.SpringForwardOnOrBefore(today)).ShouldBe(92);
        AmsterdamDay.IntervalCount(ScenarioCatalogue.FallBackOnOrBefore(today)).ShouldBe(100);
    }

    /// <summary>
    /// §4.2: the current version is the last one RECEIVED, never the newest by
    /// <c>CreatedDateTime</c>. The scenario is built by putting the LATER-created document FIRST in
    /// the list, so a runner that posts in order posts them out of created-order.
    /// </summary>
    [Fact]
    public void The_out_of_order_pair_is_ordered_later_created_first()
    {
        var pair = ScenarioCatalogue.For("out-of-order-pair", Context);

        pair.Count.ShouldBe(2);
        pair[0].Spec.DocumentCreated.ShouldBeGreaterThan(pair[1].Spec.DocumentCreated);

        // Same (EAN, date, direction) - otherwise they do not compete for currency at all.
        pair[0].Spec.ResourceObject.ShouldBe(pair[1].Spec.ResourceObject);
        pair[0].Spec.DeliveryDate.ShouldBe(pair[1].Spec.DeliveryDate);
        pair[0].Spec.Direction.ShouldBe(pair[1].Spec.Direction);

        // And different documents, or supersession has nothing to supersede.
        pair[0].Spec.DocumentId.ShouldNotBe(pair[1].Spec.DocumentId);
    }

    [Fact]
    public void The_correction_pair_is_ordered_earlier_created_first()
    {
        var pair = ScenarioCatalogue.For("correction-supersedes", Context);

        pair.Count.ShouldBe(2);
        pair[0].Spec.DocumentCreated.ShouldBeLessThan(pair[1].Spec.DocumentCreated);
        pair[0].Spec.DocumentId.ShouldNotBe(pair[1].Spec.DocumentId);

        // Different quantities, or "the second is current" is unobservable in the readings.
        pair[0].Spec.Quantities.ShouldNotBe(pair[1].Spec.Quantities);
    }

    /// <summary>
    /// <c>[DEC-98]</c> and <c>[F02-R45]</c>: a correction landing after the ten-working-day window
    /// reopens a FINAL date. Fourteen calendar days is the minimum span of ten weekdays, so this has
    /// to be comfortably beyond it or the scenario silently becomes an ordinary correction.
    /// </summary>
    [Fact]
    public void The_post_window_reconciliation_is_well_past_the_ten_working_day_window()
    {
        var document = ScenarioCatalogue.For("post-window-reconciliation", Context).Single();

        (Context.Today.DayNumber - document.Spec.DeliveryDate.DayNumber)
            .ShouldBeGreaterThan(30);
    }

    [Fact]
    public void The_two_quarantine_scenarios_expect_a_two_hundred_and_a_reason_rather_than_a_code()
    {
        var unknown = ScenarioCatalogue.For("unknown-ean", Context).Single();
        var wrongBrp = ScenarioCatalogue.For("wrong-brp", Context).Single();

        // Quarantine is a STORAGE state with a replay path, not a parse outcome (contract §8.5): the
        // message reaches PROCESSED and the series lands in quarantined_series.
        unknown.ExpectedStatusCode.ShouldBe(200);
        unknown.ExpectedFailureCode.ShouldBeNull();
        unknown.ExpectedQuarantineReason.ShouldBe("UNKNOWN_EAN");

        wrongBrp.ExpectedStatusCode.ShouldBe(200);
        wrongBrp.ExpectedFailureCode.ShouldBeNull();
        wrongBrp.ExpectedQuarantineReason.ShouldBe("WRONG_BRP");

        // Eighteen digits, so the adapter offers it to the resolver at all. [F02-R11]/[AS-17]:
        // anything else is a descriptive label and is never resolved - which would make this
        // scenario silently test nothing.
        unknown.Spec.ResourceObject.Length.ShouldBe(18);
    }

    /// <summary>
    /// Every valid document names a connection that <c>DemoDataSeeder</c> actually attaches. The two
    /// quarantine scenarios are the deliberate exceptions, and they are excluded by name rather than
    /// by a filter that would also hide a typo.
    /// </summary>
    [Fact]
    public void Every_applying_document_names_a_seeded_connection()
    {
        foreach (var document in ScenarioCatalogue.All(Context))
        {
            if (document.Family is "unknown-ean" or "wrong-brp")
            {
                continue;
            }

            Should.NotThrow(() => SeededConnections.ByEan(document.Spec.ResourceObject));
        }
    }

    /// <summary>
    /// Two of the eleven invalid documents cannot be expressed through <c>DocumentSpec</c>, whose
    /// member list plan 8 task 3 froze, so they carry a text edit instead. Nine carry none — and a
    /// tenth appearing is a sign somebody reached for an edit where a field would have done.
    /// </summary>
    [Fact]
    public void Only_the_two_rules_that_need_a_text_edit_have_one()
    {
        var edited = ScenarioCatalogue.All(Context)
            .Where(document => document.Edits.Count > 0)
            .Select(document => document.ScenarioKey)
            .Order(StringComparer.Ordinal)
            .ToArray();

        edited.ShouldBe(["invalid-INVALID_MEASUREMENT_PERIOD", "invalid-INVALID_POSITIONS"]);
    }

    [Fact]
    public void An_unknown_family_throws_rather_than_returning_nothing()
    {
        // An empty list would make `devstubs scenarios --only typo` a silent no-op that reports
        // success, which is the shape of an evening lost to a mistyped key.
        Should.Throw<KeyNotFoundException>(() => ScenarioCatalogue.For("normal_day", Context));
    }

    [Fact]
    public void Every_document_carries_the_configured_glns_and_the_one_process_type()
    {
        foreach (var document in ScenarioCatalogue.All(Context))
        {
            if (document.ScenarioKey is "invalid-WRONG_RECEIVER")
            {
                document.Spec.ReceiverGln.ShouldNotBe(Context.ReceiverGln);
                continue;
            }

            if (document.ScenarioKey is "invalid-UNKNOWN_SENDER")
            {
                document.Spec.SenderGln.ShouldNotBe(Context.SenderGln);
                continue;
            }

            document.Spec.SenderGln.ShouldBe(Context.SenderGln);
            document.Spec.ReceiverGln.ShouldBe(Context.ReceiverGln);
            document.Spec.ProcessType.ShouldBe(ScenarioCatalogue.ProcessType);
        }
    }

    [Fact]
    public void The_catalogue_is_deterministic()
    {
        // Same context, same documents, same document ids - which is what makes a second
        // `devstubs scenarios` run reproduce the DUPLICATE case rather than a fresh RECEIVED.
        ScenarioCatalogue.All(Context)
            .Select(document => document.Spec.DocumentId)
            .ShouldBe(ScenarioCatalogue.All(Context).Select(document => document.Spec.DocumentId));
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~ScenarioCatalogueTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'ScenarioContext' could not be found`.

- [ ] **Step 3: Write `ScenarioCatalogue`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/ScenarioCatalogue.cs`:

```csharp
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace PeakPower.DevStubs;

/// <summary>
/// An ordinal find-and-replace applied to a RENDERED document.
/// </summary>
/// <remarks>
/// Two of contract §8.4's eleven adapter rules cannot be expressed through <see cref="DocumentSpec"/>,
/// whose member list plan 8 task 3 froze: <c>INVALID_MEASUREMENT_PERIOD</c> needs a period spanning
/// two days and <c>INVALID_POSITIONS</c> needs a repeated <c>Pos</c>. Editing the text is not a
/// workaround — S2-D4 makes the artefact text, and a deliberately corrupt document is corrupt text.
/// </remarks>
public sealed record RenderedEdit(string Find, string Replace);

/// <summary>One document a scenario posts, and what the pipeline is expected to do with it.</summary>
/// <param name="Family">The contract §13.1 key. Several documents can share one.</param>
/// <param name="ScenarioKey">
/// The specific key. Equal to <paramref name="Family"/> for thirteen of the fourteen; for
/// <c>invalid-&lt;code&gt;</c> it is <c>invalid-NEGATIVE_QUANTITY</c>, <c>size-25mb</c> and so on.
/// </param>
/// <param name="PadToBytes">
/// Grow the rendered document to exactly this many UTF-8 bytes before posting. Only the two size
/// scenarios use it, and contract §9.4 pins both numbers.
/// </param>
/// <param name="ExpectedStatusCode">
/// ⚠ <b>200 for everything except <c>size-26mb</c>.</b> <c>[F02-R05]</c>: once the payload is stored,
/// no processing failure may produce a non-2xx — a rejected document still gets a 200 and lands
/// <c>FAILED</c>. Only the size limit answers before the payload is stored, and it answers 413.
/// </param>
/// <param name="ExpectedFailureCode">
/// The contract §8.4 code on <c>inbound_message.failure_code</c>, or <c>null</c> when the document is
/// expected to apply or to quarantine.
/// </param>
/// <param name="ExpectedQuarantineReason">
/// The contract §8.5 reason on the <c>quarantined_series</c> row, or <c>null</c>. ⚠ Never set
/// together with <paramref name="ExpectedFailureCode"/>: a quarantined message reaches
/// <c>PROCESSED</c> and a failed one reaches <c>FAILED</c>, and they are different outcomes.
/// </param>
public sealed record ScenarioDocument(
    string Family,
    string ScenarioKey,
    DocumentSpec Spec,
    IReadOnlyList<RenderedEdit> Edits,
    int? PadToBytes,
    int ExpectedStatusCode,
    string? ExpectedFailureCode,
    string? ExpectedQuarantineReason,
    string Note);

/// <summary>What the catalogue needs to know about the world it is generating for.</summary>
/// <param name="Today">
/// The run date. Delivery dates are chosen relative to it, so a scenario run in January and one run
/// in September both post about days that have happened.
/// </param>
/// <param name="UnknownEan">
/// Eighteen digits, registered nowhere. ⚠ It has to be eighteen digits or the adapter treats it as a
/// descriptive label and never offers it to the resolver (<c>[F02-R11]</c>/<c>[AS-17]</c>) — and the
/// <c>unknown-ean</c> scenario would silently test nothing.
/// </param>
/// <param name="WrongBrpEan">
/// A registered metering point assigned to a DIFFERENT BRP row. The fixture arranges it; the
/// catalogue only needs the number.
/// </param>
public sealed record ScenarioContext(
    DateOnly Today,
    string SenderGln,
    string ReceiverGln,
    string UnknownEan,
    string WrongBrpEan)
{
    /// <summary>
    /// The default context. The two EANs are outside <c>DemoDataSeeder</c>'s ranges — its attached
    /// connections end <c>…0011</c> to <c>…0346</c> and its unclaimed pool runs <c>…0114</c> to
    /// <c>…0320</c> — so neither can collide with a seeded row.
    /// </summary>
    public static ScenarioContext From(DateOnly today, DevStubsOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        return new ScenarioContext(
            today,
            options.SenderGln,
            options.ReceiverGln,
            UnknownEan: "871687109900000001",
            WrongBrpEan: "871687109900000002");
    }
}

/// <summary>
/// Contract §13.1's fourteen scenarios, as data.
/// </summary>
/// <remarks>
/// <para>
/// <b>This produces specs and posts nothing.</b> <see cref="ScenarioRunner"/> renders and posts, and
/// the split is what lets every assertion about the catalogue run with no HTTP and no container.
/// </para>
/// <para>
/// ⚠ <b>Eleven adapter codes, not thirteen.</b> Contract §8.4's <c>UNKNOWN_METERING_POINT</c> and
/// <c>WRONG_BRP_FOR_METERING_POINT</c> are marked "quarantine, not reject" and are the pipeline's
/// decision rather than the adapter's (contract §7.1). They are the <c>unknown-ean</c> and
/// <c>wrong-brp</c> scenarios under their pipeline names, and generating them here as well would be
/// the same document twice with contradictory expectations.
/// </para>
/// </remarks>
public static class ScenarioCatalogue
{
    /// <summary>
    /// ⚠ <b>A guess, and the single line to change if plan 4 disagrees.</b> Contract §8.4 rule 1 is
    /// "DocumentType/ProcessType is a handled combination", and plan 4 decides which. Integration-spec
    /// §3 allows <c>A05 | A06 | A14 | A16 | A24</c> and its only sample is an <c>A12</c> imbalance
    /// document carrying <c>A06</c>; nothing pins the pair for an <c>A23</c> allocation.
    /// <c>invalid-UNSUPPORTED_DOCUMENT_TYPE</c> is what proves the pair is checked at all.
    /// </summary>
    public const string ProcessType = "A05";

    /// <summary>Contract §9.4: exactly this many bytes is ACCEPTED.</summary>
    public const int SizeAccepted = 26_214_400;

    /// <summary>Contract §9.4: one byte more is REFUSED with 413.</summary>
    public const int SizeRefused = 26_214_401;

    /// <summary>The fourteen family keys, in contract §13.1's own order and spelling.</summary>
    public static IReadOnlyList<string> Keys { get; } =
    [
        "normal-day",
        "daily-cadence",
        "both-directions",
        "no-production-series",
        "production-exceeds-consumption",
        "missing-production-series",
        "dst-spring-92",
        "dst-autumn-100",
        "correction-supersedes",
        "out-of-order-pair",
        "post-window-reconciliation",
        "unknown-ean",
        "wrong-brp",
        "invalid-<code>",
    ];

    /// <summary>
    /// The eleven codes the ADAPTER can raise: contract §8.4's nine reject rules, plus the two
    /// §16-item-4 codes the design requires and §8.2 has no row for.
    /// </summary>
    public static IReadOnlyList<string> AdapterFailureCodes { get; } =
    [
        "UNSUPPORTED_DOCUMENT_TYPE",
        "WRONG_RECEIVER",
        "UNKNOWN_SENDER",
        "UNSUPPORTED_RESOLUTION",
        "UNSUPPORTED_CURVE_TYPE",
        "INVALID_MEASUREMENT_PERIOD",
        "INCOMPLETE_PERIOD",
        "INVALID_POSITIONS",
        "NEGATIVE_QUANTITY",
        "UNSUPPORTED_DIRECTION",
        "UNSUPPORTED_MEASUREMENT_UNIT",
    ];

    /// <summary>Every document of every family, in <see cref="Keys"/> order.</summary>
    public static IReadOnlyList<ScenarioDocument> All(ScenarioContext context) =>
        [.. Keys.SelectMany(family => For(family, context))];

    /// <summary>One family's documents, in the order they must be POSTED.</summary>
    /// <exception cref="KeyNotFoundException">
    /// Not one of the fourteen. Deliberately not an empty list: <c>devstubs scenarios --only
    /// normal_day</c> would then be a silent no-op reporting success.
    /// </exception>
    public static IReadOnlyList<ScenarioDocument> For(string family, ScenarioContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        // Yesterday. Allocation data for day D legitimately arrives on D+1 (design §7.21's
        // reasoning), so this is the ordinary case rather than a convenience.
        var yesterday = context.Today.AddDays(-1);

        return family switch
        {
            "normal-day" =>
                [Consumption(family, family, SeededConnections.All[0], yesterday, context)],

            "daily-cadence" =>
            [
                .. SeededConnections.All.Select(connection =>
                    Consumption(family, family, connection, yesterday, context)),
                .. SeededConnections.Producing.Select(connection =>
                    Production(family, family, connection, yesterday, context)),
            ],

            "both-directions" =>
            [
                Consumption(family, family, SeededConnections.Producing[0], yesterday, context),
                Production(family, family, SeededConnections.Producing[0], yesterday, context),
            ],

            // [DEC-65]: no A01 series AT ALL for a connection that never produces. Absent, not
            // present-and-zero, because a document of zeros is a different claim - and because a
            // completeness check written as directions.Count == 2 would pass on one.
            "no-production-series" =>
                [Consumption(family, family, SeededConnections.NeverProduces[0], yesterday, context)],

            "production-exceeds-consumption" =>
            [
                Consumption(
                    family, family, SeededConnections.Producing[1], yesterday, context,
                    scale: 0.25m),
                Production(family, family, SeededConnections.Producing[1], yesterday, context),
            ],

            // Byte-identical on the wire to no-production-series. The ONLY difference is the
            // connection's production_expectation, which is master data - integration-spec §4.1.1.
            "missing-production-series" =>
                [Consumption(family, family, ExpectedButSilent(), yesterday, context)],

            "dst-spring-92" =>
            [
                Consumption(
                    family, family, SeededConnections.All[0],
                    SpringForwardOnOrBefore(context.Today), context),
            ],

            "dst-autumn-100" =>
            [
                Consumption(
                    family, family, SeededConnections.All[0],
                    FallBackOnOrBefore(context.Today), context),
            ],

            "correction-supersedes" => Correction(family, context, outOfOrder: false),

            // §4.2: the current version is the last one RECEIVED. Posting the LATER-created document
            // first is what makes that observable - under a CreatedDateTime rule the answers differ.
            "out-of-order-pair" => Correction(family, context, outOfOrder: true),

            "post-window-reconciliation" =>
            [
                Consumption(
                    family, family, SeededConnections.All[0],
                    context.Today.AddDays(-45), context, scale: 0.9m),
            ],

            "unknown-ean" =>
            [
                Consumption(
                    family, family,
                    new SeededConnection(context.UnknownEan, "unknown", 1000m, "UNKNOWN"),
                    yesterday, context)
                    with
                    {
                        ExpectedQuarantineReason = "UNKNOWN_EAN",
                        Note = "An eighteen-digit EAN registered nowhere. The message reaches "
                               + "PROCESSED and the series lands in quarantined_series - quarantine "
                               + "is a storage state with a replay path, not a parse outcome.",
                    },
            ],

            "wrong-brp" =>
            [
                Consumption(
                    family, family,
                    new SeededConnection(context.WrongBrpEan, "other BRP", 1000m, "UNKNOWN"),
                    yesterday, context)
                    with
                    {
                        ExpectedQuarantineReason = "WRONG_BRP",
                        Note = "A registered metering point assigned to a different BRP row. Decided "
                               + "against the assignment in force at RECEIPT time [F02-R43].",
                    },
            ],

            "invalid-<code>" => Invalid(family, yesterday, context),

            _ => throw new KeyNotFoundException(
                $"'{family}' is not one of the {Keys.Count} scenario keys contract §13.1 names. "
                + $"They are: {string.Join(", ", Keys)}."),
        };
    }

    /// <summary>
    /// The most recent spring-forward Sunday on or before <paramref name="today"/>. Found by asking
    /// <see cref="AmsterdamDay"/> rather than from a table, so it stays right when the rule changes.
    /// </summary>
    public static DateOnly SpringForwardOnOrBefore(DateOnly today) =>
        TransitionOnOrBefore(today, month: 3, intervalCount: 92);

    /// <summary>The most recent autumn fall-back Sunday on or before <paramref name="today"/>.</summary>
    public static DateOnly FallBackOnOrBefore(DateOnly today) =>
        TransitionOnOrBefore(today, month: 10, intervalCount: 100);

    private static DateOnly TransitionOnOrBefore(DateOnly today, int month, int intervalCount)
    {
        for (var year = today.Year; year >= today.Year - 2; year--)
        {
            var days = DateTime.DaysInMonth(year, month);

            for (var day = days; day >= 1; day--)
            {
                var candidate = new DateOnly(year, month, day);

                if (candidate <= today && AmsterdamDay.IntervalCount(candidate) == intervalCount)
                {
                    return candidate;
                }
            }
        }

        throw new InvalidOperationException(
            $"No {intervalCount}-interval day found in month {month} within two years of {today}. "
            + "Either the time-zone data is missing or the transition rule changed.");
    }

    /// <summary>
    /// A connection recorded EXPECTED, used for the scenario where the production series never
    /// arrives. Deliberately NOT the same connection as <c>both-directions</c> uses, so a run of the
    /// whole catalogue does not have one connection both producing and silently not producing on the
    /// same date.
    /// </summary>
    private static SeededConnection ExpectedButSilent() => SeededConnections.Producing[2];

    private static IReadOnlyList<ScenarioDocument> Correction(
        string family, ScenarioContext context, bool outOfOrder)
    {
        var connection = SeededConnections.All[0];
        var date = context.Today.AddDays(-3);

        // Ordinal 2 makes DocumentCreated an hour later than ordinal 1 (see Document below) and
        // gives the two a different DocumentId, so the pair differs by created time, by id and by
        // content - all three of which a supersession rule might key on, and only one of which is
        // correct.
        var first = Consumption(family, family, connection, date, context, ordinal: 1);
        var second = Consumption(family, family, connection, date, context, scale: 0.8m, ordinal: 2);

        // Returned in RECEIPT order. For out-of-order-pair the later-created document is posted
        // first, which is the whole of §4.2: the current version is the last one RECEIVED, and
        // swapping the comparison to CreatedDateTime order gives the other answer.
        return outOfOrder ? [second, first] : [first, second];
    }

    private static IReadOnlyList<ScenarioDocument> Invalid(
        string family, DateOnly date, ScenarioContext context)
    {
        var connection = SeededConnections.All[0];
        var count = AmsterdamDay.IntervalCount(date);

        // One local rather than eleven near-copies, and deliberately NOT a loop over
        // AdapterFailureCodes: each of the eleven breaks a DIFFERENT rule, and a loop with an
        // eleven-arm switch inside it is the same mapping hidden one level down. Written out, the
        // reviewer reads code and rule side by side.
        ScenarioDocument Coded(
            string code,
            Func<DocumentSpec, DocumentSpec>? change = null,
            IReadOnlyList<RenderedEdit>? edits = null)
        {
            var document = Consumption(family, $"invalid-{code}", connection, date, context);

            return document with
            {
                Spec = change is null ? document.Spec : change(document.Spec),
                Edits = edits ?? [],
                ExpectedFailureCode = code,
            };
        }

        return
        [
            Coded("UNSUPPORTED_DOCUMENT_TYPE", spec => spec with { DocumentType = "A26" }),

            Coded("WRONG_RECEIVER", spec => spec with { ReceiverGln = "8712400000009" }),

            Coded("UNKNOWN_SENDER", spec => spec with { SenderGln = "8714200000006" }),

            Coded("UNSUPPORTED_RESOLUTION", spec => spec with { Resolution = "PT60M" }),

            // Contract §8.3 row 9: the XSD enumerates only A01, so A03 is REJECTED rather than
            // tolerated. That is the one row of the nine where the permissive reading is "no".
            Coded("UNSUPPORTED_CURVE_TYPE", spec => spec with { CurveType = "A03" }),

            // Two days rather than one. Not expressible through DocumentSpec, whose members plan 8
            // froze, so the rendered EndPeriod is edited - contract §8.4 rule 6 wants a period that
            // is not exactly one Amsterdam calendar day.
            Coded(
                "INVALID_MEASUREMENT_PERIOD",
                edits:
                [
                    new RenderedEdit(
                        $"<EndPeriod>{AmsterdamDay.ToPvnedInstant(AmsterdamDay.EndUtc(date))}</EndPeriod>",
                        $"<EndPeriod>{AmsterdamDay.ToPvnedInstant(AmsterdamDay.EndUtc(date.AddDays(1)))}</EndPeriod>"),
                ]),

            // One point short. The COUNT is the rule (contract §8.4 rule 7), and it IS expressible
            // through DocumentSpec because Quantities.Count is what the template writes out.
            Coded(
                "INCOMPLETE_PERIOD",
                spec => spec with { Quantities = [.. spec.Quantities.Take(count - 1)] }),

            // Pos 2 written as a second Pos 1: contiguous from 1 with no duplicates is one rule, and
            // this breaks both halves of it with one edit.
            Coded("INVALID_POSITIONS", edits: [new RenderedEdit("<Pos>2</Pos>", "<Pos>1</Pos>")]),

            Coded(
                "NEGATIVE_QUANTITY",
                spec => spec with { Quantities = [-1.000m, .. spec.Quantities.Skip(1)] }),

            // A03 is "combined production and consumption", which the platform rejects because it
            // requires separated series [AS-05]. BusinessTypeFor maps A03 to A07 rather than to a
            // consumption code, so the document fails on Direction alone and not on two fields.
            Coded("UNSUPPORTED_DIRECTION", spec => spec with { Direction = "A03" }),

            // KWT is a POWER, not an energy, so it cannot become a quantity_kwh (contract §16
            // item 4). §8.2 has no row for it, which is why the contract adds one.
            Coded("UNSUPPORTED_MEASUREMENT_UNIT", spec => spec with { MeasurementUnit = "KWT" }),

            Consumption(family, "size-25mb", connection, date, context)
                with
                {
                    PadToBytes = SizeAccepted,
                    Note = "Exactly 26 214 400 bytes. Contract §9.4: ACCEPTED, at the boundary.",
                },

            Consumption(family, "size-26mb", connection, date, context)
                with
                {
                    PadToBytes = SizeRefused,
                    ExpectedStatusCode = 413,
                    Note = "26 214 401 bytes - one more. Contract §9.4: REFUSED, and refused BEFORE "
                           + "the payload is stored, which is why this is the only 413 in the "
                           + "catalogue.",
                },
        ];
    }

    private static ScenarioDocument Consumption(
        string family,
        string key,
        SeededConnection connection,
        DateOnly date,
        ScenarioContext context,
        decimal scale = 1m,
        int ordinal = 1) =>
        Document(family, key, connection, date, context, "A02", scale, ordinal);

    private static ScenarioDocument Production(
        string family,
        string key,
        SeededConnection connection,
        DateOnly date,
        ScenarioContext context,
        decimal scale = 1m,
        int ordinal = 1) =>
        Document(family, key, connection, date, context, "A01", scale, ordinal);

    private static ScenarioDocument Document(
        string family,
        string key,
        SeededConnection connection,
        DateOnly date,
        ScenarioContext context,
        string direction,
        decimal scale,
        int ordinal)
    {
        var count = AmsterdamDay.IntervalCount(date);

        var quantities = direction == "A01"
            ? LoadShape.Production(connection.Ean, date, count, connection.CapacityKw)
            : LoadShape.Consumption(connection.Ean, date, count, connection.CapacityKw);

        if (scale != 1m)
        {
            quantities =
            [
                .. quantities.Select(quantity =>
                    decimal.Round(quantity * scale, LoadShape.Decimals, MidpointRounding.AwayFromZero)),
            ];
        }

        var documentId = DeterministicId(key, connection.Ean, date, direction, ordinal);

        var spec = new DocumentSpec(
            DocumentId: documentId,
            // Noon UTC on the day after delivery, plus the ordinal in hours. Deterministic, and it
            // makes a correction's CreatedDateTime later than the original's without a clock.
            DocumentCreated: new DateTimeOffset(
                date.AddDays(1).ToDateTime(new TimeOnly(12, 0)), TimeSpan.Zero).AddHours(ordinal - 1),
            DocumentType: "A23",
            ProcessType: ProcessType,
            SenderGln: context.SenderGln,
            ReceiverGln: context.ReceiverGln,
            ResourceObject: connection.Ean,
            DeliveryDate: date,
            Direction: direction,
            Resolution: "PT15M",
            CurveType: "A01",
            MeasurementUnit: "KWH",
            Quantities: quantities);

        return new ScenarioDocument(
            Family: family,
            ScenarioKey: key,
            Spec: spec,
            Edits: [],
            PadToBytes: null,
            ExpectedStatusCode: 200,
            ExpectedFailureCode: null,
            ExpectedQuarantineReason: null,
            Note: $"{connection.Name}, {date:yyyy-MM-dd}, {direction}, {count} intervals.");
    }

    /// <summary>
    /// A GUID derived from what the document is, not generated.
    /// </summary>
    /// <remarks>
    /// ⚠ <c>Guid.NewGuid()</c> here would make a second <c>devstubs scenarios</c> run post fresh
    /// documents rather than byte-identical ones, and contract §9.4's <c>DUPLICATE</c> would stop
    /// being reproducible.
    /// </remarks>
    private static string DeterministicId(
        string key, string ean, DateOnly date, string direction, int ordinal)
    {
        var seed = string.Create(
            CultureInfo.InvariantCulture, $"{key}|{ean}|{date:yyyy-MM-dd}|{direction}|{ordinal}");

        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(seed));

        return new Guid(digest.AsSpan(0, 16)).ToString("D", CultureInfo.InvariantCulture);
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~ScenarioCatalogueTests"
```

Expected: PASS — 19 test cases (the one theory expands to three).

⚠ `The_two_size_documents_sit_on_either_side_of_the_exact_byte_limit` asserts on `PadToBytes` and
never renders, so this class stays fast. The 26 MB strings are built in task 24, once.

- [ ] **Step 5: MUTATION — generate the eleven invalid documents in a loop over the codes**

The tempting simplification, and the reason not to take it. Replace `Invalid`'s body with a loop that
builds `Base(code)` for each of `AdapterFailureCodes` and applies **no** field change.

Predict: every test in **this** class stays green except
`Only_the_two_rules_that_need_a_text_edit_have_one`, which fails with
`edited should be ["invalid-INVALID_MEASUREMENT_PERIOD", "invalid-INVALID_POSITIONS"] but was []` —
and **task 23's `ScenarioEndToEndTests` goes red on nine of eleven rows**, because eleven perfectly
valid documents were posted expecting eleven different failure codes.

⚠ That is the shape worth remembering: the catalogue's own tests mostly check the *table*, and only
the end-to-end suite checks that each document is actually invalid in the way its key claims. Run
both, confirm both, then restore.

- [ ] **Step 6: Second mutation — add `UNKNOWN_METERING_POINT` to `AdapterFailureCodes`**

Predict: `The_eleven_adapter_codes_are_the_nine_reject_rules_plus_the_two_the_contract_adds` fails on
its `ShouldBe` with a twelfth element, **and** `The_invalid_family_is_eleven_codes_and_the_two_size_boundaries`
fails with `invalid.Count should be 13 but was 14`, **and**
`Every_family_produces_at_least_one_document_and_no_key_repeats` stays green.

The point: contract §8.4's own table lists thirteen codes and it is genuinely tempting to generate
one document per row. Two of those rows are the pipeline's, not the adapter's, and a document
generated for them would assert `FAILED` on a message that correctly reaches `PROCESSED`.

Run, confirm, restore.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~ScenarioCatalogueTests"
git add src/Hosts/PeakPower.DevStubs/ScenarioCatalogue.cs \
        tests/PeakPower.Application.Tests/DevStubs/ScenarioCatalogueTests.cs
git commit -m "Catalogue contract 13.1's fourteen scenarios, by key, with the outcome each expects

The keys are the contract's own spellings, written out in the test rather than read back from the
catalogue - a test that asked the catalogue for its own key list would agree with any spelling,
including one plan 6's employee screen and plan 8's load test cannot find.

Eleven adapter failure codes, not thirteen. Contract 8.4 lists thirteen, but
UNKNOWN_METERING_POINT and WRONG_BRP_FOR_METERING_POINT are marked quarantine-not-reject and are
the pipeline's decision - they are the unknown-ean and wrong-brp scenarios under their pipeline
names. Generating them here as well would assert FAILED on a message that correctly reaches
PROCESSED, which the second mutation demonstrates.

Two of the eleven need a text edit rather than a spec field, because DocumentSpec's members are
frozen by plan 8 and neither a two-day period nor a repeated Pos is expressible through them.
Editing rendered text is not a workaround: S2-D4 makes the artefact text, and a deliberately
corrupt document is corrupt text.

Every document id is a SHA-256 of what the document IS rather than a fresh GUID, so a second run
posts byte-identical payloads and contract 9.4's DUPLICATE stays reproducible.

The two size documents are 26 214 400 and 26 214 401 bytes - contract 9.4 pins both sides, and
'about 25 MB' would test neither."
```

---

### Task 19: `PvnedWebhookClient` — the only route from this program to a reading

`[F02-R30]`: *"No code path may bypass **F02-R01..R13** to write readings directly."* This class is
the whole of `PeakPower.DevStubs`' write surface, and the project has no database reference with which
to build a second one.

⚠ **Contract §9.1 and §9.2 are frozen.** `POST /webhooks/brp/{brpCode}` with
`X-PeakPower-Brp-Credential: <shared secret>`. No scheme prefix and no `Authorization` header —
`[F02-R02]`/`[AS-16]` make the mechanism per-BRP, and a shared-secret header is the mechanism the
seeded BRP row declares.

⚠ **The credential is read once, at construction, and an empty one throws there.** Contract §9.3: an
absent or empty value means the Worker answers **401 to every request** on that route — it must never
mean "no credential required". Discovering that on document 1 of 990 produces 990 identical failures
and one confused reader.

⚠ **`X-Correlation-Id` comes back on every status** (contract §9.5) and is captured on every outcome,
including the failures. It is the only thing that ties a line in the generator's console to a row in
`inbound_message` and a line in the Worker's log, and it is the first thing anybody asks for.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/PvnedWebhookClient.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/PvnedWebhookClientTests.cs`

**Interfaces:**
- Consumes: `DevStubsOptions` (task 13); `System.Net.Http.HttpClient`.
- Produces:
  - `PeakPower.DevStubs.PvnedWebhookClient`, constructed as
    `new PvnedWebhookClient(HttpClient http, DevStubsOptions options)`
  - `PvnedWebhookClient.PostAsync(string documentXml, CancellationToken ct)` — `public Task<PvnedPostResult>`
  - `PvnedWebhookClient.RequestUri` — `public Uri`
  - `PvnedWebhookClient.CredentialHeader = "X-PeakPower-Brp-Credential"` — `public const string`
  - `PvnedWebhookClient.CorrelationHeader = "X-Correlation-Id"` — `public const string`
  - `PeakPower.DevStubs.PvnedPostResult(int StatusCode, string? CorrelationId, string? Body)`

⚠ **The constructor and `PostAsync` are plan 8 task 3's pinned surface.** Frozen there.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/PvnedWebhookClientTests.cs`:

```csharp
using System.Net;
using System.Text;
using PeakPower.DevStubs;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.DevStubs;

/// <summary>
/// The generator's only write surface. <c>[F02-R30]</c> forbids every other route to a reading, and
/// this project has no database reference with which to build one.
/// </summary>
public sealed class PvnedWebhookClientTests : IDisposable
{
    private const string Credential = "a-shared-secret-for-this-test";
    private const string Variable = "PP_DEVSTUBS_TEST_CREDENTIAL";

    public PvnedWebhookClientTests() =>
        Environment.SetEnvironmentVariable(Variable, Credential);

    public void Dispose() =>
        Environment.SetEnvironmentVariable(Variable, null);

    private static DevStubsOptions Options() => new()
    {
        WebhookBaseUri = new Uri("http://localhost:5300"),
        BrpCode = "PVNED",
        CredentialVariable = Variable,
    };

    /// <summary>
    /// Records the request and answers whatever it was told to. Twenty lines, and it keeps this whole
    /// class off the network — the real webhook is exercised end to end in
    /// <c>PeakPower.Integration.Tests</c>, where a real Worker is listening.
    /// </summary>
    private sealed class RecordingHandler(HttpStatusCode status, string? correlationId)
        : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }

        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Request = request;
            Body = request.Content is null
                ? null
                : await request.Content.ReadAsStringAsync(cancellationToken);

            var response = new HttpResponseMessage(status);

            if (correlationId is not null)
            {
                response.Headers.TryAddWithoutValidation(
                    PvnedWebhookClient.CorrelationHeader, correlationId);
            }

            return response;
        }
    }

    [Fact]
    public void The_route_is_the_frozen_one()
    {
        using var http = new HttpClient(new RecordingHandler(HttpStatusCode.OK, null));

        var client = new PvnedWebhookClient(http, Options());

        // Contract §9.1, and design §7.2 names it exactly. Outside /api/v1 on purpose: it is not a
        // customer or employee API and carries no session.
        client.RequestUri.ShouldBe(new Uri("http://localhost:5300/webhooks/brp/PVNED"));
    }

    [Fact]
    public async Task The_credential_goes_in_the_frozen_header_with_no_scheme_prefix()
    {
        var handler = new RecordingHandler(HttpStatusCode.OK, null);
        using var http = new HttpClient(handler);

        await new PvnedWebhookClient(http, Options()).PostAsync("<x/>", TestContext.Current.CancellationToken);

        handler.Request.ShouldNotBeNull();

        handler.Request.Headers
            .GetValues(PvnedWebhookClient.CredentialHeader)
            .Single()
            .ShouldBe(Credential);

        // [F02-R02]/[AS-16]: the mechanism is per-BRP and this BRP row declares a shared-secret
        // header. There is no Authorization header and no "Bearer " in front of anything.
        handler.Request.Headers.Authorization.ShouldBeNull();
    }

    [Fact]
    public async Task The_body_is_the_document_as_utf_eight_xml()
    {
        var handler = new RecordingHandler(HttpStatusCode.OK, null);
        using var http = new HttpClient(handler);

        // A non-ASCII character, so a client that posted the string as Latin-1 would send a
        // different byte count and the size scenarios would land a byte or two off.
        const string document = "<x>Kas 4 — Bleiswijk</x>";

        await new PvnedWebhookClient(http, Options())
            .PostAsync(document, TestContext.Current.CancellationToken);

        handler.Body.ShouldBe(document);

        handler.Request!.Content!.Headers.ContentType!.MediaType.ShouldBe("application/xml");
        handler.Request.Content.Headers.ContentType.CharSet.ShouldBe("utf-8");
        handler.Request.Content.Headers.ContentLength
            .ShouldBe(Encoding.UTF8.GetByteCount(document));
    }

    [Fact]
    public async Task The_correlation_id_is_captured_from_the_response()
    {
        var handler = new RecordingHandler(HttpStatusCode.OK, "0199c0de-0000-7000-8000-00000000abcd");
        using var http = new HttpClient(handler);

        var result = await new PvnedWebhookClient(http, Options())
            .PostAsync("<x/>", TestContext.Current.CancellationToken);

        result.StatusCode.ShouldBe(200);
        result.CorrelationId.ShouldBe("0199c0de-0000-7000-8000-00000000abcd");
    }

    /// <summary>
    /// A 413 and a 401 are RESULTS, not exceptions. <c>size-26mb</c> expects a 413 and it is a
    /// passing scenario; throwing on it would make the runner's report unable to say so.
    /// </summary>
    [Theory]
    [InlineData(HttpStatusCode.RequestEntityTooLarge, 413)]
    [InlineData(HttpStatusCode.Unauthorized, 401)]
    [InlineData(HttpStatusCode.InternalServerError, 500)]
    public async Task A_non_success_status_is_returned_rather_than_thrown(
        HttpStatusCode status, int expected)
    {
        var handler = new RecordingHandler(status, null);
        using var http = new HttpClient(handler);

        var result = await new PvnedWebhookClient(http, Options())
            .PostAsync("<x/>", TestContext.Current.CancellationToken);

        result.StatusCode.ShouldBe(expected);
    }

    /// <summary>
    /// ⚠ Contract §9.3: an empty credential means the Worker answers 401 to EVERY request on that
    /// route. Finding that out on document one of nine hundred and ninety is nine hundred and ninety
    /// identical failures, so it is found at construction instead.
    /// </summary>
    [Fact]
    public void An_absent_credential_throws_at_construction_rather_than_on_the_first_post()
    {
        Environment.SetEnvironmentVariable(Variable, null);

        using var http = new HttpClient(new RecordingHandler(HttpStatusCode.OK, null));

        var thrown = Should.Throw<InvalidOperationException>(
            () => new PvnedWebhookClient(http, Options()));

        thrown.Message.Contains(Variable, StringComparison.Ordinal).ShouldBeTrue();
    }

    [Fact]
    public void A_base_uri_with_a_trailing_slash_produces_the_same_route()
    {
        using var http = new HttpClient(new RecordingHandler(HttpStatusCode.OK, null));

        var options = Options();
        options.WebhookBaseUri = new Uri("http://localhost:5300/");

        // Uri composition eats a trailing slash differently depending on how it is written, and a
        // route of //webhooks/brp/PVNED is a 404 nobody enjoys diagnosing.
        new PvnedWebhookClient(http, options).RequestUri
            .ShouldBe(new Uri("http://localhost:5300/webhooks/brp/PVNED"));
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedWebhookClientTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'PvnedWebhookClient' could not be found`.

- [ ] **Step 3: Write `PvnedWebhookClient`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/PvnedWebhookClient.cs`:

```csharp
using System.Globalization;
using System.Net.Http.Headers;
using System.Text;

namespace PeakPower.DevStubs;

/// <summary>What the webhook answered.</summary>
/// <param name="CorrelationId">
/// From the <c>X-Correlation-Id</c> response header (contract §9.5). The only thing that ties a line
/// in this program's console to a row in <c>metering.inbound_message</c> and a scope in the Worker's
/// log, which is why it is captured on failures as well as successes.
/// </param>
public sealed record PvnedPostResult(int StatusCode, string? CorrelationId, string? Body);

/// <summary>
/// Posts one generated document to the real BRP webhook.
/// </summary>
/// <remarks>
/// <para>
/// ⚠ <b>This is the whole of <c>PeakPower.DevStubs</c>' write surface.</b> <c>[F02-R30]</c>: "No code
/// path may bypass F02-R01..R13 to write readings directly." The project has no
/// <c>PeakPower.Persistence</c> reference to build a second one with (contract §3.1), which is the
/// design rather than an oversight.
/// </para>
/// <para>
/// <b>Non-2xx statuses are returned, never thrown.</b> <c>size-26mb</c> expects a <b>413</b> and it
/// is a passing scenario; an <c>EnsureSuccessStatusCode</c> here would make the runner unable to
/// report the one outcome the size boundary exists to produce.
/// </para>
/// </remarks>
public sealed class PvnedWebhookClient
{
    /// <summary>Contract §9.2. No scheme prefix, and not <c>Authorization</c>.</summary>
    public const string CredentialHeader = "X-PeakPower-Brp-Credential";

    /// <summary>Contract §9.5. Returned on every status.</summary>
    public const string CorrelationHeader = "X-Correlation-Id";

    private readonly HttpClient _http;
    private readonly string _credential;

    public PvnedWebhookClient(HttpClient http, DevStubsOptions options)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(options);

        _http = http;

        // Read HERE, not on the first post. Contract §9.3 makes an empty credential a 401 on every
        // request rather than an open door, so an absent one is nine hundred and ninety identical
        // failures if it is discovered lazily.
        _credential = options.ReadCredential();

        // Relative, and with no leading slash on the path, so a base URI written with or without a
        // trailing slash produces the same route. Uri composition treats the two differently and
        // //webhooks/brp/PVNED is a 404 nobody enjoys diagnosing.
        RequestUri = new Uri(
            new Uri(options.WebhookBaseUri.GetLeftPart(UriPartial.Authority) + "/"),
            string.Create(CultureInfo.InvariantCulture, $"webhooks/brp/{options.BrpCode}"));
    }

    /// <summary>
    /// <c>POST /webhooks/brp/{brpCode}</c> — contract §9.1, and the route design §7.2 names exactly.
    /// </summary>
    public Uri RequestUri { get; }

    /// <summary>Post one document. Returns the status; throws only on a transport failure.</summary>
    public async Task<PvnedPostResult> PostAsync(string documentXml, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(documentXml);

        using var request = new HttpRequestMessage(HttpMethod.Post, RequestUri);

        request.Headers.TryAddWithoutValidation(CredentialHeader, _credential);

        // Explicit UTF-8 bytes rather than a StringContent default, because the two size scenarios
        // are pinned to an EXACT byte count and an encoding surprise moves both of them off it.
        request.Content = new ByteArrayContent(Encoding.UTF8.GetBytes(documentXml))
        {
            Headers = { ContentType = new MediaTypeHeaderValue("application/xml", "utf-8") },
        };

        using var response = await _http.SendAsync(request, ct);

        var correlationId =
            response.Headers.TryGetValues(CorrelationHeader, out var values)
                ? values.FirstOrDefault()
                : null;

        // Read even on a failure: contract §9.4 answers 401, 413 and 500 with RFC 7807, and the
        // problem detail is the only thing that says which of the three reasons a 401 was.
        var body = response.Content is null
            ? null
            : await response.Content.ReadAsStringAsync(ct);

        return new PvnedPostResult((int)response.StatusCode, correlationId, body);
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedWebhookClientTests"
```

Expected: PASS — 9 test cases (the one theory expands to three).

- [ ] **Step 5: MUTATION — call `EnsureSuccessStatusCode`**

Add `response.EnsureSuccessStatusCode();` after the `SendAsync`.

Predict: `A_non_success_status_is_returned_rather_than_thrown` fails on **all three** rows with
`System.Net.Http.HttpRequestException : Response status code does not indicate success: 413
(Request Entity Too Large)` — and every other test in the class stays green, because they all answer
200.

⚠ And note what it would do downstream: `size-26mb` is a **passing** scenario whose expected outcome
is a 413, so the runner would report a transport failure for the one document that behaved exactly as
contract §9.4 requires.

Run, confirm, restore.

- [ ] **Step 6: Second mutation — read the credential lazily**

Move `_credential = options.ReadCredential();` out of the constructor and into `PostAsync`.

Predict: `An_absent_credential_throws_at_construction_rather_than_on_the_first_post` fails with
`Should.Throw<InvalidOperationException> ... but no exception was thrown`, and every other test stays
green because they all set the variable.

Run, confirm, restore.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedWebhookClientTests"
git add src/Hosts/PeakPower.DevStubs/PvnedWebhookClient.cs \
        tests/PeakPower.Application.Tests/DevStubs/PvnedWebhookClientTests.cs
git commit -m "Post over the real webhook, which is the only route this program has to a reading

F02-R30 forbids every other one, and contract 3.1 gives PeakPower.DevStubs no persistence
reference to build a second with. Contract 9.1 and 9.2 are frozen: POST /webhooks/brp/{brpCode}
with X-PeakPower-Brp-Credential, no scheme prefix and no Authorization header, because F02-R02
makes the mechanism per-BRP and a shared-secret header is what the seeded row declares.

A non-2xx is a RESULT, not an exception. size-26mb expects a 413 and is a passing scenario;
verified by mutation - adding EnsureSuccessStatusCode turns the one document that behaves exactly
as contract 9.4 requires into a transport failure.

The credential is read at construction. Contract 9.3 makes an empty one a 401 on every request
rather than an open door, so reading it lazily turns one misconfiguration into nine hundred and
ninety identical failures - which the second mutation shows."
```

---

### Task 20: `ScenarioRunner` — render, edit, pad, post, and report per key

Three things the runner does that nothing else can, and each has a reason:

1. **It posts a scenario's documents strictly in order, one at a time.** `out-of-order-pair` and
   `correction-supersedes` are the same two documents in opposite receipt orders (§4.2), and receipt
   order is the whole assertion. Two in flight at once would make the pair's outcome a race.
2. **It applies the edits before the padding**, because an edit's `Find` string must still be
   present, and padding inserts a comment that no edit is written against.
3. **It reports per `ScenarioKey`, including the ones that were expected to fail.** A rejected
   document is a **passing** scenario; a runner that reported "11 errors" for the invalid family
   would be reporting the pipeline working.

⚠ **`DevStubsOptions.MaxInFlight` does not apply here.** It is the backfill's (task 21), where the
documents are for different (EAN, date) pairs and their order genuinely does not matter. Reaching for
it in the runner is how the supersession scenarios become flaky.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/ScenarioRunner.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/ScenarioRunnerTests.cs`

**Interfaces:**
- Consumes: `ScenarioCatalogue`, `ScenarioDocument`, `RenderedEdit` (task 18);
  `PvnedDocumentTemplate.Render`, `.PadTo` (task 16); `PvnedWebhookClient` (task 19).
- Produces:
  - `PeakPower.DevStubs.ScenarioRunner`, constructed as
    `new ScenarioRunner(PvnedWebhookClient client, ILogger<ScenarioRunner> logger)`
  - `ScenarioRunner.RenderFor(ScenarioDocument document)` — `public static string`
  - `ScenarioRunner.RunAsync(IReadOnlyList<ScenarioDocument> documents, CancellationToken ct)` — `public Task<ScenarioRunReport>`
  - `PeakPower.DevStubs.ScenarioPostOutcome(string ScenarioKey, int StatusCode, int ExpectedStatusCode, string? CorrelationId, int Bytes)` with `bool AsExpected`
  - `PeakPower.DevStubs.ScenarioRunReport(IReadOnlyList<ScenarioPostOutcome> Outcomes)` with `int Posted` and `int Unexpected`

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/ScenarioRunnerTests.cs`:

```csharp
using System.Net;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using PeakPower.DevStubs;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.DevStubs;

/// <summary>
/// Rendering, editing, padding, posting and reporting — with a stub handler in place of the Worker.
/// The real webhook is exercised in <c>PeakPower.Integration.Tests</c>; what is proved here is the
/// ORDER and the arithmetic, which a container would only make slower to check.
/// </summary>
public sealed class ScenarioRunnerTests : IDisposable
{
    private const string Variable = "PP_DEVSTUBS_RUNNER_CREDENTIAL";

    private static readonly ScenarioContext Context =
        ScenarioContext.From(new DateOnly(2026, 9, 7), new DevStubsOptions());

    public ScenarioRunnerTests() =>
        Environment.SetEnvironmentVariable(Variable, "secret");

    public void Dispose() =>
        Environment.SetEnvironmentVariable(Variable, null);

    private sealed class CapturingHandler : HttpMessageHandler
    {
        public List<string> Bodies { get; } = [];

        public List<int> ByteCounts { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var bytes = await request.Content!.ReadAsByteArrayAsync(cancellationToken);

            ByteCounts.Add(bytes.Length);
            Bodies.Add(Encoding.UTF8.GetString(bytes));

            // The size boundary, answered the way contract §9.4 says the Worker answers it, so the
            // runner's "as expected" arithmetic is exercised on both sides of it.
            return new HttpResponseMessage(
                bytes.Length > 26_214_400
                    ? HttpStatusCode.RequestEntityTooLarge
                    : HttpStatusCode.OK);
        }
    }

    private static (ScenarioRunner Runner, CapturingHandler Handler, HttpClient Http) Harness()
    {
        var handler = new CapturingHandler();
        var http = new HttpClient(handler);

        var options = new DevStubsOptions { CredentialVariable = Variable };

        return (
            new ScenarioRunner(new PvnedWebhookClient(http, options), NullLogger<ScenarioRunner>.Instance),
            handler,
            http);
    }

    [Fact]
    public async Task Every_document_is_posted_once_and_reported_by_key()
    {
        var (runner, handler, http) = Harness();
        using var _ = http;

        var documents = ScenarioCatalogue.For("daily-cadence", Context);

        var report = await runner.RunAsync(documents, TestContext.Current.CancellationToken);

        handler.Bodies.Count.ShouldBe(documents.Count);
        report.Posted.ShouldBe(documents.Count);
        report.Outcomes.Count.ShouldBe(documents.Count);
        report.Outcomes.ShouldAllBe(outcome => outcome.ScenarioKey == "daily-cadence");
        report.Unexpected.ShouldBe(0);
    }

    /// <summary>
    /// ⚠ The assertion the supersession scenarios rest on. §4.2: the current version is the last one
    /// RECEIVED, so <c>out-of-order-pair</c> is the same two documents as
    /// <c>correction-supersedes</c> in the opposite receipt order — and two posts in flight at once
    /// would make which one lands second a race rather than a decision.
    /// </summary>
    [Fact]
    public async Task A_scenario_s_documents_are_posted_in_list_order()
    {
        var (runner, handler, http) = Harness();
        using var _ = http;

        var pair = ScenarioCatalogue.For("out-of-order-pair", Context);

        await runner.RunAsync(pair, TestContext.Current.CancellationToken);

        handler.Bodies.Count.ShouldBe(2);
        handler.Bodies[0].Contains(pair[0].Spec.DocumentId, StringComparison.Ordinal).ShouldBeTrue();
        handler.Bodies[1].Contains(pair[1].Spec.DocumentId, StringComparison.Ordinal).ShouldBeTrue();
    }

    [Fact]
    public void An_edit_is_applied_to_the_rendered_text()
    {
        var document = ScenarioCatalogue.For("invalid-<code>", Context)
            .Single(candidate => candidate.ScenarioKey == "invalid-INVALID_POSITIONS");

        var rendered = ScenarioRunner.RenderFor(document);

        // Pos 2 is gone and Pos 1 appears twice: contiguous-from-1-with-no-duplicates broken in
        // both halves by one edit.
        rendered.Contains("<Pos>2</Pos>", StringComparison.Ordinal).ShouldBeFalse();
        (rendered.Split("<Pos>1</Pos>", StringSplitOptions.None).Length - 1).ShouldBe(2);
    }

    /// <summary>
    /// Edits first, then padding. An edit's <c>Find</c> string has to still be there when it runs,
    /// and the padding inserts a comment no edit is written against — so the other order works by
    /// luck rather than by design, and stops working the first time an edit is written against text
    /// near the end of the document.
    /// </summary>
    [Fact]
    public void Padding_lands_on_the_exact_byte_count_after_the_edits()
    {
        var document = ScenarioCatalogue.For("invalid-<code>", Context)
            .Single(candidate => candidate.ScenarioKey == "size-25mb");

        var rendered = ScenarioRunner.RenderFor(document);

        Encoding.UTF8.GetByteCount(rendered).ShouldBe(26_214_400);
    }

    /// <summary>
    /// A rejected document is a PASSING scenario, and the report has to be able to say so. A runner
    /// that counted every non-200 as an error would report eleven errors for the invalid family and
    /// be describing the pipeline working exactly as contract §8.4 requires.
    /// </summary>
    [Fact]
    public async Task An_expected_413_is_not_an_error()
    {
        var (runner, _, http) = Harness();
        using var __ = http;

        var sizes = ScenarioCatalogue.For("invalid-<code>", Context)
            .Where(document => document.ScenarioKey is "size-25mb" or "size-26mb")
            .ToArray();

        var report = await runner.RunAsync(sizes, TestContext.Current.CancellationToken);

        report.Unexpected.ShouldBe(0);
        report.Outcomes.ShouldAllBe(outcome => outcome.AsExpected);

        report.Outcomes.Single(outcome => outcome.ScenarioKey == "size-26mb").StatusCode
            .ShouldBe(413);
        report.Outcomes.Single(outcome => outcome.ScenarioKey == "size-25mb").StatusCode
            .ShouldBe(200);
    }

    [Fact]
    public async Task An_unexpected_status_is_counted_and_named()
    {
        var (runner, _, http) = Harness();
        using var __ = http;

        // Expects a 413 at 26 214 401 bytes; the harness answers 200 below the limit, so a document
        // that claims to be over it and is not comes back as unexpected.
        var wrong = ScenarioCatalogue.For("normal-day", Context)[0] with { ExpectedStatusCode = 413 };

        var report = await runner.RunAsync([wrong], TestContext.Current.CancellationToken);

        report.Unexpected.ShouldBe(1);
        report.Outcomes.Single().AsExpected.ShouldBeFalse();
        report.Outcomes.Single().StatusCode.ShouldBe(200);
        report.Outcomes.Single().ExpectedStatusCode.ShouldBe(413);
    }

    [Fact]
    public async Task The_report_carries_the_byte_count_that_was_actually_sent()
    {
        var (runner, handler, http) = Harness();
        using var __ = http;

        var report = await runner.RunAsync(
            ScenarioCatalogue.For("normal-day", Context), TestContext.Current.CancellationToken);

        report.Outcomes.Single().Bytes.ShouldBe(handler.ByteCounts.Single());
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~ScenarioRunnerTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'ScenarioRunner' could not be found`.

- [ ] **Step 3: Write `ScenarioRunner`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/ScenarioRunner.cs`:

```csharp
using System.Text;
using Microsoft.Extensions.Logging;

namespace PeakPower.DevStubs;

/// <summary>What one post did.</summary>
public sealed record ScenarioPostOutcome(
    string ScenarioKey,
    int StatusCode,
    int ExpectedStatusCode,
    string? CorrelationId,
    int Bytes)
{
    /// <summary>
    /// ⚠ A rejected document is a <b>passing</b> scenario. Eleven of the fourteen families' documents
    /// are expected to be refused, quarantined or failed, and every one of them is expected to be
    /// answered <b>200</b> anyway (<c>[F02-R05]</c>) — the single exception being <c>size-26mb</c>'s
    /// 413. "As expected" therefore compares against the scenario's own expectation and never against
    /// success.
    /// </summary>
    public bool AsExpected => StatusCode == ExpectedStatusCode;
}

/// <summary>Every post a run made, and how many of them were not what the catalogue expected.</summary>
public sealed record ScenarioRunReport(IReadOnlyList<ScenarioPostOutcome> Outcomes)
{
    public int Posted => Outcomes.Count;

    public int Unexpected => Outcomes.Count(outcome => !outcome.AsExpected);
}

/// <summary>
/// Renders each <see cref="ScenarioDocument"/> and posts it over the real webhook, in order.
/// </summary>
/// <remarks>
/// <para>
/// ⚠ <b>Strictly serial, and <see cref="DevStubsOptions.MaxInFlight"/> is deliberately not consulted
/// here.</b> <c>out-of-order-pair</c> and <c>correction-supersedes</c> are the same two documents in
/// opposite receipt orders, and §4.2 makes receipt order the entire assertion: the current version is
/// the last one <b>received</b>. Two posts in flight would turn that into a race, and the test that
/// caught it would look flaky rather than wrong. Concurrency belongs to the backfill, where the
/// documents are for different (EAN, date) pairs and their order genuinely does not matter.
/// </para>
/// <para>
/// <b>Edits before padding.</b> An edit's <c>Find</c> string has to still be present when it runs,
/// and padding inserts a comment no edit is written against — so the other order works by luck and
/// stops working the first time an edit targets text near the end of the document.
/// </para>
/// </remarks>
public sealed class ScenarioRunner(PvnedWebhookClient client, ILogger<ScenarioRunner> logger)
{
    /// <summary>
    /// The exact bytes a document will be posted as: rendered, edited, then padded.
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// An edit found nothing to replace. Silently skipping it would post a perfectly valid document
    /// under a key that claims it is invalid, and the end-to-end assertion would fail four files
    /// away from the cause.
    /// </exception>
    public static string RenderFor(ScenarioDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);

        var xml = PvnedDocumentTemplate.Render(document.Spec);

        foreach (var edit in document.Edits)
        {
            if (!xml.Contains(edit.Find, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"Scenario '{document.ScenarioKey}' expects to replace \"{edit.Find}\", which "
                    + "the rendered document does not contain. The template changed and the edit "
                    + "did not; posting it unedited would send a VALID document under a key that "
                    + "says it is invalid.");
            }

            xml = xml.Replace(edit.Find, edit.Replace, StringComparison.Ordinal);
        }

        return document.PadToBytes is { } totalBytes
            ? PvnedDocumentTemplate.PadTo(xml, totalBytes)
            : xml;
    }

    /// <summary>Post every document, in order, and report on each.</summary>
    public async Task<ScenarioRunReport> RunAsync(
        IReadOnlyList<ScenarioDocument> documents, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(documents);

        var outcomes = new List<ScenarioPostOutcome>(documents.Count);

        foreach (var document in documents)
        {
            var xml = RenderFor(document);
            var bytes = Encoding.UTF8.GetByteCount(xml);

            var result = await client.PostAsync(xml, ct);

            var outcome = new ScenarioPostOutcome(
                document.ScenarioKey,
                result.StatusCode,
                document.ExpectedStatusCode,
                result.CorrelationId,
                bytes);

            outcomes.Add(outcome);

            if (outcome.AsExpected)
            {
                logger.LogInformation(
                    "{Key}: {Status} in {Bytes} bytes, correlation {CorrelationId}. {Note}",
                    outcome.ScenarioKey, outcome.StatusCode, outcome.Bytes,
                    outcome.CorrelationId, document.Note);
            }
            else
            {
                logger.LogWarning(
                    "{Key}: expected {Expected} but the webhook answered {Status}. Correlation "
                    + "{CorrelationId}, {Bytes} bytes. {Note}",
                    outcome.ScenarioKey, outcome.ExpectedStatusCode, outcome.StatusCode,
                    outcome.CorrelationId, outcome.Bytes, document.Note);
            }
        }

        return new ScenarioRunReport(outcomes);
    }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~ScenarioRunnerTests"
```

Expected: PASS — 7 tests.

⚠ Two of the seven build a 26 MB document each, so this class takes a few seconds rather than
milliseconds. That is the size the webhook is being asked about and there is no cheaper way to ask;
it is also why the size documents are rendered here and in task 24 and nowhere else.

- [ ] **Step 5: MUTATION — post the documents concurrently**

Replace the `foreach` with

```csharp
        var results = await Task.WhenAll(documents.Select(async document => { … }));   // MUTATION
```

Predict: `A_scenario_s_documents_are_posted_in_list_order` fails **intermittently** —
`handler.Bodies[0].Contains(pair[0].Spec.DocumentId) should be True but was False` on some runs and
passes on others.

⚠ **An intermittent red is still a red, and this one is worth watching for.** Run the filter five
times; if it passes five times, add a small delay inside the handler's `SendAsync` to widen the
window, and run it again. A concurrency bug that only appears against a real Worker under load is the
exact failure this step exists to make visible on a laptop.

Restore the `foreach`.

- [ ] **Step 6: Second mutation — treat a non-200 as a failure**

Replace `AsExpected`'s body with `StatusCode is >= 200 and < 300`.

Predict: `An_expected_413_is_not_an_error` fails with `report.Unexpected should be 0 but was 1`, and
`An_unexpected_status_is_counted_and_named` **also** fails — with `report.Unexpected should be 1 but
was 0`, in the opposite direction, because a 200 that was not expected now counts as success.

Both directions failing at once is the point: "did the pipeline do what this scenario says it should"
and "did the request succeed" are different questions, and only one of them is the one being asked.

Run, confirm both, restore.

- [ ] **Step 7: Third mutation — skip an edit that finds nothing**

Replace the `throw` in `RenderFor` with `continue;`.

Predict: `An_edit_is_applied_to_the_rendered_text` **stays green** (the edit does find its text
today), and nothing in this class goes red — but change `PvnedDocumentTemplate`'s point line to emit
`<Pos>` with an attribute and re-run: the test goes red on the replacement count while the runner
reports a cheerful success.

⚠ That is why the throw is there. Restore it, and leave the template alone.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~ScenarioRunnerTests"
git add src/Hosts/PeakPower.DevStubs/ScenarioRunner.cs \
        tests/PeakPower.Application.Tests/DevStubs/ScenarioRunnerTests.cs
git commit -m "Render, edit, pad, post in order, and report against each scenario's own expectation

Strictly serial, and DevStubsOptions.MaxInFlight is deliberately not consulted here.
out-of-order-pair and correction-supersedes are the same two documents in opposite receipt orders,
and 4.2 makes receipt order the entire assertion - two posts in flight turn it into a race, and
the test that caught it would look flaky rather than wrong. Concurrency belongs to the backfill,
where the documents are for different (EAN, date) pairs.

A rejected document is a PASSING scenario. AsExpected compares against the scenario's expectation
and never against success; verified by mutation, which fails in BOTH directions at once - an
expected 413 becomes an error and an unexpected 200 becomes a pass, because 'did the pipeline do
what this scenario says' and 'did the request succeed' are different questions.

An edit that finds nothing to replace throws rather than being skipped. Skipping it posts a VALID
document under a key claiming it is invalid, and the end-to-end assertion then fails four files
away from the cause."
```

---

### Task 21: `BackfillCommand` and `CadenceCommand` — ninety days, then one day at a time, both behind the gate

Design §3.1: *"Plus a 90-day backfill across the eleven seeded connections and a cadence pusher, both
behind the existing `SeedingGate` confirmation-phrase pattern."* Contract §13.2 gives each its own
subject and phrase.

⚠ **The cadence is `[DEC-38]`'s: one document per EAN per day.** Both commands reuse
`ScenarioCatalogue.For("daily-cadence", …)` rather than restating it — one rule stated once, so a
change to what a day looks like reaches the scenario suite, the backfill and the pusher together. A
second copy here would be a second answer to "what does a normal day look like", and the two would
diverge on the first correction.

⚠ **Ninety days across eleven connections is 1 260 documents, not 990.** Eleven consumption series
plus three production series is fourteen per day. The gate's phrase says "ninety days" and means
ninety **delivery dates**, which is the number an operator can reason about.

⚠ **Concurrency here, and only here.** `ScenarioRunner` is strictly serial because receipt order is
the assertion (task 20). The backfill's documents are for different (EAN, date) pairs and their order
genuinely does not matter — but a connection's own dates still go in order, because a supersession
that arrives before the version it supersedes is a bug nobody would think to look for in a backfill.
`DevStubsOptions.MaxInFlight` bounds the fan-out across **connections**.

⚠ **Neither command posts unless the gate says so, and neither decides for itself.** The
`DevStubsDecision` is taken in `Program.cs` and passed in — the same shape `DemoSeeding` and
`EmployeeSeeding` use, where a decision reached for one subject must not be able to open another.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/BackfillCommand.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/CadenceCommand.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/BackfillAndCadenceCommandTests.cs`

**Interfaces:**
- Consumes: `ScenarioCatalogue`, `ScenarioContext` (task 18); `ScenarioRunner` (task 20);
  `PvnedWebhookClient` (task 19); `DevStubsGate`, `DevStubsDecision`, `DevStubsOptions` (task 13);
  `TimeProvider`.
- Produces:
  - `PeakPower.DevStubs.BackfillPlan.Days = 90` and
    `BackfillPlan.Build(DateOnly lastDeliveryDate, int days, ScenarioContext context)` — `public static IReadOnlyList<IReadOnlyList<ScenarioDocument>>`, one inner list per connection stream
  - `PeakPower.DevStubs.BackfillCommand`, constructed as
    `new BackfillCommand(ScenarioRunner runner, DevStubsOptions options, ILogger<BackfillCommand> logger)`
  - `BackfillCommand.RunAsync(DevStubsDecision decision, DateOnly lastDeliveryDate, int days, CancellationToken ct)` — `public Task<ScenarioRunReport>`
  - `PeakPower.DevStubs.CadenceCommand`, constructed as
    `new CadenceCommand(ScenarioRunner runner, DevStubsOptions options, TimeProvider time, ILogger<CadenceCommand> logger)`
  - `CadenceCommand.PushOnceAsync(DateOnly deliveryDate, CancellationToken ct)` — `public Task<ScenarioRunReport>`
  - `CadenceCommand.RunAsync(DevStubsDecision decision, TimeSpan interval, CancellationToken ct)` — `public Task<int>`

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/BackfillAndCadenceCommandTests.cs`:

```csharp
using System.Net;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using PeakPower.DevStubs;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.DevStubs;

/// <summary>
/// The two gated commands: ninety delivery dates in one go, and one delivery date on a loop.
/// </summary>
public sealed class BackfillAndCadenceCommandTests : IDisposable
{
    private const string Variable = "PP_DEVSTUBS_COMMAND_CREDENTIAL";

    private static readonly ScenarioContext Context =
        ScenarioContext.From(new DateOnly(2026, 9, 7), new DevStubsOptions());

    public BackfillAndCadenceCommandTests() =>
        Environment.SetEnvironmentVariable(Variable, "secret");

    public void Dispose() =>
        Environment.SetEnvironmentVariable(Variable, null);

    private sealed class CountingHandler : HttpMessageHandler
    {
        private readonly Lock _gate = new();

        public List<string> Bodies { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = await request.Content!.ReadAsStringAsync(cancellationToken);

            lock (_gate)
            {
                Bodies.Add(body);
            }

            return new HttpResponseMessage(HttpStatusCode.OK);
        }
    }

    private static (ScenarioRunner Runner, CountingHandler Handler, HttpClient Http) Harness()
    {
        var handler = new CountingHandler();
        var http = new HttpClient(handler);
        var options = new DevStubsOptions { CredentialVariable = Variable };

        return (
            new ScenarioRunner(new PvnedWebhookClient(http, options), NullLogger<ScenarioRunner>.Instance),
            handler,
            http);
    }

    private static DevStubsDecision Granted(DevStubsSubject subject) =>
        new(DevStubsVerdict.EnabledByConfiguration, subject);

    private static DevStubsDecision Refused(DevStubsSubject subject) =>
        new(DevStubsVerdict.RefusedUnconfirmed, subject);

    [Fact]
    public void Ninety_is_the_number_the_confirmation_phrase_names()
    {
        // The phrase says "ninety days" and the constant has to agree with it, because the sentence
        // is what the operator read before typing it.
        BackfillPlan.Days.ShouldBe(90);
        DevStubsGate.BackfillConfirmation
            .Contains("ninety days", StringComparison.Ordinal)
            .ShouldBeTrue();
    }

    [Fact]
    public void The_plan_is_one_stream_per_connection_and_ninety_dates_each()
    {
        var streams = BackfillPlan.Build(new DateOnly(2026, 9, 6), BackfillPlan.Days, Context);

        // One stream per connection, so each connection's dates stay in order while different
        // connections run in parallel.
        streams.Count.ShouldBe(SeededConnections.Count);

        // Eleven consumption series plus three production ones is fourteen documents a day.
        streams.Sum(stream => stream.Count)
            .ShouldBe((SeededConnections.Count + SeededConnections.Producing.Count) * 90);
    }

    /// <summary>
    /// ⚠ Within one connection the dates ASCEND. A supersession that arrives before the version it
    /// supersedes is a bug nobody would think to look for in a backfill, and §4.2 makes receipt order
    /// decide which version is current.
    /// </summary>
    [Fact]
    public void Each_connection_s_own_dates_ascend()
    {
        var streams = BackfillPlan.Build(new DateOnly(2026, 9, 6), days: 5, Context);

        foreach (var stream in streams)
        {
            var dates = stream.Select(document => document.Spec.DeliveryDate).ToArray();

            dates.ShouldBe(dates.Order().ToArray());
            dates.First().ShouldBe(new DateOnly(2026, 9, 2));
            dates.Last().ShouldBe(new DateOnly(2026, 9, 6));
        }
    }

    [Fact]
    public async Task A_refused_gate_posts_nothing_at_all()
    {
        var (runner, handler, http) = Harness();
        using var _ = http;

        var command = new BackfillCommand(
            runner, new DevStubsOptions(), NullLogger<BackfillCommand>.Instance);

        var report = await command.RunAsync(
            Refused(DevStubsSubject.Backfill),
            new DateOnly(2026, 9, 6),
            days: 3,
            TestContext.Current.CancellationToken);

        report.Posted.ShouldBe(0);
        handler.Bodies.ShouldBeEmpty();
    }

    /// <summary>
    /// ⚠ A decision reached for the CADENCE must not be able to open the backfill. This is
    /// <c>SeedingGate</c>'s own rule — <c>DemoSeeding</c> and <c>EmployeeSeeding</c> each refuse a
    /// decision that is not theirs — and two independent switches wired to the wrong commands look
    /// exactly like two independent switches wired correctly until somebody asks for one of them.
    /// </summary>
    [Fact]
    public async Task The_other_subject_s_decision_does_not_open_this_command()
    {
        var (runner, handler, http) = Harness();
        using var _ = http;

        var command = new BackfillCommand(
            runner, new DevStubsOptions(), NullLogger<BackfillCommand>.Instance);

        await Should.ThrowAsync<ArgumentException>(
            () => command.RunAsync(
                Granted(DevStubsSubject.Cadence),
                new DateOnly(2026, 9, 6),
                days: 3,
                TestContext.Current.CancellationToken));

        handler.Bodies.ShouldBeEmpty();
    }

    [Fact]
    public async Task A_granted_backfill_posts_every_document_in_the_plan()
    {
        var (runner, handler, http) = Harness();
        using var _ = http;

        var command = new BackfillCommand(
            runner, new DevStubsOptions { CredentialVariable = Variable }, NullLogger<BackfillCommand>.Instance);

        var report = await command.RunAsync(
            Granted(DevStubsSubject.Backfill),
            new DateOnly(2026, 9, 6),
            days: 3,
            TestContext.Current.CancellationToken);

        var expected = (SeededConnections.Count + SeededConnections.Producing.Count) * 3;

        report.Posted.ShouldBe(expected);
        report.Unexpected.ShouldBe(0);
        handler.Bodies.Count.ShouldBe(expected);
    }

    [Fact]
    public async Task The_cadence_pushes_one_delivery_date_per_tick()
    {
        var (runner, handler, http) = Harness();
        using var _ = http;

        var command = new CadenceCommand(
            runner,
            new DevStubsOptions { CredentialVariable = Variable },
            new FakeTimeProvider(new DateTimeOffset(2026, 9, 7, 6, 0, 0, TimeSpan.Zero)),
            NullLogger<CadenceCommand>.Instance);

        var report = await command.PushOnceAsync(
            new DateOnly(2026, 9, 6), TestContext.Current.CancellationToken);

        report.Posted.ShouldBe(SeededConnections.Count + SeededConnections.Producing.Count);
        handler.Bodies.Count.ShouldBe(report.Posted);
    }

    /// <summary>
    /// The pusher and the backfill produce the SAME document for the same delivery date. One rule
    /// stated once: both go through <c>ScenarioCatalogue.For("daily-cadence", …)</c>, so a change to
    /// what a normal day looks like reaches the scenario suite, the backfill and the pusher together.
    /// </summary>
    [Fact]
    public void The_pusher_and_the_backfill_agree_on_what_a_day_is()
    {
        var date = new DateOnly(2026, 9, 6);

        var fromBackfill = BackfillPlan.Build(date, days: 1, Context)
            .SelectMany(stream => stream)
            .Select(document => document.Spec.DocumentId)
            .Order(StringComparer.Ordinal)
            .ToArray();

        var fromCatalogue = ScenarioCatalogue
            .For("daily-cadence", Context with { Today = date.AddDays(1) })
            .Select(document => document.Spec.DocumentId)
            .Order(StringComparer.Ordinal)
            .ToArray();

        fromBackfill.ShouldBe(fromCatalogue);
    }

    [Fact]
    public async Task A_second_backfill_of_the_same_range_posts_byte_identical_documents()
    {
        var (runner, handler, http) = Harness();
        using var _ = http;

        var command = new BackfillCommand(
            runner, new DevStubsOptions { CredentialVariable = Variable }, NullLogger<BackfillCommand>.Instance);

        await command.RunAsync(
            Granted(DevStubsSubject.Backfill), new DateOnly(2026, 9, 6), days: 1,
            TestContext.Current.CancellationToken);

        var first = handler.Bodies.Order(StringComparer.Ordinal).ToArray();
        handler.Bodies.Clear();

        await command.RunAsync(
            Granted(DevStubsSubject.Backfill), new DateOnly(2026, 9, 6), days: 1,
            TestContext.Current.CancellationToken);

        // Contract §9.4's DUPLICATE is byte-identical, so a re-run of the same range is what
        // exercises it - and that only works because nothing in the chain reads a clock or a
        // random number.
        handler.Bodies.Order(StringComparer.Ordinal).ToArray().ShouldBe(first);
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~BackfillAndCadenceCommandTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'BackfillPlan' could not be found`.

- [ ] **Step 3: Write `BackfillCommand`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/BackfillCommand.cs`:

```csharp
using Microsoft.Extensions.Logging;

namespace PeakPower.DevStubs;

/// <summary>
/// Ninety delivery dates across the eleven seeded connections, as one stream per connection.
/// </summary>
/// <remarks>
/// ⚠ <b>One rule stated once.</b> A day is whatever <c>ScenarioCatalogue.For("daily-cadence", …)</c>
/// says it is — eleven consumption series plus a production series for each of the three recorded
/// EXPECTED, per <c>[DEC-38]</c>'s one document per EAN per day. Restating it here would be a second
/// answer to "what does a normal day look like", and the two would diverge on the first correction.
/// </remarks>
public static class BackfillPlan
{
    /// <summary>
    /// Ninety. Design §3.1, and <c>DevStubsGate.BackfillConfirmation</c> says "ninety days" — the
    /// constant and the sentence the operator typed have to agree.
    /// </summary>
    public const int Days = 90;

    /// <summary>
    /// One list per connection, each in ASCENDING delivery-date order and ending on
    /// <paramref name="lastDeliveryDate"/>.
    /// </summary>
    /// <remarks>
    /// ⚠ The grouping is what lets the command run connections in parallel while keeping each
    /// connection's own dates in order. §4.2 makes receipt order decide which version is current, so
    /// a supersession that arrives before the version it supersedes is a wrong answer — and it is a
    /// bug nobody would think to look for in a backfill.
    /// </remarks>
    public static IReadOnlyList<IReadOnlyList<ScenarioDocument>> Build(
        DateOnly lastDeliveryDate, int days, ScenarioContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentOutOfRangeException.ThrowIfLessThan(days, 1);

        var all = new List<ScenarioDocument>(days * 14);

        for (var offset = days - 1; offset >= 0; offset--)
        {
            var date = lastDeliveryDate.AddDays(-offset);

            // "daily-cadence" reads its delivery date as Today - 1, so handing it the day AFTER the
            // one wanted gets that day's documents. Reusing the catalogue rather than a second copy
            // of the rule is the point; the arithmetic is the price.
            all.AddRange(ScenarioCatalogue.For("daily-cadence", context with { Today = date.AddDays(1) }));
        }

        return
        [
            .. all
                .GroupBy(document => document.Spec.ResourceObject, StringComparer.Ordinal)
                .Select(group => (IReadOnlyList<ScenarioDocument>)
                    [.. group.OrderBy(document => document.Spec.DeliveryDate)
                             .ThenBy(document => document.Spec.Direction, StringComparer.Ordinal)]),
        ];
    }
}

/// <summary>
/// Posts ninety days of generated documents over the real webhook, behind
/// <c>DevStubsGate.Backfill</c>.
/// </summary>
public sealed class BackfillCommand(
    ScenarioRunner runner, DevStubsOptions options, ILogger<BackfillCommand> logger)
{
    /// <summary>
    /// Run the backfill, if the decision says so.
    /// </summary>
    /// <param name="decision">
    /// ⚠ Must be a decision about <see cref="DevStubsSubject.Backfill"/>. A decision reached for the
    /// cadence must not be able to open this command — <c>SeedingGate</c>'s own rule, where
    /// <c>DemoSeeding</c> and <c>EmployeeSeeding</c> each refuse a decision that is not theirs,
    /// because two switches wired to the wrong commands look exactly like two switches wired
    /// correctly until somebody asks for one of them.
    /// </param>
    public async Task<ScenarioRunReport> RunAsync(
        DevStubsDecision decision, DateOnly lastDeliveryDate, int days, CancellationToken ct)
    {
        if (decision.Subject != DevStubsSubject.Backfill)
        {
            throw new ArgumentException(
                $"This is the backfill command and the decision is about {decision.Subject}. A "
                + "decision taken for one subject may not open another.",
                nameof(decision));
        }

        if (!decision.Posts)
        {
            logger.LogInformation(
                "The backfill did not run. {Key} does not carry its confirmation phrase.",
                DevStubsGate.KeyFor(DevStubsSubject.Backfill));

            return new ScenarioRunReport([]);
        }

        var context = ScenarioContext.From(lastDeliveryDate.AddDays(1), options);
        var streams = BackfillPlan.Build(lastDeliveryDate, days, context);

        logger.LogWarning(
            "Backfilling {Days} delivery dates ending {LastDate} across {Connections} connections - "
            + "{Documents} documents to {Webhook}.",
            days,
            lastDeliveryDate,
            streams.Count,
            streams.Sum(stream => stream.Count),
            options.WebhookBaseUri);

        var outcomes = new List<ScenarioPostOutcome>();

        // Concurrency across CONNECTIONS only, bounded by MaxInFlight. Each connection's own stream
        // is posted by one ScenarioRunner call, which is serial by construction (task 20).
        await Parallel.ForEachAsync(
            streams,
            new ParallelOptions { MaxDegreeOfParallelism = options.MaxInFlight, CancellationToken = ct },
            async (stream, token) =>
            {
                var report = await runner.RunAsync(stream, token);

                lock (outcomes)
                {
                    outcomes.AddRange(report.Outcomes);
                }
            });

        var combined = new ScenarioRunReport(outcomes);

        logger.LogInformation(
            "Backfill posted {Posted} documents, {Unexpected} of which did not answer what the "
            + "catalogue expected.",
            combined.Posted, combined.Unexpected);

        return combined;
    }
}
```

- [ ] **Step 4: Write `CadenceCommand`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/CadenceCommand.cs`:

```csharp
using Microsoft.Extensions.Logging;

namespace PeakPower.DevStubs;

/// <summary>
/// Keeps posting one document per EAN per day <c>[DEC-38]</c>, on a loop, behind
/// <c>DevStubsGate.Cadence</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why the cadence pusher exists at all.</b> Integration-spec §11: the mock service is "the same
/// documents, pushed on a schedule, so cadence, duplicates, the correction window <b>and what
/// arrives after it</b> are exercised as well as the format". Silence detection (task 11) is the
/// other half — it measures how long since a document last <b>arrived</b>, so a connection that is
/// healthy has to keep receiving, and this is the only thing in the slice that makes that true.
/// </para>
/// <para>
/// ⚠ <b>The clock is <see cref="TimeProvider"/>.</b> <c>PeakPower.DevStubs</c> cannot reference
/// <c>PeakPower.Infrastructure.Time</c> (contract §3.1) and architecture fact 5 bans
/// <c>DateTime.UtcNow</c> outright, so the today this pushes for comes from
/// <c>TimeProvider.GetUtcNow()</c> — which is on neither banned type, and which a test can drive.
/// </para>
/// <para>
/// ⚠ <b>It is unbounded by construction</b>, which is why it has its own confirmation phrase rather
/// than sharing the backfill's: an operator who agreed to ninety days did not agree to a loop that
/// does not stop by itself.
/// </para>
/// </remarks>
public sealed class CadenceCommand(
    ScenarioRunner runner,
    DevStubsOptions options,
    TimeProvider time,
    ILogger<CadenceCommand> logger)
{
    /// <summary>One delivery date's worth of documents. Fourteen, for the eleven seeded connections.</summary>
    public Task<ScenarioRunReport> PushOnceAsync(DateOnly deliveryDate, CancellationToken ct)
    {
        var context = ScenarioContext.From(deliveryDate.AddDays(1), options);

        // The same call the backfill makes, for the same reason: a day is whatever the catalogue
        // says a day is, stated once.
        return runner.RunAsync(ScenarioCatalogue.For("daily-cadence", context), ct);
    }

    /// <summary>
    /// Push yesterday's documents, then keep pushing on <paramref name="interval"/> until cancelled.
    /// </summary>
    /// <returns>How many documents were posted before the loop was cancelled.</returns>
    public async Task<int> RunAsync(
        DevStubsDecision decision, TimeSpan interval, CancellationToken ct)
    {
        if (decision.Subject != DevStubsSubject.Cadence)
        {
            throw new ArgumentException(
                $"This is the cadence command and the decision is about {decision.Subject}. A "
                + "decision taken for one subject may not open another.",
                nameof(decision));
        }

        if (!decision.Posts)
        {
            logger.LogInformation(
                "The cadence pusher did not run. {Key} does not carry its confirmation phrase.",
                DevStubsGate.KeyFor(DevStubsSubject.Cadence));

            return 0;
        }

        logger.LogWarning(
            "Pushing one document per EAN per day to {Webhook} every {Interval}. This does not stop "
            + "by itself; press Ctrl-C.",
            options.WebhookBaseUri, interval);

        var posted = 0;

        // The TimeProvider overload, so a test drives the ticks and architecture fact 5 holds.
        using var timer = new PeriodicTimer(interval, time);

        do
        {
            // Allocation data for day D arrives on D+1 (design §7.21), so "yesterday" is the
            // ordinary case rather than a convenience - and it is what keeps silence detection
            // seeing a healthy connection.
            var deliveryDate = DateOnly.FromDateTime(
                TimeZoneInfo.ConvertTime(time.GetUtcNow(), AmsterdamDay.Zone).DateTime).AddDays(-1);

            var report = await PushOnceAsync(deliveryDate, ct);
            posted += report.Posted;

            logger.LogInformation(
                "Pushed {Count} documents for {DeliveryDate}. {Unexpected} did not answer what the "
                + "catalogue expected.",
                report.Posted, deliveryDate, report.Unexpected);
        }
        while (await timer.WaitForNextTickAsync(ct));

        return posted;
    }
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~BackfillAndCadenceCommandTests"
```

Expected: PASS — 9 tests.

⚠ `RunAsync`'s `do … while` is never entered by these tests — `PushOnceAsync` is what they exercise.
The loop is proved by the real run in task 22's manual check and by plan 8 task 8's run against the
deployed webhook; a unit test of "it keeps going until cancelled" would be a test of `PeriodicTimer`.

- [ ] **Step 6: MUTATION — accept any granted decision**

Delete the `decision.Subject != …` check from `BackfillCommand.RunAsync`.

Predict: `The_other_subject_s_decision_does_not_open_this_command` fails with
`Should.ThrowAsync<ArgumentException> ... but no exception was thrown`, **and** its second
assertion would have caught the consequence — fourteen bodies posted under a cadence confirmation.

⚠ This is `SeedingGate`'s own argument, restated: two independent switches wired to the wrong
commands look exactly like two independent switches wired correctly, until somebody asks for one of
them. Run, confirm, restore.

- [ ] **Step 7: Second mutation — post the whole backfill in one flat stream**

Replace `BackfillPlan.Build`'s grouping with `[all]` — one stream containing every document.

Predict: `The_plan_is_one_stream_per_connection_and_ninety_dates_each` fails with
`streams.Count should be 11 but was 1`, and `Each_connection_s_own_dates_ascend` fails with the first
stream's dates repeating each date fourteen times rather than ascending once —
`dates.First() should be 2026-09-02 but was 2026-09-02` passing while `dates.ShouldBe(dates.Order())`
also passes, so **watch which assertion actually goes red**: it is the count, and the ordering one
survives because a flat list built date-by-date is already sorted by date.

⚠ Which is worth noticing: the ordering assertion alone would not have caught this. The count is what
does, and the reason to keep both is that the next mutation — parallelising *within* a connection —
breaks the ordering one and leaves the count green.

Run, confirm, restore.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~BackfillAndCadenceCommandTests"
git add src/Hosts/PeakPower.DevStubs/BackfillCommand.cs \
        src/Hosts/PeakPower.DevStubs/CadenceCommand.cs \
        tests/PeakPower.Application.Tests/DevStubs/BackfillAndCadenceCommandTests.cs
git commit -m "Backfill ninety delivery dates, and push one a tick, both behind their own phrase

Design 3.1 and contract 13.2. Ninety dates across eleven connections is 1 260 documents - eleven
consumption series plus three production ones per day - and both commands get a day from
ScenarioCatalogue.For(\"daily-cadence\") rather than restating [DEC-38]'s rule. A second copy here
would be a second answer to what a normal day looks like, and the two would diverge on the first
correction; a test asserts the pusher and the backfill produce identical document ids.

Concurrency across CONNECTIONS, bounded by MaxInFlight, and never within one. 4.2 makes receipt
order decide which version is current, so a supersession arriving before the version it supersedes
is a wrong answer - and it is a bug nobody would look for in a backfill.

Neither command decides for itself, and neither accepts the other subject's decision. That is
SeedingGate's own argument: two switches wired to the wrong commands look exactly like two
switches wired correctly, until somebody asks for one of them. Verified by mutation.

A re-run of the same range posts byte-identical documents, which is what makes contract 9.4's
DUPLICATE reproducible - and which only holds because nothing in the chain reads a clock or a
random number."
```

---

### Task 22: `Program.cs` and its verbs, and the README that says how to point it at a deployed box

The console entry point. Three verbs now — plan 8 adds `loadtest` as a fourth.

⚠ **No `public partial class Program` and no entry-point marker.** Contract §3.1: slice 1's rule
stands, and `PeakPower.DevStubs` is a console host that declares no marker at all — nothing hosts it
under `WebApplicationFactory`.

⚠ **The gate decision is taken here, once per subject, and passed down.** `Program.cs` is the only
place that reads configuration, so a command cannot decide for itself and a decision cannot be reused
for another subject.

⚠ **`--dry-run` renders and prints without posting**, and it is worth having for a reason beyond
convenience: it is how task 15 step 5's cross-process determinism check is run, and it is how somebody
diffs a generated document against integration-spec §6's sample by eye.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/Program.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/README.md`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/DevStubsProgramTests.cs`

**Interfaces:**
- Consumes: everything above; `Microsoft.Extensions.Hosting.Host.CreateApplicationBuilder`;
  `Microsoft.Extensions.Http`'s `AddHttpClient`.
- Produces:
  - `PeakPower.DevStubs.DevStubsVerb { Scenarios, Backfill, Cadence }`
  - `PeakPower.DevStubs.DevStubsInvocation(DevStubsVerb Verb, string? Only, DateOnly? Date, int Days, TimeSpan Interval, bool DryRun)`
  - `PeakPower.DevStubs.DevStubsVerbs.Parse(IReadOnlyList<string> args, DateOnly today)` — `public static DevStubsInvocation`
  - `DevStubsVerbs.Usage` — `public static string`
  - `DevStubsVerbs.UsageExitCode = 64` — `public const int`

⚠ **Plan 8 task 3 adds a `loadtest` verb.** It appends a member to `DevStubsVerb` and an arm to the
parser's `switch`; do not write a count assertion over `DevStubsVerb` here, for the same reason
task 13 does not write one over `DevStubsSubject`.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/DevStubsProgramTests.cs`:

```csharp
using PeakPower.DevStubs;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.DevStubs;

/// <summary>
/// The verb table. Everything the program does after parsing is covered by the tasks above and by
/// <c>ScenarioEndToEndTests</c>; what is left is the one place a typo turns into a surprise.
/// </summary>
public sealed class DevStubsProgramTests
{
    private static readonly DateOnly Today = new(2026, 9, 7);

    [Theory]
    [InlineData("scenarios", DevStubsVerb.Scenarios)]
    [InlineData("backfill", DevStubsVerb.Backfill)]
    [InlineData("cadence", DevStubsVerb.Cadence)]
    public void The_three_verbs_parse(string argument, DevStubsVerb expected)
    {
        DevStubsVerbs.Parse([argument], Today).Verb.ShouldBe(expected);
    }

    /// <summary>
    /// ⚠ An unknown verb is a usage error with a NON-ZERO exit code and the usage text, not a
    /// default. A program that quietly ran the scenarios because somebody typed <c>scenario</c> is a
    /// program that posts documents nobody asked for.
    /// </summary>
    [Theory]
    [InlineData("scenario")]
    [InlineData("Scenarios")]
    [InlineData("--help")]
    [InlineData("")]
    public void An_unknown_verb_is_a_usage_error(string argument)
    {
        var thrown = Should.Throw<DevStubsUsageException>(
            () => DevStubsVerbs.Parse([argument], Today));

        thrown.ExitCode.ShouldBe(DevStubsVerbs.UsageExitCode);
        thrown.Message.Contains("scenarios", StringComparison.Ordinal).ShouldBeTrue();
    }

    [Fact]
    public void No_arguments_at_all_is_a_usage_error_too()
    {
        Should.Throw<DevStubsUsageException>(() => DevStubsVerbs.Parse([], Today));
    }

    [Fact]
    public void The_date_defaults_to_today_and_the_days_to_ninety()
    {
        var invocation = DevStubsVerbs.Parse(["backfill"], Today);

        invocation.Date.ShouldBe(Today);
        invocation.Days.ShouldBe(BackfillPlan.Days);
        invocation.DryRun.ShouldBeFalse();
        invocation.Only.ShouldBeNull();
    }

    [Fact]
    public void The_options_parse()
    {
        var invocation = DevStubsVerbs.Parse(
            ["scenarios", "--only", "dst-autumn-100", "--date", "2026-08-31", "--dry-run"], Today);

        invocation.Verb.ShouldBe(DevStubsVerb.Scenarios);
        invocation.Only.ShouldBe("dst-autumn-100");
        invocation.Date.ShouldBe(new DateOnly(2026, 8, 31));
        invocation.DryRun.ShouldBeTrue();
    }

    [Fact]
    public void A_date_is_parsed_as_iso_and_nothing_else()
    {
        // Invariant, so a machine in nl-NL does not read 03-09-2026 as the third of September and a
        // machine in en-US as the ninth of March. Both would be documents about the wrong day, and
        // neither would say so.
        Should.Throw<DevStubsUsageException>(
            () => DevStubsVerbs.Parse(["backfill", "--date", "31/08/2026"], Today));
    }

    [Fact]
    public void An_option_with_no_value_is_a_usage_error_rather_than_a_silent_default()
    {
        Should.Throw<DevStubsUsageException>(
            () => DevStubsVerbs.Parse(["scenarios", "--only"], Today));
    }

    [Fact]
    public void An_unknown_scenario_key_is_refused_at_parse_time()
    {
        // Before anything is posted, and naming the fourteen. The alternative is a run that reports
        // success having posted nothing.
        var thrown = Should.Throw<DevStubsUsageException>(
            () => DevStubsVerbs.Parse(["scenarios", "--only", "normal_day"], Today));

        thrown.Message.Contains("normal-day", StringComparison.Ordinal).ShouldBeTrue();
    }

    [Fact]
    public void The_cadence_interval_defaults_to_a_day_and_can_be_shortened_for_a_demo()
    {
        DevStubsVerbs.Parse(["cadence"], Today).Interval.ShouldBe(TimeSpan.FromDays(1));

        DevStubsVerbs.Parse(["cadence", "--interval", "00:00:30"], Today).Interval
            .ShouldBe(TimeSpan.FromSeconds(30));
    }

    [Fact]
    public void The_usage_text_names_every_verb_and_both_gate_keys()
    {
        var usage = DevStubsVerbs.Usage;

        foreach (var verb in Enum.GetNames<DevStubsVerb>())
        {
            usage.Contains(verb.ToLowerInvariant(), StringComparison.Ordinal).ShouldBeTrue();
        }

        foreach (var subject in Enum.GetValues<DevStubsSubject>())
        {
            // The key AND the phrase. A usage text that names the key but not the sentence sends the
            // reader to a wiki that does not exist.
            usage.Contains(
                DevStubsGate.KeyFor(subject).Replace(":", "__", StringComparison.Ordinal),
                StringComparison.Ordinal)
                .ShouldBeTrue();
            usage.Contains(DevStubsGate.ConfirmationFor(subject), StringComparison.Ordinal)
                .ShouldBeTrue();
        }
    }
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~DevStubsProgramTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'DevStubsVerbs' could not be found`.

- [ ] **Step 3: Write `Program.cs` and the verb parser**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/Program.cs`:

```csharp
using System.Globalization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using PeakPower.DevStubs;

// No `public partial class Program` and no entry-point marker. Contract §3.1: slice 1's rule stands,
// and this is a console host nothing boots under WebApplicationFactory.

var builder = Host.CreateApplicationBuilder(args);

var options = new DevStubsOptions();
builder.Configuration.GetSection(DevStubsOptions.SectionName).Bind(options);

builder.Services.AddSingleton(options);
builder.Services.AddSingleton(TimeProvider.System);

// A typed client, so the handler lifetime is the factory's business rather than this file's.
builder.Services.AddHttpClient<PvnedWebhookClient>();

// Transient, like the typed client they take. A singleton holding a transient HttpClient would
// capture one handler for the lifetime of the process - harmless in a program that runs for a
// minute, and the wrong habit to establish.
builder.Services.AddTransient<ScenarioRunner>();
builder.Services.AddTransient<BackfillCommand>();
builder.Services.AddTransient<CadenceCommand>();

// Captured BEFORE Build(): the gate reads both, and reaching back through the builder after it has
// been built is a habit that stops working the day HostApplicationBuilder starts enforcing it.
var environment = builder.Environment;
var configuration = builder.Configuration;

using var host = builder.Build();

var logger = host.Services.GetRequiredService<ILoggerFactory>().CreateLogger("PeakPower.DevStubs");
var time = host.Services.GetRequiredService<TimeProvider>();

var today = DateOnly.FromDateTime(
    TimeZoneInfo.ConvertTime(time.GetUtcNow(), AmsterdamDay.Zone).DateTime);

DevStubsInvocation invocation;

try
{
    invocation = DevStubsVerbs.Parse(args, today);
}
catch (DevStubsUsageException usage)
{
    Console.Error.WriteLine(usage.Message);
    return usage.ExitCode;
}

var context = ScenarioContext.From(invocation.Date!.Value.AddDays(1), options);

// --dry-run renders and prints, and posts nothing. Worth having beyond convenience: it is how the
// cross-process determinism of the load shape is checked (task 15 step 5), and how somebody diffs a
// generated document against integration-spec §6's sample by eye.
if (invocation.DryRun)
{
    var documents = invocation.Only is null
        ? ScenarioCatalogue.All(context)
        : ScenarioCatalogue.For(invocation.Only, context);

    foreach (var document in documents)
    {
        Console.WriteLine(
            string.Create(
                CultureInfo.InvariantCulture,
                $"=== {document.ScenarioKey} === {document.Note}"));
        Console.WriteLine(ScenarioRunner.RenderFor(document));
    }

    return 0;
}

// The gate decision is taken HERE, once, and passed down. A command that read configuration itself
// could decide twice while logging once, and a decision could be reused for a subject it was not
// taken for.
switch (invocation.Verb)
{
    case DevStubsVerb.Scenarios:
    {
        // The scenario suite is NOT gated. It posts a few dozen documents at a webhook the operator
        // named, which is what this program is for; the two gates exist for the commands that post
        // a thousand or that never stop. Adding a third phrase for a run of forty documents would
        // train the operator to paste sentences without reading them.
        var runner = host.Services.GetRequiredService<ScenarioRunner>();

        var documents = invocation.Only is null
            ? ScenarioCatalogue.All(context)
            : ScenarioCatalogue.For(invocation.Only, context);

        var report = await runner.RunAsync(documents, CancellationToken.None);

        logger.LogInformation(
            "Posted {Posted} documents; {Unexpected} did not answer what the catalogue expected.",
            report.Posted, report.Unexpected);

        return report.Unexpected == 0 ? 0 : 1;
    }

    case DevStubsVerb.Backfill:
    {
        var decision = DevStubsGate.Decide(
            DevStubsSubject.Backfill, environment, configuration);

        DevStubsGate.Announce(decision, options, logger);

        var report = await host.Services.GetRequiredService<BackfillCommand>()
            .RunAsync(decision, invocation.Date.Value, invocation.Days, CancellationToken.None);

        return report.Unexpected == 0 ? 0 : 1;
    }

    case DevStubsVerb.Cadence:
    {
        var decision = DevStubsGate.Decide(
            DevStubsSubject.Cadence, environment, configuration);

        DevStubsGate.Announce(decision, options, logger);

        using var stopping = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            stopping.Cancel();
        };

        try
        {
            var posted = await host.Services.GetRequiredService<CadenceCommand>()
                .RunAsync(decision, invocation.Interval, stopping.Token);

            logger.LogInformation("The cadence pusher stopped after {Posted} documents.", posted);
        }
        catch (OperationCanceledException)
        {
            logger.LogInformation("The cadence pusher was stopped.");
        }

        return 0;
    }

    default:
        Console.Error.WriteLine(DevStubsVerbs.Usage);
        return DevStubsVerbs.UsageExitCode;
}
```

And the parser, in the same project. Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/DevStubsVerbs.cs`:

```csharp
using System.Globalization;

namespace PeakPower.DevStubs;

/// <summary>What this program can be asked to do. ⚠ Plan 8 appends <c>LoadTest</c>.</summary>
public enum DevStubsVerb { Scenarios, Backfill, Cadence }

/// <summary>One parsed command line.</summary>
public sealed record DevStubsInvocation(
    DevStubsVerb Verb,
    string? Only,
    DateOnly? Date,
    int Days,
    TimeSpan Interval,
    bool DryRun);

/// <summary>A command line that cannot be run, and the exit code to leave with.</summary>
public sealed class DevStubsUsageException(string message) : Exception(message)
{
    /// <summary>64, <c>EX_USAGE</c> from <c>sysexits.h</c>. Not 1, which means "it ran and failed".</summary>
    public int ExitCode => DevStubsVerbs.UsageExitCode;
}

/// <summary>Parses the command line, and refuses anything it does not recognise.</summary>
public static class DevStubsVerbs
{
    /// <summary><c>EX_USAGE</c>.</summary>
    public const int UsageExitCode = 64;

    public static string Usage { get; } = BuildUsage();

    /// <summary>
    /// Parse, or throw <see cref="DevStubsUsageException"/>.
    /// </summary>
    /// <remarks>
    /// ⚠ <b>Nothing defaults to a verb.</b> A program that ran the scenarios because somebody typed
    /// <c>scenario</c> is a program that posts documents nobody asked for, at whatever webhook the
    /// configuration happened to name.
    /// </remarks>
    public static DevStubsInvocation Parse(IReadOnlyList<string> args, DateOnly today)
    {
        ArgumentNullException.ThrowIfNull(args);

        if (args.Count == 0)
        {
            throw new DevStubsUsageException(Usage);
        }

        var verb = args[0] switch
        {
            "scenarios" => DevStubsVerb.Scenarios,
            "backfill" => DevStubsVerb.Backfill,
            "cadence" => DevStubsVerb.Cadence,
            _ => throw new DevStubsUsageException(
                $"'{args[0]}' is not a verb this program has.{Environment.NewLine}{Usage}"),
        };

        string? only = null;
        var date = today;
        var days = BackfillPlan.Days;
        var interval = TimeSpan.FromDays(1);
        var dryRun = false;

        for (var index = 1; index < args.Count; index++)
        {
            switch (args[index])
            {
                case "--dry-run":
                    dryRun = true;
                    break;

                case "--only":
                    only = Value(args, ref index);

                    if (!ScenarioCatalogue.Keys.Contains(only, StringComparer.Ordinal))
                    {
                        // Refused BEFORE anything is posted, and naming the fourteen. The
                        // alternative is a run that reports success having posted nothing.
                        throw new DevStubsUsageException(
                            $"'{only}' is not one of the scenario keys. They are: "
                            + $"{string.Join(", ", ScenarioCatalogue.Keys)}.");
                    }

                    break;

                case "--date":
                    // Invariant ISO, and nothing else. A machine in nl-NL reads 03-09-2026 as the
                    // third of September and one in en-US as the ninth of March; both would post
                    // documents about the wrong day and neither would say so.
                    date = DateOnly.TryParseExact(
                        Value(args, ref index), "yyyy-MM-dd", CultureInfo.InvariantCulture,
                        DateTimeStyles.None, out var parsed)
                        ? parsed
                        : throw new DevStubsUsageException(
                            $"--date must be yyyy-MM-dd. {Usage}");
                    break;

                case "--days":
                    days = int.TryParse(
                        Value(args, ref index), NumberStyles.None, CultureInfo.InvariantCulture,
                        out var parsedDays) && parsedDays > 0
                        ? parsedDays
                        : throw new DevStubsUsageException($"--days must be a positive whole number. {Usage}");
                    break;

                case "--interval":
                    interval = TimeSpan.TryParseExact(
                        Value(args, ref index), "c", CultureInfo.InvariantCulture, out var parsedInterval)
                        && parsedInterval > TimeSpan.Zero
                        ? parsedInterval
                        : throw new DevStubsUsageException(
                            $"--interval must be a positive hh:mm:ss. {Usage}");
                    break;

                default:
                    throw new DevStubsUsageException(
                        $"'{args[index]}' is not an option this program has.{Environment.NewLine}{Usage}");
            }
        }

        return new DevStubsInvocation(verb, only, date, days, interval, dryRun);
    }

    private static string Value(IReadOnlyList<string> args, ref int index)
    {
        // An option with no value is a usage error, not a silent default. `--only` swallowing the
        // next verb, or defaulting to "all", is how a run posts everything when it was asked for one.
        if (index + 1 >= args.Count)
        {
            throw new DevStubsUsageException(
                $"{args[index]} needs a value.{Environment.NewLine}{Usage}");
        }

        return args[++index];
    }

    private static string BuildUsage()
    {
        var lines = new List<string>
        {
            "PeakPower.DevStubs - generates PVNed documents and posts them over the REAL webhook.",
            "",
            "  dotnet run --project src/Hosts/PeakPower.DevStubs -- <verb> [options]",
            "",
            "Verbs:",
            "  scenarios   post the fourteen integration-spec §11 scenarios. Not gated.",
            "  backfill    post ninety delivery dates across the eleven seeded connections. GATED.",
            "  cadence     keep posting one document per EAN per day until stopped. GATED.",
            "",
            "Options:",
            "  --only <key>        one scenario family instead of all fourteen",
            "  --date <yyyy-MM-dd> the last delivery date (default: today, Amsterdam)",
            "  --days <n>          how many delivery dates the backfill covers (default: 90)",
            "  --interval <[d.]hh:mm:ss>  the cadence period (default: 1.00:00:00)",
            "  --dry-run           render and print; post nothing",
            "",
            "Environment:",
            "  DevStubs__WebhookBaseUri   where to post (default: http://localhost:5300)",
            "  DevStubs__BrpCode          the BRP row's code (default: PVNED)",
            "  BRP_CREDENTIAL_PVNED       the shared secret. Empty means every request is 401.",
            "",
            "Gates - each is an ordinary English sentence, verbatim, and not a boolean:",
        };

        foreach (var subject in Enum.GetValues<DevStubsSubject>())
        {
            // DevStubs:Backfill -> DevStubs__Backfill, which is how the reader will actually set it.
            lines.Add(
                $"  {DevStubsGate.KeyFor(subject).Replace(":", "__", StringComparison.Ordinal)}"
                + $"=\"{DevStubsGate.ConfirmationFor(subject)}\"");
        }

        return string.Join(Environment.NewLine, lines);
    }
}
```

⚠ **The usage text prints the environment-variable spelling, `DevStubs__Backfill`, not the
configuration key `DevStubs:Backfill`** — that is how the reader will actually set it, and the
assertion in the test compares against the same transformation.

- [ ] **Step 4: Write the README**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/README.md`:

````markdown
# PeakPower.DevStubs

Generates PVNed `TimeSeriesDocument` XML and posts it over the **real** webhook.

`[F02-R30]` forbids any code path that writes readings directly, so this program has no database
reference and no way to build one. Everything it produces goes through
`POST /webhooks/brp/PVNED`, the real credential check, the real adapter and the real apply
transaction — which is what makes `[DEC-21]`'s "build against generated data" mean something.

**It does not ship in the compose file** (design §3.1). It runs from a developer machine, against a
local stack or against the deployed webhook.

## Against a local stack

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
./dev-up                                   # brings up Postgres, the Migrator and the Worker

export BRP_CREDENTIAL_PVNED=<the value in your local env file>

dotnet run --project src/Hosts/PeakPower.DevStubs -- scenarios
```

## Against the deployed webhook

```bash
export DevStubs__WebhookBaseUri=https://<the box>
export BRP_CREDENTIAL_PVNED=<the same value the Worker has>

dotnet run --project src/Hosts/PeakPower.DevStubs -- scenarios
```

⚠ The credential is the **same value** the Worker reads from `BRP_CREDENTIAL_PVNED`. An empty or
absent one means every request is answered **401** — it never means "no credential required" — and
this program refuses to start rather than finding out on document one of nine hundred and ninety.

## The verbs

| Verb | Gated | What it posts |
| --- | --- | --- |
| `scenarios` | no | the fourteen integration-spec §11 scenarios — a few dozen documents |
| `backfill` | **yes** | ninety delivery dates × eleven connections = 1 260 documents |
| `cadence` | **yes** | one document per EAN per day, on a loop, until Ctrl-C |

The two gates are confirmation phrases, not booleans — the pattern
`src/Hosts/PeakPower.Migrator/SeedingGate.cs` establishes. `true`, `1`, `yes` and the other
subject's phrase all leave the command off and are refused **audibly**:

```bash
export DevStubs__Backfill="yes, post ninety days of generated documents to this webhook"
dotnet run --project src/Hosts/PeakPower.DevStubs -- backfill

export DevStubs__Cadence="yes, keep posting generated documents on the cadence"
dotnet run --project src/Hosts/PeakPower.DevStubs -- cadence --interval 00:05:00
```

## Looking at a document without posting it

```bash
dotnet run --project src/Hosts/PeakPower.DevStubs -- scenarios --only dst-autumn-100 --dry-run
```

Useful for two things: diffing a generated document against integration-spec §6's sample by eye, and
checking that two runs produce byte-identical output — which contract §9.4's `DUPLICATE` depends on.

## What it deliberately cannot do

- **See the parser.** It may not reference `PeakPower.Integration.Brp.Pvned` (contract §3.1). The
  documents are templated **text**, not a serialisation of the parser's model — **S2-D4**, and design
  §8's first risk row explains why: otherwise a shared misreading of the PVNed format passes every
  test in this slice and fails on day one of the real integration.
- **Ask the platform how long a day is.** `AmsterdamDay` computes 92/96/100 from `TimeZoneInfo`,
  independently of `IMarketCalendar`, so the two can disagree — which is what makes "a 96-point
  document is rejected for both DST dates" a real assertion.
- **Write a reading.** No database reference, no `PeakPower.Persistence`, no back door.

## What it does not replace

The **hand-written** negative fixtures in `PeakPower.Integration.Brp.Pvned`'s tests (design §8, §10).
The `invalid-*` documents here drive the pipeline end to end; the adapter's own unit tests are
checked-in fixtures written by hand, and the golden positive document is transcribed by hand from
integration-spec §6. Generating those would put the generator on both sides of the assertion.
````

- [ ] **Step 5: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~DevStubsProgramTests"
```

Expected: PASS — 14 test cases (the two theories expand to three and four).

- [ ] **Step 6: Run it for real against the local stack, and read the output**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
./dev-up
export BRP_CREDENTIAL_PVNED=$(grep BRP_CREDENTIAL_PVNED deploy/env.example | cut -d= -f2)
dotnet run --project src/Hosts/PeakPower.DevStubs -- scenarios --only normal-day --dry-run \
  > /tmp/pp-normal-day.xml
head -30 /tmp/pp-normal-day.xml
```

Read the first thirty lines against integration-spec §6's sample **by eye**, once. This is the only
step in the plan that compares the generator's output with the specification rather than with another
piece of this repository, and it takes two minutes.

Then post it:

```bash
dotnet run --project src/Hosts/PeakPower.DevStubs -- scenarios --only normal-day
```

Expected: one `200`, a correlation id printed, and — after the Worker's queue drains — 96 rows in
`metering.interval_reading` for `871687100000000011`.

⚠ **A `401` here means `BRP_CREDENTIAL_PVNED` does not match what the Worker has**, not that the
route is wrong. Contract §9.4 answers 401 for an unknown BRP code too, so that it cannot be used to
enumerate which BRPs exist — check the code before checking the credential.

- [ ] **Step 7: MUTATION — default an unknown verb to `scenarios`**

Replace the parser's `_ => throw …` arm with `_ => DevStubsVerb.Scenarios`.

Predict: `An_unknown_verb_is_a_usage_error` fails on **all four** rows with
`Should.Throw<DevStubsUsageException> ... but no exception was thrown` — including the `--help` row,
which is the one that matters: somebody typing `--help` would have posted the whole catalogue at
whatever webhook the environment named.

Run, confirm, restore.

- [ ] **Step 8: Second mutation — parse the date with the current culture**

Replace `CultureInfo.InvariantCulture` in the `--date` arm with `CultureInfo.CurrentCulture`.

Predict: `A_date_is_parsed_as_iso_and_nothing_else` **stays green on a machine in en-US or nl-NL**,
because `TryParseExact` with the `"yyyy-MM-dd"` format still refuses `31/08/2026`. Now also drop the
format string and use `DateOnly.TryParse`: the test goes red with
`Should.Throw<DevStubsUsageException> ... but no exception was thrown`.

⚠ Two mutations for one line, because the format string and the culture do different jobs and only
one of them is load-bearing here. Restore both.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo
git add src/Hosts/PeakPower.DevStubs/Program.cs \
        src/Hosts/PeakPower.DevStubs/DevStubsVerbs.cs \
        src/Hosts/PeakPower.DevStubs/README.md \
        tests/PeakPower.Application.Tests/DevStubs/DevStubsProgramTests.cs
git commit -m "Give the generator three verbs, a usage text that names both gate phrases, and a README

No entry-point marker: contract 3.1 keeps slice 1's rule, and this is a console host nothing boots
under WebApplicationFactory.

Nothing defaults to a verb. A program that ran the scenarios because somebody typed 'scenario' is
a program that posts documents nobody asked for, at whatever webhook the configuration named -
verified by mutation, where the --help row is the one that stings. An option with no value and an
unknown scenario key are both refused at parse time, before anything is posted.

--date is invariant ISO and nothing else, because a machine in nl-NL reads 03-09-2026 as the third
of September and one in en-US as the ninth of March; both post documents about the wrong day and
neither says so.

The gate decision is taken in Program.cs, once per subject, and passed down, so a command cannot
decide for itself and a decision cannot be reused for another subject.

The README says how to point it at the deployed box, and says what it deliberately cannot do:
see the parser, ask the platform how long a day is, or write a reading."
```

---

### Task 23: `DevStubsScenarioFixture` and `ScenarioEndToEndTests` — the fourteen through the real webhook, the real adapter and the real apply

Design §5 step 8's independently-testable column: *"The scenario suite drives steps 4–7 end to end
with **no code path writing a reading directly**."* This is that test.

⚠ **Nothing here builds a document.** Every payload comes from `ScenarioCatalogue` and
`ScenarioRunner` — the same code a developer's `devstubs scenarios` run uses. A test that assembled
its own XML would prove the pipeline works on XML the generator never emits, which is the opposite of
what design §5 asks for.

⚠ **Nothing here writes a reading either.** Every row this class asserts on arrived through
`POST /webhooks/brp/PVNED`, contract §9.6's apply transaction, and nothing else. `[F02-R30]`.

⚠ **The queue is drained explicitly.** Plan 3's `WorkerFactory` replaces `IIngestionJobQueue` with
`RecordingIngestionJobQueue`, which records and runs nothing — deliberately, so its own
200-before-processing assertions do not depend on scheduler timing (plan 3 task 6). This fixture adds
a `DrainAsync` that runs `IProcessInboundMessageHandler` for each recorded enqueue **in the order they
were recorded**, which is what makes §4.2's receipt order observable at all.

⚠ **Two rows the demo seeder does not create.** `wrong-brp` needs a second `metering.brp` row and a
metering point assigned to it; `unknown-ean` needs an EAN that is registered nowhere, which is the
absence of a row and needs nothing. Both are arranged in the fixture, in SQL, because plan 2 owns the
entities and this plan may not add a factory to one.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/DevStubs/DevStubsScenarioFixture.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/DevStubs/ScenarioEndToEndTests.cs`

**Interfaces:**
- Consumes: `WorkerFactory`, `RecordingIngestionJobQueue` (plan 3);
  `IProcessInboundMessageHandler` (contract §7.4);
  `PeakPower.Persistence.Seeding.DemoDataSeeder`; `Argon2idPasswordHasher`; `MarketCalendar`;
  `ScenarioCatalogue`, `ScenarioRunner`, `PvnedWebhookClient`, `DevStubsOptions` (tasks 13–20).
- Produces:
  - `PeakPower.Integration.Tests.DevStubs.DevStubsScenarioFixture : WorkerFactory`
  - `DevStubsScenarioFixture.Runner` — `public ScenarioRunner`
  - `DevStubsScenarioFixture.Context` — `public ScenarioContext`
  - `DevStubsScenarioFixture.RunAsync(string family, CancellationToken ct)` — `public Task<ScenarioRunReport>`, posts **and** drains
  - `DevStubsScenarioFixture.DrainAsync(CancellationToken ct)` — `public Task<int>`

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/DevStubs/ScenarioEndToEndTests.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.DevStubs;
using PeakPower.Domain.Metering;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.DevStubs;

/// <summary>
/// Design §5 step 8: the scenario suite drives steps 4–7 end to end, with no code path writing a
/// reading directly.
/// <para>
/// ⚠ <b>Every payload in this class comes from <c>ScenarioCatalogue</c> and <c>ScenarioRunner</c></b>
/// — the same code a developer's <c>devstubs scenarios</c> run uses. A test that assembled its own
/// XML would prove the pipeline works on XML the generator never emits.
/// </para>
/// </summary>
public sealed class ScenarioEndToEndTests(DevStubsScenarioFixture fixture)
    : IClassFixture<DevStubsScenarioFixture>
{
    private static readonly CancellationToken Ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_normal_day_lands_ninety_six_readings()
    {
        var report = await fixture.RunAsync("normal-day", Ct);

        report.Unexpected.ShouldBe(0);

        await using var db = fixture.CreateOwnerDbContext();

        var document = ScenarioCatalogue.For("normal-day", fixture.Context).Single();

        var version = await db.IntervalDataVersions
            .SingleAsync(
                candidate => candidate.DocumentId == document.Spec.DocumentId, Ct);

        version.IsCurrent.ShouldBeTrue();
        version.Direction.ShouldBe(IntervalDirection.Consumption);
        version.Source.ShouldBe(IntervalDataVersionSource.BrpFeed);

        (await db.IntervalReadings.CountAsync(
            reading => reading.IntervalDataVersionId == version.Id, Ct))
            .ShouldBe(96);
    }

    /// <summary>
    /// <c>[F02-R32]</c> and design §7.8. The connection is recorded NEVER, only an A02 series
    /// arrives, and the day reaches complete — which is the case a <c>directions.Count == 2</c>
    /// implementation gets wrong, and the case that stops every non-producing connection invoicing
    /// when it does.
    /// </summary>
    [Fact]
    public async Task A_declared_zero_connection_reaches_complete_on_consumption_alone()
    {
        await fixture.RunAsync("no-production-series", Ct);

        await using var db = fixture.CreateOwnerDbContext();

        var document = ScenarioCatalogue.For("no-production-series", fixture.Context).Single();
        var point = await fixture.MeteringPointIdAsync(document.Spec.ResourceObject, Ct);

        var state = await db.MeteringPointDayStates.SingleAsync(
            candidate => candidate.MeteringPointId == point
                && candidate.DeliveryDate == document.Spec.DeliveryDate,
            Ct);

        state.State.ShouldBe(MeteringDayState.Provisional);
        state.ProductionIsDeclaredZero.ShouldBeTrue();
        state.ProductionComplete.ShouldBeTrue();
    }

    /// <summary>
    /// Byte-identical on the wire to the case above (integration-spec §4.1.1), and the opposite
    /// answer — because the connection is recorded EXPECTED. The discriminator is master data and
    /// nothing else.
    /// </summary>
    [Fact]
    public async Task The_same_document_shape_stays_partial_for_a_connection_that_should_produce()
    {
        await fixture.RunAsync("missing-production-series", Ct);

        await using var db = fixture.CreateOwnerDbContext();

        var document = ScenarioCatalogue.For("missing-production-series", fixture.Context).Single();
        var point = await fixture.MeteringPointIdAsync(document.Spec.ResourceObject, Ct);

        var state = await db.MeteringPointDayStates.SingleAsync(
            candidate => candidate.MeteringPointId == point
                && candidate.DeliveryDate == document.Spec.DeliveryDate,
            Ct);

        state.State.ShouldBe(MeteringDayState.Partial);
        state.ProductionIsDeclaredZero.ShouldBeFalse();

        (await db.OperationalAlerts.CountAsync(
            alert => alert.MeteringPointId == point
                && alert.Kind == OperationalAlertKind.MissingProductionDeclaration
                && alert.Status == OperationalAlertStatus.Open,
            Ct))
            .ShouldBe(1);
    }

    [Fact]
    public async Task Both_directions_produce_two_current_versions_and_a_complete_day()
    {
        await fixture.RunAsync("both-directions", Ct);

        await using var db = fixture.CreateOwnerDbContext();

        var documents = ScenarioCatalogue.For("both-directions", fixture.Context);
        var point = await fixture.MeteringPointIdAsync(documents[0].Spec.ResourceObject, Ct);
        var date = documents[0].Spec.DeliveryDate;

        (await db.IntervalDataVersions.CountAsync(
            version => version.MeteringPointId == point
                && version.DeliveryDate == date
                && version.IsCurrent,
            Ct))
            .ShouldBe(2);

        var state = await db.MeteringPointDayStates.SingleAsync(
            candidate => candidate.MeteringPointId == point && candidate.DeliveryDate == date, Ct);

        state.ConsumptionComplete.ShouldBeTrue();
        state.ProductionComplete.ShouldBeTrue();
        state.ProductionIsDeclaredZero.ShouldBeFalse();
    }

    /// <summary>
    /// Design §7.11 and §4.1, through the whole pipeline rather than against the calculator. On a day
    /// where production exceeds consumption in some intervals, the stored accumulators are the
    /// per-interval ones and not the daily-totals answer.
    /// </summary>
    [Fact]
    public async Task A_day_with_export_stores_offtake_and_export_separately()
    {
        await fixture.RunAsync("production-exceeds-consumption", Ct);

        await using var db = fixture.CreateOwnerDbContext();

        var documents = ScenarioCatalogue.For("production-exceeds-consumption", fixture.Context);
        var point = await fixture.MeteringPointIdAsync(documents[0].Spec.ResourceObject, Ct);
        var date = documents[0].Spec.DeliveryDate;

        var position = await db.DailyPositions.SingleAsync(
            candidate => candidate.MeteringPointId == point && candidate.DeliveryDate == date, Ct);

        position.ExportKwh.ShouldBeGreaterThan(0m);
        position.OfftakeKwh.ShouldBeGreaterThan(0m);

        // The identity that holds per interval and NOT for the daily-totals shortcut: offtake minus
        // export is the net, whatever the shape of the day.
        (position.OfftakeKwh - position.ExportKwh).ShouldBe(position.NetUsageKwh);

        // And the shortcut's own answer is different, which is what makes the assertion above worth
        // making: max(Sc - Sp, 0) is not S max(c - p, 0).
        position.OfftakeKwh.ShouldBeGreaterThan(Math.Max(position.NetUsageKwh, 0m));
    }

    [Theory]
    [InlineData("dst-spring-92", 92)]
    [InlineData("dst-autumn-100", 100)]
    public async Task A_dst_day_lands_the_point_count_its_date_requires(string family, int expected)
    {
        await fixture.RunAsync(family, Ct);

        await using var db = fixture.CreateOwnerDbContext();

        var document = ScenarioCatalogue.For(family, fixture.Context).Single();

        var version = await db.IntervalDataVersions.SingleAsync(
            candidate => candidate.DocumentId == document.Spec.DocumentId, Ct);

        (await db.IntervalReadings.CountAsync(
            reading => reading.IntervalDataVersionId == version.Id, Ct))
            .ShouldBe(expected);

        var state = await db.MeteringPointDayStates.SingleAsync(
            candidate => candidate.MeteringPointId == version.MeteringPointId
                && candidate.DeliveryDate == version.DeliveryDate,
            Ct);

        state.ExpectedIntervalCount.ShouldBe((short)expected);
    }

    [Fact]
    public async Task A_correction_supersedes_and_the_superseded_version_stays_queryable()
    {
        await fixture.RunAsync("correction-supersedes", Ct);

        await using var db = fixture.CreateOwnerDbContext();

        var pair = ScenarioCatalogue.For("correction-supersedes", fixture.Context);

        var first = await db.IntervalDataVersions.SingleAsync(
            version => version.DocumentId == pair[0].Spec.DocumentId, Ct);
        var second = await db.IntervalDataVersions.SingleAsync(
            version => version.DocumentId == pair[1].Spec.DocumentId, Ct);

        second.IsCurrent.ShouldBeTrue();

        // Retained, not deleted. [F02-R21]'s diff is deferred but the rows it would read are not.
        first.IsCurrent.ShouldBeFalse();
    }

    /// <summary>
    /// ⚠ §4.2, end to end and through the generator. The <b>later-created</b> document is posted
    /// FIRST, so the <b>earlier-created</b> one is received second — and it is the one that must be
    /// current. This is the scenario design §10.2's mutation is written against.
    /// </summary>
    [Fact]
    public async Task Receipt_order_governs_and_not_created_date_time()
    {
        await fixture.RunAsync("out-of-order-pair", Ct);

        await using var db = fixture.CreateOwnerDbContext();

        var posted = ScenarioCatalogue.For("out-of-order-pair", fixture.Context);

        var receivedFirst = await db.IntervalDataVersions.SingleAsync(
            version => version.DocumentId == posted[0].Spec.DocumentId, Ct);
        var receivedSecond = await db.IntervalDataVersions.SingleAsync(
            version => version.DocumentId == posted[1].Spec.DocumentId, Ct);

        // posted[0] has the LATER CreatedDateTime; posted[1] is received second and wins.
        posted[0].Spec.DocumentCreated.ShouldBeGreaterThan(posted[1].Spec.DocumentCreated);

        receivedSecond.IsCurrent.ShouldBeTrue();
        receivedFirst.IsCurrent.ShouldBeFalse();
    }

    [Theory]
    [InlineData("unknown-ean", QuarantineReason.UnknownEan)]
    [InlineData("wrong-brp", QuarantineReason.WrongBrp)]
    public async Task A_quarantine_scenario_reaches_processed_and_writes_no_reading(
        string family, QuarantineReason reason)
    {
        var before = await fixture.IntervalReadingCountAsync(Ct);

        var report = await fixture.RunAsync(family, Ct);

        report.Outcomes.ShouldAllBe(outcome => outcome.StatusCode == 200);

        await using var db = fixture.CreateOwnerDbContext();

        var document = ScenarioCatalogue.For(family, fixture.Context).Single();

        var message = await db.InboundMessages.SingleAsync(
            candidate => candidate.CorrelationId
                == Guid.Parse(report.Outcomes[0].CorrelationId!),
            Ct);

        // PROCESSED, not FAILED. Quarantine is a storage state with a replay path (contract §8.5).
        message.Status.ShouldBe(InboundMessageStatus.Processed);

        var quarantined = await db.QuarantinedSeries.SingleAsync(
            candidate => candidate.InboundMessageId == message.Id, Ct);

        // The enum member, not a string. QuarantineReason is UnknownEan in C# and UNKNOWN_EAN in
        // the database, and the two are related by EnumToScreamingSnakeConverter rather than by
        // ToString() - so comparing spellings would pass for these two and silently pass for a
        // third that the converter spells differently.
        quarantined.Reason.ShouldBe(reason);

        quarantined.ResourceObject.ShouldBe(document.Spec.ResourceObject);

        // Asserted by ROW COUNT, not by a status field: a status can be wrong and a count cannot.
        (await fixture.IntervalReadingCountAsync(Ct)).ShouldBe(before);
    }

    /// <summary>
    /// The eleven adapter codes, one document each, all answered <b>200</b> and all landing
    /// <c>FAILED</c> with the named code and <b>zero</b> readings. <c>[F02-R05]</c>: once the payload
    /// is stored, no processing failure may produce a non-2xx.
    /// </summary>
    [Fact]
    public async Task Every_invalid_document_lands_failed_with_its_own_code_and_no_readings()
    {
        var before = await fixture.IntervalReadingCountAsync(Ct);

        var documents = ScenarioCatalogue.For("invalid-<code>", fixture.Context)
            .Where(document => document.ExpectedFailureCode is not null)
            .ToArray();

        documents.Length.ShouldBe(11);

        var report = await fixture.RunDocumentsAsync(documents, Ct);

        report.Unexpected.ShouldBe(0);

        await using var db = fixture.CreateOwnerDbContext();

        for (var index = 0; index < documents.Length; index++)
        {
            var message = await db.InboundMessages.SingleAsync(
                candidate => candidate.CorrelationId
                    == Guid.Parse(report.Outcomes[index].CorrelationId!),
                Ct);

            message.Status.ShouldBe(
                InboundMessageStatus.Failed,
                $"{documents[index].ScenarioKey} should have failed");

            message.FailureCode.ShouldBe(documents[index].ExpectedFailureCode);
            message.FailureMessage.ShouldNotBeNullOrWhiteSpace();
        }

        (await fixture.IntervalReadingCountAsync(Ct)).ShouldBe(before);
    }

    /// <summary>
    /// <c>[DEC-98]</c>, <c>[F02-R45]</c> and design §7.12. A correction landing well after the ten
    /// working days reopens the date to PROVISIONAL and raises the informational notice.
    /// </summary>
    [Fact]
    public async Task A_post_window_reconciliation_reopens_a_finalised_date()
    {
        var document = ScenarioCatalogue.For("post-window-reconciliation", fixture.Context).Single();
        var point = await fixture.MeteringPointIdAsync(document.Spec.ResourceObject, Ct);

        // Arrange the FINAL: post the day, then run the finalisation job with a clock far enough
        // past it. Not by writing FINAL into the table - that would prove the recomputer reads a
        // column this test wrote rather than that the job puts it there.
        await fixture.RunAsync("post-window-reconciliation", Ct);
        await fixture.FinaliseAsync(document.Spec.DeliveryDate.AddDays(30), Ct);

        await using (var arranged = fixture.CreateOwnerDbContext())
        {
            (await arranged.MeteringPointDayStates.SingleAsync(
                candidate => candidate.MeteringPointId == point
                    && candidate.DeliveryDate == document.Spec.DeliveryDate,
                Ct))
                .State.ShouldBe(MeteringDayState.Final);
        }

        // A second, different document for the same date. Same scenario, one ordinal on.
        await fixture.RunDocumentsAsync(
            [document with
            {
                // A fixed id, not Guid.NewGuid(): a re-run of this test must post the same bytes, or
                // the second run hits contract §9.4's 24-hour dedupe on a different document each
                // time and the failure looks like flakiness.
                Spec = document.Spec with { DocumentId = "0199c0de-0000-7000-8000-00000000f001" },
            }],
            Ct);

        await using var db = fixture.CreateOwnerDbContext();

        var state = await db.MeteringPointDayStates.SingleAsync(
            candidate => candidate.MeteringPointId == point
                && candidate.DeliveryDate == document.Spec.DeliveryDate,
            Ct);

        state.State.ShouldBe(MeteringDayState.Provisional);
        state.LastCorrectedAt.ShouldNotBeNull();

        (await db.OperationalAlerts.CountAsync(
            alert => alert.MeteringPointId == point
                && alert.Kind == OperationalAlertKind.PostWindowReconciliation,
            Ct))
            .ShouldBe(1);
    }

    /// <summary>
    /// Contract §9.4: a byte-identical payload from the same BRP within 24 h is recorded
    /// <c>DUPLICATE</c> and nothing is enqueued. Reachable here only because every step from the load
    /// shape to the <c>mRID</c> is deterministic.
    /// </summary>
    [Fact]
    public async Task Posting_the_same_scenario_twice_records_a_duplicate_and_no_second_version()
    {
        await fixture.RunAsync("normal-day", Ct);

        await using var db = fixture.CreateOwnerDbContext();

        var document = ScenarioCatalogue.For("normal-day", fixture.Context).Single();

        var versionsBefore = await db.IntervalDataVersions.CountAsync(
            version => version.DocumentId == document.Spec.DocumentId, Ct);

        var report = await fixture.RunAsync("normal-day", Ct);

        report.Outcomes.ShouldAllBe(outcome => outcome.StatusCode == 200);

        var duplicate = await db.InboundMessages.SingleAsync(
            candidate => candidate.CorrelationId == Guid.Parse(report.Outcomes[0].CorrelationId!),
            Ct);

        duplicate.Status.ShouldBe(InboundMessageStatus.Duplicate);

        (await db.IntervalDataVersions.CountAsync(
            version => version.DocumentId == document.Spec.DocumentId, Ct))
            .ShouldBe(versionsBefore);
    }

    /// <summary>
    /// <c>[DEC-38]</c> across every seeded connection at once, which is the closest this suite gets to
    /// a day in production.
    /// </summary>
    [Fact]
    public async Task The_daily_cadence_lands_a_day_for_every_seeded_connection()
    {
        var report = await fixture.RunAsync("daily-cadence", Ct);

        report.Unexpected.ShouldBe(0);
        report.Posted.ShouldBe(SeededConnections.Count + SeededConnections.Producing.Count);

        await using var db = fixture.CreateOwnerDbContext();

        var date = ScenarioCatalogue.For("daily-cadence", fixture.Context)[0].Spec.DeliveryDate;

        (await db.MeteringPointDayStates.CountAsync(
            state => state.DeliveryDate == date, Ct))
            .ShouldBe(SeededConnections.Count);
    }
}
```

⚠ **The quarantine theory compares the enum member, never a spelling.** `QuarantineReason` is
`UnknownEan` in C# and `UNKNOWN_EAN` in the database (contract §4), and the two are related by
`EnumToScreamingSnakeConverter` rather than by `ToString()` — a comparison written against the
spellings would pass for these two and silently pass for a third the converter spells differently.

⚠ **`WorkerFactory` must not be `sealed`.** Plan 3's draft declares it
`public sealed class WorkerFactory` and then declares `TwoAdapterFactory : WorkerFactory` and three
`FakeAdapterFactory : WorkerFactory` subclasses of its own, so by the time this task runs plan 3 has
already had to drop the modifier or it does not compile. If it is still there, drop it — and say so
in the commit, because it is plan 3's file.

- [ ] **Step 2: Write `DevStubsScenarioFixture`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/DevStubs/DevStubsScenarioFixture.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.DevStubs;
using PeakPower.Infrastructure.Identity;
using PeakPower.Infrastructure.Time;
using PeakPower.Ingestion.Jobs;
using PeakPower.Integration.Tests.Ingestion;
using PeakPower.Persistence.Seeding;
using Xunit;

namespace PeakPower.Integration.Tests.DevStubs;

/// <summary>
/// Plan 3's <see cref="WorkerFactory"/> with the demo roster seeded, a second BRP for the
/// <c>wrong-brp</c> scenario, and a drain that runs the recorded jobs in the order they were
/// enqueued.
/// </summary>
/// <remarks>
/// <para>
/// ⚠ <b>The drain is what makes §4.2 observable.</b> <see cref="RecordingIngestionJobQueue"/> records
/// and runs nothing — deliberately, so plan 3's 200-before-processing assertions do not depend on
/// scheduler timing. Running the recorded jobs <b>in order</b>, one at a time, is what turns "posted
/// second" into "applied second"; a drain that ran them concurrently would make every supersession
/// assertion in this suite a coin toss.
/// </para>
/// <para>
/// <b>The credential lives in a variable named for this fixture.</b> The process environment is
/// shared by every test in the assembly, and <c>BRP_CREDENTIAL_PVNED</c> set here would leak into
/// plan 3's credential tests, which are written against a stub source precisely to avoid that. The
/// BRP row's <c>credential_ref</c> still says <c>BRP_CREDENTIAL_PVNED</c>; only DevStubs' own
/// <see cref="DevStubsOptions.CredentialVariable"/> is different, and both resolve to the same
/// secret.
/// </para>
/// </remarks>
public sealed class DevStubsScenarioFixture : WorkerFactory
{
    private const string CredentialVariable = "PP_DEVSTUBS_FIXTURE_CREDENTIAL";
    private const string Secret = "devstubs-fixture-shared-secret";

    private int _drained;

    /// <summary>The BRP row the <c>wrong-brp</c> scenario's metering point is assigned to.</summary>
    public Guid OtherBrpId { get; } = Guid.Parse("0199b111-0000-7000-8000-0000000000b2");

    public ScenarioContext Context { get; private set; } = null!;

    public ScenarioRunner Runner { get; private set; } = null!;

    public new async ValueTask InitializeAsync()
    {
        await base.InitializeAsync();

        Environment.SetEnvironmentVariable(CredentialVariable, Secret);

        // The BRP row's credential_ref is BRP_CREDENTIAL_PVNED and the stub source is keyed by that
        // name; DevStubs reads its own variable. Both are this one secret.
        Credentials.Set("BRP_CREDENTIAL_PVNED", Secret);

        await SeedDemoRosterAsync();
        await SeedSecondBrpAsync();

        var client = CreateWebhookClient();

        var options = new DevStubsOptions
        {
            // The in-memory server's own base address, so PvnedWebhookClient's absolute URI resolves
            // to this host rather than to a localhost port nothing is listening on.
            WebhookBaseUri = client.BaseAddress!,
            BrpCode = "PVNED",
            CredentialVariable = CredentialVariable,
        };

        Context = ScenarioContext.From(new DateOnly(2026, 9, 7), options);

        // The catalogue's default wrong-BRP EAN and the one this fixture seeds must be the same
        // number. Checked rather than assumed: if they diverge, `wrong-brp` quarantines as
        // UNKNOWN_EAN instead and passes the wrong assertion for the wrong reason.
        if (!string.Equals(Context.WrongBrpEan, WrongBrpEan, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                $"ScenarioContext.From names {Context.WrongBrpEan} as the wrong-BRP EAN and this "
                + $"fixture seeds {WrongBrpEan}. They have to be the same row.");
        }

        Runner = new ScenarioRunner(
            new PvnedWebhookClient(client, options), NullLogger<ScenarioRunner>.Instance);
    }

    public override async ValueTask DisposeAsync()
    {
        Environment.SetEnvironmentVariable(CredentialVariable, null);
        await base.DisposeAsync();
    }

    /// <summary>An eighteen-digit EAN registered to <see cref="OtherBrpId"/> and nobody else.</summary>
    public string WrongBrpEan => "871687109900000002";

    /// <summary>Post one scenario family's documents, in order, then drain the queue.</summary>
    public async Task<ScenarioRunReport> RunAsync(string family, CancellationToken ct) =>
        await RunDocumentsAsync(ScenarioCatalogue.For(family, Context), ct);

    /// <summary>Post exactly these documents, in order, then drain.</summary>
    public async Task<ScenarioRunReport> RunDocumentsAsync(
        IReadOnlyList<ScenarioDocument> documents, CancellationToken ct)
    {
        var report = await Runner.RunAsync(documents, ct);

        await DrainAsync(ct);

        return report;
    }

    /// <summary>
    /// Run every job the receipt path enqueued since the last drain, <b>in order, one at a time</b>.
    /// </summary>
    /// <returns>How many were run.</returns>
    public async Task<int> DrainAsync(CancellationToken ct)
    {
        var pending = Queue.Enqueued.Skip(_drained).ToArray();

        foreach (var (inboundMessageId, correlationId) in pending)
        {
            // A scope per job, exactly as a real queue consumer would: the apply transaction owns a
            // DbContext for the length of one message and no longer.
            await using var scope = Services.CreateAsyncScope();

            await scope.ServiceProvider
                .GetRequiredService<IProcessInboundMessageHandler>()
                .HandleAsync(inboundMessageId, correlationId, ct);
        }

        _drained += pending.Length;

        return pending.Length;
    }

    /// <summary>Run the finalisation job as if today were <paramref name="today"/>.</summary>
    public async Task<int> FinaliseAsync(DateOnly today, CancellationToken ct)
    {
        await using var db = CreateOwnerDbContext();

        var calendar = new MarketCalendar(
            new Microsoft.Extensions.Time.Testing.FakeTimeProvider(
                new DateTimeOffset(today.ToDateTime(new TimeOnly(6, 0)), TimeSpan.Zero)));

        return await new DayFinalisationJob(db, calendar, NullLogger<DayFinalisationJob>.Instance)
            .RunAsync(ct);
    }

    public async Task<Guid> MeteringPointIdAsync(string ean, CancellationToken ct)
    {
        await using var db = CreateOwnerDbContext();

        return (await db.MeteringPoints.SingleAsync(point => point.Ean.Value == ean, ct)).Id;
    }

    public async Task<int> IntervalReadingCountAsync(CancellationToken ct)
    {
        await using var db = CreateOwnerDbContext();

        return await db.IntervalReadings.CountAsync(ct);
    }

    private async Task SeedDemoRosterAsync()
    {
        await using var db = CreateOwnerDbContext();

        // The real seeder, so SeededConnections' transcription and the rows in this database come
        // from one list rather than from two that agree today.
        await new DemoDataSeeder(db, new Argon2idPasswordHasher(), new MarketCalendar(TimeProvider.System))
            .SeedAsync(CancellationToken.None);
    }

    private async Task SeedSecondBrpAsync()
    {
        await using var db = CreateOwnerDbContext();

        // Raw SQL: plan 2 owns the entities and this plan may not add a factory to one. A second BRP
        // row plus a metering point assigned to it is the whole of what wrong-brp needs, and
        // [F02-R43] decides it against the assignment in force at RECEIPT time - which is this one.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO metering.brp
                 (id, code, name, is_active, endpoint_uri, credential_ref, document_format,
                  adapter_key, expected_cadence, created_at)
             VALUES
                 ({OtherBrpId}, 'OTHER', 'Another BRP', true, 'https://example.invalid/other',
                  'BRP_CREDENTIAL_OTHER', 'PVNED_TIMESERIES_XML_V2P0',
                  'PVNED_TIMESERIES_XML_V2P0', 'DAILY_PER_EAN', now())
             ON CONFLICT (id) DO NOTHING
             """,
            CancellationToken.None);

        var customerId = await db.Customers.Select(customer => customer.Id).FirstAsync();

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO customer.metering_point
                 (id, customer_id, ean, brp_id, brp_assigned_at, production_expectation,
                  expectation_source, commodity, name, grid_operator, capacity_kw, validity,
                  created_at)
             VALUES
                 (gen_random_uuid(), {customerId}, {WrongBrpEan}, {OtherBrpId}, now(),
                  'UNKNOWN', 'CUSTOMER_DECLARED', 'ELECTRICITY', 'Assigned elsewhere', 'Enexis',
                  1000, daterange(DATE '2024-01-01', NULL), now())
             ON CONFLICT DO NOTHING
             """,
            CancellationToken.None);
    }
}
```

⚠ **The two `INSERT`s name migration 9's columns and plan 2 owns them.** Read
`src/Infrastructure/PeakPower.Persistence/Migrations/*IngestionAndIntervalData.cs` before running,
and correct any column name that has moved — a fixture that fails to insert is a fixture whose
`wrong-brp` scenario quietly quarantines as `UNKNOWN_EAN` instead, which passes the wrong assertion
for the wrong reason.

⚠ **`WorkerFactory.InitializeAsync` is not virtual** (plan 3 declares it on `IAsyncLifetime`), so this
override is `new` and xUnit calls the **most derived** one because the fixture is constructed as
`DevStubsScenarioFixture`. If plan 3 made it `virtual`, use `override` instead — the `new` above will
then produce a `CS0114` warning, which `-warnaserror` turns into a build failure that names the fix.

- [ ] **Step 3: Run the tests and watch them fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~ScenarioEndToEndTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'DevStubsScenarioFixture' could not be found` on the first
run; then, once the fixture compiles, the first real red is whichever scenario the pipeline does not
yet satisfy.

⚠ **This is the one task in the plan whose first red is not a single named message.** Fourteen
scenarios exercise plans 1 to 4 as well as this one, and a failure here can belong to any of them.
Work down the list in the order the tests are written — `A_normal_day_lands_ninety_six_readings`
first — and fix the pipeline, not the test: every assertion here is design §7's, restated.

- [ ] **Step 4: Run them and watch them pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~ScenarioEndToEndTests"
```

Expected: PASS — 15 test cases (the two theories expand to two each).

- [ ] **Step 5: MUTATION — drain the queue concurrently**

Replace `DrainAsync`'s `foreach` with a `Task.WhenAll` over `pending`.

Predict: `Receipt_order_governs_and_not_created_date_time` fails **intermittently** with
`receivedSecond.IsCurrent should be True but was False`, and
`A_correction_supersedes_and_the_superseded_version_stays_queryable` fails the same way.

⚠ Run it five times. If it passes five times, the advisory lock in contract §9.6 step 4 is
serialising the two applications and hiding the race — which is the lock working, and it is worth
knowing that this suite's ordering guarantee comes from the fixture *and* the lock rather than from
either alone. Note what you observed in the commit message.

Restore the `foreach`.

- [ ] **Step 6: Second mutation — post the out-of-order pair in created order**

In `ScenarioCatalogue`, change `Correction`'s return for `outOfOrder: true` to `[first, second]`.

Predict: `Receipt_order_governs_and_not_created_date_time` fails on its **arrange** assertion first —
`posted[0].Spec.DocumentCreated should be greater than posted[1].Spec.DocumentCreated` — rather than
on the outcome. That is the right place to fail: the scenario stopped being the scenario, and a test
that only checked the outcome would have gone green while testing `correction-supersedes` twice under
two names.

Run, confirm which assertion fails, restore.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~ScenarioEndToEndTests"
git add tests/PeakPower.Integration.Tests/DevStubs/DevStubsScenarioFixture.cs \
        tests/PeakPower.Integration.Tests/DevStubs/ScenarioEndToEndTests.cs
git commit -m "Drive the fourteen scenarios through the real webhook, adapter and apply transaction

Design 5 step 8: the scenario suite drives steps 4-7 end to end with no code path writing a
reading directly. Every payload here comes from ScenarioCatalogue and ScenarioRunner - the same
code a developer's 'devstubs scenarios' run uses - because a test that assembled its own XML would
prove the pipeline works on XML the generator never emits.

The drain runs plan 3's recorded jobs IN ORDER, one at a time, which is what turns 'posted second'
into 'applied second' and makes 4.2 observable. Verified by mutation: draining concurrently makes
both supersession tests intermittent.

And the out-of-order pair fails on its ARRANGE assertion when the catalogue posts it in created
order - the right place to fail, because a test that only checked the outcome would have gone
green while testing correction-supersedes twice under two names.

The credential lives in a variable named for this fixture rather than in BRP_CREDENTIAL_PVNED:
the process environment is shared by the whole assembly, and plan 3's credential tests are written
against a stub source precisely to keep it out."
```

---

### Task 24: `SizeBoundaryTests` — 26 214 400 accepted, 26 214 401 refused

Design §7.3 and contract §9.4 pin **both** sides of the limit, and the difference between them is one
byte. This is the last task in the plan because it is the only one that needs the whole chain — the
template's exact-byte padding, the client's UTF-8 body, and the Worker's `Content-Length` check —
and because it is the slowest.

⚠ **The 413 is answered *before* the payload is stored, and it is the only status in the catalogue
that is.** Contract §9.4: once the payload is durable, no processing failure may produce a non-2xx
(`[F02-R05]`). So the 26 MB document leaves **no** `inbound_message` row at all, and the 25 MB one
leaves a complete one — asserted by row count on both sides.

⚠ **Kept out of `ScenarioEndToEndTests` on purpose.** Two 26 MB request bodies through an in-memory
server is measurably slower than the other fourteen scenarios put together, and mixing them in makes
a suite people start skipping.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/DevStubs/SizeBoundaryTests.cs`

**Interfaces:**
- Consumes: `DevStubsScenarioFixture` (task 23); `ScenarioCatalogue.SizeAccepted`, `.SizeRefused`
  (task 18); `ScenarioRunner.RenderFor` (task 20).
- Produces: `PeakPower.Integration.Tests.DevStubs.SizeBoundaryTests` — a test class and nothing else.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/DevStubs/SizeBoundaryTests.cs`:

```csharp
using System.Text;
using Microsoft.EntityFrameworkCore;
using PeakPower.DevStubs;
using PeakPower.Domain.Metering;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.DevStubs;

/// <summary>
/// Contract §9.4 and design §7.3, both sides of a boundary one byte wide.
/// <para>
/// ⚠ <b>The 413 is answered BEFORE the payload is stored</b>, and it is the only status in the whole
/// catalogue that is. <c>[F02-R05]</c>: once the payload is durable no processing failure may produce
/// a non-2xx, so a refused document leaves <b>no</b> <c>inbound_message</c> row at all — which is
/// asserted here by row count on both sides rather than by a status.
/// </para>
/// </summary>
public sealed class SizeBoundaryTests(DevStubsScenarioFixture fixture)
    : IClassFixture<DevStubsScenarioFixture>
{
    private static readonly CancellationToken Ct = TestContext.Current.CancellationToken;

    private static ScenarioDocument Document(string key, ScenarioContext context) =>
        ScenarioCatalogue.For("invalid-<code>", context)
            .Single(document => document.ScenarioKey == key);

    [Fact]
    public void The_two_documents_are_exactly_one_byte_apart()
    {
        var accepted = ScenarioRunner.RenderFor(Document("size-25mb", fixture.Context));
        var refused = ScenarioRunner.RenderFor(Document("size-26mb", fixture.Context));

        // Rendered, not estimated. The whole point of PvnedDocumentTemplate.PadTo is that these two
        // numbers are exact, and "about 25 MB" would test neither side of the rule.
        Encoding.UTF8.GetByteCount(accepted).ShouldBe(ScenarioCatalogue.SizeAccepted);
        Encoding.UTF8.GetByteCount(refused).ShouldBe(ScenarioCatalogue.SizeRefused);

        (ScenarioCatalogue.SizeRefused - ScenarioCatalogue.SizeAccepted).ShouldBe(1);
        ScenarioCatalogue.SizeAccepted.ShouldBe(26_214_400);
    }

    [Fact]
    public async Task Exactly_twenty_six_million_two_hundred_and_fourteen_thousand_four_hundred_bytes_is_accepted()
    {
        var report = await fixture.RunDocumentsAsync([Document("size-25mb", fixture.Context)], Ct);

        report.Outcomes.Single().StatusCode.ShouldBe(200);

        await using var db = fixture.CreateOwnerDbContext();

        var message = await db.InboundMessages.SingleAsync(
            candidate => candidate.CorrelationId
                == Guid.Parse(report.Outcomes[0].CorrelationId!),
            Ct);

        // Stored, durable and PROCESSED after the drain - a document at the boundary is an ordinary
        // document, not a special case that is merely tolerated.
        message.Status.ShouldBe(InboundMessageStatus.Processed);
        message.PayloadUri.ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task One_byte_more_is_refused_with_four_one_three_and_stores_nothing()
    {
        var before = await fixture.InboundMessageCountAsync(Ct);

        var report = await fixture.RunDocumentsAsync([Document("size-26mb", fixture.Context)], Ct);

        report.Outcomes.Single().StatusCode.ShouldBe(413);
        report.Outcomes.Single().AsExpected.ShouldBeTrue();

        // Asserted by ROW COUNT. The refusal happens before the payload is stored, so there is no
        // row to read a status off - and a test that looked for a FAILED row would be looking for
        // the wrong thing in the one place [F02-R05] does not apply.
        (await fixture.InboundMessageCountAsync(Ct)).ShouldBe(before);
    }

    /// <summary>
    /// The padding is an XML comment, so the document at the boundary still says what it says. A
    /// size test on a document the parser cannot read would prove the size check and nothing else —
    /// and it is the accepted side that has to be a real document.
    /// </summary>
    [Fact]
    public async Task The_accepted_document_still_applies_its_readings()
    {
        var document = Document("size-25mb", fixture.Context);

        await fixture.RunDocumentsAsync([document], Ct);

        await using var db = fixture.CreateOwnerDbContext();

        var version = await db.IntervalDataVersions.SingleAsync(
            candidate => candidate.DocumentId == document.Spec.DocumentId, Ct);

        (await db.IntervalReadings.CountAsync(
            reading => reading.IntervalDataVersionId == version.Id, Ct))
            .ShouldBe(document.Spec.Quantities.Count);
    }
}
```

⚠ **`fixture.InboundMessageCountAsync` is one more helper on `DevStubsScenarioFixture`.** Add it
beside `IntervalReadingCountAsync` in task 23's file:

```csharp
    public async Task<int> InboundMessageCountAsync(CancellationToken ct)
    {
        await using var db = CreateOwnerDbContext();

        return await db.InboundMessages.CountAsync(ct);
    }
```

- [ ] **Step 2: Run the tests and watch them fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~SizeBoundaryTests"
```

Expected: FAIL — build error
`error CS1061: 'DevStubsScenarioFixture' does not contain a definition for 'InboundMessageCountAsync'`.

- [ ] **Step 3: Add the helper and run them again**

Add `InboundMessageCountAsync` to `DevStubsScenarioFixture`, then re-run.

Expected: PASS — 4 tests, in roughly ten to twenty seconds.

⚠ If `One_byte_more_is_refused_with_four_one_three_and_stores_nothing` returns **500** rather than
413, the Worker read the whole body before checking the length. Contract §9.4 says
`Content-Length` **or the streamed body** — plan 3 owns the check; the failure belongs there and not
here.

⚠ If it returns **200**, the limit is being applied as `>=` rather than `>`. That is the mutation
below, and it is the reason both sides of the boundary are tested rather than just the refusal.

- [ ] **Step 4: MUTATION — move the limit by one byte**

In plan 3's webhook route, change the size comparison from `> MaximumPayloadBytes` to
`>= MaximumPayloadBytes`.

Predict: `Exactly_twenty_six_million…_bytes_is_accepted` fails with
`report.Outcomes.Single().StatusCode should be 200 but was 413`, and
`One_byte_more_is_refused…` **stays green**.

⚠ That asymmetry is the whole reason the accepted side exists as a test. A limit written with the
wrong comparison refuses everything it should refuse; it also refuses one document it should accept,
and nothing but this assertion would ever notice.

Run, confirm, restore.

- [ ] **Step 5: Second mutation — pad by characters rather than bytes**

In `PvnedDocumentTemplate.PadTo`, replace `ByteCount(xml)` with `xml.Length`.

Predict: `The_two_documents_are_exactly_one_byte_apart` fails with
`should be 26214400 but was 26214397` — three bytes short, because the rendered document contains
three multi-byte characters (the `—` and two `⚠`-adjacent glyphs vary with the connection's name and
note). The exact number will differ; **what must not differ is that it fails**.

⚠ And note what it would do without this test: both size documents would be a few bytes light, the
26 MB one would be **accepted**, and `One_byte_more_is_refused…` would fail with a confusing 200 four
files away from the cause.

Run, confirm, restore.

- [ ] **Step 6: Run the whole suite and commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln --nologo
tools/verify-solution-layout.sh
tools/verify-migrator.sh
git add tests/PeakPower.Integration.Tests/DevStubs/SizeBoundaryTests.cs \
        tests/PeakPower.Integration.Tests/DevStubs/DevStubsScenarioFixture.cs
git commit -m "Pin both sides of the 26 214 400-byte boundary, one byte apart

Contract 9.4 and design 7.3. Exactly 26 214 400 bytes is accepted and 26 214 401 is refused, and
both documents are rendered rather than estimated - PvnedDocumentTemplate.PadTo lands on an exact
UTF-8 byte count, which is what makes 'both sides' mean anything.

The 413 is the only status in the catalogue answered BEFORE the payload is stored, so a refused
document leaves no inbound_message row at all - asserted by row count, because there is no row to
read a status off. F02-R05 does not apply here and that is the point of the exception.

Verified by two mutations. Moving the limit to >= refuses the accepted document and leaves the
refusal test green, which is why the accepted side is a test at all. And padding by characters
instead of bytes leaves both documents a few bytes light, so the 26 MB one is accepted and the
failure surfaces four files from the cause."
```

---

## Done

Twenty-four tasks. The rollup half (1–12) turns applied interval data into an honest day; the DevStubs
half (13–24) is the generator that drives all of it over the real webhook.

**What this plan leaves for other plans, deliberately:**

| Left undone here | Whose, and where |
| --- | --- |
| The third `DevStubsSubject`, `LoadTest`, and the `loadtest` verb | plan 8, tasks 2 and 3 — contract §13.2 names the subject so that this plan does not invent a fourth |
| The 100-EAN × 365-day run, and `[NFR-03]`/`[NFR-04]` | plan 8, tasks 3–6 |
| Running DevStubs against the **deployed** webhook | plan 8, task 8 |
| `IDayStateRecomputer` / `IOperationalAlertRaiser` **declarations**; `MeteringPoint.RecordObservedProduction` | plans 3 and 2 — this plan implements and verifies, and declares neither (contract §7.6, §17) |
| The hand-written negative fixtures and the golden document | plan 4 — design §8 keeps them out of the generator's hands on purpose |

**The four design §10 mutations, and where each one lives:**

| # | Assertion | This plan? | Where |
| --: | --- | --- | --- |
| 1 | Completeness against `directions.Count == 2` | **yes** | Task 2, step 6 |
| 2 | Receipt-order supersession | no | plan 3 — and exercised end to end here at task 23, step 6 |
| 3 | The DST Pos mapping | no | plan 1 — and its generator-side twin is task 14, step 5 |
| 4 | The §4.1 rollup shape | **yes** | Task 3, step 6 — and through the database at task 9, and end to end at task 23 |
