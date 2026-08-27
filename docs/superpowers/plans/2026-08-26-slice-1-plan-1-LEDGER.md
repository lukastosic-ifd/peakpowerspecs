# SDD ledger — plan: docs/superpowers/plans/2026-08-26-slice-1-plan-1-platform-foundation.md

**Spec:** docs/superpowers/specs/2026-08-26-poc-slice-1-design.md (read)
**Shared contract:** docs/superpowers/plans/2026-08-26-slice-1-shared-contract.md (read — normative)
**Code repository:** /Users/thinhhuynh/PeakPower/peakpower-platform (and peakpower-web for Task 29)
**Tasks:** 29

## Workspace

Ruling: no git worktree was created. The target repository `peakpower-platform` is empty and not
git-initialised — Task 1 creates it. There is no existing history to isolate from and no
main/master branch to protect, so a fresh repo IS the isolated workspace.
Cost if wrong: none material; the repo can be re-initialised.

## Pre-flight conflict scan

Method: extracted every task's Files and Interfaces block and checked each producer/consumer
pair, plus each task's internal agreement between the files it creates and the files it later
modifies.

| # | Pair / task | Produces -> consumes | Finding |
| --- | --- | --- | --- |
| 1 | T1 -> T2 | two git repos -> solution files | clean |
| 2 | T2 -> T3 | Directory.*.props, .sln -> 18 csproj | clean |
| 3 | T3 -> T4 | Domain/Application AssemblyMarker -> NetArchTest facts 1,2 | clean |
| 4 | T3 -> T5 | 12 source assemblies -> AssemblyProbe, facts 3,5 | clean — 12 = 13 source projects minus AppHost, which an Aspire orchestrator cannot be referenced as. Verify at T5. |
| 5 | T6 -> T7,T8,T9,T11..T14 | Result<T> -> value objects and aggregates | clean |
| 6 | T10 -> T11,T12,T13,T18 | enums, Address, ContactPerson -> aggregates, converter | clean |
| 7 | T12 -> T16 | CustomerAccount -> ITokenIssuer | clean — Application referencing Domain satisfies fact 2 |
| 8 | T15 -> T17 | IMarketCalendar port -> MarketCalendar impl | clean |
| 9 | T17 -> T24 | AddMarketCalendar -> AddServiceDefaults | **CONFLICT — ruled, see below** |
| 10 | T18,T19 -> T20 | converters -> DbContext | clean |
| 11 | T20 -> T21,T22,T23 | DbContext, ConfigureDbContext -> migration, container test, Migrator | clean |
| 12 | T3 -> T24 | Extensions.cs created in T3 (line 1312), modified in T24 | clean — T24's "Modify" is accurate |
| 13 | T3 -> T25,T26,T27 | AppHost.csproj -> API assertion, WebRootLocator, resource graph | clean |
| 14 | T27 -> T28,T29 | AppHost -> dev-up both repos | clean |
| 15 | Internal: T17 | impl in Infrastructure.Time, test in Application.Tests | clean — fact 2 binds the production Application project, not its test project |
| 16 | Global constraints | 13 source + 5 test = 18 projects | clean — contract §3.1 prose says "eleven" but its list has 13; the plan follows the list, and its own report flagged the arithmetic |

Ruling (row 9): `PeakPower.ServiceDefaults.csproj` as written in Task 3 had NO ProjectReference,
but Task 24's `Extensions.cs` calls `builder.Services.AddMarketCalendar()`, which lives in
`PeakPower.Infrastructure.Time`. It would not compile. This conflict is mine — I added that call
during the plan-reconciliation pass without adding the reference. Fixed in the plan before
dispatch: Task 3's ServiceDefaults csproj now references `PeakPower.Infrastructure.Time`, with a
comment saying why. The module rule permits it — a Hosts-tier project referencing infrastructure
solely to register it in DI is exactly the sanctioned shape, and ServiceDefaults is the shared
composition root, which is the whole reason registering the calendar there gives every host the
guarantee. Cost if wrong: ServiceDefaults gains a transitive dependency on Application and Domain
that every host already carries; reversible by moving the single registration line into each
host's Program.cs instead.

## Progress

Task 1: dispatched (haiku) — repos, .gitignore, Entra request doc, verify-repositories.sh
Task 1: implementer DONE — platform f45b61d, 3d3a07c; web 745eff1; verify-repositories: OK
Task 1: review — spec OK, quality Approved; 2 minor deferred; 1 confirmed gap from a Cannot-verify item
Task 1: minor (deferred): platform .gitignore will not cover artifacts/publish or artifacts/package if a later plan turns on the opt-in .NET artifacts output layout
Task 1: minor (deferred): neither .gitignore ignores stray *.log (npm-debug.log, yarn-error.log)
Task 1: Ruling: the generated docs/entra-tenant-access-request.md asserted "Raised: <today>" and
  "Status: raised, awaiting the tenant administrator". Nobody contacted corporate IT and no agent
  can, so the record was false. The file's own closing line says it is the answer to "did anyone
  actually ask?" — a fabricated yes there is worse than no file, because it makes the
  longest-lead-time dependency in phase 1 (design §13, no substitute under [DEC-67]) look
  handled. Treated as a failed spec item and sent into the fix loop, and the plan text corrected
  at source (commit aab6b28) so it cannot recur.
  Cost if wrong: none to the code; the file records less certainty than reality if the request
  turns out to have been raised by someone else, which a status update fixes.
Task 1: fix round 1/5 dispatched — resumed implementer a2ac3d3 with the Entra-record finding
Task 1: fix round 1/5 (1 addressed, 0 open — Entra record now states "not yet raised", owner named; commit 0faf3fb)
Task 1: complete (platform f45b61d..0faf3fb, web 745eff1, review clean)
Task 2: complete (commit 33f7eaa, review clean — reviewer proved the guards load-bearing: injected FluentAssertions and it failed; proved CPM rejects a floated version; proved warnings-as-errors cascades into tests/)
Task 2: minor (deferred): task-2-report.md miscounts packages (says 8 testing / 26 total; actual 11 / 29). Artifact correct, report wrong.
Task 2: minor (deferred): tools/verify-build-settings.sh hardcodes root=/Users/thinhhuynh/PeakPower/peakpower-platform instead of deriving it from the script location. Brief-authored, and the SAME pattern recurs in verify-repositories.sh (Task 1) and will recur in Tasks 3, 23, 25 — batch-fix candidate for the final review.
Task 3: complete (commit 5c19eaa, review clean — 18 projects, graph enumerated edge-by-edge, build 0 warnings)
Task 3: deviation ACCEPTED — Domain.csproj comment reworded because the brief's own comment text contained "ProjectReference" and tripped the brief's own grep. Reviewer: right call, rightly implemented; meaning unchanged, zero ProjectReference elements confirmed.
Task 3: deviation ACCEPTED — AppHost gained <AspireUseCliBundle>true</AspireUseCliBundle>. Reviewer verified independently in the SDK targets (Sdk.targets:25 defaults it false; Aspire.Hosting.AppHost.targets:156 raises ASPIRE010, fatal under TreatWarningsAsErrors) and by scaffolding `aspire new`, which emits AspireUseCliBundle=true. Supplies the missing value rather than suppressing the warning.
Task 3: minor (deferred): tools/verify-solution-layout.sh greps a bare "ProjectReference" string with no XML awareness, so it cannot tell a comment from an element. Brief-authored; Tasks 4/5 make the same facts executable against compiled IL, which is the real guard.
Task 4: complete (commit 92ffbfd, review clean — reviewer reproduced BOTH deliberate violations itself and confirmed NetArchTest matches by namespace PREFIX, so "PeakPower.Infrastructure" in the forbidden list really does catch all four split Infrastructure.* assemblies; tree left clean)
Task 4: minor (deferred): ModuleGraphFacts.cs throws XunitException directly for 2 of 4 assertions instead of using Shouldly, because the brief's own ShouldBeTrue("...{0}", arg) does not compile — Shouldly has no format-args overload. A single-argument interpolated ShouldBeTrue was available. Consistency only; correctness unaffected.
Task 4: Ruling: that broken Shouldly overload came from my FluentAssertions-to-Shouldly conversion, which carried FA's (format, args) message form across. I scanned all six plans for it: exactly one other instance survived — Task 18's .ShouldBe(value, "{0}...", value, text) — now rewritten as an interpolated single-argument message. Verified the ShouldBeEmpty/ShouldBeNull/ShouldNotBeNull single-message calls elsewhere ARE valid Shouldly overloads and left them alone.
  Cost if wrong: a compile error in Task 18 that its own red-green cycle would have caught anyway.
Task 5: implementer DONE (commit e92f66b) — facts 3 and 5 over compiled IL with Mono.Cecil; 5 passed, 1 skipped
Task 5: deviation ACCEPTED — CallSiteFacts.cs adds `using Xunit;` which the brief's snippet omitted. Reviewer confirmed GlobalUsings does not import Xunit and Task 4's file carries the same line. Necessary, not invented.
Task 5: review — spec OK, quality Approved; reviewer proved fact 5 catches violations inside lambdas, async state machines, local functions, property getters and static initialisers, because AssemblyProbe walks NestedTypes recursively (C# lowers all of those into nested types).
Task 5: Ruling: the reviewer's AssemblyProbe finding was NOT labelled blocking, but I am treating it as
  load-bearing and fixing it now rather than deferring. It proved that moving the twelve DLLs out of the
  test output makes fact 5 PASS with zero assemblies scanned, because ProductionAssemblies() uses
  .Where(File.Exists) and silently drops what is missing. I hold the cross-plan context the reviewer does
  not: plan 2 builds facts 4 and 6 on this same probe, and those two ARE the tenancy guarantees — no
  IgnoreQueryFilters() and the context-provider fence. A silently vacuous probe would let both pass
  forever while guarding nothing, which is the single most expensive defect this slice could ship.
  Cost if wrong: one extra assertion and a test in a file plan 2 was going to touch anyway.
Task 5: fix round 1/5 dispatched — probe must fail loudly on a missing assembly; fact 3's skip message must name the ProjectReference that arms it
Task 5: fix round 1/5 (2 addressed, 0 open — probe now throws naming the 12 missing DLLs and the directory searched, with its own guard test; fact 3's skip message names the exact ProjectReference that arms it; commit ef3bb4d)
Task 5: complete (commits 92ffbfd..ef3bb4d, review clean)
Tasks 6-10: BATCHED into one dispatch — five small same-shape transcription tasks building the domain
  primitives (Result<T>, EanCode, KvkNumber, Iban, the seven enums, Address, ContactPerson). All land in
  PeakPower.Domain with complete code in their briefs, 7-9 all consume 6, and none needs its own review
  surface. One dispatch, one review of the combined diff.
Tasks 6-10: complete (commits 67bf67f, 6dd86fb, 78a13b6, 0dbcecf, f7119f0 — review clean, all five spec OK)
  Reviewer reproduced ISO 7064 mod-97 independently in Python against three real IBANs and a self-computed
  off-by-one, confirmed EanCode accepts a value failing every GS1 weighting per [DEC-114], and confirmed
  the enum spellings character-for-character against the normative list.
Tasks 6-10: deviation ACCEPTED — EnumSpellingTests wrapped in new[]{...}; reviewer reverted one to the
  brief's bare-varargs form and got CS0411, proving Shouldly 4.3.0 has no params overload.
Tasks 6-10: deviation ACCEPTED — `using Xunit;` added to every new test file; reviewer confirmed
  ImplicitUsings injects only System.* namespaces.
Tasks 6-10: minor (deferred): EanCodeTests has no case isolating leading/trailing-only whitespace (behaviour is correct; the gap is inherited from the brief)
Tasks 6-10: minor (deferred): the implementer's report miscounts how many EnumSpellingTests assertions were bare varargs (says four, actually five)
Task 6-10: Ruling: this was the THIRD instance of the same defect from my FluentAssertions-to-Shouldly
  conversion — .Should().Equal(a,b,c) became .ShouldBe(a,b,c), but Shouldly's collection overload takes one
  IEnumerable, not a params list. Rather than wait for it a fourth time I scanned all six plans for the
  shape and fixed the five real breaks (four in plan 1, one in plan 2), leaving the two legitimate
  ShouldBe(expected, customMessage) calls alone.
  Cost if wrong: a compile error a task's own red-green cycle would catch.
Tasks 11-14: BATCHED — the four aggregates. Same shape (aggregate + its tests), and they are the exact
  contract §5.1 signatures that caused 20 blocking findings in the plan-consistency review, so the review
  is pointed hard at signature conformance rather than at behaviour alone.
Tasks 11-14: implementer DONE (dcaa886, 4fb5cbd, fc3bf18, e51d26c) — 89 domain tests green
Tasks 11-14: review — spec OK on all four; EVERY normative signature conforms character-for-character
  (Create/ChangeStatus/UpdateDetails, Create/UpdateProfile/Deactivate/SetPassword/RecordSuccessfulSignIn/
  BumpSecurityStamp, Attach with 11 params and no Commodity or validTo, EndDate, Rename, UpdateDetails,
  Brp.Create(code,name,isActive), Wallet.CreateEuroWallet). No SetStatus, CreateFor or EndOn anywhere.
  I verified the signature list myself before dispatching the review; the reviewer confirmed independently
  against the shared contract.
Tasks 11-14: deviation ACCEPTED — CS0234 rather than the brief's CS0246 in Task 14's RED. Reviewer
  reproduced it in a scratch worktree at fc3bf18 and confirmed the brief introduces three namespaces at once.
Tasks 11-14: deviation ACCEPTED — `using Xunit;` in all four test files.
Tasks 11-14: Ruling: the reviewer raised 2 Important and 3 Minor findings, all the same defect class —
  a guard with no test, PROVEN by deleting the guard and watching the suite stay green. I folded the three
  Minors into the same fix round rather than deferring them. The process says minors do not enter the loop,
  but these are the identical defect in the identical files the fix already touches, and deferring them
  would cost the final review a re-triage of five gaps that one pass closes now.
  Cost if wrong: a slightly larger fix diff than the process strictly requires.
Tasks 11-14: fix round 1/5 dispatched — five untested guards, each to be proven by delete-and-watch-it-fail
Tasks 11-14: fix round 1/5 (5 addressed, 0 open — 9 new failing-path tests, each proven by the re-reviewer deleting its guard and watching it go red; commit fc6807e)
Tasks 11-14: complete (commits f7119f0..fc6807e, review clean) — 98 domain tests
Tasks 15-17: BATCHED — the application ports (IMarketCalendar; IPasswordHasher, ITokenIssuer, IEmailSender) and the one implementation that satisfies IMarketCalendar. Task 17 implements Task 15, so they belong together, and 16 is three interface declarations of the same shape.
Tasks 15-17: complete (commits b2e5572, 1f04ead, a6b5c47 — review clean, NO findings)
  Amsterdam rule PROVEN: a test pins 21:30 UTC (still the 26th in Amsterdam) against 22:30 UTC
  (already the 27th), and a second covers CET in January, so both +1 and +2 offsets are exercised.
  A naive UtcNow.Date implementation fails the second assertion.
Tasks 15-17: deviation ACCEPTED — [SuppressMessage("Naming","CA1716")] on IEmailSender.SendAsync.
  The parameter name `to` collides with a VB.NET reserved word and TreatWarningsAsErrors makes it fatal.
  Reviewer confirmed CA1716 is NOT in the global NoWarn list (so this is targeted, not a quiet widening),
  and that plan 5's own ConsoleEmailSender uses the same parameter name — renaming would have broken the
  contract a later plan expects.
Tasks 15-17: NOTE FOR PLAN 5: ConsoleEmailSender.SendAsync will trip the same CA1716 and needs its own
  targeted suppression.
Tasks 15-17: minor (deferred): the report cites [DEC-118] as the reason test files need `using Xunit;`.
  DEC-118 is about Shouldly vs FluentAssertions; the using is an xunit.v3 implicit-usings matter. Prose only.

USER DIRECTION (mid-run): dispatch implementers in parallel where possible.
Ruling: adopted, bounded by the dependency graph. Tasks 18/19 -> 20 -> 21 -> 22 -> 23 are serial by
  construction — each needs the previous one's types, and they share PeakPowerDbContext plus EF's model
  snapshot, so concurrent implementers in one repo would race on the git index and on the snapshot file.
  What IS independent runs concurrently from here: Task 25 (tools/verify-aspire-api.sh) touches nothing
  the persistence chain touches, so it goes out alongside Tasks 18-19. Later, Tasks 26+27 and 28+29 pair
  off the same way. Batching stays the larger win and continues.
  Cost if wrong: two agents committing to one repo can collide on index.lock; assigned file sets do not
  overlap, so a collision costs a retry, not a lost change.
Task 25: implementer agent DIED on an API error ("the response stopped arriving") after its work had
  already committed as bd034b6, before writing its report.
Task 25: Ruling: did NOT re-dispatch. The commit was complete and in git; only the report was lost, and
  re-running the task would have redone work already done and risked a duplicate commit. Instead I verified
  the substance myself — ran tools/verify-aspire-api.sh (OK), then pointed an assertion at a member that
  does not exist and confirmed it fails naming that member, then restored and re-confirmed, leaving
  git status --porcelain tools/ empty — and wrote task-25-report.md marked plainly as a controller
  account rather than an implementer's. The task review is still being dispatched normally, and its prompt
  tells the reviewer the report is second-hand and to check it independently.
  Cost if wrong: the report records my verification rather than the implementer's, so anything the
  implementer did and did not commit is invisible. The commit itself is the artifact and it is intact.
Task 25: the check is a REAL guard — proven: FAIL names the missing member, exit 1.
  Nicely, the member it fails on is AddNpmApp, which is exactly what the specification's 9.x AppHost calls.
Tasks 18-19: implementer DONE (d2e4250 enum->SCREAMING_SNAKE by convention; 44bfe55 Address/ContactPerson
  as jsonb with a value comparer). Suite: 98 domain + 9 application + 6 architecture + 22 integration = 135 green.
Tasks 18-19 + 25: reviews dispatched in parallel.
Task 20: dispatched in parallel with those two reviews rather than idling. It depends only on the converters,
  which are committed and green. Risk accepted: if a converter review returns a finding, Task 20 may need
  rework — but the converters are self-contained and fully tested, so the exposure is small and the pipeline
  keeps moving, which is what the user asked for.
Tasks 18-19: complete (commits d2e4250, 44bfe55 — review clean, NO findings)
  The reviewer closed the implementer's own caveat: the shipped tests never exercise EnumToTextConvention,
  so it wrote a scratch DbContext with a brand-new enum property and proved the convention attaches a
  string converter automatically, with a control case showing no converter when it is not registered.
  That is the guarantee the whole design rests on, now actually demonstrated.
Tasks 18-19: deviation ACCEPTED — object.Equals(left,right) instead of bare Equals (CS0120 in this EF Core
  version), and a json.ShouldNotBeNull() added under TreatWarningsAsErrors (CS8604). Both mechanical.
Task 25: review — spec OK, quality Approved with ONE Important finding.
Task 25: minor (deferred): the negative AddNpmApp assertion has low guard value — it greps
  Aspire.Hosting.JavaScript's XML, but AddNpmApp never lived in that package (it was in the frozen
  Aspire.Hosting.NodeJs 9.5.2, which this project does not reference). A developer following the spec's
  stale snippet would fail at compile time anyway. Harmless trip-wire, kept as documentation.
Task 25: minor (deferred): WithRunScript is asserted but Task 27 never calls it — the run-script name goes
  in as AddJavaScriptApp's third positional parameter. Over-coverage, not under-coverage.
Task 25: fix round 1/5 dispatched to a FRESH implementer (the original died on an API error) — three
  Aspire entry-point members Task 27 calls are unasserted.
Task 20: implementer DONE (1bf67f1). Builds clean under -warnaserror, resolving the CS8620 the Tasks 18-19
  reviewer had warned was present in its in-progress code. Suite 151 green (integration 22 -> 38).
Task 20: deviations declared — #pragma warning disable CS8620 around two jsonb HasConversion calls in
  CustomerConfiguration.cs, and [SuppressMessage("Performance","CA1873")] on DatabaseMigrator.RunAsync for
  a brief-mandated string.Join log argument. Both sent to the reviewer to adjudicate; no mapping, type,
  length or index was changed to work around either.
Ruling: HOLDING Tasks 21, 22 and 23 until Task 20's review is clean. Task 21 generates migration 1 FROM
  Task 20's model, so a mapping defect the review catches after the migration exists costs a corrective
  migration — which is exactly what reviewing the model first is for. Task 23 consumes Task 20's
  PersistenceServiceCollectionExtensions directly and has the same exposure.
  Cost if wrong: some serialisation the user asked me to avoid; the alternative risks a schema mistake
  baked into a migration that later plans build on.
Tasks 24 and 26: dispatched in parallel instead — neither touches persistence. Task 24 owns
  ServiceDefaults/Extensions.cs and the two API host Program.cs files; Task 26 owns
  src/Hosts/PeakPower.AppHost/. Disjoint from each other, from the Task 25 fix (tools/), and from the
  Task 20 review (read-only).
Task 25: fix round 1/5 (1 addressed — CreateBuilder, Build and Run now asserted; commit 164dcfd). Fixer
  proved it real by breaking CreateBuilder and watching the script name the missing member.
Task 25: complete (commits bd034b6..164dcfd, review clean)
Task 24: implementer DONE_WITH_CONCERNS (5f8e82f). Flagged honestly and unprompted that deleting
  AddMarketCalendar() breaks NO test, because nothing in the shell hosts resolves IMarketCalendar through
  DI yet — so the guarantee I designed in (every host gets the calendar; a host that forgot fails at
  resolve time) is currently unprotected. It flagged rather than adding an unscoped test. Sent to the
  reviewer to adjudicate WITHOUT my pre-judging it.
Task 26: implementer DONE (98028f4, 37f77e7 — 11 AppHost tests, one added during its own self-review
  proving PEAKPOWER_WEB_PATH wins over an existing sibling, which is the precedence assertion that
  actually pins the resolution order). Correctly re-ran through a transient CS1061 caused by a concurrent
  agent's mid-edit rather than touching that file — the concurrency instructions held.
Reviews running in parallel: Task 20, Task 24, Task 26. Suite at 168 green, build 0 warnings.
Task 20: complete (commit 1bf67f1, review clean). Reviewer mutation-tested ModelShapeTests three ways in
  DISPOSABLE GIT WORKTREES (disabled the enum convention, removed Wallet's unique index, retargeted
  Customer's schema) — all three caught, so the tests assert real model facts rather than "it builds".
  Both suppressions adjudicated correct: CS8620 is an NRT-annotation false positive and the alternative
  overload would have traded it for losing EF's real type check; CA1873 cannot be scoped narrower than
  the method in C#.
Task 20: minor (deferred): the CS8620 pragma pattern will recur for any future non-nullable jsonb property.
Task 26: complete (commits 98028f4, 37f77e7 — review clean, NO findings). Reviewer mutation-tested all
  three resolution branches and confirmed the precedence test — not the weaker "wins when it is the only
  one that exists" test — is what actually pins the order. Failure message names the path searched, both
  remedies and the --backend-only escape hatch, and the tests assert its CONTENT, not just that it threw.
Task 24: review — spec OK, Approved with ONE Important finding: AddMarketCalendar is registered but
  untested. Reviewer reproduced the gap AND wrote and verified the exact fix, then removed it uncommitted.
Ruling: Task 24's reviewer also reported PEAKPOWER_WEB_PATH_wins_even_when_the_sibling_checkout_also_exists
  as a pre-existing failure. It is NOT flaky. I ran the AppHost suite with and without PEAKPOWER_WEB_PATH
  set, and the full solution twice: 11/11 and no failures every time. That reviewer ran the full solution
  while Task 26's agent was mid-commit and saw a half-written state — the exact concurrency artifact my
  dispatch instructions warned about. No action; recorded so nobody chases it later.
  Cost if wrong: if it IS environment-dependent in some setup I did not try, it surfaces in the final
  whole-branch review, which runs against a quiet tree.
Task 24: fix round 1/5 (1 addressed — AddServiceDefaults_registers_the_market_calendar, proven red when
  AddMarketCalendar() is deleted and green when restored; commit 4d5a194). The fix also added
  PeakPower.Application and PeakPower.ServiceDefaults ProjectReferences to the Integration.Tests project.
  I checked that against the architecture facts: they bind the PRODUCTION Domain and Application projects,
  not test projects, and facts still pass 6/1-skip with the build clean.
REGRESSION FOUND BY ME, not by a review: tools/verify-solution-layout.sh was FAILING with
  "PeakPower.Domain has a ProjectReference". False positive — Domain.csproj has zero ProjectReference
  ELEMENTS; the guard greps the bare word and matches its own comment, "Do not add a ProjectReference here".
Ruling: Task 3's implementer had dodged this by rewording that comment. Task 4 then rewrote the file to
  its brief's literal text, restoring the word and the false positive, and nothing caught it because Task
  4's review ran the NetArchTest facts rather than the shell guard — so the guard sat red through Tasks
  5-24 unnoticed. Fixed at the source: the check now matches "<ProjectReference" (the element), which is
  what the Task 3 reviewer's minor finding said all along ("no XML awareness, cannot tell a comment from
  an element"). Fixed in the plan text too (621633e) so re-running the plan cannot reintroduce it, and in
  the repository (9fb3473), with the fixer proving the guard still catches a genuine ProjectReference.
  Cost if wrong: none — the stricter pattern is a superset of correct matches; a real element still trips it.
LESSON RECORDED: task reviews ran the tests the brief named and did not re-run the earlier verify-*.sh
  guards. The final whole-branch review must run ALL FOUR verify scripts, not just the test suite.
Ruling: the Task 24 re-review came back BLOCKED, not with a verdict. It tried to build the live tree while
  Tasks 22 and 23 had uncommitted work in it, and hit CS1061 in Task 22's half-written
  MigrationBehaviourTests.cs. That is a cost of the parallelism the user asked for, and it is fixable:
  reviews must read a COMMIT, not the working tree. Task 20's reviewer solved this unprompted by creating
  a disposable `git worktree` at the commit under review, running everything there, and removing it.
  Adopting that as standard for every remaining review dispatch, and re-dispatching the Task 24 re-review
  once the tree is quiet.
  Cost if wrong: a worktree per review costs a few seconds of disk; the alternative is reviews that fail
  for reasons unrelated to what they are reviewing.
Task 21: complete (commit 5925eb8, review clean, NO findings). Reviewer settled my scepticism about the
  changed test assertion the right way: it deleted all four EnsureSchema calls, regenerated the script, and
  confirmed "CREATE SCHEMA" then appears NOWHERE — so the new assertion would not pass against a migration
  that creates no schemas. Not a ratified defect. Also reproduced the CA1861 error to confirm the
  .editorconfig suppression is real and proved its scope does not reach hand-written code outside Migrations/.
Task 22: implementer DONE (c5e89f6) — ran against a REAL postgres:17 Testcontainers container with a
  red/green cycle: 69/72 with the exclusion constraint disabled, 72/72 restored. The EAN overlap invariant
  is now empirically enforced by the database, asserting SqlState == ExclusionViolation (23P01) rather than
  merely that something threw.
Task 23: implementer DONE (a112d14) — migrator applies to completion and exits with a meaningful code.
All five verify-*.sh guards pass. Suite 196 green.
Task 27: implementer DONE (f118cca) — Aspire resource graph. 201 tests green, -warnaserror clean.
Tasks 28 and 29: dispatched in parallel — they are in DIFFERENT repositories (28 in peakpower-platform,
  29 in peakpower-web), so this is the one genuinely conflict-free parallel pair in the whole plan.
Task 22: complete (commit c5e89f6, review clean). STRONGEST verification in the run: the reviewer worked in
  a disposable worktree, mutated the generated column from '[)' to '[]', and confirmed
  Two_touching_but_non_overlapping_periods_for_the_same_EAN_are_accepted then FAILS with 23P01 — proving
  the half-open boundary is genuinely pinned and an off-by-one cannot slip through. It also dropped the
  exclusion constraint entirely and reproduced the implementer's 69/72 exactly, same three tests.
  Extensions confirmed installed by querying pg_extension, not by reading script text. No leaked containers.
Task 22: deviations ACCEPTED — three of the four independently reproduced (using Xunit; the deprecated
  parameterless PostgreSqlBuilder genuinely emits CS0618; CA1711 on PostgresCollection is a real error and a
  known xUnit false positive). The fourth (using Microsoft.EntityFrameworkCore) accepted on domain grounds.
Task 22: minor (deferred): task-22-report.md says 12 tests; --list-tests shows 15 discovered cases. Report only.
Task 22: minor (deferred): Two_different_EANs_may_hold_the_same_period counts rows filtered only by
  valid_from, not by the two EANs under test; ShouldBeGreaterThanOrEqualTo(2) would be tighter as
  WHERE ean IN (...) with ShouldBe(2). Works today because a violation throws before the count runs.
Task 27: complete (commit f118cca, review clean). Reviewer verified the whole resource graph in a
  disposable worktree, ran verify-aspire-api.sh, and mutation-tested FrontEndPlan two ways (inverting the
  package.json check and the backend-only short-circuit both caused real failures). Both declared
  deviations reproduced exactly and adjudicated as cosmetic brief mispredictions.
Task 27: minor (deferred) — FOR THE FINAL REVIEW TO TRIAGE: nothing tests WaitForCompletion vs WaitFor in
  Program.cs. The reviewer swapped BOTH calls to WaitFor and the build succeeded with all 16 tests still
  passing. The wiring is CORRECT today — verified — but only the build enforces it, and the distinction is
  what stops an API starting against a half-migrated database. This is the fourth appearance of the same
  defect class in this plan (AssemblyProbe, the five domain guards, AddMarketCalendar, now this).
  I am NOT unilaterally fixing it: the reviewer labelled it Minor, the brief explicitly scoped the Aspire
  wiring to "verified by the build and by ./dev-up in Task 28", and I have already made several
  scope-expanding rulings. The final whole-branch review is the right place to decide whether it must be
  fixed before merge. Flagging it there explicitly rather than letting it sit in a list nobody reads.
Task 23: complete (commit a112d14, review clean). Exit codes verified by RUNNING the built binary against a
  throwaway postgres:17: success 0, idempotent re-run 0, missing connection string 1 naming
  ConnectionStrings__peakpower, unreachable database 1 with "Connection refused". Negative control with the
  placeholder Program.cs reproduced all five verify-migrator.sh FAIL lines, so the guard is real. Its greps
  scan captured process logs, not source files, so the bare-word-matching-a-comment failure mode cannot apply.
Task 24: complete (commits 5f8e82f..4d5a194, review clean — fix ADDRESSED, red output quoted).
Task 24: minor (deferred): the fix added THREE ProjectReferences, not two, and the reviewer proved none is
  strictly necessary — the test project already reaches all three transitively through the two API hosts.
  Harmless (makes a transitive dependency explicit) but it is scope creep.
Tasks 28-29: implementer DONE_WITH_CONCERNS (3df7588 platform, 2fe0aed web). Verified by RUNNING both
  scripts' failure and dry-run paths and a real non-dry-run ./dev-up --backend-only that brought up
  postgres, pgadmin, the migrator and customer-api under Aspire, then cleaned up.

FINDING FOUND BY ME (definite) — ./dev-up dirties the repository. Running it creates
  src/Hosts/PeakPower.AppHost/aspire.config.json, which is NOT in .gitignore. Confirmed with
  `git check-ignore` (NOT IGNORED) and `git status` after a real run. Every developer who runs the
  plan's headline command gets a dirty tree and can commit the file by accident. Goes to the final
  whole-branch review's single fix wave rather than a controller fix.

FINDING I COULD NOT REPRODUCE — the implementer reported employee-api exiting ~1.6s after starting while
  customer-api kept running. I ran the employee API standalone: it starts and stays up. I then ran
  ./dev-up --backend-only myself and read the Aspire CLI log: BOTH APIs made identical transitions,
  Starting -> Waiting on the migrator, with no exit for either. My run was cut short before the migrator
  finished, so I cannot rule the report wrong — only say I did not see it. Recorded for the final review
  rather than closed, because "one command brings up the whole system" is this plan's headline promise and
  an API that dies on startup would break plan 2's ground.
Tasks 28-29: complete (3df7588 platform, 2fe0aed web — review clean, spec OK both). Reviewer ran all four
  failure/dry-run paths live and a real non-dry-run --backend-only, and proved the flag crosses the
  `dotnet run --` boundary into the C# process by finding the AppHost's own log line, not just the shell's.
  Symmetry verdict: the web side's HANDOVER is the right design, not a symmetry gap — the AppHost starts
  npm through AddJavaScriptApp, so a second npm start from the web side would race it for the port.
Tasks 28-29: minor (deferred): task-29-brief's DoD item 9 describes the wrong console line for
  --backend-only (it quotes item 10's no-args text). Brief wording, not a code defect.

INVESTIGATED AND CLOSED — the stale Postgres volume. The Tasks 28-29 reviewer could not bring the stack
  fully up: the migrator was blocked by "password authentication failed for user postgres" against the
  peakpower-postgres-data volume. I checked whether this is a design defect, because a persistent volume
  plus a regenerated password would mean ./dev-up works once and fails forever after — fatal for this
  plan's headline promise. It is NOT: the AppHost carries <UserSecretsId>peakpower-apphost</UserSecretsId>,
  Program.cs documents that it is what keeps the volume usable across runs, and the secrets file really
  does hold Parameters:postgres-password. The design is right. What is stale is this machine: the volume
  was created at 05:39:58Z during mid-plan development runs, under a password that no longer matches.
  Resolution is `docker volume rm peakpower-postgres-data`, which I did NOT run — it is destructive and
  the volume is the user's, so it is theirs to clear. Surfaced to them directly.
  This also plausibly explains the unreproduced employee-api report: a stack that cannot get past the
  migrator behaves oddly downstream.

=== WHOLE-BRANCH REVIEW ===
Four lenses (correctness, contract, quality, triage) + synthesis. 26 findings, 7 flagged merge-blocking
by their lens, deduplicated to 3 genuinely blocking.

CRITICAL, found independently by ALL FOUR lenses: neither API host declares an HTTP endpoint. There is no
  Properties/launchSettings.json in either project and no WithHttpEndpoint in the AppHost, so Aspire
  allocates no port, never sets ASPNETCORE_URLS, and both hosts fall back to Kestrel's built-in :5000.
  Whichever binds second dies of AddressInUseException ~1.6s after reaching Running.
  THIS ROOT-CAUSES the employee-api report I could not reproduce. It was never employee-specific — it is a
  race, which is exactly why byte-identical Program.cs files behaved differently and why my own run (killed
  while both were still Waiting on the migrator) never saw it. The lenses' disagreement about WHICH host
  died was the tell.

Ruling: an UNCOMMITTED, UNATTRIBUTED fix for this Critical was sitting in the live working tree when the
  synthesis ran — Program.cs with .WithHttpEndpoint() on both APIs, a new ApiEndpointTests.cs, and an
  Aspire.Hosting.Testing package entry. I did not dispatch it; a review lens left it behind despite being
  told to work in a disposable worktree. The synthesis advised committing it rather than redoing it.
  I REVERTED it instead. The work looked good — correct diagnosis, a real two-case test including port
  uniqueness — but it passed no review gate and I cannot attribute it, and committing it would launder an
  unreviewed edit into a branch where every other change was gated. I saved a reference copy to the
  scratchpad and carried the diagnosis into the fix brief, so nothing of value is lost.
  Cost if wrong: the fix wave re-does ten lines that already existed.

Synthesis REJECTED one lens finding: "contract §5.2's JsonStringEnumConverter has no owner" is wrong —
  plan 2 owns it as EnumWireFormat and registers it via ConfigureHttpJsonOptions. The lens grepped the
  type name and missed the wrapper. No action.

Fix wave (one dispatch) covers 3 blocking + 5 should-fix-now.
FINAL FIX WAVE: complete (c1fe50e, 8233f96, bc44761, f64a68b in peakpower-platform; d480138 in the
  peakpowerspecs worktree). Scoped re-review: ALL EIGHT findings ADDRESSED, every one mutation-proved —
  removed WithHttpEndpoint from one API and watched only that theory case go red; swapped
  WaitForCompletion for WaitFor and watched the new assertion catch it; dropped a scratch
  PeakPower.Something.dll into the output and watched AssemblyProbe's new reverse check name it; added a
  ProjectReference inside a worktree and confirmed the guard run FROM the worktree fails while the live
  checkout still passes — the false-OK is closed.
BLOCKING 3 resolution ACCEPTED by the re-review: keep the seeded PVNED row and document it normatively in
  shared contract §3.2 with id, code, name, is_active and the exact SingleAsync query. Dropping it would
  have broken plan 1's own already-green migration tests. The contract note also flags that plan 6 has the
  identical insert-don't-read pattern in five places.
RESIDUAL (surfaced, no second fix wave — the process allows only one):
  - verify-repositories.sh's [[ -d "$repo/.git" ]] does not recognise a git worktree's FILE-based .git, so
    it reports "not a git repository" when run from a worktree. Pre-existing, untouched by the wave, and
    not the hardcoded-root defect finding 4 named.
  - dev-up.test.sh check #3 still asserts the literal string "web root: /Users/thinhhuynh/PeakPower/
    peakpower-web", so it only passes from the original path. Same status.
  - verify-migrator.sh was intermittently flaky in the re-reviewer's session: `dotnet run` sometimes did
    not honour the Migrations/.editorconfig CA1861 suppression, plus a transient CS0006 ref-assembly race.
    `dotnet build -warnaserror` and `dotnet test` were reliably green throughout. Environment quirk.
