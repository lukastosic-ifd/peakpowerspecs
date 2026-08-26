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
