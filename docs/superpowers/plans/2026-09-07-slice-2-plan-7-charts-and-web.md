# Charts and the Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a correct, honestly-labelled day and month of a customer's own metering data on screen — two hand-rolled SVG chart components in `@peakpower-nl/shared-ui`, the `/consumption` screen that navigates them, the five data-state treatments, the connection-detail data-quality strip, the rewritten dashboard copy, and the employee ingestion-health screens.

**Architecture:** `PpUsageChart` and `PpUsageMonthChart` are the entire replaceable surface (**S2-D5**): they take the frozen `PpUsageDay` / `PpUsageMonth` shapes in, emit SVG and semantic events out, and no consumer passes a colour, a scale, an axis configuration or a formatter. The customer portal's `/consumption` screen maps the frozen HTTP envelopes (shared contract §10.1, §10.2) onto those shapes with a pure function and owns every piece of navigation. The employee portal's `/data-feeds` area renders the four data-health responses (§10.4) with `httpResource`, the same pattern `brp-list-page.ts` already uses.

**Tech Stack:** Angular 22.1.3 runtime · `@angular/cli` / `@angular/build` 22.1.6 · TypeScript 6.0.3 · Vitest 4.1.11 via `@angular/build:unit-test` · jsdom 30.0.1 · rxjs 7.8.2 · tslib 2.8.1 · `openapi-typescript` 7.13.0 · Playwright 1.56.1 · **zoneless change detection — no `zone.js`, no `provideZoneChangeDetection`**

**Spec:** docs/superpowers/specs/2026-09-07-poc-slice-2-design.md
**Shared contract:** docs/superpowers/plans/2026-09-07-slice-2-shared-contract.md

---

## Global Constraints

Every task implicitly includes this section. **Read it before task 1 and do not re-derive any value in it.**

### The two repositories, and which one this plan owns

```
/Users/thinhhuynh/PeakPower/peakpower-platform      # .NET     — NOT touched by this plan
/Users/thinhhuynh/PeakPower/peakpower-web           # Angular  — this plan owns it
```

**Every path in this plan is relative to `/Users/thinhhuynh/PeakPower/peakpower-web` unless it says otherwise.** The one exception is the mockups, which live in the **spec** repository at
`/Users/thinhhuynh/PeakPower/peakpowerspecs/specs/60-mockups/` and are never copied into `peakpower-web`.

`npm test` and `npm run test:workspace` need a `peakpower-platform` checkout, because
`tools/verify-clients.test.mjs` regenerates both committed API clients from the platform's OpenAPI
documents and diffs them byte-for-byte. In a git worktree the platform is usually **not** a sibling,
so set the path explicitly:

```bash
PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform npm test
```

A missing checkout is a **hard failure, not a skip** — `generateTypes()` throws
`"Build peakpower-platform first, or set PEAKPOWER_PLATFORM_PATH to its checkout."`

### Versions — exact, verified 2026-09-07 (shared contract §1)

| | |
| --- | --- |
| Angular | **22.1.3** runtime (`@angular/core`, `common`, `compiler`, `compiler-cli`, `forms`, `platform-browser`, `router`), **22.1.6** tooling (`@angular/cli`, `@angular/build`) |
| TypeScript | **6.0.3** |
| Vitest | **4.1.11** · jsdom **30.0.1** · Playwright **1.56.1** |
| rxjs | **7.8.2** · tslib **2.8.1** · `ng-packagr` **22.1.1** · `openapi-typescript` **7.13.0** |
| `@types/node` | **24.13.3** |
| Node / npm | **24.15.0 / 11.12.1** |

**Do not add a package.** This plan installs nothing: `[OQ-22]` (the charting library) and `[OQ-49]`
(the component library) are both deferred by **S2-D5**, and every chart, every date control and
every tooltip below is hand-rolled out of what is already in `package.json`.

### Commands

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web

npm run test:shared-ui         # ng test shared-ui --watch=false
npm run test:customer-portal   # ng test customer-portal --watch=false
npm run test:employee-portal   # ng test employee-portal --watch=false
npm run test:workspace         # node --test tools/*.test.mjs
npm test                       # all four, in that order

npx ng build shared-ui         # RUN THIS after every change to public-api.ts
npm run generate:clients       # rewrites both committed *-schema.d.ts
npm run verify:clients         # fails on drift; never writes
npx playwright test
```

⚠ **Never run `node --test tools/` in its bare directory form** — it fails with `MODULE_NOT_FOUND`
on Node 24.15.0. The npm script's `node --test tools/*.test.mjs` glob is the working form.

⚠ **Run `npx ng build shared-ui` after any change to `public-api.ts`.** A duplicate or malformed
export compiles and leaves the whole suite green; only the library build catches it. This has
happened in this repository.

### What this plan owns exclusively (shared contract §17, row 7)

- `PpUsageChart`, `PpUsageMonthChart` and the `libs/shared-ui/src/public-api.ts` additions (§11.1, §11.2)
- the extended design-token guard (§11.5)
- the `/consumption` route and the rail row (§11.6)
- **all five Angular guard literals** (§11.7)
- navigation, the five treatments, the KPI strip, the empty state, the connection strip, the
  dashboard copy, the employee data-health screens
- the regenerated typed clients

It may **only read** §10 (frozen) and §11, and it **never changes a `--pp-chart-*` token value**.

### The frozen shapes this plan renders

**Shared contract §11.2 — normative, transcribed here so no task re-invents a field name:**

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
```

```ts
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
missing intervals still has 100 slots and four gaps. Using `intervals.length` silently rescales the
day, which is precisely the failure `[F03-R06]` forbids.

⚠ **Volumes are `number | null` and nothing in this plan ever coalesces `null` to `0`.** Missing is
a gap in the path, not a point on the zero line. `null` means missing; `0.0` means measured zero.
A mapper or a component that writes `?? 0` has erased the distinction the whole slice exists to
preserve.

⚠ **`dstPass`** is `"A"` for the first pass of the autumn duplicate hour (Pos 9–12) and `"B"` for
the second (Pos 13–16); `null` on every other interval of every other day. The chart composes
`02:00 A` / `02:00 B` from it and must **not** re-derive the pass from the UTC offset.

### The seven `--pp-chart-*` tokens — verified today, all seven already exist

Read from `libs/shared-ui/src/styles/colors.css:52-55`. **No new colour token is created for the
charts**; a chart that needs a colour uses one of these or an existing palette token.

```css
--pp-chart-usage:#006ECF;        --pp-chart-hedge:#004C94;
--pp-chart-short:#FF8F5C;        --pp-chart-short-stroke:#F24F4F;
--pp-chart-long:#0FA69D;         --pp-chart-long-fill:#00D4C6;
--pp-chart-peak:#3C93FA;
```

`--pp-chart-short`, `--pp-chart-short-stroke` and `--pp-chart-peak` are **unused in slice 2** — they
belong to the deferred coverage bands and peak shading. Leave them alone.

The series-to-token-to-stroke mapping, shared contract §11.3:

| Series | Token | Value | Stroke |
| --- | --- | --- | --- |
| **Net usage** (the `[DEC-22]` basis, drawn on top) | `--pp-chart-usage` | `#006ECF` | solid, 2px |
| **Consumption** | `--pp-chart-hedge` | `#004C94` | dashed `6,3`, 1.5px |
| **Production** | `--pp-chart-long` | `#0FA69D` | dotted `2,3`, 1.5px |
| Zero line (always drawn) | `--pp-border-strong` | `#c3cddb` | solid, 1px |
| Corrected-on marker | `--pp-violet` | `#9151B8` | — |
| Provisional / partial hatching | `--pp-amber` | `#EEB72B` | — |
| Declared-zero production label | `--pp-text-faint` | `#8b98aa` | — |

⚠ **The dash arrays are written with COMMAS, not spaces.** `cssText()` collapses all whitespace, so
`stroke-dasharray: 6 3` becomes the string `stroke-dasharray:63` in every rule-scoped assertion —
indistinguishable from the number sixty-three, and from `63` written by mistake. `6,3` collapses to
`6,3` and stays readable and assertable. SVG and CSS both accept the comma form.

⚠ **All three series declare `stroke-dasharray` explicitly, including the solid one, which declares
`none`.** Design §7.16 requires the three to be distinguishable by stroke pattern *with colour
removed*, and an assertion over three values is only meaningful when all three exist. An absent
declaration is not a third pattern; it is a missing one.

⚠ **`--pp-indigo` means violet / corrected, never the hedge line** (slice 1 §11, rule 2). It is the
corrected-on marker's alias and nothing else. This plan names `--pp-violet` directly.

⚠ **There is no dark theme in this workspace.** `colors.css` declares one `:root` block and no
`prefers-color-scheme` or `[data-theme]` variants. Design §7.16's "in both themes" is satisfied by
the tokens' documented 3:1-on-white property; **do not invent a dark palette in this slice.**

### Copy rules (shared contract §14)

Sentence case everywhere. ALL CAPS only for stat-card labels and table column heads —
`pp-stat-card` applies that itself in CSS, so a label is typed in sentence case and rendered in
caps. **No emoji, no icon set.** Every number carries its provenance in a faint sublabel. Empty and
disabled states name the reason. nl-NL numbers via `formatDutchDecimal`, minus as **U+2212 `−`**
(`PP_MINUS`), unavailable as **U+2014 `—`** (`PP_UNAVAILABLE`).

Two rules this plan leans on hardest:

- **"Projected" = not yet measured; "Provisional" = not yet accepted. Never swap them.** A
  `PROVISIONAL` day is measured, and calling it projected is a lie about a number the customer will
  be invoiced on. **No string this plan writes contains the word "projected".**
- **A declared zero is not an absence.** `[F02-R33]`: *"Where `production_expectation` is `NEVER`,
  production for every interval of that date is zero, and net usage is therefore the consumption
  value. This zero is a declared value taken from master data, not an absence inferred as zero: it
  traces to the source, the setter and the date recorded with the claim `[F01-R40]`, and the
  data-quality panel says so."*

The five treatments, named so plan 6 and this plan agree: **gap** · **partial** · **provisional** ·
**corrected-on** · **declared zero**.

### Volumes only — S2-D6

**No price, no euro figure and no €/MWh anywhere in this plan.** `[F03-R05]`'s tooltip price,
`[F03-R19]`'s indicative spot value and the cost/credit pair are all out (design §3.2). The day-view
mockup `chart-day-view.svg` is drawn **with** the block overlay, the coverage KPIs, "Hedge this
exposure", `€ 96,50/MWh` and a `SPOT RESULT` card. **Build to the frozen envelope, not to the mockup
verbatim.** A spec in this plan asserts that no component source contains a `€`.

### Accessibility — six gaps were closed on 2026-09-03; do not regress them

`peakpower-web`'s `CLAUDE.md` "Known gaps" section still lists them as open. It is stale: roadmap
§2.2's six gaps were all closed in `peakpower-web` on 2026-09-03 (commits `e476cf7`, `3a7726c`,
`bf1edc5`, `e0d5670`, `192ec9c`, `5f13bea`), and design §11 row 6 carries the correction. What is
actually in the tree today, verified:

- `PpSkipLink` (`libs/shared-ui/src/lib/skip-link/pp-skip-link.ts`), rendered by
  `apps/customer-portal/src/app/app.ts:40` whenever the chrome is showing.
- One `<main id="pp-main" tabindex="-1">` per portal, at `app.ts:50`, **outside** every condition.
  A routed page **must not** declare a `<main>` of its own — that would give the document two
  landmarks and make `#pp-main` depend on which route is showing.
- Real `<h1>`–`<h6>` via `PpCard.headingLevel` (`libs/shared-ui/src/lib/card/pp-card.ts:34-42`) and
  via literal `<h1>` on the two connection screens.
- `aria-describedby` wiring in `apps/customer-portal/src/app/shared/form-field.ts`.
- The design-token guard, `apps/customer-portal/src/app/shared/design-tokens.spec.ts`.

Every new screen in this plan therefore: renders exactly one page-level heading, uses `PpCard`'s
`headingLevel` for card headings under it, declares **no** `<main>`, and gives every interactive
control a real `<button>` or `<a>` with an accessible name.

⚠ **The charts are hover-and-keyboard, not touch.** `[F03-R25]` is deferred (design §3.2) and the
deferral is deliberate: touch is one of the three things F03 §10 says the charting library must do,
so it is left to stress the Phase-2 candidate. That does **not** license an inaccessible chart: the
day chart carries a focusable plot with arrow-key traversal and `intervalActivated` on Enter, and
the month chart's bars are real `<button>` elements.

### Testing conventions — read these before writing a spec

From `peakpower-web/CLAUDE.md`, and every one of them was found repeatedly during slice 1:

- **Assert that the thing works, not that it exists.** Before calling a spec done, ask: if I emptied
  the component's body, would this still pass?
- **Assert a NON-DEFAULT value.** If the only value tested is also the default, a hardcoded literal
  passes it.
- **Where an input declares `InputSignalWithTransform`, drive the bare-attribute form** (`''` → `true`).
- **Scope CSS assertions to the rule, never the file.** Use `ruleBody(cssText(path), selector)` —
  it throws on a missing selector and throws when a selector matches more than one rule.
- **Scope DOM assertions to the element, never the page.**
- `TestBed.createComponent(...)` needs `{ inferTagName: true }`, and the tag-name assertion it
  enables is vacuous — Angular reads the selector off the decorator, the same literal the test
  hardcodes. It catches a typo, nothing more.
- `cssText()` strips comments and collapses **all** whitespace: a descendant combinator `.a .b` and
  a compound selector `.a.b` are indistinguishable after collapsing. Pass the selector exactly as it
  appears post-collapse.
- **Design tokens are a verbatim port.** `libs/shared-ui/src/styles/*.css` is pinned byte-for-byte
  by `tokens.spec.ts`. **This plan does not touch those files.**

Two helpers, and they are different files on purpose:

| Helper | Reads | Used by |
| --- | --- | --- |
| `libs/shared-ui/src/testing/read-css.ts` — `cssText`, `ruleBody`, `PP_BRIGHT_FILL_TOKENS`, `colorDeclarations` | a `.css` file under `libs/shared-ui/src` | library specs |
| `apps/customer-portal/src/testing/component-css.ts` — `componentStyles`, `cssText`, `collapse`, `ruleBody` | a component's `styles:` template literal, path relative to the workspace root | customer-portal specs |
| `apps/employee-portal/src/testing/component-css.ts` — the same four | the same | employee-portal specs |

The apps' copy is deliberately **not** an import from the library's: a deep relative path out of
`apps/` into `libs/shared-ui/src/testing` is the cross-project reference `tools/workspace.test.mjs`
exists to keep out of the portals, and `./testing` is not in the package's `exports` map.

### Mutation verification — this repository's stated standard

**Break it first, predict the failure, watch it go red, check the failure is the one you predicted,
then fix it. A green test that was never seen red is not evidence.** Every task below carries an
explicit **Mutation check** step naming *what to break*, *what failure to predict* and *what to
watch go red*.

⚠ **A mutation that breaks the BUILD proves nothing about an assertion.** If deleting a transform
orphans its import, delete the import too so the code still compiles.

⚠ **Mutate the case your assertion is actually for, not the easy neighbouring one.** `CLAUDE.md`
records a guard that was mutation-verified against "the property does not exist" but never against
"the property exists under a different casing", and so certified a half-working guard.

⚠ **Restore immediately, and never batch mutations.**

### Shouldly is a .NET concern; this plan uses Vitest `expect`

Nothing in this plan touches xUnit, Shouldly or NSubstitute. Where a slice-2 sibling plan says
`actual.ShouldBe(expected)`, this plan says `expect(actual).toBe(expected)`.

---

## Domain terms used below

- **EAN** — the 18-digit number identifying one electricity metering connection in the Netherlands.
  Rendered in a monospace font, grouped for reading: `8716 8710 0000 0000 11`.
- **Net usage** — `consumption − production`, **per interval**, `[DEC-22]`. It may be negative; a
  negative interval is export and is settled separately under `[DEC-23]`. It is the basis of the
  whole product, which is why it is the solid line drawn on top.
- **Delivery date / metering day** — one Amsterdam calendar day. 96 fifteen-minute intervals
  normally, **92** on the spring-forward Sunday and **100** on the autumn fall-back Sunday.
- **Data state** — `NO_DATA` → `PARTIAL` → `PROVISIONAL` → `FINAL`. ⚠ **There is no `COMPLETE`
  member** (shared contract §4): "Complete" is the *condition* that moves a day to `PROVISIONAL`,
  not a fifth state.
- **BRP** — balance responsible party. `PVNED` is the only row seeded.
- **Quarantine** — a series that parsed correctly but could not be attached to a metering point.
  Four reasons: `UNKNOWN_EAN`, `EAN_VALIDITY`, `WRONG_BRP`, `NOT_ELECTRICITY`.

---

## The interval START-versus-END trap — read this before task 2

`trading-poc` is a working prior implementation of these two charts and of the net-usage maths, and
it carries a documented fix for a bug that shifted an entire position fifteen minutes late.
`trading-poc/consumption-calc.js:43-58` says it in its own words:

> A peak block is held 08:00-20:00 wall-clock. Stored labels are interval **STARTS** … "08:00"
> covers 08:00-08:15, inside the block; "20:00" covers 20:00-20:15, outside it. … The UI shows the
> same intervals END-labelled … Don't "simplify" this comparison to match the sample's literal
> strings: applied to start labels, `> "08:00" && <= "20:00"` holds the block from 08:15 to 20:15 —
> **the whole position 15 minutes late, which is the bug this replaced.**

`trading-poc/customer-portal.html:5479-5487` then places its hour ticks at each interval's **RIGHT**
edge, because in that codebase a tick names the instant an interval **ends**.

**In this plan the convention is the opposite, and it is fixed by the envelope, not by taste.**
Shared contract §10.1 gives every interval both `start` and `end`. Therefore:

1. A point is plotted at the **centre** of its own slot: `x = padLeft + (pos − 0.5) × slotWidth`.
2. An hour **tick** is drawn at the **LEFT** edge of the slot whose interval starts on the hour:
   `x = padLeft + (pos − 1) × slotWidth`. The tick names the instant the interval **starts**, and
   that instant is the left edge of the slot.
3. A **tooltip** names the whole range, `10:30 – 10:45`, built from `start` and `end` — never from
   one of them plus arithmetic.

Rule 2 is the one that goes wrong silently: placing a start-labelled tick at the right edge draws
every hour label one slot late, which on a 96-point day is fifteen minutes and on the axis is
invisible. **Task 3 mutation-verifies it explicitly.**

Two more things worth taking from the prior art rather than rediscovering:

- **One polyline per unbroken run, never one across a gap** (`customer-portal.html:5402-5415`,
  `lineSegments`). A single `<polyline>` spanning a missing interval draws usage nobody measured.
  ⚠ That implementation drops a run of length 1 entirely (`if (run.length > 1)`), so a single
  measured interval between two gaps disappears. Task 2 fixes that: a run of one renders a dot.
- **Seed the axis at zero on both sides** (`customer-portal.html:5425-5426`, `minVal = 0, maxVal = 0`
  before the scan) so the zero line is always inside the plot, and guard the degenerate case
  (`if (minVal === maxVal) { maxVal = minVal + 1; }`) so an all-zero day does not divide by zero.

---

## File Structure

Every path is relative to `/Users/thinhhuynh/PeakPower/peakpower-web`.

### `libs/shared-ui` — the two chart components (step 11a)

| File | Responsibility |
| --- | --- |
| `src/lib/usage-chart/usage-chart.types.ts` | The five frozen interfaces of shared contract §11.2. Types only — no Angular import, so a consumer can type against them without pulling the components in. |
| `src/lib/usage-chart/chart-geometry.ts` | The pure geometry both charts share: `scaleFor`, `lineRuns`, `localTime`, `localHour`, `tickLabel`, `hourTicks`, `intervalRangeLabel`, `formatKwh`, `barWidthFor`. No DOM, no Angular. |
| `src/lib/usage-chart/chart-geometry.spec.ts` | The unit suite for the above, including the DST duplicate-hour labels, the host-timezone independence of `localTime`, and the run-of-one case the prior art dropped. |
| `src/lib/usage-chart/pp-usage-chart.ts` | `PpUsageChart` — the day chart. |
| `src/lib/usage-chart/pp-usage-chart.css` | Its stylesheet: the three series' stroke patterns, the zero line, the hatch, the tooltip. |
| `src/lib/usage-chart/pp-usage-chart.spec.ts` | Its suite, including the colour-removed distinguishability assertion (design §7.16) and the tick-placement assertion. |
| `src/lib/usage-chart/pp-usage-month-chart.ts` | `PpUsageMonthChart` — the month chart. |
| `src/lib/usage-chart/pp-usage-month-chart.css` | Its stylesheet: the bars, the stub, the partial hatch. |
| `src/lib/usage-chart/pp-usage-month-chart.spec.ts` | Its suite, including "a missing day is a marked stub, not a short bar" `[F03-R10]`. |
| `src/lib/usage-chart/public.ts` | The barrel `public-api.ts` imports from. Shared contract §11.1 names this path exactly. |
| `src/public-api.ts` | **Modified.** Gains the seven-name export block of §11.1. |

### `apps/customer-portal` (step 11b)

| File | Responsibility |
| --- | --- |
| `src/app/shared/design-tokens.spec.ts` | **Modified.** Task 1 extends its scope to `libs/shared-ui/src/lib` by folding each component directory's own `:host` declarations and `[style.--x]` host bindings into the declared set for that directory. |
| `src/app/shell/customer-nav.ts` | **Modified.** Three one-line edits: `PATH.consumption`, `ENABLED_ROUTE_KEYS`, and deleting the `consumption:` entry from `DISABLED_REASON`. |
| `src/app/shell/customer-nav.spec.ts` | **Modified.** `:79` the enabled set, `:92` `disabled.length`. |
| `src/app/app.routes.ts` | **Modified.** One five-line guarded lazy route. |
| `src/app/app.routes.spec.ts` | **Modified.** `:34` `GUARDED`. |
| `src/app/features/consumption/consumption-envelope.ts` | The pure mapper: HTTP envelope → `PpUsageDay` / `PpUsageMonth`, plus `toDataState` and the aggregate helpers. No Angular. |
| `src/app/features/consumption/consumption-envelope.spec.ts` | Its suite. This is where "a missing interval is absent, never zero" is pinned on the client side. |
| `src/app/features/consumption/consumption-copy.ts` | Every sentence this screen prints, in one file: the data-state labels and tones, the empty state, the declared-zero line, the corrected-on line. |
| `src/app/features/consumption/consumption-copy.spec.ts` | Sentence case, no "projected", no `€`, every state covered. |
| `src/app/features/consumption/metering-point-selector.ts` | `[F03-R21]` — one, several or all, over the customer's own connections. |
| `src/app/features/consumption/metering-point-selector.spec.ts` | Its suite. |
| `src/app/features/consumption/day-picker.ts` | `[F03-R07]` — the hand-rolled date picker. `[OQ-49]` is deferred, so no component library supplies one. |
| `src/app/features/consumption/day-picker.spec.ts` | Its suite, including the month grid, the DST-free date arithmetic and keyboard reachability. |
| `src/app/features/consumption/consumption-page.ts` | The screen: URL state, both fetches, the KPI strip, the five treatments, the empty state, and the navigation row. |
| `src/app/features/consumption/consumption-page.spec.ts` | Its suite. |
| `src/app/features/connections/connection-detail-page.ts` | **Modified.** `Latest data` prints a real date; a 14-day data-quality strip is added. |
| `src/app/features/connections/connection-detail-page.spec.ts` | **Modified.** `:266-274` is **inverted**, and a second test keeps `NO_DATA_YET` for `lastDataDate: null`. |
| `src/app/features/connections/connection-list-page.ts` | **Modified.** The `LATEST DATA` column prints a date when the wire carries one. |
| `src/app/features/connections/connection-list-page.spec.ts` | **Modified.** A second fixture with a date is added; `:228` stays green because its fixture's `lastDataDate` is `null`. |
| `src/app/features/dashboard/dashboard-page.ts` | **Modified.** The banner and lede are rewritten. |
| `src/app/features/dashboard/dashboard-page.spec.ts` | **Modified.** An assertion for the replacement copy is added — nothing asserts the current sentence today. |
| `src/app/shared/labels.ts` | **Unchanged.** `NO_DATA_YET` and its exact string stay, em dash and all. |

### `libs/api-client-customer` and `libs/api-client-employee`

| File | Responsibility |
| --- | --- |
| `libs/api-client-customer/src/generated/customer-schema.d.ts` | **Regenerated and committed.** |
| `libs/api-client-customer/src/lib/customer-api.types.ts` | **Modified.** Aliases for the consumption envelopes and `DayStateDto`. |
| `libs/api-client-customer/src/lib/customer-api.client.ts` | **Modified.** Two URL builders and two GETs. |
| `libs/api-client-customer/src/lib/customer-api.client.spec.ts` | **Modified.** The two new calls' URLs and repeated `meteringPointIds` parameters. |
| `libs/api-client-employee/src/generated/employee-schema.d.ts` | **Regenerated and committed.** |
| `libs/api-client-employee/src/lib/employee-api.types.ts` | **Modified.** Aliases for the four data-health responses, with the eleven new integers narrowed at the client boundary the way slice 1's eight already are. |
| `libs/api-client-employee/src/lib/employee-api.types.spec.ts` | **Modified.** The compile-time pins for that narrowing — a `const x: number = …` that stops compiling if a field is widened back. |
| `libs/api-client-employee/src/lib/employee-api.client.ts` | **Modified.** Four URL builders, three GETs and one POST. |
| `libs/api-client-employee/src/lib/employee-api.client.spec.ts` | **Modified.** |

### `apps/employee-portal` (step 11b)

| File | Responsibility |
| --- | --- |
| `src/app/shell/employee-nav.ts` | **Modified.** `data-feeds` gains `path: '/data-feeds'` and loses its `disabledReason`. |
| `src/app/shell/employee-nav.spec.ts` | **Modified.** `:36` the enabled list. |
| `src/app/app.routes.ts` | **Modified.** One guarded lazy children entry. |
| `src/app/features/data-feeds/data-feeds.routes.ts` | Three child routes: `messages`, `quarantine`, `connections`. |
| `src/app/features/data-feeds/data-feeds-tabs.ts` | The three-tab strip the mockup draws across all three panels. |
| `src/app/features/data-feeds/data-feeds-labels.ts` | Status labels and tones, quarantine-reason labels, the failure-code sentences, and the five heat-map letters. |
| `src/app/features/data-feeds/data-feeds-labels.spec.ts` | Its suite. |
| `src/app/features/data-feeds/message-log-page.ts` | The inbound message log, filtered by BRP and by status, with the replay action. |
| `src/app/features/data-feeds/message-log-page.spec.ts` | Its suite. |
| `src/app/features/data-feeds/quarantine-page.ts` | The quarantine panel: reason, age, resource object, and the sentence explaining what resolves it. |
| `src/app/features/data-feeds/quarantine-page.spec.ts` | Its suite. |
| `src/app/features/data-feeds/connection-health-page.ts` | The per-connection 21-day state heat map, with the silent filter. |
| `src/app/features/data-feeds/connection-health-page.spec.ts` | Its suite. |

### The mockups — in the SPEC repo, and not authoritative where they disagree with the envelope

| Mockup | What to take from it |
| --- | --- |
| `.../specs/60-mockups/chart-day-view.svg` | The layout, the tab strip (`Day` / `Month`), the KPI strip's shape, `PROVISIONAL DATA`, `96 intervals · Europe/Amsterdam`, `no generation here`. ⚠ **Ignore** the block overlay, the coverage bands, `BLOCK COVER` / `COVERED` / `UNCOVERED` / `SPOT RESULT`, `Hedge this exposure`, `€ 96,50/MWh`, `Day-ahead`, `PEAK WINDOW 08:00 – 20:00` and the `Quarter` tab. |
| `.../specs/60-mockups/chart-month-view.svg` | `Daily consumption`, `2 DAYS MISSING`, `2 days awaiting data`, `Missing data`, `click a day for 15-minute detail`, `MEASURED (29 of 31 DAYS)`. ⚠ Ignore `Block cover (÷3 for scale)`, `SURPLUS`, `COMPARE: JULY 2026`, `Weekend — no peak cover`. |
| `.../specs/60-mockups/ean-detail.svg` | `Data quality`, `Last 14 delivery dates`, the legend `final` / `prov.` / `corr.` / `none`, and the provisional sentence. |
| `.../specs/60-mockups/employee-ingestion-health.svg` | All three employee panels: `Inbound messages`, `Quarantine`, `Data state per connection`, the column heads `DOCUMENT ID` / `TYPE` / `STATUS` / `SERIES` / `DETAIL`, the stat cards `DOCUMENTS TODAY` / `QUARANTINED` / `SILENT CONNECTIONS`, the legend `N no data` / `A partial` / `P provisional` / `F final` / `C corrected`, `last 21 delivery dates · all customers`, `Replay message`, `Register EAN`, and the two explanatory sentences. |

---

### Task 1: Extend the design-token guard to `libs/shared-ui`

**This task runs first and nothing in this plan may be written before it passes.** Shared contract
§11.5: *"An undefined custom property does not fall back and does not warn. `background:
var(--pp-red-surface)` resolves to nothing, the element renders with no background, and every DOM
and CSS assertion still passes. That is why this guard exists and why extending it is on the
critical path for the chart work."* The charts are about to add roughly a hundred `var(--pp-…)`
references inside `libs/shared-ui/src/lib`, which today's guard does not read at all.

Today's guard scans **only `apps/`**, and its own doc comment explains why: `libs/shared-ui/src/lib`
legitimately declares component-local properties inside `:host` blocks, invisible to `styles/` by
design, and folding those in "would mean tracking per-file declarations and would weaken the rule to
nothing."

**The fold is per component DIRECTORY, not per file, and that is a deliberate departure from the
contract's wording.** Verified today: `--pp-grid-columns` is *declared* in
`libs/shared-ui/src/lib/grid-table/pp-grid-table.ts:24` as a host **style binding**
(`'[style.--pp-grid-columns]': 'columns()'`) and *referenced* in
`libs/shared-ui/src/lib/grid-table/pp-grid-table.css:14`. Those are two different files in one
component. A strict per-file rule would report the library's own shipped, correct code as
undeclared, and the first thing an implementer would do is weaken the rule until it went green.
Per-directory keeps the rule sharp — a `var(--pp-usage-chart-gap)` declared in the chart's own
`:host` passes, a `var(--pp-chart-usaeg)` typo fails, **and** borrowing another component's private
property fails too.

**Sixteen component-local properties exist today** (`--pp-badge-bg`, `--pp-badge-border`,
`--pp-badge-text`, `--pp-banner-bg`, `--pp-banner-border`, `--pp-banner-mark`, `--pp-banner-text`,
`--pp-button-bg`, `--pp-button-border`, `--pp-button-text`, `--pp-ds-banner-bg`,
`--pp-ds-banner-border`, `--pp-ds-banner-mark`, `--pp-ds-banner-text`, `--pp-stat-card-cap`,
`--pp-stat-card-value`) plus `--pp-grid-columns` from the style binding, which is the seventeenth
the existing doc comment counts.

**The three vacuity guards are re-pinned to numbers measured from the new scope, not left at their
old floors.** Measured today, before a single chart file exists:

| Quantity | Measured | Pinned as |
| --- | --: | --- |
| `declared.size` (global tokens in `libs/shared-ui/src/styles/*.css`) | **138** | `> 130` |
| `appFiles.length` | **74** | `> 70` |
| `libFiles.length` (under `libs/shared-ui/src/lib`) | **30** | `> 25` |
| `references.length` (466 in `apps/` + 245 in `libs/shared-ui/src/lib`) | **711** | `> 650` |

⚠ **Not pinned as exact equality, and the reason is recorded in the spec itself.** Every later task
in this plan adds a source file and a handful of references, so an exact count would go red in the
middle of the plan and be "fixed" by retyping a number — a ritual, not evidence. A threshold set
just under the measured value still fails loudly the moment a walker stops finding files or a styles
directory moves, which is the failure the guard is for. What *is* pinned exactly is the thing a
count cannot express: that both portals and the library are all in the scanned set, and that two
named component-local properties are actually discovered.

**Files:**
- Modify: `apps/customer-portal/src/app/shared/design-tokens.spec.ts:1-104` (the first `describe`
  block and its doc comment; the `describe('the link colour both portals set', …)` block at
  `:106-204` and the two helpers at `:206-229` are untouched except for the one import noted below)

**Interfaces:**
- Consumes: nothing.
- Produces: a guard that reads `libs/shared-ui/src/lib/**`, so every later task in this plan is
  protected from a mistyped custom property. No exported symbol.

- [ ] **Step 1: Write the failing test**

Replace lines 1–104 of `apps/customer-portal/src/app/shared/design-tokens.spec.ts` with the
following. Everything from line 106 (`/**` above `describe('the link colour both portals set'`) to
the end of the file stays exactly as it is.

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every `var(--…)` reference in either portal AND in the design system's own components must name
 * a custom property that is actually declared.
 *
 * Why it matters more than a typo usually does: an undefined custom property does not fall back
 * and does not warn. `background: var(--pp-red-surface)` resolves to nothing, the element renders
 * with no background, and every DOM and CSS assertion in the suite still passes — the declaration
 * is present, it is just inert. Nothing but a check like this one can see it.
 *
 * SCOPE. Two sets of files, with two different rules.
 *
 *   apps/**                       may reference ONLY the design system's global tokens.
 *   libs/shared-ui/src/lib/**     may reference the global tokens PLUS the component-local
 *                                 properties declared inside its OWN component directory.
 *
 * The library legitimately declares seventeen component-local properties — `--pp-button-bg`,
 * `--pp-stat-card-cap`, `--pp-grid-columns` and friends — which `styles/` cannot see by design.
 * They are folded in per DIRECTORY rather than per file, and that is not laziness: verified today,
 * `--pp-grid-columns` is declared in `grid-table/pp-grid-table.ts` as a host style binding
 * (`'[style.--pp-grid-columns]': 'columns()'`) and referenced in `grid-table/pp-grid-table.css`.
 * A per-file rule would report the library's own correct code as undeclared, and the first fix
 * anybody reached for would be to weaken the rule to nothing. Per-directory keeps it sharp: a
 * typo fails, and so does borrowing another component's private property (see the leak test).
 *
 * The scope grew when the two usage charts landed, which is when it started mattering: the charts
 * are ~100 new `var(--pp-…)` references inside libs, none of which this guard could previously see.
 */
describe('design tokens referenced by the portals and the design system', () => {
  const root = workspaceRoot();

  /** Every `--name:` declared in the design system's token stylesheets. */
  const declared = new Set<string>();
  const stylesDir = join(root, 'libs/shared-ui/src/styles');
  for (const file of readdirSync(stylesDir)) {
    if (!file.endsWith('.css')) continue;
    for (const match of readFileSync(join(stylesDir, file), 'utf8').matchAll(
      /(--[a-z0-9-]+)\s*:/g,
    )) {
      declared.add(match[1]);
    }
  }

  const appFiles = sourceFilesUnder(join(root, 'apps'));
  const libFiles = sourceFilesUnder(join(root, 'libs/shared-ui/src/lib'));

  /**
   * The component-local properties each library component directory declares, in BOTH the forms
   * this library actually uses:
   *
   *   a CSS declaration          `--pp-stat-card-cap: var(--pp-red);`   inside a `:host(...)` rule
   *   a host style binding       `'[style.--pp-grid-columns]': 'columns()'`   in the .ts
   *
   * The first regex cannot see the second: in `'[style.--pp-grid-columns]'` the character after
   * the name is `]`, not `:`. Dropping the second pattern makes the library's own grid table
   * report an undeclared token, which is exactly how a guard gets switched off.
   */
  const localsByDir = new Map<string, Set<string>>();
  for (const file of libFiles) {
    const dir = dirname(file);
    let locals = localsByDir.get(dir);
    if (locals === undefined) {
      locals = new Set<string>();
      localsByDir.set(dir, locals);
    }
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(--[a-z0-9-]+)\s*:/g)) locals.add(match[1]);
    for (const match of source.matchAll(/\[style\.(--[a-z0-9-]+)\]/g)) locals.add(match[1]);
  }

  /**
   * Every reference, with the file it came from so a failure names the file rather than handing
   * back a bare token, and with the directory so the per-directory fold can be applied.
   *
   * The regex stops at the property name and deliberately does NOT require the closing paren.
   * `var(--x)` and the FALLBACK form `var(--x, 12px)` must both match, and a pattern anchored on
   * `\)` sees only the first — which is the worse half to miss, because a fallback renders
   * something plausible and hides the missing token behind it. Nested fallbacks
   * (`var(--a, var(--b))`) yield two matches, one per `var(`, which is what is wanted.
   */
  const references: { token: string; file: string; dir: string; inLib: boolean }[] = [];
  for (const [files, inLib] of [
    [appFiles, false],
    [libFiles, true],
  ] as const) {
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
        references.push({
          token: match[1],
          file: file.slice(root.length + 1),
          dir: dirname(file),
          inLib,
        });
      }
    }
  }

  /** The set a reference in `dir` is allowed to name. */
  function allowedIn(dir: string, inLib: boolean): Set<string> {
    if (!inLib) return declared;
    return new Set([...declared, ...(localsByDir.get(dir) ?? [])]);
  }

  it('reads a design system, portals and library components that all actually exist', () => {
    // The guards below are vacuously green if any side comes back empty — a moved styles
    // directory or a walker that stopped finding sources would silently retire the whole check.
    // Measured 2026-09-07: declared 138, appFiles 74, libFiles 30, references 711 (466 + 245).
    // Thresholds sit just under those, NOT at exact equality: every later task in this plan adds
    // a file, and a count "fixed" by retyping a number after each one is a ritual, not evidence.
    expect(declared.size).toBeGreaterThan(130);
    expect(appFiles.length).toBeGreaterThan(70);
    expect(libFiles.length).toBeGreaterThan(25);
    expect(references.length).toBeGreaterThan(650);

    // Both portals AND the library, not just the one whose suite this happens to run in. The
    // reference that survived the whole slice-1 branch was in the employee portal.
    expect(appFiles.some((f) => f.includes(`apps${sep}customer-portal${sep}`))).toBe(true);
    expect(appFiles.some((f) => f.includes(`apps${sep}employee-portal${sep}`))).toBe(true);
    expect(references.some((r) => r.file.includes('employee-portal'))).toBe(true);
    expect(references.some((r) => r.inLib)).toBe(true);
  });

  it('sees the fallback form, which a paren-anchored pattern misses', () => {
    // Not a test of the regex in the abstract: `var(--pp-red-600, #b3261e)` is the exact shape
    // that survived slice 1's branch, in `metering-point-form-page.ts`. A guard blind to it would
    // have reported the portals clean while an undeclared token rendered its fallback hex.
    const scan = (css: string): string[] =>
      [...css.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map((m) => m[1]);

    expect(scan('color: var(--pp-red-600, #b3261e);')).toEqual(['--pp-red-600']);
    expect(scan('color: var( --pp-a , var(--pp-b) );')).toEqual(['--pp-a', '--pp-b']);
    expect(scan('color: var(--pp-plain);')).toEqual(['--pp-plain']);
  });

  it('folds a component-local property in from BOTH forms the library declares them in', () => {
    // Named, not counted. A count passes while the style-binding half is missing, and that half
    // is the one that costs: `--pp-grid-columns` is declared ONLY as a host binding in a .ts file.
    const statCard = localsByDir.get(join(root, 'libs/shared-ui/src/lib/stat-card'));
    const gridTable = localsByDir.get(join(root, 'libs/shared-ui/src/lib/grid-table'));

    expect(statCard, 'no locals found for lib/stat-card').toBeDefined();
    expect(gridTable, 'no locals found for lib/grid-table').toBeDefined();
    // A CSS declaration inside a `:host(...)` rule.
    expect([...statCard!]).toContain('--pp-stat-card-cap');
    // A host style binding in the component's .ts — invisible to the `--x:` pattern.
    expect([...gridTable!]).toContain('--pp-grid-columns');
  });

  it('declares every custom property either portal or the design system references', () => {
    const undeclared = references.filter((r) => !allowedIn(r.dir, r.inLib).has(r.token));

    // Named, not counted: `toEqual([])` on the pairs puts the token AND its file in the failure.
    expect(undeclared.map((r) => `${r.file} ${r.token}`)).toEqual([]);
  });

  it("lets no component reference another component's private property", () => {
    // This is what per-directory folding buys over a single library-wide pool. A pooled fold
    // would let pp-badge paint itself with `var(--pp-stat-card-cap)` — a property that is only
    // ever set inside pp-stat-card's own host, so the declaration resolves to nothing and the
    // badge renders unstyled with the whole suite green.
    const everyLocal = new Set<string>();
    for (const locals of localsByDir.values()) for (const token of locals) everyLocal.add(token);

    const leaks = references.filter(
      (r) =>
        !declared.has(r.token) &&
        everyLocal.has(r.token) &&
        !(localsByDir.get(r.dir) ?? new Set<string>()).has(r.token),
    );

    expect(leaks.map((r) => `${r.file} ${r.token}`)).toEqual([]);
  });

  it('leaves no app declaring a token of its own', () => {
    // A portal that declares `--pp-something:` has forked the design system in a file no
    // component spec reads. The one hit today is a comment quoting a token that does not exist,
    // which is why the match is narrowed to a declaration inside a CSS block.
    //
    // Scoped to `apps/` deliberately: a LIBRARY component declaring its own property is the
    // normal, intended shape, and is what `localsByDir` above exists to model.
    const locallyDeclared = appFiles.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)]
        .map((match) => ({ token: match[1], file: file.slice(root.length + 1) }))
        .filter((hit) => !declared.has(hit.token)),
    );

    expect(locallyDeclared).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **PASS**, and that is the correct outcome here — this task widens a guard over code that
is already correct, so there is no red-to-green transition to observe. **The evidence is the
mutation step below, not this run.** What this step proves is only that the widened guard does not
report the library's shipped code as broken; if it fails, the failure will be
`expect(undeclared.map(...)).toEqual([])` naming a `libs/shared-ui/...` file, and the fix is in the
fold above, never in the library.

- [ ] **Step 3: Mutation check — a typo inside the library must be caught**

Append one line to `libs/shared-ui/src/lib/stat-card/pp-stat-card.css`:

```css
.pp-stat-card__value{color:var(--pp-chart-usaeg)}
```

⚠ Append it as a **new rule** rather than editing the existing `.pp-stat-card__value` rule —
`ruleBody` in `pp-stat-card.spec.ts` throws when a selector matches more than one rule, so this also
demonstrates that a mutation must not break a *different* test's preconditions. If that spec goes
red too, that is noise; the assertion under test is the token guard.

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `declares every custom property either portal or the design system references`
reports
`expected [ 'libs/shared-ui/src/lib/stat-card/pp-stat-card.css --pp-chart-usaeg' ] to deeply equal []`.

Predicted before running: the file name is in the message, and the token is the misspelling, not
`--pp-chart-usage`. **Delete the appended line immediately** and re-run to confirm green.

- [ ] **Step 4: Mutation check — a cross-component borrow must be caught**

This is the assertion the per-directory fold exists for, and it is a *different* case from step 3 —
`--pp-stat-card-cap` genuinely is declared, just not where it is being read.

Append one line to `libs/shared-ui/src/lib/badge/pp-badge.css`:

```css
.pp-badge__leak{color:var(--pp-stat-card-cap)}
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `lets no component reference another component's private property` reports
`expected [ 'libs/shared-ui/src/lib/badge/pp-badge.css --pp-stat-card-cap' ] to deeply equal []`.

Predicted before running: the `declares every custom property…` test stays **green** for this
mutation, because `--pp-stat-card-cap` is in `everyLocal` but not in `pp-badge`'s directory — no, it
is **not** in `allowedIn('…/badge', true)`, so both tests go red. Both failures are correct and the
second names the borrowed property specifically. **Delete the appended line immediately.**

- [ ] **Step 5: Mutation check — the style-binding half must be load-bearing**

Delete the second `matchAll` line from the `localsByDir` loop in the spec:

```ts
    for (const match of source.matchAll(/\[style\.(--[a-z0-9-]+)\]/g)) locals.add(match[1]);
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL**, twice —
`folds a component-local property in from BOTH forms the library declares them in` reports
`expected [ ... ] to contain '--pp-grid-columns'`, and
`declares every custom property either portal or the design system references` reports
`expected [ 'libs/shared-ui/src/lib/grid-table/pp-grid-table.css --pp-grid-columns' ] to deeply equal []`.

**Restore the line immediately.**

- [ ] **Step 6: Run the whole suite and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && \
  PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform npm test
```

Expected: PASS, every project.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/shared/design-tokens.spec.ts
git commit -m "test(tokens): extend the design-token guard to libs/shared-ui

The charts land ~100 var(--pp-*) references inside libs/shared-ui/src/lib, which the
guard could not see at all. Component-local properties are folded in per component
DIRECTORY rather than per file, because --pp-grid-columns is declared as a host style
binding in pp-grid-table.ts and referenced in pp-grid-table.css.

Verified by mutation three ways: a --pp-chart-usaeg typo in pp-stat-card.css goes red
naming the file; pp-badge.css borrowing --pp-stat-card-cap goes red on the leak test;
and deleting the [style.--x] pattern goes red on pp-grid-table.css."
```

---

### Task 2: The frozen types and the shared chart geometry

Both charts are hand-rolled SVG (**S2-D5**), and everything that can be decided without a DOM is
decided here, in pure functions with their own suite. That is what makes the *drawing* thin enough
to be replaced by a library later without re-deriving the axis, the gaps, the DST labels or the
number formatting.

Three things in this file are the whole reason it exists rather than being inlined:

1. **`localTime` reads the wall-clock characters out of the ISO string and never constructs a
   `Date`.** `new Date('2026-08-12T00:15:00+02:00').getHours()` answers in the **host's** zone: `0`
   on an Amsterdam laptop, `22` the previous day on a UTC CI runner. One row, three customer-visible
   answers. The offset in the string is already the Amsterdam offset the server resolved through
   `IMarketCalendar.IntervalStart`, so the characters after the `T` are the local time by
   construction and re-deriving them is how the answer gets lost.
2. **`slotStartX` and `slotCentreX` are two named functions, not one plus an offset.** They encode
   the START-versus-END convention this plan opens with: a point sits at its slot's centre, an hour
   tick at its slot's left edge, because the tick names the instant the interval **starts**.
3. **`lineRuns` keeps a run of length one.** `trading-poc`'s `lineSegments`
   (`customer-portal.html:5402-5415`) drops it — `if (run.length > 1)` — so a single measured
   interval between two gaps renders as nothing at all. The chart turns a one-point run into a dot.

**Files:**
- Create: `libs/shared-ui/src/lib/usage-chart/usage-chart.types.ts`
- Create: `libs/shared-ui/src/lib/usage-chart/chart-geometry.ts`
- Test: `libs/shared-ui/src/lib/usage-chart/chart-geometry.spec.ts`

**Interfaces:**
- Consumes: `formatDutchDecimal` and `PP_UNAVAILABLE` from
  `libs/shared-ui/src/lib/format/dutch-number.ts`.
- Produces:
  - `export type PpUsageDataState`, `export interface PpUsageInterval`, `PpUsageDay`,
    `PpUsageMonthDay`, `PpUsageMonth` — shared contract §11.2, verbatim.
  - `export interface PpChartScale { readonly min: number; readonly max: number; readonly zeroY: number; y(value: number): number }`
  - `export interface PpHourTick { readonly pos: number; readonly label: string; readonly major: boolean }`
  - `export function scaleFor(values: readonly (number | null)[], padTop: number, plotHeight: number): PpChartScale`
  - `export function localTime(iso: string): string`
  - `export function localHour(iso: string): number`
  - `export function startsOnTheHour(iso: string): boolean`
  - `export function intervalRangeLabel(interval: PpUsageInterval): string`
  - `export function tickLabel(interval: PpUsageInterval): string`
  - `export function hourTicks(day: PpUsageDay): readonly PpHourTick[]`
  - `export function lineRuns(count: number, pointAt: (pos: number) => string | null): readonly (readonly string[])[]`
  - `export function slotWidthFor(plotWidth: number, slots: number): number`
  - `export function slotStartX(pos: number, padLeft: number, slotWidth: number): number`
  - `export function slotCentreX(pos: number, padLeft: number, slotWidth: number): number`
  - `export function barWidthFor(pitch: number): number`
  - `export function formatKwh(value: number | null): string`
  - `export function dayNumber(date: string): number`
  - `export const PP_RANGE_DASH: string` — the en dash with its two spaces, `' – '` (U+2013)

  ⚠ **None of these leaves the library.** `public-api.ts` exports only the two components and the
  five types (§11.1). Geometry is an implementation detail of the replaceable surface; exporting it
  would make it a consumer's business, which is exactly what **S2-D5** buys freedom from.

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/usage-chart/chart-geometry.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { PP_MINUS, PP_UNAVAILABLE } from '../format/dutch-number';
import {
  PP_RANGE_DASH,
  barWidthFor,
  dayNumber,
  formatKwh,
  hourTicks,
  intervalRangeLabel,
  lineRuns,
  localHour,
  localTime,
  scaleFor,
  slotCentreX,
  slotStartX,
  slotWidthFor,
  startsOnTheHour,
  tickLabel,
} from './chart-geometry';
import type { PpUsageDay, PpUsageInterval } from './usage-chart.types';

/** One interval, overridable a field at a time. Amsterdam summer offset by default. */
function interval(over: Partial<PpUsageInterval> = {}): PpUsageInterval {
  return {
    pos: 1,
    start: '2026-08-12T00:00:00+02:00',
    end: '2026-08-12T00:15:00+02:00',
    dstPass: null,
    consumptionKwh: 180,
    productionKwh: 0,
    netUsageKwh: 180,
    ...over,
  };
}

function day(over: Partial<PpUsageDay> = {}): PpUsageDay {
  return {
    date: '2026-08-12',
    intervalCount: 96,
    dataState: 'PROVISIONAL',
    intervals: [interval()],
    productionIsDeclaredZero: false,
    lastCorrectedAt: null,
    ...over,
  };
}

describe('localTime', () => {
  it('reads the wall clock as WRITTEN, not as the host machine sees it', () => {
    // The single most valuable assertion in this file. `new Date(iso).getHours()` answers in the
    // host's zone: this same string reads 00:15 on an Amsterdam laptop and 22:15 the previous day
    // on a UTC CI runner. The offset in the string is already the Amsterdam offset the server
    // resolved through IMarketCalendar.IntervalStart.
    expect(localTime('2026-08-12T00:15:00+02:00')).toBe('00:15');
    // Same instant, written with a different offset. A Date-based reading would give the SAME
    // answer for both (they are the same moment); reading the characters gives two, and two is
    // correct here — the string says what local time the server meant.
    expect(localTime('2026-08-11T22:15:00+00:00')).toBe('22:15');
  });

  it('reads the winter offset the autumn day switches to', () => {
    expect(localTime('2026-10-25T02:30:00+01:00')).toBe('02:30');
  });

  it('refuses a string that is not an ISO local timestamp rather than slicing nonsense', () => {
    // Slicing a short string yields '' and every downstream label silently becomes blank.
    expect(() => localTime('2026-08-12')).toThrow('Not an ISO local timestamp: 2026-08-12');
  });

  it('names the hour as a number, and the top of the hour as a boolean', () => {
    expect(localHour('2026-08-12T13:45:00+02:00')).toBe(13);
    expect(localHour('2026-08-12T00:00:00+02:00')).toBe(0);
    expect(startsOnTheHour('2026-08-12T13:00:00+02:00')).toBe(true);
    expect(startsOnTheHour('2026-08-12T13:15:00+02:00')).toBe(false);
  });
});

describe('intervalRangeLabel', () => {
  it('names the whole range from BOTH ends, never one end plus arithmetic', () => {
    const label = intervalRangeLabel(
      interval({ start: '2026-08-12T10:30:00+02:00', end: '2026-08-12T10:45:00+02:00' }),
    );
    // The mockup writes `10:30 – 10:45`: en dash U+2013, ONE SPACE EITHER SIDE, never a hyphen
    // and never closed up. Both halves are asserted, because a label that dropped the spaces
    // still contains the dash and would pass a `toContain`.
    expect(label).toBe(`10:30 ${PP_RANGE_DASH} 10:45`);
    expect(PP_RANGE_DASH).toBe('–');
    expect(label).not.toContain('-');
  });

  it('closes the day at midnight rather than reopening it', () => {
    // The last interval of a day ENDS at 00:00 of the next date. That midnight closes the day;
    // it is not the one that opened it, and the label must not print 23:45 twice.
    const label = intervalRangeLabel(
      interval({ pos: 96, start: '2026-08-12T23:45:00+02:00', end: '2026-08-13T00:00:00+02:00' }),
    );
    expect(label).toBe(`23:45 ${PP_RANGE_DASH} 00:00`);
  });
});

describe('tickLabel', () => {
  it('labels an ordinary hour with the bare local time', () => {
    expect(tickLabel(interval({ start: '2026-08-12T09:00:00+02:00' }))).toBe('09:00');
  });

  it('labels the autumn duplicate hour 02:00 A and 02:00 B, from dstPass and nothing else', () => {
    // [F03-R03]. Both passes carry the SAME wall clock; only dstPass tells them apart, and the
    // component must not re-derive the pass from the UTC offset (shared contract §10.1).
    const first = interval({ pos: 9, start: '2026-10-25T02:00:00+02:00', dstPass: 'A' });
    const second = interval({ pos: 13, start: '2026-10-25T02:00:00+01:00', dstPass: 'B' });

    expect(tickLabel(first)).toBe('02:00 A');
    expect(tickLabel(second)).toBe('02:00 B');
    expect(tickLabel(first)).not.toBe(tickLabel(second));
  });
});

describe('hourTicks', () => {
  /** A dense day of `count` intervals starting at `firstHour`, fifteen minutes apart. */
  function denseDay(count: number, offset = '+02:00'): PpUsageDay {
    const intervals: PpUsageInterval[] = [];
    for (let i = 0; i < count; i++) {
      const minutes = i * 15;
      const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
      const mm = String(minutes % 60).padStart(2, '0');
      intervals.push(
        interval({ pos: i + 1, start: `2026-08-12T${hh}:${mm}:00${offset}` }),
      );
    }
    return day({ intervalCount: count, intervals });
  }

  it('puts a tick at every top of the hour and nowhere else', () => {
    const ticks = hourTicks(denseDay(96));
    expect(ticks).toHaveLength(24);
    expect(ticks.map((t) => t.pos)).toEqual([
      1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85, 89, 93,
    ]);
  });

  it('labels every third hour, so 96 points do not carry 24 overlapping strings', () => {
    const major = hourTicks(denseDay(96)).filter((t) => t.major);
    expect(major.map((t) => t.label)).toEqual([
      '00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00',
    ]);
  });

  it('labels BOTH passes of the autumn duplicate hour, whatever the every-third-hour rule says', () => {
    // 02:00 is not a multiple of three, so the general rule would hide exactly the two labels a
    // reader most needs. [F03-R03] is a Must and it wins.
    const autumn = day({
      date: '2026-10-25',
      intervalCount: 100,
      intervals: [
        interval({ pos: 5, start: '2026-10-25T01:00:00+02:00' }),
        interval({ pos: 9, start: '2026-10-25T02:00:00+02:00', dstPass: 'A' }),
        interval({ pos: 13, start: '2026-10-25T02:00:00+01:00', dstPass: 'B' }),
        interval({ pos: 17, start: '2026-10-25T03:00:00+01:00' }),
      ],
    });

    const ticks = hourTicks(autumn);
    expect(ticks.filter((t) => t.major).map((t) => t.label)).toEqual([
      '02:00 A',
      '02:00 B',
      '03:00',
    ]);
    // 01:00 gets a tick MARK but no text — it is neither a multiple of three nor a duplicate.
    expect(ticks.find((t) => t.pos === 5)).toEqual({ pos: 5, label: '01:00', major: false });
  });

  it('draws no tick for an hour whose own interval is missing', () => {
    // Honest rather than clever: the axis is built from the intervals that are actually present,
    // so a gap at the top of an hour is a gap, not a tick invented to fill it.
    const sparse = day({
      intervals: [
        interval({ pos: 1, start: '2026-08-12T00:00:00+02:00' }),
        interval({ pos: 9, start: '2026-08-12T02:00:00+02:00' }),
      ],
    });

    expect(hourTicks(sparse).map((t) => t.pos)).toEqual([1, 9]);
  });
});

describe('scaleFor', () => {
  it('always keeps zero inside the plot, even on an all-positive day', () => {
    // [F03-R02]: the zero line is always drawn. A scale fitted to the data alone would put it off
    // the bottom of a day that never exports, and the line would be invisible rather than absent —
    // the worst of the two.
    const scale = scaleFor([180, 210, 260], 10, 200);

    expect(scale.min).toBe(0);
    expect(scale.max).toBe(260);
    expect(scale.zeroY).toBeCloseTo(210, 5);
    expect(scale.y(260)).toBeCloseTo(10, 5);
  });

  it('accommodates NEGATIVE net usage below the zero line', () => {
    // [DEC-22]: net usage may be negative and is settled as export [DEC-23]. A scale seeded at
    // zero on the low side only would clip the whole export half of the day.
    const scale = scaleFor([100, -50], 10, 300);

    expect(scale.min).toBe(-50);
    expect(scale.max).toBe(100);
    // 150 units of span over 300px: zero sits two thirds down.
    expect(scale.zeroY).toBeCloseTo(210, 5);
    expect(scale.y(-50)).toBeCloseTo(310, 5);
    expect(scale.y(-50)).toBeGreaterThan(scale.zeroY);
  });

  it('ignores nulls rather than scaling to NaN', () => {
    const scale = scaleFor([null, 40, null], 0, 100);

    expect(scale.max).toBe(40);
    expect(Number.isFinite(scale.y(40))).toBe(true);
  });

  it('survives a day whose every value is zero', () => {
    // min === max === 0 divides by zero and every y becomes NaN, which renders as an SVG with no
    // visible geometry and no error anywhere.
    const scale = scaleFor([0, 0, 0], 10, 200);

    expect(scale.max).toBe(1);
    expect(Number.isFinite(scale.zeroY)).toBe(true);
    expect(scale.zeroY).toBeCloseTo(210, 5);
  });

  it('survives a day with no readings at all', () => {
    const scale = scaleFor([], 10, 200);

    expect(Number.isFinite(scale.zeroY)).toBe(true);
  });
});

describe('slot geometry', () => {
  it('places a POINT at the centre of its own slot', () => {
    const slot = slotWidthFor(960, 96);
    expect(slot).toBeCloseTo(10, 5);
    expect(slotCentreX(1, 40, slot)).toBeCloseTo(45, 5);
    expect(slotCentreX(96, 40, slot)).toBeCloseTo(995, 5);
  });

  it('places a TICK at the LEFT edge of its slot, because a tick names the interval START', () => {
    // The START-versus-END trap. trading-poc places its hour ticks at the RIGHT edge because in
    // that codebase a tick names the instant an interval ENDS (customer-portal.html:5479-5487,
    // and the fix documented in consumption-calc.js:43-58 — a right-edge reading applied to
    // start labels put a whole peak window fifteen minutes late). Our envelope gives `start` and
    // `end` separately, so the tick belongs at the left edge and the arithmetic is (pos - 1).
    const slot = slotWidthFor(960, 96);
    expect(slotStartX(1, 40, slot)).toBeCloseTo(40, 5);
    expect(slotStartX(5, 40, slot)).toBeCloseTo(80, 5);
    // And one full slot to the LEFT of that slot's centre, never to the right of it.
    expect(slotStartX(5, 40, slot)).toBeLessThan(slotCentreX(5, 40, slot));
    expect(slotCentreX(5, 40, slot) - slotStartX(5, 40, slot)).toBeCloseTo(slot / 2, 5);
  });

  it('gives a bar a 2px gap at a wide pitch and a proportional one when it is dense', () => {
    // Ported from trading-poc's barWidthFor (customer-portal.html:5392-5395): a fixed 2px gap on
    // a ~4px pitch leaves a 2px sliver, so it tapers to a quarter of the pitch.
    expect(barWidthFor(30)).toBe(28);
    expect(barWidthFor(8)).toBe(6);
    expect(barWidthFor(4)).toBe(3);
    expect(barWidthFor(0.4)).toBe(0.5);
  });
});

describe('lineRuns', () => {
  it('breaks the line at a gap rather than drawing straight through it', () => {
    // [F03-R06]: a missing interval is a GAP, never a zero and never a bridge. One polyline
    // across the gap draws usage nobody measured.
    const present = new Map([
      [1, 'a'],
      [2, 'b'],
      [5, 'e'],
      [6, 'f'],
    ]);

    expect(lineRuns(6, (pos) => present.get(pos) ?? null)).toEqual([
      ['a', 'b'],
      ['e', 'f'],
    ]);
  });

  it('KEEPS a run of one, so a lone measured interval is not silently dropped', () => {
    // trading-poc's lineSegments discards it (`if (run.length > 1)`), which makes a single
    // interval between two gaps invisible — indistinguishable from having no data at all. The
    // component renders a one-point run as a dot.
    expect(lineRuns(3, (pos) => (pos === 2 ? 'b' : null))).toEqual([['b']]);
  });

  it('returns nothing at all when every point is missing', () => {
    expect(lineRuns(4, () => null)).toEqual([]);
  });

  it('walks positions from 1, not from 0', () => {
    const seen: number[] = [];
    lineRuns(3, (pos) => {
      seen.push(pos);
      return null;
    });
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('formatKwh', () => {
  it('formats nl-NL with one decimal and the unit', () => {
    expect(formatKwh(1234.56)).toBe('1.234,6 kWh');
  });

  it("prints the product's minus, never the ASCII hyphen", () => {
    // Net usage is negative on an exporting interval, and this is the only place the chart
    // renders one. Intl.NumberFormat('nl-NL') would emit U+002D here.
    expect(formatKwh(-42.5)).toBe(`${PP_MINUS}42,5 kWh`);
    expect(formatKwh(-42.5)).not.toContain('-');
  });

  it('says there is nothing here rather than printing a zero for a missing value', () => {
    // The distinction the whole slice exists to preserve: null is MISSING, 0 is MEASURED ZERO.
    expect(formatKwh(null)).toBe(PP_UNAVAILABLE);
    expect(formatKwh(0)).toBe('0,0 kWh');
    expect(formatKwh(null)).not.toBe(formatKwh(0));
  });
});

describe('dayNumber', () => {
  it('reads the day of the month off a yyyy-MM-dd string without a Date', () => {
    expect(dayNumber('2026-08-01')).toBe(1);
    expect(dayNumber('2026-08-31')).toBe(31);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: FAIL — `Failed to resolve import "./chart-geometry" from "libs/shared-ui/src/lib/usage-chart/chart-geometry.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the frozen types**

Create `libs/shared-ui/src/lib/usage-chart/usage-chart.types.ts`:

```ts
/**
 * The data-in half of the two charts' contract — slice-2 shared contract §11.2, verbatim.
 *
 * These five shapes are FROZEN for the slice. Plan 6 serialises them from
 * `GET /api/v1/consumption/day` and `.../month` and plan 7 renders them, and the two halves were
 * written in parallel against this text and nothing else. A field renamed here is a 500 on one
 * side or a blank chart on the other.
 *
 * There is no Angular import in this file on purpose: a consumer can type against these shapes —
 * a mapper, a fixture, a test helper — without pulling two components into its bundle.
 */

/** [F02-R22]. ⚠ There is no COMPLETE member: "complete" is the condition that moves a day to
 *  PROVISIONAL, not a fifth state. */
export type PpUsageDataState = 'NO_DATA' | 'PARTIAL' | 'PROVISIONAL' | 'FINAL';

export interface PpUsageInterval {
  /** 1-based, and 1..intervalCount — 92, 96 or 100 depending on the date. */
  pos: number;
  /** ISO 8601 WITH the Amsterdam offset, e.g. `2026-08-12T00:00:00+02:00`. */
  start: string;
  /** The same, one quarter of an hour later. The day's last interval ends at the next midnight. */
  end: string;
  /**
   * `'A'` for the first pass of the autumn duplicate hour (Pos 9-12), `'B'` for the second
   * (Pos 13-16), `null` on every other interval of every other day. The chart composes
   * `02:00 A` / `02:00 B` from THIS and must never re-derive the pass from the UTC offset.
   */
  dstPass: 'A' | 'B' | null;
  /** kWh, or null when this side of the interval is missing. NEVER coalesce null to 0. */
  consumptionKwh: number | null;
  productionKwh: number | null;
  /** consumption − production [DEC-22]. May be NEGATIVE. Missing when either side is missing. */
  netUsageKwh: number | null;
}

export interface PpUsageDay {
  /** yyyy-MM-dd, Amsterdam. */
  date: string;
  /**
   * 92 | 96 | 100 — ⚠ THE AXIS LENGTH, and not `intervals.length`. A 100-point autumn day with
   * four missing intervals still has 100 slots and four gaps; scaling to `intervals.length`
   * silently redraws the day at the wrong width, which is the failure [F03-R06] forbids.
   */
  intervalCount: number;
  dataState: PpUsageDataState;
  /** SPARSE. A missing interval is ABSENT — never a zero, never a null placeholder object. */
  intervals: PpUsageInterval[];
  /**
   * True when production is a DECLARED zero from master data rather than an absence [F02-R33].
   * The chart states the zero; the SCREEN states its source, setter and date [F01-R40], because
   * those three live on the envelope's `productionDeclaration` and not on this shape.
   */
  productionIsDeclaredZero: boolean;
  /** ISO instant, or null. Drives the corrected-on marker [DEC-98]. */
  lastCorrectedAt: string | null;
}

export interface PpUsageMonthDay {
  /** yyyy-MM-dd. */
  date: string;
  dataState: PpUsageDataState;
  /** ⚠ null means MISSING; 0.0 means MEASURED ZERO. The month chart marks the first as a stub. */
  consumptionKwh: number | null;
  productionKwh: number | null;
  netUsageKwh: number | null;
}

export interface PpUsageMonth {
  /** yyyy-MM. */
  month: string;
  dayCount: number;
  dataState: PpUsageDataState;
  /**
   * DENSE — `days.length === dayCount` always, including days with no data, which carry
   * `dataState: 'NO_DATA'` and null volumes. This is deliberately the OPPOSITE of the day shape's
   * absent-interval rule, and the reason is [F03-R10]: the month chart must mark a missing day as
   * a stub, and it cannot mark a day the payload does not mention.
   */
  days: PpUsageMonthDay[];
}
```

- [ ] **Step 4: Write the geometry**

Create `libs/shared-ui/src/lib/usage-chart/chart-geometry.ts`:

```ts
import { PP_UNAVAILABLE, formatDutchDecimal } from '../format/dutch-number';
import type { PpUsageDay, PpUsageInterval } from './usage-chart.types';

/**
 * Everything both usage charts can decide without a DOM.
 *
 * INTERNAL to the library. `public-api.ts` exports the two components and the five types and
 * nothing from this file: geometry is an implementation detail of the surface S2-D5 keeps
 * replaceable, and a consumer that reached into it would make the replacement a breaking change.
 */

/** The separator in an interval's range label: en dash U+2013, one space either side. */
export const PP_RANGE_DASH = '–';

export interface PpChartScale {
  readonly min: number;
  readonly max: number;
  /** The y of the zero line, which is always inside the plot. */
  readonly zeroY: number;
  y(value: number): number;
}

export interface PpHourTick {
  /** The 1-based position of the interval that STARTS on this hour. */
  readonly pos: number;
  /** `09:00`, or `02:00 A` / `02:00 B` on the autumn duplicate hour. */
  readonly label: string;
  /** Whether to render the text. Every hour gets a mark; every third one gets a label. */
  readonly major: boolean;
}

/**
 * A linear scale over `values`, seeded at zero on BOTH sides.
 *
 * Seeding at zero is what keeps the zero line inside the plot on an all-positive day, which
 * [F03-R02] requires — a scale fitted to the data alone puts the line off the bottom edge, where
 * it reads as absent rather than as drawn. Seeding on the low side is what accommodates negative
 * net usage [DEC-22]; without it an exporting day is clipped.
 *
 * `null` values are skipped rather than treated as zero (a null is MISSING, and a scale that
 * counted it would pull the axis towards a number nobody measured), and a degenerate range is
 * widened by one so `y` cannot divide by zero and return NaN — an SVG full of NaN coordinates
 * renders as nothing at all, with no error anywhere.
 */
export function scaleFor(
  values: readonly (number | null)[],
  padTop: number,
  plotHeight: number,
): PpChartScale {
  let min = 0;
  let max = 0;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (max === min) max = min + 1;
  const span = max - min;
  const y = (value: number): number => padTop + ((max - value) / span) * plotHeight;
  return { min, max, zeroY: y(0), y };
}

/**
 * The wall-clock `HH:mm` of an ISO 8601 local-with-offset timestamp, read as WRITTEN.
 *
 * ⚠ Deliberately not `new Date(iso).getHours()`. That answers in the HOST's zone: this same
 * string reads 00:15 on an Amsterdam laptop and 22:15 the previous day on a UTC CI runner — three
 * different customer-visible answers from one row. The offset in the string is already the
 * Amsterdam offset the server resolved through `IMarketCalendar.IntervalStart`, so the characters
 * after the `T` ARE the local time, and re-deriving them is how that answer gets thrown away.
 *
 * Throws rather than slicing a short string: `''` would render as a blank axis label with every
 * assertion still green.
 */
export function localTime(iso: string): string {
  if (iso.length < 16 || iso[10] !== 'T') {
    throw new Error(`Not an ISO local timestamp: ${iso}`);
  }
  return iso.slice(11, 16);
}

export function localHour(iso: string): number {
  return Number(localTime(iso).slice(0, 2));
}

export function startsOnTheHour(iso: string): boolean {
  return localTime(iso).slice(3) === '00';
}

/**
 * `10:30 – 10:45`. Built from BOTH ends of the envelope's interval, never from one end plus
 * fifteen minutes — see this plan's START-versus-END note. The day's last interval reads
 * `23:45 – 00:00`: that midnight closes the day rather than reopening it.
 */
export function intervalRangeLabel(item: PpUsageInterval): string {
  return `${localTime(item.start)} ${PP_RANGE_DASH} ${localTime(item.end)}`;
}

/** `09:00`, or `02:00 A` / `02:00 B` — from `dstPass`, never from the UTC offset. */
export function tickLabel(item: PpUsageInterval): string {
  const time = localTime(item.start);
  return item.dstPass === null ? time : `${time} ${item.dstPass}`;
}

/**
 * One tick per interval that starts on the hour, in position order.
 *
 * Ticks come from the intervals actually PRESENT, so a gap at the top of an hour is a gap rather
 * than a tick invented to fill it. Text is rendered every third hour — 24 labels across 96 points
 * overlap into a grey smear — plus BOTH passes of the autumn duplicate hour whatever the
 * every-third-hour rule says, because [F03-R03] is a Must and 02:00 is not a multiple of three.
 */
export function hourTicks(day: PpUsageDay): readonly PpHourTick[] {
  const ticks: PpHourTick[] = [];
  for (const item of day.intervals) {
    if (!startsOnTheHour(item.start)) continue;
    ticks.push({
      pos: item.pos,
      label: tickLabel(item),
      major: localHour(item.start) % 3 === 0 || item.dstPass !== null,
    });
  }
  return ticks;
}

/**
 * The points of each unbroken run, walking positions 1..count.
 *
 * One `<polyline>` per run, never one across a gap: a straight line through a missing interval
 * draws usage nobody measured, which is exactly what [F03-R06] forbids.
 *
 * ⚠ A run of ONE is kept. trading-poc's equivalent discards it (`if (run.length > 1)`), so a
 * single measured interval between two gaps renders as nothing and reads as no data at all. The
 * caller renders a one-point run as a dot.
 */
export function lineRuns(
  count: number,
  pointAt: (pos: number) => string | null,
): readonly (readonly string[])[] {
  const runs: string[][] = [];
  let run: string[] = [];
  for (let pos = 1; pos <= count; pos++) {
    const point = pointAt(pos);
    if (point === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      continue;
    }
    run.push(point);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

export function slotWidthFor(plotWidth: number, slots: number): number {
  return slots > 0 ? plotWidth / slots : plotWidth;
}

/**
 * The LEFT edge of a slot — where an hour tick goes, because a tick names the instant its
 * interval STARTS. See this plan's START-versus-END note: placing a start-labelled tick at the
 * right edge draws every hour label one slot late, and on a 96-point axis that is invisible.
 */
export function slotStartX(pos: number, padLeft: number, slotWidth: number): number {
  return padLeft + (pos - 1) * slotWidth;
}

/** The CENTRE of a slot — where a plotted point goes. */
export function slotCentreX(pos: number, padLeft: number, slotWidth: number): number {
  return padLeft + (pos - 0.5) * slotWidth;
}

/**
 * The rendered width of a bar inside its own pitch: a 2px gap in the surface colour between
 * touching bars, tapering to a quarter of the pitch when the pitch is too dense for a fixed gap.
 * Ported from trading-poc (`customer-portal.html:5392-5395`).
 */
export function barWidthFor(pitch: number): number {
  const gap = pitch >= 8 ? 2 : Math.max(pitch * 0.25, 0.5);
  return Math.max(pitch - gap, 0.5);
}

/**
 * `1.234,6 kWh`, or the unavailable glyph for a missing value.
 *
 * ⚠ null and 0 must never format the same. A null is MISSING and a 0 is a MEASURED ZERO, and
 * collapsing the two is the one thing this whole slice exists to prevent.
 */
export function formatKwh(value: number | null): string {
  return value === null ? PP_UNAVAILABLE : `${formatDutchDecimal(value, 1)} kWh`;
}

/** The day of the month from a `yyyy-MM-dd` string, without constructing a Date. */
export function dayNumber(date: string): number {
  return Number(date.slice(8, 10));
}
```

- [ ] **Step 5: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: PASS — every suite in `chart-geometry.spec.ts` green, and every pre-existing shared-ui
suite still green.

- [ ] **Step 6: Mutation check — the host-timezone reading**

In `chart-geometry.ts`, replace the body of `localTime` with the obvious wrong thing:

```ts
export function localTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && TZ=UTC npm run test:shared-ui
```

Expected: **FAIL** — `reads the wall clock as WRITTEN, not as the host machine sees it` reports
`expected '22:15' to be '00:15'` for the first assertion, and the two strings that are the same
instant now format identically, so the second assertion fails too.

⚠ **Run this mutation with `TZ=UTC` explicitly.** On an Amsterdam developer machine the wrong
implementation gives the right answer for the first assertion, and the mutation would look
survivable — which is precisely the bug: the code is correct on the author's laptop and wrong on
the CI runner. **Restore immediately.**

- [ ] **Step 7: Mutation check — the tick's left edge**

In `chart-geometry.ts`, change `slotStartX` to the right edge:

```ts
export function slotStartX(pos: number, padLeft: number, slotWidth: number): number {
  return padLeft + pos * slotWidth;
}
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: **FAIL** — `places a TICK at the LEFT edge of its slot, because a tick names the interval
START` reports `expected 50 to be close to 40` on the first assertion, and
`expected 90 to be less than 95` on the slot-centre comparison. Both are the fifteen-minute shift
`consumption-calc.js:43-58` documents. **Restore immediately.**

- [ ] **Step 8: Mutation check — the run of one**

In `chart-geometry.ts`, drop one-point runs the way the prior art does — in **both** places, or the
mutation is only half applied:

```ts
    if (point === null) {
      if (run.length > 1) runs.push(run);
      run = [];
      continue;
    }
    ...
  if (run.length > 1) runs.push(run);
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: **FAIL** — `KEEPS a run of one, so a lone measured interval is not silently dropped`
reports `expected [] to deeply equal [ [ 'b' ] ]`. **Restore immediately.**

- [ ] **Step 9: Mutation check — the degenerate scale**

In `chart-geometry.ts`, delete the line `if (max === min) max = min + 1;`.

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: **FAIL** — `survives a day whose every value is zero` reports `expected 0 to be 1`, then
`expected false to be true` on `Number.isFinite(scale.zeroY)` (`0/0` is `NaN`). And
`survives a day with no readings at all` fails the same way. **Restore immediately.**

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/usage-chart
git commit -m "feat(shared-ui): the frozen usage-chart types and the shared chart geometry

Pure, DOM-free geometry for both usage charts: a scale seeded at zero on both sides so
the zero line is always drawn and negative net usage is accommodated [DEC-22]; hour
ticks read from dstPass so the autumn duplicate reads 02:00 A / 02:00 B [F03-R03]; and
line runs broken at every gap [F03-R06].

Verified by mutation four ways. localTime rewritten as new Date().getHours() goes red
under TZ=UTC (the whole point: it is correct on an Amsterdam laptop). slotStartX moved
to the right edge goes red on the tick-placement test — the fifteen-minute shift
trading-poc's consumption-calc.js:43-58 documents. Dropping one-point runs, as
trading-poc's lineSegments does, makes a lone measured interval invisible. Removing the
degenerate-range guard turns an all-zero day into an SVG of NaN coordinates."
```

---

### Task 3: `PpUsageChart` — the day chart

The `[DEC-22]` picture: three series over 92, 96 or 100 fifteen-minute slots, on an axis that
accommodates negative net usage with the zero line always drawn, missing intervals as gaps, and the
autumn duplicate hour labelled `02:00 A` / `02:00 B`.

Four rules carry the component, and each has a mutation step of its own:

1. **`intervalCount` is the axis length, `intervals.length` is not.** A 100-point day with four
   missing intervals has 100 slots and four gaps.
2. **The three series are distinguishable with colour removed** (design §7.16). All three declare
   `stroke-dasharray` — including the solid one, which declares `none` — so the assertion is over
   three values rather than two values and an absence.
3. **A missing interval is a gap in the path**, never a point on the zero line.
4. **A declared zero is stated, not implied** `[F02-R33]`. The production line of a `NEVER`
   connection lies on the zero line, where it would read as an absence; the chart says so in words.

**The sizing model, stated because a reader will otherwise assume pixels.** The SVG carries
`viewBox="0 0 960 {height}"` and the stylesheet gives it `width:100%; height:auto`, so it scales
**uniformly** to its container and `height` sets the aspect ratio rather than a pixel height. At the
portal's content column the rendered height is close to `height()`; narrower, everything — strokes,
text, ticks — scales down together. The alternative, `preserveAspectRatio="none"`, stretches strokes
and text non-uniformly, which is the letterboxing-and-distortion pair `trading-poc` worked around
with a resize observer (`customer-portal.html:5712-5717`). A resize observer is `[F03-R25]`'s
territory and `[F03-R25]` is deferred (design §3.2), so uniform scaling is the honest choice here —
**and it is what makes every coordinate in the spec below deterministic**, which a measured layout
in jsdom is not.

⚠ **jsdom's `getBoundingClientRect()` returns all zeros.** `onPointerMove` therefore cannot be
exercised from a spec at all, which is why `posAt(userX)` is a separate `protected` method with its
own assertions and why `onPointerMove` bails on a zero-width rect. Without that bail, `(clientX −
0) / 0` is `Infinity`, `Math.floor(Infinity)` is `Infinity`, and `hoveredPos` is set to a number no
comparison rejects.

**Files:**
- Create: `libs/shared-ui/src/lib/usage-chart/pp-usage-chart.ts`
- Create: `libs/shared-ui/src/lib/usage-chart/pp-usage-chart.css`
- Test: `libs/shared-ui/src/lib/usage-chart/pp-usage-chart.spec.ts`

**Interfaces:**
- Consumes: everything task 2 produced from `./chart-geometry` and `./usage-chart.types`;
  `formatDutchDateTime` from `../format/dutch-date`; `cssText` / `ruleBody` from
  `../../testing/read-css`.
- Produces:
  - `export class PpUsageChart` — selector `pp-usage-chart`, `ChangeDetectionStrategy.OnPush`,
    `styleUrl: './pp-usage-chart.css'`, host class `pp-usage-chart pp-usage-chart--<state>`.
  - `day = input.required<PpUsageDay>()` · `height = input(320)` ·
    `hoveredPos = model<number | null>(null)` · `intervalActivated = output<number>()`
  - The DOM contract every consumer spec may rely on: `.pp-usage-chart__svg`,
    `.pp-usage-chart__zero`, `.pp-usage-chart__tick`, `.pp-usage-chart__tick-label`,
    `.pp-usage-chart__series--net` / `--consumption` / `--production`,
    `.pp-usage-chart__dot--net` / `--consumption` / `--production`,
    `.pp-usage-chart__crosshair`, `.pp-usage-chart__tooltip`, `.pp-usage-chart__declared`,
    `.pp-usage-chart__corrected`, `.pp-usage-chart__empty`, `.pp-usage-chart__live`.

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/usage-chart/pp-usage-chart.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { cssText, ruleBody } from '../../testing/read-css';
import { PP_UNAVAILABLE } from '../format/dutch-number';
import { PpUsageChart } from './pp-usage-chart';
import type { PpUsageDay, PpUsageInterval } from './usage-chart.types';

const CSS = 'lib/usage-chart/pp-usage-chart.css';

function interval(over: Partial<PpUsageInterval> = {}): PpUsageInterval {
  return {
    pos: 1,
    start: '2026-08-12T00:00:00+02:00',
    end: '2026-08-12T00:15:00+02:00',
    dstPass: null,
    consumptionKwh: 180,
    productionKwh: 0,
    netUsageKwh: 180,
    ...over,
  };
}

/** `count` intervals starting at midnight, fifteen minutes apart, all three series present. */
function denseIntervals(count: number, date = '2026-08-12'): PpUsageInterval[] {
  const out: PpUsageInterval[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * 15;
    const end = start + 15;
    const at = (m: number) =>
      `${date}T${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00+02:00`;
    out.push(
      interval({ pos: i + 1, start: at(start), end: at(end), consumptionKwh: 100 + i, netUsageKwh: 100 + i }),
    );
  }
  return out;
}

function day(over: Partial<PpUsageDay> = {}): PpUsageDay {
  return {
    date: '2026-08-12',
    intervalCount: 96,
    dataState: 'PROVISIONAL',
    intervals: denseIntervals(96),
    productionIsDeclaredZero: false,
    lastCorrectedAt: null,
    ...over,
  };
}

describe('pp-usage-chart', () => {
  let fixture: ComponentFixture<PpUsageChart>;
  let host: HTMLElement;

  function render(value: PpUsageDay = day(), height?: number): void {
    fixture = TestBed.createComponent(PpUsageChart, { inferTagName: true });
    fixture.componentRef.setInput('day', value);
    if (height !== undefined) fixture.componentRef.setInput('height', height);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  }

  const svg = () => host.querySelector('.pp-usage-chart__svg') as SVGSVGElement;
  const polylines = (series: string) =>
    [...host.querySelectorAll(`polyline.pp-usage-chart__series--${series}`)];
  const dots = (series: string) => [...host.querySelectorAll(`circle.pp-usage-chart__dot--${series}`)];
  const tickLabels = () =>
    [...host.querySelectorAll('.pp-usage-chart__tick-label')].map((n) => n.textContent?.trim());
  const tooltip = () => host.querySelector('.pp-usage-chart__tooltip');

  /** The x of the first point of a polyline, as a number. */
  function firstX(node: Element): number {
    return Number(node.getAttribute('points')!.trim().split(/[\s]+/)[0].split(',')[0]);
  }

  // ── the axis ──────────────────────────────────────────────────────────────

  it('draws the axis at intervalCount slots, not at intervals.length', () => {
    // [F03-R06] and shared contract §11.2. A 100-point autumn day carrying only 40 measured
    // intervals must still be a 100-slot day with sixty gaps — scaling to intervals.length
    // redraws the measured part across the whole width and it looks perfectly plausible.
    render(day({ intervalCount: 100, intervals: denseIntervals(40) }));

    const line = polylines('net')[0];
    // Slot width is (960 - 44 - 12) / 100 = 9.04, so the first point sits at 44 + 4.52 = 48.5.
    // At intervals.length = 40 the slot would be 22.6 and the first point 55.3.
    expect(firstX(line)).toBeCloseTo(48.5, 1);
  });

  it('always draws the zero line, even on a day that never exports', () => {
    // [F03-R02]. A scale fitted to the data alone puts the line off the bottom edge, where it
    // reads as absent rather than as drawn.
    render();

    const zero = host.querySelector('line.pp-usage-chart__zero');
    expect(zero).not.toBeNull();
    const y = Number(zero!.getAttribute('y1'));
    expect(Number.isFinite(y)).toBe(true);
    // Inside the plot: below the top padding and at or above the bottom of the plot.
    expect(y).toBeGreaterThanOrEqual(12);
    expect(y).toBeLessThanOrEqual(320 - 26);
  });

  it('puts a NEGATIVE net usage BELOW the zero line', () => {
    // [DEC-22]: net usage may be negative and settles as export [DEC-23]. Two intervals, one
    // exporting, so the assertion cannot pass on a chart that clipped the negative half.
    render(
      day({
        intervalCount: 2,
        intervals: [
          interval({ pos: 1, consumptionKwh: 100, productionKwh: 0, netUsageKwh: 100 }),
          interval({
            pos: 2,
            start: '2026-08-12T00:15:00+02:00',
            end: '2026-08-12T00:30:00+02:00',
            consumptionKwh: 0,
            productionKwh: 60,
            netUsageKwh: -60,
          }),
        ],
      }),
    );

    const points = polylines('net')[0].getAttribute('points')!.trim().split(/\s+/);
    const zeroY = Number(host.querySelector('line.pp-usage-chart__zero')!.getAttribute('y1'));
    const [, positiveY] = points[0].split(',').map(Number);
    const [, negativeY] = points[1].split(',').map(Number);

    // SVG y grows downward: above the line is a SMALLER y.
    expect(positiveY).toBeLessThan(zeroY);
    expect(negativeY).toBeGreaterThan(zeroY);
  });

  it('labels the hour ticks in Amsterdam local time, every third hour', () => {
    render();

    expect(tickLabels()).toEqual([
      '00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00',
    ]);
  });

  it('labels the autumn duplicate hour 02:00 A and 02:00 B', () => {
    // Design §7.10 and §7.16, [F03-R03]. Both intervals carry the SAME wall clock and differ
    // only in dstPass; a chart deriving the pass from the UTC offset would print 02:00 twice.
    render(
      day({
        date: '2026-10-25',
        intervalCount: 100,
        intervals: [
          interval({ pos: 9, start: '2026-10-25T02:00:00+02:00', end: '2026-10-25T02:15:00+02:00', dstPass: 'A' }),
          interval({ pos: 13, start: '2026-10-25T02:00:00+01:00', end: '2026-10-25T02:15:00+01:00', dstPass: 'B' }),
        ],
      }),
    );

    expect(tickLabels()).toEqual(['02:00 A', '02:00 B']);
  });

  it('places an hour tick at the LEFT edge of its own slot', () => {
    // The START-versus-END trap. A tick names the instant its interval STARTS, so it belongs at
    // the slot's left edge; the point for the same interval sits half a slot to its right.
    render(day({ intervalCount: 96, intervals: denseIntervals(96) }));

    const firstTick = host.querySelector('line.pp-usage-chart__tick')!;
    const slot = (960 - 44 - 12) / 96;
    expect(Number(firstTick.getAttribute('x1'))).toBeCloseTo(44, 1);
    expect(firstX(polylines('net')[0])).toBeCloseTo(44 + slot / 2, 1);
  });

  // ── the three series ──────────────────────────────────────────────────────

  it('draws all three series, net usage last so it is on top', () => {
    render();

    const order = [...svg().querySelectorAll('polyline')].map((n) =>
      n.getAttribute('class')!.replace('pp-usage-chart__series ', ''),
    );
    expect(order).toEqual([
      'pp-usage-chart__series--production',
      'pp-usage-chart__series--consumption',
      'pp-usage-chart__series--net',
    ]);
  });

  it('distinguishes the three series by STROKE PATTERN with the colour removed', () => {
    // Design §7.16 requires exactly this. All three declare stroke-dasharray, INCLUDING the solid
    // one, which declares `none`: an absent declaration is not a third pattern, it is a missing
    // one, and a set of two values plus an undefined would pass a naive size check.
    //
    // ⚠ The dash arrays are written with COMMAS. cssText() collapses all whitespace, so
    // `stroke-dasharray: 6 3` would read `stroke-dasharray:63` here — indistinguishable from
    // sixty-three, and from a typo.
    const css = cssText(CSS);
    const patternOf = (series: string): string => {
      const body = ruleBody(css, `.pp-usage-chart__series--${series}`);
      const match = body.match(/stroke-dasharray:([^;}]+)/);
      expect(match, `${series} declares no stroke-dasharray`).not.toBeNull();
      return match![1];
    };

    const patterns = [patternOf('net'), patternOf('consumption'), patternOf('production')];
    expect(patterns).toEqual(['none', '6,3', '2,3']);
    expect(new Set(patterns).size).toBe(3);
  });

  it('takes every series colour from a --pp-chart-* token, never a literal hex', () => {
    const css = cssText(CSS);
    expect(ruleBody(css, '.pp-usage-chart__series--net')).toContain('stroke:var(--pp-chart-usage)');
    expect(ruleBody(css, '.pp-usage-chart__series--consumption')).toContain(
      'stroke:var(--pp-chart-hedge)',
    );
    expect(ruleBody(css, '.pp-usage-chart__series--production')).toContain(
      'stroke:var(--pp-chart-long)',
    );
    // --pp-chart-long-fill (#00D4C6) is 1.9:1 on white and is a FILL token; using it as a stroke
    // is the accessibility defect shared contract §11.3 spells out.
    expect(css).not.toContain('--pp-chart-long-fill');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('draws no price, no euro and no block anywhere', () => {
    // S2-D6 and design §3.2. chart-day-view.svg is drawn WITH a day-ahead price, a SPOT RESULT
    // card and a block overlay; this component is built to the trimmed envelope, not the mockup.
    render();

    expect(host.textContent).not.toContain('€');
    expect(host.textContent?.toLowerCase()).not.toContain('block');
    expect(cssText(CSS)).not.toContain('--pp-chart-peak');
  });

  // ── gaps ──────────────────────────────────────────────────────────────────

  it('breaks the line at a missing interval instead of drawing through it', () => {
    // [F03-R06]: a gap, never a zero and never a bridge.
    render(
      day({
        intervalCount: 6,
        intervals: [
          interval({ pos: 1 }),
          interval({ pos: 2, start: '2026-08-12T00:15:00+02:00', end: '2026-08-12T00:30:00+02:00' }),
          interval({ pos: 5, start: '2026-08-12T01:00:00+02:00', end: '2026-08-12T01:15:00+02:00' }),
          interval({ pos: 6, start: '2026-08-12T01:15:00+02:00', end: '2026-08-12T01:30:00+02:00' }),
        ],
      }),
    );

    expect(polylines('net')).toHaveLength(2);
  });

  it('draws a lone measured interval as a dot rather than dropping it', () => {
    // A one-point run has no polyline to be. trading-poc discards it and the interval vanishes,
    // which reads as "no data" for an interval that was measured.
    render(
      day({
        intervalCount: 5,
        intervals: [interval({ pos: 3, start: '2026-08-12T00:30:00+02:00', end: '2026-08-12T00:45:00+02:00' })],
      }),
    );

    expect(polylines('net')).toHaveLength(0);
    expect(dots('net')).toHaveLength(1);
  });

  it('breaks ONE series without breaking the others', () => {
    // netUsageKwh is missing when EITHER side is missing (shared contract §10.1), so a document
    // carrying consumption but not production leaves consumption whole and net broken. A chart
    // that gated all three on one presence check would blank the series it does have.
    render(
      day({
        intervalCount: 3,
        intervals: [
          interval({ pos: 1, consumptionKwh: 10, productionKwh: 1, netUsageKwh: 9 }),
          interval({
            pos: 2,
            start: '2026-08-12T00:15:00+02:00',
            end: '2026-08-12T00:30:00+02:00',
            consumptionKwh: 12,
            productionKwh: null,
            netUsageKwh: null,
          }),
          interval({
            pos: 3,
            start: '2026-08-12T00:30:00+02:00',
            end: '2026-08-12T00:45:00+02:00',
            consumptionKwh: 14,
            productionKwh: 2,
            netUsageKwh: 12,
          }),
        ],
      }),
    );

    expect(polylines('consumption')).toHaveLength(1);
    expect(polylines('net')).toHaveLength(0);
    expect(dots('net')).toHaveLength(2);
  });

  // ── hover, keyboard and the tooltip ───────────────────────────────────────

  it('names the interval a viewport x falls in, from 1 and clamped to the axis', () => {
    render(day({ intervalCount: 96 }));
    const chart = fixture.componentInstance as unknown as { posAt(x: number): number | null };

    const slot = (960 - 44 - 12) / 96;
    expect(chart.posAt(44 + 0.1)).toBe(1);
    expect(chart.posAt(44 + slot * 4.5)).toBe(5);
    // Off the plot on both sides, and NOT clamped to an edge interval — a hover in the left
    // gutter is not a hover on midnight.
    expect(chart.posAt(10)).toBeNull();
    expect(chart.posAt(959)).toBeNull();
  });

  it('answers null rather than a non-finite position when the layout has no width', () => {
    // jsdom's getBoundingClientRect() is all zeros and so is a chart that has not been laid out.
    // (clientX - 0) / 0 is Infinity; Math.floor(Infinity) + 1 is Infinity; and `Infinity < 1` and
    // `Infinity > 96` are BOTH false, so an unguarded implementation sets hoveredPos to Infinity.
    render();
    const chart = fixture.componentInstance as unknown as { posAt(x: number): number | null };

    expect(chart.posAt(Number.POSITIVE_INFINITY)).toBeNull();
    expect(chart.posAt(Number.NaN)).toBeNull();
  });

  it('shows a tooltip naming the whole time range and all three volumes', () => {
    render(
      day({
        intervalCount: 96,
        intervals: [
          interval({
            pos: 43,
            start: '2026-08-12T10:30:00+02:00',
            end: '2026-08-12T10:45:00+02:00',
            consumptionKwh: 607,
            productionKwh: 84,
            netUsageKwh: 523,
          }),
        ],
      }),
    );
    expect(tooltip()).toBeNull();

    fixture.componentRef.setInput('hoveredPos', 43);
    fixture.detectChanges();

    const text = tooltip()!.textContent!.replace(/\s+/g, ' ').trim();
    expect(text).toContain('10:30 – 10:45');
    expect(text).toContain('607,0 kWh');
    expect(text).toContain('84,0 kWh');
    expect(text).toContain('523,0 kWh');
  });

  it('shows no tooltip for a position with no interval behind it', () => {
    // Hovering a GAP must not print an empty card or, worse, the neighbouring interval's numbers.
    render(day({ intervalCount: 96, intervals: [interval({ pos: 43 })] }));

    fixture.componentRef.setInput('hoveredPos', 44);
    fixture.detectChanges();

    expect(tooltip()).toBeNull();
  });

  it('says a value is unavailable rather than printing a zero for it', () => {
    render(
      day({
        intervalCount: 96,
        intervals: [interval({ pos: 7, consumptionKwh: 50, productionKwh: null, netUsageKwh: null })],
      }),
    );
    fixture.componentRef.setInput('hoveredPos', 7);
    fixture.detectChanges();

    const text = tooltip()!.textContent!;
    expect(text).toContain(PP_UNAVAILABLE);
    expect(text).toContain('50,0 kWh');
  });

  it('moves the hover with the arrow keys and clamps at both ends', () => {
    render(day({ intervalCount: 96 }));
    const el = svg();

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    // Focus has not been given, so there is no starting position: the first step lands on 1.
    expect(fixture.componentInstance.hoveredPos()).toBe(1);

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.hoveredPos()).toBe(1);

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.hoveredPos()).toBe(96);

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.hoveredPos()).toBe(96);
  });

  it('emits the hovered position on Enter and on a click, and nothing when nothing is hovered', () => {
    render(day({ intervalCount: 96 }));
    const emitted: number[] = [];
    fixture.componentInstance.intervalActivated.subscribe((pos) => emitted.push(pos));

    svg().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(emitted).toEqual([]);

    fixture.componentRef.setInput('hoveredPos', 12);
    fixture.detectChanges();
    svg().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    svg().dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(emitted).toEqual([12, 12]);
  });

  it('announces the hovered interval to a screen reader', () => {
    render(
      day({
        intervalCount: 96,
        intervals: [
          interval({
            pos: 43,
            start: '2026-08-12T10:30:00+02:00',
            end: '2026-08-12T10:45:00+02:00',
            consumptionKwh: 607,
            productionKwh: 84,
            netUsageKwh: 523,
          }),
        ],
      }),
    );
    const live = host.querySelector('.pp-usage-chart__live')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent?.trim()).toBe('');

    fixture.componentRef.setInput('hoveredPos', 43);
    fixture.detectChanges();

    expect(live.textContent).toContain('10:30 – 10:45');
    expect(live.textContent).toContain('Net usage 523,0 kWh');
  });

  it('draws the crosshair only while something is hovered', () => {
    render();
    expect(host.querySelector('.pp-usage-chart__crosshair')).toBeNull();

    fixture.componentRef.setInput('hoveredPos', 20);
    fixture.detectChanges();

    const slot = (960 - 44 - 12) / 96;
    const crosshair = host.querySelector('line.pp-usage-chart__crosshair')!;
    expect(Number(crosshair.getAttribute('x1'))).toBeCloseTo(44 + 19.5 * slot, 1);
  });

  it('is reachable by keyboard and describes itself', () => {
    render();

    expect(svg().getAttribute('tabindex')).toBe('0');
    expect(svg().getAttribute('role')).toBe('img');
    expect(svg().getAttribute('aria-label')).toContain('12 August 2026');
    expect(svg().getAttribute('aria-label')).toContain('96');
  });

  // ── the five treatments ───────────────────────────────────────────────────

  it('marks a provisional day, and does not mark a final one', () => {
    render(day({ dataState: 'PROVISIONAL' }));
    expect(host.classList.contains('pp-usage-chart--provisional')).toBe(true);
    expect(host.querySelector('.pp-usage-chart__hatch')).not.toBeNull();

    render(day({ dataState: 'FINAL' }));
    expect(host.classList.contains('pp-usage-chart--final')).toBe(true);
    expect(host.querySelector('.pp-usage-chart__hatch')).toBeNull();
  });

  it('marks a partial day too, with the same amber treatment', () => {
    render(day({ dataState: 'PARTIAL' }));

    expect(host.classList.contains('pp-usage-chart--partial')).toBe(true);
    expect(host.querySelector('.pp-usage-chart__hatch')).not.toBeNull();
    expect(ruleBody(cssText(CSS), '.pp-usage-chart__hatch-line')).toContain(
      'stroke:var(--pp-amber)',
    );
  });

  it('gives two instances of the chart two different pattern ids', () => {
    // One SVG `id` shared by two charts on one page makes the second reference the first's
    // pattern, and a chart whose sibling unmounts loses its hatch entirely.
    render(day({ dataState: 'PROVISIONAL' }));
    const first = host.querySelector('.pp-usage-chart__hatch')!.getAttribute('fill');

    render(day({ dataState: 'PROVISIONAL' }));
    const second = host.querySelector('.pp-usage-chart__hatch')!.getAttribute('fill');

    expect(first).not.toBe(second);
    expect(second).toMatch(/^url\(#pp-usage-chart-\d+-hatch\)$/);
  });

  it('states a declared zero in words rather than leaving a flat line to be read as an absence', () => {
    // [F02-R33]: where production_expectation is NEVER, production is a DECLARED zero from master
    // data, "not an absence inferred as zero". On the plot that line lies exactly on the zero
    // line, which is the one place a reader cannot tell the two apart — so the chart says so.
    render(day({ productionIsDeclaredZero: true }));

    const declared = host.querySelector('.pp-usage-chart__declared');
    expect(declared).not.toBeNull();
    expect(declared!.textContent).toContain('declared');
    expect(declared!.textContent).not.toContain('no data');

    render(day({ productionIsDeclaredZero: false }));
    expect(host.querySelector('.pp-usage-chart__declared')).toBeNull();
  });

  it('marks the day a correction landed on, with the date it landed', () => {
    // [DEC-98]: FINAL is a status, and a post-window reconciliation reopens the date. The marker
    // is what tells a customer the number they are looking at changed.
    render(day({ lastCorrectedAt: '2026-08-13T09:22:41Z' }));

    const marker = host.querySelector('.pp-usage-chart__corrected');
    expect(marker).not.toBeNull();
    // Amsterdam, not UTC: 09:22Z is 11:22 local.
    expect(host.textContent).toContain('13 aug 2026, 11:22');

    render(day({ lastCorrectedAt: null }));
    expect(host.querySelector('.pp-usage-chart__corrected')).toBeNull();
  });

  it('says there is nothing to draw rather than rendering an empty box', () => {
    render(day({ dataState: 'NO_DATA', intervals: [] }));

    expect(host.querySelector('.pp-usage-chart__empty')?.textContent).toBe(
      'No data for this day yet',
    );
    expect(polylines('net')).toHaveLength(0);
    // The axis and the zero line still render: an empty day has a shape.
    expect(host.querySelector('line.pp-usage-chart__zero')).not.toBeNull();
  });

  it('names the interval count and the zone under the plot', () => {
    render(day({ intervalCount: 100 }));

    expect(host.querySelector('.pp-usage-chart__caption')?.textContent).toContain(
      '100 intervals · Europe/Amsterdam',
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: FAIL — `Failed to resolve import "./pp-usage-chart" from "libs/shared-ui/src/lib/usage-chart/pp-usage-chart.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the component**

Create `libs/shared-ui/src/lib/usage-chart/pp-usage-chart.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';

import { formatDutchDate, formatDutchDateTime } from '../format/dutch-date';
import {
  formatKwh,
  hourTicks,
  intervalRangeLabel,
  lineRuns,
  scaleFor,
  slotCentreX,
  slotStartX,
  slotWidthFor,
} from './chart-geometry';
import type { PpUsageDay, PpUsageInterval } from './usage-chart.types';

/**
 * The plot's fixed user-space box. The SVG scales UNIFORMLY to its container
 * (`width:100%; height:auto`), so `height` sets the aspect ratio rather than a pixel height.
 *
 * `preserveAspectRatio="none"` would give exact pixels and stretch every stroke and glyph
 * non-uniformly; a resize observer would give both and is [F03-R25]'s territory, which design §3.2
 * defers. Uniform scaling is the honest third option here, and it is what makes every coordinate
 * in the spec deterministic rather than dependent on a layout jsdom does not perform.
 */
const VIEW_WIDTH = 960;
const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;

/** One point of one series, already rounded to a tenth of a user unit. */
interface PpPoint {
  readonly cx: number;
  readonly cy: number;
}

interface PpSeriesShape {
  /** One entry per unbroken run of two or more points, as a `points` attribute value. */
  readonly polylines: readonly string[];
  /** One entry per run of exactly ONE point, which has no polyline to be. */
  readonly dots: readonly PpPoint[];
}

/** Per-instance suffix for the hatch pattern's id. Two charts on one page must not share one. */
let instanceSeq = 0;

/**
 * The day chart — three series over 92, 96 or 100 fifteen-minute intervals.
 *
 * ⚠ This component and `PpUsageMonthChart` are the ENTIRE replaceable surface. S2-D5 defers the
 * charting-library choice [OQ-22]; what makes that deferral cheap is that no consumer knows how
 * these two draw. A consumer may not pass a colour, a scale, an axis configuration, a formatter or
 * an SVG fragment, and the events are SEMANTIC — which interval, never which pixel. Replacing the
 * pair with a library is then two files plus their specs.
 */
@Component({
  selector: 'pp-usage-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-usage-chart.css',
  template: `
    <figure class="pp-usage-chart__figure">
      <div class="pp-usage-chart__plot">
        <svg
          class="pp-usage-chart__svg"
          [attr.viewBox]="viewBox()"
          role="img"
          [attr.aria-label]="ariaLabel()"
          tabindex="0"
          (mousemove)="onPointerMove($event)"
          (mouseleave)="hoveredPos.set(null)"
          (focus)="onFocus()"
          (blur)="hoveredPos.set(null)"
          (keydown)="onKeyDown($event)"
          (click)="onActivate()"
        >
          @if (hatched()) {
            <defs>
              <pattern
                [attr.id]="hatchId()"
                patternUnits="userSpaceOnUse"
                width="6"
                height="6"
                patternTransform="rotate(45)"
              >
                <line class="pp-usage-chart__hatch-line" x1="0" y1="0" x2="0" y2="6" />
              </pattern>
            </defs>
            <rect
              class="pp-usage-chart__hatch"
              [attr.x]="padLeft"
              [attr.y]="padTop"
              [attr.width]="plotWidth()"
              [attr.height]="plotHeight()"
              [attr.fill]="'url(#' + hatchId() + ')'"
            />
          }

          @for (tick of ticks(); track tick.pos) {
            <line
              class="pp-usage-chart__tick"
              [attr.x1]="tickX(tick.pos)"
              [attr.y1]="padTop"
              [attr.x2]="tickX(tick.pos)"
              [attr.y2]="padTop + plotHeight()"
            />
            @if (tick.major) {
              <text
                class="pp-usage-chart__tick-label"
                [attr.x]="tickX(tick.pos)"
                [attr.y]="padTop + plotHeight() + 15"
              >{{ tick.label }}</text>
            }
          }

          <line
            class="pp-usage-chart__zero"
            [attr.x1]="padLeft"
            [attr.y1]="zeroY()"
            [attr.x2]="padLeft + plotWidth()"
            [attr.y2]="zeroY()"
          />

          <!-- Production first and net usage last: SVG paints in document order, and net usage is
               the [DEC-22] basis, so it is the line that must never be hidden under another. -->
          @for (run of production().polylines; track $index) {
            <polyline
              class="pp-usage-chart__series pp-usage-chart__series--production"
              [attr.points]="run"
            />
          }
          @for (dot of production().dots; track $index) {
            <circle class="pp-usage-chart__dot pp-usage-chart__dot--production"
              [attr.cx]="dot.cx" [attr.cy]="dot.cy" r="1.6" />
          }
          @for (run of consumption().polylines; track $index) {
            <polyline
              class="pp-usage-chart__series pp-usage-chart__series--consumption"
              [attr.points]="run"
            />
          }
          @for (dot of consumption().dots; track $index) {
            <circle class="pp-usage-chart__dot pp-usage-chart__dot--consumption"
              [attr.cx]="dot.cx" [attr.cy]="dot.cy" r="1.6" />
          }
          @for (run of net().polylines; track $index) {
            <polyline class="pp-usage-chart__series pp-usage-chart__series--net" [attr.points]="run" />
          }
          @for (dot of net().dots; track $index) {
            <circle class="pp-usage-chart__dot pp-usage-chart__dot--net"
              [attr.cx]="dot.cx" [attr.cy]="dot.cy" r="2" />
          }

          @if (day().productionIsDeclaredZero) {
            <text
              class="pp-usage-chart__declared"
              [attr.x]="padLeft + plotWidth() - 4"
              [attr.y]="zeroY() - 5"
            >Production is a declared zero</text>
          }

          @if (day().lastCorrectedAt; as at) {
            <g class="pp-usage-chart__corrected">
              <circle [attr.cx]="padLeft + plotWidth() - 5" [attr.cy]="padTop + 5" r="4" />
              <title>Corrected on {{ correctedAt() }}</title>
            </g>
          }

          @if (crosshairX(); as x) {
            <line
              class="pp-usage-chart__crosshair"
              [attr.x1]="x" [attr.y1]="padTop"
              [attr.x2]="x" [attr.y2]="padTop + plotHeight()"
            />
          }

          @if (isEmpty()) {
            <text
              class="pp-usage-chart__empty"
              [attr.x]="padLeft + plotWidth() / 2"
              [attr.y]="padTop + plotHeight() / 2"
            >No data for this day yet</text>
          }
        </svg>

        @if (hovered(); as item) {
          <div class="pp-usage-chart__tooltip" [style.left.%]="tooltipLeft()">
            <div class="pp-usage-chart__tooltip-head">{{ range(item) }}</div>
            <div class="pp-usage-chart__tooltip-row">
              <span>Consumption</span><span>{{ kwh(item.consumptionKwh) }}</span>
            </div>
            <div class="pp-usage-chart__tooltip-row">
              <span>Production</span>
              <span>{{ kwh(item.productionKwh) }}{{ declaredSuffix() }}</span>
            </div>
            <div class="pp-usage-chart__tooltip-row pp-usage-chart__tooltip-row--net">
              <span>Net usage</span><span>{{ kwh(item.netUsageKwh) }}</span>
            </div>
          </div>
        }
      </div>

      <figcaption class="pp-usage-chart__caption">{{ caption() }}</figcaption>
      <!-- Not decoration: the SVG is one `role="img"` with one label, so without this a keyboard
           reader arrowing across the plot hears nothing change. `role="status"` gives it an
           implicit polite live region even where aria-live is ignored. -->
      <p class="pp-usage-chart__live" role="status" aria-live="polite">{{ liveText() }}</p>
    </figure>
  `,
  host: { '[class]': 'hostClass()' },
})
export class PpUsageChart {
  readonly day = input.required<PpUsageDay>();
  readonly height = input(320);
  /** Two-way, so a KPI strip beside the chart can follow the hover without owning it. */
  readonly hoveredPos = model<number | null>(null);
  /** The POSITION, never a pixel or a DOM event — S2-D5. */
  readonly intervalActivated = output<number>();

  protected readonly padLeft = PAD_LEFT;
  protected readonly padTop = PAD_TOP;

  private readonly instance = ++instanceSeq;
  protected readonly hatchId = computed(() => `pp-usage-chart-${this.instance}-hatch`);

  protected readonly hostClass = computed(
    () => `pp-usage-chart pp-usage-chart--${this.day().dataState.toLowerCase().replace('_', '-')}`,
  );

  protected readonly viewBox = computed(() => `0 0 ${VIEW_WIDTH} ${this.height()}`);
  protected readonly plotWidth = computed(() => VIEW_WIDTH - PAD_LEFT - PAD_RIGHT);
  protected readonly plotHeight = computed(() => this.height() - PAD_TOP - PAD_BOTTOM);

  /** Position → interval, for the sparse lookup every series and the tooltip do. */
  private readonly byPos = computed(
    () => new Map(this.day().intervals.map((item) => [item.pos, item] as const)),
  );

  private readonly slotWidth = computed(() =>
    slotWidthFor(this.plotWidth(), this.day().intervalCount),
  );

  /**
   * ⚠ Every value of all three series feeds the scale, and `scaleFor` seeds it at zero on both
   * sides, so the zero line is always inside the plot [F03-R02] and a negative net usage is
   * accommodated rather than clipped [DEC-22].
   */
  private readonly scale = computed(() => {
    const values: (number | null)[] = [];
    for (const item of this.day().intervals) {
      values.push(item.consumptionKwh, item.productionKwh, item.netUsageKwh);
    }
    return scaleFor(values, PAD_TOP, this.plotHeight());
  });

  protected readonly zeroY = computed(() => round(this.scale().zeroY));
  protected readonly ticks = computed(() => hourTicks(this.day()));
  protected readonly isEmpty = computed(() => this.day().intervals.length === 0);
  protected readonly hatched = computed(
    () => this.day().dataState === 'PARTIAL' || this.day().dataState === 'PROVISIONAL',
  );

  protected readonly production = computed(() => this.shapeOf((i) => i.productionKwh));
  protected readonly consumption = computed(() => this.shapeOf((i) => i.consumptionKwh));
  protected readonly net = computed(() => this.shapeOf((i) => i.netUsageKwh));

  protected readonly hovered = computed(() => {
    const pos = this.hoveredPos();
    return pos === null ? null : (this.byPos().get(pos) ?? null);
  });

  protected readonly crosshairX = computed(() => {
    const pos = this.hoveredPos();
    return pos === null ? null : round(slotCentreX(pos, PAD_LEFT, this.slotWidth()));
  });

  protected readonly tooltipLeft = computed(() => {
    const x = this.crosshairX();
    if (x === null) return 0;
    // Percent, not pixels: the SVG scales with its container and a pixel offset would drift.
    // Clamped so a tooltip on the first or last interval does not hang off the card.
    return Math.min(Math.max((x / VIEW_WIDTH) * 100, 8), 92);
  });

  protected readonly correctedAt = computed(() => formatDutchDateTime(this.day().lastCorrectedAt));

  protected readonly caption = computed(() => {
    const parts = [`${this.day().intervalCount} intervals · Europe/Amsterdam`];
    if (this.day().lastCorrectedAt !== null) parts.push(`corrected ${this.correctedAt()}`);
    return parts.join(' · ');
  });

  protected readonly ariaLabel = computed(
    () =>
      `Consumption, production and net usage for ${formatDutchDate(this.day().date)}, ` +
      `${this.day().intervalCount} fifteen-minute intervals.`,
  );

  protected readonly liveText = computed(() => {
    const item = this.hovered();
    if (item === null) return '';
    return (
      `${intervalRangeLabel(item)}. Consumption ${formatKwh(item.consumptionKwh)}. ` +
      `Production ${formatKwh(item.productionKwh)}. Net usage ${formatKwh(item.netUsageKwh)}.`
    );
  });

  protected readonly declaredSuffix = computed(() =>
    this.day().productionIsDeclaredZero ? ' · declared' : '',
  );

  protected tickX(pos: number): number {
    // The LEFT edge. A tick names the instant its interval STARTS.
    return round(slotStartX(pos, PAD_LEFT, this.slotWidth()));
  }

  protected range(item: PpUsageInterval): string {
    return intervalRangeLabel(item);
  }

  protected kwh(value: number | null): string {
    return formatKwh(value);
  }

  /**
   * The 1-based interval a user-space x falls in, or null when it falls outside the plot.
   *
   * ⚠ `Number.isFinite` first. A zero-width layout makes the caller's arithmetic `Infinity`, and
   * neither `Infinity < 1` nor `Infinity > count` is true — so without the finiteness check an
   * unlaid-out chart sets `hoveredPos` to a value no later comparison rejects.
   *
   * ⚠ Out of range answers NULL rather than clamping to the nearest interval. A hover in the left
   * gutter is not a hover on midnight, and a tooltip that appears for a pointer outside the plot
   * is a tooltip nobody asked for.
   */
  protected posAt(userX: number): number | null {
    const pos = Math.floor((userX - PAD_LEFT) / this.slotWidth()) + 1;
    if (!Number.isFinite(pos) || pos < 1 || pos > this.day().intervalCount) return null;
    return pos;
  }

  protected onPointerMove(event: MouseEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    // Not laid out (jsdom, or a hidden tab): there is no position to report and dividing by the
    // width would produce one anyway.
    if (rect.width === 0) return;
    this.hoveredPos.set(this.posAt(((event.clientX - rect.left) / rect.width) * VIEW_WIDTH));
  }

  protected onFocus(): void {
    if (this.hoveredPos() === null) this.hoveredPos.set(1);
  }

  protected onActivate(): void {
    const pos = this.hoveredPos();
    if (pos !== null) this.intervalActivated.emit(pos);
  }

  protected onKeyDown(event: KeyboardEvent): void {
    const count = this.day().intervalCount;
    const current = this.hoveredPos();

    if (event.key === 'Enter' || event.key === ' ') {
      if (current === null) return;
      event.preventDefault();
      this.intervalActivated.emit(current);
      return;
    }

    // Home and End are expressed as a full-width step and then clamped, so there is one clamp.
    const step =
      event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowLeft' ? -1
      : event.key === 'End' ? count
      : event.key === 'Home' ? -count
      : 0;
    if (step === 0) return;

    event.preventDefault();
    this.hoveredPos.set(Math.min(Math.max((current ?? 1) + step, 1), count));
  }

  /**
   * One series' geometry. A run of two or more points becomes a polyline; a run of exactly one
   * becomes a DOT, because a lone measured interval between two gaps has no line to be and
   * dropping it reads as no data at all.
   */
  private shapeOf(pick: (item: PpUsageInterval) => number | null): PpSeriesShape {
    const slot = this.slotWidth();
    const scale = this.scale();
    const byPos = this.byPos();

    const runs = lineRuns(this.day().intervalCount, (pos) => {
      const item = byPos.get(pos);
      if (item === undefined) return null;
      const value = pick(item);
      if (value === null) return null;
      return `${round(slotCentreX(pos, PAD_LEFT, slot))},${round(scale.y(value))}`;
    });

    const polylines: string[] = [];
    const dots: PpPoint[] = [];
    for (const run of runs) {
      if (run.length === 1) {
        const [cx, cy] = run[0].split(',').map(Number);
        dots.push({ cx, cy });
      } else {
        polylines.push(run.join(' '));
      }
    }
    return { polylines, dots };
  }
}

/** One decimal is plenty in a 960-unit box, and it keeps the `points` attribute readable. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}
```

- [ ] **Step 4: Write the stylesheet**

Create `libs/shared-ui/src/lib/usage-chart/pp-usage-chart.css`:

```css
/* Every colour here is a token. Shared contract §11.3 fixes the three series' tokens AND their
   stroke patterns, and design §7.16 requires the three to be distinguishable with colour removed —
   so all three declare stroke-dasharray, including the solid one, which declares `none`.

   ⚠ The dash arrays use COMMAS. Every rule-scoped assertion in this repository reads CSS with all
   whitespace collapsed, where `6 3` becomes `63`. */
:host {
  display: block;
  font-family: var(--font-sans);
}

.pp-usage-chart__figure { margin: 0; }

.pp-usage-chart__plot { position: relative; }

/* Uniform scaling. `height` on the component sets the viewBox height, i.e. the aspect ratio. */
.pp-usage-chart__svg { display: block; width: 100%; height: auto; }
.pp-usage-chart__svg:focus-visible {
  outline: 2px solid var(--pp-blue-300);
  outline-offset: 2px;
}

.pp-usage-chart__zero { stroke: var(--pp-border-strong); stroke-width: 1; }
.pp-usage-chart__tick { stroke: var(--pp-border); stroke-width: 1; }
.pp-usage-chart__tick-label {
  font-size: 10px;
  fill: var(--pp-text-body);
  text-anchor: middle;
}

.pp-usage-chart__series { fill: none; stroke-linejoin: round; stroke-linecap: round; }
/* Net usage is the [DEC-22] basis: solid, heaviest, and painted last. */
.pp-usage-chart__series--net {
  stroke: var(--pp-chart-usage);
  stroke-width: 2;
  stroke-dasharray: none;
}
.pp-usage-chart__series--consumption {
  stroke: var(--pp-chart-hedge);
  stroke-width: 1.5;
  stroke-dasharray: 6,3;
}
/* --pp-chart-long, not --pp-chart-long-fill: the fill token is 1.9:1 on white and is illegal as
   a stroke. The stroke token clears 3:1 at 3.02:1, which is why it is the one named here. */
.pp-usage-chart__series--production {
  stroke: var(--pp-chart-long);
  stroke-width: 1.5;
  stroke-dasharray: 2,3;
}

.pp-usage-chart__dot--net { fill: var(--pp-chart-usage); }
.pp-usage-chart__dot--consumption { fill: var(--pp-chart-hedge); }
.pp-usage-chart__dot--production { fill: var(--pp-chart-long); }

.pp-usage-chart__hatch-line { stroke: var(--pp-amber); stroke-width: 1; opacity: 0.3; }

.pp-usage-chart__crosshair {
  stroke: var(--pp-text-heading);
  stroke-width: 1;
  stroke-dasharray: 3,3;
}

.pp-usage-chart__corrected { fill: var(--pp-violet); }

/* Right-anchored on the zero line: the declared-zero production series lies exactly on it, which
   is the one place a reader cannot tell a stated zero from an absence [F02-R33]. */
.pp-usage-chart__declared {
  font-size: 10px;
  fill: var(--pp-text-faint);
  text-anchor: end;
}

.pp-usage-chart__empty {
  font-size: 12px;
  fill: var(--pp-text-faint);
  text-anchor: middle;
}

.pp-usage-chart__caption {
  margin: 6px 0 0;
  font-size: var(--text-xs);
  color: var(--pp-text-faint);
}

/* The tooltip is absolutely positioned over the plot and offset by a PERCENTAGE, because the SVG
   scales with its container and a pixel offset would drift away from the crosshair. */
.pp-usage-chart__tooltip {
  position: absolute;
  top: 8px;
  transform: translateX(-50%);
  pointer-events: none;
  min-width: 168px;
  padding: 8px 10px;
  border: 1px solid var(--pp-border-strong);
  border-radius: var(--radius-md);
  background: var(--pp-surface);
  box-shadow: var(--pp-shadow-card);
  font-size: 11.5px;
  color: var(--pp-text-body);
}
.pp-usage-chart__tooltip-head {
  margin-bottom: 6px;
  font-weight: var(--weight-semibold);
  color: var(--pp-text-heading);
}
.pp-usage-chart__tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  line-height: 1.6;
}
.pp-usage-chart__tooltip-row--net {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--pp-border);
  font-weight: var(--weight-semibold);
  color: var(--pp-text-heading);
}

/* Visually hidden, NOT display:none — a display:none live region is not announced. */
.pp-usage-chart__live {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
```

- [ ] **Step 5: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: PASS.

⚠ If `takes every series colour from a --pp-chart-* token, never a literal hex` fails on
`expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/)`, the offender is a hex somebody typed into a comment.
`cssText()` strips comments before matching, so a failure here is a real declaration — fix the
declaration, never the assertion.

- [ ] **Step 6: Mutation check — the axis length**

In `pp-usage-chart.ts`, change `slotWidth` to scale to the measured intervals:

```ts
  private readonly slotWidth = computed(() =>
    slotWidthFor(this.plotWidth(), this.day().intervals.length),
  );
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: **FAIL** — `draws the axis at intervalCount slots, not at intervals.length` reports
`expected 55.3 to be close to 48.5`. Note what does **not** fail: every dense-day assertion in the
file stays green, because on a dense day the two numbers are equal. That is the whole reason the
fixture for this one test is deliberately sparse. **Restore immediately.**

- [ ] **Step 7: Mutation check — the gap**

In `pp-usage-chart.ts`, make an absent interval a zero instead of a break, inside `shapeOf`:

```ts
      const item = byPos.get(pos);
      if (item === undefined) {
        return `${round(slotCentreX(pos, PAD_LEFT, slot))},${round(scale.y(0))}`;
      }
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: **FAIL** — `breaks the line at a missing interval instead of drawing through it` reports
`expected 1 to be 2` (one continuous polyline where there should be two), and
`draws a lone measured interval as a dot rather than dropping it` reports `expected 1 to be 0` for
the polyline count. This is the `[F03-R06]` failure exactly: the chart is now drawing a line to
zero for intervals nobody measured, and it looks entirely plausible. **Restore immediately.**

- [ ] **Step 8: Mutation check — the DST pass**

In `chart-geometry.ts`, derive the pass from the offset instead of from `dstPass`:

```ts
export function tickLabel(item: PpUsageInterval): string {
  const time = localTime(item.start);
  return item.start.endsWith('+01:00') ? `${time} B` : time;
}
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: **FAIL**, three ways —
`labels the autumn duplicate hour 02:00 A and 02:00 B` (in both the geometry suite and the
component suite) reports `expected [ '02:00', '02:00 B' ] to deeply equal [ '02:00 A', '02:00 B' ]`,
and `labels the hour ticks in Amsterdam local time, every third hour` stays green — because a summer
day carries `+02:00` throughout, which is exactly why the offset reading survives every ordinary
day and fails on the one day of the year it matters. **Restore immediately.**

- [ ] **Step 9: Mutation check — the stroke patterns**

In `pp-usage-chart.css`, delete the line `stroke-dasharray: none;` from
`.pp-usage-chart__series--net`.

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: **FAIL** — `distinguishes the three series by STROKE PATTERN with the colour removed`
reports `net declares no stroke-dasharray: expected null not to be null`. Predicted before running:
the failure is the explicit "declares no stroke-dasharray" message, not a set-size mismatch — the
`expect(match, ...)` guard is there so the diagnosis names the series. **Restore immediately.**

- [ ] **Step 10: Mutation check — the declared zero**

In `pp-usage-chart.ts`, delete the whole `@if (day().productionIsDeclaredZero) { … }` block from
the template.

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: **FAIL** — `states a declared zero in words rather than leaving a flat line to be read as
an absence` reports `expected null not to be null`. Predicted before running: **no other test goes
red**, because a production line of zeroes draws perfectly happily on top of the zero line and looks
exactly like a connection with no production data. That indistinguishability is what `[F02-R33]`
exists to forbid. **Restore immediately.**

- [ ] **Step 11: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/usage-chart/pp-usage-chart.ts \
        libs/shared-ui/src/lib/usage-chart/pp-usage-chart.css \
        libs/shared-ui/src/lib/usage-chart/pp-usage-chart.spec.ts
git commit -m "feat(shared-ui): PpUsageChart, the hand-rolled day chart

Three series on an axis seeded at zero on both sides, missing intervals as gaps, hour
ticks at the LEFT edge of their slot because a tick names the instant its interval
starts, and 02:00 A / 02:00 B read from dstPass [F03-R02][F03-R03][F03-R06].

Verified by mutation five ways. Scaling to intervals.length instead of intervalCount
shifts a sparse day and leaves every dense-day assertion green. Filling a gap with a
zero draws usage nobody measured. Deriving the DST pass from the +01:00 offset survives
every day of the year except the one it matters on. Dropping stroke-dasharray:none from
the net line breaks the colour-removed distinguishability of design 7.16. And deleting
the declared-zero label leaves a NEVER connection's production reading as an absence,
with nothing else red — which is [F02-R33] exactly."
```

---

### Task 4: `PpUsageMonthChart` — the month chart, and the stub that is not a short bar

`[F03-R08]` daily totals for one calendar month, `[F03-R09]` every day clickable and drilling into
the day view, `[F03-R10]` **days with partial or missing data are visually marked, not silently
short.**

R10 is the requirement this component exists to satisfy and the one an implementation gets wrong by
doing the obvious thing. A day with no data has `netUsageKwh: null`; the obvious rendering is "no
bar", which is pixel-identical to a day that genuinely used nothing — and a month of nine missing
days then reads as a month of nine quiet days. So:

| Day | Rendering |
| --- | --- |
| `netUsageKwh: null` (missing) | a **stub**: a dashed, unfilled outline of fixed height sitting on the zero line |
| `netUsageKwh: 0` (measured zero) | a solid 1px tick on the zero line |
| `netUsageKwh > 0` | a bar above the zero line |
| `netUsageKwh < 0` | a bar **below** the zero line — the day exported more than it took |
| `dataState: 'PARTIAL'` | whichever of the above, plus the amber hatch |

⚠ **The month envelope is DENSE and the day envelope is SPARSE, and that is deliberate** (shared
contract §16, item 7): `days.length === dayCount` always, `NO_DATA` days carry `null` volumes, and
the chart cannot mark a day the payload does not mention. It is the one place two rules in the
contract disagree on purpose.

⚠ **Each day is a real focusable control, not a hover target.** `[F03-R09]` is a *Must* and a
click-only drill-in is unreachable by keyboard. Each day is an SVG `<g role="button" tabindex="0">`
carrying a full-height invisible hit rect, so the target is the whole column rather than a 4px bar,
and an `aria-label` that names the date, the volume and the data state.

**Files:**
- Create: `libs/shared-ui/src/lib/usage-chart/pp-usage-month-chart.ts`
- Create: `libs/shared-ui/src/lib/usage-chart/pp-usage-month-chart.css`
- Test: `libs/shared-ui/src/lib/usage-chart/pp-usage-month-chart.spec.ts`

**Interfaces:**
- Consumes: `scaleFor`, `slotWidthFor`, `slotStartX`, `barWidthFor`, `formatKwh`, `dayNumber` from
  `./chart-geometry`; `formatDutchDate` from `../format/dutch-date`; `PpUsageMonth`,
  `PpUsageMonthDay`, `PpUsageDataState` from `./usage-chart.types`.
- Produces:
  - `export class PpUsageMonthChart` — selector `pp-usage-month-chart`, OnPush,
    `styleUrl: './pp-usage-month-chart.css'`, host class
    `pp-usage-month-chart pp-usage-month-chart--<state>`.
  - `month = input.required<PpUsageMonth>()` · `height = input(280)` ·
    `hoveredDate = model<string | null>(null)` · `daySelected = output<string>()`
  - DOM contract: `.pp-usage-month-chart__svg`, `.pp-usage-month-chart__day` (one per day, with
    `data-date`), `.pp-usage-month-chart__bar`, `.pp-usage-month-chart__bar--negative`,
    `.pp-usage-month-chart__stub`, `.pp-usage-month-chart__measured-zero`,
    `.pp-usage-month-chart__partial`, `.pp-usage-month-chart__zero`,
    `.pp-usage-month-chart__day-label`, `.pp-usage-month-chart__tooltip`,
    `.pp-usage-month-chart__caption`.

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/usage-chart/pp-usage-month-chart.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { cssText, ruleBody } from '../../testing/read-css';
import { PP_MINUS, PP_UNAVAILABLE } from '../format/dutch-number';
import { PpUsageMonthChart } from './pp-usage-month-chart';
import type { PpUsageMonth, PpUsageMonthDay } from './usage-chart.types';

const CSS = 'lib/usage-chart/pp-usage-month-chart.css';

function monthDay(over: Partial<PpUsageMonthDay> = {}): PpUsageMonthDay {
  return {
    date: '2026-08-01',
    dataState: 'FINAL',
    consumptionKwh: 11420,
    productionKwh: 0,
    netUsageKwh: 11420,
    ...over,
  };
}

/** `count` consecutive days from the first of August, all measured. */
function denseDays(count: number): PpUsageMonthDay[] {
  const out: PpUsageMonthDay[] = [];
  for (let i = 1; i <= count; i++) {
    out.push(monthDay({ date: `2026-08-${String(i).padStart(2, '0')}`, netUsageKwh: 10000 + i }));
  }
  return out;
}

function month(over: Partial<PpUsageMonth> = {}): PpUsageMonth {
  return {
    month: '2026-08',
    dayCount: 31,
    dataState: 'PARTIAL',
    days: denseDays(31),
    ...over,
  };
}

describe('pp-usage-month-chart', () => {
  let fixture: ComponentFixture<PpUsageMonthChart>;
  let host: HTMLElement;

  function render(value: PpUsageMonth = month()): void {
    fixture = TestBed.createComponent(PpUsageMonthChart, { inferTagName: true });
    fixture.componentRef.setInput('month', value);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  }

  const groupFor = (date: string) =>
    host.querySelector(`.pp-usage-month-chart__day[data-date="${date}"]`)!;
  const tooltip = () => host.querySelector('.pp-usage-month-chart__tooltip');

  // ── the stub, which is the whole point ────────────────────────────────────

  it('marks a missing day as a STUB, not as a short bar', () => {
    // [F03-R10]. `netUsageKwh: null` rendered as "no bar" is pixel-identical to a day that used
    // nothing, and a month of missing days then reads as a month of quiet days.
    render(
      month({
        days: [
          monthDay({ date: '2026-08-01', netUsageKwh: 10000 }),
          monthDay({
            date: '2026-08-02',
            dataState: 'NO_DATA',
            consumptionKwh: null,
            productionKwh: null,
            netUsageKwh: null,
          }),
          ...denseDays(31).slice(2),
        ],
      }),
    );

    const missing = groupFor('2026-08-02');
    expect(missing.querySelector('.pp-usage-month-chart__stub')).not.toBeNull();
    expect(missing.querySelector('.pp-usage-month-chart__bar')).toBeNull();

    const measured = groupFor('2026-08-01');
    expect(measured.querySelector('.pp-usage-month-chart__bar')).not.toBeNull();
    expect(measured.querySelector('.pp-usage-month-chart__stub')).toBeNull();
  });

  it('tells a MEASURED ZERO from a missing day', () => {
    // The distinction the whole slice exists to preserve, and the one a bar chart erases: both
    // days have nothing to draw upwards, and only one of them is a fact.
    render(
      month({
        days: [
          monthDay({ date: '2026-08-01', consumptionKwh: 0, productionKwh: 0, netUsageKwh: 0 }),
          monthDay({
            date: '2026-08-02',
            dataState: 'NO_DATA',
            consumptionKwh: null,
            productionKwh: null,
            netUsageKwh: null,
          }),
          ...denseDays(31).slice(2),
        ],
      }),
    );

    expect(groupFor('2026-08-01').querySelector('.pp-usage-month-chart__measured-zero')).not.toBeNull();
    expect(groupFor('2026-08-01').querySelector('.pp-usage-month-chart__stub')).toBeNull();
    expect(groupFor('2026-08-02').querySelector('.pp-usage-month-chart__stub')).not.toBeNull();
    expect(groupFor('2026-08-02').querySelector('.pp-usage-month-chart__measured-zero')).toBeNull();
  });

  it('marks the stub with a dashed outline, so colour is not the only difference', () => {
    // Design §7.16's rule applied to this chart: with the colour removed, the stub is the one
    // shape with a dash pattern and no fill.
    const css = cssText(CSS);
    const stub = ruleBody(css, '.pp-usage-month-chart__stub');

    expect(stub).toContain('fill:none');
    expect(stub).toContain('stroke-dasharray:3,2');
    expect(ruleBody(css, '.pp-usage-month-chart__bar')).not.toContain('stroke-dasharray');
  });

  // ── the axis ──────────────────────────────────────────────────────────────

  it('lays the month out on dayCount slots', () => {
    render(month({ dayCount: 31, days: denseDays(31) }));

    expect(host.querySelectorAll('.pp-usage-month-chart__day')).toHaveLength(31);
    // (960 - 44 - 12) / 31 = 29.16, so the first slot starts at 44 and the second at 73.2.
    const slot = (960 - 44 - 12) / 31;
    expect(Number(groupFor('2026-08-02').querySelector('rect')!.getAttribute('x'))).toBeCloseTo(
      44 + slot,
      0,
    );
  });

  it('draws a NEGATIVE day below the zero line', () => {
    // [DEC-22]/[DEC-23]: a day that produced more than it consumed is an export day, and it is
    // the one shape a chart clipped at zero would silently turn into an empty column.
    render(
      month({
        dayCount: 2,
        days: [
          monthDay({ date: '2026-08-01', netUsageKwh: 1000 }),
          monthDay({ date: '2026-08-02', netUsageKwh: -400 }),
        ],
      }),
    );

    const zeroY = Number(host.querySelector('line.pp-usage-month-chart__zero')!.getAttribute('y1'));
    const positive = groupFor('2026-08-01').querySelector('.pp-usage-month-chart__bar')!;
    const negative = groupFor('2026-08-02').querySelector('.pp-usage-month-chart__bar')!;

    // SVG y grows downward: the positive bar's top edge is above the line, the negative bar's
    // top edge IS the line and it grows downward from there.
    expect(Number(positive.getAttribute('y'))).toBeLessThan(zeroY);
    expect(Number(negative.getAttribute('y'))).toBeCloseTo(zeroY, 1);
    expect(negative.getAttribute('class')).toContain('pp-usage-month-chart__bar--negative');
  });

  it('always draws the zero line', () => {
    render();

    expect(host.querySelector('line.pp-usage-month-chart__zero')).not.toBeNull();
  });

  it('labels the day of the month under every bar', () => {
    render(month({ dayCount: 3, days: denseDays(3) }));

    expect(
      [...host.querySelectorAll('.pp-usage-month-chart__day-label')].map((n) => n.textContent),
    ).toEqual(['1', '2', '3']);
  });

  // ── drill-in ──────────────────────────────────────────────────────────────

  it('drills into a day on a click, naming the DATE and not an index', () => {
    // [F03-R09]. An index would break the moment a month started on a day other than the first.
    render();
    const selected: string[] = [];
    fixture.componentInstance.daySelected.subscribe((date) => selected.push(date));

    (groupFor('2026-08-17') as SVGGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(selected).toEqual(['2026-08-17']);
  });

  it('drills in on Enter and on Space, so the drill-in is reachable by keyboard', () => {
    render();
    const selected: string[] = [];
    fixture.componentInstance.daySelected.subscribe((date) => selected.push(date));
    const group = groupFor('2026-08-05') as SVGGElement;

    expect(group.getAttribute('tabindex')).toBe('0');
    expect(group.getAttribute('role')).toBe('button');

    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    group.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

    expect(selected).toEqual(['2026-08-05', '2026-08-05']);
  });

  it('drills into a MISSING day too, because that is where a customer goes to see why', () => {
    // A stub that refuses the click is a dead end. The day view for a missing day renders the
    // empty state, which is the answer the customer came for.
    render(
      month({
        days: [
          monthDay({
            date: '2026-08-01',
            dataState: 'NO_DATA',
            consumptionKwh: null,
            productionKwh: null,
            netUsageKwh: null,
          }),
          ...denseDays(31).slice(1),
        ],
      }),
    );
    const selected: string[] = [];
    fixture.componentInstance.daySelected.subscribe((date) => selected.push(date));

    (groupFor('2026-08-01') as SVGGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(selected).toEqual(['2026-08-01']);
  });

  it('names every day for a screen reader, including its data state', () => {
    render(
      month({
        days: [
          monthDay({ date: '2026-08-01', dataState: 'FINAL', netUsageKwh: 11420 }),
          monthDay({
            date: '2026-08-02',
            dataState: 'NO_DATA',
            consumptionKwh: null,
            productionKwh: null,
            netUsageKwh: null,
          }),
          ...denseDays(31).slice(2),
        ],
      }),
    );

    expect(groupFor('2026-08-01').getAttribute('aria-label')).toBe(
      '1 aug 2026, net usage 11.420,0 kWh, final',
    );
    expect(groupFor('2026-08-02').getAttribute('aria-label')).toBe(
      '2 aug 2026, no data',
    );
  });

  // ── hover ─────────────────────────────────────────────────────────────────

  it('follows the hover and shows the three volumes for that day', () => {
    render();
    expect(tooltip()).toBeNull();

    (groupFor('2026-08-09') as SVGGElement).dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: false }),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.hoveredDate()).toBe('2026-08-09');
    const text = tooltip()!.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('9 aug 2026');
    expect(text).toContain('10.009,0 kWh');
  });

  it('says a missing day is missing rather than printing zeros for it', () => {
    render(
      month({
        days: [
          monthDay({
            date: '2026-08-01',
            dataState: 'NO_DATA',
            consumptionKwh: null,
            productionKwh: null,
            netUsageKwh: null,
          }),
          ...denseDays(31).slice(1),
        ],
      }),
    );

    fixture.componentRef.setInput('hoveredDate', '2026-08-01');
    fixture.detectChanges();

    const text = tooltip()!.textContent!;
    expect(text).toContain(PP_UNAVAILABLE);
    expect(text).not.toContain('0,0 kWh');
  });

  it("prints the product's minus in front of a negative day total", () => {
    render(
      month({ dayCount: 1, days: [monthDay({ date: '2026-08-01', netUsageKwh: -1234.5 })] }),
    );
    fixture.componentRef.setInput('hoveredDate', '2026-08-01');
    fixture.detectChanges();

    expect(tooltip()!.textContent).toContain(`${PP_MINUS}1.234,5 kWh`);
    expect(tooltip()!.textContent).not.toContain('-1.234,5');
  });

  // ── the treatments and the caption ────────────────────────────────────────

  it('hatches a partial day and leaves a final one alone', () => {
    render(
      month({
        days: [
          monthDay({ date: '2026-08-01', dataState: 'PARTIAL', netUsageKwh: 5000 }),
          monthDay({ date: '2026-08-02', dataState: 'FINAL', netUsageKwh: 9000 }),
          ...denseDays(31).slice(2),
        ],
      }),
    );

    expect(groupFor('2026-08-01').querySelector('.pp-usage-month-chart__partial')).not.toBeNull();
    expect(groupFor('2026-08-02').querySelector('.pp-usage-month-chart__partial')).toBeNull();
  });

  it('counts the measured days in the caption, so a gappy month says so', () => {
    // The mockup's "MEASURED (29 of 31 DAYS)" and "2 days awaiting data", in one line.
    render(
      month({
        days: [
          ...denseDays(29),
          monthDay({ date: '2026-08-30', dataState: 'NO_DATA', consumptionKwh: null, productionKwh: null, netUsageKwh: null }),
          monthDay({ date: '2026-08-31', dataState: 'NO_DATA', consumptionKwh: null, productionKwh: null, netUsageKwh: null }),
        ],
      }),
    );

    expect(host.querySelector('.pp-usage-month-chart__caption')?.textContent).toBe(
      '29 of 31 days measured · 2 days awaiting data',
    );
  });

  it('says so plainly when every day is measured', () => {
    render(month({ days: denseDays(31) }));

    expect(host.querySelector('.pp-usage-month-chart__caption')?.textContent).toBe(
      '31 of 31 days measured',
    );
  });

  it('draws no price, no euro and no block anywhere', () => {
    render();

    expect(host.textContent).not.toContain('€');
    expect(host.textContent?.toLowerCase()).not.toContain('block');
    expect(cssText(CSS)).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: FAIL — `Failed to resolve import "./pp-usage-month-chart" from "libs/shared-ui/src/lib/usage-chart/pp-usage-month-chart.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the component**

Create `libs/shared-ui/src/lib/usage-chart/pp-usage-month-chart.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';

import { formatDutchDate } from '../format/dutch-date';
import { barWidthFor, dayNumber, formatKwh, scaleFor, slotStartX, slotWidthFor } from './chart-geometry';
import type { PpUsageDataState, PpUsageMonth, PpUsageMonthDay } from './usage-chart.types';

const VIEW_WIDTH = 960;
const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 26;
/** The stub's height in user units. Fixed, and deliberately not proportional to anything. */
const STUB_HEIGHT = 10;

/** Everything one day column needs, computed once so the template holds no arithmetic. */
interface PpMonthColumn {
  readonly date: string;
  readonly label: string;
  readonly ariaLabel: string;
  readonly state: PpUsageDataState;
  readonly partial: boolean;
  /** The full-height hit rect: the whole column is the target, not a 4px bar. */
  readonly hitX: number;
  readonly hitWidth: number;
  readonly barX: number;
  readonly barWidth: number;
  /** Exactly one of these three is non-null. */
  readonly bar: { readonly y: number; readonly height: number; readonly negative: boolean } | null;
  readonly stub: { readonly y: number; readonly height: number } | null;
  readonly measuredZeroY: number | null;
}

let instanceSeq = 0;

/**
 * The month chart — one bar per day of one calendar month.
 *
 * ⚠ The month input is DENSE (`days.length === dayCount`, missing days present with null volumes)
 * where the day input is SPARSE. Shared contract §16 item 7 records that as a deliberate
 * disagreement: [F03-R10] needs a stub to MARK, and a chart cannot mark a day the payload does not
 * mention.
 */
@Component({
  selector: 'pp-usage-month-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-usage-month-chart.css',
  template: `
    <figure class="pp-usage-month-chart__figure">
      <div class="pp-usage-month-chart__plot">
        <svg
          class="pp-usage-month-chart__svg"
          [attr.viewBox]="viewBox()"
          [attr.aria-label]="ariaLabel()"
          (mouseleave)="hoveredDate.set(null)"
        >
          <defs>
            <pattern
              [attr.id]="hatchId()"
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(45)"
            >
              <line class="pp-usage-month-chart__hatch-line" x1="0" y1="0" x2="0" y2="6" />
            </pattern>
          </defs>

          <line
            class="pp-usage-month-chart__zero"
            [attr.x1]="padLeft" [attr.y1]="zeroY()"
            [attr.x2]="padLeft + plotWidth()" [attr.y2]="zeroY()"
          />

          @for (column of columns(); track column.date) {
            <g
              class="pp-usage-month-chart__day"
              role="button"
              tabindex="0"
              [attr.data-date]="column.date"
              [attr.aria-label]="column.ariaLabel"
              (click)="daySelected.emit(column.date)"
              (keydown.enter)="onActivate($event, column.date)"
              (keydown.space)="onActivate($event, column.date)"
              (mouseenter)="hoveredDate.set(column.date)"
              (focus)="hoveredDate.set(column.date)"
            >
              <!-- Transparent, full height, and FIRST so it sits under the mark it targets. -->
              <rect
                class="pp-usage-month-chart__hit"
                [attr.x]="column.hitX" [attr.y]="padTop"
                [attr.width]="column.hitWidth" [attr.height]="plotHeight()"
              />

              @if (column.bar; as bar) {
                <rect
                  class="pp-usage-month-chart__bar"
                  [class.pp-usage-month-chart__bar--negative]="bar.negative"
                  [attr.x]="column.barX" [attr.y]="bar.y"
                  [attr.width]="column.barWidth" [attr.height]="bar.height"
                />
              }
              @if (column.stub; as stub) {
                <rect
                  class="pp-usage-month-chart__stub"
                  [attr.x]="column.barX" [attr.y]="stub.y"
                  [attr.width]="column.barWidth" [attr.height]="stub.height"
                />
              }
              @if (column.measuredZeroY; as y) {
                <rect
                  class="pp-usage-month-chart__measured-zero"
                  [attr.x]="column.barX" [attr.y]="y - 1"
                  [attr.width]="column.barWidth" height="2"
                />
              }
              @if (column.partial && column.bar; as bar) {
                <rect
                  class="pp-usage-month-chart__partial"
                  [attr.x]="column.barX" [attr.y]="bar.y"
                  [attr.width]="column.barWidth" [attr.height]="bar.height"
                  [attr.fill]="'url(#' + hatchId() + ')'"
                />
              }

              <text
                class="pp-usage-month-chart__day-label"
                [attr.x]="column.barX + column.barWidth / 2"
                [attr.y]="padTop + plotHeight() + 14"
              >{{ column.label }}</text>
            </g>
          }
        </svg>

        @if (hovered(); as item) {
          <div class="pp-usage-month-chart__tooltip" [style.left.%]="tooltipLeft()">
            <div class="pp-usage-month-chart__tooltip-head">{{ dateLabel(item.date) }}</div>
            <div class="pp-usage-month-chart__tooltip-row">
              <span>Consumption</span><span>{{ kwh(item.consumptionKwh) }}</span>
            </div>
            <div class="pp-usage-month-chart__tooltip-row">
              <span>Production</span><span>{{ kwh(item.productionKwh) }}</span>
            </div>
            <div class="pp-usage-month-chart__tooltip-row pp-usage-month-chart__tooltip-row--net">
              <span>Net usage</span><span>{{ kwh(item.netUsageKwh) }}</span>
            </div>
          </div>
        }
      </div>

      <figcaption class="pp-usage-month-chart__caption">{{ caption() }}</figcaption>
    </figure>
  `,
  host: { '[class]': 'hostClass()' },
})
export class PpUsageMonthChart {
  readonly month = input.required<PpUsageMonth>();
  readonly height = input(280);
  readonly hoveredDate = model<string | null>(null);
  /** yyyy-MM-dd — [F03-R09]'s drill-in. A DATE, never an index: a month may not start on day 1. */
  readonly daySelected = output<string>();

  protected readonly padLeft = PAD_LEFT;
  protected readonly padTop = PAD_TOP;

  private readonly instance = ++instanceSeq;
  protected readonly hatchId = computed(() => `pp-usage-month-chart-${this.instance}-hatch`);

  protected readonly hostClass = computed(
    () =>
      `pp-usage-month-chart pp-usage-month-chart--${this.month().dataState.toLowerCase().replace('_', '-')}`,
  );

  protected readonly viewBox = computed(() => `0 0 ${VIEW_WIDTH} ${this.height()}`);
  protected readonly plotWidth = computed(() => VIEW_WIDTH - PAD_LEFT - PAD_RIGHT);
  protected readonly plotHeight = computed(() => this.height() - PAD_TOP - PAD_BOTTOM);

  private readonly scale = computed(() =>
    scaleFor(
      this.month().days.map((d) => d.netUsageKwh),
      PAD_TOP,
      this.plotHeight(),
    ),
  );

  protected readonly zeroY = computed(() => round(this.scale().zeroY));

  private readonly measuredCount = computed(
    () => this.month().days.filter((d) => d.netUsageKwh !== null).length,
  );

  protected readonly caption = computed(() => {
    const total = this.month().dayCount;
    const measured = this.measuredCount();
    const missing = total - measured;
    const head = `${measured} of ${total} days measured`;
    if (missing === 0) return head;
    return `${head} · ${missing} ${missing === 1 ? 'day' : 'days'} awaiting data`;
  });

  protected readonly ariaLabel = computed(
    () => `Daily net usage for ${this.month().month}, ${this.month().dayCount} days.`,
  );

  protected readonly columns = computed<readonly PpMonthColumn[]>(() => {
    // ⚠ dayCount drives the layout, exactly as intervalCount does on the day chart. The two are
    // equal by contract, and laying out on days.length would let a short payload silently redraw
    // the month at the wrong width rather than showing the gap.
    const slot = slotWidthFor(this.plotWidth(), this.month().dayCount);
    const barWidth = barWidthFor(slot);
    const scale = this.scale();
    const zeroY = scale.zeroY;

    return this.month().days.map((day, index) => {
      const hitX = slotStartX(index + 1, PAD_LEFT, slot);
      const barX = hitX + (slot - barWidth) / 2;
      const value = day.netUsageKwh;

      const bar =
        value !== null && value !== 0
          ? {
              y: round(Math.min(zeroY, scale.y(value))),
              height: round(Math.abs(scale.y(value) - zeroY)),
              negative: value < 0,
            }
          : null;

      return {
        date: day.date,
        label: String(dayNumber(day.date)),
        ariaLabel: ariaLabelFor(day),
        state: day.dataState,
        partial: day.dataState === 'PARTIAL',
        hitX: round(hitX),
        hitWidth: round(slot),
        barX: round(barX),
        barWidth: round(barWidth),
        bar,
        // A missing day is a marked stub sitting ON the zero line [F03-R10]; a measured zero is a
        // solid tick. Neither is "no bar", which is what makes the two tellable apart.
        stub: value === null ? { y: round(zeroY - STUB_HEIGHT), height: STUB_HEIGHT } : null,
        measuredZeroY: value === 0 ? round(zeroY) : null,
      };
    });
  });

  protected readonly hovered = computed(() => {
    const date = this.hoveredDate();
    return date === null ? null : (this.month().days.find((d) => d.date === date) ?? null);
  });

  protected readonly tooltipLeft = computed(() => {
    const date = this.hoveredDate();
    if (date === null) return 0;
    const column = this.columns().find((c) => c.date === date);
    if (column === undefined) return 0;
    return Math.min(Math.max(((column.hitX + column.hitWidth / 2) / VIEW_WIDTH) * 100, 8), 92);
  });

  protected dateLabel(date: string): string {
    return formatDutchDate(date);
  }

  protected kwh(value: number | null): string {
    return formatKwh(value);
  }

  protected onActivate(event: Event, date: string): void {
    // Space scrolls the page by default, and an SVG <g role="button"> gets none of a real
    // button's behaviour for free.
    event.preventDefault();
    this.daySelected.emit(date);
  }
}

function ariaLabelFor(day: PpUsageMonthDay): string {
  const date = formatDutchDate(day.date);
  if (day.netUsageKwh === null) return `${date}, no data`;
  return `${date}, net usage ${formatKwh(day.netUsageKwh)}, ${day.dataState.toLowerCase().replace('_', ' ')}`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
```

- [ ] **Step 4: Write the stylesheet**

Create `libs/shared-ui/src/lib/usage-chart/pp-usage-month-chart.css`:

```css
:host { display: block; font-family: var(--font-sans); }

.pp-usage-month-chart__figure { margin: 0; }
.pp-usage-month-chart__plot { position: relative; }
.pp-usage-month-chart__svg { display: block; width: 100%; height: auto; }

.pp-usage-month-chart__zero { stroke: var(--pp-border-strong); stroke-width: 1; }

/* The whole column is the target, so a 3px bar is not what a customer has to hit. */
.pp-usage-month-chart__hit { fill: transparent; }
.pp-usage-month-chart__day { cursor: pointer; }
.pp-usage-month-chart__day:focus-visible {
  outline: 2px solid var(--pp-blue-300);
  outline-offset: 1px;
}
.pp-usage-month-chart__day:hover .pp-usage-month-chart__hit { fill: var(--pp-surface-alt); }

/* A day that took more than it produced. --pp-chart-usage is the [DEC-22] net-usage colour. */
.pp-usage-month-chart__bar { fill: var(--pp-chart-usage); }
/* A day that produced more than it took. --pp-chart-long-fill is a FILL token and this is a fill,
   which is the one legal use of it — it is 1.9:1 on white and illegal as a stroke or as type. */
.pp-usage-month-chart__bar--negative { fill: var(--pp-chart-long-fill); }

/* [F03-R10]: a missing day is a MARKED stub, not a short bar and not an empty column. Dashed and
   unfilled, so it is still the odd one out with the colour removed. */
.pp-usage-month-chart__stub {
  fill: none;
  stroke: var(--pp-border-strong);
  stroke-width: 1;
  stroke-dasharray: 3,2;
}

/* A day that genuinely used nothing. Solid, on the line, and unmistakably not the stub. */
.pp-usage-month-chart__measured-zero { fill: var(--pp-text-faint); }

.pp-usage-month-chart__hatch-line { stroke: var(--pp-amber); stroke-width: 1; opacity: 0.35; }
.pp-usage-month-chart__partial { stroke: none; }

.pp-usage-month-chart__day-label {
  font-size: 9px;
  fill: var(--pp-text-faint);
  text-anchor: middle;
}

.pp-usage-month-chart__caption {
  margin: 6px 0 0;
  font-size: var(--text-xs);
  color: var(--pp-text-faint);
}

.pp-usage-month-chart__tooltip {
  position: absolute;
  top: 8px;
  transform: translateX(-50%);
  pointer-events: none;
  min-width: 168px;
  padding: 8px 10px;
  border: 1px solid var(--pp-border-strong);
  border-radius: var(--radius-md);
  background: var(--pp-surface);
  box-shadow: var(--pp-shadow-card);
  font-size: 11.5px;
  color: var(--pp-text-body);
}
.pp-usage-month-chart__tooltip-head {
  margin-bottom: 6px;
  font-weight: var(--weight-semibold);
  color: var(--pp-text-heading);
}
.pp-usage-month-chart__tooltip-row {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  line-height: 1.6;
}
.pp-usage-month-chart__tooltip-row--net {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--pp-border);
  font-weight: var(--weight-semibold);
  color: var(--pp-text-heading);
}
```

- [ ] **Step 5: Run it and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: PASS.

- [ ] **Step 6: Mutation check — the stub becomes a short bar**

This is `[F03-R10]` itself. In `pp-usage-month-chart.ts`, coalesce the missing value:

```ts
      const value = day.netUsageKwh ?? 0;
```

…and delete the `stub:` line, replacing it with `stub: null,` (so the template still compiles).

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: **FAIL** — `marks a missing day as a STUB, not as a short bar` reports
`expected null not to be null`, and `tells a MEASURED ZERO from a missing day` reports the same for
the second day's stub. Predicted before running: `counts the measured days in the caption` stays
**green**, because the caption reads `netUsageKwh` off the input rather than off the column — so
the chart would be *saying* two days are missing while drawing them as measured zeros. That
inconsistency is the shape of the bug, and it is why the stub is asserted on the DOM rather than on
a count. **Restore immediately.**

- [ ] **Step 7: Mutation check — the drill-in loses its date**

In `pp-usage-month-chart.ts`, emit the index instead of the date:

```ts
              (click)="daySelected.emit(column.label)"
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: **FAIL** — `drills into a day on a click, naming the DATE and not an index` reports
`expected [ '17' ] to deeply equal [ '2026-08-17' ]`. **Restore immediately.**

- [ ] **Step 8: Mutation check — the negative day is clipped**

In `pp-usage-month-chart.ts`, clamp the bar at zero the way a naive bar chart does:

```ts
        value !== null && value > 0
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: **FAIL** — `draws a NEGATIVE day below the zero line` reports
`TypeError: Cannot read properties of null (reading 'getAttribute')`, because the negative day now
has no bar at all. Predicted before running: an export day silently becomes an empty column,
indistinguishable from a measured zero — the second time in this component that "draw nothing"
would have been the plausible-looking wrong answer. **Restore immediately.**

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/usage-chart/pp-usage-month-chart.ts \
        libs/shared-ui/src/lib/usage-chart/pp-usage-month-chart.css \
        libs/shared-ui/src/lib/usage-chart/pp-usage-month-chart.spec.ts
git commit -m "feat(shared-ui): PpUsageMonthChart, with a stub where a day is missing

[F03-R10]: a missing day is a dashed, unfilled stub on the zero line; a measured zero is
a solid tick; a negative day is a bar below the line [DEC-22][DEC-23]. Every day is an
SVG g role=button with tabindex and an aria-label, so [F03-R09]'s drill-in is reachable
by keyboard and emits the DATE rather than an index.

Verified by mutation three ways. Coalescing netUsageKwh to 0 turns both stubs into
measured zeros while the caption still says two days are missing. Emitting the day label
instead of the date breaks the drill-in the moment a month does not start on the first.
Clamping the bar at zero makes an export day an empty column."
```

---

### Task 5: The public API surface, and the library build that is the only thing checking it

`peakpower-web/CLAUDE.md`: *"Run `npx ng build shared-ui` after any change to `public-api.ts`. A
duplicate or malformed export compiles and leaves the whole suite green; only the library build
catches it. This has happened."*

**Files:**
- Create: `libs/shared-ui/src/lib/usage-chart/public.ts`
- Modify: `libs/shared-ui/src/public-api.ts:30` (append after the existing `PpTone` export)

**Interfaces:**
- Consumes: `PpUsageChart` (task 3), `PpUsageMonthChart` (task 4), the five types (task 2).
- Produces: the shared contract §11.1 export block, verbatim — the only thing the two portals may
  import. **Nothing from `chart-geometry.ts` is exported**, so the replacement S2-D5 keeps cheap
  stays two files plus their specs.

- [ ] **Step 1: Write the failing test**

Append to `libs/shared-ui/src/styles/tokens.spec.ts`? **No.** That file is the byte-for-byte token
port and must not grow. Create the assertion where it belongs, in the chart folder's own spec.

Append to `libs/shared-ui/src/lib/usage-chart/pp-usage-chart.spec.ts`:

```ts
describe("the library's public surface", () => {
  it('exports the two components and the five types, and no geometry', async () => {
    // S2-D5's whole economy: no consumer knows how these draw, so replacing them with a library
    // is two files plus their specs. An exported `scaleFor` or `slotCentreX` would make the
    // geometry a consumer's business and the replacement a breaking change.
    const api = await import('../../public-api');
    const names = Object.keys(api);

    expect(names).toContain('PpUsageChart');
    expect(names).toContain('PpUsageMonthChart');
    for (const leaked of ['scaleFor', 'lineRuns', 'hourTicks', 'slotCentreX', 'formatKwh']) {
      expect(names, `${leaked} must stay inside the library`).not.toContain(leaked);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: FAIL — `expected [ 'PpAppShell', 'PpAuthShell', … ] to include 'PpUsageChart'`.

- [ ] **Step 3: Write the barrel**

Create `libs/shared-ui/src/lib/usage-chart/public.ts`:

```ts
/**
 * The usage charts' entire export surface — shared contract §11.1 names this exact path.
 *
 * ⚠ `chart-geometry.ts` is deliberately absent. S2-D5 defers the charting-library choice [OQ-22]
 * and what makes that cheap is that the two components are a black box: data in, SVG out,
 * semantic events out, and no consumer knowledge of the axis, the scale or the formatting.
 * Exporting a geometry helper would make it somebody's dependency and the swap a breaking change.
 */
export { PpUsageChart } from './pp-usage-chart';
export { PpUsageMonthChart } from './pp-usage-month-chart';
export type {
  PpUsageDataState,
  PpUsageInterval,
  PpUsageDay,
  PpUsageMonthDay,
  PpUsageMonth,
} from './usage-chart.types';
```

- [ ] **Step 4: Append to the library's public API**

Append to `libs/shared-ui/src/public-api.ts`, after the existing final line
`export type { PpTone } from './lib/tone';` — **verbatim from shared contract §11.1**:

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

- [ ] **Step 5: Run the test and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui
```

Expected: PASS.

- [ ] **Step 6: Build the library — the step the suite cannot replace**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng build shared-ui
```

Expected: a successful `ng-packagr` build reporting `dist/shared-ui`.

⚠ If this fails and the suite passed, the message is the point: a duplicated export name or a type
exported as a value produces an ng-packagr error that no Vitest run would ever have shown.

- [ ] **Step 7: Mutation check — the build catches what the suite cannot**

Duplicate one export in `libs/shared-ui/src/public-api.ts` by appending:

```ts
export { PpUsageChart } from './lib/usage-chart/public';
```

Run **both**:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:shared-ui && npx ng build shared-ui
```

Expected: `npm run test:shared-ui` **PASSES** (this is the whole point — Vitest resolves the
module graph and the duplicate is harmless there), and `npx ng build shared-ui` **FAILS** with
`Duplicate identifier 'PpUsageChart'`. **Delete the appended line immediately** and re-run both.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/usage-chart/public.ts \
        libs/shared-ui/src/public-api.ts \
        libs/shared-ui/src/lib/usage-chart/pp-usage-chart.spec.ts
git commit -m "feat(shared-ui): export PpUsageChart and PpUsageMonthChart

Shared contract 11.1's export block, verbatim. The geometry stays inside the library on
purpose: S2-D5 keeps the two charts replaceable only for as long as no consumer knows
how they draw.

Verified by mutation: a duplicated export in public-api.ts leaves the whole Vitest suite
green and fails ng build shared-ui with 'Duplicate identifier'. That is the failure mode
CLAUDE.md records, and the library build is the only thing that sees it."
```

---

### Task 6: Regenerate the typed clients and add the consumption calls

**This task is the first that needs plan 6 landed and the platform built.** Everything before it ran
from fixture JSON with no backend, which is design §5's "step 11a runs beside steps 9 and 10".

`[DEC-116]`: there is no npm registry, so the TypeScript derived from the platform's OpenAPI
documents is **committed** into this repository and `tools/verify-clients.test.mjs` — which runs
inside `npm run test:workspace`, and therefore inside `npm test` — regenerates both clients in
memory and diffs them byte-for-byte. A stale committed schema is a red build, not a surprise in a
browser.

⚠ **`libs/api-client-customer/src/lib/customer-api.types.ts` is the ONLY file in the workspace that
knows how `openapi-typescript` names things.** Everything below aliases through it.

⚠ **The six schema names below are this plan's best reading of plan 6's records, and they are the
one thing here that plan 6 could spell differently.** Plan 6 owns the C# records; `openapi-typescript`
names each schema after its record. If a name does not resolve, **fix this one file** — the alias
line — and nothing else changes, which is exactly why the aliases exist:

| Alias | Expected schema | Shared contract |
| --- | --- | --- |
| `ConsumptionDay` | `ConsumptionDayResponse` | §10.1 |
| `ConsumptionInterval` | `ConsumptionIntervalDto` | §10.1 |
| `ProductionDeclaration` | `ProductionDeclarationDto` | §10.1 |
| `ConsumptionSummary` | `ConsumptionSummaryDto` | §10.1 |
| `ConsumptionMonth` | `ConsumptionMonthResponse` | §10.2 |
| `ConsumptionMonthDayTotals` | `ConsumptionMonthDayDto` | §10.2 |
| `DayState` | `DayStateDto` | §10.3 |

**Files:**
- Modify: `libs/api-client-customer/src/generated/customer-schema.d.ts` (regenerated wholesale)
- Modify: `libs/api-client-customer/src/lib/customer-api.types.ts:45` (append after `SignCodePeek`)
- Modify: `libs/api-client-customer/src/lib/customer-api.client.ts:60` (URL builders) and `:176`
  (the two GETs, after `searchEanPool`)
- Test: `libs/api-client-customer/src/lib/customer-api.client.spec.ts` (append)

**Interfaces:**
- Consumes: the platform's `artifacts/openapi/customer.json`, produced by plan 6.
- Produces:
  - `export type ConsumptionDay`, `ConsumptionInterval`, `ConsumptionMonth`,
    `ConsumptionMonthDayTotals`, `ConsumptionSummary`, `ProductionDeclaration`, `DayState`
  - `consumptionDayUrl(): string` → `${baseUrl}/consumption/day`
  - `consumptionMonthUrl(): string` → `${baseUrl}/consumption/month`
  - `getConsumptionDay(date: string, meteringPointIds: readonly string[]): Observable<ConsumptionDay>`
  - `getConsumptionMonth(month: string, meteringPointIds: readonly string[]): Observable<ConsumptionMonth>`

- [ ] **Step 1: Regenerate, and watch the drift guard have something to say**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet build PeakPower.sln --nologo
cd /Users/thinhhuynh/PeakPower/peakpower-web && \
  PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform npm run verify:clients
```

Expected: **FAIL** —
`@peakpower-nl/api-client-customer is stale.` … `first difference at line <n>` …
`Run 'npm run generate:clients', review the diff, and commit it.`

That failure is the evidence the guard works before you use it. If it says `up to date`, plan 6's
endpoints are not in the OpenAPI document yet and this task cannot start.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && \
  PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform npm run generate:clients
```

Expected: `@peakpower-nl/api-client-employee: wrote libs/api-client-employee/src/generated/employee-schema.d.ts (<n> lines)`
and the same for the customer client.

**Read the diff.** In particular confirm, before writing a line of TypeScript:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && \
  grep -n 'ConsumptionDayResponse\|ConsumptionIntervalDto\|ConsumptionMonthResponse\|ConsumptionMonthDayDto\|DayStateDto' \
  libs/api-client-customer/src/generated/customer-schema.d.ts > /tmp/pp-schema-names.txt; \
  cat /tmp/pp-schema-names.txt
```

⚠ **`ConsumptionMonthDayDto` is in that grep on purpose.** Plan 6 declares the month's per-day
record as `ConsumptionMonthDayDto` (`2026-09-07-slice-2-plan-6-read-surfaces.md:765`), not as
`ConsumptionDayTotalsDto`; the alias table above has been corrected to match. A `Schemas['…']`
lookup on a name the document does not carry is a **compile** error in
`customer-api.types.ts`, so this is the cheapest place to catch it.

If a name differs, use the real one in step 3 and record the difference in the commit message.

- [ ] **Step 2: Write the failing test**

Append to `libs/api-client-customer/src/lib/customer-api.client.spec.ts`, inside the existing
`describe('CustomerApiClient', …)` block:

```ts
  it('builds the two consumption URLs under the injected base path', () => {
    expect(api.consumptionDayUrl()).toBe('/api/v1/consumption/day');
    expect(api.consumptionMonthUrl()).toBe('/api/v1/consumption/month');
  });

  it('sends the date and one meteringPointIds parameter PER metering point', () => {
    // Shared contract §10.1: `meteringPointIds` is a REPEATED Guid, not a comma-joined string.
    // A joined string binds to a single-element array server-side and the aggregate silently
    // collapses to one connection — a wrong number, not an error.
    api.getConsumptionDay('2026-08-12', ['mp-1', 'mp-2']).subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/consumption/day');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('date')).toBe('2026-08-12');
    expect(req.request.params.getAll('meteringPointIds')).toEqual(['mp-1', 'mp-2']);
    req.flush({});
  });

  it('sends the month and the same repeated parameter for the month view', () => {
    api.getConsumptionMonth('2026-08', ['mp-1']).subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/consumption/month');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('month')).toBe('2026-08');
    expect(req.request.params.getAll('meteringPointIds')).toEqual(['mp-1']);
    req.flush({});
  });

  it('sends no meteringPointIds at all rather than an empty one when nothing is selected', () => {
    // `?meteringPointIds=` binds as one empty Guid and answers 400. The screen must not be able
    // to ask this question; the client refusing to spell it is the cheapest place to stop it.
    api.getConsumptionDay('2026-08-12', []).subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/consumption/day');
    expect(req.request.params.has('meteringPointIds')).toBe(false);
    req.flush({});
  });
```

- [ ] **Step 3: Run it and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: FAIL — `TypeError: api.consumptionDayUrl is not a function`.

(`libs/api-client-customer/src/**/*.spec.ts` runs inside the customer-portal target — see
`angular.json:61-64`.)

- [ ] **Step 4: Add the type aliases**

Append to `libs/api-client-customer/src/lib/customer-api.types.ts`, after the `SignCodePeek` alias:

```ts
// ── Consumption — shared contract §10.1 and §10.2, FROZEN ────────────────────
//
// Two rules that survive the mapping into the chart's own shapes, and that nothing downstream may
// undo:
//
//   A missing INTERVAL is an absent entry — never 0, never null, never a placeholder object —
//   so `intervals.length` may be less than `intervalCount` and the chart draws the difference as
//   a gap [F02-R25], [F03-R06].
//
//   A missing DAY is present with null volumes, which is deliberately the OPPOSITE rule, because
//   [F03-R10] needs a stub to mark and a chart cannot mark a day the payload does not mention.
//
// ⚠ There is no `blocks`, `blockKwh`, `netPositionKwh`, `isPeak`, `dayAheadPriceEurMwh`,
// `coverageRatio` or `surplusKwh` key anywhere in either envelope. The published API-contract
// example is pre-[DEC-22]; implementing it verbatim would ship the wrong product.
export type ConsumptionDay = Schemas['ConsumptionDayResponse'];
export type ConsumptionInterval = Schemas['ConsumptionIntervalDto'];
export type ConsumptionMonth = Schemas['ConsumptionMonthResponse'];
export type ConsumptionMonthDayTotals = Schemas['ConsumptionMonthDayDto'];
export type ConsumptionSummary = Schemas['ConsumptionSummaryDto'];
export type ProductionDeclaration = Schemas['ProductionDeclarationDto'];

/** One (date, state) pair. 14 of them on connection detail; 21 on the employee heat map. */
export type DayState = Schemas['DayStateDto'];
```

- [ ] **Step 5: Add the URL builders and the two calls**

In `libs/api-client-customer/src/lib/customer-api.client.ts`, add to the imported type list
(alphabetical, so between `CompanyProfile` and `ConnectionDetail`):

```ts
  ConsumptionDay,
  ConsumptionMonth,
```

Add the two URL builders after `eanPoolUrl()` (which ends at `:60`):

```ts
  consumptionDayUrl(): string {
    return `${this.baseUrl}/consumption/day`;
  }
  consumptionMonthUrl(): string {
    return `${this.baseUrl}/consumption/month`;
  }
```

Add the two calls after `searchEanPool` (which ends at `:176`):

```ts
  // ── Consumption ─────────────────────────────────────────────────────────
  //
  // `meteringPointIds` is REPEATED, one parameter per point — `?meteringPointIds=a&meteringPointIds=b`
  // — because that is what a `Guid[]` query binder reads. A comma-joined string binds to a
  // single-element array and the aggregate silently becomes one connection's numbers under a
  // heading that says several: a wrong figure, not an error, and the customer is invoiced on the
  // basis this screen is showing them.
  //
  // An EMPTY selection sends no parameter at all rather than `?meteringPointIds=`, which binds as
  // one empty Guid and answers 400. The screen should never ask; refusing to spell it here is the
  // cheapest place to make sure it cannot.

  getConsumptionDay(
    date: string,
    meteringPointIds: readonly string[],
  ): Observable<ConsumptionDay> {
    return this.http.get<ConsumptionDay>(this.consumptionDayUrl(), {
      params: rangeParams('date', date, meteringPointIds),
    });
  }

  getConsumptionMonth(
    month: string,
    meteringPointIds: readonly string[],
  ): Observable<ConsumptionMonth> {
    return this.http.get<ConsumptionMonth>(this.consumptionMonthUrl(), {
      params: rangeParams('month', month, meteringPointIds),
    });
  }
```

Add the parameter builder beside `searchParams` at the bottom of the file:

```ts
/**
 * `?date=2026-08-12&meteringPointIds=a&meteringPointIds=b`.
 *
 * `HttpParams` is immutable — `append` RETURNS a new instance and mutates nothing — so the
 * reduction below must reassign. `params.append(...)` written as a statement compiles, runs, and
 * sends no metering points at all.
 */
function rangeParams(
  rangeKey: 'date' | 'month',
  rangeValue: string,
  meteringPointIds: readonly string[],
): HttpParams {
  let params = new HttpParams().set(rangeKey, rangeValue);
  for (const id of meteringPointIds) {
    params = params.append('meteringPointIds', id);
  }
  return params;
}
```

- [ ] **Step 6: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: PASS.

- [ ] **Step 7: Mutation check — the repeated parameter**

In `customer-api.client.ts`, join the ids the way a reader expects a list to be sent:

```ts
  let params = new HttpParams().set(rangeKey, rangeValue);
  if (meteringPointIds.length > 0) {
    params = params.set('meteringPointIds', meteringPointIds.join(','));
  }
  return params;
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `sends the date and one meteringPointIds parameter PER metering point` reports
`expected [ 'mp-1,mp-2' ] to deeply equal [ 'mp-1', 'mp-2' ]`. Predicted before running: the
single-point test and the empty test both stay **green**, because a one-element join is
indistinguishable from a single parameter — which is exactly why the two-point fixture exists.
**Restore immediately.**

- [ ] **Step 8: Mutation check — the immutable HttpParams**

In `rangeParams`, drop the reassignment:

```ts
  for (const id of meteringPointIds) {
    params.append('meteringPointIds', id);
  }
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `expected [] to deeply equal [ 'mp-1', 'mp-2' ]`. This compiles, runs, throws
nothing and sends a request with no metering points at all. **Restore immediately.**

- [ ] **Step 9: Prove the drift guard is satisfied and commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && \
  PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform npm run verify:clients
```

Expected: `@peakpower-nl/api-client-employee: up to date` and
`@peakpower-nl/api-client-customer: up to date`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/api-client-customer
git commit -m "feat(api-client-customer): the two consumption calls

Regenerated from the platform's OpenAPI document and committed [DEC-116], plus aliases
for the frozen day and month envelopes and the two GETs behind them.

meteringPointIds is sent REPEATED, one parameter per point. Verified by mutation:
joining them with a comma leaves the single-point and empty-selection tests green and
collapses a multi-point aggregate to one connection's numbers — a wrong figure under a
heading that says several. Dropping the HttpParams reassignment sends none at all and
throws nothing."
```

---

### Task 7: The `/consumption` route, the rail row, and the three pinned assertions

Shared contract §11.6: enabling the row is **three one-line edits plus one five-line guarded lazy
route**, and §11.7: **three pinned assertions break in lockstep and must move in the same commit.**

⚠ **`ENABLED_ROUTE_KEYS` is read only by its own spec. `PATH` is what actually puts the row on
screen** — `item()` at `customer-nav.ts:80-92` derives `path` from `PATH` and nothing else, and it
is `path === null` that decides whether the row renders as a link or as a disabled span. Editing
only `ENABLED_ROUTE_KEYS` turns the spec green and leaves the rail exactly as it was.

⚠ **`DISABLED_REASON.consumption` must go too**, and not merely be ignored. `item()` reads
`DISABLED_REASON[routeKey]` and spreads `{ disabledReason: reason! }` only when `path` is null, so a
leftover entry is dead rather than wrong — but the *spec* at `:89-101` asserts that every item
**not** in `ENABLED_ROUTE_KEYS` carries a reason, and leaving a stale reason on an enabled row is
precisely the kind of thing that reads as intentional to the next person.

**The order of the four edits does not matter, but they are one commit.** Two of the three pinned
assertions live in `customer-nav.spec.ts` and one in `app.routes.spec.ts`; a commit carrying the
feature without them is a red suite, and a commit carrying them without the feature is a red suite
the other way round.

⚠ **A route added to `app.routes.ts` without a case in `app.routes.spec.ts` fails loudly**, by
design: `:127-143` asserts the declared path set equals `GUARDED ∪ UNGUARDED ∪ UNGUARDED_PARAMETERISED ∪ {'', '**'}`
and asserts the length too. That is the guard that makes adding `/consumption` to `GUARDED` the
only way through.

⚠ **`app.routes.spec.ts` never renders a component.** It calls `provideRouter(routes)` and drives
the real router, but there is no `<router-outlet>` anywhere in that TestBed — so `loadComponent`
resolves the module and never instantiates it, and `afterEach(() => http.verify())` at `:125` stays
satisfied even though `ConsumptionPage` fetches on mount. This is why `/connections` already passes
there. **Do not add a fixture to that spec.**

**Files:**
- Modify: `apps/customer-portal/src/app/shell/customer-nav.ts:42` (`ENABLED_ROUTE_KEYS`),
  `:65-71` (`DISABLED_REASON`), `:74-78` (`PATH`)
- Modify: `apps/customer-portal/src/app/shell/customer-nav.spec.ts:79`, `:92`
- Modify: `apps/customer-portal/src/app/app.routes.ts:84` (insert after the `company` route)
- Modify: `apps/customer-portal/src/app/app.routes.spec.ts:34`
- Create: `apps/customer-portal/src/app/features/consumption/consumption-page.ts` — a **placeholder**
  in this task, replaced wholesale by task 10

**Interfaces:**
- Consumes: `authenticatedGuard` from `apps/customer-portal/src/app/auth/authenticated.guard.ts`.
- Produces:
  - `PATH.consumption === '/consumption'`, so `CUSTOMER_NAV`'s Volume row renders as a link.
  - `export class ConsumptionPage` — selector `pp-consumption-page`, lazily loaded at
    `/consumption`. Tasks 8–11 fill it in.

- [ ] **Step 1: Write the failing test**

Edit `apps/customer-portal/src/app/shell/customer-nav.spec.ts:78-80` to read:

```ts
  it('enables dashboard, connections, consumption and company', () => {
    expect([...ENABLED_ROUTE_KEYS].sort()).toEqual([
      'company',
      'connections',
      'consumption',
      'dashboard',
    ]);
  });
```

Edit `apps/customer-portal/src/app/shell/customer-nav.spec.ts:92`:

```ts
    expect(disabled.length).toBe(4);
```

Add, immediately after the `gives every disabled item a null path and a sentence naming the reason`
test (which ends at `:101`):

```ts
  it('gives the Volume row a PATH, which is what actually puts it on screen', () => {
    // ENABLED_ROUTE_KEYS is read only by this file. `item()` derives `path` from PATH and from
    // nothing else, and `path === null` is what renders a row disabled — so editing the set above
    // alone turns this spec green and leaves the rail unchanged.
    const volume = items.find((i) => i.routeKey === 'consumption')!;

    expect(volume.label).toBe('Volume');
    expect(volume.path).toBe('/consumption');
    expect(volume.disabledReason).toBeUndefined();
  });

  it('no longer says consumption charts are yet to arrive', () => {
    const reasons = items.map((i) => i.disabledReason ?? '');

    expect(reasons).not.toContain('Consumption charts arrive with metering-data ingestion.');
  });
```

Edit `apps/customer-portal/src/app/app.routes.spec.ts:34`:

```ts
const GUARDED = ['/consumption', '/dashboard', '/connections', '/company'] as const;
```

- [ ] **Step 2: Run them and watch them fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: FAIL, four ways —

- `enables dashboard, connections, consumption and company`:
  `expected [ 'company', 'connections', 'dashboard' ] to deeply equal [ 'company', 'connections', 'consumption', 'dashboard' ]`
- `gives every disabled item a null path and a sentence naming the reason`: `expected 5 to be 4`
- `gives the Volume row a PATH, which is what actually puts it on screen`:
  `expected null to be '/consumption'`
- `covers every entry in the table, so a route added without a case here cannot pass vacuously`:
  the declared set is missing `consumption`

- [ ] **Step 3: Make the three one-line edits to the rail**

`apps/customer-portal/src/app/shell/customer-nav.ts:42` becomes:

```ts
/** What slice 2 ships. Everything else renders disabled with its reason. */
export const ENABLED_ROUTE_KEYS: readonly CustomerRouteKey[] = [
  'dashboard',
  'connections',
  'consumption',
  'company',
];
```

Delete the `consumption:` entry from `DISABLED_REASON` (`:66`), leaving:

```ts
const DISABLED_REASON: Readonly<Partial<Record<CustomerRouteKey, string>>> = Object.freeze({
  prices: 'Price indications arrive once the day-ahead price feed is connected.',
  trading: 'Trading opens once price indications are live.',
  wallet: 'The balance follows the wallet ledger.',
  settlements: 'Settlements follow invoicing.',
});
```

Add `consumption` to `PATH` (`:74-78`), keeping the rail's own order:

```ts
/** Where an enabled row goes. Route keys and paths agree by construction. */
const PATH: Readonly<Partial<Record<CustomerRouteKey, string>>> = Object.freeze({
  dashboard: '/dashboard',
  connections: '/connections',
  consumption: '/consumption',
  company: '/company',
});
```

- [ ] **Step 4: Add the placeholder screen**

Create `apps/customer-portal/src/app/features/consumption/consumption-page.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PpCard } from '@peakpower-nl/shared-ui';

/**
 * The `/consumption` screen — [F03]. A placeholder in this commit and replaced wholesale by the
 * task that wires the charts: the route, the rail row and the three pinned assertions move
 * together or the suite goes red, so the route lands first with something real behind it.
 */
@Component({
  selector: 'pp-consumption-page',
  imports: [PpCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-card [headingLevel]="1" heading="Volume" subtitle="Your consumption, production and net usage">
      <p class="lede">Loading the day view.</p>
    </pp-card>
  `,
  styles: `
    .lede { margin: 0; font-size: 12px; line-height: 1.5; color: var(--pp-text-body); }
  `,
})
export class ConsumptionPage {}
```

- [ ] **Step 5: Add the five-line guarded route**

In `apps/customer-portal/src/app/app.routes.ts`, insert immediately after the `company` route
(which closes at `:84`) and before the `gallery` route:

```ts
  {
    path: 'consumption',
    canActivate: [authenticatedGuard],
    loadComponent: () => import('./features/consumption/consumption-page').then((m) => m.ConsumptionPage),
  },
```

⚠ **`loadComponent`, not `loadChildren`.** The day view and the month view are one screen with two
tabs, and the state that distinguishes them — the date, the month, the selection — belongs in the
query string so a link is shareable and a month-bar drill-in is a real navigation. A child route
table would spell the same thing in two places.

- [ ] **Step 6: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: PASS — including `refuses /consumption to a visitor with no session and lands them on
/sign-in` and `admits /consumption once there is a session, without spending a refresh`, both
generated by `app.routes.spec.ts`'s loop over `GUARDED`.

- [ ] **Step 7: Mutation check — the edit that looks like it works**

This is shared contract §11.6's warning made executable. In `customer-nav.ts`, **revert only the
`PATH` edit**, leaving `ENABLED_ROUTE_KEYS` and `DISABLED_REASON` as they now are:

```ts
const PATH: Readonly<Partial<Record<CustomerRouteKey, string>>> = Object.freeze({
  dashboard: '/dashboard',
  connections: '/connections',
  company: '/company',
});
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `gives the Volume row a PATH, which is what actually puts it on screen`
reports `expected null to be '/consumption'`, and `gives every enabled item a path and no disabled
reason` reports `expected null to be truthy`.

Predicted before running: `enables dashboard, connections, consumption and company` stays **green**.
That is the point of the mutation — without the new PATH assertion, this state is a green suite and
a rail that has not changed. **Restore immediately.**

- [ ] **Step 8: Mutation check — the guard on the new route**

In `app.routes.ts`, delete `canActivate: [authenticatedGuard],` from the `consumption` route.

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `refuses /consumption to a visitor with no session and lands them on /sign-in`
reports `Error: the guard never asked for a refresh — is canActivate wired on this route?`, which is
`awaitRefresh()`'s own message at `app.routes.spec.ts:107`. **Restore immediately.**

⚠ This is not a cosmetic guard. Design §8 records that `GET /company/accounts` once answered
anonymous callers **200 with every company's people** (commit `0a49a8d`), because the customer API
connects as the database owner and drops privilege only inside `CustomerSessionMiddleware`, which
anonymous requests skip. The route guard is the browser half of the pair.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/shell/customer-nav.ts \
        apps/customer-portal/src/app/shell/customer-nav.spec.ts \
        apps/customer-portal/src/app/app.routes.ts \
        apps/customer-portal/src/app/app.routes.spec.ts \
        apps/customer-portal/src/app/features/consumption/consumption-page.ts
git commit -m "feat(customer-portal): enable the Volume rail row and the /consumption route

Three one-line edits to customer-nav.ts and one five-line guarded lazy route, with the
three pinned assertions moved in the same commit: customer-nav.spec.ts:79 and :92, and
app.routes.spec.ts:34.

A fourth assertion is new, and it is the one that matters. ENABLED_ROUTE_KEYS is read
only by its own spec; PATH is what puts the row on screen. Verified by mutation:
reverting the PATH edit alone leaves the enabled-set assertion green and the rail
unchanged, and only the new PATH assertion goes red."
```

---

### Task 8: The envelope mapper and every sentence the screen prints

Two pure files, both with specs of their own, and neither importing Angular. They exist separately
from the screen for the same reason `chart-geometry.ts` exists separately from the chart: the two
rules that matter most here — *a missing interval stays missing* and *a declared zero is not an
absence* — are one-line mistakes inside a template and are assertable in isolation outside one.

⚠ **The mapper is the last place a `?? 0` can erase the slice.** The envelope carries `null` for a
missing volume and `0.0` for a measured zero; the chart takes `number | null` and never coalesces.
The mapper sits between the two, and it is exactly where a well-meaning "the chart wants a number"
would go in.

**Files:**
- Create: `apps/customer-portal/src/app/features/consumption/consumption-envelope.ts`
- Create: `apps/customer-portal/src/app/features/consumption/consumption-copy.ts`
- Test: `apps/customer-portal/src/app/features/consumption/consumption-envelope.spec.ts`
- Test: `apps/customer-portal/src/app/features/consumption/consumption-copy.spec.ts`

**Interfaces:**
- Consumes: `ConsumptionDay`, `ConsumptionMonth`, `ProductionDeclaration` from
  `@peakpower-nl/api-client-customer` (task 6); `PpUsageDataState`, `PpUsageDay`, `PpUsageMonth`
  and `formatDutchDate`, `formatDutchDateTime`, `formatDutchDecimal`, `PP_UNAVAILABLE` from
  `@peakpower-nl/shared-ui`; `PpTone` from the same.
- Produces:
  - `export function toDataState(value: string): PpUsageDataState`
  - `export function toDstPass(value: string | null | undefined): 'A' | 'B' | null`
  - `export function toUsageDay(envelope: ConsumptionDay): PpUsageDay`
  - `export function toUsageMonth(envelope: ConsumptionMonth): PpUsageMonth`
  - `export function formatMwh(kwh: number | null): string`
  - `export const DATA_STATE_LABEL: Readonly<Record<PpUsageDataState, string>>`
  - `export const DATA_STATE_NOTE: Readonly<Record<PpUsageDataState, string>>`
  - `export const DATA_STATE_TONE: Readonly<Record<PpUsageDataState, PpTone>>`
  - `export const KPI_CONSUMPTION`, `KPI_PRODUCTION`, `KPI_NET_USAGE`
  - `export const EMPTY_DAY_HEADING`, `EMPTY_DAY_BODY`, `EMPTY_MONTH_HEADING`, `EMPTY_MONTH_BODY`
  - `export function productionSourceLabel(value: string): string`
  - `export function declaredZeroLine(declaration: ProductionDeclaration | null): string`
  - `export function correctedOnLine(at: string): string`

- [ ] **Step 1: Write the failing mapper test**

Create `apps/customer-portal/src/app/features/consumption/consumption-envelope.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PP_MINUS, PP_UNAVAILABLE } from '@peakpower-nl/shared-ui';
import type { ConsumptionDay, ConsumptionMonth } from '@peakpower-nl/api-client-customer';

import {
  formatMwh,
  toDataState,
  toDstPass,
  toUsageDay,
  toUsageMonth,
} from './consumption-envelope';

/**
 * The §10.1 envelope, as the wire actually carries it.
 *
 * Cast rather than typed: the generated `ConsumptionDay` is whatever plan 6's record emits, and a
 * fixture that had to satisfy it exactly would make this spec a compile check on the generator
 * rather than a behaviour check on the mapper. What is asserted below is what the mapper DOES with
 * each field, which is the half a type cannot say.
 */
function dayEnvelope(over: Record<string, unknown> = {}): ConsumptionDay {
  return {
    date: '2026-08-12',
    meteringPointIds: ['mp-1'],
    intervalCount: 96,
    dataState: 'PROVISIONAL',
    lastDataDate: '2026-08-14',
    lastCorrectedAt: null,
    productionIsDeclaredZero: false,
    productionDeclaration: null,
    intervals: [
      {
        pos: 1,
        start: '2026-08-12T00:00:00+02:00',
        end: '2026-08-12T00:15:00+02:00',
        dstPass: null,
        consumptionKwh: 180,
        productionKwh: 0,
        netUsageKwh: 180,
      },
    ],
    summary: {
      consumptionKwh: 11420,
      productionKwh: 0,
      netUsageKwh: 11420,
      dataState: 'PROVISIONAL',
    },
    ...over,
  } as unknown as ConsumptionDay;
}

function monthEnvelope(over: Record<string, unknown> = {}): ConsumptionMonth {
  return {
    month: '2026-08',
    meteringPointIds: ['mp-1'],
    dayCount: 2,
    dataState: 'PARTIAL',
    lastDataDate: '2026-08-01',
    days: [
      {
        date: '2026-08-01',
        intervalCount: 96,
        dataState: 'FINAL',
        consumptionKwh: 11420,
        productionKwh: 0,
        netUsageKwh: 11420,
      },
      {
        date: '2026-08-02',
        intervalCount: 96,
        dataState: 'NO_DATA',
        consumptionKwh: null,
        productionKwh: null,
        netUsageKwh: null,
      },
    ],
    summary: {
      consumptionKwh: 11420,
      productionKwh: 0,
      netUsageKwh: 11420,
      dataState: 'PARTIAL',
    },
    ...over,
  } as unknown as ConsumptionMonth;
}

describe('toDataState', () => {
  it('carries the four states through unchanged', () => {
    expect(toDataState('NO_DATA')).toBe('NO_DATA');
    expect(toDataState('PARTIAL')).toBe('PARTIAL');
    expect(toDataState('PROVISIONAL')).toBe('PROVISIONAL');
    expect(toDataState('FINAL')).toBe('FINAL');
  });

  it('fails CLOSED on a state it does not recognise', () => {
    // The state set is fixed by a database CHECK, so a fifth value is a migration and not a
    // deployment. If one arrives anyway, "we do not know" is the only honest answer — reading an
    // unknown state as FINAL would tell a customer a number is settled when nothing says so.
    expect(toDataState('COMPLETE')).toBe('NO_DATA');
    expect(toDataState('')).toBe('NO_DATA');
  });
});

describe('toDstPass', () => {
  it('carries A and B through and everything else to null', () => {
    expect(toDstPass('A')).toBe('A');
    expect(toDstPass('B')).toBe('B');
    expect(toDstPass(null)).toBeNull();
    expect(toDstPass(undefined)).toBeNull();
    expect(toDstPass('C')).toBeNull();
  });
});

describe('toUsageDay', () => {
  it('keeps intervalCount and intervals.length APART', () => {
    // Shared contract §11.2: the axis is intervalCount long and the intervals are sparse. A
    // mapper that "helpfully" set one from the other would defeat the chart's whole gap rule
    // before the chart ever saw the data.
    const day = toUsageDay(dayEnvelope());

    expect(day.intervalCount).toBe(96);
    expect(day.intervals).toHaveLength(1);
  });

  it('leaves a missing interval ABSENT rather than filling it', () => {
    // [F02-R25], [F03-R06]. Filling positions 2..96 with zeros here would make every chart
    // assertion downstream pass while the screen showed a day of measured nothing.
    const day = toUsageDay(dayEnvelope());

    expect(day.intervals.map((i) => i.pos)).toEqual([1]);
  });

  it('carries a null volume through as null and NEVER as zero', () => {
    const day = toUsageDay(
      dayEnvelope({
        intervals: [
          {
            pos: 1,
            start: '2026-08-12T00:00:00+02:00',
            end: '2026-08-12T00:15:00+02:00',
            dstPass: null,
            consumptionKwh: 180,
            productionKwh: null,
            netUsageKwh: null,
          },
        ],
      }),
    );

    expect(day.intervals[0].productionKwh).toBeNull();
    expect(day.intervals[0].netUsageKwh).toBeNull();
    expect(day.intervals[0].consumptionKwh).toBe(180);
  });

  it('carries a NEGATIVE net usage through, sign and all', () => {
    const day = toUsageDay(
      dayEnvelope({
        intervals: [
          {
            pos: 1,
            start: '2026-08-12T00:00:00+02:00',
            end: '2026-08-12T00:15:00+02:00',
            dstPass: null,
            consumptionKwh: 0,
            productionKwh: 60,
            netUsageKwh: -60,
          },
        ],
      }),
    );

    expect(day.intervals[0].netUsageKwh).toBe(-60);
  });

  it('carries the DST pass, the declared-zero flag and the correction instant', () => {
    const day = toUsageDay(
      dayEnvelope({
        productionIsDeclaredZero: true,
        lastCorrectedAt: '2026-08-13T09:22:41Z',
        intervals: [
          {
            pos: 13,
            start: '2026-10-25T02:00:00+01:00',
            end: '2026-10-25T02:15:00+01:00',
            dstPass: 'B',
            consumptionKwh: 12,
            productionKwh: 0,
            netUsageKwh: 12,
          },
        ],
      }),
    );

    expect(day.intervals[0].dstPass).toBe('B');
    expect(day.productionIsDeclaredZero).toBe(true);
    expect(day.lastCorrectedAt).toBe('2026-08-13T09:22:41Z');
  });
});

describe('toUsageMonth', () => {
  it('keeps every day, including the ones with no data', () => {
    // Shared contract §16 item 7: the month payload is DENSE precisely so [F03-R10] has a day to
    // mark. A mapper that filtered out the empty ones would make the stub unbuildable.
    const month = toUsageMonth(monthEnvelope());

    expect(month.days).toHaveLength(2);
    expect(month.days[1].date).toBe('2026-08-02');
    expect(month.days[1].dataState).toBe('NO_DATA');
  });

  it('carries a missing day as null volumes, never zeros', () => {
    const month = toUsageMonth(monthEnvelope());

    expect(month.days[1].consumptionKwh).toBeNull();
    expect(month.days[1].productionKwh).toBeNull();
    expect(month.days[1].netUsageKwh).toBeNull();
  });

  it('carries dayCount separately from days.length', () => {
    const month = toUsageMonth(monthEnvelope({ dayCount: 31 }));

    expect(month.dayCount).toBe(31);
    expect(month.days).toHaveLength(2);
  });
});

describe('formatMwh', () => {
  it('converts kWh to MWh and formats nl-NL with one decimal', () => {
    // The KPI strip works in MWh, as the mockups do; the tooltip works in kWh. Converting in one
    // named place is what stops a screen dividing by a thousand twice.
    expect(formatMwh(11420)).toBe('11,4 MWh');
    expect(formatMwh(0)).toBe('0,0 MWh');
  });

  it("prints the product's minus for a net-export total", () => {
    expect(formatMwh(-2500)).toBe(`${PP_MINUS}2,5 MWh`);
    expect(formatMwh(-2500)).not.toContain('-');
  });

  it('says there is nothing here rather than printing a zero', () => {
    expect(formatMwh(null)).toBe(PP_UNAVAILABLE);
    expect(formatMwh(null)).not.toBe(formatMwh(0));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: FAIL — `Failed to resolve import "./consumption-envelope" from "apps/customer-portal/src/app/features/consumption/consumption-envelope.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the mapper**

Create `apps/customer-portal/src/app/features/consumption/consumption-envelope.ts`:

```ts
import { PP_UNAVAILABLE, formatDutchDecimal } from '@peakpower-nl/shared-ui';
import type { PpUsageDataState, PpUsageDay, PpUsageMonth } from '@peakpower-nl/shared-ui';
import type { ConsumptionDay, ConsumptionMonth } from '@peakpower-nl/api-client-customer';

/**
 * The frozen HTTP envelopes (shared contract §10.1, §10.2) → the frozen chart shapes (§11.2).
 *
 * Pure, and separate from the screen on purpose. Two rules live here and each is a one-line
 * mistake inside a template:
 *
 *   A missing INTERVAL stays absent. Filling positions with zeros would make every chart
 *   assertion downstream pass while the screen showed a day of measured nothing [F02-R25],
 *   [F03-R06].
 *
 *   A null volume stays null. `?? 0` anywhere in this file erases the distinction between
 *   MISSING and MEASURED ZERO, which is the distinction the whole slice exists to preserve.
 */

/**
 * The wire's data-state string, narrowed.
 *
 * ⚠ This function HAS a default arm, and `shared/labels.ts` forbids exactly that — read the
 * difference rather than making the two match. `labels.ts` switches over a TYPED union off the
 * generated contract, where `noImplicitReturns` is what makes an unhandled member a compile
 * error and a default arm would swallow the next member silently. This one takes a `string` off
 * the wire, where there is nothing to be exhaustive against and an unhandled value would be a
 * runtime `undefined` printed to a customer.
 *
 * It fails CLOSED. The value set is fixed by a database CHECK, so a fifth state is a migration
 * rather than a deployment; if one arrives anyway, "we do not know" is the only honest answer.
 * Reading an unknown state as FINAL would tell a customer a number is settled when nothing does.
 */
export function toDataState(value: string): PpUsageDataState {
  switch (value) {
    case 'NO_DATA':
    case 'PARTIAL':
    case 'PROVISIONAL':
    case 'FINAL':
      return value;
    default:
      return 'NO_DATA';
  }
}

/** `'A'` / `'B'` / null — the autumn duplicate hour's pass, and nothing else is meaningful. */
export function toDstPass(value: string | null | undefined): 'A' | 'B' | null {
  return value === 'A' || value === 'B' ? value : null;
}

export function toUsageDay(envelope: ConsumptionDay): PpUsageDay {
  return {
    date: envelope.date,
    // ⚠ NOT envelope.intervals.length. The axis is intervalCount long and the intervals are
    // sparse; setting one from the other defeats the gap rule before the chart sees the data.
    intervalCount: envelope.intervalCount,
    dataState: toDataState(envelope.dataState),
    intervals: envelope.intervals.map((item) => ({
      pos: item.pos,
      start: item.start,
      end: item.end,
      dstPass: toDstPass(item.dstPass),
      // No `?? 0` on any of the three. Null is missing.
      consumptionKwh: item.consumptionKwh,
      productionKwh: item.productionKwh,
      netUsageKwh: item.netUsageKwh,
    })),
    productionIsDeclaredZero: envelope.productionIsDeclaredZero,
    lastCorrectedAt: envelope.lastCorrectedAt,
  };
}

export function toUsageMonth(envelope: ConsumptionMonth): PpUsageMonth {
  return {
    month: envelope.month,
    dayCount: envelope.dayCount,
    dataState: toDataState(envelope.dataState),
    // ⚠ No filter. The month payload is DENSE so that [F03-R10] has a day to mark; dropping the
    // empty ones makes the stub unbuildable and turns a gappy month into a short one.
    days: envelope.days.map((day) => ({
      date: day.date,
      dataState: toDataState(day.dataState),
      consumptionKwh: day.consumptionKwh,
      productionKwh: day.productionKwh,
      netUsageKwh: day.netUsageKwh,
    })),
  };
}

/**
 * kWh → `11,4 MWh`.
 *
 * The KPI strip works in MWh, as both chart mockups do, and the tooltips work in kWh. The
 * conversion lives in one named place so a screen cannot divide by a thousand twice — and it is
 * `formatDutchDecimal`, not `Intl.NumberFormat('nl-NL')`, which groups with a narrow no-break
 * space on some ICU builds and always emits the ASCII hyphen where this product prints U+2212.
 */
export function formatMwh(kwh: number | null): string {
  return kwh === null ? PP_UNAVAILABLE : `${formatDutchDecimal(kwh / 1000, 1)} MWh`;
}
```

- [ ] **Step 4: Write the failing copy test**

Create `apps/customer-portal/src/app/features/consumption/consumption-copy.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PpUsageDataState } from '@peakpower-nl/shared-ui';

import {
  DATA_STATE_LABEL,
  DATA_STATE_NOTE,
  DATA_STATE_TONE,
  EMPTY_DAY_BODY,
  EMPTY_DAY_HEADING,
  EMPTY_MONTH_BODY,
  EMPTY_MONTH_HEADING,
  KPI_CONSUMPTION,
  KPI_NET_USAGE,
  KPI_PRODUCTION,
  correctedOnLine,
  declaredZeroLine,
  productionSourceLabel,
} from './consumption-copy';

const STATES: readonly PpUsageDataState[] = ['NO_DATA', 'PARTIAL', 'PROVISIONAL', 'FINAL'];

describe('the data-state vocabulary', () => {
  it('labels, notes and tones every state, with no gaps', () => {
    for (const state of STATES) {
      expect(DATA_STATE_LABEL[state], `${state} has no label`).toBeTruthy();
      expect(DATA_STATE_NOTE[state], `${state} has no note`).toBeTruthy();
      expect(DATA_STATE_TONE[state], `${state} has no tone`).toBeTruthy();
    }
    expect(Object.keys(DATA_STATE_LABEL).sort()).toEqual([...STATES].sort());
  });

  it('never says PROJECTED about a measured number', () => {
    // Shared contract §14: "Projected" is not yet MEASURED; "Provisional" is not yet ACCEPTED. A
    // PROVISIONAL day is measured, and calling it projected is a lie about a number the customer
    // will be invoiced on.
    const everySentence = [
      ...Object.values(DATA_STATE_LABEL),
      ...Object.values(DATA_STATE_NOTE),
      EMPTY_DAY_HEADING,
      EMPTY_DAY_BODY,
      EMPTY_MONTH_HEADING,
      EMPTY_MONTH_BODY,
      KPI_CONSUMPTION,
      KPI_PRODUCTION,
      KPI_NET_USAGE,
    ];

    for (const sentence of everySentence) {
      expect(sentence.toLowerCase(), sentence).not.toContain('projected');
      expect(sentence, sentence).not.toContain('€');
    }
  });

  it('writes every sentence in sentence case, never in the wire spelling', () => {
    for (const state of STATES) {
      expect(DATA_STATE_LABEL[state]).not.toMatch(/^[A-Z][A-Z_0-9]*$/);
      expect(DATA_STATE_NOTE[state].endsWith('.')).toBe(false);
    }
    expect(DATA_STATE_LABEL.NO_DATA).toBe('No data');
    expect(DATA_STATE_LABEL.PROVISIONAL).toBe('Provisional');
  });

  it('tones a provisional day as information and a partial one as a warning', () => {
    // A non-default value on both counts: a component that hardcoded 'neutral' would pass a spec
    // that only ever checked NO_DATA.
    expect(DATA_STATE_TONE.NO_DATA).toBe('neutral');
    expect(DATA_STATE_TONE.PARTIAL).toBe('warning');
    expect(DATA_STATE_TONE.PROVISIONAL).toBe('info');
    expect(DATA_STATE_TONE.FINAL).toBe('success');
  });

  it('says a provisional number is MEASURED and may still change', () => {
    expect(DATA_STATE_NOTE.PROVISIONAL.toLowerCase()).toContain('measured');
    expect(DATA_STATE_NOTE.PROVISIONAL.toLowerCase()).toContain('correct');
  });
});

describe('declaredZeroLine', () => {
  it('traces the zero to its source, its setter and its date', () => {
    // [F02-R33] with [F01-R40]: "This zero is a declared value taken from master data, not an
    // absence inferred as zero: it traces to the source, the setter and the date recorded with
    // the claim." All three, or the treatment is not the one the requirement asks for.
    const line = declaredZeroLine({
      expectation: 'NEVER',
      source: 'CUSTOMER_DECLARED',
      setBy: 'p.devries@vandersteen.nl',
      setAt: '2026-07-01T08:14:00Z',
    } as never);

    expect(line).toContain('declared by you');
    expect(line).toContain('p.devries@vandersteen.nl');
    expect(line).toContain('1 jul 2026');
    expect(line.toLowerCase()).not.toContain('no data');
  });

  it('says the zero is declared even when nobody recorded who declared it', () => {
    // A NEVER connection with no setter recorded is still a declared zero, not an absence — and
    // saying nothing at all would leave a flat line reading as a gap.
    const line = declaredZeroLine(null);

    expect(line.toLowerCase()).toContain('declared');
    expect(line).not.toContain('undefined');
    expect(line).not.toContain('null');
  });

  it('names each recorded source in words, and an unknown one without printing undefined', () => {
    expect(productionSourceLabel('CONTRACT')).toBe('declared in your contract');
    expect(productionSourceLabel('GRID_OPERATOR')).toBe('stated by the grid operator');
    expect(productionSourceLabel('OBSERVED')).toBe('observed in your metering data');
    expect(productionSourceLabel('MANUAL')).toBe('set by PeakPower');
    expect(productionSourceLabel('CUSTOMER_DECLARED')).toBe('declared by you');
    expect(productionSourceLabel('SOMETHING_NEW')).toBe('source not recorded');
  });
});

describe('correctedOnLine', () => {
  it('names when the correction landed, in Amsterdam', () => {
    // [DEC-98]: FINAL is a status, and a post-window reconciliation reopens the date. 09:22Z is
    // 11:22 in Amsterdam, and the customer reads Amsterdam.
    expect(correctedOnLine('2026-08-13T09:22:41Z')).toBe('Corrected on 13 aug 2026, 11:22');
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: FAIL — `Failed to resolve import "./consumption-copy" …`

- [ ] **Step 6: Write the copy**

Create `apps/customer-portal/src/app/features/consumption/consumption-copy.ts`:

```ts
import { formatDutchDate, formatDutchDateTime } from '@peakpower-nl/shared-ui';
import type { PpTone, PpUsageDataState } from '@peakpower-nl/shared-ui';
import type { ProductionDeclaration } from '@peakpower-nl/api-client-customer';

/**
 * Every sentence the consumption screen prints, in one file.
 *
 * Two copy rules carry this screen and both are shared contract §14:
 *
 *   "Projected" = not yet MEASURED. "Provisional" = not yet ACCEPTED. Never swap them — a
 *   PROVISIONAL day IS measured, and calling it projected is a lie about a number the customer
 *   will be invoiced on.
 *
 *   A declared zero is not an absence [F02-R33]. Where production_expectation is NEVER,
 *   production reads as a stated zero traceable to its source, its setter and its date [F01-R40].
 *
 * And S2-D6: volumes only. There is no price, no €/MWh and no euro figure on this screen, so no
 * sentence here carries one.
 */

/** The stat-card label. `pp-stat-card` renders it in caps; it is written in sentence case. */
export const KPI_CONSUMPTION = 'Consumption';
export const KPI_PRODUCTION = 'Production';
export const KPI_NET_USAGE = 'Net usage';

/** The badge word for a range's data state. */
export const DATA_STATE_LABEL: Readonly<Record<PpUsageDataState, string>> = Object.freeze({
  NO_DATA: 'No data',
  PARTIAL: 'Partial',
  PROVISIONAL: 'Provisional',
  FINAL: 'Final',
});

/**
 * The faint sublabel under each figure — "every number carries its provenance", §14.
 *
 * No full stop: these sit under a number as a caption rather than standing as sentences, which is
 * the treatment `pp-stat-card__sublabel` was built for.
 */
export const DATA_STATE_NOTE: Readonly<Record<PpUsageDataState, string>> = Object.freeze({
  NO_DATA: 'nothing has arrived for this range yet',
  PARTIAL: 'some intervals in this range are still missing',
  PROVISIONAL: 'measured, and your BRP may still correct it',
  FINAL: 'measured, and the correction window has closed',
});

export const DATA_STATE_TONE: Readonly<Record<PpUsageDataState, PpTone>> = Object.freeze({
  NO_DATA: 'neutral',
  PARTIAL: 'warning',
  PROVISIONAL: 'info',
  FINAL: 'success',
});

export const EMPTY_DAY_HEADING = 'No data for this day yet';
export const EMPTY_DAY_BODY =
  'Nothing has arrived from your balance responsible party for this date. Metering data usually ' +
  'lands the following morning; pick another day, or jump to the most recent day with data.';

export const EMPTY_MONTH_HEADING = 'No data for this month yet';
export const EMPTY_MONTH_BODY =
  'Nothing has arrived from your balance responsible party for any day of this month. Pick ' +
  'another month, or jump to the most recent day with data.';

type ProductionSource =
  | 'CONTRACT'
  | 'GRID_OPERATOR'
  | 'OBSERVED'
  | 'MANUAL'
  | 'CUSTOMER_DECLARED';

const PRODUCTION_SOURCE_LABEL: Readonly<Record<ProductionSource, string>> = Object.freeze({
  CONTRACT: 'declared in your contract',
  GRID_OPERATOR: 'stated by the grid operator',
  OBSERVED: 'observed in your metering data',
  MANUAL: 'set by PeakPower',
  CUSTOMER_DECLARED: 'declared by you',
});

export function productionSourceLabel(value: string): string {
  const known = PRODUCTION_SOURCE_LABEL[value as ProductionSource];
  // A Record<Union, string> types this as `string`, but the value came off the wire. An
  // unrecognised source is `undefined` at runtime and would print the word "undefined" to a
  // customer under a heading that claims to say where a number came from.
  return known ?? 'source not recorded';
}

/**
 * [F02-R33] with [F01-R40]. The source, the setter and the date, or as many of the three as were
 * recorded — and the word "declared" whatever happens, because the alternative is a flat line at
 * zero that reads as an absence, which is the one thing R33 forbids.
 */
export function declaredZeroLine(declaration: ProductionDeclaration | null): string {
  if (declaration === null) {
    return 'Production is a declared zero: this connection is recorded as never producing.';
  }
  const source = productionSourceLabel(declaration.source);
  const setBy = declaration.setBy;
  const setAt = formatDutchDate(declaration.setAt);
  return `Production is a declared zero: ${source}, set by ${setBy} on ${setAt}.`;
}

/** [DEC-98]: FINAL is a status, and a post-window reconciliation reopens the date. */
export function correctedOnLine(at: string): string {
  return `Corrected on ${formatDutchDateTime(at)}`;
}
```

- [ ] **Step 7: Run both and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: PASS.

⚠ If `traces the zero to its source, its setter and its date` fails on the date, check the
`setAt` value: `formatDutchDate` renders a date-only string in Amsterdam, and `2026-07-01T08:14:00Z`
is `1 jul 2026` there. A `Z` instant near midnight would render the following day, which is correct
and is why the fixture uses 08:14.

- [ ] **Step 8: Mutation check — the coalesced null**

In `consumption-envelope.ts`, do the helpful thing:

```ts
      consumptionKwh: item.consumptionKwh ?? 0,
      productionKwh: item.productionKwh ?? 0,
      netUsageKwh: item.netUsageKwh ?? 0,
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `carries a null volume through as null and NEVER as zero` reports
`expected 0 to be null`, twice. Predicted before running: **nothing in the chart's own suite goes
red**, because the chart is downstream of this and would be drawing a perfectly valid line through
values it was handed. The mapper is the last place this can be caught. **Restore immediately.**

- [ ] **Step 9: Mutation check — the dropped empty month days**

In `consumption-envelope.ts`, filter the month:

```ts
    days: envelope.days
      .filter((day) => day.netUsageKwh !== null)
      .map((day) => ({ … })),
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `keeps every day, including the ones with no data` reports
`expected [ … ] to have a length of 2 but got 1`. Predicted before running: `carries dayCount
separately from days.length` stays green, so the month chart would still lay out 31 slots and
simply have nothing in two of them — a gappy month rendered as a short one, `[F03-R10]` exactly.
**Restore immediately.**

- [ ] **Step 10: Mutation check — the declared zero read as an absence**

In `consumption-copy.ts`, replace `declaredZeroLine`'s null branch:

```ts
  if (declaration === null) {
    return 'No production data for this connection.';
  }
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `says the zero is declared even when nobody recorded who declared it` reports
`expected 'no production data for this connection.' to contain 'declared'`. That sentence is the
`[F02-R33]` failure written out: a declared zero described as an absence. **Restore immediately.**

- [ ] **Step 11: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/features/consumption
git commit -m "feat(customer-portal): the consumption envelope mapper and its copy

Two pure files with their own suites. The mapper is the last place a ?? 0 can erase the
difference between a MISSING volume and a MEASURED ZERO, and the last place a filter can
turn a gappy month into a short one.

Verified by mutation three ways: coalescing a null volume to zero goes red here and
NOWHERE downstream, because the chart would be drawing a valid line through values it
was handed; filtering the empty month days leaves dayCount intact and renders a gappy
month as a short one, which is [F03-R10]; and describing a declared zero as 'no
production data' is [F02-R33]'s forbidden reading in one sentence."
```

---

### Task 9: The calendar arithmetic and the hand-rolled date picker

`[F03-R07]` is a **Must**: *"Date navigation: previous/next day, a date picker, and a jump to the
most recent day with data."* `[OQ-49]` — which component library — is deferred by **S2-D5**, so
nothing supplies a date picker and this task writes one.

⚠ **Every date calculation goes through UTC and back, and never through a local `Date`.** A
picker that does `new Date(2026, 9, 25)` and adds 86 400 000 ms lands on the same calendar day on
the autumn fall-back Sunday, because that day is twenty-five hours long. This product's *entire
subject* is that day. `Date.UTC` plus `setUTCDate` steps calendar days exactly, in a zone that has
no transitions, and the string is formatted back from the UTC parts — so nothing here depends on
the host's zone either.

⚠ **`addMonths` clamps to the end of the target month.** `2026-01-31` plus one month is
`2026-02-28`, not `2026-03-03`, which is what `setUTCMonth` does on its own.

⚠ **The week starts on Monday.** nl-NL, and `getUTCDay()` returns 0 for Sunday, so the conversion
is `(getUTCDay() + 6) % 7`.

**Files:**
- Create: `apps/customer-portal/src/app/features/consumption/consumption-calendar.ts`
- Create: `apps/customer-portal/src/app/features/consumption/day-picker.ts`
- Test: `apps/customer-portal/src/app/features/consumption/consumption-calendar.spec.ts`
- Test: `apps/customer-portal/src/app/features/consumption/day-picker.spec.ts`

**Interfaces:**
- Consumes: `formatDutchDate` from `@peakpower-nl/shared-ui`; `PpButton` from the same.
- Produces:
  - `export function addDays(date: string, days: number): string`
  - `export function shiftMonth(month: string, months: number): string`
  - `export function monthOf(date: string): string`
  - `export function firstOfMonth(month: string): string`
  - `export function daysInMonth(month: string): number`
  - `export function mondayFirstWeekday(date: string): number`
  - `export function monthGrid(month: string): readonly (readonly (string | null)[])[]`
  - `export function monthLabel(month: string): string`
  - `export class PpDayPicker` — selector `pp-day-picker`,
    `value = model.required<string>()`, `label = input('Pick a date')`,
    DOM contract `.pp-day-picker__trigger`, `.pp-day-picker__panel`, `.pp-day-picker__day`
    (with `data-date`), `.pp-day-picker__month`, `.pp-day-picker__prev`, `.pp-day-picker__next`.

- [ ] **Step 1: Write the failing calendar test**

Create `apps/customer-portal/src/app/features/consumption/consumption-calendar.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  addDays,
  daysInMonth,
  firstOfMonth,
  mondayFirstWeekday,
  monthGrid,
  monthLabel,
  monthOf,
  shiftMonth,
} from './consumption-calendar';

describe('addDays', () => {
  it('steps a calendar day forward and back', () => {
    expect(addDays('2026-08-12', 1)).toBe('2026-08-13');
    expect(addDays('2026-08-12', -1)).toBe('2026-08-11');
    expect(addDays('2026-08-12', 0)).toBe('2026-08-12');
  });

  it('crosses a month and a year boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('steps ACROSS both DST transitions without landing on the same day twice', () => {
    // The whole reason this function exists. 2026-03-29 is the spring-forward Sunday (23 hours)
    // and 2026-10-25 the autumn fall-back Sunday (25 hours). A local Date plus 86 400 000 ms
    // lands on the SAME calendar day on one of them and skips a day on the other — and those two
    // days are this product's entire subject.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-10-26', -1)).toBe('2026-10-25');
  });
});

describe('shiftMonth', () => {
  it('steps a month forward and back, across a year boundary', () => {
    expect(shiftMonth('2026-08', 1)).toBe('2026-09');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});

describe('monthOf and firstOfMonth', () => {
  it('reads the month off a date and the first day off a month', () => {
    expect(monthOf('2026-08-12')).toBe('2026-08');
    expect(firstOfMonth('2026-08')).toBe('2026-08-01');
  });
});

describe('daysInMonth', () => {
  it('counts the days of ordinary, short and leap months', () => {
    expect(daysInMonth('2026-08')).toBe(31);
    expect(daysInMonth('2026-04')).toBe(30);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
  });

  it('counts the DST months at their ordinary length', () => {
    // The autumn month has 31 days and 745 hours. A day count derived by dividing a millisecond
    // span by 86 400 000 answers 31.04 here and 30.96 in March.
    expect(daysInMonth('2026-10')).toBe(31);
    expect(daysInMonth('2026-03')).toBe(31);
  });
});

describe('mondayFirstWeekday', () => {
  it('puts Monday at 0 and Sunday at 6', () => {
    // 2026-08-03 is a Monday; 2026-08-09 is a Sunday. getUTCDay() calls those 1 and 0.
    expect(mondayFirstWeekday('2026-08-03')).toBe(0);
    expect(mondayFirstWeekday('2026-08-09')).toBe(6);
    expect(mondayFirstWeekday('2026-08-12')).toBe(2);
  });
});

describe('monthGrid', () => {
  it('lays a month out as six rows of seven, Monday first', () => {
    const grid = monthGrid('2026-08');

    expect(grid).toHaveLength(6);
    for (const row of grid) expect(row).toHaveLength(7);
  });

  it('pads the leading and trailing cells with null rather than with a neighbouring month', () => {
    // 2026-08-01 is a Saturday, so five leading blanks. Showing 27..31 July there would let a
    // customer pick a day outside the month they are looking at.
    const grid = monthGrid('2026-08');

    expect(grid[0]).toEqual([null, null, null, null, null, '2026-08-01', '2026-08-02']);
    expect(grid[0].filter((d) => d !== null)).toHaveLength(2);
    expect(grid.flat().filter((d) => d !== null)).toHaveLength(31);
    expect(grid[5].every((d) => d === null)).toBe(true);
  });

  it('lays out a month that starts on a Monday with no leading blanks', () => {
    // 2026-06-01 is a Monday. A grid that always padded would push the first row a day late.
    const grid = monthGrid('2026-06');

    expect(grid[0][0]).toBe('2026-06-01');
    expect(grid.flat().filter((d) => d !== null)).toHaveLength(30);
  });

  it('lays out February 2028, the leap month', () => {
    const grid = monthGrid('2028-02');

    expect(grid.flat().filter((d) => d !== null)).toHaveLength(29);
    expect(grid.flat()).toContain('2028-02-29');
  });
});

describe('monthLabel', () => {
  it('names the month in Dutch, in the product zone', () => {
    expect(monthLabel('2026-08')).toBe('augustus 2026');
    expect(monthLabel('2026-03')).toBe('maart 2026');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: FAIL — `Failed to resolve import "./consumption-calendar" …`

- [ ] **Step 3: Write the calendar**

Create `apps/customer-portal/src/app/features/consumption/consumption-calendar.ts`:

```ts
import { PRODUCT_TIME_ZONE } from '@peakpower-nl/shared-ui';

/**
 * Calendar arithmetic for the consumption screen's navigation.
 *
 * ⚠ EVERY calculation goes through UTC and back, and never through a local `Date`. A picker that
 * builds `new Date(2026, 9, 25)` and adds 86 400 000 ms lands on the SAME calendar day, because
 * the autumn fall-back Sunday is twenty-five hours long — and that day is this product's entire
 * subject. `Date.UTC` plus `setUTCDate` steps calendar days exactly, in a zone with no
 * transitions, and the string is rebuilt from the UTC parts, so nothing here depends on the host's
 * zone either.
 *
 * Only `monthLabel` uses `Intl`, and only for a month NAME. A month name is CLDR's Dutch and
 * hand-rolling it would fork locale data; a NUMBER's separators are punctuation this product owns
 * outright, which is why `formatDutchDecimal` exists and `Intl.NumberFormat` is not used anywhere.
 */

/** `yyyy-MM-dd` → the UTC midnight of that calendar day. */
function toUtc(date: string): Date {
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))));
}

/** The UTC parts back as `yyyy-MM-dd`, never `toISOString().slice(0,10)` on a local Date. */
function toIsoDate(value: Date): string {
  const year = String(value.getUTCFullYear()).padStart(4, '0');
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date: string, days: number): string {
  const value = toUtc(date);
  value.setUTCDate(value.getUTCDate() + days);
  return toIsoDate(value);
}

/** `yyyy-MM` → `yyyy-MM`, `months` later. Day-of-month is not involved, so nothing to clamp. */
export function shiftMonth(month: string, months: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + months;
  const value = new Date(Date.UTC(year, index, 1));
  return `${String(value.getUTCFullYear()).padStart(4, '0')}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function firstOfMonth(month: string): string {
  return `${month}-01`;
}

/**
 * The number of days in `yyyy-MM`.
 *
 * Day 0 of the NEXT month is the last day of this one — the standard trick, and correct for leap
 * years without a rule of its own. ⚠ Not a millisecond span divided by 86 400 000: that answers
 * 31.04 for October and 30.96 for March.
 */
export function daysInMonth(month: string): number {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, index, 0)).getUTCDate();
}

/** 0 = Monday … 6 = Sunday. nl-NL weeks start on Monday; `getUTCDay()` puts Sunday at 0. */
export function mondayFirstWeekday(date: string): number {
  return (toUtc(date).getUTCDay() + 6) % 7;
}

/**
 * Six rows of seven, Monday first, with `null` in every cell outside the month.
 *
 * Six rows always, so the panel does not change height as a customer steps through the year — a
 * grid that grew from five rows to six moves the buttons under the pointer.
 *
 * ⚠ The padding is `null` and NOT the neighbouring month's days. A visible 31 July inside the
 * August panel is a day a customer can click, and clicking it would navigate outside the month
 * they are looking at.
 */
export function monthGrid(month: string): readonly (readonly (string | null)[])[] {
  const total = daysInMonth(month);
  const lead = mondayFirstWeekday(firstOfMonth(month));
  const cells: (string | null)[] = Array.from({ length: 42 }, () => null);
  for (let day = 1; day <= total; day++) {
    cells[lead + day - 1] = `${month}-${String(day).padStart(2, '0')}`;
  }
  const rows: (string | null)[][] = [];
  for (let row = 0; row < 6; row++) rows.push(cells.slice(row * 7, row * 7 + 7));
  return rows;
}

/** `augustus 2026`. The one place `Intl` is used here, and only for the month NAME. */
export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('nl-NL', {
    month: 'long',
    year: 'numeric',
    timeZone: PRODUCT_TIME_ZONE,
  }).format(toUtc(firstOfMonth(month)));
}
```

⚠ **`lead + day - 1` can reach 41 at most**: the longest possible lead is 6 (a 31-day month
starting on a Sunday) and `6 + 31 - 1 = 36`. Forty-two cells is therefore always enough, and the
sixth row is empty on most months — which the spec asserts for August 2026 specifically.

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: PASS.

- [ ] **Step 5: Write the failing picker test**

Create `apps/customer-portal/src/app/features/consumption/day-picker.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';

import { PpDayPicker } from './day-picker';

describe('PpDayPicker', () => {
  let fixture: ComponentFixture<PpDayPicker>;
  let host: HTMLElement;

  function render(value = '2026-08-12'): void {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(PpDayPicker, { inferTagName: true });
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  }

  const trigger = () => host.querySelector('.pp-day-picker__trigger') as HTMLButtonElement;
  const panel = () => host.querySelector('.pp-day-picker__panel');
  const dayButton = (date: string) =>
    host.querySelector(`.pp-day-picker__day[data-date="${date}"]`) as HTMLButtonElement | null;

  function open(): void {
    trigger().click();
    fixture.detectChanges();
  }

  it('shows the selected date in the product spelling, not the wire spelling', () => {
    render('2026-08-12');

    expect(trigger().textContent?.trim()).toBe('12 aug 2026');
  });

  it('keeps the panel closed until it is asked for, and says so to a screen reader', () => {
    render();

    expect(panel()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger().getAttribute('type')).toBe('button');
  });

  it('opens on the month of the selected date', () => {
    render('2026-08-12');
    open();

    expect(panel()).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('.pp-day-picker__month')?.textContent?.trim()).toBe('augustus 2026');
    expect(dayButton('2026-08-12')?.getAttribute('aria-pressed')).toBe('true');
    expect(dayButton('2026-08-11')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders every day of the month as a real button and no day of any other month', () => {
    render('2026-08-12');
    open();

    const days = [...host.querySelectorAll('.pp-day-picker__day')];
    expect(days).toHaveLength(31);
    for (const day of days) {
      expect(day.tagName).toBe('BUTTON');
      expect(day.getAttribute('type')).toBe('button');
      expect(day.getAttribute('data-date')!.startsWith('2026-08')).toBe(true);
    }
  });

  it('picks a date, writes it back and closes', () => {
    render('2026-08-12');
    open();

    dayButton('2026-08-27')!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.value()).toBe('2026-08-27');
    expect(panel()).toBeNull();
    expect(trigger().textContent?.trim()).toBe('27 aug 2026');
  });

  it('steps the panel a month at a time WITHOUT changing the selection', () => {
    // A picker that moved the selection as you browsed would fetch a day the customer had not
    // chosen, and every step through the year would be a request.
    render('2026-08-12');
    open();

    (host.querySelector('.pp-day-picker__next') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.querySelector('.pp-day-picker__month')?.textContent?.trim()).toBe('september 2026');
    expect(fixture.componentInstance.value()).toBe('2026-08-12');

    (host.querySelector('.pp-day-picker__prev') as HTMLButtonElement).click();
    (host.querySelector('.pp-day-picker__prev') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.querySelector('.pp-day-picker__month')?.textContent?.trim()).toBe('juli 2026');
    expect(fixture.componentInstance.value()).toBe('2026-08-12');
  });

  it('reopens on the selected month after browsing away and closing', () => {
    // Otherwise a customer who browsed to December, closed, and reopened lands in December with
    // August selected — and the highlighted day is nowhere on screen.
    render('2026-08-12');
    open();
    (host.querySelector('.pp-day-picker__next') as HTMLButtonElement).click();
    fixture.detectChanges();

    trigger().click();
    fixture.detectChanges();
    open();

    expect(host.querySelector('.pp-day-picker__month')?.textContent?.trim()).toBe('augustus 2026');
  });

  it('closes on Escape without changing the selection', () => {
    render('2026-08-12');
    open();

    host
      .querySelector('.pp-day-picker__panel')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(panel()).toBeNull();
    expect(fixture.componentInstance.value()).toBe('2026-08-12');
  });

  it('names each day for a screen reader rather than leaving a bare numeral', () => {
    render('2026-08-12');
    open();

    expect(dayButton('2026-08-27')!.getAttribute('aria-label')).toBe('27 aug 2026');
    expect(dayButton('2026-08-27')!.textContent?.trim()).toBe('27');
  });

  it('labels the seven columns Monday first', () => {
    render();
    open();

    expect(
      [...host.querySelectorAll('.pp-day-picker__weekday')].map((n) => n.textContent?.trim()),
    ).toEqual(['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: FAIL — `Failed to resolve import "./day-picker" …`

- [ ] **Step 7: Write the picker**

Create `apps/customer-portal/src/app/features/consumption/day-picker.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { formatDutchDate } from '@peakpower-nl/shared-ui';

import { monthGrid, monthLabel, monthOf, shiftMonth } from './consumption-calendar';

/** nl-NL, Monday first. Two letters is what the canvas's own calendars use. */
const WEEKDAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'] as const;

/**
 * The date picker of [F03-R07], hand-rolled.
 *
 * [OQ-49] — which component library — is deferred by S2-D5, so nothing supplies one. It is
 * deliberately app-local rather than a `shared-ui` primitive: shared contract §11.1 fixes the
 * library's slice-2 additions at the two charts and the five types, and a picker promoted into
 * the design system would be a public API nobody has designed yet.
 *
 * ⚠ Browsing the panel does NOT change the selection. A picker that moved the selection as you
 * stepped through the months would issue a request per step and land the customer on a day they
 * never chose.
 */
@Component({
  selector: 'pp-day-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-day-picker">
      <button
        type="button"
        class="pp-day-picker__trigger"
        [attr.aria-expanded]="open()"
        aria-haspopup="dialog"
        [attr.aria-label]="triggerLabel()"
        (click)="toggle()"
      >{{ selectedLabel() }}</button>

      @if (open()) {
        <div
          class="pp-day-picker__panel"
          role="dialog"
          [attr.aria-label]="label()"
          (keydown.escape)="close()"
        >
          <div class="pp-day-picker__head">
            <button type="button" class="pp-day-picker__prev" aria-label="Previous month"
              (click)="step(-1)">‹</button>
            <span class="pp-day-picker__month">{{ monthTitle() }}</span>
            <button type="button" class="pp-day-picker__next" aria-label="Next month"
              (click)="step(1)">›</button>
          </div>

          <div class="pp-day-picker__weekdays">
            @for (name of weekdays; track name) {
              <span class="pp-day-picker__weekday">{{ name }}</span>
            }
          </div>

          @for (week of grid(); track $index) {
            <div class="pp-day-picker__week">
              @for (cell of week; track $index) {
                @if (cell) {
                  <button
                    type="button"
                    class="pp-day-picker__day"
                    [class.pp-day-picker__day--selected]="cell === value()"
                    [attr.data-date]="cell"
                    [attr.aria-pressed]="cell === value()"
                    [attr.aria-label]="dayLabel(cell)"
                    (click)="pick(cell)"
                  >{{ dayNumeral(cell) }}</button>
                } @else {
                  <span class="pp-day-picker__blank" aria-hidden="true"></span>
                }
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .pp-day-picker { position: relative; display: inline-block; }
    .pp-day-picker__trigger {
      font: inherit; font-size: 12px; font-weight: 600; padding: 7px 12px;
      border: 1px solid var(--pp-border-strong); border-radius: var(--radius-md);
      background: var(--pp-surface); color: var(--pp-text-heading); cursor: pointer;
      min-width: 118px;
    }
    .pp-day-picker__trigger:hover { border-color: var(--pp-blue-500); }
    .pp-day-picker__trigger:focus-visible {
      outline: 2px solid var(--pp-blue-300); outline-offset: 2px;
    }
    .pp-day-picker__panel {
      position: absolute; z-index: 20; top: calc(100% + 6px); left: 0;
      padding: 10px; width: 244px;
      border: 1px solid var(--pp-border-strong); border-radius: var(--radius-lg);
      background: var(--pp-surface); box-shadow: var(--pp-shadow-card);
    }
    .pp-day-picker__head {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
    }
    .pp-day-picker__month {
      font-size: 12px; font-weight: var(--weight-bold); color: var(--pp-text-heading);
    }
    .pp-day-picker__prev, .pp-day-picker__next {
      font: inherit; font-size: 15px; line-height: 1; width: 26px; height: 26px;
      border: 1px solid var(--pp-border); border-radius: var(--radius-md);
      background: var(--pp-surface); color: var(--pp-text-body); cursor: pointer;
    }
    .pp-day-picker__weekdays, .pp-day-picker__week {
      display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;
    }
    .pp-day-picker__weekday {
      font-size: 10px; text-align: center; color: var(--pp-text-faint); padding-bottom: 4px;
    }
    .pp-day-picker__day {
      font: inherit; font-size: 11.5px; padding: 5px 0; border: 1px solid transparent;
      border-radius: var(--radius-md); background: transparent; color: var(--pp-text-heading);
      cursor: pointer;
    }
    .pp-day-picker__day:hover { background: var(--pp-surface-alt); }
    .pp-day-picker__day--selected {
      background: var(--pp-blue-700); border-color: var(--pp-blue-700); color: #fff;
      font-weight: var(--weight-bold);
    }
    .pp-day-picker__day:focus-visible {
      outline: 2px solid var(--pp-blue-300); outline-offset: 1px;
    }
    .pp-day-picker__blank { display: block; }
  `,
})
export class PpDayPicker {
  /** `yyyy-MM-dd`. Two-way: the screen owns the date and the picker writes one back. */
  readonly value = model.required<string>();
  /** The panel's accessible name. */
  readonly label = input('Pick a date');

  protected readonly weekdays = WEEKDAYS;
  protected readonly open = signal(false);

  /**
   * The month the PANEL is showing, which is not the month of the selection while a customer is
   * browsing. Null means "follow the selection", which is what makes the panel reopen on the
   * selected month rather than wherever it was left.
   */
  private readonly browsing = signal<string | null>(null);

  protected readonly visibleMonth = computed(() => this.browsing() ?? monthOf(this.value()));
  protected readonly monthTitle = computed(() => monthLabel(this.visibleMonth()));
  protected readonly grid = computed(() => monthGrid(this.visibleMonth()));
  protected readonly selectedLabel = computed(() => formatDutchDate(this.value()));
  protected readonly triggerLabel = computed(
    () => `${this.label()} — ${this.selectedLabel()} selected`,
  );

  protected toggle(): void {
    const next = !this.open();
    // Reset the browse position on OPEN, not on close: reopening on December with August
    // selected shows a panel whose highlighted day is nowhere on it.
    if (next) this.browsing.set(null);
    this.open.set(next);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected step(months: number): void {
    this.browsing.set(shiftMonth(this.visibleMonth(), months));
  }

  protected pick(date: string): void {
    this.value.set(date);
    this.open.set(false);
  }

  protected dayNumeral(date: string): string {
    return String(Number(date.slice(8, 10)));
  }

  protected dayLabel(date: string): string {
    return formatDutchDate(date);
  }
}
```

- [ ] **Step 8: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: PASS.

- [ ] **Step 9: Mutation check — the local-Date step**

In `consumption-calendar.ts`, write `addDays` the way a reader expects:

```ts
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && TZ=Europe/Amsterdam npm run test:customer-portal
```

Expected: **PASS**, and that is the finding, not a failure. `setDate` is itself calendar-based, so
this particular wrong-looking implementation survives — while `new Date(date).getTime() + 86400000`
would not. **Now apply the second mutation** and run again:

```ts
export function addDays(date: string, days: number): string {
  const value = new Date(new Date(`${date}T00:00:00`).getTime() + days * 86_400_000);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
```

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && TZ=Europe/Amsterdam npm run test:customer-portal
```

Expected: **FAIL** — `steps ACROSS both DST transitions without landing on the same day twice`
reports `expected '2026-10-25' to be '2026-10-26'`: adding twenty-four hours to midnight on a
twenty-five-hour day lands at 23:00 on the same date. ⚠ Under `TZ=UTC` this mutation **passes** —
which is why the run above pins the zone. **Restore immediately.**

- [ ] **Step 10: Mutation check — the picker moves the selection while browsing**

In `day-picker.ts`, make `step` write the selection:

```ts
  protected step(months: number): void {
    const next = shiftMonth(this.visibleMonth(), months);
    this.browsing.set(next);
    this.value.set(`${next}-01`);
  }
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `steps the panel a month at a time WITHOUT changing the selection` reports
`expected '2026-09-01' to be '2026-08-12'`. **Restore immediately.**

- [ ] **Step 11: Mutation check — the padded neighbours**

In `consumption-calendar.ts`, fill the leading blanks from the previous month:

```ts
  for (let i = 0; i < lead; i++) {
    cells[i] = addDays(firstOfMonth(month), i - lead);
  }
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL**, twice —
`pads the leading and trailing cells with null rather than with a neighbouring month` reports
`expected [ '2026-07-27', … ] to deeply equal [ null, null, null, null, null, '2026-08-01', '2026-08-02' ]`,
and `renders every day of the month as a real button and no day of any other month` reports
`expected 36 to be 31`. **Restore immediately.**

- [ ] **Step 12: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/features/consumption/consumption-calendar.ts \
        apps/customer-portal/src/app/features/consumption/consumption-calendar.spec.ts \
        apps/customer-portal/src/app/features/consumption/day-picker.ts \
        apps/customer-portal/src/app/features/consumption/day-picker.spec.ts
git commit -m "feat(customer-portal): calendar arithmetic and the hand-rolled date picker

[F03-R07] is a Must and [OQ-49] is deferred by S2-D5, so nothing supplies a picker.

Every date step goes through UTC and back. Verified by mutation under
TZ=Europe/Amsterdam: adding 86 400 000 ms to midnight on 2026-10-25 lands at 23:00 on
the same date, because the autumn fall-back Sunday is twenty-five hours long — and that
day is this product's subject. Under TZ=UTC the same mutation passes, which is why the
mutation run pins the zone.

Also verified: browsing the panel must not move the selection, and padding the grid with
the neighbouring month's days gives a customer thirty-six clickable days in a
thirty-one-day month."
```

---

### Task 10: The metering-point selector

`[F03-R21]`, a **Must**: *"A metering point selector supports one, several, or all — with several
rendering the aggregate."*

⚠ **The selector guarantees at least one selection.** An empty `meteringPointIds` is a 400 from the
endpoint (task 6 refuses to spell it at all), so unchecking the last connection re-selects **all**
rather than leaving the screen asking a question the API cannot answer. That is a product decision
as much as a technical one: a chart of nothing with no explanation is worse than a chart of
everything.

⚠ **"All" is a state, not a shortcut.** When every connection is selected the control says so and
the heading reads "All connections" rather than listing eleven names — but the selection sent to
the API is still every id, because the endpoint takes ids and has no "all" spelling. Design §3.1:
*"one, several or all, with several summed server-side through the existing `meteringPointIds`
parameter."*

**Files:**
- Create: `apps/customer-portal/src/app/features/consumption/metering-point-selector.ts`
- Test: `apps/customer-portal/src/app/features/consumption/metering-point-selector.spec.ts`

**Interfaces:**
- Consumes: nothing beyond Angular. The component takes a plain shape rather than
  `ConnectionSummary`, so a regenerated client cannot break it.
- Produces:
  - `export interface PpSelectableConnection { readonly id: string; readonly label: string }`
  - `export class PpMeteringPointSelector` — selector `pp-metering-point-selector`,
    `connections = input.required<readonly PpSelectableConnection[]>()`,
    `selected = model<readonly string[]>([])`,
    DOM contract `.pp-mp-selector__summary`, `.pp-mp-selector__panel`, `.pp-mp-selector__all`,
    `.pp-mp-selector__option` (an `<input type="checkbox">` with `data-id`).

- [ ] **Step 1: Write the failing test**

Create `apps/customer-portal/src/app/features/consumption/metering-point-selector.spec.ts`:

```ts
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { PpMeteringPointSelector } from './metering-point-selector';
import type { PpSelectableConnection } from './metering-point-selector';

const CONNECTIONS: readonly PpSelectableConnection[] = [
  { id: 'mp-1', label: 'Rotterdam DC' },
  { id: 'mp-2', label: 'Almere office' },
  { id: 'mp-3', label: 'Venlo cold store' },
];

describe('PpMeteringPointSelector', () => {
  let fixture: ComponentFixture<PpMeteringPointSelector>;
  let host: HTMLElement;

  function render(selected: readonly string[] = ['mp-1']): void {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(PpMeteringPointSelector, { inferTagName: true });
    fixture.componentRef.setInput('connections', CONNECTIONS);
    fixture.componentRef.setInput('selected', selected);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  }

  const summary = () => host.querySelector('.pp-mp-selector__summary') as HTMLButtonElement;
  const optionFor = (id: string) =>
    host.querySelector(`.pp-mp-selector__option[data-id="${id}"]`) as HTMLInputElement;
  const allBox = () => host.querySelector('.pp-mp-selector__all') as HTMLInputElement;

  function open(): void {
    summary().click();
    fixture.detectChanges();
  }

  function toggle(el: HTMLInputElement, checked: boolean): void {
    el.checked = checked;
    el.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('names the one selected connection rather than counting it', () => {
    render(['mp-1']);

    expect(summary().textContent?.trim()).toBe('Rotterdam DC');
  });

  it('counts several, and says ALL when it is all of them', () => {
    // Three assertions, three different renderings, and none of them is the default: a component
    // that hardcoded any one of the three would pass a spec that only tested another.
    render(['mp-1', 'mp-2']);
    expect(summary().textContent?.trim()).toBe('2 of 3 connections');

    render(['mp-1', 'mp-2', 'mp-3']);
    expect(summary().textContent?.trim()).toBe('All connections');
  });

  it('adds and removes one connection at a time', () => {
    render(['mp-1']);
    open();

    toggle(optionFor('mp-2'), true);
    expect([...fixture.componentInstance.selected()].sort()).toEqual(['mp-1', 'mp-2']);

    toggle(optionFor('mp-1'), false);
    expect([...fixture.componentInstance.selected()]).toEqual(['mp-2']);
  });

  it('re-selects EVERYTHING rather than leaving nothing selected', () => {
    // An empty meteringPointIds is a 400, and the client refuses to spell it — so the last
    // uncheck cannot be allowed to produce one. A chart of nothing with no explanation is worse
    // than a chart of everything.
    render(['mp-2']);
    open();

    toggle(optionFor('mp-2'), false);

    expect([...fixture.componentInstance.selected()].sort()).toEqual(['mp-1', 'mp-2', 'mp-3']);
    expect(summary().textContent?.trim()).toBe('All connections');
  });

  it('selects every connection from the All control, and keeps every id in the selection', () => {
    // "All" is a STATE, not a shortcut: the endpoint takes ids and has no "all" spelling, so the
    // selection stays every id and the aggregate is summed server-side.
    render(['mp-1']);
    open();

    toggle(allBox(), true);

    expect([...fixture.componentInstance.selected()].sort()).toEqual(['mp-1', 'mp-2', 'mp-3']);
  });

  it('checks the All control exactly when every connection is selected', () => {
    render(['mp-1', 'mp-2']);
    open();
    expect(allBox().checked).toBe(false);

    render(['mp-1', 'mp-2', 'mp-3']);
    open();
    expect(allBox().checked).toBe(true);
  });

  it('keeps the selection in the connections order, whatever order it arrives in', () => {
    // The order reaches the URL and the request. Two identical selections spelled in two orders
    // are two cache keys and two URLs for one screen.
    render(['mp-3', 'mp-1']);
    open();

    toggle(optionFor('mp-2'), true);

    expect([...fixture.componentInstance.selected()]).toEqual(['mp-1', 'mp-2', 'mp-3']);
  });

  it('gives every checkbox a label a screen reader can read', () => {
    render();
    open();

    const label = host.querySelector(`label[for="${optionFor('mp-2').id}"]`);
    expect(label?.textContent?.trim()).toBe('Almere office');
    expect(allBox().type).toBe('checkbox');
  });

  it('renders no panel until it is opened, and says so', () => {
    render();

    expect(host.querySelector('.pp-mp-selector__panel')).toBeNull();
    expect(summary().getAttribute('aria-expanded')).toBe('false');
    open();
    expect(host.querySelector('.pp-mp-selector__panel')).not.toBeNull();
    expect(summary().getAttribute('aria-expanded')).toBe('true');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: FAIL — `Failed to resolve import "./metering-point-selector" …`

- [ ] **Step 3: Write the component**

Create `apps/customer-portal/src/app/features/consumption/metering-point-selector.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';

/** What the selector needs of a connection, and nothing more. */
export interface PpSelectableConnection {
  readonly id: string;
  readonly label: string;
}

/**
 * [F03-R21]: one, several, or all — with several rendering the aggregate.
 *
 * It takes a plain `{ id, label }` rather than `ConnectionSummary`, so a regenerated client cannot
 * break it and a spec needs no fixture from the generated schema.
 *
 * ⚠ The selection is never empty. An empty `meteringPointIds` is a 400 and `CustomerApiClient`
 * refuses to spell one, so unchecking the last connection re-selects ALL. A chart of nothing with
 * no explanation is worse than a chart of everything.
 *
 * ⚠ "All" is a STATE, not a shortcut. The endpoint takes ids and has no "all" spelling, so the
 * selection stays every id and the aggregate is summed server-side.
 */
@Component({
  selector: 'pp-metering-point-selector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp-mp-selector">
      <button
        type="button"
        class="pp-mp-selector__summary"
        [attr.aria-expanded]="open()"
        aria-haspopup="true"
        (click)="open.set(!open())"
      >{{ summary() }}</button>

      @if (open()) {
        <div class="pp-mp-selector__panel" role="group" aria-label="Connections">
          <label class="pp-mp-selector__row">
            <input
              class="pp-mp-selector__all"
              type="checkbox"
              [checked]="allSelected()"
              (change)="selectAll()"
            />
            <span>All connections</span>
          </label>
          <div class="pp-mp-selector__rule"></div>
          @for (connection of connections(); track connection.id) {
            <label class="pp-mp-selector__row" [attr.for]="idFor(connection.id)">
              <input
                class="pp-mp-selector__option"
                type="checkbox"
                [id]="idFor(connection.id)"
                [attr.data-id]="connection.id"
                [checked]="isSelected(connection.id)"
                (change)="toggle(connection.id, $event)"
              />
              <span>{{ connection.label }}</span>
            </label>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .pp-mp-selector { position: relative; display: inline-block; }
    .pp-mp-selector__summary {
      font: inherit; font-size: 12px; font-weight: 600; padding: 7px 12px;
      border: 1px solid var(--pp-border-strong); border-radius: var(--radius-md);
      background: var(--pp-surface); color: var(--pp-text-heading); cursor: pointer;
      min-width: 168px; text-align: left;
    }
    .pp-mp-selector__summary:hover { border-color: var(--pp-blue-500); }
    .pp-mp-selector__summary:focus-visible {
      outline: 2px solid var(--pp-blue-300); outline-offset: 2px;
    }
    .pp-mp-selector__panel {
      position: absolute; z-index: 20; top: calc(100% + 6px); left: 0; min-width: 240px;
      padding: 8px; border: 1px solid var(--pp-border-strong); border-radius: var(--radius-lg);
      background: var(--pp-surface); box-shadow: var(--pp-shadow-card);
    }
    .pp-mp-selector__row {
      display: flex; align-items: center; gap: 8px; padding: 5px 4px;
      font-size: 12px; color: var(--pp-text-heading); cursor: pointer;
    }
    .pp-mp-selector__rule { height: 1px; margin: 6px 0; background: var(--pp-border); }
  `,
})
export class PpMeteringPointSelector {
  readonly connections = input.required<readonly PpSelectableConnection[]>();
  readonly selected = model<readonly string[]>([]);

  protected readonly open = signal(false);

  private readonly selectedSet = computed(() => new Set(this.selected()));

  protected readonly allSelected = computed(
    () =>
      this.connections().length > 0 && this.selectedSet().size === this.connections().length,
  );

  protected readonly summary = computed(() => {
    const total = this.connections().length;
    const chosen = this.connections().filter((c) => this.selectedSet().has(c.id));
    if (chosen.length === 0) return 'No connections';
    if (chosen.length === 1) return chosen[0].label;
    if (chosen.length === total) return 'All connections';
    return `${chosen.length} of ${total} connections`;
  });

  protected idFor(id: string): string {
    return `pp-mp-${id}`;
  }

  protected isSelected(id: string): boolean {
    return this.selectedSet().has(id);
  }

  protected selectAll(): void {
    this.write(this.connections().map((c) => c.id));
  }

  protected toggle(id: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.selected());
    if (checked) next.add(id);
    else next.delete(id);
    // ⚠ Never empty. The endpoint answers 400 and the client will not build the request.
    this.write(next.size === 0 ? this.connections().map((c) => c.id) : [...next]);
  }

  /**
   * Writes the selection in the CONNECTIONS' own order.
   *
   * The order reaches the URL and the request, so two identical selections spelled in two orders
   * would be two URLs and two cache entries for one screen.
   */
  private write(ids: readonly string[]): void {
    const wanted = new Set(ids);
    this.selected.set(this.connections().filter((c) => wanted.has(c.id)).map((c) => c.id));
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: PASS.

- [ ] **Step 5: Mutation check — the empty selection**

In `metering-point-selector.ts`, let the last uncheck through:

```ts
    this.write([...next]);
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `re-selects EVERYTHING rather than leaving nothing selected` reports
`expected [] to deeply equal [ 'mp-1', 'mp-2', 'mp-3' ]`. Predicted before running: `adds and
removes one connection at a time` stays green, because it never removes the last one — which is
why the empty case has a fixture of its own. **Restore immediately.**

- [ ] **Step 6: Mutation check — the selection order**

In `metering-point-selector.ts`, write the ids as given:

```ts
  private write(ids: readonly string[]): void {
    this.selected.set([...ids]);
  }
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `keeps the selection in the connections order, whatever order it arrives in`
reports `expected [ 'mp-3', 'mp-1', 'mp-2' ] to deeply equal [ 'mp-1', 'mp-2', 'mp-3' ]`.
**Restore immediately.**

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/features/consumption/metering-point-selector.ts \
        apps/customer-portal/src/app/features/consumption/metering-point-selector.spec.ts
git commit -m "feat(customer-portal): the metering-point selector

[F03-R21]: one, several or all, with several summed server-side. Verified by mutation
that unchecking the last connection re-selects all rather than producing the empty
meteringPointIds the endpoint answers 400 for, and that the selection is written in the
connections' order so one screen has one URL."
```

---

### Task 11: The `/consumption` screen

The screen that puts the two charts, the navigation and the five treatments together, replacing the
placeholder task 7 landed.

**Everything on it is one URL.** `?view=day|month`, `?date=yyyy-MM-dd`, `?month=yyyy-MM`,
`?points=id,id`. A link is shareable, the browser's back button works through a month-bar drill-in,
and there is no second copy of the screen's state in a service.

⚠ **The URL is not written on first load.** With no `date` the screen derives one — the latest
`lastDataDate` across the customer's connections — and renders it; the first interaction writes the
full state. A redirect on mount would cost a navigation, a spec, and a back-button entry, for a
shareable link before the customer has done anything worth sharing.

⚠ **`selectedIds` is filtered against the connections the customer actually holds.** A bookmark
naming a metering point they have since given up would otherwise send an id the endpoint answers
**404, not 403** for `[F13-R19]` — and a 404 is the one answer this screen cannot explain, because
the server deliberately refused to say whether the row exists.

**The five treatments, and where each one lives:**

| Treatment | Where |
| --- | --- |
| **gap** | inside `PpUsageChart` — a break in the path, never a zero |
| **partial** | the chart's amber hatch, and every KPI's sublabel |
| **provisional** | the same, with a different word — measured, not accepted |
| **corrected-on** | the chart's violet marker, and `correctedOnLine` under it |
| **declared zero** | `declaredZeroLine` under the chart, naming the source, the setter and the date `[F02-R33]` / `[F01-R40]` |

⚠ **The empty state replaces the chart, it does not sit beside it.** Design §7.18: *"the empty
state renders when the range holds no data"*. A chart with an axis, a zero line and nothing on it,
under a banner explaining why, reads as a broken chart.

**Files:**
- Modify: `apps/customer-portal/src/app/features/consumption/consumption-page.ts` (replaced wholesale)
- Test: `apps/customer-portal/src/app/features/consumption/consumption-page.spec.ts`

**Interfaces:**
- Consumes: `CustomerApiClient.getConsumptionDay` / `.getConsumptionMonth` / `.listConnections`
  (task 6); `toUsageDay`, `toUsageMonth`, `formatMwh` (task 8); every constant and function of
  `consumption-copy.ts` (task 8); `addDays`, `monthOf`, `shiftMonth` (task 9);
  `PpDayPicker` (task 9); `PpMeteringPointSelector` (task 10); `PpUsageChart`,
  `PpUsageMonthChart`, `PpCard`, `PpStatCard`, `PpBadge`, `PpButton` from `@peakpower-nl/shared-ui`;
  `PpLoadError` from `apps/customer-portal/src/app/shared/load-error.ts`.
- Produces: `export class ConsumptionPage`, and the DOM contract its spec pins:
  `h1`, `.consumption__nav`, `.consumption__prev`, `.consumption__next`, `.consumption__jump`,
  `.consumption__tab` (with `data-view`), `.consumption__kpis`, `.consumption__empty`,
  `.consumption__declared`, `.consumption__corrected`.

- [ ] **Step 1: Write the failing test**

Create `apps/customer-portal/src/app/features/consumption/consumption-page.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import type { Params } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { provideCustomerApiTesting } from '@peakpower-nl/api-client-customer';
import type { ConnectionSummary } from '@peakpower-nl/api-client-customer';

import { ConsumptionPage } from './consumption-page';

const CONNECTIONS_URL = '/api/v1/metering-points';
const DAY_URL = '/api/v1/consumption/day';
const MONTH_URL = '/api/v1/consumption/month';

function connection(over: Partial<ConnectionSummary> = {}): ConnectionSummary {
  return {
    id: 'mp-1',
    ean: '871687100000000011',
    eanDisplay: '8716 8710 0000 0000 11',
    displayLabel: 'Rotterdam DC',
    name: 'Rotterdam DC',
    description: null,
    commodity: 'ELECTRICITY',
    status: 'ACTIVE',
    gridOperator: 'Stedin',
    capacityKw: 4200,
    city: 'Rotterdam',
    validFrom: '2024-01-01',
    validTo: null,
    lastDataDate: '2026-08-14',
    ...over,
  };
}

function dayEnvelope(over: Record<string, unknown> = {}): unknown {
  return {
    date: '2026-08-12',
    meteringPointIds: ['mp-1'],
    intervalCount: 96,
    dataState: 'PROVISIONAL',
    lastDataDate: '2026-08-14',
    lastCorrectedAt: null,
    productionIsDeclaredZero: false,
    productionDeclaration: null,
    intervals: [
      {
        pos: 1,
        start: '2026-08-12T00:00:00+02:00',
        end: '2026-08-12T00:15:00+02:00',
        dstPass: null,
        consumptionKwh: 180,
        productionKwh: 0,
        netUsageKwh: 180,
      },
    ],
    summary: { consumptionKwh: 11420, productionKwh: 0, netUsageKwh: 11420, dataState: 'PROVISIONAL' },
    ...over,
  };
}

function monthEnvelope(over: Record<string, unknown> = {}): unknown {
  return {
    month: '2026-08',
    meteringPointIds: ['mp-1'],
    dayCount: 2,
    dataState: 'PARTIAL',
    lastDataDate: '2026-08-01',
    days: [
      { date: '2026-08-01', intervalCount: 96, dataState: 'FINAL', consumptionKwh: 11420, productionKwh: 0, netUsageKwh: 11420 },
      { date: '2026-08-02', intervalCount: 96, dataState: 'NO_DATA', consumptionKwh: null, productionKwh: null, netUsageKwh: null },
    ],
    summary: { consumptionKwh: 11420, productionKwh: 0, netUsageKwh: 11420, dataState: 'PARTIAL' },
    ...over,
  };
}

describe('ConsumptionPage', () => {
  let fixture: ComponentFixture<ConsumptionPage>;
  let http: HttpTestingController;
  let root: HTMLElement;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let navigations: { commands: unknown[]; extras: { queryParams?: Params } }[];

  function render(query: Params = {}): void {
    params = new BehaviorSubject(convertToParamMap(query));
    navigations = [];
    TestBed.configureTestingModule({
      providers: [
        provideCustomerApiTesting(),
        { provide: ActivatedRoute, useValue: { queryParamMap: params } },
        {
          provide: Router,
          useValue: {
            navigate: (commands: unknown[], extras: { queryParams?: Params }) => {
              navigations.push({ commands, extras });
              // The real router would emit new params; do the same so the screen reacts.
              params.next(convertToParamMap({ ...query, ...(extras.queryParams ?? {}) }));
              return Promise.resolve(true);
            },
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ConsumptionPage, { inferTagName: true });
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  }

  /** Answers the connections request every render issues. */
  function arriveWithConnections(items: ConnectionSummary[] = [connection()]): void {
    http.expectOne(CONNECTIONS_URL).flush({ items, total: items.length });
    fixture.detectChanges();
  }

  function flushDay(body: unknown = dayEnvelope()): void {
    http.expectOne((r) => r.url === DAY_URL).flush(body);
    fixture.detectChanges();
  }

  function flushMonth(body: unknown = monthEnvelope()): void {
    http.expectOne((r) => r.url === MONTH_URL).flush(body);
    fixture.detectChanges();
  }

  afterEach(() => {
    try {
      http.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  const kpi = (label: string): HTMLElement => {
    const cards = [...root.querySelectorAll('.consumption__kpis pp-stat-card')];
    const card = cards.find(
      (c) => c.querySelector('.pp-stat-card__label')?.textContent?.trim() === label.toUpperCase(),
    );
    if (card === undefined) throw new Error(`no "${label}" stat card`);
    return card as HTMLElement;
  };
  const kpiValue = (label: string) =>
    kpi(label).querySelector('.pp-stat-card__value')?.textContent?.trim();
  const kpiSub = (label: string) =>
    kpi(label).querySelector('.pp-stat-card__sublabel')?.textContent?.trim();
  const lastQuery = () => navigations[navigations.length - 1].extras.queryParams;

  // ── what it asks for ──────────────────────────────────────────────────────

  it('asks for the day named in the URL, for the connections named in the URL', () => {
    render({ date: '2026-08-12', points: 'mp-1,mp-2' });
    arriveWithConnections([connection(), connection({ id: 'mp-2', displayLabel: 'Almere' })]);

    const request = http.expectOne((r) => r.url === DAY_URL);
    expect(request.request.params.get('date')).toBe('2026-08-12');
    expect(request.request.params.getAll('meteringPointIds')).toEqual(['mp-1', 'mp-2']);
    request.flush(dayEnvelope());
  });

  it('falls back to the latest day the connections report when the URL names none', () => {
    // [F03-R07]'s "jump to the most recent day with data", applied as the landing state: arriving
    // on an empty URL shows the newest day rather than today, which on most mornings has nothing.
    render({});
    arriveWithConnections([
      connection({ id: 'mp-1', lastDataDate: '2026-08-11' }),
      connection({ id: 'mp-2', lastDataDate: '2026-08-14' }),
    ]);

    const request = http.expectOne((r) => r.url === DAY_URL);
    expect(request.request.params.get('date')).toBe('2026-08-14');
    request.flush(dayEnvelope());
  });

  it('asks for every connection when the URL names none', () => {
    render({ date: '2026-08-12' });
    arriveWithConnections([connection(), connection({ id: 'mp-2', displayLabel: 'Almere' })]);

    const request = http.expectOne((r) => r.url === DAY_URL);
    expect(request.request.params.getAll('meteringPointIds')).toEqual(['mp-1', 'mp-2']);
    request.flush(dayEnvelope());
  });

  it('ignores a metering point the customer no longer holds', () => {
    // A stale bookmark. That id answers 404-not-403 [F13-R19], and a 404 is the one failure this
    // screen cannot explain — the server deliberately refused to say whether the row exists.
    render({ date: '2026-08-12', points: 'mp-1,mp-gone' });
    arriveWithConnections([connection()]);

    const request = http.expectOne((r) => r.url === DAY_URL);
    expect(request.request.params.getAll('meteringPointIds')).toEqual(['mp-1']);
    request.flush(dayEnvelope());
  });

  it('asks for nothing at all while the customer holds no connections', () => {
    render({ date: '2026-08-12' });
    arriveWithConnections([]);

    http.expectNone((r) => r.url === DAY_URL);
    expect(root.textContent).toContain('You have no connections yet');
  });

  // ── the chart, and the five treatments ────────────────────────────────────

  it('hands the chart the envelope unchanged, sparse intervals and all', () => {
    render({ date: '2026-08-12' });
    arriveWithConnections();
    flushDay();

    const chart = root.querySelector('pp-usage-chart');
    expect(chart).not.toBeNull();
    // One measured interval on a 96-slot axis: the chart draws the other 95 as gaps.
    expect(root.querySelectorAll('.pp-usage-chart__series--net')).toHaveLength(0);
    expect(root.querySelectorAll('.pp-usage-chart__dot--net')).toHaveLength(1);
  });

  it('labels every KPI with its range data state', () => {
    // Design §7.18 and [F03-R20]: every KPI carries the data state of its range.
    render({ date: '2026-08-12' });
    arriveWithConnections();
    flushDay();

    expect(kpiValue('Consumption')).toBe('11,4 MWh');
    expect(kpiValue('Production')).toBe('0,0 MWh');
    expect(kpiValue('Net usage')).toBe('11,4 MWh');
    for (const label of ['Consumption', 'Production', 'Net usage']) {
      expect(kpiSub(label)).toContain('Provisional');
      expect(kpiSub(label)).toContain('measured');
      expect(kpiSub(label)?.toLowerCase()).not.toContain('projected');
    }
  });

  it('carries a NON-provisional state through too, so the label is not hardcoded', () => {
    render({ date: '2026-08-12' });
    arriveWithConnections();
    flushDay(
      dayEnvelope({
        dataState: 'FINAL',
        summary: { consumptionKwh: 9000, productionKwh: 500, netUsageKwh: 8500, dataState: 'FINAL' },
      }),
    );

    expect(kpiSub('Net usage')).toContain('Final');
    expect(kpiValue('Net usage')).toBe('8,5 MWh');
  });

  it('states a declared zero with its source, its setter and its date', () => {
    // [F02-R33] with [F01-R40] — the fifth treatment, and the one most likely to be skipped.
    render({ date: '2026-08-12' });
    arriveWithConnections();
    flushDay(
      dayEnvelope({
        productionIsDeclaredZero: true,
        productionDeclaration: {
          expectation: 'NEVER',
          source: 'CUSTOMER_DECLARED',
          setBy: 'p.devries@vandersteen.nl',
          setAt: '2026-07-01T08:14:00Z',
        },
      }),
    );

    const line = root.querySelector('.consumption__declared')?.textContent;
    expect(line).toContain('declared by you');
    expect(line).toContain('p.devries@vandersteen.nl');
    expect(line).toContain('1 jul 2026');
  });

  it('says nothing about a declared zero on a connection that produces', () => {
    render({ date: '2026-08-12' });
    arriveWithConnections();
    flushDay();

    expect(root.querySelector('.consumption__declared')).toBeNull();
  });

  it('names the moment a correction landed', () => {
    render({ date: '2026-08-12' });
    arriveWithConnections();
    flushDay(dayEnvelope({ lastCorrectedAt: '2026-08-13T09:22:41Z' }));

    expect(root.querySelector('.consumption__corrected')?.textContent).toContain(
      '13 aug 2026, 11:22',
    );
  });

  it('replaces the chart with the empty state when the range holds no data', () => {
    // Design §7.18. A chart with an axis and nothing on it, under a banner explaining why, reads
    // as a broken chart rather than as an empty one.
    render({ date: '2026-08-12' });
    arriveWithConnections();
    flushDay(
      dayEnvelope({
        dataState: 'NO_DATA',
        intervals: [],
        summary: { consumptionKwh: 0, productionKwh: 0, netUsageKwh: 0, dataState: 'NO_DATA' },
      }),
    );

    expect(root.querySelector('pp-usage-chart')).toBeNull();
    expect(root.querySelector('.consumption__empty')?.textContent).toContain(
      'No data for this day yet',
    );
  });

  it('says the whole screen failed rather than showing an empty chart', () => {
    render({ date: '2026-08-12' });
    arriveWithConnections();
    http.expectOne((r) => r.url === DAY_URL).flush({}, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(root.querySelector('pp-load-error')).not.toBeNull();
    expect(root.textContent).toContain('We could not load your consumption');
  });

  // ── navigation [F03-R07] ──────────────────────────────────────────────────

  it('steps to the previous and the next day', () => {
    render({ date: '2026-08-12' });
    arriveWithConnections();
    flushDay();

    (root.querySelector('.consumption__prev') as HTMLButtonElement).click();
    expect(lastQuery()).toMatchObject({ date: '2026-08-11' });
    http.expectOne((r) => r.url === DAY_URL).flush(dayEnvelope({ date: '2026-08-11' }));
    fixture.detectChanges();

    (root.querySelector('.consumption__next') as HTMLButtonElement).click();
    expect(lastQuery()).toMatchObject({ date: '2026-08-12' });
    http.expectOne((r) => r.url === DAY_URL).flush(dayEnvelope());
    fixture.detectChanges();
  });

  it('crosses a month boundary rather than clamping inside one', () => {
    render({ date: '2026-09-01' });
    arriveWithConnections();
    flushDay(dayEnvelope({ date: '2026-09-01' }));

    (root.querySelector('.consumption__prev') as HTMLButtonElement).click();

    expect(lastQuery()).toMatchObject({ date: '2026-08-31' });
    http.expectOne((r) => r.url === DAY_URL).flush(dayEnvelope({ date: '2026-08-31' }));
    fixture.detectChanges();
  });

  it('jumps to the most recent day with data, and offers nothing to jump to when it is showing it', () => {
    render({ date: '2026-08-12' });
    arriveWithConnections();
    flushDay();

    const jump = root.querySelector('.consumption__jump') as HTMLButtonElement;
    expect(jump.disabled).toBe(false);
    jump.click();

    expect(lastQuery()).toMatchObject({ date: '2026-08-14' });
    http.expectOne((r) => r.url === DAY_URL).flush(dayEnvelope({ date: '2026-08-14' }));
    fixture.detectChanges();

    expect((root.querySelector('.consumption__jump') as HTMLButtonElement).disabled).toBe(true);
  });

  it('writes the picked date to the URL', () => {
    render({ date: '2026-08-12' });
    arriveWithConnections();
    flushDay();

    (root.querySelector('.pp-day-picker__trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    (root.querySelector('.pp-day-picker__day[data-date="2026-08-05"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(lastQuery()).toMatchObject({ date: '2026-08-05' });
    http.expectOne((r) => r.url === DAY_URL).flush(dayEnvelope({ date: '2026-08-05' }));
    fixture.detectChanges();
  });

  it('writes the selection to the URL, so a link carries it', () => {
    render({ date: '2026-08-12' });
    arriveWithConnections([connection(), connection({ id: 'mp-2', displayLabel: 'Almere' })]);
    flushDay();

    (root.querySelector('.pp-mp-selector__summary') as HTMLButtonElement).click();
    fixture.detectChanges();
    const box = root.querySelector('.pp-mp-selector__option[data-id="mp-2"]') as HTMLInputElement;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(lastQuery()).toMatchObject({ points: 'mp-1' });
    http.expectOne((r) => r.url === DAY_URL).flush(dayEnvelope());
    fixture.detectChanges();
  });

  // ── the month view and the drill-in ───────────────────────────────────────

  it('asks for the month when the URL says month', () => {
    render({ view: 'month', month: '2026-08' });
    arriveWithConnections();

    const request = http.expectOne((r) => r.url === MONTH_URL);
    expect(request.request.params.get('month')).toBe('2026-08');
    request.flush(monthEnvelope());
    fixture.detectChanges();

    expect(root.querySelector('pp-usage-month-chart')).not.toBeNull();
    expect(root.querySelector('pp-usage-chart')).toBeNull();
  });

  it('takes the month from the day when the URL names only a day', () => {
    render({ date: '2026-08-12' });
    arriveWithConnections();
    flushDay();

    (root.querySelector('.consumption__tab[data-view="month"]') as HTMLButtonElement).click();

    expect(lastQuery()).toMatchObject({ view: 'month', month: '2026-08' });
    http.expectOne((r) => r.url === MONTH_URL).flush(monthEnvelope());
    fixture.detectChanges();
  });

  it('drills a month bar into that DAY, and switches back to the day view', () => {
    // [F03-R09]. The date comes from the chart's semantic event; the page never reads a pixel.
    render({ view: 'month', month: '2026-08' });
    arriveWithConnections();
    flushMonth();

    (
      root.querySelector('.pp-usage-month-chart__day[data-date="2026-08-01"]') as SVGGElement
    ).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(lastQuery()).toMatchObject({ view: 'day', date: '2026-08-01' });
    http.expectOne((r) => r.url === DAY_URL).flush(dayEnvelope({ date: '2026-08-01' }));
    fixture.detectChanges();
  });

  it('renders the month empty state when the whole month holds nothing', () => {
    render({ view: 'month', month: '2026-08' });
    arriveWithConnections();
    flushMonth(
      monthEnvelope({
        dataState: 'NO_DATA',
        summary: { consumptionKwh: 0, productionKwh: 0, netUsageKwh: 0, dataState: 'NO_DATA' },
      }),
    );

    expect(root.querySelector('pp-usage-month-chart')).toBeNull();
    expect(root.querySelector('.consumption__empty')?.textContent).toContain(
      'No data for this month yet',
    );
  });

  // ── the screen itself ─────────────────────────────────────────────────────

  it('carries exactly one page heading, and declares no main of its own', () => {
    // app.ts owns the single <main id="pp-main">; a routed page adding one gives the document two
    // landmarks and makes the skip link's target depend on which route is showing.
    render({ date: '2026-08-12' });
    arriveWithConnections();
    flushDay();

    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Volume');
    expect(root.querySelector('main')).toBeNull();
  });

  it('shows no price, no euro and no block anywhere on the screen', () => {
    // S2-D6 and design §3.2, asserted on the rendered screen rather than only on the components.
    render({ date: '2026-08-12' });
    arriveWithConnections();
    flushDay();

    expect(root.textContent).not.toContain('€');
    expect(root.textContent?.toLowerCase()).not.toContain('block');
    expect(root.textContent?.toLowerCase()).not.toContain('coverage');
    expect(root.textContent?.toLowerCase()).not.toContain('hedge');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: FAIL — the placeholder renders none of it; the first failure is
`Expected one matching request for criteria "Match URL: /api/v1/metering-points", found none.`

- [ ] **Step 3: Write the screen**

Replace `apps/customer-portal/src/app/features/consumption/consumption-page.ts` entirely:

```ts
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { Params } from '@angular/router';
import { catchError, distinctUntilChanged, of, switchMap } from 'rxjs';
import { CustomerApiClient } from '@peakpower-nl/api-client-customer';
import type {
  ConnectionListResponse,
  ConsumptionDay,
  ConsumptionMonth,
} from '@peakpower-nl/api-client-customer';
import {
  PpBadge,
  PpButton,
  PpCard,
  PpStatCard,
  PpUsageChart,
  PpUsageMonthChart,
  formatDutchDate,
} from '@peakpower-nl/shared-ui';

import { PpLoadError } from '../../shared/load-error';
import { addDays, monthLabel, monthOf, shiftMonth } from './consumption-calendar';
import {
  DATA_STATE_LABEL,
  DATA_STATE_NOTE,
  DATA_STATE_TONE,
  EMPTY_DAY_BODY,
  EMPTY_DAY_HEADING,
  EMPTY_MONTH_BODY,
  EMPTY_MONTH_HEADING,
  KPI_CONSUMPTION,
  KPI_NET_USAGE,
  KPI_PRODUCTION,
  correctedOnLine,
  declaredZeroLine,
} from './consumption-copy';
import { formatMwh, toDataState, toUsageDay, toUsageMonth } from './consumption-envelope';
import { PpDayPicker } from './day-picker';
import { PpMeteringPointSelector } from './metering-point-selector';
import type { PpSelectableConnection } from './metering-point-selector';

const NO_CONNECTIONS: ConnectionListResponse = { items: [], total: 0 };

/** The request key both fetches deduplicate on. Two identical keys are one request. */
function keyOf(request: { readonly range: string; readonly ids: readonly string[] } | null): string {
  return request === null ? '' : `${request.range}|${request.ids.join(',')}`;
}

/**
 * `/consumption` — [F03]'s day and month views.
 *
 * EVERYTHING on this screen is one URL: `?view=day|month`, `?date=yyyy-MM-dd`, `?month=yyyy-MM`,
 * `?points=id,id`. A link is shareable, the back button works through a month-bar drill-in, and
 * there is no second copy of the screen's state in a service.
 *
 * ⚠ The URL is not written on FIRST load. With no `date` the screen derives one — the latest
 * `lastDataDate` across the customer's connections — and renders it; the first interaction writes
 * the full state. A redirect on mount would cost a navigation and a back-button entry for a
 * shareable link before the customer has done anything worth sharing.
 */
@Component({
  selector: 'pp-consumption-page',
  imports: [
    PpBadge,
    PpButton,
    PpCard,
    PpStatCard,
    PpUsageChart,
    PpUsageMonthChart,
    PpDayPicker,
    PpMeteringPointSelector,
    PpLoadError,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="consumption">
      <div class="consumption__head">
        <div>
          <h1>Volume</h1>
          <p class="consumption__sub">{{ subtitle() }}</p>
        </div>
        <div class="consumption__tabs" role="group" aria-label="Range">
          <button
            type="button" class="consumption__tab" data-view="day"
            [class.consumption__tab--on]="view() === 'day'"
            [attr.aria-pressed]="view() === 'day'"
            (click)="showDay()"
          >Day</button>
          <button
            type="button" class="consumption__tab" data-view="month"
            [class.consumption__tab--on]="view() === 'month'"
            [attr.aria-pressed]="view() === 'month'"
            (click)="showMonth()"
          >Month</button>
        </div>
      </div>

      @if (options().length === 0) {
        <pp-card [headingLevel]="2" heading="No connections">
          <p class="consumption__empty">
            You have no connections yet. Claim one from the shared pool and your consumption
            appears here.
          </p>
        </pp-card>
      } @else {
        <div class="consumption__nav">
          @if (view() === 'day') {
            <pp-button class="consumption__prev-wrap" variant="secondary" size="sm"
              (click)="stepDay(-1)">
              <span class="consumption__prev-label">Previous day</span>
            </pp-button>
            <pp-day-picker [value]="pickerDate()" (valueChange)="pickDate($event)" />
            <pp-button variant="secondary" size="sm" (click)="stepDay(1)">Next day</pp-button>
          } @else {
            <pp-button variant="secondary" size="sm" (click)="stepMonth(-1)">Previous month</pp-button>
            <span class="consumption__month">{{ monthTitle() }}</span>
            <pp-button variant="secondary" size="sm" (click)="stepMonth(1)">Next month</pp-button>
          }

          <button
            type="button" class="consumption__jump"
            [disabled]="!canJump()"
            (click)="jumpToLatest()"
          >Jump to latest data</button>

          <pp-metering-point-selector
            [connections]="options()"
            [selected]="selectedIds()"
            (selectedChange)="pickPoints($event)"
          />
        </div>

        @if (loadError(); as failure) {
          <pp-load-error what="your consumption" [error]="failure" />
        } @else {
          <div class="consumption__kpis">
            <pp-stat-card
              [label]="kpiConsumption" [value]="consumptionTotal()"
              [sublabel]="stateNote()" [tone]="stateTone()"
            />
            <pp-stat-card
              [label]="kpiProduction" [value]="productionTotal()"
              [sublabel]="stateNote()" [tone]="stateTone()"
            />
            <pp-stat-card
              [label]="kpiNetUsage" [value]="netUsageTotal()"
              [sublabel]="stateNote()" [tone]="stateTone()"
            />
          </div>

          @if (isEmptyRange()) {
            <pp-card [headingLevel]="2" [heading]="emptyHeading()">
              <p class="consumption__empty">{{ emptyBody() }}</p>
            </pp-card>
          } @else if (view() === 'day') {
            @if (usageDay(); as day) {
              <pp-card [headingLevel]="2" [heading]="dayHeading()">
                <pp-badge ppCardAction [tone]="stateTone()">{{ stateLabel() }}</pp-badge>
                <pp-usage-chart [day]="day" [(hoveredPos)]="hoveredPos" />
                @if (day.productionIsDeclaredZero) {
                  <p class="consumption__declared">{{ declaredZero() }}</p>
                }
                @if (day.lastCorrectedAt; as at) {
                  <p class="consumption__corrected">{{ corrected(at) }}</p>
                }
              </pp-card>
            }
          } @else if (usageMonth(); as month) {
            <pp-card [headingLevel]="2" [heading]="monthHeading()">
              <pp-badge ppCardAction [tone]="stateTone()">{{ stateLabel() }}</pp-badge>
              <pp-usage-month-chart
                [month]="month"
                [(hoveredDate)]="hoveredDate"
                (daySelected)="openDay($event)"
              />
              <p class="consumption__hint">Click a day for its fifteen-minute detail.</p>
            </pp-card>
          }
        }
      }
    </div>
  `,
  styles: `
    .consumption { display: flex; flex-direction: column; gap: 16px; }
    .consumption__head {
      display: flex; align-items: flex-end; justify-content: space-between; gap: 16px;
    }
    h1 { margin: 0; font-size: var(--text-lg); font-weight: var(--weight-bold); }
    .consumption__sub { margin: 0; font-size: var(--text-xs); color: var(--pp-text-body); }
    .consumption__tabs { display: flex; gap: 4px; }
    .consumption__tab {
      font: inherit; font-size: 12px; font-weight: 600; padding: 6px 14px;
      border: 1px solid var(--pp-border-strong); border-radius: var(--radius-pill);
      background: var(--pp-surface); color: var(--pp-text-body); cursor: pointer;
    }
    .consumption__tab--on {
      background: var(--pp-blue-700); border-color: var(--pp-blue-700); color: #fff;
    }
    .consumption__nav { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .consumption__month {
      font-size: 12px; font-weight: var(--weight-bold); color: var(--pp-text-heading);
      min-width: 118px; text-align: center;
    }
    .consumption__jump {
      font: inherit; font-size: 12px; font-weight: 600; padding: 7px 12px;
      border: 1px solid var(--pp-border-strong); border-radius: var(--radius-md);
      background: var(--pp-surface); color: var(--pp-blue-500); cursor: pointer;
    }
    .consumption__jump:disabled { color: var(--pp-text-faint); cursor: default; }
    .consumption__kpis { display: flex; gap: 16px; flex-wrap: wrap; }
    .consumption__kpis pp-stat-card { flex: 1 1 200px; }
    /* The canvas's one empty-state treatment: centred, faint, 22px 10px inside its card. */
    .consumption__empty {
      margin: 0; padding: 22px 10px; text-align: center; font-size: 12.5px; line-height: 1.5;
      color: var(--pp-text-faint);
    }
    .consumption__declared, .consumption__corrected, .consumption__hint {
      margin: 12px 0 0; font-size: var(--text-xs); line-height: 1.5; color: var(--pp-text-faint);
    }
    .consumption__corrected { color: var(--pp-violet-text); }
  `,
})
export class ConsumptionPage {
  private readonly api = inject(CustomerApiClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly kpiConsumption = KPI_CONSUMPTION;
  protected readonly kpiProduction = KPI_PRODUCTION;
  protected readonly kpiNetUsage = KPI_NET_USAGE;

  /** Hover state, held here so a later slice can wire it to a figure beside the chart. */
  protected readonly hoveredPos = signal<number | null>(null);
  protected readonly hoveredDate = signal<string | null>(null);

  private readonly failure = signal<unknown>(null);
  protected readonly loadError = this.failure.asReadonly();

  // ── the URL is the state ──────────────────────────────────────────────────

  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly view = computed<'day' | 'month'>(() =>
    this.query().get('view') === 'month' ? 'month' : 'day',
  );
  private readonly urlDate = computed(() => this.query().get('date'));
  private readonly urlPoints = computed(() =>
    (this.query().get('points') ?? '').split(',').filter((id) => id.length > 0),
  );

  // ── the customer's own connections ────────────────────────────────────────

  private readonly connections = toSignal(
    this.api.listConnections('').pipe(catchError(() => of(NO_CONNECTIONS))),
    { initialValue: NO_CONNECTIONS },
  );

  protected readonly options = computed<readonly PpSelectableConnection[]>(() =>
    this.connections().items.map((item) => ({ id: item.id, label: item.displayLabel })),
  );

  /**
   * ⚠ Filtered against the connections the customer ACTUALLY holds. A bookmark naming a metering
   * point they have since given up sends an id the endpoint answers 404-not-403 for [F13-R19] —
   * and a 404 is the one failure this screen cannot explain, because the server deliberately
   * refused to say whether the row exists.
   */
  protected readonly selectedIds = computed<readonly string[]>(() => {
    const known = this.options().map((o) => o.id);
    const wanted = new Set(this.urlPoints());
    const chosen = known.filter((id) => wanted.has(id));
    return chosen.length > 0 ? chosen : known;
  });

  /** The newest day any of the customer's connections reports. ISO dates compare as strings. */
  private readonly latestKnownDate = computed<string | null>(() => {
    const dates = this.connections()
      .items.map((item) => item.lastDataDate)
      .filter((date): date is string => typeof date === 'string' && date.length > 0);
    return dates.length === 0 ? null : dates.reduce((a, b) => (a > b ? a : b));
  });

  protected readonly effectiveDate = computed(() => this.urlDate() ?? this.latestKnownDate());
  protected readonly effectiveMonth = computed(() => {
    const explicit = this.query().get('month');
    if (explicit !== null) return explicit;
    const date = this.effectiveDate();
    return date === null ? null : monthOf(date);
  });

  // ── the two fetches ───────────────────────────────────────────────────────

  private readonly dayRequest = computed(() => {
    const range = this.effectiveDate();
    const ids = this.selectedIds();
    if (this.view() !== 'day' || range === null || ids.length === 0) return null;
    return { range, ids };
  });

  private readonly monthRequest = computed(() => {
    const range = this.effectiveMonth();
    const ids = this.selectedIds();
    if (this.view() !== 'month' || range === null || ids.length === 0) return null;
    return { range, ids };
  });

  private readonly dayEnvelope = toSignal(
    toObservable(this.dayRequest).pipe(
      // Keyed, not by reference: `computed` produces a new object on every dependency change and
      // an unkeyed distinctUntilChanged would let one screen issue several identical requests.
      distinctUntilChanged((a, b) => keyOf(a) === keyOf(b)),
      switchMap((request) => {
        if (request === null) return of(null);
        // Cleared as the request goes out, not when it lands: a stale failure sitting over a
        // fresh chart is its own kind of wrong.
        this.failure.set(null);
        return this.api.getConsumptionDay(request.range, request.ids).pipe(
          // INSIDE the inner observable. An error reaching the outer pipe terminates it, and the
          // screen goes dead for the rest of the session with nothing on it saying why.
          catchError((error: unknown) => {
            this.failure.set(error);
            return of(null);
          }),
        );
      }),
    ),
    { initialValue: null as ConsumptionDay | null },
  );

  private readonly monthEnvelope = toSignal(
    toObservable(this.monthRequest).pipe(
      distinctUntilChanged((a, b) => keyOf(a) === keyOf(b)),
      switchMap((request) => {
        if (request === null) return of(null);
        this.failure.set(null);
        return this.api.getConsumptionMonth(request.range, request.ids).pipe(
          catchError((error: unknown) => {
            this.failure.set(error);
            return of(null);
          }),
        );
      }),
    ),
    { initialValue: null as ConsumptionMonth | null },
  );

  protected readonly usageDay = computed(() => {
    const envelope = this.dayEnvelope();
    return envelope === null ? null : toUsageDay(envelope);
  });

  protected readonly usageMonth = computed(() => {
    const envelope = this.monthEnvelope();
    return envelope === null ? null : toUsageMonth(envelope);
  });

  // ── the KPI strip and the treatments ──────────────────────────────────────

  private readonly summary = computed(() =>
    this.view() === 'day' ? (this.dayEnvelope()?.summary ?? null) : (this.monthEnvelope()?.summary ?? null),
  );

  private readonly rangeState = computed(() =>
    toDataState(this.summary()?.dataState ?? 'NO_DATA'),
  );

  protected readonly stateLabel = computed(() => DATA_STATE_LABEL[this.rangeState()]);
  protected readonly stateTone = computed(() => DATA_STATE_TONE[this.rangeState()]);
  /** [F03-R20]: every KPI carries the data state of its range, with its provenance under it. */
  protected readonly stateNote = computed(
    () => `${DATA_STATE_LABEL[this.rangeState()]} · ${DATA_STATE_NOTE[this.rangeState()]}`,
  );

  protected readonly consumptionTotal = computed(() => formatMwh(this.summary()?.consumptionKwh ?? null));
  protected readonly productionTotal = computed(() => formatMwh(this.summary()?.productionKwh ?? null));
  protected readonly netUsageTotal = computed(() => formatMwh(this.summary()?.netUsageKwh ?? null));

  protected readonly isEmptyRange = computed(() => {
    const envelope = this.view() === 'day' ? this.dayEnvelope() : this.monthEnvelope();
    return envelope !== null && this.rangeState() === 'NO_DATA';
  });

  protected readonly emptyHeading = computed(() =>
    this.view() === 'day' ? EMPTY_DAY_HEADING : EMPTY_MONTH_HEADING,
  );
  protected readonly emptyBody = computed(() =>
    this.view() === 'day' ? EMPTY_DAY_BODY : EMPTY_MONTH_BODY,
  );

  protected declaredZero(): string {
    return declaredZeroLine(this.dayEnvelope()?.productionDeclaration ?? null);
  }

  protected corrected(at: string): string {
    return correctedOnLine(at);
  }

  // ── headings ──────────────────────────────────────────────────────────────

  protected readonly pickerDate = computed(() => this.effectiveDate() ?? '');
  protected readonly monthTitle = computed(() => {
    const month = this.effectiveMonth();
    return month === null ? '' : monthLabel(month);
  });

  protected readonly dayHeading = computed(() => {
    const date = this.effectiveDate();
    return date === null ? 'Consumption' : formatDutchDate(date);
  });
  protected readonly monthHeading = computed(() => this.monthTitle());

  protected readonly subtitle = computed(() => {
    const count = this.selectedIds().length;
    const total = this.options().length;
    const which = count === total ? 'all connections' : `${count} of ${total} connections`;
    return `Consumption, production and net usage · ${which}`;
  });

  // ── navigation [F03-R07], [F03-R09] ───────────────────────────────────────

  protected readonly latestDataDate = computed(
    () => this.dayEnvelope()?.lastDataDate ?? this.latestKnownDate(),
  );

  protected readonly canJump = computed(() => {
    const latest = this.latestDataDate();
    return latest !== null && latest !== this.effectiveDate();
  });

  protected stepDay(days: number): void {
    const date = this.effectiveDate();
    if (date === null) return;
    this.go({ view: 'day', date: addDays(date, days), month: null });
  }

  protected stepMonth(months: number): void {
    const month = this.effectiveMonth();
    if (month === null) return;
    this.go({ view: 'month', month: shiftMonth(month, months) });
  }

  protected pickDate(date: string): void {
    this.go({ view: 'day', date, month: null });
  }

  protected pickPoints(ids: readonly string[]): void {
    this.go({ points: ids.join(',') });
  }

  protected jumpToLatest(): void {
    const latest = this.latestDataDate();
    if (latest === null) return;
    this.go({ view: 'day', date: latest, month: null });
  }

  protected showDay(): void {
    this.go({ view: 'day', date: this.effectiveDate(), month: null });
  }

  protected showMonth(): void {
    this.go({ view: 'month', month: this.effectiveMonth() });
  }

  /** [F03-R09]'s drill-in. The DATE arrives from the chart's semantic event, never a pixel. */
  protected openDay(date: string): void {
    this.go({ view: 'day', date, month: null });
  }

  /**
   * One navigation, merged into whatever the URL already carries.
   *
   * NOT `void this.router.navigate(...)`. A rejected navigation becomes an unhandled rejection,
   * and vitest turns that into "N passed" followed by exit 1 — a red build that reads as green.
   */
  private go(queryParams: Params): void {
    this.router
      .navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' })
      .catch(() => undefined);
  }
}
```

⚠ **`toSignal(..., { requireSync: true })` on `queryParamMap`.** The router's `queryParamMap` is a
`BehaviorSubject`-backed observable and emits synchronously on subscribe, so `requireSync` is
satisfied and the screen has its URL state during the first `computed` read. Without it the
initial value is `undefined`, every `computed` above it has to handle a state that only exists for
one microtask, and the first request goes out with no date.

⚠ **`month: null` is passed explicitly on every day-view navigation.** `queryParamsHandling:
'merge'` keeps a parameter it is not told about, so stepping from a month drill-in into the day
view would leave `?month=2026-08` behind and the Month tab would reopen on a month that no longer
matches the day. `null` removes it.

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: PASS.

⚠ If `hands the chart the envelope unchanged` fails on the dot count, check that `PpUsageChart` is
in the `imports` array. An unimported component renders as an unknown element with no error in a
zoneless TestBed, and every DOM assertion under it reports "found none".

- [ ] **Step 5: Mutation check — the filtered selection**

In `consumption-page.ts`, trust the URL:

```ts
  protected readonly selectedIds = computed<readonly string[]>(() => {
    const fromUrl = this.urlPoints();
    return fromUrl.length > 0 ? fromUrl : this.options().map((o) => o.id);
  });
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `ignores a metering point the customer no longer holds` reports
`expected [ 'mp-1', 'mp-gone' ] to deeply equal [ 'mp-1' ]`. **Restore immediately.**

- [ ] **Step 6: Mutation check — the empty state beside the chart rather than instead of it**

In `consumption-page.ts`, change the empty branch to an additional one:

```ts
          @if (isEmptyRange()) {
            <pp-card [headingLevel]="2" [heading]="emptyHeading()">
              <p class="consumption__empty">{{ emptyBody() }}</p>
            </pp-card>
          }
          @if (view() === 'day') {
```

(that is: `@else if` becomes a second `@if`).

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `replaces the chart with the empty state when the range holds no data` reports
`expected <pp-usage-chart> to be null`. The screen now shows an axis with nothing on it under a
banner explaining why, which reads as a broken chart. **Restore immediately.**

- [ ] **Step 7: Mutation check — the KPI's data state**

In `consumption-page.ts`, hardcode the sublabel:

```ts
  protected readonly stateNote = computed(() => 'Provisional · measured, and your BRP may still correct it');
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `carries a NON-provisional state through too, so the label is not hardcoded`
reports `expected 'Provisional · measured, and your BRP may still correct it' to contain 'Final'`.
Predicted before running: `labels every KPI with its range data state` stays **green**, because its
fixture is provisional — which is exactly why the second fixture exists. `[F03-R20]` is a Must, and
a hardcoded "provisional" on a settled month is a lie about a settled number. **Restore immediately.**

- [ ] **Step 8: Mutation check — the stale month parameter**

In `consumption-page.ts`, drop the explicit removal from `openDay`:

```ts
  protected openDay(date: string): void {
    this.go({ view: 'day', date });
  }
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `drills a month bar into that DAY, and switches back to the day view` reports
that the last navigation still carries `month: '2026-08'`; the `toMatchObject` assertion itself
passes, so the failure surfaces on the following `http.expectOne` for the **month** URL, which is
the request the stale parameter causes. ⚠ If that reads as an unclear failure, strengthen the
assertion to `expect(lastQuery()).toEqual({ view: 'day', date: '2026-08-01', month: null })` and
re-run — the sharper assertion is the better one to keep. **Restore immediately.**

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/features/consumption/consumption-page.ts \
        apps/customer-portal/src/app/features/consumption/consumption-page.spec.ts
git commit -m "feat(customer-portal): the /consumption screen

Day and month views, the whole state in the URL, [F03-R07] navigation (previous/next, the
hand-rolled picker, jump-to-latest driven by lastDataDate), [F03-R09]'s drill-in from a
month bar, [F03-R21]'s selector, [F03-R20]'s per-KPI data state, and the five treatments.
No price, no euro figure and no block anywhere — S2-D6.

Verified by mutation four ways: trusting the URL's points sends an id the endpoint
answers 404-not-403 for; rendering the empty state BESIDE the chart leaves an axis with
nothing on it under a banner explaining why; hardcoding the KPI sublabel to 'Provisional'
leaves the provisional fixture green and lies about a settled month; and dropping the
explicit month:null from the drill-in leaves a stale ?month behind under merge."
```

---

### Task 12: The connection-detail 14-day strip, and the `LastDataDate` inversion

`LastDataDate` has been `null` on the wire for the whole of slice 1, and the two connection screens
were written against that: both print `NO_DATA_YET` unconditionally, and
`connection-detail-page.spec.ts:266-274` **asserts the date is not printed even when the wire
carries one**. Plan 6 populates the column from
`max(metering_point_day_state.delivery_date) WHERE state <> 'NO_DATA'` (shared contract §10.3), so
those three literals are now false and the spec is actively holding the wrong behaviour in place.

⚠ **This is pinned assertion four of shared contract §11.7's five, and it is an INVERSION rather
than an edit.** The test's name, its body and its intent all change:

```ts
// before — connection-detail-page.spec.ts:266-274
it('says there is no measurement yet rather than printing a date', () => {
  loaded({ lastDataDate: '2026-08-01' });
  expect(fact('Latest data')).toBe(NO_DATA_YET);
  expect(root.textContent).not.toContain('2026-08-01');
});
```

⚠ **The contract's "after" snippet spells the rendered date `'1 augustus 2026'`, and that is
wrong.** `formatDutchDate` uses `dateStyle: 'medium'` (`libs/shared-ui/src/lib/format/dutch-date.ts:50`),
which CLDR renders **abbreviated**: `connection-detail-page.spec.ts:227` already pins
`fact('Active from')` as `'1 jan 2024'` for `validFrom: '2024-01-01'`. `'2026-08-01'` therefore
renders **`1 aug 2026`**. Write the abbreviated form; the contract's long form fails.

⚠ **`NO_DATA_YET` and its exact string stay** — shared contract §11.7 freezes them, `labels.spec.ts:132`
pins the sentence including its U+2014 em dash, and `connection-list-page.spec.ts:228` asserts it and
stays green because that fixture's `lastDataDate` is `null`. This plan therefore does **not** touch
`apps/customer-portal/src/app/shared/labels.ts`. The stated cost, so it is a decision rather than an
oversight: the sentence's second clause — *"ingestion arrives in a later slice"* — is stale the day
this slice ships, and it now renders only on a connection that genuinely has no data. Rewording it is
outside what this plan owns (§17) and belongs with whoever owns `labels.ts` next.

**The strip is `ean-detail.svg`'s `Data quality` panel, built to the envelope.** The mockup's legend
is `final` / `prov.` / `corr.` / `none`, and **`corr.` is not buildable**: `DayStateDto` is
`(Date, State)` and `MeteringDayState` has exactly four members (shared contract §4) — there is no
correction flag on this envelope, and the only place a correction is visible is the day view's
`lastCorrectedAt` (§10.1), which this screen does not fetch. A violet `corr.` cell here would be a
mark nothing produced. The legend therefore names the four states the wire can actually carry:
**final · prov. · part. · none**.

⚠ **`recentDataStates` becomes a REQUIRED field on `ConnectionDetail` the moment task 6 regenerates
the client**, because §10.3 adds it non-nullable at the end of the record. The spec's `detail()`
factory (`connection-detail-page.spec.ts:35-64`) therefore stops compiling until it supplies one, and
a TypeScript diagnostic fails the whole `ng test customer-portal` bundle rather than one test. Add
the field to the fixture in the same edit as the inversion.

**Files:**
- Modify: `apps/customer-portal/src/app/features/connections/connection-detail-page.ts:157`
  (the `Latest data` row), `:160` (a second card in the left column), `:190-197` (styles),
  `:216` (the `noDataYet` field)
- Modify: `apps/customer-portal/src/app/features/connections/connection-detail-page.spec.ts:61`
  (the fixture gains `recentDataStates`), `:266-274` (**inverted**)
- Modify: `apps/customer-portal/src/app/features/connections/connection-list-page.ts:83`, `:136`
- Modify: `apps/customer-portal/src/app/features/connections/connection-list-page.spec.ts` (append)

**Interfaces:**
- Consumes: `ConnectionDetail.lastDataDate` and `ConnectionDetail.recentDataStates: DayState[]`
  (task 6); `ConnectionSummary.lastDataDate`; `formatDutchDate` from `@peakpower-nl/shared-ui`;
  `DATA_STATE_LABEL` from `../consumption/consumption-copy` and `toDataState` from
  `../consumption/consumption-envelope` (task 8).
- Produces:
  - `export const DATA_QUALITY_HEADING = 'Data quality'`
  - `export const DATA_QUALITY_SUBTITLE = 'Last 14 delivery dates'`
  - `export const NO_RECENT_STATES = 'No delivery dates have been evaluated for this connection yet.'`
  - the DOM contract its spec pins: `.quality`, `.quality__cell`, `.quality__day`, `.quality__state`,
    `.quality__legend`, and the per-state modifiers `--final`, `--provisional`, `--partial`,
    `--no-data`.

- [ ] **Step 1: Write the failing tests**

In `apps/customer-portal/src/app/features/connections/connection-detail-page.spec.ts`, add the new
field to the fixture at `:61`, immediately after `lastDataDate: null`:

```ts
    lastDataDate: null,
    recentDataStates: [],
```

Add two helpers beside `fact()` (which ends at `:191`):

```ts
  /** The fourteen cells of the data-quality strip, in wire order — oldest first. */
  function qualityCells(): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>('.quality .quality__cell')];
  }

  /** One cell's visible text, day number and state word, e.g. "1 final". */
  const cellText = (cell: HTMLElement) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '';
```

Add a fourteen-entry fixture beside `detail()`:

```ts
/**
 * Fourteen delivery dates, oldest first, as §10.3 sends them — with a NON-uniform tail, because a
 * strip that renders one class for every cell passes any assertion made against an all-FINAL run.
 */
function fourteenDays(): { date: string; state: string }[] {
  const states = [
    'FINAL', 'FINAL', 'FINAL', 'FINAL', 'FINAL', 'FINAL', 'FINAL',
    'FINAL', 'FINAL', 'FINAL', 'PROVISIONAL', 'PROVISIONAL', 'PARTIAL', 'NO_DATA',
  ];
  return states.map((state, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    state,
  }));
}
```

Replace `:266-274` wholesale with the inversion plus the null case it no longer covers:

```ts
  it('prints the latest data date when the wire carries one', () => {
    // The inversion of shared contract §11.7's fourth pinned assertion. This test used to hold the
    // OPPOSITE: that a date on the wire is deliberately suppressed, because ingestion was F02 and
    // out of slice 1. Plan 6 fills the column from
    // max(metering_point_day_state.delivery_date) WHERE state <> 'NO_DATA', so suppressing it now
    // hides the one fact this row exists to state.
    loaded({ lastDataDate: '2026-08-01' });

    // `dateStyle: 'medium'` — abbreviated, exactly as `Active from` renders at :227.
    expect(fact('Latest data')).toBe('1 aug 2026');
    expect(fact('Latest data')).not.toBe(NO_DATA_YET);
  });

  it('still names the reason rather than printing a blank when nothing has arrived', () => {
    // The fixture's own default, held explicitly: without this the branch above could be written
    // unconditionally and nothing would notice.
    loaded({ lastDataDate: null });

    expect(fact('Latest data')).toBe(NO_DATA_YET);
  });
```

Add the strip's own tests, after the `carries the status in its own words and its own tone` test
(which ends at `:283`):

```ts
  // ── the 14-day data-quality strip, ean-detail.svg's "Data quality" panel ──

  it('renders one cell per delivery date the wire sent, oldest first', () => {
    loaded({ recentDataStates: fourteenDays() });

    const cells = qualityCells();
    expect(cells).toHaveLength(14);
    // Oldest first, and the day NUMBER rather than the whole date: fourteen full dates do not fit
    // the panel and the subtitle already says which fourteen these are.
    expect(cellText(cells[0])).toBe('1 final');
    expect(cellText(cells[13])).toBe('14 none');
  });

  it('marks each cell with its own state, not with the run it sits in', () => {
    // The tail is deliberately mixed. An all-FINAL fixture is satisfied by a hardcoded class.
    loaded({ recentDataStates: fourteenDays() });

    const cells = qualityCells();
    expect(cells[9].className).toContain('quality__cell--final');
    expect(cells[10].className).toContain('quality__cell--provisional');
    expect(cells[12].className).toContain('quality__cell--partial');
    expect(cells[13].className).toContain('quality__cell--no-data');
  });

  it('does not lean on colour alone — every cell prints its state in words', () => {
    // Design §7.16's rule, applied off the chart: with colour removed the strip must still say
    // which day is which. A cell whose only difference is a background is a cell nobody reading
    // in greyscale, or with a screen reader, can tell from its neighbour.
    loaded({ recentDataStates: fourteenDays() });

    const words = qualityCells().map((cell) =>
      cell.querySelector('.quality__state')?.textContent?.trim(),
    );

    expect(new Set(words)).toEqual(new Set(['final', 'prov.', 'part.', 'none']));
  });

  it('names the reason instead of drawing an empty strip when no date has been evaluated', () => {
    loaded({ recentDataStates: [] });

    expect(qualityCells()).toHaveLength(0);
    expect(root.querySelector('.quality-empty')?.textContent?.trim()).toBe(
      'No delivery dates have been evaluated for this connection yet.',
    );
  });

  it('legends the four states the envelope can actually carry, and no fifth', () => {
    // ean-detail.svg draws `final / prov. / corr. / none`. There is no correction flag on
    // DayStateDto and MeteringDayState has four members (shared contract §4), so a `corr.` cell
    // would be a mark nothing produced.
    loaded({ recentDataStates: fourteenDays() });

    const legend = [...root.querySelectorAll('.quality__legend li')].map((li) =>
      li.textContent?.replace(/\s+/g, ' ').trim(),
    );

    expect(legend).toEqual(['final', 'prov.', 'part.', 'none']);
    expect(root.querySelector('.quality')?.textContent).not.toContain('corr.');
  });

  it('adds no second page heading', () => {
    // One <h1> per document. The strip is a card under the connection's own heading, so it takes
    // headingLevel 2 like the two cards beside it.
    loaded({ recentDataStates: fourteenDays() });

    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelector('main')).toBeNull();
  });
```

And the rule-scoped CSS assertions, in the file's existing canvas `describe`:

```ts
    it('gives each state its own surface AND its own ink, from declared tokens', () => {
      // Rule-scoped: a whole-file toContain is satisfied by the same token in a different rule.
      // Both halves matter — a background alone leaves the day number in body colour on four
      // different surfaces, and one of them fails contrast.
      const css = cssText(SOURCE);

      expect(ruleBody(css, '.quality__cell--final')).toContain('background:var(--pp-mint-bg)');
      expect(ruleBody(css, '.quality__cell--final')).toContain('color:var(--pp-mint-text)');
      expect(ruleBody(css, '.quality__cell--provisional')).toContain('background:var(--pp-amber-bg)');
      expect(ruleBody(css, '.quality__cell--provisional')).toContain('color:var(--pp-amber-text)');
      expect(ruleBody(css, '.quality__cell--partial')).toContain('background:var(--pp-coral-bg)');
      expect(ruleBody(css, '.quality__cell--partial')).toContain('color:var(--pp-coral-text)');
      expect(ruleBody(css, '.quality__cell--no-data')).toContain('background:var(--pp-surface-alt)');
      expect(ruleBody(css, '.quality__cell--no-data')).toContain('color:var(--pp-text-faint)');
    });

    it('lays the strip out on fourteen equal tracks, not on a wrap', () => {
      // `repeat(14, 1fr)`, so the fourteenth cell is the same width as the first. A flex-wrap
      // strip reflows into two rows at the narrow column this card sits in, and the reader then
      // reads a calendar that is not one.
      expect(ruleBody(cssText(SOURCE), '.quality')).toContain(
        'grid-template-columns:repeat(14,1fr)',
      );
    });
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: FAIL —

- `prints the latest data date when the wire carries one`:
  `expected 'No data yet — ingestion arrives in a later slice' to be '1 aug 2026'`
- `renders one cell per delivery date the wire sent, oldest first`: `expected [] to have length 14`
- `marks each cell with its own state, not with the run it sits in`:
  `TypeError: Cannot read properties of undefined (reading 'className')`
- `legends the four states the envelope can actually carry, and no fifth`:
  `expected [] to deeply equal [ 'final', 'prov.', 'part.', 'none' ]`
- `gives each state its own surface AND its own ink, from declared tokens`:
  `Error: no rule with selector ".quality__cell--final"` — `ruleBody` throws on a missing selector,
  which is why it is used rather than a `toContain` over the whole sheet.

⚠ If instead the run dies with
`error TS2741: Property 'recentDataStates' is missing in type … but required in type 'ConnectionDetailDto'`,
the fixture edit in step 1 was skipped. A TypeScript diagnostic fails the whole bundle, so **no**
test in the portal runs and the failure list above never appears.

- [ ] **Step 3: Print the real date**

In `apps/customer-portal/src/app/features/connections/connection-detail-page.ts`, replace the
`Latest data` row at `:157`:

```html
            <div>
              <dt>Latest data</dt>
              <dd [class.faint]="c.lastDataDate === null">{{ latestData(c) }}</dd>
            </div>
```

and add the method beside `activeUntil` (which ends at `:347`):

```ts
  /**
   * The most recent delivery date with something on it, or the reason there is none.
   *
   * Populated from `max(metering_point_day_state.delivery_date) WHERE state <> 'NO_DATA'`
   * (shared contract §10.3) — so it is the last date that HAS data, never the last date the
   * pipeline looked at. A connection whose BRP has gone quiet keeps the date it stopped on, which
   * is the fact an operator and a customer both need.
   */
  latestData(c: ConnectionDetail): string {
    return c.lastDataDate === null ? NO_DATA_YET : formatDutchDate(c.lastDataDate);
  }
```

- [ ] **Step 4: Add the 14-day strip**

Add the constants beside `NOT_YOURS` (`:40`):

```ts
/** `ean-detail.svg`'s "Data quality" panel. */
export const DATA_QUALITY_HEADING = 'Data quality';
export const DATA_QUALITY_SUBTITLE = 'Last 14 delivery dates';
export const NO_RECENT_STATES =
  'No delivery dates have been evaluated for this connection yet.';

/**
 * The strip's short word per state. Four, not the mockup's five.
 *
 * `ean-detail.svg` draws `final / prov. / corr. / none`, and `corr.` cannot be built from this
 * envelope: `DayStateDto` is `(Date, State)` and `MeteringDayState` has exactly four members
 * (shared contract §4). The only correction signal in the whole HTTP surface is the day view's
 * `lastCorrectedAt` (§10.1), which this screen does not fetch. A violet `corr.` cell here would be
 * a mark nothing produced — so `PARTIAL`, which the wire CAN carry and the mockup happened not to
 * draw, takes the fourth slot instead.
 */
const STRIP_WORD: Readonly<Record<PpUsageDataState, string>> = Object.freeze({
  NO_DATA: 'none',
  PARTIAL: 'part.',
  PROVISIONAL: 'prov.',
  FINAL: 'final',
});

const STRIP_MODIFIER: Readonly<Record<PpUsageDataState, string>> = Object.freeze({
  NO_DATA: 'no-data',
  PARTIAL: 'partial',
  PROVISIONAL: 'provisional',
  FINAL: 'final',
});
```

Add the imports it needs:

```ts
import type { DayState } from '@peakpower-nl/api-client-customer';
import type { PpUsageDataState } from '@peakpower-nl/shared-ui';

import { toDataState } from '../consumption/consumption-envelope';
```

Add the card, immediately after the `Name this connection` card closes (`:139`) and still inside
`.col`:

```html
          <pp-card [headingLevel]="2" [heading]="qualityHeading" [subtitle]="qualitySubtitle">
            @if (c.recentDataStates.length > 0) {
              <!--
                An ordered list, because these fourteen ARE ordered and a screen reader announcing
                "list, 14 items" is the whole affordance. `aria-hidden` on nothing: every cell
                prints its own day number and its own state word, so the strip reads correctly
                with colour removed and with no colour at all.
              -->
              <ol class="quality">
                @for (day of c.recentDataStates; track day.date) {
                  <li class="quality__cell {{ cellModifier(day) }}">
                    <span class="quality__day">{{ dayOfMonth(day.date) }}</span>
                    <span class="quality__state">{{ cellWord(day) }}</span>
                  </li>
                }
              </ol>
              <ul class="quality__legend">
                <li>final</li><li>prov.</li><li>part.</li><li>none</li>
              </ul>
            } @else {
              <p class="quality-empty">{{ noRecentStates }}</p>
            }
          </pp-card>
```

Add the members:

```ts
  readonly qualityHeading = DATA_QUALITY_HEADING;
  readonly qualitySubtitle = DATA_QUALITY_SUBTITLE;
  readonly noRecentStates = NO_RECENT_STATES;

  /**
   * `2026-08-14` → `14`. A string slice, not `new Date(...).getDate()`: the Date route reads the
   * day back in the HOST zone, and a CI runner west of UTC turns every date in this strip into the
   * one before it. There is no arithmetic to do here — the day is already the last two characters.
   */
  dayOfMonth(date: string): number {
    return Number(date.slice(8, 10));
  }

  cellWord(day: DayState): string {
    return STRIP_WORD[toDataState(day.state)];
  }

  cellModifier(day: DayState): string {
    return `quality__cell--${STRIP_MODIFIER[toDataState(day.state)]}`;
  }
```

And the styles, appended to the `styles:` block after `.faint` (`:197`):

```css
    /* Fourteen equal tracks. Not a flex wrap: at this card's width a wrap reflows into two rows
       and the reader reads a calendar that is not one. */
    .quality {
      display: grid; grid-template-columns: repeat(14, 1fr); gap: 3px;
      margin: 0; padding: 0; list-style: none;
    }
    .quality__cell {
      display: flex; flex-direction: column; align-items: center; gap: 2px;
      padding: 6px 0; border-radius: 4px; font-size: 10px; line-height: 1;
    }
    .quality__day { font-weight: 700; }
    .quality__state { font-size: 8.5px; }
    .quality__cell--final { background: var(--pp-mint-bg); color: var(--pp-mint-text); }
    .quality__cell--provisional { background: var(--pp-amber-bg); color: var(--pp-amber-text); }
    .quality__cell--partial { background: var(--pp-coral-bg); color: var(--pp-coral-text); }
    .quality__cell--no-data { background: var(--pp-surface-alt); color: var(--pp-text-faint); }
    .quality__legend {
      display: flex; gap: 12px; margin: 10px 0 0; padding: 0; list-style: none;
      font-size: 10px; color: var(--pp-text-faint);
    }
    .quality-empty {
      margin: 0; padding: 14px 0; font-size: 12px; line-height: 1.5; color: var(--pp-text-faint);
    }
```

⚠ **Every token above is declared in `libs/shared-ui/src/styles/colors.css`** — verified today at
`:34` (`--pp-mint-bg`, `--pp-mint-text`), `:46` (`--pp-amber-bg`, `--pp-amber-text`), `:41`
(`--pp-coral-bg`, `--pp-coral-text`), `:14` (`--pp-surface-alt`) and `:18` (`--pp-text-faint`).
`design-tokens.spec.ts` fails on any that is not, and it fails **silently on screen**: an undefined
custom property renders nothing at all and every DOM assertion still passes.

- [ ] **Step 5: Run them and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: PASS.

- [ ] **Step 6: Mutation check — the null branch**

In `connection-detail-page.ts`, drop the branch and print the date unconditionally:

```ts
  latestData(c: ConnectionDetail): string {
    return formatDutchDate(c.lastDataDate);
  }
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `still names the reason rather than printing a blank when nothing has arrived`
reports `expected '—' to be 'No data yet — ingestion arrives in a later slice'`. Predicted before
running: `prints the latest data date when the wire carries one` stays **green**, which is exactly
why the second test exists — `formatDutchDate` is total and answers a null with `PP_UNAVAILABLE`
(U+2014), so the failure is a bare em dash where a sentence belongs and nothing else can see it.
**Restore immediately.**

- [ ] **Step 7: Mutation check — the cell's state comes off the wire**

In `connection-detail-page.ts`, hardcode the modifier the run is mostly made of:

```ts
  cellModifier(): string {
    return 'quality__cell--final';
  }
```

(and change the template's call to `cellModifier()`, so the code still compiles — a mutation that
breaks the build proves nothing about an assertion).

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `marks each cell with its own state, not with the run it sits in` reports
`expected 'quality__cell quality__cell--final' to contain 'quality__cell--provisional'`. Predicted
before running: `renders one cell per delivery date the wire sent, oldest first` stays **green**,
because the counts and the words are untouched. Ten of the fourteen fixture days are `FINAL`, so a
hardcoded class is right ten times out of fourteen — which is the whole reason the fixture's tail is
mixed. **Restore immediately.**

- [ ] **Step 8: Write the failing test for the list column**

Append to `apps/customer-portal/src/app/features/connections/connection-list-page.spec.ts`, inside
its existing `describe`:

```ts
  it('prints the latest data date in the LATEST DATA column when the wire carries one', () => {
    // A SECOND fixture, not an edit of the first: `:228` asserts NO_DATA_YET against a row whose
    // lastDataDate is null and must stay green, because that is still the honest answer for a
    // connection nothing has arrived for.
    renderWith([summary({ id: 'mp-9', lastDataDate: '2026-08-14' })]);

    expect(rowElements()[0].textContent).toContain('14 aug 2026');
    expect(rowElements()[0].textContent).not.toContain(NO_DATA_YET);
  });
```

⚠ **Use this file's own render/fixture helpers, whatever they are named** — read the top of the file
before writing the call. The names above (`renderWith`, `summary`, `rowElements`) follow
`connection-list-page.spec.ts:228`'s existing `rowElements()`; if the fixture factory is spelled
differently, use the spelling that is there rather than adding a second one.

- [ ] **Step 9: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: FAIL — `prints the latest data date in the LATEST DATA column when the wire carries one`
reports `expected '… No data yet — ingestion arrives in a later slice' to contain '14 aug 2026'`.

- [ ] **Step 10: Print the date in the list column**

In `apps/customer-portal/src/app/features/connections/connection-list-page.ts`, replace `:83`:

```html
            <div [class.faint]="row.lastDataDate === null">{{ latestData(row) }}</div>
```

and add beside `noDataYet` (`:136`):

```ts
  latestData(row: ConnectionSummary): string {
    return row.lastDataDate === null ? NO_DATA_YET : formatDutchDate(row.lastDataDate);
  }
```

adding `formatDutchDate` to the existing `@peakpower-nl/shared-ui` import and `ConnectionSummary`
to the existing type import.

- [ ] **Step 11: Run it and watch it pass, and watch `:228` stay green**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: PASS, **including** the untouched `:228` assertion — its fixture's `lastDataDate` is
`null`, so `NO_DATA_YET` is still what that row prints. If `:228` goes red, the branch was written
the wrong way round.

- [ ] **Step 12: Run the whole suite, because the token guard lives in another file**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && \
  PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform npm test
```

Expected: PASS. `design-tokens.spec.ts` reads every `.ts` under `apps/` — including the eight new
`var(--pp-…)` references above — and `declares every custom property either portal references` is
the only thing in the workspace that can see a mistyped one.

- [ ] **Step 13: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/features/connections/connection-detail-page.ts \
        apps/customer-portal/src/app/features/connections/connection-detail-page.spec.ts \
        apps/customer-portal/src/app/features/connections/connection-list-page.ts \
        apps/customer-portal/src/app/features/connections/connection-list-page.spec.ts
git commit -m "feat(customer-portal): the 14-day data-quality strip, and a real LastDataDate

Shared contract §11.7's fourth pinned assertion INVERTED in the same commit as the
feature: connection-detail-page.spec.ts:266-274 asserted the date was not printed even
when the wire carried one, which was correct while LastDataDate was hardcoded null and is
now the opposite of what the row is for. A second test keeps NO_DATA_YET for null.

The strip legends FOUR states, not the mockup's five. DayStateDto is (Date, State) and
MeteringDayState has four members, so ean-detail.svg's 'corr.' cell would be a mark
nothing produced; PARTIAL takes the fourth slot.

Verified by mutation: dropping the null branch prints a bare em dash where a sentence
belongs and leaves the date test green; hardcoding the cell modifier to --final is right
ten times out of fourteen and leaves the count and the words green."
```

---

### Task 13: The dashboard copy, and the assertion nobody wrote

The banner says *"There is no metering data yet, so this page has nothing to total"*. That is false
the moment plan 6's endpoints answer, and **nothing in the suite asserts it** — shared contract
§11.7's fifth pinned literal is pinned by the contract and by nothing else, which is precisely why
it is worth writing an assertion for now rather than leaving the next person the same free hand.

⚠ **Verify the freedom before using it.** Do not take the paragraph above on trust: the whole point
of this task is that a copy change nothing asserts is a change nobody can review.

**Files:**
- Modify: `apps/customer-portal/src/app/features/dashboard/dashboard-page.ts:17` (the subtitle),
  `:19-24` (the lede and the links), `:27-30` (the banner)
- Modify: `apps/customer-portal/src/app/features/dashboard/dashboard-page.spec.ts:47-51`
  (the anchor test), and an appended banner assertion

**Interfaces:**
- Consumes: `RouterLink`, `PpBanner`, `PpCard` — all already imported at `:2-3`.
- Produces: no new export. The screen's DOM contract gains `a[href="/consumption"]`.

- [ ] **Step 1: Prove nothing asserts the sentence**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && \
  grep -rn 'nothing to total\|no metering data yet\|No figures are shown here' \
  apps libs > /tmp/pp-dashboard-copy.txt; wc -l < /tmp/pp-dashboard-copy.txt; \
  cat /tmp/pp-dashboard-copy.txt
```

Expected: **`1`**, and the one line is `dashboard-page.ts` itself. No `.spec.ts` file appears.

⚠ **Redirect and read the file back rather than reading the terminal.** `CLAUDE.md` records that a
bare `grep` in this environment is truncated silently, and a truncated grep that finds nothing is
indistinguishable from a grep that found nothing.

- [ ] **Step 2: Write the failing test**

Replace `dashboard-page.spec.ts:47-51` — the anchor test, whose name still says "slice 1" and whose
`querySelector('a')` silently depends on which link comes first in the template:

```ts
  it('offers both screens that are live behind it', () => {
    // Addressed by href, not by position: `querySelector('a')` returns whichever link the
    // template happens to declare first, so adding a second one below the first would have kept
    // this green while asserting nothing about it.
    const root = render();

    expect(root.querySelector('a[href="/connections"]')).not.toBeNull();
    expect(root.querySelector('a[href="/consumption"]')).not.toBeNull();
  });
```

Append, inside the top-level `describe`:

```ts
  // ── the copy ────────────────────────────────────────────────────────────
  //
  // Nothing asserted this banner before slice 2, which is how it kept a sentence — "There is no
  // metering data yet, so this page has nothing to total" — that plan 6's endpoints made false.
  // These two are the guard that stops the same thing happening to the replacement.

  const banner = (root: HTMLElement) =>
    root.querySelector('pp-banner')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('no longer claims there is no metering data', () => {
    const root = render();

    expect(root.textContent).not.toContain('no metering data yet');
    expect(root.textContent).not.toContain('nothing to total');
  });

  it('says where the figures are instead of claiming there are none', () => {
    // Scoped to the banner, not to the page: a page-wide toContain is satisfied by the lede.
    expect(banner(render())).toContain(
      'Every number in this product is computed from real data or rendered unavailable.',
    );
    expect(banner(render())).toContain('Volume shows your metering data day by day');
    // The rule the whole slice turns on: "projected" is a word about a number nobody has
    // measured, and every figure this product prints has been.
    expect(render().textContent?.toLowerCase()).not.toContain('projected');
  });

  it('names the slice it is actually shipping', () => {
    // The subtitle said "Slice 1" through the whole of slice 2's development, on the first screen
    // a customer sees after signing in.
    const subtitle = render().querySelector('.pp-card__subtitle')?.textContent?.trim();

    expect(subtitle).toBe('Slice 2 of the PeakPower platform');
  });
```

- [ ] **Step 3: Run them and watch them fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: FAIL, four ways —

- `offers both screens that are live behind it`: `expected null not to be null`
- `no longer claims there is no metering data`: `expected '… There is no metering data yet, so this
  page has nothing to total. …' not to contain 'no metering data yet'`
- `says where the figures are instead of claiming there are none`:
  `expected '… nothing to total.' to contain 'Volume shows your metering data day by day'`
- `names the slice it is actually shipping`: `expected 'Slice 1 of the PeakPower platform' to be
  'Slice 2 of the PeakPower platform'`

- [ ] **Step 4: Rewrite the copy**

In `apps/customer-portal/src/app/features/dashboard/dashboard-page.ts`, replace `:17` through `:30`:

```html
      <pp-card
        class="lead"
        [heading]="greeting()"
        [headingLevel]="1"
        subtitle="Slice 2 of the PeakPower platform"
      >
        <p class="lede">
          Your company, its connections and your metering data are live. Prices, trading, balance
          and settlements arrive in later slices — the rail shows each of them with the reason it
          is not ready yet.
        </p>
        <p><a routerLink="/connections">Go to your connections ›</a></p>
        <p><a routerLink="/consumption">See your volume, day by day ›</a></p>
      </pp-card>

      <pp-banner tone="info" heading="The figures live on the volume screen">
        Every number in this product is computed from real data or rendered unavailable. Volume
        shows your metering data day by day and month by month, each figure labelled with the
        state your balance responsible party has it in; this page keeps no total of its own.
      </pp-banner>
```

⚠ **`/connections` stays FIRST.** It is not a preference: the anchor test rewritten in step 2 now
addresses each link by `href`, but `connection-list-page.spec.ts` and the rest of the portal's
slice-1 specs were written when the dashboard had exactly one link. Leaving the order alone keeps
this a copy change rather than a layout change.

⚠ **No sentence here contains the word "projected".** The copy rules make that a hard rule and this
banner is where it would be easiest to reach for: a "projected" total on a `PROVISIONAL` day claims
nobody has measured it, when the whole distinction the slice preserves is that somebody has.

- [ ] **Step 5: Run them and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: PASS — including the four untouched CSS assertions (`.page`, `pp-card.lead`, `a`,
`.lede`), which this task does not go near.

- [ ] **Step 6: Mutation check — the sentence that had no guard**

In `dashboard-page.ts`, put the old sentence back inside the new banner:

```html
      <pp-banner tone="info" heading="The figures live on the volume screen">
        Every number in this product is computed from real data or rendered unavailable. There is
        no metering data yet, so this page has nothing to total.
      </pp-banner>
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL**, twice — `no longer claims there is no metering data` reports
`expected '… There is no metering data yet, so this page has nothing to total. …' not to contain
'no metering data yet'`, and `says where the figures are instead of claiming there are none`
reports `expected … to contain 'Volume shows your metering data day by day'`.

Predicted before running: **before this task, that mutation was invisible.** Restore the file to
its pre-task state, run `npm run test:customer-portal`, and watch the suite pass with the false
sentence on screen — that is the free hand §11.7 describes, seen once so it is not taken on trust.
**Restore immediately.**

- [ ] **Step 7: Mutation check — the link addressed by position**

In `dashboard-page.spec.ts`, revert the anchor test to its positional form:

```ts
    const link = render().querySelector('a');
    expect(link?.getAttribute('href')).toBe('/connections');
```

then, in `dashboard-page.ts`, delete the `/consumption` paragraph.

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:customer-portal
```

Expected: **FAIL** — `says where the figures are instead of claiming there are none` still passes,
and the positional test **also passes** with the link gone. That is the point: the whole reason the
test was rewritten is that it could not see a missing second link, only a reordered first one.
Restore the `href`-addressed form and re-run; it now reports `expected null not to be null`.
**Restore both files immediately.**

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app/features/dashboard/dashboard-page.ts \
        apps/customer-portal/src/app/features/dashboard/dashboard-page.spec.ts
git commit -m "feat(customer-portal): rewrite the dashboard copy for a slice that has data

The banner said 'There is no metering data yet, so this page has nothing to total',
which plan 6's endpoints made false. Shared contract §11.7's fifth pinned literal was
pinned by the contract and by nothing in the suite: verified by grep that no spec
asserted the sentence, and by mutation that the old sentence could be restored with the
whole portal green. Three assertions now cover the replacement, the subtitle's slice
number and the two links, addressed by href rather than by position."
```

---

### Task 14: Regenerate the employee client and add the four data-health calls

The employee half of task 6. `[DEC-116]` again: there is no npm registry, so the TypeScript derived
from the employee OpenAPI document is **committed**, and `tools/verify-clients.test.mjs` regenerates
it in memory and diffs it byte-for-byte inside `npm run test:workspace`.

⚠ **`libs/api-client-employee/src/lib/employee-api.types.ts` is the ONLY file in the workspace that
knows how `openapi-typescript` names things** for this document. Everything below aliases through it.

⚠ **Every integer on these four envelopes arrives typed `number | string`, and this file is where
that is fixed.** .NET 10's OpenAPI emission describes every `int`/`long` property as
`number | string` — verified today at `employee-schema.d.ts:358-365`, where `accountCount`,
`meteringPointCount` and `total` all carry it — with no `AllowReadingFromString` anywhere in the
platform. It is an artifact of the emitted document, not of the wire: System.Text.Json always writes
a JSON number. `employee-api.types.ts:10-23` already narrows the slice-1 fields at this boundary for
exactly this reason, and the eleven new integers (`payloadBytes`, `versionCount`,
`quarantinedSeriesCount`, `pointCount`, `ageHours`, `versionsCreated`, `quarantineEntriesResolved`
and the four envelopes' `total`/`page`/`pageSize`) get the same treatment. Skip it and every screen
below invents its own `Number(...)`, or renders `NaN` from a `+` on a union.

⚠ **`status`, `reason`, `outcome`, `state` and `direction` are `string` on the wire, NOT unions.**
Plan 6 declares all five as `string` on the C# records — its own note says so: *"`Outcome`,
`Reason`, `Status` and `Direction` are all `string`, so nothing here needs
`PeakPower.Domain.Metering`"*. `openapi-typescript` therefore emits `string`, and a
`type StatusValue = DataHealthMessage['status']` alias would resolve to `string` while **reading**
like a closed union — the worst of both. Task 15's labels file declares the four vocabularies
locally and every lookup carries a named fallback, the same shape
`consumption-copy.ts`'s `productionSourceLabel` uses.

⚠ **The six schema names below are this plan's reading of plan 6's task 9 records.** They are
transcribed from `2026-09-07-slice-2-plan-6-read-surfaces.md:5268-5274`. If one does not resolve,
**fix this one file** and nothing else changes.

| Alias | Expected schema |
| --- | --- |
| `DataHealthMessage` | `DataHealthMessageDto` |
| `DataHealthMessageListResponse` | `DataHealthMessageListResponse` |
| `QuarantinedSeries` | `QuarantinedSeriesDto` |
| `QuarantineListResponse` | `QuarantineListResponse` |
| `DataHealthMeteringPoint` | `DataHealthMeteringPointDto` |
| `DataHealthMeteringPointListResponse` | `DataHealthMeteringPointListResponse` |
| `ReplayMessageResponse` | `ReplayMessageResponse` |
| `EmployeeDayState` | `EmployeeDayStateDto` |

**Files:**
- Modify: `libs/api-client-employee/src/generated/employee-schema.d.ts` (regenerated wholesale)
- Modify: `libs/api-client-employee/src/lib/employee-api.types.ts:35` (append after the `Brp` alias)
- Modify: `libs/api-client-employee/src/lib/employee-api.client.ts:23` (the imported type list),
  `:54` (URL builders, after `brpsUrl`), `:170` (the calls, after `listBrps`)
- Test: `libs/api-client-employee/src/lib/employee-api.client.spec.ts` (append)
- Test: `libs/api-client-employee/src/lib/employee-api.types.spec.ts` (append)

**Interfaces:**
- Consumes: the platform's `artifacts/openapi/employee.json`, produced by plan 6.
- Produces:
  - the eight type aliases above, `total`/`page`/`pageSize` and the seven other integers narrowed
  - `dataHealthMessagesUrl(): string` → `${baseUrl}/data-health/messages`
  - `dataHealthQuarantineUrl(): string` → `${baseUrl}/data-health/quarantine`
  - `dataHealthMeteringPointsUrl(): string` → `${baseUrl}/data-health/metering-points`
  - `replayMessageUrl(id: string): string` → `${baseUrl}/data-health/messages/${id}/replay`
  - `listDataHealthMessages(filter: MessageFilter): Observable<DataHealthMessageListResponse>`
  - `listQuarantine(filter: QuarantineFilter): Observable<QuarantineListResponse>`
  - `listDataHealthMeteringPoints(filter: MeteringPointHealthFilter): Observable<DataHealthMeteringPointListResponse>`
  - `replayMessage(id: string): Observable<ReplayMessageResponse>`

- [ ] **Step 1: Regenerate, and watch the drift guard have something to say**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform && dotnet build PeakPower.sln --nologo
cd /Users/thinhhuynh/PeakPower/peakpower-web && \
  PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform npm run verify:clients
```

Expected: **FAIL** — `@peakpower-nl/api-client-employee is stale.` … `first difference at line <n>`
… `Run 'npm run generate:clients', review the diff, and commit it.`

If it says `up to date`, plan 6's data-health endpoints are not in the employee OpenAPI document yet
and this task cannot start.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && \
  PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform npm run generate:clients
```

Confirm the names before writing a line of TypeScript:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && \
  grep -n 'DataHealthMessageDto\|DataHealthMessageListResponse\|QuarantinedSeriesDto\|QuarantineListResponse\|DataHealthMeteringPointDto\|DataHealthMeteringPointListResponse\|ReplayMessageResponse\|EmployeeDayStateDto' \
  libs/api-client-employee/src/generated/employee-schema.d.ts > /tmp/pp-employee-names.txt; \
  cat /tmp/pp-employee-names.txt
```

Expected: eight schema declarations. Also confirm the integer artifact is still there, because the
narrowing below is only worth writing while it is:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && \
  grep -n 'ageHours\|payloadBytes\|versionCount' \
  libs/api-client-employee/src/generated/employee-schema.d.ts > /tmp/pp-employee-ints.txt; \
  cat /tmp/pp-employee-ints.txt
```

Expected: each one typed `number | string`. If the platform has since fixed its OpenAPI emission and
these are plain `number`, **drop the `Omit<…> & {…}` wrappers below and alias straight through** —
narrowing a field that is already narrow is a wrapper nobody can delete later without checking.

- [ ] **Step 2: Write the failing client test**

Append to `libs/api-client-employee/src/lib/employee-api.client.spec.ts`, inside the existing
`describe('EmployeeApiClient', …)`:

```ts
  it('builds the four data-health URLs under the injected base path', () => {
    expect(api.dataHealthMessagesUrl()).toBe('/api/v1/data-health/messages');
    expect(api.dataHealthQuarantineUrl()).toBe('/api/v1/data-health/quarantine');
    expect(api.dataHealthMeteringPointsUrl()).toBe('/api/v1/data-health/metering-points');
    // A real id, not the fixture's: a hardcoded path passes an assertion made against itself.
    expect(api.replayMessageUrl('0199aa')).toBe('/api/v1/data-health/messages/0199aa/replay');
  });

  it('sends the BRP, the status and the page as separate parameters', () => {
    api.listDataHealthMessages({ brpId: 'b1', status: 'FAILED', page: 3, pageSize: 25 }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/data-health/messages');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('brpId')).toBe('b1');
    expect(req.request.params.get('status')).toBe('FAILED');
    expect(req.request.params.get('page')).toBe('3');
    expect(req.request.params.get('pageSize')).toBe('25');
    req.flush({ items: [], total: 0, page: 3, pageSize: 25 });
  });

  it('omits a filter nobody set rather than sending it empty', () => {
    // `?brpId=` binds as an empty Guid and answers 400, and `?status=` matches no member of
    // InboundMessageStatus. The screen must not be able to ask either question.
    api.listDataHealthMessages({ page: 1, pageSize: 50 }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/data-health/messages');
    expect(req.request.params.has('brpId')).toBe(false);
    expect(req.request.params.has('status')).toBe(false);
    expect(req.request.params.get('pageSize')).toBe('50');
    req.flush({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it('sends the quarantine reason and the resolved flag, including resolved=false', () => {
    // FALSE is the interesting one. `if (filter.resolved)` drops it, and the panel then shows
    // every entry ever raised under a heading that says "held now" — a wrong list, not an error.
    api.listQuarantine({ reason: 'WRONG_BRP', resolved: false, page: 1, pageSize: 50 }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/v1/data-health/quarantine');
    expect(req.request.params.get('reason')).toBe('WRONG_BRP');
    expect(req.request.params.get('resolved')).toBe('false');
    req.flush({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it('sends silentOnly=true for the silent filter and omits it otherwise', () => {
    api.listDataHealthMeteringPoints({ silentOnly: true, page: 1, pageSize: 50 }).subscribe();
    const silent = http.expectOne((r) => r.url === '/api/v1/data-health/metering-points');
    expect(silent.request.params.get('silentOnly')).toBe('true');
    silent.flush({ items: [], total: 0, page: 1, pageSize: 50 });

    api.listDataHealthMeteringPoints({ page: 1, pageSize: 50 }).subscribe();
    const all = http.expectOne((r) => r.url === '/api/v1/data-health/metering-points');
    expect(all.request.params.has('silentOnly')).toBe(false);
    all.flush({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it('POSTs a replay to the message it names, with an empty body', () => {
    let outcome: string | undefined;
    api.replayMessage('m-7').subscribe((r) => (outcome = r.outcome));

    const req = http.expectOne('/api/v1/data-health/messages/m-7/replay');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({
      inboundMessageId: 'm-7',
      correlationId: 'c-7',
      outcome: 'NO_CHANGE',
      versionsCreated: 0,
      quarantineEntriesResolved: 0,
      failureCode: null,
      failureDetail: null,
    });

    expect(outcome).toBe('NO_CHANGE');
  });
```

- [ ] **Step 3: Write the failing narrowing pin**

Append to `libs/api-client-employee/src/lib/employee-api.types.spec.ts`, following that file's own
compile-time-pin convention:

```ts
describe('numeric narrowing on the data-health envelopes', () => {
  it('narrows every integer the ingestion screens do arithmetic on', () => {
    const message: DataHealthMessage = {
      id: 'm1',
      brpId: 'b1',
      brpCode: 'PVNED',
      correlationId: 'c1',
      receivedAt: '2026-08-13T04:02:11Z',
      status: 'PROCESSED',
      payloadBytes: 41822,
      remoteIp: '10.0.0.7',
      failureCode: null,
      failureDetail: null,
      processedAt: '2026-08-13T04:02:12Z',
      versionCount: 2,
      quarantinedSeriesCount: 0,
    };

    // Each of these type-checks ONLY while the field stays narrowed. Widen one back to
    // `number | string` in employee-api.types.ts and the assignment stops compiling, which fails
    // the whole `ng test employee-portal` bundle rather than this one test.
    const payloadBytes: number = message.payloadBytes;
    const versionCount: number = message.versionCount;
    const quarantined: number = message.quarantinedSeriesCount;

    expect(payloadBytes + versionCount + quarantined).toBe(41824);
  });

  it('narrows the page envelope, so a pager can add to it', () => {
    const page: QuarantineListResponse = { items: [], total: 3, page: 1, pageSize: 50 };

    const total: number = page.total;
    const number: number = page.page;
    const size: number = page.pageSize;

    // The arithmetic a pager actually does. On a `number | string` union `number * size` is a
    // type error, and `page.page + 1` on the string arm is the concatenation "11".
    expect(total <= number * size).toBe(true);
  });

  it('narrows ageHours, which the quarantine panel sorts on', () => {
    const series: QuarantinedSeries = {
      id: 'q1',
      inboundMessageId: 'm1',
      brpCode: 'PVNED',
      reason: 'UNKNOWN_EAN',
      resourceObject: '871685900000000042',
      deliveryDate: '2026-08-12',
      direction: 'CONSUMPTION',
      pointCount: 96,
      receivedAt: '2026-08-13T04:02:11Z',
      ageHours: 26,
      resolvedAt: null,
      resolvedBy: null,
    };

    const ageHours: number = series.ageHours;
    const pointCount: number = series.pointCount;

    expect(Math.floor(ageHours / 24)).toBe(1);
    expect(pointCount).toBe(96);
  });
});
```

adding the four names to that file's existing `import type { … } from './employee-api.types';`.

- [ ] **Step 4: Run them and watch them fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: FAIL — `error TS2305: Module './employee-api.types' has no exported member
'DataHealthMessage'`, which fails the bundle before any test runs.

(`libs/api-client-employee/src/**/*.spec.ts` runs inside the employee-portal target — see
`angular.json:120-122`.)

- [ ] **Step 5: Add the type aliases**

Append to `libs/api-client-employee/src/lib/employee-api.types.ts`, after the `Brp` alias (`:35`):

```ts
// ── Data health — shared contract §10.4, FROZEN ─────────────────────────────
//
// The back office is unscoped by construction: there is no customer_id claim, no company switcher
// and no query filter behind any of these. A cross-customer read is an ordinary read here.
//
// ⚠ `status`, `reason`, `outcome`, `state` and `direction` are `string`, not unions. Plan 6
// declares all five as `string` on the C# records so that `PeakPower.Contracts` can keep
// referencing nothing, so openapi-typescript emits `string` and there is no closed set to alias.
// The vocabularies live in `data-feeds-labels.ts` with a named fallback on every lookup.
export type EmployeeDayState = Schemas['EmployeeDayStateDto'];

export type DataHealthMessage = Omit<
  Schemas['DataHealthMessageDto'],
  'payloadBytes' | 'versionCount' | 'quarantinedSeriesCount'
> & {
  payloadBytes: number;
  versionCount: number;
  quarantinedSeriesCount: number;
};

export type DataHealthMessageListResponse = Omit<
  Schemas['DataHealthMessageListResponse'],
  'items' | 'total' | 'page' | 'pageSize'
> & {
  items: DataHealthMessage[];
  total: number;
  page: number;
  pageSize: number;
};

export type QuarantinedSeries = Omit<
  Schemas['QuarantinedSeriesDto'],
  'pointCount' | 'ageHours'
> & {
  pointCount: number;
  ageHours: number;
};

export type QuarantineListResponse = Omit<
  Schemas['QuarantineListResponse'],
  'items' | 'total' | 'page' | 'pageSize'
> & {
  items: QuarantinedSeries[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * ⚠ `brpId` and `brpCode` are NULLABLE here and NOT NULL in the database. Design §3.1 requires
 * this list to include points with no balance responsible party assigned, because a point can be
 * created in the back office before it is routed to one — and a point with no BRP is precisely
 * the point an operator is looking for when a document quarantines as `UNKNOWN_EAN`.
 */
export type DataHealthMeteringPoint = Schemas['DataHealthMeteringPointDto'];

export type DataHealthMeteringPointListResponse = Omit<
  Schemas['DataHealthMeteringPointListResponse'],
  'items' | 'total' | 'page' | 'pageSize'
> & {
  items: DataHealthMeteringPoint[];
  total: number;
  page: number;
  pageSize: number;
};

export type ReplayMessageResponse = Omit<
  Schemas['ReplayMessageResponse'],
  'versionsCreated' | 'quarantineEntriesResolved'
> & {
  versionsCreated: number;
  quarantineEntriesResolved: number;
};

/** What each list call may ask for. Every field is optional but `page` and `pageSize`. */
export interface MessageFilter {
  readonly brpId?: string;
  readonly status?: string;
  readonly page: number;
  readonly pageSize: number;
}

export interface QuarantineFilter {
  readonly reason?: string;
  /** ⚠ `false` is a REAL value here, not an absence. See the client's own note. */
  readonly resolved?: boolean;
  readonly page: number;
  readonly pageSize: number;
}

export interface MeteringPointHealthFilter {
  readonly state?: string;
  readonly silentOnly?: boolean;
  readonly page: number;
  readonly pageSize: number;
}
```

- [ ] **Step 6: Add the URL builders and the four calls**

In `libs/api-client-employee/src/lib/employee-api.client.ts`, add to the imported type list at
`:7-23` (alphabetical, so `DataHealthMessageListResponse`, `DataHealthMeteringPointListResponse`,
`MessageFilter`, `MeteringPointHealthFilter`, `QuarantineFilter`, `QuarantineListResponse`,
`ReplayMessageResponse` slot in around `CustomerListResponse` and `EmployeeSignInRequest`).

Add the URL builders after `brpsUrl()` (which ends at `:54`):

```ts
  dataHealthMessagesUrl(): string {
    return `${this.baseUrl}/data-health/messages`;
  }
  dataHealthQuarantineUrl(): string {
    return `${this.baseUrl}/data-health/quarantine`;
  }
  dataHealthMeteringPointsUrl(): string {
    return `${this.baseUrl}/data-health/metering-points`;
  }
  replayMessageUrl(id: string): string {
    return `${this.dataHealthMessagesUrl()}/${id}/replay`;
  }
```

Add the four calls after `listBrps` (which ends at `:170`). ⚠ **`HttpParams` is immutable** — `set`
and `append` RETURN a new instance and mutate nothing — so every optional filter below reassigns:

```ts
  // ── Data health ─────────────────────────────────────────────────────────
  //
  // No `withCredentials` on any of these: the refresh cookie is path-scoped to /auth/refresh and
  // has no business on a back-office read.

  listDataHealthMessages(filter: MessageFilter): Observable<DataHealthMessageListResponse> {
    let params = pageParams(filter.page, filter.pageSize);
    params = optional(params, 'brpId', filter.brpId);
    params = optional(params, 'status', filter.status);
    return this.http.get<DataHealthMessageListResponse>(this.dataHealthMessagesUrl(), { params });
  }

  listQuarantine(filter: QuarantineFilter): Observable<QuarantineListResponse> {
    let params = pageParams(filter.page, filter.pageSize);
    params = optional(params, 'reason', filter.reason);
    // NOT `if (filter.resolved)`. `resolved=false` is the panel's DEFAULT question — "what is
    // held right now" — and a truthiness test drops it, so the panel silently lists every entry
    // ever raised, resolved ones included, under a heading that says otherwise.
    if (filter.resolved !== undefined) {
      params = params.set('resolved', String(filter.resolved));
    }
    return this.http.get<QuarantineListResponse>(this.dataHealthQuarantineUrl(), { params });
  }

  listDataHealthMeteringPoints(
    filter: MeteringPointHealthFilter,
  ): Observable<DataHealthMeteringPointListResponse> {
    let params = pageParams(filter.page, filter.pageSize);
    params = optional(params, 'state', filter.state);
    if (filter.silentOnly !== undefined) {
      params = params.set('silentOnly', String(filter.silentOnly));
    }
    return this.http.get<DataHealthMeteringPointListResponse>(
      this.dataHealthMeteringPointsUrl(),
      { params },
    );
  }

  /**
   * [F02-R27]. The replay reads the STORED raw payload and goes back through the same adapter the
   * stored `brp_id` selects — including after that BRP has been deactivated (S2-D3) — so this is
   * a re-application of a document the system already holds, not a re-fetch from anybody.
   *
   * An empty body, deliberately: everything the endpoint needs is the id in the path. A body of
   * `null` sends no Content-Type and some proxies drop the request.
   */
  replayMessage(id: string): Observable<ReplayMessageResponse> {
    return this.http.post<ReplayMessageResponse>(this.replayMessageUrl(id), {});
  }
```

and the two helpers at the bottom of the file:

```ts
/** `?page=1&pageSize=50`. Both are always sent — §10.4's envelopes echo them back. */
function pageParams(page: number, pageSize: number): HttpParams {
  return new HttpParams().set('page', String(page)).set('pageSize', String(pageSize));
}

/**
 * One optional string filter.
 *
 * A blank or undefined value sends NO parameter rather than an empty one: `?brpId=` binds as an
 * empty Guid and answers 400, and `?status=` matches no `InboundMessageStatus` member and answers
 * an empty page — a wrong list rather than an error, which is the worse of the two.
 *
 * `HttpParams` is immutable, so this RETURNS the new instance. A caller that writes
 * `optional(params, …)` as a statement compiles, runs, and filters nothing.
 */
function optional(params: HttpParams, key: string, value: string | undefined): HttpParams {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? params : params.set(key, trimmed);
}
```

- [ ] **Step 7: Run them and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: PASS.

- [ ] **Step 8: Mutation check — `resolved=false` dropped by truthiness**

In `employee-api.client.ts`, write the test a reader expects:

```ts
    if (filter.resolved) {
      params = params.set('resolved', String(filter.resolved));
    }
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: **FAIL** — `sends the quarantine reason and the resolved flag, including resolved=false`
reports `expected null to be 'false'`. Predicted before running: `omits a filter nobody set rather
than sending it empty` stays **green**, because `undefined` is falsy too and that test only ever
asks for absence. The two cases are indistinguishable under truthiness and mean opposite things:
one is "do not filter", the other is "filter to the unresolved". **Restore immediately.**

- [ ] **Step 9: Mutation check — the immutable `HttpParams`**

In `optional`, drop the return:

```ts
function optional(params: HttpParams, key: string, value: string | undefined): HttpParams {
  const trimmed = value?.trim() ?? '';
  if (trimmed !== '') params.set(key, trimmed);
  return params;
}
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: **FAIL** — `sends the BRP, the status and the page as separate parameters` reports
`expected null to be 'b1'`. This compiles, runs, throws nothing, and sends an unfiltered request:
the message log would show every BRP's traffic under a heading naming one. **Restore immediately.**

- [ ] **Step 10: Prove the drift guard is satisfied and commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && \
  PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform npm run verify:clients
```

Expected: `@peakpower-nl/api-client-employee: up to date` and
`@peakpower-nl/api-client-customer: up to date`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/api-client-employee
git commit -m "feat(api-client-employee): the four data-health calls

Regenerated from the platform's OpenAPI document and committed [DEC-116], plus aliases for
the three list envelopes and the replay response, the eleven integers narrowed at the
client boundary the way slice 1's eight already are, and the four calls behind them.

resolved=false is sent, not dropped. Verified by mutation: an `if (filter.resolved)` test
leaves the absence test green and turns 'what is held right now' into 'everything ever
raised'. Dropping the HttpParams return from `optional` sends an unfiltered request and
throws nothing."
```

---

### Task 15: Open the `Data & feeds` rail row, the `/data-feeds` area, and its vocabulary

The employee half of task 7, plus the one file every screen below reads. Four things move together
here and a commit carrying three of them is a red suite: the rail row, the route, the home page's
two lists, and the labels the three panels share.

⚠ **`home-page.spec.ts:32` is a pinned literal nothing in the contract lists, and enabling this row
breaks it.** `it('names the two live areas and every deferred one')` asserts
`expect(text).toContain('Data & feeds')` against the whole page, and the page prints that label
**only** from `HomePage.deferred` — the "Live now" list at `home-page.ts:37-51` is two hardcoded
`<li>`s. The moment `data-feeds` gains a path it leaves `deferred`, the label leaves the document
entirely, and that test goes red. Verify it yourself before writing anything:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && \
  grep -rn "Data & feeds" apps/employee-portal/src > /tmp/pp-data-feeds.txt; cat /tmp/pp-data-feeds.txt
```

Expected: three lines — `employee-nav.ts:47` (the label), `employee-nav.spec.ts:15` (the ordered
label list, which stays green because the row does not move), and `home-page.spec.ts:32`.

⚠ **`employee-nav.spec.ts:36` is the second one**: `expect(enabled).toEqual(['home', 'customers',
'reference-data'])`, and the order is the rail's own — `data-feeds` sits **before** `reference-data`
in `ITEMS` (`employee-nav.ts:45-58`), so the new list is `['home', 'customers', 'data-feeds',
'reference-data']` and not an append.

⚠ **`app.routes.spec.ts` needs no literal edit and will still catch a mistake.** It asserts that
every registered route has an *enabled* rail item whose `path` is exactly `/<topSegment>`
(`:45-59`), and that every enabled item's path resolves back to its own routeKey (`:61-71`). Adding
the route without enabling the row fails the first; enabling the row with a path of `/data` or
`/datafeeds` fails the second. That is the guard, and it is stronger than a list.

**Files:**
- Modify: `apps/employee-portal/src/app/shell/employee-nav.ts:45-52` (the `data-feeds` item)
- Modify: `apps/employee-portal/src/app/shell/employee-nav.spec.ts:34-37`
- Modify: `apps/employee-portal/src/app/app.routes.ts:43` (insert after the `reference-data` route)
- Modify: `apps/employee-portal/src/app/features/home/home-page.ts:31-52` (the banner and the live list)
- Modify: `apps/employee-portal/src/app/features/home/home-page.spec.ts:21-34`
- Create: `apps/employee-portal/src/app/features/data-feeds/data-feeds.routes.ts`
- Create: `apps/employee-portal/src/app/features/data-feeds/data-feeds-tabs.ts`
- Create: `apps/employee-portal/src/app/features/data-feeds/data-feeds-labels.ts`
- Test: `apps/employee-portal/src/app/features/data-feeds/data-feeds-labels.spec.ts`

**Interfaces:**
- Consumes: `authenticatedGuard`; `PpTone` from `@peakpower-nl/shared-ui`.
- Produces:
  - `EMPLOYEE_NAV`'s `data-feeds` item with `path: '/data-feeds'` and no `disabledReason`
  - `export const DATA_FEEDS_ROUTES: Routes` — `messages` (default), `quarantine`, `connections`
  - `export class PpDataFeedsTabs` — selector `pp-data-feeds-tabs`, no inputs
  - `export function messageStatusLabel(value: string): string`
  - `export function messageStatusTone(value: string): PpTone`
  - `export function quarantineReasonLabel(value: string): string`
  - `export function quarantineResolution(value: string): string`
  - `export function failureCodeSentence(code: string | null): string`
  - `export function dayStateLetter(value: string): string`
  - `export function dayStateWord(value: string): string`
  - `export const DAY_STATE_LEGEND: readonly { letter: string; word: string }[]`
  - `export const UNRECOGNISED_STATUS`, `UNRECOGNISED_REASON`, `UNRECOGNISED_FAILURE`

- [ ] **Step 1: Write the failing tests**

Edit `apps/employee-portal/src/app/shell/employee-nav.spec.ts:34-37`:

```ts
  it('enables Home, Customers, Data & feeds and Reference data', () => {
    const enabled = items.filter((i) => i.path !== null).map((i) => i.routeKey);
    // The rail's OWN order — data-feeds sits above reference-data in ITEMS, so this is not an
    // append. A sorted comparison here would hide a row that moved.
    expect(enabled).toEqual(['home', 'customers', 'data-feeds', 'reference-data']);
  });

  it('no longer says ingestion is still to arrive', () => {
    const reasons = items.map((i) => i.disabledReason ?? '');

    expect(reasons.join(' ')).not.toContain('Ingestion and the BRP feed arrive with feature F02.');
  });
```

Edit `apps/employee-portal/src/app/features/home/home-page.spec.ts:21-34` — the test that breaks:

```ts
  it('names the three live areas and every deferred one', async () => {
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Customers');
    expect(text).toContain('Reference data');
    expect(text).toContain('Data & feeds');
    expect(text).toContain('Trade desk');
    expect(text).toContain('Wallets');
    expect(text).toContain('Settlements');
    expect(text).toContain('Audit');
  });

  it('moves Data & feeds out of the deferred list and into the live one', async () => {
    // The assertion above is page-wide and would have stayed green with the label printed by
    // EITHER list — which is exactly how it passed while the row was disabled. Scoped to the two
    // cards, it says which one.
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    await fixture.whenStable();

    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('pp-card');
    expect(cards[0].textContent).toContain('Data & feeds');
    expect(cards[1].textContent).not.toContain('Data & feeds');
  });

  it('links to the ingestion area', async () => {
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    await fixture.whenStable();

    const link = (fixture.nativeElement as HTMLElement).querySelector('a[href="/data-feeds"]');
    expect(link).not.toBeNull();
  });
```

Create `apps/employee-portal/src/app/features/data-feeds/data-feeds-labels.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  DAY_STATE_LEGEND,
  UNRECOGNISED_FAILURE,
  UNRECOGNISED_REASON,
  UNRECOGNISED_STATUS,
  dayStateLetter,
  dayStateWord,
  failureCodeSentence,
  messageStatusLabel,
  messageStatusTone,
  quarantineReasonLabel,
  quarantineResolution,
} from './data-feeds-labels';

const STATUSES = ['RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DUPLICATE'] as const;
const REASONS = ['UNKNOWN_EAN', 'EAN_VALIDITY', 'WRONG_BRP', 'NOT_ELECTRICITY'] as const;
const STATES = ['NO_DATA', 'PARTIAL', 'PROVISIONAL', 'FINAL'] as const;

/** Shared contract §8.4, in the source's own order: eleven, plus the two decided in §16. */
const FAILURE_CODES = [
  'UNSUPPORTED_DOCUMENT_TYPE',
  'WRONG_RECEIVER',
  'UNKNOWN_SENDER',
  'UNSUPPORTED_RESOLUTION',
  'UNSUPPORTED_CURVE_TYPE',
  'INVALID_MEASUREMENT_PERIOD',
  'INCOMPLETE_PERIOD',
  'INVALID_POSITIONS',
  'NEGATIVE_QUANTITY',
  'UNKNOWN_METERING_POINT',
  'WRONG_BRP_FOR_METERING_POINT',
  'UNSUPPORTED_DIRECTION',
  'UNSUPPORTED_MEASUREMENT_UNIT',
] as const;

describe('data-feeds labels', () => {
  it('covers every InboundMessageStatus member', () => {
    for (const status of STATUSES) {
      expect(messageStatusLabel(status), `${status} has no label`).not.toBe(UNRECOGNISED_STATUS);
    }
  });

  it('covers every QuarantineReason, with a sentence saying what resolves it', () => {
    for (const reason of REASONS) {
      expect(quarantineReasonLabel(reason), `${reason} has no label`).not.toBe(UNRECOGNISED_REASON);
      expect(quarantineResolution(reason).endsWith('.'), `${reason} resolution is a sentence`)
        .toBe(true);
    }
  });

  it('says plainly that NOT_ELECTRICITY has no resolution, rather than offering one', () => {
    // The other three are resolved by registering, correcting or reassigning a connection and
    // replaying. This one is not: PeakPower carries electricity connections only, so an operator
    // told to "register the EAN" would go looking for a screen that will refuse them.
    expect(quarantineResolution('NOT_ELECTRICITY')).toContain('Nothing resolves this');
    expect(quarantineResolution('UNKNOWN_EAN')).toContain('Replay');
  });

  it('covers all thirteen §8.4 failure codes', () => {
    for (const code of FAILURE_CODES) {
      expect(failureCodeSentence(code), `${code} has no sentence`).not.toBe(UNRECOGNISED_FAILURE);
    }
  });

  it('answers an unrecognised value with a named sentence, never with the raw wire value', () => {
    // A Record<Union, string> types every lookup as `string`, but these values came off the wire
    // as `string` and the union is this file's own invention. An unmapped member is `undefined`
    // at runtime and prints the word "undefined" on the operator's screen.
    expect(messageStatusLabel('QUEUED')).toBe(UNRECOGNISED_STATUS);
    expect(messageStatusLabel('QUEUED')).not.toContain('QUEUED');
    expect(quarantineReasonLabel('BAD_EAN')).toBe(UNRECOGNISED_REASON);
    expect(failureCodeSentence('SOMETHING_NEW')).toBe(UNRECOGNISED_FAILURE);
    expect(messageStatusTone('QUEUED')).toBe('neutral');
    expect(dayStateLetter('COMPLETE')).toBe('?');
  });

  it('answers a null failure code with an empty string, not with the unrecognised sentence', () => {
    // `failureCode` is null on every PROCESSED message. "Unrecognised failure" under a row that
    // did not fail is a worse answer than nothing at all.
    expect(failureCodeSentence(null)).toBe('');
  });

  it('gives the four day states the mockup letters, and there is no fifth', () => {
    // employee-ingestion-health.svg's legend: N no data / A partial / P provisional / F final.
    // ⚠ PARTIAL is `A`, not `P` — P is taken — which is why the legend prints the WORD beside
    // every letter and no screen prints the letter alone.
    expect(STATES.map(dayStateLetter)).toEqual(['N', 'A', 'P', 'F']);
    expect(STATES.map(dayStateWord)).toEqual(['No data', 'Partial', 'Provisional', 'Final']);
    // The mockup also draws a `C corrected` cell. DayStateDto carries no correction flag and
    // MeteringDayState has four members (shared contract §4), so a C would be a mark nothing
    // produced.
    expect(DAY_STATE_LEGEND).toHaveLength(4);
    expect(DAY_STATE_LEGEND.map((entry) => entry.letter)).not.toContain('C');
  });

  it('writes every label in sentence case, with no SCREAMING_SNAKE leaking through', () => {
    const everyLabel = [
      ...STATUSES.map(messageStatusLabel),
      ...REASONS.map(quarantineReasonLabel),
      ...FAILURE_CODES.map(failureCodeSentence),
      ...STATES.map(dayStateWord),
    ];

    for (const label of everyLabel) {
      expect(label).not.toMatch(/[A-Z]{2,}_/);
      expect(label).not.toMatch(/^[A-Z][A-Z_0-9]*$/);
    }
  });

  it('uses no emoji and no euro figure anywhere', () => {
    // S2-D6 reaches the back office too: nothing on these three screens carries a price.
    const everything = [
      ...STATUSES.map(messageStatusLabel),
      ...REASONS.map(quarantineReasonLabel),
      ...REASONS.map(quarantineResolution),
      ...FAILURE_CODES.map(failureCodeSentence),
    ].join(' ');

    expect(everything).not.toContain('€');
    expect(everything).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: FAIL — `Failed to resolve import "./data-feeds-labels"`, plus
`enables Home, Customers, Data & feeds and Reference data` reporting
`expected [ 'home', 'customers', 'reference-data' ] to deeply equal [ 'home', 'customers', 'data-feeds', 'reference-data' ]`,
plus `moves Data & feeds out of the deferred list and into the live one` reporting
`expected '… Reference data …' to contain 'Data & feeds'`.

- [ ] **Step 3: Write the vocabulary**

Create `apps/employee-portal/src/app/features/data-feeds/data-feeds-labels.ts`:

```ts
import type { PpTone } from '@peakpower-nl/shared-ui';

/**
 * Wire value → the sentence an operator reads, in one file, for all three ingestion-health panels.
 *
 * ⚠ Every value these functions take is a plain `string`. Plan 6 declares `Status`, `Reason`,
 * `Outcome`, `Direction` and `State` as `string` on the C# records so `PeakPower.Contracts` can go
 * on referencing nothing, so `openapi-typescript` emits `string` and there is no closed union to
 * switch over exhaustively. The unions below are this file's own, and every lookup therefore
 * carries a NAMED fallback: a `Record<Union, string>` types the result as `string`, but an
 * unmapped member is `undefined` at runtime and prints the word "undefined" to an operator who is
 * trying to work out why a document failed.
 *
 * Sentence case throughout, per the copy rules. ALL CAPS is for stat-card labels and column heads,
 * and `pp-stat-card` and `pp-grid-table` apply that themselves.
 */

export const UNRECOGNISED_STATUS = 'Unrecognised status';
export const UNRECOGNISED_REASON = 'Unrecognised quarantine reason';
export const UNRECOGNISED_FAILURE = 'Unrecognised failure code';

type MessageStatus = 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'DUPLICATE';

const MESSAGE_STATUS_LABEL: Readonly<Record<MessageStatus, string>> = Object.freeze({
  RECEIVED: 'Received',
  PROCESSING: 'Processing',
  PROCESSED: 'Processed',
  FAILED: 'Failed',
  DUPLICATE: 'Duplicate',
});

/**
 * `DUPLICATE` is `neutral`, not `warning`. `[F02-R09]`'s idempotence means a repeated payload is
 * the pipeline working exactly as designed — the sender retried and nothing was written twice —
 * and an amber row per retry teaches an operator to ignore amber.
 */
const MESSAGE_STATUS_TONE: Readonly<Record<MessageStatus, PpTone>> = Object.freeze({
  RECEIVED: 'neutral',
  PROCESSING: 'info',
  PROCESSED: 'success',
  FAILED: 'critical',
  DUPLICATE: 'neutral',
});

export function messageStatusLabel(value: string): string {
  return MESSAGE_STATUS_LABEL[value as MessageStatus] ?? UNRECOGNISED_STATUS;
}

export function messageStatusTone(value: string): PpTone {
  return MESSAGE_STATUS_TONE[value as MessageStatus] ?? 'neutral';
}

type Reason = 'UNKNOWN_EAN' | 'EAN_VALIDITY' | 'WRONG_BRP' | 'NOT_ELECTRICITY';

const REASON_LABEL: Readonly<Record<Reason, string>> = Object.freeze({
  UNKNOWN_EAN: 'EAN not registered',
  EAN_VALIDITY: 'EAN not valid on that delivery date',
  WRONG_BRP: 'EAN belongs to another balance responsible party',
  NOT_ELECTRICITY: 'Not an electricity connection',
});

/**
 * What actually clears the entry. Shared contract §8.5 for the conditions; `[F02-R14]` and
 * `[F02-R15]` for the rule that a quarantined series is **never discarded**.
 *
 * ⚠ `NOT_ELECTRICITY` has no resolution and says so. The other three end in a replay because
 * replaying the stored message is what turns a held series into readings; sending an operator to
 * register a gas connection sends them to a screen that will refuse them.
 */
const REASON_RESOLUTION: Readonly<Record<Reason, string>> = Object.freeze({
  UNKNOWN_EAN:
    'Register this connection against its customer in the back office. Replay the stored message ' +
    'and the held series becomes readings.',
  EAN_VALIDITY:
    'The connection exists but its validity interval does not cover that delivery date. Correct ' +
    'the interval, then replay the stored message.',
  WRONG_BRP:
    'The connection was assigned to another balance responsible party at the time this message ' +
    'was received. Reassign it, then replay the stored message.',
  NOT_ELECTRICITY:
    'Nothing resolves this: PeakPower carries electricity connections only, so this series has ' +
    'nowhere to land. It is kept rather than discarded so the sender can be shown what arrived.',
});

export function quarantineReasonLabel(value: string): string {
  return REASON_LABEL[value as Reason] ?? UNRECOGNISED_REASON;
}

export function quarantineResolution(value: string): string {
  return REASON_RESOLUTION[value as Reason] ?? UNRECOGNISED_REASON;
}

/**
 * Shared contract §8.4's eleven `§8.2` codes, transcribed in the source's own order, plus the two
 * adapter-level codes decided in §16 item 4. **No plan may respell one**, which is why the keys
 * here are the wire strings verbatim and only the sentences are ours.
 *
 * Rejection is total `[F02-R13]`: a failed document writes ZERO interval readings, marks the
 * message FAILED, raises a VALIDATION_FAILURE alert — and still answers the sender 200 `[F02-R05]`.
 * Every sentence below is written so an operator reads it as "nothing landed", not "some landed".
 */
const FAILURE_SENTENCE: Readonly<Record<string, string>> = Object.freeze({
  UNSUPPORTED_DOCUMENT_TYPE:
    'The document type and process type are not a combination this adapter handles.',
  WRONG_RECEIVER: "The receiver GLN on the document is not PeakPower's.",
  UNKNOWN_SENDER: 'The sender GLN is not the one configured for this balance responsible party.',
  UNSUPPORTED_RESOLUTION: 'The resolution is not PT15M, so the points are not quarter-hours.',
  UNSUPPORTED_CURVE_TYPE: 'The curve type is not A01, so the points are not a sequential series.',
  INVALID_MEASUREMENT_PERIOD:
    'The measurement period does not cover exactly one Amsterdam calendar day.',
  INCOMPLETE_PERIOD:
    'The point count does not match the interval count that date expects — 92, 96 or 100.',
  INVALID_POSITIONS: 'The positions are not contiguous from 1, or one is repeated.',
  NEGATIVE_QUANTITY: 'A quantity is negative, and a metered volume cannot be.',
  UNKNOWN_METERING_POINT: 'The resource object resolves to no registered connection.',
  WRONG_BRP_FOR_METERING_POINT:
    'That connection is assigned to another balance responsible party.',
  UNSUPPORTED_DIRECTION: 'The direction is neither consumption nor production.',
  UNSUPPORTED_MEASUREMENT_UNIT:
    'The measurement unit is a power rather than an energy, so it cannot become a volume in kWh.',
});

/** `null` on every message that did not fail, and an empty string is the honest answer for it. */
export function failureCodeSentence(code: string | null): string {
  if (code === null) return '';
  return FAILURE_SENTENCE[code] ?? UNRECOGNISED_FAILURE;
}

type DayState = 'NO_DATA' | 'PARTIAL' | 'PROVISIONAL' | 'FINAL';

/**
 * `employee-ingestion-health.svg`'s heat-map letters.
 *
 * ⚠ **`PARTIAL` is `A`, not `P`** — `P` is provisional, and the mockup resolves the clash this way
 * rather than by renaming a state. Nothing prints a letter without its word beside it, in the
 * legend or in the cell's own title, because a one-letter cell is unreadable to anyone who has not
 * memorised this table.
 *
 * There are FOUR, not the mockup's five: it also draws `C corrected`, and `EmployeeDayStateDto` is
 * `(Date, State)` with `MeteringDayState` holding exactly four members (shared contract §4). A `C`
 * would be a mark nothing produced.
 */
const DAY_STATE_LETTER: Readonly<Record<DayState, string>> = Object.freeze({
  NO_DATA: 'N',
  PARTIAL: 'A',
  PROVISIONAL: 'P',
  FINAL: 'F',
});

const DAY_STATE_WORD: Readonly<Record<DayState, string>> = Object.freeze({
  NO_DATA: 'No data',
  PARTIAL: 'Partial',
  PROVISIONAL: 'Provisional',
  FINAL: 'Final',
});

export function dayStateLetter(value: string): string {
  return DAY_STATE_LETTER[value as DayState] ?? '?';
}

export function dayStateWord(value: string): string {
  return DAY_STATE_WORD[value as DayState] ?? UNRECOGNISED_STATUS;
}

/** The legend, in the state machine's own order: NO_DATA → PARTIAL → PROVISIONAL → FINAL. */
export const DAY_STATE_LEGEND: readonly { letter: string; word: string }[] = Object.freeze([
  { letter: 'N', word: 'No data' },
  { letter: 'A', word: 'Partial' },
  { letter: 'P', word: 'Provisional' },
  { letter: 'F', word: 'Final' },
]);
```

- [ ] **Step 4: Open the rail row**

In `apps/employee-portal/src/app/shell/employee-nav.ts`, replace the `data-feeds` item (`:45-52`):

```ts
  {
    routeKey: 'data-feeds',
    label: 'Data & feeds',
    path: '/data-feeds',
    dot: 'var(--pp-violet)',
  },
```

⚠ **The `disabledReason` is DELETED, not left behind.** `employee-nav.spec.ts:48-53` asserts that
every item with a path carries no reason, so a leftover one is a red suite here rather than dead
code — which is the better of the two failures.

- [ ] **Step 5: Add the guarded route and its three children**

In `apps/employee-portal/src/app/app.routes.ts`, insert after the `reference-data` route (which
closes at `:43`) and before the wildcard:

```ts
  {
    path: 'data-feeds',
    canActivate: [authenticatedGuard],
    loadChildren: () =>
      import('./features/data-feeds/data-feeds.routes').then((m) => m.DATA_FEEDS_ROUTES),
  },
```

⚠ **`loadChildren`, not `loadComponent`.** Unlike the customer portal's `/consumption`, these three
panels answer three different endpoints with three different filters and share no state at all; the
tab strip is navigation between screens, not a view toggle inside one.

Create `apps/employee-portal/src/app/features/data-feeds/data-feeds.routes.ts`:

```ts
import type { Routes } from '@angular/router';

export const DATA_FEEDS_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'messages' },
  {
    path: 'messages',
    title: 'Inbound messages · PeakPower back office',
    loadComponent: () => import('./message-log-page').then((m) => m.MessageLogPage),
  },
  {
    path: 'quarantine',
    title: 'Quarantine · PeakPower back office',
    loadComponent: () => import('./quarantine-page').then((m) => m.QuarantinePage),
  },
  {
    path: 'connections',
    title: 'Data state per connection · PeakPower back office',
    loadComponent: () => import('./connection-health-page').then((m) => m.ConnectionHealthPage),
  },
];
```

⚠ **Those three components do not exist yet, and that is deliberate.** `loadChildren` and
`loadComponent` are both lazy: nothing imports them until a router actually navigates there, and
`app.routes.spec.ts` never renders a component (it declares no `<router-outlet>`). The route table
therefore compiles and passes now, and the three tasks that follow fill it in. Run
`npm run test:employee-portal` after each one.

- [ ] **Step 6: Add the tab strip**

Create `apps/employee-portal/src/app/features/data-feeds/data-feeds-tabs.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/**
 * The three-tab strip `employee-ingestion-health.svg` draws across all three panels.
 *
 * Real `<a routerLink>`s, not buttons: each tab is a different URL answering a different endpoint,
 * so a tab is a navigation and must be openable in a new tab, bookmarkable and reachable by the
 * back button. `routerLinkActive` puts the state in a class; `ariaCurrentWhenActive` puts the same
 * fact where a screen reader can hear it, which a class alone cannot.
 */
@Component({
  selector: 'pp-data-feeds-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="tabs" aria-label="Ingestion health">
      <a
        class="tab"
        routerLink="/data-feeds/messages"
        routerLinkActive="tab--on"
        ariaCurrentWhenActive="page"
      >Inbound messages</a>
      <a
        class="tab"
        routerLink="/data-feeds/quarantine"
        routerLinkActive="tab--on"
        ariaCurrentWhenActive="page"
      >Quarantine</a>
      <a
        class="tab"
        routerLink="/data-feeds/connections"
        routerLinkActive="tab--on"
        ariaCurrentWhenActive="page"
      >Data state per connection</a>
    </nav>
  `,
  styles: `
    .tabs {
      display: flex; gap: 4px; margin-bottom: 16px;
      border-bottom: 1px solid var(--pp-border);
    }
    /* Class-prefixed, never a bare element selector: design-tokens.spec.ts governs the bare
       anchor rule across both portals and holds it to the link tier (--pp-blue-500), and a tab
       is not a link tier. The .tab prelude is what keeps this a deliberate local override rather
       than a fork of the tier. No backtick appears in this comment on purpose — the guard's own
       styleSheetOf() reads to the first backtick after "styles:" and would stop here. */
    .tab {
      padding: 8px 12px; font-size: 12px; font-weight: 600; text-decoration: none;
      color: var(--pp-text-body); border-bottom: 2px solid transparent;
    }
    .tab:hover { color: var(--pp-text-heading); }
    .tab--on { color: var(--pp-blue-700); border-bottom-color: var(--pp-blue-700); }
  `,
})
export class PpDataFeedsTabs {}
```

- [ ] **Step 7: Move Data & feeds into the home page's live list**

In `apps/employee-portal/src/app/features/home/home-page.ts`, replace the banner (`:31-34`):

```html
    <pp-banner tone="info" heading="Slice 2 — metering data arrives">
      Three areas are live in the back office: Customers, Reference data, and Data &amp; feeds. The
      rest of the rail is shown so the shape of the product is visible, and each row states when it
      arrives.
    </pp-banner>
```

and add a third row to the live list, after the `Reference data` row (`:45-50`):

```html
        <li>
          <span class="name"><a routerLink="/data-feeds">Data &amp; feeds</a></span>
          <span class="reason">
            The inbound message log, the quarantine held for connections nobody has registered
            yet, and the data state of every connection over the last twenty-one delivery dates.
          </span>
        </li>
```

⚠ **`HomePage.deferred` needs no edit.** It filters `EMPLOYEE_NAV` on `path === null`, so step 4
already took the row out of the "Not yet" card. The hardcoded "Live now" list is the half that has
to be told.

- [ ] **Step 8: Run them and watch them pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: PASS — including `app.routes.spec.ts`'s untouched
`gives every registered route a matching, enabled rail item at the exact same path` and
`gives every enabled rail item a path that resolves back to its own routeKey`, both of which now
have a fourth route and a fourth enabled item to check.

- [ ] **Step 9: Mutation check — the route without the rail row**

In `employee-nav.ts`, revert the `data-feeds` item to `path: null` with its old
`disabledReason`, leaving the route in `app.routes.ts`.

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: **FAIL** — `gives every registered route a matching, enabled rail item at the exact same
path` reports `route "data-feeds" has no enabled EMPLOYEE_NAV item with routeKey "data-feeds" — the
rail will never highlight this page`, which is `app.routes.spec.ts:51-52`'s own message. That is the
guard the employee portal has instead of a `GUARDED` list, and it is the one that catches the pair
drifting apart. **Restore immediately.**

- [ ] **Step 10: Mutation check — the unmapped wire value**

In `data-feeds-labels.ts`, drop the fallback on one lookup:

```ts
export function quarantineReasonLabel(value: string): string {
  return REASON_LABEL[value as Reason];
}
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: **FAIL** — `answers an unrecognised value with a named sentence, never with the raw wire
value` reports `expected undefined to be 'Unrecognised quarantine reason'`. Predicted before
running: `covers every QuarantineReason, with a sentence saying what resolves it` stays **green**,
because all four mapped members still resolve. This is the case the exhaustiveness test cannot see:
`Record<Reason, string>` types the return as `string`, TypeScript raises nothing, and a fifth
quarantine reason added by a later slice prints `undefined` on the operator's screen. **Restore
immediately.**

- [ ] **Step 11: Mutation check — the letter that collides**

In `data-feeds-labels.ts`, give `PARTIAL` the letter a reader expects:

```ts
  PARTIAL: 'P',
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: **FAIL** — `gives the four day states the mockup letters, and there is no fifth` reports
`expected [ 'N', 'P', 'P', 'F' ] to deeply equal [ 'N', 'A', 'P', 'F' ]`. Two of the four states
would render the same glyph, and on a 21-cell strip that is a heat map with a state missing rather
than an error. **Restore immediately.**

- [ ] **Step 12: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/employee-portal/src/app/shell/employee-nav.ts \
        apps/employee-portal/src/app/shell/employee-nav.spec.ts \
        apps/employee-portal/src/app/app.routes.ts \
        apps/employee-portal/src/app/features/home/home-page.ts \
        apps/employee-portal/src/app/features/home/home-page.spec.ts \
        apps/employee-portal/src/app/features/data-feeds/data-feeds.routes.ts \
        apps/employee-portal/src/app/features/data-feeds/data-feeds-tabs.ts \
        apps/employee-portal/src/app/features/data-feeds/data-feeds-labels.ts \
        apps/employee-portal/src/app/features/data-feeds/data-feeds-labels.spec.ts
git commit -m "feat(employee-portal): open the Data & feeds area and its vocabulary

Four things moved together, because three of them is a red suite: the rail row gains
path '/data-feeds' and loses its disabledReason, app.routes.ts gains one guarded lazy
children entry, the home page moves the row from 'Not yet' into 'Live now', and the three
panels' shared labels land with their spec.

home-page.spec.ts:32 was a pinned literal the shared contract does not list: it asserted
'Data & feeds' against the whole page, and the page printed that label only from the
DEFERRED list. Now scoped to the two cards, so it says which one.

Verified by mutation: reverting the rail row while leaving the route fails
app.routes.spec.ts's rail-agreement guard with its own message; dropping the named
fallback from a label lookup leaves the exhaustiveness test green and prints 'undefined';
and giving PARTIAL the letter P collides it with PROVISIONAL on a 21-cell strip."
```

---

### Task 16: The inbound message log, filtered by BRP

`employee-ingestion-health.svg`'s `Inbound messages` panel — `[F02-R03]`'s log, which is the only
place an operator can see that a document arrived at all.

⚠ **`rxResource`, not `httpResource`, and the reason is not style.** This plan's Architecture
section names `httpResource` because that is what `brp-list-page.ts:70` uses, and for a call with no
parameters it is the right tool. These three panels are not that call: each one carries filters, and
`httpResource` builds its own request from a URL, so the query-string rules — the `resolved=false`
trap, the blank-filter trap, `page`/`pageSize` always sent — would exist twice, once in
`employee-api.client.ts` under test and once in each screen under none. `rxResource`
(`@angular/core/rxjs-interop`, `@publicApi 22.0`) takes the client's own `Observable` and hands back
the identical `value()` / `isLoading()` / `error()` / `reload()` surface. One copy of the rules, and
the copy that is tested is the copy that runs.

⚠ **Three columns the mockup draws are NOT on the frozen envelope, and are not built.** The mockup's
`TYPE` column shows `A23 allocation` / `A12 imbalance`: `PvnedDocumentType` is **adapter-internal
and never persisted as an enum column** (shared contract §4), so it reaches no DTO and a `TYPE`
column would print a value nothing produces. `DOCUMENTS TODAY` needs a date filter §10.4's message
query does not have (`brpId`, `status`, `page`, `pageSize`, and nothing else), and `PROCESSING LAG`
needs a p95 nothing computes. Build to the envelope, exactly as the day chart does with
`chart-day-view.svg`.

⚠ **`versionCount` and `quarantinedSeriesCount` are the mockup's `SERIES` column, split in two.**
They mean opposite things — one landed, one is being held — and a single count that adds them
together would report a document that quarantined everything as a document that worked.

**Files:**
- Create: `apps/employee-portal/src/app/features/data-feeds/message-log-page.ts`
- Test: `apps/employee-portal/src/app/features/data-feeds/message-log-page.spec.ts`

**Interfaces:**
- Consumes: `EmployeeApiClient.listDataHealthMessages`, `.replayMessage`, `.listBrps` (task 14);
  `messageStatusLabel`, `messageStatusTone`, `failureCodeSentence` (task 15); `PpDataFeedsTabs`
  (task 15); `PpBadge`, `PpButton`, `PpCard`, `PpGridHead`, `PpGridRow`, `PpGridTable`,
  `formatDutchDateTime`, `formatDutchDecimal` from `@peakpower-nl/shared-ui`; `PpFormField` from
  `apps/employee-portal/src/app/shared/form-field.ts`.
- Produces: `export class MessageLogPage` — selector `pp-message-log-page`, and the DOM contract its
  spec pins: `.log__filters`, `#brp-filter`, `#status-filter`, `[ppGridRow]`, `.log__replay`,
  `.log__outcome`, `.log__count`, `.log__empty`.

- [ ] **Step 1: Write the failing test**

Create `apps/employee-portal/src/app/features/data-feeds/message-log-page.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import { provideEmployeeApiTesting } from '@peakpower-nl/api-client-employee';
import type { Brp, DataHealthMessage } from '@peakpower-nl/api-client-employee';

import { MessageLogPage } from './message-log-page';

const MESSAGES_URL = '/api/v1/data-health/messages';
const BRPS_URL = '/api/v1/reference-data/brps';

function message(over: Partial<DataHealthMessage> = {}): DataHealthMessage {
  return {
    id: 'm1',
    brpId: 'b1',
    brpCode: 'PVNED',
    correlationId: '8ff18bca-0000-0000-0000-00000000c6c8',
    receivedAt: '2026-08-13T04:02:11Z',
    status: 'PROCESSED',
    payloadBytes: 41822,
    remoteIp: '10.0.0.7',
    failureCode: null,
    failureDetail: null,
    processedAt: '2026-08-13T04:02:12Z',
    versionCount: 2,
    quarantinedSeriesCount: 0,
    ...over,
  };
}

const BRPS: Brp[] = [
  { id: 'b1', code: 'PVNED', name: 'PVNed', isActive: true },
  { id: 'b2', code: 'ANODE', name: 'Anode', isActive: true },
];

describe('MessageLogPage', () => {
  let fixture: ComponentFixture<MessageLogPage>;
  let http: HttpTestingController;
  let root: HTMLElement;

  /** Renders, then answers both outstanding requests — the BRP list and the first page. */
  function render(items: DataHealthMessage[] = [message()], total = items.length): void {
    TestBed.configureTestingModule({
      providers: [provideEmployeeApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(MessageLogPage, { inferTagName: true });
    fixture.detectChanges();
    http.expectOne(BRPS_URL).flush(BRPS);
    http.expectOne((r) => r.url === MESSAGES_URL).flush({
      items,
      total,
      page: 1,
      pageSize: 50,
    });
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  }

  /** Sets a real <select> and lets the resource re-run, the way an operator does. */
  function choose(id: string, value: string): void {
    const select = root.querySelector<HTMLSelectElement>(`#${id}`);
    if (select === null) throw new Error(`no #${id} on the page`);
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  const rows = () => [...root.querySelectorAll('[ppGridRow]')];
  const cellsOf = (row: Element) =>
    [...row.children].map((c) => c.textContent?.replace(/\s+/g, ' ').trim() ?? '');

  afterEach(() => {
    try {
      http.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('asks for the first page of every BRP on mount', () => {
    TestBed.configureTestingModule({
      providers: [provideEmployeeApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(MessageLogPage, { inferTagName: true });
    fixture.detectChanges();

    http.expectOne(BRPS_URL).flush(BRPS);
    const req = http.expectOne((r) => r.url === MESSAGES_URL);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('pageSize')).toBe('50');
    // No filter until an operator sets one: an empty brpId binds as an empty Guid and 400s.
    expect(req.request.params.has('brpId')).toBe(false);
    expect(req.request.params.has('status')).toBe(false);
    req.flush({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it('re-asks with the BRP an operator picked, and by its id rather than its code', () => {
    // §10.4 filters on brpId. Sending `PVNED` matches nothing and answers an empty page — a
    // wrong list, not an error, which is the harder failure to notice.
    render();

    choose('brp-filter', 'b2');

    const req = http.expectOne((r) => r.url === MESSAGES_URL);
    expect(req.request.params.get('brpId')).toBe('b2');
    req.flush({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it('re-asks with the status an operator picked', () => {
    render();

    choose('status-filter', 'FAILED');

    const req = http.expectOne((r) => r.url === MESSAGES_URL);
    expect(req.request.params.get('status')).toBe('FAILED');
    req.flush({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it('drops a filter back to unfiltered rather than sending an empty one', () => {
    render();
    choose('brp-filter', 'b2');
    http.expectOne((r) => r.url === MESSAGES_URL).flush({
      items: [], total: 0, page: 1, pageSize: 50,
    });
    fixture.detectChanges();

    choose('brp-filter', '');

    const req = http.expectOne((r) => r.url === MESSAGES_URL);
    expect(req.request.params.has('brpId')).toBe(false);
    req.flush({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it('prints the row in the product time zone, not the host one', () => {
    // 04:02:11Z is 06:02 in Amsterdam. A UTC CI runner and an Amsterdam laptop must agree, which
    // is the whole reason formatDutchDateTime pins the zone.
    render([message({ receivedAt: '2026-08-13T04:02:11Z' })]);

    expect(cellsOf(rows()[0])[0]).toBe('13 aug 2026, 06:02');
  });

  it('keeps the versions that landed and the series being held in separate columns', () => {
    // A single "series" count that added them would report a document whose every series
    // quarantined as a document that worked.
    render([message({ versionCount: 3, quarantinedSeriesCount: 2 })]);

    const cells = cellsOf(rows()[0]);
    expect(cells).toContain('3');
    expect(cells).toContain('2');
    expect(cells).not.toContain('5');
  });

  it('carries the status in its own words and its own tone', () => {
    // FAILED, not the fixture's PROCESSED: a hardcoded badge passes the default.
    render([message({ status: 'FAILED', failureCode: 'INCOMPLETE_PERIOD', processedAt: null })]);

    const badge = rows()[0].querySelector('pp-badge');
    expect(badge?.textContent?.trim()).toBe('Failed');
    expect(badge?.className).toContain('pp-badge--critical');
  });

  it('explains a failure in a sentence rather than printing its code', () => {
    render([message({ status: 'FAILED', failureCode: 'INCOMPLETE_PERIOD', processedAt: null })]);

    const detail = cellsOf(rows()[0]).join(' ');
    expect(detail).toContain('does not match the interval count that date expects');
    // The wire code is an implementation detail of the adapter contract, not something an
    // operator should have to translate.
    expect(detail).not.toContain('INCOMPLETE_PERIOD');
  });

  it('leaves the detail column empty on a message that did not fail', () => {
    // The fixture's own default. Without this the sentence could be printed unconditionally.
    render([message()]);

    expect(cellsOf(rows()[0]).join(' ')).not.toContain('Unrecognised failure code');
  });

  it('replays the message the button belongs to, and says what came back', () => {
    render([message({ id: 'm-7' }), message({ id: 'm-8', correlationId: 'other' })]);

    const button = rows()[1].querySelector<HTMLButtonElement>('.log__replay .pp-button__control');
    button!.click();
    fixture.detectChanges();

    // The SECOND row's id, not the first: a replay wired to the list rather than to the row
    // replays whichever message happens to be at the top.
    const req = http.expectOne('/api/v1/data-health/messages/m-8/replay');
    expect(req.request.method).toBe('POST');
    req.flush({
      inboundMessageId: 'm-8',
      correlationId: 'other',
      outcome: 'NO_CHANGE',
      versionsCreated: 0,
      quarantineEntriesResolved: 0,
      failureCode: null,
      failureDetail: null,
    });
    fixture.detectChanges();

    // [F02-R27]: replaying an already-processed message whose content matches produces no second
    // version, and the count is what says so.
    expect(root.querySelector('.log__outcome')?.textContent).toContain('No change');
    expect(root.querySelector('.log__outcome')?.textContent).toContain('no new version');

    // A replay can change the log, so the list is asked again rather than left stale.
    http.expectOne((r) => r.url === MESSAGES_URL).flush({
      items: [], total: 0, page: 1, pageSize: 50,
    });
  });

  it('names the reason instead of drawing an empty table', () => {
    render([], 0);

    expect(rows()).toHaveLength(0);
    expect(root.querySelector('.log__empty')?.textContent?.trim()).toBe(
      'No message matches this filter. Every document the webhook accepts is logged here, ' +
        'whatever it turned out to contain.',
    );
  });

  it('says how many messages the filter matched, from the envelope and not from the page', () => {
    // `total` is the whole matching set; `items.length` is one page of it. Printing the page
    // length under a heading that says "messages" understates the log by a factor of the page
    // size, and does it silently.
    render([message(), message({ id: 'm2' })], 1841);

    expect(root.querySelector('.log__count')?.textContent).toContain('1.841');
    expect(root.querySelector('.log__count')?.textContent).not.toContain('2 messages');
  });

  it('renders one page heading and no second landmark', () => {
    render();

    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelector('main')).toBeNull();
  });

  it('gives both filters a real label bound to their control', () => {
    render();

    for (const id of ['brp-filter', 'status-filter']) {
      const label = root.querySelector(`label[for="${id}"]`);
      expect(label, `#${id} has no label`).not.toBeNull();
      expect(label!.textContent!.trim().length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: FAIL — `Failed to resolve import "./message-log-page"`.

- [ ] **Step 3: Write the screen**

Create `apps/employee-portal/src/app/features/data-feeds/message-log-page.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import {
  PpBadge,
  PpButton,
  PpCard,
  PpGridHead,
  PpGridRow,
  PpGridTable,
  formatDutchDateTime,
  formatDutchDecimal,
} from '@peakpower-nl/shared-ui';
import type { PpTone } from '@peakpower-nl/shared-ui';
import { EmployeeApiClient } from '@peakpower-nl/api-client-employee';
import type { Brp, DataHealthMessage } from '@peakpower-nl/api-client-employee';

import { PpFormField } from '../../shared/form-field';
import { PpDataFeedsTabs } from './data-feeds-tabs';
import { failureCodeSentence, messageStatusLabel, messageStatusTone } from './data-feeds-labels';

/** One page of the log. §10.4's envelope echoes both values back, so nothing here guesses them. */
const PAGE_SIZE = 50;

export const NO_MESSAGES =
  'No message matches this filter. Every document the webhook accepts is logged here, whatever ' +
  'it turned out to contain.';

/**
 * The inbound BRP message log [F02-R03] — `employee-ingestion-health.svg`'s `Inbound messages`.
 *
 * **Every document the webhook accepted is here, including the ones that failed.** `[F02-R05]`
 * answers a rejected document **200**, deliberately: a BRP that receives a 4xx retries, and a
 * document that is wrong will be just as wrong the second time. The consequence is that this
 * screen is the ONLY place a rejection is visible, which is why a failed row carries a sentence
 * rather than a code and why the table is not filtered to the interesting rows by default.
 *
 * ⚠ **`rxResource`, not `httpResource`.** `httpResource` builds its own request from a URL, which
 * would put the query-string rules in this file as well as in `employee-api.client.ts` — and only
 * the client's copy is under test. This takes the client's own `Observable` and gets the same
 * `value()` / `isLoading()` / `error()` / `reload()` surface back.
 */
@Component({
  selector: 'pp-message-log-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PpBadge,
    PpButton,
    PpCard,
    PpDataFeedsTabs,
    PpFormField,
    PpGridHead,
    PpGridRow,
    PpGridTable,
  ],
  template: `
    <pp-data-feeds-tabs />

    <pp-card
      [headingLevel]="1"
      heading="Inbound messages"
      subtitle="One adapter per balance responsible party, behind the same pipeline"
    >
      <div class="log__filters">
        <pp-form-field label="Balance responsible party" for="brp-filter">
          <select id="brp-filter" [value]="brpId()" (change)="setBrp($event)">
            <option value="">Every party</option>
            @for (brp of brps.value(); track brp.id) {
              <option [value]="brp.id">{{ brp.name }}</option>
            }
          </select>
        </pp-form-field>

        <pp-form-field label="Status" for="status-filter">
          <select id="status-filter" [value]="status()" (change)="setStatus($event)">
            <option value="">Every status</option>
            @for (option of statuses; track option) {
              <option [value]="option">{{ label(option) }}</option>
            }
          </select>
        </pp-form-field>
      </div>

      @if (outcome(); as sentence) {
        <p class="log__outcome" role="status">{{ sentence }}</p>
      }

      @if (messages.error()) {
        <p class="log__empty">
          The message log could not be loaded. The employee API did not answer; try again, and
          check that it is running.
        </p>
      } @else if (messages.isLoading()) {
        <p class="log__empty">Loading the message log…</p>
      } @else if (rows().length > 0) {
        <p class="log__count">{{ countLine() }}</p>
        <pp-grid-table columns="1.1fr 0.7fr 1.6fr 0.6fr 0.7fr 0.9fr 2.2fr 0.9fr" density="dense">
          <div ppGridHead>
            <span>RECEIVED</span>
            <span>BRP</span>
            <span>CORRELATION</span>
            <span>VERSIONS</span>
            <span>HELD</span>
            <span>STATUS</span>
            <span>DETAIL</span>
            <span>REPLAY</span>
          </div>
          @for (row of rows(); track row.id) {
            <div ppGridRow>
              <span>{{ received(row) }}</span>
              <span>{{ row.brpCode }}</span>
              <span class="log__mono">{{ row.correlationId }}</span>
              <span>{{ row.versionCount }}</span>
              <span>{{ row.quarantinedSeriesCount }}</span>
              <span><pp-badge [tone]="tone(row)">{{ statusOf(row) }}</pp-badge></span>
              <span>{{ detail(row) }}</span>
              <span class="log__replay">
                <pp-button variant="secondary" size="sm" [disabled]="replaying() !== null"
                  (click)="replay(row)">Replay</pp-button>
              </span>
            </div>
          }
        </pp-grid-table>
      } @else {
        <p class="log__empty">{{ noMessages }}</p>
      }
    </pp-card>
  `,
  styles: `
    :host { display: grid; gap: 16px; }
    .log__filters { display: flex; gap: 16px; margin-bottom: 14px; }
    .log__filters pp-form-field { width: 220px; }
    .log__count { margin: 0 0 10px; font-size: 11px; color: var(--pp-text-faint); }
    .log__mono {
      font-family: var(--font-mono); font-size: 10.5px; color: var(--pp-text-body);
      overflow: hidden; text-overflow: ellipsis;
    }
    .log__outcome {
      margin: 0 0 14px; padding: 10px 12px; border-radius: 6px;
      border: 1px solid var(--pp-mint-border); background: var(--pp-mint-bg);
      color: var(--pp-mint-text); font-size: 12px;
    }
    .log__empty {
      margin: 0; padding: 22px 10px; font-size: 12.5px; line-height: 1.5;
      color: var(--pp-text-faint); text-align: center;
    }
  `,
})
export class MessageLogPage {
  private readonly api = inject(EmployeeApiClient);

  readonly noMessages = NO_MESSAGES;
  /** In the state machine's own order, which is also the order a document moves through it. */
  readonly statuses = ['RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DUPLICATE'] as const;

  protected readonly brpId = signal('');
  protected readonly status = signal('');
  protected readonly outcome = signal<string | null>(null);
  protected readonly replaying = signal<string | null>(null);

  /**
   * The filter's options. Read-only here; the reference-data screen owns the rows.
   *
   * No `params`: this one has nothing to depend on, so it loads once and never re-runs — which is
   * what `BaseResourceOptions` documents for an omitted params function. `defaultValue` keeps the
   * template's `@for` off `undefined` during that first load.
   */
  protected readonly brps = rxResource({
    stream: () => this.api.listBrps(),
    defaultValue: [] as Brp[],
  });

  protected readonly messages = rxResource({
    // Every signal the request depends on is READ here. A filter read inside `stream` instead
    // is not a dependency, and the resource then never re-runs when it changes.
    params: () => ({ brpId: this.brpId(), status: this.status() }),
    stream: ({ params }) =>
      this.api.listDataHealthMessages({
        // Empty means "no filter", and the client turns that into no parameter at all.
        brpId: params.brpId === '' ? undefined : params.brpId,
        status: params.status === '' ? undefined : params.status,
        page: 1,
        pageSize: PAGE_SIZE,
      }),
  });

  protected readonly rows = computed<DataHealthMessage[]>(
    () => this.messages.value()?.items ?? [],
  );

  /**
   * ⚠ `total`, never `rows().length`. The envelope's total is the whole matching set and the
   * items are one page of it, so printing the page length understates the log by up to a factor
   * of the page size — and does it with a plausible number.
   */
  protected readonly countLine = computed(() => {
    const total = this.messages.value()?.total ?? 0;
    return `${formatDutchDecimal(total, 0)} messages match this filter`;
  });

  protected setBrp(event: Event): void {
    this.brpId.set((event.target as HTMLSelectElement).value);
    this.outcome.set(null);
  }

  protected setStatus(event: Event): void {
    this.status.set((event.target as HTMLSelectElement).value);
    this.outcome.set(null);
  }

  protected label(value: string): string {
    return messageStatusLabel(value);
  }

  protected statusOf(row: DataHealthMessage): string {
    return messageStatusLabel(row.status);
  }

  protected tone(row: DataHealthMessage): PpTone {
    return messageStatusTone(row.status);
  }

  /** Amsterdam, never the host: a CI runner and an operator's laptop must read the same row. */
  protected received(row: DataHealthMessage): string {
    return formatDutchDateTime(row.receivedAt);
  }

  protected detail(row: DataHealthMessage): string {
    return failureCodeSentence(row.failureCode);
  }

  /**
   * [F02-R27]. The outcome is reported from the response rather than assumed, because
   * `NO_CHANGE` is the interesting answer and it looks exactly like success from here: the call
   * returns 200 either way, and only `versionsCreated` distinguishes a replay that wrote
   * something from one that correctly wrote nothing.
   */
  protected replay(row: DataHealthMessage): void {
    if (this.replaying() !== null) return;
    this.replaying.set(row.id);
    this.outcome.set(null);

    this.api.replayMessage(row.id).subscribe({
      next: (result) => {
        this.replaying.set(null);
        this.outcome.set(replayOutcomeLine(result.outcome, result.versionsCreated,
          result.quarantineEntriesResolved));
        // A replay can create a version and resolve a quarantine entry, so both counts on this
        // row are now stale. Re-asking is cheaper than reasoning about which fields moved.
        this.messages.reload();
      },
      error: () => {
        this.replaying.set(null);
        this.outcome.set(
          'The replay could not be sent. The employee API did not answer; try again, and check ' +
            'that it is running.',
        );
      },
    });
  }
}

/**
 * What came back, in words. `NO_CHANGE` is [F02-R27]'s idempotence and reads as a RESULT rather
 * than as a failure: the message was re-applied, its content matched the current version, and no
 * second version was written. An operator who reads that as "nothing happened" replays again.
 */
export function replayOutcomeLine(
  outcome: string,
  versionsCreated: number,
  quarantineEntriesResolved: number,
): string {
  const resolved =
    quarantineEntriesResolved > 0
      ? ` ${quarantineEntriesResolved} quarantined series resolved into readings.`
      : '';
  switch (outcome) {
    case 'REPLAYED':
      return `Replayed. ${versionsCreated} new version written.${resolved}`;
    case 'NO_CHANGE':
      return 'No change. The stored message was re-applied and its content already matched the ' +
        'current version, so no new version was written.';
    case 'FAILED':
      return 'The replay failed and wrote nothing. A rejection is total, so the stored readings ' +
        'are exactly as they were.';
    default:
      return `The replay answered with an outcome this screen does not recognise.${resolved}`;
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: PASS.

⚠ If `carries the status in its own words and its own tone` reports "found none", check that
`PpBadge` is in the `imports` array. An unimported component renders as an unknown element with no
error in a zoneless TestBed, and every DOM assertion under it reports "found none".

- [ ] **Step 5: Mutation check — the count that comes off the page**

In `message-log-page.ts`, count the rows on screen instead:

```ts
  protected readonly countLine = computed(
    () => `${formatDutchDecimal(this.rows().length, 0)} messages match this filter`,
  );
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: **FAIL** — `says how many messages the filter matched, from the envelope and not from the
page` reports `expected '2 messages match this filter' to contain '1.841'`. Predicted before
running: every other test stays **green**, because their fixtures set `total` to the item count —
which is why this one deliberately does not. **Restore immediately.**

- [ ] **Step 6: Mutation check — the replay wired to the list**

In `message-log-page.ts`, replay the first row whatever button was pressed:

```ts
  protected replay(): void {
    const row = this.rows()[0];
    if (row === undefined || this.replaying() !== null) return;
    this.replaying.set(row.id);
    …
  }
```

(and drop the argument at the template's call site, so it still compiles).

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: **FAIL** — `replays the message the button belongs to, and says what came back` reports
`Expected one matching request for criteria "Match URL: /api/v1/data-health/messages/m-8/replay",
found none. Requests received are: POST /api/v1/data-health/messages/m-7/replay.` Replaying the
wrong document is not a visible error anywhere: the call answers 200 and the operator reads an
outcome for a message they were not looking at. **Restore immediately.**

- [ ] **Step 7: Mutation check — the filter read in the wrong place**

In `message-log-page.ts`, read the filters inside the loader instead of in `params`:

```ts
  protected readonly messages = rxResource({
    params: () => 1,
    stream: () =>
      this.api.listDataHealthMessages({
        brpId: this.brpId() === '' ? undefined : this.brpId(),
        status: this.status() === '' ? undefined : this.status(),
        page: 1,
        pageSize: PAGE_SIZE,
      }),
  });
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: **FAIL** — `re-asks with the BRP an operator picked, and by its id rather than its code`
reports `Expected one matching request for criteria "Match by function: ", found none.` This is the
failure worth seeing: it compiles, the first load is correct, and the screen simply stops
responding to its own filters — a select box that moves and a table that does not. **Restore
immediately.**

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/employee-portal/src/app/features/data-feeds/message-log-page.ts \
        apps/employee-portal/src/app/features/data-feeds/message-log-page.spec.ts
git commit -m "feat(employee-portal): the inbound message log [F02-R03]

Filtered by BRP and by status, with per-row replay reporting [F02-R27]'s NO_CHANGE as a
result rather than as a failure. rxResource over the typed client rather than
httpResource, so the query-string rules exist once, in the file that has a spec.

Three columns the mockup draws are not built and the reason is recorded in the file:
PvnedDocumentType is adapter-internal and never persisted, and §10.4's message query
carries no date filter and no lag percentile.

Verified by mutation: counting rows instead of reading `total` understates the log by a
page size with a plausible number; replaying rows()[0] replays the wrong document and
answers 200; and reading the filters inside the loader rather than in `params` leaves a
select box that moves and a table that does not."
```

---

### Task 17: The quarantine panel — reason, age, and what resolves it

`employee-ingestion-health.svg`'s `Quarantine` panel, subtitled **never discarded**. `[F02-R14]`
and `[F02-R15]`: a series that parsed correctly but could not be attached to a metering point is
held, not dropped, and registering the connection then replaying the stored message turns it into
readings.

⚠ **This panel's default question is "what is held right now", which is `resolved=false` — a value
that must be SENT.** A truthiness test drops it and the panel silently lists every entry ever
raised, resolved ones included, under a heading that says otherwise. Task 14 pins that at the
client; this task pins that the screen asks for it.

⚠ **`resourceObject` is carried verbatim and rendered verbatim.** Shared contract §10.4 and
plan 6's own remark: it is *"an eighteen-digit EAN, or a descriptive resource label"*, kept raw
**because a label is exactly what must not have been offered to the EAN resolver**, and an operator
reading this row needs to see which of the two arrived. So: group it for reading when it is
eighteen digits, print it exactly as it came when it is not — and never coerce.

**Files:**
- Create: `apps/employee-portal/src/app/features/data-feeds/quarantine-page.ts`
- Test: `apps/employee-portal/src/app/features/data-feeds/quarantine-page.spec.ts`

**Interfaces:**
- Consumes: `EmployeeApiClient.listQuarantine`, `.replayMessage` (task 14);
  `quarantineReasonLabel`, `quarantineResolution` (task 15); `replayOutcomeLine` from
  `./message-log-page` (task 16); `PpDataFeedsTabs`; `PpBadge`, `PpButton`, `PpCard`, `PpStatCard`,
  `formatDutchDate`, `formatDutchDecimal` from `@peakpower-nl/shared-ui`; `PpFormField`.
- Produces: `export class QuarantinePage` — selector `pp-quarantine-page`; `export function
  groupEan(value: string): string`; the DOM contract `.quarantine__entry`, `.quarantine__resource`,
  `.quarantine__age`, `.quarantine__resolution`, `.quarantine__replay`, `.quarantine__empty`,
  `#reason-filter`, `#resolved-filter`.

- [ ] **Step 1: Write the failing test**

Create `apps/employee-portal/src/app/features/data-feeds/quarantine-page.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import { provideEmployeeApiTesting } from '@peakpower-nl/api-client-employee';
import type { QuarantinedSeries } from '@peakpower-nl/api-client-employee';

import { QuarantinePage, groupEan } from './quarantine-page';

const QUARANTINE_URL = '/api/v1/data-health/quarantine';

function held(over: Partial<QuarantinedSeries> = {}): QuarantinedSeries {
  return {
    id: 'q1',
    inboundMessageId: 'm1',
    brpCode: 'PVNED',
    reason: 'UNKNOWN_EAN',
    resourceObject: '871687100000000644',
    deliveryDate: '2026-08-12',
    direction: 'CONSUMPTION',
    pointCount: 96,
    receivedAt: '2026-08-13T04:02:11Z',
    ageHours: 26,
    resolvedAt: null,
    resolvedBy: null,
    ...over,
  };
}

describe('QuarantinePage', () => {
  let fixture: ComponentFixture<QuarantinePage>;
  let http: HttpTestingController;
  let root: HTMLElement;

  function render(items: QuarantinedSeries[] = [held()], total = items.length): void {
    TestBed.configureTestingModule({
      providers: [provideEmployeeApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(QuarantinePage, { inferTagName: true });
    fixture.detectChanges();
    http.expectOne((r) => r.url === QUARANTINE_URL).flush({
      items, total, page: 1, pageSize: 50,
    });
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  }

  function choose(id: string, value: string): void {
    const select = root.querySelector<HTMLSelectElement>(`#${id}`);
    if (select === null) throw new Error(`no #${id} on the page`);
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  const entries = () => [...root.querySelectorAll<HTMLElement>('.quarantine__entry')];
  const textOf = (el: Element) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  afterEach(() => {
    try {
      http.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('asks for the UNRESOLVED entries on mount, and sends resolved=false rather than omitting it', () => {
    TestBed.configureTestingModule({
      providers: [provideEmployeeApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(QuarantinePage, { inferTagName: true });
    fixture.detectChanges();

    const req = http.expectOne((r) => r.url === QUARANTINE_URL);
    // Omitting it lists every entry ever raised under a heading that says "held now".
    expect(req.request.params.get('resolved')).toBe('false');
    expect(req.request.params.has('reason')).toBe(false);
    req.flush({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it('drops the resolved filter entirely when an operator asks to see everything', () => {
    render();

    choose('resolved-filter', 'all');

    const req = http.expectOne((r) => r.url === QUARANTINE_URL);
    expect(req.request.params.has('resolved')).toBe(false);
    req.flush({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it('re-asks with the reason an operator picked', () => {
    render();

    choose('reason-filter', 'WRONG_BRP');

    const req = http.expectOne((r) => r.url === QUARANTINE_URL);
    expect(req.request.params.get('reason')).toBe('WRONG_BRP');
    req.flush({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it('names the reason in words and says what resolves it', () => {
    // WRONG_BRP, not the fixture's UNKNOWN_EAN: a hardcoded sentence passes the default.
    render([held({ reason: 'WRONG_BRP' })]);

    const entry = textOf(entries()[0]);
    expect(entry).toContain('EAN belongs to another balance responsible party');
    expect(entry).toContain('Reassign it, then replay the stored message.');
    expect(entry).not.toContain('WRONG_BRP');
  });

  it('says plainly when nothing resolves an entry, instead of offering a step that will not work', () => {
    render([held({ reason: 'NOT_ELECTRICITY', resourceObject: 'Gasmeter hal 3' })]);

    expect(textOf(entries()[0])).toContain('Nothing resolves this');
  });

  it('groups an eighteen-digit EAN for reading and leaves a label exactly as it arrived', () => {
    // Both forms reach this column, and which one arrived is the fact an operator needs: a
    // descriptive label is precisely what must NOT have been offered to the EAN resolver.
    render([held({ resourceObject: '871687100000000644' }), held({
      id: 'q2', resourceObject: 'Meetpunt hal 3 — compressor',
    })]);

    const resources = entries().map((e) => textOf(e.querySelector('.quarantine__resource')!));
    expect(resources[0]).toBe('8716 8710 0000 0006 44');
    expect(resources[1]).toBe('Meetpunt hal 3 — compressor');
  });

  it('prints the age in whole days and hours, from the envelope and never from a local clock', () => {
    // `ageHours` is computed server-side against IMarketCalendar.UtcNow so every client agrees.
    // A `Date.now() - receivedAt` here would drift with the reader's machine and with the test
    // runner's, which is how an age assertion becomes flaky rather than wrong.
    render([held({ ageHours: 50 })]);

    expect(textOf(entries()[0].querySelector('.quarantine__age')!)).toBe('held 2 days, 2 hours');
  });

  it('reads a fresh entry in hours alone rather than "0 days"', () => {
    render([held({ ageHours: 3 })]);

    expect(textOf(entries()[0].querySelector('.quarantine__age')!)).toBe('held 3 hours');
  });

  it('counts what is held from the envelope total, not from the page', () => {
    // One item on the page, three in the queue. Reading `items.length` here would report a
    // worked-down queue on a screen whose whole job is to say how much is left.
    render([held()], 3);

    const card = root.querySelector('pp-stat-card');
    // Sentence case, not caps: `pp-stat-card__label` applies text-transform in CSS, so the label
    // in the DOM is exactly what the template typed.
    expect(card?.querySelector('.pp-stat-card__label')?.textContent?.trim()).toBe('Quarantined');
    expect(card?.querySelector('.pp-stat-card__value')?.textContent?.trim()).toBe('3');
  });

  it('replays the stored message this entry came from, not the entry', () => {
    // The replay endpoint takes an INBOUND MESSAGE id. Posting the quarantine row's own id
    // answers 404 — or, worse, matches an unrelated message if the ids ever collide.
    render([held({ id: 'q9', inboundMessageId: 'm-42' })]);

    const button = root.querySelector<HTMLButtonElement>(
      '.quarantine__replay .pp-button__control',
    );
    button!.click();
    fixture.detectChanges();

    const req = http.expectOne('/api/v1/data-health/messages/m-42/replay');
    expect(req.request.method).toBe('POST');
    req.flush({
      inboundMessageId: 'm-42',
      correlationId: 'c-42',
      outcome: 'REPLAYED',
      versionsCreated: 1,
      quarantineEntriesResolved: 1,
      failureCode: null,
      failureDetail: null,
    });
    fixture.detectChanges();

    expect(root.querySelector('.quarantine__outcome')?.textContent).toContain('Replayed');
    expect(root.querySelector('.quarantine__outcome')?.textContent).toContain(
      '1 quarantined series resolved into readings',
    );

    http.expectOne((r) => r.url === QUARANTINE_URL).flush({
      items: [], total: 0, page: 1, pageSize: 50,
    });
  });

  it('says the queue is empty rather than drawing nothing', () => {
    render([], 0);

    expect(entries()).toHaveLength(0);
    expect(textOf(root.querySelector('.quarantine__empty')!)).toBe(
      'Nothing is held. A series that cannot be attached to a connection is kept here rather ' +
        'than discarded, so an empty queue means every series that arrived found its connection.',
    );
  });

  it('renders one page heading and no second landmark', () => {
    render();

    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelector('main')).toBeNull();
  });
});

describe('groupEan', () => {
  it('groups an eighteen-digit EAN in the product spelling', () => {
    expect(groupEan('871687100000000644')).toBe('8716 8710 0000 0006 44');
  });

  it('leaves anything that is not eighteen digits exactly as it arrived', () => {
    // Not a tidy-up: a descriptive resource label is the evidence that the sender labelled the
    // series instead of identifying it, and reformatting it destroys that evidence.
    expect(groupEan('Meetpunt hal 3')).toBe('Meetpunt hal 3');
    expect(groupEan('87168710000000064')).toBe('87168710000000064');
    expect(groupEan('8716871000000006440')).toBe('8716871000000006440');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: FAIL — `Failed to resolve import "./quarantine-page"`.

- [ ] **Step 3: Write the screen**

Create `apps/employee-portal/src/app/features/data-feeds/quarantine-page.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import {
  PpBadge,
  PpButton,
  PpCard,
  PpStatCard,
  formatDutchDate,
  formatDutchDecimal,
} from '@peakpower-nl/shared-ui';
import { EmployeeApiClient } from '@peakpower-nl/api-client-employee';
import type { QuarantinedSeries } from '@peakpower-nl/api-client-employee';

import { PpFormField } from '../../shared/form-field';
import { PpDataFeedsTabs } from './data-feeds-tabs';
import { quarantineReasonLabel, quarantineResolution } from './data-feeds-labels';
import { replayOutcomeLine } from './message-log-page';

const PAGE_SIZE = 50;

export const NOTHING_HELD =
  'Nothing is held. A series that cannot be attached to a connection is kept here rather than ' +
  'discarded, so an empty queue means every series that arrived found its connection.';

/**
 * `871687100000000644` → `8716 8710 0000 0006 44`, and anything else through untouched.
 *
 * ⚠ **Not a tidy-up.** `resourceObject` is carried verbatim from the document precisely because a
 * descriptive label is what must NOT have been offered to the EAN resolver [F02-R11], [AS-17] —
 * so the fact that a label arrived where an EAN belonged is evidence, and reformatting it destroys
 * the evidence. Only an exactly-eighteen-digit string is grouped; anything shorter, longer or
 * non-numeric is printed exactly as it came.
 */
export function groupEan(value: string): string {
  if (!/^\d{18}$/.test(value)) return value;
  return `${value.slice(0, 4)} ${value.slice(4, 8)} ${value.slice(8, 12)} ` +
    `${value.slice(12, 16)} ${value.slice(16, 18)}`;
}

/** `50` → `held 2 days, 2 hours`; `3` → `held 3 hours`. */
export function ageLine(ageHours: number): string {
  const days = Math.floor(ageHours / 24);
  const hours = ageHours % 24;
  const hourPart = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  if (days === 0) return `held ${hourPart}`;
  return `held ${days} ${days === 1 ? 'day' : 'days'}, ${hourPart}`;
}

/**
 * The quarantine panel [F02-R14], [F02-R15] — `employee-ingestion-health.svg`'s `Quarantine`,
 * subtitled **never discarded**.
 *
 * ⚠ **The default question is `resolved=false`, and `false` is SENT.** "What is held right now" is
 * the only question this screen exists to answer, and a truthiness test on the flag drops it: the
 * panel then lists every entry ever raised, resolved ones included, under a heading that says
 * otherwise. That is a wrong list rather than an error.
 *
 * ⚠ **A replay posts the entry's `inboundMessageId`, never the entry's own `id`.** The endpoint
 * replays a stored MESSAGE — one message may hold several quarantined series and resolving it
 * resolves all of them, which is `quarantineEntriesResolved` on the response.
 */
@Component({
  selector: 'pp-quarantine-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PpBadge, PpButton, PpCard, PpDataFeedsTabs, PpFormField, PpStatCard],
  template: `
    <pp-data-feeds-tabs />

    <div class="quarantine__stats">
      <pp-stat-card
        label="Quarantined"
        [value]="heldCount()"
        sublabel="series held, never discarded"
        tone="warning"
      />
    </div>

    <pp-card
      [headingLevel]="1"
      heading="Quarantine"
      subtitle="Series that parsed correctly and could not be attached to a connection"
    >
      <div class="quarantine__filters">
        <pp-form-field label="Reason" for="reason-filter">
          <select id="reason-filter" [value]="reason()" (change)="setReason($event)">
            <option value="">Every reason</option>
            @for (option of reasons; track option) {
              <option [value]="option">{{ reasonLabel(option) }}</option>
            }
          </select>
        </pp-form-field>

        <pp-form-field label="Show" for="resolved-filter">
          <select id="resolved-filter" [value]="scope()" (change)="setScope($event)">
            <option value="held">Held now</option>
            <option value="all">Held and resolved</option>
          </select>
        </pp-form-field>
      </div>

      @if (outcome(); as sentence) {
        <p class="quarantine__outcome" role="status">{{ sentence }}</p>
      }

      @if (quarantine.error()) {
        <p class="quarantine__empty">
          The quarantine queue could not be loaded. The employee API did not answer; try again,
          and check that it is running.
        </p>
      } @else if (quarantine.isLoading()) {
        <p class="quarantine__empty">Loading the quarantine queue…</p>
      } @else if (rows().length > 0) {
        <ul class="quarantine__list">
          @for (row of rows(); track row.id) {
            <li class="quarantine__entry">
              <div class="quarantine__head">
                <span class="quarantine__resource">{{ resource(row) }}</span>
                <pp-badge tone="warning">{{ reasonLabel(row.reason) }}</pp-badge>
              </div>
              <p class="quarantine__facts">
                {{ seriesLine(row) }} · {{ row.brpCode }} ·
                <span class="quarantine__age">{{ age(row) }}</span>
              </p>
              <p class="quarantine__resolution">{{ resolution(row) }}</p>
              @if (row.resolvedAt === null) {
                <span class="quarantine__replay">
                  <pp-button variant="secondary" size="sm" [disabled]="replaying() !== null"
                    (click)="replay(row)">Replay message</pp-button>
                </span>
              } @else {
                <p class="quarantine__resolved">{{ resolvedLine(row) }}</p>
              }
            </li>
          }
        </ul>
      } @else {
        <p class="quarantine__empty">{{ nothingHeld }}</p>
      }
    </pp-card>
  `,
  styles: `
    :host { display: grid; gap: 16px; }
    .quarantine__stats { display: grid; grid-template-columns: 220px; }
    .quarantine__filters { display: flex; gap: 16px; margin-bottom: 14px; }
    .quarantine__filters pp-form-field { width: 220px; }
    .quarantine__list { margin: 0; padding: 0; list-style: none; }
    .quarantine__entry { padding: 14px 0; border-top: 1px solid var(--pp-border); }
    .quarantine__head {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
    }
    .quarantine__resource {
      font-family: var(--font-mono); font-size: 12px; color: var(--pp-text-heading);
      font-weight: 700;
    }
    .quarantine__facts { margin: 6px 0 0; font-size: 11px; color: var(--pp-text-body); }
    .quarantine__resolution {
      margin: 8px 0 10px; font-size: 12px; line-height: 1.5; color: var(--pp-text-body);
    }
    .quarantine__resolved { margin: 8px 0 0; font-size: 11px; color: var(--pp-text-faint); }
    .quarantine__outcome {
      margin: 0 0 14px; padding: 10px 12px; border-radius: 6px;
      border: 1px solid var(--pp-mint-border); background: var(--pp-mint-bg);
      color: var(--pp-mint-text); font-size: 12px;
    }
    .quarantine__empty {
      margin: 0; padding: 22px 10px; font-size: 12.5px; line-height: 1.5;
      color: var(--pp-text-faint); text-align: center;
    }
  `,
})
export class QuarantinePage {
  private readonly api = inject(EmployeeApiClient);

  readonly nothingHeld = NOTHING_HELD;
  readonly reasons = ['UNKNOWN_EAN', 'EAN_VALIDITY', 'WRONG_BRP', 'NOT_ELECTRICITY'] as const;

  protected readonly reason = signal('');
  /** `held` sends `resolved=false`; `all` sends no flag at all. */
  protected readonly scope = signal<'held' | 'all'>('held');
  protected readonly outcome = signal<string | null>(null);
  protected readonly replaying = signal<string | null>(null);

  protected readonly quarantine = rxResource({
    params: () => ({ reason: this.reason(), scope: this.scope() }),
    stream: ({ params }) =>
      this.api.listQuarantine({
        reason: params.reason === '' ? undefined : params.reason,
        // ⚠ `false`, explicitly, and `undefined` for "everything". These are different
        // questions, and `undefined` is the one that means "do not filter".
        resolved: params.scope === 'held' ? false : undefined,
        page: 1,
        pageSize: PAGE_SIZE,
      }),
  });

  protected readonly rows = computed<QuarantinedSeries[]>(
    () => this.quarantine.value()?.items ?? [],
  );

  /** From the envelope's total, not from the page: the queue may be longer than one page. */
  protected readonly heldCount = computed(() =>
    formatDutchDecimal(this.quarantine.value()?.total ?? 0, 0),
  );

  protected setReason(event: Event): void {
    this.reason.set((event.target as HTMLSelectElement).value);
    this.outcome.set(null);
  }

  protected setScope(event: Event): void {
    this.scope.set((event.target as HTMLSelectElement).value === 'all' ? 'all' : 'held');
    this.outcome.set(null);
  }

  protected reasonLabel(value: string): string {
    return quarantineReasonLabel(value);
  }

  protected resolution(row: QuarantinedSeries): string {
    return quarantineResolution(row.reason);
  }

  protected resource(row: QuarantinedSeries): string {
    return groupEan(row.resourceObject);
  }

  protected age(row: QuarantinedSeries): string {
    return ageLine(row.ageHours);
  }

  /** "96 points, consumption, 12 aug 2026" — what is being held, in one line. */
  protected seriesLine(row: QuarantinedSeries): string {
    const direction = row.direction === 'PRODUCTION' ? 'production' : 'consumption';
    return `${formatDutchDecimal(row.pointCount, 0)} points, ${direction}, ` +
      `${formatDutchDate(row.deliveryDate)}`;
  }

  protected resolvedLine(row: QuarantinedSeries): string {
    const by = row.resolvedBy ?? 'a replay';
    return `Resolved by ${by} on ${formatDutchDate(row.resolvedAt)}.`;
  }

  protected replay(row: QuarantinedSeries): void {
    if (this.replaying() !== null) return;
    this.replaying.set(row.id);
    this.outcome.set(null);

    // ⚠ inboundMessageId, not row.id. The endpoint replays a stored MESSAGE; one message may
    // hold several quarantined series, and resolving it resolves all of them at once.
    this.api.replayMessage(row.inboundMessageId).subscribe({
      next: (result) => {
        this.replaying.set(null);
        this.outcome.set(
          replayOutcomeLine(result.outcome, result.versionsCreated,
            result.quarantineEntriesResolved),
        );
        this.quarantine.reload();
      },
      error: () => {
        this.replaying.set(null);
        this.outcome.set(
          'The replay could not be sent. The employee API did not answer; try again, and check ' +
            'that it is running.',
        );
      },
    });
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: PASS.

- [ ] **Step 5: Mutation check — `resolved=false` as an absence**

In `quarantine-page.ts`, treat "held" as the default and send nothing for it:

```ts
        resolved: params.scope === 'held' ? undefined : undefined,
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: **FAIL** — `asks for the UNRESOLVED entries on mount, and sends resolved=false rather
than omitting it` reports `expected null to be 'false'`. Predicted before running: `drops the
resolved filter entirely when an operator asks to see everything` stays **green**, because that
test asks for absence and now always gets it. The screen would list every entry ever raised under
a stat card labelled `QUARANTINED` — a number that only ever grows, on a queue whose whole purpose
is to be worked down. **Restore immediately.**

- [ ] **Step 6: Mutation check — the replay posted against the wrong id**

In `quarantine-page.ts`:

```ts
    this.api.replayMessage(row.id).subscribe({
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: **FAIL** — `replays the stored message this entry came from, not the entry` reports
`Expected one matching request for criteria "Match URL: /api/v1/data-health/messages/m-42/replay",
found none. Requests received are: POST /api/v1/data-health/messages/q9/replay.` The fixture gives
the entry and its message deliberately different ids for exactly this reason. **Restore
immediately.**

- [ ] **Step 7: Mutation check — the tidied resource object**

In `quarantine-page.ts`, group whatever arrives:

```ts
export function groupEan(value: string): string {
  return `${value.slice(0, 4)} ${value.slice(4, 8)} ${value.slice(8, 12)} ` +
    `${value.slice(12, 16)} ${value.slice(16, 18)}`;
}
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: **FAIL** — `leaves anything that is not eighteen digits exactly as it arrived` reports
that `'Meetpunt hal 3'` came back re-spaced into four-character groups (the exact spacing depends
on the string's length; the assertion is `toBe`, so read the reported actual rather than predicting
it character by character). `groups an eighteen-digit EAN for reading and leaves a label exactly as
it arrived` fails the same way on its second row.

Predicted before running: the eighteen-digit case stays **green** — which is the point. The
mutation destroys the one piece of evidence the column exists to carry: that the sender put a human
label where an EAN belonged. **Restore immediately.**

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/employee-portal/src/app/features/data-feeds/quarantine-page.ts \
        apps/employee-portal/src/app/features/data-feeds/quarantine-page.spec.ts
git commit -m "feat(employee-portal): the quarantine panel [F02-R14] [F02-R15]

Reason in words, age from the envelope's ageHours rather than a local clock, the sentence
that says what resolves each reason — including NOT_ELECTRICITY, which nothing resolves —
and a replay posted against the entry's inboundMessageId.

Verified by mutation: omitting resolved=false leaves the 'show everything' test green and
turns 'held now' into 'everything ever raised'; posting row.id replays a message that does
not exist; and grouping every resourceObject destroys the evidence that a sender labelled
a series instead of identifying it."
```

---

### Task 18: The per-connection 21-day data-state heat map

`employee-ingestion-health.svg`'s `Data state per connection` panel — `last 21 delivery dates · all
customers`, with `Silent first`.

⚠ **Twenty-one here, fourteen on the customer's strip (task 12).** Shared contract §10.3 says it in
as many words: *"Fourteen entries for the customer strip; twenty-one for the employee heat map
(§10.4). The two numbers come from different mockups and neither is a typo."*

⚠ **`isSilent` is READ, never computed here.** `[F02-R26]`'s silence condition belongs to the
rollup job, which writes an open `METERING_POINT_SILENT` alert; this field is the read of what that
job decided. A screen that recomputed silence from `lastDataDate` and a local clock would disagree
with the job that raises the alerts, and the two would disagree intermittently — the worst kind.

⚠ **This list includes connections with no BRP assigned**, which is why `brpCode` is nullable here
and `NOT NULL` in the database (design §3.1). A point can be created in the back office before it
is routed to a party — and a point with no party is exactly the point an operator is hunting for
when a document quarantines as `UNKNOWN_EAN`. Printing an empty cell for it would hide the thing
they came for.

**Files:**
- Create: `apps/employee-portal/src/app/features/data-feeds/connection-health-page.ts`
- Test: `apps/employee-portal/src/app/features/data-feeds/connection-health-page.spec.ts`

**Interfaces:**
- Consumes: `EmployeeApiClient.listDataHealthMeteringPoints` (task 14); `dayStateLetter`,
  `dayStateWord`, `DAY_STATE_LEGEND` (task 15); `PpDataFeedsTabs`; `PpCard`, `PpStatCard`,
  `formatDutchDate`, `formatDutchDecimal` from `@peakpower-nl/shared-ui`; `PpFormField`.
- Produces: `export class ConnectionHealthPage` — selector `pp-connection-health-page`; the DOM
  contract `.health__row`, `.health__name`, `.health__cell`, `.health__legend`, `.health__silent`,
  `.health__empty`, `#silent-filter`.

- [ ] **Step 1: Write the failing test**

Create `apps/employee-portal/src/app/features/data-feeds/connection-health-page.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import { provideEmployeeApiTesting } from '@peakpower-nl/api-client-employee';
import type { DataHealthMeteringPoint } from '@peakpower-nl/api-client-employee';

import { ConnectionHealthPage } from './connection-health-page';

const POINTS_URL = '/api/v1/data-health/metering-points';

/**
 * Twenty-one dense entries, oldest first, with a NON-uniform tail — because a strip that renders
 * one class for every cell passes any assertion made against an all-FINAL run.
 *
 * The dates are 2026-08-01 … 2026-08-21, inside one month on purpose: a `25 + i` walk off the end
 * of July produces `2026-07-45`, which `formatDutchDate` answers with `—` rather than throwing,
 * so the fixture would be silently broken and the title assertion would fail for the wrong reason.
 */
function twentyOne(tail: string[] = []): { date: string; state: string }[] {
  const states = [...Array(21 - tail.length).fill('FINAL'), ...tail];
  return states.map((state, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    state,
  }));
}

function point(over: Partial<DataHealthMeteringPoint> = {}): DataHealthMeteringPoint {
  return {
    meteringPointId: 'mp1',
    ean: '871685900000000001',
    eanDisplay: '8716 8590 0000 0000 01',
    displayLabel: 'Vestiging Rotterdam',
    customerId: 'c1',
    customerLegalName: 'Van der Steen Logistiek B.V.',
    brpId: 'b1',
    brpCode: 'PVNED',
    productionExpectation: 'EXPECTED',
    lastDataDate: '2026-08-14',
    isSilent: false,
    recentDataStates: twentyOne(['PROVISIONAL', 'PROVISIONAL', 'PARTIAL', 'NO_DATA']),
    ...over,
  };
}

describe('ConnectionHealthPage', () => {
  let fixture: ComponentFixture<ConnectionHealthPage>;
  let http: HttpTestingController;
  let root: HTMLElement;

  function render(items: DataHealthMeteringPoint[] = [point()], total = items.length): void {
    TestBed.configureTestingModule({
      providers: [provideEmployeeApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ConnectionHealthPage, { inferTagName: true });
    fixture.detectChanges();
    http.expectOne((r) => r.url === POINTS_URL).flush({
      items, total, page: 1, pageSize: 50,
    });
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  }

  function choose(id: string, value: string): void {
    const select = root.querySelector<HTMLSelectElement>(`#${id}`);
    if (select === null) throw new Error(`no #${id} on the page`);
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  const healthRows = () => [...root.querySelectorAll<HTMLElement>('.health__row')];
  const cellsIn = (row: HTMLElement) =>
    [...row.querySelectorAll<HTMLElement>('.health__cell')];

  afterEach(() => {
    try {
      http.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('asks for every connection on mount, silent ones included', () => {
    TestBed.configureTestingModule({
      providers: [provideEmployeeApiTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ConnectionHealthPage, { inferTagName: true });
    fixture.detectChanges();

    const req = http.expectOne((r) => r.url === POINTS_URL);
    expect(req.request.params.has('silentOnly')).toBe(false);
    expect(req.request.params.get('pageSize')).toBe('50');
    req.flush({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it('re-asks for the silent ones alone when an operator narrows to them', () => {
    render();

    choose('silent-filter', 'silent');

    const req = http.expectOne((r) => r.url === POINTS_URL);
    expect(req.request.params.get('silentOnly')).toBe('true');
    req.flush({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it('draws twenty-one cells per connection, not fourteen', () => {
    // §10.3's customer strip is fourteen and this is twenty-one; the two numbers come from
    // different mockups and neither is a typo.
    render();

    expect(cellsIn(healthRows()[0])).toHaveLength(21);
  });

  it('marks each cell with its own state letter, in the wire order', () => {
    render();

    const letters = cellsIn(healthRows()[0]).map((c) => c.textContent?.trim());
    expect(letters[0]).toBe('F');
    expect(letters[17]).toBe('P');
    expect(letters[19]).toBe('A');
    expect(letters[20]).toBe('N');
  });

  it('says in words what every letter means, on the cell and in the legend', () => {
    // A one-letter cell is unreadable to anyone who has not memorised the table, and PARTIAL is
    // `A` rather than `P` because `P` is taken — so the word is not decoration.
    render();

    const cells = cellsIn(healthRows()[0]);
    expect(cells[20].getAttribute('title')).toBe('21 aug 2026 — No data');

    const legend = [...root.querySelectorAll('.health__legend li')].map((li) =>
      li.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(legend).toEqual(['N No data', 'A Partial', 'P Provisional', 'F Final']);
  });

  it('marks a silent connection from the wire flag, never from a local clock', () => {
    // [F02-R26]'s condition belongs to the rollup job; this field is the read of what it
    // decided. A screen that recomputed silence would disagree with the job that raises the
    // alerts — intermittently, which is the worst way to disagree.
    render([
      point({ meteringPointId: 'mp-quiet', isSilent: true, lastDataDate: '2026-08-14' }),
      point({ meteringPointId: 'mp-live', isSilent: false, lastDataDate: '2026-07-01' }),
    ]);

    // The same lastDataDate arithmetic would rank these the other way round, which is exactly
    // why the fixture sets the two fields against each other.
    expect(healthRows()[0].querySelector('.health__silent')).not.toBeNull();
    expect(healthRows()[1].querySelector('.health__silent')).toBeNull();
  });

  it('names the connection, its customer and its EAN, so a row can be acted on', () => {
    render();

    const name = healthRows()[0].querySelector('.health__name')?.textContent
      ?.replace(/\s+/g, ' ').trim();
    expect(name).toContain('Vestiging Rotterdam');
    expect(name).toContain('Van der Steen Logistiek B.V.');
    expect(name).toContain('8716 8590 0000 0000 01');
  });

  it('says a connection has no party rather than leaving the cell blank', () => {
    // Design §3.1: this list deliberately includes points with no BRP assigned, and that is the
    // point an operator is hunting for when a document quarantines as UNKNOWN_EAN.
    render([point({ brpId: null, brpCode: null })]);

    expect(healthRows()[0].textContent).toContain('No balance responsible party');
  });

  it('counts the SILENT connections, which is not the same as the list total', () => {
    // One silent point in a list of thirty-one. A stat card labelled "silent connections"
    // showing 31 is a wrong number under a correct heading.
    render([point({ isSilent: true })], 31);

    const card = root.querySelector('pp-stat-card');
    // Sentence case, not caps: `pp-stat-card__label` applies text-transform in CSS.
    expect(card?.querySelector('.pp-stat-card__label')?.textContent?.trim())
      .toBe('Silent connections');
    // Scoped to the value element and compared with toBe. `toContain('1')` would be satisfied
    // by '31', which is precisely the number this test exists to reject.
    expect(card?.querySelector('.pp-stat-card__value')?.textContent?.trim()).toBe('1');
  });

  it('draws no strip and names the reason when a connection has no evaluated dates', () => {
    render([point({ recentDataStates: [] })]);

    expect(cellsIn(healthRows()[0])).toHaveLength(0);
    expect(healthRows()[0].textContent).toContain('No delivery date has been evaluated yet');
  });

  it('says the list is empty rather than drawing an empty table', () => {
    render([], 0);

    expect(healthRows()).toHaveLength(0);
    expect(root.querySelector('.health__empty')?.textContent?.trim()).toBe(
      'No connection matches this filter.',
    );
  });

  it('renders one page heading and no second landmark', () => {
    render();

    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelector('main')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: FAIL — `Failed to resolve import "./connection-health-page"`.

- [ ] **Step 3: Write the screen**

Create `apps/employee-portal/src/app/features/data-feeds/connection-health-page.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import {
  PpBadge,
  PpCard,
  PpStatCard,
  formatDutchDate,
  formatDutchDecimal,
} from '@peakpower-nl/shared-ui';
import { EmployeeApiClient } from '@peakpower-nl/api-client-employee';
import type {
  DataHealthMeteringPoint,
  EmployeeDayState,
} from '@peakpower-nl/api-client-employee';

import { PpFormField } from '../../shared/form-field';
import { PpDataFeedsTabs } from './data-feeds-tabs';
import { DAY_STATE_LEGEND, dayStateLetter, dayStateWord } from './data-feeds-labels';

const PAGE_SIZE = 50;

export const NO_CONNECTIONS = 'No connection matches this filter.';
export const NO_STATES_YET = 'No delivery date has been evaluated yet for this connection.';
export const NO_BRP = 'No balance responsible party';

/**
 * The per-connection 21-day data-state heat map —
 * `employee-ingestion-health.svg`'s `Data state per connection`.
 *
 * ⚠ **Twenty-one, not fourteen.** The customer's strip on connection detail is fourteen (shared
 * contract §10.3); this one is twenty-one (§10.4). Different mockups, and neither is a typo.
 *
 * ⚠ **`isSilent` is read, never recomputed.** `[F02-R26]`'s condition is the rollup job's — it
 * writes an open `METERING_POINT_SILENT` alert — and this field is the read of what that job
 * decided. A screen that derived silence from `lastDataDate` and a local clock would disagree with
 * the job raising the alerts, intermittently and only near a boundary.
 *
 * ⚠ **No cell shows a letter alone.** `PARTIAL` is `A` because `P` is provisional, so a bare glyph
 * is unreadable to anyone who has not memorised the table. Every cell carries its date and its
 * state word in a `title`, and the legend spells all four out.
 */
@Component({
  selector: 'pp-connection-health-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PpBadge, PpCard, PpDataFeedsTabs, PpFormField, PpStatCard],
  template: `
    <pp-data-feeds-tabs />

    <div class="health__stats">
      <pp-stat-card
        label="Silent connections"
        [value]="silentCount()"
        sublabel="an open silence alert stands"
        tone="warning"
      />
    </div>

    <pp-card
      [headingLevel]="1"
      heading="Data state per connection"
      subtitle="Last 21 delivery dates, every customer"
    >
      <div class="health__filters">
        <pp-form-field label="Show" for="silent-filter">
          <select id="silent-filter" [value]="scope()" (change)="setScope($event)">
            <option value="all">Every connection</option>
            <option value="silent">Silent only</option>
          </select>
        </pp-form-field>
      </div>

      <ul class="health__legend">
        @for (entry of legend; track entry.letter) {
          <li><span class="health__key">{{ entry.letter }}</span> {{ entry.word }}</li>
        }
      </ul>

      @if (points.error()) {
        <p class="health__empty">
          The connection list could not be loaded. The employee API did not answer; try again, and
          check that it is running.
        </p>
      } @else if (points.isLoading()) {
        <p class="health__empty">Loading connections…</p>
      } @else if (rows().length > 0) {
        <ul class="health__list">
          @for (row of rows(); track row.meteringPointId) {
            <li class="health__row">
              <div class="health__name">
                <span class="health__label">{{ row.displayLabel }}</span>
                <span class="health__meta">
                  {{ row.customerLegalName }} · {{ row.eanDisplay }} · {{ party(row) }}
                </span>
                @if (row.isSilent) {
                  <span class="health__silent"><pp-badge tone="warning">Silent</pp-badge></span>
                }
              </div>

              @if (row.recentDataStates.length > 0) {
                <ol class="health__strip">
                  @for (day of row.recentDataStates; track day.date) {
                    <li
                      class="health__cell {{ cellModifier(day) }}"
                      [title]="cellTitle(day)"
                    >{{ letter(day) }}</li>
                  }
                </ol>
              } @else {
                <p class="health__none">{{ noStatesYet }}</p>
              }
            </li>
          }
        </ul>
      } @else {
        <p class="health__empty">{{ noConnections }}</p>
      }
    </pp-card>
  `,
  styles: `
    :host { display: grid; gap: 16px; }
    .health__stats { display: grid; grid-template-columns: 220px; }
    .health__filters { margin-bottom: 14px; }
    .health__filters pp-form-field { width: 220px; }
    .health__legend {
      display: flex; gap: 14px; margin: 0 0 14px; padding: 0; list-style: none;
      font-size: 10.5px; color: var(--pp-text-faint);
    }
    .health__key { font-weight: 700; color: var(--pp-text-body); }
    .health__list { margin: 0; padding: 0; list-style: none; }
    .health__row {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center;
      padding: 10px 0; border-top: 1px solid var(--pp-border);
    }
    .health__name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .health__label { font-size: 12px; font-weight: 700; color: var(--pp-text-heading); }
    .health__meta { font-size: 10.5px; color: var(--pp-text-faint); }
    .health__strip {
      display: grid; grid-template-columns: repeat(21, 16px); gap: 2px;
      margin: 0; padding: 0; list-style: none;
    }
    .health__cell {
      display: flex; align-items: center; justify-content: center; height: 16px;
      border-radius: 3px; font-size: 9px; font-weight: 700;
    }
    .health__cell--final { background: var(--pp-mint-bg); color: var(--pp-mint-text); }
    .health__cell--provisional { background: var(--pp-amber-bg); color: var(--pp-amber-text); }
    .health__cell--partial { background: var(--pp-coral-bg); color: var(--pp-coral-text); }
    .health__cell--no-data { background: var(--pp-surface-alt); color: var(--pp-text-faint); }
    .health__none { margin: 0; font-size: 10.5px; color: var(--pp-text-faint); }
    .health__empty {
      margin: 0; padding: 22px 10px; font-size: 12.5px; line-height: 1.5;
      color: var(--pp-text-faint); text-align: center;
    }
  `,
})
export class ConnectionHealthPage {
  private readonly api = inject(EmployeeApiClient);

  readonly legend = DAY_STATE_LEGEND;
  readonly noConnections = NO_CONNECTIONS;
  readonly noStatesYet = NO_STATES_YET;

  protected readonly scope = signal<'all' | 'silent'>('all');

  protected readonly points = rxResource({
    params: () => this.scope(),
    stream: ({ params }) =>
      this.api.listDataHealthMeteringPoints({
        // Undefined for "every connection". `silentOnly=false` would ask for the connections
        // that are NOT silent, which is a third question nothing on this screen offers.
        silentOnly: params === 'silent' ? true : undefined,
        page: 1,
        pageSize: PAGE_SIZE,
      }),
  });

  protected readonly rows = computed<DataHealthMeteringPoint[]>(
    () => this.points.value()?.items ?? [],
  );

  /**
   * The number of connections carrying an open silence alert.
   *
   * Counted off the SILENT flag rather than read from `total`, because `total` is the size of
   * whatever was asked for — every connection, on the default filter — and a stat card labelled
   * SILENT CONNECTIONS showing the whole estate is a wrong number under a correct heading.
   */
  protected readonly silentCount = computed(() =>
    formatDutchDecimal(this.rows().filter((row) => row.isSilent).length, 0),
  );

  protected setScope(event: Event): void {
    this.scope.set((event.target as HTMLSelectElement).value === 'silent' ? 'silent' : 'all');
  }

  protected party(row: DataHealthMeteringPoint): string {
    return row.brpCode ?? NO_BRP;
  }

  protected letter(day: EmployeeDayState): string {
    return dayStateLetter(day.state);
  }

  protected cellTitle(day: EmployeeDayState): string {
    return `${formatDutchDate(day.date)} — ${dayStateWord(day.state)}`;
  }

  protected cellModifier(day: EmployeeDayState): string {
    switch (day.state) {
      case 'FINAL':
        return 'health__cell--final';
      case 'PROVISIONAL':
        return 'health__cell--provisional';
      case 'PARTIAL':
        return 'health__cell--partial';
      default:
        // NO_DATA, and anything a later slice adds. A cell with no modifier is invisible against
        // the card, which reads as a gap in the strip rather than as a state nobody has mapped.
        return 'health__cell--no-data';
    }
  }
}
```

⚠ **The `default` arm above is deliberate and is the opposite of `labels.ts`'s rule.** `day.state`
is a plain `string` off the wire — plan 6 declares it `string` on the record — so there is no union
for `noImplicitReturns` to make exhaustive, and a `switch` with no default would not compile. The
label lookups in `data-feeds-labels.ts` carry a NAMED fallback for the same reason; here the
fallback is a real surface rather than a sentence, because a cell with no class at all disappears.

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: PASS.

- [ ] **Step 5: Mutation check — silence recomputed from the date**

In `connection-health-page.ts`, derive silence the way it is tempting to:

```ts
  protected isSilent(row: DataHealthMeteringPoint): boolean {
    if (row.lastDataDate === null) return true;
    const days = (Date.now() - Date.parse(row.lastDataDate)) / 86_400_000;
    return days > 3;
  }
```

(and change the template's `@if (row.isSilent)` to `@if (isSilent(row))`).

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: **FAIL** — `marks a silent connection from the wire flag, never from a local clock`
reports `expected null not to be null` on the first row and `expected <span class="health__silent">
to be null` on the second: the fixture sets `isSilent` and `lastDataDate` **against** each other,
so the arithmetic ranks the two rows the other way round. The screen would then disagree with the
job that raises the alerts, near a boundary and only sometimes. **Restore immediately.**

- [ ] **Step 6: Mutation check — the stat read off `total`**

In `connection-health-page.ts`:

```ts
  protected readonly silentCount = computed(() =>
    formatDutchDecimal(this.points.value()?.total ?? 0, 0),
  );
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: **FAIL** — `counts the SILENT connections, which is not the same as the list total`
reports `expected '31' to be '1'`.

⚠ **This is the mutation the assertion was written for, and the reason it is `toBe` on the value
element rather than `toContain` on the card.** `expect(card?.textContent).toContain('1')` is
satisfied by `'31'`, so the obvious form of this test would have stayed green through exactly this
mutation while the card reported the whole estate as silent. **Restore immediately.**

- [ ] **Step 7: Mutation check — fourteen cells instead of twenty-one**

In `connection-health-page.ts`, slice the strip to the customer's length:

```html
                @for (day of row.recentDataStates.slice(0, 14); track day.date) {
```

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test:employee-portal
```

Expected: **FAIL** — `draws twenty-one cells per connection, not fourteen` reports
`expected [ …14 items ] to have length 21`, and `marks each cell with its own state letter, in the
wire order` reports `expected undefined to be 'N'`. Predicted before running: nothing else moves —
a fourteen-day heat map looks entirely correct and quietly hides the week in which a connection
went quiet. **Restore immediately.**

- [ ] **Step 8: Run the whole workspace and commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && \
  PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform npm test
```

Expected: PASS, all four targets. In particular `design-tokens.spec.ts` — which runs inside
**customer-portal** and scans `apps/` in both portals — now reads every `var(--pp-…)` in the three
new employee screens and the tab strip. Its `leaves no app declaring a token of its own` assertion
is the one to watch: nothing above declares a `--pp-…` property, and the four heat-map surfaces are
existing palette tokens rather than new ones.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/employee-portal/src/app/features/data-feeds/connection-health-page.ts \
        apps/employee-portal/src/app/features/data-feeds/connection-health-page.spec.ts
git commit -m "feat(employee-portal): the per-connection 21-day data-state heat map

Twenty-one delivery dates, not the customer strip's fourteen — different mockups, and
neither is a typo. isSilent is read from the wire rather than recomputed, because
[F02-R26]'s condition belongs to the rollup job that raises the alerts. Connections with
no balance responsible party are listed and say so, which is design §3.1's requirement and
the row an operator is hunting for when a document quarantines as UNKNOWN_EAN.

Verified by mutation: deriving silence from lastDataDate and a local clock ranks the
fixture's two rows the other way round; reading the stat off `total` reports the whole
estate under a heading that says SILENT — and exposed a weak `toContain('1')` assertion
that '31' satisfied, now scoped to the value element; and slicing the strip to fourteen
looks entirely correct while hiding the week a connection went quiet."
```

---
