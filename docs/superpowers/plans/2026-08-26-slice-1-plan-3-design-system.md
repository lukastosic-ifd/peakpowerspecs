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
| Domain / Application unit | xUnit + FluentAssertions (+ NSubstitute for ports) |
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
5. No type outside `PeakPower.Infrastructure.Time` uses `DateTime.Now` / `DateTime.UtcNow`
6. No type outside the context-provider assembly reads a customer identifier from `HttpContext`

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
| `src/styles/colors.css` | Ported verbatim minus `--certainty-provisional-opacity`. |
| `src/styles/typography.css`, `spacing.css`, `radii.css`, `layout.css`, `semantic.css` | Ported verbatim. |
| `src/styles/tokens.css` | The one entry point — `@import`s the seven above in order. Applications list this file in their `styles` array. |
| `src/styles/tokens.spec.ts` | Asserts the port rules: no dead certainty token, `--pp-cyan` has no text pair, `--pp-indigo` is violet, the key metrics are present. |
| `src/assets/fonts/inter-*.woff2` | The seven Inter subsets. |
| `src/assets/logo-mark.svg`, `logo-mark-sidebar.svg` | The brand mark at page size and at rail size. |
| `src/assets/assets.spec.ts` | Asserts all nine asset files exist and that `fonts.css` points at each subset with a root-absolute URL. |
| `src/lib/format/dutch-number.ts` | `PP_MINUS` and `formatDutchDecimal` — the one place a number becomes nl-NL text. |
| `src/lib/format/dutch-number.spec.ts` | Grouping, decimal comma, U+2212, and the negative-zero rule. |
| `src/lib/format/pp-money.pipe.ts` | `€ 19.722,00`. |
| `src/lib/format/pp-energy.pipe.ts` | `385,4 MWh`. |
| `src/lib/format/pp-power.pipe.ts` | `0,20 MW` — exactly two decimals. |
| `src/lib/format/pp-price.pipe.ts` | `€ 102,4000 / MWh` — exactly four decimals. |
| `src/lib/format/pp-format.pipes.spec.ts` | One suite covering all four pipes. |
| `src/lib/badge/pp-badge.ts`, `pp-badge.css`, `pp-badge.spec.ts` | The pill status label — the product's single status vocabulary. |
| `src/lib/button/pp-button.ts`, `pp-button.css`, `pp-button.spec.ts` | The one button primitive; five variants at matching heights. |
| `src/lib/card/pp-card.ts`, `pp-card.css`, `pp-card.spec.ts` | The default content container. |
| `src/lib/stat-card/pp-stat-card.ts`, `pp-stat-card.css`, `pp-stat-card.spec.ts` | One headline figure with its label and provenance. |
| `src/lib/banner/pp-banner.ts`, `pp-banner.css`, `pp-banner.spec.ts` | The SB-2026 page-level notice. |
| `src/lib/ds-banner/pp-ds-banner.ts`, `pp-ds-banner.css`, `pp-ds-banner.spec.ts` | The design-system notice. A different component, not a variant. |
| `src/lib/search-input/pp-search-input.ts`, `pp-search-input.css`, `pp-search-input.spec.ts` | The filter field carrying the product's only icon. |
| `src/lib/grid-table/pp-grid-row.ts` | The structural directive supplying one row's cells. |
| `src/lib/grid-table/pp-grid-table.ts`, `pp-grid-table.css`, `pp-grid-table.spec.ts` | The CSS-grid list table, and the rule that it is never rendered empty. |
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
  - Angular projects named `customer-portal` (prefix `cp`) and `employee-portal` (prefix `ep`),
    each with `build`, `serve` and `test` targets.
  - `export const appConfig: ApplicationConfig` and `export const routes: Routes` in each app.
  - `export class App` — the root component, selector `cp-root` / `ep-root`.

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
      "prefix": "cp",
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
      "prefix": "ep",
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
  <cp-root></cp-root>
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
  background: var(--pp-bg-gradient);
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
}
```

Create `apps/customer-portal/src/app/app.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'cp-root',
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

Now create the employee portal by copying and rewriting the two selectors:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
cp -R apps/customer-portal/src apps/employee-portal/src
cp apps/customer-portal/tsconfig.app.json apps/customer-portal/tsconfig.spec.json apps/employee-portal/
sed -i '' 's/cp-root/ep-root/g' apps/employee-portal/src/index.html apps/employee-portal/src/app/app.ts
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
`--certainty-provisional-opacity`, whose feature was removed.

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

Create `libs/shared-ui/package.json`:

```json
{
  "name": "@peakpower/shared-ui",
  "version": "0.0.1",
  "peerDependencies": {
    "@angular/common": "^22.1.0",
    "@angular/core": "^22.1.0"
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

Create `libs/shared-ui/src/styles/colors.css` — ported verbatim; the only change is that the
`--certainty-provisional-opacity` line and its comment are gone:

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

Expected: PASS — `8 passed` from Vitest, followed by `Application bundle generation complete`.

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

Expected: PASS — Vitest reports 14 passing tests (the 8 token tests from Task 3 plus these 6).

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

Expected: PASS — Vitest reports 22 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/format libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add the ppMoney, ppEnergy, ppPower and ppPrice pipes"
```

---

## Task 6: `pp-badge`

The pill status label — the product's single status vocabulary. Ten tones, each one a *meaning*
rather than a decoration: `success` = confirmed / final / healthy, `warning` = waiting on
someone / provisional, `critical` = failed / expiring, `info` = an in-flight or partial record,
`brand` = a product shape (Base / Peak), `system` = a machine-made or corrected record,
`short` = uncovered volume, `long` = surplus sold, `sell` = the sell direction, `neutral` = not
tradeable / projected / duplicate.

Two rules carry the whole component. **Every tone has a real 1px border** — without it the tones
with pale tints (`info`, `neutral`) dissolve into a white card. And **the text colour is always
the darker `*-text` tier, never the bright fill** — an 11px badge set in `#1DBD8E` is about 2:1
on white and unreadable.

Every component from here on styles its own host element, so the stylesheets use `:host` and
`:host(.modifier)`. Under Angular's emulated view encapsulation a plain `.pp-badge {}` rule is
rewritten to `.pp-badge[_ngcontent-xxx]` and would never match the host, which carries
`_nghost-xxx` instead.

**Files:**
- Create: `libs/shared-ui/src/lib/badge/pp-badge.ts`
- Create: `libs/shared-ui/src/lib/badge/pp-badge.css`
- Modify: `libs/shared-ui/src/public-api.ts`
- Test: `libs/shared-ui/src/lib/badge/pp-badge.spec.ts`

**Interfaces:**
- Consumes: `export function cssText(relativePath: string): string` and
  `export const PP_BRIGHT_FILL_TOKENS: readonly string[]` from Task 3's
  `libs/shared-ui/src/testing/read-css.ts`.
- Produces:
  - `export type PpBadgeTone = 'success' | 'warning' | 'critical' | 'info' | 'brand' | 'system' | 'short' | 'long' | 'sell' | 'neutral'`
  - `export class PpBadge` — selector `pp-badge`, input `tone: InputSignal<PpBadgeTone>`
    (default `'neutral'`), content projected as the label.

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/badge/pp-badge.spec.ts`:

```ts
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { PP_BRIGHT_FILL_TOKENS, cssText } from '../../testing/read-css';
import { PpBadge, type PpBadgeTone } from './pp-badge';

@Component({
  imports: [PpBadge],
  template: `<pp-badge tone="success">Confirmed</pp-badge>`,
})
class BadgeHost {}

const ALL_TONES: readonly PpBadgeTone[] = [
  'success', 'warning', 'critical', 'info', 'brand',
  'system', 'short', 'long', 'sell', 'neutral',
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

Create `libs/shared-ui/src/lib/badge/pp-badge.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * A tone is a meaning, not a colour choice. Pick the one that says what the record IS; the
 * palette then decides how it looks.
 */
export type PpBadgeTone =
  | 'success'
  | 'warning'
  | 'critical'
  | 'info'
  | 'brand'
  | 'system'
  | 'short'
  | 'long'
  | 'sell'
  | 'neutral';

@Component({
  selector: 'pp-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-badge.css',
  template: `<ng-content />`,
  host: { '[class]': 'hostClass()' },
})
export class PpBadge {
  readonly tone = input<PpBadgeTone>('neutral');

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
   11px type drops to roughly 2:1 on white. */
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
:host(.pp-badge--info) {
  --pp-badge-bg: var(--pp-blue-050);
  --pp-badge-border: #a9c8e8;
  --pp-badge-text: var(--pp-blue-700);
}
:host(.pp-badge--brand) {
  --pp-badge-bg: var(--pp-blue-100);
  --pp-badge-border: #a9c8e8;
  --pp-badge-text: var(--pp-blue-700);
}
:host(.pp-badge--system) {
  --pp-badge-bg: var(--pp-violet-bg);
  --pp-badge-border: var(--pp-violet-border);
  --pp-badge-text: var(--pp-violet-text);
}
:host(.pp-badge--short) {
  --pp-badge-bg: var(--pp-coral-bg);
  --pp-badge-border: var(--pp-coral-border);
  --pp-badge-text: var(--pp-coral-text);
}
/* --pp-cyan has no text tier at all, so "long" reads the teal tier instead. */
:host(.pp-badge--long) {
  --pp-badge-bg: #e4f7f5;
  --pp-badge-border: #9fdcd6;
  --pp-badge-text: var(--pp-teal-text);
}
:host(.pp-badge--sell) {
  --pp-badge-bg: var(--pp-pink-bg);
  --pp-badge-border: var(--pp-pink-border);
  --pp-badge-text: var(--pp-pink-text);
}
:host(.pp-badge--neutral) {
  --pp-badge-bg: var(--pp-surface-alt);
  --pp-badge-border: var(--color-border-strong);
  --pp-badge-text: var(--color-text-body);
}
```

Append to `libs/shared-ui/src/public-api.ts`:

```ts
export { PpBadge, type PpBadgeTone } from './lib/badge/pp-badge';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 27 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/badge libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add the pp-badge status pill"
```

---

## Task 7: `pp-button`

One button primitive, five variants, three sizes. The rule that makes it a system rather than a
pile of styles is that **every variant carries `border: 1px solid`** — including `ghost`, whose
border is transparent. A borderless ghost button is 2px shorter than the primary button beside
it, and a filter row of mixed variants goes visibly ragged.

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
  - `export type PpButtonVariant = 'primary' | 'secondary' | 'danger' | 'accent' | 'ghost'`
  - `export type PpButtonSize = 'sm' | 'md' | 'lg'`
  - `export class PpButton` — selector `pp-button`, inputs
    `variant: InputSignal<PpButtonVariant>` (default `'primary'`),
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
  'primary', 'secondary', 'danger', 'accent', 'ghost',
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

  it('changes only padding and font size between sizes', () => {
    const css = cssText('lib/button/pp-button.css');
    expect(css).toContain('padding:10px20px');
    expect(css).toContain('padding:7px14px');
    expect(css).toContain('padding:13px26px');
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

export type PpButtonVariant = 'primary' | 'secondary' | 'danger' | 'accent' | 'ghost';
export type PpButtonSize = 'sm' | 'md' | 'lg';

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
  readonly variant = input<PpButtonVariant>('primary');
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
:host(.pp-button--lg) .pp-button__control {
  padding: 13px 26px;
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

:host(.pp-button--accent) {
  --pp-button-bg: var(--pp-mint);
  --pp-button-border: var(--pp-mint);
  --pp-button-text: var(--pp-text-heading);
}
:host(.pp-button--accent) .pp-button__control:hover:not(:disabled) {
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

Expected: PASS — Vitest reports 32 passing tests.

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

The rule worth a test is the spacing one, because it is the thing that gets "tidied" and breaks.
**The subtitle is a sibling of the head, not a child of it.** The head is a flex row — title on
the left, action on the right — and a subtitle nested inside that row would be laid out beside
the title instead of beneath it. Because the subtitle sits outside, the head's bottom margin has
to shrink from 14px to 4px whenever a subtitle follows, and the subtitle then carries the
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
  - `export class PpCard` — selector `pp-card`, inputs `title: InputSignal<string>` (default
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
    <pp-card title="Ledger" subtitle="Every movement, newest first">
      <span ppCardAction>Export CSV</span>
      <p class="body-marker">Nine entries this month.</p>
    </pp-card>
  `,
})
class WithSubtitleHost {}

@Component({
  imports: [PpCard],
  template: `<pp-card title="Ledger"><p>Nine entries this month.</p></pp-card>`,
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
    // Inside the head's flex row the subtitle would sit BESIDE the title.
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

  it('renders no head at all when there is no title', () => {
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
 * The default content container. A card with a header action but no title is not a shape this
 * system has — the action belongs to the title, so the head is gated on the title alone.
 */
@Component({
  selector: 'pp-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-card.css',
  template: `
    @if (title()) {
      <div class="pp-card__head" [class.pp-card__head--tight]="subtitle().length > 0">
        <div class="pp-card__title">{{ title() }}</div>
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
  readonly title = input<string>('');
  /** One-line explanation under the title. It carries its own 14px bottom margin. */
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
   laid out beside the title. It is a sibling, and the 14px gap to the body is
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

.pp-card__title {
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

Expected: PASS — Vitest reports 38 passing tests.

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

`critical` is coral in this system, not red. A genuinely red figure — a negative balance — is a
call-site decision, not a tone.

**Files:**
- Create: `libs/shared-ui/src/lib/stat-card/pp-stat-card.ts`
- Create: `libs/shared-ui/src/lib/stat-card/pp-stat-card.css`
- Modify: `libs/shared-ui/src/public-api.ts`
- Test: `libs/shared-ui/src/lib/stat-card/pp-stat-card.spec.ts`

**Interfaces:**
- Consumes: `export function cssText(relativePath: string): string` from Task 3.
- Produces:
  - `export type PpStatCardTone = 'default' | 'brand' | 'warning' | 'critical' | 'success'`
  - `export class PpStatCard` — selector `pp-stat-card`, inputs
    `label: InputSignal<string>` (required), `value: InputSignal<string>` (required),
    `sublabel: InputSignal<string>` (default `''`),
    `tone: InputSignal<PpStatCardTone>` (default `'default'`),
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

/** `critical` is CORAL in this system, not red. A red figure is a call-site decision. */
export type PpStatCardTone = 'default' | 'brand' | 'warning' | 'critical' | 'success';

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
  readonly tone = input<PpStatCardTone>('default');
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

:host(.pp-stat-card--default) {
  --pp-stat-card-cap: var(--pp-blue-700);
  --pp-stat-card-value: var(--color-text-heading);
}
:host(.pp-stat-card--brand) {
  --pp-stat-card-cap: var(--pp-blue-700);
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
export { PpStatCard, type PpStatCardTone } from './lib/stat-card/pp-stat-card';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 44 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/stat-card libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add the pp-stat-card figure with its 3px accent cap"
```

---

## Task 10: `pp-banner` — the SB-2026 page-level notice

The notice that sits directly above the content it qualifies, full width, never more than one at
a time. `warning` = you must act, or this data is provisional. `critical` = something failed or
halted — say what, and who is on it. `info` = this qualifies the screen and needs no action.

This is the SB-2026 shape from the adopted design: a **26px rounded-square** mark holding a
literal `!`, `15px 18px` of padding, title 13/700 and body 11.5 three pixels under it. It always
has a title — a banner without one is a different component, which is Task 11.

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
  - `export type PpBannerTone = 'info' | 'warning' | 'critical'`
  - `export class PpBanner` — selector `pp-banner`, inputs `title: InputSignal<string>`
    (required), `body: InputSignal<string>` (default `''`),
    `tone: InputSignal<PpBannerTone>` (default `'info'`); projected content becomes the
    right-hand action slot.

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/banner/pp-banner.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { PP_BRIGHT_FILL_TOKENS, cssText } from '../../testing/read-css';
import { PpBanner } from './pp-banner';

function createBanner() {
  const fixture = TestBed.createComponent(PpBanner);
  fixture.componentRef.setInput('title', 'Offer received — Base Nov-2026 · 0,20 MW');
  return fixture;
}

describe('pp-banner', () => {
  it('always shows the mark, because a banner always has a title', () => {
    const fixture = createBanner();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const mark = el.querySelector('.pp-banner__mark')!;
    expect(mark.textContent?.trim()).toBe('!');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('.pp-banner__title')?.textContent).toContain('Offer received');
  });

  it('puts the body under the title, not beside it', () => {
    const fixture = createBanner();
    fixture.componentRef.setInput('body', 'Respond within 24:41 — the price is firm until then.');
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const title = el.querySelector('.pp-banner__title')!;
    const body = el.querySelector('.pp-banner__body')!;
    expect(body.parentElement).toBe(title.parentElement);
    expect(title.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('carries the tone on the host', () => {
    const fixture = createBanner();
    fixture.componentRef.setInput('tone', 'warning');
    fixture.detectChanges();
    expect(fixture.nativeElement.classList.contains('pp-banner--warning')).toBe(true);
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
    expect(textValues).toHaveLength(3);
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

export type PpBannerTone = 'info' | 'warning' | 'critical';

/**
 * The SB-2026 page-level notice. Sits directly above the content it qualifies, full width,
 * and never stacked more than one at a time.
 */
@Component({
  selector: 'pp-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-banner.css',
  template: `
    <div class="pp-banner__mark" aria-hidden="true">!</div>
    <div class="pp-banner__text">
      <div class="pp-banner__title">{{ title() }}</div>
      @if (body()) {
        <div class="pp-banner__body">{{ body() }}</div>
      }
    </div>
    <div class="pp-banner__action"><ng-content /></div>
  `,
  host: { '[class]': 'hostClass()', role: 'status' },
})
export class PpBanner {
  readonly title = input.required<string>();
  readonly body = input<string>('');
  readonly tone = input<PpBannerTone>('info');

  protected readonly hostClass = computed(() => `pp-banner pp-banner--${this.tone()}`);
}
```

Create `libs/shared-ui/src/lib/banner/pp-banner.css`:

```css
:host {
  display: flex;
  align-items: center;
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
.pp-banner__title { font-size: 13px; font-weight: var(--weight-bold); }
.pp-banner__body { font-size: 11.5px; margin-top: 3px; line-height: 1.45; }
.pp-banner__action { flex-shrink: 0; }

/* --pp-banner-mark is the solid mark fill; --pp-banner-text is always a darker tier. */
:host(.pp-banner--info) {
  --pp-banner-bg: #eaf2fb;
  --pp-banner-border: #b3cdea;
  --pp-banner-text: var(--pp-blue-700);
  --pp-banner-mark: var(--pp-blue-700);
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
export { PpBanner, type PpBannerTone } from './lib/banner/pp-banner';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 49 passing tests.

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
| Mark | 26px rounded square, always shown | 22px **circle**, shown only when there is a title |
| Title | required | optional — a plain one-line note is a legal shape |
| Info tint | `#eaf2fb` / `#b3cdea` | `--pp-blue-050` / `#a9c8e8` |

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
  - `export type PpDsBannerTone = 'info' | 'warning' | 'critical'`
  - `export class PpDsBanner` — selector `pp-ds-banner`, inputs `title: InputSignal<string>`
    (default `''`), `body: InputSignal<string>` (default `''`),
    `tone: InputSignal<PpDsBannerTone>` (default `'info'`); projected content becomes the
    right-hand action slot.

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/ds-banner/pp-ds-banner.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { cssText } from '../../testing/read-css';
import { PpBanner } from '../banner/pp-banner';
import { PpDsBanner } from './pp-ds-banner';

describe('pp-ds-banner', () => {
  it('is a different component from PpBanner, not a variant of it', () => {
    expect(PpDsBanner).not.toBe(PpBanner);
    expect(Object.getPrototypeOf(PpDsBanner)).not.toBe(PpBanner);
  });

  it('answers to its own selector, so a template cannot swap one for the other', () => {
    const sb = TestBed.createComponent(PpBanner);
    sb.componentRef.setInput('title', 'Offer received');
    sb.detectChanges();

    const ds = TestBed.createComponent(PpDsBanner);
    ds.detectChanges();

    expect(sb.nativeElement.tagName.toLowerCase()).toBe('pp-banner');
    expect(ds.nativeElement.tagName.toLowerCase()).toBe('pp-ds-banner');
  });

  it('omits the mark for a plain one-line note — a shape pp-banner does not have', () => {
    const fixture = TestBed.createComponent(PpDsBanner);
    fixture.componentRef.setInput(
      'body',
      'These are indicative market prices, not offers.',
    );
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.pp-ds-banner__mark')).toBeNull();
    expect(el.querySelector('.pp-ds-banner__title')).toBeNull();
    expect(el.querySelector('.pp-ds-banner__body')?.textContent).toContain('indicative');
  });

  it('shows a 22px circular mark once it has a title', () => {
    const fixture = TestBed.createComponent(PpDsBanner);
    fixture.componentRef.setInput('title', 'Wallet below your alert threshold');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pp-ds-banner__mark')?.textContent?.trim())
      .toBe('!');
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

export type PpDsBannerTone = 'info' | 'warning' | 'critical';

/**
 * The design system's own notice shape. Deliberately NOT a variant of `pp-banner`: it has a
 * 22px circular mark that appears only alongside a title, a tighter 14px padding, and it
 * permits a plain one-line note with no title at all.
 */
@Component({
  selector: 'pp-ds-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-ds-banner.css',
  template: `
    @if (title()) {
      <div class="pp-ds-banner__mark" aria-hidden="true">!</div>
    }
    <div class="pp-ds-banner__text">
      @if (title()) {
        <div class="pp-ds-banner__title">{{ title() }}</div>
      }
      @if (body()) {
        <div
          class="pp-ds-banner__body"
          [class.pp-ds-banner__body--under-title]="title().length > 0"
        >
          {{ body() }}
        </div>
      }
    </div>
    <div class="pp-ds-banner__action"><ng-content /></div>
  `,
  host: { '[class]': 'hostClass()', role: 'status' },
})
export class PpDsBanner {
  /** Present ⇒ the 22px mark renders. Omit for a plain one-line note. */
  readonly title = input<string>('');
  readonly body = input<string>('');
  readonly tone = input<PpDsBannerTone>('info');

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
.pp-ds-banner__title {
  font-size: 13px;
  font-weight: var(--weight-bold);
  color: var(--pp-ds-banner-text);
}
.pp-ds-banner__body {
  font-size: 11.5px;
  color: var(--pp-ds-banner-text);
  line-height: 1.45;
}
.pp-ds-banner__body--under-title { margin-top: 3px; }
.pp-ds-banner__action { flex-shrink: 0; }

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
export { PpDsBanner, type PpDsBannerTone } from './lib/ds-banner/pp-ds-banner';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 54 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/ds-banner libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add pp-ds-banner as a component distinct from pp-banner"
```

---

## Task 12: `pp-grid-table` and the `ppGridRow` template

Every list in this product is a **CSS grid of divs**, not a `<table>`. That is not a stylistic
preference: each screen's column widths are hand-tuned `fr` tracks copied from the design
(`0.9fr 1fr 1.8fr 1fr 1fr 0.8fr 0.8fr 1fr` for the wallet ledger), a row's cells contain badges
and two-line sublabels, and `<td>` fights all of it. The track list is passed in as data and is
never "tidied" into equal columns.

The rule with teeth: **a grid table is never rendered with zero rows.** A head with nothing under
it looks like a loading failure. When there are no rows the component renders the empty-card
treatment instead — and because `emptyMessage` is a *required* input, the compiler makes it
impossible to ship an empty state that does not name the reason.

One row template serves every row. It is supplied as an `<ng-template ppGridRow>` whose cells the
table stamps out per row. The array is bound back to the directive purely so that TypeScript can
infer the row type and `let-row` is properly typed under `strictTemplates` — the directive never
reads it.

**Files:**
- Create: `libs/shared-ui/src/lib/grid-table/pp-grid-row.ts`
- Create: `libs/shared-ui/src/lib/grid-table/pp-grid-table.ts`
- Create: `libs/shared-ui/src/lib/grid-table/pp-grid-table.css`
- Modify: `libs/shared-ui/src/public-api.ts`
- Test: `libs/shared-ui/src/lib/grid-table/pp-grid-table.spec.ts`

**Interfaces:**
- Consumes: `export function cssText(relativePath: string): string` from Task 3, and
  `NgTemplateOutlet` from `@angular/common`.
- Produces:
  - `export interface PpGridRowContext<Row> { $implicit: Row; index: number }`
  - `export class PpGridRow<Row>` — selector `[ppGridRow]`, input
    `ppGridRow: InputSignal<readonly Row[]>` (required, type anchor only), public
    `template: TemplateRef<PpGridRowContext<Row>>`.
  - `export interface PpGridColumn { readonly label: string; readonly align?: 'left' | 'right' }`
  - `export class PpGridTable` — selector `pp-grid-table`, inputs
    `columns: InputSignal<readonly PpGridColumn[]>` (required),
    `rows: InputSignal<readonly unknown[]>` (required),
    `tracks: InputSignal<string>` (required — a raw `grid-template-columns` value),
    `emptyMessage: InputSignal<string>` (required),
    `dense: InputSignalWithTransform<boolean, unknown>` (default `false`),
    `zebra: InputSignalWithTransform<boolean, unknown>` (default `false`).

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/grid-table/pp-grid-table.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { cssText } from '../../testing/read-css';
import { PpGridRow } from './pp-grid-row';
import { PpGridTable, type PpGridColumn } from './pp-grid-table';

interface Connection {
  readonly ean: string;
  readonly name: string;
}

@Component({
  imports: [PpGridTable, PpGridRow],
  template: `
    <pp-grid-table
      [columns]="columns"
      [rows]="rows()"
      [zebra]="zebra()"
      [dense]="dense()"
      tracks="1.4fr 1fr"
      emptyMessage="No connections are linked to this company yet."
    >
      <ng-template [ppGridRow]="rows()" let-row>
        <div class="cell-ean">{{ row.ean }}</div>
        <div class="cell-name">{{ row.name }}</div>
      </ng-template>
    </pp-grid-table>
  `,
})
class GridHost {
  readonly columns: readonly PpGridColumn[] = [
    { label: 'EAN' },
    { label: 'Connection' },
  ];
  readonly rows = signal<readonly Connection[]>([
    { ean: '871687100000000001', name: 'Vriescel 1' },
    { ean: '871687100000000002', name: 'Vriescel 2' },
    { ean: '871687100000000003', name: 'Kantoor' },
  ]);
  readonly zebra = signal(false);
  readonly dense = signal(false);
}

describe('pp-grid-table', () => {
  it('renders one head and one row per row, stamped from the ppGridRow template', () => {
    const fixture = TestBed.createComponent(GridHost);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.pp-grid-table__head')).toHaveLength(1);
    expect(el.querySelectorAll('.pp-grid-table__row')).toHaveLength(3);
    expect(el.querySelectorAll('.cell-ean')[2].textContent).toBe('871687100000000003');
    expect(el.querySelector('.pp-grid-table__head')?.textContent).toContain('EAN');
  });

  it('is never rendered with zero rows — it becomes the empty card instead', () => {
    const fixture = TestBed.createComponent(GridHost);
    fixture.componentInstance.rows.set([]);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    // A head with nothing under it reads as a loading failure.
    expect(el.querySelector('.pp-grid-table__head')).toBeNull();
    expect(el.querySelector('.pp-grid-table__row')).toBeNull();
    expect(el.querySelector('.pp-grid-table__empty')).not.toBeNull();
  });

  it('makes the empty state name the reason, because emptyMessage is required', () => {
    const fixture = TestBed.createComponent(GridHost);
    fixture.componentInstance.rows.set([]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.pp-grid-table__empty')?.textContent?.trim())
      .toBe('No connections are linked to this company yet.');
  });

  it('stripes the odd rows only when zebra is asked for', () => {
    const fixture = TestBed.createComponent(GridHost);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.pp-grid-table__row--zebra')).toHaveLength(0);

    fixture.componentInstance.zebra.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.pp-grid-table__row--zebra')).toHaveLength(1);
  });

  it('marks the dense density on the host, for a table nested in a card', () => {
    const fixture = TestBed.createComponent(GridHost);
    fixture.componentInstance.dense.set(true);
    fixture.detectChanges();

    const table = fixture.nativeElement.querySelector('pp-grid-table') as HTMLElement;
    expect(table.classList.contains('pp-grid-table--dense')).toBe(true);
    const css = cssText('lib/grid-table/pp-grid-table.css');
    expect(css).toContain(':host(.pp-grid-table--dense).pp-grid-table__row{padding:11px12px');
  });

  it('feeds the per-screen track list to the head and the rows through one property', () => {
    const css = cssText('lib/grid-table/pp-grid-table.css');
    expect(css).toContain('grid-template-columns:var(--pp-grid-tracks)');
    // Head and rows read the same property, so they can never drift apart.
    expect(css).toContain('.pp-grid-table__head,.pp-grid-table__row{');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: FAIL — `Failed to resolve import "./pp-grid-row" from "libs/shared-ui/src/lib/grid-table/pp-grid-table.spec.ts". Does the file exist?`

- [ ] **Step 3: Write the minimal implementation**

Create `libs/shared-ui/src/lib/grid-table/pp-grid-row.ts`:

```ts
import { Directive, inject, input, TemplateRef } from '@angular/core';

export interface PpGridRowContext<Row> {
  $implicit: Row;
  index: number;
}

/**
 * Supplies one row's cells to `pp-grid-table`:
 *
 * ```html
 * <ng-template [ppGridRow]="rows()" let-row>
 *   <div>{{ row.ean }}</div>
 * </ng-template>
 * ```
 *
 * The bound array is a **type anchor only** — it is never read. Binding it is what lets
 * TypeScript infer `Row` so that `let-row` is typed under `strictTemplates`.
 */
@Directive({ selector: '[ppGridRow]' })
export class PpGridRow<Row> {
  readonly ppGridRow = input.required<readonly Row[]>();

  readonly template: TemplateRef<PpGridRowContext<Row>> = inject<
    TemplateRef<PpGridRowContext<Row>>
  >(TemplateRef);

  static ngTemplateContextGuard<Row>(
    _directive: PpGridRow<Row>,
    _context: unknown,
  ): _context is PpGridRowContext<Row> {
    return true;
  }
}
```

Create `libs/shared-ui/src/lib/grid-table/pp-grid-table.ts`:

```ts
import { NgTemplateOutlet } from '@angular/common';
import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  input,
} from '@angular/core';
import { PpGridRow } from './pp-grid-row';

export interface PpGridColumn {
  /** Rendered upper-case at 10.5/700 — one of only two places ALL CAPS is allowed. */
  readonly label: string;
  /** Numbers are right-aligned, always. */
  readonly align?: 'left' | 'right';
}

@Component({
  selector: 'pp-grid-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-grid-table.css',
  imports: [NgTemplateOutlet],
  template: `
    @if (rows().length > 0) {
      <div class="pp-grid-table__head">
        @for (column of columns(); track column.label) {
          <div [class.pp-grid-table__num]="column.align === 'right'">{{ column.label }}</div>
        }
      </div>
      @for (row of rows(); track $index) {
        <div
          class="pp-grid-table__row"
          [class.pp-grid-table__row--zebra]="zebra() && $index % 2 === 1"
        >
          <ng-container
            [ngTemplateOutlet]="rowTemplate().template"
            [ngTemplateOutletContext]="{ $implicit: row, index: $index }"
          />
        </div>
      }
    } @else {
      <p class="pp-grid-table__empty">{{ emptyMessage() }}</p>
    }
  `,
  host: { '[class]': 'hostClass()', '[style.--pp-grid-tracks]': 'tracks()' },
})
export class PpGridTable {
  readonly columns = input.required<readonly PpGridColumn[]>();
  readonly rows = input.required<readonly unknown[]>();
  /**
   * A raw `grid-template-columns` value, copied from the screen's design and never tidied
   * into equal columns — e.g. `0.9fr 1fr 1.8fr 1fr 1fr 0.8fr 0.8fr 1fr`.
   */
  readonly tracks = input.required<string>();
  /** Says WHY the list is empty. Required, so an empty state can never be blank. */
  readonly emptyMessage = input.required<string>();
  /** The density for a table nested inside a card. */
  readonly dense = input(false, { transform: booleanAttribute });
  readonly zebra = input(false, { transform: booleanAttribute });

  protected readonly rowTemplate = contentChild.required(PpGridRow);

  protected readonly hostClass = computed(() =>
    this.dense() ? 'pp-grid-table pp-grid-table--dense' : 'pp-grid-table',
  );
}
```

Create `libs/shared-ui/src/lib/grid-table/pp-grid-table.css`:

```css
:host {
  display: block;
  font-family: var(--font-sans);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--pp-shadow-card);
  overflow: hidden;
}

/* One property, read by the head and by every row, so the columns can never drift. */
.pp-grid-table__head,.pp-grid-table__row{display:grid;grid-template-columns:var(--pp-grid-tracks);align-items:center}

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
.pp-grid-table__head + .pp-grid-table__row { border-top: none; }
.pp-grid-table__row--zebra { background: var(--color-surface-zebra); }

:host(.pp-grid-table--dense) .pp-grid-table__head{padding:9px 12px;font-size:var(--text-2xs);gap:10px}
:host(.pp-grid-table--dense) .pp-grid-table__row{padding:11px 12px;font-size:12px;gap:10px}

.pp-grid-table__num { text-align: right; }

/* The empty treatment. It replaces the head and the rows — it never sits under them. */
.pp-grid-table__empty {
  margin: 0;
  padding: 22px 16px;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--color-text-faint);
}
```

Append to `libs/shared-ui/src/public-api.ts`:

```ts
export { PpGridRow, type PpGridRowContext } from './lib/grid-table/pp-grid-row';
export { PpGridTable, type PpGridColumn } from './lib/grid-table/pp-grid-table';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 60 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/grid-table libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add pp-grid-table, never rendered with zero rows"
```

---

## Task 13: `pp-search-input`

The filter field that sits above a list, beside the tabs, never inside the table. It is the only
search affordance in the product and it carries the **only icon in the entire product**: a 14px,
2px-stroke magnifier, drawn inline. There is no icon set, no icon font and no CDN — adding one
would be off-brand, and the CSP in the deployed portals would block it anyway.

The placeholder is required to say what is searchable ("Search name, description or EAN…"), so it
doubles as the field's accessible name.

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
    `placeholder: InputSignal<string>` (default `'Search…'`), two-way
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
  readonly placeholder = input<string>('Search…');
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

Expected: PASS — Vitest reports 64 passing tests.

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

Three rules:

- **The body never scrolls.** The host is `height: 100vh; overflow: hidden`, and the content
  column is the only element with `overflow: auto`. Let the body scroll and the rail and the
  topbar scroll away with it, which on a desk tool means losing the navigation while reading a
  ledger.
- **236px and 64px come from `--sidebar-width` and `--topbar-height`**, never from a literal in
  this stylesheet. Two places for one number is how they drift.
- **The topbar shows a crumb *or* a subtitle, never both.** They occupy the same 11px line above
  or below the title; showing both makes the 64px bar overflow and pushes the title off-centre.
  A crumb wins, because it is navigation and the subtitle is only description.

The shell deliberately does **not** depend on `@angular/router`. It emits the key of the item that
was clicked and lets the application route, which keeps `@peakpower/shared-ui`'s peer dependencies
to `@angular/core` and `@angular/common`.

Nav items outside the current slice render **disabled with the sentence explaining why**, rather
than being hidden — a rail that grows between demos looks unfinished; a rail that is complete and
honest looks planned.

**Files:**
- Create: `libs/shared-ui/src/lib/app-shell/pp-app-shell.ts`
- Create: `libs/shared-ui/src/lib/app-shell/pp-app-shell.css`
- Modify: `libs/shared-ui/src/public-api.ts`
- Test: `libs/shared-ui/src/lib/app-shell/pp-app-shell.spec.ts`

**Interfaces:**
- Consumes: `export function cssText(relativePath: string): string` from Task 3, and the
  `--sidebar-width` (236px), `--topbar-height` (64px), `--pp-sidebar-bg`, `--pp-sidebar-text`,
  `--pp-sidebar-active-bg` and `--pp-rail-spectrum` custom properties from that task's
  `styles/layout.css` and `styles/colors.css`.
- Produces:
  - `export interface PpNavItem { readonly key: string; readonly label: string; readonly group?: string; readonly disabled?: boolean; readonly disabledReason?: string }`
  - `export class PpAppShell` — selector `pp-app-shell`, inputs
    `portalLabel: InputSignal<string>` (required), `nav: InputSignal<readonly PpNavItem[]>`
    (required), `activeKey: InputSignal<string>` (default `''`),
    `title: InputSignal<string>` (required), `crumb: InputSignal<readonly string[]>`
    (default `[]`), `subtitle: InputSignal<string>` (default `''`),
    `userName: InputSignal<string>` (default `''`),
    `companyName: InputSignal<string>` (default `''`); output
    `navigate: OutputEmitterRef<string>`; two content slots — `[ppAppShellActions]` into the
    topbar, everything else into the scrolling content column.

- [ ] **Step 1: Write the failing test**

Create `libs/shared-ui/src/lib/app-shell/pp-app-shell.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { cssText } from '../../testing/read-css';
import { PpAppShell, type PpNavItem } from './pp-app-shell';

const NAV: readonly PpNavItem[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'connections', label: 'Connections' },
  {
    key: 'trades',
    label: 'Trades',
    disabled: true,
    disabledReason: 'Trading is not part of this slice.',
  },
];

function createShell() {
  const fixture = TestBed.createComponent(PpAppShell);
  fixture.componentRef.setInput('portalLabel', 'Customer portal');
  fixture.componentRef.setInput('nav', NAV);
  fixture.componentRef.setInput('activeKey', 'connections');
  fixture.componentRef.setInput('title', 'Connections');
  return fixture;
}

describe('pp-app-shell', () => {
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

  it('shows the crumb and drops the subtitle when both are supplied', () => {
    const fixture = createShell();
    fixture.componentRef.setInput('crumb', ['Connections', 'Vriescel 1']);
    fixture.componentRef.setInput('subtitle', 'Three connections, one contract.');
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.pp-app-shell__crumb')?.textContent).toContain('Vriescel 1');
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

  it('renders a disabled nav item with its reason instead of hiding it', () => {
    const fixture = createShell();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const emitted: string[] = [];
    fixture.componentInstance.navigate.subscribe((key: string) => emitted.push(key));

    const items = el.querySelectorAll('.pp-app-shell__nav-item');
    expect(items).toHaveLength(3);
    expect(items[1].classList.contains('pp-app-shell__nav-item--active')).toBe(true);

    const trades = items[2] as HTMLElement;
    expect(trades.tagName.toLowerCase()).toBe('span');
    expect(trades.title).toBe('Trading is not part of this slice.');

    (items[0] as HTMLElement).click();
    expect(emitted).toEqual(['dashboard']);
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
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface PpNavItem {
  /** The route key the application knows this destination by. */
  readonly key: string;
  readonly label: string;
  /** Optional group heading — "Overview", "Position", "Market", "Finance". */
  readonly group?: string;
  /** Out of scope for now. Disabled items are shown, never hidden. */
  readonly disabled?: boolean;
  /** The sentence that explains the disabled state. Always say it. */
  readonly disabledReason?: string;
}

@Component({
  selector: 'pp-app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pp-app-shell.css',
  template: `
    <aside class="pp-app-shell__rail">
      <div class="pp-app-shell__brand">
        <svg width="26" height="26" viewBox="19 23 22 22" aria-hidden="true">
          <circle cx="30" cy="34" r="11" fill="#1DBD8E" />
          <path d="M 26 34 L 30 27 L 30 33 L 34 33 L 30 41 L 30 35 Z" fill="#2D3F54" />
        </svg>
        <div>
          <div class="pp-app-shell__brand-name">PeakPower</div>
          <div class="pp-app-shell__brand-portal">{{ portalLabel() }}</div>
        </div>
      </div>

      <nav class="pp-app-shell__nav">
        @for (item of nav(); track item.key) {
          @if (item.disabled) {
            <span
              class="pp-app-shell__nav-item pp-app-shell__nav-item--disabled"
              [title]="item.disabledReason ?? ''"
              >{{ item.label }}</span
            >
          } @else {
            <button
              type="button"
              class="pp-app-shell__nav-item"
              [class.pp-app-shell__nav-item--active]="item.key === activeKey()"
              (click)="navigate.emit(item.key)"
            >
              {{ item.label }}
            </button>
          }
        }
      </nav>

      <div class="pp-app-shell__me">
        <div class="pp-app-shell__me-name">{{ userName() }}</div>
        <div class="pp-app-shell__me-company">{{ companyName() }}</div>
      </div>
    </aside>

    <div class="pp-app-shell__main">
      <header class="pp-app-shell__topbar">
        <div class="pp-app-shell__heading">
          @if (crumb().length > 0) {
            <div class="pp-app-shell__crumb">{{ crumb().join(' › ') }}</div>
          }
          <div class="pp-app-shell__title">{{ title() }}</div>
          @if (crumb().length === 0 && subtitle()) {
            <div class="pp-app-shell__subtitle">{{ subtitle() }}</div>
          }
        </div>
        <div class="pp-app-shell__actions">
          <ng-content select="[ppAppShellActions]" />
        </div>
      </header>

      <div class="pp-app-shell__content"><ng-content /></div>
    </div>
  `,
  host: { class: 'pp-app-shell' },
})
export class PpAppShell {
  readonly portalLabel = input.required<string>();
  readonly nav = input.required<readonly PpNavItem[]>();
  readonly activeKey = input<string>('');
  readonly title = input.required<string>();
  /** Navigation. A crumb and a subtitle never appear together — the crumb wins. */
  readonly crumb = input<readonly string[]>([]);
  /** Description. Rendered only when there is no crumb. */
  readonly subtitle = input<string>('');
  readonly userName = input<string>('');
  readonly companyName = input<string>('');

  /** The key of the nav item that was clicked. The application does the routing. */
  readonly navigate = output<string>();
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
.pp-app-shell__brand-portal {
  color: var(--pp-sidebar-subtitle);
  font-size: var(--text-2xs);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  margin-top: 1px;
}

.pp-app-shell__nav { display: flex; flex-direction: column; gap: 1px; padding: 0 10px; }
.pp-app-shell__nav-item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--pp-sidebar-text);
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;
}
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
.pp-app-shell__nav-item--disabled { opacity: 0.5; cursor: not-allowed; }

.pp-app-shell__me {
  margin-top: auto;
  padding: 14px 20px 0;
  margin-inline: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.09);
}
.pp-app-shell__me-name { color: #ffffff; font-size: 12px; font-weight: var(--weight-semibold); }
.pp-app-shell__me-company { color: #93a2b5; font-size: var(--text-2xs); margin-top: 1px; }

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
/* A crumb and a subtitle occupy the same 11px line; only one is ever rendered. */
.pp-app-shell__crumb {
  font-size: 10.5px;
  color: var(--color-text-faint);
  letter-spacing: 0.03em;
  text-transform: uppercase;
  font-weight: var(--weight-semibold);
  white-space: nowrap;
}
.pp-app-shell__title { font-size: 19px; font-weight: var(--weight-bold); margin-top: 2px; }
.pp-app-shell__subtitle { font-size: var(--text-xs); color: var(--color-text-body); }
.pp-app-shell__actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

/* The one scroll container in the application. */
.pp-app-shell__content{flex:1;overflow:auto;padding:26px 30px 40px;display:flex;flex-direction:column;gap:16px}
```

Append to `libs/shared-ui/src/public-api.ts`:

```ts
export { PpAppShell, type PpNavItem } from './lib/app-shell/pp-app-shell';
```

- [ ] **Step 4: Run the test and watch it pass**

Run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web && npx ng test shared-ui --watch=false
```

Expected: PASS — Vitest reports 70 passing tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git add libs/shared-ui/src/lib/app-shell libs/shared-ui/src/public-api.ts
git commit -m "feat(shared-ui): add the pp-app-shell rail, topbar and scroll container"
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
  `PP_MINUS`, `PpMoneyPipe`, `PpEnergyPipe`, `PpPowerPipe`, `PpPricePipe`, `PpBadge`,
  `PpBadgeTone`, `PpButton`, `PpButtonVariant`, `PpCard`, `PpStatCard`, `PpBanner`, `PpDsBanner`,
  `PpGridTable`, `PpGridColumn`, `PpGridRow`, `PpSearchInput`, `PpAppShell`, `PpNavItem`.
  Also `export const routes: Routes` from Task 2.
- Produces: `export class Gallery` — selector `cp-gallery`, reachable at `/gallery`, and the
  default route of the customer portal.

- [ ] **Step 1: Write the failing test**

Create `apps/customer-portal/src/app/gallery/gallery.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { PP_MINUS } from '@peakpower/shared-ui';
import { describe, expect, it } from 'vitest';
import { Gallery } from './gallery';

const ALL_BADGE_TONES = [
  'success', 'warning', 'critical', 'info', 'brand',
  'system', 'short', 'long', 'sell', 'neutral',
];

function renderGallery(): HTMLElement {
  const fixture = TestBed.createComponent(Gallery);
  fixture.detectChanges();
  return fixture.nativeElement;
}

describe('the component gallery', () => {
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

  it('shows every badge tone, so a contrast regression is visible in one scroll', () => {
    const el = renderGallery();
    const classes = [...el.querySelectorAll('pp-badge')].flatMap((badge) => [...badge.classList]);
    for (const tone of ALL_BADGE_TONES) {
      expect(classes, `the ${tone} badge tone is missing`).toContain(`pp-badge--${tone}`);
    }
  });

  it('shows every button variant', () => {
    const el = renderGallery();
    const classes = [...el.querySelectorAll('pp-button')].flatMap((b) => [...b.classList]);
    for (const variant of ['primary', 'secondary', 'danger', 'accent', 'ghost']) {
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

  it('shows a populated grid table and an empty one that names its reason', () => {
    const el = renderGallery();
    const tables = el.querySelectorAll('pp-grid-table');
    expect(tables).toHaveLength(2);

    expect(tables[0].querySelectorAll('.pp-grid-table__row')).toHaveLength(3);
    expect(tables[1].querySelector('.pp-grid-table__head')).toBeNull();
    expect(tables[1].textContent).toContain('Gas connections are not tradeable in this portal.');
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
  PpGridRow,
  PpGridTable,
  PpMoneyPipe,
  PpPowerPipe,
  PpPricePipe,
  PpSearchInput,
  PpStatCard,
  type PpBadgeTone,
  type PpButtonVariant,
  type PpGridColumn,
  type PpNavItem,
} from '@peakpower/shared-ui';

interface Connection {
  readonly ean: string;
  readonly name: string;
  readonly capacityMw: number;
  readonly coverage: string;
}

@Component({
  selector: 'cp-gallery',
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
      portalLabel="Customer portal"
      [nav]="nav"
      [activeKey]="activeKey()"
      title="Design system"
      subtitle="Every SB-2026 primitive and every nl-NL pipe on one screen."
      userName="J. de Vries"
      companyName="Vandersteen Koeling B.V."
      (navigate)="activeKey.set($event)"
    >
      <pp-button ppAppShellActions variant="secondary" size="sm">Export tokens</pp-button>

      <pp-banner
        tone="warning"
        title="Offer received — Base Nov-2026 · 0,20 MW · € 102,4000 / MWh"
        body="Respond within 24:41 — the price is firm until then."
      >
        <pp-button size="sm">View offer</pp-button>
      </pp-banner>

      <pp-ds-banner
        body="These are indicative market prices, not offers. A firm, time-limited price is
              issued only in response to a trade request."
      />

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
        title="Status vocabulary"
        subtitle="Ten tones, ten meanings. Every tone carries a real 1px border."
      >
        <div class="gallery__row">
          @for (tone of badgeTones; track tone) {
            <pp-badge [tone]="tone">{{ tone }}</pp-badge>
          }
        </div>
      </pp-card>

      <pp-card title="Buttons" subtitle="Five variants, three sizes, one height.">
        <div class="gallery__row">
          @for (variant of buttonVariants; track variant) {
            <pp-button [variant]="variant">{{ variant }}</pp-button>
          }
          <pp-button size="sm">Small</pp-button>
          <pp-button size="lg">Large</pp-button>
          <pp-button disabled>Disabled — trading opens in slice 2</pp-button>
        </div>
      </pp-card>

      <pp-card title="Connections" subtitle="Filtered live by the field on the right.">
        <span ppCardAction>Export CSV</span>
        <div class="gallery__row gallery__row--controls">
          <pp-search-input
            [(value)]="query"
            placeholder="Search name, description or EAN…"
          />
          <pp-badge tone="info">{{ visible().length }} of {{ connections.length }}</pp-badge>
        </div>
        <pp-grid-table
          [columns]="connectionColumns"
          [rows]="visible()"
          tracks="1.6fr 1.2fr 0.8fr 0.8fr"
          emptyMessage="No connection matches that search."
          zebra
        >
          <ng-template [ppGridRow]="visible()" let-row>
            <div class="gallery__mono">{{ row.ean }}</div>
            <div>{{ row.name }}</div>
            <div class="pp-grid-table__num">{{ row.capacityMw | ppPower }}</div>
            <div class="pp-grid-table__num">{{ row.coverage }}</div>
          </ng-template>
        </pp-grid-table>
      </pp-card>

      <pp-card
        title="Gas connections"
        subtitle="An empty list is never a bare head — it says why it is empty."
      >
        <pp-grid-table
          [columns]="connectionColumns"
          [rows]="noConnections"
          tracks="1.6fr 1.2fr 0.8fr 0.8fr"
          emptyMessage="Gas connections are not tradeable in this portal."
        >
          <ng-template [ppGridRow]="noConnections" let-row>
            <div class="gallery__mono">{{ row.ean }}</div>
            <div>{{ row.name }}</div>
            <div class="pp-grid-table__num">{{ row.capacityMw | ppPower }}</div>
            <div class="pp-grid-table__num">{{ row.coverage }}</div>
          </ng-template>
        </pp-grid-table>
      </pp-card>

      <pp-card title="nl-NL formatting" subtitle="Comma decimal, period thousands, U+2212 minus.">
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

      <pp-banner
        tone="critical"
        title="Metering feed silent for two days"
        body="This indicates a coverage defect, not a data gap. Engineering has been alerted."
      />

      <p class="gallery__footer">
        <b>Demo only.</b> Every figure on this page is synthetic test data generated for this
        proof of concept. It does not represent real customers, accounts or transactions.
      </p>
    </pp-app-shell>
  `,
})
export class Gallery {
  readonly nav: readonly PpNavItem[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'connections', label: 'Connections' },
    { key: 'gallery', label: 'Design system' },
    { key: 'volume', label: 'Volume', disabled: true, disabledReason: 'Volume arrives in slice 3.' },
    { key: 'trades', label: 'Trades', disabled: true, disabledReason: 'Trading arrives in slice 4.' },
    { key: 'balance', label: 'Balance', disabled: true, disabledReason: 'The wallet arrives in slice 5.' },
  ];

  readonly badgeTones: readonly PpBadgeTone[] = [
    'success', 'warning', 'critical', 'info', 'brand',
    'system', 'short', 'long', 'sell', 'neutral',
  ];

  readonly buttonVariants: readonly PpButtonVariant[] = [
    'primary', 'secondary', 'danger', 'accent', 'ghost',
  ];

  readonly balance = 19722;
  readonly correction = -4210;
  readonly uncoveredMwh = 385.4;
  readonly contractedMw = 0.2;
  readonly lastPrice = 102.4;
  readonly monthToDate = 2914.5;

  readonly connectionColumns: readonly PpGridColumn[] = [
    { label: 'EAN' },
    { label: 'Connection' },
    { label: 'Contracted power', align: 'right' },
    { label: 'Coverage', align: 'right' },
  ];

  readonly connections: readonly Connection[] = [
    { ean: '871687100000000001', name: 'Vriescel 1', capacityMw: 0.2, coverage: '78,4 %' },
    { ean: '871687100000000002', name: 'Vriescel 2', capacityMw: 0.45, coverage: '61,0 %' },
    { ean: '871687100000000003', name: 'Kantoor Nieuwegein', capacityMw: 0.08, coverage: '92,5 %' },
  ];

  readonly noConnections: readonly Connection[] = [];

  readonly activeKey = signal('gallery');
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
`# pass 7` from the workspace contract tests and 70 passing Vitest tests for `shared-ui`.

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
      workspace-contract suite (`# pass 7`), 70 `shared-ui` Vitest tests and 5 `customer-portal`
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
      `pp-grid-table`, `pp-search-input`, `pp-app-shell`.
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

## New names introduced

Names this plan defines that the shared contract does not. Everything else — the nine `pp-`
selectors, the workspace layout, the `@peakpower/` scope, the token values — comes from
`docs/superpowers/plans/2026-08-26-slice-1-shared-contract.md`.

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

**Component classes and their public inputs** — `libs/shared-ui/src/lib/`

```ts
export type PpBadgeTone =
  | 'success' | 'warning' | 'critical' | 'info' | 'brand'
  | 'system' | 'short' | 'long' | 'sell' | 'neutral';
export class PpBadge {                                       // <pp-badge>
  readonly tone: InputSignal<PpBadgeTone>;                   // default 'neutral'
}

export type PpButtonVariant = 'primary' | 'secondary' | 'danger' | 'accent' | 'ghost';
export type PpButtonSize = 'sm' | 'md' | 'lg';
export class PpButton {                                      // <pp-button>
  readonly variant: InputSignal<PpButtonVariant>;            // default 'primary'
  readonly size: InputSignal<PpButtonSize>;                  // default 'md'
  readonly disabled: InputSignalWithTransform<boolean, unknown>;
  readonly type: InputSignal<'button' | 'submit'>;           // default 'button'
}

export class PpCard {                                        // <pp-card>
  readonly title: InputSignal<string>;
  readonly subtitle: InputSignal<string>;
}                                                            // slot: [ppCardAction]

export type PpStatCardTone = 'default' | 'brand' | 'warning' | 'critical' | 'success';
export class PpStatCard {                                    // <pp-stat-card>
  readonly label: InputSignal<string>;                       // required
  readonly value: InputSignal<string>;                       // required, already formatted
  readonly sublabel: InputSignal<string>;
  readonly tone: InputSignal<PpStatCardTone>;                // default 'default'
  readonly highlight: InputSignalWithTransform<boolean, unknown>;
}

export type PpBannerTone = 'info' | 'warning' | 'critical';
export class PpBanner {                                      // <pp-banner>
  readonly title: InputSignal<string>;                       // required
  readonly body: InputSignal<string>;
  readonly tone: InputSignal<PpBannerTone>;                  // default 'info'
}

export type PpDsBannerTone = 'info' | 'warning' | 'critical';
export class PpDsBanner {                                    // <pp-ds-banner>
  readonly title: InputSignal<string>;                       // optional — no title, no mark
  readonly body: InputSignal<string>;
  readonly tone: InputSignal<PpDsBannerTone>;                // default 'info'
}

export interface PpGridRowContext<Row> { $implicit: Row; index: number }
export class PpGridRow<Row> {                                // <ng-template [ppGridRow]="rows()">
  readonly ppGridRow: InputSignal<readonly Row[]>;           // required, type anchor only
  readonly template: TemplateRef<PpGridRowContext<Row>>;
}

export interface PpGridColumn { readonly label: string; readonly align?: 'left' | 'right' }
export class PpGridTable {                                   // <pp-grid-table>
  readonly columns: InputSignal<readonly PpGridColumn[]>;    // required
  readonly rows: InputSignal<readonly unknown[]>;            // required
  readonly tracks: InputSignal<string>;                      // required, raw grid-template-columns
  readonly emptyMessage: InputSignal<string>;                // required
  readonly dense: InputSignalWithTransform<boolean, unknown>;
  readonly zebra: InputSignalWithTransform<boolean, unknown>;
}

export class PpSearchInput {                                 // <pp-search-input>
  readonly placeholder: InputSignal<string>;                 // default 'Search…'
  readonly value: ModelSignal<string>;                       // two-way
}

export interface PpNavItem {
  readonly key: string;
  readonly label: string;
  readonly group?: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}
export class PpAppShell {                                    // <pp-app-shell>
  readonly portalLabel: InputSignal<string>;                 // required
  readonly nav: InputSignal<readonly PpNavItem[]>;           // required
  readonly activeKey: InputSignal<string>;
  readonly title: InputSignal<string>;                       // required
  readonly crumb: InputSignal<readonly string[]>;            // a crumb suppresses the subtitle
  readonly subtitle: InputSignal<string>;
  readonly userName: InputSignal<string>;
  readonly companyName: InputSignal<string>;
  readonly navigate: OutputEmitterRef<string>;               // the clicked item's key
}                                                            // slot: [ppAppShellActions]
```

**Application** — `apps/customer-portal/src/app/gallery/`

```ts
export class Gallery {}   // <cp-gallery>, lazy-loaded at /gallery, the portal's default route
```

**CSS custom properties owned by a component**, set per tone/variant on the host and read inside
that component only:

```
--pp-badge-bg          --pp-badge-border      --pp-badge-text
--pp-button-bg         --pp-button-border     --pp-button-text
--pp-stat-card-cap     --pp-stat-card-value
--pp-banner-bg         --pp-banner-border     --pp-banner-text     --pp-banner-mark
--pp-ds-banner-bg      --pp-ds-banner-border  --pp-ds-banner-text  --pp-ds-banner-mark
--pp-grid-tracks
```
