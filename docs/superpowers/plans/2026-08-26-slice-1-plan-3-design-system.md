# Design System — `libs/shared-ui` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `peakpower-web` Angular 22 workspace and port the SB-2026 design system into `@peakpower/shared-ui` — the token module, nine `pp-*` primitives, four nl-NL formatting pipes and a component gallery — with no backend dependency.

**Architecture:** One npm workspace at the root of `peakpower-web` holds two Angular applications (`apps/customer-portal`, `apps/employee-portal`) and one Angular library (`libs/shared-ui`). The library ships the SB-2026 CSS custom properties as plain stylesheets, plus standalone, signal-input, `OnPush` components whose visual rules live in per-component `.css` files. Applications consume the library from source through a TypeScript path mapping, so slice 1 never runs `ng-packagr`.

**Tech Stack:** Angular 22.1.3 runtime · `@angular/cli` / `@angular/build` 22.1.6 · TypeScript 6.0.3 · Vitest 4.1.11 via `@angular/build:unit-test` · jsdom (Node environment, the builder default) · Node 24.15.0 / npm 11.12.1 · rxjs 7.8.2 · tslib 2.8.1 · zoneless change detection (no `zone.js`)

**Spec:** `docs/superpowers/specs/2026-08-26-poc-slice-1-design.md`
**Shared contract:** `docs/superpowers/plans/2026-08-26-slice-1-shared-contract.md`

---

## Global Constraints

Every task implicitly includes this section.

### Versions — exact, verified 2026-08-26

| | |
| --- | --- |
| .NET SDK | **10.0.400** (installed, default) |
| EF Core | **10.x** |
| PostgreSQL | **17** (Testcontainers + Aspire) |
| Aspire | **13.5.3** — `aspire.cli` global tool + `Aspire.AppHost.Sdk`. **NOT a `dotnet workload`.** |
| Angular | **22** (`@angular/cli` 22.1.6) |
| Node / npm | **24.15.0 / 11.12.1** |
| Docker | 29.7.2, daemon must be running |

Resolved npm versions used by this plan (verified on the registry, 2026-08-26):

| Package | Version |
| --- | --- |
| `@angular/core`, `common`, `compiler`, `compiler-cli`, `forms`, `platform-browser`, `router` | `22.1.3` (range `^22.1.0`) |
| `@angular/cli`, `@angular/build` | `22.1.6` |
| `typescript` | `6.0.3` (`@angular/build` peer range is `>=6.0 <6.1`) |
| `vitest` | `4.1.11` (peer range `^4.0.8`) |
| `jsdom` | `30.0.1` |
| `rxjs` | `7.8.2` |
| `tslib` | `2.8.1` |
| `@types/node` | `24.13.3` |
| `ng-packagr` | `22.1.1` |

### Repositories

```
/Users/thinhhuynh/PeakPower/peakpower-platform      # .NET   — siblings, and the
/Users/thinhhuynh/PeakPower/peakpower-web           # Angular — AppHost relies on it
```

`git init` in both. **No remotes, no CI, no package registry, no deployment** in slice 1.
Commit locally and often. **This plan owns `peakpower-web` only.**

### Naming

- .NET namespace root `PeakPower.` — e.g. `PeakPower.Domain.Customers`
- npm scope `@peakpower/` — kept even though no such GitHub org exists yet `[OQ-100]`
- Database: snake_case, singular, schema-qualified — `customer.metering_point`
- C#: PascalCase; EF Core maps to snake_case via a naming convention, not per-property attributes

### Angular module rules

```
peakpower-web/
├── package.json                        # ONE workspace at the root
├── apps/customer-portal/               # start:customer-portal
├── apps/employee-portal/               # start:employee-portal
├── libs/shared-ui/                     # @peakpower/shared-ui
├── libs/api-client-customer/           # @peakpower/api-client-customer  (generated, committed)
└── libs/api-client-employee/           # @peakpower/api-client-employee  (generated, committed)
```

Standalone components throughout · signals for state · lazy-loaded feature routes ·
strictly typed reactive forms · **no** `NgModule`.

Component selectors are prefixed `pp-`: `pp-card`, `pp-stat-card`, `pp-badge`, `pp-button`,
`pp-banner`, `pp-ds-banner`, `pp-grid-table`, `pp-search-input`, `pp-app-shell`.

> ⚠ **`AddNpmApp` does not exist in Aspire 13.5.3.** Verified 2026-08-26 by reading the XML
> documentation inside `Aspire.Hosting.JavaScript` 13.5.3: `Aspire.Hosting.NodeJs` is frozen at
> 9.5.2, and the current package exposes only `AddJavaScriptApp`, `AddNodeApp` and `AddViteApp`.
> The specification's AppHost snippet is written against the 9.x API and **will not compile**.
>
> The replacement is:
>
> ```csharp
> // Aspire.Hosting.JavaScriptHostingExtensions
> AddJavaScriptApp(this IDistributedApplicationBuilder builder,
>                  string name, string appDirectory, string runScriptName /* default "dev" */)
> ```
>
> Two things are wrong with the specification's call and both are fixed by the same line. It
> passes `$"{webRoot}/apps/customer-portal"` as the directory, but the workspace declares
> exactly **one** `package.json`, at the root — so there is no script to run in that folder.
> Use the workspace root plus a per-app script name:
>
> ```csharp
> builder.AddJavaScriptApp("customer-portal", webRoot, "start:customer-portal")
>        .WithReference(customerApi)
>        .WithHttpEndpoint(env: "PORT")
>        .WithExternalHttpEndpoints();
> ```
>
> This is why `package.json` must define `start:customer-portal` and `start:employee-portal` at
> the **root**, not `start` inside each app.

### Design tokens — SB-2026

Source of truth is the **PeakPower Trading Design System** project in Claude Design
(`tokens/*.css`, 13 primitives each with a `.d.ts`). Port those files; do not re-derive values
from the prototype HTML.

Two rules that must survive the port, because breaking either silently drops an 11px badge
to 2:1 contrast:

1. **A bright hex is a fill, a mark or a chart series.** Anything that becomes text or a
   numeral reads the paired darker tier. `--pp-cyan` (`#00D4C6`) has **no** pair — text falls
   back to `--pp-teal-text`.
2. **`--pp-indigo` means violet / corrected, never the hedge line.**

Drop `--certainty-provisional-opacity`; the certainty layer was removed and the token is dead.

Key metrics: sidebar 236px · topbar 64px · card `18px 20px` · stat card `14px 16px`
(no `flex:1`, 3px `::before` accent cap) · badge 11px/600 `4px 12px` pill, 1px border on every
tone · button 13px/600 `10px 20px`, `border:1px solid` on **every** variant · page gap 16px
(20px on Dashboard only) · radii 6/8/12/pill.

### Copy rules

Sentence case everywhere. ALL CAPS only for stat-card labels and table column heads.
**No emoji, no icon set** — the only glyphs are the brand mark, one magnifier, `▲▼`, `→›`.
Every number carries its provenance in a faint sublabel. **"Projected"** = not yet measured;
**"Provisional"** = not yet accepted — never swap them. Empty and disabled states name the
reason. nl-NL numbers: `€ 19.722,00`, `385,4 MWh`, minus is U+2212 `−`.

### Testing tooling

| Layer | Tooling |
| --- | --- |
| Domain / Application unit | xUnit + **Shouldly 4.3.0**|
| Persistence & integration | Testcontainers, real PostgreSQL 17 |
| Architecture | NetArchTest |
| OpenAPI contract | Verify snapshot |
| **Frontend unit** | **Vitest** |
| E2E | Playwright, in `peakpower-web` |

**Package versions verified on nuget.org, 2026-08-26** — use these, do not guess:

| Package | Version | Note |
| --- | --- | --- |
| `Aspire.AppHost.Sdk` | **13.5.3** | |
| `Aspire.Hosting.JavaScript` | **13.5.3** | ⚠ `Aspire.Hosting.NodeJs` is frozen at 9.5.2 — do not use it |
| `Konscious.Security.Cryptography.Argon2` | **1.3.1** | the Argon2id hasher `[DEC-113]` |
| `NetArchTest.Rules` | **1.3.2** | the six architecture facts |
| `Testcontainers.PostgreSql` | **4.14.0** | real PostgreSQL 17 in tests |

**Architecture facts that must exist from week 1:**

1. `PeakPower.Domain` references no other project
2. `PeakPower.Application` references only `PeakPower.Domain`
3. `PeakPower.Ingestion` (when it exists) references no `Brp.*` adapter
4. No type calls `IgnoreQueryFilters()`
5. No type outside `PeakPower.Infrastructure.Time` calls `DateTime.Now`, `DateTime.UtcNow`,
   `DateTime.Today`, `DateTimeOffset.Now` or `DateTimeOffset.UtcNow`
6. No type outside `PeakPower.Infrastructure.Web` uses `IHttpContextAccessor` or reads a claim
   off `ClaimsPrincipal` / `ClaimsIdentity`

### Enums, domain types, ports, JWT claims, HTTP and database rules

None of them are touched by this plan. `libs/shared-ui` makes **no HTTP call** and imports **no**
generated client. If you find yourself needing `EanCode`, `ICustomerContext` or `/api/v1`, you
have left this plan's scope.

---

## Domain terms used below

You do not need to know Dutch energy trading to execute this plan, but four words appear in the
gallery's sample copy and in token names:

- **EAN** — the 18-digit number identifying one electricity metering connection in the
  Netherlands. Rendered in a monospace font, grouped for reading.
- **grootverbruik** — "large consumption". The Dutch legal term for a business-scale grid
  connection. It stays Dutch because it is the legal term.
- **Base / Peak** — the two shapes of an energy hedge. Base is all hours; Peak is
  Mon–Fri 08:00–20:00.
- **short / long** — *short* is consumption not yet hedged (colour `--pp-coral`); *long* is
  hedge above consumption (colour `--pp-teal`). Both are data roles in the palette, not moods.

---

## File Structure

Every path below is relative to `/Users/thinhhuynh/PeakPower/peakpower-web`.

### Workspace root

| File | Responsibility |
| --- | --- |
| `package.json` | The single npm workspace root. Declares `workspaces: ["libs/*"]`, every dependency, and the `start:*` / `test:*` scripts the Aspire AppHost and CI will call. |
| `angular.json` | The Angular workspace: three projects (`customer-portal`, `employee-portal`, `shared-ui`) and their build / serve / test targets. |
| `tsconfig.json` | Compiler options shared by every project, plus the `@peakpower/shared-ui` path mapping. |
| `.gitignore` | Excludes `node_modules`, `dist`, `.angular`, `out-tsc`. |
| `.editorconfig` | Two-space indent, LF, final newline. |
| `tools/workspace.test.mjs` | Node built-in test asserting the workspace contract the AppHost depends on: root `start:*` scripts, no per-app `package.json`, both projects registered. |
| `tools/fetch-inter.mjs` | Downloads the seven Inter `woff2` unicode-range subsets into the library's asset folder. |

### `apps/customer-portal` and `apps/employee-portal`

| File | Responsibility |
| --- | --- |
| `tsconfig.app.json` | Application compilation — excludes specs. |
| `tsconfig.spec.json` | Spec compilation — adds `vitest/globals` and `node` types. |
| `public/favicon.ico` | Static asset root. |
| `src/index.html` | The document shell. |
| `src/main.ts` | `bootstrapApplication` entry point. |
| `src/styles.css` | Application-level reset and canvas — nothing component-specific. |
| `src/app/app.ts` | Root component: a `<router-outlet />` and nothing else. |
| `src/app/app.config.ts` | Application providers: error listeners and the router. |
| `src/app/app.routes.ts` | Route table. Customer portal lazy-loads the gallery; employee portal is empty in this plan. |
| `src/app/gallery/gallery.ts` | *(customer portal only)* The component gallery — every primitive and pipe on one screen. |
| `src/app/gallery/gallery.css` | *(customer portal only)* Gallery-local layout: section spacing and specimen rows. |
| `src/app/gallery/gallery.spec.ts` | *(customer portal only)* Asserts the gallery renders one of every primitive. |

### `libs/shared-ui`

| File | Responsibility |
| --- | --- |
| `package.json` | `name: "@peakpower/shared-ui"`, resolved by npm workspaces. |
| `ng-package.json` | ng-packagr entry point. Unused in slice 1; present so the library can be packaged later without restructuring. |
| `tsconfig.lib.json` / `tsconfig.lib.prod.json` | Library compilation. Excludes specs and the spec-only helpers. |
| `tsconfig.spec.json` | Spec compilation. |
| `src/public-api.ts` | The library's only export surface. Every task appends to it. |
| `src/testing/read-css.ts` | Spec-only helpers: locate the workspace root, read a shipped stylesheet, list its `color:` declarations, and name the bright fill tokens that must never become type. |
| `src/styles/fonts.css` | Ported verbatim: seven `@font-face` blocks, one per Inter unicode-range subset. |
| `src/styles/colors.css` | Ported verbatim minus `--certainty-provisional-opacity`, plus the `--pp-canvas` page ground the two portals paint their canvas with. |
| `src/styles/typography.css`, `spacing.css`, `radii.css`, `layout.css`, `semantic.css` | Ported verbatim. |
| `src/styles/tokens.css` | The one entry point — `@import`s the seven above in order. Applications list this file in their `styles` array. |
| `src/styles/tokens.spec.ts` | Asserts the port rules: no dead certainty token, `--pp-cyan` has no text pair, `--pp-indigo` is violet, the key metrics are present. |
| `src/assets/fonts/inter-*.woff2` | The seven Inter subsets. |
| `src/assets/logo-mark.svg`, `logo-mark-sidebar.svg` | The brand mark at page size and at rail size. |
| `src/lib/format/dutch-number.ts` | `PP_MINUS` and `formatDutchDecimal` — the one place a number becomes nl-NL text. |
| `src/lib/format/dutch-number.spec.ts` | Grouping, decimal comma, U+2212, and the negative-zero rule. |
| `src/lib/format/pp-money.pipe.ts` | `€ 19.722,00`. |
| `src/lib/format/pp-energy.pipe.ts` | `385,4 MWh`. |
| `src/lib/format/pp-power.pipe.ts` | `0,20 MW` — exactly two decimals. |
| `src/lib/format/pp-price.pipe.ts` | `€ 102,4000 / MWh` — exactly four decimals. |
| `src/lib/format/pp-format.pipes.spec.ts` | One suite covering all four pipes. |
| `src/lib/tone.ts` | `PpTone` — the one tone vocabulary `pp-badge`, `pp-banner`, `pp-ds-banner` and `pp-stat-card` all read. |
| `src/lib/badge/pp-badge.ts`, `pp-badge.css`, `pp-badge.spec.ts` | The pill status label — the product's single status vocabulary. |
| `src/lib/button/pp-button.ts`, `pp-button.css`, `pp-button.spec.ts` | The one button primitive; five variants at matching heights. |
| `src/lib/card/pp-card.ts`, `pp-card.css`, `pp-card.spec.ts` | The default content container. |
| `src/lib/stat-card/pp-stat-card.ts`, `pp-stat-card.css`, `pp-stat-card.spec.ts` | One headline figure with its label and provenance. |
| `src/lib/banner/pp-banner.ts`, `pp-banner.css`, `pp-banner.spec.ts` | The SB-2026 page-level notice. |
| `src/lib/ds-banner/pp-ds-banner.ts`, `pp-ds-banner.css`, `pp-ds-banner.spec.ts` | The design-system notice. A different component, not a variant. |
| `src/lib/search-input/pp-search-input.ts`, `pp-search-input.css`, `pp-search-input.spec.ts` | The filter field carrying the product's only icon. |
| `src/lib/grid-table/pp-grid-head.ts` | `[ppGridHead]` — the projected row of ALL-CAPS column heads. |
| `src/lib/grid-table/pp-grid-row.ts` | `[ppGridRow]` — one projected row, laid out on the table's own tracks. |
| `src/lib/grid-table/pp-grid-table.ts`, `pp-grid-table.css`, `pp-grid-table.spec.ts` | The CSS-grid list table, and the rule that a head is never rendered with nothing under it. |
| `src/lib/app-shell/pp-app-shell.ts`, `pp-app-shell.css`, `pp-app-shell.spec.ts` | The rail + topbar + scroll-container frame both portals live in. |

---

## Task 1: Workspace root and the AppHost script contract

The Aspire AppHost in Plan 1 calls `npm run start:customer-portal` **from the workspace root**.
If that script is absent or ignores `$PORT`, `dev-up` fails with an error that looks like an
Aspire bug. This task makes that contract executable.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-web/package.json`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-web/tsconfig.json`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-web/angular.json`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-web/.gitignore`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-web/.editorconfig`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-web/tools/workspace.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - npm scripts at the workspace root: `start:customer-portal`, `start:employee-portal`,
    `test:workspace`, `test:shared-ui`, `test:customer-portal`, `test:employee-portal`, `test`.
    Plan 1's `builder.AddJavaScriptApp("customer-portal", webRoot, "start:customer-portal")`
    depends on the first two by name.
  - `tsconfig.json` path mapping `"@peakpower/shared-ui" -> ["libs/shared-ui/src/public-api.ts"]`,
    which Plans 4 and 6 import through.
  - `angular.json` with `newProjectRoot: "libs"`.

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-web/tools/workspace.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

test('the workspace root declares the scripts the Aspire AppHost invokes', () => {
  const pkg = readJson('package.json');
  assert.ok(pkg.scripts['start:customer-portal'], 'start:customer-portal is missing');
  assert.ok(pkg.scripts['start:employee-portal'], 'start:employee-portal is missing');
});

test('each start script honours the PORT the AppHost injects', () => {
  const pkg = readJson('package.json');
  for (const name of ['start:customer-portal', 'start:employee-portal']) {
    assert.match(
      pkg.scripts[name],
      /\$\{PORT:-\d+\}/,
      `${name} must pass $PORT through to --port; AddJavaScriptApp sets it via WithHttpEndpoint(env: "PORT")`,
    );
  }
});

test('there is exactly one package.json, at the workspace root', () => {
  for (const app of ['apps/customer-portal', 'apps/employee-portal']) {
    assert.equal(
      existsSync(join(root, app, 'package.json')),
      false,
      `${app}/package.json must not exist — AddJavaScriptApp runs the root script, not a per-app one`,
    );
  }
});

test('npm workspaces cover libs/, so @peakpower/* resolves by package name', () => {
  const pkg = readJson('package.json');
  assert.deepEqual(pkg.workspaces, ['libs/*']);
});

test('the shared-ui path mapping points at the library source', () => {
  const tsconfig = readJson('tsconfig.json');
  assert.deepEqual(tsconfig.compilerOptions.paths['@peakpower/shared-ui'], [
    'libs/shared-ui/src/public-api.ts',
  ]);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && node --test tools/workspace.test.mjs
```

Expected: FAIL with `Error: ENOENT: no such file or directory, open '/Users/thinhhuynh/PeakPower/peakpower-web/package.json'` on every test.

- [ ] **Step 3: Write the minimal implementation**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && git init -b main
```

Create `/Users/thinhhuynh/PeakPower/peakpower-web/package.json`:

```json
{
  "name": "peakpower-web",
  "version": "0.0.0",
  "private": true,
  "workspaces": ["libs/*"],
  "scripts": {
    "ng": "ng",
    "start:customer-portal": "ng serve customer-portal --port ${PORT:-4200}",
    "start:employee-portal": "ng serve employee-portal --port ${PORT:-4201}",
    "build:customer-portal": "ng build customer-portal",
    "build:employee-portal": "ng build employee-portal",
    "test": "npm run test:workspace && npm run test:shared-ui && npm run test:customer-portal && npm run test:employee-portal",
    "test:workspace": "node --test tools/*.test.mjs",
    "test:shared-ui": "ng test shared-ui --watch=false",
    "test:customer-portal": "ng test customer-portal --watch=false",
    "test:employee-portal": "ng test employee-portal --watch=false"
  },
  "dependencies": {
    "@angular/common": "22.1.3",
    "@angular/compiler": "22.1.3",
    "@angular/core": "22.1.3",
    "@angular/forms": "22.1.3",
    "@angular/platform-browser": "22.1.3",
    "@angular/router": "22.1.3",
    "rxjs": "7.8.2",
    "tslib": "2.8.1"
  },
  "devDependencies": {
    "@angular/build": "22.1.6",
    "@angular/cli": "22.1.6",
    "@angular/compiler-cli": "22.1.3",
    "@types/node": "24.13.3",
    "jsdom": "30.0.1",
    "ng-packagr": "22.1.1",
    "typescript": "6.0.3",
    "vitest": "4.1.11"
  }
}
```

Create `/Users/thinhhuynh/PeakPower/peakpower-web/tsconfig.json`:

```json
{
  "compileOnSave": false,
  "compilerOptions": {
    "strict": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "experimentalDecorators": true,
    "importHelpers": true,
    "target": "ES2022",
    "module": "preserve",
    "paths": {
      "@peakpower/shared-ui": ["libs/shared-ui/src/public-api.ts"]
    }
  },
  "angularCompilerOptions": {
    "enableI18nLegacyMessageIdFormat": false,
    "strictInjectionParameters": true,
    "strictInputAccessModifiers": true,
    "strictTemplates": true
  },
  "files": []
}
```

Create `/Users/thinhhuynh/PeakPower/peakpower-web/angular.json`:

```json
{
  "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
  "version": 1,
  "cli": {
    "packageManager": "npm",
    "analytics": false
  },
  "newProjectRoot": "libs",
  "projects": {}
}
```

Create `/Users/thinhhuynh/PeakPower/peakpower-web/.gitignore`:

```gitignore
node_modules/
dist/
out-tsc/
.angular/
.DS_Store
*.log
```

Create `/Users/thinhhuynh/PeakPower/peakpower-web/.editorconfig`:

```editorconfig
root = true

[*]
charset = utf-8
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
end_of_line = lf
```

Install:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm install
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && node --test tools/workspace.test.mjs
```

Expected: PASS — `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add .gitignore .editorconfig package.json package-lock.json tsconfig.json angular.json tools/workspace.test.mjs
git commit -m "chore: scaffold the peakpower-web npm and Angular workspace root"
```

---

## Task 2: The two application shells

Two Angular applications with nothing in them but a router outlet. They exist now, before the
library, because Task 1's test already asserts their absence of a `package.json` and Plan 1's
AppHost needs `ng serve` to actually start.

Angular 22 applications are **zoneless** by default: there is no `zone.js` polyfill and no
`provideZoneChangeDetection`. Change detection runs off signals.

**Files:**
- Create: `apps/customer-portal/tsconfig.app.json`
- Create: `apps/customer-portal/tsconfig.spec.json`
- Create: `apps/customer-portal/src/index.html`
- Create: `apps/customer-portal/src/main.ts`
- Create: `apps/customer-portal/src/styles.css`
- Create: `apps/customer-portal/src/app/app.ts`
- Create: `apps/customer-portal/src/app/app.config.ts`
- Create: `apps/customer-portal/src/app/app.routes.ts`
- Create: `apps/employee-portal/…` — the same eight files
- Modify: `angular.json`
- Test: `tools/workspace.test.mjs`

**Interfaces:**
- Consumes: the `angular.json` skeleton and the npm scripts from Task 1.
- Produces:
  - Angular projects named `customer-portal` and `employee-portal`, both with `"prefix": "pp"`
    — shared contract §10 prefixes every selector in this product `pp-` — and both with
    `build`, `serve` and `test` targets, `tokens.css` first in `styles`, assets and production
    budgets. Plans 4 and 6 make key-level edits to these projects; they never paste a competing
    project object over them.
  - `export const appConfig: ApplicationConfig` and `export const routes: Routes` in each app.
  - `export class App` — the root component, selector `pp-root` in both applications.

- [ ] **Step 1: Write the failing test**

Append to `/Users/thinhhuynh/PeakPower/peakpower-web/tools/workspace.test.mjs`:

```js
test('angular.json registers both portals with the targets ng serve and ng test need', () => {
  const angular = readJson('angular.json');
  for (const name of ['customer-portal', 'employee-portal']) {
    const project = angular.projects[name];
    assert.ok(project, `angular.json has no project named ${name}`);
    assert.equal(project.projectType, 'application');
    assert.equal(project.root, `apps/${name}`);
    // Shared contract §10: every selector in this product is prefixed pp-, in both apps.
    assert.equal(project.prefix, 'pp');
    assert.equal(project.targets.build.builder, '@angular/build:application');
    assert.equal(project.targets.serve.builder, '@angular/build:dev-server');
    assert.equal(project.targets.test.builder, '@angular/build:unit-test');
  }
});

test('both portals load the shared-ui token module before their own stylesheet', () => {
  const angular = readJson('angular.json');
  for (const name of ['customer-portal', 'employee-portal']) {
    assert.deepEqual(angular.projects[name].targets.build.options.styles, [
      'libs/shared-ui/src/styles/tokens.css',
      `apps/${name}/src/styles.css`,
    ]);
  }
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && node --test tools/workspace.test.mjs
```

Expected: FAIL with `AssertionError [ERR_ASSERTION]: angular.json has no project named customer-portal`.

- [ ] **Step 3: Write the minimal implementation**

Replace `/Users/thinhhuynh/PeakPower/peakpower-web/angular.json` with:

```json
{
  "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
  "version": 1,
  "cli": {
    "packageManager": "npm",
    "analytics": false
  },
  "newProjectRoot": "libs",
  "projects": {
    "customer-portal": {
      "root": "apps/customer-portal",
      "sourceRoot": "apps/customer-portal/src",
      "projectType": "application",
      "prefix": "pp",
      "targets": {
        "build": {
          "builder": "@angular/build:application",
          "defaultConfiguration": "production",
          "options": {
            "browser": "apps/customer-portal/src/main.ts",
            "tsConfig": "apps/customer-portal/tsconfig.app.json",
            "outputPath": "dist/customer-portal",
            "assets": [{ "glob": "**/*", "input": "apps/customer-portal/public" }],
            "styles": [
              "libs/shared-ui/src/styles/tokens.css",
              "apps/customer-portal/src/styles.css"
            ]
          },
          "configurations": {
            "production": {
              "budgets": [
                { "type": "initial", "maximumWarning": "500kB", "maximumError": "1MB" },
                { "type": "anyComponentStyle", "maximumWarning": "4kB", "maximumError": "8kB" }
              ],
              "outputHashing": "all"
            },
            "development": {
              "optimization": false,
              "extractLicenses": false,
              "sourceMap": true
            }
          }
        },
        "serve": {
          "builder": "@angular/build:dev-server",
          "defaultConfiguration": "development",
          "configurations": {
            "production": { "buildTarget": "customer-portal:build:production" },
            "development": { "buildTarget": "customer-portal:build:development" }
          }
        },
        "test": {
          "builder": "@angular/build:unit-test",
          "options": { "tsConfig": "apps/customer-portal/tsconfig.spec.json" }
        }
      }
    },
    "employee-portal": {
      "root": "apps/employee-portal",
      "sourceRoot": "apps/employee-portal/src",
      "projectType": "application",
      "prefix": "pp",
      "targets": {
        "build": {
          "builder": "@angular/build:application",
          "defaultConfiguration": "production",
          "options": {
            "browser": "apps/employee-portal/src/main.ts",
            "tsConfig": "apps/employee-portal/tsconfig.app.json",
            "outputPath": "dist/employee-portal",
            "assets": [{ "glob": "**/*", "input": "apps/employee-portal/public" }],
            "styles": [
              "libs/shared-ui/src/styles/tokens.css",
              "apps/employee-portal/src/styles.css"
            ]
          },
          "configurations": {
            "production": {
              "budgets": [
                { "type": "initial", "maximumWarning": "500kB", "maximumError": "1MB" },
                { "type": "anyComponentStyle", "maximumWarning": "4kB", "maximumError": "8kB" }
              ],
              "outputHashing": "all"
            },
            "development": {
              "optimization": false,
              "extractLicenses": false,
              "sourceMap": true
            }
          }
        },
        "serve": {
          "builder": "@angular/build:dev-server",
          "defaultConfiguration": "development",
          "configurations": {
            "production": { "buildTarget": "employee-portal:build:production" },
            "development": { "buildTarget": "employee-portal:build:development" }
          }
        },
        "test": {
          "builder": "@angular/build:unit-test",
          "options": { "tsConfig": "apps/employee-portal/tsconfig.spec.json" }
        }
      }
    }
  }
}
```

Create `apps/customer-portal/tsconfig.app.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "types": [] },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.spec.ts"]
}
```

Create `apps/customer-portal/tsconfig.spec.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "types": ["vitest/globals", "node"] },
  "include": ["src/**/*.d.ts", "src/**/*.spec.ts"]
}
```

Create `apps/customer-portal/src/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>PeakPower — customer portal</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/x-icon" href="favicon.ico">
</head>
<body>
  <pp-root></pp-root>
</body>
</html>
```

Create `apps/customer-portal/src/main.ts`:

```ts
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
```

Create `apps/customer-portal/src/styles.css` — the product is a desk tool on a fixed
gradient canvas, and the body never scrolls; the shell owns scrolling:

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  height: 100%;
}

body {
  margin: 0;
  font-family: var(--font-sans);
  color: var(--pp-text-heading);
  /* --pp-canvas is the page ground; Plans 4 and 6 paint their own surfaces with it too. */
  background: var(--pp-canvas);
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
}
```

Create `apps/customer-portal/src/app/app.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'pp-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet />`,
})
export class App {}
```

Create `apps/customer-portal/src/app/app.config.ts`:

```ts
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), provideRouter(routes)],
};
```

Create `apps/customer-portal/src/app/app.routes.ts`:

```ts
import { Routes } from '@angular/router';

export const routes: Routes = [];
```

Create the favicon placeholder:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
mkdir -p apps/customer-portal/public apps/employee-portal/public
touch apps/customer-portal/public/favicon.ico apps/employee-portal/public/favicon.ico
```

Now create the employee portal by copying the customer portal and retitling it. The root
selector is `pp-root` in both applications, so nothing but the document title changes:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
cp -R apps/customer-portal/src apps/employee-portal/src
cp apps/customer-portal/tsconfig.app.json apps/customer-portal/tsconfig.spec.json apps/employee-portal/
sed -i '' 's/customer portal/employee portal/' apps/employee-portal/src/index.html
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && node --test tools/workspace.test.mjs && npx ng build employee-portal --configuration development
```

Expected: PASS — `# pass 7`, `# fail 0`, followed by an `Application bundle generation complete` line from the build. (`libs/shared-ui/src/styles/tokens.css` does not exist yet, so the build will fail on a missing style file — that is Task 3's job. If it does, temporarily confirm with `node --test tools/workspace.test.mjs` alone and revisit the build in Task 3 Step 4.)

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add angular.json apps tools/workspace.test.mjs
git commit -m "feat(web): add the customer and employee portal application shells"
```

---

## Task 3: `@peakpower/shared-ui` and the SB-2026 token module

The token module is the library's foundation: every component reads these custom properties and
hard-codes almost nothing. The CSS is a **verbatim port** from the Claude Design project
`PeakPower Trading Design System` (`tokens/*.css`) with exactly one deletion —
`--certainty-provisional-opacity`, whose feature was removed — and exactly one addition,
`--pp-canvas`. Shared contract §10.1 makes that token the page ground, and Plans 4 and 6 both
paint with it; an undefined custom property resolves to nothing and renders transparent, so it
is defined here, once, beside the gradient it aliases.

This task also introduces the spec-only helper that later tasks use to assert on shipped CSS.
Asserting on the stylesheet source rather than on `getComputedStyle` is deliberate: jsdom's
cascade is partial, so a pixel assertion there would be testing jsdom, not the design system.

**Files:**
- Create: `libs/shared-ui/package.json`
- Create: `libs/shared-ui/ng-package.json`
- Create: `libs/shared-ui/tsconfig.lib.json`
- Create: `libs/shared-ui/tsconfig.lib.prod.json`
- Create: `libs/shared-ui/tsconfig.spec.json`
- Create: `libs/shared-ui/src/public-api.ts`
- Create: `libs/shared-ui/src/testing/read-css.ts`
- Create: `libs/shared-ui/src/styles/{fonts,colors,typography,spacing,radii,layout,semantic,tokens}.css`
- Modify: `angular.json`
- Test: `libs/shared-ui/src/styles/tokens.spec.ts`

**Interfaces:**
- Consumes: the workspace root and the `@peakpower/shared-ui` path mapping from Task 1.
- Produces:
  - `libs/shared-ui/src/styles/tokens.css` — the one stylesheet applications list in
    `angular.json`. Plans 4 and 6 rely on it already being in their `styles` array.
  - `--pp-canvas` in `styles/colors.css` — the page ground, required by shared contract §10.1.
  - `export function workspaceRoot(): string`
  - `export function readSharedUiCss(relativePath: string): string`
  - `export function cssText(relativePath: string): string`
  - `export function colorDeclarations(css: string): string[]`
  - `export const PP_BRIGHT_FILL_TOKENS: readonly string[]`

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/styles/tokens.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cssText, readSharedUiCss } from '../testing/read-css';

describe('SB-2026 token module', () => {
  it('drops the dead certainty token', () => {
    // The certainty layer was removed from the product; the token has no consumer.
    expect(readSharedUiCss('styles/colors.css')).not.toContain('--certainty-provisional-opacity');
  });

  it('gives --pp-cyan no text tier, because #00D4C6 is 1,9:1 on white', () => {
    const colors = readSharedUiCss('styles/colors.css');
    expect(colors).toContain('--pp-cyan:#00D4C6');
    expect(colors).not.toContain('--pp-cyan-text');
    // Text that wants cyan falls back to the teal tier instead.
    expect(colors).toContain('--pp-teal-text:#0A7A74');
  });

  it('defines --pp-canvas as the page ground, because two portals paint with it', () => {
    // Shared contract §10.1. An undefined custom property renders transparent, silently.
    expect(cssText('styles/colors.css')).toContain('--pp-canvas:var(--pp-bg-gradient)');
  });

  it('keeps --pp-indigo meaning violet, never the hedge line', () => {
    expect(cssText('styles/colors.css')).toContain('--pp-indigo:#9151B8');
  });

  it('pairs every bright status fill with a darker text tier', () => {
    const colors = cssText('styles/colors.css');
    for (const [fill, text] of [
      ['--pp-mint:#1DBD8E', '--pp-mint-text:#016A6C'],
      ['--pp-amber:#EEB72B', '--pp-amber-text:#8A6710'],
      ['--pp-red:#F24F4F', '--pp-red-text:#C22A2A'],
      ['--pp-coral:#FF8F5C', '--pp-coral-text:#B4531F'],
      ['--pp-pink:#FF57B0', '--pp-pink-text:#A62E76'],
      ['--pp-violet:#9151B8', '--pp-violet-text:#6F3A91'],
      ['--pp-grass:#73CC80', '--pp-grass-text:#1B7A4F'],
    ]) {
      expect(colors, `${fill} has no paired text tier`).toContain(fill);
      expect(colors, `${text} is missing`).toContain(text);
    }
  });

  it('carries the shell metrics the AppShell reads', () => {
    const layout = cssText('styles/layout.css');
    expect(layout).toContain('--sidebar-width:236px');
    expect(layout).toContain('--topbar-height:64px');
    expect(layout).toContain('--pp-shadow-card:');
  });

  it('stops the radius scale at 12px plus a pill', () => {
    expect(cssText('styles/radii.css')).toBe(
      ':root{--radius-sm:6px;--radius-md:8px;--radius-lg:12px;--radius-pill:999px}',
    );
  });

  it('keeps the half-pixel type scale unrounded', () => {
    const type = cssText('styles/typography.css');
    expect(type).toContain('--text-sm:12.5px');
    expect(type).toContain('--text-base:13.5px');
    expect(type).toContain('--text-xl:23px');
  });

  it('imports the seven token files with fonts first', () => {
    expect(readSharedUiCss('styles/tokens.css').trim()).toBe(
      [
        '@import url("./fonts.css");',
        '@import url("./colors.css");',
        '@import url("./typography.css");',
        '@import url("./spacing.css");',
        '@import url("./radii.css");',
        '@import url("./layout.css");',
        '@import url("./semantic.css");',
      ].join('\n'),
    );
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: FAIL with `Project 'shared-ui' does not exist.`

- [ ] **Step 3: Write the minimal implementation**

Add the library project to `angular.json`, inside `"projects"` alongside the two applications:

```json
    "shared-ui": {
      "root": "libs/shared-ui",
      "sourceRoot": "libs/shared-ui/src",
      "projectType": "library",
      "prefix": "pp",
      "targets": {
        "build": {
          "builder": "@angular/build:ng-packagr",
          "defaultConfiguration": "production",
          "configurations": {
            "production": { "tsConfig": "libs/shared-ui/tsconfig.lib.prod.json" },
            "development": { "tsConfig": "libs/shared-ui/tsconfig.lib.json" }
          }
        },
        "test": {
          "builder": "@angular/build:unit-test",
          "options": { "tsConfig": "libs/shared-ui/tsconfig.spec.json" }
        }
      }
    }
```

Create `libs/shared-ui/package.json` — `@angular/router` is a peer because `pp-app-shell`
navigates by `routerLink` (Task 14), not by an output the application has to wire up:

```json
{
  "name": "@peakpower/shared-ui",
  "version": "0.0.1",
  "peerDependencies": {
    "@angular/common": "^22.1.0",
    "@angular/core": "^22.1.0",
    "@angular/router": "^22.1.0"
  },
  "dependencies": {
    "tslib": "^2.8.1"
  },
  "sideEffects": false,
  "exports": {
    ".": "./src/public-api.ts",
    "./styles/tokens.css": "./src/styles/tokens.css"
  }
}
```

Create `libs/shared-ui/ng-package.json`:

```json
{
  "$schema": "../../node_modules/ng-packagr/ng-package.schema.json",
  "dest": "../../dist/shared-ui",
  "lib": { "entryFile": "src/public-api.ts" }
}
```

Create `libs/shared-ui/tsconfig.lib.json` — `src/testing` is excluded because it imports
`node:fs`, which must never reach a browser bundle:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../out-tsc/lib",
    "declaration": true,
    "declarationMap": true,
    "types": []
  },
  "include": ["src/**/*.ts"],
  "exclude": ["**/*.spec.ts", "src/testing/**"]
}
```

Create `libs/shared-ui/tsconfig.lib.prod.json`:

```json
{
  "extends": "./tsconfig.lib.json",
  "compilerOptions": { "declarationMap": false },
  "angularCompilerOptions": { "compilationMode": "partial" }
}
```

Create `libs/shared-ui/tsconfig.spec.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "../../out-tsc/spec",
    "types": ["vitest/globals", "node"]
  },
  "include": ["src/**/*.d.ts", "src/**/*.spec.ts", "src/testing/**/*.ts"]
}
```

Create `libs/shared-ui/src/public-api.ts`:

```ts
// The library's only export surface. Every primitive and pipe is re-exported from here.
export {};
```

Create `libs/shared-ui/src/testing/read-css.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Walks up from the process working directory until it finds `angular.json`, so a spec can
 * read a shipped stylesheet no matter which folder `ng test` was invoked from.
 */
export function workspaceRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, 'angular.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`No angular.json found at or above ${process.cwd()}`);
    }
    dir = parent;
  }
}

/**
 * Reads one stylesheet out of `libs/shared-ui/src`, so a spec asserts on the CSS the library
 * actually ships rather than on jsdom's partial cascade.
 */
export function readSharedUiCss(relativePath: string): string {
  return readFileSync(join(workspaceRoot(), 'libs/shared-ui/src', relativePath), 'utf8');
}

/** The same stylesheet with all whitespace removed, for declaration-level assertions. */
export function cssText(relativePath: string): string {
  return readSharedUiCss(relativePath).replace(/\s+/g, '');
}

/**
 * Bright palette hexes. Each is legal as a fill, a mark or a chart series and illegal as type:
 * an 11px badge set in one of these drops to roughly 2:1 contrast.
 */
export const PP_BRIGHT_FILL_TOKENS: readonly string[] = [
  '--pp-cyan',
  '--pp-mint',
  '--pp-teal',
  '--pp-amber',
  '--pp-red',
  '--pp-coral',
  '--pp-pink',
  '--pp-violet',
  '--pp-grass',
  '--pp-green',
  '--pp-blue-300',
];

/** Every value assigned to a `color:` property in a stylesheet, in source order. */
export function colorDeclarations(css: string): string[] {
  return [...css.matchAll(/(?:^|[;{\s])color\s*:\s*([^;}]+)/g)].map((match) => match[1].trim());
}
```

Create `libs/shared-ui/src/styles/tokens.css`:

```css
@import url("./fonts.css");
@import url("./colors.css");
@import url("./typography.css");
@import url("./spacing.css");
@import url("./radii.css");
@import url("./layout.css");
@import url("./semantic.css");
```

Create `libs/shared-ui/src/styles/fonts.css` — ported verbatim, with the asset URLs made
root-absolute so the file resolves identically whether it is bundled or served on its own:

```css
/* Inter — variable woff2 subsets, extracted verbatim from the PeakPower
   portal preview bundle (PeakPowerDesignSystem_7164da). Weights used by the
   product: 400 / 500 / 600 / 700. */
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url("/assets/fonts/inter-latin.woff2") format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url("/assets/fonts/inter-latin-ext.woff2") format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url("/assets/fonts/inter-greek.woff2") format('woff2');unicode-range:U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF}
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url("/assets/fonts/inter-greek-ext.woff2") format('woff2');unicode-range:U+1F00-1FFF}
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url("/assets/fonts/inter-cyrillic.woff2") format('woff2');unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url("/assets/fonts/inter-cyrillic-ext.woff2") format('woff2');unicode-range:U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F}
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url("/assets/fonts/inter-vietnamese.woff2") format('woff2');unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB}
```

Create `libs/shared-ui/src/styles/colors.css` — ported verbatim, with the
`--certainty-provisional-opacity` line and its comment gone and `--pp-canvas` added:

```css
/* PeakPower colour tokens — Paleta SB-2026.
   ADOPTED 2026-08-18 as the platform palette, replacing the teal palette the
   currently published portals ship. 15 source colours, one job each; the
   values below are the palette verbatim, plus derived neutrals and the darker
   text tiers a bright fill needs when it becomes type.
   Rule: a bright hex is a FILL, a MARK or a CHART SERIES. Anything that
   becomes text or a numeral uses the matching *-text / *-value tier. */
:root{
  /* ── surfaces ─────────────────────────────────────────────────────────── */
  --pp-bg:#eef3f9;                 /* app canvas, gradient start */
  --pp-bg-2:#f7f9fc;               /* gradient end */
  --pp-bg-gradient:linear-gradient(180deg,#eef3f9 0%,#f7f9fc 60%);
  --pp-canvas:var(--pp-bg-gradient);   /* the page ground — shared contract §10.1 */
  --pp-surface:#ffffff; --pp-surface-alt:#f2f5f9; --pp-surface-zebra:#fafcfe;
  --pp-border:#dde4ed; --pp-border-strong:#c3cddb;

  /* ── text — the palette's own neutral pair ────────────────────────────── */
  --pp-text-heading:#2D3F54; --pp-text-body:#52647A; --pp-text-faint:#8b98aa;

  /* ── dark chrome (rail) ───────────────────────────────────────────────── */
  --pp-sidebar-bg:#2D3F54; --pp-sidebar-text:#c2ccd9; --pp-sidebar-text-active:#ffffff;
  --pp-sidebar-subtitle:#43d3a6;   /* lifted from #1DBD8E to clear AA on #2D3F54 */
  --pp-sidebar-active-bg:rgba(255,255,255,0.10);
  --pp-rail-spectrum:linear-gradient(90deg,#004C94 0 20%,#006ECF 20% 40%,#1DBD8E 40% 60%,#EEB72B 60% 80%,#FF8F5C 80% 100%);

  /* ── blue ramp — brand, primary action, hedge, links ──────────────────── */
  --pp-blue-900:#003a72;           /* hover / press, derived */
  --pp-blue-700:#004C94;           /* brand · primary fill · brand figures · hedge line */
  --pp-blue-500:#006ECF;           /* links · usage line */
  --pp-blue-300:#3C93FA;           /* peak window · in-flight trades · focus */
  --pp-blue-100:#e7f0fa; --pp-blue-050:#eaf2fb;

  /* ── accent green–teal — confirmed, coverage, accept ──────────────────── */
  --pp-mint:#1DBD8E; --pp-mint-text:#016A6C; --pp-mint-bg:#e6f8f2; --pp-mint-border:#a6e3d1;
  --pp-teal:#0FA69D; --pp-teal-text:#0A7A74; --pp-teal-deep:#028183;
  --pp-cyan:#00D4C6;               /* long / surplus FILL only — 1,9:1 on white */

  /* ── data / accent roles ──────────────────────────────────────────────── */
  --pp-violet:#9151B8; --pp-violet-text:#6F3A91; --pp-violet-bg:#f3eaf9; --pp-violet-border:#d6b7e8;
  --pp-coral:#FF8F5C; --pp-coral-text:#B4531F; --pp-coral-bg:#fff0e8; --pp-coral-border:#ffc6a8;
  --pp-pink:#FF57B0; --pp-pink-text:#A62E76; --pp-pink-bg:#ffeaf5; --pp-pink-border:#ffb8dc;
  --pp-grass:#73CC80; --pp-grass-text:#1B7A4F;   /* price fell — favourable to a buyer */

  /* ── status sets — fill / bg / border / text ───────────────────────────── */
  --pp-amber:#EEB72B; --pp-amber-bg:#fdf5e0; --pp-amber-border:#eed591; --pp-amber-text:#8A6710;
  --pp-green:#1DBD8E; --pp-green-bg:#e6f8f2; --pp-green-border:#a6e3d1; --pp-green-text:#016A6C;
  --pp-red:#F24F4F; --pp-red-bg:#fdecec; --pp-red-border:#f7b8b8; --pp-red-text:#C22A2A;
  --pp-red-value:#C22A2A;          /* red as a button fill or a numeral */

  /* ── chart series — strokes clear 3:1 on white; *-fill are fills only ─── */
  --pp-chart-usage:#006ECF; --pp-chart-hedge:#004C94;
  --pp-chart-short:#FF8F5C; --pp-chart-short-stroke:#F24F4F;
  --pp-chart-long:#0FA69D; --pp-chart-long-fill:#00D4C6;
  --pp-chart-peak:#3C93FA;

  /* ── legacy aliases ───────────────────────────────────────────────────────
     The published portals' CSS and the components authored against them still
     name a teal ramp. These keep that code rendering correctly under SB-2026;
     write new code against the ramps above. */
  --pp-teal-900:#2D3F54; --pp-teal-700:#004C94; --pp-teal-600:#004C94;
  --pp-teal-500:#1DBD8E; --pp-teal-300:#43d3a6; --pp-teal-100:#e6f8f2;
  --pp-indigo:#9151B8; --pp-indigo-bg:#f3eaf9;
  --pp-orange:#FF8F5C; --pp-orange-text:#B4531F;
}
```

Create `libs/shared-ui/src/styles/typography.css`:

```css
:root{
  --font-sans:'Inter','Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;
  /* System stack — PeakPower ships no mono webfont. The product's own stack also
     lists 'Cascadia Mono' before Menlo; it is dropped here because it has no font
     file to ship, and Consolas covers the same Windows case. */
  --font-mono:'SF Mono',Menlo,Consolas,monospace;
  /* Dense trading-desk scale — half-pixel steps are intentional, don't round */
  --text-2xs:10px; --text-xs:11px; --text-sm:12.5px; --text-base:13.5px; --text-md:15px;
  --text-lg:17px; --text-xl:23px; --text-hero:32px; --text-display:44px;
  --weight-regular:400; --weight-medium:500; --weight-semibold:600; --weight-bold:700;
  --tracking-eyebrow:0.05em;
}
```

Create `libs/shared-ui/src/styles/spacing.css`:

```css
:root{--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:20px;--space-6:24px;--space-8:32px;--space-10:40px}
```

Create `libs/shared-ui/src/styles/radii.css`:

```css
:root{--radius-sm:6px;--radius-md:8px;--radius-lg:12px;--radius-pill:999px}
```

Create `libs/shared-ui/src/styles/layout.css`:

```css
:root{--sidebar-width:236px;--topbar-height:64px;
  /* card elevation — low and wide, never a hard drop shadow */
  --pp-shadow-card:0 1px 2px rgba(45,63,84,.06), 0 10px 28px -18px rgba(45,63,84,.28);
  --pp-shadow-pop:0 12px 32px -12px rgba(45,63,84,.35)}
```

Create `libs/shared-ui/src/styles/semantic.css`:

```css
/* Semantic aliases. Components reference these names; the --pp-* ramps are the
   raw values. Prefer an alias when the meaning is "surface / border / body
   text", and a --pp-* token when the meaning is the colour itself (brand blue,
   amber warning fill, chart series). */
:root{
  --color-bg:var(--pp-bg);
  --color-bg-gradient:var(--pp-bg-gradient);
  --color-surface:var(--pp-surface);
  --color-surface-alt:var(--pp-surface-alt);
  --color-surface-zebra:var(--pp-surface-zebra);
  --color-border:var(--pp-border);
  --color-border-strong:var(--pp-border-strong);
  --color-text-heading:var(--pp-text-heading);
  --color-text-body:var(--pp-text-body);
  --color-text-faint:var(--pp-text-faint);
  --color-brand:var(--pp-blue-700);
  --color-brand-text:var(--pp-blue-700);
  --color-brand-link:var(--pp-blue-500);
  --color-brand-dark:var(--pp-text-heading);
  --color-accent:var(--pp-mint);
  --color-accent-text:var(--pp-mint-text);
  /* SB-2026 role aliases — the meanings that carry data in this product */
  --color-buy:var(--pp-blue-700);
  --color-sell:var(--pp-pink);
  --color-sell-text:var(--pp-pink-text);
  --color-short:var(--pp-coral);
  --color-short-text:var(--pp-coral-text);
  --color-long:var(--pp-teal);
  --color-long-text:var(--pp-teal-text);
  --color-system:var(--pp-violet);
  --color-system-text:var(--pp-violet-text);
  --color-favourable:var(--pp-grass);
  --color-favourable-text:var(--pp-grass-text);
  --color-unfavourable:var(--pp-red);
  --color-unfavourable-text:var(--pp-red-text);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false && npx ng build customer-portal --configuration development
```

Expected: PASS — `9 passed` from Vitest, followed by `Application bundle generation complete`.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add angular.json libs/shared-ui
git commit -m "feat(shared-ui): port the SB-2026 design token module"
```

---
## Task 4: `formatDutchDecimal` — the one place a number becomes nl-NL text

Every figure the product shows is Dutch-formatted: comma decimal, period thousands, and a real
typographic minus (U+2212 `−`), not the ASCII hyphen. Doing that with `Intl.NumberFormat('nl-NL')`
looks tempting and is wrong twice: Node's ICU emits ` ` as the group separator in some builds,
and it emits the ASCII hyphen for negatives. So the library owns the formatting outright.

The rule that catches the most bugs is the negative-zero rule. A wallet balance of `-0.0001`
rounded to two decimals is zero, and printing `−0,00` tells a customer their balance is negative
when it is not.

**Files:**
- Create: `libs/shared-ui/src/lib/format/dutch-number.ts`
- Modify: `libs/shared-ui/src/public-api.ts`
- Test: `libs/shared-ui/src/lib/format/dutch-number.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — this file has no imports.
- Produces:
  - `export const PP_MINUS: string` — the single character U+2212.
  - `export function formatDutchDecimal(value: number, decimals: number): string`

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/format/dutch-number.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PP_MINUS, formatDutchDecimal } from './dutch-number';

describe('formatDutchDecimal', () => {
  it('groups thousands with a period and separates decimals with a comma', () => {
    expect(formatDutchDecimal(19722, 2)).toBe('19.722,00');
    expect(formatDutchDecimal(1234567.891, 2)).toBe('1.234.567,89');
    expect(formatDutchDecimal(1000, 0)).toBe('1.000');
    expect(formatDutchDecimal(999, 0)).toBe('999');
  });

  it('pads to exactly the number of decimals asked for', () => {
    expect(formatDutchDecimal(0.2, 2)).toBe('0,20');
    expect(formatDutchDecimal(102.4, 4)).toBe('102,4000');
    expect(formatDutchDecimal(385.4, 1)).toBe('385,4');
  });

  it('uses U+2212, not the ASCII hyphen, for a negative number', () => {
    expect(formatDutchDecimal(-4210, 2)).toBe(`${PP_MINUS}4.210,00`);
    expect(formatDutchDecimal(-4210, 2)).not.toContain('-');
  });

  it('never prints a negative zero', () => {
    // A balance of -0,0001 is zero at two decimals. Printing −0,00 tells a
    // customer their money is negative when it is not.
    expect(formatDutchDecimal(-0.0001, 2)).toBe('0,00');
    expect(formatDutchDecimal(-0, 2)).toBe('0,00');
    expect(formatDutchDecimal(-0.4, 0)).toBe('0');
  });

  it('renders a value that is not a finite number as an em dash', () => {
    // "Unavailable" is a real state in this product and it has one glyph.
    expect(formatDutchDecimal(Number.NaN, 2)).toBe('—');
    expect(formatDutchDecimal(Number.POSITIVE_INFINITY, 2)).toBe('—');
  });

  it('exports the minus sign as U+2212', () => {
    expect(PP_MINUS).toHaveLength(1);
    expect(PP_MINUS.codePointAt(0)).toBe(0x2212);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: FAIL — `Failed to resolve import "./dutch-number" from "libs/shared-ui/src/lib/format/dutch-number.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the minimal implementation**

Create `libs/shared-ui/src/lib/format/dutch-number.ts`:

```ts
/**
 * The typographic minus, U+2212. The product never prints an ASCII hyphen in front of a
 * number: `€ −4.210,00`, not `€ -4.210,00`.
 */
export const PP_MINUS = '−';

/** The one glyph the product uses for "there is no number here". */
const PP_UNAVAILABLE = '—';

/**
 * Formats a number the way every Dutch invoice does: period for thousands, comma for the
 * decimal, and U+2212 for the minus. `decimals` is exact — the caller decides how many, and
 * the value is padded or rounded to hit it.
 *
 * `Intl.NumberFormat('nl-NL')` is deliberately not used: depending on the ICU build it emits a
 * narrow no-break space as the group separator, and it always emits the ASCII hyphen.
 */
export function formatDutchDecimal(value: number, decimals: number): string {
  if (!Number.isFinite(value)) {
    return PP_UNAVAILABLE;
  }

  const fixed = value.toFixed(decimals);
  const isNegative = fixed.startsWith('-');
  const magnitude = isNegative ? fixed.slice(1) : fixed;
  const [whole, fraction] = magnitude.split('.');

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const body = fraction === undefined ? grouped : `${grouped},${fraction}`;

  // A value that rounds to zero prints unsigned. −0,00 is not a number anybody means.
  const signed = isNegative && Number(magnitude) !== 0;
  return signed ? PP_MINUS + body : body;
}
```

Replace `libs/shared-ui/src/public-api.ts` — the placeholder `export {}` goes away now that the
library has a first real export:

```ts
// The library's only export surface. Every primitive and pipe is re-exported from here.
export { PP_MINUS, formatDutchDecimal } from './lib/format/dutch-number';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 15 passing tests (the 9 token tests from Task 3 plus these 6).

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/format/dutch-number.ts libs/shared-ui/src/lib/format/dutch-number.spec.ts libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add the nl-NL decimal formatter"
```

---

## Task 5: The four nl-NL formatting pipes

Four units, four fixed shapes. Each is a thin standalone pipe over `formatDutchDecimal`, so
there is exactly one rounding rule in the codebase and a template can never invent its own.

The decimal counts are not stylistic. A price at four decimals is how wholesale energy is
quoted (`€ 102,4000 / MWh`) and truncating it to two changes the number. Power at exactly two
decimals is the contracted-capacity convention (`0,20 MW`).

In Angular 22 a `@Pipe` is standalone by default — there is no `standalone: true` to write and
no `NgModule` to declare it in. Pipes are pure by default too, which is what makes them safe
inside an `OnPush` template.

**Files:**
- Create: `libs/shared-ui/src/lib/format/pp-money.pipe.ts`
- Create: `libs/shared-ui/src/lib/format/pp-energy.pipe.ts`
- Create: `libs/shared-ui/src/lib/format/pp-power.pipe.ts`
- Create: `libs/shared-ui/src/lib/format/pp-price.pipe.ts`
- Modify: `libs/shared-ui/src/public-api.ts`
- Test: `libs/shared-ui/src/lib/format/pp-format.pipes.spec.ts`

**Interfaces:**
- Consumes: `export const PP_MINUS: string` and
  `export function formatDutchDecimal(value: number, decimals: number): string` from Task 4.
- Produces four pipe classes, usable in any standalone component's `imports` array:
  - `PpMoneyPipe` — template name `ppMoney`; `transform(value: number | null | undefined): string`
  - `PpEnergyPipe` — template name `ppEnergy`; `transform(value: number | null | undefined, decimals?: number): string`
  - `PpPowerPipe` — template name `ppPower`; `transform(value: number | null | undefined): string`
  - `PpPricePipe` — template name `ppPrice`; `transform(value: number | null | undefined): string`

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/format/pp-format.pipes.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PP_MINUS } from './dutch-number';
import { PpEnergyPipe } from './pp-energy.pipe';
import { PpMoneyPipe } from './pp-money.pipe';
import { PpPowerPipe } from './pp-power.pipe';
import { PpPricePipe } from './pp-price.pipe';

describe('ppMoney', () => {
  it('renders money as € with two decimals', () => {
    expect(new PpMoneyPipe().transform(19722)).toBe('€ 19.722,00');
    expect(new PpMoneyPipe().transform(29122.5)).toBe('€ 29.122,50');
  });

  it('puts the minus after the euro sign, as the product does', () => {
    expect(new PpMoneyPipe().transform(-4210)).toBe(`€ ${PP_MINUS}4.210,00`);
  });
});

describe('ppEnergy', () => {
  it('renders energy in MWh at one decimal by default', () => {
    expect(new PpEnergyPipe().transform(385.4)).toBe('385,4 MWh');
    expect(new PpEnergyPipe().transform(214.44)).toBe('214,4 MWh');
  });

  it('accepts a different precision, because volumes carry one to three decimals', () => {
    expect(new PpEnergyPipe().transform(214.444, 3)).toBe('214,444 MWh');
  });
});

describe('ppPower', () => {
  it('always renders exactly two decimals', () => {
    expect(new PpPowerPipe().transform(0.2)).toBe('0,20 MW');
    expect(new PpPowerPipe().transform(2)).toBe('2,00 MW');
    expect(new PpPowerPipe().transform(1234.5)).toBe('1.234,50 MW');
  });
});

describe('ppPrice', () => {
  it('always renders exactly four decimals, per MWh', () => {
    expect(new PpPricePipe().transform(102.4)).toBe('€ 102,4000 / MWh');
    expect(new PpPricePipe().transform(98)).toBe('€ 98,0000 / MWh');
  });
});

describe('every nl-NL pipe', () => {
  it('renders a missing value as an em dash rather than "null" or "NaN"', () => {
    expect(new PpMoneyPipe().transform(null)).toBe('—');
    expect(new PpEnergyPipe().transform(undefined)).toBe('—');
    expect(new PpPowerPipe().transform(null)).toBe('—');
    expect(new PpPricePipe().transform(undefined)).toBe('—');
  });

  it('is pure, so it is safe in an OnPush template', () => {
    // A pipe with no `pure: false` is pure; assert it explicitly so nobody flips it later.
    for (const source of [PpMoneyPipe, PpEnergyPipe, PpPowerPipe, PpPricePipe]) {
      expect(source.prototype.transform).toBeTypeOf('function');
    }
    expect(new PpMoneyPipe().transform(1)).toBe(new PpMoneyPipe().transform(1));
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: FAIL — `Failed to resolve import "./pp-energy.pipe" from "libs/shared-ui/src/lib/format/pp-format.pipes.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the minimal implementation**

Create `libs/shared-ui/src/lib/format/pp-money.pipe.ts`:

```ts
import { Pipe, PipeTransform } from '@angular/core';
import { formatDutchDecimal } from './dutch-number';

/** `19722` → `€ 19.722,00`. The sign sits after the euro sign: `€ −4.210,00`. */
@Pipe({ name: 'ppMoney' })
export class PpMoneyPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '—';
    }
    return `€ ${formatDutchDecimal(value, 2)}`;
  }
}
```

Create `libs/shared-ui/src/lib/format/pp-energy.pipe.ts`:

```ts
import { Pipe, PipeTransform } from '@angular/core';
import { formatDutchDecimal } from './dutch-number';

/** `385.4` → `385,4 MWh`. Volumes carry one to three decimals; one is the default. */
@Pipe({ name: 'ppEnergy' })
export class PpEnergyPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 1): string {
    if (value === null || value === undefined) {
      return '—';
    }
    return `${formatDutchDecimal(value, decimals)} MWh`;
  }
}
```

Create `libs/shared-ui/src/lib/format/pp-power.pipe.ts`:

```ts
import { Pipe, PipeTransform } from '@angular/core';
import { formatDutchDecimal } from './dutch-number';

/**
 * `0.2` → `0,20 MW`. Contracted capacity is always quoted at exactly two decimals, so this
 * pipe takes no precision argument — a call site cannot shorten it.
 */
@Pipe({ name: 'ppPower' })
export class PpPowerPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '—';
    }
    return `${formatDutchDecimal(value, 2)} MW`;
  }
}
```

Create `libs/shared-ui/src/lib/format/pp-price.pipe.ts`:

```ts
import { Pipe, PipeTransform } from '@angular/core';
import { formatDutchDecimal } from './dutch-number';

/**
 * `102.4` → `€ 102,4000 / MWh`. Wholesale energy is quoted at four decimals; rounding to two
 * changes the price, so this pipe takes no precision argument either.
 */
@Pipe({ name: 'ppPrice' })
export class PpPricePipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '—';
    }
    return `€ ${formatDutchDecimal(value, 4)} / MWh`;
  }
}
```

Replace `libs/shared-ui/src/public-api.ts`:

```ts
// The library's only export surface. Every primitive and pipe is re-exported from here.
export { PP_MINUS, formatDutchDecimal } from './lib/format/dutch-number';
export { PpMoneyPipe } from './lib/format/pp-money.pipe';
export { PpEnergyPipe } from './lib/format/pp-energy.pipe';
export { PpPowerPipe } from './lib/format/pp-power.pipe';
export { PpPricePipe } from './lib/format/pp-price.pipe';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 23 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/format libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add the ppMoney, ppEnergy, ppPower and ppPrice pipes"
```

---

## Task 6: `pp-badge`

The pill status label — the product's single status vocabulary. It reads `PpTone`, the one tone
type shared contract §10.1 gives the whole library, and this task is where that type is born:
six tones, each one a *meaning* rather than a decoration. `success` = confirmed / final /
healthy, `warning` = waiting on someone / provisional, `critical` = failed / expiring,
`info` = an in-flight or partial record, `brand` = a product shape (Base / Peak),
`neutral` = not tradeable / projected / duplicate.

One vocabulary, one spelling. The contract is explicit that `'positive'` and `'danger'` are not
members — a favourable outcome is `success` and a destructive one is `critical` — and the same
six names serve `pp-banner`, `pp-ds-banner` and `pp-stat-card`, so a tone learnt on one
component is a tone everywhere. The data roles the palette also carries (short, long, sell,
system) are chart and figure colours, not status pills; they stay in the token file.

Two rules carry the whole component. **Every tone has a real 1px border** — without it the tones
with pale tints (`info`, `neutral`) dissolve into a white card. And **the text colour is always
the darker `*-text` tier, never the bright fill** — an 11px badge set in `#1DBD8E` is about 2:1
on white and unreadable.

Every component from here on styles its own host element, so the stylesheets use `:host` and
`:host(.modifier)`. Under Angular's emulated view encapsulation a plain `.pp-badge {}` rule is
rewritten to `.pp-badge[_ngcontent-xxx]` and would never match the host, which carries
`_nghost-xxx` instead.

**Files:**
- Create: `libs/shared-ui/src/lib/tone.ts`
- Create: `libs/shared-ui/src/lib/badge/pp-badge.ts`
- Create: `libs/shared-ui/src/lib/badge/pp-badge.css`
- Modify: `libs/shared-ui/src/public-api.ts`
- Test: `libs/shared-ui/src/lib/badge/pp-badge.spec.ts`

**Interfaces:**
- Consumes: `export function cssText(relativePath: string): string` and
  `export const PP_BRIGHT_FILL_TOKENS: readonly string[]` from Task 3's
  `libs/shared-ui/src/testing/read-css.ts`.
- Produces:
  - `export type PpTone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'critical'`
    — shared contract §10.1, and the tone type every later toned component imports.
  - `export class PpBadge` — selector `pp-badge`, input `tone: InputSignal<PpTone>`
    (default `'neutral'`), content projected as the label.

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/badge/pp-badge.spec.ts`:

```ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { PP_BRIGHT_FILL_TOKENS, cssText } from '../../testing/read-css';
import type { PpTone } from '../tone';
import { PpBadge } from './pp-badge';

@Component({
  imports: [PpBadge],
  template: `<pp-badge tone="success">Confirmed</pp-badge>`,
})
class BadgeHost {}

const ALL_TONES: readonly PpTone[] = [
  'neutral', 'brand', 'info', 'success', 'warning', 'critical',
];

/** The whitespace-stripped declaration block for one tone's `:host(...)` rule. */
function toneBlock(tone: string): string {
  const css = cssText('lib/badge/pp-badge.css');
  const marker = `:host(.pp-badge--${tone}){`;
  const start = css.indexOf(marker);
  expect(start, `pp-badge.css has no rule for the ${tone} tone`).toBeGreaterThan(-1);
  return css.slice(start + marker.length, css.indexOf('}', start));
}

describe('pp-badge', () => {
  it('puts the tone on the host element, so nothing has to wrap it', () => {
    const fixture = TestBed.createComponent(PpBadge);
    fixture.componentRef.setInput('tone', 'success');
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.tagName.toLowerCase()).toBe('pp-badge');
    expect(host.classList.contains('pp-badge')).toBe(true);
    expect(host.classList.contains('pp-badge--success')).toBe(true);
    expect(host.classList.contains('pp-badge--neutral')).toBe(false);
  });

  it('spells the tones the way the whole library spells them', () => {
    // Shared contract §10.1: 'positive' is 'success', 'danger' is 'critical', and neither of
    // those two spellings may appear anywhere.
    const css = cssText('lib/badge/pp-badge.css');
    expect(css).not.toContain('positive');
    expect(css).not.toContain('danger');
    for (const tone of ALL_TONES) {
      expect(css, `${tone} has no rule`).toContain(`:host(.pp-badge--${tone})`);
    }
  });

  it('gives every tone a real 1px border', () => {
    const css = cssText('lib/badge/pp-badge.css');
    expect(css).toContain('border:1pxsolidvar(--pp-badge-border)');
    for (const tone of ALL_TONES) {
      const block = toneBlock(tone);
      expect(block, `${tone} sets no border colour`).toContain('--pp-badge-border:');
      expect(block, `${tone} fakes its border with transparent`).not.toContain('transparent');
    }
  });

  it('sets no letter-spacing — a 4px/12px pill at 11px is tight enough already', () => {
    expect(cssText('lib/badge/pp-badge.css')).not.toContain('letter-spacing');
  });

  it('never sets a badge text colour to a bright fill token', () => {
    const css = cssText('lib/badge/pp-badge.css');
    const textValues = [...css.matchAll(/--pp-badge-text:([^;}]+)/g)].map((match) => match[1]);
    expect(textValues).toHaveLength(ALL_TONES.length);
    for (const value of textValues) {
      for (const bright of PP_BRIGHT_FILL_TOKENS) {
        expect(value, `${value} sets an 11px label in the bright fill ${bright}`).not.toMatch(
          new RegExp(`${bright}(?![\\w-])`),
        );
      }
    }
  });

  it('renders its projected label', () => {
    const fixture = TestBed.createComponent(BadgeHost);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent?.trim()).toBe('Confirmed');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: FAIL — `Failed to resolve import "./pp-badge" from "libs/shared-ui/src/lib/badge/pp-badge.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the minimal implementation**

Create `libs/shared-ui/src/lib/tone.ts`:

```ts
/**
 * The one tone vocabulary in this library — shared contract §10.1. A tone is a meaning, not a
 * colour choice: pick the one that says what the record IS, and the palette decides how it
 * looks. `pp-badge`, `pp-banner`, `pp-ds-banner` and `pp-stat-card` all read this type, so a
 * tone learnt on one of them is a tone on all four.
 *
 * There is no 'positive' and no 'danger': a favourable outcome is `success`, a destructive or
 * failed one is `critical`.
 */
export type PpTone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'critical';
```

Create `libs/shared-ui/src/lib/badge/pp-badge.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { PpTone } from '../tone';

@Component({
  selector: 'pp-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-badge.css',
  template: `<ng-content />`,
  host: { '[class]': 'hostClass()' },
})
export class PpBadge {
  readonly tone = input<PpTone>('neutral');

  protected readonly hostClass = computed(() => `pp-badge pp-badge--${this.tone()}`);
}
```

Create `libs/shared-ui/src/lib/badge/pp-badge.css`:

```css
/* 11px/600, 4px 12px, pill radius, line-height 1.2, and no letter-spacing.
   The border is declared once here and coloured per tone below, so a tone that
   forgets its border is a missing custom property rather than a silent hairline. */
:host {
  display: inline-block;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  line-height: 1.2;
  padding: 4px 12px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--pp-badge-border);
  background: var(--pp-badge-bg);
  color: var(--pp-badge-text);
  white-space: nowrap;
}

/* Every --pp-badge-text below is a darker *-text tier. A bright fill used as
   11px type drops to roughly 2:1 on white. Six tones, no more: the tone list is
   PpTone, and every toned component in the library reads the same six names. */
:host(.pp-badge--neutral) {
  --pp-badge-bg: var(--pp-surface-alt);
  --pp-badge-border: var(--color-border-strong);
  --pp-badge-text: var(--color-text-body);
}
:host(.pp-badge--brand) {
  --pp-badge-bg: var(--pp-blue-100);
  --pp-badge-border: #a9c8e8;
  --pp-badge-text: var(--pp-blue-700);
}
:host(.pp-badge--info) {
  --pp-badge-bg: var(--pp-blue-050);
  --pp-badge-border: #a9c8e8;
  --pp-badge-text: var(--pp-blue-700);
}
:host(.pp-badge--success) {
  --pp-badge-bg: var(--pp-green-bg);
  --pp-badge-border: var(--pp-green-border);
  --pp-badge-text: var(--pp-green-text);
}
:host(.pp-badge--warning) {
  --pp-badge-bg: var(--pp-amber-bg);
  --pp-badge-border: var(--pp-amber-border);
  --pp-badge-text: var(--pp-amber-text);
}
:host(.pp-badge--critical) {
  --pp-badge-bg: var(--pp-red-bg);
  --pp-badge-border: var(--pp-red-border);
  --pp-badge-text: var(--pp-red-text);
}
```

Append to `libs/shared-ui/src/public-api.ts`:

```ts
export type { PpTone } from './lib/tone';
export { PpBadge } from './lib/badge/pp-badge';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 29 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/tone.ts libs/shared-ui/src/lib/badge libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add PpTone and the pp-badge status pill"
```

---

## Task 7: `pp-button`

One button primitive, five variants, two sizes. The rule that makes it a system rather than a
pile of styles is that **every variant carries `border: 1px solid`** — including `ghost`, whose
border is transparent. A borderless ghost button is 2px shorter than the primary button beside
it, and a filter row of mixed variants goes visibly ragged.

The five variants are `primary`, `secondary`, `ghost`, `danger` and `accept` — shared contract
§10.1, where `accept` is the mint-filled affirmative a customer presses to take a firm price.
The default is **`secondary`**: a bare `<pp-button>Cancel</pp-button>` beside an explicit
primary action is the quieter of the pair, and both portals write their primary action out in
full.

`danger` fills with `--pp-red-value` (`#C22A2A`), not the bright `--pp-red` (`#F24F4F`): white
on the bright red is only 3,5:1.

The component wraps a real `<button>` so keyboard activation, `type="submit"` and the disabled
semantics all come from the platform. A `click` on the inner button bubbles out through the
`<pp-button>` host, so consumers just write `<pp-button (click)="…">`.

**Files:**
- Create: `libs/shared-ui/src/lib/button/pp-button.ts`
- Create: `libs/shared-ui/src/lib/button/pp-button.css`
- Modify: `libs/shared-ui/src/public-api.ts`
- Test: `libs/shared-ui/src/lib/button/pp-button.spec.ts`

**Interfaces:**
- Consumes: `export function cssText(relativePath: string): string` from Task 3.
- Produces:
  - `export type PpButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accept'`
  - `export type PpButtonSize = 'md' | 'sm'`
  - `export class PpButton` — selector `pp-button`, inputs
    `variant: InputSignal<PpButtonVariant>` (default `'secondary'`),
    `size: InputSignal<PpButtonSize>` (default `'md'`),
    `disabled: InputSignalWithTransform<boolean, unknown>` (default `false`),
    `type: InputSignal<'button' | 'submit'>` (default `'button'`).

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/button/pp-button.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { cssText } from '../../testing/read-css';
import { PpButton, type PpButtonVariant } from './pp-button';

const ALL_VARIANTS: readonly PpButtonVariant[] = [
  'primary', 'secondary', 'ghost', 'danger', 'accept',
];

function variantBlock(variant: string): string {
  const css = cssText('lib/button/pp-button.css');
  const marker = `:host(.pp-button--${variant}){`;
  const start = css.indexOf(marker);
  expect(start, `pp-button.css has no rule for the ${variant} variant`).toBeGreaterThan(-1);
  return css.slice(start + marker.length, css.indexOf('}', start));
}

describe('pp-button', () => {
  it('declares border:1px solid once, for every variant to colour', () => {
    const css = cssText('lib/button/pp-button.css');
    expect(css).toContain('border:1pxsolidvar(--pp-button-border)');
    for (const variant of ALL_VARIANTS) {
      expect(variantBlock(variant), `${variant} sets no border colour`).toContain(
        '--pp-button-border:',
      );
    }
  });

  it('never removes the border, because that is what makes the heights match', () => {
    const css = cssText('lib/button/pp-button.css');
    expect(css).not.toContain('border:none');
    expect(css).not.toContain('border:0');
    // ghost is invisible, not borderless.
    expect(variantBlock('ghost')).toContain('--pp-button-border:transparent');
  });

  it('changes only padding and font size between the two sizes', () => {
    const css = cssText('lib/button/pp-button.css');
    expect(css).toContain('padding:10px20px');
    expect(css).toContain('padding:7px14px');
  });

  it('defaults to secondary, so a bare <pp-button> is the quieter action', () => {
    const fixture = TestBed.createComponent(PpButton);
    fixture.detectChanges();
    expect(fixture.nativeElement.classList.contains('pp-button--secondary')).toBe(true);
  });

  it('carries the variant and the size on the host', () => {
    const fixture = TestBed.createComponent(PpButton);
    fixture.componentRef.setInput('variant', 'secondary');
    fixture.componentRef.setInput('size', 'sm');
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.classList.contains('pp-button--secondary')).toBe(true);
    expect(host.classList.contains('pp-button--sm')).toBe(true);
  });

  it('passes disabled through to the native button rather than faking it', () => {
    const fixture = TestBed.createComponent(PpButton);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    const control: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(control.disabled).toBe(true);
    expect(control.type).toBe('button');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: FAIL — `Failed to resolve import "./pp-button" from "libs/shared-ui/src/lib/button/pp-button.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the minimal implementation**

Create `libs/shared-ui/src/lib/button/pp-button.ts`:

```ts
import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

export type PpButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accept';
export type PpButtonSize = 'md' | 'sm';

@Component({
  selector: 'pp-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-button.css',
  // The inner button fills the host exactly, so every click lands on it and a
  // disabled button swallows the event before it can bubble out of pp-button.
  template: `
    <button class="pp-button__control" [type]="type()" [disabled]="disabled()">
      <ng-content />
    </button>
  `,
  host: { '[class]': 'hostClass()' },
})
export class PpButton {
  readonly variant = input<PpButtonVariant>('secondary');
  readonly size = input<PpButtonSize>('md');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly type = input<'button' | 'submit'>('button');

  protected readonly hostClass = computed(
    () => `pp-button pp-button--${this.variant()} pp-button--${this.size()}`,
  );
}
```

Create `libs/shared-ui/src/lib/button/pp-button.css`:

```css
:host {
  display: inline-flex;
}

/* border:1px solid appears exactly once. Every variant colours it — ghost with
   `transparent` — so a primary and a ghost button in the same row are the same
   height to the pixel. */
.pp-button__control {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: var(--weight-semibold);
  padding: 10px 20px;
  border-radius: var(--radius-md);
  border: 1px solid var(--pp-button-border);
  background: var(--pp-button-bg);
  color: var(--pp-button-text);
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

/* Disabled is dimmed, never hidden — the reason it is disabled is said in copy. */
.pp-button__control:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

:host(.pp-button--sm) .pp-button__control {
  padding: 7px 14px;
  font-size: 12px;
}

:host(.pp-button--primary) {
  --pp-button-bg: var(--pp-blue-700);
  --pp-button-border: var(--pp-blue-700);
  --pp-button-text: #ffffff;
}
:host(.pp-button--primary) .pp-button__control:hover:not(:disabled) {
  --pp-button-bg: var(--pp-blue-900);
  --pp-button-border: var(--pp-blue-900);
}

:host(.pp-button--secondary) {
  --pp-button-bg: var(--color-surface);
  --pp-button-border: var(--color-border-strong);
  --pp-button-text: var(--color-text-heading);
}
:host(.pp-button--secondary) .pp-button__control:hover:not(:disabled) {
  --pp-button-bg: var(--color-surface-alt);
}

/* Filled with the darker red tier: white on #F24F4F is only 3,5:1. */
:host(.pp-button--danger) {
  --pp-button-bg: var(--pp-red-value);
  --pp-button-border: var(--pp-red-value);
  --pp-button-text: #ffffff;
}
:host(.pp-button--danger) .pp-button__control:hover:not(:disabled) {
  --pp-button-bg: #a32222;
  --pp-button-border: #a32222;
}

/* The affirmative: take this price, accept this offer. Mint under heading-tier type. */
:host(.pp-button--accept) {
  --pp-button-bg: var(--pp-mint);
  --pp-button-border: var(--pp-mint);
  --pp-button-text: var(--pp-text-heading);
}
:host(.pp-button--accept) .pp-button__control:hover:not(:disabled) {
  --pp-button-bg: #17a67c;
  --pp-button-border: #17a67c;
}

:host(.pp-button--ghost) {
  --pp-button-bg: transparent;
  --pp-button-border: transparent;
  --pp-button-text: var(--pp-blue-500);
}
:host(.pp-button--ghost) .pp-button__control:hover:not(:disabled) {
  --pp-button-bg: var(--pp-blue-050);
}

.pp-button__control:focus-visible {
  outline: none;
  border-color: var(--pp-blue-300);
  box-shadow: 0 0 0 3px rgba(60, 147, 250, 0.22);
}
```

Append to `libs/shared-ui/src/public-api.ts`:

```ts
export { PpButton, type PpButtonSize, type PpButtonVariant } from './lib/button/pp-button';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 35 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/button libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add the pp-button primitive with matching variant heights"
```

---

## Task 8: `pp-card`

The default content container for every screen section: white, 1px hairline border, the low wide
SB-2026 card shadow, `18px 20px` of padding.

The head line is the `heading` input — shared contract §10.1 names it `heading`, not `title`,
and both portals bind it that way on every card they render.

The rule worth a test is the spacing one, because it is the thing that gets "tidied" and breaks.
**The subtitle is a sibling of the head, not a child of it.** The head is a flex row — heading on
the left, action on the right — and a subtitle nested inside that row would be laid out beside
the heading instead of beneath it. Because the subtitle sits outside, the head's bottom margin
has to shrink from 14px to 4px whenever a subtitle follows, and the subtitle then carries the
remaining 14px down to the body. Get that wrong in either direction and every card on the screen
is 10px taller or the subtitle collides with the body.

**Files:**
- Create: `libs/shared-ui/src/lib/card/pp-card.ts`
- Create: `libs/shared-ui/src/lib/card/pp-card.css`
- Modify: `libs/shared-ui/src/public-api.ts`
- Test: `libs/shared-ui/src/lib/card/pp-card.spec.ts`

**Interfaces:**
- Consumes: `export function cssText(relativePath: string): string` from Task 3.
- Produces:
  - `export class PpCard` — selector `pp-card`, inputs `heading: InputSignal<string>` (default
    `''`) and `subtitle: InputSignal<string>` (default `''`); two content slots — anything
    carrying the `ppCardAction` attribute is projected into the head, everything else into the
    body.

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/card/pp-card.spec.ts`:

```ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { cssText } from '../../testing/read-css';
import { PpCard } from './pp-card';

@Component({
  imports: [PpCard],
  template: `
    <pp-card heading="Ledger" subtitle="Every movement, newest first">
      <span ppCardAction>Export CSV</span>
      <p class="body-marker">Nine entries this month.</p>
    </pp-card>
  `,
})
class WithSubtitleHost {}

@Component({
  imports: [PpCard],
  template: `<pp-card heading="Ledger"><p>Nine entries this month.</p></pp-card>`,
})
class WithoutSubtitleHost {}

@Component({
  imports: [PpCard],
  template: `<pp-card><p>Nine entries this month.</p></pp-card>`,
})
class UntitledHost {}

describe('pp-card', () => {
  it('renders the subtitle as a SIBLING of the head, never inside it', () => {
    const fixture = TestBed.createComponent(WithSubtitleHost);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const head = el.querySelector('.pp-card__head')!;
    const subtitle = el.querySelector('.pp-card__subtitle')!;

    expect(head).not.toBeNull();
    expect(subtitle).not.toBeNull();
    // Inside the head's flex row the subtitle would sit BESIDE the heading.
    expect(head.contains(subtitle)).toBe(false);
    expect(subtitle.parentElement).toBe(head.parentElement);
  });

  it('tightens the head when a subtitle follows it', () => {
    const fixture = TestBed.createComponent(WithSubtitleHost);
    fixture.detectChanges();
    const head = fixture.nativeElement.querySelector('.pp-card__head') as HTMLElement;
    expect(head.classList.contains('pp-card__head--tight')).toBe(true);
  });

  it('keeps the head at its full gap when there is no subtitle', () => {
    const fixture = TestBed.createComponent(WithoutSubtitleHost);
    fixture.detectChanges();
    const head = fixture.nativeElement.querySelector('.pp-card__head') as HTMLElement;
    expect(head.classList.contains('pp-card__head--tight')).toBe(false);
  });

  it('drops 14px to 4px, and hands the missing 10px to the subtitle', () => {
    const css = cssText('lib/card/pp-card.css');
    expect(css).toContain('.pp-card__head{');
    expect(css).toContain('margin-bottom:14px');
    expect(css).toContain('.pp-card__head--tight{margin-bottom:4px}');
    expect(css).toContain('.pp-card__subtitle{');
    // 4 + 10 = the same 14px gap to the body either way.
    const subtitleStart = css.indexOf('.pp-card__subtitle{');
    const subtitleBlock = css.slice(subtitleStart, css.indexOf('}', subtitleStart));
    expect(subtitleBlock).toContain('margin-bottom:14px');
  });

  it('gives the head no margin-top, so the card padding is the only top gap', () => {
    const css = cssText('lib/card/pp-card.css');
    const headStart = css.indexOf('.pp-card__head{');
    const headBlock = css.slice(headStart, css.indexOf('}', headStart));
    expect(headBlock).toContain('margin-top:0');
  });

  it('renders no head at all when there is no heading', () => {
    const fixture = TestBed.createComponent(UntitledHost);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pp-card__head')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Nine entries this month.');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: FAIL — `Failed to resolve import "./pp-card" from "libs/shared-ui/src/lib/card/pp-card.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the minimal implementation**

Create `libs/shared-ui/src/lib/card/pp-card.ts`:

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The default content container. A card with a header action but no heading is not a shape this
 * system has — the action belongs to the heading, so the head is gated on the heading alone.
 */
@Component({
  selector: 'pp-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-card.css',
  template: `
    @if (heading()) {
      <div class="pp-card__head" [class.pp-card__head--tight]="subtitle().length > 0">
        <div class="pp-card__heading">{{ heading() }}</div>
        <div class="pp-card__action"><ng-content select="[ppCardAction]" /></div>
      </div>
    }
    @if (subtitle()) {
      <div class="pp-card__subtitle">{{ subtitle() }}</div>
    }
    <ng-content />
  `,
  host: { class: 'pp-card' },
})
export class PpCard {
  readonly heading = input<string>('');
  /** One-line explanation under the heading. It carries its own 14px bottom margin. */
  readonly subtitle = input<string>('');
}
```

Create `libs/shared-ui/src/lib/card/pp-card.css`:

```css
:host {
  display: block;
  font-family: var(--font-sans);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--pp-shadow-card);
  padding: 18px 20px;
}

/* The head is a flex row, so the subtitle CANNOT live inside it — it would be
   laid out beside the heading. It is a sibling, and the 14px gap to the body is
   split 4 + 10 the moment a subtitle exists. */
.pp-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-top: 0;
  margin-bottom: 14px;
}
.pp-card__head--tight {
  margin-bottom: 4px;
}

.pp-card__heading {
  font-size: var(--text-base);
  font-weight: var(--weight-bold);
  color: var(--color-text-heading);
}

.pp-card__subtitle {
  font-size: 11.5px;
  color: var(--color-text-body);
  margin-bottom: 14px;
}

/* Right-aligned header slot — a text link or a small button. */
.pp-card__action {
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--pp-blue-500);
  white-space: nowrap;
  flex-shrink: 0;
}
```

Append to `libs/shared-ui/src/public-api.ts`:

```ts
export { PpCard } from './lib/card/pp-card';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 41 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/card libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add the pp-card container with the sibling subtitle rule"
```

---

## Task 9: `pp-stat-card`

One headline figure with its label and its provenance. Rows of three to six sit at the top of
nearly every portal screen.

Three rules, all of them things that got broken in the prototype:

- **No `flex: 1`.** A stat card is sized by its content and a `min-width: 160px` floor. Stretch
  them to fill the row and every figure on the screen re-flows the moment one number gains a
  digit — which, on a trading desk, is constantly.
- **The tone marker goes on the outer element.** The tone colours the accent cap *and* the
  value; putting the class on an inner div means the cap needs its own copy of it.
- **The 3px accent cap is a `::before` on the host**, not a nested div. There is no element to
  forget and nothing for a consumer's content to displace.

The tone is `PpTone`, the same six names the badge uses — `neutral` is the plain figure and the
default. `critical` is coral in this system, not red. A genuinely red figure — a negative
balance — is a call-site decision, not a tone.

**Files:**
- Create: `libs/shared-ui/src/lib/stat-card/pp-stat-card.ts`
- Create: `libs/shared-ui/src/lib/stat-card/pp-stat-card.css`
- Modify: `libs/shared-ui/src/public-api.ts`
- Test: `libs/shared-ui/src/lib/stat-card/pp-stat-card.spec.ts`

**Interfaces:**
- Consumes: `export function cssText(relativePath: string): string` from Task 3.
- Produces:
  - `export class PpStatCard` — selector `pp-stat-card`, inputs
    `label: InputSignal<string>` (required), `value: InputSignal<string>` (required),
    `sublabel: InputSignal<string>` (default `''`),
    `tone: InputSignal<PpTone>` (default `'neutral'`, from Task 6's `lib/tone.ts`),
    `highlight: InputSignalWithTransform<boolean, unknown>` (default `false`).

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/stat-card/pp-stat-card.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { cssText } from '../../testing/read-css';
import { PpStatCard } from './pp-stat-card';

function createStatCard(): ReturnType<typeof TestBed.createComponent<PpStatCard>> {
  const fixture = TestBed.createComponent(PpStatCard);
  fixture.componentRef.setInput('label', 'UNCOVERED VOLUME');
  fixture.componentRef.setInput('value', '214,4 MWh');
  return fixture;
}

describe('pp-stat-card', () => {
  it('declares no flex shorthand at all — a stat card is never stretched', () => {
    // flex:1 makes every figure on the screen re-flow when one number gains a digit.
    expect(cssText('lib/stat-card/pp-stat-card.css')).not.toContain('flex:');
  });

  it('sizes itself by content down to a 160px floor', () => {
    expect(cssText('lib/stat-card/pp-stat-card.css')).toContain('min-width:160px');
  });

  it('puts the tone marker on the outer element and nowhere else', () => {
    const fixture = createStatCard();
    fixture.componentRef.setInput('tone', 'critical');
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.classList.contains('pp-stat-card--critical')).toBe(true);
    // querySelector searches descendants only, so this excludes the host itself.
    expect(host.querySelector('[class*="pp-stat-card--"]')).toBeNull();
  });

  it('draws the 3px accent cap as a ::before on the host', () => {
    const css = cssText('lib/stat-card/pp-stat-card.css');
    const start = css.indexOf(':host::before{');
    expect(start, 'the accent cap is not a ::before on the host').toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('height:3px');
    expect(block).toContain('background:var(--pp-stat-card-cap)');
    expect(css).toContain('overflow:hidden');
  });

  it('lets the tone colour the value but never the label', () => {
    const css = cssText('lib/stat-card/pp-stat-card.css');
    const valueStart = css.indexOf('.pp-stat-card__value{');
    expect(css.slice(valueStart, css.indexOf('}', valueStart))).toContain(
      'color:var(--pp-stat-card-value)',
    );
    const labelStart = css.indexOf('.pp-stat-card__label{');
    expect(css.slice(labelStart, css.indexOf('}', labelStart))).toContain(
      'color:var(--color-text-body)',
    );
  });

  it('swaps the surface to amber when highlighted', () => {
    const fixture = createStatCard();
    fixture.componentRef.setInput('highlight', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.classList.contains('pp-stat-card--highlight')).toBe(true);
    expect(cssText('lib/stat-card/pp-stat-card.css')).toContain(
      ':host(.pp-stat-card--highlight){background:var(--pp-amber-bg);border-color:var(--pp-amber-border)}',
    );
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: FAIL — `Failed to resolve import "./pp-stat-card" from "libs/shared-ui/src/lib/stat-card/pp-stat-card.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the minimal implementation**

Create `libs/shared-ui/src/lib/stat-card/pp-stat-card.ts`:

```ts
import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { PpTone } from '../tone';

@Component({
  selector: 'pp-stat-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-stat-card.css',
  template: `
    <div class="pp-stat-card__label">{{ label() }}</div>
    <div class="pp-stat-card__value">{{ value() }}</div>
    @if (sublabel()) {
      <div class="pp-stat-card__sublabel">{{ sublabel() }}</div>
    }
  `,
  host: { '[class]': 'hostClass()' },
})
export class PpStatCard {
  /** Upper-case short label, e.g. "AVAILABLE BALANCE". */
  readonly label = input.required<string>();
  /** Already formatted — pass it through ppMoney, ppEnergy, ppPower or ppPrice. */
  readonly value = input.required<string>();
  /** Faint qualifier under the value: where the number came from. */
  readonly sublabel = input<string>('');
  /** `critical` is CORAL here, not red. A red figure is a call-site decision. */
  readonly tone = input<PpTone>('neutral');
  /** Amber surface — the column of the queue that needs action now. */
  readonly highlight = input(false, { transform: booleanAttribute });

  protected readonly hostClass = computed(() => {
    const base = `pp-stat-card pp-stat-card--${this.tone()}`;
    return this.highlight() ? `${base} pp-stat-card--highlight` : base;
  });
}
```

Create `libs/shared-ui/src/lib/stat-card/pp-stat-card.css`:

```css
/* No flex shorthand anywhere in this file, deliberately. A stat card is sized by
   its content and its 160px floor; the row that holds it does the layout. */
:host {
  display: block;
  position: relative;
  overflow: hidden;
  font-family: var(--font-sans);
  min-width: 160px;
  padding: 14px 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--pp-shadow-card);
}

/* The 3px accent cap. A pseudo-element on the OUTER element, so the tone class
   is never repeated on an inner div and there is no element to forget. */
:host::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 3px;
  background: var(--pp-stat-card-cap);
}

:host(.pp-stat-card--neutral) {
  --pp-stat-card-cap: var(--pp-blue-700);
  --pp-stat-card-value: var(--color-text-heading);
}
:host(.pp-stat-card--brand) {
  --pp-stat-card-cap: var(--pp-blue-700);
  --pp-stat-card-value: var(--pp-blue-700);
}
:host(.pp-stat-card--info) {
  --pp-stat-card-cap: var(--pp-blue-300);
  --pp-stat-card-value: var(--pp-blue-700);
}
:host(.pp-stat-card--warning) {
  --pp-stat-card-cap: var(--pp-amber);
  --pp-stat-card-value: var(--pp-amber-text);
}
:host(.pp-stat-card--critical) {
  --pp-stat-card-cap: var(--pp-coral);
  --pp-stat-card-value: var(--pp-coral-text);
}
:host(.pp-stat-card--success) {
  --pp-stat-card-cap: var(--pp-mint);
  --pp-stat-card-value: var(--pp-mint-text);
}
:host(.pp-stat-card--highlight){background:var(--pp-amber-bg);border-color:var(--pp-amber-border)}

/* ALL CAPS is legal here — a stat-card label is one of only two places it is. */
.pp-stat-card__label{font-size:var(--text-xs);font-weight:var(--weight-semibold);color:var(--color-text-body);letter-spacing:.04em}
.pp-stat-card__value{font-size:var(--text-xl);font-weight:var(--weight-bold);color:var(--pp-stat-card-value);margin-top:8px;white-space:nowrap}
.pp-stat-card__sublabel{font-size:var(--text-xs);color:var(--color-text-faint);margin-top:6px;line-height:1.45}
```

Append to `libs/shared-ui/src/public-api.ts`:

```ts
export { PpStatCard } from './lib/stat-card/pp-stat-card';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 47 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/stat-card libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add the pp-stat-card figure with its 3px accent cap"
```

---

## Task 10: `pp-banner` — the SB-2026 page-level notice

The notice that sits directly above the content it qualifies, full width, never more than one at
a time. It reads `PpTone`: `warning` = you must act, or this data is provisional.
`critical` = something failed or halted — say what, and who is on it. `info` = this qualifies the
screen and needs no action. `success` = the thing you were waiting for happened.

This is the SB-2026 shape from the adopted design: a **26px rounded-square** mark holding a
literal `!`, `15px 18px` of padding, heading 13/700 and the note 11.5 three pixels under it.

Two things follow shared contract §10.1 and are worth naming, because both portals depend on
them. The head line is **`heading`**, and it is **optional** — `<pp-banner tone="info">One
line.</pp-banner>` is a legal notice. And the note is **projected content**, not an input: every
consumer writes its sentence, and sometimes a `<pp-button>` or two, between the tags.

The `!` inside the mark is one of only four glyphs in the entire product. There is no icon set to
reach for.

**Files:**
- Create: `libs/shared-ui/src/lib/banner/pp-banner.ts`
- Create: `libs/shared-ui/src/lib/banner/pp-banner.css`
- Modify: `libs/shared-ui/src/public-api.ts`
- Test: `libs/shared-ui/src/lib/banner/pp-banner.spec.ts`

**Interfaces:**
- Consumes: `export function cssText(relativePath: string): string` and
  `export const PP_BRIGHT_FILL_TOKENS: readonly string[]` from Task 3.
- Produces:
  - `export class PpBanner` — selector `pp-banner`, inputs `heading: InputSignal<string>`
    (default `''`) and `tone: InputSignal<PpTone>` (default `'info'`, from Task 6's
    `lib/tone.ts`); projected content becomes the note under the heading.

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/banner/pp-banner.spec.ts`:

```ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { PP_BRIGHT_FILL_TOKENS, cssText } from '../../testing/read-css';
import { PpBanner } from './pp-banner';

@Component({
  imports: [PpBanner],
  template: `
    <pp-banner tone="warning" heading="Offer received — Base Nov-2026 · 0,20 MW">
      Respond within 24:41 — the price is firm until then.
    </pp-banner>
  `,
})
class BannerHost {}

@Component({
  imports: [PpBanner],
  template: `<pp-banner tone="info">These are indicative prices, not offers.</pp-banner>`,
})
class HeadinglessHost {}

describe('pp-banner', () => {
  it('always shows the mark, and the heading when it has one', () => {
    const fixture = TestBed.createComponent(BannerHost);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const mark = el.querySelector('.pp-banner__mark')!;
    expect(mark.textContent?.trim()).toBe('!');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('.pp-banner__heading')?.textContent).toContain('Offer received');
  });

  it('puts the projected note under the heading, not beside it', () => {
    const fixture = TestBed.createComponent(BannerHost);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const heading = el.querySelector('.pp-banner__heading')!;
    const body = el.querySelector('.pp-banner__body')!;
    expect(body.textContent).toContain('the price is firm until then');
    expect(body.parentElement).toBe(heading.parentElement);
    expect(heading.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('carries the tone on the host, and renders a one-line notice with no heading', () => {
    const fixture = TestBed.createComponent(HeadinglessHost);
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('pp-banner') as HTMLElement;
    expect(banner.classList.contains('pp-banner--info')).toBe(true);
    expect(banner.querySelector('.pp-banner__heading')).toBeNull();
    expect(banner.querySelector('.pp-banner__body')?.textContent).toContain('indicative');
  });

  it('uses the SB-2026 shape: a 26px rounded square at 15px 18px', () => {
    const css = cssText('lib/banner/pp-banner.css');
    expect(css).toContain('padding:15px18px');
    expect(css).toContain('width:26px');
    expect(css).toContain('border-radius:var(--radius-md)');
    expect(css).not.toContain('border-radius:50%');
  });

  it('never sets banner type in a bright fill token', () => {
    const css = cssText('lib/banner/pp-banner.css');
    const textValues = [...css.matchAll(/--pp-banner-text:([^;}]+)/g)].map((match) => match[1]);
    // One per PpTone member — a banner can carry any of the six.
    expect(textValues).toHaveLength(6);
    for (const value of textValues) {
      for (const bright of PP_BRIGHT_FILL_TOKENS) {
        expect(value, `${value} sets banner copy in the bright fill ${bright}`).not.toMatch(
          new RegExp(`${bright}(?![\\w-])`),
        );
      }
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: FAIL — `Failed to resolve import "./pp-banner" from "libs/shared-ui/src/lib/banner/pp-banner.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the minimal implementation**

Create `libs/shared-ui/src/lib/banner/pp-banner.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { PpTone } from '../tone';

/**
 * The SB-2026 page-level notice. Sits directly above the content it qualifies, full width,
 * and never stacked more than one at a time. The note is whatever the caller projects — a
 * sentence, and sometimes the buttons that answer it.
 */
@Component({
  selector: 'pp-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-banner.css',
  template: `
    <div class="pp-banner__mark" aria-hidden="true">!</div>
    <div class="pp-banner__text">
      @if (heading()) {
        <div class="pp-banner__heading">{{ heading() }}</div>
      }
      <div class="pp-banner__body" [class.pp-banner__body--under-heading]="heading().length > 0">
        <ng-content />
      </div>
    </div>
  `,
  host: { '[class]': 'hostClass()', role: 'status' },
})
export class PpBanner {
  /** Optional: a one-line notice with no heading is a legal shape. */
  readonly heading = input<string>('');
  readonly tone = input<PpTone>('info');

  protected readonly hostClass = computed(() => `pp-banner pp-banner--${this.tone()}`);
}
```

Create `libs/shared-ui/src/lib/banner/pp-banner.css`:

```css
:host {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 15px 18px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--pp-banner-border);
  background: var(--pp-banner-bg);
  color: var(--pp-banner-text);
  font-family: var(--font-sans);
}

/* The 26px rounded square holding the product's one warning glyph. */
.pp-banner__mark {
  width: 26px;
  height: 26px;
  min-width: 26px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: var(--weight-bold);
  color: #ffffff;
  background: var(--pp-banner-mark);
}

.pp-banner__text { flex: 1; min-width: 0; }
.pp-banner__heading { font-size: 13px; font-weight: var(--weight-bold); }
/* The projected note. It only needs the 3px offset when a heading sits above it. */
.pp-banner__body { font-size: 11.5px; line-height: 1.45; }
.pp-banner__body--under-heading { margin-top: 3px; }
.pp-banner__body p { margin: 0; }
.pp-banner__body p + * { margin-top: 10px; }

/* --pp-banner-mark is the solid mark fill; --pp-banner-text is always a darker tier.
   One block per PpTone member, because a consumer may pass any of the six. */
:host(.pp-banner--neutral) {
  --pp-banner-bg: var(--pp-surface-alt);
  --pp-banner-border: var(--color-border-strong);
  --pp-banner-text: var(--color-text-body);
  --pp-banner-mark: var(--pp-text-body);
}
:host(.pp-banner--brand) {
  --pp-banner-bg: var(--pp-blue-100);
  --pp-banner-border: #a9c8e8;
  --pp-banner-text: var(--pp-blue-700);
  --pp-banner-mark: var(--pp-blue-700);
}
:host(.pp-banner--info) {
  --pp-banner-bg: #eaf2fb;
  --pp-banner-border: #b3cdea;
  --pp-banner-text: var(--pp-blue-700);
  --pp-banner-mark: var(--pp-blue-700);
}
:host(.pp-banner--success) {
  --pp-banner-bg: var(--pp-green-bg);
  --pp-banner-border: var(--pp-green-border);
  --pp-banner-text: var(--pp-green-text);
  --pp-banner-mark: var(--pp-mint);
}
:host(.pp-banner--warning) {
  --pp-banner-bg: #fdf7e6;
  --pp-banner-border: var(--pp-amber-border);
  --pp-banner-text: var(--pp-amber-text);
  --pp-banner-mark: var(--pp-amber);
}
:host(.pp-banner--critical) {
  --pp-banner-bg: #fdeeee;
  --pp-banner-border: var(--pp-red-border);
  --pp-banner-text: var(--pp-red-value);
  --pp-banner-mark: var(--pp-red);
}
```

Append to `libs/shared-ui/src/public-api.ts`:

```ts
export { PpBanner } from './lib/banner/pp-banner';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 52 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/banner libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add the pp-banner page-level notice"
```

---

## Task 11: `pp-ds-banner` — the design-system notice

`pp-ds-banner` is the notice shape the design system's own `Banner` primitive defines, and it is
**a separate component from `pp-banner`, not a variant of it**. The design record is explicit
that the two are not interchangeable, so the codebase makes them impossible to confuse: two class
names, two selectors, two stylesheets, and two different APIs.

They differ in shape and in behaviour:

| | `pp-banner` (SB-2026) | `pp-ds-banner` (design system) |
| --- | --- | --- |
| Padding | `15px 18px` | `14px 18px` |
| Mark | 26px rounded **square** | 22px **circle** |
| `heading` | optional — a plain one-line notice is a legal shape | **required** — this shape is always titled |
| Info tint | `#eaf2fb` / `#b3cdea` | `--pp-blue-050` / `#a9c8e8` |

Both read `PpTone` and both take their note as projected content — shared contract §10.1.

If a future change makes them look the same, that is a design decision someone has to make on
purpose — deleting one component — not something that happens by adding a boolean.

**Files:**
- Create: `libs/shared-ui/src/lib/ds-banner/pp-ds-banner.ts`
- Create: `libs/shared-ui/src/lib/ds-banner/pp-ds-banner.css`
- Modify: `libs/shared-ui/src/public-api.ts`
- Test: `libs/shared-ui/src/lib/ds-banner/pp-ds-banner.spec.ts`

**Interfaces:**
- Consumes: `export function cssText(relativePath: string): string` from Task 3, and
  `export class PpBanner` from Task 10 (imported by the spec only, to assert the two are
  distinct).
- Produces:
  - `export class PpDsBanner` — selector `pp-ds-banner`, inputs `heading: InputSignal<string>`
    (required) and `tone: InputSignal<PpTone>` (default `'info'`, from Task 6's `lib/tone.ts`);
    projected content becomes the note under the heading.

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/ds-banner/pp-ds-banner.spec.ts`:

```ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { cssText } from '../../testing/read-css';
import { PpBanner } from '../banner/pp-banner';
import { PpDsBanner } from './pp-ds-banner';

@Component({
  imports: [PpDsBanner],
  template: `
    <pp-ds-banner heading="Wallet below your alert threshold">
      These are indicative market prices, not offers.
    </pp-ds-banner>
  `,
})
class DsBannerHost {}

describe('pp-ds-banner', () => {
  it('is a different component from PpBanner, not a variant of it', () => {
    expect(PpDsBanner).not.toBe(PpBanner);
    expect(Object.getPrototypeOf(PpDsBanner)).not.toBe(PpBanner);
  });

  it('answers to its own selector, so a template cannot swap one for the other', () => {
    const sb = TestBed.createComponent(PpBanner);
    sb.componentRef.setInput('heading', 'Offer received');
    sb.detectChanges();

    const ds = TestBed.createComponent(PpDsBanner);
    ds.componentRef.setInput('heading', 'Wallet below your alert threshold');
    ds.detectChanges();

    expect(sb.nativeElement.tagName.toLowerCase()).toBe('pp-banner');
    expect(ds.nativeElement.tagName.toLowerCase()).toBe('pp-ds-banner');
  });

  it('is always titled — the heading is required, and the mark comes with it', () => {
    const fixture = TestBed.createComponent(DsBannerHost);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.pp-ds-banner__mark')?.textContent?.trim()).toBe('!');
    expect(el.querySelector('.pp-ds-banner__heading')?.textContent)
      .toContain('Wallet below your alert threshold');
  });

  it('renders the projected note under the heading', () => {
    const fixture = TestBed.createComponent(DsBannerHost);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const heading = el.querySelector('.pp-ds-banner__heading')!;
    const body = el.querySelector('.pp-ds-banner__body')!;
    expect(body.textContent).toContain('indicative');
    expect(body.parentElement).toBe(heading.parentElement);
  });

  it('has its own stylesheet — a different padding and a different mark shape', () => {
    const ds = cssText('lib/ds-banner/pp-ds-banner.css');
    const sb = cssText('lib/banner/pp-banner.css');

    expect(ds).toContain('padding:14px18px');
    expect(sb).toContain('padding:15px18px');

    expect(ds).toContain('border-radius:50%');
    expect(ds).toContain('width:22px');
    expect(sb).toContain('width:26px');

    // The info tints genuinely differ; neither file can be generated from the other.
    expect(ds).toContain('--pp-ds-banner-bg:var(--pp-blue-050)');
    expect(sb).toContain('--pp-banner-bg:#eaf2fb');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: FAIL — `Failed to resolve import "./pp-ds-banner" from "libs/shared-ui/src/lib/ds-banner/pp-ds-banner.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the minimal implementation**

Create `libs/shared-ui/src/lib/ds-banner/pp-ds-banner.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { PpTone } from '../tone';

/**
 * The design system's own notice shape. Deliberately NOT a variant of `pp-banner`: a 22px
 * circular mark instead of a 26px rounded square, a tighter 14px padding, its own info tint,
 * and a heading that is always required — this shape is never an untitled one-liner.
 */
@Component({
  selector: 'pp-ds-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-ds-banner.css',
  template: `
    <div class="pp-ds-banner__mark" aria-hidden="true">!</div>
    <div class="pp-ds-banner__text">
      <div class="pp-ds-banner__heading">{{ heading() }}</div>
      <div class="pp-ds-banner__body"><ng-content /></div>
    </div>
  `,
  host: { '[class]': 'hostClass()', role: 'status' },
})
export class PpDsBanner {
  readonly heading = input.required<string>();
  readonly tone = input<PpTone>('info');

  protected readonly hostClass = computed(() => `pp-ds-banner pp-ds-banner--${this.tone()}`);
}
```

Create `libs/shared-ui/src/lib/ds-banner/pp-ds-banner.css`:

```css
:host {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--pp-ds-banner-border);
  background: var(--pp-ds-banner-bg);
  font-family: var(--font-sans);
}

/* 22px circle — the design system's mark. pp-banner's is a 26px rounded square. */
.pp-ds-banner__mark {
  width: 22px;
  height: 22px;
  min-width: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: var(--weight-bold);
  color: #ffffff;
  background: var(--pp-ds-banner-mark);
}

.pp-ds-banner__text { flex: 1; min-width: 0; }
.pp-ds-banner__heading {
  font-size: 13px;
  font-weight: var(--weight-bold);
  color: var(--pp-ds-banner-text);
}
.pp-ds-banner__body {
  font-size: 11.5px;
  color: var(--pp-ds-banner-text);
  line-height: 1.45;
  margin-top: 3px;
}
.pp-ds-banner__body p { margin: 0; }

/* One block per PpTone member — the same six names the badge and the banner use. */
:host(.pp-ds-banner--neutral) {
  --pp-ds-banner-bg: var(--pp-surface-alt);
  --pp-ds-banner-border: var(--color-border-strong);
  --pp-ds-banner-text: var(--color-text-body);
  --pp-ds-banner-mark: var(--pp-text-body);
}
:host(.pp-ds-banner--brand) {
  --pp-ds-banner-bg: var(--pp-blue-100);
  --pp-ds-banner-border: #a9c8e8;
  --pp-ds-banner-text: var(--pp-blue-700);
  --pp-ds-banner-mark: var(--pp-blue-700);
}
:host(.pp-ds-banner--success) {
  --pp-ds-banner-bg: var(--pp-green-bg);
  --pp-ds-banner-border: var(--pp-green-border);
  --pp-ds-banner-text: var(--pp-green-text);
  --pp-ds-banner-mark: var(--pp-mint);
}
:host(.pp-ds-banner--info) {
  --pp-ds-banner-bg: var(--pp-blue-050);
  --pp-ds-banner-border: #a9c8e8;
  --pp-ds-banner-text: var(--pp-blue-700);
  --pp-ds-banner-mark: var(--pp-blue-700);
}
:host(.pp-ds-banner--warning) {
  --pp-ds-banner-bg: var(--pp-amber-bg);
  --pp-ds-banner-border: var(--pp-amber-border);
  --pp-ds-banner-text: var(--pp-amber-text);
  --pp-ds-banner-mark: var(--pp-amber);
}
:host(.pp-ds-banner--critical) {
  --pp-ds-banner-bg: var(--pp-red-bg);
  --pp-ds-banner-border: var(--pp-red-border);
  --pp-ds-banner-text: var(--pp-red-text);
  --pp-ds-banner-mark: var(--pp-red);
}
```

Append to `libs/shared-ui/src/public-api.ts`:

```ts
export { PpDsBanner } from './lib/ds-banner/pp-ds-banner';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 57 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/ds-banner libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add pp-ds-banner as a component distinct from pp-banner"
```

---

## Task 12: `pp-grid-table`, `ppGridHead` and `ppGridRow`

Every list in this product is a **CSS grid of divs**, not a `<table>`. That is not a stylistic
preference: each screen's column widths are hand-tuned `fr` tracks copied from the design
(`0.9fr 1fr 1.8fr 1fr 1fr 0.8fr 0.8fr 1fr` for the wallet ledger), a row's cells contain badges
and two-line sublabels, and `<td>` fights all of it. The track list is passed in as data and is
never "tidied" into equal columns.

The public shape is shared contract §10.1, and it is a projection shape rather than a data shape:
`columns` is the **raw `grid-template-columns` string**, and the head and the rows are the
caller's own elements, marked `ppGridHead` and `ppGridRow` and projected in. Both portals need
that: a row is often an `<a routerLink>` covering the whole width, its first cell is a label over
a faint EAN, and its status cell holds a `<pp-badge>`. A table that stamped rows from data would
have to grow an input for each of those.

Because the head and the rows belong to the **caller's** template, they carry the caller's
encapsulation attribute, and a scoped rule inside this component would never match them. So this
one component ships `ViewEncapsulation.None` and namespaces every selector under
`.pp-grid-table`. The spec checks that namespacing, because an unnamespaced global rule in a
design system leaks into every screen that ever imports it.

The rule with teeth survives the change of shape: **a head is never rendered with nothing under
it.** A head above empty space reads as a loading failure. The table counts the rows projected
into it and hides the head when there are none; the caller renders the empty card that names the
reason, which is where the reason actually lives.

**Files:**
- Create: `libs/shared-ui/src/lib/grid-table/pp-grid-head.ts`
- Create: `libs/shared-ui/src/lib/grid-table/pp-grid-row.ts`
- Create: `libs/shared-ui/src/lib/grid-table/pp-grid-table.ts`
- Create: `libs/shared-ui/src/lib/grid-table/pp-grid-table.css`
- Modify: `libs/shared-ui/src/public-api.ts`
- Test: `libs/shared-ui/src/lib/grid-table/pp-grid-table.spec.ts`

**Interfaces:**
- Consumes: `export function cssText(relativePath: string): string` and
  `export function readSharedUiCss(relativePath: string): string` from Task 3.
- Produces:
  - `export class PpGridHead` — selector `[ppGridHead]`, the one row of ALL-CAPS column heads.
  - `export class PpGridRow` — selector `[ppGridRow]`, one row, laid out on the table's tracks.
  - `export class PpGridTable` — selector `pp-grid-table`, inputs
    `columns: InputSignal<string>` (required — a raw `grid-template-columns` value) and
    `density: InputSignal<'default' | 'dense'>` (default `'default'`).

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/grid-table/pp-grid-table.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { cssText, readSharedUiCss } from '../../testing/read-css';
import { PpGridHead } from './pp-grid-head';
import { PpGridRow } from './pp-grid-row';
import { PpGridTable } from './pp-grid-table';

interface Connection {
  readonly ean: string;
  readonly name: string;
}

@Component({
  imports: [PpGridTable, PpGridHead, PpGridRow],
  template: `
    <pp-grid-table columns="1.4fr 1fr" [density]="density()">
      <div ppGridHead>
        <div>EAN</div>
        <div>CONNECTION</div>
      </div>
      @for (row of rows(); track row.ean) {
        <a ppGridRow href="/connections/{{ row.ean }}">
          <div class="cell-ean">{{ row.ean }}</div>
          <div class="cell-name">{{ row.name }}</div>
        </a>
      }
    </pp-grid-table>
  `,
})
class GridHost {
  readonly rows = signal<readonly Connection[]>([
    { ean: '871687100000000001', name: 'Vriescel 1' },
    { ean: '871687100000000002', name: 'Vriescel 2' },
    { ean: '871687100000000003', name: 'Kantoor' },
  ]);
  readonly density = signal<'default' | 'dense'>('default');
}

describe('pp-grid-table', () => {
  it('lays the head and every row on the same tracks, from one custom property', () => {
    const css = cssText('lib/grid-table/pp-grid-table.css');
    // Head and rows read the same property, so they can never drift apart.
    expect(css).toContain('.pp-grid-table__head,.pp-grid-table__row{');
    expect(css).toContain('grid-template-columns:var(--pp-grid-columns)');
  });

  it('puts the caller’s track list on the host, verbatim', () => {
    const fixture = TestBed.createComponent(GridHost);
    fixture.detectChanges();

    const table = fixture.nativeElement.querySelector('pp-grid-table') as HTMLElement;
    expect(table.style.getPropertyValue('--pp-grid-columns')).toBe('1.4fr 1fr');
  });

  it('projects the caller’s own elements — a row that is a link stays a link', () => {
    const fixture = TestBed.createComponent(GridHost);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.pp-grid-table__head')).toHaveLength(1);
    const rows = el.querySelectorAll('.pp-grid-table__row');
    expect(rows).toHaveLength(3);
    expect(rows[0].tagName.toLowerCase()).toBe('a');
    expect(el.querySelectorAll('.cell-ean')[2].textContent).toBe('871687100000000003');
  });

  it('never renders a head with nothing under it', () => {
    const fixture = TestBed.createComponent(GridHost);
    fixture.componentInstance.rows.set([]);
    fixture.detectChanges();

    const table = fixture.nativeElement.querySelector('pp-grid-table') as HTMLElement;
    // The head is still projected; the table refuses to show it, and the caller renders the
    // empty card that names the reason.
    expect(table.classList.contains('pp-grid-table--no-rows')).toBe(true);
    expect(readSharedUiCss('lib/grid-table/pp-grid-table.css')).toContain(
      '.pp-grid-table--no-rows .pp-grid-table__head',
    );
  });

  it('carries the density on the host, for a table nested in a card', () => {
    const fixture = TestBed.createComponent(GridHost);
    fixture.componentInstance.density.set('dense');
    fixture.detectChanges();

    const table = fixture.nativeElement.querySelector('pp-grid-table') as HTMLElement;
    expect(table.classList.contains('pp-grid-table--dense')).toBe(true);
    expect(cssText('lib/grid-table/pp-grid-table.css')).toContain(
      '.pp-grid-table--dense.pp-grid-table__row{padding:11px12px',
    );
  });

  it('namespaces every rule, because this stylesheet is not encapsulated', () => {
    const css = readSharedUiCss('lib/grid-table/pp-grid-table.css');
    const selectors = [...css.matchAll(/(^|\})([^{}]+)\{/g)]
      .flatMap((match) => match[2].split(','))
      .map((selector) => selector.replace(/\/\*[^]*?\*\//g, '').trim())
      .filter((selector) => selector.length > 0);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector.startsWith('.pp-grid-table'), `${selector} is a global rule`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: FAIL — `Failed to resolve import "./pp-grid-head" from "libs/shared-ui/src/lib/grid-table/pp-grid-table.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the minimal implementation**

Create `libs/shared-ui/src/lib/grid-table/pp-grid-head.ts`:

```ts
import { Directive } from '@angular/core';

/**
 * The one row of column heads, written by the caller and projected into `pp-grid-table`:
 *
 * ```html
 * <div ppGridHead><div>EAN</div><div>CITY</div></div>
 * ```
 *
 * ALL CAPS is applied by the stylesheet, not typed into the copy — a column head is one of
 * only two places the product shouts.
 */
@Directive({
  selector: '[ppGridHead]',
  host: { class: 'pp-grid-table__head' },
})
export class PpGridHead {}
```

Create `libs/shared-ui/src/lib/grid-table/pp-grid-row.ts`:

```ts
import { Directive } from '@angular/core';

/**
 * One row, written by the caller and projected into `pp-grid-table`. It is the caller's own
 * element — often an `<a routerLink>` covering the whole row — and this directive only lays its
 * children out on the table's tracks.
 */
@Directive({
  selector: '[ppGridRow]',
  host: { class: 'pp-grid-table__row' },
})
export class PpGridRow {}
```

Create `libs/shared-ui/src/lib/grid-table/pp-grid-table.ts`:

```ts
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  input,
  ViewEncapsulation,
} from '@angular/core';
import { PpGridRow } from './pp-grid-row';

@Component({
  selector: 'pp-grid-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-grid-table.css',
  /**
   * The head and the rows are the CALLER's elements: under emulated encapsulation they carry
   * the caller's `_ngcontent` attribute and a scoped rule here would never match them. Every
   * selector in pp-grid-table.css is namespaced under `.pp-grid-table` to pay for this.
   */
  encapsulation: ViewEncapsulation.None,
  template: `<ng-content />`,
  host: {
    '[class]': 'hostClass()',
    '[style.--pp-grid-columns]': 'columns()',
  },
})
export class PpGridTable {
  /**
   * A raw `grid-template-columns` value, copied from the screen's design and never tidied
   * into equal columns — e.g. `minmax(0, 2.2fr) 1fr 0.8fr 1fr 1.4fr`.
   */
  readonly columns = input.required<string>();
  /** `dense` is the tighter row a table nested inside a card uses. */
  readonly density = input<'default' | 'dense'>('default');

  private readonly rows = contentChildren(PpGridRow, { descendants: true });

  protected readonly hostClass = computed(() => {
    const classes = ['pp-grid-table', `pp-grid-table--${this.density()}`];
    if (this.rows().length === 0) {
      // A head with nothing under it reads as a loading failure, so it is not shown.
      classes.push('pp-grid-table--no-rows');
    }
    return classes.join(' ');
  });
}
```

Create `libs/shared-ui/src/lib/grid-table/pp-grid-table.css`:

```css
.pp-grid-table {
  display: block;
  font-family: var(--font-sans);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--pp-shadow-card);
  overflow: hidden;
}

/* One property, read by the head and by every row, so the columns can never drift. */
.pp-grid-table__head,.pp-grid-table__row{display:grid;grid-template-columns:var(--pp-grid-columns);align-items:center}

.pp-grid-table__head {
  background: var(--color-surface-alt);
  font-size: 10.5px;
  font-weight: var(--weight-bold);
  color: var(--color-text-body);
  letter-spacing: 0.03em;
  text-transform: uppercase;
  padding: 10px 16px;
  gap: 14px;
  border-bottom: 1px solid var(--color-border);
}

.pp-grid-table__row {
  padding: 13px 16px;
  font-size: var(--text-sm);
  color: var(--color-text-heading);
  gap: 14px;
  border-top: 1px solid var(--color-border);
  transition: background-color 0.12s ease;
}
/* A row is often the caller's own <a>. It must not look like a link. */
.pp-grid-table__row:is(a) { text-decoration: none; color: inherit; }
.pp-grid-table__row:hover { background: var(--color-surface-zebra); }
.pp-grid-table__head + .pp-grid-table__row { border-top: none; }

/* Zero rows: the head is projected but never shown. The caller renders the empty
   card, because the sentence that names the reason belongs to the screen. */
.pp-grid-table--no-rows .pp-grid-table__head { display: none; }

.pp-grid-table--dense .pp-grid-table__head{padding:9px 12px;font-size:var(--text-2xs);gap:10px}
.pp-grid-table--dense .pp-grid-table__row{padding:11px 12px;font-size:12px;gap:10px}

.pp-grid-table__num { text-align: right; }
```

Append to `libs/shared-ui/src/public-api.ts`:

```ts
export { PpGridHead } from './lib/grid-table/pp-grid-head';
export { PpGridRow } from './lib/grid-table/pp-grid-row';
export { PpGridTable } from './lib/grid-table/pp-grid-table';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 63 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/grid-table libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add pp-grid-table with projected heads and rows"
```

---

## Task 13: `pp-search-input`

The filter field that sits above a list, beside the tabs, never inside the table. It is the only
search affordance in the product and it carries the **only icon in the entire product**: a 14px,
2px-stroke magnifier, drawn inline. There is no icon set, no icon font and no CDN — adding one
would be off-brand, and the CSP in the deployed portals would block it anyway.

The placeholder should say what is searchable ("Search name, description or EAN…"), because it
doubles as the field's accessible name. Its default is the bare `'Search'` of shared contract
§10.1 — enough for a field the reader can already see, and a prompt to pass something better.

`value` is a `model()` rather than an `input()` so the caller can write `[(value)]="query"` and
get a two-way binding without an output of their own.

**Files:**
- Create: `libs/shared-ui/src/lib/search-input/pp-search-input.ts`
- Create: `libs/shared-ui/src/lib/search-input/pp-search-input.css`
- Modify: `libs/shared-ui/src/public-api.ts`
- Test: `libs/shared-ui/src/lib/search-input/pp-search-input.spec.ts`

**Interfaces:**
- Consumes: `export function cssText(relativePath: string): string` from Task 3.
- Produces:
  - `export class PpSearchInput` — selector `pp-search-input`, input
    `placeholder: InputSignal<string>` (default `'Search'`), two-way
    `value: ModelSignal<string>` (default `''`).

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/search-input/pp-search-input.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { cssText } from '../../testing/read-css';
import { PpSearchInput } from './pp-search-input';

describe('pp-search-input', () => {
  it('draws exactly one inline icon, and it is the magnifier', () => {
    const fixture = TestBed.createComponent(PpSearchInput);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const icons = el.querySelectorAll('svg');
    expect(icons).toHaveLength(1);
    expect(icons[0].getAttribute('width')).toBe('14');
    expect(icons[0].getAttribute('stroke-width')).toBe('2');
    expect(icons[0].getAttribute('aria-hidden')).toBe('true');
    // No icon font, no sprite sheet, no <img>.
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('use')).toBeNull();
  });

  it('writes what the reader types back into the two-way value', () => {
    const fixture = TestBed.createComponent(PpSearchInput);
    fixture.detectChanges();

    const field: HTMLInputElement = fixture.nativeElement.querySelector('input');
    field.value = 'Vriescel';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.value()).toBe('Vriescel');
  });

  it('uses the placeholder as the accessible name, because it says what is searchable', () => {
    const fixture = TestBed.createComponent(PpSearchInput);
    fixture.componentRef.setInput('placeholder', 'Search name, description or EAN…');
    fixture.detectChanges();

    const field: HTMLInputElement = fixture.nativeElement.querySelector('input');
    expect(field.placeholder).toBe('Search name, description or EAN…');
    expect(field.getAttribute('aria-label')).toBe('Search name, description or EAN…');
  });

  it('holds the 260px floor a filter row is laid out against', () => {
    expect(cssText('lib/search-input/pp-search-input.css')).toContain('min-width:260px');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: FAIL — `Failed to resolve import "./pp-search-input" from "libs/shared-ui/src/lib/search-input/pp-search-input.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the minimal implementation**

Create `libs/shared-ui/src/lib/search-input/pp-search-input.ts`:

```ts
import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/**
 * The product's only search affordance, carrying the product's only icon. Sits in the filter
 * row beside the tabs, never inside the table.
 */
@Component({
  selector: 'pp-search-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-search-input.css',
  template: `
    <svg
      class="pp-search-input__icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
    <input
      class="pp-search-input__field"
      type="search"
      [placeholder]="placeholder()"
      [attr.aria-label]="placeholder()"
      [value]="value()"
      (input)="onInput($event)"
    />
  `,
  host: { class: 'pp-search-input' },
})
export class PpSearchInput {
  /** Say what is searchable — it is also the field's accessible name. */
  readonly placeholder = input<string>('Search');
  readonly value = model<string>('');

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }
}
```

Create `libs/shared-ui/src/lib/search-input/pp-search-input.css`:

```css
:host {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 260px;
  padding: 9px 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

/* The focus ring the whole product uses: a blue-300 border plus a soft 3px halo. */
:host(:focus-within) {
  border-color: var(--pp-blue-300);
  box-shadow: 0 0 0 3px rgba(60, 147, 250, 0.22);
}

.pp-search-input__icon {
  color: var(--color-text-faint);
  flex-shrink: 0;
}

.pp-search-input__field {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--color-text-heading);
}

/* WebKit's own clear button is a second icon. The product has one. */
.pp-search-input__field::-webkit-search-cancel-button {
  display: none;
}
```

Append to `libs/shared-ui/src/public-api.ts`:

```ts
export { PpSearchInput } from './lib/search-input/pp-search-input';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 67 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/search-input libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add pp-search-input with the product's only icon"
```

---

## Task 14: `pp-app-shell`

The frame both portals live in: a permanent 236px dark rail at `#2D3F54` with the five-stop
spectrum hairline across its top, a 64px topbar, and a scrolling content column.

Four rules:

- **The body never scrolls.** The host is `height: 100vh; overflow: hidden`, and the content
  column is the only element with `overflow: auto`. Let the body scroll and the rail and the
  topbar scroll away with it, which on a desk tool means losing the navigation while reading a
  ledger.
- **236px and 64px come from `--sidebar-width` and `--topbar-height`**, never from a literal in
  this stylesheet. Two places for one number is how they drift.
- **The rail is grouped, and every row carries a small domain-coloured dot** — design §8.4. The
  grouping is data: `PpNavSection[]`, each section a label and its items.
- **The topbar shows a crumb *or* a subtitle, never both.** A crumb wins, because it is
  navigation and the subtitle is only description.

Navigation is **`routerLink` on the item's `path`** — shared contract §10.1. That is a change of
job from an output the application has to wire up: the shell now depends on `@angular/router`,
which is why the library declares it as a peer in Task 3. In exchange, a rail row is a real
link — middle-click, copy link address and the browser's own active handling all work, and
neither portal has to keep a click handler in sync with its route table.

An item whose `path` is `null` is disabled, and renders **with the sentence explaining why**
rather than being hidden — a rail that grows between demos looks unfinished; a rail that is
complete and honest looks planned. The sentence is rendered verbatim under the label, and
carried in `title` as well, so it is readable and hoverable both.

**Files:**
- Create: `libs/shared-ui/src/lib/app-shell/pp-app-shell.ts`
- Create: `libs/shared-ui/src/lib/app-shell/pp-app-shell.css`
- Modify: `libs/shared-ui/src/public-api.ts`
- Test: `libs/shared-ui/src/lib/app-shell/pp-app-shell.spec.ts`

**Interfaces:**
- Consumes: `export function cssText(relativePath: string): string` from Task 3; the
  `--sidebar-width` (236px), `--topbar-height` (64px), `--pp-sidebar-bg`, `--pp-sidebar-text`,
  `--pp-sidebar-active-bg` and `--pp-rail-spectrum` custom properties from that task's
  `styles/layout.css` and `styles/colors.css`; and `RouterLink` from `@angular/router`.
- Produces:
  - `export interface PpNavItem { readonly routeKey: string; readonly label: string; readonly path: string | null; readonly dot: string; readonly disabledReason?: string }`
  - `export interface PpNavSection { readonly label: string; readonly items: readonly PpNavItem[] }`
  - `export class PpAppShell` — selector `pp-app-shell`, inputs
    `sections: InputSignal<readonly PpNavSection[]>` (required),
    `activeRouteKey: InputSignal<string>` (required),
    `productName: InputSignal<string>` (required),
    `crumb: InputSignal<string>` (default `''`), `subtitle: InputSignal<string>`
    (default `''`); two content slots — anything carrying `slot="topbar-actions"` goes into the
    topbar, everything else into the scrolling content column.

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/app-shell/pp-app-shell.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { cssText } from '../../testing/read-css';
import { PpAppShell, type PpNavSection } from './pp-app-shell';

const NAV: readonly PpNavSection[] = [
  {
    label: 'Overview',
    items: [
      { routeKey: 'dashboard', label: 'Dashboard', path: '/dashboard', dot: 'var(--pp-blue-500)' },
      { routeKey: 'connections', label: 'Connections', path: '/connections', dot: 'var(--pp-mint)' },
    ],
  },
  {
    label: 'Market',
    items: [
      {
        routeKey: 'trading',
        label: 'Trades',
        path: null,
        dot: 'var(--pp-blue-700)',
        disabledReason: 'Trading arrives with feature F05.',
      },
    ],
  },
];

function createShell() {
  const fixture = TestBed.createComponent(PpAppShell);
  fixture.componentRef.setInput('sections', NAV);
  fixture.componentRef.setInput('activeRouteKey', 'connections');
  fixture.componentRef.setInput('productName', 'PeakPower');
  return fixture;
}

describe('pp-app-shell', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('is exactly the viewport, so the body never scrolls', () => {
    const css = cssText('lib/app-shell/pp-app-shell.css');
    const host = css.slice(css.indexOf(':host{'), css.indexOf('}', css.indexOf(':host{')));
    expect(host).toContain('height:100vh');
    expect(host).toContain('overflow:hidden');
  });

  it('makes the content column the only scroll container', () => {
    const css = cssText('lib/app-shell/pp-app-shell.css');
    // The selector capture stops at the `*/` of any preceding comment.
    const scrollers = [...css.matchAll(/([.\w-]+)\{[^}]*overflow:auto/g)].map((m) => m[1]);
    expect(scrollers).toEqual(['.pp-app-shell__content']);
  });

  it('reads the rail and topbar metrics from tokens instead of repeating them', () => {
    const css = cssText('lib/app-shell/pp-app-shell.css');
    expect(css).toContain('width:var(--sidebar-width)');
    expect(css).toContain('height:var(--topbar-height)');
    expect(css).not.toContain('236px');
    expect(css).not.toContain('64px');
  });

  it('groups the rail and gives every row its domain dot — design §8.4', () => {
    const fixture = createShell();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const groups = el.querySelectorAll('.pp-app-shell__group');
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelector('.pp-app-shell__group-label')?.textContent?.trim())
      .toBe('Overview');

    const dots = el.querySelectorAll<HTMLElement>('.pp-app-shell__dot');
    expect(dots).toHaveLength(3);
    expect(dots[1].style.background).toContain('--pp-mint');
  });

  it('navigates by routerLink, and marks the active row from activeRouteKey', () => {
    const fixture = createShell();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const enabled = el.querySelectorAll('a.pp-app-shell__nav-item');
    expect(enabled).toHaveLength(2);
    expect(enabled[1].getAttribute('href')).toBe('/connections');
    expect(enabled[1].classList.contains('pp-app-shell__nav-item--active')).toBe(true);
    expect(enabled[0].classList.contains('pp-app-shell__nav-item--active')).toBe(false);
  });

  it('renders a disabled item with its reason, verbatim, instead of hiding it', () => {
    const fixture = createShell();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const disabled = el.querySelector('.pp-app-shell__nav-item--disabled') as HTMLElement;
    expect(disabled.tagName.toLowerCase()).toBe('span');
    expect(disabled.querySelector('.pp-app-shell__nav-reason')?.textContent?.trim())
      .toBe('Trading arrives with feature F05.');
    expect(disabled.title).toBe('Trading arrives with feature F05.');
  });

  it('shows the crumb and drops the subtitle when both are supplied', () => {
    const fixture = createShell();
    fixture.componentRef.setInput('crumb', 'Connections');
    fixture.componentRef.setInput('subtitle', 'Three connections, one contract.');
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.pp-app-shell__crumb')?.textContent).toContain('Connections');
    expect(el.querySelector('.pp-app-shell__subtitle')).toBeNull();
  });

  it('shows the subtitle when there is no crumb', () => {
    const fixture = createShell();
    fixture.componentRef.setInput('subtitle', 'Three connections, one contract.');
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.pp-app-shell__crumb')).toBeNull();
    expect(el.querySelector('.pp-app-shell__subtitle')?.textContent)
      .toContain('Three connections, one contract.');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: FAIL — `Failed to resolve import "./pp-app-shell" from "libs/shared-ui/src/lib/app-shell/pp-app-shell.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the minimal implementation**

Create `libs/shared-ui/src/lib/app-shell/pp-app-shell.ts`:

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface PpNavItem {
  /** The SPECIFICATION's route key — 'consumption', 'trading', 'wallet' — never the label. */
  readonly routeKey: string;
  /** The DESIGN's label — 'Volume', 'Trades', 'Balance'. */
  readonly label: string;
  /** `null` renders the item disabled. */
  readonly path: string | null;
  /** The domain colour, a CSS custom-property reference such as `var(--pp-mint)`. */
  readonly dot: string;
  /** Rendered verbatim. A disabled item must carry one. */
  readonly disabledReason?: string;
}

export interface PpNavSection {
  readonly label: string;
  readonly items: readonly PpNavItem[];
}

@Component({
  selector: 'pp-app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-app-shell.css',
  imports: [RouterLink],
  template: `
    <aside class="pp-app-shell__rail">
      <div class="pp-app-shell__brand">
        <svg width="26" height="26" viewBox="19 23 22 22" aria-hidden="true">
          <circle cx="30" cy="34" r="11" fill="#1DBD8E" />
          <path d="M 26 34 L 30 27 L 30 33 L 34 33 L 30 41 L 30 35 Z" fill="#2D3F54" />
        </svg>
        <div class="pp-app-shell__brand-name">{{ productName() }}</div>
      </div>

      <nav class="pp-app-shell__nav">
        @for (section of sections(); track section.label) {
          <div class="pp-app-shell__group">
            <div class="pp-app-shell__group-label">{{ section.label }}</div>
            @for (item of section.items; track item.routeKey) {
              @if (item.path; as path) {
                <a
                  class="pp-app-shell__nav-item"
                  [class.pp-app-shell__nav-item--active]="item.routeKey === activeRouteKey()"
                  [routerLink]="path"
                >
                  <span class="pp-app-shell__dot" [style.background]="item.dot"></span>
                  <span class="pp-app-shell__nav-label">{{ item.label }}</span>
                </a>
              } @else {
                <span
                  class="pp-app-shell__nav-item pp-app-shell__nav-item--disabled"
                  [title]="item.disabledReason ?? ''"
                >
                  <span class="pp-app-shell__dot" [style.background]="item.dot"></span>
                  <span class="pp-app-shell__nav-label">{{ item.label }}</span>
                  <span class="pp-app-shell__nav-reason">{{ item.disabledReason }}</span>
                </span>
              }
            }
          </div>
        }
      </nav>
    </aside>

    <div class="pp-app-shell__main">
      <header class="pp-app-shell__topbar">
        <div class="pp-app-shell__heading">
          @if (crumb()) {
            <div class="pp-app-shell__crumb">{{ crumb() }}</div>
          } @else if (subtitle()) {
            <div class="pp-app-shell__subtitle">{{ subtitle() }}</div>
          }
        </div>
        <div class="pp-app-shell__actions">
          <ng-content select="[slot=topbar-actions]" />
        </div>
      </header>

      <div class="pp-app-shell__content"><ng-content /></div>
    </div>
  `,
  host: { class: 'pp-app-shell' },
})
export class PpAppShell {
  /** The grouped rail — design §8.4. */
  readonly sections = input.required<readonly PpNavSection[]>();
  /** Keyed on the specification's route key, never on the label. */
  readonly activeRouteKey = input.required<string>();
  readonly productName = input.required<string>();
  /** Navigation. A crumb and a subtitle never appear together — the crumb wins. */
  readonly crumb = input<string>('');
  /** Description. Rendered only when there is no crumb. */
  readonly subtitle = input<string>('');
}
```

Create `libs/shared-ui/src/lib/app-shell/pp-app-shell.css`:

```css
/* The frame is exactly the viewport. If the body scrolls, the rail and the topbar
   scroll away with it and the reader loses the navigation halfway down a ledger. */
:host{display:flex;height:100vh;width:100%;overflow:hidden;font-family:var(--font-sans)}

.pp-app-shell__rail {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  background: var(--pp-sidebar-bg);
  color: var(--pp-sidebar-text);
  display: flex;
  flex-direction: column;
  padding: 22px 0 18px;
  position: relative;
  overflow-y: hidden;
}
/* The five-stop spectrum hairline across the top of the rail. */
.pp-app-shell__rail::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 3px;
  background: var(--pp-rail-spectrum);
}

.pp-app-shell__brand { display: flex; align-items: center; gap: 11px; padding: 0 20px 22px; }
.pp-app-shell__brand-name { color: #ffffff; font-size: 15.5px; font-weight: var(--weight-bold); }

.pp-app-shell__nav { display: flex; flex-direction: column; gap: 16px; padding: 0 10px; }
.pp-app-shell__group { display: flex; flex-direction: column; gap: 1px; }
/* The group heading. ALL CAPS is not legal here, so this is small and tracked instead. */
.pp-app-shell__group-label {
  color: #7f8ea3;
  font-size: var(--text-2xs);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-eyebrow);
  padding: 0 12px 5px;
}

/* Two columns: the 6px domain dot, then the label. A disabled row's reason takes
   the second column on its own line, so the dots stay in one vertical line. */
.pp-app-shell__nav-item {
  display: grid;
  grid-template-columns: 6px 1fr;
  align-items: center;
  column-gap: 9px;
  row-gap: 3px;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--pp-sidebar-text);
  text-decoration: none;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.pp-app-shell__dot { width: 6px; height: 6px; border-radius: var(--radius-pill); }
.pp-app-shell__nav-item:hover:not(.pp-app-shell__nav-item--active):not(.pp-app-shell__nav-item--disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: var(--pp-sidebar-text-active);
}
.pp-app-shell__nav-item--active {
  background: var(--pp-sidebar-active-bg);
  color: var(--pp-sidebar-text-active);
  font-weight: var(--weight-semibold);
}
/* Shown, dimmed, and explained — never hidden. */
.pp-app-shell__nav-item--disabled { color: #8697aa; cursor: not-allowed; }
.pp-app-shell__nav-item--disabled .pp-app-shell__dot { opacity: 0.45; }
.pp-app-shell__nav-reason {
  grid-column: 2;
  font-size: var(--text-2xs);
  line-height: 1.4;
  color: #7f8ea3;
}

.pp-app-shell__main { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }

.pp-app-shell__topbar {
  height: var(--topbar-height);
  min-height: var(--topbar-height);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 30px;
}
.pp-app-shell__heading { min-width: 0; }
/* A crumb and a subtitle occupy the same line; only one is ever rendered. The crumb
   names where the reader is, so it is set as the heading; the subtitle only describes. */
.pp-app-shell__crumb {
  font-size: 19px;
  font-weight: var(--weight-bold);
  color: var(--color-text-heading);
  white-space: nowrap;
}
.pp-app-shell__subtitle { font-size: var(--text-base); color: var(--color-text-body); }
.pp-app-shell__actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

/* The one scroll container in the application. */
.pp-app-shell__content{flex:1;overflow:auto;padding:26px 30px 40px;display:flex;flex-direction:column;gap:16px}
```

Append to `libs/shared-ui/src/public-api.ts`:

```ts
export { PpAppShell, type PpNavItem, type PpNavSection } from './lib/app-shell/pp-app-shell';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 75 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/app-shell libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add the pp-app-shell grouped rail, topbar and scroll container"
```

---

## Task 15: The component gallery

This is the plan's demonstrable deliverable — the page you open in a browser to see the design
system working. Every primitive and every pipe on one screen, inside the real shell, on the real
gradient canvas, with real Dutch numbers.

It is also the cheapest regression test the design system has. A contrast rule broken in a token
file, a badge that lost its border, a stat card that started stretching: all of them are visible
here in one scroll, and none of them are visible in a unit test.

The copy is deliberately in the product's own register — factual, sentence case, every number
followed by where it came from — because a gallery written in lorem ipsum teaches the wrong
lesson to whoever builds the next screen. The data is synthetic and the page says so, per the
demo-honesty rule.

**Files:**
- Create: `apps/customer-portal/src/app/gallery/gallery.ts`
- Create: `apps/customer-portal/src/app/gallery/gallery.css`
- Modify: `apps/customer-portal/src/app/app.routes.ts`
- Test: `apps/customer-portal/src/app/gallery/gallery.spec.ts`

**Interfaces:**
- Consumes, all from `@peakpower/shared-ui` (Tasks 4–14):
  `PP_MINUS`, `PpMoneyPipe`, `PpEnergyPipe`, `PpPowerPipe`, `PpPricePipe`, `PpTone`, `PpBadge`,
  `PpButton`, `PpButtonVariant`, `PpCard`, `PpStatCard`, `PpBanner`, `PpDsBanner`,
  `PpGridTable`, `PpGridHead`, `PpGridRow`, `PpSearchInput`, `PpAppShell`, `PpNavSection`.
  Also `export const routes: Routes` from Task 2.
- Produces: `export class Gallery` — selector `pp-gallery`, reachable at `/gallery`, and the
  default route of the customer portal.

- [ ] **Step 1: Write the failing test**

Create `apps/customer-portal/src/app/gallery/gallery.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PP_MINUS } from '@peakpower/shared-ui';
import { beforeEach, describe, expect, it } from 'vitest';
import { Gallery } from './gallery';

const ALL_TONES = ['neutral', 'brand', 'info', 'success', 'warning', 'critical'];

function renderGallery(): HTMLElement {
  const fixture = TestBed.createComponent(Gallery);
  fixture.detectChanges();
  return fixture.nativeElement;
}

describe('the component gallery', () => {
  // The rail navigates by routerLink, so the shell needs a router to render at all.
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('puts one of every primitive on the screen', () => {
    const el = renderGallery();
    for (const selector of [
      'pp-app-shell',
      'pp-badge',
      'pp-button',
      'pp-card',
      'pp-stat-card',
      'pp-banner',
      'pp-ds-banner',
      'pp-grid-table',
      'pp-search-input',
    ]) {
      expect(el.querySelector(selector), `${selector} is missing from the gallery`).not.toBeNull();
    }
  });

  it('shows every tone, so a contrast regression is visible in one scroll', () => {
    const el = renderGallery();
    const classes = [...el.querySelectorAll('pp-badge')].flatMap((badge) => [...badge.classList]);
    for (const tone of ALL_TONES) {
      expect(classes, `the ${tone} badge tone is missing`).toContain(`pp-badge--${tone}`);
    }
  });

  it('shows every button variant', () => {
    const el = renderGallery();
    const classes = [...el.querySelectorAll('pp-button')].flatMap((b) => [...b.classList]);
    for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'accept']) {
      expect(classes, `the ${variant} button variant is missing`).toContain(
        `pp-button--${variant}`,
      );
    }
  });

  it('renders all four nl-NL pipes, minus sign included', () => {
    const text = renderGallery().textContent ?? '';
    expect(text).toContain('€ 19.722,00');
    expect(text).toContain('385,4 MWh');
    expect(text).toContain('0,20 MW');
    expect(text).toContain('€ 102,4000 / MWh');
    expect(text).toContain(`€ ${PP_MINUS}4.210,00`);
  });

  it('shows a populated grid table, and an empty list as a card that names the reason', () => {
    const el = renderGallery();
    const tables = el.querySelectorAll('pp-grid-table');
    expect(tables).toHaveLength(1);
    expect(tables[0].querySelectorAll('.pp-grid-table__row')).toHaveLength(3);

    // The table is never rendered with a bare head; the caller says why the list is empty.
    expect(el.textContent).toContain('Gas connections are not tradeable in this portal.');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test customer-portal --watch=false
```

Expected: FAIL — `Failed to resolve import "./gallery" from "apps/customer-portal/src/app/gallery/gallery.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the minimal implementation**

Create `apps/customer-portal/src/app/gallery/gallery.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import {
  PpAppShell,
  PpBadge,
  PpBanner,
  PpButton,
  PpCard,
  PpDsBanner,
  PpEnergyPipe,
  PpGridHead,
  PpGridRow,
  PpGridTable,
  PpMoneyPipe,
  PpPowerPipe,
  PpPricePipe,
  PpSearchInput,
  PpStatCard,
  type PpButtonVariant,
  type PpNavSection,
  type PpTone,
} from '@peakpower/shared-ui';

interface Connection {
  readonly ean: string;
  readonly name: string;
  readonly capacityMw: number;
  readonly coverage: string;
}

@Component({
  selector: 'pp-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './gallery.css',
  imports: [
    PpAppShell,
    PpBadge,
    PpBanner,
    PpButton,
    PpCard,
    PpDsBanner,
    PpEnergyPipe,
    PpGridHead,
    PpGridRow,
    PpGridTable,
    PpMoneyPipe,
    PpPowerPipe,
    PpPricePipe,
    PpSearchInput,
    PpStatCard,
  ],
  template: `
    <pp-app-shell
      productName="PeakPower"
      [sections]="nav"
      activeRouteKey="gallery"
      subtitle="Every SB-2026 primitive and every nl-NL pipe on one screen."
    >
      <pp-button slot="topbar-actions" size="sm">Export tokens</pp-button>

      <pp-banner tone="warning" heading="Offer received — Base Nov-2026 · 0,20 MW · € 102,4000 / MWh">
        Respond within 24:41 — the price is firm until then.
        <div class="gallery__row">
          <pp-button size="sm" variant="accept">Accept the price</pp-button>
          <pp-button size="sm" variant="ghost">Let it lapse</pp-button>
        </div>
      </pp-banner>

      <pp-ds-banner heading="Indicative prices">
        These are indicative market prices, not offers. A firm, time-limited price is issued
        only in response to a trade request.
      </pp-ds-banner>

      <div class="gallery__stats">
        <pp-stat-card
          label="AVAILABLE BALANCE"
          [value]="balance | ppMoney"
          sublabel="settled € 29.122 · reserved € 9.400"
        />
        <pp-stat-card
          label="UNCOVERED VOLUME"
          tone="critical"
          [value]="uncoveredMwh | ppEnergy"
          sublabel="≈ € 18.953 at day-ahead"
        />
        <pp-stat-card
          label="CONTRACTED POWER"
          tone="brand"
          [value]="contractedMw | ppPower"
          sublabel="across three connections"
        />
        <pp-stat-card
          label="LAST TRADED PRICE"
          tone="success"
          [value]="lastPrice | ppPrice"
          sublabel="TRD-1078 · 12 Aug 2026, 09:14:00"
        />
        <pp-stat-card
          label="MONTH TO DATE"
          tone="warning"
          [value]="monthToDate | ppMoney"
          sublabel="imbalance settlement, provisional"
          highlight
        />
      </div>

      <pp-card
        heading="Status vocabulary"
        subtitle="Six tones, six meanings. Every tone carries a real 1px border."
      >
        <div class="gallery__row">
          @for (tone of tones; track tone) {
            <pp-badge [tone]="tone">{{ tone }}</pp-badge>
          }
        </div>
      </pp-card>

      <pp-card heading="Buttons" subtitle="Five variants, two sizes, one height.">
        <div class="gallery__row">
          @for (variant of buttonVariants; track variant) {
            <pp-button [variant]="variant">{{ variant }}</pp-button>
          }
          <pp-button size="sm">Small</pp-button>
          <pp-button disabled>Disabled — trading opens in slice 2</pp-button>
        </div>
      </pp-card>

      <pp-card heading="Connections" subtitle="Filtered live by the field above the table.">
        <span ppCardAction>Export CSV</span>
        <div class="gallery__row gallery__row--controls">
          <pp-search-input
            [(value)]="query"
            placeholder="Search name, description or EAN…"
          />
          <pp-badge tone="info">{{ visible().length }} of {{ connections.length }}</pp-badge>
        </div>
        @if (visible().length > 0) {
          <pp-grid-table columns="1.6fr 1.2fr 0.8fr 0.8fr">
            <div ppGridHead>
              <div>EAN</div>
              <div>Connection</div>
              <div class="pp-grid-table__num">Contracted power</div>
              <div class="pp-grid-table__num">Coverage</div>
            </div>
            @for (row of visible(); track row.ean) {
              <div ppGridRow>
                <div class="gallery__mono">{{ row.ean }}</div>
                <div>{{ row.name }}</div>
                <div class="pp-grid-table__num">{{ row.capacityMw | ppPower }}</div>
                <div class="pp-grid-table__num">{{ row.coverage }}</div>
              </div>
            }
          </pp-grid-table>
        } @else {
          <p class="gallery__empty">No connection matches that search.</p>
        }
      </pp-card>

      <pp-card
        heading="Gas connections"
        subtitle="An empty list is never a bare head — the screen says why it is empty."
      >
        <p class="gallery__empty">Gas connections are not tradeable in this portal.</p>
      </pp-card>

      <pp-card heading="nl-NL formatting" subtitle="Comma decimal, period thousands, U+2212 minus.">
        <dl class="gallery__facts">
          <dt>ppMoney</dt>
          <dd>{{ balance | ppMoney }}</dd>
          <dt>ppMoney, negative</dt>
          <dd>{{ correction | ppMoney }}</dd>
          <dt>ppEnergy</dt>
          <dd>{{ uncoveredMwh | ppEnergy }}</dd>
          <dt>ppPower</dt>
          <dd>{{ contractedMw | ppPower }}</dd>
          <dt>ppPrice</dt>
          <dd>{{ lastPrice | ppPrice }}</dd>
        </dl>
      </pp-card>

      <pp-banner tone="critical" heading="Metering feed silent for two days">
        This indicates a coverage defect, not a data gap. Engineering has been alerted.
      </pp-banner>

      <p class="gallery__footer">
        <b>Demo only.</b> Every figure on this page is synthetic test data generated for this
        proof of concept. It does not represent real customers, accounts or transactions.
      </p>
    </pp-app-shell>
  `,
})
export class Gallery {
  /** The grouped rail of design §8.4. Only the gallery itself is routable in this plan. */
  readonly nav: readonly PpNavSection[] = [
    {
      label: 'Overview',
      items: [
        {
          routeKey: 'gallery',
          label: 'Design system',
          path: '/gallery',
          dot: 'var(--pp-blue-500)',
        },
      ],
    },
    {
      label: 'Position',
      items: [
        {
          routeKey: 'consumption',
          label: 'Volume',
          path: null,
          dot: 'var(--pp-mint)',
          disabledReason: 'Metering volume arrives with the ingestion feed, in a later slice.',
        },
        {
          routeKey: 'connections',
          label: 'Connections',
          path: null,
          dot: 'var(--pp-teal)',
          disabledReason: 'The customer portal builds this screen in Plan 6.',
        },
      ],
    },
    {
      label: 'Market',
      items: [
        {
          routeKey: 'trading',
          label: 'Trades',
          path: null,
          dot: 'var(--pp-blue-700)',
          disabledReason: 'Trading arrives with feature F05.',
        },
        {
          routeKey: 'wallet',
          label: 'Balance',
          path: null,
          dot: 'var(--pp-amber)',
          disabledReason: 'The wallet ledger arrives with feature F06.',
        },
      ],
    },
  ];

  readonly tones: readonly PpTone[] = [
    'neutral', 'brand', 'info', 'success', 'warning', 'critical',
  ];

  readonly buttonVariants: readonly PpButtonVariant[] = [
    'primary', 'secondary', 'ghost', 'danger', 'accept',
  ];

  readonly balance = 19722;
  readonly correction = -4210;
  readonly uncoveredMwh = 385.4;
  readonly contractedMw = 0.2;
  readonly lastPrice = 102.4;
  readonly monthToDate = 2914.5;

  readonly connections: readonly Connection[] = [
    { ean: '871687100000000001', name: 'Vriescel 1', capacityMw: 0.2, coverage: '78,4 %' },
    { ean: '871687100000000002', name: 'Vriescel 2', capacityMw: 0.45, coverage: '61,0 %' },
    { ean: '871687100000000003', name: 'Kantoor Nieuwegein', capacityMw: 0.08, coverage: '92,5 %' },
  ];

  readonly query = signal('');

  readonly visible = computed(() => {
    const needle = this.query().trim().toLowerCase();
    if (needle.length === 0) {
      return this.connections;
    }
    return this.connections.filter(
      (row) => row.name.toLowerCase().includes(needle) || row.ean.includes(needle),
    );
  });
}
```

Create `apps/customer-portal/src/app/gallery/gallery.css`:

```css
/* Gallery-local layout only. Nothing here belongs in the design system — the
   library ships components, and a page decides how they are arranged. */
.gallery__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(212px, 1fr));
  gap: 16px;
}

.gallery__row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.gallery__row--controls {
  margin-bottom: 14px;
}

.gallery__mono {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.gallery__empty {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}

.gallery__facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 8px 24px;
  margin: 0;
  font-size: var(--text-sm);
}
.gallery__facts dt {
  color: var(--color-text-body);
  font-family: var(--font-mono);
}
.gallery__facts dd {
  margin: 0;
  font-weight: var(--weight-semibold);
}

.gallery__footer {
  margin: 8px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--color-border);
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--color-text-faint);
}
.gallery__footer b {
  color: var(--color-text-body);
}
```

Replace `apps/customer-portal/src/app/app.routes.ts`:

```ts
import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'gallery' },
  {
    path: 'gallery',
    loadComponent: () => import('./gallery/gallery').then((m) => m.Gallery),
  },
];
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test customer-portal --watch=false && npm run test
```

Expected: PASS — 5 passing tests for `customer-portal`, then the full `npm run test` run reports
`# pass 7` from the workspace contract tests and 75 passing Vitest tests for `shared-ui`.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add apps/customer-portal/src/app
git commit -m "feat(customer-portal): add the design-system component gallery"
```

Then open it and look at it — this is the deliverable, and it is meant to be seen:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run start:customer-portal
```

Expected: the dev server serves `http://localhost:4200/`, which redirects to `/gallery` and
renders the rail, the topbar and every specimen on the SB-2026 gradient canvas.

---

## Definition of done

Every box below is checked by running a command, not by reading the code.

- [ ] `cd /Users/thinhhuynh/PeakPower/peakpower-web && npm run test` exits zero. That is the
      workspace-contract suite (`# pass 7`), 75 `shared-ui` Vitest tests and 5 `customer-portal`
      Vitest tests.
- [ ] `npx ng build customer-portal` and `npx ng build employee-portal` both print
      `Application bundle generation complete` with no budget error.
- [ ] `npm run start:customer-portal` serves a page at `/` that redirects to `/gallery` and shows
      the rail, the topbar and every primitive.
- [ ] `PORT=4300 npm run start:customer-portal` serves on port 4300 — the contract Plan 1's
      `builder.AddJavaScriptApp("customer-portal", webRoot, "start:customer-portal")` depends on.
- [ ] `apps/*/package.json` does not exist. There is exactly one `package.json` at the workspace
      root plus the library's own.
- [ ] Every one of the nine `pp-` selectors from the shared contract resolves:
      `pp-card`, `pp-stat-card`, `pp-badge`, `pp-button`, `pp-banner`, `pp-ds-banner`,
      `pp-grid-table`, `pp-search-input`, `pp-app-shell` — plus the two attribute directives
      the table is driven by, `[ppGridHead]` and `[ppGridRow]`.
- [ ] `grep -rn positive libs/shared-ui/src` returns nothing, and `grep -rn danger
      libs/shared-ui/src` returns only `pp-button`'s `danger` variant: shared contract §10.1
      spells the tones `success` and `critical`, and `PpTone` has no other members.
- [ ] `grep -rn "pp-canvas" libs/shared-ui/src/styles/colors.css` returns the definition Plans 4
      and 6 both paint their pages with.
- [ ] `grep -rn "NgModule" libs apps --include=*.ts` returns nothing.
- [ ] `grep -rn "certainty-provisional-opacity" libs` returns nothing.
- [ ] `grep -rn "pp-cyan-text" libs` returns nothing — `--pp-cyan` has no text tier and never
      gets one.
- [ ] `git log --oneline` shows one commit per task, in order, each with a conventional message.

Not done in this plan, and deliberately so:

- The seven Inter `woff2` subsets and the two `logo-mark*.svg` files listed in **File Structure**
  are not fetched by any task above. `styles/fonts.css` points at `/assets/fonts/inter-*.woff2`,
  so until those files land the gallery renders in the `'Segoe UI'` / system fallback of
  `--font-sans`. Everything else is unaffected. The `pp-app-shell` brand mark is inlined as SVG
  in the component, so it does not depend on the asset files at all.
- `libs/api-client-customer` and `libs/api-client-employee` belong to Plans 5 and 6.
- The employee portal has no routes yet; Plan 4 fills it in.
- No E2E test. Plan 6 contributes the one Playwright path.
- **The `[OQ-49]` / `[OQ-22]` component-library spike.** Design §13 asks for it during this
  slice — whether an off-the-shelf Angular component library replaces these nine hand-built
  primitives, decided before the chart slice. It is a procurement and architecture question
  about components this plan is finishing, not a task inside it, and running it here would
  block nine primitives Plans 4 and 6 need next week. It stays `[OQ-49]`, and the gallery this
  plan ships is what the spike will be judged against.

## New names introduced

Names this plan defines that the shared contract does not. The nine `pp-` selectors, the two
grid directives, `PpTone`, `PpNavItem`, `PpNavSection` and every component input listed in
shared contract §10.1 are **the contract's**, not this plan's — this plan implements them.
Likewise the workspace layout, the `@peakpower/` scope, the token values and `--pp-canvas` come
from `docs/superpowers/plans/2026-08-26-slice-1-shared-contract.md`.

**Formatting layer** — `libs/shared-ui/src/lib/format/`

```ts
export const PP_MINUS: string;                               // the single character U+2212
export function formatDutchDecimal(value: number, decimals: number): string;

export class PpMoneyPipe implements PipeTransform {          // name: 'ppMoney'
  transform(value: number | null | undefined): string;
}
export class PpEnergyPipe implements PipeTransform {         // name: 'ppEnergy'
  transform(value: number | null | undefined, decimals?: number): string;
}
export class PpPowerPipe implements PipeTransform {          // name: 'ppPower'
  transform(value: number | null | undefined): string;
}
export class PpPricePipe implements PipeTransform {          // name: 'ppPrice'
  transform(value: number | null | undefined): string;
}
```

**Spec-only helpers** — `libs/shared-ui/src/testing/read-css.ts`, never bundled

```ts
export function workspaceRoot(): string;
export function readSharedUiCss(relativePath: string): string;
export function cssText(relativePath: string): string;      // the same CSS, whitespace stripped
export function colorDeclarations(css: string): string[];
export const PP_BRIGHT_FILL_TOKENS: readonly string[];      // fills that may never become type
```

**Named beyond shared contract §10.1** — the contract fixes each component's selector, its tone
type and the inputs that cross plan boundaries; these are this plan's additions inside that
shape, and no other plan has to know them.

```ts
// The two unions behind PpButton's inline literals in the contract.
export type PpButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accept';
export type PpButtonSize = 'md' | 'sm';

// Inputs and slots the contract does not name:
//   PpButton.type      — 'button' | 'submit', default 'button'
//   PpStatCard.highlight — the amber surface for the column that needs action now
//   pp-card    slot  [ppCardAction]        — the right-hand action in the card head
//   pp-app-shell slot [slot=topbar-actions] — the right-hand actions in the topbar
```

**Application** — `apps/customer-portal/src/app/gallery/`

```ts
export class Gallery {}   // <pp-gallery>, lazy-loaded at /gallery, the portal's default route
```

**CSS custom properties owned by a component**, set per tone/variant on the host and read inside
that component only:

```
--pp-badge-bg          --pp-badge-border      --pp-badge-text
--pp-button-bg         --pp-button-border     --pp-button-text
--pp-stat-card-cap     --pp-stat-card-value
--pp-banner-bg         --pp-banner-border     --pp-banner-text     --pp-banner-mark
--pp-ds-banner-bg      --pp-ds-banner-border  --pp-ds-banner-text  --pp-ds-banner-mark
--pp-grid-columns
```
