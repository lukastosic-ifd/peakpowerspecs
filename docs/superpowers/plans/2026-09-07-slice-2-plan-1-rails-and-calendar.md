# Rails and the Market Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put continuous integration in both repositories with the deploy job gated behind it and
zero silently-skipped tests, create the four new projects and arm the architecture fact that has
been waiting for one of them, register the Worker host and its raw-payload volume in the AppHost
and republish the committed Compose file, settle the background-queue technology with a spike, and
build the Amsterdam market calendar — 92/96/100 interval counts, the Pos→instant mapping including
the autumn duplicate hour, and `AddWorkingDays` — so that every later slice-2 plan has rails to
build on and one answer about time.

**Architecture:** Two GitHub Actions workflows per repository, arranged so `needs:` can gate across
files: `ci.yml` is a reusable workflow that `deploy.yml` calls, and the deploy job waits on it. The
four new projects (`PeakPower.Ingestion`, `PeakPower.Integration.Brp.Pvned`, `PeakPower.Worker`,
`PeakPower.DevStubs`) take the solution from eighteen projects to twenty-two and arm
`CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter`, which has skipped since slice 1 with a
message naming the exact `<ProjectReference>` to add. The calendar work stays inside
`PeakPower.Infrastructure.Time`, the one assembly architecture fact 5 allows to read a clock, so
parser, rollup and chart all read one mapping rather than three copies of it.

**Tech Stack:** .NET SDK 10.0.400 · C# `latest` · net10.0 · EF Core 10.0.11 · Npgsql 10.0.3 ·
PostgreSQL 17 · .NET Aspire 13.5.3 (`aspire.cli` global tool + `Aspire.AppHost.Sdk`) ·
xUnit v3 3.2.2 · Shouldly 4.3.0 · NSubstitute 6.2.0 · NetArchTest.Rules 1.3.2 · Mono.Cecil 0.11.6 ·
Testcontainers.PostgreSql 4.14.0 · `Microsoft.Extensions.TimeProvider.Testing` 10.9.0 ·
Hangfire.Core 1.8.25 / Hangfire.AspNetCore 1.8.25 / Hangfire.PostgreSql 1.21.1 (**candidate only —
task 12's spike decides, and only task 17 pins them**) · Node 24.15.0 / npm 11.12.1 ·
Angular 22.1.3 runtime, 22.1.6 tooling ·
Vitest 4.1.11 · Docker 29.7.2 · GitHub Actions on `ubuntu-latest`

**Spec:** docs/superpowers/specs/2026-09-07-poc-slice-2-design.md
**Shared contract:** docs/superpowers/plans/2026-09-07-slice-2-shared-contract.md

## Global Constraints

### Versions — exact, verified 2026-09-07 (shared contract §1)

| | |
| --- | --- |
| .NET SDK | **10.0.400** (`global.json`, `rollForward: latestFeature`) |
| Target framework | **net10.0**, `LangVersion latest`, `Nullable enable`, `TreatWarningsAsErrors`, `AnalysisMode Recommended` |
| EF Core | **10.0.11** (`Microsoft.EntityFrameworkCore`, `.Design`, `.Relational`) |
| Npgsql | **10.0.3** (`Npgsql`, `Npgsql.EntityFrameworkCore.PostgreSQL`) |
| `EFCore.NamingConventions` | **10.0.1** |
| PostgreSQL | **17** (Testcontainers image and Aspire `WithImageTag("17")`) |
| Aspire | **13.5.3** — `aspire.cli` global tool + `Aspire.AppHost.Sdk`. **NOT a `dotnet workload`.** |
| Angular | **22.1.3** runtime (`@angular/core`), **22.1.6** tooling (`@angular/cli`, `@angular/build`) |
| TypeScript | **6.0.3** |
| Vitest | **4.1.11** · jsdom **30.0.1** · Playwright **1.56.1** |
| Node types | `@types/node` **24.13.3** |

**Test and tooling packages already pinned — do not re-pin, do not bump:** `xunit.v3` 3.2.2,
`xunit.runner.visualstudio` 3.1.5, `Microsoft.NET.Test.Sdk` 18.9.0, `Shouldly` 4.3.0 (⚠ **never
FluentAssertions**, `[DEC-118]`), `NSubstitute` 6.2.0, `NetArchTest.Rules` 1.3.2, `Mono.Cecil`
0.11.6, `Testcontainers.PostgreSql` 4.14.0, `Verify.XunitV3` 30.15.0 (⚠ **not `Verify.Xunit`**),
`Dapper` 2.1.66, `Microsoft.AspNetCore.Mvc.Testing` / `.TestHost` 10.0.11,
`Microsoft.Extensions.TimeProvider.Testing` 10.9.0, `FluentValidation` 12.0.0,
`Microsoft.Extensions.Http` / `.Hosting` / `.Hosting.Abstractions` / `.Configuration.Abstractions`
10.0.11, `Microsoft.Extensions.Http.Resilience` / `.ServiceDiscovery` 10.9.0, `Polly.Core` 8.4.2,
`Microsoft.AspNetCore.OpenApi` 10.0.11.

### Repositories

```
/Users/thinhhuynh/PeakPower/peakpower-platform      # .NET
/Users/thinhhuynh/PeakPower/peakpower-web           # Angular — siblings, and the AppHost relies on it
```

Both are published privately under **`peakpower-nl`**. `tools/verify-repositories.sh` fails if
`origin` is missing or points elsewhere, and it treats a **detached HEAD** as a defect — which is
why the CI workflow puts each checkout on a named branch rather than weakening the guard.

### Naming

- .NET namespace root `PeakPower.` — e.g. `PeakPower.Ingestion.Queue`
- npm scope `@peakpower-nl/`
- Database: snake_case, singular, schema-qualified — `metering.ingestion_job`
- C#: PascalCase; EF Core maps to snake_case by convention, never per-property attributes

### The twenty-two projects — shared contract §3.1

```
src/Hosts/          AppHost · ServiceDefaults · Api.Customer · Api.Employee · Migrator
                    + Worker  + DevStubs                                        ← new
src/Core/           Domain · Application · Contracts
src/Infrastructure/ Persistence · Time · Web · Identity · Email
                    + Ingestion · Integration.Brp.Pvned                         ← new
tests/              Domain.Tests · Application.Tests · Integration.Tests ·
                    Architecture.Tests · AppHost.Tests
```

**Seventeen source projects, five test projects. No new test project is created.** That is what
makes the arithmetic 22 rather than 24.

⚠ **`PeakPower.Ingestion` MUST live at `src/Infrastructure/PeakPower.Ingestion`.** Not taste:
`tests/PeakPower.Architecture.Tests/CallSiteFacts.cs:38` names the `<ProjectReference>` verbatim,
and that path is inside it.

**Project references, and what each new project may see:**

| Project | References |
| --- | --- |
| `PeakPower.Ingestion` | `PeakPower.Application`, `PeakPower.Domain`, `PeakPower.Persistence`. ⚠ **Never any `PeakPower.Integration.Brp.*`** — architecture fact 3 |
| `PeakPower.Integration.Brp.Pvned` | `PeakPower.Application`, `PeakPower.Domain`. ⚠ **Never `PeakPower.Ingestion`** — the port points one way |
| `PeakPower.Worker` | `PeakPower.Ingestion`, `PeakPower.Integration.Brp.Pvned`, `PeakPower.Persistence`, `PeakPower.Infrastructure.Time`, `PeakPower.ServiceDefaults`. **The composition root that binds the adapter to the port, and the only project that sees both** |
| `PeakPower.DevStubs` | `PeakPower.Contracts` only, plus `Microsoft.Extensions.Http`/`.Hosting`. ⚠ **Never the adapter, never `PeakPower.Ingestion`** — S2-D4: the generator emits templated XML **text**, so it must not be able to reach the parser's model |

**Host entry-point marker.** Slice 1's rule stands: no host declares `public partial class Program`.

```csharp
namespace PeakPower.Worker;
public sealed class WorkerEntryPoint;      // WebApplicationFactory<WorkerEntryPoint>
```

`PeakPower.DevStubs` is a console host and declares no marker.

### Architecture facts

1. `PeakPower.Domain` references no other project
2. `PeakPower.Application` references only `PeakPower.Domain`
3. **`PeakPower.Ingestion` references no `PeakPower.Integration.Brp.*` assembly** — skipped today; **this plan arms it**
4. No type calls `IgnoreQueryFilters()`
5. **No type outside `PeakPower.Infrastructure.Time` reads the system clock** — and by the same
   argument the DST mapping lives there and only there
6. No type outside `PeakPower.Infrastructure.Web` reads a customer identifier off `HttpContext`

### The calendar — S2-D8, shared contract §7.5

`IMarketCalendar` gains four members and **plan 1 is the only plan that declares a member of
`IMarketCalendar`.** The rule that makes this safe is architecture fact 5: parser, rollup and chart
all read this one mapping, so a second copy is a second answer.

- `int ExpectedIntervalCount(DateOnly date)` — 92 on the spring-forward Sunday, 100 on the autumn
  fall-back Sunday, 96 otherwise
- `DateTimeOffset IntervalStart(DateOnly date, int pos)` — the Amsterdam-local start instant of
  `pos` (1-based), carrying the correct offset for that pass. ⚠ On the autumn day, **Pos 9–12 are
  the FIRST pass of 02:00–03:00 (+02:00) and Pos 13–16 are the SECOND (+01:00)**. Throws
  `ArgumentOutOfRangeException` when `pos < 1` or `pos > ExpectedIntervalCount(date)`
- `bool IsDstDuplicate(DateOnly date, int pos)` — true only for Pos 13–16 on the autumn fall-back
  Sunday
- `DateOnly AddWorkingDays(DateOnly from, int workingDays)` — **Monday–Friday, exclusion list read
  from the `[DEC-14]` calendar and CURRENTLY EMPTY, so public holidays are working days**.
  `AddWorkingDays(d, 0)` returns `d` unchanged even when `d` is a weekend

### Testing

| Layer | Tooling |
| --- | --- |
| Domain / Application unit | xUnit v3 + **Shouldly 4.3.0** + NSubstitute — **never FluentAssertions** `[DEC-118]` |
| Persistence & integration | Testcontainers, real PostgreSQL 17 |
| Architecture | NetArchTest (facts 1–2), **Mono.Cecil** IL scanning (facts 3–6) |
| The regenerated compose file, the Worker image stage | `tests/PeakPower.AppHost.Tests` |
| Frontend unit | Vitest 4.1.11 + jsdom |

Syntax is `actual.ShouldBe(expected)` and `await Should.ThrowAsync<T>(act)`. ⚠ **Shouldly's
`ShouldContain` is case-insensitive by default** and has silently broken three tests in this
repository; compare with `StringComparison.Ordinal` / `Case.Sensitive` and assert on structured
fields, never by searching a response body for a substring.

**Mutation verification is this repository's stated standard.** Break it first, predict the
failure, watch it go red, **check the failure is the one you predicted**, then fix it. A green test
that was never seen red is not evidence. A mutation that breaks the *build* proves nothing about an
assertion — if removing a member orphans a `using`, remove that too.

⚠ **Mutate the case your assertion is actually for, not the easy neighbouring one.** `CLAUDE.md`
records a guard that was mutation-verified against "the property does not exist" but never against
"the property exists under a different casing", and so certified a half-working guard.

### Two mutation verifications this plan owns outright

| Assertion | The mutation | What must go red |
| --- | --- | --- |
| **The DST Pos mapping** (design §7.10, contract §15.2 row 3) | Replace `IntervalStart`'s body with a naive add-15-minutes-to-the-local-wall-clock loop | The autumn 100-point case: Pos 9–12 carry `+01:00` instead of `+02:00`, Pos 13–16 read `03:00` where the fixture says `02:00`, and Pos 100 lands on the **next date** |
| **Architecture fact 3** (design §7.22, contract §15.2) | Add a `PeakPower.Integration.Brp.Pvned` `<ProjectReference>` to `PeakPower.Ingestion.csproj` and make one type in `PeakPower.Ingestion` name a type from it, so the compiler keeps the assembly reference | `Fact_3_ingestion_references_no_Brp_adapter` fails with *"PeakPower.Ingestion must talk to BRP adapters through a port, never by referencing one"* |

and one this plan owns jointly with the CI job:

| Assertion | The mutation | What must go red |
| --- | --- | --- |
| **The zero-skip CI assertion** (design §7.1, contract §2) | Run the guard with `PEAKPOWER_WEB_PATH` pointing at a directory that does not exist — the same state a runner without the second checkout is in | `verify-no-unexpected-skips.sh` fails naming `PeakPower.AppHost.Tests` and a non-zero `notExecuted` count, and lists the skipped test names |

### Commands

```bash
# platform, from /Users/thinhhuynh/PeakPower/peakpower-platform
./dev-up
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln
dotnet test tests/PeakPower.Application.Tests --nologo
dotnet test tests/PeakPower.Architecture.Tests --nologo
dotnet test tests/PeakPower.AppHost.Tests --nologo
tools/verify-solution-layout.sh
tools/verify-migrator.sh
tools/verify-build-settings.sh
tools/verify-aspire-api.sh
tools/verify-repositories.sh
tools/verify-no-unexpected-skips.sh          # new, this plan
aspire publish -o ./deploy

# web, from /Users/thinhhuynh/PeakPower/peakpower-web
npm ci
npm test
```

⚠ **Integration tests use Testcontainers.** Running several suites in parallel across worktrees can
exhaust connections and produce mass Postgres timeouts — retry before reporting a regression.

⚠ **`cp -a` preserves mtimes and leaves MSBuild with stale binaries**; use plain `cp` or `touch`.

### Roll forward only — S2-D7

The deployed `DatabaseMigrator` calls only `MigrateAsync`, so `Down()` is never invoked in the
shipped path. Any migration this plan writes still writes a correct `Down()` — a developer may run
`dotnet ef database update <earlier>` by hand — but **nothing may rely on it**.

---

## Scope boundary for this plan

This is **plan 1 of 8**. It covers design-document steps 1 and 2. It builds:

- both CI workflows, the cross-file `needs:` gate, the cross-repository `flock` and the bounded
  image prune;
- `tools/verify-no-unexpected-skips.sh` and `tests/skipped-tests.allowlist.txt`;
- the four new projects, their solution entries and their reference graph;
- `tools/verify-solution-layout.sh`'s `expected` array, 18 → 22;
- arming `CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter`, with the `AssemblyProbe`,
  `AssemblyProbeFacts` and `ModuleGraphFacts` changes that arming it forces;
- the whole of `IMarketCalendar`'s slice-2 surface and the `[DEC-14]` working-day calendar behind
  `AddWorkingDays`;
- the `Hangfire.PostgreSql` spike, its recorded verdict, and **whichever** of the two queue
  implementations the verdict chooses;
- the `PeakPower.Worker` host shell, its AppHost registration, the raw-payload volume, the
  regenerated and committed `deploy/docker-compose.yaml`, the Worker runtime stage in
  `deploy/Dockerfile`, and `deploy/env.example`.

It deliberately does **not** build: migration 9 or any entity (plan 2 — and plan 2 declares every
entity in this slice, and writes every line of migration SQL in it **except one**: on the
spike-failed path task 18 writes migration **10**, `metering.ingestion_job`, which contract §6.9
names as plan 1's and tells plan 2 explicitly is not plan 2's table. That table has no entity
either — the queue reads and writes it with raw SQL, which is what keeps plan 2's rule about
entities whole), the webhook route, credential auth, the size
cap, the correlation id, `IRawPayloadStore` or `IBrpIngestionAdapter` (plan 3), anything inside
`PeakPower.Integration.Brp.Pvned` beyond an assembly marker (plan 4), anything inside
`PeakPower.DevStubs` beyond a console shell (plan 5), any `/api/v1` route (plan 6), any Angular
code (plan 7), or the load test and deployment run (plan 8).

### Three places where this plan resolves an ambiguity in the shared contract

1. **`IIngestionJobQueue` is *declared by plan 3*, and only implemented here.** §7.4's table row
   reads "plan 1 (spike) / plan 3 (wiring)", which is the sentence that can be read both ways.
   Contract §17 settles it: row 1 gives plan 1 the `IIngestionJobQueue` **implementation**, and
   row 3 gives plan 3 the `IBrpIngestionAdapter` / `IRawPayloadStore` / `IIngestionJobQueue`
   **declarations** — which plan 3 task 1 writes and then pins in `IngestionPortShapeTests`.
   ⚠ **This plan declares neither `IIngestionJobQueue` nor `IProcessInboundMessageHandler`**: two
   plans declaring one interface is a duplicate-member compile error, not a merge, and it is the
   single most likely way eight parallel plans fail to compile on the day they are assembled.
   `IBrpIngestionAdapter`, `BrpParseRequest`, `BrpParseOutcome`, `BrpParseStatus`, `BrpDocument`,
   `BrpDocumentKind`, `CanonicalSeries`, `CanonicalPoint`, `IBrpIngestionAdapterRegistry` and
   `IRawPayloadStore` are plan 3's on the same reading and appear nowhere in this plan either.
   ⚠ **The cost is one ordering exception, and it is stated rather than absorbed.** A port cannot
   be implemented before it is declared, so tasks 17 and 18 — the only tasks here that touch the
   queue — run **after plan 3 task 1**, which is plan 3's first task. Tasks 1-16 are unaffected and
   land in the dependency order §17 gives. The note at the head of task 17 says so again, where
   somebody executing it will be standing.
2. **The `[DEC-14]` calendar is configuration, not a table.** S2-D8 says to read the weekday set
   and the exclusion list "from the `[DEC-14]` calendar rather than hard-coding them, so populating
   the list later is a row and not a release". Design §3.2 defers the `market.calendar_interval`
   spine and `market.peak_calendar_version`, and plan 2 owns every line of migration SQL in this
   slice, so there is no table for plan 1 to read. The mechanism is therefore a bound options
   object — `MarketCalendar:WorkingDays` and `MarketCalendar:ExcludedDates` — which satisfies the
   substance of S2-D8 (the answer changes without a release) and leaves the swap to a real
   reference table as one class.
3. **The Worker's HTTP endpoint is external.** `PublishedStackTests.The_two_APIs_are_the_only_public_HTTP_surface`
   pins the public surface as exactly `["customer-api", "employee-api"]`. Design §3.1 says DevStubs
   "is run from a developer machine against the deployed webhook" and design §7.2 measures the
   whole slice through `POST /webhooks/brp/PVNED` on the deployed stack, so the Worker's port must
   be published. That pinned literal moves in the same commit, with its comment rewritten.

## Domain terms used in this plan

Assume no knowledge of Dutch energy trading. The words that appear below mean:

- **BRP (Balance Responsible Party)** — the market participant answerable to the Dutch grid
  operator for a connection's imbalance. PVNed is the only one that exists here.
- **EAN** — the eighteen-digit code identifying one electricity connection point in the Dutch grid.
- **Interval / Pos** — Dutch metering is quarter-hourly. An ordinary day has 96 intervals; `Pos` is
  the 1-based position of one of them inside the document that carries the day.
- **Delivery date** — the metering day a reading belongs to, in Europe/Amsterdam. Not a UTC day.
- **DST** — the European summer-time transitions, on the last Sunday of March (a 23-hour day, 92
  intervals) and the last Sunday of October (a 25-hour day, 100 intervals).
- **Working-day calendar** — `[F02-R23]` gives a day 10 working days to reach `FINAL`. S2-D8
  defines "working day" as Monday–Friday, holidays included.

---

## File Structure

### `/Users/thinhhuynh/PeakPower/peakpower-platform`

| File | Responsibility |
| --- | --- |
| `.github/workflows/ci.yml` | **new** — build, the six guards and every test, reusable via `workflow_call` |
| `.github/workflows/deploy.yml` | **modified** — a `test` job calling `ci.yml`, `needs:` on the deploy job, the cross-repository `flock`, the bounded image prune |
| `tools/verify-no-unexpected-skips.sh` | **new** — runs all five test projects, asserts `AppHost.Tests` reports zero skipped and the solution-wide skipped set equals the allow-list |
| `tests/skipped-tests.allowlist.txt` | **new** — the checked-in set of test names allowed to skip. Empty of names after this plan |
| `tools/verify-solution-layout.sh` | **modified** — `expected` array 18 → 22, header comment rewritten |
| `PeakPower.sln` | **modified** — four project entries |
| `src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj` | **new** — the BRP-agnostic pipeline project |
| `src/Infrastructure/PeakPower.Ingestion/AssemblyMarker.cs` | **new** — anchor for architecture tests |
| `src/Infrastructure/PeakPower.Ingestion/Queue/*` | **new** — the `IIngestionJobQueue` implementation task 17 or task 18 chooses |
| `src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj` | **modified by whichever queue task runs** — Hangfire's three packages, or `InternalsVisibleTo` for the drain |
| `src/Infrastructure/PeakPower.Persistence/Migrations/*_IngestionJobQueue.cs` | **new, fallback path ONLY** — `metering.ingestion_job` (contract §6.9), migration **10**. The one piece of migration SQL in this slice plan 2 does not own |
| `tools/verify-migrator.sh` | **modified, fallback path only** — `*_IngestionJobQueue` in the ordered list |
| `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj` | **new** — the PVNed adapter project; plan 4 fills it |
| `src/Infrastructure/PeakPower.Integration.Brp.Pvned/AssemblyMarker.cs` | **new** |
| `src/Hosts/PeakPower.Worker/PeakPower.Worker.csproj` | **new** — the webhook host and job server |
| `src/Hosts/PeakPower.Worker/WorkerEntryPoint.cs` | **new** — `WebApplicationFactory<WorkerEntryPoint>`'s anchor |
| `src/Hosts/PeakPower.Worker/Program.cs` | **new** — the host shell; plans 3 and 5 map routes and jobs onto it |
| `src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj` | **new** — the generator project; plan 5 fills it |
| `src/Hosts/PeakPower.DevStubs/Program.cs` | **new** — a console shell that refuses loudly |
| `src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs` | **modified** — four members added |
| `src/Core/PeakPower.Application/Abstractions/Ingestion/IIngestionJobQueue.cs` | **declared by plan 3, task 1** — plan 1 only implements it (see `Queue/*` below) |
| `src/Infrastructure/PeakPower.Infrastructure.Time/WorkingDayCalendar.cs` | **new** — the `[DEC-14]` weekday rule and exclusion list, as data |
| `src/Infrastructure/PeakPower.Infrastructure.Time/WorkingDayCalendarOptions.cs` | **new** — the bound configuration section |
| `src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs` | **modified** — the four new members and a second constructor parameter |
| `src/Infrastructure/PeakPower.Infrastructure.Time/TimeServiceCollectionExtensions.cs` | **modified** — binds the calendar from configuration |
| `src/Hosts/PeakPower.ServiceDefaults/Extensions.cs` | **modified** — one line, `AddMarketCalendar(builder.Configuration)` |
| `src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj` | **modified** — a `ProjectReference` to the Worker so `Projects.PeakPower_Worker` is generated |
| `src/Hosts/PeakPower.AppHost/Program.cs` | **modified** — the Worker resource, its credential, its raw-payload volume |
| `src/Hosts/PeakPower.AppHost/ComposeRuntime.cs` | **modified** — `WithRawPayloadVolume`, `INamedComposeVolumeAnnotation`, `DeclareSigningKeyVolumes` → `DeclareNamedVolumes` |
| `src/Hosts/PeakPower.AppHost/DeploymentParameters.cs` | **modified** — `BrpCredentialPvned` |
| `src/Hosts/PeakPower.AppHost/RawPayloads.cs` | **new** — the volume name and the container path, named once |
| `deploy/Dockerfile` | **modified** — a fourth restore, `build-worker` and `worker` stages |
| `deploy/docker-compose.yaml` | **regenerated and committed** — the `worker` service and its volume |
| `deploy/env.example` | **modified** — `BRP_CREDENTIAL_PVNED=` with its prose |
| `docs/ingestion-job-queue.md` | **new** — the spike's recorded verdict and the shape it chose |
| `Directory.Packages.props` | **modified on the Hangfire path only** — three `PackageVersion` entries |
| `tests/PeakPower.Architecture.Tests/PeakPower.Architecture.Tests.csproj` | **modified** — the two references that arm fact 3 and widen fact 5 |
| `tests/PeakPower.Architecture.Tests/AssemblyProbe.cs` | **modified** — `ProductionAssemblyFileNames` gains two entries |
| `tests/PeakPower.Architecture.Tests/AssemblyProbeFacts.cs` | **modified** — the duplicated list and the unlisted-assembly name |
| `tests/PeakPower.Architecture.Tests/ModuleGraphFacts.cs` | **modified** — the two prefix arrays gain the new project names |
| `tests/PeakPower.Application.Tests/Time/MarketCalendarTests.cs` | **modified** — four constructor call sites |
| `tests/PeakPower.Application.Tests/Time/ExpectedIntervalCountTests.cs` | **new** |
| `tests/PeakPower.Application.Tests/Time/IntervalStartTests.cs` | **new** — the six DST transitions across three years |
| `tests/PeakPower.Application.Tests/Time/IsDstDuplicateTests.cs` | **new** |
| `tests/PeakPower.Application.Tests/Time/AddWorkingDaysTests.cs` | **new** — S2-D8, Christmas and King's Day |
| `tests/PeakPower.Application.Tests/Time/WorkingDayCalendarTests.cs` | **new** — the `[DEC-14]` mechanism |
| `tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj` | **modified** — a reference to `PeakPower.Ingestion`, for the retry ladder |
| `tests/PeakPower.Application.Tests/Ingestion/IngestionRetryLadderTests.cs` | **new** — 1 m / 5 m / 15 m / 1 h / 4 h, and that something applies it |
| `tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj` | **modified** — a reference to the Worker host |
| `tests/PeakPower.Integration.Tests/Ingestion/HangfireIngestionJobQueueTests.cs` | **new, Hangfire path only** — a job crosses the process hop carrying both ids |
| `tests/PeakPower.Integration.Tests/Ingestion/PostgresIngestionJobQueueTests.cs` | **new, fallback path only** — claimed once, and the ladder walked to `DEAD` |
| `tests/PeakPower.Integration.Tests/Hosts/WorkerHostTests.cs` | **new** — the Worker boots, answers `/health`, and exposes no `/api/v1` route |
| `tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs` | **modified** — two constructor call sites |
| `tests/PeakPower.Integration.Tests/Seeding/DemoSeedingGateTests.cs` | **modified** — two constructor call sites |
| `tests/PeakPower.AppHost.Tests/ImageBuildTests.cs` | **modified** — the Worker in three theories |
| `tests/PeakPower.AppHost.Tests/CommittedComposeFileTests.cs` | **modified** — the Worker's build section, its required credential, its volume |
| `tests/PeakPower.AppHost.Tests/ComposeRuntimeTests.cs` | **modified** — `DeclareNamedVolumes`, and the Worker's raw-payload mount |
| `tests/PeakPower.AppHost.Tests/PublishedComposeService.cs` | **modified** — the Worker's placeholder seeding |
| `tests/PeakPower.AppHost.Tests/PublishedStackTests.cs` | **modified** — the public-surface set and the container-port theory |
| `tests/PeakPower.AppHost.Tests/ResourceGraphTests.cs` | **modified** — the Worker in the pinned-port test |
| `tests/PeakPower.AppHost.Tests/RunModeIsUntouchedTests.cs` | **modified** — generalised to every named volume |

### `/Users/thinhhuynh/PeakPower/peakpower-web`

| File | Responsibility |
| --- | --- |
| `.github/workflows/ci.yml` | **new** — `npm ci` and `npm test` with a second checkout of `peakpower-platform`, reusable via `workflow_call` |
| `.github/workflows/deploy.yml` | **modified** — a `test` job calling `ci.yml`, `needs:` on the deploy job, the same `flock` and prune |

---

## Prerequisites — do this before Task 1

```bash
dotnet --version                              # must print 10.0.400
node --version                                # must print v24.15.0
npm --version                                 # must print 11.12.1
docker info > /dev/null && echo docker-ok     # the daemon must be running
dotnet tool install -g aspire.cli --version 13.5.3
dotnet tool install -g dotnet-ef --version 10.0.11
gh auth status                                # the GitHub CLI, for tasks 2-4
```

`aspire.cli` and `dotnet-ef` install into `~/.dotnet/tools`. If `aspire` or `dotnet-ef` is not
found afterwards, add `~/.dotnet/tools` to `PATH`.

**Aspire is not a `dotnet workload`.** Do not run `dotnet workload install aspire`; it no longer
exists.

**One secret has to exist before task 2's workflow can pass.** Both CI jobs check out the *other*
repository, and both are private. Create one fine-grained personal access token with
`Contents: read` on `peakpower-nl/peakpower-platform` **and** `peakpower-nl/peakpower-web`, and add
it to **both** repositories as `CROSS_REPO_READ_TOKEN`:

```bash
gh secret set CROSS_REPO_READ_TOKEN --repo peakpower-nl/peakpower-platform
gh secret set CROSS_REPO_READ_TOKEN --repo peakpower-nl/peakpower-web
```

Without it the platform job silently loses 29 `Assert.SkipWhen` sites' worth of coverage — which is
precisely what task 1's guard exists to refuse.

---

### Task 1: The skipped-test allow-list and the guard that enforces it

Design §3.1 carries a callout the rest of this plan depends on: `AppHost.Tests` runs its full set
when `peakpower-web` is checked out beside the platform and **silently loses most of it when it is
not**. The gates are `Assert.SkipWhen(builder is null, "no peakpower-web checkout; the portals are
not in the graph")` in **29** places — verified by reading them: `ComposeRuntimeTests` 16 (lines
55, 105, 125, 156, 169, 197, 225, 281, 310, 342, 373, 433, 461, 493, 551, 592),
`PublishedStackTests` 7 (121, 147, 185, 219, 253, 287, 330), `FrontEndInstallTests` 3 (98, 116,
146) and `ImageBuildTests` 3 (65, 98, 140) — plus
`PublishedStackTests.SkipWithoutTheWebCheckout()` (declared at `:109`, called at `:407`, `:434`,
`:466`, `:517`, `:565`) and `PortalOutputPathTests`' two variants (`:41`, `:101`).

A skipped test is green. That is the whole problem: a CI job that checks out one repository reports
success while `ComposeRuntimeTests` and `PublishedStackTests` — every assertion about the file a
server actually runs — never execute.

So the CI job does not merely run the tests; it **asserts nothing was skipped**. Two independent
readings of the same TRX, because they fail differently: the `<Counters …/>` element's
`notExecuted` attribute is a number that cannot be argued with, and the extracted set of skipped
test **names** is what a reviewer reads when the number is not zero.

⚠ The design quotes "roughly 64 passed / 60 skipped" and flags the figure as stale. **Do not put
either number in the guard.** The invariant is `notExecuted == 0` for `AppHost.Tests` and
`skipped names == the allow-list` across the solution — both derived, neither a floor.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-no-unexpected-skips.sh`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/skipped-tests.allowlist.txt`
- Test: the script is itself the test; step 2 and step 6 are its two runs

**Interfaces:**
- Consumes: nothing. It runs against the solution as it stands, before any project is added.
- Produces:
  - `tools/verify-no-unexpected-skips.sh`, exit 0 on success and non-zero with a `FAIL:` line
    otherwise. Honours `PEAKPOWER_WEB_PATH` (through the test code it runs) and
    `SKIP_GUARD_RESULTS_DIR` (default `/tmp/peakpower-test-results`).
  - `tests/skipped-tests.allowlist.txt`, one fully-qualified test name per line; `#` comments and
    blank lines ignored.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-no-unexpected-skips.sh`:

```bash
#!/usr/bin/env bash
# Runs every test project and asserts that NOTHING is silently skipped.
#
# WHY THIS EXISTS. A skipped test is green. tests/PeakPower.AppHost.Tests carries 29
# `Assert.SkipWhen(builder is null, "no peakpower-web checkout; the portals are not in the graph")`
# call sites, plus PublishedStackTests.SkipWithoutTheWebCheckout() and PortalOutputPathTests' two
# variants, and every one of them turns itself off when peakpower-web is not checked out beside
# this repository. That silently removes ComposeRuntimeTests and PublishedStackTests - every
# assertion about the docker-compose.yaml a server actually runs - from a run that still reports
# success. A CI job that only asks "did anything fail" cannot tell that apart from a green build.
#
# TWO READINGS OF THE SAME FILE, deliberately. The <Counters/> element's notExecuted attribute is
# a number, and the per-result outcome="NotExecuted" scan is a list of names. The number is what
# fails; the names are what a reviewer needs in order to know what to do about it. A guard that
# reported only the number would send the reader back to a terminal to find out what it already
# knew.
#
# NOT A FLOOR. CLAUDE.md: pin counted invariants to a computed expectation. The invariant here is
# notExecuted == 0 for AppHost.Tests and "the skipped names equal the allow-list" across the
# solution - never "at least N tests ran".
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root" || exit 1
failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }

allowlist="$root/tests/skipped-tests.allowlist.txt"
results="${SKIP_GUARD_RESULTS_DIR:-/tmp/peakpower-test-results}"

# Outside the repository by default. deploy/ and artifacts/ are committed directories and a test
# run must not leave anything in either; /tmp also keeps a failed run's TRX files around for
# reading without anybody having to remember to clean up.
rm -rf "$results"
mkdir -p "$results"

[[ -f "$allowlist" ]] || { echo "FAIL: $allowlist is missing" >&2; exit 1; }

# The five test projects, named rather than globbed: a project that stops being listed here would
# stop being checked, and that has to be a visible edit rather than a directory rename.
projects=(
  "PeakPower.Domain.Tests"
  "PeakPower.Application.Tests"
  "PeakPower.Integration.Tests"
  "PeakPower.Architecture.Tests"
  "PeakPower.AppHost.Tests"
)

# One build for all five, then --no-build per project. Without this the five `dotnet test` calls
# each re-evaluate the whole graph, and the guard takes longer than the suite it is guarding.
if ! dotnet build PeakPower.sln --nologo -warnaserror > "$results/build.log" 2>&1; then
  echo "FAIL: dotnet build failed; see $results/build.log" >&2
  tail -30 "$results/build.log" >&2
  exit 1
fi

for project in "${projects[@]}"; do
  dotnet test "tests/$project/$project.csproj" --nologo --no-build \
    --logger "trx;LogFileName=$project.trx" \
    --results-directory "$results" \
    > "$results/$project.log" 2>&1
  status=$?
  if [[ $status -ne 0 ]]; then
    fail "$project exited $status; see $results/$project.log"
    tail -40 "$results/$project.log" >&2
  fi
done

# The testName of every result whose outcome is NotExecuted, which is how VSTest records a skip.
# testName comes before outcome on the same element, and no attribute value between them contains
# a '>', so the [^>]* hop is safe here. If a future runner spells a skip differently, FIX THIS
# EXTRACTION rather than weakening the assertion - the mutation in the plan's step 6 is what tells
# you it has stopped matching.
skipped_names() {
  grep -o 'testName="[^"]*"[^>]*outcome="NotExecuted"' "$1" 2>/dev/null \
    | sed -E 's/^testName="([^"]*)".*/\1/'
}

counter() {   # $1 = trx file, $2 = attribute name
  grep -o '<Counters[^>]*>' "$1" 2>/dev/null | head -1 \
    | grep -o "$2=\"[0-9]*\"" | head -1 | grep -o '[0-9]*'
}

all_skipped="$results/skipped-names.txt"
: > "$all_skipped"

for project in "${projects[@]}"; do
  trx="$results/$project.trx"
  if [[ ! -f "$trx" ]]; then
    fail "$project produced no TRX at $trx, so this guard has nothing to read and would pass vacuously"
    continue
  fi

  total="$(counter "$trx" total)"
  not_executed="$(counter "$trx" notExecuted)"

  # Non-vacuity, both halves. A TRX reporting zero results is exactly what a broken filter, a
  # renamed project or a runner that failed to discover anything produces - and every assertion
  # below would pass against it.
  [[ -n "$total" && "$total" -gt 0 ]] \
    || fail "$project reported total='$total' tests in its TRX; a run that discovered nothing " \
         "makes every skip assertion below vacuous"
  [[ -n "$not_executed" ]] \
    || fail "$project's TRX carries no notExecuted counter; the <Counters/> shape has changed and " \
         "this guard is no longer reading it"

  skipped_names "$trx" >> "$all_skipped"

  # The one project the design names, asserted on its own and first, because it is the one whose
  # skips are invisible: they depend on a SECOND CHECKOUT rather than on anything in this
  # repository.
  if [[ "$project" == "PeakPower.AppHost.Tests" ]]; then
    if [[ "$not_executed" != "0" ]]; then
      fail "PeakPower.AppHost.Tests reported $not_executed skipped test(s) of $total. With no " \
        "peakpower-web checkout beside this repository it loses ComposeRuntimeTests, " \
        "PublishedStackTests, most of ImageBuildTests, PortalOutputPathTests and all of " \
        "FrontEndInstallTests - every assertion about the docker-compose.yaml a server runs - " \
        "and still reports success. Skipped:"
      skipped_names "$trx" | sed 's/^/    /' >&2
    fi
  fi
done

sort -u "$all_skipped" -o "$all_skipped"

allowed="$results/allowed-names.txt"
grep -vE '^\s*(#|$)' "$allowlist" | sed 's/[[:space:]]*$//' | sort -u > "$allowed"

unexpected="$(comm -23 "$all_skipped" "$allowed")"
if [[ -n "$unexpected" ]]; then
  fail "these tests skipped and are not on $allowlist:"
  echo "$unexpected" | sed 's/^/    /' >&2
fi

stale="$(comm -13 "$all_skipped" "$allowed")"
if [[ -n "$stale" ]]; then
  fail "$allowlist names tests that did NOT skip. An allow-list entry that nothing matches is a " \
    "hole somebody can widen without noticing; delete these lines:"
  echo "$stale" | sed 's/^/    /' >&2
fi

if [[ $failures -gt 0 ]]; then
  echo "verify-no-unexpected-skips: $failures check(s) failed" >&2
  exit 1
fi
echo "verify-no-unexpected-skips: OK"
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/skipped-tests.allowlist.txt`:

```
# The complete set of tests allowed to report NotExecuted, one fully-qualified name per line.
# tools/verify-no-unexpected-skips.sh compares the run's skipped set against this file IN BOTH
# DIRECTIONS: a skip that is not listed fails, and a listed name that did not skip also fails.
#
# THIS FILE IS EMPTY OF NAMES ON PURPOSE, and that is the strongest form the assertion takes.
# Every skip in this repository is conditional on something CI supplies:
#   - the 29 "no peakpower-web checkout; the portals are not in the graph" gates in
#     PeakPower.AppHost.Tests, plus PublishedStackTests.SkipWithoutTheWebCheckout() and
#     PortalOutputPathTests' two variants  -> the second checkout;
#   - CommittedComposeFileTests' deploy/ and docker-compose gates                -> the committed
#     artefacts and the docker CLI, both present on ubuntu-latest;
#   - ImageBuildTests' "this checkout is not named peakpower-platform" gate      -> checking out
#     into a directory called peakpower-platform, which the CI workflow does deliberately;
#   - CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter                   -> armed by
#     plan 1 task 6, after which it runs and passes.
#
# Adding a line here is a decision, not a tidy-up: it turns a test off for everybody, for ever,
# and the only record of why is whatever comment sits beside it. Write one.
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
chmod +x /Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-no-unexpected-skips.sh
cd /Users/thinhhuynh/PeakPower/peakpower-platform
tools/verify-no-unexpected-skips.sh
```

Expected: **FAIL**, with

```
FAIL: these tests skipped and are not on /Users/thinhhuynh/PeakPower/peakpower-platform/tests/skipped-tests.allowlist.txt:
    PeakPower.Architecture.Tests.CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter
verify-no-unexpected-skips: 1 check(s) failed
```

That one line is the only skip in the repository today with `peakpower-web` beside it — the fact
that has been waiting for `PeakPower.Ingestion` since slice 1. Task 6 arms it, and this guard is
what stops it going back to sleep.

⚠ If `PeakPower.AppHost.Tests` also appears here, `peakpower-web` is not beside your checkout or
`PEAKPOWER_WEB_PATH` points somewhere else. Fix that before continuing; the whole plan builds on
that checkout being present.

⚠ If the run fails with `$project produced no TRX`, the TRX logger did not write where the script
looked. Confirm with `ls /tmp/peakpower-test-results` and adjust `--results-directory`; do not
delete the non-vacuity check, which is the thing that told you.

- [ ] **Step 3: Record the one legitimate skip, temporarily**

Append to `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/skipped-tests.allowlist.txt`:

```
# TEMPORARY, and removed by plan 1 task 6. The fact skips because PeakPower.Ingestion does not
# exist yet; its own skip message names the <ProjectReference> that arms it. This line is here so
# the guard can be committed and run before the project exists, and task 6 deletes it.
PeakPower.Architecture.Tests.CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && tools/verify-no-unexpected-skips.sh`
Expected: PASS — the last line is `verify-no-unexpected-skips: OK`

- [ ] **Step 5: Verify the guard by mutation — drop the second checkout**

This is design §7.1's required verification and contract §15.2's third "silent failure". The
non-destructive form of "drop the second checkout" is to point every skip gate at a directory that
is not there: `WebWorkspace.Locate()`, `PublishedStackTests.ThePortalsAreInTheGraph()` and
`FrontEndPlan.Decide` all read `PEAKPOWER_WEB_PATH` first and all treat an unresolvable value as
"no checkout".

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
PEAKPOWER_WEB_PATH=/nowhere/peakpower-web tools/verify-no-unexpected-skips.sh
```

Expected: **FAIL**, with a block beginning

```
FAIL: PeakPower.AppHost.Tests reported <N> skipped test(s) of <M>. With no peakpower-web checkout
beside this repository it loses ComposeRuntimeTests, PublishedStackTests, most of ImageBuildTests,
PortalOutputPathTests and all of FrontEndInstallTests - every assertion about the
docker-compose.yaml a server runs - and still reports success. Skipped:
    PeakPower.AppHost.Tests.ComposeRuntimeTests.Postgres_says_when_it_is_ready_rather_than_only_when_it_has_started
    ...
```

**Write the two numbers down.** `<N>` and `<M>` are the re-measurement design §3.1 asks for, and
they go into the commit message so the design's stale "roughly 64 passed / 60 skipped" can be
corrected by plan 8's amendment pass rather than repeated.

Then run it once more **without** the environment variable and confirm it is `OK` again. A
mutation that is not restored is a broken build, not a verification.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tools/verify-no-unexpected-skips.sh tests/skipped-tests.allowlist.txt
git commit -m "test(ci): refuse a silently-skipped test

A skipped test is green. AppHost.Tests turns 29 Assert.SkipWhen sites off when peakpower-web is
not checked out beside this repository, which removes every assertion about the
docker-compose.yaml a server runs from a run that still reports success.

verify-no-unexpected-skips.sh reads each project's TRX twice - the <Counters/> notExecuted number
and the set of NotExecuted test names - and fails when AppHost.Tests skips anything at all or when
the solution-wide skipped set differs from tests/skipped-tests.allowlist.txt in either direction.

Verified by mutation: with PEAKPOWER_WEB_PATH=/nowhere/peakpower-web the guard fails naming
AppHost.Tests and lists the skipped tests. Measured on this run: <N> skipped of <M> without the
second checkout, 0 of <M> with it - the design document's 'roughly 64 passed / 60 skipped' is
stale and is corrected here."
```

---

### Task 2: CI in `peakpower-platform`

Design §3.1: CI in both repositories, **gating deploy**, running `dotnet build -warnaserror`,
`dotnet test` (Docker for Testcontainers) and the five `tools/verify-*.sh`. Plus the sixth guard
task 1 just wrote.

Three things about the shape are decisions rather than defaults, and each has a reason a later
edit would otherwise undo:

1. **`workflow_call` is what lets `needs:` gate a deploy in another file.** GitHub's `needs:` only
   orders jobs *inside one workflow*. `deploy.yml` therefore gains a `test` job whose whole body is
   `uses: ./.github/workflows/ci.yml`, and the deploy job waits on that. The alternative,
   `workflow_run`, fires *after* the first workflow finishes and cannot stop anything.
2. **The push trigger ignores `main`.** A push to `main` runs Deploy, Deploy calls this workflow,
   and without `branches-ignore` the whole suite would run twice for every merge.
3. **Both checkouts go into named directories, and both names are load-bearing.**
   `peakpower-platform` is what `ImageBuildTests.The_named_Dockerfile_resolves_to_this_repositorys_deploy_Dockerfile`
   checks before it agrees to run (`ImageBuildTests.cs:216-219`), and `peakpower-web` beside it is
   what `WebRootLocator.SiblingCheckoutPath` resolves five levels up from the AppHost project.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `tools/verify-no-unexpected-skips.sh` (task 1); the five existing `tools/verify-*.sh`;
  the repository secret `CROSS_REPO_READ_TOKEN` (Prerequisites).
- Produces: a workflow named `CI` with one job `build-guard-test`, callable as
  `uses: ./.github/workflows/ci.yml` — which task 4 depends on.

- [ ] **Step 1: Write the failing test**

There is no unit test for a workflow file; the test is GitHub running it. Make the failure
observable first, on a branch nobody deploys from.

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git checkout -b ci-proof
gh workflow list
```

Expected: the listing contains **only** `Deploy`. There is no `CI` workflow, so nothing runs on a
push to a branch, and a broken test reaches `main` unnoticed. That absence is the failure.

- [ ] **Step 2: Write the workflow**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/.github/workflows/ci.yml`:

```yaml
# Build, guard and test peakpower-platform.
#
# THIS WORKFLOW IS BOTH THE PULL-REQUEST CHECK AND THE DEPLOY GATE. GitHub's `needs:` only orders
# jobs inside ONE workflow file, so deploy.yml cannot say `needs: [the CI workflow]`. What it can
# do is CALL this one - `uses: ./.github/workflows/ci.yml` - and put `needs: test` on the deploy
# job. That is the only shape in which a failing test actually stops a deployment;
# `workflow_run` fires after the first workflow has finished and can stop nothing.
#
# THE PUSH TRIGGER IGNORES main ON PURPOSE. A push to main runs Deploy, Deploy calls this file,
# and without branches-ignore the whole suite - Testcontainers, five guards and a double migrator
# run - would execute twice for every merge.
#
# REQUIRED SECRET
#   CROSS_REPO_READ_TOKEN - a fine-grained PAT with Contents:read on peakpower-nl/peakpower-web.
#   Without it the second checkout fails. It must NOT be made optional: a job that carries on
#   without peakpower-web loses 29 Assert.SkipWhen sites' worth of coverage and still reports
#   success, which is exactly what tools/verify-no-unexpected-skips.sh refuses to allow.

name: CI

on:
  push:
    branches-ignore: [main]
  pull_request:
  workflow_call:

concurrency:
  group: ci-platform-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  build-guard-test:
    name: Build, guard and test
    runs-on: ubuntu-latest
    timeout-minutes: 60

    steps:
      # THE DIRECTORY NAME IS PART OF THE TEST. ImageBuildTests skips
      # The_named_Dockerfile_resolves_to_this_repositorys_deploy_Dockerfile unless the checkout is
      # called peakpower-platform (ImageBuildTests.cs:216-219), because deploy/Dockerfile's path is
      # written relative to a build context that is the PARENT of both checkouts. Check out into
      # $GITHUB_WORKSPACE itself and that test skips - and a skip is a failure here.
      - name: Check out peakpower-platform
        uses: actions/checkout@v4
        with:
          path: peakpower-platform

      # BESIDE it, under the name WebRootLocator.SiblingCheckoutPath resolves to: five levels up
      # from src/Hosts/PeakPower.AppHost is $GITHUB_WORKSPACE, and 'peakpower-web' is the folder
      # name that file hard-codes.
      - name: Check out peakpower-web beside it
        uses: actions/checkout@v4
        with:
          repository: peakpower-nl/peakpower-web
          token: ${{ secrets.CROSS_REPO_READ_TOKEN }}
          path: peakpower-web

      # tools/verify-repositories.sh treats a detached HEAD as a defect, and it is right to: a
      # commit made on one is unreachable the moment anything else is checked out. On a runner that
      # reasoning is vacuous - nothing commits here - but the guard is not weakened for a runner's
      # convenience. actions/checkout leaves a push event on a named branch already and a
      # pull_request event on refs/pull/N/merge, which is detached; -B puts both on one.
      - name: Put both checkouts on a named branch
        run: |
          set -euo pipefail
          git -C peakpower-platform checkout -B "${{ github.head_ref || github.ref_name }}"
          git -C peakpower-web rev-parse --abbrev-ref HEAD | grep -qv '^HEAD$' \
            || git -C peakpower-web checkout -B ci

      - name: Install .NET 10.0.400
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '10.0.400'

      # Aspire 13.5.3 is a CLI global tool plus an MSBuild SDK, never a dotnet workload. The
      # AppHost sets AspireUseCliBundle=true (its own csproj explains why: without it ASPIRE010 is
      # a warning, and TreatWarningsAsErrors makes a warning fail the whole solution), and that
      # setting is what makes the CLI bundle a build input. Installing it costs a few seconds and
      # removes a class of failure that only ever appears on a clean machine.
      - name: Install the Aspire CLI 13.5.3
        run: |
          set -euo pipefail
          dotnet tool install --global aspire.cli --version 13.5.3
          echo "$HOME/.dotnet/tools" >> "$GITHUB_PATH"

      # Explicit, and first, even though verify-solution-layout.sh builds too. A compile error
      # should fail in fifteen seconds with the compiler's own message rather than inside a guard
      # whose subject is the project list.
      - name: Build with warnings as errors
        working-directory: peakpower-platform
        run: dotnet build PeakPower.sln --nologo -warnaserror

      - name: tools/verify-build-settings.sh
        working-directory: peakpower-platform
        run: tools/verify-build-settings.sh

      - name: tools/verify-repositories.sh
        working-directory: peakpower-platform
        run: tools/verify-repositories.sh

      - name: tools/verify-solution-layout.sh
        working-directory: peakpower-platform
        run: tools/verify-solution-layout.sh

      - name: tools/verify-aspire-api.sh
        working-directory: peakpower-platform
        run: tools/verify-aspire-api.sh

      # Runs the real Migrator process TWICE against a throwaway postgres:17 to prove idempotence,
      # and asserts the grants and policies of the tables slice 1 shipped. Docker is preinstalled
      # on ubuntu-latest; nothing here starts a daemon.
      - name: tools/verify-migrator.sh
        working-directory: peakpower-platform
        run: tools/verify-migrator.sh

      # THE TEST STEP. This runs every test project itself, so there is no separate
      # `dotnet test PeakPower.sln` above it - one pass, and the pass is the one that also refuses
      # a silent skip.
      - name: tools/verify-no-unexpected-skips.sh
        working-directory: peakpower-platform
        run: tools/verify-no-unexpected-skips.sh

      # The TRX files and the per-project logs, so a failure can be read without re-running
      # anything. if: always() rather than if: failure() - a green run's numbers are what the
      # design document asks to be re-measured.
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: platform-test-results
          path: /tmp/peakpower-test-results
          retention-days: 7
```

- [ ] **Step 3: Push the branch and watch the workflow run green**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add .github/workflows/ci.yml
git commit -m "ci(platform): build, six guards and every test, callable as a deploy gate"
git push -u origin ci-proof
gh run watch "$(gh run list --workflow=CI --branch=ci-proof --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: PASS — every step green, and the `tools/verify-no-unexpected-skips.sh` step ending in
`verify-no-unexpected-skips: OK`.

⚠ If the `Check out peakpower-web beside it` step fails with
`remote: Repository not found`, `CROSS_REPO_READ_TOKEN` is missing or lacks `Contents: read` on
`peakpower-nl/peakpower-web`. Fix the secret; do not delete the step.

- [ ] **Step 4: Verify the job by mutation — break a test and watch CI go red**

Design §7.1 requires CI to be proven "by pushing a deliberately failing test". Break the cheapest
assertion in the repository, one whose failure message is unmistakable.

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Time/MarketCalendarTests.cs`,
line 41, from

```csharp
        calendar.TodayInAmsterdam.ShouldBe(new DateOnly(2026, 1, 16));
```

to

```csharp
        calendar.TodayInAmsterdam.ShouldBe(new DateOnly(1999, 1, 16));
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git commit -am "TEMPORARY: break one calendar assertion to prove CI catches it"
git push
gh run watch "$(gh run list --workflow=CI --branch=ci-proof --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: **FAIL** at the `tools/verify-no-unexpected-skips.sh` step, with
`FAIL: PeakPower.Application.Tests exited 1` and, in the uploaded artefact's
`PeakPower.Application.Tests.log`,
`Today_in_Amsterdam_uses_winter_time_in_January [FAIL]` and
`calendar.TodayInAmsterdam should be 1999-01-16 but was 2026-01-16`.

Then restore it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git revert --no-edit HEAD
git push
```

- [ ] **Step 5: Commit**

The workflow is already committed by step 3 and the mutation reverted by step 4. Merge the branch
and delete it — task 4 re-uses the same branch name for the deploy-gate proof, so leaving it behind
makes that step ambiguous.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git checkout main
git merge --no-ff ci-proof -m "ci(platform): add the CI workflow

Runs dotnet build -warnaserror, the five tools/verify-*.sh guards and
tools/verify-no-unexpected-skips.sh, with peakpower-web checked out beside the platform so
AppHost.Tests reports zero skipped. Exposed as workflow_call so deploy.yml can gate on it with
needs:, which is the only shape in which a failing test stops a deployment.

Verified by mutation: a deliberately broken assertion in MarketCalendarTests turned the run red at
the test step with the predicted message, and reverting it turned it green again."
git branch -d ci-proof
git push origin --delete ci-proof
```

---

### Task 3: CI in `peakpower-web`

`peakpower-web`'s `npm test` is `test:workspace && test:shared-ui && test:customer-portal &&
test:employee-portal`, and `test:workspace` is `node --test tools/*.test.mjs`, which includes
`tools/verify-clients.test.mjs`. That file loops the real `CLIENTS` registry through
`checkClient()` and regenerates both typed API clients from the platform's committed
`artifacts/openapi/{customer,employee}.json` — so **`npm test` needs a `peakpower-platform`
checkout**, and a missing one is a hard failure rather than a skip, deliberately. That is why this
job checks out two repositories as well.

⚠ **`tools/dev-up.test.sh` hard-codes `/Users/thinhhuynh/PeakPower/peakpower-web` and would fail
on a runner.** It is not run by `npm test` — `test:workspace` globs `tools/*.test.mjs` — and this
job runs `npm test` and nothing else, so it is not invoked. Do not add it to the job; making it
path-independent is a separate change with no bearing on this slice.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-web/.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `peakpower-web`'s `package.json` scripts (`test` → `test:workspace` +
  `test:shared-ui` + `test:customer-portal` + `test:employee-portal`), the platform's committed
  `artifacts/openapi/*.json`, and the repository secret `CROSS_REPO_READ_TOKEN`.
- Produces: a workflow named `CI` with one job `install-and-test`, callable as
  `uses: ./.github/workflows/ci.yml`.

- [ ] **Step 1: Write the failing test**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git checkout -b ci-proof
gh workflow list
```

Expected: the listing contains **only** `Deploy`. Nothing runs `npm test` before a merge, so a
front-end regression reaches `main` unnoticed.

- [ ] **Step 2: Write the workflow**

Create `/Users/thinhhuynh/PeakPower/peakpower-web/.github/workflows/ci.yml`:

```yaml
# Install and test peakpower-web.
#
# THE SECOND CHECKOUT IS NOT OPTIONAL. `npm test` runs test:workspace first, and
# tools/verify-clients.test.mjs loops the real CLIENTS registry through checkClient(), which
# regenerates both typed API clients from peakpower-platform's committed
# artifacts/openapi/{customer,employee}.json and diffs them byte-for-byte against what is checked
# in here. That is what makes [DEC-116]'s drift guard load-bearing: without it a platform contract
# change can go in, the Verify snapshot can be accepted, and
# libs/api-client-customer/src/generated/customer-schema.d.ts goes stale with every customer-portal
# test still green - they type against the stale schema and mock HTTP, so the portal only breaks in
# a browser. tools/openapi-clients.mjs resolves the platform as a SIBLING directory, or from
# PEAKPOWER_PLATFORM_PATH; a missing checkout throws rather than skipping, by design.
#
# THIS WORKFLOW IS ALSO THE DEPLOY GATE, through `uses:` from deploy.yml - see that file. Its own
# push trigger ignores main so the suite does not run twice for every merge.
#
# REQUIRED SECRET
#   CROSS_REPO_READ_TOKEN - a fine-grained PAT with Contents:read on peakpower-nl/peakpower-platform.

name: CI

on:
  push:
    branches-ignore: [main]
  pull_request:
  workflow_call:

concurrency:
  group: ci-web-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  install-and-test:
    name: Install and test
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Check out peakpower-web
        uses: actions/checkout@v4
        with:
          path: peakpower-web

      # SIBLING, and the name matters: tools/openapi-clients.mjs resolves
      # resolve(WEB_ROOT, '..', 'peakpower-platform') when PEAKPOWER_PLATFORM_PATH is unset.
      - name: Check out peakpower-platform beside it
        uses: actions/checkout@v4
        with:
          repository: peakpower-nl/peakpower-platform
          token: ${{ secrets.CROSS_REPO_READ_TOKEN }}
          path: peakpower-platform

      - name: Install Node 24.15.0
        uses: actions/setup-node@v4
        with:
          node-version: '24.15.0'
          cache: npm
          cache-dependency-path: peakpower-web/package-lock.json

      # npm ci and not npm install: the lockfile is the input. A CI run that re-resolves versions
      # is a run whose result depends on the day it happened.
      - name: npm ci
        working-directory: peakpower-web
        run: npm ci --no-audit --no-fund

      # The whole of it: the workspace contract (which includes the cross-repo client drift guard),
      # the design system, and both portals. Vitest runs on jsdom - angular.json's test targets use
      # @angular/build:unit-test with the vitest runner - so no browser is downloaded and none is
      # needed.
      - name: npm test
        working-directory: peakpower-web
        run: npm test
```

- [ ] **Step 3: Push the branch and watch the workflow run green**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add .github/workflows/ci.yml
git commit -m "ci(web): npm ci and npm test with a second checkout of peakpower-platform"
git push -u origin ci-proof
gh run watch "$(gh run list --workflow=CI --branch=ci-proof --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: PASS — the `npm test` step ends with all four sub-suites reporting no failures.

⚠ If `npm test` fails inside `test:workspace` with
`Build peakpower-platform first, or set PEAKPOWER_PLATFORM_PATH to its checkout.`, the second
checkout landed somewhere other than `$GITHUB_WORKSPACE/peakpower-platform`. Fix the `path:`; do
not set `PEAKPOWER_PLATFORM_PATH` as a workaround, because the sibling layout is what the runbook,
`dev-up` and every other tool in both repositories assume.

- [ ] **Step 4: Verify the job by mutation — break a spec and watch CI go red**

Edit `/Users/thinhhuynh/PeakPower/peakpower-web/tools/workspace.test.mjs`, the first test body, and
change

```js
  assert.ok(pkg.scripts['start:customer-portal'], 'start:customer-portal is missing');
```

to

```js
  assert.ok(pkg.scripts['start:customer-portal-does-not-exist'], 'start:customer-portal is missing');
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git commit -am "TEMPORARY: break one workspace assertion to prove CI catches it"
git push
gh run watch "$(gh run list --workflow=CI --branch=ci-proof --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: **FAIL** at the `npm test` step, with
`the workspace root declares the scripts the Aspire AppHost invokes` failing and the message
`start:customer-portal is missing`.

Then restore it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git revert --no-edit HEAD
git push
```

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git checkout main
git merge --no-ff ci-proof -m "ci(web): add the CI workflow

npm ci and npm test with peakpower-platform checked out as a sibling, which test:workspace needs:
tools/verify-clients.test.mjs regenerates both typed API clients from the platform's committed
OpenAPI documents and fails on drift, and a missing checkout is a hard failure there rather than a
skip. Exposed as workflow_call so deploy.yml can gate on it with needs:.

Verified by mutation: a deliberately broken assertion in tools/workspace.test.mjs turned the run
red at the npm test step with the predicted message, and reverting it turned it green again."
git branch -d ci-proof
git push origin --delete ci-proof
```

---

### Task 4: The deploy gate, the cross-repository `flock` and the bounded image prune

Three changes to the same file in both repositories, and the two files stay byte-identical below
the `name:` line, which is the property that made them easy to keep in step in slice 1.

1. **`needs:`.** A `test` job whose entire body is `uses: ./.github/workflows/ci.yml`, and
   `needs: test` on the deploy job. `secrets: inherit`, because the called workflow needs
   `CROSS_REPO_READ_TOKEN` and a called workflow receives no secrets by default.
2. **The `flock`.** Both repositories deploy to the **same VM** and both run `docker compose build`
   against the **same two checkouts** and the **same image names**. The existing
   `concurrency: deploy-production` group is per repository, so it does nothing about a
   peakpower-web deploy that starts while a peakpower-platform deploy is halfway through
   `git pull` and `docker compose build`. The lock is taken on the server, before the first `git
   pull`, and released when the shell exits.
3. **The prune.** Every deploy builds four images from source and leaves the previous four
   dangling. Bounded means three things: **dangling only** (no `-a`, which would delete
   `postgres:17` and the `aspnet:10.0` base layers nothing happens to be running and force a
   re-pull on the next build), **older than a week** (`until=168h`, so a rollback to the previous
   image is still possible for seven days), and **never `--volumes`**, which is the database.

⚠ `flock --wait 900` is fifteen minutes and the ssh-action's `command_timeout` is twenty. Raise the
timeout to thirty so a deploy that waits out a long build still has time to run, and raise the
job's `timeout-minutes` with it. Leave `--wait` strictly below `command_timeout` or the lock wait
is killed by the transport rather than reporting the contention it was waiting on.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/.github/workflows/deploy.yml:15-63`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/.github/workflows/deploy.yml:15-63`

**Interfaces:**
- Consumes: `.github/workflows/ci.yml` in each repository (tasks 2 and 3), and the existing
  `DEPLOY_SSH_KEY` / `DEPLOY_HOST` / `DEPLOY_USER` secrets.
- Produces: a `Deploy` workflow in each repository whose `deploy` job runs only after that
  repository's whole test suite has passed.

- [ ] **Step 1: Write the failing test**

Prove the gate is absent before adding it. On a branch, break a test and dispatch the deploy
workflow from that branch — `on: workflow_dispatch` is already in the file, and a dispatch runs the
workflow *as it exists on the chosen ref*, so nothing on `main` is touched.

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git checkout -b deploy-gate-proof
sed -i '' 's/new DateOnly(2026, 1, 16)/new DateOnly(1999, 1, 16)/' \
  tests/PeakPower.Application.Tests/Time/MarketCalendarTests.cs
git commit -am "TEMPORARY: a failing test, to prove the deploy gate"
git push -u origin deploy-gate-proof
gh workflow run Deploy --ref deploy-gate-proof
sleep 10
gh run list --workflow=Deploy --branch=deploy-gate-proof --limit 1
```

Expected: the run has **one job, `Deploy to VM`, and it runs** — it SSHes to the server and
redeploys, with the broken test still in the tree. That is the failure: today, nothing stands
between a red suite and a deployment.

⚠ Let that run finish rather than cancelling it. It deploys the same commit `main` is on plus one
broken test file, and the broken file is a test, so the deployed stack is unchanged.

- [ ] **Step 2: Rewrite `deploy.yml` in the platform repository**

Replace the whole of
`/Users/thinhhuynh/PeakPower/peakpower-platform/.github/workflows/deploy.yml` with:

```yaml
# Deploy to the PeakPower VM on every push to main, AFTER the whole suite has passed.
#
# SSHes into the server, pulls both repositories (the Docker build context spans both), rebuilds
# the images from source and restarts the stack. Only one deploy runs at a time — a push that
# arrives while the previous deploy is still running cancels the in-progress one rather than
# queuing behind it, because the newer commit is the one the server should end up on.
#
# THE GATE. `needs: test` is what makes a red suite stop a deployment, and the `test` job is this
# repository's own CI workflow called with `uses:`. GitHub's `needs:` only orders jobs inside one
# workflow file, so calling ci.yml is the only shape that works — `workflow_run` fires after the
# first workflow has finished and can stop nothing. `secrets: inherit` because a called workflow
# receives no secrets by default and ci.yml needs CROSS_REPO_READ_TOKEN for its second checkout.
#
# Required secrets (set in repo Settings → Secrets → Actions):
#   DEPLOY_SSH_KEY          — the private key whose public half is in ~/.ssh/authorized_keys on the VM
#   DEPLOY_HOST             — the VM's IP address or hostname
#   DEPLOY_USER             — the SSH user on the VM (must be in the docker group)
#   CROSS_REPO_READ_TOKEN   — read access to the sibling repository, for ci.yml
#
# The same workflow lives in peakpower-web so that a push to either repo triggers a deploy, and the
# two files are deliberately identical below the name.

name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-production
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  test:
    name: CI
    uses: ./.github/workflows/ci.yml
    secrets: inherit

  deploy:
    name: Deploy to VM
    needs: test
    runs-on: ubuntu-latest
    timeout-minutes: 45

    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script_stop: true
          command_timeout: 30m
          script: |
            set -euo pipefail

            DEPLOY_DIR="$HOME/peakpower"

            # ── one deploy at a time, ACROSS BOTH REPOSITORIES ──
            # The concurrency group above is per repository, so it says nothing about a
            # peakpower-web deploy starting while this one is halfway through `git pull` and
            # `docker compose build`. Both deploys pull the same two checkouts and build the same
            # image names from the same context, so overlapping them means one build reading a tree
            # the other is rewriting - and BuildKit's cache mounts are shared, so a concurrent cold
            # build is the same NuGet extraction race deploy/Dockerfile documents.
            #
            # File descriptor 9 rather than a lock file with a PID in it: the kernel releases it
            # when this shell exits, however it exits, so a killed deploy cannot leave the next one
            # waiting for ever. --wait 900 is fifteen minutes, deliberately below command_timeout,
            # so contention is reported by this script rather than killed by the transport.
            LOCK="$HOME/.peakpower-deploy.lock"
            exec 9>"$LOCK"
            if ! flock --wait 900 9; then
              echo "another deploy has held $LOCK for fifteen minutes; refusing to build concurrently" >&2
              exit 1
            fi

            echo "── pulling peakpower-platform ──"
            cd "$DEPLOY_DIR/peakpower-platform"
            git pull --ff-only origin main

            echo "── pulling peakpower-web ──"
            cd "$DEPLOY_DIR/peakpower-web"
            git pull --ff-only origin main

            echo "── building and deploying ──"
            cd "$DEPLOY_DIR/peakpower-platform/deploy"
            docker compose build
            docker compose up -d

            echo "── waiting for services to be healthy ──"
            sleep 5
            docker compose ps

            # ── bounded image prune ──
            # Every deploy builds four images from source and leaves the previous four dangling.
            # BOUNDED means three things, and each of the three is a decision:
            #   no -a          - `-a` removes every image no CONTAINER is using, which on this box
            #                    includes postgres:17 and the aspnet:10.0 / node:24 layers between
            #                    builds. The next build then re-pulls them over the network.
            #   until=168h     - a week. Rolling back to the previous image is still possible for
            #                    seven days; without a filter the image the stack was running an
            #                    hour ago is gone.
            #   never --volumes - that flag deletes the database.
            echo "── pruning dangling images older than a week ──"
            docker image prune --force --filter "until=168h"

            echo "── deploy complete ──"
```

- [ ] **Step 3: Run it and watch the deploy job be skipped**

Copy the rewritten file onto the proof branch and dispatch again. The branch still carries the
broken test from step 1.

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git checkout deploy-gate-proof
git checkout main -- .github/workflows/deploy.yml 2>/dev/null || true
# (if the rewrite is not yet on main, edit the file on this branch instead — the point is that the
#  branch carries BOTH the rewritten workflow and the broken test)
git add .github/workflows/deploy.yml
git commit -m "TEMPORARY: the gated deploy workflow, on the proof branch"
git push
gh workflow run Deploy --ref deploy-gate-proof
sleep 10
run_id="$(gh run list --workflow=Deploy --branch=deploy-gate-proof --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$run_id"
gh run view "$run_id" --json jobs --jq '.jobs[] | "\(.name)\t\(.conclusion)"'
```

Expected:

```
Build, guard and test	failure
Deploy to VM	skipped
```

**The deploy job never runs.** That is design §7.1's proof, and it is the whole reason `needs:`
exists in this file.

- [ ] **Step 4: Restore, and confirm the gate opens for a green suite**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git checkout deploy-gate-proof
sed -i '' 's/new DateOnly(1999, 1, 16)/new DateOnly(2026, 1, 16)/' \
  tests/PeakPower.Application.Tests/Time/MarketCalendarTests.cs
git commit -am "TEMPORARY: restore the assertion, to prove the gate opens as well as closes"
git push
gh workflow run Deploy --ref deploy-gate-proof
sleep 10
run_id="$(gh run list --workflow=Deploy --branch=deploy-gate-proof --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$run_id"
gh run view "$run_id" --json jobs --jq '.jobs[] | "\(.name)\t\(.conclusion)"'
```

Expected:

```
Build, guard and test	success
Deploy to VM	success
```

Only the pair is a claim: a `needs:` that never lets anything through is a broken deploy, not a
gate.

- [ ] **Step 5: Make the same change in `peakpower-web`**

Replace the whole of `/Users/thinhhuynh/PeakPower/peakpower-web/.github/workflows/deploy.yml` with
**the identical file from step 2**, changing only the header sentence that names the sibling:

```yaml
# Deploy to the PeakPower VM on every push to main, AFTER the whole suite has passed.
#
# SSHes into the server, pulls both repositories (the Docker build context spans both), rebuilds
# the images from source and restarts the stack. Only one deploy runs at a time — a push that
# arrives while the previous deploy is still running cancels the in-progress one rather than
# queuing behind it, because the newer commit is the one the server should end up on.
#
# THE GATE. `needs: test` is what makes a red suite stop a deployment, and the `test` job is this
# repository's own CI workflow called with `uses:`. GitHub's `needs:` only orders jobs inside one
# workflow file, so calling ci.yml is the only shape that works — `workflow_run` fires after the
# first workflow has finished and can stop nothing. `secrets: inherit` because a called workflow
# receives no secrets by default and ci.yml needs CROSS_REPO_READ_TOKEN for its second checkout.
#
# Required secrets (set in repo Settings → Secrets → Actions):
#   DEPLOY_SSH_KEY          — the private key whose public half is in ~/.ssh/authorized_keys on the VM
#   DEPLOY_HOST             — the VM's IP address or hostname
#   DEPLOY_USER             — the SSH user on the VM (must be in the docker group)
#   CROSS_REPO_READ_TOKEN   — read access to the sibling repository, for ci.yml
#
# The same workflow lives in peakpower-platform so that a push to either repo triggers a deploy,
# and the two files are deliberately identical below the name.

name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-production
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  test:
    name: CI
    uses: ./.github/workflows/ci.yml
    secrets: inherit

  deploy:
    name: Deploy to VM
    needs: test
    runs-on: ubuntu-latest
    timeout-minutes: 45

    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USER }}
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script_stop: true
          command_timeout: 30m
          script: |
            set -euo pipefail

            DEPLOY_DIR="$HOME/peakpower"

            # ── one deploy at a time, ACROSS BOTH REPOSITORIES ──
            # The concurrency group above is per repository, so it says nothing about a
            # peakpower-platform deploy starting while this one is halfway through `git pull` and
            # `docker compose build`. Both deploys pull the same two checkouts and build the same
            # image names from the same context, so overlapping them means one build reading a tree
            # the other is rewriting - and BuildKit's cache mounts are shared, so a concurrent cold
            # build is the same NuGet extraction race deploy/Dockerfile documents.
            #
            # File descriptor 9 rather than a lock file with a PID in it: the kernel releases it
            # when this shell exits, however it exits, so a killed deploy cannot leave the next one
            # waiting for ever. --wait 900 is fifteen minutes, deliberately below command_timeout,
            # so contention is reported by this script rather than killed by the transport.
            LOCK="$HOME/.peakpower-deploy.lock"
            exec 9>"$LOCK"
            if ! flock --wait 900 9; then
              echo "another deploy has held $LOCK for fifteen minutes; refusing to build concurrently" >&2
              exit 1
            fi

            echo "── pulling peakpower-platform ──"
            cd "$DEPLOY_DIR/peakpower-platform"
            git pull --ff-only origin main

            echo "── pulling peakpower-web ──"
            cd "$DEPLOY_DIR/peakpower-web"
            git pull --ff-only origin main

            echo "── building and deploying ──"
            cd "$DEPLOY_DIR/peakpower-platform/deploy"
            docker compose build
            docker compose up -d

            echo "── waiting for services to be healthy ──"
            sleep 5
            docker compose ps

            # ── bounded image prune ──
            # Every deploy builds four images from source and leaves the previous four dangling.
            # BOUNDED means three things, and each of the three is a decision:
            #   no -a          - `-a` removes every image no CONTAINER is using, which on this box
            #                    includes postgres:17 and the aspnet:10.0 / node:24 layers between
            #                    builds. The next build then re-pulls them over the network.
            #   until=168h     - a week. Rolling back to the previous image is still possible for
            #                    seven days; without a filter the image the stack was running an
            #                    hour ago is gone.
            #   never --volumes - that flag deletes the database.
            echo "── pruning dangling images older than a week ──"
            docker image prune --force --filter "until=168h"

            echo "── deploy complete ──"
```

- [ ] **Step 6: Prove the two files agree**

The two deploy scripts must not drift; the lock only works if both take it, on the same path.

Run:

```bash
diff <(sed -n '/^            LOCK=/,$p' /Users/thinhhuynh/PeakPower/peakpower-platform/.github/workflows/deploy.yml) \
     <(sed -n '/^            LOCK=/,$p' /Users/thinhhuynh/PeakPower/peakpower-web/.github/workflows/deploy.yml) \
  && echo "the two remote scripts are identical from the lock onwards"
```

Expected: `the two remote scripts are identical from the lock onwards`, with no diff output.

- [ ] **Step 7: Verify the lock by mutation — hold it and watch a deploy refuse**

On the VM, take the lock in one shell and dispatch a deploy from the other repository.

Run (on the deployment host, in a session you keep open):

```bash
exec 9>"$HOME/.peakpower-deploy.lock"
flock 9
echo "lock held; leave this shell open"
```

Then, from a developer machine:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
gh workflow run Deploy --ref main
```

Expected: after fifteen minutes the deploy job fails with
`another deploy has held /home/<user>/.peakpower-deploy.lock for fifteen minutes; refusing to build concurrently`.

⚠ Fifteen minutes is a long verification. It is run **once**, here, because the alternative is a
lock nobody has ever seen work, and a lock that silently does not lock is worse than none: it makes
the concurrent build look impossible. Release the lock by exiting the holding shell.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git checkout main
git add .github/workflows/deploy.yml
git commit -m "ci(platform): gate the deploy on CI, take a cross-repository lock, prune bounded

needs: test on the deploy job, where test is this repository's own ci.yml called with uses: -
the only shape in which needs: can gate across two workflow files.

The server-side script takes an flock on \$HOME/.peakpower-deploy.lock before the first git pull.
The concurrency group above it is per repository and says nothing about the OTHER repository's
deploy, which pulls the same two checkouts and builds the same image names from the same context.

The prune is dangling-only, older than a week, and never --volumes: -a would delete postgres:17
and the base layers between builds, and a week keeps a rollback possible.

Verified by dispatching Deploy from a branch carrying a deliberately broken test: 'Build, guard
and test failure / Deploy to VM skipped'. Restoring the assertion turned both green. The lock was
verified by holding it on the VM and watching the other repository's deploy refuse after fifteen
minutes."
git push

cd /Users/thinhhuynh/PeakPower/peakpower-web
git checkout main
git add .github/workflows/deploy.yml
git commit -m "ci(web): gate the deploy on CI, take a cross-repository lock, prune bounded

Identical below the name to peakpower-platform's deploy.yml, and identical from the lock onwards -
the flock only works if both repositories take it, on the same path. See that repository's commit
for the reasoning and the verification."
git push

cd /Users/thinhhuynh/PeakPower/peakpower-platform
git push origin --delete deploy-gate-proof
git branch -D deploy-gate-proof
```

---

### Task 5: The four new projects, the solution entries, and `verify-solution-layout.sh` 18 → 22

Contract §3.1 gives the four paths, the reference graph and the arithmetic: **seventeen source
projects and five test projects, twenty-two in total**. No new test project is created; the four
kinds of test each already have a home.

Three of the four arrive with nothing but an assembly marker, exactly as slice 1 created
`Infrastructure.Web`, `.Identity` and `.Email` empty for later plans to fill. That is deliberate:
a project invented mid-plan gets invented in the wrong place, and `PeakPower.Ingestion`'s place in
particular is named verbatim inside a test that has been waiting for it (task 6).

⚠ **`PeakPower.DevStubs` may not reference `PeakPower.Integration.Brp.Pvned` or
`PeakPower.Ingestion`.** S2-D4: the generator emits templated XML *text* and never serialises the
parser's own model, so that generator and parser cannot share a type and hide a shared misreading
of the PVNed format. The csproj is where that is enforced.

⚠ **`PeakPower.Integration.Brp.Pvned` may not reference `PeakPower.Ingestion`.** The port points
one way. `PeakPower.Worker` is the only project that sees both, because it is the composition root
that binds them.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/AssemblyMarker.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Integration.Brp.Pvned/AssemblyMarker.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/PeakPower.Worker.csproj`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/WorkerEntryPoint.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Program.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/Program.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-solution-layout.sh:2` and `:12-31`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/PeakPower.sln` (via `dotnet sln add`)

**Interfaces:**
- Consumes: `PeakPower.Application`, `PeakPower.Domain`, `PeakPower.Persistence`,
  `PeakPower.Contracts`, `PeakPower.Infrastructure.Time`, `PeakPower.ServiceDefaults` — all
  slice 1's, unchanged.
- Produces:
  - assembly `PeakPower.Ingestion` with `PeakPower.Ingestion.AssemblyMarker`
  - assembly `PeakPower.Integration.Brp.Pvned` with
    `PeakPower.Integration.Brp.Pvned.AssemblyMarker`
  - assembly `PeakPower.Worker` with `PeakPower.Worker.WorkerEntryPoint` — the type
    `WebApplicationFactory<WorkerEntryPoint>` anchors on
  - assembly `PeakPower.DevStubs`, a console executable
  - `tools/verify-solution-layout.sh` asserting twenty-two projects

- [ ] **Step 1: Write the failing test**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-solution-layout.sh`.

Line 2, from

```bash
# Asserts that the eighteen slice-1 projects are in the solution and that the whole thing builds.
```

to

```bash
# Asserts that the twenty-two projects are in the solution and that the whole thing builds.
# Eighteen from slice 1; slice 2 adds PeakPower.Ingestion, PeakPower.Integration.Brp.Pvned,
# PeakPower.Worker and PeakPower.DevStubs. Seventeen source projects and five test projects - no
# new test project was created, which is what makes this twenty-two rather than twenty-four.
```

and add four lines to the `expected=(` array, after line 30
(`"tests/PeakPower.AppHost.Tests/PeakPower.AppHost.Tests.csproj"`) — verbatim from contract §3.1:

```bash
  "src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj"
  "src/Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj"
  "src/Hosts/PeakPower.Worker/PeakPower.Worker.csproj"
  "src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj"
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && tools/verify-solution-layout.sh`
Expected: FAIL with

```
FAIL: not in the solution: src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj
FAIL: not in the solution: src/Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj
FAIL: not in the solution: src/Hosts/PeakPower.Worker/PeakPower.Worker.csproj
FAIL: not in the solution: src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj
verify-solution-layout: 4 check(s) failed
```

- [ ] **Step 3: Create `PeakPower.Ingestion`**

```bash
mkdir -p /Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <!--
    The BRP-AGNOSTIC half of ingestion - [DEC-69]'s port, and nothing behind it.

    ARCHITECTURE FACT 3 IS ABOUT THIS FILE. Nothing here may reference an assembly whose name
    starts PeakPower.Integration.Brp: this project talks to adapters through
    IBrpIngestionAdapter and resolves one at dequeue time from the stored brp_id (S2-D3), so a
    replay is parsed by the same adapter that first parsed it - including after that BRP has been
    deactivated. A ProjectReference here would compile perfectly and quietly make the seam a
    decoration. CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter reads the compiled IL
    and is what stops that.

    PeakPower.Persistence, because the pipeline writes: inbound_message, interval_data_version,
    interval_reading and the quarantine rows are its work.
  -->
  <ItemGroup>
    <ProjectReference Include="../../Core/PeakPower.Domain/PeakPower.Domain.csproj" />
    <ProjectReference Include="../../Core/PeakPower.Application/PeakPower.Application.csproj" />
    <ProjectReference Include="../PeakPower.Persistence/PeakPower.Persistence.csproj" />
  </ItemGroup>
  <ItemGroup>
    <!-- The queue's hosted drain is a BackgroundService, the same base class
         PeakPower.Infrastructure.Email/OutboundMailService.cs already uses here. Abstractions
         only: a library must not pull in a host builder. -->
    <PackageReference Include="Microsoft.Extensions.Hosting.Abstractions" />
    <PackageReference Include="Microsoft.Extensions.Logging.Abstractions" />
  </ItemGroup>
</Project>
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/AssemblyMarker.cs`:

```csharp
namespace PeakPower.Ingestion;

/// <summary>Anchor type so tests can obtain this assembly without depending on a real type.</summary>
/// <remarks>
/// This project's whole subject is the BRP-agnostic pipeline: receive, store, enqueue, resolve an
/// adapter by the stored brp_id, apply a whole document atomically, quarantine what cannot be
/// attached. Plan 3 fills it in; plan 1 creates it because
/// <c>CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter</c> has been skipping since slice 1
/// with a message naming this exact path, and a fact that has never run is not a guard.
/// </remarks>
public sealed class AssemblyMarker;
```

- [ ] **Step 4: Create `PeakPower.Integration.Brp.Pvned`**

```bash
mkdir -p /Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Integration.Brp.Pvned
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <!--
    The PVNed adapter - the only implementation of IBrpIngestionAdapter, and plan 4's project.

    THE PORT POINTS ONE WAY. This project may NOT reference PeakPower.Ingestion: the pipeline
    resolves an adapter through the port, the adapter never calls the pipeline back, and it never
    resolves an EAN or decides quarantine ([F02-R40], contract section 7.1). An adapter that could
    see the pipeline would be able to reimplement a pipeline stage, which is the thing the seam
    exists to prevent.

    PeakPower.Application for the port and the canonical types; PeakPower.Domain for EanCode and
    IntervalDirection. Nothing else - not Persistence, because parsing touches no database.
  -->
  <ItemGroup>
    <ProjectReference Include="../../Core/PeakPower.Domain/PeakPower.Domain.csproj" />
    <ProjectReference Include="../../Core/PeakPower.Application/PeakPower.Application.csproj" />
  </ItemGroup>
  <ItemGroup>
    <!-- PvnedAdapterOptions binds from configuration section "Brp:Pvned" (contract section 8.6).
         Abstractions only; the hosts supply the provider. -->
    <PackageReference Include="Microsoft.Extensions.Configuration.Abstractions" />
    <PackageReference Include="Microsoft.Extensions.Logging.Abstractions" />
  </ItemGroup>
</Project>
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Integration.Brp.Pvned/AssemblyMarker.cs`:

```csharp
namespace PeakPower.Integration.Brp.Pvned;

/// <summary>Anchor type so tests can obtain this assembly without depending on a real type.</summary>
/// <remarks>
/// Plan 4 fills this in: the SOAP unwrap, the XXE-hardened reader, the reconstructed XSD and its
/// SchemaProvenance, the code decoding, ResourceObject interpretation and the thirteen failure
/// codes. Plan 1 creates it so that the module graph, tools/verify-solution-layout.sh and
/// architecture fact 5 cover it from the first commit rather than from the one that fills it.
/// </remarks>
public sealed class AssemblyMarker;
```

- [ ] **Step 5: Create `PeakPower.Worker`**

```bash
mkdir -p /Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/PeakPower.Worker.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">
  <!--
    The webhook host and the job server. THE COMPOSITION ROOT THAT BINDS THE ADAPTER TO THE PORT,
    and the only project in the solution that references both PeakPower.Ingestion and
    PeakPower.Integration.Brp.Pvned - which is exactly why neither of those two may reference the
    other (contract section 3.1).

    Microsoft.NET.Sdk.Web and not Microsoft.NET.Sdk: this host serves
    POST /webhooks/brp/{brpCode}. It serves NO /api/v1 route at all, which is a route-table test
    rather than a comment - see tests/PeakPower.Integration.Tests/Hosts/WorkerHostTests.cs.
  -->
  <ItemGroup>
    <ProjectReference Include="../../Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj" />
    <ProjectReference Include="../../Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj" />
    <ProjectReference Include="../../Infrastructure/PeakPower.Persistence/PeakPower.Persistence.csproj" />
    <ProjectReference Include="../../Infrastructure/PeakPower.Infrastructure.Time/PeakPower.Infrastructure.Time.csproj" />
    <ProjectReference Include="../PeakPower.ServiceDefaults/PeakPower.ServiceDefaults.csproj" />
  </ItemGroup>
  <ItemGroup>
    <!-- AddNpgsqlDbContext<PeakPowerDbContext>("peakpower") in Program.cs, the same integration
         the customer API uses. Plan 3 is what calls it; the package is pinned here now so the
         host's dependency set does not change under plan 3's feet. -->
    <PackageReference Include="Aspire.Npgsql.EntityFrameworkCore.PostgreSQL" />
  </ItemGroup>
  <ItemGroup>
    <InternalsVisibleTo Include="PeakPower.Integration.Tests" />
  </ItemGroup>
</Project>
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/WorkerEntryPoint.cs`:

```csharp
namespace PeakPower.Worker;

/// <summary>
/// The type <c>WebApplicationFactory&lt;WorkerEntryPoint&gt;</c> anchors on.
/// </summary>
/// <remarks>
/// Slice 1's rule, unchanged: no host declares <c>public partial class Program</c>. A marker type
/// in the host's own namespace is what a test factory needs, and it costs the host nothing.
/// </remarks>
public sealed class WorkerEntryPoint;
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Program.cs`:

```csharp
using PeakPower.ServiceDefaults;

// The Worker host: the BRP webhook and the job server behind it.
//
// WHAT IS HERE NOW, AND WHAT IS NOT. Plan 1 stands the host up so the AppHost can register it, so
// deploy/Dockerfile can carry a runtime stage for it, and so the route-table test that says it
// exposes no /api/v1 route can exist before there is a route to get wrong. Plan 3 maps
// POST /webhooks/brp/{brpCode} onto it and wires IRawPayloadStore, the credential check and the
// job handler; plan 5 adds the FINAL and silence-detection schedules.
//
// NO /api/v1 ROUTE, EVER. The webhook is not a customer or employee API: it carries no session,
// it is authenticated per BRP by a shared-secret header (contract section 9.2), and it is
// deliberately outside the versioned API surface. WorkerHostTests asserts that as a fact about the
// endpoint table rather than as a convention.
//
// THE WORKER CONNECTS AS THE DATABASE OWNER and is exempt from row-level security by design
// (design section 4.3): it writes across tenants and serves no customer-facing route. That is
// safe precisely because it serves no such route, which is the same assertion again.

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

var app = builder.Build();

// /health and /alive, both explicitly anonymous. This host has no FallbackPolicy today; the calls
// are here so that adding one later cannot take the liveness probe down by forgetting to exempt
// it, which is the reason ServiceDefaults marks them rather than each host doing it.
app.MapDefaultEndpoints();

app.Run();
```

- [ ] **Step 6: Create `PeakPower.DevStubs`**

```bash
mkdir -p /Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
  </PropertyGroup>
  <!--
    The PVNed document generator, run from a developer machine against the real webhook.

    S2-D4 IS THE WHOLE OF THIS REFERENCE LIST. The generator emits templated XML TEXT and never
    serialises the parser's own model, so it may not reference PeakPower.Integration.Brp.Pvned -
    nor PeakPower.Ingestion, nor PeakPower.Domain. Otherwise generator and parser share a type,
    and a shared misreading of the PVNed format passes every test in this slice and fails on day
    one of the real integration. [R-01] is scored 20 and this reference list is one of the three
    deliberate breaks in that circle (design section 8).

    PeakPower.Contracts only - it references nothing itself, and the generator needs it for
    nothing more than the scenario keys and the shapes it posts against.

    IT DOES NOT SHIP IN THE COMPOSE FILE (design section 3.1). It is run by hand, authenticating
    with the same BRP_CREDENTIAL_PVNED value the deployed Worker reads.
  -->
  <ItemGroup>
    <ProjectReference Include="../../Core/PeakPower.Contracts/PeakPower.Contracts.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Extensions.Http" />
    <PackageReference Include="Microsoft.Extensions.Hosting" />
  </ItemGroup>
</Project>
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/Program.cs`:

```csharp
// PeakPower.DevStubs - the PVNed document generator (contract section 13). Plan 5 fills it in with
// the fourteen in-scope integration-spec section 11 scenarios, the 90-day backfill and the cadence
// pusher, all behind DevStubsGate's two confirmation phrases.
//
// It exists now, empty, so that the solution layout, the module graph and CI cover it from the
// first commit. It REFUSES rather than succeeding silently: a generator that exits 0 having posted
// nothing is indistinguishable, in a shell script, from one that worked.

Console.Error.WriteLine(
    "PeakPower.DevStubs has no commands yet. The generator, the fourteen integration-spec "
    + "section 11 scenarios, the 90-day backfill and the cadence pusher arrive with plan 5. "
    + "Nothing was posted.");

return 1;
```

- [ ] **Step 7: Add all four to the solution and run the guard**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet sln PeakPower.sln add --solution-folder src/Infrastructure \
  src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj
dotnet sln PeakPower.sln add --solution-folder src/Infrastructure \
  src/Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj
dotnet sln PeakPower.sln add --solution-folder src/Hosts \
  src/Hosts/PeakPower.Worker/PeakPower.Worker.csproj
dotnet sln PeakPower.sln add --solution-folder src/Hosts \
  src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj
dotnet sln PeakPower.sln list | wc -l
tools/verify-solution-layout.sh
```

Expected: `dotnet sln list` prints **24** lines (a two-line header plus twenty-two projects), and
the guard ends `verify-solution-layout: OK`.

⚠ If the build fails with `NU1008: Projects that use central package management should not define
version on the PackageReference items`, a `Version=` attribute crept into one of the four csproj
files. Every version lives in `Directory.Packages.props`; remove the attribute.

- [ ] **Step 8: Verify the guard by mutation — take one project back out**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet sln PeakPower.sln remove src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj
tools/verify-solution-layout.sh
```

Expected: **FAIL** with
`FAIL: not in the solution: src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj` and
`verify-solution-layout: 1 check(s) failed`.

That is the mutation that matters here: the guard reads `dotnet sln list`, not the filesystem, so a
project that exists on disk and is not in the solution — which is exactly what a forgotten
`dotnet sln add` leaves behind, and which nothing else in the repository would notice — has to be
the failure. Put it back:

```bash
dotnet sln PeakPower.sln add --solution-folder src/Hosts \
  src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj
tools/verify-solution-layout.sh
```

Expected: `verify-solution-layout: OK`.

- [ ] **Step 9: Prove the two forbidden references are actually absent**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -n 'ProjectReference' src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj \
  > /tmp/ingestion-refs.txt
grep -n 'ProjectReference' src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj \
  > /tmp/devstubs-refs.txt
cat /tmp/ingestion-refs.txt /tmp/devstubs-refs.txt
```

Expected: `PeakPower.Ingestion.csproj` names exactly `PeakPower.Domain`, `PeakPower.Application`
and `PeakPower.Persistence`, and `PeakPower.DevStubs.csproj` names exactly `PeakPower.Contracts` —
no `Brp`, no `Ingestion`.

⚠ Read the file, not the terminal. A shell hook in this environment rewrites `grep` and can
truncate or invent output; the redirect is what makes the answer readable.

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add PeakPower.sln tools/verify-solution-layout.sh \
        src/Infrastructure/PeakPower.Ingestion \
        src/Infrastructure/PeakPower.Integration.Brp.Pvned \
        src/Hosts/PeakPower.Worker \
        src/Hosts/PeakPower.DevStubs
git commit -m "feat(solution): add the four slice-2 projects and take the layout guard to 22

PeakPower.Ingestion (the BRP-agnostic pipeline, at the exact path CallSiteFacts names),
PeakPower.Integration.Brp.Pvned (the adapter), PeakPower.Worker (the webhook host and job server,
and the only project that sees both) and PeakPower.DevStubs (the generator, which under S2-D4 may
reference neither, so a shared type cannot hide a shared misreading of the PVNed format).

Seventeen source projects, five test projects, no new test project - which is what makes the
verify-solution-layout.sh array twenty-two rather than twenty-four.

Verified by mutation: removing PeakPower.DevStubs from the solution while leaving it on disk -
the shape a forgotten dotnet sln add takes, and one nothing else here would notice - failed the
guard with 'not in the solution'."
```

---

### Task 6: Arm architecture fact 3

`CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter` has skipped since slice 1 with a message
that names the exact `<ProjectReference>` to add
(`tests/PeakPower.Architecture.Tests/CallSiteFacts.cs:34-39`):

```
PeakPower.Ingestion is deferred past slice 1, so its DLL is not in this test project's output.
This fact stays skipped even after the project exists until PeakPower.Architecture.Tests.csproj
gains <ProjectReference Include="../../src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj" />
- add that reference to arm this fact.
```

Adding that line is the whole task — except that it is not, and the reason is the second half of
`AssemblyProbe`. That class checks in **both** directions: every expected assembly must be on disk,
and every `PeakPower.*.dll` on disk must be expected. Its own remarks predicted this exact moment —
"a new production project … lands its DLL in this directory once this test project's .csproj
references it, and every fact built on this probe silently never scans it". So the reference alone
turns three tests red, and each of the three is telling the truth.

Two projects go into the probe, not one. `PeakPower.Integration.Brp.Pvned` is a library in the
module graph and architecture fact 5 has to cover it: plan 4 maps `Pos` to an instant there, which
is precisely the code that must go through `IMarketCalendar` rather than reaching for a clock.
`PeakPower.Worker` and `PeakPower.DevStubs` are **hosts** and stay out, for the same reason
`PeakPower.AppHost` is out — the probe's own comment says the AppHost is excluded because it is
orchestration.

⚠ `AssemblyProbeFacts.ProductionAssemblies_throws_when_an_unlisted_PeakPower_assembly_is_present`
uses the literal string `"PeakPower.Ingestion.dll"` as its *unlisted* assembly
(`AssemblyProbeFacts.cs:62`). Once that name is listed, the test's premise is gone and it fails —
correctly. It needs a name that is genuinely not in the list, and the honest choice is one that
never will be.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Architecture.Tests/PeakPower.Architecture.Tests.csproj:9-20`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Architecture.Tests/AssemblyProbe.cs:22-36`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Architecture.Tests/AssemblyProbeFacts.cs:48-63`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Architecture.Tests/ModuleGraphFacts.cs:19-38`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/skipped-tests.allowlist.txt`

**Interfaces:**
- Consumes: assemblies `PeakPower.Ingestion` and `PeakPower.Integration.Brp.Pvned` (task 5).
- Produces: `Fact_3_ingestion_references_no_Brp_adapter` **runs and passes**, and
  `AssemblyProbe.ProductionAssemblies()` scans fourteen assemblies rather than twelve.

- [ ] **Step 1: Write the failing test — add the reference the skip message names**

Edit
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Architecture.Tests/PeakPower.Architecture.Tests.csproj`.
Replace the header comment and add two lines to the `ItemGroup`, so the whole first `ItemGroup`
reads:

```xml
  <!--
    Every source LIBRARY is referenced so that its DLL lands in this project's output directory,
    where the Mono.Cecil scan in ArchitectureFacts can read it.

    The AppHost, PeakPower.Worker and PeakPower.DevStubs are excluded on purpose: all three are
    orchestration or tooling rather than domain code, and referencing a host from a scanner project
    buys nothing. Every LIBRARY is in, including the two slice-2 ones - architecture fact 5 has to
    cover PeakPower.Integration.Brp.Pvned in particular, because that is where Pos becomes an
    instant and it must do so through IMarketCalendar rather than by reaching for a clock.

    The PeakPower.Ingestion line is what ARMS architecture fact 3: the fact reads that assembly's
    own metadata for a reference to anything called PeakPower.Integration.Brp.*, and it skipped
    from slice 1 until this line existed, naming this line verbatim in its skip message.
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
    <ProjectReference Include="../../src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj" />
    <ProjectReference Include="../../src/Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj" />
    <ProjectReference Include="../../src/Hosts/PeakPower.ServiceDefaults/PeakPower.ServiceDefaults.csproj" />
    <ProjectReference Include="../../src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj" />
    <ProjectReference Include="../../src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj" />
    <ProjectReference Include="../../src/Hosts/PeakPower.Migrator/PeakPower.Migrator.csproj" />
  </ItemGroup>
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Architecture.Tests --nologo`
Expected: FAIL — several tests, all with

```
System.InvalidOperationException : AssemblyProbe found 2 production assemblies in
'.../tests/PeakPower.Architecture.Tests/bin/Debug/net10.0' that ProductionAssemblyFileNames does
not list: PeakPower.Ingestion.dll, PeakPower.Integration.Brp.Pvned.dll. Add it to
ProductionAssemblyFileNames, or it is silently unscanned by every architecture fact built on this
probe.
```

That is `AssemblyProbe` doing exactly what its remarks say it exists to do. Fact 3 itself no longer
skips — it now reads the assembly and passes — but fact 5 and both `ModuleGraphFacts` assembly
checks fail on the probe.

- [ ] **Step 3: List the two new assemblies in the probe**

Edit
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Architecture.Tests/AssemblyProbe.cs`,
lines 22-36, replacing the `ProductionAssemblyFileNames` array with:

```csharp
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
        // Slice 2. Both are LIBRARIES, which is why they are here and PeakPower.Worker and
        // PeakPower.DevStubs are not: this list is what facts 3, 5 and 6 scan, and a host adds
        // orchestration rather than domain code. Fact 5 matters most for the adapter - plan 4
        // turns Pos into an instant there, and that has to go through IMarketCalendar.
        "PeakPower.Ingestion.dll",
        "PeakPower.Integration.Brp.Pvned.dll",
        "PeakPower.ServiceDefaults.dll",
        "PeakPower.Api.Customer.dll",
        "PeakPower.Api.Employee.dll",
        "PeakPower.Migrator.dll",
    ];
```

- [ ] **Step 4: Repair the duplicated list in `AssemblyProbeFacts`**

`AssemblyProbeFacts.ProductionAssemblies_throws_when_an_unlisted_PeakPower_assembly_is_present`
duplicates the probe's list on purpose — "so this test proves the probe's own hard-coded list is
complete, not just internally consistent with itself" — and it uses `PeakPower.Ingestion.dll` as
its *unlisted* extra. Both halves have to move.

Edit
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Architecture.Tests/AssemblyProbeFacts.cs`,
lines 48-63, replacing the `knownAssemblies` array and the `unlistedAssembly` constant with:

```csharp
        string[] knownAssemblies =
        [
            "PeakPower.Domain.dll",
            "PeakPower.Application.dll",
            "PeakPower.Contracts.dll",
            "PeakPower.Persistence.dll",
            "PeakPower.Infrastructure.Time.dll",
            "PeakPower.Infrastructure.Web.dll",
            "PeakPower.Infrastructure.Identity.dll",
            "PeakPower.Infrastructure.Email.dll",
            "PeakPower.Ingestion.dll",
            "PeakPower.Integration.Brp.Pvned.dll",
            "PeakPower.ServiceDefaults.dll",
            "PeakPower.Api.Customer.dll",
            "PeakPower.Api.Employee.dll",
            "PeakPower.Migrator.dll",
        ];

        // A name no project will ever carry, rather than the name of the next real project.
        // This used to be "PeakPower.Ingestion.dll", which was right while that project was
        // hypothetical and became a false premise the moment slice 2 created it - the test then
        // failed because the "unlisted" assembly was listed, which says nothing about the probe.
        // A deliberately impossible name cannot go stale the same way.
        const string unlistedAssembly = "PeakPower.NotAProject.dll";
```

- [ ] **Step 5: Teach `ModuleGraphFacts` the new project prefixes**

`ModuleGraphFacts` asserts fact 1 and fact 2 with `HaveDependencyOnAny(<prefixes>)`. Neither array
names the slice-2 projects, so a `PeakPower.Domain` that grew a dependency on
`PeakPower.Ingestion` would pass fact 1 — and `PeakPower.Infrastructure` does **not** match
`PeakPower.Ingestion`, which is close enough to be worth stating.

Edit
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Architecture.Tests/ModuleGraphFacts.cs`,
lines 19-38, replacing both arrays with:

```csharp
    // Every namespace root outside the domain. "PeakPower.Infrastructure" does NOT cover
    // "PeakPower.Ingestion" - the prefixes diverge at the fourth character - so the slice-2
    // projects are named in full. Without these lines a Domain that grew a dependency on the
    // ingestion pipeline would pass fact 1.
    private static readonly string[] EverythingOutsideTheDomain =
    [
        "PeakPower.Application",
        "PeakPower.Contracts",
        "PeakPower.Persistence",
        "PeakPower.Infrastructure",
        "PeakPower.Ingestion",
        "PeakPower.Integration",
        "PeakPower.ServiceDefaults",
        "PeakPower.Api",
        "PeakPower.Migrator",
        "PeakPower.Worker",
        "PeakPower.DevStubs",
        "PeakPower.AppHost",
    ];

    private static readonly string[] EverythingOutsideTheApplicationAndDomain =
    [
        "PeakPower.Contracts",
        "PeakPower.Persistence",
        "PeakPower.Infrastructure",
        "PeakPower.Ingestion",
        "PeakPower.Integration",
        "PeakPower.ServiceDefaults",
        "PeakPower.Api",
        "PeakPower.Migrator",
        "PeakPower.Worker",
        "PeakPower.DevStubs",
        "PeakPower.AppHost",
    ];
```

- [ ] **Step 6: Run the suite and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Architecture.Tests --nologo`
Expected: PASS — **zero skipped**, and `Fact_3_ingestion_references_no_Brp_adapter` among the
passing tests. Confirm the skip is gone rather than assuming it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Architecture.Tests --nologo | grep -i "skip" > /tmp/arch-skips.txt
wc -l /tmp/arch-skips.txt
```

Expected: `/tmp/arch-skips.txt` is empty (0 lines).

- [ ] **Step 7: Verify fact 3 by mutation — reference the adapter and watch it go red**

This is design §7.22's required verification, and it has one subtlety that decides whether it
proves anything. **The C# compiler elides an assembly reference nothing in the IL uses** — that is
the exact reason `tools/verify-solution-layout.sh` greps for `<ProjectReference` as well as testing
by reflection, and its own comment says so. A bare `<ProjectReference>` with no code behind it
would therefore leave fact 3 green and certify nothing.

So the mutation is two edits, and the second is the one that makes it real.

First, add to
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj`,
inside the first `ItemGroup`:

```xml
    <ProjectReference Include="../PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj" />
```

Then make one type in `PeakPower.Ingestion` actually name a type from it. Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/MutationProof.cs`:

```csharp
namespace PeakPower.Ingestion;

// TEMPORARY. Deleted in the next step. A ProjectReference alone is not enough: the compiler drops
// an assembly reference nothing uses, so fact 3 would stay green against a csproj that names the
// adapter. Naming the type is what puts the reference in the IL metadata the fact reads.
internal static class MutationProof
{
    public static Type TheAdapterAssembly => typeof(PeakPower.Integration.Brp.Pvned.AssemblyMarker);
}
```

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Architecture.Tests --nologo --filter "FullyQualifiedName~Fact_3"`

Expected: **FAIL** with

```
Fact_3_ingestion_references_no_Brp_adapter [FAIL]
  brpReferences should be empty but had 1 item
  PeakPower.Ingestion must talk to BRP adapters through a port, never by referencing one
```

⚠ If it passes, the reference was elided — check that `MutationProof.cs` was actually compiled
(`dotnet build src/Infrastructure/PeakPower.Ingestion --nologo` and look for it in the output) and
that you did not put the type reference inside a comment. A mutation that does not reproduce the
defect proves nothing, and this particular one is the standing example in this repository of a
mutation that can quietly fail to bite.

Now restore both halves:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
rm src/Infrastructure/PeakPower.Ingestion/MutationProof.cs
git checkout -- src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj
dotnet test tests/PeakPower.Architecture.Tests --nologo --filter "FullyQualifiedName~Fact_3"
```

Expected: PASS — 1 passed, 0 failed, 0 skipped.

- [ ] **Step 8: Empty the allow-list**

Task 1 put one temporary line in `tests/skipped-tests.allowlist.txt`. Delete it — the fact now runs.

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/skipped-tests.allowlist.txt` and remove
these three lines:

```
# TEMPORARY, and removed by plan 1 task 6. The fact skips because PeakPower.Ingestion does not
# exist yet; its own skip message names the <ProjectReference> that arms it. This line is here so
# the guard can be committed and run before the project exists, and task 6 deletes it.
PeakPower.Architecture.Tests.CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter
```

leaving the file with its explanatory header and **no test names at all**.

- [ ] **Step 9: Run the whole guard and watch it pass with an empty allow-list**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && tools/verify-no-unexpected-skips.sh`
Expected: PASS — `verify-no-unexpected-skips: OK`. Nothing in the solution skips, and the
allow-list names nothing, so both directions of the comparison agree on the empty set.

This is the strongest state the guard can be in, and it is worth noticing that it is reachable: the
design's "the set of skipped test names equals a checked-in allow-list" turns out to be "nothing
skips".

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Architecture.Tests tests/skipped-tests.allowlist.txt
git commit -m "test(architecture): arm fact 3, and scan the two new libraries

PeakPower.Architecture.Tests.csproj gains the ProjectReference CallSiteFacts' skip message has
named verbatim since slice 1, so Fact_3_ingestion_references_no_Brp_adapter runs instead of
skipping - and gains PeakPower.Integration.Brp.Pvned too, because fact 5 has to cover the assembly
where plan 4 turns Pos into an instant.

AssemblyProbe's two-directional check is what forced the rest: its own remarks predicted that a new
production project would land its DLL here and be silently unscanned, so ProductionAssemblyFileNames
grows by two, AssemblyProbeFacts' duplicated list grows with it, and that test's 'unlisted'
assembly stops being PeakPower.Ingestion.dll - which had become a false premise the moment the
project existed - and becomes a name no project will ever carry.

ModuleGraphFacts' two prefix arrays gain the slice-2 names. PeakPower.Infrastructure does not cover
PeakPower.Ingestion; the prefixes diverge at the fourth character.

Verified by mutation: adding the adapter as a ProjectReference AND naming its AssemblyMarker from
PeakPower.Ingestion - a bare reference is elided by the compiler and would have left the fact green
- turned fact 3 red with 'PeakPower.Ingestion must talk to BRP adapters through a port, never by
referencing one'.

tests/skipped-tests.allowlist.txt now names nothing: with the fact armed, no test in this solution
skips at all."
```

---

### Task 7: `WorkingDayCalendar` — the `[DEC-14]` rule and exclusion list, as data

**S2-D8**, answered 2026-09-07: the platform's working-day calendar is **Monday–Friday with an
empty exclusion list**, and `AddWorkingDays` counts weekdays and ignores public holidays. The
decision's last sentence is the one that shapes this task: *"Because the list is data, populating
it later is a row, not a release."*

`[DEC-14]` describes the mechanism this reuses — "a named calendar per commodity and year, with the
working-day rule and the holiday list **as data**", and it records the list as currently empty.
There is no table to read it from: design §3.2 defers the `market.calendar_interval` spine and
`market.peak_calendar_version` to Phase 2, and plan 2 owns every line of migration SQL in this
slice. So the data lives in configuration — two settings, bound once at the composition root — and
the swap to a real reference table later replaces one class rather than every call site.

⚠ **What makes ignoring holidays safe is `[DEC-98]`.** Before it, `FINAL` meant final, so
finalising early across Christmas or King's Day would have shut a correction window that should
have stayed open. After it, `FINAL` is a *status*, a post-window version is routine, and a late
reconciliation reopens the date to `PROVISIONAL` and re-finalises. The risk that would have argued
for a holiday list has already been defused by a decision taken for other reasons — which is why
the empty list is a decision rather than an omission, and why this type carries the argument in its
own remarks.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/WorkingDayCalendar.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/WorkingDayCalendarOptions.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Time/WorkingDayCalendarTests.cs`

**Interfaces:**
- Consumes: nothing.
- Produces, in `PeakPower.Infrastructure.Time`:
  - `sealed class WorkingDayCalendar` with
    `WorkingDayCalendar(IEnumerable<DayOfWeek> workingDays, IEnumerable<DateOnly> excludedDates)`,
    `IReadOnlySet<DayOfWeek> WorkingDays { get; }`, `IReadOnlySet<DateOnly> ExcludedDates { get; }`,
    `bool IsWorkingDay(DateOnly date)`,
    `static readonly WorkingDayCalendar MondayToFriday`, and
    `static WorkingDayCalendar From(WorkingDayCalendarOptions options)`
  - `sealed class WorkingDayCalendarOptions` with `const string SectionName = "MarketCalendar"`,
    `string WorkingDays { get; set; }` and `string ExcludedDates { get; set; }`

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Time/WorkingDayCalendarTests.cs`:

```csharp
using Shouldly;
using PeakPower.Infrastructure.Time;
using Xunit;

namespace PeakPower.Application.Tests.Time;

/// <summary>
/// S2-D8 and [DEC-14]: the weekday rule and the exclusion list are DATA, so populating the list
/// later is a configuration row rather than a release. These tests are about the mechanism, not
/// about the current answer - the current answer is Monday-Friday with nothing excluded, and
/// AddWorkingDaysTests is where that is asserted end to end.
/// </summary>
public sealed class WorkingDayCalendarTests
{
    [Fact]
    public void The_default_calendar_is_Monday_to_Friday_with_nothing_excluded()
    {
        var calendar = WorkingDayCalendar.MondayToFriday;

        calendar.WorkingDays.ShouldBe(
            [DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday,
             DayOfWeek.Friday],
            ignoreOrder: true);

        calendar.ExcludedDates.ShouldBeEmpty(
            "[DEC-14] records the exclusion list as currently EMPTY, and S2-D8 depends on that: "
            + "a holiday falling on a weekday is a working day");
    }

    [Theory]
    // 2026-08-17 is a Monday, 2026-08-21 a Friday, 2026-08-22 a Saturday, 2026-08-23 a Sunday.
    [InlineData("2026-08-17", true)]
    [InlineData("2026-08-21", true)]
    [InlineData("2026-08-22", false)]
    [InlineData("2026-08-23", false)]
    // Christmas Day 2026 is a FRIDAY, and it is a working day. This is S2-D8 stated as an example
    // rather than as a rule, because it is the case a reader will not believe.
    [InlineData("2026-12-25", true)]
    // King's Day 2027 is a TUESDAY, and it is a working day.
    [InlineData("2027-04-27", true)]
    public void The_default_calendar_counts_weekdays_and_ignores_public_holidays(
        string date, bool expected) =>
        WorkingDayCalendar.MondayToFriday
            .IsWorkingDay(DateOnly.Parse(date, System.Globalization.CultureInfo.InvariantCulture))
            .ShouldBe(expected);

    [Fact]
    public void An_excluded_date_stops_being_a_working_day_without_a_code_change()
    {
        // The whole point of [DEC-14]'s "as data": this is the shape a populated holiday list
        // takes, and nothing in the calendar's own code changed to reach it.
        var withChristmas = new WorkingDayCalendar(
            [DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday,
             DayOfWeek.Friday],
            [new DateOnly(2026, 12, 25)]);

        withChristmas.IsWorkingDay(new DateOnly(2026, 12, 25)).ShouldBeFalse();
        withChristmas.IsWorkingDay(new DateOnly(2026, 12, 24)).ShouldBeTrue(
            "excluding one date must not exclude its neighbours");
    }

    [Fact]
    public void A_six_day_week_is_expressible_without_a_code_change_either()
    {
        var sixDayWeek = new WorkingDayCalendar(
            [DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday,
             DayOfWeek.Friday, DayOfWeek.Saturday],
            []);

        sixDayWeek.IsWorkingDay(new DateOnly(2026, 8, 22)).ShouldBeTrue("2026-08-22 is a Saturday");
        sixDayWeek.IsWorkingDay(new DateOnly(2026, 8, 23)).ShouldBeFalse("2026-08-23 is a Sunday");
    }

    [Fact]
    public void A_calendar_with_no_working_days_at_all_is_refused()
    {
        // Not defensive programming: AddWorkingDays walks forward until it has counted enough
        // working days, so an empty set is an infinite loop rather than a wrong answer. Refusing
        // it where the data is READ is what turns a hang into a startup failure naming the setting.
        var refusal = Should.Throw<ArgumentException>(
            () => new WorkingDayCalendar([], []));

        refusal.Message.ShouldContain(
            "at least one working day", Case.Sensitive);
    }

    [Fact]
    public void The_options_bind_to_a_calendar()
    {
        var calendar = WorkingDayCalendar.From(new WorkingDayCalendarOptions
        {
            WorkingDays = "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday",
            ExcludedDates = "2026-12-25,2027-01-01",
        });

        calendar.IsWorkingDay(new DateOnly(2026, 8, 22)).ShouldBeTrue("Saturday was configured in");
        calendar.IsWorkingDay(new DateOnly(2026, 12, 25)).ShouldBeFalse();
        calendar.IsWorkingDay(new DateOnly(2027, 1, 1)).ShouldBeFalse();
        calendar.IsWorkingDay(new DateOnly(2027, 4, 27)).ShouldBeTrue(
            "King's Day was not in the configured list, so it stays a working day");
    }

    [Fact]
    public void The_options_default_to_S2_D8s_answer()
    {
        // A host that configures nothing gets Monday-Friday and an empty exclusion list, which is
        // what S2-D8 decided. The defaults live on the options object rather than in the binder,
        // so an operator reading the class sees the answer.
        var calendar = WorkingDayCalendar.From(new WorkingDayCalendarOptions());

        calendar.WorkingDays.ShouldBe(WorkingDayCalendar.MondayToFriday.WorkingDays, ignoreOrder: true);
        calendar.ExcludedDates.ShouldBeEmpty();
    }

    [Fact]
    public void An_unreadable_day_name_is_refused_by_name()
    {
        var refusal = Should.Throw<ArgumentException>(
            () => WorkingDayCalendar.From(new WorkingDayCalendarOptions
            {
                WorkingDays = "Monday,Funday",
            }));

        refusal.Message.ShouldContain("Funday", Case.Sensitive);
        refusal.Message.ShouldContain(WorkingDayCalendarOptions.SectionName, Case.Sensitive);
    }

    [Fact]
    public void An_unreadable_excluded_date_is_refused_by_name()
    {
        var refusal = Should.Throw<ArgumentException>(
            () => WorkingDayCalendar.From(new WorkingDayCalendarOptions
            {
                ExcludedDates = "2026-12-25,25-12-2026",
            }));

        refusal.Message.ShouldContain("25-12-2026", Case.Sensitive);
        refusal.Message.ShouldContain("yyyy-MM-dd", Case.Sensitive);
    }

    [Fact]
    public void Whitespace_and_empty_entries_are_tolerated_because_an_env_var_carries_them()
    {
        // MarketCalendar__ExcludedDates="2026-12-25, 2027-01-01," is what a shell export actually
        // looks like after somebody edits it twice. Refusing that would make the mechanism
        // technically data-driven and practically unusable.
        var calendar = WorkingDayCalendar.From(new WorkingDayCalendarOptions
        {
            WorkingDays = " Monday , Tuesday ,,Wednesday,Thursday,Friday ",
            ExcludedDates = "2026-12-25, 2027-01-01,",
        });

        calendar.WorkingDays.Count.ShouldBe(5);
        calendar.ExcludedDates.Count.ShouldBe(2);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Application.Tests --nologo`
Expected: FAIL with
`error CS0246: The type or namespace name 'WorkingDayCalendar' could not be found (are you missing a using directive or an assembly reference?)`

- [ ] **Step 3: Write `WorkingDayCalendarOptions`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/WorkingDayCalendarOptions.cs`:

```csharp
namespace PeakPower.Infrastructure.Time;

/// <summary>
/// The <c>[DEC-14]</c> calendar's working-day half, as configuration.
/// </summary>
/// <remarks>
/// <para>
/// <b>S2-D8</b> settles the answer — Monday–Friday, exclusion list empty, public holidays ignored —
/// and <c>[DEC-14]</c> settles the shape: "a named calendar … with the working-day rule and the
/// holiday list <i>as data</i>", so that "populating the list later is a row, not a release".
/// There is no reference table to read it from yet: design §3.2 defers the
/// <c>market.calendar_interval</c> spine and <c>market.peak_calendar_version</c> to Phase 2. So the
/// data is here, bound once at the composition root, and the later swap to a real table replaces
/// <see cref="WorkingDayCalendar.From"/> rather than every call site.
/// </para>
/// <para>
/// <b>Comma-separated strings rather than arrays</b>, because the transport is an environment
/// variable. <c>MarketCalendar__ExcludedDates=2026-12-25,2027-01-01</c> is a line an operator can
/// write; <c>MarketCalendar__ExcludedDates__0</c>, <c>__1</c>, <c>__2</c> is the same list with a
/// way to get the indices wrong.
/// </para>
/// <para>
/// <b>The defaults are here rather than in the binder</b>, so a reader of this class sees the
/// answer S2-D8 gave without having to find the registration.
/// </para>
/// </remarks>
public sealed class WorkingDayCalendarOptions
{
    /// <summary>
    /// The configuration section, bound in
    /// <c>TimeServiceCollectionExtensions.AddMarketCalendar</c>. Environment-variable spelling:
    /// <c>MarketCalendar__WorkingDays</c> and <c>MarketCalendar__ExcludedDates</c>.
    /// </summary>
    public const string SectionName = "MarketCalendar";

    /// <summary>
    /// Comma-separated English day names. <b>S2-D8: Monday–Friday.</b>
    /// </summary>
    public string WorkingDays { get; set; } = "Monday,Tuesday,Wednesday,Thursday,Friday";

    /// <summary>
    /// Comma-separated ISO dates (<c>yyyy-MM-dd</c>) that are not working days even when they fall
    /// on one of <see cref="WorkingDays"/>.
    /// </summary>
    /// <remarks>
    /// <b>Empty, and that is S2-D8's answer rather than an oversight.</b> `[DEC-19]` settled the
    /// <i>peak</i> calendar as Monday–Friday with holidays included as peak days, and `[DEC-14]`
    /// records this list as currently empty. What makes ignoring holidays safe for the
    /// 10-working-day <c>FINAL</c> rule is `[DEC-98]`: <c>FINAL</c> is a status, a post-window
    /// version is routine, and a late reconciliation reopens the date to <c>PROVISIONAL</c> and
    /// re-finalises — so finalising across Christmas shuts no window.
    /// </remarks>
    public string ExcludedDates { get; set; } = string.Empty;
}
```

- [ ] **Step 4: Write `WorkingDayCalendar`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/WorkingDayCalendar.cs`:

```csharp
using System.Globalization;

namespace PeakPower.Infrastructure.Time;

/// <summary>
/// Which days count as working days. <c>[DEC-14]</c>'s mechanism, carrying <b>S2-D8</b>'s answer.
/// </summary>
/// <remarks>
/// Immutable and built once at start-up. <see cref="MarketCalendar.AddWorkingDays"/> reads it and
/// nothing else does; a second copy of "Monday to Friday" anywhere in the solution is a second
/// answer to a question `[F02-R23]` asks with the definite article.
/// </remarks>
public sealed class WorkingDayCalendar
{
    /// <summary>
    /// <b>S2-D8.</b> Monday–Friday, nothing excluded — so a public holiday falling on a weekday is
    /// a working day.
    /// </summary>
    public static readonly WorkingDayCalendar MondayToFriday = new(
        [
            DayOfWeek.Monday,
            DayOfWeek.Tuesday,
            DayOfWeek.Wednesday,
            DayOfWeek.Thursday,
            DayOfWeek.Friday,
        ],
        []);

    /// <exception cref="ArgumentException">
    /// When <paramref name="workingDays"/> is empty. Not defensiveness for its own sake:
    /// <c>AddWorkingDays</c> walks forward until it has counted enough working days, so an empty
    /// set is a hang rather than a wrong answer, and a hang at start-up with no message is the one
    /// failure an operator cannot act on.
    /// </exception>
    public WorkingDayCalendar(
        IEnumerable<DayOfWeek> workingDays, IEnumerable<DateOnly> excludedDates)
    {
        ArgumentNullException.ThrowIfNull(workingDays);
        ArgumentNullException.ThrowIfNull(excludedDates);

        var days = new HashSet<DayOfWeek>(workingDays);
        if (days.Count == 0)
        {
            throw new ArgumentException(
                "A working-day calendar needs at least one working day. AddWorkingDays counts "
                + "forward until it has seen enough of them, so an empty set never terminates.",
                nameof(workingDays));
        }

        WorkingDays = days;
        ExcludedDates = new HashSet<DateOnly>(excludedDates);
    }

    /// <summary>The days of the week that count. S2-D8: Monday–Friday.</summary>
    public IReadOnlySet<DayOfWeek> WorkingDays { get; }

    /// <summary>
    /// Dates that do not count even when they fall on a <see cref="WorkingDays"/> day.
    /// <c>[DEC-14]</c> records this list as currently <b>empty</b>.
    /// </summary>
    public IReadOnlySet<DateOnly> ExcludedDates { get; }

    /// <summary>True when <paramref name="date"/> counts towards a working-day span.</summary>
    public bool IsWorkingDay(DateOnly date) =>
        WorkingDays.Contains(date.DayOfWeek) && !ExcludedDates.Contains(date);

    /// <summary>
    /// Reads a calendar out of configuration, refusing an unreadable value <b>by name</b>.
    /// </summary>
    /// <remarks>
    /// A misspelled day or a European-order date is a configuration mistake somebody made in a
    /// shell, and the only place it can be reported usefully is here, while the string that caused
    /// it is still in hand. Falling back to the default instead would leave a deployment quietly
    /// counting the wrong days, and the symptom - a day finalising a working day early - is one
    /// nobody would trace back to a `.env` line.
    /// </remarks>
    public static WorkingDayCalendar From(WorkingDayCalendarOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var days = new List<DayOfWeek>();
        foreach (var entry in Split(options.WorkingDays))
        {
            if (!Enum.TryParse<DayOfWeek>(entry, ignoreCase: true, out var day))
            {
                throw new ArgumentException(
                    $"'{entry}' is not a day of the week. {WorkingDayCalendarOptions.SectionName}"
                    + ":WorkingDays takes comma-separated English day names, for example "
                    + "Monday,Tuesday,Wednesday,Thursday,Friday.",
                    nameof(options));
            }

            days.Add(day);
        }

        var excluded = new List<DateOnly>();
        foreach (var entry in Split(options.ExcludedDates))
        {
            if (!DateOnly.TryParseExact(
                    entry, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None,
                    out var date))
            {
                throw new ArgumentException(
                    $"'{entry}' is not a date. {WorkingDayCalendarOptions.SectionName}"
                    + ":ExcludedDates takes comma-separated ISO dates in yyyy-MM-dd form, for "
                    + "example 2026-12-25,2027-01-01.",
                    nameof(options));
            }

            excluded.Add(date);
        }

        return new WorkingDayCalendar(days, excluded);
    }

    /// <summary>
    /// Splits on commas, trims, and drops empties — because
    /// <c>MarketCalendar__ExcludedDates="2026-12-25, 2027-01-01,"</c> is what a line looks like
    /// after somebody has edited it twice, and refusing that would make a data-driven mechanism
    /// unusable in the one place the data actually lives.
    /// </summary>
    private static IEnumerable<string> Split(string? value) =>
        (value ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~WorkingDayCalendarTests"`
Expected: PASS — 13 passed, 0 failed (nine test methods, four of them theory cases on
`The_default_calendar_counts_weekdays_and_ignores_public_holidays` plus two more).

- [ ] **Step 6: Verify the exclusion mechanism by mutation**

The assertion that matters most here is not "Monday is a working day" — it is that the exclusion
list is *read* rather than decorative, because that is the half S2-D8 says makes a later holiday
list a row rather than a release.

Mutate `IsWorkingDay` to ignore the list:

```csharp
    public bool IsWorkingDay(DateOnly date) =>
        WorkingDays.Contains(date.DayOfWeek);
```

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~WorkingDayCalendarTests"`

Expected: **FAIL** — two tests, and the first message is

```
An_excluded_date_stops_being_a_working_day_without_a_code_change [FAIL]
  withChristmas.IsWorkingDay(new DateOnly(2026, 12, 25)) should be False but was True
```

and

```
The_options_bind_to_a_calendar [FAIL]
  calendar.IsWorkingDay(new DateOnly(2026, 12, 25)) should be False but was True
```

Note what did **not** go red: every assertion about the *current* answer stayed green, because the
current exclusion list is empty. That is exactly why the mutation had to be aimed at a populated
list — mutating the case the assertion is actually for, not the easy neighbouring one.

Restore the line and re-run; expected PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Infrastructure.Time/WorkingDayCalendar.cs \
        src/Infrastructure/PeakPower.Infrastructure.Time/WorkingDayCalendarOptions.cs \
        tests/PeakPower.Application.Tests/Time/WorkingDayCalendarTests.cs
git commit -m "feat(time): the [DEC-14] working-day calendar, as data

S2-D8 answers [F02-R23]'s previously undefined 'platform's working-day calendar': Monday-Friday,
exclusion list empty, public holidays ignored. [DEC-14] settles the shape - the rule and the list
are DATA so populating the list later is a row rather than a release - and there is no reference
table to hold it yet (design section 3.2 defers the calendar spine), so the data is a bound
configuration section and the later swap replaces WorkingDayCalendar.From alone.

An unreadable day name or date is refused by name at start-up rather than falling back to the
default: the symptom of counting the wrong days is a date finalising one working day early, which
nobody would trace back to a .env line.

Verified by mutation: making IsWorkingDay ignore ExcludedDates left every assertion about the
CURRENT answer green - the list is empty - and turned red only the two tests that populate it,
which is why those two exist."
```

---

### Task 8: `ExpectedIntervalCount` — 92, 96 or 100, derived rather than tabulated

The first of the four `IMarketCalendar` members. Integration-spec §8.2 rule 7 rejects a document
whose point count does not equal the expected interval count for its date (`INCOMPLETE_PERIOD`),
`metering_point_day_state.expected_interval_count` carries it as a `smallint CHECK IN (92,96,100)`,
and design §7.10 requires that **a 96-point document be rejected for both a 92-point and a
100-point date** — short for one, over-length for the other.

**Derived, not looked up.** The count is the number of quarter-hours between the start of the
Amsterdam day and the start of the next one, which is 92 on the spring-forward Sunday, 100 on the
autumn fall-back Sunday and 96 otherwise — for every year, without a table anybody has to extend.
A lookup table of transition dates is the same answer with an expiry date on it.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Time/CalendarUnderTest.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Time/ExpectedIntervalCountTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Application.Abstractions.IMarketCalendar` (slice 1);
  `PeakPower.Infrastructure.Time.MarketCalendar.AmsterdamTimeZone` (slice 1,
  `MarketCalendar.cs:25-26`).
- Produces: `int IMarketCalendar.ExpectedIntervalCount(DateOnly date)` returning 92, 96 or 100;
  the private helper `MarketCalendar.StartOfDayUtc(DateOnly)` that tasks 9 and 10 build on; and
  `PeakPower.Application.Tests.Time.CalendarUnderTest.Amsterdam()`, the one place tasks 8, 9 and 10
  construct a calendar — so task 11's constructor change is one line rather than three files.

- [ ] **Step 1: Write the shared construction helper**

⚠ Tasks 8, 9 and 10 all need a `MarketCalendar`, and **task 11 adds a second constructor
parameter to it**. One helper means that change touches one line here instead of every test in
three files. It is not there to hide the constructor; it is there so the constructor can grow
without a three-file rewrite in the middle of a plan.

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Time/CalendarUnderTest.cs`:

```csharp
using Microsoft.Extensions.Time.Testing;
using PeakPower.Infrastructure.Time;

namespace PeakPower.Application.Tests.Time;

/// <summary>
/// The one place the slice-2 calendar suites construct a <see cref="MarketCalendar"/>.
/// </summary>
/// <remarks>
/// <para>
/// Every member under test here — <c>ExpectedIntervalCount</c>, <c>IntervalStart</c>,
/// <c>IsDstDuplicate</c>, <c>AddWorkingDays</c> — is a pure function of its arguments and of
/// Europe/Amsterdam. None of them reads the clock, so the instant below is arbitrary and is fixed
/// only so that nothing in these suites can accidentally depend on the day they are run.
/// </para>
/// <para>
/// A FIXED instant rather than <c>TimeProvider.System</c>, for exactly that reason: a suite that
/// passes the real clock would still pass today, and would be the kind of test that fails once a
/// year for reasons nobody can reproduce.
/// </para>
/// </remarks>
internal static class CalendarUnderTest
{
    public static MarketCalendar Amsterdam() =>
        new(new FakeTimeProvider(new DateTimeOffset(2026, 8, 12, 9, 0, 0, TimeSpan.Zero)));
}
```

- [ ] **Step 2: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Time/ExpectedIntervalCountTests.cs`:

```csharp
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Time;

/// <summary>
/// 92 on the spring-forward Sunday, 100 on the autumn fall-back Sunday, 96 on every other day.
/// </summary>
/// <remarks>
/// <para>
/// <b>Three years, six transitions, and the dates are hand-checked rather than computed here.</b>
/// A test that derives the last Sunday in March the same way the implementation does agrees with
/// the implementation by construction and proves nothing. These are the real EU transition dates:
/// 2025-03-30 / 2025-10-26, 2026-03-29 / 2026-10-25, 2027-03-28 / 2027-10-31.
/// </para>
/// <para>
/// <b>Design §7.10 turns this into a rejection rule.</b> A 96-point document must be refused for
/// both a 92-point and a 100-point date - short for the autumn date, over-length for the spring
/// one - under integration-spec §8.2 rule 7, INCOMPLETE_PERIOD. That rule reads its expectation
/// from here, so a wrong count here is a wrong invoice rather than a wrong chart.
/// </para>
/// </remarks>
public sealed class ExpectedIntervalCountTests
{
    [Theory]
    [InlineData("2025-03-30")]
    [InlineData("2026-03-29")]
    [InlineData("2027-03-28")]
    public void A_spring_forward_Sunday_has_ninety_two_intervals(string date) =>
        CalendarUnderTest.Amsterdam().ExpectedIntervalCount(
                DateOnly.Parse(date, System.Globalization.CultureInfo.InvariantCulture))
            .ShouldBe(92, $"{date} is 23 hours long in Europe/Amsterdam");

    [Theory]
    [InlineData("2025-10-26")]
    [InlineData("2026-10-25")]
    [InlineData("2027-10-31")]
    public void An_autumn_fall_back_Sunday_has_one_hundred_intervals(string date) =>
        CalendarUnderTest.Amsterdam().ExpectedIntervalCount(
                DateOnly.Parse(date, System.Globalization.CultureInfo.InvariantCulture))
            .ShouldBe(100, $"{date} is 25 hours long in Europe/Amsterdam");

    [Theory]
    // The day before and the day after each 2026 transition, so an off-by-one in the transition
    // detection cannot hide behind "the transition day itself is right".
    [InlineData("2026-03-28")]
    [InlineData("2026-03-30")]
    [InlineData("2026-10-24")]
    [InlineData("2026-10-26")]
    // An ordinary summer day, an ordinary winter day, and both ends of a year.
    [InlineData("2026-08-12")]
    [InlineData("2026-01-15")]
    [InlineData("2026-01-01")]
    [InlineData("2026-12-31")]
    // A leap day, because February is where a date library is most likely to be asked something
    // it has not been asked before.
    [InlineData("2028-02-29")]
    public void Every_other_day_has_ninety_six(string date) =>
        CalendarUnderTest.Amsterdam().ExpectedIntervalCount(
                DateOnly.Parse(date, System.Globalization.CultureInfo.InvariantCulture))
            .ShouldBe(96);

    [Fact]
    public void A_whole_year_holds_exactly_one_short_day_and_one_long_one()
    {
        // The set-level assertion, which is the one a per-date theory cannot make: across 2026
        // there is EXACTLY one 92 and EXACTLY one 100. A transition detected on the wrong day
        // would still satisfy every theory case above if the wrong day happened not to be listed.
        var counts = Enumerable.Range(0, 365)
            .Select(offset => new DateOnly(2026, 1, 1).AddDays(offset))
            .Select(date => (Date: date, Count: CalendarUnderTest.Amsterdam().ExpectedIntervalCount(date)))
            .ToArray();

        counts.Where(entry => entry.Count == 92).Select(entry => entry.Date)
            .ShouldBe([new DateOnly(2026, 3, 29)]);

        counts.Where(entry => entry.Count == 100).Select(entry => entry.Date)
            .ShouldBe([new DateOnly(2026, 10, 25)]);

        counts.Count(entry => entry.Count == 96).ShouldBe(363);
    }
}
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Application.Tests --nologo`
Expected: FAIL with
`error CS1061: 'MarketCalendar' does not contain a definition for 'ExpectedIntervalCount' and no accessible extension method 'ExpectedIntervalCount' accepting a first argument of type 'MarketCalendar' could be found`

- [ ] **Step 4: Add the member to the port**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs`,
adding to the interface body after `TodayInAmsterdam`:

```csharp
    // ── slice 2 ─────────────────────────────────────────────────────────────

    /// <summary>
    /// How many quarter-hourly intervals a delivery date has in Europe/Amsterdam: <b>92</b> on the
    /// spring-forward Sunday, <b>100</b> on the autumn fall-back Sunday, <b>96</b> otherwise.
    /// </summary>
    /// <remarks>
    /// Integration-spec §8.2 rule 7 rejects a document whose point count is not this number
    /// (<c>INCOMPLETE_PERIOD</c>), and <c>metering_point_day_state.expected_interval_count</c>
    /// stores it. Design §7.10: a 96-point document is rejected for BOTH a 92-point and a
    /// 100-point date — short for one, over-length for the other.
    /// </remarks>
    int ExpectedIntervalCount(DateOnly date);
```

- [ ] **Step 5: Implement it**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs`,
adding after the `TodayInAmsterdam` property:

```csharp
    /// <inheritdoc />
    /// <remarks>
    /// <para>
    /// <b>Derived, not tabulated.</b> The answer is the number of quarter-hours between the start
    /// of this Amsterdam day and the start of the next one — 23 hours on the spring-forward
    /// Sunday, 25 on the autumn fall-back Sunday, 24 the rest of the time. A list of transition
    /// dates would give the same answers with an expiry date on it, and the transition rule is
    /// something ICU already knows.
    /// </para>
    /// </remarks>
    public int ExpectedIntervalCount(DateOnly date)
    {
        var thisDay = StartOfDayUtc(date);
        var nextDay = StartOfDayUtc(date.AddDays(1));

        return (int)((nextDay - thisDay).TotalMinutes / IntervalMinutes);
    }

    /// <summary>A quarter of an hour. The Dutch metering resolution, <c>PT15M</c>.</summary>
    private const int IntervalMinutes = 15;

    /// <summary>
    /// The instant at which an Amsterdam calendar day begins.
    /// </summary>
    /// <remarks>
    /// Midnight is never ambiguous and never skipped in Europe/Amsterdam — both transitions happen
    /// in the small hours, at 02:00 and 03:00 local — so <c>GetUtcOffset</c> has exactly one right
    /// answer here and this is safe in a way that the same call on 02:30 is not. Everything else
    /// in this class measures from this instant, which is why the awkward cases are all in one
    /// place.
    /// </remarks>
    private static DateTimeOffset StartOfDayUtc(DateOnly date)
    {
        var midnight = date.ToDateTime(TimeOnly.MinValue);
        return new DateTimeOffset(midnight, AmsterdamTimeZone.GetUtcOffset(midnight))
            .ToUniversalTime();
    }
```

- [ ] **Step 6: Run it and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~ExpectedIntervalCountTests"`
Expected: PASS — 16 passed, 0 failed.

- [ ] **Step 7: Verify by mutation — return 96 always**

The failure this test exists for is the one that never looks wrong: an implementation that answers
96 for every day is right 363 days a year.

Mutate `ExpectedIntervalCount`'s body to:

```csharp
    public int ExpectedIntervalCount(DateOnly date) => 96;
```

⚠ That orphans `StartOfDayUtc`, which under `AnalysisMode Recommended` is a build error rather than
a test failure — and a mutation that breaks the build proves nothing. Keep the helper alive by
touching it in the same expression:

```csharp
    public int ExpectedIntervalCount(DateOnly date)
    {
        _ = StartOfDayUtc(date);
        return 96;
    }
```

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~ExpectedIntervalCountTests"`

Expected: **FAIL** — seven cases, including

```
A_spring_forward_Sunday_has_ninety_two_intervals(date: "2026-03-29") [FAIL]
  CalendarUnderTest.Amsterdam().ExpectedIntervalCount(...) should be 92 but was 96
  2026-03-29 is 23 hours long in Europe/Amsterdam

An_autumn_fall_back_Sunday_has_one_hundred_intervals(date: "2026-10-25") [FAIL]
  CalendarUnderTest.Amsterdam().ExpectedIntervalCount(...) should be 100 but was 96

A_whole_year_holds_exactly_one_short_day_and_one_long_one [FAIL]
  counts.Where(...).Select(...) should be [2026-03-29] but was []
```

Restore and re-run; expected PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs \
        src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs \
        tests/PeakPower.Application.Tests/Time/CalendarUnderTest.cs \
        tests/PeakPower.Application.Tests/Time/ExpectedIntervalCountTests.cs
git commit -m "feat(time): ExpectedIntervalCount - 92, 96 or 100, derived from the zone

The number of quarter-hours between the start of one Amsterdam day and the start of the next, so
the answer follows the EU transition rule for every year rather than a table somebody has to
extend. Integration-spec 8.2 rule 7 rejects a document whose point count is not this number, and
design 7.10 needs a 96-point document refused for BOTH a 92-point and a 100-point date.

Six real transitions across three years, hand-checked rather than computed the way the
implementation computes them, plus a whole-year set assertion: exactly one 92, exactly one 100 and
363 96s in 2026 - which is the assertion a per-date theory cannot make.

Verified by mutation: returning 96 unconditionally - right 363 days a year - turned seven cases red
including the set assertion, which reported the empty list where the transition date should be."
```

---

### Task 9: `IntervalStart` — the Pos mapping, including the autumn duplicate hour

**This is the highest-risk piece of code in the slice.** Design §8's risk table: *"DST is the single
most likely silent correctness bug — a wrong Pos mapping writes plausible data to the wrong times,
and nothing notices until an invoice does."* Design §10 names it as one of four assertions that
must be mutation-verified explicitly, and contract §7.5 states the trap in one sentence: **on the
autumn day, Pos 9–12 are the FIRST pass of 02:00–03:00 (+02:00) and Pos 13–16 are the SECOND
(+01:00). A generic add-15-minutes loop gets exactly this wrong.**

The implementation that gets it right is short, and the reason it is right is worth stating: an
interval position is a count of **elapsed quarter-hours since the day began**, not a wall-clock
label. Absolute time is continuous across a transition; wall-clock time is not. So the mapping is
"day start + 15 min × (pos − 1), rendered in Amsterdam", and every DST case falls out of the
rendering rather than out of a special case.

Worked, on the autumn 2026 fall-back Sunday, whose day begins at 22:00 UTC on the 24th:

| Pos | elapsed | instant | Amsterdam |
| --: | --- | --- | --- |
| 8 | 1 h 45 m | 23:45 UTC | `2026-10-25T01:45:00+02:00` |
| 9 | 2 h 00 m | 00:00 UTC | `2026-10-25T02:00:00+02:00` ← first pass |
| 12 | 2 h 45 m | 00:45 UTC | `2026-10-25T02:45:00+02:00` |
| 13 | 3 h 00 m | 01:00 UTC | `2026-10-25T02:00:00+01:00` ← second pass |
| 16 | 3 h 45 m | 01:45 UTC | `2026-10-25T02:45:00+01:00` |
| 17 | 4 h 00 m | 02:00 UTC | `2026-10-25T03:00:00+01:00` |
| 100 | 24 h 45 m | 22:45 UTC | `2026-10-25T23:45:00+01:00` |

and on the spring 2026 forward Sunday, whose day begins at 23:00 UTC on the 28th:

| Pos | elapsed | instant | Amsterdam |
| --: | --- | --- | --- |
| 8 | 1 h 45 m | 00:45 UTC | `2026-03-29T01:45:00+01:00` |
| 9 | 2 h 00 m | 01:00 UTC | `2026-03-29T03:00:00+02:00` ← 02:00 never happens |
| 92 | 22 h 45 m | 21:45 UTC | `2026-03-29T23:45:00+02:00` |

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Time/IntervalStartTests.cs`

**Interfaces:**
- Consumes: `MarketCalendar.StartOfDayUtc(DateOnly)` and
  `MarketCalendar.ExpectedIntervalCount(DateOnly)` (task 8);
  `MarketCalendar.AmsterdamTimeZone` (slice 1);
  `PeakPower.Application.Tests.Time.CalendarUnderTest.Amsterdam()` (task 8).
- Produces: `DateTimeOffset IMarketCalendar.IntervalStart(DateOnly date, int pos)`. Plan 2 stores
  its result in `metering.interval_reading.interval_start timestamptz`, plan 4 uses it to place a
  parsed `Pos`, plan 5 rolls up on it and plan 6 puts it on the wire as `start` / `end`.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Time/IntervalStartTests.cs`:

```csharp
using System.Globalization;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Time;

/// <summary>
/// Pos to an Amsterdam-local instant, across <b>all six DST transitions in three years</b>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Every expected value below is written out in full and was computed by hand from the EU
/// transition rule, not by the implementation.</b> A golden test whose expectations came out of
/// the code under test agrees with it by construction. The six transitions are 2025-03-30 /
/// 2025-10-26, 2026-03-29 / 2026-10-25 and 2027-03-28 / 2027-10-31.
/// </para>
/// <para>
/// <b>The autumn duplicate hour is the whole point.</b> Pos 9-12 are the FIRST pass of 02:00-03:00
/// at +02:00 and Pos 13-16 are the SECOND at +01:00. A generic add-15-minutes-to-the-wall-clock
/// loop puts Pos 13 at 03:00 - four positions early - and hands the standard offset to the
/// ambiguous ones, which writes plausible data to the wrong times. Design §8: nothing notices
/// until an invoice does.
/// </para>
/// <para>
/// <b>The offset is asserted, not only the instant.</b> DateTimeOffset equality in .NET compares
/// the INSTANT and ignores the offset, so <c>02:00+02:00</c> and <c>03:00+01:00</c> are ShouldBe-
/// equal. That is the exact confusion this class exists to catch, so every case checks
/// <c>.Offset</c> and the local time separately as well.
/// </para>
/// </remarks>
public sealed class IntervalStartTests
{
    private static DateTimeOffset Expected(string iso) =>
        DateTimeOffset.ParseExact(
            iso, "yyyy-MM-ddTHH:mm:sszzz", CultureInfo.InvariantCulture, DateTimeStyles.None);

    private static void AssertInterval(string date, int pos, string expectedIso)
    {
        var expected = Expected(expectedIso);

        var actual = CalendarUnderTest.Amsterdam().IntervalStart(
            DateOnly.ParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture), pos);

        // Three assertions, and the second and third are not redundant. DateTimeOffset equality
        // compares the instant alone: 02:00+02:00 == 01:00+01:00 == 00:00Z are all the SAME
        // DateTimeOffset. So an implementation that got the instant right and the offset wrong -
        // which is precisely what happens when the ambiguous hour is resolved to standard time -
        // would pass the first assertion on its own.
        actual.ShouldBe(expected, $"{date} Pos {pos} is a different INSTANT from {expectedIso}");
        actual.Offset.ShouldBe(
            expected.Offset,
            $"{date} Pos {pos} carries the wrong UTC offset. The instant may still be right: "
            + "DateTimeOffset equality ignores the offset, which is how a wrong DST pass survives "
            + "an equality check");
        actual.DateTime.ShouldBe(
            expected.DateTime,
            $"{date} Pos {pos} renders as a different LOCAL time from {expectedIso}");
    }

    // ── an ordinary day, so nothing below is passing because every day is special ──────────────

    [Theory]
    [InlineData(1, "2026-08-12T00:00:00+02:00")]
    [InlineData(2, "2026-08-12T00:15:00+02:00")]
    [InlineData(33, "2026-08-12T08:00:00+02:00")]
    [InlineData(80, "2026-08-12T19:45:00+02:00")]
    [InlineData(96, "2026-08-12T23:45:00+02:00")]
    public void An_ordinary_summer_day_is_ninety_six_quarter_hours_at_plus_two(
        int pos, string expected) =>
        AssertInterval("2026-08-12", pos, expected);

    [Theory]
    [InlineData(1, "2026-01-15T00:00:00+01:00")]
    [InlineData(96, "2026-01-15T23:45:00+01:00")]
    public void An_ordinary_winter_day_is_ninety_six_quarter_hours_at_plus_one(
        int pos, string expected) =>
        AssertInterval("2026-01-15", pos, expected);

    // ── spring forward: 02:00 never happens, so Pos 9 is 03:00 and the day has 92 ──────────────

    [Theory]
    [InlineData(1, "2025-03-30T00:00:00+01:00")]
    [InlineData(8, "2025-03-30T01:45:00+01:00")]
    [InlineData(9, "2025-03-30T03:00:00+02:00")]
    [InlineData(10, "2025-03-30T03:15:00+02:00")]
    [InlineData(92, "2025-03-30T23:45:00+02:00")]
    public void Spring_2025_skips_the_two_oclock_hour(int pos, string expected) =>
        AssertInterval("2025-03-30", pos, expected);

    [Theory]
    [InlineData(1, "2026-03-29T00:00:00+01:00")]
    [InlineData(8, "2026-03-29T01:45:00+01:00")]
    [InlineData(9, "2026-03-29T03:00:00+02:00")]
    [InlineData(10, "2026-03-29T03:15:00+02:00")]
    [InlineData(92, "2026-03-29T23:45:00+02:00")]
    public void Spring_2026_skips_the_two_oclock_hour(int pos, string expected) =>
        AssertInterval("2026-03-29", pos, expected);

    [Theory]
    [InlineData(1, "2027-03-28T00:00:00+01:00")]
    [InlineData(8, "2027-03-28T01:45:00+01:00")]
    [InlineData(9, "2027-03-28T03:00:00+02:00")]
    [InlineData(92, "2027-03-28T23:45:00+02:00")]
    public void Spring_2027_skips_the_two_oclock_hour(int pos, string expected) =>
        AssertInterval("2027-03-28", pos, expected);

    // ── autumn fall back: 02:00-03:00 happens TWICE, Pos 9-12 then Pos 13-16 ───────────────────

    [Theory]
    [InlineData(1, "2025-10-26T00:00:00+02:00")]
    [InlineData(8, "2025-10-26T01:45:00+02:00")]
    [InlineData(9, "2025-10-26T02:00:00+02:00")]
    [InlineData(10, "2025-10-26T02:15:00+02:00")]
    [InlineData(11, "2025-10-26T02:30:00+02:00")]
    [InlineData(12, "2025-10-26T02:45:00+02:00")]
    [InlineData(13, "2025-10-26T02:00:00+01:00")]
    [InlineData(14, "2025-10-26T02:15:00+01:00")]
    [InlineData(15, "2025-10-26T02:30:00+01:00")]
    [InlineData(16, "2025-10-26T02:45:00+01:00")]
    [InlineData(17, "2025-10-26T03:00:00+01:00")]
    [InlineData(100, "2025-10-26T23:45:00+01:00")]
    public void Autumn_2025_repeats_the_two_oclock_hour(int pos, string expected) =>
        AssertInterval("2025-10-26", pos, expected);

    [Theory]
    [InlineData(1, "2026-10-25T00:00:00+02:00")]
    [InlineData(8, "2026-10-25T01:45:00+02:00")]
    [InlineData(9, "2026-10-25T02:00:00+02:00")]
    [InlineData(10, "2026-10-25T02:15:00+02:00")]
    [InlineData(11, "2026-10-25T02:30:00+02:00")]
    [InlineData(12, "2026-10-25T02:45:00+02:00")]
    [InlineData(13, "2026-10-25T02:00:00+01:00")]
    [InlineData(14, "2026-10-25T02:15:00+01:00")]
    [InlineData(15, "2026-10-25T02:30:00+01:00")]
    [InlineData(16, "2026-10-25T02:45:00+01:00")]
    [InlineData(17, "2026-10-25T03:00:00+01:00")]
    [InlineData(100, "2026-10-25T23:45:00+01:00")]
    public void Autumn_2026_repeats_the_two_oclock_hour(int pos, string expected) =>
        AssertInterval("2026-10-25", pos, expected);

    [Theory]
    [InlineData(1, "2027-10-31T00:00:00+02:00")]
    [InlineData(9, "2027-10-31T02:00:00+02:00")]
    [InlineData(12, "2027-10-31T02:45:00+02:00")]
    [InlineData(13, "2027-10-31T02:00:00+01:00")]
    [InlineData(16, "2027-10-31T02:45:00+01:00")]
    [InlineData(17, "2027-10-31T03:00:00+01:00")]
    [InlineData(100, "2027-10-31T23:45:00+01:00")]
    public void Autumn_2027_repeats_the_two_oclock_hour(int pos, string expected) =>
        AssertInterval("2027-10-31", pos, expected);

    // ── the properties that hold on every day, asserted over whole days ────────────────────────

    [Theory]
    [InlineData("2026-03-29")]
    [InlineData("2026-08-12")]
    [InlineData("2026-10-25")]
    public void Every_interval_of_a_day_is_exactly_fifteen_minutes_after_the_last(string date)
    {
        var calendar = CalendarUnderTest.Amsterdam();
        var day = DateOnly.ParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var count = calendar.ExpectedIntervalCount(day);

        // The property that makes a day a day: it is a contiguous run of quarter-hours in
        // ABSOLUTE time, whatever the wall clock did in the middle of it. On the autumn day this
        // is what forces Pos 13 to be a quarter of an hour after Pos 12 rather than an hour and a
        // quarter after it.
        for (var pos = 2; pos <= count; pos++)
        {
            (calendar.IntervalStart(day, pos) - calendar.IntervalStart(day, pos - 1))
                .ShouldBe(
                    TimeSpan.FromMinutes(15),
                    $"{date} Pos {pos} is not a quarter of an hour after Pos {pos - 1}");
        }
    }

    [Theory]
    [InlineData("2026-03-29", 92)]
    [InlineData("2026-08-12", 96)]
    [InlineData("2026-10-25", 100)]
    public void The_last_interval_of_a_day_ends_where_the_next_day_starts(string date, int count)
    {
        var calendar = CalendarUnderTest.Amsterdam();
        var day = DateOnly.ParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture);

        // No gap and no overlap between days, which is the other half of "a day is contiguous".
        // A mapping that ran off the end of the day - which a naive wall-clock loop does on the
        // autumn date, landing Pos 100 on the 26th - fails here as well as on the golden value.
        (calendar.IntervalStart(day, count) + TimeSpan.FromMinutes(15))
            .ShouldBe(
                calendar.IntervalStart(day.AddDays(1), 1),
                $"{date} Pos {count} + 15 minutes is not the first interval of the next day");
    }

    [Theory]
    [InlineData("2026-08-12", 0)]
    [InlineData("2026-08-12", -1)]
    [InlineData("2026-08-12", 97)]
    [InlineData("2026-03-29", 93)]     // 92-point day: 93 is off the end
    [InlineData("2026-10-25", 101)]    // 100-point day: 101 is off the end
    public void A_position_outside_the_day_is_refused_rather_than_extrapolated(string date, int pos)
    {
        var calendar = CalendarUnderTest.Amsterdam();
        var day = DateOnly.ParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture);

        var refusal = Should.Throw<ArgumentOutOfRangeException>(
            () => calendar.IntervalStart(day, pos));

        refusal.ParamName.ShouldBe("pos");
    }

    [Fact]
    public void Pos_ninety_six_is_accepted_on_the_autumn_day_and_refused_on_the_spring_one()
    {
        // The pair design §7.10 turns into a rejection rule: a 96-point document is SHORT for the
        // autumn date and OVER-LENGTH for the spring one. Here that is the boundary of what
        // IntervalStart will answer at all, which is what makes the pipeline's INCOMPLETE_PERIOD
        // check something it can lean on.
        var calendar = CalendarUnderTest.Amsterdam();

        Should.NotThrow(() => calendar.IntervalStart(new DateOnly(2026, 10, 25), 96));

        Should.Throw<ArgumentOutOfRangeException>(
            () => calendar.IntervalStart(new DateOnly(2026, 3, 29), 96));
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Application.Tests --nologo`
Expected: FAIL with
`error CS1061: 'MarketCalendar' does not contain a definition for 'IntervalStart' and no accessible extension method 'IntervalStart' accepting a first argument of type 'MarketCalendar' could be found`

- [ ] **Step 3: Add the member to the port**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs`,
adding after `ExpectedIntervalCount`:

```csharp
    /// <summary>
    /// The Amsterdam-local start instant of <paramref name="pos"/> (1-based) on
    /// <paramref name="date"/>, as a <see cref="DateTimeOffset"/> carrying the correct offset for
    /// that pass.
    /// </summary>
    /// <remarks>
    /// <para>
    /// ⚠ <b>On the autumn fall-back Sunday, Pos 9–12 are the FIRST pass of 02:00–03:00 (+02:00)
    /// and Pos 13–16 are the SECOND (+01:00).</b> A generic add-fifteen-minutes-to-the-wall-clock
    /// loop gets exactly this wrong, and the result is plausible data written to the wrong times —
    /// which nothing notices until an invoice does.
    /// </para>
    /// <para>
    /// This is the single source of that mapping for the whole platform: the adapter places a
    /// parsed <c>Pos</c> with it, the rollup groups on it, <c>interval_reading.interval_start</c>
    /// stores it, and the chart's hour ticks are drawn from it. A second copy would be a second
    /// answer.
    /// </para>
    /// </remarks>
    /// <exception cref="ArgumentOutOfRangeException">
    /// When <paramref name="pos"/> is below 1 or above
    /// <see cref="ExpectedIntervalCount(DateOnly)"/> for that date. Refused rather than
    /// extrapolated: a 97th interval on an ordinary day is a document that disagrees with the
    /// calendar, and answering it would place a reading on the following day.
    /// </exception>
    DateTimeOffset IntervalStart(DateOnly date, int pos);
```

- [ ] **Step 4: Implement it**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs`,
adding after `ExpectedIntervalCount`:

```csharp
    /// <inheritdoc />
    /// <remarks>
    /// <para>
    /// <b>An interval position is a count of elapsed quarter-hours, not a wall-clock label.</b>
    /// Absolute time is continuous across a DST transition and wall-clock time is not, so the
    /// mapping is "the day's start instant, plus fifteen minutes per position" — and every DST case
    /// then falls out of the RENDERING rather than out of a special case. There is deliberately no
    /// branch here for either transition.
    /// </para>
    /// <para>
    /// Worked, on the autumn fall-back Sunday, whose day begins at 22:00 UTC the previous evening:
    /// Pos 12 is 00:45 UTC, which Amsterdam renders <c>02:45+02:00</c>; Pos 13 is 01:00 UTC, which
    /// it renders <c>02:00+01:00</c> — the second pass of the same wall-clock hour, a quarter of
    /// an hour later in absolute time. Pos 17 is 02:00 UTC, <c>03:00+01:00</c>.
    /// </para>
    /// <para>
    /// <b>What the naive implementation does instead.</b> Building a local
    /// <see cref="DateTime"/> and asking <c>GetUtcOffset</c> for its offset answers the STANDARD
    /// offset for an ambiguous time — that is documented behaviour — so Pos 9–12 come back at
    /// +01:00, and the loop reaches 03:00 at Pos 13 rather than at Pos 17, running four positions
    /// off the end of the day. The tests in <c>IntervalStartTests</c> assert the offset and the
    /// local time separately for exactly that reason: DateTimeOffset equality compares the instant
    /// alone.
    /// </para>
    /// </remarks>
    public DateTimeOffset IntervalStart(DateOnly date, int pos)
    {
        var expected = ExpectedIntervalCount(date);

        if (pos < 1 || pos > expected)
        {
            throw new ArgumentOutOfRangeException(
                nameof(pos),
                pos,
                $"{date:yyyy-MM-dd} has {expected} intervals in Europe/Amsterdam, so Pos must be "
                + $"between 1 and {expected}. Answering anyway would place a reading on another "
                + "day.");
        }

        var instant = StartOfDayUtc(date).AddMinutes(IntervalMinutes * (pos - 1));

        return TimeZoneInfo.ConvertTime(instant, AmsterdamTimeZone);
    }
```

- [ ] **Step 5: Run it and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~IntervalStartTests"`
Expected: PASS — 64 passed, 0 failed.

- [ ] **Step 6: Mutation-verify the Pos mapping — design §10 requires this one explicitly**

Design §10's third mandatory mutation, and contract §15.2's third row: *"Replace `IntervalStart`
with a naive add-15-minutes loop"*.

Replace the body of `IntervalStart` in
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs`
with the naive version — the one an implementer writes when they think of a position as a
wall-clock label:

```csharp
    public DateTimeOffset IntervalStart(DateOnly date, int pos)
    {
        // MUTATION - the naive add-fifteen-minutes-to-the-wall-clock loop. Restored below.
        var local = date.ToDateTime(TimeOnly.MinValue).AddMinutes(IntervalMinutes * (pos - 1));
        return new DateTimeOffset(local, AmsterdamTimeZone.GetUtcOffset(local));
    }
```

⚠ Removing the range check orphans nothing, but it does mean
`A_position_outside_the_day_is_refused_rather_than_extrapolated` and
`Pos_ninety_six_is_accepted_on_the_autumn_day_and_refused_on_the_spring_one` fail for a *different*
reason than the mapping. That is fine and expected — read past them to the golden cases, which are
the subject.

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~IntervalStartTests"`

Expected: **FAIL**, and these are the failures to check by name — predict them before running:

```
Autumn_2026_repeats_the_two_oclock_hour(pos: 9, expected: "2026-10-25T02:00:00+02:00") [FAIL]
  actual.Offset should be 02:00:00 but was 01:00:00
  2026-10-25 Pos 9 carries the wrong UTC offset. The instant may still be right: DateTimeOffset
  equality ignores the offset, which is how a wrong DST pass survives an equality check

Autumn_2026_repeats_the_two_oclock_hour(pos: 13, expected: "2026-10-25T02:00:00+01:00") [FAIL]
  actual.DateTime should be 2026-10-25 02:00:00 but was 2026-10-25 03:00:00
  2026-10-25 Pos 13 renders as a different LOCAL time from 2026-10-25T02:00:00+01:00

Autumn_2026_repeats_the_two_oclock_hour(pos: 100, expected: "2026-10-25T23:45:00+01:00") [FAIL]
  actual should be 2026-10-25 23:45:00 +01:00 but was 2026-10-26 00:45:00 +01:00
  2026-10-25 Pos 100 is a different INSTANT from 2026-10-25T23:45:00+01:00

Every_interval_of_a_day_is_exactly_fifteen_minutes_after_the_last(date: "2026-10-25") [FAIL]
  (calendar.IntervalStart(day, pos) - calendar.IntervalStart(day, pos - 1)) should be 00:15:00
  but was 01:15:00
  2026-10-25 Pos 13 is not a quarter of an hour after Pos 12
```

plus the spring cases (`Spring_2026 … pos: 9` renders `02:00` where the fixture says `03:00`, on an
hour that does not exist) and the two range tests.

**Three distinct things go red and each says something different.** Pos 9–12 carry the standard
offset instead of the daylight one. Pos 13–16 reach the 03:00 hour four positions early, so the
whole run of intervals after the transition is labelled an hour on. And Pos 100 lands on **26
October**, a whole day out — which is the form the bug takes in stored data, and the reason the
`interval_start` column is worth storing at all.

⚠ Contract §15.2 summarises this as "Pos 13–16 land an hour early". Read against the naive loop
that is precisely the sense above: the 03:00 hour arrives four positions — one hour — earlier in
the sequence than it should. The instants and offsets in the block above are what the run actually
prints; take those, not the summary, as the prediction to check.

Now restore the correct implementation from step 4 and re-run.

Expected: PASS — 64 passed, 0 failed.

- [ ] **Step 7: Verify the offset assertion is not itself decoration**

The second and third assertions in `AssertInterval` exist because `DateTimeOffset` equality
compares instants. Prove they do something: comment out `actual.Offset.ShouldBe(...)` **and**
`actual.DateTime.ShouldBe(...)`, re-apply the naive mutation from step 6, and run only the autumn
theory.

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~Autumn_2026"`

Expected: **Pos 9 through 12 now PASS** against the broken implementation — the instants are
identical, only the offsets differ — while Pos 13, 17 and 100 still fail. That is the half of the
bug an instant-only test cannot see, and it is the half that reaches the chart's `02:00 A` /
`02:00 B` labels.

Restore both assertions and the correct implementation; re-run the whole class. Expected: PASS —
55 passed.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs \
        src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs \
        tests/PeakPower.Application.Tests/Time/IntervalStartTests.cs
git commit -m "feat(time): IntervalStart, including the autumn duplicate hour

An interval position is a count of elapsed quarter-hours since the day began, not a wall-clock
label - absolute time is continuous across a transition and wall-clock time is not. So the mapping
is 'day start plus fifteen minutes per position, rendered in Amsterdam', with no branch for either
transition, and Pos 9-12 at +02:00 / Pos 13-16 at +01:00 falls out of the rendering.

Golden values for all six transitions across three years, hand-computed from the EU rule rather
than from this code, plus two whole-day properties: every interval is exactly fifteen minutes after
the last, and the last interval plus fifteen minutes is the next day's first.

Every case asserts the INSTANT, the OFFSET and the LOCAL time separately. DateTimeOffset equality
compares instants alone, so 02:00+02:00 and 03:00+01:00 are equal - which is exactly how a wrong
DST pass survives an equality check.

Verified by mutation, as design section 10 requires explicitly: the naive
add-fifteen-minutes-to-the-wall-clock loop turned Pos 9-12's offset to +01:00, moved Pos 13-16 to
the 03:00 hour four positions early, and put Pos 100 on 26 October - a whole day out. With the
offset and local-time assertions removed, Pos 9-12 passed against that broken implementation, which
is why all three assertions are there."
```

---

### Task 10: `IsDstDuplicate` — which four positions are the repeated hour's second pass

Contract §7.5: *"True only for Pos 13–16 on the autumn fall-back Sunday — the repeated hour's
second pass. The chart labels the first `02:00 A` and the second `02:00 B`."* Contract §10.1
carries it to the wire as `dstPass`, `"A"` for Pos 9–12 and `"B"` for Pos 13–16 and `null`
everywhere else, and adds the instruction that matters for plan 7: **the chart composes the label
from `dstPass` and must not re-derive the pass from the UTC offset.**

**Derived from the zone, not from the literals 13 and 16.** `13..16` is the right answer for a
quarter-hourly resolution on a one-hour transition and is wrong for either of those two things
changing. What is durable is the definition: a duplicate is an interval whose local wall time is
ambiguous **and** which carries the standard offset — the second of the two passes, by
construction.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Time/IsDstDuplicateTests.cs`

**Interfaces:**
- Consumes: `MarketCalendar.IntervalStart(DateOnly, int)` (task 9);
  `MarketCalendar.AmsterdamTimeZone` (slice 1).
- Produces: `bool IMarketCalendar.IsDstDuplicate(DateOnly date, int pos)`. Plan 6 maps it to the
  envelope's `dstPass`; plan 7 renders `02:00 A` / `02:00 B` from that.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Time/IsDstDuplicateTests.cs`:

```csharp
using System.Globalization;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Time;

/// <summary>
/// Which intervals are the second pass of the autumn repeated hour.
/// </summary>
/// <remarks>
/// Asserted as a SET over each whole day rather than one position at a time. "Pos 13 is a
/// duplicate" is satisfied by an implementation that answers true for everything; "the duplicates
/// of this day are exactly {13,14,15,16} and there are none on any other day" is not.
/// </remarks>
public sealed class IsDstDuplicateTests
{
    private static int[] DuplicatesOf(string date)
    {
        var calendar = CalendarUnderTest.Amsterdam();
        var day = DateOnly.ParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture);

        return [.. Enumerable
            .Range(1, calendar.ExpectedIntervalCount(day))
            .Where(pos => calendar.IsDstDuplicate(day, pos))];
    }

    [Theory]
    [InlineData("2025-10-26")]
    [InlineData("2026-10-25")]
    [InlineData("2027-10-31")]
    public void The_autumn_fall_back_Sunday_has_exactly_four_duplicates_at_thirteen_to_sixteen(
        string date) =>
        DuplicatesOf(date).ShouldBe(
            [13, 14, 15, 16],
            $"{date} repeats 02:00-03:00, and the SECOND pass is Pos 13-16. Pos 9-12 are the first "
            + "pass and are not duplicates - the chart labels them 02:00 A");

    [Theory]
    [InlineData("2025-03-30")]
    [InlineData("2026-03-29")]
    [InlineData("2027-03-28")]
    public void A_spring_forward_Sunday_has_none(string date) =>
        DuplicatesOf(date).ShouldBeEmpty(
            $"{date} SKIPS an hour rather than repeating one; nothing on it happens twice");

    [Theory]
    [InlineData("2026-08-12")]
    [InlineData("2026-01-15")]
    [InlineData("2026-10-24")]
    [InlineData("2026-10-26")]
    public void An_ordinary_day_has_none(string date) =>
        DuplicatesOf(date).ShouldBeEmpty();

    [Fact]
    public void A_whole_year_holds_duplicates_on_exactly_one_day()
    {
        // The set-level assertion again, and for the same reason ExpectedIntervalCountTests has
        // one: a per-date theory cannot say "and on no other day".
        var calendar = CalendarUnderTest.Amsterdam();

        var daysWithDuplicates = Enumerable.Range(0, 365)
            .Select(offset => new DateOnly(2026, 1, 1).AddDays(offset))
            .Where(date => Enumerable
                .Range(1, calendar.ExpectedIntervalCount(date))
                .Any(pos => calendar.IsDstDuplicate(date, pos)))
            .ToArray();

        daysWithDuplicates.ShouldBe([new DateOnly(2026, 10, 25)]);
    }

    [Fact]
    public void The_duplicates_are_the_second_pass_and_carry_the_standard_offset()
    {
        // Ties this member to IntervalStart's answer rather than letting the two drift: the four
        // duplicate positions must be exactly the ones rendered at +01:00 inside the ambiguous
        // hour, and their first-pass twins must render the same wall time at +02:00.
        var calendar = CalendarUnderTest.Amsterdam();
        var autumn = new DateOnly(2026, 10, 25);

        foreach (var (first, second) in new[] { (9, 13), (10, 14), (11, 15), (12, 16) })
        {
            calendar.IsDstDuplicate(autumn, first).ShouldBeFalse($"Pos {first} is the first pass");
            calendar.IsDstDuplicate(autumn, second).ShouldBeTrue($"Pos {second} is the second pass");

            calendar.IntervalStart(autumn, first).DateTime
                .ShouldBe(
                    calendar.IntervalStart(autumn, second).DateTime,
                    $"Pos {first} and Pos {second} are the same wall-clock time, which is what "
                    + "makes one of them a duplicate at all");

            calendar.IntervalStart(autumn, first).Offset.ShouldBe(TimeSpan.FromHours(2));
            calendar.IntervalStart(autumn, second).Offset.ShouldBe(TimeSpan.FromHours(1));
        }
    }

    [Theory]
    [InlineData("2026-08-12", 0)]
    [InlineData("2026-08-12", 97)]
    [InlineData("2026-10-25", 101)]
    public void A_position_outside_the_day_is_refused_here_too(string date, int pos)
    {
        // Same refusal as IntervalStart's, because this asks IntervalStart. A silent `false` for
        // an impossible position would let a caller that is already wrong about the day's length
        // carry on being wrong.
        var calendar = CalendarUnderTest.Amsterdam();
        var day = DateOnly.ParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture);

        Should.Throw<ArgumentOutOfRangeException>(() => calendar.IsDstDuplicate(day, pos))
            .ParamName.ShouldBe("pos");
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Application.Tests --nologo`
Expected: FAIL with
`error CS1061: 'MarketCalendar' does not contain a definition for 'IsDstDuplicate' and no accessible extension method 'IsDstDuplicate' accepting a first argument of type 'MarketCalendar' could be found`

- [ ] **Step 3: Add the member to the port**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs`,
adding after `IntervalStart`:

```csharp
    /// <summary>
    /// True only for the <b>second</b> pass of the autumn fall-back Sunday's repeated hour —
    /// Pos 13–16 at a quarter-hourly resolution.
    /// </summary>
    /// <remarks>
    /// The customer envelope carries this as <c>dstPass</c> (<c>"A"</c> for the first pass,
    /// <c>"B"</c> for the second, <c>null</c> everywhere else) and the chart composes
    /// <c>02:00 A</c> / <c>02:00 B</c> from it. The chart must NOT re-derive the pass from the UTC
    /// offset: that is this method's job, and one answer is the point.
    /// </remarks>
    /// <exception cref="ArgumentOutOfRangeException">
    /// When <paramref name="pos"/> is outside the day, on the same terms as
    /// <see cref="IntervalStart(DateOnly, int)"/>.
    /// </exception>
    bool IsDstDuplicate(DateOnly date, int pos);
```

- [ ] **Step 4: Implement it**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs`,
adding after `IntervalStart`:

```csharp
    /// <inheritdoc />
    /// <remarks>
    /// <para>
    /// <b>Derived from the zone rather than from the literals 13 and 16.</b> Those four numbers
    /// are the right answer for a quarter-hourly resolution and a one-hour transition, and would
    /// be silently wrong if either changed. The definition that survives both is the one below:
    /// a duplicate is an interval whose local wall time is <i>ambiguous</i> — it happens twice —
    /// and which carries the <i>standard</i> offset, which is by construction the second of the
    /// two passes.
    /// </para>
    /// <para>
    /// <c>IsAmbiguousTime</c> is asked about the local <see cref="DateTime"/> rather than the
    /// <see cref="DateTimeOffset"/>: with <c>DateTimeKind.Unspecified</c> it means "this wall
    /// clock, in this zone", which is exactly the question. Calling
    /// <see cref="IntervalStart(DateOnly, int)"/> first is also what makes an out-of-range
    /// position throw here rather than quietly answering false.
    /// </para>
    /// </remarks>
    public bool IsDstDuplicate(DateOnly date, int pos)
    {
        var start = IntervalStart(date, pos);

        return AmsterdamTimeZone.IsAmbiguousTime(start.DateTime)
               && start.Offset == AmsterdamTimeZone.BaseUtcOffset;
    }
```

- [ ] **Step 5: Run it and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~IsDstDuplicateTests"`
Expected: PASS — 15 passed, 0 failed.

- [ ] **Step 6: Verify by mutation — drop the offset comparison**

The half that is easy to lose is the second condition. Without it every interval of the ambiguous
hour is a "duplicate", which is a chart labelling **eight** intervals `02:00 B` and a `dstPass`
column that never says `A`.

Mutate:

```csharp
    public bool IsDstDuplicate(DateOnly date, int pos)
    {
        var start = IntervalStart(date, pos);

        return AmsterdamTimeZone.IsAmbiguousTime(start.DateTime);
    }
```

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~IsDstDuplicateTests"`

Expected: **FAIL** — four cases:

```
The_autumn_fall_back_Sunday_has_exactly_four_duplicates_at_thirteen_to_sixteen(date: "2026-10-25") [FAIL]
  DuplicatesOf(date) should be [13, 14, 15, 16] but was [9, 10, 11, 12, 13, 14, 15, 16]
  2026-10-25 repeats 02:00-03:00, and the SECOND pass is Pos 13-16. Pos 9-12 are the first pass and
  are not duplicates - the chart labels them 02:00 A

The_duplicates_are_the_second_pass_and_carry_the_standard_offset [FAIL]
  calendar.IsDstDuplicate(autumn, first) should be False but was True
  Pos 9 is the first pass
```

(and the 2025 and 2027 autumn cases with the same eight-element list).

Note that `A_whole_year_holds_duplicates_on_exactly_one_day` stays **green** under this mutation:
the wrong day count is still one. That is the neighbouring case, and it is why the set assertion is
`[13, 14, 15, 16]` and not "the autumn day has some duplicates".

Restore and re-run; expected PASS — 15 passed.

- [ ] **Step 7: Verify by a second mutation — swap the pass**

The mirror-image error, and the one that produces a chart labelled `02:00 B` before `02:00 A`:

```csharp
        return AmsterdamTimeZone.IsAmbiguousTime(start.DateTime)
               && start.Offset != AmsterdamTimeZone.BaseUtcOffset;
```

Run the same filter.

Expected: **FAIL** with
`DuplicatesOf(date) should be [13, 14, 15, 16] but was [9, 10, 11, 12]` and
`calendar.IsDstDuplicate(autumn, first) should be False but was True — Pos 9 is the first pass`.

Both mutations must be run: one proves the set is not too wide, the other that it is not the wrong
half. Restore and re-run; expected PASS — 15 passed.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs \
        src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs \
        tests/PeakPower.Application.Tests/Time/IsDstDuplicateTests.cs
git commit -m "feat(time): IsDstDuplicate - the repeated hour's SECOND pass

A duplicate is an interval whose local wall time is ambiguous and which carries the standard
offset, which is by construction the second of the two passes. Derived that way rather than from
the literals 13 and 16, which are right only for a quarter-hourly resolution and a one-hour
transition.

Asserted as a SET per day - exactly {13,14,15,16} on the autumn Sunday, empty on every other day
of the year - because 'Pos 13 is a duplicate' is satisfied by an implementation that answers true
for everything.

Verified by two mutations. Dropping the offset comparison made the set {9..16}: eight intervals
labelled 02:00 B and a dstPass that never says A. Inverting it made the set {9,10,11,12}: the
labels in the wrong order. The whole-year day count stayed green under both, which is why the
set assertion names the four positions."
```

---

### Task 11: `AddWorkingDays`, the constructor parameter, and the composition root

The last `IMarketCalendar` member, and the one that ties task 7's data to the port. `[F02-R23]`
gives a delivery date **10 working days** to reach `FINAL` with no newer version, and until S2-D8
"the platform's working-day calendar" appeared with the definite article and no referent anywhere
in the specifications.

**S2-D8, in three parts, and all three are tested here:**

- **Monday–Friday.** `AddWorkingDays(d, n)` for `n > 0` advances `n` working days.
- **Empty exclusion list, so public holidays are working days.** A 10-working-day span from
  2026-12-18 crosses Christmas Day (a **Friday** in 2026) and lands on New Year's Day 2027 (also a
  **Friday**) — both counted. A 10-working-day span from 2027-04-20 crosses King's Day (a
  **Tuesday** in 2027) and lands on 2027-05-04.
- **Read from the calendar, not hard-coded**, so populating the list later is a row rather than a
  release — proved by handing it a populated calendar and watching the same span move.

⚠ **`AddWorkingDays(d, 0)` returns `d` unchanged even when `d` is a weekend** (contract §7.5). It
is not "the next working day on or after `d`", and the difference is a whole day in the `FINAL`
job's scheduling.

This task also makes `MarketCalendar` take the calendar. That constructor change touches **nine
call sites in four files**, all of them existing tests, and every one is listed below.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs:19-20`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/TimeServiceCollectionExtensions.cs:1-49`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.ServiceDefaults/Extensions.cs:34`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Time/CalendarUnderTest.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Time/MarketCalendarTests.cs:14`, `:23-24`, `:27-28`, `:38-39`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Seeding/DemoSeedingGateTests.cs:150`, `:184`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs:29`, `:220`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Time/AddWorkingDaysTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Infrastructure.Time.WorkingDayCalendar` and `WorkingDayCalendarOptions`
  (task 7).
- Produces:
  - `DateOnly IMarketCalendar.AddWorkingDays(DateOnly from, int workingDays)`
  - `MarketCalendar(TimeProvider timeProvider, WorkingDayCalendar workingDayCalendar)` — the
    constructor every existing call site moves to
  - `TimeServiceCollectionExtensions.AddMarketCalendar(this IServiceCollection services,
    IConfiguration configuration)` — replaces the parameterless overload; `AddServiceDefaults` is
    its only caller

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Time/AddWorkingDaysTests.cs`:

```csharp
using System.Globalization;
using Shouldly;
using Microsoft.Extensions.Time.Testing;
using PeakPower.Infrastructure.Time;
using Xunit;

namespace PeakPower.Application.Tests.Time;

/// <summary>
/// S2-D8: Monday to Friday, exclusion list empty, public holidays ignored. <c>[F02-R23]</c>'s
/// 10-working-day <c>FINAL</c> rule reads this and nothing else.
/// </summary>
/// <remarks>
/// <para>
/// <b>Every expected date below was worked out by hand from a calendar</b>, not by running the
/// implementation. The two that matter most are the spans design §5 step 2 names: one crossing
/// Christmas and one crossing King's Day, "both asserted to finalise on the weekday count".
/// </para>
/// <para>
/// <b>What makes ignoring holidays safe is `[DEC-98]`</b>, and it is worth restating because the
/// rule looks careless without it: <c>FINAL</c> is a STATUS rather than a guarantee, a post-window
/// version is routine, and a late reconciliation reopens the date to <c>PROVISIONAL</c> and
/// re-finalises. Finalising a working day "early" across Christmas therefore shuts no correction
/// window.
/// </para>
/// </remarks>
public sealed class AddWorkingDaysTests
{
    private static DateOnly Date(string iso) =>
        DateOnly.ParseExact(iso, "yyyy-MM-dd", CultureInfo.InvariantCulture);

    // ── the plain rule ────────────────────────────────────────────────────────────────────────

    [Theory]
    // 2026-08-12 is a Wednesday; ten working days later is Wednesday 2026-08-26.
    [InlineData("2026-08-12", 10, "2026-08-26")]
    // A Friday plus one working day is the following Monday.
    [InlineData("2026-08-14", 1, "2026-08-17")]
    // A Friday plus three is the following Wednesday.
    [InlineData("2026-08-14", 3, "2026-08-19")]
    // A Monday plus five is the following Monday.
    [InlineData("2026-08-17", 5, "2026-08-24")]
    // From a Saturday and from a Sunday, one working day is the next Monday in both cases.
    [InlineData("2026-08-15", 1, "2026-08-17")]
    [InlineData("2026-08-16", 1, "2026-08-17")]
    public void Weekdays_count_and_weekends_do_not(string from, int days, string expected) =>
        CalendarUnderTest.Amsterdam().AddWorkingDays(Date(from), days).ShouldBe(Date(expected));

    [Theory]
    // ⚠ Zero returns the date UNCHANGED, even on a weekend. It is not "the next working day on or
    // after this one", and the difference is a whole day in the FINAL job's scheduling.
    [InlineData("2026-08-15")]   // Saturday
    [InlineData("2026-08-16")]   // Sunday
    [InlineData("2026-08-17")]   // Monday
    public void Zero_working_days_is_the_same_day_even_on_a_weekend(string from) =>
        CalendarUnderTest.Amsterdam().AddWorkingDays(Date(from), 0).ShouldBe(Date(from));

    [Fact]
    public void A_negative_span_is_refused_rather_than_counted_backwards()
    {
        // [F02-R23] only ever adds. Counting backwards is a different question - "which delivery
        // date is ten working days before today" - and answering it here by accident would give a
        // caller a plausible date for a question they did not ask.
        var refusal = Should.Throw<ArgumentOutOfRangeException>(
            () => CalendarUnderTest.Amsterdam().AddWorkingDays(Date("2026-08-12"), -1));

        refusal.ParamName.ShouldBe("workingDays");
    }

    // ── S2-D8's actual subject: holidays are working days ─────────────────────────────────────

    [Fact]
    public void Ten_working_days_from_the_eighteenth_of_December_crosses_Christmas_and_counts_it()
    {
        // 2026-12-18 is a Friday. The ten working days are 21, 22, 23, 24, 25, 28, 29, 30, 31
        // December and 1 January - and CHRISTMAS DAY 2026 IS A FRIDAY, so it is one of them, as is
        // New Year's Day 2027, which is also a Friday. Boxing Day 2026 falls on a Saturday and is
        // not counted, for the ordinary weekend reason.
        Date("2026-12-25").DayOfWeek.ShouldBe(
            DayOfWeek.Friday, "if this ever fails, the fixture below is measuring something else");

        CalendarUnderTest.Amsterdam()
            .AddWorkingDays(Date("2026-12-18"), 10)
            .ShouldBe(
                Date("2027-01-01"),
                "S2-D8: the exclusion list is empty, so a holiday falling on a weekday is a "
                + "working day. A Dutch public-holiday list would have answered 2027-01-05");
    }

    [Fact]
    public void Ten_working_days_from_the_twentieth_of_April_crosses_Kings_Day_and_counts_it()
    {
        // 2027-04-20 is a Tuesday, and KING'S DAY 2027 - 27 April - is also a Tuesday, inside the
        // span. Ten working days later is Tuesday 2027-05-04.
        Date("2027-04-27").DayOfWeek.ShouldBe(
            DayOfWeek.Tuesday, "if this ever fails, the fixture below is measuring something else");

        CalendarUnderTest.Amsterdam()
            .AddWorkingDays(Date("2027-04-20"), 10)
            .ShouldBe(
                Date("2027-05-04"),
                "S2-D8 again: King's Day is a working day, so the span does not stretch by one");
    }

    [Fact]
    public void A_ten_working_day_span_over_ordinary_weeks_is_two_calendar_weeks()
    {
        // The control for the two above: with no holiday anywhere near it, ten working days from a
        // Friday is exactly fourteen calendar days. Both holiday spans give the same interval,
        // which is the whole claim.
        var ordinary = CalendarUnderTest.Amsterdam().AddWorkingDays(Date("2026-08-14"), 10);

        ordinary.ShouldBe(Date("2026-08-28"));
        ordinary.DayNumber.ShouldBe(Date("2026-08-14").DayNumber + 14);

        Date("2027-01-01").DayNumber.ShouldBe(
            Date("2026-12-18").DayNumber + 14,
            "the Christmas span is the same fourteen calendar days as the ordinary one, which is "
            + "what 'holidays are ignored' means arithmetically");

        Date("2027-05-04").DayNumber.ShouldBe(
            Date("2027-04-20").DayNumber + 14,
            "and so is the King's Day span");
    }

    // ── and that the rule is READ rather than compiled in ─────────────────────────────────────

    [Fact]
    public void Populating_the_exclusion_list_moves_the_span_with_no_code_change()
    {
        // [DEC-14]'s "as data", proved: the same span, over a calendar that excludes Christmas Day,
        // finishes one working day later. If this passes and
        // Ten_working_days_from_the_eighteenth_of_December... also passes, the rule is genuinely
        // reading the list rather than carrying its own.
        var withChristmas = new MarketCalendar(
            new FakeTimeProvider(new DateTimeOffset(2026, 8, 12, 9, 0, 0, TimeSpan.Zero)),
            new WorkingDayCalendar(
                [DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday,
                 DayOfWeek.Friday],
                [Date("2026-12-25")]));

        withChristmas.AddWorkingDays(Date("2026-12-18"), 10).ShouldBe(Date("2027-01-04"));
    }

    [Fact]
    public void Changing_the_weekday_set_moves_the_span_too()
    {
        // The other half of the same mechanism. On a six-day week, ten working days from Friday
        // 2026-08-14 is 2026-08-26 rather than 2026-08-28: the two Saturdays inside the span now
        // count.
        var sixDayWeek = new MarketCalendar(
            new FakeTimeProvider(new DateTimeOffset(2026, 8, 12, 9, 0, 0, TimeSpan.Zero)),
            new WorkingDayCalendar(
                [DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday,
                 DayOfWeek.Friday, DayOfWeek.Saturday],
                []));

        sixDayWeek.AddWorkingDays(Date("2026-08-14"), 10).ShouldBe(Date("2026-08-26"));
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Application.Tests --nologo`
Expected: FAIL with
`error CS1061: 'MarketCalendar' does not contain a definition for 'AddWorkingDays' and no accessible extension method 'AddWorkingDays' accepting a first argument of type 'MarketCalendar' could be found`
and
`error CS1729: 'MarketCalendar' does not contain a constructor that takes 2 arguments`

- [ ] **Step 3: Add the member to the port**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs`,
adding after `IsDstDuplicate`:

```csharp
    /// <summary>
    /// <paramref name="from"/> advanced by <paramref name="workingDays"/> working days.
    /// <b>S2-D8:</b> Monday–Friday, with an exclusion list that is currently <b>empty</b>, so
    /// public holidays are working days.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>[F02-R23]</c>'s 10-working-day <c>FINAL</c> rule is the caller. The weekday set and the
    /// exclusion list are read from the <c>[DEC-14]</c> calendar rather than compiled in, so
    /// populating the list later is a configuration row and not a release.
    /// </para>
    /// <para>
    /// ⚠ <c>AddWorkingDays(d, 0)</c> returns <c>d</c> unchanged <b>even when <c>d</c> is a
    /// weekend</b>. It is not "the next working day on or after <c>d</c>".
    /// </para>
    /// <para>
    /// What makes ignoring holidays safe is <c>[DEC-98]</c>: <c>FINAL</c> is a status rather than
    /// a guarantee, a post-window version is routine, and a late reconciliation reopens the date
    /// to <c>PROVISIONAL</c> and re-finalises — so finalising across Christmas shuts no correction
    /// window.
    /// </para>
    /// </remarks>
    /// <exception cref="ArgumentOutOfRangeException">
    /// When <paramref name="workingDays"/> is negative. Counting backwards is a different question
    /// and answering it by accident would hand a caller a plausible date for a question they did
    /// not ask.
    /// </exception>
    DateOnly AddWorkingDays(DateOnly from, int workingDays);
```

- [ ] **Step 4: Give `MarketCalendar` the calendar, and implement the member**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs`.

Replace the class declaration at line 19, from

```csharp
public sealed class MarketCalendar(TimeProvider timeProvider) : IMarketCalendar
```

to

```csharp
public sealed class MarketCalendar(
    TimeProvider timeProvider, WorkingDayCalendar workingDayCalendar) : IMarketCalendar
```

⚠ **Required, not optional with a default.** An optional parameter would let the DI container fall
back silently when `WorkingDayCalendar` is not registered, and the symptom — a delivery date
finalising against the wrong weekday set — is invisible. A missing registration has to be a
resolve-time failure naming the type.

Then add, after `IsDstDuplicate`:

```csharp
    /// <inheritdoc />
    public DateOnly AddWorkingDays(DateOnly from, int workingDays)
    {
        ArgumentNullException.ThrowIfNull(workingDayCalendar);

        if (workingDays < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(workingDays),
                workingDays,
                "AddWorkingDays only ever advances. [F02-R23] asks 'ten working days after this "
                + "delivery date'; counting backwards is a different question, and answering it "
                + "here would hand the caller a plausible date for a question they did not ask.");
        }

        // Zero returns `from` UNCHANGED, even on a weekend - contract section 7.5. The loop below
        // does that by construction: it never runs, so nothing moves. Writing it as "advance to
        // the next working day first, then count" would be a different function with the same
        // name, and one working day out for every span that starts on a Saturday.
        var current = from;
        var remaining = workingDays;

        while (remaining > 0)
        {
            current = current.AddDays(1);

            if (workingDayCalendar.IsWorkingDay(current))
            {
                remaining--;
            }
        }

        return current;
    }
```

- [ ] **Step 5: Bind the calendar at the composition root**

Replace the whole of
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Time/TimeServiceCollectionExtensions.cs`
with:

```csharp
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using PeakPower.Application.Abstractions;

namespace PeakPower.Infrastructure.Time;

/// <summary>Composition-root registration for the calendar. Every host calls this once.</summary>
public static class TimeServiceCollectionExtensions
{
    /// <summary>
    /// Registers the clock and the <c>[DEC-14]</c> working-day calendar.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The configuration parameter is what makes S2-D8's list data.</b> The section is
    /// <see cref="WorkingDayCalendarOptions.SectionName"/> — <c>MarketCalendar__WorkingDays</c> and
    /// <c>MarketCalendar__ExcludedDates</c> as environment variables — and it defaults, when
    /// nothing is set, to Monday–Friday with nothing excluded, which is S2-D8's answer.
    /// </para>
    /// <para>
    /// <b>The calendar is built eagerly, at registration, rather than lazily on first resolve.</b>
    /// <see cref="WorkingDayCalendar.From"/> throws on an unreadable day name or date, and the
    /// useful moment for that is host start-up with the section name in the message — not the
    /// first time a FINAL job runs, hours later, inside a background service whose exception
    /// nobody is watching.
    /// </para>
    /// </remarks>
    public static IServiceCollection AddMarketCalendar(
        this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.TryAddSingleton(TimeProvider.System);

        var options = new WorkingDayCalendarOptions();
        configuration.GetSection(WorkingDayCalendarOptions.SectionName).Bind(options);

        services.TryAddSingleton(WorkingDayCalendar.From(options));
        services.TryAddSingleton<IMarketCalendar, MarketCalendar>();

        return services;
    }
}
```

⚠ `Bind` comes from `Microsoft.Extensions.Configuration.Binder`, and `Options` from
`Microsoft.Extensions.Options` — both are in the `Microsoft.AspNetCore.App` shared framework this
project already carries a `FrameworkReference` to. **No new package.** If the build reports
`error CS1061: 'IConfigurationSection' does not contain a definition for 'Bind'`, the framework
reference has been removed rather than a package being missing; put it back.

- [ ] **Step 6: Update the one caller**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.ServiceDefaults/Extensions.cs`,
line 34, from

```csharp
        builder.Services.AddMarketCalendar();
```

to

```csharp
        builder.Services.AddMarketCalendar(builder.Configuration);
```

The comment above it (lines 31-33) stays true and is worth extending by one sentence:

```csharp
        // Every host gets the calendar. Architecture fact 5 forbids reading the system clock
        // anywhere else, so a host that forgot this line fails at resolve time rather than
        // quietly using DateTime.UtcNow. Slice 2: it also binds the [DEC-14] working-day
        // calendar, so an unreadable MarketCalendar__ExcludedDates line is a start-up failure
        // naming the section rather than a FINAL job that counts the wrong days.
        builder.Services.AddMarketCalendar(builder.Configuration);
```

- [ ] **Step 7: Move the nine existing construction sites**

Every one of these is an existing test constructing `MarketCalendar` directly. All nine pass
`WorkingDayCalendar.MondayToFriday` — S2-D8's answer, named once — because none of them is about
the working-day rule.

`tests/PeakPower.Application.Tests/Time/CalendarUnderTest.cs`, the helper body:

```csharp
    public static MarketCalendar Amsterdam() =>
        new(
            new FakeTimeProvider(new DateTimeOffset(2026, 8, 12, 9, 0, 0, TimeSpan.Zero)),
            WorkingDayCalendar.MondayToFriday);
```

`tests/PeakPower.Application.Tests/Time/MarketCalendarTests.cs:14`:

```csharp
        var calendar = new MarketCalendar(
            new FakeTimeProvider(moment), WorkingDayCalendar.MondayToFriday);
```

`tests/PeakPower.Application.Tests/Time/MarketCalendarTests.cs:23-24`:

```csharp
        var stillTheTwentySixth = new MarketCalendar(
            new FakeTimeProvider(new DateTimeOffset(2026, 8, 26, 21, 30, 0, TimeSpan.Zero)),
            WorkingDayCalendar.MondayToFriday);
```

`tests/PeakPower.Application.Tests/Time/MarketCalendarTests.cs:27-28`:

```csharp
        var alreadyTheTwentySeventh = new MarketCalendar(
            new FakeTimeProvider(new DateTimeOffset(2026, 8, 26, 22, 30, 0, TimeSpan.Zero)),
            WorkingDayCalendar.MondayToFriday);
```

`tests/PeakPower.Application.Tests/Time/MarketCalendarTests.cs:38-39`:

```csharp
        var calendar = new MarketCalendar(
            new FakeTimeProvider(new DateTimeOffset(2026, 1, 15, 23, 30, 0, TimeSpan.Zero)),
            WorkingDayCalendar.MondayToFriday);
```

`tests/PeakPower.Integration.Tests/Seeding/DemoSeedingGateTests.cs:149-150`:

```csharp
            var seeder = new DemoDataSeeder(
                db,
                new Argon2idPasswordHasher(),
                new MarketCalendar(TimeProvider.System, WorkingDayCalendar.MondayToFriday));
```

`tests/PeakPower.Integration.Tests/Seeding/DemoSeedingGateTests.cs:183-184`:

```csharp
                return new DemoDataSeeder(
                    db,
                    new Argon2idPasswordHasher(),
                    new MarketCalendar(TimeProvider.System, WorkingDayCalendar.MondayToFriday));
```

`tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs:29`:

```csharp
        var seeder = new DemoDataSeeder(
            db,
            new Argon2idPasswordHasher(),
            new MarketCalendar(TimeProvider.System, WorkingDayCalendar.MondayToFriday));
```

`tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs:220`:

```csharp
        var seeder = new DemoDataSeeder(
            db,
            new Argon2idPasswordHasher(),
            new MarketCalendar(TimeProvider.System, WorkingDayCalendar.MondayToFriday));
```

Both `Seeding` files already carry `using PeakPower.Infrastructure.Time;`
(`DemoDataSeederTests.cs:7`, `DemoSeedingGateTests.cs:7`), so no new using is needed in either.
`CalendarUnderTest.cs` and `MarketCalendarTests.cs` carry it too.

- [ ] **Step 8: Run the whole solution and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet build PeakPower.sln --nologo -warnaserror && dotnet test tests/PeakPower.Application.Tests --nologo`
Expected: PASS — `AddWorkingDaysTests` 15 passed, and every pre-existing test in that project still
green.

Then the rest:

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~Seeding"`
Expected: PASS — the four moved call sites compile and the seeding tests are unaffected.

- [ ] **Step 9: Verify the working-day rule by mutation — count calendar days**

The failure this exists for is a `FINAL` job that fires four days early on every span, which looks
like a scheduling preference rather than a bug.

Mutate `AddWorkingDays` to count calendar days:

```csharp
        var current = from;
        var remaining = workingDays;

        while (remaining > 0)
        {
            current = current.AddDays(1);
            remaining--;
        }

        return current;
```

⚠ That orphans nothing, but `workingDayCalendar` is now unread by any member and the primary
constructor parameter raises `CS9113: Parameter 'workingDayCalendar' is unread` — which
`TreatWarningsAsErrors` turns into a build failure, and a mutation that breaks the build proves
nothing. Keep it read by leaving the `ArgumentNullException.ThrowIfNull(workingDayCalendar);` line
at the top of the method.

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~AddWorkingDaysTests"`

Expected: **FAIL** — nine cases, including

```
Weekdays_count_and_weekends_do_not(from: "2026-08-12", days: 10, expected: "2026-08-26") [FAIL]
  should be 2026-08-26 but was 2026-08-22

Ten_working_days_from_the_eighteenth_of_December_crosses_Christmas_and_counts_it [FAIL]
  should be 2027-01-01 but was 2026-12-28

Populating_the_exclusion_list_moves_the_span_with_no_code_change [FAIL]
  should be 2027-01-04 but was 2026-12-28
```

Restore and re-run; expected PASS — 15 passed.

- [ ] **Step 10: Verify S2-D8's actual subject by mutation — add a holiday list**

The mutation above proves weekends are skipped. It does **not** prove holidays are *not* — which is
the half S2-D8 decided, and the half a well-meaning later edit is most likely to "fix".

Mutate `AddWorkingDays`'s loop condition to hard-code the two Dutch holidays the fixtures cross:

```csharp
            // MUTATION: a hard-coded holiday list, which is exactly what S2-D8 refuses and
            // [F03-R11] forbids in the neighbouring rule. Restored below.
            var isDutchHoliday =
                (current.Month == 12 && current.Day == 25)
                || (current.Month == 1 && current.Day == 1)
                || (current.Month == 4 && current.Day == 27);

            if (workingDayCalendar.IsWorkingDay(current) && !isDutchHoliday)
            {
                remaining--;
            }
```

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~AddWorkingDaysTests"`

Expected: **FAIL** — exactly two cases, and they are the two S2-D8 is about:

```
Ten_working_days_from_the_eighteenth_of_December_crosses_Christmas_and_counts_it [FAIL]
  should be 2027-01-01 but was 2027-01-05
  S2-D8: the exclusion list is empty, so a holiday falling on a weekday is a working day. A Dutch
  public-holiday list would have answered 2027-01-05

Ten_working_days_from_the_twentieth_of_April_crosses_Kings_Day_and_counts_it [FAIL]
  should be 2027-05-04 but was 2027-05-05
  S2-D8 again: King's Day is a working day, so the span does not stretch by one
```

Note that **every weekend assertion stays green** under this mutation — which is why the two
holiday-crossing spans had to be written out separately, with their expected dates computed by
hand. Restore and re-run; expected PASS — 15 passed.

- [ ] **Step 11: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs \
        src/Infrastructure/PeakPower.Infrastructure.Time/MarketCalendar.cs \
        src/Infrastructure/PeakPower.Infrastructure.Time/TimeServiceCollectionExtensions.cs \
        src/Hosts/PeakPower.ServiceDefaults/Extensions.cs \
        tests/PeakPower.Application.Tests/Time/AddWorkingDaysTests.cs \
        tests/PeakPower.Application.Tests/Time/CalendarUnderTest.cs \
        tests/PeakPower.Application.Tests/Time/MarketCalendarTests.cs \
        tests/PeakPower.Integration.Tests/Seeding/DemoDataSeederTests.cs \
        tests/PeakPower.Integration.Tests/Seeding/DemoSeedingGateTests.cs
git commit -m "feat(time): AddWorkingDays per S2-D8, reading the [DEC-14] calendar

[F02-R23] gives a delivery date ten working days to reach FINAL and no specification defined
'the platform's working-day calendar' - the phrase appears with the definite article and no
referent. S2-D8 answers it: Monday to Friday, exclusion list empty, public holidays ignored,
reusing [DEC-14]'s data-driven mechanism.

AddWorkingDays(d, 0) returns d unchanged even on a weekend; it is not 'the next working day on or
after d', and the difference is a whole day in the FINAL job's scheduling. A negative span is
refused rather than counted backwards.

MarketCalendar now takes the WorkingDayCalendar, REQUIRED rather than optional-with-a-default: an
optional parameter would let the container fall back silently when the calendar is not registered,
and the symptom - a date finalising against the wrong weekday set - is invisible. Nine existing
construction sites in four test files move with it.

Verified by two mutations. Counting calendar days turned nine cases red. Hard-coding a Dutch
holiday list - the change a later well-meaning edit is most likely to make - turned exactly the
two holiday-crossing spans red, 2027-01-01 becoming 2027-01-05 and 2027-05-04 becoming 2027-05-05,
while every weekend assertion stayed green. That is why those two spans are written out with
hand-computed dates."
```

---

### Task 12: The `Hangfire.PostgreSql` spike, and its recorded verdict

Design §5 step 1: *"Spike `Hangfire.PostgreSql` on .NET 10 / Npgsql 10 for one day"*, and design
§8's risk row: *"it may not hold on .NET 10 with Npgsql 10, and would be the repo's first
scheduling dependency."* Contract §1.1 records what was established on paper and, more usefully,
what was **not**:

> `Hangfire.PostgreSql` **1.21.1** targets `netstandard2.0` only, depends on `Hangfire.Core >= 1.8.0`,
> `Npgsql >= 6.0.11`, `Dapper >= 2.0.123`, `Dapper.AOT >= 1.0.48`, `Microsoft.CSharp >= 4.7.0`.
> The dependency floors are floors, so Npgsql 10.0.3 and Dapper 2.1.66 satisfy them and NuGet will
> not downgrade them; a `netstandard2.0` package loads on `net10.0` without an NU1701. **What is
> not established is whether the library's ADO.NET usage still compiles and runs against Npgsql
> 10's API surface** — a `netstandard2.0` assembly built against Npgsql 6 binds at runtime, and a
> removed member is a `MissingMethodException` on first use, not a build error.

So the spike has to **run** something, against a **real PostgreSQL 17**, and watch a job execute.
A restore that succeeds proves nothing.

**Outside the solution, deliberately.** A spike that lands in `PeakPower.sln` is a dependency the
whole build carries while the question is still open, and `Directory.Packages.props` is where a
"temporary" pin becomes permanent. It runs in a throwaway directory, and the only artefact that
comes back is a written verdict.

**Files:**
- Create (throwaway, not committed): `/tmp/hangfire-spike/`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/docs/ingestion-job-queue.md`

**Interfaces:**
- Consumes: nothing in the solution.
- Produces: `docs/ingestion-job-queue.md`, whose **Verdict** section decides whether task 17 or
  task 18 is executed. Plans 3, 5 and 8 read it to know what is behind `IIngestionJobQueue`; none
  of them changes because of it.

- [ ] **Step 1: Start a real PostgreSQL 17**

```bash
docker run --detach --name hangfire-spike \
  --env POSTGRES_PASSWORD=postgres \
  --env POSTGRES_DB=spike \
  --publish 55432:5432 \
  postgres:17
sleep 5
docker exec hangfire-spike pg_isready --username postgres --dbname spike
```

Expected: `/var/run/postgresql:5432 - accepting connections`

- [ ] **Step 2: Write the spike**

```bash
mkdir -p /tmp/hangfire-spike
cd /tmp/hangfire-spike
dotnet new console --framework net10.0 --force
dotnet add package Hangfire.Core --version 1.8.25
dotnet add package Hangfire.AspNetCore --version 1.8.25
dotnet add package Hangfire.PostgreSql --version 1.21.1
dotnet add package Npgsql --version 10.0.3
dotnet add package Microsoft.Extensions.Hosting --version 10.0.11
```

⚠ `dotnet new console` inside `/tmp` still reads the nearest `global.json` above it, which is
none — so it uses the machine default, 10.0.400. Confirm with `dotnet --version` in that directory
before continuing; a spike run on a different SDK answers a different question.

Replace `/tmp/hangfire-spike/Program.cs` with:

```csharp
using Hangfire;
using Hangfire.PostgreSql;

// THE SPIKE. Contract section 1.1: what is NOT established on paper is whether
// Hangfire.PostgreSql 1.21.1 - a netstandard2.0 assembly built against Npgsql 6 - still binds
// against Npgsql 10's API surface at RUNTIME. A removed member is a MissingMethodException on
// first use, not a build error, so this has to execute a job rather than merely restore.
//
// Four questions, in the order they can fail:
//   1. does the storage initialise (it creates its own schema on first use)?
//   2. does an enqueue write a row?
//   3. does a background server dequeue and RUN it?
//   4. does the retry ladder fire when the job throws?

const string ConnectionString =
    "Host=localhost;Port=55432;Database=spike;Username=postgres;Password=postgres";

var executed = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
Probe.Executed = executed;

Console.WriteLine("1. initialising storage…");
GlobalConfiguration.Configuration
    .UseSimpleAssemblyNameTypeSerializer()
    .UseRecommendedSerializerSettings()
    .UsePostgreSqlStorage(options => options.UseNpgsqlConnection(ConnectionString));
Console.WriteLine("   storage initialised");

Console.WriteLine("2. enqueuing…");
var jobId = BackgroundJob.Enqueue(() => Probe.Run("hello from the spike"));
Console.WriteLine($"   enqueued {jobId}");

Console.WriteLine("3. starting a background server…");
using var server = new BackgroundJobServer();

var finished = await Task.WhenAny(executed.Task, Task.Delay(TimeSpan.FromSeconds(60)));
if (finished != executed.Task)
{
    Console.Error.WriteLine("FAIL: the job did not run within sixty seconds");
    return 1;
}

Console.WriteLine($"   the job ran and said: {await executed.Task}");
Console.WriteLine("PASS");
return 0;

// A public static method, because that is what Hangfire serialises a job as.
public static class Probe
{
    public static TaskCompletionSource<string>? Executed { get; set; }

    public static void Run(string message) => Executed?.TrySetResult(message);
}
```

- [ ] **Step 3: Run the spike and record what happens**

Run:

```bash
cd /tmp/hangfire-spike
dotnet run 2>&1 | tee /tmp/hangfire-spike/spike.log
echo "exit: ${PIPESTATUS[0]}"
```

Expected — **one of two outcomes, and both are answers**:

- **PASS.** The log ends `PASS` and the exit code is 0. Then:

  ```bash
  docker exec hangfire-spike psql --username postgres --dbname spike \
    --command "\dt hangfire.*"
  dotnet list package --include-transitive 2>&1 | grep -i -E "dapper|npgsql|hangfire"
  ```

  Record the table list and the resolved transitive versions — `Dapper.AOT` in particular, which
  contract §1.1 flags as "a new transitive dependency the repo does not have today and the second
  thing to look at".

- **FAIL.** Most likely as `System.MissingMethodException` or `System.TypeLoadException` naming an
  Npgsql type, at step 1 or step 3. Capture the full exception, including the type and member it
  names.

⚠ **Neither outcome is a failure of this task.** The task's deliverable is the verdict, not a
particular verdict, and design §6 already budgets "+3–5 d for the hand-rolled retry ladder and
three schedules" against the fallback.

- [ ] **Step 4: If it passed, prove the retry ladder too**

A queue that runs a job and swallows a failure is worse than none: `[F02-R05]` makes the webhook
answer 200 before any parsing, so the queue is the **only** thing between a parser bug and a lost
document.

Replace `Probe.Run` in `/tmp/hangfire-spike/Program.cs` with a version that fails twice:

```csharp
public static class Probe
{
    public static TaskCompletionSource<string>? Executed { get; set; }

    private static int _attempts;

    [AutomaticRetry(Attempts = 3, DelaysInSeconds = [1, 1, 1])]
    public static void Run(string message)
    {
        var attempt = Interlocked.Increment(ref _attempts);
        Console.WriteLine($"   attempt {attempt}");

        if (attempt < 3)
        {
            throw new InvalidOperationException($"deliberate failure on attempt {attempt}");
        }

        Executed?.TrySetResult($"{message} (after {attempt} attempts)");
    }
}
```

Run: `cd /tmp/hangfire-spike && dotnet run 2>&1 | tee -a /tmp/hangfire-spike/spike.log`

Expected: three `attempt` lines, then
`the job ran and said: hello from the spike (after 3 attempts)` and `PASS`.

⚠ `_attempts` is process state, so this only works on a single run against a **fresh** database.
Reset with `docker exec hangfire-spike psql --username postgres --dbname spike --command "DROP SCHEMA hangfire CASCADE;"`
before re-running.

- [ ] **Step 5: Write the verdict**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/docs/ingestion-job-queue.md`. Fill in the
bracketed measurements from steps 3 and 4 — **every one of them is a number or a message you
observed, not an expectation**:

```markdown
# What sits behind `IIngestionJobQueue`

**Decided:** 2026-09-07 · **Spike:** design §5 step 1, design §8's third risk row, contract §1.1

`[F02-R04]`/`[F02-R05]` make the webhook answer **200 before any parsing**, which is what stops a
parser bug becoming a redelivery flood. That makes the queue the only thing between a parser bug
and a document nobody ever processes, so what sits behind `IIngestionJobQueue` is a decision worth
recording rather than a library somebody picked.

## The candidate

| Package | Version | Why it was the candidate |
| --- | --- | --- |
| `Hangfire.Core` | 1.8.25 | Latest on nuget.org, 2026-09-07 |
| `Hangfire.AspNetCore` | 1.8.25 | Latest on nuget.org, 2026-09-07 |
| `Hangfire.PostgreSql` | 1.21.1 | Latest on nuget.org, 2026-09-07 |

It brings a retry ladder, three schedules and a dashboard for nothing. The dashboard **stays off**
either way — `[OQ-57]` asks who may see it, and an unanswered question about exposure is not a
reason to expose something.

## What paper established, and what it did not

`Hangfire.PostgreSql` 1.21.1 targets **`netstandard2.0` only** and its dependency floors are
floors: `Npgsql >= 6.0.11` and `Dapper >= 2.0.123` are satisfied by this repository's 10.0.3 and
2.1.66, NuGet will not downgrade either, and a `netstandard2.0` package loads on `net10.0` without
an NU1701.

What that does **not** establish is whether the library's ADO.NET usage still binds against
Npgsql 10's API surface. A `netstandard2.0` assembly compiled against Npgsql 6 resolves its types
at runtime, so a removed member is a `MissingMethodException` on first use rather than a build
error. `Dapper.AOT` is also a new transitive dependency this repository does not have today.

## The spike

A throwaway `net10.0` console application, outside the solution, against a real `postgres:17`
container. Four questions in the order they can fail: does the storage initialise, does an enqueue
write a row, does a background server dequeue and **run** the job, and does the retry ladder fire
when the job throws.

## Verdict

**[PASS / FAIL — write the one that happened, and delete the other section below.]**

### If it passed

- Storage initialised and created these tables: `[the \dt hangfire.* output]`
- A job enqueued, was dequeued and ran within `[N]` seconds.
- With `[AutomaticRetry(Attempts = 3)]` and a deliberate failure, it retried and succeeded on
  attempt 3.
- Resolved transitive versions: `[the dotnet list package --include-transitive lines]`
- New transitive dependency introduced: `Dapper.AOT [version]`.

**Decision: Hangfire.** `Directory.Packages.props` pins the three packages above.
`HangfireIngestionJobQueue` implements `IIngestionJobQueue`; the Worker runs the background server.
**The dashboard is not mapped** — `[OQ-57]` is unanswered.

### If it failed

- Failed at step `[1 / 2 / 3 / 4]` with: `[the exception type, message and the member it named]`

**Decision: the Postgres claim queue.** A `metering.ingestion_job` table (contract §6.9) drained by
a hosted `BackgroundService`, on the pattern
`src/Infrastructure/PeakPower.Infrastructure.Email/OutboundMailService.cs` already establishes in
this repository. Claimed with `SELECT … FOR UPDATE SKIP LOCKED`; retry ladder
**1 m / 5 m / 15 m / 1 h / 4 h, five attempts, then `DEAD`**. Cost, per design §6: three to five
days for the ladder and the schedules.

## What does not change either way

**Plans 3, 4, 5, 6 and 8 name only `IIngestionJobQueue` and `IProcessInboundMessageHandler`**
(contract §7.4). Whether a Hangfire background server or a `BackgroundService` draining a table
sits behind them is this document's business and nobody else's — which is the whole reason the port
was named before the spike was run.
```

- [ ] **Step 6: Tear the spike down**

```bash
docker rm -f hangfire-spike
cp /tmp/hangfire-spike/spike.log \
   /Users/thinhhuynh/PeakPower/peakpower-platform/docs/hangfire-spike.log
rm -rf /tmp/hangfire-spike
```

⚠ The log is committed **beside** the verdict. A recorded decision whose evidence lives only in a
terminal that has since been closed is an assertion, and the next person to ask "are we sure?" has
to run the spike again.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
# -f on the log: .gitignore:39 is a blanket `*.log`, and without it `git add` skips this file
# silently and the commit lands with the verdict and no evidence beside it.
git add docs/ingestion-job-queue.md
git add -f docs/hangfire-spike.log
git commit -m "docs: record what sits behind IIngestionJobQueue, and the spike that decided it

Hangfire.PostgreSql 1.21.1 is a netstandard2.0 assembly built against Npgsql 6. The dependency
floors are floors and it loads on net10.0 without an NU1701, but that says nothing about whether
its ADO.NET usage still binds against Npgsql 10 - a removed member is a MissingMethodException on
first use, not a build error. So the spike ran a job against a real postgres:17 rather than
restoring a package.

Verdict and evidence in docs/ingestion-job-queue.md, with the run's own output beside it. Plans 3,
4, 5, 6 and 8 name only IIngestionJobQueue and IProcessInboundMessageHandler and are unchanged
either way, which is why the port was named before the spike was run."
```

---

### Task 13: The Worker boots, answers `/health`, and has no `/api/v1` route

Task 5 created `PeakPower.Worker` as a shell and said, in its own `Program.cs` comment, that "no
`/api/v1` route, ever" is *"a fact about the endpoint table rather than a convention"*. This is the
task that makes that sentence true. It has to exist **before** plan 3 maps
`POST /webhooks/brp/{brpCode}` onto this host, because a route-table assertion written after the
first route is an assertion written around whatever was already there.

Contract §9.1: the webhook *"is deliberately outside the versioned API surface"* — it carries no
session, it is authenticated per BRP by a shared-secret header, and it is served by
`PeakPower.Worker` and by nothing else. The failure this guards is not a wrong URL. It is somebody
mapping a convenience read — "just a small endpoint to list inbound messages" — onto the one host
in the stack that connects as the **database owner** and is therefore exempt from row-level
security by design (design §4.3). On the two APIs an accidental route is caught by row-level
security; here there is nothing underneath.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj:19` — one `<ProjectReference>` added after it
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Hosts/WorkerHostTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Worker.WorkerEntryPoint` (task 5) · `WebApplicationFactory<TEntryPoint>`
  (`Microsoft.AspNetCore.Mvc.Testing`, already pinned at 10.0.11) ·
  `Microsoft.AspNetCore.Routing.EndpointDataSource`
- Produces: `PeakPower.Integration.Tests.Hosts.WorkerHostTests` — three facts about the Worker's
  endpoint table. No production code changes.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Hosts/WorkerHostTests.cs`:

```csharp
using System.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Worker;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Hosts;

/// <summary>
/// The Worker host: it boots, it answers the two health endpoints ServiceDefaults maps, and its
/// endpoint table contains no <c>/api/v1</c> route at all.
/// </summary>
/// <remarks>
/// <para>
/// <b>The third assertion is the one worth having, and it is written before there is a route to
/// get wrong.</b> Shared contract §9.1 puts <c>POST /webhooks/brp/{brpCode}</c> deliberately
/// outside the versioned API surface: it carries no session, it is authenticated per BRP by a
/// shared-secret header (§9.2), and it is served by this host and by nothing else. Plan 3 maps it;
/// plan 5 adds two schedules behind it. Neither may add a customer- or employee-facing read.
/// </para>
/// <para>
/// <b>Why an accidental route here is worse than on either API.</b> This host connects as the
/// database OWNER and is exempt from row-level security by design (design §4.3), because it writes
/// across every tenant and serves nothing to a customer. On the two APIs a route that forgot its
/// tenancy still meets a policy that filters the rows; here there is nothing underneath it. The
/// exemption is safe exactly as long as this assertion holds, which is why it is an assertion and
/// not a paragraph.
/// </para>
/// <para>
/// Asserted against <see cref="EndpointDataSource"/> rather than by probing URLs, because a probe
/// can only ask about paths somebody thought to write down. The endpoint table is the whole set.
/// </para>
/// </remarks>
public sealed class WorkerHostTests
{
    [Theory]
    [InlineData("/health")]
    [InlineData("/alive")]
    public async Task The_worker_answers_the_health_endpoint(string path)
    {
        using var factory = new WebApplicationFactory<WorkerEntryPoint>();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(path, TestContext.Current.CancellationToken);

        response.StatusCode.ShouldBe(
            HttpStatusCode.OK,
            $"the deployed Worker's Compose service has no health check of its own, so {path} is "
            + "what an operator and `docker compose ps` have to read this host's state from");
    }

    [Fact]
    public void The_worker_exposes_no_versioned_API_route()
    {
        using var factory = new WebApplicationFactory<WorkerEntryPoint>();

        var routes = factory.Services.GetRequiredService<EndpointDataSource>()
            .Endpoints
            .OfType<RouteEndpoint>()
            .Select(endpoint => endpoint.RoutePattern.RawText ?? string.Empty)
            .ToArray();

        routes.ShouldNotBeEmpty(
            "non-vacuity: with an empty endpoint table this test agrees with anything, and "
            + "MapDefaultEndpoints puts /health and /alive in it");

        var versioned = routes
            .Where(route => route.TrimStart('/')
                .StartsWith("api/v1", StringComparison.OrdinalIgnoreCase))
            .Order(StringComparer.Ordinal)
            .ToArray();

        versioned.ShouldBeEmpty(
            $"[{string.Join(", ", versioned)}] are mapped on the Worker. This host connects as the "
            + "database owner and is exempt from row-level security (design §4.3), which is safe "
            + "only because it serves no customer- or employee-facing route. The webhook lives "
            + "outside /api/v1 on purpose - shared contract §9.1");
    }

    /// <summary>
    /// And the webhook prefix is the only non-health route this host will ever grow.
    /// </summary>
    /// <remarks>
    /// The complement of the assertion above, and it fails differently: that one catches a route
    /// under the versioned prefix, this one catches a route under no prefix at all —
    /// <c>/replay</c>, <c>/status</c>, a dashboard. Today the set is exactly the two health
    /// endpoints; plan 3 adds <c>webhooks/brp/{brpCode}</c>, which is why the allowed prefixes are
    /// listed rather than the count being pinned. <c>[OQ-57]</c> is unanswered, so a Hangfire
    /// dashboard mapped here would fail this on the way in, which is the point.
    /// </remarks>
    [Fact]
    public void Every_route_on_the_worker_is_a_health_endpoint_or_the_webhook()
    {
        using var factory = new WebApplicationFactory<WorkerEntryPoint>();

        var unexpected = factory.Services.GetRequiredService<EndpointDataSource>()
            .Endpoints
            .OfType<RouteEndpoint>()
            .Select(endpoint => "/" + (endpoint.RoutePattern.RawText ?? string.Empty).TrimStart('/'))
            .Where(route => route is not ("/health" or "/alive")
                && !route.StartsWith("/webhooks/brp/", StringComparison.Ordinal))
            .Order(StringComparer.Ordinal)
            .ToArray();

        unexpected.ShouldBeEmpty(
            $"[{string.Join(", ", unexpected)}] are mapped on the Worker, which serves the BRP "
            + "webhook and its own health endpoints and nothing else. A dashboard in particular is "
            + "OQ-57 and unanswered - an open question about who may see something is not a reason "
            + "to expose it");
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~WorkerHostTests"
```

Expected: **FAIL to build**, with

```
error CS0246: The type or namespace name 'PeakPower' could not be found
```

on `using PeakPower.Worker;` — this test project does not reference the Worker host yet. That is
the failure, and it is the one the next step fixes.

- [ ] **Step 3: Reference the Worker host from the integration suite**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj`
and insert after line 19
(`<ProjectReference Include="../../src/Infrastructure/PeakPower.Infrastructure.Web/PeakPower.Infrastructure.Web.csproj" />`):

```xml
    <!--
      WorkerHostTests boots the Worker through WebApplicationFactory<WorkerEntryPoint> and reads
      its EndpointDataSource. Contract section 9.1 puts POST /webhooks/brp/{brpCode} outside the
      versioned API surface and this host connects as the database owner, exempt from row-level
      security (design section 4.3) - so "no /api/v1 route here" is an assertion about the endpoint
      table, and the table is only readable from a reference to the host.
    -->
    <ProjectReference Include="../../src/Hosts/PeakPower.Worker/PeakPower.Worker.csproj" />
```

- [ ] **Step 4: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~WorkerHostTests"
```

Expected: PASS — 4 passed (two health theories, two endpoint-table facts).

- [ ] **Step 5: Mutate the route-table assertion and watch it go red**

The assertion is about a route that does not exist yet, so it has to be shown to be capable of
failing. Temporarily add one line to
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Program.cs`, directly
above `app.Run();`:

```csharp
app.MapGet("/api/v1/inbound-messages", () => Results.Ok(Array.Empty<string>()));
```

Run: `dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~WorkerHostTests"`

Expected: **FAIL**, exactly two of the four, with

```
The_worker_exposes_no_versioned_API_route [FAIL]
  [api/v1/inbound-messages] are mapped on the Worker. This host connects as the database owner
  and is exempt from row-level security (design §4.3), which is safe only because it serves no
  customer- or employee-facing route.

Every_route_on_the_worker_is_a_health_endpoint_or_the_webhook [FAIL]
  [/api/v1/inbound-messages] are mapped on the Worker, which serves the BRP webhook and its own
  health endpoints and nothing else.
```

⚠ **Mutate the case the assertion is actually for.** Repeat with an unprefixed route —
`app.MapGet("/replay", () => Results.Ok());` — and check that this time **only**
`Every_route_on_the_worker_is_a_health_endpoint_or_the_webhook` goes red and
`The_worker_exposes_no_versioned_API_route` stays green. Two assertions that always fail together
are one assertion; this is the run that shows they are two.

Remove both lines and re-run: PASS — 4 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj \
        tests/PeakPower.Integration.Tests/Hosts/WorkerHostTests.cs
git commit -m "test(worker): the Worker boots, answers /health, and has no /api/v1 route

Contract section 9.1 puts POST /webhooks/brp/{brpCode} outside the versioned API surface: no
session, a per-BRP shared-secret header, served by this host and nothing else. Task 5's Program.cs
said that was a fact about the endpoint table rather than a convention; this is the assertion that
makes the sentence true, written before plan 3 maps the first route rather than around it.

The exposure it guards is specific. This host connects as the database owner and is exempt from
row-level security by design (design section 4.3), because it writes across every tenant and
serves nothing to a customer - so a convenience read mapped here has nothing underneath it, where
the same mistake on either API still meets a policy that filters the rows.

Mutation-verified twice, because the two assertions overlap and had to be shown not to be one:
mapping /api/v1/inbound-messages turns both red, and mapping /replay turns only the second red."
```

---

### Task 14: The Worker in the AppHost — its credential, its raw-payload volume, and `DeclareNamedVolumes`

The Worker exists, boots and is tested. It is in no graph: `./dev-up` does not start it, and
`aspire publish` writes no service for it, so the deployed stack that design §7.2 measures the
whole slice through has no webhook at all. This task registers it.

Four decisions come with the registration, and each is a value two files have to agree on:

1. **The Worker's HTTP endpoint is external.** `PublishedStackTests.The_two_APIs_are_the_only_public_HTTP_surface`
   pins the public surface as exactly `["customer-api", "employee-api"]`. Design §3.1 runs DevStubs
   *"from a developer machine against the deployed webhook"* and design §7.2 measures the slice
   through `POST /webhooks/brp/PVNED` on the deployed stack, so the Worker's port has to be
   published and that pinned literal moves in this same commit, with its comment rewritten. This is
   the third ambiguity the scope section above says this plan resolves.
2. **The credential.** Contract §9.3: `metering.brp.credential_ref` holds the **name of an
   environment variable**, and for the seeded row that name is the literal `BRP_CREDENTIAL_PVNED`.
   The AppHost is what puts a value behind that name — pinned in development, asked for in a
   deployment, and **refused when empty**, which is what §9.3 asks `env.example` to say.
3. **The raw-payload volume.** Contract §7.3: `FilesystemRawPayloadStore` writes to a named Docker
   volume mounted at `RAW_PAYLOAD_ROOT`, default `/var/lib/peakpower/raw-payloads`. Without a
   volume that directory is the container's writable layer, so every redeploy destroys every stored
   payload — and `[F02-R27]`'s replay, which reads them back, then answers 500 for every message
   received before the last deployment. Nothing about that looks wrong until somebody replays.
4. **`DeclareSigningKeyVolumes` becomes `DeclareNamedVolumes`.** Compose refuses a project whose
   service mounts a named volume the file does not declare, and the declaration is read off the
   model rather than from a list precisely so a second kind of volume cannot be forgotten. A method
   that reads only `SigningKeyVolumeAnnotation` would have declared the two key volumes and silently
   not the payload one.

⚠ **The Worker's published HOST port is a fact of the generated file, not of this plan.** It is
pinned here for the reason the two APIs' ports are pinned — the same URL every run — and plan 8
still reads it with `docker compose port worker 8080` rather than assuming it, because
`docker compose port` is the only statement of it that cannot be stale. Do not copy `5103` into a
runbook.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj:38` — a fourth `<ProjectReference>` after it
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost/RawPayloads.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost/DeploymentParameters.cs:135` — two constants after it
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost/ComposeRuntime.cs:196-231` (`WithPersistentSigningKey`'s parameter doc), `:479-508` (`DeclareSigningKeyVolumes`), `:511-520` (`SigningKeyVolumeAnnotation`)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost/Program.cs:50` and `:509-510`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests/PublishedComposeService.cs:65-83`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests/ComposeRuntimeTests.cs:163-165`, `:191-192`, `:222-247`, `:274-276`, `:303-305`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests/ResourceGraphTests.cs:43-64`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests/RunModeIsUntouchedTests.cs:71-94` and `:138-151`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests/PublishedStackTests.cs:204-233`, `:247-262`, `:346`, `:400-403`, `:559-561`
- Test: `tests/PeakPower.AppHost.Tests` — `ComposeRuntimeTests`, `ResourceGraphTests`,
  `RunModeIsUntouchedTests`, `PublishedStackTests`

**Interfaces:**
- Consumes: `ImageBuild.BuiltFromSource` · `ComposeRuntime.ReadyBeforeDependentsStart` /
  `WaitsForHealthy` / `RefusesToStartWhenEmpty` / `DefaultsTo` / `TrustsOnlyNamedProxies` ·
  `DeploymentParameters.PinnedInDevelopment` / `Unset` — all slice 1's, unchanged.
- Produces:
  - `RawPayloads.VolumeName` = `"peakpower-raw-payloads"`,
    `RawPayloads.ContainerPath` = `"/var/lib/peakpower/raw-payloads"`,
    `RawPayloads.RootEnvironmentVariable` = `"RAW_PAYLOAD_ROOT"`
  - `DeploymentParameters.BrpCredentialPvned` = `"brp-credential-pvned"`,
    `DeploymentParameters.RawPayloadRoot` = `"raw-payload-root"`
  - `ComposeRuntime.WithRawPayloadVolume<T>(this IResourceBuilder<T>)` ·
    `ComposeRuntime.DeclareNamedVolumes(IDistributedApplicationBuilder, ComposeFile)` ·
    `INamedComposeVolumeAnnotation` with `RawPayloadVolumeAnnotation` beside
    `SigningKeyVolumeAnnotation`
  - a `worker` resource in both graphs, external on host port **5103** → container **8080**
- ⚠ Consumed by plan 3: `RAW_PAYLOAD_ROOT` must resolve to the mount point this task creates, and
  `RawPayloadStoreOptions.DefaultRoot` must be `RawPayloads.ContainerPath` character for character.
  Task 16 is where that is asserted.

- [ ] **Step 1: Write the failing test — the public surface gains the Worker**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests/PublishedStackTests.cs`.

Replace lines 204-214 (the doc comment on `The_two_APIs_are_the_only_public_HTTP_surface`) and the
method name and expectation, so that lines 204-233 read:

```csharp
    /// <summary>
    /// A dev server is never the production server — <c>[DEC-135]</c>. Neither portal is external,
    /// and the three hosts that are, are the two APIs and the BRP webhook.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Both portals used to be <c>WithExternalHttpEndpoints()</c>, which was right while the
    /// browser talked to <c>ng serve</c> on 4200 and is wrong now that the API owns the public
    /// origin. Asserted as a set over the whole graph rather than per resource: the question is
    /// "which resources are the public surface", and a list is the only form of that question a
    /// newly-added resource cannot slip past.
    /// </para>
    /// <para>
    /// <b><c>worker</c> is the third, and it is a deliberate widening rather than a leak.</b>
    /// Shared contract §9.1 serves <c>POST /webhooks/brp/{brpCode}</c> from that host and from
    /// nothing else, design §3.1 runs <c>PeakPower.DevStubs</c> from a developer machine against
    /// the DEPLOYED webhook, and design §7.2 measures this whole slice through
    /// <c>POST /webhooks/brp/PVNED</c> on the deployed stack — a webhook nobody outside the host
    /// can reach is not a webhook. What keeps that safe is not this list: it is the per-BRP
    /// credential (§9.2), the 401 that an unknown BRP code also answers so the route cannot be
    /// used to enumerate them (§9.4), and <c>WorkerHostTests</c>, which pins that this host serves
    /// no <c>/api/v1</c> route at all.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task The_two_APIs_and_the_webhook_are_the_only_public_HTTP_surface()
    {
        var builder = await PublishGraphAsync(TestContext.Current.CancellationToken);
        Assert.SkipWhen(builder is null, "no peakpower-web checkout; the portals are not in the graph");

        var external = builder!.Resources
            .Where(resource => resource.Annotations.OfType<EndpointAnnotation>()
                .Any(endpoint => endpoint.IsExternal))
            .Select(resource => resource.Name)
            .Order(StringComparer.Ordinal)
            .ToArray();

        external.ShouldBe(
            ["customer-api", "employee-api", "worker"],
            "after [DEC-136] each API serves its own portal from its own origin and the Worker "
            + "serves the BRP webhook; these three are the whole public surface, and anything "
            + "else here is an ingress point for a resource that serves nothing");
    }
```

Then, in the same file:

- line 249 (`[InlineData("employee-api")]` under
  `Each_APIs_container_port_is_a_literal_in_the_published_file`) — add a third row after it:

  ```csharp
    [InlineData("worker")]
  ```

  and replace the interpolated port in that test's failure message, currently

  ```csharp
                + $"`ports: - \"{(apiName == "customer-api" ? 5101 : 5102)}:\"` is not a port mapping");
  ```

  with a form that covers three hosts rather than two:

  ```csharp
                + $"`ports: - \"{PinnedHostPort(apiName)}:\"` is not a port mapping");
  ```

  and add, immediately below that method's closing brace:

  ```csharp
    /// <summary>The host port each published host is pinned to, for the message above only.</summary>
    /// <remarks>
    /// Not an assertion. The host half of the mapping is the generated file's business and plan 8
    /// reads it with <c>docker compose port worker 8080</c> rather than assuming one; this is here
    /// so the failure message quotes the mapping the reader will actually go and look at.
    /// </remarks>
    private static int PinnedHostPort(string resourceName) => resourceName switch
    {
        "customer-api" => 5101,
        "employee-api" => 5102,
        _ => 5103,
    };
  ```

- line 346 — add `"worker"` to the required-resources list, so the credential sweep cannot pass by
  having stopped looking at the host that holds a credential:

  ```csharp
        foreach (var required in new[]
                 { "postgres", "migrator", "customer-api", "employee-api", "worker" })
  ```

- line 403 (`[InlineData("employee-api", "ASPNETCORE_ENVIRONMENT")]`) — add after it:

  ```csharp
    [InlineData("worker", "ASPNETCORE_ENVIRONMENT")]
  ```

- line 561 (`[InlineData("employee-api")]` under
  `Each_api_is_told_which_proxy_to_trust_and_starts_out_trusting_none`) — add after it:

  ```csharp
    [InlineData("worker")]
  ```

  ⚠ This one is not symmetry. `[F02-R03]` stores the **source IP** with every payload, and the
  Worker publishes a port onto `0.0.0.0` exactly as the two APIs do — so it needs the same named-
  proxy treatment, and for the same reason: `ASPNETCORE_FORWARDEDHEADERS_ENABLED`, which Aspire
  sets on every project with an external endpoint, believes `X-Forwarded-For` from any caller at
  all. A recorded source IP a caller chose is worse than none.

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.AppHost.Tests --nologo
```

Expected: **FAIL** — five, and they name the missing resource rather than a wrong value:

```
The_two_APIs_and_the_webhook_are_the_only_public_HTTP_surface [FAIL]
  should be ["customer-api", "employee-api", "worker"] but was ["customer-api", "employee-api"]

Each_APIs_container_port_is_a_literal_in_the_published_file(apiName: "worker") [FAIL]
  System.InvalidOperationException : Sequence contains no matching element

No_published_resource_carries_a_development_password [FAIL]
  should contain "worker"

No_published_host_is_told_it_is_in_development(resourceName: "worker", …) [FAIL]
  System.InvalidOperationException : Sequence contains no matching element

Each_api_is_told_which_proxy_to_trust_and_starts_out_trusting_none(resourceName: "worker") [FAIL]
  System.InvalidOperationException : Sequence contains no matching element
```

⚠ These run only with a `peakpower-web` checkout beside this one; without it they SKIP, and
`tools/verify-no-unexpected-skips.sh` (task 1) is what refuses that. If they skip, fix the checkout
before continuing — a skipped test is green and this whole task would appear to be done.

- [ ] **Step 3: Name the volume and the path once**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost/RawPayloads.cs`:

```csharp
namespace PeakPower.AppHost;

/// <summary>
/// Where the Worker keeps the raw BRP payloads it has been posted, named once because four things
/// have to agree on it.
/// </summary>
/// <remarks>
/// <para>
/// The four are: the Compose volume declared on the file, the mount target on the <c>worker</c>
/// service, the <c>RAW_PAYLOAD_ROOT</c> the host reads, and — in a different assembly this one
/// cannot see — <c>PeakPower.Ingestion.Storage.RawPayloadStoreOptions.DefaultRoot</c>, which is
/// the value <c>FilesystemRawPayloadStore</c> falls back to. Shared contract §7.3 fixes that
/// string as <c>/var/lib/peakpower/raw-payloads</c>, and <see cref="ContainerPath"/> is the same
/// string, character for character. <c>CommittedComposeFileTests</c> asserts it.
/// </para>
/// <para>
/// <b>What a disagreement costs, and why it is silent.</b> The store creates its root if it is not
/// there, so a mount one directory off does not fail: the Worker writes into the container's
/// WRITABLE LAYER, every POST answers 200, every <c>inbound_message</c> row carries a
/// <c>payload_uri</c>, and the volume beside it stays empty. The next <c>docker compose up</c>
/// recreates the container and every one of those payloads is gone — and <c>[F02-R27]</c>'s
/// replay, which is the only thing that reads them back, then answers 500 for every message
/// received before the last deployment. Nothing about the running stack looks wrong until somebody
/// replays.
/// </para>
/// <para>
/// <b>Not the same shape as the signing-key volumes, deliberately.</b> Those mount
/// <c>/app/.local</c> — inside the image's working directory, because the host resolves its key
/// path against the content root. This one is an absolute path outside <c>/app</c>: the payload
/// store is not part of the application's own directory, it is the durable half of
/// <c>[F02-R03]</c>, and putting it under the content root would make "the code directory" and
/// "the data directory" the same directory in an image that is rebuilt on every deploy.
/// </para>
/// </remarks>
public static class RawPayloads
{
    /// <summary>
    /// The Compose volume name. Namespaced by the Compose project name (<c>peakpower</c>) the
    /// same way <c>peakpower-postgres-data</c> is, so a developer's deployed stack and
    /// <c>./dev-up</c> cannot meet in one volume.
    /// </summary>
    public const string VolumeName = "peakpower-raw-payloads";

    /// <summary>
    /// Where that volume is mounted inside the <c>worker</c> container, and the default
    /// <c>RAW_PAYLOAD_ROOT</c>.
    /// </summary>
    /// <remarks>
    /// ⚠ <b>Shared contract §7.3, character for character.</b> The other end of this string is
    /// <c>PeakPower.Ingestion.Storage.RawPayloadStoreOptions.DefaultRoot</c>, in an assembly the
    /// Aspire SDK does not make visible from here — it references projects for <c>Projects.*</c>
    /// code generation and not for compilation, the same reason
    /// <c>ForwardedHeaders__KnownProxies</c> is spelled out in <c>Program.cs</c>.
    /// <c>CommittedComposeFileTests</c> is where the two spellings are compared.
    /// </remarks>
    public const string ContainerPath = "/var/lib/peakpower/raw-payloads";

    /// <summary>
    /// The environment variable the Worker reads the root from —
    /// <c>RawPayloadStoreOptions.RootEnvironmentVariable</c> at the other end.
    /// </summary>
    /// <remarks>
    /// It is a parameter with a Compose-side default rather than a literal, so that
    /// <c>env.example</c> can carry a line for it: an operator moving the payload root onto
    /// another disk is a plausible thing to want, and the alternative — a value burned into the
    /// generated file — makes it an edit to a generated artefact. The default is
    /// <see cref="ContainerPath"/>, so the ordinary <c>.env</c> line stays empty.
    /// </remarks>
    public const string RootEnvironmentVariable = "RAW_PAYLOAD_ROOT";

    /// <summary>
    /// Where <c>./dev-up</c> puts them instead: <c>.local/raw-payloads</c> beside the AppHost.
    /// </summary>
    /// <remarks>
    /// <see cref="ContainerPath"/> is not writable on a developer's machine and must not be
    /// created there. <c>.local/</c> is already this repository's gitignored per-host scratch
    /// directory — it is where both API hosts write their signing keys — so a raw payload written
    /// by a local DevStubs run lands somewhere already understood to be disposable and already
    /// impossible to commit.
    /// </remarks>
    public static string DevelopmentRoot(string appHostDirectory) =>
        Path.Combine(appHostDirectory, ".local", "raw-payloads");
}
```

- [ ] **Step 4: Add the two deployment parameters**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost/DeploymentParameters.cs`
and insert after line 135 (the closing `;` of `SeedStaffAccounts`):

```csharp

    /// <summary>
    /// The shared secret PVNed presents on <c>X-PeakPower-Brp-Credential</c>, as the environment
    /// variable <c>BRP_CREDENTIAL_PVNED</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The variable's NAME is data in the database.</b> Shared contract §9.3:
    /// <c>metering.brp.credential_ref</c> holds the name of an environment variable and never a
    /// secret, and for the seeded PVNed row that name is the literal <c>BRP_CREDENTIAL_PVNED</c>.
    /// The Worker reads <c>Environment.GetEnvironmentVariable(brp.CredentialRef)</c> at request
    /// time, so this parameter's Aspire name has to upper-case into exactly that string —
    /// <c>brp-credential-pvned</c> becomes <c>BRP_CREDENTIAL_PVNED</c>, which is the same
    /// transformation <see cref="StaffPassword"/> relies on and the same trap.
    /// </para>
    /// <para>
    /// <b>Pinned in development, because DevStubs authenticates with it.</b> The generator runs
    /// from a developer machine and presents the same value the Worker reads (contract §13); a
    /// developer with no credential configured would meet a 401 that is byte-identical to the one
    /// for a wrong one. Visibly <c>dev_only_</c>, like every other pinned literal here, and absent
    /// from anything published.
    /// </para>
    /// <para>
    /// <b>Refused when empty in a deployment.</b> The Worker's own check fails CLOSED — contract
    /// §9.3, an empty or absent value means every request to that BRP's route is 401, never "no
    /// credential required" — and that is the right behaviour for a host that has somehow started
    /// without one. It is the wrong thing to discover after a deploy: the symptom is a webhook
    /// that answers 401 to the real BRP, which is indistinguishable from a rotated secret. So
    /// <c>ComposeRuntime.RefusesToStartWhenEmpty</c> stops <c>docker compose up</c> before a
    /// container exists, naming the line.
    /// </para>
    /// </remarks>
    public const string BrpCredentialPvned = "brp-credential-pvned";

    /// <summary>
    /// Where the Worker writes raw BRP payloads, as <c>RAW_PAYLOAD_ROOT</c>. Empty means
    /// <see cref="RawPayloads.ContainerPath"/>, which is where the named volume is mounted.
    /// </summary>
    /// <remarks>
    /// Not secret, like <see cref="TrustedProxies"/>: it is a path an operator is meant to read
    /// back out of their own <c>.env</c>. It exists as a parameter rather than as a literal in the
    /// generated file so that <c>env.example</c> may carry a line for it — moving the payload root
    /// onto a larger disk is a plausible thing to want, and the alternative is hand-editing a
    /// generated artefact, which the next <c>aspire publish</c> discards.
    /// <para>
    /// ⚠ Changing it WITHOUT moving the volume mount alongside it puts the payloads in the
    /// container's writable layer, where the next deploy destroys them silently. The
    /// <c>env.example</c> line says so.
    /// </para>
    /// </remarks>
    public const string RawPayloadRoot = "raw-payload-root";
```

- [ ] **Step 5: Generalise the volume declaration and add the raw-payload mount**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost/ComposeRuntime.cs`.

First, in `WithPersistentSigningKey`'s `volumeName` parameter documentation (lines 196-201),
replace the single reference to the old method name:

```csharp
    /// <param name="volumeName">
    /// The Compose volume name. <see cref="DeclareNamedVolumes"/> is what puts it in the
    /// file's own top-level <c>volumes:</c> section, which Compose requires for any named volume a
    /// service mounts — a mount naming a volume the file does not declare is a hard error at
    /// <c>docker compose up</c>, not a warning.
    /// </param>
```

Second, replace lines 479-520 — `DeclareSigningKeyVolumes` and the annotation record — in full
with:

```csharp
    /// <summary>
    /// Mounts <see cref="RawPayloads.VolumeName"/> at <see cref="RawPayloads.ContainerPath"/>, so
    /// the raw payloads <c>[F02-R03]</c> makes durable survive the container that received them.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The failure without it is silent for as long as nobody replays.</b>
    /// <c>FilesystemRawPayloadStore</c> creates its root if it is missing, so an unmounted path is
    /// not an error: the Worker writes into the container's writable layer, every POST answers
    /// 200, and every <c>inbound_message</c> row carries a <c>payload_uri</c> that resolves — until
    /// the next <c>docker compose up</c> recreates the container. Then <c>[F02-R27]</c>'s replay,
    /// the only reader of those files, answers 500 for every message received before the last
    /// deployment, and the row it cannot read looks exactly like the rows it can.
    /// </para>
    /// <para>
    /// <b>Publish mode only</b>, like every sibling here. In run mode the Worker writes to
    /// <see cref="RawPayloads.DevelopmentRoot"/> under the checkout, which is a directory on the
    /// developer's disk and not a volume anything creates.
    /// </para>
    /// </remarks>
    public static IResourceBuilder<T> WithRawPayloadVolume<T>(this IResourceBuilder<T> builder)
        where T : IComputeResource
    {
        ArgumentNullException.ThrowIfNull(builder);

        if (!builder.ApplicationBuilder.ExecutionContext.IsPublishMode)
        {
            return builder;
        }

        builder.WithAnnotation(new RawPayloadVolumeAnnotation(RawPayloads.VolumeName));

        return builder.PublishAsDockerComposeService((_, service) =>
        {
            service.Restart = "unless-stopped";

            service.AddVolume(new Volume
            {
                Name = RawPayloads.VolumeName,
                Type = "volume",
                Source = RawPayloads.VolumeName,
                Target = RawPayloads.ContainerPath,
                ReadOnly = false,
            });
        });
    }

    /// <summary>
    /// Declares every named volume any resource in the graph mounts, in the Compose file's own
    /// top-level <c>volumes:</c> section.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Read off the model rather than from a list, for the same reason
    /// <see cref="ImageBuild.ImageVariablesBuiltFromSource"/> is: a mount and a declaration written
    /// in two places drift, and the symptom is a stack that refuses to start with
    /// <c>service "customer-api" refers to undefined volume customer-api-keys</c>.
    /// </para>
    /// <para>
    /// <b>It reads the INTERFACE and not either record, which is the whole of the rename.</b> This
    /// was <c>DeclareSigningKeyVolumes</c> and read <c>SigningKeyVolumeAnnotation</c> alone. A
    /// second kind of volume — the Worker's raw-payload store — would then have been mounted and
    /// not declared, and Compose refuses the whole project for it. Widening the annotation to an
    /// interface makes "is this a named volume somebody mounts" a question about the model rather
    /// than about which record was remembered here.
    /// </para>
    /// </remarks>
    public static void DeclareNamedVolumes(
        IDistributedApplicationBuilder builder, ComposeFile composeFile)
    {
        ArgumentNullException.ThrowIfNull(builder);
        ArgumentNullException.ThrowIfNull(composeFile);

        var volumeNames = builder.Resources
            .SelectMany(resource => resource.Annotations.OfType<INamedComposeVolumeAnnotation>())
            .Select(annotation => annotation.VolumeName)
            .Distinct(StringComparer.Ordinal);

        foreach (var volumeName in volumeNames)
        {
            composeFile.AddVolume(new Volume
            {
                Name = volumeName,
                Driver = "local",
            });
        }
    }
}

/// <summary>
/// Marks a resource whose Compose service mounts a named volume, and names that volume.
/// </summary>
/// <remarks>
/// On the resource rather than in a static list so that the mount and the file-level declaration
/// are read from one place — see <see cref="ComposeRuntime.DeclareNamedVolumes"/>. An interface
/// rather than one record because the two kinds of volume in this stack mount for unrelated
/// reasons and at unrelated paths, and only the declaration is common to them.
/// </remarks>
public interface INamedComposeVolumeAnnotation : IResourceAnnotation
{
    /// <summary>The Compose volume name, mounted and declared.</summary>
    string VolumeName { get; }
}

/// <summary>
/// Marks a resource whose Compose service mounts a named volume on the directory its host writes
/// its signing key to. See <see cref="ComposeRuntime.WithPersistentSigningKey"/>.
/// </summary>
/// <param name="VolumeName">The Compose volume name, mounted and declared.</param>
public sealed record SigningKeyVolumeAnnotation(string VolumeName) : INamedComposeVolumeAnnotation;

/// <summary>
/// Marks the resource whose Compose service mounts the raw BRP payload store. See
/// <see cref="ComposeRuntime.WithRawPayloadVolume"/>.
/// </summary>
/// <param name="VolumeName">The Compose volume name, mounted and declared.</param>
public sealed record RawPayloadVolumeAnnotation(string VolumeName) : INamedComposeVolumeAnnotation;
```

- [ ] **Step 6: Register the Worker in the AppHost**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj`
and insert after line 38 (`<ProjectReference Include="../PeakPower.Migrator/…" />`):

```xml
    <!--
      The Worker, so the Aspire SDK generates Projects.PeakPower_Worker for Program.cs. Referenced
      for code generation only, like the three above: nothing in this project compiles against the
      Worker's own types, which is why RAW_PAYLOAD_ROOT and BRP_CREDENTIAL_PVNED are spelled out
      as literals there rather than read from the constants that define them.
    -->
    <ProjectReference Include="../PeakPower.Worker/PeakPower.Worker.csproj" />
```

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.AppHost/Program.cs`.

Line 48-50, replace

```csharp
        // The two signing-key volumes the APIs mount below. Compose requires a named volume to be
        // declared here before a service may mount it; see ComposeRuntime.
        ComposeRuntime.DeclareSigningKeyVolumes(builder, composeFile);
```

with

```csharp
        // Every named volume a service below mounts - the two signing keys and the Worker's raw
        // payload store. Compose requires a named volume to be declared here before a service may
        // mount it, and this reads them off the model rather than from a list; see ComposeRuntime.
        ComposeRuntime.DeclareNamedVolumes(builder, composeFile);
```

Then insert the whole Worker registration between line 509 (`}`, closing the employee API's
publish-mode `else`) and line 511 (`var frontEnds = FrontEndPlan.Decide(`):

```csharp

// -------------------------------------------------------------------------------------------
// THE WORKER: the BRP webhook and the job server behind it.
//
// PUBLIC, WHICH IS A WIDENING AND NOT AN OVERSIGHT. Until this resource the deployed stack had
// exactly two ingress points and PublishedStackTests pinned the pair. Shared contract section 9.1
// serves POST /webhooks/brp/{brpCode} from this host and from nothing else; design section 3.1
// runs PeakPower.DevStubs from a developer machine against the DEPLOYED webhook, and design
// section 7.2 measures this whole slice through POST /webhooks/brp/PVNED on the deployed stack. A
// webhook nobody outside the host can reach is not a webhook.
//
// What keeps it safe is not this file. It is the per-BRP shared-secret header (contract 9.2)
// compared with FixedTimeEquals, the 401 that an unknown BRP code also answers so the route cannot
// be used to enumerate which BRPs exist (9.4), the 25 MiB cap (9.4), and WorkerHostTests, which
// pins that this host serves no /api/v1 route at all - it connects as the database owner and is
// exempt from row-level security by design (design section 4.3), which is safe exactly as long as
// that stays true.
//
// THE HOST PORT IS PINNED HERE AND READ AT RUN TIME THERE. 5103 for the reason 5101 and 5102 are
// pinned: the same URL every run. Plan 8 still asks the running stack with
// `docker compose port worker 8080` rather than assuming it, because that is the only statement of
// the mapping that cannot be stale - so nothing downstream carries the literal.
// -------------------------------------------------------------------------------------------
var worker = builder.AddProject<Projects.PeakPower_Worker>("worker")
    .WithReference(peakpowerDb)
    // WaitForCompletion and not WaitFor: this host writes inbound_message on the first POST it
    // receives, and a table that migration 9 has not created yet is a 500 on a request the BRP
    // will redeliver. The same reasoning as both APIs, one table earlier.
    .WaitForCompletion(migrator)
    .WithHttpEndpoint(port: 5103, targetPort: apiContainerPort)
    .WithExternalHttpEndpoints()
    // [DEC-135]: built on the server from deploy/Dockerfile's `worker` stage. See ImageBuild.
    .BuiltFromSource("worker")
    // [F02-R03]: the payload is durable BEFORE the 200 is written, and durable has to mean it
    // outlives the container that received it. See ComposeRuntime.
    .WithRawPayloadVolume()
    // As on both APIs, and here it is [F02-R03]'s source IP rather than a sign-in throttle that
    // depends on it: ASPNETCORE_FORWARDEDHEADERS_ENABLED trusts X-Forwarded-For from any caller,
    // and a recorded source address the caller chose is worse than none.
    .TrustsOnlyNamedProxies();

// The shared secret PVNed presents, under the variable NAME the BRP row itself carries -
// contract 9.3: metering.brp.credential_ref holds the name of an environment variable and never a
// secret, and for the seeded row that name is the literal BRP_CREDENTIAL_PVNED. The literal is
// spelled here rather than read from PeakPower.Ingestion, for the reason
// ForwardedHeaders__KnownProxies is: the Aspire SDK references projects for `Projects.*` code
// generation and not for compilation.
//
// Pinned in development because DevStubs authenticates with the same value from its own
// environment; empty in a published .env, and refused there rather than started on - see below.
worker = worker.WithEnvironment(
    "BRP_CREDENTIAL_PVNED",
    builder.PinnedInDevelopment(
        DeploymentParameters.BrpCredentialPvned, "dev_only_brp_credential_pvned"));

if (builder.ExecutionContext.IsRunMode)
{
    // The same reason the other three hosts get this in run mode: Aspire launches projects with
    // --no-launch-profile, so nothing sets ASPNETCORE_ENVIRONMENT and .NET defaults to Production.
    // Leaving one process of five silently in Production is how a developer meets a
    // production-only behaviour by accident. Run mode only, for the mirror of that reason.
    worker = worker.WithEnvironment("ASPNETCORE_ENVIRONMENT", "Development");

    // RawPayloads.ContainerPath is not writable on a developer's machine and must not be created
    // there. .local/ under this AppHost is already this repository's gitignored per-host scratch
    // directory - it is where both API hosts write their signing keys - so a payload written by a
    // local DevStubs run lands somewhere disposable and impossible to commit.
    worker = worker.WithEnvironment(
        RawPayloads.RootEnvironmentVariable,
        RawPayloads.DevelopmentRoot(builder.AppHostDirectory));
}
else
{
    // The customer API's counterpart, and the same reasoning: empty is the safe state, and a
    // deployment behind a reverse proxy names that proxy here rather than trusting everybody.
    worker = worker.WithEnvironment("ForwardedHeaders__KnownProxies", trustedProxies!);

    // Where the payloads go, as a parameter with a Compose-side default rather than as a literal
    // in the generated file - so env.example can carry a line for it. Moving the payload root onto
    // a larger disk is a plausible thing to want, and the alternative is hand-editing a generated
    // artefact that the next `aspire publish` discards.
    worker = worker.WithEnvironment(
        RawPayloads.RootEnvironmentVariable,
        builder.Unset(DeploymentParameters.RawPayloadRoot, secret: false)!);

    // ...and the default, which is the half an operator never has to type: the mount point the
    // volume above is attached at. `:-` and not `-`, for the reason DefaultsTo's own remarks give
    // - `cp env.example .env` leaves the line PRESENT AND EMPTY, which a bare `-` does not cover,
    // and an empty RAW_PAYLOAD_ROOT would make the store fall back to its own default. Here those
    // two happen to be the same string, which is exactly why the wrong operator could not tell:
    // the pair is written so the file states the value rather than relying on an agreement between
    // two assemblies that cannot see each other.
    worker = worker.DefaultsTo(RawPayloads.RootEnvironmentVariable, RawPayloads.ContainerPath);

    // AN EMPTY CREDENTIAL IS NOT AN ABSENT ONE. The Worker's own check fails CLOSED - contract 9.3
    // makes an empty or missing value mean 401 for every request to that BRP's route, never "no
    // credential required" - and that is right for a host that has somehow started without one.
    // It is the wrong thing to find out after a deploy: the symptom is a webhook answering 401 to
    // the real BRP, which is byte-identical to a rotated secret nobody was told about. Compose
    // interpolation runs before any container exists, so this refuses instead.
    worker = worker.RefusesToStartWhenEmpty(
        "BRP_CREDENTIAL_PVNED",
        "BRP_CREDENTIAL_PVNED is empty in .env. It is the shared secret PVNed presents on the "
        + "X-PeakPower-Brp-Credential header, and the metering.brp row for PVNED names this exact "
        + "variable in its credential_ref column - the database holds the NAME, never the secret. "
        + "Left empty the Worker fails closed and answers 401 to every POST on "
        + "/webhooks/brp/PVNED, which looks exactly like a rotated secret. Choose a long random "
        + "value and give the same one to whoever posts the documents.");
}
```

- [ ] **Step 7: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.AppHost.Tests --nologo
```

Expected: **FAIL to build**, once, on the two test files that still call the old method name:

```
tests/PeakPower.AppHost.Tests/ComposeRuntimeTests.cs(239,24): error CS0117:
  'ComposeRuntime' does not contain a definition for 'DeclareSigningKeyVolumes'
tests/PeakPower.AppHost.Tests/RunModeIsUntouchedTests.cs(147,24): error CS0117:
  'ComposeRuntime' does not contain a definition for 'DeclareSigningKeyVolumes'
```

That is the rename doing its job — a method read from two places cannot be renamed silently. The
next two steps move both call sites.

- [ ] **Step 8: Move the two `DeclareSigningKeyVolumes` call sites and widen what they assert**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests/ComposeRuntimeTests.cs`:

- line 165 (`[InlineData("employee-api")]` under
  `The_long_running_services_come_back_after_a_reboot`) — add after it:

  ```csharp
    [InlineData("worker")]
  ```

- lines 191-192 — leave `Each_API_keeps_its_signing_key_across_a_redeploy`'s two theory rows
  **alone**. A third row would be the obvious edit and it is the wrong one: that test asserts
  `ShouldHaveSingleItem` over the service's mounts and then compares them against `/app/.local`,
  and the Worker has no signing key and mounts a different path for a different reason. Add a
  separate fact instead, immediately after that method's closing brace (line 210):

  ```csharp
    /// <summary>
    /// The Worker's raw payloads outlive the container that received them.
    /// </summary>
    /// <remarks>
    /// <c>[F02-R03]</c> makes the payload durable BEFORE the 200 is written, and durable has to
    /// mean more than "written". Without this mount <c>FilesystemRawPayloadStore</c> creates its
    /// root inside the container's writable layer and every POST still answers 200 — and the next
    /// <c>docker compose up</c> destroys every stored payload, so <c>[F02-R27]</c>'s replay, the
    /// only reader of those files, answers 500 for every message received before the last deploy.
    /// The target is compared against <see cref="RawPayloads.ContainerPath"/>, which shared
    /// contract §7.3 also fixes as <c>RawPayloadStoreOptions.DefaultRoot</c>: a mount one
    /// directory away from where the store writes persists an empty directory.
    /// </remarks>
    [Fact]
    public async Task The_worker_keeps_its_raw_payloads_across_a_redeploy()
    {
        var builder = await PublishGraphAsync(TestContext.Current.CancellationToken);
        Assert.SkipWhen(builder is null, "no peakpower-web checkout; the portals are not in the graph");

        var mounted = PublishedService(builder!.Resources.Single(r => r.Name == "worker"))
            .Volumes
            .ShouldHaveSingleItem("the worker mounts exactly one volume, for the raw payload store");

        mounted.Source.ShouldBe(RawPayloads.VolumeName);
        mounted.Target.ShouldBe(
            RawPayloads.ContainerPath,
            "the store writes to RAW_PAYLOAD_ROOT, which defaults to this same path; a mount "
            + "anywhere else persists an empty directory while every payload still dies with the "
            + "container");
        mounted.ReadOnly.ShouldBe(false, "the host writes a file per received document");
    }
  ```

- line 239 — replace

  ```csharp
        ComposeRuntime.DeclareSigningKeyVolumes(builder, composeFile);
  ```

  with

  ```csharp
        ComposeRuntime.DeclareNamedVolumes(builder, composeFile);
  ```

  and, in the same test, replace the non-vacuity message on line 253-255 so it names what is
  actually expected now:

  ```csharp
        mounted.ShouldNotBeEmpty(
            "no service mounts anything, so this test is passing on an empty set - the two "
            + "signing-key volumes and the worker's raw-payload volume should be here");
  ```

- line 276 — add a fourth row to `An_empty_required_variable_stops_the_stack_before_it_starts`:

  ```csharp
    [InlineData("worker", "BRP_CREDENTIAL_PVNED", "BRP_CREDENTIAL_PVNED")]
  ```

- line 305 — the same fourth row on `The_refusal_says_what_to_put_in_the_variable`:

  ```csharp
    [InlineData("worker", "BRP_CREDENTIAL_PVNED", "BRP_CREDENTIAL_PVNED")]
  ```

- line 588 — add a third row to `No_api_trusts_a_forwarded_header_from_an_unnamed_caller`:

  ```csharp
    [InlineData("worker")]
  ```

- [ ] **Step 9: Generalise `RunModeIsUntouchedTests` to every named volume**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests/RunModeIsUntouchedTests.cs`.

Replace lines 71-94 (`No_resource_asks_for_a_signing_key_volume`) with:

```csharp
    /// <summary>
    /// No development-graph resource asks for a Docker volume of any kind.
    /// </summary>
    /// <remarks>
    /// <para>
    /// In run mode both API hosts write their signing key to <c>.local/</c> under the checkout and
    /// the Worker writes its raw payloads to <c>.local/raw-payloads</c> beside the AppHost — three
    /// directories on the developer's disk, and not volumes anything creates. The annotations are
    /// what <see cref="ComposeRuntime.DeclareNamedVolumes"/> reads, so a leak here would declare a
    /// volume on a published Compose file that no service mounts.
    /// </para>
    /// <para>
    /// Asserted over the INTERFACE rather than over either record, which is the half that would
    /// otherwise rot: a third kind of volume added with its own annotation type would be invisible
    /// to a test that named the two it knew about, and the guard it was written for is exactly the
    /// one nobody remembers to widen.
    /// </para>
    /// </remarks>
    [Fact]
    public async Task No_resource_asks_for_a_named_volume()
    {
        var builder = await RunGraphAsync(TestContext.Current.CancellationToken);

        var marked = builder.Resources
            .SelectMany(resource => resource.Annotations.OfType<INamedComposeVolumeAnnotation>())
            .Select(annotation => annotation.VolumeName)
            .Order(StringComparer.Ordinal)
            .ToArray();

        marked.ShouldBeEmpty(
            $"[{string.Join(", ", marked)}] are requested in RUN mode, where each of these is a "
            + "directory under the checkout and there is no container for a volume to be mounted "
            + "into");
    }
```

and, at line 147, replace

```csharp
        ComposeRuntime.DeclareSigningKeyVolumes(builder, composeFile);
```

with

```csharp
        ComposeRuntime.DeclareNamedVolumes(builder, composeFile);
```

Also update the class remarks at line 15 — `WithPersistentSigningKey` is no longer the only volume
method — by replacing lines 13-15:

```csharp
/// <see cref="ImageBuild.BuiltFromSource"/>, <see cref="ComposeRuntime.ReadyBeforeDependentsStart"/>,
/// <see cref="ComposeRuntime.WaitsForHealthy"/>, <see cref="ComposeRuntime.WithPersistentSigningKey"/>
/// and <see cref="ComposeRuntime.WithRawPayloadVolume"/> are all called unconditionally in
```

and line 26 (`this repository puts on its own resources`) by replacing
`<see cref="SigningKeyVolumeAnnotation"/>` with `<see cref="INamedComposeVolumeAnnotation"/>`.

- [ ] **Step 10: Seed the Worker's placeholders**

`ComposeRuntime.RefusesToStartWhenEmpty` and `DefaultsTo` both **throw** on a service that does not
carry the key they were asked to rewrite — `PublishedComposeService`'s own remarks record that this
once failed six tests about Dockerfile stages. The Worker now has two such keys.

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests/PublishedComposeService.cs`
and add a fourth arm to `PlaceholdersAspireWrites`, after line 81 (`"employee-api" => …`):

```csharp
            // Both of these are read off the service by a rewrite that throws when it is not
            // there - RefusesToStartWhenEmpty for the credential, DefaultsTo for the payload root -
            // so a worker service seeded without them fails every test in this suite that
            // publishes one, including the ones about Dockerfile stages.
            "worker" =>
            [
                ("BRP_CREDENTIAL_PVNED", "BRP_CREDENTIAL_PVNED"),
                (RawPayloads.RootEnvironmentVariable, RawPayloads.RootEnvironmentVariable),
            ],
```

- [ ] **Step 11: Pin the Worker into the shared-port test**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests/ResourceGraphTests.cs`
and replace lines 43-64 in full:

```csharp
    /// <summary>
    /// No two published hosts are pinned to the same host port.
    /// </summary>
    /// <remarks>
    /// A pinned, shared port is exactly what would recreate the original collision — two hosts,
    /// one port, and whichever finishes binding second dying of an <c>AddressInUseException</c>
    /// about a second after reaching "Running". Three hosts pin one each now (5101, 5102, 5103),
    /// so this is no longer the vacuous check it was while both were dynamic: it compares three
    /// values and a copy-pasted registration is what it is for.
    /// </remarks>
    [Fact]
    public async Task The_published_hosts_never_share_a_pinned_port()
    {
        var builder = await DistributedApplicationTestingBuilder
            .CreateAsync<Projects.PeakPower_AppHost>(["--backend-only"], TestContext.Current.CancellationToken);

        var pinnedPorts = new[] { "customer-api", "employee-api", "worker" }
            .Select(name => builder.Resources.Single(resource => resource.Name == name))
            .SelectMany(api => api.Annotations.OfType<EndpointAnnotation>())
            .Where(endpoint => endpoint.UriScheme == "http")
            .Select(endpoint => endpoint.Port)
            .Where(port => port is not null)
            .ToArray();

        pinnedPorts.Length.ShouldBe(
            3,
            "non-vacuity: with a host's port left dynamic this compares fewer values than there "
            + "are hosts and agrees with a collision between the two that remain");

        pinnedPorts.Distinct().Count().ShouldBe(pinnedPorts.Length);
    }
```

- [ ] **Step 12: Run the whole AppHost suite and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.AppHost.Tests --nologo
```

Expected: PASS, **zero skipped**. Then the run-mode half, which must be unchanged apart from the
new resource:

```bash
tools/verify-no-unexpected-skips.sh
```

Expected: `verify-no-unexpected-skips: OK`.

- [ ] **Step 13: Mutate the volume declaration and watch it go red**

The rename in step 5 is the change with the least visible failure mode, so it is the one to put to
a mutation. In `ComposeRuntime.DeclareNamedVolumes`, narrow the query back to the record it used to
read:

```csharp
            .SelectMany(resource => resource.Annotations.OfType<SigningKeyVolumeAnnotation>())
```

Run: `dotnet test tests/PeakPower.AppHost.Tests --nologo --filter "FullyQualifiedName~ComposeRuntimeTests"`

Expected: **FAIL**, one, and it names the volume rather than the method:

```
Every_mounted_volume_is_declared_on_the_file [FAIL]
  `peakpower-raw-payloads` is mounted by a service but declared nowhere; Compose refuses the
  whole project with `refers to undefined volume`
```

⚠ **That is the failure a `docker compose up` would have given, one step earlier.** The mutation
compiles, publishes, and produces a Compose file that is wrong in one line — which is why the
assertion is over the model rather than over the method name.

Restore the interface and re-run: PASS.

- [ ] **Step 14: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.AppHost/PeakPower.AppHost.csproj \
        src/Hosts/PeakPower.AppHost/Program.cs \
        src/Hosts/PeakPower.AppHost/ComposeRuntime.cs \
        src/Hosts/PeakPower.AppHost/DeploymentParameters.cs \
        src/Hosts/PeakPower.AppHost/RawPayloads.cs \
        tests/PeakPower.AppHost.Tests/ComposeRuntimeTests.cs \
        tests/PeakPower.AppHost.Tests/PublishedComposeService.cs \
        tests/PeakPower.AppHost.Tests/PublishedStackTests.cs \
        tests/PeakPower.AppHost.Tests/ResourceGraphTests.cs \
        tests/PeakPower.AppHost.Tests/RunModeIsUntouchedTests.cs
git commit -m "feat(apphost): register the Worker, its BRP credential and its raw-payload volume

The Worker existed and was in no graph, so the deployed stack design section 7.2 measures this
whole slice through had no webhook at all. It is now a resource in both modes: external on 5103
(container 8080), built from deploy/Dockerfile's worker stage, waiting on the migrator completing.

PUBLIC ON PURPOSE, and PublishedStackTests' pinned pair widens to three in this same commit.
Contract 9.1 serves POST /webhooks/brp/{brpCode} from this host and nothing else, and DevStubs runs
against the DEPLOYED webhook. What keeps it safe is the per-BRP credential, the 401 an unknown BRP
code also answers, and WorkerHostTests pinning that this host serves no /api/v1 route - it connects
as the database owner and is exempt from row-level security by design.

BRP_CREDENTIAL_PVNED is the variable NAME the seeded metering.brp row carries in credential_ref
(contract 9.3): the database holds the name and never the secret. Pinned dev_only_ in development
because DevStubs presents the same value; refused when empty in Compose, because the Worker's own
fail-closed 401 is right for a host already running and is indistinguishable, after a deploy, from
a rotated secret.

DeclareSigningKeyVolumes becomes DeclareNamedVolumes over an INamedComposeVolumeAnnotation
interface. Mutation-verified: narrowing it back to SigningKeyVolumeAnnotation leaves the build
green, publishes a file that mounts peakpower-raw-payloads without declaring it, and turns
Every_mounted_volume_is_declared_on_the_file red with the message docker compose up would have
given one step later."
```

---

### Task 15: The Worker's runtime stage in `deploy/Dockerfile`, and two new lines in `env.example`

The AppHost now publishes a `worker` service with `build.target: "worker"`. There is no such stage.
Docker reports that as `failed to solve: target stage "worker" could not be found` — **at the end
of the whole build**, on the machine trying to deploy, after the SDK restore, three publishes and
two `ng build`s have already run. `ImageBuildTests.Each_service_targets_a_stage_that_exists_in_the_Dockerfile`
exists to move that failure to a test, and it is about to fail, which is correct.

`env.example` is the operator's half. It is **hand-written and not generated** — its own header
says so — so the two new variables have to be written into it deliberately, and
`CommittedComposeFileTests.Env_example_offers_a_line_for_every_variable_the_file_reads` fails in
both directions until they are.

⚠ **The stage order in the Dockerfile is not cosmetic.** `ImageBuildTests.No_runtime_stage_starts_from_a_build_toolchain`
resolves stage aliases to their root image rather than reading the `FROM` line, precisely because
every runtime stage is written `FROM runtime-base` — so `worker` has to go on `runtime-base` like
its three siblings, and a stage accidentally written `FROM dotnet-source` would ship a C# compiler
on a public host and work perfectly.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/deploy/Dockerfile:11-31` (the shape table
  and the "three images" prose), `:94-97` (the shared restore), `:110-114` (after
  `build-employee-api`), `:234` (a fourth runtime stage after `employee-api`)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/deploy/env.example:6` and `:71` (a new
  section after the outbound block)
- Test: `tests/PeakPower.AppHost.Tests` — `ImageBuildTests`, and `CommittedComposeFileTests` in
  task 16 once the file is republished

**Interfaces:**
- Consumes: `RawPayloads.ContainerPath` (task 14) — as a literal in a Dockerfile, which cannot read
  a C# constant; `DeployDirectory.Stages()` and `RootImageOf` (slice 1's, unchanged).
- Produces: a `build-worker` build stage and a `worker` runtime stage in `deploy/Dockerfile`;
  `BRP_CREDENTIAL_PVNED=` and `RAW_PAYLOAD_ROOT=` in `deploy/env.example`.

- [ ] **Step 1: Write the failing test**

Nothing new has to be written: `ImageBuildTests` already reads the Dockerfile's declared stages and
compares them against the target each service names. What it does not yet do is ask that question
about the Worker, and three theory rows are the whole of it — added now, before the stage exists,
so the first run is red.

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests/ImageBuildTests.cs`:

- line 60 — add after `[InlineData("employee-api", "EMPLOYEE_API_IMAGE")]`:

  ```csharp
    [InlineData("worker", "WORKER_IMAGE")]
  ```

- line 94 — add after `[InlineData("employee-api")]` under
  `Each_service_targets_a_stage_that_exists_in_the_Dockerfile`:

  ```csharp
    [InlineData("worker")]
  ```

- line 136 — add after `[InlineData("employee-api")]` under
  `No_runtime_stage_starts_from_a_build_toolchain`:

  ```csharp
    [InlineData("worker")]
  ```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.AppHost.Tests --nologo --filter "FullyQualifiedName~ImageBuildTests"
```

Expected: **FAIL** — two of the three new rows, and the third passes for a reason worth reading:

```
Each_service_targets_a_stage_that_exists_in_the_Dockerfile(serviceName: "worker") [FAIL]
  worker targets a stage `worker` that deploy/Dockerfile does not declare; Docker reports that as
  `target stage "worker" could not be found` at the end of a build. Declared: [build-customer-api,
  build-customer-portal, build-employee-api, build-employee-portal, build-migrator, customer-api,
  dotnet-source, employee-api, migrator, runtime-base, web-deps, web-source]

No_runtime_stage_starts_from_a_build_toolchain(serviceName: "worker") [FAIL]
  worker targets a stage `worker` that deploy/Dockerfile does not declare, or one whose FROM chain
  is circular; Each_service_targets_a_stage_that_exists_in_the_Dockerfile is the test that says which
```

⚠ `Every_dotnet_service_is_built_from_source_rather_than_pulled(serviceName: "worker")` **passes
already** — task 14's `BuiltFromSource("worker")` is what it reads, and it says nothing about
whether the stage exists. That is the split these two tests exist for: one asks the model, one asks
the file.

- [ ] **Step 3: Add the fourth restore and the Worker's build stage**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/deploy/Dockerfile`.

Replace lines 94-97 (the shared restore) with:

```dockerfile
RUN --mount=type=cache,target=/root/.nuget/packages,sharing=locked \
    dotnet restore src/Hosts/PeakPower.Migrator/PeakPower.Migrator.csproj \
 && dotnet restore src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj \
 && dotnet restore src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj \
 && dotnet restore src/Hosts/PeakPower.Worker/PeakPower.Worker.csproj
```

and insert after line 114 (the end of the `build-employee-api` stage):

```dockerfile

# No -p:OpenApiGenerateDocumentsOnBuild=false here, unlike the two APIs above: the Worker declares
# no OpenAPI document (shared contract section 10.5 gives those to the customer and employee APIs
# alone), so there is no generation hook to turn off. If one ever appears, add the flag - the
# reason given for the two above applies unchanged.
FROM dotnet-source AS build-worker
RUN --mount=type=cache,target=/root/.nuget/packages,sharing=locked \
    dotnet publish src/Hosts/PeakPower.Worker/PeakPower.Worker.csproj \
        --no-restore --configuration Release --output /out
```

- [ ] **Step 4: Add the Worker's runtime stage**

Append after line 234 (the end of the `employee-api` stage), at the very bottom of the file:

```dockerfile

# The BRP webhook and the job server behind it. Same runtime-base as the other three - no SDK, no
# Node, and the libgssapi layer this host needs as much as they do, because it opens a Postgres
# connection on the first POST it receives.
#
# NO wwwroot, and that is the visible difference from the two APIs: this host serves no portal and
# no page at all. Shared contract section 9.1 gives it POST /webhooks/brp/{brpCode} and nothing
# else, and WorkerHostTests asserts that against the endpoint table.
FROM runtime-base AS worker
WORKDIR /app
COPY --from=build-worker /out ./
# RAW_PAYLOAD_ROOT's default, and PeakPower.AppHost.RawPayloads.ContainerPath - a literal here
# because a Dockerfile cannot read a C# constant, which is why CommittedComposeFileTests compares
# the two spellings against the generated compose file rather than trusting this line.
#
# Created here for the same reason /app/.local is on the two APIs: docker-compose.yaml puts a named
# volume on it, and a mount lands better on a directory that already exists. It is NOT what makes
# the payloads durable - FilesystemRawPayloadStore would create this path itself, inside the
# container's writable layer, and every POST would still answer 200 while every stored payload died
# with the container.
RUN mkdir -p /var/lib/peakpower/raw-payloads
EXPOSE 8080
ENTRYPOINT ["dotnet", "PeakPower.Worker.dll"]
```

- [ ] **Step 5: Update the file's own header, which now describes three images and builds four**

Replace lines 11-31 of `deploy/Dockerfile`:

```dockerfile
#   build stages                                    runtime stages (what actually ships)
#   ----------------------------------------------  -------------------------------------------
#   dotnet-source   sdk:10.0     the tree + restore  runtime-base  aspnet:10.0  + libgssapi
#   build-migrator  sdk:10.0     dotnet publish      migrator      runtime-base + the migrator
#   build-customer-api           dotnet publish      customer-api  runtime-base + the API + the
#   build-employee-api           dotnet publish                      customer portal's files
#   build-worker                 dotnet publish      employee-api  runtime-base + the API + the
#   web-deps        node:24      npm ci                              employee portal's files
#   web-source      node:24      the workspace       worker        runtime-base + the webhook host
#   build-customer-portal        ng build                            and no wwwroot at all
#   build-employee-portal        ng build
#
# `docker compose build` names one runtime stage per service through `build.target`, and BuildKit
# builds only the stages that target depends on. The four services share `dotnet-source`,
# `web-deps` and `runtime-base`, so the SDK tree is restored once, `npm ci` runs once for both
# portals, and the one apt-get runs once - rather than each of them once per image. The Worker
# needs neither portal, so `docker compose build worker` never enters the Node half of this file
# at all.
#
# ONE FILE FOR FOUR IMAGES, and not four files, for a reason that is not tidiness: the build
# context is unusual (below), and a context needs a `.dockerignore` that matches it. BuildKit
# reads `<dockerfile>.dockerignore` in preference to `<context>/.dockerignore` — so one Dockerfile
# means one Dockerfile.dockerignore, and four would mean four copies of the same exclusion list
# with nothing keeping them in step.
```

- [ ] **Step 6: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.AppHost.Tests --nologo --filter "FullyQualifiedName~ImageBuildTests"
```

Expected: PASS — 12 passed (four services × three theories, plus the two context facts), zero
skipped.

Then build the image for real, because a stage that a test can find is not a stage that Docker can
build:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform/..
docker build -f peakpower-platform/deploy/Dockerfile --target worker -t peakpower-worker-check .
docker run --rm --entrypoint sh peakpower-worker-check -c 'ls -d /var/lib/peakpower/raw-payloads && ls /app/PeakPower.Worker.dll && ! command -v dotnet-sdk'
docker image rm peakpower-worker-check
```

Expected: the build succeeds, and the three checks print the directory and the DLL path. ⚠ The
`docker build` is run from the **common parent** of the two checkouts, not from this repository —
that is `ImageBuild.Context`, and running it from anywhere else fails with
`failed to read dockerfile`.

- [ ] **Step 7: Mutate the runtime stage's base image and watch it go red**

The assertion with the quietest failure in this file is "the runtime stages carry a runtime and not
a toolchain": an image built `FROM` the SDK works perfectly and ships a compiler.

Temporarily change the new stage's first line from `FROM runtime-base AS worker` to
`FROM dotnet-source AS worker`.

Run: `dotnet test tests/PeakPower.AppHost.Tests --nologo --filter "FullyQualifiedName~ImageBuildTests"`

Expected: **FAIL**, exactly one:

```
No_runtime_stage_starts_from_a_build_toolchain(serviceName: "worker") [FAIL]
  the `worker` stage ships on the .NET SDK image, so the deployed host carries a C# compiler,
  MSBuild and NuGet - about 1.2 GB of toolchain against ~110 MB of runtime, on a machine
  [DEC-135] says needs no SDK at all
```

⚠ `Each_service_targets_a_stage_that_exists_in_the_Dockerfile` stays **green** under this mutation,
and that is the point: the stage exists, it is named correctly, and it is wrong. Restore
`FROM runtime-base AS worker` and re-run: PASS.

- [ ] **Step 8: Give the operator the two new lines**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/deploy/env.example`.

Line 6 currently reads `# empty. FOUR OF THEM STOP `docker compose up` DEAD, before a single
container is created, with a`. `BRP_CREDENTIAL_PVNED` is the fifth, so replace that word:

```
# empty. FIVE OF THEM STOP `docker compose up` DEAD, before a single container is created, with a
```

Then insert a new section after line 71 (`RESEND_FROM=`), before the `the network` heading:

```
# --------------------------------------------------------------------------- the BRP webhook
# The shared secret PVNed presents on the X-PeakPower-Brp-Credential header of every document it
# posts to /webhooks/brp/PVNED.
#
# THE DATABASE HOLDS THE NAME OF THIS VARIABLE, NEVER THE SECRET. metering.brp.credential_ref for
# the PVNED row is the literal string BRP_CREDENTIAL_PVNED, and the Worker looks that name up in
# its own environment at request time - so renaming this line renames it in one place only and the
# webhook then answers 401 to everybody. Rotating the value is an edit here and a message to
# whoever posts; changing the NAME is a database change.
# Empty: `docker compose up` refuses, naming BRP_CREDENTIAL_PVNED, and creates nothing. The Worker
# itself fails closed - an absent credential means 401 for every request to that BRP's route, never
# "no credential required" - and that refusal is right for a host already running and useless
# after a deploy, where it looks byte-identical to a secret somebody rotated without telling you.
# Choose a long random value: `openssl rand -base64 32`.
BRP_CREDENTIAL_PVNED=

# Where the Worker writes the raw payloads it has been posted, inside the container.
#
# LEAVE THIS EMPTY unless you are also moving the volume. Empty means
# /var/lib/peakpower/raw-payloads, which is where docker-compose.yaml mounts the named volume
# peakpower-raw-payloads - the two are the same string on purpose. Point this somewhere the volume
# is NOT mounted and nothing fails: the Worker creates the directory inside the container's
# writable layer, every POST still answers 200, and the next `docker compose up` destroys every
# payload received since the last one. The only symptom is a replay - the one thing that reads
# these files back - answering 500 for every message older than the current container.
# To actually move them, change the volume's target in docker-compose.yaml as well; and that file
# is GENERATED, so the change belongs in PeakPower.AppHost.RawPayloads.ContainerPath and a
# re-publish, not in a hand edit that the next `aspire publish -o ./deploy` discards.
RAW_PAYLOAD_ROOT=
```

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add deploy/Dockerfile deploy/env.example tests/PeakPower.AppHost.Tests/ImageBuildTests.cs
git commit -m "build(deploy): a worker runtime stage, and the two .env lines it needs

The AppHost publishes a worker service with build.target: worker and there was no such stage.
Docker reports that as \`target stage \"worker\" could not be found\` at the END of a build, on the
machine trying to deploy, after the SDK restore, three publishes and two ng builds have already
run; ImageBuildTests is what moves the failure to a test that takes two seconds.

build-worker joins the shared dotnet-source restore rather than restoring for itself - the header's
own note about three concurrent cold restores colliding on a NuGet extraction temp file applies to
a fourth exactly as it did to a third. The runtime stage is FROM runtime-base with no wwwroot: this
host serves no page at all.

env.example gains BRP_CREDENTIAL_PVNED (the fifth line that stops docker compose up dead) and
RAW_PAYLOAD_ROOT, whose blank state is the one an operator must leave alone: it defaults to the
volume's own mount point, and a value pointing anywhere else writes payloads into the container's
writable layer where the next deploy destroys them, with no symptom until a replay.

Mutation-verified: FROM dotnet-source AS worker builds, runs, and turns exactly one test red -
No_runtime_stage_starts_from_a_build_toolchain - while the stage-exists test stays green."
```

---

### Task 16: `aspire publish -o ./deploy`, and the committed compose file the server runs

Everything so far is in the model and in the Dockerfile. The file a server actually runs is
`deploy/docker-compose.yaml`, and it is **committed**: a server under `[DEC-135]` has Docker and
nothing else — no .NET SDK, so no `aspire` CLI, so no way to run `aspire publish` there — so the
artefacts arrive with the source. That buys a reviewable diff and costs the obvious thing, which is
that the committed file can fall behind the AppHost and nothing about a stale one looks wrong.
`CommittedComposeFileTests` is the whole of what stands against that.

⚠ **Hand edits to `deploy/docker-compose.yaml` are discarded by the next publish.** That is not a
style rule: the file is generated from the model, and the correct place for every value in it is
`Program.cs`, `ComposeRuntime.cs`, `ImageBuild.cs` or `RawPayloads.cs`. If a step below leaves the
file wrong, fix the AppHost and publish again.

**The one assertion this task exists to add.** Plan 3 pins
`RawPayloadStoreOptions.DefaultRoot == "/var/lib/peakpower/raw-payloads"` and
`RootEnvironmentVariable == "RAW_PAYLOAD_ROOT"` in `IngestionPortShapeTests`. This plan's mount
target and Compose default are the same two strings, in an assembly the AppHost cannot see. Nothing
links them at compile time — the Aspire SDK references projects for `Projects.*` code generation
and not for compilation — so they are compared here, against the generated file, character for
character, with each end naming the other. A disagreement is silent in the worst way: the stack
starts, every POST answers 200, and the payloads are in the container's writable layer.

**Files:**
- Modify (regenerated, never hand-edited): `/Users/thinhhuynh/PeakPower/peakpower-platform/deploy/docker-compose.yaml`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests/CommittedComposeFileTests.cs:42-45`, `:61-63`, `:124-142`, `:154-157`, and one new fact
- Test: `tests/PeakPower.AppHost.Tests` — `CommittedComposeFileTests`, `ImageBuildTests`

**Interfaces:**
- Consumes: the whole publish-mode model (task 14) · `deploy/Dockerfile`'s `worker` stage
  (task 15) · `RawPayloads.VolumeName` / `.ContainerPath` / `.RootEnvironmentVariable`
- Produces: a committed `deploy/docker-compose.yaml` carrying a `worker` service with a `build:`
  section targeting `worker`, `ports: - "5103:8080"`, a `peakpower-raw-payloads` volume mounted at
  `/var/lib/peakpower/raw-payloads` and declared at the file's top level, a required
  `${BRP_CREDENTIAL_PVNED:?…}` and a defaulted
  `${RAW_PAYLOAD_ROOT:-/var/lib/peakpower/raw-payloads}`.
- ⚠ Read by **plan 8's deployment run**, which brings this exact file up with
  `docker compose up -d --build` and then asks it for the Worker's published
  port with `docker compose port worker 8080`.

- [ ] **Step 1: Write the failing test**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.AppHost.Tests/CommittedComposeFileTests.cs`.

- line 45 — add after `[InlineData("employee-api")]`:

  ```csharp
    [InlineData("worker")]
  ```

- line 62 — the placeholder list becomes four:

  ```csharp
        foreach (var variable in new[]
                 { "MIGRATOR_IMAGE", "CUSTOMER_API_IMAGE", "EMPLOYEE_API_IMAGE", "WORKER_IMAGE" })
  ```

- lines 124-142 — the volume theory is no longer about signing keys alone. Replace the attribute
  block, the method name and its message text:

  ```csharp
    /// <summary>
    /// Every named volume the stack mounts is also declared at the file's top level.
    /// </summary>
    /// <remarks>
    /// Two of these keep an API's signing key across a redeploy; the third is
    /// <c>[F02-R03]</c>'s raw payload store, and it is the one a reader is most likely to think
    /// optional. Compose refuses a project whose service mounts an undeclared volume outright, so
    /// the failure of the second half is loud; the failure of the first half is not.
    /// </remarks>
    [Theory]
    [InlineData("customer-api-keys")]
    [InlineData("employee-api-keys")]
    [InlineData(RawPayloads.VolumeName)]
    public void Each_named_volume_is_both_mounted_and_declared(string volumeName)
    {
        var composeFile = ComposeFile();

        composeFile.ShouldContain(
            $"source: \"{volumeName}\"",
            Case.Sensitive,
            $"{volumeName} is not mounted in the committed file, so whatever it holds dies with "
            + "the container on every update");

        composeFile.ShouldContain(
            $"  {volumeName}:",
            Case.Sensitive,
            $"{volumeName} is mounted but not declared; Compose refuses the whole project with "
            + "`refers to undefined volume`");
    }
  ```

- line 157 — add a fourth required variable:

  ```csharp
    [InlineData("BRP_CREDENTIAL_PVNED")]
  ```

- and add, immediately after that method's closing brace (line 167), the assertion this task is
  named for:

  ```csharp
    /// <summary>
    /// <b>The Worker writes its payloads where the volume is mounted, character for character.</b>
    /// </summary>
    /// <remarks>
    /// <para>
    /// Three spellings of one path have to agree, and no compiler checks any pair of them.
    /// <see cref="RawPayloads.ContainerPath"/> is the mount target the AppHost publishes;
    /// <c>PeakPower.Ingestion.Storage.RawPayloadStoreOptions.DefaultRoot</c> is what
    /// <c>FilesystemRawPayloadStore</c> falls back to when <c>RAW_PAYLOAD_ROOT</c> is empty — which
    /// is the state <c>cp env.example .env</c> leaves it in — and shared contract §7.3 fixes both
    /// as <c>/var/lib/peakpower/raw-payloads</c>. The AppHost cannot see the ingestion assembly
    /// (the Aspire SDK references projects for <c>Projects.*</c> code generation, not for
    /// compilation) and a Dockerfile cannot see a C# constant at all, so the literal below is the
    /// third witness: plan 3's <c>IngestionPortShapeTests</c> pins the same string at the other
    /// end, and each names the other.
    /// </para>
    /// <para>
    /// <b>A disagreement is silent in the worst available way.</b> The store creates its root, so
    /// a mismatched path is not an error: the Worker writes into the container's writable layer,
    /// every POST answers 200 and every <c>inbound_message</c> row carries a <c>payload_uri</c>
    /// that resolves — until the next <c>docker compose up</c> recreates the container. Then
    /// <c>[F02-R27]</c>'s replay, the only reader of those files, answers 500 for every message
    /// older than the current container, and there is nothing in the running stack to look at.
    /// </para>
    /// </remarks>
    [Fact]
    public void The_payload_volume_is_mounted_where_the_ingestion_store_writes()
    {
        RawPayloads.ContainerPath.ShouldBe(
            "/var/lib/peakpower/raw-payloads",
            "shared contract §7.3 fixes this path, and PeakPower.Ingestion.Storage."
            + "RawPayloadStoreOptions.DefaultRoot is the same literal in an assembly this one "
            + "cannot reference. Change one and the Worker writes somewhere the volume is not");

        RawPayloads.RootEnvironmentVariable.ShouldBe(
            "RAW_PAYLOAD_ROOT",
            "RawPayloadStoreOptions.RootEnvironmentVariable is the same literal at the other end, "
            + "and a variable the host does not read is a variable an operator fills in for "
            + "nothing");

        var composeFile = ComposeFile();

        composeFile.ShouldContain(
            $"target: \"{RawPayloads.ContainerPath}\"",
            Case.Sensitive,
            $"the committed file mounts {RawPayloads.VolumeName} somewhere other than where the "
            + "raw payload store writes, so the volume persists an empty directory while every "
            + "payload dies with the container");

        composeFile.ShouldContain(
            $"{RawPayloads.RootEnvironmentVariable}: \"${{{RawPayloads.RootEnvironmentVariable}"
            + $":-{RawPayloads.ContainerPath}}}\"",
            Case.Sensitive,
            "an empty RAW_PAYLOAD_ROOT line - which is what `cp env.example .env` leaves - has to "
            + "resolve to the mount point, and `:-` rather than `-` is what covers a variable that "
            + "is SET and empty rather than absent");
    }
  ```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.AppHost.Tests --nologo --filter "FullyQualifiedName~CommittedComposeFileTests"
```

Expected: **FAIL** — five, every one of them "the committed file has not been regenerated":

```
Every_dotnet_service_carries_a_build_section(serviceName: "worker") [FAIL]
  the committed compose file does not build worker from source. Either the AppHost stopped asking
  it to, or `aspire publish -o ./deploy` has not been re-run since it changed

Each_named_volume_is_both_mounted_and_declared(volumeName: "peakpower-raw-payloads") [FAIL]
  peakpower-raw-payloads is not mounted in the committed file, so whatever it holds dies with the
  container on every update

Every_variable_the_stack_cannot_run_without_is_required_in_the_committed_file(variable: "BRP_CREDENTIAL_PVNED") [FAIL]
  the committed file interpolates BRP_CREDENTIAL_PVNED without requiring it, …

The_payload_volume_is_mounted_where_the_ingestion_store_writes [FAIL]
  the committed file mounts peakpower-raw-payloads somewhere other than where the raw payload
  store writes, …

Env_example_offers_a_line_for_every_variable_the_file_reads [FAIL]
  env.example offers a line nothing in the stack reads. An unfilled variable that does nothing is
  worse than no variable - the natural response to it is to fill it in
```

⚠ **The last one is task 15's two new lines seen from the other side**, and it is the reason the
`env.example` edit and the publish belong in separate tasks: for exactly one commit the file offers
two variables the committed stack does not read, and the test says so rather than the operator
finding out.

- [ ] **Step 3: Publish**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
aspire publish -o ./deploy
```

Expected: it writes `deploy/docker-compose.yaml` and `deploy/.env` and prints the output directory.
⚠ **`deploy/.env` is gitignored** (`.gitignore:12`, `.env`) and is not part of this commit;
`deploy/env.example` is the committed one and the publish does not touch it.

⚠ **This needs a `peakpower-web` checkout beside this one.** `aspire publish` is not
`--backend-only`: `FrontEndPlan.Decide` resolves the checkout and `WebRootLocator` throws
`"PeakPower cannot find the peakpower-web checkout"` before the model exists. That is the same
condition 29 `Assert.SkipWhen` sites in this suite gate on.

- [ ] **Step 4: Read the diff before running anything**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git diff --stat deploy/docker-compose.yaml
git diff deploy/docker-compose.yaml
```

Expected: **`deploy/docker-compose.yaml` is the only changed file**, and the diff is additive — one
new `worker:` service and one new entry under the top-level `volumes:`. Check each of these against
the diff by eye before moving on; they are what tasks 14 and 15 asked for, and reading them here is
cheaper than reading a test failure:

```bash
grep -n 'target: "worker"' deploy/docker-compose.yaml
grep -n '5103:8080' deploy/docker-compose.yaml
grep -n 'BRP_CREDENTIAL_PVNED' deploy/docker-compose.yaml
grep -n 'RAW_PAYLOAD_ROOT' deploy/docker-compose.yaml
grep -n 'peakpower-raw-payloads' deploy/docker-compose.yaml
grep -n '/var/lib/peakpower/raw-payloads' deploy/docker-compose.yaml
grep -c 'ASPNETCORE_FORWARDEDHEADERS_ENABLED' deploy/docker-compose.yaml
```

Expected: every grep but the last prints at least one line; the last prints `0`. ⚠ **A non-zero
count on the last one means the Worker is missing `TrustsOnlyNamedProxies()`** — Aspire sets that
variable on every project with an external endpoint, and it trusts `X-Forwarded-For` from any
caller on a service that publishes a port onto `0.0.0.0`. Fix it in `Program.cs` and publish again;
do not delete the line from the generated file.

⚠ **If any other file changed, or if the diff removes something, stop.** A publish that rewrites a
service this task did not touch means the model changed under it, and the diff is the only place
that is visible.

- [ ] **Step 5: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.AppHost.Tests --nologo
tools/verify-no-unexpected-skips.sh
```

Expected: PASS across the suite with **zero skipped**, and `verify-no-unexpected-skips: OK`.

This is design §7.23's second sentence in full: *"`CommittedComposeFileTests` and `ImageBuildTests`
pass against the regenerated compose file and the new Worker stage."*

- [ ] **Step 6: Ask real Compose, not the YAML**

`What_the_operator_writes_on_the_line_is_what_the_stack_gets` already interpolates the whole file
through `docker compose config` with every variable filled in but one. Its `env.example` sweep now
covers the two new lines, so run it explicitly and then ask the same question of the payload root
by hand — the pair `${VAR-default}` / `${VAR:-default}` differs precisely in the state
`cp env.example .env` leaves a line in, and this is the second setting in the file to depend on it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform/deploy
sed -E 's/^([A-Z0-9_]+)=$/\1=filled-in-by-the-operator/' env.example \
  | sed 's/^RAW_PAYLOAD_ROOT=.*/RAW_PAYLOAD_ROOT=/' > /tmp/peakpower-compose-check.env
docker compose --env-file /tmp/peakpower-compose-check.env -f docker-compose.yaml config \
  | grep -A1 'RAW_PAYLOAD_ROOT'
rm /tmp/peakpower-compose-check.env
```

Expected: `RAW_PAYLOAD_ROOT: /var/lib/peakpower/raw-payloads` — the mount point, from a line that
is present and blank. A bare `-` in the generated file would print an empty value here, the store
would fall back to its own default, and the two would happen to agree today and stop agreeing the
moment either moves.

- [ ] **Step 7: Mutate the mount path and watch the two ends disagree**

Change `RawPayloads.ContainerPath` to `"/var/lib/peakpower/raw_payloads"` — an underscore for a
hyphen, which is the kind of edit that survives review.

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.AppHost.Tests --nologo --filter "FullyQualifiedName~CommittedComposeFileTests"
```

Expected: **FAIL**, exactly one, and it names the contract rather than the file:

```
The_payload_volume_is_mounted_where_the_ingestion_store_writes [FAIL]
  should be "/var/lib/peakpower/raw-payloads" but was "/var/lib/peakpower/raw_payloads"
  shared contract §7.3 fixes this path, and PeakPower.Ingestion.Storage.RawPayloadStoreOptions
  .DefaultRoot is the same literal in an assembly this one cannot reference. Change one and the
  Worker writes somewhere the volume is not
```

⚠ **`ComposeRuntimeTests.The_worker_keeps_its_raw_payloads_across_a_redeploy` stays green under
this mutation**, because it compares the mount against the same constant that moved. That is
exactly why this assertion is written against a literal and not against `RawPayloads.ContainerPath`
alone: a test that reads the constant it is checking cannot notice the constant changing. Restore
the hyphen, re-publish (`aspire publish -o ./deploy`) and re-run: PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add deploy/docker-compose.yaml tests/PeakPower.AppHost.Tests/CommittedComposeFileTests.cs
git commit -m "build(deploy): republish docker-compose.yaml with the worker service

Regenerated with \`aspire publish -o ./deploy\` - the file is generated from the AppHost model and
committed because a server under [DEC-135] has Docker and no .NET SDK, so it cannot run the CLI
that writes it. A hand edit here is discarded by the next publish; the value belongs in Program.cs,
ComposeRuntime.cs, ImageBuild.cs or RawPayloads.cs.

The diff is one worker service - build target worker, 5103:8080, a required BRP_CREDENTIAL_PVNED, a
defaulted RAW_PAYLOAD_ROOT and the peakpower-raw-payloads mount - plus that volume's top-level
declaration.

AND ONE ASSERTION THE TWO PLANS CANNOT DRIFT PAST. The mount target, the Compose default and
PeakPower.Ingestion.Storage.RawPayloadStoreOptions.DefaultRoot are one path in three places that no
compiler relates: the Aspire SDK references projects for Projects.* code generation and not for
compilation, and a Dockerfile cannot read a C# constant at all. So the literal is written out here,
character for character, with the other end naming this test. A disagreement starts perfectly:
FilesystemRawPayloadStore creates its root, every POST answers 200, and the payloads sit in the
container's writable layer until the next deploy destroys them - visible only to a replay, which
then answers 500 for every message older than the current container.

Mutation-verified against a hyphen turned underscore, which turns this red while
The_worker_keeps_its_raw_payloads_across_a_redeploy stays green - because that one compares the
mount against the constant that moved."
```

---

## Tasks 17 and 18 — read this before starting either

Task 12's verdict decides which of the two runs. **Exactly one of them is executed**, and the other
is not written down as dead code: the port exists precisely so that what sits behind it is one
document's business and nobody else's (contract §7.4).

- Task 12's verdict says **PASS** → run **task 17** (Hangfire), and skip task 18.
- Task 12's verdict says **FAIL** → run **task 18** (the Postgres claim queue), and skip task 17.

⚠ **Both tasks are sequenced after the rest of this plan, and both wait on another plan.** This is
the one place plan 1 is not first, and pretending otherwise would produce a task that cannot
compile:

| Task | Waits on | Why |
| --- | --- | --- |
| 17 and 18 | **plan 3, task 1** | Contract §17 row 3 gives plan 3 the `IIngestionJobQueue` and `IProcessInboundMessageHandler` **declarations**, and asserts their shape in `IngestionPortShapeTests`. A port cannot be implemented before it is declared. ⚠ **Do not declare either interface here** — two plans declaring one interface is a duplicate-member compile error, not a merge |
| 18 only | **plan 2, migration 9** | `metering.ingestion_job` carries `inbound_message_id uuid NOT NULL REFERENCES metering.inbound_message(id)` (contract §6.9), and plan 2 is what creates that table |

Tasks 1-16 are unaffected and land in order. Plan 3's task 1 is plan 3's first task, so the wait is
short; the practical reading is "run tasks 1-16, hand over to plan 2 and plan 3, and come back for
one of these two."

⚠ **Task 18 is the ONE exception to "plan 2 writes every line of migration SQL."** Contract §6.9
names the table as plan 1's and tells plan 2 explicitly that it is not plan 2's table, and §17 row 1
cites §6.9 in plan 1's own scope. It is migration **10**, not part of migration 9.

---

### Task 17: `HangfireIngestionJobQueue` — only if the spike passed

Task 12 established, by running a job against a real `postgres:17`, that `Hangfire.PostgreSql`
1.21.1 binds against Npgsql 10 at run time. This is the implementation behind `IIngestionJobQueue`
on that verdict.

`[F02-R04]`/`[F02-R05]` make the webhook answer **200 before any parsing**, which is what stops a
parser bug becoming a redelivery flood — and which makes this queue the only thing between a parser
bug and a document nobody ever processes. So the retry ladder is not a Hangfire default to be
inherited: contract §6.9 fixes it at **1 m / 5 m / 15 m / 1 h / 4 h, five attempts, then dead**,
and it is configured as a global filter rather than as an attribute on plan 3's handler, so that
this plan owns the ladder without owning the method.

⚠ **The dashboard stays off.** `[OQ-57]` asks who may see it, and an unanswered question about
exposure is not a reason to expose something. `WorkerHostTests.Every_route_on_the_worker_is_a_health_endpoint_or_the_webhook`
(task 13) is what refuses it — mapping `/hangfire` fails that test on the way in.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/Directory.Packages.props:89` — three
  `PackageVersion` entries in a new item group after the hosting one
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Queue/IngestionRetryLadder.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Queue/HangfireIngestionJobQueue.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Queue/IngestionQueueServiceCollectionExtensions.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Program.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/IngestionRetryLadderTests.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/HangfireIngestionJobQueueTests.cs`

**Interfaces:**
- Consumes (declared by **plan 3, task 1**, in `PeakPower.Application.Abstractions.Ingestion`):
  - `Task IIngestionJobQueue.EnqueueProcessMessageAsync(Guid inboundMessageId, Guid correlationId, CancellationToken ct)`
  - `Task IProcessInboundMessageHandler.HandleAsync(Guid inboundMessageId, Guid correlationId, CancellationToken ct)`
- Produces:
  - `PeakPower.Ingestion.Queue.IngestionRetryLadder.Delays` — `IReadOnlyList<TimeSpan>`, five entries
  - `PeakPower.Ingestion.Queue.HangfireIngestionJobQueue : IIngestionJobQueue`
  - `IngestionQueueServiceCollectionExtensions.AddIngestionJobQueue(this IHostApplicationBuilder builder)`

- [ ] **Step 1: Write the failing test — the ladder**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/IngestionRetryLadderTests.cs`:

```csharp
using PeakPower.Ingestion.Queue;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion;

/// <summary>
/// The retry ladder shared contract §6.9 fixes: 1 m / 5 m / 15 m / 1 h / 4 h, five attempts, then
/// dead.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why a ladder is a decision and not a default.</b> <c>[F02-R04]</c>/<c>[F02-R05]</c> make the
/// webhook answer 200 before any parsing, so the BRP has been told the document is safe and will
/// not redeliver it. Whatever is behind this port is the only thing left between a transient
/// failure and a document nobody processes — and equally the only thing between a PERMANENT
/// failure and a job retried for ever. Five attempts across roughly five and a half hours, then a
/// dead letter somebody can see, is what the contract chose.
/// </para>
/// <para>
/// Asserted as exact values rather than as a shape. "Five delays, increasing" would pass on
/// 1s/2s/3s/4s/5s, which retries a database outage into the ground in fifteen seconds and gives
/// up before anybody is awake.
/// </para>
/// </remarks>
public sealed class IngestionRetryLadderTests
{
    [Fact]
    public void The_ladder_is_the_five_delays_the_contract_fixes() =>
        IngestionRetryLadder.Delays.ShouldBe(
        [
            TimeSpan.FromMinutes(1),
            TimeSpan.FromMinutes(5),
            TimeSpan.FromMinutes(15),
            TimeSpan.FromHours(1),
            TimeSpan.FromHours(4),
        ],
        "shared contract §6.9 fixes 1 m / 5 m / 15 m / 1 h / 4 h. The last rung is what makes the "
        + "ladder useful for an outage rather than only for a blip: a document that arrives during "
        + "a four-hour database problem is still processed rather than dead-lettered");

    [Fact]
    public void Five_attempts_and_then_a_dead_letter()
    {
        IngestionRetryLadder.Attempts.ShouldBe(
            5,
            "a sixth attempt is not free - it is a document that keeps failing, keeps logging, and "
            + "never appears in the place an operator looks for stuck work");

        IngestionRetryLadder.Attempts.ShouldBe(
            IngestionRetryLadder.Delays.Count,
            "the attempt count and the delay list are two spellings of the same number; a ladder "
            + "with more attempts than rungs repeats its last delay silently, and one with fewer "
            + "never reaches its longest");
    }

    /// <summary>The whole ladder is under a working day, which is what makes it operable.</summary>
    /// <remarks>
    /// <c>[DEC-104]</c> is one operator with no rota. A job whose last retry lands overnight is a
    /// job whose failure is discovered a day late, and there is nobody to page. Five hours and
    /// twenty-one minutes means a document that starts failing at the beginning of a working day
    /// has finished failing within it.
    /// </remarks>
    [Fact]
    public void The_whole_ladder_fits_inside_a_working_day() =>
        IngestionRetryLadder.Delays.Aggregate(TimeSpan.Zero, (total, delay) => total + delay)
            .ShouldBe(TimeSpan.FromMinutes(321));
}
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~IngestionRetryLadderTests"
```

Expected: **FAIL to build** —

```
error CS0246: The type or namespace name 'PeakPower' could not be found
  (are you missing a using directive or an assembly reference?)   [using PeakPower.Ingestion.Queue;]
```

⚠ `PeakPower.Application.Tests` does not reference `PeakPower.Ingestion`. Add it — the ladder is
the one piece of this task with no database and no host in it, and it belongs in the fast suite:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet add tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj \
  reference src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj
```

Re-run. Expected: **FAIL to build**, now on the real absence —
`error CS0234: The type or namespace name 'Queue' does not exist in the namespace 'PeakPower.Ingestion'`.

- [ ] **Step 3: Write the ladder**

```bash
mkdir -p /Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Queue
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Queue/IngestionRetryLadder.cs`:

```csharp
namespace PeakPower.Ingestion.Queue;

/// <summary>
/// How often, and how far apart, a failed ingestion job is retried before it is dead-lettered —
/// shared contract §6.9.
/// </summary>
/// <remarks>
/// <para>
/// <b>In its own type because two things read it and neither is a good home for the other.</b> The
/// queue implementation configures it, and the tests assert on it; putting the numbers inside the
/// Hangfire wiring would make the assertion a test of Hangfire, and putting them in the test would
/// make the ladder whatever the implementation happened to do.
/// </para>
/// <para>
/// <b>Why the ladder matters more here than in most queues.</b> <c>[F02-R04]</c>/<c>[F02-R05]</c>
/// make the webhook answer 200 <i>before</i> any parsing, so the BRP has been told the document is
/// safe and will not send it again. Everything after that point is this queue's responsibility
/// alone.
/// </para>
/// </remarks>
public static class IngestionRetryLadder
{
    /// <summary>1 m, 5 m, 15 m, 1 h, 4 h — in order, one per retry.</summary>
    /// <remarks>
    /// <b>Five RETRIES after the first run, not five runs in total.</b> That is Hangfire's own
    /// meaning for <c>AutomaticRetryAttribute.Attempts</c>, and the Postgres claim queue copies it
    /// deliberately — the two implementations of this port must behave identically, or
    /// <c>docs/ingestion-job-queue.md</c> would be describing two ladders and calling them one.
    /// Contract §6.9 writes it as "five attempts, then <c>DEAD</c>"; five rungs and five retries is
    /// the reading in which every rung is reachable, and the four-hour one is the rung that matters
    /// — it is what carries a document through a database outage rather than dead-lettering it in
    /// twenty-one minutes.
    /// </remarks>
    public static IReadOnlyList<TimeSpan> Delays { get; } =
    [
        TimeSpan.FromMinutes(1),
        TimeSpan.FromMinutes(5),
        TimeSpan.FromMinutes(15),
        TimeSpan.FromHours(1),
        TimeSpan.FromHours(4),
    ];

    /// <summary>Five, and then the job is dead-lettered rather than retried again.</summary>
    public static int Attempts => Delays.Count;

    /// <summary>The ladder as whole seconds, which is the unit Hangfire's filter takes.</summary>
    public static int[] DelaysInSeconds { get; } =
        [.. Delays.Select(delay => (int)delay.TotalSeconds)];
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~IngestionRetryLadderTests"`

Expected: PASS — 3 passed.

- [ ] **Step 5: Pin the three packages**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/Directory.Packages.props` and insert after
line 89 (the closing `</ItemGroup>` of "Hosting, telemetry and resilience"):

```xml

  <ItemGroup Label="Background jobs - the ingestion queue, contract 1.1 and docs/ingestion-job-queue.md">
    <!--
      PINNED ONLY BECAUSE THE SPIKE PASSED. Hangfire.PostgreSql 1.21.1 targets netstandard2.0 and
      was built against Npgsql 6; its dependency floors are floors, so Npgsql 10.0.3 and Dapper
      2.1.66 satisfy them and NuGet does not downgrade either. What that does NOT establish is
      whether its ADO.NET usage still BINDS against Npgsql 10 at run time - a removed member is a
      MissingMethodException on first use, not a build error. Task 12 ran a job against a real
      postgres:17 and watched the retry ladder fire; docs/ingestion-job-queue.md carries the
      measurements. Do not bump these without re-running that spike.

      Dapper.AOT arrives transitively with Hangfire.PostgreSql and is this repository's first use
      of it. It is not pinned here: nothing of ours compiles against it.
    -->
    <PackageVersion Include="Hangfire.Core" Version="1.8.25" />
    <PackageVersion Include="Hangfire.AspNetCore" Version="1.8.25" />
    <PackageVersion Include="Hangfire.PostgreSql" Version="1.21.1" />
  </ItemGroup>
```

and add to
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj`,
inside the second `<ItemGroup>` (the one that already holds
`Microsoft.Extensions.Hosting.Abstractions`):

```xml
    <!-- What sits behind IIngestionJobQueue, chosen by the task 12 spike and recorded in
         docs/ingestion-job-queue.md. Hangfire.AspNetCore rather than Hangfire alone: the Worker is
         an ASP.NET host and AddHangfireServer is the registration it uses. -->
    <PackageReference Include="Hangfire.Core" />
    <PackageReference Include="Hangfire.AspNetCore" />
    <PackageReference Include="Hangfire.PostgreSql" />
```

- [ ] **Step 6: Write the failing test — a job survives the hop**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/HangfireIngestionJobQueueTests.cs`:

```csharp
using Hangfire;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Ingestion.Queue;
using Shouldly;
using Testcontainers.PostgreSql;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

/// <summary>
/// The queue actually carries a job across the process hop, against a real PostgreSQL 17.
/// </summary>
/// <remarks>
/// <para>
/// <b>An enqueue that returns is not a job that runs.</b> Task 12's spike proved the library binds
/// against Npgsql 10 at all; this proves that THIS wiring — our storage configuration, our
/// serializer settings, our handler resolved from the container — gets a call to
/// <c>IProcessInboundMessageHandler.HandleAsync</c> with the two ids the webhook stamped. The
/// failure it is written for is silent: Hangfire serialises the job by type name, so a handler
/// registered as one type and enqueued as another writes a row, dequeues it, and fails inside the
/// server with nothing on the request path to notice.
/// </para>
/// <para>
/// Both ids are asserted, not just the message id. The correlation id is <c>[F02-R05]</c>'s thread
/// through queue, adapter and apply (contract §9.5) — losing it here is losing every log line's
/// link back to the POST that caused it, and a job that ran with the right message id and a
/// <c>Guid.Empty</c> correlation id would look entirely healthy.
/// </para>
/// </remarks>
public sealed class HangfireIngestionJobQueueTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder()
        .WithImage("postgres:17")
        .Build();

    public ValueTask InitializeAsync() => new(_postgres.StartAsync());

    public ValueTask DisposeAsync() => new(_postgres.DisposeAsync().AsTask());

    [Fact]
    public async Task An_enqueued_message_reaches_the_handler_with_both_ids()
    {
        var handled = new TaskCompletionSource<(Guid Message, Guid Correlation)>(
            TaskCreationOptions.RunContinuationsAsynchronously);

        var handler = Substitute.For<IProcessInboundMessageHandler>();
        handler
            .HandleAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                handled.TrySetResult((call.ArgAt<Guid>(0), call.ArgAt<Guid>(1)));
                return Task.CompletedTask;
            });

        var services = new ServiceCollection();
        services.AddSingleton(handler);
        services.AddHangfire(configuration => configuration
            .UseSimpleAssemblyNameTypeSerializer()
            .UseRecommendedSerializerSettings()
            .UsePostgreSqlStorage(options =>
                options.UseNpgsqlConnection(_postgres.GetConnectionString())));
        services.AddHangfireServer();
        services.AddSingleton<IIngestionJobQueue, HangfireIngestionJobQueue>();

        await using var provider = services.BuildServiceProvider();

        // The server is a hosted service; nothing dequeues until it is started.
        foreach (var hosted in provider.GetServices<Microsoft.Extensions.Hosting.IHostedService>())
        {
            await hosted.StartAsync(TestContext.Current.CancellationToken);
        }

        var messageId = Guid.CreateVersion7();
        var correlationId = Guid.CreateVersion7();

        await provider.GetRequiredService<IIngestionJobQueue>()
            .EnqueueProcessMessageAsync(messageId, correlationId, TestContext.Current.CancellationToken);

        var finished = await Task.WhenAny(handled.Task, Task.Delay(TimeSpan.FromSeconds(60)));

        finished.ShouldBe(
            handled.Task,
            "the job was enqueued and no handler ran within sixty seconds. Hangfire serialises a "
            + "job by type name, so the usual cause is a handler registered as one type and "
            + "enqueued as another - which writes a row, dequeues it, and fails inside the server "
            + "where the request path cannot see it");

        var (message, correlation) = await handled.Task;

        message.ShouldBe(messageId);
        correlation.ShouldBe(
            correlationId,
            "the correlation id is stamped at receipt and carried through queue, adapter and apply "
            + "(contract §9.5); a job that ran with the right message id and an empty correlation "
            + "id looks entirely healthy and has cut every log line's link back to the POST");
    }
}
```

- [ ] **Step 7: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~HangfireIngestionJobQueueTests"
```

Expected: **FAIL to build** —
`error CS0246: The type or namespace name 'HangfireIngestionJobQueue' could not be found`.

⚠ If it instead fails with `CS0246` on `IProcessInboundMessageHandler`, **plan 3 task 1 has not
landed** and this task is being run out of order. Stop, and read the sequencing table above.

- [ ] **Step 8: Write the queue**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Queue/HangfireIngestionJobQueue.cs`:

```csharp
using Hangfire;
using PeakPower.Application.Abstractions.Ingestion;

namespace PeakPower.Ingestion.Queue;

/// <summary>
/// <see cref="IIngestionJobQueue"/> on Hangfire, chosen by the task 12 spike and recorded in
/// <c>docs/ingestion-job-queue.md</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>The enqueue is synchronous and the interface is not, and that is deliberate rather than an
/// oversight.</b> <c>BackgroundJob.Enqueue</c> writes its row on the calling thread; the port is
/// asynchronous because the other implementation this repository nearly shipped — a Postgres claim
/// queue — genuinely is, and a port shaped around today's winner would have to change to swap it.
/// The call is on the webhook's request path, after the payload is durable and
/// <c>inbound_message</c> is committed and before the 200 is written (contract §7.4), so it is one
/// short INSERT and not a place to add a thread hop.
/// </para>
/// <para>
/// <b>The expression is what Hangfire stores</b> — a type, a method and the argument values, by
/// name. It resolves <see cref="IProcessInboundMessageHandler"/> from the container at dequeue
/// time, which is what lets plan 3 own the handler and this file own the queue.
/// <c>CancellationToken.None</c> in the expression is Hangfire's own convention: the token the job
/// eventually runs with is the server's, and a captured one would be a token from a request that
/// finished hours earlier.
/// </para>
/// <para>
/// <b>No dashboard is mapped anywhere.</b> <c>[OQ-57]</c> asks who may see it and is unanswered;
/// <c>WorkerHostTests</c> is what refuses one.
/// </para>
/// </remarks>
public sealed class HangfireIngestionJobQueue(IBackgroundJobClient jobs) : IIngestionJobQueue
{
    /// <inheritdoc />
    public Task EnqueueProcessMessageAsync(
        Guid inboundMessageId, Guid correlationId, CancellationToken ct)
    {
        ArgumentOutOfRangeException.ThrowIfEqual(inboundMessageId, Guid.Empty);
        ArgumentOutOfRangeException.ThrowIfEqual(correlationId, Guid.Empty);

        jobs.Enqueue<IProcessInboundMessageHandler>(
            handler => handler.HandleAsync(inboundMessageId, correlationId, CancellationToken.None));

        return Task.CompletedTask;
    }
}
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Queue/IngestionQueueServiceCollectionExtensions.cs`:

```csharp
using Hangfire;
using Hangfire.PostgreSql;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Application.Abstractions.Ingestion;

namespace PeakPower.Ingestion.Queue;

/// <summary>Registers what sits behind <see cref="IIngestionJobQueue"/> in the Worker.</summary>
/// <remarks>
/// One entry point, so that the Worker's <c>Program.cs</c> names the port and not the library. The
/// choice between Hangfire and a Postgres claim queue is recorded in
/// <c>docs/ingestion-job-queue.md</c>, and swapping it is this file plus one class.
/// </remarks>
public static class IngestionQueueServiceCollectionExtensions
{
    /// <param name="connectionString">
    /// The same <c>peakpower</c> database the rest of the stack uses. Hangfire creates and owns its
    /// own <c>hangfire</c> schema in it on first start; nothing in <c>metering</c> is touched.
    /// </param>
    public static IServiceCollection AddIngestionJobQueue(
        this IServiceCollection services, string connectionString)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentException.ThrowIfNullOrWhiteSpace(connectionString);

        services.AddHangfire(configuration => configuration
            .UseSimpleAssemblyNameTypeSerializer()
            .UseRecommendedSerializerSettings()
            .UsePostgreSqlStorage(options => options.UseNpgsqlConnection(connectionString))
            // THE LADDER, contract §6.9: 1 m / 5 m / 15 m / 1 h / 4 h, five attempts, then the job
            // sits in Failed - which is Hangfire's dead letter - rather than being retried again.
            //
            // A GLOBAL FILTER AND NOT AN [AutomaticRetry] ON THE HANDLER. The handler is plan 3's
            // method and the ladder is this plan's decision; an attribute would put one plan's
            // number in another plan's file, and a handler that lost the attribute in a refactor
            // would silently inherit Hangfire's own default of ten attempts with a jittered delay.
            .UseFilter(new AutomaticRetryAttribute
            {
                Attempts = IngestionRetryLadder.Attempts,
                DelaysInSeconds = IngestionRetryLadder.DelaysInSeconds,
                OnAttemptsExceeded = AttemptsExceededAction.Fail,
            }));

        // The dequeue side. Without it the Worker writes rows nothing reads - and an enqueue that
        // returns successfully is exactly what that looks like from the request path.
        services.AddHangfireServer();

        services.AddSingleton<IIngestionJobQueue, HangfireIngestionJobQueue>();

        return services;
    }
}
```

- [ ] **Step 9: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~HangfireIngestionJobQueueTests"
```

Expected: PASS — 1 passed, in roughly ten seconds after the container starts.

- [ ] **Step 10: Wire it into the Worker**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Program.cs` and
insert between `builder.AddServiceDefaults();` and `var app = builder.Build();`:

```csharp

// What sits behind IIngestionJobQueue - docs/ingestion-job-queue.md records the spike that chose
// it, and this is the only line in any host that knows which it is. The Worker is the only process
// that runs jobs: the two APIs enqueue nothing, and a second job server against one storage would
// dequeue the same work twice.
builder.Services.AddIngestionJobQueue(
    builder.Configuration.GetConnectionString("peakpower")
    ?? throw new InvalidOperationException(
        "ConnectionStrings__peakpower is not set. The ingestion job queue keeps its state in the "
        + "same database the rest of the stack uses, so a Worker without one accepts documents "
        + "and processes none - and the webhook would still answer 200, because [F02-R05] makes "
        + "it answer before any of this."));
```

and add `using PeakPower.Ingestion.Queue;` to the file's `using` block.

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~WorkerHostTests"
```

Expected: PASS — 4 passed. ⚠ In particular
`Every_route_on_the_worker_is_a_health_endpoint_or_the_webhook` stays green, which is the assertion
that no dashboard was mapped along with the server.

- [ ] **Step 11: Mutate the ladder and watch it go red**

The ladder is five numbers, and the plausible wrong version is not a typo — it is somebody deleting
the filter and letting Hangfire's own default stand.

Temporarily delete the whole `.UseFilter(new AutomaticRetryAttribute { … })` clause from
`AddIngestionJobQueue`.

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~IngestionRetryLadderTests"`

Expected: **PASS — and that is the finding.** The ladder tests read the constants and say nothing
about whether anything applies them, so this mutation is invisible to them. Add the assertion that
closes it, to the bottom of `IngestionRetryLadderTests`:

```csharp
    /// <summary>
    /// And the ladder is actually applied — the constants above are not a document.
    /// </summary>
    /// <remarks>
    /// The three assertions above read <c>IngestionRetryLadder</c> and would pass unchanged if
    /// nothing ever configured it, which was measured by deleting the filter and watching them stay
    /// green. Hangfire's own default is ten attempts with a jittered delay, and inheriting it would
    /// retry a permanently-failing document for hours and never dead-letter it inside the window
    /// <c>[DEC-104]</c>'s single operator is awake for.
    /// </remarks>
    [Fact]
    public void The_registered_queue_applies_the_ladder()
    {
        var services = new ServiceCollection();
        services.AddIngestionJobQueue(
            "Host=localhost;Port=1;Database=never-connected;Username=x;Password=y");

        var retry = GlobalJobFilters.Filters
            .Select(filter => filter.Instance)
            .OfType<AutomaticRetryAttribute>()
            .ShouldHaveSingleItem(
                "two AutomaticRetry filters is not two ladders, it is whichever one Hangfire "
                + "consults first - and none at all is Hangfire's default of ten jittered attempts");

        retry.Attempts.ShouldBe(IngestionRetryLadder.Attempts);
        retry.OnAttemptsExceeded.ShouldBe(
            AttemptsExceededAction.Fail,
            "Delete would remove the job instead of leaving it in Failed, which is the only place "
            + "an operator can see a document that never processed");
    }
```

⚠ `AddIngestionJobQueue` opens no connection, so the unreachable connection string above is not a
lie — it is what keeps this test out of the Testcontainers suite. Re-run with the filter still
deleted and it goes **red**:

```
The_registered_queue_applies_the_ladder [FAIL]
  two AutomaticRetry filters is not two ladders … - and none at all is Hangfire's default of ten
  jittered attempts
  Sequence contains no elements
```

Restore the filter and re-run: PASS — 4 passed.

- [ ] **Step 12: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add Directory.Packages.props \
        src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj \
        src/Infrastructure/PeakPower.Ingestion/Queue/ \
        src/Hosts/PeakPower.Worker/Program.cs \
        tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj \
        tests/PeakPower.Application.Tests/Ingestion/IngestionRetryLadderTests.cs \
        tests/PeakPower.Integration.Tests/Ingestion/HangfireIngestionJobQueueTests.cs
git commit -m "feat(ingestion): IIngestionJobQueue on Hangfire, with the contract's retry ladder

The task 12 spike ran a job against a real postgres:17 and watched the retry ladder fire, so
Hangfire.PostgreSql 1.21.1 binds against Npgsql 10 at run time and not only on paper. Verdict and
evidence in docs/ingestion-job-queue.md.

The ladder is contract 6.9's - 1 m / 5 m / 15 m / 1 h / 4 h, five attempts, then Failed, which is
Hangfire's dead letter - and it is a GLOBAL FILTER rather than an [AutomaticRetry] on plan 3's
handler: the ladder is this plan's decision and the handler is that plan's method, and an attribute
lost in a refactor would silently inherit Hangfire's default of ten jittered attempts.

Only the Worker runs a job server. The two APIs enqueue nothing, and a second server against one
storage dequeues the same work twice. No dashboard is mapped anywhere - OQ-57 asks who may see it,
and WorkerHostTests refuses one on the way in.

Mutation-verified, and the first attempt FAILED to find anything: deleting the filter left all
three ladder tests green, because they read the constants and said nothing about whether anything
applied them. The_registered_queue_applies_the_ladder is what closes that, and it goes red on the
same deletion."
```

---

### Task 18: The Postgres claim queue — only if the spike failed

Task 12's verdict says `Hangfire.PostgreSql` does not hold on .NET 10 with Npgsql 10. Design §8's
third risk row names the fallback and design §6 budgets it: *"a Postgres claim-queue drained by a
hosted `BackgroundService`, the pattern `OutboundMailService` already establishes here. Cost is
hand-rolling the retry ladder (1m/5m/15m/1h/4h, five attempts, dead letter)."*

Contract §6.9 gives the table verbatim and this is the one table in slice 2 that is **not** plan 2's.

⚠ **Read the sequencing table above.** This task needs plan 3 task 1 (the port declarations) **and**
plan 2's migration 9 (`metering.inbound_message`, which this table's foreign key points at). It is
migration **10**.

**The difference from `OutboundMailService`, and it is the whole reason this is more than a copy.**
That service drains an in-process `Channel`: its own remarks say the queue is process memory and
not an outbox, and mail still in it when the host stops is dropped. That is a defensible trade for
a password-reset email and an indefensible one here — `[F02-R04]`/`[F02-R05]` make the webhook
answer 200 before any parsing, so a dropped job is a document the BRP believes was accepted and
will never send again. The pattern this borrows is the hosted-`BackgroundService` shape and the
per-message scope; the queue itself is a table.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Migrations/<timestamp>_IngestionJobQueue.cs` (via `dotnet ef migrations add`)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh:51-55`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Queue/IngestionRetryLadder.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Queue/PostgresIngestionJobQueue.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Queue/IngestionJobDrain.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Queue/IngestionQueueServiceCollectionExtensions.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Program.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/IngestionRetryLadderTests.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/PostgresIngestionJobQueueTests.cs`

**Interfaces:**
- Consumes (declared by **plan 3, task 1**): `IIngestionJobQueue`, `IProcessInboundMessageHandler`
  (contract §7.4) · `PeakPowerDbContext` (plan 2's, unchanged by this task — no entity is declared
  here, and the queue reads and writes its table with raw SQL for exactly that reason)
- Produces:
  - `metering.ingestion_job` — contract §6.9 verbatim
  - `PeakPower.Ingestion.Queue.IngestionRetryLadder` · `PostgresIngestionJobQueue : IIngestionJobQueue`
    · `IngestionJobDrain : BackgroundService`
  - `IngestionQueueServiceCollectionExtensions.AddIngestionJobQueue(this IServiceCollection)`

- [ ] **Step 1: The ladder, exactly as in task 17**

⚠ Steps 1-4 of **task 17** — `IngestionRetryLadderTests` and `IngestionRetryLadder.cs` — are
identical on this path and are not repeated here. Run them, verbatim, then continue below. The
ladder is contract §6.9's on both paths; what changes is who applies it.

Skip task 17's `DelaysInSeconds` member: nothing here takes seconds, and a property nothing reads
is a property the next reader has to check for callers.

- [ ] **Step 2: Write the failing test — the migration**

Add to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh`, line 51, one more
alternative at the end of the case pattern (after `*_EmployeeSessions\`) — and the migration 9 name
plan 2 added is already there:

```bash
  *_InitialSchema\|*_TenancyRowLevelSecurity\|*_AuthAndOnboarding\|*_AccountTokenForeignKeys\|*_EanPool\|*_OnboardingTradeName\|*_EmployeeIdentity\|*_EmployeeSessions\|*_MeteringIngestion\|*_IngestionJobQueue\|) ;;
```

and extend the failure message on lines 52-55 so it names the two new migrations in order, after
`_EmployeeSessions`:

```bash
       "_EmployeeSessions then one ending _MeteringIngestion then one ending _IngestionJobQueue " \
```

⚠ `*_MeteringIngestion` is **plan 2's** migration 9 and plan 2 adds that alternative. If it is not
there, plan 2 has not landed and this task is out of order — see the sequencing table.

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && tools/verify-migrator.sh`

Expected: **FAIL**, naming the ordered list it did not find.

- [ ] **Step 3: Write the migration**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet ef migrations add IngestionJobQueue \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator
```

Replace the generated `Up` and `Down` bodies in the new
`src/Infrastructure/PeakPower.Persistence/Migrations/<timestamp>_IngestionJobQueue.cs` with the
contract's DDL. ⚠ **Raw SQL and no `migrationBuilder.CreateTable`**, because there is no entity:
plan 2 is the only plan that declares one, and this table is read and written by hand.

```csharp
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Shared contract §6.9, verbatim. The ONE table in slice 2 that is not plan 2's: §6.9 names
        // it as plan 1's and tells plan 2 explicitly that it is not plan 2's table, because it
        // exists only on the fallback path - Hangfire would have brought its own schema.
        //
        // NO ENTITY, deliberately. Plan 2 is the only plan that declares one, and this table is
        // infrastructure for a queue rather than part of the domain model: the drain reads it with
        // FOR UPDATE SKIP LOCKED, which is not a shape EF expresses.
        //
        // REVOKEd from both application roles. Neither a customer nor a member of staff has any
        // business reading the ingestion queue, and the Worker connects as the owner.
        migrationBuilder.Sql(
            """
            CREATE TABLE metering.ingestion_job (
                id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                inbound_message_id uuid NOT NULL REFERENCES metering.inbound_message(id),
                correlation_id     uuid NOT NULL,
                status             text NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','CLAIMED','SUCCEEDED','FAILED','DEAD')),
                attempt            smallint NOT NULL DEFAULT 0,
                run_after          timestamptz NOT NULL DEFAULT now(),
                claimed_at         timestamptz,
                claimed_by         text,
                last_error         text,
                created_at         timestamptz NOT NULL DEFAULT now()
            );
            CREATE INDEX ix_job_claimable ON metering.ingestion_job (run_after)
                WHERE status IN ('PENDING','CLAIMED');
            REVOKE ALL ON metering.ingestion_job FROM app_customer_role, app_employee_role;
            """);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder) =>
        // S2-D7: the deployed DatabaseMigrator calls only MigrateAsync, so this is never invoked in
        // the shipped path. It is still correct - a developer may run `dotnet ef database update
        // <earlier>` by hand - and nothing may rely on it.
        migrationBuilder.Sql("DROP TABLE metering.ingestion_job;");
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
tools/verify-migrator.sh
```

Expected: `verify-migrator: OK` — and it runs the real Migrator process **twice**, so an
`Up` that is not idempotent under a re-run fails here rather than on a server.


- [ ] **Step 4: Write the failing test — a job survives the hop, is claimed once, and walks the ladder**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/PostgresIngestionJobQueueTests.cs`:

```csharp
using Dapper;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NSubstitute;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Ingestion.Queue;
using PeakPower.Integration.Tests.Database;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

/// <summary>
/// The claim queue against a real PostgreSQL 17: a job is written, claimed once, run with both
/// ids, and — when it throws — rescheduled onto the next rung of the ladder rather than lost or
/// retried immediately.
/// </summary>
/// <remarks>
/// <para>
/// <b>Claimed ONCE is the assertion that needs a real database.</b> The claim is
/// <c>SELECT … FOR UPDATE SKIP LOCKED</c>, and what it protects against is two drains — two Worker
/// containers, or one being replaced by another during a deploy — dequeuing the same row. Nothing
/// in a single-threaded test can see that, so the second fact below runs two claims against one
/// row and asserts that exactly one of them gets it.
/// </para>
/// <para>
/// <b>Rescheduled rather than dropped is why this is a table and not a <c>Channel</c>.</b>
/// <c>OutboundMailService</c> drains process memory and its own remarks defend losing what is
/// still in it at shutdown, for a password-reset email. Here <c>[F02-R04]</c>/<c>[F02-R05]</c>
/// have already answered the BRP 200 before any parsing, so a dropped job is a document nobody
/// will ever send again.
/// </para>
/// <para>
/// Every assertion reads a COLUMN back out of the database rather than a return value: the whole
/// subject of this class is what survives a process boundary.
/// </para>
/// </remarks>
[Collection(PostgresCollection.Name)]
public sealed class PostgresIngestionJobQueueTests(PostgresFixture postgres)
{
    private sealed record JobRow(string Status, short Attempt, DateTimeOffset RunAfter, string? LastError);

    [Fact]
    public async Task An_enqueued_message_becomes_a_pending_job()
    {
        var correlationId = Guid.CreateVersion7();
        var messageId = await SeedReceivedMessageAsync(correlationId);

        await using (var db = postgres.CreateContext())
        {
            await new PostgresIngestionJobQueue(db).EnqueueProcessMessageAsync(
                messageId, correlationId, TestContext.Current.CancellationToken);
        }

        var job = await ReadJobAsync(messageId);

        job.Status.ShouldBe(
            "PENDING",
            "the row is written with the column defaults - PENDING, attempt 0, run_after now() - "
            + "so the schema states them once and this code does not state them again");
        job.Attempt.ShouldBe((short)0);
        job.LastError.ShouldBeNull();
        job.RunAfter.ShouldBeLessThanOrEqualTo(
            DateTimeOffset.UtcNow.AddSeconds(1),
            "a job that is not claimable the moment it is written is a document that waits for a "
            + "clock skew nobody chose");
    }

    /// <summary>Two drains, one row, one winner — and the loser gets nothing rather than blocking.</summary>
    [Fact]
    public async Task Two_concurrent_claims_take_the_row_once()
    {
        var correlationId = Guid.CreateVersion7();
        var messageId = await SeedReceivedMessageAsync(correlationId);

        await using (var db = postgres.CreateContext())
        {
            await new PostgresIngestionJobQueue(db).EnqueueProcessMessageAsync(
                messageId, correlationId, TestContext.Current.CancellationToken);
        }

        // Two connections, because two Worker containers are two connections. One transaction each,
        // held open, so the first claim's row lock is still held when the second one runs - which
        // is the state a deploy produces and the only state SKIP LOCKED is about.
        await using var first = new NpgsqlConnection(postgres.ConnectionString);
        await using var second = new NpgsqlConnection(postgres.ConnectionString);
        await first.OpenAsync(TestContext.Current.CancellationToken);
        await second.OpenAsync(TestContext.Current.CancellationToken);

        await using var firstTransaction = await first.BeginTransactionAsync(
            TestContext.Current.CancellationToken);
        await using var secondTransaction = await second.BeginTransactionAsync(
            TestContext.Current.CancellationToken);

        var firstClaim = await first.QuerySingleOrDefaultAsync<Guid?>(
            new CommandDefinition(
                IngestionJobDrain.ClaimSql,
                new { claimed_by = "first" },
                firstTransaction,
                cancellationToken: TestContext.Current.CancellationToken));

        firstClaim.ShouldNotBeNull("the row is PENDING and due, so the first claim must take it");

        var secondClaim = await second.QuerySingleOrDefaultAsync<Guid?>(
            new CommandDefinition(
                IngestionJobDrain.ClaimSql,
                new { claimed_by = "second" },
                secondTransaction,
                // Five seconds, and the timeout IS the assertion: without SKIP LOCKED this
                // statement does not return the row twice, it BLOCKS on the first transaction's
                // lock until that transaction ends - so a second Worker container stalls behind
                // the first for as long as a job takes to run.
                commandTimeout: 5,
                cancellationToken: TestContext.Current.CancellationToken));

        secondClaim.ShouldBeNull(
            "the second drain must skip a row somebody else is holding and move on, not take it "
            + "and not wait for it. A NpgsqlException about a command timeout here means SKIP "
            + "LOCKED is missing; a non-null id means the same job is about to be processed twice");

        await firstTransaction.RollbackAsync(TestContext.Current.CancellationToken);
        await secondTransaction.RollbackAsync(TestContext.Current.CancellationToken);
    }

    /// <summary>
    /// A handler that throws walks the ladder rung by rung and lands DEAD, and a handler that
    /// succeeds gets both ids.
    /// </summary>
    /// <remarks>
    /// One test rather than two because the interesting fact is the SEQUENCE: five rescheduled
    /// failures carrying attempt 1 to 5, then a sixth that is dead-lettered rather than a sixth
    /// reschedule. Asserting only the first reschedule would pass on a ladder that never gives up.
    /// </remarks>
    [Fact]
    public async Task A_failing_job_climbs_the_ladder_and_then_dies()
    {
        var correlationId = Guid.CreateVersion7();
        var messageId = await SeedReceivedMessageAsync(correlationId);

        var seen = new List<(Guid Message, Guid Correlation)>();
        var handler = Substitute.For<IProcessInboundMessageHandler>();
        handler
            .HandleAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                seen.Add((call.ArgAt<Guid>(0), call.ArgAt<Guid>(1)));
                throw new InvalidOperationException("the parser is broken");
            });

        await using var db = postgres.CreateContext();
        await new PostgresIngestionJobQueue(db).EnqueueProcessMessageAsync(
            messageId, correlationId, TestContext.Current.CancellationToken);

        var drain = new IngestionJobDrain(
            new SingleScopeFactory(db, handler),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<IngestionJobDrain>.Instance);

        var before = DateTimeOffset.UtcNow;

        (await drain.TryRunOneAsync(TestContext.Current.CancellationToken)).ShouldBeTrue(
            "the job is PENDING and due, so a drain must claim it");

        var afterFirst = await ReadJobAsync(messageId);

        afterFirst.Status.ShouldBe(
            "PENDING",
            "a failed job goes back on the queue rather than staying CLAIMED - a row left CLAIMED "
            + "by a container that died is a document nothing ever picks up again");
        afterFirst.Attempt.ShouldBe((short)1);
        afterFirst.LastError.ShouldBe("the parser is broken");
        afterFirst.RunAfter.ShouldBeGreaterThan(
            before.AddSeconds(55),
            "the first rung is one minute (IngestionRetryLadder.Delays[0]); a job rescheduled for "
            + "now() is a hot loop against whatever is already failing");
        afterFirst.RunAfter.ShouldBeLessThan(before.AddSeconds(75));

        seen.ShouldHaveSingleItem().ShouldBe(
            (messageId, correlationId),
            "the correlation id is stamped at receipt and carried through queue, adapter and apply "
            + "(contract §9.5); a job that ran with the right message id and an empty correlation "
            + "id looks entirely healthy and has cut every log line's link back to the POST");

        // The remaining rungs, with run_after pulled forward each time so the test does not wait
        // five and a half hours. That is the ONE thing this test fakes, and it fakes a clock and
        // not the ladder: the value written by the drain is asserted above.
        for (var expected = 2; expected <= IngestionRetryLadder.Attempts; expected++)
        {
            await MakeDueAsync(messageId);

            var rungStart = DateTimeOffset.UtcNow;

            (await drain.TryRunOneAsync(TestContext.Current.CancellationToken)).ShouldBeTrue();

            var row = await ReadJobAsync(messageId);
            var rung = IngestionRetryLadder.Delays[expected - 1];

            row.Status.ShouldBe("PENDING");
            row.Attempt.ShouldBe((short)expected);

            // EVERY rung, not only the first. A drain that always rescheduled onto Delays[0] would
            // satisfy the one-minute assertion above and then retry a four-hour outage sixty times
            // an hour for four hours - which is the shape of the mistake, and it is invisible to a
            // test that checks the first reschedule and stops.
            row.RunAfter.ShouldBeGreaterThan(
                rungStart + rung - TimeSpan.FromSeconds(10),
                $"failure {expected} earns rung {expected - 1} of the ladder, which is {rung}");
            row.RunAfter.ShouldBeLessThan(rungStart + rung + TimeSpan.FromSeconds(10));
        }

        await MakeDueAsync(messageId);

        (await drain.TryRunOneAsync(TestContext.Current.CancellationToken)).ShouldBeTrue();

        var dead = await ReadJobAsync(messageId);

        dead.Status.ShouldBe(
            "DEAD",
            "after the last rung the job is dead-lettered rather than retried again. DEAD is where "
            + "an operator looks for work that never completed; a job that keeps retrying is a job "
            + "that never appears there");
        dead.Attempt.ShouldBe((short)IngestionRetryLadder.Attempts);
        seen.Count.ShouldBe(
            IngestionRetryLadder.Attempts + 1,
            "one first run plus five retries - contract §6.9's ladder, and the same count "
            + "Hangfire's AutomaticRetryAttribute.Attempts produces on the other path");
    }

    [Fact]
    public async Task A_succeeding_job_is_marked_succeeded_and_not_claimed_again()
    {
        var correlationId = Guid.CreateVersion7();
        var messageId = await SeedReceivedMessageAsync(correlationId);

        var handler = Substitute.For<IProcessInboundMessageHandler>();

        await using var db = postgres.CreateContext();
        await new PostgresIngestionJobQueue(db).EnqueueProcessMessageAsync(
            messageId, correlationId, TestContext.Current.CancellationToken);

        var drain = new IngestionJobDrain(
            new SingleScopeFactory(db, handler),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<IngestionJobDrain>.Instance);

        (await drain.TryRunOneAsync(TestContext.Current.CancellationToken)).ShouldBeTrue();

        (await ReadJobAsync(messageId)).Status.ShouldBe("SUCCEEDED");

        await handler.Received(1).HandleAsync(
            messageId, correlationId, Arg.Any<CancellationToken>());

        // And it is not picked up a second time. The claim's WHERE is status = 'PENDING'; a
        // settle that wrote the wrong terminal status would leave the document being processed
        // again on the next tick, for ever, and every run would look successful.
        var claimedAgain = await drain.TryRunOneAsync(TestContext.Current.CancellationToken);

        if (claimedAgain)
        {
            (await ReadJobAsync(messageId)).Status.ShouldBe(
                "SUCCEEDED",
                "the drain claimed something, and if it was this job then a succeeded document is "
                + "being reprocessed on every tick");

            await handler.Received(1).HandleAsync(
                messageId, correlationId, Arg.Any<CancellationToken>());
        }
    }

    /// <summary>
    /// A committed <c>metering.inbound_message</c> for the seeded PVNED BRP, which is what the
    /// job's foreign key points at.
    /// </summary>
    /// <remarks>
    /// Raw SQL rather than plan 2's entity, for the reason the queue itself uses raw SQL: this
    /// suite is about the queue, and reaching for the entity would make a change to plan 2's model
    /// a failure here. <c>payload_hash</c> and <c>payload_uri</c> carry throwaway values — nothing
    /// in this class reads a payload.
    /// </remarks>
    private async Task<Guid> SeedReceivedMessageAsync(Guid correlationId)
    {
        var messageId = Guid.CreateVersion7();

        await using var db = postgres.CreateContext();

        var written = await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO metering.inbound_message
                 (id, brp_id, correlation_id, payload_hash, payload_bytes, payload_uri, status)
             SELECT {messageId}, brp.id, {correlationId}, '\x00'::bytea, 0,
                    'file://ingestion-job-queue-tests/' || {correlationId}::text, 'RECEIVED'
               FROM metering.brp AS brp
              WHERE brp.code = 'PVNED'
             """,
            TestContext.Current.CancellationToken);

        written.ShouldBe(
            1,
            "no metering.brp row with code PVNED - migration 9 seeds it (contract §6.1), so this "
            + "fixture is running against a database plan 2's migration has not reached");

        return messageId;
    }

    private async Task<JobRow> ReadJobAsync(Guid inboundMessageId)
    {
        await using var connection = new NpgsqlConnection(postgres.ConnectionString);

        var row = await connection.QuerySingleOrDefaultAsync<JobRow>(
            new CommandDefinition(
                """
                SELECT status     AS Status,
                       attempt    AS Attempt,
                       run_after  AS RunAfter,
                       last_error AS LastError
                  FROM metering.ingestion_job
                 WHERE inbound_message_id = @message_id
                """,
                new { message_id = inboundMessageId },
                cancellationToken: TestContext.Current.CancellationToken));

        return row.ShouldNotBeNull(
            "no metering.ingestion_job row for that message; the enqueue wrote nothing");
    }

    /// <summary>Pulls a rescheduled job's <c>run_after</c> back to now, so the test need not wait.</summary>
    private async Task MakeDueAsync(Guid inboundMessageId)
    {
        await using var connection = new NpgsqlConnection(postgres.ConnectionString);

        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                UPDATE metering.ingestion_job
                   SET run_after = now()
                 WHERE inbound_message_id = @message_id
                """,
                new { message_id = inboundMessageId },
                cancellationToken: TestContext.Current.CancellationToken));
    }

    /// <summary>
    /// An <c>IServiceScopeFactory</c> whose every scope hands back the one context and the one
    /// handler this test built.
    /// </summary>
    /// <remarks>
    /// The drain takes a scope factory because in the Worker the handler and its
    /// <c>DbContext</c> are scoped and a long-lived background service must not capture either —
    /// <c>OutboundMailService</c>'s reasoning. A test that built a whole container to say that
    /// would be testing the container.
    /// </remarks>
    private sealed class SingleScopeFactory(
        PeakPower.Persistence.PeakPowerDbContext db, IProcessInboundMessageHandler handler)
        : Microsoft.Extensions.DependencyInjection.IServiceScopeFactory,
          Microsoft.Extensions.DependencyInjection.IServiceScope,
          IServiceProvider
    {
        public Microsoft.Extensions.DependencyInjection.IServiceScope CreateScope() => this;

        public IServiceProvider ServiceProvider => this;

        public object? GetService(Type serviceType) =>
            serviceType == typeof(PeakPower.Persistence.PeakPowerDbContext) ? db
            : serviceType == typeof(IProcessInboundMessageHandler) ? handler
            : null;

        public void Dispose()
        {
            // The context and the handler outlive the scope here, deliberately: the test owns both.
        }
    }
}
```

- [ ] **Step 5: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~PostgresIngestionJobQueueTests"
```

Expected: **FAIL to build** —

```
error CS0246: The type or namespace name 'PostgresIngestionJobQueue' could not be found
error CS0246: The type or namespace name 'IngestionJobDrain' could not be found
```

⚠ If it instead fails on `IProcessInboundMessageHandler`, **plan 3 task 1 has not landed**; if it
fails on `metering.inbound_message` at run time, **plan 2's migration 9 has not landed**. Both are
the sequencing table at the top of this pair of tasks, and neither is fixed here.

- [ ] **Step 6: Write the queue**

```bash
mkdir -p /Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Queue
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Queue/PostgresIngestionJobQueue.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Persistence;

namespace PeakPower.Ingestion.Queue;

/// <summary>
/// <see cref="IIngestionJobQueue"/> as a row in <c>metering.ingestion_job</c> — the fallback path
/// of <c>docs/ingestion-job-queue.md</c>, taken because the task 12 spike failed.
/// </summary>
/// <remarks>
/// <para>
/// <b>The INSERT runs on the caller's <see cref="PeakPowerDbContext"/> and opens no transaction of
/// its own.</b> Contract §7.4 places this call after the payload is durable and
/// <c>inbound_message</c> is committed and before the 200 is written, so whatever transaction the
/// webhook has open is the one that commits both the message and its job. A queue that committed
/// separately could write a job for a message that then rolled back — a dequeue against a foreign
/// key that resolves to nothing, failing inside the drain where the request path cannot see it.
/// </para>
/// <para>
/// <b>Raw SQL and no entity.</b> Plan 2 is the only plan that declares one, and this table is queue
/// infrastructure rather than part of the model — the claim in <see cref="IngestionJobDrain"/> is
/// <c>FOR UPDATE SKIP LOCKED</c>, which EF does not express, so an entity would buy a mapping that
/// only one of the two statements could use.
/// </para>
/// </remarks>
public sealed class PostgresIngestionJobQueue(PeakPowerDbContext db) : IIngestionJobQueue
{
    /// <inheritdoc />
    public async Task EnqueueProcessMessageAsync(
        Guid inboundMessageId, Guid correlationId, CancellationToken ct)
    {
        ArgumentOutOfRangeException.ThrowIfEqual(inboundMessageId, Guid.Empty);
        ArgumentOutOfRangeException.ThrowIfEqual(correlationId, Guid.Empty);

        // status, attempt, run_after and created_at all take their column defaults - PENDING, 0,
        // now(), now(). Writing them here would be a second statement of the schema, and the one
        // that is wrong is always the one that is not the database's.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO metering.ingestion_job (inbound_message_id, correlation_id)
             VALUES ({inboundMessageId}, {correlationId})
             """,
            ct);
    }
}
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Queue/IngestionJobDrain.cs`:

```csharp
using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Persistence;

namespace PeakPower.Ingestion.Queue;

/// <summary>
/// Claims one <c>metering.ingestion_job</c> row at a time and hands it to
/// <see cref="IProcessInboundMessageHandler"/>, on the host's own background thread.
/// </summary>
/// <remarks>
/// <para>
/// <b>The shape is <c>OutboundMailService</c>'s and the queue is not.</b> That service drains an
/// in-process <c>Channel</c>, and its own remarks defend dropping whatever is still in it at
/// shutdown — process memory, not an outbox, for a password-reset email. Here <c>[F02-R04]</c>/
/// <c>[F02-R05]</c> have already answered the BRP 200 before any parsing, so a dropped job is a
/// document nobody will ever send again. What is borrowed is the hosted-service shape and the
/// scope per job; what is not is where the queue lives.
/// </para>
/// <para>
/// <b>It opens no transaction of its own</b>, which is the same rule contract §7.6 puts on
/// <c>IDayStateRecomputer</c> and for a related reason: the handler's apply transaction (§9.6) is
/// the one that must commit the readings, and a drain that had already begun one would either nest
/// — which EF refuses outright — or make the handler's commit somebody else's decision. The claim
/// and the settle are one statement each, and a single statement is its own transaction.
/// </para>
/// <para>
/// <b><c>FOR UPDATE SKIP LOCKED</c>, because there can be two drains.</b> A deploy replaces the
/// Worker container while the old one is still running and both are pointed at one database. Plain
/// <c>SELECT … LIMIT 1</c> hands them the same row; without <c>SKIP LOCKED</c> the second one does
/// not take the row twice — it BLOCKS on the first's lock, which is a second container that
/// appears healthy and processes nothing.
/// </para>
/// <para>
/// <b>A failure is a rung, not a swallow.</b> The handler's exception is caught — one escaping here
/// would end the drain for every job behind it, which is <c>OutboundMailService</c>'s reasoning
/// unchanged — and then written back as an attempt, a <c>last_error</c> and a <c>run_after</c> one
/// rung along <see cref="IngestionRetryLadder"/>. After the last rung the row is <c>DEAD</c>, which
/// is where an operator looks for work that never completed.
/// </para>
/// <para>
/// <b>Polling, at one second.</b> There is no <c>LISTEN/NOTIFY</c> here: a notification is lost if
/// nothing is listening at the moment it fires, so a drain restarting during a deploy would miss
/// every job enqueued in that second and the row would sit <c>PENDING</c> until something else
/// happened to poll. One second is well inside <c>[NFR-03]</c>'s budget and costs one indexed query
/// against <c>ix_job_claimable</c>.
/// </para>
/// </remarks>
public sealed class IngestionJobDrain(
    IServiceScopeFactory scopes,
    ILogger<IngestionJobDrain> logger) : BackgroundService
{
    /// <summary>
    /// The claim, as one statement — <c>internal</c> because
    /// <c>PostgresIngestionJobQueueTests</c> runs it twice concurrently against one row, and the
    /// only honest way to assert "exactly one drain gets it" is to issue the real statement.
    /// </summary>
    internal const string ClaimSql =
        """
        UPDATE metering.ingestion_job
           SET status = 'CLAIMED', claimed_at = now(), claimed_by = @claimed_by
         WHERE id = (
               SELECT id
                 FROM metering.ingestion_job
                WHERE status = 'PENDING' AND run_after <= now()
                ORDER BY run_after
                LIMIT 1
                FOR UPDATE SKIP LOCKED)
        RETURNING id
        """;

    private static readonly TimeSpan IdlePollInterval = TimeSpan.FromSeconds(1);

    /// <summary>Who holds the claim, for a human reading the table during an incident.</summary>
    private static readonly string ClaimedBy =
        $"{Environment.MachineName}/{Environment.ProcessId}";

    private sealed record ClaimedJob(
        Guid Id, Guid InboundMessageId, Guid CorrelationId, short Attempt);

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var claimed = false;

            try
            {
                claimed = await TryRunOneAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                // The handler's own failures are caught inside TryRunOneAsync and written onto the
                // row. This catch is for the database being unreachable - the claim itself
                // throwing - and it must not end the loop: a drain that stopped on the first
                // connection failure would leave every later document PENDING for ever, with the
                // stack otherwise looking healthy.
                logger.LogError(exception, "The ingestion job drain could not claim a job.");
            }

            if (!claimed)
            {
                await Task.Delay(IdlePollInterval, stoppingToken);
            }
        }
    }

    /// <summary>
    /// Claims one due job, runs it, and settles the row. <see langword="false"/> when there was
    /// nothing to claim.
    /// </summary>
    /// <remarks>
    /// <c>internal</c> so the integration tests can drive exactly one job and assert on the row
    /// afterwards. Starting the <see cref="BackgroundService"/> and sleeping would be a test that
    /// fails on a slow machine and passes on a fast one, which is the failure mode this repository
    /// has already met once in <c>OutboundMailService</c>'s remarks.
    /// </remarks>
    internal async Task<bool> TryRunOneAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PeakPowerDbContext>();

        var job = await ClaimAsync(db, ct);
        if (job is null) return false;

        string? failure = null;

        try
        {
            await scope.ServiceProvider.GetRequiredService<IProcessInboundMessageHandler>()
                .HandleAsync(job.InboundMessageId, job.CorrelationId, ct);
        }
        catch (Exception exception)
        {
            // Caught for OutboundMailService's reason - an exception escaping here ends the drain
            // for every job behind this one - and NOT swallowed: it goes back onto the row as an
            // attempt, a last_error and the next rung.
            failure = exception.Message;

            logger.LogError(
                exception,
                "Ingestion job {JobId} for message {InboundMessageId} failed on attempt {Attempt}.",
                job.Id,
                job.InboundMessageId,
                job.Attempt + 1);
        }

        await SettleAsync(db, job, failure, ct);

        return true;
    }

    private static async Task<ClaimedJob?> ClaimAsync(PeakPowerDbContext db, CancellationToken ct)
    {
        var connection = db.Database.GetDbConnection();

        if (connection.State != ConnectionState.Open)
        {
            await connection.OpenAsync(ct);
        }

        await using var command = connection.CreateCommand();

        // The RETURNING list is wider here than in ClaimSql, which the test uses: the test needs
        // to know only WHETHER a row was taken, and this needs what to run.
        command.CommandText = ClaimSql.Replace(
            "RETURNING id",
            "RETURNING id, inbound_message_id, correlation_id, attempt",
            StringComparison.Ordinal);

        var claimedBy = command.CreateParameter();
        claimedBy.ParameterName = "claimed_by";
        claimedBy.Value = ClaimedBy;
        command.Parameters.Add(claimedBy);

        await using var reader = await command.ExecuteReaderAsync(ct);

        if (!await reader.ReadAsync(ct)) return null;

        return new ClaimedJob(
            reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetInt16(3));
    }

    private static Task SettleAsync(
        PeakPowerDbContext db, ClaimedJob job, string? failure, CancellationToken ct)
    {
        if (failure is null)
        {
            return db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 UPDATE metering.ingestion_job
                    SET status = 'SUCCEEDED', last_error = NULL
                  WHERE id = {job.Id}
                 """,
                ct);
        }

        // job.Attempt is the number of retries already scheduled, so it indexes the rung this
        // failure earns: the first failure reads Delays[0] and every rung is reachable. When it has
        // reached Attempts there is no rung left and the job is dead-lettered.
        if (job.Attempt >= IngestionRetryLadder.Attempts)
        {
            return db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 UPDATE metering.ingestion_job
                    SET status = 'DEAD', last_error = {failure}
                  WHERE id = {job.Id}
                 """,
                ct);
        }

        var delay = IngestionRetryLadder.Delays[job.Attempt];

        return db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE metering.ingestion_job
                SET status = 'PENDING',
                    attempt = {job.Attempt + 1},
                    last_error = {failure},
                    run_after = now() + {delay}
              WHERE id = {job.Id}
             """,
            ct);
    }
}
```

⚠ `internal` members are invisible to the test assembly until it is told. Add to
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj`,
as a new `<ItemGroup>` — the same shape `PeakPower.Worker.csproj` already carries:

```xml
  <ItemGroup>
    <!-- PostgresIngestionJobQueueTests drives IngestionJobDrain.TryRunOneAsync one job at a time
         and issues ClaimSql twice concurrently against one row. Both are internal because neither
         is a caller's business: the Worker registers the hosted service and never touches either. -->
    <InternalsVisibleTo Include="PeakPower.Integration.Tests" />
  </ItemGroup>
```

- [ ] **Step 7: Register it, run it, and watch it pass**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Queue/IngestionQueueServiceCollectionExtensions.cs`:

```csharp
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Application.Abstractions.Ingestion;

namespace PeakPower.Ingestion.Queue;

/// <summary>Registers what sits behind <see cref="IIngestionJobQueue"/> in the Worker.</summary>
/// <remarks>
/// One entry point, so the Worker's <c>Program.cs</c> names the port and not the implementation.
/// The choice between a Postgres claim queue and Hangfire is recorded in
/// <c>docs/ingestion-job-queue.md</c>, and swapping it is this file plus two classes.
/// </remarks>
public static class IngestionQueueServiceCollectionExtensions
{
    public static IServiceCollection AddIngestionJobQueue(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        // Scoped, because it writes through the caller's PeakPowerDbContext: the enqueue has to
        // land in the webhook's own transaction, beside the inbound_message row it points at.
        services.AddScoped<IIngestionJobQueue, PostgresIngestionJobQueue>();

        // And the dequeue side. Without it the Worker writes rows nothing reads - which, from the
        // request path, is indistinguishable from a queue that works.
        services.AddHostedService<IngestionJobDrain>();

        return services;
    }
}
```

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Program.cs` and
insert between `builder.AddServiceDefaults();` and `var app = builder.Build();`:

```csharp

// What sits behind IIngestionJobQueue - docs/ingestion-job-queue.md records the spike that chose
// it, and this is the only line in any host that knows which it is. The Worker is the only process
// that drains: the two APIs enqueue nothing, and a second drain in an API would take jobs a
// customer-facing host has no business running.
builder.Services.AddIngestionJobQueue();
```

and add `using PeakPower.Ingestion.Queue;` to that file's `using` block.

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~PostgresIngestionJobQueueTests"
dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~WorkerHostTests"
```

Expected: PASS on both — 4 passed and 4 passed.

- [ ] **Step 8: Two mutations, and they must redden two different tests**

**First — delete `SKIP LOCKED` from `IngestionJobDrain.ClaimSql`**, leaving `FOR UPDATE`.

Run: `dotnet test tests/PeakPower.Integration.Tests --nologo --filter "FullyQualifiedName~PostgresIngestionJobQueueTests"`

Expected: **FAIL**, exactly one, and it fails by **timing out rather than by taking the row twice**:

```
Two_concurrent_claims_take_the_row_once [FAIL]
  Npgsql.NpgsqlException : Exception while reading from stream
   ---> System.TimeoutException: Timeout during reading attempt
```

⚠ **That is the failure mode worth understanding, and it is not the one a reader predicts.** Plain
`FOR UPDATE` does not hand the row to both drains — it makes the second one WAIT on the first
transaction's lock. So the symptom on a real deployment is not a document processed twice; it is a
second Worker container that starts, reports healthy, and processes nothing for as long as the
first container's current job runs. The test's five-second `commandTimeout` is what turns that into
a failure rather than into a test that never ends, and the assertion's own message says which of
the two outcomes each result means.

**Second — change `SettleAsync`'s rung from `IngestionRetryLadder.Delays[job.Attempt]` to
`IngestionRetryLadder.Delays[0]`.** This is the plausible wrong version: it compiles, it is one
character shorter, and the first reschedule is identical.

Run the same command. Expected: **FAIL**, exactly one, and a **different** one:

```
A_failing_job_climbs_the_ladder_and_then_dies [FAIL]
  failure 2 earns rung 1 of the ladder, which is 00:05:00
  run_after should be greater than <2026-09-07T…+00:04:50> but was <2026-09-07T…+00:00:60>
```

and `Two_concurrent_claims_take_the_row_once` stays **green**.

⚠ Two mutations that redden two different tests is the point of running both. A suite where every
mutation reddens everything is one assertion wearing four names, and this one was written to have
four subjects: the enqueue's defaults, the claim's exclusivity, the ladder's rungs, and the
terminal status.

Restore both and re-run: PASS — 4 passed.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Persistence/Migrations/ \
        src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj \
        src/Infrastructure/PeakPower.Ingestion/Queue/ \
        src/Hosts/PeakPower.Worker/Program.cs \
        tools/verify-migrator.sh \
        tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj \
        tests/PeakPower.Application.Tests/Ingestion/IngestionRetryLadderTests.cs \
        tests/PeakPower.Integration.Tests/Ingestion/PostgresIngestionJobQueueTests.cs
git commit -m "feat(ingestion): IIngestionJobQueue as a Postgres claim queue

The task 12 spike failed - docs/ingestion-job-queue.md records where and with what - so
IIngestionJobQueue is metering.ingestion_job drained by a hosted BackgroundService, on the shape
PeakPower.Infrastructure.Email/OutboundMailService.cs already establishes here. Contract 6.9 gives
the table verbatim and names it as plan 1's, not plan 2's; it is migration 10, and it is the one
piece of migration SQL in this slice that plan 2 does not own.

WHAT IS BORROWED FROM OutboundMailService IS THE SHAPE AND NOT THE QUEUE. That service drains
process memory and its own remarks defend dropping what is still in it at shutdown, for a
password-reset email. Here [F02-R04]/[F02-R05] have already answered the BRP 200 before any
parsing, so a dropped job is a document nobody will ever send again - hence a table, a claim, and a
ladder written back onto the row.

The drain opens no transaction of its own, which is the same rule contract 7.6 puts on
IDayStateRecomputer and for a related reason: the handler's apply transaction (9.6) is the one that
has to commit the readings, and a drain holding one would either nest - which EF refuses - or make
that commit somebody else's decision. Claim and settle are one statement each.

Retry ladder 1 m / 5 m / 15 m / 1 h / 4 h, five retries after the first run, then DEAD - the same
count Hangfire's AutomaticRetryAttribute.Attempts produces on the other path, so the two
implementations of this port behave identically and the recorded decision describes one ladder.

Mutation-verified twice, deliberately with two mutations that redden two different tests. Dropping
SKIP LOCKED does not return the row twice - it BLOCKS, so a second Worker container would start,
report healthy and process nothing; the concurrent-claim test fails by timing out and says so.
Rescheduling always onto Delays[0] leaves that test green and reddens the ladder walk at failure 2,
which is the reason every rung is asserted rather than only the first."
```

---
