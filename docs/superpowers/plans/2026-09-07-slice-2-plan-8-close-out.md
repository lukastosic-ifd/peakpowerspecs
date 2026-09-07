# Close-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the slice rather than assert it — load a 100-EAN × 365-day dataset through the real
webhook into a throwaway database and measure the day view against `[NFR-03]` and the month view
against `[NFR-04]` in headless Chrome on the CI runner; bring the Compose stack up on the VM, drive
DevStubs at the **deployed** webhook from a developer machine, and watch a seeded customer sign in
and see a populated day chart; settle the runbook's `$HOME/peakpower` versus `/srv/peakpower`
disagreement; write the "what this slice does not prove" note into the platform repository; land the
remaining specification amendments; and walk design §7's twenty-five definition-of-done items one by
one, recording the evidence for each.

**Architecture:** Nothing here is a new product capability. Four things are built and the rest is
measurement. A `loadtest` verb on `PeakPower.DevStubs` posts a year of generated PVNed documents for
a hundred connections over the **real** webhook, because `[F02-R30]` forbids any code path that
writes readings directly and a load fixture written with `COPY` would prove the read path against
rows the pipeline never produced. A throwaway Compose stack on its own project name and its own
ports carries that dataset, so the box's real stack is untouched and the dataset dies with a
`docker compose down --volumes`. A second Playwright configuration — `playwright.perf.config.ts`,
with no `webServer` and no dev server anywhere near it — drives the **built** portal the customer API
serves, and reads its timings from the page's own `performance.now()`, which is milliseconds since
that navigation started. And one guard, `tools/verify-close-out.sh`, holds the two pieces of prose
this slice is graded on — the deployment directory and the honesty note — to the code they describe.

**Tech Stack:** .NET SDK 10.0.400 · C# `latest` · net10.0 · EF Core 10.0.11 · Npgsql 10.0.3 ·
PostgreSQL 17 · .NET Aspire 13.5.3 (`aspire.cli` global tool + `Aspire.AppHost.Sdk`) ·
xUnit v3 3.2.2 · Shouldly 4.3.0 · NSubstitute 6.2.0 · Testcontainers.PostgreSql 4.14.0 ·
`Microsoft.Extensions.Http` 10.0.11 · Node 24.15.0 / npm 11.12.1 · Angular 22.1.3 runtime,
22.1.6 tooling · TypeScript 6.0.3 · Vitest 4.1.11 · **Playwright 1.56.1** · Docker 29.7.2 ·
GitHub Actions on `ubuntu-latest`

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

**This plan adds no package to either repository.** `@playwright/test` 1.56.1 is already a dev
dependency (`peakpower-web/package.json:36`) and the perf run uses it.

### Repositories

```
/Users/thinhhuynh/PeakPower/peakpower-platform      # .NET
/Users/thinhhuynh/PeakPower/peakpower-web           # Angular — siblings, and the AppHost relies on it
/Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9
                                                    # the specification repository, this worktree
```

Both build repositories are published privately under **`peakpower-nl`**.
`tools/verify-repositories.sh` fails if `origin` is missing or points elsewhere, and it treats a
**detached HEAD** as a defect.

### Naming

- .NET namespace root `PeakPower.` — e.g. `PeakPower.DevStubs`
- npm scope `@peakpower-nl/`
- Database: snake_case, singular, schema-qualified — `metering.interval_reading`
- C#: PascalCase; EF Core maps to snake_case by convention, never per-property attributes

### The deployment directory — settled by this plan, task 1

⚠ **`$HOME/peakpower` wins. `DEPLOYING.md`'s `/srv/peakpower` is the side that changes.**

Two files state the deployment directory and they disagree. `.github/workflows/deploy.yml:44` in
both repositories says `DEPLOY_DIR="$HOME/peakpower"`; `DEPLOYING.md` says `/srv/peakpower` in
**17** places — verified by `grep -o '/srv/peakpower[a-zA-Z0-9-]*' DEPLOYING.md | sort | uniq -c`,
which reports `17 /srv/peakpower`, `3 /srv/peakpower-backups` and `1 /srv/peakpower-web`. The naive
grep for `/srv/peakpower` reports **19 lines** and would sweep the other four occurrences up with
them; `/srv/peakpower-backups` is the backup destination and `/srv/peakpower-web` appears once
inside a narrative about a path that never existed.

The workflow wins for three reasons, in order of weight:

1. **It is the only executable statement of the path.** `DEPLOYING.md` is read by a person; the
   workflow is run by a machine on every push to `main`. Prose that disagrees with a running script
   is wrong by construction, and the fix that leaves the machine alone is the fix that cannot break
   a deploy.
2. **Plan 1 has already written `$HOME` into both repositories a third time.** Its task 4 rewrites
   `deploy.yml` in both with `DEPLOY_DIR="$HOME/peakpower"` and takes the cross-repository lock on
   `LOCK="$HOME/.peakpower-deploy.lock"`. Moving the tree to `/srv` would leave the lock under
   `$HOME` and the tree elsewhere — two paths where the document is trying to establish one.
3. **`/srv/peakpower` needs `sudo` and a `chown` to a user the workflow never names.** `DEPLOYING.md`
   opens with `sudo mkdir -p /srv/peakpower && sudo chown "$USER" /srv/peakpower`, where `$USER` is
   whoever is logged in when the runbook is followed and `DEPLOY_USER` is whoever the workflow SSHes
   as. Those are the same person by convention and not by construction. `$HOME` is `DEPLOY_USER`'s
   home by definition, so the ownership question disappears rather than being answered.

`DEPLOYING.md`'s own sentence "Nothing else about `/srv/peakpower` is special — put the pair
wherever you like" is what makes this a free change: the constraint the document actually carries is
that the two checkouts are **siblings named `peakpower-platform` and `peakpower-web`**, because the
Dockerfile copies from both by name. That constraint is preserved exactly.

`tools/verify-close-out.sh` pins the agreement afterwards, so the two files cannot drift apart
again silently.

### The load-test dataset — what it is, and why it goes over the wire

100 EANs × 365 days, the figure design §5 step 12 and §7.24 both name. Composed as:

| | |
| --- | --- |
| Metering points | **100**, attached to the seeded demo company **Vandersteen Koeling B.V.** |
| EANs | `871687109900000001` … `871687109900000100`, eighteen digits, a range no seeded row uses |
| Production expectation | **60 `NEVER`** (consumption only) and **40 `EXPECTED`** (both directions) |
| Days | **365**, ending the day before yesterday in Europe/Amsterdam |
| Documents posted | 60 × 365 + 40 × 365 × 2 = **51 100** |
| `interval_reading` rows | ≈ **4.9 M** (51 100 × 96, less the two DST days' difference) |

⚠ **Every one of those 51 100 documents goes over `POST /webhooks/brp/PVNED`.** `[F02-R30]` is not
advisory: *"No code path may bypass **F02-R01..R13** to write readings directly."* A load fixture
written with `COPY` would measure the read path against rows the pipeline never produced, and the
first time the two disagreed the measurement would be the thing that hid it. Contract §13 restates
the same rule for DevStubs.

⚠ **The hundred metering points are inserted with SQL, and that is not a bypass.** `[F02-R30]`
forbids writing **readings** directly. A metering point is master data — it is what
`DemoDataSeeder` writes, what the back office edits, and what the customer claims from the pool. The
load-test script inserts `customer.metering_point` rows and their
`customer.metering_point_brp_assignment` history rows, and **nothing else**; every kWh arrives
through the webhook.

⚠ **The dataset is not committed anywhere.** ≈4.9 M interval rows is a `pg_dump` of a few hundred
megabytes. It is rebuilt by `tools/load-test-dataset.sh` on the runner or on a developer machine,
and destroyed by `docker compose down --volumes` at the end of the run.

### `[NFR-03]` and `[NFR-04]` — read them off the register, not off memory

Verified today against `specs/20-architecture/08-non-functional-requirements.md:26-27`:

| ID | Requirement | Target | How verified (the register's own column) |
| --- | --- | --- | --- |
| **NFR-03** | Consumption **day** view interactive within | **1.5 s warm, 3 s cold** | Synthetic + RUM |
| **NFR-04** | Consumption **month** view interactive within | **2 s** | Synthetic |

⚠ **NFR-03 is the day view and NFR-04 is the month view.** An earlier draft of the design attributed
both to NFR-03. Design §7.24 has it right — *"the day view … (`[NFR-03]`); the month view within 2 s
(`[NFR-04]`)"* — and so does design §5 step 12. NFR-04 states **no cold figure**, so nothing in this
plan asserts one for the month view.

### The three words in `[NFR-03]` that have to mean something measurable

Design §7.24 requires *"responds to its first hover within 1.5 s of navigation on a warmed cache
(second load), measured in headless Chrome on the CI runner and asserted in a checked-in performance
test"*. Each phrase is pinned here and implemented in task 5.

| Phrase | What it means in the checked-in test |
| --- | --- |
| **of navigation** | `performance.now()` read **inside the page**. It counts milliseconds from `performance.timeOrigin`, which the browser sets at the start of the navigation that created that document. No Playwright-side clock is involved, so no process-boundary skew is either. |
| **responds to its first hover** | The page dispatches a real `mousemove` at the centre of `pp-usage-chart svg` every animation frame from the moment that element has a non-zero width, and the measurement is `performance.now()` at the frame on which `.pp-usage-chart__tooltip` first exists in the DOM. "First hover" is therefore the first hover that gets an answer — the earliest moment a customer moving the mouse onto the chart would have seen a number. |
| **on a warmed cache (second load)** | The context is created once, signed in once, and the same URL is loaded **six** times. Load 1 is the cold figure. Loads 2–6 are the warm figures, and the assertion is on their **median**, with min and max recorded. One warm sample on a shared CI runner is a coin toss; five and a median is not. |
| **the runner** | GitHub-hosted `ubuntu-latest`. The whole system — PostgreSQL 17, the migrator, the customer API and the Worker, all under `docker compose` — runs on that **same** runner as the browser, so the figure includes the database, the API, the network hop and the render, and includes no wide-area latency. The runner's `nproc`, `free -m` and kernel are printed into the run log and copied into the acceptance record, because a latency number without the machine it was measured on is not a measurement. |
| **headless Chrome** | Playwright 1.56.1's bundled Chromium, `devices['Desktop Chrome']`, headless, viewport 1440 × 900 — the same browser and viewport the existing `e2e` run uses. |
| **interactive** (month view) | The same protocol against `pp-usage-month-chart svg` and `.pp-usage-month-chart__tooltip`. A month chart whose bars are drawn but which cannot answer a hover is not interactive. |

⚠ **A performance test that measures nothing passes fastest of all.** If the tooltip selector is
wrong, or the day has no data and the empty state replaced the chart, the honest failure is a
timeout naming the selector — never a small number. Task 5 step 6 mutates exactly that: it breaks
the selector and requires the run to fail on the locator, not to report a time.

### Testing

| Layer | Tooling |
| --- | --- |
| Domain / Application unit | xUnit v3 + **Shouldly 4.3.0** + NSubstitute — **never FluentAssertions** `[DEC-118]` |
| Persistence & integration | Testcontainers, real PostgreSQL 17 |
| Architecture | NetArchTest (facts 1–2), **Mono.Cecil** IL scanning (facts 3–6) |
| Shell guards | `tools/verify-*.sh`, exit 0 or a `FAIL:` line on stderr |
| Frontend unit | Vitest 4.1.11 + jsdom |
| End-to-end and **performance** | Playwright 1.56.1, in `peakpower-web` |

Syntax is `actual.ShouldBe(expected)` and `await Should.ThrowAsync<T>(act)`. ⚠ **Shouldly's
`ShouldContain` is case-insensitive by default** and has silently broken three tests in this
repository; compare with `StringComparison.Ordinal` / `Case.Sensitive` and assert on structured
fields, never by searching a response body for a substring.

**Mutation verification is this repository's stated standard.** Break it first, predict the failure,
watch it go red, **check the failure is the one you predicted**, then fix it. A green test that was
never seen red is not evidence. A mutation that breaks the *build* proves nothing about an
assertion — if removing a member orphans a `using`, remove that too.

⚠ **Mutate the case your assertion is actually for, not the easy neighbouring one.** `CLAUDE.md`
records a guard that was mutation-verified against "the property does not exist" but never against
"the property exists under a different casing", and so certified a half-working guard.

### The four mutation verifications this plan does not own, and must confirm have been done

Design §10 names four assertions that must each be mutation-verified explicitly. **None of the four
belongs to this plan** — they belong to plans 1, 3 and 5 — but task 11 is the acceptance gate, so it
confirms each was carried out rather than assuming it.

| # | Assertion | Owner | The mutation | What must go red |
| --: | --- | --- | --- | --- |
| 1 | Completeness (design §7.8) | plan 5 | Write `directions.Count == 2` as the completeness test | `DayCompletenessTests.A_never_point_with_only_a_consumption_series_is_complete` |
| 2 | Receipt-order supersession (design §7.5) | plan 3 | Swap the supersession comparison to `CreatedDateTime` order | `SupersessionTests.an_EARLIER_created_document_RECEIVED_SECOND_still_becomes_current` |
| 3 | The DST Pos mapping (design §7.10) | plan 1 | Replace `IntervalStart` with a naive add-15-minutes loop | `IntervalStartTests`, the autumn 100-point case |
| 4 | The §4.1 rollup shape (design §7.11) | plan 5 | Replace per-interval accumulation with daily-total subtraction | `DailyPositionCalculatorTests.The_worked_case_from_design_4_1` |

### The three mutation verifications this plan owns outright

| Assertion | The mutation | What must go red |
| --- | --- | --- |
| **The deploy-path agreement** (task 1) | Put `/srv/peakpower` back on one line of `DEPLOYING.md` | `tools/verify-close-out.sh` fails with `FAIL: DEPLOYING.md still names /srv/peakpower on 1 line(s)` and prints the line |
| **The performance measurement is a measurement** (task 5) | Change the tooltip selector to `.pp-usage-chart__tooltipp` | The perf spec fails with `the day chart never answered a hover in 30000 ms` — **not** with a time |
| **The honesty note is honest** (task 9) | Delete the `[R-01]` line from `docs/what-slice-2-does-not-prove.md` | `tools/verify-close-out.sh` fails with `FAIL: the note does not say [R-01] stays scored 20` |

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
tools/verify-no-unexpected-skips.sh          # plan 1
tools/verify-close-out.sh                    # new, this plan
tools/load-test-dataset.sh                   # new, this plan
aspire publish -o ./deploy

# web, from /Users/thinhhuynh/PeakPower/peakpower-web
npm ci
npm test
npm run e2e
npm run perf                                 # new, this plan

# specs, from the worktree root
node specs/site/build.mjs
```

⚠ **Integration tests use Testcontainers.** Running several suites in parallel across worktrees can
exhaust connections and produce mass Postgres timeouts — retry before reporting a regression.

⚠ **`cp -a` preserves mtimes and leaves MSBuild with stale binaries**; use plain `cp` or `touch`.

### Roll forward only — S2-D7

The deployed `DatabaseMigrator` calls only `MigrateAsync`, so `Down()` is never invoked in the
shipped path. Nothing in this plan relies on it. The load-test stack is destroyed rather than
migrated backwards, which is the same policy expressed as a `docker compose down --volumes`.

### Copy rules

Slice 1's rules, unchanged: sentence case everywhere; ALL CAPS only for stat-card labels and table
column heads; **no emoji, no icon set**; every number carries its provenance in a faint sublabel;
empty and disabled states name the reason; nl-NL numbers (`385,4 MWh`) with minus as **U+2212 `−`**
via `PP_MINUS`. This plan writes prose rather than screens, and the same register applies to it: the
honesty note and the acceptance record are read by people who will be asked to trust them.

---

## Scope boundary for this plan

This is **plan 8 of 8**. It covers design-document **step 12**, the last row of design §5. It builds:

- `tools/verify-close-out.sh` and the rewritten `DEPLOYING.md`;
- a third `DevStubsGate` subject and the `loadtest` verb on `PeakPower.DevStubs`;
- `deploy/docker-compose.loadtest.yaml` and `tools/load-test-dataset.sh`;
- `playwright.perf.config.ts`, `perf/consumption-performance.spec.ts` and the `perf` npm script in
  `peakpower-web`;
- `.github/workflows/load-test.yml` in `peakpower-platform`;
- the deployment run on the VM, the DevStubs run against the **deployed** webhook, and the seeded
  customer's day chart;
- `docs/what-slice-2-does-not-prove.md` in `peakpower-platform`;
- design §11 rows **4–8** and the **ninth** amendment contract §16 adds, as one pull request against
  the specification repository;
- `docs/superpowers/plans/2026-09-07-slice-2-acceptance.md` — design §7's twenty-five items with the
  evidence for each.

It deliberately does **not** build: any migration SQL or entity (plan 2 is the only plan that writes
either), any pipeline, adapter, rollup, endpoint or Angular component, and **design §11 rows 1–3** —
those are the recorded decision that settles `interval_data_version.source`, they land **before**
migration 9, and plan 2 task 1 owns them. `[DEC-143]` is plan 2's; this plan's new decision is
`[DEC-144]`.

### Two places where this plan resolves an ambiguity in the shared contract

1. **The `loadtest` verb and its gate subject are added here, to `PeakPower.DevStubs`.** Contract §17
   gives plan 5 "**all of `PeakPower.DevStubs`**" and gives plan 8 "the 100-EAN × 365-day load test".
   Those two rows meet on one file. The load test cannot exist without a way to post 51 100
   documents, `[F02-R30]` forbids any other way of getting the readings in, and plan 5's `backfill`
   is fixed at ninety days across the eleven seeded connections — so the verb has to exist and plan 5
   is not the plan that needs it. This plan therefore adds `DevStubsSubject.LoadTest`,
   `DevStubsGate.LoadTestKey`, `DevStubsGate.LoadTestConfirmation` and `LoadTestCommand`, and
   **changes no other member of `DevStubsGate`** — the two subjects contract §13.2 pins keep their
   keys and their phrases character for character. ⚠ **Plan 5 must not also add a third subject.**
   Plan 1 set this precedent for exactly this shape of collision when it took `IIngestionJobQueue`'s
   declaration from plan 3.
2. **One line of `.github/workflows/ci.yml` is plan 1's file.** `tools/verify-close-out.sh` is a
   guard and a guard that is not in CI is a guard that runs when somebody remembers. Task 1 adds one
   `- run:` step to the platform repository's `ci.yml`, in the same block as the other six guards,
   and changes nothing else in that file. It is called out here because plan 1 owns both workflows.

### Domain terms used in this plan

Assume no knowledge of Dutch energy trading. The words that appear below mean:

- **BRP (Balance Responsible Party)** — the market participant answerable to the Dutch grid operator
  for a connection's imbalance. PVNed is the only one that exists here.
- **EAN** — the eighteen-digit code identifying one electricity connection point in the Dutch grid.
- **Interval / Pos** — Dutch metering is quarter-hourly. An ordinary day has 96 intervals; `Pos` is
  the 1-based position of one of them inside the document that carries the day.
- **Delivery date** — the metering day a reading belongs to, in Europe/Amsterdam. Not a UTC day.
- **DST** — the European summer-time transitions, on the last Sunday of March (a 23-hour day, 92
  intervals) and the last Sunday of October (a 25-hour day, 100 intervals).
- **Net usage** — consumption minus production, **per interval per metering point** `[DEC-22]`. It
  may be negative, and that negative part is an export.
- **Offtake / export** — Σ max(cᵢ − pᵢ, 0) and Σ |min(cᵢ − pᵢ, 0)|, accumulated per interval. Design
  §4.1 is the argument for why the daily totals cannot reconstruct them.

---

## File Structure

### `/Users/thinhhuynh/PeakPower/peakpower-platform`

| File | Responsibility |
| --- | --- |
| `DEPLOYING.md` | **modified** — every `/srv/peakpower*` path becomes `$HOME/peakpower*`; 21 occurrences on 19 lines |
| `tools/verify-close-out.sh` | **new** — the deployment directory agrees across the runbook and both workflows, and the honesty note says the five things design §9 requires |
| `.github/workflows/ci.yml` | **modified, one line** — `tools/verify-close-out.sh` joins the guard block (plan 1's file; see the ambiguity note above) |
| `.github/workflows/load-test.yml` | **new** — `workflow_dispatch` + weekly cron; builds the dataset and runs the perf spec on one runner |
| `src/Hosts/PeakPower.DevStubs/DevStubsGate.cs` | **modified** — a third subject, `LoadTest`, with its own key and phrase |
| `src/Hosts/PeakPower.DevStubs/LoadTestCommand.cs` | **new** — 100 EANs × 365 days over the real webhook, with progress and a summary |
| `src/Hosts/PeakPower.DevStubs/DevStubsOptions.cs` | **modified** — `LoadTest` options: the EAN file, the day count, the end date and the concurrency |
| `src/Hosts/PeakPower.DevStubs/Program.cs` | **modified** — the `loadtest` verb joins `scenarios`, `backfill` and `cadence` |
| `src/Hosts/PeakPower.DevStubs/README.md` | **modified** — how to run `loadtest`, and against what |
| `deploy/docker-compose.loadtest.yaml` | **new** — a hand-written **override**, never generated: different published ports so the throwaway stack cannot collide with the real one |
| `docs/what-slice-2-does-not-prove.md` | **new** — design §7.25's required artefact, in full |
| `tools/load-test-dataset.sh` | **new** — stands the throwaway stack up, inserts the hundred connections, runs `loadtest`, waits for the queue to drain, prints the figures the perf run needs |
| `tests/PeakPower.Application.Tests/DevStubs/DevStubsGateTests.cs` | **modified** — the third subject's decision matrix and the phrase-disjointness assertion, now over five phrases |
| `tests/PeakPower.Application.Tests/DevStubs/LoadTestPlanTests.cs` | **new** — the document plan: 51 100 documents, the 60/40 split, the DST day lengths, no duplicate (EAN, date, direction) |

### `/Users/thinhhuynh/PeakPower/peakpower-web`

| File | Responsibility |
| --- | --- |
| `playwright.perf.config.ts` | **new** — `testDir: './perf'`, **no `webServer`**, `baseURL` from the environment |
| `perf/consumption-performance.spec.ts` | **new** — the checked-in performance test design §7.24 requires |
| `perf/fixtures/measure.ts` | **new** — `signIn`, `measureFirstHover`, `median`, and the environment reader that refuses to guess |
| `perf/tsconfig.json` | **new** — the same shape as `e2e/tsconfig.json` |
| `package.json` | **modified** — one script, `perf` |

### The specification repository (this worktree)

| File | Responsibility |
| --- | --- |
| `specs/70-delivery/01-roadmap-and-phasing.md` | **modified** — §3 and §11 for `[DEC-119]` (design §11 rows 4–5), §2.2 for the six closed gaps (row 6), and the `[R-01]` phrase at `:249` (row 7) |
| `specs/70-delivery/02-risks.md` | **modified** — `[R-01]`'s section and its register row record that it is **joint** highest with `[R-10]` and that this slice does not lower it (row 7) |
| `specs/80-open-questions.md` | **modified** — `[OQ-65]`'s row at `:182` (row 7) |
| `specs/30-integrations/01-pvned-timeseries.md` | **modified** — the `[R-01]` sentence at `:71-72` (row 7) |
| `specs/10-features/F02-metering-data-ingestion.md` | **modified** — `[F02-R23]` gains the working-day calendar's definition (row 8) |
| `specs/00-overview/04-assumptions-and-decisions.md` | **modified** — `[DEC-144]`, the working-day calendar (row 8) |
| `specs/site/content.js` | **regenerated** — `node specs/site/build.mjs`; the bundle is generated and says so on its first line |
| `docs/superpowers/specs/2026-09-07-poc-slice-2-design.md` | **modified** — §11 gains a ninth row, for contract §16 items 1, 2 and 9 |
| `docs/superpowers/plans/2026-09-07-slice-2-acceptance.md` | **new** — design §7's twenty-five items, each with its evidence |

---

## Prerequisites — do this before Task 1

**Every other plan has landed.** This plan measures and accepts; there is nothing here that can run
against a half-built slice. Confirm it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln
tools/verify-no-unexpected-skips.sh
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm ci && npm test && npm run verify:clients
```

Expected: everything green, and `verify-no-unexpected-skips: OK`.

Then the tools:

```bash
dotnet --version                              # must print 10.0.400
node --version                                # must print v24.15.0
npm --version                                 # must print 11.12.1
docker info > /dev/null && echo docker-ok     # the daemon must be running
docker compose version                        # v2; `docker-compose` v1 does not read `name:`
gh auth status                                # the GitHub CLI, for tasks 6, 7 and 10
ssh "$DEPLOY_USER@$DEPLOY_HOST" true && echo ssh-ok   # for tasks 7 and 8
npx playwright install chromium               # in peakpower-web
```

⚠ **The VM's `DEPLOY_HOST`, `DEPLOY_USER` and the SSH key are GitHub secrets, not values in this
plan.** Tasks 7 and 8 run against the box the reader already has access to; if you cannot SSH to it,
stop here rather than inventing a host.

⚠ **`tools/load-test-dataset.sh` builds four images from source and posts fifty-one thousand
documents.** Budget **60–90 minutes** on a four-core machine and roughly **8 GB** of free disk for
the throwaway volume. Do not run it on the deployment VM.

---

### Task 1: The runbook's deployment directory, and the guard that keeps the two files agreeing

Design §8's fifth risk row ends with an instruction: *"Also fix the runbook's directory disagreement
(`$HOME/peakpower` in the workflow vs `/srv/peakpower` in `DEPLOYING.md` — 17 occurrences of the
deployment directory itself) while there."* The Global Constraints section above settles which side
wins and why. This task carries it out, and leaves behind a guard so the two files cannot drift
apart again in silence — which is the failure mode that produced the disagreement in the first
place.

⚠ **The count is 17, and a naive `grep` says 19.** `grep -n '/srv/peakpower' DEPLOYING.md` reports
**19 lines**, because two of them are about `/srv/peakpower-backups` and one is about
`/srv/peakpower-web`, which are different paths. The occurrence counts are:

```
$ grep -o '/srv/peakpower[a-zA-Z0-9-]*' DEPLOYING.md | sort | uniq -c
  17 /srv/peakpower
   3 /srv/peakpower-backups
   1 /srv/peakpower-web
```

All 21 change, and the reason the other four go too is that they are the same decision: a box whose
deployment tree lives under `$HOME` has no reason to keep a backup directory under `/srv`, and the
one `/srv/peakpower-web` is inside a worked example of a `cd ../../peakpower-web` that resolved one
level too high — an example that is still exactly true, and still worth keeping, with the root
renamed. Afterwards `grep -c '/srv' DEPLOYING.md` is **0**, which is the invariant the guard pins.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-close-out.sh`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/DEPLOYING.md` (19 lines, 21 occurrences)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/.github/workflows/ci.yml` (one `- run:` step)
- Test: the script is the test; steps 2, 4 and 5 are its three runs

**Interfaces:**
- Consumes: `.github/workflows/deploy.yml` in **both** repositories (plan 1 task 4 rewrote both, and
  both carry `DEPLOY_DIR="$HOME/peakpower"`), and `DEPLOYING.md`. Honours `PEAKPOWER_WEB_PATH`,
  defaulting to `../peakpower-web` relative to the platform checkout.
- Produces: `tools/verify-close-out.sh`, exit 0 on success and non-zero with one `FAIL:` line per
  failed check on stderr.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-close-out.sh`:

```bash
#!/usr/bin/env bash
# Holds the two pieces of PROSE this slice is graded on to the code they describe.
#
# CHECK 1 - THE DEPLOYMENT DIRECTORY. Two files state where the deployment tree lives on the VM.
# .github/workflows/deploy.yml (in BOTH repositories) sets DEPLOY_DIR, and DEPLOYING.md tells a
# person to clone into a directory. They disagreed: the workflow said "$HOME/peakpower" and the
# runbook said /srv/peakpower in seventeen places. The workflow wins - it is the only one of the
# two that a machine executes, and plan 1 also takes the cross-repository flock on
# $HOME/.peakpower-deploy.lock, so moving the tree to /srv would leave the lock and the tree in
# different places. Nothing detected the disagreement because nothing was looking; this is the
# thing that looks.
#
# CHECK 2 is added by plan 8 task 9 and covers docs/what-slice-2-does-not-prove.md.
#
# NOT A GREP FOR A STRING. The check extracts the literal the workflows actually set, requires the
# two workflows to agree with each other, and then requires the runbook to name THAT literal - so
# the day somebody deliberately moves the tree, the guard follows the move instead of blocking it.
# What it refuses is DISAGREEMENT, which is the defect, rather than any particular path.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root" || exit 1
failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }

web="${PEAKPOWER_WEB_PATH:-$root/../peakpower-web}"

# ── check 1: the deployment directory ───────────────────────────────────────────────────────────

platform_deploy="$root/.github/workflows/deploy.yml"
web_deploy="$web/.github/workflows/deploy.yml"
runbook="$root/DEPLOYING.md"

for f in "$platform_deploy" "$runbook"; do
  [[ -f "$f" ]] || { echo "FAIL: $f is missing" >&2; exit 1; }
done

# The sibling checkout is REQUIRED, not optional. A guard that silently skips half of itself when a
# directory is absent is the exact failure tools/verify-no-unexpected-skips.sh exists to refuse, and
# the CI job checks peakpower-web out beside this repository anyway.
if [[ ! -f "$web_deploy" ]]; then
  echo "FAIL: $web_deploy is missing. Set PEAKPOWER_WEB_PATH, or check peakpower-web out beside" >&2
  echo "      this repository - both repositories deploy to the same VM and this check compares" >&2
  echo "      their two workflows against each other." >&2
  exit 1
fi

# One DEPLOY_DIR assignment per workflow, and the value with its quotes stripped. Two matches means
# somebody added a second definition, which is the same defect in a smaller box.
deploy_dir_of() {
  grep -oE 'DEPLOY_DIR="[^"]+"' "$1" | sed -E 's/^DEPLOY_DIR="(.*)"$/\1/'
}

platform_dir="$(deploy_dir_of "$platform_deploy")"
web_dir="$(deploy_dir_of "$web_deploy")"

if [[ "$(printf '%s\n' "$platform_dir" | grep -c .)" != "1" ]]; then
  fail "$platform_deploy sets DEPLOY_DIR $(printf '%s\n' "$platform_dir" | grep -c .) time(s);" \
       "exactly one assignment is expected"
  platform_dir=""
fi
if [[ "$(printf '%s\n' "$web_dir" | grep -c .)" != "1" ]]; then
  fail "$web_deploy sets DEPLOY_DIR $(printf '%s\n' "$web_dir" | grep -c .) time(s);" \
       "exactly one assignment is expected"
  web_dir=""
fi

if [[ -n "$platform_dir" && -n "$web_dir" && "$platform_dir" != "$web_dir" ]]; then
  fail "the two deploy workflows disagree about the deployment directory:" \
       "peakpower-platform says '$platform_dir', peakpower-web says '$web_dir'." \
       "Both SSH to the same VM and pull the same two checkouts, so one of them is deploying" \
       "into a tree the other never touches."
fi

if [[ -n "$platform_dir" ]]; then
  if ! grep -qF -- "$platform_dir" "$runbook"; then
    fail "DEPLOYING.md never names '$platform_dir', which is the directory both deploy workflows" \
         "actually use. A runbook that sends a person to a different directory than the workflow" \
         "uses produces a deployment nobody can find and a git pull that updates nothing."
  fi
fi

# The old path, gone entirely. This is the counted half, and it is pinned at ZERO rather than at a
# ceiling: /srv/peakpower, /srv/peakpower-backups and /srv/peakpower-web were three different paths
# on a box that now has none of them, and one surviving mention is enough to send a reader to a
# directory that does not exist.
srv_lines="$(grep -c '/srv' "$runbook" || true)"
if [[ "$srv_lines" != "0" ]]; then
  fail "DEPLOYING.md still names /srv on $srv_lines line(s):"
  grep -n '/srv' "$runbook" | sed 's/^/    /' >&2
fi

if [[ $failures -gt 0 ]]; then
  echo "verify-close-out: $failures check(s) failed" >&2
  exit 1
fi
echo "verify-close-out: OK"
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
chmod +x /Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-close-out.sh
cd /Users/thinhhuynh/PeakPower/peakpower-platform
tools/verify-close-out.sh
```

Expected: **FAIL**, with

```
FAIL: DEPLOYING.md never names '$HOME/peakpower', which is the directory both deploy workflows actually use. A runbook that sends a person to a different directory than the workflow uses produces a deployment nobody can find and a git pull that updates nothing.
FAIL: DEPLOYING.md still names /srv on 19 line(s):
    177:sudo mkdir -p /srv/peakpower && sudo chown "$USER" /srv/peakpower
    178:cd /srv/peakpower
    196:/srv/peakpower/
    205:`/srv/peakpower` is special — put the pair wherever you like.
    212:cd /srv/peakpower/peakpower-platform/deploy
    335:> cd /srv/peakpower/peakpower-platform/deploy
    492:failed to read /srv/peakpower/peakpower-platform/deploy/.env: line 9: unexpected character "@" in
    804:cd /srv/peakpower/peakpower-platform/deploy
    1131:All of these run from `/srv/peakpower/peakpower-platform/deploy`.
    1218:cd /srv/peakpower/peakpower-platform/deploy
    1225:git -C /srv/peakpower/peakpower-platform pull \
    1226:  && git -C /srv/peakpower/peakpower-web pull \
    1227:  && cd /srv/peakpower/peakpower-platform/deploy \
    1244:The version of this block that shipped before opened with `cd /srv/peakpower/peakpower-platform`
    1245:and then `cd ../../peakpower-web`, which from that directory resolves to `/srv/peakpower-web` —
    1249:$ cd /srv/peakpower/peakpower-platform && git pull
    1408:sudo mkdir -p /srv/peakpower-backups && sudo chown "$USER" /srv/peakpower-backups
    1409:cd /srv/peakpower/peakpower-platform/deploy
    1412:  > "/srv/peakpower-backups/peakpower-$(date +%Y%m%d-%H%M%S).dump"
verify-close-out: 2 check(s) failed
```

Nineteen lines, twenty-one occurrences. That listing is the work order for step 3.

⚠ If the run instead exits immediately with `FAIL: …/peakpower-web/.github/workflows/deploy.yml is
missing`, `peakpower-web` is not beside your checkout. Fix that before continuing; every remaining
task in this plan needs it.

⚠ If it fails with `sets DEPLOY_DIR 0 time(s)`, plan 1 task 4 has not landed in one of the two
repositories. Land it first — this plan is the last of eight and runs on top of all seven.

- [ ] **Step 3: Rewrite the twenty-one paths**

`sed` does the mechanical part; three lines need prose changes that `sed` cannot make.

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
sed -i '' 's#/srv/peakpower#$HOME/peakpower#g' DEPLOYING.md
grep -c '/srv' DEPLOYING.md          # must print 0
grep -c '\$HOME/peakpower' DEPLOYING.md
```

Expected: `0`, then `19`.

⚠ **`sed -i ''` is the BSD form and this is macOS.** On a Linux runner it is `sed -i` with no
argument; do not paste the macOS form into `load-test.yml` or any other workflow.

⚠ **The order of the pattern matters and `-backups` survives it.** `s#/srv/peakpower#$HOME/peakpower#g`
rewrites the prefix and leaves whatever follows, so `/srv/peakpower-backups` becomes
`$HOME/peakpower-backups` and `/srv/peakpower-web` becomes `$HOME/peakpower-web`, both correctly.

Now three prose repairs the substitution leaves half-done.

**Line 177** now reads `sudo mkdir -p $HOME/peakpower && sudo chown "$USER" $HOME/peakpower`. Neither
half is needed any more — `$HOME` already belongs to the user — and `sudo mkdir` under `$HOME` would
create a root-owned directory the deploy user then cannot write to, which is a worse bug than the
one being fixed. Replace lines 177–178 with:

```bash
mkdir -p "$HOME/peakpower"
cd "$HOME/peakpower"
```

**Line 205** now reads ``Nothing else about `$HOME/peakpower` is special — put the pair wherever you
like.`` That sentence is still true and now slightly misleading, because the deploy workflow does
care. Replace it with:

```markdown
`$HOME/peakpower` is special — put the pair wherever you like, **but if you move them, move
`DEPLOY_DIR` in `.github/workflows/deploy.yml` in BOTH repositories to match**. That variable is
what the deploy job `cd`s into, `tools/verify-close-out.sh` fails if the two stop agreeing, and
`$HOME` is chosen precisely so the directory belongs to `DEPLOY_USER` by definition rather than by a
`chown` somebody has to remember.
```

⚠ The original sentence opened with "Nothing else about" — the substitution does not touch those two
words, so read the whole line before replacing it rather than pattern-matching on the tail.

**Line 1244–1245** is the narrative about a path that resolved one level too high. It now reads
`` `$HOME/peakpower-web` `` and is still exactly right: from `$HOME/peakpower/peakpower-platform`,
`cd ../../peakpower-web` resolves to `$HOME/peakpower-web`, which is one level too high and does not
exist. Nothing to change — **read it and confirm**, because a substitution that happens to leave a
sentence true is not the same as a sentence that was checked.

- [ ] **Step 4: Run it and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && tools/verify-close-out.sh`
Expected: PASS — the last line is `verify-close-out: OK`

- [ ] **Step 5: Verify the guard by mutation — put one `/srv` back**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
sed -i '' '178s#\$HOME/peakpower#/srv/peakpower#' DEPLOYING.md
tools/verify-close-out.sh
```

Expected: **FAIL**, with

```
FAIL: DEPLOYING.md still names /srv on 1 line(s):
    178:cd /srv/peakpower
verify-close-out: 1 check(s) failed
```

⚠ **That is only half the guard.** Mutate the other half too — the agreement, not the absence — by
moving the workflow instead of the runbook:

```bash
sed -i '' 's#DEPLOY_DIR="\$HOME/peakpower"#DEPLOY_DIR="/opt/peakpower"#' .github/workflows/deploy.yml
git checkout -- DEPLOYING.md
tools/verify-close-out.sh
```

Expected: **FAIL**, with

```
FAIL: the two deploy workflows disagree about the deployment directory: peakpower-platform says '/opt/peakpower', peakpower-web says '$HOME/peakpower'. Both SSH to the same VM and pull the same two checkouts, so one of them is deploying into a tree the other never touches.
FAIL: DEPLOYING.md never names '/opt/peakpower', which is the directory both deploy workflows actually use. …
verify-close-out: 2 check(s) failed
```

Two failures, not one, and the first is the one that matters: the guard caught a cross-repository
disagreement that neither repository's own tests can see. Now restore both files:

```bash
git checkout -- .github/workflows/deploy.yml DEPLOYING.md
```

⚠ `git checkout --` throws away step 3 as well. Re-apply step 3 before continuing, or — better —
commit step 3 first (step 7) and run this mutation against the committed state.

- [ ] **Step 6: Put the guard in CI**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/.github/workflows/ci.yml`, in the block that
runs the other guards, immediately after the `tools/verify-solution-layout.sh` step:

```yaml
      # Plan 8. The deployment directory is stated in three files across two repositories - both
      # deploy.yml files and DEPLOYING.md - and nothing compared them until they had already
      # disagreed for a fortnight. This step is also why ci.yml checks peakpower-web out: the
      # guard reads that repository's workflow and refuses to run without it.
      - name: The close-out guards
        run: tools/verify-close-out.sh
        env:
          PEAKPOWER_WEB_PATH: ${{ github.workspace }}/peakpower-web
```

⚠ **`PEAKPOWER_WEB_PATH` must match whatever path plan 1 task 2's workflow checks `peakpower-web`
out to.** Read that step before pasting this one; if it checks out to a different `path:`, use that
value here. A guard pointed at the wrong directory exits 1 with a clear message, so this fails
loudly rather than silently — but it fails the build, and the fix is one line rather than a
debugging session.

Run, to confirm the file still parses:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
gh workflow view ci.yml > /dev/null && echo workflow-parses
```

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tools/verify-close-out.sh DEPLOYING.md .github/workflows/ci.yml
git commit -m "docs: one deployment directory, and a guard that keeps the three files agreeing

DEPLOYING.md said /srv/peakpower in seventeen places and both deploy workflows said
\$HOME/peakpower. The workflow wins: it is the only one of the two a machine executes, the
cross-repository flock is already taken on \$HOME/.peakpower-deploy.lock, and \$HOME belongs to
DEPLOY_USER by definition rather than by a chown somebody has to remember.

All twenty-one /srv paths move, including the three under /srv/peakpower-backups and the one
/srv/peakpower-web inside the worked example about a cd that resolved one level too high - they are
different paths, but they are the same decision, and \$HOME/peakpower-backups is still outside the
checkout, which is the property that block is about. grep -c '/srv' DEPLOYING.md is now 0.

tools/verify-close-out.sh extracts DEPLOY_DIR from BOTH repositories' deploy.yml, requires them to
agree with each other, and requires DEPLOYING.md to name that literal - so a deliberate move is
followed and a drift is refused. Verified by mutation twice: one /srv put back on line 178, and
DEPLOY_DIR moved to /opt/peakpower in this repository only.

Design section 8, fifth risk row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `DevStubsGate` gains a third subject, and the disjointness assertion grows to five phrases

The load test posts fifty-one thousand generated documents at a webhook. That is exactly the kind of
thing contract §13.2's confirmation-phrase gate exists to stop somebody doing by accident, so the
verb goes behind the same gate as `backfill` and `cadence` rather than beside it.

⚠ **The two subjects contract §13.2 pins do not change.** `BackfillKey`, `CadenceKey`,
`BackfillConfirmation` and `CadenceConfirmation` keep their exact strings; this task adds a third
member to the enum and a third key and phrase, and touches nothing else.

**The five phrases now in the system**, and why the fifth was chosen:

| Where | Phrase |
| --- | --- |
| `SeedingGate.DemoCompaniesConfirmation` (`src/Hosts/PeakPower.Migrator/SeedingGate.cs:164-165`) | `yes, seed demo companies with a published password` |
| `SeedingGate.StaffAccountsConfirmation` (`:174`) | `yes, seed the named staff accounts` |
| `DevStubsGate.BackfillConfirmation` | `yes, post ninety days of generated documents to this webhook` |
| `DevStubsGate.CadenceConfirmation` | `yes, keep posting generated documents on the cadence` |
| **`DevStubsGate.LoadTestConfirmation`** — new | `yes, post a year of generated documents for a hundred connections` |

`SeedingGate`'s own doc comment states the property these five have to keep: *"Deliberately not a
substring or a prefix of `DemoCompaniesConfirmation`: an operator who copies one key's value into
the other gets a refusal that names the phrase that would have worked."* The new phrase shares only
`yes, post ` with the backfill phrase and diverges at the next word — `a year` against `ninety` — so
neither is a prefix of the other and neither is a substring of the other. It also names **what the
operator is about to do**, in the same register as the other four: a year, a hundred connections.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/DevStubsGate.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/DevStubsGateTests.cs`

**Interfaces:**
- Consumes: `DevStubsSubject`, `DevStubsGate.KeyFor`, `DevStubsGate.ConfirmationFor` — contract §13.2,
  written by plan 5.
- Produces:
  - `DevStubsSubject.LoadTest`
  - `DevStubsGate.LoadTestKey` — `"DevStubs:LoadTest"` (environment: `DevStubs__LoadTest`)
  - `DevStubsGate.LoadTestConfirmation` — `"yes, post a year of generated documents for a hundred connections"`

- [ ] **Step 1: Write the failing test**

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/DevStubsGateTests.cs`,
inside the existing class:

```csharp
    // ── the third subject, plan 8 ────────────────────────────────────────────────────────────

    /// <summary>
    /// Counted, not listed, and pinned to a COMPUTED expectation rather than a floor. Three is the
    /// number of things a developer can be asked to confirm before this program posts documents at
    /// a webhook, and a fourth arriving without a phrase, a key and a disjointness check is the
    /// failure this assertion is here to make loud.
    /// </summary>
    [Fact]
    public void There_are_exactly_three_subjects_a_developer_can_confirm()
    {
        Enum.GetValues<DevStubsSubject>().Length.ShouldBe(3);
    }

    [Fact]
    public void The_load_test_subject_carries_its_own_key_and_phrase()
    {
        DevStubsGate.KeyFor(DevStubsSubject.LoadTest).ShouldBe("DevStubs:LoadTest");
        DevStubsGate.ConfirmationFor(DevStubsSubject.LoadTest)
            .ShouldBe("yes, post a year of generated documents for a hundred connections");
    }

    /// <summary>
    /// Every phrase in the system, from BOTH gates, compared pairwise in both directions.
    ///
    /// ⚠ This is the assertion that stops a fifth phrase being a polite variation of a fourth. An
    /// operator who pastes the backfill phrase into DevStubs__LoadTest must be REFUSED and told
    /// which phrase would have worked - not quietly granted the loudest of the two because one
    /// happens to start with the other. SeedingGate's own doc comment states the rule; this test
    /// is the only place it is checked across both gates at once.
    ///
    /// The two SeedingGate constants are duplicated here as literals rather than referenced,
    /// because PeakPower.DevStubs cannot reference PeakPower.Migrator - a host may not reference
    /// another host (contract §13.2), which is the same reason DevStubsGate exists at all. A test
    /// project CAN see both, and this is the one place that fact is worth using.
    /// </summary>
    [Fact]
    public void No_confirmation_phrase_anywhere_contains_any_other()
    {
        string[] phrases =
        [
            "yes, seed demo companies with a published password",   // SeedingGate.DemoCompanies
            "yes, seed the named staff accounts",                   // SeedingGate.StaffAccounts
            .. Enum.GetValues<DevStubsSubject>().Select(DevStubsGate.ConfirmationFor),
        ];

        phrases.Length.ShouldBe(5);
        phrases.Distinct(StringComparer.Ordinal).Count().ShouldBe(5);

        foreach (var one in phrases)
        {
            foreach (var other in phrases)
            {
                if (ReferenceEquals(one, other) || string.Equals(one, other, StringComparison.Ordinal))
                {
                    continue;
                }

                one.Contains(other, StringComparison.Ordinal).ShouldBeFalse(
                    $"'{one}' contains '{other}', so an operator who pasted the second into the "
                    + "first's key would be granted rather than refused");
            }
        }
    }
```

⚠ **`Enum.GetValues<DevStubsSubject>()` keeps this test honest as the enum grows**, which is why the
phrases come from it rather than from three more literals. The two `SeedingGate` strings are the
exception and they carry the reason inline.

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo \
  --filter "FullyQualifiedName~DevStubsGateTests"
```

Expected: **FAIL**, three failures:

```
  There_are_exactly_three_subjects_a_developer_can_confirm
    Shouldly.ShouldAssertException : Enum.GetValues<DevStubsSubject>().Length
        should be
    3
        but was
    2
  The_load_test_subject_carries_its_own_key_and_phrase
    System.ArgumentOutOfRangeException : subject
  No_confirmation_phrase_anywhere_contains_any_other
    Shouldly.ShouldAssertException : phrases.Length
        should be
    5
        but was
    4
```

⚠ The three failures compile because none of them names `DevStubsSubject.LoadTest` **as a member** —
the second reaches it through a cast that `KeyFor`'s `switch` rejects with
`ArgumentOutOfRangeException`. A first red that does not compile is a build error, not a failing
test, and proves nothing about the assertion.

⚠ If `The_load_test_subject_carries_its_own_key_and_phrase` fails with something other than
`ArgumentOutOfRangeException`, plan 5's `KeyFor` has a `_ =>` default that returns a value instead
of throwing. Fix that first: a gate whose unknown subject resolves to *some* key is a gate that can
be turned on by a typo.

- [ ] **Step 3: Add the third subject**

Edit
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/DevStubsGate.cs`.

The enum gains one member — **appended, never inserted**, so the two existing members keep their
ordinal values:

```csharp
public enum DevStubsSubject
{
    Backfill,
    Cadence,

    /// <summary>
    /// Plan 8's 100-EAN × 365-day load test. Its own subject rather than a bigger Backfill: the
    /// backfill phrase says "ninety days", and a confirmation phrase that lies about what it
    /// confirms is a boolean with extra steps.
    /// </summary>
    LoadTest,
}
```

And the class gains one key, one phrase and one arm in each `switch`:

```csharp
    /// <summary>The configuration key the load test is turned on by: <c>DevStubs__LoadTest</c>.</summary>
    public const string LoadTestKey = "DevStubs:LoadTest";

    /// <summary>
    /// What <see cref="LoadTestKey"/> must contain, verbatim, for the load test to run.
    ///
    /// It names the SIZE on purpose. This verb posts 51 100 documents - a year for a hundred
    /// connections - and an operator who pastes this sentence somewhere has read what it does.
    /// Deliberately not a prefix or a substring of <see cref="BackfillConfirmation"/>, which is
    /// the only other phrase that begins "yes, post ": the two diverge at the next word.
    /// </summary>
    public const string LoadTestConfirmation =
        "yes, post a year of generated documents for a hundred connections";
```

```csharp
    public static string KeyFor(DevStubsSubject subject) => subject switch
    {
        DevStubsSubject.Backfill => BackfillKey,
        DevStubsSubject.Cadence => CadenceKey,
        DevStubsSubject.LoadTest => LoadTestKey,
        _ => throw new ArgumentOutOfRangeException(nameof(subject)),
    };

    public static string ConfirmationFor(DevStubsSubject subject) => subject switch
    {
        DevStubsSubject.Backfill => BackfillConfirmation,
        DevStubsSubject.Cadence => CadenceConfirmation,
        DevStubsSubject.LoadTest => LoadTestConfirmation,
        _ => throw new ArgumentOutOfRangeException(nameof(subject)),
    };
```

⚠ **Whatever else `DevStubsGate` carries — a `Describe`, a `Decide`, a refusal log message — grows
by the same one arm.** Plan 5 owns the shape; this task owns the member. Read the whole file and add
the `LoadTest` case everywhere `Backfill` and `Cadence` both appear. `-warnaserror` with
`AnalysisMode Recommended` will name any `switch` that has become non-exhaustive (CS8509), which is
the cheapest way to find them.

- [ ] **Step 4: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo \
  --filter "FullyQualifiedName~DevStubsGateTests"
```

Expected: PASS, with the whole `DevStubsGateTests` class green.

- [ ] **Step 5: Verify the disjointness assertion by mutation**

The assertion this task exists for is not "there is a third phrase" — it is "no phrase contains
another". Break exactly that. In `DevStubsGate.cs`, temporarily replace the phrase with a prefix of
the backfill one:

```csharp
    public const string LoadTestConfirmation =
        "yes, post ninety days of generated documents";
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~DevStubsGateTests"`

Expected: **FAIL**, with

```
  No_confirmation_phrase_anywhere_contains_any_other
    Shouldly.ShouldAssertException :
    'yes, post ninety days of generated documents to this webhook' contains
    'yes, post ninety days of generated documents', so an operator who pasted the second into the
    first's key would be granted rather than refused
```

That is the failure a fifth phrase written carelessly would produce. Restore the real phrase and
re-run to green.

⚠ **Do not mutate by deleting the enum member instead.** That breaks the build in three files and
proves nothing about the disjointness check — it proves the compiler works.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.DevStubs/DevStubsGate.cs \
        tests/PeakPower.Application.Tests/DevStubs/DevStubsGateTests.cs
git commit -m "feat(devstubs): a third confirmation subject, for the load test

The load test posts 51 100 documents at a webhook, so it goes behind the same confirmation-phrase
gate as backfill and cadence rather than beside it. Its own subject rather than a bigger backfill:
the backfill phrase says 'ninety days', and a confirmation phrase that lies about what it confirms
is a boolean with extra steps.

The disjointness assertion now covers all five phrases in the system, from BOTH gates, pairwise in
both directions - the property SeedingGate's own doc comment states and which nothing checked
across the two gates until now. Verified by mutation: the new phrase made a prefix of the backfill
phrase, and the test names both.

Contract 13.2's two subjects are untouched, character for character.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: the `loadtest` verb — a year for a hundred connections, over the real webhook

Design §5 step 12 asks for "100 EANs × 365 days into a throwaway database". `[F02-R30]` says how it
is allowed to get there: *"No code path may bypass **F02-R01..R13** to write readings directly."* So
the dataset is fifty-one thousand `POST /webhooks/brp/PVNED` requests, and this task is the thing
that makes them.

The verb splits in two, because only one half can be unit-tested:

- **`LoadTestPlan`** — pure. Given a hundred EANs and a last delivery date, it produces the exact
  list of (EAN, date, direction) triples to post. No clock, no HTTP, no database. This is the half
  that carries the 60/40 split and the arithmetic, and the half `LoadTestPlanTests` pins.
- **`LoadTestCommand`** — renders each triple through plan 5's template and posts it. It is I/O and
  it is proved by the run in task 4, not by a unit test.

**The `PeakPower.DevStubs` surface this task consumes — PINNED HERE.**

⚠ Plan 5's file list names `AmsterdamDay.cs`, `LoadShape.cs`, `DocumentSpec.cs`,
`PvnedDocumentTemplate.cs` and `PvnedWebhookClient.cs` but **gives no signature for any of them**,
and contract §13 does not either. The signatures below are what this task codes against. If plan 5
lands a different shape, **this block is the single place to reconcile** — change it here, then
change `LoadTestCommand` to match, and change nothing else.

```csharp
namespace PeakPower.DevStubs;

/// The generator's own 92/96/100 computation. Deliberately a SECOND opinion and never
/// IMarketCalendar: PeakPower.DevStubs may not reference PeakPower.Infrastructure.Time
/// (contract §3.1), and a generator that asked the parser how long a day is could not
/// disagree with it.
public static class AmsterdamDay
{
    public static int IntervalCount(DateOnly date);
}

/// Deterministic in (ean, date): the same pair always produces the same series, so a re-run
/// posts byte-identical documents and the 24-hour dedupe recognises them.
public static class LoadShape
{
    public static IReadOnlyList<decimal> Consumption(
        string ean, DateOnly date, int intervalCount, decimal capacityKw);
    public static IReadOnlyList<decimal> Production(
        string ean, DateOnly date, int intervalCount, decimal capacityKw);
}

/// The record the template renders from. Direction, DocumentType, Resolution, CurveType and
/// MeasurementUnit are the PVNed CODES (contract §8.2), not the platform's enum spellings —
/// the template emits XML text and never a serialisation of the parser's model (S2-D4).
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

public static class PvnedDocumentTemplate
{
    public static string Render(DocumentSpec spec);
}

/// Posts over POST /webhooks/brp/{brpCode} with the X-PeakPower-Brp-Credential header
/// (contract §9.1, §9.2), reading the credential from the environment variable
/// DevStubsOptions.CredentialVariable names.
public sealed class PvnedWebhookClient
{
    public PvnedWebhookClient(HttpClient http, DevStubsOptions options);
    public Task<PvnedPostResult> PostAsync(string documentXml, CancellationToken ct);
}

public sealed record PvnedPostResult(int StatusCode, string? CorrelationId, string? Body);
```

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/LoadTestPlan.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/LoadTestCommand.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/DevStubsOptions.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/Program.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/README.md`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/LoadTestPlanTests.cs`

**Interfaces:**
- Consumes: the pinned surface above, plus `DevStubsGate` (task 2) and
  `Microsoft.Extensions.Http`'s `IHttpClientFactory`.
- Produces:
  - `LoadTestPlan.Build(IReadOnlyList<string> eans, DateOnly lastDeliveryDate, int days) -> IReadOnlyList<LoadTestDocument>`
  - `LoadTestDocument(string Ean, DateOnly DeliveryDate, string Direction, int IntervalCount)`
  - `LoadTestOptions` on `DevStubsOptions.LoadTest`
  - the console verb `loadtest`

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Application.Tests/DevStubs/LoadTestPlanTests.cs`:

```csharp
using PeakPower.DevStubs;
using Shouldly;

namespace PeakPower.Application.Tests.DevStubs;

/// <summary>
/// The load test's arithmetic, with no HTTP and no clock in it.
///
/// WHY THE SPLIT IS 60/40 AND NOT 100/0. Design §7.11's per-interval offtake and export
/// accumulators only differ from the daily-totals answer on a day where production exceeds
/// consumption in SOME intervals. A dataset of a hundred consumption-only connections would
/// measure the read path over rows that never exercise the shape design §4.1 exists to protect —
/// and the month view's negative bars, the chart's zero line and the KPI strip's signed total
/// would all be measured against zeros.
/// </summary>
public sealed class LoadTestPlanTests
{
    /// <summary>
    /// A hundred EANs in the range tools/load-test-dataset.sh writes, so the fixture here and the
    /// rows in the database come from one rule stated twice rather than two rules that agree.
    /// </summary>
    private static IReadOnlyList<string> Eans() =>
        [.. Enumerable.Range(1, LoadTestPlan.Eans)
            .Select(n => $"87168710990000{n:D4}")];

    /// <summary>
    /// 2026-09-05 is chosen so the 365-day window ends the day before yesterday relative to the
    /// slice's own date and CONTAINS BOTH DST TRANSITIONS: 2025-10-26 (the autumn fall-back
    /// Sunday, 100 intervals) and 2026-03-29 (the spring-forward Sunday, 92). A load test that
    /// happened to span only ordinary days would measure the one case the slice never gets wrong.
    /// </summary>
    private static readonly DateOnly LastDay = new(2026, 9, 5);

    [Fact]
    public void The_plan_is_fifty_one_thousand_one_hundred_documents()
    {
        // 60 consumption-only x 365 + 40 producing x 365 x 2 directions.
        LoadTestPlan.Build(Eans(), LastDay, LoadTestPlan.Days).Count.ShouldBe(51_100);
    }

    [Fact]
    public void The_defaults_are_a_hundred_connections_and_a_year()
    {
        LoadTestPlan.Eans.ShouldBe(100);
        LoadTestPlan.Days.ShouldBe(365);
        LoadTestPlan.ConsumptionOnlyEans.ShouldBe(60);
        LoadTestPlan.ProducingEans.ShouldBe(40);
    }

    [Fact]
    public void The_first_sixty_eans_are_never_asked_for_a_production_series()
    {
        var eans = Eans();
        var consumptionOnly = eans.Take(LoadTestPlan.ConsumptionOnlyEans).ToHashSet(StringComparer.Ordinal);

        var offending = LoadTestPlan.Build(eans, LastDay, LoadTestPlan.Days)
            .Where(d => d.Direction == "A01" && consumptionOnly.Contains(d.Ean))
            .ToList();

        // [F02-R32]/[DEC-65]: PVNed sends no A01 series AT ALL for a connection that never
        // produces. A generator that sent one would make the sixty NEVER points indistinguishable
        // from the forty EXPECTED ones, and the completeness rule would be measured against a
        // world that cannot happen.
        offending.ShouldBeEmpty();
    }

    [Fact]
    public void The_last_forty_eans_get_both_directions_on_every_day()
    {
        var eans = Eans();
        var producing = eans.Skip(LoadTestPlan.ConsumptionOnlyEans).ToHashSet(StringComparer.Ordinal);

        var byEanAndDate = LoadTestPlan.Build(eans, LastDay, LoadTestPlan.Days)
            .Where(d => producing.Contains(d.Ean))
            .GroupBy(d => (d.Ean, d.DeliveryDate));

        byEanAndDate.Count().ShouldBe(LoadTestPlan.ProducingEans * LoadTestPlan.Days);
        byEanAndDate.ShouldAllBe(g => g.Count() == 2);
    }

    [Fact]
    public void No_triple_is_posted_twice()
    {
        var plan = LoadTestPlan.Build(Eans(), LastDay, LoadTestPlan.Days);

        // A duplicate (ean, date, direction) is a SUPERSESSION, not a duplicate: the second
        // document would mark the first version not-current and the dataset would carry 51 100
        // documents and fewer than 51 100 current versions. The read path would then be measured
        // over a smaller table than the one the count claims.
        plan.Select(d => (d.Ean, d.DeliveryDate, d.Direction))
            .Distinct()
            .Count()
            .ShouldBe(plan.Count);
    }

    [Fact]
    public void The_window_is_the_three_hundred_and_sixty_five_days_ending_on_the_last_day()
    {
        var dates = LoadTestPlan.Build(Eans(), LastDay, LoadTestPlan.Days)
            .Select(d => d.DeliveryDate)
            .Distinct()
            .Order()
            .ToList();

        dates.Count.ShouldBe(365);
        dates[^1].ShouldBe(LastDay);
        dates[0].ShouldBe(LastDay.AddDays(-364));
    }

    [Fact]
    public void Both_DST_days_are_in_the_window_and_carry_their_own_lengths()
    {
        var plan = LoadTestPlan.Build(Eans(), LastDay, LoadTestPlan.Days);

        var autumn = plan.Where(d => d.DeliveryDate == new DateOnly(2025, 10, 26)).ToList();
        var spring = plan.Where(d => d.DeliveryDate == new DateOnly(2026, 3, 29)).ToList();

        autumn.ShouldNotBeEmpty();
        spring.ShouldNotBeEmpty();

        // 100 and 92, from AmsterdamDay - the generator's own second opinion, never the parser's.
        autumn.ShouldAllBe(d => d.IntervalCount == 100);
        spring.ShouldAllBe(d => d.IntervalCount == 92);

        // And everything else is an ordinary day.
        plan.Where(d => d.DeliveryDate != new DateOnly(2025, 10, 26)
                     && d.DeliveryDate != new DateOnly(2026, 3, 29))
            .ShouldAllBe(d => d.IntervalCount == 96);
    }

    [Fact]
    public void A_short_window_is_allowed_so_the_script_can_smoke_test_itself()
    {
        // tools/load-test-dataset.sh takes --days, and its own self-check runs three days rather
        // than a year. Without this the script's first honest run is an hour long.
        LoadTestPlan.Build(Eans(), LastDay, days: 3).Count.ShouldBe(60 * 3 + 40 * 3 * 2);
    }

    [Fact]
    public void A_wrong_number_of_eans_is_refused_rather_than_truncated()
    {
        var act = () => LoadTestPlan.Build([.. Eans().Take(99)], LastDay, LoadTestPlan.Days);

        // Silently planning for 99 would produce a dataset the acceptance record calls "100 EANs".
        Should.Throw<ArgumentException>(act)
            .Message.ShouldContain("100", Case.Sensitive);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Application.Tests --nologo \
  --filter "FullyQualifiedName~LoadTestPlanTests"
```

Expected: **FAIL to build**, with
`error CS0246: The type or namespace name 'LoadTestPlan' could not be found`.

⚠ This is the one place in this plan where the first red is a build error, and it is legitimate:
the test is the first reference to a type that does not exist yet, which is TDD's ordinary opening
move. It is **not** a mutation, and nothing is being claimed about an assertion here.

- [ ] **Step 3: Write `LoadTestPlan`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/LoadTestPlan.cs`:

```csharp
namespace PeakPower.DevStubs;

/// <summary>One document to post: which connection, which day, which direction, how long.</summary>
/// <param name="Direction">The PVNed code — <c>A02</c> consumption, <c>A01</c> production.</param>
public sealed record LoadTestDocument(
    string Ean, DateOnly DeliveryDate, string Direction, int IntervalCount);

/// <summary>
/// The 100-EAN × 365-day load test's document list, and nothing else.
///
/// PURE ON PURPOSE. Everything here is arithmetic over its arguments: no clock (architecture fact
/// 5 keeps the clock inside PeakPower.Infrastructure.Time, which this host may not reference),
/// no HTTP, no database. That is what lets LoadTestPlanTests assert the shape of a dataset that
/// takes an hour to actually build.
///
/// THE ORDER IS CHRONOLOGICAL, and it is load-bearing. Documents are posted oldest first, so no
/// (ean, date, direction) is ever posted after a later one for the same triple and supersession
/// never fires. A shuffled order would still produce 51 100 messages and would produce fewer than
/// 51 100 CURRENT versions, which is not the dataset the acceptance record describes.
/// </summary>
public static class LoadTestPlan
{
    /// <summary>Connections whose <c>production_expectation</c> is <c>NEVER</c> — A02 only.</summary>
    public const int ConsumptionOnlyEans = 60;

    /// <summary>Connections whose <c>production_expectation</c> is <c>EXPECTED</c> — A01 and A02.</summary>
    public const int ProducingEans = 40;

    /// <summary>Design §5 step 12's hundred.</summary>
    public const int Eans = ConsumptionOnlyEans + ProducingEans;

    /// <summary>Design §5 step 12's year.</summary>
    public const int Days = 365;

    public const string Consumption = "A02";
    public const string Production = "A01";

    /// <summary>
    /// The documents to post, oldest day first, and within a day by EAN and then by direction.
    /// </summary>
    /// <param name="eans">
    /// Exactly <see cref="Eans"/> connections. The FIRST <see cref="ConsumptionOnlyEans"/> are the
    /// NEVER points and the rest produce — the same split
    /// <c>tools/load-test-dataset.sh</c> writes into <c>customer.metering_point</c>, which is why
    /// both read the same file in the same order.
    /// </param>
    /// <param name="lastDeliveryDate">The newest day in the window, inclusive.</param>
    /// <param name="days">How many days back the window runs. <see cref="Days"/> for the real run.</param>
    public static IReadOnlyList<LoadTestDocument> Build(
        IReadOnlyList<string> eans, DateOnly lastDeliveryDate, int days)
    {
        ArgumentNullException.ThrowIfNull(eans);
        ArgumentOutOfRangeException.ThrowIfLessThan(days, 1);

        if (eans.Count != Eans)
        {
            throw new ArgumentException(
                $"The load test plans for exactly {Eans} connections and was given {eans.Count}. "
                + "Planning for a different number silently produces a dataset the acceptance "
                + "record would still describe as a hundred EANs.",
                nameof(eans));
        }

        var documents = new List<LoadTestDocument>(days * (ConsumptionOnlyEans + ProducingEans * 2));

        for (var offset = days - 1; offset >= 0; offset--)
        {
            var date = lastDeliveryDate.AddDays(-offset);
            var intervalCount = AmsterdamDay.IntervalCount(date);

            for (var i = 0; i < eans.Count; i++)
            {
                documents.Add(new LoadTestDocument(eans[i], date, Consumption, intervalCount));

                if (i >= ConsumptionOnlyEans)
                {
                    documents.Add(new LoadTestDocument(eans[i], date, Production, intervalCount));
                }
            }
        }

        return documents;
    }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Application.Tests --nologo \
  --filter "FullyQualifiedName~LoadTestPlanTests"
```

Expected: PASS — nine tests, zero skipped.

⚠ If `Both_DST_days_are_in_the_window_and_carry_their_own_lengths` fails with `100 should be 96`,
`AmsterdamDay.IntervalCount` is wrong and **plan 5 has a defect this test just found**. Do not
adjust the fixture: 2025-10-26 is the last Sunday of October 2025 and it has twenty-five hours.

- [ ] **Step 5: Verify the split by mutation**

The assertion that carries the most weight here is the 60/40 one — a hundred consumption-only
connections would be a faster dataset that measured less. Break it: in `LoadTestPlan.cs`, change

```csharp
                if (i >= ConsumptionOnlyEans)
```

to

```csharp
                if (i >= Eans)
```

Run: `dotnet test tests/PeakPower.Application.Tests --nologo --filter "FullyQualifiedName~LoadTestPlanTests"`

Expected: **FAIL**, three of the nine:

```
  The_plan_is_fifty_one_thousand_one_hundred_documents
    should be 51100 but was 36500
  The_last_forty_eans_get_both_directions_on_every_day
    should be 14600 but was 14600 … g.Count() == 2   (every group has one entry, not two)
  A_short_window_is_allowed_so_the_script_can_smoke_test_itself
    should be 300 but was 300 … (no — 180 + 240 = 420 expected, 300 observed)
```

Restore the line and re-run to green.

⚠ **Read the numbers, do not just look for red.** The first failure's `36500` is 100 × 365 — a
hundred consumption-only connections, which is exactly the dataset this mutation describes. If it
reports some other number, the mutation was not the one intended.

- [ ] **Step 6: Add the options**

Edit
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/DevStubsOptions.cs`,
adding one nested options class and one property:

```csharp
/// <summary>Configuration for the <c>loadtest</c> verb. Section <c>DevStubs:LoadTest</c>.</summary>
public sealed class LoadTestOptions
{
    /// <summary>
    /// A file of eighteen-digit EANs, one per line, in the order
    /// <c>tools/load-test-dataset.sh</c> inserted them: the first
    /// <see cref="LoadTestPlan.ConsumptionOnlyEans"/> are the NEVER points.
    ///
    /// ⚠ A FILE rather than a generated range, deliberately. The script inserts the metering
    /// points and this verb posts their readings, and if the two derived the EANs independently
    /// a change to one rule would quarantine fifty-one thousand documents as UNKNOWN_EAN and the
    /// only symptom would be a fast, empty load test.
    /// </summary>
    public string EanFile { get; set; } = "";

    /// <summary>
    /// The newest delivery date, inclusive. Set by the script so the plan and the performance
    /// test name the same day; unset is refused rather than defaulted to "today", because a
    /// dataset whose last day depends on when the verb happened to run is not reproducible.
    /// </summary>
    public DateOnly? LastDeliveryDate { get; set; }

    /// <summary>How many days back. 365 for the real run; the script's self-check uses 3.</summary>
    public int Days { get; set; } = LoadTestPlan.Days;

    /// <summary>
    /// Concurrent POSTs. Eight, because the webhook stores the payload and answers 200 BEFORE any
    /// parsing (contract §9.4) — the request is short and the work is behind the queue, so more
    /// connections buy little and a hundred would measure the runner's socket table.
    /// </summary>
    public int Concurrency { get; set; } = 8;
}
```

and on `DevStubsOptions`:

```csharp
    public LoadTestOptions LoadTest { get; set; } = new();
```

- [ ] **Step 7: Write `LoadTestCommand`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/LoadTestCommand.cs`:

```csharp
using System.Diagnostics;
using System.Globalization;

namespace PeakPower.DevStubs;

/// <summary>
/// Posts a year of generated documents for a hundred connections over the REAL webhook.
///
/// ⚠ [F02-R30]: "No code path may bypass F02-R01..R13 to write readings directly." A load fixture
/// written with COPY would measure the read path against rows the pipeline never produced, and
/// the first time the two disagreed the measurement is what would hide it. Fifty-one thousand
/// POSTs is the price of the number meaning something.
/// </summary>
public sealed class LoadTestCommand(
    PvnedWebhookClient client, DevStubsOptions options, TextWriter output)
{
    /// <returns>0 when every document was accepted; 1 otherwise.</returns>
    public async Task<int> RunAsync(CancellationToken ct)
    {
        var settings = options.LoadTest;

        if (settings.LastDeliveryDate is not { } lastDay)
        {
            output.WriteLine(
                "DevStubs__LoadTest__LastDeliveryDate is not set. It is deliberately not "
                + "defaulted to today: the performance test navigates to a specific date, and a "
                + "dataset whose last day depends on when this ran is not reproducible.");
            return 1;
        }

        if (!File.Exists(settings.EanFile))
        {
            output.WriteLine(
                $"DevStubs__LoadTest__EanFile points at '{settings.EanFile}', which does not "
                + "exist. tools/load-test-dataset.sh writes it, and it must be the SAME file the "
                + "script inserted the metering points from.");
            return 1;
        }

        var eans = (await File.ReadAllLinesAsync(settings.EanFile, ct))
            .Select(line => line.Trim())
            .Where(line => line.Length > 0)
            .ToList();

        var plan = LoadTestPlan.Build(eans, lastDay, settings.Days);

        output.WriteLine(
            $"loadtest: {plan.Count:N0} documents, {eans.Count} connections, {settings.Days} days "
            + $"ending {lastDay:yyyy-MM-dd}, {settings.Concurrency} at a time.");

        var started = Stopwatch.StartNew();
        var posted = 0;
        var failed = 0;
        var firstFailures = new List<string>();
        var failureLock = new object();

        await Parallel.ForEachAsync(
            plan,
            new ParallelOptions { MaxDegreeOfParallelism = settings.Concurrency, CancellationToken = ct },
            async (document, token) =>
            {
                var xml = PvnedDocumentTemplate.Render(SpecFor(document, options));
                var result = await client.PostAsync(xml, token);

                if (result.StatusCode != 200)
                {
                    lock (failureLock)
                    {
                        failed++;
                        if (firstFailures.Count < 10)
                        {
                            firstFailures.Add(
                                $"{document.Ean} {document.DeliveryDate:yyyy-MM-dd} "
                                + $"{document.Direction} -> {result.StatusCode} {result.Body}");
                        }
                    }
                }

                var done = Interlocked.Increment(ref posted);
                if (done % 1000 == 0)
                {
                    output.WriteLine(
                        $"  {done:N0}/{plan.Count:N0} in {started.Elapsed:hh\\:mm\\:ss} "
                        + $"({done / Math.Max(started.Elapsed.TotalSeconds, 1):F0}/s)");
                }
            });

        started.Stop();
        output.WriteLine(
            $"loadtest: {posted:N0} posted, {failed:N0} refused, in {started.Elapsed:hh\\:mm\\:ss}.");

        foreach (var failure in firstFailures)
        {
            output.WriteLine($"  ! {failure}");
        }

        // ⚠ 200 means STORED AND ENQUEUED, not processed (contract §9.4). Everything above is the
        // receiving half; tools/load-test-dataset.sh is what waits for inbound_message to drain,
        // because only the database can answer that question and this host has no connection to it.
        if (failed > 0)
        {
            output.WriteLine(
                "A refused document is a dataset with a hole in it. Do not measure against it.");
            return 1;
        }

        output.WriteLine(
            "Every document was accepted and enqueued. The readings are not written yet - wait for "
            + "metering.inbound_message to drain before measuring.");
        return 0;
    }

    /// <summary>
    /// One document's spec. The document id is derived from the triple rather than random, so a
    /// re-run posts byte-identical bytes and the 24-hour dedupe [F02-R07] recognises them - which
    /// is what makes an interrupted load test safe to restart.
    /// </summary>
    private static DocumentSpec SpecFor(LoadTestDocument document, DevStubsOptions options) =>
        new(
            DocumentId: string.Create(
                CultureInfo.InvariantCulture,
                $"LOADTEST-{document.Ean}-{document.DeliveryDate:yyyyMMdd}-{document.Direction}"),
            DocumentCreated: new DateTimeOffset(
                document.DeliveryDate.AddDays(1).ToDateTime(new TimeOnly(4, 0)),
                TimeSpan.FromHours(1)),
            DocumentType: "A23",
            ProcessType: options.ProcessType,
            SenderGln: options.SenderGln,
            ReceiverGln: options.ReceiverGln,
            ResourceObject: document.Ean,
            DeliveryDate: document.DeliveryDate,
            Direction: document.Direction,
            Resolution: "PT15M",
            CurveType: "A01",
            MeasurementUnit: "KWH",
            Quantities: document.Direction == LoadTestPlan.Production
                ? LoadShape.Production(document.Ean, document.DeliveryDate, document.IntervalCount, CapacityKw)
                : LoadShape.Consumption(document.Ean, document.DeliveryDate, document.IntervalCount, CapacityKw));

    /// <summary>
    /// The capacity every load-test connection is inserted with, and the figure the load shape
    /// scales to. One constant, read by the generator here and written into
    /// customer.metering_point.capacity_kw by tools/load-test-dataset.sh, so
    /// SchemaProvenance row 4's plausibility check has something true to compare against.
    /// </summary>
    public const decimal CapacityKw = 2500m;
}
```

⚠ **`DocumentCreated` is 04:00 the morning after the delivery date, at `+01:00`.** It is a plausible
BRP send time and — because it is derived rather than `DateTimeOffset.UtcNow` — the whole document
is a function of the triple. That is what makes a restart after a network failure a no-op for
everything already posted: byte-identical bytes inside 24 hours land `DUPLICATE` and enqueue
nothing `[F02-R07]`.

⚠ **`options.ProcessType`, `options.SenderGln` and `options.ReceiverGln` are plan 5's**, already on
`DevStubsOptions` per its file list ("webhook base URI, BRP code, credential variable name, GLNs").
The GLN defaults are contract §8.6's: sender `8714252005776`, receiver `8712423456789`.

- [ ] **Step 8: Wire the verb**

Edit `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/Program.cs`, adding
one arm to the verb switch beside `scenarios`, `backfill` and `cadence`:

```csharp
    "loadtest" => await RunGated(DevStubsSubject.LoadTest, ct =>
        new LoadTestCommand(
            new PvnedWebhookClient(httpFactory.CreateClient("brp"), options),
            options,
            Console.Out).RunAsync(ct)),
```

and one line to the usage text the no-verb and unknown-verb cases print:

```
  loadtest    100 connections x 365 days over the real webhook. Gated on DevStubs__LoadTest.
```

⚠ **`RunGated` is plan 5's helper** — the one that reads `DevStubsGate.KeyFor(subject)` from
configuration, compares it ordinally after trimming against `DevStubsGate.ConfirmationFor(subject)`,
and refuses **audibly** when it does not match. Use it; do not write a second gate check here. If
plan 5 named it something else, use that name and change nothing about the shape.

⚠ **The `HttpClient` needs a long timeout.** Fifty-one thousand requests on eight connections will
meet a slow one; the default 100 seconds is fine per request, but do **not** lower it, and do not
set `Timeout` from the total run length.

- [ ] **Step 9: Document the verb**

Append to `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.DevStubs/README.md`:

````markdown
## `loadtest` — the 100-EAN × 365-day dataset

Design §5 step 12 and §7.24. It posts **51 100** documents — sixty consumption-only connections and
forty producing ones, 365 days each — over `POST /webhooks/brp/{code}`, because `[F02-R30]` forbids
any code path that writes readings directly.

**Do not run this by hand against a stack you care about.** `tools/load-test-dataset.sh` is the
entry point: it stands a throwaway Compose stack up on its own project name and its own ports,
inserts the hundred connections, runs this verb, waits for the queue to drain, and prints the
figures `peakpower-web`'s `npm run perf` needs.

```bash
DevStubs__LoadTest="yes, post a year of generated documents for a hundred connections" \
DevStubs__LoadTest__EanFile=/tmp/peakpower-loadtest/eans.txt \
DevStubs__LoadTest__LastDeliveryDate=2026-09-05 \
DevStubs__WebhookBaseUri=http://localhost:5201 \
BRP_CREDENTIAL_PVNED=... \
  dotnet run --project src/Hosts/PeakPower.DevStubs -- loadtest
```

`LastDeliveryDate` has no default on purpose: the performance test navigates to a specific date, and
a dataset whose last day depends on when the verb happened to run is not reproducible.
````

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.DevStubs tests/PeakPower.Application.Tests/DevStubs/LoadTestPlanTests.cs
git commit -m "feat(devstubs): a loadtest verb - 100 connections, 365 days, over the real webhook

Design section 5 step 12 asks for 100 EANs x 365 days in a throwaway database, and F02-R30 says how
it is allowed to get there: no code path may bypass F02-R01..R13 to write readings directly. So the
dataset is 51 100 POSTs rather than a COPY, and the read path is then measured over rows the
pipeline actually produced.

Split in two so the half that can be tested is: LoadTestPlan is pure arithmetic over its arguments
and carries the 60/40 split, the chronological order and the DST day lengths; LoadTestCommand does
the I/O and is proved by the run, not by a unit test.

60 consumption-only and 40 producing, not 100 and 0: design 4.1's per-interval offtake and export
accumulators only differ from the daily-totals answer on a day where production exceeds consumption
in some intervals, and a dataset without those days would measure the read path over the one shape
the slice exists to protect. Verified by mutation - the split collapsed to 100/0 and three
assertions name the 36 500 documents that produces.

Every document is a function of (ean, date, direction), including its DocumentId and CreatedDateTime,
so an interrupted run restarts as byte-identical redeliveries that land DUPLICATE and enqueue
nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: the throwaway stack, the hundred connections, and `tools/load-test-dataset.sh`

Design §5 step 12 says *"into a throwaway database"*, and the word is load-bearing. The dataset is
five million interval rows that nobody wants on the deployment VM and nobody wants in `./dev-up`'s
volume either. So it goes into a **second Compose project**, with its own volumes (Compose namespaces
them by project name) and its own published ports (Compose does not), and it is destroyed at the end.

Three things this script does and one thing it deliberately does not:

- it **inserts a hundred `customer.metering_point` rows** with SQL — master data, which is what
  `DemoDataSeeder` writes and what the back office edits, and which `[F02-R30]` says nothing about;
- it **posts every kWh over the webhook**, through `LoadTestCommand`, because `[F02-R30]` says
  everything about that;
- it **waits for `metering.inbound_message` to drain**, because a 200 means stored and enqueued and
  not processed (contract §9.4), and measuring a read path against a queue that is still draining
  measures the queue;
- it **does not restore a dump.** ≈4.9 M rows is a few hundred megabytes; rebuilding it is an hour
  and carrying it is a repository nobody can clone.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/deploy/docker-compose.loadtest.yaml`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/load-test-dataset.sh`

**Interfaces:**
- Consumes: `deploy/docker-compose.yaml` (generated and committed by plan 1), the `loadtest` verb
  (task 3), `DemoDataSeeder`'s **Vandersteen Koeling B.V.** and its account
  `j.devries@vandersteen.nl` / `correct-horse-battery`
  (`src/Infrastructure/PeakPower.Persistence/Seeding/DemoDataSeeder.cs:49` and `:206-209`), and
  migration 1's seeded `PVNED` BRP row `0199a1a0-0000-7000-8000-0000000000b1`.
- Produces:
  - a running stack on Compose project `peakpower-loadtest`, customer API on **5201**, employee API
    on **5202**, Worker on **5203**;
  - `/tmp/peakpower-loadtest/eans.txt` — a hundred EANs, one per line, in plan order;
  - `/tmp/peakpower-loadtest/perf.env` — the seven variables `npm run perf` reads;
  - `/tmp/peakpower-loadtest/dataset.txt` — the measured row counts and timings.

- [ ] **Step 1: Write the Compose override**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/deploy/docker-compose.loadtest.yaml`:

```yaml
# The load test's throwaway stack — plan 8 task 4.
#
# HAND-WRITTEN, AND SAFE FROM `aspire publish`. `docker-compose.yaml` beside this file is
# GENERATED and committed (contract §2): hand edits to it are discarded on the next publish. This
# file is an OVERRIDE and is never generated, which is the only reason it is allowed to exist in
# this directory.
#
# WHAT IT CHANGES AND WHY. Compose namespaces VOLUMES by project name, so `-p peakpower-loadtest`
# already gives this stack its own database. It does NOT namespace published PORTS, and the
# generated file pins 5101 and 5102 — so a load-test stack started beside the real one would fail
# to bind, or worse, would bind first and take the real stack's port. Every published port moves
# into the 52xx range.
#
# ⚠ `!override` REPLACES the generated `ports` list rather than appending to it. Without it
# Compose merges sequences by appending and the service publishes BOTH 5101 and 5201. Requires
# Compose v2.24 or newer; `docker compose version` on this box must print at least that, and
# tools/load-test-dataset.sh checks the rendered config rather than trusting the tag.
services:
  customer-api:
    ports: !override
      - "5201:8080"
  employee-api:
    ports: !override
      - "5202:8080"
  worker:
    ports: !override
      - "5203:8080"
  compose-dashboard:
    # The dashboard's generated mapping is an ephemeral host port already, but two dashboards on
    # one box is one confusing browser tab too many.
    ports: !override
      - "18988:18888"
```

⚠ **`worker`'s container port is `8080` because every other host in the generated file sets
`HTTP_PORTS: "8080"`.** Read the regenerated `deploy/docker-compose.yaml` before running this: if
plan 1 gave the Worker a different container port, change the right-hand side here. Step 3 checks
the rendered result, so a mistake fails immediately rather than at the first POST.

- [ ] **Step 2: Write the script**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/load-test-dataset.sh`:

```bash
#!/usr/bin/env bash
# Builds design §5 step 12's dataset: 100 EANs x 365 days, in a THROWAWAY Compose stack.
#
# WHAT GOES IN BY SQL AND WHAT GOES IN OVER THE WIRE. A hundred customer.metering_point rows and
# their metering_point_brp_assignment history are inserted with psql - master data, the same rows
# DemoDataSeeder writes and the back office edits. EVERY KWH goes over
# POST /webhooks/brp/PVNED, because [F02-R30] says "No code path may bypass F02-R01..R13 to write
# readings directly" and a load fixture written with COPY would measure the read path against rows
# the pipeline never produced.
#
# WHY IT WAITS. A 200 from the webhook means the payload is stored and the job is enqueued, BEFORE
# any parsing (contract §9.4). Measuring a read path while the queue is still draining measures the
# queue. This script does not print the perf environment until inbound_message has no RECEIVED and
# no PROCESSING rows left.
#
# ⚠ DO NOT RUN THIS ON THE DEPLOYMENT VM. It builds four images from source, publishes four ports
# and fills a volume with ~4.9 M rows.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

project="peakpower-loadtest"
work="/tmp/peakpower-loadtest"
env_file="$root/deploy/.env.loadtest"
days=365
keep=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --days) days="$2"; shift 2 ;;
    --keep) keep=1; shift ;;
    *) echo "usage: tools/load-test-dataset.sh [--days N] [--keep]" >&2; exit 2 ;;
  esac
done

compose() {
  docker compose -p "$project" \
    -f "$root/deploy/docker-compose.yaml" \
    -f "$root/deploy/docker-compose.loadtest.yaml" \
    --env-file "$env_file" "$@"
}

mkdir -p "$work"

# ── the window ──────────────────────────────────────────────────────────────────────────────────
# The day before yesterday in Europe/Amsterdam. Yesterday would be a day the cadence has not
# finished delivering in a real deployment, and "today" is a partial day by definition; the
# performance test needs a day that is unambiguously complete.
last_day="$(TZ=Europe/Amsterdam date -d '2 days ago' +%F 2>/dev/null \
         || TZ=Europe/Amsterdam date -v-2d +%F)"
echo "== window: $days day(s) ending $last_day (Europe/Amsterdam)"

# ── the hundred EANs, written ONCE and read by both halves ──────────────────────────────────────
# The SQL below inserts these and DevStubs posts for these. If the two derived the range
# independently, one edit would quarantine every document as UNKNOWN_EAN and the only symptom
# would be a fast, empty load test.
: > "$work/eans.txt"
for n in $(seq 1 100); do
  printf '87168710990000%04d\n' "$n" >> "$work/eans.txt"
done
[[ "$(wc -l < "$work/eans.txt")" -eq 100 ]] || { echo "FAIL: eans.txt is not 100 lines" >&2; exit 1; }
[[ "$(awk '{ print length }' "$work/eans.txt" | sort -u)" == "18" ]] \
  || { echo "FAIL: an EAN is not eighteen digits" >&2; exit 1; }

# ── the throwaway .env ──────────────────────────────────────────────────────────────────────────
# Not committed and not deploy/.env: this file names a database that lives for an hour.
brp_credential="loadtest-$(openssl rand -hex 16)"
cat > "$env_file" <<ENV
POSTGRES_PASSWORD=loadtest_$(openssl rand -hex 12)
EMPLOYEE_DATABASE_PASSWORD=dev_only_employee_password
CUSTOMER_PORTAL_BASE_URL=http://localhost:5201
RESEND_API_KEY=
RESEND_FROM=
TRUSTED_PROXIES=
SEED_STAFF_ACCOUNTS=
SEED_DEMO_COMPANIES=yes, seed demo companies with a published password
STAFF_PASSWORD_RENE=
STAFF_PASSWORD_THINH=
STAFF_PASSWORD_LUKA=
STAFF_PASSWORD_LEX=
DEMO_BANK_VERIFICATION_SIMULATOR=false
BRP_CREDENTIAL_PVNED=$brp_credential
ENV
chmod 600 "$env_file"

# EMPLOYEE_DATABASE_PASSWORD must be the literal migration 2 creates the role with. That is
# [OQ-102] and it is not this script's to fix; a different value starts the stack, serves the
# portal, and answers 500 with 28P01 on every authenticated back-office request.

# ── the stack ───────────────────────────────────────────────────────────────────────────────────
echo "== bringing up the throwaway stack (this builds four images; several minutes)"
compose up -d --build

# The override has to have actually taken effect. Compose merges sequences by APPENDING unless
# !override is honoured, and a stack that published 5101 would either fail to bind or steal the
# real stack's port.
rendered="$(compose config)"
if grep -q '5101' <<< "$rendered"; then
  echo "FAIL: the rendered config still publishes 5101, so deploy/docker-compose.loadtest.yaml's" >&2
  echo "      !override was not honoured. Check 'docker compose version' - !override needs v2.24+." >&2
  compose down --volumes
  exit 1
fi

echo "== waiting for the migrator to finish and the customer API to answer"
deadline=$(( $(date +%s) + 900 ))
until curl -fsS -o /dev/null "http://localhost:5201/"; do
  [[ $(date +%s) -lt $deadline ]] || { echo "FAIL: the customer API never answered on 5201" >&2; compose logs --tail 80; exit 1; }
  sleep 5
done

psql() {
  compose exec -T -e PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' "$env_file" | cut -d= -f2-)" \
    postgres psql -U postgres -d peakpower -v ON_ERROR_STOP=1 "$@"
}

# ── the hundred connections ─────────────────────────────────────────────────────────────────────
echo "== inserting a hundred metering points for Vandersteen Koeling B.V."

collisions="$(psql -tAc "
  SELECT count(*) FROM customer.metering_point WHERE ean LIKE '8716871099%';")"
[[ "$collisions" == "0" ]] || {
  echo "FAIL: $collisions existing metering points already use the 8716871099 prefix. The load" >&2
  echo "      test would attach readings to somebody else's connections." >&2
  exit 1; }

# valid_from is one day BEFORE the window opens, so no delivery date falls outside the validity
# daterange - an EAN whose validity does not cover the date quarantines as EAN_VALIDITY [F02-R15]
# and the load test would end with 51 100 quarantine rows and no readings.
psql <<SQL
BEGIN;

CREATE TEMP TABLE loadtest_ean(seq int, ean text);
\\copy loadtest_ean(ean) FROM '/dev/stdin'
$(cat "$work/eans.txt")
\\.
UPDATE loadtest_ean SET seq = sub.rn
  FROM (SELECT ean, row_number() OVER (ORDER BY ean) AS rn FROM loadtest_ean) sub
 WHERE loadtest_ean.ean = sub.ean;

INSERT INTO customer.metering_point
  (customer_id, ean, commodity, brp_id, production_expectation, expectation_source,
   name, description, grid_operator, capacity_kw, address, valid_from, valid_to)
SELECT c.id,
       e.ean,
       'ELECTRICITY',
       '0199a1a0-0000-7000-8000-0000000000b1'::uuid,
       CASE WHEN e.seq <= 60 THEN 'NEVER' ELSE 'EXPECTED' END,
       'CUSTOMER_DECLARED',
       'Load test ' || lpad(e.seq::text, 3, '0'),
       'Inserted by tools/load-test-dataset.sh. Not demo data.',
       'Stedin',
       2500.000000,
       NULL,
       DATE '$last_day' - $days,
       NULL
  FROM loadtest_ean e
  CROSS JOIN (SELECT id FROM customer.customer
               WHERE legal_name = 'Vandersteen Koeling B.V.') c;

-- [F02-R43]: WRONG_BRP is decided against the assignment IN FORCE AT RECEIPT TIME, and an
-- assignment history with a hole in it is a history that cannot answer that question. Migration 9
-- backfilled one row per metering point that existed then; these hundred arrived afterwards.
INSERT INTO customer.metering_point_brp_assignment
  (metering_point_id, from_brp_id, to_brp_id, assigned_at, assigned_by, reason)
SELECT mp.id, NULL, mp.brp_id, mp.brp_assigned_at, 'system:load-test',
       'Initial assignment, inserted with the load-test connections.'
  FROM customer.metering_point mp
 WHERE mp.ean LIKE '8716871099%';

COMMIT;
SQL

inserted="$(psql -tAc "SELECT count(*) FROM customer.metering_point WHERE ean LIKE '8716871099%';")"
[[ "$inserted" == "100" ]] || { echo "FAIL: inserted $inserted metering points, expected 100" >&2; exit 1; }

never="$(psql -tAc "
  SELECT count(*) FROM customer.metering_point
   WHERE ean LIKE '8716871099%' AND production_expectation = 'NEVER';")"
[[ "$never" == "60" ]] || { echo "FAIL: $never NEVER points, expected 60" >&2; exit 1; }

# ── the readings, over the wire ─────────────────────────────────────────────────────────────────
echo "== posting the documents (51 100 for a 365-day run; expect 20-50 minutes)"
posting_started=$(date +%s)

DevStubs__LoadTest="yes, post a year of generated documents for a hundred connections" \
DevStubs__LoadTest__EanFile="$work/eans.txt" \
DevStubs__LoadTest__LastDeliveryDate="$last_day" \
DevStubs__LoadTest__Days="$days" \
DevStubs__WebhookBaseUri="http://localhost:5203" \
BRP_CREDENTIAL_PVNED="$brp_credential" \
  dotnet run --project src/Hosts/PeakPower.DevStubs --configuration Release -- loadtest \
  | tee "$work/post.log"

posting_seconds=$(( $(date +%s) - posting_started ))

# ── the drain ───────────────────────────────────────────────────────────────────────────────────
echo "== waiting for metering.inbound_message to drain"
drain_started=$(date +%s)
while :; do
  pending="$(psql -tAc "
    SELECT count(*) FROM metering.inbound_message WHERE status IN ('RECEIVED','PROCESSING');")"
  [[ "$pending" == "0" ]] && break
  echo "   $pending message(s) still queued"
  # No deadline. A queue that is still moving is not a failure, and a timeout here would throw
  # away an hour of posting; if it has genuinely stalled, `docker compose -p peakpower-loadtest
  # logs worker` says why and Ctrl-C costs nothing but the stack.
  sleep 30
done
drain_seconds=$(( $(date +%s) - drain_started ))

failed="$(psql -tAc "SELECT count(*) FROM metering.inbound_message WHERE status = 'FAILED';")"
[[ "$failed" == "0" ]] || {
  echo "FAIL: $failed message(s) are FAILED. The dataset has holes; do not measure against it." >&2
  psql -c "SELECT failure_code, count(*) FROM metering.inbound_message
            WHERE status = 'FAILED' GROUP BY 1 ORDER BY 2 DESC;" >&2
  exit 1; }

quarantined="$(psql -tAc "SELECT count(*) FROM metering.quarantined_series;")"
[[ "$quarantined" == "0" ]] || {
  echo "FAIL: $quarantined quarantined series. The hundred connections and the hundred EANs the" >&2
  echo "      generator posted for are not the same hundred." >&2
  psql -c "SELECT reason, count(*) FROM metering.quarantined_series GROUP BY 1;" >&2
  exit 1; }

# ── the figures ─────────────────────────────────────────────────────────────────────────────────
read -r messages versions readings positions states <<< "$(psql -tAc "
  SELECT (SELECT count(*) FROM metering.inbound_message)
      || ' ' || (SELECT count(*) FROM metering.interval_data_version WHERE is_current)
      || ' ' || (SELECT count(*) FROM metering.interval_reading)
      || ' ' || (SELECT count(*) FROM metering.daily_position)
      || ' ' || (SELECT count(*) FROM metering.metering_point_day_state);")"

perf_month="$(psql -tAc "
  SELECT to_char(date_trunc('month', DATE '$last_day') - interval '1 month', 'YYYY-MM');")"
one_point="$(psql -tAc "
  SELECT id FROM customer.metering_point WHERE ean = '871687109900000001';")"
all_points="$(psql -tAc "
  SELECT string_agg(mp.id::text, ',' ORDER BY mp.ean)
    FROM customer.metering_point mp
    JOIN customer.customer c ON c.id = mp.customer_id
   WHERE c.legal_name = 'Vandersteen Koeling B.V.';")"

cat > "$work/perf.env" <<PERF
PEAKPOWER_PERF_BASE_URL=http://localhost:5201
PEAKPOWER_PERF_USERNAME=j.devries@vandersteen.nl
PEAKPOWER_PERF_PASSWORD=correct-horse-battery
PEAKPOWER_PERF_DATE=$last_day
PEAKPOWER_PERF_MONTH=$perf_month
PEAKPOWER_PERF_POINT_ID=$one_point
PEAKPOWER_PERF_ALL_POINT_IDS=$all_points
PERF

{
  echo "load-test dataset, built $(date -u +%FT%TZ)"
  echo "  window                    $days day(s) ending $last_day"
  echo "  connections               100 (60 NEVER, 40 EXPECTED) + 6 seeded = $(( $(tr ',' '\n' <<< "$all_points" | wc -l) )) selectable"
  echo "  inbound_message rows      $messages"
  echo "  current versions          $versions"
  echo "  interval_reading rows     $readings"
  echo "  daily_position rows       $positions"
  echo "  metering_point_day_state  $states"
  echo "  posting                   ${posting_seconds}s"
  echo "  draining                  ${drain_seconds}s"
  echo "  runner                    $(uname -srm), $(nproc 2>/dev/null || sysctl -n hw.ncpu) cpu"
  echo "  memory                    $(free -m 2>/dev/null | awk '/^Mem:/{print $2" MB"}' || echo unknown)"
  echo "  database size             $(psql -tAc "SELECT pg_size_pretty(pg_database_size('peakpower'));")"
} | tee "$work/dataset.txt"

echo
echo "== the performance run reads these:"
cat "$work/perf.env"
echo
echo "   cd ../peakpower-web && set -a && . $work/perf.env && set +a && npm run perf"

if [[ $keep -eq 0 ]]; then
  echo "== tearing the throwaway stack down (pass --keep to leave it up)"
  compose down --volumes
  rm -f "$env_file"
fi
```

- [ ] **Step 3: Run the script's own smoke test — three days, not a year**

An hour-long first run that fails in the last minute teaches nothing an hour earlier would not have.

Run:

```bash
chmod +x /Users/thinhhuynh/PeakPower/peakpower-platform/tools/load-test-dataset.sh
cd /Users/thinhhuynh/PeakPower/peakpower-platform
tools/load-test-dataset.sh --days 3 --keep
```

Expected: the whole script, in roughly five to eight minutes, ending with

```
load-test dataset, built 2026-09-07T…Z
  window                    3 day(s) ending 2026-09-05
  connections               100 (60 NEVER, 40 EXPECTED) + 6 seeded = 106 selectable
  inbound_message rows      420
  current versions          420
  interval_reading rows     40320
  daily_position rows       300
  metering_point_day_state  300
  …
```

The arithmetic to check by hand: 60 × 3 + 40 × 3 × 2 = **420** documents; 420 × 96 = **40 320**
readings, because none of the three days is a DST day; 100 points × 3 days = **300** rollup rows.

⚠ If `quarantined` is non-zero with `UNKNOWN_EAN`, the SQL insert and `eans.txt` disagree — read
`quarantined_series.resource_object` and compare it to `/tmp/peakpower-loadtest/eans.txt`.

⚠ If it is non-zero with `EAN_VALIDITY`, `valid_from` is inside the window. `DATE '$last_day' - $days`
puts it one day before the oldest delivery date; check the substitution actually happened.

⚠ If the customer API never answers on 5201, run `docker compose -p peakpower-loadtest logs migrator`
first. The migrator runs to completion before the APIs start, so a migration failure looks exactly
like a slow build.

- [ ] **Step 4: Prove the throwaway stack is throwaway**

With the three-day stack still up from step 3, confirm it has not touched anything else:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
docker volume ls --filter name=peakpower | sort
docker compose -p peakpower-loadtest ps --format '{{.Service}} {{.Ports}}'
```

Expected: the `peakpower-loadtest_*` volumes are **distinct** from any `peakpower_*` volume, and the
ports are 5201, 5202, 5203, 18988 — no 5101 and no 5102.

Then destroy it and confirm nothing survives:

```bash
docker compose -p peakpower-loadtest \
  -f deploy/docker-compose.yaml -f deploy/docker-compose.loadtest.yaml \
  --env-file deploy/.env.loadtest down --volumes
docker volume ls --filter name=peakpower-loadtest
```

Expected: the second command lists **no volumes**.

- [ ] **Step 5: Build the real dataset**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
tools/load-test-dataset.sh --keep 2>&1 | tee /tmp/peakpower-loadtest/run.log
```

Expected: 51 100 documents, ≈4.9 M `interval_reading` rows, 36 500 `daily_position` rows, and a
`perf.env` naming the date, the month and the hundred and six metering-point ids. **Leave it up** —
task 5 measures against it.

⚠ **`--keep` leaves four containers and a several-gigabyte volume running.** Tear them down when
task 5 is finished; the command is in step 4.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add deploy/docker-compose.loadtest.yaml tools/load-test-dataset.sh
git commit -m "test: build design step 12's dataset in a throwaway Compose stack

100 EANs x 365 days = 51 100 documents, every one of them over POST /webhooks/brp/PVNED. F02-R30
forbids any code path that writes readings directly, so a COPY-based fixture would measure the read
path against rows the pipeline never produced - and the first time the two disagreed, the
measurement is what would hide it.

Master data goes in by SQL and readings do not: a hundred customer.metering_point rows and their
metering_point_brp_assignment history, which is what DemoDataSeeder writes and what the back office
edits. F02-R43 decides WRONG_BRP against the assignment in force at receipt time, so the history
rows are not optional.

A second Compose project rather than a second database. Compose namespaces volumes by project name
and does NOT namespace published ports, which is why the override moves 5101/5102 into the 52xx
range with !override rather than letting Compose append them.

It waits for inbound_message to drain before printing anything a measurement would use: a 200 means
stored and enqueued, before any parsing, and measuring a read path against a draining queue measures
the queue.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: the checked-in performance test — `[NFR-03]` and `[NFR-04]` in headless Chrome

Design §7.24, in full: *"A 100-EAN × 365-day generated dataset loads, and the day view **responds to
its first hover within 1.5 s of navigation on a warmed cache (second load), measured in headless
Chrome on the CI runner and asserted in a checked-in performance test** (`[NFR-03]`); the month view
within 2 s (`[NFR-04]`)."*

Every phrase in that sentence is pinned in this plan's Global Constraints. This task writes the test.

**It is a second Playwright configuration, not a second project inside the existing one.** The
existing `playwright.config.ts` starts two `ng serve` dev servers. A performance figure measured
against a dev server measures the dev server — unminified bundles, no build optimisation, a proxy
hop — so the perf run drives the **built** portal the customer API serves (`[DEC-136]`: each API
serves its own portal's files), on the throwaway stack task 4 left running, and starts no server at
all.

**Files:** *(all in `/Users/thinhhuynh/PeakPower/peakpower-web`)*
- Create: `playwright.perf.config.ts`
- Create: `perf/tsconfig.json`
- Create: `perf/fixtures/measure.ts`
- Create: `perf/consumption-performance.spec.ts`
- Modify: `package.json` — one script

**Interfaces:**
- Consumes: `/tmp/peakpower-loadtest/perf.env` (task 4) through the process environment; the
  `/consumption` route and its `?view` / `?date` / `?month` / `?points` query parameters (plan 7);
  the DOM classes `.pp-usage-chart__tooltip` and `.pp-usage-month-chart__tooltip` and the elements
  `pp-usage-chart svg` and `pp-usage-month-chart svg` (plan 7).
- Produces: `npm run perf`, and a report at `$PEAKPOWER_PERF_REPORT` (default
  `/tmp/peakpower-loadtest/perf-report.txt`).

- [ ] **Step 1: Write the configuration and the tsconfig**

Create `/Users/thinhhuynh/PeakPower/peakpower-web/playwright.perf.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

/**
 * The performance run — design §7.24, `[NFR-03]` and `[NFR-04]`.
 *
 * A SECOND CONFIGURATION, and every difference from `playwright.config.ts` is deliberate.
 *
 * NO `webServer`. The existing config starts two `ng serve` dev servers; a latency figure measured
 * against one of those measures the dev server — unminified bundles, no build optimisation, and a
 * proxy hop between the browser and the API. This run drives the BUILT portal the customer API
 * serves (`[DEC-136]`), on the throwaway stack `tools/load-test-dataset.sh` leaves up, and starts
 * nothing.
 *
 * `testDir: './perf'` rather than `./e2e`, so `npm test` and `npm run e2e` are untouched by this
 * file and this file is untouched by them.
 *
 * `workers: 1` and `fullyParallel: false` because a second browser on the same machine is load,
 * and this run is measuring the machine.
 *
 * `retries: 0` because a retried performance measurement is a best-of-two, which is not a
 * measurement. The spec takes five warm samples and asserts their MEDIAN; that is where the
 * tolerance for a noisy runner belongs, in the open.
 *
 * `trace: 'off'` — tracing instruments the browser and costs milliseconds this run is counting.
 */
export default defineConfig({
  testDir: './perf',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env['PEAKPOWER_PERF_BASE_URL'] ?? 'http://localhost:5201',
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

Create `/Users/thinhhuynh/PeakPower/peakpower-web/perf/tsconfig.json`:

```json
{
  "//": "Playwright transpiles without type-checking, so `npx tsc -p perf` is the only thing that reads this. Deliberately not wired into `npm test`, for the same reason e2e/tsconfig.json is not: that suite must run without a browser download.",
  "compilerOptions": {
    "strict": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "target": "ES2022",
    "module": "preserve",
    "moduleResolution": "bundler",
    "types": ["node"],
    "lib": ["ES2022", "DOM"],
    "noEmit": true
  },
  "include": ["**/*.ts", "../playwright.perf.config.ts"]
}
```

⚠ **`lib` gains `DOM`**, which `e2e/tsconfig.json` does not need: the measurement runs inside
`page.evaluate`, so this directory contains real browser code and `MouseEvent`,
`requestAnimationFrame` and `document` have to type-check.

- [ ] **Step 2: Write the measurement fixture**

Create `/Users/thinhhuynh/PeakPower/peakpower-web/perf/fixtures/measure.ts`:

```ts
import type { Page } from '@playwright/test';

/**
 * What the performance run needs from the outside world, and the reason it refuses to guess any
 * of it.
 *
 * `tools/load-test-dataset.sh` in `peakpower-platform` writes every one of these into
 * `/tmp/peakpower-loadtest/perf.env` after the dataset has finished draining. A default here would
 * be a run that silently measured the wrong day, or an empty one — and an empty day renders the
 * empty state, which has no chart, no tooltip, and nothing to time.
 */
export interface PerfEnvironment {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  /** yyyy-MM-dd — a day the dataset covers, and the newest complete one. */
  readonly date: string;
  /** yyyy-MM — a calendar month the dataset covers in full. */
  readonly month: string;
  /** One metering point: the ordinary case a customer with one connection sees. */
  readonly pointId: string;
  /** Every metering point the customer holds, comma-joined: the selector's "all". */
  readonly allPointIds: readonly string[];
  /** Where to write the numbers, so the acceptance record can quote a file rather than a scroll. */
  readonly reportPath: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `${name} is not set. The performance run reads the dataset it is measuring from the `
      + 'environment, because a default would be a run that measured the wrong day — or an empty '
      + 'one, which renders the empty state and has no chart to time. Build the dataset with '
      + '`tools/load-test-dataset.sh --keep` in peakpower-platform, then '
      + '`set -a && . /tmp/peakpower-loadtest/perf.env && set +a`.',
    );
  }
  return value.trim();
}

export function perfEnvironment(): PerfEnvironment {
  const all = required('PEAKPOWER_PERF_ALL_POINT_IDS').split(',').map((id) => id.trim());
  return {
    baseUrl: required('PEAKPOWER_PERF_BASE_URL'),
    username: required('PEAKPOWER_PERF_USERNAME'),
    password: required('PEAKPOWER_PERF_PASSWORD'),
    date: required('PEAKPOWER_PERF_DATE'),
    month: required('PEAKPOWER_PERF_MONTH'),
    pointId: required('PEAKPOWER_PERF_POINT_ID'),
    allPointIds: all,
    reportPath: process.env['PEAKPOWER_PERF_REPORT'] ?? '/tmp/peakpower-loadtest/perf-report.txt',
  };
}

/**
 * Signs in through the real form, once per run.
 *
 * The access token is held in memory only (`[DEC-117]`), so every `page.goto` below re-obtains one
 * from the refresh cookie. That is not a detour around the measurement — it is part of what a
 * customer pays on a page load, and `[NFR-03]` is measured on what a customer pays.
 */
export async function signIn(page: Page, env: PerfEnvironment): Promise<void> {
  await page.goto('/sign-in');
  await page.locator('#username').fill(env.username);
  await page.locator('#password').fill(env.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard$/);
}

/**
 * Milliseconds from the start of a navigation to the first hover that gets an answer.
 *
 * THE CLOCK IS THE PAGE'S. `performance.now()` inside the document counts from
 * `performance.timeOrigin`, which the browser sets at the start of the navigation that created
 * that document — so the figure needs no subtraction, no Playwright-side timestamp, and carries no
 * process-boundary skew.
 *
 * THE HOVER IS A REAL HOVER. `PpUsageChart.onPointerMove` reads `event.currentTarget` and
 * `event.clientX` off a `mousemove` on its own `<svg>`, so that is exactly what is dispatched, at
 * the centre of the plot. Polling every animation frame from the moment the element has a non-zero
 * width means the answer is the EARLIEST moment a customer moving the mouse onto the chart would
 * have seen a number, which is what "responds to its first hover" means.
 *
 * ⚠ IT RETURNS NaN RATHER THAN A NUMBER ON TIMEOUT, and the caller throws. A performance test that
 * measures nothing passes fastest of all; if the selector is wrong, or the day has no data and the
 * empty state replaced the chart, the honest outcome is a failure that names the selector.
 */
export async function measureFirstHover(
  page: Page,
  url: string,
  chartSelector: string,
  tooltipSelector: string,
): Promise<number> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const milliseconds = await page.evaluate(
    async ({ chart, tooltip }) => {
      const deadline = performance.now() + 30_000;
      const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

      for (;;) {
        const svg = document.querySelector(`${chart} svg`);
        if (svg !== null) {
          const box = svg.getBoundingClientRect();
          if (box.width > 0 && box.height > 0) {
            svg.dispatchEvent(
              new MouseEvent('mousemove', {
                bubbles: true,
                clientX: box.left + box.width / 2,
                clientY: box.top + box.height / 2,
              }),
            );

            // Two frames: one for the signal write to schedule change detection, one for the DOM
            // it produces to exist. One frame is enough on a fast machine and is a race on a
            // loaded runner, which would show up as a millisecond or two of extra latency
            // attributed to the chart.
            await frame();
            await frame();

            if (document.querySelector(tooltip) !== null) {
              return performance.now();
            }
          }
        }

        if (performance.now() > deadline) return Number.NaN;
        await frame();
      }
    },
    { chart: chartSelector, tooltip: tooltipSelector },
  );

  if (Number.isNaN(milliseconds)) {
    throw new Error(
      `${chartSelector} never answered a hover in 30000 ms at ${url}. Either `
      + `${tooltipSelector} is not the class the component renders, or the range holds no data and `
      + 'the empty state replaced the chart. This is NOT a slow measurement — it is no measurement.',
    );
  }

  return milliseconds;
}

export function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/**
 * One measurement: a cold load, then five warm ones.
 *
 * "Warm" is design §7.24's word and it means the SECOND load — the HTTP cache holds the bundle and
 * the lazy `/consumption` chunk, the server's plan cache holds the query, and the operating system
 * holds the pages the index walked. Five samples and a median rather than one, because a single
 * warm sample on a shared CI runner is a coin toss; the median is where the tolerance for that
 * lives, in the open, rather than in a threshold quietly raised to fit.
 */
export async function coldAndWarm(
  page: Page,
  url: string,
  chartSelector: string,
  tooltipSelector: string,
): Promise<{ cold: number; warm: number[]; warmMedian: number }> {
  const cold = await measureFirstHover(page, url, chartSelector, tooltipSelector);

  const warm: number[] = [];
  for (let i = 0; i < 5; i++) {
    warm.push(await measureFirstHover(page, url, chartSelector, tooltipSelector));
  }

  return { cold, warm, warmMedian: median(warm) };
}
```

- [ ] **Step 3: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-web/perf/consumption-performance.spec.ts`:

```ts
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { expect, test } from '@playwright/test';

import { coldAndWarm, perfEnvironment, signIn } from './fixtures/measure';

/**
 * `[NFR-03]` and `[NFR-04]`, measured rather than asserted.
 *
 * Read off the register today (`specs/20-architecture/08-non-functional-requirements.md:26-27`):
 *
 *   NFR-03  Consumption DAY view interactive within    1.5 s warm, 3 s cold
 *   NFR-04  Consumption MONTH view interactive within  2 s
 *
 * ⚠ NFR-03 is the DAY view and NFR-04 is the MONTH view. An earlier draft of the slice design
 * attributed both to NFR-03. NFR-04 states no cold figure, so nothing here asserts one for the
 * month.
 *
 * WHAT THE STACK BEHIND THIS IS. `tools/load-test-dataset.sh --keep` in `peakpower-platform`: a
 * throwaway Compose project holding a hundred connections and 365 days of readings that arrived
 * over the real webhook, with the customer API serving the BUILT portal on 5201. Not `ng serve`,
 * and not `./dev-up`.
 */

const env = perfEnvironment();

// milliseconds
const DAY_WARM = 1_500;   // NFR-03
const DAY_COLD = 3_000;   // NFR-03
const MONTH_WARM = 2_000; // NFR-04

const lines: string[] = [];

function record(label: string, result: { cold: number; warm: number[]; warmMedian: number }): void {
  const warm = result.warm.map((n) => Math.round(n)).join(', ');
  lines.push(
    `${label.padEnd(34)} cold ${Math.round(result.cold).toString().padStart(6)} ms   `
    + `warm median ${Math.round(result.warmMedian).toString().padStart(6)} ms   [${warm}]`,
  );
  // Also on stdout, so a failing run says what it measured before it says it was too slow.
  process.stdout.write(`${lines[lines.length - 1]}\n`);
}

test.beforeAll(() => {
  mkdirSync(dirname(env.reportPath), { recursive: true });
  writeFileSync(
    env.reportPath,
    [
      `PeakPower slice 2 performance run, ${new Date().toISOString()}`,
      `  base URL   ${env.baseUrl}`,
      `  date       ${env.date}`,
      `  month      ${env.month}`,
      `  points     1 and ${env.allPointIds.length}`,
      `  targets    NFR-03 day ${DAY_WARM} ms warm / ${DAY_COLD} ms cold · NFR-04 month ${MONTH_WARM} ms warm`,
      '',
    ].join('\n'),
    'utf8',
  );
});

test.afterAll(() => {
  appendFileSync(env.reportPath, `${lines.join('\n')}\n`, 'utf8');
});

test.describe.configure({ mode: 'serial' });

test('the day view answers its first hover inside NFR-03, for one connection', async ({ page }) => {
  await signIn(page, env);

  const url = `/consumption?view=day&date=${env.date}&points=${env.pointId}`;
  const result = await coldAndWarm(page, url, 'pp-usage-chart', '.pp-usage-chart__tooltip');
  record('day, one connection', result);

  expect(result.warmMedian, `NFR-03 warm: ${Math.round(result.warmMedian)} ms`)
    .toBeLessThanOrEqual(DAY_WARM);
  expect(result.cold, `NFR-03 cold: ${Math.round(result.cold)} ms`)
    .toBeLessThanOrEqual(DAY_COLD);
});

test('the day view answers its first hover inside NFR-03, for every connection', async ({ page }) => {
  await signIn(page, env);

  // The selector offers "all", so this is not an unusual thing for a customer to do — it is one
  // click. NFR-03 carves out no exception for a multi-point selection, so neither does this.
  const url = `/consumption?view=day&date=${env.date}&points=${env.allPointIds.join(',')}`;
  const result = await coldAndWarm(page, url, 'pp-usage-chart', '.pp-usage-chart__tooltip');
  record(`day, ${env.allPointIds.length} connections`, result);

  expect(result.warmMedian, `NFR-03 warm: ${Math.round(result.warmMedian)} ms`)
    .toBeLessThanOrEqual(DAY_WARM);
  expect(result.cold, `NFR-03 cold: ${Math.round(result.cold)} ms`)
    .toBeLessThanOrEqual(DAY_COLD);
});

test('the month view answers its first hover inside NFR-04, for one connection', async ({ page }) => {
  await signIn(page, env);

  const url = `/consumption?view=month&month=${env.month}&points=${env.pointId}`;
  const result = await coldAndWarm(
    page, url, 'pp-usage-month-chart', '.pp-usage-month-chart__tooltip');
  record('month, one connection', result);

  expect(result.warmMedian, `NFR-04 warm: ${Math.round(result.warmMedian)} ms`)
    .toBeLessThanOrEqual(MONTH_WARM);
});

test('the month view answers its first hover inside NFR-04, for every connection', async ({ page }) => {
  await signIn(page, env);

  const url = `/consumption?view=month&month=${env.month}&points=${env.allPointIds.join(',')}`;
  const result = await coldAndWarm(
    page, url, 'pp-usage-month-chart', '.pp-usage-month-chart__tooltip');
  record(`month, ${env.allPointIds.length} connections`, result);

  expect(result.warmMedian, `NFR-04 warm: ${Math.round(result.warmMedian)} ms`)
    .toBeLessThanOrEqual(MONTH_WARM);
});

test('the dataset behind the measurement is the one the report claims', async ({ page }) => {
  // A performance number is only worth the dataset under it. This reads the day envelope directly
  // and asserts it is a real, populated 96-interval day for every selected connection — so a run
  // that was fast because the API answered an empty array fails here rather than passing above.
  await signIn(page, env);

  const response = await page.request.get(
    `/api/v1/consumption/day?date=${env.date}`
    + env.allPointIds.map((id) => `&meteringPointIds=${id}`).join(''),
  );
  expect(response.status()).toBe(200);

  const body = (await response.json()) as {
    intervalCount: number;
    intervals: unknown[];
    dataState: string;
  };

  expect(body.intervalCount).toBe(96);
  expect(body.intervals.length).toBe(96);
  expect(['PROVISIONAL', 'FINAL']).toContain(body.dataState);

  lines.push(
    `dataset check                      ${body.intervals.length} intervals, `
    + `dataState ${body.dataState}, ${env.allPointIds.length} connections aggregated`,
  );
});
```

⚠ **The last test is not padding.** Four latency assertions that pass because the API returned an
empty `intervals` array would be four green ticks over nothing. This one reads the envelope and
requires ninety-six intervals and a data state that is not `NO_DATA`.

⚠ **`intervalCount` is 96 because `tools/load-test-dataset.sh` picks the day before yesterday**,
which is a DST Sunday only twice a year. If the run happens on the Tuesday after a transition,
this assertion fails honestly and the fix is to pass a different `PEAKPOWER_PERF_DATE` — not to
loosen the assertion to "92, 96 or 100", which would let an empty day through as easily.

- [ ] **Step 4: Add the script**

In `/Users/thinhhuynh/PeakPower/peakpower-web/package.json`, after `"e2e:ui"`:

```json
    "perf": "playwright test --config playwright.perf.config.ts"
```

⚠ **Do not add it to `test`.** `npm test` must keep running without a browser download and without
a database; the perf run needs a four-container stack and an hour of dataset behind it.

- [ ] **Step 5: Run it and watch it fail — with no dataset**

Run, with none of the environment set:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npm run perf
```

Expected: **FAIL immediately**, before a browser opens, with

```
Error: PEAKPOWER_PERF_ALL_POINT_IDS is not set. The performance run reads the dataset it is
measuring from the environment, because a default would be a run that measured the wrong day — or
an empty one, which renders the empty state and has no chart to time. Build the dataset with
`tools/load-test-dataset.sh --keep` in peakpower-platform, then
`set -a && . /tmp/peakpower-loadtest/perf.env && set +a`.
```

That is the first thing this test must get right: refusing to guess.

- [ ] **Step 6: Verify the measurement by mutation — break the selector**

This is the mutation that matters, and it is the one design §7.24 implies without saying: a
performance test that measures nothing is the fastest test in the suite.

With task 4's stack still up, run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
set -a && . /tmp/peakpower-loadtest/perf.env && set +a
sed -i '' "s/pp-usage-chart__tooltip'/pp-usage-chart__tooltipp'/" perf/consumption-performance.spec.ts
npm run perf
```

Expected: **FAIL**, after thirty seconds per attempt, with

```
Error: pp-usage-chart never answered a hover in 30000 ms at /consumption?view=day&date=…
Either .pp-usage-chart__tooltipp is not the class the component renders, or the range holds no data
and the empty state replaced the chart. This is NOT a slow measurement — it is no measurement.
```

⚠ **Predict this before running it, and check the prediction.** The wrong outcome here is a
*passing* run with a small number, which is what would happen if the fixture returned `0` or the
elapsed time so far instead of `NaN`. Restore the selector:

```bash
sed -i '' "s/pp-usage-chart__tooltipp'/pp-usage-chart__tooltip'/" perf/consumption-performance.spec.ts
```

- [ ] **Step 7: Verify the threshold by mutation — assert the cold figure against the warm budget**

The other half of the assertion is that "warm" and "cold" are two different things and the test
knows which is which. Temporarily change the first test's second expectation to use the warm budget:

```ts
  expect(result.cold, `NFR-03 cold: ${Math.round(result.cold)} ms`)
    .toBeLessThanOrEqual(DAY_WARM);
```

Run: `npm run perf -- --grep "one connection"`

Expected: **FAIL**, with a message naming a real millisecond figure above 1 500 — e.g.
`NFR-03 cold: 2140 ms · expected 2140 to be less than or equal to 1500`. If it *passes*, the cold
load is genuinely under the warm budget, which means the "cold" load was not cold: check that
`coldAndWarm` is called on a **fresh** page context per test rather than reusing a warmed one, and
that `trace` really is off. Restore `DAY_COLD`.

- [ ] **Step 8: Run it for real, and record the numbers**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
set -a && . /tmp/peakpower-loadtest/perf.env && set +a
npm run perf 2>&1 | tee /tmp/peakpower-loadtest/perf-run.log
cat /tmp/peakpower-loadtest/perf-report.txt
```

Expected: five passed, zero skipped, and a report of the shape

```
PeakPower slice 2 performance run, 2026-09-07T…Z
  base URL   http://localhost:5201
  date       2026-09-05
  month      2026-08
  points     1 and 106
  targets    NFR-03 day 1500 ms warm / 3000 ms cold · NFR-04 month 2000 ms warm

day, one connection                cold   1980 ms   warm median    640 ms   [612, 631, 640, 659, 704]
day, 106 connections               cold   2410 ms   warm median   1090 ms   [1002, 1061, 1090, 1122, 1188]
month, one connection              cold   1770 ms   warm median    520 ms   [498, 511, 520, 534, 561]
month, 106 connections             cold   2020 ms   warm median    880 ms   [841, 866, 880, 903, 947]
dataset check                      96 intervals, dataState PROVISIONAL, 106 connections aggregated
```

⚠ **Those figures are the shape of the output, not a prediction.** Copy the ones your run produces
into the acceptance record in task 11, alongside the runner they were measured on.

⚠ **If the 106-connection day view exceeds 1 500 ms, that is a finding and not a threshold to
relax.** `[NFR-03]` carves out no exception for a multi-point selection and the selector offers
"all" in one click. Record it in the acceptance record as an NFR-03 breach, and try, in order:
(a) confirm `ix_dp_customer` and `ix_reading_customer` are being used —
`EXPLAIN (ANALYZE, BUFFERS)` the day query on the throwaway stack; (b) confirm the aggregate is
summed in SQL rather than in memory over 106 × 96 rows. Only after both, and with numbers, is it a
conversation about the requirement rather than about the code.

- [ ] **Step 9: Type-check and commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx tsc -p perf
npm test        # unchanged: the perf directory is outside e2e and outside every ng test project
git add playwright.perf.config.ts perf package.json
git commit -m "test(perf): NFR-03 and NFR-04, measured in headless Chrome

Design section 7.24 asks for a checked-in performance test that measures the day view's first hover
within 1.5 s of navigation on a warmed cache, and the month view within 2 s. This is it.

The clock is the PAGE's: performance.now() inside the document counts from timeOrigin, which the
browser sets at the start of the navigation that created it, so the figure needs no subtraction and
carries no process-boundary skew. The hover is a real mousemove on the chart's own svg, dispatched
every animation frame from the moment that element has a width, and the measurement is the frame on
which the tooltip first exists - the earliest moment a customer would have seen a number.

A second Playwright configuration rather than a project inside the existing one, because that one
starts two ng serve dev servers and a latency figure measured against a dev server measures the dev
server. This drives the BUILT portal the customer API serves, on the throwaway stack
tools/load-test-dataset.sh leaves up.

Cold once, warm five times, assert the median: one warm sample on a shared runner is a coin toss,
and the tolerance for that belongs in the open rather than in a threshold quietly raised to fit.

Verified by mutation twice. The tooltip selector broken - the run fails naming the selector after
thirty seconds rather than reporting a small number, because a performance test that measures
nothing passes fastest of all. And the cold figure asserted against the warm budget - it fails with
a real millisecond figure, which is how the two are shown to be different measurements.

NFR-03 is the day view and NFR-04 is the month view; NFR-04 states no cold figure and none is
asserted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: the load-test workflow — on the runner, on demand and once a week

Design §7.24 says *"on the CI runner"*, and a measurement taken once on a laptop is an anecdote. It
is deliberately **not** part of `ci.yml`: an hour of dataset building on every push would make the
deploy gate unusable, and `[NFR-03]` is a property of the system rather than of a commit.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/.github/workflows/load-test.yml`

**Interfaces:**
- Consumes: `tools/load-test-dataset.sh` (task 4), `npm run perf` in `peakpower-web` (task 5), and
  the `CROSS_REPO_READ_TOKEN` secret plan 1's prerequisites created.
- Produces: a `Load test` workflow, dispatchable and scheduled, that uploads
  `perf-report.txt`, `dataset.txt` and `post.log` as an artefact.

- [ ] **Step 1: Write the workflow**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/.github/workflows/load-test.yml`:

```yaml
# The 100-EAN x 365-day load test - design section 5 step 12, section 7.24, NFR-03 and NFR-04.
#
# NOT ON PUSH, AND NOT PART OF ci.yml. Building the dataset is fifty-one thousand POSTs and roughly
# an hour; running it on every push would make the deploy gate unusable, and NFR-03 is a property
# of the system rather than of a commit. Dispatch it when the read path changes, and once a week
# so a regression has a ceiling on how long it can hide.
#
# EVERYTHING ON ONE RUNNER, on purpose. Postgres, the migrator, the customer API, the Worker and
# the browser all run here, so the figure includes the database, the API, the network hop and the
# render, and includes no wide-area latency. It also means the figure is only as good as the
# runner, which is why the job prints nproc, free -m and uname into the log and the report.
name: Load test

on:
  workflow_dispatch:
  schedule:
    # 02:40 UTC on Sundays. Off the hour because every scheduled workflow on GitHub is on the hour.
    - cron: "40 2 * * 0"

permissions:
  contents: read

jobs:
  load-test:
    name: 100 EANs x 365 days, then NFR-03 and NFR-04
    runs-on: ubuntu-latest
    timeout-minutes: 180

    steps:
      - name: Check out peakpower-platform
        uses: actions/checkout@v4
        with:
          path: peakpower-platform

      # The Docker build context spans both repositories - deploy/Dockerfile copies from
      # peakpower-platform/ and peakpower-web/ by name - and the perf spec lives in the second one.
      - name: Check out peakpower-web
        uses: actions/checkout@v4
        with:
          repository: peakpower-nl/peakpower-web
          token: ${{ secrets.CROSS_REPO_READ_TOKEN }}
          path: peakpower-web

      - name: What this was measured on
        run: |
          uname -srm
          nproc
          free -m
          docker --version
          docker compose version

      - name: Set up .NET
        uses: actions/setup-dotnet@v4
        with:
          global-json-file: peakpower-platform/global.json

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version-file: peakpower-web/.nvmrc
          cache: npm
          cache-dependency-path: peakpower-web/package-lock.json

      - name: Install the web workspace
        working-directory: peakpower-web
        run: |
          npm ci
          npx playwright install --with-deps chromium

      # Roughly an hour: four images built from source, a hundred metering points inserted, 51 100
      # documents posted over the real webhook, then a wait for metering.inbound_message to drain.
      # --keep leaves the stack up for the step after this one.
      - name: Build the dataset
        working-directory: peakpower-platform
        run: tools/load-test-dataset.sh --keep

      - name: Measure NFR-03 and NFR-04
        working-directory: peakpower-web
        run: |
          set -a
          . /tmp/peakpower-loadtest/perf.env
          set +a
          npm run perf

      # if: always() - a failed measurement is exactly the run whose numbers somebody needs.
      - name: Upload the figures
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: load-test-${{ github.run_number }}
          path: |
            /tmp/peakpower-loadtest/perf-report.txt
            /tmp/peakpower-loadtest/dataset.txt
            /tmp/peakpower-loadtest/post.log
          if-no-files-found: warn

      - name: Tear the throwaway stack down
        if: always()
        working-directory: peakpower-platform
        run: |
          docker compose -p peakpower-loadtest \
            -f deploy/docker-compose.yaml -f deploy/docker-compose.loadtest.yaml \
            --env-file deploy/.env.loadtest down --volumes || true
```

⚠ **`node-version-file: peakpower-web/.nvmrc`** — if that file does not exist in `peakpower-web`,
plan 1 task 3's `ci.yml` will have pinned the Node version some other way. Read that workflow and
use the **same** mechanism here; two workflows pinning Node differently is a measurement taken on a
runtime the test suite never used.

⚠ **`tools/load-test-dataset.sh` uses `sed`-free GNU `date` on the runner and BSD `date` on
macOS**, and it already handles both (`date -d … || date -v-2d …`). Nothing in this workflow needs
a platform switch.

- [ ] **Step 2: Dispatch it and watch it fail — on a branch, with the dataset script removed**

The failure worth proving here is that the workflow does not report success without a measurement.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git checkout -b load-test-proof
git rm --cached tools/load-test-dataset.sh > /dev/null && mv tools/load-test-dataset.sh /tmp/
git add -A && git commit -m "TEMPORARY: prove the load-test workflow cannot pass without a dataset"
git push -u origin load-test-proof
gh workflow run "Load test" --ref load-test-proof
sleep 15
gh run list --workflow="Load test" --branch=load-test-proof --limit 1
```

Expected: the run **fails** at `Build the dataset` with
`tools/load-test-dataset.sh: No such file or directory`, and `Measure NFR-03 and NFR-04` is
**skipped** — not run against an empty database.

⚠ Watch the artefact step too. It runs (`if: always()`) and must warn that it found no files rather
than uploading an empty report somebody could later mistake for a passing measurement.

Restore and delete the branch:

```bash
mv /tmp/load-test-dataset.sh tools/ && chmod +x tools/load-test-dataset.sh
git checkout main && git branch -D load-test-proof && git push origin --delete load-test-proof
```

- [ ] **Step 3: Dispatch it for real**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add .github/workflows/load-test.yml
git commit -m "ci: the 100-EAN x 365-day load test, on demand and weekly

Design section 7.24 asks for NFR-03 and NFR-04 measured in headless Chrome ON THE CI RUNNER, and a
measurement taken once on a laptop is an anecdote. Deliberately not part of ci.yml: an hour of
dataset building on every push would make the deploy gate unusable, and NFR-03 is a property of the
system rather than of a commit.

Everything on one runner - Postgres, the migrator, the customer API, the Worker and the browser -
so the figure includes the database, the API, the hop and the render and excludes wide-area
latency. nproc, free -m and uname go into the log, because a latency number without the machine it
was measured on is not a measurement.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
gh workflow run "Load test"
gh run watch
```

Expected: green, in 60–110 minutes, with an artefact named `load-test-<n>` holding
`perf-report.txt`, `dataset.txt` and `post.log`.

- [ ] **Step 4: Keep the runner's figures**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
gh run download --name "load-test-$(gh run list --workflow='Load test' --limit 1 --json number --jq '.[0].number')" --dir /tmp/load-test-ci
cat /tmp/load-test-ci/perf-report.txt /tmp/load-test-ci/dataset.txt
```

These are the numbers task 11 quotes for design §7.24, together with the `uname -srm` / `nproc` /
`free -m` lines from the `What this was measured on` step. **The laptop figures from task 5 step 8
do not go in the acceptance record** — they were useful for finding the mutations and they were not
measured on the runner design §7.24 names.

---

### Task 7: the Compose stack comes up on the VM

Design §5 step 12's "independently testable by" opens with *"The compose stack comes up on the VM"*.
This task does that once by hand, following the runbook task 1 rewrote — which is the only way to
find out whether the runbook is right — and then hands the box to the deploy workflow.

⚠ **The tree may not exist yet.** Design §8's fifth risk row records that the deploy workflows
landed on 2026-09-07 and *"nothing had been deployed then"*. If `$HOME/peakpower` is already there,
skip to step 3.

**Files:** none in either repository. This task changes a server.

**Interfaces:**
- Consumes: `DEPLOYING.md` as rewritten in task 1, `deploy/docker-compose.yaml` as regenerated by
  plan 1, `deploy/env.example` including plan 1's `BRP_CREDENTIAL_PVNED`.
- Produces: a running stack on the VM, and the Worker's published port, which task 8 posts at.

- [ ] **Step 1: Follow the rewritten runbook, and treat every surprise as a defect in it**

SSH to the box and work through `DEPLOYING.md` sections 1–5 exactly as written. The clone step is
now:

```bash
mkdir -p "$HOME/peakpower"
cd "$HOME/peakpower"
git clone git@github-peakpower-platform:peakpower-nl/peakpower-platform.git peakpower-platform
git clone git@github-peakpower-web:peakpower-nl/peakpower-web.git peakpower-web
```

⚠ **The two directory names are not free.** `docker-compose.yaml` names the Dockerfile as
`peakpower-platform/deploy/Dockerfile` relative to the parent, and the Dockerfile copies from
`peakpower-platform/` and `peakpower-web/` by name. Cloning under different names fails
immediately with `failed to read dockerfile`.

⚠ **Every step of the runbook that does not work is a bug in the runbook and is fixed in the
runbook**, in the same commit series as task 1 — not worked around in the terminal. That is the
whole point of doing this by hand once.

- [ ] **Step 2: Fill `.env`, including `BRP_CREDENTIAL_PVNED`**

```bash
cd "$HOME/peakpower/peakpower-platform/deploy"
cp env.example .env
chmod 600 .env
nano .env
```

Set, at minimum:

| Variable | Value |
| --- | --- |
| `POSTGRES_PASSWORD` | a fresh secret. ⚠ Postgres reads it only when the volume first initialises; changing it later is rejected on every connection for ever |
| `EMPLOYEE_DATABASE_PASSWORD` | **`dev_only_employee_password`** — the literal migration 2 creates the role with. `[OQ-102]`, still open |
| `CUSTOMER_PORTAL_BASE_URL` | this box's own origin, e.g. `http://<DEPLOY_HOST>:5101` |
| `BRP_CREDENTIAL_PVNED` | a fresh secret. **Task 8 posts with this exact value**, so copy it somewhere before closing the editor |
| `SEED_DEMO_COMPANIES` | `yes, seed demo companies with a published password` |
| `SEED_STAFF_ACCOUNTS` | `yes, seed the named staff accounts`, with the four `STAFF_PASSWORD_*` set |

⚠ **An empty `BRP_CREDENTIAL_PVNED` does not mean "no credential required".** Contract §9.3: the
Worker reads the variable at request time and an empty or absent value makes **every** request to
that BRP's route a `401`. That is fail-closed and it is deliberate — but it looks exactly like a
wrong credential, so set it now rather than debugging it in task 8.

- [ ] **Step 3: Bring it up**

```bash
cd "$HOME/peakpower/peakpower-platform/deploy"
docker compose up -d --build
docker compose ps -a
```

Expected, in order: `postgres` healthy, `migrator` **exited 0**, then `customer-api`,
`employee-api` and `worker` running.

⚠ If `migrator` exits non-zero, read `docker compose logs migrator` before anything else. Migration
9 is the first migration in this project's history to run against a database that already holds
data (design §8, fifth risk row), and **S2-D7** means there is no `Down()` to fall back to: the
recovery is redeploying the previous commit, and on a box whose data is regenerable by re-running
DevStubs that is an acceptable recovery rather than a comfortable one.

- [ ] **Step 4: Find the Worker's published port**

```bash
cd "$HOME/peakpower/peakpower-platform/deploy"
docker compose port worker 8080
docker compose port customer-api 8080
```

Expected: two `0.0.0.0:<port>` lines. Write both down — task 8 posts at the first and signs in at
the second.

⚠ **Do not assume 5103.** The published port is whatever plan 1's regenerated
`deploy/docker-compose.yaml` carries for the `worker` service; `docker compose port` is the only
statement of it that cannot be stale.

- [ ] **Step 5: Prove the webhook is reachable and fails closed**

Two curls, from a developer machine, before a single document is generated:

```bash
WORKER="http://<DEPLOY_HOST>:<worker port>"

# No credential at all -> 401, and NOT a 404 that would enumerate which BRPs exist.
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$WORKER/webhooks/brp/PVNED" --data-binary '<x/>'

# An unknown BRP code -> also 401, for the same reason (contract §9.4).
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$WORKER/webhooks/brp/NOTABRP" \
  -H "X-PeakPower-Brp-Credential: anything" --data-binary '<x/>'
```

Expected: `401` and `401`.

⚠ **A `404` on the first line means the Worker's routes are not mapped on the deployed image.** A
`200` means the credential check is not running — stop and fix that before task 8, because a
webhook that accepts anything is not a webhook that proves anything.

- [ ] **Step 6: Prove row-level security is real on the deployed database**

Design §7.14's second and third clauses need a database, not a test host, and this is the first one
that has ever existed. On the VM:

```bash
cd "$HOME/peakpower/peakpower-platform/deploy"

# As the CUSTOMER login role, with no app.customer_id set. Both must be refused.
docker compose exec -T -e PGPASSWORD=dev_only_app_password postgres \
  psql -U peakpower_app -d peakpower -c "SELECT count(*) FROM metering.inbound_message;"
docker compose exec -T -e PGPASSWORD=dev_only_app_password postgres \
  psql -U peakpower_app -d peakpower -c "INSERT INTO metering.interval_reading
    (version_id, delivery_date, customer_id, pos, interval_start, quantity_kwh)
    VALUES (gen_random_uuid(), CURRENT_DATE, gen_random_uuid(), 1, now(), 1);"

# Every partition of interval_reading has RLS enabled and both policies.
docker compose exec -T -e PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)" postgres \
  psql -U postgres -d peakpower -c "
    SELECT c.relname, c.relrowsecurity, count(p.polname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_policy p ON p.polrelid = c.oid
     WHERE n.nspname = 'metering' AND c.relname LIKE 'interval_reading%'
     GROUP BY 1, 2
     HAVING c.relrowsecurity IS NOT TRUE OR count(p.polname) <> 2;"
```

Expected: the first two commands both fail with
`ERROR:  permission denied for table …` (SQLSTATE `42501`), and the third returns **zero rows** —
every partition has RLS on and exactly two policies.

⚠ **The third query is written to return rows only on failure**, so "no rows" is the pass. A query
written the other way round would pass just as convincingly against an empty `pg_class`.

⚠ Contract §6.8: the `REVOKE`s are the whole protection here. A policy decides which **rows** a
command may touch; it cannot forbid the command. If the `INSERT` succeeds, the revokes did not run.

---

### Task 8: DevStubs against the **deployed** webhook, and a customer who sees their own day

This is design §5 step 12's "independently testable by", in full: *"The compose stack comes up on
the VM and, after DevStubs is run against the deployed webhook, a seeded customer signs in and sees
a populated day chart."*

⚠ **DevStubs is run from a developer machine, not from the VM.** Design §3.1 and contract §2 both
say it *"does not ship in the compose file"* and *"runs from a developer machine against the
deployed webhook with the same `BRP_CREDENTIAL_PVNED` value"*. That is not an inconvenience — it is
the demonstration. A generator that shipped inside the stack would be a code path with database
access, and `[F02-R30]` is the rule it would be tempting to break.

**Files:** none. This task runs a program and looks at a screen.

**Interfaces:**
- Consumes: the deployed Worker's URL and `BRP_CREDENTIAL_PVNED` from task 7; the `scenarios` and
  `backfill` verbs (plan 5); `DemoDataSeeder`'s Vandersteen Koeling B.V. and
  `j.devries@vandersteen.nl` / `correct-horse-battery`.
- Produces: a deployment holding ninety days of readings for the eleven seeded connections, and the
  evidence design §7.16 asks for.

- [ ] **Step 1: Run the fourteen scenarios at the deployed webhook**

From a developer machine, in `peakpower-platform`:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
export WORKER="http://<DEPLOY_HOST>:<worker port>"     # task 7 step 4
export BRP_CREDENTIAL_PVNED='<the value from the VM .env>'

DevStubs__WebhookBaseUri="$WORKER" \
  dotnet run --project src/Hosts/PeakPower.DevStubs -- scenarios \
  | tee /tmp/deployed-scenarios.log
```

Expected: fourteen scenario families reported, with `size-26mb` refused **413** and `size-25mb`
accepted **200**, and every `invalid-*` document answered **200** — a parser failure still returns
200 `[F02-R05]` and lands the message `FAILED`.

⚠ **`scenarios` is not gated.** Only `backfill`, `cadence` and `loadtest` are; the scenario suite
posts a bounded, known set and is the thing a developer runs to see whether the deployment works.

⚠ If everything answers **401**, the value in `BRP_CREDENTIAL_PVNED` on this machine and the value
in the VM's `.env` differ. Contract §9.3: the Worker reads
`Environment.GetEnvironmentVariable(brp.CredentialRef)` at request time, and the seeded
`credential_ref` is the literal string `BRP_CREDENTIAL_PVNED`.

- [ ] **Step 2: Confirm the deployed pipeline did what the scenarios say**

On the VM:

```bash
cd "$HOME/peakpower/peakpower-platform/deploy"
docker compose exec -T -e PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)" postgres \
  psql -U postgres -d peakpower -c "
    SELECT status, count(*) FROM metering.inbound_message GROUP BY 1 ORDER BY 1;"
docker compose exec -T -e PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)" postgres \
  psql -U postgres -d peakpower -c "
    SELECT reason, count(*) FROM metering.quarantined_series GROUP BY 1 ORDER BY 1;"
docker compose exec -T -e PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)" postgres \
  psql -U postgres -d peakpower -c "
    SELECT failure_code, count(*) FROM metering.inbound_message
      WHERE status = 'FAILED' GROUP BY 1 ORDER BY 2 DESC;"
```

Expected: `PROCESSED` and `FAILED` rows and **no** `RECEIVED` or `PROCESSING` left; `UNKNOWN_EAN`
and `WRONG_BRP` present in the quarantine table, from the `unknown-ean` and `wrong-brp` scenarios;
and **thirteen** distinct `failure_code` values from the `invalid-*` family — the eleven
integration-spec §8.2 rules plus `UNSUPPORTED_DIRECTION` and `UNSUPPORTED_MEASUREMENT_UNIT`
(contract §8.4).

⚠ Thirteen distinct codes is the number to check. Twelve means one `invalid-*` document is being
rejected for the wrong reason and the code it was meant to exercise is untested on the deployment.

- [ ] **Step 3: Backfill ninety days, so there is a chart to look at**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
DevStubs__Backfill="yes, post ninety days of generated documents to this webhook" \
DevStubs__WebhookBaseUri="$WORKER" \
BRP_CREDENTIAL_PVNED='<the value from the VM .env>' \
  dotnet run --project src/Hosts/PeakPower.DevStubs -- backfill \
  | tee /tmp/deployed-backfill.log
```

Expected: ninety days across the eleven seeded connections, every post **200**.

⚠ **Paste the phrase exactly.** `true`, `1`, `yes` and the cadence phrase are all refused, audibly,
with a message naming the phrase that would have worked — contract §13.2's whole point.

Then wait for the queue and check the rollup:

```bash
# on the VM
docker compose exec -T -e PGPASSWORD="$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)" postgres \
  psql -U postgres -d peakpower -c "
    SELECT (SELECT count(*) FROM metering.inbound_message WHERE status IN ('RECEIVED','PROCESSING')) AS queued,
           (SELECT count(*) FROM metering.interval_reading)      AS readings,
           (SELECT count(*) FROM metering.daily_position)        AS positions,
           (SELECT max(delivery_date) FROM metering.metering_point_day_state
             WHERE state <> 'NO_DATA')                           AS last_data_date;"
```

Expected: `queued` **0**, `readings` in the high hundreds of thousands, `positions` around
990 (eleven connections × ninety days), and a real `last_data_date`.

- [ ] **Step 4: A seeded customer signs in and sees a populated day chart**

In a browser, at the customer portal — `http://<DEPLOY_HOST>:<customer-api port>`:

1. Sign in as **`j.devries@vandersteen.nl`** with **`correct-horse-battery`**.
2. The rail's **Volume** row is a link, not a disabled row with a reason. Click it.
3. The day chart draws, on the most recent day with data, for the first of the six Vandersteen
   connections.

Check each of these on the screen, because this is the only place in the slice where they are all
true at once:

| What | Where it comes from |
| --- | --- |
| Three series, and the **net-usage** line is distinguishable from the other two with the colour removed | design §7.16; contract §11.3's stroke patterns — solid 2px, dashed `6 3`, dotted `2 3` |
| The **zero line** is drawn even where nothing crosses it | design §3.1 |
| **Gaps**, not zeros, wherever an interval is missing | contract §10.1, `[F03-R06]` |
| Hour ticks in **Amsterdam local time** | design §7.16 |
| Previous / next day, the date picker, and **jump to latest** all move the chart | `[F03-R07]`, `[F03-R09]`, `[F03-R21]` |
| The metering-point selector switches between **one, several and all** six connections | design §3.1 |
| A month bar **drills into its day** | `[F03-R09]` |
| The KPI strip shows three volume totals, each with its range's **data state** | design §7.18 |
| **Rotterdam DC** (`production_expectation = NEVER`) shows production as a **declared zero** naming its source, setter and date — not as a gap | `[F02-R33]`, `[F01-R40]`, contract §14 |
| **Almere office** (`EXPECTED`) shows a real production series | `DemoDataSeeder.cs:223-225` |
| The dashboard **no longer says** "There is no metering data yet, so this page has nothing to total" | design §7.19 |
| Connection detail shows a **date** rather than `No data yet — ingestion arrives in a later slice`, and a 14-day data-state strip | design §7.19 |

Take a screenshot of the day chart. It is the evidence for design §7.16 and §7.24's first clause,
and task 11 references it.

⚠ **If the Volume row is still disabled**, plan 7's three one-line edits to `customer-nav.ts` did
not all land: `ENABLED_ROUTE_KEYS` is read only by its own spec, and **`PATH` is what actually puts
the row on screen** (contract §11.6).

⚠ **If the chart is empty on the latest date**, the backfill's last day and `LastDataDate` disagree.
Step back one day; if that draws, the rollup for the final day has not run yet rather than the chart
being broken.

- [ ] **Step 5: An employee sees the same run from the other side**

At the employee portal — `http://<DEPLOY_HOST>:<employee-api port>` — sign in as one of the seeded
staff accounts and check design §7.20:

1. The **inbound message log**, filtered by BRP, shows the scenario run and the backfill.
2. The **quarantine panel** shows the `unknown-ean` and `wrong-brp` entries with their reason and
   age.
3. A connection's **21-day heat map** is drawn.
4. **Replay** one quarantined message after registering its EAN through the existing back office,
   and watch the entry resolve into readings. Replay it a **second** time and watch
   `versionsCreated` come back **0** with outcome `NO_CHANGE` — `[F02-R27]`, contract §10.4.

⚠ **The second replay is the assertion, not the first.** Replaying an already-processed message
producing no second version is what design §7.6 requires, and it is asserted by version count.

- [ ] **Step 6: Record what happened**

Save, into `/tmp/deployed-run/`:

- `deployed-scenarios.log` and `deployed-backfill.log` from steps 1 and 3;
- the four `psql` outputs from steps 2 and 3;
- the day-chart screenshot from step 4;
- the replay response body from step 5.

Task 11 quotes these. Nothing here is committed — a screenshot of a demo box is not repository
content — but the acceptance record names the file and the date, so a reader knows the evidence
exists and where.

---

### Task 9: "What this slice does not prove", written into the platform repository

Design §7.25: *"**A written note in the platform repo lists what this slice does NOT prove** (§9).
**`[R-01]` stays scored 20.**"* Design §9 gives the content and says why it has to exist as an
artefact rather than as a paragraph in a plan: *"because it is the honest counterweight to
everything above."*

This is where the slice's honesty is banked. It goes in `peakpower-platform` — beside the code, not
beside the specification — because the person most likely to over-read what the ingestion pipeline
proves is the next person to open that repository.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/docs/what-slice-2-does-not-prove.md`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-close-out.sh` — check 2
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/CLAUDE.md` — one pointer

**Interfaces:**
- Consumes: design §9, design §8's first two risk rows, contract §8.3's nine rows and §8.4's
  thirteen codes, `[OQ-05]`, `[OQ-20]`, `[OQ-65]`, `[R-01]`.
- Produces: `docs/what-slice-2-does-not-prove.md`, and check 2 of `tools/verify-close-out.sh`.

- [ ] **Step 1: Write the failing test first — check 2**

Append to `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-close-out.sh`, immediately
before the `if [[ $failures -gt 0 ]]` block:

```bash
# ── check 2: the honesty note ───────────────────────────────────────────────────────────────────
#
# Design §7.25 requires a written note in THIS repository listing what slice 2 does not prove, and
# design §9 lists the five things it has to say. A file that exists is easy; a file that still says
# all five after somebody has tidied it is what this checks.
#
# WHY A GUARD AT ALL. This note is the one artefact in the slice whose whole value is that it is
# uncomfortable. It has no test that fails when it is wrong, no consumer that breaks when it is
# deleted, and every incentive points at trimming it. So the five claims are pinned, by the
# shortest substring of each that cannot be true by accident.
note="$root/docs/what-slice-2-does-not-prove.md"

if [[ ! -f "$note" ]]; then
  fail "$note is missing. Design §7.25 requires it: a written note in the platform repo listing" \
       "what this slice does NOT prove."
else
  # Each entry is: a grep -F pattern, then the design §9 bullet it stands for.
  while IFS='|' read -r pattern subject; do
    [[ -z "$pattern" ]] && continue
    grep -qF -- "$pattern" "$note" \
      || fail "the note does not say $subject (looked for the literal '$pattern')"
  done <<'CLAIMS'
[R-01] stays scored 20|[R-01] stays scored 20
reconstructed|the XSD is reconstructed
nine|the nine integration-spec §9 guesses
[OQ-20]|that interval placement follows OQ-20's interim answer, not PVNed's confirmation
[OQ-05]|that the endpoint, authentication, acknowledgement and retry policy are OQ-05, unanswered
same team|that the generator and the parser share an author and a source document
no channel delivers|that alerting fires its conditions and delivers nothing
CLAIMS
fi
```

⚠ **Seven patterns for five bullets**, because two of design §9's bullets carry two claims each and
a note that dropped half of one would otherwise pass. The patterns are `grep -F` literals, not
regexes: a pattern that had to be escaped would be a pattern somebody would eventually escape wrong.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && tools/verify-close-out.sh`

Expected: **FAIL**, with

```
FAIL: /Users/thinhhuynh/PeakPower/peakpower-platform/docs/what-slice-2-does-not-prove.md is missing. Design §7.25 requires it: a written note in the platform repo listing what this slice does NOT prove.
verify-close-out: 1 check(s) failed
```

Check 1 stays green — it was made true in task 1.

- [ ] **Step 3: Write the note**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/docs/what-slice-2-does-not-prove.md`, with
exactly this content:

````markdown
# What PoC slice 2 does not prove

**Written:** 2026-09-07 · **Slice:** metering-data ingestion `[F02]` and consumption
visualisation `[F03]` · **Required by:** the slice design's §7.25, which asks for this file by name.

Slice 2 ingests PVNed-format `TimeSeriesDocument` messages over a real webhook, through a real
parser, a real validator and a real versioning pipeline, and puts the result on a chart. Everything
in that sentence is true. This file is about what it does **not** entitle anyone to conclude, and it
exists because the alternative — leaving the residual to be rediscovered by whoever meets it — is
how a proof of concept turns into a surprise.

The short version: **the pipeline is proven and the format is not.**

---

## 1. PVNed conformance is not proven

**The XSD is reconstructed.** PVNed never supplied a schema. The file this adapter validates
against is `TimeSeriesDocument-v2p0.reconstructed.xsd`, built from the integration specification's
own description and sample message, and its filename says `reconstructed` on purpose — a test
asserts that it does, so swapping in a real schema one day is a diff review rather than a silent
substitution.

**It encodes nine guesses.** The integration specification's §9 lists nine places where its own
documentation is inconsistent or silent. On every one of them this adapter takes the **permissive**
reading, `SchemaProvenance` records which reading was taken, and there is one test per row naming
the row and the reading. The nine:

| # | Field | The reading taken |
| --: | --- | --- |
| 1 | `DocumentIdentification` | Accept **36** characters. The guide says 35; a GUID does not fit in 35 |
| 2 | `Sender`/`ReceiverIdentification` | Validate as **13 digits**, accept up to 16 |
| 3 | `Pos` | Enforce the XSD bound `maxInclusive 100`, not the guide's "max 6 characters" |
| 4 | `Qty` maximum | **No hard cap.** Check plausibility against the metering point's capacity and **alert**; never reject |
| 5 | `MeasurementUnit` | Read it from the message and convert; **warn** when it is not the one the dependency table predicts |
| 6 | Annex A validations | Annex A describes the customer → PVNed direction and **does not apply** to inbound processing |
| 7 | `Period.TimeInterval` | `MeasurementPeriode` + `Pos` are authoritative; the discrepancy is **logged, never used** |
| 8 | `Qty2` | **Not used** by the platform |
| 9 | `CurveType` `A03` | **Rejected** — the XSD enumerates only `A01` |

Stricter than the real schema and this adapter rejects real documents; looser and it proves nothing.
There is no way to know which of those two it is until `[OQ-65]` — walk the nine with PVNed — has
been held. `[OQ-65]` is parked, its owner is PVNed, and **nobody inside the team is named as its
chaser**. It should be booked now rather than waited for: a third party's calendar has lead time,
and under `[DEC-69]` this adapter is the template every later BRP adapter is copied from, so a wrong
reading is propagated rather than merely used.

**Interval placement follows an interim answer, not a confirmation.** The supplied sample has
`Period.TimeInterval` spanning a month while `MeasurementPeriode` is one day, and the two cannot
both govern. `[OQ-20]` asks which does; it is open. This implementation follows the integration
specification's stated interim answer — `MeasurementPeriode` + `Pos` are authoritative and
`Period.TimeInterval` is logged as a discrepancy and never used to place a point — and that is a
reading of a document, not an answer from PVNed. An implementer who trusted `Period.TimeInterval`
would write a month's intervals to the wrong dates, and nothing would notice until an invoice did.
If `[OQ-20]` comes back the other way, every reading ingested under this slice is on the wrong day.

---

## 2. The wire contract is not proven — `[OQ-05]`

Nothing about how documents actually arrive from PVNed has ever been established. The generator
posts at an endpoint this platform chose, with an authentication mechanism this platform chose,
receives an acknowledgement this platform chose, and never exercises a retry, because there is
nothing on the other side to retry against.

| Aspect | Status |
| --- | --- |
| Endpoint URL | **Unknown.** `POST /webhooks/brp/{brpCode}` is this platform's shape. Under `[DEC-69]` it is per-BRP reference data, so pointing it at a real endpoint later is a data change |
| Authentication mechanism | **Unknown.** A shared-secret `X-PeakPower-Brp-Credential` header is this platform's choice; `[F02-R02]`/`[AS-16]` make the mechanism per-BRP precisely because it is not known |
| Acknowledgement form | **Unknown.** `[F02-R08]`'s SOAP acknowledgement is deferred rather than guessed — building one would be inventing a third party's wire format |
| Retry policy on non-2xx | **Unknown, and untested in both directions.** Nothing here has ever received a retry or issued one |
| A usable PVNed test environment | **Not established.** The original warning stands |

`[OQ-05]` is marked closed **for the proof of concept only**, under `[DEC-21]`, which sanctions
building against generated data. It is not closed for the real integration, and this slice does not
close it.

---

## 3. The generator and the parser were written by the same team, from the same source

This is the central evidence cost of demonstrating ingestion without a feed, and it cannot be
designed away. A shared misreading of the PVNed format passes every test in this slice and fails on
day one of the real integration.

Three deliberate breaks were put in the circle, and they are worth having:

1. **The generator emits templated XML *text* and never serialises the parser's own model**
   (S2-D4). `PeakPower.DevStubs` may not reference `PeakPower.Integration.Brp.Pvned` at all, so a
   shared type cannot hide a shared bug.
2. **Every negative fixture is hand-written and checked in** — one per integration-spec §8.2 rule,
   plus XXE and billion-laughs, plus the malformed envelope. None is generated.
3. **The golden positive document is transcribed by hand** from the integration specification's §6
   sample.

None of the three makes the evidence equivalent to a real feed. Both halves were written by the
**same team** from the **same** reconstructed source, and three breaks in one circle leave a circle.

**What is genuinely proven is the other half**, and it is the larger one: versioning, receipt-order
supersession, quarantine, completeness against a recorded production expectation, day states, the
per-interval offtake and export rollup, DST handling, tenancy and row-level security. None of that
depends on the PVNed format being right, because none of it knows what a PVNed document looks like.

---

## 4. Alerting fires its conditions and delivers nothing

Every alert condition in `[F02]` is built and tested: validation failure `[F02-R12]`, per-metering-
point silence `[F02-R26]`, production-expectation promotion `[F02-R34]`, a missing production
declaration `[F02-R35]`, and the informational notice to Finance on a post-window reconciliation
`[F02-R45]`. Each one writes a `metering.operational_alert` row, and the employee data-health
screens render them.

**No channel delivers any of them.** No mail, no pager, no webhook, and **no deliberate outage test
was run**. Somebody has to be looking at a screen.

That is a deliberate deferral rather than an omission — `[DEC-104]` is one operator with no rota,
and a notification channel with no rota behind it is decoration — but it has a consequence that is
easy to lose: the Phase-1 exit criterion *"ingestion alerting proven by a deliberate outage test"*
is **not met**, and this slice does not meet it.

---

## 5. `[R-01]` stays scored 20

`[R-01]` — *the BRP integration cannot be tested before production* — is **4 × 5 = 20**, joint
highest on the register with `[R-10]`. **Nothing in this slice lowers it.**

`[DEC-21]` changed the plan, not the exposure: the proof of concept ingests generated data in the
PVNed document format, which unblocks Phase 1 without a vendor dependency, and leaves the endpoint,
the authentication mechanism, the acknowledgement format, the retry behaviour and the nine
documentation inconsistencies exactly as unvalidated as they were. The score does not move. What
moves is the discovery, to a later and more expensive point in the plan.

Anyone tempted to re-score this row after reading a green test suite should read §3 above first.

---

## What would change each of these

| Section | What closes it |
| --: | --- |
| 1 | `[OQ-65]` walked with PVNed, and `[OQ-20]` answered. Both need PVNed in the room; neither has a chaser named inside the team |
| 2 | `[OQ-05]` answered, and a PVNed test environment that exists |
| 3 | One real document, from PVNed, through this parser. Nothing smaller |
| 4 | A channel, and `[DEC-104]`'s single operator becoming a rota — then a deliberate outage test |
| 5 | Sections 1 to 3, together. Not one of them |
````

- [ ] **Step 4: Run it and watch it pass**

Run: `cd /Users/thinhhuynh/PeakPower/peakpower-platform && tools/verify-close-out.sh`
Expected: PASS — `verify-close-out: OK`

- [ ] **Step 5: Verify check 2 by mutation — delete the `[R-01]` line**

The claim design §7.25 singles out is the score. Break exactly that: in
`docs/what-slice-2-does-not-prove.md`, change the §5 sentence

```markdown
`[R-01]` — *the BRP integration cannot be tested before production* — is **4 × 5 = 20**, joint
highest on the register with `[R-10]`. **Nothing in this slice lowers it.**
```

to

```markdown
`[R-01]` — *the BRP integration cannot be tested before production* — remains a live risk.
```

⚠ That also removes the heading's literal, so delete the `## 5. [R-01] stays scored 20` heading text
too — otherwise the mutation is caught by the heading and proves nothing about the body.

Run: `tools/verify-close-out.sh`

Expected: **FAIL**, with

```
FAIL: the note does not say [R-01] stays scored 20 (looked for the literal '[R-01] stays scored 20')
verify-close-out: 1 check(s) failed
```

Restore both, and re-run to green.

⚠ **Then mutate a second claim**, because one pattern passing proves one pattern. Delete the whole
of §4 and confirm the guard reports
`the note does not say that alerting fires its conditions and delivers nothing (looked for the
literal 'no channel delivers')`. Restore it.

- [ ] **Step 6: Point at it from `CLAUDE.md`**

A note nobody opens is a note nobody reads. In
`/Users/thinhhuynh/PeakPower/peakpower-platform/CLAUDE.md`, in the `## Layout` block's file list,
add one line:

```
docs/what-slice-2-does-not-prove.md   what the ingestion pipeline does NOT prove. Read before
                                      quoting a green suite as evidence about PVNed.
```

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add docs/what-slice-2-does-not-prove.md tools/verify-close-out.sh CLAUDE.md
git commit -m "docs: what slice 2 does not prove, and a guard that keeps it saying it

Design section 7.25 asks for a written note in THIS repository listing what the slice does not
prove, and section 9 lists the five things it has to say: the XSD is reconstructed and encodes nine
guesses, interval placement follows OQ-20's interim answer rather than PVNed's confirmation, the
endpoint / auth / acknowledgement / retry are OQ-05 and unanswered, the generator and the parser
share an author and a source document, alerting fires its conditions and delivers nothing, and
R-01 stays scored 20.

It lives beside the code rather than beside the specification because the person most likely to
over-read what a green ingestion suite proves is the next person to open this repository.

tools/verify-close-out.sh grows a second check. This note is the one artefact in the slice whose
whole value is that it is uncomfortable: it has no consumer that breaks when it is trimmed, and
every incentive points at trimming it. Seven grep -F literals for five bullets, because two bullets
carry two claims each. Verified by mutation twice - the R-01 score removed, and the whole alerting
section deleted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: the specification amendments — design §11 rows 4–8, and the ninth

Design §11 carries eight proposed specification changes. **Rows 1–3 are not this plan's** — they
are the recorded decision that settles `interval_data_version.source`, they land *before* migration
9 is written, and plan 2 task 1 owns them as `[DEC-143]`. This task lands rows **4–8**, plus the
**ninth** amendment contract §16 items 1, 2 and 9 ask for.

House style, from `[DEC-63]` onwards: **every reversal keeps the reversed text visible**,
struck through, with the decision that superseded it named beside it. Nothing here deletes a
sentence.

**Files:** *(all in the specification worktree)*
- Modify: `specs/70-delivery/01-roadmap-and-phasing.md` — §2.2, §3, §11, and the `[R-01]` phrase at `:249`
- Modify: `specs/70-delivery/02-risks.md` — `[R-01]`'s section and its register row
- Modify: `specs/80-open-questions.md:182` — `[OQ-65]`'s row
- Modify: `specs/30-integrations/01-pvned-timeseries.md:71-72`
- Modify: `specs/10-features/F02-metering-data-ingestion.md:211` — `[F02-R23]`
- Modify: `specs/00-overview/04-assumptions-and-decisions.md` — `[DEC-144]`
- Modify: `docs/superpowers/specs/2026-09-07-poc-slice-2-design.md` — §11 gains a ninth row
- Regenerate: `specs/site/content.js`

**Interfaces:**
- Consumes: `git log` in `peakpower-web` and in this repository — the commit hashes and times in
  row 6 are **verified before they are written**, not copied.
- Produces: one pull request against `peakpowerspecs`, and `[DEC-144]`.

⚠ **`[DEC-144]` is this plan's number and `[DEC-143]` is plan 2's.** The highest recorded decision
today is `[DEC-142]` (`specs/00-overview/04-assumptions-and-decisions.md:257`, the last line of the
file). Plan 2 takes 143 for the `interval_data_version.source` decision; this plan takes 144. If
plan 2 has not landed when this task runs, **stop and land it first** — it gates migration 9 and
therefore everything.

- [ ] **Step 1: Branch, and verify the commit hashes before writing any of them down**

```bash
cd /Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9
git checkout -b specs/poc-slice-2

# The roadmap commit that wrote §2.2.
git show -s --date=format:'%Y-%m-%d %H:%M' --pretty=format:'%h %ad %s' 39fd8d8

# The six fixes, in peakpower-web.
cd /Users/thinhhuynh/PeakPower/peakpower-web
for c in e476cf7 3a7726c bf1edc5 e0d5670 192ec9c 5f13bea; do
  git show -s --date=format:'%Y-%m-%d %H:%M' --pretty=format:'%h %ad %s%n' "$c"
done
```

Expected, and **check every line before continuing** — a plan that writes a wrong hash into a
specification has made the register worse rather than better:

```
39fd8d8 2026-09-03 10:32 Record DEC-113..119 and OQ-97..102, and correct the specification against what slice 1 actually built

e476cf7 2026-09-03 10:22 test(portal): a workspace guard for var(--pp-*), and the one reference it found
3a7726c 2026-09-03 10:26 feat(customer-portal): a field to paste the reset code into
bf1edc5 2026-09-03 10:29 fix(customer-portal): associate every validation message with its control
e0d5670 2026-09-03 10:37 fix(customer-portal): make the consent ticks and choice rows keyboard-operable
192ec9c 2026-09-03 10:45 feat(portal): a main landmark, a skip link, and one h1 on every screen
5f13bea 2026-09-03 10:51 fix(customer-portal): one error state for a load that fails, and three pages using it
```

⚠ **Read the times.** The roadmap section that lists these six as open was committed at **10:32**,
and three of the six were already fixed by then — 10:22, 10:26 and 10:29 — with the other three
landing within nineteen minutes of it. That is the fact row 6 records, and it is sharper than "they
have since been fixed": the section was **wrong when it was written**, by a margin of ten minutes,
because the two repositories were being worked on in parallel and neither knew what the other had
just done.

- [ ] **Step 2: Row 6 — correct roadmap §2.2**

In `specs/70-delivery/01-roadmap-and-phasing.md`, immediately after the six-row gap table (the
paragraph beginning "Items 2, 3 and 6 are cross-cutting by nature", currently at `:270-271`),
insert:

```markdown
> ⚠ **All six were closed on 2026-09-03, and three of them before this section was committed.**
> Corrected 2026-09-07, during PoC slice 2. The table above is kept rather than deleted, because a
> gap list that is quietly emptied stops being a record of what was found.
>
> | # | Gap | Closed by, in `peakpower-web` |
> | --: | --- | --- |
> | 1 | Consent and choice controls keyboard-unreachable | `e0d5670` 10:37 — *make the consent ticks and choice rows keyboard-operable* |
> | 2 | No skip link, no `<main>`, missing `<h1>` | `192ec9c` 10:45 — *a main landmark, a skip link, and one h1 on every screen* |
> | 3 | `aria-describedby` absent from the workspace | `bf1edc5` 10:29 — *associate every validation message with its control* |
> | 4 | No shared error-state treatment | `5f13bea` 10:51 — *one error state for a load that fails, and three pages using it* |
> | 5 | The reset-password flow cannot be completed by a human | `3a7726c` 10:26 — *a field to paste the reset code into* |
> | 6 | No workspace guard for `var(--pp-*)` tokens | `e476cf7` 10:22 — *a workspace guard for var(--pp-\*), and the one reference it found* |
>
> **This section was already out of date when it was committed.** It landed as `39fd8d8` at
> **10:32**; gaps 6, 5 and 3 had been closed at 10:22, 10:26 and 10:29, and the other three followed
> within nineteen minutes. Two repositories were being worked on in parallel and neither knew what
> the other had just done — which is an argument for CI across both, and CI is exactly what slice 2
> adds.
>
> **What actually remains of this section is its first paragraph**, the deliberate-scope line: *"no
> CI, no package registry, no deployment."* Slice 2 closes **CI** and **deployment** in both
> repositories, with the deploy job gated on the test job. The **package registry** is still out of
> scope — `[DEC-116]` keeps the generated clients as committed npm workspace packages, with
> `npm run verify:clients` standing in for what a registry would have protected against.
>
> ⚠ **Planning from the table above as-is re-does six finished pieces of work.**
```

- [ ] **Step 3: Rows 4 and 5 — amend roadmap §3 and §11 for `[DEC-119]`**

`[DEC-119]` removed the identity provider outright — *"no Entra, no Microsoft integration, no
external identity provider anywhere in the proof of concept"* — and §3 still specifies OIDC against
Entra, still schedules the claim-mapping spike as its own bar, and still lists exit criteria that
decision made unreachable. Anyone planning from it **over-scopes**.

**§3, the `[F13]` Identity row.** Append to the end of that cell:

```markdown
 ⚠ **Amended 2026-09-07 by [DEC-119], during PoC slice 2.** Everything above about **OIDC against Entra ID**, the corporate tenancy **[DEC-66]**, the two app registrations **[F13-R03]**, tenant MFA policy **[DEC-51]**, the local Keycloak/Authentik container **[DEC-67]** and the **[DEC-92]** authentication-method claim is **superseded**: the platform owns identity outright, for customers and for staff, and authentication is **JWT only**. It is kept visible because it records what was planned and why the plan changed. What actually shipped is **[DEC-117]** (ES256 over JWKS, access/refresh, a `security_stamp` claim checked per request) and **[DEC-113]** (an Argon2id credential the platform holds), with **[DEC-138]** making both hosts deny by default and **[DEC-139]** giving the employee realm its own signing key. **[DEC-92]**'s mandatory MFA is recorded as **UNBUILT**: the token carries `amr: ["pwd"]` and nothing rejects on it. `ICustomerContext` is still the one seam, so reintroducing a provider is one registration plus a migration for the credentials already stored — a decision to be retaken, not a switch left flipped.
```

**§3, the `[F13]` Entra claim-mapping spike (`p1f`) row.** Append to the end of that cell:

```markdown
 ⚠ **Removed 2026-09-07 by [DEC-119], during PoC slice 2. This bar is UNBUILDABLE AS WRITTEN, not deferred.** There is no Entra tenancy to spike a claim mapping against, and the local container was never evidence about Entra's claims configuration — this row says so itself. `p1f` is struck from the phase-1 plan. If a provider is reintroduced, this bar comes back with it, and **[R-24]** comes back with the bar.
```

**§3, the `[F13]` Break-glass row.** Append to the end of that cell:

```markdown
 ⚠ **Amended 2026-09-07 by [DEC-119], during PoC slice 2.** Break-glass was the fallback for an identity provider that **no longer exists in this design**, and **[DEC-104]**'s single operator with no rota cannot run a rehearsal **[DEC-53]** requires two named people for. It is **unbuildable as written** rather than deferred. ⚠ **No `[OQ]` number carries the question of whether break-glass survives [DEC-119] at all**, and it needs one: the answer decides whether **[OQ-89]** (the time box and reachable function set) is still open or moot.
```

**§3, the exit criteria.** Replace the paragraph beginning "**Exit criteria:**" with:

```markdown
**Exit criteria:** real PVNed data arriving in production **through the BRP adapter, with PVNed
configured as a BRP row rather than hard-wired [DEC-69]**; a customer can see a correct day and
month chart; DST days handled correctly; data states visible; ingestion alerting proven by a
deliberate outage test; **every metering point has a production expectation that is not `UNKNOWN`,
or is on a named worklist [DEC-65]**, **declared by the customer at onboarding [DEC-112]**;
~~**the break-glass path rehearsed at least once, with the rehearsal recorded [DEC-53]**~~;
~~**the `customer_id` claim mapping demonstrated against the corporate Entra tenancy [DEC-67]**, not
against the local container — the container is a development convenience and was never evidence
about Entra's claims configuration~~; ~~**a customer token without a satisfied MFA claim is rejected
[DEC-92]**~~; and, if `p1g` stayed in this phase, **one company reading its own usage over the API
and failing to read another's [DEC-97]**.

⚠ **Amended 2026-09-07 by [DEC-119], during PoC slice 2.** Three of the ten criteria are struck
above: they are **unbuildable as written**, not deferred, because the identity provider they are
about was removed. Of the seven that remain, PoC slice 2 **meets three** — a correct day and month
chart, DST days handled correctly, data states visible — and records the rest in writing rather than
absorbing them:

| Criterion | State after PoC slice 2 |
| --- | --- |
| Real PVNed data arriving in production | **Not met, and not lowered.** `[DEC-21]` sanctions generated data in the PVNed format over the adapter's real endpoint, which is what the slice does. `[OQ-05]` is unanswered and `[R-01]` stays scored 20 |
| A correct day and month chart | **Met** |
| DST days handled correctly | **Met** — 92 and 100 point days ingest, roll up and render, with the autumn duplicate hour labelled `02:00 A` / `02:00 B` |
| Data states visible | **Met** |
| Ingestion alerting proven by a deliberate outage test | **Deferred in writing.** Every condition is built and tested and writes an `operational_alert` row; **no channel delivers one** and no outage test is run. `[DEC-104]` is one operator with no rota |
| Every metering point has a production expectation that is not `UNKNOWN`, or is on a named worklist | **Deferred.** The worklist is `[F02-R35]`/`[F01-R54]`, which is `F01` work |
| One company reading its own usage over the API | **Moot.** The public machine-to-machine usage API `p1g` moves to phase 2 — `[OQ-95]` is unanswered, and the roadmap's own escape hatch says the bar moves rather than being guessed. The portal's session-authenticated `/api/v1/consumption/*` endpoints are **not** that API and are in scope |
```

**§11.** Append to the end of the section, after the "Not in the register" paragraph:

```markdown
⚠ **Amended 2026-09-07 by [DEC-119], during PoC slice 2.** Two of the entries above are about an
identity provider this design no longer has.

- **[OQ-89]** (break-glass time box and reachable function set) holds up "the phase 1 exit" in the
  table above. That exit criterion is **struck from §3**: break-glass was the fallback for a
  provider that no longer exists, and **[DEC-104]**'s single operator cannot rehearse something
  **[DEC-53]** requires two named people for. `[OQ-89]` is not answered by this — it is **waiting on
  a prior question nobody has registered**: does break-glass survive `[DEC-119]` at all?
- **[OQ-73]** (corporate directory, in the "inside a phase" list) was substantively answered by
  **[DEC-66]** and kept open for a formal confirmation. **[DEC-119]** makes the confirmation moot
  for the proof of concept; it becomes live again only if a provider is reintroduced.

Neither is re-scored or closed here, because closing an open question needs an owner and this is an
amendment rather than an answer.
```

- [ ] **Step 4: Row 7 — `[R-01]` is *joint* highest, in four places**

⚠ **Design §11 row 7 says "Two files still call it 'the highest-scoring risk'". It is THREE.**
Verified today:

```bash
cd /Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9
grep -rn 'highest-scoring risk' specs/ --include='*.md'
```

```
specs/30-integrations/01-pvned-timeseries.md:72:highest-scoring risk on the register.
specs/70-delivery/01-roadmap-and-phasing.md:249:… **R-01 (20)** is the highest-scoring risk on the register …
specs/80-open-questions.md:182:… **R-01 (20) remains the highest-scoring risk on the register** …
```

A fourth match lives in `specs/site/content.js`, which is **generated** (its first line says so) and
is regenerated in step 7. Make all three markdown edits:

**`specs/30-integrations/01-pvned-timeseries.md:71-72`** — replace

```markdown
**Risk R-01 is deferred, not closed** ([Risks](../70-delivery/02-risks.md)) — it remains the
highest-scoring risk on the register.
```

with

```markdown
**Risk R-01 is deferred, not closed** ([Risks](../70-delivery/02-risks.md)) — it remains the
**joint** highest-scoring risk on the register, level with **[R-10]** at 20 since the 2026-08-19
rescore. ⚠ Corrected 2026-09-07: it was the outright highest until [R-10] rose from 9 to 20, and
being one of two rather than the one changes who has to look at it.
```

**`specs/70-delivery/01-roadmap-and-phasing.md:249`** — inside the PVNed dependency row, replace

```markdown
**R-01 (20)** is the highest-scoring risk on the register
```

with

```markdown
**R-01 (20)** is the **joint** highest-scoring risk on the register, level with **[R-10]** ⚠ *(corrected 2026-09-07)*
```

**`specs/80-open-questions.md:182`** — inside `[OQ-65]`'s row, replace

```markdown
**R-01 (20) remains the highest-scoring risk on the register**
```

with

```markdown
**R-01 (20) remains the joint highest-scoring risk on the register, level with [R-10]** ⚠ *(corrected 2026-09-07)*
```

**`specs/70-delivery/02-risks.md`** — two edits. In `[R-01]`'s section (the paragraph block starting
at `:69`), append a new paragraph at the end:

```markdown
**PoC slice 2 (2026-09-07) does not move this row, and says so in the build repository.** The slice
ingests generated PVNed-format documents over the real webhook, through the real parser, validator
and versioning pipeline — which is what **[DEC-21]** sanctions and what **[F02-R29]**/**[F02-R30]**
specify. The reconstructed XSD encodes the nine **[OQ-65]** guesses, interval placement follows
**[OQ-20]**'s interim answer rather than PVNed's confirmation, and the generator and the parser were
written by the same team from the same source. `peakpower-platform/docs/what-slice-2-does-not-prove.md`
records all of it. ⚠ **Also corrected here: this row is JOINT highest with [R-10]**, not outright
highest, since [R-10] rose from 9 to 20 on 2026-08-19; three documents still said otherwise.
```

And in the register table row at `:1270`, append to the Notes cell:

```markdown
 ⚠ 2026-09-07: **joint** highest with **[R-10]**, not outright highest. PoC slice 2 built the whole pipeline against generated data and **did not lower this row** — see `peakpower-platform/docs/what-slice-2-does-not-prove.md`
```

- [ ] **Step 5: Row 8 — define "the platform's working-day calendar", and record `[DEC-144]`**

`[F02-R23]` gives a date ten working days to reach `FINAL` *"using the platform's working-day
calendar"* — with the definite article, and **nothing anywhere defines one**. `[OQ-02]`/`[DEC-19]`
settle the **peak** calendar, which is a different object with the **opposite** treatment of
holidays: a weekday holiday *is* a peak day.

In `specs/10-features/F02-metering-data-ingestion.md`, append to the end of `[F02-R23]`'s cell
(`:211`):

```markdown
 ⚠ **"The platform's working-day calendar" is defined 2026-09-07 by [DEC-144]**, during PoC slice 2: **Monday–Friday, with an empty exclusion list, so public holidays are working days.** It reuses **[DEC-14]**'s mechanism — a named calendar carrying the weekday rule and the exclusion list *as data* — so populating the list later is a row and not a release. It is **not** the peak calendar: **[DEC-19]** settles that one, and it treats a weekday holiday as a peak day, which is the opposite treatment for a different purpose. Until this decision, the phrase had a definite article and no referent.
```

In `specs/00-overview/04-assumptions-and-decisions.md`, append one row after `**DEC-143**` — the row
plan 2 added — in the same four-column shape (`Id | Decision | What it rules out | Notes`):

```markdown
| **DEC-144** | **The platform's working-day calendar is Monday–Friday with an empty exclusion list. Counting working days ignores public holidays.** One calendar, and it is the same data-driven object **[DEC-14]** already describes | A separate holiday list for the 10-working-day `FINAL` rule, which would need an owner, an annual update, and a decision about which country's holidays apply to a customer | Answers **[F02-R23]**, which invoked "the platform's working-day calendar" with the definite article and **no referent anywhere in the specification set**. ⚠ **It is not the peak calendar.** **[OQ-02]**/**[DEC-19]** settled *that* one as Mon–Fri 08:00–20:00 with holidays **included** as peak days; this is a different object for a different purpose and the two must not be conflated. What makes ignoring holidays **safe** here is **[DEC-98]**: before it, `FINAL` meant final, so finalising early across Christmas or King's Day would have shut a correction window that should have stayed open. After it, `FINAL` is a *status*, a post-window version is **routine** **[F02-R45]**, and a late reconciliation reopens the date to `PROVISIONAL` and re-finalises. The risk that would have argued for a holiday list was already defused by a decision taken for other reasons. Implemented as `IMarketCalendar.AddWorkingDays` in `PeakPower.Infrastructure.Time`, reading the weekday set and the exclusion list from the **[DEC-14]** calendar rather than hard-coding them — so populating the list later is a row, not a release. Recorded during PoC slice 2 as **S2-D8** |
```

⚠ **Check the row before `DEC-144` is `DEC-143` and not `DEC-142`.** If it is `DEC-142`, plan 2 has
not landed and this task is running out of order.

- [ ] **Step 6: The ninth amendment — contract §16 items 1, 2 and 9**

The shared contract's §16 flags three decisions it took that the design document did not settle, and
each says "Add to design §11 as a ninth amendment". Add it. In
`docs/superpowers/specs/2026-09-07-poc-slice-2-design.md`, append one row to the §11 table:

```markdown
| 9 | `specs/20-architecture/04-database-design.md` §4 | **Correct `daily_position`'s DDL**, and `customer.metering_point`'s. (a) The day column is **`delivery_date`**, not `local_date` — one word means one thing across all seven of migration 9's tables, and §4.1's own prose says "delivery date". (b) `block_kwh`, `covered_kwh`, `uncovered_kwh`, `surplus_kwh` and `spot_cost_eur` are **not created**: blocks are `F05`/Phase 2 and every money figure is out under **S2-D6**, and a column that is `NULL` on every row for a phase is a column somebody will read as zero. (c) **`offtake_kwh` and `export_kwh` are added** — §4.1's per-interval accumulators, and the point of the table. (d) `customer.metering_point` gains **`production_expectation_set_by`** and **`production_expectation_set_at`**, which the design's column list does not name: `[F02-R33]` is in scope and requires the declared zero to be traceable to its **source, setter and date** `[F01-R40]`, and slice 1 shipped only `expectation_source`. Shared contract §16 items 1, 2 and 9 |
```

- [ ] **Step 7: Regenerate the stakeholder site bundle**

`specs/site/content.js` is generated from `specs/**/*.md` and its first line says *"Generated by
specs/site/build.mjs — do not edit."* It carries a fourth copy of the "highest-scoring risk"
sentence, and it is stale for other reasons too — it is dated 2026-08-26 and the specifications have
moved since.

```bash
cd /Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9
node specs/site/build.mjs
grep -c 'highest-scoring risk on the register' specs/site/content.js
grep -c 'joint. highest-scoring risk' specs/site/content.js
```

Expected: `build.mjs` prints its document, word, question, decision and risk counts and either
`diagram lint clean` or a list of warnings; then **`0`** and a non-zero count.

⚠ **Read `build.mjs`'s counts.** `decisions` must have gone up by two since the last run (`DEC-143`
from plan 2 and `DEC-144` from here). If it went up by one, one of the two rows is malformed and the
parser skipped it — which is a silent way to lose a decision.

⚠ **This regeneration also picks up every specification change since 2026-08-26.** That is a large
diff in one generated file and it is correct; the alternative is a stakeholder site that has been
wrong for a fortnight.

- [ ] **Step 8: Check the whole diff before opening the pull request**

```bash
cd /Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9
git diff --stat -- specs docs
git diff -- specs/70-delivery specs/10-features specs/00-overview specs/30-integrations specs/80-open-questions.md docs
grep -rn 'highest-scoring risk' specs/ --include='*.md'
```

Expected: seven markdown files changed plus the generated bundle; and the last command returns
**three** lines, every one of which now says **joint**.

- [ ] **Step 9: Commit and open the pull request**

```bash
cd /Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9
git add specs docs
git commit -m "Record DEC-144, and correct five documents for PoC slice 2

Design section 11 rows 4-8 of docs/superpowers/specs/2026-09-07-poc-slice-2-design.md, plus the
ninth amendment the shared contract's section 16 asks for. Rows 1-3 landed earlier as DEC-143;
migration 9 was written against them.

Every reversal keeps the reversed text visible, per the house style DEC-63 set.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push -u origin specs/poc-slice-2
gh pr create \
  --title "PoC slice 2: one decision, five corrections, and the exit criteria DEC-119 made unreachable" \
  --body "$(cat <<'BODY'
Raised at the close of PoC slice 2, alongside the code. Design section 11 rows 4-8 of
`docs/superpowers/specs/2026-09-07-poc-slice-2-design.md`, plus the ninth amendment the shared
contract's section 16 asks for. Rows 1-3 landed earlier as `[DEC-143]`, before migration 9.

## New decision

- **[DEC-144]** the platform's working-day calendar is **Monday-Friday with an empty exclusion
  list**, and counting working days ignores public holidays. `[F02-R23]` invoked "the platform's
  working-day calendar" with the definite article and nothing defined one. It is **not** the peak
  calendar: `[DEC-19]` settles that one and treats a weekday holiday as a peak day, which is the
  opposite treatment for a different purpose. What makes ignoring holidays safe is **[DEC-98]** -
  `FINAL` is now a status, a post-window version is routine, and a late reconciliation reopens the
  date rather than being locked out. Reuses `[DEC-14]`'s data-driven mechanism, so populating the
  list later is a row and not a release.

## Corrections

1. **Roadmap section 2.2** - all six slice-1 gaps were closed on 2026-09-03, and **three of them
   before this section was committed**. The section landed as `39fd8d8` at 10:32; gaps 6, 5 and 3
   were closed at 10:22, 10:26 and 10:29, and the other three followed within nineteen minutes. Two
   repositories in parallel, neither knowing what the other had just done - which is an argument for
   CI across both, and CI is what slice 2 adds. The table is kept and annotated rather than deleted.
   What remains of the section is its deliberate-scope line, of which slice 2 closes CI and
   deployment; the package registry stays out of scope under `[DEC-116]`.
2. **Roadmap section 3** - amended for `[DEC-119]`, which removed the identity provider outright.
   The Identity row's Entra text is superseded and kept visible; the claim-mapping spike `p1f` and
   break-glass are marked **unbuildable as written, not deferred**; and three of the ten phase-1
   exit criteria are struck for the same reason. The remaining seven are tabled with what slice 2
   did to each: three met, one not met and not lowered (`[R-01]` stays 20), two deferred in writing,
   one moot.
3. **Roadmap section 11** - `[OQ-89]` holds up an exit criterion that no longer exists, and is
   itself waiting on a prior question nobody has registered: does break-glass survive `[DEC-119]` at
   all? `[OQ-73]` is moot for the proof of concept.
4. **`[R-01]` is JOINT highest with `[R-10]`, not outright highest**, since `[R-10]` rose from 9 to
   20 on 2026-08-19. Design section 11 said two files still said otherwise; there were **three** -
   the roadmap, the open-questions register and the PVNed integration spec - plus the generated site
   bundle, regenerated here. The risk register itself now records that slice 2 built the whole
   pipeline against generated data and **did not lower the row**.
5. **`[F02-R23]`** now names `[DEC-144]` for the calendar it invoked and nothing defined.
6. **Design section 11 gains a ninth row** for the database-design corrections the shared contract
   made: `daily_position`'s day column is `delivery_date` and not `local_date`; the five block,
   coverage and money columns are not created; `offtake_kwh` and `export_kwh` are added; and
   `customer.metering_point` gains `production_expectation_set_by` and `_set_at`, without which
   `[F02-R33]`'s declared zero cannot be traced to its source, setter and date.

## Not done here

`[OQ-05]`, `[OQ-20]` and `[OQ-65]` are untouched. All three need PVNed in the room, none has a
chaser named inside the team, and this pull request is an amendment rather than an answer.
`peakpower-platform/docs/what-slice-2-does-not-prove.md` records what that costs.
BODY
)"
```

Expected: the pull request URL is printed. Paste it into the acceptance record, task 11, item 25.

---

### Task 11: walk design §7's twenty-five items, and record the evidence for each

Design §7 is the slice's acceptance gate. Twenty-five numbered items, and this task walks them one
at a time and writes down what proves each — the name of a test where an earlier plan proves it, and
a command and its output where it needs a fresh check here.

⚠ **"The suite is green" is not evidence for an item.** Design §10: *"A green test that was never
seen red is not evidence."* Each row below names a specific assertion, and the four that design §10
singles out are confirmed to have been mutation-verified rather than assumed.

**Files:**
- Create: `docs/superpowers/plans/2026-09-07-slice-2-acceptance.md` in the specification worktree

**Interfaces:**
- Consumes: everything. The runner's `perf-report.txt` and `dataset.txt` from task 6 step 4, the
  deployed run's logs and screenshot from task 8 step 6, the pull-request URL from task 10 step 9.
- Produces: the acceptance record, and a yes-or-no answer to "is slice 2 done".

- [ ] **Step 1: Run everything, in both repositories, from clean**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git status --short                    # must be empty
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln
tools/verify-solution-layout.sh
tools/verify-migrator.sh
tools/verify-build-settings.sh
tools/verify-aspire-api.sh
tools/verify-repositories.sh
tools/verify-close-out.sh
tools/verify-no-unexpected-skips.sh

cd /Users/thinhhuynh/PeakPower/peakpower-web
git status --short                    # must be empty
npm ci && npm test && npm run verify:clients && npm run e2e
npx tsc -p e2e && npx tsc -p perf
```

Expected: every command green, and `verify-no-unexpected-skips: OK` — which is item 1's and item
22's shared evidence, and the only one of the twenty-five that proves itself by the **absence** of
something.

- [ ] **Step 2: Confirm the four required mutation verifications actually happened**

Design §10 names four assertions that must each be broken, watched go red, and fixed. None of them
belongs to this plan, and "it was in the plan" is not the same as "it was done". For each, find the
commit that carried it and read its message:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git log --oneline --grep='mutation' --since=2026-09-01 | head -40
```

| # | Assertion | The commit must say it broke | Owner |
| --: | --- | --- | --- |
| 1 | Completeness (§7.8) | `directions.Count == 2` written as the completeness test, and `DayCompletenessTests.A_never_point_with_only_a_consumption_series_is_complete` going red | plan 5 |
| 2 | Receipt order (§7.5) | the supersession comparison swapped to `CreatedDateTime`, and `SupersessionTests.an_EARLIER_created_document_RECEIVED_SECOND_still_becomes_current` going red | plan 3 |
| 3 | DST Pos mapping (§7.10) | `IntervalStart` replaced with a naive add-15-minutes loop, and the autumn 100-point case in `IntervalStartTests` going red | plan 1 |
| 4 | The §4.1 rollup (§7.11) | per-interval accumulation replaced with daily-total subtraction, and `DailyPositionCalculatorTests.The_worked_case_from_design_4_1` going red with `offtake` reading 5 where the fixture says 10 | plan 5 |

⚠ **If a commit message does not name the mutation and the failure, do the mutation now.** It costs
ten minutes each and it is the difference between four tests and four assertions. Record the outcome
in the acceptance record's own words, not as "confirmed".

- [ ] **Step 3: Write the acceptance record**

Create
`/Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9/docs/superpowers/plans/2026-09-07-slice-2-acceptance.md`.

Fill every `[…]` from a run you actually watched. A bracket left in the file is an item that has not
been checked.

````markdown
# PoC Slice 2 — acceptance against the definition of done

**Walked:** [date] · **Design:** `../specs/2026-09-07-poc-slice-2-design.md` §7, twenty-five items
**Verdict:** [MET / NOT MET — and if not met, which items and what is owed]

Every row names the assertion that proves it. Where an earlier plan proves an item, the row names
that plan's test. Where the item needs a check that only exists once everything is assembled, the
row names the command run here and what it printed.

⚠ **"The suite is green" is not evidence for a row.** Design §10: a green test that was never seen
red is not evidence.

---

## The four assertions design §10 requires be mutation-verified

| # | Assertion | Broken by | Went red as | Confirmed |
| --: | --- | --- | --- | --- |
| 1 | Completeness | `directions.Count == 2` | `DayCompletenessTests.A_never_point_with_only_a_consumption_series_is_complete` | [commit / date] |
| 2 | Receipt-order supersession | comparison swapped to `CreatedDateTime` | `SupersessionTests.an_EARLIER_created_document_RECEIVED_SECOND_still_becomes_current` | [commit / date] |
| 3 | The DST Pos mapping | naive add-15-minutes loop | `IntervalStartTests`, the autumn 100-point case | [commit / date] |
| 4 | The §4.1 rollup shape | daily-total subtraction | `DailyPositionCalculatorTests.The_worked_case_from_design_4_1` | [commit / date] |

## The twenty-five

| # | Design §7 item | Proven by | Fresh check here |
| --: | --- | --- | --- |
| 1 | CI in both repositories, gating deploy; `AppHost.Tests` reports zero skipped; the solution-wide skipped set equals a checked-in allow-list | plan 1 tasks 1–4 · `tools/verify-no-unexpected-skips.sh` · `tests/skipped-tests.allowlist.txt`, **empty of names** · mutation-verified by pointing `PEAKPOWER_WEB_PATH` at a directory that does not exist | `tools/verify-no-unexpected-skips.sh` → `[output]`. Deploy gate re-proved on `deploy-gate-proof`: the run has two jobs, `CI` fails and `Deploy to VM` is **skipped** |
| 2 | 200 with the payload durably stored and `status = 'RECEIVED'` **at the moment the 200 is written** | plan 3 · `WebhookReceiptTests.the_message_is_RECEIVED_and_not_PROCESSED_at_the_moment_the_200_is_written`, `never_writes_the_credential_header_into_the_stored_headers` | Task 8 step 2 on the deployed stack: no `RECEIVED` or `PROCESSING` rows left after the scenario run |
| 3 | 24 h dedupe · 413 over 25 MiB, accepted at exactly 26 214 400 · a parser failure still 200, `FAILED`, zero interval rows | plan 3 · `WebhookDedupeTests.a_byte_identical_redelivery_answers_200_and_lands_DUPLICATE`, `the_duplicate_window_is_twenty_four_hours`, `WebhookSizeLimitTests.a_payload_one_byte_over_the_limit_is_413` and `a_chunked_body_of_exactly_the_limit_is_accepted`, `ProcessingOutcomeTests.a_rejected_document_raises_a_VALIDATION_FAILURE_alert` · plan 5 `SizeBoundaryTests` | Task 8 step 1: `size-25mb` → 200, `size-26mb` → 413, at the deployed webhook |
| 4 | A document whose second timeseries is one point short applies **nothing at all**, by row count | plan 3 · `ApplyAtomicityTests.a_document_whose_second_series_is_one_point_short_applies_nothing_at_all`, `a_negative_quantity_anywhere_applies_nothing` · plan 4 `PvnedPointTests.the_SECOND_series_being_short_fails_the_whole_document` | — |
| 5 | Receipt order governs; both orders leave the second-received current; the superseded version stays queryable; `ux_idv_current` holds one current version | plan 3 · `SupersessionTests.an_EARLIER_created_document_RECEIVED_SECOND_still_becomes_current`, `both_receipt_orders_of_the_SAME_PAIR_leave_the_second_received_current`, `the_superseded_version_and_its_readings_remain_queryable`, `the_two_directions_supersede_independently` · **mutation-verified**, table above | — |
| 6 | Four quarantine reasons; registering and replaying resolves; replaying an already-processed message produces **no second version** | plan 3 · `QuarantineTests.an_ean_registered_nowhere_quarantines_as_UNKNOWN_EAN`, `…_EAN_VALIDITY`, `…_WRONG_BRP`, `a_non_electricity_metering_point_quarantines_as_NOT_ELECTRICITY`, `a_labelled_resource_object_is_skipped_and_NOT_quarantined` · `ReplayIdempotenceTests.replaying_an_already_processed_message_produces_NO_second_version`, `a_replay_after_the_metering_point_is_registered_resolves_the_quarantine_entry` | Task 8 step 5 on the deployed stack: a second replay returns `versionsCreated: 0`, `outcome: "NO_CHANGE"` |
| 7 | A message whose BRP is later deactivated still replays through the adapter selected by the **stored** `brp_id`, with a second adapter registered | plan 3 · `AdapterResolutionTests.a_message_from_a_deactivated_brp_still_parses_through_its_stored_adapter`, `the_other_brp_s_message_goes_to_the_other_adapter` · `BrpIngestionAdapterRegistryTests.does_not_resolve_the_only_adapter_there_is_when_the_key_is_a_different_one` | — |
| 8 | `NEVER` + A02-only reaches complete; `EXPECTED`/`UNKNOWN` + A02-only stays `PARTIAL` and alerts; **a test that fails against `directions.Count == 2`** | plan 5 · `DayCompletenessTests.A_never_point_with_only_a_consumption_series_is_complete`, `Only_a_never_point_is_excused_the_production_series`, `A_missing_consumption_series_is_partial_even_for_a_never_point` · `DayStateRecomputerTests.A_never_point_with_only_a_consumption_series_reaches_provisional`, `An_unknown_point_with_only_a_consumption_series_alerts_about_the_declaration` · **mutation-verified**, table above | — |
| 9 | An A01 series on a `NEVER` point is stored **and** promotes it to `EXPECTED`/`OBSERVED` in the **same transaction**, stamping `first_production_observed_at` | plan 5 · `ProductionPromotionTests.An_A01_series_on_a_never_point_promotes_it_and_the_readings_stay`, `The_promotion_and_the_readings_commit_or_roll_back_together`, `Stamping_the_observation_without_promoting_is_refused_by_the_database` · plan 2's `ck_mp_never_has_no_observed_production` | — |
| 10 | 92- and 100-point days ingest, roll up and render, with `02:00 A` / `02:00 B`; a 96-point document rejected for **both** dates | plan 4 · `PvnedPointTests.a_92_point_spring_day_and_a_100_point_autumn_day_both_pass`, `an_interval_count_that_is_not_92_96_or_100_fails` · plan 5 `DayStateRecomputerTests.A_ninety_six_point_series_never_completes_a_DST_day` · plan 7 `pp-usage-chart.spec.ts` (the duplicate-hour labels) · **mutation-verified**, table above | Task 4's dataset spans both transitions — `LoadTestPlanTests.Both_DST_days_are_in_the_window_and_carry_their_own_lengths` — so the perf run measured a year containing a 92-point and a 100-point day |
| 11 | The §4.1 worked case: offtake and export match the per-interval computation and **not** the daily-gross answer | plan 5 · `DailyPositionCalculatorTests.The_worked_case_from_design_4_1`, `A_day_that_exports_overall_carries_a_negative_net_usage` · `DailyPositionPersistenceTests.A_mixed_export_day_stores_the_per_interval_accumulators` · plan 2 `DailyPositionTests.The_worked_case_of_design_section_4_1_is_storable_with_offtake_ten_and_export_five`, `Offtake_minus_export_must_equal_net_usage` · **mutation-verified**, table above | — |
| 12 | `FINAL` after 10 working days; a post-window reconciliation reopens to `PROVISIONAL`, recomputes, and the chart shows a corrected-on marker; nothing archives or caches on `FINAL` | plan 5 · `DayFinalisationJobTests.A_provisional_day_finalises_on_the_tenth_working_day`, `A_provisional_day_does_not_finalise_on_the_ninth_working_day`, `A_span_across_Christmas_finalises_on_the_weekday_count`, `A_span_across_Kings_Day_finalises_on_the_weekday_count`, `A_post_window_version_reopens_a_finalised_day_and_it_refinalises`, `Finalising_deletes_no_readings_and_no_versions` · plan 1 `AddWorkingDaysTests` | Task 8 step 1: the `post-window-reconciliation` scenario, run against the deployed webhook |
| 13 | An A12 imbalance document is recognised, stored, closed with **zero** `interval_reading` rows | plan 4 · `PvnedDocumentTypeTests.An_A12_imbalance_document_is_recognised_and_closed_with_no_series_at_all`, `The_closed_A12_still_carries_its_document_identity_so_the_message_can_be_stored`, `A_misrouted_A12_is_rejected_rather_than_recognised_and_closed` · plan 3 `ProcessingOutcomeTests` (`RecognisedAndClosed` → `PROCESSED`) | — |
| 14 | Cross-tenant day read is **404 not 403**; as `app_customer_role` a direct `SELECT` on `interval_reading` returns only that customer's rows and on the three employee-only tables raises `insufficient_privilege`; every partition has RLS and both policies | plan 6 · `ConsumptionDayTests.Company_a_charting_company_bs_connection_is_404_and_never_403`, `A_selection_mixing_a_stranger_connection_with_an_own_one_is_404_entirely` · `CustomerApiRouteTableTests` · plan 2 §12's guard literals — `QueryFilterModelTests` thirteen names, `RowLevelSecurityTests` eleven and eleven | **Task 7 step 6, on the deployed database**: `SELECT` on `inbound_message` as `peakpower_app` → `[42501 output]`; `INSERT` on `interval_reading` → `[42501 output]`; the partition catalog query returned **[N] rows** (must be 0) |
| 15 | The day envelope carries `netUsageKwh` per interval, **no** `blocks` / `blockKwh` / `netPositionKwh` / `dayAheadPriceEurMwh` key at all, and omits missing intervals entirely | plan 6 · `ConsumptionDayTests.The_day_envelope_carries_no_block_coverage_or_price_key_at_all`, `A_missing_interval_is_absent_from_the_json_and_never_a_zero_or_a_null` · mutation-verified by serialising a missing interval as `0` | — |
| 16 | A customer signs in, clicks **Volume**, and sees a day chart whose three series are distinguishable **with colour removed**, clearing 3:1, with the zero line, gaps and Amsterdam ticks — and can step, pick, jump, drill in and switch selection | plan 7 · `pp-usage-chart.spec.ts` *"distinguishes the three series by STROKE PATTERN with the colour removed"* · `tokens.spec.ts` (the contrast figures) · `consumption-page.spec.ts`, `day-picker.spec.ts`, `metering-point-selector.spec.ts`, `consumption-calendar.spec.ts` · `customer-nav.spec.ts:79`, `:92` and `app.routes.spec.ts:34` moved in the same commit | **Task 8 step 4, on the deployed stack**, as `j.devries@vandersteen.nl`. Screenshot: `[path]`. Every row of that step's table checked on screen |
| 17 | The month chart marks missing days as **stubs**, not short bars | plan 7 · `pp-usage-month-chart.spec.ts` *"marks a missing day as a STUB, not as a short bar"* and *"marks the stub with a dashed outline, so colour is not the only difference"* · plan 6 `ConsumptionMonthTests.A_no_data_day_carries_the_volume_keys_with_json_null_rather_than_omitting_them` | — |
| 18 | The KPI strip's three totals each carry their range's data state; the empty state renders; partial, provisional and **declared-zero** each render | plan 7 · `consumption-page.spec.ts`, `consumption-copy.spec.ts` · plan 6 `ConsumptionDayTests.The_envelope_reports_the_worst_state_across_the_selection` | Task 8 step 4: **Rotterdam DC** shows a declared zero naming source, setter and date; **Almere office** shows a real production series |
| 19 | `LastDataDate` real on list and detail; the 14-day series on detail; `NO_DATA_YET` gone where data exists; **the spec that pinned its absence inverted**; the dashboard no longer claims there is nothing to total | plan 6 · `ConnectionListTests.Last_data_date_is_the_newest_day_that_actually_holds_data`, `A_connection_that_has_received_nothing_still_carries_no_last_data_date`, `RecentDataStatesTests.The_recent_state_series_is_dense_oldest_first_and_fills_gaps_with_no_data` · plan 7 `connection-detail-page.spec.ts:266-274` **inverted**, plus a second test keeping `NO_DATA_YET` for `lastDataDate: null`, and a new `dashboard-page.spec.ts` assertion for the replacement copy | Task 8 step 4, last two rows of that step's table |
| 20 | An employee sees the message log by BRP, the quarantine list with reason and age, the 21-day heat map, and can replay | plan 6 · `DataHealthMessageTests.A_row_counts_the_versions_and_the_quarantine_entries_the_message_produced`, `DataHealthQuarantineTests.A_quarantined_series_carries_its_reason_its_resource_object_and_its_age`, `DataHealthMeteringPointTests`, `DataHealthReplayTests`, `EmployeeRouteTableTests` · plan 7's employee screens | **Task 8 step 5, on the deployed stack** |
| 21 | A point silent for two cadence windows appears silent; one receiving on cadence does not | plan 5 · `SilenceDetectionJobTests.A_point_that_received_yesterday_is_not_silent`, `A_point_that_last_received_three_days_ago_is_silent_and_the_alert_names_the_BRP`, `A_point_that_has_never_received_anything_is_silent_after_its_grace` | — |
| 22 | `CallSiteFacts.Fact_3_ingestion_references_no_Brp_adapter` **runs and passes, no longer skipped** | plan 1 task 6 · mutation-verified by referencing `PeakPower.Integration.Brp.Pvned` from `PeakPower.Ingestion` and watching *"PeakPower.Ingestion must talk to BRP adapters through a port, never by referencing one"* | `dotnet test tests/PeakPower.Architecture.Tests --filter "FullyQualifiedName~Fact_3"` → **[1 passed, 0 skipped]**. `tests/skipped-tests.allowlist.txt` no longer names it |
| 23 | `verify-migrator.sh` passes with migration 9, having run the real Migrator **twice**; `verify-solution-layout.sh` passes against 22 projects; `CommittedComposeFileTests` and `ImageBuildTests` pass against the regenerated compose file and the Worker stage | plan 2 (migration 9, `MigrationScriptTests`, `MigrationBehaviourTests`) · plan 1 (`verify-solution-layout.sh` 18 → 22, `CommittedComposeFileTests`, `ImageBuildTests`) | `tools/verify-migrator.sh` → `[output]` · `tools/verify-solution-layout.sh` → `[output]` · `dotnet test tests/PeakPower.AppHost.Tests` → `[N passed, 0 skipped]` |
| 24 | A 100-EAN × 365-day dataset loads; the day view answers its first hover within **1.5 s warm** (`[NFR-03]`); the month view within **2 s** (`[NFR-04]`) | **this plan**, tasks 2–6 · `LoadTestPlanTests` · `perf/consumption-performance.spec.ts` | Runner figures from `load-test-<n>/perf-report.txt`: day one connection **[x] ms** warm median / **[y] ms** cold; day 106 connections **[x] ms**; month one connection **[x] ms**; month 106 connections **[x] ms**. Dataset: **[N]** `interval_reading` rows, **[N]** documents, built in **[t]**. Runner: **[uname / nproc / free -m]** |
| 25 | **A written note in the platform repo lists what this slice does NOT prove.** `[R-01]` stays scored 20 | **this plan**, task 9 · `peakpower-platform/docs/what-slice-2-does-not-prove.md` · `tools/verify-close-out.sh` check 2, mutation-verified twice | The note is committed at `[commit]`. `[R-01]` is recorded as **joint** highest at 20 in `specs/70-delivery/02-risks.md`, and the specification pull request is at `[URL]` |

---

## What this slice did **not** meet, stated rather than absorbed

| | |
| --- | --- |
| Real PVNed data arriving in production | Phase-1 exit criterion. Not met and **not lowered**. `[OQ-05]` unanswered, `[R-01]` stays 20 |
| Ingestion alerting proven by a deliberate outage test | Phase-1 exit criterion. The conditions are built and tested; **no channel delivers them** and no outage test was run |
| Every metering point has a production expectation that is not `UNKNOWN`, or is on a named worklist | Phase-1 exit criterion. The worklist is `[F02-R35]`/`[F01-R54]`, which is `F01` work |
| Break-glass rehearsal · the Entra claim-mapping demonstration · MFA-claim rejection | Three Phase-1 exit criteria, **unbuildable as written** under `[DEC-119]`. Struck from roadmap §3 by this slice's specification pull request |
| The public machine-to-machine usage API (`p1g`) | Moot: moved to phase 2 under the roadmap's own escape hatch, `[OQ-95]` unanswered |

## Open questions this slice leaves, and what each now costs

| | |
| --- | --- |
| `[OQ-05]` | The real wire contract. Unanswered; `[R-01]` stays 20 |
| `[OQ-20]`, `[OQ-65]` | Interval placement and the nine reconstructed-XSD guesses. Both need PVNed in the room and **neither has a chaser named inside the team**. Book them |
| `[OQ-102]` | The RLS login-role passwords are literals inside migration 2. This slice added **six** more tables under those roles and **deployed**. It does not block the build; it blocks calling the deployment real |
| `[OQ-97]` | The GS1 check digit. Not one of the thirty-one demo EANs would pass, ingestion keys on EAN, and **the blast radius now grows with every ingested row** |
| `[OQ-22]` | The charting library. Deferred by **S2-D5**; the two `shared-ui` components are the whole replaceable surface |
| Unregistered | **Does break-glass survive `[DEC-119]` at all?** No `[OQ]` number carries it, and `[OQ-89]` is waiting on the answer |
````

- [ ] **Step 4: Answer the question**

Read the record back and write the verdict at the top. It is **MET** only if all twenty-five rows
carry evidence and none carries a bracket.

⚠ **A row whose evidence is "the suite is green" is not a met row.** Nor is one whose fresh check
was not run because the deployment was awkward — items 14, 16 and 20's fresh checks are the only
place in the slice where row-level security, the chart and the back office are exercised against a
real deployment rather than a test host.

⚠ **If item 24's 106-connection figures exceed `[NFR-03]`, the verdict is NOT MET**, and what is
owed is named in task 5 step 8: an `EXPLAIN (ANALYZE, BUFFERS)` of the day query and a check that
the aggregate is summed in SQL. Record the numbers either way.

- [ ] **Step 5: Commit the record**

```bash
cd /Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9
git add docs/superpowers/plans/2026-09-07-slice-2-acceptance.md
git commit -m "Record the slice-2 acceptance walk: design section 7's twenty-five items

One row per item, each naming the assertion that proves it - a plan's test where an earlier plan
proves it, and a command and its output where the item needs a check that only exists once
everything is assembled. Items 14, 16, 20 and 24 have fresh checks here: row-level security against
the deployed database, the day chart on the deployed stack, the back office on the same, and the
NFR-03 / NFR-04 figures from the CI runner.

The four assertions design section 10 requires be mutation-verified are recorded with the commit
that carried each mutation, rather than assumed from the plan that asked for it.

What the slice did NOT meet is a section of its own, with the three Phase-1 exit criteria DEC-119
made unbuildable, the two deferred in writing, and the one moved to phase 2. R-01 stays scored 20.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## The slice is accepted when

1. **`docs/superpowers/plans/2026-09-07-slice-2-acceptance.md` says MET**, with no bracket left in
   it and all twenty-five rows carrying evidence.
2. **Both repositories are green from clean** — task 11 step 1, every command.
3. **`tools/verify-close-out.sh` passes**, in CI as well as by hand: the deployment directory agrees
   across three files in two repositories, and the honesty note still says all five things.
4. **The runner has measured `[NFR-03]` and `[NFR-04]`** — task 6, on `ubuntu-latest`, with the
   machine recorded beside the figures. Laptop numbers do not count.
5. **A seeded customer has signed in to the deployed stack and seen a populated day chart**, after
   DevStubs was run at that deployment's webhook **from a developer machine** — design §5 step 12's
   own "independently testable by".
6. **`peakpower-platform/docs/what-slice-2-does-not-prove.md` is committed**, and `[R-01]` is still
   **20**.
7. **The specification pull request is open**, carrying design §11 rows 4–8, the ninth amendment and
   `[DEC-144]`.

⚠ **Point 6 is the one most likely to be skipped and the one that matters most a year from now.**
Everything else in this list is a thing that works. That one is the record of what does not.
