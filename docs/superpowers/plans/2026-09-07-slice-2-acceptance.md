# PoC Slice 2 — acceptance against the definition of done

**Walked:** 2026-09-08 · **Branch:** `slice-2-ingestion-and-charts` in both build repositories ·
**Against:** the slice design's §7, twenty-five items.

This is the record design §7 is graded on. Each of the twenty-five is listed with the evidence that
it holds — a named test where an earlier plan proved it, a command and its output where this plan
had to check it fresh. **Four of the twenty-five are not met and say so.** A false green here would
be worse than a recorded gap: the gap is a thing somebody can pick up, and the false green is a
thing nobody looks at again.

---

## The suites behind everything below

Run on this machine, on the branch, immediately before this record was written.

| | Result |
| --- | --- |
| `dotnet build PeakPower.sln --nologo -warnaserror` | **Build succeeded**, 22 projects, zero warnings |
| `dotnet test PeakPower.sln` | **2 114 passed, 0 failed, 0 skipped** — Domain 234, Architecture 21, Application 584, AppHost 139, Integration 1 136 |
| `npm test` (peakpower-web) | **1 483 passed, 0 failed, 0 skipped** — 93 test files across shared-ui, customer-portal and employee-portal, plus the workspace guards |
| `npm run perf` (peakpower-web) | **5 passed** — see item 24 |
| `tools/verify-build-settings.sh` | OK |
| `tools/verify-solution-layout.sh` | OK, **22 projects** |
| `tools/verify-aspire-api.sh` | OK |
| `tools/verify-migrator.sh` | OK — the real Migrator process run **twice** for idempotence |
| `tools/verify-no-unexpected-skips.sh` | **OK** — the run's skipped set is empty and `tests/skipped-tests.allowlist.txt` contains no names, matched in **both** directions |
| `tools/verify-close-out.sh` | OK — both checks |
| `tools/verify-repositories.sh` | **FAILS, environmentally.** See "What this slice did not meet" |

⚠ **The machine.** `Darwin 27.0.0 arm64, 12 cpu, 24 576 MB`. Every latency figure in item 24 was
measured here and **not** on the CI runner design §7.24 names.

⚠ **One Testcontainers flake was seen and retried, not absorbed.** A first run of
`verify-no-unexpected-skips.sh` — started while the full solution suite and the web suite were still
running — failed one test, `RealmIsolationTests.InitializeAsync()`, on container start-up. Re-run on
a quiet machine it passed 1 136/1 136. Recorded because a retry that is not written down is
indistinguishable from a result.

---

## The four assertions design §10 requires be mutation-verified

None of the four belongs to this plan. This is the confirmation that each was carried out, not an
assumption that it was.

| # | Assertion | The mutation | What went red | Status |
| --: | --- | --- | --- | --- |
| 1 | Completeness (§7.8) | `directions.Count == 2` written as the completeness test | `DayCompletenessTests.A_never_point_with_only_a_consumption_series_is_complete` | ✅ **done**, plan 5 |
| 2 | Receipt-order supersession (§7.5) | the supersession comparison swapped to `CreatedDateTime` order | `SupersessionTests.an_EARLIER_created_document_RECEIVED_SECOND_still_becomes_current` | ✅ **done**, plan 3 |
| 3 | The DST `Pos` mapping (§7.10) | `IntervalStart` replaced with a naive add-15-minutes loop | `IntervalStartTests`, the autumn 100-point case | ✅ **done**, plan 1 |
| 4 | The §4.1 rollup shape (§7.11) | per-interval accumulation replaced with daily-total subtraction | `DailyPositionCalculatorTests.The_worked_case_from_design_4_1` | ✅ **done**, plan 5 |

**This plan's own three, verified here:**

| Assertion | The mutation | What went red |
| --- | --- | --- |
| The deploy-path agreement | one `/srv/peakpower` put back on `DEPLOYING.md:178`; then `DEPLOY_DIR` moved to `/opt/peakpower` in the platform repository only | `FAIL: DEPLOYING.md still names /srv on 1 line(s)`; then `FAIL: the two deploy workflows disagree about the deployment directory: peakpower-platform says '/opt/peakpower', peakpower-web says '$HOME/peakpower'` — **two** failures, and the cross-repository one is the one no single repository's tests can see |
| The performance measurement is a measurement | the day tooltip class broken to `.pp-usage-chart__tooltipp`; then the month chart given the day chart's protocol | `pp-usage-chart never answered a mousemove on svg in 30000 ms`; then `pp-usage-month-chart never answered a mousemove on svg in 30000 ms` — **never a time**, in either case |
| The honesty note is honest | the `[R-01]` score removed from **both** the heading and the body; then the whole of §4 deleted | ``FAIL: the note does not say `[R-01]` stays scored 20``; then `FAIL: the note does not say that alerting fires its conditions and delivers nothing` |

Two more this plan added, because it found the defects they pin:

| Assertion | The mutation | What went red |
| --- | --- | --- |
| Every load-test document id fits the schema | the 40-character readable form put back | `tooLong should be empty but had 51100 items` |
| The load test's 60/40 split | `i >= ConsumptionOnlyEans` changed to `i >= Eans` | `should be 51100 but was 36500` — which is 100 × 365 exactly, the dataset the mutation describes |

---

## The twenty-five

### ⚠ 1. CI runs in both repositories and gates deploy — **NOT PROVEN**

The workflow is right and has never run. `.github/workflows/ci.yml` builds with `-warnaserror`,
runs all six guards (`verify-close-out.sh` joined them in this plan) and every test project, and
`deploy.yml` calls it with `needs: test` — which is the only shape in which a failing test actually
stops a deployment. **But this branch is never pushed**, so no run exists, and design §7.1's proof —
*push a deliberately failing test and observe the deploy job does not run* — **was not performed**.

What **is** proven, locally: `tools/verify-no-unexpected-skips.sh` reports **OK** with an empty
skipped set against an allowlist that contains no names, matched in both directions. `AppHost.Tests`
reports **139 passed, 0 skipped**. The second half of §7.1 — *"verified by dropping the second
checkout and watching the first assertion fail"* — is the guard's own design and its allowlist file
documents the 29 gates that depend on that checkout.

### ⚠ 2. The receipt envelope at the moment of the 200 — **NO AUTOMATED ASSERTIONS**

A generated document posted to `POST /webhooks/brp/PVNED` with the configured credential returns
**200**: proven many times over, by `ScenarioEndToEndTests` and by this plan's own load runs — 51 100
documents, every one 200, 0 refused.

**The envelope is not asserted anywhere.** That at the moment the 200 is written the payload is
durably stored *with headers, source IP, receipt time, correlation id and `brp_id`*, and that
`status` is `RECEIVED` and **not** `PROCESSED`, has **zero automated assertions**. There is no
`WebhookReceiptTests` class in the repository; a `grep` for one finds nothing.

It was verified **by hand** against a live stack in an earlier wave: the RECEIVED-before-PROCESSED
window was caught mid-flight by polling `metering.inbound_message` while documents were in the
queue. That is a real observation and it is not a test. **`WebhookReceiptTests` is on the backfill
worklist.**

### ✅ 3. Duplicates, the 25 MB boundary, and a parser failure

- `ScenarioEndToEndTests.Posting_the_same_scenario_twice_records_a_duplicate_and_no_second_version`
- `ScenarioEndToEndTests.Every_invalid_document_lands_failed_with_its_own_code_and_no_readings` — 200
  returned, `FAILED` recorded with a code, zero interval rows.
- The size boundary: the DevStubs scenario catalogue carries a deliberate 26 MB document, and this
  plan's earlier live run observed it answered **413** while all 42 others answered 200.

### ✅ 4. A short second timeseries applies nothing at all

`DayCompletenessTests`, and end to end by
`ScenarioEndToEndTests.The_same_document_shape_stays_partial_for_a_connection_that_should_produce`.
Asserted by **row count**, and completeness is judged per document against the period that document
declares.

### ✅ 5. Receipt order governs (§4.2)

`SupersessionTests` (mutation-verified, §10 row 2), plus
`ScenarioEndToEndTests.Receipt_order_governs_and_not_created_date_time` and
`ScenarioEndToEndTests.A_correction_supersedes_and_the_superseded_version_stays_queryable`.
`ux_idv_current` is asserted by `DailyPositionPersistenceTests` and by the load run, where **51 100
documents produced exactly 51 100 current versions**.

### ✅ 6. The four quarantine reasons, and replay

`SeriesResolutionTests` — `an_EAN_no_metering_point_has_ever_carried_is_UNKNOWN_EAN`,
`an_EAN_that_exists_but_not_on_that_DATE_is_EAN_VALIDITY`,
`a_document_from_a_BRP_the_point_is_not_on_is_WRONG_BRP`, and
`the_assignment_IN_FORCE_AT_RECEIPT_TIME_decides_and_not_the_current_one` — which is the clause that
makes `[F02-R43]` mean what it says. Replay resolving a quarantine into readings:
`DataHealthReplayTests.Registering_the_connection_and_replaying_resolves_the_quarantine_into_readings`.

### ⚠ 7. An inactive BRP row still replays through the stored `brp_id`'s adapter — **NOT ASSERTED**

`FakeBrpIngestionAdapter` exists and is used by `SupersessionTests`; `ReplayCompositionFacts` pins
which hosts compose an adapter at all. **What design §7.7 actually asks for is not there**: no test
sets a BRP row inactive, and none registers a **second** adapter to prove that selection follows the
stored `brp_id` rather than falling through to the only registered default. Both halves of the
sentence — the inactive row, and the second adapter — are unasserted. **On the backfill worklist.**

### ✅ 8. Completeness against the recorded production expectation

`DayCompletenessTests` (mutation-verified, §10 row 1), and end to end by
`ScenarioEndToEndTests.A_declared_zero_connection_reaches_complete_on_consumption_alone` and
`...The_same_document_shape_stays_partial_for_a_connection_that_should_produce`. The alert row:
`OperationalAlertRaiserTests`.

### ✅ 9. Observed production promotes in the same transaction

`ProductionPromotionTests`. The database refuses the halfway state outright —
`ck_mp_never_has_no_observed_production` makes a `NEVER` row with a
`first_production_observed_at` unstorable, which is how the same-transaction requirement is enforced
rather than merely tested.

### ✅ 10. The 92- and 100-point days

`IntervalStartTests` (mutation-verified, §10 row 3), `ExpectedIntervalCountTests`,
`IsDstDuplicateTests`, `PvnedDstTests`, and end to end by
`ScenarioEndToEndTests.A_dst_day_lands_the_point_count_its_date_requires`. The `02:00 A` / `02:00 B`
labelling is asserted in `pp-usage-chart.spec.ts`. Independently exercised again by this plan's load
run, whose 365-day window **contains both transitions** — 2025-10-26 (100) and 2026-03-29 (92) — and
whose reading count lands on **4 905 600**, exactly 51 100 × 96, because the extra four intervals of
the autumn day and the missing four of the spring day cancel across 140 documents each.

### ✅ 11. The §4.1 worked case

`DailyPositionCalculatorTests.The_worked_case_from_design_4_1` (mutation-verified, §10 row 4), and
end to end by `ScenarioEndToEndTests.A_day_with_export_stores_offtake_and_export_separately`.

### ✅ 12. `FINAL`, and a post-window reconciliation

`DayFinalisationJobTests`, and end to end by
`ScenarioEndToEndTests.A_post_window_reconciliation_reopens_a_finalised_date`. The working-day
calendar the rule depends on was **undefined in the specification** until this plan recorded
**[DEC-144]** — Monday to Friday in Europe/Amsterdam, exclusion list empty. Nothing archives,
compacts or caches on `FINAL`.

### ⚠ 13. The A12 imbalance document — **PARSER PROVEN, PIPELINE NOT**

`PvnedDocumentTypeTests` against the checked-in `golden-a12-imbalance.xml` proves the document is
recognised as A12 and distinguished from A23, and `invalid-wrong-receiver-a12.xml` covers its
negative. **What is not asserted end to end** is the rest of design §7.13: that it is *stored,
closed with zero `interval_reading` rows, and lands in its terminal status*. No integration test
posts an A12 over the webhook and counts the rows it did not write. **On the backfill worklist.**

### ✅ 14. Tenancy and row-level security

`ConsumptionDayTests` for the **404-not-403** cross-company read; `RowLevelSecurityTests` for the
`app_customer_role` behaviour — only that customer's `interval_reading` rows, and
`insufficient_privilege` on `inbound_message`, `quarantined_series` and `operational_alert`;
`TenancyArchitectureTests` and `RouteTableTenancyTests` for the route-level rules. Every partition's
policies are asserted by `verify-migrator.sh`, which runs against a real PostgreSQL 17 — the only
thing that can prove a predicate rather than a predicate's existence.

### ✅ 15. The frozen day envelope

`ConsumptionDayTests` asserts against the JSON, including that `blocks`, `blockKwh`,
`netPositionKwh` and `dayAheadPriceEurMwh` appear **nowhere**, and that a missing interval is omitted
entirely rather than serialised as `0` or `null`. `ContractPurityTests` pins the same absence at the
contract-assembly level. Independently re-confirmed by this plan's perf run, whose fifth test reads
the envelope the measured page actually received and requires 96 intervals and a data state that is
not `NO_DATA`.

### ✅ 16. The day chart

`pp-usage-chart.spec.ts` (35 tests) asserts the three series are distinguishable by **stroke pattern
with colour removed**, the always-drawn zero line, gaps where intervals are missing, Amsterdam-local
hour ticks and the DST `02:00 A` / `02:00 B` labels. Navigation — previous day, date picker, jump to
latest, month-bar drill-in, and one/several/all connections — is in `consumption-page.spec.ts` (24),
`day-picker.spec.ts`, `consumption-calendar.spec.ts` and `metering-point-selector.spec.ts`.

### ✅ 17. The month chart marks missing days as stubs

`pp-usage-month-chart.spec.ts` (18 tests).

### ✅ 18. The KPI strip and the four states

`consumption-page.spec.ts` and `consumption-copy.spec.ts` — three totals each labelled with its
range's data state, and the empty, partial, provisional and declared-zero treatments. Confirmed
against the live stack during this plan's diagnosis: a mixed selection rendered
*"No data · nothing has arrived for this range yet"* and a covered one rendered
*"1.096,7 MWh — Provisional · measured, and your BRP may still correct it"*.

### ✅ 19. `LastDataDate`, the 14-day series, and the inverted spec

`ConnectionListTests`, `ConnectionDetailTests` and `RecentDataStatesTests` on the platform side;
`RecentDataStatesTests` covers the 14-day data-state series. The spec that pinned `NO_DATA_YET`'s
presence was inverted by plan 6.

### ✅ 20. The employee data-health screens

Platform: `DataHealthMessageTests`, `DataHealthQuarantineTests`, `DataHealthReplayTests`.
Web: `message-log-page.spec.ts`, `quarantine-page.spec.ts`, `connection-health-page.spec.ts`,
`data-feeds-labels.spec.ts`.

### ✅ 21. Silence detection

`SilenceDetectionJobTests` — a point that misses two of the BRP's `expected_cadence` windows appears
silent, one that receives on cadence does not.

### ✅ 22. `CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter` runs and passes

`PeakPower.Architecture.Tests.csproj:25` now carries the `PeakPower.Ingestion` reference that arms
it. `PeakPower.Architecture.Tests` reports **21 passed, 0 skipped**, and
`verify-no-unexpected-skips.sh` — which compares the run's skipped set against an allowlist
containing no names, in both directions — reports OK. The fact is armed and green.

### ✅ 23. The guards, the compose file and the Worker stage

`verify-migrator.sh`: **OK**, with migration 9 in its ordered list and the real Migrator process run
twice. `verify-solution-layout.sh`: **OK against 22 projects** — counted directly from
`PeakPower.sln`, which lists 22 distinct `.csproj` files. ⚠ *An earlier briefing said 23; 22 is
correct.* `CommittedComposeFileTests` and `ImageBuildTests` are inside the green
`PeakPower.AppHost.Tests` run (139 passed, 0 skipped), against the regenerated compose file and the
Worker stage — and independently exercised by this plan, which built all four images from that file
twice and ran the stack.

### ⚠ 24. `[NFR-03]` and `[NFR-04]` — **MEASURED, BUT NOT ON THE CI RUNNER**

**The dataset is real and it was built the way `[F02-R30]` requires.**
`tools/load-test-dataset.sh` on a throwaway Compose project:

```
window                    365 day(s) ending 2026-09-06
connections               100 inserted here (60 NEVER, 40 EXPECTED); 106 selectable for this customer
inbound_message rows      51100
current versions          51100
interval_reading rows     4905600
daily_position rows       36500
metering_point_day_state  36500
posting                   206s
draining                  0s
database size             920 MB
runner                    Darwin 27.0.0 arm64, 12 cpu · 24576 MB
```

Every one of those 51 100 documents went over `POST /webhooks/brp/PVNED`; **0 refused, 0 `FAILED`,
0 quarantined**. Only the hundred `customer.metering_point` rows and their assignment history went
in by SQL, which is master data and not readings.

**The figures**, `npm run perf`, five tests passed:

```
targets    NFR-03 day 1500 ms warm / 3000 ms cold · NFR-04 month 2000 ms warm

day, one connection                cold     93 ms   warm median     65 ms   [65, 82, 65, 65, 66]
day, 50 connections                cold    103 ms   warm median     82 ms   [80, 82, 82, 82, 82]
month, one connection              cold    108 ms   warm median     66 ms   [65, 66, 66, 66, 66]
month, 50 connections              cold    110 ms   warm median     82 ms   [65, 82, 82, 82, 65]
dataset check                      96 intervals, dataState PROVISIONAL, 50 connections aggregated
```

**Comfortably inside both targets — and the caveats matter more than the numbers.**

1. **Not the runner.** Design §7.24 says *"on the CI runner"*, and this is a 12-core arm64 laptop
   talking to itself over loopback. `.github/workflows/load-test.yml` exists and does exactly this on
   `ubuntu-latest`, on dispatch and weekly, uploading the report as an artefact — **and it has never
   run**, because this branch is never pushed. **The figures above are an anecdote until that
   workflow does.** They were worth taking anyway: they are what found the three defects below.
2. **"Every connection" means fifty, not 106.** `ConsumptionEndpoints` refuses a larger selection
   with a 400 and *"Chart at most 50 connections at once."* Fifty is the ceiling a customer can
   actually reach, so fifty is where the requirement is measured.
3. **The cold sample is genuinely cold, and had to be made so.** The obvious harness — sign in on a
   page, then measure six navigations on it — makes "cold" a warm load with the wrong label; it read
   237 ms, *under* the 1 500 ms warm budget, which is an assertion that cannot fail. The harness now
   signs in in a throwaway context, keeps the refresh cookie, and opens a second context with an
   empty HTTP cache. Verified by measurement, not by argument: **the cold navigation transfers
   526 330 bytes and each warm one 60 852**, over an identical 11 requests.

### ✅ 25. The written note, and `[R-01]`

`peakpower-platform/docs/what-slice-2-does-not-prove.md`, reproducing design §9 in full and
expanding each bullet. `tools/verify-close-out.sh` check 2 pins all five claims with seven `grep -F`
literals — seven for five, because two bullets carry two claims each — and was mutation-verified
twice. `CLAUDE.md`'s layout block points at it.

`[R-01]` **stays scored 20**, and is now correctly recorded as **joint** highest with `[R-10]` in all
three specification files that called it "the highest-scoring risk". Its section in
`specs/70-delivery/02-risks.md` records that it was re-examined after this slice and **held**.

---

## What this slice did **not** meet, stated rather than absorbed

| # | Item | Why it is not met | What closes it |
| --: | --- | --- | --- |
| 1 | CI gates deploy | The branch is never pushed; no CI run exists. The workflow is correct and untested | Push the branch, then push a deliberately failing test and watch the deploy job not run |
| 2 | The receipt envelope | **Zero automated assertions** on `RECEIVED`, stored `HttpHeaders`, `RemoteIp`, receipt time, correlation id or `brp_id` at the moment of the 200. Verified by hand against a live stack, which is an observation and not a test | `WebhookReceiptTests` — on the backfill worklist |
| 7 | Inactive-BRP replay | No test sets a BRP row inactive, and none registers a **second** adapter to prove selection follows the stored `brp_id` rather than the only default | One integration test with two adapters registered — on the backfill worklist |
| 13 | The A12 imbalance document | Recognised and distinguished at the parser (`PvnedDocumentTypeTests`, `golden-a12-imbalance.xml`); **not** asserted end to end as stored, closed with zero readings, in its terminal status | One integration test posting A12 over the webhook — on the backfill worklist |
| 24 | `[NFR-03]` / `[NFR-04]` | Measured, inside both targets, **on a laptop and not on the CI runner** design §7.24 names | Dispatch `load-test.yml` once the branch is pushed, and replace the figures above with the runner's |

**And one guard that fails for a reason outside this slice:** `tools/verify-repositories.sh` reports

```
FAIL: …/peakpower-platform origin is 'git@github.com-work:peakpower-nl/peakpower-platform.git',
      expected peakpower-nl/peakpower-platform
```

The remote **is** `peakpower-nl/peakpower-platform`; the guard does not accept an SSH host alias
(`github.com-work`) in front of it. The file is **byte-identical to `main`** — confirmed with
`git diff --quiet main -- tools/verify-repositories.sh` — so this is a pre-existing property of this
machine's SSH configuration and not a regression. It passes on CI, where the remote is written
without an alias.

---

## Tests this slice's plan 8 deliberately skipped, for the backfill

Named so the backfill has a worklist rather than an archaeology exercise.

| Class | What it would assert |
| --- | --- |
| `WebhookReceiptTests` | Item 2's whole envelope, at the moment the 200 is written |
| `LoadTestCommandTests` | The `loadtest` verb's I/O half: the gate refusal, an absent `EanFile`, an unset `LastDeliveryDate` |
| *(unnamed)* | Item 7's inactive BRP with a second adapter registered |
| *(unnamed)* | Item 13's A12 document end to end |

---

## Open questions this slice leaves, and what each now costs

| | |
| --- | --- |
| `[OQ-65]` | The nine reconstructed-XSD guesses, unwalked. **Cost rises with every ingested row**, and under `[DEC-69]` a wrong reading is copied into every later BRP adapter rather than merely used. Parked, owner PVNed, **no chaser named inside the team** |
| `[OQ-20]` | Interval placement. If it comes back the other way, **every reading ingested under this slice is on the wrong day** |
| `[OQ-05]` | Endpoint, auth, acknowledgement, retry. Closed *for the proof of concept only*, under `[DEC-21]`. Not closed for the real integration |
| `[OQ-102]` | The RLS login-role passwords are literals inside migration 2, and this slice put six more tables under those roles |
| `[OQ-97]` | The GS1 check digit — none of the demo EANs would pass, ingestion keys on EAN, and **the hundred load-test EANs are now in the same boat** |
| **New** | **How MFA is enforced now that `[DEC-119]` removed the Conditional Access that was going to enforce it.** Opened by that decision, closed by nothing, and **not yet registered as an open question**. Recorded in roadmap §3 and §11 by this plan; it should get a number |

---

## The slice is accepted when

- the branch is pushed and `ci.yml` runs green in both repositories, and a deliberately failing test
  is shown not to reach the deploy job (item 1);
- `load-test.yml` is dispatched once and its `perf-report.txt` replaces item 24's laptop figures;
- the Compose stack is brought up on the VM by the rewritten `DEPLOYING.md`, DevStubs is driven at
  the **deployed** webhook from a developer machine, and a seeded customer signs in and sees a
  populated day chart — **none of which this plan could do**, because `DEPLOY_HOST` and `DEPLOY_USER`
  are GitHub secrets and no VM was reachable from here. Design §5 step 12's *"the compose stack comes
  up on the VM"* is therefore **outstanding**, and the throwaway-stack run above is the closest thing
  to it: the same four images, from the same committed compose file, brought up twice and driven end
  to end — on a laptop, not on the box;
- the four backfill classes above exist and are green.

Everything else in design §7 holds today, on the evidence named beside it.
