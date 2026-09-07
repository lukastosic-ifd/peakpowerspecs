# Read Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every kWh that the ingestion pipeline stored onto a wire a client can read — the two
customer consumption endpoints on the frozen Phase-1 envelope, `LastDataDate` and the 14-day
data-state strip on the connection DTOs, the four employee data-health responses including replay —
each route added in the same commit as its `.RequireAuthorization()`, its `.TenantScoped(...)` and
its 404-not-403 cross-tenant test, and both OpenAPI snapshots regenerated and re-accepted.

**Architecture:** Two read surfaces over the tables migration 9 created, and nothing else. The
customer surface (`PeakPower.Api.Customer`) reads `interval_data_version`, `interval_reading`,
`metering_point_day_state` and `daily_position` through the DbContext's four new global query
filters, on a connection that `CustomerSessionMiddleware` has already dropped to
`app_customer_role` — so tenancy holds twice and a cross-tenant read arrives as an absent row,
which is what makes 404 rather than 403 the honest answer. The employee surface
(`PeakPower.Api.Employee`) runs unscoped by construction and needs no tenancy work; it reads
`inbound_message`, `quarantined_series` and `customer.metering_point`, and its one mutating route —
replay — resolves `IProcessInboundMessageHandler` in-process so the response can carry the version
and quarantine counts §10.4 freezes. Neither surface writes a reading, computes a rollup, or knows
what a BRP document looks like.

**Tech Stack:** .NET SDK 10.0.400 · C# `latest`, `Nullable enable`, `TreatWarningsAsErrors` ·
EF Core 10.0.11 · Npgsql 10.0.3 · Npgsql.EntityFrameworkCore.PostgreSQL 10.0.3 · PostgreSQL 17 ·
ASP.NET Core Minimal APIs (net10.0) · Microsoft.AspNetCore.OpenApi 10.0.11 ·
xUnit v3 3.2.2 · Shouldly 4.3.0 · Testcontainers.PostgreSql 4.14.0 · Dapper 2.1.66 ·
Verify.XunitV3 30.15.0 · Microsoft.AspNetCore.Mvc.Testing 10.0.11

**Spec:** docs/superpowers/specs/2026-09-07-poc-slice-2-design.md
**Shared contract:** docs/superpowers/plans/2026-09-07-slice-2-shared-contract.md

---

## Global Constraints

### Versions — exact, from the shared contract §1, verified 2026-09-07

| | |
| --- | --- |
| .NET SDK | **10.0.400** (`global.json`, `rollForward: latestFeature`) |
| Target framework | **net10.0**, `LangVersion latest`, `Nullable enable`, `TreatWarningsAsErrors`, `AnalysisMode Recommended` |
| EF Core | **10.0.11** |
| Npgsql / Npgsql.EntityFrameworkCore.PostgreSQL | **10.0.3** |
| PostgreSQL | **17** (Testcontainers image) |
| `Microsoft.AspNetCore.OpenApi` | **10.0.11** |
| `Microsoft.AspNetCore.Mvc.Testing` / `.TestHost` | **10.0.11** |
| `xunit.v3` | **3.2.2** (+ `xunit.runner.visualstudio` 3.1.5, `Microsoft.NET.Test.Sdk` 18.9.0) |
| `Shouldly` | **4.3.0** — ⚠ **never FluentAssertions** `[DEC-118]` |
| `Testcontainers.PostgreSql` | **4.14.0** |
| `Dapper` | **2.1.66** |
| `Verify.XunitV3` | **30.15.0** — ⚠ **not `Verify.Xunit`** (CS0433 against xunit.v3 on `FactAttribute`) |

**No package is added or bumped by this plan.** Every package named above is already pinned in
`Directory.Packages.props` and already referenced by the projects this plan touches.

### Repositories

```
/Users/thinhhuynh/PeakPower/peakpower-platform      # .NET   — every file this plan writes
/Users/thinhhuynh/PeakPower/peakpower-web           # Angular — plan 7's, NOT this plan's
```

**This plan writes no Angular code and regenerates no typed client.** Shared contract §10.5 ends
with `npm run generate:clients` in `peakpower-web`; §17 assigns that to **plan 7**. Plan 6 stops at
`artifacts/openapi/{customer,employee}.json` and the two accepted Verify snapshots, and Task 13
names the hand-off explicitly.

### Commands

```bash
# from /Users/thinhhuynh/PeakPower/peakpower-platform
./dev-up
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Consumption"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~DataHealth"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Tenancy"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Contract"
dotnet test tests/PeakPower.Architecture.Tests
tools/verify-solution-layout.sh
tools/verify-build-settings.sh
```

⚠ **Integration tests use Testcontainers.** Running several suites in parallel across worktrees can
exhaust connections and produce mass Postgres timeouts — retry before reporting a regression.

⚠ **`cp -a` preserves mtimes and leaves MSBuild with stale binaries**; use plain `cp` or `touch`.

### What this plan owns, exclusively

Shared contract §17, row 6:

- `GET /api/v1/consumption/day` and `GET /api/v1/consumption/month` (§10.1, §10.2)
- `LastDataDate` on both connection DTOs, and `ConnectionDetailDto.RecentDataStates` (§10.3)
- The four employee data-health responses and replay (§10.4)
- The regenerated OpenAPI snapshots (§10.5), platform side

### What this plan must NOT touch

- **No migration SQL, no entity class, no EF configuration, no query filter.** Plan 2 owns all of
  §6 and all eight entity classes of §5. This plan *reads* those entities and declares none.
- **No member of `IMarketCalendar`.** Plan 1 owns every one (§7.5). This plan calls
  `ExpectedIntervalCount`, `IntervalStart`, `IsDstDuplicate` and `TodayInAmsterdam` and adds none.
- **No `--pp-chart-*` token, no Angular component, no route in `peakpower-web`.** Plan 7's.
- **No key of §10.** The envelopes are FROZEN. A key added, removed or respelt here is a break in a
  second repository that cannot be seen from this one.

### The envelope is FROZEN — shared contract §10, reproduced so no task has to leave its own text

`GET /api/v1/consumption/day`:

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

`GET /api/v1/consumption/month`:

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

**The five rules that make this envelope the right one, all of which have a named test in this
plan:**

1. ⚠ **There is no `blocks`, `blockKwh`, `netPositionKwh`, `isPeak`, `dayAheadPriceEurMwh`,
   `coverageRatio` or `surplusKwh` key ANYWHERE** — not as `null`, not as `0`, not as an empty
   array. The published API-contract example is pre-`[DEC-22]`: it carries a gross-consumption
   summary and no `netUsageKwh`, so implementing it verbatim ships the wrong product. Design §7.15
   requires a test asserting **against the raw JSON** that these keys are absent. Task 4, Step 5.
2. ⚠ **A missing interval is an ABSENT ENTRY.** Never `0`, never `null`, never a placeholder
   object. `[F02-R25]`, `[F03-R06]`. `intervals.Length` may be less than `intervalCount`, and the
   chart draws the difference as a gap. Design §7.15 requires a test that **fails** if a missing
   interval is serialised as 0 or null. Task 4, Step 9, mutation-verified.
3. ⚠ **`dstPass`** is `"A"` for the first pass of the autumn duplicate hour and `"B"` for the
   second; `null` on every other interval of every other day. The chart composes `02:00 A` /
   `02:00 B` from this field and must **not** re-derive the pass from the UTC offset. Task 5.
4. ⚠ **`netUsageKwh` is missing when EITHER side is missing**, not "the other series' value"
   (position-and-coverage §2.1). Where `productionIsDeclaredZero` is true, production is `0.0` — a
   **declared** zero from master data, traceable through `productionDeclaration` — and
   `netUsageKwh` equals `consumptionKwh`. `[F02-R33]`, `[F01-R40]`. Task 5.
5. ⚠ **Every day of the month is present in `days[]`, including days with no data**, carrying
   `dataState: "NO_DATA"` and `null` volumes. This is deliberately the **opposite** of the day
   envelope's absent-interval rule: `[F03-R10]` needs the month chart to mark missing days as
   **stubs, not short bars**, and it cannot mark a day the payload does not mention.
   `days.length == dayCount` always. Shared contract §16, item 7. Task 6.

⚠ **`null` volumes mean missing. `0.0` means measured zero.** A mapper that coalesces `null` to `0`
has erased the distinction this whole slice exists to preserve.

⚠ **Decimals serialise as JSON numbers, not quoted strings** (shared contract §16, item 6). The
published API-contract example quotes them (`"180.000"`); this repository does not —
`ConnectionSummaryDto.CapacityKw` is `decimal?` and reaches the generated client as
`/** Format: double */ capacityKw: null | number`. One convention beats matching a document, and it
means plan 7's chart takes `number | null` with no parsing step.

### Tenancy — why every route below is written with its guard, in one commit

Design §8 records this as a risk that **already reached review once**:

> The customer API connects as the **database owner** and drops privilege only inside
> `CustomerSessionMiddleware`, which anonymous requests skip. A consumption endpoint that forgets
> `.RequireAuthorization()` runs as owner with **both** tenancy layers off — a bug that reached
> review once already on `CompanyEndpoints` (`GET /company/accounts` answered anonymous callers 200
> with every company's people; commit `0a49a8d`).

So, without exception, on every customer route this plan adds:

1. `.RequireAuthorization()` — the host's `FallbackPolicy` already denies by default, so this is
   belt and braces **and** the thing `AuthenticationRequirementOperationTransformer` reads to put
   the 401 into the OpenAPI document. Both matter.
2. `.TenantScoped("metering-point")` — the classification the route-table proofs read.
3. A **404-not-403 cross-tenant test in the same commit**: company A asking for company B's
   metering point id must get exactly `404`, with a body byte-identical to the 404 for an id that
   never existed. `ApiResults.NotFound()` is the only way to write it; `ApiResults` has no
   `Forbidden` and never will. `[F13-R19]`.
4. An entry in the route-table literals that break — see below.

**The employee host runs unscoped by construction** (`UnscopedCustomerContext`, paired with the
`peakpower_employee` login role and its "see everything" policy), so none of the data-health work
needs tenancy work. Every employee route carries `.BackOffice(reason)` instead, and the reason must
be a sentence a reviewer can disagree with — `EmployeeRouteTableTests` fails on a blank one.

### The guard literals that break, and move in the same commit

⚠ These live in `PeakPower.Integration.Tests`, so they fail `dotnet test`, not `-warnaserror`.

| File | Line | Before | After | Task |
| --- | --: | --- | --- | --: |
| `tests/PeakPower.Integration.Tests/Tenancy/CustomerApiRouteTableTests.cs` | 74 | `"GET /api/v1/ean-pool",` preceded by `"GET /api/v1/company/accounts",` | two new lines between them | 4, 6 |
| same | 110 | `TenantScopedCollectionGetCount = 4` | `= 6` | 4, 6 |
| same | 376 | `GetAsync(entry.RoutePattern, Ct)` | `GetAsync(entry.RoutePattern + query, Ct)` | 4 |
| `tests/PeakPower.Integration.Tests/Contract/CustomerResponseMetadataTests.cs` | 79–80 | the `ExpectedResponseContract` rows around `GET /api/v1/ean-pool` | two new rows | 4, 6 |
| `tests/PeakPower.Integration.Tests/Portal/ConnectionListTests.cs` | 124–134 | `Last_data_date_is_null_because_ingestion_is_out_of_scope` | inverted | 7 |
| `tests/PeakPower.Integration.Tests/Portal/ConnectionDetailTests.cs` | 128 | `detail.LastDataDate.ShouldBeNull();` | a real date | 7 |
| `tests/PeakPower.Integration.Tests/Portal/CompanyEndpointTests.cs` | 243–248 | six `AssertEveryMemberAgrees` calls | a seventh, for `MeteringDayState` | 2 |
| `tests/PeakPower.Integration.Tests/Employee/EmployeeRouteTableTests.cs` | 94 | `EmployeeEndpointCount = 16` | `= 18` | 10 |
| same | 94 | `= 18` | `= 19` | 11 |
| same | 94 | `= 19` | `= 20` | 12 |

`TenantScopedParameterisedCount` at `CustomerApiRouteTableTests.cs:103` is **unchanged at 2**: both
consumption routes name their metering points in the **query string**, not the path, so neither is
a parameterised tenant-scoped route. `SharedReferenceDataCount` at `:116` is unchanged at 1;
`AnonymousEndpointAllowListTests.Expected` is unchanged — nothing this plan adds is anonymous.
Nor is `EmployeeRouteTableTests.ExpectedAnonymous` at `:106-111`: all four data-health routes
require a back-office token. `accountIdOwned.Length.ShouldBe(2)` in `RowLevelSecurityTests` is plan
2's and unchanged either way: no route here is account-scoped.

**Which task adds which employee routes**, so the three moves of `EmployeeEndpointCount` above are
arithmetic rather than guesswork:

| Task | Routes added | Count after |
| --: | --- | --: |
| 10 | `GET /api/v1/data-health/messages`, `GET /api/v1/data-health/quarantine` | 18 |
| 11 | `GET /api/v1/data-health/metering-points` | 19 |
| 12 | `POST /api/v1/data-health/messages/{id}/replay` | 20 |

Four routes — shared contract §10.4's four responses — so `16 + 4 = 20`. ⚠ Shared contract §12 does
**not** list this literal; it is discovered here, which is why the three moves are written out one
task at a time rather than left as a single `16 → 20` a reader has to reconstruct.

### Enums on the wire

The database spelling is normative and it extends to JSON (`SCREAMING_SNAKE`, not `"Provisional"`).
Every DTO in `PeakPower.Contracts` carries its enum-shaped fields as `string`, because that assembly
references nothing — so the mapping happens in the host, in an explicit `switch` that cannot compile
if a member is added and left unhandled, and
`CompanyEndpointTests.Every_wire_spelling_PortalMappings_produces_is_the_shared_converters_spelling`
holds that switch to `EnumWireFormat`. **Never call `.ToString()` on an enum destined for JSON**:
that is the one call that reintroduces PascalCase.

The five spellings this plan puts on a wire, all from shared contract §4:

```
MeteringDayState        NO_DATA | PARTIAL | PROVISIONAL | FINAL     — no COMPLETE member exists
InboundMessageStatus    RECEIVED | PROCESSING | PROCESSED | FAILED | DUPLICATE
QuarantineReason        UNKNOWN_EAN | EAN_VALIDITY | WRONG_BRP | NOT_ELECTRICITY
IntervalDirection       CONSUMPTION | PRODUCTION
ProductionExpectation   UNKNOWN | NEVER | EXPECTED            (slice 1's, unchanged)
```

⚠ **There is no `COMPLETE` member of `MeteringDayState`.** F02 §6's state machine goes
`NO_DATA → PARTIAL → PROVISIONAL → FINAL`, and integration-spec §8.3's word "Complete" is the
*condition* that moves a day to `PROVISIONAL`, not a fifth state.

⚠ **The data-state ordering is `NO_DATA < PARTIAL < PROVISIONAL < FINAL`** (shared contract §10.1),
and the envelope's `dataState` is the **worst** state across the selection. This plan ranks the
four members explicitly rather than by an `(int)` cast on the enum: a member inserted in the middle
of the declaration would silently reorder the ranking, and the worst state is what every KPI on
plan 7's screen is labelled with.

### Copy rules (shared contract §14) that bind the strings this plan writes

Sentence case everywhere; ALL CAPS only for stat-card labels and table column heads; **no emoji, no
icon set**; empty and disabled states name the reason. `OperationalAlert.Summary` and every
`.WithSummary(...)` string is one sentence, sentence case, ending with a full stop.

- **"Projected" = not yet measured; "Provisional" = not yet accepted. Never swap them.** A
  `PROVISIONAL` day is measured, and calling it projected is a lie about a number the customer will
  be invoiced on.
- **A declared zero is not an absence.** `[F02-R33]`: where `production_expectation` is `NEVER`,
  production reads as a **stated zero traceable to its source, setter and date** `[F01-R40]` — not
  as a gap. That is what `productionDeclaration` carries and why it exists.

### Mutation verification — this repository's stated standard

**Break it first, predict the failure, watch it go red, check the failure is the one you predicted,
then fix it. A green test that was never seen red is not evidence.** Every load-bearing step below
names **what to break · what failure to predict · what to watch go red**. A mutation that breaks
the *build* proves nothing about an assertion — if removing a member orphans a `using`, remove that
too.

⚠ **Mutate the case your assertion is actually for, not the easy neighbouring one.** CLAUDE.md
records a guard that was mutation-verified against "the property does not exist" but never against
"the property exists under a different casing", and so certified a half-working guard.

⚠ **Shouldly's `ShouldContain` is case-insensitive by default** and has silently broken three tests
in this repository. Compare with `StringComparison.Ordinal` and assert on structured fields, never
by searching a response body for a substring. The two places this plan searches a body — the
absent-key assertion and the missing-interval assertion — parse the JSON with `JsonDocument` and
assert on properties, not on text.

**The one assertion design §15.2 requires this plan to mutation-verify by name:** *the absent-key
assertion — serialise a missing interval as `0` and watch the day-envelope test go red* (design
§7.15). It is Task 4, Step 9.

### Names this plan CONSUMES and must never declare

From plan 2 (shared contract §5) — entity classes, read through `db.Set<T>()`:

```csharp
PeakPower.Domain.Metering.InboundMessage
    Id · BrpId · CorrelationId · ReceivedAt · PayloadHash · PayloadBytes · PayloadUri
    HttpHeaders · RemoteIp · Status · FailureCode · FailureDetail · ProcessedAt
PeakPower.Domain.Metering.IntervalDataVersion
    Id · MeteringPointId · CustomerId · DeliveryDate · Direction · Source · DocumentId
    DocumentCreated · ReceivedAt · InboundMessageId · CorrelationId · IntervalCount
    IsCurrent · CreatedAt
PeakPower.Domain.Metering.IntervalReading
    VersionId · DeliveryDate · CustomerId · Pos · IntervalStart · QuantityKwh
PeakPower.Domain.Metering.MeteringPointDayState
    MeteringPointId · DeliveryDate · CustomerId · State · ExpectedIntervalCount
    ConsumptionComplete · ProductionComplete · ProductionIsDeclaredZero
    FinalisedAt · LastCorrectedAt · ComputedAt
PeakPower.Domain.Metering.QuarantinedSeries
    Id · InboundMessageId · BrpId · Reason · ResourceObject · DeliveryDate · Direction
    PointCount · ReceivedAt · ResolvedAt · ResolvedBy · ResolvedByReplayOfMessageId
PeakPower.Domain.Metering.DailyPosition
    MeteringPointId · DeliveryDate · CustomerId · ConsumptionKwh · ProductionKwh
    NetUsageKwh · OfftakeKwh · ExportKwh · DataState · SourceVersionIds · ComputedAt
PeakPower.Domain.Metering.OperationalAlert
    Id · Kind · Status · MeteringPointId · BrpId · InboundMessageId · DeliveryDate
    Summary · Detail · RaisedAt · ResolvedAt
```

⚠ **`OperationalAlert` is read by exactly one query in this plan** — Task 11's `isSilent`, which
counts the open `METERING_POINT_SILENT` rows for the page's points. This plan **raises no alert and
resolves none**: `IOperationalAlertRaiser` is plan 3's declaration and plan 5's implementation
(shared contract §7.6), and `isSilent` is the read of what the rollup job decided, so the screen and
the job cannot disagree about which connections are silent.

From plan 3 (shared contract §7.4, and plan 3's own `PeakPower.Ingestion.Processing`) — the replay
seam Task 12 resolves in-process:

```csharp
namespace PeakPower.Ingestion.Processing;

public enum InboundMessageProcessingStatus { Applied, NoChange, Failed, RecognisedAndClosed }

public sealed record InboundMessageProcessingOutcome(
    InboundMessageProcessingStatus Status,
    int VersionsCreated,
    int QuarantineEntriesCreated,
    int QuarantineEntriesResolved,
    int LabelledSeriesSkipped,
    string? FailureCode,
    string? FailureDetail);

public interface IInboundMessageProcessor
{
    Task<InboundMessageProcessingOutcome> ProcessAsync(
        Guid inboundMessageId, Guid correlationId, CancellationToken ct);
}
```

⚠ **`IInboundMessageProcessor` is the interface with the answer on it, and `ProcessAsync` is the
method Task 12 calls.** Shared contract §7.4 freezes `IProcessInboundMessageHandler.HandleAsync` as
returning `Task`, which is right for a queue — there is nobody to hand a result to — and useless for
a replay response that must report `versionsCreated` and `quarantineEntriesResolved`. One class,
`ProcessInboundMessageHandler`, implements both and is registered once per scope reachable through
either, so the two are the same object and cannot process a message twice.

From plan 3 (shared contract §7.3, §7.4) — the two ports Task 12's composition brings with it:

```csharp
namespace PeakPower.Application.Abstractions.Ingestion;

public interface IRawPayloadStore
{
    Task<string> StoreAsync(
        Guid brpId, Guid correlationId, ReadOnlyMemory<byte> payload, CancellationToken ct);
    Task<ReadOnlyMemory<byte>> ReadAsync(string payloadUri, CancellationToken ct);
}

public interface IIngestionJobQueue
{
    Task EnqueueProcessMessageAsync(Guid inboundMessageId, Guid correlationId, CancellationToken ct);
}
```

```csharp
namespace PeakPower.Ingestion;         // AddPeakPowerIngestion(IServiceCollection, IConfiguration)
namespace PeakPower.Ingestion.Storage; // RawPayloadStoreOptions.RootEnvironmentVariable = "RAW_PAYLOAD_ROOT"
```

From plan 4 (shared contract §8.6):

```csharp
namespace PeakPower.Integration.Brp.Pvned;   // AddPvnedBrpAdapter(IServiceCollection, IConfiguration)
```

⚠ **Every query in this plan reaches these through `db.Set<T>()`, never through a `DbSet` property.**
Shared contract §5 pins the **entity type names**; it does not pin the `DbSet<T>` property names
plan 2 will add to `PeakPowerDbContext`, and `Set<T>()` returns the same `DbSet` instance that a
property would. Naming the type the contract pins is what makes this plan compile against plan 2
without a second agreement neither of us can see. (The existing slice-1 properties —
`db.MeteringPoints`, `db.Brps`, `db.Customers` — are used by name, because those *are* pinned by
slice 1's contract and already exist.)

From plan 2 (shared contract §6.2) — four new properties on the existing `MeteringPoint`:

```csharp
DateTimeOffset  BrpAssignedAt
DateTimeOffset? FirstProductionObservedAt
string?         ExpectationSetBy
DateTimeOffset? ExpectationSetAt
```

⚠ The existing property is `MeteringPoint.ExpectationSource` (mapped to `expectation_source`), not
`ProductionExpectationSource` — that is the *enum type's* name.

From plan 1 (shared contract §7.5) — `IMarketCalendar`:

```csharp
DateTimeOffset UtcNow { get; }
DateOnly TodayInAmsterdam { get; }
int ExpectedIntervalCount(DateOnly date);              // 92 | 96 | 100
DateTimeOffset IntervalStart(DateOnly date, int pos);  // 1-based; throws outside 1..count
bool IsDstDuplicate(DateOnly date, int pos);           // true only for the SECOND pass
DateOnly AddWorkingDays(DateOnly from, int workingDays);
```

From plan 3 (shared contract §7.4) — the replay seam:

```csharp
namespace PeakPower.Application.Abstractions.Ingestion;

public interface IProcessInboundMessageHandler
{
    Task HandleAsync(Guid inboundMessageId, Guid correlationId, CancellationToken ct);
}
```

From slice 1, already in the repository:

```csharp
PeakPower.Infrastructure.Web.Http.ApiResults
    .Found<T>(T? value) · .NotFound() · .InvalidRequest(string property, string error)
    .Conflict(string detail)
    const NotFoundType / NotFoundTitle / NotFoundDetail / ValidationType / ValidationTitle
PeakPower.Infrastructure.Web.Http.EnumWireFormat
    .Converter · .ToWire<TEnum>(TEnum) · .TryParse<TEnum>(string?, out TEnum)
    .Parse<TEnum>(string) · .Names<TEnum>()
PeakPower.Infrastructure.Web.Tenancy.TenancyEndpointExtensions
    .TenantScoped(resourceKind) · .BackOffice(reason) · .AnonymousEndpoint(reason)
    .SharedReferenceData(reason)
PeakPower.Api.Customer.Portal.PortalMappings
    .Wire(Commodity) · .Wire(ConnectionStatus) · .Wire(ProductionExpectation)
    .Wire(ProductionExpectationSource?) · .ToSummary(MeteringPoint, DateOnly)
    .ToDetail(MeteringPoint, string, DateOnly)
```

### Four decisions this plan takes that the shared contract does not settle

All four are flagged so a reader can overturn them in one place.

1. **The employee host composes `PeakPower.Ingestion` and `PeakPower.Integration.Brp.Pvned` — now
   settled in the contract, not by this plan.** This started as a divergence: shared contract §3.1
   said `PeakPower.Worker` was "the composition root that binds the adapter to the port, and the
   only project that sees both", and §10.4's replay response is **synchronous by construction** — it
   carries `versionsCreated` and `quarantineEntriesResolved`, which an enqueue cannot know — while
   design §7.6 measures replay by exactly those counts ("replaying an already-processed message
   produces no second version, asserted by version count"). **The contract has since been amended
   and now says so itself.** §3.1's project-reference table reads, verbatim:

   > `PeakPower.Ingestion`, `PeakPower.Integration.Brp.Pvned`, `PeakPower.Persistence`,
   > `PeakPower.Infrastructure.Time`, `PeakPower.ServiceDefaults`. **This is the composition root
   > that binds the adapter to the port, and the only *host with a webhook* that sees both;
   > `PeakPower.Api.Employee` also composes both, solely so §10.4's replay can answer with real
   > counts — pinned by `ReplayCompositionFacts`**

   So Task 12 is implementing the amended contract rather than departing from it, and the words
   "the only *host with a webhook*" are the load-bearing ones: the employee host maps **no**
   webhook route, and Task 12's `UnreachableIngestionJobQueue` is what makes that structural rather
   than a matter of nobody having mapped one yet. Architecture fact 3 is untouched either way: it
   constrains what `PeakPower.Ingestion` may reference, not what a host may compose, and the module
   rules have always allowed a host to reference infrastructure solely to register it at the
   composition root. `ReplayCompositionFacts` — created in Task 12, and named by the contract —
   pins the set of *API hosts* doing this to exactly one, so a third is a deliberate edit.
2. **The replay runs under the message's OWN correlation id, not a fresh one.** Shared contract
   §10.4's response carries `correlationId` and does not say which. The stored one is what ties the
   raw payload, the `inbound_message` row and every `interval_data_version` it produces into one
   trail; a fresh id would orphan the replay from the receipt it re-runs, and
   `interval_data_version.correlation_id` is exactly how an operator walks back from a version to
   the POST that caused it. Task 12, and a named test.
3. **`state=` on `GET /api/v1/data-health/metering-points` means "has at least one day in that
   state inside the twenty-one-day window", not "the most recent day is in that state".** §10.4
   names the parameter and not its predicate. The heat map is twenty-one cells wide and an operator
   filtering it is looking for the connections that have a bad cell *anywhere* in the strip — a
   PARTIAL day three days ago is exactly the thing that must not scroll off the filter because
   yesterday came in clean. Task 11, and mutation-verified against the most-recent-day reading.
4. **`summary.consumptionKwh` / `productionKwh` / `netUsageKwh` are `decimal?`, not `decimal`.**
   The frozen example shows numbers, which a nullable decimal satisfies; making them non-nullable
   would force a range that measured nothing to report `0.0`, and `0.0` means **measured zero** in
   this envelope. Each is the total of what was measured, `null` when nothing was, and each is
   labelled by the range's `dataState` — which is exactly what design §7.18 asks the KPI strip to
   show. No key changes.

---

## File Structure

### `peakpower-platform` — created

| Path | Responsible for |
| --- | --- |
| `src/Core/PeakPower.Contracts/Customer/Portal/ConsumptionContracts.cs` | `DayStateDto`, `ProductionDeclarationDto`, `ConsumptionIntervalDto`, `ConsumptionSummaryDto`, `ConsumptionDayResponse`, `ConsumptionMonthDayDto`, `ConsumptionMonthResponse`. Records, BCL types only — `PeakPower.Contracts` references nothing. |
| `src/Core/PeakPower.Contracts/Employee/DataHealthDtos.cs` | `DataHealthMessageDto`, `DataHealthMessageListResponse`, `QuarantinedSeriesDto`, `QuarantineListResponse`, `DataHealthMeteringPointDto`, `DataHealthMeteringPointListResponse`, `ReplayMessageResponse`, `EmployeeDayStateDto`. |
| `src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionReader.cs` | The queries both consumption endpoints share: resolving the selection (and the 404 that is not a 403), `LastDataDate`, the dense recent-day-state series, and the `NO_DATA < PARTIAL < PROVISIONAL < FINAL` ranking. |
| `src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionDayAssembly.cs` | The pure per-interval assembly: which positions are present, the declared zero, `netUsageKwh`, the DST pass label, and the three summary totals. No database, no clock beyond `IMarketCalendar`. |
| `src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionEndpoints.cs` | `MapConsumptionEndpoints`, `GET /api/v1/consumption/day`, `GET /api/v1/consumption/month`. |
| `src/Hosts/PeakPower.Api.Employee/Endpoints/DataHealthEndpoints.cs` | `MapDataHealthEndpoints` and the four `/api/v1/data-health/*` routes. |
| `src/Hosts/PeakPower.Api.Employee/Mapping/DataHealthMappings.cs` | Domain → data-health DTO, including the five wire spellings and the age-in-hours computation. |
| `tests/PeakPower.Integration.Tests/Portal/ConsumptionFixtures.cs` | Raw-SQL arrangement of `interval_data_version`, `interval_reading`, `metering_point_day_state` and `daily_position` on the owner connection. Raw SQL on purpose — see its doc comment. |
| `tests/PeakPower.Integration.Tests/Portal/ConsumptionDayTests.cs` | The day envelope: shape, absent keys, absent intervals, tenancy, aggregation, DST, declared zero. |
| `tests/PeakPower.Integration.Tests/Portal/ConsumptionMonthTests.cs` | The month envelope: density, null-versus-zero, tenancy. |
| `tests/PeakPower.Integration.Tests/Portal/ConsumptionAssemblyTests.cs` | The pure assembly, with a stub `IMarketCalendar`. No container. |
| `tests/PeakPower.Integration.Tests/Portal/RecentDataStatesTests.cs` | The 14-day strip on connection detail. |
| `tests/PeakPower.Integration.Tests/Employee/DataHealthFixtures.cs` | Raw-SQL arrangement of `inbound_message` and `quarantined_series`. |
| `tests/PeakPower.Integration.Tests/Employee/DataHealthMessageTests.cs` | `GET /data-health/messages`, its BRP and status filters, and the two per-row counts. |
| `tests/PeakPower.Integration.Tests/Employee/DataHealthQuarantineTests.cs` | `GET /data-health/quarantine`, its reason and resolved filters, and `ageHours`. |
| `tests/PeakPower.Integration.Tests/Employee/DataHealthMeteringPointTests.cs` | `GET /data-health/metering-points`, the 21-day heat map, `isSilent`, and the inactive-BRP case. |
| `tests/PeakPower.Integration.Tests/Employee/DataHealthReplayTests.cs` | `POST /data-health/messages/{id}/replay`, `NO_CHANGE`, and the quarantine-resolution path. |
| `tests/PeakPower.Integration.Tests/Employee/PvnedReplayDocument.cs` | One valid PVNed A23 allocation document, built in C# for a named EAN and date, so the replay loop has a real stored payload to replay. Not a second parser fixture — see its doc comment. |
| `src/Hosts/PeakPower.Api.Employee/Ingestion/UnreachableIngestionJobQueue.cs` | The `IIngestionJobQueue` this host registers so `ValidateOnBuild` can construct `IInboundMessageReceiver`, and which throws if anything ever calls it. The employee host maps no webhook. |
| `tests/PeakPower.Architecture.Tests/ReplayCompositionFacts.cs` | Exactly one API host composes the ingestion pipeline and a BRP adapter, and it is the employee host. |

### `peakpower-platform` — modified

| Path | Change |
| --- | --- |
| `src/Core/PeakPower.Contracts/Customer/Portal/PortalContracts.cs` | `:48-55` the "ALWAYS null in slice 1" doc comment goes; `:93` `ConnectionDetailDto` gains `RecentDataStates` at the end. |
| `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs` | `+ Wire(MeteringDayState)`; `:163` and `:188` stop hard-coding `LastDataDate: null`; `ToSummary` and `ToDetail` take the new arguments. |
| `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs` | `:57-73`, `:98-117`, `:155-177`, `:335-340` — the four call sites that build a summary or a detail now pass `lastDataDate` and, for detail, `recentDataStates`. |
| `src/Hosts/PeakPower.Api.Customer/Program.cs` | `:480` gains `app.MapConsumptionEndpoints();` on the next line. |
| `src/Hosts/PeakPower.Api.Customer/OpenApi/EnumWireValuesSchemaTransformer.cs` | `:54` gains seven entries for the new DTOs' enum-shaped strings. |
| `src/Hosts/PeakPower.Api.Employee/Program.cs` | `:344` gains `app.MapDataHealthEndpoints();` (Task 10), and `:97` gains the ingestion + adapter + queue registrations (Task 12). |
| `src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj` | `:66` gains two `<ProjectReference>` lines: `PeakPower.Ingestion`, `PeakPower.Integration.Brp.Pvned`. |
| `src/Hosts/PeakPower.Api.Employee/OpenApi/EnumWireValuesSchemaTransformer.cs` | `:41` gains five entries. |
| `tests/PeakPower.Integration.Tests/Employee/EmployeeApiFactory.cs` | `ConfigureWebHost` gains one `UseSetting` for `RAW_PAYLOAD_ROOT`, and the class gains the `RawPayloadRoot` property behind it. |
| `tests/PeakPower.Integration.Tests/Employee/DataHealthFixtures.cs` | Task 10 creates it; Tasks 11 and 12 append four arrangements — a day state, a silence alert, a metering point on a second BRP, and a stored message with a real payload. |
| `tests/PeakPower.Integration.Tests/Tenancy/CustomerApiRouteTableTests.cs` | `:74` two rows; `:110` `4 → 6`; `:376` appends the registered query string; the probe fact requires a registered query for every tenant-scoped collection GET. |
| `tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleQueries.cs` | **created** beside `CustomerSampleBodies.cs`, same shape and the same both-directions staleness rule. |
| `tests/PeakPower.Integration.Tests/Contract/CustomerResponseMetadataTests.cs` | `:79-80` two rows in `ExpectedResponseContract`. |
| `tests/PeakPower.Integration.Tests/Portal/ConnectionListTests.cs` | `:124-134` inverted. |
| `tests/PeakPower.Integration.Tests/Portal/ConnectionDetailTests.cs` | `:128` inverted. |
| `tests/PeakPower.Integration.Tests/Portal/CompanyEndpointTests.cs` | `:243-248` a seventh `AssertEveryMemberAgrees`. |
| `tests/PeakPower.Integration.Tests/Employee/EmployeeRouteTableTests.cs` | `:89-94` `16 → 20` and its doc comment. |
| `artifacts/openapi/customer.json` · `artifacts/openapi/employee.json` | regenerated at build. |
| `tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json` | re-accepted. |
| `tests/PeakPower.Integration.Tests/Contract/EmployeeOpenApiSnapshotTests.the_employee_openapi_document_matches_the_reviewed_snapshot.verified.json` | re-accepted. |

---

### Task 1: The consumption contracts

Shared contract §10.1, §10.2 and §10.3, turned into records in `PeakPower.Contracts`. Nothing here
has behaviour; the whole point of the task is that the **key set** is fixed before any handler is
written, so a later task cannot quietly add a `blockKwh` while thinking about something else.

Three things that look like mistakes if you have not read §10:

- **`ConsumptionIntervalDto`'s three volumes are `decimal?` and its `DstPass` is `string?`.** A
  present interval can still be missing one of its two series — an `EXPECTED` connection whose
  production document never arrived has a consumption value and no production value on every
  position of the day. `netUsageKwh` is then `null` too, because net usage is not "the other
  series' value".
- **`ConsumptionMonthDayDto` has no `intervals`.** The month view reads `daily_position`, which is
  what that rollup exists for; going back to `interval_reading` for thirty-one days would be the
  read that `[NFR-04]` fails on.
- **`DayStateDto` is in the *Portal* namespace and is used by both the connection detail and the
  employee heat map.** They differ only in length — fourteen entries for the customer strip,
  twenty-one for the employee one. The two numbers come from different mockups
  (`ean-detail.svg` and `employee-ingestion-health.svg`) and neither is a typo. The employee host
  cannot reference the customer's contracts namespace convention comfortably, so Task 9 declares
  its own `EmployeeDayStateDto` with the identical shape rather than reaching across; see that
  task's note.

**Files:**
- Create: `src/Core/PeakPower.Contracts/Customer/Portal/ConsumptionContracts.cs`
- Test: `tests/PeakPower.Domain.Tests/Contracts/ContractPurityTests.cs` (modify — add two facts)

**Interfaces:**
- Consumes: nothing. `PeakPower.Contracts` references nothing, enforced twice (Cecil, and a grep
  for `<ProjectReference` in `tools/verify-solution-layout.sh`).
- Produces:
  - `public sealed record DayStateDto(DateOnly Date, string State)`
  - `public sealed record ProductionDeclarationDto(string Expectation, string? Source, string? SetBy, DateTimeOffset? SetAt)`
  - `public sealed record ConsumptionIntervalDto(int Pos, DateTimeOffset Start, DateTimeOffset End, string? DstPass, decimal? ConsumptionKwh, decimal? ProductionKwh, decimal? NetUsageKwh)`
  - `public sealed record ConsumptionSummaryDto(decimal? ConsumptionKwh, decimal? ProductionKwh, decimal? NetUsageKwh, string DataState)`
  - `public sealed record ConsumptionDayResponse(DateOnly Date, IReadOnlyList<Guid> MeteringPointIds, int IntervalCount, string DataState, DateOnly? LastDataDate, DateTimeOffset? LastCorrectedAt, bool ProductionIsDeclaredZero, ProductionDeclarationDto? ProductionDeclaration, IReadOnlyList<ConsumptionIntervalDto> Intervals, ConsumptionSummaryDto Summary)`
  - `public sealed record ConsumptionMonthDayDto(DateOnly Date, int IntervalCount, string DataState, decimal? ConsumptionKwh, decimal? ProductionKwh, decimal? NetUsageKwh)`
  - `public sealed record ConsumptionMonthResponse(string Month, IReadOnlyList<Guid> MeteringPointIds, int DayCount, string DataState, DateOnly? LastDataDate, IReadOnlyList<ConsumptionMonthDayDto> Days, ConsumptionSummaryDto Summary)`

- [ ] **Step 1: Write the failing test**

Append to `tests/PeakPower.Domain.Tests/Contracts/ContractPurityTests.cs`, inside the class, after
`every_employee_request_type_is_a_record_so_it_is_value_compared_in_tests`:

```csharp
    /// <summary>
    /// The day envelope's key set, asserted on the CLR type rather than on a serialised sample.
    /// <para>
    /// Shared contract §10.1 drops <c>blocks</c>, <c>blockKwh</c>, <c>netPositionKwh</c>,
    /// <c>isPeak</c>, <c>dayAheadPriceEurMwh</c>, <c>coverageRatio</c> and <c>surplusKwh</c>
    /// entirely — not as null, not as zero, not as an empty array. The published API-contract
    /// example is pre-<c>[DEC-22]</c>: it carries a gross-consumption summary and no
    /// <c>netUsageKwh</c>, so implementing it verbatim ships the wrong product. Asserted here, on
    /// the record, as well as against the raw JSON in <c>ConsumptionDayTests</c>: this one fails
    /// the moment somebody TYPES the property, before any handler has to populate it.
    /// </para>
    /// </summary>
    [Fact]
    public void the_day_envelope_carries_no_block_coverage_or_price_property()
    {
        string[] forbidden =
        [
            "Blocks", "BlockKwh", "NetPositionKwh", "IsPeak",
            "DayAheadPriceEurMwh", "CoverageRatio", "SurplusKwh",
        ];

        Type[] envelope =
        [
            typeof(ConsumptionDayResponse),
            typeof(ConsumptionIntervalDto),
            typeof(ConsumptionSummaryDto),
            typeof(ConsumptionMonthResponse),
            typeof(ConsumptionMonthDayDto),
        ];

        var offenders = envelope
            .SelectMany(type => type.GetProperties()
                .Where(property => forbidden.Contains(property.Name, StringComparer.Ordinal))
                .Select(property => $"{type.Name}.{property.Name}"))
            .ToArray();

        offenders.ShouldBeEmpty(
            "shared contract §10.1: blocks are F05/Phase 2 and every money figure is out under " +
            "S2-D6. A column that is null on every row for a phase is a column somebody reads " +
            "as zero.");
    }

    /// <summary>
    /// The half of the same rule that a "no forbidden property" check cannot state: the three
    /// per-interval volumes must be NULLABLE. A present interval can still be missing one of its
    /// two series — an EXPECTED connection whose production document never arrived — and
    /// <c>netUsageKwh</c> is then missing too, never "the other series' value"
    /// (position-and-coverage §2.1). A non-nullable decimal here would force a 0, which in this
    /// envelope means MEASURED ZERO.
    /// </summary>
    [Fact]
    public void every_volume_on_the_consumption_envelope_is_nullable()
    {
        var interval = new ConsumptionIntervalDto(
            Pos: 1,
            Start: new DateTimeOffset(2026, 8, 12, 0, 0, 0, TimeSpan.FromHours(2)),
            End: new DateTimeOffset(2026, 8, 12, 0, 15, 0, TimeSpan.FromHours(2)),
            DstPass: null,
            ConsumptionKwh: 180.0m,
            ProductionKwh: null,
            NetUsageKwh: null);

        interval.ProductionKwh.ShouldBeNull();
        interval.NetUsageKwh.ShouldBeNull(
            "netUsageKwh is missing when EITHER side is missing, never the other side's value");

        var day = new ConsumptionMonthDayDto(
            new DateOnly(2026, 8, 15), IntervalCount: 96, DataState: "NO_DATA",
            ConsumptionKwh: null, ProductionKwh: null, NetUsageKwh: null);

        day.ConsumptionKwh.ShouldBeNull(
            "a NO_DATA day is present in days[] with null volumes — it is a stub the month chart " +
            "marks [F03-R10], not a short bar and not an absent entry");

        var summary = new ConsumptionSummaryDto(null, null, null, "NO_DATA");
        summary.NetUsageKwh.ShouldBeNull(
            "a range that measured nothing totals null, not 0.0 — 0.0 means measured zero");
    }
```

and add the `using` at the top of the file, beside `using PeakPower.Contracts.Employee;`:

```csharp
using PeakPower.Contracts.Customer.Portal;
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Domain.Tests --filter "FullyQualifiedName~ContractPurityTests"`
Expected: FAIL to **compile**, not to assert —
`error CS0246: The type or namespace name 'ConsumptionDayResponse' could not be found (are you missing a using directive or an assembly reference?)`
repeated for each of the five types.

- [ ] **Step 3: Write the contracts**

Create `src/Core/PeakPower.Contracts/Customer/Portal/ConsumptionContracts.cs`:

```csharp
namespace PeakPower.Contracts.Customer.Portal;

/// <summary>
/// One (delivery date, data state) pair. Used by the 14-entry strip on connection detail
/// [F02-R22] and — through the employee host's own copy — by the 21-day heat map.
/// <para>
/// <paramref name="State"/> is a <c>MeteringDayState</c> in its database spelling:
/// <c>NO_DATA</c>, <c>PARTIAL</c>, <c>PROVISIONAL</c> or <c>FINAL</c>. There is deliberately no
/// <c>COMPLETE</c>: F02 §6's state machine has four states, and integration-spec §8.3's word
/// "Complete" is the CONDITION that moves a day to PROVISIONAL, not a fifth state.
/// </para>
/// <para>
/// The series is DENSE and oldest first. A date with no stored state is carried as
/// <c>NO_DATA</c> rather than omitted, because the strip draws a fixed number of cells and
/// cannot mark a day the payload does not mention. This is the same argument as the month
/// envelope's, and the opposite of the day envelope's absent-interval rule; both are deliberate.
/// </para>
/// </summary>
public sealed record DayStateDto(DateOnly Date, string State);

/// <summary>
/// Where a connection's production expectation came from, so a declared zero reads as a stated
/// value rather than an absence [F02-R33] [F01-R40].
/// <para>
/// Present on the day envelope ONLY when exactly one metering point is selected: with several,
/// the four fields would have to be reconciled across connections that may disagree, and a
/// reconciled provenance is not a provenance.
/// </para>
/// </summary>
/// <param name="Expectation">UNKNOWN | NEVER | EXPECTED.</param>
/// <param name="Source">CONTRACT | GRID_OPERATOR | OBSERVED | MANUAL | CUSTOMER_DECLARED, or null.</param>
/// <param name="SetBy">Who recorded it. Null for a connection whose expectation predates the column.</param>
/// <param name="SetAt">When they recorded it.</param>
public sealed record ProductionDeclarationDto(
    string Expectation,
    string? Source,
    string? SetBy,
    DateTimeOffset? SetAt);

/// <summary>
/// One 15-minute interval of one day, summed across every selected connection.
/// <para>
/// <b>An interval that is missing is ABSENT from <c>ConsumptionDayResponse.Intervals</c>
/// entirely</b> — never a zero, never a null placeholder object [F02-R25] [F03-R06]. So
/// <c>Intervals.Count</c> may be less than <c>ConsumptionDayResponse.IntervalCount</c>, and the
/// chart draws the difference as a gap.
/// </para>
/// <para>
/// The three volumes are nullable because a PRESENT interval can still be missing one of its two
/// series: an EXPECTED connection whose production document never arrived has a consumption value
/// and no production value on every position of the day. <paramref name="NetUsageKwh"/> is then
/// null as well — it is missing when EITHER side is missing, never "the other side's value"
/// (position-and-coverage §2.1). Where production is a DECLARED zero [F02-R33] it is
/// <c>0.0</c> and net usage equals consumption.
/// </para>
/// </summary>
/// <param name="Pos">1-based position within the day. 1..92, 1..96 or 1..100.</param>
/// <param name="Start">The Amsterdam-local start instant, carrying the offset for that pass.</param>
/// <param name="End">The next position's start; the last position's start plus fifteen minutes.</param>
/// <param name="DstPass">
/// <c>"A"</c> for the first pass of the autumn duplicate hour, <c>"B"</c> for the second, null on
/// every other interval of every other day. The chart composes <c>02:00 A</c> / <c>02:00 B</c>
/// from this field and must not re-derive the pass from the UTC offset.
/// </param>
public sealed record ConsumptionIntervalDto(
    int Pos,
    DateTimeOffset Start,
    DateTimeOffset End,
    string? DstPass,
    decimal? ConsumptionKwh,
    decimal? ProductionKwh,
    decimal? NetUsageKwh);

/// <summary>
/// The three volume totals for the range, each read alongside the range's own data state
/// [F03-R19 is deferred; this is the volume half that is not].
/// <para>
/// Nullable, and that is the point: a range that measured nothing totals <c>null</c>, because
/// <c>0.0</c> in this envelope means MEASURED ZERO. Each total is the sum of what was measured;
/// <paramref name="DataState"/> is what says how much of the range that was.
/// </para>
/// </summary>
public sealed record ConsumptionSummaryDto(
    decimal? ConsumptionKwh,
    decimal? ProductionKwh,
    decimal? NetUsageKwh,
    string DataState);

/// <summary>
/// One Amsterdam calendar day of 15-minute interval data for one or more of this company's
/// connections [F03-R01].
/// <para>
/// <b>There is no <c>blocks</c>, <c>blockKwh</c>, <c>netPositionKwh</c>, <c>isPeak</c>,
/// <c>dayAheadPriceEurMwh</c>, <c>coverageRatio</c> or <c>surplusKwh</c> key anywhere in this
/// envelope</b> — not as null, not as zero, not as an empty array. Blocks are F05 / Phase 2, and
/// every money figure is out under S2-D6. The published API-contract example is pre-[DEC-22]: it
/// carries a gross-consumption summary and no netUsageKwh.
/// </para>
/// </summary>
/// <param name="IntervalCount">
/// 92, 96 or 100 — the length of the AXIS, not of <paramref name="Intervals"/>. A client must
/// never assume 96.
/// </param>
/// <param name="DataState">
/// The WORST state across the selection, ordered NO_DATA &lt; PARTIAL &lt; PROVISIONAL &lt; FINAL.
/// </param>
/// <param name="LastDataDate">
/// The most recent delivery date any selected connection has data for, over all time and not only
/// this day — it is what drives the chart's "jump to latest" [F03-R07]. Null when none has any.
/// </param>
/// <param name="LastCorrectedAt">
/// When a version for THIS date was last superseded, driving the corrected-on marker. Null when
/// nothing has been corrected.
/// </param>
/// <param name="ProductionIsDeclaredZero">
/// True only when EVERY selected connection is recorded <c>NEVER</c> [F02-R33]. With a mixed
/// selection it is false, because the statement would not be true of the whole.
/// </param>
public sealed record ConsumptionDayResponse(
    DateOnly Date,
    IReadOnlyList<Guid> MeteringPointIds,
    int IntervalCount,
    string DataState,
    DateOnly? LastDataDate,
    DateTimeOffset? LastCorrectedAt,
    bool ProductionIsDeclaredZero,
    ProductionDeclarationDto? ProductionDeclaration,
    IReadOnlyList<ConsumptionIntervalDto> Intervals,
    ConsumptionSummaryDto Summary);

/// <summary>
/// One day's totals in the month view [F03-R08].
/// <para>
/// A day with no data is PRESENT here carrying <c>NO_DATA</c> and null volumes, which is
/// deliberately the OPPOSITE of the day envelope's absent-interval rule: [F03-R10] requires the
/// month chart to mark missing days as STUBS rather than draw them as short bars, and it cannot
/// mark a day the payload does not mention.
/// </para>
/// </summary>
public sealed record ConsumptionMonthDayDto(
    DateOnly Date,
    int IntervalCount,
    string DataState,
    decimal? ConsumptionKwh,
    decimal? ProductionKwh,
    decimal? NetUsageKwh);

/// <summary>
/// One calendar month of daily totals [F03-R08].
/// </summary>
/// <param name="Month">yyyy-MM.</param>
/// <param name="DayCount">
/// Days in the month. <c>Days.Count == DayCount</c> ALWAYS — see
/// <see cref="ConsumptionMonthDayDto"/>.
/// </param>
public sealed record ConsumptionMonthResponse(
    string Month,
    IReadOnlyList<Guid> MeteringPointIds,
    int DayCount,
    string DataState,
    DateOnly? LastDataDate,
    IReadOnlyList<ConsumptionMonthDayDto> Days,
    ConsumptionSummaryDto Summary);
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Domain.Tests --filter "FullyQualifiedName~ContractPurityTests"`
Expected: PASS — 5 tests (the three that were there, plus these two).

- [ ] **Step 5: Mutation-verify the forbidden-key guard**

Add a property to `ConsumptionIntervalDto` — the exact one that would ship the wrong product:

```csharp
public sealed record ConsumptionIntervalDto(
    int Pos,
    DateTimeOffset Start,
    DateTimeOffset End,
    string? DstPass,
    decimal? ConsumptionKwh,
    decimal? ProductionKwh,
    decimal? NetUsageKwh,
    decimal? BlockKwh);            // ← the mutation
```

Run: `dotnet test tests/PeakPower.Domain.Tests --filter "FullyQualifiedName~the_day_envelope_carries_no_block_coverage_or_price_property"`
Expected: FAIL with
`Shouldly.ShouldAssertException : offenders should be empty but was ["ConsumptionIntervalDto.BlockKwh"]`
followed by the "blocks are F05/Phase 2" message.

⚠ Check the failure names `ConsumptionIntervalDto.BlockKwh` specifically. A failure that merely
says "should be empty" without the property name means the projection lost the type prefix, and
the guard would not tell the next person which record to look at.

Then remove the property and re-run to green.

- [ ] **Step 6: Verify `PeakPower.Contracts` still references nothing**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && tools/verify-solution-layout.sh`
Expected: PASS. The script greps `src/Core/PeakPower.Contracts/PeakPower.Contracts.csproj` for
`<ProjectReference` — a `using PeakPower.Domain.Metering;` slipped into the new file would need one,
and the grep catches it even when the compiler elides the unused assembly from the IL that
`ContractPurityTests` reflects over.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Contracts/Customer/Portal/ConsumptionContracts.cs \
        tests/PeakPower.Domain.Tests/Contracts/ContractPurityTests.cs
git commit -m "feat(contracts): add the Phase-1 consumption envelope [F03-R01] [F03-R08]

The key set is fixed before any handler exists, so no later task can add a blockKwh
while thinking about something else. Guarded from both sides: a reflection test that
fails on any of the seven forbidden properties, and a shape test pinning that every
volume is nullable because 0.0 in this envelope means measured zero.

Verified by adding ConsumptionIntervalDto.BlockKwh and watching
the_day_envelope_carries_no_block_coverage_or_price_property go red naming that
property.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `Wire(MeteringDayState)` and the data-state ranking

Two small pieces every later task in this plan leans on, and both are the kind of thing that is
wrong forever if it is written inline at four call sites.

- **`PortalMappings.Wire(MeteringDayState)`** — an explicit `switch`, not a derivation. A
  derivation looks tidier and gets `NoData` wrong (`NODATA` under a naive upper-case). The switch
  cannot compile if a member is added and left unhandled, and
  `CompanyEndpointTests.Every_wire_spelling_PortalMappings_produces_is_the_shared_converters_spelling`
  compares every declared member against `EnumWireFormat`, so the two can never drift.
- **`ConsumptionReader.Rank` / `.Worst`** — `NO_DATA < PARTIAL < PROVISIONAL < FINAL`, ranked by an
  explicit switch rather than by an `(int)` cast on the enum. The declaration order happens to
  agree today; a member inserted in the middle would silently reorder the ranking, and the worst
  state is what every KPI on plan 7's screen is labelled with.

**Files:**
- Modify: `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs:106` (after `Wire(ConnectionStatus)`)
- Create: `src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionReader.cs`
- Modify: `tests/PeakPower.Integration.Tests/Portal/CompanyEndpointTests.cs:247`
- Test: `tests/PeakPower.Integration.Tests/Portal/ConsumptionAssemblyTests.cs`

**Interfaces:**
- Consumes: `EnumWireFormat.ToWire<TEnum>` and `EnumWireFormat.Names<TEnum>` (slice 1);
  `PeakPower.Domain.Metering.MeteringDayState` (plan 2, shared contract §4).
- Produces:
  - `public static string PortalMappings.Wire(MeteringDayState value)`
  - `public static int ConsumptionReader.Rank(MeteringDayState state)`
  - `public static MeteringDayState ConsumptionReader.Worst(IEnumerable<MeteringDayState> states)`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Portal/ConsumptionAssemblyTests.cs`:

```csharp
using PeakPower.Api.Customer.Portal;
using PeakPower.Domain.Metering;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

/// <summary>
/// The pure half of the consumption read surface: no database, no HTTP, no container. This class
/// deliberately takes no fixture, so it costs nothing to run and can be the first thing anybody
/// runs after touching the assembly.
/// </summary>
public sealed class ConsumptionAssemblyTests
{
    [Fact]
    public void The_data_states_rank_no_data_worst_and_final_best()
    {
        ConsumptionReader.Rank(MeteringDayState.NoData).ShouldBe(0);
        ConsumptionReader.Rank(MeteringDayState.Partial).ShouldBe(1);
        ConsumptionReader.Rank(MeteringDayState.Provisional).ShouldBe(2);
        ConsumptionReader.Rank(MeteringDayState.Final).ShouldBe(3);
    }

    /// <summary>
    /// The worst state across a selection, which is what the envelope's <c>dataState</c> is
    /// (shared contract §10.1). Ordered pairs both ways round, so an implementation that returned
    /// "the first one" or "the last one" fails on one of them.
    /// </summary>
    [Fact]
    public void The_worst_state_across_a_selection_is_the_least_settled_one()
    {
        ConsumptionReader.Worst([MeteringDayState.Final, MeteringDayState.Partial])
            .ShouldBe(MeteringDayState.Partial);
        ConsumptionReader.Worst([MeteringDayState.Partial, MeteringDayState.Final])
            .ShouldBe(MeteringDayState.Partial);
        ConsumptionReader.Worst([MeteringDayState.Provisional, MeteringDayState.NoData])
            .ShouldBe(MeteringDayState.NoData);
        ConsumptionReader.Worst([MeteringDayState.Final, MeteringDayState.Final])
            .ShouldBe(MeteringDayState.Final);
    }

    /// <summary>
    /// An empty selection is NO_DATA, not FINAL. The fold starts at FINAL so that the first real
    /// state always wins, and an implementation that forgot to special-case "nothing at all" would
    /// report the most settled state in the system for a range that holds nothing — which is the
    /// single most misleading answer available.
    /// </summary>
    [Fact]
    public void A_selection_with_no_states_at_all_is_no_data_and_never_final()
    {
        ConsumptionReader.Worst([]).ShouldBe(MeteringDayState.NoData);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConsumptionAssemblyTests"`
Expected: FAIL to compile —
`error CS0246: The type or namespace name 'ConsumptionReader' could not be found`.

- [ ] **Step 3: Create `ConsumptionReader` with the ranking**

Create `src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionReader.cs`:

```csharp
using PeakPower.Domain.Metering;

namespace PeakPower.Api.Customer.Portal;

/// <summary>
/// The reads that <c>GET /api/v1/consumption/day</c> and <c>GET /api/v1/consumption/month</c>
/// share: resolving the caller's selection, the most recent date with data, the dense recent
/// data-state series, and the ordering of the four data states.
/// </summary>
/// <remarks>
/// Nothing in this file may bind <c>HttpContext</c> or <c>IHttpContextAccessor</c>; architecture
/// fact 6 reserves those for <c>PeakPower.Infrastructure.Web</c>, and <c>ICustomerContext</c> is
/// the only identity seam this host has. Nothing here reads the clock either — fact 5 reserves
/// that for <c>PeakPower.Infrastructure.Time</c>, so every date comes in as an argument.
/// </remarks>
public static class ConsumptionReader
{
    /// <summary>
    /// NO_DATA &lt; PARTIAL &lt; PROVISIONAL &lt; FINAL, shared contract §10.1.
    /// </summary>
    /// <remarks>
    /// An explicit switch and not <c>(int)state</c>. The declaration order of
    /// <see cref="MeteringDayState"/> happens to agree today, but a member inserted in the middle
    /// would silently reorder this — and the worst state is what every KPI on the consumption
    /// screen is labelled with, so a silent reorder mislabels a number the customer is invoiced
    /// on. The switch also fails to compile if a fifth member is ever added, which is the whole
    /// argument against a derivation.
    /// </remarks>
    public static int Rank(MeteringDayState state) => state switch
    {
        MeteringDayState.NoData => 0,
        MeteringDayState.Partial => 1,
        MeteringDayState.Provisional => 2,
        MeteringDayState.Final => 3,
        _ => throw new ArgumentOutOfRangeException(nameof(state), state, null),
    };

    /// <summary>
    /// The least settled state in the selection — what the envelope's <c>dataState</c> reports.
    /// An empty selection is <see cref="MeteringDayState.NoData"/>, never
    /// <see cref="MeteringDayState.Final"/>: a range that holds nothing must not read as the most
    /// settled state in the system.
    /// </summary>
    public static MeteringDayState Worst(IEnumerable<MeteringDayState> states)
    {
        var worst = MeteringDayState.Final;
        var seenAny = false;

        foreach (var state in states)
        {
            seenAny = true;
            if (Rank(state) < Rank(worst))
            {
                worst = state;
            }
        }

        return seenAny ? worst : MeteringDayState.NoData;
    }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConsumptionAssemblyTests"`
Expected: PASS — 3 tests.

- [ ] **Step 5: Mutation-verify the empty-selection case**

Change the last line of `Worst` to `return worst;` (dropping the `seenAny` fold) and delete the two
`seenAny` lines so the code still compiles:

```csharp
        foreach (var state in states)
        {
            if (Rank(state) < Rank(worst))
            {
                worst = state;
            }
        }

        return worst;
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~A_selection_with_no_states_at_all_is_no_data_and_never_final"`
Expected: FAIL with
`Shouldly.ShouldAssertException : ConsumptionReader.Worst([]) should be MeteringDayState.NoData but was MeteringDayState.Final`.

⚠ This is the mutation that matters, not the easy neighbour. Removing the `Rank` switch in favour
of `(int)state` would leave every one of these three tests green today, because the declaration
order agrees — which is exactly why `Rank` carries the argument in a comment rather than in a test
that cannot see the future member.

Restore the fold and re-run to green.

- [ ] **Step 6: Add `Wire(MeteringDayState)`**

In `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs`, after the `Wire(ConnectionStatus)`
method that ends at line 106, add:

```csharp
    /// <summary>
    /// The four data states of a (metering point, delivery date) [F02-R22].
    /// </summary>
    /// <remarks>
    /// There is no COMPLETE arm and there must never be one: F02 §6's state machine goes
    /// NO_DATA → PARTIAL → PROVISIONAL → FINAL, and integration-spec §8.3's word "Complete" is the
    /// CONDITION that moves a day to PROVISIONAL, not a fifth state. A COMPLETE member would also
    /// break migration 9's day-state column CHECK.
    /// </remarks>
    public static string Wire(MeteringDayState value) => value switch
    {
        MeteringDayState.NoData => "NO_DATA",
        MeteringDayState.Partial => "PARTIAL",
        MeteringDayState.Provisional => "PROVISIONAL",
        MeteringDayState.Final => "FINAL",
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, null),
    };
```

`PortalMappings.cs` already carries `using PeakPower.Domain.Metering;` at line 5 (for
`EanPoolEntry`), so no new `using` is needed.

- [ ] **Step 7: Hold the new spelling to `EnumWireFormat`**

In `tests/PeakPower.Integration.Tests/Portal/CompanyEndpointTests.cs`, in
`Every_wire_spelling_PortalMappings_produces_is_the_shared_converters_spelling`, add a seventh line
after the `ConnectionStatus` line at `:247`:

```csharp
        AssertEveryMemberAgrees<MeteringDayState>(PortalMappings.Wire);
```

and add the `using` if the file does not already have it:

```csharp
using PeakPower.Domain.Metering;
```

- [ ] **Step 8: Run it and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Every_wire_spelling_PortalMappings_produces_is_the_shared_converters_spelling"`
Expected: PASS — 1 test.

- [ ] **Step 9: Mutation-verify the spelling guard**

Change the first arm of `Wire(MeteringDayState)` to `MeteringDayState.NoData => "NODATA",`.

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Every_wire_spelling_PortalMappings_produces_is_the_shared_converters_spelling"`
Expected: FAIL with
`Shouldly.ShouldAssertException : members.Select(wire) should be ["NO_DATA", "PARTIAL", "PROVISIONAL", "FINAL"] but was ["NODATA", "PARTIAL", "PROVISIONAL", "FINAL"] difference [*NODATA*, ...]`
and the message *"PortalMappings.Wire(MeteringDayState) must agree with EnumWireFormat, which is
what every other response on both hosts is serialised through"*.

⚠ `NODATA` is the exact mistake a derivation makes, which is why it is the mutation. Restore
`NO_DATA` and re-run to green.

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs \
        src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionReader.cs \
        tests/PeakPower.Integration.Tests/Portal/ConsumptionAssemblyTests.cs \
        tests/PeakPower.Integration.Tests/Portal/CompanyEndpointTests.cs
git commit -m "feat(portal): add the data-state wire spelling and the worst-of ranking [F02-R22]

Rank() is an explicit switch and not (int)state: the declaration order agrees today,
but a member inserted in the middle would silently reorder the ranking, and the worst
state is the label on every KPI the customer reads a volume from.

Verified by dropping the empty-selection fold and watching Worst([]) report FINAL, and
by spelling NoData as NODATA and watching the EnumWireFormat guard name the difference.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The raw-SQL fixtures, the selection, and the 404 that is not a 403

Two halves that have to arrive together, because neither can be tested without the other.

**The fixtures are raw SQL on purpose, and that is a decision rather than laziness.** Shared
contract §5 pins the entity **type names and property names** of the seven new tables; it does not
pin a factory or a constructor for `IntervalReading`, `MeteringPointDayState` or `DailyPosition`,
and plan 2 owns whatever those turn out to be. §6 *does* pin every column name, type and CHECK
constraint, verbatim and frozen. So a fixture written against the columns compiles against plan 2
no matter how plan 2 shapes its C#, and a fixture written against a guessed
`IntervalReading.Create(...)` does not. It is also the arrangement style
`CustomerApiRouteTableTests.AttachMeteringPointAsync` already establishes for a different reason:
write on the owner connection, which row-level security does not apply to, because arranging
through the API would prove nothing about isolation when the API is what is under test.

**The selection resolves to 404 and never 403, and the reason is structural.** `db.MeteringPoints`
carries slice 1's global query filter, and the request is on a connection
`CustomerSessionMiddleware` has already dropped to `app_customer_role` with `app.customer_id` set.
Another company's metering point therefore arrives here as an **absent row** — indistinguishable
from an id that never existed — so `ApiResults.NotFound()` is not a policy choice made in the
handler, it is the only answer the handler can give. `[F13-R19]`.

**Files:**
- Create: `tests/PeakPower.Integration.Tests/Portal/ConsumptionFixtures.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionReader.cs`
- Test: `tests/PeakPower.Integration.Tests/Portal/ConsumptionReaderTests.cs`

**Interfaces:**
- Consumes: `CustomerApiFactory.ConnectionString`, `.CreateOwnerDbContext()`,
  `.SeedCustomerWithAccountAsync(legalName, kvk, email, password)` (slice 1);
  `IMarketCalendar.IntervalStart(DateOnly, int)` (plan 1); the frozen DDL of shared contract §6.4,
  §6.5, §6.6 and §6.7; `PortalMappings.Wire(MeteringDayState)` (Task 2);
  `ConsumptionReader.Worst` (Task 2); `DayStateDto` (Task 1).
- Produces:
  - `public static Task<IReadOnlyList<MeteringPoint>?> ConsumptionReader.ResolveAsync(PeakPowerDbContext db, Guid[] meteringPointIds, CancellationToken ct)`
  - `public static Task<DateOnly?> ConsumptionReader.LastDataDateAsync(PeakPowerDbContext db, IReadOnlyList<Guid> meteringPointIds, CancellationToken ct)`
  - `public static Task<IReadOnlyList<DayStateDto>> ConsumptionReader.RecentDayStatesAsync(PeakPowerDbContext db, Guid meteringPointId, DateOnly today, int days, CancellationToken ct)`
  - `public const int ConsumptionReader.MaximumMeteringPoints = 50`
  - `public const int ConsumptionReader.CustomerStripDays = 14`
  - `ConsumptionFixtures` with `MessageAsync`, `VersionAsync`, `ReadingsAsync`, `DayStateAsync`, `DailyPositionAsync`

- [ ] **Step 1: Write the fixtures**

Create `tests/PeakPower.Integration.Tests/Portal/ConsumptionFixtures.cs`:

```csharp
using System.Globalization;
using Dapper;
using Npgsql;
using PeakPower.Application.Abstractions;
using PeakPower.Domain.Metering;

namespace PeakPower.Integration.Tests.Portal;

/// <summary>
/// Writes the four metering tables the consumption read surface reads, on the OWNER connection.
/// </summary>
/// <remarks>
/// <para>
/// <b>Raw SQL, deliberately.</b> Shared contract §5 pins the entity type and property names of
/// migration 9's tables; it does not pin a constructor or factory for <c>IntervalReading</c>,
/// <c>MeteringPointDayState</c> or <c>DailyPosition</c>, and plan 2 owns whatever those become.
/// §6 does pin every column name, type and CHECK constraint, frozen. So an arrangement written
/// against the columns compiles against plan 2 however plan 2 shapes its C#, and one written
/// against a guessed <c>Create(...)</c> overload does not.
/// </para>
/// <para>
/// <b>The owner connection, deliberately.</b> Row-level security does not apply to it, which is
/// exactly what an arrangement needs: seeding through the API would prove nothing about isolation
/// when the API is what is under test. <c>CustomerApiRouteTableTests.AttachMeteringPointAsync</c>
/// already establishes the same pattern for the same reason.
/// </para>
/// <para>
/// Every version written here is <c>source = 'BRP_FEED'</c> and carries a real
/// <c>metering.inbound_message</c> row, because <c>ck_idv_brp_feed_has_message</c> requires the
/// message, the document id and the document timestamp all to be present. Writing MANUAL versions
/// instead would satisfy the constraints with three nulls and leave the read path never once
/// exercised against the shape it will actually see.
/// </para>
/// </remarks>
public sealed class ConsumptionFixtures(CustomerApiFactory factory)
{
    private readonly IMarketCalendar _calendar =
        (IMarketCalendar)factory.Services.GetService(typeof(IMarketCalendar))!;

    private async Task<NpgsqlConnection> OpenAsync(CancellationToken ct)
    {
        var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync(ct);
        return connection;
    }

    /// <summary>
    /// One stored inbound message from the seeded PVNED balance responsible party, already
    /// PROCESSED. Migration 1 seeds that row and <c>ix_brp_code</c> is unique on <c>code</c>, so
    /// this reads it rather than inserting one — a migration that stopped seeding it must fail
    /// here rather than be papered over by a row of this fixture's own.
    /// </summary>
    public async Task<Guid> MessageAsync(
        Guid correlationId, DateTimeOffset receivedAt, CancellationToken ct)
    {
        var id = Guid.CreateVersion7();

        await using var connection = await OpenAsync(ct);
        await connection.ExecuteAsync(
            """
            INSERT INTO metering.inbound_message
                   (id, brp_id, correlation_id, received_at, payload_hash, payload_bytes,
                    payload_uri, status, processed_at)
            VALUES (@id,
                    (SELECT id FROM metering.brp WHERE code = 'PVNED'),
                    @correlationId, @receivedAt, @payloadHash, @payloadBytes,
                    @payloadUri, 'PROCESSED', @receivedAt)
            """,
            new
            {
                id,
                correlationId,
                receivedAt,
                payloadHash = System.Security.Cryptography.SHA256.HashData(
                    correlationId.ToByteArray()),
                payloadBytes = 41_822L,
                payloadUri = $"file://{correlationId:N}.bin",
            });

        return id;
    }

    /// <summary>
    /// One interval data version for one (metering point, delivery date, direction).
    /// <paramref name="isCurrent"/> is a parameter and not a constant because
    /// <c>ux_idv_current</c> permits exactly one current version per that triple, and a test that
    /// wants to prove superseded rows are not double-counted has to be able to write one.
    /// </summary>
    public async Task<Guid> VersionAsync(
        Guid meteringPointId,
        Guid customerId,
        DateOnly deliveryDate,
        IntervalDirection direction,
        Guid inboundMessageId,
        Guid correlationId,
        DateTimeOffset receivedAt,
        short intervalCount,
        bool isCurrent,
        CancellationToken ct)
    {
        var id = Guid.CreateVersion7();

        await using var connection = await OpenAsync(ct);
        await connection.ExecuteAsync(
            """
            INSERT INTO metering.interval_data_version
                   (id, metering_point_id, customer_id, delivery_date, direction, source,
                    document_id, document_created, received_at, inbound_message_id,
                    correlation_id, interval_count, is_current)
            VALUES (@id, @meteringPointId, @customerId, @deliveryDate, @direction, 'BRP_FEED',
                    @documentId, @documentCreated, @receivedAt, @inboundMessageId,
                    @correlationId, @intervalCount, @isCurrent)
            """,
            new
            {
                id,
                meteringPointId,
                customerId,
                deliveryDate,
                direction = direction == IntervalDirection.Consumption ? "CONSUMPTION" : "PRODUCTION",
                documentId = id.ToString("D", CultureInfo.InvariantCulture),
                documentCreated = receivedAt.AddMinutes(-3),
                receivedAt,
                inboundMessageId,
                correlationId,
                intervalCount,
                isCurrent,
            });

        return id;
    }

    /// <summary>
    /// The points of one version. <paramref name="quantities"/> is keyed by position, so a caller
    /// can leave positions out — which is how every "missing interval" case in this suite is
    /// arranged. <c>interval_start</c> is resolved through the host's own
    /// <see cref="IMarketCalendar"/>, never by an add-fifteen-minutes loop here: a second copy of
    /// the DST mapping in a fixture would let a wrong mapping in the handler agree with a wrong
    /// mapping in the arrangement.
    /// </summary>
    public async Task ReadingsAsync(
        Guid versionId,
        Guid customerId,
        DateOnly deliveryDate,
        IReadOnlyDictionary<short, decimal> quantities,
        CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);

        foreach (var (pos, quantity) in quantities)
        {
            await connection.ExecuteAsync(
                """
                INSERT INTO metering.interval_reading
                       (version_id, delivery_date, customer_id, pos, interval_start, quantity_kwh)
                VALUES (@versionId, @deliveryDate, @customerId, @pos, @intervalStart, @quantity)
                """,
                new
                {
                    versionId,
                    deliveryDate,
                    customerId,
                    pos,
                    intervalStart = _calendar.IntervalStart(deliveryDate, pos),
                    quantity,
                });
        }
    }

    /// <summary>The materialised data state for one (metering point, delivery date) [F02-R22].</summary>
    public async Task DayStateAsync(
        Guid meteringPointId,
        Guid customerId,
        DateOnly deliveryDate,
        MeteringDayState state,
        short expectedIntervalCount,
        bool consumptionComplete,
        bool productionComplete,
        bool productionIsDeclaredZero,
        DateTimeOffset? lastCorrectedAt,
        CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await connection.ExecuteAsync(
            """
            INSERT INTO metering.metering_point_day_state
                   (metering_point_id, delivery_date, customer_id, state, expected_interval_count,
                    consumption_complete, production_complete, production_is_declared_zero,
                    finalised_at, last_corrected_at)
            VALUES (@meteringPointId, @deliveryDate, @customerId, @state, @expectedIntervalCount,
                    @consumptionComplete, @productionComplete, @productionIsDeclaredZero,
                    @finalisedAt, @lastCorrectedAt)
            """,
            new
            {
                meteringPointId,
                deliveryDate,
                customerId,
                state = PeakPower.Api.Customer.Portal.PortalMappings.Wire(state),
                expectedIntervalCount,
                consumptionComplete,
                productionComplete,
                productionIsDeclaredZero,
                finalisedAt = state == MeteringDayState.Final
                    ? (DateTimeOffset?)new DateTimeOffset(2026, 9, 1, 6, 0, 0, TimeSpan.Zero)
                    : null,
                lastCorrectedAt,
            });
    }

    /// <summary>
    /// One day's rollup [design §4.1]. <paramref name="offtakeKwh"/> and
    /// <paramref name="exportKwh"/> are separate parameters rather than derived from the three
    /// totals, because deriving them from daily totals is precisely the bug design §10 requires
    /// the rollup to be mutation-verified against — a fixture that derived them would agree with
    /// a wrong implementation.
    /// </summary>
    public async Task DailyPositionAsync(
        Guid meteringPointId,
        Guid customerId,
        DateOnly deliveryDate,
        decimal consumptionKwh,
        decimal productionKwh,
        decimal netUsageKwh,
        decimal offtakeKwh,
        decimal exportKwh,
        MeteringDayState dataState,
        Guid[] sourceVersionIds,
        CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await connection.ExecuteAsync(
            """
            INSERT INTO metering.daily_position
                   (metering_point_id, delivery_date, customer_id, consumption_kwh,
                    production_kwh, net_usage_kwh, offtake_kwh, export_kwh, data_state,
                    source_version_ids)
            VALUES (@meteringPointId, @deliveryDate, @customerId, @consumptionKwh,
                    @productionKwh, @netUsageKwh, @offtakeKwh, @exportKwh, @dataState,
                    @sourceVersionIds)
            """,
            new
            {
                meteringPointId,
                deliveryDate,
                customerId,
                consumptionKwh,
                productionKwh,
                netUsageKwh,
                offtakeKwh,
                exportKwh,
                dataState = PeakPower.Api.Customer.Portal.PortalMappings.Wire(dataState),
                sourceVersionIds,
            });
    }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Portal/ConsumptionReaderTests.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Api.Customer.Portal;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

/// <summary>
/// The three shared reads behind both consumption endpoints, exercised directly rather than
/// through HTTP so a failure names the query rather than a status code.
/// </summary>
public sealed class ConsumptionReaderTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private ConsumptionFixtures Fixtures => new(factory);

    private static int _kvkCounter = 52_000_000;

    private async Task<Guid> SeedCustomerAsync()
    {
        var kvk = Interlocked.Increment(ref _kvkCounter)
            .ToString(System.Globalization.CultureInfo.InvariantCulture);
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Reader {Guid.NewGuid():N}", kvk, $"{Guid.NewGuid():N}@example.nl",
            "correct-horse-battery");
        return account.CustomerId;
    }

    private async Task<Guid> AttachAsync(Guid customerId)
    {
        await using var db = factory.CreateOwnerDbContext();
        var brp = await db.Brps.SingleAsync(b => b.Code == "PVNED", Ct);

        var point = MeteringPoint.Attach(
            customerId,
            EanCode.Create(UniqueEan()).Value,
            brp.Id,
            ProductionExpectation.Unknown,
            expectationSource: null,
            name: "Reader target",
            description: null,
            gridOperator: "Stedin",
            capacityKw: 900m,
            address: null,
            validFrom: new DateOnly(2024, 1, 1)).Value;

        db.MeteringPoints.Add(point);
        await db.SaveChangesAsync(Ct);
        return point.Id;
    }

    /// <summary>
    /// customer.metering_point carries EXCLUDE USING gist (ean WITH =, validity WITH &amp;&amp;)
    /// from migration 1, so two connections in this suite sharing an EAN is a 23P01 rather than a
    /// test failure anybody can read.
    /// </summary>
    private static string UniqueEan() =>
        "8716872" + Random.Shared.NextInt64(0, 99_999_999_999L)
            .ToString("D11", System.Globalization.CultureInfo.InvariantCulture);

    [Fact]
    public async Task Resolving_a_selection_returns_the_points_in_the_order_they_were_asked_for()
    {
        var customerId = await SeedCustomerAsync();
        var first = await AttachAsync(customerId);
        var second = await AttachAsync(customerId);

        await using var db = factory.CreateOwnerDbContext();

        var resolved = await ConsumptionReader.ResolveAsync(db, [second, first], Ct);

        resolved.ShouldNotBeNull();
        resolved!.Select(point => point.Id).ShouldBe([second, first],
            "the envelope echoes meteringPointIds back, and echoing them in a different order " +
            "than they were asked for makes a client's own indexing wrong");
    }

    [Fact]
    public async Task Resolving_a_selection_with_an_unknown_id_returns_null_so_the_endpoint_can_answer_404()
    {
        var customerId = await SeedCustomerAsync();
        var mine = await AttachAsync(customerId);

        await using var db = factory.CreateOwnerDbContext();

        var resolved = await ConsumptionReader.ResolveAsync(db, [mine, Guid.CreateVersion7()], Ct);

        resolved.ShouldBeNull(
            "one unresolved id fails the whole selection: answering over the ids that DID " +
            "resolve would let a caller probe for existence one id at a time");
    }

    [Fact]
    public async Task Resolving_a_repeated_id_asks_the_database_once_and_answers_once()
    {
        var customerId = await SeedCustomerAsync();
        var mine = await AttachAsync(customerId);

        await using var db = factory.CreateOwnerDbContext();

        var resolved = await ConsumptionReader.ResolveAsync(db, [mine, mine], Ct);

        resolved.ShouldNotBeNull();
        resolved!.ShouldHaveSingleItem().Id.ShouldBe(mine,
            "a repeated id must not double every volume in the envelope");
    }

    [Fact]
    public async Task The_last_data_date_is_the_newest_day_that_is_not_no_data()
    {
        var customerId = await SeedCustomerAsync();
        var point = await AttachAsync(customerId);

        await Fixtures.DayStateAsync(point, customerId, new DateOnly(2026, 8, 12),
            MeteringDayState.Final, 96, true, true, false, null, Ct);
        await Fixtures.DayStateAsync(point, customerId, new DateOnly(2026, 8, 14),
            MeteringDayState.Provisional, 96, true, true, false, null, Ct);

        // The trap: a NO_DATA row is still a row. A MAX over delivery_date that forgot the state
        // predicate would report 2026-08-20 and send the chart's "jump to latest" to an empty day.
        await Fixtures.DayStateAsync(point, customerId, new DateOnly(2026, 8, 20),
            MeteringDayState.NoData, 96, false, false, false, null, Ct);

        await using var db = factory.CreateOwnerDbContext();

        var latest = await ConsumptionReader.LastDataDateAsync(db, [point], Ct);

        latest.ShouldBe(new DateOnly(2026, 8, 14));
    }

    [Fact]
    public async Task A_connection_with_no_states_at_all_has_no_last_data_date()
    {
        var customerId = await SeedCustomerAsync();
        var point = await AttachAsync(customerId);

        await using var db = factory.CreateOwnerDbContext();

        (await ConsumptionReader.LastDataDateAsync(db, [point], Ct)).ShouldBeNull();
    }

    [Fact]
    public async Task The_recent_state_series_is_dense_oldest_first_and_fills_gaps_with_no_data()
    {
        var customerId = await SeedCustomerAsync();
        var point = await AttachAsync(customerId);
        var today = new DateOnly(2026, 8, 14);

        await Fixtures.DayStateAsync(point, customerId, new DateOnly(2026, 8, 13),
            MeteringDayState.Provisional, 96, true, true, false, null, Ct);
        await Fixtures.DayStateAsync(point, customerId, new DateOnly(2026, 8, 1),
            MeteringDayState.Final, 96, true, true, false, null, Ct);

        // Outside the window on both sides, so a query with the wrong bounds shows up as a wrong
        // FIRST or LAST cell rather than as a count that still happens to be fourteen.
        await Fixtures.DayStateAsync(point, customerId, new DateOnly(2026, 7, 31),
            MeteringDayState.Final, 96, true, true, false, null, Ct);

        await using var db = factory.CreateOwnerDbContext();

        var series = await ConsumptionReader.RecentDayStatesAsync(db, point, today, 14, Ct);

        series.Count.ShouldBe(14);
        series[0].Date.ShouldBe(new DateOnly(2026, 8, 1), "oldest first, fourteen days back");
        series[13].Date.ShouldBe(today, "and today is the last cell");

        series[0].State.ShouldBe("FINAL");
        series[12].State.ShouldBe("PROVISIONAL");
        series[13].State.ShouldBe("NO_DATA",
            "a date with no stored state is carried as NO_DATA, not omitted — the strip draws a " +
            "fixed number of cells and cannot mark a day the payload does not mention");
        series.ShouldAllBe(entry => entry.Date >= new DateOnly(2026, 8, 1));
    }
}
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConsumptionReaderTests"`
Expected: FAIL to compile —
`error CS0117: 'ConsumptionReader' does not contain a definition for 'ResolveAsync'`,
and the same for `LastDataDateAsync` and `RecentDayStatesAsync`.

- [ ] **Step 4: Add the three reads to `ConsumptionReader`**

In `src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionReader.cs`, replace the `using` block and
add the three methods above `Rank`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Persistence;
```

and inside the class, before `Rank`:

```csharp
    /// <summary>
    /// How many connections one request may chart at once. A cap rather than none: the selection
    /// becomes an <c>IN</c> list against three tables, and an uncapped one is a request a caller
    /// can make arbitrarily expensive for free.
    /// </summary>
    public const int MaximumMeteringPoints = 50;

    /// <summary>Cells in the customer's data-quality strip on connection detail (ean-detail.svg).</summary>
    public const int CustomerStripDays = 14;

    /// <summary>
    /// The caller's own connections for every requested id, in the order requested, or
    /// <see langword="null"/> when ANY requested id does not resolve to one this company holds.
    /// </summary>
    /// <remarks>
    /// <para>
    /// No <c>customer_id</c> predicate here on purpose: the global query filter supplies it from
    /// <c>ICustomerContext</c>, and row-level security supplies it again in the database. Writing
    /// it out by hand would be a third, hand-maintained copy of the tenancy rule that could
    /// disagree with both.
    /// </para>
    /// <para>
    /// <b>Which is why the null is a 404 and not a 403.</b> Another company's connection arrives
    /// here as an ABSENT ROW, indistinguishable from an id that never existed, so the endpoint
    /// cannot tell the two apart even if it wanted to — [F13-R19] holds by construction rather
    /// than by care. And the whole selection fails on one miss rather than answering over the ids
    /// that did resolve: a partial answer would let a caller probe for the existence of another
    /// company's connection one id at a time, reading the difference off the volumes.
    /// </para>
    /// </remarks>
    public static async Task<IReadOnlyList<MeteringPoint>?> ResolveAsync(
        PeakPowerDbContext db, Guid[] meteringPointIds, CancellationToken cancellationToken)
    {
        // Distinct FIRST: a repeated id would otherwise be summed twice into every interval, and
        // the response would echo it twice as well.
        var requested = meteringPointIds.Distinct().ToArray();

        var points = await db.MeteringPoints
            .AsNoTracking()
            .Where(point => requested.Contains(point.Id))
            .ToListAsync(cancellationToken);

        if (points.Count != requested.Length)
        {
            return null;
        }

        var byId = points.ToDictionary(point => point.Id);
        return [.. requested.Select(id => byId[id])];
    }

    /// <summary>
    /// The most recent delivery date any of these connections holds data for — over all time, not
    /// only the range being charted, because it is what drives the chart's jump-to-latest
    /// [F03-R07]. Null when none of them has any.
    /// </summary>
    /// <remarks>
    /// The <c>State != NoData</c> predicate is load-bearing, not tidiness: <c>NO_DATA</c> is a
    /// STORED state, not the absence of a row [F02-R22], so a plain MAX over
    /// <c>delivery_date</c> would send jump-to-latest to an empty day and the customer would read
    /// the resulting gap as lost data.
    /// </remarks>
    public static async Task<DateOnly?> LastDataDateAsync(
        PeakPowerDbContext db,
        IReadOnlyList<Guid> meteringPointIds,
        CancellationToken cancellationToken)
    {
        // MaxAsync over a nullable projection rather than over DateOnly: SQL's MAX of no rows is
        // NULL, and this must answer null for a connection that has never received anything
        // rather than throw "sequence contains no elements".
        return await db.Set<MeteringPointDayState>()
            .AsNoTracking()
            .Where(state => meteringPointIds.Contains(state.MeteringPointId)
                            && state.State != MeteringDayState.NoData)
            .MaxAsync(state => (DateOnly?)state.DeliveryDate, cancellationToken);
    }

    /// <summary>
    /// The last <paramref name="days"/> days of data state for one connection, DENSE and oldest
    /// first, ending on <paramref name="today"/>.
    /// </summary>
    /// <remarks>
    /// A date with no stored row is carried as <c>NO_DATA</c> rather than omitted. The strip draws
    /// a fixed number of cells and cannot mark a day the payload does not mention — the same
    /// argument as the month envelope's density rule, and deliberately the opposite of the day
    /// envelope's absent-interval rule.
    /// </remarks>
    public static async Task<IReadOnlyList<DayStateDto>> RecentDayStatesAsync(
        PeakPowerDbContext db,
        Guid meteringPointId,
        DateOnly today,
        int days,
        CancellationToken cancellationToken)
    {
        var from = today.AddDays(-(days - 1));

        var stored = await db.Set<MeteringPointDayState>()
            .AsNoTracking()
            .Where(state => state.MeteringPointId == meteringPointId
                            && state.DeliveryDate >= from
                            && state.DeliveryDate <= today)
            .Select(state => new { state.DeliveryDate, state.State })
            .ToDictionaryAsync(row => row.DeliveryDate, row => row.State, cancellationToken);

        return
        [
            .. Enumerable.Range(0, days)
                .Select(offset => from.AddDays(offset))
                .Select(date => new DayStateDto(
                    date,
                    PortalMappings.Wire(
                        stored.TryGetValue(date, out var state) ? state : MeteringDayState.NoData)))
        ];
    }
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConsumptionReaderTests"`
Expected: PASS — 6 tests.

- [ ] **Step 6: Mutation-verify the one-miss-fails-the-selection rule**

Change `ResolveAsync` to answer over what it found:

```csharp
        var byId = points.ToDictionary(point => point.Id);
        return [.. requested.Where(byId.ContainsKey).Select(id => byId[id])];
```

(and delete the `if (points.Count != requested.Length) { return null; }` block so it still compiles).

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Resolving_a_selection_with_an_unknown_id_returns_null"`
Expected: FAIL with
`Shouldly.ShouldAssertException : resolved should be null but was [MeteringPoint]` and the message
*"one unresolved id fails the whole selection: answering over the ids that DID resolve would let a
caller probe for existence one id at a time"*.

⚠ This is the mutation the cross-tenant 404 in Task 5 actually rests on. A handler that answered
`200` over company A's own connection while silently dropping company B's would satisfy any test
written as "not 200 for company B's id alone", and would be an existence oracle for every
connection in the platform. Restore both lines and re-run to green.

- [ ] **Step 7: Mutation-verify the `NO_DATA` predicate on `LastDataDate`**

Delete `&& state.State != MeteringDayState.NoData` from `LastDataDateAsync`.

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~The_last_data_date_is_the_newest_day_that_is_not_no_data"`
Expected: FAIL with
`Shouldly.ShouldAssertException : latest should be 2026-08-14 but was 2026-08-20`.

⚠ Check the failure names **2026-08-20** — the seeded `NO_DATA` day. A failure naming any other
date means the arrangement did not write that row and the predicate was never actually exercised.
Restore and re-run to green.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionReader.cs \
        tests/PeakPower.Integration.Tests/Portal/ConsumptionFixtures.cs \
        tests/PeakPower.Integration.Tests/Portal/ConsumptionReaderTests.cs
git commit -m "feat(portal): resolve a consumption selection, 404 and never 403 [F13-R19]

ResolveAsync writes no customer_id predicate: the global query filter supplies it and
row-level security supplies it again, so another company's connection arrives as an
absent row and 404 holds by construction. One unresolved id fails the WHOLE selection
- a partial answer would be an existence oracle a caller could walk one id at a time.

The fixtures are raw SQL against migration 9's frozen column set rather than plan 2's
C# factories, which the shared contract does not pin.

Verified by answering over the ids that did resolve and watching the unknown-id test
report a resolved point, and by dropping the NO_DATA predicate and watching
LastDataDate report the seeded empty day 2026-08-20.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `ConsumptionDayAssembly` — presence, the declared zero, net usage, and the DST pass

The whole of the day envelope's arithmetic, as a pure function over already-loaded readings. It is
its own type and its own test class because every rule in it is a rule the customer is invoiced
under, and none of them should need a PostgreSQL container to argue about.

Five rules, each with a named test:

1. **An interval is present for a connection only if a reading was actually stored for it.** A
   declared zero does not manufacture one: `[F02-R25]` keeps a missing interval **absent**, and a
   position with no reading at all is a gap in the chart, not a zero on the axis.
2. **An interval is present in the aggregate only if it is present for EVERY selected connection**
   (shared contract §10.1). Summing over the subset that happened to arrive would report a total
   the customer never used.
3. **Where `production_expectation` is `NEVER`, production is a DECLARED `0.0`** taken from master
   data and net usage is therefore the consumption value `[F02-R33]` `[DEC-22]`. Where it is
   `EXPECTED` or `UNKNOWN` and no production reading exists, production is `null` and **net usage
   is null too** — it is missing when either side is missing, never "the other side's value"
   (position-and-coverage §2.1).
4. **`dstPass` is derived from `IMarketCalendar`, never from a literal position range and never
   from the UTC offset.** `IsDstDuplicate` reports the *second* pass; the first pass is the set of
   positions whose Amsterdam wall-clock time equals a duplicate's. Deriving it keeps
   `PeakPower.Infrastructure.Time` the single source of truth for the DST mapping (shared contract
   §7.5) instead of putting a second copy of `9..12` in a host.
5. **A summary total is the sum of what was measured, and `null` when nothing was** — never `0`,
   because `0.0` in this envelope means measured zero.

**Files:**
- Create: `src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionDayAssembly.cs`
- Test: `tests/PeakPower.Integration.Tests/Portal/ConsumptionAssemblyTests.cs` (modify — append)

**Interfaces:**
- Consumes: `IMarketCalendar.IntervalStart(DateOnly, int)`, `.IsDstDuplicate(DateOnly, int)`
  (plan 1); `ConsumptionIntervalDto`, `ConsumptionSummaryDto`, `ConsumptionMonthDayDto` (Task 1).
- Produces:
  - `public sealed record PointDayReadings(Guid MeteringPointId, bool ProductionIsDeclaredZero, IReadOnlyDictionary<short, decimal> Consumption, IReadOnlyDictionary<short, decimal> Production)`
  - `public static IReadOnlyList<ConsumptionIntervalDto> ConsumptionDayAssembly.Intervals(DateOnly date, int intervalCount, IReadOnlyList<PointDayReadings> points, IMarketCalendar calendar)`
  - `public static ConsumptionSummaryDto ConsumptionDayAssembly.Summarise(IReadOnlyList<ConsumptionIntervalDto> intervals, string dataState)`
  - `public static ConsumptionSummaryDto ConsumptionDayAssembly.Summarise(IReadOnlyList<ConsumptionMonthDayDto> days, string dataState)`

- [ ] **Step 1: Write the failing test**

Append to `tests/PeakPower.Integration.Tests/Portal/ConsumptionAssemblyTests.cs`, inside the class,
and add these `using` lines at the top of the file:

```csharp
using PeakPower.Application.Abstractions;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Infrastructure.Time;
```

```csharp
    /// <summary>
    /// The REAL calendar, not a stub. Its four slice-2 members are pure functions of a date and a
    /// position — no clock is read by any of them — so <c>TimeProvider.System</c> here buys
    /// determinism at no cost, and every assertion below is against
    /// <c>PeakPower.Infrastructure.Time</c>'s own DST mapping rather than against a second copy
    /// of it written in this file. Architecture fact 5 makes that mapping the single source of
    /// truth for parser, rollup and chart alike; a stub here would be exactly the second answer
    /// the fact exists to prevent.
    /// </summary>
    private static readonly IMarketCalendar Calendar = new MarketCalendar(TimeProvider.System);

    private const string AnyState = "PROVISIONAL";

    private static readonly DateOnly OrdinaryDay = new(2026, 8, 12);      // Wednesday, 96 intervals
    private static readonly DateOnly SpringForward = new(2026, 3, 29);    // 92 intervals
    private static readonly DateOnly FallBack = new(2026, 10, 25);        // 100 intervals

    private static PointDayReadings Point(
        bool declaredZero,
        IReadOnlyDictionary<short, decimal> consumption,
        IReadOnlyDictionary<short, decimal>? production = null) =>
        new(Guid.CreateVersion7(), declaredZero, consumption,
            production ?? new Dictionary<short, decimal>());

    private static Dictionary<short, decimal> Flat(int count, decimal value) =>
        Enumerable.Range(1, count).ToDictionary(pos => (short)pos, _ => value);

    [Fact]
    public void A_full_day_yields_one_entry_per_position_with_net_usage_per_interval()
    {
        var intervals = ConsumptionDayAssembly.Intervals(
            OrdinaryDay, 96,
            [Point(declaredZero: false, Flat(96, 180.0m), Flat(96, 20.0m))],
            Calendar);

        intervals.Count.ShouldBe(96);
        intervals[0].Pos.ShouldBe(1);
        intervals[95].Pos.ShouldBe(96);
        intervals[0].ConsumptionKwh.ShouldBe(180.0m);
        intervals[0].ProductionKwh.ShouldBe(20.0m);
        intervals[0].NetUsageKwh.ShouldBe(160.0m,
            "[DEC-22] net usage is consumption minus production, PER INTERVAL");
    }

    /// <summary>
    /// [F02-R25] / [F03-R06]. The three positions that were never stored are ABSENT — not zero,
    /// not null, not a placeholder object — so Intervals.Count is less than intervalCount and the
    /// chart draws the difference as a gap.
    /// </summary>
    [Fact]
    public void A_position_with_no_reading_at_all_is_absent_rather_than_zero()
    {
        var consumption = Flat(96, 180.0m);
        consumption.Remove(40);
        consumption.Remove(41);
        consumption.Remove(42);

        var intervals = ConsumptionDayAssembly.Intervals(
            OrdinaryDay, 96, [Point(declaredZero: false, consumption)], Calendar);

        intervals.Count.ShouldBe(93);
        intervals.Select(interval => interval.Pos).ShouldNotContain(40);
        intervals.Select(interval => interval.Pos).ShouldNotContain(41);
        intervals.Select(interval => interval.Pos).ShouldNotContain(42);
        intervals.Select(interval => interval.Pos).ShouldContain(39);
        intervals.Select(interval => interval.Pos).ShouldContain(43);
    }

    /// <summary>
    /// The EXPECTED connection whose production document never arrived. Every position has a
    /// consumption value and no production value, and net usage is missing on all of them —
    /// never "the consumption value", which is what an implementation that treated a missing
    /// series as zero would produce (position-and-coverage §2.1).
    /// </summary>
    [Fact]
    public void A_missing_production_series_leaves_production_and_net_usage_null()
    {
        var intervals = ConsumptionDayAssembly.Intervals(
            OrdinaryDay, 96, [Point(declaredZero: false, Flat(96, 180.0m))], Calendar);

        intervals.Count.ShouldBe(96);
        intervals[0].ConsumptionKwh.ShouldBe(180.0m);
        intervals[0].ProductionKwh.ShouldBeNull();
        intervals[0].NetUsageKwh.ShouldBeNull(
            "net usage is missing when EITHER side is missing, never the other side's value");
    }

    /// <summary>
    /// [F02-R33]: where production_expectation is NEVER, production for every interval is a
    /// DECLARED zero taken from master data, and net usage is therefore the consumption value
    /// [DEC-22]. The difference from the test above is one boolean, and it is the difference
    /// between a stated zero and an absence.
    /// </summary>
    [Fact]
    public void A_declared_zero_reports_production_as_zero_and_net_usage_as_the_consumption()
    {
        var intervals = ConsumptionDayAssembly.Intervals(
            OrdinaryDay, 96, [Point(declaredZero: true, Flat(96, 180.0m))], Calendar);

        intervals[0].ProductionKwh.ShouldBe(0.0m,
            "a declared zero is a stated value, not an absence [F01-R40]");
        intervals[0].NetUsageKwh.ShouldBe(180.0m);
    }

    /// <summary>
    /// The declared zero must not MANUFACTURE an interval. A NEVER connection with no reading at
    /// all on a position has a gap there like any other, or a day the pipeline never received
    /// would render as a full flat day at zero production and no consumption.
    /// </summary>
    [Fact]
    public void A_declared_zero_does_not_manufacture_an_interval_nothing_was_stored_for()
    {
        var consumption = Flat(96, 180.0m);
        consumption.Remove(7);

        var intervals = ConsumptionDayAssembly.Intervals(
            OrdinaryDay, 96, [Point(declaredZero: true, consumption)], Calendar);

        intervals.Count.ShouldBe(95);
        intervals.Select(interval => interval.Pos).ShouldNotContain(7);
    }

    [Fact]
    public void Several_connections_are_summed_per_position()
    {
        var intervals = ConsumptionDayAssembly.Intervals(
            OrdinaryDay, 96,
            [
                Point(declaredZero: false, Flat(96, 180.0m), Flat(96, 20.0m)),
                Point(declaredZero: false, Flat(96, 120.0m), Flat(96, 5.0m)),
            ],
            Calendar);

        intervals[0].ConsumptionKwh.ShouldBe(300.0m);
        intervals[0].ProductionKwh.ShouldBe(25.0m);
        intervals[0].NetUsageKwh.ShouldBe(275.0m);
    }

    /// <summary>
    /// Shared contract §10.1: an interval is present in the aggregate only if it is present for
    /// EVERY selected connection. Summing over the subset that happened to arrive would report a
    /// total the customer never used, and it would move as the missing document landed.
    /// </summary>
    [Fact]
    public void An_interval_missing_for_one_connection_is_absent_from_the_aggregate()
    {
        var second = Flat(96, 120.0m);
        second.Remove(50);

        var intervals = ConsumptionDayAssembly.Intervals(
            OrdinaryDay, 96,
            [Point(declaredZero: false, Flat(96, 180.0m)), Point(declaredZero: false, second)],
            Calendar);

        intervals.Count.ShouldBe(95);
        intervals.Select(interval => interval.Pos).ShouldNotContain(50);
    }

    /// <summary>
    /// [DEC-22] records that net usage MAY be negative when production exceeds consumption, and
    /// [DEC-23] settles the negative part as export. The assembly must not clamp it: an axis that
    /// accommodates negative net usage is [F03-R02], and clamping here would hide the case the
    /// chart exists to show.
    /// </summary>
    [Fact]
    public void Net_usage_goes_negative_when_production_exceeds_consumption()
    {
        var intervals = ConsumptionDayAssembly.Intervals(
            OrdinaryDay, 96,
            [Point(declaredZero: false, Flat(96, 10.0m), Flat(96, 25.0m))],
            Calendar);

        intervals[0].NetUsageKwh.ShouldBe(-15.0m);
    }

    /// <summary>
    /// The autumn fall-back Sunday. Pos 9-12 are the FIRST pass of 02:00-03:00 (+02:00) and Pos
    /// 13-16 the SECOND (+01:00); the chart labels them 02:00 A and 02:00 B from
    /// <c>dstPass</c> alone. Both the label and the offset are asserted, because a mapping that
    /// got the offsets right and the labels wrong would still put "02:00" on screen twice with no
    /// way to tell them apart.
    /// </summary>
    [Fact]
    public void The_autumn_duplicate_hour_is_labelled_A_then_B()
    {
        var intervals = ConsumptionDayAssembly.Intervals(
            FallBack, 100, [Point(declaredZero: false, Flat(100, 1.0m))], Calendar);

        intervals.Count.ShouldBe(100);

        var byPos = intervals.ToDictionary(interval => interval.Pos);

        byPos[8].DstPass.ShouldBeNull();
        byPos[9].DstPass.ShouldBe("A");
        byPos[12].DstPass.ShouldBe("A");
        byPos[13].DstPass.ShouldBe("B");
        byPos[16].DstPass.ShouldBe("B");
        byPos[17].DstPass.ShouldBeNull();

        byPos[9].Start.Offset.ShouldBe(TimeSpan.FromHours(2));
        byPos[13].Start.Offset.ShouldBe(TimeSpan.FromHours(1));
        byPos[9].Start.DateTime.TimeOfDay.ShouldBe(TimeSpan.FromHours(2));
        byPos[13].Start.DateTime.TimeOfDay.ShouldBe(TimeSpan.FromHours(2),
            "both passes read 02:00 on an Amsterdam clock — dstPass is the only thing that " +
            "distinguishes them, which is why the chart must not re-derive it from the offset");
    }

    [Fact]
    public void An_ordinary_day_and_a_spring_forward_day_carry_no_dst_pass_at_all()
    {
        ConsumptionDayAssembly
            .Intervals(OrdinaryDay, 96, [Point(false, Flat(96, 1.0m))], Calendar)
            .ShouldAllBe(interval => interval.DstPass == null);

        var spring = ConsumptionDayAssembly
            .Intervals(SpringForward, 92, [Point(false, Flat(92, 1.0m))], Calendar);

        spring.Count.ShouldBe(92);
        spring.ShouldAllBe(interval => interval.DstPass == null);
    }

    /// <summary>
    /// Every interval's <c>end</c> is the next one's <c>start</c>, and the last one's is fifteen
    /// minutes after its own start. Asserted on the fall-back day specifically: the interval that
    /// spans the transition is the one where "start plus fifteen minutes" and "the next start"
    /// differ in OFFSET, and reading the end off the next start is what keeps the wall-clock
    /// rendering right.
    /// </summary>
    [Fact]
    public void Each_interval_ends_where_the_next_one_starts()
    {
        var intervals = ConsumptionDayAssembly.Intervals(
            FallBack, 100, [Point(false, Flat(100, 1.0m))], Calendar);

        for (var index = 0; index < intervals.Count - 1; index++)
        {
            intervals[index].End.ShouldBe(intervals[index + 1].Start,
                $"position {intervals[index].Pos} must end where position " +
                $"{intervals[index + 1].Pos} begins");
        }

        intervals[^1].End.ShouldBe(intervals[^1].Start.AddMinutes(15));
    }

    [Fact]
    public void A_summary_totals_what_was_measured_and_is_null_when_nothing_was()
    {
        var measured = ConsumptionDayAssembly.Intervals(
            OrdinaryDay, 96,
            [Point(declaredZero: false, Flat(96, 10.0m), Flat(96, 4.0m))],
            Calendar);

        var summary = ConsumptionDayAssembly.Summarise(measured, AnyState);

        summary.ConsumptionKwh.ShouldBe(960.0m);
        summary.ProductionKwh.ShouldBe(384.0m);
        summary.NetUsageKwh.ShouldBe(576.0m);
        summary.DataState.ShouldBe(AnyState);

        var empty = ConsumptionDayAssembly.Summarise([], "NO_DATA");

        empty.ConsumptionKwh.ShouldBeNull(
            "a range that measured nothing totals null — 0.0 means measured zero");
        empty.ProductionKwh.ShouldBeNull();
        empty.NetUsageKwh.ShouldBeNull();
        empty.DataState.ShouldBe("NO_DATA");
    }

    /// <summary>
    /// The other side of the same rule, and the one an implementation using
    /// <c>Sum() == 0 ? null : Sum()</c> gets wrong: a day that really did measure zero on every
    /// interval totals <c>0.0</c>, not null. A connection shut for the summer is a measured zero,
    /// not an absence of data.
    /// </summary>
    [Fact]
    public void A_day_that_measured_zero_totals_zero_and_not_null()
    {
        var intervals = ConsumptionDayAssembly.Intervals(
            OrdinaryDay, 96,
            [Point(declaredZero: true, Flat(96, 0.0m))],
            Calendar);

        var summary = ConsumptionDayAssembly.Summarise(intervals, "FINAL");

        summary.ConsumptionKwh.ShouldBe(0.0m);
        summary.ProductionKwh.ShouldBe(0.0m);
        summary.NetUsageKwh.ShouldBe(0.0m);
    }

    /// <summary>
    /// A summary skips what was not measured rather than treating it as zero: a partial
    /// production series totals the positions it has, and the range's own dataState is what says
    /// the total is not the whole story.
    /// </summary>
    [Fact]
    public void A_summary_skips_the_series_that_is_missing_rather_than_scoring_it_zero()
    {
        var summary = ConsumptionDayAssembly.Summarise(
            ConsumptionDayAssembly.Intervals(
                OrdinaryDay, 96, [Point(declaredZero: false, Flat(96, 10.0m))], Calendar),
            "PARTIAL");

        summary.ConsumptionKwh.ShouldBe(960.0m);
        summary.ProductionKwh.ShouldBeNull();
        summary.NetUsageKwh.ShouldBeNull();
    }
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConsumptionAssemblyTests"`
Expected: FAIL to compile —
`error CS0246: The type or namespace name 'PointDayReadings' could not be found` and
`error CS0103: The name 'ConsumptionDayAssembly' does not exist in the current context`.

- [ ] **Step 3: Write the assembly**

Create `src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionDayAssembly.cs`:

```csharp
using PeakPower.Application.Abstractions;
using PeakPower.Contracts.Customer.Portal;

namespace PeakPower.Api.Customer.Portal;

/// <summary>
/// One connection's stored readings for one delivery date, already loaded and keyed by position.
/// </summary>
/// <param name="ProductionIsDeclaredZero">
/// The connection's <c>production_expectation</c> is <c>NEVER</c>, so production for every
/// interval of this date is a DECLARED zero from master data [F02-R33] rather than an absence
/// inferred as zero. It traces to its source, its setter and its date [F01-R40], which is what
/// <see cref="ProductionDeclarationDto"/> carries.
/// </param>
public sealed record PointDayReadings(
    Guid MeteringPointId,
    bool ProductionIsDeclaredZero,
    IReadOnlyDictionary<short, decimal> Consumption,
    IReadOnlyDictionary<short, decimal> Production);

/// <summary>
/// The day envelope's arithmetic: which positions are present, what each of the three volumes is
/// on them, which pass of the autumn duplicate hour they belong to, and the three totals.
/// </summary>
/// <remarks>
/// A pure function of its arguments and <see cref="IMarketCalendar"/> — no database, no HTTP, and
/// no clock (architecture fact 5 reserves the clock for
/// <c>PeakPower.Infrastructure.Time</c>). Every rule in here is a rule the customer is invoiced
/// under, so none of them should need a PostgreSQL container to argue about.
/// </remarks>
public static class ConsumptionDayAssembly
{
    private const int MinutesPerInterval = 15;

    /// <summary>
    /// The present intervals of <paramref name="date"/>, in position order, summed across
    /// <paramref name="points"/>.
    /// </summary>
    public static IReadOnlyList<ConsumptionIntervalDto> Intervals(
        DateOnly date,
        int intervalCount,
        IReadOnlyList<PointDayReadings> points,
        IMarketCalendar calendar)
    {
        var duplicateLocalTimes = DuplicateLocalTimes(date, intervalCount, calendar);
        var intervals = new List<ConsumptionIntervalDto>(intervalCount);

        for (var position = 1; position <= intervalCount; position++)
        {
            var pos = (short)position;

            // Start at zero and NULL the running total the first time a series is missing for any
            // connection. Sum-then-decide would need a second pass to tell "0 because nothing was
            // measured" from "0 because the meter read zero", and those are different answers.
            decimal? consumption = 0m;
            decimal? production = 0m;
            decimal? netUsage = 0m;
            var presentForEveryPoint = true;

            foreach (var point in points)
            {
                var hasConsumption = point.Consumption.TryGetValue(pos, out var consumed);
                var hasProduction = point.Production.TryGetValue(pos, out var produced);

                // The interval exists for this connection only if a reading was actually stored
                // for it. [F02-R25] keeps a missing interval ABSENT, and the check happens BEFORE
                // the declared zero below on purpose: a declared zero must not manufacture an
                // interval nothing was received for, or a day the pipeline never saw would render
                // as a full flat day.
                if (!hasConsumption && !hasProduction)
                {
                    presentForEveryPoint = false;
                    break;
                }

                // [F02-R33]: where production_expectation is NEVER, production is a DECLARED zero
                // taken from master data and net usage is therefore the consumption value
                // [DEC-22]. Where it is EXPECTED or UNKNOWN, a missing production series stays
                // missing - and net usage goes with it, because net usage is missing when EITHER
                // side is missing and is never the other side's value.
                if (!hasProduction && point.ProductionIsDeclaredZero)
                {
                    hasProduction = true;
                    produced = 0m;
                }

                consumption = hasConsumption && consumption is { } runningConsumption
                    ? runningConsumption + consumed
                    : null;

                production = hasProduction && production is { } runningProduction
                    ? runningProduction + produced
                    : null;

                netUsage = hasConsumption && hasProduction && netUsage is { } runningNetUsage
                    ? runningNetUsage + (consumed - produced)
                    : null;
            }

            // Shared contract §10.1: present in the aggregate only if present for EVERY selected
            // connection. Summing over the subset that arrived would report a total the customer
            // never used, and it would move as the missing document landed.
            if (!presentForEveryPoint)
            {
                continue;
            }

            var start = calendar.IntervalStart(date, position);

            // The NEXT position's start, not start + 15 minutes, for every interval but the last.
            // On the fall-back day the interval that spans the transition is the one where those
            // two differ in OFFSET; taking the next start is what keeps the wall-clock rendering
            // right on both sides of it.
            var end = position < intervalCount
                ? calendar.IntervalStart(date, position + 1)
                : start.AddMinutes(MinutesPerInterval);

            intervals.Add(new ConsumptionIntervalDto(
                position,
                start,
                end,
                DstPass(date, position, start, duplicateLocalTimes, calendar),
                consumption,
                production,
                netUsage));
        }

        return intervals;
    }

    /// <summary>
    /// The three totals of a day, each the sum of what was measured and <see langword="null"/>
    /// when nothing was.
    /// </summary>
    public static ConsumptionSummaryDto Summarise(
        IReadOnlyList<ConsumptionIntervalDto> intervals, string dataState) =>
        new(Total(intervals, interval => interval.ConsumptionKwh),
            Total(intervals, interval => interval.ProductionKwh),
            Total(intervals, interval => interval.NetUsageKwh),
            dataState);

    /// <summary>The month's counterpart, over daily rollups rather than intervals.</summary>
    public static ConsumptionSummaryDto Summarise(
        IReadOnlyList<ConsumptionMonthDayDto> days, string dataState) =>
        new(Total(days, day => day.ConsumptionKwh),
            Total(days, day => day.ProductionKwh),
            Total(days, day => day.NetUsageKwh),
            dataState);

    /// <summary>
    /// The sum of the non-null values, or null when there are none.
    /// </summary>
    /// <remarks>
    /// Not <c>Sum()</c>, which answers 0 for an empty sequence — and 0 in this envelope means
    /// MEASURED ZERO. A connection shut for the summer really did use zero, and a range with no
    /// data at all did not; the two must not print the same number.
    /// </remarks>
    private static decimal? Total<T>(IReadOnlyList<T> rows, Func<T, decimal?> value)
    {
        decimal? total = null;

        foreach (var row in rows)
        {
            if (value(row) is { } amount)
            {
                total = (total ?? 0m) + amount;
            }
        }

        return total;
    }

    /// <summary>
    /// The Amsterdam wall-clock times that occur twice on <paramref name="date"/>, read off the
    /// calendar rather than hard-coded.
    /// </summary>
    /// <remarks>
    /// <see cref="IMarketCalendar.IsDstDuplicate"/> reports the SECOND pass of the repeated hour
    /// only. The first pass is therefore the set of positions whose local time matches one of
    /// these. Deriving it keeps <c>PeakPower.Infrastructure.Time</c> the single source of truth
    /// for the DST mapping (shared contract §7.5) instead of putting a second copy of "positions
    /// 9 to 12" in an API host, where a change to the mapping would leave the two disagreeing and
    /// nothing would fail.
    /// </remarks>
    private static HashSet<TimeSpan> DuplicateLocalTimes(
        DateOnly date, int intervalCount, IMarketCalendar calendar)
    {
        var times = new HashSet<TimeSpan>();

        for (var position = 1; position <= intervalCount; position++)
        {
            if (calendar.IsDstDuplicate(date, position))
            {
                times.Add(calendar.IntervalStart(date, position).DateTime.TimeOfDay);
            }
        }

        return times;
    }

    /// <summary>
    /// <c>"A"</c> for the first pass of the autumn duplicate hour, <c>"B"</c> for the second,
    /// <see langword="null"/> everywhere else. The chart composes <c>02:00 A</c> / <c>02:00 B</c>
    /// from this and must never re-derive the pass from the UTC offset.
    /// </summary>
    private static string? DstPass(
        DateOnly date,
        int position,
        DateTimeOffset start,
        HashSet<TimeSpan> duplicateLocalTimes,
        IMarketCalendar calendar)
    {
        if (duplicateLocalTimes.Count == 0)
        {
            return null;
        }

        return calendar.IsDstDuplicate(date, position)
            ? "B"
            : duplicateLocalTimes.Contains(start.DateTime.TimeOfDay) ? "A" : null;
    }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConsumptionAssemblyTests"`
Expected: PASS — 16 tests (the 3 from Task 2 plus 13 here).

- [ ] **Step 5: Mutation-verify the presence rule against a declared zero**

Move the declared-zero substitution **above** the presence check — the natural-looking order, and
the one that manufactures data:

```csharp
                if (!hasProduction && point.ProductionIsDeclaredZero)
                {
                    hasProduction = true;
                    produced = 0m;
                }

                if (!hasConsumption && !hasProduction)
                {
                    presentForEveryPoint = false;
                    break;
                }
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~A_declared_zero_does_not_manufacture_an_interval"`
Expected: FAIL with
`Shouldly.ShouldAssertException : intervals.Count should be 95 but was 96`.

⚠ Check the count is **96 and not 95** — a NEVER connection would then report a full day for a date
the pipeline never received, with production flat at zero and no consumption, which reads on screen
as a working day rather than as a gap. Restore the original order and re-run to green.

- [ ] **Step 6: Mutation-verify the missing-series rule against `netUsageKwh`**

Change the `netUsage` line to treat a missing production series as zero — the "obvious"
implementation the specification names by hand:

```csharp
                netUsage = hasConsumption && netUsage is { } runningNetUsage
                    ? runningNetUsage + (consumed - produced)
                    : null;
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~A_missing_production_series_leaves_production_and_net_usage_null"`
Expected: FAIL with
`Shouldly.ShouldAssertException : intervals[0].NetUsageKwh should be null but was 180.0`
and the message *"net usage is missing when EITHER side is missing, never the other side's value"*.

⚠ The `A_declared_zero_reports_production_as_zero` test stays green through this mutation, and that
is the point: the two cases produce the same number and mean opposite things. Only the
missing-series test can tell them apart. Restore and re-run to green.

- [ ] **Step 7: Mutation-verify the DST pass derivation**

Replace the body of `DstPass` with the hard-coded range:

```csharp
        return position is >= 13 and <= 16 ? "B" : position is >= 9 and <= 12 ? "A" : null;
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~An_ordinary_day_and_a_spring_forward_day_carry_no_dst_pass_at_all"`
Expected: FAIL with
`Shouldly.ShouldAssertException : ConsumptionDayAssembly.Intervals(...) should satisfy the condition (interval) => interval.DstPass == null but does not`.

⚠ Mutate the case the assertion is actually for. `The_autumn_duplicate_hour_is_labelled_A_then_B`
stays **green** under this mutation, because on the fall-back day the literal happens to be right —
so verifying only against that test would certify a half-working implementation, which is the
failure CLAUDE.md records having shipped once. The ordinary-day test is the one that catches it.
Restore and re-run to green.

- [ ] **Step 8: Mutation-verify the null-versus-zero total**

Replace `Total` with the plain sum:

```csharp
    private static decimal? Total<T>(IReadOnlyList<T> rows, Func<T, decimal?> value) =>
        rows.Sum(value);
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~A_summary_totals_what_was_measured_and_is_null_when_nothing_was"`
Expected: FAIL with
`Shouldly.ShouldAssertException : empty.ConsumptionKwh should be null but was 0`
and the message *"a range that measured nothing totals null — 0.0 means measured zero"*.

Then check the neighbouring case still passes for the right reason: run
`dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~A_day_that_measured_zero_totals_zero_and_not_null"` under the
same mutation and expect PASS — the mutation collapses the two answers into one, and only the
first test can see it. Restore and re-run both to green.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionDayAssembly.cs \
        tests/PeakPower.Integration.Tests/Portal/ConsumptionAssemblyTests.cs
git commit -m "feat(portal): assemble the day envelope's intervals and totals [F02-R25] [F02-R33]

Four rules that are all invoiceable: a position with no stored reading is ABSENT, and
the declared zero is applied AFTER that check so it cannot manufacture one; net usage
is null when either side is missing and never the other side's value; the DST pass is
derived from IMarketCalendar rather than from a 9..12 literal; and a total is null when
nothing was measured, because 0.0 here means measured zero.

Verified four ways: moving the declared zero above the presence check made a NEVER
connection report 96 intervals for a day nothing arrived on; treating a missing
production series as zero made netUsageKwh read 180.0 where it must be null; hard-coding
the pass to 9..12 left the fall-back day green and turned the ORDINARY day red; and
Sum() made an empty range total 0 instead of null.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `GET /api/v1/consumption/day`

The endpoint, its registration, its three route-table literals, and the two assertions design §7.15
requires — asserted **against the raw JSON**, because a test that deserialises into
`ConsumptionDayResponse` cannot see a key the DTO does not have, which is exactly the class of
mistake being guarded against.

⚠ **`.RequireAuthorization()` and `.TenantScoped("metering-point")` are on the route in this
commit, with the cross-tenant test.** Design §8: the customer API connects as the database owner
and drops privilege only inside `CustomerSessionMiddleware`, which anonymous requests skip, so an
endpoint that forgets the first line runs as owner with both tenancy layers off. That bug reached
review once already on `CompanyEndpoints` — `GET /company/accounts` answered anonymous callers 200
with every company's people, commit `0a49a8d`.

⚠ **The metering points come from the query string, so this is a tenant-scoped route with no route
parameter**, and the cross-tenant probe in `CustomerApiRouteTableTests` reads it as a *collection*.
Its leak fact issues a bare `GET` at the route pattern and requires a 200 with a non-empty body —
which a route with required query parameters answers 400. That is why this task adds
`CustomerSampleQueries`, the exact counterpart of `CustomerSampleBodies`, with an empty string as a
positive declaration for the four routes that need none.

**Files:**
- Create: `src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionEndpoints.cs`
- Create: `tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleQueries.cs`
- Create: `tests/PeakPower.Integration.Tests/Portal/ConsumptionDayTests.cs`
- Modify: `src/Hosts/PeakPower.Api.Customer/Program.cs:480`
- Modify: `tests/PeakPower.Integration.Tests/Portal/ConsumptionFixtures.cs` (add `DeclareProductionAsync`)
- Modify: `tests/PeakPower.Integration.Tests/Tenancy/CustomerApiRouteTableTests.cs:74`, `:110`, `:187-248`, `:355-396`
- Modify: `tests/PeakPower.Integration.Tests/Contract/CustomerResponseMetadataTests.cs:79`

**Interfaces:**
- Consumes: `ConsumptionReader.ResolveAsync` / `.LastDataDateAsync` / `.Worst` /
  `.MaximumMeteringPoints` (Task 3); `ConsumptionDayAssembly.Intervals` / `.Summarise` and
  `PointDayReadings` (Task 4); `ConsumptionDayResponse`, `ConsumptionIntervalDto`,
  `ProductionDeclarationDto` (Task 1); `PortalMappings.Wire(MeteringDayState)` (Task 2) and
  `.Wire(ProductionExpectation)` / `.Wire(ProductionExpectationSource?)` (slice 1);
  `IMarketCalendar.ExpectedIntervalCount` (plan 1); `ApiResults` and
  `TenancyEndpointExtensions.TenantScoped` (slice 1);
  `IntervalDataVersion`, `IntervalReading`, `MeteringPointDayState` (plan 2).
- Produces:
  - `public static class ConsumptionEndpoints` — `IEndpointRouteBuilder MapConsumptionEndpoints(this IEndpointRouteBuilder routes)`
  - route `GET /api/v1/consumption/day`, named `GetConsumptionDay`
  - `public static class CustomerSampleQueries` — `IReadOnlyDictionary<string, Func<Guid, string>> All`, `const string NoQueryString`, `const string ProbeDate`, `const string ProbeMonth`

- [ ] **Step 1: Add the production-declaration fixture**

Append to `tests/PeakPower.Integration.Tests/Portal/ConsumptionFixtures.cs`, inside the class:

```csharp
    /// <summary>
    /// Records a connection's production expectation with its source, setter and date [F01-R40].
    /// </summary>
    /// <remarks>
    /// Raw SQL rather than a domain mutator for the reason this whole file is raw SQL: shared
    /// contract §6.2 pins the four column names migration 9 adds
    /// (<c>production_expectation_set_by</c>, <c>production_expectation_set_at</c>,
    /// <c>brp_assigned_at</c>, <c>first_production_observed_at</c>) and does not pin a method to
    /// set them. <c>first_production_observed_at</c> is deliberately left null: migration 9's
    /// <c>ck_mp_never_has_no_observed_production</c> makes NEVER-plus-observed-production
    /// unstorable, which is what forces [F02-R34]'s promotion into the same transaction rather
    /// than leaving a reading beside master data that disagrees with it.
    /// </remarks>
    public async Task DeclareProductionAsync(
        Guid meteringPointId,
        ProductionExpectation expectation,
        ProductionExpectationSource source,
        string setBy,
        DateTimeOffset setAt,
        CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await connection.ExecuteAsync(
            """
            UPDATE customer.metering_point
               SET production_expectation        = @expectation,
                   expectation_source            = @source,
                   production_expectation_set_by = @setBy,
                   production_expectation_set_at = @setAt
             WHERE id = @meteringPointId
            """,
            new
            {
                meteringPointId,
                expectation = PeakPower.Api.Customer.Portal.PortalMappings.Wire(expectation),
                source = PeakPower.Api.Customer.Portal.PortalMappings.Wire(source),
                setBy,
                setAt,
            });
    }
```

and add to that file's `using` block:

```csharp
using PeakPower.Domain.Customers;
```

- [ ] **Step 2: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Portal/ConsumptionDayTests.cs`:

```csharp
using System.Collections.Generic;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

/// <summary>
/// <c>GET /api/v1/consumption/day</c>, end to end against real PostgreSQL and the real host.
/// </summary>
/// <remarks>
/// Two facts here read the RAW JSON rather than a deserialised
/// <see cref="ConsumptionDayResponse"/>, and that is not fussiness: a test that deserialises
/// cannot see a key the DTO does not have, so it is structurally blind to the exact mistake
/// design §7.15 asks to be caught — an envelope that carries <c>blockKwh</c>, or a missing
/// interval serialised as a zero.
/// </remarks>
public sealed class ConsumptionDayTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static readonly DateOnly OrdinaryDay = new(2026, 8, 12);
    private static readonly DateOnly FallBack = new(2026, 10, 25);

    private ConsumptionFixtures Fixtures => new(factory);

    private static int _kvkCounter = 53_000_000;

    private sealed record SignedIn(HttpClient Client, Guid CustomerId);

    private async Task<SignedIn> SignedInAsync()
    {
        var kvk = Interlocked.Increment(ref _kvkCounter)
            .ToString(System.Globalization.CultureInfo.InvariantCulture);
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Day {Guid.NewGuid():N}", kvk, email, Password);

        var client = factory.CreateAnonymousClient();
        var signIn = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password), Ct);
        signIn.StatusCode.ShouldBe(HttpStatusCode.OK,
            "every fact in this class asserts through a signed-in client; a failed sign-in would " +
            "make them all assert against 401s");

        var body = await signIn.Content.ReadFromJsonAsync<SignInResponse>(Ct);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body!.AccessToken);

        return new SignedIn(client, account.CustomerId);
    }

    private async Task<Guid> AttachAsync(Guid customerId, ProductionExpectation expectation)
    {
        await using var db = factory.CreateOwnerDbContext();

        // Migration 1 seeds PVNED at a literal id and ix_brp_code is unique on `code`, so this
        // reads the row rather than inserting one - a second PVNED is a 23505.
        var brp = await db.Brps.SingleAsync(b => b.Code == "PVNED", Ct);

        var point = MeteringPoint.Attach(
            customerId,
            EanCode.Create(UniqueEan()).Value,
            brp.Id,
            expectation,
            expectationSource: null,
            name: "Day target",
            description: null,
            gridOperator: "Stedin",
            capacityKw: 900m,
            address: null,
            validFrom: new DateOnly(2024, 1, 1)).Value;

        db.MeteringPoints.Add(point);
        await db.SaveChangesAsync(Ct);
        return point.Id;
    }

    /// <summary>
    /// customer.metering_point carries EXCLUDE USING gist (ean WITH =, validity WITH &amp;&amp;)
    /// from migration 1, so two connections here sharing an EAN is a 23P01 rather than a test
    /// failure anybody can read.
    /// </summary>
    private static string UniqueEan() =>
        "8716873" + Random.Shared.NextInt64(0, 99_999_999_999L)
            .ToString("D11", System.Globalization.CultureInfo.InvariantCulture);

    private static Dictionary<short, decimal> Flat(int count, decimal value) =>
        Enumerable.Range(1, count).ToDictionary(pos => (short)pos, _ => value);

    /// <summary>One current version and its readings, for one direction of one day.</summary>
    private async Task<Guid> SeriesAsync(
        Guid pointId,
        Guid customerId,
        DateOnly date,
        IntervalDirection direction,
        short intervalCount,
        IReadOnlyDictionary<short, decimal> quantities,
        bool isCurrent = true)
    {
        var correlationId = Guid.CreateVersion7();
        var receivedAt = new DateTimeOffset(2026, 9, 1, 4, 0, 0, TimeSpan.Zero);
        var messageId = await Fixtures.MessageAsync(correlationId, receivedAt, Ct);

        var versionId = await Fixtures.VersionAsync(
            pointId, customerId, date, direction, messageId, correlationId, receivedAt,
            intervalCount, isCurrent, Ct);

        await Fixtures.ReadingsAsync(versionId, customerId, date, quantities, Ct);
        return versionId;
    }

    private static string DayUrl(DateOnly date, params Guid[] pointIds) =>
        $"/api/v1/consumption/day?date={date:yyyy-MM-dd}" +
        string.Concat(pointIds.Select(id => $"&meteringPointIds={id}"));

    /// <summary>Every property name anywhere in the document, however deeply nested.</summary>
    private static HashSet<string> PropertyNames(JsonElement element)
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        Walk(element);
        return names;

        void Walk(JsonElement node)
        {
            switch (node.ValueKind)
            {
                case JsonValueKind.Object:
                    foreach (var property in node.EnumerateObject())
                    {
                        names.Add(property.Name);
                        Walk(property.Value);
                    }

                    break;

                case JsonValueKind.Array:
                    foreach (var item in node.EnumerateArray())
                    {
                        Walk(item);
                    }

                    break;
            }
        }
    }

    // ------------------------------------------------------------------ the frozen key set

    /// <summary>
    /// Design §7.15, asserted against the RAW JSON. The published API-contract example is
    /// pre-[DEC-22]: it carries a gross-consumption summary, a block overlay and a day-ahead
    /// price. Blocks are F05/Phase 2 and every money figure is out under S2-D6, so none of these
    /// seven keys may appear — not as null, not as zero, not as an empty array. A test that
    /// deserialised into ConsumptionDayResponse could not see them at all.
    /// </summary>
    [Fact]
    public async Task The_day_envelope_carries_no_block_coverage_or_price_key_at_all()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId, ProductionExpectation.Unknown);
        await SeriesAsync(point, company.CustomerId, OrdinaryDay,
            IntervalDirection.Consumption, 96, Flat(96, 180.0m));
        await SeriesAsync(point, company.CustomerId, OrdinaryDay,
            IntervalDirection.Production, 96, Flat(96, 20.0m));

        var json = await company.Client.GetStringAsync(DayUrl(OrdinaryDay, point), Ct);
        using var document = JsonDocument.Parse(json);
        var names = PropertyNames(document.RootElement);

        string[] forbidden =
        [
            "blocks", "blockKwh", "netPositionKwh", "isPeak",
            "dayAheadPriceEurMwh", "coverageRatio", "surplusKwh",
        ];

        names.Intersect(forbidden, StringComparer.Ordinal).ToArray().ShouldBeEmpty(
            "shared contract §10.1 freezes this envelope without any of these keys. A zero here " +
            "is worse than an absence: the chart would draw a block overlay of nothing and the " +
            "KPI strip a coverage of 0%, both of which read as measurements.");

        // The non-vacuity floor. A response that failed, or that carried an empty object, would
        // pass the intersection above without a single key having been examined.
        names.ShouldContain("netUsageKwh",
            "per-interval netUsageKwh is the [DEC-22] basis and the reason this envelope was " +
            "trimmed rather than copied");
        names.ShouldContain("intervalCount");
        names.ShouldContain("dataState");
    }

    /// <summary>
    /// Design §7.15's second requirement, and the one §15.2 names as a mutation this plan must
    /// verify: a missing interval is ABSENT. Not zero, not null, not a placeholder object
    /// [F02-R25] [F03-R06].
    /// </summary>
    [Fact]
    public async Task A_missing_interval_is_absent_from_the_json_and_never_a_zero_or_a_null()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId, ProductionExpectation.Never);

        var consumption = Flat(96, 180.0m);
        consumption.Remove(40);
        consumption.Remove(41);

        await SeriesAsync(point, company.CustomerId, OrdinaryDay,
            IntervalDirection.Consumption, 96, consumption);

        var json = await company.Client.GetStringAsync(DayUrl(OrdinaryDay, point), Ct);
        using var document = JsonDocument.Parse(json);

        document.RootElement.GetProperty("intervalCount").GetInt32().ShouldBe(96,
            "the axis is still 96 slots long — it is intervals[] that is short");

        var intervals = document.RootElement.GetProperty("intervals").EnumerateArray().ToArray();
        intervals.Length.ShouldBe(94,
            "two positions were never received, so two entries are absent");

        var positions = intervals.Select(entry => entry.GetProperty("pos").GetInt32()).ToArray();
        positions.ShouldNotContain(40);
        positions.ShouldNotContain(41);
        positions.ShouldContain(39, "the positions either side are still there");
        positions.ShouldContain(42);

        // The half a length check cannot make: no entry ANYWHERE in the array may be a zeroed or
        // nulled placeholder. An implementation that emitted 96 entries with nulls at 40 and 41
        // would fail the length check; one that emitted 94 entries but zeroed some OTHER missing
        // position would not, and this is what catches it.
        foreach (var interval in intervals)
        {
            interval.GetProperty("consumptionKwh").ValueKind.ShouldBe(JsonValueKind.Number,
                $"position {interval.GetProperty("pos").GetInt32()} is present, so its " +
                "consumption is a measured number");
        }
    }

    // ------------------------------------------------------------------------ the envelope

    [Fact]
    public async Task A_full_day_reports_the_calendars_interval_count_and_the_three_series()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId, ProductionExpectation.Expected);
        await SeriesAsync(point, company.CustomerId, OrdinaryDay,
            IntervalDirection.Consumption, 96, Flat(96, 180.0m));
        await SeriesAsync(point, company.CustomerId, OrdinaryDay,
            IntervalDirection.Production, 96, Flat(96, 20.0m));
        await Fixtures.DayStateAsync(point, company.CustomerId, OrdinaryDay,
            MeteringDayState.Provisional, 96, true, true, false, null, Ct);

        var day = await company.Client.GetFromJsonAsync<ConsumptionDayResponse>(
            DayUrl(OrdinaryDay, point), Ct);

        day.ShouldNotBeNull();
        day!.Date.ShouldBe(OrdinaryDay);
        day.MeteringPointIds.ShouldBe([point]);
        day.IntervalCount.ShouldBe(96);
        day.DataState.ShouldBe("PROVISIONAL");
        day.Intervals.Count.ShouldBe(96);
        day.Intervals[0].NetUsageKwh.ShouldBe(160.0m);
        day.Summary.ConsumptionKwh.ShouldBe(17_280.0m);
        day.Summary.ProductionKwh.ShouldBe(1_920.0m);
        day.Summary.NetUsageKwh.ShouldBe(15_360.0m);
        day.Summary.DataState.ShouldBe("PROVISIONAL",
            "each KPI carries its range's own data state");
    }

    [Fact]
    public async Task A_day_nothing_was_received_for_is_no_data_with_an_empty_interval_array()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId, ProductionExpectation.Unknown);

        var day = await company.Client.GetFromJsonAsync<ConsumptionDayResponse>(
            DayUrl(OrdinaryDay, point), Ct);

        day!.DataState.ShouldBe("NO_DATA");
        day.Intervals.ShouldBeEmpty();
        day.IntervalCount.ShouldBe(96, "the axis is a property of the DATE, not of the data");
        day.Summary.ConsumptionKwh.ShouldBeNull("nothing was measured, so nothing totals");
        day.LastDataDate.ShouldBeNull();
        day.LastCorrectedAt.ShouldBeNull();
    }

    /// <summary>
    /// [F02-R33]: a NEVER connection's production is a stated zero traceable to its source, its
    /// setter and its date [F01-R40] — not a gap, and not an unlabelled flat line. That is the
    /// fifth of the five data-state treatments and the one most likely to be skipped.
    /// </summary>
    [Fact]
    public async Task A_never_connection_reports_a_declared_zero_with_its_provenance()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId, ProductionExpectation.Never);
        await Fixtures.DeclareProductionAsync(
            point, ProductionExpectation.Never, ProductionExpectationSource.CustomerDeclared,
            "p.devries@vandersteen.nl",
            new DateTimeOffset(2026, 7, 1, 8, 14, 0, TimeSpan.Zero), Ct);

        await SeriesAsync(point, company.CustomerId, OrdinaryDay,
            IntervalDirection.Consumption, 96, Flat(96, 180.0m));

        var day = await company.Client.GetFromJsonAsync<ConsumptionDayResponse>(
            DayUrl(OrdinaryDay, point), Ct);

        day!.ProductionIsDeclaredZero.ShouldBeTrue();
        day.Intervals[0].ProductionKwh.ShouldBe(0.0m);
        day.Intervals[0].NetUsageKwh.ShouldBe(180.0m);

        day.ProductionDeclaration.ShouldNotBeNull();
        day.ProductionDeclaration!.Expectation.ShouldBe("NEVER");
        day.ProductionDeclaration.Source.ShouldBe("CUSTOMER_DECLARED");
        day.ProductionDeclaration.SetBy.ShouldBe("p.devries@vandersteen.nl");
        day.ProductionDeclaration.SetAt.ShouldBe(
            new DateTimeOffset(2026, 7, 1, 8, 14, 0, TimeSpan.Zero));
    }

    /// <summary>
    /// The provenance is only true of ONE connection, so it is only offered for one. With several
    /// the four fields would have to be reconciled across connections that may disagree, and a
    /// reconciled provenance is not a provenance.
    /// </summary>
    [Fact]
    public async Task Several_connections_carry_no_production_declaration()
    {
        var company = await SignedInAsync();
        var first = await AttachAsync(company.CustomerId, ProductionExpectation.Never);
        var second = await AttachAsync(company.CustomerId, ProductionExpectation.Never);

        var day = await company.Client.GetFromJsonAsync<ConsumptionDayResponse>(
            DayUrl(OrdinaryDay, first, second), Ct);

        day!.ProductionIsDeclaredZero.ShouldBeTrue("both are NEVER, so the statement holds");
        day.ProductionDeclaration.ShouldBeNull();
    }

    [Fact]
    public async Task A_mixed_selection_is_not_a_declared_zero()
    {
        var company = await SignedInAsync();
        var never = await AttachAsync(company.CustomerId, ProductionExpectation.Never);
        var expected = await AttachAsync(company.CustomerId, ProductionExpectation.Expected);

        var day = await company.Client.GetFromJsonAsync<ConsumptionDayResponse>(
            DayUrl(OrdinaryDay, never, expected), Ct);

        day!.ProductionIsDeclaredZero.ShouldBeFalse(
            "true only when EVERY selected connection is NEVER — with a mixed selection the " +
            "statement is not true of the whole");
    }

    [Fact]
    public async Task The_envelope_reports_the_worst_state_across_the_selection()
    {
        var company = await SignedInAsync();
        var settled = await AttachAsync(company.CustomerId, ProductionExpectation.Unknown);
        var unsettled = await AttachAsync(company.CustomerId, ProductionExpectation.Unknown);

        await Fixtures.DayStateAsync(settled, company.CustomerId, OrdinaryDay,
            MeteringDayState.Final, 96, true, true, false, null, Ct);
        await Fixtures.DayStateAsync(unsettled, company.CustomerId, OrdinaryDay,
            MeteringDayState.Partial, 96, true, false, false, null, Ct);

        var day = await company.Client.GetFromJsonAsync<ConsumptionDayResponse>(
            DayUrl(OrdinaryDay, settled, unsettled), Ct);

        day!.DataState.ShouldBe("PARTIAL",
            "NO_DATA < PARTIAL < PROVISIONAL < FINAL, and the envelope reports the worst");
    }

    [Fact]
    public async Task The_envelope_carries_the_last_data_date_and_the_corrected_marker()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId, ProductionExpectation.Unknown);
        var corrected = new DateTimeOffset(2026, 8, 13, 9, 22, 41, TimeSpan.Zero);

        await Fixtures.DayStateAsync(point, company.CustomerId, OrdinaryDay,
            MeteringDayState.Provisional, 96, true, true, false, corrected, Ct);
        await Fixtures.DayStateAsync(point, company.CustomerId, new DateOnly(2026, 8, 14),
            MeteringDayState.Provisional, 96, true, true, false, null, Ct);

        var day = await company.Client.GetFromJsonAsync<ConsumptionDayResponse>(
            DayUrl(OrdinaryDay, point), Ct);

        day!.LastCorrectedAt.ShouldBe(corrected);
        day.LastDataDate.ShouldBe(new DateOnly(2026, 8, 14),
            "lastDataDate spans all time, not the day being charted — it is what drives the " +
            "chart's jump-to-latest [F03-R07]");
    }

    /// <summary>
    /// [F02-R18]: a superseded version is retained and stays queryable. It must never be summed
    /// alongside the version that replaced it, or a corrected day reads as double the volume.
    /// </summary>
    [Fact]
    public async Task A_superseded_version_is_not_counted_beside_the_current_one()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId, ProductionExpectation.Never);

        await SeriesAsync(point, company.CustomerId, OrdinaryDay,
            IntervalDirection.Consumption, 96, Flat(96, 500.0m), isCurrent: false);
        await SeriesAsync(point, company.CustomerId, OrdinaryDay,
            IntervalDirection.Consumption, 96, Flat(96, 180.0m));

        var day = await company.Client.GetFromJsonAsync<ConsumptionDayResponse>(
            DayUrl(OrdinaryDay, point), Ct);

        day!.Intervals[0].ConsumptionKwh.ShouldBe(180.0m,
            "the current version only — the superseded one is retained and queryable, never " +
            "added to it");
        day.Summary.ConsumptionKwh.ShouldBe(17_280.0m);
    }

    /// <summary>
    /// The autumn fall-back Sunday over HTTP, so the DST mapping is proven through the wire and
    /// not only in the assembly's unit test. A generic add-fifteen-minutes loop writes plausible
    /// data to the wrong times and nothing notices until an invoice does.
    /// </summary>
    [Fact]
    public async Task The_autumn_day_returns_a_hundred_intervals_labelled_A_and_B()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId, ProductionExpectation.Never);
        await SeriesAsync(point, company.CustomerId, FallBack,
            IntervalDirection.Consumption, 100, Flat(100, 1.0m));

        var day = await company.Client.GetFromJsonAsync<ConsumptionDayResponse>(
            DayUrl(FallBack, point), Ct);

        day!.IntervalCount.ShouldBe(100);
        day.Intervals.Count.ShouldBe(100);

        var byPos = day.Intervals.ToDictionary(interval => interval.Pos);
        byPos[9].DstPass.ShouldBe("A");
        byPos[13].DstPass.ShouldBe("B");
        byPos[8].DstPass.ShouldBeNull();
        byPos[17].DstPass.ShouldBeNull();
    }

    // -------------------------------------------------------------------------- refusals

    [Fact]
    public async Task A_request_naming_no_connection_is_400_and_says_which_field()
    {
        var company = await SignedInAsync();

        using var response = await company.Client.GetAsync(
            $"/api/v1/consumption/day?date={OrdinaryDay:yyyy-MM-dd}", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        response.Content.Headers.ContentType!.MediaType.ShouldBe("application/problem+json");

        var body = await response.Content.ReadAsStringAsync(Ct);
        using var document = JsonDocument.Parse(body);
        document.RootElement.GetProperty("errors").TryGetProperty("meteringPointIds", out _)
            .ShouldBeTrue("the 400 must name the offending field so a client can place the " +
                "message beside the right input");
    }

    [Fact]
    public async Task A_malformed_date_is_400_and_says_which_field()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId, ProductionExpectation.Unknown);

        using var response = await company.Client.GetAsync(
            $"/api/v1/consumption/day?date=12-08-2026&meteringPointIds={point}", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var body = await response.Content.ReadAsStringAsync(Ct);
        using var document = JsonDocument.Parse(body);
        document.RootElement.GetProperty("errors").TryGetProperty("date", out _).ShouldBeTrue();
    }

    // -------------------------------------------------------------------------- tenancy

    /// <summary>
    /// [F13-R19]. A 403 would confirm the connection exists; this asserts the stronger property,
    /// that the cross-tenant answer is byte-identical to the answer for an id that never existed.
    /// </summary>
    [Fact]
    public async Task Company_a_charting_company_bs_connection_is_404_and_never_403()
    {
        var owner = await SignedInAsync();
        var theirs = await AttachAsync(owner.CustomerId, ProductionExpectation.Unknown);
        await SeriesAsync(theirs, owner.CustomerId, OrdinaryDay,
            IntervalDirection.Consumption, 96, Flat(96, 180.0m));

        var stranger = await SignedInAsync();

        using var crossTenant = await stranger.Client.GetAsync(DayUrl(OrdinaryDay, theirs), Ct);
        using var nonexistent = await stranger.Client.GetAsync(
            DayUrl(OrdinaryDay, Guid.CreateVersion7()), Ct);

        crossTenant.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        crossTenant.StatusCode.ShouldNotBe(HttpStatusCode.Forbidden);
        nonexistent.StatusCode.ShouldBe(HttpStatusCode.NotFound);

        crossTenant.Content.Headers.ContentType?.ToString().ShouldBe(
            nonexistent.Content.Headers.ContentType?.ToString(),
            "a differing Content-Type is an existence oracle just as much as a differing body");

        var crossTenantBody = await crossTenant.Content.ReadAsStringAsync(Ct);
        var nonexistentBody = await nonexistent.Content.ReadAsStringAsync(Ct);

        crossTenantBody.ShouldBe(nonexistentBody,
            "a caller must not be able to tell 'someone else owns this' from 'this never existed'");
        crossTenantBody.ShouldNotBeNullOrWhiteSpace();

        // And the row is genuinely there and genuinely readable by its owner — otherwise a
        // handler that 404s unconditionally satisfies everything above perfectly.
        using var own = await owner.Client.GetAsync(DayUrl(OrdinaryDay, theirs), Ct);
        own.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    /// <summary>
    /// The mixed selection, which is the case a per-id check gets wrong: one of the caller's own
    /// connections beside one of somebody else's must be 404 for the WHOLE request. Answering
    /// over the ids that resolved would let a caller walk the platform's connections one id at a
    /// time, reading existence off whether the volumes moved.
    /// </summary>
    [Fact]
    public async Task A_selection_mixing_a_stranger_connection_with_an_own_one_is_404_entirely()
    {
        var owner = await SignedInAsync();
        var theirs = await AttachAsync(owner.CustomerId, ProductionExpectation.Unknown);

        var stranger = await SignedInAsync();
        var mine = await AttachAsync(stranger.CustomerId, ProductionExpectation.Unknown);

        using var response = await stranger.Client.GetAsync(DayUrl(OrdinaryDay, mine, theirs), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);

        using var ownOnly = await stranger.Client.GetAsync(DayUrl(OrdinaryDay, mine), Ct);
        ownOnly.StatusCode.ShouldBe(HttpStatusCode.OK,
            "its own connection on its own must still answer, or the 404 above proves nothing");
    }

    [Fact]
    public async Task The_day_endpoint_refuses_an_anonymous_caller()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId, ProductionExpectation.Unknown);

        using var anonymous = factory.CreateAnonymousClient();
        using var response = await anonymous.GetAsync(DayUrl(OrdinaryDay, point), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized,
            "this host connects as the database OWNER and drops to app_customer_role only inside " +
            "CustomerSessionMiddleware, which an anonymous request skips — so a route without " +
            "RequireAuthorization runs with both tenancy layers off. That is commit 0a49a8d.");
    }
}
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConsumptionDayTests"`
Expected: FAIL — every fact. The first assertion to blow up is in
`The_day_envelope_carries_no_block_coverage_or_price_key_at_all` with
`System.Net.Http.HttpRequestException: Response status code does not indicate success: 401 (Unauthorized)`
— **401 and not 404**, because the route is not mapped and the host's `FallbackPolicy` answers 401
for a request that matches no endpoint. That distinction is worth reading: a 404 here would mean
the route existed and refused, and a 401 means it does not exist yet.

- [ ] **Step 4: Write the endpoint**

Create `src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionEndpoints.cs`:

```csharp
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Infrastructure.Web.Http;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;

namespace PeakPower.Api.Customer.Portal;

/// <summary>
/// This company's own metering data: one day of 15-minute intervals [F03-R01] and one month of
/// daily totals [F03-R08].
/// </summary>
/// <remarks>
/// <para>
/// Nothing in this file may bind <c>HttpContext</c> or <c>IHttpContextAccessor</c>; architecture
/// fact 6 reserves those for <c>PeakPower.Infrastructure.Web</c>, and <c>ICustomerContext</c> is
/// the only identity seam this host has. Nor may it read the clock: fact 5 reserves that for
/// <c>PeakPower.Infrastructure.Time</c>, and <see cref="IMarketCalendar"/> is how a date, an
/// interval count and an interval's start instant are obtained.
/// </para>
/// <para>
/// <b>Both routes carry <c>.RequireAuthorization()</c> and <c>.TenantScoped("metering-point")</c>,
/// and neither is optional.</b> This host's connection logs in as the OWNER role, which bypasses
/// row-level security; <c>CustomerSessionMiddleware</c> is what drops an authenticated request to
/// <c>app_customer_role</c> and sets <c>app.customer_id</c>. A route without the first line never
/// reaches that middleware, so it runs with layer 2 bypassed AND layer 1 collapsed to
/// <c>true</c> — every company's readings, to anyone who asks. That is not hypothetical: it
/// happened on <c>GET /company/accounts</c> and reached review (commit 0a49a8d).
/// </para>
/// </remarks>
public static class ConsumptionEndpoints
{
    private const string Group = "/api/v1/consumption";

    /// <summary>
    /// What the cross-tenant probe substitutes another company's identifier for. It matches the
    /// kind <c>ConnectionEndpoints</c> already declares, because these routes name the same
    /// objects — a connection.
    /// </summary>
    private const string ResourceKind = "metering-point";

    public static IEndpointRouteBuilder MapConsumptionEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup(Group).WithTags("Consumption");

        group.MapGet("/day", DayAsync)
            .RequireAuthorization()
            .TenantScoped(ResourceKind)
            .WithName("GetConsumptionDay")
            .WithSummary("One Amsterdam day of 15-minute consumption, production and net usage.")
            .Produces<ConsumptionDayResponse>()
            // Keyed to "date" or "meteringPointIds" - see the handler. A client that wants to put
            // the message beside the right input needs that field in the schema, which
            // ProducesProblem alone would not give it.
            .ProducesValidationProblem()
            // One cause, and it is the tenancy answer: a requested connection that this company
            // does not hold. Byte-identical to the 404 for an id that never existed [F13-R19].
            .ProducesProblem(StatusCodes.Status404NotFound);

        return routes;
    }

    // ------------------------------------------------------------------------------ the day

    private static async Task<IResult> DayAsync(
        string? date,
        Guid[]? meteringPointIds,
        PeakPowerDbContext db,
        IMarketCalendar calendar,
        CancellationToken cancellationToken)
    {
        // Bound as a string and parsed here rather than as a DateOnly parameter: minimal-API
        // model binding answers a malformed value with a 400 that names no field, and a client
        // that cannot tell which of two query parameters it got wrong has to guess.
        if (!DateOnly.TryParseExact(
                date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None,
                out var deliveryDate))
        {
            return ApiResults.InvalidRequest(
                "date", "Give the day as yyyy-MM-dd, for example 2026-08-12.");
        }

        var selection = await SelectAsync(meteringPointIds, db, cancellationToken);
        if (selection.Failure is { } refusal)
        {
            return refusal;
        }

        var points = selection.Points!;
        var ids = points.Select(point => point.Id).ToArray();

        // 92, 96 or 100 — a property of the DATE, not of the data. The axis is this long even on
        // a day nothing was received for.
        var intervalCount = calendar.ExpectedIntervalCount(deliveryDate);

        // is_current only. [F02-R18] retains superseded versions and keeps them queryable; adding
        // them to the current one would make a corrected day read as double the volume.
        var versions = await db.Set<IntervalDataVersion>()
            .AsNoTracking()
            .Where(version => ids.Contains(version.MeteringPointId)
                              && version.DeliveryDate == deliveryDate
                              && version.IsCurrent)
            .Select(version => new
            {
                version.Id,
                version.MeteringPointId,
                version.Direction,
            })
            .ToListAsync(cancellationToken);

        var versionIds = versions.Select(version => version.Id).ToArray();

        // delivery_date is repeated in the predicate even though version_id already implies it:
        // interval_reading is RANGE-partitioned on delivery_date, and it is this equality that
        // lets PostgreSQL prune to a single monthly partition instead of scanning all thirty-six.
        var readings = await db.Set<IntervalReading>()
            .AsNoTracking()
            .Where(reading => reading.DeliveryDate == deliveryDate
                              && versionIds.Contains(reading.VersionId))
            .Select(reading => new { reading.VersionId, reading.Pos, reading.QuantityKwh })
            .ToListAsync(cancellationToken);

        var quantitiesByVersion = readings
            .GroupBy(reading => reading.VersionId)
            .ToDictionary(
                group => group.Key,
                group => (IReadOnlyDictionary<short, decimal>)group.ToDictionary(
                    reading => reading.Pos, reading => reading.QuantityKwh));

        var none = (IReadOnlyDictionary<short, decimal>)new Dictionary<short, decimal>();

        IReadOnlyDictionary<short, decimal> Series(Guid pointId, IntervalDirection direction)
        {
            // ux_idv_current permits exactly one current version per (point, date, direction), so
            // there is at most one match; FirstOrDefault rather than SingleOrDefault so a database
            // that somehow held two answers the request instead of throwing a 500 at a customer.
            var version = versions.FirstOrDefault(
                candidate => candidate.MeteringPointId == pointId
                             && candidate.Direction == direction);

            return version is not null && quantitiesByVersion.TryGetValue(version.Id, out var found)
                ? found
                : none;
        }

        var pointReadings = points
            .Select(point => new PointDayReadings(
                point.Id,
                // [F02-R33]. Read from master data, not from metering_point_day_state: the
                // declaration is true of the connection whether or not a day state row exists.
                point.ProductionExpectation == ProductionExpectation.Never,
                Series(point.Id, IntervalDirection.Consumption),
                Series(point.Id, IntervalDirection.Production)))
            .ToArray();

        var states = await db.Set<MeteringPointDayState>()
            .AsNoTracking()
            .Where(state => ids.Contains(state.MeteringPointId)
                            && state.DeliveryDate == deliveryDate)
            .Select(state => new { state.MeteringPointId, state.State, state.LastCorrectedAt })
            .ToListAsync(cancellationToken);

        // A connection with no state row for this date is NO_DATA, not absent from the fold:
        // otherwise a selection where one connection has nothing would report the OTHER
        // connection's state as the whole selection's.
        var dataState = ConsumptionReader.Worst(points.Select(point =>
            states.FirstOrDefault(state => state.MeteringPointId == point.Id)?.State
            ?? MeteringDayState.NoData));

        DateTimeOffset? lastCorrectedAt = null;
        foreach (var state in states)
        {
            if (state.LastCorrectedAt is { } corrected &&
                (lastCorrectedAt is null || corrected > lastCorrectedAt))
            {
                lastCorrectedAt = corrected;
            }
        }

        var intervals = ConsumptionDayAssembly.Intervals(
            deliveryDate, intervalCount, pointReadings, calendar);

        var wireState = PortalMappings.Wire(dataState);

        return Results.Ok(new ConsumptionDayResponse(
            deliveryDate,
            ids,
            intervalCount,
            wireState,
            await ConsumptionReader.LastDataDateAsync(db, ids, cancellationToken),
            lastCorrectedAt,
            // True only when EVERY selected connection is NEVER: with a mixed selection the
            // statement would not be true of the whole, and the chart would label a real
            // production series as a declared zero.
            points.All(point => point.ProductionExpectation == ProductionExpectation.Never),
            Declaration(points),
            intervals,
            ConsumptionDayAssembly.Summarise(intervals, wireState)));
    }

    // ---------------------------------------------------------------------------- plumbing

    /// <summary>
    /// The provenance of a single connection's production expectation [F02-R33] [F01-R40], or
    /// null when the selection is not a single connection.
    /// </summary>
    /// <remarks>
    /// Offered for exactly one connection on purpose. With several, the four fields would have to
    /// be reconciled across connections that may disagree about all four — and a reconciled
    /// provenance is not a provenance.
    /// </remarks>
    private static ProductionDeclarationDto? Declaration(IReadOnlyList<MeteringPoint> points) =>
        points.Count == 1
            ? new ProductionDeclarationDto(
                PortalMappings.Wire(points[0].ProductionExpectation),
                PortalMappings.Wire(points[0].ExpectationSource),
                points[0].ExpectationSetBy,
                points[0].ExpectationSetAt)
            : null;

    private readonly record struct Selection(
        IResult? Failure, IReadOnlyList<MeteringPoint>? Points);

    /// <summary>
    /// The caller's own connections for every requested id, or the refusal to return instead.
    /// </summary>
    private static async Task<Selection> SelectAsync(
        Guid[]? meteringPointIds, PeakPowerDbContext db, CancellationToken cancellationToken)
    {
        var requested = meteringPointIds ?? [];

        if (requested.Length == 0)
        {
            return new Selection(
                ApiResults.InvalidRequest(
                    "meteringPointIds", "Name at least one connection to chart."),
                null);
        }

        if (requested.Length > ConsumptionReader.MaximumMeteringPoints)
        {
            return new Selection(
                ApiResults.InvalidRequest(
                    "meteringPointIds",
                    "Chart at most " +
                    $"{ConsumptionReader.MaximumMeteringPoints} connections at once."),
                null);
        }

        var points = await ConsumptionReader.ResolveAsync(db, requested, cancellationToken);

        // ONE miss fails the whole request, with the SAME constant body an unknown id gets. A
        // partial answer would let a caller probe the platform's connections one id at a time,
        // reading existence off whether the volumes moved [F13-R19].
        return points is null
            ? new Selection(ApiResults.NotFound(), null)
            : new Selection(null, points);
    }
}
```

- [ ] **Step 5: Map it in the composition root**

In `src/Hosts/PeakPower.Api.Customer/Program.cs`, in the flat alphabetical list of portal groups,
add one line after `app.MapConnectionEndpoints();` at line 480:

```csharp
app.MapConsumptionEndpoints();
```

so the block reads:

```csharp
app.MapCompanyEndpoints();
app.MapConnectionEndpoints();
app.MapConsumptionEndpoints();
// The shared EAN pool [DEC-113]. Authenticated, but not one company's data.
app.MapEanPoolEndpoints();
```

- [ ] **Step 6: Run the day tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConsumptionDayTests"`
Expected: PASS — 15 tests.

- [ ] **Step 7: Add the query registry the leak probe needs**

Create `tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleQueries.cs`:

```csharp
namespace PeakPower.Integration.Tests.Tenancy;

/// <summary>
/// The query string the route-table leak probe appends to every tenant-scoped customer route with
/// a READ verb and no route parameter, keyed by the route pattern exactly as ASP.NET registers it.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this exists.</b>
/// <c>CustomerApiRouteTableTests.Signed_in_as_company_a_no_collection_leaks_a_company_b_identifier</c>
/// reads every such route whole and searches the body for another company's identifiers — and
/// requires a 200 with a non-empty body first, because a route answering 401 or 500 leaks nothing
/// and would pass the containment check without a single row having been read. A route with
/// REQUIRED query parameters answers 400 to a bare GET, which fails that check by name, which is
/// correct but useless: the leak was never probed. Registering the parameters is what puts it back
/// under the probe.
/// </para>
/// <para>
/// The value is a function of the SIGNED-IN COMPANY'S OWN metering point id, not a constant: the
/// probe signs in as a fresh company on every run, and a hard-coded id would answer 404 (the
/// tenancy answer) rather than render a body.
/// </para>
/// <para>
/// <see cref="NoQueryString"/> is a positive declaration ("this route needs no parameters"), not
/// an exemption — the route is still required to be in <see cref="All"/>, exactly as
/// <c>CustomerSampleBodies.NoRequestBody</c> is for a bodiless POST, and
/// <c>Every_tenant_scoped_customer_endpoint_can_actually_be_probed</c> fails by name on a route
/// that is missing from here and on an entry left behind by a route that was renamed.
/// </para>
/// </remarks>
public static class CustomerSampleQueries
{
    /// <summary>For a route the probe can read with no parameters at all. See the remarks.</summary>
    public const string NoQueryString = "";

    /// <summary>
    /// The day the probe charts. Any date works: a date with no readings answers 200 with
    /// <c>dataState: "NO_DATA"</c> and an empty <c>intervals</c> array, which is a rendered body
    /// and therefore a real leak probe.
    /// </summary>
    public const string ProbeDate = "2026-08-12";

    /// <summary>The month the probe charts, for the same reason.</summary>
    public const string ProbeMonth = "2026-08";

    public static IReadOnlyDictionary<string, Func<Guid, string>> All { get; } =
        new Dictionary<string, Func<Guid, string>>(StringComparer.Ordinal)
        {
            ["/api/v1/auth/me"] = _ => NoQueryString,
            ["/api/v1/company"] = _ => NoQueryString,
            ["/api/v1/company/accounts"] = _ => NoQueryString,
            ["/api/v1/metering-points"] = _ => NoQueryString,

            ["/api/v1/consumption/day"] =
                meteringPointId => $"?date={ProbeDate}&meteringPointIds={meteringPointId}",

            ["/api/v1/consumption/month"] =
                meteringPointId => $"?month={ProbeMonth}&meteringPointIds={meteringPointId}",
        };
}
```

⚠ The `/api/v1/consumption/month` entry is registered here, in this task, one task before the route
exists. That is deliberate and it is why the staleness check in Step 8 is written both ways: with
the entry present and the route absent,
`Every_tenant_scoped_customer_endpoint_can_actually_be_probed` fails by name until Task 6 lands the
route, which is exactly the reminder a half-finished pair should produce. If you are running this
plan strictly task by task, expect that one fact to be red between Step 8 here and Step 6 of Task 6.

- [ ] **Step 8: Move the three route-table literals**

In `tests/PeakPower.Integration.Tests/Tenancy/CustomerApiRouteTableTests.cs`:

**(a)** At `:73-74`, between `"GET /api/v1/company/accounts",` and `"GET /api/v1/ean-pool",`, insert:

```csharp
        // Tenant-scoped and parameterless: the connections are named in the QUERY string, so the
        // cross-tenant probe reaches these through CustomerSampleQueries rather than by
        // substituting an id into the path.
        "GET /api/v1/consumption/day",
        "GET /api/v1/consumption/month",
```

⚠ Ordinal order, which is what `RouteTable.Enumerate` sorts by: `company` < `company/accounts` <
`consumption/day` < `consumption/month` < `ean-pool`.

**(b)** At `:105-110`, replace the constant and its doc comment:

```csharp
    /// <summary>
    /// Tenant-scoped GET routes with no route parameter — the ones the leak probe reads whole and
    /// searches for another company's identifiers. Today: <c>/auth/me</c>, <c>/company</c>,
    /// <c>/company/accounts</c>, <c>/metering-points</c>, <c>/consumption/day</c> and
    /// <c>/consumption/month</c>. The last two name their connections in the query string, so
    /// each has an entry in <see cref="CustomerSampleQueries"/>.
    /// </summary>
    private const int TenantScopedCollectionGetCount = 6;
```

**(c)** In `Every_tenant_scoped_customer_endpoint_can_actually_be_probed`, add the collection-GET
half. At `:188`, beside `var mutating = new List<string>();`, add:

```csharp
        var collectionGets = new List<string>();
```

then, inside the `foreach` at `:231` — immediately after the closing brace of the
`if (!IsRead(entry))` block and before the loop's own closing brace — add:

```csharp
            if (IsRead(entry) && !entry.HasRouteParameter)
            {
                collectionGets.Add(entry.RoutePattern);

                if (!CustomerSampleQueries.All.ContainsKey(entry.RoutePattern))
                {
                    problems.Add(
                        $"{entry} is a tenant-scoped collection GET with no registered query " +
                        "string. Add one to CustomerSampleQueries - NoQueryString is a positive " +
                        "declaration that the route needs none - or the leak probe sends it " +
                        "without its required parameters, is answered 400, and finds no leak in " +
                        "a body that was never rendered.");
                }
            }
```

then, at `:241-244`, after `problems.AddRange(stale);` and **before** `problems.ShouldBeEmpty();`,
add the other direction:

```csharp
        problems.AddRange(CustomerSampleQueries.All.Keys
            .Where(pattern => !collectionGets.Contains(pattern, StringComparer.Ordinal))
            .Select(pattern => $"CustomerSampleQueries has a query for '{pattern}', which is not " +
                "a tenant-scoped collection GET on this host"));
```

and finally, after `mutating.Count.ShouldBe(...)` at `:246-248`, add:

```csharp
        collectionGets.Count.ShouldBe(CustomerSampleQueries.All.Count,
            "the query registry and the discovered collection GETs must be the same set, not " +
            "merely overlapping — otherwise this fact can pass over an empty enumeration");
```

**(d)** In `Signed_in_as_company_a_no_collection_leaks_a_company_b_identifier`, capture the
company's own connection at `:359` and use the registered query at `:376`:

```csharp
        var companyA = await SignedInAsync();
        var companyAPoint = await AttachMeteringPointAsync(companyA.CustomerId);
```

```csharp
            // The registered query string, built from THIS company's own connection. Looked up
            // rather than indexed so a missing entry is a named failure here as well as in
            // Every_tenant_scoped_customer_endpoint_can_actually_be_probed - xUnit gives no
            // ordering between the two, and a KeyNotFoundException names neither the route nor
            // the registry.
            if (!CustomerSampleQueries.All.TryGetValue(entry.RoutePattern, out var buildQuery))
            {
                failures.Add(
                    $"{entry} has no entry in CustomerSampleQueries, so the leak probe cannot " +
                    "render its body");
                continue;
            }

            using var response = await companyA.Client.GetAsync(
                entry.RoutePattern + buildQuery(companyAPoint), Ct);
```

⚠ The `continue` goes **after** `probed++`, so a missing entry is a failure rather than a quietly
smaller `probed` that then fails the count assertion with a message about vacuity instead of about
the registry.

- [ ] **Step 9: Add the two response-contract rows**

In `tests/PeakPower.Integration.Tests/Contract/CustomerResponseMetadataTests.cs`, in
`ExpectedResponseContract`, insert between the `GET /api/v1/company/accounts` row at `:78` and the
`GET /api/v1/ean-pool` row at `:79`:

```csharp
        // 400 for a malformed date or an empty/oversized meteringPointIds; 404 for a connection
        // this company does not hold, which is byte-identical to the 404 for an id that never
        // existed [F13-R19]. There is no 409: nothing here mutates.
        "GET /api/v1/consumption/day -> 200:ConsumptionDayResponse, "
        + "400:HttpValidationProblemDetails, 404:ProblemDetails",
        "GET /api/v1/consumption/month -> 200:ConsumptionMonthResponse, "
        + "400:HttpValidationProblemDetails, 404:ProblemDetails",
```

⚠ The month row is added here, one task early, for the same reason the query registry was: it keeps
the pair in one reviewable place. `The_declared_response_contract_is_exactly_the_set_this_class_reasons_about`
stays red until Task 6 maps the route.

- [ ] **Step 10: Run the whole tenancy and contract suites**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~CustomerApiRouteTableTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~CustomerResponseMetadataTests"
```
Expected: two facts RED and everything else green, and both reds name the month route —
`Every_tenant_scoped_customer_endpoint_can_actually_be_probed` with
*"CustomerSampleQueries has a query for '/api/v1/consumption/month', which is not a tenant-scoped
collection GET on this host"*, and
`The_declared_response_contract_is_exactly_the_set_this_class_reasons_about` with a difference at
the `GET /api/v1/consumption/month` row. Task 6 closes both.

- [ ] **Step 11: Mutation-verify the absent-key assertion — design §15.2 requires this one by name**

In `src/Core/PeakPower.Contracts/Customer/Portal/ConsumptionContracts.cs`, add a block field to
the summary:

```csharp
public sealed record ConsumptionSummaryDto(
    decimal? ConsumptionKwh,
    decimal? ProductionKwh,
    decimal? NetUsageKwh,
    string DataState,
    decimal? BlockKwh = null);      // ← the mutation
```

(a defaulted parameter, so no call site changes and the build stays green — a mutation that broke
the build would prove nothing about the assertion.)

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~The_day_envelope_carries_no_block_coverage_or_price_key_at_all"`
Expected: FAIL with
`Shouldly.ShouldAssertException : names.Intersect(forbidden, StringComparer.Ordinal).ToArray() should be empty but was ["blockKwh"]`
and the "a zero here is worse than an absence" message.

⚠ Check the failure names **`blockKwh`** in camelCase — the serialised name. A failure naming
`BlockKwh` would mean the walk collected CLR names rather than JSON property names and the guard
would be blind to a `[JsonPropertyName]` rename, which is the same "case-insensitive comparer in
front of a case-sensitive lookup" defect CLAUDE.md records having shipped three times.

Remove the mutation and re-run to green.

- [ ] **Step 12: Mutation-verify the missing-interval assertion — the second one §15.2 names**

In `ConsumptionDayAssembly.Intervals`, replace the `continue` that skips an absent position with a
zeroed entry — the "helpful" implementation:

```csharp
            if (!presentForEveryPoint)
            {
                var missingStart = calendar.IntervalStart(date, position);
                intervals.Add(new ConsumptionIntervalDto(
                    position,
                    missingStart,
                    position < intervalCount
                        ? calendar.IntervalStart(date, position + 1)
                        : missingStart.AddMinutes(MinutesPerInterval),
                    DstPass(date, position, missingStart, duplicateLocalTimes, calendar),
                    0m, 0m, 0m));
                continue;
            }
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~A_missing_interval_is_absent_from_the_json_and_never_a_zero_or_a_null"`
Expected: FAIL with
`Shouldly.ShouldAssertException : intervals.Length should be 94 but was 96` and the message
*"two positions were never received, so two entries are absent"*.

Now do it the other way, which is the failure a length check alone cannot see: change the three
zeros to `null, null, null` and re-run the same test. Expected: FAIL again, this time on
`intervals.Length should be 94 but was 96` — and then delete the two `consumption.Remove(...)`
lines from the test's arrangement temporarily and re-run: with a full day the length check passes
and **the per-entry `ValueKind` loop is what still holds**, so restore the removes and confirm the
loop's message
`position 40 is present, so its consumption is a measured number` is reachable by putting back
only the null variant with a `intervals.Length.ShouldBe(96)` local edit. Restore the assembly and
the test to their committed form and re-run to green.

⚠ Both halves matter and CLAUDE.md says why: mutate the case your assertion is actually for. A
length check catches "96 entries where 94 belong"; only the per-entry check catches "94 entries,
one of which is a placeholder for a different missing position".

- [ ] **Step 13: Mutation-verify the tenancy guard**

Remove `.RequireAuthorization()` from the `/day` route.

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~The_day_endpoint_refuses_an_anonymous_caller"`
Expected: **PASS**, because the host's `FallbackPolicy` still denies by default — and that is the
point of the next step, not a reason to stop. Now run
`dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~AnonymousEndpointAllowListTests"`:
expected PASS as well, for the same reason.

So mutate what the line actually buys. Restore `.RequireAuthorization()`, then remove
`.TenantScoped(ResourceKind)` instead and run
`dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~CustomerApiRouteTableTests"`.
Expected: FAIL with
`Shouldly.ShouldAssertException : undeclared should be empty but was ["GET /api/v1/consumption/day"]`
and the message *"every endpoint on the customer host must call .TenantScoped(kind), …"*, plus
`probed.ShouldBe(TenantScopedCollectionGetCount)` failing at 5 rather than 6.

⚠ The lesson to write into the commit message: **`.RequireAuthorization()` on this host is not what
locks the route — the fallback policy is** — and what the explicit call buys is the 401 in the
OpenAPI document, which `AuthenticationRequirementOperationTransformer` reads off this metadata and
a fallback policy leaves no trace of. Both lines stay; only one of them is provable by a 401.

Restore `.TenantScoped(ResourceKind)` and re-run to green.

- [ ] **Step 14: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionEndpoints.cs \
        src/Hosts/PeakPower.Api.Customer/Program.cs \
        tests/PeakPower.Integration.Tests/Portal/ConsumptionDayTests.cs \
        tests/PeakPower.Integration.Tests/Portal/ConsumptionFixtures.cs \
        tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleQueries.cs \
        tests/PeakPower.Integration.Tests/Tenancy/CustomerApiRouteTableTests.cs \
        tests/PeakPower.Integration.Tests/Contract/CustomerResponseMetadataTests.cs
git commit -m "feat(portal): GET /api/v1/consumption/day on the trimmed Phase-1 envelope

The route arrives with .RequireAuthorization(), .TenantScoped(\"metering-point\") and a
404-not-403 cross-tenant test in this commit, because design §8 records the customer
host connecting as database owner and dropping privilege only inside
CustomerSessionMiddleware - the omission that made GET /company/accounts answer
anonymous callers 200 with every company's people (0a49a8d).

Two assertions read the RAW JSON rather than a deserialised DTO: a test that
deserialises cannot see a key the DTO does not have, which is exactly the mistake
design §7.15 asks to be caught.

CustomerSampleQueries is new, and it is what keeps these two routes under the leak
probe: that probe issues a bare GET and requires a rendered 200, which a route with
required query parameters answers 400.

Verified: adding a defaulted BlockKwh to the summary turned the absent-key test red
naming 'blockKwh' in camelCase; emitting a zeroed entry for a missing position turned
the interval test red at 96 where 94 belong, and the per-entry ValueKind loop catches
the placeholder a length check cannot; and removing .TenantScoped left the route
undeclared in the route table while removing .RequireAuthorization changed nothing,
because the fallback policy is what locks it and the explicit call is what documents it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `GET /api/v1/consumption/month`

The month view, and the one place two rules in the shared contract deliberately disagree.

⚠ **Every day of the month is present in `days[]`, including days with no data**, carrying
`dataState: "NO_DATA"` and `null` volumes — the **opposite** of the day envelope's absent-interval
rule. `[F03-R10]` requires the month chart to mark missing days as **stubs, not short bars**, and
it cannot mark a day the payload does not mention. `days.length == dayCount` always. Shared
contract §16, item 7.

⚠ **The volumes come from `daily_position`, not from `interval_reading`.** That rollup exists so a
month is thirty-one rows rather than roughly three thousand, and `[NFR-04]` (a month view
interactive within 2 s) is what it is for. The **state** comes from `metering_point_day_state`
instead, because `[F02-R22]` gives every (connection, delivery date) a state whether or not a
rollup row was written for it, and reading the state off `daily_position` would silently report
`NO_DATA` for a day that is genuinely `PARTIAL`.

⚠ **A day's volumes are non-null only when EVERY selected connection has a rollup row for it** —
the same rule as the day envelope's aggregate presence, and for the same reason: a sum over the
subset that arrived is a total the customer never used, and it moves as the missing document lands.

**Files:**
- Modify: `src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionEndpoints.cs`
- Create: `tests/PeakPower.Integration.Tests/Portal/ConsumptionMonthTests.cs`

**Interfaces:**
- Consumes: everything Task 5 consumed, plus `DailyPosition` (plan 2) and
  `ConsumptionDayAssembly.Summarise(IReadOnlyList<ConsumptionMonthDayDto>, string)` (Task 4).
- Produces: route `GET /api/v1/consumption/month`, named `GetConsumptionMonth`.

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Portal/ConsumptionMonthTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

/// <summary>
/// <c>GET /api/v1/consumption/month</c>. The month envelope is DENSE where the day envelope is
/// sparse, and that inversion is the thing most likely to be "tidied up" by someone who read only
/// one of them.
/// </summary>
public sealed class ConsumptionMonthTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private ConsumptionFixtures Fixtures => new(factory);

    private static int _kvkCounter = 54_000_000;

    private sealed record SignedIn(HttpClient Client, Guid CustomerId);

    private async Task<SignedIn> SignedInAsync()
    {
        var kvk = Interlocked.Increment(ref _kvkCounter)
            .ToString(System.Globalization.CultureInfo.InvariantCulture);
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Month {Guid.NewGuid():N}", kvk, email, Password);

        var client = factory.CreateAnonymousClient();
        var signIn = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password), Ct);
        signIn.StatusCode.ShouldBe(HttpStatusCode.OK,
            "every fact in this class asserts through a signed-in client; a failed sign-in would " +
            "make them all assert against 401s");

        var body = await signIn.Content.ReadFromJsonAsync<SignInResponse>(Ct);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body!.AccessToken);

        return new SignedIn(client, account.CustomerId);
    }

    private async Task<Guid> AttachAsync(Guid customerId)
    {
        await using var db = factory.CreateOwnerDbContext();
        var brp = await db.Brps.SingleAsync(b => b.Code == "PVNED", Ct);

        var point = MeteringPoint.Attach(
            customerId,
            EanCode.Create(UniqueEan()).Value,
            brp.Id,
            ProductionExpectation.Unknown,
            expectationSource: null,
            name: "Month target",
            description: null,
            gridOperator: "Stedin",
            capacityKw: 900m,
            address: null,
            validFrom: new DateOnly(2024, 1, 1)).Value;

        db.MeteringPoints.Add(point);
        await db.SaveChangesAsync(Ct);
        return point.Id;
    }

    private static string UniqueEan() =>
        "8716874" + Random.Shared.NextInt64(0, 99_999_999_999L)
            .ToString("D11", System.Globalization.CultureInfo.InvariantCulture);

    private static string MonthUrl(string month, params Guid[] pointIds) =>
        $"/api/v1/consumption/month?month={month}" +
        string.Concat(pointIds.Select(id => $"&meteringPointIds={id}"));

    /// <summary>One rolled-up day: a state row and a daily_position row that agree.</summary>
    private async Task RolledUpDayAsync(
        Guid pointId,
        Guid customerId,
        DateOnly date,
        decimal consumption,
        decimal production,
        MeteringDayState state)
    {
        await Fixtures.DayStateAsync(
            pointId, customerId, date, state, 96, true, true, false, null, Ct);

        await Fixtures.DailyPositionAsync(
            pointId, customerId, date,
            consumption, production, consumption - production,
            // Offtake and export are passed rather than derived, because deriving them from the
            // daily totals is the exact bug design §10 requires the rollup to be verified against.
            offtakeKwh: consumption,
            exportKwh: production,
            state,
            [Guid.CreateVersion7()],
            Ct);
    }

    /// <summary>
    /// Shared contract §16 item 7 and [F03-R10]. Thirty-one entries for August, in order, with a
    /// NO_DATA stub carrying null volumes where nothing was rolled up. A month chart cannot mark
    /// a day the payload does not mention, so a sparse month envelope would draw a missing day as
    /// a short bar — which reads as a low-usage day, not as an absence.
    /// </summary>
    [Fact]
    public async Task Every_day_of_the_month_is_present_and_a_day_with_no_data_is_a_null_stub()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId);

        await RolledUpDayAsync(point, company.CustomerId, new DateOnly(2026, 8, 1),
            11_420.0m, 0.0m, MeteringDayState.Final);
        await RolledUpDayAsync(point, company.CustomerId, new DateOnly(2026, 8, 14),
            9_100.0m, 250.0m, MeteringDayState.Provisional);

        var month = await company.Client.GetFromJsonAsync<ConsumptionMonthResponse>(
            MonthUrl("2026-08", point), Ct);

        month.ShouldNotBeNull();
        month!.Month.ShouldBe("2026-08");
        month.DayCount.ShouldBe(31);
        month.Days.Count.ShouldBe(31, "days.length == dayCount, always");
        month.Days[0].Date.ShouldBe(new DateOnly(2026, 8, 1));
        month.Days[30].Date.ShouldBe(new DateOnly(2026, 8, 31));

        month.Days[0].DataState.ShouldBe("FINAL");
        month.Days[0].ConsumptionKwh.ShouldBe(11_420.0m);
        month.Days[0].NetUsageKwh.ShouldBe(11_420.0m);

        month.Days[13].DataState.ShouldBe("PROVISIONAL");
        month.Days[13].NetUsageKwh.ShouldBe(8_850.0m);

        var stub = month.Days[1];
        stub.Date.ShouldBe(new DateOnly(2026, 8, 2));
        stub.DataState.ShouldBe("NO_DATA");
        stub.ConsumptionKwh.ShouldBeNull(
            "null means missing; 0.0 would mean the connection measured zero that day, and the " +
            "month chart would draw a bar of height zero rather than a marked stub [F03-R10]");
        stub.ProductionKwh.ShouldBeNull();
        stub.NetUsageKwh.ShouldBeNull();
        stub.IntervalCount.ShouldBe(96);
    }

    /// <summary>
    /// The same rule asserted against the RAW JSON, because a deserialised
    /// <c>decimal?</c> cannot tell a <c>null</c> from an omitted key — and an omitted key is what
    /// a mapper that "tidied up" the stubs would produce.
    /// </summary>
    [Fact]
    public async Task A_no_data_day_carries_the_volume_keys_with_json_null_rather_than_omitting_them()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId);

        var json = await company.Client.GetStringAsync(MonthUrl("2026-02", point), Ct);
        using var document = JsonDocument.Parse(json);

        var days = document.RootElement.GetProperty("days").EnumerateArray().ToArray();
        days.Length.ShouldBe(28, "February 2026 is not a leap year");

        var first = days[0];
        first.GetProperty("dataState").GetString().ShouldBe("NO_DATA");
        first.GetProperty("consumptionKwh").ValueKind.ShouldBe(JsonValueKind.Null);
        first.GetProperty("productionKwh").ValueKind.ShouldBe(JsonValueKind.Null);
        first.GetProperty("netUsageKwh").ValueKind.ShouldBe(JsonValueKind.Null);
    }

    /// <summary>
    /// A DST month, so the per-day interval count is read from the calendar rather than assumed.
    /// October 2026 has thirty-one days, of which the 25th has a hundred intervals.
    /// </summary>
    [Fact]
    public async Task Each_day_carries_the_interval_count_its_own_date_has()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId);

        var month = await company.Client.GetFromJsonAsync<ConsumptionMonthResponse>(
            MonthUrl("2026-10", point), Ct);

        month!.Days.Count.ShouldBe(31);
        month.Days.Single(day => day.Date == new DateOnly(2026, 10, 25))
            .IntervalCount.ShouldBe(100, "the autumn fall-back Sunday");
        month.Days.Single(day => day.Date == new DateOnly(2026, 10, 24))
            .IntervalCount.ShouldBe(96);
    }

    [Fact]
    public async Task Several_connections_are_summed_per_day_and_only_where_every_one_rolled_up()
    {
        var company = await SignedInAsync();
        var first = await AttachAsync(company.CustomerId);
        var second = await AttachAsync(company.CustomerId);

        await RolledUpDayAsync(first, company.CustomerId, new DateOnly(2026, 8, 1),
            1_000.0m, 100.0m, MeteringDayState.Final);
        await RolledUpDayAsync(second, company.CustomerId, new DateOnly(2026, 8, 1),
            2_000.0m, 300.0m, MeteringDayState.Final);

        // Only the first connection rolled up on the 2nd, so the day is not a total.
        await RolledUpDayAsync(first, company.CustomerId, new DateOnly(2026, 8, 2),
            1_500.0m, 0.0m, MeteringDayState.Final);

        var month = await company.Client.GetFromJsonAsync<ConsumptionMonthResponse>(
            MonthUrl("2026-08", first, second), Ct);

        month!.Days[0].ConsumptionKwh.ShouldBe(3_000.0m);
        month.Days[0].ProductionKwh.ShouldBe(400.0m);
        month.Days[0].NetUsageKwh.ShouldBe(2_600.0m);
        month.Days[0].DataState.ShouldBe("FINAL");

        month.Days[1].ConsumptionKwh.ShouldBeNull(
            "one of the two connections has no rollup for this day, so the total would be a " +
            "figure the customer never used — and it would move as the other document landed");
        month.Days[1].DataState.ShouldBe("NO_DATA",
            "the connection with no state row counts as NO_DATA, and the day reports the worst");
    }

    [Fact]
    public async Task The_month_summary_totals_the_days_that_have_volumes()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId);

        await RolledUpDayAsync(point, company.CustomerId, new DateOnly(2026, 8, 1),
            100.0m, 10.0m, MeteringDayState.Final);
        await RolledUpDayAsync(point, company.CustomerId, new DateOnly(2026, 8, 2),
            200.0m, 20.0m, MeteringDayState.Partial);

        var month = await company.Client.GetFromJsonAsync<ConsumptionMonthResponse>(
            MonthUrl("2026-08", point), Ct);

        month!.Summary.ConsumptionKwh.ShouldBe(300.0m);
        month.Summary.ProductionKwh.ShouldBe(30.0m);
        month.Summary.NetUsageKwh.ShouldBe(270.0m);

        month.DataState.ShouldBe("NO_DATA",
            "twenty-nine days of August have nothing at all, and the envelope reports the worst " +
            "state across the whole range — the summary's own DataState says the same");
        month.Summary.DataState.ShouldBe("NO_DATA");
    }

    [Fact]
    public async Task A_month_with_nothing_at_all_totals_null_rather_than_zero()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId);

        var month = await company.Client.GetFromJsonAsync<ConsumptionMonthResponse>(
            MonthUrl("2026-08", point), Ct);

        month!.Summary.ConsumptionKwh.ShouldBeNull();
        month.Summary.NetUsageKwh.ShouldBeNull();
        month.DataState.ShouldBe("NO_DATA");
        month.Days.Count.ShouldBe(31, "still dense — thirty-one stubs");
    }

    [Fact]
    public async Task A_malformed_month_is_400_and_says_which_field()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId);

        using var response = await company.Client.GetAsync(
            $"/api/v1/consumption/month?month=August%202026&meteringPointIds={point}", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var body = await response.Content.ReadAsStringAsync(Ct);
        using var document = JsonDocument.Parse(body);
        document.RootElement.GetProperty("errors").TryGetProperty("month", out _).ShouldBeTrue();
    }

    [Fact]
    public async Task Company_a_charting_company_bs_connection_is_404_and_never_403()
    {
        var owner = await SignedInAsync();
        var theirs = await AttachAsync(owner.CustomerId);
        await RolledUpDayAsync(theirs, owner.CustomerId, new DateOnly(2026, 8, 1),
            100.0m, 0.0m, MeteringDayState.Final);

        var stranger = await SignedInAsync();

        using var crossTenant = await stranger.Client.GetAsync(MonthUrl("2026-08", theirs), Ct);
        using var nonexistent = await stranger.Client.GetAsync(
            MonthUrl("2026-08", Guid.CreateVersion7()), Ct);

        crossTenant.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        crossTenant.StatusCode.ShouldNotBe(HttpStatusCode.Forbidden);

        (await crossTenant.Content.ReadAsStringAsync(Ct)).ShouldBe(
            await nonexistent.Content.ReadAsStringAsync(Ct),
            "a caller must not be able to tell 'someone else owns this' from 'this never existed'");

        using var own = await owner.Client.GetAsync(MonthUrl("2026-08", theirs), Ct);
        own.StatusCode.ShouldBe(HttpStatusCode.OK,
            "the row is genuinely readable by its owner, or the 404 above proves nothing");
    }

    [Fact]
    public async Task The_month_endpoint_refuses_an_anonymous_caller()
    {
        var company = await SignedInAsync();
        var point = await AttachAsync(company.CustomerId);

        using var anonymous = factory.CreateAnonymousClient();
        using var response = await anonymous.GetAsync(MonthUrl("2026-08", point), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConsumptionMonthTests"`
Expected: FAIL — every fact, the first with
`System.Net.Http.HttpRequestException: Response status code does not indicate success: 401 (Unauthorized)`,
because the route is not mapped and the fallback policy answers a request that matches no endpoint.

- [ ] **Step 3: Map the route**

In `src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionEndpoints.cs`, inside
`MapConsumptionEndpoints`, after the `/day` registration and before `return routes;`:

```csharp
        group.MapGet("/month", MonthAsync)
            .RequireAuthorization()
            .TenantScoped(ResourceKind)
            .WithName("GetConsumptionMonth")
            .WithSummary("One calendar month of daily consumption, production and net usage.")
            .Produces<ConsumptionMonthResponse>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound);
```

- [ ] **Step 4: Write the handler**

In the same file, after `DayAsync` and before the `// plumbing` region:

```csharp
    // ---------------------------------------------------------------------------- the month

    private static async Task<IResult> MonthAsync(
        string? month,
        Guid[]? meteringPointIds,
        PeakPowerDbContext db,
        IMarketCalendar calendar,
        CancellationToken cancellationToken)
    {
        // Parsed as the first of the month with an explicit yyyy-MM format. "2026-8" and
        // "August 2026" are both refused, by design: the envelope echoes `month` straight back,
        // and echoing a spelling the client did not send is how two systems end up disagreeing
        // about which month they were talking about.
        if (!DateOnly.TryParseExact(
                month, "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None,
                out var firstOfMonth))
        {
            return ApiResults.InvalidRequest(
                "month", "Give the month as yyyy-MM, for example 2026-08.");
        }

        var selection = await SelectAsync(meteringPointIds, db, cancellationToken);
        if (selection.Failure is { } refusal)
        {
            return refusal;
        }

        var points = selection.Points!;
        var ids = points.Select(point => point.Id).ToArray();

        var dayCount = DateTime.DaysInMonth(firstOfMonth.Year, firstOfMonth.Month);
        var lastOfMonth = firstOfMonth.AddDays(dayCount - 1);

        // The STATE comes from metering_point_day_state and the VOLUMES from daily_position,
        // and they are two queries rather than one on purpose. [F02-R22] gives every
        // (connection, delivery date) a state whether or not a rollup row exists for it, so
        // reading the state off daily_position would report NO_DATA for a day that is genuinely
        // PARTIAL - which is the difference between "we have nothing" and "we have some of it".
        var states = await db.Set<MeteringPointDayState>()
            .AsNoTracking()
            .Where(state => ids.Contains(state.MeteringPointId)
                            && state.DeliveryDate >= firstOfMonth
                            && state.DeliveryDate <= lastOfMonth)
            .Select(state => new { state.MeteringPointId, state.DeliveryDate, state.State })
            .ToListAsync(cancellationToken);

        // daily_position, not interval_reading. The rollup exists so a month is thirty-one rows
        // rather than roughly three thousand, and [NFR-04] - month view interactive within two
        // seconds - is what it is for.
        var positions = await db.Set<DailyPosition>()
            .AsNoTracking()
            .Where(position => ids.Contains(position.MeteringPointId)
                               && position.DeliveryDate >= firstOfMonth
                               && position.DeliveryDate <= lastOfMonth)
            .Select(position => new
            {
                position.MeteringPointId,
                position.DeliveryDate,
                position.ConsumptionKwh,
                position.ProductionKwh,
                position.NetUsageKwh,
            })
            .ToListAsync(cancellationToken);

        var days = new List<ConsumptionMonthDayDto>(dayCount);

        for (var offset = 0; offset < dayCount; offset++)
        {
            var date = firstOfMonth.AddDays(offset);

            // A connection with no state row for this date counts as NO_DATA rather than being
            // left out of the fold: otherwise a day where one connection has nothing would report
            // the other connection's state as the whole selection's.
            var dayState = ConsumptionReader.Worst(points.Select(point =>
                states.FirstOrDefault(state => state.MeteringPointId == point.Id
                                               && state.DeliveryDate == date)?.State
                ?? MeteringDayState.NoData));

            var rolledUp = positions.Where(position => position.DeliveryDate == date).ToArray();

            // Non-null only when EVERY selected connection rolled up for this day. The same rule
            // as the day envelope's aggregate presence and for the same reason: a sum over the
            // subset that arrived is a total the customer never used, and it moves as the missing
            // document lands.
            var complete = rolledUp.Length == points.Count;

            days.Add(new ConsumptionMonthDayDto(
                date,
                // The axis length of the day this bar drills into [F03-R09], read from the
                // calendar per date - 100 on the autumn Sunday, 92 on the spring one.
                calendar.ExpectedIntervalCount(date),
                PortalMappings.Wire(dayState),
                complete ? rolledUp.Sum(position => position.ConsumptionKwh) : null,
                complete ? rolledUp.Sum(position => position.ProductionKwh) : null,
                complete ? rolledUp.Sum(position => position.NetUsageKwh) : null));
        }

        // Every day of the month is present, including the empty ones. Deliberately the OPPOSITE
        // of the day envelope's absent-interval rule: [F03-R10] requires missing days to be marked
        // as STUBS rather than drawn as short bars, and the chart cannot mark a day the payload
        // does not mention. Shared contract §16, item 7.
        var monthState = PortalMappings.Wire(
            ConsumptionReader.Worst(days.Select(day => EnumWireFormat.Parse<MeteringDayState>(
                day.DataState))));

        return Results.Ok(new ConsumptionMonthResponse(
            month!,
            ids,
            dayCount,
            monthState,
            await ConsumptionReader.LastDataDateAsync(db, ids, cancellationToken),
            days,
            ConsumptionDayAssembly.Summarise(days, monthState)));
    }
```

⚠ `EnumWireFormat.Parse<MeteringDayState>` throws on an unknown value, which is right here: the
strings being parsed back are the ones `PortalMappings.Wire` produced three lines earlier, so an
exception would mean the two disagree — a bug, not a bad request. Add
`using PeakPower.Infrastructure.Web.Http;` if the file does not already have it; it does, for
`ApiResults`.

⚠ `DateTime.DaysInMonth` is a static calculation, not a clock read: architecture fact 5 forbids
`DateTime.Now`, `DateTime.UtcNow`, `DateTimeOffset.Now`, `DateTimeOffset.UtcNow` and
`DateTime.Today`, and this is none of them. Run `dotnet test tests/PeakPower.Architecture.Tests`
after this task to see fact 5 confirm it rather than taking the sentence on trust.

- [ ] **Step 5: Run the month tests and watch them pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConsumptionMonthTests"`
Expected: PASS — 9 tests.

- [ ] **Step 6: Run the two facts Task 5 left red**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~CustomerApiRouteTableTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~CustomerResponseMetadataTests"
dotnet test tests/PeakPower.Architecture.Tests
```
Expected: all PASS. `TenantScopedCollectionGetCount` is now 6 and both consumption rows are in
`ExpectedRouteTable` and `ExpectedResponseContract`.

- [ ] **Step 7: Mutation-verify the density rule**

Change the day loop to skip empty days — the "tidier" month:

```csharp
            if (!complete)
            {
                continue;
            }

            days.Add(new ConsumptionMonthDayDto(...));
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Every_day_of_the_month_is_present_and_a_day_with_no_data_is_a_null_stub"`
Expected: FAIL with
`Shouldly.ShouldAssertException : month.Days.Count should be 31 but was 2` and the message
*"days.length == dayCount, always"*.

⚠ Then run
`dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~A_no_data_day_carries_the_volume_keys_with_json_null"`
under the same mutation and check it fails at `days.Length should be 28 but was 0` — the two facts
catch the same mutation from different sides, and the raw-JSON one is the only one that could also
catch a `[JsonIgnore(Condition = WhenWritingNull)]` on the volumes, which the deserialising fact
cannot see at all. Restore and re-run both to green.

- [ ] **Step 8: Mutation-verify the null-versus-zero rule**

Change the three volume expressions to coalesce:

```csharp
                rolledUp.Sum(position => position.ConsumptionKwh),
                rolledUp.Sum(position => position.ProductionKwh),
                rolledUp.Sum(position => position.NetUsageKwh)));
```

(dropping `complete` entirely so it still compiles — remove the `var complete = ...` line too).

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~A_no_data_day_carries_the_volume_keys_with_json_null"`
Expected: FAIL with
`Shouldly.ShouldAssertException : first.GetProperty("consumptionKwh").ValueKind should be JsonValueKind.Null but was JsonValueKind.Number`.

⚠ This is the mutation the whole slice exists to prevent: `0.0` in this envelope means the
connection **measured zero**, and a month chart drawing a zero-height bar for a day nothing arrived
on tells the customer their factory was shut. Restore and re-run to green.

- [ ] **Step 9: Mutation-verify the state source**

Change the day-state fold to read from `daily_position` instead:

```csharp
            var dayState = ConsumptionReader.Worst(
                rolledUp.Length == 0 ? [] : [MeteringDayState.Final]);
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~The_month_summary_totals_the_days_that_have_volumes"`
Expected: FAIL with
`Shouldly.ShouldAssertException : month.Days[1].DataState should be "PARTIAL" but was "FINAL"` —
the 2nd of August was rolled up as `PARTIAL` and reading the state off the rollup's presence
reports it as settled.

⚠ Check the failure names the **2nd**, the `PARTIAL` day. A failure on the 1st would mean the
arrangement never wrote a partial day and the mutation was caught by something else. Restore and
re-run to green.

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Customer/Portal/ConsumptionEndpoints.cs \
        tests/PeakPower.Integration.Tests/Portal/ConsumptionMonthTests.cs
git commit -m "feat(portal): GET /api/v1/consumption/month, dense where the day is sparse [F03-R08]

Every day of the month is present, NO_DATA days carrying null volumes - deliberately
the opposite of the day envelope's absent-interval rule, because [F03-R10] needs the
month chart to mark a missing day as a STUB and it cannot mark a day the payload does
not mention.

Volumes come from daily_position (the rollup exists for [NFR-04]) and the state from
metering_point_day_state, because [F02-R22] gives every day a state whether or not a
rollup row was written.

The route arrives with .RequireAuthorization(), .TenantScoped and its 404-not-403 test,
and closes the two route-table facts the day route left red.

Verified: skipping empty days made the month 2 entries where 31 belong; coalescing the
volumes made a NO_DATA day serialise consumptionKwh as a JSON number, which on screen
tells a customer their factory was shut; and reading the state off the rollup's presence
reported a PARTIAL 2 August as FINAL.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `LastDataDate` stops being null, and the two tests that pinned it are inverted

Slice 1 shipped `DateOnly? LastDataDate` on both connection DTOs and hard-coded it to `null` with a
comment saying so, because there was no metering data to point at. There is now.

⚠ **Two integration tests currently assert it is null, and both must be inverted in this commit or
the suite goes red for the right reason and stays red:**
`ConnectionListTests.cs:133` (`Last_data_date_is_null_because_ingestion_is_out_of_scope`) and
`ConnectionDetailTests.cs:128`. Read both before editing either; the list one is a whole test whose
name is now false, and the detail one is a single assertion inside a test about something else.

⚠ **`PortalContracts.cs:48-55`'s doc comment goes too.** It says `LastDataDate` "is ALWAYS null in
slice 1 and the portal says so rather than printing a plausible date". Leaving it is worse than a
stale comment: it is an instruction to the next reader to keep it null.

The list resolves every connection's latest date in **one grouped query** rather than one query per
row — the same shape `CustomerEndpoints.ListAsync` already uses for its account and connection
counts, and for the same reason: a correlated subquery per row per column is a round trip per row.

**Files:**
- Modify: `src/Core/PeakPower.Contracts/Customer/Portal/PortalContracts.cs:48-55`
- Modify: `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs:140-188`
- Modify: `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs:47-73`, `:92-117`, `:128-177`, `:335-340`
- Modify: `tests/PeakPower.Integration.Tests/Portal/ConnectionListTests.cs:124-134`
- Modify: `tests/PeakPower.Integration.Tests/Portal/ConnectionDetailTests.cs:94-129`

**Interfaces:**
- Consumes: `ConsumptionReader.LastDataDateAsync` (Task 3); `MeteringPointDayState` (plan 2).
- Produces:
  - `PortalMappings.ToSummary(MeteringPoint point, DateOnly today, DateOnly? lastDataDate)`
  - `PortalMappings.ToDetail(MeteringPoint point, string brpName, DateOnly today, DateOnly? lastDataDate)`

- [ ] **Step 1: Invert the two tests, and watch them fail**

In `tests/PeakPower.Integration.Tests/Portal/ConnectionListTests.cs`, replace the whole test at
`:124-134`:

```csharp
    /// <summary>
    /// Slice 2 populates <c>LastDataDate</c> from
    /// <c>max(metering_point_day_state.delivery_date) WHERE state &lt;&gt; 'NO_DATA'</c>.
    /// <para>
    /// This test replaces <c>Last_data_date_is_null_because_ingestion_is_out_of_scope</c>, whose
    /// name stopped being true the moment ingestion landed. The NO_DATA row seeded below is what
    /// makes the assertion mean something: NO_DATA is a STORED state, not the absence of a row
    /// [F02-R22], so a plain MAX over delivery_date would report 20 August and send the portal's
    /// "latest data" fact - and plan 7's jump-to-latest - to an empty day.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Last_data_date_is_the_newest_day_that_actually_holds_data()
    {
        var (client, customerId) = await SignedInAsync("Nolte Chemie", "69988771");
        var pointId = await AttachAsync(customerId, "871687100000000239", "Delfzijl works", null,
            new DateOnly(2024, 1, 1));

        var fixtures = new ConsumptionFixtures(factory);
        await fixtures.DayStateAsync(pointId, customerId, new DateOnly(2026, 8, 12),
            MeteringDayState.Final, 96, true, true, false, null, Ct);
        await fixtures.DayStateAsync(pointId, customerId, new DateOnly(2026, 8, 14),
            MeteringDayState.Provisional, 96, true, true, false, null, Ct);
        await fixtures.DayStateAsync(pointId, customerId, new DateOnly(2026, 8, 20),
            MeteringDayState.NoData, 96, false, false, false, null, Ct);

        var list = await client.GetFromJsonAsync<ConnectionListResponse>("/api/v1/metering-points", Ct);

        list!.Items.ShouldHaveSingleItem().LastDataDate.ShouldBe(new DateOnly(2026, 8, 14));
    }

    /// <summary>
    /// The other half, and the one that keeps the portal's <c>NO_DATA_YET</c> label reachable: a
    /// connection that has never received anything still carries null, and the portal prints the
    /// reason rather than a plausible date.
    /// </summary>
    [Fact]
    public async Task A_connection_that_has_received_nothing_still_carries_no_last_data_date()
    {
        var (client, customerId) = await SignedInAsync("Nolte Chemie Zuid", "69988772");
        await AttachAsync(customerId, "871687100000000246", "Sittard works", null,
            new DateOnly(2024, 1, 1));

        var list = await client.GetFromJsonAsync<ConnectionListResponse>("/api/v1/metering-points", Ct);

        list!.Items.ShouldHaveSingleItem().LastDataDate.ShouldBeNull();
    }
```

⚠ `AttachAsync` in that file currently returns `Task` — read `:47-49` and confirm. If it returns
nothing, change its declaration to `private async Task<Guid> AttachAsync(...)` and `return point.Id;`
at the end; every existing call site ignores the result and keeps compiling.

Add to that file's `using` block:

```csharp
using PeakPower.Domain.Metering;
```

In `tests/PeakPower.Integration.Tests/Portal/ConnectionDetailTests.cs`, in
`The_detail_carries_the_brp_the_expectation_and_the_address`, seed a state after the `AttachAsync`
at `:99` and replace the assertion at `:128`:

```csharp
        var id = await AttachAsync(customerId, "871687100000000027", "Venlo cold store");

        // Slice 2: LastDataDate is populated. Seeded here rather than left null so this test
        // asserts the real behaviour - the assertion below used to read ShouldBeNull() and was
        // true only because nothing wrote metering data.
        await new ConsumptionFixtures(factory).DayStateAsync(
            id, customerId, new DateOnly(2026, 8, 14),
            MeteringDayState.Provisional, 96, true, true, false, null, Ct);
```

```csharp
        detail.LastDataDate.ShouldBe(new DateOnly(2026, 8, 14),
            "[F02-R22] the newest delivery date this connection holds data for, no longer the " +
            "hard-coded null of slice 1");
```

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConnectionListTests|FullyQualifiedName~ConnectionDetailTests"`
Expected: FAIL — `Last_data_date_is_the_newest_day_that_actually_holds_data` with
`Shouldly.ShouldAssertException : list.Items.ShouldHaveSingleItem().LastDataDate should be 2026-08-14 but was null`,
and `The_detail_carries_the_brp_the_expectation_and_the_address` with the same shape.
`A_connection_that_has_received_nothing_still_carries_no_last_data_date` PASSES already, and that
is fine: it pins the half that must not change.

- [ ] **Step 2: Delete the stale contract comment**

In `src/Core/PeakPower.Contracts/Customer/Portal/PortalContracts.cs`, replace `:48-55`:

```csharp
/// <summary>
/// One connection as the list shows it [F01-R35].
/// <para>
/// <paramref name="LastDataDate"/> is the newest delivery date this connection holds data for —
/// <c>max(metering_point_day_state.delivery_date)</c> over the states that are not
/// <c>NO_DATA</c> [F02-R22]. It is null only for a connection that has genuinely received
/// nothing, and the portal prints the reason rather than a plausible date. It is also what
/// drives the chart's jump-to-latest [F03-R07].
/// </para>
/// </summary>
```

- [ ] **Step 3: Thread the date through the mappers**

In `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs`, replace `ToSummary` at `:140-163`:

```csharp
    /// <summary>
    /// One connection as the list shows it. <paramref name="today"/> comes from
    /// <c>IMarketCalendar.TodayInAmsterdam</c> and is passed in rather than read here: the
    /// status is derived from the validity window on every read [F01-R35], and a mapping that
    /// reached for the wall clock itself would make both the badge and its test a function of
    /// the machine's time zone. <paramref name="lastDataDate"/> is passed in for the same shape
    /// of reason - it is a query, and a query is the endpoint's job, not a mapping's.
    /// </summary>
    public static ConnectionSummaryDto ToSummary(
        MeteringPoint point, DateOnly today, DateOnly? lastDataDate) =>
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
            lastDataDate);
```

and `ToDetail` at `:165-188`:

```csharp
    /// <summary>
    /// One connection in full [F01-R38]. <paramref name="brpName"/> is passed in rather than
    /// read off <paramref name="point"/>: <c>MeteringPoint</c> holds only the BRP's id, and
    /// resolving it is a query, which is the endpoint's job and not a mapping's.
    /// <paramref name="lastDataDate"/> is a query for the same reason.
    /// </summary>
    public static ConnectionDetailDto ToDetail(
        MeteringPoint point, string brpName, DateOnly today, DateOnly? lastDataDate) =>
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
            lastDataDate);
```

- [ ] **Step 4: Populate it at all four call sites**

In `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs`:

**(a) The list**, at `:56-71` — one grouped query for the whole page, then the mapping:

```csharp
                var points = await db.MeteringPoints
                    .AsNoTracking()
                    .OrderBy(p => p.ValidFrom).ThenBy(p => p.Id)
                    .ToListAsync(cancellationToken);

                // One grouped query for every connection's newest date with data, not one query
                // per row: a correlated subquery here would be a round trip per row per column,
                // which is the shape CustomerEndpoints.ListAsync already avoids for its two
                // counts. No customer_id predicate for the same reason the query above has none -
                // the global query filter and row-level security each supply it.
                //
                // The State != NoData predicate is load-bearing: NO_DATA is a STORED state, not
                // the absence of a row [F02-R22], so a plain MAX would point the portal's
                // "latest data" fact at an empty day.
                var lastDataDates = await db.Set<MeteringPointDayState>()
                    .AsNoTracking()
                    .Where(state => state.State != MeteringDayState.NoData)
                    .GroupBy(state => state.MeteringPointId)
                    .Select(group => new
                    {
                        MeteringPointId = group.Key,
                        Latest = group.Max(state => state.DeliveryDate),
                    })
                    .ToDictionaryAsync(row => row.MeteringPointId, row => row.Latest,
                        cancellationToken);

                var matched = ConnectionSearch.Filter(points, q);
                var today = calendar.TodayInAmsterdam;

                var items = matched
                    .Select(p => PortalMappings.ToSummary(
                        p,
                        today,
                        lastDataDates.TryGetValue(p.Id, out var latest) ? latest : null))
                    .OrderBy(i => i.Name is null)
                    .ThenBy(i => i.DisplayLabel, StringComparer.OrdinalIgnoreCase)
                    .ToList();
```

**(b) The detail GET**, at `:115-117`:

```csharp
                var brpName = await BrpNameAsync(db, point.BrpId, cancellationToken);
                var lastDataDate = await ConsumptionReader.LastDataDateAsync(
                    db, [point.Id], cancellationToken);

                return Results.Ok(PortalMappings.ToDetail(
                    point, brpName, calendar.TodayInAmsterdam, lastDataDate));
```

**(c) The naming PATCH**, at `:174-177`:

```csharp
                var brpName = await BrpNameAsync(db, point.BrpId, cancellationToken);
                var lastDataDate = await ConsumptionReader.LastDataDateAsync(
                    db, [point.Id], cancellationToken);

                return Results.Ok(PortalMappings.ToDetail(
                    point, brpName, calendar.TodayInAmsterdam, lastDataDate));
```

**(d) The claim POST**, at `:339`:

```csharp
                // A connection claimed a moment ago has received nothing, so this resolves to
                // null - but it goes through the same helper rather than a hard-coded null, so
                // there is one definition of "latest date with data" on this host rather than
                // two that can drift.
                var lastDataDate = await ConsumptionReader.LastDataDateAsync(
                    db, [point.Id], cancellationToken);

                var detail = PortalMappings.ToDetail(
                    point, brp.Name, calendar.TodayInAmsterdam, lastDataDate);
                return Results.Created($"{Connections}/{point.Id}", detail);
```

and add to that file's `using` block:

```csharp
using PeakPower.Domain.Metering;
```

- [ ] **Step 5: Run the connection suites and watch them pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConnectionListTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConnectionDetailTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ClaimConnectionTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConnectionNamingTests"
```
Expected: all PASS.

- [ ] **Step 6: Mutation-verify the grouped query's state predicate**

Delete `.Where(state => state.State != MeteringDayState.NoData)` from the list's grouped query.

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Last_data_date_is_the_newest_day_that_actually_holds_data"`
Expected: FAIL with
`Shouldly.ShouldAssertException : list.Items.ShouldHaveSingleItem().LastDataDate should be 2026-08-14 but was 2026-08-20`.

⚠ Check it names **2026-08-20**, the seeded `NO_DATA` day. This is the same mutation Task 3 ran
against `LastDataDateAsync`, and it has to be run again here because this query is a **second
implementation of the same rule** — the list needs a grouped shape and the detail a scalar one, so
there are two places to get it wrong and each needs its own red. Restore and re-run to green.

- [ ] **Step 7: Mutation-verify that the list is still one query per page**

This one is measured rather than asserted, and the measurement is the point. With
`ConnectionListTests` running, set `Logging:LogLevel:Microsoft.EntityFrameworkCore.Database.Command`
to `Information` for the factory's host and count the `SELECT` statements a two-connection list
produces:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests \
  --filter "FullyQualifiedName~The_list_shows_this_companys_own_connections" \
  --logger "console;verbosity=detailed" 2>&1 | grep -c "Executed DbCommand"
```

Expected: a small constant — the connections, the day states, plus the middleware's own batch —
and crucially **the same number for a one-connection company and a two-connection company**. If it
grows with the row count, the grouped query has been replaced by a correlated subquery and
`[NFR-03]`'s 100-EAN load test in plan 8 will find it much later and much more expensively.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Contracts/Customer/Portal/PortalContracts.cs \
        src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs \
        src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs \
        tests/PeakPower.Integration.Tests/Portal/ConnectionListTests.cs \
        tests/PeakPower.Integration.Tests/Portal/ConnectionDetailTests.cs
git commit -m "feat(portal): populate LastDataDate on both connection DTOs [F02-R22]

Slice 1 hard-coded it null with a comment saying so; that comment is deleted, because
leaving it is an instruction to the next reader to keep it null. Two integration tests
asserted the null and are inverted here, in the same commit, along with a second test
that keeps the genuinely-null case pinned so the portal's NO_DATA_YET label stays
reachable.

The list resolves every row in ONE grouped query rather than a correlated subquery per
row - the shape CustomerEndpoints.ListAsync already uses for its counts.

Verified by dropping the State != NO_DATA predicate from the grouped query and watching
the list report the seeded empty day 2026-08-20. Run against the list as well as the
detail because the two are separate implementations of the same rule.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `RecentDataStates` — the 14-day strip on connection detail

`ConnectionDetailDto` gains **one** field, at the end of the record: fourteen `DayStateDto`
entries, oldest first, ending on today in Amsterdam. It is what plan 7 draws as the data-quality
strip in `specs/60-mockups/ean-detail.svg`.

⚠ **Fourteen for the customer strip, twenty-one for the employee heat map** (§10.4). The two
numbers come from different mockups and neither is a typo. `ConsumptionReader.CustomerStripDays`
is the customer's; Task 11 declares the employee's separately, on its own host.

⚠ **Dense and oldest first.** A date with no stored row is `NO_DATA`, not an absent entry — the
strip draws a fixed number of cells. Task 3 already built and tested
`ConsumptionReader.RecentDayStatesAsync` to that rule; this task wires it in.

**Files:**
- Modify: `src/Core/PeakPower.Contracts/Customer/Portal/PortalContracts.cs:93`
- Modify: `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs` (`ToDetail`)
- Modify: `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs` (three detail call sites)
- Test: `tests/PeakPower.Integration.Tests/Portal/RecentDataStatesTests.cs`

**Interfaces:**
- Consumes: `ConsumptionReader.RecentDayStatesAsync` and `.CustomerStripDays` (Task 3);
  `DayStateDto` (Task 1); `IMarketCalendar.TodayInAmsterdam` (slice 1).
- Produces: `ConnectionDetailDto.RecentDataStates` of type `IReadOnlyList<DayStateDto>`;
  `PortalMappings.ToDetail(MeteringPoint point, string brpName, DateOnly today, DateOnly? lastDataDate, IReadOnlyList<DayStateDto> recentDataStates)`

- [ ] **Step 1: Write the failing test**

Create `tests/PeakPower.Integration.Tests/Portal/RecentDataStatesTests.cs`:

```csharp
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Application.Abstractions;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

/// <summary>
/// The fourteen-cell data-quality strip on connection detail
/// (<c>specs/60-mockups/ean-detail.svg</c>).
/// </summary>
public sealed class RecentDataStatesTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    /// <summary>
    /// The strip ends on TODAY, so the arrangement has to know which day that is. Read from the
    /// host's own <see cref="IMarketCalendar"/> rather than computed here: the window is a
    /// function of Europe/Amsterdam's today, and a test that computed its own from the wall clock
    /// would disagree with the handler for the hour either side of midnight CET.
    /// </summary>
    private DateOnly Today => factory.Services.GetRequiredService<IMarketCalendar>().TodayInAmsterdam;

    private static int _kvkCounter = 55_000_000;

    private async Task<(HttpClient Client, Guid CustomerId)> SignedInAsync()
    {
        var kvk = Interlocked.Increment(ref _kvkCounter)
            .ToString(System.Globalization.CultureInfo.InvariantCulture);
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Strip {Guid.NewGuid():N}", kvk, email, Password);

        var client = factory.CreateAnonymousClient();
        var signIn = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password), Ct);
        var body = await signIn.Content.ReadFromJsonAsync<SignInResponse>(Ct);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body!.AccessToken);

        return (client, account.CustomerId);
    }

    private async Task<Guid> AttachAsync(Guid customerId)
    {
        await using var db = factory.CreateOwnerDbContext();
        var brp = await db.Brps.SingleAsync(b => b.Code == "PVNED", Ct);

        var point = MeteringPoint.Attach(
            customerId,
            EanCode.Create(
                "8716875" + Random.Shared.NextInt64(0, 99_999_999_999L)
                    .ToString("D11", System.Globalization.CultureInfo.InvariantCulture)).Value,
            brp.Id,
            ProductionExpectation.Unknown,
            expectationSource: null,
            name: "Strip target",
            description: null,
            gridOperator: "Stedin",
            capacityKw: 900m,
            address: null,
            validFrom: new DateOnly(2024, 1, 1)).Value;

        db.MeteringPoints.Add(point);
        await db.SaveChangesAsync(Ct);
        return point.Id;
    }

    [Fact]
    public async Task Connection_detail_carries_fourteen_cells_oldest_first_ending_today()
    {
        var (client, customerId) = await SignedInAsync();
        var point = await AttachAsync(customerId);
        var fixtures = new ConsumptionFixtures(factory);

        await fixtures.DayStateAsync(point, customerId, Today.AddDays(-13),
            MeteringDayState.Final, 96, true, true, false, null, Ct);
        await fixtures.DayStateAsync(point, customerId, Today.AddDays(-1),
            MeteringDayState.Provisional, 96, true, true, false, null, Ct);

        // One day OUTSIDE the window on the old side. If the query's lower bound is off by one
        // the strip's FIRST cell changes, which a length check alone would not see.
        await fixtures.DayStateAsync(point, customerId, Today.AddDays(-14),
            MeteringDayState.Final, 96, true, true, false, null, Ct);

        var detail = await client.GetFromJsonAsync<ConnectionDetailDto>(
            $"/api/v1/metering-points/{point}", Ct);

        detail.ShouldNotBeNull();
        detail!.RecentDataStates.Count.ShouldBe(14,
            "fourteen for the customer strip; twenty-one is the employee heat map, and the two " +
            "numbers come from different mockups");

        detail.RecentDataStates[0].Date.ShouldBe(Today.AddDays(-13), "oldest first");
        detail.RecentDataStates[13].Date.ShouldBe(Today, "and today is the last cell");

        detail.RecentDataStates[0].State.ShouldBe("FINAL");
        detail.RecentDataStates[12].State.ShouldBe("PROVISIONAL");
        detail.RecentDataStates[13].State.ShouldBe("NO_DATA",
            "a date with no stored state is a NO_DATA cell, not an absent entry — the strip " +
            "draws a fixed number of cells and cannot mark a day the payload does not mention");
    }

    [Fact]
    public async Task A_connection_that_has_received_nothing_carries_fourteen_no_data_cells()
    {
        var (client, customerId) = await SignedInAsync();
        var point = await AttachAsync(customerId);

        var detail = await client.GetFromJsonAsync<ConnectionDetailDto>(
            $"/api/v1/metering-points/{point}", Ct);

        detail!.RecentDataStates.Count.ShouldBe(14,
            "an empty strip is fourteen NO_DATA cells, not an empty array — the panel says " +
            "'nothing yet' by drawing fourteen empty cells, and an empty array would collapse it");
        detail.RecentDataStates.ShouldAllBe(cell => cell.State == "NO_DATA");
    }

    /// <summary>
    /// The strip is a per-connection fact, so a connection belonging to another company must not
    /// be reachable through it at all — 404, and never a strip of somebody else's days.
    /// </summary>
    [Fact]
    public async Task Another_companys_connection_has_no_strip_because_it_has_no_detail()
    {
        var (_, ownerId) = await SignedInAsync();
        var theirs = await AttachAsync(ownerId);
        await new ConsumptionFixtures(factory).DayStateAsync(
            theirs, ownerId, Today, MeteringDayState.Final, 96, true, true, false, null, Ct);

        var (strangerClient, _) = await SignedInAsync();

        using var response = await strangerClient.GetAsync($"/api/v1/metering-points/{theirs}", Ct);

        response.StatusCode.ShouldBe(System.Net.HttpStatusCode.NotFound);
        response.StatusCode.ShouldNotBe(System.Net.HttpStatusCode.Forbidden);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~RecentDataStatesTests"`
Expected: FAIL to compile —
`error CS1061: 'ConnectionDetailDto' does not contain a definition for 'RecentDataStates'`.

- [ ] **Step 3: Add the field to the contract**

In `src/Core/PeakPower.Contracts/Customer/Portal/PortalContracts.cs`, replace the
`ConnectionDetailDto` record at `:74-93`:

```csharp
/// <summary>
/// One connection in full [F01-R38].
/// <para>
/// <paramref name="RecentDataStates"/> is the data-quality strip: fourteen entries, oldest first,
/// ending on today in Amsterdam, DENSE — a date with no stored state is carried as
/// <c>NO_DATA</c> rather than omitted, because the strip draws a fixed number of cells and cannot
/// mark a day the payload does not mention. Fourteen is the customer strip
/// (<c>ean-detail.svg</c>); the employee heat map is twenty-one, and the two numbers come from
/// different mockups.
/// </para>
/// </summary>
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
    DateOnly? LastDataDate,
    IReadOnlyList<DayStateDto> RecentDataStates);
```

⚠ **At the end of the record, not in the middle.** A positional record's parameter order is its
JSON property order and its deconstruction order; inserting in the middle silently reorders the
generated TypeScript client's positional constructors and every `new ConnectionDetailDto(...)` in
the test suite.

- [ ] **Step 4: Thread it through the mapper**

In `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs`, extend `ToDetail`:

```csharp
    /// <summary>
    /// One connection in full [F01-R38]. <paramref name="brpName"/> is passed in rather than
    /// read off <paramref name="point"/>: <c>MeteringPoint</c> holds only the BRP's id, and
    /// resolving it is a query, which is the endpoint's job and not a mapping's.
    /// <paramref name="lastDataDate"/> and <paramref name="recentDataStates"/> are queries for
    /// the same reason.
    /// </summary>
    public static ConnectionDetailDto ToDetail(
        MeteringPoint point,
        string brpName,
        DateOnly today,
        DateOnly? lastDataDate,
        IReadOnlyList<DayStateDto> recentDataStates) =>
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
            lastDataDate,
            recentDataStates);
```

- [ ] **Step 5: Populate it at the three detail call sites**

In `src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs`, each of the three places that
now reads `PortalMappings.ToDetail(point, brpName, calendar.TodayInAmsterdam, lastDataDate)`
becomes:

```csharp
                var today = calendar.TodayInAmsterdam;
                var recentDataStates = await ConsumptionReader.RecentDayStatesAsync(
                    db, point.Id, today, ConsumptionReader.CustomerStripDays, cancellationToken);

                return Results.Ok(PortalMappings.ToDetail(
                    point, brpName, today, lastDataDate, recentDataStates));
```

and the claim POST at the end of its handler:

```csharp
                var today = calendar.TodayInAmsterdam;

                // A connection claimed a moment ago has fourteen NO_DATA cells, which is what the
                // panel should draw - an empty array would collapse the strip instead of showing
                // fourteen empty days. Same helper as the other two call sites, so there is one
                // definition of the window rather than three.
                var recentDataStates = await ConsumptionReader.RecentDayStatesAsync(
                    db, point.Id, today, ConsumptionReader.CustomerStripDays, cancellationToken);

                var detail = PortalMappings.ToDetail(
                    point, brp.Name, today, lastDataDate, recentDataStates);
                return Results.Created($"{Connections}/{point.Id}", detail);
```

and add to the `using` block:

```csharp
using PeakPower.Contracts.Customer.Portal;
```

(it is already there — `ConnectionEndpoints.cs:3`. Confirm rather than duplicating it.)

- [ ] **Step 6: Run the tests and watch them pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~RecentDataStatesTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConnectionDetailTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ClaimConnectionTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~ConnectionNamingTests"
```
Expected: all PASS — 3 tests in the first, and the three existing suites still green.

- [ ] **Step 7: Mutation-verify the density rule**

In `ConsumptionReader.RecentDayStatesAsync`, return only the stored rows — the "tidier" strip:

```csharp
        return
        [
            .. stored
                .OrderBy(entry => entry.Key)
                .Select(entry => new DayStateDto(entry.Key, PortalMappings.Wire(entry.Value)))
        ];
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~A_connection_that_has_received_nothing_carries_fourteen_no_data_cells"`
Expected: FAIL with
`Shouldly.ShouldAssertException : detail.RecentDataStates.Count should be 14 but was 0` and the
message *"an empty strip is fourteen NO_DATA cells, not an empty array"*.

⚠ Run `Connection_detail_carries_fourteen_cells_oldest_first_ending_today` under the same mutation
too: it fails at `should be 14 but was 3`, which is the case a reader would notice — but the empty
connection is the one that shows what the rule is *for*, because a collapsed strip on a brand-new
connection is exactly what plan 7's panel must not render. Restore and re-run both to green.

- [ ] **Step 8: Mutation-verify the window's lower bound**

Change `var from = today.AddDays(-(days - 1));` to `var from = today.AddDays(-days);`.

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Connection_detail_carries_fourteen_cells_oldest_first_ending_today"`
Expected: FAIL with
`Shouldly.ShouldAssertException : detail.RecentDataStates[0].Date should be <today−13> but was <today−14>`
naming the two actual dates.

⚠ The **count stays 14** under this mutation, which is why the test asserts the first and last
dates and not only the length. The day seeded at `Today.AddDays(-14)` is what makes the wrong
window visible as a wrong *value* rather than only as a wrong bound. Restore and re-run to green.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Contracts/Customer/Portal/PortalContracts.cs \
        src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs \
        src/Hosts/PeakPower.Api.Customer/Portal/ConnectionEndpoints.cs \
        tests/PeakPower.Integration.Tests/Portal/RecentDataStatesTests.cs
git commit -m "feat(portal): add the 14-day data-quality strip to connection detail [F02-R22]

One field, at the END of the positional record: a record's parameter order is its JSON
order and its deconstruction order, so inserting in the middle silently reorders the
generated TypeScript client.

The strip is DENSE - a date with no stored state is a NO_DATA cell, not an absent entry
- so a brand-new connection renders fourteen empty days rather than a collapsed panel.

Verified by returning only the stored rows and watching a connection that has received
nothing report an empty strip, and by moving the window's lower bound one day and
watching the first cell's DATE change while the count stayed at fourteen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The employee data-health contracts

Shared contract §10.4's four responses, as records in `PeakPower.Contracts.Employee`.

⚠ **`EmployeeDayStateDto` is a separate type from the portal's `DayStateDto`, and the duplication
is deliberate.** `PeakPower.Contracts` is one assembly with two namespaces, and the two OpenAPI
documents are two contracts generating two npm packages. Reusing `Customer.Portal.DayStateDto`
would put a schema named after the customer contract into `employee.json` and couple the two
documents' evolution — a rename in the portal's strip would move a type in the back office's heat
map. The shapes are identical today and are allowed to diverge.

⚠ **`BrpId` and `BrpCode` are nullable here and `NOT NULL` in the database.** Design §3.1 requires
the metering-point list to include points with no BRP assigned, and the code is resolved by a
lookup that can miss; the column is `NOT NULL` behind an `ON DELETE RESTRICT` foreign key today, so
the nullability is the read surface refusing to depend on that staying true. See Task 11's
`BrpCodeOrNull` for the belt-and-braces argument `ConnectionEndpoints.BrpNameAsync` already makes
for its own "Unknown" fallback.

⚠ **`PointCount` and `AgeHours` are `int` on the wire although `QuarantinedSeries.PointCount` is
`short`.** OpenAPI spells `short` as `format: int16`, and a generated TypeScript client narrows a
number type it has no reason to narrow; the frozen example shows plain numbers. Widening on the
way out costs nothing and cannot lose a value.

**Files:**
- Create: `src/Core/PeakPower.Contracts/Employee/DataHealthDtos.cs`
- Test: `tests/PeakPower.Domain.Tests/Contracts/ContractPurityTests.cs` (modify — one fact)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `public sealed record EmployeeDayStateDto(DateOnly Date, string State)`
  - `public sealed record DataHealthMessageDto(Guid Id, Guid BrpId, string BrpCode, Guid CorrelationId, DateTimeOffset ReceivedAt, string Status, long PayloadBytes, string? RemoteIp, string? FailureCode, string? FailureDetail, DateTimeOffset? ProcessedAt, int VersionCount, int QuarantinedSeriesCount)`
  - `public sealed record DataHealthMessageListResponse(IReadOnlyList<DataHealthMessageDto> Items, int Total, int Page, int PageSize)`
  - `public sealed record QuarantinedSeriesDto(Guid Id, Guid InboundMessageId, string BrpCode, string Reason, string ResourceObject, DateOnly DeliveryDate, string Direction, int PointCount, DateTimeOffset ReceivedAt, int AgeHours, DateTimeOffset? ResolvedAt, string? ResolvedBy)`
  - `public sealed record QuarantineListResponse(IReadOnlyList<QuarantinedSeriesDto> Items, int Total, int Page, int PageSize)`
  - `public sealed record DataHealthMeteringPointDto(Guid MeteringPointId, string Ean, string EanDisplay, string DisplayLabel, Guid CustomerId, string CustomerLegalName, Guid? BrpId, string? BrpCode, string ProductionExpectation, DateOnly? LastDataDate, bool IsSilent, IReadOnlyList<EmployeeDayStateDto> RecentDataStates)`
  - `public sealed record DataHealthMeteringPointListResponse(IReadOnlyList<DataHealthMeteringPointDto> Items, int Total, int Page, int PageSize)`
  - `public sealed record ReplayMessageResponse(Guid InboundMessageId, Guid CorrelationId, string Outcome, int VersionsCreated, int QuarantineEntriesResolved, string? FailureCode, string? FailureDetail)`

- [ ] **Step 1: Write the failing test**

Append to `tests/PeakPower.Domain.Tests/Contracts/ContractPurityTests.cs`, inside the class:

```csharp
    /// <summary>
    /// Shared contract §10.4's three list envelopes all carry the page and the page size back, not
    /// only the rows and the total.
    /// </summary>
    /// <remarks>
    /// The customer host's list envelopes carry <c>Items</c> and <c>Total</c> and no paging fields,
    /// because a company's connections are a page-sized set by construction. The back office's are
    /// not: <c>inbound_message</c> grows by one row per document per EAN per day [DEC-38], so an
    /// operator paging through a message log needs to know which page it is looking at. A client
    /// that has to remember what it asked for in order to render a pager has been given half an
    /// envelope.
    /// </remarks>
    [Fact]
    public void every_data_health_list_carries_its_page_and_page_size()
    {
        Type[] lists =
        [
            typeof(DataHealthMessageListResponse),
            typeof(QuarantineListResponse),
            typeof(DataHealthMeteringPointListResponse),
        ];

        var missing = lists
            .SelectMany(list => new[] { "Items", "Total", "Page", "PageSize" }
                .Where(name => list.GetProperty(name) is null)
                .Select(name => $"{list.Name}.{name}"))
            .ToArray();

        missing.ShouldBeEmpty();

        // The one field on the metering-point row that is nullable in the contract and NOT NULL
        // in the database, and it is nullable on purpose: design §3.1 requires this list to
        // include points with no BRP assigned.
        Nullable.GetUnderlyingType(
                typeof(DataHealthMeteringPointDto).GetProperty("BrpId")!.PropertyType)
            .ShouldBe(typeof(Guid),
                "brpId is nullable here and NOT NULL in the database — a point can be created " +
                "before it is routed, and the read surface must not assume otherwise");
    }
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Domain.Tests --filter "FullyQualifiedName~every_data_health_list_carries_its_page_and_page_size"`
Expected: FAIL to compile —
`error CS0246: The type or namespace name 'DataHealthMessageListResponse' could not be found`.

- [ ] **Step 3: Write the contracts**

Create `src/Core/PeakPower.Contracts/Employee/DataHealthDtos.cs`:

```csharp
namespace PeakPower.Contracts.Employee;

/// <summary>
/// One (delivery date, data state) pair in the back office's per-connection heat map
/// (<c>specs/60-mockups/employee-ingestion-health.svg</c>).
/// </summary>
/// <remarks>
/// Structurally identical to <c>PeakPower.Contracts.Customer.Portal.DayStateDto</c> on purpose.
/// The two OpenAPI documents are two contracts generating two npm packages; reusing the portal's
/// type would put a schema named after the customer contract into <c>employee.json</c> and couple
/// the two documents' evolution, so that a rename in the portal's fourteen-cell strip moved a type
/// in the back office's twenty-one-cell heat map. The same argument
/// <c>Customer.Portal.AddressDto</c> already carries against consolidating with
/// <c>Customer.Onboarding.OnboardingAddressDto</c>.
/// </remarks>
public sealed record EmployeeDayStateDto(DateOnly Date, string State);

/// <summary>
/// One stored inbound BRP message [F02-R03].
/// </summary>
/// <param name="Status">RECEIVED | PROCESSING | PROCESSED | FAILED | DUPLICATE.</param>
/// <param name="FailureCode">
/// One of the thirteen adapter codes, or a pipeline code. Null unless <paramref name="Status"/>
/// is FAILED — migration 9's <c>ck_msg_failed_has_code</c> makes a FAILED message without one
/// unstorable.
/// </param>
/// <param name="VersionCount">
/// Interval data versions this message produced. Zero for a message that was refused, deduplicated,
/// or recognised and closed with no readings — the A12 imbalance case [DEC-25].
/// </param>
/// <param name="QuarantinedSeriesCount">
/// Series this message could not attach to a metering point [F02-R14], [F02-R15]. A message can
/// have both counts non-zero: quarantine is per series, not per document.
/// </param>
public sealed record DataHealthMessageDto(
    Guid Id,
    Guid BrpId,
    string BrpCode,
    Guid CorrelationId,
    DateTimeOffset ReceivedAt,
    string Status,
    long PayloadBytes,
    string? RemoteIp,
    string? FailureCode,
    string? FailureDetail,
    DateTimeOffset? ProcessedAt,
    int VersionCount,
    int QuarantinedSeriesCount);

/// <param name="Total">Matching messages across every page, so the pager can size itself.</param>
public sealed record DataHealthMessageListResponse(
    IReadOnlyList<DataHealthMessageDto> Items,
    int Total,
    int Page,
    int PageSize);

/// <summary>
/// One series that could not be attached to a metering point [F02-R14], [F02-R15]. It is never
/// discarded and never attached by guesswork; registering the connection and replaying the stored
/// message resolves it into readings.
/// </summary>
/// <param name="Reason">UNKNOWN_EAN | EAN_VALIDITY | WRONG_BRP | NOT_ELECTRICITY.</param>
/// <param name="ResourceObject">
/// Verbatim from the document — an eighteen-digit EAN, or a descriptive resource label
/// [F02-R11], [AS-17]. Carried raw because a label is exactly what must NOT have been offered to
/// the EAN resolver, and an operator reading this row needs to see which it was.
/// </param>
/// <param name="AgeHours">
/// Whole hours since receipt, so the quarantine panel can sort by age without every client
/// implementing its own clock. Computed against <c>IMarketCalendar.UtcNow</c>.
/// </param>
public sealed record QuarantinedSeriesDto(
    Guid Id,
    Guid InboundMessageId,
    string BrpCode,
    string Reason,
    string ResourceObject,
    DateOnly DeliveryDate,
    string Direction,
    int PointCount,
    DateTimeOffset ReceivedAt,
    int AgeHours,
    DateTimeOffset? ResolvedAt,
    string? ResolvedBy);

public sealed record QuarantineListResponse(
    IReadOnlyList<QuarantinedSeriesDto> Items,
    int Total,
    int Page,
    int PageSize);

/// <summary>
/// One connection as the ingestion-health screen shows it.
/// </summary>
/// <param name="BrpId">
/// Nullable here and NOT NULL in the database: design §3.1 requires this list to include points
/// with no balance responsible party assigned, because a point can be created before it is routed.
/// </param>
/// <param name="BrpCode">Null for the same reason, and whenever the BRP lookup misses.</param>
/// <param name="IsSilent">
/// An open <c>METERING_POINT_SILENT</c> operational alert exists for this connection [F02-R26].
/// The silence CONDITION is the rollup job's; this field is the read of what it decided, so the
/// screen and the job cannot disagree about which connections are silent.
/// </param>
/// <param name="RecentDataStates">
/// TWENTY-ONE entries, oldest first, dense. The customer's strip is fourteen; the two numbers come
/// from different mockups (<c>employee-ingestion-health.svg</c> and <c>ean-detail.svg</c>) and
/// neither is a typo.
/// </param>
public sealed record DataHealthMeteringPointDto(
    Guid MeteringPointId,
    string Ean,
    string EanDisplay,
    string DisplayLabel,
    Guid CustomerId,
    string CustomerLegalName,
    Guid? BrpId,
    string? BrpCode,
    string ProductionExpectation,
    DateOnly? LastDataDate,
    bool IsSilent,
    IReadOnlyList<EmployeeDayStateDto> RecentDataStates);

public sealed record DataHealthMeteringPointListResponse(
    IReadOnlyList<DataHealthMeteringPointDto> Items,
    int Total,
    int Page,
    int PageSize);

/// <summary>
/// The outcome of replaying one stored message [F02-R27].
/// </summary>
/// <param name="Outcome">
/// REPLAYED | NO_CHANGE | FAILED. <c>NO_CHANGE</c> is the [F02-R27] idempotence case: replaying a
/// message whose content matches the current version produces no second version, and
/// <paramref name="VersionsCreated"/> is what says so.
/// </param>
/// <param name="VersionsCreated">
/// New interval data versions. Zero on NO_CHANGE and on FAILED — a failure writes no readings at
/// all [F02-R13].
/// </param>
public sealed record ReplayMessageResponse(
    Guid InboundMessageId,
    Guid CorrelationId,
    string Outcome,
    int VersionsCreated,
    int QuarantineEntriesResolved,
    string? FailureCode,
    string? FailureDetail);
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Domain.Tests --filter "FullyQualifiedName~ContractPurityTests"`
Expected: PASS — 6 tests.

- [ ] **Step 5: Verify `PeakPower.Contracts` still references nothing**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && tools/verify-solution-layout.sh`
Expected: PASS. `Outcome`, `Reason`, `Status` and `Direction` are all `string`, so nothing here
needs `PeakPower.Domain.Metering` — and the grep is what catches a `<ProjectReference>` the
compiler would elide from IL.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Contracts/Employee/DataHealthDtos.cs \
        tests/PeakPower.Domain.Tests/Contracts/ContractPurityTests.cs
git commit -m "feat(contracts): add the employee data-health envelopes [F02-R03] [F02-R14] [F02-R27]

EmployeeDayStateDto duplicates the portal's DayStateDto on purpose: the two OpenAPI
documents are two contracts generating two npm packages, and reusing the portal's type
would put a Customer.Portal schema into employee.json and couple their evolution.

brpId and brpCode are nullable here and NOT NULL in the database, because design §3.1
requires this list to include points that have not been routed to a BRP yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: `GET /data-health/messages` and `GET /data-health/quarantine`

The first two of the four back-office reads. Both are `.BackOffice(reason)` — the employee host
runs unscoped by construction (`UnscopedCustomerContext` paired with the `peakpower_employee` login
role and its "see everything" policy), so neither needs tenancy work, and a `.TenantScoped(...)`
here would fail `EmployeeRouteTableTests` by name: *"the employee API is deliberately not
tenant-scoped; a tenant-scoped endpoint here would mean somebody narrowed the back office to one
customer."*

⚠ **The two per-row counts are two grouped queries over the page's ids, not two correlated
subqueries.** `inbound_message` grows by one row per document per EAN per day `[DEC-38]`, so the
message log is the one screen in this slice where a per-row round trip is measurable.
`CustomerEndpoints.ListAsync` already establishes the shape and the reason.

⚠ **`ageHours` is computed from `IMarketCalendar.UtcNow`, never from `DateTimeOffset.UtcNow`.**
Architecture fact 5 is IL-enforced: no type outside `PeakPower.Infrastructure.Time` may call
`get_UtcNow`. Fact 5 will fail the build if this is got wrong, which is the point of it.

**Files:**
- Create: `src/Hosts/PeakPower.Api.Employee/Endpoints/DataHealthEndpoints.cs`
- Create: `src/Hosts/PeakPower.Api.Employee/Mapping/DataHealthMappings.cs`
- Create: `tests/PeakPower.Integration.Tests/Employee/DataHealthFixtures.cs`
- Create: `tests/PeakPower.Integration.Tests/Employee/DataHealthMessageTests.cs`
- Create: `tests/PeakPower.Integration.Tests/Employee/DataHealthQuarantineTests.cs`
- Modify: `src/Hosts/PeakPower.Api.Employee/Program.cs:344`
- Modify: `tests/PeakPower.Integration.Tests/Employee/EmployeeRouteTableTests.cs:89-94`

**Interfaces:**
- Consumes: `EnumWireFormat.ToWire` / `.TryParse` / `.Names` and `ApiResults` (slice 1);
  `TenancyEndpointExtensions.BackOffice` (slice 1); `IMarketCalendar.UtcNow` (slice 1);
  `InboundMessage`, `IntervalDataVersion`, `QuarantinedSeries` (plan 2); the DTOs of Task 9.
- Produces:
  - `public static class DataHealthEndpoints` — `IEndpointRouteBuilder MapDataHealthEndpoints(this IEndpointRouteBuilder routes)`
  - routes `GET /api/v1/data-health/messages`, `GET /api/v1/data-health/quarantine`
  - `public static class DataHealthMappings` — `ToDto(InboundMessage, string, int, int)`, `ToDto(QuarantinedSeries, string, DateTimeOffset)`

- [ ] **Step 1: Write the fixtures**

Create `tests/PeakPower.Integration.Tests/Employee/DataHealthFixtures.cs`:

```csharp
using Dapper;
using Npgsql;
using PeakPower.Domain.Metering;

namespace PeakPower.Integration.Tests.Employee;

/// <summary>
/// Writes <c>metering.inbound_message</c> and <c>metering.quarantined_series</c> against a
/// connection string, on the owner role.
/// </summary>
/// <remarks>
/// <para>
/// Raw SQL for the same reason <c>ConsumptionFixtures</c> is: shared contract §6 pins every column
/// of migration 9's tables, frozen, and does not pin a factory for these entities — plan 2 owns
/// whatever those become. An arrangement written against the columns compiles against plan 2
/// however plan 2 shapes its C#.
/// </para>
/// <para>
/// A deliberate duplicate of <c>ConsumptionFixtures.MessageAsync</c> rather than a shared helper:
/// the two test areas write different rows for different reasons, and a shared arrangement would
/// mean a change wanted by one of them silently reshaping the other's evidence.
/// </para>
/// </remarks>
public sealed class DataHealthFixtures(string connectionString)
{
    private async Task<NpgsqlConnection> OpenAsync(CancellationToken ct)
    {
        var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(ct);
        return connection;
    }

    /// <summary>The id of the seeded PVNED balance responsible party (migration 1).</summary>
    public async Task<Guid> PvnedIdAsync(CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        return await connection.QuerySingleAsync<Guid>(
            "SELECT id FROM metering.brp WHERE code = 'PVNED'");
    }

    /// <summary>A second balance responsible party, so "filter by BRP" has something to exclude.</summary>
    public async Task<Guid> EnsureBrpAsync(string code, string name, bool isActive, CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);

        // ix_brp_code is UNIQUE on code, so a second row with the same code is a 23505. Read it
        // back if it is already there - several classes in this suite want the same second BRP.
        var existing = await connection.QuerySingleOrDefaultAsync<Guid?>(
            "SELECT id FROM metering.brp WHERE code = @code", new { code });

        if (existing is { } found)
        {
            return found;
        }

        var id = Guid.CreateVersion7();
        await connection.ExecuteAsync(
            """
            INSERT INTO metering.brp
                   (id, code, name, is_active, endpoint_uri, credential_ref, document_format,
                    adapter_key, expected_cadence)
            VALUES (@id, @code, @name, @isActive, @endpointUri, @credentialRef,
                    'PVNED_TIMESERIES_XML', @adapterKey, 'DAILY_PER_EAN')
            """,
            new
            {
                id,
                code,
                name,
                isActive,
                endpointUri = $"/webhooks/brp/{code}",
                // ⚠ The NAME of an environment variable, never a secret. Shared contract §9.3,
                // and a test in plan 2 asserts the seeded row's credential_ref starts with this
                // prefix.
                credentialRef = $"BRP_CREDENTIAL_{code}",
                adapterKey = "PVNED_TIMESERIES_XML_V2P0",
            });

        return id;
    }

    public async Task<Guid> MessageAsync(
        Guid brpId,
        InboundMessageStatus status,
        DateTimeOffset receivedAt,
        string? failureCode,
        string? failureDetail,
        CancellationToken ct)
    {
        var id = Guid.CreateVersion7();
        var correlationId = Guid.CreateVersion7();

        await using var connection = await OpenAsync(ct);
        await connection.ExecuteAsync(
            """
            INSERT INTO metering.inbound_message
                   (id, brp_id, correlation_id, received_at, payload_hash, payload_bytes,
                    payload_uri, status, failure_code, failure_detail, processed_at, remote_ip)
            VALUES (@id, @brpId, @correlationId, @receivedAt, @payloadHash, @payloadBytes,
                    @payloadUri, @status, @failureCode, @failureDetail, @processedAt,
                    @remoteIp::inet)
            """,
            new
            {
                id,
                brpId,
                correlationId,
                receivedAt,
                payloadHash = System.Security.Cryptography.SHA256.HashData(id.ToByteArray()),
                payloadBytes = 41_822L,
                payloadUri = $"file://{correlationId:N}.bin",
                status = PeakPower.Infrastructure.Web.Http.EnumWireFormat.ToWire(status),
                failureCode,
                failureDetail,
                processedAt = status is InboundMessageStatus.Processed or InboundMessageStatus.Failed
                    ? (DateTimeOffset?)receivedAt.AddSeconds(1)
                    : null,
                remoteIp = "10.0.0.7",
            });

        return id;
    }

    public async Task<Guid> QuarantineAsync(
        Guid inboundMessageId,
        Guid brpId,
        QuarantineReason reason,
        string resourceObject,
        DateOnly deliveryDate,
        IntervalDirection direction,
        short pointCount,
        DateTimeOffset receivedAt,
        DateTimeOffset? resolvedAt,
        string? resolvedBy,
        CancellationToken ct)
    {
        var id = Guid.CreateVersion7();

        await using var connection = await OpenAsync(ct);
        await connection.ExecuteAsync(
            """
            INSERT INTO metering.quarantined_series
                   (id, inbound_message_id, brp_id, reason, resource_object, delivery_date,
                    direction, point_count, received_at, resolved_at, resolved_by)
            VALUES (@id, @inboundMessageId, @brpId, @reason, @resourceObject, @deliveryDate,
                    @direction, @pointCount, @receivedAt, @resolvedAt, @resolvedBy)
            """,
            new
            {
                id,
                inboundMessageId,
                brpId,
                reason = PeakPower.Infrastructure.Web.Http.EnumWireFormat.ToWire(reason),
                resourceObject,
                deliveryDate,
                direction = PeakPower.Infrastructure.Web.Http.EnumWireFormat.ToWire(direction),
                pointCount,
                receivedAt,
                resolvedAt,
                resolvedBy,
            });

        return id;
    }
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/PeakPower.Integration.Tests/Employee/DataHealthMessageTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Shouldly;
using PeakPower.Contracts.Employee;
using PeakPower.Domain.Metering;
using PeakPower.Integration.Tests.Tenancy;
using Xunit;

namespace PeakPower.Integration.Tests.Employee;

/// <summary>
/// <c>GET /api/v1/data-health/messages</c> — the inbound BRP message log [F02-R03].
/// </summary>
[Collection(nameof(TenancyCollection))]
public sealed class DataHealthMessageTests : IAsyncLifetime
{
    private readonly TenancyFixture _fixture;
    private EmployeeApiFactory _factory = null!;
    private HttpClient _client = null!;
    private DataHealthFixtures _data = null!;

    public DataHealthMessageTests(TenancyFixture fixture) => _fixture = fixture;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new EmployeeApiFactory(_fixture.OwnerConnectionString);

        // A back-office token, not an anonymous client: every route here is behind the host's
        // default-deny FallbackPolicy and answers 401 without one.
        _client = await _factory.CreateBackOfficeClientAsync(Ct);
        _data = new DataHealthFixtures(_fixture.OwnerConnectionString);
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private static readonly DateTimeOffset Received =
        new(2026, 8, 13, 4, 2, 11, TimeSpan.Zero);

    [Fact]
    public async Task The_log_carries_the_message_its_brp_code_and_its_status()
    {
        var pvned = await _data.PvnedIdAsync(Ct);
        var id = await _data.MessageAsync(
            pvned, InboundMessageStatus.Processed, Received, null, null, Ct);

        var log = await _client.GetFromJsonAsync<DataHealthMessageListResponse>(
            "/api/v1/data-health/messages?pageSize=200", Ct);

        var row = log!.Items.Single(item => item.Id == id);
        row.BrpId.ShouldBe(pvned);
        row.BrpCode.ShouldBe("PVNED");
        row.Status.ShouldBe("PROCESSED",
            "shared contract §4 — the wire spelling is the database spelling");
        row.ReceivedAt.ShouldBe(Received);
        row.PayloadBytes.ShouldBe(41_822L);
        row.RemoteIp.ShouldBe("10.0.0.7");
        row.FailureCode.ShouldBeNull();
        row.ProcessedAt.ShouldNotBeNull();

        log.Page.ShouldBe(1);
        log.PageSize.ShouldBe(200);
        log.Total.ShouldBeGreaterThanOrEqualTo(1, "the total spans every page, not this one");
    }

    [Fact]
    public async Task A_failed_message_carries_its_code_and_its_human_readable_message()
    {
        var pvned = await _data.PvnedIdAsync(Ct);
        var id = await _data.MessageAsync(
            pvned, InboundMessageStatus.Failed, Received,
            "INCOMPLETE_PERIOD",
            "The document declares 96 points for a date that expects 100.", Ct);

        var log = await _client.GetFromJsonAsync<DataHealthMessageListResponse>(
            "/api/v1/data-health/messages?status=FAILED&pageSize=200", Ct);

        var row = log!.Items.Single(item => item.Id == id);
        row.Status.ShouldBe("FAILED");
        row.FailureCode.ShouldBe("INCOMPLETE_PERIOD",
            "the integration-spec §8.2 codes go on the wire verbatim — plan 4 puts this exact " +
            "string on the message and no plan may respell it");
        row.FailureDetail.ShouldNotBeNullOrWhiteSpace();

        log.Items.ShouldAllBe(item => item.Status == "FAILED",
            "the status filter must exclude, not merely order");
    }

    [Fact]
    public async Task The_log_can_be_filtered_by_balance_responsible_party()
    {
        var pvned = await _data.PvnedIdAsync(Ct);
        var other = await _data.EnsureBrpAsync(
            "ZZFILTER", "Zeeuwse Filter B.V.", isActive: true, Ct);

        var mine = await _data.MessageAsync(
            other, InboundMessageStatus.Processed, Received, null, null, Ct);
        var theirs = await _data.MessageAsync(
            pvned, InboundMessageStatus.Processed, Received, null, null, Ct);

        var log = await _client.GetFromJsonAsync<DataHealthMessageListResponse>(
            $"/api/v1/data-health/messages?brpId={other}&pageSize=200", Ct);

        log!.Items.Select(item => item.Id).ShouldContain(mine);
        log.Items.Select(item => item.Id).ShouldNotContain(theirs);
        log.Items.ShouldAllBe(item => item.BrpId == other);
    }

    /// <summary>
    /// The two per-row counts. A message can carry BOTH: quarantine is decided per series, not per
    /// document, so one document with two timeseries can land one version and one quarantine row.
    /// </summary>
    [Fact]
    public async Task A_row_counts_the_versions_and_the_quarantine_entries_the_message_produced()
    {
        var pvned = await _data.PvnedIdAsync(Ct);
        var messageId = await _data.MessageAsync(
            pvned, InboundMessageStatus.Processed, Received, null, null, Ct);

        var consumption = new ConsumptionFixturesBridge(_fixture.OwnerConnectionString);
        await consumption.VersionAsync(
            _fixture.CompanyAMeteringPointId, _fixture.CompanyAId,
            new DateOnly(2026, 8, 12), IntervalDirection.Consumption,
            messageId, Guid.CreateVersion7(), Received, 96, isCurrent: true, Ct);

        await _data.QuarantineAsync(
            messageId, pvned, QuarantineReason.UnknownEan, "871685900000000042",
            new DateOnly(2026, 8, 12), IntervalDirection.Production, 96, Received,
            null, null, Ct);

        var log = await _client.GetFromJsonAsync<DataHealthMessageListResponse>(
            "/api/v1/data-health/messages?pageSize=200", Ct);

        var row = log!.Items.Single(item => item.Id == messageId);
        row.VersionCount.ShouldBe(1);
        row.QuarantinedSeriesCount.ShouldBe(1,
            "quarantine is per SERIES, not per document — one message can land a version and a " +
            "quarantine row at once");
    }

    [Fact]
    public async Task A_message_that_produced_nothing_counts_zero_rather_than_disappearing()
    {
        var pvned = await _data.PvnedIdAsync(Ct);
        var id = await _data.MessageAsync(
            pvned, InboundMessageStatus.Duplicate, Received, null, null, Ct);

        var log = await _client.GetFromJsonAsync<DataHealthMessageListResponse>(
            "/api/v1/data-health/messages?pageSize=200", Ct);

        var row = log!.Items.Single(item => item.Id == id);
        row.VersionCount.ShouldBe(0);
        row.QuarantinedSeriesCount.ShouldBe(0);
        row.Status.ShouldBe("DUPLICATE",
            "a byte-identical redelivery within 24 h is recorded, not dropped [F02-R07] — it is " +
            "evidence that the sender is retrying");
    }

    [Fact]
    public async Task An_unknown_status_filter_is_400_and_lists_the_ones_that_exist()
    {
        using var response = await _client.GetAsync(
            "/api/v1/data-health/messages?status=Processed", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest,
            "parsing is case-sensitive on purpose: accepting 'Processed' as well as 'PROCESSED' " +
            "would let a client keep using the wrong spelling indefinitely");

        var body = await response.Content.ReadAsStringAsync(Ct);
        using var document = System.Text.Json.JsonDocument.Parse(body);
        document.RootElement.GetProperty("errors").TryGetProperty("status", out var errors)
            .ShouldBeTrue();
        errors[0].GetString().ShouldContain("PROCESSED", Case.Sensitive);
    }

    [Fact]
    public async Task The_log_refuses_a_caller_with_no_back_office_token()
    {
        using var anonymous = _factory.CreateEmployeeClient();

        using var response = await anonymous.GetAsync("/api/v1/data-health/messages", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
```

⚠ `ConsumptionFixturesBridge` in the version-count test is **not** a new type: it is
`PeakPower.Integration.Tests.Portal.ConsumptionFixtures`, which takes a `CustomerApiFactory` and so
cannot be used from an `EmployeeApiFactory` test. Rather than widen that class, add the one method
this test needs to `DataHealthFixtures` and call it directly:

```csharp
    /// <summary>
    /// One current interval data version attributed to a message, so the log's version count has
    /// something to count. Deliberately minimal — this class needs the COUNT, not the readings.
    /// </summary>
    public async Task VersionAsync(
        Guid meteringPointId,
        Guid customerId,
        DateOnly deliveryDate,
        IntervalDirection direction,
        Guid inboundMessageId,
        DateTimeOffset receivedAt,
        CancellationToken ct)
    {
        var id = Guid.CreateVersion7();

        await using var connection = await OpenAsync(ct);
        await connection.ExecuteAsync(
            """
            INSERT INTO metering.interval_data_version
                   (id, metering_point_id, customer_id, delivery_date, direction, source,
                    document_id, document_created, received_at, inbound_message_id,
                    correlation_id, interval_count, is_current)
            VALUES (@id, @meteringPointId, @customerId, @deliveryDate, @direction, 'BRP_FEED',
                    @documentId, @documentCreated, @receivedAt, @inboundMessageId,
                    @correlationId, 96, true)
            """,
            new
            {
                id,
                meteringPointId,
                customerId,
                deliveryDate,
                direction = PeakPower.Infrastructure.Web.Http.EnumWireFormat.ToWire(direction),
                documentId = id.ToString("D", System.Globalization.CultureInfo.InvariantCulture),
                documentCreated = receivedAt.AddMinutes(-3),
                receivedAt,
                inboundMessageId,
                correlationId = Guid.CreateVersion7(),
            });
    }
```

and rewrite that one arrangement as:

```csharp
        await _data.VersionAsync(
            _fixture.CompanyAMeteringPointId, _fixture.CompanyAId,
            new DateOnly(2026, 8, 12), IntervalDirection.Consumption, messageId, Received, Ct);
```

Create `tests/PeakPower.Integration.Tests/Employee/DataHealthQuarantineTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using PeakPower.Application.Abstractions;
using PeakPower.Contracts.Employee;
using PeakPower.Domain.Metering;
using PeakPower.Integration.Tests.Tenancy;
using Xunit;

namespace PeakPower.Integration.Tests.Employee;

/// <summary>
/// <c>GET /api/v1/data-health/quarantine</c> — the series that could not be attached to a
/// connection [F02-R14], [F02-R15].
/// </summary>
[Collection(nameof(TenancyCollection))]
public sealed class DataHealthQuarantineTests : IAsyncLifetime
{
    private readonly TenancyFixture _fixture;
    private EmployeeApiFactory _factory = null!;
    private HttpClient _client = null!;
    private DataHealthFixtures _data = null!;

    public DataHealthQuarantineTests(TenancyFixture fixture) => _fixture = fixture;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new EmployeeApiFactory(_fixture.OwnerConnectionString);
        _client = await _factory.CreateBackOfficeClientAsync(Ct);
        _data = new DataHealthFixtures(_fixture.OwnerConnectionString);
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    /// <summary>
    /// The host's own clock, so <c>ageHours</c> can be asserted exactly rather than approximately.
    /// Architecture fact 5 keeps this the only clock in the platform, which is what makes a test
    /// able to read the same "now" the handler will.
    /// </summary>
    private DateTimeOffset Now => _factory.Services.GetRequiredService<IMarketCalendar>().UtcNow;

    [Fact]
    public async Task A_quarantined_series_carries_its_reason_its_resource_object_and_its_age()
    {
        var pvned = await _data.PvnedIdAsync(Ct);
        var receivedAt = Now.AddHours(-26);
        var messageId = await _data.MessageAsync(
            pvned, InboundMessageStatus.Processed, receivedAt, null, null, Ct);

        var id = await _data.QuarantineAsync(
            messageId, pvned, QuarantineReason.UnknownEan, "871685900000000042",
            new DateOnly(2026, 8, 12), IntervalDirection.Consumption, 96, receivedAt,
            null, null, Ct);

        var list = await _client.GetFromJsonAsync<QuarantineListResponse>(
            "/api/v1/data-health/quarantine?pageSize=200", Ct);

        var row = list!.Items.Single(item => item.Id == id);
        row.InboundMessageId.ShouldBe(messageId);
        row.BrpCode.ShouldBe("PVNED");
        row.Reason.ShouldBe("UNKNOWN_EAN");
        row.ResourceObject.ShouldBe("871685900000000042",
            "carried verbatim from the document — eighteen digits is an EAN, and anything else " +
            "is a descriptive label that must never have been offered to the EAN resolver " +
            "[F02-R11] [AS-17]");
        row.DeliveryDate.ShouldBe(new DateOnly(2026, 8, 12));
        row.Direction.ShouldBe("CONSUMPTION");
        row.PointCount.ShouldBe(96);
        row.AgeHours.ShouldBeInRange(26, 27,
            "whole hours since receipt, so the panel can sort by age without every client " +
            "implementing its own clock");
        row.ResolvedAt.ShouldBeNull();
        row.ResolvedBy.ShouldBeNull();
    }

    [Fact]
    public async Task The_list_can_be_filtered_by_reason()
    {
        var pvned = await _data.PvnedIdAsync(Ct);
        var receivedAt = Now.AddHours(-2);
        var messageId = await _data.MessageAsync(
            pvned, InboundMessageStatus.Processed, receivedAt, null, null, Ct);

        var wrongBrp = await _data.QuarantineAsync(
            messageId, pvned, QuarantineReason.WrongBrp, "871685900000000059",
            new DateOnly(2026, 8, 12), IntervalDirection.Consumption, 96, receivedAt,
            null, null, Ct);
        var unknownEan = await _data.QuarantineAsync(
            messageId, pvned, QuarantineReason.UnknownEan, "871685900000000066",
            new DateOnly(2026, 8, 12), IntervalDirection.Consumption, 96, receivedAt,
            null, null, Ct);

        var list = await _client.GetFromJsonAsync<QuarantineListResponse>(
            "/api/v1/data-health/quarantine?reason=WRONG_BRP&pageSize=200", Ct);

        list!.Items.Select(item => item.Id).ShouldContain(wrongBrp);
        list.Items.Select(item => item.Id).ShouldNotContain(unknownEan);
        list.Items.ShouldAllBe(item => item.Reason == "WRONG_BRP");
    }

    /// <summary>
    /// The panel's default view is the OPEN entries, so the filter has to be able to say so —
    /// and the resolved ones have to stay reachable, because a resolved entry is the evidence
    /// that a replay worked.
    /// </summary>
    [Fact]
    public async Task The_list_can_be_filtered_to_open_or_to_resolved()
    {
        var pvned = await _data.PvnedIdAsync(Ct);
        var receivedAt = Now.AddHours(-3);
        var messageId = await _data.MessageAsync(
            pvned, InboundMessageStatus.Processed, receivedAt, null, null, Ct);

        var open = await _data.QuarantineAsync(
            messageId, pvned, QuarantineReason.EanValidity, "871685900000000073",
            new DateOnly(2026, 8, 12), IntervalDirection.Consumption, 96, receivedAt,
            null, null, Ct);
        var closed = await _data.QuarantineAsync(
            messageId, pvned, QuarantineReason.EanValidity, "871685900000000080",
            new DateOnly(2026, 8, 12), IntervalDirection.Consumption, 96, receivedAt,
            Now.AddHours(-1), "els.bakker@peakpower.nl", Ct);

        var openOnly = await _client.GetFromJsonAsync<QuarantineListResponse>(
            "/api/v1/data-health/quarantine?resolved=false&pageSize=200", Ct);
        openOnly!.Items.Select(item => item.Id).ShouldContain(open);
        openOnly.Items.Select(item => item.Id).ShouldNotContain(closed);

        var resolvedOnly = await _client.GetFromJsonAsync<QuarantineListResponse>(
            "/api/v1/data-health/quarantine?resolved=true&pageSize=200", Ct);
        resolvedOnly!.Items.Select(item => item.Id).ShouldContain(closed);
        resolvedOnly.Items.Select(item => item.Id).ShouldNotContain(open);

        var resolvedRow = resolvedOnly.Items.Single(item => item.Id == closed);
        resolvedRow.ResolvedBy.ShouldBe("els.bakker@peakpower.nl");
        resolvedRow.ResolvedAt.ShouldNotBeNull();
    }

    [Fact]
    public async Task An_unknown_reason_filter_is_400_and_lists_the_four_that_exist()
    {
        using var response = await _client.GetAsync(
            "/api/v1/data-health/quarantine?reason=BAD_EAN", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var body = await response.Content.ReadAsStringAsync(Ct);
        using var document = System.Text.Json.JsonDocument.Parse(body);
        var errors = document.RootElement.GetProperty("errors").GetProperty("reason");
        errors[0].GetString().ShouldContain("NOT_ELECTRICITY", Case.Sensitive);
    }

    [Fact]
    public async Task The_quarantine_list_refuses_a_caller_with_no_back_office_token()
    {
        using var anonymous = _factory.CreateEmployeeClient();

        using var response = await anonymous.GetAsync("/api/v1/data-health/quarantine", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
```

- [ ] **Step 3: Run them and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~DataHealthMessageTests|FullyQualifiedName~DataHealthQuarantineTests"`
Expected: FAIL — every fact.
`The_log_carries_the_message_its_brp_code_and_its_status` fails with
`System.Net.Http.HttpRequestException: Response status code does not indicate success: 401 (Unauthorized)`,
because the route is not mapped and this host also denies by default — the same 401-not-404
signature the customer host has.

- [ ] **Step 4: Write the mappings**

Create `src/Hosts/PeakPower.Api.Employee/Mapping/DataHealthMappings.cs`:

```csharp
using PeakPower.Contracts.Employee;
using PeakPower.Domain.Metering;
using PeakPower.Infrastructure.Web.Http;

namespace PeakPower.Api.Employee.Mapping;

/// <summary>
/// Domain to data-health DTO.
/// </summary>
/// <remarks>
/// <para>
/// The enum spellings go through <see cref="EnumWireFormat"/> rather than an explicit switch,
/// which is this host's established shape (see <c>EmployeeMappings.ToDto</c>) and differs from
/// <c>PortalMappings</c>'s switch on the customer host. Both are safe for the enums here because
/// every slice-2 member has only ISOLATED capitals: <c>EnumWireFormat</c> uses
/// <see cref="System.Text.Json.JsonNamingPolicy.SnakeCaseUpper"/>, which treats a run of capitals
/// as one word, while the persistence converter breaks before every capital, and the two diverge
/// the moment two capitals sit together. <c>UnknownEan</c> is <c>UNKNOWN_EAN</c> under both;
/// <c>UnknownEAN</c> would not be, and <c>EnumWireAlgorithmDivergenceTests</c> is the standing
/// guard.
/// </para>
/// </remarks>
public static class DataHealthMappings
{
    public static DataHealthMessageDto ToDto(
        InboundMessage message,
        string brpCode,
        int versionCount,
        int quarantinedSeriesCount) =>
        new(message.Id,
            message.BrpId,
            brpCode,
            message.CorrelationId,
            message.ReceivedAt,
            EnumWireFormat.ToWire(message.Status),
            message.PayloadBytes,
            message.RemoteIp,
            message.FailureCode,
            message.FailureDetail,
            message.ProcessedAt,
            versionCount,
            quarantinedSeriesCount);

    /// <summary>
    /// <paramref name="now"/> comes from <c>IMarketCalendar.UtcNow</c> and is passed in rather
    /// than read here: architecture fact 5 is IL-enforced and no type outside
    /// <c>PeakPower.Infrastructure.Time</c> may call <c>get_UtcNow</c>. Passing it also makes
    /// <c>ageHours</c> a pure function, so a test can assert it exactly.
    /// </summary>
    public static QuarantinedSeriesDto ToDto(
        QuarantinedSeries series, string brpCode, DateTimeOffset now) =>
        new(series.Id,
            series.InboundMessageId,
            brpCode,
            EnumWireFormat.ToWire(series.Reason),
            series.ResourceObject,
            series.DeliveryDate,
            EnumWireFormat.ToWire(series.Direction),
            series.PointCount,
            series.ReceivedAt,
            // Whole hours, floored, and never negative: a clock skew that put receipt in the
            // future would otherwise render as a negative age in the panel's "oldest first" sort.
            (int)Math.Max(0, Math.Floor((now - series.ReceivedAt).TotalHours)),
            series.ResolvedAt,
            series.ResolvedBy);
}
```

- [ ] **Step 5: Write the endpoints**

Create `src/Hosts/PeakPower.Api.Employee/Endpoints/DataHealthEndpoints.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Api.Employee.Mapping;
using PeakPower.Application.Abstractions;
using PeakPower.Contracts.Employee;
using PeakPower.Domain.Metering;
using PeakPower.Infrastructure.Web.Http;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;

namespace PeakPower.Api.Employee.Endpoints;

/// <summary>
/// The ingestion-health screens' read surface: the inbound message log, the quarantine panel, the
/// per-connection state heat map and replay. All four are drawn in
/// <c>specs/60-mockups/employee-ingestion-health.svg</c>.
/// </summary>
/// <remarks>
/// Every route here is <c>.BackOffice(reason)</c>. This host runs UNSCOPED by construction —
/// <c>UnscopedCustomerContext</c> makes every global query filter a no-op, paired with the
/// <c>peakpower_employee</c> login role and its "see everything" row-level-security policy — so
/// none of this needs tenancy work, and a <c>.TenantScoped(...)</c> here would fail
/// <c>EmployeeRouteTableTests</c> by name: a tenant-scoped endpoint on this host would mean
/// somebody narrowed the back office to one customer.
/// </remarks>
public static class DataHealthEndpoints
{
    private const string BackOfficeReason =
        "Back-office staff diagnose ingestion across every customer company and every balance "
        + "responsible party.";

    private const int DefaultPageSize = 50;
    private const int MaximumPageSize = 200;

    public static IEndpointRouteBuilder MapDataHealthEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/v1/data-health").WithTags("Data health");

        group.MapGet("/messages", MessagesAsync)
            .WithName("ListInboundMessages")
            .WithSummary("The stored inbound BRP messages, newest first. [F02-R03]")
            .Produces<DataHealthMessageListResponse>()
            // Keyed to "status" - an unparseable filter value, which is the caller's mistake and
            // has to name the field so the screen can put the message beside the right control.
            .ProducesValidationProblem()
            .BackOffice(BackOfficeReason);

        group.MapGet("/quarantine", QuarantineAsync)
            .WithName("ListQuarantinedSeries")
            .WithSummary("Series that could not be attached to a connection. [F02-R14]")
            .Produces<QuarantineListResponse>()
            .ProducesValidationProblem()
            .BackOffice(BackOfficeReason);

        return routes;
    }

    // ------------------------------------------------------------------------ the message log

    private static async Task<IResult> MessagesAsync(
        Guid? brpId,
        string? status,
        int page,
        int pageSize,
        PeakPowerDbContext db,
        CancellationToken cancellationToken)
    {
        InboundMessageStatus? wanted = null;

        if (!string.IsNullOrWhiteSpace(status))
        {
            // Case-sensitive on purpose. EnumWireFormat's parse accepts PROCESSED and refuses
            // "Processed": accepting both would let a client keep using the wrong spelling
            // indefinitely, and the two would drift apart unnoticed.
            if (!EnumWireFormat.TryParse<InboundMessageStatus>(status, out var parsed))
            {
                return ApiResults.InvalidRequest(
                    "status",
                    "Status must be one of: "
                    + $"{string.Join(", ", EnumWireFormat.Names<InboundMessageStatus>())}.");
            }

            wanted = parsed;
        }

        var (number, size) = Paging(page, pageSize);

        var query = db.Set<InboundMessage>().AsNoTracking();

        // Both filters are opt-in. An unconditional predicate here would quietly make the log
        // show one BRP's messages and the screen would look like it was working.
        if (brpId is { } brp)
        {
            query = query.Where(message => message.BrpId == brp);
        }

        if (wanted is { } state)
        {
            query = query.Where(message => message.Status == state);
        }

        var total = await query.CountAsync(cancellationToken);

        var messages = await query
            // Newest first, then by id so a page boundary is stable across two requests that land
            // in the same millisecond - which, at one document per EAN per day [DEC-38] arriving
            // in a batch, is the ordinary case rather than the rare one.
            .OrderByDescending(message => message.ReceivedAt)
            .ThenBy(message => message.Id)
            .Skip((number - 1) * size)
            .Take(size)
            .ToListAsync(cancellationToken);

        var ids = messages.Select(message => message.Id).ToArray();

        // Two grouped counts over the PAGE's ids, not two correlated subqueries per row.
        // inbound_message grows by one row per document per EAN per day, so this is the one
        // back-office screen in this slice where a per-row round trip is measurable.
        var versionCounts = await db.Set<IntervalDataVersion>()
            .AsNoTracking()
            .Where(version => version.InboundMessageId != null
                              && ids.Contains(version.InboundMessageId.Value))
            .GroupBy(version => version.InboundMessageId!.Value)
            .Select(group => new { MessageId = group.Key, Count = group.Count() })
            .ToDictionaryAsync(row => row.MessageId, row => row.Count, cancellationToken);

        var quarantineCounts = await db.Set<QuarantinedSeries>()
            .AsNoTracking()
            .Where(series => ids.Contains(series.InboundMessageId))
            .GroupBy(series => series.InboundMessageId)
            .Select(group => new { MessageId = group.Key, Count = group.Count() })
            .ToDictionaryAsync(row => row.MessageId, row => row.Count, cancellationToken);

        var brpCodes = await BrpCodesAsync(db, cancellationToken);

        var items = messages
            .Select(message => DataHealthMappings.ToDto(
                message,
                brpCodes.TryGetValue(message.BrpId, out var code) ? code : string.Empty,
                versionCounts.TryGetValue(message.Id, out var versions) ? versions : 0,
                quarantineCounts.TryGetValue(message.Id, out var quarantined) ? quarantined : 0))
            .ToArray();

        return Results.Ok(new DataHealthMessageListResponse(items, total, number, size));
    }

    // ------------------------------------------------------------------------- the quarantine

    private static async Task<IResult> QuarantineAsync(
        string? reason,
        bool? resolved,
        int page,
        int pageSize,
        PeakPowerDbContext db,
        IMarketCalendar calendar,
        CancellationToken cancellationToken)
    {
        QuarantineReason? wanted = null;

        if (!string.IsNullOrWhiteSpace(reason))
        {
            if (!EnumWireFormat.TryParse<QuarantineReason>(reason, out var parsed))
            {
                return ApiResults.InvalidRequest(
                    "reason",
                    "Reason must be one of: "
                    + $"{string.Join(", ", EnumWireFormat.Names<QuarantineReason>())}.");
            }

            wanted = parsed;
        }

        var (number, size) = Paging(page, pageSize);

        var query = db.Set<QuarantinedSeries>().AsNoTracking();

        if (wanted is { } quarantineReason)
        {
            query = query.Where(series => series.Reason == quarantineReason);
        }

        // Tri-state: absent means "both", which is what an operator auditing a week wants, and
        // false means "still open", which is the panel's default view.
        if (resolved is { } isResolved)
        {
            query = isResolved
                ? query.Where(series => series.ResolvedAt != null)
                : query.Where(series => series.ResolvedAt == null);
        }

        var total = await query.CountAsync(cancellationToken);

        var entries = await query
            .OrderByDescending(series => series.ReceivedAt)
            .ThenBy(series => series.Id)
            .Skip((number - 1) * size)
            .Take(size)
            .ToListAsync(cancellationToken);

        var brpCodes = await BrpCodesAsync(db, cancellationToken);

        // Read ONCE for the whole page rather than per row: two rows of one page must not be able
        // to report different ages for the same receipt time.
        var now = calendar.UtcNow;

        var items = entries
            .Select(series => DataHealthMappings.ToDto(
                series,
                brpCodes.TryGetValue(series.BrpId, out var code) ? code : string.Empty,
                now))
            .ToArray();

        return Results.Ok(new QuarantineListResponse(items, total, number, size));
    }

    // ------------------------------------------------------------------------------- plumbing

    /// <summary>
    /// Every balance responsible party's code, keyed by id. Reference data, so it is not behind
    /// any tenant filter and there are a handful of rows — one query per request rather than a
    /// join, which keeps the page query a single index scan.
    /// </summary>
    internal static async Task<Dictionary<Guid, string>> BrpCodesAsync(
        PeakPowerDbContext db, CancellationToken cancellationToken) =>
        await db.Brps
            .AsNoTracking()
            .ToDictionaryAsync(brp => brp.Id, brp => brp.Code, cancellationToken);

    /// <summary>
    /// The same clamp <c>CustomerEndpoints.ListAsync</c> applies, and for the same reason: a
    /// caller that asks for page 0 or a page of a million gets a sane page rather than an error,
    /// because neither is a mistake worth failing a screen over.
    /// </summary>
    internal static (int Number, int Size) Paging(int page, int pageSize) =>
        (page < 1 ? 1 : page,
         pageSize is < 1 or > MaximumPageSize ? DefaultPageSize : pageSize);
}
```

- [ ] **Step 6: Map them in the composition root**

In `src/Hosts/PeakPower.Api.Employee/Program.cs`, after `app.MapReferenceDataEndpoints();` at
line 344:

```csharp
app.MapDataHealthEndpoints();
```

and add `using PeakPower.Api.Employee.Endpoints;` if the file does not already have it — it does,
for the other four `Map*Endpoints` calls. Confirm rather than duplicating.

- [ ] **Step 7: Move the employee endpoint count**

In `tests/PeakPower.Integration.Tests/Employee/EmployeeRouteTableTests.cs`, replace `:89-94`:

```csharp
    /// <summary>
    /// The endpoints the employee host maps outside the framework prefixes: one reference-data,
    /// four customer, three account, three metering-point, four back-office auth, the realm's JWKS
    /// document, and slice 2's two data-health reads.
    /// </summary>
    private const int EmployeeEndpointCount = 18;
```

⚠ The assertion is `ShouldBeGreaterThanOrEqualTo`, so this would stay green unmoved — which is
exactly why the doc comment on it says a new endpoint is a deliberate one-line update here. Moving
it is what keeps the number a statement about the host rather than a floor nobody maintains.

- [ ] **Step 8: Run the tests and watch them pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~DataHealthMessageTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~DataHealthQuarantineTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~EmployeeRouteTableTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~EmployeeAnonymousEndpointAllowListTests"
```
Expected: all PASS — 7 + 5 + 4 + the allow-list's own, and the allow-list is **unchanged**: both
new routes require a back-office token.

- [ ] **Step 9: Mutation-verify the filters exclude rather than order**

Make the BRP filter unconditional by dropping the `is { }` guard:

```csharp
        query = query.Where(message => message.BrpId == brpId);
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~The_log_carries_the_message_its_brp_code_and_its_status"`
Expected: FAIL with
`System.InvalidOperationException : Sequence contains no matching element` from the `Single(...)`
— with no `brpId` in the query the filter now matches `brp_id = NULL`, which matches nothing.

Then the other direction, which is the one that reads as working: restore the guard and change the
status filter to an `OrderBy` instead of a `Where`:

```csharp
        var query = db.Set<InboundMessage>().AsNoTracking();
        // ... brpId filter unchanged ...
        if (wanted is { } state)
        {
            query = query.OrderBy(message => message.Status == state ? 0 : 1);
        }
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~A_failed_message_carries_its_code_and_its_human_readable_message"`
Expected: FAIL with
`Shouldly.ShouldAssertException : log.Items should satisfy the condition (item) => item.Status == "FAILED" but does not`
and the message *"the status filter must exclude, not merely order"*.

⚠ This is the mutation that matters. A filter that sorts rather than excludes puts the right rows
at the top of the screen, so the operator sees what they expected and the bug is invisible until
somebody scrolls. Restore both and re-run to green.

- [ ] **Step 10: Mutation-verify the age computation**

Change the age to round rather than floor and drop the clamp:

```csharp
            (int)Math.Round((now - series.ReceivedAt).TotalHours),
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~A_quarantined_series_carries_its_reason_its_resource_object_and_its_age"`
Expected: **PASS**, because the assertion is `ShouldBeInRange(26, 27)` and rounding 26.0 gives 26.

So mutate the case the assertion is actually for. Restore the floor, then change the arrangement's
`Now.AddHours(-26)` to `Now.AddHours(-26).AddMinutes(-59)` locally and re-run: expect PASS at 26
under the floor and **FAIL at 27** under `Math.Round`. That is the real difference between the two
— an entry two minutes short of a day reading as a whole day older than it is, in a panel whose
whole job is to sort by age. Restore the arrangement and the floor, and re-run to green.

⚠ CLAUDE.md records this exact failure mode: a guard mutation-verified against the easy
neighbouring case certifies a half-working guard. Do not skip the second half.

- [ ] **Step 11: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Employee/Endpoints/DataHealthEndpoints.cs \
        src/Hosts/PeakPower.Api.Employee/Mapping/DataHealthMappings.cs \
        src/Hosts/PeakPower.Api.Employee/Program.cs \
        tests/PeakPower.Integration.Tests/Employee/DataHealthFixtures.cs \
        tests/PeakPower.Integration.Tests/Employee/DataHealthMessageTests.cs \
        tests/PeakPower.Integration.Tests/Employee/DataHealthQuarantineTests.cs \
        tests/PeakPower.Integration.Tests/Employee/EmployeeRouteTableTests.cs
git commit -m "feat(employee-api): the inbound message log and the quarantine panel [F02-R03] [F02-R14]

Both .BackOffice(reason): this host runs unscoped by construction, so neither needs
tenancy work and a .TenantScoped here would fail EmployeeRouteTableTests by name.

The two per-row counts are grouped queries over the page's ids rather than correlated
subqueries: inbound_message grows by one row per document per EAN per day [DEC-38], so
this is the one screen in the slice where a per-row round trip is measurable.

ageHours comes from IMarketCalendar.UtcNow, read once per page - two rows of one page
must not report different ages for the same receipt time - and architecture fact 5
would fail the build on a direct clock read anyway.

Verified: turning the status filter into an OrderBy left the right rows at the top of
the screen and every wrong row still on it, which is the shape of bug an operator would
never notice; and rounding rather than flooring the age made an entry two minutes short
of a day read as a whole day older, in the one panel whose job is to sort by age.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 11: `GET /data-health/metering-points` — the heat map, and the silence signal

The third of shared contract §10.4's four responses, and the one design §7.21 is written against:
*"a metering point that receives nothing for two of the BRP's `expected_cadence` windows appears as
silent on the employee data-health screen; one that receives on cadence does not."* The silence
**condition** is plan 5's `SilenceDetectionJob` writing `METERING_POINT_SILENT` into
`metering.operational_alert`; `isSilent` here is the **read of what that job decided**, so the
screen and the job cannot disagree about which connections are silent. This endpoint raises no
alert and resolves none.

⚠ **Twenty-one cells, not fourteen.** `DataHealthEndpoints.EmployeeHeatMapDays = 21`;
`ConsumptionReader.CustomerStripDays = 14` is Task 8's and stays where it is. The two numbers come
from different mockups (`employee-ingestion-health.svg` and `ean-detail.svg`) and neither is a typo.
The strip is **dense and oldest first** by the same argument Task 3's
`RecentDayStatesAsync` makes: a date with no stored row is `NO_DATA`, not an absent entry, because
the heat map draws a fixed number of cells and cannot colour a day the payload does not mention.

⚠ **`brpId` is `Guid?` and `brpCode` is `string?` while `customer.metering_point.brp_id` is
`NOT NULL`** (shared contract §6.2 — migration 9 adds `brp_assigned_at` and does **not** relax the
column). So in slice 2 a row with no BRP cannot be arranged in the database, and the nullability is
the read surface refusing to depend on that staying true — design §3.1 requires this list to
"include points with no BRP assigned". What that costs in code is one line, `BrpCodeOrNull`, and
what it buys is that the list query selects from `customer.metering_point` **alone** and resolves
the code by dictionary lookup afterwards. An inner join onto `metering.brp` would read identically
today and drop every unrouted point the day the column is relaxed. The same belt-and-braces
`ConnectionEndpoints.BrpNameAsync` already makes for its own "Unknown" fallback.

⚠ **`state=` means "has at least one day in that state inside the window"**, not "the most recent
day is in that state" — decision 3 of the four above, and Step 8 mutation-verifies it against the
most-recent-day reading.

**Files:**
- Modify: `src/Hosts/PeakPower.Api.Employee/Endpoints/DataHealthEndpoints.cs` (Task 10 created it —
  one route in `MapDataHealthEndpoints`, one handler, two helpers)
- Modify: `src/Hosts/PeakPower.Api.Employee/Mapping/DataHealthMappings.cs` (Task 10 created it —
  one `ToDto` overload and `BrpCodeOrNull`)
- Modify: `tests/PeakPower.Integration.Tests/Employee/DataHealthFixtures.cs` (Task 10 created it —
  three arrangements)
- Create: `tests/PeakPower.Integration.Tests/Employee/DataHealthMeteringPointTests.cs`
- Modify: `tests/PeakPower.Integration.Tests/Employee/EmployeeRouteTableTests.cs:94` — `18` → `19`

**Interfaces:**
- Consumes: `EnumWireFormat.ToWire` / `.TryParse` / `.Names` and `ApiResults.InvalidRequest`
  (slice 1); `TenancyEndpointExtensions.BackOffice` (slice 1); `IMarketCalendar.TodayInAmsterdam`
  (slice 1); `MeteringPoint` (`Ean`, `DisplayLabel`, `CustomerId`, `BrpId`,
  `ProductionExpectation`) and `Customer.LegalName` (slice 1); `MeteringPointDayState`,
  `OperationalAlert` (plan 2); `EmployeeDayStateDto`, `DataHealthMeteringPointDto`,
  `DataHealthMeteringPointListResponse` (Task 9); `DataHealthEndpoints.BrpCodesAsync` and
  `.Paging` (Task 10).
- Produces:
  - route `GET /api/v1/data-health/metering-points`
  - `public const int DataHealthEndpoints.EmployeeHeatMapDays = 21`
  - `internal static IReadOnlyList<EmployeeDayStateDto> DataHealthEndpoints.HeatMap(IReadOnlyDictionary<DateOnly, MeteringDayState>? stored, DateOnly from, int days)`
  - `public static DataHealthMeteringPointDto DataHealthMappings.ToDto(MeteringPoint point, string customerLegalName, IReadOnlyDictionary<Guid, string> brpCodes, DateOnly? lastDataDate, bool isSilent, IReadOnlyList<EmployeeDayStateDto> recentDataStates)`
  - `internal static string? DataHealthMappings.BrpCodeOrNull(IReadOnlyDictionary<Guid, string> brpCodes, Guid brpId)`

- [ ] **Step 1: Add the three arrangements the heat map needs**

Append to `tests/PeakPower.Integration.Tests/Employee/DataHealthFixtures.cs`, inside the class:

```csharp
    /// <summary>
    /// One row of <c>metering.metering_point_day_state</c>. Raw SQL for the reason this whole class
    /// is: shared contract §6.7 pins every column, frozen, and plan 2 owns whatever the C# factory
    /// becomes.
    /// </summary>
    public async Task DayStateAsync(
        Guid meteringPointId,
        Guid customerId,
        DateOnly deliveryDate,
        MeteringDayState state,
        CancellationToken ct)
    {
        await using var connection = await OpenAsync(ct);
        await connection.ExecuteAsync(
            """
            INSERT INTO metering.metering_point_day_state
                   (metering_point_id, delivery_date, customer_id, state,
                    expected_interval_count, consumption_complete, production_complete,
                    production_is_declared_zero, computed_at)
            VALUES (@meteringPointId, @deliveryDate, @customerId, @state, 96,
                    @complete, false, false, now())
            ON CONFLICT (metering_point_id, delivery_date) DO UPDATE SET state = EXCLUDED.state
            """,
            new
            {
                meteringPointId,
                deliveryDate,
                customerId,
                state = PeakPower.Infrastructure.Web.Http.EnumWireFormat.ToWire(state),
                // A day that reached PROVISIONAL or FINAL has its consumption series complete by
                // construction (integration-spec §8.3). Writing false there would be storable and
                // wrong, and this class's rows are read back by assertions about the SCREEN, not
                // about completeness - so the one honest value is the one the state implies.
                complete = state is MeteringDayState.Provisional or MeteringDayState.Final,
            });
    }

    /// <summary>
    /// One <c>METERING_POINT_SILENT</c> operational alert [F02-R26]. Open when
    /// <paramref name="resolvedAt"/> is null - which is the predicate <c>ix_alert_open</c> indexes
    /// and the one the endpoint reads.
    /// </summary>
    public async Task<Guid> SilenceAlertAsync(
        Guid meteringPointId,
        DateTimeOffset raisedAt,
        DateTimeOffset? resolvedAt,
        CancellationToken ct)
    {
        var id = Guid.CreateVersion7();

        await using var connection = await OpenAsync(ct);
        await connection.ExecuteAsync(
            """
            INSERT INTO metering.operational_alert
                   (id, kind, status, metering_point_id, summary, raised_at, resolved_at)
            VALUES (@id, 'METERING_POINT_SILENT', @status, @meteringPointId, @summary,
                    @raisedAt, @resolvedAt)
            """,
            new
            {
                id,
                // Both columns are written, and the endpoint reads only resolved_at. Writing one
                // and leaving the other is how the two would start disagreeing, and ck_* does not
                // stop it - the CHECK is on the value set, not on the pair.
                status = resolvedAt is null ? "OPEN" : "RESOLVED",
                meteringPointId,
                // Shared contract §14: one sentence, sentence case, ending with a full stop, and
                // every number carries its provenance. EmployeeRouteTableTests does not read this
                // string, but AlertCopy (plan 5) is held to the same rule and a fixture that broke
                // it would be the first place somebody copied the wrong shape from.
                summary = "No metering data has arrived for two consecutive expected windows.",
                raisedAt,
                resolvedAt,
            });

        return id;
    }

    /// <summary>
    /// A metering point attached to a named balance responsible party, for the cases
    /// <c>TenancyFixture</c>'s two points cannot cover: a second BRP, and an INACTIVE one.
    /// </summary>
    /// <remarks>
    /// Written through the aggregate rather than by raw SQL, because <c>customer.metering_point</c>
    /// is slice 1's table and <c>MeteringPoint.Attach</c> is slice 1's pinned factory - the
    /// raw-SQL argument this class makes applies to migration 9's seven tables and to nothing else.
    /// </remarks>
    public async Task<Guid> MeteringPointAsync(
        PeakPowerDbContext db, Guid customerId, Guid brpId, string ean, string? name,
        CancellationToken ct)
    {
        var point = MeteringPoint.Attach(
            customerId,
            PeakPower.Domain.Common.EanCode.Create(ean).Value,
            brpId,
            PeakPower.Domain.Customers.ProductionExpectation.Unknown,
            expectationSource: null,
            name: name,
            description: null,
            gridOperator: "Stedin",
            capacityKw: 400m,
            address: null,
            validFrom: new DateOnly(2024, 1, 1)).Value;

        db.MeteringPoints.Add(point);
        await db.SaveChangesAsync(ct);
        return point.Id;
    }
```

and add to the file's using directives:

```csharp
using PeakPower.Domain.Customers;
using PeakPower.Persistence;
```

- [ ] **Step 2: Write the failing tests**

Create `tests/PeakPower.Integration.Tests/Employee/DataHealthMeteringPointTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using PeakPower.Api.Employee.Mapping;
using PeakPower.Application.Abstractions;
using PeakPower.Contracts.Employee;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Domain.Metering;
using PeakPower.Integration.Tests.Tenancy;
using Xunit;

namespace PeakPower.Integration.Tests.Employee;

/// <summary>
/// <c>GET /api/v1/data-health/metering-points</c> — the per-connection twenty-one-day heat map and
/// the silence signal (<c>specs/60-mockups/employee-ingestion-health.svg</c>, design §7.21).
/// </summary>
[Collection(nameof(TenancyCollection))]
public sealed class DataHealthMeteringPointTests : IAsyncLifetime
{
    private readonly TenancyFixture _fixture;
    private EmployeeApiFactory _factory = null!;
    private HttpClient _client = null!;
    private DataHealthFixtures _data = null!;

    public DataHealthMeteringPointTests(TenancyFixture fixture) => _fixture = fixture;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new EmployeeApiFactory(_fixture.OwnerConnectionString);
        _client = await _factory.CreateBackOfficeClientAsync(Ct);
        _data = new DataHealthFixtures(_fixture.OwnerConnectionString);
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    /// <summary>
    /// The strip ends on TODAY in Amsterdam, so the arrangement has to know which day that is.
    /// Read from the host's own <see cref="IMarketCalendar"/> rather than computed here: a test
    /// that took its own "today" from the wall clock would disagree with the handler for the hour
    /// either side of midnight CET, and architecture fact 5 forbids it reading a clock anyway.
    /// </summary>
    private DateOnly Today => _factory.Services.GetRequiredService<IMarketCalendar>().TodayInAmsterdam;

    private DateTimeOffset Now => _factory.Services.GetRequiredService<IMarketCalendar>().UtcNow;

    private Task<DataHealthMeteringPointListResponse?> ListAsync(string query) =>
        _client.GetFromJsonAsync<DataHealthMeteringPointListResponse>(
            $"/api/v1/data-health/metering-points?{query}", Ct);

    [Fact]
    public async Task A_row_carries_the_ean_the_customer_and_the_balance_responsible_party()
    {
        var list = await ListAsync("pageSize=200");

        var row = list!.Items.Single(item => item.MeteringPointId == _fixture.CompanyAMeteringPointId);
        row.Ean.ShouldBe("871687110000000101");
        row.EanDisplay.ShouldBe("8716 8711 0000 0000 101",
            "grouped in fours by EanCode.ToDisplayString - the raw eighteen digits are what a "
            + "client must send back, and the grouped form is what a human reads");
        row.DisplayLabel.ShouldBe("8716 8711 0000 0000 101",
            "the fixture's point has no name, and DisplayLabel falls back to the grouped EAN "
            + "[F01-R30] [F01-R31]");
        row.CustomerId.ShouldBe(_fixture.CompanyAId);
        row.CustomerLegalName.ShouldBe("Zonneweide Beheer B.V.");
        row.BrpId.ShouldBe(_fixture.BrpId);
        row.BrpCode.ShouldBe("PVNED");
        row.ProductionExpectation.ShouldBe("UNKNOWN",
            "shared contract §4 - the wire spelling is the database spelling");

        list.Page.ShouldBe(1);
        list.PageSize.ShouldBe(200);
        list.Total.ShouldBeGreaterThanOrEqualTo(2, "the total spans every page, not this one");
    }

    /// <summary>
    /// Twenty-one cells, dense and oldest first, ending on today. This is the assertion design
    /// §7.20 names as "the per-connection 21-day heat map".
    /// </summary>
    [Fact]
    public async Task The_strip_is_twenty_one_days_dense_oldest_first_and_ends_on_today()
    {
        var today = Today;
        await _data.DayStateAsync(
            _fixture.CompanyAMeteringPointId, _fixture.CompanyAId,
            today.AddDays(-1), MeteringDayState.Final, Ct);
        await _data.DayStateAsync(
            _fixture.CompanyAMeteringPointId, _fixture.CompanyAId,
            today.AddDays(-3), MeteringDayState.Partial, Ct);

        var list = await ListAsync("pageSize=200");
        var row = list!.Items.Single(item => item.MeteringPointId == _fixture.CompanyAMeteringPointId);

        row.RecentDataStates.Count.ShouldBe(21,
            "twenty-one for the back office and fourteen for the customer strip - the two numbers "
            + "come from different mockups and neither is a typo");
        row.RecentDataStates[0].Date.ShouldBe(today.AddDays(-20));
        row.RecentDataStates[^1].Date.ShouldBe(today);

        row.RecentDataStates
            .Select(day => day.Date)
            .ShouldBe([.. Enumerable.Range(0, 21).Select(offset => today.AddDays(-20 + offset))],
                "dense and oldest first: the heat map draws a fixed number of cells and cannot "
                + "colour a day the payload does not mention");

        row.RecentDataStates.Single(day => day.Date == today.AddDays(-1)).State.ShouldBe("FINAL");
        row.RecentDataStates.Single(day => day.Date == today.AddDays(-3)).State.ShouldBe("PARTIAL");
        row.RecentDataStates.Single(day => day.Date == today.AddDays(-2)).State.ShouldBe("NO_DATA",
            "a date with no stored row is NO_DATA, not an absent entry");
    }

    /// <summary>
    /// <c>lastDataDate</c> is the newest day that is NOT <c>NO_DATA</c>. The predicate is
    /// load-bearing for exactly the reason <c>ConsumptionReader.LastDataDateAsync</c> records:
    /// <c>NO_DATA</c> is a STORED state [F02-R22], so a plain MAX would point the operator at an
    /// empty day.
    /// </summary>
    [Fact]
    public async Task Last_data_date_ignores_a_stored_NO_DATA_day()
    {
        var today = Today;
        await _data.DayStateAsync(
            _fixture.CompanyAMeteringPointId, _fixture.CompanyAId,
            today.AddDays(-5), MeteringDayState.Provisional, Ct);
        await _data.DayStateAsync(
            _fixture.CompanyAMeteringPointId, _fixture.CompanyAId,
            today.AddDays(-4), MeteringDayState.NoData, Ct);

        var list = await ListAsync("pageSize=200");
        var row = list!.Items.Single(item => item.MeteringPointId == _fixture.CompanyAMeteringPointId);

        row.LastDataDate.ShouldBe(today.AddDays(-5),
            "NO_DATA is a stored state, not the absence of a row - a MAX that counted it would "
            + "send the operator to an empty day");
    }

    /// <summary>
    /// Design §7.21. The condition is plan 5's; this asserts the READ of it, in both directions -
    /// a point with an open alert is silent, and a point whose alert was resolved is not.
    /// </summary>
    [Fact]
    public async Task A_point_with_an_open_silence_alert_is_silent_and_one_whose_alert_closed_is_not()
    {
        await _data.SilenceAlertAsync(
            _fixture.CompanyAMeteringPointId, Now.AddHours(-30), resolvedAt: null, Ct);
        await _data.SilenceAlertAsync(
            _fixture.CompanyBMeteringPointId, Now.AddHours(-30), Now.AddHours(-1), Ct);

        var list = await ListAsync("pageSize=200");

        list!.Items.Single(item => item.MeteringPointId == _fixture.CompanyAMeteringPointId)
            .IsSilent.ShouldBeTrue();
        list.Items.Single(item => item.MeteringPointId == _fixture.CompanyBMeteringPointId)
            .IsSilent.ShouldBeFalse(
                "a point that went quiet and came back is one recovery, and the screen must stop "
                + "calling it silent the moment the alert is resolved");
    }

    [Fact]
    public async Task The_list_can_be_narrowed_to_the_silent_connections_only()
    {
        await _data.SilenceAlertAsync(
            _fixture.CompanyAMeteringPointId, Now.AddHours(-30), resolvedAt: null, Ct);

        var list = await ListAsync("silentOnly=true&pageSize=200");

        list!.Items.Select(item => item.MeteringPointId)
            .ShouldContain(_fixture.CompanyAMeteringPointId);
        list.Items.ShouldAllBe(item => item.IsSilent,
            "the silentOnly filter must exclude, not merely order");
    }

    /// <summary>
    /// Decision 3 of the four this plan flags: <c>state=</c> is "has at least one day in that state
    /// inside the twenty-one-day window", not "the most recent day is in that state". A PARTIAL day
    /// three days ago is exactly the thing that must not scroll off the filter because yesterday
    /// came in clean.
    /// </summary>
    [Fact]
    public async Task The_state_filter_finds_a_bad_day_anywhere_in_the_window_not_only_the_newest()
    {
        var today = Today;
        await _data.DayStateAsync(
            _fixture.CompanyAMeteringPointId, _fixture.CompanyAId,
            today.AddDays(-6), MeteringDayState.Partial, Ct);
        await _data.DayStateAsync(
            _fixture.CompanyAMeteringPointId, _fixture.CompanyAId,
            today.AddDays(-1), MeteringDayState.Final, Ct);

        var list = await ListAsync("state=PARTIAL&pageSize=200");

        list!.Items.Select(item => item.MeteringPointId)
            .ShouldContain(_fixture.CompanyAMeteringPointId,
                "the point's newest day is FINAL and its window still holds a PARTIAL day - "
                + "filtering on the newest day only would hide the day the operator is hunting");

        list.Items.ShouldAllBe(
            item => item.RecentDataStates.Any(day => day.State == "PARTIAL"),
            "the state filter must exclude, not merely order");
    }

    [Fact]
    public async Task An_unknown_state_filter_is_400_and_lists_the_four_that_exist()
    {
        using var response = await _client.GetAsync(
            "/api/v1/data-health/metering-points?state=COMPLETE", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var body = await response.Content.ReadAsStringAsync(Ct);
        using var document = System.Text.Json.JsonDocument.Parse(body);
        var errors = document.RootElement.GetProperty("errors").GetProperty("state");
        errors[0].GetString().ShouldContain("PROVISIONAL", Case.Sensitive);
        errors[0].GetString().ShouldNotContain("COMPLETE", Case.Sensitive,
            "there is no COMPLETE member of MeteringDayState - F02 §6's state machine goes "
            + "NO_DATA -> PARTIAL -> PROVISIONAL -> FINAL, and integration-spec §8.3's word "
            + "\"Complete\" is the CONDITION that moves a day to PROVISIONAL");
    }

    /// <summary>
    /// Design §7.7's inactive-BRP case, read from the screen rather than from the pipeline: a BRP
    /// row set inactive stops NEW documents being accepted, and must not make the connections
    /// behind it disappear from the back office. Somebody diagnosing why a customer's data stopped
    /// is looking for exactly these rows.
    /// </summary>
    [Fact]
    public async Task A_point_on_an_inactive_balance_responsible_party_is_still_listed()
    {
        var retired = await _data.EnsureBrpAsync(
            "ZZRETIRE", "Zeeuwse Retire B.V.", isActive: false, Ct);

        await using var db = _factory.CreateOwnerDbContext();
        var pointId = await _data.MeteringPointAsync(
            db, _fixture.CompanyAId, retired, "871687110000000318", "Vestiging Vlissingen", Ct);

        var list = await ListAsync("pageSize=200");

        var row = list!.Items.Single(item => item.MeteringPointId == pointId);
        row.BrpCode.ShouldBe("ZZRETIRE",
            "an inactive BRP is still named on the row - the operator needs to see WHICH party "
            + "stopped sending, not a blank");
        row.DisplayLabel.ShouldBe("Vestiging Vlissingen",
            "the name replaces the EAN as the primary label [F01-R30]");
    }

    /// <summary>
    /// Design §3.1 requires this list to include points with no balance responsible party
    /// assigned. <c>customer.metering_point.brp_id</c> is NOT NULL in slice 2 (shared contract
    /// §6.2 relaxes nothing), so the case cannot be ARRANGED in the database - which is precisely
    /// why it is asserted here, against the composition, rather than left to the day the column
    /// changes and nobody remembers.
    /// </summary>
    [Fact]
    public void A_point_whose_balance_responsible_party_code_does_not_resolve_is_still_a_row()
    {
        var point = MeteringPoint.Attach(
            _fixture.CompanyAId,
            EanCode.Create("871687110000000325").Value,
            Guid.CreateVersion7(),
            ProductionExpectation.Never,
            expectationSource: null,
            name: null,
            description: null,
            gridOperator: "Stedin",
            capacityKw: 120m,
            address: null,
            validFrom: new DateOnly(2024, 1, 1)).Value;

        var row = DataHealthMappings.ToDto(
            point,
            "Zonneweide Beheer B.V.",
            // Empty on purpose: this is the lookup MISSING, which is what a point with no BRP
            // assigned looks like to the mapping.
            new Dictionary<Guid, string>(),
            lastDataDate: null,
            isSilent: false,
            recentDataStates: []);

        row.BrpCode.ShouldBeNull(
            "a code the lookup cannot resolve is null, not \"Unknown\" and not an exception - "
            + "design §3.1 requires the unrouted point to appear on this list");
        row.BrpId.ShouldBe(point.BrpId);
        row.MeteringPointId.ShouldBe(point.Id);
        row.ProductionExpectation.ShouldBe("NEVER");
    }

    [Fact]
    public async Task The_metering_point_list_refuses_a_caller_with_no_back_office_token()
    {
        using var anonymous = _factory.CreateEmployeeClient();

        using var response = await anonymous.GetAsync("/api/v1/data-health/metering-points", Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
    }
}
```

- [ ] **Step 3: Run them and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~DataHealthMeteringPointTests"`
Expected: FAIL to compile —
`error CS1501: No overload for method 'ToDto' takes 6 arguments`, from
`A_point_whose_balance_responsible_party_code_does_not_resolve_is_still_a_row`.

- [ ] **Step 4: Write the mapping**

Append to `src/Hosts/PeakPower.Api.Employee/Mapping/DataHealthMappings.cs`, inside the class:

```csharp
    /// <summary>
    /// One connection as the ingestion-health screen shows it.
    /// </summary>
    /// <param name="brpCodes">
    /// Every balance responsible party's code, keyed by id — read once for the whole page by
    /// <c>DataHealthEndpoints.BrpCodesAsync</c>. Passed as the whole dictionary rather than as a
    /// resolved string so that <see cref="BrpCodeOrNull"/> is the single place the miss is decided,
    /// which is the case design §3.1 is about.
    /// </param>
    public static DataHealthMeteringPointDto ToDto(
        MeteringPoint point,
        string customerLegalName,
        IReadOnlyDictionary<Guid, string> brpCodes,
        DateOnly? lastDataDate,
        bool isSilent,
        IReadOnlyList<EmployeeDayStateDto> recentDataStates) =>
        new(point.Id,
            point.Ean.Value,
            point.Ean.ToDisplayString(),
            point.DisplayLabel,
            point.CustomerId,
            customerLegalName,
            point.BrpId,
            BrpCodeOrNull(brpCodes, point.BrpId),
            EnumWireFormat.ToWire(point.ProductionExpectation),
            lastDataDate,
            isSilent,
            recentDataStates);

    /// <summary>
    /// The code, or <c>null</c> when the lookup misses.
    /// </summary>
    /// <remarks>
    /// ⚠ <b>An indexer here would be a <c>KeyNotFoundException</c> on the one row design §3.1
    /// names.</b> <c>customer.metering_point.brp_id</c> is NOT NULL today, so the miss cannot
    /// happen yet — and that is the argument FOR writing it, not against: the day the column is
    /// relaxed so that a connection can be created before it is routed, this returns null and the
    /// screen shows the point, instead of the whole page 500ing. The same belt-and-braces
    /// <c>ConnectionEndpoints.BrpNameAsync</c> already makes for its own "Unknown" fallback, with
    /// the difference that null is the honest answer on a back-office screen: "Unknown" reads as a
    /// party called Unknown.
    /// </remarks>
    internal static string? BrpCodeOrNull(IReadOnlyDictionary<Guid, string> brpCodes, Guid brpId) =>
        brpCodes.TryGetValue(brpId, out var code) ? code : null;
```

and add `using PeakPower.Domain.Customers;` to the file's using directives — `MeteringPoint` and
`ProductionExpectation` live there, not in `PeakPower.Domain.Metering`.

- [ ] **Step 5: Write the route and the handler**

In `src/Hosts/PeakPower.Api.Employee/Endpoints/DataHealthEndpoints.cs`, add the constant beside
`MaximumPageSize`:

```csharp
    /// <summary>
    /// The back office's heat map is TWENTY-ONE cells wide (<c>employee-ingestion-health.svg</c>);
    /// the customer's strip is fourteen (<c>ean-detail.svg</c>, <c>ConsumptionReader.CustomerStripDays</c>).
    /// Two numbers, two mockups, neither a typo — named here rather than inlined so the difference
    /// is a decision a reader can see rather than a literal they have to notice.
    /// </summary>
    public const int EmployeeHeatMapDays = 21;
```

register the route in `MapDataHealthEndpoints`, after the `/quarantine` registration and before
`return routes;`:

```csharp
        group.MapGet("/metering-points", MeteringPointsAsync)
            .WithName("ListDataHealthMeteringPoints")
            .WithSummary(
                "Every connection with its recent data states and its silence signal. [F02-R26]")
            .Produces<DataHealthMeteringPointListResponse>()
            .ProducesValidationProblem()
            .BackOffice(BackOfficeReason);
```

and add the handler and its one helper, after `QuarantineAsync`:

```csharp
    // -------------------------------------------------------------------- the connection heat map

    private static async Task<IResult> MeteringPointsAsync(
        string? state,
        bool? silentOnly,
        int page,
        int pageSize,
        PeakPowerDbContext db,
        IMarketCalendar calendar,
        CancellationToken cancellationToken)
    {
        MeteringDayState? wanted = null;

        if (!string.IsNullOrWhiteSpace(state))
        {
            if (!EnumWireFormat.TryParse<MeteringDayState>(state, out var parsed))
            {
                return ApiResults.InvalidRequest(
                    "state",
                    "State must be one of: "
                    + $"{string.Join(", ", EnumWireFormat.Names<MeteringDayState>())}.");
            }

            wanted = parsed;
        }

        var (number, size) = Paging(page, pageSize);

        // ONE read of today for the whole request. Two rows of one page must not be able to end
        // their strips on different days, which is what reading the calendar per row would allow
        // for the request that straddles midnight in Amsterdam.
        var today = calendar.TodayInAmsterdam;
        var from = today.AddDays(-(EmployeeHeatMapDays - 1));

        // db.MeteringPoints BY NAME, not db.Set<MeteringPoint>(): this is slice 1's entity and
        // slice 1's contract pins the property. The four new tables are reached through Set<T>
        // because shared contract §5 pins their TYPE names and not plan 2's DbSet properties.
        var query = db.MeteringPoints.AsNoTracking();

        if (wanted is { } dayState)
        {
            // "Has at least one day in that state inside the window" - decision 3. EXISTS over the
            // window rather than a join onto the newest row: the operator filtering the heat map is
            // hunting the bad cell wherever it is, and a PARTIAL day six days ago must not scroll
            // off the filter because yesterday came in clean.
            query = query.Where(point => db.Set<MeteringPointDayState>()
                .Any(day => day.MeteringPointId == point.Id
                            && day.DeliveryDate >= from
                            && day.DeliveryDate <= today
                            && day.State == dayState));
        }

        // Tri-state read as two: absent and false both mean "every connection", because there is no
        // such thing as "only the connections that are NOT silent" on this screen. `silentOnly` is
        // the parameter §10.4 names, and it is a narrowing switch rather than the quarantine
        // panel's `resolved` tri-state.
        if (silentOnly == true)
        {
            query = query.Where(point => db.Set<OperationalAlert>()
                .Any(alert => alert.MeteringPointId == point.Id
                              && alert.Kind == OperationalAlertKind.MeteringPointSilent
                              && alert.ResolvedAt == null));
        }

        var total = await query.CountAsync(cancellationToken);

        var points = await query
            // By id, which is a version-7 GUID and so attachment order, and which is stable across
            // two requests. NOT by EAN: EanCode is persisted through a value converter, and a
            // Select or an OrderBy that reaches inside a converted property does not translate to
            // SQL - EmployeeMappings' own doc comment records the same constraint.
            .OrderBy(point => point.Id)
            .Skip((number - 1) * size)
            .Take(size)
            .ToListAsync(cancellationToken);

        var pointIds = points.Select(point => point.Id).ToArray();
        var customerIds = points.Select(point => point.CustomerId).Distinct().ToArray();

        var legalNames = await db.Customers
            .AsNoTracking()
            .Where(customer => customerIds.Contains(customer.Id))
            .Select(customer => new { customer.Id, customer.LegalName })
            .ToDictionaryAsync(row => row.Id, row => row.LegalName, cancellationToken);

        var brpCodes = await BrpCodesAsync(db, cancellationToken);

        // The newest day that is NOT NO_DATA. The predicate is load-bearing for the reason
        // ConsumptionReader.LastDataDateAsync records: NO_DATA is a STORED state [F02-R22], so a
        // plain MAX would point the operator at an empty day.
        var lastDataDates = await db.Set<MeteringPointDayState>()
            .AsNoTracking()
            .Where(day => pointIds.Contains(day.MeteringPointId)
                          && day.State != MeteringDayState.NoData)
            .GroupBy(day => day.MeteringPointId)
            .Select(group => new { PointId = group.Key, Last = group.Max(day => day.DeliveryDate) })
            .ToDictionaryAsync(row => row.PointId, row => row.Last, cancellationToken);

        // One query for the whole page's window, densified in memory. Twenty-one round trips per
        // page is the shape [NFR-04] fails on, and it is the same argument the message log's two
        // grouped counts make.
        var window = await db.Set<MeteringPointDayState>()
            .AsNoTracking()
            .Where(day => pointIds.Contains(day.MeteringPointId)
                          && day.DeliveryDate >= from
                          && day.DeliveryDate <= today)
            .Select(day => new { day.MeteringPointId, day.DeliveryDate, day.State })
            .ToListAsync(cancellationToken);

        var storedByPoint = window
            .GroupBy(row => row.MeteringPointId)
            .ToDictionary(
                group => group.Key,
                group => (IReadOnlyDictionary<DateOnly, MeteringDayState>)group
                    .ToDictionary(row => row.DeliveryDate, row => row.State));

        var silentIds = (await db.Set<OperationalAlert>()
                .AsNoTracking()
                .Where(alert => alert.MeteringPointId != null
                                && pointIds.Contains(alert.MeteringPointId.Value)
                                && alert.Kind == OperationalAlertKind.MeteringPointSilent
                                // resolved_at IS NULL, which is the predicate ix_alert_open
                                // indexes and the one IOperationalAlertRaiser.ResolveOpenAsync
                                // writes. A point that went quiet and came back is one recovery,
                                // and the screen must stop calling it silent the moment the alert
                                // is resolved.
                                && alert.ResolvedAt == null)
                .Select(alert => alert.MeteringPointId!.Value)
                .Distinct()
                .ToListAsync(cancellationToken))
            .ToHashSet();

        var items = points
            .Select(point => DataHealthMappings.ToDto(
                point,
                legalNames.TryGetValue(point.CustomerId, out var legalName)
                    ? legalName
                    : string.Empty,
                brpCodes,
                lastDataDates.TryGetValue(point.Id, out var last) ? last : null,
                silentIds.Contains(point.Id),
                HeatMap(
                    storedByPoint.GetValueOrDefault(point.Id), from, EmployeeHeatMapDays)))
            .ToArray();

        return Results.Ok(
            new DataHealthMeteringPointListResponse(items, total, number, size));
    }

    /// <summary>
    /// <paramref name="days"/> cells, oldest first, ending on <c>from + days - 1</c>. A date with
    /// no stored row is <c>NO_DATA</c>, never an absent entry.
    /// </summary>
    /// <remarks>
    /// The same rule <c>ConsumptionReader.RecentDayStatesAsync</c> follows for the customer's
    /// fourteen-cell strip, and deliberately the OPPOSITE of the day envelope's absent-interval
    /// rule: a strip draws a fixed number of cells and cannot colour a day the payload does not
    /// mention, while a chart draws a gap exactly where an interval is absent. A second
    /// implementation rather than a shared one because the two live on two hosts and neither may
    /// reference the other's contracts namespace — see <c>EmployeeDayStateDto</c>'s own remarks.
    /// </remarks>
    internal static IReadOnlyList<EmployeeDayStateDto> HeatMap(
        IReadOnlyDictionary<DateOnly, MeteringDayState>? stored, DateOnly from, int days) =>
    [
        .. Enumerable.Range(0, days)
            .Select(offset => from.AddDays(offset))
            .Select(date => new EmployeeDayStateDto(
                date,
                EnumWireFormat.ToWire(
                    stored is not null && stored.TryGetValue(date, out var state)
                        ? state
                        : MeteringDayState.NoData)))
    ];
```

and add `using PeakPower.Domain.Customers;` to the file's using directives.

- [ ] **Step 6: Move the employee endpoint count**

In `tests/PeakPower.Integration.Tests/Employee/EmployeeRouteTableTests.cs`, replace `:89-94`:

```csharp
    /// <summary>
    /// The endpoints the employee host maps outside the framework prefixes: one reference-data,
    /// four customer, three account, three metering-point, four back-office auth, the realm's JWKS
    /// document, and slice 2's three data-health reads.
    /// </summary>
    private const int EmployeeEndpointCount = 19;
```

- [ ] **Step 7: Run the tests and watch them pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~DataHealthMeteringPointTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~EmployeeRouteTableTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~EmployeeAnonymousEndpointAllowListTests"
```
Expected: all PASS — 9 + 4 + the allow-list's own, and the allow-list is **unchanged**: the new
route requires a back-office token.

- [ ] **Step 8: Mutation-verify the `state=` filter reads the whole window**

Replace the `EXISTS` with the reading that looks right and hides the bug — filter on the newest
stored day only:

```csharp
        if (wanted is { } dayState)
        {
            query = query.Where(point => db.Set<MeteringPointDayState>()
                .Where(day => day.MeteringPointId == point.Id)
                .OrderByDescending(day => day.DeliveryDate)
                .Select(day => day.State)
                .FirstOrDefault() == dayState);
        }
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~The_state_filter_finds_a_bad_day_anywhere_in_the_window_not_only_the_newest"`
Expected: FAIL with
`Shouldly.ShouldAssertException : list.Items.Select(item => item.MeteringPointId) should contain <guid>`
and the message *"the point's newest day is FINAL and its window still holds a PARTIAL day"*.

⚠ This is the mutation that matters, and it is the one the easy neighbouring case would have
missed: a filter keyed to the newest day returns a *plausible, non-empty* list — every connection
that is broken **right now** — so the screen looks like it is working and the connection that had
one bad day on Tuesday is simply absent. Restore and re-run to green.

- [ ] **Step 9: Mutation-verify `isSilent` reads OPEN alerts only**

Delete `&& alert.ResolvedAt == null` from the `silentIds` query.

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~A_point_with_an_open_silence_alert_is_silent_and_one_whose_alert_closed_is_not"`
Expected: FAIL with
`Shouldly.ShouldAssertException : list.Items.Single(...).IsSilent should be False but was True`
and the message *"a point that went quiet and came back is one recovery, and the screen must stop
calling it silent the moment the alert is resolved"*.

Then mutate the case the assertion is **also** for, which the first half does not reach: change the
predicate to `alert.Status == OperationalAlertStatus.Open` and drop the `ResolvedAt` test entirely.

Run the same test.
Expected: **PASS**, because `DataHealthFixtures.SilenceAlertAsync` writes both columns in
agreement. So arrange the disagreement: locally change that fixture's `status` expression to the
constant `"OPEN"`, re-run, and expect **FAIL** under the `Status` reading and **PASS** under
`ResolvedAt == null`. That is the whole difference between the two — `ix_alert_open` is
`WHERE resolved_at IS NULL`, `IOperationalAlertRaiser.ResolveOpenAsync` takes a `resolvedAt`, and a
screen keyed to the other column reads a half-written close as still open. Restore the fixture and
the predicate, and re-run to green.

- [ ] **Step 10: Mutation-verify the strip is dense**

In `HeatMap`, return only the stored rows — the "tidier" strip:

```csharp
    internal static IReadOnlyList<EmployeeDayStateDto> HeatMap(
        IReadOnlyDictionary<DateOnly, MeteringDayState>? stored, DateOnly from, int days) =>
    [
        .. (stored ?? new Dictionary<DateOnly, MeteringDayState>())
            .OrderBy(entry => entry.Key)
            .Select(entry => new EmployeeDayStateDto(
                entry.Key, EnumWireFormat.ToWire(entry.Value)))
    ];
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~The_strip_is_twenty_one_days_dense_oldest_first_and_ends_on_today"`
Expected: FAIL with
`Shouldly.ShouldAssertException : row.RecentDataStates.Count should be 21 but was 2` and the message
*"twenty-one for the back office and fourteen for the customer strip"*. Restore and re-run to green.

- [ ] **Step 11: Mutation-verify the BRP code lookup does not throw on a miss**

In `DataHealthMappings.BrpCodeOrNull`, use the indexer:

```csharp
    internal static string? BrpCodeOrNull(IReadOnlyDictionary<Guid, string> brpCodes, Guid brpId) =>
        brpCodes[brpId];
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~A_point_whose_balance_responsible_party_code_does_not_resolve_is_still_a_row"`
Expected: FAIL with
`System.Collections.Generic.KeyNotFoundException : The given key '<guid>' was not present in the dictionary.`

Then the join, which is the version a reviewer would wave through: replace the `db.MeteringPoints`
query's source with an inner join onto `db.Brps` and read the code from it —

```csharp
        var query = from point in db.MeteringPoints.AsNoTracking()
                    join brp in db.Brps.AsNoTracking() on point.BrpId equals brp.Id
                    select point;
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~DataHealthMeteringPointTests"`
Expected: **PASS**, all nine — because `brp_id` is `NOT NULL` behind an `ON DELETE RESTRICT` foreign
key, so today the join drops nothing. **That is the point.** The join is invisible until the column
is relaxed, which is exactly why the assertion that guards it is the direct call against an empty
dictionary rather than a database arrangement nobody can write. Restore both and re-run to green.

- [ ] **Step 12: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Employee/Endpoints/DataHealthEndpoints.cs \
        src/Hosts/PeakPower.Api.Employee/Mapping/DataHealthMappings.cs \
        tests/PeakPower.Integration.Tests/Employee/DataHealthFixtures.cs \
        tests/PeakPower.Integration.Tests/Employee/DataHealthMeteringPointTests.cs \
        tests/PeakPower.Integration.Tests/Employee/EmployeeRouteTableTests.cs
git commit -m "feat(employee-api): the connection heat map and the silence signal [F02-R26]

Twenty-one cells for the back office and fourteen for the customer strip: two mockups,
two numbers, neither a typo. Dense and oldest first - a date with no stored row is
NO_DATA, not an absent entry, because a strip draws a fixed number of cells and cannot
colour a day the payload does not mention.

isSilent is the READ of what plan 5's silence job decided, keyed to resolved_at IS NULL -
the predicate ix_alert_open indexes and the one ResolveOpenAsync writes. This endpoint
raises no alert and resolves none.

state= means \"has at least one day in that state inside the window\", not \"the most
recent day is in that state\". Shared contract 10.4 names the parameter and not its
predicate; this plan's decision 3 records the choice.

brpId and brpCode stay nullable although customer.metering_point.brp_id is NOT NULL,
because design 3.1 requires this list to include points with no BRP assigned. The query
selects from customer.metering_point alone and resolves the code by lookup afterwards.

Verified: filtering on the newest stored day returned a plausible, non-empty list -
every connection broken right now - and silently dropped the connection that had one bad
day on Tuesday, which is the shape of bug an operator would never notice; a strip that
returned only stored rows came back two cells wide; and the dictionary indexer threw
KeyNotFoundException on the one row design 3.1 names.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 12: `POST /data-health/messages/{id}/replay` — the full `[F02-R27]` loop

The last of shared contract §10.4's four responses, and the only mutating route in this plan.
Design §7.6 is the acceptance, in one sentence and four steps:

> An unknown EAN quarantines as `UNKNOWN_EAN` … Registering the metering point and replaying the
> stored message resolves the entry into readings, and **replaying an already-processed message
> produces no second version** (`[F02-R27]`), asserted by version count.

Design §5 step 10 says the same thing as an "independently testable by": *an unknown-EAN document
quarantines → the EAN is registered through the existing back office → the stored message is
replayed from the log → the entry resolves into readings.* Step 8 of this task is that loop, end to
end, with the version count taken from the database rather than from the response body.

⚠ **This is where `PeakPower.Api.Employee` composes `PeakPower.Ingestion` and
`PeakPower.Integration.Brp.Pvned`** — decision 1 of the four this plan flags, **now settled in the
amended shared contract §3.1**, whose project-reference table names this host and this reason:
"`PeakPower.Api.Employee` also composes both, solely so §10.4's replay can answer with real counts —
pinned by `ReplayCompositionFacts`". Step 9 writes that fact. The counts are why: an enqueue can
answer `202` and nothing else, and §10.4's response carries `versionsCreated` and
`quarantineEntriesResolved`.

⚠ **`IInboundMessageProcessor.ProcessAsync` is what this route calls, not
`IProcessInboundMessageHandler.HandleAsync`.** Shared contract §7.4 freezes `HandleAsync` as
returning `Task`, which is right for a queue and useless here. Plan 3's
`ProcessInboundMessageHandler` implements both and is registered once per scope reachable through
either, so the two are the same object.

⚠ **The replay runs under the message's OWN correlation id** — decision 2. A fresh id would orphan
the replay from the receipt it re-runs, and `interval_data_version.correlation_id` is how an
operator walks back from a version to the POST that caused it.

⚠ **The employee host maps no webhook and never will.** `AddPeakPowerIngestion` is deliberately
all-or-nothing, so it also registers `IInboundMessageReceiver` — which depends on
`IIngestionJobQueue`, a service the Worker registers and this host does not. In Development
`WebApplicationBuilder.Build()` turns `ValidateOnBuild` on, and validation constructs **every**
registered service, so the missing queue is a **boot failure**, not a lazy one. Step 5 registers
`UnreachableIngestionJobQueue`, which satisfies the graph and throws if anything ever calls it. That
is stricter than leaving it out: "this host cannot enqueue" becomes a sentence in the code with a
test behind it, rather than a fact that holds because nobody has mapped the route yet.

**Files:**
- Modify: `src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj:66` — two
  `<ProjectReference>` lines
- Modify: `src/Hosts/PeakPower.Api.Employee/Program.cs:97` — the ingestion, adapter and queue
  registrations
- Create: `src/Hosts/PeakPower.Api.Employee/Ingestion/UnreachableIngestionJobQueue.cs`
- Modify: `src/Hosts/PeakPower.Api.Employee/Endpoints/DataHealthEndpoints.cs` — one route, one
  handler
- Modify: `src/Hosts/PeakPower.Api.Employee/Mapping/DataHealthMappings.cs` — `ToReplayResponse` and
  its outcome switch
- Modify: `tests/PeakPower.Integration.Tests/Employee/EmployeeApiFactory.cs` — `RawPayloadRoot`
- Modify: `tests/PeakPower.Integration.Tests/Employee/DataHealthFixtures.cs` — one arrangement
- Create: `tests/PeakPower.Integration.Tests/Employee/PvnedReplayDocument.cs`
- Create: `tests/PeakPower.Integration.Tests/Employee/DataHealthReplayTests.cs`
- Create: `tests/PeakPower.Architecture.Tests/ReplayCompositionFacts.cs`
- Modify: `tests/PeakPower.Integration.Tests/Employee/EmployeeRouteTableTests.cs:94` — `19` → `20`

**Interfaces:**
- Consumes: `IInboundMessageProcessor.ProcessAsync`, `InboundMessageProcessingOutcome`,
  `InboundMessageProcessingStatus` (plan 3, `PeakPower.Ingestion.Processing`);
  `IngestionServiceCollectionExtensions.AddPeakPowerIngestion` (plan 3);
  `PvnedServiceCollectionExtensions.AddPvnedBrpAdapter` (plan 4); `IIngestionJobQueue`,
  `IRawPayloadStore` (shared contract §7.3, §7.4); `InboundMessage` (plan 2); `ApiResults.NotFound`
  and `TenancyEndpointExtensions.BackOffice` (slice 1); `ReplayMessageResponse` (Task 9);
  `AttachMeteringPointRequest` and `MeteringPointDto` (slice 1's back office).
- Produces:
  - route `POST /api/v1/data-health/messages/{id:guid}/replay`
  - `public sealed class UnreachableIngestionJobQueue : IIngestionJobQueue`
  - `public static ReplayMessageResponse DataHealthMappings.ToReplayResponse(Guid inboundMessageId, Guid correlationId, InboundMessageProcessingOutcome outcome)`
  - `public static class PvnedReplayDocument` — `byte[] Allocation(string ean, DateOnly deliveryDate, decimal quantityKwh)`
  - `public sealed class ReplayCompositionFacts`

- [ ] **Step 1: Reference the two projects**

In `src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj`, after the
`PeakPower.ServiceDefaults` reference at `:66` and before the closing `</ItemGroup>` at `:67`:

```xml
    <!--
      Slice 2. The ONLY reason this host sees either: shared contract §10.4's replay response
      carries versionsCreated and quarantineEntriesResolved, counts an enqueue cannot produce, so
      the replay endpoint resolves IInboundMessageProcessor in-process and answers with what the
      run actually did. Shared contract §3.1's project table names this host and this reason;
      ReplayCompositionFacts pins the set of API hosts doing it to exactly one.

      Architecture fact 3 is untouched. It constrains what PeakPower.Ingestion may reference - not
      what a host may compose - and the module rules have always allowed a host to reference
      infrastructure solely to register it at the composition root.

      This host maps NO webhook. PeakPower.Worker remains the only host with one, and
      UnreachableIngestionJobQueue is what makes that structural here rather than incidental.
    -->
    <ProjectReference Include="../../Infrastructure/PeakPower.Ingestion/PeakPower.Ingestion.csproj" />
    <ProjectReference Include="../../Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj" />
```

- [ ] **Step 2: Write the failing composition fact**

Create `tests/PeakPower.Architecture.Tests/ReplayCompositionFacts.cs`:

```csharp
using Mono.Cecil;
using Shouldly;
using Xunit;

namespace PeakPower.Architecture.Tests;

/// <summary>
/// Shared contract §3.1, the clause added when plan 6 asked for it: <c>PeakPower.Worker</c> is
/// "the composition root that binds the adapter to the port, and the only <i>host with a webhook</i>
/// that sees both; <c>PeakPower.Api.Employee</c> also composes both, solely so §10.4's replay can
/// answer with real counts — pinned by <c>ReplayCompositionFacts</c>".
/// </summary>
/// <remarks>
/// <para>
/// This is that pin. It reads assembly references out of the compiled IL rather than the .csproj
/// files, so a reference added through a transitive path counts exactly as much as one written by
/// hand — which is the failure mode a grep over project files would miss.
/// </para>
/// <para>
/// It scans <c>PeakPower.Api.*.dll</c> and not every production assembly on purpose: the Worker
/// composes both by design and is not an API host, and <c>AssemblyProbe.ProductionAssemblies()</c>
/// would fail this test for an unrelated reason the day a new production project lands before its
/// entry does.
/// </para>
/// </remarks>
public sealed class ReplayCompositionFacts
{
    private const string IngestionAssembly = "PeakPower.Ingestion";
    private const string BrpAdapterPrefix = "PeakPower.Integration.Brp";

    [Fact]
    public void Exactly_one_api_host_composes_the_pipeline_and_a_brp_adapter_and_it_is_the_employee_host()
    {
        var hostPaths = Directory
            .EnumerateFiles(AssemblyProbe.OutputDirectory, "PeakPower.Api.*.dll")
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToArray();

        // Non-vacuity floor, and named rather than counted: "composing.ShouldBe([...Employee])"
        // would pass just as happily over a directory holding no API host at all, which is the
        // shape of vacuous pass this repository has been bitten by six times. Both hosts must be
        // here before the interesting assertion means anything.
        hostPaths
            .Select(Path.GetFileName)
            .ShouldBe(["PeakPower.Api.Customer.dll", "PeakPower.Api.Employee.dll"],
                "this fact is about which API hosts compose the pipeline, so every API host has "
                + "to be in the scan before the answer means anything");

        var composing = new List<string>();

        foreach (var path in hostPaths)
        {
            using var host = AssemblyDefinition.ReadAssembly(path);

            var references = host.MainModule.AssemblyReferences
                .Select(reference => reference.Name)
                .ToArray();

            var seesIngestion =
                references.Contains(IngestionAssembly, StringComparer.Ordinal);
            var seesAdapter = references.Any(
                name => name.StartsWith(BrpAdapterPrefix, StringComparison.Ordinal));

            if (seesIngestion && seesAdapter)
            {
                composing.Add(host.Name.Name);
            }
        }

        composing.ShouldBe(["PeakPower.Api.Employee"],
            "exactly one API host may compose the ingestion pipeline AND a BRP adapter, and it is "
            + "the employee host, solely so shared contract §10.4's replay can answer with "
            + "versionsCreated and quarantineEntriesResolved. A second one is a second place a "
            + "document can be parsed and applied; the customer host in particular must never be "
            + "able to write a reading.");
    }

    /// <summary>
    /// The half the list assertion above cannot state on its own: the CUSTOMER host must see
    /// neither. It is the host a tenant's browser talks to, and [F02-R30] forbids any code path
    /// that writes readings outside the pipeline — a customer host that could reach the pipeline
    /// at all is one refactor away from being one.
    /// </summary>
    [Fact]
    public void The_customer_host_sees_neither_the_pipeline_nor_a_brp_adapter()
    {
        var customerPath =
            Path.Combine(AssemblyProbe.OutputDirectory, "PeakPower.Api.Customer.dll");

        File.Exists(customerPath).ShouldBeTrue(
            $"PeakPower.Architecture.Tests references PeakPower.Api.Customer, so {customerPath} "
            + "must be in this project's output directory");

        using var customer = AssemblyDefinition.ReadAssembly(customerPath);

        var offenders = customer.MainModule.AssemblyReferences
            .Select(reference => reference.Name)
            .Where(name => name.Equals(IngestionAssembly, StringComparison.Ordinal)
                           || name.StartsWith(BrpAdapterPrefix, StringComparison.Ordinal))
            .ToArray();

        offenders.ShouldBeEmpty(
            "the customer host reads what the pipeline stored and writes nothing back [F02-R30]");
    }
}
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Architecture.Tests --filter "FullyQualifiedName~ReplayCompositionFacts"`
Expected: FAIL — `Exactly_one_api_host_composes_...` with
`Shouldly.ShouldAssertException : composing should be ["PeakPower.Api.Employee"] but was []`,
because Step 1 added the `<ProjectReference>` lines and nothing in this host's IL uses either
assembly yet, so the C# compiler elides both references. `The_customer_host_sees_neither...` passes
already, and that is not a free pass — it is the direction that must stay true while the other
changes.

⚠ **The elision is the reason this fact reads IL rather than the .csproj.** A `<ProjectReference>`
that no code uses is not an assembly reference, and a fact that grepped the project file would go
green on Step 1 alone — certifying a composition that does not exist.

- [ ] **Step 4: Write the queue this host cannot use**

Create `src/Hosts/PeakPower.Api.Employee/Ingestion/UnreachableIngestionJobQueue.cs`:

```csharp
using PeakPower.Application.Abstractions.Ingestion;

namespace PeakPower.Api.Employee.Ingestion;

/// <summary>
/// The <see cref="IIngestionJobQueue"/> the employee host registers, and which nothing on this
/// host may call.
/// </summary>
/// <remarks>
/// <para>
/// <c>AddPeakPowerIngestion</c> is deliberately all-or-nothing — "a host that ever needs the
/// pipeline asks the same way and cannot get half of it" — so composing it here also registers
/// <c>IInboundMessageReceiver</c>, whose constructor takes an <see cref="IIngestionJobQueue"/>.
/// The queue is <c>PeakPower.Worker</c>'s: it is the thing the webhook hands a stored message to,
/// and this host maps no webhook. In Development <c>WebApplicationBuilder.Build()</c> turns
/// <c>ValidateOnBuild</c> on, and validation CONSTRUCTS every registered service, so leaving the
/// queue unregistered is a boot failure rather than a lazy one.
/// </para>
/// <para>
/// A throwing implementation rather than a no-op, and the difference is the whole point. A no-op
/// would let a future route on this host accept a document, return 200, and enqueue nothing — the
/// exact silent loss <c>[F02-R03]</c> exists to prevent. This turns that mistake into a stack trace
/// naming the rule it broke, on the first request rather than on the first reconciliation.
/// </para>
/// </remarks>
public sealed class UnreachableIngestionJobQueue : IIngestionJobQueue
{
    public Task EnqueueProcessMessageAsync(
        Guid inboundMessageId, Guid correlationId, CancellationToken ct) =>
        throw new InvalidOperationException(
            "The employee API cannot enqueue ingestion work. It composes PeakPower.Ingestion "
            + "solely so POST /api/v1/data-health/messages/{id}/replay can run "
            + "IInboundMessageProcessor.ProcessAsync in-process and report versionsCreated and "
            + "quarantineEntriesResolved (shared contract §10.4). PeakPower.Worker is the only "
            + "host with a webhook and the only host with a queue (shared contract §3.1, §9.1). "
            + $"Refused for message {inboundMessageId}, correlation {correlationId}.");
}
```

- [ ] **Step 5: Compose the pipeline in the employee host**

In `src/Hosts/PeakPower.Api.Employee/Program.cs`, immediately after
`builder.Services.AddPeakPowerPersistence(connectionString);` at line 97:

```csharp
// ---------------------------------------------------------------------------------------------
// Slice 2 — the ingestion pipeline and the PVNed adapter, composed HERE as well as in the Worker.
//
// One route needs them: POST /api/v1/data-health/messages/{id}/replay. Shared contract §10.4
// freezes its response as carrying versionsCreated and quarantineEntriesResolved, which is a
// synchronous parse-and-apply by construction - an enqueue can answer 202 and nothing else. So
// this host resolves IInboundMessageProcessor in-process and reports what the run actually did.
//
// Shared contract §3.1's project table names this host and this reason, and calls PeakPower.Worker
// "the only HOST WITH A WEBHOOK that sees both". ReplayCompositionFacts pins the set of API hosts
// composing both to exactly one, so a third is a deliberate edit rather than a drift.
//
// Architecture fact 3 is untouched: it constrains what PeakPower.Ingestion may reference, not what
// a host may compose.
//
// AddPvnedBrpAdapter must come AFTER AddPeakPowerIngestion. The pipeline registers
// RejectingBrpIngestionAdapter under the PVNED adapter key as the fallback, and the registry
// resolves the LAST registration for a key - so the real adapter has to be registered second, or
// every replay of a PVNED message answers ADAPTER_NOT_IMPLEMENTED and looks like a parser bug.
// ---------------------------------------------------------------------------------------------
builder.Services.AddPeakPowerIngestion(builder.Configuration);
builder.Services.AddPvnedBrpAdapter(builder.Configuration);

// The queue this host must never use. See UnreachableIngestionJobQueue: registered so
// ValidateOnBuild can construct IInboundMessageReceiver, and throwing so that a route which ever
// tries to enqueue from here fails loudly on its first request.
builder.Services.AddSingleton<IIngestionJobQueue, UnreachableIngestionJobQueue>();
```

and add four using directives to the top of the file:

```csharp
using PeakPower.Api.Employee.Ingestion;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Ingestion;
using PeakPower.Integration.Brp.Pvned;
```

- [ ] **Step 6: Run the composition fact and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Architecture.Tests --filter "FullyQualifiedName~ReplayCompositionFacts"
dotnet test tests/PeakPower.Architecture.Tests --filter "FullyQualifiedName~AssemblyProbeFacts"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~EmployeeApiStartupTests"
```
Expected: all PASS. The startup suite is the one that proves `ValidateOnBuild` is satisfied — it
boots this host in **Production** as well as Development, and a missing `IIngestionJobQueue` would
take it out with
`InvalidOperationException: Unable to resolve service for type 'PeakPower.Application.Abstractions.Ingestion.IIngestionJobQueue' while attempting to activate 'PeakPower.Ingestion.Receipt.InboundMessageReceiver'`.

⚠ If `AssemblyProbeFacts` fails with *"found production assemblies … that ProductionAssemblyFileNames
does not list: PeakPower.Ingestion.dll, PeakPower.Integration.Brp.Pvned.dll"*, plan 1's Task on
`AssemblyProbe.cs` has not landed. That is plan 1's two-line change, not this one's — do not edit
`ProductionAssemblyFileNames` here.

- [ ] **Step 7: Write the document builder**

Create `tests/PeakPower.Integration.Tests/Employee/PvnedReplayDocument.cs`:

```csharp
using System.Globalization;
using System.Text;

namespace PeakPower.Integration.Tests.Employee;

/// <summary>
/// One valid PVNed A23 allocation document — SOAP envelope, one A02 consumption series, ninety-six
/// quarter-hour points — for a named EAN and delivery date.
/// </summary>
/// <remarks>
/// <para>
/// <b>This is not a second parser fixture and must never become one.</b> Plan 4's golden documents
/// are transcribed BY HAND from integration-spec §6 and live in
/// <c>tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures</c>, because design §8 requires
/// the parser's positive evidence to come from a document no generator wrote. Every parsing
/// question is settled there. What this class exists for is the ONE thing a hand-written fixture
/// cannot give the replay loop: a document whose EAN is chosen at run time, so a test can post an
/// EAN that does not exist yet, register it, and replay.
/// </para>
/// <para>
/// It follows shared contract §8's element names and the golden A23's shape exactly — including
/// <c>BusinessType</c> <c>A04</c> on the consumption series, which is deliberately NOT the
/// direction: the two code lists are different lists, and an adapter that read <c>BusinessType</c>
/// instead of <c>Direction</c> would get the series backwards. If plan 4's adapter rejects a
/// document from here, fix THIS file — the golden is the authority.
/// </para>
/// <para>
/// The delivery date is an Amsterdam calendar day and the period is written in UTC, so a summer
/// date runs 22:00Z the day before to 22:00Z on the day. Ninety-six points, which is the count
/// <c>IMarketCalendar.ExpectedIntervalCount</c> gives every date except the two DST days —
/// so callers must not pass 2026-03-29 or 2026-10-25.
/// </para>
/// </remarks>
public static class PvnedReplayDocument
{
    /// <summary>PVNed's GLN — <c>PvnedAdapterOptions.SenderGln</c>'s default, integration-spec §6.</summary>
    private const string SenderGln = "8714252005776";

    /// <summary>PeakPower's GLN — <c>PvnedAdapterOptions.ReceiverGln</c>'s default.</summary>
    private const string ReceiverGln = "8712423456789";

    public const int Points = 96;

    /// <summary>
    /// A flat day: <paramref name="quantityKwh"/> in every one of the ninety-six intervals, so the
    /// stored total is <c>quantityKwh * 96</c> and a reader can check the arithmetic by eye.
    /// </summary>
    public static byte[] Allocation(string ean, DateOnly deliveryDate, decimal quantityKwh)
    {
        if (deliveryDate is { Month: 3, Day: 29 } or { Month: 10, Day: 25 })
        {
            throw new ArgumentOutOfRangeException(
                nameof(deliveryDate), deliveryDate,
                "A 96-point document is rejected for a DST transition date - short for the autumn "
                + "100-point date and over-length for the spring 92-point one, under the "
                + "integration-spec §8.2 point-count rule. Pick an ordinary day.");
        }

        // Amsterdam is CEST from late March to late October, so an ordinary summer day starts at
        // 22:00Z the day before. Written from the date rather than from a clock: architecture fact
        // 5 puts the only clock in PeakPower.Infrastructure.Time, and this file has no business
        // reading one.
        var start = new DateTimeOffset(
            deliveryDate.AddDays(-1).ToDateTime(new TimeOnly(22, 0)), TimeSpan.Zero);
        var end = start.AddHours(24);

        var quantity = quantityKwh.ToString("F3", CultureInfo.InvariantCulture);
        var startText = start.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);
        var endText = end.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);

        var builder = new StringBuilder();
        builder.Append(
            $"""
            <?xml version="1.0" encoding="UTF-8"?>
            <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
              <soap:Body>
                <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
                  <DocumentIdentification>{Guid.CreateVersion7()}</DocumentIdentification>
                  <DocumentVersion>1</DocumentVersion>
                  <DocumentType>A23</DocumentType>
                  <ProcessType>A05</ProcessType>
                  <SenderIdentification>{SenderGln}</SenderIdentification>
                  <ReceiverIdentification>{ReceiverGln}</ReceiverIdentification>
                  <CreatedDateTime>{endText}</CreatedDateTime>
                  <ReportPeriode>
                    <StartPeriod>{startText}</StartPeriod>
                    <EndPeriod>{endText}</EndPeriod>
                  </ReportPeriode>
                  <TimeSeries>
                    <mRID>{Guid.CreateVersion7()}</mRID>
                    <BusinessType>A04</BusinessType>
                    <MeasurementPeriode>
                      <StartPeriod>{startText}</StartPeriod>
                      <EndPeriod>{endText}</EndPeriod>
                    </MeasurementPeriode>
                    <Direction>A02</Direction>
                    <MeasurementUnit>KWH</MeasurementUnit>
                    <CurveType>A01</CurveType>
                    <Resource>
                      <ResourceObject>{ean}</ResourceObject>
                      <RecourceName>Realisation</RecourceName>
                    </Resource>
                    <Period>
                      <Resolution>PT15M</Resolution>

            """);

        for (var pos = 1; pos <= Points; pos++)
        {
            builder.Append(CultureInfo.InvariantCulture,
                $"          <Point><Pos>{pos}</Pos><Qty>{quantity}</Qty></Point>\n");
        }

        builder.Append(
            """
                    </Period>
                  </TimeSeries>
                </TimeSeriesDocument>
              </soap:Body>
            </soap:Envelope>
            """);

        return Encoding.UTF8.GetBytes(builder.ToString());
    }
}
```

- [ ] **Step 8: Write the failing tests**

First, one arrangement. Append to
`tests/PeakPower.Integration.Tests/Employee/DataHealthFixtures.cs`, inside the class:

```csharp
    /// <summary>
    /// A stored message whose <c>payload_uri</c> points at a payload that really exists, so it can
    /// be REPLAYED. <see cref="MessageAsync"/> writes a made-up uri, which is right for the log
    /// tests and useless here.
    /// </summary>
    /// <remarks>
    /// The payload goes through the host's own <c>IRawPayloadStore</c> rather than being written to
    /// disk here, because the uri that ends up in the column has to be the one the store will
    /// accept back — shared contract §7.3 makes it opaque on purpose, and a test that constructed
    /// it would be asserting against its own guess at the layout.
    /// </remarks>
    public async Task<(Guid MessageId, Guid CorrelationId)> StoredMessageAsync(
        Guid brpId, string payloadUri, long payloadBytes, DateTimeOffset receivedAt,
        Guid correlationId, CancellationToken ct)
    {
        var id = Guid.CreateVersion7();

        await using var connection = await OpenAsync(ct);
        await connection.ExecuteAsync(
            """
            INSERT INTO metering.inbound_message
                   (id, brp_id, correlation_id, received_at, payload_hash, payload_bytes,
                    payload_uri, status, remote_ip)
            VALUES (@id, @brpId, @correlationId, @receivedAt, @payloadHash, @payloadBytes,
                    @payloadUri, 'RECEIVED', @remoteIp::inet)
            """,
            new
            {
                id,
                brpId,
                correlationId,
                receivedAt,
                payloadHash = System.Security.Cryptography.SHA256.HashData(id.ToByteArray()),
                payloadBytes,
                payloadUri,
                remoteIp = "10.0.0.7",
            });

        return (id, correlationId);
    }
```

Then give the factory somewhere to put payloads. In
`tests/PeakPower.Integration.Tests/Employee/EmployeeApiFactory.cs`, add the property beside
`SigningKeyPath`:

```csharp
    /// <summary>
    /// Where this host's <c>IRawPayloadStore</c> writes. Under the temp directory and keyed by a
    /// fresh GUID for the same reason <see cref="SigningKeyPath"/> is: two factories in one test
    /// run must not share a root, or one suite's replay reads another's bytes.
    /// </summary>
    public string RawPayloadRoot { get; } =
        Path.Combine(Path.GetTempPath(), "pp-tests", Guid.NewGuid().ToString("N"), "raw-payloads");
```

and one line in `ConfigureWebHost`, after the signing-key setting:

```csharp
        // A CONFIGURATION key, not a process environment variable. WebApplicationFactory cannot set
        // environment variables per host, and the process environment is shared by every test in
        // this assembly; UseSetting feeds the same IConfiguration the environment-variables
        // provider would, which is why AddPeakPowerIngestion reads the root through
        // builder.Configuration.
        builder.UseSetting(
            PeakPower.Ingestion.Storage.RawPayloadStoreOptions.RootEnvironmentVariable,
            RawPayloadRoot);
```

Now create `tests/PeakPower.Integration.Tests/Employee/DataHealthReplayTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Shouldly;
using PeakPower.Application.Abstractions;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Contracts.Employee;
using PeakPower.Domain.Metering;
using PeakPower.Integration.Tests.Tenancy;
using Xunit;

namespace PeakPower.Integration.Tests.Employee;

/// <summary>
/// <c>POST /api/v1/data-health/messages/{id}/replay</c> — design §7.6's loop, end to end.
/// </summary>
/// <remarks>
/// <para>
/// There is no Worker in this suite, so the FIRST replay call is what the Worker's queue would have
/// done on receipt. That is not a shortcut: <c>ProcessInboundMessageHandler</c> is one class
/// implementing both <c>IProcessInboundMessageHandler</c> (what the queue calls) and
/// <c>IInboundMessageProcessor</c> (what this route calls), registered once per scope and reached
/// through either — so "replay runs the identical handler" is the property <c>[F02-R27]</c> rests
/// on, and driving it from here exercises it rather than assuming it.
/// </para>
/// </remarks>
[Collection(nameof(TenancyCollection))]
public sealed class DataHealthReplayTests : IAsyncLifetime
{
    private readonly TenancyFixture _fixture;
    private EmployeeApiFactory _factory = null!;
    private HttpClient _client = null!;
    private DataHealthFixtures _data = null!;

    public DataHealthReplayTests(TenancyFixture fixture) => _fixture = fixture;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public async ValueTask InitializeAsync()
    {
        _factory = new EmployeeApiFactory(_fixture.OwnerConnectionString);
        _client = await _factory.CreateBackOfficeClientAsync(Ct);
        _data = new DataHealthFixtures(_fixture.OwnerConnectionString);
    }

    public async ValueTask DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private DateTimeOffset Now => _factory.Services.GetRequiredService<IMarketCalendar>().UtcNow;

    /// <summary>
    /// An eighteen-digit EAN nobody has registered, unique per call so two runs against the same
    /// container cannot collide on <c>metering_point_ean_validity_excl</c>.
    /// </summary>
    private static string UnregisteredEan() =>
        "8716871" + Random.Shared.NextInt64(10_000_000_000L, 99_999_999_999L)
            .ToString(System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>
    /// Stores a real payload through the host's own <c>IRawPayloadStore</c> and writes the
    /// <c>inbound_message</c> row that points at it.
    /// </summary>
    private async Task<Guid> StoreAsync(Guid brpId, byte[] payload)
    {
        var correlationId = Guid.CreateVersion7();

        using var scope = _factory.Services.CreateScope();
        var payloads = scope.ServiceProvider.GetRequiredService<IRawPayloadStore>();
        var uri = await payloads.StoreAsync(brpId, correlationId, payload, Ct);

        var (messageId, _) = await _data.StoredMessageAsync(
            brpId, uri, payload.LongLength, Now.AddMinutes(-5), correlationId, Ct);

        return messageId;
    }

    private async Task<ReplayMessageResponse> ReplayAsync(Guid messageId)
    {
        using var response = await _client.PostAsync(
            $"/api/v1/data-health/messages/{messageId}/replay", content: null, Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<ReplayMessageResponse>(Ct))!;
    }

    /// <summary>
    /// Design §7.6, in full: an unknown-EAN document quarantines → the EAN is registered through
    /// the EXISTING back office → the stored message is replayed from the log → the entry resolves
    /// into readings. Then <c>[F02-R27]</c>: a fourth call produces no second version, asserted by
    /// version count taken from the database, not from the response body.
    /// </summary>
    [Fact]
    public async Task Registering_the_connection_and_replaying_resolves_the_quarantine_into_readings()
    {
        var pvned = await _data.PvnedIdAsync(Ct);
        var ean = UnregisteredEan();
        var deliveryDate = new DateOnly(2026, 8, 12);

        var messageId = await StoreAsync(
            pvned, PvnedReplayDocument.Allocation(ean, deliveryDate, quantityKwh: 40m));

        // ---- 1. The document quarantines, because nothing owns that EAN yet. -------------------
        var first = await ReplayAsync(messageId);
        first.InboundMessageId.ShouldBe(messageId);
        first.VersionsCreated.ShouldBe(0,
            "a series that cannot be attached to a connection writes no readings at all - it is "
            + "quarantined, never discarded and never attached by guesswork [F02-R14]");
        first.QuarantineEntriesResolved.ShouldBe(0);

        var quarantine = await _client.GetFromJsonAsync<QuarantineListResponse>(
            "/api/v1/data-health/quarantine?resolved=false&pageSize=200", Ct);
        var entry = quarantine!.Items.Single(item => item.ResourceObject == ean);
        entry.Reason.ShouldBe("UNKNOWN_EAN");
        entry.InboundMessageId.ShouldBe(messageId);
        entry.DeliveryDate.ShouldBe(deliveryDate);
        entry.Direction.ShouldBe("CONSUMPTION");
        entry.PointCount.ShouldBe(PvnedReplayDocument.Points);

        // ---- 2. Register the connection through the EXISTING back office. ----------------------
        // Through the real endpoint, not through the DbContext: design §7.6's loop is "registered
        // through the existing back office", and the point of the acceptance is that an operator
        // can do this with the screens that already ship.
        using var attach = await _client.PostAsJsonAsync(
            $"/api/v1/customers/{_fixture.CompanyAId}/metering-points",
            new AttachMeteringPointRequest(
                Ean: ean,
                BrpId: pvned,
                ProductionExpectation: "NEVER",
                ExpectationSource: "CUSTOMER_DECLARED",
                Name: "Vestiging Rotterdam",
                Description: null,
                GridOperator: "Stedin",
                CapacityKw: 250m,
                Address: null,
                ValidFrom: new DateOnly(2026, 1, 1)),
            Ct);

        attach.StatusCode.ShouldBe(HttpStatusCode.Created);
        var registered = await attach.Content.ReadFromJsonAsync<MeteringPointDto>(Ct);

        // ---- 3. Replay the stored message from the log. ----------------------------------------
        var second = await ReplayAsync(messageId);
        second.Outcome.ShouldBe("REPLAYED");
        second.VersionsCreated.ShouldBe(1);
        second.QuarantineEntriesResolved.ShouldBe(1,
            "the entry resolves into readings - that is what makes quarantine a holding area "
            + "rather than a dead end [F02-R15]");
        second.FailureCode.ShouldBeNull();
        second.CorrelationId.ShouldBe(first.CorrelationId,
            "the replay runs under the message's OWN correlation id: a fresh one would orphan the "
            + "replay from the receipt it re-runs, and interval_data_version.correlation_id is "
            + "how an operator walks back from a version to the POST that caused it");

        // ---- 4. The readings are really there. -------------------------------------------------
        await using var db = _factory.CreateOwnerDbContext();

        var versions = await db.Set<IntervalDataVersion>()
            .AsNoTracking()
            .Where(version => version.MeteringPointId == registered!.Id
                              && version.DeliveryDate == deliveryDate
                              && version.Direction == IntervalDirection.Consumption)
            .ToListAsync(Ct);

        versions.Count.ShouldBe(1);
        versions[0].IsCurrent.ShouldBeTrue();
        versions[0].InboundMessageId.ShouldBe(messageId);

        var readings = await db.Set<IntervalReading>()
            .AsNoTracking()
            .CountAsync(reading => reading.VersionId == versions[0].Id, Ct);

        readings.ShouldBe(PvnedReplayDocument.Points,
            "ninety-six quarter-hours, applied whole - a document applies entirely or not at all");

        var resolved = await _client.GetFromJsonAsync<QuarantineListResponse>(
            "/api/v1/data-health/quarantine?resolved=true&pageSize=200", Ct);
        resolved!.Items.Select(item => item.Id).ShouldContain(entry.Id);

        // ---- 5. [F02-R27]: replaying again produces NO SECOND VERSION. -------------------------
        var third = await ReplayAsync(messageId);
        third.Outcome.ShouldBe("NO_CHANGE");
        third.VersionsCreated.ShouldBe(0);
        third.QuarantineEntriesResolved.ShouldBe(0,
            "the entry was already resolved; resolving it twice would double-count the operator's "
            + "work on the panel");

        var versionsAfter = await db.Set<IntervalDataVersion>()
            .AsNoTracking()
            .CountAsync(
                version => version.MeteringPointId == registered!.Id
                           && version.DeliveryDate == deliveryDate
                           && version.Direction == IntervalDirection.Consumption,
                Ct);

        versionsAfter.ShouldBe(1,
            "[F02-R27] asserted by VERSION COUNT, not by the response body: a handler that "
            + "reported NO_CHANGE while writing a superseding version would pass every assertion "
            + "above and be wrong about the one thing the rule is for");
    }

    [Fact]
    public async Task Replaying_a_message_that_does_not_exist_is_404()
    {
        using var response = await _client.PostAsync(
            $"/api/v1/data-health/messages/{Guid.CreateVersion7()}/replay", content: null, Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Replay_refuses_a_caller_with_no_back_office_token()
    {
        using var anonymous = _factory.CreateEmployeeClient();

        using var response = await anonymous.PostAsync(
            $"/api/v1/data-health/messages/{Guid.CreateVersion7()}/replay", content: null, Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized,
            "401 BEFORE 404 - the fallback policy runs before the handler, so an unknown id and a "
            + "known one are indistinguishable to a caller with no token");
    }

    /// <summary>
    /// The employee host composes the pipeline and must still be unable to ENQUEUE anything: it
    /// maps no webhook, and shared contract §9.1 gives the Worker the only one.
    /// </summary>
    [Fact]
    public async Task This_host_registers_a_queue_that_refuses_to_enqueue()
    {
        using var scope = _factory.Services.CreateScope();
        var queue = scope.ServiceProvider.GetRequiredService<IIngestionJobQueue>();

        var thrown = await Should.ThrowAsync<InvalidOperationException>(
            () => queue.EnqueueProcessMessageAsync(Guid.CreateVersion7(), Guid.CreateVersion7(), Ct));

        thrown.Message.ShouldContain("The employee API cannot enqueue ingestion work", Case.Sensitive);
    }
}
```

- [ ] **Step 9: Run them and watch them fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~DataHealthReplayTests"`
Expected: FAIL — `Registering_the_connection_and_replaying_resolves_the_quarantine_into_readings`
fails first with
`Shouldly.ShouldAssertException : response.StatusCode should be HttpStatusCode.OK but was HttpStatusCode.Unauthorized`,
because the route is not mapped and this host denies by default.
`This_host_registers_a_queue_that_refuses_to_enqueue` PASSES already — Step 5 registered it, and
that is the direction that must stay true while the route is added.

- [ ] **Step 10: Write the outcome mapping**

Append to `src/Hosts/PeakPower.Api.Employee/Mapping/DataHealthMappings.cs`, inside the class:

```csharp
    /// <summary>
    /// What one replay did, in shared contract §10.4's three words.
    /// </summary>
    public static ReplayMessageResponse ToReplayResponse(
        Guid inboundMessageId,
        Guid correlationId,
        InboundMessageProcessingOutcome outcome) =>
        new(inboundMessageId,
            correlationId,
            Wire(outcome.Status),
            outcome.VersionsCreated,
            outcome.QuarantineEntriesResolved,
            outcome.FailureCode,
            outcome.FailureDetail);

    /// <summary>
    /// ⚠ An explicit switch, NOT <c>EnumWireFormat.ToWire</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Everywhere else on this host the wire spelling IS the member name in SCREAMING_SNAKE, and
    /// <c>EnumWireFormat</c> is the one place that conversion lives. Here it is not:
    /// <c>InboundMessageProcessingStatus</c> is plan 3's internal vocabulary
    /// (<c>Applied</c>, <c>NoChange</c>, <c>Failed</c>, <c>RecognisedAndClosed</c>) and §10.4
    /// freezes THREE outcomes (<c>REPLAYED</c>, <c>NO_CHANGE</c>, <c>FAILED</c>). Calling
    /// <c>ToWire</c> would put <c>APPLIED</c> and <c>RECOGNISED_AND_CLOSED</c> on a frozen wire and
    /// break a second repository, and it would look right doing it.
    /// </para>
    /// <para>
    /// Two statuses collapse onto <c>NO_CHANGE</c> and the collapse is deliberate: an A12 imbalance
    /// document is recognised, stored and closed with zero readings <c>[DEC-25]</c>, which from the
    /// operator's side is exactly "nothing changed" — it did not fail, and there is nothing to
    /// look at.
    /// </para>
    /// <para>
    /// The <c>default</c> arm throws rather than returning a fallback string, so a fifth member is
    /// a loud failure in one test rather than a fourth value nobody agreed to on a frozen envelope.
    /// </para>
    /// </remarks>
    private static string Wire(InboundMessageProcessingStatus status) => status switch
    {
        InboundMessageProcessingStatus.Applied => "REPLAYED",
        InboundMessageProcessingStatus.NoChange => "NO_CHANGE",
        InboundMessageProcessingStatus.RecognisedAndClosed => "NO_CHANGE",
        InboundMessageProcessingStatus.Failed => "FAILED",
        _ => throw new ArgumentOutOfRangeException(
            nameof(status), status,
            "InboundMessageProcessingStatus gained a member and shared contract §10.4's three "
            + "outcomes - REPLAYED, NO_CHANGE, FAILED - do not cover it. Decide which one it is; "
            + "a fourth value on that envelope is a break in peakpower-web."),
    };
```

and add `using PeakPower.Ingestion.Processing;` to the file's using directives.

- [ ] **Step 11: Write the route and the handler**

In `src/Hosts/PeakPower.Api.Employee/Endpoints/DataHealthEndpoints.cs`, add the second reason beside
`BackOfficeReason`:

```csharp
    /// <summary>
    /// Replay's own reason, and a different sentence from the reads' on purpose: it is the one
    /// route here that WRITES, and <c>EmployeeRouteTableTests</c> makes the reason a sentence a
    /// reviewer can disagree with rather than a label.
    /// </summary>
    private const string ReplayReason =
        "Back-office staff replay a stored message after registering the connection it could not "
        + "be attached to, for every customer company and every balance responsible party.";
```

register the route in `MapDataHealthEndpoints`, after `/metering-points` and before
`return routes;`:

```csharp
        group.MapPost("/messages/{id:guid}/replay", ReplayAsync)
            .WithName("ReplayInboundMessage")
            .WithSummary(
                "Reprocesses a stored message through the adapter its BRP row names. [F02-R27]")
            .Produces<ReplayMessageResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .BackOffice(ReplayReason);
```

and add the handler after `MeteringPointsAsync`:

```csharp
    // --------------------------------------------------------------------------------- replay

    /// <summary>
    /// Reprocesses one stored message and reports what the run did. [F02-R27]
    /// </summary>
    private static async Task<IResult> ReplayAsync(
        Guid id,
        PeakPowerDbContext db,
        IInboundMessageProcessor processor,
        CancellationToken cancellationToken)
    {
        var message = await db.Set<InboundMessage>()
            .AsNoTracking()
            .FirstOrDefaultAsync(candidate => candidate.Id == id, cancellationToken);

        if (message is null)
        {
            return ApiResults.NotFound();
        }

        // The message's OWN correlation id, never a fresh one. It is what ties the raw payload,
        // this row and every interval_data_version the run produces into one trail, and
        // interval_data_version.correlation_id is how an operator walks back from a version to the
        // POST that caused it. A new id would make the replay untraceable to the receipt it
        // re-runs, which is the one question anybody asks about a replayed message.
        //
        // IInboundMessageProcessor, not IProcessInboundMessageHandler: §7.4 freezes HandleAsync as
        // returning Task, which is right for a queue - there is nobody to hand a result to - and
        // useless for a response that must carry versionsCreated and quarantineEntriesResolved.
        // One class implements both, registered once per scope, so this is the same object the
        // Worker's queue would have called.
        //
        // NOT wrapped in a try/catch. The apply transaction turns a document the adapter rejects
        // into an outcome with Status = Failed and a code [F02-R12]; an exception escaping here is
        // a bug in the pipeline, and UseExceptionHandler's 500 is the honest answer to one. A
        // catch-all would report FAILED with a null failureCode, which reads on the screen as a
        // rejected document and is not.
        var outcome = await processor.ProcessAsync(
            message.Id, message.CorrelationId, cancellationToken);

        return Results.Ok(
            DataHealthMappings.ToReplayResponse(message.Id, message.CorrelationId, outcome));
    }
```

and add `using PeakPower.Ingestion.Processing;` to the file's using directives.

- [ ] **Step 12: Move the employee endpoint count**

In `tests/PeakPower.Integration.Tests/Employee/EmployeeRouteTableTests.cs`, replace `:89-94`:

```csharp
    /// <summary>
    /// The endpoints the employee host maps outside the framework prefixes: one reference-data,
    /// four customer, three account, three metering-point, four back-office auth, the realm's JWKS
    /// document, and slice 2's four data-health routes — three reads and replay.
    /// </summary>
    private const int EmployeeEndpointCount = 20;
```

- [ ] **Step 13: Run everything and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~DataHealthReplayTests"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~DataHealth"
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~EmployeeRouteTableTests"
dotnet test tests/PeakPower.Architecture.Tests
```
Expected: all PASS — 4 + (7 + 5 + 9 + 4) + 4 + the whole architecture suite, and
`CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter` is **still green**: this host references
both, `PeakPower.Ingestion` references neither.

⚠ This suite parses XML, hits the filesystem and runs the apply transaction, so it is the slowest
class in the plan. If it times out under Testcontainers pressure, re-run it alone before reporting
a regression.

- [ ] **Step 14: Mutation-verify `[F02-R27]` by version count**

This is the assertion design §7.6 names, and the mutation has to be the one that fools the response
body. In plan 3's `ProcessInboundMessageHandler`, make the no-change branch write a version anyway
while still reporting `NoChange` — that is, remove the content-comparison short circuit and leave
the returned `Status` and `VersionsCreated` as they were.

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Registering_the_connection_and_replaying_resolves_the_quarantine_into_readings"`
Expected: FAIL with
`Shouldly.ShouldAssertException : versionsAfter should be 1 but was 2` and the message
*"[F02-R27] asserted by VERSION COUNT, not by the response body"*.

⚠ **Every assertion before it stays green.** `third.Outcome` is still `"NO_CHANGE"` and
`third.VersionsCreated` is still `0`, because the response is what the handler *says* it did. That
is exactly why design §7.6 says "asserted by version count": a replay button that quietly
supersedes the current version on every press changes which bytes an invoice is drawn from, and
reports that nothing happened. Restore and re-run to green.

- [ ] **Step 15: Mutation-verify the outcome mapping**

Replace the explicit switch with the call that looks like every other mapping on this host:

```csharp
            EnumWireFormat.ToWire(outcome.Status),
```

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Registering_the_connection_and_replaying_resolves_the_quarantine_into_readings"`
Expected: FAIL with
`Shouldly.ShouldAssertException : second.Outcome should be "REPLAYED" but was "APPLIED"`.

Then the half that assertion does not reach: restore the switch and map
`RecognisedAndClosed` to `"REPLAYED"` instead of `"NO_CHANGE"`.

Run the same test.
Expected: **PASS**, because this document is an A23 allocation and never reaches that arm. So
mutate the case the arm is actually for: temporarily change `PvnedReplayDocument.Allocation`'s
`<DocumentType>` to `A12`, and assert locally that the first replay answers `"NO_CHANGE"` with
`versionsCreated: 0` — an A12 imbalance document is recognised, stored and closed with zero
readings `[DEC-25]`, and reporting that as `REPLAYED` tells an operator a document landed data when
it landed none. Restore the document type and the mapping, and re-run to green.

- [ ] **Step 16: Mutation-verify the composition fact counts hosts, not project files**

Add the two `<ProjectReference>` lines from Step 1 to
`src/Hosts/PeakPower.Api.Customer/PeakPower.Api.Customer.csproj`, and one line to
`Program.cs` that uses them so the compiler cannot elide the references:

```csharp
builder.Services.AddPeakPowerIngestion(builder.Configuration);
```

Run: `dotnet test tests/PeakPower.Architecture.Tests --filter "FullyQualifiedName~ReplayCompositionFacts"`
Expected: FAIL — **both** facts.
`The_customer_host_sees_neither_the_pipeline_nor_a_brp_adapter` with
`Shouldly.ShouldAssertException : offenders should be empty but was ["PeakPower.Ingestion"]` and the
message *"the customer host reads what the pipeline stored and writes nothing back [F02-R30]"*, and
the list fact with
`composing should be ["PeakPower.Api.Employee"] but was ["PeakPower.Api.Customer", "PeakPower.Api.Employee"]`
once the adapter reference is used too.

Revert both files completely — `git checkout -- src/Hosts/PeakPower.Api.Customer` — and re-run to
green. ⚠ Revert with git rather than by hand: an orphaned `using` left behind fails
`-warnaserror` and would be read as this task's regression.

- [ ] **Step 17: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Employee/PeakPower.Api.Employee.csproj \
        src/Hosts/PeakPower.Api.Employee/Program.cs \
        src/Hosts/PeakPower.Api.Employee/Ingestion/UnreachableIngestionJobQueue.cs \
        src/Hosts/PeakPower.Api.Employee/Endpoints/DataHealthEndpoints.cs \
        src/Hosts/PeakPower.Api.Employee/Mapping/DataHealthMappings.cs \
        tests/PeakPower.Architecture.Tests/ReplayCompositionFacts.cs \
        tests/PeakPower.Integration.Tests/Employee/EmployeeApiFactory.cs \
        tests/PeakPower.Integration.Tests/Employee/DataHealthFixtures.cs \
        tests/PeakPower.Integration.Tests/Employee/PvnedReplayDocument.cs \
        tests/PeakPower.Integration.Tests/Employee/DataHealthReplayTests.cs \
        tests/PeakPower.Integration.Tests/Employee/EmployeeRouteTableTests.cs
git commit -m "feat(employee-api): replay a stored message, with real counts [F02-R27] [F02-R15]

The employee host composes PeakPower.Ingestion and PeakPower.Integration.Brp.Pvned, which
the amended shared contract 3.1 now names it for: 10.4's replay response carries
versionsCreated and quarantineEntriesResolved, counts an enqueue cannot produce. The
Worker stays the only host with a webhook, and ReplayCompositionFacts pins the set of API
hosts composing both to exactly one.

UnreachableIngestionJobQueue is registered because AddPeakPowerIngestion is all-or-nothing
and ValidateOnBuild constructs every registered service, and it THROWS because a no-op
would let a future route here accept a document, answer 200 and enqueue nothing.

The outcome mapping is an explicit switch and not EnumWireFormat.ToWire: 10.4 freezes
REPLAYED | NO_CHANGE | FAILED, and the processor's own vocabulary is Applied, NoChange,
Failed and RecognisedAndClosed. ToWire would put APPLIED on a frozen wire.

The replay runs under the message's own correlation id, so a version can still be walked
back to the POST that caused it.

Verified: writing a version while still reporting NO_CHANGE left every assertion on the
response body green and only the database version count red - which is why design 7.6
says \"asserted by version count\"; ToWire put APPLIED on the wire; mapping
RecognisedAndClosed to REPLAYED told an operator an A12 imbalance document had landed
data when it landed none; and giving the customer host the same two references turned
both composition facts red.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 13: Regenerate both OpenAPI documents and re-accept the snapshots

Shared contract §10.5: *"Both Verify snapshots are regenerated and re-accepted in the same commit as
the endpoints."* Design §5 step 9 puts "regenerate OpenAPI, accept Verify snapshots" inside the
customer-read-endpoints step for the same reason. This is that commit.

**Plan 7 Task 6 is blocked on this task and on nothing else.** Its Step 1 runs
`npm run verify:clients` and says, verbatim:

> That failure is the evidence the guard works before you use it. If it says `up to date`, plan 6's
> endpoints are not in the OpenAPI document yet and this task cannot start.

So the deliverable is not "the tests are green": it is
`peakpower-platform/artifacts/openapi/customer.json` and `employee.json` **committed, containing
the new paths and the new schemas**, because those two files are what `npm run generate:clients`
reads across the repository boundary. Step 7 checks that by name before this task is called done.

⚠ **This plan stops here.** Shared contract §10.5 continues into `peakpower-web` with
`npm run generate:clients` and the committed `*-schema.d.ts`; §17 assigns that to **plan 7**. Plan 6
writes no Angular code and regenerates no typed client.

⚠ **The two schema transformers are what put the enum VALUES in the documents.** Every DTO in
`PeakPower.Contracts` carries its enum-shaped fields as `string`, because that assembly references
nothing — so without an entry here the emitted schema for `ConsumptionDayResponse.dataState` is a
bare `{ "type": "string" }`, with `NO_DATA`, `PARTIAL`, `PROVISIONAL` and `FINAL` nowhere in the
document. Plan 7's label maps and its five data-state treatments need the actual values. The values
come from `EnumWireFormat.Names<T>()` and never from a literal list: that is the same source
`PortalMappings.Wire(...)` is held to, so a member added to a domain enum reaches the document
without anybody remembering these two files.

⚠ **`ReplayMessageResponse.outcome` gets NO entry, and that is not an omission.** `REPLAYED`,
`NO_CHANGE` and `FAILED` are shared contract §10.4's three words and there is no domain enum with
those members — `InboundMessageProcessingStatus` is `Applied`, `NoChange`, `Failed`,
`RecognisedAndClosed`, which is why Task 12's mapping is an explicit switch. An entry keyed to that
enum would document `APPLIED` on a frozen wire. `outcome` stays an undocumented `string`, and Task
12's switch plus its `default` arm is what holds it to three values. Same for
`ConsumptionIntervalDto.dstPass`: `"A"`, `"B"` and `null` are not an enum anywhere in this platform.

**Files:**
- Modify: `src/Hosts/PeakPower.Api.Customer/OpenApi/EnumWireValuesSchemaTransformer.cs:54` — seven
  entries
- Modify: `src/Hosts/PeakPower.Api.Employee/OpenApi/EnumWireValuesSchemaTransformer.cs:41` — five
  entries
- Modify: `artifacts/openapi/customer.json` — regenerated at build
- Modify: `artifacts/openapi/employee.json` — regenerated at build
- Modify: `tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json` — re-accepted
- Modify: `tests/PeakPower.Integration.Tests/Contract/EmployeeOpenApiSnapshotTests.the_employee_openapi_document_matches_the_reviewed_snapshot.verified.json` — re-accepted

**Interfaces:**
- Consumes: `EnumWireFormat.Names<T>()` (slice 1); `MeteringDayState`, `InboundMessageStatus`,
  `QuarantineReason`, `IntervalDirection` (shared contract §4, plan 2); `ProductionExpectation`,
  `ProductionExpectationSource` (slice 1); every DTO of Tasks 1 and 9.
- Produces: `artifacts/openapi/customer.json` and `artifacts/openapi/employee.json` carrying the
  three new customer paths' worth of schemas and the four new employee paths — **the input plan 7
  Task 6 reads.**

- [ ] **Step 1: Confirm the documents are stale before touching them**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~OpenApiSnapshotTests"
```
Expected: **FAIL** — both `the_customer_openapi_document_matches_the_reviewed_snapshot` and
`the_employee_openapi_document_matches_the_reviewed_snapshot`, with `VerifyException` and a diff
naming `/api/v1/consumption/day`, `/api/v1/consumption/month` and the four `/api/v1/data-health/*`
paths as **added**.

This is the evidence the guard works before it is used. If either passes, the build did not
regenerate: delete `artifacts/openapi/customer.json` and `artifacts/openapi/employee.json` and
rebuild — `ClearStaleOpenApiCache` in each `.csproj` deletes the incremental cache when the
committed artefact is missing, which is exactly the case it exists for.

⚠ `the_document_is_emitted_at_build` in both classes must be **green** at this point. If it is red,
the document was not written at all and nothing below applies.

- [ ] **Step 2: Add the customer host's seven entries**

In `src/Hosts/PeakPower.Api.Customer/OpenApi/EnumWireValuesSchemaTransformer.cs`, after
`[(typeof(EanPoolEntryDto), "commodity")]` at `:54`:

```csharp

            // Slice 2's consumption envelopes (shared contract §10.1, §10.2, §10.3). Every one of
            // these is a MeteringDayState on the wire, spelled NO_DATA | PARTIAL | PROVISIONAL |
            // FINAL - there is no COMPLETE member, and plan 7's five data-state treatments key off
            // exactly these four values.
            [(typeof(ConsumptionDayResponse), "dataState")] = EnumWireFormat.Names<MeteringDayState>(),
            [(typeof(ConsumptionSummaryDto), "dataState")] = EnumWireFormat.Names<MeteringDayState>(),
            [(typeof(ConsumptionMonthResponse), "dataState")] = EnumWireFormat.Names<MeteringDayState>(),
            [(typeof(ConsumptionMonthDayDto), "dataState")] = EnumWireFormat.Names<MeteringDayState>(),
            [(typeof(DayStateDto), "state")] = EnumWireFormat.Names<MeteringDayState>(),

            // The declared zero's provenance [F01-R40]. Both are slice 1's enums unchanged, and
            // the pair is what makes productionDeclaration a STATED zero traceable to its source,
            // setter and date rather than a gap.
            [(typeof(ProductionDeclarationDto), "expectation")] = EnumWireFormat.Names<ProductionExpectation>(),
            [(typeof(ProductionDeclarationDto), "source")] = EnumWireFormat.Names<ProductionExpectationSource>(),
```

and add `using PeakPower.Domain.Metering;` to the file's using directives — `MeteringDayState` is
plan 2's, in `PeakPower.Domain.Metering`, while `ProductionExpectation` and
`ProductionExpectationSource` are slice 1's in `PeakPower.Domain.Customers`, which is already
imported at `:7`.

⚠ **`ConsumptionIntervalDto.dstPass` gets no entry** and neither does anything else on that record.
`"A"`, `"B"` and `null` are not an enum in this platform, and inventing one to satisfy a pattern
would put a type in the document that no C# code has.

- [ ] **Step 3: Add the employee host's five entries**

In `src/Hosts/PeakPower.Api.Employee/OpenApi/EnumWireValuesSchemaTransformer.cs`, after
`[(typeof(UpdateMeteringPointRequest), "expectationSource")]` at `:41`:

```csharp

            // Slice 2's data-health envelopes (shared contract §10.4). Four of the five spellings
            // this plan puts on a wire; the fifth, ProductionExpectation, is slice 1's and appears
            // here on a new DTO.
            [(typeof(DataHealthMessageDto), "status")] = EnumWireFormat.Names<InboundMessageStatus>(),
            [(typeof(QuarantinedSeriesDto), "reason")] = EnumWireFormat.Names<QuarantineReason>(),
            [(typeof(QuarantinedSeriesDto), "direction")] = EnumWireFormat.Names<IntervalDirection>(),
            [(typeof(DataHealthMeteringPointDto), "productionExpectation")] = EnumWireFormat.Names<ProductionExpectation>(),
            [(typeof(EmployeeDayStateDto), "state")] = EnumWireFormat.Names<MeteringDayState>(),
```

and add `using PeakPower.Domain.Metering;` to the file's using directives.

⚠ **`ReplayMessageResponse.outcome` is deliberately absent** — see this task's preamble. So is
`DataHealthMeteringPointDto.brpCode`, which is a free-text code column and not an enum.

- [ ] **Step 4: Rebuild and read the diff**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
git --no-pager diff --stat artifacts/openapi/
```
Expected: both files changed, and both grown.

Then read what actually landed, into a file rather than trusting a terminal:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -n '"/api/v1/consumption/day"\|"/api/v1/consumption/month"\|ConsumptionDayResponse\|ConsumptionMonthResponse\|ConsumptionIntervalDto\|ConsumptionMonthDayDto\|ConsumptionSummaryDto\|ProductionDeclarationDto\|DayStateDto\|recentDataStates' \
  artifacts/openapi/customer.json > /tmp/pp-openapi-customer.txt
grep -n '"/api/v1/data-health/messages"\|"/api/v1/data-health/quarantine"\|"/api/v1/data-health/metering-points"\|replay\|DataHealthMessageDto\|QuarantinedSeriesDto\|DataHealthMeteringPointDto\|ReplayMessageResponse\|EmployeeDayStateDto' \
  artifacts/openapi/employee.json > /tmp/pp-openapi-employee.txt
wc -l /tmp/pp-openapi-customer.txt /tmp/pp-openapi-employee.txt
```

Then **read both files.** ⚠ A bare `grep` in this repository's tooling truncates and, on a long
match list, invents lines; redirect and read the file back, which is why both commands above do.

Expected: every name present. In particular `recentDataStates` must appear in `customer.json` —
that is Task 8's field on `ConnectionDetailDto`, and plan 7's connection-detail strip is generated
from it.

- [ ] **Step 5: Re-accept both snapshots**

The failing run in Step 1 wrote a `*.received.json` beside each `*.verified.json`. Accepting is
copying one over the other, and it is a **review step**: read the diff first.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract
git --no-pager diff --no-index \
  CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json \
  CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.received.json \
  > /tmp/pp-customer-snapshot.diff; wc -l /tmp/pp-customer-snapshot.diff
```

Read `/tmp/pp-customer-snapshot.diff`, and the same for the employee pair. **Every line must be an
addition.** A removal or a change on an existing path is this plan breaking a contract slice 1
froze — stop and fix the endpoint, not the snapshot.

Then accept:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract
cp CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.received.json \
   CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json
cp EmployeeOpenApiSnapshotTests.the_employee_openapi_document_matches_the_reviewed_snapshot.received.json \
   EmployeeOpenApiSnapshotTests.the_employee_openapi_document_matches_the_reviewed_snapshot.verified.json
rm -f *.received.json
```

⚠ Plain `cp`, never `cp -a`: `-a` preserves mtimes and leaves MSBuild with stale binaries, which is
this repository's own recorded footgun.

- [ ] **Step 6: Run the contract suite and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~Contract"
```
Expected: PASS — both snapshot classes, `EmployeeOpenApiLiveDocumentTests`,
`CustomerResponseMetadataTests` and `EnumWireAlgorithmDivergenceTests`.

`EmployeeOpenApiLiveDocumentTests.the_running_hosts_document_matches_the_build_time_artefact` is the
one worth naming: it boots the real employee host and compares what it **serves** at
`/openapi/employee.json` against the committed artefact, minus `servers[0].url`. It is what makes
the file plan 7 generates from the same document this host actually answers with — and it is the
test that would catch a transformer entry that only ran at build time.

- [ ] **Step 7: Prove the hand-off to plan 7 works, from plan 7's side**

Plan 7 Task 6 cannot start until `npm run verify:clients` reports **stale**. Run its Step 1 command
now, from this repository's sibling, and read the answer:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && \
  PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform npm run verify:clients
```
Expected: **FAIL** — `@peakpower-nl/api-client-customer is stale.` … `first difference at line <n>`
… `Run 'npm run generate:clients', review the diff, and commit it.`, and the same for
`@peakpower-nl/api-client-employee`.

⚠ **If it says `up to date`, this task is not finished.** That is plan 7's own tripwire, quoted in
its Step 1, and it means the documents plan 7 reads do not contain these endpoints — go back to
Step 4 and find out which build did not run.

⚠ **Run nothing else in `peakpower-web`.** `npm run generate:clients` and the regenerated
`*-schema.d.ts` are plan 7's commit, not this one's (shared contract §17). Leaving the guard red is
the correct end state for this plan.

- [ ] **Step 8: Mutation-verify that a transformer entry is what carries the values**

Delete `[(typeof(DayStateDto), "state")]` from the customer transformer, rebuild, and look at the
document:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo
grep -n -A12 '"DayStateDto"' artifacts/openapi/customer.json > /tmp/pp-daystate.txt; \
  cat /tmp/pp-daystate.txt
```
Expected: the `state` property is a bare `{ "type": "string" }` with no `enum` array — the four
values are simply **gone**, and nothing failed to compile.

Run: `dotnet test tests/PeakPower.Integration.Tests --filter "FullyQualifiedName~the_customer_openapi_document_matches_the_reviewed_snapshot"`
Expected: FAIL — `VerifyException`, the diff showing the `enum` array removed.

⚠ This is the mutation that matters, and the reason the snapshot is the guard rather than a build
warning: a missing entry is **silent**. The document is still valid OpenAPI, the client still
generates, and `dataState` arrives in `peakpower-web` as `string` instead of a union of four
literals — so plan 7's five data-state treatments compile against a type that permits anything, and
the first wrong spelling is found by a customer looking at a chart. Restore the entry, rebuild,
re-accept nothing (the document returns to the accepted bytes), and re-run to green.

- [ ] **Step 9: Whole-solution check**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln
tools/verify-solution-layout.sh
tools/verify-build-settings.sh
git status --porcelain > /tmp/pp-status.txt; cat /tmp/pp-status.txt
```
Expected: build clean, every test green, both scripts pass, and `git status` shows **no
`*.received.json`** left behind — an accepted snapshot with its received twin still on disk is a
file somebody will commit by accident and a future run will overwrite.

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Customer/OpenApi/EnumWireValuesSchemaTransformer.cs \
        src/Hosts/PeakPower.Api.Employee/OpenApi/EnumWireValuesSchemaTransformer.cs \
        artifacts/openapi/customer.json \
        artifacts/openapi/employee.json \
        tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json \
        tests/PeakPower.Integration.Tests/Contract/EmployeeOpenApiSnapshotTests.the_employee_openapi_document_matches_the_reviewed_snapshot.verified.json
git commit -m "feat(openapi): the slice 2 read surfaces reach both contract documents

Shared contract 10.5 and design 5 step 9: the documents are regenerated and the Verify
snapshots re-accepted in the same commit as the endpoints, because peakpower-web
generates a typed client from the committed artefacts and an unreviewed change there
breaks a second repository silently.

Seven entries on the customer transformer and five on the employee one. Without them the
enum-shaped strings emit as bare { \"type\": \"string\" } and the values vanish from the
document entirely - every DTO in PeakPower.Contracts carries them as string because that
assembly references nothing. The values come from EnumWireFormat.Names<T>(), never from a
literal list, so a member added to a domain enum reaches the document without anybody
remembering these two files.

ReplayMessageResponse.outcome and ConsumptionIntervalDto.dstPass get no entry on purpose:
neither is a domain enum, and keying outcome to InboundMessageProcessingStatus would
document APPLIED on a wire 10.4 freezes as REPLAYED | NO_CHANGE | FAILED.

Every line of both snapshot diffs is an addition. No existing path or schema moved.

Hand-off: peakpower-web's `npm run verify:clients` now reports both clients STALE, which
is what plan 7 Task 6's first step requires before it can start. Regenerating the typed
clients is plan 7's commit (shared contract 17), not this one's.

Verified: deleting the DayStateDto entry removed the four data-state values from
customer.json without failing a build - the document stayed valid OpenAPI and dataState
would have reached peakpower-web as an unconstrained string - and the snapshot test is
what caught it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done

Thirteen tasks. What this plan leaves for the two plans that read from it:

- **Plan 7 Task 6** takes `artifacts/openapi/{customer,employee}.json` from Task 13 and generates
  the typed npm clients. Its Step 1 is the tripwire: `npm run verify:clients` must say **stale**.
- **Plan 8** takes the four employee routes and the two consumption routes as the surfaces its
  close-out exercises end to end.

And what it deliberately does not do: no migration SQL, no entity, no query filter, no member of
`IMarketCalendar`, no Angular, no key of shared contract §10.
