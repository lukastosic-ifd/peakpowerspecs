# BRP-Agnostic Ingestion Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the BRP-agnostic half of metering-data ingestion — a webhook that stores arbitrary
bytes durably and answers 200 before anything is parsed, and an apply stage that turns a parsed
document into versions and readings atomically, with the current version always being the last one
*received*.

**Architecture:** Two projects and one seam. `PeakPower.Ingestion`
(`src/Infrastructure/PeakPower.Ingestion`) holds the pipeline: receipt, dedupe, the raw-payload
store, adapter resolution by the message's **stored** `brp_id`, the advisory lock, the atomic apply,
supersession and quarantine. `PeakPower.Worker` (`src/Hosts/PeakPower.Worker`) is the composition
root and the only host that maps `POST /webhooks/brp/{brpCode}`; it connects as the database owner
and exposes no `/api/v1/**` route at all. Everything BRP-specific reaches the pipeline through
`IBrpIngestionAdapter`, declared in `PeakPower.Application.Abstractions.Ingestion` so that
`PeakPower.Ingestion` and `PeakPower.Integration.Brp.Pvned` can both see it without seeing each
other — which is what architecture fact 3 enforces in IL.

**Tech Stack:** .NET SDK 10.0.400 · `net10.0`, `LangVersion latest`, `Nullable enable`,
`TreatWarningsAsErrors`, `AnalysisMode Recommended` · EF Core 10.0.11 · Npgsql 10.0.3 ·
Npgsql.EntityFrameworkCore.PostgreSQL 10.0.3 · EFCore.NamingConventions 10.0.1 · PostgreSQL 17 ·
ASP.NET Core Minimal APIs · .NET Aspire 13.5.3 · xUnit v3 3.2.2 (+ `xunit.runner.visualstudio`
3.1.5, `Microsoft.NET.Test.Sdk` 18.9.0) · Shouldly 4.3.0 · NSubstitute 6.2.0 ·
Testcontainers.PostgreSql 4.14.0 · `Microsoft.AspNetCore.Mvc.Testing` 10.0.11 · Dapper 2.1.66 ·
Mono.Cecil 0.11.6 · NetArchTest.Rules 1.3.2

**Spec:** docs/superpowers/specs/2026-09-07-poc-slice-2-design.md
**Shared contract:** docs/superpowers/plans/2026-09-07-slice-2-shared-contract.md

## Global Constraints

### What this plan owns, and what it must never write

Contract §17 is the ownership table and it is binding.

**This plan owns exclusively:**

- The port **declarations** `IBrpIngestionAdapter` (contract §7.1), `IRawPayloadStore` (§7.3) and
  `IIngestionJobQueue` / `IProcessInboundMessageHandler` (§7.4), plus
  `IBrpIngestionAdapterRegistry` (§7.2).
- The webhook route, per-BRP credential authentication, the 413 cap, the 24 h byte-identical
  dedupe and the correlation id — all of contract §9.
- The advisory lock and the atomic apply of contract §9.6.
- Supersession behind `ux_idv_current`.
- The four quarantine reasons of contract §8.5.

**This plan may only read** contract §5 (the entities), §6 (the DDL), §7 (the ports), §8.5 and §9.

**This plan NEVER writes migration SQL.** Not one `ALTER TABLE`, not one `CREATE INDEX`, not one
`migrationBuilder.Sql(...)`. Migration 9 is plan 2's, entire. If a column this plan needs is
missing, the fix is a note to plan 2, not a migration here — a second migration touching the same
tables is how two plans produce a schema neither of them can reason about.

**This plan declares no entity class.** `InboundMessage`, `IntervalDataVersion`, `IntervalReading`,
`MeteringPointDayState`, `QuarantinedSeries`, `DailyPosition`, `OperationalAlert` and
`MeteringPointBrpAssignment` are plan 2's, all eight. Two plans declaring the same class is a
duplicate-member compile error, not a merge.

**This plan declares no member of `IMarketCalendar`.** `ExpectedIntervalCount`, `IntervalStart`,
`IsDstDuplicate` and `AddWorkingDays` are plan 1's. This plan calls them.

**Nothing PVNed-specific belongs here.** No SOAP, no XML, no XSD, no `A01`/`A02`/`A23`, no GLN.
Plan 4 owns every one of those. `PeakPower.Ingestion` must never reference an assembly whose name
starts `PeakPower.Integration.Brp` — architecture fact 3, armed by plan 1, mutation-verified in
Task 17 of this plan.

### Versions — exact, verified 2026-09-07

Read from `peakpower-platform/global.json`, `Directory.Packages.props` and `Directory.Build.props`.

| | |
| --- | --- |
| .NET SDK | **10.0.400** (`global.json`, `rollForward: latestFeature`) |
| Target framework | **net10.0**, `LangVersion latest`, `Nullable enable`, `ImplicitUsings enable`, `TreatWarningsAsErrors true`, `EnableNETAnalyzers true`, `AnalysisMode Recommended` |
| EF Core | **10.0.11** |
| Npgsql / Npgsql.EntityFrameworkCore.PostgreSQL | **10.0.3** |
| `EFCore.NamingConventions` | **10.0.1** |
| PostgreSQL | **17** |
| xUnit v3 | **3.2.2** |
| Shouldly | **4.3.0** — ⚠ **never FluentAssertions** `[DEC-118]` |
| NSubstitute | **6.2.0** |
| `Testcontainers.PostgreSql` | **4.14.0** |
| `Microsoft.AspNetCore.Mvc.Testing` | **10.0.11** |
| Dapper | **2.1.66** |

**No package version is added or bumped by this plan.** Every package it needs is already in
`Directory.Packages.props`. If a `PackageReference` is added to a `.csproj` it carries no
`Version` attribute — central package management is on.

### Repositories

```
/Users/thinhhuynh/PeakPower/peakpower-platform      # .NET — everything in this plan
/Users/thinhhuynh/PeakPower/peakpower-web           # Angular — untouched by this plan
```

This plan touches **only** `peakpower-platform`.

### Naming

- .NET namespace root `PeakPower.` — this plan adds `PeakPower.Application.Abstractions.Ingestion`,
  `PeakPower.Ingestion.*` and `PeakPower.Worker`.
- Database: snake_case, singular, schema-qualified — `metering.interval_data_version`. EF Core maps
  to snake_case by convention (`UseSnakeCaseNamingConvention`), never per-property attributes.
- ⚠ `delivery_date` is the column name for a metering day, on every one of the seven new tables.

### Enums — the database spelling is normative, and it extends to JSON

Plan 2 declares all of these in `PeakPower.Domain.Metering`. This plan **uses** them and adds none.

```csharp
public enum InboundMessageStatus { Received, Processing, Processed, Failed, Duplicate }
// db/wire: RECEIVED | PROCESSING | PROCESSED | FAILED | DUPLICATE

public enum IntervalDataVersionSource { BrpFeed, Manual }
// db/wire: BRP_FEED | MANUAL

public enum IntervalDirection { Consumption, Production }
// db/wire: CONSUMPTION | PRODUCTION

public enum QuarantineReason { UnknownEan, EanValidity, WrongBrp, NotElectricity }
// db/wire: UNKNOWN_EAN | EAN_VALIDITY | WRONG_BRP | NOT_ELECTRICITY

public enum MeteringDayState { NoData, Partial, Provisional, Final }
// db/wire: NO_DATA | PARTIAL | PROVISIONAL | FINAL     — there is NO `Complete` member

public enum OperationalAlertKind
{
    ValidationFailure, MeteringPointSilent, ProductionExpectationPromoted,
    MissingProductionDeclaration, PostWindowReconciliation,
}
public enum OperationalAlertStatus { Open, Resolved }
```

⚠ **No slice-2 enum member may contain two adjacent capitals.** `EnumWireFormat`
(`JsonNamingPolicy.SnakeCaseUpper`, a capital run is one word) and `EnumToScreamingSnakeConverter`
(breaks before **every** capital) diverge the moment two capitals sit together, and a stored wire
spelling makes the read path **throw**. `BrpFeed` → `BRP_FEED` under both. `UnknownEan` →
`UNKNOWN_EAN` under both. This plan introduces two enums of its own —
`InboundMessageProcessingStatus` and `IngestionReceiptOutcome` — and both are checked against the
same rule: every member has only isolated capitals.

### The webhook contract — FROZEN (contract §9)

```
POST /webhooks/brp/{brpCode}
X-PeakPower-Brp-Credential: <shared secret>
```

Served by **`PeakPower.Worker`, and by nothing else**. `{brpCode}` is `metering.brp.code`,
uppercase; the PVNed route is therefore `POST /webhooks/brp/PVNED`.

| Status | When | Body |
| --- | --- | --- |
| **200** | The payload is durably stored, `inbound_message` is committed with `status = 'RECEIVED'` and the job is enqueued. **Before any parsing.** | empty |
| **200** | A byte-identical payload was received from the same BRP within **24 h**. The row is written with `status = 'DUPLICATE'` and nothing is enqueued | empty |
| **401** | Missing or wrong credential, **or** an unknown `{brpCode}`, **or** a BRP row with `is_active = false` | RFC 7807 |
| **413** | `Content-Length` or the streamed body is **strictly greater than 26 214 400 bytes** | RFC 7807 |
| **500** | Storage failure — the raw store or the database — **only** | RFC 7807 |

⚠ **Exactly 26 214 400 bytes is ACCEPTED; 26 214 401 is refused.**
⚠ **An unknown BRP code answers 401, not 404**, so the endpoint cannot enumerate which BRPs exist.
⚠ **200 before processing is structural, not an optimisation.** Assert it *at the moment the 200 is
written*, not afterwards.

### The correlation id (contract §9.5)

A `Guid` created with `Guid.CreateVersion7()`, stamped at receipt, written to
`inbound_message.correlation_id` (unique index `ux_msg_correlation`), copied onto every
`interval_data_version` the message produces, put on the `ILogger` scope for the whole request and
for the whole job, and returned in the `X-Correlation-Id` response header **on every status above,
including 401 and 413**.

### The apply transaction — one shape (contract §9.6)

1. Dequeue with the stored `inbound_message_id`; load the message; `BeginProcessing()`.
2. Resolve the adapter from the stored `brp_id`'s `adapter_key`.
3. `Parse` the payload read back from `IRawPayloadStore`.
4. Take a **transaction-scoped** Postgres advisory lock on
   `hashtextextended(metering_point_id::text || ':' || delivery_date::text, 0)` —
   `pg_advisory_xact_lock(bigint)` — once per (metering point, delivery date) in the document,
   **in a deterministic order** (metering point id, then date) so two documents cannot deadlock.
5. Resolve each series' metering point, decide quarantine, and apply **the whole document
   atomically**: every series lands or none does.
6. Supersede: set `is_current = false` on the previous current version for that
   (point, date, direction) **before** inserting the new one, so `ux_idv_current` holds. The new
   version's `received_at` is the **message's** receipt time, never `now()` at apply time.
7. Recompute derived data for every touched (point, date) — **in the same transaction**.
8. `MarkProcessed`.

### Receipt order, not `CreatedDateTime` — the one that is unrecoverable

Design §4.2: the current version of a (metering point, delivery date, direction) is **always the
last one received**, never the newest by `CreatedDateTime`. Both receipt orders of the same pair
therefore leave the **second-received** version current. Enforced by the `ux_idv_current` partial
unique index. Design §10.2 requires this be mutation-verified by swapping the comparison to
`CreatedDateTime` order and watching the out-of-order pair test fail. **Task 15, Step 6.**

### Quarantine reasons — pipeline-level (contract §8.5)

| `QuarantineReason` | Raised when |
| --- | --- |
| `UNKNOWN_EAN` | The 18-digit `ResourceObject` matches no `customer.metering_point` at all |
| `EAN_VALIDITY` | A metering point with that EAN exists but its validity does not cover the delivery date |
| `WRONG_BRP` | The metering point's BRP **in force at receipt time** is not the message's `brp_id` |
| `NOT_ELECTRICITY` | `commodity <> 'ELECTRICITY'` |

⚠ **Quarantine is a storage state with a replay path, not a parse outcome.** The message reaches
`PROCESSED`, the series lands in `quarantined_series`, and registering the metering point then
replaying the stored message resolves the entry into readings. **Replaying an already-processed
message produces no second version** `[F02-R27]`, asserted by version count.

### Rejection is total (contract §8.4)

`[F02-R13]`: a document lands whole or not at all. A failure marks the message `FAILED` with the
code and a human-readable message, writes **zero** `interval_reading` rows, raises a
`VALIDATION_FAILURE` alert, and **still returns 200** to the sender.

⚠ **Design §7.4: a document whose second timeseries is one point short applies NOTHING AT ALL —
asserted by row count, not by a status field.** A status column can be wrong; a row count cannot.

### Tenancy

The **Worker connects as the database owner and is exempt from RLS by design** — it writes across
tenants and serves no customer-facing route (design §4.3). It registers
`AddUnscopedCustomerContext()`, exactly as `PeakPower.Migrator` does
(`src/Hosts/PeakPower.Migrator/Program.cs:35`), so the global query filters collapse to `true`
rather than throwing through `ThrowingCustomerContext`.

`customer_id` on `interval_data_version`, `interval_reading`, `metering_point_day_state` and
`daily_position` is resolved **at apply time from the metering point's validity interval covering
the delivery date** — the reading belongs to whoever held the EAN on that day.

### Testing — this repository's stated standard

**Break it first, predict the failure, watch it go red, check the failure is the one you predicted,
then fix it. A green test that was never seen red is not evidence.**

- Syntax is `actual.ShouldBe(expected)` and `await Should.ThrowAsync<T>(act)`.
- ⚠ **Shouldly's `ShouldContain` is case-insensitive by default** and has silently broken three
  tests in this repository. Compare with `StringComparison.Ordinal` and assert on structured
  fields, never by searching a response body for a substring.
- ⚠ **Mutate the case your assertion is actually for, not the easy neighbouring one.**
- A mutation that breaks the *build* proves nothing about an assertion — if removing a member
  orphans a `using`, remove that too.
- Integration tests use Testcontainers. Running several suites in parallel across worktrees can
  exhaust connections and produce mass Postgres timeouts — retry before reporting a regression.
- ⚠ `cp -a` preserves mtimes and leaves MSBuild with stale binaries; use plain `cp` or `touch`.

**Where a test for this plan's code goes:**

| Kind | Project |
| --- | --- |
| Adapter registry, payload store, canonical mapping — no PostgreSQL, no HTTP | `tests/PeakPower.Application.Tests` |
| Anything touching PostgreSQL, HTTP, the webhook, the queue | `tests/PeakPower.Integration.Tests` |
| Architecture fact 3's mutation check | `tests/PeakPower.Architecture.Tests` |

**No new test project is created.** The solution has twenty-two projects after plan 1 and that
number is pinned by `tools/verify-solution-layout.sh`.

### Commands

```bash
# from /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln
dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~Ingestion"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Ingestion"
dotnet test tests/PeakPower.Architecture.Tests
tools/verify-solution-layout.sh
tools/verify-build-settings.sh
```

Docker must be running for every `PeakPower.Integration.Tests` run.

---

## What this plan assumes plans 1 and 2 have already landed

This plan is **step 4 and step 6** of design §5. It does not begin until both of these are true,
and each has a one-line check.

| Assumption | Check |
| --- | --- |
| `src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj` exists, references `PeakPower.Application`, `PeakPower.Domain` and `PeakPower.Persistence`, and is in `PeakPower.sln` | `dotnet build src/Infrastructure/PeakPower.Ingestion --nologo` exits 0 |
| `src/Hosts/PeakPower.Worker/PeakPower.Worker.csproj` exists, is an ASP.NET Core web project, and is in `PeakPower.sln` | `dotnet build src/Hosts/PeakPower.Worker --nologo` exits 0 |
| `tools/verify-solution-layout.sh` passes against **22** projects | `tools/verify-solution-layout.sh` prints OK |
| `IMarketCalendar` carries `ExpectedIntervalCount`, `IntervalStart`, `IsDstDuplicate`, `AddWorkingDays` | `grep -c 'IntervalStart' src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs` prints ≥ 1 |
| `IIngestionJobQueue` has an implementation registered by plan 1 (Hangfire or the `metering.ingestion_job` claim queue) | Task 17's wiring test |
| Migration 9 has landed: the seven tables, the `metering.brp` columns, `customer.metering_point_brp_assignment`, the partition routine and `ux_idv_current` | `tools/verify-migrator.sh` passes |
| Plan 2's eight entity classes and their `DbSet<>` properties exist on `PeakPowerDbContext` | `dotnet build src/Infrastructure/PeakPower.Persistence --nologo` exits 0 |

### The plan-2 members this plan calls by name

Contract §5 gives the properties of all eight entities and the factory methods of two. This plan
calls the following, and **plan 2 must supply exactly these signatures**. They are listed here in
one place so a mismatch is a five-minute fix rather than a rewrite.

Given verbatim by contract §5, and used unchanged:

```csharp
InboundMessage.Receive(Guid brpId, Guid correlationId, DateTimeOffset receivedAt,
    byte[] payloadHash, long payloadBytes, string payloadUri,
    string? httpHeaders, string? remoteIp);            // → Result<InboundMessage>
void InboundMessage.BeginProcessing();
void InboundMessage.MarkProcessed(DateTimeOffset at);
void InboundMessage.MarkFailed(string failureCode, string failureDetail, DateTimeOffset at);
void InboundMessage.MarkDuplicate(DateTimeOffset at);

IntervalDataVersion.FromBrpFeed(Guid meteringPointId, Guid customerId, DateOnly deliveryDate,
    IntervalDirection direction, string documentId, DateTimeOffset documentCreated,
    DateTimeOffset receivedAt, Guid inboundMessageId, Guid correlationId, short intervalCount);
void IntervalDataVersion.Supersede();
```

Not spelled out by contract §5, and named here (see **Open issues**, item 1):

```csharp
IntervalReading.Create(Guid versionId, DateOnly deliveryDate, Guid customerId,
    short pos, DateTimeOffset intervalStart, decimal quantityKwh);   // → Result<IntervalReading>

QuarantinedSeries.Quarantine(Guid inboundMessageId, Guid brpId, QuarantineReason reason,
    string resourceObject, DateOnly deliveryDate, IntervalDirection direction,
    short pointCount, DateTimeOffset receivedAt);                    // → Result<QuarantinedSeries>
void QuarantinedSeries.Resolve(DateTimeOffset at, string resolvedBy, Guid replayOfMessageId);

OperationalAlert.Raise(OperationalAlertKind kind, string summary, string? detail,
    DateTimeOffset raisedAt, Guid? meteringPointId = null, Guid? brpId = null,
    Guid? inboundMessageId = null, DateOnly? deliveryDate = null);   // → Result<OperationalAlert>
Result<OperationalAlert> OperationalAlert.Resolve(DateTimeOffset resolvedAt);
```

⚠ **The quarantine factory is `QuarantinedSeries.Quarantine`, not `Record`.** Plan 2 owns every
entity (contract §17) and declares it under that name with a character-for-character identical
parameter list; `Quarantine` also reads correctly beside `Resolve`, which `Record` does not. Every
call site in this plan uses it.

⚠ **`raisedAt` is the FOURTH parameter of `OperationalAlert.Raise`, before the four optional ids.**
Contract §5 spells it that way and `DbOperationalAlertRaiser` calls it positionally. Every parameter
after it is a nullable `Guid`/`DateOnly` with a default, so getting the order wrong is not a compile
error — it is an alert filed against the wrong BRP.

`DbSet<>` properties on `PeakPowerDbContext`, named here for the same reason:

```csharp
DbSet<InboundMessage>      InboundMessages
DbSet<IntervalDataVersion> IntervalDataVersions
DbSet<IntervalReading>     IntervalReadings
DbSet<QuarantinedSeries>   QuarantinedSeries
DbSet<OperationalAlert>    OperationalAlerts
DbSet<MeteringPointBrpAssignment> MeteringPointBrpAssignments
```

And these six new properties on `Brp` (contract §6.1): `EndpointUri`, `CredentialRef`,
`DocumentFormat`, `AdapterKey`, `ExpectedCadence`, `CreatedAt`.

---

## File Structure

### Created by this plan

| File | Responsibility |
| --- | --- |
| `src/Core/PeakPower.Application/Abstractions/Ingestion/IBrpIngestionAdapter.cs` | The `[DEC-69]` seam: `IBrpIngestionAdapter`, `BrpParseRequest`, `BrpParseOutcome`, `BrpParseStatus`, `BrpDocument`, `BrpDocumentKind`, `CanonicalSeries`, `CanonicalPoint` |
| `src/Core/PeakPower.Application/Abstractions/Ingestion/IBrpIngestionAdapterRegistry.cs` | Resolution by `adapter_key`, and `AdapterNotRegisteredException` |
| `src/Core/PeakPower.Application/Abstractions/Ingestion/IRawPayloadStore.cs` | Durable raw-payload port |
| `src/Core/PeakPower.Application/Abstractions/Ingestion/IIngestionJobQueue.cs` | `IIngestionJobQueue` and `IProcessInboundMessageHandler` |
| `src/Core/PeakPower.Application/Abstractions/Ingestion/IDayStateRecomputer.cs` | Contract §7.6: `IDayStateRecomputer`, `DayRecomputeRequest`, `DayRecomputeResult`, `MeteringPointDay` |
| `src/Core/PeakPower.Application/Abstractions/Ingestion/IOperationalAlertRaiser.cs` | Contract §7.6: `IOperationalAlertRaiser` and `OperationalAlertRequest` — one write path for `operational_alert` |
| `src/Infrastructure/PeakPower.Ingestion/Adapters/BrpIngestionAdapterRegistry.cs` | Keyed lookup over the registered adapters |
| `src/Infrastructure/PeakPower.Ingestion/Adapters/RejectingBrpIngestionAdapter.cs` | The null adapter: parses nothing, rejects everything, carries a configurable key |
| `src/Infrastructure/PeakPower.Ingestion/Storage/RawPayloadStoreOptions.cs` | `RAW_PAYLOAD_ROOT`, default `/var/lib/peakpower/raw-payloads` |
| `src/Infrastructure/PeakPower.Ingestion/Storage/FilesystemRawPayloadStore.cs` | `{brpId}/{yyyy}/{MM}/{dd}/{correlationId}.bin`, returns `file://{relative}` |
| `src/Infrastructure/PeakPower.Ingestion/Webhook/IBrpWebhookAuthenticator.cs` | The authentication port and its result type |
| `src/Infrastructure/PeakPower.Ingestion/Webhook/BrpWebhookAuthenticator.cs` | Code → BRP row → credential comparison, fail-closed |
| `src/Infrastructure/PeakPower.Ingestion/Webhook/IBrpCredentialSource.cs` | Reads the environment variable named by `credential_ref` |
| `src/Infrastructure/PeakPower.Ingestion/Webhook/EnvironmentBrpCredentialSource.cs` | `Environment.GetEnvironmentVariable(name)` and nothing else |
| `src/Infrastructure/PeakPower.Ingestion/Receipt/IInboundMessageReceiver.cs` | `InboundMessageArrival`, `IngestionReceipt`, `IngestionReceiptOutcome` |
| `src/Infrastructure/PeakPower.Ingestion/Receipt/InboundMessageReceiver.cs` | Hash, lock, store, dedupe, insert `RECEIVED`, enqueue |
| `src/Infrastructure/PeakPower.Ingestion/Processing/IInboundMessageProcessor.cs` | `InboundMessageProcessingOutcome`, `InboundMessageProcessingStatus` |
| `src/Infrastructure/PeakPower.Ingestion/Processing/ProcessInboundMessageHandler.cs` | The whole apply transaction of contract §9.6 |
| `src/Infrastructure/PeakPower.Ingestion/Processing/DocumentPreconditions.cs` | The pipeline's own guard: point count, contiguous `Pos`, non-negative `Qty` |
| `src/Infrastructure/PeakPower.Ingestion/Processing/SeriesResolution.cs` | EAN → metering point, customer and the four quarantine reasons |
| `src/Infrastructure/PeakPower.Ingestion/Processing/AdvisoryLock.cs` | `pg_advisory_xact_lock` over `hashtextextended` |
| `src/Infrastructure/PeakPower.Ingestion/Processing/NoOpDayStateRecomputer.cs` | The day-state stand-in plan 5 replaces, registered with `TryAdd` |
| `src/Infrastructure/PeakPower.Ingestion/Processing/DbOperationalAlertRaiser.cs` | The alert stand-in plan 5 replaces, also `TryAdd`; writes through the DbContext |
| `src/Infrastructure/PeakPower.Ingestion/IngestionServiceCollectionExtensions.cs` | `AddPeakPowerIngestion` — the one composition-root entry point |
| `src/Hosts/PeakPower.Worker/WorkerEntryPoint.cs` | `WebApplicationFactory<WorkerEntryPoint>` marker |
| `src/Hosts/PeakPower.Worker/Webhooks/BrpWebhookEndpoints.cs` | `POST /webhooks/brp/{brpCode}` and nothing else |
| `src/Hosts/PeakPower.Worker/Webhooks/WebhookProblems.cs` | The three RFC 7807 bodies, as constants |
| `tests/PeakPower.Application.Tests/Ingestion/BrpIngestionAdapterRegistryTests.cs` | Resolution, the throw, the second-adapter case |
| `tests/PeakPower.Application.Tests/Ingestion/FilesystemRawPayloadStoreTests.cs` | Layout, round trip, the `file://` scheme |
| `tests/PeakPower.Application.Tests/Ingestion/IngestionPortShapeTests.cs` | The frozen signatures of contract §7 |
| `tests/PeakPower.Application.Tests/Ingestion/DocumentPreconditionsTests.cs` | Point count, `Pos` contiguity, negative quantity |
| `tests/PeakPower.Integration.Tests/Ingestion/WorkerFactory.cs` | Boots the real Worker against a throwaway PostgreSQL 17 |
| `tests/PeakPower.Integration.Tests/Ingestion/FakeBrpIngestionAdapter.cs` | A BRP-agnostic stub adapter over a tiny line-based test format |
| `tests/PeakPower.Integration.Tests/Ingestion/TestDocument.cs` | Builds that format, so a test reads as a document |
| `tests/PeakPower.Integration.Tests/Ingestion/RecordingIngestionJobQueue.cs` | Captures enqueues instead of running them |
| `tests/PeakPower.Integration.Tests/Ingestion/IngestionSeed.cs` | Seeds a customer, a BRP and metering points for these tests |
| `tests/PeakPower.Integration.Tests/Ingestion/WebhookReceiptTests.cs` | 200-before-processing, the correlation id, `RECEIVED` at the moment of the 200 |
| `tests/PeakPower.Integration.Tests/Ingestion/WebhookCredentialTests.cs` | The whole 401 matrix |
| `tests/PeakPower.Integration.Tests/Ingestion/WebhookSizeLimitTests.cs` | 26 214 400 accepted, 26 214 401 refused |
| `tests/PeakPower.Integration.Tests/Ingestion/WebhookDedupeTests.cs` | 24 h byte-identical dedupe, and the concurrent-arrival race |
| `tests/PeakPower.Integration.Tests/Ingestion/WorkerRouteTableTests.cs` | The Worker exposes no `/api/v1/**` route |
| `tests/PeakPower.Integration.Tests/Ingestion/AdapterResolutionTests.cs` | S2-D3, with a second adapter registered and the BRP deactivated |
| `tests/PeakPower.Integration.Tests/Ingestion/ApplyAtomicityTests.cs` | The short second series, asserted by row count |
| `tests/PeakPower.Integration.Tests/Ingestion/QuarantineTests.cs` | The four reasons, and the labelled `ResourceObject` |
| `tests/PeakPower.Integration.Tests/Ingestion/SupersessionTests.cs` | Receipt order, both orders of the same pair, `ux_idv_current` |
| `tests/PeakPower.Integration.Tests/Ingestion/ReplayIdempotenceTests.cs` | `[F02-R27]`, asserted by version count |
| `tests/PeakPower.Integration.Tests/Ingestion/AdvisoryLockTests.cs` | Serialisation on (point, date), and the deterministic order |
| `tests/PeakPower.Integration.Tests/Ingestion/IngestionWiringTests.cs` | Every port resolves from the Worker's own container |

### Modified by this plan

| File | Change |
| --- | --- |
| `src/Hosts/PeakPower.Worker/Program.cs` | Replaced: the real composition root and the webhook mapping |
| `src/Hosts/PeakPower.Worker/PeakPower.Worker.csproj` | Nothing, if plan 1 wrote the references contract §3.1 names. Verified in Task 6 |
| `tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj` | Two `<ProjectReference>`s: `PeakPower.Ingestion`, `PeakPower.Worker` |
| `tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj` | One `<ProjectReference>`: `PeakPower.Ingestion` |

### Deliberately NOT touched by this plan

`src/Infrastructure/PeakPower.Persistence/Migrations/**` · any entity class · `IMarketCalendar` ·
`src/Hosts/PeakPower.AppHost/**` · `deploy/**` · `tools/verify-*.sh` · anything in `peakpower-web`.

---

### Task 1: The ingestion ports

The whole `[DEC-69]` seam, declared in `PeakPower.Application.Abstractions.Ingestion` so that
`PeakPower.Ingestion` and `PeakPower.Integration.Brp.Pvned` can both see it without seeing each
other. That is not stylistic: architecture fact 3
(`tests/PeakPower.Architecture.Tests/CallSiteFacts.cs`) forbids `PeakPower.Ingestion` from
referencing any `PeakPower.Integration.Brp.*` assembly in IL, so the only place a shared type can
live is a project both of them already reference.

Every type below is **frozen by contract §7.1–§7.4**. Copy the signatures exactly. Plan 4 is being
written against this text by someone who cannot see this file's code, and a renamed property is a
compile error on the day the two are assembled.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/Ingestion/IBrpIngestionAdapter.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/Ingestion/IBrpIngestionAdapterRegistry.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/Ingestion/IRawPayloadStore.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/Ingestion/IIngestionJobQueue.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/IngestionPortShapeTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Domain.Common.EanCode` (`src/Core/PeakPower.Domain/Common/EanCode.cs:10`);
  `PeakPower.Domain.Metering.IntervalDirection` (plan 2).
- Produces: `IBrpIngestionAdapter` · `BrpParseRequest` · `BrpParseOutcome` · `BrpParseStatus` ·
  `BrpDocument` · `BrpDocumentKind` · `CanonicalSeries` · `CanonicalPoint` ·
  `IBrpIngestionAdapterRegistry` · `AdapterNotRegisteredException` · `IRawPayloadStore` ·
  `IIngestionJobQueue` · `IProcessInboundMessageHandler`, all in namespace
  `PeakPower.Application.Abstractions.Ingestion`.

- [ ] **Step 1: Write the failing test**

A port-shape test is not decoration here. Four plans are written against these signatures in
parallel, and the failure mode this catches — a property renamed, a nullability annotation
dropped, an enum member re-ordered — is invisible until assembly day. It follows the shape of the
existing `tests/PeakPower.Application.Tests/Abstractions/PortShapeTests.cs`.

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/IngestionPortShapeTests.cs`:

```csharp
using System.Reflection;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Common;
using PeakPower.Domain.Metering;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion;

/// <summary>
/// The signatures of shared contract §7.1-§7.4, pinned. Plans 3, 4, 5, 6 and 8 are written
/// against this text by people who cannot see each other's code; a renamed member here is a
/// compile error on the day they are assembled, and this test is what turns that into a named
/// failure with the contract section printed beside it.
/// </summary>
public sealed class IngestionPortShapeTests
{
    private static readonly Assembly Abstractions = typeof(IBrpIngestionAdapter).Assembly;

    private static Type Port(string name) =>
        Abstractions.GetType($"PeakPower.Application.Abstractions.Ingestion.{name}", throwOnError: true)!;

    [Fact]
    public void IBrpIngestionAdapter_carries_an_AdapterKey_and_one_Parse_method()
    {
        var adapter = typeof(IBrpIngestionAdapter);

        adapter.GetProperty("AdapterKey")!.PropertyType.ShouldBe(typeof(string));

        var parse = adapter.GetMethod("Parse")!;
        parse.ReturnType.ShouldBe(typeof(BrpParseOutcome));
        parse.GetParameters().Length.ShouldBe(1);
        parse.GetParameters()[0].ParameterType.ShouldBe(typeof(BrpParseRequest));
    }

    [Fact]
    public void BrpParseRequest_carries_the_six_fields_the_contract_names()
    {
        var request = typeof(BrpParseRequest);

        request.GetProperty("InboundMessageId")!.PropertyType.ShouldBe(typeof(Guid));
        request.GetProperty("BrpId")!.PropertyType.ShouldBe(typeof(Guid));
        request.GetProperty("BrpCode")!.PropertyType.ShouldBe(typeof(string));
        request.GetProperty("CorrelationId")!.PropertyType.ShouldBe(typeof(Guid));
        request.GetProperty("Payload")!.PropertyType.ShouldBe(typeof(ReadOnlyMemory<byte>));
        request.GetProperty("ReceivedAt")!.PropertyType.ShouldBe(typeof(DateTimeOffset));
    }

    [Fact]
    public void BrpParseStatus_has_exactly_three_members_in_the_contract_order()
    {
        Enum.GetNames<BrpParseStatus>().ShouldBe(["Accepted", "Rejected", "RecognisedAndClosed"]);
    }

    [Fact]
    public void BrpParseOutcome_exposes_the_three_named_factories()
    {
        var outcome = typeof(BrpParseOutcome);

        outcome.GetMethod("Accepted", BindingFlags.Public | BindingFlags.Static)!
            .GetParameters()[0].ParameterType.ShouldBe(typeof(BrpDocument));
        outcome.GetMethod("Rejected", BindingFlags.Public | BindingFlags.Static)!
            .GetParameters().Length.ShouldBe(2);
        outcome.GetMethod("RecognisedAndClosed", BindingFlags.Public | BindingFlags.Static)!
            .GetParameters()[0].ParameterType.ShouldBe(typeof(BrpDocument));
    }

    [Fact]
    public void CanonicalSeries_carries_ResourceObject_verbatim_beside_the_parsed_Ean()
    {
        var series = typeof(CanonicalSeries);

        // [F02-R11]/[AS-17]: eighteen digits is an EAN, anything else is a descriptive label and
        // is never offered to the EAN resolver. The pipeline needs the raw string to put on the
        // quarantine row, so the adapter must not throw it away.
        series.GetProperty("ResourceObject")!.PropertyType.ShouldBe(typeof(string));
        series.GetProperty("ResourceObjectIsEan")!.PropertyType.ShouldBe(typeof(bool));
        series.GetProperty("Ean")!.PropertyType.ShouldBe(typeof(EanCode?));
        series.GetProperty("DeliveryDate")!.PropertyType.ShouldBe(typeof(DateOnly));
        series.GetProperty("Direction")!.PropertyType.ShouldBe(typeof(IntervalDirection));
        series.GetProperty("ExpectedIntervalCount")!.PropertyType.ShouldBe(typeof(int));
        series.GetProperty("Points")!.PropertyType
            .ShouldBe(typeof(IReadOnlyList<CanonicalPoint>));
    }

    [Fact]
    public void CanonicalPoint_is_a_position_and_a_quantity_in_kWh()
    {
        typeof(CanonicalPoint).GetProperty("Pos")!.PropertyType.ShouldBe(typeof(int));
        typeof(CanonicalPoint).GetProperty("QuantityKwh")!.PropertyType.ShouldBe(typeof(decimal));
    }

    [Fact]
    public void IRawPayloadStore_stores_and_reads_back_an_opaque_handle()
    {
        var store = typeof(IRawPayloadStore);

        var storeAsync = store.GetMethod("StoreAsync")!;
        storeAsync.ReturnType.ShouldBe(typeof(Task<string>));
        storeAsync.GetParameters().Select(p => p.ParameterType).ShouldBe(
        [
            typeof(Guid), typeof(Guid), typeof(ReadOnlyMemory<byte>), typeof(CancellationToken),
        ]);

        var readAsync = store.GetMethod("ReadAsync")!;
        readAsync.ReturnType.ShouldBe(typeof(Task<ReadOnlyMemory<byte>>));
    }

    [Fact]
    public void IIngestionJobQueue_takes_a_message_id_and_a_correlation_id()
    {
        var enqueue = typeof(IIngestionJobQueue).GetMethod("EnqueueProcessMessageAsync")!;

        enqueue.ReturnType.ShouldBe(typeof(Task));
        enqueue.GetParameters().Select(p => p.ParameterType).ShouldBe(
            [typeof(Guid), typeof(Guid), typeof(CancellationToken)]);
    }

    [Fact]
    public void IProcessInboundMessageHandler_is_what_the_queue_eventually_calls()
    {
        var handle = typeof(IProcessInboundMessageHandler).GetMethod("HandleAsync")!;

        handle.ReturnType.ShouldBe(typeof(Task));
        handle.GetParameters().Select(p => p.ParameterType).ShouldBe(
            [typeof(Guid), typeof(Guid), typeof(CancellationToken)]);
    }

    [Fact]
    public void every_ingestion_port_lives_in_the_one_namespace_both_sides_can_see()
    {
        // Architecture fact 3 forbids PeakPower.Ingestion from referencing any
        // PeakPower.Integration.Brp.* assembly, so the ONLY place a type both of them use can
        // live is an assembly both already reference. This asserts nobody quietly moved one.
        foreach (var name in new[]
                 {
                     "IBrpIngestionAdapter", "BrpParseRequest", "BrpParseOutcome", "BrpParseStatus",
                     "BrpDocument", "BrpDocumentKind", "CanonicalSeries", "CanonicalPoint",
                     "IBrpIngestionAdapterRegistry", "AdapterNotRegisteredException",
                     "IRawPayloadStore", "IIngestionJobQueue", "IProcessInboundMessageHandler",
                 })
        {
            Port(name).Assembly.GetName().Name.ShouldBe("PeakPower.Application");
        }
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~IngestionPortShapeTests"
```

Expected: FAIL — the build breaks before any test runs, with
`error CS0246: The type or namespace name 'PeakPower.Application.Abstractions.Ingestion' could not be found`
on the `using` line.

- [ ] **Step 3: Declare the adapter seam**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/Ingestion/IBrpIngestionAdapter.cs`:

```csharp
using PeakPower.Domain.Common;
using PeakPower.Domain.Metering;

namespace PeakPower.Application.Abstractions.Ingestion;

/// <summary>
/// One adapter per BRP. Receives bytes; returns a canonical series set or a typed rejection.
/// </summary>
/// <remarks>
/// <para>
/// It never touches the database, never resolves an EAN, and never decides quarantine.
/// <c>UNKNOWN_EAN</c>, <c>EAN_VALIDITY</c>, <c>WRONG_BRP</c> and <c>NOT_ELECTRICITY</c> are
/// pipeline decisions (shared contract §8.5) that need <c>customer.metering_point</c>, which no
/// adapter may read. An adapter that queried it would have reimplemented a pipeline stage, which
/// <c>[F02-R40]</c> forbids in so many words.
/// </para>
/// <para>
/// Declared here rather than in PeakPower.Ingestion because architecture fact 3 forbids
/// PeakPower.Ingestion from referencing any PeakPower.Integration.Brp.* assembly. Both sides
/// reference PeakPower.Application, so this is the one place a shared type can live.
/// </para>
/// </remarks>
public interface IBrpIngestionAdapter
{
    /// <summary>
    /// Matches <c>metering.brp.adapter_key</c> exactly. <c>"PVNED_TIMESERIES_XML_V2P0"</c> for the
    /// only one that exists in slice 2.
    /// </summary>
    string AdapterKey { get; }

    /// <summary>
    /// Parses one stored payload. Synchronous on purpose: an adapter reads bytes it was handed and
    /// talks to nothing, so there is nothing to await, and an async signature would invite one.
    /// </summary>
    BrpParseOutcome Parse(BrpParseRequest request);
}

/// <summary>Everything the adapter is allowed to know about the message it is parsing.</summary>
public sealed record BrpParseRequest(
    Guid InboundMessageId,
    Guid BrpId,
    string BrpCode,
    Guid CorrelationId,
    ReadOnlyMemory<byte> Payload,
    DateTimeOffset ReceivedAt);

/// <summary>
/// <list type="bullet">
/// <item><c>Accepted</c> — apply the series.</item>
/// <item><c>Rejected</c> — message FAILED with FailureCode, zero readings written. [F02-R12]</item>
/// <item><c>RecognisedAndClosed</c> — message PROCESSED with zero readings written. The A12 case:
/// [DEC-25] puts imbalance out of scope, so the document is recognised, stored and closed rather
/// than failed.</item>
/// </list>
/// </summary>
public sealed record BrpParseOutcome(
    BrpParseStatus Status,
    BrpDocument? Document,
    string? FailureCode,
    string? FailureDetail)
{
    public static BrpParseOutcome Accepted(BrpDocument document) =>
        new(BrpParseStatus.Accepted, document, null, null);

    public static BrpParseOutcome Rejected(string failureCode, string failureDetail)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(failureCode);
        ArgumentException.ThrowIfNullOrWhiteSpace(failureDetail);

        // A rejection with no code is a message an employee cannot triage and a screen that has
        // nothing to filter on, so it is refused at construction rather than stored as null and
        // discovered on the data-health screen.
        return new BrpParseOutcome(BrpParseStatus.Rejected, null, failureCode, failureDetail);
    }

    public static BrpParseOutcome RecognisedAndClosed(BrpDocument document) =>
        new(BrpParseStatus.RecognisedAndClosed, document, null, null);
}

public enum BrpParseStatus
{
    Accepted,
    Rejected,
    RecognisedAndClosed,
}

/// <summary>One parsed document: its identity, its kind, and the series it carries.</summary>
public sealed record BrpDocument(
    string DocumentId,
    DateTimeOffset DocumentCreated,
    BrpDocumentKind Kind,
    IReadOnlyList<CanonicalSeries> Series);

public enum BrpDocumentKind
{
    Allocation,
    Imbalance,
}

/// <summary>
/// The canonical series. This is the entire hand-off: (metering point identity, delivery date,
/// direction, position, quantity) plus the document identity above.
/// </summary>
/// <param name="ResourceObject">
/// Verbatim from the document, whatever shape it had. [F02-R11]/[AS-17]: eighteen digits is an
/// EAN, <b>anything else is a descriptive resource label</b> (<c>Prognosis</c>,
/// <c>Realisation</c>, <c>Imbalance</c>, …) and is <b>never</b> offered to the EAN resolver —
/// otherwise a labelled document quarantines as a false <c>UNKNOWN_EAN</c>. The pipeline needs the
/// raw string to put on the quarantine row.
/// </param>
/// <param name="ExpectedIntervalCount">
/// 92, 96 or 100, taken from <c>IMarketCalendar.ExpectedIntervalCount</c> for
/// <paramref name="DeliveryDate"/>. The adapter reads it from the one calendar so parser, rollup
/// and chart cannot disagree.
/// </param>
public sealed record CanonicalSeries(
    string ResourceObject,
    bool ResourceObjectIsEan,
    EanCode? Ean,
    DateOnly DeliveryDate,
    IntervalDirection Direction,
    int ExpectedIntervalCount,
    IReadOnlyList<CanonicalPoint> Points);

/// <param name="Pos">1-based, 1..100.</param>
/// <param name="QuantityKwh">
/// Always non-negative. Consumption and production remain two separate, non-negative series
/// [AS-05]; net usage is derived per interval and never stored as a signed source series.
/// </param>
public sealed record CanonicalPoint(int Pos, decimal QuantityKwh);
```

- [ ] **Step 4: Declare the registry and its exception**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/Ingestion/IBrpIngestionAdapterRegistry.cs`:

```csharp
namespace PeakPower.Application.Abstractions.Ingestion;

/// <summary>
/// Resolves an adapter by <c>metering.brp.adapter_key</c>.
/// </summary>
/// <remarks>
/// <b>S2-D3.</b> The adapter is selected by the <c>adapter_key</c> of the BRP row identified by the
/// message's <b>stored</b> <c>brp_id</c>, at dequeue time. Never by a field in the payload, never
/// by the route, never by a default. [F02-R41]: a replay [F02-R27] is parsed by the same adapter
/// that first parsed it — <b>including after that BRP has been deactivated</b>.
/// </remarks>
public interface IBrpIngestionAdapterRegistry
{
    /// <summary>
    /// The adapter carrying <paramref name="adapterKey"/>.
    /// </summary>
    /// <exception cref="AdapterNotRegisteredException">
    /// No registered adapter carries that key. Deliberately a throw rather than a null: an
    /// unresolvable adapter is a deployment fault, and a null would be applied as "no series" —
    /// a message silently reaching PROCESSED with zero readings and nothing saying why.
    /// </exception>
    IBrpIngestionAdapter Resolve(string adapterKey);
}

/// <summary>Raised when no registered adapter carries the key a BRP row names.</summary>
public sealed class AdapterNotRegisteredException : InvalidOperationException
{
    public AdapterNotRegisteredException(string adapterKey)
        : base($"No BRP ingestion adapter is registered for adapter key '{adapterKey}'.")
        => AdapterKey = adapterKey;

    public AdapterNotRegisteredException()
        : base("No BRP ingestion adapter is registered for that adapter key.")
        => AdapterKey = string.Empty;

    public AdapterNotRegisteredException(string message, Exception innerException)
        : base(message, innerException)
        => AdapterKey = string.Empty;

    public string AdapterKey { get; }
}
```

⚠ The three constructors are not padding: `CA1032` (`Implement standard exception constructors`) is
on under `AnalysisMode Recommended`, and `TreatWarningsAsErrors` turns it into a build failure. The
one-argument overload is the one this codebase uses.

- [ ] **Step 5: Declare the raw-payload store**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/Ingestion/IRawPayloadStore.cs`:

```csharp
namespace PeakPower.Application.Abstractions.Ingestion;

/// <summary>
/// Where the bytes go before anything looks at them. [DEC-03], [F02-R03].
/// </summary>
/// <remarks>
/// Slice 2 ships one implementation, a filesystem adapter on a named Docker volume. Real object
/// storage is out of scope (design §3.2); the swap is one adapter, which is why the port exists
/// now rather than when MinIO or S3 arrives.
/// </remarks>
public interface IRawPayloadStore
{
    /// <summary>
    /// Stores the payload and returns the opaque <c>payload_uri</c> written to
    /// <c>inbound_message</c>. Must be durable <b>before</b> the webhook writes its 200 —
    /// [F02-R03], [DEC-03].
    /// </summary>
    Task<string> StoreAsync(
        Guid brpId, Guid correlationId, ReadOnlyMemory<byte> payload, CancellationToken ct);

    /// <summary>Reads a payload back, by the handle <see cref="StoreAsync"/> returned.</summary>
    Task<ReadOnlyMemory<byte>> ReadAsync(string payloadUri, CancellationToken ct);
}
```

- [ ] **Step 6: Declare the queue seam**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/Ingestion/IIngestionJobQueue.cs`:

```csharp
namespace PeakPower.Application.Abstractions.Ingestion;

/// <summary>
/// The seam the Hangfire spike hides behind.
/// </summary>
/// <remarks>
/// Whether a Hangfire background server or a hosted <c>BackgroundService</c> draining
/// <c>metering.ingestion_job</c> sits behind this is plan 1's decision and nobody else's.
/// Plans 3, 4, 5, 6 and 8 name only these two types.
/// </remarks>
public interface IIngestionJobQueue
{
    /// <summary>
    /// Enqueue the processing of a stored message. Called AFTER the payload is durable and AFTER
    /// <c>inbound_message</c> is committed with status <c>RECEIVED</c>, and BEFORE the 200 is
    /// written.
    /// </summary>
    Task EnqueueProcessMessageAsync(Guid inboundMessageId, Guid correlationId, CancellationToken ct);
}

/// <summary>What the queue eventually calls. One implementation, in PeakPower.Ingestion.</summary>
public interface IProcessInboundMessageHandler
{
    Task HandleAsync(Guid inboundMessageId, Guid correlationId, CancellationToken ct);
}
```

- [ ] **Step 7: Reference PeakPower.Ingestion from the Application test project**

The port-shape test only needs `PeakPower.Application`, which
`tests/PeakPower.Application.Tests` already references. The later tasks in this plan need
`PeakPower.Ingestion`, so add it now rather than twice.

Read the current file first:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
cat tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj
```

Then add this line inside the existing `<ItemGroup>` that holds the other `<ProjectReference>`
elements, keeping the relative-path style the file already uses:

```xml
    <!-- Slice 2 plan 3: the adapter registry, the filesystem payload store and the document
         precondition guard are pure logic with no database, so their tests live here. -->
    <ProjectReference Include="../../src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj" />
```

- [ ] **Step 8: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~IngestionPortShapeTests"
```

Expected: PASS — 10 tests, 0 failed.

- [ ] **Step 9: Verify by mutation — the shape test actually pins the shape**

**What to break:** in `IBrpIngestionAdapter.cs`, rename `CanonicalSeries.ResourceObjectIsEan` to
`IsEan`.

**What to predict:** `CanonicalSeries_carries_ResourceObject_verbatim_beside_the_parsed_Ean` fails
with a `NullReferenceException` on `series.GetProperty("ResourceObjectIsEan")!`.

**What to watch go red:** exactly that one test; the other nine stay green.

⚠ This is the easy mutation. Do the second one, which is the case the test is actually for:

**What to break:** change `CanonicalSeries.Ean` from `EanCode?` to `EanCode`.

**What to predict:** the same test fails with
`Shouldly.ShouldAssertException: series.GetProperty("Ean")!.PropertyType should be EanCode? but was EanCode`.

**What to watch go red:** that assertion, by nullability alone — which is the failure a plan-4
author would otherwise hit as a `CS8629` three weeks later.

Restore both.

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Application/Abstractions/Ingestion \
        tests/PeakPower.Application.Tests/Ingestion/IngestionPortShapeTests.cs \
        tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj
git commit -m "feat(ingestion): declare the BRP ingestion ports

The [DEC-69] seam, in PeakPower.Application.Abstractions.Ingestion so that PeakPower.Ingestion and
PeakPower.Integration.Brp.Pvned can both see it without seeing each other - architecture fact 3
forbids the reference that would otherwise be the obvious place for these types.

Shapes are shared contract §7.1-§7.4 verbatim. IngestionPortShapeTests pins them by reflection,
mutation-verified against both a renamed property and a dropped nullability annotation, because
four plans are written against this text in parallel and neither failure is visible until the day
they are assembled.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The adapter registry, and the null adapter that rejects everything

Design step 4 says: build the receipt half **with a null adapter that always rejects**, so that
`[F02-R03]`…`[F02-R07]` pass with arbitrary bytes before a line of XML is parsed. This task builds
both halves of that: the registry that selects an adapter by key, and a `RejectingBrpIngestionAdapter`
that carries a key and refuses every payload.

⚠ **The registry is a `Dictionary` lookup, not a `FirstOrDefault`.** With exactly one adapter
registered, `adapters.First()` passes every test in the slice and is wrong: it makes the adapter
key decorative and quietly resolves the PVNed adapter for a BRP row that names something else.
Design §7.7 requires the selection be asserted **with a second adapter registered**, and Task 11
does that end to end. Here the same property is asserted at unit level.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Adapters/BrpIngestionAdapterRegistry.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Adapters/RejectingBrpIngestionAdapter.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/BrpIngestionAdapterRegistryTests.cs`

**Interfaces:**
- Consumes: `IBrpIngestionAdapter`, `IBrpIngestionAdapterRegistry`, `AdapterNotRegisteredException`,
  `BrpParseOutcome`, `BrpParseRequest` (Task 1).
- Produces: `BrpIngestionAdapterRegistry(IEnumerable<IBrpIngestionAdapter> adapters)` ·
  `RejectingBrpIngestionAdapter(string adapterKey)` ·
  `RejectingBrpIngestionAdapter.FailureCode` (the constant `ADAPTER_NOT_IMPLEMENTED`).

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/BrpIngestionAdapterRegistryTests.cs`:

```csharp
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Ingestion.Adapters;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion;

public sealed class BrpIngestionAdapterRegistryTests
{
    private static BrpParseRequest AnyRequest() => new(
        InboundMessageId: Guid.CreateVersion7(),
        BrpId: Guid.CreateVersion7(),
        BrpCode: "PVNED",
        CorrelationId: Guid.CreateVersion7(),
        Payload: new byte[] { 1, 2, 3 },
        ReceivedAt: DateTimeOffset.Parse("2026-08-12T04:02:11Z", null));

    [Fact]
    public void resolves_the_adapter_whose_key_matches()
    {
        var pvned = new RejectingBrpIngestionAdapter("PVNED_TIMESERIES_XML_V2P0");
        var other = new RejectingBrpIngestionAdapter("OTHER_BRP_JSON_V1");
        var registry = new BrpIngestionAdapterRegistry([pvned, other]);

        registry.Resolve("OTHER_BRP_JSON_V1").ShouldBeSameAs(other);
    }

    [Fact]
    public void does_not_resolve_the_only_adapter_there_is_when_the_key_is_a_different_one()
    {
        // S2-D3, at unit level. A FirstOrDefault() implementation passes every other test in this
        // slice and is wrong: it makes adapter_key decorative and hands a message from one BRP to
        // another BRP's parser.
        var registry = new BrpIngestionAdapterRegistry(
            [new RejectingBrpIngestionAdapter("PVNED_TIMESERIES_XML_V2P0")]);

        var thrown = Should.Throw<AdapterNotRegisteredException>(
            () => registry.Resolve("OTHER_BRP_JSON_V1"));

        thrown.AdapterKey.ShouldBe("OTHER_BRP_JSON_V1");
    }

    [Fact]
    public void refuses_two_adapters_carrying_the_same_key_at_construction()
    {
        // Two adapters on one key is a deployment fault with no correct answer. Refusing it at
        // construction makes it a boot failure rather than a coin toss decided by registration
        // order, on a path whose whole point is that the selection is deterministic.
        var thrown = Should.Throw<InvalidOperationException>(() => new BrpIngestionAdapterRegistry(
        [
            new RejectingBrpIngestionAdapter("PVNED_TIMESERIES_XML_V2P0"),
            new RejectingBrpIngestionAdapter("PVNED_TIMESERIES_XML_V2P0"),
        ]));

        thrown.Message.ShouldContain("PVNED_TIMESERIES_XML_V2P0", Case.Sensitive);
    }

    [Fact]
    public void matches_the_key_ordinally_and_case_sensitively()
    {
        // metering.brp.adapter_key is compared against this string. A case-insensitive lookup
        // would let a row spelled 'pvned_timeseries_xml_v2p0' resolve, and the column has no
        // constraint forcing a casing - so the strictness has to live here.
        var registry = new BrpIngestionAdapterRegistry(
            [new RejectingBrpIngestionAdapter("PVNED_TIMESERIES_XML_V2P0")]);

        Should.Throw<AdapterNotRegisteredException>(
            () => registry.Resolve("pvned_timeseries_xml_v2p0"));
    }

    [Fact]
    public void the_null_adapter_rejects_every_payload_with_a_machine_readable_code()
    {
        var adapter = new RejectingBrpIngestionAdapter("PVNED_TIMESERIES_XML_V2P0");

        var outcome = adapter.Parse(AnyRequest());

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.Document.ShouldBeNull();
        outcome.FailureCode.ShouldBe(RejectingBrpIngestionAdapter.FailureCode);
        outcome.FailureCode.ShouldBe("ADAPTER_NOT_IMPLEMENTED");
        outcome.FailureDetail.ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public void the_null_adapter_rejects_an_empty_payload_too()
    {
        // The receipt half must hold for ARBITRARY bytes, and zero bytes is the sharpest case:
        // an adapter that threw here would turn a stored message into an unhandled exception on
        // the job thread rather than a FAILED row with a code.
        var adapter = new RejectingBrpIngestionAdapter("PVNED_TIMESERIES_XML_V2P0");

        var outcome = adapter.Parse(AnyRequest() with { Payload = ReadOnlyMemory<byte>.Empty });

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~BrpIngestionAdapterRegistryTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'Adapters' does not exist in the namespace 'PeakPower.Ingestion'`.

- [ ] **Step 3: Write the registry**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Adapters/BrpIngestionAdapterRegistry.cs`:

```csharp
using PeakPower.Application.Abstractions.Ingestion;

namespace PeakPower.Ingestion.Adapters;

/// <summary>
/// Keyed lookup over every registered <see cref="IBrpIngestionAdapter"/>.
/// </summary>
/// <remarks>
/// <b>S2-D3, and this is the type that implements it.</b> Selection is by
/// <c>metering.brp.adapter_key</c> and by nothing else — never by a field in the payload, never by
/// the route, never by "the only adapter there is". That is what makes a replay [F02-R27] parse
/// under the same adapter that first parsed it, including after that BRP has been deactivated
/// [F02-R41].
/// </remarks>
public sealed class BrpIngestionAdapterRegistry : IBrpIngestionAdapterRegistry
{
    private readonly Dictionary<string, IBrpIngestionAdapter> _byKey;

    public BrpIngestionAdapterRegistry(IEnumerable<IBrpIngestionAdapter> adapters)
    {
        ArgumentNullException.ThrowIfNull(adapters);

        _byKey = new Dictionary<string, IBrpIngestionAdapter>(StringComparer.Ordinal);

        foreach (var adapter in adapters)
        {
            if (string.IsNullOrWhiteSpace(adapter.AdapterKey))
            {
                throw new InvalidOperationException(
                    $"Adapter {adapter.GetType().FullName} declares no AdapterKey. "
                    + "The key is what metering.brp.adapter_key selects it by.");
            }

            if (!_byKey.TryAdd(adapter.AdapterKey, adapter))
            {
                // No correct answer exists, so the wrong thing to do is pick one. A boot failure
                // names both types; a silent win by registration order does not.
                throw new InvalidOperationException(
                    $"Two BRP ingestion adapters declare the adapter key '{adapter.AdapterKey}': "
                    + $"{_byKey[adapter.AdapterKey].GetType().FullName} and "
                    + $"{adapter.GetType().FullName}.");
            }
        }
    }

    /// <summary>The keys registered, for the wiring test and for a boot-time log line.</summary>
    public IReadOnlyCollection<string> RegisteredKeys => _byKey.Keys;

    public IBrpIngestionAdapter Resolve(string adapterKey)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(adapterKey);

        // Ordinal, case-sensitive. metering.brp.adapter_key carries no casing constraint, so a
        // row spelled in lower case must fail loudly here rather than resolve.
        return _byKey.TryGetValue(adapterKey, out var adapter)
            ? adapter
            : throw new AdapterNotRegisteredException(adapterKey);
    }
}
```

- [ ] **Step 4: Write the null adapter**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Adapters/RejectingBrpIngestionAdapter.cs`:

```csharp
using PeakPower.Application.Abstractions.Ingestion;

namespace PeakPower.Ingestion.Adapters;

/// <summary>
/// An adapter that parses nothing and rejects everything, carrying whatever
/// <c>metering.brp.adapter_key</c> it is constructed with.
/// </summary>
/// <remarks>
/// <para>
/// Design step 4 builds the receipt half against this deliberately: [F02-R03]…[F02-R07] — durable
/// storage before parsing, 200 before processing, the 25 MiB cap, the 24 h dedupe, the correlation
/// id — must all hold for <b>arbitrary bytes</b>, before a line of any BRP's format is parsed. An
/// adapter that rejects is the honest stand-in for one that does not exist yet.
/// </para>
/// <para>
/// It stays in the tree after plan 4 lands the PVNed adapter. A BRP row configured with an
/// adapter_key nobody has built yet then fails as a FAILED message with a code an employee can
/// read, rather than as an AdapterNotRegisteredException on the job thread.
/// </para>
/// </remarks>
public sealed class RejectingBrpIngestionAdapter : IBrpIngestionAdapter
{
    /// <summary>
    /// The machine-readable code this adapter puts on <c>inbound_message.failure_code</c>. It is
    /// deliberately NOT one of the thirteen shared-contract §8.4 codes: those name a defect in the
    /// document, and this one names a gap in the platform.
    /// </summary>
    public const string FailureCode = "ADAPTER_NOT_IMPLEMENTED";

    public RejectingBrpIngestionAdapter(string adapterKey)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(adapterKey);
        AdapterKey = adapterKey;
    }

    public string AdapterKey { get; }

    public BrpParseOutcome Parse(BrpParseRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        // Reads no byte of the payload, including when there are none. The receipt half is proven
        // against arbitrary bytes, and an adapter that inspected them would make that untrue.
        return BrpParseOutcome.Rejected(
            FailureCode,
            $"No parser is implemented for adapter key '{AdapterKey}'. The payload is stored and "
            + "can be replayed once an adapter for this BRP exists.");
    }
}
```

- [ ] **Step 5: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~BrpIngestionAdapterRegistryTests"
```

Expected: PASS — 6 tests, 0 failed.

- [ ] **Step 6: Verify by mutation — the registry really selects by key**

**What to break:** in `BrpIngestionAdapterRegistry.Resolve`, replace the body with
`return _byKey.Values.First();`.

**What to predict:** `does_not_resolve_the_only_adapter_there_is_when_the_key_is_a_different_one`
fails — `Should.Throw<AdapterNotRegisteredException>` reports
`Should throw AdapterNotRegisteredException but did not` — and
`resolves_the_adapter_whose_key_matches` fails with
`registry.Resolve("OTHER_BRP_JSON_V1") should be same as other but was pvned`.

**What to watch go red:** both of those, and `matches_the_key_ordinally_and_case_sensitively`.
Three failures, and the third is the one that proves the mutation is the *interesting* one — a
`FirstOrDefault` registry is exactly the shape that reads as working with one adapter installed.

Restore.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Ingestion/Adapters \
        tests/PeakPower.Application.Tests/Ingestion/BrpIngestionAdapterRegistryTests.cs
git commit -m "feat(ingestion): resolve adapters by adapter_key, and add the rejecting null adapter

S2-D3 at unit level: a Dictionary keyed ordinally on metering.brp.adapter_key, refusing duplicate
keys at construction. Mutation-verified against a FirstOrDefault implementation, which is the shape
that passes every test in the slice while making the key decorative.

RejectingBrpIngestionAdapter is what design step 4 builds the receipt half against, so
[F02-R03]..[F02-R07] are proven for arbitrary bytes before any BRP format is parsed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The filesystem raw-payload store

`[DEC-03]`/`[F02-R03]`: the raw payload, HTTP headers, source IP, receipt timestamp and the
receiving BRP are persisted **before** any parsing or validation. The payload is the evidence in a
dispute, whatever produced it.

Contract §7.3 pins the layout: `{brpId}/{yyyy}/{MM}/{dd}/{correlationId}.bin` under the path in
`RAW_PAYLOAD_ROOT` (default `/var/lib/peakpower/raw-payloads`), with the returned `payload_uri`
being `file://{relative path}`.

⚠ **`payload_uri` is relative, and that is deliberate.** The absolute root is a deployment fact —
a named Docker volume on the VM, a temp directory in a test — and storing it would make every row
written on one machine unreadable on another. `ReadAsync` re-joins the configured root to the
relative path, so moving the volume is a configuration change and not a data migration.

⚠ **Durable means flushed.** `File.WriteAllBytesAsync` returns when the bytes are in the OS page
cache, not when they are on the disk. The 200 this store precedes is a promise that the evidence
survives; the write therefore goes through a `FileStream` with `FlushAsync` followed by
`Flush(flushToDisk: true)`.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Storage/RawPayloadStoreOptions.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Storage/FilesystemRawPayloadStore.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/FilesystemRawPayloadStoreTests.cs`

**Interfaces:**
- Consumes: `IRawPayloadStore` (Task 1); `IMarketCalendar.UtcNow`
  (`src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs:15`).
- Produces: `RawPayloadStoreOptions` (with `RootEnvironmentVariable`, `DefaultRoot`, `Root`) ·
  `FilesystemRawPayloadStore(RawPayloadStoreOptions options, IMarketCalendar calendar)` ·
  `FilesystemRawPayloadStore.UriScheme` (`"file://"`).

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/FilesystemRawPayloadStoreTests.cs`:

```csharp
using System.Text;
using PeakPower.Application.Abstractions;
using PeakPower.Ingestion.Storage;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion;

public sealed class FilesystemRawPayloadStoreTests : IDisposable
{
    private readonly string _root =
        Path.Combine(Path.GetTempPath(), "pp-raw-payloads", Guid.NewGuid().ToString("N"));

    private readonly FixedCalendar _calendar =
        new(DateTimeOffset.Parse("2026-08-12T04:02:11Z", null));

    private FilesystemRawPayloadStore CreateStore() =>
        new(new RawPayloadStoreOptions { Root = _root }, _calendar);

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    [Fact]
    public async Task stores_the_payload_at_the_contract_s_layout()
    {
        var brpId = Guid.Parse("0199a1a0-0000-7000-8000-0000000000b1");
        var correlationId = Guid.Parse("0199b2b2-0000-7000-8000-000000000001");
        var store = CreateStore();

        await store.StoreAsync(brpId, correlationId, Encoding.UTF8.GetBytes("<x/>"), TestContext.Current.CancellationToken);

        var expected = Path.Combine(
            _root, brpId.ToString(), "2026", "08", "12", correlationId + ".bin");
        File.Exists(expected).ShouldBeTrue($"expected the payload at {expected}");
    }

    [Fact]
    public async Task returns_a_relative_file_uri_and_never_the_configured_root()
    {
        var brpId = Guid.Parse("0199a1a0-0000-7000-8000-0000000000b1");
        var correlationId = Guid.Parse("0199b2b2-0000-7000-8000-000000000002");
        var store = CreateStore();

        var uri = await store.StoreAsync(
            brpId, correlationId, Encoding.UTF8.GetBytes("<x/>"), TestContext.Current.CancellationToken);

        // The absolute root is a deployment fact. A payload_uri that carried it would be
        // unreadable the moment the volume moved, and every row already written would be wrong.
        uri.ShouldBe($"file://{brpId}/2026/08/12/{correlationId}.bin");
        uri.ShouldNotContain(_root, Case.Sensitive);
    }

    [Fact]
    public async Task reads_back_exactly_the_bytes_it_was_given()
    {
        var payload = new byte[] { 0x00, 0xFF, 0x10, 0x00, 0x7F };
        var store = CreateStore();

        var uri = await store.StoreAsync(
            Guid.CreateVersion7(), Guid.CreateVersion7(), payload, TestContext.Current.CancellationToken);
        var read = await store.ReadAsync(uri, TestContext.Current.CancellationToken);

        read.ToArray().ShouldBe(payload);
    }

    [Fact]
    public async Task stores_a_zero_byte_payload_rather_than_refusing_it()
    {
        // Arbitrary bytes includes none of them. A store that skipped the write here would leave
        // inbound_message pointing at a file that does not exist, and the failure would surface on
        // replay weeks later rather than at receipt.
        var store = CreateStore();

        var uri = await store.StoreAsync(
            Guid.CreateVersion7(), Guid.CreateVersion7(), ReadOnlyMemory<byte>.Empty, TestContext.Current.CancellationToken);
        var read = await store.ReadAsync(uri, TestContext.Current.CancellationToken);

        read.Length.ShouldBe(0);
    }

    [Fact]
    public async Task refuses_a_uri_that_climbs_out_of_the_root()
    {
        var store = CreateStore();

        // payload_uri comes back out of the database, and the database is written by this process
        // - but a replay endpoint hands whatever the row holds straight to ReadAsync, so the
        // traversal check belongs here rather than in a caller nobody has written yet.
        var thrown = await Should.ThrowAsync<ArgumentException>(
            () => store.ReadAsync("file://../../etc/passwd", TestContext.Current.CancellationToken));

        thrown.Message.ShouldContain("outside the raw-payload root", Case.Sensitive);
    }

    [Fact]
    public async Task refuses_a_uri_that_does_not_carry_the_file_scheme()
    {
        var store = CreateStore();

        await Should.ThrowAsync<ArgumentException>(
            () => store.ReadAsync("s3://bucket/key", TestContext.Current.CancellationToken));
    }

    [Fact]
    public void reads_the_root_from_RAW_PAYLOAD_ROOT_and_falls_back_to_the_volume_path()
    {
        RawPayloadStoreOptions.RootEnvironmentVariable.ShouldBe("RAW_PAYLOAD_ROOT");
        RawPayloadStoreOptions.DefaultRoot.ShouldBe("/var/lib/peakpower/raw-payloads");
        new RawPayloadStoreOptions().Root.ShouldBe(RawPayloadStoreOptions.DefaultRoot);
    }

    private sealed class FixedCalendar(DateTimeOffset now) : IMarketCalendar
    {
        public DateTimeOffset UtcNow => now;

        public DateOnly TodayInAmsterdam => DateOnly.FromDateTime(now.UtcDateTime);

        public int ExpectedIntervalCount(DateOnly date) => 96;

        public DateTimeOffset IntervalStart(DateOnly date, int pos) =>
            new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero)
                .AddMinutes(15 * (pos - 1));

        public bool IsDstDuplicate(DateOnly date, int pos) => false;

        public DateOnly AddWorkingDays(DateOnly from, int workingDays) => from.AddDays(workingDays);
    }
}
```

⚠ `FixedCalendar` implements every member of `IMarketCalendar` **as plan 1 leaves it**. If plan 1's
final signature differs, this class is where the compile error lands and it is the only place to
fix — do not change the interface.

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~FilesystemRawPayloadStoreTests"
```

Expected: FAIL — build error
`error CS0234: The type or namespace name 'Storage' does not exist in the namespace 'PeakPower.Ingestion'`.

- [ ] **Step 3: Write the options**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Storage/RawPayloadStoreOptions.cs`:

```csharp
namespace PeakPower.Ingestion.Storage;

/// <summary>Where raw payloads are written. Shared contract §7.3.</summary>
public sealed class RawPayloadStoreOptions
{
    /// <summary>
    /// The environment variable the Worker reads. Named as a constant so
    /// <c>deploy/env.example</c>, the AppHost's volume mount and this type cannot drift apart in
    /// three places that never fail together.
    /// </summary>
    public const string RootEnvironmentVariable = "RAW_PAYLOAD_ROOT";

    /// <summary>The mount point of the named Docker volume in the published stack.</summary>
    public const string DefaultRoot = "/var/lib/peakpower/raw-payloads";

    /// <summary>The absolute root. Never written into <c>payload_uri</c>.</summary>
    public string Root { get; set; } = DefaultRoot;
}
```

- [ ] **Step 4: Write the store**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Storage/FilesystemRawPayloadStore.cs`:

```csharp
using System.Globalization;
using PeakPower.Application.Abstractions;
using PeakPower.Application.Abstractions.Ingestion;

namespace PeakPower.Ingestion.Storage;

/// <summary>
/// The one <see cref="IRawPayloadStore"/> slice 2 ships: a directory tree on a named Docker
/// volume.
/// </summary>
/// <remarks>
/// <para>
/// Layout <c>{brpId}/{yyyy}/{MM}/{dd}/{correlationId}.bin</c>, and the returned
/// <c>payload_uri</c> is <c>file://{relative path}</c>. The date comes from the receipt instant,
/// through <see cref="IMarketCalendar"/> — architecture fact 5 is IL-enforced and forbids reading
/// the clock anywhere but PeakPower.Infrastructure.Time.
/// </para>
/// <para>
/// Real object storage is out of scope (design §3.2). Seven-year retention is not a proof-of-concept
/// concern; the swap to MinIO or S3 is one adapter, and keeping <c>payload_uri</c> opaque is what
/// makes that true.
/// </para>
/// </remarks>
public sealed class FilesystemRawPayloadStore(
    RawPayloadStoreOptions options,
    IMarketCalendar calendar) : IRawPayloadStore
{
    /// <summary>The scheme every handle this store returns carries.</summary>
    public const string UriScheme = "file://";

    public async Task<string> StoreAsync(
        Guid brpId, Guid correlationId, ReadOnlyMemory<byte> payload, CancellationToken ct)
    {
        var receivedAt = calendar.UtcNow;

        // Invariant culture on every segment. A Dutch or Arabic-Indic locale would otherwise put
        // digits in this path that the read side cannot reproduce.
        var relative = string.Join(
            '/',
            brpId.ToString(),
            receivedAt.ToString("yyyy", CultureInfo.InvariantCulture),
            receivedAt.ToString("MM", CultureInfo.InvariantCulture),
            receivedAt.ToString("dd", CultureInfo.InvariantCulture),
            correlationId + ".bin");

        var absolute = ToAbsolutePath(relative);
        Directory.CreateDirectory(Path.GetDirectoryName(absolute)!);

        // Durable BEFORE the 200 is written - [F02-R03], [DEC-03]. WriteAllBytesAsync returns when
        // the bytes are in the page cache, which is not the same promise: FileOptions.WriteThrough
        // plus an explicit flush-to-disk is. The cost is one fsync per document, on a path that
        // handles one document per EAN per day [DEC-38].
        await using (var file = new FileStream(
                         absolute,
                         new FileStreamOptions
                         {
                             Mode = FileMode.Create,
                             Access = FileAccess.Write,
                             Share = FileShare.None,
                             Options = FileOptions.Asynchronous | FileOptions.WriteThrough,
                             PreallocationSize = payload.Length,
                         }))
        {
            await file.WriteAsync(payload, ct);
            await file.FlushAsync(ct);
            file.Flush(flushToDisk: true);
        }

        return UriScheme + relative;
    }

    public async Task<ReadOnlyMemory<byte>> ReadAsync(string payloadUri, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(payloadUri);

        if (!payloadUri.StartsWith(UriScheme, StringComparison.Ordinal))
        {
            throw new ArgumentException(
                $"A raw-payload handle must start with '{UriScheme}'; got '{payloadUri}'.",
                nameof(payloadUri));
        }

        var absolute = ToAbsolutePath(payloadUri[UriScheme.Length..]);
        return await File.ReadAllBytesAsync(absolute, ct);
    }

    /// <summary>
    /// Joins the configured root to a stored relative path, and refuses anything that escapes it.
    /// </summary>
    /// <remarks>
    /// The traversal check is not theatre. The replay endpoint (plan 6) hands whatever
    /// <c>inbound_message.payload_uri</c> holds straight to <see cref="ReadAsync"/>, so the only
    /// place that can decide "inside the root" is the type that knows where the root is.
    /// </remarks>
    private string ToAbsolutePath(string relative)
    {
        var root = Path.GetFullPath(options.Root);
        var candidate = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));

        // Compare against root + separator, not root alone: "/var/lib/peakpower/raw-payloads-evil"
        // starts with "/var/lib/peakpower/raw-payloads" and is a different directory.
        var rootWithSeparator = root.EndsWith(Path.DirectorySeparatorChar)
            ? root
            : root + Path.DirectorySeparatorChar;

        if (!candidate.StartsWith(rootWithSeparator, StringComparison.Ordinal))
        {
            throw new ArgumentException(
                $"The raw-payload handle resolves outside the raw-payload root: '{relative}'.",
                nameof(relative));
        }

        return candidate;
    }
}
```

- [ ] **Step 5: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~FilesystemRawPayloadStoreTests"
```

Expected: PASS — 7 tests, 0 failed.

- [ ] **Step 6: Verify by mutation — the handle really is root-relative**

**What to break:** in `StoreAsync`, return `UriScheme + absolute` instead of `UriScheme + relative`.

**What to predict:** `returns_a_relative_file_uri_and_never_the_configured_root` fails on the
`ShouldNotContain(_root, Case.Sensitive)` assertion, and
`stores_the_payload_at_the_contract_s_layout` still passes — which is the point: the file lands in
the right place either way, and only the stored handle is wrong.

**What to watch go red:** that one assertion. Then check the *second* consequence by hand: with the
mutation still in, `reads_back_exactly_the_bytes_it_was_given` also passes, because the same
process still has the same root. That is exactly why the assertion is written against the string
and not against a round trip — a round-trip test cannot see this bug at all.

Restore.

- [ ] **Step 7: Verify by mutation — the traversal guard is a prefix check, not a substring one**

**What to break:** in `ToAbsolutePath`, replace the `rootWithSeparator` comparison with
`candidate.Contains(root, StringComparison.Ordinal)`.

**What to predict:** `refuses_a_uri_that_climbs_out_of_the_root` fails — `Should.ThrowAsync` reports
`Should throw ArgumentException but did not`, because `/tmp/pp-raw-payloads/<id>/../../etc/passwd`
normalises to `/etc/passwd`, which does not contain the root and therefore… would still throw.

⚠ Read that prediction again before running it: it is wrong, and finding out *why* is the point.
`Contains` is a **weaker** check than the prefix, so it still catches the escaping case in this
test. Mutate the case the assertion is actually for instead:

**What to break instead:** replace the comparison with
`candidate.StartsWith(root, StringComparison.Ordinal)` — the sibling-directory bug.

**What to predict:** every test still passes, because no test covers a sibling directory.

**What to do about it:** that is a hole. Add this test, watch it fail against the mutation, then
restore the correct comparison and watch it pass:

```csharp
    [Fact]
    public async Task refuses_a_uri_that_resolves_to_a_sibling_of_the_root()
    {
        // "/tmp/pp-raw-payloads/<id>-evil" starts with "/tmp/pp-raw-payloads/<id>" and is a
        // different directory. Comparing against the root plus a separator is what closes it.
        var store = CreateStore();
        var sibling = Path.GetFileName(_root) + "-evil";

        await Should.ThrowAsync<ArgumentException>(
            () => store.ReadAsync($"file://../{sibling}/leak.bin", TestContext.Current.CancellationToken));
    }
```

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Ingestion/Storage \
        tests/PeakPower.Application.Tests/Ingestion/FilesystemRawPayloadStoreTests.cs
git commit -m "feat(ingestion): store raw payloads on a named volume behind IRawPayloadStore

[DEC-03]/[F02-R03]: the payload is the evidence in a dispute and is durable before the 200. The
write is WriteThrough plus an explicit flush-to-disk, because WriteAllBytesAsync returns on the
page cache and that is a weaker promise than the 200 makes.

payload_uri is root-RELATIVE. Mutation-verified: an absolute handle passes the round-trip test and
the layout test, and only fails the assertion written against the string - which is why that
assertion exists.

The traversal guard compares against root + separator, not a prefix; the sibling-directory test was
added after a mutation showed a bare StartsWith left it uncovered.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Per-BRP credential authentication, fail-closed

`[F02-R02]`/`[AS-16]`: the endpoint authenticates the caller, and the mechanism and credentials are
**per BRP**, held on the BRP record. Contract §9.2/§9.3 fix the mechanism for slice 2: a
`X-PeakPower-Brp-Credential` header compared with `CryptographicOperations.FixedTimeEquals` over
UTF-8 bytes, against the value of the **environment variable named by**
`metering.brp.credential_ref`.

⚠ **`credential_ref` holds the NAME of an environment variable, never a secret.** For the seeded
row that name is the literal `BRP_CREDENTIAL_PVNED`. Nothing may ever put a secret in that column.

⚠ **An empty or absent environment value means every request to that BRP's route is 401.** It must
never mean "no credential required" — that is the failure mode where a stack deployed with an
unset variable accepts anything, silently, and looks like it is working.

⚠ **One 401 for every failure mode.** Missing header, wrong credential, unknown `{brpCode}` and
`is_active = false` all answer the identical body. An unknown BRP code answering 404 would let the
endpoint enumerate which BRPs exist.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Webhook/IBrpCredentialSource.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Webhook/EnvironmentBrpCredentialSource.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Webhook/IBrpWebhookAuthenticator.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Webhook/BrpWebhookAuthenticator.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/WebhookCredentialTests.cs` (written in Task 6, once a host exists to post to)

**Interfaces:**
- Consumes: `PeakPowerDbContext.Brps` (`src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs:28`);
  `Brp.Code`, `Brp.IsActive` (`src/Core/PeakPower.Domain/Metering/Brp.cs:19,23`); `Brp.CredentialRef`,
  `Brp.AdapterKey` (plan 2, contract §6.1).
- Produces: `IBrpCredentialSource` · `EnvironmentBrpCredentialSource` · `IBrpWebhookAuthenticator` ·
  `BrpWebhookAuthenticator` · `BrpAuthenticationResult` · `BrpAuthenticationOutcome` ·
  `BrpWebhookAuthenticator.CredentialHeaderName` (`"X-PeakPower-Brp-Credential"`).

- [ ] **Step 1: Write the failing test**

This one is a unit test with a substituted credential source and a real DbContext against the
shared Postgres fixture, because the BRP row is the thing being looked up. Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/BrpWebhookAuthenticatorTests.cs`:

```csharp
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Webhook;
using PeakPower.Integration.Tests.Database;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

[Collection(PostgresCollection.Name)]
public sealed class BrpWebhookAuthenticatorTests(PostgresFixture postgres)
{
    private const string SeededCredentialRef = "BRP_CREDENTIAL_PVNED";

    private sealed class StubCredentialSource(Dictionary<string, string?> values) : IBrpCredentialSource
    {
        public string? Read(string environmentVariableName) =>
            values.TryGetValue(environmentVariableName, out var value) ? value : null;
    }

    private BrpWebhookAuthenticator CreateAuthenticator(string? credential)
        => new(
            postgres.CreateContext(),
            new StubCredentialSource(new Dictionary<string, string?>(StringComparer.Ordinal)
            {
                [SeededCredentialRef] = credential,
            }));

    [Fact]
    public void the_header_name_is_the_one_the_contract_freezes()
    {
        BrpWebhookAuthenticator.CredentialHeaderName.ShouldBe("X-PeakPower-Brp-Credential");
    }

    [Fact]
    public async Task authenticates_the_seeded_PVNED_row_on_the_configured_credential()
    {
        var authenticator = CreateAuthenticator("s3cret");

        var result = await authenticator.AuthenticateAsync(
            "PVNED", "s3cret", TestContext.Current.CancellationToken);

        result.Outcome.ShouldBe(BrpAuthenticationOutcome.Authenticated);
        result.BrpCode.ShouldBe("PVNED");
        result.BrpId.ShouldNotBe(Guid.Empty);
    }

    [Fact]
    public async Task refuses_a_wrong_credential()
    {
        var authenticator = CreateAuthenticator("s3cret");

        var result = await authenticator.AuthenticateAsync(
            "PVNED", "s3crey", TestContext.Current.CancellationToken);

        result.Outcome.ShouldBe(BrpAuthenticationOutcome.Unauthenticated);
    }

    [Fact]
    public async Task refuses_a_missing_credential()
    {
        var authenticator = CreateAuthenticator("s3cret");

        var result = await authenticator.AuthenticateAsync(
            "PVNED", null, TestContext.Current.CancellationToken);

        result.Outcome.ShouldBe(BrpAuthenticationOutcome.Unauthenticated);
    }

    [Fact]
    public async Task refuses_EVERY_request_when_the_environment_variable_is_absent()
    {
        // Fail closed. An unset BRP_CREDENTIAL_PVNED must never read as "no credential required" -
        // that is the failure where a stack deployed with an unset variable accepts anything and
        // looks like it is working.
        var authenticator = CreateAuthenticator(null);

        var result = await authenticator.AuthenticateAsync(
            "PVNED", "s3cret", TestContext.Current.CancellationToken);

        result.Outcome.ShouldBe(BrpAuthenticationOutcome.Unauthenticated);
    }

    [Fact]
    public async Task refuses_every_request_when_the_environment_variable_is_blank()
    {
        var authenticator = CreateAuthenticator("   ");

        var result = await authenticator.AuthenticateAsync(
            "PVNED", "   ", TestContext.Current.CancellationToken);

        result.Outcome.ShouldBe(BrpAuthenticationOutcome.Unauthenticated);
    }

    [Fact]
    public async Task refuses_an_unknown_brp_code_without_saying_it_is_unknown()
    {
        var authenticator = CreateAuthenticator("s3cret");

        var result = await authenticator.AuthenticateAsync(
            "NOTABRP", "s3cret", TestContext.Current.CancellationToken);

        // Same outcome value as a wrong credential. The endpoint must not become a way to
        // enumerate which BRPs the platform is configured for.
        result.Outcome.ShouldBe(BrpAuthenticationOutcome.Unauthenticated);
        result.BrpId.ShouldBe(Guid.Empty);
    }

    [Fact]
    public async Task refuses_a_deactivated_brp()
    {
        await using var arrange = postgres.CreateContext();
        var suspended = Brp.Create("SUSPENDED", "Suspended BRP B.V.", isActive: false).Value;
        arrange.Brps.Add(suspended);
        await arrange.SaveChangesAsync(TestContext.Current.CancellationToken);

        var authenticator = new BrpWebhookAuthenticator(
            postgres.CreateContext(),
            new StubCredentialSource(new Dictionary<string, string?>(StringComparer.Ordinal)
            {
                [suspended.CredentialRef] = "s3cret",
            }));

        var result = await authenticator.AuthenticateAsync(
            "SUSPENDED", "s3cret", TestContext.Current.CancellationToken);

        result.Outcome.ShouldBe(BrpAuthenticationOutcome.Unauthenticated);
    }

    [Fact]
    public async Task compares_the_credential_in_constant_time_over_utf8_bytes()
    {
        // Two credentials that differ only outside the ASCII range. A comparison that narrowed to
        // bytes through a lossy encoding would call these equal.
        var authenticator = CreateAuthenticator("wachtwoord-é");

        var result = await authenticator.AuthenticateAsync(
            "PVNED", "wachtwoord-e", TestContext.Current.CancellationToken);

        result.Outcome.ShouldBe(BrpAuthenticationOutcome.Unauthenticated);
    }
}
```

⚠ `Brp.Create` as slice 1 shipped it takes three arguments and sets no `CredentialRef`. Plan 2 adds
the six contract §6.1 columns; the `refuses_a_deactivated_brp` test above reads
`suspended.CredentialRef` from whatever plan 2's factory defaults it to. If plan 2's `Brp.Create`
signature grew, adapt the two call sites in this file and nothing else.

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~BrpWebhookAuthenticatorTests"
```

Expected: FAIL — build error
`error CS0234: The type or namespace name 'Webhook' does not exist in the namespace 'PeakPower.Ingestion'`.

- [ ] **Step 3: Declare and implement the credential source**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Webhook/IBrpCredentialSource.cs`:

```csharp
namespace PeakPower.Ingestion.Webhook;

/// <summary>
/// Reads the value of the environment variable a BRP row's <c>credential_ref</c> names.
/// </summary>
/// <remarks>
/// A port for exactly one reason: <c>Environment.GetEnvironmentVariable</c> is process-wide state,
/// and a test that set it would be visible to every other test in the assembly running beside it.
/// The production implementation is four lines and calls nothing else.
/// </remarks>
public interface IBrpCredentialSource
{
    /// <summary>
    /// The configured credential, or <c>null</c> when the variable is unset. <b>Null and blank are
    /// both fail-closed</b>; the decision lives in <see cref="BrpWebhookAuthenticator"/>.
    /// </summary>
    string? Read(string environmentVariableName);
}
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Webhook/EnvironmentBrpCredentialSource.cs`:

```csharp
namespace PeakPower.Ingestion.Webhook;

/// <summary>
/// Shared contract §9.3, literally: the Worker reads
/// <c>Environment.GetEnvironmentVariable(brp.CredentialRef)</c> at request time.
/// </summary>
/// <remarks>
/// At request time and not at boot, deliberately. Rotating a credential is then a container
/// restart's environment change rather than a code change, and — more to the point — a BRP row
/// added after boot works without one.
/// </remarks>
public sealed class EnvironmentBrpCredentialSource : IBrpCredentialSource
{
    public string? Read(string environmentVariableName) =>
        Environment.GetEnvironmentVariable(environmentVariableName);
}
```

- [ ] **Step 4: Declare the authenticator port and its result**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Webhook/IBrpWebhookAuthenticator.cs`:

```csharp
namespace PeakPower.Ingestion.Webhook;

/// <summary>Turns a route's <c>{brpCode}</c> plus a header into a BRP identity, or into nothing.</summary>
public interface IBrpWebhookAuthenticator
{
    Task<BrpAuthenticationResult> AuthenticateAsync(
        string brpCode, string? presentedCredential, CancellationToken ct);
}

public enum BrpAuthenticationOutcome
{
    Authenticated,
    Unauthenticated,
}

/// <summary>
/// One outcome value for every failure mode.
/// </summary>
/// <remarks>
/// Missing header, wrong credential, unknown <c>{brpCode}</c> and <c>is_active = false</c> all
/// produce <see cref="BrpAuthenticationOutcome.Unauthenticated"/> with an empty
/// <see cref="BrpId"/>. There is deliberately no discriminator: shared contract §9.4 answers 401
/// and not 404 to an unknown code, so that the endpoint cannot be used to enumerate which BRPs the
/// platform is configured for, and a reason field here would put the same information one log line
/// or one refactor away from the response.
/// </remarks>
public sealed record BrpAuthenticationResult(
    BrpAuthenticationOutcome Outcome,
    Guid BrpId,
    string BrpCode,
    string AdapterKey)
{
    public static BrpAuthenticationResult Rejected() =>
        new(BrpAuthenticationOutcome.Unauthenticated, Guid.Empty, string.Empty, string.Empty);

    public static BrpAuthenticationResult Accepted(Guid brpId, string brpCode, string adapterKey) =>
        new(BrpAuthenticationOutcome.Authenticated, brpId, brpCode, adapterKey);
}
```

- [ ] **Step 5: Implement the authenticator**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Webhook/BrpWebhookAuthenticator.cs`:

```csharp
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using PeakPower.Persistence;

namespace PeakPower.Ingestion.Webhook;

/// <summary>
/// Per-BRP shared-secret authentication. [F02-R02], [AS-16]; shared contract §9.2 and §9.3.
/// </summary>
public sealed class BrpWebhookAuthenticator(
    PeakPowerDbContext db,
    IBrpCredentialSource credentials) : IBrpWebhookAuthenticator
{
    /// <summary>
    /// Shared contract §9.2. No scheme prefix and no <c>Authorization</c> header: the mechanism is
    /// per BRP, and a shared-secret header is the mechanism this BRP row declares.
    /// </summary>
    public const string CredentialHeaderName = "X-PeakPower-Brp-Credential";

    public async Task<BrpAuthenticationResult> AuthenticateAsync(
        string brpCode, string? presentedCredential, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(brpCode))
        {
            return BrpAuthenticationResult.Rejected();
        }

        // Ordinal and case-sensitive against the stored code, which Brp.Create upper-cases on the
        // way in (src/Core/PeakPower.Domain/Metering/Brp.cs:40). The route therefore carries the
        // code as it is stored - /webhooks/brp/PVNED - and /webhooks/brp/pvned is a 401.
        var brp = await db.Brps
            .AsNoTracking()
            .Where(candidate => candidate.Code == brpCode)
            .Select(candidate => new
            {
                candidate.Id,
                candidate.Code,
                candidate.IsActive,
                candidate.CredentialRef,
                candidate.AdapterKey,
            })
            .SingleOrDefaultAsync(ct);

        if (brp is null || !brp.IsActive)
        {
            return BrpAuthenticationResult.Rejected();
        }

        // FAIL CLOSED. An unset or blank BRP_CREDENTIAL_<CODE> refuses every request to that
        // route. It must never read as "no credential required": that is the shape where a stack
        // deployed with an unset variable accepts anything from anybody and looks healthy.
        var expected = credentials.Read(brp.CredentialRef);
        if (string.IsNullOrWhiteSpace(expected) || string.IsNullOrWhiteSpace(presentedCredential))
        {
            return BrpAuthenticationResult.Rejected();
        }

        // FixedTimeEquals over UTF-8 bytes. It is not constant-time across differing LENGTHS - it
        // returns false immediately when the spans differ in length - and that is accepted here:
        // the length of a shared secret is not the secret. What it does buy is that a caller
        // cannot walk the value one byte at a time by timing, which a string comparison hands over.
        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        var presentedBytes = Encoding.UTF8.GetBytes(presentedCredential);

        return CryptographicOperations.FixedTimeEquals(expectedBytes, presentedBytes)
            ? BrpAuthenticationResult.Accepted(brp.Id, brp.Code, brp.AdapterKey)
            : BrpAuthenticationResult.Rejected();
    }
}
```

- [ ] **Step 6: Reference PeakPower.Ingestion from the integration test project**

Read the file first:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
sed -n '1,25p' tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj
```

Then add these two lines to the first `<ItemGroup>`, after the
`PeakPower.Infrastructure.Web.csproj` reference at line 19:

```xml
    <!-- Slice 2 plan 3: the ingestion pipeline, and the Worker host that maps its webhook. The
         suite boots the real Worker through WebApplicationFactory<WorkerEntryPoint>. -->
    <ProjectReference Include="../../src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj" />
    <ProjectReference Include="../../src/Hosts/PeakPower.Worker/PeakPower.Worker.csproj" />
```

- [ ] **Step 7: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~BrpWebhookAuthenticatorTests"
```

Expected: PASS — 9 tests, 0 failed.

- [ ] **Step 8: Verify by mutation — fail-closed really is closed**

**What to break:** in `BrpWebhookAuthenticator.AuthenticateAsync`, change the fail-closed guard to

```csharp
        if (string.IsNullOrWhiteSpace(expected))
        {
            // "no credential configured, so nothing to check"
            return BrpAuthenticationResult.Accepted(brp.Id, brp.Code, brp.AdapterKey);
        }
```

**What to predict:** `refuses_EVERY_request_when_the_environment_variable_is_absent` fails with
`result.Outcome should be Unauthenticated but was Authenticated`, and
`refuses_every_request_when_the_environment_variable_is_blank` fails identically.

**What to watch go red:** both. This is the single most valuable mutation in the task: the mutated
code is what an unwary implementer writes, it passes every other test in the suite, and it means a
deployed webhook accepts documents from anybody.

Restore.

- [ ] **Step 9: Verify by mutation — an unknown code is not distinguishable from a wrong credential**

**What to break:** change `BrpAuthenticationResult.Rejected()` to take a reason and have the
`brp is null` path return `Rejected("UNKNOWN_BRP")` while the credential path returns
`Rejected("BAD_CREDENTIAL")`.

**What to predict:** nothing fails, because the tests assert only the outcome.

**What to do about it:** that is the hole, and it is why the record carries no reason field. Do not
add one. Instead add this assertion to `refuses_an_unknown_brp_code_without_saying_it_is_unknown`,
restore, and watch it pass:

```csharp
        // Byte-identical to the wrong-credential rejection. A reason field here is one refactor
        // away from being logged, returned, or rendered on a screen a BRP can see.
        var wrongCredential = await authenticator.AuthenticateAsync(
            "PVNED", "not-the-secret", TestContext.Current.CancellationToken);
        result.ShouldBe(wrongCredential);
```

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Ingestion/Webhook \
        tests/PeakPower.Integration.Tests/Ingestion/BrpWebhookAuthenticatorTests.cs \
        tests/PeakPower.Integration.Tests/PeakPower.Integration.Tests.csproj
git commit -m "feat(ingestion): authenticate the BRP webhook per BRP, fail-closed

[F02-R02]/[AS-16]: the mechanism and the credential are per BRP. credential_ref holds the NAME of
an environment variable, never a secret, and the Worker reads it at request time.

Fail closed on an unset or blank value: mutation-verified against the 'nothing configured, so
nothing to check' implementation, which passes every other test in the suite and means a deployed
webhook accepts documents from anybody.

One rejection value for missing header, wrong credential, unknown code and is_active = false, so
the endpoint cannot enumerate which BRPs exist - the equality of the two rejections is asserted
rather than left to the type's shape.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The receipt transaction — hash, store, dedupe, enqueue

This is `[F02-R03]`, `[F02-R04]` and `[F02-R07]` in one type, and the order of its five steps is
the whole of it:

1. SHA-256 the payload.
2. Open a transaction and take a **transaction-scoped advisory lock** on
   `(brp_id, payload_hash)`, so two byte-identical payloads arriving at the same instant cannot
   both be written `RECEIVED`.
3. `IRawPayloadStore.StoreAsync` — **before** the row, and before any parsing. The payload is the
   evidence; a row pointing at a file that was never written is worse than no row.
4. Look for a byte-identical message from **the same BRP** within 24 h. Found → insert with
   `MarkDuplicate` and enqueue nothing. Not found → insert `RECEIVED`.
5. Commit, then enqueue.

⚠ **Enqueue after the commit, not inside the transaction.** A queue entry committed before the row
it points at can be dequeued by a worker that then cannot find the message — a race the whole
asynchronous design exists to avoid. Contract §7.4 says it in the port's own doc comment: "Called
AFTER the payload is durable and AFTER `inbound_message` is committed with status `RECEIVED`, and
BEFORE the 200 is written."

⚠ **The duplicate is still stored.** `[F02-R03]` is unconditional: the raw payload of every request
that got past auth and the size cap is persisted before anything looks at it. Deciding it is a
duplicate is *looking at it*. The cost is one extra file per redelivery; the benefit is that
"we have the bytes of everything that arrived" is true without an exception.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Receipt/IInboundMessageReceiver.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Receipt/InboundMessageReceiver.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/InboundMessageReceiverTests.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/RecordingIngestionJobQueue.cs`

**Interfaces:**
- Consumes: `IRawPayloadStore`, `IIngestionJobQueue` (Task 1); `IMarketCalendar.UtcNow`;
  `InboundMessage.Receive/MarkDuplicate` and `PeakPowerDbContext.InboundMessages` (plan 2).
- Produces: `IInboundMessageReceiver` · `InboundMessageArrival` · `IngestionReceipt` ·
  `IngestionReceiptOutcome` · `InboundMessageReceiver` ·
  `InboundMessageReceiver.DuplicateWindow` (`TimeSpan.FromHours(24)`).

- [ ] **Step 1: Write the recording queue**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/RecordingIngestionJobQueue.cs`:

```csharp
using System.Collections.Concurrent;
using PeakPower.Application.Abstractions.Ingestion;

namespace PeakPower.Integration.Tests.Ingestion;

/// <summary>
/// Captures enqueues instead of running them, so a test can assert on <b>what was enqueued and
/// when</b> without the job ever executing.
/// </summary>
/// <remarks>
/// That separation is the point rather than a convenience. Shared contract §9.4 requires the 200 to
/// be written with <c>status = 'RECEIVED'</c> — <b>not</b> <c>PROCESSED</c> — and a queue that
/// ran the handler inline would make that assertion pass or fail on scheduler timing.
/// </remarks>
public sealed class RecordingIngestionJobQueue : IIngestionJobQueue
{
    private readonly ConcurrentQueue<(Guid InboundMessageId, Guid CorrelationId)> _enqueued = new();

    public IReadOnlyList<(Guid InboundMessageId, Guid CorrelationId)> Enqueued => [.. _enqueued];

    public Task EnqueueProcessMessageAsync(
        Guid inboundMessageId, Guid correlationId, CancellationToken ct)
    {
        _enqueued.Enqueue((inboundMessageId, correlationId));
        return Task.CompletedTask;
    }
}
```

- [ ] **Step 2: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/InboundMessageReceiverTests.cs`:

```csharp
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Receipt;
using PeakPower.Ingestion.Storage;
using PeakPower.Integration.Tests.Database;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

[Collection(PostgresCollection.Name)]
public sealed class InboundMessageReceiverTests(PostgresFixture postgres) : IDisposable
{
    private readonly string _root =
        Path.Combine(Path.GetTempPath(), "pp-raw-payloads", Guid.NewGuid().ToString("N"));

    private readonly MovableCalendar _calendar =
        new(DateTimeOffset.Parse("2026-08-13T04:02:11Z", null));

    private readonly RecordingIngestionJobQueue _queue = new();

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private InboundMessageReceiver CreateReceiver() => new(
        postgres.CreateContext(),
        new FilesystemRawPayloadStore(new RawPayloadStoreOptions { Root = _root }, _calendar),
        _queue,
        _calendar);

    private static async Task<Guid> SeedBrpAsync(PostgresFixture postgres, string code)
    {
        await using var db = postgres.CreateContext();
        var brp = Brp.Create(code, $"{code} B.V.", isActive: true).Value;
        db.Brps.Add(brp);
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        return brp.Id;
    }

    private static InboundMessageArrival Arrival(Guid brpId, byte[] payload) => new(
        BrpId: brpId,
        CorrelationId: Guid.CreateVersion7(),
        Payload: payload,
        HttpHeadersJson: """{"content-type":["application/soap+xml"]}""",
        RemoteIp: "10.0.0.7");

    [Fact]
    public async Task stores_the_payload_and_the_row_with_status_RECEIVED()
    {
        var brpId = await SeedBrpAsync(postgres, "RCV1");
        var payload = Encoding.UTF8.GetBytes("<arbitrary>not xml at all</arbitrary>");
        var arrival = Arrival(brpId, payload);

        var receipt = await CreateReceiver().ReceiveAsync(arrival, TestContext.Current.CancellationToken);

        receipt.Outcome.ShouldBe(IngestionReceiptOutcome.Accepted);
        receipt.CorrelationId.ShouldBe(arrival.CorrelationId);

        await using var db = postgres.CreateContext();
        var stored = await db.InboundMessages.AsNoTracking()
            .SingleAsync(m => m.Id == receipt.InboundMessageId, TestContext.Current.CancellationToken);

        stored.Status.ShouldBe(InboundMessageStatus.Received);
        stored.BrpId.ShouldBe(brpId);
        stored.CorrelationId.ShouldBe(arrival.CorrelationId);
        stored.PayloadBytes.ShouldBe(payload.Length);
        stored.PayloadHash.ShouldBe(SHA256.HashData(payload));
        stored.RemoteIp.ShouldBe("10.0.0.7");
        stored.HttpHeaders.ShouldBe(arrival.HttpHeadersJson);
        stored.ProcessedAt.ShouldBeNull();
        stored.FailureCode.ShouldBeNull();
    }

    [Fact]
    public async Task writes_the_payload_file_before_the_row_exists()
    {
        // [F02-R03]/[DEC-03]: the payload is persisted BEFORE anything else. A row pointing at a
        // file that was never written is worse than no row - it is evidence that is not there.
        var brpId = await SeedBrpAsync(postgres, "RCV2");
        var payload = Encoding.UTF8.GetBytes("evidence");

        var receipt = await CreateReceiver().ReceiveAsync(
            Arrival(brpId, payload), TestContext.Current.CancellationToken);

        await using var db = postgres.CreateContext();
        var stored = await db.InboundMessages.AsNoTracking()
            .SingleAsync(m => m.Id == receipt.InboundMessageId, TestContext.Current.CancellationToken);

        var store = new FilesystemRawPayloadStore(
            new RawPayloadStoreOptions { Root = _root }, _calendar);
        var readBack = await store.ReadAsync(stored.PayloadUri, TestContext.Current.CancellationToken);

        readBack.ToArray().ShouldBe(payload);
    }

    [Fact]
    public async Task enqueues_exactly_once_for_an_accepted_message()
    {
        var brpId = await SeedBrpAsync(postgres, "RCV3");

        var receipt = await CreateReceiver().ReceiveAsync(
            Arrival(brpId, Encoding.UTF8.GetBytes("one")), TestContext.Current.CancellationToken);

        _queue.Enqueued.Count.ShouldBe(1);
        _queue.Enqueued[0].InboundMessageId.ShouldBe(receipt.InboundMessageId);
        _queue.Enqueued[0].CorrelationId.ShouldBe(receipt.CorrelationId);
    }

    [Fact]
    public async Task records_a_byte_identical_redelivery_within_24h_as_DUPLICATE_and_enqueues_nothing()
    {
        var brpId = await SeedBrpAsync(postgres, "RCV4");
        var payload = Encoding.UTF8.GetBytes("<same/>");

        await CreateReceiver().ReceiveAsync(Arrival(brpId, payload), TestContext.Current.CancellationToken);
        _calendar.Advance(TimeSpan.FromHours(23));
        var second = await CreateReceiver().ReceiveAsync(
            Arrival(brpId, payload), TestContext.Current.CancellationToken);

        second.Outcome.ShouldBe(IngestionReceiptOutcome.Duplicate);

        await using var db = postgres.CreateContext();
        var stored = await db.InboundMessages.AsNoTracking()
            .SingleAsync(m => m.Id == second.InboundMessageId, TestContext.Current.CancellationToken);
        stored.Status.ShouldBe(InboundMessageStatus.Duplicate);

        // One enqueue, from the first receipt. [F02-R07]: recorded as a duplicate and NOT
        // reprocessed.
        _queue.Enqueued.Count.ShouldBe(1);
    }

    [Fact]
    public async Task treats_the_same_bytes_after_24h_as_a_new_message()
    {
        var brpId = await SeedBrpAsync(postgres, "RCV5");
        var payload = Encoding.UTF8.GetBytes("<same/>");

        await CreateReceiver().ReceiveAsync(Arrival(brpId, payload), TestContext.Current.CancellationToken);
        _calendar.Advance(TimeSpan.FromHours(24) + TimeSpan.FromSeconds(1));
        var second = await CreateReceiver().ReceiveAsync(
            Arrival(brpId, payload), TestContext.Current.CancellationToken);

        // The window is 24 h, not forever. A BRP legitimately resending an unchanged day the next
        // week is a new message, and dropping it would lose the day.
        second.Outcome.ShouldBe(IngestionReceiptOutcome.Accepted);
        _queue.Enqueued.Count.ShouldBe(2);
    }

    [Fact]
    public async Task does_not_deduplicate_across_two_different_BRPs()
    {
        // Byte-identical from a DIFFERENT BRP is a different message: same EAN, different sender,
        // and the second one has to be quarantined as WRONG_BRP rather than silently dropped.
        var first = await SeedBrpAsync(postgres, "RCV6A");
        var second = await SeedBrpAsync(postgres, "RCV6B");
        var payload = Encoding.UTF8.GetBytes("<same/>");

        await CreateReceiver().ReceiveAsync(Arrival(first, payload), TestContext.Current.CancellationToken);
        var result = await CreateReceiver().ReceiveAsync(
            Arrival(second, payload), TestContext.Current.CancellationToken);

        result.Outcome.ShouldBe(IngestionReceiptOutcome.Accepted);
        _queue.Enqueued.Count.ShouldBe(2);
    }

    [Fact]
    public async Task a_one_byte_difference_is_not_a_duplicate()
    {
        var brpId = await SeedBrpAsync(postgres, "RCV7");

        await CreateReceiver().ReceiveAsync(
            Arrival(brpId, Encoding.UTF8.GetBytes("<same/>")), TestContext.Current.CancellationToken);
        var second = await CreateReceiver().ReceiveAsync(
            Arrival(brpId, Encoding.UTF8.GetBytes("<same/> ")), TestContext.Current.CancellationToken);

        second.Outcome.ShouldBe(IngestionReceiptOutcome.Accepted);
    }

    [Fact]
    public async Task the_duplicate_window_is_twenty_four_hours()
    {
        InboundMessageReceiver.DuplicateWindow.ShouldBe(TimeSpan.FromHours(24));
        await Task.CompletedTask;
    }

    /// <summary>A calendar a test can move, so a 24 h window can be crossed in milliseconds.</summary>
    private sealed class MovableCalendar(DateTimeOffset start) : IMarketCalendar
    {
        private DateTimeOffset _now = start;

        public void Advance(TimeSpan by) => _now = _now.Add(by);

        public DateTimeOffset UtcNow => _now;

        public DateOnly TodayInAmsterdam => DateOnly.FromDateTime(_now.UtcDateTime);

        public int ExpectedIntervalCount(DateOnly date) => 96;

        public DateTimeOffset IntervalStart(DateOnly date, int pos) =>
            new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero)
                .AddMinutes(15 * (pos - 1));

        public bool IsDstDuplicate(DateOnly date, int pos) => false;

        public DateOnly AddWorkingDays(DateOnly from, int workingDays) => from.AddDays(workingDays);
    }
}
```

- [ ] **Step 3: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~InboundMessageReceiverTests"
```

Expected: FAIL — build error
`error CS0234: The type or namespace name 'Receipt' does not exist in the namespace 'PeakPower.Ingestion'`.

- [ ] **Step 4: Declare the receipt port and its types**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Receipt/IInboundMessageReceiver.cs`:

```csharp
namespace PeakPower.Ingestion.Receipt;

/// <summary>
/// Everything about one arrival that got past authentication and the size cap.
/// </summary>
/// <param name="HttpHeadersJson">
/// The request headers as a JSON object, for <c>inbound_message.http_headers</c> (jsonb). The
/// credential header is <b>removed by the caller</b> before it reaches here — see
/// <c>BrpWebhookEndpoints</c>.
/// </param>
public sealed record InboundMessageArrival(
    Guid BrpId,
    Guid CorrelationId,
    ReadOnlyMemory<byte> Payload,
    string? HttpHeadersJson,
    string? RemoteIp);

public enum IngestionReceiptOutcome
{
    Accepted,
    Duplicate,
}

/// <summary>
/// What the webhook writes its 200 on. Both outcomes are 200 — shared contract §9.4 — and the
/// distinction is what the row says and whether anything was enqueued.
/// </summary>
public sealed record IngestionReceipt(
    IngestionReceiptOutcome Outcome,
    Guid InboundMessageId,
    Guid CorrelationId);

/// <summary>
/// Stores an arrival durably and enqueues its processing. [F02-R03], [F02-R04], [F02-R07].
/// </summary>
public interface IInboundMessageReceiver
{
    Task<IngestionReceipt> ReceiveAsync(InboundMessageArrival arrival, CancellationToken ct);
}
```

- [ ] **Step 5: Implement the receiver**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Receipt/InboundMessageReceiver.cs`:

```csharp
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Metering;
using PeakPower.Persistence;

namespace PeakPower.Ingestion.Receipt;

/// <summary>
/// The receipt half of the pipeline, in one transaction and one order.
/// </summary>
/// <remarks>
/// <para>
/// <b>Order is the whole of it.</b> Hash; lock on (brp, hash); store the payload; decide duplicate;
/// insert; commit; enqueue. Storing before the row is [F02-R03] — the payload is the evidence in a
/// dispute — and enqueueing after the commit is what stops a worker dequeuing a message id that is
/// not yet visible to it.
/// </para>
/// <para>
/// <b>The duplicate is still stored.</b> [F02-R03] is unconditional: deciding a payload is a
/// duplicate is already looking at it. One extra file per redelivery buys "we have the bytes of
/// everything that arrived" with no exception clause.
/// </para>
/// </remarks>
public sealed class InboundMessageReceiver(
    PeakPowerDbContext db,
    IRawPayloadStore payloads,
    IIngestionJobQueue queue,
    IMarketCalendar calendar) : IInboundMessageReceiver
{
    /// <summary>[F02-R07]. Byte-identical within this window, from the same BRP, is a duplicate.</summary>
    public static readonly TimeSpan DuplicateWindow = TimeSpan.FromHours(24);

    public async Task<IngestionReceipt> ReceiveAsync(
        InboundMessageArrival arrival, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(arrival);

        var receivedAt = calendar.UtcNow;
        var payloadHash = SHA256.HashData(arrival.Payload.Span);

        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        // Serialise concurrent arrivals of the SAME bytes from the SAME BRP. Without it two
        // simultaneous redeliveries both see "no earlier message" and both land RECEIVED, and the
        // pipeline processes the same document twice. There is no unique index to lean on here:
        // payload_hash is deliberately not unique, because the same bytes ARE a new message after
        // 24 h and from another BRP.
        //
        // Transaction-scoped, so it is released by the COMMIT below and never by a forgotten
        // unlock. hashtextextended over a composite string is the same shape the apply stage uses
        // for (metering point, delivery date).
        var lockKey = $"{arrival.BrpId}:{Convert.ToHexString(payloadHash)}";
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({lockKey}, 0))", ct);

        // BEFORE the row, before any parsing, before the 200.
        var payloadUri = await payloads.StoreAsync(
            arrival.BrpId, arrival.CorrelationId, arrival.Payload, ct);

        var since = receivedAt - DuplicateWindow;
        var isDuplicate = await db.InboundMessages
            .AsNoTracking()
            .AnyAsync(
                candidate => candidate.BrpId == arrival.BrpId
                             && candidate.PayloadHash == payloadHash
                             && candidate.ReceivedAt >= since,
                ct);

        var message = InboundMessage.Receive(
            arrival.BrpId,
            arrival.CorrelationId,
            receivedAt,
            payloadHash,
            arrival.Payload.Length,
            payloadUri,
            arrival.HttpHeadersJson,
            arrival.RemoteIp);

        if (!message.IsSuccess)
        {
            // Receive() rejects only structurally impossible input - an empty BRP id, a blank
            // payload_uri - which the caller cannot produce. Throwing turns it into a 500 rather
            // than a silent 200 with nothing stored, which is the right answer for a storage
            // failure under shared contract §9.4.
            throw new InvalidOperationException(
                $"Could not record the inbound message: {message.Error}");
        }

        if (isDuplicate)
        {
            message.Value.MarkDuplicate(receivedAt);
        }

        db.InboundMessages.Add(message.Value);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        if (isDuplicate)
        {
            // [F02-R07]: recorded as a duplicate and NOT reprocessed.
            return new IngestionReceipt(
                IngestionReceiptOutcome.Duplicate, message.Value.Id, arrival.CorrelationId);
        }

        // AFTER the commit. A queue entry that outran the row it points at would be dequeued by a
        // worker that cannot find the message - the exact race the asynchronous shape exists to
        // avoid.
        await queue.EnqueueProcessMessageAsync(message.Value.Id, arrival.CorrelationId, ct);

        return new IngestionReceipt(
            IngestionReceiptOutcome.Accepted, message.Value.Id, arrival.CorrelationId);
    }
}
```

- [ ] **Step 6: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~InboundMessageReceiverTests"
```

Expected: PASS — 8 tests, 0 failed.

- [ ] **Step 7: Verify by mutation — the dedupe window is really twenty-four hours**

**What to break:** change `DuplicateWindow` to `TimeSpan.FromDays(7)`.

**What to predict:** `treats_the_same_bytes_after_24h_as_a_new_message` fails with
`second.Outcome should be Accepted but was Duplicate`, and `_queue.Enqueued.Count should be 2 but was 1`.

**What to watch go red:** that one test. The 23-hour test stays green, which is what makes the pair
meaningful — a window that is merely *non-zero* passes only one of them.

Restore.

- [ ] **Step 8: Verify by mutation — the dedupe is per BRP**

**What to break:** remove `candidate.BrpId == arrival.BrpId` from the `AnyAsync` predicate.

**What to predict:** `does_not_deduplicate_across_two_different_BRPs` fails with
`result.Outcome should be Accepted but was Duplicate`.

**What to watch go red:** that test alone. This is the case the assertion is *for*: a byte-identical
document from a second BRP claiming the same EAN must reach the pipeline and quarantine as
`WRONG_BRP` (`[F02-R42]`) — dropping it as a duplicate hides a master-data conflict an employee
needs to see.

Restore.

- [ ] **Step 9: Verify by mutation — the enqueue is after the commit**

**What to break:** move the `EnqueueProcessMessageAsync` call to immediately before
`transaction.CommitAsync(ct)`.

**What to predict:** nothing fails. `RecordingIngestionJobQueue` does not read the database, so no
existing test can see the difference.

**What to do about it:** that is a hole, and it is the one worth closing, because the real queue
*does* read the database. Add this test, watch it fail against the mutation, restore, watch it pass:

```csharp
    [Fact]
    public async Task the_row_is_visible_to_another_connection_before_anything_is_enqueued()
    {
        // The real queue's worker opens its own connection. A job enqueued inside the transaction
        // can be dequeued before the COMMIT makes the row visible, and the worker then cannot find
        // the message it was told to process. This queue reads the database at enqueue time, on a
        // connection of its own, which is the only way to observe the ordering from a test.
        var brpId = await SeedBrpAsync(postgres, "RCV8");
        var visibility = new VisibilityCheckingQueue(postgres);

        var receiver = new InboundMessageReceiver(
            postgres.CreateContext(),
            new FilesystemRawPayloadStore(new RawPayloadStoreOptions { Root = _root }, _calendar),
            visibility,
            _calendar);

        await receiver.ReceiveAsync(
            Arrival(brpId, Encoding.UTF8.GetBytes("visible")), TestContext.Current.CancellationToken);

        visibility.MessageWasVisible.ShouldBeTrue(
            "the inbound_message row must be committed before the job is enqueued");
    }

    private sealed class VisibilityCheckingQueue(PostgresFixture postgres) : IIngestionJobQueue
    {
        public bool MessageWasVisible { get; private set; }

        public async Task EnqueueProcessMessageAsync(
            Guid inboundMessageId, Guid correlationId, CancellationToken ct)
        {
            await using var other = postgres.CreateContext();
            MessageWasVisible = await other.InboundMessages
                .AsNoTracking()
                .AnyAsync(m => m.Id == inboundMessageId, ct);
        }
    }
```

Add `using PeakPower.Application.Abstractions.Ingestion;` to the test file's usings for
`IIngestionJobQueue`.

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Ingestion/Receipt \
        tests/PeakPower.Integration.Tests/Ingestion/InboundMessageReceiverTests.cs \
        tests/PeakPower.Integration.Tests/Ingestion/RecordingIngestionJobQueue.cs
git commit -m "feat(ingestion): receive, store, deduplicate and enqueue an inbound message

Five steps in one order: hash, advisory lock on (brp, hash), store the payload, decide duplicate,
insert, commit, enqueue. Storing before the row is [F02-R03] - the payload is the evidence - and
enqueueing after the commit is what stops a worker dequeuing an id it cannot yet see.

The 24 h window is mutation-verified from both sides: 23 h is a duplicate, 24 h + 1 s is a new
message, and a seven-day window fails exactly one of the pair. Dedupe is per BRP, verified by
dropping the brp_id predicate and watching the two-BRP case go red - the case that matters, because
a byte-identical document from a second BRP must reach the pipeline and quarantine as WRONG_BRP.

The commit-before-enqueue ordering had no test until a mutation showed the recording queue could
not see it; VisibilityCheckingQueue reads the row on its own connection, which can.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The Worker host and `POST /webhooks/brp/{brpCode}`

The composition root, and the only route this host will ever have. Contract §9.1: served by
`PeakPower.Worker` and by nothing else, **outside `/api/v1`** on purpose — it is not a customer or
employee API, it carries no session, and the Worker's route-table test asserts it exposes no
`/api/v1/**` route at all.

The route handler does five things and delegates the rest:

1. Stamp a correlation id (`Guid.CreateVersion7()`) and put it on the `ILogger` scope and on the
   `X-Correlation-Id` response header — **on every status**, 401 and 413 included.
2. Refuse a body strictly larger than 26 214 400 bytes with 413 (Task 7 covers the boundary).
3. Authenticate through `IBrpWebhookAuthenticator`; anything other than `Authenticated` is 401.
4. Read the body into memory, hand it to `IInboundMessageReceiver`.
5. Answer **200 with an empty body**, for both `Accepted` and `Duplicate`.

⚠ **`.AllowAnonymous()` on this route, and it is not a shortcut.** The host declares a
`FallbackPolicy` that requires an authenticated user, exactly as both API hosts do — so a route
added later and forgotten is 401 rather than open. This route's credential is a header the
authenticator checks itself, so it opts out explicitly, in one line, next to the check that
replaces it.

⚠ **No `AddAuthentication` on this host.** There is no JWT realm here, no cookie, no session. A
`FallbackPolicy` with no authentication scheme registered answers 401 to anything it applies to,
which is precisely the behaviour wanted for every route that is not this one.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/WorkerEntryPoint.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Webhooks/WebhookProblems.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Webhooks/BrpWebhookEndpoints.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Program.cs` (replace whatever plan 1 left)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/WorkerFactory.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/WebhookReceiptTests.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/WebhookCredentialTests.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/WorkerRouteTableTests.cs`

**Interfaces:**
- Consumes: `IInboundMessageReceiver`, `IngestionReceipt` (Task 5); `IBrpWebhookAuthenticator`,
  `BrpWebhookAuthenticator.CredentialHeaderName` (Task 4); `AddServiceDefaults`,
  `MapDefaultEndpoints` (`src/Hosts/PeakPower.ServiceDefaults/Extensions.cs:25`);
  `AddPeakPowerPersistence`, `AddUnscopedCustomerContext`
  (`src/Infrastructure/PeakPower.Persistence/PersistenceServiceCollectionExtensions.cs:14,43`).
- Produces: `PeakPower.Worker.WorkerEntryPoint` · `BrpWebhookEndpoints.MapBrpWebhookEndpoints` ·
  `BrpWebhookEndpoints.RoutePattern` (`"/webhooks/brp/{brpCode}"`) ·
  `BrpWebhookEndpoints.MaximumPayloadBytes` (`26_214_400`) ·
  `BrpWebhookEndpoints.CorrelationIdHeaderName` (`"X-Correlation-Id"`) · `WebhookProblems`.

- [ ] **Step 1: Check what plan 1 left in the Worker project**

Run and read the output before writing anything:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
cat src/Hosts/PeakPower.Worker/PeakPower.Worker.csproj
ls -la src/Hosts/PeakPower.Worker/
```

The `.csproj` must be `Microsoft.NET.Sdk.Web` and must reference, per contract §3.1:
`PeakPower.Ingestion`, `PeakPower.Integration.Brp.Pvned`, `PeakPower.Persistence`,
`PeakPower.Infrastructure.Time`, `PeakPower.ServiceDefaults`. **This is the composition root that
binds the adapter to the port, and the only project that sees both.**

⚠ If `PeakPower.Integration.Brp.Pvned` does not exist yet (plan 4 has not run), leave that
reference out and add it in plan 4. Nothing in this plan needs it — the Worker registers
`RejectingBrpIngestionAdapter` until then.

- [ ] **Step 2: Write the failing test — the route table**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/WorkerRouteTableTests.cs`:

```csharp
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Ingestion.Webhook;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

/// <summary>
/// Design §4.3: the Worker connects as the database owner and is exempt from row-level security by
/// design, because it writes across tenants. That is only safe while it serves no customer-facing
/// route, and this is the assertion that keeps it true.
/// </summary>
public sealed class WorkerRouteTableTests(WorkerFactory factory) : IClassFixture<WorkerFactory>
{
    private IReadOnlyList<string> Patterns()
    {
        using var scope = factory.Services.CreateScope();
        var source = scope.ServiceProvider.GetRequiredService<EndpointDataSource>();

        return
        [
            .. source.Endpoints
                .OfType<RouteEndpoint>()
                .Select(endpoint => "/" + (endpoint.RoutePattern.RawText ?? string.Empty).TrimStart('/'))
                .Distinct(StringComparer.Ordinal)
                .OrderBy(pattern => pattern, StringComparer.Ordinal),
        ];
    }

    [Fact]
    public void the_worker_exposes_no_api_v1_route_at_all()
    {
        // Not "no route that looks customer-facing" - none, at all. The owner connection bypasses
        // RLS, so a single /api/v1 route on this host would answer with every tenant's data and
        // neither tenancy layer would be in the way.
        foreach (var pattern in Patterns())
        {
            pattern.StartsWith("/api/v1", StringComparison.OrdinalIgnoreCase).ShouldBeFalse(
                $"the Worker must expose no /api/v1 route; found {pattern}");
        }
    }

    [Fact]
    public void the_worker_exposes_exactly_the_webhook_plus_the_framework_endpoints()
    {
        // Pinned to a computed set rather than a floor. `count > 0` passes when a discovery query
        // silently returns the wrong set, and a route added by accident is exactly the thing this
        // is here to catch.
        Patterns().ShouldBe(["/alive", "/health", BrpWebhookEndpoints.RoutePattern]);
    }

    [Fact]
    public void the_webhook_route_pattern_is_the_one_the_contract_freezes()
    {
        BrpWebhookEndpoints.RoutePattern.ShouldBe("/webhooks/brp/{brpCode}");
        BrpWebhookEndpoints.MaximumPayloadBytes.ShouldBe(26_214_400);
        BrpWebhookEndpoints.CorrelationIdHeaderName.ShouldBe("X-Correlation-Id");
        BrpWebhookAuthenticator.CredentialHeaderName.ShouldBe("X-PeakPower-Brp-Credential");
    }
}
```

- [ ] **Step 3: Write the Worker test factory**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/WorkerFactory.cs`:

```csharp
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Ingestion.Storage;
using PeakPower.Ingestion.Webhook;
using PeakPower.Persistence;
using PeakPower.Infrastructure.Web.Tenancy;
using Testcontainers.PostgreSql;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

/// <summary>
/// The real Worker host bound to a throwaway PostgreSQL 17 container, connecting as the container
/// owner — which is what the deployed Worker does (design §4.3).
/// </summary>
/// <remarks>
/// The credential source and the job queue are replaced, and nothing else is.
/// <see cref="StubCredentialSource"/> keeps <c>BRP_CREDENTIAL_&lt;CODE&gt;</c> out of the process
/// environment, which is shared by every test in the assembly;
/// <see cref="RecordingIngestionJobQueue"/> keeps the 200-before-processing assertion from
/// depending on scheduler timing. The authenticator, the receiver, the payload store, the registry
/// and the route are the production ones.
/// </remarks>
public sealed class WorkerFactory : WebApplicationFactory<PeakPower.Worker.WorkerEntryPoint>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17")
        .WithDatabase("peakpower")
        .WithUsername("peakpower_owner")
        .WithPassword("peakpower")
        .Build();

    public string RawPayloadRoot { get; } =
        Path.Combine(Path.GetTempPath(), "pp-raw-payloads", Guid.NewGuid().ToString("N"));

    public string ConnectionString => _postgres.GetConnectionString();

    /// <summary>The credentials this host will accept, keyed by environment-variable name.</summary>
    public StubCredentialSource Credentials { get; } = new();

    /// <summary>Every enqueue the receipt path made. Nothing runs them.</summary>
    public RecordingIngestionJobQueue Queue { get; } = new();

    /// <summary>Extra adapters a test wants registered beside the rejecting default.</summary>
    public List<IBrpIngestionAdapter> ExtraAdapters { get; } = [];

    public async ValueTask InitializeAsync()
    {
        await _postgres.StartAsync();

        await using var db = CreateOwnerDbContext();
        await db.Database.MigrateAsync();
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await _postgres.DisposeAsync();

        if (Directory.Exists(RawPayloadRoot))
        {
            Directory.Delete(RawPayloadRoot, recursive: true);
        }
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(Environments.Development);
        builder.UseSetting("ConnectionStrings:peakpower", ConnectionString);
        builder.UseSetting(RawPayloadStoreOptions.RootEnvironmentVariable, RawPayloadRoot);

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IBrpCredentialSource>();
            services.AddSingleton<IBrpCredentialSource>(Credentials);

            services.RemoveAll<IIngestionJobQueue>();
            services.AddSingleton<IIngestionJobQueue>(Queue);

            foreach (var adapter in ExtraAdapters)
            {
                services.AddSingleton(adapter);
            }
        });
    }

    public HttpClient CreateWebhookClient() =>
        CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    /// <summary>A context on the owner role, for arranging and asserting.</summary>
    public PeakPowerDbContext CreateOwnerDbContext()
    {
        var options = new DbContextOptionsBuilder<PeakPowerDbContext>();
        PersistenceServiceCollectionExtensions.ConfigureDbContext(options, ConnectionString);
        return new PeakPowerDbContext(options.Options, new UnscopedCustomerContext());
    }

    public sealed class StubCredentialSource : IBrpCredentialSource
    {
        private readonly Dictionary<string, string?> _values = new(StringComparer.Ordinal);

        public void Set(string environmentVariableName, string? value) =>
            _values[environmentVariableName] = value;

        public string? Read(string environmentVariableName) =>
            _values.TryGetValue(environmentVariableName, out var value) ? value : null;
    }
}
```

⚠ `RawPayloadStoreOptions.RootEnvironmentVariable` is used as a **configuration key** here, not as
a process environment variable. `WebApplicationFactory` cannot set process environment variables
per host, and `builder.UseSetting` feeds the same `IConfiguration` that
`Environment.GetEnvironmentVariable` would otherwise reach through the environment-variables
provider. Program.cs must therefore read the root through `builder.Configuration`, not through
`Environment.GetEnvironmentVariable` — that is the one place the two differ, and Step 5 does it.

- [ ] **Step 4: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~WorkerRouteTableTests"
```

Expected: FAIL — build error
`error CS0234: The type or namespace name 'WorkerEntryPoint' does not exist in the namespace 'PeakPower.Worker'`
(or, if plan 1 wrote the marker, a runtime failure on the missing `EndpointDataSource` entry with
`Patterns() should be ["/alive", "/health", "/webhooks/brp/{brpCode}"] but was ["/alive", "/health"]`).

- [ ] **Step 5: Write the host entry-point marker**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/WorkerEntryPoint.cs`:

```csharp
namespace PeakPower.Worker;

/// <summary>
/// The anchor <c>WebApplicationFactory&lt;WorkerEntryPoint&gt;</c> boots this host from.
/// </summary>
/// <remarks>
/// Slice 1's rule stands and is repeated here because it is easy to undo: <b>no host declares
/// <c>public partial class Program</c></b>. A named marker keeps the implicit entry point private
/// and keeps <c>Program</c> from becoming a public type three test projects reach into.
/// </remarks>
public sealed class WorkerEntryPoint;
```

- [ ] **Step 6: Write the problem bodies**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Webhooks/WebhookProblems.cs`:

```csharp
using Microsoft.AspNetCore.Http;

namespace PeakPower.Worker.Webhooks;

/// <summary>
/// The three RFC 7807 bodies this host can answer with, as constants.
/// </summary>
/// <remarks>
/// Constants rather than inline strings because a BRP integrating against this endpoint reads
/// <c>type</c> to branch on, and the 401 body in particular must be <b>byte-identical</b> whether
/// the credential was wrong, missing, for an unknown code or for a deactivated BRP — shared
/// contract §9.4. Two hand-written 401s drift; one constant cannot.
/// </remarks>
public static class WebhookProblems
{
    public const string UnauthorizedType = "https://peakpower.dev/problems/brp-unauthorized";
    public const string UnauthorizedTitle = "Unauthorized";
    public const string UnauthorizedDetail =
        "The request did not present a valid credential for this BRP endpoint.";

    public const string PayloadTooLargeType = "https://peakpower.dev/problems/payload-too-large";
    public const string PayloadTooLargeTitle = "Payload too large";
    public const string PayloadTooLargeDetail =
        "The payload exceeds the 26214400-byte limit this endpoint accepts.";

    public const string StorageFailureType = "https://peakpower.dev/problems/storage-failure";
    public const string StorageFailureTitle = "The payload could not be stored";
    public const string StorageFailureDetail =
        "The payload could not be stored durably. Nothing was recorded; the message may be resent.";

    public static IResult Unauthorized() => TypedResults.Problem(
        detail: UnauthorizedDetail,
        statusCode: StatusCodes.Status401Unauthorized,
        title: UnauthorizedTitle,
        type: UnauthorizedType);

    public static IResult PayloadTooLarge() => TypedResults.Problem(
        detail: PayloadTooLargeDetail,
        statusCode: StatusCodes.Status413PayloadTooLarge,
        title: PayloadTooLargeTitle,
        type: PayloadTooLargeType);

    public static IResult StorageFailure() => TypedResults.Problem(
        detail: StorageFailureDetail,
        statusCode: StatusCodes.Status500InternalServerError,
        title: StorageFailureTitle,
        type: StorageFailureType);
}
```

- [ ] **Step 7: Write the endpoint**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Webhooks/BrpWebhookEndpoints.cs`:

```csharp
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging;
using PeakPower.Ingestion.Receipt;
using PeakPower.Ingestion.Webhook;

namespace PeakPower.Worker.Webhooks;

/// <summary>
/// <c>POST /webhooks/brp/{brpCode}</c> — the one route this host has. Shared contract §9.
/// </summary>
public static class BrpWebhookEndpoints
{
    /// <summary>Shared contract §9.1. Outside <c>/api/v1</c> on purpose.</summary>
    public const string RoutePattern = "/webhooks/brp/{brpCode}";

    /// <summary>
    /// 25 MiB, and the comparison is <b>strictly greater than</b>: exactly 26 214 400 bytes is
    /// accepted, 26 214 401 is refused. [F02-R06]; design §7.3 pins both sides and DevStubs
    /// generates both documents.
    /// </summary>
    public const int MaximumPayloadBytes = 26_214_400;

    /// <summary>Returned on every status, 401 and 413 included. Shared contract §9.5.</summary>
    public const string CorrelationIdHeaderName = "X-Correlation-Id";

    public static IEndpointRouteBuilder MapBrpWebhookEndpoints(this IEndpointRouteBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.MapPost(RoutePattern, HandleAsync)
            .WithName("ReceiveBrpDocument")
            .WithSummary("Receives one document from a configured balance responsible party.")
            // The credential is the X-PeakPower-Brp-Credential header, checked by
            // IBrpWebhookAuthenticator below. This host's FallbackPolicy denies by default and
            // registers no authentication scheme, so without this line the route answers 401 to
            // everything - including a correctly credentialled BRP. Opting out is written down,
            // next to the check that replaces it.
            .AllowAnonymous()
            // The framework's own limit would answer 413 with an empty body and no correlation id,
            // before the handler runs. Disabling it here moves the decision into the handler,
            // where the id is already stamped and the RFC 7807 body is the one the contract names.
            .DisableRequestSizeLimit()
            .Produces(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge)
            .ProducesProblem(StatusCodes.Status500InternalServerError);

        return app;
    }

    private static async Task<IResult> HandleAsync(
        string brpCode,
        HttpContext context,
        IBrpWebhookAuthenticator authenticator,
        IInboundMessageReceiver receiver,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        var logger = loggerFactory.CreateLogger("PeakPower.Worker.BrpWebhook");

        // Stamped HERE, at receipt, before anything can fail. Shared contract §9.5: in scope
        // because retrofitting one across an async hop later rewrites every log line.
        var correlationId = Guid.CreateVersion7();
        context.Response.Headers[CorrelationIdHeaderName] = correlationId.ToString();

        using var scope = logger.BeginScope(new Dictionary<string, object>
        {
            ["CorrelationId"] = correlationId,
            ["BrpCode"] = brpCode,
        });

        // Cheap refusal first, on the declared length, so a 26 MB body is never read into memory.
        if (context.Request.ContentLength is > MaximumPayloadBytes)
        {
            logger.LogWarning(
                "Refused a BRP document of {Bytes} declared bytes; the limit is {Limit}.",
                context.Request.ContentLength, MaximumPayloadBytes);
            return WebhookProblems.PayloadTooLarge();
        }

        var authentication = await authenticator.AuthenticateAsync(
            brpCode, context.Request.Headers[BrpWebhookAuthenticator.CredentialHeaderName], ct);

        if (authentication.Outcome != BrpAuthenticationOutcome.Authenticated)
        {
            // One answer for a wrong credential, a missing one, an unknown code and a deactivated
            // BRP. The log line says no more than the response does, for the same reason.
            logger.LogWarning("Refused an unauthenticated BRP webhook request.");
            return WebhookProblems.Unauthorized();
        }

        // A chunked request declares no Content-Length, so the limit has to hold on the stream as
        // well. ReadAtLeastAsync stops at the first byte past the cap rather than buffering an
        // unbounded body to find out how big it was.
        var body = await ReadBodyAsync(context.Request.Body, MaximumPayloadBytes, ct);
        if (body is null)
        {
            logger.LogWarning(
                "Refused a BRP document whose streamed body exceeded {Limit} bytes.",
                MaximumPayloadBytes);
            return WebhookProblems.PayloadTooLarge();
        }

        var arrival = new InboundMessageArrival(
            authentication.BrpId,
            correlationId,
            body.Value,
            SerialiseHeaders(context.Request),
            context.Connection.RemoteIpAddress?.ToString());

        IngestionReceipt receipt;
        try
        {
            receipt = await receiver.ReceiveAsync(arrival, ct);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Shared contract §9.4: 500 is for a STORAGE failure - the raw store or the database -
            // and for nothing else. Once the payload is stored no processing failure may produce a
            // non-2xx [F02-R05], and nothing downstream of this call runs inside the request.
            logger.LogError(exception, "Failed to store an inbound BRP document.");
            return WebhookProblems.StorageFailure();
        }

        // 200 for BOTH outcomes. [F02-R04]: the endpoint responds as soon as the payload is
        // durably stored - before business processing - and at this moment inbound_message.status
        // is RECEIVED (or DUPLICATE), never PROCESSED.
        logger.LogInformation(
            "Stored inbound BRP document {MessageId} as {Outcome}.",
            receipt.InboundMessageId, receipt.Outcome);

        return Results.Ok();
    }

    /// <summary>
    /// Reads the whole body, or returns <c>null</c> when it is strictly larger than
    /// <paramref name="limit"/>.
    /// </summary>
    private static async Task<ReadOnlyMemory<byte>?> ReadBodyAsync(
        Stream body, int limit, CancellationToken ct)
    {
        // limit + 1 bytes. Reading exactly `limit` cannot distinguish "exactly at the cap" from
        // "over it", and design §7.3 pins both sides of that boundary.
        var buffer = new byte[limit + 1];
        var read = 0;

        while (read < buffer.Length)
        {
            var chunk = await body.ReadAsync(buffer.AsMemory(read), ct);
            if (chunk == 0)
            {
                break;
            }

            read += chunk;
        }

        return read > limit ? null : buffer.AsMemory(0, read);
    }

    /// <summary>
    /// The request headers as a JSON object for <c>inbound_message.http_headers</c>.
    /// </summary>
    /// <remarks>
    /// ⚠ The credential header is <b>dropped</b>. [F02-R03] wants the headers as evidence, and a
    /// shared secret written into a jsonb column is a secret in the database, in every backup, and
    /// on the employee data-health screen that renders the message.
    /// </remarks>
    private static string SerialiseHeaders(HttpRequest request)
    {
        var headers = request.Headers
            .Where(header => !string.Equals(
                header.Key, BrpWebhookAuthenticator.CredentialHeaderName, StringComparison.OrdinalIgnoreCase))
            .ToDictionary(header => header.Key, header => header.Value.ToArray(), StringComparer.Ordinal);

        return JsonSerializer.Serialize(headers);
    }
}
```

- [ ] **Step 8: Write the composition root**

Replace `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Program.cs`
entirely:

```csharp
using Microsoft.AspNetCore.Authorization;
using PeakPower.Ingestion;
using PeakPower.Persistence;
using PeakPower.ServiceDefaults;
using PeakPower.Worker.Webhooks;

var builder = WebApplication.CreateBuilder(args);

builder.AddServiceDefaults();

// ---------------------------------------------------------------------------------------------
// Database.
//
// The Worker connects as the database OWNER and is exempt from row-level security by design
// (design §4.3): it writes across tenants - one document can carry series for several customers -
// and it serves no customer-facing route. WorkerRouteTableTests is what keeps the second half of
// that sentence true, and it is the only thing that does.
//
// AddUnscopedCustomerContext, exactly as PeakPower.Migrator does
// (src/Hosts/PeakPower.Migrator/Program.cs:35). Without it AddPeakPowerPersistence's
// ThrowingCustomerContext default makes every read through a filtered DbSet - MeteringPoint above
// all - throw rather than run unfiltered, and this host reads MeteringPoint on every applied
// series.
// ---------------------------------------------------------------------------------------------
var connectionString = builder.Configuration.GetConnectionString("peakpower");
if (string.IsNullOrWhiteSpace(connectionString))
{
    Console.Error.WriteLine(
        "The connection string named 'peakpower' is not configured.\n"
        + "  Inside Aspire it arrives through WithReference(peakpowerDb).\n"
        + "  Outside Aspire, set ConnectionStrings__peakpower.");
    return 1;
}

builder.Services.AddPeakPowerPersistence(connectionString);
builder.Services.AddUnscopedCustomerContext();

// Everything in this plan: the adapter registry, the raw-payload store, the authenticator, the
// receiver and the processing handler. One call, so a second host that ever needs the pipeline
// asks for it the same way and cannot get half of it.
builder.Services.AddPeakPowerIngestion(builder.Configuration);

builder.Services.AddProblemDetails();

// ---------------------------------------------------------------------------------------------
// DEFAULT DENY, the same posture both API hosts carry.
//
// No authentication scheme is registered on this host - there is no JWT realm here, no cookie and
// no session - so this fallback answers 401 to every endpoint that does not opt out. That is the
// wanted behaviour for every route except the webhook, whose credential is a header
// IBrpWebhookAuthenticator checks itself and which therefore carries .AllowAnonymous() at its own
// call site. /health and /alive opt out inside ServiceDefaults.MapDefaultEndpoints.
//
// The employee host lost eleven back-office endpoints to the absence of exactly this line. This
// host has one route today; the point of the policy is the route somebody adds in six months.
// ---------------------------------------------------------------------------------------------
builder.Services.AddAuthorization(options =>
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build());

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();

// No UseAuthentication(): nothing here authenticates a principal. UseAuthorization() is still
// needed for the fallback policy above to be applied at all.
app.UseAuthorization();

app.MapBrpWebhookEndpoints();
app.MapDefaultEndpoints();

app.Run();
return 0;
```

⚠ `AddPeakPowerIngestion` does not exist yet — Task 17 writes it. Until then, to keep this task's
tests runnable, add the registrations inline **and delete them in Task 17**:

```csharp
// TEMPORARY, replaced by AddPeakPowerIngestion in Task 17.
builder.Services.AddScoped<PeakPower.Ingestion.Webhook.IBrpCredentialSource,
    PeakPower.Ingestion.Webhook.EnvironmentBrpCredentialSource>();
builder.Services.AddScoped<PeakPower.Ingestion.Webhook.IBrpWebhookAuthenticator,
    PeakPower.Ingestion.Webhook.BrpWebhookAuthenticator>();
builder.Services.AddSingleton(new PeakPower.Ingestion.Storage.RawPayloadStoreOptions
{
    Root = builder.Configuration[PeakPower.Ingestion.Storage.RawPayloadStoreOptions.RootEnvironmentVariable]
           ?? PeakPower.Ingestion.Storage.RawPayloadStoreOptions.DefaultRoot,
});
builder.Services.AddScoped<PeakPower.Application.Abstractions.Ingestion.IRawPayloadStore,
    PeakPower.Ingestion.Storage.FilesystemRawPayloadStore>();
builder.Services.AddScoped<PeakPower.Ingestion.Receipt.IInboundMessageReceiver,
    PeakPower.Ingestion.Receipt.InboundMessageReceiver>();
```

⚠ **Read the root from `builder.Configuration`, not from `Environment.GetEnvironmentVariable`.**
The configuration builder already reads process environment variables, so `RAW_PAYLOAD_ROOT` set in
the container arrives either way — and a test host can set it through `UseSetting`, which the
environment API cannot see. One line, and it is the difference between a testable host and one that
needs a process-wide mutation to boot.

- [ ] **Step 9: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~WorkerRouteTableTests"
```

Expected: PASS — 3 tests, 0 failed.

- [ ] **Step 10: Write the receipt tests over HTTP**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/WebhookReceiptTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Webhook;
using PeakPower.Worker.Webhooks;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

public sealed class WebhookReceiptTests(WorkerFactory factory) : IClassFixture<WorkerFactory>
{
    private const string Credential = "the-configured-secret";

    private async Task<(Guid BrpId, string Code)> SeedBrpAsync(string code)
    {
        await using var db = factory.CreateOwnerDbContext();
        var brp = Brp.Create(code, $"{code} B.V.", isActive: true).Value;
        db.Brps.Add(brp);
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);

        factory.Credentials.Set(brp.CredentialRef, Credential);
        return (brp.Id, brp.Code);
    }

    private static HttpRequestMessage Post(string code, byte[] payload, string? credential = Credential)
    {
        var request = new HttpRequestMessage(
            HttpMethod.Post, $"/webhooks/brp/{code}")
        {
            Content = new ByteArrayContent(payload),
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/soap+xml");

        if (credential is not null)
        {
            request.Headers.Add(BrpWebhookAuthenticator.CredentialHeaderName, credential);
        }

        return request;
    }

    [Fact]
    public async Task answers_200_with_an_empty_body_for_arbitrary_bytes()
    {
        // ARBITRARY bytes. Design step 4: [F02-R03]..[F02-R07] must pass before a line of XML is
        // parsed, and the only adapter registered at this point rejects everything.
        var (_, code) = await SeedBrpAsync("WRC1");
        using var client = factory.CreateWebhookClient();

        using var response = await client.SendAsync(
            Post(code, [0x00, 0xFF, 0x42]), TestContext.Current.CancellationToken);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken))
            .ShouldBeEmpty();
    }

    [Fact]
    public async Task the_message_is_RECEIVED_and_not_PROCESSED_at_the_moment_the_200_is_written()
    {
        // Design §7.2, and it is asserted AT THAT MOMENT rather than afterwards: nothing has run
        // the job, because WorkerFactory's queue only records. A host that processed inline would
        // pass an "eventually RECEIVED" assertion and fail this one.
        var (brpId, code) = await SeedBrpAsync("WRC2");
        var payload = Encoding.UTF8.GetBytes("<evidence/>");
        using var client = factory.CreateWebhookClient();

        using var response = await client.SendAsync(
            Post(code, payload), TestContext.Current.CancellationToken);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        await using var db = factory.CreateOwnerDbContext();
        var stored = await db.InboundMessages.AsNoTracking()
            .SingleAsync(m => m.BrpId == brpId, TestContext.Current.CancellationToken);

        stored.Status.ShouldBe(InboundMessageStatus.Received);
        stored.ProcessedAt.ShouldBeNull();
        stored.PayloadBytes.ShouldBe(payload.Length);
        stored.PayloadHash.ShouldBe(SHA256.HashData(payload));
    }

    [Fact]
    public async Task stores_the_headers_the_source_ip_and_the_receiving_brp()
    {
        var (brpId, code) = await SeedBrpAsync("WRC3");
        using var client = factory.CreateWebhookClient();

        using var response = await client.SendAsync(
            Post(code, Encoding.UTF8.GetBytes("<x/>")), TestContext.Current.CancellationToken);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        await using var db = factory.CreateOwnerDbContext();
        var stored = await db.InboundMessages.AsNoTracking()
            .SingleAsync(m => m.BrpId == brpId, TestContext.Current.CancellationToken);

        stored.HttpHeaders.ShouldNotBeNull();
        stored.HttpHeaders.ShouldContain("Content-Type", Case.Sensitive);
        stored.BrpId.ShouldBe(brpId);
    }

    [Fact]
    public async Task never_writes_the_credential_header_into_the_stored_headers()
    {
        // [F02-R03] wants the headers as evidence. A shared secret in a jsonb column is a secret
        // in the database, in every backup, and on the employee screen that renders the message.
        var (brpId, code) = await SeedBrpAsync("WRC4");
        using var client = factory.CreateWebhookClient();

        using var response = await client.SendAsync(
            Post(code, Encoding.UTF8.GetBytes("<x/>")), TestContext.Current.CancellationToken);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        await using var db = factory.CreateOwnerDbContext();
        var stored = await db.InboundMessages.AsNoTracking()
            .SingleAsync(m => m.BrpId == brpId, TestContext.Current.CancellationToken);

        stored.HttpHeaders!.ShouldNotContain(Credential, Case.Sensitive);
        stored.HttpHeaders.ShouldNotContain(
            BrpWebhookAuthenticator.CredentialHeaderName, Case.Sensitive);
    }

    [Fact]
    public async Task returns_the_correlation_id_it_stored_on_the_row()
    {
        var (brpId, code) = await SeedBrpAsync("WRC5");
        using var client = factory.CreateWebhookClient();

        using var response = await client.SendAsync(
            Post(code, Encoding.UTF8.GetBytes("<x/>")), TestContext.Current.CancellationToken);

        var header = response.Headers.GetValues(BrpWebhookEndpoints.CorrelationIdHeaderName).Single();

        await using var db = factory.CreateOwnerDbContext();
        var stored = await db.InboundMessages.AsNoTracking()
            .SingleAsync(m => m.BrpId == brpId, TestContext.Current.CancellationToken);

        // The SAME id, not merely a well-formed one. A header generated independently of the row
        // is worse than no header: it looks like a way to find the message and is not.
        Guid.Parse(header).ShouldBe(stored.CorrelationId);
    }

    [Fact]
    public async Task enqueues_the_stored_message_and_its_correlation_id()
    {
        var (brpId, code) = await SeedBrpAsync("WRC6");
        var before = factory.Queue.Enqueued.Count;
        using var client = factory.CreateWebhookClient();

        using var response = await client.SendAsync(
            Post(code, Encoding.UTF8.GetBytes("<x/>")), TestContext.Current.CancellationToken);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        await using var db = factory.CreateOwnerDbContext();
        var stored = await db.InboundMessages.AsNoTracking()
            .SingleAsync(m => m.BrpId == brpId, TestContext.Current.CancellationToken);

        var enqueued = factory.Queue.Enqueued.Skip(before).Single();
        enqueued.InboundMessageId.ShouldBe(stored.Id);
        enqueued.CorrelationId.ShouldBe(stored.CorrelationId);
    }

    [Fact]
    public async Task answers_a_correlation_id_on_a_401_too()
    {
        // The id is stamped at receipt, before anything can fail, so a BRP whose credential is
        // wrong still gets an id to quote when it asks why.
        using var client = factory.CreateWebhookClient();

        using var response = await client.SendAsync(
            Post("PVNED", [0x01], credential: "wrong"), TestContext.Current.CancellationToken);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        Guid.TryParse(
            response.Headers.GetValues(BrpWebhookEndpoints.CorrelationIdHeaderName).Single(),
            out _).ShouldBeTrue();
    }
}
```

- [ ] **Step 11: Write the 401 matrix**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/WebhookCredentialTests.cs`:

```csharp
using System.Net;
using System.Text;
using Microsoft.EntityFrameworkCore;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Webhook;
using PeakPower.Worker.Webhooks;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

public sealed class WebhookCredentialTests(WorkerFactory factory) : IClassFixture<WorkerFactory>
{
    private const string Credential = "the-configured-secret";

    private async Task<string> SeedBrpAsync(string code, bool isActive, string? credential)
    {
        await using var db = factory.CreateOwnerDbContext();
        var brp = Brp.Create(code, $"{code} B.V.", isActive).Value;
        db.Brps.Add(brp);
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);

        factory.Credentials.Set(brp.CredentialRef, credential);
        return brp.Code;
    }

    private async Task<HttpResponseMessage> PostAsync(string code, string? credential)
    {
        using var client = factory.CreateWebhookClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/webhooks/brp/{code}")
        {
            Content = new ByteArrayContent(Encoding.UTF8.GetBytes("<x/>")),
        };

        if (credential is not null)
        {
            request.Headers.Add(BrpWebhookAuthenticator.CredentialHeaderName, credential);
        }

        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task a_missing_credential_header_is_401()
    {
        var code = await SeedBrpAsync("WCR1", isActive: true, credential: Credential);

        using var response = await PostAsync(code, credential: null);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task a_wrong_credential_is_401()
    {
        var code = await SeedBrpAsync("WCR2", isActive: true, credential: Credential);

        using var response = await PostAsync(code, "not-the-secret");

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task an_unknown_brp_code_is_401_and_NOT_404()
    {
        // Shared contract §9.4. A 404 here turns the endpoint into a way to enumerate which BRPs
        // the platform is configured for, from outside, with no credential.
        using var response = await PostAsync("NOSUCHBRP", Credential);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        response.StatusCode.ShouldNotBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task a_deactivated_brp_is_401()
    {
        var code = await SeedBrpAsync("WCR3", isActive: false, credential: Credential);

        using var response = await PostAsync(code, Credential);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task an_unset_credential_variable_refuses_every_request()
    {
        var code = await SeedBrpAsync("WCR4", isActive: true, credential: null);

        using var response = await PostAsync(code, Credential);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task all_four_rejections_answer_a_byte_identical_body()
    {
        var configured = await SeedBrpAsync("WCR5", isActive: true, credential: Credential);
        var deactivated = await SeedBrpAsync("WCR6", isActive: false, credential: Credential);

        using var missing = await PostAsync(configured, credential: null);
        using var wrong = await PostAsync(configured, "not-the-secret");
        using var unknown = await PostAsync("NOSUCHBRP", Credential);
        using var inactive = await PostAsync(deactivated, Credential);

        var bodies = new List<string>();
        foreach (var response in new[] { missing, wrong, unknown, inactive })
        {
            bodies.Add(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        }

        // Not "all 401" - byte-identical. A body that named the reason would leak, through a
        // response, exactly the fact the 401-not-404 rule refuses to leak through a status code.
        bodies.Distinct(StringComparer.Ordinal).Count().ShouldBe(1);
        bodies[0].ShouldContain(WebhookProblems.UnauthorizedType, Case.Sensitive);
    }

    [Fact]
    public async Task nothing_is_stored_for_a_rejected_request()
    {
        // [F02-R03] persists the payload of a request that got PAST authentication. A 401 must
        // leave no row and no file, or an unauthenticated caller can fill the volume.
        await using var db = factory.CreateOwnerDbContext();
        var before = await db.InboundMessages.CountAsync(TestContext.Current.CancellationToken);

        using var response = await PostAsync("NOSUCHBRP", Credential);
        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);

        await using var after = factory.CreateOwnerDbContext();
        (await after.InboundMessages.CountAsync(TestContext.Current.CancellationToken))
            .ShouldBe(before);
    }
}
```

- [ ] **Step 12: Run them and watch them pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~WebhookReceiptTests|FullyQualifiedName~WebhookCredentialTests|FullyQualifiedName~WorkerRouteTableTests"
```

Expected: PASS — 17 tests, 0 failed.

- [ ] **Step 13: Verify by mutation — the 200 really precedes processing**

**What to break:** in `BrpWebhookEndpoints.HandleAsync`, after `receiver.ReceiveAsync`, add

```csharp
        await context.RequestServices
            .GetRequiredService<PeakPower.Application.Abstractions.Ingestion.IProcessInboundMessageHandler>()
            .HandleAsync(receipt.InboundMessageId, correlationId, ct);
```

(and the `using Microsoft.Extensions.DependencyInjection;` it needs).

**What to predict:** `the_message_is_RECEIVED_and_not_PROCESSED_at_the_moment_the_200_is_written`
fails with `stored.Status should be Received but was Processed` — or, before Task 10 exists, with
`InvalidOperationException: No service for type 'IProcessInboundMessageHandler'`, which is not the
failure predicted and therefore not evidence. If that is what happens, defer this mutation to
Task 10 and record that it was deferred.

**What to watch go red:** that single assertion. `[F02-R04]`/`[F02-R05]` are what stop a parser bug
becoming a redelivery flood, and a host that processed inline would answer 500 on a malformed
document — the exact behaviour the design calls structural rather than an optimisation.

Restore.

- [ ] **Step 14: Verify by mutation — the credential header is really stripped**

**What to break:** in `SerialiseHeaders`, drop the `.Where(...)` clause.

**What to predict:** `never_writes_the_credential_header_into_the_stored_headers` fails on
`stored.HttpHeaders!.ShouldNotContain(Credential, Case.Sensitive)`.

**What to watch go red:** that one. ⚠ Note the `Case.Sensitive` argument: Shouldly's
`ShouldNotContain` is case-**in**sensitive by default, and this repository has had three tests
silently broken by that default. Without the argument the assertion is weaker than it reads.

Restore.

- [ ] **Step 15: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Worker \
        tests/PeakPower.Integration.Tests/Ingestion/WorkerFactory.cs \
        tests/PeakPower.Integration.Tests/Ingestion/WebhookReceiptTests.cs \
        tests/PeakPower.Integration.Tests/Ingestion/WebhookCredentialTests.cs \
        tests/PeakPower.Integration.Tests/Ingestion/WorkerRouteTableTests.cs
git commit -m "feat(worker): map POST /webhooks/brp/{brpCode}, the only route this host has

Shared contract §9. 200 with an empty body as soon as the payload is durably stored, with
inbound_message.status RECEIVED at that moment - asserted AT that moment, because the test queue
only records and nothing has run the job. Mutation-verified by processing inline and watching the
status read PROCESSED.

One byte-identical 401 for a missing credential, a wrong one, an unknown code and a deactivated
BRP, asserted by comparing the four bodies rather than the four status codes - a body that named
the reason would leak through a response exactly what 401-not-404 refuses to leak through a status.

The credential header is stripped from the stored headers; mutation-verified with an explicitly
case-sensitive assertion, because Shouldly's default would have made the check weaker than it reads.

WorkerRouteTableTests pins the route set to a computed list: the Worker connects as the database
owner and is exempt from RLS, which is only safe while it serves no /api/v1 route.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The 25 MiB boundary — exactly at the cap is accepted

`[F02-R06]`, and design §7.3 pins **both** sides: exactly 26 214 400 bytes is accepted, 26 214 401
is refused with 413. DevStubs generates both documents (contract §13.1, scenario 14), so a plan
that got the comparison inclusive would be caught in plan 5 — three plans later, in a suite that
takes minutes.

⚠ **The cap must hold on the stream as well as on `Content-Length`.** A chunked request declares no
length. `HttpClient` sends `Content-Length` for a `ByteArrayContent` and chunked for a
`StreamContent` over a non-seekable stream, so the two tests below genuinely exercise the two
paths.

⚠ **`.DisableRequestSizeLimit()` is already on the route** (Task 6). Kestrel's default
`MaxRequestBodySize` is 30 000 000 bytes — larger than this cap, so it would not fire first — but
it answers a bare 413 with no correlation id and no RFC 7807 body, and `WebApplicationFactory`'s
`TestServer` applies its own limit differently again. Disabling it moves the decision to one place
that behaves identically under both servers.

**Files:**
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/WebhookSizeLimitTests.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Webhooks/BrpWebhookEndpoints.cs` (only if the boundary is wrong)

**Interfaces:**
- Consumes: `BrpWebhookEndpoints.MaximumPayloadBytes`, `WorkerFactory` (Task 6).
- Produces: nothing new. This task proves a constant and a comparison.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/WebhookSizeLimitTests.cs`:

```csharp
using System.Net;
using Microsoft.EntityFrameworkCore;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Webhook;
using PeakPower.Worker.Webhooks;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

public sealed class WebhookSizeLimitTests(WorkerFactory factory) : IClassFixture<WorkerFactory>
{
    private const string Credential = "the-configured-secret";

    private async Task<string> SeedBrpAsync(string code)
    {
        await using var db = factory.CreateOwnerDbContext();
        var brp = Brp.Create(code, $"{code} B.V.", isActive: true).Value;
        db.Brps.Add(brp);
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);

        factory.Credentials.Set(brp.CredentialRef, Credential);
        return brp.Code;
    }

    private async Task<HttpResponseMessage> PostAsync(string code, HttpContent content)
    {
        using var client = factory.CreateWebhookClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/webhooks/brp/{code}")
        {
            Content = content,
        };
        request.Headers.Add(BrpWebhookAuthenticator.CredentialHeaderName, Credential);

        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    [Fact]
    public void the_limit_is_twenty_five_mebibytes_expressed_in_bytes()
    {
        // 25 * 1024 * 1024. Not 25 000 000: shared contract §9.4 writes the byte count out, and
        // DevStubs generates documents at exactly this size and one byte over.
        BrpWebhookEndpoints.MaximumPayloadBytes.ShouldBe(26_214_400);
        BrpWebhookEndpoints.MaximumPayloadBytes.ShouldBe(25 * 1024 * 1024);
    }

    [Fact]
    public async Task a_payload_of_exactly_the_limit_is_accepted()
    {
        var code = await SeedBrpAsync("WSL1");
        var payload = new byte[BrpWebhookEndpoints.MaximumPayloadBytes];
        Array.Fill(payload, (byte)'x');

        using var response = await PostAsync(code, new ByteArrayContent(payload));

        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        await using var db = factory.CreateOwnerDbContext();
        var stored = await db.InboundMessages.AsNoTracking()
            .OrderByDescending(m => m.ReceivedAt)
            .FirstAsync(TestContext.Current.CancellationToken);
        stored.PayloadBytes.ShouldBe(BrpWebhookEndpoints.MaximumPayloadBytes);
    }

    [Fact]
    public async Task a_payload_one_byte_over_the_limit_is_413()
    {
        var code = await SeedBrpAsync("WSL2");
        var payload = new byte[BrpWebhookEndpoints.MaximumPayloadBytes + 1];
        Array.Fill(payload, (byte)'x');

        using var response = await PostAsync(code, new ByteArrayContent(payload));

        response.StatusCode.ShouldBe(HttpStatusCode.RequestEntityTooLarge);
        (await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken))
            .ShouldContain(WebhookProblems.PayloadTooLargeType, Case.Sensitive);
    }

    [Fact]
    public async Task a_chunked_body_one_byte_over_the_limit_is_413()
    {
        // No Content-Length at all. A cap that only read the declared length would accept this,
        // and the first thing a caller who wanted to bypass the limit would try is chunking.
        var code = await SeedBrpAsync("WSL3");
        var payload = new byte[BrpWebhookEndpoints.MaximumPayloadBytes + 1];
        Array.Fill(payload, (byte)'x');

        using var content = new StreamContent(new NonSeekableStream(payload));

        using var response = await PostAsync(code, content);

        response.StatusCode.ShouldBe(HttpStatusCode.RequestEntityTooLarge);
    }

    [Fact]
    public async Task a_chunked_body_of_exactly_the_limit_is_accepted()
    {
        var code = await SeedBrpAsync("WSL4");
        var payload = new byte[BrpWebhookEndpoints.MaximumPayloadBytes];
        Array.Fill(payload, (byte)'x');

        using var content = new StreamContent(new NonSeekableStream(payload));

        using var response = await PostAsync(code, content);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task nothing_is_stored_for_a_refused_payload()
    {
        var code = await SeedBrpAsync("WSL5");
        await using var before = factory.CreateOwnerDbContext();
        var count = await before.InboundMessages.CountAsync(TestContext.Current.CancellationToken);

        var payload = new byte[BrpWebhookEndpoints.MaximumPayloadBytes + 1];
        using var response = await PostAsync(code, new ByteArrayContent(payload));
        response.StatusCode.ShouldBe(HttpStatusCode.RequestEntityTooLarge);

        await using var after = factory.CreateOwnerDbContext();
        (await after.InboundMessages.CountAsync(TestContext.Current.CancellationToken))
            .ShouldBe(count);
    }

    [Fact]
    public async Task a_refused_payload_still_carries_a_correlation_id()
    {
        var code = await SeedBrpAsync("WSL6");
        var payload = new byte[BrpWebhookEndpoints.MaximumPayloadBytes + 1];

        using var response = await PostAsync(code, new ByteArrayContent(payload));

        Guid.TryParse(
            response.Headers.GetValues(BrpWebhookEndpoints.CorrelationIdHeaderName).Single(),
            out _).ShouldBeTrue();
    }

    /// <summary>
    /// A stream HttpClient cannot measure, so the request goes out chunked.
    /// </summary>
    private sealed class NonSeekableStream(byte[] content) : Stream
    {
        private int _position;

        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            var take = Math.Min(count, content.Length - _position);
            Array.Copy(content, _position, buffer, offset, take);
            _position += take;
            return take;
        }

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) =>
            throw new NotSupportedException();
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

If Task 6's handler was written exactly as printed, five of these seven pass already. Run them
anyway, and read which ones do not:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~WebhookSizeLimitTests"
```

Expected: PASS — 7 tests, 0 failed. **If any fail, the handler's boundary is wrong**; fix it in
`BrpWebhookEndpoints` and re-run before continuing. The two failures worth naming:

- `a_payload_of_exactly_the_limit_is_accepted` failing with `413` means the comparison is `>=`
  rather than `>` — contract §9.4 says **strictly greater than**.
- `a_chunked_body_one_byte_over_the_limit_is_413` failing with `200` means the check reads only
  `Content-Length`.

⚠ A task whose tests pass on the first run is not evidence of anything by itself. Step 3 is what
makes it evidence.

- [ ] **Step 3: Verify by mutation — the boundary is strictly greater than**

**What to break:** in `ReadBodyAsync`, change `return read > limit ? null : ...` to
`return read >= limit ? null : ...`.

**What to predict:** `a_payload_of_exactly_the_limit_is_accepted` fails with
`response.StatusCode should be OK but was RequestEntityTooLarge`, and
`a_chunked_body_of_exactly_the_limit_is_accepted` fails the same way. The two over-limit tests stay
green.

**What to watch go red:** exactly those two, and no others. That asymmetry is the proof the pair of
tests is doing its job: a wrong comparison fails only the at-the-cap side.

Restore.

- [ ] **Step 4: Verify by mutation — the stream check is not redundant**

**What to break:** delete the whole `if (body is null)` block and the `ReadBodyAsync` call, replacing
it with `var body = await ReadAllAsync(context.Request.Body, ct);` where `ReadAllAsync` copies to a
`MemoryStream` with no cap — i.e. rely on the `Content-Length` check alone.

**What to predict:** `a_chunked_body_one_byte_over_the_limit_is_413` fails with
`response.StatusCode should be RequestEntityTooLarge but was OK`, and
`nothing_is_stored_for_a_refused_payload` stays green because it posts with a `Content-Length`.

**What to watch go red:** the chunked test alone. This is the case the assertion is *for* — the
declared-length check is the easy neighbouring one, and it is not the one that holds against a
caller who does not want the limit to apply.

Restore.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Ingestion/WebhookSizeLimitTests.cs \
        src/Hosts/PeakPower.Worker/Webhooks/BrpWebhookEndpoints.cs
git commit -m "test(worker): pin both sides of the 25 MiB webhook boundary

[F02-R06] and design §7.3: exactly 26 214 400 bytes is accepted, 26 214 401 is refused with 413.
Mutation-verified with >=, which fails only the at-the-cap side - the asymmetry is what makes the
pair of tests worth having.

The cap holds on a chunked body too, verified by removing the stream check and watching only the
chunked case go red. A Content-Length-only limit is the first thing a caller who does not want the
limit would step around.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Dedupe over the wire, and the concurrent redelivery

Task 5 proved the receiver deduplicates. This task proves the **endpoint** does, in the shape the
definition of done states it (design §7.3): re-posting the byte-identical payload within 24 h
records `DUPLICATE` and creates no second version — and answers **200**, not 409.

It also closes the race the advisory lock in Task 5 exists for, which no sequential test can see.

⚠ **A duplicate answers 200.** A BRP redelivering because it missed the first acknowledgement must
be told "received", or it retries forever. `[F02-R05]`'s spirit and contract §9.4's letter both say
so.

**Files:**
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/WebhookDedupeTests.cs`

**Interfaces:**
- Consumes: `WorkerFactory` (Task 6); `InboundMessageReceiver.DuplicateWindow` (Task 5).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/WebhookDedupeTests.cs`:

```csharp
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Webhook;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

public sealed class WebhookDedupeTests(WorkerFactory factory) : IClassFixture<WorkerFactory>
{
    private const string Credential = "the-configured-secret";

    private async Task<(Guid BrpId, string Code)> SeedBrpAsync(string code)
    {
        await using var db = factory.CreateOwnerDbContext();
        var brp = Brp.Create(code, $"{code} B.V.", isActive: true).Value;
        db.Brps.Add(brp);
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);

        factory.Credentials.Set(brp.CredentialRef, Credential);
        return (brp.Id, brp.Code);
    }

    private async Task<HttpResponseMessage> PostAsync(HttpClient client, string code, byte[] payload)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/webhooks/brp/{code}")
        {
            Content = new ByteArrayContent(payload),
        };
        request.Headers.Add(BrpWebhookAuthenticator.CredentialHeaderName, Credential);

        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task a_byte_identical_redelivery_answers_200_and_lands_DUPLICATE()
    {
        var (brpId, code) = await SeedBrpAsync("WDD1");
        var payload = Encoding.UTF8.GetBytes("<identical/>");
        using var client = factory.CreateWebhookClient();

        using var first = await PostAsync(client, code, payload);
        using var second = await PostAsync(client, code, payload);

        // 200 on the redelivery, not 409. A BRP that missed the first acknowledgement and is
        // retrying must be told "received", or it retries forever.
        first.StatusCode.ShouldBe(HttpStatusCode.OK);
        second.StatusCode.ShouldBe(HttpStatusCode.OK);

        await using var db = factory.CreateOwnerDbContext();
        var stored = await db.InboundMessages.AsNoTracking()
            .Where(m => m.BrpId == brpId)
            .OrderBy(m => m.ReceivedAt)
            .ToListAsync(TestContext.Current.CancellationToken);

        stored.Count.ShouldBe(2);
        stored[0].Status.ShouldBe(InboundMessageStatus.Received);
        stored[1].Status.ShouldBe(InboundMessageStatus.Duplicate);
    }

    [Fact]
    public async Task the_redelivery_is_enqueued_zero_times()
    {
        var (_, code) = await SeedBrpAsync("WDD2");
        var payload = Encoding.UTF8.GetBytes("<identical-too/>");
        var before = factory.Queue.Enqueued.Count;
        using var client = factory.CreateWebhookClient();

        using var first = await PostAsync(client, code, payload);
        using var second = await PostAsync(client, code, payload);
        first.StatusCode.ShouldBe(HttpStatusCode.OK);
        second.StatusCode.ShouldBe(HttpStatusCode.OK);

        // [F02-R07]: recorded as a duplicate and NOT reprocessed. One enqueue for two posts.
        (factory.Queue.Enqueued.Count - before).ShouldBe(1);
    }

    [Fact]
    public async Task both_rows_carry_distinct_correlation_ids()
    {
        // ux_msg_correlation is UNIQUE. A duplicate that reused the first message's correlation id
        // would violate it and turn a 200 into a 500.
        var (brpId, code) = await SeedBrpAsync("WDD3");
        var payload = Encoding.UTF8.GetBytes("<identical-three/>");
        using var client = factory.CreateWebhookClient();

        using var first = await PostAsync(client, code, payload);
        using var second = await PostAsync(client, code, payload);
        first.StatusCode.ShouldBe(HttpStatusCode.OK);
        second.StatusCode.ShouldBe(HttpStatusCode.OK);

        await using var db = factory.CreateOwnerDbContext();
        var ids = await db.InboundMessages.AsNoTracking()
            .Where(m => m.BrpId == brpId)
            .Select(m => m.CorrelationId)
            .ToListAsync(TestContext.Current.CancellationToken);

        ids.Distinct().Count().ShouldBe(2);
    }

    [Fact]
    public async Task the_duplicate_row_still_points_at_stored_bytes()
    {
        // [F02-R03] is unconditional: deciding a payload is a duplicate is already looking at it.
        // "We have the bytes of everything that arrived" must be true with no exception clause.
        var (brpId, code) = await SeedBrpAsync("WDD4");
        var payload = Encoding.UTF8.GetBytes("<identical-four/>");
        using var client = factory.CreateWebhookClient();

        using var first = await PostAsync(client, code, payload);
        using var second = await PostAsync(client, code, payload);
        first.StatusCode.ShouldBe(HttpStatusCode.OK);
        second.StatusCode.ShouldBe(HttpStatusCode.OK);

        await using var db = factory.CreateOwnerDbContext();
        var duplicate = await db.InboundMessages.AsNoTracking()
            .SingleAsync(
                m => m.BrpId == brpId && m.Status == InboundMessageStatus.Duplicate,
                TestContext.Current.CancellationToken);

        duplicate.PayloadUri.ShouldNotBeNullOrWhiteSpace();
        duplicate.PayloadHash.ShouldBe(SHA256.HashData(payload));

        var absolute = Path.Combine(
            factory.RawPayloadRoot,
            duplicate.PayloadUri["file://".Length..].Replace('/', Path.DirectorySeparatorChar));
        File.Exists(absolute).ShouldBeTrue($"expected the duplicate's payload at {absolute}");
    }

    [Fact]
    public async Task two_simultaneous_redeliveries_produce_exactly_one_RECEIVED()
    {
        // The advisory lock in InboundMessageReceiver is here for this and nothing else. Without
        // it both requests see "no earlier message", both land RECEIVED, and the pipeline applies
        // the same document twice - creating a second version out of a redelivery.
        var (brpId, code) = await SeedBrpAsync("WDD5");
        var payload = Encoding.UTF8.GetBytes("<simultaneous/>");

        using var a = factory.CreateWebhookClient();
        using var b = factory.CreateWebhookClient();

        var first = PostAsync(a, code, payload);
        var second = PostAsync(b, code, payload);
        using var responseA = await first;
        using var responseB = await second;

        responseA.StatusCode.ShouldBe(HttpStatusCode.OK);
        responseB.StatusCode.ShouldBe(HttpStatusCode.OK);

        await using var db = factory.CreateOwnerDbContext();
        var statuses = await db.InboundMessages.AsNoTracking()
            .Where(m => m.BrpId == brpId)
            .Select(m => m.Status)
            .ToListAsync(TestContext.Current.CancellationToken);

        statuses.Count.ShouldBe(2);
        statuses.Count(status => status == InboundMessageStatus.Received).ShouldBe(1);
        statuses.Count(status => status == InboundMessageStatus.Duplicate).ShouldBe(1);
    }
}
```

- [ ] **Step 2: Run it and watch it fail, or pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~WebhookDedupeTests"
```

Expected: PASS — 5 tests, 0 failed, if Task 5 was written as printed.

⚠ `two_simultaneous_redeliveries_produce_exactly_one_RECEIVED` is the one that can be flaky in the
*absence* of the lock rather than in its presence — two requests dispatched from one thread do not
always overlap. Run it ten times before trusting either outcome:

```bash
for i in $(seq 1 10); do
  dotnet test tests/PeakPower.Integration.Tests \
    --filter "FullyQualifiedName~two_simultaneous_redeliveries" --nologo | tail -3
done
```

Expected: ten passes.

- [ ] **Step 3: Verify by mutation — the advisory lock is what makes the race deterministic**

**What to break:** in `InboundMessageReceiver.ReceiveAsync`, delete the
`pg_advisory_xact_lock` statement (and the `lockKey` local it uses, so the build still succeeds).

**What to predict:** `two_simultaneous_redeliveries_produce_exactly_one_RECEIVED` fails with
`statuses.Count(status => status == Received) should be 1 but was 2` — **intermittently**. Run the
ten-iteration loop above; expect it to fail at least twice in ten.

**What to watch go red:** that test, in a loop rather than once. A concurrency mutation that is
checked with a single run proves nothing, and this repository's standard is that a green test that
was never seen red is not evidence — a *flaky* red is still red, and the loop is what makes it
visible.

Restore, then run the loop again and watch ten passes.

- [ ] **Step 4: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Ingestion/WebhookDedupeTests.cs
git commit -m "test(worker): prove the 24 h dedupe over the wire, including the concurrent redelivery

Design §7.3: re-posting the byte-identical payload within 24 h records DUPLICATE, creates no second
version, and answers 200 - not 409, because a BRP retrying after a missed acknowledgement must be
told 'received'.

The duplicate row still points at stored bytes: [F02-R03] is unconditional, and deciding a payload
is a duplicate is already looking at it.

The concurrent case is mutation-verified by deleting the advisory lock and running the test ten
times, not once: without the lock both requests land RECEIVED intermittently, and a single green
run would have certified the race as closed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The two apply-stage seams, and the BRP-agnostic test harness

The apply stage needs two things this plan does not own, and one thing no plan owns.

**Plan 5 owns derived data.** Contract §9.6 step 7 recomputes `metering_point_day_state` and
`daily_position` for every touched (point, date) **in the same transaction** — that "same
transaction" is what `[F02-R34]`'s promotion depends on. Plan 5 writes the computation; this plan
writes the port it hangs on and a no-op default, so the apply transaction is complete and testable
before plan 5 lands and needs no edit when it does.

**Plan 5 also owns most alerts**, but this plan raises one: contract §8.4 says a rejection "raises a
`VALIDATION_FAILURE` alert". One write path, shared, so the two plans cannot produce two shapes of
the same row.

**Nobody owns a BRP-agnostic document format**, and the apply stage needs one. Plan 4's PVNed
adapter cannot be a dependency here — architecture fact 3 forbids the reference, and design step 6
is testable "with a pair of documents posted out of order" independently of any format. So this
task builds a **test-only** adapter over a tiny line-based text format. It lives in
`tests/PeakPower.Integration.Tests` and ships nowhere.

⚠ **The fake adapter is a test double, not a second implementation of anything.** It exists so the
pipeline's own behaviour — versions, supersession, quarantine, atomicity — is proven without any
BRP format being right. Design §9: "the pipeline half **is** genuinely proven, because it is
BRP-agnostic and does not depend on the format being right." This is the type that makes that
sentence true.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/Ingestion/IDayStateRecomputer.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/Ingestion/IOperationalAlertRaiser.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/NoOpDayStateRecomputer.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/DbOperationalAlertRaiser.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/TestDocument.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/FakeBrpIngestionAdapter.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/IngestionSeed.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/OperationalAlertRaiserTests.cs`

**Interfaces:**
- Consumes: `OperationalAlert.Raise`, `OperationalAlert.Resolve`, `OperationalAlertKind`,
  `OperationalAlertStatus`, `MeteringDayState`, `PeakPowerDbContext.OperationalAlerts` (plan 2);
  `CanonicalSeries`, `BrpDocument`, `BrpParseOutcome` (Task 1).
- Produces: `IDayStateRecomputer` · `DayRecomputeRequest` · `DayRecomputeResult` ·
  `MeteringPointDay` · `NoOpDayStateRecomputer` · `IOperationalAlertRaiser` ·
  `OperationalAlertRequest` · `DbOperationalAlertRaiser` · (test-only) `TestDocument` ·
  `FakeBrpIngestionAdapter` · `IngestionSeed`.

⚠ **The two port shapes are shared contract §7.6 and are NOT this plan's to choose.** §7.6 is
normative and settles a collision between this plan's draft and plan 5's: the names are
`IDayStateRecomputer` and `IOperationalAlertRaiser`, `RecomputeAsync` takes one
`DayRecomputeRequest` rather than a list, and `RaiseAsync` returns `bool` beside a `ResolveOpenAsync`.
Copy §7.6's declarations character for character in Steps 3 and 4.

- [ ] **Step 1: Write the failing test for the alert raiser**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/OperationalAlertRaiserTests.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Processing;
using PeakPower.Integration.Tests.Database;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

[Collection(PostgresCollection.Name)]
public sealed class OperationalAlertRaiserTests(PostgresFixture postgres)
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-08-13T04:02:12Z", null);

    [Fact]
    public async Task writes_an_open_alert_with_the_kind_and_the_message_it_was_given()
    {
        await using var db = postgres.CreateContext();
        var brp = Brp.Create("ALRT1", "Alert BRP B.V.", isActive: true).Value;
        db.Brps.Add(brp);
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);

        var raiser = new DbOperationalAlertRaiser(db);

        var written = await raiser.RaiseAsync(
            new OperationalAlertRequest(
                OperationalAlertKind.ValidationFailure,
                Summary: "A PVNED document failed validation.",
                Detail: "UNSUPPORTED_RESOLUTION: Resolution was PT60M.",
                MeteringPointId: null,
                BrpId: brp.Id,
                InboundMessageId: null,
                DeliveryDate: new DateOnly(2026, 8, 12),
                RaisedAt: Now),
            TestContext.Current.CancellationToken);

        written.ShouldBeTrue();

        await db.SaveChangesAsync(TestContext.Current.CancellationToken);

        await using var read = postgres.CreateContext();
        var alert = await read.OperationalAlerts.AsNoTracking()
            .SingleAsync(a => a.BrpId == brp.Id, TestContext.Current.CancellationToken);

        alert.Kind.ShouldBe(OperationalAlertKind.ValidationFailure);
        alert.Status.ShouldBe(OperationalAlertStatus.Open);
        alert.Summary.ShouldBe("A PVNED document failed validation.");
        alert.Detail.ShouldBe("UNSUPPORTED_RESOLUTION: Resolution was PT60M.");
        alert.DeliveryDate.ShouldBe(new DateOnly(2026, 8, 12));
        alert.RaisedAt.ShouldBe(Now);
        alert.ResolvedAt.ShouldBeNull();
    }

    [Fact]
    public async Task does_not_save_changes_itself()
    {
        // The alert is written INSIDE the apply transaction, beside the FAILED status it explains.
        // A raiser that called SaveChangesAsync would commit half of that transaction's work, and a
        // rollback would then leave an alert for a failure that did not happen.
        await using var db = postgres.CreateContext();
        var brp = Brp.Create("ALRT2", "Alert BRP Two B.V.", isActive: true).Value;
        db.Brps.Add(brp);
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);

        var raiser = new DbOperationalAlertRaiser(db);
        await raiser.RaiseAsync(
            new OperationalAlertRequest(
                OperationalAlertKind.ValidationFailure, "Summary.", null,
                null, brp.Id, null, null, Now),
            TestContext.Current.CancellationToken);

        await using var other = postgres.CreateContext();
        (await other.OperationalAlerts.CountAsync(
            a => a.BrpId == brp.Id, TestContext.Current.CancellationToken)).ShouldBe(0);
    }

    [Fact]
    public async Task refuses_a_blank_summary_rather_than_writing_an_unreadable_row()
    {
        // metering.operational_alert has CHECK (length(btrim(summary)) > 0). Failing here, with a
        // message naming the kind, beats a 23514 from Postgres on a batch that also carried the
        // FAILED status.
        await using var db = postgres.CreateContext();
        var raiser = new DbOperationalAlertRaiser(db);

        await Should.ThrowAsync<InvalidOperationException>(() => raiser.RaiseAsync(
            new OperationalAlertRequest(
                OperationalAlertKind.ValidationFailure, "   ", null,
                null, null, null, null, Now),
            TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task two_validation_failures_with_no_metering_point_write_TWO_rows()
    {
        // Contract §7.6 makes raising idempotent by (kind, metering point, delivery date) while an
        // alert is open, because a PARTIAL day is recomputed on every document that touches it.
        // VALIDATION_FAILURE is the kind that key does NOT apply to: it names an inbound MESSAGE
        // and carries no metering point, so two rejected documents are two failures and must be
        // two rows. A dedupe that collapsed them would hide the second bad document entirely,
        // which is the opposite of what [F02-R12] is for.
        await using var db = postgres.CreateContext();
        var brp = Brp.Create("ALRT3", "Alert BRP Three B.V.", isActive: true).Value;
        db.Brps.Add(brp);
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);

        var raiser = new DbOperationalAlertRaiser(db);

        foreach (var code in new[] { "UNSUPPORTED_RESOLUTION", "UNSUPPORTED_CURVE_TYPE" })
        {
            (await raiser.RaiseAsync(
                new OperationalAlertRequest(
                    OperationalAlertKind.ValidationFailure,
                    "An inbound BRP document failed validation.",
                    code, null, brp.Id, null, null, Now),
                TestContext.Current.CancellationToken)).ShouldBeTrue();
        }

        await db.SaveChangesAsync(TestContext.Current.CancellationToken);

        await using var read = postgres.CreateContext();
        (await read.OperationalAlerts.CountAsync(
            a => a.BrpId == brp.Id, TestContext.Current.CancellationToken)).ShouldBe(2);
    }
}
```

⚠ **The dedupe and resolve paths are exercised by plan 5, not here.** Contract §7.6 assigns the
implementation to plan 5; `DbOperationalAlertRaiser` is plan 3's stand-in, the alert-side twin of
`NoOpDayStateRecomputer`, and the only kind plan 3 ever raises is `VALIDATION_FAILURE` — which the
dedupe key deliberately does not cover. The test above pins that exemption so plan 5's deduping
raiser cannot widen the key onto a kind that must never collapse.

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~OperationalAlertRaiserTests"
```

Expected: FAIL — build error
`error CS0234: The type or namespace name 'Processing' does not exist in the namespace 'PeakPower.Ingestion'`.

- [ ] **Step 3: Declare the day-state recompute seam, exactly as contract §7.6 pins it**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/Ingestion/IDayStateRecomputer.cs`:

⚠ **Every line of this file is shared contract §7.6, and §7.6 is normative.** The names and the
record shapes are plan 5's, not this plan's: `RecomputeAsync` takes **one** pair per call rather
than a list, because only a per-pair request can carry `NewVersionReceivedAt` — the one value that
tells a version arriving after the window, which reopens a `FINAL` day (`[DEC-98]`, design §7.12,
`[F02-R45]`), from a replay that must leave a finalised date exactly as it found it. A recomputer
that cannot tell those apart either never reopens or reopens on every replay, and both are silent.
Copy the shapes below exactly; do not improve them here.

⚠ **`MeteringPointDay` stays in this file.** It is this plan's type and it survives §7.6 unchanged:
the apply transaction collects touched pairs into a `HashSet<MeteringPointDay>` and Task 14's
`AdvisoryLock.KeyFor` takes one, so it is needed whether or not it appears in a recompute signature.

```csharp
using PeakPower.Domain.Metering;

namespace PeakPower.Application.Abstractions.Ingestion;

/// <summary>One (metering point, delivery date) whose derived data a new version invalidated.</summary>
public readonly record struct MeteringPointDay(Guid MeteringPointId, DateOnly DeliveryDate);

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

⚠ `MeteringDayState` is plan 2's enum (`PeakPower.Domain.Metering`, contract §5:
`public enum MeteringDayState { NoData, Partial, Provisional, Final }`). This plan reads it and
never declares it.

- [ ] **Step 4: Declare the alert raiser, exactly as contract §7.6 pins it**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Application/Abstractions/Ingestion/IOperationalAlertRaiser.cs`:

⚠ **This is contract §7.6, normative, and the shape is plan 5's.** Two things this plan would not
have reached for on its own are load-bearing and must be copied rather than trimmed: `RaiseAsync`
returns `bool` because raising is **idempotent by (kind, metering point, delivery date) while an
alert is open** — a PARTIAL day is recomputed on every document that touches it, and without the
dedupe answer the table holds one row per sweep — and `ResolveOpenAsync` exists because
`[F02-R26]`'s resolution path has nowhere else to live. The remarks below say why this plan's own
doc comment ("one write path, so the two plans cannot produce two shapes of the same row") argues
for §7.6's shape and against this plan's draft: two ports over one table is exactly the thing that
comment forbids.

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

⚠ **`RaisedAt` and `resolvedAt` are supplied by the caller, so `DbOperationalAlertRaiser` needs no
clock at all** — it takes `PeakPowerDbContext` and nothing else. Architecture fact 5 puts the only
clock in `PeakPower.Infrastructure.Time`, and an implementation that read one here would stamp an
alert with the moment the job thread got round to it rather than the message's own receipt time.

- [ ] **Step 5: Implement both**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/NoOpDayStateRecomputer.cs`:

```csharp
using Microsoft.Extensions.Logging;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Metering;

namespace PeakPower.Ingestion.Processing;

/// <summary>
/// The default until plan 5 lands the real one. Logs what it would have recomputed and does
/// nothing.
/// </summary>
/// <remarks>
/// <para>
/// It logs rather than staying silent on purpose: a deployment that somehow shipped with this
/// registered would show empty charts, and the log line is the difference between "the rollup is
/// broken" and "the rollup is not installed".
/// </para>
/// <para>
/// It answers <see cref="MeteringDayState.NoData"/> with every flag false and every accumulator
/// zero — the honest answer for a recomputer that computed nothing. In particular
/// <c>ReopenedFromFinal</c> is <c>false</c>, so a caller that logs reopenings does not report one
/// that never happened.
/// </para>
/// </remarks>
public sealed class NoOpDayStateRecomputer(ILogger<NoOpDayStateRecomputer> logger)
    : IDayStateRecomputer
{
    public Task<DayRecomputeResult> RecomputeAsync(
        DayRecomputeRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);

        logger.LogInformation(
            "No day-state recomputer is registered; metering point {MeteringPointId} on "
            + "{DeliveryDate} was left uncomputed for correlation {CorrelationId}.",
            request.MeteringPointId, request.DeliveryDate, request.CorrelationId);

        return Task.FromResult(new DayRecomputeResult(
            MeteringDayState.NoData, 0, false, false, false, false, false, 0m, 0m, 0m, 0m, 0m));
    }
}
```

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/DbOperationalAlertRaiser.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Metering;
using PeakPower.Persistence;

namespace PeakPower.Ingestion.Processing;

/// <summary>
/// Adds an <c>operational_alert</c> row to the current change tracker. Shared contract §8.4.
/// </summary>
/// <remarks>
/// <para>
/// <b>Plan 3's stand-in, registered with <c>TryAddScoped</c>.</b> Contract §7.6 gives the
/// implementation to plan 5, which raises the four kinds this plan never touches; plan 3 raises
/// only <see cref="OperationalAlertKind.ValidationFailure"/> and needs a working write path before
/// plan 5 lands. When plan 5's registration is present it wins, and nothing here changes.
/// </para>
/// <para>
/// <b>Never calls <c>SaveChangesAsync</c>.</b> The alert is added to the same change tracker as
/// the FAILED status it explains, and committed with it. A raiser that saved would commit half a
/// transaction, and a later rollback would leave an alert for a failure that did not happen.
/// </para>
/// </remarks>
public sealed class DbOperationalAlertRaiser(PeakPowerDbContext db) : IOperationalAlertRaiser
{
    public async Task<bool> RaiseAsync(OperationalAlertRequest request, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);

        // The dedupe key of contract §7.6 is (kind, metering point, delivery date), and it only
        // exists where there IS a metering point. VALIDATION_FAILURE names an inbound message and
        // carries none, so two rejected documents stay two rows - collapsing them would hide the
        // second bad document, which is the opposite of what [F02-R12] is for.
        if (request.MeteringPointId is { } meteringPointId)
        {
            var alreadyOpen = await db.OperationalAlerts
                .AsNoTracking()
                .AnyAsync(
                    candidate =>
                        candidate.Kind == request.Kind
                        && candidate.MeteringPointId == meteringPointId
                        && candidate.DeliveryDate == request.DeliveryDate
                        && candidate.ResolvedAt == null,
                    ct);

            if (alreadyOpen)
            {
                return false;
            }
        }

        // raisedAt is the FOURTH argument (contract §5). Every parameter after it is an optional
        // nullable id, so a wrong order compiles and files the alert against the wrong BRP.
        var alert = OperationalAlert.Raise(
            request.Kind,
            request.Summary,
            request.Detail,
            request.RaisedAt,
            request.MeteringPointId,
            request.BrpId,
            request.InboundMessageId,
            request.DeliveryDate);

        if (!alert.IsSuccess)
        {
            // metering.operational_alert has CHECK (length(btrim(summary)) > 0). Failing here,
            // naming the kind, beats a Postgres 23514 raised on a batch that also carried the
            // FAILED status - at which point the message would be stuck in PROCESSING with no
            // explanation anywhere.
            throw new InvalidOperationException(
                $"Could not raise a {request.Kind} operational alert: {alert.Error}");
        }

        db.OperationalAlerts.Add(alert.Value);

        // Deliberately no SaveChangesAsync. See IOperationalAlertRaiser's remarks.
        return true;
    }

    public async Task<int> ResolveOpenAsync(
        OperationalAlertKind kind,
        Guid meteringPointId,
        DateOnly? deliveryDate,
        DateTimeOffset resolvedAt,
        CancellationToken ct)
    {
        // Tracked, not AsNoTracking: Resolve() must land in the caller's change set, for the same
        // reason RaiseAsync adds rather than saves.
        var open = await db.OperationalAlerts
            .Where(candidate =>
                candidate.Kind == kind
                && candidate.MeteringPointId == meteringPointId
                && candidate.ResolvedAt == null
                // A null deliveryDate resolves EVERY open alert of that kind for the point: a
                // point that went quiet and came back is one recovery, not one per day it missed.
                && (deliveryDate == null || candidate.DeliveryDate == deliveryDate))
            .ToListAsync(ct);

        foreach (var alert in open)
        {
            var resolved = alert.Resolve(resolvedAt);

            if (!resolved.IsSuccess)
            {
                throw new InvalidOperationException(
                    $"Could not resolve a {kind} operational alert: {resolved.Error}");
            }
        }

        return open.Count;
    }
}
```

- [ ] **Step 6: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~OperationalAlertRaiserTests"
```

Expected: PASS — 4 tests, 0 failed.

- [ ] **Step 7: Write the test document format**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/TestDocument.cs`:

```csharp
using System.Globalization;
using System.Text;
using PeakPower.Domain.Metering;

namespace PeakPower.Integration.Tests.Ingestion;

/// <summary>
/// A deliberately trivial, BRP-agnostic document format, so the pipeline's own behaviour can be
/// proven without any real BRP's format being right.
/// </summary>
/// <remarks>
/// <para>
/// Design §9: what this slice genuinely proves is the BRP-agnostic half — versioning, receipt-order
/// supersession, quarantine, completeness, day states, the rollup shape, DST handling, tenancy.
/// "None of that depends on the PVNed format being right." This type is what makes that sentence
/// true rather than aspirational: the apply tests exercise the pipeline through a format nobody
/// will ever ship.
/// </para>
/// <para>
/// The wire form is one record per line:
/// <code>
/// DOC|{documentId}|{createdIso}|{ALLOCATION|IMBALANCE}
/// SERIES|{resourceObject}|{isEan}|{yyyy-MM-dd}|{CONSUMPTION|PRODUCTION}|{expectedIntervalCount}
/// P|{pos}|{quantityKwh}
/// </code>
/// </para>
/// </remarks>
public sealed class TestDocument
{
    private readonly List<SeriesBuilder> _series = [];

    public TestDocument(string documentId, DateTimeOffset createdAt, BrpDocumentKindLabel kind = BrpDocumentKindLabel.Allocation)
    {
        DocumentId = documentId;
        CreatedAt = createdAt;
        Kind = kind;
    }

    public enum BrpDocumentKindLabel
    {
        Allocation,
        Imbalance,
    }

    public string DocumentId { get; }

    public DateTimeOffset CreatedAt { get; }

    public BrpDocumentKindLabel Kind { get; }

    public TestDocument WithSeries(
        string resourceObject,
        bool resourceObjectIsEan,
        DateOnly deliveryDate,
        IntervalDirection direction,
        int expectedIntervalCount,
        IReadOnlyList<decimal> quantitiesByPos)
    {
        _series.Add(new SeriesBuilder(
            resourceObject, resourceObjectIsEan, deliveryDate, direction,
            expectedIntervalCount, quantitiesByPos));
        return this;
    }

    /// <summary>A full 96-interval day of the same value, the ordinary case.</summary>
    public TestDocument WithFlatDay(
        string ean, DateOnly deliveryDate, IntervalDirection direction, decimal kwhPerInterval,
        int expectedIntervalCount = 96)
        => WithSeries(
            ean, resourceObjectIsEan: true, deliveryDate, direction, expectedIntervalCount,
            [.. Enumerable.Repeat(kwhPerInterval, expectedIntervalCount)]);

    public byte[] ToBytes()
    {
        var builder = new StringBuilder();
        builder.Append("DOC|").Append(DocumentId).Append('|')
            .Append(CreatedAt.ToString("O", CultureInfo.InvariantCulture)).Append('|')
            .Append(Kind == BrpDocumentKindLabel.Allocation ? "ALLOCATION" : "IMBALANCE")
            .Append('\n');

        foreach (var series in _series)
        {
            builder.Append("SERIES|").Append(series.ResourceObject).Append('|')
                .Append(series.ResourceObjectIsEan ? "true" : "false").Append('|')
                .Append(series.DeliveryDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)).Append('|')
                .Append(series.Direction == IntervalDirection.Consumption ? "CONSUMPTION" : "PRODUCTION").Append('|')
                .Append(series.ExpectedIntervalCount.ToString(CultureInfo.InvariantCulture))
                .Append('\n');

            for (var index = 0; index < series.Quantities.Count; index++)
            {
                builder.Append("P|")
                    .Append((index + 1).ToString(CultureInfo.InvariantCulture)).Append('|')
                    .Append(series.Quantities[index].ToString("0.###", CultureInfo.InvariantCulture))
                    .Append('\n');
            }
        }

        return Encoding.UTF8.GetBytes(builder.ToString());
    }

    private sealed record SeriesBuilder(
        string ResourceObject,
        bool ResourceObjectIsEan,
        DateOnly DeliveryDate,
        IntervalDirection Direction,
        int ExpectedIntervalCount,
        IReadOnlyList<decimal> Quantities);
}
```

- [ ] **Step 8: Write the fake adapter**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/FakeBrpIngestionAdapter.cs`:

```csharp
using System.Globalization;
using System.Text;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Common;
using PeakPower.Domain.Metering;

namespace PeakPower.Integration.Tests.Ingestion;

/// <summary>
/// Parses <see cref="TestDocument"/>'s line format into <see cref="CanonicalSeries"/>.
/// </summary>
/// <remarks>
/// <para>
/// A test double, not a second implementation of anything. It obeys exactly the rules shared
/// contract §7.1 puts on an adapter: it never touches the database, never resolves an EAN, never
/// decides quarantine, and carries <c>ResourceObject</c> verbatim beside a parsed
/// <see cref="EanCode"/> that is set <b>only</b> when the resource object is eighteen digits
/// ([F02-R11]/[AS-17]).
/// </para>
/// <para>
/// The 18-digit test is made here rather than trusted from the file, so a fixture that writes
/// <c>isEan=true</c> beside a label cannot smuggle a label into the EAN resolver — which is the
/// exact bug design §3.1 warns about, expressed as a false <c>UNKNOWN_EAN</c>.
/// </para>
/// </remarks>
public sealed class FakeBrpIngestionAdapter(string adapterKey) : IBrpIngestionAdapter
{
    public string AdapterKey { get; } = adapterKey;

    /// <summary>Set by a test that wants this adapter to reject whatever it is given.</summary>
    public (string Code, string Detail)? ForcedRejection { get; set; }

    /// <summary>Every request this adapter was asked to parse, in order.</summary>
    public List<BrpParseRequest> Requests { get; } = [];

    public BrpParseOutcome Parse(BrpParseRequest request)
    {
        Requests.Add(request);

        if (ForcedRejection is { } rejection)
        {
            return BrpParseOutcome.Rejected(rejection.Code, rejection.Detail);
        }

        var text = Encoding.UTF8.GetString(request.Payload.Span);
        var lines = text.Split('\n', StringSplitOptions.RemoveEmptyEntries);

        if (lines.Length == 0 || !lines[0].StartsWith("DOC|", StringComparison.Ordinal))
        {
            return BrpParseOutcome.Rejected(
                "UNPARSEABLE_TEST_DOCUMENT", "The payload does not begin with a DOC| line.");
        }

        var header = lines[0].Split('|');
        var documentId = header[1];
        var createdAt = DateTimeOffset.Parse(header[2], CultureInfo.InvariantCulture);
        var kind = string.Equals(header[3], "IMBALANCE", StringComparison.Ordinal)
            ? BrpDocumentKind.Imbalance
            : BrpDocumentKind.Allocation;

        var series = new List<CanonicalSeries>();
        string? resourceObject = null;
        var deliveryDate = default(DateOnly);
        var direction = IntervalDirection.Consumption;
        var expected = 96;
        var points = new List<CanonicalPoint>();

        void FlushSeries()
        {
            if (resourceObject is null)
            {
                return;
            }

            var isEan = resourceObject.Length == 18 && resourceObject.All(char.IsAsciiDigit);
            var ean = isEan ? EanCode.Create(resourceObject).Value : (EanCode?)null;

            series.Add(new CanonicalSeries(
                resourceObject, isEan, ean, deliveryDate, direction, expected, [.. points]));
            points = [];
        }

        foreach (var line in lines.Skip(1))
        {
            var parts = line.Split('|');

            if (string.Equals(parts[0], "SERIES", StringComparison.Ordinal))
            {
                FlushSeries();
                resourceObject = parts[1];
                deliveryDate = DateOnly.ParseExact(parts[3], "yyyy-MM-dd", CultureInfo.InvariantCulture);
                direction = string.Equals(parts[4], "PRODUCTION", StringComparison.Ordinal)
                    ? IntervalDirection.Production
                    : IntervalDirection.Consumption;
                expected = int.Parse(parts[5], CultureInfo.InvariantCulture);
            }
            else if (string.Equals(parts[0], "P", StringComparison.Ordinal))
            {
                points.Add(new CanonicalPoint(
                    int.Parse(parts[1], CultureInfo.InvariantCulture),
                    decimal.Parse(parts[2], CultureInfo.InvariantCulture)));
            }
        }

        FlushSeries();

        var document = new BrpDocument(documentId, createdAt, kind, series);

        // [DEC-25]: an imbalance document is recognised, stored and closed with zero readings.
        // The fake honours it so the pipeline's handling of that outcome is exercised here rather
        // than only in plan 4.
        return kind == BrpDocumentKind.Imbalance
            ? BrpParseOutcome.RecognisedAndClosed(document)
            : BrpParseOutcome.Accepted(document);
    }
}
```

- [ ] **Step 9: Write the seeding helper**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/IngestionSeed.cs`:

```csharp
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Persistence;

namespace PeakPower.Integration.Tests.Ingestion;

/// <summary>
/// Seeds the master data the apply stage reads: a customer, a BRP and a metering point with a
/// validity period.
/// </summary>
/// <remarks>
/// Every EAN it generates is eighteen digits, because the pipeline keys on EAN and
/// <see cref="EanCode"/> validates the length. ⚠ None of them carries a valid GS1 check digit —
/// neither does any of the thirty-one demo EANs ([DEC-114], [OQ-97]) — and this slice deliberately
/// does not reinstate it.
/// </remarks>
public static class IngestionSeed
{
    private static int _counter;

    public static string NextEan() =>
        "8716859" + Interlocked.Increment(ref _counter).ToString("D11", null);

    public static async Task<Guid> AddBrpAsync(
        PeakPowerDbContext db, string code, bool isActive = true, CancellationToken ct = default)
    {
        var brp = Brp.Create(code, $"{code} B.V.", isActive).Value;
        db.Brps.Add(brp);
        await db.SaveChangesAsync(ct);
        return brp.Id;
    }

    public static async Task<Guid> AddCustomerAsync(
        PeakPowerDbContext db, string legalName, string kvkNumber, CancellationToken ct = default)
    {
        var customer = Customer.Create(
            legalName,
            tradeName: null,
            kvkNumber: KvkNumber.Create(kvkNumber).Value,
            vatNumber: null,
            billingAddress: new Address("Havenweg", "12", null, "3011 AA", "Rotterdam", "NL"),
            visitingAddress: null,
            primaryContact: new ContactPerson("Els Bakker", "els@example.test", null),
            internalReference: null,
            locale: "nl-NL").Value;

        db.Customers.Add(customer);
        await db.SaveChangesAsync(ct);
        return customer.Id;
    }

    public static async Task<Guid> AddMeteringPointAsync(
        PeakPowerDbContext db,
        Guid customerId,
        Guid brpId,
        string ean,
        DateOnly validFrom,
        DateOnly? validTo = null,
        ProductionExpectation expectation = ProductionExpectation.Unknown,
        CancellationToken ct = default)
    {
        var point = MeteringPoint.Attach(
            customerId,
            EanCode.Create(ean).Value,
            brpId,
            expectation,
            expectationSource: null,
            name: null,
            description: null,
            gridOperator: null,
            capacityKw: 1000m,
            address: null,
            validFrom).Value;

        if (validTo is { } closesAt)
        {
            point.EndDate(closesAt);
        }

        db.MeteringPoints.Add(point);
        await db.SaveChangesAsync(ct);
        return point.Id;
    }
}
```

⚠ `MeteringPoint.Attach` and `Customer.Create` are read from
`src/Core/PeakPower.Domain/Customers/MeteringPoint.cs:70` and
`tests/PeakPower.Integration.Tests/CustomerApiFactory.cs:159`. If plan 2 changed either signature,
this file is the one place to adjust.

⚠ **Plan 2's migration backfills `customer.metering_point_brp_assignment` for rows that exist when
migration 9 runs.** A metering point inserted by this helper *afterwards* has no assignment row, so
`WRONG_BRP` resolution must fall back to `metering_point.brp_id`. Task 13 asserts both paths.

- [ ] **Step 10: Build and commit**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~OperationalAlertRaiserTests"
```

Expected: build succeeds with 0 warnings; 4 tests pass.

```bash
git add src/Core/PeakPower.Application/Abstractions/Ingestion/IDayStateRecomputer.cs \
        src/Core/PeakPower.Application/Abstractions/Ingestion/IOperationalAlertRaiser.cs \
        src/Infrastructure/PeakPower.Ingestion/Processing \
        tests/PeakPower.Integration.Tests/Ingestion/TestDocument.cs \
        tests/PeakPower.Integration.Tests/Ingestion/FakeBrpIngestionAdapter.cs \
        tests/PeakPower.Integration.Tests/Ingestion/IngestionSeed.cs \
        tests/PeakPower.Integration.Tests/Ingestion/OperationalAlertRaiserTests.cs
git commit -m "feat(ingestion): add the derived-data and alert seams, and a BRP-agnostic test harness

Both ports are shared contract §7.6 verbatim: plan 3 declares them, plan 5 implements them.

IDayStateRecomputer is called INSIDE the apply transaction because [F02-R34]'s promotion and
migration 9's ck_mp_never_has_no_observed_production require it. It takes ONE DayRecomputeRequest
per (metering point, delivery date) rather than a list, because only a per-pair request carries
NewVersionReceivedAt - the value that separates a post-window version reopening a FINAL day
[DEC-98] from a replay that must leave it alone. Plan 3 ships a logging no-op registered with
TryAdd so plan 5 wins with no edit here.

IOperationalAlertRaiser is one write path for operational_alert, shared with plan 5. RaiseAsync
returns bool because raising is idempotent by (kind, metering point, delivery date) while an alert
is open, and ResolveOpenAsync exists because [F02-R26]'s resolution path has nowhere else to live.
DbOperationalAlertRaiser is plan 3's stand-in, also registered with TryAdd, and deliberately never
calls SaveChangesAsync - the alert belongs to the same transaction as the FAILED status it explains.

FakeBrpIngestionAdapter and TestDocument are test doubles over a format nobody will ship. They are
what makes design §9's claim true rather than aspirational: versioning, supersession, quarantine and
atomicity are proven without any BRP format being right.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: The processing handler — dequeue, resolve, parse, and the two non-applying outcomes

The apply half begins. This task builds the handler end to end for the simplest case and both
outcomes that write no readings:

- **`Rejected`** → the message is `FAILED` with the adapter's code and detail, a
  `VALIDATION_FAILURE` alert is raised, **zero** `interval_reading` rows are written, and the
  webhook has already answered 200 (`[F02-R12]`, `[F02-R05]`).
- **`RecognisedAndClosed`** → the message is `PROCESSED` with **zero** readings. `[DEC-25]` puts
  imbalance out of scope: an A12 document is recognised, stored and closed rather than failed
  (design §7.13).
- **`Accepted`** → for a series whose EAN resolves to exactly one metering point, a version and its
  readings land. Quarantine, preconditions, the advisory lock, supersession and replay idempotence
  arrive in Tasks 12–16; this task is the spine they attach to.

⚠ **The adapter is resolved from the stored `brp_id`'s `adapter_key`** — S2-D3, and Task 11 proves
it with a second adapter registered.

⚠ **`IntervalReading.IntervalStart` comes from `IMarketCalendar.IntervalStart(deliveryDate, pos)`,
never from a local add-15-minutes loop.** The mapping lives in `Infrastructure.Time` and only
there, so parser, rollup and chart cannot disagree. Design §10.3 mutation-verifies the mapping
itself in plan 1; what this plan must not do is create a second copy of it.

⚠ **`IntervalDataVersion.ReceivedAt` is the MESSAGE's receipt time, never `now()` at apply time.**
Contract §9.6 step 6 says so, and Task 15's supersession rests on it entirely: a job that ran late
would otherwise re-order two versions by when the worker got to them.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/IInboundMessageProcessor.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/ProcessInboundMessageHandler.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/ProcessingOutcomeTests.cs`

**Interfaces:**
- Consumes: `IBrpIngestionAdapterRegistry`, `IRawPayloadStore`, `BrpParseStatus`, `BrpDocument`,
  `CanonicalSeries` (Tasks 1–3); `IOperationalAlertRaiser`, `IDayStateRecomputer`,
  `MeteringPointDay` (Task 9); `IMarketCalendar.IntervalStart`;
  `InboundMessage.BeginProcessing/MarkProcessed/MarkFailed`,
  `IntervalDataVersion.FromBrpFeed`, `IntervalReading.Create` (plan 2).
- Produces: `IInboundMessageProcessor` · `InboundMessageProcessingOutcome` ·
  `InboundMessageProcessingStatus` · `ProcessInboundMessageHandler` (which implements **both**
  `IInboundMessageProcessor` and the contract's `IProcessInboundMessageHandler`).

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/ProcessingOutcomeTests.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Adapters;
using PeakPower.Ingestion.Processing;
using PeakPower.Ingestion.Receipt;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

/// <summary>
/// The three parse outcomes, and what each leaves behind. Runs the real handler against the real
/// database through the real receipt path.
/// </summary>
public sealed class ProcessingOutcomeTests(WorkerFactory factory) : IClassFixture<WorkerFactory>
{
    private static readonly DateOnly Day = new(2026, 8, 12);

    private async Task<Guid> ReceiveAsync(Guid brpId, byte[] payload)
    {
        using var scope = factory.Services.CreateScope();
        var receiver = scope.ServiceProvider.GetRequiredService<IInboundMessageReceiver>();

        var receipt = await receiver.ReceiveAsync(
            new InboundMessageArrival(brpId, Guid.CreateVersion7(), payload, null, "10.0.0.7"),
            TestContext.Current.CancellationToken);

        return receipt.InboundMessageId;
    }

    private async Task<InboundMessageProcessingOutcome> ProcessAsync(Guid messageId)
    {
        using var scope = factory.Services.CreateScope();
        var processor = scope.ServiceProvider.GetRequiredService<IInboundMessageProcessor>();

        await using var db = factory.CreateOwnerDbContext();
        var correlationId = await db.InboundMessages.AsNoTracking()
            .Where(m => m.Id == messageId)
            .Select(m => m.CorrelationId)
            .SingleAsync(TestContext.Current.CancellationToken);

        return await processor.ProcessAsync(
            messageId, correlationId, TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task an_accepted_document_lands_a_version_and_its_readings()
    {
        await using var arrange = factory.CreateOwnerDbContext();
        var brpId = await IngestionSeed.AddBrpAsync(arrange, "PRC1", ct: TestContext.Current.CancellationToken);
        var customerId = await IngestionSeed.AddCustomerAsync(
            arrange, "Van der Steen Logistiek B.V.", "12345601", TestContext.Current.CancellationToken);
        var ean = IngestionSeed.NextEan();
        var pointId = await IngestionSeed.AddMeteringPointAsync(
            arrange, customerId, brpId, ean, new DateOnly(2026, 1, 1),
            ct: TestContext.Current.CancellationToken);

        var payload = new TestDocument("DOC-PRC1", DateTimeOffset.Parse("2026-08-13T03:00:00Z", null))
            .WithFlatDay(ean, Day, IntervalDirection.Consumption, 180.0m)
            .ToBytes();

        var messageId = await ReceiveAsync(brpId, payload);
        var outcome = await ProcessAsync(messageId);

        outcome.Status.ShouldBe(InboundMessageProcessingStatus.Applied);
        outcome.VersionsCreated.ShouldBe(1);

        await using var db = factory.CreateOwnerDbContext();
        var version = await db.IntervalDataVersions.AsNoTracking()
            .SingleAsync(v => v.InboundMessageId == messageId, TestContext.Current.CancellationToken);

        version.MeteringPointId.ShouldBe(pointId);
        version.CustomerId.ShouldBe(customerId);
        version.DeliveryDate.ShouldBe(Day);
        version.Direction.ShouldBe(IntervalDirection.Consumption);
        version.Source.ShouldBe(IntervalDataVersionSource.BrpFeed);
        version.DocumentId.ShouldBe("DOC-PRC1");
        version.IntervalCount.ShouldBe((short)96);
        version.IsCurrent.ShouldBeTrue();

        var readings = await db.IntervalReadings.AsNoTracking()
            .Where(r => r.VersionId == version.Id)
            .OrderBy(r => r.Pos)
            .ToListAsync(TestContext.Current.CancellationToken);

        readings.Count.ShouldBe(96);
        readings[0].Pos.ShouldBe((short)1);
        readings[0].QuantityKwh.ShouldBe(180.0m);
        readings[0].CustomerId.ShouldBe(customerId);
        readings[0].DeliveryDate.ShouldBe(Day);
        readings[95].Pos.ShouldBe((short)96);

        var message = await db.InboundMessages.AsNoTracking()
            .SingleAsync(m => m.Id == messageId, TestContext.Current.CancellationToken);
        message.Status.ShouldBe(InboundMessageStatus.Processed);
        message.ProcessedAt.ShouldNotBeNull();
    }

    [Fact]
    public async Task the_version_carries_the_MESSAGE_receipt_time_not_the_apply_time()
    {
        // Shared contract §9.6 step 6. Task 15's supersession rests on this entirely: a job that
        // ran late would otherwise re-order two versions by when the worker got to them.
        await using var arrange = factory.CreateOwnerDbContext();
        var brpId = await IngestionSeed.AddBrpAsync(arrange, "PRC2", ct: TestContext.Current.CancellationToken);
        var customerId = await IngestionSeed.AddCustomerAsync(
            arrange, "Receipt Time B.V.", "12345602", TestContext.Current.CancellationToken);
        var ean = IngestionSeed.NextEan();
        await IngestionSeed.AddMeteringPointAsync(
            arrange, customerId, brpId, ean, new DateOnly(2026, 1, 1),
            ct: TestContext.Current.CancellationToken);

        var messageId = await ReceiveAsync(
            brpId,
            new TestDocument("DOC-PRC2", DateTimeOffset.Parse("2026-08-13T03:00:00Z", null))
                .WithFlatDay(ean, Day, IntervalDirection.Consumption, 1.0m)
                .ToBytes());

        await ProcessAsync(messageId);

        await using var db = factory.CreateOwnerDbContext();
        var message = await db.InboundMessages.AsNoTracking()
            .SingleAsync(m => m.Id == messageId, TestContext.Current.CancellationToken);
        var version = await db.IntervalDataVersions.AsNoTracking()
            .SingleAsync(v => v.InboundMessageId == messageId, TestContext.Current.CancellationToken);

        version.ReceivedAt.ShouldBe(message.ReceivedAt);
        version.CorrelationId.ShouldBe(message.CorrelationId);
    }

    [Fact]
    public async Task a_rejected_document_lands_FAILED_with_a_code_and_zero_readings()
    {
        await using var arrange = factory.CreateOwnerDbContext();
        var brpId = await IngestionSeed.AddBrpAsync(arrange, "PRC3", ct: TestContext.Current.CancellationToken);

        // Arbitrary bytes and the rejecting adapter: exactly design step 4's shape.
        var messageId = await ReceiveAsync(brpId, [0x00, 0x01, 0x02]);
        var outcome = await ProcessAsync(messageId);

        outcome.Status.ShouldBe(InboundMessageProcessingStatus.Failed);
        outcome.VersionsCreated.ShouldBe(0);
        outcome.FailureCode.ShouldBe(RejectingBrpIngestionAdapter.FailureCode);

        await using var db = factory.CreateOwnerDbContext();
        var message = await db.InboundMessages.AsNoTracking()
            .SingleAsync(m => m.Id == messageId, TestContext.Current.CancellationToken);

        message.Status.ShouldBe(InboundMessageStatus.Failed);
        message.FailureCode.ShouldBe(RejectingBrpIngestionAdapter.FailureCode);
        message.FailureDetail.ShouldNotBeNullOrWhiteSpace();

        // Asserted by ROW COUNT, not by a status field. A status column can be wrong; a row count
        // cannot.
        (await db.IntervalDataVersions.CountAsync(
            v => v.InboundMessageId == messageId, TestContext.Current.CancellationToken)).ShouldBe(0);
    }

    [Fact]
    public async Task a_rejected_document_raises_a_VALIDATION_FAILURE_alert()
    {
        await using var arrange = factory.CreateOwnerDbContext();
        var brpId = await IngestionSeed.AddBrpAsync(arrange, "PRC4", ct: TestContext.Current.CancellationToken);

        var messageId = await ReceiveAsync(brpId, [0x7F]);
        await ProcessAsync(messageId);

        await using var db = factory.CreateOwnerDbContext();
        var alert = await db.OperationalAlerts.AsNoTracking()
            .SingleAsync(a => a.InboundMessageId == messageId, TestContext.Current.CancellationToken);

        alert.Kind.ShouldBe(OperationalAlertKind.ValidationFailure);
        alert.Status.ShouldBe(OperationalAlertStatus.Open);
        alert.BrpId.ShouldBe(brpId);
        alert.Detail.ShouldContain(RejectingBrpIngestionAdapter.FailureCode, Case.Sensitive);
    }

    [Fact]
    public async Task a_recognised_and_closed_document_reaches_PROCESSED_with_zero_readings()
    {
        // [DEC-25], design §7.13: an imbalance document is recognised, stored and closed - not
        // failed. A FAILED row would put a routine document on the employee quarantine screen every
        // day and train the operator to ignore it.
        var adapter = new FakeBrpIngestionAdapter("FAKE_IMBALANCE_V1");
        factory.ExtraAdapters.Add(adapter);

        await using var arrange = factory.CreateOwnerDbContext();
        var brpId = await IngestionSeed.AddBrpAsync(arrange, "PRC5", ct: TestContext.Current.CancellationToken);
        await SetAdapterKeyAsync(brpId, "FAKE_IMBALANCE_V1");

        var payload = new TestDocument(
                "DOC-PRC5",
                DateTimeOffset.Parse("2026-08-13T03:00:00Z", null),
                TestDocument.BrpDocumentKindLabel.Imbalance)
            .ToBytes();

        var messageId = await ReceiveAsync(brpId, payload);
        var outcome = await ProcessAsync(messageId);

        outcome.Status.ShouldBe(InboundMessageProcessingStatus.RecognisedAndClosed);

        await using var db = factory.CreateOwnerDbContext();
        var message = await db.InboundMessages.AsNoTracking()
            .SingleAsync(m => m.Id == messageId, TestContext.Current.CancellationToken);

        message.Status.ShouldBe(InboundMessageStatus.Processed);
        message.FailureCode.ShouldBeNull();
        (await db.IntervalReadings.CountAsync(TestContext.Current.CancellationToken))
            .ShouldBeGreaterThanOrEqualTo(0);
        (await db.IntervalDataVersions.CountAsync(
            v => v.InboundMessageId == messageId, TestContext.Current.CancellationToken)).ShouldBe(0);
    }

    [Fact]
    public async Task recomputes_derived_data_for_every_touched_point_and_day()
    {
        var recomputer = new RecordingDayStateRecomputer();

        await using var arrange = factory.CreateOwnerDbContext();
        var brpId = await IngestionSeed.AddBrpAsync(arrange, "PRC6", ct: TestContext.Current.CancellationToken);
        var customerId = await IngestionSeed.AddCustomerAsync(
            arrange, "Recompute B.V.", "12345603", TestContext.Current.CancellationToken);
        var ean = IngestionSeed.NextEan();
        var pointId = await IngestionSeed.AddMeteringPointAsync(
            arrange, customerId, brpId, ean, new DateOnly(2026, 1, 1),
            ct: TestContext.Current.CancellationToken);

        var messageId = await ReceiveAsync(
            brpId,
            new TestDocument("DOC-PRC6", DateTimeOffset.Parse("2026-08-13T03:00:00Z", null))
                .WithFlatDay(ean, Day, IntervalDirection.Consumption, 2.0m)
                .WithFlatDay(ean, Day, IntervalDirection.Production, 1.0m)
                .ToBytes());

        using var scope = factory.Services.CreateScope();
        var processor = ActivatorUtilities.CreateInstance<ProcessInboundMessageHandler>(
            scope.ServiceProvider, recomputer);

        await using var db = factory.CreateOwnerDbContext();
        var correlationId = await db.InboundMessages.AsNoTracking()
            .Where(m => m.Id == messageId)
            .Select(m => m.CorrelationId)
            .SingleAsync(TestContext.Current.CancellationToken);

        await processor.ProcessAsync(messageId, correlationId, TestContext.Current.CancellationToken);

        // Two directions, one day, one point: ONE (point, day) pair, not two. The rollup is keyed
        // on (metering point, delivery date) and recomputing it twice would do the same work twice
        // inside a lock.
        recomputer.Touched.ShouldBe([new MeteringPointDay(pointId, Day)]);

        // [DEC-98]'s reopen switch (contract §7.6): an apply that created a version passes the
        // MESSAGE's receipt time, which is what lets the recomputer return a FINAL date to
        // PROVISIONAL [F02-R45]. Null here would leave a stale FINAL on a date that just changed.
        await using var messageRead = factory.CreateOwnerDbContext();
        var receivedAt = await messageRead.InboundMessages.AsNoTracking()
            .Where(m => m.Id == messageId)
            .Select(m => m.ReceivedAt)
            .SingleAsync(TestContext.Current.CancellationToken);

        recomputer.NewVersionReceivedAt.ShouldBe([receivedAt]);
    }

    private async Task SetAdapterKeyAsync(Guid brpId, string adapterKey)
    {
        await using var db = factory.CreateOwnerDbContext();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE metering.brp SET adapter_key = {adapterKey} WHERE id = {brpId}",
            TestContext.Current.CancellationToken);
    }

    private sealed class RecordingDayStateRecomputer : IDayStateRecomputer
    {
        public List<MeteringPointDay> Touched { get; } = [];

        public List<DateTimeOffset?> NewVersionReceivedAt { get; } = [];

        public Task<DayRecomputeResult> RecomputeAsync(
            DayRecomputeRequest request, CancellationToken ct)
        {
            Touched.Add(new MeteringPointDay(request.MeteringPointId, request.DeliveryDate));
            NewVersionReceivedAt.Add(request.NewVersionReceivedAt);

            return Task.FromResult(new DayRecomputeResult(
                MeteringDayState.NoData, 96, false, false, false, false, false,
                0m, 0m, 0m, 0m, 0m));
        }
    }
}
```

⚠ `SetAdapterKeyAsync` writes SQL from a **test**, not from the pipeline. That is allowed — plan 3
never writes migration SQL, and this is an arrange step against a column plan 2 created. Doing it
through `ExecuteSqlInterpolatedAsync` rather than through `Brp` keeps the test independent of
whatever mutator plan 2 gives that entity.

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ProcessingOutcomeTests"
```

Expected: FAIL — build error
`error CS0246: The type or namespace name 'IInboundMessageProcessor' could not be found`.

- [ ] **Step 3: Declare the processor and its outcome**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/IInboundMessageProcessor.cs`:

```csharp
namespace PeakPower.Ingestion.Processing;

public enum InboundMessageProcessingStatus
{
    /// <summary>Series were applied. At least one version was created.</summary>
    Applied,

    /// <summary>
    /// The document was parsed and applied nothing, because every series it carries already
    /// matches the current version. [F02-R27]'s replay case.
    /// </summary>
    NoChange,

    /// <summary>The adapter rejected the document. Zero readings written. [F02-R12]</summary>
    Failed,

    /// <summary>
    /// The document was recognised, stored and closed with zero readings — the A12 imbalance case
    /// under [DEC-25].
    /// </summary>
    RecognisedAndClosed,
}

/// <summary>What one processing run did, in the terms the employee replay response reports.</summary>
/// <remarks>
/// Plan 6's <c>POST /api/v1/data-health/messages/{id}/replay</c> reports
/// <c>REPLAYED | NO_CHANGE | FAILED</c>. The mapping is
/// <see cref="InboundMessageProcessingStatus.Applied"/> → <c>REPLAYED</c>,
/// <see cref="InboundMessageProcessingStatus.NoChange"/> and
/// <see cref="InboundMessageProcessingStatus.RecognisedAndClosed"/> → <c>NO_CHANGE</c>,
/// <see cref="InboundMessageProcessingStatus.Failed"/> → <c>FAILED</c>.
/// </remarks>
public sealed record InboundMessageProcessingOutcome(
    InboundMessageProcessingStatus Status,
    int VersionsCreated,
    int QuarantineEntriesCreated,
    int QuarantineEntriesResolved,
    int LabelledSeriesSkipped,
    string? FailureCode,
    string? FailureDetail);

/// <summary>
/// Processes one stored message and says what it did.
/// </summary>
/// <remarks>
/// Shared contract §7.4 freezes <c>IProcessInboundMessageHandler.HandleAsync</c> as returning
/// <c>Task</c>, which is the right shape for a queue: there is nobody to hand a result to. Replay
/// (plan 6) needs the counts, so the same class implements both, and this is the interface with the
/// answer on it.
/// </remarks>
public interface IInboundMessageProcessor
{
    Task<InboundMessageProcessingOutcome> ProcessAsync(
        Guid inboundMessageId, Guid correlationId, CancellationToken ct);
}
```

- [ ] **Step 4: Implement the handler**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/ProcessInboundMessageHandler.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using PeakPower.Application.Abstractions;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Metering;
using PeakPower.Persistence;

namespace PeakPower.Ingestion.Processing;

/// <summary>
/// The apply transaction of shared contract §9.6, in one place.
/// </summary>
public sealed class ProcessInboundMessageHandler(
    PeakPowerDbContext db,
    IBrpIngestionAdapterRegistry adapters,
    IRawPayloadStore payloads,
    IOperationalAlertRaiser alerts,
    IDayStateRecomputer dayStates,
    IMarketCalendar calendar,
    ILogger<ProcessInboundMessageHandler> logger)
    : IInboundMessageProcessor, IProcessInboundMessageHandler
{
    /// <summary>The queue's entry point. Shared contract §7.4.</summary>
    public Task HandleAsync(Guid inboundMessageId, Guid correlationId, CancellationToken ct) =>
        ProcessAsync(inboundMessageId, correlationId, ct);

    public async Task<InboundMessageProcessingOutcome> ProcessAsync(
        Guid inboundMessageId, Guid correlationId, CancellationToken ct)
    {
        using var scope = logger.BeginScope(new Dictionary<string, object>
        {
            ["CorrelationId"] = correlationId,
            ["InboundMessageId"] = inboundMessageId,
        });

        var message = await db.InboundMessages
            .SingleOrDefaultAsync(m => m.Id == inboundMessageId, ct)
            ?? throw new InvalidOperationException(
                $"Inbound message {inboundMessageId} does not exist.");

        // Step 1 of shared contract §9.6.
        message.BeginProcessing();

        // Step 2. S2-D3: the adapter comes from the STORED brp_id's adapter_key. Never from a
        // field in the payload, never from the route, never from "the only adapter there is" -
        // which is what makes a replay parse under the adapter that first parsed it, including
        // after that BRP has been deactivated. AsNoTracking and no is_active predicate: a
        // deactivated BRP still replays.
        var brp = await db.Brps.AsNoTracking()
            .Where(candidate => candidate.Id == message.BrpId)
            .Select(candidate => new { candidate.Code, candidate.AdapterKey })
            .SingleAsync(ct);

        var adapter = adapters.Resolve(brp.AdapterKey);

        // Step 3. Read the payload back from the store, so a replay parses exactly the bytes that
        // arrived rather than anything re-derived from them.
        var payload = await payloads.ReadAsync(message.PayloadUri, ct);

        var outcome = adapter.Parse(new BrpParseRequest(
            message.Id, message.BrpId, brp.Code, correlationId, payload, message.ReceivedAt));

        return outcome.Status switch
        {
            BrpParseStatus.Rejected => await RejectAsync(message, outcome, ct),
            BrpParseStatus.RecognisedAndClosed => await CloseAsync(message, ct),
            BrpParseStatus.Accepted => await ApplyAsync(message, outcome.Document!, correlationId, ct),
            _ => throw new InvalidOperationException(
                $"Unhandled parse status {outcome.Status} from adapter {adapter.AdapterKey}."),
        };
    }

    /// <summary>
    /// [F02-R12]/[F02-R13]: the message is FAILED with a machine-readable code and a
    /// human-readable message, an operator alert is raised, and <b>nothing</b> is applied. The
    /// webhook answered 200 long ago; there is nobody left to return a status to.
    /// </summary>
    private async Task<InboundMessageProcessingOutcome> RejectAsync(
        InboundMessage message, BrpParseOutcome outcome, CancellationToken ct)
    {
        var failedAt = calendar.UtcNow;
        message.MarkFailed(outcome.FailureCode!, outcome.FailureDetail!, failedAt);

        // RaisedAt is supplied here rather than read inside the raiser: contract §7.6 keeps the
        // clock out of PeakPower.Application (architecture fact 5). It is the SAME instant that
        // MarkFailed just stamped, so the alert and the FAILED status agree to the tick - two
        // clock reads a few milliseconds apart would sort inconsistently on the employee screen.
        await alerts.RaiseAsync(
            new OperationalAlertRequest(
                OperationalAlertKind.ValidationFailure,
                Summary: "An inbound BRP document failed validation.",
                Detail: $"{outcome.FailureCode}: {outcome.FailureDetail}",
                MeteringPointId: null,
                BrpId: message.BrpId,
                InboundMessageId: message.Id,
                DeliveryDate: null,
                RaisedAt: failedAt),
            ct);

        await db.SaveChangesAsync(ct);

        logger.LogWarning(
            "Inbound message failed validation with {FailureCode}.", outcome.FailureCode);

        return new InboundMessageProcessingOutcome(
            InboundMessageProcessingStatus.Failed, 0, 0, 0, 0,
            outcome.FailureCode, outcome.FailureDetail);
    }

    /// <summary>
    /// [DEC-25]: an imbalance document is recognised, stored and closed with zero readings. It is
    /// PROCESSED and not FAILED, because a FAILED row would put a routine document on the employee
    /// quarantine screen every day and train the operator to ignore the screen.
    /// </summary>
    private async Task<InboundMessageProcessingOutcome> CloseAsync(
        InboundMessage message, CancellationToken ct)
    {
        message.MarkProcessed(calendar.UtcNow);
        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Inbound message was recognised and closed with no readings written.");

        return new InboundMessageProcessingOutcome(
            InboundMessageProcessingStatus.RecognisedAndClosed, 0, 0, 0, 0, null, null);
    }

    /// <summary>
    /// Steps 4 to 8 of shared contract §9.6. Tasks 12 to 16 add the advisory lock, the precondition
    /// guard, quarantine, supersession and replay idempotence to this method; it is written here
    /// with the one case they all build on.
    /// </summary>
    private async Task<InboundMessageProcessingOutcome> ApplyAsync(
        InboundMessage message, BrpDocument document, Guid correlationId, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        var versionsCreated = 0;
        var touched = new HashSet<MeteringPointDay>();

        foreach (var series in document.Series)
        {
            // The adapter never resolves an EAN (shared contract §7.1), so this is where a series
            // becomes a metering point. Tasks 12 and 13 add the precondition guard and the four
            // quarantine reasons around this lookup.
            var point = await db.MeteringPoints.AsNoTracking()
                .Where(candidate =>
                    candidate.Ean == series.Ean!.Value
                    && candidate.ValidFrom <= series.DeliveryDate
                    && (candidate.ValidTo == null || series.DeliveryDate < candidate.ValidTo))
                .Select(candidate => new { candidate.Id, candidate.CustomerId })
                .SingleAsync(ct);

            var version = IntervalDataVersion.FromBrpFeed(
                point.Id,
                point.CustomerId,
                series.DeliveryDate,
                series.Direction,
                document.DocumentId,
                document.DocumentCreated,
                // The MESSAGE's receipt time, never now(). Shared contract §9.6 step 6.
                message.ReceivedAt,
                message.Id,
                correlationId,
                (short)series.ExpectedIntervalCount);

            if (!version.IsSuccess)
            {
                throw new InvalidOperationException(
                    $"Could not create an interval data version: {version.Error}");
            }

            db.IntervalDataVersions.Add(version.Value);
            versionsCreated++;

            foreach (var point_ in series.Points)
            {
                var reading = IntervalReading.Create(
                    version.Value.Id,
                    series.DeliveryDate,
                    point.CustomerId,
                    (short)point_.Pos,
                    // The ONE DST mapping, from Infrastructure.Time. A local add-15-minutes loop
                    // here would be a second answer, and on the autumn fall-back day it would be
                    // the wrong one - plausible data written an hour early.
                    calendar.IntervalStart(series.DeliveryDate, point_.Pos),
                    point_.QuantityKwh);

                if (!reading.IsSuccess)
                {
                    throw new InvalidOperationException(
                        $"Could not create an interval reading: {reading.Error}");
                }

                db.IntervalReadings.Add(reading.Value);
            }

            touched.Add(new MeteringPointDay(point.Id, series.DeliveryDate));
        }

        message.MarkProcessed(calendar.UtcNow);

        // Step 7, INSIDE the transaction. [F02-R34]'s promotion and migration 9's
        // ck_mp_never_has_no_observed_production both require it.
        //
        // ONE call per touched pair, not one call for the list: contract §7.6 pins the per-pair
        // shape, because only a per-pair request can carry NewVersionReceivedAt. Ordered by
        // (metering point, delivery date) - the same total order Task 14 will take the advisory
        // locks in, and Task 14 replaces this OrderBy with AdvisoryLock.InLockOrder(touched) so
        // there is one definition of that order rather than two that can drift apart.
        //
        // ⚠ NewVersionReceivedAt is the MESSAGE's receipt time, and passing it is what tells the
        // recomputer a real version landed. [DEC-98] makes FINAL a status rather than a guarantee,
        // so a post-window version returns the date to PROVISIONAL and re-finalises [F02-R45].
        // Passing null here would leave a stale FINAL on a date that has just changed; passing a
        // value from a replay that created nothing would reopen finalised dates for no reason.
        // Both are silent, which is why the value travels on the request rather than being
        // inferred inside the recomputer.
        foreach (var pair in touched
            .OrderBy(candidate => candidate.MeteringPointId)
            .ThenBy(candidate => candidate.DeliveryDate))
        {
            await dayStates.RecomputeAsync(
                new DayRecomputeRequest(
                    pair.MeteringPointId, pair.DeliveryDate, correlationId, message.ReceivedAt),
                ct);
        }

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        logger.LogInformation(
            "Applied {VersionCount} version(s) across {DayCount} (metering point, delivery date) pair(s).",
            versionsCreated, touched.Count);

        return new InboundMessageProcessingOutcome(
            InboundMessageProcessingStatus.Applied, versionsCreated, 0, 0, 0, null, null);
    }
}
```

⚠ The inner loop variable is named `point_` deliberately: `point` is already the resolved metering
point, and shadowing it with a `CanonicalPoint` is exactly the confusion that puts a metering point
id in a `Pos` column. Rename both if a clearer pair suggests itself, but do not let one name mean
two things.

- [ ] **Step 5: Register the handler so the tests can resolve it**

Add to `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Program.cs`, in
the TEMPORARY block from Task 6 (Task 17 replaces the whole block):

```csharp
builder.Services.AddScoped<PeakPower.Application.Abstractions.Ingestion.IBrpIngestionAdapterRegistry,
    PeakPower.Ingestion.Adapters.BrpIngestionAdapterRegistry>();
builder.Services.AddSingleton<PeakPower.Application.Abstractions.Ingestion.IBrpIngestionAdapter>(
    new PeakPower.Ingestion.Adapters.RejectingBrpIngestionAdapter("PVNED_TIMESERIES_XML_V2P0"));
builder.Services.TryAddScoped<PeakPower.Application.Abstractions.Ingestion.IOperationalAlertRaiser,
    PeakPower.Ingestion.Processing.DbOperationalAlertRaiser>();
builder.Services.TryAddScoped<PeakPower.Application.Abstractions.Ingestion.IDayStateRecomputer,
    PeakPower.Ingestion.Processing.NoOpDayStateRecomputer>();
builder.Services.AddScoped<PeakPower.Ingestion.Processing.ProcessInboundMessageHandler>();
builder.Services.AddScoped<PeakPower.Ingestion.Processing.IInboundMessageProcessor>(
    services => services.GetRequiredService<PeakPower.Ingestion.Processing.ProcessInboundMessageHandler>());
builder.Services.AddScoped<PeakPower.Application.Abstractions.Ingestion.IProcessInboundMessageHandler>(
    services => services.GetRequiredService<PeakPower.Ingestion.Processing.ProcessInboundMessageHandler>());
```

with `using Microsoft.Extensions.DependencyInjection.Extensions;` for `TryAddScoped`.

⚠ **One concrete registration, two interface registrations resolving to it.** Registering the class
twice would give a scope two handlers and two change trackers' worth of confusion; the factory
overloads keep it one object per scope.

⚠ **`TryAddScoped` for BOTH plan-5 seams, not just the recomputer.** Contract §7.6 gives plan 5 the
implementation of `IOperationalAlertRaiser` as well — its version dedupes by (kind, metering point,
delivery date) and carries `ResolveOpenAsync`, which `[F02-R26]`'s resolution path needs. A plain
`AddScoped` here would leave both registrations live and let file order decide which one writes
`metering.operational_alert`, which is exactly the "two implementations of one table" the port's own
doc comment exists to forbid.

- [ ] **Step 6: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ProcessingOutcomeTests"
```

Expected: PASS — 6 tests, 0 failed.

- [ ] **Step 7: Verify by mutation — the version's `ReceivedAt` is the message's**

**What to break:** in `ApplyAsync`, replace `message.ReceivedAt` with `calendar.UtcNow`.

**What to predict:** `the_version_carries_the_MESSAGE_receipt_time_not_the_apply_time` fails with
`version.ReceivedAt should be 2026-…Z but was 2026-…Z` — two instants that differ by however long
the test took.

**What to watch go red:** that one test. Everything else stays green, and that is the danger: this
mutation is invisible until two documents for the same day arrive close together, at which point
supersession orders them by when the *worker* got to them. Task 15 is where it becomes catastrophic;
this is where it is cheap to catch.

Restore.

- [ ] **Step 8: Verify by mutation — a rejection writes nothing**

**What to break:** in `RejectAsync`, before `MarkFailed`, add
`db.IntervalDataVersions.Add(IntervalDataVersion.FromBrpFeed(...).Value);` with any plausible
arguments (this is the "partially applied a document it then failed" bug `[F02-R12]` names).

**What to predict:** `a_rejected_document_lands_FAILED_with_a_code_and_zero_readings` fails on
`db.IntervalDataVersions.CountAsync(...) should be 0 but was 1`.

**What to watch go red:** that count assertion — **not** the status assertion, which stays green.
That is the whole reason the test asserts by row count: `message.Status` reads `FAILED` in both the
correct and the broken implementation.

Restore.

- [ ] **Step 9: Verify by mutation — the derived-data recompute is deduplicated per (point, day)**

**What to break:** change `touched` from a `HashSet<MeteringPointDay>` to a
`List<MeteringPointDay>`.

**What to predict:** `recomputes_derived_data_for_every_touched_point_and_day` fails with
`recomputer.Touched should be [MeteringPointDay { … }] but was [MeteringPointDay { … }, MeteringPointDay { … }]`
— the same pair twice, once per direction.

**What to watch go red:** that one. Plan 5's recomputer does real work inside a lock; asking it to
do that work twice for one day is a doubling that only shows up under load.

Restore.

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Ingestion/Processing/IInboundMessageProcessor.cs \
        src/Infrastructure/PeakPower.Ingestion/Processing/ProcessInboundMessageHandler.cs \
        src/Hosts/PeakPower.Worker/Program.cs \
        tests/PeakPower.Integration.Tests/Ingestion/ProcessingOutcomeTests.cs
git commit -m "feat(ingestion): process a stored message through the adapter its brp_id names

Shared contract §9.6 steps 1-3 and 6-8, with the three parse outcomes. Rejected lands FAILED with a
code and raises a VALIDATION_FAILURE alert; RecognisedAndClosed lands PROCESSED with zero readings
([DEC-25]); Accepted writes a version and its readings.

Two mutations that matter. Replacing the version's ReceivedAt with now() fails only one test and is
invisible until two documents for one day arrive close together - at which point supersession orders
them by when the worker got to them. Adding a version inside the reject path leaves message.Status
reading FAILED and is caught only by the row-count assertion, which is why [F02-R13] is asserted
that way.

Interval starts come from IMarketCalendar and only from there: a local add-15-minutes loop is a
second answer to the DST question, and on the autumn day it is the wrong one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: S2-D3 proved — a second adapter registered, and a deactivated BRP

Design §7.7 is a definition-of-done item in its own right:

> A message whose BRP row is subsequently set inactive still replays through the adapter selected by
> the stored `brp_id` — **asserted with a second adapter registered**, to prove selection is not the
> default and that no field of the payload is consulted.

Task 10 already resolves by the stored `brp_id`'s `adapter_key`. This task is the proof, and its
value is entirely in the mutations: a "resolve the only adapter there is" implementation passes
every other test in this plan.

⚠ **These tests may pass on the first run.** That is expected and is not evidence. Steps 3 and 4
are what make them evidence, and neither may be skipped.

**Files:**
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/AdapterResolutionTests.cs`

**Interfaces:**
- Consumes: `WorkerFactory.ExtraAdapters` (Task 6); `FakeBrpIngestionAdapter`, `IngestionSeed`,
  `TestDocument` (Task 9); `IInboundMessageProcessor` (Task 10).
- Produces: nothing new.

- [ ] **Step 1: Write the test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/AdapterResolutionTests.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Processing;
using PeakPower.Ingestion.Receipt;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

/// <summary>
/// S2-D3 and [F02-R41]: the adapter is selected by the <b>stored</b> <c>brp_id</c>'s
/// <c>adapter_key</c>, at dequeue time — never by a field in the payload, never by the route,
/// never by a default.
/// </summary>
/// <remarks>
/// Two adapters are registered in every test here, deliberately. Design §7.7 requires it: with one
/// adapter installed, "resolve the only one there is" is indistinguishable from correct, and it is
/// the implementation an unwary reader writes.
/// </remarks>
public sealed class AdapterResolutionTests : IClassFixture<AdapterResolutionTests.TwoAdapterFactory>
{
    private static readonly DateOnly Day = new(2026, 8, 12);

    private readonly TwoAdapterFactory _factory;

    public AdapterResolutionTests(TwoAdapterFactory factory) => _factory = factory;

    /// <summary>A factory that registers two distinguishable fake adapters beside the rejecting default.</summary>
    public sealed class TwoAdapterFactory : WorkerFactory
    {
        public FakeBrpIngestionAdapter AlphaAdapter { get; } = new("FAKE_ALPHA_V1");

        public FakeBrpIngestionAdapter BetaAdapter { get; } = new("FAKE_BETA_V1");

        public TwoAdapterFactory()
        {
            ExtraAdapters.Add(AlphaAdapter);
            ExtraAdapters.Add(BetaAdapter);
        }
    }

    private async Task<Guid> SeedBrpAsync(string code, string adapterKey, bool isActive = true)
    {
        await using var db = _factory.CreateOwnerDbContext();
        var brpId = await IngestionSeed.AddBrpAsync(
            db, code, isActive, TestContext.Current.CancellationToken);

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE metering.brp SET adapter_key = {adapterKey} WHERE id = {brpId}",
            TestContext.Current.CancellationToken);

        return brpId;
    }

    private async Task<Guid> ReceiveAsync(Guid brpId, byte[] payload)
    {
        using var scope = _factory.Services.CreateScope();
        var receiver = scope.ServiceProvider.GetRequiredService<IInboundMessageReceiver>();

        var receipt = await receiver.ReceiveAsync(
            new InboundMessageArrival(brpId, Guid.CreateVersion7(), payload, null, "10.0.0.7"),
            TestContext.Current.CancellationToken);

        return receipt.InboundMessageId;
    }

    private async Task ProcessAsync(Guid messageId)
    {
        using var scope = _factory.Services.CreateScope();
        var processor = scope.ServiceProvider.GetRequiredService<IInboundMessageProcessor>();

        await using var db = _factory.CreateOwnerDbContext();
        var correlationId = await db.InboundMessages.AsNoTracking()
            .Where(m => m.Id == messageId)
            .Select(m => m.CorrelationId)
            .SingleAsync(TestContext.Current.CancellationToken);

        await processor.ProcessAsync(messageId, correlationId, TestContext.Current.CancellationToken);
    }

    private async Task<byte[]> SeedPointAndDocumentAsync(Guid brpId, string documentId, string kvk)
    {
        await using var db = _factory.CreateOwnerDbContext();
        var customerId = await IngestionSeed.AddCustomerAsync(
            db, $"Adapter {documentId} B.V.", kvk, TestContext.Current.CancellationToken);
        var ean = IngestionSeed.NextEan();
        await IngestionSeed.AddMeteringPointAsync(
            db, customerId, brpId, ean, new DateOnly(2026, 1, 1),
            ct: TestContext.Current.CancellationToken);

        return new TestDocument(documentId, DateTimeOffset.Parse("2026-08-13T03:00:00Z", null))
            .WithFlatDay(ean, Day, IntervalDirection.Consumption, 1.0m)
            .ToBytes();
    }

    [Fact]
    public async Task the_message_is_parsed_by_the_adapter_its_brp_row_names_and_not_the_other_one()
    {
        var brpId = await SeedBrpAsync("ADR1", "FAKE_BETA_V1");
        var payload = await SeedPointAndDocumentAsync(brpId, "DOC-ADR1", "12345610");

        var alphaBefore = _factory.AlphaAdapter.Requests.Count;
        var betaBefore = _factory.BetaAdapter.Requests.Count;

        var messageId = await ReceiveAsync(brpId, payload);
        await ProcessAsync(messageId);

        (_factory.BetaAdapter.Requests.Count - betaBefore).ShouldBe(1);
        (_factory.AlphaAdapter.Requests.Count - alphaBefore).ShouldBe(0);
    }

    [Fact]
    public async Task the_other_brp_s_message_goes_to_the_other_adapter()
    {
        // The mirror image, in the same run. One test showing "beta was used" is satisfied by an
        // implementation that always uses beta.
        var brpId = await SeedBrpAsync("ADR2", "FAKE_ALPHA_V1");
        var payload = await SeedPointAndDocumentAsync(brpId, "DOC-ADR2", "12345611");

        var alphaBefore = _factory.AlphaAdapter.Requests.Count;
        var betaBefore = _factory.BetaAdapter.Requests.Count;

        var messageId = await ReceiveAsync(brpId, payload);
        await ProcessAsync(messageId);

        (_factory.AlphaAdapter.Requests.Count - alphaBefore).ShouldBe(1);
        (_factory.BetaAdapter.Requests.Count - betaBefore).ShouldBe(0);
    }

    [Fact]
    public async Task a_message_from_a_deactivated_brp_still_parses_through_its_stored_adapter()
    {
        // [F02-R41] in as many words: "including after that BRP has been deactivated". The
        // deactivation stops NEW documents at the webhook (401); it must not orphan the ones
        // already stored, or a BRP switch becomes a data-loss event for everything in flight.
        var brpId = await SeedBrpAsync("ADR3", "FAKE_BETA_V1");
        var payload = await SeedPointAndDocumentAsync(brpId, "DOC-ADR3", "12345612");

        var messageId = await ReceiveAsync(brpId, payload);

        await using (var db = _factory.CreateOwnerDbContext())
        {
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE metering.brp SET is_active = false WHERE id = {brpId}",
                TestContext.Current.CancellationToken);
        }

        var betaBefore = _factory.BetaAdapter.Requests.Count;
        await ProcessAsync(messageId);
        (_factory.BetaAdapter.Requests.Count - betaBefore).ShouldBe(1);

        await using var read = _factory.CreateOwnerDbContext();
        var message = await read.InboundMessages.AsNoTracking()
            .SingleAsync(m => m.Id == messageId, TestContext.Current.CancellationToken);
        message.Status.ShouldBe(InboundMessageStatus.Processed);
    }

    [Fact]
    public async Task the_adapter_is_handed_the_stored_brp_id_and_code_not_anything_from_the_payload()
    {
        var brpId = await SeedBrpAsync("ADR4", "FAKE_ALPHA_V1");
        var payload = await SeedPointAndDocumentAsync(brpId, "DOC-ADR4", "12345613");

        var messageId = await ReceiveAsync(brpId, payload);
        await ProcessAsync(messageId);

        var request = _factory.AlphaAdapter.Requests.Last();
        request.BrpId.ShouldBe(brpId);
        request.BrpCode.ShouldBe("ADR4");
        request.InboundMessageId.ShouldBe(messageId);
    }

    [Fact]
    public async Task a_brp_naming_an_adapter_key_nobody_registered_throws_rather_than_silently_applying_nothing()
    {
        // A null return here would be applied as "no series": a message quietly reaching PROCESSED
        // with zero readings and nothing anywhere saying why.
        var brpId = await SeedBrpAsync("ADR5", "FAKE_NOT_REGISTERED_V9");
        var payload = await SeedPointAndDocumentAsync(brpId, "DOC-ADR5", "12345614");

        var messageId = await ReceiveAsync(brpId, payload);

        var thrown = await Should.ThrowAsync<PeakPower.Application.Abstractions.Ingestion.AdapterNotRegisteredException>(
            () => ProcessAsync(messageId));

        thrown.AdapterKey.ShouldBe("FAKE_NOT_REGISTERED_V9");
    }
}
```

- [ ] **Step 2: Run it**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~AdapterResolutionTests"
```

Expected: PASS — 5 tests, 0 failed. If any fail, Task 10's resolution is wrong; fix it there.

- [ ] **Step 3: Verify by mutation — selection is not "the only adapter there is"**

**What to break:** in `BrpIngestionAdapterRegistry.Resolve`, return `_byKey.Values.First()`.

**What to predict:** with two adapters registered, `_byKey` enumerates in insertion order, so
`Values.First()` is the alpha adapter. `the_message_is_parsed_by_the_adapter_its_brp_row_names_and_not_the_other_one`
fails with `(_factory.BetaAdapter.Requests.Count - betaBefore) should be 1 but was 0`, and
`a_brp_naming_an_adapter_key_nobody_registered_throws_rather_than_silently_applying_nothing` fails
with `Should throw AdapterNotRegisteredException but did not`.

**What to watch go red:** those two, plus
`a_message_from_a_deactivated_brp_still_parses_through_its_stored_adapter`. The mirror test
(`the_other_brp_s_message_goes_to_the_other_adapter`) stays **green** — which is the point of having
both directions: a single-direction test is satisfied by an implementation that always picks one.

Restore.

- [ ] **Step 4: Verify by mutation — the deactivation filter is not applied at dequeue**

**What to break:** in `ProcessInboundMessageHandler.ProcessAsync`, add `&& candidate.IsActive` to
the BRP lookup's `Where` clause.

**What to predict:** `a_message_from_a_deactivated_brp_still_parses_through_its_stored_adapter`
fails with
`InvalidOperationException: Sequence contains no elements` from `SingleAsync`.

**What to watch go red:** that one test. Every other test in the plan stays green, because every
other BRP is active — which is exactly why `[F02-R41]` spells the deactivated case out and why the
design makes it a definition-of-done item.

Restore.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Ingestion/AdapterResolutionTests.cs
git commit -m "test(ingestion): prove S2-D3 with two adapters registered and a deactivated BRP

Design §7.7 requires the second adapter, and the mutations show why: a 'resolve the only adapter
there is' registry passes one direction of the assertion and fails the other, and passes every
other test in this plan.

Adding an is_active predicate to the dequeue-time BRP lookup fails exactly one test - the
deactivated replay - which is why [F02-R41] spells that case out rather than leaving it implied.

An unregistered adapter_key throws rather than returning null: a null would be applied as 'no
series', and the message would reach PROCESSED with zero readings and no explanation anywhere.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: The pipeline's own precondition guard, and whole-document atomicity

Design §7.4 and `[F02-R13]`:

> A document whose second timeseries is one point short applies **nothing at all** — asserted by row
> count, not by a status field.

Contract §8.4's rules 7, 8 and 9 (`INCOMPLETE_PERIOD`, `INVALID_POSITIONS`, `NEGATIVE_QUANTITY`) are
adapter-level checks. The pipeline re-checks all three anyway, and that is not duplication of
`[F02-R40]`'s prohibited kind: an adapter reimplementing a *pipeline* stage is forbidden; the
pipeline defending its own database invariants against a wrong adapter is the opposite direction.
`interval_reading` carries `CHECK (pos BETWEEN 1 AND 100)` and `CHECK (quantity_kwh >= 0)`, and
`interval_data_version` carries `CHECK (interval_count IN (92, 96, 100))` — a document that violated
any of them would land as a Postgres `23514` mid-transaction, with the message stuck in `PROCESSING`
and nothing readable saying why.

⚠ **Completeness here is judged per document against the period THAT DOCUMENT declares** — the
`ExpectedIntervalCount` on each `CanonicalSeries` — never per day. The day-level completeness
question belongs to `metering_point_day_state`, is a different question with a different answer, and
is plan 5's.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/DocumentPreconditions.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/ProcessInboundMessageHandler.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/DocumentPreconditionsTests.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/ApplyAtomicityTests.cs`

**Interfaces:**
- Consumes: `BrpDocument`, `CanonicalSeries`, `CanonicalPoint` (Task 1).
- Produces: `DocumentPreconditions.Check(BrpDocument)` → `DocumentPreconditionResult` ·
  `DocumentPreconditionResult` · the three code constants `IncompletePeriod`, `InvalidPositions`,
  `NegativeQuantity`.

- [ ] **Step 1: Write the failing unit test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/DocumentPreconditionsTests.cs`:

```csharp
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Common;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Processing;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion;

public sealed class DocumentPreconditionsTests
{
    private static readonly DateOnly Day = new(2026, 8, 12);

    private static CanonicalSeries Series(
        int expected, IReadOnlyList<CanonicalPoint> points,
        IntervalDirection direction = IntervalDirection.Consumption) => new(
        ResourceObject: "871685900000000001",
        ResourceObjectIsEan: true,
        Ean: EanCode.Create("871685900000000001").Value,
        DeliveryDate: Day,
        Direction: direction,
        ExpectedIntervalCount: expected,
        Points: points);

    private static IReadOnlyList<CanonicalPoint> Full(int count, decimal quantity = 1.0m) =>
        [.. Enumerable.Range(1, count).Select(pos => new CanonicalPoint(pos, quantity))];

    private static BrpDocument Document(params CanonicalSeries[] series) =>
        new("DOC-1", DateTimeOffset.Parse("2026-08-13T03:00:00Z", null),
            BrpDocumentKind.Allocation, series);

    [Fact]
    public void a_complete_96_point_series_passes()
    {
        DocumentPreconditions.Check(Document(Series(96, Full(96)))).IsSatisfied.ShouldBeTrue();
    }

    [Fact]
    public void a_92_point_spring_day_and_a_100_point_autumn_day_both_pass()
    {
        // Judged against the period THAT DOCUMENT declares, not against 96. A guard hard-coded to
        // 96 rejects both DST days, which is the failure this check exists to avoid rather than to
        // cause.
        DocumentPreconditions.Check(Document(Series(92, Full(92)))).IsSatisfied.ShouldBeTrue();
        DocumentPreconditions.Check(Document(Series(100, Full(100)))).IsSatisfied.ShouldBeTrue();
    }

    [Fact]
    public void a_series_one_point_short_fails_with_INCOMPLETE_PERIOD()
    {
        var result = DocumentPreconditions.Check(Document(Series(96, Full(95))));

        result.IsSatisfied.ShouldBeFalse();
        result.FailureCode.ShouldBe(DocumentPreconditions.IncompletePeriod);
        result.FailureDetail.ShouldContain("95", Case.Sensitive);
        result.FailureDetail.ShouldContain("96", Case.Sensitive);
    }

    [Fact]
    public void a_series_one_point_long_fails_with_INCOMPLETE_PERIOD_too()
    {
        // Design §7.10: a 96-point document is REJECTED for both a 92-point date (over-length) and
        // a 100-point date (short). Only checking "not fewer than expected" passes the over-length
        // half and writes four intervals that do not exist on that day.
        var result = DocumentPreconditions.Check(Document(Series(92, Full(93))));

        result.IsSatisfied.ShouldBeFalse();
        result.FailureCode.ShouldBe(DocumentPreconditions.IncompletePeriod);
    }

    [Fact]
    public void the_SECOND_series_being_short_fails_the_whole_document()
    {
        var result = DocumentPreconditions.Check(Document(
            Series(96, Full(96)),
            Series(96, Full(95), IntervalDirection.Production)));

        result.IsSatisfied.ShouldBeFalse();
        result.FailureCode.ShouldBe(DocumentPreconditions.IncompletePeriod);
    }

    [Fact]
    public void positions_that_do_not_start_at_one_fail_with_INVALID_POSITIONS()
    {
        var points = Full(96).Select(point => new CanonicalPoint(point.Pos + 1, point.QuantityKwh)).ToArray();

        var result = DocumentPreconditions.Check(Document(Series(96, points)));

        result.IsSatisfied.ShouldBeFalse();
        result.FailureCode.ShouldBe(DocumentPreconditions.InvalidPositions);
    }

    [Fact]
    public void a_duplicated_position_fails_with_INVALID_POSITIONS()
    {
        // The count is still 96, so a count-only check passes this. The document carries Pos 5
        // twice and never carries Pos 6: one interval is written twice and one is missing.
        var points = Full(96).ToArray();
        points[5] = new CanonicalPoint(5, points[5].QuantityKwh);

        var result = DocumentPreconditions.Check(Document(Series(96, points)));

        result.IsSatisfied.ShouldBeFalse();
        result.FailureCode.ShouldBe(DocumentPreconditions.InvalidPositions);
    }

    [Fact]
    public void a_negative_quantity_fails_with_NEGATIVE_QUANTITY()
    {
        // [AS-05]: consumption and production remain two separate, NON-NEGATIVE series. A negative
        // reading means a direction was mapped wrong, which under [DEC-22] is a wrong invoice -
        // and metering.interval_reading has CHECK (quantity_kwh >= 0), so the alternative to this
        // check is a Postgres 23514 with the message stuck in PROCESSING.
        var points = Full(96).ToArray();
        points[10] = new CanonicalPoint(11, -0.5m);

        var result = DocumentPreconditions.Check(Document(Series(96, points)));

        result.IsSatisfied.ShouldBeFalse();
        result.FailureCode.ShouldBe(DocumentPreconditions.NegativeQuantity);
    }

    [Fact]
    public void an_interval_count_that_is_not_92_96_or_100_fails()
    {
        // metering.interval_data_version has CHECK (interval_count IN (92, 96, 100)).
        var result = DocumentPreconditions.Check(Document(Series(48, Full(48))));

        result.IsSatisfied.ShouldBeFalse();
        result.FailureCode.ShouldBe(DocumentPreconditions.IncompletePeriod);
    }

    [Fact]
    public void a_document_with_no_series_at_all_passes_and_applies_nothing()
    {
        // Not an error. An adapter that accepted a document carrying no allocation series has said
        // "nothing to apply", and failing it would put a legitimate document on the quarantine
        // screen.
        DocumentPreconditions.Check(Document()).IsSatisfied.ShouldBeTrue();
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~DocumentPreconditionsTests"
```

Expected: FAIL — build error
`error CS0103: The name 'DocumentPreconditions' does not exist in the current context`.

- [ ] **Step 3: Write the guard**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/DocumentPreconditions.cs`:

```csharp
using System.Globalization;
using PeakPower.Application.Abstractions.Ingestion;

namespace PeakPower.Ingestion.Processing;

/// <summary>Whether a parsed document may be applied at all.</summary>
public sealed record DocumentPreconditionResult(
    bool IsSatisfied, string? FailureCode, string? FailureDetail)
{
    public static DocumentPreconditionResult Satisfied { get; } = new(true, null, null);

    public static DocumentPreconditionResult Failed(string code, string detail) =>
        new(false, code, detail);
}

/// <summary>
/// The pipeline's own guard over a parsed document, before a row is written.
/// </summary>
/// <remarks>
/// <para>
/// The adapter checks these too (shared contract §8.4 rules 7, 8 and 9) and that is not duplication
/// of the kind [F02-R40] forbids: an adapter reimplementing a <i>pipeline</i> stage is prohibited;
/// the pipeline defending its own database invariants against a wrong adapter runs the other way.
/// <c>metering.interval_reading</c> carries <c>CHECK (pos BETWEEN 1 AND 100)</c> and
/// <c>CHECK (quantity_kwh &gt;= 0)</c>, and <c>metering.interval_data_version</c> carries
/// <c>CHECK (interval_count IN (92, 96, 100))</c>. Without this guard a wrong adapter produces a
/// Postgres 23514 halfway through the apply transaction, and the message is left in
/// <c>PROCESSING</c> with nothing readable saying why.
/// </para>
/// <para>
/// <b>Completeness is judged per document against the period THAT DOCUMENT declares</b> — the
/// <c>ExpectedIntervalCount</c> on each series — never against 96 and never per day. A guard
/// hard-coded to 96 rejects both DST days.
/// </para>
/// </remarks>
public static class DocumentPreconditions
{
    /// <summary>Shared contract §8.4 rule 7.</summary>
    public const string IncompletePeriod = "INCOMPLETE_PERIOD";

    /// <summary>Shared contract §8.4 rule 8.</summary>
    public const string InvalidPositions = "INVALID_POSITIONS";

    /// <summary>Shared contract §8.4 rule 9.</summary>
    public const string NegativeQuantity = "NEGATIVE_QUANTITY";

    private static readonly int[] AllowedIntervalCounts = [92, 96, 100];

    public static DocumentPreconditionResult Check(BrpDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);

        foreach (var series in document.Series)
        {
            if (!AllowedIntervalCounts.Contains(series.ExpectedIntervalCount))
            {
                return DocumentPreconditionResult.Failed(
                    IncompletePeriod,
                    $"Series for {series.ResourceObject} on "
                    + $"{series.DeliveryDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)} "
                    + $"declares an interval count of {series.ExpectedIntervalCount}; only 92, 96 "
                    + "and 100 are possible on an Amsterdam calendar day.");
            }

            // Both directions of the comparison. Design §7.10 requires a 96-point document to be
            // rejected for a 92-point date (over-length) as well as for a 100-point date (short);
            // checking only "not fewer than expected" writes four intervals that do not exist.
            if (series.Points.Count != series.ExpectedIntervalCount)
            {
                return DocumentPreconditionResult.Failed(
                    IncompletePeriod,
                    $"Series for {series.ResourceObject} on "
                    + $"{series.DeliveryDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)} "
                    + $"carries {series.Points.Count} point(s); the period it declares has "
                    + $"{series.ExpectedIntervalCount}.");
            }

            // Contiguous from 1, no duplicates. A count-only check passes a series that carries
            // Pos 5 twice and never carries Pos 6.
            var seen = new bool[series.ExpectedIntervalCount + 1];
            foreach (var point in series.Points)
            {
                if (point.Pos < 1 || point.Pos > series.ExpectedIntervalCount || seen[point.Pos])
                {
                    return DocumentPreconditionResult.Failed(
                        InvalidPositions,
                        $"Series for {series.ResourceObject} on "
                        + $"{series.DeliveryDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)} "
                        + $"carries position {point.Pos}, which is out of range or repeated. "
                        + $"Positions must run contiguously from 1 to {series.ExpectedIntervalCount}.");
                }

                seen[point.Pos] = true;

                if (point.QuantityKwh < 0m)
                {
                    return DocumentPreconditionResult.Failed(
                        NegativeQuantity,
                        $"Series for {series.ResourceObject} on "
                        + $"{series.DeliveryDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)} "
                        + $"carries {point.QuantityKwh} kWh at position {point.Pos}. Consumption "
                        + "and production are separate non-negative series [AS-05]; a negative "
                        + "value means a direction was mapped wrong.");
                }
            }
        }

        return DocumentPreconditionResult.Satisfied;
    }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --filter "FullyQualifiedName~DocumentPreconditionsTests"
```

Expected: PASS — 10 tests, 0 failed.

- [ ] **Step 5: Write the failing atomicity test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/ApplyAtomicityTests.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Processing;
using PeakPower.Ingestion.Receipt;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

/// <summary>
/// [F02-R13] and design §7.4: a document lands whole or not at all, asserted by <b>row count</b>.
/// </summary>
public sealed class ApplyAtomicityTests : IClassFixture<ApplyAtomicityTests.FakeAdapterFactory>
{
    private static readonly DateOnly Day = new(2026, 8, 12);

    private readonly FakeAdapterFactory _factory;

    public ApplyAtomicityTests(FakeAdapterFactory factory) => _factory = factory;

    public sealed class FakeAdapterFactory : WorkerFactory
    {
        public FakeAdapterFactory() => ExtraAdapters.Add(new FakeBrpIngestionAdapter("FAKE_ATOMIC_V1"));
    }

    private async Task<(Guid BrpId, string Ean, Guid PointId)> SeedAsync(string code, string kvk)
    {
        await using var db = _factory.CreateOwnerDbContext();
        var brpId = await IngestionSeed.AddBrpAsync(db, code, ct: TestContext.Current.CancellationToken);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE metering.brp SET adapter_key = 'FAKE_ATOMIC_V1' WHERE id = {brpId}",
            TestContext.Current.CancellationToken);

        var customerId = await IngestionSeed.AddCustomerAsync(
            db, $"Atomic {code} B.V.", kvk, TestContext.Current.CancellationToken);
        var ean = IngestionSeed.NextEan();
        var pointId = await IngestionSeed.AddMeteringPointAsync(
            db, customerId, brpId, ean, new DateOnly(2026, 1, 1),
            ct: TestContext.Current.CancellationToken);

        return (brpId, ean, pointId);
    }

    private async Task<Guid> ReceiveAsync(Guid brpId, byte[] payload)
    {
        using var scope = _factory.Services.CreateScope();
        var receipt = await scope.ServiceProvider.GetRequiredService<IInboundMessageReceiver>()
            .ReceiveAsync(
                new InboundMessageArrival(brpId, Guid.CreateVersion7(), payload, null, "10.0.0.7"),
                TestContext.Current.CancellationToken);
        return receipt.InboundMessageId;
    }

    private async Task<InboundMessageProcessingOutcome> ProcessAsync(Guid messageId)
    {
        using var scope = _factory.Services.CreateScope();
        await using var db = _factory.CreateOwnerDbContext();
        var correlationId = await db.InboundMessages.AsNoTracking()
            .Where(m => m.Id == messageId).Select(m => m.CorrelationId)
            .SingleAsync(TestContext.Current.CancellationToken);

        return await scope.ServiceProvider.GetRequiredService<IInboundMessageProcessor>()
            .ProcessAsync(messageId, correlationId, TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task a_document_whose_second_series_is_one_point_short_applies_nothing_at_all()
    {
        var (brpId, ean, pointId) = await SeedAsync("ATM1", "12345620");

        // The FIRST series is complete and would land on its own. That is what makes this a test
        // of atomicity rather than of validation.
        var payload = new TestDocument("DOC-ATM1", DateTimeOffset.Parse("2026-08-13T03:00:00Z", null))
            .WithFlatDay(ean, Day, IntervalDirection.Consumption, 180.0m)
            .WithSeries(
                ean, resourceObjectIsEan: true, Day, IntervalDirection.Production, 96,
                [.. Enumerable.Repeat(0.5m, 95)])
            .ToBytes();

        var messageId = await ReceiveAsync(brpId, payload);
        var outcome = await ProcessAsync(messageId);

        outcome.Status.ShouldBe(InboundMessageProcessingStatus.Failed);
        outcome.FailureCode.ShouldBe(DocumentPreconditions.IncompletePeriod);

        await using var db = _factory.CreateOwnerDbContext();

        // ROW COUNT, not a status field. A status column can be wrong; a row count cannot, and the
        // failure this guards against is precisely "the first series landed and the message says
        // FAILED".
        (await db.IntervalDataVersions.CountAsync(
            v => v.MeteringPointId == pointId, TestContext.Current.CancellationToken)).ShouldBe(0);
        (await db.IntervalReadings.CountAsync(
            r => r.DeliveryDate == Day, TestContext.Current.CancellationToken)).ShouldBe(0);

        var message = await db.InboundMessages.AsNoTracking()
            .SingleAsync(m => m.Id == messageId, TestContext.Current.CancellationToken);
        message.Status.ShouldBe(InboundMessageStatus.Failed);
    }

    [Fact]
    public async Task both_series_of_a_complete_document_land_together()
    {
        var (brpId, ean, pointId) = await SeedAsync("ATM2", "12345621");

        var payload = new TestDocument("DOC-ATM2", DateTimeOffset.Parse("2026-08-13T03:00:00Z", null))
            .WithFlatDay(ean, Day, IntervalDirection.Consumption, 180.0m)
            .WithFlatDay(ean, Day, IntervalDirection.Production, 0.5m)
            .ToBytes();

        var messageId = await ReceiveAsync(brpId, payload);
        var outcome = await ProcessAsync(messageId);

        outcome.Status.ShouldBe(InboundMessageProcessingStatus.Applied);
        outcome.VersionsCreated.ShouldBe(2);

        await using var db = _factory.CreateOwnerDbContext();
        var versions = await db.IntervalDataVersions.AsNoTracking()
            .Where(v => v.MeteringPointId == pointId)
            .ToListAsync(TestContext.Current.CancellationToken);

        versions.Count.ShouldBe(2);
        versions.Select(v => v.Direction).OrderBy(d => d).ShouldBe(
            [IntervalDirection.Consumption, IntervalDirection.Production]);
        (await db.IntervalReadings.CountAsync(
            r => r.DeliveryDate == Day, TestContext.Current.CancellationToken)).ShouldBe(192);
    }

    [Fact]
    public async Task a_negative_quantity_anywhere_applies_nothing()
    {
        var (brpId, ean, pointId) = await SeedAsync("ATM3", "12345622");

        var quantities = Enumerable.Repeat(1.0m, 96).ToArray();
        quantities[42] = -1.0m;

        var payload = new TestDocument("DOC-ATM3", DateTimeOffset.Parse("2026-08-13T03:00:00Z", null))
            .WithSeries(ean, true, Day, IntervalDirection.Consumption, 96, quantities)
            .ToBytes();

        var messageId = await ReceiveAsync(brpId, payload);
        var outcome = await ProcessAsync(messageId);

        outcome.FailureCode.ShouldBe(DocumentPreconditions.NegativeQuantity);

        await using var db = _factory.CreateOwnerDbContext();
        (await db.IntervalDataVersions.CountAsync(
            v => v.MeteringPointId == pointId, TestContext.Current.CancellationToken)).ShouldBe(0);
    }
}
```

- [ ] **Step 6: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ApplyAtomicityTests"
```

Expected: FAIL — `a_document_whose_second_series_is_one_point_short_applies_nothing_at_all` fails
with `outcome.Status should be Failed but was Applied`, and the row-count assertions report
`should be 0 but was 1` and `should be 0 but was 191`. The 191 is the tell: the first series landed
whole and the second landed one short.

- [ ] **Step 7: Wire the guard into the handler**

In `ProcessInboundMessageHandler.ApplyAsync`, replace the opening lines

```csharp
        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        var versionsCreated = 0;
```

with

```csharp
        // BEFORE the transaction opens and before a single row is added. [F02-R13]: a document
        // lands whole or not at all, and the cheapest way to guarantee that is never to start.
        var preconditions = DocumentPreconditions.Check(document);
        if (!preconditions.IsSatisfied)
        {
            return await RejectAsync(
                message,
                BrpParseOutcome.Rejected(preconditions.FailureCode!, preconditions.FailureDetail!),
                ct);
        }

        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        var versionsCreated = 0;
```

- [ ] **Step 8: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ApplyAtomicityTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ProcessingOutcomeTests"
```

Expected: PASS — 3 tests and 6 tests, 0 failed.

- [ ] **Step 9: Verify by mutation — atomicity is real, not "checked first"**

**What to break:** move the precondition check from before the transaction to *inside* the series
loop, so it checks each series just before applying it:

```csharp
        foreach (var series in document.Series)
        {
            if (series.Points.Count != series.ExpectedIntervalCount)
            {
                return await RejectAsync(message, BrpParseOutcome.Rejected(
                    DocumentPreconditions.IncompletePeriod, "short series"), ct);
            }
            // ... the rest of the loop unchanged
```

**What to predict:** `a_document_whose_second_series_is_one_point_short_applies_nothing_at_all`
fails on the version count — `should be 0 but was 1` — because the first series was added to the
change tracker before the second was rejected, and `RejectAsync` calls `SaveChangesAsync` on that
same tracker. The status assertion passes.

**What to watch go red:** the row-count assertions, and only those. This is the exact failure design
§7.4 says to assert by row count rather than by a status field, reproduced deliberately.

Restore.

- [ ] **Step 10: Verify by mutation — the count check is two-sided**

**What to break:** in `DocumentPreconditions.Check`, change
`series.Points.Count != series.ExpectedIntervalCount` to
`series.Points.Count < series.ExpectedIntervalCount`.

**What to predict:** `a_series_one_point_long_fails_with_INCOMPLETE_PERIOD_too` fails with
`result.IsSatisfied should be False but was True`. The short-series tests stay green.

**What to watch go red:** that one. Design §7.10 requires a 96-point document to be rejected for a
92-point date as well as for a 100-point date, and only the over-length half sees this mutation.

Restore.

- [ ] **Step 11: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Ingestion/Processing/DocumentPreconditions.cs \
        src/Infrastructure/PeakPower.Ingestion/Processing/ProcessInboundMessageHandler.cs \
        tests/PeakPower.Application.Tests/Ingestion/DocumentPreconditionsTests.cs \
        tests/PeakPower.Integration.Tests/Ingestion/ApplyAtomicityTests.cs
git commit -m "feat(ingestion): guard the document's preconditions before the transaction opens

[F02-R13] and design §7.4: a document whose second timeseries is one point short applies nothing at
all, asserted by ROW COUNT. Mutation-verified by moving the check inside the series loop, which
leaves message.Status reading FAILED while the first series has already landed - the exact failure
the design says to assert by row count rather than by a status field.

The point-count comparison is two-sided: a 96-point document is rejected for a 92-point date as well
as for a 100-point date, and only the over-length half sees a '<' mutation.

The pipeline re-checks what the adapter checked, on purpose. metering.interval_reading and
metering.interval_data_version carry the corresponding CHECK constraints, and without this guard a
wrong adapter produces a 23514 halfway through the apply transaction with the message stuck in
PROCESSING.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Series resolution and the four quarantine reasons

Contract §8.5, and design §7.6:

| `QuarantineReason` | Raised when |
| --- | --- |
| `UNKNOWN_EAN` | The 18-digit `ResourceObject` matches no `customer.metering_point` at all |
| `EAN_VALIDITY` | A metering point with that EAN exists but its validity does not cover the delivery date |
| `WRONG_BRP` | The metering point's BRP **in force at receipt time** is not the message's `brp_id` |
| `NOT_ELECTRICITY` | `commodity <> 'ELECTRICITY'` |

Four things about this that are easy to get wrong and expensive to get wrong:

⚠ **Quarantine is a storage state with a replay path, not a parse outcome.** The message reaches
`PROCESSED`, not `FAILED`. A quarantined series is not a defect in the document — it is a gap in
master data, and the resolution is to register the metering point and replay.

⚠ **The order of the checks is the order of the table.** "No such EAN at all" must be distinguished
from "exists but not on that date": an operator seeing `UNKNOWN_EAN` goes to the EAN pool, and one
seeing `EAN_VALIDITY` goes to the connection's validity period. Collapsing them sends half the
worklist to the wrong screen.

⚠ **`WRONG_BRP` is decided against the assignment in force at RECEIPT time** (`[F02-R43]`), read
from `customer.metering_point_brp_assignment`, not from the metering point's current `brp_id`.
Otherwise reassigning a point to a new BRP retroactively quarantines every document the old BRP
legitimately sent before the switch.

⚠ **A `ResourceObject` that is not an EAN is never offered to the resolver.** `[F02-R11]`/`[AS-17]`:
eighteen digits is an EAN, anything else is a descriptive label (`Prognosis`, `Realisation`,
`Imbalance`, …). Offering a label to the resolver quarantines a perfectly good document as a false
`UNKNOWN_EAN`. Such a series is **skipped and counted**, not quarantined: none of the four reasons
is true of it, and inventing a fifth would put a routine document on the operator's worklist.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/SeriesResolution.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/ProcessInboundMessageHandler.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/QuarantineTests.cs`

**Interfaces:**
- Consumes: `CanonicalSeries` (Task 1); `QuarantineReason`, `QuarantinedSeries.Quarantine`,
  `PeakPowerDbContext.QuarantinedSeries`, `MeteringPointBrpAssignment` (plan 2); `Commodity`
  (`src/Core/PeakPower.Domain/Customers/Enums.cs`).
- Produces: `SeriesResolution` · `SeriesResolutionOutcome` · `ISeriesResolver` ·
  `DbSeriesResolver`.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/QuarantineTests.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Processing;
using PeakPower.Ingestion.Receipt;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

/// <summary>Shared contract §8.5 and design §7.6: the four quarantine reasons, one test each.</summary>
public sealed class QuarantineTests : IClassFixture<QuarantineTests.FakeAdapterFactory>
{
    private static readonly DateOnly Day = new(2026, 8, 12);

    private readonly FakeAdapterFactory _factory;

    public QuarantineTests(FakeAdapterFactory factory) => _factory = factory;

    public sealed class FakeAdapterFactory : WorkerFactory
    {
        public FakeAdapterFactory() => ExtraAdapters.Add(new FakeBrpIngestionAdapter("FAKE_QUARANTINE_V1"));
    }

    private async Task<Guid> SeedBrpAsync(string code)
    {
        await using var db = _factory.CreateOwnerDbContext();
        var brpId = await IngestionSeed.AddBrpAsync(db, code, ct: TestContext.Current.CancellationToken);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE metering.brp SET adapter_key = 'FAKE_QUARANTINE_V1' WHERE id = {brpId}",
            TestContext.Current.CancellationToken);
        return brpId;
    }

    private async Task<Guid> ReceiveAsync(Guid brpId, byte[] payload)
    {
        using var scope = _factory.Services.CreateScope();
        var receipt = await scope.ServiceProvider.GetRequiredService<IInboundMessageReceiver>()
            .ReceiveAsync(
                new InboundMessageArrival(brpId, Guid.CreateVersion7(), payload, null, "10.0.0.7"),
                TestContext.Current.CancellationToken);
        return receipt.InboundMessageId;
    }

    private async Task<InboundMessageProcessingOutcome> ProcessAsync(Guid messageId)
    {
        using var scope = _factory.Services.CreateScope();
        await using var db = _factory.CreateOwnerDbContext();
        var correlationId = await db.InboundMessages.AsNoTracking()
            .Where(m => m.Id == messageId).Select(m => m.CorrelationId)
            .SingleAsync(TestContext.Current.CancellationToken);

        return await scope.ServiceProvider.GetRequiredService<IInboundMessageProcessor>()
            .ProcessAsync(messageId, correlationId, TestContext.Current.CancellationToken);
    }

    private static byte[] Day96(string resourceObject, bool isEan = true) =>
        new TestDocument("DOC-Q", DateTimeOffset.Parse("2026-08-13T03:00:00Z", null))
            .WithSeries(
                resourceObject, isEan, Day, IntervalDirection.Consumption, 96,
                [.. Enumerable.Repeat(1.0m, 96)])
            .ToBytes();

    [Fact]
    public async Task an_ean_registered_nowhere_quarantines_as_UNKNOWN_EAN()
    {
        var brpId = await SeedBrpAsync("QRT1");
        var stranger = IngestionSeed.NextEan();

        var messageId = await ReceiveAsync(brpId, Day96(stranger));
        var outcome = await ProcessAsync(messageId);

        outcome.QuarantineEntriesCreated.ShouldBe(1);
        outcome.VersionsCreated.ShouldBe(0);

        await using var db = _factory.CreateOwnerDbContext();
        var entry = await db.QuarantinedSeries.AsNoTracking()
            .SingleAsync(q => q.InboundMessageId == messageId, TestContext.Current.CancellationToken);

        entry.Reason.ShouldBe(QuarantineReason.UnknownEan);
        entry.ResourceObject.ShouldBe(stranger);
        entry.DeliveryDate.ShouldBe(Day);
        entry.Direction.ShouldBe(IntervalDirection.Consumption);
        entry.PointCount.ShouldBe((short)96);
        entry.BrpId.ShouldBe(brpId);
        entry.ResolvedAt.ShouldBeNull();

        // PROCESSED, not FAILED. A quarantined series is a gap in master data, not a defect in the
        // document, and the resolution is to register the point and replay.
        var message = await db.InboundMessages.AsNoTracking()
            .SingleAsync(m => m.Id == messageId, TestContext.Current.CancellationToken);
        message.Status.ShouldBe(InboundMessageStatus.Processed);
    }

    [Fact]
    public async Task an_ean_whose_validity_does_not_cover_the_delivery_date_quarantines_as_EAN_VALIDITY()
    {
        var brpId = await SeedBrpAsync("QRT2");
        string ean;

        await using (var db = _factory.CreateOwnerDbContext())
        {
            var customerId = await IngestionSeed.AddCustomerAsync(
                db, "Validity B.V.", "12345630", TestContext.Current.CancellationToken);
            ean = IngestionSeed.NextEan();

            // Closed before the delivery date. The EAN exists; it simply was not this customer's
            // - or anybody's - on 12 August.
            await IngestionSeed.AddMeteringPointAsync(
                db, customerId, brpId, ean,
                validFrom: new DateOnly(2026, 1, 1), validTo: new DateOnly(2026, 7, 1),
                ct: TestContext.Current.CancellationToken);
        }

        var messageId = await ReceiveAsync(brpId, Day96(ean));
        await ProcessAsync(messageId);

        await using var read = _factory.CreateOwnerDbContext();
        var entry = await read.QuarantinedSeries.AsNoTracking()
            .SingleAsync(q => q.InboundMessageId == messageId, TestContext.Current.CancellationToken);

        // Distinguished from UNKNOWN_EAN deliberately: an operator seeing UNKNOWN_EAN goes to the
        // EAN pool, one seeing EAN_VALIDITY goes to the connection's validity period. Collapsing
        // them sends half the worklist to the wrong screen.
        entry.Reason.ShouldBe(QuarantineReason.EanValidity);
    }

    [Fact]
    public async Task an_ean_assigned_to_another_brp_quarantines_as_WRONG_BRP()
    {
        var senderBrpId = await SeedBrpAsync("QRT3A");
        var owningBrpId = await SeedBrpAsync("QRT3B");
        string ean;

        await using (var db = _factory.CreateOwnerDbContext())
        {
            var customerId = await IngestionSeed.AddCustomerAsync(
                db, "Wrong BRP B.V.", "12345631", TestContext.Current.CancellationToken);
            ean = IngestionSeed.NextEan();
            await IngestionSeed.AddMeteringPointAsync(
                db, customerId, owningBrpId, ean, new DateOnly(2026, 1, 1),
                ct: TestContext.Current.CancellationToken);
        }

        var messageId = await ReceiveAsync(senderBrpId, Day96(ean));
        await ProcessAsync(messageId);

        await using var read = _factory.CreateOwnerDbContext();
        var entry = await read.QuarantinedSeries.AsNoTracking()
            .SingleAsync(q => q.InboundMessageId == messageId, TestContext.Current.CancellationToken);

        // [F02-R42]: never applied, never discarded, never attached by guesswork. Two BRPs claiming
        // one EAN is a master-data conflict for an employee, not a supersession race.
        entry.Reason.ShouldBe(QuarantineReason.WrongBrp);
        entry.BrpId.ShouldBe(senderBrpId);
    }

    [Fact]
    public async Task WRONG_BRP_is_decided_against_the_assignment_in_force_at_RECEIPT_time()
    {
        // [F02-R43]. The document arrives while BRP A holds the point; the point is reassigned to
        // BRP B afterwards. The document was legitimate when it was sent and must still apply.
        var originalBrpId = await SeedBrpAsync("QRT4A");
        var newBrpId = await SeedBrpAsync("QRT4B");
        Guid pointId;
        string ean;

        await using (var db = _factory.CreateOwnerDbContext())
        {
            var customerId = await IngestionSeed.AddCustomerAsync(
                db, "Reassigned B.V.", "12345632", TestContext.Current.CancellationToken);
            ean = IngestionSeed.NextEan();
            pointId = await IngestionSeed.AddMeteringPointAsync(
                db, customerId, originalBrpId, ean, new DateOnly(2026, 1, 1),
                ct: TestContext.Current.CancellationToken);

            // The assignment history plan 2's migration backfills for pre-existing rows. A point
            // created after the migration has none, so the test writes the one it needs.
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 INSERT INTO customer.metering_point_brp_assignment
                        (metering_point_id, from_brp_id, to_brp_id, assigned_at, assigned_by, reason)
                 VALUES ({pointId}, NULL, {originalBrpId}, TIMESTAMPTZ '2026-01-01 00:00:00+00',
                         'test', 'Initial assignment.')
                 """,
                TestContext.Current.CancellationToken);
        }

        var messageId = await ReceiveAsync(originalBrpId, Day96(ean));

        // Reassign AFTER receipt, BEFORE processing. This is the ordering [F02-R43] is about.
        await using (var db = _factory.CreateOwnerDbContext())
        {
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 INSERT INTO customer.metering_point_brp_assignment
                        (metering_point_id, from_brp_id, to_brp_id, assigned_at, assigned_by, reason)
                 VALUES ({pointId}, {originalBrpId}, {newBrpId}, now(), 'test', 'Switched supplier.')
                 """,
                TestContext.Current.CancellationToken);

            await db.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE customer.metering_point SET brp_id = {newBrpId} WHERE id = {pointId}",
                TestContext.Current.CancellationToken);
        }

        var outcome = await ProcessAsync(messageId);

        // Applied, not quarantined. Deciding on the CURRENT brp_id would retroactively quarantine
        // every document the previous BRP legitimately sent before the switch.
        outcome.VersionsCreated.ShouldBe(1);
        outcome.QuarantineEntriesCreated.ShouldBe(0);
    }

    [Fact]
    public async Task a_non_electricity_metering_point_quarantines_as_NOT_ELECTRICITY()
    {
        var brpId = await SeedBrpAsync("QRT5");
        string ean;

        await using (var db = _factory.CreateOwnerDbContext())
        {
            var customerId = await IngestionSeed.AddCustomerAsync(
                db, "Gas B.V.", "12345633", TestContext.Current.CancellationToken);
            ean = IngestionSeed.NextEan();
            var pointId = await IngestionSeed.AddMeteringPointAsync(
                db, customerId, brpId, ean, new DateOnly(2026, 1, 1),
                ct: TestContext.Current.CancellationToken);

            // MeteringPoint.Attach hard-codes ELECTRICITY ([DEC-68]), so the only way to reach this
            // branch is through the column. That is the honest arrangement: the branch exists
            // because the DISCRIMINATOR exists, and it must hold if a row ever carries another
            // value.
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"UPDATE customer.metering_point SET commodity = 'GAS' WHERE id = {pointId}",
                TestContext.Current.CancellationToken);
        }

        var messageId = await ReceiveAsync(brpId, Day96(ean));
        await ProcessAsync(messageId);

        await using var read = _factory.CreateOwnerDbContext();
        var entry = await read.QuarantinedSeries.AsNoTracking()
            .SingleAsync(q => q.InboundMessageId == messageId, TestContext.Current.CancellationToken);

        entry.Reason.ShouldBe(QuarantineReason.NotElectricity);
    }

    [Fact]
    public async Task a_labelled_resource_object_is_skipped_and_NOT_quarantined()
    {
        // [F02-R11]/[AS-17]. "Prognosis" is a descriptive resource label, not an EAN. Offering it
        // to the EAN resolver would quarantine a perfectly good document as a false UNKNOWN_EAN,
        // and that entry would sit on the operator's worklist forever because there is no EAN to
        // register.
        var brpId = await SeedBrpAsync("QRT6");

        var messageId = await ReceiveAsync(brpId, Day96("Prognosis", isEan: false));
        var outcome = await ProcessAsync(messageId);

        outcome.QuarantineEntriesCreated.ShouldBe(0);
        outcome.VersionsCreated.ShouldBe(0);
        outcome.LabelledSeriesSkipped.ShouldBe(1);

        await using var db = _factory.CreateOwnerDbContext();
        (await db.QuarantinedSeries.CountAsync(
            q => q.InboundMessageId == messageId, TestContext.Current.CancellationToken)).ShouldBe(0);

        var message = await db.InboundMessages.AsNoTracking()
            .SingleAsync(m => m.Id == messageId, TestContext.Current.CancellationToken);
        message.Status.ShouldBe(InboundMessageStatus.Processed);
    }

    [Fact]
    public async Task a_good_series_beside_a_quarantined_one_still_lands()
    {
        // Quarantine is NOT a rejection, so [F02-R13]'s all-or-nothing does not extend to it: the
        // known EAN's series lands and the unknown one's is set aside. Treating quarantine as a
        // document-level failure would let one unregistered EAN block a whole day for every other
        // customer in the same document.
        var brpId = await SeedBrpAsync("QRT7");
        string known;
        var stranger = IngestionSeed.NextEan();

        await using (var db = _factory.CreateOwnerDbContext())
        {
            var customerId = await IngestionSeed.AddCustomerAsync(
                db, "Mixed B.V.", "12345634", TestContext.Current.CancellationToken);
            known = IngestionSeed.NextEan();
            await IngestionSeed.AddMeteringPointAsync(
                db, customerId, brpId, known, new DateOnly(2026, 1, 1),
                ct: TestContext.Current.CancellationToken);
        }

        var payload = new TestDocument("DOC-QRT7", DateTimeOffset.Parse("2026-08-13T03:00:00Z", null))
            .WithFlatDay(known, Day, IntervalDirection.Consumption, 1.0m)
            .WithFlatDay(stranger, Day, IntervalDirection.Consumption, 2.0m)
            .ToBytes();

        var messageId = await ReceiveAsync(brpId, payload);
        var outcome = await ProcessAsync(messageId);

        outcome.VersionsCreated.ShouldBe(1);
        outcome.QuarantineEntriesCreated.ShouldBe(1);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~QuarantineTests"
```

Expected: FAIL — `an_ean_registered_nowhere_quarantines_as_UNKNOWN_EAN` fails with
`InvalidOperationException: Sequence contains no elements` thrown from the handler's `SingleAsync`
on `db.MeteringPoints`. That exception **is** the current behaviour and it is why this task exists:
an unregistered EAN currently crashes the job rather than quarantining.

- [ ] **Step 3: Write the resolver**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/SeriesResolution.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Persistence;

namespace PeakPower.Ingestion.Processing;

/// <summary>What a series resolved to: a metering point and its customer, or a quarantine reason.</summary>
public sealed record SeriesResolutionOutcome(
    Guid? MeteringPointId, Guid? CustomerId, QuarantineReason? Reason)
{
    public static SeriesResolutionOutcome Resolved(Guid meteringPointId, Guid customerId) =>
        new(meteringPointId, customerId, null);

    public static SeriesResolutionOutcome Quarantine(QuarantineReason reason) =>
        new(null, null, reason);

    public bool IsResolved => Reason is null;
}

/// <summary>Turns a <see cref="CanonicalSeries"/> into a metering point, or into a quarantine reason.</summary>
public interface ISeriesResolver
{
    Task<SeriesResolutionOutcome> ResolveAsync(
        CanonicalSeries series, Guid messageBrpId, DateTimeOffset receivedAt, CancellationToken ct);
}

/// <summary>
/// The four quarantine reasons of shared contract §8.5, in the order the table gives them.
/// </summary>
/// <remarks>
/// <para>
/// The order is not arbitrary. "No such EAN at all" (<c>UNKNOWN_EAN</c>) sends an operator to the
/// EAN pool; "exists but not on that date" (<c>EAN_VALIDITY</c>) sends them to the connection's
/// validity period. A resolver that answered <c>UNKNOWN_EAN</c> for both would send half the
/// worklist to the wrong screen, and both entries would look identical on the data-health list.
/// </para>
/// <para>
/// <b>The adapter never does any of this</b> (shared contract §7.1): it emits a
/// <see cref="CanonicalSeries"/> and the pipeline turns it into a quarantine row. An adapter that
/// queried <c>customer.metering_point</c> would have reimplemented a pipeline stage, which
/// [F02-R40] forbids in so many words.
/// </para>
/// </remarks>
public sealed class DbSeriesResolver(PeakPowerDbContext db) : ISeriesResolver
{
    public async Task<SeriesResolutionOutcome> ResolveAsync(
        CanonicalSeries series, Guid messageBrpId, DateTimeOffset receivedAt, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(series);

        if (!series.ResourceObjectIsEan || series.Ean is not { } ean)
        {
            // Never reached: the handler skips a labelled series before calling this. Guarded
            // anyway, because the cost of getting it wrong is a false UNKNOWN_EAN that no operator
            // can ever clear - there is no EAN to register.
            throw new InvalidOperationException(
                $"A series whose ResourceObject '{series.ResourceObject}' is not an EAN must never "
                + "be offered to the EAN resolver [F02-R11].");
        }

        // Every metering point that has EVER carried this EAN, whatever its period. Deciding
        // UNKNOWN_EAN versus EAN_VALIDITY needs both answers, and one query gives both.
        var candidates = await db.MeteringPoints.AsNoTracking()
            .Where(point => point.Ean == ean)
            .Select(point => new
            {
                point.Id,
                point.CustomerId,
                point.Commodity,
                point.BrpId,
                point.ValidFrom,
                point.ValidTo,
            })
            .ToListAsync(ct);

        if (candidates.Count == 0)
        {
            return SeriesResolutionOutcome.Quarantine(QuarantineReason.UnknownEan);
        }

        // The half-open period [ValidFrom, ValidTo). Migration 1's EXCLUDE USING gist constraint
        // guarantees at most one match, so SingleOrDefault would also be correct - FirstOrDefault
        // because a LINQ-to-objects Single that threw here would turn a master-data problem into
        // an unhandled exception on the job thread.
        var covering = candidates.FirstOrDefault(point =>
            point.ValidFrom <= series.DeliveryDate
            && (point.ValidTo is null || series.DeliveryDate < point.ValidTo));

        if (covering is null)
        {
            return SeriesResolutionOutcome.Quarantine(QuarantineReason.EanValidity);
        }

        if (covering.Commodity != Commodity.Electricity)
        {
            return SeriesResolutionOutcome.Quarantine(QuarantineReason.NotElectricity);
        }

        // [F02-R43]: the assignment in force at RECEIPT time decides WRONG_BRP. Reading the
        // metering point's CURRENT brp_id instead would retroactively quarantine every document
        // the previous BRP legitimately sent before a reassignment - and those documents are
        // already stored, so the damage lands on replay.
        var assignedBrpId = await db.MeteringPointBrpAssignments.AsNoTracking()
            .Where(assignment =>
                assignment.MeteringPointId == covering.Id && assignment.AssignedAt <= receivedAt)
            .OrderByDescending(assignment => assignment.AssignedAt)
            .Select(assignment => (Guid?)assignment.ToBrpId)
            .FirstOrDefaultAsync(ct);

        // No history row at all means the point was created after migration 9's backfill and
        // nothing has reassigned it. The current brp_id is then the only answer there is, and it
        // is the right one.
        var brpInForce = assignedBrpId ?? covering.BrpId;

        return brpInForce != messageBrpId
            ? SeriesResolutionOutcome.Quarantine(QuarantineReason.WrongBrp)
            : SeriesResolutionOutcome.Resolved(covering.Id, covering.CustomerId);
    }
}
```

- [ ] **Step 4: Wire the resolver into the handler**

In `ProcessInboundMessageHandler`, add `ISeriesResolver resolver` to the primary constructor
parameter list, immediately after `IRawPayloadStore payloads`:

```csharp
public sealed class ProcessInboundMessageHandler(
    PeakPowerDbContext db,
    IBrpIngestionAdapterRegistry adapters,
    IRawPayloadStore payloads,
    ISeriesResolver resolver,
    IOperationalAlertRaiser alerts,
    IDayStateRecomputer dayStates,
    IMarketCalendar calendar,
    ILogger<ProcessInboundMessageHandler> logger)
    : IInboundMessageProcessor, IProcessInboundMessageHandler
```

Then replace the whole body of the `foreach (var series in document.Series)` loop's opening — the
lines from `// The adapter never resolves an EAN` down to and including the closing brace of the
`SingleAsync(ct);` statement — with:

```csharp
            // [F02-R11]/[AS-17]: eighteen digits is an EAN, anything else is a descriptive
            // resource label and is NEVER offered to the EAN resolver. Skipped and counted, not
            // quarantined: none of the four reasons is true of it, and a fifth would put a routine
            // document on the operator's worklist with nothing to do about it.
            if (!series.ResourceObjectIsEan)
            {
                labelledSeriesSkipped++;
                logger.LogInformation(
                    "Skipped a series whose ResourceObject '{ResourceObject}' is a descriptive "
                    + "label rather than an EAN.",
                    series.ResourceObject);
                continue;
            }

            var resolution = await resolver.ResolveAsync(
                series, message.BrpId, message.ReceivedAt, ct);

            if (!resolution.IsResolved)
            {
                var quarantined = QuarantinedSeries.Quarantine(
                    message.Id,
                    message.BrpId,
                    resolution.Reason!.Value,
                    series.ResourceObject,
                    series.DeliveryDate,
                    series.Direction,
                    (short)series.Points.Count,
                    message.ReceivedAt);

                if (!quarantined.IsSuccess)
                {
                    throw new InvalidOperationException(
                        $"Could not quarantine a series: {quarantined.Error}");
                }

                db.QuarantinedSeries.Add(quarantined.Value);
                quarantineEntriesCreated++;

                logger.LogWarning(
                    "Quarantined a series for {ResourceObject} on {DeliveryDate} as {Reason}.",
                    series.ResourceObject, series.DeliveryDate, resolution.Reason);

                // Quarantine is NOT a rejection, so [F02-R13]'s all-or-nothing does not extend to
                // it: a good series beside a quarantined one still lands. Treating quarantine as a
                // document-level failure would let one unregistered EAN block a whole day for
                // every other customer named in the same document.
                continue;
            }

            var point = new
            {
                Id = resolution.MeteringPointId!.Value,
                CustomerId = resolution.CustomerId!.Value,
            };
```

and add the two counters beside `versionsCreated`:

```csharp
        var versionsCreated = 0;
        var quarantineEntriesCreated = 0;
        var labelledSeriesSkipped = 0;
```

and return them:

```csharp
        return new InboundMessageProcessingOutcome(
            versionsCreated > 0
                ? InboundMessageProcessingStatus.Applied
                : InboundMessageProcessingStatus.NoChange,
            versionsCreated, quarantineEntriesCreated, 0, labelledSeriesSkipped, null, null);
```

Finally, register the resolver in the Worker's TEMPORARY block (Task 17 folds it in):

```csharp
builder.Services.AddScoped<PeakPower.Ingestion.Processing.ISeriesResolver,
    PeakPower.Ingestion.Processing.DbSeriesResolver>();
```

- [ ] **Step 5: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~QuarantineTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ProcessingOutcomeTests|FullyQualifiedName~ApplyAtomicityTests"
```

Expected: PASS — 7 tests, then 9 tests, 0 failed.

- [ ] **Step 6: Verify by mutation — `UNKNOWN_EAN` and `EAN_VALIDITY` are two answers**

**What to break:** in `DbSeriesResolver.ResolveAsync`, delete the `candidates.Count == 0` branch and
let the `covering is null` branch answer `EanValidity` for both.

**What to predict:** `an_ean_registered_nowhere_quarantines_as_UNKNOWN_EAN` fails with
`entry.Reason should be UnknownEan but was EanValidity`. The `EAN_VALIDITY` test stays green.

**What to watch go red:** that one. Design §7.6 lists them as separate definition-of-done clauses
precisely because they send an operator to different screens.

Restore.

- [ ] **Step 7: Verify by mutation — `WRONG_BRP` really reads the assignment history**

**What to break:** in `DbSeriesResolver.ResolveAsync`, replace the assignment lookup with
`var brpInForce = covering.BrpId;` (and delete the now-unused `assignedBrpId` local so the build
still succeeds).

**What to predict:**
`WRONG_BRP_is_decided_against_the_assignment_in_force_at_RECEIPT_time` fails with
`outcome.VersionsCreated should be 1 but was 0` and `QuarantineEntriesCreated should be 0 but was 1`.
`an_ean_assigned_to_another_brp_quarantines_as_WRONG_BRP` stays **green**.

**What to watch go red:** the reassignment test alone. That asymmetry is the whole value: the simple
`WRONG_BRP` case is satisfied by the wrong implementation, and `[F02-R43]`'s "in force at receipt
time" is the only clause that distinguishes them.

Restore.

- [ ] **Step 8: Verify by mutation — a label is never offered to the resolver**

**What to break:** delete the `if (!series.ResourceObjectIsEan)` block from the handler's loop.

**What to predict:** `a_labelled_resource_object_is_skipped_and_NOT_quarantined` fails with
`InvalidOperationException: A series whose ResourceObject 'Prognosis' is not an EAN must never be
offered to the EAN resolver [F02-R11].` — thrown by the resolver's own guard.

**What to watch go red:** that test. Note what the guard bought: without it the mutation would
produce a plausible `UNKNOWN_EAN` row that an operator could never clear, and the test would fail on
a count rather than on a message naming the rule.

Restore.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Ingestion/Processing/SeriesResolution.cs \
        src/Infrastructure/PeakPower.Ingestion/Processing/ProcessInboundMessageHandler.cs \
        src/Hosts/PeakPower.Worker/Program.cs \
        tests/PeakPower.Integration.Tests/Ingestion/QuarantineTests.cs
git commit -m "feat(ingestion): resolve a series to a metering point, or quarantine it

Shared contract §8.5's four reasons, in the order the table gives them. UNKNOWN_EAN and EAN_VALIDITY
are separate answers - mutation-verified by collapsing them, which fails only the unknown-EAN test -
because they send an operator to different screens.

WRONG_BRP reads customer.metering_point_brp_assignment for the assignment in force at RECEIPT time
[F02-R43]. Mutation-verified against reading the current brp_id, which passes the simple wrong-BRP
test and fails only the reassignment case - the case the requirement exists for, because deciding on
the current value retroactively quarantines every document the previous BRP legitimately sent.

A non-EAN ResourceObject is skipped and counted, never quarantined [F02-R11]/[AS-17]: a false
UNKNOWN_EAN for 'Prognosis' is an entry no operator can ever clear.

Quarantine is not a rejection: a good series beside a quarantined one still lands, and the message
reaches PROCESSED rather than FAILED.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: The advisory lock on (metering point, delivery date)

Contract §9.6 step 4:

> Take a **transaction-scoped Postgres advisory lock** on
> `hashtextextended(metering_point_id::text || ':' || delivery_date::text, 0)` —
> `pg_advisory_xact_lock(bigint)` — once per (metering point, delivery date) in the document,
> **in a deterministic order** (metering point id, then date) so two documents cannot deadlock.

`[DEC-38]`'s one-document-per-EAN-per-day cadence makes (metering point, delivery date) "the
**natural unit of concurrency** — the pipeline parallelises across EANs with no contention". The
lock is what makes that sentence true when two documents for the *same* EAN and day do arrive
together, which is exactly what a correction is.

⚠ **Without the lock, supersession is a lost update.** Two workers both read "the current version",
both set it superseded, both insert. `ux_idv_current` catches the second insert as a `23505` — so
the failure is loud rather than silent — but the message is left `PROCESSING` and the operator sees
a unique-violation stack trace instead of a correction. The lock turns a race into a queue.

⚠ **Deterministic order, and it must be total.** Two documents that each touch the same two
(point, day) pairs in opposite orders deadlock. Ordering by `(MeteringPointId, DeliveryDate)` gives
every transaction the same sequence, so one simply waits.

⚠ **Transaction-scoped (`pg_advisory_xact_lock`), never session-scoped.** A session-scoped lock
outlives a rollback, and the connection goes back to the pool still holding it.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/AdvisoryLock.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/ProcessInboundMessageHandler.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/AdvisoryLockTests.cs`

**Interfaces:**
- Consumes: `MeteringPointDay` (Task 9); `PeakPowerDbContext.Database` (EF Core).
- Produces: `AdvisoryLock.TakeAsync(DatabaseFacade, IReadOnlyList<MeteringPointDay>, CancellationToken)` ·
  `AdvisoryLock.KeyFor(MeteringPointDay)` ·
  `AdvisoryLock.InLockOrder(IEnumerable<MeteringPointDay>)` — which Step 5 also folds the Task 10
  day-state recompute loop onto, so the lock order has exactly one definition.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/AdvisoryLockTests.cs`:

```csharp
using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Ingestion.Processing;
using PeakPower.Integration.Tests.Database;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

[Collection(PostgresCollection.Name)]
public sealed class AdvisoryLockTests(PostgresFixture postgres)
{
    private static readonly Guid PointA = Guid.Parse("0199c1c1-0000-7000-8000-00000000000a");
    private static readonly Guid PointB = Guid.Parse("0199c1c1-0000-7000-8000-00000000000b");
    private static readonly DateOnly Day = new(2026, 8, 12);

    [Fact]
    public void the_key_is_the_composite_the_contract_names()
    {
        // metering_point_id::text || ':' || delivery_date::text. The delivery date is rendered
        // ISO-8601, because a locale-dependent rendering would give two workers on differently
        // configured machines two different keys for one day.
        AdvisoryLock.KeyFor(new MeteringPointDay(PointA, Day))
            .ShouldBe($"{PointA}:2026-08-12");
    }

    [Fact]
    public void orders_the_pairs_by_metering_point_then_date()
    {
        // Total, deterministic, and the same for every transaction. Two documents touching the
        // same pairs in opposite orders deadlock without it.
        var unordered = new List<MeteringPointDay>
        {
            new(PointB, Day),
            new(PointA, Day.AddDays(1)),
            new(PointA, Day),
        };

        AdvisoryLock.InLockOrder(unordered).ShouldBe(
        [
            new MeteringPointDay(PointA, Day),
            new MeteringPointDay(PointA, Day.AddDays(1)),
            new MeteringPointDay(PointB, Day),
        ]);
    }

    [Fact]
    public async Task a_second_transaction_waits_for_the_first_on_the_same_pair()
    {
        var pairs = new List<MeteringPointDay> { new(PointA, Day) };

        await using var first = postgres.CreateContext();
        await using var firstTransaction = await first.Database.BeginTransactionAsync(
            TestContext.Current.CancellationToken);
        await AdvisoryLock.TakeAsync(first.Database, pairs, TestContext.Current.CancellationToken);

        var secondEntered = false;
        var second = Task.Run(async () =>
        {
            await using var context = postgres.CreateContext();
            await using var transaction = await context.Database.BeginTransactionAsync(
                TestContext.Current.CancellationToken);
            await AdvisoryLock.TakeAsync(
                context.Database, pairs, TestContext.Current.CancellationToken);
            secondEntered = true;
            await transaction.RollbackAsync(TestContext.Current.CancellationToken);
        });

        // Long enough that a lock that did not block would have finished many times over, short
        // enough not to slow the suite down.
        await Task.Delay(750, TestContext.Current.CancellationToken);
        secondEntered.ShouldBeFalse("the second transaction must wait for the first");

        await firstTransaction.RollbackAsync(TestContext.Current.CancellationToken);
        await second.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
        secondEntered.ShouldBeTrue("the second transaction must proceed once the first releases");
    }

    [Fact]
    public async Task two_transactions_on_DIFFERENT_pairs_do_not_block_each_other()
    {
        // [DEC-38]: (metering point, delivery date) is "the natural unit of concurrency - the
        // pipeline parallelises across EANs with no contention". A lock that serialised every
        // document would make that false and turn the 100-EAN load test into a queue.
        await using var first = postgres.CreateContext();
        await using var firstTransaction = await first.Database.BeginTransactionAsync(
            TestContext.Current.CancellationToken);
        await AdvisoryLock.TakeAsync(
            first.Database, [new MeteringPointDay(PointA, Day)], TestContext.Current.CancellationToken);

        var stopwatch = Stopwatch.StartNew();
        await using (var second = postgres.CreateContext())
        {
            await using var secondTransaction = await second.Database.BeginTransactionAsync(
                TestContext.Current.CancellationToken);
            await AdvisoryLock.TakeAsync(
                second.Database, [new MeteringPointDay(PointB, Day)],
                TestContext.Current.CancellationToken);
            await secondTransaction.RollbackAsync(TestContext.Current.CancellationToken);
        }

        stopwatch.Stop();
        stopwatch.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(2));

        await firstTransaction.RollbackAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task the_lock_is_released_by_a_rollback()
    {
        // pg_advisory_xact_lock, not pg_advisory_lock. A session-scoped lock survives the rollback
        // and goes back into the connection pool still held - and the next request to draw that
        // connection blocks on a lock nothing will ever release.
        var pairs = new List<MeteringPointDay> { new(PointA, Day.AddDays(2)) };

        await using (var first = postgres.CreateContext())
        {
            await using var transaction = await first.Database.BeginTransactionAsync(
                TestContext.Current.CancellationToken);
            await AdvisoryLock.TakeAsync(
                first.Database, pairs, TestContext.Current.CancellationToken);
            await transaction.RollbackAsync(TestContext.Current.CancellationToken);
        }

        await using var second = postgres.CreateContext();
        await using var secondTransaction = await second.Database.BeginTransactionAsync(
            TestContext.Current.CancellationToken);

        var stopwatch = Stopwatch.StartNew();
        await AdvisoryLock.TakeAsync(second.Database, pairs, TestContext.Current.CancellationToken);
        stopwatch.Stop();

        stopwatch.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(2));
        await secondTransaction.RollbackAsync(TestContext.Current.CancellationToken);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~AdvisoryLockTests"
```

Expected: FAIL — build error
`error CS0103: The name 'AdvisoryLock' does not exist in the current context`.

- [ ] **Step 3: Write the lock**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/AdvisoryLock.cs`:

```csharp
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using PeakPower.Application.Abstractions.Ingestion;

namespace PeakPower.Ingestion.Processing;

/// <summary>
/// The per-(metering point, delivery date) mutex of shared contract §9.6 step 4.
/// </summary>
/// <remarks>
/// <para>
/// [DEC-38] makes (metering point, delivery date) "the natural unit of concurrency — the pipeline
/// parallelises across EANs with no contention". This is what makes that true when two documents
/// for the <i>same</i> EAN and day do arrive together, which is exactly what a correction is.
/// </para>
/// <para>
/// <b>Without it, supersession is a lost update.</b> Two workers both read "the current version",
/// both mark it superseded, both insert. <c>ux_idv_current</c> catches the second insert as a
/// 23505, so the failure is loud — but the message is left PROCESSING and the operator sees a
/// unique-violation stack trace instead of a correction. The lock turns the race into a queue.
/// </para>
/// </remarks>
public static class AdvisoryLock
{
    /// <summary>
    /// The lock key for one pair, exactly as shared contract §9.6 writes it:
    /// <c>metering_point_id::text || ':' || delivery_date::text</c>.
    /// </summary>
    /// <remarks>
    /// The date is rendered ISO-8601 with the invariant culture. A locale-dependent rendering
    /// would give two workers on differently configured machines two different keys for one day —
    /// which is a lock that is held and a lock that is not.
    /// </remarks>
    public static string KeyFor(MeteringPointDay pair) =>
        $"{pair.MeteringPointId}:{pair.DeliveryDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}";

    /// <summary>
    /// The pairs in the one order every transaction takes them in: metering point, then date.
    /// </summary>
    /// <remarks>
    /// Total and deterministic. Two documents that each touch the same two pairs in opposite
    /// orders deadlock; with one order, the second simply waits.
    /// </remarks>
    public static IReadOnlyList<MeteringPointDay> InLockOrder(IEnumerable<MeteringPointDay> pairs) =>
    [
        .. pairs
            .Distinct()
            .OrderBy(pair => pair.MeteringPointId)
            .ThenBy(pair => pair.DeliveryDate),
    ];

    /// <summary>
    /// Takes a transaction-scoped advisory lock on every pair, in lock order.
    /// </summary>
    /// <remarks>
    /// <c>pg_advisory_xact_lock</c> and never <c>pg_advisory_lock</c>: a session-scoped lock
    /// survives a rollback and returns to the connection pool still held, and the next request to
    /// draw that connection blocks on something nothing will ever release.
    /// </remarks>
    public static async Task TakeAsync(
        DatabaseFacade database, IReadOnlyList<MeteringPointDay> pairs, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(database);
        ArgumentNullException.ThrowIfNull(pairs);

        foreach (var pair in InLockOrder(pairs))
        {
            var key = KeyFor(pair);
            await database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock(hashtextextended({key}, 0))", ct);
        }
    }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~AdvisoryLockTests"
```

Expected: PASS — 5 tests, 0 failed.

- [ ] **Step 5: Take the lock in the apply transaction**

The pairs must be known **before** any row is written, so the loop that resolves series and the loop
that writes them have to be separated. In `ProcessInboundMessageHandler.ApplyAsync`, immediately
after `await using var transaction = await db.Database.BeginTransactionAsync(ct);`, insert:

```csharp
        // Step 4 of shared contract §9.6, and it must happen BEFORE the first row is read or
        // written. The pairs come from the document itself - the adapter has already resolved each
        // series' delivery date - so the metering-point half is resolved first, in lock order, and
        // nothing is inserted until every lock is held.
        var declaredPairs = new List<MeteringPointDay>();
        var resolutions = new List<(CanonicalSeries Series, SeriesResolutionOutcome Resolution)>();

        foreach (var series in document.Series)
        {
            if (!series.ResourceObjectIsEan)
            {
                continue;
            }

            var resolved = await resolver.ResolveAsync(series, message.BrpId, message.ReceivedAt, ct);
            resolutions.Add((series, resolved));

            if (resolved.IsResolved)
            {
                declaredPairs.Add(
                    new MeteringPointDay(resolved.MeteringPointId!.Value, series.DeliveryDate));
            }
        }

        await AdvisoryLock.TakeAsync(db.Database, declaredPairs, ct);
```

and change the writing loop's header from

```csharp
        foreach (var series in document.Series)
        {
```

to

```csharp
        foreach (var series in document.Series)
        {
            if (!series.ResourceObjectIsEan)
            {
                labelledSeriesSkipped++;
                logger.LogInformation(
                    "Skipped a series whose ResourceObject '{ResourceObject}' is a descriptive "
                    + "label rather than an EAN.",
                    series.ResourceObject);
                continue;
            }

            var resolution = resolutions.Single(entry =>
                ReferenceEquals(entry.Series, series)).Resolution;
```

deleting the `var resolution = await resolver.ResolveAsync(...)` line that Task 13 put there — the
resolution is now read from the list built above the lock, not re-queried.

⚠ **Resolving before the lock and writing after it is the only correct order.** Resolving inside the
lock would mean holding no lock while deciding which pairs to lock, and taking the lock before
resolution would mean not knowing what to lock. `MeteringPoint` master data is not what the lock
protects — the version rows are — so reading it unlocked is safe.

Finally, in the same method, fold the day-state recompute loop onto the order that now has a name.
Replace the three lines Task 10 wrote —

```csharp
        foreach (var pair in touched
            .OrderBy(candidate => candidate.MeteringPointId)
            .ThenBy(candidate => candidate.DeliveryDate))
```

— with:

```csharp
        foreach (var pair in AdvisoryLock.InLockOrder(touched))
```

⚠ **One definition of lock order, not two.** `InLockOrder` also de-duplicates, which `touched`
already does as a `HashSet`, so nothing about the recompute changes; the point is that after this
edit the lock acquisition and the recompute cannot sort differently, because only one sort is left
in the file. Two copies of a total order stay identical only until somebody edits one of them.

- [ ] **Step 6: Run the whole ingestion suite**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Ingestion"
```

Expected: PASS — every test written so far, 0 failed.

- [ ] **Step 7: Verify by mutation — the lock is transaction-scoped**

**What to break:** in `AdvisoryLock.TakeAsync`, change `pg_advisory_xact_lock` to
`pg_advisory_lock`.

**What to predict:** `the_lock_is_released_by_a_rollback` fails by **hanging** until the test's
cancellation token fires — the second `TakeAsync` waits forever on a lock the rolled-back
transaction never released, because the connection went back to the pool still holding it.

**What to watch go red:** that test, as a timeout rather than an assertion failure. Read the
distinction: a hang here is the symptom in production too, and it is the one that is hardest to
diagnose from a log.

⚠ Kill the test run after 60 s if it does not terminate on its own, and restore before running
anything else — a leaked session lock can outlive the run and block the next one against the same
container.

Restore.

- [ ] **Step 8: Verify by mutation — the ordering is what prevents the deadlock**

**What to break:** in `AdvisoryLock.InLockOrder`, remove `.OrderBy(...)` and `.ThenBy(...)`, keeping
only `.Distinct()`.

**What to predict:** `orders_the_pairs_by_metering_point_then_date` fails with
`should be [MeteringPointDay { MeteringPointId = 0199c1c1-…-a, DeliveryDate = 2026-08-12 }, …] but
was [MeteringPointDay { MeteringPointId = 0199c1c1-…-b, … }, …]`.

**What to watch go red:** that test. The concurrency tests stay green, because neither of them
takes two locks — which is exactly why the ordering is asserted directly rather than left to a
deadlock test that would be slow and flaky.

Restore.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Ingestion/Processing/AdvisoryLock.cs \
        src/Infrastructure/PeakPower.Ingestion/Processing/ProcessInboundMessageHandler.cs \
        tests/PeakPower.Integration.Tests/Ingestion/AdvisoryLockTests.cs
git commit -m "feat(ingestion): serialise the apply on (metering point, delivery date)

Shared contract §9.6 step 4. pg_advisory_xact_lock over hashtextextended of
'{metering_point_id}:{delivery_date}', taken once per pair in metering-point-then-date order so two
documents touching the same pairs cannot deadlock.

Transaction-scoped and never session-scoped: mutation-verified by swapping in pg_advisory_lock,
which makes the rollback test HANG rather than fail - the same symptom it would have in production,
where the connection returns to the pool still holding the lock.

The ordering is asserted directly rather than through a deadlock test: the concurrency tests take
one lock each and cannot see it, and a two-document deadlock test would be slow and flaky.

Series are resolved BEFORE the lock and written after it. Resolving inside would mean deciding what
to lock while holding no lock; locking first would mean not knowing what to lock.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Receipt-order supersession — the one that is unrecoverable if wrong

**Read design §4.2 before writing a line of this task.**

> The current version of a (metering point, delivery date, direction) is always **the last one
> received**, never the newest by `CreatedDateTime`. Both receipt orders of the same pair therefore
> leave the second-received version current. This is enforced by the `ux_idv_current` partial unique
> index and is the single assertion §10 requires to be mutation-verified by swapping in
> `CreatedDateTime` order.

And design §1:

> **Ingestion is the only Phase-1 work whose mistakes are unrecoverable.** A wrongly-ordered
> supersession is indistinguishable from correct data afterwards.

`[F02-R17]` states the rule: "The newest **received** version is authoritative, per the PVNed rule
'the latest and greatest received document provides actual data'. Ordering is by receipt time, with
the document's creation timestamp as a tiebreaker. This is a **pipeline** rule and applies to every
adapter — a BRP that *does* revise documents is still resolved on receipt order, because receipt
order is the only ordering the platform observes itself."

⚠ **`CreatedDateTime` is a tiebreaker and nothing more.** It breaks ties between two versions with
*identical* receipt times. It never overrides receipt order, and an implementation that sorts by it
first is the one this task exists to catch.

⚠ **`Supersede()` never deletes** (`[F02-R18]`). Previous versions remain queryable — that is what
makes a per-interval diff (deferred, `[F02-R21]`) and an audit of a correction possible at all.

⚠ **Set `is_current = false` on the previous current version BEFORE inserting the new one**
(contract §9.6 step 6), and do it inside the advisory lock, or `ux_idv_current` raises `23505`.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/ProcessInboundMessageHandler.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/SupersessionTests.cs`

**Interfaces:**
- Consumes: `IntervalDataVersion.Supersede()`, `IntervalDataVersion.IsCurrent`,
  `PeakPowerDbContext.IntervalDataVersions` (plan 2); `AdvisoryLock` (Task 14).
- Produces: nothing new. This task changes one method's body.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/SupersessionTests.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Processing;
using PeakPower.Ingestion.Receipt;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

/// <summary>
/// Design §4.2 and [F02-R17]: the current version is <b>always the last one received</b>, never the
/// newest by <c>CreatedDateTime</c>.
/// </summary>
/// <remarks>
/// Design §1 is why this file is written the way it is: "a wrongly-ordered supersession is
/// indistinguishable from correct data afterwards". There is no later test that catches it and no
/// repair that recovers it; the numbers are simply wrong and look right.
/// </remarks>
public sealed class SupersessionTests : IClassFixture<SupersessionTests.FakeAdapterFactory>
{
    private static readonly DateOnly Day = new(2026, 8, 12);

    private static readonly DateTimeOffset CreatedEarly =
        DateTimeOffset.Parse("2026-08-13T03:00:00Z", null);

    private static readonly DateTimeOffset CreatedLate =
        DateTimeOffset.Parse("2026-08-13T09:00:00Z", null);

    private readonly FakeAdapterFactory _factory;

    public SupersessionTests(FakeAdapterFactory factory) => _factory = factory;

    public sealed class FakeAdapterFactory : WorkerFactory
    {
        public FakeAdapterFactory() => ExtraAdapters.Add(new FakeBrpIngestionAdapter("FAKE_SUPERSEDE_V1"));
    }

    private async Task<(Guid BrpId, string Ean, Guid PointId)> SeedAsync(string code, string kvk)
    {
        await using var db = _factory.CreateOwnerDbContext();
        var brpId = await IngestionSeed.AddBrpAsync(db, code, ct: TestContext.Current.CancellationToken);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE metering.brp SET adapter_key = 'FAKE_SUPERSEDE_V1' WHERE id = {brpId}",
            TestContext.Current.CancellationToken);

        var customerId = await IngestionSeed.AddCustomerAsync(
            db, $"Supersede {code} B.V.", kvk, TestContext.Current.CancellationToken);
        var ean = IngestionSeed.NextEan();
        var pointId = await IngestionSeed.AddMeteringPointAsync(
            db, customerId, brpId, ean, new DateOnly(2026, 1, 1),
            ct: TestContext.Current.CancellationToken);

        return (brpId, ean, pointId);
    }

    /// <summary>Receives and processes one document, and returns its message id.</summary>
    private async Task<Guid> DeliverAsync(
        Guid brpId, string ean, string documentId, DateTimeOffset createdAt, decimal kwh)
    {
        var payload = new TestDocument(documentId, createdAt)
            .WithFlatDay(ean, Day, IntervalDirection.Consumption, kwh)
            .ToBytes();

        Guid messageId;
        using (var scope = _factory.Services.CreateScope())
        {
            var receipt = await scope.ServiceProvider.GetRequiredService<IInboundMessageReceiver>()
                .ReceiveAsync(
                    new InboundMessageArrival(brpId, Guid.CreateVersion7(), payload, null, "10.0.0.7"),
                    TestContext.Current.CancellationToken);
            messageId = receipt.InboundMessageId;
        }

        await using var db = _factory.CreateOwnerDbContext();
        var correlationId = await db.InboundMessages.AsNoTracking()
            .Where(m => m.Id == messageId).Select(m => m.CorrelationId)
            .SingleAsync(TestContext.Current.CancellationToken);

        using var processScope = _factory.Services.CreateScope();
        await processScope.ServiceProvider.GetRequiredService<IInboundMessageProcessor>()
            .ProcessAsync(messageId, correlationId, TestContext.Current.CancellationToken);

        return messageId;
    }

    private async Task<List<IntervalDataVersion>> VersionsAsync(Guid pointId)
    {
        await using var db = _factory.CreateOwnerDbContext();
        return await db.IntervalDataVersions.AsNoTracking()
            .Where(v => v.MeteringPointId == pointId && v.Direction == IntervalDirection.Consumption)
            .OrderBy(v => v.ReceivedAt)
            .ToListAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task the_ordinary_correction_supersedes_the_first_version()
    {
        var (brpId, ean, pointId) = await SeedAsync("SUP1", "12345640");

        await DeliverAsync(brpId, ean, "DOC-SUP1-A", CreatedEarly, 100m);
        await DeliverAsync(brpId, ean, "DOC-SUP1-B", CreatedLate, 110m);

        var versions = await VersionsAsync(pointId);

        versions.Count.ShouldBe(2);
        versions[0].DocumentId.ShouldBe("DOC-SUP1-A");
        versions[0].IsCurrent.ShouldBeFalse();
        versions[1].DocumentId.ShouldBe("DOC-SUP1-B");
        versions[1].IsCurrent.ShouldBeTrue();
    }

    [Fact]
    public async Task an_EARLIER_created_document_RECEIVED_SECOND_still_becomes_current()
    {
        // ⚠ THE ASSERTION. Design §4.2: the current version is always the last one RECEIVED. A
        // correction whose CreatedDateTime is EARLIER but which arrives second still supersedes,
        // because receipt order is the only ordering the platform observes itself [F02-R17].
        var (brpId, ean, pointId) = await SeedAsync("SUP2", "12345641");

        await DeliverAsync(brpId, ean, "DOC-SUP2-LATE-CREATED", CreatedLate, 100m);
        await DeliverAsync(brpId, ean, "DOC-SUP2-EARLY-CREATED", CreatedEarly, 110m);

        var versions = await VersionsAsync(pointId);

        versions.Count.ShouldBe(2);
        versions[1].DocumentId.ShouldBe("DOC-SUP2-EARLY-CREATED");
        versions[1].IsCurrent.ShouldBeTrue();
        versions[1].DocumentCreated.ShouldBe(CreatedEarly);

        versions[0].DocumentId.ShouldBe("DOC-SUP2-LATE-CREATED");
        versions[0].IsCurrent.ShouldBeFalse();
    }

    [Fact]
    public async Task both_receipt_orders_of_the_SAME_PAIR_leave_the_second_received_current()
    {
        // Design §7.5 in as many words. The same two documents, delivered in each order against
        // two different metering points: whichever arrives second is current, both times. A
        // CreatedDateTime implementation makes the SAME document current in both runs, which is
        // how this test tells the two apart.
        var (brpIdA, eanA, pointA) = await SeedAsync("SUP3A", "12345642");
        var (brpIdB, eanB, pointB) = await SeedAsync("SUP3B", "12345643");

        await DeliverAsync(brpIdA, eanA, "EARLY-CREATED", CreatedEarly, 100m);
        await DeliverAsync(brpIdA, eanA, "LATE-CREATED", CreatedLate, 110m);

        await DeliverAsync(brpIdB, eanB, "LATE-CREATED", CreatedLate, 110m);
        await DeliverAsync(brpIdB, eanB, "EARLY-CREATED", CreatedEarly, 100m);

        var forA = await VersionsAsync(pointA);
        var forB = await VersionsAsync(pointB);

        forA.Single(v => v.IsCurrent).DocumentId.ShouldBe("LATE-CREATED");
        forB.Single(v => v.IsCurrent).DocumentId.ShouldBe("EARLY-CREATED");
    }

    [Fact]
    public async Task the_superseded_version_and_its_readings_remain_queryable()
    {
        // [F02-R18]: superseding never deletes. Previous versions remain queryable - which is what
        // makes an audit of a correction, and the deferred per-interval diff [F02-R21], possible
        // at all.
        var (brpId, ean, pointId) = await SeedAsync("SUP4", "12345644");

        await DeliverAsync(brpId, ean, "DOC-SUP4-A", CreatedEarly, 100m);
        await DeliverAsync(brpId, ean, "DOC-SUP4-B", CreatedLate, 110m);

        var versions = await VersionsAsync(pointId);
        var superseded = versions.Single(v => !v.IsCurrent);

        await using var db = _factory.CreateOwnerDbContext();
        var readings = await db.IntervalReadings.AsNoTracking()
            .Where(r => r.VersionId == superseded.Id)
            .ToListAsync(TestContext.Current.CancellationToken);

        readings.Count.ShouldBe(96);
        readings.ShouldAllBe(r => r.QuantityKwh == 100m);
    }

    [Fact]
    public async Task exactly_one_version_is_current_per_point_date_and_direction()
    {
        // ux_idv_current is a PARTIAL unique index on (metering_point_id, delivery_date, direction)
        // WHERE is_current. Asserting the count here as well as relying on the index means a
        // failure reads as "two current versions" rather than as a 23505 from an INSERT.
        var (brpId, ean, pointId) = await SeedAsync("SUP5", "12345645");

        await DeliverAsync(brpId, ean, "DOC-SUP5-A", CreatedEarly, 100m);
        await DeliverAsync(brpId, ean, "DOC-SUP5-B", CreatedLate, 110m);
        await DeliverAsync(brpId, ean, "DOC-SUP5-C", CreatedEarly, 120m);

        var versions = await VersionsAsync(pointId);

        versions.Count.ShouldBe(3);
        versions.Count(v => v.IsCurrent).ShouldBe(1);
        versions.Single(v => v.IsCurrent).DocumentId.ShouldBe("DOC-SUP5-C");
    }

    [Fact]
    public async Task the_two_directions_supersede_independently()
    {
        // ux_idv_current is keyed on direction as well. A correction to consumption must not
        // supersede the day's production series, which was never in that document.
        var (brpId, ean, pointId) = await SeedAsync("SUP6", "12345646");

        var both = new TestDocument("DOC-SUP6-A", CreatedEarly)
            .WithFlatDay(ean, Day, IntervalDirection.Consumption, 100m)
            .WithFlatDay(ean, Day, IntervalDirection.Production, 5m)
            .ToBytes();

        Guid messageId;
        using (var scope = _factory.Services.CreateScope())
        {
            var receipt = await scope.ServiceProvider.GetRequiredService<IInboundMessageReceiver>()
                .ReceiveAsync(
                    new InboundMessageArrival(brpId, Guid.CreateVersion7(), both, null, "10.0.0.7"),
                    TestContext.Current.CancellationToken);
            messageId = receipt.InboundMessageId;
        }

        await using (var db = _factory.CreateOwnerDbContext())
        {
            var correlationId = await db.InboundMessages.AsNoTracking()
                .Where(m => m.Id == messageId).Select(m => m.CorrelationId)
                .SingleAsync(TestContext.Current.CancellationToken);

            using var scope = _factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<IInboundMessageProcessor>()
                .ProcessAsync(messageId, correlationId, TestContext.Current.CancellationToken);
        }

        // Consumption only, second.
        await DeliverAsync(brpId, ean, "DOC-SUP6-B", CreatedLate, 110m);

        await using var read = _factory.CreateOwnerDbContext();
        var all = await read.IntervalDataVersions.AsNoTracking()
            .Where(v => v.MeteringPointId == pointId)
            .ToListAsync(TestContext.Current.CancellationToken);

        all.Count(v => v.Direction == IntervalDirection.Consumption && v.IsCurrent).ShouldBe(1);
        all.Single(v => v.Direction == IntervalDirection.Consumption && v.IsCurrent)
            .DocumentId.ShouldBe("DOC-SUP6-B");

        // Untouched, and still current.
        all.Count(v => v.Direction == IntervalDirection.Production).ShouldBe(1);
        all.Single(v => v.Direction == IntervalDirection.Production).IsCurrent.ShouldBeTrue();
    }
}
```

⚠ `DeliverAsync` posts through the real receiver, so each document gets its own `ReceivedAt` from
`IMarketCalendar.UtcNow` in receipt order. That is the point: **receipt order is a fact about when
the platform saw the bytes**, not a field a test sets.

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~SupersessionTests"
```

Expected: FAIL — every test that delivers a second document for the same (point, day, direction)
fails with a Postgres unique violation surfaced through EF Core:

```
Microsoft.EntityFrameworkCore.DbUpdateException: An error occurred while saving the entity changes.
 ---> Npgsql.PostgresException (0x80004005): 23505: duplicate key value violates unique constraint "ux_idv_current"
```

That exception is the current behaviour and it is the right failure to see first: `ux_idv_current`
is doing its job, and nothing has yet superseded the previous version.

- [ ] **Step 3: Supersede before inserting**

In `ProcessInboundMessageHandler.ApplyAsync`, inside the writing loop, immediately **before** the
`var version = IntervalDataVersion.FromBrpFeed(` statement, insert:

```csharp
            // Step 6 of shared contract §9.6, and design §4.2 is the whole of it: the current
            // version is ALWAYS the last one RECEIVED, never the newest by CreatedDateTime. Both
            // receipt orders of the same pair leave the second-received version current.
            //
            // ⚠ Do not "improve" this by comparing DocumentCreated. [F02-R17] makes the creation
            // timestamp a TIEBREAKER between two versions with identical receipt times and nothing
            // more. A BRP that revises documents is still resolved on receipt order, because
            // receipt order is the only ordering the platform observes itself - and a wrongly
            // ordered supersession is indistinguishable from correct data afterwards (design §1).
            //
            // Tracked, not AsNoTracking: Supersede() must be part of this transaction's change
            // set. Inside the advisory lock taken above, so two workers cannot both read "no
            // current version" and both insert - ux_idv_current would catch the second as a 23505
            // and leave the message stuck in PROCESSING.
            var superseded = await db.IntervalDataVersions
                .Where(candidate =>
                    candidate.MeteringPointId == point.Id
                    && candidate.DeliveryDate == series.DeliveryDate
                    && candidate.Direction == series.Direction
                    && candidate.IsCurrent)
                .SingleOrDefaultAsync(ct);

            // [F02-R18]: superseding never deletes. The row keeps its readings and stays
            // queryable; only is_current moves.
            superseded?.Supersede();
```

- [ ] **Step 4: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~SupersessionTests"
```

Expected: PASS — 6 tests, 0 failed.

- [ ] **Step 5: Run the whole ingestion suite**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Ingestion"
```

Expected: PASS — everything so far, 0 failed.

- [ ] **Step 6: ⚠ THE MUTATION DESIGN §10.2 REQUIRES — swap to `CreatedDateTime` order**

This is one of the four assertions design §10 names, and it is the one design §1 calls
unrecoverable. **It may not be skipped, and it may not be replaced with a cheaper mutation.**

**What to break:** replace the supersession block written in Step 3 with an implementation that
orders by the document's creation timestamp — the plausible, wrong version:

```csharp
            // MUTATION: "the newest document wins", ordered by CreatedDateTime.
            var current = await db.IntervalDataVersions
                .Where(candidate =>
                    candidate.MeteringPointId == point.Id
                    && candidate.DeliveryDate == series.DeliveryDate
                    && candidate.Direction == series.Direction
                    && candidate.IsCurrent)
                .SingleOrDefaultAsync(ct);

            if (current is not null && current.DocumentCreated <= document.DocumentCreated)
            {
                current.Supersede();
            }
            else if (current is not null)
            {
                // The incoming document is "older", so it lands superseded instead.
                superseded = null;
            }
```

**What to predict — precisely, before running it:**

1. `an_EARLIER_created_document_RECEIVED_SECOND_still_becomes_current` fails with
   `versions[1].IsCurrent should be True but was False` — or, depending on how the mutated branch
   inserts, with a `23505` on `ux_idv_current`, because the earlier-created document is inserted
   with `is_current = true` while the later-created one still holds it.
2. `both_receipt_orders_of_the_SAME_PAIR_leave_the_second_received_current` fails on the **second**
   assertion: `forB.Single(v => v.IsCurrent).DocumentId should be "EARLY-CREATED" but was
   "LATE-CREATED"`. Under `CreatedDateTime` order the *same* document is current in both runs, and
   that is the signature of the bug.
3. `the_ordinary_correction_supersedes_the_first_version` stays **green** — the ordinary case
   agrees under both rules.

**What to watch go red:** exactly tests 1 and 2, with test 3 green. If test 3 also fails, the
mutation is wrong (it broke something else) and proves nothing; fix the mutation and re-run.

Record the observed failure messages in the commit body. Then restore Step 3's implementation and
run the suite again.

- [ ] **Step 7: Verify by mutation — supersession does not delete**

**What to break:** replace `superseded?.Supersede();` with

```csharp
            if (superseded is not null)
            {
                db.IntervalDataVersions.Remove(superseded);
            }
```

**What to predict:** `the_superseded_version_and_its_readings_remain_queryable` fails with
`versions.Single(v => !v.IsCurrent)` throwing
`InvalidOperationException: Sequence contains no matching element`; and
`exactly_one_version_is_current_per_point_date_and_direction` fails with
`versions.Count should be 3 but was 1`.

**What to watch go red:** both. `[F02-R18]` exists because a deleted version cannot be diffed, cannot
be audited, and cannot answer "what did we invoice on".

⚠ The delete may instead fail with a foreign-key violation from `interval_reading.version_id`, which
is also a red — but it is a *different* red, and if that is what happens, say so rather than
claiming the assertion caught it.

Restore.

- [ ] **Step 8: Verify by mutation — the supersede happens inside the lock**

**What to break:** move `await AdvisoryLock.TakeAsync(db.Database, declaredPairs, ct);` to *after*
the writing loop.

**What to predict:** every existing test stays green — the suite delivers documents sequentially and
cannot see it.

**What to do about it:** that is a hole in the evidence, and it is worth one more test. Add this to
`SupersessionTests`, watch it fail against the mutation, restore, and watch it pass:

```csharp
    [Fact]
    public async Task two_corrections_for_the_same_day_delivered_concurrently_leave_one_current()
    {
        // The lock is what turns this race into a queue. Without it both workers read "the current
        // version", both mark it superseded, both insert - and ux_idv_current catches the second
        // as a 23505, leaving that message stuck in PROCESSING with a unique-violation stack trace
        // where the operator expected a correction.
        var (brpId, ean, pointId) = await SeedAsync("SUP7", "12345647");

        await DeliverAsync(brpId, ean, "DOC-SUP7-BASE", CreatedEarly, 100m);

        var first = DeliverAsync(brpId, ean, "DOC-SUP7-X", CreatedLate, 110m);
        var second = DeliverAsync(brpId, ean, "DOC-SUP7-Y", CreatedLate, 120m);
        await Task.WhenAll(first, second);

        var versions = await VersionsAsync(pointId);

        versions.Count.ShouldBe(3);
        versions.Count(v => v.IsCurrent).ShouldBe(1);
    }
```

⚠ Like Task 8's race, run this one in a loop before trusting either outcome:

```bash
for i in $(seq 1 10); do
  dotnet test tests/PeakPower.Integration.Tests \
    --filter "FullyQualifiedName~two_corrections_for_the_same_day" --nologo | tail -3
done
```

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Ingestion/Processing/ProcessInboundMessageHandler.cs \
        tests/PeakPower.Integration.Tests/Ingestion/SupersessionTests.cs
git commit -m "feat(ingestion): supersede by RECEIPT order, never by CreatedDateTime

Design §4.2 and [F02-R17]: the current version is always the last one RECEIVED. Both receipt orders
of the same pair leave the second-received version current, and CreatedDateTime is a tiebreaker
between identical receipt times and nothing more.

MUTATION-VERIFIED as design §10.2 requires. Swapping the comparison to CreatedDateTime order fails
exactly two tests - the earlier-created-received-second case, and the both-orders case, where the
SAME document becomes current in both runs - while the ordinary correction stays green, because the
ordinary case agrees under both rules. That is why the both-orders test exists at all.

Design §1 calls this the unrecoverable one: a wrongly-ordered supersession is indistinguishable from
correct data afterwards. There is no later test that catches it.

[F02-R18]: Supersede() moves is_current and never deletes; mutation-verified with a Remove(), which
takes the superseded version and its ninety-six readings with it.

The supersede runs inside the advisory lock. That had no test until a mutation showed the sequential
suite could not see it; the concurrent-corrections test, run ten times, can.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: `[F02-R27]` — replaying an already-processed message produces no second version

Design §7.6, the last clause:

> Registering the metering point and replaying the stored message resolves the entry into readings,
> and **replaying an already-processed message produces no second version** (`[F02-R27]`), asserted
> by version count.

`[F02-R27]` itself: "Replay is idempotent and produces a new version only if the content differs
from the current one."

Plan 6 owns the HTTP endpoint. **This plan owns the behaviour**, because the endpoint is a route
over exactly this method and an idempotence rule implemented in a controller is not a pipeline rule.

⚠ **"Content differs" is decided against the CURRENT version's readings, not against the document
identity.** A BRP legitimately re-sends the same `DocumentIdentification` with corrected figures;
comparing document ids would drop the correction. Comparing the readings is the only comparison
that means what the requirement says.

⚠ **Replay must resolve a quarantine entry.** The whole point of quarantine is a replay path: an
unknown EAN quarantines, an employee registers the metering point through the existing back office,
the stored message is replayed, and the entry resolves into readings. That is a definition-of-done
item (design §7.6) and this task is where the resolution is written.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/Processing/ProcessInboundMessageHandler.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/ReplayIdempotenceTests.cs`

**Interfaces:**
- Consumes: `QuarantinedSeries.Resolve`, `PeakPowerDbContext.QuarantinedSeries` (plan 2).
- Produces: nothing new. `InboundMessageProcessingOutcome.QuarantineEntriesResolved` stops being 0.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/ReplayIdempotenceTests.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Processing;
using PeakPower.Ingestion.Receipt;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

/// <summary>[F02-R27] and design §7.6, asserted by version count.</summary>
public sealed class ReplayIdempotenceTests : IClassFixture<ReplayIdempotenceTests.FakeAdapterFactory>
{
    private static readonly DateOnly Day = new(2026, 8, 12);

    private static readonly DateTimeOffset Created =
        DateTimeOffset.Parse("2026-08-13T03:00:00Z", null);

    private readonly FakeAdapterFactory _factory;

    public ReplayIdempotenceTests(FakeAdapterFactory factory) => _factory = factory;

    public sealed class FakeAdapterFactory : WorkerFactory
    {
        public FakeAdapterFactory() => ExtraAdapters.Add(new FakeBrpIngestionAdapter("FAKE_REPLAY_V1"));
    }

    private async Task<Guid> SeedBrpAsync(string code)
    {
        await using var db = _factory.CreateOwnerDbContext();
        var brpId = await IngestionSeed.AddBrpAsync(db, code, ct: TestContext.Current.CancellationToken);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE metering.brp SET adapter_key = 'FAKE_REPLAY_V1' WHERE id = {brpId}",
            TestContext.Current.CancellationToken);
        return brpId;
    }

    private async Task<Guid> ReceiveAsync(Guid brpId, byte[] payload)
    {
        using var scope = _factory.Services.CreateScope();
        var receipt = await scope.ServiceProvider.GetRequiredService<IInboundMessageReceiver>()
            .ReceiveAsync(
                new InboundMessageArrival(brpId, Guid.CreateVersion7(), payload, null, "10.0.0.7"),
                TestContext.Current.CancellationToken);
        return receipt.InboundMessageId;
    }

    private async Task<InboundMessageProcessingOutcome> ProcessAsync(Guid messageId)
    {
        await using var db = _factory.CreateOwnerDbContext();
        var correlationId = await db.InboundMessages.AsNoTracking()
            .Where(m => m.Id == messageId).Select(m => m.CorrelationId)
            .SingleAsync(TestContext.Current.CancellationToken);

        using var scope = _factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<IInboundMessageProcessor>()
            .ProcessAsync(messageId, correlationId, TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task replaying_an_already_processed_message_produces_NO_second_version()
    {
        var brpId = await SeedBrpAsync("RPL1");
        string ean;
        Guid pointId;

        await using (var db = _factory.CreateOwnerDbContext())
        {
            var customerId = await IngestionSeed.AddCustomerAsync(
                db, "Replay B.V.", "12345650", TestContext.Current.CancellationToken);
            ean = IngestionSeed.NextEan();
            pointId = await IngestionSeed.AddMeteringPointAsync(
                db, customerId, brpId, ean, new DateOnly(2026, 1, 1),
                ct: TestContext.Current.CancellationToken);
        }

        var payload = new TestDocument("DOC-RPL1", Created)
            .WithFlatDay(ean, Day, IntervalDirection.Consumption, 100m)
            .ToBytes();

        var messageId = await ReceiveAsync(brpId, payload);
        var first = await ProcessAsync(messageId);
        first.VersionsCreated.ShouldBe(1);

        var replay = await ProcessAsync(messageId);

        replay.Status.ShouldBe(InboundMessageProcessingStatus.NoChange);
        replay.VersionsCreated.ShouldBe(0);

        // Asserted by VERSION COUNT, exactly as design §7.6 requires.
        await using var read = _factory.CreateOwnerDbContext();
        (await read.IntervalDataVersions.CountAsync(
            v => v.MeteringPointId == pointId, TestContext.Current.CancellationToken)).ShouldBe(1);
        (await read.IntervalReadings.CountAsync(
            r => r.DeliveryDate == Day, TestContext.Current.CancellationToken)).ShouldBe(96);
    }

    [Fact]
    public async Task a_replay_whose_content_DIFFERS_does_produce_a_new_version()
    {
        // [F02-R27]: "produces a new version only if the content differs from the current one".
        // The other half of the rule, and the reason the comparison is against readings rather
        // than against a document id - a BRP legitimately re-sends the same DocumentIdentification
        // with corrected figures.
        var brpId = await SeedBrpAsync("RPL2");
        string ean;
        Guid pointId;

        await using (var db = _factory.CreateOwnerDbContext())
        {
            var customerId = await IngestionSeed.AddCustomerAsync(
                db, "Replay Differs B.V.", "12345651", TestContext.Current.CancellationToken);
            ean = IngestionSeed.NextEan();
            pointId = await IngestionSeed.AddMeteringPointAsync(
                db, customerId, brpId, ean, new DateOnly(2026, 1, 1),
                ct: TestContext.Current.CancellationToken);
        }

        var firstMessage = await ReceiveAsync(
            brpId,
            new TestDocument("DOC-RPL2", Created)
                .WithFlatDay(ean, Day, IntervalDirection.Consumption, 100m).ToBytes());
        await ProcessAsync(firstMessage);

        // Same document id, different figures.
        var secondMessage = await ReceiveAsync(
            brpId,
            new TestDocument("DOC-RPL2", Created)
                .WithFlatDay(ean, Day, IntervalDirection.Consumption, 110m).ToBytes());
        var outcome = await ProcessAsync(secondMessage);

        outcome.Status.ShouldBe(InboundMessageProcessingStatus.Applied);
        outcome.VersionsCreated.ShouldBe(1);

        await using var read = _factory.CreateOwnerDbContext();
        var versions = await read.IntervalDataVersions.AsNoTracking()
            .Where(v => v.MeteringPointId == pointId)
            .ToListAsync(TestContext.Current.CancellationToken);

        versions.Count.ShouldBe(2);
        versions.Count(v => v.IsCurrent).ShouldBe(1);
    }

    [Fact]
    public async Task a_replay_after_the_metering_point_is_registered_resolves_the_quarantine_entry()
    {
        // Design §7.6, end to end: an unknown-EAN document quarantines, the EAN is registered
        // through the back office, the stored message is replayed from the log, and the entry
        // resolves into readings. This is the whole justification for quarantine existing rather
        // than the document simply failing.
        var brpId = await SeedBrpAsync("RPL3");
        var ean = IngestionSeed.NextEan();

        var payload = new TestDocument("DOC-RPL3", Created)
            .WithFlatDay(ean, Day, IntervalDirection.Consumption, 100m)
            .ToBytes();

        var messageId = await ReceiveAsync(brpId, payload);
        var first = await ProcessAsync(messageId);
        first.QuarantineEntriesCreated.ShouldBe(1);
        first.VersionsCreated.ShouldBe(0);

        // The employee registers the connection.
        Guid pointId;
        await using (var db = _factory.CreateOwnerDbContext())
        {
            var customerId = await IngestionSeed.AddCustomerAsync(
                db, "Registered Late B.V.", "12345652", TestContext.Current.CancellationToken);
            pointId = await IngestionSeed.AddMeteringPointAsync(
                db, customerId, brpId, ean, new DateOnly(2026, 1, 1),
                ct: TestContext.Current.CancellationToken);
        }

        var replay = await ProcessAsync(messageId);

        replay.Status.ShouldBe(InboundMessageProcessingStatus.Applied);
        replay.VersionsCreated.ShouldBe(1);
        replay.QuarantineEntriesResolved.ShouldBe(1);

        await using var read = _factory.CreateOwnerDbContext();
        var entry = await read.QuarantinedSeries.AsNoTracking()
            .SingleAsync(q => q.InboundMessageId == messageId, TestContext.Current.CancellationToken);

        entry.ResolvedAt.ShouldNotBeNull();
        entry.ResolvedByReplayOfMessageId.ShouldBe(messageId);
        entry.ResolvedBy.ShouldNotBeNullOrWhiteSpace();

        (await read.IntervalReadings.CountAsync(
            r => r.DeliveryDate == Day, TestContext.Current.CancellationToken)).ShouldBe(96);
        (await read.IntervalDataVersions.CountAsync(
            v => v.MeteringPointId == pointId, TestContext.Current.CancellationToken)).ShouldBe(1);
    }

    [Fact]
    public async Task replaying_twice_after_a_quarantine_resolution_still_leaves_one_version()
    {
        // The two rules composed. An operator who clicks Replay twice must not create a second
        // version, and a resolved quarantine entry must not be resolved again with a later
        // timestamp that misreports when it happened.
        var brpId = await SeedBrpAsync("RPL4");
        var ean = IngestionSeed.NextEan();

        var messageId = await ReceiveAsync(
            brpId,
            new TestDocument("DOC-RPL4", Created)
                .WithFlatDay(ean, Day, IntervalDirection.Consumption, 100m).ToBytes());
        await ProcessAsync(messageId);

        Guid pointId;
        await using (var db = _factory.CreateOwnerDbContext())
        {
            var customerId = await IngestionSeed.AddCustomerAsync(
                db, "Twice B.V.", "12345653", TestContext.Current.CancellationToken);
            pointId = await IngestionSeed.AddMeteringPointAsync(
                db, customerId, brpId, ean, new DateOnly(2026, 1, 1),
                ct: TestContext.Current.CancellationToken);
        }

        await ProcessAsync(messageId);
        var third = await ProcessAsync(messageId);

        third.Status.ShouldBe(InboundMessageProcessingStatus.NoChange);
        third.QuarantineEntriesResolved.ShouldBe(0);

        await using var read = _factory.CreateOwnerDbContext();
        (await read.IntervalDataVersions.CountAsync(
            v => v.MeteringPointId == pointId, TestContext.Current.CancellationToken)).ShouldBe(1);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ReplayIdempotenceTests"
```

Expected: FAIL — `replaying_an_already_processed_message_produces_NO_second_version` fails with
`replay.VersionsCreated should be 0 but was 1` and the version count `should be 1 but was 2`, and
`a_replay_after_the_metering_point_is_registered_resolves_the_quarantine_entry` fails with
`replay.QuarantineEntriesResolved should be 1 but was 0`.

- [ ] **Step 3: Skip a series whose content already matches the current version**

In `ProcessInboundMessageHandler.ApplyAsync`, immediately **after** the supersession lookup from
Task 15 (`var superseded = await db.IntervalDataVersions…SingleOrDefaultAsync(ct);`) and **before**
`superseded?.Supersede();`, insert:

```csharp
            // [F02-R27]: replay is idempotent and produces a new version only if the content
            // differs from the current one.
            //
            // ⚠ Compared against the CURRENT VERSION'S READINGS, not against the document
            // identity. A BRP legitimately re-sends the same DocumentIdentification with corrected
            // figures, and a document-id comparison would silently drop that correction - which is
            // a wrong invoice under [DEC-22], arrived at by an idempotence rule.
            if (superseded is not null
                && await MatchesCurrentAsync(superseded.Id, series, ct))
            {
                logger.LogInformation(
                    "Replay of {ResourceObject} on {DeliveryDate} ({Direction}) matches the current "
                    + "version; no new version created.",
                    series.ResourceObject, series.DeliveryDate, series.Direction);
                continue;
            }
```

and add this private method to the class, beside `ApplyAsync`:

```csharp
    /// <summary>
    /// Whether the current version's readings are point-for-point identical to the series.
    /// </summary>
    /// <remarks>
    /// Ordered by position and compared pairwise on <c>Pos</c> and <c>QuantityKwh</c>. The
    /// quantities are <c>numeric(14,3)</c> on the way in, so <c>decimal</c> equality is exact here
    /// and this is not a floating-point comparison wearing a decimal's clothes.
    /// </remarks>
    private async Task<bool> MatchesCurrentAsync(
        Guid versionId, CanonicalSeries series, CancellationToken ct)
    {
        var stored = await db.IntervalReadings.AsNoTracking()
            .Where(reading => reading.VersionId == versionId)
            .OrderBy(reading => reading.Pos)
            .Select(reading => new { reading.Pos, reading.QuantityKwh })
            .ToListAsync(ct);

        if (stored.Count != series.Points.Count)
        {
            return false;
        }

        var incoming = series.Points.OrderBy(point => point.Pos).ToList();

        for (var index = 0; index < stored.Count; index++)
        {
            if (stored[index].Pos != incoming[index].Pos
                || stored[index].QuantityKwh != incoming[index].QuantityKwh)
            {
                return false;
            }
        }

        return true;
    }
```

- [ ] **Step 4: Resolve the quarantine entry on a successful replay**

In the same method, immediately **after** `db.IntervalDataVersions.Add(version.Value);` and the
`versionsCreated++;` that follows it, insert:

```csharp
            // Design §7.6: registering the metering point and replaying the stored message
            // resolves the entry into readings. Without this the entry sits open on the employee
            // data-health screen for ever, and the operator has no way to tell a resolved gap from
            // an unresolved one.
            var openEntries = await db.QuarantinedSeries
                .Where(entry =>
                    entry.InboundMessageId == message.Id
                    && entry.ResourceObject == series.ResourceObject
                    && entry.DeliveryDate == series.DeliveryDate
                    && entry.Direction == series.Direction
                    && entry.ResolvedAt == null)
                .ToListAsync(ct);

            foreach (var entry in openEntries)
            {
                entry.Resolve(calendar.UtcNow, "system:replay", message.Id);
                quarantineEntriesResolved++;
            }
```

and add the counter beside the others:

```csharp
        var quarantineEntriesResolved = 0;
```

and put it into the returned outcome:

```csharp
        return new InboundMessageProcessingOutcome(
            versionsCreated > 0
                ? InboundMessageProcessingStatus.Applied
                : InboundMessageProcessingStatus.NoChange,
            versionsCreated, quarantineEntriesCreated, quarantineEntriesResolved,
            labelledSeriesSkipped, null, null);
```

- [ ] **Step 5: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ReplayIdempotenceTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Ingestion"
```

Expected: PASS — 4 tests, then the whole ingestion suite, 0 failed.

- [ ] **Step 6: Verify by mutation — the comparison is on content, not on document identity**

**What to break:** replace the `MatchesCurrentAsync` call with
`superseded.DocumentId == document.DocumentId`.

**What to predict:** `a_replay_whose_content_DIFFERS_does_produce_a_new_version` fails with
`outcome.Status should be Applied but was NoChange` and `versions.Count should be 2 but was 1`.
`replaying_an_already_processed_message_produces_NO_second_version` stays **green**.

**What to watch go red:** that one test. This is the asymmetry that matters: a document-id
comparison satisfies the idempotence half of `[F02-R27]` perfectly and silently drops a correction
that arrives under the same `DocumentIdentification` — a wrong invoice reached by way of an
idempotence rule.

Restore.

- [ ] **Step 7: Verify by mutation — the quarantine resolution is scoped to the right entry**

**What to break:** in the resolution query, drop the `entry.ResourceObject == series.ResourceObject`
predicate.

**What to predict:** nothing fails, because no test has two quarantine entries on one message.

**What to do about it:** that is a hole. Add this test, watch it fail against the mutation, restore,
and watch it pass:

```csharp
    [Fact]
    public async Task a_replay_resolves_only_the_entry_whose_ean_was_registered()
    {
        // One document, two unknown EANs; only one is registered before the replay. Resolving both
        // would close a gap that is still open, and the employee screen would show a metering point
        // as healthy while nothing has ever landed for it.
        var brpId = await SeedBrpAsync("RPL5");
        var registered = IngestionSeed.NextEan();
        var stillUnknown = IngestionSeed.NextEan();

        var messageId = await ReceiveAsync(
            brpId,
            new TestDocument("DOC-RPL5", Created)
                .WithFlatDay(registered, Day, IntervalDirection.Consumption, 100m)
                .WithFlatDay(stillUnknown, Day, IntervalDirection.Consumption, 200m)
                .ToBytes());

        var first = await ProcessAsync(messageId);
        first.QuarantineEntriesCreated.ShouldBe(2);

        await using (var db = _factory.CreateOwnerDbContext())
        {
            var customerId = await IngestionSeed.AddCustomerAsync(
                db, "Half Registered B.V.", "12345654", TestContext.Current.CancellationToken);
            await IngestionSeed.AddMeteringPointAsync(
                db, customerId, brpId, registered, new DateOnly(2026, 1, 1),
                ct: TestContext.Current.CancellationToken);
        }

        var replay = await ProcessAsync(messageId);
        replay.QuarantineEntriesResolved.ShouldBe(1);

        await using var read = _factory.CreateOwnerDbContext();
        var entries = await read.QuarantinedSeries.AsNoTracking()
            .Where(q => q.InboundMessageId == messageId)
            .ToListAsync(TestContext.Current.CancellationToken);

        entries.Single(q => q.ResourceObject == registered).ResolvedAt.ShouldNotBeNull();
        entries.Single(q => q.ResourceObject == stillUnknown).ResolvedAt.ShouldBeNull();
    }
```

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Ingestion/Processing/ProcessInboundMessageHandler.cs \
        tests/PeakPower.Integration.Tests/Ingestion/ReplayIdempotenceTests.cs
git commit -m "feat(ingestion): make replay idempotent, and resolve the quarantine entry it clears

[F02-R27] and design §7.6, asserted by version count. Replaying an already-processed message
produces no second version; a replay whose content differs does.

The comparison is against the CURRENT VERSION'S READINGS, not against the document identity.
Mutation-verified: a DocumentId comparison satisfies the idempotence half perfectly and fails only
the differing-content test - and what it silently drops is a correction the BRP re-sent under the
same DocumentIdentification, which under [DEC-22] is a wrong invoice reached by way of an
idempotence rule.

Registering the metering point and replaying resolves the quarantine entry into readings, which is
the whole justification for quarantine existing rather than the document simply failing. The
resolution is scoped to the entry whose EAN was registered - that had no test until a mutation
showed dropping the ResourceObject predicate changed nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: One composition-root entry point, and the whole-suite verification

Every registration this plan needs, behind one call — the shape
`PersistenceServiceCollectionExtensions.AddPeakPowerPersistence`
(`src/Infrastructure/PeakPower.Persistence/PersistenceServiceCollectionExtensions.cs:14`) and
`EmailServiceCollectionExtensions.AddPeakPowerEmail` already establish here. A second host that ever
needs the pipeline asks for it the same way and cannot get half of it.

This task also closes the plan: it deletes the TEMPORARY block Task 6 introduced, proves every port
resolves, mutation-verifies architecture fact 3, and runs everything.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/IngestionServiceCollectionExtensions.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Program.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/IngestionWiringTests.cs`

**Interfaces:**
- Consumes: everything this plan built.
- Produces: `IngestionServiceCollectionExtensions.AddPeakPowerIngestion(IServiceCollection, IConfiguration)`.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Ingestion/IngestionWiringTests.cs`:

```csharp
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Metering;
using PeakPower.Ingestion.Adapters;
using PeakPower.Ingestion.Processing;
using PeakPower.Ingestion.Receipt;
using PeakPower.Ingestion.Storage;
using PeakPower.Ingestion.Webhook;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Ingestion;

/// <summary>
/// Every port this plan declares resolves from the Worker's own container, from one scope.
/// </summary>
/// <remarks>
/// A missing registration is a runtime failure on the first document rather than a build error, and
/// the first document is the one that arrives at 04:00 from a BRP. This is the cheapest place to
/// find it.
/// </remarks>
public sealed class IngestionWiringTests(WorkerFactory factory) : IClassFixture<WorkerFactory>
{
    [Fact]
    public void every_ingestion_port_resolves_from_one_scope()
    {
        using var scope = factory.Services.CreateScope();
        var services = scope.ServiceProvider;

        services.GetRequiredService<IRawPayloadStore>().ShouldBeOfType<FilesystemRawPayloadStore>();
        services.GetRequiredService<IBrpIngestionAdapterRegistry>()
            .ShouldBeOfType<BrpIngestionAdapterRegistry>();
        services.GetRequiredService<IBrpWebhookAuthenticator>()
            .ShouldBeOfType<BrpWebhookAuthenticator>();
        services.GetRequiredService<IInboundMessageReceiver>()
            .ShouldBeOfType<InboundMessageReceiver>();
        services.GetRequiredService<ISeriesResolver>().ShouldBeOfType<DbSeriesResolver>();
        // Both plan-5 seams resolve to this plan's stand-in only because plan 5 has not landed:
        // both are registered with TryAdd, and the test below is what pins that.
        services.GetRequiredService<IOperationalAlertRaiser>().ShouldBeOfType<DbOperationalAlertRaiser>();
        services.GetRequiredService<IDayStateRecomputer>().ShouldNotBeNull();
        services.GetRequiredService<IInboundMessageProcessor>()
            .ShouldBeOfType<ProcessInboundMessageHandler>();
        services.GetRequiredService<IProcessInboundMessageHandler>()
            .ShouldBeOfType<ProcessInboundMessageHandler>();
    }

    [Fact]
    public void the_processor_and_the_queue_handler_are_the_SAME_object_in_one_scope()
    {
        // Two registrations, one instance. Two instances would mean two DbContext change trackers
        // inside what the apply transaction believes is one unit of work.
        using var scope = factory.Services.CreateScope();

        scope.ServiceProvider.GetRequiredService<IInboundMessageProcessor>()
            .ShouldBeSameAs(scope.ServiceProvider.GetRequiredService<IProcessInboundMessageHandler>());
    }

    [Fact]
    public void the_rejecting_adapter_is_registered_under_the_PVNED_adapter_key()
    {
        // Until plan 4 lands, this is the only adapter a PVNED BRP row can resolve to. It must be
        // registered under the key migration 9 seeds, or every PVNED document fails with
        // AdapterNotRegisteredException instead of ADAPTER_NOT_IMPLEMENTED.
        using var scope = factory.Services.CreateScope();
        var registry = scope.ServiceProvider.GetRequiredService<IBrpIngestionAdapterRegistry>();

        var adapter = registry.Resolve("PVNED_TIMESERIES_XML_V2P0");

        adapter.AdapterKey.ShouldBe("PVNED_TIMESERIES_XML_V2P0");
    }

    [Fact]
    public void BOTH_plan_5_seams_are_registered_with_TryAdd_so_plan_5_can_replace_them()
    {
        // A plain AddScoped on either would mean plan 5's registration and this one both live,
        // with the last one registered winning by accident of file order. TryAdd makes this plan's
        // stand-ins explicitly the fallback. It matters twice over for the alert raiser: plan 5's
        // implementation dedupes by (kind, metering point, delivery date) and carries
        // ResolveOpenAsync, and two live implementations of one table is precisely what
        // IOperationalAlertRaiser's own doc comment forbids.
        var services = new ServiceCollection();
        services.AddSingleton<Microsoft.Extensions.Logging.ILoggerFactory>(
            Microsoft.Extensions.Logging.Abstractions.NullLoggerFactory.Instance);
        services.AddLogging();
        services.AddScoped<IDayStateRecomputer, PlanFiveRecomputer>();
        services.AddScoped<IOperationalAlertRaiser, PlanFiveAlertRaiser>();
        IngestionServiceCollectionExtensions.AddPeakPowerIngestion(
            services, new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build());

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        scope.ServiceProvider.GetRequiredService<IDayStateRecomputer>()
            .ShouldBeOfType<PlanFiveRecomputer>();
        scope.ServiceProvider.GetRequiredService<IOperationalAlertRaiser>()
            .ShouldBeOfType<PlanFiveAlertRaiser>();
    }

    private sealed class PlanFiveRecomputer : IDayStateRecomputer
    {
        public Task<DayRecomputeResult> RecomputeAsync(
            DayRecomputeRequest request, CancellationToken ct) =>
            Task.FromResult(new DayRecomputeResult(
                MeteringDayState.NoData, 96, false, false, false, false, false,
                0m, 0m, 0m, 0m, 0m));
    }

    private sealed class PlanFiveAlertRaiser : IOperationalAlertRaiser
    {
        public Task<bool> RaiseAsync(OperationalAlertRequest request, CancellationToken ct) =>
            Task.FromResult(true);

        public Task<int> ResolveOpenAsync(
            OperationalAlertKind kind,
            Guid meteringPointId,
            DateOnly? deliveryDate,
            DateTimeOffset resolvedAt,
            CancellationToken ct) =>
            Task.FromResult(0);
    }
}
```

⚠ The test file needs `using PeakPower.Domain.Metering;` for `MeteringDayState` and
`OperationalAlertKind`.

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~IngestionWiringTests"
```

Expected: FAIL — build error
`error CS0103: The name 'IngestionServiceCollectionExtensions' does not exist in the current context`.

- [ ] **Step 3: Write the extension**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/IngestionServiceCollectionExtensions.cs`:

```csharp
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Ingestion.Adapters;
using PeakPower.Ingestion.Processing;
using PeakPower.Ingestion.Receipt;
using PeakPower.Ingestion.Storage;
using PeakPower.Ingestion.Webhook;

namespace PeakPower.Ingestion;

/// <summary>
/// The single composition-root entry point for the BRP-agnostic ingestion pipeline.
/// </summary>
/// <remarks>
/// The same shape <c>AddPeakPowerPersistence</c> and <c>AddPeakPowerEmail</c> already establish
/// here: a host references infrastructure only to call this, and nothing else in a host touches
/// the pipeline's own wiring. A second host that ever needs the pipeline asks the same way and
/// cannot get half of it.
/// <para>
/// ⚠ It registers <b>no</b> BRP adapter beyond <see cref="RejectingBrpIngestionAdapter"/>. Adapters
/// are composed by the host — <c>PeakPower.Worker</c> and <c>PeakPower.Api.Employee</c> are the
/// only projects that see both <c>PeakPower.Ingestion</c> and
/// <c>PeakPower.Integration.Brp.Pvned</c>, and architecture fact 3 forbids this assembly from
/// referencing the second at all. The employee host needs both because plan 6's replay endpoint
/// (contract §10.4) answers with <c>versionsCreated</c> and <c>quarantineEntriesResolved</c> —
/// counts only a synchronous parse-and-apply can produce, and an enqueue never can.
/// </para>
/// </remarks>
public static class IngestionServiceCollectionExtensions
{
    public static IServiceCollection AddPeakPowerIngestion(
        this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        // Read through IConfiguration rather than Environment.GetEnvironmentVariable. The
        // configuration builder already reads process environment variables, so RAW_PAYLOAD_ROOT
        // set in the container arrives either way - and a test host can set it through
        // UseSetting, which the environment API cannot see.
        services.AddSingleton(new RawPayloadStoreOptions
        {
            Root = configuration[RawPayloadStoreOptions.RootEnvironmentVariable]
                   ?? RawPayloadStoreOptions.DefaultRoot,
        });

        services.AddScoped<IRawPayloadStore, FilesystemRawPayloadStore>();

        // The null adapter, under the key migration 9 seeds on the PVNED row. Plan 4 adds the real
        // one from the Worker; until then a PVNED document fails with ADAPTER_NOT_IMPLEMENTED and
        // a stored payload that can be replayed, rather than with an unhandled
        // AdapterNotRegisteredException on the job thread.
        services.AddSingleton<IBrpIngestionAdapter>(
            new RejectingBrpIngestionAdapter("PVNED_TIMESERIES_XML_V2P0"));

        services.AddScoped<IBrpIngestionAdapterRegistry, BrpIngestionAdapterRegistry>();

        services.AddScoped<IBrpCredentialSource, EnvironmentBrpCredentialSource>();
        services.AddScoped<IBrpWebhookAuthenticator, BrpWebhookAuthenticator>();

        services.AddScoped<IInboundMessageReceiver, InboundMessageReceiver>();

        services.AddScoped<ISeriesResolver, DbSeriesResolver>();

        // TryAdd on BOTH plan-5 seams (contract §7.6), so plan 5's real implementations win
        // regardless of registration order. A plain AddScoped on either would leave both live and
        // let file order decide - and for the alert raiser that means letting file order decide
        // which of two implementations writes metering.operational_alert, with only one of them
        // deduping by (kind, metering point, delivery date).
        services.TryAddScoped<IOperationalAlertRaiser, DbOperationalAlertRaiser>();
        services.TryAddScoped<IDayStateRecomputer, NoOpDayStateRecomputer>();

        // One concrete instance per scope, reachable through both interfaces. Registering the
        // class twice would give one scope two handlers and two change trackers inside what the
        // apply transaction believes is one unit of work.
        services.AddScoped<ProcessInboundMessageHandler>();
        services.AddScoped<IInboundMessageProcessor>(
            provider => provider.GetRequiredService<ProcessInboundMessageHandler>());
        services.AddScoped<IProcessInboundMessageHandler>(
            provider => provider.GetRequiredService<ProcessInboundMessageHandler>());

        return services;
    }
}
```

⚠ **`IIngestionJobQueue` is deliberately NOT registered here.** Plan 1 owns its implementation —
Hangfire or the `metering.ingestion_job` claim queue — and registering a second one would either
collide with plan 1's or silently win over it. The Worker's `Program.cs` gets it from plan 1's own
extension.

- [ ] **Step 4: Replace the TEMPORARY block in the Worker**

In `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Worker/Program.cs`, delete
the entire block introduced in Task 6 Step 8 and extended in Tasks 10 and 13 — every line from the
comment `// TEMPORARY, replaced by AddPeakPowerIngestion in Task 17.` down to and including the last
`builder.Services.Add…` line of that block — leaving only:

```csharp
builder.Services.AddPeakPowerIngestion(builder.Configuration);
```

Then confirm nothing else references the deleted registrations:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -n 'TEMPORARY' src/Hosts/PeakPower.Worker/Program.cs > /tmp/worker-temporary.txt
wc -l /tmp/worker-temporary.txt
```

Expected: `0 /tmp/worker-temporary.txt`. ⚠ Read the file back rather than trusting the grep's own
output — a shell hook in this environment truncates and occasionally fabricates grep results.

- [ ] **Step 5: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~IngestionWiringTests"
```

Expected: build with 0 warnings and 0 errors; 4 tests pass.

- [ ] **Step 6: Verify by mutation — the two handler interfaces are one object**

**What to break:** replace the two factory registrations with

```csharp
        services.AddScoped<IInboundMessageProcessor, ProcessInboundMessageHandler>();
        services.AddScoped<IProcessInboundMessageHandler, ProcessInboundMessageHandler>();
```

**What to predict:** `the_processor_and_the_queue_handler_are_the_SAME_object_in_one_scope` fails
with `should be same as ProcessInboundMessageHandler but was ProcessInboundMessageHandler` — two
instances of the same type, which is exactly the confusing message the bug produces in production.

**What to watch go red:** that one. Everything else stays green, and that is the danger: two
handlers in one scope means two `DbContext` change trackers inside one apply transaction, and the
symptom is a version that is tracked but never saved.

Restore.

- [ ] **Step 7: ⚠ Mutation-verify architecture fact 3**

Design §7.22 requires it and contract §15.2 lists it among the three that must be verified in
passing. Plan 1 arms the fact; this plan is the first that could break it, so this is where the
mutation belongs.

**What to break:** add to
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj`:

```xml
    <ProjectReference Include="../PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj" />
```

then add a line to any file in `PeakPower.Ingestion` that actually *uses* a type from that assembly,
so the C# compiler does not elide the reference from the IL metadata — an unused reference is
structurally invisible to a reflection-based fact, which is the whole reason
`tools/verify-solution-layout.sh` also greps the `.csproj` files.

**What to predict:**

```
dotnet test tests/PeakPower.Architecture.Tests --filter "FullyQualifiedName~Fact_3"
```

fails with *"PeakPower.Ingestion must talk to BRP adapters through a port, never by referencing
one"*.

**What to watch go red:** `CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter`, and it must be
a **failure**, not a **skip**. A skip means plan 1 did not arm it and the fact has still never run.

⚠ If `PeakPower.Integration.Brp.Pvned` does not exist yet (plan 4 has not run), this mutation cannot
be performed. Record that in the commit body as **deferred to plan 4** rather than claiming the fact
was verified — an unverified fact recorded as verified is worse than one recorded as pending,
because it stops anybody looking again.

Restore both the `<ProjectReference>` and the using.

- [ ] **Step 8: Run everything**

Run, in this order, and read each result:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln
tools/verify-solution-layout.sh
tools/verify-build-settings.sh
tools/verify-repositories.sh
tools/verify-aspire-api.sh
tools/verify-migrator.sh
```

Expected: build with 0 warnings; the whole solution's tests pass; all five guards print OK.

⚠ **`dotnet test PeakPower.sln` runs `AppHost.Tests` too, and that suite needs `peakpower-web`
checked out beside the platform** or it silently skips 29 assertions. Plan 1's CI job asserts zero
skips; locally, confirm the checkout is there before trusting a green run:

```bash
ls -d /Users/thinhhuynh/PeakPower/peakpower-web
```

⚠ **Testcontainers.** Several suites in this plan each start their own PostgreSQL 17 container
(`WorkerFactory` and its four subclasses, plus the shared `PostgresFixture`). Running them in
parallel across worktrees can exhaust connections and produce mass timeouts — retry once before
reporting a regression.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Ingestion/IngestionServiceCollectionExtensions.cs \
        src/Hosts/PeakPower.Worker/Program.cs \
        tests/PeakPower.Integration.Tests/Ingestion/IngestionWiringTests.cs
git commit -m "feat(ingestion): one composition-root entry point, AddPeakPowerIngestion

The shape AddPeakPowerPersistence and AddPeakPowerEmail already establish: a host references
infrastructure only to call this. Replaces the temporary block Program.cs carried while the pipeline
was built task by task.

ProcessInboundMessageHandler is registered once and reached through both interfaces by factory.
Mutation-verified: two type registrations give one scope two handlers and two DbContext change
trackers inside what the apply transaction believes is one unit of work, and the symptom is a
version that is tracked and never saved.

IDayStateRecomputer and IOperationalAlertRaiser both use TryAdd so plan 5's real implementations
win regardless of registration order - contract §7.6 gives plan 5 both, and for the alert raiser a
plain AddScoped would let file order decide which of two implementations writes
metering.operational_alert. IIngestionJobQueue is deliberately NOT registered here - plan 1 owns its
implementation, and a second registration would either collide with plan 1's or silently win over
it.

No BRP adapter beyond the rejecting one: adapters are composed by the host. PeakPower.Worker and
PeakPower.Api.Employee are the only projects that see both this assembly and
PeakPower.Integration.Brp.Pvned - the employee host because plan 6's replay endpoint reports
versionsCreated and quarantineEntriesResolved, which only a synchronous apply can produce.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done for this plan

Every item is a design §7 clause, and each names the test that proves it.

| # | Design §7 | Proven by |
| --: | --- | --- |
| 1 | §7.2 — a generated document posted with the BRP row's configured credential returns 200, and at the moment that 200 is written the payload is durably stored with headers, source IP, receipt time, correlation id and `brp_id`, and `status` is `RECEIVED` — not `PROCESSED` | `WebhookReceiptTests.the_message_is_RECEIVED_and_not_PROCESSED_at_the_moment_the_200_is_written`, `.stores_the_headers_the_source_ip_and_the_receiving_brp` |
| 2 | §7.3 — re-posting the byte-identical payload within 24 h records `DUPLICATE` and creates no second version | `WebhookDedupeTests.a_byte_identical_redelivery_answers_200_and_lands_DUPLICATE`, `.the_redelivery_is_enqueued_zero_times` |
| 3 | §7.3 — a document **over** 25 MB is refused with 413; one of exactly 25 MB is accepted | `WebhookSizeLimitTests.a_payload_of_exactly_the_limit_is_accepted`, `.a_payload_one_byte_over_the_limit_is_413` |
| 4 | §7.3 — a parser failure still returns 200 and lands the message `FAILED` with a machine-readable code and a human-readable message, **zero** interval rows written | `WebhookReceiptTests.answers_200_with_an_empty_body_for_arbitrary_bytes` + `ProcessingOutcomeTests.a_rejected_document_lands_FAILED_with_a_code_and_zero_readings` |
| 5 | §7.4 — a document whose second timeseries is one point short applies **nothing at all**, asserted by row count | `ApplyAtomicityTests.a_document_whose_second_series_is_one_point_short_applies_nothing_at_all` |
| 6 | §7.5 — receipt order governs; both receipt orders of the same pair leave the second-received version current; the superseded version remains queryable; `ux_idv_current` holds exactly one current version | `SupersessionTests`, all seven tests |
| 7 | §7.6 — the four quarantine reasons, `WRONG_BRP` decided at receipt time | `QuarantineTests`, all seven tests |
| 8 | §7.6 — registering the metering point and replaying resolves the entry into readings, and replaying an already-processed message produces no second version, asserted by version count | `ReplayIdempotenceTests`, all five tests |
| 9 | §7.7 — a message whose BRP row is set inactive still replays through the adapter selected by the stored `brp_id`, asserted with a second adapter registered | `AdapterResolutionTests`, all five tests |
| 10 | §7.13 — an A12-shaped document is recognised, stored, closed with **zero** `interval_reading` rows, and lands in its terminal status | `ProcessingOutcomeTests.a_recognised_and_closed_document_reaches_PROCESSED_with_zero_readings` |
| 11 | §4.3 — a route-table test asserts the Worker host exposes no `/api/v1/**` route | `WorkerRouteTableTests.the_worker_exposes_no_api_v1_route_at_all` |
| 12 | §7.22 — `CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter` passes, verified by adding a `PeakPower.Integration.Brp.*` reference and watching it go red | Task 17 Step 7 (**or recorded as deferred to plan 4** if that project does not exist yet) |

### The mutations this plan must have run, and what each proved

| Task | Mutation | What went red |
| --- | --- | --- |
| 1 | Rename `ResourceObjectIsEan`; change `Ean` from `EanCode?` to `EanCode` | The port-shape test, on the property and on nullability |
| 2 | `Resolve` returns `_byKey.Values.First()` | Two of six registry tests; the case-sensitivity test too |
| 3 | Store the absolute path in `payload_uri`; `StartsWith(root)` instead of root + separator | The string assertion (not the round trip); a **new** sibling-directory test the mutation showed was missing |
| 4 | An unset credential means "no credential required" | Both fail-closed tests — the mutation a deployed stack would ship with an unset variable |
| 5 | Seven-day dedupe window; drop the `brp_id` predicate; enqueue inside the transaction | The 24 h + 1 s test; the two-BRP test; a **new** visibility test |
| 7 | `>=` at the size boundary; drop the streamed-body check | The two at-the-cap tests; the chunked test alone |
| 8 | Delete the receipt advisory lock | The concurrent-redelivery test, **in a ten-run loop** |
| 10 | `calendar.UtcNow` for the version's `ReceivedAt`; add a version inside the reject path; `List` instead of `HashSet` for touched days | The receipt-time test; the row-count assertion (**not** the status one); the recompute test |
| 12 | Move the precondition check inside the series loop; `<` instead of `!=` | The row-count assertions; the over-length test alone |
| 13 | Collapse `UNKNOWN_EAN` into `EAN_VALIDITY`; read the current `brp_id` instead of the assignment history; delete the label skip | The unknown-EAN test; the **reassignment** test only; the resolver's own guard message |
| 14 | `pg_advisory_lock` instead of `pg_advisory_xact_lock`; drop the ordering | The rollback test, as a **hang**; the ordering test alone |
| **15** | **Swap the supersession comparison to `CreatedDateTime` order** — design §10.2 requires this one explicitly | The earlier-created-received-second test and the both-orders test; the ordinary correction stays green |
| 15 | `Remove()` instead of `Supersede()`; move the lock after the writing loop | The superseded-still-queryable test; a **new** concurrent-corrections test, in a ten-run loop |
| 16 | Compare `DocumentId` instead of readings; drop the `ResourceObject` predicate from the resolution | The differing-content test alone; a **new** two-entry test |
| 17 | Two type registrations for the handler; add a `Brp.*` project reference to `PeakPower.Ingestion` | The same-object test; `Fact_3_ingestion_references_no_Brp_adapter` |

---

## What this plan hands to the plans after it

**Plan 4 (`PeakPower.Integration.Brp.Pvned`)** implements `IBrpIngestionAdapter` and registers it
from a **host's** `Program.cs`, beside `AddPeakPowerIngestion` — the Worker's, and also
`PeakPower.Api.Employee`'s, because plan 6's replay endpoint applies a stored document in-process
and needs the same adapter to parse it. Never from `PeakPower.Ingestion`, which architecture fact 3
forbids from seeing it. Its `AdapterKey` must be
exactly `PVNED_TIMESERIES_XML_V2P0`, the value migration 9 seeds on the `PVNED` row, and adding it
replaces the `RejectingBrpIngestionAdapter` registration for that key in
`IngestionServiceCollectionExtensions` — which will otherwise throw
`Two BRP ingestion adapters declare the adapter key 'PVNED_TIMESERIES_XML_V2P0'` at boot. **That
boot failure is the intended behaviour**; the fix is one deleted line in the extension, guarded by a
comment there.

**Plan 5 (rollup and DevStubs)** registers its own `IDayStateRecomputer` — `TryAdd` here means
its registration wins with no edit to this plan's code — and raises its four alert kinds through
`IOperationalAlertRaiser`. Its DevStubs push over `POST /webhooks/brp/PVNED` with the
`X-PeakPower-Brp-Credential` header, against the size boundary constants
`BrpWebhookEndpoints.MaximumPayloadBytes` (accepted) and that value plus one (refused).

**Plan 6 (read surfaces)** uses `IInboundMessageProcessor.ProcessAsync` for the replay endpoint and
maps `InboundMessageProcessingStatus` to the frozen `REPLAYED | NO_CHANGE | FAILED` — `Applied` →
`REPLAYED`, `NoChange` and `RecognisedAndClosed` → `NO_CHANGE`, `Failed` → `FAILED` — and reports
`VersionsCreated` as `versionsCreated` and `QuarantineEntriesResolved` as
`quarantineEntriesResolved`.

**Plan 8 (close-out)** runs DevStubs against the deployed webhook. The environment variable it needs
on the VM is `BRP_CREDENTIAL_PVNED`, read at request time by `EnvironmentBrpCredentialSource`, and
`RAW_PAYLOAD_ROOT` must point at the named volume plan 1 registered in the AppHost.

---

## Open issues this plan had to decide, and who should overturn them

| # | Item | What was decided, and why | Who should confirm |
| --: | --- | --- | --- |
| 1 | Contract §5 gives properties for all eight entities but factory methods for only two | This plan calls `IntervalReading.Create`, `QuarantinedSeries.Quarantine`, `QuarantinedSeries.Resolve` and `OperationalAlert.Raise` with the signatures listed under **The plan-2 members this plan calls by name**. Plan 2 must supply exactly those, or this plan's call sites move | **Plan 2**, before plan 3 starts |
| 2 | Contract §5 names no `DbSet<>` properties for the new entities | This plan reads `InboundMessages`, `IntervalDataVersions`, `IntervalReadings`, `QuarantinedSeries`, `OperationalAlerts` and `MeteringPointBrpAssignments` on `PeakPowerDbContext` | **Plan 2**, same commit |
| 3 | ~~`IDerivedDataRecomputer` and `MeteringPointDay` are not in the contract~~ **CLOSED** | The contract now pins both in **§7.6**, and it settles the collision against this plan's draft: the port is `IDayStateRecomputer` and `RecomputeAsync` takes one `DayRecomputeRequest` per pair, because only a per-pair request carries `NewVersionReceivedAt` — the `[DEC-98]` reopen switch. `MeteringPointDay` survives unchanged and stays in the same file, because `AdvisoryLock.KeyFor` takes one | Closed by contract §7.6. Plan 5 implements |
| 4 | ~~`IOperationalAlertSink` is not in the contract~~ **CLOSED** | The contract now pins `IOperationalAlertRaiser` in **§7.6**, with a `bool` dedupe return and `ResolveOpenAsync` that `[F02-R26]`'s resolution path needs. Plan 3 declares it and registers a stand-in with `TryAdd`; plan 5's deduping implementation wins | Closed by contract §7.6. Plan 5 implements |
| 5 | `IInboundMessageProcessor` and `InboundMessageProcessingOutcome` are not in the contract | Contract §7.4 freezes `IProcessInboundMessageHandler.HandleAsync` as returning `Task`, which is right for a queue and useless for plan 6's replay response. One class implements both | **Plan 6**; add to the contract |
| 6 | `IBrpCredentialSource` is not in the contract | Contract §9.3 pins the mechanism (`Environment.GetEnvironmentVariable(brp.CredentialRef)`) and `EnvironmentBrpCredentialSource` is that call and nothing else. The port exists so a test can substitute without mutating process-wide state every other test in the assembly shares | Low risk; nobody else names it |
| 7 | `ISeriesResolver` / `DbSeriesResolver` are not in the contract | Internal to `PeakPower.Ingestion`; contract §8.5 fixes the four reasons and their conditions, which is what crosses a plan boundary | Low risk |
| 8 | A `ResourceObject` that is not an EAN is **skipped and counted**, not quarantined | Design §3.1 says such a series is "never offered to the EAN resolver", and none of contract §8.5's four reasons is true of it. Inventing a fifth would put a routine document on the operator's worklist with nothing to do about it. Reported as `InboundMessageProcessingOutcome.LabelledSeriesSkipped` | **Worth confirming.** If a fifth reason is wanted, it changes a database `CHECK` and is therefore plan 2's |
| 9 | The pipeline re-checks `INCOMPLETE_PERIOD`, `INVALID_POSITIONS` and `NEGATIVE_QUANTITY` after the adapter | `[F02-R40]` forbids an **adapter** reimplementing a pipeline stage; this runs the other way. Without it a wrong adapter produces a Postgres `23514` mid-transaction with the message stuck in `PROCESSING`. Same code strings, so the employee screen shows one vocabulary | Low risk |
| 10 | The receipt path takes an advisory lock on `(brp_id, payload_hash)` | Contract §9.6 names a lock only on the apply path. Without one here, two simultaneous byte-identical redeliveries both land `RECEIVED` and the document is applied twice — creating a second version out of a redelivery | Low risk |
| 11 | Quarantine is **not** subject to `[F02-R13]`'s all-or-nothing | A good series beside a quarantined one still lands. Treating quarantine as a document-level failure would let one unregistered EAN block a whole day for every other customer named in the same document | **Worth confirming.** `[F02-R13]` is about a document being *applied*; a quarantined series was never applied |
| 12 | `payload_uri` is root-relative | Contract §7.3 says `file://{relative path}` and this plan holds to it. The absolute root is a deployment fact, and a stored absolute path makes every row written on one machine unreadable on another | Low risk; it is the contract's own wording |

---

## What this plan does not prove

Written here for the same reason design §9 exists: the honest counterweight.

- **Nothing about the PVNed format.** Every apply test in this plan runs through
  `FakeBrpIngestionAdapter`, a test double over a format nobody will ship. That is deliberate —
  design §9 says what is genuinely proven is the BRP-agnostic half — but it means a green suite here
  says nothing about whether a real `TimeSeriesDocument` parses. Plan 4 is where that is answered,
  and design §8's first risk row says even then the evidence is limited by generator and parser
  sharing an author.
- **Nothing about DST.** This plan calls `IMarketCalendar.IntervalStart` and asserts that it does
  not compute interval starts itself. Whether the autumn duplicate hour maps correctly is plan 1's
  assertion and plan 1's mutation (design §10.3).
- **Nothing about completeness, day state or the rollup.** `IDayStateRecomputer` is a no-op here.
  The `directions.Count == 2` prohibition (design §10.1) and the §4.1 accumulators (design §10.4)
  are plan 5's, and both are mutation-verified there.
- **Nothing about tenancy on the read path.** The Worker connects as the owner and is exempt from
  RLS by design. The only tenancy assertion in this plan is negative — that the Worker exposes no
  `/api/v1/**` route. Plan 2 proves the policies and plan 6 proves 404-not-403.
- **Nothing about the real wire contract.** `[OQ-05]` — the endpoint, the authentication mechanism,
  the acknowledgement form and the retry policy on non-2xx — is unanswered, and `[R-01]` stays
  scored **20**. The webhook this plan builds is the shape `[DEC-21]` sanctions for the proof of
  concept, not the shape PVNed has confirmed.
