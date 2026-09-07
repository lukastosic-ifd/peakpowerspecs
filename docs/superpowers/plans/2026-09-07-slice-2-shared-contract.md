# Slice 2 — Shared Contract

> Referenced by every slice-2 plan. **This file is normative.** Where a plan and this file
> disagree, this file wins and the plan is wrong. Names here are the ones that cross plan
> boundaries, so changing one is a change to several plans at once.
>
> Eight plans are written in parallel by people who cannot see each other's work. Anything two
> of them must agree on is pinned here, exactly. A plan that invents a name this file already
> gives is not a style difference — it is a duplicate-member compile error or a 500 at runtime.

**Design:** [`../specs/2026-09-07-poc-slice-2-design.md`](../specs/2026-09-07-poc-slice-2-design.md)
**Predecessor contract:** [`2026-08-26-slice-1-shared-contract.md`](2026-08-26-slice-1-shared-contract.md) — still in force for everything slice 1 shipped. This file **adds**; it repeals only what it names.

---

## 0. How to read this file

| Marker | Meaning |
| --- | --- |
| **NORMATIVE, owned by plan N** | Only plan N writes it. Every other plan reads it and must not restate it in its own code. |
| **FROZEN** | The shape may not change during the slice. Plans on both sides of it are written in parallel against this text and nothing else. |
| ⚠ | A place where the obvious implementation is wrong, and the reason. |
| **DECIDED HERE** | The design document did not settle it. §16 lists every one of these in one place. |

---

## 1. Versions — exact, verified 2026-09-07

Read today from `peakpower-platform/global.json`, `Directory.Packages.props`,
`Directory.Build.props`, `peakpower-web/package.json` and `package-lock.json`. **These are not
slice 1's numbers**; four of them moved.

| | |
| --- | --- |
| .NET SDK | **10.0.400** (`global.json`, `rollForward: latestFeature`) |
| Target framework | **net10.0**, `LangVersion latest`, `Nullable enable`, `TreatWarningsAsErrors`, `AnalysisMode Recommended` |
| EF Core | **10.0.11** (`Microsoft.EntityFrameworkCore`, `.Design`, `.Relational`) |
| Npgsql | **10.0.3** (`Npgsql`, `Npgsql.EntityFrameworkCore.PostgreSQL`) |
| `EFCore.NamingConventions` | **10.0.1** |
| PostgreSQL | **17** (Testcontainers image and Aspire `WithImageTag("17")`) |
| Aspire | **13.5.3** — `aspire.cli` global tool + `Aspire.AppHost.Sdk`. **NOT a `dotnet workload`.** `Aspire.Hosting.AppHost` / `.Docker` / `.PostgreSQL` / `.JavaScript` / `.Testing` / `Aspire.Npgsql.EntityFrameworkCore.PostgreSQL` all **13.5.3** |
| Angular | **22.1.3** runtime (`@angular/core`), **22.1.6** tooling (`@angular/cli`, `@angular/build`) |
| TypeScript | **6.0.3** |
| Vitest | **4.1.11** · jsdom **30.0.1** · Playwright **1.56.1** |
| rxjs | **7.8.2** · tslib **2.8.1** · `ng-packagr` **22.1.1** · `openapi-typescript` **7.13.0** |
| Node types | `@types/node` **24.13.3** |

**Test and tooling packages already pinned** (do not re-pin, do not bump):

| Package | Version |
| --- | --- |
| `xunit.v3` | **3.2.2** (+ `xunit.runner.visualstudio` 3.1.5, `Microsoft.NET.Test.Sdk` 18.9.0) |
| `Shouldly` | **4.3.0** — ⚠ **never FluentAssertions** `[DEC-118]` |
| `NSubstitute` | **6.2.0** |
| `NetArchTest.Rules` | **1.3.2** · `Mono.Cecil` **0.11.6** |
| `Testcontainers.PostgreSql` | **4.14.0** |
| `Verify.XunitV3` | **30.15.0** — ⚠ **not `Verify.Xunit`**, which collides with xunit.v3 on `FactAttribute` (CS0433) |
| `Dapper` | **2.1.66** |
| `Microsoft.AspNetCore.Mvc.Testing` / `.TestHost` | **10.0.11** |
| `Microsoft.Extensions.TimeProvider.Testing` | **10.9.0** |
| `FluentValidation` / `.DependencyInjectionExtensions` | **12.0.0** |
| `Microsoft.Extensions.Http` / `.Hosting` / `.Hosting.Abstractions` / `.Configuration.Abstractions` | **10.0.11** |
| `Microsoft.Extensions.Http.Resilience` / `.ServiceDiscovery` | **10.9.0** · `Polly.Core` **8.4.2** |
| `Microsoft.AspNetCore.OpenApi` | **10.0.11** |

### 1.1 Hangfire — the candidate, and its compatibility status

**Plan 1 owns the spike; every other plan codes against `IIngestionJobQueue` (§7.4) and never
against Hangfire.** This is the whole point of naming the port before the spike runs.

| Package | Candidate version | What was established today |
| --- | --- | --- |
| `Hangfire.Core` | **1.8.25** | Latest on nuget.org 2026-09-07 |
| `Hangfire.AspNetCore` | **1.8.25** | Latest on nuget.org 2026-09-07 |
| `Hangfire.PostgreSql` | **1.21.1** | Latest on nuget.org 2026-09-07. Read from its `.nuspec`: **targets `netstandard2.0` only**, depends on `Hangfire.Core >= 1.8.0`, `Npgsql >= 6.0.11`, `Dapper >= 2.0.123`, `Dapper.AOT >= 1.0.48`, `Microsoft.CSharp >= 4.7.0` |

**What that establishes and what it does not.** The dependency floors are floors, so Npgsql
**10.0.3** and Dapper **2.1.66** satisfy them by version and NuGet will not downgrade them; a
`netstandard2.0` package loads on `net10.0` without an NU1701. **What is not established is
whether the library's ADO.NET usage still compiles and runs against Npgsql 10's API surface** —
a `netstandard2.0` assembly built against Npgsql 6 binds at runtime, and a removed member is a
`MissingMethodException` on first use, not a build error. That is exactly what the spike is for.
`Dapper.AOT` is a **new transitive dependency** the repo does not have today and is the second
thing to look at.

**The fallback is normative if the spike fails**, and it is not a smaller Hangfire: a
`metering.ingestion_job` claim queue (§6.9) drained by a hosted `BackgroundService` on the
pattern `PeakPower.Infrastructure.Email/OutboundMailService.cs` already establishes in this
repository. Either way **the Hangfire dashboard stays off** (`[OQ-57]` does not block), and
either way plans 3–8 are unchanged.

---

## 2. Repositories, CI and deployment

```
/Users/thinhhuynh/PeakPower/peakpower-platform      # .NET
/Users/thinhhuynh/PeakPower/peakpower-web           # Angular — siblings, and the AppHost relies on it
```

Both are published privately under **`peakpower-nl`**. `tools/verify-repositories.sh` fails if
`origin` is missing or points elsewhere.

**Slice 2 adds CI in both repositories, gating deploy.** Plan 1 owns both workflows.

| Repository | Job runs |
| --- | --- |
| `peakpower-platform` | `dotnet build PeakPower.sln -warnaserror` · `dotnet test PeakPower.sln` (Docker for Testcontainers) · `tools/verify-aspire-api.sh` · `tools/verify-build-settings.sh` · `tools/verify-migrator.sh` · `tools/verify-repositories.sh` · `tools/verify-solution-layout.sh` |
| `peakpower-web` | `npm ci` · `npm test` (which is `test:workspace` + `test:shared-ui` + `test:customer-portal` + `test:employee-portal`) with a **second checkout of `peakpower-platform` beside it** |

⚠ **The zero-skip assertion is part of the CI job, not a nice-to-have.** `AppHost.Tests` silently
loses `ComposeRuntimeTests`, `PublishedStackTests`, most of `ImageBuildTests`,
`PortalOutputPathTests` and all of `FrontEndInstallTests` when `peakpower-web` is not checked
out beside the platform — 29 `Assert.SkipWhen(builder is null, "no peakpower-web checkout; the
portals are not in the graph")` call sites plus `PublishedStackTests.SkipWithoutTheWebCheckout()`
and `PortalOutputPathTests`' two variants. The CI job **asserts `AppHost.Tests` reports zero
skipped**, and across the solution that the set of skipped test names equals a checked-in
allow-list at `tests/skipped-tests.allowlist.txt`. Re-measure the passed/skipped split when you
implement this; the design's 64/60 figure is explicitly flagged as stale.

Deploy workflows in both repositories gain `needs:` on the test job, a cross-repository `flock`
so the two deploys cannot build concurrently, and a bounded image prune.

**Deployment shape.** `deploy/docker-compose.yaml` is **generated by `aspire publish -o ./deploy`
and committed** — the server has no .NET SDK, and hand edits are discarded on the next publish.
Slice 2 adds the Worker host and the raw-payload volume to the AppHost, re-publishes, commits the
regenerated file, adds a Worker runtime stage to `deploy/Dockerfile`, and extends
`deploy/env.example`. **`PeakPower.DevStubs` does not ship in the compose file**; it runs from a
developer machine against the deployed webhook with the same `BRP_CREDENTIAL_PVNED` value.

**Roll forward only — S2-D7.** The deployed `DatabaseMigrator` calls only `MigrateAsync`, so
`Down()` is never invoked in the shipped path. Migration 9 still writes a correct `Down()`
(a developer may run `dotnet ef database update <earlier>` by hand) but **no plan may rely on it**.

---

## 3. Naming

- .NET namespace root `PeakPower.` — e.g. `PeakPower.Ingestion.Pipeline`
- npm scope `@peakpower-nl/`
- Database: snake_case, singular, schema-qualified — `metering.interval_data_version`
- C#: PascalCase; EF Core maps to snake_case by convention, never per-property attributes
- ⚠ **`delivery_date` is the column name for a metering day, on every one of the seven new
  tables.** See §6.7 for the one place this deviates from published DDL and why.

### 3.1 Projects — twenty-two, not eighteen

Four new projects. `verify-solution-layout.sh`'s hardcoded `expected` array grows **18 → 22**;
its header comment "the eighteen slice-1 projects" becomes "the twenty-two projects".

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
makes the arithmetic 22 rather than 24, and `verify-solution-layout.sh`'s array is the assertion.

The four lines to add to `expected=(` in `tools/verify-solution-layout.sh`, verbatim:

```
  "src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj"
  "src/Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj"
  "src/Hosts/PeakPower.Worker/PeakPower.Worker.csproj"
  "src/Hosts/PeakPower.DevStubs/PeakPower.DevStubs.csproj"
```

⚠ **`PeakPower.Ingestion` MUST live at `src/Infrastructure/PeakPower.Ingestion`.** Not because
of taste: `CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter` skips today with a message
that names the `<ProjectReference>` to add **verbatim**, and that path is inside it
(`tests/PeakPower.Architecture.Tests/CallSiteFacts.cs:38`):

```
<ProjectReference Include="../../src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj" />
```

Adding that line to `tests/PeakPower.Architecture.Tests/PeakPower.Architecture.Tests.csproj` is
what arms the fact. Plan 1 owns it. Design §7.22 requires it to be mutation-verified: add a
reference from `PeakPower.Ingestion` to `PeakPower.Integration.Brp.Pvned` and watch the fact go
red with *"PeakPower.Ingestion must talk to BRP adapters through a port, never by referencing one"*.

**Where a test for the new code goes:**

| Kind of test | Project |
| --- | --- |
| Calendar, adapter parsing, canonical mapping, quantity maths — no I/O | `tests/PeakPower.Application.Tests` |
| Anything touching PostgreSQL, HTTP, the webhook, the queue, RLS, OpenAPI | `tests/PeakPower.Integration.Tests` |
| The four architecture facts and the new `CallSiteFacts` arming | `tests/PeakPower.Architecture.Tests` |
| The regenerated compose file, the Worker image stage | `tests/PeakPower.AppHost.Tests` |

**Project references, and what each new project may see:**

| Project | References |
| --- | --- |
| `PeakPower.Ingestion` | `PeakPower.Application`, `PeakPower.Domain`, `PeakPower.Persistence`. ⚠ **Never any `PeakPower.Integration.Brp.*`** — architecture fact 3 |
| `PeakPower.Integration.Brp.Pvned` | `PeakPower.Application`, `PeakPower.Domain`. ⚠ **Never `PeakPower.Ingestion`** — the port points one way |
| `PeakPower.Worker` | `PeakPower.Ingestion`, `PeakPower.Integration.Brp.Pvned`, `PeakPower.Persistence`, `PeakPower.Infrastructure.Time`, `PeakPower.ServiceDefaults`. **This is the composition root that binds the adapter to the port, and the only *host with a webhook* that sees both; `PeakPower.Api.Employee` also composes both, solely so §10.4's replay can answer with real counts — pinned by `ReplayCompositionFacts`** |
| `PeakPower.DevStubs` | `PeakPower.Contracts` only, plus `Microsoft.Extensions.Http`/`.Hosting`. ⚠ **Never the adapter, never `PeakPower.Ingestion`** — S2-D4: the generator emits templated XML **text**, so it must not be able to reach the parser's model |

**Host entry-point marker.** Slice 1's rule stands: no host declares `public partial class Program`.

```csharp
namespace PeakPower.Worker;
public sealed class WorkerEntryPoint;      // WebApplicationFactory<WorkerEntryPoint>
```

`PeakPower.DevStubs` is a console host and declares no marker.

---

## 4. Enums — the database spelling is normative

Same rule as slice 1: **the database spelling is normative and it extends to JSON**
(`SCREAMING_SNAKE`, not `"Provisional"`). All of these persist as **text** through the existing
`EnumToScreamingSnakeConverter<T>` registered by `EnumToTextConvention`, and serialise through the
one shared `JsonStringEnumConverter` wired by `EnumWireFormat`.

⚠ **No slice-2 enum member may contain two adjacent capitals.** Slice 1's §5.2 amendment records
that `EnumWireFormat` (`JsonNamingPolicy.SnakeCaseUpper`, a capital run is one word) and
`EnumToScreamingSnakeConverter` (breaks before **every** capital) diverge the moment two capitals
sit together — and that a stored wire spelling makes the read path **throw**, not merely
disagree. Every member below has been checked: each has only isolated capitals, so both
algorithms produce the same string. `BrpFeed` → `BRP_FEED` under both. `UnknownEan` →
`UNKNOWN_EAN` under both. Adding a member spelled `BRPFeed` or `EANValidity` would reopen the
`LegalEntityType.BV` failure on a table nobody has migrated.

```csharp
namespace PeakPower.Domain.Metering;

public enum InboundMessageStatus { Received, Processing, Processed, Failed, Duplicate }
// db/wire: RECEIVED | PROCESSING | PROCESSED | FAILED | DUPLICATE
// Published DDL §3.2 already fixes this set. Do not add members.

public enum IntervalDataVersionSource { BrpFeed, Manual }
// db/wire: BRP_FEED | MANUAL          — S2-D2. MANUAL is storable and unreachable in slice 2.

public enum IntervalDirection { Consumption, Production }
// db/wire: CONSUMPTION | PRODUCTION   — the PVNed A02/A01 mapping is in §8.2.

public enum QuarantineReason { UnknownEan, EanValidity, WrongBrp, NotElectricity }
// db/wire: UNKNOWN_EAN | EAN_VALIDITY | WRONG_BRP | NOT_ELECTRICITY

public enum MeteringDayState { NoData, Partial, Provisional, Final }
// db/wire: NO_DATA | PARTIAL | PROVISIONAL | FINAL     [F02-R22]
// ⚠ There is no COMPLETE member. F02 §6's state machine goes NO_DATA → PARTIAL → PROVISIONAL →
//   FINAL, and integration-spec §8.3's word "Complete" is the CONDITION that moves a day to
//   PROVISIONAL, not a fifth state. A plan that adds COMPLETE breaks the day-state column CHECK.

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

**Adapter-internal, not persisted as an enum column** — these live in
`PeakPower.Integration.Brp.Pvned` and never reach the database:

```csharp
namespace PeakPower.Integration.Brp.Pvned;

public enum PvnedDocumentType { Allocation, Imbalance }   // A23 → Allocation, A12 → Imbalance
```

`ProductionExpectation` (`UNKNOWN | NEVER | EXPECTED`) and `ProductionExpectationSource`
(`CONTRACT | GRID_OPERATOR | OBSERVED | MANUAL | CUSTOMER_DECLARED`) are **slice 1's, unchanged —
no member is added or removed**. `[F02-R34]`'s promotion writes `ProductionExpectation.Expected`
with `ProductionExpectationSource.Observed`.

⚠ **Neither column carries a database `CHECK` today** — verified against `InitialSchema`; the
value set is enforced by `EnumToScreamingSnakeConverter` alone. Migration 9 adds **one** check
touching them, `ck_mp_never_has_no_observed_production` (§6.2), and adds no value-set check.
⚠ The source column is named **`expectation_source`**, not `production_expectation_source` — the
published DDL disagrees with what shipped, and what shipped wins.

---

## 5. Domain — types that cross plan boundaries

**NORMATIVE. Plan 2 declares every entity below; plans 3, 5, 6 and 8 call them and must never
re-declare one.** Two plans declaring the same class is a duplicate-member compile error, not a
merge. Slice 1's rule that every fallible operation returns `Result<T>` still holds.

```csharp
namespace PeakPower.Domain.Metering;

/// The stored raw document. One row per POST that got past auth and the size cap.
public sealed class InboundMessage                              // metering.inbound_message
{
    public Guid Id { get; }
    public Guid BrpId { get; }
    public Guid CorrelationId { get; }        // stamped at receipt, carried to every log line
    public DateTimeOffset ReceivedAt { get; }
    public byte[] PayloadHash { get; }        // SHA-256, 32 bytes
    public long PayloadBytes { get; }
    public string PayloadUri { get; }         // IRawPayloadStore's opaque handle — §7.3
    public string? HttpHeaders { get; }       // jsonb
    public string? RemoteIp { get; }          // inet
    public InboundMessageStatus Status { get; }
    public string? FailureCode { get; }       // an §8.4 code, or a pipeline code
    public string? FailureDetail { get; }
    public DateTimeOffset? ProcessedAt { get; }

    public static Result<InboundMessage> Receive(
        Guid brpId, Guid correlationId, DateTimeOffset receivedAt,
        byte[] payloadHash, long payloadBytes, string payloadUri,
        string? httpHeaders, string? remoteIp);

    public void BeginProcessing();                                     // RECEIVED → PROCESSING
    public void MarkProcessed(DateTimeOffset at);                      // → PROCESSED
    public void MarkFailed(string failureCode, string failureDetail, DateTimeOffset at);
    public void MarkDuplicate(DateTimeOffset at);
}

/// One version of one direction of one day, from one document.  [DEC-07], [F02-R16]
public sealed class IntervalDataVersion                         // metering.interval_data_version
{
    public Guid Id { get; }
    public Guid MeteringPointId { get; }
    public Guid CustomerId { get; }           // ⚠ S2-D1. Denormalised, NOT NULL. See §5.1.
    public DateOnly DeliveryDate { get; }
    public IntervalDirection Direction { get; }
    public IntervalDataVersionSource Source { get; }             // S2-D2
    public string? DocumentId { get; }        // PVNed DocumentIdentification; null when MANUAL
    public DateTimeOffset? DocumentCreated { get; }              // null when MANUAL
    public DateTimeOffset ReceivedAt { get; }                    // ⚠ THE ORDERING KEY — §4.2
    public Guid? InboundMessageId { get; }                       // null when MANUAL — S2-D2
    public Guid CorrelationId { get; }
    public short IntervalCount { get; }                          // 92 | 96 | 100
    public bool IsCurrent { get; }
    public DateTimeOffset CreatedAt { get; }

    public static Result<IntervalDataVersion> FromBrpFeed(
        Guid meteringPointId, Guid customerId, DateOnly deliveryDate,
        IntervalDirection direction, string documentId, DateTimeOffset documentCreated,
        DateTimeOffset receivedAt, Guid inboundMessageId, Guid correlationId, short intervalCount);

    public void Supersede();                  // IsCurrent = false. NEVER deletes.  [F02-R18]
}

/// One point. Immutable once written; a correction is a new version, never an UPDATE.
public sealed class IntervalReading                              // metering.interval_reading
{
    public Guid VersionId { get; }
    public DateOnly DeliveryDate { get; }     // partition key, and part of the PK
    public Guid CustomerId { get; }           // ⚠ S2-D1
    public short Pos { get; }                 // 1..100
    public DateTimeOffset IntervalStart { get; }   // from IMarketCalendar.IntervalStart — §7.5
    public decimal QuantityKwh { get; }       // numeric(14,3), >= 0  [AS-05]
}

/// The materialised data state per (metering point, delivery date).  [F02-R22]
public sealed class MeteringPointDayState                  // metering.metering_point_day_state
{
    public Guid MeteringPointId { get; }
    public DateOnly DeliveryDate { get; }
    public Guid CustomerId { get; }           // ⚠ S2-D1
    public MeteringDayState State { get; }
    public short ExpectedIntervalCount { get; }
    public bool ConsumptionComplete { get; }
    public bool ProductionComplete { get; }
    public bool ProductionIsDeclaredZero { get; }   // production_expectation = NEVER  [F02-R33]
    public DateTimeOffset? FinalisedAt { get; }
    public DateTimeOffset? LastCorrectedAt { get; } // the chart's corrected-on marker
    public DateTimeOffset ComputedAt { get; }
}

/// A series that could not be attached to a metering point.  [F02-R14], [F02-R15]
public sealed class QuarantinedSeries                          // metering.quarantined_series
{
    public Guid Id { get; }
    public Guid InboundMessageId { get; }
    public Guid BrpId { get; }
    public QuarantineReason Reason { get; }
    public string ResourceObject { get; }     // verbatim from the document, EAN or label
    public DateOnly DeliveryDate { get; }
    public IntervalDirection Direction { get; }
    public short PointCount { get; }
    public DateTimeOffset ReceivedAt { get; }
    public DateTimeOffset? ResolvedAt { get; }
    public string? ResolvedBy { get; }
    public Guid? ResolvedByReplayOfMessageId { get; }
}

/// The daily rollup.  Design §4.1 — the offtake and export accumulators are the whole point.
public sealed class DailyPosition                                  // metering.daily_position
{
    public Guid MeteringPointId { get; }
    public DateOnly DeliveryDate { get; }
    public Guid CustomerId { get; }           // ⚠ S2-D1
    public decimal ConsumptionKwh { get; }    // Σ cᵢ
    public decimal ProductionKwh { get; }     // Σ pᵢ
    public decimal NetUsageKwh { get; }       // Σ (cᵢ − pᵢ) — may be negative
    public decimal OfftakeKwh { get; }        // Σ max(cᵢ − pᵢ, 0)   ⚠ NOT max(NetUsageKwh, 0)
    public decimal ExportKwh { get; }         // Σ |min(cᵢ − pᵢ, 0)| ⚠ NOT max(−NetUsageKwh, 0)
    public MeteringDayState DataState { get; }
    public Guid[] SourceVersionIds { get; }   // uuid[] — makes invalidation exact
    public DateTimeOffset ComputedAt { get; }
}

/// The conditions of F02-R12/R26/R34/R35/R45. Built and tested; no channel delivers them (§3.2).
public sealed class OperationalAlert                            // metering.operational_alert
{
    public Guid Id { get; }
    public OperationalAlertKind Kind { get; }
    public OperationalAlertStatus Status { get; }
    public Guid? MeteringPointId { get; }
    public Guid? BrpId { get; }
    public Guid? InboundMessageId { get; }
    public DateOnly? DeliveryDate { get; }
    public string Summary { get; }            // one sentence, sentence case, ends with a full stop
    public string? Detail { get; }
    public DateTimeOffset RaisedAt { get; }
    public DateTimeOffset? ResolvedAt { get; }
}

/// Who moved a metering point to another BRP, when, and why.  [F02-R43]
public sealed class MeteringPointBrpAssignment       // customer.metering_point_brp_assignment
{
    public Guid Id { get; }
    public Guid MeteringPointId { get; }
    public Guid? FromBrpId { get; }           // null on the first assignment
    public Guid ToBrpId { get; }
    public DateTimeOffset AssignedAt { get; }
    public string AssignedBy { get; }         // employee id, or "system:migration-9"
    public string Reason { get; }             // mandatory, non-empty
}
```

⚠ **Exactly four of these carry a `CustomerId` property, and the number is load-bearing.**
`IntervalDataVersion`, `IntervalReading`, `MeteringPointDayState` and `DailyPosition` — and no
others. Both RLS coverage guards discover entities by `property.Name.EndsWith("CustomerId")`
(`QueryFilterModelTests.cs:119`, `RowLevelSecurityTests.cs:608`), and §12's pinned literals move
by exactly four. **`InboundMessage`, `QuarantinedSeries`, `OperationalAlert` and
`MeteringPointBrpAssignment` must NOT gain a `CustomerId`**, however convenient it would look:
adding one to any of them breaks the guards' arithmetic and every plan that pinned it.

**Every factory and mutator, NORMATIVE.** The block above spelled signatures for only
`InboundMessage.Receive` and `IntervalDataVersion.FromBrpFeed`; the silence over the other six
entities is what let two plans pick different names for the same `QuarantinedSeries` factory. Plan
2 declares all of these; plans 3, 5, 6 and 8 call them and none may rename one.

```csharp
// metering.interval_reading
public static Result<IntervalReading> IntervalReading.Create(
    Guid versionId, DateOnly deliveryDate, Guid customerId, short pos,
    DateTimeOffset intervalStart, decimal quantityKwh);

// metering.metering_point_day_state
public static Result<MeteringPointDayState> MeteringPointDayState.Compute(
    Guid meteringPointId, DateOnly deliveryDate, Guid customerId, MeteringDayState state,
    short expectedIntervalCount, bool consumptionComplete, bool productionComplete,
    bool productionIsDeclaredZero, DateTimeOffset? finalisedAt, DateTimeOffset? lastCorrectedAt,
    DateTimeOffset computedAt);

public Result<MeteringPointDayState> Recompute(
    MeteringDayState state, short expectedIntervalCount, bool consumptionComplete,
    bool productionComplete, bool productionIsDeclaredZero, DateTimeOffset? finalisedAt,
    DateTimeOffset? lastCorrectedAt, DateTimeOffset computedAt);

// metering.quarantined_series
public static Result<QuarantinedSeries> QuarantinedSeries.Quarantine(
    Guid inboundMessageId, Guid brpId, QuarantineReason reason, string resourceObject,
    DateOnly deliveryDate, IntervalDirection direction, short pointCount,
    DateTimeOffset receivedAt);

public Result<QuarantinedSeries> Resolve(
    DateTimeOffset resolvedAt, string resolvedBy, Guid? resolvedByReplayOfMessageId);

// metering.daily_position
public static Result<DailyPosition> DailyPosition.Roll(
    Guid meteringPointId, DateOnly deliveryDate, Guid customerId, decimal consumptionKwh,
    decimal productionKwh, decimal netUsageKwh, decimal offtakeKwh, decimal exportKwh,
    MeteringDayState dataState, IReadOnlyList<Guid> sourceVersionIds, DateTimeOffset computedAt);

public Result<DailyPosition> Recompute(
    decimal consumptionKwh, decimal productionKwh, decimal netUsageKwh, decimal offtakeKwh,
    decimal exportKwh, MeteringDayState dataState, IReadOnlyList<Guid> sourceVersionIds,
    DateTimeOffset computedAt);

// metering.operational_alert
public static Result<OperationalAlert> OperationalAlert.Raise(
    OperationalAlertKind kind, string summary, string? detail, DateTimeOffset raisedAt,
    Guid? meteringPointId = null, Guid? brpId = null, Guid? inboundMessageId = null,
    DateOnly? deliveryDate = null);

public Result<OperationalAlert> Resolve(DateTimeOffset resolvedAt);

// customer.metering_point_brp_assignment
public static Result<MeteringPointBrpAssignment> MeteringPointBrpAssignment.Record(
    Guid meteringPointId, Guid? fromBrpId, Guid toBrpId, DateTimeOffset assignedAt,
    string assignedBy, string reason);

public const string MeteringPointBrpAssignment.MigrationActor = "system:migration-9";

// customer.metering_point — three mutators on the existing entity
public Result<MeteringPoint> MeteringPoint.RecordObservedProduction(
    DateTimeOffset observedAt, string setBy);

public Result<MeteringPoint> MeteringPoint.DeclareProductionExpectation(
    ProductionExpectation expectation, ProductionExpectationSource source,
    string setBy, DateTimeOffset setAt);

public Result<MeteringPoint> MeteringPoint.ReassignBrp(Guid toBrpId, DateTimeOffset assignedAt);

/// The `setBy` the pipeline passes when [F02-R34] promotes a point. Named, not inlined, because
/// plan 3 writes it and plan 5's and plan 6's tests assert on it.
public const string MeteringPoint.IngestionPromotionActor = "system:ingestion";
```

⚠ **`RecordObservedProduction` is the name.** Plan 2's draft calls it `ObserveProduction`; that
spelling is dead — the mutator *records* an observation the pipeline already made, and plans 3 and
5 both call it by the longer name.

⚠ **`RecordObservedProduction` promotes only when `ProductionExpectation == Never` — not
`Never or Unknown`.** `[F02-R34]` names only the NEVER point, and the difference is not
stylistic: `ix_mp_production_expected` selects
`WHERE production_expectation IN ('EXPECTED','UNKNOWN')`, so an UNKNOWN point is *in*
`[F02-R35]`'s onboarding worklist precisely because a human still has to decide it. Promoting
UNKNOWN on first sight of an A01 series would empty that worklist silently — every point that
needed a decision would have answered itself, and nobody would be told. On a NEVER point the
promotion is the opposite: it corrects a statement the data has just falsified, which is exactly
what `ck_mp_never_has_no_observed_production` exists to force. Called on an already-`Expected`
point it is a no-op, not an error.

### 5.1 Why `CustomerId` is denormalised onto four tables — S2-D1

Two independent reasons, and the second is the sharper one.

1. **Guard discovery.** A table keyed only by `metering_point_id` is not merely unguarded — it is
   *invisible* to `QueryFilterModelTests` and `RowLevelSecurityTests`, which then report **full
   coverage** over unpoliced customer data. This is the same "reports coverage, provides none"
   failure the `ean_pool` widening was written to close.
2. **Default privileges.** Migration 2 ran `ALTER DEFAULT PRIVILEGES IN SCHEMA customer, metering,
   wallet, audit GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_customer_role,
   app_employee_role`. **The instant `CREATE TABLE` runs in the `metering` schema, the customer
   role has full DML on it.** The `REVOKE`s in §6 are not tidiness.

**Which customer.** Resolved at apply time from the metering point's validity interval covering
the **delivery date** — the reading belongs to whoever held the EAN on that day, which quarantine
rule `[F02-R15]` (`EAN_VALIDITY`) has already decided by the time a version is written.

---

## 6. Migration 9 DDL — NORMATIVE, owned by plan 2 alone

**Every other plan reads this section and writes none of it.** Migration name:
`<timestamp>_IngestionAndIntervalData`. It is the ninth migration; the eight before it are
`InitialSchema`, `TenancyRowLevelSecurity`, `AuthAndOnboarding`, `AccountTokenForeignKeys`,
`EanPool`, `OnboardingTradeName`, `EmployeeIdentity`, `EmployeeSessions`.

`tools/verify-migrator.sh:51` and `:52-55` pin that ordered list and both
`MigrationScriptTests.cs` and `MigrationBehaviourTests.cs` mirror it — **all three grow by one
entry, `*_IngestionAndIntervalData`, in the same commit.**

⚠ **Design §11 rows 1–3 land BEFORE this migration is written.** They are the recorded decision
that settles `interval_data_version.source` per **S2-D2**; migration 9 is written against them.

### 6.1 `metering.brp` — six columns and one constraint

The table has only `id / code / name / is_active` today, so the `[DEC-69]` seam has no data behind
it and cannot select an adapter.

```sql
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
```

⚠ **`credential_ref` holds the NAME of an environment variable, never a secret.** The seeded
value is the literal string `BRP_CREDENTIAL_PVNED`. §9.3 is the whole convention. The published
DDL's comment says "Key Vault secret name"; there is no key vault (`[OQ-102]`), and an
environment-variable name is the same shape of indirection. **Nothing may ever put a secret in
this column**, and a test asserts the seeded row's `credential_ref` starts with
`BRP_CREDENTIAL_`.

⚠ **Migration 1 already seeds the `PVNED` row** — `id 0199a1a0-0000-7000-8000-0000000000b1`,
`name "PVNed B.V."`, and `ix_brp_code` is a **unique** index on `code`. Migration 9 **UPDATEs**
that row. It does not insert one. A plan that writes `INSERT INTO metering.brp` gets Postgres
`23505`.

### 6.2 `customer.metering_point` — four columns, plus the assignment history table

⚠ **The shipped table is much thinner than the published DDL. Read
`20260827051436_InitialSchema.cs`, not `04-database-design.md`.** Verified today: the shipped
`customer.metering_point` has `id · customer_id · ean varchar(18) · commodity · brp_id ·
production_expectation · expectation_source · name · description · grid_operator ·
capacity_kw numeric(18,6) · address · valid_from · valid_to`, plus a `validity daterange` column
and `metering_point_ean_validity_excl` added by raw SQL at `:260-274`. **Four of the columns the
published DDL shows do not exist**, and `production_expectation_source` is spelled
`expectation_source` here. There are no `CHECK` constraints on the expectation columns; the enum
converter is what enforces the value set.

Migration 9 adds all four:

```sql
ALTER TABLE customer.metering_point
    ADD COLUMN brp_assigned_at               timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN first_production_observed_at  timestamptz,
    ADD COLUMN production_expectation_set_by text,
    ADD COLUMN production_expectation_set_at timestamptz;

-- Observed production contradicts NEVER, and the processor must RESOLVE it rather than log it.
-- Making the combination unstorable is what forces [F02-R34]'s promotion into the same
-- transaction instead of leaving a reading stored beside master data that disagrees with it.
ALTER TABLE customer.metering_point
    ADD CONSTRAINT ck_mp_never_has_no_observed_production
    CHECK (production_expectation <> 'NEVER' OR first_production_observed_at IS NULL);

-- The completeness job's driving set: the points where a missing A01 is a fault or an unknown,
-- never a fact.  [DEC-65], [F02-R22], [F02-R26]
CREATE INDEX ix_mp_production_expected ON customer.metering_point
    (production_expectation, customer_id)
    WHERE production_expectation IN ('EXPECTED','UNKNOWN');

CREATE TABLE customer.metering_point_brp_assignment (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    metering_point_id  uuid NOT NULL REFERENCES customer.metering_point(id),
    from_brp_id        uuid REFERENCES metering.brp(id),        -- null on first assignment
    to_brp_id          uuid NOT NULL REFERENCES metering.brp(id),
    assigned_at        timestamptz NOT NULL DEFAULT now(),
    assigned_by        text NOT NULL CHECK (length(btrim(assigned_by)) > 0),
    reason             text NOT NULL CHECK (length(btrim(reason)) > 0)
);
CREATE INDEX ix_mpba_point ON customer.metering_point_brp_assignment
    (metering_point_id, assigned_at DESC);

-- Backfill one row per existing metering point, so the history is complete from day one.
INSERT INTO customer.metering_point_brp_assignment
       (metering_point_id, from_brp_id, to_brp_id, assigned_at, assigned_by, reason)
SELECT id, NULL, brp_id, brp_assigned_at, 'system:migration-9',
       'Initial assignment, backfilled when the assignment history was introduced.'
  FROM customer.metering_point;
```

⚠ **`brp_assigned_at` alone cannot answer who moved the point or why**, which is what
`[F02-R43]` asks for. The published DDL §3.2.1 says the change event is "an ordinary `audit` row";
this contract makes it a first-class table instead, because `[F02-R43]` also says **the assignment
in force at receipt time decides `WRONG_BRP`**, and an audit payload is not a queryable history.
**DECIDED HERE** — §16, item 3.

⚠ **`production_expectation_set_by` and `production_expectation_set_at` are added even though the
design's column list does not name them**, because `[F02-R33]` **is** in scope: the declared-zero
treatment must read as "a stated zero traceable to its **source, setter and date**" `[F01-R40]`,
and without the two columns that treatment is unbuildable and §10.1's `productionDeclaration` has
nothing to carry. Slice 1 shipped `expectation_source` and no owner or moment for it.
**DECIDED HERE** — §16, item 9.

⚠ **The domain property is `MeteringPoint.ExpectationSource`, mapped to `expectation_source`** —
not `ProductionExpectationSource`, which is the *enum type's* name. Slice 1's contract §5 has it
right and the published DDL does not. Four new domain properties follow the column names:
`BrpAssignedAt`, `FirstProductionObservedAt`, `ExpectationSetBy`, `ExpectationSetAt` —
`ExpectationSetBy`/`ExpectationSetAt` are bridged to
`production_expectation_set_by`/`production_expectation_set_at` by an explicit `HasColumnName`,
because the convention would otherwise produce `expectation_set_by`.

### 6.3 `customer.customer_account` — the free `ExternalSubjectId` drop

`CLAUDE.md` and slice 1's contract §5 both assign this to the migration after slice 1. It is
always null; `[DEC-119]` removed the identity provider it was reserved for.

```sql
ALTER TABLE customer.customer_account DROP COLUMN external_subject_id;
```

⚠ **One statement, not two.** The published DDL shows
`CREATE UNIQUE INDEX ux_account_subject … WHERE external_subject_id IS NOT NULL`, but
`InitialSchema` never created it — the three indexes on that table are
`ix_customer_account_customer_id`, `ix_customer_account_email` and
`ix_customer_account_username`. **There is no index to drop**, and a `DROP INDEX` without
`IF EXISTS` fails the migration.

The property `CustomerAccount.ExternalSubjectId`
(`src/Core/PeakPower.Domain/Customers/CustomerAccount.cs:54`) is removed in the same commit, along
with its EF configuration. ⚠ Check both OpenAPI Verify snapshots and every mapper before claiming
this is free.

### 6.4 `metering.inbound_message`

```sql
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
CREATE INDEX  ix_msg_hash_recent  ON metering.inbound_message (payload_hash, received_at DESC);
CREATE INDEX  ix_msg_brp          ON metering.inbound_message (brp_id, received_at DESC);
CREATE INDEX  ix_msg_status       ON metering.inbound_message (status, received_at DESC);
CREATE UNIQUE INDEX ux_msg_correlation ON metering.inbound_message (correlation_id);
```

⚠ **The published DDL's nullable `source text` column is dropped.** `[DEC-69]` made the BRP a row
and F02 §8 says the constant `source` column "becomes this reference". Carrying both is a second
place the answer can disagree with `brp_id`.

### 6.5 `metering.interval_data_version` — S2-D2 resolved

⚠ **The published DDL and F02 §8 contradict each other and this section settles it.** The
published form has `document_id text NOT NULL` and `inbound_message_id uuid NOT NULL` and **no
`source` column**, which makes `[F02-R36]`'s manual version unstorable; F02 §8 says the table
carries `source` (`BRP_FEED | MANUAL`). **S2-D2 rules for F02 §8**, with a CHECK that keeps
`BRP_FEED` honest, and **no `brp_id` column** — a second column can disagree with the message it
came from, and a manual version correctly has no BRP.

```sql
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

-- exactly one current version per (point, date, direction)   [M4], design §4.2
CREATE UNIQUE INDEX ux_idv_current
    ON metering.interval_data_version (metering_point_id, delivery_date, direction)
    WHERE is_current;

CREATE INDEX ix_idv_point_date ON metering.interval_data_version
    (metering_point_id, delivery_date, direction, received_at DESC);
CREATE INDEX ix_idv_message  ON metering.interval_data_version (inbound_message_id);
CREATE INDEX ix_idv_customer ON metering.interval_data_version (customer_id, delivery_date);
```

⚠ **`ux_idv_current` is the enforcement of receipt-order supersession, not a nicety.** Design
§4.2: the current version is **always the last one received**, never the newest by
`CreatedDateTime`. Both receipt orders of the same pair leave the **second-received** version
current. This is one of the four assertions design §10 requires be mutation-verified, by swapping
the comparison to `CreatedDateTime` order and watching the out-of-order pair test fail.

### 6.6 `metering.interval_reading` — partitioned, and the partition routine

```sql
CREATE TABLE metering.interval_reading (
    version_id     uuid NOT NULL REFERENCES metering.interval_data_version(id),
    delivery_date  date NOT NULL,
    customer_id    uuid NOT NULL,                 -- S2-D1; no FK, to keep partitions cheap
    pos            smallint NOT NULL CHECK (pos BETWEEN 1 AND 100),
    interval_start timestamptz NOT NULL,
    quantity_kwh   numeric(14,3) NOT NULL CHECK (quantity_kwh >= 0),
    PRIMARY KEY (delivery_date, version_id, pos)
) PARTITION BY RANGE (delivery_date);

CREATE INDEX ix_reading_start    ON metering.interval_reading USING brin (interval_start);
CREATE INDEX ix_reading_customer ON metering.interval_reading (customer_id, delivery_date);
```

⚠ `quantity_kwh >= 0` on **both** directions. Consumption and production remain two separate,
non-negative series `[AS-05]`; `netUsage` is derived per interval and **never stored as a signed
source series** (position-and-coverage §2.1). A plan that writes a negative reading has mapped a
direction wrong, which under `[DEC-22]` is a wrong invoice.

⚠ `interval_start` is stored, resolved by `IMarketCalendar.IntervalStart` (§7.5). **This is what
lets the `market.calendar_interval` spine be deferred** (design §3.2) — the spine becomes a later
pure join optimisation rather than a prerequisite.

**The partition routine.** One function, called by migration 9 for a fixed window and thereafter
by the maintenance job. It applies RLS and both policies to every partition it creates, so no
partition can exist without them.

```sql
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

-- Migration 9 creates a FIXED window, so the migration is deterministic and idempotent.
-- 36 monthly partitions, 2025-01 .. 2027-12: wide enough for DevStubs' 90-day backfill and for
-- the 100-EAN x 365-day load test, and it contains no call to now().
DO $seed$
DECLARE m date := DATE '2025-01-01';
BEGIN
    WHILE m < DATE '2028-01-01' LOOP
        PERFORM metering.ensure_interval_reading_partition(m);
        m := (m + interval '1 month')::date;
    END LOOP;
END
$seed$;
```

⚠ **A migration must not depend on `now()` for the set of objects it creates**, or two runs
against databases created a month apart produce different schemas and `verify-migrator.sh`'s
double-run idempotence check stops meaning anything. The maintenance job — which *may* read the
clock, through `IMarketCalendar` — keeps three months ahead of `TodayInAmsterdam`.

⚠ **Policy names fit.** `metering_interval_reading_2026_08_tenant_isolation` is 50 characters,
comfortably inside PostgreSQL's 63-byte identifier limit. Do not lengthen the prefix.

### 6.7 `metering.metering_point_day_state`, `quarantined_series`, `daily_position`, `operational_alert`

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
    net_usage_kwh      numeric(16,3) NOT NULL,               -- may be negative
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
```

⚠ **`daily_position` diverges from the published DDL §4 in three ways, all deliberate.**
(a) The published column is `local_date`; this contract uses **`delivery_date`**, so one word
means one thing across all seven tables — design §4.1's own prose says "per (metering point,
delivery date, `customer_id`)". (b) `block_kwh`, `covered_kwh`, `uncovered_kwh`, `surplus_kwh`
and `spot_cost_eur` are **not created**: blocks are `F05`/Phase 2 and every money figure is out
under **S2-D6**, and a column that is `NULL` on every row for a phase is a column somebody will
read as zero. (c) `offtake_kwh` and `export_kwh` are **new**, and they are the point of the table.
**DECIDED HERE** — §16, items 1 and 2.

⚠ **`offtake_kwh` and `export_kwh` are accumulated PER INTERVAL and cannot be recovered from the
daily totals.** Design §4.1's worked case: consumption `[10, 0]`, production `[0, 5]`. Per
interval `U = [10, −5]`, so `offtake = 10` and `export = 5`. From daily totals alone,
`Σc − Σp = 5` and `max(5,0) = 5` — which disagrees, and discards the export entirely. This is one
of the four assertions design §10 requires be mutation-verified, by replacing per-interval
accumulation with daily-total subtraction and watching the mixed-export day fail.

### 6.8 Row-level security — the policy pairs and the explicit REVOKEs

Policy shape follows migration 2's existing form exactly, including the `NULLIF(...,'')` guard
(an empty `app.customer_id` would raise `22P02` on `''::uuid`; `NULL` simply matches nothing,
which is the fail-closed behaviour) and the naming convention `{schema}_{table}_tenant_isolation`
/ `{schema}_{table}_back_office`. `FORCE ROW LEVEL SECURITY` is deliberately **not** set: the
owner runs migrations, and no API host connects as the owner.

**The four customer-owned tables** — `interval_data_version`, `interval_reading`
(parent **and** every partition), `metering_point_day_state`, `daily_position`:

```sql
ALTER TABLE metering.<t> ENABLE ROW LEVEL SECURITY;

CREATE POLICY metering_<t>_tenant_isolation ON metering.<t>
    FOR ALL TO app_customer_role
    USING      (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
    WITH CHECK (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid);

CREATE POLICY metering_<t>_back_office ON metering.<t>
    FOR ALL TO app_employee_role USING (true) WITH CHECK (true);

REVOKE INSERT, UPDATE, DELETE ON metering.<t> FROM app_customer_role;   -- SELECT only
```

**The four employee-only tables** — `inbound_message`, `quarantined_series`, `operational_alert`,
and `customer.metering_point_brp_assignment`:

```sql
REVOKE ALL ON metering.inbound_message                    FROM app_customer_role;
REVOKE ALL ON metering.quarantined_series                 FROM app_customer_role;
REVOKE ALL ON metering.operational_alert                  FROM app_customer_role;
REVOKE ALL ON customer.metering_point_brp_assignment      FROM app_customer_role;

ALTER TABLE metering.inbound_message ENABLE ROW LEVEL SECURITY;
CREATE POLICY metering_inbound_message_back_office ON metering.inbound_message
    FOR ALL TO app_employee_role USING (true) WITH CHECK (true);
-- and the same pair for quarantined_series, operational_alert,
-- customer.metering_point_brp_assignment
```

⚠ **The `REVOKE`s are the whole protection on the employee-only tables** and are required on the
customer-owned four as well. A policy decides which **rows** a command may touch; it cannot
forbid the command. Without the revokes a customer-scoped connection can `INSERT` interval data.
Plan 2 writes **positive** tests: as `app_customer_role`, a `SELECT` on `inbound_message`,
`quarantined_series` or `operational_alert` raises `insufficient_privilege` (`42501`), and an
`INSERT` on `interval_reading` does the same.

⚠ **A catalog test asserts no partition of `interval_reading` lacks RLS or either policy.** The
partition routine applies them, but the assertion is what keeps a hand-created partition from
becoming a hole.

**The Worker connects as the database owner and is exempt from RLS by design** — it writes across
tenants and serves no customer-facing route. Design §4.3. A route-table test asserts the Worker
host exposes **no `/api/v1/**` route at all**.

### 6.9 `metering.ingestion_job` — only if the Hangfire spike fails

Plan 1 creates this **only** on the fallback path (§1.1), in migration 9 or a migration 10 as it
prefers. Named here so plan 2 knows it is not its table and does not write it.

```sql
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
```

Retry ladder on the fallback path: **1 m / 5 m / 15 m / 1 h / 4 h, five attempts, then `DEAD`.**
Claim with `SELECT ... FOR UPDATE SKIP LOCKED`.

---

## 7. Application ports

Every interface below is **declared** in `PeakPower.Application.Abstractions` (or the
`.Ingestion` sub-namespace) so that `PeakPower.Ingestion` and `PeakPower.Integration.Brp.Pvned`
can both see it without seeing each other — architecture fact 3.

| Port | Declared in | Implemented in | Written by |
| --- | --- | --- | --- |
| `IBrpIngestionAdapter` | `PeakPower.Application.Abstractions.Ingestion` | `PeakPower.Integration.Brp.Pvned` | plan 4 (contract in plan 3) |
| `IRawPayloadStore` | `PeakPower.Application.Abstractions.Ingestion` | `PeakPower.Ingestion` (filesystem) | plan 3 |
| `IIngestionJobQueue` | `PeakPower.Application.Abstractions.Ingestion` | `PeakPower.Ingestion` | plan 1 (spike) / plan 3 (wiring) |
| `IMarketCalendar` **additions** | `PeakPower.Application.Abstractions` | `PeakPower.Infrastructure.Time` | plan 1 |
| `IDayStateRecomputer` | `PeakPower.Application.Abstractions.Ingestion` | `PeakPower.Ingestion` | **declaration** plan 3, **implementation** plan 5 |
| `IOperationalAlertRaiser` | `PeakPower.Application.Abstractions.Ingestion` | `PeakPower.Ingestion` | **declaration** plan 3, **implementation** plan 5 |

### 7.1 `IBrpIngestionAdapter` — NORMATIVE, the whole `[DEC-69]` seam

```csharp
namespace PeakPower.Application.Abstractions.Ingestion;

/// One adapter per BRP. Receives bytes; returns a canonical series set or a typed rejection.
/// It never touches the database, never resolves an EAN, and never decides quarantine.
public interface IBrpIngestionAdapter
{
    /// Matches metering.brp.adapter_key exactly. "PVNED_TIMESERIES_XML_V2P0" for the only one.
    string AdapterKey { get; }

    BrpParseOutcome Parse(BrpParseRequest request);
}

public sealed record BrpParseRequest(
    Guid InboundMessageId,
    Guid BrpId,
    string BrpCode,
    Guid CorrelationId,
    ReadOnlyMemory<byte> Payload,
    DateTimeOffset ReceivedAt);

public sealed record BrpParseOutcome(
    BrpParseStatus Status,
    BrpDocument? Document,
    string? FailureCode,
    string? FailureDetail)
{
    public static BrpParseOutcome Accepted(BrpDocument document);
    public static BrpParseOutcome Rejected(string failureCode, string failureDetail);
    public static BrpParseOutcome RecognisedAndClosed(BrpDocument document);
}

/// Accepted            → apply the series.
/// Rejected            → message FAILED with FailureCode, zero readings written.  [F02-R12]
/// RecognisedAndClosed → message PROCESSED with zero readings written. The A12 case: [DEC-25]
///                       puts imbalance out of scope, so the document is recognised, stored and
///                       closed rather than failed. Design §7.13 asserts exactly this.
public enum BrpParseStatus { Accepted, Rejected, RecognisedAndClosed }

public sealed record BrpDocument(
    string DocumentId,
    DateTimeOffset DocumentCreated,
    BrpDocumentKind Kind,
    IReadOnlyList<CanonicalSeries> Series);

public enum BrpDocumentKind { Allocation, Imbalance }

/// The canonical series. This is the entire hand-off: (metering point identity, delivery date,
/// direction, position, quantity) plus the document identity above.
public sealed record CanonicalSeries(
    string ResourceObject,          // verbatim from the document, whatever shape it had
    bool ResourceObjectIsEan,       // 18 digits — [F02-R11], [AS-17]
    EanCode? Ean,                   // set iff ResourceObjectIsEan
    DateOnly DeliveryDate,          // resolved to Europe/Amsterdam by the adapter
    IntervalDirection Direction,
    int ExpectedIntervalCount,      // 92 | 96 | 100, from IMarketCalendar
    IReadOnlyList<CanonicalPoint> Points);

public sealed record CanonicalPoint(int Pos, decimal QuantityKwh);
```

⚠ **`ResourceObject` is carried verbatim alongside the parsed `Ean`.** `[F02-R11]`/`[AS-17]`:
eighteen digits is an EAN, **anything else is a descriptive resource label** (`Prognosis`,
`Realisation`, `Imbalance`, …) and is **never** offered to the EAN resolver — otherwise a labelled
document quarantines as a false `UNKNOWN_EAN`. The pipeline needs the raw string to put on the
quarantine row; the adapter must not throw it away.

⚠ **The adapter never resolves an EAN to a metering point.** `UNKNOWN_EAN`, `EAN_VALIDITY`,
`WRONG_BRP` and `NOT_ELECTRICITY` are **pipeline** decisions (§8.5). An adapter that queries
`customer.metering_point` has reimplemented a pipeline stage, which `[F02-R40]` forbids in so
many words.

### 7.2 Adapter resolution — S2-D3, and it is a test as much as a rule

```csharp
public interface IBrpIngestionAdapterRegistry
{
    /// Throws AdapterNotRegisteredException if no adapter carries that key.
    IBrpIngestionAdapter Resolve(string adapterKey);
}
```

⚠ **The adapter is selected by the `adapter_key` of the BRP row identified by the message's
STORED `brp_id`, at dequeue time. Never by a field in the payload, never by the route, never by a
default.** `[F02-R41]`: a replay `[F02-R27]` is parsed by the same adapter that first parsed it —
**including after that BRP has been deactivated**. Design §7.7 requires this be asserted **with a
second adapter registered**, to prove the selection is not "the only one there is".

### 7.3 `IRawPayloadStore`

```csharp
namespace PeakPower.Application.Abstractions.Ingestion;

public interface IRawPayloadStore
{
    /// Returns the opaque payload_uri stored on inbound_message. Must be durable BEFORE the
    /// webhook writes its 200 — [F02-R03], [DEC-03].
    Task<string> StoreAsync(
        Guid brpId, Guid correlationId, ReadOnlyMemory<byte> payload, CancellationToken ct);

    Task<ReadOnlyMemory<byte>> ReadAsync(string payloadUri, CancellationToken ct);
}
```

Slice 2 ships one implementation: `FilesystemRawPayloadStore`, on a named Docker volume mounted
at the path in `RAW_PAYLOAD_ROOT` (default `/var/lib/peakpower/raw-payloads`). Layout
`{brpId}/{yyyy}/{MM}/{dd}/{correlationId}.bin`, and the returned `payload_uri` is
`file://{relative path}`. Real object storage is out of scope (design §3.2); the swap is one
adapter, which is why the port exists now.

### 7.4 `IIngestionJobQueue` — the seam the Hangfire spike hides behind

```csharp
namespace PeakPower.Application.Abstractions.Ingestion;

public interface IIngestionJobQueue
{
    /// Enqueue the processing of a stored message. Called AFTER the payload is durable and
    /// AFTER inbound_message is committed with status RECEIVED, and BEFORE the 200 is written.
    Task EnqueueProcessMessageAsync(Guid inboundMessageId, Guid correlationId, CancellationToken ct);
}

/// What the queue eventually calls. One implementation, in PeakPower.Ingestion.
public interface IProcessInboundMessageHandler
{
    Task HandleAsync(Guid inboundMessageId, Guid correlationId, CancellationToken ct);
}
```

⚠ **Plans 3, 4, 5, 6 and 8 name only these two types.** Whether a Hangfire background server or a
`BackgroundService` draining `metering.ingestion_job` sits behind them is plan 1's decision and
nobody else's.

### 7.5 `IMarketCalendar` — four additions, owned by plan 1

Architecture fact 5 is IL-enforced: **nothing outside `PeakPower.Infrastructure.Time` may read
the clock**, and by the same argument the DST mapping lives there and only there — parser, rollup
and chart all read it, so a second copy is a second answer.

```csharp
namespace PeakPower.Application.Abstractions;

public interface IMarketCalendar
{
    // ── slice 1, unchanged ──────────────────────────────────────────────────
    DateTimeOffset UtcNow { get; }
    DateOnly TodayInAmsterdam { get; }

    // ── slice 2 ─────────────────────────────────────────────────────────────

    /// 92 on the spring-forward Sunday, 100 on the autumn fall-back Sunday, 96 otherwise.
    int ExpectedIntervalCount(DateOnly date);

    /// The Amsterdam-local start instant of `pos` (1-based) on `date`, as a DateTimeOffset
    /// carrying the correct offset for that pass.
    /// ⚠ On the autumn day, Pos 9-12 are the FIRST pass of 02:00-03:00 (+02:00) and Pos 13-16
    ///   are the SECOND (+01:00). A generic add-15-minutes loop gets exactly this wrong, and the
    ///   result is plausible data written to the wrong times.
    /// Throws ArgumentOutOfRangeException when pos < 1 or pos > ExpectedIntervalCount(date).
    DateTimeOffset IntervalStart(DateOnly date, int pos);

    /// True only for Pos 13-16 on the autumn fall-back Sunday — the repeated hour's second pass.
    /// The chart labels the first `02:00 A` and the second `02:00 B`.
    bool IsDstDuplicate(DateOnly date, int pos);

    /// S2-D8. Monday-Friday, exclusion list read from the [DEC-14] calendar and CURRENTLY EMPTY,
    /// so public holidays are working days. AddWorkingDays(d, 0) returns d unchanged even when d
    /// is a weekend; AddWorkingDays(d, n) for n > 0 advances n working days.
    DateOnly AddWorkingDays(DateOnly from, int workingDays);
}
```

⚠ **S2-D8: read the weekday set and the exclusion list from the `[DEC-14]` calendar rather than
hard-coding them**, so populating the list later is a row and not a release. What makes ignoring
holidays safe is `[DEC-98]`: `FINAL` is now a *status*, a post-window version is routine, and a
late reconciliation simply reopens the date to `PROVISIONAL` and re-finalises.

⚠ **DST is the single most likely silent correctness bug in this slice.** Golden tests for all six
transitions across three years, with the autumn Pos 9–12 / 13–16 mapping asserted specifically,
and a hand-checked weekday table including a 10-working-day span crossing Christmas and one
crossing King's Day, both asserted to finalise on the weekday count. This is one of the four
assertions design §10 requires be mutation-verified, by replacing `IntervalStart` with a naive
add-15-minutes loop and watching the autumn 100-point case fail.

### 7.6 `IDayStateRecomputer` and `IOperationalAlertRaiser` — the plan 3 / plan 5 seam, NORMATIVE

§9.6 step 7 says the apply transaction recomputes `metering_point_day_state` and `daily_position`
"in the same transaction", and §8.4 says a rejection "raises a `VALIDATION_FAILURE` alert". Until
now this contract named **no type for either**, so plan 3 and plan 5 — written in parallel, unable
to see each other — each invented a pair. This section ends that: the shapes below are the only
ones. **Plan 3 declares them** (it codes against them first, and its `NoOp*` stand-ins keep it
compiling before plan 5 lands); **plan 5 implements them**.

The names and shapes are plan 5's, and the two reasons are substantive rather than a coin toss:

1. Plan 3's `IDerivedDataRecomputer.RecomputeAsync(IReadOnlyList<MeteringPointDay>, Guid, …)` has
   **no way to carry `NewVersionReceivedAt`** — the one value that distinguishes a version arriving
   after the window, which reopens a `FINAL` day (`[DEC-98]`, design §7.12, `[F02-R45]`), from a
   replay or maintenance sweep that must leave the date exactly as it found it. A recomputer that
   cannot tell those apart either never reopens or reopens on every replay, and both are silent.
2. Plan 3's alert port returns no `bool` and has no `ResolveOpenAsync`. `[F02-R26]`'s resolution
   path needs both: the dedupe answer (a PARTIAL day is recomputed on every touching document, so
   without it the table holds one row per sweep) and the resolve sweep.

`MeteringPointDay` is plan 3's and survives unchanged — plan 3's apply transaction collects touched
pairs into a `HashSet<MeteringPointDay>` and `AdvisoryLock.KeyFor` takes one, so the type is needed
whether or not it appears in a recompute signature. It is declared alongside these two ports.

```csharp
namespace PeakPower.Application.Abstractions.Ingestion;

/// <summary>One (metering point, delivery date) whose derived data a new version invalidated.</summary>
public readonly record struct MeteringPointDay(Guid MeteringPointId, DateOnly DeliveryDate);
```

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

⚠ **The names `IDerivedDataRecomputer`, `IOperationalAlertSink` and
`RecomputeAsync(IReadOnlyList<MeteringPointDay>, …)` are dead.** They appear in plan 3's draft;
wherever they do, they mean the types above. Plan 3's no-op stand-ins keep their role but take the
shapes here — one call per touched pair, not one call per list.

---

## 8. The PVNed adapter surface — NORMATIVE across plans 4, 5 and 6

Plan 4 implements it, plan 5's DevStubs generates a document that violates each rule, and plan 6
may surface the codes on the employee screens. **All three must use identical strings.**

### 8.1 Schema and hardening

- The file is `TimeSeriesDocument-v2p0.reconstructed.xsd`, embedded in
  `PeakPower.Integration.Brp.Pvned`. **A test asserts the filename contains `reconstructed`**, so
  swapping in the real file becomes a diff review rather than a silent substitution.
- XML reading: `XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null,
  MaxCharactersFromEntities = 0 }`. Hand-written XXE and billion-laughs fixtures are checked in.
- Namespace: `http://www.pvned.eu/CustomerIntegrations/External/v2p0`, inside a
  `http://schemas.xmlsoap.org/soap/envelope/` envelope.
- ⚠ `RecourceName` is spelled that way in PVNed's schema. **It is normative. Do not "fix" it.**

### 8.2 Code decoding — a financial control, not a display concern

| Field | Accepted | Mapping | Anything else |
| --- | --- | --- | --- |
| `DocumentType` | `A23` | `BrpDocumentKind.Allocation`, processed | `UNSUPPORTED_DOCUMENT_TYPE` |
| `DocumentType` | `A12` | `BrpDocumentKind.Imbalance`, **recognised, stored, closed with zero readings** `[DEC-25]` | as above |
| `Direction` | `A01` | `IntervalDirection.Production` | `A03`/`A04` → `UNSUPPORTED_DIRECTION` |
| `Direction` | `A02` | `IntervalDirection.Consumption` | as above |
| `Resolution` | `PT15M` | — | `UNSUPPORTED_RESOLUTION` |
| `CurveType` | `A01` | — | `UNSUPPORTED_CURVE_TYPE` (§9 row 9: `A03` is rejected) |
| `MeasurementUnit` | `KWH`, `MWH` | converted to kWh (`MWH` × 1000) | `UNSUPPORTED_MEASUREMENT_UNIT` |
| `ResourceObject` | 18 digits | EAN | anything else is a **descriptive label**, never an EAN |

⚠ **`A01` is PRODUCTION and `A02` is CONSUMPTION.** Under `[DEC-22]` a mis-mapped direction
produces a wrong invoice, not a wrong chart. Note the trap: `BusinessType` `A01` also means
production and `A04` means consumption, on a **different** field. The two code lists are not the
same list.

⚠ **`MeasurementPeriode` + `Pos` are authoritative for interval placement. `Period.TimeInterval`
is logged as a discrepancy and never used to place a point** — integration-spec §9 row 7, the
interim answer to `[OQ-20]`. An implementer who trusts `Period.TimeInterval` writes a month's
intervals to the wrong dates, and nothing notices until an invoice does.

### 8.3 `SchemaProvenance` — the nine integration-spec §9 inconsistencies

A public static class in `PeakPower.Integration.Brp.Pvned` listing all nine rows with the
**permissive** reading taken on each, **one test per row naming the row and the reading**:

| # | Field | The reading taken |
| --: | --- | --- |
| 1 | `DocumentIdentification` | Accept **36** characters (the guide says 35; a GUID does not fit in 35) |
| 2 | `Sender`/`ReceiverIdentification` | Validate as **13 digits**, accept up to 16 |
| 3 | `Pos` | Enforce the XSD bound `maxInclusive 100`, not the guide's "max 6 characters" |
| 4 | `Qty` maximum | **No hard cap.** Validate plausibility against the metering point's capacity and **alert**, never reject |
| 5 | `MeasurementUnit` | Read from the message and convert; **warn** when it is not the one the dependency table predicts |
| 6 | Annex A validations | Annex A describes the customer → PVNed direction and **does not apply** to inbound processing |
| 7 | `Period.TimeInterval` | `MeasurementPeriode` + `Pos` are authoritative; the discrepancy is **logged, never used** — `[OQ-20]` |
| 8 | `Qty2` | **Not used** by the platform |
| 9 | `CurveType` `A03` | **Rejected** — the XSD enumerates only `A01` |

⚠ **Take the permissive reading on every row, and stop.** The risk register's own note: stricter
than the real schema and it rejects real documents; looser and it proves nothing — and the XSD
becomes a research exercise the moment the permissive rule is not held to.

### 8.4 The eleven §8.2 semantic failure codes — FROZEN, transcribed verbatim

Transcribed from `specs/30-integrations/01-pvned-timeseries.md` §8.2, in the source's own order.
**These exact strings go in the code, in the DevStubs scenario names, on `inbound_message.failure_code`
and on the employee screen. No plan may respell one.**

| # | Rule | Code | Outcome |
| --: | --- | --- | --- |
| 1 | `DocumentType`/`ProcessType` is a handled combination | `UNSUPPORTED_DOCUMENT_TYPE` | reject |
| 2 | `ReceiverIdentification` is PeakPower's own GLN | `WRONG_RECEIVER` | reject |
| 3 | `SenderIdentification` is the GLN configured for this BRP | `UNKNOWN_SENDER` | reject |
| 4 | `Resolution` = `PT15M` | `UNSUPPORTED_RESOLUTION` | reject |
| 5 | `CurveType` = `A01` | `UNSUPPORTED_CURVE_TYPE` | reject |
| 6 | `MeasurementPeriode` covers exactly one Amsterdam calendar day | `INVALID_MEASUREMENT_PERIOD` | reject |
| 7 | Point count equals the expected interval count (92/96/100) for that date | `INCOMPLETE_PERIOD` | reject |
| 8 | `Pos` values contiguous from 1, no duplicates | `INVALID_POSITIONS` | reject |
| 9 | `Qty` ≥ 0 | `NEGATIVE_QUANTITY` | reject |
| 10 | `ResourceObject` resolves to a registered metering point valid on that date | `UNKNOWN_METERING_POINT` | **quarantine, not reject** |
| 11 | That metering point's assigned BRP is the one this adapter serves | `WRONG_BRP_FOR_METERING_POINT` | **quarantine, not reject** |

⚠ **Rules 10 and 11 are decided by the pipeline, not the adapter** (§7.1). They are listed in the
integration spec's adapter section but need `customer.metering_point`, which no adapter may read.
The adapter emits a `CanonicalSeries` and the pipeline turns it into a quarantine row.

**Two more codes, adapter-level and beyond §8.2 — DECIDED HERE** (§16, item 4), because the design
requires behaviour §8.2 has no code for:

| Code | Raised when |
| --- | --- |
| `UNSUPPORTED_DIRECTION` | `Direction` is `A03` or `A04`. §8.2 has no row; integration-spec §4.1 says both are rejected |
| `UNSUPPORTED_MEASUREMENT_UNIT` | `MeasurementUnit` is `KWT` or `MAW` on an allocation series — a power, not an energy, so it cannot become a `quantity_kwh` |

**Rejection is total.** `[F02-R13]`: a document lands whole or not at all. A failure marks the
message `FAILED` with the code and a human-readable message, writes **zero** `interval_reading`
rows, raises a `VALIDATION_FAILURE` alert, and **still returns 200** to the sender `[F02-R05]`.

### 8.5 Quarantine reasons — pipeline-level, and their mapping to §8.2

| `QuarantineReason` | Raised when | §8.2 code, where there is one |
| --- | --- | --- |
| `UNKNOWN_EAN` | The 18-digit `ResourceObject` matches no `customer.metering_point` at all | `UNKNOWN_METERING_POINT` |
| `EAN_VALIDITY` | A metering point with that EAN exists but its `validity` daterange does not cover the delivery date `[F02-R15]` | — |
| `WRONG_BRP` | The metering point's `brp_id` **in force at receipt time** `[F02-R43]` is not the message's `brp_id` | `WRONG_BRP_FOR_METERING_POINT` |
| `NOT_ELECTRICITY` | `commodity <> 'ELECTRICITY'` | — |

⚠ **Quarantine is a storage state with a replay path, not a parse outcome.** The message reaches
`PROCESSED`, the series lands in `quarantined_series`, and registering the metering point then
replaying the stored message resolves the entry into readings. **Replaying an already-processed
message produces no second version** `[F02-R27]`, asserted by version count.

### 8.6 Adapter configuration

The sender and receiver GLNs are **adapter** configuration, not columns on `metering.brp`: the
design's column list for that table is closed, and a GLN is a PVNed-format concept rather than a
port concept (integration-spec §1.2 puts "parsing and code decoding" per adapter).
**DECIDED HERE** — §16, item 5.

```csharp
namespace PeakPower.Integration.Brp.Pvned;

public sealed class PvnedAdapterOptions
{
    public const string SectionName = "Brp:Pvned";
    public string SenderGln   { get; set; } = "8714252005776";   // PVNed's, integration-spec §6
    public string ReceiverGln { get; set; } = "8712423456789";   // PeakPower's, integration-spec §6
}
```

Environment variables in `deploy/env.example`: `Brp__Pvned__SenderGln`, `Brp__Pvned__ReceiverGln`.

---

## 9. The webhook contract — FROZEN

### 9.1 Route and method

```
POST /webhooks/brp/{brpCode}
```

Served by **`PeakPower.Worker`**, and by nothing else. `{brpCode}` is `metering.brp.code`,
uppercase; the PVNed route is therefore `POST /webhooks/brp/PVNED` (design §7.2 names it exactly).
The route is **outside `/api/v1`** on purpose — it is not a customer or employee API, it carries
no session, and the Worker's route-table test asserts it exposes no `/api/v1/**` route at all.

### 9.2 Credential header

```
X-PeakPower-Brp-Credential: <shared secret>
```

Compared with `CryptographicOperations.FixedTimeEquals` over UTF-8 bytes. There is no scheme
prefix and no `Authorization` header: `[F02-R02]`/`[AS-16]` make the mechanism per-BRP, and a
shared-secret header is the mechanism this BRP row declares.

### 9.3 `BRP_CREDENTIAL_<CODE>` — the convention

`metering.brp.credential_ref` holds the **name of an environment variable**, never a secret. For
the seeded row that name is the literal `BRP_CREDENTIAL_PVNED`. The Worker reads
`Environment.GetEnvironmentVariable(brp.CredentialRef)` at request time; an empty or absent value
means **every** request to that BRP's route is `401` (fail closed — it must never mean "no
credential required"). `deploy/env.example` gains `BRP_CREDENTIAL_PVNED=` with the same
"empty stops the stack" prose the rest of that file uses, and DevStubs authenticates with the same
value from its own environment.

⚠ **No secret store is introduced.** `[OQ-102]` blocks any, and the audience is the internal team
(design §1). The trigger to revisit is in design §3.2.

### 9.4 Status codes — FROZEN

| Status | When | Body |
| --- | --- | --- |
| **200** | The payload is durably stored, `inbound_message` is committed with `status = 'RECEIVED'` and the job is enqueued. **Before any parsing.** `[F02-R04]` | empty |
| **200** | A byte-identical payload was received from the same BRP within **24 h**. The row is written with `status = 'DUPLICATE'` and nothing is enqueued `[F02-R07]` | empty |
| **401** | Missing or wrong credential, **or** an unknown `{brpCode}`, **or** a BRP row with `is_active = false` | RFC 7807 |
| **413** | `Content-Length` or the streamed body is **strictly greater than 26 214 400 bytes** (25 MiB) `[F02-R06]` | RFC 7807 |
| **500** | Storage failure — the raw store or the database — **only**. `[F02-R05]`: once the payload is stored, no processing failure may produce a non-2xx | RFC 7807 |

⚠ **An unknown BRP code answers 401, not 404**, so the endpoint cannot be used to enumerate which
BRPs exist. ⚠ **Exactly 26 214 400 bytes is ACCEPTED; 26 214 401 is refused.** Design §7.3 pins
both sides, and DevStubs generates both documents.

⚠ **200 before processing is structural, not an optimisation.** `[F02-R04]`/`[F02-R05]` are what
stop a parser bug becoming a redelivery flood. Design §7.2: *at the moment that 200 is written*
the payload is durably stored with headers, source IP, receipt time, correlation id and `brp_id`,
and `status` is `RECEIVED` — **not `PROCESSED`**. Assert it at that moment, not afterwards.

### 9.5 The correlation id

A `Guid` (v7 where the platform already uses v7 ids) stamped at receipt, written to
`inbound_message.correlation_id` (unique), copied onto every `interval_data_version` the message
produces, put on the `ILogger` scope for the whole request and for the whole job, and returned in
the `X-Correlation-Id` response header on every status above. **In scope because retrofitting one
across an async hop later rewrites every log line.**

### 9.6 The apply transaction — one shape, plan 3 owns it

1. Dequeue with the stored `inbound_message_id`; load the message; `BeginProcessing()`.
2. Resolve the adapter from the stored `brp_id`'s `adapter_key` (§7.2).
3. `Parse` the payload read back from `IRawPayloadStore`.
4. Take a **transaction-scoped Postgres advisory lock** on
   `hashtextextended(metering_point_id::text || ':' || delivery_date::text, 0)` —
   `pg_advisory_xact_lock(bigint)` — once per (metering point, delivery date) in the document,
   **in a deterministic order** (metering point id, then date) so two documents cannot deadlock.
5. Resolve each series' metering point, decide quarantine (§8.5), and apply **the whole document
   atomically**: every series lands or none does `[F02-R13]`.
6. Supersede: set `is_current = false` on the previous current version for that
   (point, date, direction) **before** inserting the new one, so `ux_idv_current` holds. The new
   version's `received_at` is the **message's** receipt time, never `now()` at apply time.
7. Recompute `metering_point_day_state` and `daily_position` for every touched
   (point, date) — **in the same transaction** for the `[F02-R34]` promotion case.
8. `MarkProcessed`.

⚠ **Design §7.4: a document whose second timeseries is one point short applies NOTHING AT ALL —
asserted by row count, not by a status field.** A status column can be wrong; a row count cannot.

⚠ **Completeness is judged per document against the period THAT DOCUMENT declares**, never per
day (design §3.1). The day-level completeness question is `metering_point_day_state`'s, and it is
a different question with a different answer.

---

## 10. HTTP — the read envelopes, FROZEN

**Plan 6 implements these and plan 7 renders them, in parallel. Neither may change a key.**

Base path `/api/v1`; errors are RFC 7807 `application/problem+json`; cross-tenant reads return
**404, never 403** `[F13-R19]`. Every route below is added **in the same commit** as its
`.RequireAuthorization()` (the host's `FallbackPolicy` makes endpoints deny-by-default), its
`.TenantScoped("...")` classification, and a 404-not-403 cross-tenant test.

⚠ **Decimals serialise as JSON numbers, not quoted strings.** The published API-contract example
quotes them (`"180.000"`); this repository does not — `ConnectionSummaryDto.CapacityKw` is
`decimal?` and reaches the generated client as `/** Format: double */ capacityKw: null | number`.
One convention beats matching a document, and it means plan 7's chart takes `number | null` with
no parsing step. **DECIDED HERE** — §16, item 6.

### 10.1 `GET /api/v1/consumption/day` — `.TenantScoped("metering-point")`

Query: `date` (ISO `yyyy-MM-dd`, required) · `meteringPointIds` (repeated `Guid`, at least one).

```jsonc
{
  "date": "2026-08-12",
  "meteringPointIds": ["0199a1a0-0000-7000-8000-000000000101"],
  "intervalCount": 96,                       // 92 | 96 | 100 — the client must never assume 96
  "dataState": "PROVISIONAL",                // NO_DATA | PARTIAL | PROVISIONAL | FINAL
  "lastDataDate": "2026-08-14",              // max over the selected points, or null
  "lastCorrectedAt": "2026-08-13T09:22:41Z", // or null — drives the corrected-on marker
  "productionIsDeclaredZero": false,         // true iff EVERY selected point is NEVER  [F02-R33]
  "productionDeclaration": null,             // non-null ONLY when exactly one point is selected
  "intervals": [
    {
      "pos": 1,
      "start": "2026-08-12T00:00:00+02:00",
      "end":   "2026-08-12T00:15:00+02:00",
      "dstPass": null,                       // null | "A" | "B"
      "consumptionKwh": 180.0,
      "productionKwh": 0.0,
      "netUsageKwh": 180.0
    }
  ],
  "summary": {
    "consumptionKwh": 11420.0,
    "productionKwh": 0.0,
    "netUsageKwh": 11420.0,
    "dataState": "PROVISIONAL"
  }
}
```

`productionDeclaration`, when present:

```jsonc
{ "expectation": "NEVER", "source": "CUSTOMER_DECLARED",
  "setBy": "p.devries@vandersteen.nl", "setAt": "2026-07-01T08:14:00Z" }
```

⚠ **There is no `blocks`, `blockKwh`, `netPositionKwh`, `isPeak`, `dayAheadPriceEurMwh`,
`coverageRatio` or `surplusKwh` key ANYWHERE in this envelope** — not as `null`, not as `0`,
not as an empty array. The published example is pre-`[DEC-22]`: it carries a gross-consumption
summary and no `netUsageKwh`, so implementing it verbatim ships the wrong product. Design §7.15
requires a test that asserts against the raw JSON that these keys are **absent**.

⚠ **A missing interval is an ABSENT ENTRY.** Never `0`, never `null`, never a placeholder object.
`[F02-R25]`, `[F03-R06]`. Design §7.15 requires a test that **fails** if a missing interval is
serialised as 0 or null. `intervals.Length` may therefore be less than `intervalCount`, and the
chart draws the difference as a gap.

⚠ **`dstPass`** is `"A"` for the first pass of the autumn duplicate hour (Pos 9–12) and `"B"` for
the second (Pos 13–16); `null` on every other interval of every other day. The chart composes
`02:00 A` / `02:00 B` from it and must **not** re-derive the pass from the UTC offset.

⚠ **`netUsageKwh` is missing when EITHER side is missing**, not "the other series' value"
(position-and-coverage §2.1). Where `productionIsDeclaredZero` is true, production is `0.0` — a
**declared** zero from master data, traceable through `productionDeclaration` — and
`netUsageKwh` equals `consumptionKwh`.

**Aggregation over several metering points** sums each field per `pos` server-side. An interval is
present in the aggregate only if it is present for **every** selected point; the envelope's
`dataState` is the **worst** state across the selection, ordered
`NO_DATA < PARTIAL < PROVISIONAL < FINAL`.

### 10.2 `GET /api/v1/consumption/month` — `.TenantScoped("metering-point")`

Query: `month` (`yyyy-MM`, required) · `meteringPointIds` (repeated `Guid`, at least one).

```jsonc
{
  "month": "2026-08",
  "meteringPointIds": ["0199a1a0-0000-7000-8000-000000000101"],
  "dayCount": 31,
  "dataState": "PARTIAL",
  "lastDataDate": "2026-08-14",
  "days": [
    { "date": "2026-08-01", "intervalCount": 96, "dataState": "FINAL",
      "consumptionKwh": 11420.0, "productionKwh": 0.0, "netUsageKwh": 11420.0 },
    { "date": "2026-08-15", "intervalCount": 96, "dataState": "NO_DATA",
      "consumptionKwh": null, "productionKwh": null, "netUsageKwh": null }
  ],
  "summary": {
    "consumptionKwh": 158900.0, "productionKwh": 0.0,
    "netUsageKwh": 158900.0, "dataState": "PARTIAL"
  }
}
```

⚠ **Every day of the month is present in `days[]`, including days with no data**, which carry
`dataState: "NO_DATA"` and `null` volumes. This is deliberately the **opposite** of the day
envelope's absent-interval rule, and the reason is `[F03-R10]`: the month chart must mark missing
days as **stubs, not short bars**, and it cannot mark a day the payload does not mention.
`days.length == dayCount` always. **DECIDED HERE** — §16, item 7.

⚠ **`null` volumes mean missing. `0.0` means measured zero.** A plan that coalesces `null` to `0`
in the mapper or in the component has erased the distinction the whole slice exists to preserve.

### 10.3 Connection DTOs — `LastDataDate` stops being null

`ConnectionSummaryDto` and `ConnectionDetailDto` already carry `DateOnly? LastDataDate`
(`src/Core/PeakPower.Contracts/Customer/Portal/PortalContracts.cs:70` and `:93`). Plan 6 populates
both from `max(metering_point_day_state.delivery_date) WHERE state <> 'NO_DATA'`;
`PortalMappings.cs:163` and `:188` currently hard-code `LastDataDate: null` and both lines change.
The doc comment on `ConnectionSummaryDto` saying it is "ALWAYS null in slice 1" is deleted.

`ConnectionDetailDto` gains **one** field, at the end of the record:

```csharp
IReadOnlyList<DayStateDto> RecentDataStates          // 14 entries, oldest first
```

```csharp
public sealed record DayStateDto(DateOnly Date, string State);   // State is a MeteringDayState
```

⚠ Fourteen entries for the **customer** strip; **twenty-one** for the employee heat map (§10.4).
The two numbers come from different mockups (`ean-detail.svg` and `employee-ingestion-health.svg`)
and neither is a typo.

### 10.4 Employee data-health — four responses, FROZEN

On the employee host (`/api/v1`, unscoped by construction — the back office is not tenant-scoped,
so none of this needs tenancy work).

**`GET /api/v1/data-health/messages?brpId=&status=&page=&pageSize=`**

```jsonc
{
  "items": [{
    "id": "0199…", "brpId": "0199…", "brpCode": "PVNED",
    "correlationId": "0199…", "receivedAt": "2026-08-13T04:02:11Z",
    "status": "PROCESSED",                    // RECEIVED|PROCESSING|PROCESSED|FAILED|DUPLICATE
    "payloadBytes": 41822, "remoteIp": "10.0.0.7",
    "failureCode": null, "failureDetail": null,
    "processedAt": "2026-08-13T04:02:12Z",
    "versionCount": 2, "quarantinedSeriesCount": 0
  }],
  "total": 1841, "page": 1, "pageSize": 50
}
```

**`GET /api/v1/data-health/quarantine?reason=&resolved=&page=&pageSize=`**

```jsonc
{
  "items": [{
    "id": "0199…", "inboundMessageId": "0199…", "brpCode": "PVNED",
    "reason": "UNKNOWN_EAN",                  // UNKNOWN_EAN|EAN_VALIDITY|WRONG_BRP|NOT_ELECTRICITY
    "resourceObject": "871685900000000042",
    "deliveryDate": "2026-08-12", "direction": "CONSUMPTION", "pointCount": 96,
    "receivedAt": "2026-08-13T04:02:11Z", "ageHours": 26,
    "resolvedAt": null, "resolvedBy": null
  }],
  "total": 3, "page": 1, "pageSize": 50
}
```

**`GET /api/v1/data-health/metering-points?state=&silentOnly=&page=&pageSize=`**

```jsonc
{
  "items": [{
    "meteringPointId": "0199…", "ean": "871685900000000001",
    "eanDisplay": "8716 8590 0000 0000 01", "displayLabel": "Vestiging Rotterdam",
    "customerId": "0199…", "customerLegalName": "Van der Steen Logistiek B.V.",
    "brpId": "0199…", "brpCode": "PVNED",     // brpCode is null when no BRP is assigned
    "productionExpectation": "EXPECTED",
    "lastDataDate": "2026-08-14", "isSilent": false,
    "recentDataStates": [{ "date": "2026-07-25", "state": "FINAL" }]   // 21 entries, oldest first
  }],
  "total": 31, "page": 1, "pageSize": 50
}
```

⚠ **This list includes points with no BRP assigned** (design §3.1), which is why `brpId`/`brpCode`
are nullable here and `NOT NULL` in the database — a point can be created before it is routed.

**`POST /api/v1/data-health/messages/{id}/replay`**

```jsonc
{ "inboundMessageId": "0199…", "correlationId": "0199…",
  "outcome": "REPLAYED",                      // REPLAYED | NO_CHANGE | FAILED
  "versionsCreated": 1, "quarantineEntriesResolved": 1,
  "failureCode": null, "failureDetail": null }
```

⚠ **`NO_CHANGE` is the `[F02-R27]` case and it is asserted by version count**: replaying an
already-processed message whose content matches the current version produces **no second
version**. The replay reads the stored raw payload and goes through the **same** adapter selected
by the stored `brp_id` — including after that BRP has been deactivated (S2-D3).

### 10.5 OpenAPI

Both Verify snapshots are regenerated and re-accepted in the same commit as the endpoints:

```
tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json
tests/PeakPower.Integration.Tests/Contract/EmployeeOpenApiSnapshotTests.the_employee_openapi_document_matches_the_reviewed_snapshot.verified.json
```

Then, in `peakpower-web`, `npm run generate:clients` (which reads
`peakpower-platform/artifacts/openapi/{customer,employee}.json`) and the regenerated
`libs/api-client-*/src/generated/*-schema.d.ts` are **committed**. `npm run verify:clients` fails
if they drift.

---

## 11. Angular

Workspace layout is slice 1's, unchanged. Standalone components · signals · lazy feature routes ·
strictly typed reactive forms · **no `NgModule`** · selectors prefixed `pp-`.

### 11.1 `@peakpower-nl/shared-ui` public-api additions — NORMATIVE, owned by plan 7

Appended to `libs/shared-ui/src/public-api.ts` (**this filename — not `index.ts`**; the workspace
TS config is `tsconfig.json`, **not** `tsconfig.base.json`):

```ts
export {
  PpUsageChart,
  PpUsageMonthChart,
  type PpUsageDataState,
  type PpUsageInterval,
  type PpUsageDay,
  type PpUsageMonthDay,
  type PpUsageMonth,
} from './lib/usage-chart/public';
```

### 11.2 The two chart components — the data-in/SVG-out contract, S2-D5

⚠ **These two components are the entire replaceable surface.** S2-D5 defers `[OQ-22]`; what makes
that deferral cheap is that no consumer knows how they draw. **A consumer may not pass a colour,
a scale, an axis configuration, a formatter or an SVG fragment**, and the components emit
**semantic** events (which interval, which date) — never pixel or DOM events. Replacing them with
a library is then two files plus their specs.

```ts
export type PpUsageDataState = 'NO_DATA' | 'PARTIAL' | 'PROVISIONAL' | 'FINAL';

export interface PpUsageInterval {
  pos: number;                       // 1-based
  start: string;                     // ISO 8601 with offset, e.g. 2026-08-12T00:00:00+02:00
  end: string;
  dstPass: 'A' | 'B' | null;
  consumptionKwh: number | null;
  productionKwh: number | null;
  netUsageKwh: number | null;
}

export interface PpUsageDay {
  date: string;                      // yyyy-MM-dd
  intervalCount: number;             // 92 | 96 | 100 — the axis length, NOT intervals.length
  dataState: PpUsageDataState;
  intervals: PpUsageInterval[];      // sparse: a missing interval is ABSENT
  productionIsDeclaredZero: boolean;
  lastCorrectedAt: string | null;
}

export interface PpUsageMonthDay {
  date: string;                      // yyyy-MM-dd
  dataState: PpUsageDataState;
  consumptionKwh: number | null;
  productionKwh: number | null;
  netUsageKwh: number | null;
}

export interface PpUsageMonth {
  month: string;                     // yyyy-MM
  dayCount: number;
  dataState: PpUsageDataState;
  days: PpUsageMonthDay[];           // dense: days.length === dayCount
}

@Component({ selector: 'pp-usage-chart' })
class PpUsageChart {
  day = input.required<PpUsageDay>();
  height = input(320);                          // px
  hoveredPos = model<number | null>(null);      // two-way, so the KPI strip can follow the hover
  intervalActivated = output<number>();         // pos, on click or Enter
}

@Component({ selector: 'pp-usage-month-chart' })
class PpUsageMonthChart {
  month = input.required<PpUsageMonth>();
  height = input(280);
  hoveredDate = model<string | null>(null);     // yyyy-MM-dd
  daySelected = output<string>();               // yyyy-MM-dd — [F03-R09] drill-in
}
```

⚠ **`intervalCount` drives the x-axis, not `intervals.length`.** A 100-point autumn day with four
missing intervals still has 100 slots and four gaps. Using `intervals.length` silently rescales
the day, which is precisely the failure `[F03-R06]` forbids.

⚠ **Volumes are `number | null` and the component never coalesces `null` to `0`.** Missing is a
gap in the path, not a point on the zero line. A month day whose `dataState` is `NO_DATA` renders
as a **marked stub**, not a short bar `[F03-R10]`.

### 11.3 The three series, the tokens and the stroke patterns

| Series | Token | Value | Stroke |
| --- | --- | --- | --- |
| **Net usage** (the `[DEC-22]` basis, drawn on top) | `--pp-chart-usage` | `#006ECF` | solid, 2px |
| **Consumption** | `--pp-chart-hedge` | `#004C94` | dashed `6 3`, 1.5px |
| **Production** | `--pp-chart-long` | `#0FA69D` | dotted `2 3`, 1.5px |
| Zero line (always drawn) | `--pp-border-strong` | `#c3cddb` | solid, 1px |
| Corrected-on marker | `--pp-violet` | `#9151B8` | — |
| Provisional / partial hatching | `--pp-amber` | `#EEB72B` | — |
| Declared-zero production label | `--pp-text-faint` | `#8b98aa` | — |

⚠ **The three series must be distinguishable by STROKE PATTERN as well as colour**, asserted in the
component spec by rendering with colour removed (design §7.16). All three clear 3:1 against
`--pp-surface` (`#ffffff`): `#0FA69D` is the closest at 3.02:1, which is why it is the *stroke*
token and `--pp-chart-long-fill` (`#00D4C6`, 1.9:1) is **fill only**.

⚠ **`--pp-indigo` means violet / corrected, never the hedge line** (slice 1 §11, rule 2). It is
the corrected-on marker's alias and nothing else.

### 11.4 The seven `--pp-chart-*` tokens — verified today

Read from `libs/shared-ui/src/styles/colors.css:52-55`. **All seven already exist. No new colour
token is created for the charts**; a chart that needs a colour uses one of these or an existing
palette token.

```css
--pp-chart-usage:#006ECF;        --pp-chart-hedge:#004C94;
--pp-chart-short:#FF8F5C;        --pp-chart-short-stroke:#F24F4F;
--pp-chart-long:#0FA69D;         --pp-chart-long-fill:#00D4C6;
--pp-chart-peak:#3C93FA;
```

`--pp-chart-short`, `--pp-chart-short-stroke` and `--pp-chart-peak` are **unused in slice 2** —
they belong to the deferred coverage bands and peak shading. Leave them alone.

⚠ **There is no dark theme in this workspace.** `colors.css` declares one `:root` block and no
`prefers-color-scheme` or `[data-theme]` variants. Design §7.16's "in both themes" is satisfied by
the tokens' documented 3:1-on-white property; **do not invent a dark palette in this slice.**

### 11.5 The design-token guard, extended to `libs/shared-ui`

`apps/customer-portal/src/app/shared/design-tokens.spec.ts` scans **only `apps/`** today, and its
own doc comment explains why: `libs/shared-ui/src/lib/**` legitimately declares seventeen
component-local properties inside `:host` blocks. Plan 7 extends it to `libs/shared-ui/src/lib`
by folding **per-file `:host` declarations** into the declared set for that file, so a
`var(--pp-usage-chart-gap)` declared in the chart's own `:host` passes while a
`var(--pp-chart-usaeg)` typo fails. The three vacuity guards (`declared.size > 100`,
`appFiles.length > 40`, `references.length > 200`) grow with the new scope and must be re-pinned to
the new computed numbers, **not to a floor**.

⚠ **An undefined custom property does not fall back and does not warn.** `background:
var(--pp-red-surface)` resolves to nothing, the element renders with no background, and every DOM
and CSS assertion still passes. That is why this guard exists and why extending it is on the
critical path for the chart work.

### 11.6 The `/consumption` route — three one-line edits and one five-line route

The rail already declares the row, labelled **Volume** `[DEC-115]`, disabled with the reason
`"Consumption charts arrive with metering-data ingestion."` Enabling it is:

1. `apps/customer-portal/src/app/shell/customer-nav.ts` — add `consumption: '/consumption'` to `PATH`
2. same file — add `'consumption'` to `ENABLED_ROUTE_KEYS`
3. same file — delete the `consumption:` entry from `DISABLED_REASON`
4. `apps/customer-portal/src/app/app.routes.ts` — one guarded lazy route

⚠ **`ENABLED_ROUTE_KEYS` is read only by its own spec. `PATH` is what actually puts the row on
screen** — `item()` derives `path` from `PATH` and nothing else. Editing only `ENABLED_ROUTE_KEYS`
turns the spec green and leaves the rail unchanged.

### 11.7 The Angular guard literals that break — exact before and after

⚠ **All five move in the same commit as the feature, or the suite goes red.**

`apps/customer-portal/src/app/shell/customer-nav.spec.ts:79`

```ts
// before
expect([...ENABLED_ROUTE_KEYS].sort()).toEqual(['company', 'connections', 'dashboard']);
// after
expect([...ENABLED_ROUTE_KEYS].sort()).toEqual(['company', 'connections', 'consumption', 'dashboard']);
```

`apps/customer-portal/src/app/shell/customer-nav.spec.ts:92`

```ts
expect(disabled.length).toBe(5);     // before
expect(disabled.length).toBe(4);     // after
```

`apps/customer-portal/src/app/app.routes.spec.ts:34`

```ts
const GUARDED = ['/dashboard', '/connections', '/company'] as const;                   // before
const GUARDED = ['/consumption', '/dashboard', '/connections', '/company'] as const;   // after
```

`apps/customer-portal/src/app/features/connections/connection-detail-page.spec.ts:266-274` —
the **inversion**. Today it asserts the date is *not* printed even when present on the wire:

```ts
// before
it('says there is no measurement yet rather than printing a date', () => {
  loaded({ lastDataDate: '2026-08-01' });
  expect(fact('Latest data')).toBe(NO_DATA_YET);
  expect(root.textContent).not.toContain('2026-08-01');
});
// after
it('prints the latest data date when the wire carries one', () => {
  loaded({ lastDataDate: '2026-08-01' });
  expect(fact('Latest data')).toBe('1 augustus 2026');   // formatDutchDate
  expect(fact('Latest data')).not.toBe(NO_DATA_YET);
});
// and a second test keeps NO_DATA_YET for lastDataDate: null
```

`apps/customer-portal/src/app/features/dashboard/dashboard-page.ts` — the banner currently says
*"There is no metering data yet, so this page has nothing to total"*, which is false the moment
data exists. **Nothing asserts that sentence today** (`dashboard-page.spec.ts` covers only the
greeting, the `/connections` link, the single `h1` and four CSS rules), so the copy change is free
— **add an assertion for the replacement while there**, or the next person has the same free hand.

`apps/customer-portal/src/app/shared/labels.ts:28` keeps `NO_DATA_YET` and its exact string
`'No data yet — ingestion arrives in a later slice'` — ⚠ the em dash is U+2014 and
`labels.spec.ts:132` pins it. `connection-list-page.spec.ts:228` also asserts it and stays green
because that fixture's `lastDataDate` is `null`.

---

## 12. The .NET guard literals that break — exact before and after

⚠ **These live in `PeakPower.Integration.Tests`, so they fail `dotnet test`, not
`-warnaserror`.** Adding the four global query filters is necessary but **not sufficient**; **three
test files** pin exact literals that the four new tables break, and they all move in the same commit
as migration 9. **Six literals, not two** — the two below plus the four in "More literals that
break" further down. Plan 2 owns every one of them (§17 row 2).

`tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs:143-147` — nine names to
thirteen, **ordinal sort order**:

```csharp
// before
string[] expected =
[
    "AuditRecord", "Customer", "CustomerAccount", "EanPoolEntry", "MeteringPoint",
    "OnboardingApplication", "PasswordResetToken", "RefreshToken", "Wallet",
];

// after
string[] expected =
[
    "AuditRecord", "Customer", "CustomerAccount", "DailyPosition", "EanPoolEntry",
    "IntervalDataVersion", "IntervalReading", "MeteringPoint", "MeteringPointDayState",
    "OnboardingApplication", "PasswordResetToken", "RefreshToken", "Wallet",
];
```

The comment above it (`:135-137`) that reads *"Nine: migration 2's five … and migration 5's
EanPoolEntry"* becomes thirteen and names migration 9's four.

`tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs:653` and `:674`:

```csharp
customerIdOwned.Length.ShouldBe(7);    // before, line 653
customerIdOwned.Length.ShouldBe(11);   // after

customerOwned.Length.ShouldBe(7);      // before, line 674
customerOwned.Length.ShouldBe(11);     // after
```

`accountIdOwned.Length.ShouldBe(2)` at `:654` is **unchanged** — no slice-2 table is
account-scoped. The two long comments at `:643-652` and `:665-673` explaining "seven, not five"
are rewritten to explain eleven.

**Why both numbers move by exactly four.** `customerIdOwned` discovers by
`property.Name.EndsWith("CustomerId")`, and §5 gives exactly four new entities such a property.
`customerOwned` is `(customerIdOwned ∪ accountIdOwned)` minus `ExemptTables`
(`customer.onboarding_application`, `metering.ean_pool`); the exempt set does not grow, so
`(11 + 2 distinct) − 2 = 11`.

### More literals that break — four the first draft of this section missed

Plan 2 found these while writing migration 9; each has been re-verified against the repository at
the line cited. They are §12's literals as much as the two above, and they move in the same commit.

**1. `tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs:234`** — the pinned
snapshot inside `the_five_customer_owned_entities_in_todays_model_are_all_covered` (`:220`):

```csharp
filtered.Length.ShouldBe(5,     // before
filtered.Length.ShouldBe(9,     // after
```

The four new query filters take it to nine. **The test's name moves with the number**, to
`the_nine_customer_owned_entities_in_todays_model_are_all_covered` — a test called `the_five_…`
asserting nine is how the next reader is misled. This is a *second*, deliberately redundant pin
alongside `:143-147`'s name list; its own message says so ("a pinned snapshot of today's model,
not a substitute for the metadata walk above").

**2. `tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs:895`** — catalog
discovery, not model discovery:

```csharp
customerIdTables.Count.ShouldBe(7);     // before
customerIdTables.Count.ShouldBe(11);    // after
```

⚠ **The discovery query must also gain a partition exclusion, or this number is 47 rather than
11.** `DiscoverTablesAsync` (`:808-826`) reads `information_schema.tables` filtered on
`t.table_type = 'BASE TABLE'`, and **PostgreSQL lists every partition as a `BASE TABLE`** — so the
moment migration 9 creates `metering.interval_reading`'s partitions, each one is discovered on its
own. Join `pg_class pc` (on `pc.relname = c.table_name`, through `pg_namespace`) and add:

```sql
AND NOT pc.relispartition
```

Without it the literal is not merely wrong at 11: it moves **every time the partition-maintenance
job runs**, which makes it a guard nobody can keep green and everybody eventually deletes.

⚠ Excluding partitions from this *count* would weaken the guard if nothing else looked at them, so
it does not stand alone: plan 2 adds `PartitionPolicyCoverageTests`, which enumerates every
partition in the four schemas — not just `interval_reading`'s — and holds each to the same
RLS-plus-two-policies bar. The count guards parents; the new class guards partitions. Split, both
are checkable; merged into one number, neither is.

`accountIdTables.Count.ShouldBe(2)` at `:896` is **unchanged** — no slice-2 table is
account-scoped.

**3. `tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs:913`** — the same query
after `ExemptTables`:

```csharp
tables.Count.ShouldBe(7);      // before
tables.Count.ShouldBe(11);     // after
```

Both long comments above these two lines (`:885-894` and `:906-912`) explain "seven, not five" and
are rewritten to explain eleven — including why the partition exclusion is now part of the query.

**4. `tests/PeakPower.Integration.Tests/Contract/EnumWireAlgorithmDivergenceTests.cs:86-98`** —
`ExpectedEnumTypeNames` holds **ten** names today (verified: `AccountStatus`, `Commodity`,
`CustomerStatus`, `FlowDirection`, `LegalEntityType`, `OnboardingStatus`, `ProductionExpectation`,
`ProductionExpectationSource`, `SigningAuthority`, `VolumeBand`) and becomes **seventeen**. §4's
seven metering enums each become an EF-mapped property in migration 9, so `ModelEnumTypes()`
discovers them; the array is pinned by name rather than counted, precisely so this shows up as a
list to extend rather than a number to bump.

**The test name moves too**: `The_model_discovers_exactly_the_ten_enum_types_EnumToTextConvention_converts`
(`:155`) becomes `…the_seventeen_enum_types_…`. The doc comment's "Ten, not the thirteen
`PeakPower.Domain` declares" clause is rewritten for the new totals, and `:163` inside the test
body carries the same number.

⚠ **`interval_reading` is partitioned, and `entityType.GetTableName()` returns the parent.**
`ENABLE ROW LEVEL SECURITY` and both policies are applied to the **parent** (so this guard passes)
**and** to every partition (so a direct `SELECT` on a partition is policed too). Both, not either.

**Four new global query filters** in `PeakPowerDbContext.OnModelCreating`, matching the existing
`!IsAuthenticated || …` shape exactly — the shape is not cosmetic; every anonymous path in this
DbContext relies on the filter collapsing to `true`:

```csharp
modelBuilder.Entity<IntervalDataVersion>()
    .HasQueryFilter(v => !_customerContext.IsAuthenticated || v.CustomerId == _customerContext.CustomerId);
modelBuilder.Entity<IntervalReading>()
    .HasQueryFilter(r => !_customerContext.IsAuthenticated || r.CustomerId == _customerContext.CustomerId);
modelBuilder.Entity<MeteringPointDayState>()
    .HasQueryFilter(s => !_customerContext.IsAuthenticated || s.CustomerId == _customerContext.CustomerId);
modelBuilder.Entity<DailyPosition>()
    .HasQueryFilter(p => !_customerContext.IsAuthenticated || p.CustomerId == _customerContext.CustomerId);
```

`InboundMessage`, `QuarantinedSeries`, `OperationalAlert` and `MeteringPointBrpAssignment` get
**no** query filter and are registered on the DbContext for the employee host's use. They carry no
`CustomerId`, so neither guard discovers them and neither reports a hole.

---

## 13. `PeakPower.DevStubs` — the generator

⚠ **S2-D4: the generator emits templated XML *text* and never serialises the parser's own model.**
That is why `PeakPower.DevStubs` may not reference `PeakPower.Integration.Brp.Pvned` (§3.1).
Otherwise generator and parser share a type and a shared misreading of the PVNed format passes
every test in the slice.

⚠ **Every document goes over the real webhook.** `[F02-R30]` forbids any code path that writes
readings directly, and design §7 measures the whole slice through it.

### 13.1 The fourteen in-scope scenarios

Integration-spec §11 names sixteen; **two are out** — the imbalance report (`[DEC-25]`, design
§3.2) and the manual reconciliation entry (`[F02-R36]`, deferred). The fourteen, and the scenario
key each carries so plans 5, 6 and 8 name them identically:

| # | Key | What it posts |
| --: | --- | --- |
| 1 | `normal-day` | A 96-interval `A23` day with a plausible load shape |
| 2 | `daily-cadence` | One document per EAN per day `[DEC-38]` across the seeded connections |
| 3 | `both-directions` | `A01` **and** `A02` for a producing EAN |
| 4 | `no-production-series` | `A02` only, for an EAN whose `production_expectation` is `NEVER` |
| 5 | `production-exceeds-consumption` | Intervals where `p > c`, so negative net usage is exercised |
| 6 | `missing-production-series` | `A02` only, for an EAN flagged **`EXPECTED`** — indistinguishable on the wire from #4 |
| 7 | `dst-spring-92` | The spring-forward Sunday, 92 points |
| 8 | `dst-autumn-100` | The autumn fall-back Sunday, 100 points |
| 9 | `correction-supersedes` | A second document for the same (EAN, date, direction) |
| 10 | `out-of-order-pair` | The later `CreatedDateTime` **received first** |
| 11 | `post-window-reconciliation` | A correction landing well after 10 working days |
| 12 | `unknown-ean` | An 18-digit EAN registered nowhere |
| 13 | `wrong-brp` | An EAN assigned to a different BRP row |
| 14 | `invalid-<code>` | **Eleven** documents, one per §8.4 code the *adapter* can raise (the nine §8.2 reject rules plus `UNSUPPORTED_DIRECTION` and `UNSUPPORTED_MEASUREMENT_UNIT`); rules 10 and 11 are scenarios 12 and 13 above — `UNKNOWN_METERING_POINT` and `WRONG_BRP_FOR_METERING_POINT` are marked "quarantine, not reject" and are decided by the pipeline, not the adapter. Plus `size-25mb` (accepted at exactly 26 214 400 bytes) and `size-26mb` (refused with 413) |

⚠ **Negative fixtures for the adapter's own unit tests are HAND-WRITTEN and checked in, never
generated** (design §8, §10). DevStubs' `invalid-*` documents drive the pipeline end to end; they
do not replace the checked-in fixtures, and the golden positive document is transcribed by hand
from integration-spec §6.

### 13.2 Backfill, cadence, load test, and the confirmation-phrase gate

Three commands beyond the scenario suite: a **90-day backfill** across the eleven seeded
connections, a **cadence pusher**, and a **load test**. All three are gated on the
confirmation-phrase pattern
`src/Hosts/PeakPower.Migrator/SeedingGate.cs` already establishes — an ordinary English sentence,
compared ordinally after trimming, so `true`, `1`, `yes` and the *other* subject's phrase all
leave it off and are refused **audibly**.

⚠ **DevStubs cannot reuse `SeedingGate` itself** — it lives in `PeakPower.Migrator`, and a host
may not reference another host. It declares its own gate on the same pattern.
**DECIDED HERE** — §16, item 8.

```csharp
namespace PeakPower.DevStubs;

public enum DevStubsSubject { Backfill, Cadence, LoadTest }

public static class DevStubsGate
{
    public const string BackfillKey = "DevStubs:Backfill";   // DevStubs__Backfill
    public const string CadenceKey  = "DevStubs:Cadence";    // DevStubs__Cadence
    public const string LoadTestKey = "DevStubs:LoadTest";   // DevStubs__LoadTest

    public const string BackfillConfirmation =
        "yes, post ninety days of generated documents to this webhook";
    public const string CadenceConfirmation =
        "yes, keep posting generated documents on the cadence";
    public const string LoadTestConfirmation =
        "yes, post a year of generated documents for a hundred connections";

    public static string KeyFor(DevStubsSubject subject);
    public static string ConfirmationFor(DevStubsSubject subject);
}
```

⚠ **`LoadTest` is the third subject and the enum is CLOSED at three.** §17 row 8's load test
cannot exist without a way to post 51 100 documents, and `[F02-R30]` forbids every route but the
real webhook — so the load test needs a gated DevStubs command or it needs a forbidden back door.
It is named here, in the contract, so that whoever writes plan 5's DevStubs tasks implements this
subject rather than inventing a fourth of their own. A genuinely new subject is a contract change,
not a plan's local decision.

**Disjointness — NORMATIVE across all five phrases.** No confirmation phrase may be a prefix,
suffix or substring of any other, across **both** gates:

| Gate | Subject | Phrase |
| --- | --- | --- |
| `SeedingGate` | `DemoCompanies` | `yes, seed demo companies with a published password` |
| `SeedingGate` | `StaffAccounts` | `yes, seed the named staff accounts` |
| `DevStubsGate` | `Backfill` | `yes, post ninety days of generated documents to this webhook` |
| `DevStubsGate` | `Cadence` | `yes, keep posting generated documents on the cadence` |
| `DevStubsGate` | `LoadTest` | `yes, post a year of generated documents for a hundred connections` |

The five above satisfy it — verified pairwise. The requirement is what makes the gates' "refused
audibly" behaviour honest: the wrong subject's phrase must be *rejected*, not silently accepted by
a containment check, and a phrase that contained another would turn one operator's confirmation
into two. A test iterating `Enum.GetValues<DevStubsSubject>()` and `Enum.GetValues<SeedingSubject>()`
pins the whole set, so a sixth phrase added later fails this assertion rather than passing quietly.

---

## 14. Copy rules

Slice 1's rules, unchanged and binding on every new screen: sentence case everywhere; ALL CAPS
only for stat-card labels and table column heads; **no emoji, no icon set**; every number carries
its provenance in a faint sublabel; empty and disabled states name the reason; nl-NL numbers
(`385,4 MWh`) with minus as **U+2212 `−`** via `PP_MINUS`.

Two rules slice 2 leans on hardest:

- **"Projected" = not yet measured; "Provisional" = not yet accepted. Never swap them.** A
  `PROVISIONAL` day is measured, and calling it projected is a lie about a number the customer
  will be invoiced on.
- **A declared zero is not an absence.** `[F02-R33]`: where `production_expectation` is `NEVER`,
  the production line reads as a **stated zero traceable to its source, setter and date**
  `[F01-R40]` — not as a gap, and not as an unlabelled flat line. That is the fifth of the five
  data-state treatments and the one most likely to be skipped.

The five visual treatments, named so plans 6 and 7 agree: **gap** · **partial** · **provisional**
· **corrected-on** · **declared zero**.

---

## 15. Testing

| Layer | Tooling |
| --- | --- |
| Domain / Application unit | xUnit v3 + **Shouldly 4.3.0** + NSubstitute — **never FluentAssertions** `[DEC-118]` |
| Persistence & integration | Testcontainers, real PostgreSQL 17 |
| Architecture | NetArchTest (facts 1–2), **Mono.Cecil** IL scanning (facts 3–6) |
| OpenAPI contract | Verify.XunitV3 snapshot |
| Frontend unit | Vitest 4.1.11 + jsdom |
| E2E | Playwright 1.56.1, in `peakpower-web` |

Syntax is `actual.ShouldBe(expected)` and `await Should.ThrowAsync<T>(act)`. ⚠ **Shouldly's
`ShouldContain` is case-insensitive by default** and has silently broken three tests in this
repository; compare with `StringComparison.Ordinal` and assert on structured fields, never by
searching a response body for a substring.

### 15.1 Mutation verification — this repository's stated standard

**Break it first, predict the failure, watch it go red, check the failure is the one you
predicted, then fix it. A green test that was never seen red is not evidence.** Every plan states,
for every load-bearing assertion: **what to break · what failure to predict · what to watch go
red.** A mutation that breaks the *build* proves nothing about an assertion — if removing a member
orphans a `using`, remove that too.

⚠ **Mutate the case your assertion is actually for, not the easy neighbouring one.** CLAUDE.md
records a guard that was mutation-verified against "the property does not exist" but never against
"the property exists under a different casing", and so certified a half-working guard.

### 15.2 The four that design §10 requires be mutation-verified explicitly

| # | Assertion | The mutation | What must go red |
| --: | --- | --- | --- |
| 1 | **Completeness** (§7.8) | Write `directions.Count == 2` as the completeness test | The `NEVER` + `A02`-only day, which must reach complete, instead stays `PARTIAL` |
| 2 | **Receipt-order supersession** (§7.5, §6.5) | Swap the supersession comparison to `CreatedDateTime` order | The out-of-order pair test: the *earlier-created, later-received* version stops being current |
| 3 | **The DST Pos mapping** (§7.10) | Replace `IntervalStart` with a naive add-15-minutes loop | The autumn 100-point case: Pos 13–16 land an hour early |
| 4 | **The §4.1 rollup shape** (§7.11) | Replace per-interval accumulation with daily-total subtraction | The mixed-export day: `offtake` reads 5 where the fixture says 10, and `export` reads 0 where it says 5 |

Three more that each plan must mutation-verify in passing, because each is a silent failure:

- **Architecture fact 3** — add a `PeakPower.Integration.Brp.*` reference to `PeakPower.Ingestion`
  and watch `Fact_3_ingestion_references_no_Brp_adapter` go red (design §7.22). Until then it is a
  fact that has never run.
- **The zero-skip CI assertion** — drop the second checkout and watch it fail (design §7.1).
- **The absent-key assertion** — serialise a missing interval as `0` and watch the day-envelope
  test go red (design §7.15).

### 15.3 Commands

```bash
# platform, from /Users/thinhhuynh/PeakPower/peakpower-platform
./dev-up
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Tenancy"
dotnet test tests/PeakPower.Architecture.Tests
dotnet test tests/PeakPower.AppHost.Tests
tools/verify-solution-layout.sh
tools/verify-migrator.sh
tools/verify-build-settings.sh
tools/verify-aspire-api.sh
tools/verify-repositories.sh
dotnet ef migrations add IngestionAndIntervalData \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator
aspire publish -o ./deploy

# web, from /Users/thinhhuynh/PeakPower/peakpower-web
npm ci
npm test
npm run test:shared-ui
npm run test:customer-portal
npm run test:employee-portal
npm run generate:clients
npm run verify:clients
npx playwright test
```

⚠ **`verify-migrator.sh` runs the real Migrator process TWICE** against a throwaway `postgres:17`
to prove idempotence. Migration 9 must survive that, which is why §6.6 forbids `now()` in the
partition seed loop.

⚠ **Integration tests use Testcontainers.** Running several suites in parallel across worktrees
can exhaust connections and produce mass Postgres timeouts — retry before reporting a regression.

⚠ **`cp -a` preserves mtimes and leaves MSBuild with stale binaries**; use plain `cp` or `touch`.

---

## 16. Values decided here that the design document did not settle

Nine. Each has a recommended value that **is** the value — eight parallel plans cannot wait — and
each is flagged so a reader can overturn it in one place rather than eight.

| # | Item | Decision | Confirm? |
| --: | --- | --- | --- |
| 1 | `daily_position`'s day column | **`delivery_date`**, not the published DDL's `local_date`. One word for one thing across seven tables; design §4.1's own prose says "delivery date" | Low risk. Add to design §11 as a ninth amendment |
| 2 | `daily_position`'s column set | Drop `block_kwh`, `covered_kwh`, `uncovered_kwh`, `surplus_kwh`, `spot_cost_eur` (Phase 2 / **S2-D6**); add `offtake_kwh` and `export_kwh` (design §4.1) | Low risk. Same amendment |
| 3 | The BRP-reassignment audit | A first-class `customer.metering_point_brp_assignment` **table**, not the published DDL §3.2.1's "ordinary `audit` row" — `[F02-R43]` needs the assignment **in force at receipt time**, and an audit payload is not queryable history. Design §3.1 names the table explicitly, so this resolves an internal disagreement in favour of the design | **Worth confirming** |
| 4 | Two failure codes beyond §8.2's eleven | `UNSUPPORTED_DIRECTION` (A03/A04, integration-spec §4.1) and `UNSUPPORTED_MEASUREMENT_UNIT` (`KWT`/`MAW` on an allocation). §8.2 has no row for either, and the design requires both behaviours | **Worth confirming** — the strings must match a real PVNed contract eventually |
| 5 | Where the sender and receiver GLNs live | `PvnedAdapterOptions`, bound from configuration section `Brp:Pvned`, **not** columns on `metering.brp`. The design's column list for that table is closed, and a GLN is a format concept | Low risk |
| 6 | Decimal serialisation | **JSON numbers**, not the published example's quoted strings. Matches `CapacityKw` and the generated typed client already in the repository | Low risk |
| 7 | Month envelope density | Every day present, `NO_DATA` days carrying `null` volumes — the **opposite** of the day envelope's absent-interval rule, because `[F03-R10]` needs a stub to mark | **Worth confirming** — it is the one place two rules in this file deliberately disagree |
| 8 | The DevStubs gate | Its own `DevStubsGate` on `SeedingGate`'s pattern, with two new phrases. A host may not reference another host, so reuse is impossible | Low risk |
| 9 | `production_expectation_set_by` / `_set_at` | **Added by migration 9**, though the design's `metering_point` column list does not name them. `[F02-R33]` is in scope and requires the declared zero to be traceable to its **source, setter and date** `[F01-R40]`; slice 1 shipped only `expectation_source`, so the treatment is otherwise unbuildable and §10.1's `productionDeclaration` has nothing to carry | Low risk. Add to design §11 with items 1–2 |

**Not decided here, and blocking nothing:** `[OQ-102]` (the RLS login-role passwords are literals
inside migration 2; this slice adds six more tables under those roles), `[OQ-97]` (the GS1 check
digit — **none of the thirty-one demo EANs would pass, and ingestion keys on EAN**, so the blast
radius grows with every ingested row), `[OQ-65]` and `[OQ-20]` (book the PVNed walkthrough now
regardless; a third party's calendar has lead time), `[OQ-22]` (deferred by **S2-D5**), and
`[OQ-05]` / `[R-01]`, which **stays scored 20**.

---

## 17. Plan map — what each plan OWNS, and what it may only read

**Dependency order 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8**, with two exceptions: plan 1's calendar half
runs beside its rails half, and plan 7's chart components need only §10 and §11 frozen, so 7's
chart work runs beside 5 and 6.

| # | Plan | Owns exclusively | May only read |
| --: | --- | --- | --- |
| 1 | `2026-09-07-slice-2-plan-1-rails-and-calendar.md` | Both CI workflows and the zero-skip assertion · the four `.csproj` files and the solution entries · `verify-solution-layout.sh`'s array (§3.1) · the `Architecture.Tests` project reference that arms fact 3 · the AppHost changes, `aspire publish`, the regenerated compose file, the Worker Dockerfile stage, `env.example` · the Hangfire spike and the `IIngestionJobQueue` **implementation** (§1.1, §6.9) · **every member of `IMarketCalendar`** (§7.5) | §3.1, §7.4, §7.5 |
| 2 | `2026-09-07-slice-2-plan-2-migration-and-tenancy.md` | **All of §6** — migration 9, every table, index, policy, `REVOKE` and the partition routine · the eight entity classes of §5 · their EF configurations · the four query filters · **both guard literals of §12** · the `ExternalSubjectId` drop · design §11 rows 1–3 landing first | §4, §5, §6, §12 |
| 3 | `2026-09-07-slice-2-plan-3-ingestion-pipeline.md` | `IBrpIngestionAdapter` / `IRawPayloadStore` / `IIngestionJobQueue` **declarations** (§7.1, §7.3, §7.4) · `IBrpIngestionAdapterRegistry` · the webhook route, credential auth, 413, dedupe, correlation id (§9) · the advisory lock and the atomic apply (§9.6) · supersession behind `ux_idv_current` · the four quarantine reasons (§8.5) | §5, §6, §7, §8.5, §9 — and **never** writes migration SQL |
| 4 | `2026-09-07-slice-2-plan-4-pvned-adapter.md` | Everything in `PeakPower.Integration.Brp.Pvned`: SOAP unwrap, XXE hardening, the reconstructed XSD, `SchemaProvenance` (§8.3), code decoding (§8.2), `ResourceObject` interpretation, Pos→instant, the thirteen failure codes (§8.4), `PvnedAdapterOptions` (§8.6), and the hand-written negative fixtures | §7.1, §7.5, §8 — and **never** touches `PeakPower.Ingestion` |
| 5 | `2026-09-07-slice-2-plan-5-rollup-and-devstubs.md` | The completeness rule against `production_expectation` · `[F02-R34]`'s same-transaction promotion · the `daily_position` rollup with the §4.1 accumulators · the FINAL job and the reopen edge · silence detection and `operational_alert` · **all of `PeakPower.DevStubs`** (§13) | §4, §5, §6, §7.5, §8.4, §13 |
| 6 | `2026-09-07-slice-2-plan-6-read-surfaces.md` | The two customer consumption endpoints (§10.1, §10.2) · `LastDataDate` and `RecentDataStates` (§10.3) · the four employee data-health responses and replay (§10.4) · the regenerated OpenAPI snapshots (§10.5) | **§10 is frozen** — it may not change a key |
| 7 | `2026-09-07-slice-2-plan-7-charts-and-web.md` | `PpUsageChart` and `PpUsageMonthChart` and the `public-api.ts` additions (§11.1, §11.2) · the extended design-token guard (§11.5) · the `/consumption` route and rail row (§11.6) · **all five Angular guard literals** (§11.7) · navigation, the five treatments, the KPI strip, the empty state, the connection strip, the dashboard copy, the employee screens · the regenerated typed clients | §10 (frozen), §11 — and **never** changes a `--pp-chart-*` token value |
| 8 | `2026-09-07-slice-2-plan-8-close-out.md` | The 100-EAN × 365-day load test against `[NFR-03]`/`[NFR-04]` · the deployment and DevStubs run against the deployed webhook · the "what this slice does not prove" note in the platform repo · the **remaining** design §11 amendments (rows 4–8, plus the two this file adds in §16) | everything; owns no production code |

⚠ **Plan 2 is the only plan that declares an entity or writes migration SQL. Plan 1 is the only
plan that declares a member of `IMarketCalendar`.** Two plans declaring the same class is a
duplicate-member compile error, not a merge — and it is the single most likely way eight parallel
plans fail to compile on the day they are assembled.
