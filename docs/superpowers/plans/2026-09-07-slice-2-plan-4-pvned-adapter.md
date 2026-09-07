# PVNed Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `PeakPower.Integration.Brp.Pvned` — the first and only implementation of the
`[DEC-69]` BRP port — so that a PVNed `TimeSeriesDocument` arriving as bytes becomes either a
canonical series set, a typed rejection carrying one of the frozen failure codes, or a recognised-
and-closed A12, with every decision proven against hand-written checked-in fixtures.

**Architecture:** One library that references only `PeakPower.Application` and `PeakPower.Domain`
and never `PeakPower.Ingestion` — the port points one way, and architecture fact 3 enforces the
other direction. Inside it: a hardened XML reader (`DtdProcessing.Prohibit`, `XmlResolver = null`,
`MaxCharactersFromEntities = 0`) that unwraps the SOAP envelope, an embedded *reconstructed* XSD
named so nobody can mistake it for the vendor's, a semantic validator that raises the eleven
integration-spec §8.2 codes plus the two the shared contract decides, and a mapper that turns
`Direction`, `MeasurementUnit`, `MeasurementPeriode` and `Pos` into `CanonicalSeries`. It touches
no database, resolves no EAN and decides no quarantine: those are pipeline stages, and `[F02-R40]`
forbids an adapter reimplementing one.

**Tech Stack:** .NET SDK 10.0.400 · C# `latest` · net10.0 · `System.Xml` / `System.Xml.Linq` /
`System.Xml.Schema` from the shared framework (no XML NuGet package is added) ·
`Microsoft.Extensions.Logging.Abstractions` 10.0.11 ·
`Microsoft.Extensions.Configuration.Abstractions` 10.0.11 · xUnit v3 3.2.2 ·
Shouldly 4.3.0 · NSubstitute 6.2.0 · `Microsoft.Extensions.TimeProvider.Testing` 10.9.0

**Spec:** docs/superpowers/specs/2026-09-07-poc-slice-2-design.md
**Shared contract:** docs/superpowers/plans/2026-09-07-slice-2-shared-contract.md

## Global Constraints

### Versions — exact, from the shared contract §1, verified 2026-09-07

| | |
| --- | --- |
| .NET SDK | **10.0.400** (`global.json`, `rollForward: latestFeature`) |
| Target framework | **net10.0**, `LangVersion latest`, `Nullable enable`, `TreatWarningsAsErrors`, `AnalysisMode Recommended` |
| EF Core | **10.0.11** — this plan adds no persistence code and references no EF package |
| `Microsoft.Extensions.Logging.Abstractions` | **10.0.11** (already pinned in `Directory.Packages.props`) |
| `Microsoft.Extensions.Configuration.Abstractions` | **10.0.11** (already pinned) |
| `xunit.v3` | **3.2.2** (+ `xunit.runner.visualstudio` 3.1.5, `Microsoft.NET.Test.Sdk` 18.9.0) |
| `Shouldly` | **4.3.0** — ⚠ **never FluentAssertions** `[DEC-118]`; `verify-build-settings.sh` fails the build if it reappears |
| `NSubstitute` | **6.2.0** |
| `Microsoft.Extensions.TimeProvider.Testing` | **10.9.0** — `FakeTimeProvider` for the real `MarketCalendar` in adapter tests |

⚠ **No new `PackageVersion` is added to `Directory.Packages.props` by this plan.** Everything the
adapter needs is either in the shared framework (`System.Xml*`) or already centrally pinned. If you
find yourself wanting `Microsoft.Extensions.Options` or `Microsoft.Extensions.Configuration.Binder`,
stop: §8.6's options object is a plain POCO read through the `IConfiguration` indexer for exactly
this reason (Task 1, step 5).

### Repositories

```
/Users/thinhhuynh/PeakPower/peakpower-platform      # .NET — everything in this plan
/Users/thinhhuynh/PeakPower/peakpower-web           # Angular — untouched by this plan
```

### Naming

- .NET namespace root `PeakPower.` — this plan's namespace is `PeakPower.Integration.Brp.Pvned`
- C#: PascalCase. The adapter writes nothing to the database, so no snake_case mapping arises here
- ⚠ **`RecourceName` is spelled that way in PVNed's schema. It is normative. Do not "fix" it.**
  (integration-spec §3, shared contract §8.1.) The reconstructed XSD, the fixtures and the reader
  all spell it `RecourceName`, and a test asserts the misspelling survives.

### Project references — what this project may see

| Project | References |
| --- | --- |
| `PeakPower.Integration.Brp.Pvned` | `PeakPower.Application`, `PeakPower.Domain`. ⚠ **Never `PeakPower.Ingestion`** — the port points one way. ⚠ **Never `PeakPower.Infrastructure.Time`** — it consumes `IMarketCalendar`, the port, never the implementation |
| `tests/PeakPower.Application.Tests` | gains `PeakPower.Integration.Brp.Pvned`. It already references `PeakPower.Infrastructure.Time`, which is where the real `MarketCalendar` comes from for the DST assertions |

Shared contract §3.1's table: *"Calendar, adapter parsing, canonical mapping, quantity maths — no
I/O → `tests/PeakPower.Application.Tests`"*. **No new test project is created**; the project count
stays at twenty-two and `tools/verify-solution-layout.sh` is untouched by this plan.

### Enums this plan consumes and must not re-declare

Declared by **plan 2** in `PeakPower.Domain.Metering` (shared contract §4):

```csharp
public enum IntervalDirection { Consumption, Production }
// db/wire: CONSUMPTION | PRODUCTION
```

Declared by **plan 3** in `PeakPower.Application.Abstractions.Ingestion` (shared contract §7.1):

```csharp
public enum BrpParseStatus  { Accepted, Rejected, RecognisedAndClosed }
public enum BrpDocumentKind { Allocation, Imbalance }
```

Declared by **this plan**, adapter-internal, never persisted as an enum column (contract §4):

```csharp
namespace PeakPower.Integration.Brp.Pvned;

public enum PvnedDocumentType { Allocation, Imbalance }   // A23 → Allocation, A12 → Imbalance
```

⚠ **No slice-2 enum member may contain two adjacent capitals** (contract §4). `PvnedDocumentType`'s
two members have only isolated capitals, so `EnumWireFormat` and `EnumToScreamingSnakeConverter`
agree on both — even though this enum never reaches either.

### The port this plan implements — shared contract §7.1, NORMATIVE, declared by plan 3

Reproduced here so this plan is self-contained. **Do not re-declare any of it.**

```csharp
namespace PeakPower.Application.Abstractions.Ingestion;

public interface IBrpIngestionAdapter
{
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

public sealed record BrpDocument(
    string DocumentId,
    DateTimeOffset DocumentCreated,
    BrpDocumentKind Kind,
    IReadOnlyList<CanonicalSeries> Series);

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

### The calendar port this plan consumes — shared contract §7.5, owned by plan 1

```csharp
namespace PeakPower.Application.Abstractions;

public interface IMarketCalendar
{
    DateTimeOffset UtcNow { get; }
    DateOnly TodayInAmsterdam { get; }
    int ExpectedIntervalCount(DateOnly date);          // 92 | 96 | 100
    DateTimeOffset IntervalStart(DateOnly date, int pos);
    bool IsDstDuplicate(DateOnly date, int pos);
    DateOnly AddWorkingDays(DateOnly from, int workingDays);
}
```

⚠ **This plan declares no member of `IMarketCalendar`.** Plan 1 owns every one of them
(contract §17). This plan calls `ExpectedIntervalCount` and `IntervalStart` and asserts against
them; it never re-derives 92/96/100 and never adds fifteen minutes in a loop.

### HTTP, tenancy, database

None of the three appears in this plan. The adapter is a pure function of bytes plus the calendar
plus two configured GLNs. If a step in this plan makes you reach for a `DbContext`, an
`HttpContext` or a connection string, the step is wrong.

### The frozen failure codes — shared contract §8.4

**These exact strings go in the code, in the DevStubs scenario names, on
`inbound_message.failure_code` and on the employee screen. No plan may respell one.** Transcribed
from `specs/30-integrations/01-pvned-timeseries.md` §8.2, in the source's own order.

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
| 10 | `ResourceObject` resolves to a registered metering point valid on that date | `UNKNOWN_METERING_POINT` | **quarantine, not reject — PIPELINE, not this adapter** |
| 11 | That metering point's assigned BRP is the one this adapter serves | `WRONG_BRP_FOR_METERING_POINT` | **quarantine, not reject — PIPELINE, not this adapter** |

Two more, adapter-level and beyond §8.2, decided by the shared contract §16 item 4:

| Code | Raised when |
| --- | --- |
| `UNSUPPORTED_DIRECTION` | `Direction` is `A03` or `A04`. §8.2 has no row; integration-spec §4.1 says both are rejected |
| `UNSUPPORTED_MEASUREMENT_UNIT` | `MeasurementUnit` is `KWT` or `MAW` on an allocation series — a power, not an energy, so it cannot become a `quantity_kwh` |

Three more, **structural**, decided by this plan because integration-spec §8.1 states three
structural rules and gives no code for any of them, and the design requires a machine-readable code
on every failure (design §7.3):

| Code | Raised when |
| --- | --- |
| `MALFORMED_XML` | The bytes are not well-formed XML, **or** they carry a DTD (which the hardened reader refuses), **or** an entity expansion is attempted |
| `MISSING_SOAP_BODY` | Well-formed XML, but there is no `soap:Envelope/soap:Body/pv:TimeSeriesDocument` element |
| `SCHEMA_VALIDATION_FAILED` | The `TimeSeriesDocument` element fails validation against the reconstructed XSD `[F02-R09]` |

⚠ **Rules 10 and 11 are the pipeline's, not this adapter's** (contract §8.4, §7.1). The adapter
declares their constants so that plans 5, 6 and 8 read one spelling, and **a test in Task 15
asserts the adapter never returns either of them.** An adapter that queried
`customer.metering_point` would have reimplemented a pipeline stage, which `[F02-R40]` forbids in
so many words.

### The check order — pinned, and it is a decision

The eleven §8.2 rules are a table, not a sequence, and the design does not order them. This plan
pins the order below, and Task 14 asserts it with a document that violates two rules at once.
**Every negative fixture violates exactly one rule and is otherwise a valid document**, so the
order is what makes each fixture's expected code deterministic.

```
  structural          1. MALFORMED_XML              (hardened read)
                      2. MISSING_SOAP_BODY          (envelope unwrap)
                      3. SCHEMA_VALIDATION_FAILED   (reconstructed XSD)
  document header     4. WRONG_RECEIVER
                      5. UNKNOWN_SENDER
                      6. DocumentType branch:  A12 → RecognisedAndClosed
                                               A23 + ProcessType in {A05,A16} → continue
                                               otherwise → UNSUPPORTED_DOCUMENT_TYPE
  per TimeSeries,     7. UNSUPPORTED_RESOLUTION
  in document order   8. UNSUPPORTED_CURVE_TYPE
                      9. UNSUPPORTED_DIRECTION
                     10. UNSUPPORTED_MEASUREMENT_UNIT
                     11. INVALID_MEASUREMENT_PERIOD
                     12. INCOMPLETE_PERIOD
                     13. INVALID_POSITIONS
                     14. NEGATIVE_QUANTITY
```

⚠ **The receiver and sender checks run BEFORE the document-type branch, and that ordering is
load-bearing.** A document addressed to somebody else is not ours to recognise. If `DocumentType`
were tested first, a misrouted A12 would be *recognised and closed successfully* — a 200, a
`PROCESSED` message and a stored payload we had no business accepting. Task 7 asserts this
directly.

### Testing

| Layer | Tooling |
| --- | --- |
| Adapter parsing, canonical mapping, quantity maths — no I/O | `tests/PeakPower.Application.Tests`, xUnit v3 + **Shouldly** + NSubstitute |

Syntax is `actual.ShouldBe(expected)`. ⚠ **Shouldly's `ShouldContain` is case-insensitive by
default** and has silently broken three tests in this repository; where this plan asserts on a
substring it passes `StringComparison.Ordinal` explicitly and otherwise asserts on a structured
field.

**Verify by mutation** (`CLAUDE.md`, contract §15.1): break the specific behaviour, watch the test
fail, **check the failure is the one you predicted**, then restore. A mutation that breaks the
*build* proves nothing about an assertion. Every task below names what to break, what failure to
predict, and what to watch go red.

⚠ **Mutate the case your assertion is actually for, not the easy neighbouring one.**

### The rule that governs every fixture in this plan

**Design §8, first risk row, and design §10:** the generator and the parser share an author and a
source document, so a shared misreading of the PVNed format passes every test in the slice.
Three deliberate breaks in that circle, two of which are this plan's:

- **Every negative fixture is HAND-WRITTEN and checked in, never generated** — including the XXE
  payload and the billion-laughs payload.
- **The golden positive document is transcribed BY HAND from integration-spec §6.**

Concretely, in this plan that means: **no fixture in `tests/PeakPower.Application.Tests/Ingestion/
Pvned/Fixtures/` may be produced by a loop, a script, a serialiser or `PeakPower.DevStubs`.** Every
`<Point>` line in this plan is written out in full for the implementer to copy verbatim. If a step
tempts you to write `for (var i = 1; i <= 96; i++)` to build a fixture, that is the circle closing
and the step is wrong. DevStubs' own `invalid-*` documents (plan 5) drive the *pipeline* end to
end; they do not replace these files.

### Copy rules

The adapter emits `FailureDetail` strings that reach an employee screen. Slice 1's rules bind them:
sentence case, no emoji, no icon set, and the sentence names the field and the observed value.
`FailureCode` is SCREAMING_SNAKE and frozen; `FailureDetail` is an ordinary English sentence
ending in a full stop.

---

## Scope boundary for this plan

This is **plan 4 of 8**, design-doc step 5. It builds **everything inside
`src/Infrastructure/PeakPower.Integration.Brp.Pvned`** and its tests:

- `PvnedAdapterOptions` (contract §8.6) and `AddPvnedBrpAdapter`
- `PvnedFailureCodes` — the thirteen frozen codes plus the three structural ones
- `SchemaProvenance` — the nine integration-spec §9 inconsistencies and the **permissive** reading
  taken on each, one test per row
- `TimeSeriesDocument-v2p0.reconstructed.xsd`, embedded, with a test asserting the filename says
  `reconstructed`
- `PvnedXmlReader` — SOAP unwrap and XXE hardening in the **first** XML-reading commit
- `PvnedIngestionAdapter` — code decoding, `ResourceObject` interpretation, `MeasurementPeriode` →
  Amsterdam delivery date, Pos → the calendar's instant, the eleven §8.2 semantic rules
- Twenty-five hand-written checked-in fixtures

It deliberately does **not** build:

- **Anything in `PeakPower.Ingestion`** — the webhook, the credential check, the 413, the dedupe,
  the correlation id, the advisory lock, the apply transaction, supersession, the four quarantine
  reasons. All of that is **plan 3**, and the adapter may not reference the project it lives in.
- **`IBrpIngestionAdapter`, `BrpParseRequest`, `BrpParseOutcome`, `BrpDocument`,
  `CanonicalSeries`, `CanonicalPoint`, `IBrpIngestionAdapterRegistry`** — declared by **plan 3**
  in `PeakPower.Application.Abstractions.Ingestion` (contract §17). Two plans declaring the same
  record is a duplicate-member compile error, not a merge.
- **Any member of `IMarketCalendar`** — plan 1's, all of them (contract §17).
- **Any entity, migration or EF configuration** — plan 2's, all of them.
- **`imbalance_reading` / `imbalance_price` and integration-spec §7.2's mapping.** `[DEC-25]` puts
  imbalance out of scope: an A12 document is recognised, stored and closed with **zero** readings
  written (design §3.2, §7.13). This plan implements *recognised and closed*, and nothing else.
- **The `A12` sample's `BusinessType` decoding** (`A14`, `A02`, `A20`, `B23`, `B24`, `B25`,
  integration-spec §4.2). It is only needed to turn an imbalance document into imbalance rows,
  which `[DEC-25]` defers. `BusinessType` is read for logging and never branched on.
- **The `[F02-R08]` SOAP acknowledgement.** Design §3.2 defers it: its form is `[OQ-05]`, and
  building one would guess at a third party's wire format.
- **DevStubs' documents** — plan 5.

**Two places where this plan decides something neither the design nor the contract settles**, both
listed again in the plan's own open-issues note at the end:

1. **Three structural failure codes** (`MALFORMED_XML`, `MISSING_SOAP_BODY`,
   `SCHEMA_VALIDATION_FAILED`). Integration-spec §8.1 states three structural rules and names no
   code for any; design §7.3 requires a machine-readable code on every failure.
2. **The reconstructed XSD validates structure, not code lists.** `CurveType`, `MeasurementUnit`,
   `Direction`, `DocumentType`, `ProcessType` and `BusinessType` are plain strings in the schema
   and are enforced **semantically**, so that what an operator sees is the frozen §8.2 code rather
   than a schema error. Without this the `UNSUPPORTED_CURVE_TYPE` and
   `UNSUPPORTED_MEASUREMENT_UNIT` rows of contract §8.4 would be unreachable. `SchemaProvenance`
   rows 5 and 9 record it.

## Domain terms used in this plan

Assume no knowledge of Dutch energy trading or of PVNed's document format.

- **BRP (*balanceringsverantwoordelijke partij*)** — the market participant answerable to the Dutch
  grid operator for a connection's imbalance. Reference data: a row with its own endpoint,
  credentials, document format and ingestion adapter. PVNed is the first one.
- **EAN** — the eighteen-digit code identifying one electricity connection point in the Dutch grid.
  `[DEC-114]` relaxed validation to "eighteen digits"; the GS1 check digit is `[OQ-97]` and is
  **not** reinstated by this slice.
- **`TimeSeriesDocument`** — PVNed's XML document. A header, then zero or more `TimeSeries`, each
  carrying a `Resource` (an EAN or a label), a `MeasurementPeriode` (one calendar day) and one or
  more `Period` blocks of `Point`s.
- **`Pos`** — the 1-based position of a fifteen-minute interval inside the delivery day. `Pos = 1`
  is local 00:00–00:15. A normal day has 96; the spring-forward Sunday has 92; the autumn
  fall-back Sunday has 100, where `Pos` 9–12 are the **first** pass of 02:00–03:00 and 13–16 the
  **second**.
- **`DocumentType`** — `A23` is an allocation (per-EAN consumption and production); `A12` is a
  portfolio-level imbalance report.
- **`Direction`** — `A01` is **production**, `A02` is **consumption**. ⚠ Note the trap:
  `BusinessType` `A01` also means production and `A04` means consumption, on a **different** field.
  The two code lists are not the same list.
- **GLN** — a thirteen-digit Global Location Number identifying a market party. PVNed's is
  `8714252005776`; PeakPower's is `8712423456789` (integration-spec §6).
- **Allocation** — the BRP's statement of how much a connection consumed or produced per interval.
- **Quarantine** — a storage state with a replay path, decided by the pipeline, never by an adapter.
- **XXE** — XML external-entity injection: a DTD that pulls a local file or a network resource into
  the parsed document. **Billion laughs** — nested entity definitions that expand exponentially.
  Both are stopped by refusing DTDs outright.

---

## File Structure

### `/Users/thinhhuynh/PeakPower/peakpower-platform`

| File | Responsibility |
| --- | --- |
| `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj` | **modified** (plan 1 creates it): two package references, the embedded XSD with a pinned `LogicalName` |
| `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedAdapterOptions.cs` | the two GLNs, bound from configuration section `Brp:Pvned` (contract §8.6) |
| `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedFailureCodes.cs` | the sixteen code constants and the four ordered lists over them |
| `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedDocumentType.cs` | `Allocation` / `Imbalance` — adapter-internal, never persisted (contract §4) |
| `src/Infrastructure/PeakPower.Integration.Brp.Pvned/SchemaProvenance.cs` | the nine integration-spec §9 rows and the permissive reading taken on each |
| `src/Infrastructure/PeakPower.Integration.Brp.Pvned/Schemas/TimeSeriesDocument-v2p0.reconstructed.xsd` | the reconstructed schema. **Named `reconstructed` on purpose; a test asserts it** |
| `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedSchema.cs` | loads the embedded XSD into a compiled `XmlSchemaSet`, once |
| `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedXmlReader.cs` | the hardened reader, the SOAP unwrap, and the XSD validation pass |
| `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedIngestionAdapter.cs` | `IBrpIngestionAdapter` — code decoding, mapping, the eleven semantic rules |
| `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedServiceCollectionExtensions.cs` | `AddPvnedBrpAdapter(services, configuration)` — the one DI entry point |
| `tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj` | **modified**: the adapter project reference and the twenty-five embedded fixtures |
| `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedFixtures.cs` | reads a fixture by name; throws with the full available list when one is missing |
| `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedFixtureInventoryTests.cs` | the exact fixture set, pinned — the vacuity guard |
| `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedFailureCodeTests.cs` | the eleven §8.2 codes in the source's own order, and the adapter/pipeline split |
| `tests/PeakPower.Application.Tests/Ingestion/Pvned/SchemaProvenanceTests.cs` | one test per §9 row, plus the "filename says reconstructed" test |
| `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedSchemaTests.cs` | the XSD compiles, targets the PVNed namespace, and actually bites |
| `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedXmlHardeningTests.cs` | XXE, billion laughs, malformed XML, missing SOAP body |
| `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedDocumentTypeTests.cs` | A23 processed, A12 recognised-and-closed, everything else rejected; receiver and sender |
| `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedDirectionTests.cs` | A01→PRODUCTION, A02→CONSUMPTION, A03/A04 rejected — the financial control |
| `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedMeasurementUnitTests.cs` | KWH, MWH×1000, KWT/MAW rejected, and the rounding rule |
| `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedPeriodTests.cs` | resolution, curve type, the Amsterdam delivery date, and `[OQ-20]` |
| `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedPointTests.cs` | point count, contiguity, non-negative quantity |
| `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedDstTests.cs` | 92 and 100-point days, and the 96-point document rejected for both |
| `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedResourceObjectTests.cs` | `[F02-R11]`/`[AS-17]` — eighteen digits is an EAN, anything else never is |
| `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedRejectionIsTotalTests.cs` | `[F02-R13]`, the check order, and "the adapter never raises a pipeline code" |
| `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedRegistrationTests.cs` | `AddPvnedBrpAdapter`, and `AdapterKey` matching migration 9's seeded literal |

### Fixtures — `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/`

**All twenty-five are hand-written and checked in. None is generated.**

| File | What it is |
| --- | --- |
| `golden-a12-imbalance.xml` | transcribed verbatim from integration-spec §6 |
| `golden-a23-both-directions-96.xml` | A02 + A01 for one EAN, 96 points each, 2026-08-12 |
| `golden-a23-dst-spring-92.xml` | 2026-03-29, 92 points, **MWh** — the unit conversion rides here |
| `golden-a23-dst-autumn-100.xml` | 2026-10-25, 100 points, Pos 13 deliberately different from Pos 9 |
| `golden-a23-non-ean-resources-96.xml` | one `RecourceName` label series and one series with no `Resource` at all |
| `invalid-wrong-receiver.xml` | `ReceiverIdentification` is somebody else's GLN |
| `invalid-wrong-receiver-a12.xml` | the same misrouting on an **A12**, which the A23 file cannot see |
| `invalid-unknown-sender.xml` | `SenderIdentification` is not the configured BRP's GLN |
| `invalid-unsupported-document-type.xml` | `DocumentType` `A01` |
| `invalid-unsupported-resolution.xml` | `Resolution` `PT60M` |
| `invalid-unsupported-curve-type.xml` | `CurveType` `A03` |
| `invalid-unsupported-direction.xml` | `Direction` `A03` |
| `invalid-unsupported-measurement-unit.xml` | `MeasurementUnit` `KWT` |
| `invalid-invalid-measurement-period.xml` | `MeasurementPeriode` spans two Amsterdam days |
| `invalid-incomplete-period-95.xml` | 95 contiguous points on an ordinary 96-point day |
| `invalid-incomplete-period-autumn-96.xml` | 96 points on the 100-point date |
| `invalid-incomplete-period-spring-96.xml` | 96 points on the 92-point date |
| `invalid-invalid-positions-96.xml` | 96 points, `Pos` 42 twice and 43 never |
| `invalid-negative-quantity-96.xml` | 96 points, `Pos` 50 carries `-12.500` |
| `invalid-total-rejection-second-series.xml` | a valid 96-point A02 followed by an A01 with `PT60M` |
| `invalid-two-rules-at-once.xml` | wrong receiver **and** an unsupported resolution |
| `structural-xxe-external-entity.xml` | a DOCTYPE with a `SYSTEM` entity pointing at `/etc/passwd` |
| `structural-billion-laughs.xml` | ten nested entity definitions |
| `structural-missing-soap-body.xml` | a SOAP envelope whose body holds something else |
| `structural-schema-pos-out-of-range.xml` | `Pos` 101 — the XSD's `maxInclusive` |

That is **twenty-five files**, and twenty-five is the only number this plan states about this
folder: the Scope boundary above, the `<EmbeddedResource>` comment in
`PeakPower.Application.Tests.csproj`, the `<remarks>` on `PvnedFixtures` and **Task 16's inventory
test all say twenty-five.** Two of them are written late — `invalid-two-rules-at-once.xml` and
`invalid-total-rejection-second-series.xml` land in Task 14 with the check-order assertion rather
than beside the other negatives, because a document that breaks two rules at once only means
something once every single-rule fixture exists.

---

## Prerequisites — do this before Task 1

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet --version          # must print 10.0.400
git log --oneline -1      # note the commit you start from
```

Then confirm the four things **other plans** must already have landed. If any of these fails, stop
and say which plan is missing rather than writing it yourself:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform

# Plan 1: the adapter project exists and is in the solution
test -f src/Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj \
  && echo "plan 1: project OK" || echo "plan 1: MISSING"

# Plan 1: the four calendar members exist on the port
grep -c 'ExpectedIntervalCount\|IntervalStart\|IsDstDuplicate\|AddWorkingDays' \
  src/Core/PeakPower.Application/Abstractions/IMarketCalendar.cs

# Plan 2: IntervalDirection exists in the domain
grep -rn 'enum IntervalDirection' src/Core/PeakPower.Domain/ | head -1

# Plan 3: the port is declared
test -f src/Core/PeakPower.Application/Abstractions/Ingestion/IBrpIngestionAdapter.cs \
  && echo "plan 3: port OK" || echo "plan 3: MISSING"
```

Expected: `plan 1: project OK`, a count of at least `4`, one `enum IntervalDirection` line, and
`plan 3: port OK`.

⚠ **Do not create any of those four things if they are missing.** Contract §17: plan 1 owns every
member of `IMarketCalendar`, plan 2 owns every entity and enum in `PeakPower.Domain.Metering`, and
plan 3 owns the port declarations. Two plans declaring the same type is a duplicate-member compile
error on the day the eight plans are assembled, and it is the single most likely way they fail.

---

### Task 1: The project's own wiring, and `PvnedAdapterOptions`

Plan 1 created `PeakPower.Integration.Brp.Pvned` with its two project references and nothing else
in it. This task gives it the two packages it needs, points `tests/PeakPower.Application.Tests` at
it, and lands the first type: the two GLNs of contract §8.6.

The GLNs live here rather than as columns on `metering.brp` because the design's column list for
that table is closed and a GLN is a **PVNed-format** concept rather than a **port** concept
(integration-spec §1.2 puts "parsing and code decoding" per adapter). Contract §16, item 5.

**Files:**
- Modify: `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj`
- Create: `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedAdapterOptions.cs`
- Modify: `tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj`
- Test: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedRegistrationTests.cs`

**Interfaces:**
- Consumes: nothing. This task compiles against the .NET shared framework alone.
- Produces: `PeakPower.Integration.Brp.Pvned.PvnedAdapterOptions` with
  `const string SectionName = "Brp:Pvned"`, `string SenderGln { get; set; }`,
  `string ReceiverGln { get; set; }`. Task 7 and Task 15 both consume it.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedRegistrationTests.cs`:

```csharp
using PeakPower.Integration.Brp.Pvned;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// Shared contract section 8.6 and section 16 item 5: the sender and receiver GLNs are adapter
/// configuration, not columns on metering.brp. The defaults are the two GLNs the reconstructed
/// sample in integration-spec section 6 actually carries, so a developer who configures nothing
/// still parses the golden document.
/// </summary>
public sealed class PvnedRegistrationTests
{
    [Fact]
    public void The_configuration_section_is_the_one_the_contract_names()
    {
        PvnedAdapterOptions.SectionName.ShouldBe("Brp:Pvned");
    }

    [Fact]
    public void The_default_sender_GLN_is_PVNeds_own_from_the_sample_document()
    {
        new PvnedAdapterOptions().SenderGln.ShouldBe("8714252005776");
    }

    [Fact]
    public void The_default_receiver_GLN_is_PeakPowers_own_from_the_sample_document()
    {
        new PvnedAdapterOptions().ReceiverGln.ShouldBe("8712423456789");
    }

    [Fact]
    public void Both_default_GLNs_are_thirteen_digits()
    {
        var options = new PvnedAdapterOptions();

        options.SenderGln.Length.ShouldBe(13);
        options.ReceiverGln.Length.ShouldBe(13);
        options.SenderGln.ShouldAllBe(character => char.IsAsciiDigit(character));
        options.ReceiverGln.ShouldAllBe(character => char.IsAsciiDigit(character));
    }

    [Fact]
    public void The_sender_and_receiver_are_different_parties()
    {
        var options = new PvnedAdapterOptions();

        options.SenderGln.ShouldNotBe(
            options.ReceiverGln,
            "WRONG_RECEIVER and UNKNOWN_SENDER are two different rules; equal defaults would make "
            + "one of them untestable");
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet build tests/PeakPower.Application.Tests --nologo`
Expected: FAIL with `error CS0246: The type or namespace name 'Pvned' does not exist in the
namespace 'PeakPower.Integration.Brp' (are you missing an assembly reference?)` — the test project
does not reference the adapter yet.

- [ ] **Step 3: Give the adapter project its packages and the embedded-schema slot**

Replace
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj`
with:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <!--
    The PVNed adapter: one implementation of the [DEC-69] BRP port.

    Architecture fact 3 runs the other way round - PeakPower.Ingestion must not reference this
    project - but the rule this file has to keep is its mirror: this project must never
    reference PeakPower.Ingestion, and must never reference PeakPower.Infrastructure.Time. It
    consumes IMarketCalendar, the port, so that the DST mapping has exactly one implementation
    and this adapter cannot grow a second one.
  -->
  <ItemGroup>
    <ProjectReference Include="../../Core/PeakPower.Application/PeakPower.Application.csproj" />
    <ProjectReference Include="../../Core/PeakPower.Domain/PeakPower.Domain.csproj" />
  </ItemGroup>

  <ItemGroup>
    <!-- PvnedIngestionAdapter logs the [OQ-20] Period.TimeInterval discrepancy and the
         section 9 row 5 unexpected-unit warning. Abstractions only: a parsing library must not
         pull in a host builder. -->
    <PackageReference Include="Microsoft.Extensions.Logging.Abstractions" />
    <!-- AddPvnedBrpAdapter reads Brp:Pvned:SenderGln / :ReceiverGln off IConfiguration through
         the indexer. Deliberately NOT Microsoft.Extensions.Configuration.Binder: the indexer is
         in Abstractions, Bind() is not, and adding a PackageVersion for one call is a change to
         a file eight parallel plans share. -->
    <PackageReference Include="Microsoft.Extensions.Configuration.Abstractions" />
  </ItemGroup>

  <ItemGroup>
    <!--
      The reconstructed schema, shipped inside the assembly rather than beside it: nothing reads
      an .xsd from disk at runtime, so validation cannot depend on what happens to be in a host's
      content root.

      LogicalName is stated rather than left to the default ($(RootNamespace) plus the folder
      path), following the precedent set by the funding-instructions template in
      PeakPower.Api.Customer: moving this file would otherwise silently rename the resource, and
      the only symptom would be every document failing SCHEMA_VALIDATION_FAILED. PvnedSchema
      names the same string and PvnedSchemaTests proves the two still agree.
    -->
    <EmbeddedResource Include="Schemas/TimeSeriesDocument-v2p0.reconstructed.xsd"
                      LogicalName="PeakPower.Integration.Brp.Pvned.Schemas.TimeSeriesDocument-v2p0.reconstructed.xsd" />
  </ItemGroup>
</Project>
```

⚠ The `<EmbeddedResource>` names a file that does not exist until Task 4. MSBuild fails a build
whose `EmbeddedResource` is missing, so **create the placeholder now** and let Task 4 replace it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
mkdir -p src/Infrastructure/PeakPower.Integration.Brp.Pvned/Schemas
cat > src/Infrastructure/PeakPower.Integration.Brp.Pvned/Schemas/TimeSeriesDocument-v2p0.reconstructed.xsd <<'XSD'
<?xml version="1.0" encoding="utf-8"?>
<!-- Task 4 replaces this placeholder with the reconstructed schema. -->
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           targetNamespace="http://www.pvned.eu/CustomerIntegrations/External/v2p0"
           elementFormDefault="qualified" />
XSD
```

- [ ] **Step 4: Point the test project at the adapter**

Add to the first `<ItemGroup>` of
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj`,
immediately after the `PeakPower.Infrastructure.Web` line:

```xml
    <!-- The PVNed adapter's parsing, canonical mapping and quantity maths are I/O-free, so
         shared contract section 3.1 puts their tests here rather than in Integration.Tests.
         PeakPower.Infrastructure.Time is already referenced above, which is what lets these
         tests drive the real MarketCalendar rather than a stubbed interval count. -->
    <ProjectReference Include="../../src/Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj" />
```

- [ ] **Step 5: Write `PvnedAdapterOptions`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedAdapterOptions.cs`:

```csharp
namespace PeakPower.Integration.Brp.Pvned;

/// <summary>
/// The two GLNs this adapter checks a document's header against. Shared contract section 8.6.
/// </summary>
/// <remarks>
/// <para>
/// These are adapter configuration rather than columns on <c>metering.brp</c>: the design's
/// column list for that table is closed, and a GLN is a PVNed-format concept rather than a port
/// concept - integration-spec section 1.2 puts "parsing and code decoding" per adapter. Shared
/// contract section 16, item 5.
/// </para>
/// <para>
/// The defaults are the two GLNs that appear in the reconstructed sample of integration-spec
/// section 6, so a clone with nothing configured still parses the golden document. They are
/// supplied in a deployment as <c>Brp__Pvned__SenderGln</c> and <c>Brp__Pvned__ReceiverGln</c>.
/// </para>
/// <para>
/// This is a plain POCO, not an <c>IOptions&lt;T&gt;</c> target, and that is deliberate:
/// <see cref="PvnedServiceCollectionExtensions.AddPvnedBrpAdapter"/> constructs it from the
/// <c>IConfiguration</c> indexer, so the adapter needs neither
/// <c>Microsoft.Extensions.Options</c> nor <c>Microsoft.Extensions.Configuration.Binder</c>, and
/// <c>Directory.Packages.props</c> - a file eight parallel plans share - is left alone.
/// </para>
/// </remarks>
public sealed class PvnedAdapterOptions
{
    /// <summary>The configuration section; <c>Brp__Pvned__*</c> as environment variables.</summary>
    public const string SectionName = "Brp:Pvned";

    /// <summary>PVNed's own GLN, checked against <c>SenderIdentification</c>. UNKNOWN_SENDER.</summary>
    public string SenderGln { get; set; } = "8714252005776";

    /// <summary>PeakPower's own GLN, checked against <c>ReceiverIdentification</c>. WRONG_RECEIVER.</summary>
    public string ReceiverGln { get; set; } = "8712423456789";
}
```

- [ ] **Step 6: Run the test and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedRegistrationTests"
```
Expected: PASS — 5 passed, 0 failed.

- [ ] **Step 7: Mutation — prove the GLN defaults are asserted, not just read**

Temporarily swap the two defaults in `PvnedAdapterOptions.cs`:

```csharp
    public string SenderGln { get; set; } = "8712423456789";
    public string ReceiverGln { get; set; } = "8714252005776";
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedRegistrationTests"`
Expected: FAIL — `The_default_sender_GLN_is_PVNeds_own_from_the_sample_document` fails with
`options.SenderGln should be "8714252005776" but was "8712423456789"`, and
`The_default_receiver_GLN_is_PeakPowers_own_from_the_sample_document` fails the mirror of it.
`Both_default_GLNs_are_thirteen_digits` and `The_sender_and_receiver_are_different_parties` still
pass — which is the point: a swap is exactly the mistake a shape-only assertion cannot see.

Then restore the correct values.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Integration.Brp.Pvned \
        tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj \
        tests/PeakPower.Application.Tests/Ingestion
git commit -m "pvned: wire the adapter project and land PvnedAdapterOptions

The sender and receiver GLNs are adapter configuration, not columns on metering.brp: the design's
column list for that table is closed and a GLN is a format concept, not a port concept
(shared contract 8.6 / 16.5). Defaults are integration-spec 6's own two GLNs so a clone with
nothing configured still parses the golden document.

Verified by mutation: swapping the two defaults reddens both value assertions while the
thirteen-digit shape assertion stays green, which is why the shape assertion is not enough."
```

---

### Task 2: `PvnedFailureCodes` — the thirteen frozen strings and the three structural ones

Shared contract §8.4 freezes eleven code spellings transcribed from integration-spec §8.2 and adds
two decided in §16 item 4. Plan 5's DevStubs names a scenario after each, plan 6 may surface them
on the employee screen, and plan 3 writes them to `inbound_message.failure_code`. **All three must
use identical strings**, which is why they live in one class with one test that transcribes the
spec table a second time and compares.

This task also draws the line the design cares most about: **rules 10 and 11 are the pipeline's.**
`UNKNOWN_METERING_POINT` and `WRONG_BRP_FOR_METERING_POINT` need `customer.metering_point`, which
no adapter may read (contract §7.1, `[F02-R40]`). Their constants live here so the *strings* have
one home; a test in Task 15 asserts the adapter never returns either.

**Files:**
- Create: `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedFailureCodes.cs`
- Test: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedFailureCodeTests.cs`

**Interfaces:**
- Consumes: nothing.
- Produces: `PeakPower.Integration.Brp.Pvned.PvnedFailureCodes` with sixteen `public const string`
  members and four `public static readonly IReadOnlyList<string>` members —
  `SemanticRulesInSpecOrder` (11), `DecidedBeyondSpec` (2), `Structural` (3), `PipelineOnly` (2),
  `AdapterRaised` (14). Tasks 5–15 all consume the constants.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedFailureCodeTests.cs`:

```csharp
using PeakPower.Integration.Brp.Pvned;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// Shared contract section 8.4, FROZEN. The eleven strings below are transcribed a second time,
/// by hand, from specs/30-integrations/01-pvned-timeseries.md section 8.2, in the source's own
/// order. Transcribing twice is the assertion: a typo in PvnedFailureCodes has to be made twice,
/// in two files, in the same way, to survive.
/// </summary>
public sealed class PvnedFailureCodeTests
{
    /// <summary>The eleven rules of integration-spec section 8.2, in the source's own order.</summary>
    private static readonly string[] TranscribedFromTheSpecification =
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
        "UNKNOWN_METERING_POINT",
        "WRONG_BRP_FOR_METERING_POINT",
    ];

    [Fact]
    public void The_eleven_semantic_codes_are_the_specifications_own_strings_in_its_own_order()
    {
        PvnedFailureCodes.SemanticRulesInSpecOrder.ShouldBe(TranscribedFromTheSpecification);
    }

    [Fact]
    public void There_are_exactly_eleven_semantic_codes()
    {
        PvnedFailureCodes.SemanticRulesInSpecOrder.Count.ShouldBe(
            11,
            "integration-spec section 8.2 has eleven rows; a twelfth here is either a respelling "
            + "or a rule the specification does not contain");
    }

    [Fact]
    public void The_two_codes_decided_beyond_the_specification_are_the_contracts_two()
    {
        PvnedFailureCodes.DecidedBeyondSpec.ShouldBe(
            ["UNSUPPORTED_DIRECTION", "UNSUPPORTED_MEASUREMENT_UNIT"]);
    }

    [Fact]
    public void The_three_structural_codes_are_this_plans_three()
    {
        PvnedFailureCodes.Structural.ShouldBe(
            ["MALFORMED_XML", "MISSING_SOAP_BODY", "SCHEMA_VALIDATION_FAILED"]);
    }

    [Fact]
    public void The_two_pipeline_codes_are_the_two_that_need_the_metering_point_table()
    {
        PvnedFailureCodes.PipelineOnly.ShouldBe(
            ["UNKNOWN_METERING_POINT", "WRONG_BRP_FOR_METERING_POINT"],
            "these two are decided by the pipeline against customer.metering_point, which no "
            + "adapter may read - shared contract section 7.1 and [F02-R40]");
    }

    [Fact]
    public void What_the_adapter_may_raise_is_everything_except_the_two_pipeline_codes()
    {
        PvnedFailureCodes.AdapterRaised.Count.ShouldBe(14);
        PvnedFailureCodes.AdapterRaised.ShouldNotContain("UNKNOWN_METERING_POINT");
        PvnedFailureCodes.AdapterRaised.ShouldNotContain("WRONG_BRP_FOR_METERING_POINT");
    }

    [Fact]
    public void Every_code_is_SCREAMING_SNAKE_with_no_lower_case_and_no_spaces()
    {
        foreach (var code in PvnedFailureCodes.All)
        {
            code.ShouldAllBe(character => char.IsAsciiLetterUpper(character) || character == '_');
        }
    }

    [Fact]
    public void No_code_appears_twice()
    {
        PvnedFailureCodes.All.Distinct(StringComparer.Ordinal).Count()
            .ShouldBe(PvnedFailureCodes.All.Count);
    }

    [Fact]
    public void All_is_the_union_of_the_four_lists_and_nothing_else()
    {
        var union = PvnedFailureCodes.SemanticRulesInSpecOrder
            .Concat(PvnedFailureCodes.DecidedBeyondSpec)
            .Concat(PvnedFailureCodes.Structural)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();

        PvnedFailureCodes.All.Order(StringComparer.Ordinal).ToArray().ShouldBe(union);
        PvnedFailureCodes.All.Count.ShouldBe(16);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build tests/PeakPower.Application.Tests --nologo
```
Expected: FAIL with `error CS0103: The name 'PvnedFailureCodes' does not exist in the current
context` — nine times, once per reference.

- [ ] **Step 3: Write `PvnedFailureCodes`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedFailureCodes.cs`:

```csharp
namespace PeakPower.Integration.Brp.Pvned;

/// <summary>
/// The machine-readable failure codes this adapter can put on
/// <c>inbound_message.failure_code</c>. Shared contract section 8.4 freezes every spelling.
/// </summary>
/// <remarks>
/// <para>
/// The eleven <see cref="SemanticRulesInSpecOrder"/> entries are transcribed verbatim from
/// specs/30-integrations/01-pvned-timeseries.md section 8.2, in the source's own order.
/// <see cref="DecidedBeyondSpec"/> adds the two the shared contract decides in section 16 item 4,
/// because the design requires behaviour section 8.2 has no code for.
/// <see cref="Structural"/> adds three more, decided by plan 4: integration-spec section 8.1
/// states three structural rules - well-formed XML, a SOAP envelope, XSD validation - and names
/// no code for any of them, while design section 7.3 requires a machine-readable code on every
/// failure.
/// </para>
/// <para>
/// <b>Two of the eleven are never raised here.</b> <see cref="UnknownMeteringPoint"/> and
/// <see cref="WrongBrpForMeteringPoint"/> are decided by the pipeline against
/// <c>customer.metering_point</c>, which no adapter may read (shared contract section 7.1,
/// [F02-R40]); the adapter emits a CanonicalSeries and the pipeline turns it into a quarantine
/// row. They are declared here only so the strings have exactly one home across plans 3, 5 and 6.
/// <see cref="AdapterRaised"/> is the set this adapter may actually return, and
/// PvnedRejectionIsTotalTests asserts it stays that way.
/// </para>
/// </remarks>
public static class PvnedFailureCodes
{
    // ── integration-spec section 8.2, in the source's own order ──────────────────────────────

    /// <summary>Rule 1. DocumentType/ProcessType is not a handled combination.</summary>
    public const string UnsupportedDocumentType = "UNSUPPORTED_DOCUMENT_TYPE";

    /// <summary>Rule 2. ReceiverIdentification is not PeakPower's own GLN.</summary>
    public const string WrongReceiver = "WRONG_RECEIVER";

    /// <summary>Rule 3. SenderIdentification is not the GLN configured for this BRP.</summary>
    public const string UnknownSender = "UNKNOWN_SENDER";

    /// <summary>Rule 4. Resolution is not PT15M.</summary>
    public const string UnsupportedResolution = "UNSUPPORTED_RESOLUTION";

    /// <summary>Rule 5. CurveType is not A01.</summary>
    public const string UnsupportedCurveType = "UNSUPPORTED_CURVE_TYPE";

    /// <summary>Rule 6. MeasurementPeriode does not cover exactly one Amsterdam calendar day.</summary>
    public const string InvalidMeasurementPeriod = "INVALID_MEASUREMENT_PERIOD";

    /// <summary>Rule 7. The point count is not the expected interval count for that date.</summary>
    public const string IncompletePeriod = "INCOMPLETE_PERIOD";

    /// <summary>Rule 8. Pos values are not contiguous from 1, or one is duplicated.</summary>
    public const string InvalidPositions = "INVALID_POSITIONS";

    /// <summary>Rule 9. A Qty is negative.</summary>
    public const string NegativeQuantity = "NEGATIVE_QUANTITY";

    /// <summary>Rule 10. PIPELINE ONLY - the adapter never raises this.</summary>
    public const string UnknownMeteringPoint = "UNKNOWN_METERING_POINT";

    /// <summary>Rule 11. PIPELINE ONLY - the adapter never raises this.</summary>
    public const string WrongBrpForMeteringPoint = "WRONG_BRP_FOR_METERING_POINT";

    // ── shared contract section 16, item 4 ───────────────────────────────────────────────────

    /// <summary>Direction is A03 or A04. Integration-spec section 4.1 rejects both.</summary>
    public const string UnsupportedDirection = "UNSUPPORTED_DIRECTION";

    /// <summary>MeasurementUnit is KWT or MAW: a power, not an energy.</summary>
    public const string UnsupportedMeasurementUnit = "UNSUPPORTED_MEASUREMENT_UNIT";

    // ── structural, decided by plan 4 for integration-spec section 8.1 ───────────────────────

    /// <summary>Not well-formed XML, or it carries a DTD, which the hardened reader refuses.</summary>
    public const string MalformedXml = "MALFORMED_XML";

    /// <summary>Well-formed, but no soap:Envelope/soap:Body/TimeSeriesDocument.</summary>
    public const string MissingSoapBody = "MISSING_SOAP_BODY";

    /// <summary>The TimeSeriesDocument element fails the reconstructed XSD. [F02-R09]</summary>
    public const string SchemaValidationFailed = "SCHEMA_VALIDATION_FAILED";

    // ── the four sets ────────────────────────────────────────────────────────────────────────

    /// <summary>The eleven rules of integration-spec section 8.2, in the source's own order.</summary>
    public static readonly IReadOnlyList<string> SemanticRulesInSpecOrder =
    [
        UnsupportedDocumentType,
        WrongReceiver,
        UnknownSender,
        UnsupportedResolution,
        UnsupportedCurveType,
        InvalidMeasurementPeriod,
        IncompletePeriod,
        InvalidPositions,
        NegativeQuantity,
        UnknownMeteringPoint,
        WrongBrpForMeteringPoint,
    ];

    /// <summary>Shared contract section 16 item 4.</summary>
    public static readonly IReadOnlyList<string> DecidedBeyondSpec =
    [
        UnsupportedDirection,
        UnsupportedMeasurementUnit,
    ];

    /// <summary>Integration-spec section 8.1's three rules, which name no codes of their own.</summary>
    public static readonly IReadOnlyList<string> Structural =
    [
        MalformedXml,
        MissingSoapBody,
        SchemaValidationFailed,
    ];

    /// <summary>The two the pipeline decides. The adapter never returns either.</summary>
    public static readonly IReadOnlyList<string> PipelineOnly =
    [
        UnknownMeteringPoint,
        WrongBrpForMeteringPoint,
    ];

    /// <summary>Every code named in this class, in no particular order.</summary>
    public static readonly IReadOnlyList<string> All =
    [
        .. SemanticRulesInSpecOrder,
        .. DecidedBeyondSpec,
        .. Structural,
    ];

    /// <summary>Everything this adapter may return on a Rejected outcome.</summary>
    public static readonly IReadOnlyList<string> AdapterRaised =
    [
        .. All.Where(code => !PipelineOnly.Contains(code, StringComparer.Ordinal)),
    ];
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedFailureCodeTests"
```
Expected: PASS — 9 passed, 0 failed.

- [ ] **Step 5: Mutation — prove the order is asserted, not merely the set**

Temporarily swap two entries in `SemanticRulesInSpecOrder`, putting `WrongReceiver` before
`UnsupportedDocumentType`:

```csharp
    public static readonly IReadOnlyList<string> SemanticRulesInSpecOrder =
    [
        WrongReceiver,
        UnsupportedDocumentType,
        UnknownSender,
        // ... unchanged
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedFailureCodeTests"`
Expected: FAIL — `The_eleven_semantic_codes_are_the_specifications_own_strings_in_its_own_order`
fails with Shouldly's element-wise diff naming index `[0]` as `"WRONG_RECEIVER"` where
`"UNSUPPORTED_DOCUMENT_TYPE"` was expected. `There_are_exactly_eleven_semantic_codes`,
`All_is_the_union_of_the_four_lists_and_nothing_else` and `No_code_appears_twice` all stay green —
which is why the order assertion exists separately from the count one.

Then restore the original order.

- [ ] **Step 6: Mutation — prove a respelling is caught**

Temporarily change one constant to a plausible respelling — the exact kind of drift the freeze
exists to stop:

```csharp
    public const string IncompletePeriod = "INCOMPLETE_PERIODE";
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedFailureCodeTests"`
Expected: FAIL — the order test fails at index `[6]`,
`"INCOMPLETE_PERIODE"` where `"INCOMPLETE_PERIOD"` was expected. Note that
`Every_code_is_SCREAMING_SNAKE_with_no_lower_case_and_no_spaces` stays **green**, because
`INCOMPLETE_PERIODE` is perfectly well-shaped — the shape guard cannot see a respelling and the
transcription is what does.

Then restore `"INCOMPLETE_PERIOD"`.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedFailureCodes.cs \
        tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedFailureCodeTests.cs
git commit -m "pvned: freeze the sixteen failure codes

Eleven transcribed from integration-spec 8.2 in the source's own order, two decided by the shared
contract 16.4 (UNSUPPORTED_DIRECTION, UNSUPPORTED_MEASUREMENT_UNIT), three decided by plan 4
because integration-spec 8.1 states three structural rules and names no code for any of them.
Rules 10 and 11 are declared but never raised here: they need customer.metering_point, which
[F02-R40] forbids an adapter reading.

The test transcribes the eleven a second time by hand rather than reading the class, so a typo has
to be made twice in two files to survive. Verified by mutation: reordering two entries reddens the
order assertion while the count and shape assertions stay green, and respelling one to
INCOMPLETE_PERIODE reddens only the transcription."
```

---

### Task 3: `SchemaProvenance` — the nine integration-spec §9 inconsistencies, one test each

Design §8, second risk row: *"The reconstructed XSD encodes nine guesses. Stricter than the real
schema → it rejects real documents; looser → it proves nothing. `[OQ-65]` is parked with no chaser
inside the team."* The mitigation is a rule and a document: **take the permissive reading on each
of the nine rows, one test per row naming the row and the reading**, and list all nine somewhere a
reviewer can read them beside the XSD.

`[OQ-65]` is the walkthrough with PVNed that would settle them. It has not happened, and design §12
says to book it now regardless because a third party's calendar has lead time. This class is what
makes the walkthrough cheap when it does happen: nine rows, nine readings, nine tests, and the
diff is visible.

**Files:**
- Create: `src/Infrastructure/PeakPower.Integration.Brp.Pvned/SchemaProvenance.cs`
- Test: `tests/PeakPower.Application.Tests/Ingestion/Pvned/SchemaProvenanceTests.cs`

**Interfaces:**
- Consumes: nothing.
- Produces: `PeakPower.Integration.Brp.Pvned.SchemaProvenanceEntry` (a record) and
  `PeakPower.Integration.Brp.Pvned.SchemaProvenance` with
  `public static IReadOnlyList<SchemaProvenanceEntry> Entries`,
  `public const string SchemaFileName`, `public const string SchemaResourceName`,
  `public const string TargetNamespace`, `public const string SoapNamespace`. Task 4 consumes the
  three constants; Task 10 consumes row 7's reading in code.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/SchemaProvenanceTests.cs`:

```csharp
using PeakPower.Integration.Brp.Pvned;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// Design section 8, second risk row: the reconstructed XSD encodes nine guesses, and the
/// mitigation is to take the PERMISSIVE reading on each of the nine integration-spec section 9
/// rows, with one test per row naming the row and the reading. These are those nine tests.
/// </summary>
/// <remarks>
/// The point of a test per row is not that a constant string equals itself. It is that when
/// [OQ-65]'s walkthrough with PVNed finally happens, a changed reading is a failing test with the
/// row number in its name, rather than a silent edit to a comment nobody re-reads.
/// </remarks>
public sealed class SchemaProvenanceTests
{
    private static SchemaProvenanceEntry Row(int number) =>
        SchemaProvenance.Entries.Single(entry => entry.Row == number);

    [Fact]
    public void There_are_exactly_nine_rows_numbered_one_to_nine()
    {
        SchemaProvenance.Entries.Count.ShouldBe(9);
        SchemaProvenance.Entries.Select(entry => entry.Row).ShouldBe([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }

    [Fact]
    public void Every_row_names_a_field_and_a_reading()
    {
        foreach (var entry in SchemaProvenance.Entries)
        {
            entry.Field.ShouldNotBeNullOrWhiteSpace();
            entry.Reading.ShouldNotBeNullOrWhiteSpace();
        }
    }

    [Fact]
    public void Row_1_DocumentIdentification_accepts_thirty_six_characters()
    {
        var row = Row(1);

        row.Field.ShouldBe("DocumentIdentification");
        row.Reading.ShouldBe(
            "Accept 36 characters. The guide says 35 and the XSD says 36; a GUID does not fit "
            + "in 35, and the sample carries a 36-character GUID.");
    }

    [Fact]
    public void Row_2_the_GLNs_validate_as_thirteen_digits_and_accept_up_to_sixteen()
    {
        var row = Row(2);

        row.Field.ShouldBe("SenderIdentification / ReceiverIdentification");
        row.Reading.ShouldBe(
            "Validate as 13 digits, accept up to 16. The guide says max 13, the XSD says "
            + "maxLength 16, the sample carries 13. A longer identifier is warned about, "
            + "never rejected.");
    }

    [Fact]
    public void Row_3_Pos_is_bounded_by_the_XSD_at_one_hundred_not_by_the_guides_six_characters()
    {
        var row = Row(3);

        row.Field.ShouldBe("Pos");
        row.Reading.ShouldBe(
            "Enforce the XSD bound maxInclusive 100, not the guide's \"max 6 characters\". "
            + "100 is the autumn fall-back day's interval count, which is what the bound is for.");
    }

    [Fact]
    public void Row_4_Qty_has_no_hard_cap_and_implausibility_alerts_rather_than_rejects()
    {
        var row = Row(4);

        row.Field.ShouldBe("Qty maximum");
        row.Reading.ShouldBe(
            "No hard cap. The guide says 9999,999 in one place and 9999.000 in another, and the "
            + "XSD leaves xs:decimal unbounded. 9 999 kWh per 15 minutes is only about 40 MW "
            + "average, which a very large connection reaches. Validate plausibility against the "
            + "metering point's capacity and alert; never reject.");
    }

    [Fact]
    public void Row_5_MeasurementUnit_is_read_from_the_message_and_an_unexpected_unit_only_warns()
    {
        var row = Row(5);

        row.Field.ShouldBe("MeasurementUnit");
        row.Reading.ShouldBe(
            "Read the unit from the message and convert. The dependency table predicts KWH for "
            + "allocations and KWT/MWH for imbalance, and the sample disagrees with it, so the "
            + "table is a prediction rather than a rule. An unpredicted unit warns. The XSD "
            + "leaves the field a plain string so that KWT and MAW on an allocation surface as "
            + "UNSUPPORTED_MEASUREMENT_UNIT rather than as a schema error.");
    }

    [Fact]
    public void Row_6_Annex_A_describes_the_outbound_direction_and_does_not_apply_here()
    {
        var row = Row(6);

        row.Field.ShouldBe("Annex A validations");
        row.Reading.ShouldBe(
            "Annex A describes the customer to PVNed direction and does not apply to inbound "
            + "processing. Its DocumentType A67/A26, ProcessType A14/A33 and MeasurementUnit MAR "
            + "exist in no version of this XSD, which is the evidence for that reading.");
    }

    [Fact]
    public void Row_7_MeasurementPeriode_and_Pos_are_authoritative_and_TimeInterval_is_only_logged()
    {
        var row = Row(7);

        row.Field.ShouldBe("Period.TimeInterval");
        row.Reading.ShouldBe(
            "MeasurementPeriode plus Pos are authoritative for interval placement. "
            + "Period.TimeInterval is logged as a discrepancy and never used to place a point. "
            + "The sample shows a month-long TimeInterval inside a one-day MeasurementPeriode, "
            + "so an implementer who trusts it writes a month of intervals to the wrong dates. "
            + "This is [OQ-20]'s interim answer, not PVNed's confirmation.");
    }

    [Fact]
    public void Row_8_Qty2_is_not_used()
    {
        var row = Row(8);

        row.Field.ShouldBe("Qty2");
        row.Reading.ShouldBe(
            "Not used by the platform. The guide calls it \"the same value for the previous "
            + "year\"; it is optional and the sample omits it. It is accepted and ignored.");
    }

    [Fact]
    public void Row_9_CurveType_A03_is_rejected_semantically_rather_than_by_the_schema()
    {
        var row = Row(9);

        row.Field.ShouldBe("CurveType A03");
        row.Reading.ShouldBe(
            "Rejected. The guide lists A03 as permitted and the XSD enumerates only A01. The "
            + "reconstructed XSD leaves CurveType a plain string and the rule is enforced "
            + "semantically, so an operator sees UNSUPPORTED_CURVE_TYPE - the frozen code of "
            + "integration-spec section 8.2 - rather than a schema error.");
    }

    [Fact]
    public void The_open_question_that_would_settle_all_nine_is_named_on_every_row()
    {
        SchemaProvenance.Entries.ShouldAllBe(entry => entry.OpenQuestion == "OQ-65");
    }

    [Fact]
    public void Row_7_also_names_the_open_question_that_is_specifically_about_it()
    {
        Row(7).SecondaryOpenQuestion.ShouldBe("OQ-20");
        SchemaProvenance.Entries
            .Where(entry => entry.SecondaryOpenQuestion is not null)
            .Select(entry => entry.Row)
            .ShouldBe([7]);
    }

    [Fact]
    public void The_schema_file_name_says_reconstructed()
    {
        SchemaProvenance.SchemaFileName.ShouldContain(
            "reconstructed",
            Case.Sensitive,
            "the file must announce that it is not the vendor's, so swapping in the real one is a "
            + "diff review rather than a silent substitution - design section 8, second risk row");
    }

    [Fact]
    public void The_schema_file_name_is_the_exact_one_the_contract_names()
    {
        SchemaProvenance.SchemaFileName.ShouldBe("TimeSeriesDocument-v2p0.reconstructed.xsd");
    }

    [Fact]
    public void The_target_namespace_is_PVNeds_own()
    {
        SchemaProvenance.TargetNamespace
            .ShouldBe("http://www.pvned.eu/CustomerIntegrations/External/v2p0");
    }

    [Fact]
    public void The_envelope_namespace_is_SOAP_1_1()
    {
        SchemaProvenance.SoapNamespace.ShouldBe("http://schemas.xmlsoap.org/soap/envelope/");
    }
}
```

⚠ `ShouldContain(..., Case.Sensitive, ...)` is deliberate. Shouldly's `ShouldContain` is
case-insensitive by default and has silently broken three tests in this repository; a file named
`...RECONSTRUCTED.xsd` would pass the default overload and fail on a case-sensitive filesystem.

- [ ] **Step 2: Run it and watch it fail**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build tests/PeakPower.Application.Tests --nologo
```
Expected: FAIL with `error CS0246: The type or namespace name 'SchemaProvenanceEntry' could not be
found` and `error CS0103: The name 'SchemaProvenance' does not exist in the current context`.

- [ ] **Step 3: Write `SchemaProvenance`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Integration.Brp.Pvned/SchemaProvenance.cs`:

```csharp
namespace PeakPower.Integration.Brp.Pvned;

/// <summary>One row of integration-spec section 9, and the reading this adapter takes on it.</summary>
/// <param name="Row">1..9, the row number in integration-spec section 9's own table.</param>
/// <param name="Field">The field the three source documents disagree about.</param>
/// <param name="Guide">What the PVNED Timeseries Document Implementation Guide v2.2 says.</param>
/// <param name="Xsd">What TimeSeriesDocument-v2p0.xsd (schema version 2.0.1) says.</param>
/// <param name="Sample">What the supplied CustomerImbalanceReport.json sample shows.</param>
/// <param name="Reading">The permissive reading this adapter takes, and why.</param>
/// <param name="OpenQuestion">The open question that would settle it. OQ-65 on every row.</param>
/// <param name="SecondaryOpenQuestion">An additional open question, where one exists.</param>
public sealed record SchemaProvenanceEntry(
    int Row,
    string Field,
    string Guide,
    string Xsd,
    string Sample,
    string Reading,
    string OpenQuestion,
    string? SecondaryOpenQuestion = null);

/// <summary>
/// Why the schema in <c>Schemas/TimeSeriesDocument-v2p0.reconstructed.xsd</c> looks the way it
/// does. Nine guesses, listed, with the permissive reading taken on each.
/// </summary>
/// <remarks>
/// <para>
/// PVNed's own three source documents - the XSD, the implementation guide v2.2 and the sample -
/// disagree with each other in nine places (integration-spec section 9). None of the three is in
/// this repository: they are PVNed's copyright and not ours to redistribute. So the schema this
/// adapter validates against is <b>reconstructed</b>, and it encodes nine guesses.
/// </para>
/// <para>
/// <b>The rule is: take the permissive reading on every row, and stop.</b> Stricter than the real
/// schema and the adapter rejects real documents; looser and it proves nothing - and the schema
/// becomes a research exercise the moment the permissive rule is not held to. Design section 8,
/// second risk row.
/// </para>
/// <para>
/// A second rule follows from the first and is worth stating because it shaped the file: <b>the
/// reconstructed schema validates STRUCTURE, not code lists.</b> DocumentType, ProcessType,
/// BusinessType, Direction, MeasurementUnit and CurveType are plain strings in it, and their
/// value sets are enforced semantically. Otherwise a CurveType of A03 would surface as a schema
/// error rather than as UNSUPPORTED_CURVE_TYPE, and the frozen code of integration-spec section
/// 8.2 would be unreachable. Rows 5 and 9 record this.
/// </para>
/// <para>
/// <b>[OQ-65] is the walkthrough with PVNed that would settle all nine.</b> It has not happened
/// and has no chaser named inside the team (design section 12). Book it: this class is what makes
/// the conversation cheap, because a changed reading is a failing test with a row number in its
/// name rather than an edit to a comment nobody re-reads.
/// </para>
/// </remarks>
public static class SchemaProvenance
{
    /// <summary>
    /// The schema's file name. It says <c>reconstructed</c> on purpose, and
    /// <c>SchemaProvenanceTests</c> asserts that it does, so that swapping in PVNed's real file
    /// is a diff review rather than a silent substitution.
    /// </summary>
    public const string SchemaFileName = "TimeSeriesDocument-v2p0.reconstructed.xsd";

    /// <summary>
    /// The embedded-resource name, pinned in the .csproj's <c>LogicalName</c>. Moving the file
    /// would otherwise silently rename the resource, and the only symptom would be every
    /// document failing SCHEMA_VALIDATION_FAILED.
    /// </summary>
    public const string SchemaResourceName =
        "PeakPower.Integration.Brp.Pvned.Schemas.TimeSeriesDocument-v2p0.reconstructed.xsd";

    /// <summary>PVNed's document namespace. Integration-spec section 1.</summary>
    public const string TargetNamespace = "http://www.pvned.eu/CustomerIntegrations/External/v2p0";

    /// <summary>The SOAP 1.1 envelope namespace the document arrives inside.</summary>
    public const string SoapNamespace = "http://schemas.xmlsoap.org/soap/envelope/";

    /// <summary>All nine rows of integration-spec section 9, in the source's own order.</summary>
    public static readonly IReadOnlyList<SchemaProvenanceEntry> Entries =
    [
        new SchemaProvenanceEntry(
            Row: 1,
            Field: "DocumentIdentification",
            Guide: "max 35 characters",
            Xsd: "maxLength 36",
            Sample: "a 36-character GUID",
            Reading:
                "Accept 36 characters. The guide says 35 and the XSD says 36; a GUID does not fit "
                + "in 35, and the sample carries a 36-character GUID.",
            OpenQuestion: "OQ-65"),

        new SchemaProvenanceEntry(
            Row: 2,
            Field: "SenderIdentification / ReceiverIdentification",
            Guide: "GLN-13, max 13",
            Xsd: "maxLength 16",
            Sample: "13 digits",
            Reading:
                "Validate as 13 digits, accept up to 16. The guide says max 13, the XSD says "
                + "maxLength 16, the sample carries 13. A longer identifier is warned about, "
                + "never rejected.",
            OpenQuestion: "OQ-65"),

        new SchemaProvenanceEntry(
            Row: 3,
            Field: "Pos",
            Guide: "max 6 characters",
            Xsd: "maxInclusive 100",
            Sample: "1 to 96",
            Reading:
                "Enforce the XSD bound maxInclusive 100, not the guide's \"max 6 characters\". "
                + "100 is the autumn fall-back day's interval count, which is what the bound is for.",
            OpenQuestion: "OQ-65"),

        new SchemaProvenanceEntry(
            Row: 4,
            Field: "Qty maximum",
            Guide: "9999,999 in section 5.8.2; 9999.000 in Annex A",
            Xsd: "unbounded xs:decimal",
            Sample: "maximum observed 2 164",
            Reading:
                "No hard cap. The guide says 9999,999 in one place and 9999.000 in another, and "
                + "the XSD leaves xs:decimal unbounded. 9 999 kWh per 15 minutes is only about "
                + "40 MW average, which a very large connection reaches. Validate plausibility "
                + "against the metering point's capacity and alert; never reject.",
            OpenQuestion: "OQ-65"),

        new SchemaProvenanceEntry(
            Row: 5,
            Field: "MeasurementUnit",
            Guide: "the dependency table says KWT / MWH for imbalance",
            Xsd: "the enumeration includes KWH",
            Sample: "KWH for A20, A14 and A02; MWH for B24 and B25",
            Reading:
                "Read the unit from the message and convert. The dependency table predicts KWH "
                + "for allocations and KWT/MWH for imbalance, and the sample disagrees with it, "
                + "so the table is a prediction rather than a rule. An unpredicted unit warns. "
                + "The XSD leaves the field a plain string so that KWT and MAW on an allocation "
                + "surface as UNSUPPORTED_MEASUREMENT_UNIT rather than as a schema error.",
            OpenQuestion: "OQ-65"),

        new SchemaProvenanceEntry(
            Row: 6,
            Field: "Annex A validations",
            Guide: "references DocumentType A67/A26, ProcessType A14/A33, MeasurementUnit MAR",
            Xsd: "none of those values exists",
            Sample: "not applicable",
            Reading:
                "Annex A describes the customer to PVNed direction and does not apply to inbound "
                + "processing. Its DocumentType A67/A26, ProcessType A14/A33 and MeasurementUnit "
                + "MAR exist in no version of this XSD, which is the evidence for that reading.",
            OpenQuestion: "OQ-65"),

        new SchemaProvenanceEntry(
            Row: 7,
            Field: "Period.TimeInterval",
            Guide: "must sit within MeasurementPeriode",
            Xsd: "no constraint",
            Sample: "contradicts it - a month-long interval inside a one-day MeasurementPeriode",
            Reading:
                "MeasurementPeriode plus Pos are authoritative for interval placement. "
                + "Period.TimeInterval is logged as a discrepancy and never used to place a "
                + "point. The sample shows a month-long TimeInterval inside a one-day "
                + "MeasurementPeriode, so an implementer who trusts it writes a month of "
                + "intervals to the wrong dates. This is [OQ-20]'s interim answer, not PVNed's "
                + "confirmation.",
            OpenQuestion: "OQ-65",
            SecondaryOpenQuestion: "OQ-20"),

        new SchemaProvenanceEntry(
            Row: 8,
            Field: "Qty2",
            Guide: "\"the same value for the previous year\"",
            Xsd: "optional",
            Sample: "absent",
            Reading:
                "Not used by the platform. The guide calls it \"the same value for the previous "
                + "year\"; it is optional and the sample omits it. It is accepted and ignored.",
            OpenQuestion: "OQ-65"),

        new SchemaProvenanceEntry(
            Row: 9,
            Field: "CurveType A03",
            Guide: "listed as permitted in section 5.5.11",
            Xsd: "the enumeration allows only A01",
            Sample: "A01",
            Reading:
                "Rejected. The guide lists A03 as permitted and the XSD enumerates only A01. The "
                + "reconstructed XSD leaves CurveType a plain string and the rule is enforced "
                + "semantically, so an operator sees UNSUPPORTED_CURVE_TYPE - the frozen code of "
                + "integration-spec section 8.2 - rather than a schema error.",
            OpenQuestion: "OQ-65"),
    ];
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~SchemaProvenanceTests"
```
Expected: PASS — 16 passed, 0 failed.

- [ ] **Step 5: Mutation — prove the "reconstructed" assertion is about the name, not the file**

Temporarily change the constant in `SchemaProvenance.cs` to the name of the vendor's real file:

```csharp
    public const string SchemaFileName = "TimeSeriesDocument-v2p0.xsd";
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~SchemaProvenanceTests"`
Expected: FAIL — **two** tests. `The_schema_file_name_says_reconstructed` fails with
`SchemaProvenance.SchemaFileName should contain "reconstructed" but was
"TimeSeriesDocument-v2p0.xsd"`, and `The_schema_file_name_is_the_exact_one_the_contract_names`
fails on the exact-string comparison. Both matter: the first is the design's requirement, the
second stops the name drifting to something that merely happens to contain the word.

Then restore `"TimeSeriesDocument-v2p0.reconstructed.xsd"`.

- [ ] **Step 6: Mutation — prove row 7's reading is asserted, not just present**

Row 7 is the one integration-spec §9 singles out: *"the one that would silently corrupt data if
implemented naively."* Temporarily flip its reading to the naive one:

```csharp
            Reading:
                "Period.TimeInterval is authoritative for interval placement.",
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~SchemaProvenanceTests"`
Expected: FAIL — exactly one test,
`Row_7_MeasurementPeriode_and_Pos_are_authoritative_and_TimeInterval_is_only_logged`, with
Shouldly printing the full expected and actual strings.
`There_are_exactly_nine_rows_numbered_one_to_nine` and `Every_row_names_a_field_and_a_reading`
both stay green — a count and a not-blank check cannot see a reversed reading, which is why there
is a test per row.

Then restore row 7's reading.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Integration.Brp.Pvned/SchemaProvenance.cs \
        tests/PeakPower.Application.Tests/Ingestion/Pvned/SchemaProvenanceTests.cs
git commit -m "pvned: record the nine schema guesses and the permissive reading on each

Design 8's second risk row: the reconstructed XSD encodes nine guesses from integration-spec 9,
and stricter-than-real rejects real documents while looser proves nothing. Nine rows, nine
permissive readings, one test per row naming the row and the reading, so [OQ-65]'s walkthrough
with PVNed becomes a diff rather than a re-reading.

Rows 5 and 9 also record the second rule the file rests on: the reconstructed schema validates
structure, not code lists, so CurveType A03 surfaces as UNSUPPORTED_CURVE_TYPE - the frozen 8.2
code - rather than as a schema error.

Verified by mutation: renaming the file to the vendor's own name reddens two assertions, and
flipping row 7's reading to the naive 'TimeInterval is authoritative' reddens exactly one - the
count and not-blank guards cannot see a reversed reading."
```

---

### Task 4: The reconstructed XSD, the fixture loader, and proof that the schema bites

`[F02-R09]`: *"Each message is validated against `TimeSeriesDocument-v2p0.xsd`. Failures are
recorded with the XSD error path."* We do not have that file. This task writes the reconstructed
one, embeds it, compiles it once, and — the part that matters — **proves it is actually attached**,
because a schema that is loaded but never applied passes every document and nothing looks wrong.

It also lands `PvnedFixtures`, the loader every later task reads through, and the first of the
twenty-five hand-written fixtures.

**Files:**
- Create: `src/Infrastructure/PeakPower.Integration.Brp.Pvned/Schemas/TimeSeriesDocument-v2p0.reconstructed.xsd` (replaces Task 1's placeholder)
- Create: `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedSchema.cs`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedFixtures.cs`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/structural-schema-pos-out-of-range.xml`
- Modify: `tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj`
- Test: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedSchemaTests.cs`

**Interfaces:**
- Consumes: `SchemaProvenance.SchemaResourceName`, `.SchemaFileName`, `.TargetNamespace`,
  `.SoapNamespace` (Task 3).
- Produces: `PeakPower.Integration.Brp.Pvned.PvnedSchema` with
  `public static XmlSchemaSet Schemas { get; }` and `public static string ReadSchemaText()`.
  Task 5 consumes `Schemas`. Also
  `PeakPower.Application.Tests.Ingestion.Pvned.PvnedFixtures` with
  `public static byte[] Bytes(string name)`, `public static string Text(string name)` and
  `public static IReadOnlyList<string> AllNames()`. Tasks 5–16 all consume it.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedSchemaTests.cs`:

```csharp
using System.Xml.Linq;
using System.Xml.Schema;
using PeakPower.Integration.Brp.Pvned;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// The reconstructed schema compiles, targets PVNed's namespace, and - the assertion that matters
/// - actually rejects a document that breaks it.
/// </summary>
/// <remarks>
/// A schema that is loaded but never attached to the reader passes every document, and nothing
/// about that failure is visible: parsing succeeds, readings land, and the first evidence is a
/// malformed document that reached the database. So the schema is proven by a document it must
/// refuse, not by the fact that it loaded.
/// </remarks>
public sealed class PvnedSchemaTests
{
    [Fact]
    public void The_embedded_resource_is_present_under_the_name_the_csproj_pins()
    {
        var text = PvnedSchema.ReadSchemaText();

        text.ShouldNotBeNullOrWhiteSpace();
        text.ShouldContain("xs:schema", Case.Sensitive);
    }

    [Fact]
    public void The_embedded_resource_name_ends_with_the_file_name_provenance_declares()
    {
        SchemaProvenance.SchemaResourceName.ShouldEndWith(
            SchemaProvenance.SchemaFileName,
            Case.Sensitive,
            "the LogicalName in the .csproj and the file on disk must be the same file; if they "
            + "drift, every document fails SCHEMA_VALIDATION_FAILED and nothing says why");
    }

    [Fact]
    public void The_schema_compiles()
    {
        PvnedSchema.Schemas.IsCompiled.ShouldBeTrue();
        PvnedSchema.Schemas.Count.ShouldBe(1);
    }

    [Fact]
    public void The_schema_targets_PVNeds_namespace()
    {
        PvnedSchema.Schemas.Schemas()
            .Cast<XmlSchema>()
            .Select(schema => schema.TargetNamespace)
            .ShouldBe([SchemaProvenance.TargetNamespace]);
    }

    [Fact]
    public void The_schema_declares_the_misspelled_RecourceName_because_PVNed_does()
    {
        PvnedSchema.ReadSchemaText().ShouldContain(
            "\"RecourceName\"",
            Case.Sensitive,
            "integration-spec section 3: it is a typo in the source, it is normative, and the "
            + "platform must expect it exactly as-is - do not \"fix\" it in a mapping");
    }

    [Fact]
    public void The_schema_does_not_declare_the_corrected_spelling()
    {
        PvnedSchema.ReadSchemaText().ShouldNotContain("ResourceName", Case.Sensitive);
    }

    [Fact]
    public void A_Pos_of_one_hundred_and_one_is_refused_by_the_schema()
    {
        var errors = ValidateFixture("structural-schema-pos-out-of-range.xml");

        errors.ShouldNotBeEmpty(
            "SchemaProvenance row 3 takes the XSD's maxInclusive 100 as the bound, and 100 is the "
            + "autumn fall-back day's interval count; a Pos of 101 is outside every day there is");
        errors[0].ShouldContain("Pos", Case.Sensitive);
        errors[0].ShouldContain("101", Case.Sensitive);
    }

    /// <summary>
    /// Locates the TimeSeriesDocument inside the SOAP envelope and validates it in isolation.
    /// Task 5's PvnedXmlReader does exactly this; here it is inline so that the schema is proven
    /// before the reader that uses it exists.
    /// </summary>
    private static IReadOnlyList<string> ValidateFixture(string name)
    {
        var envelope = XDocument.Parse(PvnedFixtures.Text(name), LoadOptions.None);

        var document = envelope
            .Descendants(XName.Get("TimeSeriesDocument", SchemaProvenance.TargetNamespace))
            .Single();

        var errors = new List<string>();
        var isolated = new XDocument(new XElement(document));
        isolated.Validate(PvnedSchema.Schemas, (_, args) => errors.Add(args.Message));

        return errors;
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build tests/PeakPower.Application.Tests --nologo
```
Expected: FAIL with `error CS0103: The name 'PvnedSchema' does not exist in the current context`
and `error CS0103: The name 'PvnedFixtures' does not exist in the current context`.

- [ ] **Step 3: Write the reconstructed schema**

Replace
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Integration.Brp.Pvned/Schemas/TimeSeriesDocument-v2p0.reconstructed.xsd`
with:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!--
  ============================================================================================
  RECONSTRUCTED. THIS IS NOT PVNed's FILE.

  PVNed's own TimeSeriesDocument-v2p0.xsd (schema version 2.0.1) is their copyright and is not
  in this repository. This file is reconstructed from three things: the class diagram in
  specs/30-integrations/01-pvned-timeseries.md section 3, the reconstructed sample in that
  document's section 6, and the nine documented disagreements in its section 9.

  It therefore ENCODES NINE GUESSES. Every one of them is listed, with the permissive reading
  taken on it and one test naming it, in SchemaProvenance.cs. The file name says
  "reconstructed" and SchemaProvenanceTests asserts that it does, so that swapping in PVNed's
  real file is a diff review rather than a silent substitution.

  Two rules shaped this file:

    1. TAKE THE PERMISSIVE READING ON EVERY ROW, AND STOP. Stricter than the real schema and
       the adapter rejects real documents; looser and it proves nothing. Design section 8.

    2. THIS SCHEMA VALIDATES STRUCTURE, NOT CODE LISTS. DocumentType, ProcessType,
       BusinessType, Direction, MeasurementUnit and CurveType are plain strings here, and their
       value sets are enforced semantically by PvnedIngestionAdapter. Otherwise a CurveType of
       A03 would surface as a schema error instead of as UNSUPPORTED_CURVE_TYPE, and the frozen
       code of integration-spec section 8.2 would be unreachable. SchemaProvenance rows 5
       and 9.

  RecourceName is spelled that way on purpose. Integration-spec section 3: it is a typo in the
  source, it is normative, and the platform must expect it exactly as-is.
  ============================================================================================
-->
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0"
           targetNamespace="http://www.pvned.eu/CustomerIntegrations/External/v2p0"
           elementFormDefault="qualified"
           version="2.0.1-reconstructed">

  <!-- Row 1: the guide says 35, the XSD says 36, and a GUID needs 36. Permissive: 36. -->
  <xs:simpleType name="DocumentIdentificationType">
    <xs:restriction base="xs:string">
      <xs:minLength value="1" />
      <xs:maxLength value="36" />
    </xs:restriction>
  </xs:simpleType>

  <!-- Row 2: the guide says 13, the XSD says maxLength 16. Permissive: 13 to 16 digits. The
       "must be exactly 13" reading is a WARNING in the adapter, never a rejection. -->
  <xs:simpleType name="GlnType">
    <xs:restriction base="xs:string">
      <xs:pattern value="[0-9]{13,16}" />
    </xs:restriction>
  </xs:simpleType>

  <!-- A short code. Deliberately NOT an enumeration: rule 2 of the header comment. -->
  <xs:simpleType name="CodeType">
    <xs:restriction base="xs:string">
      <xs:minLength value="1" />
      <xs:maxLength value="4" />
    </xs:restriction>
  </xs:simpleType>

  <!-- Resolution carries an ISO-8601 duration: PT15M is five characters, PT60M likewise. -->
  <xs:simpleType name="DurationCodeType">
    <xs:restriction base="xs:string">
      <xs:minLength value="1" />
      <xs:maxLength value="8" />
    </xs:restriction>
  </xs:simpleType>

  <!-- Row 3: the guide says "max 6 characters", the XSD says maxInclusive 100. Take the XSD's
       bound: 100 is the autumn fall-back day's interval count, which is what it is for. -->
  <xs:simpleType name="PosType">
    <xs:restriction base="xs:int">
      <xs:minInclusive value="1" />
      <xs:maxInclusive value="100" />
    </xs:restriction>
  </xs:simpleType>

  <!-- Row 4: no hard cap on Qty. xs:decimal, unbounded. Plausibility against the metering
       point's capacity is an ALERT in the pipeline, never a rejection here. -->

  <xs:complexType name="TimeIntervalType">
    <xs:sequence>
      <xs:element name="StartPeriod" type="xs:dateTime" />
      <xs:element name="EndPeriod" type="xs:dateTime" />
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="ResourceType">
    <xs:sequence>
      <!-- 18 digits is an EAN; anything else is a descriptive label. [F02-R11], [AS-17].
           The discrimination is the adapter's, not the schema's: a schema that demanded 18
           digits here would reject the imbalance sample, whose Resource carries only a
           RecourceName of "Imbalance". -->
      <xs:element name="ResourceObject" minOccurs="0">
        <xs:simpleType>
          <xs:restriction base="xs:string">
            <xs:maxLength value="18" />
          </xs:restriction>
        </xs:simpleType>
      </xs:element>
      <!-- Spelled RecourceName. Normative. Do not "fix" it. -->
      <xs:element name="RecourceName" minOccurs="0">
        <xs:simpleType>
          <xs:restriction base="xs:string">
            <xs:maxLength value="18" />
          </xs:restriction>
        </xs:simpleType>
      </xs:element>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="PointType">
    <xs:sequence>
      <xs:element name="Pos" type="PosType" />
      <xs:element name="Qty" type="xs:decimal" minOccurs="0" />
      <!-- Row 8: Qty2 is accepted and ignored. -->
      <xs:element name="Qty2" type="xs:decimal" minOccurs="0" />
      <xs:element name="Price" type="xs:decimal" minOccurs="0" />
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="PeriodType">
    <xs:sequence>
      <!-- Row 7: TimeInterval is optional here and is NOT constrained against
           MeasurementPeriode, because the sample contradicts the guide on exactly that point.
           The adapter logs the discrepancy and never places a point from it. [OQ-20] -->
      <xs:element name="TimeInterval" type="TimeIntervalType" minOccurs="0" />
      <xs:element name="Resolution" type="DurationCodeType" />
      <xs:element name="ProfileCategory" type="xs:string" minOccurs="0" />
      <xs:element name="ProfileType" type="xs:string" minOccurs="0" />
      <xs:element name="AllocationGroup" type="CodeType" minOccurs="0" />
      <xs:element name="Origin" type="CodeType" minOccurs="0" />
      <xs:element name="Point" type="PointType" minOccurs="1" maxOccurs="unbounded" />
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="ReasonType">
    <xs:sequence>
      <xs:element name="Code" type="CodeType" />
      <xs:element name="Text" minOccurs="0">
        <xs:simpleType>
          <xs:restriction base="xs:string">
            <xs:maxLength value="512" />
          </xs:restriction>
        </xs:simpleType>
      </xs:element>
    </xs:sequence>
  </xs:complexType>

  <xs:complexType name="TimeSeriesType">
    <xs:sequence>
      <xs:element name="mRID" type="DocumentIdentificationType" />
      <xs:element name="BusinessType" type="CodeType" />
      <xs:element name="ResourceProvider" type="xs:string" minOccurs="0" />
      <xs:element name="BiddingZoneDomain" type="xs:string" minOccurs="0" />
      <xs:element name="MeasurementPeriode" type="TimeIntervalType" />
      <!-- Direction is 0..1 in the class diagram: the imbalance sample's price series carry
           none. A23 allocation series without one are rejected semantically as
           UNSUPPORTED_DIRECTION, which is a code an operator can act on. -->
      <xs:element name="Direction" type="CodeType" minOccurs="0" />
      <xs:element name="MeasurementUnit" type="CodeType" />
      <xs:element name="CurrencyUnit" type="xs:string" minOccurs="0" />
      <xs:element name="CurveType" type="CodeType" />
      <xs:element name="Resource" type="ResourceType" minOccurs="0" />
      <xs:element name="Period" type="PeriodType" minOccurs="0" maxOccurs="unbounded" />
      <xs:element name="Reason" type="ReasonType" minOccurs="0" maxOccurs="unbounded" />
    </xs:sequence>
  </xs:complexType>

  <xs:element name="TimeSeriesDocument">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="DocumentIdentification" type="DocumentIdentificationType" />
        <xs:element name="DocumentVersion" type="xs:integer" minOccurs="0" />
        <xs:element name="DocumentType" type="CodeType" />
        <xs:element name="ProcessType" type="CodeType" />
        <xs:element name="SenderIdentification" type="GlnType" />
        <xs:element name="ReceiverIdentification" type="GlnType" />
        <xs:element name="CreatedDateTime" type="xs:dateTime" />
        <xs:element name="ReportPeriode" type="TimeIntervalType" />
        <xs:element name="OrderId" type="xs:string" minOccurs="0" />
        <xs:element name="OrderVersion" type="xs:integer" minOccurs="0" />
        <xs:element name="TimeSeries" type="TimeSeriesType" minOccurs="0" maxOccurs="unbounded" />
        <xs:element name="Reason" type="ReasonType" minOccurs="0" maxOccurs="unbounded" />
      </xs:sequence>
    </xs:complexType>
  </xs:element>

</xs:schema>
```

- [ ] **Step 4: Write `PvnedSchema`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedSchema.cs`:

```csharp
using System.Xml;
using System.Xml.Schema;

namespace PeakPower.Integration.Brp.Pvned;

/// <summary>
/// Loads the embedded reconstructed schema into a compiled <see cref="XmlSchemaSet"/>, once.
/// </summary>
/// <remarks>
/// The schema ships inside the assembly rather than beside it: nothing reads an .xsd from disk at
/// runtime, so validation cannot depend on what happens to be in a host's content root. The
/// resource name is pinned in both the .csproj's LogicalName and
/// <see cref="SchemaProvenance.SchemaResourceName"/>, and PvnedSchemaTests proves the two agree.
/// The set is built with a null <see cref="XmlSchemaSet.XmlResolver"/> and read through a reader
/// that prohibits DTDs, so a schema that tried to xs:include a network resource would fail
/// loading rather than fetch it.
/// </remarks>
public static class PvnedSchema
{
    private static readonly Lazy<XmlSchemaSet> Compiled =
        new(Compile, LazyThreadSafetyMode.ExecutionAndPublication);

    /// <summary>The compiled schema set. Built on first use and shared thereafter.</summary>
    public static XmlSchemaSet Schemas => Compiled.Value;

    /// <summary>The schema's text, for the tests that assert what is in it.</summary>
    public static string ReadSchemaText()
    {
        using var stream = OpenSchemaStream();
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private static Stream OpenSchemaStream() =>
        typeof(PvnedSchema).Assembly.GetManifestResourceStream(SchemaProvenance.SchemaResourceName)
        ?? throw new InvalidOperationException(
            $"The embedded schema '{SchemaProvenance.SchemaResourceName}' is not in this "
            + "assembly. Check the <EmbeddedResource LogicalName=\"...\"> item in "
            + "PeakPower.Integration.Brp.Pvned.csproj: moving the file silently renames the "
            + "resource, and the only symptom is every document failing "
            + $"{PvnedFailureCodes.SchemaValidationFailed}.");

    private static XmlSchemaSet Compile()
    {
        var set = new XmlSchemaSet { XmlResolver = null };

        using var stream = OpenSchemaStream();
        using var reader = XmlReader.Create(
            stream,
            new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = null,
                MaxCharactersFromEntities = 0,
            });

        var schema = XmlSchema.Read(reader, null)
            ?? throw new InvalidOperationException(
                $"'{SchemaProvenance.SchemaFileName}' is not a readable XML schema.");

        set.Add(schema);
        set.Compile();

        return set;
    }
}
```

- [ ] **Step 5: Write the fixture loader**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedFixtures.cs`:

```csharp
using System.Reflection;
using System.Text;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// Reads one of the hand-written PVNed fixtures out of this assembly's embedded resources.
/// </summary>
/// <remarks>
/// <para>
/// <b>Every fixture behind this loader is hand-written and checked in. None is generated.</b>
/// Design section 8's first risk row: the generator and the parser share an author and a source
/// document, so a shared misreading of the PVNed format would pass every test in the slice. Two
/// of the three deliberate breaks in that circle live here - the golden positive document is
/// transcribed by hand from integration-spec section 6, and every negative case is a hand-written
/// checked-in file including the XXE and billion-laughs payloads. A fixture built by a loop, a
/// serialiser or PeakPower.DevStubs closes the circle again.
/// </para>
/// <para>
/// Fixtures are embedded rather than copied to the output directory so that a test cannot pass by
/// reading a stale file left behind by an earlier build, and the LogicalName is pinned to a
/// directory-independent prefix so that moving the folder does not silently rename twenty-five
/// resources at once.
/// </para>
/// </remarks>
public static class PvnedFixtures
{
    /// <summary>The LogicalName prefix pinned in PeakPower.Application.Tests.csproj.</summary>
    public const string ResourcePrefix = "PeakPower.Pvned.Fixtures.";

    private static readonly Assembly Assembly = typeof(PvnedFixtures).Assembly;

    /// <summary>Every fixture name, without the prefix, in ordinal order.</summary>
    public static IReadOnlyList<string> AllNames() =>
    [
        .. Assembly.GetManifestResourceNames()
            .Where(name => name.StartsWith(ResourcePrefix, StringComparison.Ordinal))
            .Select(name => name[ResourcePrefix.Length..])
            .Order(StringComparer.Ordinal),
    ];

    /// <summary>The fixture's bytes, exactly as checked in.</summary>
    public static byte[] Bytes(string name)
    {
        using var stream = Assembly.GetManifestResourceStream(ResourcePrefix + name)
            ?? throw new InvalidOperationException(
                $"There is no PVNed fixture named '{name}'. The {AllNames().Count} that exist "
                + $"are: {string.Join(", ", AllNames())}. If you have just added a file, check "
                + "that it is under tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/ "
                + "and that it has a .xml extension - the .csproj globs on both.");

        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }

    /// <summary>The fixture's text, decoded as UTF-8.</summary>
    public static string Text(string name) => Encoding.UTF8.GetString(Bytes(name));
}
```

- [ ] **Step 6: Write the first fixture, and embed the fixture folder**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/structural-schema-pos-out-of-range.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     Pos 101 is one past the reconstructed XSD's maxInclusive 100 (SchemaProvenance row 3).
     Everything else about the document is valid, so the only thing that can reject it is the
     schema - which is exactly what makes it proof that the schema is attached. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>0f21c4ae-1f1e-4a2e-9f5d-6a0f5a0c9b31</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>1a5b7c9d-2e4f-4a6b-8c0d-1e3f5a7b9c11</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>101</Pos><Qty>40.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

Then add to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj`,
as a new `<ItemGroup>` at the end of the file, immediately before `</Project>`:

```xml
  <ItemGroup>
    <!--
      The hand-written PVNed fixtures. Embedded rather than copied to the output directory, so a
      test cannot pass by reading a stale file an earlier build left behind.

      LogicalName is pinned to a directory-independent prefix: the default manifest name folds
      the folder path in, so moving Ingestion/Pvned/Fixtures would silently rename twenty-five
      resources at once and PvnedFixtures would throw on all of them. With this transform the
      resource is always "PeakPower.Pvned.Fixtures." plus the bare file name, whatever the folder
      is called.

      EVERY FILE UNDER THIS GLOB IS HAND-WRITTEN AND CHECKED IN - design section 8, first risk
      row. Nothing here may be produced by a loop, a serialiser or PeakPower.DevStubs.
    -->
    <EmbeddedResource Include="Ingestion/Pvned/Fixtures/*.xml"
                      LogicalName="PeakPower.Pvned.Fixtures.%(Filename)%(Extension)" />
  </ItemGroup>
```

- [ ] **Step 7: Run the test and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedSchemaTests"
```
Expected: PASS — 7 passed, 0 failed.

- [ ] **Step 8: Mutation — prove the schema is attached, not merely loaded**

This is the assertion the whole task exists for. Temporarily relax the bound in
`Schemas/TimeSeriesDocument-v2p0.reconstructed.xsd`:

```xml
  <xs:simpleType name="PosType">
    <xs:restriction base="xs:int">
      <xs:minInclusive value="1" />
      <xs:maxInclusive value="1000" />
    </xs:restriction>
  </xs:simpleType>
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedSchemaTests"`
Expected: FAIL — `A_Pos_of_one_hundred_and_one_is_refused_by_the_schema` fails with
`errors should not be empty but was empty`. Every other test in the class stays green: the schema
still compiles, still targets the right namespace, still spells `RecourceName` — which is the
point. A schema can be present, correct-looking and completely toothless.

Then restore `maxInclusive value="100"`.

- [ ] **Step 9: Mutation — prove the resource name is load-bearing**

Temporarily change the `LogicalName` in
`src/Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj` to
`PeakPower.Integration.Brp.Pvned.TimeSeriesDocument-v2p0.reconstructed.xsd` (dropping `Schemas.`).

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedSchemaTests"`
Expected: FAIL — `The_embedded_resource_is_present_under_the_name_the_csproj_pins`,
`The_schema_compiles`, `The_schema_targets_PVNeds_namespace`,
`The_schema_declares_the_misspelled_RecourceName_because_PVNed_does` and
`A_Pos_of_one_hundred_and_one_is_refused_by_the_schema` all fail with
`System.InvalidOperationException : The embedded schema
'PeakPower.Integration.Brp.Pvned.Schemas.TimeSeriesDocument-v2p0.reconstructed.xsd' is not in this
assembly.` — the message the loader was written to print rather than a null-reference.

Then restore the `LogicalName`.

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Integration.Brp.Pvned/Schemas \
        src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedSchema.cs \
        src/Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj \
        tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj \
        tests/PeakPower.Application.Tests/Ingestion/Pvned
git commit -m "pvned: the reconstructed XSD, embedded, and proof that it bites

[F02-R09] wants validation against TimeSeriesDocument-v2p0.xsd. We do not have that file - it is
PVNed's copyright - so this one is reconstructed from the class diagram, the sample and the nine
documented disagreements, and it is named .reconstructed.xsd so that swapping in the real one is
a diff review.

It validates STRUCTURE, not code lists: DocumentType, Direction, MeasurementUnit and CurveType are
plain strings so that their value sets surface as the frozen integration-spec 8.2 codes rather
than as schema errors. SchemaProvenance rows 5 and 9.

Verified by mutation: relaxing PosType's maxInclusive from 100 to 1000 reddens only the
Pos-101 fixture while compile, namespace and spelling assertions stay green - a schema can be
present, correct-looking and completely toothless. Dropping 'Schemas.' from the LogicalName
reddens five tests with the loader's own message rather than a null-reference."
```

---

### Task 5: `PvnedXmlReader` — XXE hardening in the first XML-reading commit, and the SOAP unwrap

Design §3.1 and shared contract §8.1: *"XML reading with `DtdProcessing.Prohibit` and
`XmlResolver = null`."* The task brief for this plan is emphatic about **when**: *"XXE hardening
belongs in the FIRST XML-reading commit, not a later hardening pass."* This is that commit. There
is no version of this repository in which an unhardened PVNed reader exists.

It also lands the golden document — **transcribed by hand from integration-spec §6**, the third of
design §8's three deliberate breaks in the generator/parser circle.

**Files:**
- Create: `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedXmlReader.cs`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/golden-a12-imbalance.xml`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/structural-xxe-external-entity.xml`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/structural-billion-laughs.xml`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/structural-missing-soap-body.xml`
- Test: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedXmlHardeningTests.cs`

**Interfaces:**
- Consumes: `PvnedSchema.Schemas` (Task 4), `PvnedFailureCodes.MalformedXml`,
  `.MissingSoapBody`, `.SchemaValidationFailed` (Task 2), `SchemaProvenance.TargetNamespace`,
  `.SoapNamespace` (Task 3).
- Produces:
  `public sealed record PvnedReadResult(XElement? Document, string? FailureCode, string? FailureDetail)`
  and `public static class PvnedXmlReader` with
  `public static PvnedReadResult ReadTimeSeriesDocument(ReadOnlyMemory<byte> payload, XmlSchemaSet schemas)`.
  Task 7's adapter consumes it and nothing else does.

- [ ] **Step 1: Write the four fixtures**

**These are hand-written. Copy them literally; do not generate any of them.**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/golden-a12-imbalance.xml`.
This is the reconstructed sample of integration-spec §6, transcribed by hand, in schema element
order. Its two `Point`s are the two the specification actually prints; where the specification
writes `<!-- … through Pos 96 … -->` this file simply stops, because inventing ninety-four more
points would be inventing evidence, and an A12 is recognised and closed before any point-count
rule runs (`[DEC-25]`, design §7.13).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     Transcribed by hand from specs/30-integrations/01-pvned-timeseries.md section 6, which is
     itself a reconstruction in XML of PVNed's supplied CustomerImbalanceReport.json.

     This is design section 8's third break in the generator/parser circle: the golden positive
     document is transcribed from the specification, never serialised out of the parser's own
     model, so a shared misreading of the format cannot hide behind a shared type.

     It is an A12 imbalance report. [DEC-25] puts imbalance out of scope, so the adapter
     recognises it, closes it and writes zero readings - design section 7.13. The two points
     below are the two the specification prints; the specification's "through Pos 96" ellipsis
     is NOT expanded here, because inventing ninety-four points would be inventing evidence. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>8ff18bca-9e80-41aa-bd9f-3202f2fcc6c8</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A12</DocumentType>
      <ProcessType>A06</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2025-01-14T15:15:05Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2024-12-27T23:00:00Z</StartPeriod>
        <EndPeriod>2024-12-28T23:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>3e09aa9e-5013-4b32-8305-f9e6c4430614</mRID>
        <BusinessType>A20</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2024-12-27T23:00:00Z</StartPeriod>
          <EndPeriod>2024-12-28T23:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A01</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurrencyUnit>EUR</CurrencyUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <RecourceName>Imbalance</RecourceName>
        </Resource>
        <Period>
          <TimeInterval>
            <StartPeriod>2024-12-27T23:00:00Z</StartPeriod>
            <EndPeriod>2024-12-28T23:00:00Z</EndPeriod>
          </TimeInterval>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>0</Qty><Price>-30.81</Price></Point>
          <Point><Pos>2</Pos><Qty>0</Qty><Price>-28.51</Price></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/structural-xxe-external-entity.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     Classic XML external-entity injection: a DOCTYPE declares an entity whose SYSTEM identifier
     is a local file, and the entity is then referenced from inside the document. A reader with
     DtdProcessing.Parse and a default XmlResolver reads /etc/passwd off the ingestion host's
     disk and puts it in a metering document. The reader refuses the DOCTYPE outright, so the
     entity is never declared and the file is never opened. -->
<!DOCTYPE soap:Envelope [
  <!ENTITY passwordFile SYSTEM "file:///etc/passwd">
]>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>&passwordFile;</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/structural-billion-laughs.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     The billion-laughs entity-expansion bomb: ten nested entity definitions, each referencing
     the one below it ten times, so &lol9; expands to a thousand million characters and exhausts
     memory before any parsing finishes. Two settings stop it independently -
     DtdProcessing.Prohibit refuses the DOCTYPE, and MaxCharactersFromEntities = 0 caps expansion
     - and the reader sets both, because the first is the one that would be relaxed by somebody
     who needed a DTD for an unrelated reason. -->
<!DOCTYPE soap:Envelope [
  <!ENTITY lol "lol">
  <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
  <!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">
  <!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">
  <!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;">
  <!ENTITY lol8 "&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;">
  <!ENTITY lol9 "&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;">
]>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>&lol9;</DocumentIdentification>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/structural-missing-soap-body.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     Well-formed XML, a correct SOAP 1.1 envelope, and no TimeSeriesDocument anywhere in it.
     This is what a misconfigured sender posting some other message to the BRP webhook looks
     like, and it must be MISSING_SOAP_BODY rather than a null-reference somewhere downstream. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <PingRequest xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <Message>are you there</Message>
    </PingRequest>
  </soap:Body>
</soap:Envelope>
```

- [ ] **Step 2: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedXmlHardeningTests.cs`:

```csharp
using System.Text;
using System.Xml.Linq;
using PeakPower.Integration.Brp.Pvned;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// Integration-spec section 8.1: well-formed XML, a SOAP envelope, and DTD processing and
/// external entity resolution disabled. Shared contract section 8.1 pins the settings:
/// DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersFromEntities = 0.
/// </summary>
/// <remarks>
/// These tests exist in the same commit as the first line of XML-reading code in this repository.
/// A "hardening pass" scheduled for later is a period during which an ingestion endpoint reads
/// arbitrary files off the host, and there is no such period here.
/// </remarks>
public sealed class PvnedXmlHardeningTests
{
    private static PvnedReadResult Read(string fixtureName) =>
        PvnedXmlReader.ReadTimeSeriesDocument(PvnedFixtures.Bytes(fixtureName), PvnedSchema.Schemas);

    [Fact]
    public void An_external_entity_is_refused_and_the_referenced_file_is_never_read()
    {
        var result = Read("structural-xxe-external-entity.xml");

        result.Document.ShouldBeNull();
        result.FailureCode.ShouldBe(PvnedFailureCodes.MalformedXml);
        result.FailureDetail.ShouldNotBeNull();
        result.FailureDetail.ShouldContain("DTD", Case.Sensitive);
    }

    [Fact]
    public void Nothing_from_the_hosts_password_file_reaches_the_failure_detail()
    {
        var result = Read("structural-xxe-external-entity.xml");

        result.FailureDetail.ShouldNotBeNull();
        result.FailureDetail.ShouldNotContain("root:", Case.Sensitive);
        result.FailureDetail.ShouldNotContain("/bin/", Case.Sensitive);
    }

    [Fact]
    public void A_billion_laughs_bomb_is_refused_before_it_expands()
    {
        var result = Read("structural-billion-laughs.xml");

        result.Document.ShouldBeNull();
        result.FailureCode.ShouldBe(PvnedFailureCodes.MalformedXml);
    }

    [Fact]
    public void Bytes_that_are_not_XML_at_all_are_MALFORMED_XML()
    {
        var result = PvnedXmlReader.ReadTimeSeriesDocument(
            Encoding.UTF8.GetBytes("this is not a metering document"),
            PvnedSchema.Schemas);

        result.Document.ShouldBeNull();
        result.FailureCode.ShouldBe(PvnedFailureCodes.MalformedXml);
    }

    [Fact]
    public void An_empty_payload_is_MALFORMED_XML_rather_than_an_unhandled_exception()
    {
        var result = PvnedXmlReader.ReadTimeSeriesDocument(
            ReadOnlyMemory<byte>.Empty,
            PvnedSchema.Schemas);

        result.Document.ShouldBeNull();
        result.FailureCode.ShouldBe(PvnedFailureCodes.MalformedXml);
    }

    [Fact]
    public void An_envelope_with_no_TimeSeriesDocument_is_MISSING_SOAP_BODY()
    {
        var result = Read("structural-missing-soap-body.xml");

        result.Document.ShouldBeNull();
        result.FailureCode.ShouldBe(PvnedFailureCodes.MissingSoapBody);
    }

    [Fact]
    public void A_bare_TimeSeriesDocument_with_no_envelope_is_MISSING_SOAP_BODY()
    {
        // Integration-spec section 8.1 rule 1 is "well-formed XML; SOAP envelope PRESENT".
        // A naked document is not a lenient success; it is a sender that has changed transport.
        var naked =
            """
            <?xml version="1.0" encoding="UTF-8"?>
            <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
              <DocumentIdentification>8ff18bca-9e80-41aa-bd9f-3202f2fcc6c8</DocumentIdentification>
            </TimeSeriesDocument>
            """;

        var result = PvnedXmlReader.ReadTimeSeriesDocument(
            Encoding.UTF8.GetBytes(naked), PvnedSchema.Schemas);

        result.Document.ShouldBeNull();
        result.FailureCode.ShouldBe(PvnedFailureCodes.MissingSoapBody);
    }

    [Fact]
    public void The_golden_sample_unwraps_to_the_TimeSeriesDocument_element()
    {
        var result = Read("golden-a12-imbalance.xml");

        result.FailureCode.ShouldBeNull(result.FailureDetail);
        result.Document.ShouldNotBeNull();
        result.Document.Name.ShouldBe(
            XName.Get("TimeSeriesDocument", SchemaProvenance.TargetNamespace));
    }

    [Fact]
    public void The_golden_samples_header_survives_the_unwrap_intact()
    {
        var document = Read("golden-a12-imbalance.xml").Document;

        document.ShouldNotBeNull();
        Value(document, "DocumentIdentification").ShouldBe("8ff18bca-9e80-41aa-bd9f-3202f2fcc6c8");
        Value(document, "DocumentType").ShouldBe("A12");
        Value(document, "ProcessType").ShouldBe("A06");
        Value(document, "SenderIdentification").ShouldBe("8714252005776");
        Value(document, "ReceiverIdentification").ShouldBe("8712423456789");
        Value(document, "CreatedDateTime").ShouldBe("2025-01-14T15:15:05Z");
    }

    [Fact]
    public void The_golden_samples_misspelled_RecourceName_survives_the_unwrap()
    {
        var document = Read("golden-a12-imbalance.xml").Document;

        document.ShouldNotBeNull();
        document
            .Descendants(XName.Get("RecourceName", SchemaProvenance.TargetNamespace))
            .Select(element => element.Value)
            .ShouldBe(["Imbalance"]);
    }

    [Fact]
    public void A_document_that_breaks_the_schema_is_SCHEMA_VALIDATION_FAILED_not_MALFORMED_XML()
    {
        var result = Read("structural-schema-pos-out-of-range.xml");

        result.Document.ShouldBeNull();
        result.FailureCode.ShouldBe(PvnedFailureCodes.SchemaValidationFailed);
        result.FailureDetail.ShouldNotBeNull();
        result.FailureDetail.ShouldContain("Pos", Case.Sensitive);
    }

    private static string? Value(XElement document, string localName) =>
        document.Element(XName.Get(localName, SchemaProvenance.TargetNamespace))?.Value;
}
```

- [ ] **Step 3: Run it and watch it fail**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build tests/PeakPower.Application.Tests --nologo
```
Expected: FAIL with `error CS0246: The type or namespace name 'PvnedReadResult' could not be
found` and `error CS0103: The name 'PvnedXmlReader' does not exist in the current context`.

- [ ] **Step 4: Write `PvnedXmlReader`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedXmlReader.cs`:

```csharp
using System.Globalization;
using System.Xml;
using System.Xml.Linq;
using System.Xml.Schema;

namespace PeakPower.Integration.Brp.Pvned;

/// <summary>
/// The outcome of reading a payload: either the unwrapped, schema-valid
/// <c>TimeSeriesDocument</c> element, or a failure code and a sentence describing it.
/// </summary>
public sealed record PvnedReadResult(XElement? Document, string? FailureCode, string? FailureDetail)
{
    /// <summary>The document read cleanly and validated.</summary>
    public static PvnedReadResult Ok(XElement document) => new(document, null, null);

    /// <summary>The document did not survive one of integration-spec section 8.1's three rules.</summary>
    public static PvnedReadResult Failed(string failureCode, string failureDetail) =>
        new(null, failureCode, failureDetail);
}

/// <summary>
/// Turns bytes into a <c>TimeSeriesDocument</c> element: integration-spec section 8.1's three
/// structural rules, in order - well-formed XML, a SOAP envelope, XSD validation.
/// </summary>
/// <remarks>
/// <para>
/// <b>The hardening is not optional and is not deferred.</b> Shared contract section 8.1 pins
/// <c>DtdProcessing.Prohibit</c>, <c>XmlResolver = null</c> and
/// <c>MaxCharactersFromEntities = 0</c>, and the architecture's security section 4.1 makes DTD
/// and external-entity refusal mandatory for any XML endpoint. Two of the three settings stop the
/// billion-laughs bomb independently, which is deliberate: the first is the one somebody relaxes
/// when they need a DTD for an unrelated reason.
/// </para>
/// <para>
/// <b>Validation happens on the isolated TimeSeriesDocument, not on the envelope.</b> The SOAP
/// namespace is not in the schema set, and a lax validation pass over an unknown root is a
/// subtlety this code should not depend on. Isolating the element makes the question
/// unambiguous - it either validates or it does not - at the cost of line numbers in the failure
/// detail. The schema's own messages name the offending element and value, which is what
/// [F02-R09]'s "XSD error path" is for.
/// </para>
/// </remarks>
public static class PvnedXmlReader
{
    private static readonly XName EnvelopeName =
        XName.Get("Envelope", SchemaProvenance.SoapNamespace);

    private static readonly XName BodyName =
        XName.Get("Body", SchemaProvenance.SoapNamespace);

    private static readonly XName DocumentName =
        XName.Get("TimeSeriesDocument", SchemaProvenance.TargetNamespace);

    /// <summary>Integration-spec section 8.1, rules 1 to 3, in order.</summary>
    public static PvnedReadResult ReadTimeSeriesDocument(
        ReadOnlyMemory<byte> payload,
        XmlSchemaSet schemas)
    {
        // Rule 1: well-formed XML, read with DTDs prohibited and no resolver.
        XDocument envelope;
        try
        {
            using var stream = new MemoryStream(payload.ToArray(), writable: false);
            using var reader = XmlReader.Create(stream, HardenedSettings());
            envelope = XDocument.Load(reader, LoadOptions.None);
        }
        catch (XmlException exception)
        {
            return PvnedReadResult.Failed(
                PvnedFailureCodes.MalformedXml,
                $"The payload is not readable XML: {exception.Message}");
        }

        // Rule 2: a SOAP envelope, with exactly one TimeSeriesDocument in its body.
        var body = envelope.Root?.Name == EnvelopeName
            ? envelope.Root.Element(BodyName)
            : null;

        if (body is null)
        {
            return PvnedReadResult.Failed(
                PvnedFailureCodes.MissingSoapBody,
                "The payload carries no SOAP 1.1 envelope with a body. Expected a root element "
                + $"'{EnvelopeName}' containing '{BodyName}', and found "
                + $"'{envelope.Root?.Name.ToString() ?? "nothing"}'.");
        }

        var documents = body.Elements(DocumentName).ToArray();
        if (documents.Length != 1)
        {
            return PvnedReadResult.Failed(
                PvnedFailureCodes.MissingSoapBody,
                $"The SOAP body carries {documents.Length.ToString(CultureInfo.InvariantCulture)} "
                + $"'{DocumentName}' elements; exactly one is expected.");
        }

        // Rule 3: XSD validation against the reconstructed schema. [F02-R09]
        var errors = new List<string>();
        var isolated = new XDocument(new XElement(documents[0]));
        isolated.Validate(schemas, (_, args) => errors.Add(args.Message));

        if (errors.Count > 0)
        {
            var detail = errors.Count == 1
                ? errors[0]
                : $"{errors[0]} ({(errors.Count - 1).ToString(CultureInfo.InvariantCulture)} "
                  + "further schema error(s) followed.)";

            return PvnedReadResult.Failed(
                PvnedFailureCodes.SchemaValidationFailed,
                $"The document does not satisfy {SchemaProvenance.SchemaFileName}: {detail}");
        }

        return PvnedReadResult.Ok(documents[0]);
    }

    /// <summary>
    /// Shared contract section 8.1's settings, verbatim. Every one of them is load-bearing:
    /// Prohibit refuses a DOCTYPE outright, the null resolver means no external identifier is
    /// ever fetched even if a DTD somehow reached the parser, and the zero entity budget caps
    /// expansion so that a relaxation of the first two does not silently reopen the bomb.
    /// </summary>
    private static XmlReaderSettings HardenedSettings() => new()
    {
        DtdProcessing = DtdProcessing.Prohibit,
        XmlResolver = null,
        MaxCharactersFromEntities = 0,
        IgnoreComments = true,
        IgnoreProcessingInstructions = true,
        IgnoreWhitespace = true,
        ConformanceLevel = ConformanceLevel.Document,
        CloseInput = true,
    };
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedXmlHardeningTests"
```
Expected: PASS — 11 passed, 0 failed.

- [ ] **Step 6: Mutation — prove the DTD prohibition is what stops the XXE**

This is the mutation the whole task is for. Temporarily relax exactly one setting in
`PvnedXmlReader.HardenedSettings()`:

```csharp
        DtdProcessing = DtdProcessing.Parse,
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedXmlHardeningTests"`
Expected: FAIL — `An_external_entity_is_refused_and_the_referenced_file_is_never_read` fails with
`result.FailureCode should be "MALFORMED_XML" but was "SCHEMA_VALIDATION_FAILED"` (the DOCTYPE now
parses, the entity resolves to nothing because the resolver is null, and the empty
`DocumentIdentification` then breaks `minLength 1`), and
`A_billion_laughs_bomb_is_refused_before_it_expands` fails the same way.

⚠ **Read the failure, do not just watch it go red.** The code changing from `MALFORMED_XML` to
`SCHEMA_VALIDATION_FAILED` rather than to a leaked password file is the *second* layer speaking:
`XmlResolver = null` is what stops the file being opened. That is the point of setting both, and
it is why the next mutation is separate.

Then restore `DtdProcessing.Prohibit`.

- [ ] **Step 7: Mutation — prove the null resolver is the layer that stops the file being read**

Temporarily relax **both** settings at once, which is what a careless "we need DTDs for X" change
looks like:

```csharp
        DtdProcessing = DtdProcessing.Parse,
        XmlResolver = new XmlUrlResolver(),
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedXmlHardeningTests"`
Expected: FAIL — on a machine with a readable `/etc/passwd`,
`Nothing_from_the_hosts_password_file_reaches_the_failure_detail` fails with the file's contents
quoted back inside the schema error, and
`An_external_entity_is_refused_and_the_referenced_file_is_never_read` fails on the code. On a
machine without one, the first test may pass and the second still fails — if that happens, say so
rather than recording the mutation as proven, and re-run it where the file exists.

Then restore both settings.

- [ ] **Step 8: Mutation — prove the SOAP envelope is actually required**

Temporarily replace the body lookup with a lenient search of the whole document:

```csharp
        var documents = envelope.Descendants(DocumentName).ToArray();
        if (documents.Length != 1)
        {
            return PvnedReadResult.Failed(
                PvnedFailureCodes.MissingSoapBody,
                $"The payload carries {documents.Length.ToString(CultureInfo.InvariantCulture)} "
                + $"'{DocumentName}' elements; exactly one is expected.");
        }
```

(and delete the `body` block above it so the code still compiles).

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedXmlHardeningTests"`
Expected: FAIL — exactly one test,
`A_bare_TimeSeriesDocument_with_no_envelope_is_MISSING_SOAP_BODY`, with
`result.FailureCode should be "MISSING_SOAP_BODY" but was null`. Every other test stays green,
including `An_envelope_with_no_TimeSeriesDocument_is_MISSING_SOAP_BODY` — a lenient search still
finds nothing in that one, which is why the naked-document case has its own test.

Then restore the body lookup.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedXmlReader.cs \
        tests/PeakPower.Application.Tests/Ingestion/Pvned
git commit -m "pvned: hardened XML reading and the SOAP unwrap, with the golden sample

XXE hardening is in the FIRST commit that reads XML in this repository, not in a later hardening
pass: DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersFromEntities = 0 (shared contract
8.1, architecture security 4.1). Integration-spec 8.1's three structural rules run in order and
each has its own code, since 8.1 names none.

golden-a12-imbalance.xml is transcribed BY HAND from integration-spec 6 - design 8's third break
in the generator/parser circle. Its ellipsis is not expanded: inventing ninety-four points would
be inventing evidence, and [DEC-25] closes an A12 before any point-count rule runs.

Verified by mutation: DtdProcessing.Parse alone reddens both entity fixtures and moves the code to
SCHEMA_VALIDATION_FAILED, which is the null resolver speaking; relaxing the resolver too puts
/etc/passwd in the failure detail; and replacing the body lookup with a lenient Descendants search
reddens only the naked-document case."
```

---

### Task 6: The adapter's header — receiver, sender, and the `DocumentType` branch

Shared contract §8.2: `A23` is processed as an allocation; `A12` is **recognised, stored and
closed with zero readings written** under `[DEC-25]`; every other `DocumentType` is rejected. This
task builds `PvnedIngestionAdapter` up to and including that branch, and pins the ordering
decision the branch depends on.

⚠ **The receiver and sender checks run BEFORE the document-type branch.** A document addressed to
somebody else is not ours to recognise. If `DocumentType` were tested first, a misrouted A12 would
come back `RecognisedAndClosed` — a 200, a `PROCESSED` message and a stored payload we had no
business accepting. `A_misrouted_A12_is_rejected_rather_than_recognised_and_closed` is the
assertion, and `invalid-wrong-receiver-a12.xml` is the fixture.

**Files:**
- Create: `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedDocumentType.cs`
- Create: `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedIngestionAdapter.cs`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedAdapterHarness.cs`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-wrong-receiver.xml`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-wrong-receiver-a12.xml`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-unknown-sender.xml`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-unsupported-document-type.xml`
- Test: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedDocumentTypeTests.cs`

**Interfaces:**
- Consumes: `IBrpIngestionAdapter`, `BrpParseRequest`, `BrpParseOutcome`, `BrpParseStatus`,
  `BrpDocument`, `BrpDocumentKind`, `CanonicalSeries` (plan 3); `IMarketCalendar` (plan 1);
  `PvnedAdapterOptions` (Task 1); `PvnedFailureCodes` (Task 2); `SchemaProvenance` (Task 3);
  `PvnedSchema` (Task 4); `PvnedXmlReader`, `PvnedReadResult` (Task 5).
- Produces:
  `public enum PvnedDocumentType { Allocation, Imbalance }`;
  `public sealed class PvnedIngestionAdapter : IBrpIngestionAdapter` with
  `public const string Key = "PVNED_TIMESERIES_XML_V2P0"` and the constructor
  `PvnedIngestionAdapter(IMarketCalendar calendar, PvnedAdapterOptions options, ILogger<PvnedIngestionAdapter> logger)`.
  Tasks 8–15 extend it; Task 15 registers it.
  Also `PeakPower.Application.Tests.Ingestion.Pvned.PvnedAdapterHarness` with
  `public static PvnedIngestionAdapter Create(DateTimeOffset? now = null, string? senderGln = null, string? receiverGln = null)`
  and `public static BrpParseOutcome Parse(string fixtureName, ...)`.

- [ ] **Step 1: Write the four fixtures**

**Hand-written. Copy them literally.** Each carries four points rather than ninety-six, and that
is legitimate rather than lazy: the pinned check order puts every rule these fixtures violate
*before* the point-count rule, so the count never gets a chance to fire. Task 14 pins that order
with its own test, so if somebody reorders the checks these four go red with `INCOMPLETE_PERIOD`
and say so.

Create `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-wrong-receiver.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     Integration-spec 8.2 rule 2: ReceiverIdentification is PeakPower's own GLN. This one is
     8799999999999, which is nobody's. Everything else about the document is valid. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>2b8e0b7a-4f61-4d2b-9a3c-7e1d9f0a4c55</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8799999999999</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>0c2f4a6b-8d0e-4f2a-9b4c-6d8e0f2a4b61</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>40.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

Create `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-wrong-receiver-a12.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     A misrouted A12. [DEC-25] recognises and closes an A12 rather than failing it, so an
     adapter that branched on DocumentType before checking the receiver would answer 200,
     mark the message PROCESSED and store a payload addressed to somebody else. This document
     exists to make that ordering an assertion rather than a comment. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>4d9f1c3e-7a52-4b8d-9e0f-2c4a6b8d0e13</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A12</DocumentType>
      <ProcessType>A06</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8799999999999</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>6b0d2f4a-9c1e-4a3b-8d5f-0e2a4c6b8d15</mRID>
        <BusinessType>A20</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A01</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurrencyUnit>EUR</CurrencyUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <RecourceName>Imbalance</RecourceName>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>0</Qty><Price>-30.81</Price></Point>
          <Point><Pos>2</Pos><Qty>0</Qty><Price>-28.51</Price></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

Create `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-unknown-sender.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     Integration-spec 8.2 rule 3: SenderIdentification is the GLN configured for THIS BRP.
     8700000000000 is not PVNed's. Under [DEC-69] the expected sender is per-BRP configuration,
     so this is the check that stops one BRP's documents being applied as another's. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>7e1a3c5f-9b2d-4e6a-8c0f-1d3b5a7c9e21</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8700000000000</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>9c3e5a7b-1d4f-4b6c-8e0a-2f4d6b8c0e23</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>40.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

Create `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-unsupported-document-type.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     Integration-spec 8.2 rule 1: DocumentType/ProcessType is a handled combination. A01 appears
     in the class diagram's DocumentType list and the platform handles neither it nor its
     ProcessType A14, so it is rejected. Note the reconstructed XSD deliberately leaves
     DocumentType a plain string (SchemaProvenance rule 2 of the header comment), so this
     document reaches the semantic layer and comes back with the frozen 8.2 code rather than a
     schema error. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>1f4b6d8a-2c5e-4f7a-9b1d-3e5a7c9b1d31</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A01</DocumentType>
      <ProcessType>A14</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>3a5c7e9b-4d6f-4a8b-9c1e-5f7a9c1e3b33</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>40.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

- [ ] **Step 2: Write the test harness**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedAdapterHarness.cs`:

```csharp
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Infrastructure.Time;
using PeakPower.Integration.Brp.Pvned;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// Builds the adapter for a test and runs a fixture through it.
/// </summary>
/// <remarks>
/// <para>
/// The calendar here is the <b>real</b> <see cref="MarketCalendar"/> on a
/// <see cref="FakeTimeProvider"/>, not a stub. The adapter asks it for
/// <c>ExpectedIntervalCount</c> and <c>IntervalStart</c>, and those are exactly the answers a
/// stub would get wrong in the same direction the adapter does. Design section 10's third
/// mutation - replace IntervalStart with a naive add-fifteen-minutes loop and watch the autumn
/// 100-point case fail - only bites if the tests drive the real implementation.
/// </para>
/// <para>
/// Constructing the adapter in one place means a constructor change is one edit rather than
/// thirty.
/// </para>
/// </remarks>
public static class PvnedAdapterHarness
{
    /// <summary>A fixed instant, so nothing in this suite depends on the wall clock.</summary>
    public static readonly DateTimeOffset DefaultNow =
        new(2026, 8, 13, 4, 2, 11, TimeSpan.Zero);

    /// <summary>The BRP row's id in the seeded data, for a realistic request.</summary>
    public static readonly Guid PvnedBrpId = new("0199a1a0-0000-7000-8000-0000000000b1");

    public static PvnedIngestionAdapter Create(
        DateTimeOffset? now = null,
        string? senderGln = null,
        string? receiverGln = null)
    {
        var options = new PvnedAdapterOptions();
        if (senderGln is not null)
        {
            options.SenderGln = senderGln;
        }

        if (receiverGln is not null)
        {
            options.ReceiverGln = receiverGln;
        }

        return new PvnedIngestionAdapter(
            new MarketCalendar(new FakeTimeProvider(now ?? DefaultNow)),
            options,
            NullLogger<PvnedIngestionAdapter>.Instance);
    }

    public static BrpParseRequest Request(string fixtureName, DateTimeOffset? receivedAt = null) =>
        new(
            InboundMessageId: Guid.CreateVersion7(),
            BrpId: PvnedBrpId,
            BrpCode: "PVNED",
            CorrelationId: Guid.CreateVersion7(),
            Payload: PvnedFixtures.Bytes(fixtureName),
            ReceivedAt: receivedAt ?? DefaultNow);

    public static BrpParseOutcome Parse(
        string fixtureName,
        DateTimeOffset? now = null,
        string? senderGln = null,
        string? receiverGln = null) =>
        Create(now, senderGln, receiverGln).Parse(Request(fixtureName, now));
}
```

- [ ] **Step 3: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedDocumentTypeTests.cs`:

```csharp
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Integration.Brp.Pvned;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// Shared contract section 8.2's first three rows, plus the [DEC-25] A12 branch.
/// </summary>
public sealed class PvnedDocumentTypeTests
{
    [Fact]
    public void The_adapter_key_is_the_one_migration_9_seeds_on_the_PVNED_row()
    {
        PvnedAdapterHarness.Create().AdapterKey.ShouldBe("PVNED_TIMESERIES_XML_V2P0");
    }

    [Fact]
    public void An_A12_imbalance_document_is_recognised_and_closed_with_no_series_at_all()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a12-imbalance.xml");

        outcome.Status.ShouldBe(BrpParseStatus.RecognisedAndClosed);
        outcome.FailureCode.ShouldBeNull();
        outcome.Document.ShouldNotBeNull();
        outcome.Document.Kind.ShouldBe(BrpDocumentKind.Imbalance);
        outcome.Document.Series.Count.ShouldBe(
            0,
            "[DEC-25] puts imbalance out of scope: the document is recognised, stored and closed "
            + "with ZERO readings written - design section 7.13");
    }

    [Fact]
    public void The_closed_A12_still_carries_its_document_identity_so_the_message_can_be_stored()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a12-imbalance.xml");

        outcome.Document.ShouldNotBeNull();
        outcome.Document.DocumentId.ShouldBe("8ff18bca-9e80-41aa-bd9f-3202f2fcc6c8");
        outcome.Document.DocumentCreated
            .ShouldBe(new DateTimeOffset(2025, 1, 14, 15, 15, 5, TimeSpan.Zero));
    }

    [Fact]
    public void A_wrong_receiver_is_WRONG_RECEIVER()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-wrong-receiver.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.FailureCode.ShouldBe(PvnedFailureCodes.WrongReceiver);
        outcome.Document.ShouldBeNull();
    }

    [Fact]
    public void The_wrong_receiver_detail_names_both_GLNs_so_an_operator_can_see_the_mistake()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-wrong-receiver.xml");

        outcome.FailureDetail.ShouldNotBeNull();
        outcome.FailureDetail.ShouldContain("8799999999999", Case.Sensitive);
        outcome.FailureDetail.ShouldContain("8712423456789", Case.Sensitive);
    }

    [Fact]
    public void A_misrouted_A12_is_rejected_rather_than_recognised_and_closed()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-wrong-receiver-a12.xml");

        outcome.Status.ShouldBe(
            BrpParseStatus.Rejected,
            "the receiver check runs BEFORE the DocumentType branch. A document addressed to "
            + "somebody else is not ours to recognise, and [DEC-25]'s recognise-and-close would "
            + "otherwise answer 200 and store it as PROCESSED");
        outcome.FailureCode.ShouldBe(PvnedFailureCodes.WrongReceiver);
    }

    [Fact]
    public void An_unknown_sender_is_UNKNOWN_SENDER()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-unknown-sender.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.FailureCode.ShouldBe(PvnedFailureCodes.UnknownSender);
    }

    [Fact]
    public void The_expected_sender_comes_from_configuration_not_from_a_constant()
    {
        // [DEC-69] and [AS-16]: the expected sender is per-BRP reference data. Point the adapter
        // at the "unknown" sender's GLN and the same document becomes valid at the header.
        var outcome = PvnedAdapterHarness.Parse(
            "invalid-unknown-sender.xml", senderGln: "8700000000000");

        outcome.FailureCode.ShouldNotBe(PvnedFailureCodes.UnknownSender);
    }

    [Fact]
    public void An_unhandled_DocumentType_is_UNSUPPORTED_DOCUMENT_TYPE()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-unsupported-document-type.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.FailureCode.ShouldBe(PvnedFailureCodes.UnsupportedDocumentType);
    }

    [Fact]
    public void The_unsupported_document_type_detail_names_the_code_that_was_sent()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-unsupported-document-type.xml");

        outcome.FailureDetail.ShouldNotBeNull();
        outcome.FailureDetail.ShouldContain("A01", Case.Sensitive);
        outcome.FailureDetail.ShouldContain("A14", Case.Sensitive);
    }

    [Fact]
    public void The_two_adapter_internal_document_types_are_the_contracts_two()
    {
        Enum.GetNames<PvnedDocumentType>().ShouldBe(["Allocation", "Imbalance"]);
    }
}
```

- [ ] **Step 4: Run it and watch it fail**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build tests/PeakPower.Application.Tests --nologo
```
Expected: FAIL with `error CS0246: The type or namespace name 'PvnedIngestionAdapter' could not be
found` and `error CS0246: The type or namespace name 'PvnedDocumentType' could not be found`.

- [ ] **Step 5: Write `PvnedDocumentType`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedDocumentType.cs`:

```csharp
namespace PeakPower.Integration.Brp.Pvned;

/// <summary>
/// The two <c>DocumentType</c> codes this adapter handles. Shared contract section 4 names it
/// adapter-internal: it is never persisted as an enum column and never reaches the wire.
/// </summary>
/// <remarks>
/// It exists beside <c>BrpDocumentKind</c> rather than instead of it because the two answer
/// different questions. This one is "what did PVNed's A23/A12 code say"; the port's is "what is
/// this document, in terms every BRP shares". Collapsing them would put a PVNed code list in the
/// port, which is the one thing [DEC-69]'s seam exists to prevent.
/// </remarks>
public enum PvnedDocumentType
{
    /// <summary>PVNed <c>DocumentType</c> A23: per-EAN consumption and production.</summary>
    Allocation,

    /// <summary>PVNed <c>DocumentType</c> A12: a portfolio-level imbalance report. [DEC-25]</summary>
    Imbalance,
}
```

- [ ] **Step 6: Write `PvnedIngestionAdapter` up to the document-type branch**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedIngestionAdapter.cs`:

```csharp
using System.Globalization;
using System.Xml.Linq;
using Microsoft.Extensions.Logging;
using PeakPower.Application.Abstractions;
using PeakPower.Application.Abstractions.Ingestion;

namespace PeakPower.Integration.Brp.Pvned;

/// <summary>
/// The PVNed adapter: one implementation of the [DEC-69] BRP port.
/// </summary>
/// <remarks>
/// <para>
/// It receives bytes and returns a canonical series set or a typed rejection. <b>It never touches
/// the database, never resolves an EAN and never decides quarantine</b> - shared contract section
/// 7.1. UNKNOWN_METERING_POINT and WRONG_BRP_FOR_METERING_POINT are listed in integration-spec
/// section 8.2 but need <c>customer.metering_point</c>, and [F02-R40] forbids an adapter
/// reimplementing a pipeline stage in so many words. The adapter emits a CanonicalSeries carrying
/// the ResourceObject verbatim, and the pipeline turns it into a quarantine row.
/// </para>
/// <para>
/// <b>Check order, and why the header comes first.</b> The receiver and sender are checked before
/// the DocumentType branch. A document addressed to somebody else is not ours to recognise, and
/// [DEC-25]'s recognise-and-close for A12 would otherwise answer 200 and mark a misrouted
/// document PROCESSED. PvnedDocumentTypeTests asserts exactly that.
/// </para>
/// </remarks>
public sealed class PvnedIngestionAdapter : IBrpIngestionAdapter
{
    /// <summary>
    /// Matches <c>metering.brp.adapter_key</c> for the seeded PVNED row exactly. Migration 9
    /// writes this literal; PvnedRegistrationTests pins both ends of the agreement.
    /// </summary>
    public const string Key = "PVNED_TIMESERIES_XML_V2P0";

    private const string AllocationDocumentType = "A23";
    private const string ImbalanceDocumentType = "A12";

    /// <summary>
    /// A05 is metered-data aggregation and A16 is realised; integration-spec section 1's table
    /// names both against A23. Any other ProcessType on an A23 is not a handled combination.
    /// </summary>
    private static readonly string[] AllocationProcessTypes = ["A05", "A16"];

    private readonly IMarketCalendar _calendar;
    private readonly PvnedAdapterOptions _options;
    private readonly ILogger<PvnedIngestionAdapter> _logger;

    public PvnedIngestionAdapter(
        IMarketCalendar calendar,
        PvnedAdapterOptions options,
        ILogger<PvnedIngestionAdapter> logger)
    {
        _calendar = calendar;
        _options = options;
        _logger = logger;
    }

    public string AdapterKey => Key;

    public BrpParseOutcome Parse(BrpParseRequest request)
    {
        var read = PvnedXmlReader.ReadTimeSeriesDocument(request.Payload, PvnedSchema.Schemas);
        if (read.Document is null)
        {
            return BrpParseOutcome.Rejected(read.FailureCode!, read.FailureDetail!);
        }

        var document = read.Document;

        var documentId = Text(document, "DocumentIdentification");
        var createdText = Text(document, "CreatedDateTime");
        var documentType = Text(document, "DocumentType");
        var processType = Text(document, "ProcessType");
        var sender = Text(document, "SenderIdentification");
        var receiver = Text(document, "ReceiverIdentification");

        // The XSD makes CreatedDateTime an xs:dateTime, so a document that reaches here always
        // parses. The guard is here because "the schema guarantees it" is a claim that survives
        // exactly until somebody relaxes the schema.
        if (!DateTimeOffset.TryParse(
                createdText,
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out var documentCreated))
        {
            return BrpParseOutcome.Rejected(
                PvnedFailureCodes.SchemaValidationFailed,
                $"CreatedDateTime '{createdText}' is not a readable timestamp.");
        }

        // Integration-spec 8.2 rule 2. Before the DocumentType branch, deliberately.
        if (!string.Equals(receiver, _options.ReceiverGln, StringComparison.Ordinal))
        {
            return BrpParseOutcome.Rejected(
                PvnedFailureCodes.WrongReceiver,
                $"The document is addressed to ReceiverIdentification '{receiver}', and this "
                + $"platform's own GLN is '{_options.ReceiverGln}'.");
        }

        // Integration-spec 8.2 rule 3. The expected sender is per-BRP reference data [DEC-69].
        if (!string.Equals(sender, _options.SenderGln, StringComparison.Ordinal))
        {
            return BrpParseOutcome.Rejected(
                PvnedFailureCodes.UnknownSender,
                $"The document declares SenderIdentification '{sender}', and the GLN configured "
                + $"for this BRP is '{_options.SenderGln}'.");
        }

        // Integration-spec 8.2 rule 1, and [DEC-25]'s A12 branch.
        if (string.Equals(documentType, ImbalanceDocumentType, StringComparison.Ordinal))
        {
            _logger.LogInformation(
                "PVNed imbalance document {DocumentId} recognised and closed with no readings; "
                + "[DEC-25] puts imbalance out of scope. Correlation {CorrelationId}.",
                documentId,
                request.CorrelationId);

            return BrpParseOutcome.RecognisedAndClosed(
                new BrpDocument(documentId, documentCreated, BrpDocumentKind.Imbalance, []));
        }

        if (!string.Equals(documentType, AllocationDocumentType, StringComparison.Ordinal)
            || !AllocationProcessTypes.Contains(processType, StringComparer.Ordinal))
        {
            return BrpParseOutcome.Rejected(
                PvnedFailureCodes.UnsupportedDocumentType,
                $"DocumentType '{documentType}' with ProcessType '{processType}' is not a "
                + "combination this adapter handles. It handles A23 with A05 or A16, and "
                + "recognises A12 with any ProcessType.");
        }

        _logger.LogDebug(
            "PVNed allocation document {DocumentId} received {ReceivedAt}; today in Amsterdam is "
            + "{TodayInAmsterdam}. Correlation {CorrelationId}.",
            documentId,
            request.ReceivedAt,
            _calendar.TodayInAmsterdam,
            request.CorrelationId);

        // Task 7 replaces this whole return with ParseAllocation, which walks the document's
        // TimeSeries and builds the CanonicalSeries list. Until then an A23 that reaches here is
        // accepted carrying nothing, which no test asserts and no caller relies on.
        // NOT task 8: task 8 adds UNSUPPORTED_DIRECTION to a parser task 7 has already written,
        // and an implementer who stops after it has an adapter that rejects A03 and returns no
        // readings for anything else.
        return BrpParseOutcome.Accepted(
            new BrpDocument(documentId, documentCreated, BrpDocumentKind.Allocation, []));
    }

    private static string Text(XElement parent, string localName) =>
        parent.Element(XName.Get(localName, SchemaProvenance.TargetNamespace))?.Value.Trim()
        ?? string.Empty;
}
```

- [ ] **Step 7: Run the test and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDocumentTypeTests"
```
Expected: PASS — 11 passed, 0 failed.

- [ ] **Step 8: Mutation — prove the receiver check really precedes the A12 branch**

Temporarily move the A12 branch above the receiver check, exactly as a reasonable implementer
following integration-spec §8.2's own row order would write it: cut the
`if (string.Equals(documentType, ImbalanceDocumentType, ...))` block and paste it immediately
after the `DateTimeOffset.TryParse` guard.

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDocumentTypeTests"`
Expected: FAIL — exactly one test,
`A_misrouted_A12_is_rejected_rather_than_recognised_and_closed`, with
`outcome.Status should be Rejected but was RecognisedAndClosed`. Every other test stays green,
including `A_wrong_receiver_is_WRONG_RECEIVER` — because that fixture is an A23 and the reordering
does not touch it. **That is the whole reason `invalid-wrong-receiver-a12.xml` exists as a
separate file**: the A23 fixture cannot see this bug.

Then restore the original order.

- [ ] **Step 9: Mutation — prove the sender GLN comes from configuration**

Temporarily hard-code the comparison, which is what "there is only one BRP anyway" produces:

```csharp
        if (!string.Equals(sender, "8714252005776", StringComparison.Ordinal))
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDocumentTypeTests"`
Expected: FAIL — exactly one test,
`The_expected_sender_comes_from_configuration_not_from_a_constant`, with
`outcome.FailureCode should not be "UNKNOWN_SENDER" but was "UNKNOWN_SENDER"`.
`An_unknown_sender_is_UNKNOWN_SENDER` stays green, which is the point: the happy-path assertion
cannot tell a configured value from a constant, and `[DEC-69]` makes the difference the whole
seam.

Then restore `_options.SenderGln`.

- [ ] **Step 10: Mutation — prove the A12 carries no series**

Temporarily give the closed A12 a series list that is not empty:

```csharp
            return BrpParseOutcome.RecognisedAndClosed(
                new BrpDocument(
                    documentId,
                    documentCreated,
                    BrpDocumentKind.Imbalance,
                    [new CanonicalSeries(
                        "Imbalance", false, null, new DateOnly(2024, 12, 28),
                        IntervalDirection.Production, 96, [])]));
```

(add `using PeakPower.Domain.Metering;` so it compiles).

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDocumentTypeTests"`
Expected: FAIL — `An_A12_imbalance_document_is_recognised_and_closed_with_no_series_at_all` fails
with `outcome.Document.Series.Count should be 0 but was 1`, carrying the
`[DEC-25]`/design-§7.13 message. The status assertion in the same test stays satisfied, which is
why the count is asserted separately: *recognised and closed* is not the same claim as *zero
readings written*, and design §7.13 asks for the second.

Then restore the empty list and remove the `using`.

- [ ] **Step 11: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Integration.Brp.Pvned \
        tests/PeakPower.Application.Tests/Ingestion/Pvned
git commit -m "pvned: the document header, and A23 processed / A12 closed / rest rejected

Shared contract 8.2's first three rows plus [DEC-25]'s A12 branch: an imbalance document is
recognised, stored and closed with ZERO series, which design 7.13 asserts as a count rather than
as a status.

The receiver and sender checks run BEFORE the DocumentType branch, and that ordering is
load-bearing rather than stylistic: a misrouted A12 would otherwise be recognised and closed
successfully - a 200, a PROCESSED message and a stored payload addressed to somebody else.

Verified by mutation: moving the A12 branch above the receiver check reddens only the A12
misrouting fixture (the A23 one cannot see it, which is why both exist); hard-coding the sender
GLN reddens only the configuration assertion; and returning a non-empty series from the closed
A12 reddens the count while the status stays green."
```

---

### Task 7: The happy path — the golden A23, and `A01` → PRODUCTION / `A02` → CONSUMPTION

Shared contract §8.2: *"`A01` is PRODUCTION and `A02` is CONSUMPTION. Under `[DEC-22]` a mis-mapped
direction produces a wrong invoice, not a wrong chart."* Design §3.1 says the same in bolder type:
**direction decoding is a financial control, not a display concern.** This task builds the whole
accepting path — series loop, delivery date, points, canonical series — and the direction mapping
is the assertion that matters.

⚠ **Note the trap the contract names.** `BusinessType` `A01` also means production and `A04` means
consumption, on a **different** field. The golden fixture carries `BusinessType` `A04` on the
**consumption** series and `A01` on the **production** one precisely so that an implementer who
reads the wrong field gets both directions backwards and the test says so.

**Files:**
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/golden-a23-both-directions-96.xml`
- Modify: `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedIngestionAdapter.cs` — replace
  the `// Task 8 replaces the empty list…` return with a call to `ParseAllocation`, and add the
  three private members below it
- Test: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedDirectionTests.cs`

**Interfaces:**
- Consumes: `CanonicalSeries`, `CanonicalPoint` (plan 3); `IntervalDirection` (plan 2);
  `EanCode` (slice 1, `PeakPower.Domain.Common`); `IMarketCalendar.ExpectedIntervalCount`
  (plan 1); `PvnedAdapterHarness` (Task 6).
- Produces: `PvnedIngestionAdapter.ParseAllocation`, `.ParseSeries` and the private record
  `SeriesOutcome` — all private, so no later plan names them. Tasks 8–13 extend `ParseSeries`.

- [ ] **Step 1: Write the golden A23 fixture**

**Hand-written. Copy it literally — all one hundred and ninety-two points.** The shape is a
factory day: four identical quarter-hour values per hour, so a reader can check the arithmetic by
eye. Consumption totals **10 736,000 kWh** and production **1 492,000 kWh**; no interval has
production above consumption, which keeps both stored series non-negative as `[AS-05]` requires.

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/golden-a23-both-directions-96.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     A normal 96-interval allocation day for one producing EAN: A02 consumption and A01
     production, delivery date 2026-08-12 (August, so Amsterdam is CEST and local midnight is
     22:00Z the day before).

     Note BusinessType: A04 on the CONSUMPTION series and A01 on the PRODUCTION one. The two
     code lists are not the same list, and an implementer who reads BusinessType instead of
     Direction gets both series backwards - which under [DEC-22] is a wrong invoice, not a
     wrong chart.

     Consumption totals 10736.000 kWh; production totals 1492.000 kWh. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>5c7e9a1b-3d5f-4a7c-9e1b-3d5f7a9c1e41</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>

      <TimeSeries>
        <mRID>7a9c1e3b-5d7f-4c9a-1e3b-5d7f9a1c3e43</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
          <RecourceName>Realisation</RecourceName>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>5</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>6</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>7</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>8</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>9</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>10</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>11</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>12</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>13</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>14</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>15</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>16</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>17</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>18</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>19</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>20</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>21</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>22</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>23</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>24</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>25</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>26</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>27</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>28</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>29</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>30</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>31</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>32</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>33</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>34</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>35</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>36</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>37</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>38</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>39</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>40</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>41</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>42</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>43</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>44</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>45</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>46</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>47</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>48</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>49</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>50</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>51</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>52</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>53</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>54</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>55</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>56</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>57</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>58</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>59</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>60</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>61</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>62</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>63</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>64</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>65</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>66</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>67</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>68</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>69</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>70</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>71</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>72</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>73</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>74</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>75</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>76</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>77</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>78</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>79</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>80</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>81</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>82</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>83</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>84</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>85</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>86</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>87</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>88</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>89</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>90</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>91</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>92</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>93</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>94</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>95</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>96</Pos><Qty>42.000</Qty></Point>
        </Period>
      </TimeSeries>

      <TimeSeries>
        <mRID>9c1e3b5d-7f9a-4e1c-3b5d-7f9a1c3e5b45</mRID>
        <BusinessType>A01</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A01</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
          <RecourceName>Realisation</RecourceName>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>5</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>6</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>7</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>8</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>9</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>10</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>11</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>12</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>13</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>14</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>15</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>16</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>17</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>18</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>19</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>20</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>21</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>22</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>23</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>24</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>25</Pos><Qty>2.000</Qty></Point>
          <Point><Pos>26</Pos><Qty>2.000</Qty></Point>
          <Point><Pos>27</Pos><Qty>2.000</Qty></Point>
          <Point><Pos>28</Pos><Qty>2.000</Qty></Point>
          <Point><Pos>29</Pos><Qty>8.000</Qty></Point>
          <Point><Pos>30</Pos><Qty>8.000</Qty></Point>
          <Point><Pos>31</Pos><Qty>8.000</Qty></Point>
          <Point><Pos>32</Pos><Qty>8.000</Qty></Point>
          <Point><Pos>33</Pos><Qty>18.000</Qty></Point>
          <Point><Pos>34</Pos><Qty>18.000</Qty></Point>
          <Point><Pos>35</Pos><Qty>18.000</Qty></Point>
          <Point><Pos>36</Pos><Qty>18.000</Qty></Point>
          <Point><Pos>37</Pos><Qty>30.000</Qty></Point>
          <Point><Pos>38</Pos><Qty>30.000</Qty></Point>
          <Point><Pos>39</Pos><Qty>30.000</Qty></Point>
          <Point><Pos>40</Pos><Qty>30.000</Qty></Point>
          <Point><Pos>41</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>42</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>43</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>44</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>45</Pos><Qty>50.000</Qty></Point>
          <Point><Pos>46</Pos><Qty>50.000</Qty></Point>
          <Point><Pos>47</Pos><Qty>50.000</Qty></Point>
          <Point><Pos>48</Pos><Qty>50.000</Qty></Point>
          <Point><Pos>49</Pos><Qty>54.000</Qty></Point>
          <Point><Pos>50</Pos><Qty>54.000</Qty></Point>
          <Point><Pos>51</Pos><Qty>54.000</Qty></Point>
          <Point><Pos>52</Pos><Qty>54.000</Qty></Point>
          <Point><Pos>53</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>54</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>55</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>56</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>57</Pos><Qty>44.000</Qty></Point>
          <Point><Pos>58</Pos><Qty>44.000</Qty></Point>
          <Point><Pos>59</Pos><Qty>44.000</Qty></Point>
          <Point><Pos>60</Pos><Qty>44.000</Qty></Point>
          <Point><Pos>61</Pos><Qty>34.000</Qty></Point>
          <Point><Pos>62</Pos><Qty>34.000</Qty></Point>
          <Point><Pos>63</Pos><Qty>34.000</Qty></Point>
          <Point><Pos>64</Pos><Qty>34.000</Qty></Point>
          <Point><Pos>65</Pos><Qty>22.000</Qty></Point>
          <Point><Pos>66</Pos><Qty>22.000</Qty></Point>
          <Point><Pos>67</Pos><Qty>22.000</Qty></Point>
          <Point><Pos>68</Pos><Qty>22.000</Qty></Point>
          <Point><Pos>69</Pos><Qty>12.000</Qty></Point>
          <Point><Pos>70</Pos><Qty>12.000</Qty></Point>
          <Point><Pos>71</Pos><Qty>12.000</Qty></Point>
          <Point><Pos>72</Pos><Qty>12.000</Qty></Point>
          <Point><Pos>73</Pos><Qty>4.000</Qty></Point>
          <Point><Pos>74</Pos><Qty>4.000</Qty></Point>
          <Point><Pos>75</Pos><Qty>4.000</Qty></Point>
          <Point><Pos>76</Pos><Qty>4.000</Qty></Point>
          <Point><Pos>77</Pos><Qty>1.000</Qty></Point>
          <Point><Pos>78</Pos><Qty>1.000</Qty></Point>
          <Point><Pos>79</Pos><Qty>1.000</Qty></Point>
          <Point><Pos>80</Pos><Qty>1.000</Qty></Point>
          <Point><Pos>81</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>82</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>83</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>84</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>85</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>86</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>87</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>88</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>89</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>90</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>91</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>92</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>93</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>94</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>95</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>96</Pos><Qty>0.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

- [ ] **Step 2: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedDirectionTests.cs`:

```csharp
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Domain.Metering;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// Shared contract section 8.2: A01 is PRODUCTION and A02 is CONSUMPTION.
/// </summary>
/// <remarks>
/// <b>This is a financial control, not a display concern.</b> [DEC-22] makes the volume basis
/// net usage = consumption - production, so A01 mapped as consumption produces a wrong invoice
/// rather than a wrong chart. The golden fixture carries BusinessType A04 on the consumption
/// series and A01 on the production one, because BusinessType is a different code list that
/// happens to use the same letters, and an implementer who reads it gets both backwards.
/// </remarks>
public sealed class PvnedDirectionTests
{
    private static BrpDocument Golden()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a23-both-directions-96.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Accepted, outcome.FailureDetail);
        outcome.Document.ShouldNotBeNull();
        return outcome.Document;
    }

    [Fact]
    public void The_golden_allocation_document_is_accepted_as_an_allocation()
    {
        var document = Golden();

        document.Kind.ShouldBe(BrpDocumentKind.Allocation);
        document.DocumentId.ShouldBe("5c7e9a1b-3d5f-4a7c-9e1b-3d5f7a9c1e41");
        document.DocumentCreated
            .ShouldBe(new DateTimeOffset(2026, 8, 13, 4, 2, 11, TimeSpan.Zero));
    }

    [Fact]
    public void Both_series_come_back_in_document_order()
    {
        Golden().Series.Count.ShouldBe(2);
    }

    [Fact]
    public void A02_is_CONSUMPTION()
    {
        Golden().Series[0].Direction.ShouldBe(
            IntervalDirection.Consumption,
            "integration-spec section 4.1: A02 is consumption. Under [DEC-22] getting this "
            + "backwards is a wrong invoice");
    }

    [Fact]
    public void A01_is_PRODUCTION()
    {
        Golden().Series[1].Direction.ShouldBe(
            IntervalDirection.Production,
            "integration-spec section 4.1: A01 is production. Under [DEC-22] getting this "
            + "backwards is a wrong invoice");
    }

    [Fact]
    public void The_consumption_series_is_the_one_whose_quantities_are_the_consumption_shape()
    {
        // Belt and braces on the mapping: the direction label and the numbers must agree, so
        // that swapping the two mappings is caught even if somebody also swaps the series order.
        var consumption = Golden().Series.Single(
            series => series.Direction == IntervalDirection.Consumption);

        consumption.Points.Sum(point => point.QuantityKwh).ShouldBe(10736.000m);
        consumption.Points[0].QuantityKwh.ShouldBe(40.000m);
    }

    [Fact]
    public void The_production_series_is_the_one_whose_quantities_are_the_solar_shape()
    {
        var production = Golden().Series.Single(
            series => series.Direction == IntervalDirection.Production);

        production.Points.Sum(point => point.QuantityKwh).ShouldBe(1492.000m);
        production.Points[0].QuantityKwh.ShouldBe(0.000m);
        production.Points[48].QuantityKwh.ShouldBe(54.000m);   // Pos 49, the midday peak
    }

    [Fact]
    public void Both_series_carry_ninety_six_points_in_position_order()
    {
        foreach (var series in Golden().Series)
        {
            series.Points.Count.ShouldBe(96);
            series.Points.Select(point => point.Pos).ShouldBe(Enumerable.Range(1, 96));
        }
    }

    [Fact]
    public void The_delivery_date_is_the_Amsterdam_date_of_MeasurementPeriodes_start()
    {
        // 2026-08-11T22:00:00Z is midnight on 12 August in Amsterdam, which is CEST in August.
        // Conversion is always via the local calendar, never by adding a fixed offset
        // (integration-spec section 5).
        foreach (var series in Golden().Series)
        {
            series.DeliveryDate.ShouldBe(new DateOnly(2026, 8, 12));
        }
    }

    [Fact]
    public void The_expected_interval_count_comes_from_the_calendar_and_is_ninety_six()
    {
        foreach (var series in Golden().Series)
        {
            series.ExpectedIntervalCount.ShouldBe(96);
        }
    }

    [Fact]
    public void The_eighteen_digit_ResourceObject_is_carried_verbatim_and_parsed_as_an_EAN()
    {
        foreach (var series in Golden().Series)
        {
            series.ResourceObject.ShouldBe("871685900000000001");
            series.ResourceObjectIsEan.ShouldBeTrue();
            series.Ean.ShouldNotBeNull();
            series.Ean.Value.Value.ShouldBe("871685900000000001");
        }
    }

    [Fact]
    public void Every_quantity_is_non_negative_because_the_two_series_stay_separate()
    {
        // [AS-05] and position-and-coverage section 2.1: consumption and production remain two
        // separate, non-negative series. netUsage is derived per interval and is never stored as
        // a signed source series - that is the pipeline's job, not this adapter's.
        foreach (var series in Golden().Series)
        {
            series.Points.ShouldAllBe(point => point.QuantityKwh >= 0m);
        }
    }
}
```

- [ ] **Step 3: Run it and watch it fail**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDirectionTests"
```
Expected: FAIL — every test fails. `Both_series_come_back_in_document_order` reports
`document.Series.Count should be 2 but was 0`, because Task 6's adapter returns an accepted
document carrying an empty series list. The remaining tests fail on the empty collection.

- [ ] **Step 4: Replace the empty-series return with the real one**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedIngestionAdapter.cs`,
replace these nine lines at the end of `Parse`:

```csharp
        // Task 7 replaces this whole return with ParseAllocation, which walks the document's
        // TimeSeries and builds the CanonicalSeries list. Until then an A23 that reaches here is
        // accepted carrying nothing, which no test asserts and no caller relies on.
        // NOT task 8: task 8 adds UNSUPPORTED_DIRECTION to a parser task 7 has already written,
        // and an implementer who stops after it has an adapter that rejects A03 and returns no
        // readings for anything else.
        return BrpParseOutcome.Accepted(
            new BrpDocument(documentId, documentCreated, BrpDocumentKind.Allocation, []));
    }
```

with:

```csharp
        return ParseAllocation(document, documentId, documentCreated);
    }

    /// <summary>
    /// Walks the document's TimeSeries in order. <b>Rejection is total</b>: the first series
    /// that fails a rule rejects the whole document, because [F02-R13] says a document lands
    /// whole or not at all.
    /// </summary>
    private BrpParseOutcome ParseAllocation(
        XElement document,
        string documentId,
        DateTimeOffset documentCreated)
    {
        var series = new List<CanonicalSeries>();
        var index = 0;

        foreach (var element in document.Elements(TimeSeriesName))
        {
            index++;
            var outcome = ParseSeries(element, index);
            if (outcome.Failure is not null)
            {
                return outcome.Failure;
            }

            series.Add(outcome.Series!);
        }

        return BrpParseOutcome.Accepted(
            new BrpDocument(documentId, documentCreated, BrpDocumentKind.Allocation, series));
    }

    private SeriesOutcome ParseSeries(XElement series, int index)
    {
        var directionCode = Text(series, "Direction");
        var direction = directionCode switch
        {
            ProductionDirectionCode => IntervalDirection.Production,
            ConsumptionDirectionCode => IntervalDirection.Consumption,
            _ => default(IntervalDirection?),
        };

        var measurementPeriode = series.Element(MeasurementPeriodeName);
        var startText = measurementPeriode?.Element(StartPeriodName)?.Value ?? string.Empty;

        if (!DateTimeOffset.TryParse(
                startText,
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out var periodStart))
        {
            return SeriesOutcome.Rejected(
                PvnedFailureCodes.InvalidMeasurementPeriod,
                $"TimeSeries {index.ToString(CultureInfo.InvariantCulture)} carries "
                + $"MeasurementPeriode.StartPeriod '{startText}', which is not a readable "
                + "timestamp.");
        }

        // Integration-spec section 5: "Conversion is always via the local calendar, never by
        // adding a fixed offset." Reading a named time zone is not reading the clock, so
        // architecture fact 5 is untouched; the DST mapping itself stays in IMarketCalendar,
        // which is the one place parser, rollup and chart all read.
        var deliveryDate = AmsterdamDateOf(periodStart);
        var expectedIntervalCount = _calendar.ExpectedIntervalCount(deliveryDate);

        var resourceObject = Text(
            series.Element(ResourceName) ?? new XElement(ResourceName), "ResourceObject");
        var ean = EanCode.Create(resourceObject);

        var points = new List<CanonicalPoint>();
        foreach (var period in series.Elements(PeriodName))
        {
            foreach (var point in period.Elements(PointName))
            {
                var posText = point.Element(PosName)?.Value;
                var quantityText = point.Element(QtyName)?.Value;

                // A Point with no readable Qty does not quantify its position, so it does not
                // count toward the period. The point-count rule is what catches it, which keeps
                // the frozen code set from needing a sixteenth member.
                if (!int.TryParse(
                        posText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var pos)
                    || !decimal.TryParse(
                        quantityText, NumberStyles.Float, CultureInfo.InvariantCulture,
                        out var quantity))
                {
                    continue;
                }

                points.Add(new CanonicalPoint(pos, quantity));
            }
        }

        return SeriesOutcome.Parsed(new CanonicalSeries(
            ResourceObject: resourceObject,
            ResourceObjectIsEan: ean.IsSuccess,
            Ean: ean.IsSuccess ? ean.Value : null,
            DeliveryDate: deliveryDate,
            Direction: direction ?? IntervalDirection.Consumption,
            ExpectedIntervalCount: expectedIntervalCount,
            Points: points));
    }

    private static DateOnly AmsterdamDateOf(DateTimeOffset instant) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, Amsterdam).DateTime);

    /// <summary>One series, or the rejection that stops the whole document.</summary>
    private sealed record SeriesOutcome(CanonicalSeries? Series, BrpParseOutcome? Failure)
    {
        public static SeriesOutcome Parsed(CanonicalSeries series) => new(series, null);

        public static SeriesOutcome Rejected(string failureCode, string failureDetail) =>
            new(null, BrpParseOutcome.Rejected(failureCode, failureDetail));
    }
```

Then add these members to the top of the class, immediately after the
`private static readonly string[] AllocationProcessTypes = ["A05", "A16"];` line:

```csharp
    private const string ProductionDirectionCode = "A01";
    private const string ConsumptionDirectionCode = "A02";

    /// <summary>
    /// Europe/Amsterdam. .NET resolves IANA identifiers on every supported platform through
    /// ICU. This is a time-zone lookup, not a clock read, so architecture fact 5 - which bans
    /// DateTime.Now, DateTime.UtcNow, DateTimeOffset.Now, DateTimeOffset.UtcNow and
    /// DateTime.Today outside PeakPower.Infrastructure.Time - is not engaged by it.
    /// </summary>
    private static readonly TimeZoneInfo Amsterdam =
        TimeZoneInfo.FindSystemTimeZoneById("Europe/Amsterdam");

    private static readonly XName TimeSeriesName = Pvned("TimeSeries");
    private static readonly XName MeasurementPeriodeName = Pvned("MeasurementPeriode");
    private static readonly XName StartPeriodName = Pvned("StartPeriod");
    private static readonly XName EndPeriodName = Pvned("EndPeriod");
    private static readonly XName ResourceName = Pvned("Resource");
    private static readonly XName PeriodName = Pvned("Period");
    private static readonly XName PointName = Pvned("Point");
    private static readonly XName PosName = Pvned("Pos");
    private static readonly XName QtyName = Pvned("Qty");
    private static readonly XName TimeIntervalName = Pvned("TimeInterval");

    private static XName Pvned(string localName) =>
        XName.Get(localName, SchemaProvenance.TargetNamespace);
```

Finally add the two `using` directives the new code needs, at the top of the file:

```csharp
using PeakPower.Domain.Common;
using PeakPower.Domain.Metering;
```

⚠ `EndPeriodName` and `TimeIntervalName` are declared here and first used in Task 10. If
`-warnaserror` objects to an unused private field before then (CA1823), add them in Task 10
instead — but check first: at the time of writing, the analyzer set in `Directory.Build.props`
does not fail on this, because `PvnedIngestionAdapter` uses `Pvned(...)` for both and a
`static readonly` field initialised by a method call is not what CA1823 detects.

- [ ] **Step 5: Run the test and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDirectionTests"
```
Expected: PASS — 11 passed, 0 failed.

- [ ] **Step 6: Mutation — swap the direction mapping, which is the wrong invoice**

Temporarily invert the two arms:

```csharp
        var direction = directionCode switch
        {
            ProductionDirectionCode => IntervalDirection.Consumption,
            ConsumptionDirectionCode => IntervalDirection.Production,
            _ => default(IntervalDirection?),
        };
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDirectionTests"`
Expected: FAIL — four tests. `A02_is_CONSUMPTION` reports
`Series[0].Direction should be Consumption but was Production`; `A01_is_PRODUCTION` reports the
mirror; and **both quantity-shape tests fail too** —
`The_consumption_series_is_the_one_whose_quantities_are_the_consumption_shape` reports
`should be 10736.000 but was 1492.000`. That pair is the belt-and-braces: it catches the swap even
if somebody "fixes" the label tests by also reordering the series.

Then restore the correct mapping.

- [ ] **Step 7: Mutation — read `BusinessType` instead of `Direction`**

This is the mistake the contract warns about, written out:

```csharp
        var directionCode = Text(series, "BusinessType");
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDirectionTests"`
Expected: FAIL — the golden's consumption series carries `BusinessType` `A04`, which matches
neither arm, so `direction` is null and falls back to `Consumption`; its production series carries
`A01`, which maps to `Production`. `A02_is_CONSUMPTION` and `A01_is_PRODUCTION` **both still
pass**, and `The_consumption_series_is_the_one_whose_quantities_are_the_consumption_shape` also
passes. Nothing goes red.

⚠ **That is a real gap, and Task 8 closes it**: once `UNSUPPORTED_DIRECTION` rejects a code that
maps to neither arm, this mutation rejects the golden document outright and eleven tests go red.
Record the result of this step as *"no failure yet — closed by Task 8"*, re-run this exact
mutation at the end of Task 8, and only then treat the direction mapping as mutation-verified.
Do not skip the re-run: the fall-back-to-Consumption arm is exactly the kind of default that makes
a mis-read field invisible.

Then restore `Text(series, "Direction")`.

- [ ] **Step 8: Mutation — add a fixed offset instead of converting through the calendar**

Temporarily replace the delivery-date derivation with the "it is summer, so +2" shortcut:

```csharp
    private static DateOnly AmsterdamDateOf(DateTimeOffset instant) =>
        DateOnly.FromDateTime(instant.UtcDateTime.AddHours(2));
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDirectionTests"`
Expected: PASS — all eleven still pass, because 2026-08-11T22:00:00Z plus two hours is midnight on
the twelfth and August really is +2.

⚠ **That is the point.** A fixed offset is indistinguishable from the calendar on every summer
day, and integration-spec §5's *"conversion is always via the local calendar, never by adding a
fixed offset"* exists for the other seven months. Task 12's DST tests are what redden this
mutation; re-run it there. Record this step's result as *"no failure yet — closed by Task 12"*.

Then restore `TimeZoneInfo.ConvertTime`.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedIngestionAdapter.cs \
        tests/PeakPower.Application.Tests/Ingestion/Pvned
git commit -m "pvned: the accepting path, and A01 is production while A02 is consumption

The golden A23 is hand-written: 96 consumption and 96 production points for one EAN on
2026-08-12, totalling 10736.000 and 1492.000 kWh. It carries BusinessType A04 on the consumption
series and A01 on the production one on purpose - the two code lists are not the same list, and
under [DEC-22] reading the wrong field is a wrong invoice rather than a wrong chart.

Verified by mutation: inverting the two direction arms reddens four tests, including both
quantity-shape assertions, which is what catches a swap that also reorders the series.

Two mutations deliberately do NOT redden yet and are re-run later: reading BusinessType instead of
Direction (closed by task 8's UNSUPPORTED_DIRECTION) and adding a fixed two-hour offset instead of
converting through the Amsterdam calendar (closed by task 12's DST fixtures). Both are recorded
here so the gap is visible rather than assumed away."
```

---

### Task 8: `UNSUPPORTED_DIRECTION` — A03 and A04, and the default that hid a mis-read field

Integration-spec §4.1: `A03` is combined production and consumption, rejected because the platform
requires separated series `[AS-05]`; `A04` is "not used yet", rejected. §8.2 has **no row** for
either, which is why shared contract §16 item 4 decides the code
`UNSUPPORTED_DIRECTION`.

This task also closes the gap Task 7 step 7 recorded: until a direction that maps to neither arm
is a rejection, `direction ?? IntervalDirection.Consumption` silently absorbs a mis-read field.

**Files:**
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-unsupported-direction.xml`
- Modify: `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedIngestionAdapter.cs` —
  add a guard after the `direction` switch and drop the `?? IntervalDirection.Consumption` default
- Test: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedDirectionTests.cs` (append)

**Interfaces:**
- Consumes: `PvnedFailureCodes.UnsupportedDirection` (Task 2), `SeriesOutcome.Rejected` (Task 7).
- Produces: nothing new; `ParseSeries` gains a guard.

- [ ] **Step 1: Write the fixture**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-unsupported-direction.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     Direction A03 is combined production and consumption. Integration-spec 4.1 rejects it
     because the platform requires separated series [AS-05]: netUsage is derived per interval
     from two non-negative series, and a combined figure cannot be decomposed back into them.
     Integration-spec 8.2 has no row for this, so the code is the shared contract's own
     UNSUPPORTED_DIRECTION (16.4). -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>2e4a6c8e-0b2d-4f6a-8c0e-2a4c6e8a0c51</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>4c6e8a0c-2d4f-4a6c-8e0a-2c4e6a8c0e53</mRID>
        <BusinessType>A07</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A03</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>40.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

- [ ] **Step 2: Write the failing test**

Append these four facts to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedDirectionTests.cs`,
immediately before the closing brace of the class. Add
`using PeakPower.Integration.Brp.Pvned;` to the file's usings.

```csharp
    [Fact]
    public void A03_combined_production_and_consumption_is_UNSUPPORTED_DIRECTION()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-unsupported-direction.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.FailureCode.ShouldBe(
            PvnedFailureCodes.UnsupportedDirection,
            "[AS-05] keeps consumption and production as two separate non-negative series, and a "
            + "combined figure cannot be decomposed back into them");
        outcome.Document.ShouldBeNull();
    }

    [Fact]
    public void The_unsupported_direction_detail_names_the_code_and_the_series()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-unsupported-direction.xml");

        outcome.FailureDetail.ShouldNotBeNull();
        outcome.FailureDetail.ShouldContain("A03", Case.Sensitive);
        outcome.FailureDetail.ShouldContain("A01", Case.Sensitive);
        outcome.FailureDetail.ShouldContain("A02", Case.Sensitive);
    }

    [Fact]
    public void A_series_with_no_Direction_at_all_is_UNSUPPORTED_DIRECTION_not_a_default()
    {
        // The reconstructed XSD makes Direction optional, because the imbalance sample's price
        // series carry none. On an A23 allocation an absent Direction is not a consumption
        // series by default: under [DEC-22] a default here is a wrong invoice, quietly.
        var withoutDirection = PvnedFixtures.Text("invalid-unsupported-direction.xml")
            .Replace("<Direction>A03</Direction>", string.Empty, StringComparison.Ordinal);

        var outcome = PvnedAdapterHarness.Create().Parse(new BrpParseRequest(
            InboundMessageId: Guid.CreateVersion7(),
            BrpId: PvnedAdapterHarness.PvnedBrpId,
            BrpCode: "PVNED",
            CorrelationId: Guid.CreateVersion7(),
            Payload: System.Text.Encoding.UTF8.GetBytes(withoutDirection),
            ReceivedAt: PvnedAdapterHarness.DefaultNow));

        outcome.FailureCode.ShouldBe(PvnedFailureCodes.UnsupportedDirection);
    }

    [Fact]
    public void Reading_BusinessType_instead_of_Direction_can_no_longer_pass_unnoticed()
    {
        // The golden fixture's consumption series carries BusinessType A04, which maps to
        // neither direction arm. Once an unmappable code is a rejection rather than a default,
        // an adapter that read the wrong field rejects the golden document instead of quietly
        // mislabelling it. This test states the property; task 8 step 6 mutates for it.
        var outcome = PvnedAdapterHarness.Parse("golden-a23-both-directions-96.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Accepted, outcome.FailureDetail);
        outcome.Document.ShouldNotBeNull();
        outcome.Document.Series
            .Select(series => series.Direction)
            .ShouldBe([IntervalDirection.Consumption, IntervalDirection.Production]);
    }
```

- [ ] **Step 3: Run it and watch it fail**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDirectionTests"
```
Expected: FAIL — `A03_combined_production_and_consumption_is_UNSUPPORTED_DIRECTION` reports
`outcome.Status should be Rejected but was Accepted`, and
`A_series_with_no_Direction_at_all_is_UNSUPPORTED_DIRECTION_not_a_default` reports
`outcome.FailureCode should be "UNSUPPORTED_DIRECTION" but was null`. Task 7's
`?? IntervalDirection.Consumption` is what makes both accept.

- [ ] **Step 4: Add the guard and drop the default**

In `PvnedIngestionAdapter.ParseSeries`, immediately after the `direction` switch expression, insert:

```csharp
        if (direction is null)
        {
            return SeriesOutcome.Rejected(
                PvnedFailureCodes.UnsupportedDirection,
                $"TimeSeries {index.ToString(CultureInfo.InvariantCulture)} declares Direction "
                + $"'{directionCode}'. This adapter maps A01 to production and A02 to "
                + "consumption; integration-spec section 4.1 rejects A03 because [AS-05] keeps "
                + "the two series separate and non-negative, and A04 because it is not in use.");
        }
```

Then change the `CanonicalSeries` construction at the end of the same method from:

```csharp
            Direction: direction ?? IntervalDirection.Consumption,
```

to:

```csharp
            Direction: direction.Value,
```

- [ ] **Step 5: Run the test and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDirectionTests"
```
Expected: PASS — 15 passed, 0 failed.

- [ ] **Step 6: Mutation — re-run Task 7 step 7's `BusinessType` mutation, which now bites**

Temporarily reintroduce it:

```csharp
        var directionCode = Text(series, "BusinessType");
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDirectionTests"`
Expected: FAIL — **ten** tests now, where Task 7's version of this mutation reddened none. The
golden document's consumption series carries `BusinessType` `A04`, which maps to neither arm and
is now a rejection, so `Reading_BusinessType_instead_of_Direction_can_no_longer_pass_unnoticed`
fails with `outcome.Status should be Accepted but was Rejected`, and every test that reads the
golden document fails with it.

**Record this explicitly**: the direction mapping is mutation-verified as of this step, and it was
not as of Task 7. A default arm is exactly the construct that makes a mis-read field invisible.

Then restore `Text(series, "Direction")`.

- [ ] **Step 7: Mutation — accept A03 as production, the "combined is mostly production" shortcut**

```csharp
        var direction = directionCode switch
        {
            ProductionDirectionCode or "A03" => IntervalDirection.Production,
            ConsumptionDirectionCode => IntervalDirection.Consumption,
            _ => default(IntervalDirection?),
        };
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDirectionTests"`
Expected: FAIL — two tests. `A03_combined_production_and_consumption_is_UNSUPPORTED_DIRECTION`
reports `outcome.Status should be Rejected but was Accepted`, and
`The_unsupported_direction_detail_names_the_code_and_the_series` fails with
`outcome.FailureDetail should not be null`.
`A_series_with_no_Direction_at_all_is_UNSUPPORTED_DIRECTION_not_a_default` stays green, which is
why A03 and "absent" are two tests rather than one.

Then restore the two-arm switch.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedIngestionAdapter.cs \
        tests/PeakPower.Application.Tests/Ingestion/Pvned
git commit -m "pvned: reject A03 and A04, and remove the direction default

Integration-spec 4.1 rejects A03 (combined) because [AS-05] keeps the two series separate and
non-negative, and A04 because it is not in use. Section 8.2 has no row for either, so the code is
the shared contract's own UNSUPPORTED_DIRECTION (16.4).

This also closes the gap task 7 recorded. With 'direction ?? Consumption' in place, reading
BusinessType instead of Direction reddened NOTHING; with the default gone it reddens ten tests,
because the golden's BusinessType A04 now maps to no arm at all. A default is what makes a
mis-read field invisible, and under [DEC-22] that is a wrong invoice.

Verified by mutation: BusinessType-instead-of-Direction (ten red), and mapping A03 to production
(two red, while the absent-Direction case stays green - which is why they are two tests)."
```

---

### Task 9: `MeasurementUnit` — KWH, MWH × 1000, and why KWT and MAW cannot become a `quantity_kwh`

Shared contract §8.2: `KWH` and `MWH` are accepted and converted to kWh; anything else is
`UNSUPPORTED_MEASUREMENT_UNIT`. `SchemaProvenance` row 5 is the reason the unit is read from the
message at all rather than assumed: *"the dependency table specifies `KWH` for allocations … the
sample disagrees"*, so the table is a prediction and the message is the fact.

`KWT` and `MAW` are **powers**, not energies. A kilowatt cannot be stored in a column called
`quantity_kwh` without knowing the interval length and doing arithmetic the sender did not ask
for, and integration-spec §4.3 never says an allocation carries one. Rejecting is the honest
answer; silently multiplying by a quarter of an hour is not.

This task also lands the **spring 92-point** fixture, which carries **MWh** so that the unit
conversion is exercised on a real full-length document rather than on a stub.

**Files:**
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-unsupported-measurement-unit.xml`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/golden-a23-dst-spring-92.xml`
- Modify: `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedIngestionAdapter.cs` — a unit
  guard, a multiplier, and the rounding rule in the point loop
- Test: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedMeasurementUnitTests.cs`

**Interfaces:**
- Consumes: `PvnedFailureCodes.UnsupportedMeasurementUnit` (Task 2), `SeriesOutcome` (Task 7).
- Produces: nothing new; `ParseSeries` gains a guard and the point loop gains the conversion.

- [ ] **Step 1: Write the two fixtures**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-unsupported-measurement-unit.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     MeasurementUnit KWT is a kilowatt: a power, not an energy. Integration-spec 4.3 lists it,
     and the dependency table predicts it for imbalance rather than for allocations. It cannot
     become a quantity_kwh without inventing the interval-length arithmetic the sender did not
     ask for, so the shared contract (16.4) decides UNSUPPORTED_MEASUREMENT_UNIT rather than a
     silent multiply. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>6a8c0e2a-4b6d-4e8a-0c2e-4a6c8e0a2c61</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>8c0e2a4c-6d8f-4a0c-2e4a-6c8e0a2c4e63</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWT</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>160.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>160.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>160.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>160.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/golden-a23-dst-spring-92.xml`.
**Hand-written. All ninety-two points.**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     The spring-forward Sunday, 29 March 2026: local 02:00-03:00 does not exist, so the day has
     23 hours and 92 quarter-hours. MeasurementPeriode runs 2026-03-28T23:00:00Z (local midnight,
     CET, +01:00) to 2026-03-29T22:00:00Z (local midnight the next day, CEST, +02:00) - 23 hours
     of UTC, which is what makes the fixed-offset shortcut wrong.

     The unit is MWH on purpose, so that the section 7.1 conversion to kWh is exercised on a real
     full-length document rather than on a stub. Pos blocks map to local hours
     00, 01, 03, 04, ... 23 - there is no 02.

     Pos 92 carries 0.0420005 MWh rather than 0.042. That is 42.0005 kWh, which sits exactly on
     the half at three decimal places, so it distinguishes MidpointRounding.AwayFromZero (42.001,
     what this adapter does) from ToEven (42.000). The day therefore totals 10584.001 kWh, not
     10584.000. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>0e2a4c6e-8a0c-4e2a-4c6e-8a0c2e4a6c71</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A16</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-03-30T04:05:00Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-03-28T23:00:00Z</StartPeriod>
        <EndPeriod>2026-03-29T22:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>2a4c6e8a-0c2e-4a4c-6e8a-0c2e4a6c8e73</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-03-28T23:00:00Z</StartPeriod>
          <EndPeriod>2026-03-29T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>MWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>0.040</Qty></Point>
          <Point><Pos>2</Pos><Qty>0.040</Qty></Point>
          <Point><Pos>3</Pos><Qty>0.040</Qty></Point>
          <Point><Pos>4</Pos><Qty>0.040</Qty></Point>
          <Point><Pos>5</Pos><Qty>0.040</Qty></Point>
          <Point><Pos>6</Pos><Qty>0.040</Qty></Point>
          <Point><Pos>7</Pos><Qty>0.040</Qty></Point>
          <Point><Pos>8</Pos><Qty>0.040</Qty></Point>
          <Point><Pos>9</Pos><Qty>0.038</Qty></Point>
          <Point><Pos>10</Pos><Qty>0.038</Qty></Point>
          <Point><Pos>11</Pos><Qty>0.038</Qty></Point>
          <Point><Pos>12</Pos><Qty>0.038</Qty></Point>
          <Point><Pos>13</Pos><Qty>0.040</Qty></Point>
          <Point><Pos>14</Pos><Qty>0.040</Qty></Point>
          <Point><Pos>15</Pos><Qty>0.040</Qty></Point>
          <Point><Pos>16</Pos><Qty>0.040</Qty></Point>
          <Point><Pos>17</Pos><Qty>0.052</Qty></Point>
          <Point><Pos>18</Pos><Qty>0.052</Qty></Point>
          <Point><Pos>19</Pos><Qty>0.052</Qty></Point>
          <Point><Pos>20</Pos><Qty>0.052</Qty></Point>
          <Point><Pos>21</Pos><Qty>0.096</Qty></Point>
          <Point><Pos>22</Pos><Qty>0.096</Qty></Point>
          <Point><Pos>23</Pos><Qty>0.096</Qty></Point>
          <Point><Pos>24</Pos><Qty>0.096</Qty></Point>
          <Point><Pos>25</Pos><Qty>0.148</Qty></Point>
          <Point><Pos>26</Pos><Qty>0.148</Qty></Point>
          <Point><Pos>27</Pos><Qty>0.148</Qty></Point>
          <Point><Pos>28</Pos><Qty>0.148</Qty></Point>
          <Point><Pos>29</Pos><Qty>0.176</Qty></Point>
          <Point><Pos>30</Pos><Qty>0.176</Qty></Point>
          <Point><Pos>31</Pos><Qty>0.176</Qty></Point>
          <Point><Pos>32</Pos><Qty>0.176</Qty></Point>
          <Point><Pos>33</Pos><Qty>0.182</Qty></Point>
          <Point><Pos>34</Pos><Qty>0.182</Qty></Point>
          <Point><Pos>35</Pos><Qty>0.182</Qty></Point>
          <Point><Pos>36</Pos><Qty>0.182</Qty></Point>
          <Point><Pos>37</Pos><Qty>0.186</Qty></Point>
          <Point><Pos>38</Pos><Qty>0.186</Qty></Point>
          <Point><Pos>39</Pos><Qty>0.186</Qty></Point>
          <Point><Pos>40</Pos><Qty>0.186</Qty></Point>
          <Point><Pos>41</Pos><Qty>0.188</Qty></Point>
          <Point><Pos>42</Pos><Qty>0.188</Qty></Point>
          <Point><Pos>43</Pos><Qty>0.188</Qty></Point>
          <Point><Pos>44</Pos><Qty>0.188</Qty></Point>
          <Point><Pos>45</Pos><Qty>0.172</Qty></Point>
          <Point><Pos>46</Pos><Qty>0.172</Qty></Point>
          <Point><Pos>47</Pos><Qty>0.172</Qty></Point>
          <Point><Pos>48</Pos><Qty>0.172</Qty></Point>
          <Point><Pos>49</Pos><Qty>0.184</Qty></Point>
          <Point><Pos>50</Pos><Qty>0.184</Qty></Point>
          <Point><Pos>51</Pos><Qty>0.184</Qty></Point>
          <Point><Pos>52</Pos><Qty>0.184</Qty></Point>
          <Point><Pos>53</Pos><Qty>0.186</Qty></Point>
          <Point><Pos>54</Pos><Qty>0.186</Qty></Point>
          <Point><Pos>55</Pos><Qty>0.186</Qty></Point>
          <Point><Pos>56</Pos><Qty>0.186</Qty></Point>
          <Point><Pos>57</Pos><Qty>0.180</Qty></Point>
          <Point><Pos>58</Pos><Qty>0.180</Qty></Point>
          <Point><Pos>59</Pos><Qty>0.180</Qty></Point>
          <Point><Pos>60</Pos><Qty>0.180</Qty></Point>
          <Point><Pos>61</Pos><Qty>0.168</Qty></Point>
          <Point><Pos>62</Pos><Qty>0.168</Qty></Point>
          <Point><Pos>63</Pos><Qty>0.168</Qty></Point>
          <Point><Pos>64</Pos><Qty>0.168</Qty></Point>
          <Point><Pos>65</Pos><Qty>0.140</Qty></Point>
          <Point><Pos>66</Pos><Qty>0.140</Qty></Point>
          <Point><Pos>67</Pos><Qty>0.140</Qty></Point>
          <Point><Pos>68</Pos><Qty>0.140</Qty></Point>
          <Point><Pos>69</Pos><Qty>0.112</Qty></Point>
          <Point><Pos>70</Pos><Qty>0.112</Qty></Point>
          <Point><Pos>71</Pos><Qty>0.112</Qty></Point>
          <Point><Pos>72</Pos><Qty>0.112</Qty></Point>
          <Point><Pos>73</Pos><Qty>0.092</Qty></Point>
          <Point><Pos>74</Pos><Qty>0.092</Qty></Point>
          <Point><Pos>75</Pos><Qty>0.092</Qty></Point>
          <Point><Pos>76</Pos><Qty>0.092</Qty></Point>
          <Point><Pos>77</Pos><Qty>0.076</Qty></Point>
          <Point><Pos>78</Pos><Qty>0.076</Qty></Point>
          <Point><Pos>79</Pos><Qty>0.076</Qty></Point>
          <Point><Pos>80</Pos><Qty>0.076</Qty></Point>
          <Point><Pos>81</Pos><Qty>0.060</Qty></Point>
          <Point><Pos>82</Pos><Qty>0.060</Qty></Point>
          <Point><Pos>83</Pos><Qty>0.060</Qty></Point>
          <Point><Pos>84</Pos><Qty>0.060</Qty></Point>
          <Point><Pos>85</Pos><Qty>0.048</Qty></Point>
          <Point><Pos>86</Pos><Qty>0.048</Qty></Point>
          <Point><Pos>87</Pos><Qty>0.048</Qty></Point>
          <Point><Pos>88</Pos><Qty>0.048</Qty></Point>
          <Point><Pos>89</Pos><Qty>0.042</Qty></Point>
          <Point><Pos>90</Pos><Qty>0.042</Qty></Point>
          <Point><Pos>91</Pos><Qty>0.042</Qty></Point>
          <Point><Pos>92</Pos><Qty>0.0420005</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

- [ ] **Step 2: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedMeasurementUnitTests.cs`:

```csharp
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Integration.Brp.Pvned;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// Shared contract section 8.2's MeasurementUnit row, and SchemaProvenance row 5.
/// </summary>
/// <remarks>
/// The unit is read from the message and converted, rather than assumed from the dependency
/// table, because the table and the sample disagree: the table predicts KWH for allocations and
/// KWT/MWH for imbalance, and the sample uses KWH for A20/A14/A02 and MWH for B24/B25. A
/// prediction that the vendor's own sample contradicts is not a rule.
/// </remarks>
public sealed class PvnedMeasurementUnitTests
{
    [Fact]
    public void KWH_is_carried_through_unchanged()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a23-both-directions-96.xml");

        outcome.Document.ShouldNotBeNull();
        outcome.Document.Series[0].Points[0].QuantityKwh.ShouldBe(40.000m);
    }

    [Fact]
    public void MWH_is_multiplied_by_a_thousand()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a23-dst-spring-92.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Accepted, outcome.FailureDetail);
        outcome.Document.ShouldNotBeNull();

        var points = outcome.Document.Series[0].Points;
        points[0].QuantityKwh.ShouldBe(40.000m, "0.040 MWh is 40 kWh");
        points[20].QuantityKwh.ShouldBe(96.000m, "Pos 21 carries 0.096 MWh");
        points[44].QuantityKwh.ShouldBe(172.000m, "Pos 45 carries 0.172 MWh");
    }

    [Fact]
    public void The_converted_day_totals_the_hand_computed_figure()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a23-dst-spring-92.xml");

        outcome.Document.ShouldNotBeNull();
        outcome.Document.Series[0].Points.Sum(point => point.QuantityKwh)
            .ShouldBe(10584.001m);
    }

    [Fact]
    public void A_value_on_the_half_at_three_decimals_rounds_away_from_zero()
    {
        // Pos 92 carries 0.0420005 MWh, which is 42.0005 kWh. numeric(14,3) holds three
        // decimals, so the adapter must choose a rule and state it. AwayFromZero gives 42.001;
        // MidpointRounding.ToEven - the .NET default, and what decimal.Round does with no
        // third argument - gives 42.000.
        var outcome = PvnedAdapterHarness.Parse("golden-a23-dst-spring-92.xml");

        outcome.Document.ShouldNotBeNull();
        outcome.Document.Series[0].Points[91].QuantityKwh.ShouldBe(42.001m);
    }

    [Fact]
    public void Every_converted_quantity_fits_three_decimal_places()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a23-dst-spring-92.xml");

        outcome.Document.ShouldNotBeNull();
        outcome.Document.Series[0].Points.ShouldAllBe(
            point => point.QuantityKwh == decimal.Round(point.QuantityKwh, 3));
    }

    [Fact]
    public void KWT_is_UNSUPPORTED_MEASUREMENT_UNIT_rather_than_a_silent_multiply()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-unsupported-measurement-unit.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.FailureCode.ShouldBe(
            PvnedFailureCodes.UnsupportedMeasurementUnit,
            "KWT is a power, not an energy; turning it into a quantity_kwh would invent the "
            + "interval-length arithmetic the sender did not ask for");
        outcome.Document.ShouldBeNull();
    }

    [Fact]
    public void The_unsupported_unit_detail_names_the_unit_and_the_two_that_are_accepted()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-unsupported-measurement-unit.xml");

        outcome.FailureDetail.ShouldNotBeNull();
        outcome.FailureDetail.ShouldContain("KWT", Case.Sensitive);
        outcome.FailureDetail.ShouldContain("KWH", Case.Sensitive);
        outcome.FailureDetail.ShouldContain("MWH", Case.Sensitive);
    }

    [Fact]
    public void MAW_is_refused_for_the_same_reason_as_KWT()
    {
        var asMegawatts = PvnedFixtures.Text("invalid-unsupported-measurement-unit.xml")
            .Replace(
                "<MeasurementUnit>KWT</MeasurementUnit>",
                "<MeasurementUnit>MAW</MeasurementUnit>",
                StringComparison.Ordinal);

        var outcome = PvnedAdapterHarness.Create().Parse(new BrpParseRequest(
            InboundMessageId: Guid.CreateVersion7(),
            BrpId: PvnedAdapterHarness.PvnedBrpId,
            BrpCode: "PVNED",
            CorrelationId: Guid.CreateVersion7(),
            Payload: System.Text.Encoding.UTF8.GetBytes(asMegawatts),
            ReceivedAt: PvnedAdapterHarness.DefaultNow));

        outcome.FailureCode.ShouldBe(PvnedFailureCodes.UnsupportedMeasurementUnit);
    }
}
```

- [ ] **Step 3: Run it and watch it fail**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedMeasurementUnitTests"
```
Expected: FAIL — `MWH_is_multiplied_by_a_thousand` reports
`points[0].QuantityKwh should be 40.000 but was 0.040`;
`The_converted_day_totals_the_hand_computed_figure` reports
`should be 10584.001 but was 10.584`;
`A_value_on_the_half_at_three_decimals_rounds_away_from_zero` reports
`should be 42.001 but was 0.0420005`;
`Every_converted_quantity_fits_three_decimal_places` fails on Pos 92;
`KWT_is_UNSUPPORTED_MEASUREMENT_UNIT_rather_than_a_silent_multiply` reports
`outcome.Status should be Rejected but was Accepted`; and the two remaining unit tests fail with
it. `KWH_is_carried_through_unchanged` passes.

- [ ] **Step 4: Add the unit guard and the conversion**

In `PvnedIngestionAdapter.ParseSeries`, insert immediately after the `UNSUPPORTED_DIRECTION`
guard block:

```csharp
        var unitCode = Text(series, "MeasurementUnit");
        var quantityMultiplier = unitCode switch
        {
            KilowattHourUnit => 1m,
            MegawattHourUnit => 1000m,
            _ => default(decimal?),
        };

        if (quantityMultiplier is null)
        {
            return SeriesOutcome.Rejected(
                PvnedFailureCodes.UnsupportedMeasurementUnit,
                $"TimeSeries {index.ToString(CultureInfo.InvariantCulture)} declares "
                + $"MeasurementUnit '{unitCode}'. An allocation quantity must be an energy, so "
                + "this adapter accepts KWH and MWH; KWT and MAW are powers and cannot become a "
                + "quantity in kWh without inventing an interval length.");
        }
```

Then replace the point loop's `points.Add` line:

```csharp
                points.Add(new CanonicalPoint(pos, quantity));
```

with:

```csharp
                // SchemaProvenance row 5: the unit is read from the message and converted.
                // Rounded to three decimals because interval_reading.quantity_kwh is
                // numeric(14,3), and away from zero rather than to even so that the rule is one
                // an invoice reader can restate: a half always goes up in magnitude.
                points.Add(new CanonicalPoint(
                    pos,
                    decimal.Round(
                        quantity * quantityMultiplier.Value, 3, MidpointRounding.AwayFromZero)));
```

Finally add the two unit constants beside the direction ones, after
`private const string ConsumptionDirectionCode = "A02";`:

```csharp
    private const string KilowattHourUnit = "KWH";
    private const string MegawattHourUnit = "MWH";
```

- [ ] **Step 5: Run the test and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedMeasurementUnitTests"
```
Expected: PASS — 8 passed, 0 failed.

- [ ] **Step 6: Mutation — assume the unit instead of reading it**

This is the mistake `SchemaProvenance` row 5 exists to prevent. Temporarily hard-code the
dependency table's prediction:

```csharp
        var quantityMultiplier = 1m;   // the dependency table says allocations are always KWH
```

(delete the guard block and change `quantityMultiplier.Value` to `quantityMultiplier` so it
compiles).

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedMeasurementUnitTests"`
Expected: FAIL — six tests. `MWH_is_multiplied_by_a_thousand` reports
`should be 40.000 but was 0.040`, and the KWT and MAW tests report
`outcome.FailureCode should be "UNSUPPORTED_MEASUREMENT_UNIT" but was null`. The MWh document
becomes a thousand-fold under-read that no schema and no other rule can see — which is what a
"the table says so" assumption costs.

Then restore the switch and the guard.

- [ ] **Step 7: Mutation — round to even instead of away from zero**

```csharp
                points.Add(new CanonicalPoint(
                    pos, decimal.Round(quantity * quantityMultiplier.Value, 3)));
```

(`decimal.Round` with no third argument is `MidpointRounding.ToEven`.)

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedMeasurementUnitTests"`
Expected: FAIL — exactly two tests.
`A_value_on_the_half_at_three_decimals_rounds_away_from_zero` reports
`should be 42.001 but was 42.000`, and `The_converted_day_totals_the_hand_computed_figure` reports
`should be 10584.001 but was 10584.000`. `Every_converted_quantity_fits_three_decimal_places`
stays green, because both answers fit three decimals — the fit assertion cannot see which rule was
used, which is why the exact value is asserted separately.

Then restore `MidpointRounding.AwayFromZero`.

- [ ] **Step 8: Mutation — accept KWT by multiplying by a quarter of an hour**

The plausible wrong fix, written out:

```csharp
        var quantityMultiplier = unitCode switch
        {
            KilowattHourUnit => 1m,
            MegawattHourUnit => 1000m,
            "KWT" => 0.25m,
            _ => default(decimal?),
        };
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedMeasurementUnitTests"`
Expected: FAIL — two tests, `KWT_is_UNSUPPORTED_MEASUREMENT_UNIT_rather_than_a_silent_multiply`
(`outcome.Status should be Rejected but was Accepted`) and
`The_unsupported_unit_detail_names_the_unit_and_the_two_that_are_accepted`
(`outcome.FailureDetail should not be null`). `MAW_is_refused_for_the_same_reason_as_KWT` stays
green, which is exactly why MAW has its own test: a partial fix that handles one power unit and
not the other would otherwise look complete.

Then restore the two-unit switch.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedIngestionAdapter.cs \
        tests/PeakPower.Application.Tests/Ingestion/Pvned
git commit -m "pvned: read the measurement unit from the message and convert MWh to kWh

SchemaProvenance row 5: the dependency table predicts KWH for allocations, and PVNed's own sample
contradicts it, so the unit is read from the message rather than assumed. KWT and MAW are powers
and are rejected as UNSUPPORTED_MEASUREMENT_UNIT (shared contract 16.4) rather than multiplied by
an interval length the sender never mentioned.

Rounding is to three decimals away from zero, because interval_reading.quantity_kwh is
numeric(14,3) and a half going up in magnitude is a rule an invoice reader can restate. The
spring fixture's Pos 92 sits exactly on that half so the choice is asserted, not assumed.

Verified by mutation: hard-coding the multiplier to 1 reddens six tests and makes an MWh document
a thousand-fold under-read; rounding to even reddens the two exact-value assertions while the
'fits three decimals' guard stays green; and accepting KWT as a quarter-hour multiply reddens the
KWT pair while MAW stays green, which is why MAW is tested separately."
```

---

### Task 10: `Resolution`, `CurveType`, the Amsterdam day, and `[OQ-20]`'s ignored `TimeInterval`

Four rules in one task because they are all properties of the period the series declares:

- **`UNSUPPORTED_RESOLUTION`** — `Resolution` must be `PT15M`. `PT60M` is in the class diagram and
  the platform stores quarter-hours.
- **`UNSUPPORTED_CURVE_TYPE`** — `CurveType` must be `A01`. `SchemaProvenance` row 9: the guide
  lists `A03` as permitted and the XSD enumerates only `A01`, and the reconstructed schema leaves
  the field a plain string so the operator sees the frozen §8.2 code rather than a schema error.
- **`INVALID_MEASUREMENT_PERIOD`** — `MeasurementPeriode` must cover **exactly one Amsterdam
  calendar day**, midnight to midnight in local terms.
- **`[OQ-20]`** — `MeasurementPeriode` + `Pos` are authoritative. `Period.TimeInterval` is
  **logged as a discrepancy and never used to place a point.** Integration-spec §9 calls item 7
  *"the one that would silently corrupt data if implemented naively: an implementer who trusts
  `Period.TimeInterval` to place the points would write a month's worth of intervals to the wrong
  dates."*

**Files:**
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-unsupported-resolution.xml`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-unsupported-curve-type.xml`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-invalid-measurement-period.xml`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/RecordingLogger.cs`
- Modify: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedAdapterHarness.cs` — add
  `CreateRecording`
- Modify: `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedIngestionAdapter.cs`
- Test: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedPeriodTests.cs`

**Interfaces:**
- Consumes: `PvnedFailureCodes.UnsupportedResolution`, `.UnsupportedCurveType`,
  `.InvalidMeasurementPeriod` (Task 2); `SeriesOutcome` (Task 7).
- Produces: `PeakPower.Application.Tests.Ingestion.Pvned.RecordingLogger<T>` with
  `IReadOnlyList<string> Lines`; `PvnedAdapterHarness.CreateRecording(out RecordingLogger<PvnedIngestionAdapter> log, ...)`.

- [ ] **Step 1: Write the three fixtures**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-unsupported-resolution.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     Integration-spec 8.2 rule 4: Resolution = PT15M. PT60M is in the class diagram's list and
     the platform stores quarter-hours [DEC-08], so an hourly curve cannot be placed without
     inventing a distribution across the four quarters. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>8e0a2c4e-6a8c-4e0a-2c4e-6a8c0e2a4c81</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>0a2c4e6a-8c0e-4a2c-4e6a-8c0e2a4c6e83</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT60M</Resolution>
          <Point><Pos>1</Pos><Qty>160.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>160.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>160.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>160.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-unsupported-curve-type.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     Integration-spec 8.2 rule 5 and section 9 row 9: the guide lists CurveType A03 as permitted
     and the XSD enumerates only A01. The permissive reading rejects A03, and the reconstructed
     schema deliberately leaves CurveType a plain string so that an operator sees the frozen
     UNSUPPORTED_CURVE_TYPE rather than a schema error. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>2c4e6a8c-0e2a-4c4e-6a8c-0e2a4c6e8a91</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>4e6a8c0e-2a4c-4e6a-8c0e-2a4c6e8a0c93</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A03</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>40.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-invalid-measurement-period.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     Integration-spec 8.2 rule 6: MeasurementPeriode covers exactly one Amsterdam calendar day.
     This one runs from local midnight on 12 August to local midnight on 14 August - two days -
     so Pos is ambiguous: the same position would name two different quarter-hours, and the
     document does not say which. Rejecting is the only honest answer; picking the first day is
     the failure that writes plausible data to the wrong times. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>6a8c0e2a-4c6e-4a8c-0e2a-4c6e8a0c2ea1</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-08-15T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-13T22:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>8c0e2a4c-6e8a-4c0e-2a4c-6e8a0c2e4ea3</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-13T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>40.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

- [ ] **Step 2: Write the recording logger and extend the harness**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/RecordingLogger.cs`:

```csharp
using Microsoft.Extensions.Logging;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// Captures what the adapter logs, so that "logged as a discrepancy and never used" can be
/// asserted on both halves rather than only on the half that is easy to see.
/// </summary>
/// <remarks>
/// [OQ-20]'s interim answer has two obligations. That the point placement ignores
/// Period.TimeInterval is visible in the delivery date. That the discrepancy is <i>recorded</i>
/// is not visible anywhere else, and it is the half that makes the walkthrough with PVNed
/// possible: without it nobody can say how often real documents actually disagree.
/// </remarks>
public sealed class RecordingLogger<T> : ILogger<T>
{
    private readonly List<string> _lines = [];

    public IReadOnlyList<string> Lines => _lines;

    public IDisposable? BeginScope<TState>(TState state)
        where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter) =>
        _lines.Add($"{logLevel}: {formatter(state, exception)}");
}
```

Then add to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedAdapterHarness.cs`,
immediately before the closing brace of the class:

```csharp
    /// <summary>Builds the adapter with a logger whose lines the test can read back.</summary>
    public static PvnedIngestionAdapter CreateRecording(
        out RecordingLogger<PvnedIngestionAdapter> log,
        DateTimeOffset? now = null)
    {
        log = new RecordingLogger<PvnedIngestionAdapter>();

        return new PvnedIngestionAdapter(
            new MarketCalendar(new FakeTimeProvider(now ?? DefaultNow)),
            new PvnedAdapterOptions(),
            log);
    }
```

- [ ] **Step 3: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedPeriodTests.cs`:

```csharp
using System.Text;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Integration.Brp.Pvned;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// Integration-spec section 8.2 rules 4, 5 and 6, and section 9 row 7's [OQ-20] reading.
/// </summary>
public sealed class PvnedPeriodTests
{
    [Fact]
    public void An_hourly_resolution_is_UNSUPPORTED_RESOLUTION()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-unsupported-resolution.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.FailureCode.ShouldBe(PvnedFailureCodes.UnsupportedResolution);
        outcome.FailureDetail.ShouldNotBeNull();
        outcome.FailureDetail.ShouldContain("PT60M", Case.Sensitive);
        outcome.FailureDetail.ShouldContain("PT15M", Case.Sensitive);
    }

    [Fact]
    public void CurveType_A03_is_UNSUPPORTED_CURVE_TYPE_not_a_schema_error()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-unsupported-curve-type.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.FailureCode.ShouldBe(
            PvnedFailureCodes.UnsupportedCurveType,
            "SchemaProvenance row 9: the reconstructed XSD leaves CurveType a plain string so "
            + "that the frozen integration-spec 8.2 code is what an operator sees");
        outcome.FailureCode.ShouldNotBe(PvnedFailureCodes.SchemaValidationFailed);
    }

    [Fact]
    public void A_two_day_MeasurementPeriode_is_INVALID_MEASUREMENT_PERIOD()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-invalid-measurement-period.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.FailureCode.ShouldBe(
            PvnedFailureCodes.InvalidMeasurementPeriod,
            "Pos is a position within one day; across two days the same position names two "
            + "different quarter-hours and the document does not say which");
        outcome.Document.ShouldBeNull();
    }

    [Fact]
    public void A_MeasurementPeriode_that_starts_mid_day_is_INVALID_MEASUREMENT_PERIOD()
    {
        // Local 01:00 to local 01:00 the next day is exactly 24 hours and exactly one day long,
        // and it is still wrong: Pos 1 is local 00:00-00:15 on the delivery date, so a period
        // that does not begin at local midnight cannot place a single point.
        var shifted = PvnedFixtures.Text("golden-a23-both-directions-96.xml")
            .Replace("2026-08-11T22:00:00Z", "2026-08-11T23:00:00Z", StringComparison.Ordinal)
            .Replace("2026-08-12T22:00:00Z", "2026-08-12T23:00:00Z", StringComparison.Ordinal);

        var outcome = Parse(shifted);

        outcome.FailureCode.ShouldBe(PvnedFailureCodes.InvalidMeasurementPeriod);
    }

    [Fact]
    public void The_golden_documents_one_day_period_is_accepted()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a23-both-directions-96.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Accepted, outcome.FailureDetail);
    }

    [Fact]
    public void The_spring_days_twenty_three_hour_period_is_accepted()
    {
        // 2026-03-28T23:00:00Z to 2026-03-29T22:00:00Z is 23 hours of UTC and exactly one
        // Amsterdam calendar day. A check written as "the period is 24 hours long" rejects the
        // spring day and accepts nothing else in exchange.
        var outcome = PvnedAdapterHarness.Parse("golden-a23-dst-spring-92.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Accepted, outcome.FailureDetail);
    }

    [Fact]
    public void A_conflicting_Period_TimeInterval_does_not_move_the_delivery_date()
    {
        // Integration-spec section 9 row 7, and [OQ-20]. The sample shows a month-long
        // TimeInterval inside a one-day MeasurementPeriode. An implementer who trusts it writes
        // a month of intervals to the wrong dates, and nothing notices until an invoice does.
        var outcome = Parse(WithConflictingTimeInterval());

        outcome.Status.ShouldBe(BrpParseStatus.Accepted, outcome.FailureDetail);
        outcome.Document.ShouldNotBeNull();
        outcome.Document.Series.ShouldAllBe(
            series => series.DeliveryDate == new DateOnly(2026, 8, 12));
    }

    [Fact]
    public void A_conflicting_Period_TimeInterval_is_logged_as_a_discrepancy()
    {
        var adapter = PvnedAdapterHarness.CreateRecording(out var log);

        adapter.Parse(new BrpParseRequest(
            InboundMessageId: Guid.CreateVersion7(),
            BrpId: PvnedAdapterHarness.PvnedBrpId,
            BrpCode: "PVNED",
            CorrelationId: Guid.CreateVersion7(),
            Payload: Encoding.UTF8.GetBytes(WithConflictingTimeInterval()),
            ReceivedAt: PvnedAdapterHarness.DefaultNow));

        var discrepancies = log.Lines
            .Where(line => line.Contains("Period.TimeInterval", StringComparison.Ordinal))
            .ToArray();

        discrepancies.ShouldNotBeEmpty(
            "[OQ-20]'s interim answer has two halves: never place a point from it, AND record "
            + "the disagreement. Without the second half nobody can tell PVNed how often real "
            + "documents actually disagree");
        discrepancies[0].ShouldContain("Warning", Case.Sensitive);
        discrepancies[0].ShouldContain("2026-07-31", Case.Sensitive);
    }

    [Fact]
    public void An_agreeing_Period_TimeInterval_logs_no_discrepancy()
    {
        var adapter = PvnedAdapterHarness.CreateRecording(out var log);

        adapter.Parse(PvnedAdapterHarness.Request("golden-a23-both-directions-96.xml"));

        log.Lines.ShouldNotContain(
            line => line.Contains("Period.TimeInterval", StringComparison.Ordinal),
            "the golden document declares no Period.TimeInterval at all, so there is nothing to "
            + "disagree with and a warning here would be noise on every document PVNed sends");
    }

    private static string WithConflictingTimeInterval() =>
        PvnedFixtures.Text("golden-a23-both-directions-96.xml")
            .Replace(
                "<Period>\n          <Resolution>PT15M</Resolution>",
                "<Period>\n          <TimeInterval>\n"
                + "            <StartPeriod>2026-07-31T22:00:00Z</StartPeriod>\n"
                + "            <EndPeriod>2026-08-31T22:00:00Z</EndPeriod>\n"
                + "          </TimeInterval>\n          <Resolution>PT15M</Resolution>",
                StringComparison.Ordinal);

    private static BrpParseOutcome Parse(string document) =>
        PvnedAdapterHarness.Create().Parse(new BrpParseRequest(
            InboundMessageId: Guid.CreateVersion7(),
            BrpId: PvnedAdapterHarness.PvnedBrpId,
            BrpCode: "PVNED",
            CorrelationId: Guid.CreateVersion7(),
            Payload: Encoding.UTF8.GetBytes(document),
            ReceivedAt: PvnedAdapterHarness.DefaultNow));
}
```

⚠ `WithConflictingTimeInterval` matches on a two-line anchor with `\n`. If the fixture was saved
with CRLF line endings the replacement silently does nothing and
`A_conflicting_Period_TimeInterval_is_logged_as_a_discrepancy` fails with an empty
`discrepancies`. Check `git config core.autocrlf` and the repository's `.gitattributes` before
concluding the adapter is wrong; on a mismatch, normalise the fixture to LF rather than
weakening the anchor.

- [ ] **Step 4: Run it and watch it fail**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedPeriodTests"
```
Expected: FAIL — six of nine.
`An_hourly_resolution_is_UNSUPPORTED_RESOLUTION` reports
`outcome.Status should be Rejected but was Accepted`;
`CurveType_A03_is_UNSUPPORTED_CURVE_TYPE_not_a_schema_error` the same;
`A_two_day_MeasurementPeriode_is_INVALID_MEASUREMENT_PERIOD` the same;
`A_MeasurementPeriode_that_starts_mid_day_is_INVALID_MEASUREMENT_PERIOD` reports
`outcome.FailureCode should be "INVALID_MEASUREMENT_PERIOD" but was null`;
`A_conflicting_Period_TimeInterval_is_logged_as_a_discrepancy` reports
`discrepancies should not be empty but was empty`.
`A_conflicting_Period_TimeInterval_does_not_move_the_delivery_date`,
`An_agreeing_Period_TimeInterval_logs_no_discrepancy` and the two accepted-document tests pass
already — the delivery date has always come from `MeasurementPeriode`, and that is worth noting:
the `[OQ-20]` placement half was right from Task 7, and it is the *recording* half that is new.

- [ ] **Step 5: Add the three guards and the discrepancy log**

In `PvnedIngestionAdapter.ParseSeries`, insert at the **very top of the method**, before
`var directionCode = Text(series, "Direction");`:

```csharp
        foreach (var period in series.Elements(PeriodName))
        {
            var resolution = period.Element(ResolutionName)?.Value.Trim() ?? string.Empty;
            if (!string.Equals(resolution, QuarterHourResolution, StringComparison.Ordinal))
            {
                return SeriesOutcome.Rejected(
                    PvnedFailureCodes.UnsupportedResolution,
                    $"TimeSeries {index.ToString(CultureInfo.InvariantCulture)} declares "
                    + $"Resolution '{resolution}'. The platform stores quarter-hours [DEC-08], "
                    + "so only PT15M can be placed without inventing a distribution.");
            }
        }

        var curveType = Text(series, "CurveType");
        if (!string.Equals(curveType, SequentialFixedSizeCurveType, StringComparison.Ordinal))
        {
            return SeriesOutcome.Rejected(
                PvnedFailureCodes.UnsupportedCurveType,
                $"TimeSeries {index.ToString(CultureInfo.InvariantCulture)} declares CurveType "
                + $"'{curveType}'. Only A01 - a sequential fixed-size block curve - is handled; "
                + "SchemaProvenance row 9 records why A03 is rejected despite the guide listing "
                + "it.");
        }
```

Then, immediately after the two lines that compute the delivery date and the expected count:

```csharp
        var deliveryDate = AmsterdamDateOf(periodStart);
        var expectedIntervalCount = _calendar.ExpectedIntervalCount(deliveryDate);
```

insert:

```csharp
        var endText = measurementPeriode?.Element(EndPeriodName)?.Value ?? string.Empty;
        if (!DateTimeOffset.TryParse(
                endText,
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out var periodEnd))
        {
            return SeriesOutcome.Rejected(
                PvnedFailureCodes.InvalidMeasurementPeriod,
                $"TimeSeries {index.ToString(CultureInfo.InvariantCulture)} carries "
                + $"MeasurementPeriode.EndPeriod '{endText}', which is not a readable timestamp.");
        }

        // Integration-spec 8.2 rule 6: exactly one Amsterdam calendar day, local midnight to
        // local midnight. Deliberately NOT "the period is 24 hours long" - the spring-forward
        // day is 23 hours and the autumn fall-back day is 25, and a duration check rejects both
        // while accepting a period that starts at 01:00 and runs a clean 24 hours to 01:00.
        var expectedStart = AmsterdamMidnight(deliveryDate);
        var expectedEnd = AmsterdamMidnight(deliveryDate.AddDays(1));

        if (periodStart != expectedStart || periodEnd != expectedEnd)
        {
            return SeriesOutcome.Rejected(
                PvnedFailureCodes.InvalidMeasurementPeriod,
                $"TimeSeries {index.ToString(CultureInfo.InvariantCulture)} declares a "
                + $"MeasurementPeriode of {periodStart:O} to {periodEnd:O}. Exactly one "
                + $"Amsterdam calendar day is expected, which for {deliveryDate:yyyy-MM-dd} is "
                + $"{expectedStart:O} to {expectedEnd:O}.");
        }

        // Integration-spec section 9 row 7, [OQ-20]: MeasurementPeriode and Pos are
        // authoritative. Period.TimeInterval is recorded and never used to place a point. The
        // recording is not decoration - it is the only evidence anyone will have about how
        // often real documents disagree when the [OQ-65] walkthrough finally happens.
        foreach (var period in series.Elements(PeriodName))
        {
            var interval = period.Element(TimeIntervalName);
            var intervalStart = interval?.Element(StartPeriodName)?.Value;
            var intervalEnd = interval?.Element(EndPeriodName)?.Value;

            if (interval is null)
            {
                continue;
            }

            if (!string.Equals(intervalStart, startText, StringComparison.Ordinal)
                || !string.Equals(intervalEnd, endText, StringComparison.Ordinal))
            {
                _logger.LogWarning(
                    "PVNed Period.TimeInterval {IntervalStart}/{IntervalEnd} disagrees with "
                    + "MeasurementPeriode {PeriodStart}/{PeriodEnd} on TimeSeries {SeriesIndex}. "
                    + "MeasurementPeriode and Pos are authoritative and the interval is ignored "
                    + "([OQ-20], integration-spec section 9 row 7).",
                    intervalStart,
                    intervalEnd,
                    startText,
                    endText,
                    index);
            }
        }
```

Add the two code constants beside the unit ones:

```csharp
    private const string QuarterHourResolution = "PT15M";
    private const string SequentialFixedSizeCurveType = "A01";
```

Add the `ResolutionName` XName beside the others:

```csharp
    private static readonly XName ResolutionName = Pvned("Resolution");
```

And add the midnight helper beside `AmsterdamDateOf`:

```csharp
    /// <summary>
    /// The instant of local midnight on <paramref name="date"/> in Amsterdam, with the offset
    /// that day actually had. Midnight is never an ambiguous or a skipped local time in this
    /// zone - the transitions are at 02:00 and 03:00 - so there is exactly one answer.
    /// </summary>
    private static DateTimeOffset AmsterdamMidnight(DateOnly date)
    {
        var localMidnight = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        return new DateTimeOffset(localMidnight, Amsterdam.GetUtcOffset(localMidnight));
    }
```

- [ ] **Step 6: Run the test and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedPeriodTests"
```
Expected: PASS — 9 passed, 0 failed. Then run the whole PVNed suite to confirm nothing else moved:
```bash
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~Ingestion.Pvned"
```
Expected: PASS.

- [ ] **Step 7: Mutation — place the points from `Period.TimeInterval`, which §9 calls the silent corruption**

Temporarily change the delivery-date derivation to trust the interval when there is one:

```csharp
        var intervalOverride = series.Elements(PeriodName)
            .Select(period => period.Element(TimeIntervalName)?.Element(StartPeriodName)?.Value)
            .FirstOrDefault(value => value is not null);

        var placementStart = DateTimeOffset.TryParse(
            intervalOverride, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind,
            out var overridden)
            ? overridden
            : periodStart;

        var deliveryDate = AmsterdamDateOf(placementStart);
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedPeriodTests"`
Expected: FAIL — two tests.
`A_conflicting_Period_TimeInterval_does_not_move_the_delivery_date` fails with
`series.DeliveryDate should be 2026-08-12 but was 2026-08-01`; and
`A_MeasurementPeriode_that_starts_mid_day_is_INVALID_MEASUREMENT_PERIOD` also fails, because the
delivery date the period is checked against has moved out from under it.

⚠ **Look at the first failure's value.** `2026-08-01` for a document about 12 August is exactly
the "a month's worth of intervals written to the wrong dates" integration-spec §9 warns about,
and it is *plausible data at the wrong times* — the failure mode nothing downstream can detect.

Then restore the `MeasurementPeriode`-only derivation.

- [ ] **Step 8: Mutation — check the period's duration instead of its endpoints**

The plausible wrong implementation:

```csharp
        if (periodEnd - periodStart != TimeSpan.FromHours(24))
        {
            return SeriesOutcome.Rejected(
                PvnedFailureCodes.InvalidMeasurementPeriod,
                "MeasurementPeriode must be exactly one day long.");
        }
```

(replacing the endpoint comparison).

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~Ingestion.Pvned"`
Expected: FAIL — two tests, in opposite directions.
`The_spring_days_twenty_three_hour_period_is_accepted` fails with
`outcome.Status should be Accepted but was Rejected` — the spring day is 23 hours of UTC, and a
duration check rejects a perfectly good DST document. And
`A_MeasurementPeriode_that_starts_mid_day_is_INVALID_MEASUREMENT_PERIOD` fails with
`outcome.FailureCode should be "INVALID_MEASUREMENT_PERIOD" but was null` — a period from local
01:00 to local 01:00 is a clean 24 hours and places every point an hour late.
`A_two_day_MeasurementPeriode_is_INVALID_MEASUREMENT_PERIOD` stays green, which is why the
mid-day case has its own test: the obvious negative fixture cannot see this bug.

Then restore the endpoint comparison.

- [ ] **Step 9: Mutation — accept any resolution**

Delete the `Resolution` loop entirely.

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedPeriodTests"`
Expected: FAIL — exactly one test, `An_hourly_resolution_is_UNSUPPORTED_RESOLUTION`, with
`outcome.Status should be Rejected but was Accepted`.

Then restore it.

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedIngestionAdapter.cs \
        tests/PeakPower.Application.Tests/Ingestion/Pvned
git commit -m "pvned: resolution, curve type, the Amsterdam day, and [OQ-20]'s ignored TimeInterval

Integration-spec 8.2 rules 4, 5 and 6. The one-day check compares ENDPOINTS against local
midnight rather than the period's duration: the spring day is 23 hours of UTC and the autumn day
is 25, so a duration check rejects both while accepting a period that runs a clean 24 hours from
local 01:00 and places every point an hour late.

[OQ-20]'s interim answer is implemented on both halves: MeasurementPeriode and Pos place the
points, and a disagreeing Period.TimeInterval is logged as a warning that names both. The
recording half is the only evidence anyone will have when the [OQ-65] walkthrough happens.

Verified by mutation: placing points from Period.TimeInterval moves a 12 August document to
1 August - plausible data at the wrong times, which integration-spec 9 calls the one that would
silently corrupt data; a duration check reddens the spring day and the mid-day period in opposite
directions while the obvious two-day fixture stays green; and deleting the resolution loop
reddens exactly one test."
```

---

### Task 11: The points — `INCOMPLETE_PERIOD`, `INVALID_POSITIONS`, `NEGATIVE_QUANTITY`

The last three of integration-spec §8.2's nine adapter rules, and the three that decide whether a
day's numbers are usable at all.

- **`INCOMPLETE_PERIOD`** — the point count must equal `IMarketCalendar.ExpectedIntervalCount` for
  the delivery date. ⚠ **Not 96.** The client-side rule that "a day has 96 intervals" is the bug
  DST exists to catch, and the count comes from the calendar every time.
- **`INVALID_POSITIONS`** — `Pos` values contiguous from 1, no duplicates. A document with the
  right *number* of points and a duplicated position has a hole and a double-count in it, and no
  count check can see either.
- **`NEGATIVE_QUANTITY`** — `Qty` ≥ 0. `[AS-05]` and position-and-coverage §2.1 keep consumption
  and production as two separate non-negative series; a negative reading means a direction has
  been mapped wrong, which under `[DEC-22]` is a wrong invoice.

**Files:**
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-incomplete-period-95.xml`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-invalid-positions-96.xml`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-negative-quantity-96.xml`
- Modify: `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedIngestionAdapter.cs`
- Test: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedPointTests.cs`

**Interfaces:**
- Consumes: `PvnedFailureCodes.IncompletePeriod`, `.InvalidPositions`, `.NegativeQuantity`
  (Task 2); `IMarketCalendar.ExpectedIntervalCount` (plan 1); `SeriesOutcome` (Task 7).
- Produces: nothing new; `ParseSeries` gains three guards after the point loop.

- [ ] **Step 1: Write `invalid-incomplete-period-95.xml`**

**Hand-written, ninety-five points.** The realistic case: a document that is one interval short,
with every position contiguous, so the count rule is isolated from the contiguity rule.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     Integration-spec 8.2 rule 7: the point count equals the expected interval count for that
     date. 12 August 2026 is an ordinary day, so 96 are expected and 95 arrive - Pos 96 is
     simply absent. Positions 1 to 95 are contiguous, so nothing but the count rule can catch
     this, which is what makes it the right fixture for that rule. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>0c2e4a6c-8e0a-4c2e-4a6c-8e0a2c4e6ab1</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>2e4a6c8e-0a2c-4e4a-6c8e-0a2c4e6a8cb3</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>5</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>6</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>7</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>8</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>9</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>10</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>11</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>12</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>13</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>14</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>15</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>16</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>17</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>18</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>19</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>20</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>21</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>22</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>23</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>24</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>25</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>26</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>27</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>28</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>29</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>30</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>31</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>32</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>33</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>34</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>35</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>36</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>37</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>38</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>39</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>40</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>41</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>42</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>43</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>44</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>45</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>46</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>47</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>48</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>49</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>50</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>51</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>52</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>53</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>54</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>55</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>56</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>57</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>58</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>59</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>60</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>61</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>62</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>63</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>64</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>65</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>66</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>67</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>68</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>69</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>70</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>71</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>72</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>73</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>74</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>75</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>76</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>77</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>78</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>79</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>80</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>81</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>82</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>83</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>84</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>85</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>86</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>87</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>88</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>89</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>90</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>91</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>92</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>93</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>94</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>95</Pos><Qty>42.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

- [ ] **Step 2: Write `invalid-invalid-positions-96.xml`**

**Hand-written, ninety-six points, with `Pos` 42 twice and `Pos` 43 never.**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     Integration-spec 8.2 rule 8: Pos values contiguous from 1, no duplicates. This document
     carries exactly 96 points, so the count rule passes it, and Pos 42 appears twice while
     Pos 43 never appears at all. That is a hole and a double-count in the same day, and only
     the contiguity rule can see it - which is why this fixture keeps the right count. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>4a6c8e0a-2c4e-4a6c-8e0a-2c4e6a8c0ec1</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>6c8e0a2c-4e6a-4c8e-0a2c-4e6a8c0e2ec3</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>5</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>6</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>7</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>8</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>9</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>10</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>11</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>12</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>13</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>14</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>15</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>16</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>17</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>18</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>19</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>20</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>21</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>22</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>23</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>24</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>25</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>26</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>27</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>28</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>29</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>30</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>31</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>32</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>33</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>34</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>35</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>36</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>37</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>38</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>39</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>40</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>41</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>42</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>42</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>44</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>45</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>46</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>47</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>48</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>49</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>50</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>51</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>52</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>53</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>54</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>55</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>56</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>57</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>58</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>59</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>60</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>61</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>62</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>63</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>64</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>65</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>66</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>67</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>68</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>69</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>70</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>71</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>72</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>73</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>74</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>75</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>76</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>77</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>78</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>79</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>80</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>81</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>82</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>83</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>84</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>85</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>86</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>87</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>88</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>89</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>90</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>91</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>92</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>93</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>94</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>95</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>96</Pos><Qty>42.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

- [ ] **Step 3: Write `invalid-negative-quantity-96.xml`**

**Hand-written, ninety-six points, with `Pos` 50 carrying `-12.500`.**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     Integration-spec 8.2 rule 9: Qty >= 0. Pos 50 carries -12.500. [AS-05] and
     position-and-coverage 2.1 keep consumption and production as two separate NON-NEGATIVE
     series; netUsage is derived per interval and is never stored as a signed source series. A
     negative quantity on a consumption series therefore means a direction has been mapped
     wrong somewhere upstream, and under [DEC-22] that is a wrong invoice.
     The count is 96 and the positions are contiguous, so only the sign rule can catch it. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>8e0a2c4e-6c8e-4e0a-2c4e-6c8e0a2c4ed1</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>0a2c4e6c-8e0a-4a2c-4e6c-8e0a2c4e6cd3</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>5</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>6</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>7</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>8</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>9</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>10</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>11</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>12</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>13</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>14</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>15</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>16</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>17</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>18</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>19</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>20</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>21</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>22</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>23</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>24</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>25</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>26</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>27</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>28</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>29</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>30</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>31</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>32</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>33</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>34</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>35</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>36</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>37</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>38</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>39</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>40</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>41</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>42</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>43</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>44</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>45</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>46</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>47</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>48</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>49</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>50</Pos><Qty>-12.500</Qty></Point>
          <Point><Pos>51</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>52</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>53</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>54</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>55</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>56</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>57</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>58</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>59</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>60</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>61</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>62</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>63</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>64</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>65</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>66</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>67</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>68</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>69</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>70</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>71</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>72</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>73</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>74</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>75</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>76</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>77</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>78</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>79</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>80</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>81</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>82</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>83</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>84</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>85</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>86</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>87</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>88</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>89</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>90</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>91</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>92</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>93</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>94</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>95</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>96</Pos><Qty>42.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

- [ ] **Step 4: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedPointTests.cs`:

```csharp
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Integration.Brp.Pvned;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// Integration-spec section 8.2 rules 7, 8 and 9, in that order.
/// </summary>
public sealed class PvnedPointTests
{
    [Fact]
    public void Ninety_five_points_on_a_ninety_six_point_day_is_INCOMPLETE_PERIOD()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-incomplete-period-95.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.FailureCode.ShouldBe(PvnedFailureCodes.IncompletePeriod);
        outcome.Document.ShouldBeNull();
    }

    [Fact]
    public void The_incomplete_period_detail_names_both_counts_and_the_date()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-incomplete-period-95.xml");

        outcome.FailureDetail.ShouldNotBeNull();
        outcome.FailureDetail.ShouldContain("95", Case.Sensitive);
        outcome.FailureDetail.ShouldContain("96", Case.Sensitive);
        outcome.FailureDetail.ShouldContain("2026-08-12", Case.Sensitive);
    }

    [Fact]
    public void A_duplicated_position_is_INVALID_POSITIONS_even_with_the_right_count()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-invalid-positions-96.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.FailureCode.ShouldBe(
            PvnedFailureCodes.InvalidPositions,
            "the document has 96 points, so the count rule passes it; Pos 42 twice and Pos 43 "
            + "never is a hole and a double-count that only the contiguity rule can see");
    }

    [Fact]
    public void The_invalid_positions_detail_names_the_first_position_that_is_wrong()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-invalid-positions-96.xml");

        outcome.FailureDetail.ShouldNotBeNull();
        outcome.FailureDetail.ShouldContain("43", Case.Sensitive);
    }

    [Fact]
    public void A_negative_quantity_is_NEGATIVE_QUANTITY()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-negative-quantity-96.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.FailureCode.ShouldBe(
            PvnedFailureCodes.NegativeQuantity,
            "[AS-05] keeps both series non-negative; a negative reading means a direction has "
            + "been mapped wrong, which under [DEC-22] is a wrong invoice");
        outcome.Document.ShouldBeNull();
    }

    [Fact]
    public void The_negative_quantity_detail_names_the_position_and_the_value()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-negative-quantity-96.xml");

        outcome.FailureDetail.ShouldNotBeNull();
        outcome.FailureDetail.ShouldContain("50", Case.Sensitive);
        outcome.FailureDetail.ShouldContain("-12.500", Case.Sensitive);
    }

    [Fact]
    public void The_count_rule_runs_before_the_contiguity_rule()
    {
        // The pinned order matters because it decides which code an operator sees. A document
        // that is both short AND out of order is INCOMPLETE_PERIOD, because "we did not get a
        // whole day" is the more actionable sentence: the fix is a resend, not an investigation.
        var shortAndDuplicated = PvnedFixtures.Text("invalid-invalid-positions-96.xml")
            .Replace(
                "          <Point><Pos>96</Pos><Qty>42.000</Qty></Point>\n",
                string.Empty,
                StringComparison.Ordinal);

        var outcome = PvnedAdapterHarness.Create().Parse(new BrpParseRequest(
            InboundMessageId: Guid.CreateVersion7(),
            BrpId: PvnedAdapterHarness.PvnedBrpId,
            BrpCode: "PVNED",
            CorrelationId: Guid.CreateVersion7(),
            Payload: System.Text.Encoding.UTF8.GetBytes(shortAndDuplicated),
            ReceivedAt: PvnedAdapterHarness.DefaultNow));

        outcome.FailureCode.ShouldBe(PvnedFailureCodes.IncompletePeriod);
    }

    [Fact]
    public void The_expected_count_is_asked_of_the_calendar_and_is_not_the_constant_ninety_six()
    {
        // The spring fixture carries 92 points and is accepted. An implementation that hard-codes
        // 96 rejects a perfectly good DST document with INCOMPLETE_PERIOD; task 12 mutates for it.
        var outcome = PvnedAdapterHarness.Parse("golden-a23-dst-spring-92.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Accepted, outcome.FailureDetail);
        outcome.Document.ShouldNotBeNull();
        outcome.Document.Series[0].Points.Count.ShouldBe(92);
        outcome.Document.Series[0].ExpectedIntervalCount.ShouldBe(92);
    }

    [Fact]
    public void The_golden_document_still_passes_all_three_point_rules()
    {
        PvnedAdapterHarness.Parse("golden-a23-both-directions-96.xml")
            .Status.ShouldBe(BrpParseStatus.Accepted);
    }
}
```

- [ ] **Step 5: Run it and watch it fail**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedPointTests"
```
Expected: FAIL — six of nine.
`Ninety_five_points_on_a_ninety_six_point_day_is_INCOMPLETE_PERIOD`,
`A_duplicated_position_is_INVALID_POSITIONS_even_with_the_right_count`,
`A_negative_quantity_is_NEGATIVE_QUANTITY` and `The_count_rule_runs_before_the_contiguity_rule`
all report a status or code of `Accepted`/`null` where a rejection was expected, and the two
detail tests fail with `outcome.FailureDetail should not be null`.

- [ ] **Step 6: Add the three guards**

In `PvnedIngestionAdapter.ParseSeries`, insert immediately after the point loop's closing brace
and before the `return SeriesOutcome.Parsed(...)`:

```csharp
        // Integration-spec 8.2 rule 7. The expected count comes from IMarketCalendar every
        // time and is never the constant 96: the spring-forward day has 92 and the autumn
        // fall-back day has 100, and a hard-coded 96 rejects both while accepting a 96-point
        // document for either date - which is plausible data at the wrong times.
        if (points.Count != expectedIntervalCount)
        {
            return SeriesOutcome.Rejected(
                PvnedFailureCodes.IncompletePeriod,
                $"TimeSeries {index.ToString(CultureInfo.InvariantCulture)} carries "
                + $"{points.Count.ToString(CultureInfo.InvariantCulture)} quantified points for "
                + $"delivery date {deliveryDate:yyyy-MM-dd}, and that date has "
                + $"{expectedIntervalCount.ToString(CultureInfo.InvariantCulture)} "
                + "fifteen-minute intervals.");
        }

        // Integration-spec 8.2 rule 8. A document with the right NUMBER of points and a
        // duplicated position has a hole and a double-count in it, and no count check sees
        // either.
        for (var expectedPos = 1; expectedPos <= points.Count; expectedPos++)
        {
            if (points[expectedPos - 1].Pos != expectedPos)
            {
                return SeriesOutcome.Rejected(
                    PvnedFailureCodes.InvalidPositions,
                    $"TimeSeries {index.ToString(CultureInfo.InvariantCulture)} has Pos "
                    + $"{points[expectedPos - 1].Pos.ToString(CultureInfo.InvariantCulture)} "
                    + $"where {expectedPos.ToString(CultureInfo.InvariantCulture)} was expected. "
                    + "Positions must run contiguously from 1 with no duplicates.");
            }
        }

        // Integration-spec 8.2 rule 9, and [AS-05].
        var negative = points.FirstOrDefault(point => point.QuantityKwh < 0m);
        if (negative is not null)
        {
            return SeriesOutcome.Rejected(
                PvnedFailureCodes.NegativeQuantity,
                $"TimeSeries {index.ToString(CultureInfo.InvariantCulture)} carries "
                + $"{negative.QuantityKwh.ToString("0.000", CultureInfo.InvariantCulture)} kWh at "
                + $"Pos {negative.Pos.ToString(CultureInfo.InvariantCulture)}. Consumption and "
                + "production are two separate non-negative series [AS-05]; net usage is derived "
                + "per interval and is never a source value.");
        }
```

⚠ The contiguity check reads `points[expectedPos - 1].Pos`, which relies on the points being in
**document order** — they are, because the loop appends as it reads. It deliberately does **not**
sort first: a document whose positions arrive out of order is also a document this adapter should
refuse, and sorting would hide it.

- [ ] **Step 7: Run the test and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~Ingestion.Pvned"
```
Expected: PASS — the whole PVNed suite green.

- [ ] **Step 8: Mutation — hard-code 96 instead of asking the calendar**

```csharp
        if (points.Count != 96)
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~Ingestion.Pvned"`
Expected: FAIL — every test that reads `golden-a23-dst-spring-92.xml` goes red, including
`The_expected_count_is_asked_of_the_calendar_and_is_not_the_constant_ninety_six`
(`outcome.Status should be Accepted but was Rejected`), the four
`PvnedMeasurementUnitTests` MWh tests, and
`The_spring_days_twenty_three_hour_period_is_accepted` in `PvnedPeriodTests`.

Then restore `expectedIntervalCount`.

- [ ] **Step 9: Mutation — compare position sets rather than the sequence**

The plausible wrong implementation, which looks more thorough and is weaker:

```csharp
        var distinct = points.Select(point => point.Pos).Distinct().Count();
        if (distinct != points.Count)
        {
            return SeriesOutcome.Rejected(
                PvnedFailureCodes.InvalidPositions,
                "Positions must run contiguously from 1 with no duplicates.");
        }
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedPointTests"`
Expected: FAIL — one test,
`The_invalid_positions_detail_names_the_first_position_that_is_wrong`, with
`outcome.FailureDetail should contain "43"`.
`A_duplicated_position_is_INVALID_POSITIONS_even_with_the_right_count` **stays green**, because
the duplicate really is caught by a distinct-count.

⚠ **Read that carefully before moving on.** The distinct-count catches a duplicate and misses an
out-of-order run entirely: positions `1, 2, 4, 3, 5…` are 96 distinct values and pass. If you want
that proven rather than argued, reorder two `<Point>` elements in a copy of the golden fixture in
a scratch file and check that the sequence comparison rejects it while the distinct-count accepts
it. Do not leave the distinct-count in place.

Then restore the sequence comparison.

- [ ] **Step 10: Mutation — clamp negatives to zero instead of rejecting**

The "be forgiving" mistake, which is a silent data change:

```csharp
                points.Add(new CanonicalPoint(
                    pos,
                    Math.Max(
                        0m,
                        decimal.Round(
                            quantity * quantityMultiplier.Value, 3,
                            MidpointRounding.AwayFromZero))));
```

(and delete the `NEGATIVE_QUANTITY` guard, since nothing can reach it).

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedPointTests"`
Expected: FAIL — two tests, `A_negative_quantity_is_NEGATIVE_QUANTITY`
(`outcome.Status should be Rejected but was Accepted`) and
`The_negative_quantity_detail_names_the_position_and_the_value`. Note what the mutation would have
done in production: a day silently 12,5 kWh light at Pos 50, invoiced, with no failure anywhere.

Then restore the guard and the unclamped rounding.

- [ ] **Step 11: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedIngestionAdapter.cs \
        tests/PeakPower.Application.Tests/Ingestion/Pvned
git commit -m "pvned: point count, contiguity and the non-negative rule

Integration-spec 8.2 rules 7, 8 and 9. The expected count comes from IMarketCalendar every time
and is never the constant 96 - hard-coding it rejects the 92-point spring day and the 100-point
autumn day while accepting a 96-point document for either, which is plausible data at the wrong
times.

Contiguity is a SEQUENCE comparison against document order, not a distinct-count: a distinct-count
catches a duplicate and misses an out-of-order run entirely, and sorting first would hide the
case the rule exists for.

Verified by mutation: hard-coding 96 reddens every spring-day test across three classes; the
distinct-count reddens only the detail assertion while the duplicate test stays green (recorded,
with the out-of-order case checked by hand); and clamping a negative to zero reddens two tests
while silently costing a day 12,5 kWh in production."
```

---

### Task 12: The two DST days — 92 intervals, 100 intervals, and the 96-point document rejected for both

Design §10 and shared contract §15.2 name the DST mapping as one of the four things that must be
mutation-verified explicitly. Task 11 already asks the calendar for the expected count; this task
is what proves the answer is *used* on both irregular days, and it closes the mutation Task 7
step 8 recorded as **"no failure yet — closed by Task 12"**.

- **The autumn fall-back Sunday, 2026-10-25**, has 100 quarter-hours. Local midnight is
  `2026-10-24T22:00:00Z` (CEST, +02:00) and the next local midnight is `2026-10-25T23:00:00Z`
  (CET, +01:00): twenty-five hours of UTC. `Pos` 9–12 are the **first** pass of local 02:00–03:00
  and `Pos` 13–16 the **second**.
- **The spring-forward Sunday, 2026-03-29**, has 92. Local midnight is `2026-03-28T23:00:00Z`
  (CET) and the next is `2026-03-29T22:00:00Z` (CEST): twenty-three hours. Its fixture landed in
  Task 9 because the MWh conversion rides on it; this task is where its *interval count* is
  asserted.
- **A 96-point document is wrong on both dates**, and it is wrong in the most dangerous way there
  is: it is plausible. Every quantity is a sensible number, every position is contiguous, the
  schema passes it, and only `IMarketCalendar.ExpectedIntervalCount` can tell that a day which
  had 100 intervals was reported with 96.

⚠ **No new production code.** Every rule this task asserts was written in Tasks 10 and 11. The
tests come first anyway, and they fail first on the fixture loader's own message, which is worth
seeing once: it is the error every later contributor will meet when they add a file to the wrong
folder.

**Files:**
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/golden-a23-dst-autumn-100.xml`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-incomplete-period-autumn-96.xml`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-incomplete-period-spring-96.xml`
- Test: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedDstTests.cs`

**Interfaces:**
- Consumes: `PvnedAdapterHarness.Parse` (Task 6); `PvnedFixtures.Text` (Task 4);
  `PvnedFailureCodes.IncompletePeriod` (Task 2); `IMarketCalendar.ExpectedIntervalCount`
  (plan 1, through the real `MarketCalendar` the harness builds).
- Produces: nothing new. No type, no member, no signature changes.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedDstTests.cs`:

```csharp
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Integration.Brp.Pvned;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// The two irregular days. Design section 10 and shared contract section 15.2 list the DST
/// mapping among the four behaviours that must be mutation-verified explicitly.
/// </summary>
/// <remarks>
/// <para>
/// The expected interval count comes from <c>IMarketCalendar.ExpectedIntervalCount</c> and is
/// never the constant 96. These tests drive the REAL MarketCalendar through
/// <see cref="PvnedAdapterHarness"/> rather than a substitute, because a stubbed calendar that
/// returns whatever the test asked for would assert nothing about the mapping itself - and the
/// mapping is the thing design section 10 is worried about.
/// </para>
/// <para>
/// A 96-point document on either date is the failure mode worth naming: every quantity in it is
/// plausible, every position is contiguous, and the reconstructed XSD passes it. Nothing but the
/// calendar can see that a day which had 100 quarter-hours was reported with 96.
/// </para>
/// </remarks>
public sealed class PvnedDstTests
{
    [Fact]
    public void The_autumn_fall_back_day_carries_a_hundred_intervals()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a23-dst-autumn-100.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Accepted, outcome.FailureDetail);
        outcome.Document.ShouldNotBeNull();
        outcome.Document.Series.Count.ShouldBe(1);
        outcome.Document.Series[0].DeliveryDate.ShouldBe(new DateOnly(2026, 10, 25));
        outcome.Document.Series[0].ExpectedIntervalCount.ShouldBe(100);
        outcome.Document.Series[0].Points.Count.ShouldBe(100);
        outcome.Document.Series[0].Points[^1].Pos.ShouldBe(100);
    }

    [Fact]
    public void The_two_passes_of_two_oclock_are_two_distinct_blocks()
    {
        // Pos 9-12 are the FIRST pass of local 02:00-03:00 (CEST) and Pos 13-16 the SECOND
        // (CET). The fixture gives them different quantities on purpose: an implementation that
        // deduplicated the repeated local hour, or that folded the two passes together, would
        // report the same number twice and nothing else in the suite would notice.
        var outcome = PvnedAdapterHarness.Parse("golden-a23-dst-autumn-100.xml");

        outcome.Document.ShouldNotBeNull();
        var points = outcome.Document.Series[0].Points;

        points[8].Pos.ShouldBe(9);
        points[8].QuantityKwh.ShouldBe(38.000m);
        points[12].Pos.ShouldBe(13);
        points[12].QuantityKwh.ShouldBe(30.000m);
        points[12].QuantityKwh.ShouldNotBe(points[8].QuantityKwh);
    }

    [Fact]
    public void The_spring_forward_day_carries_ninety_two_intervals()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a23-dst-spring-92.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Accepted, outcome.FailureDetail);
        outcome.Document.ShouldNotBeNull();
        outcome.Document.Series[0].DeliveryDate.ShouldBe(new DateOnly(2026, 3, 29));
        outcome.Document.Series[0].ExpectedIntervalCount.ShouldBe(92);
        outcome.Document.Series[0].Points.Count.ShouldBe(92);
    }

    [Fact]
    public void Neither_DST_day_has_ninety_six_intervals()
    {
        // The client-side rule "a day has 96 quarter-hours" is the bug DST exists to catch, and
        // it is asserted here as a negative so that a single hard-coded 96 cannot satisfy both
        // days at once.
        var autumn = PvnedAdapterHarness.Parse("golden-a23-dst-autumn-100.xml");
        var spring = PvnedAdapterHarness.Parse("golden-a23-dst-spring-92.xml");

        autumn.Document.ShouldNotBeNull();
        spring.Document.ShouldNotBeNull();

        autumn.Document.Series[0].ExpectedIntervalCount.ShouldNotBe(96);
        spring.Document.Series[0].ExpectedIntervalCount.ShouldNotBe(96);
        autumn.Document.Series[0].ExpectedIntervalCount
            .ShouldNotBe(spring.Document.Series[0].ExpectedIntervalCount);
    }

    [Fact]
    public void The_two_DST_days_local_midnights_sit_at_different_instants_of_UTC()
    {
        // 25 October's local midnight is 22:00Z the day before (CEST); 29 March's is 23:00Z
        // (CET). Both documents nonetheless resolve to the delivery date printed on them. A
        // "the Netherlands is UTC+1" shortcut puts the autumn document on 24 October; a
        // "the Netherlands is UTC+2" shortcut is caught by step 7's mutation instead.
        var autumn = PvnedAdapterHarness.Parse("golden-a23-dst-autumn-100.xml");
        var spring = PvnedAdapterHarness.Parse("golden-a23-dst-spring-92.xml");

        PvnedFixtures.Text("golden-a23-dst-autumn-100.xml")
            .ShouldContain("<StartPeriod>2026-10-24T22:00:00Z</StartPeriod>", Case.Sensitive);
        PvnedFixtures.Text("golden-a23-dst-spring-92.xml")
            .ShouldContain("<StartPeriod>2026-03-28T23:00:00Z</StartPeriod>", Case.Sensitive);

        autumn.Document.ShouldNotBeNull();
        spring.Document.ShouldNotBeNull();
        autumn.Document.Series[0].DeliveryDate.ShouldBe(new DateOnly(2026, 10, 25));
        spring.Document.Series[0].DeliveryDate.ShouldBe(new DateOnly(2026, 3, 29));
    }

    [Fact]
    public void A_ninety_six_point_document_on_the_autumn_date_is_INCOMPLETE_PERIOD()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-incomplete-period-autumn-96.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.FailureCode.ShouldBe(
            PvnedFailureCodes.IncompletePeriod,
            "25 October 2026 has 100 quarter-hours; a 96-point document for it is four "
            + "intervals short and every one of its numbers is plausible");
        outcome.Document.ShouldBeNull();
    }

    [Fact]
    public void A_ninety_six_point_document_on_the_spring_date_is_INCOMPLETE_PERIOD()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-incomplete-period-spring-96.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.FailureCode.ShouldBe(
            PvnedFailureCodes.IncompletePeriod,
            "29 March 2026 has 92 quarter-hours; a 96-point document for it carries four "
            + "intervals that did not happen");
        outcome.Document.ShouldBeNull();
    }

    [Fact]
    public void The_incomplete_period_detail_names_the_date_and_both_counts()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-incomplete-period-autumn-96.xml");

        outcome.FailureDetail.ShouldNotBeNull();
        outcome.FailureDetail.ShouldContain("2026-10-25", Case.Sensitive);
        outcome.FailureDetail.ShouldContain("96", Case.Sensitive);
        outcome.FailureDetail.ShouldContain("100", Case.Sensitive);
    }

    [Fact]
    public void The_autumn_day_totals_the_hand_computed_figure()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a23-dst-autumn-100.xml");

        outcome.Document.ShouldNotBeNull();
        outcome.Document.Series[0].Points.Sum(point => point.QuantityKwh)
            .ShouldBe(10856.000m);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDstTests"
```
Expected: FAIL — eight of nine, all with the fixture loader's own message:
`System.InvalidOperationException : There is no PVNed fixture named
'golden-a23-dst-autumn-100.xml'. The 19 that exist are: golden-a12-imbalance.xml, …`.
`The_spring_forward_day_carries_ninety_two_intervals` **passes**, because Task 9 already checked
its fixture in and Tasks 10 and 11 already made it parse — which is the honest starting point for
this task: half of what it asserts is already true and unproven.

- [ ] **Step 3: Write `golden-a23-dst-autumn-100.xml`**

**Hand-written. All one hundred points. Copy it literally; do not generate it.**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/golden-a23-dst-autumn-100.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     The autumn fall-back Sunday, 25 October 2026: local 02:00-03:00 happens twice, so the day
     has 25 hours and 100 quarter-hours. MeasurementPeriode runs 2026-10-24T22:00:00Z (local
     midnight, CEST, +02:00) to 2026-10-25T23:00:00Z (local midnight the next day, CET, +01:00)
     - 25 hours of UTC, which is what makes a "the period is 24 hours long" check wrong.

     Pos blocks map to local hours 00, 01, 02 (FIRST pass), 02 (SECOND pass), 03, 04, ... 23.
     Pos 9-12 carry 38.000 and Pos 13-16 carry 30.000: the two passes of two o'clock are
     DELIBERATELY different, so that an implementation which deduplicated the repeated local
     hour, or folded the two passes together, reports the same number twice and a test sees it.

     Consumption totals 10856.000 kWh. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>6a8c0e2a-4c6e-4a8c-0e2a-4c6e8a0c2e81</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-10-26T04:05:00Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-10-24T22:00:00Z</StartPeriod>
        <EndPeriod>2026-10-25T23:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>8c0e2a4c-6e8a-4c0e-2a4c-6e8a0c2e4a83</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-10-24T22:00:00Z</StartPeriod>
          <EndPeriod>2026-10-25T23:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>5</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>6</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>7</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>8</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>9</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>10</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>11</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>12</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>13</Pos><Qty>30.000</Qty></Point>
          <Point><Pos>14</Pos><Qty>30.000</Qty></Point>
          <Point><Pos>15</Pos><Qty>30.000</Qty></Point>
          <Point><Pos>16</Pos><Qty>30.000</Qty></Point>
          <Point><Pos>17</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>18</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>19</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>20</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>21</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>22</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>23</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>24</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>25</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>26</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>27</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>28</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>29</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>30</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>31</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>32</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>33</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>34</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>35</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>36</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>37</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>38</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>39</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>40</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>41</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>42</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>43</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>44</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>45</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>46</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>47</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>48</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>49</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>50</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>51</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>52</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>53</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>54</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>55</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>56</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>57</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>58</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>59</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>60</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>61</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>62</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>63</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>64</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>65</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>66</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>67</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>68</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>69</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>70</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>71</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>72</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>73</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>74</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>75</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>76</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>77</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>78</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>79</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>80</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>81</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>82</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>83</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>84</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>85</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>86</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>87</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>88</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>89</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>90</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>91</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>92</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>93</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>94</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>95</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>96</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>97</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>98</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>99</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>100</Pos><Qty>42.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

- [ ] **Step 4: Write `invalid-incomplete-period-autumn-96.xml`**

**Hand-written, ninety-six points, on the hundred-point date.** The `MeasurementPeriode` is the
correct one for 25 October — twenty-five hours, exactly the Amsterdam day — so
`INVALID_MEASUREMENT_PERIOD` cannot fire and the count rule is the only thing left that can
reject it. That isolation is the whole point of the fixture.

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-incomplete-period-autumn-96.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     Integration-spec 8.2 rule 7 on the autumn fall-back Sunday. 25 October 2026 has 100
     quarter-hours; this document reports 96 of them, contiguously from Pos 1, with entirely
     plausible quantities and a MeasurementPeriode that is exactly right for the date.

     This is the document a "a day has 96 intervals" implementation accepts and a correct one
     refuses, and there is nothing in it a schema could object to. It is the four missing
     intervals of a fall-back Sunday: four quarter-hours of consumption invoiced to nobody. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>8e0a2c4e-6a8c-4e0a-2c4e-6a8c0e2a4c85</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-10-26T04:05:00Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-10-24T22:00:00Z</StartPeriod>
        <EndPeriod>2026-10-25T23:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>0a2c4e6a-8c0e-4a2c-4e6a-8c0e2a4c6e87</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-10-24T22:00:00Z</StartPeriod>
          <EndPeriod>2026-10-25T23:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>5</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>6</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>7</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>8</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>9</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>10</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>11</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>12</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>13</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>14</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>15</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>16</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>17</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>18</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>19</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>20</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>21</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>22</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>23</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>24</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>25</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>26</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>27</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>28</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>29</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>30</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>31</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>32</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>33</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>34</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>35</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>36</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>37</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>38</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>39</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>40</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>41</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>42</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>43</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>44</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>45</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>46</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>47</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>48</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>49</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>50</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>51</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>52</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>53</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>54</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>55</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>56</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>57</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>58</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>59</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>60</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>61</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>62</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>63</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>64</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>65</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>66</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>67</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>68</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>69</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>70</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>71</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>72</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>73</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>74</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>75</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>76</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>77</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>78</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>79</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>80</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>81</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>82</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>83</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>84</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>85</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>86</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>87</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>88</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>89</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>90</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>91</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>92</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>93</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>94</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>95</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>96</Pos><Qty>42.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

- [ ] **Step 5: Write `invalid-incomplete-period-spring-96.xml`**

**Hand-written, ninety-six points, on the ninety-two-point date.** The mirror of step 4, and the
more expensive of the two errors: four quarter-hours that did not happen, reported as if they had.

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-incomplete-period-spring-96.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     Integration-spec 8.2 rule 7 on the spring-forward Sunday. 29 March 2026 has 92
     quarter-hours because local 02:00-03:00 does not exist; this document reports 96,
     contiguously from Pos 1, with a MeasurementPeriode that is exactly right for the date -
     2026-03-28T23:00:00Z to 2026-03-29T22:00:00Z, twenty-three hours.

     The unit is KWH rather than the MWH of golden-a23-dst-spring-92.xml, so that the count rule
     is isolated from the conversion: this fixture must fail for one reason and one only. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>2c4e6a8c-0e2a-4c4e-6a8c-0e2a4c6e8a89</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-03-30T04:05:00Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-03-28T23:00:00Z</StartPeriod>
        <EndPeriod>2026-03-29T22:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>4e6a8c0e-2a4c-4e6a-8c0e-2a4c6e8a0c91</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-03-28T23:00:00Z</StartPeriod>
          <EndPeriod>2026-03-29T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>5</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>6</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>7</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>8</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>9</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>10</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>11</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>12</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>13</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>14</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>15</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>16</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>17</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>18</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>19</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>20</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>21</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>22</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>23</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>24</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>25</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>26</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>27</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>28</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>29</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>30</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>31</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>32</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>33</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>34</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>35</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>36</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>37</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>38</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>39</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>40</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>41</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>42</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>43</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>44</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>45</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>46</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>47</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>48</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>49</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>50</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>51</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>52</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>53</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>54</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>55</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>56</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>57</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>58</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>59</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>60</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>61</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>62</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>63</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>64</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>65</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>66</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>67</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>68</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>69</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>70</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>71</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>72</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>73</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>74</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>75</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>76</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>77</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>78</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>79</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>80</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>81</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>82</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>83</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>84</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>85</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>86</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>87</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>88</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>89</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>90</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>91</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>92</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>93</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>94</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>95</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>96</Pos><Qty>42.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

- [ ] **Step 6: Run the test and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDstTests"
```
Expected: PASS — 9 passed, 0 failed. No production code changed in this task; Tasks 10 and 11
already wrote every rule these nine assert.

- [ ] **Step 7: Mutation — check the period is twenty-four hours long instead of one Amsterdam day**

This is the shortcut Task 10's comment warns against, written out. In
`PvnedIngestionAdapter.ParseSeries`, temporarily replace the period-equality guard's condition:

```csharp
        if (periodEnd - periodStart != TimeSpan.FromHours(24))
```

(leave the rest of the block, including its `expectedStart`/`expectedEnd` message, alone so it
still compiles.)

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDstTests"`
Expected: FAIL — **all nine**. The spring day is twenty-three hours of UTC and the autumn day is
twenty-five, so both golden documents are rejected: `The_spring_forward_day_carries_ninety_two_intervals`
and `The_autumn_fall_back_day_carries_a_hundred_intervals` report
`outcome.Status should be Accepted but was Rejected`, and the two `INCOMPLETE_PERIOD` tests report
`outcome.FailureCode should be "INCOMPLETE_PERIOD" but was "INVALID_MEASUREMENT_PERIOD"` — the
mutation does not merely lose the count rule, it answers the operator with the wrong sentence.

⚠ Note what this mutation would have done in production and no summer test could see: **every
document for either DST Sunday rejected, once a year, twice a year.** Then restore
`periodStart != expectedStart || periodEnd != expectedEnd`.

- [ ] **Step 8: Mutation — Task 7 step 8's fixed offset, both halves, and the honest result of each**

Task 7 step 8 recorded *"no failure yet — closed by Task 12"* against the fixed-offset shortcut.
This step closes it. Run all three halves in order and record all three results — the first one is
not the answer, and pretending otherwise is how a mutation record becomes decoration.

**8a — the date conversion, exactly as Task 7 wrote it.** Temporarily replace:

```csharp
    private static DateOnly AmsterdamDateOf(DateTimeOffset instant) =>
        DateOnly.FromDateTime(instant.UtcDateTime.AddHours(2));
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDstTests"`
Expected: **PASS — all nine, on both DST days.** Record it as a pass, not as a miss.

⚠ **Understand why before moving on, because it is not obvious and Task 7 predicted otherwise.**
Every `MeasurementPeriode` in this format starts at *local midnight*, which is `22:00Z` the day
before in CEST and `23:00Z` in CET. Adding two hours to either lands at `00:00` or `01:00` **on
the delivery date**, so the date never flips. The `+2` shortcut is invisible to `AmsterdamDateOf`
for any well-formed document, and the DST fixtures could not have changed that. What it is *not*
invisible to is the offset used to rebuild local midnight — 8b and 8c.

Restore `TimeZoneInfo.ConvertTime`.

**8b — the same shortcut where the offset actually decides something.** Temporarily replace:

```csharp
    private static DateTimeOffset AmsterdamMidnight(DateOnly date) =>
        new(date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified), TimeSpan.FromHours(2));
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDstTests"`
Expected: FAIL — **exactly four, all of them spring.** `expectedStart` for 2026-03-29 becomes
`2026-03-28T22:00:00Z` where the document carries `23:00:00Z`, so
`The_spring_forward_day_carries_ninety_two_intervals` reports
`outcome.Status should be Accepted but was Rejected`;
`Neither_DST_day_has_ninety_six_intervals` and
`The_two_DST_days_local_midnights_sit_at_different_instants_of_UTC` report
`spring.Document should not be null`; and
`A_ninety_six_point_document_on_the_spring_date_is_INCOMPLETE_PERIOD` reports
`outcome.FailureCode should be "INCOMPLETE_PERIOD" but was "INVALID_MEASUREMENT_PERIOD"`.
**Every autumn test stays green**, because 25 October's local midnight really is `+02:00`.

Restore `Amsterdam.GetUtcOffset(localMidnight)`.

**8c — the mirror, so the asymmetry is proven rather than argued.** Temporarily replace the same
line with `TimeSpan.FromHours(1)`.

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDstTests"`
Expected: FAIL — **seven, all of them autumn**: the five that read
`golden-a23-dst-autumn-100.xml` plus
`A_ninety_six_point_document_on_the_autumn_date_is_INCOMPLETE_PERIOD` and
`The_incomplete_period_detail_names_the_date_and_both_counts`. **Every spring test stays green.**

**Record all three.** With 8b and 8c run, the DST mapping is mutation-verified: no single fixed
offset can satisfy both Sundays, and the reason the date half of the shortcut is invisible is
written down instead of assumed. Then restore `Amsterdam.GetUtcOffset(localMidnight)`.

- [ ] **Step 9: Mutation — treat the repeated hour as a duplicate and drop it**

The plausible misreading of `IMarketCalendar.IsDstDuplicate`: the name says duplicate, so skip it.
In the point loop of `ParseSeries`, temporarily insert immediately before `points.Add(...)`:

```csharp
                if (_calendar.IsDstDuplicate(deliveryDate, pos))
                {
                    continue;
                }
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedDstTests"`
Expected: FAIL — **five, all of them autumn.** Whichever of the two passes of 02:00 the calendar
marks, four points vanish, so the autumn golden carries 96 on a 100-interval date and is rejected:
`The_autumn_fall_back_day_carries_a_hundred_intervals` reports
`outcome.Status should be Accepted but was Rejected`, and `The_two_passes_of_two_oclock_are_two_distinct_blocks`,
`Neither_DST_day_has_ninety_six_intervals`,
`The_two_DST_days_local_midnights_sit_at_different_instants_of_UTC` and
`The_autumn_day_totals_the_hand_computed_figure` follow it. **Every spring test stays green**,
because 29 March has no repeated hour to drop.

⚠ `IsDstDuplicate` marks the **second** pass so a caller can *label* it, not so a parser can
discard it. Both passes are real hours with real consumption in them, and dropping four of them
is an hour of a customer's day billed to nobody. Then remove the inserted block.

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Application.Tests/Ingestion/Pvned
git commit -m "pvned: the two DST days, and the 96-point document that is wrong on both

25 October 2026 has 100 quarter-hours and 29 March 2026 has 92. The autumn fixture gives the two
passes of local 02:00 different quantities on purpose, so an implementation that folded them
together reports the same number twice and a test sees it.

A 96-point document for either date is the dangerous case: every quantity plausible, every
position contiguous, the schema satisfied, and only IMarketCalendar.ExpectedIntervalCount able to
tell that a day which had 100 intervals was reported with 96.

This closes the mutation task 7 step 8 deferred, and closes it honestly. The fixed-offset shortcut
is invisible to the DATE conversion - a period anchored at local midnight is 22:00Z or 23:00Z the
day before, and adding two hours lands on the delivery date either way - and that is now written
down rather than assumed. Where the offset does decide something, rebuilding local midnight, +02:00
reddens four spring tests with every autumn test green and +01:00 reddens seven autumn tests with
every spring test green. No single fixed offset satisfies both Sundays.

Also verified by mutation: a 24-hour duration check reddens all nine (both Sundays rejected, twice
a year, invisibly to every summer test), and skipping the IsDstDuplicate positions reddens five
autumn tests - that flag exists to LABEL the second pass, not to discard it."
```

---

### Task 13: `ResourceObject` — eighteen digits is an EAN, and anything else never is

`[F02-R11]` and `[AS-17]`, restated by shared contract §7.1: **eighteen digits is an EAN; anything
else is a descriptive resource label** (`Prognosis`, `Realisation`, `Imbalance`, …) and is
**never** offered to the EAN resolver. The adapter carries the raw string through verbatim
alongside the parsed `EanCode`, because the pipeline needs the string it actually received to put
on a `quarantined_series` row, and because a label handed to the resolver quarantines as a false
`UNKNOWN_EAN` — a support ticket about a connection that was never in the document.

⚠ **The adapter still resolves nothing.** `ResourceObjectIsEan` is a statement about the *shape*
of eighteen characters, not about whether that EAN is registered, valid on the date, or assigned
to this BRP. Those three are `UNKNOWN_EAN`, `EAN_VALIDITY` and `WRONG_BRP`, they are pipeline
decisions against `customer.metering_point` (contract §8.5), and `[F02-R40]` forbids an adapter
reimplementing one. Task 15 asserts that it does not.

**Files:**
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/golden-a23-non-ean-resources-96.xml`
- Test: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedResourceObjectTests.cs`

**Interfaces:**
- Consumes: `CanonicalSeries.ResourceObject`, `.ResourceObjectIsEan`, `.Ean` (plan 3);
  `EanCode` (`PeakPower.Domain.Common`, slice 1); `PvnedAdapterHarness`, `PvnedFixtures`.
- Produces: nothing new. Task 7 already writes all three properties; this task is what pins
  their meaning.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedResourceObjectTests.cs`:

```csharp
using System.Text;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Integration.Brp.Pvned;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// [F02-R11] / [AS-17], and shared contract section 7.1's ResourceObject paragraph.
/// </summary>
/// <remarks>
/// <para>
/// Eighteen digits is an EAN. Anything else - a label, a short code, a blank, an absent element -
/// is a descriptive resource name and is NEVER offered to the EAN resolver, because a label
/// handed to the resolver quarantines as a false UNKNOWN_EAN and produces a support ticket about
/// a connection that was never in the document.
/// </para>
/// <para>
/// The raw string is carried through verbatim next to the parsed EanCode. That is not tidiness:
/// the pipeline writes it onto the quarantined_series row, and an adapter that normalised it away
/// would leave an operator looking at a quarantine entry that does not say what arrived.
/// </para>
/// </remarks>
public sealed class PvnedResourceObjectTests
{
    private const string GoldenEan = "871685900000000001";

    [Fact]
    public void An_eighteen_digit_ResourceObject_is_an_EAN()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a23-both-directions-96.xml");

        outcome.Document.ShouldNotBeNull();
        var series = outcome.Document.Series[0];

        series.ResourceObject.ShouldBe(GoldenEan);
        series.ResourceObjectIsEan.ShouldBeTrue();
        series.Ean.ShouldNotBeNull();
    }

    [Fact]
    public void The_EAN_is_the_same_digits_the_document_carried()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a23-both-directions-96.xml");

        outcome.Document.ShouldNotBeNull();
        var series = outcome.Document.Series[0];

        series.Ean.ShouldNotBeNull();
        series.Ean!.Value.Value.ShouldBe(GoldenEan);
        series.Ean!.Value.Value.ShouldBe(series.ResourceObject);
    }

    [Fact]
    public void A_Resource_carrying_only_a_RecourceName_label_is_never_an_EAN()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a23-non-ean-resources-96.xml");

        outcome.Document.ShouldNotBeNull();
        var series = outcome.Document.Series[0];

        series.ResourceObjectIsEan.ShouldBeFalse(
            "the Resource carries a RecourceName of 'Prognosis' and no ResourceObject at all, "
            + "and [AS-17] says anything that is not eighteen digits is a descriptive label");
        series.Ean.ShouldBeNull();
    }

    [Fact]
    public void A_series_with_no_Resource_element_at_all_is_never_an_EAN()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a23-non-ean-resources-96.xml");

        outcome.Document.ShouldNotBeNull();
        var series = outcome.Document.Series[1];

        series.ResourceObject.ShouldBe(string.Empty);
        series.ResourceObjectIsEan.ShouldBeFalse();
        series.Ean.ShouldBeNull();
    }

    [Fact]
    public void A_document_with_no_EAN_anywhere_is_still_accepted_because_quarantine_is_the_pipelines_call()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a23-non-ean-resources-96.xml");

        outcome.Status.ShouldBe(
            BrpParseStatus.Accepted,
            "an unresolvable resource is a quarantine decision against customer.metering_point, "
            + "which [F02-R40] forbids this adapter making - it emits the series and the "
            + "pipeline turns it into a quarantined_series row");
        outcome.FailureCode.ShouldBeNull();
        outcome.Document.ShouldNotBeNull();
        outcome.Document.Series.Count.ShouldBe(2);
    }

    [Fact]
    public void The_reconstructed_schema_accepts_a_Resource_that_carries_only_a_RecourceName()
    {
        // The imbalance sample's Resource carries only a RecourceName, so a schema that demanded
        // ResourceObject would reject PVNed's own document. SchemaProvenance's permissive
        // reading is what keeps both elements minOccurs="0".
        var outcome = PvnedAdapterHarness.Parse("golden-a23-non-ean-resources-96.xml");

        outcome.FailureCode.ShouldNotBe(PvnedFailureCodes.SchemaValidationFailed);
    }

    [Fact]
    public void The_label_series_still_carries_its_quantities()
    {
        var outcome = PvnedAdapterHarness.Parse("golden-a23-non-ean-resources-96.xml");

        outcome.Document.ShouldNotBeNull();
        outcome.Document.Series[0].Points.Count.ShouldBe(96);
        outcome.Document.Series[0].Points.Sum(point => point.QuantityKwh).ShouldBe(10736.000m);
        outcome.Document.Series[1].Points.Count.ShouldBe(96);
        outcome.Document.Series[1].Points.Sum(point => point.QuantityKwh).ShouldBe(1344.000m);
    }

    [Fact]
    public void A_descriptive_label_in_ResourceObject_is_carried_verbatim_and_is_never_an_EAN()
    {
        var outcome = ParseWithResourceObject("Imbalance");

        outcome.Status.ShouldBe(BrpParseStatus.Accepted, outcome.FailureDetail);
        outcome.Document.ShouldNotBeNull();
        outcome.Document.Series[0].ResourceObject.ShouldBe(
            "Imbalance",
            "the pipeline writes this string onto the quarantine row, so the adapter may not "
            + "normalise it away");
        outcome.Document.Series[0].ResourceObjectIsEan.ShouldBeFalse();
        outcome.Document.Series[0].Ean.ShouldBeNull();
    }

    [Fact]
    public void A_seventeen_digit_ResourceObject_is_not_an_EAN()
    {
        var outcome = ParseWithResourceObject("87168590000000000");

        outcome.Status.ShouldBe(BrpParseStatus.Accepted, outcome.FailureDetail);
        outcome.Document.ShouldNotBeNull();
        outcome.Document.Series[0].ResourceObject.ShouldBe("87168590000000000");
        outcome.Document.Series[0].ResourceObjectIsEan.ShouldBeFalse(
            "[DEC-114] relaxed EAN validation to 'eighteen digits' and stopped there; seventeen "
            + "is not eighteen, and the GS1 check digit is [OQ-97] and stays out of this slice");
        outcome.Document.Series[0].Ean.ShouldBeNull();
    }

    [Fact]
    public void A_nineteen_character_ResourceObject_never_reaches_the_EAN_rule_because_the_schema_stops_it()
    {
        // ResourceObject is maxLength 18 in the reconstructed XSD, so nineteen characters is a
        // structural failure and the semantic layer never sees it. Asserted rather than assumed:
        // "it is not an EAN either way" is true and useless - the operator gets a different code.
        var outcome = ParseWithResourceObject("8716859000000000012");

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.FailureCode.ShouldBe(PvnedFailureCodes.SchemaValidationFailed);
    }

    private static BrpParseOutcome ParseWithResourceObject(string replacement)
    {
        var text = PvnedFixtures.Text("golden-a23-both-directions-96.xml")
            .Replace(
                $"<ResourceObject>{GoldenEan}</ResourceObject>",
                $"<ResourceObject>{replacement}</ResourceObject>",
                StringComparison.Ordinal);

        return PvnedAdapterHarness.Create().Parse(new BrpParseRequest(
            InboundMessageId: Guid.CreateVersion7(),
            BrpId: PvnedAdapterHarness.PvnedBrpId,
            BrpCode: "PVNED",
            CorrelationId: Guid.CreateVersion7(),
            Payload: Encoding.UTF8.GetBytes(text),
            ReceivedAt: PvnedAdapterHarness.DefaultNow));
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedResourceObjectTests"
```
Expected: FAIL — five of ten, all with
`System.InvalidOperationException : There is no PVNed fixture named
'golden-a23-non-ean-resources-96.xml'. The 22 that exist are: …`. The five that read the golden
document or a `.Replace` of it pass already, which is worth noticing: the *positive* half of
`[AS-17]` has been true since Task 7 and only the negative half is new.

- [ ] **Step 3: Write `golden-a23-non-ean-resources-96.xml`**

**Hand-written. Two series, ninety-six points each. Copy it literally; do not generate it.**

The first series' `Resource` carries **only** a `RecourceName` — spelled that way, normatively —
and no `ResourceObject`. The second has **no `Resource` element at all**, which the reconstructed
XSD permits (`minOccurs="0"`) because the class diagram does. Both are legitimate documents that
this adapter must accept and hand on; deciding what to do about a series with no EAN is the
pipeline's job.

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/golden-a23-non-ean-resources-96.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     [F02-R11] / [AS-17]: eighteen digits is an EAN and anything else is a descriptive label.
     Two series for 12 August 2026, neither of which carries an EAN:

       series 1 - Resource holds only a RecourceName of "Prognosis". Spelled RecourceName.
                  Normative. Do not "fix" it. Consumption, 96 points, totalling 10736.000 kWh.
       series 2 - no Resource element at all, which the reconstructed XSD permits because the
                  class diagram makes it 0..1. Production, 96 points, totalling 1344.000 kWh.

     Both are ACCEPTED by the adapter. A series with no resolvable EAN is a quarantine decision
     against customer.metering_point, which no adapter may read [F02-R40]: the adapter emits the
     canonical series with ResourceObjectIsEan false and the pipeline writes the quarantine row. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>4e6a8c0e-2a4c-4e6a-8c0e-2a4c6e8a0ca1</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>

      <TimeSeries>
        <mRID>6a8c0e2a-4c6e-4a8c-0e2a-4c6e8a0c2ea3</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <!-- Spelled RecourceName. Normative. Do not "fix" it. No ResourceObject at all. -->
          <RecourceName>Prognosis</RecourceName>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>5</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>6</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>7</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>8</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>9</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>10</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>11</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>12</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>13</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>14</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>15</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>16</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>17</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>18</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>19</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>20</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>21</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>22</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>23</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>24</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>25</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>26</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>27</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>28</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>29</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>30</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>31</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>32</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>33</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>34</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>35</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>36</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>37</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>38</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>39</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>40</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>41</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>42</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>43</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>44</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>45</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>46</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>47</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>48</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>49</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>50</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>51</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>52</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>53</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>54</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>55</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>56</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>57</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>58</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>59</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>60</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>61</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>62</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>63</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>64</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>65</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>66</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>67</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>68</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>69</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>70</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>71</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>72</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>73</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>74</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>75</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>76</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>77</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>78</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>79</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>80</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>81</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>82</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>83</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>84</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>85</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>86</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>87</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>88</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>89</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>90</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>91</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>92</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>93</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>94</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>95</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>96</Pos><Qty>42.000</Qty></Point>
        </Period>
      </TimeSeries>

      <TimeSeries>
        <mRID>8c0e2a4c-6e8a-4c0e-2a4c-6e8a0c2e4aa5</mRID>
        <BusinessType>A01</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A01</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>5</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>6</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>7</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>8</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>9</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>10</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>11</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>12</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>13</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>14</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>15</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>16</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>17</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>18</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>19</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>20</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>21</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>22</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>23</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>24</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>25</Pos><Qty>2.000</Qty></Point>
          <Point><Pos>26</Pos><Qty>2.000</Qty></Point>
          <Point><Pos>27</Pos><Qty>2.000</Qty></Point>
          <Point><Pos>28</Pos><Qty>2.000</Qty></Point>
          <Point><Pos>29</Pos><Qty>6.000</Qty></Point>
          <Point><Pos>30</Pos><Qty>6.000</Qty></Point>
          <Point><Pos>31</Pos><Qty>6.000</Qty></Point>
          <Point><Pos>32</Pos><Qty>6.000</Qty></Point>
          <Point><Pos>33</Pos><Qty>14.000</Qty></Point>
          <Point><Pos>34</Pos><Qty>14.000</Qty></Point>
          <Point><Pos>35</Pos><Qty>14.000</Qty></Point>
          <Point><Pos>36</Pos><Qty>14.000</Qty></Point>
          <Point><Pos>37</Pos><Qty>24.000</Qty></Point>
          <Point><Pos>38</Pos><Qty>24.000</Qty></Point>
          <Point><Pos>39</Pos><Qty>24.000</Qty></Point>
          <Point><Pos>40</Pos><Qty>24.000</Qty></Point>
          <Point><Pos>41</Pos><Qty>34.000</Qty></Point>
          <Point><Pos>42</Pos><Qty>34.000</Qty></Point>
          <Point><Pos>43</Pos><Qty>34.000</Qty></Point>
          <Point><Pos>44</Pos><Qty>34.000</Qty></Point>
          <Point><Pos>45</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>46</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>47</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>48</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>49</Pos><Qty>46.000</Qty></Point>
          <Point><Pos>50</Pos><Qty>46.000</Qty></Point>
          <Point><Pos>51</Pos><Qty>46.000</Qty></Point>
          <Point><Pos>52</Pos><Qty>46.000</Qty></Point>
          <Point><Pos>53</Pos><Qty>46.000</Qty></Point>
          <Point><Pos>54</Pos><Qty>46.000</Qty></Point>
          <Point><Pos>55</Pos><Qty>46.000</Qty></Point>
          <Point><Pos>56</Pos><Qty>46.000</Qty></Point>
          <Point><Pos>57</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>58</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>59</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>60</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>61</Pos><Qty>34.000</Qty></Point>
          <Point><Pos>62</Pos><Qty>34.000</Qty></Point>
          <Point><Pos>63</Pos><Qty>34.000</Qty></Point>
          <Point><Pos>64</Pos><Qty>34.000</Qty></Point>
          <Point><Pos>65</Pos><Qty>24.000</Qty></Point>
          <Point><Pos>66</Pos><Qty>24.000</Qty></Point>
          <Point><Pos>67</Pos><Qty>24.000</Qty></Point>
          <Point><Pos>68</Pos><Qty>24.000</Qty></Point>
          <Point><Pos>69</Pos><Qty>14.000</Qty></Point>
          <Point><Pos>70</Pos><Qty>14.000</Qty></Point>
          <Point><Pos>71</Pos><Qty>14.000</Qty></Point>
          <Point><Pos>72</Pos><Qty>14.000</Qty></Point>
          <Point><Pos>73</Pos><Qty>6.000</Qty></Point>
          <Point><Pos>74</Pos><Qty>6.000</Qty></Point>
          <Point><Pos>75</Pos><Qty>6.000</Qty></Point>
          <Point><Pos>76</Pos><Qty>6.000</Qty></Point>
          <Point><Pos>77</Pos><Qty>2.000</Qty></Point>
          <Point><Pos>78</Pos><Qty>2.000</Qty></Point>
          <Point><Pos>79</Pos><Qty>2.000</Qty></Point>
          <Point><Pos>80</Pos><Qty>2.000</Qty></Point>
          <Point><Pos>81</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>82</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>83</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>84</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>85</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>86</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>87</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>88</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>89</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>90</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>91</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>92</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>93</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>94</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>95</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>96</Pos><Qty>0.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

- [ ] **Step 4: Run the test and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedResourceObjectTests"
```
Expected: PASS — 10 passed, 0 failed. No production code changed: Task 7 already writes
`ResourceObject`, `ResourceObjectIsEan` and `Ean`, and this task is what fixes their meaning.

- [ ] **Step 5: Mutation — treat anything present as an EAN**

The shortcut that produces false quarantines. In `ParseSeries`, temporarily replace:

```csharp
            ResourceObjectIsEan: resourceObject.Length > 0,
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedResourceObjectTests"`
Expected: FAIL — exactly two.
`A_descriptive_label_in_ResourceObject_is_carried_verbatim_and_is_never_an_EAN` reports
`series.ResourceObjectIsEan should be False but was True`, and
`A_seventeen_digit_ResourceObject_is_not_an_EAN` reports the same.

⚠ **`A_Resource_carrying_only_a_RecourceName_label_is_never_an_EAN` and
`A_series_with_no_Resource_element_at_all_is_never_an_EAN` both stay GREEN**, because their
`ResourceObject` is the empty string and `"".Length > 0` is false. That is exactly why *absent*
and *a label* are two tests rather than one: the absent case cannot see this bug, and the fixture
that only covers absence would have passed a change that sends `Imbalance` to the EAN resolver.

Then restore `ean.IsSuccess`.

- [ ] **Step 6: Mutation — normalise the raw string away**

The tidying-up mistake, which costs an operator the only evidence on the quarantine row. In
`ParseSeries`, temporarily replace:

```csharp
            ResourceObject: ean.IsSuccess ? ean.Value.Value : string.Empty,
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedResourceObjectTests"`
Expected: FAIL — exactly two.
`A_descriptive_label_in_ResourceObject_is_carried_verbatim_and_is_never_an_EAN` reports
`series.ResourceObject should be "Imbalance" but was ""`, and
`A_seventeen_digit_ResourceObject_is_not_an_EAN` reports
`should be "87168590000000000" but was ""`. Every EAN-shaped assertion stays green, because for
an eighteen-digit value the mutation is a no-op — which is the whole reason the label cases exist.

Then restore `resourceObject`.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Application.Tests/Ingestion/Pvned
git commit -m "pvned: eighteen digits is an EAN, and anything else never is

[F02-R11] / [AS-17] and shared contract 7.1. A label handed to the EAN resolver quarantines as a
false UNKNOWN_EAN, so the shape test is the whole of the adapter's involvement: it says whether
eighteen digits arrived, never whether that connection is registered, valid on the date or ours.

The raw string is carried through verbatim beside the parsed EanCode because the pipeline writes
it onto the quarantined_series row, and an operator reading a quarantine entry has to see what
actually arrived.

The new fixture has two series with no EAN between them - one whose Resource holds only a
RecourceName, one with no Resource element at all - and the adapter ACCEPTS it, because deciding
what to do about an unresolvable resource is a pipeline stage and [F02-R40] forbids reimplementing
one here.

Verified by mutation: 'anything present is an EAN' reddens the label and seventeen-digit cases
while both absent-resource tests stay green (which is why absence and a label are two tests), and
normalising the raw string away reddens the same two while every EAN-shaped assertion stays green."
```

---

### Task 14: `[F02-R13]` — rejection is total, and the check order is a decision that is asserted

Two claims that only look like one:

- **Rejection is total.** `[F02-R13]`: a document lands whole or not at all. A document whose
  *second* series breaks a rule writes **zero** readings for the first, and the outcome carries no
  document at all. Design §7.4 asserts this by **row count** downstream; here it is asserted by
  `outcome.Document` being null, which is the adapter's half of the same promise.
- **The check order is deterministic, and it is a decision.** The eleven §8.2 rules are a table,
  not a sequence, and the design does not order them. This plan's Global Constraints pin the order;
  until now nothing has *asserted* it. A document that violates two rules at once is the only thing
  that can: with one rule broken, every order gives the same answer.

Why it matters that the answer is deterministic rather than merely correct: the code goes on
`inbound_message.failure_code`, onto the employee data-health screen (§10.4) and into the DevStubs
scenario names (§13.1). If two rules can race, the same broken document produces different
tickets on different days, and the operator's runbook is wrong half the time.

⚠ **Every other negative fixture in this plan violates exactly one rule and is otherwise a valid
document.** That is what makes each one's expected code deterministic without this task. The two
fixtures written here are the deliberate exceptions.

**Files:**
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-total-rejection-second-series.xml`
- Create: `tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-two-rules-at-once.xml`
- Test: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedRejectionIsTotalTests.cs`

**Interfaces:**
- Consumes: `PvnedAdapterHarness`, `PvnedFixtures` (Tasks 4 and 6); every constant on
  `PvnedFailureCodes` (Task 2); `BrpParseOutcome`, `BrpParseRequest`, `BrpParseStatus` (plan 3).
- Produces: `PeakPower.Application.Tests.Ingestion.Pvned.PvnedRejectionIsTotalTests`. **Task 15
  adds two tests to this same class**, so create it here rather than duplicating the file.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedRejectionIsTotalTests.cs`:

```csharp
using System.Text;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Integration.Brp.Pvned;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// [F02-R13] - a document lands whole or not at all - and the pinned order of the checks.
/// </summary>
/// <remarks>
/// <para>
/// The eleven rules of integration-spec section 8.2 are a table, not a sequence, and the design
/// does not order them. This plan's Global Constraints pin the order; the theory below is what
/// asserts it. A document that violates ONE rule cannot: every order returns the same code for it.
/// </para>
/// <para>
/// Determinism is the point rather than elegance. The code lands on
/// inbound_message.failure_code, on the employee data-health screen and in the DevStubs scenario
/// names. If two rules can race, one broken document raises different tickets on different days
/// and the runbook is wrong half the time.
/// </para>
/// </remarks>
public sealed class PvnedRejectionIsTotalTests
{
    [Fact]
    public void A_document_whose_second_series_fails_applies_nothing_at_all()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-total-rejection-second-series.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.FailureCode.ShouldBe(
            PvnedFailureCodes.UnsupportedResolution,
            "the first series is a perfectly good 96-point A02 day; the second declares PT60M, "
            + "and [F02-R13] says the document lands whole or not at all");
    }

    [Fact]
    public void The_first_series_is_not_partially_applied()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-total-rejection-second-series.xml");

        outcome.Document.ShouldBeNull(
            "a rejection carries no document, so there is nothing for the pipeline to apply - "
            + "which is the adapter's half of design section 7.4's row-count assertion");
    }

    [Fact]
    public void The_total_rejection_detail_names_the_series_that_failed()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-total-rejection-second-series.xml");

        outcome.FailureDetail.ShouldNotBeNull();
        outcome.FailureDetail.ShouldContain("TimeSeries 2", Case.Sensitive);
        outcome.FailureDetail.ShouldContain("PT60M", Case.Sensitive);
    }

    [Fact]
    public void Two_broken_rules_return_the_earlier_one_in_the_pinned_order()
    {
        var outcome = PvnedAdapterHarness.Parse("invalid-two-rules-at-once.xml");

        outcome.Status.ShouldBe(BrpParseStatus.Rejected);
        outcome.FailureCode.ShouldBe(
            PvnedFailureCodes.WrongReceiver,
            "the document is addressed to 8799999999999 AND declares PT60M. The receiver check "
            + "is fourth in the pinned order and the resolution check seventh: a document "
            + "addressed to somebody else is not ours to inspect further");
    }

    [Theory]
    // Each row takes a fixture that breaks exactly one rule, breaks a SECOND rule in it, and
    // names the code the pinned order says wins. The find/replace strings are the literal text
    // of the hand-written fixtures; if a fixture is edited so that a string no longer matches,
    // the replacement is a no-op and the row goes red rather than silently asserting nothing.
    [InlineData(
        "structural-schema-pos-out-of-range.xml",
        "<ReceiverIdentification>8712423456789</ReceiverIdentification>",
        "<ReceiverIdentification>8799999999999</ReceiverIdentification>",
        PvnedFailureCodes.SchemaValidationFailed)]
    [InlineData(
        "invalid-unsupported-document-type.xml",
        "<ReceiverIdentification>8712423456789</ReceiverIdentification>",
        "<ReceiverIdentification>8799999999999</ReceiverIdentification>",
        PvnedFailureCodes.WrongReceiver)]
    [InlineData(
        "invalid-unknown-sender.xml",
        "<DocumentType>A23</DocumentType>",
        "<DocumentType>A01</DocumentType>",
        PvnedFailureCodes.UnknownSender)]
    [InlineData(
        "invalid-unsupported-curve-type.xml",
        "<Direction>A02</Direction>",
        "<Direction>A03</Direction>",
        PvnedFailureCodes.UnsupportedCurveType)]
    [InlineData(
        "invalid-invalid-positions-96.xml",
        "<Direction>A02</Direction>",
        "<Direction>A03</Direction>",
        PvnedFailureCodes.UnsupportedDirection)]
    [InlineData(
        "invalid-negative-quantity-96.xml",
        "<Resolution>PT15M</Resolution>",
        "<Resolution>PT60M</Resolution>",
        PvnedFailureCodes.UnsupportedResolution)]
    [InlineData(
        "invalid-incomplete-period-95.xml",
        "<MeasurementUnit>KWH</MeasurementUnit>",
        "<MeasurementUnit>KWT</MeasurementUnit>",
        PvnedFailureCodes.UnsupportedMeasurementUnit)]
    public void The_pinned_check_order_decides_which_code_an_operator_sees(
        string fixtureName,
        string find,
        string replaceWith,
        string expectedCode)
    {
        var original = PvnedFixtures.Text(fixtureName);
        var doubled = original.Replace(find, replaceWith, StringComparison.Ordinal);

        doubled.ShouldNotBe(
            original,
            $"'{find}' was not found in {fixtureName}, so this row breaks only one rule and "
            + "asserts nothing about the order");

        ParseText(doubled).FailureCode.ShouldBe(expectedCode);
    }

    [Fact]
    public void The_same_document_returns_the_same_code_on_every_parse()
    {
        // Guards against an order that is not an order: a set, a dictionary or a parallel query
        // can answer correctly and answer differently, and a code that varies run to run is a
        // runbook that is wrong half the time.
        var codes = Enumerable.Range(0, 5)
            .Select(_ => PvnedAdapterHarness.Parse("invalid-two-rules-at-once.xml").FailureCode
                         ?? string.Empty)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        codes.Length.ShouldBe(1);
        codes[0].ShouldBe(PvnedFailureCodes.WrongReceiver);
    }

    [Fact]
    public void No_rejected_document_ever_carries_a_series()
    {
        // [F02-R13] across the whole checked-in corpus, so a future fixture is covered the day
        // it is added rather than the day somebody remembers to write a test for it.
        foreach (var name in PvnedFixtures.AllNames())
        {
            var outcome = PvnedAdapterHarness.Parse(name);
            if (outcome.Status != BrpParseStatus.Rejected)
            {
                continue;
            }

            outcome.Document.ShouldBeNull($"{name} is rejected, and [F02-R13] writes nothing");
        }
    }

    [Fact]
    public void Every_semantic_rejection_carries_a_sentence_that_ends_in_a_full_stop()
    {
        // Slice 1's copy rules bind FailureDetail: it reaches an employee screen. Only the
        // invalid-* fixtures are walked here - the structural details come out of PvnedXmlReader
        // and Task 5 already asserts them.
        foreach (var name in PvnedFixtures.AllNames()
                     .Where(name => name.StartsWith("invalid-", StringComparison.Ordinal)))
        {
            var outcome = PvnedAdapterHarness.Parse(name);

            outcome.Status.ShouldBe(BrpParseStatus.Rejected, name);
            outcome.FailureDetail.ShouldNotBeNull(name);
            outcome.FailureDetail.Trim().ShouldEndWith(".", Case.Sensitive, name);
        }
    }

    private static BrpParseOutcome ParseText(string xml) =>
        PvnedAdapterHarness.Create().Parse(new BrpParseRequest(
            InboundMessageId: Guid.CreateVersion7(),
            BrpId: PvnedAdapterHarness.PvnedBrpId,
            BrpCode: "PVNED",
            CorrelationId: Guid.CreateVersion7(),
            Payload: Encoding.UTF8.GetBytes(xml),
            ReceivedAt: PvnedAdapterHarness.DefaultNow));
}
```

- [ ] **Step 2: Run it and watch it fail**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedRejectionIsTotalTests"
```
Expected: FAIL — five of fourteen, all with
`System.InvalidOperationException : There is no PVNed fixture named
'invalid-total-rejection-second-series.xml'. The 23 that exist are: …` (and the same for
`invalid-two-rules-at-once.xml`). The seven theory rows, `No_rejected_document_ever_carries_a_series`
and `Every_semantic_rejection_carries_a_sentence_that_ends_in_a_full_stop` pass already — the check
order has been right since Task 11 and has simply never been asserted.

- [ ] **Step 3: Write `invalid-total-rejection-second-series.xml`**

**Hand-written. A complete, valid, ninety-six-point first series, then a broken second one.** The
first series has to be genuinely good, or the fixture proves nothing about totality: the question
is whether ninety-six perfectly acceptable readings are discarded because of a series that follows
them.

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-total-rejection-second-series.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     [F02-R13]: a document lands whole or not at all.

     Series 1 is a complete and entirely valid 96-point A02 consumption day for 12 August 2026,
     totalling 10736.000 kWh. Series 2 is an A01 production series that declares Resolution
     PT60M. The document is REJECTED with UNSUPPORTED_RESOLUTION and writes nothing - not the
     96 good readings, not a partial day, nothing.

     Series 2 carries four points rather than 96 on purpose: the pinned check order puts the
     resolution rule ahead of the point-count rule, so the count never gets a chance to fire and
     the failure is unambiguously the one this fixture is for. If somebody reorders the checks,
     this document comes back INCOMPLETE_PERIOD and the detail assertion says so. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>0e2a4c6e-8a0c-4e2a-4c6e-8a0c2e4a6cb1</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>

      <TimeSeries>
        <mRID>2a4c6e8a-0c2e-4a4c-6e8a-0c2e4a6c8eb3</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>5</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>6</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>7</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>8</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>9</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>10</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>11</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>12</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>13</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>14</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>15</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>16</Pos><Qty>38.000</Qty></Point>
          <Point><Pos>17</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>18</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>19</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>20</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>21</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>22</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>23</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>24</Pos><Qty>52.000</Qty></Point>
          <Point><Pos>25</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>26</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>27</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>28</Pos><Qty>96.000</Qty></Point>
          <Point><Pos>29</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>30</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>31</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>32</Pos><Qty>148.000</Qty></Point>
          <Point><Pos>33</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>34</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>35</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>36</Pos><Qty>176.000</Qty></Point>
          <Point><Pos>37</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>38</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>39</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>40</Pos><Qty>182.000</Qty></Point>
          <Point><Pos>41</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>42</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>43</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>44</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>45</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>46</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>47</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>48</Pos><Qty>188.000</Qty></Point>
          <Point><Pos>49</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>50</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>51</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>52</Pos><Qty>172.000</Qty></Point>
          <Point><Pos>53</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>54</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>55</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>56</Pos><Qty>184.000</Qty></Point>
          <Point><Pos>57</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>58</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>59</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>60</Pos><Qty>186.000</Qty></Point>
          <Point><Pos>61</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>62</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>63</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>64</Pos><Qty>180.000</Qty></Point>
          <Point><Pos>65</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>66</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>67</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>68</Pos><Qty>168.000</Qty></Point>
          <Point><Pos>69</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>70</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>71</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>72</Pos><Qty>140.000</Qty></Point>
          <Point><Pos>73</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>74</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>75</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>76</Pos><Qty>112.000</Qty></Point>
          <Point><Pos>77</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>78</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>79</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>80</Pos><Qty>92.000</Qty></Point>
          <Point><Pos>81</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>82</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>83</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>84</Pos><Qty>76.000</Qty></Point>
          <Point><Pos>85</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>86</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>87</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>88</Pos><Qty>60.000</Qty></Point>
          <Point><Pos>89</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>90</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>91</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>92</Pos><Qty>48.000</Qty></Point>
          <Point><Pos>93</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>94</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>95</Pos><Qty>42.000</Qty></Point>
          <Point><Pos>96</Pos><Qty>42.000</Qty></Point>
        </Period>
      </TimeSeries>

      <TimeSeries>
        <mRID>4c6e8a0c-2e4a-4c6e-8a0c-2e4a6c8e0ab5</mRID>
        <BusinessType>A01</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A01</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT60M</Resolution>
          <Point><Pos>1</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>0.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>124.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>96.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

- [ ] **Step 4: Write `invalid-two-rules-at-once.xml`**

**Hand-written. The deliberate exception to "every negative fixture violates exactly one rule."**
It is addressed to a GLN that is nobody's *and* declares `PT60M`. The pinned order puts
`WRONG_RECEIVER` fourth and `UNSUPPORTED_RESOLUTION` seventh, so `WRONG_RECEIVER` is the answer,
and the reason is not arbitrary: **a document addressed to somebody else is not ours to inspect
further.** Reporting an unsupported resolution to a party we are not in a conversation with would
be answering a message we should not have opened.

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-two-rules-at-once.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- HAND-WRITTEN FIXTURE. Do not generate this file.
     TWO rules broken at once, and the only fixture in this suite that breaks more than one.

       rule 2 - ReceiverIdentification is 8799999999999, which is nobody's
       rule 4 - Resolution is PT60M

     The pinned check order puts the receiver check fourth and the resolution check seventh, so
     the expected code is WRONG_RECEIVER. That is a decision, not an accident: a document
     addressed to somebody else is not ours to inspect further, and telling a party we are not
     in a conversation with which of their fields we dislike is answering a message we should
     not have opened.

     Four points, because both broken rules are checked long before the point count. -->
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>6e8a0c2e-4a6c-4e8a-0c2e-4a6c8e0a2cb7</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A23</DocumentType>
      <ProcessType>A05</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8799999999999</ReceiverIdentification>
      <CreatedDateTime>2026-08-13T04:02:11Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
        <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
      </ReportPeriode>
      <TimeSeries>
        <mRID>8a0c2e4a-6c8e-4a0c-2e4a-6c8e0a2c4eb9</mRID>
        <BusinessType>A04</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2026-08-11T22:00:00Z</StartPeriod>
          <EndPeriod>2026-08-12T22:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A02</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <ResourceObject>871685900000000001</ResourceObject>
        </Resource>
        <Period>
          <Resolution>PT60M</Resolution>
          <Point><Pos>1</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>2</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>3</Pos><Qty>40.000</Qty></Point>
          <Point><Pos>4</Pos><Qty>40.000</Qty></Point>
        </Period>
      </TimeSeries>
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

- [ ] **Step 5: Run the test and watch it pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedRejectionIsTotalTests"
```
Expected: PASS — 14 passed, 0 failed.

- [ ] **Step 6: Mutation — skip the failing series instead of rejecting the document**

The "salvage what we can" instinct, which is a silent partial day. In
`PvnedIngestionAdapter.ParseAllocation`, temporarily replace:

```csharp
            if (outcome.Failure is not null)
            {
                continue;
            }
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedRejectionIsTotalTests"`
Expected: FAIL — **eight**. `A_document_whose_second_series_fails_applies_nothing_at_all` reports
`outcome.Status should be Rejected but was Accepted`; `The_first_series_is_not_partially_applied`
reports `outcome.Document should be null but was BrpDocument { … }`;
`The_total_rejection_detail_names_the_series_that_failed` reports
`outcome.FailureDetail should not be null`; the **four** theory rows whose only series is the
failing one — `invalid-unsupported-curve-type.xml`, `invalid-invalid-positions-96.xml`,
`invalid-negative-quantity-96.xml` and `invalid-incomplete-period-95.xml` — report
`outcome.FailureCode should be "…" but was null`; and
`Every_semantic_rejection_carries_a_sentence_that_ends_in_a_full_stop` reports
`outcome.Status should be Rejected but was Accepted` on the first single-series `invalid-*`
fixture it reaches. The three header and structural theory rows stay green, because they never
reach `ParseAllocation`, and `No_rejected_document_ever_carries_a_series` passes **vacuously** —
nothing is rejected any more, so it walks the corpus and asserts nothing. Read that last one
carefully: a whole-corpus loop is only as strong as the population it finds.

⚠ Note what the mutation ships: a day of readings applied with one direction missing, an
`inbound_message` marked `PROCESSED`, and nothing anywhere that says a series was dropped. Then
restore `return outcome.Failure;`.

- [ ] **Step 7: Mutation — check the resolution last instead of first**

Temporarily move the `foreach (var period in series.Elements(PeriodName))` resolution block from
the top of `ParseSeries` to immediately before `return SeriesOutcome.Parsed(...)`.

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedRejectionIsTotalTests"`
Expected: FAIL — **three**. `A_document_whose_second_series_fails_applies_nothing_at_all` reports
`outcome.FailureCode should be "UNSUPPORTED_RESOLUTION" but was "INCOMPLETE_PERIOD"` — the second
series' four points are now counted before its resolution is looked at;
`The_total_rejection_detail_names_the_series_that_failed` reports
`outcome.FailureDetail should contain "PT60M"`; and the
`invalid-negative-quantity-96.xml` theory row reports
`should be "UNSUPPORTED_RESOLUTION" but was "NEGATIVE_QUANTITY"`. Everything else stays green.

⚠ **The document is rejected either way.** What changes is the sentence the operator reads and the
action it implies: "your resolution is not supported" is a format conversation with the BRP;
"the period is incomplete" is a resend request. That is the whole reason the order is pinned
rather than left to whoever edits the method next. Then move the block back to the top.

- [ ] **Step 8: Mutation — test `DocumentType` before the receiver**

Integration-spec §8.2's own row order, written out. In `PvnedIngestionAdapter.Parse`, temporarily
move the `WRONG_RECEIVER` guard to immediately after the `UNSUPPORTED_DOCUMENT_TYPE` guard.

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedRejectionIsTotalTests"`
Expected: FAIL — **one**: the `invalid-unsupported-document-type.xml` theory row, with
`outcome.FailureCode should be "WRONG_RECEIVER" but was "UNSUPPORTED_DOCUMENT_TYPE"`.
`Two_broken_rules_return_the_earlier_one_in_the_pinned_order` stays green, because its fixture is
an A23 with a handled ProcessType and the document-type guard passes it straight through.

⚠ That pairing is the point. Task 6 proved the same ordering from the A12 side, where the
consequence is a *misrouted document recognised and closed*; this row proves it from the A23 side,
where the consequence is only a confusing code. Two fixtures, one rule, two different costs —
and the cheap one is the one a reviewer would have deleted. Then restore the original order.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Application.Tests/Ingestion/Pvned
git commit -m "pvned: rejection is total, and the check order is asserted rather than assumed

[F02-R13]: a document whose SECOND series declares PT60M discards the 96 perfectly good readings
in its first. Asserted here as a null document, which is the adapter's half of design 7.4's
row-count assertion downstream.

The check order is a decision this plan made - the eleven rules of integration-spec 8.2 are a
table, not a sequence - and until now nothing asserted it, because a document that breaks ONE rule
returns the same code under every order. invalid-two-rules-at-once.xml is the deliberate exception
to 'every negative fixture breaks exactly one rule', and a seven-row theory doubles a second rule
into seven more fixtures to cover the rest of the order.

Determinism is the requirement, not elegance: the code reaches inbound_message.failure_code, the
employee data-health screen and the DevStubs scenario names, and a code that varies run to run is
a runbook that is wrong half the time.

Verified by mutation: skipping a failing series instead of rejecting reddens six (and would ship a
silent partial day marked PROCESSED); checking the resolution last reddens three and changes the
sentence an operator acts on from a format conversation to a resend request; and testing
DocumentType before the receiver reddens exactly one row here - the same rule task 6 proved from
the A12 side, where the cost is a misrouted document recognised and closed."
```

---

### Task 15: `AddPvnedBrpAdapter`, and the two codes this adapter may never return

Two things that belong in one commit because they are the same claim from two sides — *what this
adapter is* and *what it is not*.

- **`AddPvnedBrpAdapter(services, configuration)`** is the one DI entry point. Until it exists,
  `PvnedIngestionAdapter` is a class nobody constructs: plan 3's `IBrpIngestionAdapterRegistry`
  resolves `IBrpIngestionAdapter` registrations, and there are none. Design §7.2's end-to-end 200
  has no parser behind it until this method is called from the Worker's composition root.
- **The adapter never returns `UNKNOWN_METERING_POINT` or `WRONG_BRP_FOR_METERING_POINT`.** Those
  are rules 10 and 11 of integration-spec §8.2, they sit in the spec's *adapter* section, and they
  are **not the adapter's**: deciding either needs `customer.metering_point`, which `[F02-R40]`
  forbids an adapter reading. Shared contract §8.4 and §13.1 have both been corrected to say so —
  §13.1's scenario 14 now covers **eleven** `invalid-*` documents rather than thirteen, because
  the unknown-EAN and wrong-BRP cases are scenarios 12 and 13 and are **quarantines**, not
  rejections. `PvnedFailureCodes` declares the two strings so plans 3, 5 and 6 read one spelling,
  and this task is where a test holds the line.

⚠ **Options are read through the `IConfiguration` indexer, not bound.** `PvnedAdapterOptions` is a
plain POCO for exactly this reason (Task 1): `Bind()` lives in
`Microsoft.Extensions.Configuration.Binder`, the indexer lives in `.Abstractions`, and adding a
`PackageVersion` for one call is a change to `Directory.Packages.props` — a file eight parallel
plans share.

⚠ **A blank configured value counts as unconfigured.** `Brp__Pvned__SenderGln` unset in a shell
expands to the empty string, and slice 1's `AddPeakPowerEmail` already settled that a clone with
nothing configured must keep working. A blank GLN would otherwise reject every document with
`UNKNOWN_SENDER` and look like a PVNed problem.

**Files:**
- Create: `src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedServiceCollectionExtensions.cs`
- Modify: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedRegistrationTests.cs` (Task 1
  created it with four tests; seven are appended)
- Modify: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedRejectionIsTotalTests.cs`
  (Task 14 created it; four tests are appended)

**Interfaces:**
- Consumes: `IBrpIngestionAdapter` (plan 3); `IServiceCollection` and `TryAddEnumerable`
  (`Microsoft.Extensions.DependencyInjection.Abstractions`, which arrives **transitively** with
  `Microsoft.Extensions.Logging.Abstractions` 10.0.11 — no new `PackageVersion`);
  `IConfiguration` (Task 1's package reference); `PvnedAdapterOptions` (Task 1);
  `PvnedIngestionAdapter` (Task 6); `AddMarketCalendar` (plan 1, in the tests only).
- Produces: `PeakPower.Integration.Brp.Pvned.PvnedServiceCollectionExtensions` with
  `public static IServiceCollection AddPvnedBrpAdapter(this IServiceCollection services, IConfiguration configuration)`,
  `public const string SenderGlnConfigurationKey`, `public const string ReceiverGlnConfigurationKey`.
  **Plan 1's Worker composition root calls it** (step 7).

- [ ] **Step 1: Write the failing tests**

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedRegistrationTests.cs`,
inside the existing `PvnedRegistrationTests` class, after the last `[Fact]`:

```csharp
    [Fact]
    public void The_registration_resolves_the_PVNed_adapter_behind_the_port()
    {
        using var provider = Build();

        provider.GetRequiredService<IBrpIngestionAdapter>()
            .ShouldBeOfType<PvnedIngestionAdapter>();
    }

    [Fact]
    public void The_registered_adapters_key_is_the_literal_migration_9_seeds()
    {
        using var provider = Build();

        provider.GetRequiredService<IBrpIngestionAdapter>().AdapterKey.ShouldBe(
            "PVNED_TIMESERIES_XML_V2P0",
            "shared contract section 6.1 UPDATEs metering.brp.adapter_key to exactly this "
            + "string, and [F02-R41] selects the adapter by that column - a mismatch is an "
            + "AdapterNotRegisteredException at dequeue time, not a compile error");
    }

    [Fact]
    public void The_adapter_is_registered_once_and_shared()
    {
        using var provider = Build();

        provider.GetRequiredService<IBrpIngestionAdapter>()
            .ShouldBeSameAs(provider.GetRequiredService<IBrpIngestionAdapter>());
    }

    [Fact]
    public void Registering_twice_leaves_exactly_one_adapter()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddMarketCalendar();
        services.AddPvnedBrpAdapter(EmptyConfiguration);
        services.AddPvnedBrpAdapter(EmptyConfiguration);

        using var provider = services.BuildServiceProvider();

        provider.GetServices<IBrpIngestionAdapter>().Count().ShouldBe(
            1,
            "a host that calls this twice - one composition root, one test fixture - must not "
            + "get two adapters answering to the same adapter_key");
    }

    [Fact]
    public void With_nothing_configured_the_two_sample_GLNs_are_what_the_adapter_checks_against()
    {
        using var provider = Build();

        var outcome = provider.GetRequiredService<IBrpIngestionAdapter>()
            .Parse(PvnedAdapterHarness.Request("golden-a23-both-directions-96.xml"));

        outcome.Status.ShouldBe(
            BrpParseStatus.Accepted,
            "a clone with nothing configured still parses the golden document, because the "
            + "defaults are integration-spec section 6's own two GLNs");
    }

    [Fact]
    public void A_configured_sender_GLN_overrides_the_default()
    {
        using var provider = Build(
            (PvnedServiceCollectionExtensions.SenderGlnConfigurationKey, "8700000000000"));

        var outcome = provider.GetRequiredService<IBrpIngestionAdapter>()
            .Parse(PvnedAdapterHarness.Request("golden-a23-both-directions-96.xml"));

        outcome.FailureCode.ShouldBe(
            PvnedFailureCodes.UnknownSender,
            "[DEC-69] makes the expected sender per-BRP configuration; asserted through a real "
            + "container rather than by reading the options object, because the question is "
            + "whether the value reaches the adapter");
    }

    [Fact]
    public void A_blank_configured_GLN_counts_as_unconfigured()
    {
        // Brp__Pvned__SenderGln unset in a shell expands to the empty string, and a blank GLN
        // would reject every document with UNKNOWN_SENDER and look like a PVNed problem.
        using var provider = Build(
            (PvnedServiceCollectionExtensions.SenderGlnConfigurationKey, "   "));

        var outcome = provider.GetRequiredService<IBrpIngestionAdapter>()
            .Parse(PvnedAdapterHarness.Request("golden-a23-both-directions-96.xml"));

        outcome.Status.ShouldBe(BrpParseStatus.Accepted, outcome.FailureDetail);
    }

    private static readonly IConfiguration EmptyConfiguration =
        new ConfigurationBuilder().Build();

    private static ServiceProvider Build(params (string Key, string Value)[] settings)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(
                settings.Select(setting =>
                    new KeyValuePair<string, string?>(setting.Key, setting.Value)))
            .Build();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddMarketCalendar();
        services.AddPvnedBrpAdapter(configuration);

        return services.BuildServiceProvider();
    }
```

Add these `using` directives to the top of the same file:

```csharp
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Infrastructure.Time;
```

Then append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedRejectionIsTotalTests.cs`,
inside the existing class, before the private `ParseText` helper:

```csharp
    [Fact]
    public void The_adapter_never_returns_a_pipeline_code()
    {
        // Rules 10 and 11 of integration-spec section 8.2 sit in the spec's ADAPTER section and
        // are not this adapter's: deciding either needs customer.metering_point, and [F02-R40]
        // forbids an adapter reimplementing a pipeline stage. Walked across the whole corpus so
        // that a fixture added later is covered the day it lands.
        foreach (var name in PvnedFixtures.AllNames())
        {
            var outcome = PvnedAdapterHarness.Parse(name);
            if (outcome.FailureCode is null)
            {
                continue;
            }

            PvnedFailureCodes.PipelineOnly.ShouldNotContain(
                outcome.FailureCode,
                $"{name} came back {outcome.FailureCode}, which is a quarantine decision the "
                + "pipeline makes against customer.metering_point - the adapter emits a "
                + "CanonicalSeries and lets the pipeline write the quarantined_series row");
        }
    }

    [Fact]
    public void Every_code_the_adapter_returns_is_one_it_is_allowed_to_return()
    {
        foreach (var name in PvnedFixtures.AllNames())
        {
            var outcome = PvnedAdapterHarness.Parse(name);
            if (outcome.FailureCode is null)
            {
                continue;
            }

            PvnedFailureCodes.AdapterRaised.ShouldContain(outcome.FailureCode, name);
        }
    }

    [Fact]
    public void The_two_pipeline_codes_are_declared_here_but_are_not_adapter_codes()
    {
        PvnedFailureCodes.All.ShouldContain(
            PvnedFailureCodes.UnknownMeteringPoint,
            "the string is declared here so plans 3, 5 and 6 read one spelling");
        PvnedFailureCodes.All.ShouldContain(PvnedFailureCodes.WrongBrpForMeteringPoint);

        PvnedFailureCodes.AdapterRaised.ShouldNotContain(PvnedFailureCodes.UnknownMeteringPoint);
        PvnedFailureCodes.AdapterRaised.ShouldNotContain(
            PvnedFailureCodes.WrongBrpForMeteringPoint);
    }

    [Fact]
    public void The_adapter_assembly_cannot_see_the_pipeline_the_database_or_the_clock()
    {
        // The structural half of the same claim: an adapter that cannot reference
        // PeakPower.Ingestion or PeakPower.Persistence cannot resolve an EAN however much
        // somebody wants it to, and one that cannot reference PeakPower.Infrastructure.Time
        // cannot grow a second DST implementation beside IMarketCalendar.
        var referenced = typeof(PvnedIngestionAdapter).Assembly
            .GetReferencedAssemblies()
            .Select(assembly => assembly.Name ?? string.Empty)
            .ToArray();

        referenced.ShouldNotContain("PeakPower.Ingestion");
        referenced.ShouldNotContain("PeakPower.Persistence");
        referenced.ShouldNotContain("PeakPower.Infrastructure.Time");
    }
```

- [ ] **Step 2: Run it and watch it fail**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build tests/PeakPower.Application.Tests --nologo
```
Expected: FAIL with
`error CS1061: 'IServiceCollection' does not contain a definition for 'AddPvnedBrpAdapter'` —
three times, once per call site — and
`error CS0103: The name 'PvnedServiceCollectionExtensions' does not exist in the current context`
twice. The four `PvnedRejectionIsTotalTests` additions compile: they need nothing new.

- [ ] **Step 3: Write `PvnedServiceCollectionExtensions`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedServiceCollectionExtensions.cs`:

```csharp
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PeakPower.Application.Abstractions.Ingestion;

namespace PeakPower.Integration.Brp.Pvned;

/// <summary>
/// The one DI entry point for the PVNed adapter. Every host that dequeues an inbound BRP message
/// calls this once.
/// </summary>
/// <remarks>
/// <para>
/// The adapter is registered <b>behind the port</b> and never as its own concrete type: plan 3's
/// IBrpIngestionAdapterRegistry resolves IBrpIngestionAdapter registrations and matches
/// <see cref="IBrpIngestionAdapter.AdapterKey"/> against the <c>adapter_key</c> of the BRP row
/// identified by the message's STORED brp_id, at dequeue time - never by a field in the payload,
/// never by the route, never by a default ([F02-R41], shared contract section 7.2).
/// TryAddEnumerable is what keeps a host that calls this twice from ending up with two adapters
/// answering to one key.
/// </para>
/// <para>
/// The two GLNs are read through the IConfiguration <b>indexer</b> rather than bound.
/// <see cref="PvnedAdapterOptions"/> is a plain POCO for exactly this reason: Bind() lives in
/// Microsoft.Extensions.Configuration.Binder, the indexer lives in .Abstractions, and adding a
/// PackageVersion for one call is a change to Directory.Packages.props, which eight parallel
/// plans share.
/// </para>
/// <para>
/// A blank configured value counts as unconfigured. An unset <c>Brp__Pvned__SenderGln</c> expands
/// to the empty string in a shell, and a blank expected sender would reject every document with
/// UNKNOWN_SENDER and look like a PVNed problem. Slice 1's AddPeakPowerEmail settled the same
/// question the same way.
/// </para>
/// </remarks>
public static class PvnedServiceCollectionExtensions
{
    /// <summary>Where the sender GLN is read from; <c>Brp__Pvned__SenderGln</c> as an environment variable.</summary>
    public const string SenderGlnConfigurationKey =
        $"{PvnedAdapterOptions.SectionName}:{nameof(PvnedAdapterOptions.SenderGln)}";

    /// <summary>Where the receiver GLN is read from; <c>Brp__Pvned__ReceiverGln</c> as an environment variable.</summary>
    public const string ReceiverGlnConfigurationKey =
        $"{PvnedAdapterOptions.SectionName}:{nameof(PvnedAdapterOptions.ReceiverGln)}";

    public static IServiceCollection AddPvnedBrpAdapter(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        var options = new PvnedAdapterOptions();

        var sender = configuration[SenderGlnConfigurationKey];
        if (!string.IsNullOrWhiteSpace(sender))
        {
            options.SenderGln = sender.Trim();
        }

        var receiver = configuration[ReceiverGlnConfigurationKey];
        if (!string.IsNullOrWhiteSpace(receiver))
        {
            options.ReceiverGln = receiver.Trim();
        }

        services.TryAddSingleton(options);
        services.TryAddEnumerable(
            ServiceDescriptor.Singleton<IBrpIngestionAdapter, PvnedIngestionAdapter>());

        return services;
    }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~Ingestion.Pvned"
```
Expected: PASS — the whole PVNed suite green, including the twelve
`PvnedRegistrationTests` and the eighteen `PvnedRejectionIsTotalTests`.

- [ ] **Step 5: Mutation — let the adapter decide an unknown metering point**

This is the mistake `[F02-R40]` is written against, and it is a *reasonable-looking* one: the code
exists, the spec lists it under "adapter", and the adapter is holding the `ResourceObject`. In
`ParseSeries`, temporarily insert immediately after `var ean = EanCode.Create(resourceObject);`:

```csharp
        if (!ean.IsSuccess)
        {
            return SeriesOutcome.Rejected(
                PvnedFailureCodes.UnknownMeteringPoint,
                $"TimeSeries {index.ToString(CultureInfo.InvariantCulture)} carries "
                + $"ResourceObject '{resourceObject}', which is not a registered metering "
                + "point.");
        }
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~Ingestion.Pvned"`
Expected: FAIL — **eight**, in two classes. In `PvnedRejectionIsTotalTests`,
`The_adapter_never_returns_a_pipeline_code` fails naming
`golden-a23-non-ean-resources-96.xml came back UNKNOWN_METERING_POINT`, and
`Every_code_the_adapter_returns_is_one_it_is_allowed_to_return` fails with
`PvnedFailureCodes.AdapterRaised should contain "UNKNOWN_METERING_POINT"`. In
`PvnedResourceObjectTests`, the four tests that read
`golden-a23-non-ean-resources-96.xml` as an accepted document fail, and so do
`A_descriptive_label_in_ResourceObject_is_carried_verbatim_and_is_never_an_EAN` and
`A_seventeen_digit_ResourceObject_is_not_an_EAN`.

⚠ Note what the mutation ships: a document containing a label series is `FAILED` with a code that
says the metering point is unknown — when the adapter has never looked one up and cannot. The real
`UNKNOWN_EAN` path is a **quarantine with a replay**: register the metering point, replay the
stored message, and the readings land. A rejection has no replay. Then remove the inserted block.

- [ ] **Step 6: Mutation — register the adapter with `AddSingleton`**

```csharp
        services.AddSingleton<IBrpIngestionAdapter, PvnedIngestionAdapter>();
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedRegistrationTests"`
Expected: FAIL — exactly one, `Registering_twice_leaves_exactly_one_adapter`, with
`provider.GetServices<IBrpIngestionAdapter>().Count() should be 1 but was 2`. Every other test
stays green, including the resolution ones — `GetRequiredService` returns the last registration
and cannot see the duplicate, which is why the count is asserted separately.

Then restore `TryAddEnumerable`.

- [ ] **Step 7: Mutation — hard-code the options instead of reading configuration**

Temporarily delete both `configuration[...]` blocks, leaving `var options = new PvnedAdapterOptions();`.

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedRegistrationTests"`
Expected: FAIL — exactly one, `A_configured_sender_GLN_overrides_the_default`, with
`outcome.FailureCode should be "UNKNOWN_SENDER" but was null`.
`With_nothing_configured_the_two_sample_GLNs_are_what_the_adapter_checks_against` and
`A_blank_configured_GLN_counts_as_unconfigured` both stay **green** — the two tests that look most
like they cover configuration are exactly the two that cannot see it missing, because the answer
they expect is the default.

Then restore the two blocks.

- [ ] **Step 8: Confirm the Worker actually calls it**

The extension method existing is not the same as the adapter being composed. Design §7.2's
end-to-end 200 needs the Worker's composition root to call it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -n 'AddPvnedBrpAdapter' src/Hosts/PeakPower.Worker/Program.cs > /tmp/pvned-worker.txt
wc -l /tmp/pvned-worker.txt
cat /tmp/pvned-worker.txt
```

Expected: one line. ⚠ **`src/Hosts/PeakPower.Worker/Program.cs` and every `.csproj` belong to
plan 1** (contract §17), so the expected outcome here is that the line is **already there**. If it
is not, add exactly this one line beside the host's other `Add*` calls, and say so in the commit
message rather than quietly:

```csharp
builder.Services.AddPvnedBrpAdapter(builder.Configuration);
```

with `using PeakPower.Integration.Brp.Pvned;` at the top, and confirm the Worker already carries
`<ProjectReference Include="../../Infrastructure/PeakPower.Integration.Brp.Pvned/PeakPower.Integration.Brp.Pvned.csproj" />`.
**Do not add anything else to that file.** One line is a composition; two is plan 4 growing into
plan 1's territory, and the eight plans are assembled on one day.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Integration.Brp.Pvned/PvnedServiceCollectionExtensions.cs \
        tests/PeakPower.Application.Tests/Ingestion/Pvned
git commit -m "pvned: one DI entry point, and the two codes this adapter may never return

AddPvnedBrpAdapter registers the adapter BEHIND the port, never as its own type: plan 3's registry
matches AdapterKey against metering.brp.adapter_key for the message's stored brp_id at dequeue
time [F02-R41], and TryAddEnumerable stops a host that calls this twice ending up with two
adapters answering to one key. Until this method existed, PvnedIngestionAdapter was a class nobody
constructed and design 7.2's end-to-end 200 had no parser behind it.

The GLNs are read through the IConfiguration indexer rather than bound, so no PackageVersion is
added to a file eight parallel plans share, and a blank value counts as unconfigured because an
unset shell variable expands to one.

The other half: UNKNOWN_METERING_POINT and WRONG_BRP_FOR_METERING_POINT are declared here so plans
3, 5 and 6 read one spelling, and the adapter never returns either. Both need
customer.metering_point, which [F02-R40] forbids an adapter reading; shared contract 8.4 and 13.1
now say so, and 13.1's invalid-* scenario count is eleven rather than thirteen because those two
cases are quarantines with a replay path, not rejections.

Verified by mutation: rejecting a non-EAN resource with UNKNOWN_METERING_POINT reddens eight
across two classes (and would ship a FAILED message claiming a lookup the adapter cannot perform,
with no replay); AddSingleton instead of TryAddEnumerable reddens only the count assertion while
every resolution test stays green; and hard-coding the options reddens only the override test
while the two tests that look most like configuration coverage stay green."
```

---

### Task 16: The fixture inventory — twenty-five files, pinned, and the vacuity guard

Every assertion in this plan runs against a checked-in file, which makes the *set* of files a
silent dependency of the whole suite. Three ways it fails quietly:

1. **A fixture is deleted or renamed** and the tests that read it were themselves removed in the
   same commit. Nothing is red; a rule simply stops being covered.
2. **A fixture is added and nothing reads it.** It looks like coverage in a diff and is not.
3. **A fixture is generated.** Design §8's first risk row: the generator and the parser share an
   author and a source document, so a shared misreading of the PVNed format passes every test in
   the slice. The break in that circle is that every one of these files is hand-written — and
   nothing enforces "hand-written" except that each file says so and a test reads it.

This task pins the exact set, and walks every file through the adapter so that no fixture can sit
in the folder unexercised.

⚠ **The number is twenty-five, and it is stated in four places that must agree**: this plan's
Scope boundary, the `<EmbeddedResource>` comment in `PeakPower.Application.Tests.csproj` (Task 4),
the `<remarks>` on `PvnedFixtures` (Task 4), and the list below. Step 6 checks all four rather
than trusting them — a folder with two counts written about it is how the third one gets written
wrong.

**Files:**
- Test: `tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedFixtureInventoryTests.cs`
- No production file changes, and no fixture is added, moved or deleted by this task.

**Interfaces:**
- Consumes: `PvnedFixtures.AllNames`, `.Text` (Task 4); `PvnedAdapterHarness.Parse` (Task 6);
  `PvnedFailureCodes.Structural`, `.AdapterRaised` (Task 2).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedFixtureInventoryTests.cs`:

```csharp
using PeakPower.Application.Abstractions.Ingestion;
using PeakPower.Integration.Brp.Pvned;
using Shouldly;
using Xunit;

namespace PeakPower.Application.Tests.Ingestion.Pvned;

/// <summary>
/// The exact fixture set, pinned. The vacuity guard for every other test in this folder.
/// </summary>
/// <remarks>
/// <para>
/// A suite that reads files off disk has a silent dependency on which files are there. A fixture
/// deleted alongside the tests that read it leaves a rule uncovered and nothing red; a fixture
/// added and never read looks like coverage in a diff and is not. The list below is written out
/// by hand, a second time, so that adding or removing a file is a two-file edit and a reviewer
/// sees it.
/// </para>
/// <para>
/// <b>Every one of these is hand-written and checked in. None is generated.</b> Design section 8,
/// first risk row: the generator and the parser share an author and a source document, so a
/// shared misreading of the PVNed format would pass every test in this slice. The banner in each
/// file is the only thing that records the rule, and
/// <see cref="Every_fixture_declares_itself_hand_written"/> is the only thing that reads it.
/// </para>
/// </remarks>
public sealed class PvnedFixtureInventoryTests
{
    /// <summary>The twenty-five, in ordinal order, transcribed by hand.</summary>
    private static readonly string[] Expected =
    [
        "golden-a12-imbalance.xml",
        "golden-a23-both-directions-96.xml",
        "golden-a23-dst-autumn-100.xml",
        "golden-a23-dst-spring-92.xml",
        "golden-a23-non-ean-resources-96.xml",
        "invalid-incomplete-period-95.xml",
        "invalid-incomplete-period-autumn-96.xml",
        "invalid-incomplete-period-spring-96.xml",
        "invalid-invalid-measurement-period.xml",
        "invalid-invalid-positions-96.xml",
        "invalid-negative-quantity-96.xml",
        "invalid-total-rejection-second-series.xml",
        "invalid-two-rules-at-once.xml",
        "invalid-unknown-sender.xml",
        "invalid-unsupported-curve-type.xml",
        "invalid-unsupported-direction.xml",
        "invalid-unsupported-document-type.xml",
        "invalid-unsupported-measurement-unit.xml",
        "invalid-unsupported-resolution.xml",
        "invalid-wrong-receiver-a12.xml",
        "invalid-wrong-receiver.xml",
        "structural-billion-laughs.xml",
        "structural-missing-soap-body.xml",
        "structural-schema-pos-out-of-range.xml",
        "structural-xxe-external-entity.xml",
    ];

    [Fact]
    public void The_fixture_set_is_exactly_these_twenty_five_files()
    {
        PvnedFixtures.AllNames().ToArray().ShouldBe(Expected);
    }

    [Fact]
    public void There_are_twenty_five_fixtures()
    {
        PvnedFixtures.AllNames().Count.ShouldBe(
            25,
            "the count is stated in three places - this test, the <EmbeddedResource> comment in "
            + "PeakPower.Application.Tests.csproj and the <remarks> on PvnedFixtures - and they "
            + "have to agree");
    }

    [Fact]
    public void Every_fixture_declares_itself_hand_written()
    {
        // The only enforcement design section 8's first risk row has. A file produced by a loop,
        // a serialiser or PeakPower.DevStubs would not carry this banner unless somebody pasted
        // it in deliberately - at which point it is a lie a reviewer can see, rather than an
        // omission nobody notices.
        foreach (var name in PvnedFixtures.AllNames())
        {
            PvnedFixtures.Text(name).ShouldContain(
                "HAND-WRITTEN FIXTURE. Do not generate this file.",
                Case.Sensitive,
                $"{name} does not say it is hand-written");
        }
    }

    [Fact]
    public void Every_fixture_name_says_which_kind_it_is()
    {
        foreach (var name in PvnedFixtures.AllNames())
        {
            var kinds = new[] { "golden-", "invalid-", "structural-" };
            kinds.Any(kind => name.StartsWith(kind, StringComparison.Ordinal)).ShouldBeTrue(
                $"{name} is neither a golden document, a semantic rejection nor a structural "
                + "one, and the three prefixes are what the outcome assertions below select on");
        }
    }

    [Fact]
    public void Every_golden_fixture_is_accepted_or_recognised_and_closed()
    {
        foreach (var name in PvnedFixtures.AllNames()
                     .Where(name => name.StartsWith("golden-", StringComparison.Ordinal)))
        {
            var outcome = PvnedAdapterHarness.Parse(name);

            outcome.Status.ShouldNotBe(BrpParseStatus.Rejected, $"{name}: {outcome.FailureDetail}");
            outcome.FailureCode.ShouldBeNull(name);
            outcome.Document.ShouldNotBeNull(name);
        }
    }

    [Fact]
    public void Every_invalid_fixture_is_rejected_with_a_code_this_adapter_owns()
    {
        foreach (var name in PvnedFixtures.AllNames()
                     .Where(name => name.StartsWith("invalid-", StringComparison.Ordinal)))
        {
            var outcome = PvnedAdapterHarness.Parse(name);

            outcome.Status.ShouldBe(BrpParseStatus.Rejected, name);
            outcome.FailureCode.ShouldNotBeNull(name);
            PvnedFailureCodes.AdapterRaised.ShouldContain(outcome.FailureCode, name);
        }
    }

    [Fact]
    public void Every_structural_fixture_is_rejected_with_a_structural_code()
    {
        foreach (var name in PvnedFixtures.AllNames()
                     .Where(name => name.StartsWith("structural-", StringComparison.Ordinal)))
        {
            var outcome = PvnedAdapterHarness.Parse(name);

            outcome.Status.ShouldBe(BrpParseStatus.Rejected, name);
            outcome.FailureCode.ShouldNotBeNull(name);
            PvnedFailureCodes.Structural.ShouldContain(outcome.FailureCode, name);
        }
    }

    [Fact]
    public void No_fixture_is_empty()
    {
        foreach (var name in PvnedFixtures.AllNames())
        {
            PvnedFixtures.Text(name).Length.ShouldBeGreaterThan(200, name);
        }
    }

    [Fact]
    public void The_loader_names_every_fixture_when_one_is_missing()
    {
        // The error a contributor meets when they put a file in the wrong folder. Asserted
        // because a loader that threw a bare NullReferenceException would cost the next person
        // an afternoon, and because it is what makes the earlier tasks' red runs readable.
        var thrown = Should.Throw<InvalidOperationException>(
            () => PvnedFixtures.Bytes("no-such-fixture.xml"));

        thrown.Message.ShouldContain("no-such-fixture.xml", Case.Sensitive);
        thrown.Message.ShouldContain("golden-a12-imbalance.xml", Case.Sensitive);
        thrown.Message.ShouldContain("structural-xxe-external-entity.xml", Case.Sensitive);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedFixtureInventoryTests"
```
Expected: PASS — 9 passed, 0 failed. **This is the one task in the plan whose tests are green the
first time they run, and that is correct rather than a mistake:** it asserts a property of the
twenty-five files Tasks 4 to 14 checked in, and there is no implementation for it to drive.
Its value is entirely in steps 3 and 4 — a guard is only worth what its mutations prove.

⚠ If it is **not** green, do not adjust `Expected` to match. The two likely causes are a fixture
that was never written (compare the failure's list against the plan's own fixture table) and one
that landed in the wrong folder (the `<EmbeddedResource>` glob is
`Ingestion/Pvned/Fixtures/*.xml`, and nothing else is picked up).

- [ ] **Step 3: Mutation — add a fixture nothing reads**

The case a diff cannot show. Create a real file and run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
cp tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-two-rules-at-once.xml \
   tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-scratch-copy.xml
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedFixtureInventoryTests"
```

Expected: FAIL — two. `The_fixture_set_is_exactly_these_twenty_five_files` fails with Shouldly's
element-wise diff naming `invalid-scratch-copy.xml` at index 11, and
`There_are_twenty_five_fixtures` reports
`PvnedFixtures.AllNames().Count should be 25 but was 26`. **Every other test in the class stays
green**, including all four outcome walks — the copy is a valid `invalid-*` document and passes
them. That is the whole point: only the pinned list can see a file that nothing needed.

Then `rm tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-scratch-copy.xml`.

- [ ] **Step 4: Mutation — strip a hand-written banner**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
sed -i '' 's/HAND-WRITTEN FIXTURE. Do not generate this file./Generated fixture./' \
  tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/golden-a23-dst-autumn-100.xml
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedFixtureInventoryTests"
```

Expected: FAIL — exactly one, `Every_fixture_declares_itself_hand_written`, with
`golden-a23-dst-autumn-100.xml does not say it is hand-written`.
`The_fixture_set_is_exactly_these_twenty_five_files`, `No_fixture_is_empty` and every outcome walk
stay green — a generated fixture parses exactly as well as a hand-written one, which is precisely
why design §8's break in the circle has to be recorded in the file and asserted rather than
remembered.

Then `git checkout -- tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/golden-a23-dst-autumn-100.xml`.

- [ ] **Step 5: Mutation — delete a fixture and the tests that read it**

The failure mode step 1's `<remarks>` names, run for real:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
rm tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-wrong-receiver-a12.xml
dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~PvnedFixtureInventoryTests"
```

Expected: FAIL — two, the same pair as step 3, `AllNames().Count should be 25 but was 24` and the
element-wise diff naming `invalid-wrong-receiver-a12.xml` as missing at index 19.

⚠ **Now consider what happens without this class.** That file exists only because Task 6 proved a
misrouted A12 would otherwise be *recognised and closed* — a 200, a `PROCESSED` message and a
stored payload addressed to somebody else. Delete it together with
`A_misrouted_A12_is_rejected_rather_than_recognised_and_closed` and the suite is green, the diff
is small, and the strongest ordering argument in the plan is gone. This class is what makes that
a two-file edit a reviewer sees.

Then `git checkout -- tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/invalid-wrong-receiver-a12.xml`.

- [ ] **Step 6: Check that all four statements of the count agree**

The number lives in the test above, in two comments Task 4 wrote, and in this plan. Read all of
them rather than assuming:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -rn 'twenty-three\|twenty-two\|twenty-four\|twenty-six' \
  tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedFixtures.cs \
  tests/PeakPower.Application.Tests/PeakPower.Application.Tests.csproj \
  tests/PeakPower.Application.Tests/Ingestion/Pvned/PvnedFixtureInventoryTests.cs \
  > /tmp/pvned-counts.txt
wc -l /tmp/pvned-counts.txt
cat /tmp/pvned-counts.txt

ls tests/PeakPower.Application.Tests/Ingestion/Pvned/Fixtures/*.xml > /tmp/pvned-files.txt
wc -l /tmp/pvned-files.txt
```

Expected: `/tmp/pvned-counts.txt` is **empty** — `0` lines — and `/tmp/pvned-files.txt` holds
**25**. ⚠ Read both files rather than the terminal: a shell hook in this environment rewrites
`grep` and `ls` through a wrapper that truncates output, so a bare `grep` that prints nothing is
not evidence that nothing matched.

If a comment still carries an older number, it was written before Tasks 12, 13 and 14 added their
six fixtures — 19 files exist when Task 12 starts and 25 when Task 14 ends. Change the word and
nothing else.

- [ ] **Step 7: Run the whole suite**

Run:
```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo
dotnet build --nologo -warnaserror
tools/verify-build-settings.sh
tools/verify-solution-layout.sh
```
Expected: the whole `PeakPower.Application.Tests` project green, a clean `-warnaserror` build, and
both guard scripts passing. `verify-solution-layout.sh` is **untouched by this plan** — the project
count is still twenty-two and no test project was added, exactly as the Scope boundary said.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Application.Tests
git commit -m "pvned: pin the twenty-five fixtures, and walk every one through the adapter

A suite that reads files off disk has a silent dependency on which files are there. A fixture
deleted alongside the tests that read it leaves a rule uncovered with nothing red; a fixture added
and never read looks like coverage in a diff and is not. The list is transcribed a second time by
hand, so either edit is a two-file change a reviewer sees.

Every golden document is accepted or recognised-and-closed, every invalid-* is rejected with a
code in AdapterRaised, and every structural-* with one of the three structural codes - so no file
can sit in the folder unexercised.

Every fixture also has to SAY it is hand-written. That banner is the only enforcement design 8's
first risk row has: the generator and the parser share an author and a source document, and a
generated fixture parses exactly as well as a hand-written one.

Verified by mutation: an unread copied fixture reddens only the pinned list and the count while
all four outcome walks stay green; stripping one banner reddens only the hand-written assertion;
and deleting invalid-wrong-receiver-a12.xml - which exists solely because a misrouted A12 would
otherwise be recognised and closed with a 200 - reddens the list rather than passing quietly.

The count is stated in four places - this test, the two comments in PvnedFixtures and the csproj's
EmbeddedResource item, and the plan - and step 6 reads all four rather than trusting them."
```

---

## What this plan decided, and what it leaves open

Two decisions this plan made because neither the design document nor the shared contract settled
them, promised in the Scope boundary above and repeated here so a reviewer does not have to find
them:

1. **Three structural failure codes** — `MALFORMED_XML`, `MISSING_SOAP_BODY`,
   `SCHEMA_VALIDATION_FAILED` (Task 2). Integration-spec §8.1 states three structural rules and
   names no code for any of them; design §7.3 requires a machine-readable code on every failure.
   They are `PvnedFailureCodes.Structural` and Task 16 asserts that the three structural fixtures
   return one of exactly those three.
2. **The reconstructed XSD validates structure, not code lists** (Task 4). `CurveType`,
   `MeasurementUnit`, `Direction`, `DocumentType`, `ProcessType` and `BusinessType` are plain
   strings in the schema and are enforced semantically, so an operator sees the frozen §8.2 code
   rather than a schema error. Without this, the `UNSUPPORTED_CURVE_TYPE` and
   `UNSUPPORTED_MEASUREMENT_UNIT` rows of contract §8.4 are unreachable. `SchemaProvenance` rows 5
   and 9 record it.

And one decision made inside a task rather than up front:

3. **The check order** (Global Constraints, asserted by Task 14). The eleven §8.2 rules are a
   table, not a sequence. Structural checks run before header checks, header checks before
   per-series ones, and the receiver and sender checks run **before** the `DocumentType` branch —
   that last one is load-bearing rather than stylistic, and Tasks 6 and 14 prove it from the A12
   and A23 sides respectively.

**Still open, and deliberately not answered here:**

- `[OQ-20]` — whether `Period.TimeInterval` ever legitimately disagrees with `MeasurementPeriode`.
  The interim answer is Task 10's: `MeasurementPeriode` + `Pos` are authoritative and the
  discrepancy is **logged, never used**. The log line is the only evidence the `[OQ-65]`
  walkthrough will have.
- `[OQ-97]` — the GS1 check digit. `[DEC-114]` relaxed EAN validation to "eighteen digits" and
  this slice does not reinstate it (Task 13).
- `[OQ-05]` / `[F02-R08]` — the SOAP acknowledgement's form. Design §3.2 defers it, and building
  one would guess at a third party's wire format.
- **The reconstructed XSD is nine documented guesses** (`SchemaProvenance`). Swapping in PVNed's
  real `TimeSeriesDocument-v2p0.xsd` is a diff review rather than a silent substitution, which is
  the entire reason the file name says `reconstructed` and a test asserts that it does.
