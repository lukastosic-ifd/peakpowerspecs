# PoC Slice 2 — "From a document on the wire to a day on the screen"

> **Status:** Draft for review · **Date:** 2026-09-07 · **Predecessor:** [slice 1](2026-08-26-poc-slice-1-design.md)
>
> **Section-reference convention.** Bare `§n` always means a section of **this** document. References to
> other documents are always qualified — "integration-spec §8.2", "F02 §4", "roadmap §3".

**Goal.** A customer opens a connection and sees a correct, honestly-labelled day and month of their
own metering data — and every kWh on that screen arrived as a PVNed-format `TimeSeriesDocument` over
the real BRP webhook, through the real parser, validator and versioning pipeline.

**Roadmap position.** This is [roadmap §3, Phase 1 — *See your data*](../../../specs/70-delivery/01-roadmap-and-phasing.md):
metering-data ingestion `[F02]` behind the `[DEC-69]` BRP port, and consumption charts `[F03]`.
No money moves.

---

## 1. Why this slice

The roadmap says "everything else depends on" ingestion. The feature specifications do not quite
agree — `F04`, `F05` and `F06` each carry a dependency table and none names `F02` or `F03`, and the
roadmap's own parallelisation graph has exactly one Phase-1→Phase-2 edge (Charts → Block overlay, a
leaf). Trading is reachable without a meter reading. The argument for doing this first is narrower
than the roadmap states, and it survives:

1. **Ingestion is the only Phase-1 work whose mistakes are unrecoverable.** A wrongly-ordered
   supersession is indistinguishable from correct data afterwards. `[DEC-22]`'s per-interval net
   usage cannot be reconstructed from stored daily totals (§4.1). Getting the version, quarantine and
   completeness shapes wrong now is a rewrite; getting a trade wrong is a bug.
2. **Only the deferred half of `F03` depends on `F05`.** The block overlay needs confirmed blocks
   (§3.2); the rest of the chart does not, and the dependency that matters runs the other way —
   charts built now make the Phase-2 overlay additive, while trading built first leaves the customer
   composing a request without the chart that step **A1** of the trade-lifecycle process opens with
   ("Reviews consumption chart and coverage") and the trade desk pricing at **B2** ("Trader reviews:
   position · wallet · indication") against a position it cannot see.
3. **The seam is worth building while there is exactly one adapter to check it against** — the
   roadmap's own argument for `[DEC-69]`, and it expires the moment a second BRP exists.

Slice 1 shipped with zero metering-**data**, time-series, ingestion or chart code. (Metering *point*
code does exist — `MeteringPoint`, `Brp`, `EanPoolEntry`, and the `metering` schema's `brp` and
`ean_pool` tables. What is absent is anything that holds a reading.) One architecture fact already
names `PeakPower.Ingestion` and skips, waiting for it.

### 1.1 What this slice cannot do, stated first

The roadmap lists **ten** Phase-1 exit criteria. This slice:

- **meets three** — a correct day and month chart; DST days handled correctly; data states visible;
- **cannot meet one** — "real PVNed data arriving in production";
- **rules three out as unbuildable** under `[DEC-119]` — the break-glass rehearsal, the Entra
  claim-mapping demonstration, and the MFA-claim rejection (§3.2);
- **defers two in writing rather than meeting them** — "ingestion alerting proven by a deliberate
  outage test" (the conditions are built, the channel is not, and no outage test is run — §3.2) and
  "every metering point has a production expectation that is not `UNKNOWN`, or is on a named worklist
  `[DEC-65]`, declared by the customer at onboarding `[DEC-112]`" (the worklist is `[F02-R35]` /
  `[F01-R54]`, which is `F01` work);
- **makes the tenth moot** by moving `p1g`, the customer usage API, to Phase 2 (§3.2).

On the one it **cannot** meet: `[OQ-05]` — the endpoint, the authentication mechanism, the
acknowledgement form and the retry policy — has never been answered, and risk `[R-01]` (score 20,
**joint** highest on the register with `[R-10]`) is deferred rather than closed.

`[DEC-21]` sanctions building against generated data, and `[F02-R29]`/`[F02-R30]`/`[F02-R31]` specify
exactly how: documents generated in PVNed format and delivered over the adapter's **real endpoint**.
That is what this slice does. It does not lower the criterion, and §9 records the residual in writing
rather than absorbing it.

**Audience decision (2026-09-07):** the deployed VM is an **internal team environment**. Generated
data therefore needs no on-screen synthetic-data labelling, and TLS, a staging environment and
pre-deploy database dumps are out of scope. §3.2 records the trigger that would bring them back.

---

## 2. Decisions taken for this slice

| # | Decision | Why |
| --- | --- | --- |
| **S2-D1** | **Denormalise `customer_id` onto every customer-readable metering table** rather than widening the RLS coverage guards' predicate | Both guards discover tables by `property.Name.EndsWith("CustomerId")` (`QueryFilterModelTests.cs:119`, `RowLevelSecurityTests.cs:608`). A table keyed only by `metering_point_id` is invisible to them — they would report full coverage over unpoliced customer data. Denormalising makes discovery automatic, preserves the cheap `column = app.customer_id` policy shape, and is semantically right: the reading belongs to whoever held the EAN on that delivery date, which quarantine rule `[F02-R15]` has already resolved by then |
| **S2-D2** | **`interval_data_version` carries `source NOT NULL CHECK IN ('BRP_FEED','MANUAL')`**, with nullable `inbound_message_id` and `document_id` and a CHECK tying `BRP_FEED` to a non-null message. **No `brp_id` column** | The published DDL in [database design §3.2](../../../specs/20-architecture/04-database-design.md) has `document_id text NOT NULL` (a plain column holding the PVNed `DocumentIdentification`, not a foreign key) and the `inbound_message_id` FK `NOT NULL`, and no `source` column — which makes `[F02-R36]`'s manual version unstorable, while F02 §8 says the table carries one. The two documents contradict each other and must be settled before migration 9 is written. The database design's argument against `brp_id` is right: a second column can disagree with the message it came from, and a manual version correctly has no BRP |
| **S2-D3** | **Adapter resolution is by the stored `brp_id` at dequeue time, never by a field in the payload** | `[F02-R41]`: "The stored `brp_id` is what selects the adapter at processing time, so a replay `[F02-R27]` is parsed by the same adapter that first parsed it — including after that BRP has been deactivated." Implemented in step 4, asserted by §7.7 |
| **S2-D4** | **The generator emits templated XML *text*, never a serialisation of the parser's own model** | Otherwise generator and parser share a type, and a shared misreading of the PVNed format passes every test in the slice. See **§8**, first risk row |
| **S2-D5** | **Defer the charting-library choice `[OQ-22]`; hand-roll the charts** | The phase-0 spike is specified as "the day chart **with block overlay**" — blocks are Phase 2, so the spike as written cannot be run here. Signed bands, a step overlay **and touch** are what stress a library; three lines and 96 points on a desktop are not — which is why `[F03-R25]` is deferred with the library choice (§3.2) rather than hand-rolled twice. Confined to **two** `shared-ui` components (`PpUsageChart`, `PpUsageMonthChart`) sharing one data-in/SVG-out contract and no consumer knowledge of how they draw, so replacement is two files plus their specs |
| **S2-D6** | **Volumes only — no price or money figure anywhere on the chart** | Product decision, 2026-09-07. `F08` is Phase 3. `[F03-R05]` would permit a past interval's day-ahead price in the tooltip, and EPEX 15-minute data exists on disk, but a euro figure invites the inference that the price feed is live. Deferred to the slice that has a real feed |
| **S2-D7** | **Roll forward only.** Recovery is redeploy-the-previous-commit; there is no `Down()` path | The deployed `DatabaseMigrator` only calls `MigrateAsync`, so nothing in the shipped code path invokes `Down()` (a developer can still run `dotnet ef database update <earlier>` by hand). An undocumented policy is not a policy, so it is written here. Acceptable on an internal box whose data is regenerable by re-running DevStubs |
| **S2-D8** | **The platform's working-day calendar is Monday–Friday with an empty exclusion list. `AddWorkingDays` counts weekdays and ignores public holidays.** One calendar, shared with the peak rule | Answered 2026-09-07. `[F02-R23]` requires "the platform's working-day calendar" and **no specification defines one** — the phrase appears with the definite article and no referent. `[OQ-02]`/`[DEC-19]` settled the *peak* calendar as Mon–Fri 08:00–20:00 with holidays included as peak days, and `[DEC-14]` already provides the mechanism this reuses: a named calendar carrying "the working-day rule and the holiday list as data", with the list **currently empty**. Reusing it needs no new reference data and no new table. **What makes ignoring holidays safe here is `[DEC-98]`**: before it, `FINAL` meant final, so finalising early across Christmas or King's Day would have shut a correction window that should have stayed open. After it, `FINAL` is a *status*, a post-window version is **routine**, and a late reconciliation simply reopens the date to `PROVISIONAL` and re-finalises. The risk that would have argued for a holiday list has already been defused by a decision taken for other reasons. Because the list is data, populating it later is a row, not a release |

---

## 3. Scope

### 3.1 In

**Projects and guards**
- Four new projects: **`src/Infrastructure/PeakPower.Ingestion`** (BRP-agnostic pipeline — this exact
  path is what the skipped fact's message names), `src/Infrastructure/PeakPower.Integration.Brp.Pvned`
  (adapter), `src/Hosts/PeakPower.Worker` (webhook host + job server), `src/Hosts/PeakPower.DevStubs`
  (generator)
- **Arm the skipped architecture fact.** `CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter`
  skips today with a message naming the exact `<ProjectReference>` to add. Adding it enforces
  `PeakPower.Ingestion` referencing no assembly whose name starts `PeakPower.Integration.Brp`
- `tools/verify-solution-layout.sh` — its hardcoded `expected` array grows 18 → 22

**Data — migration 9**
- Seven tables: `inbound_message`, `interval_data_version`, `interval_reading`, `metering_point_day_state`,
  `quarantined_series`, `daily_position`, `operational_alert`
  - `interval_reading` is range-partitioned on `delivery_date` and stores `position` **and** the
    resolved `interval_start timestamptz` from `Infrastructure.Time.IntervalStart` — this is what lets
    the `market.calendar_interval` spine be deferred (§3.2)
  - `daily_position` per §4.1
  - `operational_alert` carries the conditions of `[F02-R12]` (validation failure), `[F02-R26]`
    (silence), `[F02-R34]` (promotion), `[F02-R35]` (missing production declaration) and `[F02-R45]`
    (the informational notice to Finance). The **conditions** are built and tested; only the delivery
    channel is deferred (§3.2)
- `metering.brp` gains `endpoint_uri`, `credential_ref`, `document_format`, `adapter_key`,
  `expected_cadence`, `created_at`, and `UNIQUE(adapter_key, code)`. It has only `id/code/name/is_active`
  today, so the `[DEC-69]` seam has no data behind it and cannot select an adapter.
  **`credential_ref` holds the *name of an environment variable* the Worker reads
  (`BRP_CREDENTIAL_<CODE>`), never a secret** — migration 9 seeds the `PVNED` row with
  `BRP_CREDENTIAL_PVNED` and `deploy/env.example` gains it. No secret store is introduced; see §3.2
  and `[OQ-102]`
- `customer.metering_point` gains `brp_assigned_at`, and a `metering_point_brp_assignment` history row
  carrying actor, timestamp and reason per `[F02-R43]` — `brp_assigned_at` alone cannot answer who
  moved the point or why. Also `first_production_observed_at`
- The RLS policy pairs, the explicit `REVOKE`s (§4), and the free drop of the dead
  `CustomerAccount.ExternalSubjectId` column that `CLAUDE.md` assigns to the migration after slice 1

**Tenancy** — per **S2-D1**. Four global query filters. ⚠ Adding them is necessary but **not
sufficient**: both guards pin exact literals that the four new tables break, and they must move in the
same commit — `QueryFilterModelTests.cs:143`'s nine-name `expected` array grows to thirteen, and
`RowLevelSecurityTests.cs:653`/`:674` grow `customerIdOwned.Length` and `customerOwned.Length` from 7
to 11. (These guards live in `PeakPower.Integration.Tests`, so they fail `dotnet test`, not
`-warnaserror`.) `inbound_message`, `quarantined_series` and `operational_alert` get `app_employee_role`
policies and `REVOKE ALL` from `app_customer_role`. The partition-creation routine applies
`ENABLE ROW LEVEL SECURITY` and both policies to every partition it creates.

**Market calendar** (`PeakPower.Infrastructure.Time` — architecture fact 5 is IL-enforced, nothing
outside it may read the clock)
- `ExpectedIntervalCount(DateOnly)` → 92 / 96 / 100
- `IntervalStart(DateOnly, int pos)` → Amsterdam local instant, **including the autumn duplicate hour**
  (Pos 9–12 first pass, 13–16 second). This is the one detail a generic add-15-minutes loop gets wrong
- `IsDstDuplicate(date, pos)`
- `AddWorkingDays` for the 10-working-day FINAL rule, per **S2-D8**: **Monday–Friday, empty exclusion
  list, holidays ignored**. Read the weekday set and the exclusion list from the `[DEC-14]` calendar
  rather than hard-coding them, so populating the list later is a row and not a release

**The BRP-agnostic pipeline**
- `IBrpIngestionAdapter` returning a canonical series (metering point, delivery date, direction,
  position, quantity) plus document identity, or a typed rejection
- `IRawPayloadStore` with a filesystem adapter on a named Docker volume
- Receive-store-and-enqueue: **strictly greater than** 25 MB → 413; **200 OK before any parsing**
  (`[F02-R04]`/`[F02-R05]` make asynchrony structural, not an optimisation — it is what stops a parser
  bug becoming a redelivery flood); byte-identical dedupe within 24 h
- A **correlation id** stamped at receipt and carried through queue, adapter and apply. In scope
  because retrofitting one across an async hop later rewrites every log line
- Advisory lock on `hash(metering_point_id, delivery_date)`; atomic whole-document apply
- **Receipt-order supersession** behind the `ux_idv_current` partial unique index (§4.2)
- Adapter resolution per **S2-D3**
- Quarantine on `UNKNOWN_EAN`, `EAN_VALIDITY`, `WRONG_BRP`, `NOT_ELECTRICITY`

**The PVNed adapter**
- SOAP envelope unwrap; XML reading with `DtdProcessing.Prohibit` and `XmlResolver = null`
- Validation against a reconstructed, explicitly-named `TimeSeriesDocument-v2p0.reconstructed.xsd`,
  with a `SchemaProvenance` document listing the nine integration-spec §9 inconsistencies and the
  **permissive** reading taken on each, one test per row
- Code decoding: `DocumentType` **A23 processed; A12 recognised, the message stored and closed with
  zero readings written** under `[DEC-25]` (§3.2); every other `DocumentType` rejected. `ProcessType`;
  Direction A01→`PRODUCTION` / A02→`CONSUMPTION` with A03/A04 rejected; Resolution PT15M; CurveType A01.
  **Direction decoding is a financial control, not a display concern** — under `[DEC-22]` a mis-mapped
  direction produces a wrong invoice
- `ResourceObject` interpretation per `[F02-R11]`/`[AS-17]`: eighteen digits is an EAN, anything else is
  a descriptive resource label (`Prognosis`, `Realisation`, `Imbalance`, …) and is **never** offered to
  the EAN resolver — otherwise a labelled document quarantines as a false `UNKNOWN_EAN`
- `[OQ-20]` implemented with the integration spec's stated interim answer: `MeasurementPeriode` + `Pos`
  are authoritative; `Period.TimeInterval` is logged as a discrepancy and never used to place points
- The **eleven** named semantic failure codes from integration-spec `§8.2`

**Data state and rollup**
- **Completeness is judged per document against the period that document declares**, never per day
- `metering_point_day_state`: `NO_DATA` / `PARTIAL` / `PROVISIONAL` / `FINAL` per (metering point,
  delivery date), computed against `production_expectation` — `NEVER` means a declared zero, `UNKNOWN`
  reads as `EXPECTED` — **never** "both directions present". `[F02-R32]` forbids "both directions
  present" as the completeness test `[DEC-65]`; integration-spec `§8.3` names the prohibited
  implementation literally — "This check must not be written as `directions.Count == 2`" — and says it
  fails silently: every non-producing connection stops invoicing and the cause looks like a PVNed fault
- `[F02-R34]`: an A01 series arriving for a `NEVER` point moves it to `production_expectation =
  EXPECTED` **with source `OBSERVED`** in the same transaction and stamps
  `first_production_observed_at`. `production_expectation` takes `NEVER` / `UNKNOWN` / `EXPECTED`; the
  column exists today and migration 9 does not change it
- `daily_position` per §4.1
- The FINAL job on the 10-working-day rule, with the routine FINAL→PROVISIONAL reopen edge.
  `[DEC-98]` makes FINAL a status, not a guarantee: nothing may archive, compact or cache on it
- Per-metering-point silence detection at the BRP's `expected_cadence`. It writes an `operational_alert`
  row and surfaces the point on the employee data-health screen; **no notification is sent** — alert
  and notice *delivery* is deferred (§3.2)

**`PeakPower.DevStubs`** — the **sixteen** scenarios from integration-spec `§11`: normal 96-interval
days with a plausible load shape; both directions for producing EANs; no A01 at all for non-producers;
days where production exceeds consumption; 92- and 100-interval DST days; a correction that supersedes;
an out-of-order pair; a post-window reconciliation; an unknown EAN; a wrong-BRP EAN; one deliberately
invalid document per integration-spec `§8.2` rule; a 25 MB document (accepted at the boundary) and a
26 MB document (refused); one document per EAN per day as the cadence `[DEC-38]`; a day where the
consumption series arrives and the production series does not for an EAN flagged as producing.
Two of integration-spec §11's sixteen are **out**: the imbalance report (§3.2, `[DEC-25]`) and the
manual reconciliation entry (§3.2, `[F02-R36]`).
Plus a 90-day backfill across the eleven seeded connections and a cadence pusher, both behind the
existing `SeedingGate` confirmation-phrase pattern. All authenticate as the `PVNED` BRP row and push
over the **real webhook** — `[F02-R30]` forbids any code path that writes readings directly.

**Customer read surface**
- `GET /api/v1/consumption/day?date=&meteringPointIds=` and `.../month?month=&meteringPointIds=`
- The published envelope **trimmed to Phase 1**: `intervalCount` and `dataState` kept;
  `blocks[]`, `blockKwh`, `netPositionKwh` and `dayAheadPriceEurMwh` **dropped rather than returned as
  zeros**; per-interval `netUsageKwh` added. The published example is pre-`[DEC-22]` — it carries a
  gross-consumption summary and no `netUsageKwh`, so implementing it verbatim would ship the wrong
  product
- Missing intervals are **absent entries**, never zero and never null
- `LastDataDate` populated on both connection DTOs; a 14-day data-state series on connection detail

**Employee back office** — `GET /data-health/messages?brpId=`, `GET /data-health/quarantine`,
`GET /data-health/metering-points` (including points with no BRP assigned),
`POST /data-health/messages/{id}/replay`. The employee host runs unscoped by construction, so none of
this needs tenancy work.

**Frontend**
- `PpUsageChart` in `libs/shared-ui`: three series (consumption, production, net usage) on an axis
  that accommodates **negative** net usage with the zero line always drawn; 92/96/100 points read from
  the envelope; missing intervals as **gaps**; hour ticks with the autumn duplicate labelled
  `02:00 A` / `02:00 B`; hover tooltip with the local time range and the three volumes.
  Plus `PpUsageMonthChart`, a bar chart where missing days are **marked stubs**, not short bars
- **Navigation**, per `[F03-R07]`/`[F03-R09]`/`[F03-R21]` — all three *Must*: previous/next day; a
  hand-rolled date picker (`[OQ-49]` is deferred, so no component library supplies one); a
  jump-to-latest driven by `LastDataDate`; a clickable month bar that drills into that day; and a
  metering-point selector over the connections the customer holds — one, several or all, with several
  summed server-side through the existing `meteringPointIds` parameter
- The `/consumption` route: the rail already declares the row, labelled **Volume** per `[DEC-115]`,
  disabled with the reason "Consumption charts arrive with metering-data ingestion." — enabling it is
  **three** one-line edits (`PATH`, `ENABLED_ROUTE_KEYS`, dropping the `DISABLED_REASON` entry) plus one
  **five-line** guarded lazy route in `app.routes.ts`. Note `ENABLED_ROUTE_KEYS` is read only by its own
  spec — `PATH` is what actually puts the row on screen. ⚠ Three pinned assertions must move in the
  same commit or the suite goes red: `customer-nav.spec.ts:79` (the enabled set),
  `customer-nav.spec.ts:92` (`disabled.length` is 5), and `app.routes.spec.ts:34` (`GUARDED`)
- A KPI strip trimmed to total consumption, total production and total net usage, **each carrying its
  range's data state**; the **five** visual treatments (gap, partial, provisional, corrected-on, and
  **declared zero** — `[F02-R33]` requires the production line of a `NEVER` connection to read as a
  stated zero traceable to its source, setter and date `[F01-R40]`, not as an absence); an informative
  empty state
- The 14-day data-quality strip on connection detail; `LastDataDate` replacing `NO_DATA_YET`.
  ⚠ `connection-detail-page.spec.ts` actively asserts the date is **not** printed even when present on
  the wire — that spec must be inverted in the same commit or the suite goes red
- A rewritten dashboard banner and lede. It currently says "There is no metering data yet, so this page
  has nothing to total" — false the moment data exists. **Nothing asserts that sentence today**
  (`dashboard-page.spec.ts` covers only the greeting, the `/connections` link, the single `h1` and four
  CSS rules), so the copy change is free — add an assertion for the replacement while there
- Employee ingestion-health screens: inbound message log, quarantine panel with reason/age/replay, and
  the per-connection 21-day state heat map — **all three already drawn in one committed mockup,
  `specs/60-mockups/employee-ingestion-health.svg` (in the *spec* repo, not `peakpower-web`)**. The
  customer-side mockups are committed there too: `ean-detail.svg` (the 14-day strip) and
  `chart-day-view.svg` / `chart-month-view.svg`. ⚠ The day view is drawn **with** the block overlay and
  coverage KPIs that §3.2 defers — build to the trimmed envelope, not to the mockup verbatim

**CI** — in both repositories, **gating deploy**. Platform: `dotnet build -warnaserror`, `dotnet test`
(Docker for Testcontainers), the five `tools/verify-*.sh` (`verify-aspire-api.sh`,
`verify-build-settings.sh`, `verify-migrator.sh`, `verify-repositories.sh`,
`verify-solution-layout.sh`). Web: `npm test` with a second checkout of `peakpower-platform`. Deploy
workflows gain `needs:` on the test job, plus a `flock` so the two repos' deploys cannot build
concurrently, and a bounded image prune.

> ⚠ **The CI skip trap.** `AppHost.Tests` runs **124/124 with zero skips** when `peakpower-web` is
> checked out beside the platform, and drops to roughly **64 passed / 60 skipped** when it is not —
> losing every `ComposeRuntimeTests` and `PublishedStackTests` guard, most of `ImageBuildTests`,
> `PortalOutputPathTests` and all of `FrontEndInstallTests`. (`CommittedComposeFileTests` survives: it
> reads the committed `deploy/docker-compose.yaml` rather than the model.) The gates are
> `Assert.SkipWhen(builder is null, "no peakpower-web checkout; the portals are not in the graph")` in
> 29 places, plus `PublishedStackTests.SkipWithoutTheWebCheckout()` and `PortalOutputPathTests`' two
> variants. **The CI job must assert zero skipped tests in `AppHost.Tests`**, and across the solution
> that the set of skipped test names equals a checked-in allow-list — verified by deliberately dropping
> the second checkout and watching the first assertion fail. Re-measure the 64/60 figure when you
> implement this rather than quoting it.

**Deployment shape** — register the Worker host and the raw-payload volume in the Aspire AppHost,
re-run `aspire publish -o ./deploy`, commit the regenerated compose file, add the Worker runtime stage
to `deploy/Dockerfile`, extend `env.example` (including `BRP_CREDENTIAL_PVNED`), update
`CommittedComposeFileTests` and `ImageBuildTests`. **`PeakPower.DevStubs` does not ship in the compose
file**; it is run from a developer machine against the deployed webhook, authenticating with the same
`BRP_CREDENTIAL_PVNED` value. The compose file is **generated and committed** because the server has no
.NET SDK; hand edits are discarded on the next publish.

**Specification corrections carried by this slice** — see §11. ⚠ Rows 1–3 land **before** step 3.

### 3.2 Out

| Deferred | Why |
| --- | --- |
| Block overlay and coverage bands (`[F03-R13]`…`[F03-R18]`), the coverage half of the KPI strip — block volume, covered %, uncovered MWh, surplus MWh and the indicative day-ahead value (`[F03-R19]`, with `[F03-R20]` for its data state) — and the "Hedge this exposure" action (`[F03-R24]`) | The roadmap defers block overlay and coverage KPIs to Phase 2 in writing (its F03 row reads exactly "Block overlay, coverage KPIs"). They need confirmed blocks, which is `F05`. A permanently disabled Hedge button reads as a bug, so it is omitted rather than greyed out |
| **Every money and price figure** — the `[F03-R05]` tooltip price, the indicative spot-value KPI, the cost/credit pair | **S2-D6**. `F08` is Phase 3 |
| **Alert and notice *delivery*** — the operator alert of `[F02-R12]`, the silence alert of `[F02-R26]`, the promotion alert of `[F02-R34]`, the onboarding worklist of `[F02-R35]`/`[F01-R54]`, the Finance notice of `[F02-R45]` | The **conditions** are all built and tested (§3.1); only the channel is deferred. Each condition writes an `operational_alert` row that the employee data-health screens render, and no mail, pager or webhook is wired. `[DEC-104]` is one operator with no rota, so a channel with no rota behind it is decoration. **This is why the Phase-1 exit criterion "ingestion alerting proven by a deliberate outage test" is not met — see §1.1** |
| **`F15` Audit** — master-data audit generally, health-check endpoints, alert channels | Named in roadmap §3 as a Phase-1 feature ("Master-data audit, correlation, health checks, alerting"). **Split rather than deferred whole:** the **correlation id** and the **BRP-reassignment audit** `[F02-R43]` are **in** scope (§3.1) because both are far more expensive to retrofit; the rest defers with the other operational rows |
| The **public machine-to-machine** customer usage API (roadmap bar `p1g`) — distinct from the portal's session-authenticated `/api/v1/consumption/*` endpoints, which are **in** scope — and CSV/PNG export (`[F03-R23]`) | The roadmap gives its own escape hatch: if `[OQ-95]` is unanswered when `p1g` starts, the bar moves to Phase 2 rather than being guessed. `[OQ-95]` is open. The API also needs an unattended per-company credential and a per-company rate limit, neither of which Phase 1 otherwise builds |
| Manual entry and reconciliation (`[F02-R36]`/`R37`/`R38`/`R47`) | Deferred, but **the schema is not**: migration 9 ships the `source` discriminator and nullable `inbound_message_id` per **S2-D2**, so a MANUAL version is storable the day the screens are built |
| The correction-invoice hand-off (`[F02-R46]`) and `AFFECTED_BY_CORRECTION`'s destination (`[F02-R20]`) | `F10` does not exist and no invoice has ever been raised. **F02 §4**'s "the correction path must be live from day one", written against `[DEC-98]`/`[DEC-99]`, is read as day one of **invoicing** — this reading needs confirming (§12) |
| A12 imbalance ingestion (`imbalance_reading`, `imbalance_price`, the integration-spec `§7.2` mapping) | `[DEC-25]` puts imbalance out of scope: an A12 document is recognised, stored and closed with zero readings written (§3.1), and no charge is derived |
| `[F02-R21]` per-interval version diff, `[F02-R28]` derived-data rebuild, `[F02-R08]` SOAP acknowledgement | All three are *Should*. R08's form is unknown (`[OQ-05]`), so building one would guess at a third party's wire format. R21 and R28 are employee conveniences that replay substitutes for at PoC scale |
| The `market.calendar_interval` spine (35,040 rows/year) and `calendar_interval_peak` | Its value is turning coverage, invoicing and charting into joins — all Phase 2/3. `interval_reading.interval_start` is stored (§3.1), so the spine is a later pure join optimisation |
| Month-view weekend and peak-window shading (`[F03-R11]`) | A *Should*. R11 shades **Saturdays and Sundays** under `[DEC-19]`, and additionally any populated `excluded_dates[]` — which `[DEC-14]` records as currently **empty**. What R11 forbids is a hard-coded **holiday list**, not a Sat/Sun rule, so the shading is buildable now. It is deferred because the **peak-window** half needs the `market.peak_calendar_version` / `calendar_interval_peak` reference data that Phase 2 introduces for `F05` |
| Touch and small-screen behaviour (`[F03-R25]`), the kWh↔average-kW toggle (`[F03-R04]`), comparison mode (`[F03-R22]`), quarter and year views (`[F03-R12]`) | All *Should* or *Could*. `[F03-R25]` is the one that costs later rather than now: it is one of the three things F03 §10 says the charting library must do, so a hand-rolled chart with hover-only interaction is honest about **S2-D5** — the deferral buys a desktop chart, not a finished one, and touch is deliberately left to stress the Phase-2 candidate |
| Choosing a charting library (`[OQ-22]`) or component library (`[OQ-49]`); running the phase-0 charting spike | **S2-D5** |
| Real object storage (MinIO, S3) for raw payloads | A filesystem adapter on a named volume behind `IRawPayloadStore` keeps `payload_uri` and the port shape while adding no service to a single-VM deployment. Seven-year retention is not a PoC concern; the swap is one adapter |
| **Break-glass `[DEC-53]`, the Entra claim-mapping spike `[F13-R32]`, MFA claim rejection `[DEC-92]`** — all named in roadmap §3 as Phase 1, two as exit criteria | **Unbuildable as written, not deferred.** `[DEC-119]` removed the identity provider outright: JWT only, customers and staff, no Entra anywhere. Break-glass is the fallback for a provider that no longer exists. This is why amending roadmap §3 is in scope (§11) |
| The real PVNed integration — endpoint, auth, acknowledgement, retry | `[OQ-05]` unanswered; `[R-01]` deferred, not closed. Nothing here needs PVNed itself: the BRP row is configuration, so pointing it at a real endpoint later is a data change plus a credential |
| **TLS, API healthchecks, staging, pre-deploy `pg_dump`, moving image builds off the VM, secrets management** | Audience decision 2026-09-07: internal team box. **Trigger to reinstate:** the day this deployment holds data that cannot be regenerated by re-running DevStubs, or the day anyone outside the team is given the URL. `[OQ-102]` (§12) blocks any secret store regardless |

---

## 4. Tenancy and the two shapes that must be right

### 4.1 `daily_position`, and why per-interval derivation is load-bearing

`[DEC-22]` sets the volume basis to **net usage = consumption − production, per interval per metering
point**, and records that it **may be negative** when production exceeds consumption — treated as
export and settled under `[DEC-23]`. [Position & coverage §2.1](../../../specs/50-calculations/02-position-and-coverage.md)
is explicit that consumption and production "remain two separate, non-negative series per metering
point `[AS-05]`. `netUsage` is computed from them per interval; neither series is overwritten with a
signed value."

**The daily net total alone is lossy, and it is worth being precise about why**, because a naive
reading says it is not: Σ(cᵢ − pᵢ) is arithmetically identical to Σc − Σp, so the daily *net* figure
survives a daily-totals rollup intact. What does **not** survive is everything that clamps per
interval. Phase 2's coverage maths is built on `max(U, 0)` per interval, and `[DEC-23]` settles the
negative part as a **separate sale line, never netted against purchase lines** — "uncovered and
surplus volumes occur at different times and therefore at different prices."

A worked case: a day of two intervals with consumption `[10, 0]` and production `[0, 5]`.
Per interval, `U = [10, −5]`, so Σ max(U,0) = **10** and the export volume is **5**. From daily totals
alone, Σc − Σp = 5, and max(5, 0) = **5**. The two disagree, and the second discards the export
entirely.

Therefore `daily_position` stores, per (metering point, delivery date, `customer_id`): total
consumption, total production, total net usage, **and separately** the accumulated offtake
Σ max(Uᵢ, 0) and the accumulated export Σ |min(Uᵢ, 0)|, plus `source_version_ids` for exact
invalidation. `interval_reading` remains the source of truth; `daily_position` is a rollup that must
not lose what Phase 2 will clamp.

### 4.2 Receipt order, not `CreatedDateTime`

The current version of a (metering point, delivery date, direction) is always **the last one
received**, never the newest by `CreatedDateTime`. Both receipt orders of the same pair therefore leave
the second-received version current. This is enforced by the `ux_idv_current` partial unique index and
is the single assertion §10 requires to be mutation-verified by swapping in `CreatedDateTime` order.

### 4.3 Row-level security

Per **S2-D1**. `interval_data_version`, `interval_reading`, `metering_point_day_state` and
`daily_position` each carry `customer_id NOT NULL`, resolved at apply time from the metering point's
validity interval covering the delivery date.

Two things make this non-optional rather than stylistic:

1. **Guard discovery.** `QueryFilterModelTests.cs:119` and `RowLevelSecurityTests.cs:608` both select
   entities by `property.Name.EndsWith("CustomerId", StringComparison.Ordinal)`. A table without such
   a property is not merely unguarded — it is *invisible to the guard*, which then reports full
   coverage. This is the same "reports coverage, provides none" failure the `ean_pool` widening was
   written to close.
2. **Default privileges.** Migration 2's `ALTER DEFAULT PRIVILEGES` grants full DML on every new
   `metering` table to `app_customer_role` **the instant `CreateTable` runs**. The `REVOKE`s are not
   tidiness; without them a customer role can write interval data.

Policy shape follows migration 2's existing two-policy form with `SELECT`-only grants for
`app_customer_role`. `inbound_message`, `quarantined_series` and `operational_alert` get
`app_employee_role` policies and `REVOKE ALL` from `app_customer_role`, with **positive** tests that
the customer role is refused.

The **Worker** connects as the database owner and is exempt from RLS by design: it writes across
tenants and serves no customer-facing route. §7's tenancy guarantees are read-path guarantees for the
customer API. A route-table test asserts the Worker host exposes no `/api/v1/**` route.

---

## 5. Sequencing

| # | Step | Depends on | Independently testable by |
| --: | --- | --- | --- |
| 1 | **Rails first.** CI in both repos with `needs:` gating deploy and the zero-skip assertion; the cross-repo `flock`; bounded image prune. Create the four projects, add to solution + `verify-solution-layout.sh`, arm `CallSiteFacts` fact 3. Register the Worker host and payload volume in the AppHost, re-publish, commit the compose file. **Spike `Hangfire.PostgreSql` on .NET 10 / Npgsql 10 for one day**; fallback is a Postgres claim-queue drained by a hosted `BackgroundService` on the existing `OutboundMailService` pattern | — | CI goes red on a deliberately broken test and the deploy job does not run; `-warnaserror` passes with 22 projects; `CommittedComposeFileTests` passes against the regenerated file |
| 2 | **Market calendar** — `ExpectedIntervalCount`, `IntervalStart` with the autumn duplicate-hour mapping, `IsDstDuplicate`, `AddWorkingDays` per **S2-D8** | — (parallel with 1) | Complete isolation: no database, no HTTP. Every DST transition across three years, and a hand-checked weekday table including a 10-working-day span that crosses Christmas and one that crosses King's Day, both asserted to finalise on the weekday count |
| 3 | **Land §11 rows 1–3** (they settle `interval_data_version`), then write **migration 9** — seven tables, brp and metering_point columns, the assignment history row, partition routine, RLS pairs, explicit REVOKEs, `ExternalSubjectId` drop. Entities, configurations, four query filters, and the guard literals they break | 1, and §11 rows 1–3 landed | `verify-migrator.sh` runs the real Migrator **twice** against a throwaway `postgres:17`; both coverage guards discover the four tables **and their pinned literals have been updated**; customer role refused on the three employee-only tables; every partition has RLS + both policies |
| 4 | **Pipeline skeleton with a null adapter that always rejects** — webhook route, per-BRP credential auth, adapter resolution by stored `brp_id` (**S2-D3**), 25 MB cap, correlation id, raw storage before parsing, 200 before processing, 24 h dedupe, enqueue | 3 | End to end with **arbitrary bytes**: `[F02-R03]`…`[F02-R07]` pass before a line of XML is parsed, and `status` is `RECEIVED` at the moment the 200 is written |
| 5 | **PVNed adapter** — SOAP unwrap, XXE-hardened reading, reconstructed-XSD validation, code decoding, `ResourceObject` interpretation, field mapping, Pos→instant, the eleven integration-spec `§8.2` codes | 2, 4 | The hand-transcribed golden document from integration-spec `§6`, plus hand-written negative fixtures — one per `§8.2` rule, plus XXE and billion-laughs. **None generated** |
| 6 | **Apply** — advisory lock, atomic whole-document application, versions, receipt-order supersession behind `ux_idv_current` (§4.2), superseded versions retained, four quarantine reasons | 5 | A pair of documents posted out of order; a document whose second series is short (nothing lands) |
| 7 | **Day state and rollup** — the four `production_expectation` cases, `daily_position` per §4.1, the FINAL job with the reopen edge, silence detection writing `operational_alert` | 6 | Including the case where an A01 series promotes a `NEVER` point in the same transaction, and the §4.1 worked case |
| 8 | **DevStubs** — templated builder, load-shape generator, the fourteen in-scope integration-spec `§11` scenarios, 90-day backfill, cadence pusher | 7 | The scenario suite drives steps 4–7 end to end with **no code path writing a reading directly** |
| 9 | **Customer read endpoints** — regenerate OpenAPI, accept Verify snapshots, populate `LastDataDate` and the 14-day series | 8 | Tenancy (404 not 403 cross-tenant), the trimmed payload shape, and the two integration tests that asserted `LastDataDate` was null now asserting a real date |
| 10 | **Employee data-health endpoints and replay** | 8 | An unknown-EAN document quarantines → the EAN is registered through the existing back office → the stored message is replayed from the log → the entry resolves into readings |
| 11a | **The chart components** — extend the design-token guard to `libs/shared-ui`, then `PpUsageChart` and `PpUsageMonthChart` against the frozen envelope shape | 8 (envelope shape agreed) | From fixture JSON, with no backend running |
| 11b | **The rest of the web** — typed-client regeneration, the `/consumption` route and rail row, navigation, the five data-state treatments, the KPI strip, the empty state, the connection-detail strip, the inverted `NO_DATA_YET` (spec inverted in the same commit), the dashboard copy, the employee health screens | 9, 10, 11a | Each assertion verified by mutation, per the repo's stated standard |
| 12 | **Prove it** — 100 EANs × 365 days into a throwaway database, day view against `[NFR-03]`, month view against `[NFR-04]`; deploy; run DevStubs against the deployed webhook; write the "what this does not prove" note; land the **remaining** §11 amendments | 11b | The compose stack comes up on the VM and, after DevStubs is run against the deployed webhook, a seeded customer signs in and sees a populated day chart |

**Parallelism.** Steps 1 and 2 run together. Step 11a needs only the agreed envelope shape, so it runs
beside steps 9 and 10. Everything else is serial.

---

## 6. Size

| Part | Days |
| --- | --: |
| Projects, AppHost, compose, CI plumbing | 7–9 |
| Market calendar (three years of DST + working-day tests) | 2–3 |
| Migration 9 (seven tables, partitioning, RLS, guard literals, assignment history) | 6–8 |
| BRP-agnostic pipeline (incl. correlation id) | 10–14 |
| PVNed adapter (reconstructed XSD, eleven semantic rules, `ResourceObject`) | 6–8 |
| Day state, rollup per §4.1, FINAL, silence detection, `operational_alert` | 6–8 |
| DevStubs and the fourteen in-scope scenarios | 5–7 |
| Customer read endpoints, OpenAPI snapshots | 5–6 |
| Employee data-health endpoints and replay | 3–4 |
| Web — day chart + navigation + `/consumption` route + five treatments + KPI strip + empty state | 8–11 |
| Web — month chart | 3–4 |
| Web — connection strip, dashboard copy, employee screens, client regeneration | 4–6 |
| Load test, deploy, demo seed, the note, spec amendments | 3–4 |
| **Total** | **68–92** |

**Elapsed time.** The §5 chain is almost entirely serial — only step 2 runs beside step 1, and only
step 11a beside steps 9–10 — so a second engineer removes of the order of ten days of wall clock, not
half. On that reading the slice is roughly **13–17 weeks elapsed** with two engineers. If it must land
sooner the lever is scope, not headcount.

Two reasons to think this is the right order of magnitude, neither of which is a person-day figure and
so neither of which settles the estimate: the roadmap sizes ingestion at half of a Phase 1 that is 31%
of the programme; and slice 1, smaller in surface, produced a comparable volume of production and test
code at a spec-to-production ratio near 1.5:1.

**What could push past the top:** the Hangfire spike failing (+3–5 d for the hand-rolled retry ladder
and three schedules), and the reconstructed XSD becoming a research exercise if the permissive-reading
rule is not held to.

**Cut order if the slice must shrink:** month chart (~3–4 d) → employee health *screens* but not the
endpoints (~4–6 d, at the cost of the "how would anyone know it works" story) → replay (~2 d off the
employee-endpoints line, at the cost of quarantine being a dead end) → partitioning (~3 d, at the cost
of retrofitting onto populated tables). **Do not cut** the port seam, receipt-order supersession, the
completeness test, DST, the §4.1 rollup shape, RLS on the new tables, or CI: each is either
unrecoverable if wrong or protects everything else.

---

## 7. Definition of done

1. **CI runs in both repositories and gates deploy**, proven by pushing a deliberately failing test and
   observing the deploy job does not run. The five `verify-*.sh` guards and all five test projects run
   there. **`AppHost.Tests` reports zero skipped**, and the solution-wide set of skipped test names
   equals a checked-in allow-list — verified by dropping the second checkout and watching the first
   assertion fail.
2. A generated PVNed `TimeSeriesDocument` posted to `POST /webhooks/brp/PVNED` with the BRP row's
   configured credential returns **200**, and at the moment that 200 is written the payload is durably
   stored with headers, source IP, receipt time, correlation id and `brp_id`, and `status` is
   `RECEIVED` — not `PROCESSED`.
3. Re-posting the byte-identical payload within 24 h records `DUPLICATE` and creates no second version.
   A document **over** 25 MB is refused with **413**; one of exactly 25 MB is accepted. A parser failure
   still returns 200 and lands the message `FAILED` with a machine-readable code and a human-readable
   message, **zero** interval rows written.
4. A document whose second timeseries is one point short applies **nothing at all** — asserted by row
   count, not by a status field. Completeness is judged per document against the period that document
   declares.
5. **Receipt order governs (§4.2).** A correction whose `CreatedDateTime` is *earlier* but which is
   received second still supersedes: the current version is always the last one *received*. Both
   receipt orders of the same pair leave the second-received version current, the superseded version
   remains queryable, and `ux_idv_current` holds exactly one current version per (metering point,
   delivery date, direction).
6. An unknown EAN quarantines as `UNKNOWN_EAN`; an EAN whose validity interval does not cover the
   delivery date quarantines as `EAN_VALIDITY`; an EAN assigned to a different BRP quarantines as
   `WRONG_BRP`, decided against the assignment in force at **receipt** time; a non-electricity product
   quarantines as `NOT_ELECTRICITY`. Registering the metering point and replaying the stored message
   resolves the entry into readings, and **replaying an already-processed message produces no second
   version** (`[F02-R27]`), asserted by version count.
7. A message whose BRP row is subsequently set inactive still replays through the adapter selected by
   the stored `brp_id` — asserted with a second adapter registered, to prove selection is not the
   default and that no field of the payload is consulted (**S2-D3**).
8. A metering point with `production_expectation = NEVER` and only an A02 series reaches **complete**;
   one recorded `EXPECTED` or `UNKNOWN` with only an A02 series stays `PARTIAL` and writes an
   `operational_alert` row. **A test exists that fails against a `directions.Count == 2`
   implementation, verified by writing that implementation and watching it go red.**
9. An A01 series arriving for a point recorded `NEVER` is stored and used normally, and the **same
   transaction** moves it to `production_expectation = EXPECTED` with source `OBSERVED` and stamps
   `first_production_observed_at`.
10. A spring **92**-point day and an autumn **100**-point day ingest, roll up and render, with the
    autumn duplicate hour labelled `02:00 A` / `02:00 B`. A 96-point document is rejected for both
    dates — short for the autumn date, over-length for the spring date — under the integration-spec
    `§8.2` point-count rule.
11. **The §4.1 worked case.** On a day where production exceeds consumption in some intervals but not
    overall, the stored offtake and export accumulators match the per-interval computation and **not**
    the value obtained from daily gross totals — asserted against a hand-computed fixture, and verified
    by mutation against a daily-totals implementation.
12. A day reaches `FINAL` after 10 working days with no newer version; a post-window reconciliation
    reopens it to `PROVISIONAL`, recomputes the rollup, and the chart shows a corrected-on marker.
    Nothing archives, compacts or caches on the strength of `FINAL`.
13. An A12 imbalance document is recognised, stored, closed with **zero** `interval_reading` rows, and
    lands in its terminal status.
14. Company A's `GET /api/v1/consumption/day` for company B's metering point returns **404, not 403**.
    As `app_customer_role`, a direct `SELECT` on `interval_reading` returns only that customer's rows,
    and a `SELECT` on `inbound_message`, `quarantined_series` or `operational_alert` raises
    `insufficient_privilege`. Every partition has RLS enabled and both policies.
15. The day envelope contains `netUsageKwh` per interval, contains no `blocks`, `blockKwh`,
    `netPositionKwh` or `dayAheadPriceEurMwh` key **at all**, and omits missing intervals entirely —
    asserted against the JSON, with a test that fails if a missing interval is serialised as 0 or null.
16. A customer signs in, clicks **Volume**, and sees a day chart whose three series are distinguishable
    by **stroke pattern as well as colour** (asserted in the component spec by rendering with colour
    removed) and which clear 3:1 contrast against the plot background in both themes, with an
    always-drawn zero line, gaps where intervals are missing, and hour ticks in Amsterdam local time —
    and can step to the previous day, pick a date, jump to the most recent day with data, click a month
    bar into its day, and switch between one, several and all connections.
17. The month chart marks missing days as **stubs**, not short bars.
18. The KPI strip shows the three volume totals each labelled with its range's data state; the empty
    state renders when the range holds no data; the partial, provisional and **declared-zero**
    treatments each render on a day that is each.
19. `LastDataDate` shows a real date on the connections list and detail; connection detail shows the
    14-day data-state series; `NO_DATA_YET` no longer appears where data exists; the spec that pinned
    its absence has been **inverted**; the dashboard no longer claims there is nothing to total.
20. An employee sees the inbound message log filtered by BRP, the quarantine list with reason and age,
    the per-connection 21-day heat map, and can replay a stored message.
21. A metering point that receives nothing for two of the BRP's `expected_cadence` windows appears as
    silent on the employee data-health screen; one that receives on cadence does not.
22. `CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter` runs and **passes, no longer skipped** —
    verified by adding a reference to a `PeakPower.Integration.Brp.*` assembly and watching it go red.
23. `verify-migrator.sh` passes with migration 9 in its ordered list, having run the real Migrator
    process **twice** for idempotence. `verify-solution-layout.sh` passes against 22 projects.
    `CommittedComposeFileTests` and `ImageBuildTests` pass against the regenerated compose file and the
    new Worker stage.
24. A 100-EAN × 365-day generated dataset loads, and the day view **responds to its first hover within
    1.5 s of navigation on a warmed cache (second load), measured in headless Chrome on the CI runner
    and asserted in a checked-in performance test** (`[NFR-03]`); the month view within 2 s
    (`[NFR-04]`).
25. **A written note in the platform repo lists what this slice does NOT prove** (§9). **`[R-01]` stays
    scored 20.**

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| **The generator and the parser share an author and a source document**, so a shared misreading of the PVNed format passes every test here and fails on day one of the real integration. This is the central evidence cost of demonstrating ingestion without the feed | Three deliberate breaks in the circle. (a) The generator emits templated XML **text** and never serialises the parser's model, so a shared type cannot hide a shared bug (**S2-D4**). (b) Every negative case — the eleven integration-spec `§8.2` rules, XXE, billion-laughs, the malformed envelope — is a **hand-written checked-in fixture**. (c) The golden positive document is transcribed by hand from integration-spec `§6`. The residual is stated rather than absorbed: `[R-01]` keeps its 20. The pipeline half — versioning, supersession, quarantine, completeness, day states, rollups, DST — **is** genuinely proven, because it is BRP-agnostic and does not depend on the format being right |
| **The reconstructed XSD encodes nine guesses.** Stricter than the real schema → it rejects real documents; looser → it proves nothing. `[OQ-65]` is parked with no chaser inside the team | Take the **permissive** reading on each of the nine integration-spec `§9` rows, one test per row naming the row and the reading. `SchemaProvenance` lists all nine. The file is named `...reconstructed.xsd` with a test asserting the filename says so — swapping in the real file becomes a diff review. **Book the `[OQ-65]` walkthrough now regardless**: a third party's calendar has lead time |
| `Hangfire.PostgreSql` may not hold on .NET 10 with Npgsql 10, and would be the repo's first scheduling dependency, with a dashboard whose exposure is `[OQ-57]` | Spike it on **day one of step 1**, before anything depends on it. Fallback: a Postgres claim-queue drained by a hosted `BackgroundService`, the pattern `OutboundMailService` already establishes here. Cost is hand-rolling the retry ladder (1m/5m/15m/1h/4h, five attempts, dead letter) and three schedules. Either way the dashboard stays off, so `[OQ-57]` does not block |
| **The four new interval tables key on `metering_point_id`, and both RLS coverage guards discover only by `EndsWith("CustomerId")`** — they would report full coverage while interval data sat unpoliced. Migration 2's default privileges also grant full DML to `app_customer_role` the moment `CreateTable` runs | **S2-D1**: denormalise rather than widen the predicate. `REVOKE INSERT/UPDATE/DELETE` explicitly and `REVOKE ALL` on the three employee-only tables, then add **positive** tests that the customer role is refused. The partition routine applies RLS + both policies, with a catalog test that none lacks them. ⚠ Remember the guards' **pinned literals** (§3.1) — the four filters alone leave the suite red |
| **The customer API connects as the database owner** and drops privilege only inside `CustomerSessionMiddleware`, which anonymous requests skip. A consumption endpoint that forgets `.RequireAuthorization()` runs as owner with **both** tenancy layers off — a bug that reached review once already on `CompanyEndpoints` (`GET /company/accounts` answered anonymous callers 200 with every company's people; commit `0a49a8d`) | The host's `FallbackPolicy` makes endpoints deny-by-default, so the failure is loud. Route-table tenancy tests plus anonymous allow-list tests pin the set in both directions. Add the routes with `.TenantScoped(resourceKind)` **in the same commit** as the endpoint, plus a 404-not-403 cross-tenant test per route |
| **This is the first migration that will run against a database already holding data** — the deploy workflow landed 2026-09-07, and migration 1 already seeds the `PVNED` BRP row, but nothing had been deployed then — on forward-only migrations whose `Down()` the deployed Migrator never invokes, against a database with no backup schedule | **S2-D7** records roll-forward-only explicitly. Acceptable **only** because the audience is the internal team and the data is regenerable by re-running DevStubs — §3.2 records the trigger that changes this. Also fix the runbook's directory disagreement (`$HOME/peakpower` in the workflow vs `/srv/peakpower` in `DEPLOYING.md` — 17 occurrences of the deployment directory itself) while there |
| The hand-rolled charts may be thrown away when the Phase-2 block overlay forces the library decision | Confine them to **two** `shared-ui` components sharing one data-in/SVG-out contract and no consumer knowledge of how they draw, so replacing them is two files plus their specs. Run the phase-0 spike **before** the Phase-2 overlay bar — that is when signed bands, a step overlay and touch actually stress a candidate. Record the deferral as a decision so `[OQ-22]` stays visibly open rather than looking answered by omission |
| **DST is the single most likely silent correctness bug** — a wrong Pos mapping writes plausible data to the wrong times, and nothing notices until an invoice does | Golden tests for all six DST transitions across three years, with the autumn Pos 9–12 / 13–16 duplicate mapping asserted specifically. Keep the mapping in `Infrastructure.Time` as the single source of truth for parser, rollup and chart alike. Assert a 96-point document is **rejected** for both a 92- and a 100-point date |
| **Scope.** `F02` has 47 requirements of which 43 are *Must*; `F03` has 27. A slice defined as "do F02 and F03" has no edge and will run over | §3.2 is a **deliverable, not a caveat** — each deferral names the requirement number and the reason. The cut order is in §6 |
| **None of the thirty-one demo EANs in `DemoDataSeeder`** — eleven attached to the six demo companies plus twenty unclaimed pool rows — **carries a valid GS1 check digit** (`[DEC-114]` relaxed validation to eighteen digits; the decision register's own "six" counts only `trading-poc`), and ingestion **keys on EAN** | Do not reinstate it in this slice, and say so. **The blast radius of `[OQ-97]` grows with every ingested row**, which makes finding it an owner more urgent than it was, not less |

---

## 9. What this slice does not prove

Reproduced here because §7.25 requires it to exist as a written artefact in the platform repo, and
because it is the honest counterweight to everything above.

- **PVNed conformance.** The XSD is reconstructed and encodes nine integration-spec `§9` guesses. The
  interval placement follows the integration spec's interim answer to `[OQ-20]`, not PVNed's
  confirmation.
- **The wire contract.** The real endpoint, authentication mechanism, acknowledgement form and retry
  policy on non-2xx are all `[OQ-05]`, unanswered.
- **Independence of generator and parser.** Both were written by the same team from the same
  reconstructed source. §8 lists three deliberate breaks in that circle; none makes the evidence
  equivalent to a real feed.
- **Alerting.** The conditions fire and land in `operational_alert`; no channel delivers them, and no
  deliberate outage test is run (§3.2).
- **`[R-01]` stays scored 20.** Nothing in this slice lowers it.

What **is** proven: the BRP-agnostic half — versioning, receipt-order supersession, quarantine,
completeness against production expectation, day states, the §4.1 per-interval rollup, DST handling,
tenancy and RLS. None of that depends on the PVNed format being right.

---

## 10. Testing

Follows the repo's established standard: **every assertion verified by mutation.** Break it first,
predict the failure, watch it go red, then fix it. A green test that was never seen red is not
evidence.

Four tests carry disproportionate weight and must each be mutation-verified explicitly:

1. **The completeness test** (§7.8) — verified by writing `directions.Count == 2` and watching it fail.
2. **Receipt-order supersession** (§7.5) — verified by swapping the comparison to `CreatedDateTime`
   order and watching the out-of-order pair test fail.
3. **The DST Pos mapping** (§7.10) — verified by replacing `IntervalStart` with a naive
   add-15-minutes loop and watching the autumn 100-point case fail.
4. **The §4.1 rollup shape** (§7.11) — verified by replacing per-interval accumulation with daily-total
   subtraction and watching the mixed-export day fail.

Negative fixtures for the adapter are **hand-written and checked in**, never generated (§8).

---

## 11. Proposed specification changes

Rows 1–3 must land **before step 3** — migration 9 is written against them.

| # | Document | Change |
| --: | --- | --- |
| 1 | `specs/00-overview/04-assumptions-and-decisions.md` | **New decision** resolving the `interval_data_version` source-column conflict per **S2-D2** |
| 2 | `specs/20-architecture/04-database-design.md` §3.2 | Correct the DDL to match **S2-D2** — the published form makes `[F02-R36]` unstorable |
| 3 | `specs/10-features/F02-metering-data-ingestion.md` §8 | Same correction, from the other side of the contradiction |
| 4 | `specs/70-delivery/01-roadmap-and-phasing.md` §3 | Amend for `[DEC-119]`: §3 still specifies OIDC against Entra, still schedules the claim-mapping spike as its own bar (`p1f`), and still lists exit criteria `[DEC-119]` made unreachable. Anyone planning from it **over-scopes** |
| 5 | `specs/70-delivery/01-roadmap-and-phasing.md` §11 | Same, for the open questions that bear on the plan |
| 6 | `specs/70-delivery/01-roadmap-and-phasing.md` §2.2 | **Correct all six slice-1 gaps: every one was closed in `peakpower-web` on 2026-09-03, within half an hour of §2.2 being committed** (roadmap `39fd8d8` 10:32; fixes `e476cf7` 10:22, `3a7726c` 10:26, `bf1edc5` 10:29, `e0d5670` 10:37, `192ec9c` 10:45, `5f13bea` 10:51). What actually remains is the section's own deliberate-scope line — "no CI, no package registry, no deployment" — of which this slice closes CI and deployment. Planning from §2.2 as-is re-does six finished pieces of work |
| 7 | `specs/70-delivery/02-risks.md`, `[OQ-65]`'s row, and the PVNed integration spec | Two files still call `[R-01]` "the highest-scoring risk"; it is **joint** highest with `[R-10]` since that rescore |
| 8 | `specs/10-features/F02-metering-data-ingestion.md` `[F02-R23]`, and a **new decision** in the register | **Define "the platform's working-day calendar."** `[F02-R23]` invokes it with the definite article and nothing defines it — `[OQ-02]`/`[DEC-19]`/`[DEC-14]` settle the **peak** calendar, which is a different object with the opposite treatment of holidays (a weekday holiday *is* a peak day). Record **S2-D8**: Monday–Friday, empty exclusion list, holidays ignored, reusing `[DEC-14]`'s data-driven mechanism; and note that `[DEC-98]` is what makes ignoring them safe, since a post-window correction now reopens the date rather than being locked out |

---

## 12. Open items needing an answer

Four items are owned by the reader (confirmed 2026-09-07). **One is answered**; one gates a step.

| # | Item | Gates | Needed by |
| --- | --- | --- | --- |
| 1 | ✅ **ANSWERED 2026-09-07 — the working-day calendar.** Monday–Friday, holidays ignored, per **S2-D8**. The reader's answer was given against `[OQ-02]` (peak blocks), which is itself already closed by `[DEC-19]` and needs no change; it is applied here to `[F02-R23]`'s separate and previously **undefined** "platform's working-day calendar" | *was* step 2 | — |
| 2 | **A recorded decision on `interval_data_version.source`** per **S2-D2** (§11 rows 1–3) | Step 3 | **Before migration 9 is written** |
| 3 | **`[OQ-102]`** — the RLS login-role credentials are literals inside migration 2, so `EMPLOYEE_DATABASE_PASSWORD` cannot be rotated. Its own precondition, "before anything is deployed anywhere", was crossed when the deploy workflows landed. This slice adds **six** more tables under those roles | Does not block the build; blocks calling the deployment real, and blocks any secret store | Before the box is shown to anyone outside the team |
| 4 | **`[OQ-97]`** — when the GS1 EAN check digit is reinstated and which weighting is normative. Not one of the **thirty-one** demo EANs would pass, and **ingestion keys on EAN**, so the population invalidated by reinstatement grows with every document | Nothing in this slice | Sooner than it was, for the reason above |

**Three confirmations wanted, none blocking:**

- That **F02 §4**'s "the correction path must be live from day one" means day one of **invoicing**, not
  day one of ingestion. That reading is what lets `[F02-R46]` and `[F02-R20]` be deferred honestly, and
  it is an inference, not the spec's words.
- That deferring `[OQ-22]` past this slice is acceptable (**S2-D5**). If a commercial library is wanted
  instead, budget the procurement tail: a licence read for redistribution and per-developer terms, a
  key the build agent reads from a secret store, and a renewal date with an owner (`[R-16]`).
- Whether **break-glass survives `[DEC-119]`** at all. It is currently the fallback for a provider that
  no longer exists; its rehearsal is a stated Phase-1 exit criterion; and `[DEC-104]`'s single operator
  with no rota cannot run a rehearsal `[DEC-53]` requires two named people for. **No `[OQ]` number
  carries this question.**

**Three external items with lead time, none blocking the build.** `[OQ-20]` and `[OQ-65]` are 🟠 and
parked with PVNed as owner; `[OQ-05]` is ⏸ *closed for the PoC only* `[DEC-21]` and unanswered for the
real integration. Roadmap §2.1 puts all three on PVNed with the chaser column reading **Unnamed**, so
**none has a chaser named inside the team**. `[OQ-65]` in particular should be booked now: `[DEC-21]`
means the interim answers get baked into the generator that then validates the whole phase, and
`[DEC-69]` makes this adapter the template every later one copies.

---

## 13. Prerequisites for whoever picks this up

Read, in this order, before writing any code:

1. `docs/superpowers/specs/2026-08-26-poc-slice-1-design.md` — the predecessor, and the source of every
   convention this slice inherits.
2. `specs/10-features/F02-metering-data-ingestion.md` and `F03-consumption-visualisation.md` in full.
3. `specs/50-calculations/02-position-and-coverage.md` §2.1 and §4 — the net-usage and clamping rules
   that §4.1 rests on.
4. `specs/30-integrations/` — the PVNed integration. **All section numbers in this item are the
   integration spec's own**: `§6` (the reconstructed sample step 5 transcribes from), `§7.1` (field
   mapping), `§8.2` (the eleven semantic rules), `§8.3` (the completeness check and the
   `directions.Count == 2` prohibition), `§9` (the nine inconsistencies), `§11` (the sixteen scenarios).
5. **`trading-poc/consumption-calc.js` and `consumption-calc.test.js`**, and the SVG chart drawing
   functions in `trading-poc/customer-portal.html`. This is a working prior implementation of the
   net-usage maths and the day/month views, with a CSV oracle — including a documented fix for an
   interval START-vs-END off-by-one that shifted the whole peak window 15 minutes late. **This
   document's §6** explains why it matters to the estimate.
6. `peakpower-platform/CLAUDE.md` — the house rules, including mutation verification.
