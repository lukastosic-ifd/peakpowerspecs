# Plan 3 — The business switcher (web)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the customer portal's rail foot from a label into a control that switches the
signed-in person between the businesses they are a member of — and, far harder, make every
session-scoped cache in the portal notice that the business moved. Five defects stand between
today's code and a working switch, all five confirmed against the source: both root stores reset
on a **boolean**, so replacing the token in place recomputes `true -> true` and propagates
nothing; each memoises a `shareReplay` in a plain class field, so clearing the signal replays the
**old** business with no HTTP call; `CompanyStore` exposes no reset at all; the rail's connection
resource is keyed on that same boolean; and nothing is cancellable, so an in-flight `GET` issued
for the old business can land after the switch and write into a just-cleared store.

**Architecture:** One key, one reset, one generation counter. `AccessTokenStore` gains
`activeCustomerId` — the account's `customerId`, a **string**, so a token refresh for the same
business does not propagate and a switch does. `CompanyStore` and `EntitlementStore` key their
session effects on that string instead of `isSignedIn()`, and each effect **resets first, then
loads**: `reset()` bumps a generation counter, nulls the signal **and** the memoised
`shareReplay`, and every `tap` that writes back compares the generation it was issued under with
the current one, dropping a stale answer on the floor. `CustomerNavService`'s `rxResource` is
re-keyed from a boolean onto the business id. The rail foot becomes a real control in
`PpAppShell` — a trigger plus an upward-opening menu, rendered only when there is more than one
business to switch to — and a new `BusinessSwitcher` service does the round trip:
`POST /auth/active-business`, swap the token, navigate to `/dashboard`. Returning to the
dashboard rather than re-resolving the current route is deliberate: `/connections/<id>` in the
old business is a 404 in the new one.

**Tech Stack:** Angular 22.1.3, zoneless, signals · TypeScript 6.0.3 · Vitest 4.1.11 via
`@angular/build:unit-test` · Node 24.15.0 · npm 11.12.1 · rxjs 7.8.2 · ng-packagr 22.1.1 ·
openapi-typescript 7.13.0 · jsdom 30.0.1

**Spec:** `docs/superpowers/specs/2026-09-10-multi-business-membership-design.md` (§7 is this
plan's scope; §5 is the endpoint it consumes)
**Shared contract:** `docs/superpowers/plans/2026-09-10-membership-shared-contract.md`

---

## Global Constraints

### Repositories

```
platform = /Users/thinhhuynh/PeakPower/peakpower-platform
web      = /Users/thinhhuynh/PeakPower/peakpower-web
specs    = /Users/thinhhuynh/PeakPower/peakpowerspecs
```

Every task in this plan commits in **`peakpower-web`**. Nothing here touches the platform or the
specs repository. Always `git -C <path>` and absolute paths — the shell working directory is not
stable between calls in this environment.

### What the shared contract fixes, quoted verbatim

Contract §0: *"This file is **normative** for everything that crosses a plan boundary… A plan may
not redefine anything here. Where a plan disagrees with this file, this file wins and the plan is
wrong."*

Contract §1 — versions verified 2026-09-10:

| | |
| --- | --- |
| .NET | `net10.0` |
| Microsoft.EntityFrameworkCore | `10.0.11` |
| Npgsql.EntityFrameworkCore.PostgreSQL | `10.0.3` |
| PostgreSQL | 17 |
| Angular | 22, zoneless, signals |

Contract §2 — the web commands:

```bash
# web — run these individually; `npm run test` also runs verify:clients,
# which fails whenever the platform's OpenAPI has moved and the client has not been regenerated
npx ng test shared-ui       --watch=false
npx ng test customer-portal --watch=false
npx ng test employee-portal --watch=false
npm run generate:clients    # after ANY platform contract change
```

Contract §2, both warnings, verbatim:

> ⚠ **rtk truncates and sometimes fabricates shell output.** Redirect to a file and read the file
> back before concluding anything. Never conclude from a bare `grep`/`find`/`ls` that scrolled.

> ⚠ **Verify by mutation.** A green test is not evidence. Break the thing under test on purpose,
> predict the exact failure, run it, confirm it failed as predicted, restore, prove the restore
> with `diff`. Report the mutation output. This is the house standard and a review will reject
> work without it.

Contract §3 — naming, normative. The rows this plan is bound by:

| Thing | Name | Why not the obvious name |
| --- | --- | --- |
| The wire field | **`membershipRole`** | `role` is already **job title** on the account record, and `[F01-R13]` says it is *"descriptive only… never checked"* |
| Role values | `'admin'`, `'trader'`, `'viewer'` | ⚠ `trader`/`viewer` collide with the **employee** vocabulary `[F13-R12]`. Accepted; any code naming both spells `membershipRole` and `employeeRole` explicitly |

Contract §8 — the wire contract this plan consumes, verbatim:

```ts
// CurrentAccountResponse — LOSES isAdmin, GAINS two fields. NOT purely additive.
{
  accountId: string; customerId: string;
  firstName: string; lastName: string; email: string;
  membershipRole: 'admin' | 'trader' | 'viewer';
  memberships: { customerId: string; tradeName: string; membershipRole: string }[];
}
```

| Route | Method | Auth | Owner |
| --- | --- | --- | --- |
| `/api/v1/auth/me` | GET | authenticated | plan 2 |
| `/api/v1/auth/active-business` | POST `{ customerId }` | authenticated | plan 2 |
| `/api/v1/company/memberships` | GET | `CompanyAdmin` | plan 4 |
| `/api/v1/company/memberships/{accountId}` | PATCH `{ membershipRole }` | `CompanyAdmin` | plan 4 |
| `/api/v1/company/memberships/{accountId}` | DELETE (⚠ SQL is an `UPDATE`) | `CompanyAdmin` | plan 4 |
| `/api/v1/company/invitations` | POST `{ email, membershipRole }` → **202 always** | `CompanyAdmin` | plan 4 |
| `/api/v1/company/invitations/accept` | POST `{ token }` | **anonymous** | plan 4 |

> ⚠ No auth or company route is inside the frozen slice-2 sections (§8.4, §9, §10 — consumption,
> webhooks, employee data health). The published customer OpenAPI regenerates normally, and
> `npm run generate:clients` must run in the web repo after any of these land.

Contract §11 — the probe this plan owns, verbatim:

| Probe | Plan | Must prove |
| --- | --- | --- |
| **No unmount** | **3** | **A business switch refreshes data without rebuilding the shell** |

### What this plan owns, and what it must not touch

Contract §17-equivalent (the §0 table) assigns plan 3: *"Rail control, store invalidation,
generation counter"*, repo **web**.

It may **read** contract §3, §7 and §8 and must not restate them differently. It declares **no**
endpoint, **no** migration, **no** C# type, and **no** route table entry. `/company/memberships`
and `/company/invitations` are **plan 4's** and appear nowhere in this plan — not in the client,
not in a screen, not in a type.

It **does** repair the web repo's own compile breaks caused by contract §8's non-additive change
to `CurrentAccountResponse`, because plan 2 is platform-only and plan 4 comes after: nobody else
is in this repository between plan 2 landing and plan 3 starting. See Deviation D1.

### Design tokens — the only ones any CSS in this plan may name

```
--text-2xs --text-xs --text-sm --text-base --text-md
--pp-text-heading --pp-text-body --pp-text-faint
--pp-border --pp-surface --font-mono
```

plus the rail's own palette, which `pp-app-shell.css` already uses and which the new rules extend:
`--pp-sidebar-bg`, `--pp-sidebar-text`, `--pp-sidebar-text-active`, `--pp-sidebar-active-bg`,
`--pp-blue-300`, `--radius-sm`, `--radius-md`, `--weight-semibold`, `--tracking-eyebrow`.

⚠ **A hardcoded hex duplicating an existing token is drift.** `apps/customer-portal/src/app/shared/design-tokens.spec.ts`
fails the build on a `var(--…)` naming a property nothing declares, and
`libs/shared-ui/src/lib/app-shell/pp-app-shell.colors.spec.ts` asserts `color:` is a token and not
a hex, rule by rule. The white- and black-alpha `rgba()` literals the new rules use are the ones
`pp-app-shell.css` already ships (`rgba(255,255,255,0.06)`, `rgba(255,255,255,0.09)`,
`rgba(255,255,255,0.12)`) — an alpha over the rail is not a palette colour and there is no token
for one.

### Two Angular rules that will cost an afternoon each

⚠ **Backticks inside an Angular inline template literal close the template early.** `PpAppShell`'s
template is a backtick literal. Nothing added to it may contain a backtick — not in markup, not in
a comment, not in an interpolation. Where a class member near the template needs string
composition, this plan writes `'a' + b` rather than a template string, for the same reason.

⚠ **`ruleBody()` throws when a selector matches more than one rule.** `.pp-app-shell__account`
already has a rule and `pp-app-shell.spec.ts` reads it with `ruleBody`. The `position: relative`
this plan needs goes **inside that rule**; a second `.pp-app-shell__account { … }` block makes the
existing test throw `Selector ".pp-app-shell__account" matches more than one rule` rather than
fail on an assertion.

### Formatting rules that outlive this plan

- Dates are **en-US**. Dutch **number** formatting (`1.234,56`, U+2212 for minus) must never
  change. Nothing in this plan formats a number or a date; nothing in it may start.
- Every design-system selector is prefixed `pp-`.

### Testing

| Layer | Tooling |
| --- | --- |
| Design system | `npx ng test shared-ui --watch=false` — vitest + jsdom, `TestBed`, `cssText`/`ruleBody` |
| Customer portal | `npx ng test customer-portal --watch=false` — **also runs `libs/api-client-customer/src/**/*.spec.ts`** (see `angular.json`) |
| Workspace contract | `npm run test:workspace` — `tools/*.test.mjs`, including the client-drift guard |

`TestBed.tick()` is how a spec flushes a zoneless effect; `fixture.detectChanges()` is how it
flushes a component. Both appear in existing specs and neither is optional here.

⚠ **`npm test` and `npm run test:workspace` need a `peakpower-platform` checkout**, because
`tools/verify-clients.test.mjs` regenerates both committed clients and diffs them byte-for-byte.
In a worktree the platform is not a sibling, so set the path explicitly:

```bash
PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform npm test
```

⚠ **Run `npx ng build shared-ui` after any change to `public-api.ts`.** A duplicate or malformed
export compiles and leaves the whole suite green; only the library build catches it.

### Commands

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform npm run generate:clients
npx ng test shared-ui       --watch=false
npx ng test customer-portal --watch=false
npx ng test employee-portal --watch=false
npx ng build shared-ui
npx ng build customer-portal
PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform npm run test:workspace
```

---

## Deviations from the shared contract, and open items

The contract is normative and this plan follows it. Four places needed a decision it does not
make. All four are here so a reviewer finds them in one place rather than scattered through
twelve tasks.

### D1 — Nobody is assigned the web repo's repair of contract §8's non-additive change

Contract §8 says `CurrentAccountResponse` **"LOSES isAdmin, GAINS two fields. NOT purely
additive."** Contract §0's table gives `/auth/me` to **plan 2**, whose repo is **platform**. The
web repo type-checks against the committed
`libs/api-client-customer/src/generated/customer-schema.d.ts`, so the moment that file is
regenerated, fifteen customer-portal files stop compiling and one production reader —
`apps/customer-portal/src/app/features/entitlements/entitlements-page.ts:166`,
`readonly canChange = computed(() => this.auth.account()?.isAdmin === true);` — has no field to
read. No plan owns that repair.

**This plan takes it** (Tasks 1, 2 and 3), because plan 3 is the first web plan after plan 2 and a
repository that does not compile cannot receive a switcher. Contract §13.3 has since made that
ownership explicit and extended it to the employee portal, which is Task 3. It is recorded rather
than absorbed silently, because it is scope contract §0's table did not grant.

### D2 — The contract does not name the response of `POST /auth/active-business`

Contract §8 fixes the request body (`{ customerId }`), the auth (authenticated) and the owner
(plan 2). It does not say what comes back. Design §5 does say what the endpoint **does**:
*"verifies membership, rotates the refresh token to the new business, writes
`last_active_business_id`, **re-mints**."* Re-minting produces an access token and an account, so
the answer must carry both.

**This plan types the response as `SignInResponse`** — `{ accessToken, expiresAt, account }`, the
exact shape `/auth/sign-in` and `/auth/refresh` already return and the exact pair
`AccessTokenStore.set(token, account)` consumes. Task 8 step 1 **verifies that assumption against
the regenerated schema before any code depends on it**, and stops if it is wrong. If plan 2 emits
a differently *named* schema with that shape, nothing here changes; if it emits a different
*shape*, this is the line that moves and the contract owner should be told.

### D3 — Whether the switch rotates the refresh cookie is design-normative and the contract is silent

Design §5: *"rotates the refresh token to the new business"*, and §4.5: *"a session belongs to a
business"*. A rotation the browser cannot see is not a rotation, so the request must carry the
`pp_refresh` cookie: `setActiveBusiness` sets `withCredentials: true`, joining sign-in, refresh
and sign-out as the **fourth** and only other route in the client that does. Contract §8 does not
mention it. Task 8 pins it with a test, and pins the counterpart — an ordinary tenant-scoped GET
must still be `false` — because a blanket opt-in would pass the first assertion and fail the
second.

### D4 — `CompanyAccountDto.isAdmin` and the employee client are plan 3's, by contract §13.3

⚠ **This deviation has been rewritten. It used to say the opposite of what it says now**, and the
old text is quoted here so nobody restores it from memory: it read that these two wire contracts
were *"read by this repository and by no plan"*, that contract §8 does not list `CompanyAccountDto`
as changing *"so this plan assumes it does not"*, and that if the employee client moved *"this plan
stops rather than inventing an employee-side role model."* Contract §13.3 struck all three.

What the contract actually rules: plan 1 removes `isAdmin` from **four** wire contracts, so **both**
OpenAPI documents move and both regenerated clients stop compiling, and *"plan 3 owns every
resulting repair"* — naming, for the employee portal, *"three production files, three specs, the
employee api-client spec and the e2e fixture — **unowned by any plan as authored**, and inside
`npm run test`."* It also rules that Task 1's two gates *"must **expect** those, not halt on them."*

So both halves are in scope and each has a task:

- `libs/api-client-customer/src/generated/customer-schema.d.ts` `CompanyAccountDto.isAdmin`
  (`/company/accounts`), read at `apps/customer-portal/src/app/features/company/company-page.ts:110`
  and in its spec at `:46`, `:101`, `:113`. Plan 1's own Deviation D6 lists this DTO by name and by
  line (`PortalContracts.cs:35-45`). **Task 2** repairs it — contract §13.3 calls the production
  edit *"a one-line `person.membershipRole === 'admin'`, later replaced wholesale by plan 4"*.
- `libs/api-client-employee/src/generated/employee-schema.d.ts`, whose `isAdmin` sits in `AccountDto`
  (line `399`), `CreateAccountRequest` (`447`) and `UpdateAccountRequest` (`729`), and is read at
  `apps/employee-portal/src/app/features/customers/account-form-page.ts:123,184,299,312,325`,
  `.../customer-detail-page.ts:281,407,415` and `.../customer-wizard-page.ts:68,398,549,565,644,859`,
  plus `.../account-form-page.spec.ts`, `.../customer-detail-page.spec.ts`,
  `.../customer-wizard-page.spec.ts`, `libs/api-client-employee/src/lib/employee-api.client.spec.ts:99`
  and `e2e/fixtures/api.ts:29,156,163`. **Task 3** repairs it, and the repair is not a comparison:
  a boolean becomes a three-value control, because plan 1's validators refuse anything that is not
  `admin`, `trader` or `viewer`.

`npm run generate:clients` regenerates **both** clients — `tools/openapi-clients.mjs` loops a frozen
`CLIENTS` registry — and `tools/verify-clients.test.mjs` fails the workspace suite if either
committed file is stale, so plan 3 could not have regenerated one and left the other even if the
contract had let it.

⚠ **What remains a deviation is the scope, not the ownership.** Contract §0's table gives plan 3
*"rail control, store invalidation, generation counter"*. Two of this plan's twelve tasks now
repair somebody else's wire change instead, one of them in a portal this plan's own "must not
touch" list named. That is recorded here rather than absorbed silently, and it is why the File
Structure table above lists Task 3's eleven files by name.

### Open items this plan records rather than closes

1. **A refused switch is silent.** `POST /auth/active-business` answering 403 — the person is no
   longer a member of the business the menu offered — leaves the menu closed, the rail unchanged
   and nothing said. Design §8 puts no refusal copy in scope and design §5's named terminal
   answers are all plan 2's; inventing a banner here would be inventing product. `BusinessSwitcher`
   swallows the error deliberately and says so in its own doc comment.
2. **The rail foot names the LEGAL name and the menu names TRADE names.** The foot's `org` line is
   `CompanyStore.profile()?.legalName`; design §5 makes `memberships[]` carry `tradeName`. Both
   are as specified, and a reader switching from "Vandersteen Koeling B.V." to a menu row reading
   "Zaanse Koeling" sees two spellings of one company. Recorded, not resolved: changing either
   would contradict a document.
3. **`[OQ-105]`** — the back office has no membership screen at all. Untouched here; recorded so
   it is not mistaken for something plan 3 dropped.

---

## Domain terms used in this plan

- **Business** — one customer company. The design's word for the thing being switched between;
  `customerId` is its id on the wire and in every tenancy control.
- **Membership** — `(account, business, role)`. One login may hold several. Design §3.1.
- **`membershipRole`** — `'admin' | 'trader' | 'viewer'`, the wire spelling of a membership's
  role. ⚠ Never `role`: that word is **job title** on the account record `[F01-R13]`, and
  `trader`/`viewer` also name **employee** roles `[F13-R12]`.
- **The rail** — the dark left-hand navigation column, `PpAppShell`'s `<aside>`. Its foot carries
  the signed-in identity, and in this plan becomes the switcher.
- **Session-scoped store** — `CompanyStore`, `EntitlementStore`: a root singleton holding one
  business's data behind a signal plus a memoised `shareReplay`.
- **Generation** — a monotonically increasing counter a store bumps on every reset. A response
  compares the generation it was issued under against the current one; a mismatch means the
  session has moved on and the answer is dropped.
- **Bare mode** — `PpAppShell.bare`, which drops the rail and topbar while leaving the projected
  routed view mounted. It is why the outlet lives outside every condition, and it is the
  mechanism the no-unmount probe leans on.

---

## File Structure

### `/Users/thinhhuynh/PeakPower/peakpower-web`

| File | Responsibility |
| --- | --- |
| `libs/api-client-customer/src/generated/customer-schema.d.ts` | Modify (regenerated): `CurrentAccountResponse` loses `isAdmin`, gains `membershipRole` and `memberships[]`; `/auth/active-business` appears |
| `libs/api-client-employee/src/generated/employee-schema.d.ts` | Modify (regenerated): `AccountDto`, `CreateAccountRequest` and `UpdateAccountRequest` each lose `isAdmin` and gain `membershipRole` (a `string`). Task 1 Step 4 EXPECTS this diff to be non-empty; Task 3 repairs what it breaks |
| `libs/api-client-customer/src/lib/customer-api.types.ts` | Modify: add `Membership` and `MembershipRoleValue`, both derived off `CurrentAccount` rather than restated |
| `libs/api-client-customer/src/lib/customer-api.client.ts` | Modify: `activeBusinessUrl()` and `setActiveBusiness(customerId)`, the fourth `withCredentials` route |
| `libs/api-client-customer/src/lib/customer-api.client.spec.ts` | Modify `:148-157`, `:224-235`, `:28-46`: the new URL, the new call, the cookie |
| `libs/shared-ui/src/lib/app-shell/pp-app-shell.ts` | Modify: `PpBusinessOption`, the `businesses` and `activeBusinessId` inputs, the `businessSelected` output, the trigger, the menu, dismissal |
| `libs/shared-ui/src/lib/app-shell/pp-app-shell.css` | Modify: `position:relative` into the existing account rule; six new rules for the trigger, chevron, menu and options |
| `libs/shared-ui/src/lib/app-shell/pp-app-shell.spec.ts` | Modify: append a `pp-app-shell business switcher` describe block |
| `libs/shared-ui/src/public-api.ts` | Modify `:2-8`: export `PpBusinessOption` |
| `apps/customer-portal/src/app/auth/access-token.store.ts` | Modify: `activeCustomerId` — the key every session-scoped reset now hangs off |
| `apps/customer-portal/src/app/auth/access-token.store.spec.ts` | Modify `:8-15`; append the `activeCustomerId` tests |
| `apps/customer-portal/src/app/auth/business-switcher.ts` | Create: the round trip — POST, swap the token, go to the dashboard |
| `apps/customer-portal/src/app/auth/business-switcher.spec.ts` | Create |
| `apps/customer-portal/src/app/shell/company.store.ts` | Modify: `reset()`, the generation counter, the effect keyed on `activeCustomerId` |
| `apps/customer-portal/src/app/shell/company.store.spec.ts` | Modify `:12-19`, `:143`; append four tests |
| `apps/customer-portal/src/app/shell/entitlement.store.ts` | Modify: the same three changes, plus `replace()` bumping the generation |
| `apps/customer-portal/src/app/shell/entitlement.store.spec.ts` | Modify `:12-19`, `:171`; append three tests |
| `apps/customer-portal/src/app/shell/customer-nav.service.ts` | Modify `:49-56`: the resource re-keyed from a boolean onto the business id |
| `apps/customer-portal/src/app/shell/customer-nav.service.spec.ts` | Modify `:19-26`; append one test |
| `apps/customer-portal/src/app/app.ts` | Modify: the role-label map, `businesses`, `activeBusinessId`, `switchBusiness`, three new bindings |
| `apps/customer-portal/src/app/app.spec.ts` | Modify `:81-88`, `:128-146`, `:514-523`; append the switcher block and the no-unmount probe |
| `apps/customer-portal/src/app/features/entitlements/entitlements-page.ts` | Modify `:162-166`: `isAdmin` becomes `membershipRole === 'admin'` |
| `apps/customer-portal/src/app/features/entitlements/entitlements-page.spec.ts` | Modify `:17-26` |
| `apps/customer-portal/src/app/app.config.spec.ts` | Modify `:52-59` |
| `apps/customer-portal/src/app/app.routes.spec.ts` | Modify `:15-22` |
| `apps/customer-portal/src/app/auth/auth.service.spec.ts` | Modify `:14-21` |
| `apps/customer-portal/src/app/auth/auth.interceptor.spec.ts` | Modify `:13-20` |
| `apps/customer-portal/src/app/auth/authenticated.guard.spec.ts` | Modify `:15-26` |
| `apps/customer-portal/src/app/features/dashboard/dashboard-page.spec.ts` | Modify `:165-172` |
| `apps/customer-portal/src/app/features/sign-in/sign-in-page.spec.ts` | Modify `:14-21` |
| `apps/customer-portal/src/app/onboarding/onboarding-wizard.spec.ts` | Modify `:21-28` |
| `apps/customer-portal/src/app/features/company/company-page.ts` | Modify `:29-31`, `:110`: `CompanyAccountDto.isAdmin` becomes `membershipRole === 'admin'` (Task 2, ⚠ contract §13.3) |
| `apps/customer-portal/src/app/features/company/company-page.spec.ts` | Modify `:46`, `:101`, `:113` (Task 2, ⚠ contract §13.3) |
| `apps/employee-portal/src/app/shared/labels.ts` | Modify `:111` (append): `MEMBERSHIP_ROLE_VALUES`, `MembershipRoleWireValue`, `membershipRoleLabel`, `MEMBERSHIP_ROLE_OPTIONS` — the employee portal's only spelling of the three roles (Task 3) |
| `apps/employee-portal/src/app/shared/labels.spec.ts` | Modify `:3-13`, `:84`: append a `membership role` describe block (Task 3) |
| `apps/employee-portal/src/app/features/customers/account-form-page.ts` | Modify `:24`, `:56`, `:121-129`, `:184`, `:299`, `:312`, `:325`, `:330`: the Permissions checkbox becomes a role `<select>` (Task 3) |
| `apps/employee-portal/src/app/features/customers/account-form-page.spec.ts` | Modify `:50`, `:63`, `:76`, `:135`, `:153`, `:167`, `:225`, `:254` (Task 3) |
| `apps/employee-portal/src/app/features/customers/customer-detail-page.ts` | Modify `:31-38`, `:280-286`, `:370`, `:404-416`: the Admin-or-User cell names the role; `noAdmin` reads it (Task 3) |
| `apps/employee-portal/src/app/features/customers/customer-detail-page.spec.ts` | Modify `:66`, `:79`, `:92`, `:417-429`, `:483-491` ⚠ its fixture is `as unknown as`, so tsc catches none of it (Task 3) |
| `apps/employee-portal/src/app/features/customers/customer-wizard-page.ts` | Modify `:36-38`, `:68`, `:142`, `:146`, `:397-400`, `:549`, `:565`, `:644`, `:859`: the row checkbox becomes a role `<select>`, and `NO_ADMIN_ERROR` stops naming a flag (Task 3) |
| `apps/employee-portal/src/app/features/customers/customer-wizard-page.spec.ts` | Modify `:128`, `:307` (Task 3) |
| `libs/api-client-employee/src/lib/employee-api.client.spec.ts` | Modify `:99` — run by `npx ng test employee-portal` per `angular.json:120-122` (Task 3) |
| `e2e/fixtures/api.ts` | Modify `:29`, `:156`, `:163`: `SignedInSession.isAdmin` becomes `membershipRole` (Task 3) |
| `e2e/onboard-and-rename.spec.ts` | Modify `:491`: the fixture's one reader. ⚠ Playwright transpiles rather than type-checks, so nothing in `npm test` catches this file (Task 3) |

**Not touched, and deliberately:** `auth.interceptor.ts` (a 401 on `/auth/active-business` is an
expired session and must still be repaired by refresh-and-replay, so the route stays **off**
`ANONYMOUS_PATHS`), `authenticated.guard.ts`, `entitlement.guard.ts`, `token-refresher.ts` and
`app.routes.ts`.

⚠ **Two paths that used to be on that list are not on it any more** — everything under
`apps/employee-portal/`, and `apps/customer-portal/src/app/features/company/`. Contract §13.3 gives
plan 3 *"every resulting repair"* of plan 1's `is_admin` sweep in this repository, and it reaches
both. The company screen is two files in Task 2. Task 3 is eleven files: eight under
`apps/employee-portal/`, one client spec under `libs/`, and two under `e2e/`. Contract §13.3 counts
eight of the eleven; the three it does not — `shared/labels.ts`, its spec and
`e2e/onboard-and-rename.spec.ts` — are argued for in Task 3's opening. Nothing else under either
path moves: no route, no screen, no client method, and nothing to do with `/company/memberships` or
`/company/invitations`, which are plan 4's.

---

## Prerequisites — do this before Task 1

Plans 1 and 2 must be complete and green, and the platform must have re-emitted its OpenAPI
document, or Task 1 regenerates a client that still says `isAdmin`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror > /tmp/plan3-platform-build.txt 2>&1; tail -5 /tmp/plan3-platform-build.txt
grep -c 'active-business' artifacts/openapi/customer.json > /tmp/plan3-gate.txt
grep -c 'membershipRole'  artifacts/openapi/customer.json >> /tmp/plan3-gate.txt
grep -c '"isAdmin"'       artifacts/openapi/customer.json >> /tmp/plan3-gate.txt
cat /tmp/plan3-gate.txt
```

Read `/tmp/plan3-gate.txt` from the file, not from the terminal. Expected, in order: a
**non-zero** count for `active-business`, a **non-zero** count for `membershipRole`, and a count
for `"isAdmin"` that is **1 or 2** — `CompanyAccountDto` and possibly nothing else.

Measured on 2026-09-10, before plan 1 or 2 had landed, those three counts were `0`, `0` and `4`.
**Three zeros where two non-zeros are expected means plan 2 has not shipped and this plan cannot
start.**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
node --version    # 24.15.0
npm --version     # 11.12.1
git -C /Users/thinhhuynh/PeakPower/peakpower-web status --porcelain > /tmp/plan3-clean.txt; cat /tmp/plan3-clean.txt
npx ng test shared-ui       --watch=false > /tmp/plan3-base-ui.txt 2>&1;   tail -8 /tmp/plan3-base-ui.txt
npx ng test employee-portal --watch=false > /tmp/plan3-base-emp.txt 2>&1;  tail -8 /tmp/plan3-base-emp.txt
```

Both suites must be green **before** anything below. `npx ng test customer-portal` is expected to
be green here too, and expected to go **red the moment Task 1 lands** — that is the point of Task
2.

---

### Task 1: Regenerate both API clients, and gate on what came back

`libs/api-client-customer/src/generated/customer-schema.d.ts` carries the banner *"AUTO-GENERATED
by tools/generate-clients.mjs. Do not edit by hand."* and `tools/verify-clients.test.mjs`
regenerates it in memory and diffs it byte-for-byte on every `npm run test:workspace`. So this is
the first task: everything after it types against the new shape, and a hand-written type would be
overwritten by the next person who runs the script.

`tools/openapi-clients.mjs` freezes a two-entry `CLIENTS` registry and `generate-clients.mjs`
loops it, so **both** clients are rewritten by one command. Both documents moved (contract §13.3),
so both portals go red here and both are repaired — the customer portal in Task 2, the employee
portal in Task 3.

⚠ **This task has no mutation step, deliberately.** Contract §2 requires verification by mutation
and a review will reject work without it; the house rule earns an argued exemption here and nowhere
else in this plan. Every byte this task writes into the two `generated/` files is produced by
`tools/generate-clients.mjs` from the platform's OpenAPI documents, and `tools/verify-clients.test.mjs`
regenerates both in memory and diffs them byte-for-byte on every `npm run test:workspace`. A
mutation of a generated file is therefore not a test of anything: the guard that would catch it is
the same command that wrote it, so it would fail for the trivial reason that the file no longer
matches the generator — proving the generator is deterministic, which nobody doubts — and the
restore would be `npm run generate:clients` rather than an edit. The two hand-written lines this
task does add, `Membership` and `MembershipRoleValue`, are **type aliases with no runtime form**;
there is no behaviour to break, and a wrong alias fails Step 6's `npx ng build shared-ui` and the
type-check at the head of every later task rather than an assertion. **The first real mutation in
this plan is Task 2 Step 9**, which mutates both production lines that read the new field. Say
so in the review; do not report "no mutation" without this paragraph.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/libs/api-client-customer/src/generated/customer-schema.d.ts` (regenerated)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/libs/api-client-employee/src/generated/employee-schema.d.ts` (regenerated)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/libs/api-client-customer/src/lib/customer-api.types.ts`
- Test: none of its own. `tools/verify-clients.test.mjs` is the executable form of "this file matches the document", and it already exists.

**Interfaces:**
- Consumes: nothing.
- Produces: `components['schemas']['CurrentAccountResponse']` with `membershipRole` and
  `memberships`; and two new aliases in `customer-api.types.ts` —
  `export type Membership = CurrentAccount['memberships'][number];` and
  `export type MembershipRoleValue = CurrentAccount['membershipRole'];`
- ⚠ **`MembershipRoleValue` is exported here and nowhere else.** Contract §13.2 makes plan 3 its
  single owner and says everyone else *consumes*. **Plan 4 consumes it** — its Tasks 13, 14 and 15
  import `MembershipRoleValue` from `@peakpower-nl/api-client-customer` for
  `membershipRoleLabel`, `membershipRoleTone`, the role `<select>` and the invitation form. Plan 4
  as authored also *re-declares* it in this same file as
  `export type MembershipRoleValue = CompanyMember['membershipRole'];`, which is a duplicate export
  in one module — `TS2300`. That line is plan 4's to drop, not plan 3's to pre-empt; this plan ships
  the definition and plan 4 imports it.

- [ ] **Step 1: Record what the committed client says today, so the diff can be read**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
sed -n '675,684p' libs/api-client-customer/src/generated/customer-schema.d.ts > /tmp/plan3-car-before.txt
cat /tmp/plan3-car-before.txt
```

Expected, read back from the file:

```ts
        CurrentAccountResponse: {
            /** Format: uuid */
            accountId: string;
            /** Format: uuid */
            customerId: string;
            firstName: string;
            lastName: string;
            email: string;
            isAdmin: boolean;
        };
```

If those ten lines are not that block, the file has already moved and the line numbers in this
plan are stale — find the block with
`grep -n 'CurrentAccountResponse:' libs/api-client-customer/src/generated/customer-schema.d.ts`
and read from there instead.

- [ ] **Step 2: Regenerate**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform \
  npm run generate:clients > /tmp/plan3-generate.txt 2>&1
cat /tmp/plan3-generate.txt
```

Expected: two lines of the form
`@peakpower-nl/api-client-employee: wrote libs/api-client-employee/src/generated/employee-schema.d.ts (NNNN lines)`
and the customer equivalent, and **exit 0**. A line beginning
`OpenAPI document not found:` means the platform was not built — go back to Prerequisites.

- [ ] **Step 3: Gate on the customer shape**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
grep -n 'CurrentAccountResponse:' libs/api-client-customer/src/generated/customer-schema.d.ts > /tmp/plan3-car-after.txt
grep -n 'membershipRole\|memberships\|active-business' libs/api-client-customer/src/generated/customer-schema.d.ts >> /tmp/plan3-car-after.txt
grep -n 'isAdmin' libs/api-client-customer/src/generated/customer-schema.d.ts >> /tmp/plan3-car-after.txt \
  || echo 'no isAdmin anywhere in the customer client — EXPECTED' >> /tmp/plan3-car-after.txt
cat /tmp/plan3-car-after.txt
sed -n '/CompanyAccountDto: {/,/};/p' libs/api-client-customer/src/generated/customer-schema.d.ts \
  > /tmp/plan3-companyaccountdto.txt
cat /tmp/plan3-companyaccountdto.txt
```

Three things must be true in that file. The first two are stop conditions. **The third is an
expectation, not a gate** — it records what plan 1 guarantees, and finding it is how you know the
sweep landed:

1. `membershipRole` and `memberships` both appear. If neither does, plan 2 did not ship §8's
   change and nothing below this line can be written.
2. `active-business` appears as a path key. If it does not, Task 8 has no endpoint.
3. **`isAdmin` appears ZERO times, and `/tmp/plan3-companyaccountdto.txt` names `membershipRole`
   where it used to say `isAdmin: boolean`.** This is what contract §13.3 rules: plan 1's `is_admin`
   sweep changes **four** wire contracts, and `CompanyAccountDto` is one of them (plan 1's own
   Deviation D6 lists it by name and by line — `PortalContracts.cs:35-45`). Two schemas in this
   document carried the field before the sweep, `CurrentAccountResponse` and `CompanyAccountDto`,
   and `grep -c '\"isAdmin\"' artifacts/openapi/customer.json` measured **4** on 2026-09-10 (a
   property and a `required` entry each). After plan 1 that count is **0**.

   Continue in either direction, and adjust Task 2 rather than stopping:

   - `CurrentAccountResponse` still has `isAdmin` → plan 2 made §8's change additively and the
     contract was **not** followed. That one **is** a stop: contract §8 says the response
     *"LOSES isAdmin"*, and a portal that keeps reading a field the server is about to drop is the
     defect this whole plan exists downstream of. Report it to the contract owner.
   - `CompanyAccountDto` has lost `isAdmin` → **expected.** `company-page.ts:110` and
     `company-page.spec.ts:46,101,113` read that field and are repaired in Task 2, which contract
     §13.3 extends to cover them. This is no longer Deviation D4 arriving; D4 has been superseded
     and rewritten.

- [ ] **Step 4: Confirm the employee side moved too, and that it is red**

⚠ **This step used to stop on a non-empty employee diff. It no longer does.** Contract §13.3 makes
plan 3 the owner of *"every resulting repair"* in the web repo, employee portal included, and plan
1's Deviation D6 states outright that `AccountDto`, `CreateAccountRequest` and `UpdateAccountRequest`
*"all lose `isAdmin` and gain `membershipRole`"*. A non-empty diff is therefore the **expected**
outcome, and a red employee suite is the signal that Task 3 has work to do — not a reason to halt.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web diff --stat -- libs/api-client-employee > /tmp/plan3-emp-diff.txt
cat /tmp/plan3-emp-diff.txt
grep -n 'isAdmin\|membershipRole' libs/api-client-employee/src/generated/employee-schema.d.ts \
  > /tmp/plan3-emp-fields.txt \
  || echo 'neither field found — something is badly wrong' >> /tmp/plan3-emp-fields.txt
cat /tmp/plan3-emp-fields.txt
npx ng test employee-portal --watch=false > /tmp/plan3-emp-test.txt 2>&1; tail -12 /tmp/plan3-emp-test.txt
```

Read all three files back from disk. Expected:

1. `/tmp/plan3-emp-diff.txt` is **non-empty** — `libs/api-client-employee/src/generated/employee-schema.d.ts`
   moved. `grep -c '\"isAdmin\"' artifacts/openapi/employee.json` measured **6** on 2026-09-10 —
   three schemas, a property and a `required` entry each — and after plan 1 it is **0**.
2. `/tmp/plan3-emp-fields.txt` names **no** `isAdmin` and names `membershipRole` **three** times:
   `AccountDto` (line 399 before the sweep), `CreateAccountRequest` (447) and `UpdateAccountRequest`
   (729). Those three line numbers are where `isAdmin: boolean` sits today; read the surrounding
   lines with `sed -n` if the file has shifted.
3. The employee suite is **red**, and it fails at type-check rather than on an assertion —
   `TS2353` / `TS2741` / `TS2339` on `isAdmin`, in the production and spec files Task 3 lists.
   ⚠ Two of Task 3's files are NOT among them — `customer-detail-page.spec.ts` casts its fixture
   `as unknown as CustomerDetail` and `e2e/` is not compiled by any suite — so the red list is
   shorter than Task 3's file list, and that is a fact about the fixtures, not a missing file.

⚠ An **empty** diff is now the anomaly. It means plan 1 changed `CurrentAccountResponse` and stopped,
leaving `AccountDto` and its two request records on the boolean — contract §10's *"whole F12 employee
surface for customer accounts is in scope"* unmet. That is a stop: report it to the contract owner
rather than writing Task 3 against a wire that did not move.

- [ ] **Step 5: Add the two derived aliases**

`libs/api-client-customer/src/lib/customer-api.types.ts` is, by its own opening comment, *"the
ONLY file in the workspace that knows how openapi-typescript names things"*. The aliases are
**derived off `CurrentAccount`**, never restated, exactly as `ConnectionStatusValue` and friends
already are — the file's own rule is *"pulled off the DTOs so they can never drift from the
contract"*.

Replace line `32`, which currently reads:

```ts
export type CurrentAccount = Schemas['CurrentAccountResponse'];
```

with:

```ts
export type CurrentAccount = Schemas['CurrentAccountResponse'];

/**
 * One business this login is a member of — `{ customerId, tradeName, membershipRole }`, shared
 * contract §8. Indexed off `CurrentAccount` rather than named as a schema of its own, because the
 * generator may or may not hoist the array's element type into a named component and this alias
 * must survive either answer.
 */
export type Membership = CurrentAccount['memberships'][number];

/**
 * `'admin' | 'trader' | 'viewer'` — shared contract §3.
 *
 * ⚠ NOT `Role`, and not `RoleValue`. `role` is **job title** on the account record and
 * `[F01-R13]` says it is descriptive and never checked; `trader` and `viewer` are also the
 * **employee** vocabulary `[F13-R12]`. Any code naming both spells `membershipRole` and
 * `employeeRole` in full.
 *
 * ⚠ The array element's own `membershipRole` is a plain `string` on the wire, not this union —
 * contract §8 spells the two differently and this file does not reconcile them.
 *
 * ⚠ And this alias may resolve to a bare `string` rather than to the union, which is fine and is
 * why it is INDEXED rather than written out. The generator only emits a TypeScript union where the
 * platform's `EnumWireValuesSchemaTransformer` carries an entry for that DTO property — that is how
 * `status` became `'PENDING_APPROVAL' | …` from a C# `string` — and plan 1 registers no entry for
 * `membershipRole`. Every use of this type in this plan and in plan 4 is a comparison or an
 * annotation, both of which hold either way; an alias that had spelled the union out would instead
 * reject `'admin'` coming back from a `string`-typed field.
 */
export type MembershipRoleValue = CurrentAccount['membershipRole'];
```

- [ ] **Step 6: Prove the aliases resolve, and that the workspace guard now agrees**

Both portals are expected to be **red** here — the customer portal is Task 2's work and the
employee portal is Task 3's — so this step checks the two things that must already be true.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform \
  npm run test:workspace > /tmp/plan3-workspace.txt 2>&1; tail -12 /tmp/plan3-workspace.txt
npx ng build shared-ui > /tmp/plan3-build-ui.txt 2>&1; tail -5 /tmp/plan3-build-ui.txt
```

Expected: the workspace suite is green — `verify-clients.test.mjs` now finds no drift, which is
the whole reason Step 2 ran — and the library builds.

- [ ] **Step 7: Commit**

```bash
git -C /Users/thinhhuynh/PeakPower/peakpower-web add \
  libs/api-client-customer/src/generated/customer-schema.d.ts \
  libs/api-client-employee/src/generated/employee-schema.d.ts \
  libs/api-client-customer/src/lib/customer-api.types.ts
git -C /Users/thinhhuynh/PeakPower/peakpower-web commit -m "Regenerate the customer client for memberships, and name the two new types

CurrentAccountResponse loses isAdmin and gains membershipRole and memberships[]
(shared contract section 8), so the committed client had to move before anything
in this repository could read either field. Membership and MembershipRoleValue are
indexed off CurrentAccount rather than restated, the rule customer-api.types.ts
already applies to every other enum union in it: the generator may or may not hoist
the array element into a named component, and an alias that guessed would break on
the answer it did not guess.

Both portal suites are red after this commit and are repaired in the next two:
the customer portal in the next commit, the employee portal in the one after.
Plan 1's is_admin sweep moved four wire contracts, not one - CurrentAccountResponse
and CompanyAccountDto in the customer document, AccountDto, CreateAccountRequest
and UpdateAccountRequest in the employee one - and shared contract section 13.3
makes this plan the owner of every repair that follows.

No mutation step: every byte of the two generated files is written by
tools/generate-clients.mjs and diffed back by tools/verify-clients.test.mjs, so a
mutation would only prove the generator is deterministic. The two lines this commit
hand-writes are type aliases with no runtime form. The first mutation in this plan
is in the next commit.

Verified: npm run test:workspace, whose verify-clients guard regenerates both
clients and diffs them byte-for-byte, is green.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Repair every customer-side reader of `isAdmin`

⚠ **Contract §13.3 widened this task.** As authored it covered the sixteen files that read
`CurrentAccountResponse.isAdmin`. Plan 1's sweep also drops `isAdmin` from `CompanyAccountDto`, so
`features/company/company-page.ts` and its spec join the list — contract §13.3 names them, and calls
the production edit *"a one-line `person.membershipRole === 'admin'`, later replaced wholesale by
plan 4"*. **Eighteen** files in total: seventeen in `apps/customer-portal`, one in
`libs/api-client-customer`.

Exactly **two** are production code — `entitlements-page.ts` and `company-page.ts`. The rest are
fixtures. This task is mechanical and long, and it is written out file by file rather than as a
`sed` recipe on purpose: three of the fixtures are not the plain `isAdmin: true` shape, the two
production readers take two different replacements, and a regex over the repository would also
rewrite the **employee** portal, which is Task 3's and needs a different repair — there a boolean
becomes a three-value control, not a comparison.

The replacement everywhere is the same pair of lines, with the role and the business varying:

```ts
  membershipRole: 'admin',
  memberships: [{ customerId: 'c1', tradeName: 'Vandersteen Koeling', membershipRole: 'admin' }],
```

One membership, not two: today's world is one login in one business, and every existing test in
these files was written for it. The two-membership fixture is introduced in Task 11, where the
control that needs it is built.

**Files:**
- Modify: `apps/customer-portal/src/app/features/entitlements/entitlements-page.ts:162-166`
- Modify: `apps/customer-portal/src/app/features/entitlements/entitlements-page.spec.ts:17-26`
- Modify: `apps/customer-portal/src/app/app.config.spec.ts:52-59`
- Modify: `apps/customer-portal/src/app/app.routes.spec.ts:15-22`
- Modify: `apps/customer-portal/src/app/app.spec.ts:81-88`
- Modify: `apps/customer-portal/src/app/auth/access-token.store.spec.ts:8-15`
- Modify: `apps/customer-portal/src/app/auth/auth.service.spec.ts:14-21`
- Modify: `apps/customer-portal/src/app/auth/auth.interceptor.spec.ts:13-20`
- Modify: `apps/customer-portal/src/app/auth/authenticated.guard.spec.ts:15-26`
- Modify: `apps/customer-portal/src/app/shell/company.store.spec.ts:12-19`
- Modify: `apps/customer-portal/src/app/shell/entitlement.store.spec.ts:12-19`
- Modify: `apps/customer-portal/src/app/shell/customer-nav.service.spec.ts:19-26`
- Modify: `apps/customer-portal/src/app/features/dashboard/dashboard-page.spec.ts:165-172`
- Modify: `apps/customer-portal/src/app/features/sign-in/sign-in-page.spec.ts:14-21`
- Modify: `apps/customer-portal/src/app/onboarding/onboarding-wizard.spec.ts:21-28`
- Modify: `apps/customer-portal/src/app/features/company/company-page.ts:29-31`, `:110` ⚠ contract §13.3
- Modify: `apps/customer-portal/src/app/features/company/company-page.spec.ts:46`, `:101`, `:113` ⚠ contract §13.3
- Modify: `libs/api-client-customer/src/lib/customer-api.client.spec.ts:143-157`

**Interfaces:**
- Consumes: `Membership` and `MembershipRoleValue` from Task 1 (neither is imported here — the
  fixtures are object literals typed by `CurrentAccount`).
- Produces: a customer-portal suite that compiles against the regenerated client;
  `EntitlementsPage.canChange` reading `CurrentAccount.membershipRole` instead of `isAdmin`; and
  `CompanyPage`'s people table reading `CompanyAccount.membershipRole`.
  ⚠ The two read **different** DTOs that happen to share a field name: `canChange` reads the
  signed-in person's own role for the active business, `CompanyPage` reads each colleague's role in
  the business being looked at.

- [ ] **Step 1: See the failure this task exists to fix, and count it**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-red-before.txt 2>&1
grep -c "TS2339\|TS2353\|TS2741" /tmp/plan3-red-before.txt > /tmp/plan3-red-count.txt
tail -30 /tmp/plan3-red-before.txt; cat /tmp/plan3-red-count.txt
```

Expected: the run does not reach a single test. It fails at type-check with errors of three
shapes, and reading them now is what tells you the repair is the one this task describes:

- `TS2353: Object literal may only specify known properties, and 'isAdmin' does not exist in type 'CurrentAccountResponse'` — every fixture typed `const ACCOUNT: CurrentAccount = { … }`.
- `TS2741: Property 'membershipRole' is missing in type '{ … }' but required in type 'CurrentAccountResponse'` — the same fixtures, and the two inline literals passed straight to `AccessTokenStore.set`.
- `TS2339: Property 'isAdmin' does not exist on type 'CurrentAccountResponse'` — `entitlements-page.ts:166` and `customer-api.client.spec.ts:157`.
- `TS2339: Property 'isAdmin' does not exist on type 'CompanyAccountDto'` — `company-page.ts:110`, reported as a **template** type error (`strictTemplates` is on in the root `tsconfig.json`), plus `TS2353`/`TS2345` on `company-page.spec.ts:46,101,113`, whose `account()` helper is annotated `CompanyAccount`.

⚠ An inline object literal passed as an argument **is** excess-property-checked, which is why
`app.config.spec.ts` and `dashboard-page.spec.ts` break even though neither annotates a type.

- [ ] **Step 2: The one production reader —** `entitlements-page.ts`

Replace lines `162-166`, which currently read:

```ts
  /**
   * Only an admin may change the shelf, because only an admin may POST it. `isAdmin` is on the
   * account the session already carries, so this costs no request.
   */
  readonly canChange = computed(() => this.auth.account()?.isAdmin === true);
```

with:

```ts
  /**
   * Only an admin may change the shelf, because only an admin may POST it. `membershipRole` is on
   * the account the session already carries, so this costs no request.
   *
   * ⚠ It reads the role **for the active business**, which is the top-level field and never
   * `memberships[]`. A person may be an admin of one business and a viewer of another; deciding
   * this screen's control off the list rather than off the active role would show a Remove button
   * to somebody the API will answer 403.
   *
   * ⚠ And the role is no longer in the token. Shared contract §7 removes `IsAdmin` from
   * `ICustomerContext` and design §4.4 has the server read it from the database on every request,
   * so a demotion takes effect on the next call rather than at the next fifteen-minute boundary.
   * This signal follows whatever `/auth/me` last said, which is the same answer one refresh later.
   */
  readonly canChange = computed(() => this.auth.account()?.membershipRole === 'admin');
```

- [ ] **Step 3: `entitlements-page.spec.ts` — the two fixtures, one of them a spread**

Replace lines `17-26`, which currently read:

```ts
const ADMIN: CurrentAccount = {
  accountId: 'a1',
  customerId: 'c1',
  firstName: 'Peter',
  lastName: 'de Vries',
  email: 'p.devries@vandersteen.nl',
  isAdmin: true,
};

const COLLEAGUE: CurrentAccount = { ...ADMIN, accountId: 'a2', isAdmin: false };
```

with:

```ts
const ADMIN: CurrentAccount = {
  accountId: 'a1',
  customerId: 'c1',
  firstName: 'Peter',
  lastName: 'de Vries',
  email: 'p.devries@vandersteen.nl',
  membershipRole: 'admin',
  memberships: [{ customerId: 'c1', tradeName: 'Vandersteen Koeling', membershipRole: 'admin' }],
};

// The colleague is a TRADER of the same business, not an admin of none: the screen's control is
// gated on the role in the active business, and 'trader' is the value the backfill gives every
// non-admin account (shared contract §4 step 4).
const COLLEAGUE: CurrentAccount = {
  ...ADMIN,
  accountId: 'a2',
  membershipRole: 'trader',
  memberships: [{ customerId: 'c1', tradeName: 'Vandersteen Koeling', membershipRole: 'trader' }],
};
```

- [ ] **Step 4: The eight plain `const ACCOUNT: CurrentAccount` fixtures**

In each of these eight files, the block currently reads (the `isAdmin` value and the surrounding
name differ only where noted):

```ts
  email: 'p.devries@vandersteen.nl',
  isAdmin: true,
};
```

Replace the `isAdmin` line with the pair, so the block becomes:

```ts
  email: 'p.devries@vandersteen.nl',
  membershipRole: 'admin',
  memberships: [{ customerId: 'c1', tradeName: 'Vandersteen Koeling', membershipRole: 'admin' }],
};
```

The eight, with the line the `isAdmin` currently sits on:

| File | Line |
| --- | --- |
| `apps/customer-portal/src/app/app.routes.spec.ts` | `:21` |
| `apps/customer-portal/src/app/app.spec.ts` | `:87` |
| `apps/customer-portal/src/app/auth/access-token.store.spec.ts` | `:14` |
| `apps/customer-portal/src/app/auth/auth.service.spec.ts` | `:20` |
| `apps/customer-portal/src/app/auth/auth.interceptor.spec.ts` | `:19` |
| `apps/customer-portal/src/app/shell/company.store.spec.ts` | `:18` |
| `apps/customer-portal/src/app/shell/entitlement.store.spec.ts` | `:18` |
| `apps/customer-portal/src/app/features/sign-in/sign-in-page.spec.ts` | `:20` |
| `apps/customer-portal/src/app/onboarding/onboarding-wizard.spec.ts` | `:27` |

⚠ **`customer-nav.service.spec.ts:25` is not in that list**, because its fixture says
`isAdmin: false`. Replace its line `25` with:

```ts
  membershipRole: 'trader',
  memberships: [{ customerId: 'c1', tradeName: 'Vandersteen Koeling', membershipRole: 'trader' }],
```

- [ ] **Step 5: The three fixtures that are not a bare `const`**

`apps/customer-portal/src/app/auth/authenticated.guard.spec.ts:15-26` — the account is nested
inside a `SignInResponse`. Replace:

```ts
const RESPONSE: SignInResponse = {
  accessToken: 'the-token',
  expiresAt: '2026-08-26T12:00:00Z',
  account: {
    accountId: 'a1',
    customerId: 'c1',
    firstName: 'Peter',
    lastName: 'de Vries',
    email: 'p.devries@vandersteen.nl',
    isAdmin: true,
  },
};
```

with:

```ts
const RESPONSE: SignInResponse = {
  accessToken: 'the-token',
  expiresAt: '2026-08-26T12:00:00Z',
  account: {
    accountId: 'a1',
    customerId: 'c1',
    firstName: 'Peter',
    lastName: 'de Vries',
    email: 'p.devries@vandersteen.nl',
    membershipRole: 'admin',
    memberships: [{ customerId: 'c1', tradeName: 'Vandersteen Koeling', membershipRole: 'admin' }],
  },
};
```

`apps/customer-portal/src/app/app.config.spec.ts:52-59` — an inline literal passed as an argument.
Replace:

```ts
    TestBed.inject(AccessTokenStore).set('the-token', {
      accountId: 'a1',
      customerId: 'c1',
      firstName: 'Peter',
      lastName: 'de Vries',
      email: 'p.devries@vandersteen.nl',
      isAdmin: true,
    });
```

with:

```ts
    TestBed.inject(AccessTokenStore).set('the-token', {
      accountId: 'a1',
      customerId: 'c1',
      firstName: 'Peter',
      lastName: 'de Vries',
      email: 'p.devries@vandersteen.nl',
      membershipRole: 'admin',
      memberships: [{ customerId: 'c1', tradeName: 'Vandersteen Koeling', membershipRole: 'admin' }],
    });
```

`apps/customer-portal/src/app/features/dashboard/dashboard-page.spec.ts:165-172` — the same shape
inside `signIn()`. Replace:

```ts
    TestBed.inject(AccessTokenStore).set('the-token', {
      accountId: 'a1',
      customerId: 'c1',
      firstName: 'Peter',
      lastName: 'de Vries',
      email: 'p.devries@vandersteen.nl',
      isAdmin: true,
    });
```

with:

```ts
    TestBed.inject(AccessTokenStore).set('the-token', {
      accountId: 'a1',
      customerId: 'c1',
      firstName: 'Peter',
      lastName: 'de Vries',
      email: 'p.devries@vandersteen.nl',
      membershipRole: 'admin',
      memberships: [{ customerId: 'c1', tradeName: 'Vandersteen Koeling', membershipRole: 'admin' }],
    });
```

- [ ] **Step 6: The client spec's `/auth/me` round trip**

`libs/api-client-customer/src/lib/customer-api.client.spec.ts:143-157`. The flushed body is not
type-checked — `flush()` takes an untyped body — but `account?.isAdmin` on line `157` is, and
flushing a body missing the two new fields would leave the assertion below it testing nothing.
Replace lines `148-157`:

```ts
    me.flush({
      accountId: 'acc-1',
      customerId: 'cus-1',
      firstName: 'Peter',
      lastName: 'de Vries',
      email: 'p@v.nl',
      isAdmin: true,
    });
    expect(account?.email).toBe('p@v.nl');
    expect(account?.isAdmin).toBe(true);
```

with:

```ts
    me.flush({
      accountId: 'acc-1',
      customerId: 'cus-1',
      firstName: 'Peter',
      lastName: 'de Vries',
      email: 'p@v.nl',
      membershipRole: 'admin',
      memberships: [
        { customerId: 'cus-1', tradeName: 'Vandersteen Koeling', membershipRole: 'admin' },
        { customerId: 'cus-2', tradeName: 'Zaanse Koeling', membershipRole: 'viewer' },
      ],
    });
    expect(account?.email).toBe('p@v.nl');
    expect(account?.membershipRole).toBe('admin');
    // TWO, and the second one is the point: `memberships` is the switcher's whole input, and a
    // client that dropped the array — or read only the active business out of it — would leave the
    // rail with one row and nothing to switch to.
    expect(account?.memberships.map((m) => m.tradeName)).toEqual([
      'Vandersteen Koeling',
      'Zaanse Koeling',
    ]);
    expect(account?.memberships[1].membershipRole).toBe('viewer');
```

- [ ] **Step 7: The second production reader —** `company-page.ts` **and its spec** (contract §13.3)

`CompanyAccount` is `CompanyAccountDto` — the `/company/accounts` row, one colleague of the business
being looked at. It is a **different DTO** from `CurrentAccount`, and it lost `isAdmin` in the same
sweep (plan 1's Deviation D6 names `PortalContracts.cs:35-45`).

Replace `apps/customer-portal/src/app/features/company/company-page.ts:110`, which currently reads:

```html
                  @if (person.isAdmin) {
                    <span class="admin-flag">Admin</span>
                  }
```

with:

```html
                  @if (person.membershipRole === 'admin') {
                    <span class="admin-flag">Admin</span>
                  }
```

That is the whole production change — contract §13.3 calls it *"a one-line
`person.membershipRole === 'admin'`"*. ⚠ Do **not** grow it into a three-value badge here. Plan 4
replaces this table wholesale with the member list, its role column and its role `<select>`, and a
role vocabulary invented here would be a second one to delete.

The class doc comment above it is now wrong and must move with the line. Replace `:29-31`, which
currently reads:

```ts
 * The admin flag is displayed even though nothing branches on it yet: [DEC-71] ships the column
 * in phase 1 so a role does not have to be retrofitted onto live accounts in phase 2. The
 * sentence under the table is what stops a reader assuming it already gates something.
```

with:

```ts
 * The admin marker is displayed even though nothing on THIS screen branches on it: [DEC-71]
 * shipped the flag in phase 1 so a role would not have to be retrofitted onto live accounts, and
 * the retrofit has now happened - `isAdmin` is gone and each row carries `membershipRole`, one of
 * 'admin' | 'trader' | 'viewer'. Only 'admin' is marked here, because that is what the flag said
 * and this screen is read-only; the member list that shows all three, and lets an admin change
 * them, is a separate screen. The sentence under the table is what stops a reader assuming this
 * one already gates something.
```

Then the spec's three sites. `company-page.spec.ts:46`, inside the `account()` helper — replace:

```ts
    isAdmin: true,
```

with:

```ts
    membershipRole: 'admin',
```

`:101`, the second row of *"lists the colleagues who can sign in"* — replace:

```ts
        isAdmin: false, lastLoginAt: null,
```

with:

```ts
        membershipRole: 'trader', lastLoginAt: null,
```

and `:113`, the arrange line of *"marks the admins"* — replace:

```ts
    await load(fixture, [account(), account({ id: 'a2', isAdmin: false })]);
```

with:

```ts
    await load(fixture, [account(), account({ id: 'a2', membershipRole: 'viewer' })]);
```

⚠ **`'viewer'` there, and `'trader'` at `:101`, rather than the same value twice.** The assertion
below `:113` is `expect(…querySelectorAll('.admin-flag')).toHaveLength(1)`, which a template reading
`membershipRole !== 'admin'` would also satisfy with two rows; using both non-admin values across
the file is what makes the fixtures describe the three-value world instead of the boolean one they
replaced, and `:113` is the row the Step 9 mutation lands on.

- [ ] **Step 8: Run it green**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task2.txt 2>&1; tail -20 /tmp/plan3-task2.txt
grep -rn "isAdmin" apps/customer-portal libs/api-client-customer --include="*.ts" > /tmp/plan3-isadmin-left.txt 2>&1
cat /tmp/plan3-isadmin-left.txt
```

Expected: the suite compiles and is green, and `/tmp/plan3-isadmin-left.txt` is **empty**. Every
customer-side reader is gone — the sixteen `CurrentAccount` sites and, since contract §13.3, the two
`CompanyAccount` ones as well. Any hit at all is a file this task missed.

⚠ `apps/employee-portal` is deliberately **outside** that `grep` and is still red. It is Task 3's,
and running `npx ng test employee-portal` here is expected to fail — do not treat that as this
task's regression.

- [ ] **Step 9: Mutate — prove both production readers actually read the role**

The suite went from red to green, which proves it compiles. It does not prove either replaced line
is right: a hardcoded `true` would also compile. **Two mutations, because there are two production
readers**, and neither one covers the other.

**Mutation A —** `entitlements-page.ts`.

In `apps/customer-portal/src/app/features/entitlements/entitlements-page.ts`, change line `166` to:

```ts
  readonly canChange = computed(() => this.auth.account() !== null);
```

Predicted failure — the colleague fixture from Step 3 is a `trader`, so the screen would now offer
them a control the API answers 403:

```
npx ng test customer-portal --watch=false
```

`apps/customer-portal/src/app/features/entitlements/entitlements-page.spec.ts` fails on the
non-admin case with an assertion of the form `expected true to be false`, and no other file fails.

Then restore line `166` to `computed(() => this.auth.account()?.membershipRole === 'admin')`,
re-run, and prove the restore:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web diff -- apps/customer-portal/src/app/features/entitlements/entitlements-page.ts > /tmp/plan3-task2-restore.txt
cat /tmp/plan3-task2-restore.txt
npx ng test customer-portal --watch=false > /tmp/plan3-task2-green.txt 2>&1; tail -8 /tmp/plan3-task2-green.txt
```

`/tmp/plan3-task2-restore.txt` must show the doc comment and the `membershipRole` line as the only
change against `HEAD`, with no trace of the mutation.

**Mutation B —** `company-page.ts`.

⚠ **The obvious mutation does not bite here, and that is worth knowing before you try it.** Negating
the comparison to `person.membershipRole !== 'admin'` still renders exactly **one** `.admin-flag`
against Step 7's fixtures — the admin row loses it, the `'viewer'` row gains it — and
`expect(…).toHaveLength(1)` passes. The mutation that does bite drops the condition entirely.
Change `company-page.ts:110` to:

```html
                  @if (person) {
                    <span class="admin-flag">Admin</span>
                  }
```

Predicted failure, in `company-page.spec.ts`, on *"marks the admins, and says what the flag does not
yet do [DEC-71]"*:

```
npx ng test customer-portal --watch=false
```

`expected length 2 to be 1` — both rows are flagged. No other test in the file fails: nothing else
reads `.admin-flag`.

Then restore line `110` to `@if (person.membershipRole === 'admin') {`, re-run, and prove the
restore:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web diff -- apps/customer-portal/src/app/features/company/company-page.ts > /tmp/plan3-task2b-restore.txt
grep -c "@if (person) {" /tmp/plan3-task2b-restore.txt
npx ng test customer-portal --watch=false > /tmp/plan3-task2b-green.txt 2>&1; tail -8 /tmp/plan3-task2b-green.txt
```

`grep -c` must print `0`, and the diff must show only the doc paragraph and the `membershipRole`
comparison as changes against `HEAD`.

- [ ] **Step 10: Commit**

```bash
git -C /Users/thinhhuynh/PeakPower/peakpower-web add \
  apps/customer-portal/src/app/features/entitlements/entitlements-page.ts \
  apps/customer-portal/src/app/features/entitlements/entitlements-page.spec.ts \
  apps/customer-portal/src/app/app.config.spec.ts \
  apps/customer-portal/src/app/app.routes.spec.ts \
  apps/customer-portal/src/app/app.spec.ts \
  apps/customer-portal/src/app/auth/access-token.store.spec.ts \
  apps/customer-portal/src/app/auth/auth.service.spec.ts \
  apps/customer-portal/src/app/auth/auth.interceptor.spec.ts \
  apps/customer-portal/src/app/auth/authenticated.guard.spec.ts \
  apps/customer-portal/src/app/shell/company.store.spec.ts \
  apps/customer-portal/src/app/shell/entitlement.store.spec.ts \
  apps/customer-portal/src/app/shell/customer-nav.service.spec.ts \
  apps/customer-portal/src/app/features/dashboard/dashboard-page.spec.ts \
  apps/customer-portal/src/app/features/sign-in/sign-in-page.spec.ts \
  apps/customer-portal/src/app/onboarding/onboarding-wizard.spec.ts \
  apps/customer-portal/src/app/features/company/company-page.ts \
  apps/customer-portal/src/app/features/company/company-page.spec.ts \
  libs/api-client-customer/src/lib/customer-api.client.spec.ts
git -C /Users/thinhhuynh/PeakPower/peakpower-web commit -m "Read the membership role where the portal read the admin flag

Neither customer-side account shape has an isAdmin boolean any more. The account
the session carries has a membershipRole for the business it is signed in to and
a list of every business it is a member of; each colleague on the company screen
has a membershipRole in the business being looked at. Two production readers move
- the Entitlements screen's canChange, which gates the shelf control on being an
admin, and the company screen's admin marker - and sixteen fixtures follow them.

canChange reads the ACTIVE business's role and never the memberships list: a
person may be an admin of one business and a viewer of another, and deciding off
the list would show a Remove button to somebody the API answers 403.

The company screen's marker stays a marker rather than becoming a three-value
badge. Plan 4 replaces that table wholesale with the member list and its role
control, and a role vocabulary invented here would be a second one to delete.

Verified by mutation, twice. Replacing canChange with a plain 'is anybody signed
in' check fails entitlements-page.spec.ts on the colleague case, who is a trader.
Dropping the company screen's condition altogether flags both rows and fails
company-page.spec.ts with 'expected length 2 to be 1'; negating the comparison
does NOT fail, because one row is flagged either way, and the fixtures were
written with two different non-admin roles so that is visible rather than lucky.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Repair the employee portal — the admin boolean becomes a three-value role

Contract §13.3 assigns this task by name: *"employee-portal: three production files, three specs,
the employee api-client spec and the e2e fixture — **unowned by any plan as authored**, and inside
`npm run test`."* Task 1 Step 4 has already proved the client moved; this is the repair it said
had work to do.

**This is not Task 2 again.** There a boolean became a comparison and every reader stayed a
reader. Here a **control** changes. `AccountDto.membershipRole`, `CreateAccountRequest.membershipRole`
and `UpdateAccountRequest.membershipRole` are each a plain `string` on the wire — plan 1 registers
no `EnumWireValuesSchemaTransformer` entry for the field, so openapi-typescript has no union to
emit — and plan 1's `CreateAccountRequestValidator` and `UpdateAccountRequestValidator` refuse
anything that is not `admin`, `trader` or `viewer`. A checkbox can send two of three. The desk
that creates a company's accounts must be able to send all three, or `viewer` becomes a role only
SQL can grant.

⚠ **Eleven files, not the eight contract §13.3 counts.** The eight it names are the ones that stop
compiling or stop passing. Three more come with them, and are named here rather than left for the
implementer to discover:

- `apps/employee-portal/src/app/shared/labels.ts` **and its spec.** Two production files need the
  same three options and the same three labels. That file is already where every wire-enum option
  list in the employee portal lives — `CUSTOMER_STATUS_OPTIONS`, `PRODUCTION_EXPECTATION_OPTIONS`,
  `EXPECTATION_SOURCE_OPTIONS` — and its own header comment argues for it. Spelling the three
  literals twice in two screens is the drift that comment exists to prevent.
- `e2e/onboard-and-rename.spec.ts:491` reads `SignedInSession.isAdmin`, the field the e2e fixture
  is about to rename. The contract counted the fixture and not its one reader.

⚠ **`membershipRole`, never `employeeRole`, and never bare `role`.** Contract §3: `trader` and
`viewer` are **also** the employee vocabulary `[F13-R12]`, and `role` is **job title** on the
account record `[F01-R13]`. This portal is the one place in the workspace where both meanings sit
on the same screen — the account form has a **Job title** input three fields above the new control
— so both are spelled out in full wherever they appear together.

⚠ **Two of these files are not caught by the type-checker and would go green while lying.**
`customer-detail-page.spec.ts:159` casts its fixture `as unknown as CustomerDetail`, which defeats
every check inside it, and `:422`'s `{ ...account, isAdmin: false }` is assignable to `Account`
because a spread carries no excess-property check. Left alone, that fixture compiles, keeps `a1`'s
`membershipRole: 'admin'` from the spread, and the *"warns when nobody active can administer it"*
test fails on the **assertion** rather than at type-check. Do not conclude from a clean
`tsc` that a spec fixture was reached.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/employee-portal/src/app/shared/labels.ts:111` (append)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/employee-portal/src/app/shared/labels.spec.ts:3-13`, `:84` (append)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/employee-portal/src/app/features/customers/account-form-page.ts:24`, `:56`, `:121-129`, `:184`, `:299`, `:312`, `:325`, `:330`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/employee-portal/src/app/features/customers/account-form-page.spec.ts:50`, `:63`, `:76`, `:135`, `:153`, `:167`, `:225`, `:254`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/employee-portal/src/app/features/customers/customer-detail-page.ts:31-38`, `:280-286`, `:370`, `:404-416`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/employee-portal/src/app/features/customers/customer-detail-page.spec.ts:66`, `:79`, `:92`, `:417-429`, `:483-491`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/employee-portal/src/app/features/customers/customer-wizard-page.ts:36-38`, `:68`, `:142`, `:146`, `:397-400`, `:549`, `:565`, `:644`, `:859`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/employee-portal/src/app/features/customers/customer-wizard-page.spec.ts:128`, `:307`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/libs/api-client-employee/src/lib/employee-api.client.spec.ts:99`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/e2e/fixtures/api.ts:29`, `:156`, `:163`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/e2e/onboard-and-rename.spec.ts:491`
- Test: `apps/employee-portal/src/app/shared/labels.spec.ts` and the three feature specs above, all
  run by `npx ng test employee-portal --watch=false`, which per `angular.json:120-122` also runs
  `libs/api-client-employee/src/**/*.spec.ts`.

**Interfaces:**
- Consumes: `Account = Schemas['AccountDto']`, `CreateAccountRequest`, `UpdateAccountRequest` from
  `@peakpower-nl/api-client-employee` — regenerated in Task 1, each now carrying
  `membershipRole: string` where it carried `isAdmin: boolean`.
- Produces, in `apps/employee-portal/src/app/shared/labels.ts` and nowhere else:
  `MEMBERSHIP_ROLE_VALUES`, `MembershipRoleWireValue`, `membershipRoleLabel(value: string): string`
  and `MEMBERSHIP_ROLE_OPTIONS`.
- ⚠ **`MembershipRoleWireValue`, not `MembershipRoleValue`.** Contract §13.2 makes plan 3 the single
  owner of `MembershipRoleValue`, which Task 1 Step 5 exports from
  `libs/api-client-customer/src/lib/customer-api.types.ts`. That alias belongs to the **customer**
  realm; `employee-api.types.ts:212-217` says in its own words that the employee client is
  *"deliberately NOT the customer realm's"* types, and importing across the two would be the first
  time this repository did. A second export under the same name is the `TS2300` this whole round
  exists to remove, so the employee-side type takes a different name.
- Produces nothing on the wire, no route, no client method.

- [ ] **Step 1: Read what the regenerated employee client actually says**

Task 1 Step 4 recorded that the file moved. This step reads the three schemas, because every edit
below assumes their exact new shape.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
sed -n '/AccountDto: {/,/};/p'            libs/api-client-employee/src/generated/employee-schema.d.ts >  /tmp/plan3-emp-shapes.txt
sed -n '/CreateAccountRequest: {/,/};/p'  libs/api-client-employee/src/generated/employee-schema.d.ts >> /tmp/plan3-emp-shapes.txt
sed -n '/UpdateAccountRequest: {/,/};/p'  libs/api-client-employee/src/generated/employee-schema.d.ts >> /tmp/plan3-emp-shapes.txt
cat /tmp/plan3-emp-shapes.txt
```

Read it back from the file. Expected: three schemas, each with `membershipRole: string;` where it
read `isAdmin: boolean;` before — lines `399`, `447` and `729` in the pre-sweep file.

⚠ **If `membershipRole` came back as a union** (`"admin" | "trader" | "viewer"`), plan 1 registered
an `EnumWireValuesSchemaTransformer` entry after all. Nothing below breaks — every use is a
comparison or an assignment of one of the three literals — but Step 2's `MembershipRoleWireValue`
should then be `Account['membershipRole']` rather than a hand-written union, for the same reason
`AccountStatusValue` is. Say which answer you got in the review.

- [ ] **Step 2: Name the three roles once, in `shared/labels.ts`**

Append to `apps/employee-portal/src/app/shared/labels.ts`, after `EXPECTATION_SOURCE_OPTIONS`
(currently ending at line `111`):

```ts
/**
 * The three membership roles, shared contract §3.
 *
 * ⚠ Written out here as a literal union instead of derived off the generated schema, unlike every
 * other `…Value` in this file. `AccountDto.membershipRole` generates as a bare `string`: plan 1
 * registers no `EnumWireValuesSchemaTransformer` entry for it, so openapi-typescript has no union
 * to emit. `Record<string, string>` would compile and hand back `undefined` for a typo, which is
 * exactly the silent `undefined` the header comment above says these maps exist to prevent.
 *
 * ⚠ Lowercase, unlike every other wire enum in this file. Contract §3 spells these values
 * lowercase in the database AND on the wire, and §13.5 records the `HasConversion` on the platform
 * side that keeps them out of the SCREAMING_SNAKE convention.
 *
 * ⚠ `membershipRole`, never `employeeRole` and never bare `role`. `trader` and `viewer` also name
 * EMPLOYEE roles `[F13-R12]`, and `role` is already job title on the account record `[F01-R13]` —
 * which this very screen has an input for. Contract §3 requires any code naming both to spell each
 * out in full.
 */
export const MEMBERSHIP_ROLE_VALUES = ['admin', 'trader', 'viewer'] as const;

export type MembershipRoleWireValue = (typeof MEMBERSHIP_ROLE_VALUES)[number];

const MEMBERSHIP_ROLE_LABELS: Record<MembershipRoleWireValue, string> = {
  admin: 'Administrator',
  trader: 'Trader',
  viewer: 'Viewer',
};

/**
 * Takes a `string`, not the union, because that is what the wire hands over. An unknown value
 * names itself rather than rendering as blank: a role the back office cannot spell is a fact the
 * desk needs to see, not one to hide behind an empty cell.
 */
export function membershipRoleLabel(value: string): string {
  return MEMBERSHIP_ROLE_LABELS[value as MembershipRoleWireValue] ?? value;
}

export const MEMBERSHIP_ROLE_OPTIONS: readonly {
  value: MembershipRoleWireValue;
  label: string;
}[] = MEMBERSHIP_ROLE_VALUES.map((value) => ({ value, label: MEMBERSHIP_ROLE_LABELS[value] }));
```

- [ ] **Step 3: Test it, in the file that tests every other label map**

`apps/employee-portal/src/app/shared/labels.spec.ts` — add the two new names to the import at
`:3-13` and append a fourth `describe` after `:84`:

```ts
describe('membership role', () => {
  it('renders all three roles, and the lowercase wire value never reaches a screen', () => {
    expect(membershipRoleLabel('admin')).toBe('Administrator');
    expect(membershipRoleLabel('trader')).toBe('Trader');
    expect(membershipRoleLabel('viewer')).toBe('Viewer');
  });

  it('names an unknown role rather than rendering an empty cell', () => {
    // A role this build has never heard of is a deploy skew, and a blank cell hides it.
    expect(membershipRoleLabel('auditor')).toBe('auditor');
  });

  it('offers exactly three options, in the order the contract declares them', () => {
    expect(MEMBERSHIP_ROLE_OPTIONS.map((o) => o.value)).toEqual(['admin', 'trader', 'viewer']);
    expect(MEMBERSHIP_ROLE_OPTIONS.map((o) => o.label))
      .toEqual(['Administrator', 'Trader', 'Viewer']);
  });
});
```

- [ ] **Step 4: `account-form-page.ts` — the Permissions checkbox becomes a role control**

Five sites, all confirmed against the file.

`:24` — extend the existing import:

```ts
import {
  MEMBERSHIP_ROLE_OPTIONS,
  accountStatusLabel,
  accountStatusTone,
} from '../../shared/labels';
```

`:56` — **delete** the now-dead rule `.checkbox { display: flex; align-items: center; gap: 8px; }`.
`:122` is its only user and it is going. A rule nothing selects is drift the next reader has to
disprove.

`:121-129` — replace the whole Permissions card:

```html
      <pp-card heading="Permissions">
        <pp-form-field
          label="Role"
          for="membership-role"
          hint="An administrator can invite colleagues and change their roles."
          [error]="message('membershipRole')"
        >
          <select id="membership-role" formControlName="membershipRole">
            @for (option of roleOptions; track option.value) {
              <option [value]="option.value">{{ option.label }}</option>
            }
          </select>
        </pp-form-field>
        <p class="hint">
          Trader and viewer are recorded now and told apart from Phase 2, when four-eyes approval
          arrives. Administrator is enforced today.
        </p>
      </pp-card>
```

⚠ The old copy — *"The flag is recorded now and enforced from Phase 2"* — was true of a boolean and
is false of this control: `admin` **is** enforced today, by the `CompanyAdmin` policy contract §8
puts on every company route. Leaving it would be a screen telling the desk that the thing it just
granted does nothing.

`:184` — the form control. `'trader'`, not `'admin'`, is the create-arm default, and it is the
same choice migration 15's backfill makes for a non-admin account (contract §4:
`CASE WHEN is_admin THEN 'admin' ELSE 'trader' END`):

```ts
    membershipRole: new FormControl<string>('trader', { nonNullable: true }),
```

`:299` and `:312` — in `toCreateRequest()` and `toUpdateRequest()`, `isAdmin: value.isAdmin,`
becomes:

```ts
      membershipRole: value.membershipRole,
```

`:325` — in `fill()`, `isAdmin: account.isAdmin,` becomes:

```ts
      membershipRole: account.membershipRole,
```

Finally, beside `statusLabel`/`statusTone` at `:330-331`, add the template's option source:

```ts
  protected readonly roleOptions = MEMBERSHIP_ROLE_OPTIONS;
```

- [ ] **Step 5: `account-form-page.spec.ts` — eight fixture and assertion sites**

The `CUSTOMER` fixture, `:50`, `:63`, `:76` — `a1` was `isAdmin: true`, `a2` and `a3` were
`isAdmin: false` and `isAdmin: true`. Replace with `membershipRole: 'admin'`,
`membershipRole: 'viewer'` and `membershipRole: 'admin'` respectively.

⚠ **`a2` is `'viewer'` and not `'trader'`, and that is the point of the fixture.** `a2` is the
account every edit-arm test loads (`/api/v1/accounts/a2`, *"fills the form from the matching
account, not the first one"*), and `'trader'` is what `:184` now defaults the control to. A form
that never called `fill()` would satisfy `:225` with `'trader'`; only a third value proves the
loaded record reached the control.

`:135` and `:167` — the two `form.setValue({…})` calls. `setValue` requires every control, so
`isAdmin: true,` becomes `membershipRole: 'admin',` and `isAdmin: false,` becomes
`membershipRole: 'viewer',`.

`:153` — the POST body assertion, in *"POSTs the create request"*:

```ts
    expect(req.request.body).toEqual({
      username: 'a.boers',
      firstName: 'Ada',
      lastName: 'Boers',
      jobTitle: null,
      email: 'ada@acme.nl',
      phone: null,
      membershipRole: 'admin',
    });
```

`:225` — the fill assertion:

```ts
    expect(fixture.componentInstance.form.controls.membershipRole.value).toBe('viewer');
```

`:254` — the PATCH body assertion, which carries `a2`'s loaded role back untouched:

```ts
      membershipRole: 'viewer',
```

- [ ] **Step 6: `customer-detail-page.ts` — the admin flag becomes the role**

`:31-38` — add `membershipRoleLabel` to the existing `../../shared/labels` import.

`:280-286` — the Role cell. The `data-testid="admin-flag"` stays: the badge still marks the one
role the platform enforces, and `:483` reads that hook.

```html
                <span>
                  @if (account.membershipRole === 'admin') {
                    <pp-badge data-testid="admin-flag" tone="info">Administrator</pp-badge>
                  } @else {
                    <span class="empty">{{ roleLabel(account.membershipRole) }}</span>
                  }
                </span>
```

⚠ The `@else` arm said `User` for every non-admin and now says which one. That is the whole
difference between the two worlds this task moves between, and it is one line.

`:404-416` — `noAdmin`, whose doc comment names the field:

```ts
  /**
   * Whether anyone here can administer the company.
   *
   * ⚠ Counted over ACTIVE accounts alone. A deactivated administrator still holds an `admin`
   * membership and is still on the table, and counting them would answer "somebody can" about a
   * person who can no longer sign in. Silent while the company has no accounts at all — the empty
   * state above says that better than a warning does.
   *
   * ⚠ `=== 'admin'` and never "not a viewer": `trader` is not an administrator either, and a
   * negated test would call a company with two traders administered.
   */
  protected readonly noAdmin = computed(() => {
    const accounts = this.accounts();
    if (accounts.length === 0) return false;
    return !accounts.some(
      (account) => account.membershipRole === 'admin' && account.status === 'ACTIVE',
    );
  });
```

And beside `accountLabel`/`accountTone` at `:370-371`:

```ts
  protected readonly roleLabel = membershipRoleLabel;
```

- [ ] **Step 7: `customer-detail-page.spec.ts` — the fixture the compiler cannot police**

`:66`, `:79`, `:92` — `a1` becomes `membershipRole: 'admin'`, `a2` becomes
`membershipRole: 'trader'`, `a3` becomes `membershipRole: 'viewer'`. Three different values across
three rows, so *"renders every row"* cannot pass on a component that prints row zero three times.

`:417-429` — the no-admin case. `:422`'s spread is the line the type-checker waves through, so it
must be edited by hand:

```ts
  it('warns when nobody active at the company can administer it', async () => {
    // Counted over ACTIVE accounts alone: a deactivated administrator still holds an admin
    // membership and is still on the table, and counting them answers "somebody can" about a
    // person who cannot sign in.
    //
    // ⚠ A spread carries no excess-property check, so leaving `isAdmin: false` here would COMPILE
    // and leave a1 on 'admin' from the spread. This line is not caught by tsc; it is caught by the
    // assertion below, or by nothing.
    const noAdmin = {
      ...ACME,
      accounts: ACME.accounts.map((account) => ({ ...account, membershipRole: 'trader' })),
    } as CustomerDetail;
```

`:483-491` — the badge test, which now has three roles to tell apart:

```ts
  it('marks the administrator and names the other two roles', async () => {
    prime();
    http.expectOne('/api/v1/customers/c1').flush(ACME);
    await settle();

    const adminBadges = element().querySelectorAll('[data-testid="admin-flag"]');
    expect(adminBadges).toHaveLength(1);
    expect(adminBadges[0].textContent).toContain('Administrator');

    // The other two rows are not "User" any more, and they are not each other.
    expect(text()).toContain('Trader');
    expect(text()).toContain('Viewer');
    expect(text()).not.toContain('trader');
  });
```

⚠ The last assertion is the one that earns its place: `not.toContain('trader')` fails the moment a
screen prints the wire value instead of the label, which is what an `{{ account.membershipRole }}`
written in a hurry does. `'Trader'` alone would pass against it.

- [ ] **Step 8: `customer-wizard-page.ts` — the row checkbox becomes a role control**

Seven sites plus the copy.

`:36-38` — `NO_ADMIN_ERROR` describes a flag that no longer exists:

```ts
export const NO_ADMIN_ERROR =
  'Give one of these people the administrator role. Without an administrator nobody at this ' +
  'company can manage its users or its entitlements, and only an administrator here can put that ' +
  'right afterwards.';
```

⚠ String concatenation with `+`, not a template literal — `customer-wizard-page.ts` composes its
template in a backtick literal further down and the file's existing constants already use `+` for
the same reason the Global Constraints section gives.

Import `MEMBERSHIP_ROLE_OPTIONS` from `../../shared/labels` beside whatever that file already
imports from it.

`:68` — the row type:

```ts
  membershipRole: FormControl<string>;
```

`:142` — the row grid gains room for a select where a checkbox fitted:

```css
    .row--account { grid-template-columns: 1fr 1fr 1fr 1.2fr 0.9fr 40px; }
```

`:146` — **delete** `.check { … }`. `:397` is its only user and it is going.

`:397-400` — the cell itself, a `pp-form-field` like every other cell in the row, so it aligns
without the `padding-top: 22px` the bare label needed:

```html
                <pp-form-field label="Role" [for]="'acc-role-' + i">
                  <select [id]="'acc-role-' + i" formControlName="membershipRole">
                    @for (option of roleOptions; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </pp-form-field>
```

⚠ `[for]="'acc-role-' + i"` and `[id]="'acc-role-' + i"` — concatenation, never a template string.
A backtick anywhere inside this component's template literal closes it early.

`:549` — the step summary:

```ts
    const admins = rows.filter((row) => row.controls.membershipRole.value === 'admin').length;
```

`:565` — the block rule:

```ts
    if (!rows.some((row) => row.controls.membershipRole.value === 'admin')) return NO_ADMIN_ERROR;
```

`:644` — the new row's default, `'trader'` for the same reason as Step 4:

```ts
        membershipRole: new FormControl<string>('trader', { nonNullable: true }),
```

`:859` — `toAccountRequest`:

```ts
      membershipRole: value.membershipRole,
```

And beside the component's other template-facing members:

```ts
  protected readonly roleOptions = MEMBERSHIP_ROLE_OPTIONS;
```

⚠ `:859` sits inside an `as CreateAccountRequest` assertion. That assertion **does** error today
(`TS2352`: the literal is missing `membershipRole` and the target is missing `isAdmin`, so neither
is assignable to the other), but an assertion is a weaker guard than a return type and the row type
at `:68` is what actually drives this edit. Change `:68` first and let the errors lead.

- [ ] **Step 9: `customer-wizard-page.spec.ts` — two sites**

`:128`, inside `fillAdmin()`:

```ts
      membershipRole: 'admin',
```

`:307`, in the three-write ordering test:

```ts
    expect(account.request.body.membershipRole).toBe('admin');
```

⚠ **Nothing else in this spec moves, and the admin-rule test at `:244` now covers more than it
did.** It asserts `NO_ADMIN_ERROR` is present before `fillAdmin()` and gone after. Before, the
first row's checkbox defaulted to `false`; now it defaults to `'trader'`, so the same test also
proves a trader does not satisfy the rule — which is the new failure mode the boolean could not
have.

- [ ] **Step 10: `employee-api.client.spec.ts` — the one client fixture**

`:99`, inside *"POSTs an account to the customer accounts collection"*:

```ts
      membershipRole: 'admin',
```

The `as CreateAccountRequest` on that literal is what makes this a type error rather than a silent
pass, and `angular.json:120-122` is why it runs under `npx ng test employee-portal`.

- [ ] **Step 11: The e2e fixture, and its one reader**

`e2e/fixtures/api.ts:29` — `SignedInSession`:

```ts
  /** `CurrentAccountResponse.membershipRole` — 'admin', 'trader' or 'viewer'. */
  readonly membershipRole: string;
```

`:156` and `:163` — the sign-in body and the mapping:

```ts
  const body = (await response.json()) as {
    accessToken: string;
    account: { accountId: string; customerId: string; email: string; membershipRole: string };
  };
  return {
    accessToken: body.accessToken,
    accountId: body.account.accountId,
    customerId: body.account.customerId,
    email: body.account.email,
    membershipRole: body.account.membershipRole,
  };
```

`e2e/onboard-and-rename.spec.ts:491` — the reader contract §13.3's count of eight omits:

```ts
  expect(session.membershipRole, 'the first account administers the company').toBe('admin');
```

⚠ **Playwright transpiles rather than type-checks, so neither file goes red.** `session.isAdmin`
would have become `undefined` and `toBe(true)` would have failed at run time, in a suite `npm test`
does not run. Nothing in Step 12 proves this step was done; the diff is the proof.

- [ ] **Step 12: Run it green**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test employee-portal --watch=false > /tmp/plan3-task3.txt 2>&1; tail -20 /tmp/plan3-task3.txt
npx ng build employee-portal > /tmp/plan3-task3-build.txt 2>&1; tail -5 /tmp/plan3-task3-build.txt
grep -rn "isAdmin" apps/employee-portal libs/api-client-employee e2e --include="*.ts" \
  > /tmp/plan3-emp-isadmin-left.txt 2>&1
cat /tmp/plan3-emp-isadmin-left.txt
```

Read all three back from disk. Expected: the suite compiles and is green, the app builds, and
`/tmp/plan3-emp-isadmin-left.txt` is **empty**. Any hit is a site this task missed — including in
`e2e/`, which the suite does not compile.

⚠ `npx ng test customer-portal` must still be green here; this task touches nothing it reads.

- [ ] **Step 13: Mutate — three production files, three mutations**

Green proves it compiles. It does not prove any of the three replaced rules reads the role.

**Mutation A —** `customer-wizard-page.ts`, the block rule. Change `:565` to:

```ts
    if (!rows.some((row) => row.controls.membershipRole.value !== '')) return NO_ADMIN_ERROR;
```

Predicted failure: the default row is a `'trader'`, so a company with no administrator would be
allowed through.

```
npx ng test employee-portal --watch=false
```

`customer-wizard-page.spec.ts` fails on *"blocks the create until somebody on the customer is an
admin"*, at the **first** assertion — `expect(root.textContent).toContain(NO_ADMIN_ERROR)` — with
an `expected … to contain 'Give one of these people the administrator role…'`. No other test in the
file fails; the summary test reads `accountSummary`, which is a different computed.

**Mutation B —** `customer-detail-page.ts`, the warning. Change `:415` to:

```ts
    return !accounts.some((account) => account.status === 'ACTIVE');
```

Predicted failure: any active account now counts as an administrator, so the warning never shows
for a company that has one. `customer-detail-page.spec.ts` fails on *"warns when nobody active at
the company can administer it"* with `expected … to contain 'No admin on this customer'` — the
fixture's three accounts are all `'trader'` but `a1` is `ACTIVE`. *"stays silent about the admin
when there is an active one"* still passes, which is exactly why the negative test is the one that
bites.

**Mutation C —** `account-form-page.ts`, the request mapping. Change `:312` in `toUpdateRequest()`
to:

```ts
      membershipRole: 'admin',
```

Predicted failure: `account-form-page.spec.ts` fails on *"PATCHes the account without the username,
carrying the edited value"* with the body assertion reporting `membershipRole: 'admin'` where
`'viewer'` was expected — `a2`'s loaded role. The create-arm test still passes, because its fixture
sets `'admin'` deliberately; that asymmetry is why `a2` was made a `'viewer'` in Step 5.

Then restore all three, re-run, and prove the restore from the diff rather than from memory:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web diff -- \
  apps/employee-portal/src/app/features/customers/customer-wizard-page.ts \
  apps/employee-portal/src/app/features/customers/customer-detail-page.ts \
  apps/employee-portal/src/app/features/customers/account-form-page.ts \
  > /tmp/plan3-task3-restore.txt
grep -cn "!== ''" /tmp/plan3-task3-restore.txt
grep -c "membershipRole: 'admin'," /tmp/plan3-task3-restore.txt
npx ng test employee-portal --watch=false > /tmp/plan3-task3-green.txt 2>&1; tail -8 /tmp/plan3-task3-green.txt
```

The first `grep -c` must print `0`. The second counts only the additions this task intends; read
`/tmp/plan3-task3-restore.txt` and confirm no line of it is a mutation rather than trusting the
count.

- [ ] **Step 14: Commit**

```bash
git -C /Users/thinhhuynh/PeakPower/peakpower-web add \
  apps/employee-portal/src/app/shared/labels.ts \
  apps/employee-portal/src/app/shared/labels.spec.ts \
  apps/employee-portal/src/app/features/customers/account-form-page.ts \
  apps/employee-portal/src/app/features/customers/account-form-page.spec.ts \
  apps/employee-portal/src/app/features/customers/customer-detail-page.ts \
  apps/employee-portal/src/app/features/customers/customer-detail-page.spec.ts \
  apps/employee-portal/src/app/features/customers/customer-wizard-page.ts \
  apps/employee-portal/src/app/features/customers/customer-wizard-page.spec.ts \
  libs/api-client-employee/src/lib/employee-api.client.spec.ts \
  e2e/fixtures/api.ts \
  e2e/onboard-and-rename.spec.ts
git -C /Users/thinhhuynh/PeakPower/peakpower-web commit -m "Give the back office a role to set where it had an admin checkbox

AccountDto, CreateAccountRequest and UpdateAccountRequest lost isAdmin and gained
membershipRole in the regenerated employee client, so the two screens that write
an account and the one that reads a company's accounts had to move with them. A
checkbox can send two of three values and the platform validator refuses anything
that is not admin, trader or viewer, so both writers became a three-option select
and the detail table's Admin-or-User cell now names the actual role.

The three literals are spelled once, in shared/labels.ts, beside every other wire
enum's option list and for the reason that file's own header gives. They are
written out rather than derived off the schema because membershipRole generates as
a bare string - no EnumWireValuesSchemaTransformer entry exists for it - and a
Record keyed on string hands back undefined for a typo.

Trader, not viewer, is what a new row defaults to: it is the same choice migration
15's backfill makes for an account that was not an admin.

Eleven files, not the eight the shared contract counts. labels.ts and its spec are
where the option list belongs, and e2e/onboard-and-rename.spec.ts reads the field
the e2e fixture renamed - Playwright transpiles rather than type-checks, so nothing
in the unit suites would have caught it.

Verified by mutation, three times. Accepting any non-empty role as an admin lets
the wizard create a company nobody can administer and fails its block test on the
first assertion. Counting any ACTIVE account as an administrator silences the
detail screen's warning and fails it. Hardcoding admin into the PATCH body fails
the edit test, whose fixture account is a viewer precisely so that it can.

Verified: npx ng test employee-portal is green, npx ng build employee-portal
succeeds, and no isAdmin remains anywhere under apps/employee-portal,
libs/api-client-employee or e2e.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `AccessTokenStore.activeCustomerId` — the key everything else resets on

This is the first of the five confirmed defects, and the root of three of them.

`AccessTokenStore` today exposes exactly one thing about the session's shape:

```ts
  readonly isSignedIn = computed(() => this._token() !== null);
```

`CompanyStore` and `EntitlementStore` both key their session effects on it, and
`CustomerNavService` keys its `rxResource` on a boolean derived from it. **A `computed` compares
with `Object.is` and does not notify its dependents when the value is unchanged**, so replacing
the token in place — which is exactly what a switch does — recomputes `true` from `true` and
propagates nothing at all. Every downstream cache keeps the previous business's data and never
learns it moved.

The fix is one member: the **business id**, a string. `'c1' -> 'c2'` propagates; `'c1' -> 'c1'`
does not — which is the second half of the requirement and easy to miss. `TokenRefresher` calls
`this.tokens.set(response.accessToken, response.account)` on every refresh, with a **new account
object** each time, so a key that read the account itself would blow away every store fifteen
minutes into a session. Reading the `customerId` off it is what makes a refresh free and a switch
loud.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/auth/access-token.store.ts`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/auth/access-token.store.spec.ts`

**Interfaces:**
- Consumes: `CurrentAccount` from `@peakpower-nl/api-client-customer` (already imported in this file).
- Produces: `AccessTokenStore.activeCustomerId: Signal<string | null>`. Consumed by
  `CompanyStore` (Task 5), `EntitlementStore` (Task 6), `CustomerNavService` (Task 7) and
  `BusinessSwitcher` (Task 9).

- [ ] **Step 1: Write the failing tests**

Append to `apps/customer-portal/src/app/auth/access-token.store.spec.ts`, inside the existing
`describe('AccessTokenStore', …)` block, after its last `it`:

```ts
  // ── the business the session is acting for ───────────────────────────────
  //
  // Every session-scoped cache in the portal resets on THIS, and the reason it is not
  // `isSignedIn` is the whole of design §7: a computed does not notify its dependents when its
  // value is unchanged, so a switch that replaces the token in place recomputes true from true
  // and nothing downstream ever hears about it.

  it('names the business the current token was minted for', () => {
    store.set('the-token', ACCOUNT);

    expect(store.activeCustomerId()).toBe('c1');
  });

  it('follows the token to another business', () => {
    store.set('the-token', ACCOUNT);
    // No clear() in between, because a switch has none: POST /auth/active-business re-mints and
    // the client replaces the token in place.
    store.set('another-token', { ...ACCOUNT, customerId: 'c2' });

    expect(store.activeCustomerId()).toBe('c2');
  });

  it('is null with no session at all, which is not the same as a business called null', () => {
    expect(store.activeCustomerId()).toBeNull();

    store.set('the-token', ACCOUNT);
    store.clear();
    expect(store.activeCustomerId()).toBeNull();
  });

  it('reads the BUSINESS, not the account — the two are different ids on the same object', () => {
    // A store that returned accountId would satisfy every other test in this block, because the
    // fixtures above only ever move both at once.
    store.set('the-token', { ...ACCOUNT, accountId: 'a9', customerId: 'c1' });

    expect(store.activeCustomerId()).toBe('c1');
  });
```

- [ ] **Step 2: Run them and read the exact failure**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task3-red.txt 2>&1; tail -25 /tmp/plan3-task3-red.txt
```

Expected: the run does not reach the assertions. It fails at type-check with
`TS2339: Property 'activeCustomerId' does not exist on type 'AccessTokenStore'`, four times —
once per new test.

- [ ] **Step 3: Write the implementation**

In `apps/customer-portal/src/app/auth/access-token.store.ts`, replace line `20`, which currently
reads:

```ts
  readonly isSignedIn = computed(() => this._token() !== null);
```

with:

```ts
  readonly isSignedIn = computed(() => this._token() !== null);

  /**
   * The business this session is currently acting for, or `null` with no session.
   *
   * ⚠ **This, and not `isSignedIn`, is what a session-scoped cache resets on.** A `computed`
   * compares with `Object.is` and does not notify its dependents when the value has not moved, so
   * a business SWITCH — which replaces the token in place rather than signing out and back in —
   * recomputes `isSignedIn` as `true` from `true` and propagates nothing. `CompanyStore`,
   * `EntitlementStore` and the rail's connections resource were all keyed on that boolean and all
   * three kept the previous business's data (design §7).
   *
   * ⚠ And it must be the **id**, not the account object. `TokenRefresher.refresh()` calls
   * `set(response.accessToken, response.account)` with a fresh account object every fifteen
   * minutes; a key that read the object would change identity on every refresh and drop every
   * cache the portal holds. Reading `customerId` off it makes a refresh free (`'c1'` is `'c1'`)
   * and a switch loud (`'c1'` is not `'c2'`).
   */
  readonly activeCustomerId = computed(() => this._account()?.customerId ?? null);
```

- [ ] **Step 4: Run them green**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task3-green.txt 2>&1; tail -12 /tmp/plan3-task3-green.txt
```

Expected: green, with four more tests than the previous run reported.

- [ ] **Step 5: Mutate — prove the fourth test is not decoration**

In `access-token.store.ts`, change the new line to:

```ts
  readonly activeCustomerId = computed(() => this._account()?.accountId ?? null);
```

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task3-mutant.txt 2>&1; grep -n "AccessTokenStore" /tmp/plan3-task3-mutant.txt > /tmp/plan3-task3-mutant-lines.txt; cat /tmp/plan3-task3-mutant-lines.txt
```

Predicted: **four** failures in `access-token.store.spec.ts`, and the fourth one is the
interesting one — `reads the BUSINESS, not the account` fails with
`expected 'a9' to be 'c1'`, because that fixture is the only one whose two ids differ. The first
three fail with `expected 'a1' to be 'c1'` and friends.

⚠ If only the first three fail, the fourth test's fixture was copied without the differing
`accountId` and it is testing nothing.

Restore, re-run, and prove the restore:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web diff -- apps/customer-portal/src/app/auth/access-token.store.ts > /tmp/plan3-task3-diff.txt
grep -c "accountId" /tmp/plan3-task3-diff.txt
npx ng test customer-portal --watch=false > /tmp/plan3-task3-restored.txt 2>&1; tail -8 /tmp/plan3-task3-restored.txt
```

`grep -c accountId` on the diff must print `0` — the mutation is gone — and the suite is green.

- [ ] **Step 6: Commit**

```bash
git -C /Users/thinhhuynh/PeakPower/peakpower-web add \
  apps/customer-portal/src/app/auth/access-token.store.ts \
  apps/customer-portal/src/app/auth/access-token.store.spec.ts
git -C /Users/thinhhuynh/PeakPower/peakpower-web commit -m "Say which business the session is acting for, as an id and not a boolean

Every session-scoped cache in this portal resets on isSignedIn, which is a
computed boolean. A business switch replaces the token in place, so that computed
recomputes true from true and, because a signal does not notify dependents when
its value has not moved, nothing downstream ever hears about it - the company, the
entitlement shelf and the rail's connections all keep the business the customer
just left.

activeCustomerId is the id instead. 'c1' to 'c2' propagates and 'c1' to 'c1' does
not, which is the half that matters second: TokenRefresher replaces the token with
a fresh account object every fifteen minutes, and a key that read the object would
drop every cache in the portal on each refresh.

Verified by mutation: returning accountId instead fails all four new tests, and
the one that pins the distinction fails with 'a9' where 'c1' was expected.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `CompanyStore` — a real reset, a generation counter, and an effect keyed on the business

Three of the five defects live in this one file, and the third is the one that survives a naive
fix.

```ts
  private readonly company = signal<CompanyProfile | null>(null);
  private readonly failure = signal<unknown>(null);
  private pending: Observable<CompanyProfile> | null = null;

  constructor() {
    effect(() => {
      if (this.tokens.isSignedIn()) {
        this.load().subscribe({ error: () => undefined });
      } else {
        this.company.set(null);
        this.failure.set(null);
        this.pending = null;
      }
    });
  }
```

1. **The effect is keyed on a boolean** (Task 4's finding), so a switch never re-runs it.
2. **`pending` is a plain class field holding a `shareReplay({ bufferSize: 1, refCount: false })`.**
   Clearing only `company` would leave that memo in place, and the next `load()` — whose first
   line is `if (known !== null) return of(known)`, then `this.pending ??= …` — hands back the OLD
   business's profile **with no HTTP call at all**. There is no `reset()` on this class to call
   either: the sign-out branch inlines it, so nothing outside the constructor can invalidate.
3. **Nothing is cancellable.** `this.load().subscribe(…)` is never unsubscribed, so when a `GET`
   issued for the old business finally answers, its `tap` writes into a store that has already
   been cleared and reloaded. A reset alone does not fix this; it needs a counter.

⚠ **`untracked()` is not optional.** The effect body calls `load()`, which **reads** `company()`,
and `reset()` **writes** it. Without `untracked`, the effect depends on a signal it writes: it
re-runs, resets, writes, re-runs — an infinite loop. Wrapping the imperative half leaves
`activeCustomerId()` as the effect's only dependency, which is exactly what it should be.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/shell/company.store.ts`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/shell/company.store.spec.ts`

**Interfaces:**
- Consumes: `AccessTokenStore.activeCustomerId: Signal<string | null>` (Task 4).
- Produces: `CompanyStore.reset(): void` — public, so a future caller outside the constructor can
  invalidate; `CompanyStore.load()` and `CompanyStore.profile` unchanged in signature.

- [ ] **Step 1: Give the second business its own profile in the fixture**

`company.store.spec.ts:143` already builds a second business by spread for the sign-out case.
Both new tests need a second **profile** as well. Insert after the `PROFILE` constant (after line
`39`):

```ts
/** The business the switch lands in. A different id AND a different legal name, so an
 *  assertion on the name cannot be satisfied by the first company's answer. */
const ZAANSE: CompanyProfile = { ...PROFILE, id: 'c2', legalName: 'Zaanse Koeling B.V.' };

/** The same person, signed in to that second business — what POST /auth/active-business re-mints. */
const ACCOUNT_C2: CurrentAccount = { ...ACCOUNT, customerId: 'c2' };
```

- [ ] **Step 2: Write the failing tests**

Append inside `describe('CompanyStore', …)`, after its last `it`:

```ts
  // ── switching business, which is NOT signing out and back in ─────────────

  it('reloads for the new business when the token is replaced in place', () => {
    const store = TestBed.inject(CompanyStore);
    tokens.set('the-token', ACCOUNT);
    TestBed.tick();
    http.expectOne(URL).flush(PROFILE);

    // No clear(). This is the whole difference between a switch and a sign-out, and the store
    // used to be keyed on a boolean that cannot tell them apart.
    tokens.set('another-token', ACCOUNT_C2);
    TestBed.tick();

    http.expectOne(URL).flush(ZAANSE);
    expect(store.profile()?.legalName).toBe('Zaanse Koeling B.V.');
  });

  it('clears the memo as well as the signal, so the reload is a request and not a replay', () => {
    const store = TestBed.inject(CompanyStore);
    tokens.set('the-token', ACCOUNT);
    TestBed.tick();
    http.expectOne(URL).flush(PROFILE);

    tokens.set('another-token', ACCOUNT_C2);
    TestBed.tick();

    // Between the switch and the answer the store holds NOTHING. A reset that nulled the signal
    // and left `pending` alone would still read null here — and then `load()` below would replay
    // the first company out of the shareReplay with no request at all, which is the defect.
    expect(store.profile()).toBeNull();

    const outstanding = http.match(URL);
    expect(outstanding).toHaveLength(1);
    let replayed: CompanyProfile | null = null;
    store.load().subscribe((profile) => (replayed = profile));
    // Still one: the reader joined the in-flight request rather than starting a second.
    expect(http.match(URL)).toHaveLength(0);
    outstanding[0].flush(ZAANSE);
    expect(replayed).toEqual(ZAANSE);
  });

  it('drops an answer that arrives for the business the session has already left', () => {
    const store = TestBed.inject(CompanyStore);
    tokens.set('the-token', ACCOUNT);
    TestBed.tick();
    // Deliberately NOT flushed: this is the request that is still in flight when the switch lands.
    const stale = http.expectOne(URL);

    tokens.set('another-token', ACCOUNT_C2);
    TestBed.tick();
    const fresh = http.expectOne(URL);

    fresh.flush(ZAANSE);
    expect(store.profile()?.legalName).toBe('Zaanse Koeling B.V.');

    // And now the old business answers, late. Nothing unsubscribed it — the effect's
    // `.subscribe(...)` is never torn down — so its `tap` still runs.
    stale.flush(PROFILE);
    expect(store.profile()?.legalName).toBe('Zaanse Koeling B.V.');
    expect(store.error()).toBeNull();
  });

  it('does not re-fetch when a refresh replaces the token for the same business', () => {
    const store = TestBed.inject(CompanyStore);
    tokens.set('the-token', ACCOUNT);
    TestBed.tick();
    http.expectOne(URL).flush(PROFILE);

    // TokenRefresher does exactly this every fifteen minutes, with a FRESH account object off the
    // wire. A store keyed on the account rather than on its business id would drop and re-fetch
    // the company on every refresh for the life of the tab.
    tokens.set('a-fresher-token', { ...ACCOUNT });
    TestBed.tick();

    http.expectNone(URL);
    expect(store.profile()?.legalName).toBe('Vandersteen Koeling B.V.');
  });
```

- [ ] **Step 3: Run them and read the exact failures**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task4-red.txt 2>&1; grep -n "CompanyStore" /tmp/plan3-task4-red.txt > /tmp/plan3-task4-red-lines.txt; cat /tmp/plan3-task4-red-lines.txt; tail -30 /tmp/plan3-task4-red.txt
```

Expected: **three** of the four fail, and the fourth passes for the wrong reason.

- `reloads for the new business when the token is replaced in place` →
  `Error: Expected one matching request for criteria "Match URL: /api/v1/company", found none.`
  The effect never re-ran.
- `clears the memo as well as the signal…` → fails EARLIER than the request assertion, on
  `expect(store.profile()).toBeNull()`, reading
  `expected { id: 'c1', legalName: 'Vandersteen Koeling B.V.', … } to be null`. Nothing reset, so
  the first business is still sitting there. (Fix only the reset and this test fails one line
  later instead, on `expect(outstanding).toHaveLength(1)` reading
  `expected [] to have a length of 1 but got +0` — because the memo replayed and no request was
  ever issued. That two-stage failure is the point of the test.)
- `drops an answer that arrives for the business the session has already left` → the same message
  on the second `expectOne`.
- `does not re-fetch when a refresh replaces the token for the same business` → **passes**, because
  nothing re-fetches for any reason yet. It is written now because it is the test that stops the
  fix over-firing, and Step 5's second mutation is what gives it teeth.

- [ ] **Step 4: Write the implementation**

Replace the whole of `apps/customer-portal/src/app/shell/company.store.ts` with:

```ts
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { CustomerApiClient } from '@peakpower-nl/api-client-customer';
import type { CompanyProfile } from '@peakpower-nl/api-client-customer';
import { of, shareReplay, tap } from 'rxjs';
import type { Observable } from 'rxjs';

import { AccessTokenStore } from '../auth/access-token.store';

/**
 * The customer's own company, held once for the whole portal.
 *
 * Two readers: the rail's account footer names the company on EVERY screen, and the Company
 * screen prints it in full. Left as a fetch per reader, standing on `/company` would issue the
 * identical GET twice — and, worse, would let the footer and the page disagree about the legal
 * name for as long as the second one was in flight.
 *
 * Deliberately the same shape as `EntitlementStore`, down to the session effect and the
 * generation counter: two stores that hold session-scoped data in two different ways is how one
 * of them ends up leaking a company into the next customer's tab.
 */
@Injectable({ providedIn: 'root' })
export class CompanyStore {
  private readonly api = inject(CustomerApiClient);
  private readonly tokens = inject(AccessTokenStore);

  /** `null` means "not asked yet, or it failed" — never "the company has no name". */
  private readonly company = signal<CompanyProfile | null>(null);
  private readonly failure = signal<unknown>(null);
  private pending: Observable<CompanyProfile> | null = null;

  /**
   * Which session this store is answering for. Bumped by every `reset()`, captured by every
   * request, and compared before anything is written back.
   *
   * ⚠ It is not bookkeeping. Nothing here is cancellable — the constructor's
   * `this.load().subscribe(...)` is never unsubscribed — so a GET issued for business A can land
   * AFTER the switch to B has already cleared this store and fetched B's profile. Without the
   * counter that late answer overwrites B with A, silently, and the rail's footer then names a
   * company the session is no longer in. Design §7: "nothing is cancellable, so an in-flight
   * request from the old business can write into a just-cleared store."
   */
  private generation = 0;

  readonly profile = this.company.asReadonly();
  /** The failure itself, so an unreachable server can be told from a broken one. */
  readonly error = this.failure.asReadonly();

  constructor() {
    // ⚠ Keyed on the BUSINESS, not on `isSignedIn()`. A switch replaces the token in place, so a
    // boolean recomputes true from true and this effect would never run again — the defect design
    // §7 names first. `activeCustomerId` is a string, so 'c1' -> 'c2' fires and a refresh's
    // 'c1' -> 'c1' does not.
    //
    // ⚠ `untracked` is load-bearing, not tidiness. `load()` READS `company()` and `reset()` WRITES
    // it; without the wrapper this effect depends on a signal it writes and re-runs itself
    // forever. Wrapped, the only dependency is `activeCustomerId()`.
    //
    // Reset FIRST, then load. One order for all three cases — signing out, signing in, switching —
    // rather than a branch per case, which is where the old code's sign-out-only invalidation came
    // from.
    effect(() => {
      const business = this.tokens.activeCustomerId();
      untracked(() => {
        this.reset();
        if (business !== null) {
          this.load().subscribe({ error: () => undefined });
        }
      });
    });
  }

  /**
   * Forget the company, the failure AND the memoised request, and disown every answer already in
   * flight.
   *
   * ⚠ **`pending` matters as much as the signal.** It holds a
   * `shareReplay({ bufferSize: 1, refCount: false })`, which keeps its last value for every future
   * subscriber. Null the signal alone and the next `load()` falls through to `this.pending ??= …`,
   * finds the memo already there, and replays the PREVIOUS business's profile without issuing a
   * request — a store that looks like it reloaded and did not. Design §7: "each memoises a
   * shareReplay in a plain class field, so clearing the signal replays the old business with no
   * HTTP call."
   *
   * Public because the constructor is no longer the only conceivable caller; the effect is simply
   * the only one today.
   */
  reset(): void {
    this.generation++;
    this.company.set(null);
    this.failure.set(null);
    this.pending = null;
  }

  /**
   * The profile, fetched at most once per business.
   *
   * Callable with no session on purpose: a screen spec that mounts the Company page in isolation
   * has no token, and a store that only ever loaded from the session effect would leave it
   * looking at an empty page. The effect is what keeps the rail's footer filled without anybody
   * asking; this is what a reader calls.
   */
  load(): Observable<CompanyProfile> {
    const known = this.company();
    if (known !== null) return of(known);

    // Captured HERE, at the moment the request is issued, and compared in both handlers below.
    // Reading `this.generation` inside the handlers instead would compare the current value with
    // itself and prove nothing.
    const issuedFor = this.generation;

    this.pending ??= this.api.getCompany().pipe(
      tap({
        next: (profile) => {
          if (issuedFor !== this.generation) return;
          this.company.set(profile);
          this.failure.set(null);
        },
        error: (error: unknown) => {
          if (issuedFor !== this.generation) return;
          this.failure.set(error);
          this.pending = null;
        },
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    return this.pending;
  }
}
```

- [ ] **Step 5: Run them green**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task4-green.txt 2>&1; tail -12 /tmp/plan3-task4-green.txt
```

Expected: green, including the eight tests `company.store.spec.ts` had before this task. In
particular `drops the company when the session ends` and `asks again for the next session rather
than replaying the last company` must both still pass — `tokens.clear()` sets the account to
`null`, so `activeCustomerId()` moves `'c1' -> null` and the effect resets with nothing to load.

- [ ] **Step 6: Mutate — twice, because there are two independent mechanisms**

**Mutation A — remove the generation guard**, which is the mechanism only the third test exercises.
In `load()`, delete the two guard lines so the handlers read:

```ts
        next: (profile) => {
          this.company.set(profile);
          this.failure.set(null);
        },
        error: (error: unknown) => {
          this.failure.set(error);
          this.pending = null;
        },
```

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task4-mutantA.txt 2>&1; grep -n "already left" /tmp/plan3-task4-mutantA.txt > /tmp/plan3-task4-mutantA-line.txt; cat /tmp/plan3-task4-mutantA-line.txt; tail -25 /tmp/plan3-task4-mutantA.txt
```

Predicted: **exactly one** failure —
`CompanyStore > drops an answer that arrives for the business the session has already left`, on
the assertion after `stale.flush(PROFILE)`, reading
`expected 'Vandersteen Koeling B.V.' to be 'Zaanse Koeling B.V.'`. The other three new tests stay
green, which is what proves the counter is a *separate* mechanism from the reset and not a
duplicate of it. Restore both guard lines.

**Mutation B — key the effect on the account object instead of its business id.** Change the
effect's first line to:

```ts
      const business = this.tokens.account();
```

and the guard below it to `if (business !== null) {`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task4-mutantB.txt 2>&1; grep -n "does not re-fetch when a refresh" /tmp/plan3-task4-mutantB.txt > /tmp/plan3-task4-mutantB-line.txt; cat /tmp/plan3-task4-mutantB-line.txt; tail -25 /tmp/plan3-task4-mutantB.txt
```

Predicted: **exactly one** failure —
`CompanyStore > does not re-fetch when a refresh replaces the token for the same business`, with
`Error: Expected zero matching requests for criteria "Match URL: /api/v1/company", found 1.` The
switch tests stay green, because an account object DOES change on a switch — which is precisely
why that mutation is plausible and why the fourth test had to exist.

Restore, and prove it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web diff -- apps/customer-portal/src/app/shell/company.store.ts > /tmp/plan3-task4-diff.txt
grep -c "tokens.account()" /tmp/plan3-task4-diff.txt
grep -c "issuedFor" /tmp/plan3-task4-diff.txt
npx ng test customer-portal --watch=false > /tmp/plan3-task4-restored.txt 2>&1; tail -8 /tmp/plan3-task4-restored.txt
```

The first `grep -c` must print `0` (mutation B gone) and the second a non-zero count (the guard is
back in the diff as an addition), and the suite is green.

- [ ] **Step 7: Commit**

```bash
git -C /Users/thinhhuynh/PeakPower/peakpower-web add \
  apps/customer-portal/src/app/shell/company.store.ts \
  apps/customer-portal/src/app/shell/company.store.spec.ts
git -C /Users/thinhhuynh/PeakPower/peakpower-web commit -m "Drop the company when the business moves, not only when the session ends

Three defects in one file. The session effect was keyed on isSignedIn, a boolean,
so replacing the token in place recomputed true from true and never re-ran. The
memoised shareReplay lived in a plain field that only the sign-out branch cleared,
so nulling the signal alone would have replayed the previous business's profile
with no HTTP call at all. And nothing here is cancellable - the effect's subscribe
is never torn down - so a GET issued for the old business could land after the
switch and overwrite the new one.

reset() now nulls the signal AND the memo and bumps a generation counter; load()
captures that generation when it issues and compares it before writing back; the
effect keys on activeCustomerId and resets before it loads, wrapped in untracked
because load() reads the signal reset() writes and the effect would otherwise feed
itself forever.

Verified by two mutations. Removing the generation guard fails only the late-answer
test, and keying the effect on the account object instead of its business id fails
only the refresh test - which is the one that stops the fix firing every fifteen
minutes for the rest of the tab's life.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `EntitlementStore` — the same three changes, plus one `replace()` fixes for free

`EntitlementStore` has the identical shape to `CompanyStore` and the identical three defects. It
also has a fourth reader nothing else has — `replace(items)`, which the Entitlements screen calls
with the body its POST returned — and that method has a race of its own that the generation
counter closes at no extra cost: it nulls `pending` but cannot stop an in-flight `load()` from
overwriting the shelf it just replaced.

This store is more dangerous to get wrong than `CompanyStore`. `EntitlementStore.held()` decides
which rail rows exist **and** which URLs `entitlementGuard` opens. A shelf carried across a switch
does not merely show a stale name: it admits somebody to `/connections` in a business that does
not hold `day-ahead`.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/shell/entitlement.store.ts`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/shell/entitlement.store.spec.ts`

**Interfaces:**
- Consumes: `AccessTokenStore.activeCustomerId: Signal<string | null>` (Task 4).
- Produces: `EntitlementStore.reset(): void`; `load()`, `items`, `loaded`, `held` and
  `replace(items: readonly CompanyEntitlement[])` unchanged in signature.

- [ ] **Step 1: Give the second business its own shelf**

Insert after the `SHELF` constant in `entitlement.store.spec.ts` (after line `38`, the closing
`];` of `SHELF`):

```ts
/** The other business holds the OTHER entitlement — so a shelf carried across the switch is
 *  visible as the wrong rail, not merely as a stale one. */
const OTHER_SHELF: CompanyEntitlement[] = [
  { ...SHELF[0], held: false },
  { ...SHELF[1], held: true },
];

/** The same person, signed in to that second business. */
const ACCOUNT_C2: CurrentAccount = { ...ACCOUNT, customerId: 'c2' };
```

⚠ Check the closing line number of `SHELF` before inserting —
`grep -n 'const SHELF' apps/customer-portal/src/app/shell/entitlement.store.spec.ts` and read to
its `];`. The constant is a two-entry array whose second entry is `future-trading`, `held: false`.

- [ ] **Step 2: Write the failing tests**

Append inside `describe('EntitlementStore', …)`, after its last `it`:

```ts
  // ── switching business ───────────────────────────────────────────────────
  //
  // Worse here than anywhere else in the portal: `held()` is what `entitlementGuard` waits on, so
  // a shelf carried across a switch does not just draw a stale rail — it opens a URL in a business
  // that does not hold the entitlement behind it.

  it('fetches the new business\'s shelf when the token is replaced in place', () => {
    const entitlements = store();
    tokens.set('the-token', ACCOUNT);
    TestBed.tick();
    http.expectOne(URL).flush({ items: SHELF });

    // No clear(). A switch re-mints and replaces; it never signs out.
    tokens.set('another-token', ACCOUNT_C2);
    TestBed.tick();

    http.expectOne(URL).flush({ items: OTHER_SHELF });
    expect([...entitlements.held()]).toEqual(['future-trading']);
  });

  it('holds nothing, and is not loaded, in the gap between the switch and the answer', () => {
    const entitlements = store();
    tokens.set('the-token', ACCOUNT);
    TestBed.tick();
    http.expectOne(URL).flush({ items: SHELF });

    tokens.set('another-token', ACCOUNT_C2);
    TestBed.tick();

    // The distinction the guard depends on, applied to a switch. `loaded()` false is what makes
    // the guard WAIT; a store that left the old shelf in place would answer instantly and wrongly.
    expect(entitlements.items()).toBeNull();
    expect(entitlements.loaded()).toBe(false);
    expect(entitlements.held().size).toBe(0);

    http.expectOne(URL).flush({ items: OTHER_SHELF });
  });

  it('drops a shelf that arrives for the business the session has already left', () => {
    const entitlements = store();
    tokens.set('the-token', ACCOUNT);
    TestBed.tick();
    const stale = http.expectOne(URL);

    tokens.set('another-token', ACCOUNT_C2);
    TestBed.tick();
    const fresh = http.expectOne(URL);

    fresh.flush({ items: OTHER_SHELF });
    expect([...entitlements.held()]).toEqual(['future-trading']);

    stale.flush({ items: SHELF });
    expect([...entitlements.held()]).toEqual(['future-trading']);
  });

  it('does not re-fetch when a refresh replaces the token for the same business', () => {
    const entitlements = store();
    tokens.set('the-token', ACCOUNT);
    TestBed.tick();
    http.expectOne(URL).flush({ items: SHELF });

    tokens.set('a-fresher-token', { ...ACCOUNT });
    TestBed.tick();

    http.expectNone(URL);
    expect([...entitlements.held()]).toEqual(['day-ahead']);
  });

  it('keeps a replaced shelf even when the request it superseded answers afterwards', () => {
    // `replace()` is what the Entitlements screen does with the body its POST returned. It nulls
    // `pending`, which stops the NEXT reader re-reading a stale memo — but it cannot unsubscribe
    // the GET already in flight, whose tap would otherwise put the pre-write shelf back and undo
    // the change the customer just watched succeed.
    const entitlements = store();
    tokens.set('the-token', ACCOUNT);
    TestBed.tick();
    const inFlight = http.expectOne(URL);

    entitlements.replace([SHELF[0], { ...SHELF[1], held: true }]);
    expect([...entitlements.held()].sort()).toEqual(['day-ahead', 'future-trading']);

    inFlight.flush({ items: SHELF });
    expect([...entitlements.held()].sort()).toEqual(['day-ahead', 'future-trading']);
  });
```

- [ ] **Step 3: Run them and read the exact failures**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task5-red.txt 2>&1; grep -n "EntitlementStore" /tmp/plan3-task5-red.txt > /tmp/plan3-task5-red-lines.txt; cat /tmp/plan3-task5-red-lines.txt; tail -35 /tmp/plan3-task5-red.txt
```

Expected: four of the five fail.

- `fetches the new business's shelf…` →
  `Error: Expected one matching request for criteria "Match URL: /api/v1/company/entitlements", found none.`
- `holds nothing, and is not loaded, in the gap…` → `expected [ { code: 'day-ahead', … } ] to be null`, on the first assertion.
- `drops a shelf that arrives for the business the session has already left` → the `found none.` message on the second `expectOne`.
- `keeps a replaced shelf even when the request it superseded answers afterwards` →
  `expected [ 'day-ahead' ] to deeply equal [ 'day-ahead', 'future-trading' ]`, after the late flush undid the replace.
- `does not re-fetch when a refresh replaces the token for the same business` → **passes** for now, for the same reason its `CompanyStore` twin does.

- [ ] **Step 4: Write the implementation**

Replace the whole of `apps/customer-portal/src/app/shell/entitlement.store.ts` with:

```ts
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { CustomerApiClient } from '@peakpower-nl/api-client-customer';
import type { CompanyEntitlement } from '@peakpower-nl/api-client-customer';
import { of, shareReplay, tap } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Observable } from 'rxjs';

import { AccessTokenStore } from '../auth/access-token.store';

/**
 * What the company holds, held once for the whole portal.
 *
 * THREE readers need the same answer and must never disagree about it: the rail decides which
 * rows exist, the route guards decide which URLs open, and the Entitlements screen shows the
 * shelf. A resource per reader would issue three requests and, worse, would let the rail and
 * the guard answer differently for the seconds between them landing — a row that is there and
 * a URL that refuses it.
 *
 * `GET /company/entitlements` is deliberately open to ANY authenticated account rather than to
 * admins, precisely so this can be the rail's input; only the POST is admin-only.
 */
@Injectable({ providedIn: 'root' })
export class EntitlementStore {
  private readonly api = inject(CustomerApiClient);
  private readonly tokens = inject(AccessTokenStore);

  /** `null` means "not asked yet", which is not the same as "holds nothing". */
  private readonly shelf = signal<readonly CompanyEntitlement[] | null>(null);
  private pending: Observable<readonly CompanyEntitlement[]> | null = null;

  /**
   * Which session this store is answering for — bumped by `reset()` and by `replace()`, captured
   * by every request, compared before anything is written back.
   *
   * ⚠ Nothing here is cancellable, so a GET issued for business A can land after the switch to B
   * and put A's shelf back. That is worse than a stale name: `held()` is what `entitlementGuard`
   * waits on, so the wrong shelf opens a URL in a business that does not hold the entitlement
   * behind it.
   */
  private generation = 0;

  /** The whole catalogue with this company's holdings marked, or `null` before it lands. */
  readonly items = this.shelf.asReadonly();

  /** Has the shelf landed at all? The rail draws its gated rows only once it has. */
  readonly loaded = computed(() => this.shelf() !== null);

  /**
   * The held CODES. A set rather than a list because every reader asks the same question of it —
   * "does this company hold `future-trading`" — and never iterates it.
   *
   * Empty before the shelf lands, which is what makes the rail's gated rows appear rather than
   * flicker away: an unloaded shelf hides them, and they arrive with the answer.
   *
   * ⚠ It is a FRESH Set on every recompute, so a reader that funnels it into an `rxResource`
   * params function re-fetches on every unrelated entitlement change. See `CustomerNavService`.
   */
  readonly held = computed(
    () => new Set((this.shelf() ?? []).filter((entry) => entry.held).map((entry) => entry.code)),
  );

  constructor() {
    // The shelf belongs to the BUSINESS, not merely to the session. Signing out has to drop it, or
    // the next person to sign in on this tab gets the previous company's rail until their own
    // answer lands — and the guards would admit them to it. SWITCHING has to drop it for the same
    // reason and one worse: it is the same person, so nothing else about the tab changes.
    //
    // ⚠ Keyed on `activeCustomerId`, a string, and not on `isSignedIn()`, a boolean that
    // recomputes true from true across a switch and notifies nobody.
    //
    // ⚠ `untracked` is what stops this feeding itself: `load()` reads `shelf()` and `reset()`
    // writes it, so an unwrapped body depends on a signal it writes and re-runs forever.
    effect(() => {
      const business = this.tokens.activeCustomerId();
      untracked(() => {
        this.reset();
        if (business !== null) {
          this.load().subscribe({ error: () => undefined });
        }
      });
    });
  }

  /**
   * Forget the shelf AND the memoised request, and disown every answer already in flight.
   *
   * ⚠ Nulling `shelf` alone is not enough. `pending` holds a
   * `shareReplay({ bufferSize: 1, refCount: false })`, so the next `load()` would find the memo
   * and replay the PREVIOUS business's shelf without issuing a request — the rail would rebuild
   * itself out of the entitlements of a company the customer has left.
   */
  reset(): void {
    this.generation++;
    this.shelf.set(null);
    this.pending = null;
  }

  /**
   * The shelf, fetched at most once per business.
   *
   * Guards call this and wait on it — a guard that read `held()` directly would refuse every
   * gated URL on a cold page load, because nothing has answered yet. The in-flight request is
   * shared, so three guards and the rail arriving together cost one round trip.
   *
   * A failure clears `pending` so the next caller retries, rather than caching the error for the
   * life of the tab.
   */
  load(): Observable<readonly CompanyEntitlement[]> {
    const known = this.shelf();
    if (known !== null) return of(known);

    // Captured at issue time. Read inside the handlers instead and it would compare the current
    // generation with itself, which is always equal and always useless.
    const issuedFor = this.generation;

    this.pending ??= this.api.getCompanyEntitlements().pipe(
      map((response) => response.items),
      tap({
        next: (items) => {
          if (issuedFor !== this.generation) return;
          this.shelf.set(items);
        },
        error: () => {
          if (issuedFor !== this.generation) return;
          this.pending = null;
        },
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    return this.pending;
  }

  /**
   * Replace the shelf with the answer a write returned.
   *
   * `POST /company/entitlements` answers with the WHOLE shelf rather than the one row that
   * changed, so this replaces rather than patches: patching is where a rail and a screen start
   * disagreeing about what the company holds.
   *
   * ⚠ It bumps the generation, and that is not symmetry for its own sake. Nulling `pending` stops
   * the next READER re-reading a stale memo; it cannot unsubscribe a GET already in flight, whose
   * `tap` would otherwise put the pre-write shelf back and quietly undo a change the customer
   * watched succeed.
   */
  replace(items: readonly CompanyEntitlement[]): void {
    this.generation++;
    this.pending = null;
    this.shelf.set(items);
  }
}
```

- [ ] **Step 5: Run them green**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task5-green.txt 2>&1; tail -12 /tmp/plan3-task5-green.txt
```

Expected: green, including this file's nine pre-existing tests. `replaces the shelf wholesale with
what a write returned` must still pass — `replace()` still sets the shelf and still serves the
next reader from memory.

- [ ] **Step 6: Mutate — the counter, on the path only `replace()` walks**

`CompanyStore` already proved the counter closes the late-answer window on a switch. The mutation
here targets the half that is specific to this class.

In `replace()`, delete the `this.generation++;` line so it reads:

```ts
  replace(items: readonly CompanyEntitlement[]): void {
    this.pending = null;
    this.shelf.set(items);
  }
```

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task5-mutant.txt 2>&1; grep -n "keeps a replaced shelf" /tmp/plan3-task5-mutant.txt > /tmp/plan3-task5-mutant-line.txt; cat /tmp/plan3-task5-mutant-line.txt; tail -25 /tmp/plan3-task5-mutant.txt
```

Predicted: **exactly one** failure —
`EntitlementStore > keeps a replaced shelf even when the request it superseded answers afterwards`,
reading `expected [ 'day-ahead' ] to deeply equal [ 'day-ahead', 'future-trading' ]`. Every switch
test stays green, because they never call `replace()`.

Restore, and prove it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web diff -- apps/customer-portal/src/app/shell/entitlement.store.ts > /tmp/plan3-task5-diff.txt
grep -c "this.generation++" /tmp/plan3-task5-diff.txt
npx ng test customer-portal --watch=false > /tmp/plan3-task5-restored.txt 2>&1; tail -8 /tmp/plan3-task5-restored.txt
```

`grep -c` must print `2` — one added `this.generation++` in `reset()`, one in `replace()` — and the
suite is green.

- [ ] **Step 7: Commit**

```bash
git -C /Users/thinhhuynh/PeakPower/peakpower-web add \
  apps/customer-portal/src/app/shell/entitlement.store.ts \
  apps/customer-portal/src/app/shell/entitlement.store.spec.ts
git -C /Users/thinhhuynh/PeakPower/peakpower-web commit -m "Fetch the new business's shelf, and never let the old one answer for it

Same three defects as CompanyStore, and they matter more here: held() is what the
rail draws its rows from AND what entitlementGuard waits on, so a shelf carried
across a business switch does not merely look stale - it opens a URL in a company
that does not hold the entitlement behind it.

The effect keys on activeCustomerId and resets before it loads; reset() nulls the
memoised shareReplay as well as the signal; load() captures a generation and drops
an answer issued under an older one.

replace() bumps the generation too, which closes a race it always had: it nulled
pending, so the next reader was safe, but it could not unsubscribe a GET already in
flight, whose tap put the pre-write shelf back and undid a change the customer had
watched succeed.

Verified by mutation: dropping the generation bump from replace() alone fails
exactly the test that pins that race, and no switch test notices.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `CustomerNavService` — re-key the rail's connections resource on the business

The fourth confirmed defect: the rail's `rxResource` is keyed on a boolean derived from
`isSignedIn()`.

```ts
  private readonly namesConnections = computed(
    () => this.tokens.isSignedIn() && this.entitlements.held().has(DAY_AHEAD),
  );

  private readonly connections = rxResource({
    params: () => (this.namesConnections() ? true : undefined),
    stream: () => this.api.listConnections(''),
  });
```

⚠ **Read this before writing the test, because it changes what the test can honestly claim.**
Once Task 6 lands, this boolean is *incidentally* rescued: `EntitlementStore.reset()` nulls the
shelf, `held()` empties, `namesConnections` flips `true -> false -> true` across the switch, and
the resource reloads. The re-key is therefore **not** what makes the switch work — Task 6 is —
and Step 5 below reports a mutation that does **not** bite, with its reason, rather than
manufacturing one that does.

It is made anyway, and design §7 names it: *"re-key the nav resource."* The reason is that the
boolean's correctness is borrowed. It depends on this resource **observing** the intermediate
`false`, which depends in turn on the order and the scheduling of another store's effect. Nothing
states that dependency, no test covers it, and the day the shelf is served from anything faster
than a round trip — a cache, a preload, a `replace()` in the same flush — the boolean goes
`true -> true` and the rail keeps the previous business's four connections while the reader looks
straight at them. Keying on the business id states the dependency the rail actually has.

The existing warning on `namesConnections` stays true and must survive the edit verbatim in
substance: **the entitlement set must not be read straight from `params`**, because `held()`
builds a fresh `Set` on every recompute and `rxResource` re-runs its load when its params
function's *dependencies* change, not only when its *value* does. Funnelling through a computed
that returns a **string** keeps that property — `'c1' === 'c1'` does not propagate — exactly as
funnelling through a boolean did.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/shell/customer-nav.service.ts:36-56`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/shell/customer-nav.service.spec.ts`

**Interfaces:**
- Consumes: `AccessTokenStore.activeCustomerId: Signal<string | null>` (Task 4);
  `EntitlementStore.held: Signal<Set<string>>` (Task 6, signature unchanged);
  `DAY_AHEAD = 'day-ahead'` from `./customer-nav`.
- Produces: nothing new on the public surface. `sections`, `namedIds` and `connectionCount` keep
  their names and types.

- [ ] **Step 1: Write the test**

Append inside `describe('CustomerNavService', …)`, after its last `it`:

```ts
  it('empties the rail and re-asks when the token is replaced in place', async () => {
    const nav = await railFor(SHELF, SIX);
    expect(nav.namedIds()).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(nav.connectionCount()).toBe(6);

    // A switch. No clear(), no sign-out — POST /auth/active-business re-mints and replaces.
    tokens.set('another-token', { ...ACCOUNT, customerId: 'c2' });
    TestBed.tick();

    // In the gap: NOTHING from the business the customer has left. Not four rows waiting to be
    // replaced, and not a count — a rail that kept them would be naming connections the new
    // business cannot open, each of which is a link to a 404.
    expect(nav.namedIds()).toEqual([]);
    expect(nav.connectionCount()).toBeNull();
    expect(group(nav.sections(), 'Day Ahead')).toBeUndefined();

    http.expectOne(ENTITLEMENTS_URL).flush({ items: SHELF });
    await new Promise((resolve) => setTimeout(resolve, 0));
    TestBed.tick();

    http
      .expectOne(CONNECTIONS_URL)
      .flush({ items: [connection('m9', 'Zaandam koelcel')], total: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    TestBed.tick();

    expect(nav.namedIds()).toEqual(['m9']);
    expect(group(nav.sections(), 'Day Ahead')!.items.map((row) => row.label)).toEqual([
      'Zaandam koelcel',
      'More…',
    ]);
  });
```

- [ ] **Step 2: Run it, and read the result honestly**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task6-first.txt 2>&1; grep -n "CustomerNavService" /tmp/plan3-task6-first.txt > /tmp/plan3-task6-first-lines.txt; cat /tmp/plan3-task6-first-lines.txt; tail -20 /tmp/plan3-task6-first.txt
```

Expected: **green, before the production change.** That is not a mistake in the test and it is not
a reason to skip the change — it is the finding recorded above, arriving as evidence: Task 6's
reset is what makes the switch work, and this test is a regression guard on the behaviour rather
than a driver for the key. Write down that it was green here; a reviewer who is told will accept
it, and a reviewer who finds it themselves will not.

⚠ If it is **red**, something in Task 5 or Task 6 did not land — go back and read
`/tmp/plan3-task5-green.txt` before continuing.

- [ ] **Step 3: Write the implementation**

In `apps/customer-portal/src/app/shell/customer-nav.service.ts`, replace lines `36-56`, which
currently read:

```ts
  /**
   * ⚠ A COMPUTED, and the resource's params reads nothing else.
   *
   * `rxResource` re-runs its load whenever the params function's DEPENDENCIES change, not only
   * when the value it returns changes — and `EntitlementStore.held()` builds a fresh Set on
   * every recompute. Reading it straight from `params` therefore re-fetched the whole
   * connections list every time any entitlement moved, including the ones that have nothing to
   * do with connections. Verified: switching Future Trading on issued a second
   * `GET /metering-points`.
   *
   * Funnelling it through a boolean computed fixes it at the source. `true === true`, so the
   * computed does not propagate and the params function is never re-run at all.
   */
  private readonly namesConnections = computed(
    () => this.tokens.isSignedIn() && this.entitlements.held().has(DAY_AHEAD),
  );

  private readonly connections = rxResource({
    params: () => (this.namesConnections() ? true : undefined),
    stream: () => this.api.listConnections(''),
  });
```

with:

```ts
  /**
   * The business whose connections the rail is naming, or `undefined` for "do not ask".
   *
   * ⚠ A COMPUTED, and the resource's params reads nothing else.
   *
   * `rxResource` re-runs its load whenever the params function's DEPENDENCIES change, not only
   * when the value it returns changes — and `EntitlementStore.held()` builds a fresh Set on
   * every recompute. Reading it straight from `params` therefore re-fetched the whole
   * connections list every time any entitlement moved, including the ones that have nothing to
   * do with connections. Verified: switching Future Trading on issued a second
   * `GET /metering-points`.
   *
   * Funnelling it through this computed fixes it at the source. The value is a STRING, so
   * `'c1' === 'c1'` does not propagate and the params function is never re-run at all — the same
   * property the boolean this replaced had, and for the same reason.
   *
   * ⚠ The business id rather than a boolean, because the boolean's correctness was BORROWED.
   * `true && held.has(DAY_AHEAD)` only notices a switch while `EntitlementStore` happens to blink
   * its shelf to null in between, which is another store's reset timing and is written down
   * nowhere. Keyed on the id, this resource states the dependency it actually has: a different
   * business is a different list, whatever the shelf did on the way.
   *
   * ⚠ `undefined`, not `null`. `params` returning `undefined` leaves the resource IDLE, which is
   * the difference between "not asked" and "asked for nothing" — and idle is what empties
   * `namedIds()` the instant a switch lands, rather than leaving the previous business's four
   * connections on the rail as links to a 404.
   */
  private readonly connectionsFor = computed<string | undefined>(() => {
    const business = this.tokens.activeCustomerId();
    if (business === null) return undefined;
    return this.entitlements.held().has(DAY_AHEAD) ? business : undefined;
  });

  private readonly connections = rxResource({
    params: () => this.connectionsFor(),
    stream: () => this.api.listConnections(''),
  });
```

- [ ] **Step 4: Run it green**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task6-green.txt 2>&1; tail -12 /tmp/plan3-task6-green.txt
```

Expected: green, including the seven tests `customer-nav.service.spec.ts` had before this task. Two
of them are the ones this edit could plausibly have broken and neither may move:
`asks for no connections at all without the day-ahead entitlement`, and `rebuilds the rail the
instant an entitlement changes, with no reload`, whose closing `http.expectNone(CONNECTIONS_URL)`
is the assertion that the fresh-`Set` funnel still works.

- [ ] **Step 5: Mutate — one that bites, and one that does not, reported as such**

**Mutation A — drop the entitlement term from the key.** Change `connectionsFor` to:

```ts
  private readonly connectionsFor = computed<string | undefined>(() => {
    const business = this.tokens.activeCustomerId();
    return business === null ? undefined : business;
  });
```

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task6-mutantA.txt 2>&1; grep -n "no connections at all" /tmp/plan3-task6-mutantA.txt > /tmp/plan3-task6-mutantA-line.txt; cat /tmp/plan3-task6-mutantA-line.txt; tail -25 /tmp/plan3-task6-mutantA.txt
```

Predicted: `CustomerNavService > asks for no connections at all without the day-ahead entitlement`
fails, because `railFor(…, null)` reaches `http.expectNone(CONNECTIONS_URL)` with the request now
in flight — `Error: Expected zero matching requests for criteria "Match URL: /api/v1/metering-points", found 1.`
`afterEach`'s `http.verify()` then fails a second time on the unflushed request. Restore.

**Mutation B — put the boolean back**, which is the change this task exists to make and therefore
the one worth being honest about. Change `connectionsFor` to:

```ts
  private readonly connectionsFor = computed<string | undefined>(() =>
    this.tokens.isSignedIn() && this.entitlements.held().has(DAY_AHEAD) ? 'yes' : undefined,
  );
```

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task6-mutantB.txt 2>&1; tail -12 /tmp/plan3-task6-mutantB.txt
```

Predicted: **green.** No test in this repository can tell the two apart, for the reason given at
the top of this task — `EntitlementStore.reset()` blinks `held()` empty in the gap, so the boolean
flips and the resource reloads anyway. **Report this result rather than hiding it.** The key stays
the business id because the behaviour it guarantees is stated in the code rather than inherited
from another store's timing, and because design §7 directs it; not because a test proves it.

Restore, and prove it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web diff -- apps/customer-portal/src/app/shell/customer-nav.service.ts > /tmp/plan3-task6-diff.txt
grep -c "isSignedIn" /tmp/plan3-task6-diff.txt
grep -c "activeCustomerId" /tmp/plan3-task6-diff.txt
npx ng test customer-portal --watch=false > /tmp/plan3-task6-restored.txt 2>&1; tail -8 /tmp/plan3-task6-restored.txt
```

The first `grep -c` must print `1` — the single removed line, still visible in the diff as a
deletion — and the second a non-zero count, and the suite is green.

- [ ] **Step 6: Commit**

```bash
git -C /Users/thinhhuynh/PeakPower/peakpower-web add \
  apps/customer-portal/src/app/shell/customer-nav.service.ts \
  apps/customer-portal/src/app/shell/customer-nav.service.spec.ts
git -C /Users/thinhhuynh/PeakPower/peakpower-web commit -m "Key the rail's connections on the business, not on being signed in

The resource asked for a boolean: signed in AND holding day-ahead. Across a
business switch that boolean is only correct by accident - it flips because
EntitlementStore blinks its shelf to null in the gap, which is another store's
reset timing, written down nowhere and covered by nothing. Serve that shelf from
anything faster than a round trip and the boolean goes true to true, and the rail
keeps naming the previous business's four connections as links to a 404.

Keyed on the business id it states the dependency it actually has. A string keeps
the property the boolean had and which the comment above it exists for: the params
function must not read held() directly, because that builds a fresh Set on every
recompute and rxResource re-runs on a dependency change rather than a value change.

Honest about the evidence: the new test passed BEFORE this change and still passes
with the boolean reinstated. Mutation A - dropping the entitlement term - does bite,
failing the no-day-ahead case. Mutation B - the boolean - does not, and that is
reported rather than dressed up.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `CustomerApiClient.setActiveBusiness` — the fourth route that carries the cookie

Contract §8 fixes the route and the request body: `POST /api/v1/auth/active-business` with
`{ customerId }`, authenticated, owned by plan 2. It does not name the response type — Deviation
D2 — so Step 1 checks the regenerated schema before anything is written against an assumption.

Design §5 says what the endpoint does: *"verifies membership, **rotates the refresh token to the
new business**, writes `last_active_business_id`, re-mints."* A rotation the browser never sees is
not a rotation, so this is the **fourth** route in the client to set `withCredentials` — joining
sign-in, refresh and sign-out, and joining them for the same reason those three give: the HttpOnly
`pp_refresh` cookie has to travel out and the replacement has to be accepted back. Deviation D3.

⚠ The route stays **off** `ANONYMOUS_PATHS` in `auth.interceptor.ts`, and that file is not edited.
A 401 here is an expired access token like any other, and it must be repaired by refresh-and-
replay; putting the route on the anonymous list would send it with no bearer, which is a
guaranteed 401 that nothing then repairs.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/libs/api-client-customer/src/lib/customer-api.client.ts`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-web/libs/api-client-customer/src/lib/customer-api.client.spec.ts`
  (run by `npx ng test customer-portal`, per `angular.json`)

**Interfaces:**
- Consumes: `SignInResponse` from `./customer-api.types` (already imported in the client).
- Produces: `CustomerApiClient.activeBusinessUrl(): string` and
  `CustomerApiClient.setActiveBusiness(customerId: string): Observable<SignInResponse>`. Consumed
  by `BusinessSwitcher` (Task 9).

- [ ] **Step 1: Check Deviation D2's assumption against the regenerated schema**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
grep -n "active-business" libs/api-client-customer/src/generated/customer-schema.d.ts > /tmp/plan3-ab.txt
cat /tmp/plan3-ab.txt
```

Take the line number of the **operation** that grep names and read around it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
sed -n '<line>,<line+60>p' libs/api-client-customer/src/generated/customer-schema.d.ts > /tmp/plan3-ab-block.txt
cat /tmp/plan3-ab-block.txt
```

Expected: a `200` response whose `application/json` content is a schema carrying `accessToken`,
`expiresAt` and an `account` of `CurrentAccountResponse` — whether or not it is *named*
`SignInResponse`. If it is that shape, this task proceeds and Deviation D2 is confirmed rather
than assumed. **If it is a different shape — a bare `204`, or an account with no token — stop:**
`AccessTokenStore.set(token, account)` needs both halves and Task 9 cannot swap a session without
them. That is a contract gap for plan 2's owner, not something to work around here.

- [ ] **Step 2: Write the failing tests**

In `libs/api-client-customer/src/lib/customer-api.client.spec.ts`, extend the URL test. Replace
line `39`, which currently reads:

```ts
    expect(api.meUrl()).toBe('/api/v1/auth/me');
```

with:

```ts
    expect(api.meUrl()).toBe('/api/v1/auth/me');
    expect(api.activeBusinessUrl()).toBe('/api/v1/auth/active-business');
```

Then append, after the test at `:240-243` (`does not send credentials on an ordinary tenant-scoped
request`):

```ts
  // ── switching business ───────────────────────────────────────────────────

  it('POSTs the chosen business to /auth/active-business and reads the new session back', () => {
    let session: SignInResponse | undefined;
    api.setActiveBusiness('cus-2').subscribe((response) => (session = response));

    const request = http.expectOne('/api/v1/auth/active-business');
    expect(request.request.method).toBe('POST');
    // The BODY, not a path segment and not a query parameter — shared contract §8 spells the
    // request `{ customerId }`.
    expect(request.request.body).toEqual({ customerId: 'cus-2' });

    request.flush({
      accessToken: 'minted-for-cus-2',
      expiresAt: '2026-09-10T12:15:00Z',
      account: {
        accountId: 'acc-1',
        customerId: 'cus-2',
        firstName: 'Peter',
        lastName: 'de Vries',
        email: 'p@v.nl',
        membershipRole: 'viewer',
        memberships: [
          { customerId: 'cus-1', tradeName: 'Vandersteen Koeling', membershipRole: 'admin' },
          { customerId: 'cus-2', tradeName: 'Zaanse Koeling', membershipRole: 'viewer' },
        ],
      },
    });

    // Both halves matter to the caller: the token is what every later request carries, and the
    // account is what tells the rest of the portal which business it is now in.
    expect(session?.accessToken).toBe('minted-for-cus-2');
    expect(session?.account.customerId).toBe('cus-2');
    // The role is the NEW business's, not the one the switch started from. A person may be an
    // admin of one and a viewer of another (design §3.3), and the screens gate on this field.
    expect(session?.account.membershipRole).toBe('viewer');
  });

  it('sends credentials on the business switch, because it rotates the pp_refresh cookie', () => {
    // Design §5: the switch "rotates the refresh token to the new business". A rotation the
    // browser never sees is not a rotation — the cookie has to travel out and the replacement has
    // to be accepted back — so this is the FOURTH route in this client to opt in, and the test
    // above it proves an ordinary tenant-scoped GET still does not.
    api.setActiveBusiness('cus-2').subscribe({ error: () => undefined });

    expect(http.expectOne('/api/v1/auth/active-business').request.withCredentials).toBe(true);
  });
```

- [ ] **Step 3: Run them and read the exact failure**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task7-red.txt 2>&1; tail -25 /tmp/plan3-task7-red.txt
```

Expected: type-check failure before any test runs —
`TS2339: Property 'activeBusinessUrl' does not exist on type 'CustomerApiClient'` and
`TS2339: Property 'setActiveBusiness' does not exist on type 'CustomerApiClient'`.

- [ ] **Step 4: Write the implementation**

In `libs/api-client-customer/src/lib/customer-api.client.ts`, replace lines `93-95`, which
currently read:

```ts
  meUrl(): string {
    return `${this.baseUrl}/auth/me`;
  }
```

with:

```ts
  meUrl(): string {
    return `${this.baseUrl}/auth/me`;
  }
  /** Shared contract §8. POST `{ customerId }`; answers a re-minted session. */
  activeBusinessUrl(): string {
    return `${this.baseUrl}/auth/active-business`;
  }
```

Then replace lines `156-158`, which currently read:

```ts
  me(): Observable<CurrentAccount> {
    return this.http.get<CurrentAccount>(this.meUrl());
  }
```

with:

```ts
  me(): Observable<CurrentAccount> {
    return this.http.get<CurrentAccount>(this.meUrl());
  }

  /**
   * Move this session to another of the person's businesses.
   *
   * The server *verifies the membership*, rotates the refresh token to the new business, writes
   * the preference column and re-mints — design §5. A switch is therefore **never a client-side
   * flag**: everything tenancy depends on lives in the token and the cookie, and this is the only
   * thing that replaces either.
   *
   * ⚠ `withCredentials`, and it is the fourth route here to set it. The rotation replaces the
   * HttpOnly `pp_refresh` cookie, which the browser will neither send nor accept back without it —
   * and a session whose access token names business B while its refresh cookie still names A
   * silently reverts to A at the next refresh.
   *
   * ⚠ Typed as `SignInResponse` — the same `{ accessToken, expiresAt, account }` sign-in and
   * refresh answer, and the exact pair `AccessTokenStore.set` consumes. Shared contract §8 fixes
   * the request body and says nothing about the response; this is that gap, recorded as Deviation
   * D2 in plan 3 rather than left implied.
   *
   * ⚠ NOT on the interceptor's `ANONYMOUS_PATHS`. A 401 here is an expired access token like any
   * other and must be repaired by refresh-and-replay; sent with no bearer it would 401 forever.
   */
  setActiveBusiness(customerId: string): Observable<SignInResponse> {
    return this.http.post<SignInResponse>(
      this.activeBusinessUrl(),
      { customerId },
      { withCredentials: true },
    );
  }
```

⚠ `SignInResponse` is already in this file's `import type { … }` block (line `29`). Nothing new is
imported.

- [ ] **Step 5: Run them green**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task7-green.txt 2>&1; tail -12 /tmp/plan3-task7-green.txt
```

- [ ] **Step 6: Mutate — the cookie, which is the half a reviewer cannot see in a screenshot**

In `customer-api.client.ts`, change `setActiveBusiness` to drop the option:

```ts
  setActiveBusiness(customerId: string): Observable<SignInResponse> {
    return this.http.post<SignInResponse>(this.activeBusinessUrl(), { customerId });
  }
```

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task7-mutant.txt 2>&1; grep -n "rotates the pp_refresh cookie" /tmp/plan3-task7-mutant.txt > /tmp/plan3-task7-mutant-line.txt; cat /tmp/plan3-task7-mutant-line.txt; tail -20 /tmp/plan3-task7-mutant.txt
```

Predicted: **exactly one** failure —
`CustomerApiClient > sends credentials on the business switch, because it rotates the pp_refresh cookie`,
reading `expected false to be true`. The round-trip test above it stays green, which is the point:
the body, the method and the URL are all still right, and the defect is invisible to every
assertion except this one.

Restore, and prove it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web diff -- libs/api-client-customer/src/lib/customer-api.client.ts > /tmp/plan3-task7-diff.txt
grep -c "withCredentials: true" /tmp/plan3-task7-diff.txt
npx ng test customer-portal --watch=false > /tmp/plan3-task7-restored.txt 2>&1; tail -8 /tmp/plan3-task7-restored.txt
```

`grep -c` must print `1`, and the suite is green.

- [ ] **Step 7: Commit**

```bash
git -C /Users/thinhhuynh/PeakPower/peakpower-web add \
  libs/api-client-customer/src/lib/customer-api.client.ts \
  libs/api-client-customer/src/lib/customer-api.client.spec.ts
git -C /Users/thinhhuynh/PeakPower/peakpower-web commit -m "Ask the server to move the session to another business

POST /auth/active-business with { customerId }, shared contract section 8. The
server verifies the membership, rotates the refresh token to the new business,
writes the preference column and re-mints, so a switch is never a client-side flag
- everything tenancy depends on is in the token and the cookie, and this is the
only call that replaces either.

Fourth route in this client to set withCredentials, and for the reason the other
three give: the rotation replaces the HttpOnly pp_refresh cookie, and a session
whose access token names B while its refresh cookie still names A reverts to A at
the next refresh.

The response is typed SignInResponse. The shared contract fixes the request body
and is silent on the answer; design section 5 says the endpoint re-mints, and that
is the shape sign-in and refresh already return and the pair AccessTokenStore.set
consumes. Recorded as a deviation rather than left implied, and checked against the
regenerated schema before anything was written against it.

Verified by mutation: dropping withCredentials fails only the cookie test - the
body, method and URL assertions all stay green, which is exactly why that test is
separate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: `BusinessSwitcher` — the round trip, and the return to the dashboard

Three things happen on a switch and their order is the whole task: POST, then swap the token, then
navigate. Swap first and the POST goes out under the new business's token before the server has
agreed to it; navigate first and the guard runs against the old session.

**The navigation is to `/dashboard`, unconditionally, and that is design §7:** *"A switch returns
to the dashboard rather than re-resolving a route that may not exist in the new business."*
`/connections/a3f1…` is a metering point of business A. In business B that id belongs to nobody,
the detail GET answers 404, and the customer is looking at a "not yours" notice one click after
choosing their own company. Re-resolving the current URL would produce that on every connection,
consumption and settlement URL in the portal. The dashboard exists in every business.

**A second switch cannot start while the first is in flight**, and the reason is not tidiness.
Each call rotates the refresh token, and refresh tokens are single-use `[DEC-117]`: two rotations
racing means one presents a token the other has already spent, the server reads that as replay,
and *the entire chain is revoked* — a double-click would sign the customer out.

**A refusal is swallowed**, deliberately, and Open item 1 records why: design §8 puts no refusal
copy in scope, and a banner invented here would be inventing product.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/auth/business-switcher.ts`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/auth/business-switcher.spec.ts`

**Interfaces:**
- Consumes: `CustomerApiClient.setActiveBusiness(customerId: string): Observable<SignInResponse>`
  (Task 8); `AccessTokenStore.set(token: string, account: CurrentAccount): void` and
  `AccessTokenStore.activeCustomerId: Signal<string | null>` (Task 4); `Router` from
  `@angular/router`.
- Produces: `BusinessSwitcher.switchTo(customerId: string): void` and
  `BusinessSwitcher.inFlight: Signal<boolean>`. Consumed by `App` (Task 11).

- [ ] **Step 1: Write the failing tests**

Create `apps/customer-portal/src/app/auth/business-switcher.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import { provideCustomerApiTesting } from '@peakpower-nl/api-client-customer';
import type { CurrentAccount, SignInResponse } from '@peakpower-nl/api-client-customer';
import { filter, firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AccessTokenStore } from './access-token.store';
import { BusinessSwitcher } from './business-switcher';

const URL = '/api/v1/auth/active-business';

const MEMBERSHIPS = [
  { customerId: 'c1', tradeName: 'Vandersteen Koeling', membershipRole: 'admin' },
  { customerId: 'c2', tradeName: 'Zaanse Koeling', membershipRole: 'viewer' },
];

const IN_C1: CurrentAccount = {
  accountId: 'a1',
  customerId: 'c1',
  firstName: 'Peter',
  lastName: 'de Vries',
  email: 'p.devries@vandersteen.nl',
  membershipRole: 'admin',
  memberships: MEMBERSHIPS,
};

/** What the server re-mints: a token for c2, and the same person with a DIFFERENT active role. */
const SESSION_IN_C2: SignInResponse = {
  accessToken: 'minted-for-c2',
  expiresAt: '2026-09-10T12:15:00Z',
  account: { ...IN_C1, customerId: 'c2', membershipRole: 'viewer' },
};

describe('BusinessSwitcher', () => {
  let http: HttpTestingController;
  let tokens: AccessTokenStore;
  let router: Router;
  let switcher: BusinessSwitcher;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideCustomerApiTesting(),
        // Componentless routes: this spec is about which URL the switch lands on, and mounting a
        // screen to find out would drag that screen's own requests into http.verify().
        provideRouter([
          { path: 'dashboard', children: [] },
          { path: 'connections/:id', children: [] },
        ]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    tokens = TestBed.inject(AccessTokenStore);
    router = TestBed.inject(Router);
    switcher = TestBed.inject(BusinessSwitcher);
    tokens.set('minted-for-c1', IN_C1);
    await router.navigateByUrl('/connections/m1');
  });

  afterEach(() => {
    try {
      http.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  const arrival = () =>
    firstValueFrom(
      router.events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)),
    );

  it('asks the server, then replaces the session with what it minted', async () => {
    const arrived = arrival();
    switcher.switchTo('c2');

    const request = http.expectOne(URL);
    expect(request.request.body).toEqual({ customerId: 'c2' });
    // NOTHING has moved yet. The session is swapped by the ANSWER, never by the asking — a
    // client-side flag set before the server agreed would leave a token for c1 claiming c2.
    expect(tokens.token()).toBe('minted-for-c1');
    expect(tokens.activeCustomerId()).toBe('c1');

    request.flush(SESSION_IN_C2);
    await arrived;

    expect(tokens.token()).toBe('minted-for-c2');
    expect(tokens.activeCustomerId()).toBe('c2');
    expect(tokens.account()?.membershipRole).toBe('viewer');
  });

  it('lands on the dashboard, not back on a URL that belongs to the business it left', async () => {
    // /connections/m1 is a metering point of c1. In c2 that id belongs to nobody, so re-resolving
    // the current route would answer 404 and show a "not yours" notice one click after the
    // customer chose their own company. Design §7 sends the switch to the dashboard instead.
    expect(router.url).toBe('/connections/m1');

    const arrived = arrival();
    switcher.switchTo('c2');
    http.expectOne(URL).flush(SESSION_IN_C2);
    await arrived;

    expect(router.url).toBe('/dashboard');
  });

  it('refuses a second switch while the first is still in flight', () => {
    switcher.switchTo('c2');
    expect(switcher.inFlight()).toBe(true);

    // A double-click. Each call ROTATES the refresh token, and refresh tokens are single-use
    // [DEC-117] — two rotations racing means one presents a token the other has already spent,
    // the server reads it as replay, and the whole chain is revoked. A double-click would sign
    // the customer out.
    switcher.switchTo('c2');

    // expectOne throws on a second, which is the assertion.
    http.expectOne(URL).flush(SESSION_IN_C2);
    expect(switcher.inFlight()).toBe(false);
  });

  it('asks for nothing when the chosen business is the one already active', () => {
    switcher.switchTo('c1');

    http.expectNone(URL);
    expect(switcher.inFlight()).toBe(false);
  });

  it('leaves the session exactly as it was when the server refuses', async () => {
    const arrived = arrival();
    switcher.switchTo('c2');
    http.expectOne(URL).flush(null, { status: 403, statusText: 'Forbidden' });

    // Still signed in, still in c1, and free to try again. The refusal is not surfaced — design
    // §8 puts no copy for it in scope — but it must not sign anybody out or strand the switcher.
    expect(tokens.token()).toBe('minted-for-c1');
    expect(tokens.activeCustomerId()).toBe('c1');
    expect(switcher.inFlight()).toBe(false);
    expect(router.url).toBe('/connections/m1');

    // And the next attempt is allowed, which is what `inFlight` being false has to mean.
    switcher.switchTo('c2');
    http.expectOne(URL).flush(SESSION_IN_C2);
    await arrived;
    expect(router.url).toBe('/dashboard');
  });
});
```

- [ ] **Step 2: Run it and read the exact failure**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task8-red.txt 2>&1; tail -20 /tmp/plan3-task8-red.txt
```

Expected: the run fails to resolve the import —
`Failed to resolve import "./business-switcher" from "apps/customer-portal/src/app/auth/business-switcher.spec.ts"`,
or the TypeScript equivalent, `TS2307: Cannot find module './business-switcher'`.

- [ ] **Step 3: Write the implementation**

Create `apps/customer-portal/src/app/auth/business-switcher.ts`:

```ts
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CustomerApiClient } from '@peakpower-nl/api-client-customer';
import { finalize } from 'rxjs/operators';

import { AccessTokenStore } from './access-token.store';

/**
 * Moving this session to another of the person's businesses.
 *
 * Three steps and their order is the point: ask the server, then replace the token with what it
 * minted, then navigate. Replace first and the request goes out under a token the server has not
 * agreed to; navigate first and the route's guards run against the business the customer is
 * leaving.
 *
 * Everything else follows on its own. `AccessTokenStore.activeCustomerId` moves with the new
 * account, and `CompanyStore`, `EntitlementStore` and the rail's connections resource are all
 * keyed on it — so this service invalidates nothing by hand and knows about none of them. A
 * switcher that reached into three stores would be a fourth place that has to be updated the day
 * a fifth cache is added.
 */
@Injectable({ providedIn: 'root' })
export class BusinessSwitcher {
  private readonly api = inject(CustomerApiClient);
  private readonly tokens = inject(AccessTokenStore);
  private readonly router = inject(Router);

  private readonly switching = signal(false);

  /** True between the request going out and the answer — or the refusal — coming back. */
  readonly inFlight = this.switching.asReadonly();

  /**
   * Switch to `customerId`, or do nothing if that is already the active business or a switch is
   * already running.
   *
   * ⚠ **The in-flight guard is not tidiness.** Design §5 has the endpoint rotate the refresh token
   * on every call, and refresh tokens are single-use `[DEC-117]`. Two rotations racing means the
   * second presents a token the first has already spent, the server reads that as replay, and it
   * revokes the whole chain — a double-click on the rail would sign the customer out of every
   * business at once.
   *
   * ⚠ **A refusal is swallowed on purpose.** A 403 means the membership the menu offered is gone;
   * the session stays exactly where it was, which is the safe answer, and nothing is said because
   * design §8 puts no copy for it in scope. Recorded as an open item in plan 3 rather than
   * invented here. A 401 never reaches this handler at all — `authInterceptor` refreshes and
   * replays it, and gives up by signing out.
   */
  switchTo(customerId: string): void {
    if (this.switching()) return;
    if (customerId === this.tokens.activeCustomerId()) return;

    this.switching.set(true);
    this.api
      .setActiveBusiness(customerId)
      // `finalize`, not `complete`: it fires on complete, error AND unsubscribe alike, so a
      // refusal or a dropped connection still frees the switcher for the next attempt. A
      // `complete` handler would leave `inFlight` stuck true after any failure and the control
      // dead for the life of the tab.
      .pipe(finalize(() => this.switching.set(false)))
      .subscribe({
        next: (session) => {
          this.tokens.set(session.accessToken, session.account);
          // ⚠ To the DASHBOARD, never back to the current URL. Design §7: a route may not exist in
          // the new business — /connections/<id> names a metering point of the old one, which is a
          // 404 by design — and the dashboard is the one screen every business has.
          //
          // NOT `void router.navigate(...)`. A rejected navigation becomes an unhandled rejection,
          // and vitest turns that into "N passed" followed by exit 1 — a red build that reads as
          // green in every log.
          this.router.navigate(['/dashboard']).catch(() => undefined);
        },
        error: () => undefined,
      });
  }
}
```

- [ ] **Step 4: Run it green**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task8-green.txt 2>&1; tail -12 /tmp/plan3-task8-green.txt
```

- [ ] **Step 5: Mutate — the ordering, and the guard**

**Mutation A — swap the session before the server answers.** Move the token swap out of `next`
and up beside the request. Replace the body of `switchTo` after the two guards with:

```ts
    this.switching.set(true);
    this.tokens.set(this.tokens.token() ?? '', {
      ...this.tokens.account()!,
      customerId,
    });
    this.api
      .setActiveBusiness(customerId)
      .pipe(finalize(() => this.switching.set(false)))
      .subscribe({
        next: (session) => {
          this.tokens.set(session.accessToken, session.account);
          this.router.navigate(['/dashboard']).catch(() => undefined);
        },
        error: () => undefined,
      });
```

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task8-mutantA.txt 2>&1; grep -n "BusinessSwitcher" /tmp/plan3-task8-mutantA.txt > /tmp/plan3-task8-mutantA-lines.txt; cat /tmp/plan3-task8-mutantA-lines.txt; tail -30 /tmp/plan3-task8-mutantA.txt
```

Predicted: **two** failures.
`asks the server, then replaces the session with what it minted` fails on
`expect(tokens.activeCustomerId()).toBe('c1')` with `expected 'c2' to be 'c1'` — the session moved
before the server agreed. And `leaves the session exactly as it was when the server refuses` fails
on the same assertion with the same message, which is the same defect seen from the side that
actually hurts: a refused switch would have left the customer holding a token for c1 that claims
to be c2, and every request after it 401ing. Restore.

**Mutation B — drop the in-flight guard.** Delete the line `if (this.switching()) return;`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task8-mutantB.txt 2>&1; grep -n "refuses a second switch" /tmp/plan3-task8-mutantB.txt > /tmp/plan3-task8-mutantB-line.txt; cat /tmp/plan3-task8-mutantB-line.txt; tail -20 /tmp/plan3-task8-mutantB.txt
```

Predicted: **exactly one** failure —
`BusinessSwitcher > refuses a second switch while the first is still in flight`, reading
`Error: Expected one matching request for criteria "Match URL: /api/v1/auth/active-business", found 2 requests.`

Restore, and prove it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web status --porcelain -- apps/customer-portal/src/app/auth/business-switcher.ts > /tmp/plan3-task8-status.txt
grep -c "if (this.switching()) return;" apps/customer-portal/src/app/auth/business-switcher.ts
grep -c "this.tokens.account()!" apps/customer-portal/src/app/auth/business-switcher.ts
npx ng test customer-portal --watch=false > /tmp/plan3-task8-restored.txt 2>&1; tail -8 /tmp/plan3-task8-restored.txt
```

The first `grep -c` must print `1` and the second `0`, and the suite is green. (The file is new, so
`git diff` shows nothing — grep the file itself.)

- [ ] **Step 6: Commit**

```bash
git -C /Users/thinhhuynh/PeakPower/peakpower-web add \
  apps/customer-portal/src/app/auth/business-switcher.ts \
  apps/customer-portal/src/app/auth/business-switcher.spec.ts
git -C /Users/thinhhuynh/PeakPower/peakpower-web commit -m "Move the session to another business, and land on the dashboard

Ask the server, then replace the token with what it minted, then navigate. Replace
first and the request goes out under a token the server has not agreed to; a
refusal then leaves the customer holding a token for one business claiming to be
in another, and everything after it 401s.

The navigation is to the dashboard and never back to the current URL:
/connections/<id> names a metering point of the business being left, which in the
new one belongs to nobody, so re-resolving would show a 'not yours' notice one
click after the customer chose their own company.

A second switch cannot start while the first is running. Each call rotates the
refresh token and those are single-use [DEC-117], so two racing rotations read as
replay and revoke the whole chain - a double-click on the rail would sign the
customer out of every business at once.

The service invalidates nothing by hand and does not know CompanyStore or
EntitlementStore exist. Both are keyed on the active business id, so swapping the
token is the whole of it.

Verified by two mutations: swapping the session before the answer fails the
ordering test AND the refusal test; dropping the in-flight guard fails only the
double-click test, with two requests where one was expected.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: `PpAppShell` — the rail foot becomes a real control

Today the rail foot is a non-interactive `div`, and `app.spec.ts` has a test asserting that it
contains no button and no link (Task 11 inverts it). Its CSS box is already the mockup's — the
hairline, the 10px insets, the 14/12/12 padding, the avatar on the same vertical line as the nav
dots — so this task changes what the box **is**, not what it looks like.

```
      @if (account(); as account) {
        <div class="pp-app-shell__account">
          @if (account.initials; as initials) {
            <div class="pp-app-shell__avatar" aria-hidden="true">{{ initials }}</div>
          }
          <div class="pp-app-shell__account-text">
            <div class="pp-app-shell__account-name">{{ account.name }}</div>
            <div class="pp-app-shell__account-org">{{ account.org }}</div>
          </div>
        </div>
      }
```

Four constraints shape the markup, and each one rules out the obvious approach:

1. **The control only exists when there is somewhere to go.** One membership renders exactly
   today's `div`. A trigger that opens a menu with one row in it is the dead affordance this
   codebase has refused twice already — the current test's own words are *"a control for switching
   between accounts nobody can hold"*.
2. **The identity markup cannot be duplicated into two branches.** It is the avatar, the name and
   the org, all three pinned by existing tests including a `parentElement` assertion. Two copies
   drift. It goes in an `<ng-template #identity>` and both branches project it with
   `NgTemplateOutlet`, so the avatar and the two lines are the same markup whichever branch
   renders — and, because the outlet inserts at its anchor's position, their `parentElement` is
   still the trigger or the footer rather than a wrapper.
3. **`.pp-app-shell__account` stays the rail's last child and keeps its single CSS rule.**
   `pp-app-shell.spec.ts:452` asserts `rail.lastElementChild` carries that class, and `:467` reads
   the rule with `ruleBody`, which **throws** if a selector matches twice. So the menu is rendered
   *inside* that element, positioned absolutely, and `position: relative` is added to the existing
   rule rather than in a new one.
4. **No backticks.** The template is a backtick literal; `switchLabel` therefore composes with `+`.

Dismissal follows `PpRangePicker` exactly, including the defect its commit message records: the
Escape handler goes on the **element containing both the trigger and the menu**, because focus sits
on the trigger when the menu opens and a handler bound to the menu never sees the key.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/libs/shared-ui/src/lib/app-shell/pp-app-shell.ts`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/libs/shared-ui/src/lib/app-shell/pp-app-shell.css`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/libs/shared-ui/src/public-api.ts:2-8`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-web/libs/shared-ui/src/lib/app-shell/pp-app-shell.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. `PpAppShell` is portal-agnostic and knows no API type.
- Produces:
  - `export interface PpBusinessOption { readonly id: string; readonly name: string; readonly membershipRole: string; }`
  - `PpAppShell.businesses = input<readonly PpBusinessOption[]>([])`
  - `PpAppShell.activeBusinessId = input<string | null>(null)`
  - `PpAppShell.businessSelected = output<string>()`
  All four consumed by `App` (Task 11).

- [ ] **Step 1: Write the failing tests**

Append to `libs/shared-ui/src/lib/app-shell/pp-app-shell.spec.ts`, after its last `describe`:

```ts
// The rail's foot as a CONTROL. Both portals keep the label; the customer portal, where one login
// may hold memberships in several businesses, gets a trigger and a menu.
describe('pp-app-shell business switcher', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  const css = () => cssText('lib/app-shell/pp-app-shell.css');

  const IDENTITY = { name: 'Peter de Vries', org: 'Vandersteen Koeling B.V.', initials: 'PV' };
  const TWO: readonly PpBusinessOption[] = [
    { id: 'c1', name: 'Vandersteen Koeling', membershipRole: 'Admin' },
    { id: 'c2', name: 'Zaanse Koeling', membershipRole: 'Viewer' },
  ];

  function shellWith(businesses: readonly PpBusinessOption[], active: string | null = 'c1') {
    const fixture = createShell();
    fixture.componentRef.setInput('account', IDENTITY);
    fixture.componentRef.setInput('businesses', businesses);
    fixture.componentRef.setInput('activeBusinessId', active);
    fixture.detectChanges();
    return fixture;
  }

  const footer = (fixture: { nativeElement: HTMLElement }) =>
    fixture.nativeElement.querySelector('.pp-app-shell__account') as HTMLElement;
  const trigger = (fixture: { nativeElement: HTMLElement }) =>
    fixture.nativeElement.querySelector(
      '.pp-app-shell__account-trigger',
    ) as HTMLButtonElement | null;
  const options = (fixture: { nativeElement: HTMLElement }) => [
    ...fixture.nativeElement.querySelectorAll<HTMLButtonElement>('.pp-app-shell__business-option'),
  ];

  it('renders no control at all for somebody with one business', () => {
    // The dead affordance this rail has refused twice: a trigger whose menu has one row is a
    // control for switching to where you already are.
    const fixture = shellWith([{ id: 'c1', name: 'Vandersteen Koeling', membershipRole: 'Admin' }]);

    expect(trigger(fixture)).toBeNull();
    expect(footer(fixture).querySelectorAll('button')).toHaveLength(0);
    // And the identity is still there, unchanged. A footer that vanished with the control would
    // take the signed-in name off every single-business rail in the product.
    expect(
      footer(fixture).querySelector('.pp-app-shell__account-name')?.textContent?.trim(),
    ).toBe('Peter de Vries');
  });

  it('renders no control when no businesses are supplied at all', () => {
    // The back office binds `account` and never `businesses`, so the DEFAULT has to be inert.
    const fixture = createShell();
    fixture.componentRef.setInput('account', IDENTITY);
    fixture.detectChanges();

    expect(trigger(fixture)).toBeNull();
    expect(footer(fixture).querySelectorAll('button')).toHaveLength(0);
  });

  it('makes the foot a trigger once there is somewhere to switch to', () => {
    const fixture = shellWith(TWO);

    const button = trigger(fixture);
    expect(button).not.toBeNull();
    expect(button!.getAttribute('type')).toBe('button');
    expect(button!.getAttribute('aria-haspopup')).toBe('menu');
    expect(button!.getAttribute('aria-expanded')).toBe('false');
    // Named for what it DOES. Without this the button's accessible name is the identity inside it
    // — "PV Peter de Vries Vandersteen Koeling B.V." — which says who you are, not what pressing
    // it will do.
    expect(button!.getAttribute('aria-label')).toBe(
      'Switch business, currently Vandersteen Koeling B.V.',
    );
  });

  it('keeps the identity inside the trigger, still stacked in its own block', () => {
    const fixture = shellWith(TWO);

    // The same three elements as the label form, in the same relationship — the pp-app-shell
    // account-footer tests above pin exactly this and must not need a second implementation.
    const button = trigger(fixture)!;
    expect(button.querySelector('.pp-app-shell__avatar')?.textContent?.trim()).toBe('PV');
    const text = button.querySelector('.pp-app-shell__account-text');
    expect(button.querySelector('.pp-app-shell__account-name')?.parentElement).toBe(text);
    expect(button.querySelector('.pp-app-shell__account-org')?.parentElement).toBe(text);
  });

  it('opens on the trigger and lists every business with its role', () => {
    const fixture = shellWith(TWO);
    expect(options(fixture)).toHaveLength(0);

    trigger(fixture)!.click();
    fixture.detectChanges();

    expect(trigger(fixture)!.getAttribute('aria-expanded')).toBe('true');
    expect(
      options(fixture).map((row) =>
        row.querySelector('.pp-app-shell__business-name')?.textContent?.trim(),
      ),
    ).toEqual(['Vandersteen Koeling', 'Zaanse Koeling']);
    // The role is rendered VERBATIM, exactly as the account's name and initials are: the shell is
    // handed what to draw and derives nothing, so a portal can spell 'Admin' and the design system
    // never learns the wire's 'admin'.
    expect(
      options(fixture).map((row) =>
        row.querySelector('.pp-app-shell__business-role')?.textContent?.trim(),
      ),
    ).toEqual(['Admin', 'Viewer']);
  });

  it('marks the business already active and does not offer to switch to it', () => {
    const fixture = shellWith(TWO, 'c2');
    trigger(fixture)!.click();
    fixture.detectChanges();

    const [first, second] = options(fixture);
    expect(first.getAttribute('aria-current')).toBeNull();
    expect(second.getAttribute('aria-current')).toBe('true');
    expect(second.classList.contains('pp-app-shell__business-option--current')).toBe(true);

    const chosen: string[] = [];
    fixture.componentInstance.businessSelected.subscribe((id: string) => chosen.push(id));

    second.click();
    fixture.detectChanges();

    // Closed, and NOTHING emitted: a POST that rotates the refresh token to the business you are
    // already in is a round trip and a token rotation bought for nothing.
    expect(chosen).toEqual([]);
    expect(options(fixture)).toHaveLength(0);
  });

  it('emits the chosen business and closes', () => {
    const fixture = shellWith(TWO, 'c1');
    trigger(fixture)!.click();
    fixture.detectChanges();

    const chosen: string[] = [];
    fixture.componentInstance.businessSelected.subscribe((id: string) => chosen.push(id));

    options(fixture)[1].click();
    fixture.detectChanges();

    // The ID, not the index and not the name. The name is presentation copy a back office may
    // reword; the id is what POST /auth/active-business takes.
    expect(chosen).toEqual(['c2']);
    expect(options(fixture)).toHaveLength(0);
    expect(trigger(fixture)!.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape pressed from the TRIGGER, where focus actually is', () => {
    // The defect pp-range-picker's own history records: bind Escape to the menu and it never
    // fires, because focus sits on the trigger the moment the menu opens. The handler goes on the
    // element containing both.
    const fixture = shellWith(TWO);
    trigger(fixture)!.click();
    fixture.detectChanges();
    expect(options(fixture)).toHaveLength(2);

    trigger(fixture)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(options(fixture)).toHaveLength(0);
  });

  it('closes when the pointer goes down anywhere else', () => {
    const fixture = shellWith(TWO);
    trigger(fixture)!.click();
    fixture.detectChanges();
    expect(options(fixture)).toHaveLength(2);

    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(options(fixture)).toHaveLength(0);
  });

  it('stays open when the pointer goes down inside the menu', () => {
    // Without the containment guard the menu would close on the way DOWN of the very click that
    // chooses a business, and nothing would ever be selected.
    const fixture = shellWith(TWO);
    trigger(fixture)!.click();
    fixture.detectChanges();

    options(fixture)[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();

    expect(options(fixture)).toHaveLength(2);
  });

  it('hangs the menu off the foot itself, opening upward over the nav', () => {
    // Rule-scoped. `position:relative` has to be in the FOOT's own rule — the menu is positioned
    // against it — and it has to be in the rule that already exists, because ruleBody throws on a
    // selector that matches twice and the footer's other assertions read it.
    expect(ruleBody(css(), '.pp-app-shell__account')).toContain('position:relative');

    const menu = ruleBody(css(), '.pp-app-shell__business-menu');
    expect(menu).toContain('position:absolute');
    // Upward: there is nothing below the foot but the edge of the viewport.
    expect(menu).toContain('bottom:100%');
    // The rail is its own colour, so a panel painted in it needs the hairline and the shadow to
    // read as a layer above the nav rather than a hole in it.
    expect(menu).toContain('background:var(--pp-sidebar-bg)');
    expect(menu).not.toMatch(/background:#/);
  });

  it('resets the button chrome so the trigger is the identity row and not a button', () => {
    const body = ruleBody(css(), '.pp-app-shell__account-trigger');
    expect(body).toContain('background:none');
    expect(body).toContain('border:0');
    expect(body).toContain('cursor:pointer');
    // Without these a long legal name pushes the chevron out of the 236px rail instead of
    // ellipsing — the same reason .pp-app-shell__account-text carries them.
    expect(body).toContain('flex:1');
    expect(body).toContain('min-width:0');
  });

  it('gives the trigger and the options the library\'s own focus ring', () => {
    // The rail had no focus ring at all until F7 added one to its nav rows; two more focusable
    // controls must not reintroduce the gap.
    expect(ruleBody(css(), '.pp-app-shell__account-trigger:focus-visible')).toContain(
      'var(--pp-blue-300)',
    );
    expect(ruleBody(css(), '.pp-app-shell__business-option:focus-visible')).toContain(
      'var(--pp-blue-300)',
    );
  });

  it('colours the menu from the rail tokens, never from a hex', () => {
    // Same refusal the group label, the disabled row and the account org already record: every
    // grey the mockup uses on this rail fails AA, and --pp-sidebar-text is the one that does not.
    const option = ruleBody(css(), '.pp-app-shell__business-option');
    expect(option).toContain('color:var(--pp-sidebar-text)');
    expect(option).not.toMatch(/color:#/);

    const role = ruleBody(css(), '.pp-app-shell__business-role');
    expect(role).toContain('color:var(--pp-sidebar-text)');
    expect(role).toContain('font-size:var(--text-2xs)');
    expect(role).not.toMatch(/color:#/);
  });
});
```

Add `PpBusinessOption` to the file's existing import on line `6`, which becomes:

```ts
import { PpAppShell, type PpBusinessOption, type PpNavSection } from './pp-app-shell';
```

- [ ] **Step 2: Run them and read the exact failure**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test shared-ui --watch=false > /tmp/plan3-task9-red.txt 2>&1; tail -25 /tmp/plan3-task9-red.txt
```

Expected: type-check failure before any test runs —
`TS2305: Module './pp-app-shell' has no exported member 'PpBusinessOption'`, plus
`TS2345`/`TS2339` on `setInput('businesses', …)` and `componentInstance.businessSelected`.

- [ ] **Step 3: Write the component**

In `libs/shared-ui/src/lib/app-shell/pp-app-shell.ts`, replace line `1-2`:

```ts
import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
```

with:

```ts
import { NgTemplateOutlet } from '@angular/common';
import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
```

Insert after the `PpAccountIdentity` interface (after line `59`):

```ts
/**
 * One business the signed-in person may switch this session to.
 *
 * ⚠ `membershipRole`, spelled in full and never `role`. On the account record `role` is **job
 * title** and `[F01-R13]` says it is descriptive and never checked; `trader` and `viewer` are
 * simultaneously the **employee** vocabulary `[F13-R12]`. Shared contract §3 makes the full
 * spelling normative for exactly this reason.
 *
 * It is rendered VERBATIM, like `PpAccountIdentity.initials` and for the same reason: the shell
 * draws what it is handed and derives nothing, so a portal supplies 'Admin' and the design system
 * never learns the wire's 'admin'.
 */
export interface PpBusinessOption {
  /** The customer id. What the portal posts; never an index and never the name. */
  readonly id: string;
  /** What the reader sees — the trade name. */
  readonly name: string;
  /** Rendered beside the name. 'Admin', 'Trader', 'Viewer'. */
  readonly membershipRole: string;
}
```

Replace the account block in the template — lines `125-135` — with:

```html
      @if (account(); as account) {
        <!-- The foot is the SWITCHER when there is somewhere to switch to, and today's plain
             label when there is not. One element either way, still the rail's last child, still
             carrying the hairline and the insets: what changes is whether it is a control.

             The identity lives in an ng-template projected into whichever branch renders, rather
             than being written twice. Two copies of an avatar-plus-two-lines block drift, and the
             existing footer tests pin the relationship between them — including that both lines
             are children of __account-text, which a second hand-written copy would eventually get
             wrong on one side only.

             Escape is bound HERE, on the element containing both the trigger and the menu, and not
             on the menu: focus sits on the trigger the moment the menu opens, so a handler on the
             menu never sees the key. pp-range-picker shipped that defect once already. -->
        <div class="pp-app-shell__account" (keydown.escape)="closeMenu()">
          @if (menuOpen()) {
            <ul class="pp-app-shell__business-menu" role="menu" aria-label="Your businesses">
              @for (business of businesses(); track business.id) {
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    class="pp-app-shell__business-option"
                    [class.pp-app-shell__business-option--current]="
                      business.id === activeBusinessId()
                    "
                    [attr.aria-current]="business.id === activeBusinessId() ? 'true' : null"
                    (click)="chooseBusiness(business.id)"
                  >
                    <span class="pp-app-shell__business-name">{{ business.name }}</span>
                    <span class="pp-app-shell__business-role">{{ business.membershipRole }}</span>
                  </button>
                </li>
              }
            </ul>
          }

          <ng-template #identity>
            @if (account.initials; as initials) {
              <div class="pp-app-shell__avatar" aria-hidden="true">{{ initials }}</div>
            }
            <div class="pp-app-shell__account-text">
              <div class="pp-app-shell__account-name">{{ account.name }}</div>
              <div class="pp-app-shell__account-org">{{ account.org }}</div>
            </div>
          </ng-template>

          @if (canSwitch()) {
            <button
              type="button"
              class="pp-app-shell__account-trigger"
              aria-haspopup="menu"
              [attr.aria-expanded]="menuOpen()"
              [attr.aria-label]="switchLabel()"
              (click)="toggleMenu()"
            >
              <ng-container [ngTemplateOutlet]="identity" />
              <span class="pp-app-shell__account-chevron" aria-hidden="true">&rsaquo;</span>
            </button>
          } @else {
            <ng-container [ngTemplateOutlet]="identity" />
          }
        </div>
      }
```

Add `NgTemplateOutlet` to the component's `imports`, so line `65` becomes:

```ts
  imports: [NgTemplateOutlet, RouterLink],
```

Append to the class body, after `demoFootnote` (line `293`) and before `showDot`:

```ts
  /**
   * Every business this session may be switched to, including the one it is already in.
   *
   * Defaults to EMPTY, and that default is what leaves the back office unchanged: it binds
   * `account` and never this, so its foot stays the label it has always been.
   */
  readonly businesses = input<readonly PpBusinessOption[]>([]);

  /** Which of them the session is in, so the menu can mark it and refuse to re-choose it. */
  readonly activeBusinessId = input<string | null>(null);

  /**
   * The chosen business's id.
   *
   * The shell emits and does nothing else: it holds no session, issues no request and performs no
   * navigation. Everything a switch actually costs — a POST that rotates a single-use refresh
   * token, a token swap, a return to the dashboard — belongs to the portal, which is the only
   * place that can serialise it.
   */
  readonly businessSelected = output<string>();

  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly menuOpen = signal(false);

  /**
   * ⚠ More than one, not "at least one". A trigger whose menu holds a single row is a control for
   * switching to where you already are — the dead affordance this rail has now refused twice, and
   * the reason the label form has to survive this change untouched.
   */
  protected readonly canSwitch = computed(() => this.businesses().length > 1);

  /**
   * The trigger's accessible name.
   *
   * Without it the button's name is the identity projected inside it — "PV Peter de Vries
   * Vandersteen Koeling B.V." — which announces who you are rather than what pressing it does.
   *
   * ⚠ Concatenated with `+` and not a template string. The component's template is a backtick
   * literal; a backtick anywhere near it closes that literal early, and the failure is a parse
   * error hundreds of lines away from the cause.
   */
  protected readonly switchLabel = computed(() => {
    const org = this.account()?.org ?? '';
    return org === '' ? 'Switch business' : 'Switch business, currently ' + org;
  });

  /**
   * ⚠ Dismiss on a pointer down ANYWHERE else, bound on the document — the same mechanism
   * `pp-range-picker` uses, for the same reason. A menu that only closes on its own terms sits
   * over the nav while the reader tries to click through it.
   *
   * `pointerdown` rather than `click`, so the menu is gone before whatever is underneath reacts.
   * The containment guard is not optional: without it the menu would close on the way DOWN of the
   * very press that chooses a business, and the click would land on nothing.
   *
   * Registered in the constructor and torn down with the component; the guard costs nothing while
   * the menu is closed.
   */
  private readonly dismiss = (event: Event): void => {
    if (!this.menuOpen()) return;
    const target = event.target as Node | null;
    if (target !== null && this.host.nativeElement.contains(target)) return;
    this.closeMenu();
  };

  constructor() {
    document.addEventListener('pointerdown', this.dismiss, true);
    inject(DestroyRef).onDestroy(() =>
      document.removeEventListener('pointerdown', this.dismiss, true),
    );
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  /**
   * Close, and emit only if this is a different business.
   *
   * Re-choosing the active one is a round trip and a refresh-token rotation bought for nothing,
   * and the portal's own guard would refuse it anyway — but a control that fires an event it knows
   * is pointless pushes that judgement onto every consumer.
   */
  protected chooseBusiness(id: string): void {
    this.closeMenu();
    if (id === this.activeBusinessId()) return;
    this.businessSelected.emit(id);
  }
```

- [ ] **Step 4: Write the CSS**

In `libs/shared-ui/src/lib/app-shell/pp-app-shell.css`, add **one declaration inside the existing
`.pp-app-shell__account` rule** — it must not become a second rule, or `ruleBody` throws for every
assertion that reads it. Replace lines `249-258`:

```css
.pp-app-shell__account {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: 10px;
  margin-right: 10px;
  padding: 14px 12px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.09);
}
```

with:

```css
.pp-app-shell__account {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: 10px;
  margin-right: 10px;
  padding: 14px 12px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.09);
  /* The business menu is positioned against THIS box. Declared here rather than in a rule of its
     own because ruleBody() throws on a selector matching twice, and this rule is read by four
     assertions. It changes nothing when no menu is rendered. */
  position: relative;
}
```

Then append at the end of the file:

```css
/* ── the foot as a control ──────────────────────────────────────────────────
   The trigger IS the identity row: the avatar and the two lines are projected into it, so this
   resets the button chrome and then re-declares the row's own geometry. flex:1 and min-width:0
   are what let a long legal name ellipse instead of pushing the chevron out of the 236px rail —
   the same pair .pp-app-shell__account-text carries, and for the same reason. */
.pp-app-shell__account-trigger {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
/* The same halo the rail's nav rows take. The rail had no focus ring at all before F7 added one
   there; two more focusable controls must not reopen that gap. */
.pp-app-shell__account-trigger:focus-visible {
  outline: none;
  border-radius: var(--radius-sm);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--pp-blue-300) 22%, transparent);
}
/* The mockup's own chevron, turned a quarter left so it points UP. The menu opens upward — there
   is nothing below the foot but the edge of the viewport — and a chevron pointing the other way
   tells the reader the wrong thing about where the panel will appear. */
.pp-app-shell__account-chevron {
  flex-shrink: 0;
  color: var(--pp-sidebar-text);
  transform: rotate(-90deg);
}

/* The menu, opening upward out of the foot. Absolutely positioned so it does not become a third
   flex child of the foot and push the identity row sideways, and stretched to the foot's own
   width so its rows line up with the name above them.

   --pp-sidebar-bg is the rail's own colour, so the panel needs the hairline and the shadow to
   read as a layer ABOVE the nav rather than a hole in it. Both alphas are ones this file already
   ships; an alpha over the rail is not a palette colour and there is no token for one. */
.pp-app-shell__business-menu {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  z-index: 1;
  margin: 0 0 8px;
  padding: 4px;
  list-style: none;
  background: var(--pp-sidebar-bg);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: var(--radius-md);
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.35);
}
/* Two columns: the trade name, and the role right-aligned against it. `font:inherit` first and
   `font-size` after — the shorthand resets size, so the order is load-bearing. */
.pp-app-shell__business-option {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  column-gap: 10px;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  font: inherit;
  font-size: var(--text-sm);
  color: var(--pp-sidebar-text);
  text-align: left;
  cursor: pointer;
}
.pp-app-shell__business-option:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--pp-sidebar-text-active);
}
.pp-app-shell__business-option:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--pp-blue-300) 22%, transparent);
}
/* The one you are in, marked the way the rail marks its active row. */
.pp-app-shell__business-option--current {
  background: var(--pp-sidebar-active-bg);
  color: var(--pp-sidebar-text-active);
  font-weight: var(--weight-semibold);
}
.pp-app-shell__business-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* The role beside the name. ALL CAPS is legal here for the reason it is on the brand subtitle and
   a stat-card label — a fixed one-word name, not running copy — and the colour is the rail's one
   AA-passing grey, not the mockup's #7b8ba0 at 3.10:1. */
.pp-app-shell__business-role {
  font-size: var(--text-2xs);
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--pp-sidebar-text);
}
```

- [ ] **Step 5: Export the type**

In `libs/shared-ui/src/public-api.ts`, replace lines `2-8`:

```ts
export {
  PpAppShell,
  type PpAccountIdentity,
  type PpCrumbBack,
  type PpNavItem,
  type PpNavSection,
} from './lib/app-shell/pp-app-shell';
```

with:

```ts
export {
  PpAppShell,
  type PpAccountIdentity,
  type PpBusinessOption,
  type PpCrumbBack,
  type PpNavItem,
  type PpNavSection,
} from './lib/app-shell/pp-app-shell';
```

- [ ] **Step 6: Run it green, and build the library**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test shared-ui --watch=false > /tmp/plan3-task9-green.txt 2>&1; tail -14 /tmp/plan3-task9-green.txt
npx ng build shared-ui > /tmp/plan3-task9-build.txt 2>&1; tail -6 /tmp/plan3-task9-build.txt
npx ng test customer-portal --watch=false > /tmp/plan3-task9-portal.txt 2>&1; tail -14 /tmp/plan3-task9-portal.txt
npx ng test employee-portal --watch=false > /tmp/plan3-task9-emp.txt 2>&1; tail -14 /tmp/plan3-task9-emp.txt
```

All four must be green. ⚠ The library **build** is not optional after touching `public-api.ts`: a
duplicate or malformed export compiles under the test runner and leaves the whole suite green.

⚠ `app.spec.ts:514`'s `offers no way to switch accounts…` must **still pass here**, because `App`
does not yet bind `businesses` — the default is `[]`, `canSwitch()` is false, and the foot is the
label it has always been. Task 11 is where that test is inverted, and it inverts because the
binding arrives, not because this component changed. If it is red now, the default is wrong.

- [ ] **Step 7: Mutate — three, one per mechanism the tests claim**

**Mutation A — offer the control to everybody.** Change `canSwitch` to:

```ts
  protected readonly canSwitch = computed(() => this.businesses().length > 0);
```

Predicted: `npx ng test shared-ui --watch=false` fails
`pp-app-shell business switcher > renders no control at all for somebody with one business` on
`expect(trigger(fixture)).toBeNull()`, reading
`expected <button class="pp-app-shell__account-trigger" …> to be null`. The zero-business test
stays green, which is what proves the boundary is at *more than one* and not at *any*. Restore.

**Mutation B — emit for the business already active.** Delete the guard line in `chooseBusiness`
so it reads:

```ts
  protected chooseBusiness(id: string): void {
    this.closeMenu();
    this.businessSelected.emit(id);
  }
```

Predicted: exactly one failure —
`marks the business already active and does not offer to switch to it`, reading
`expected [ 'c2' ] to deeply equal []`. Restore.

**Mutation C — drop the containment guard from the dismiss handler.** Change it to:

```ts
  private readonly dismiss = (): void => {
    if (!this.menuOpen()) return;
    this.closeMenu();
  };
```

Predicted: exactly one failure — `stays open when the pointer goes down inside the menu`, reading
`expected +0 to be 2`. The "closes anywhere else" test stays green, which is the pair that proves
the guard is a guard and not the whole mechanism. Restore.

Prove all three restores:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web diff -- libs/shared-ui/src/lib/app-shell/pp-app-shell.ts > /tmp/plan3-task9-diff.txt
grep -c "length > 1" /tmp/plan3-task9-diff.txt
grep -c "id === this.activeBusinessId()" /tmp/plan3-task9-diff.txt
grep -c "this.host.nativeElement.contains(target)" /tmp/plan3-task9-diff.txt
npx ng test shared-ui --watch=false > /tmp/plan3-task9-restored.txt 2>&1; tail -8 /tmp/plan3-task9-restored.txt
```

All three `grep -c` must print `1`, and the suite is green.

- [ ] **Step 8: Commit**

```bash
git -C /Users/thinhhuynh/PeakPower/peakpower-web add \
  libs/shared-ui/src/lib/app-shell/pp-app-shell.ts \
  libs/shared-ui/src/lib/app-shell/pp-app-shell.css \
  libs/shared-ui/src/lib/app-shell/pp-app-shell.spec.ts \
  libs/shared-ui/src/public-api.ts
git -C /Users/thinhhuynh/PeakPower/peakpower-web commit -m "Make the rail's foot a control, for anybody with more than one business

The box already matched the mockup - the hairline, the 10px insets, the avatar on
the same vertical line as the nav dots - and it was a div. It is now a trigger with
a menu that opens upward over the nav, for a person whose login holds memberships
in several businesses, and exactly today's label for everybody else. More than one,
not at least one: a menu with a single row is a control for switching to where you
already are, and this rail has refused that affordance twice.

The identity is an ng-template projected into whichever branch renders rather than
written out twice. Two copies of an avatar-plus-two-lines block drift, and the
existing footer tests pin the relationship between them - including that both lines
are children of __account-text, which a second hand-written copy gets wrong on one
side only.

position:relative goes INSIDE the existing account rule. ruleBody() throws on a
selector matching twice and four assertions read that rule, so a second block would
break them by exception rather than by assertion.

Escape is bound to the element containing both the trigger and the menu, not to the
menu: focus sits on the trigger the moment it opens, and pp-range-picker shipped
that exact defect once already. Dismissal is a document pointerdown with a
containment guard, the same mechanism and for the same reason.

Verified by three mutations: widening canSwitch to length > 0 fails the
one-business case; emitting for the already-active business fails the re-choose
case; dropping the containment guard fails only the press-inside case, leaving its
press-outside pair green.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Wire the switcher into `App`, and invert the assertion that forbade it

`App` already builds the rail's foot from two sources — `/auth/me` names the person, `/company`
names the company — and its doc comment closes with a ruling this task reverses:

```
   * ⚠ Deliberately NOT the mockup's account MENU. That control's body is a list of every company
   * this browser has signed in to, and multi-account sessions are an auth-model change that does
   * not exist: one refresh cookie, one customer. A menu built over it would be an affordance for
   * switching to accounts there is no way to hold.
```

`app.spec.ts:514-523` is the executable form of that ruling:

```ts
  it('offers no way to switch accounts, because there is no such session to switch to', async () => {
    // ⚠ The mockup's account row opens a menu listing every company this browser has signed in
    // to. One refresh cookie, one customer — a control for switching between accounts nobody can
    // hold is the dead affordance this slice keeps refusing to ship.
    const fixture = await mountAt('/dashboard', true);

    expect(footer(fixture)!.querySelectorAll('button')).toHaveLength(0);
    expect(footer(fixture)!.querySelectorAll('a')).toHaveLength(0);
    expect(shell(fixture)!.textContent).not.toContain('Add another account');
  });
```

⚠ **It is inverted, not deleted**, and design §7 says so in terms: *"The app spec's 'offers no way
to switch accounts' is inverted, not deleted."* Deleting it would erase the reasoning; inverting it
keeps the two cases the ruling was actually about and shows which half survived. Two of its three
assertions **stay true and stay in the file**: a person with one membership still gets no control,
and *"Add another account"* — the mockup's affordance for **creating** a login, which design §8
puts out of scope alongside transferring a business and leaving one — is still nowhere.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/app.ts`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/app.spec.ts`

**Interfaces:**
- Consumes: `PpBusinessOption`, `PpAppShell.businesses`, `PpAppShell.activeBusinessId`,
  `PpAppShell.businessSelected` (Task 10); `BusinessSwitcher.switchTo(customerId: string): void`
  (Task 9); `AuthService.account: Signal<CurrentAccount | null>` (unchanged).
- Produces: `App.businesses`, `App.activeBusinessId`, `App.switchBusiness(customerId: string)`.

- [ ] **Step 1: Give the spec a two-membership account and a way to mount with it**

In `apps/customer-portal/src/app/app.spec.ts`, replace the `ACCOUNT` constant at `:81-88` — which
Task 2 left carrying one membership — with the pair:

```ts
const ACCOUNT: CurrentAccount = {
  accountId: 'a1',
  customerId: 'c1',
  firstName: 'Peter',
  lastName: 'de Vries',
  email: 'p.devries@vandersteen.nl',
  membershipRole: 'admin',
  memberships: [{ customerId: 'c1', tradeName: 'Vandersteen Koeling', membershipRole: 'admin' }],
};

/**
 * The same person, in two businesses. A DIFFERENT role in the second one, because the menu shows
 * it and because a screen gating on `membershipRole` must read the active business's and not the
 * first row of the list.
 */
const ACCOUNT_IN_TWO: CurrentAccount = {
  ...ACCOUNT,
  memberships: [
    { customerId: 'c1', tradeName: 'Vandersteen Koeling', membershipRole: 'admin' },
    { customerId: 'c2', tradeName: 'Zaanse Koeling', membershipRole: 'viewer' },
  ],
};

/** What POST /auth/active-business re-mints when the second row is chosen. */
const SESSION_IN_C2 = {
  accessToken: 'minted-for-c2',
  expiresAt: '2026-09-10T12:15:00Z',
  account: { ...ACCOUNT_IN_TWO, customerId: 'c2', membershipRole: 'viewer' },
};

/** The company `/company` answers with once the session is in c2. */
const COMPANY_C2 = { ...COMPANY, id: 'c2', legalName: 'Zaanse Koeling B.V.' };
```

Then let `mountAt` take an account, so no existing call site changes. Replace `:128-129`:

```ts
  const mountAt = async (url: string, session: boolean): Promise<ComponentFixture<App>> => {
    if (session) tokens.set('the-token', ACCOUNT);
```

with:

```ts
  const mountAt = async (
    url: string,
    session: boolean,
    account: CurrentAccount = ACCOUNT,
  ): Promise<ComponentFixture<App>> => {
    if (session) tokens.set('the-token', account);
```

⚠ `drain()` matches by URL and already answers `/api/v1/company` with `COMPANY`. After a switch it
must answer with `COMPANY_C2` instead, or the footer would still read the first legal name and the
assertion below would be satisfied by a store that never reloaded. Replace the `/api/v1/company`
branch inside `drain` at `:188-189`:

```ts
        } else if (url === '/api/v1/company') {
          request.flush(COMPANY);
```

with:

```ts
        } else if (url === '/api/v1/company') {
          // Keyed on the session, not on a counter. `CompanyStore` is keyed on the active business
          // and re-fetches on a switch, so the answer has to follow the token or the footer would
          // read the first legal name over the second business and every assertion below would
          // pass against a store that never reloaded.
          request.flush(tokens.account()?.customerId === 'c2' ? COMPANY_C2 : COMPANY);
```

- [ ] **Step 2: Invert the assertion, and write the switcher's tests**

Replace `app.spec.ts:514-523` in full — the block quoted at the top of this task — with:

```ts
  // ── the switcher ────────────────────────────────────────────────────────
  //
  // ⚠ INVERTED, not deleted. This test used to read "offers no way to switch accounts, because
  // there is no such session to switch to", and it was right: one refresh cookie, one customer,
  // and the mockup's account menu would have been an affordance for accounts nobody could hold.
  // Multi-business membership is that auth-model change (design §1), so the premise is gone.
  //
  // Two thirds of the old assertion survive, and they are kept rather than tidied away: one
  // membership still gets NO control, and "Add another account" — the mockup's affordance for
  // CREATING a login — is still nowhere, because design §8 leaves it out along with transferring
  // a business and leaving one.

  const switcher = (fixture: ComponentFixture<App>): HTMLButtonElement | null =>
    shell(fixture)!.querySelector<HTMLButtonElement>('.pp-app-shell__account-trigger');

  const businessRows = (fixture: ComponentFixture<App>): HTMLButtonElement[] => [
    ...shell(fixture)!.querySelectorAll<HTMLButtonElement>('.pp-app-shell__business-option'),
  ];

  it('offers no way to switch for somebody who is a member of one business', async () => {
    const fixture = await mountAt('/dashboard', true);

    expect(switcher(fixture)).toBeNull();
    expect(footer(fixture)!.querySelectorAll('button')).toHaveLength(0);
    expect(footer(fixture)!.querySelectorAll('a')).toHaveLength(0);
    // Still nowhere, and still deliberately: adding a login is not this product's to offer.
    expect(shell(fixture)!.textContent).not.toContain('Add another account');
  });

  it('offers the other business by trade name and role for somebody in two', async () => {
    const fixture = await mountAt('/dashboard', true, ACCOUNT_IN_TWO);

    switcher(fixture)!.click();
    fixture.detectChanges();

    expect(
      businessRows(fixture).map((row) =>
        row.querySelector('.pp-app-shell__business-name')?.textContent?.trim(),
      ),
    ).toEqual(['Vandersteen Koeling', 'Zaanse Koeling']);
    // Capitalised HERE, in the portal, not on the wire and not in the design system. The shell
    // renders what it is handed; 'admin' is the contract's spelling and 'Admin' is the reader's.
    expect(
      businessRows(fixture).map((row) =>
        row.querySelector('.pp-app-shell__business-role')?.textContent?.trim(),
      ),
    ).toEqual(['Admin', 'Viewer']);
    expect(businessRows(fixture)[0].getAttribute('aria-current')).toBe('true');
    expect(shell(fixture)!.textContent).not.toContain('Add another account');
  });

  it('switches the session, and the rail follows it', async () => {
    const fixture = await mountAt('/dashboard', true, ACCOUNT_IN_TWO);
    expect(footer(fixture)!.querySelector('.pp-app-shell__account-org')?.textContent?.trim()).toBe(
      'Vandersteen Koeling B.V.',
    );

    switcher(fixture)!.click();
    fixture.detectChanges();
    businessRows(fixture)[1].click();
    fixture.detectChanges();

    const post = http.expectOne('/api/v1/auth/active-business');
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ customerId: 'c2' });
    post.flush(SESSION_IN_C2);

    // Everything downstream is keyed on the active business, so the switch is what makes the
    // company and the shelf re-fetch — `drain` answers them, and answers /company with the SECOND
    // company because the token now names it.
    await drain(fixture);
    fixture.detectChanges();

    expect(footer(fixture)!.querySelector('.pp-app-shell__account-org')?.textContent?.trim()).toBe(
      'Zaanse Koeling B.V.',
    );
    // The menu closed on the choice, and the rail now marks the business the session is in.
    expect(businessRows(fixture)).toHaveLength(0);
    switcher(fixture)!.click();
    fixture.detectChanges();
    expect(businessRows(fixture)[1].getAttribute('aria-current')).toBe('true');
    expect(businessRows(fixture)[0].getAttribute('aria-current')).toBeNull();
    switcher(fixture)!.click();
    fixture.detectChanges();
  });

  it('returns to the dashboard from a URL that belongs to the business it left', async () => {
    // /connections/m1 is a metering point of c1. In c2 that id belongs to nobody, so re-resolving
    // the route would answer 404 and show the "not yours" notice one click after the customer
    // chose their own company. Design §7 sends the switch to the dashboard, which every business
    // has.
    const fixture = await mountAt('/connections/m1', true, ACCOUNT_IN_TWO);
    expect(router.url).toBe('/connections/m1');

    const arrived = nextNavigation();
    switcher(fixture)!.click();
    fixture.detectChanges();
    businessRows(fixture)[1].click();
    fixture.detectChanges();
    http.expectOne('/api/v1/auth/active-business').flush(SESSION_IN_C2);
    await arrived;
    await drain(fixture);
    fixture.detectChanges();

    expect(router.url).toBe('/dashboard');
  });
```

- [ ] **Step 3: Run them and read the exact failure**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task10-red.txt 2>&1; grep -n "App >" /tmp/plan3-task10-red.txt > /tmp/plan3-task10-red-lines.txt; cat /tmp/plan3-task10-red-lines.txt; tail -25 /tmp/plan3-task10-red.txt
```

Expected: three failures, and the first of the three is the shape to check for.

- `offers the other business by trade name and role for somebody in two` →
  `TypeError: Cannot read properties of null (reading 'click')`, because `App` does not bind
  `businesses` yet, `canSwitch()` is false and no trigger is rendered.
- `switches the session, and the rail follows it` → the same `TypeError`.
- `returns to the dashboard from a URL that belongs to the business it left` → the same.
- `offers no way to switch for somebody who is a member of one business` → **passes**, because
  nothing is bound. It is the half of the old assertion that survives.

- [ ] **Step 4: Write the implementation**

In `apps/customer-portal/src/app/app.ts`, replace the import block at lines `4-5`:

```ts
import { PageChromeService, PpAppShell, PpButton, PpSkipLink } from '@peakpower-nl/shared-ui';
import type { PpAccountIdentity } from '@peakpower-nl/shared-ui';
```

with:

```ts
import { PageChromeService, PpAppShell, PpButton, PpSkipLink } from '@peakpower-nl/shared-ui';
import type { PpAccountIdentity, PpBusinessOption } from '@peakpower-nl/shared-ui';
```

and line `8`:

```ts
import { AuthService } from './auth/auth.service';
```

with:

```ts
import { AuthService } from './auth/auth.service';
import { BusinessSwitcher } from './auth/business-switcher';
```

Insert after the `initialsFor` function (after line `29`):

```ts
/**
 * The wire's role, in the reader's spelling.
 *
 * ⚠ Here and not in the design system: `PpAppShell` renders `PpBusinessOption.membershipRole`
 * verbatim, exactly as it renders the avatar's initials, so the shared component never learns the
 * customer API's vocabulary and the back office never inherits it.
 *
 * ⚠ And not in the API client either: `'admin'` is an identity the contract fixes (shared contract
 * §3) and `'Admin'` is presentation copy. An unknown value falls through unchanged rather than
 * rendering blank — a role this map has not been taught is still a fact about the membership, and
 * a blank cell beside a business name reads as "no role" rather than as "we did not recognise it".
 */
const MEMBERSHIP_ROLE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  admin: 'Admin',
  trader: 'Trader',
  viewer: 'Viewer',
});
```

Replace lines `62-72`, the shell's opening tag:

```html
    <pp-app-shell
      [bare]="!chrome()"
      [sections]="nav()"
      [activeRouteKey]="activeNavKey()"
      [productName]="productName"
      [crumb]="topbar().crumb"
      [crumbBack]="topbar().back"
      [pageTitle]="pageTitle()"
      [subtitle]="topbar().subtitle"
      [account]="account()"
    >
```

with:

```html
    <pp-app-shell
      [bare]="!chrome()"
      [sections]="nav()"
      [activeRouteKey]="activeNavKey()"
      [productName]="productName"
      [crumb]="topbar().crumb"
      [crumbBack]="topbar().back"
      [pageTitle]="pageTitle()"
      [subtitle]="topbar().subtitle"
      [account]="account()"
      [businesses]="businesses()"
      [activeBusinessId]="activeBusinessId()"
      (businessSelected)="switchBusiness($event)"
    >
```

Add the injection, after line `107` (`private readonly company = inject(CompanyStore);`):

```ts
  private readonly switcher = inject(BusinessSwitcher);
```

Replace the `account` doc comment's closing paragraph — lines `185-189`, which currently read:

```ts
   * ⚠ Deliberately NOT the mockup's account MENU. That control's body is a list of every company
   * this browser has signed in to, and multi-account sessions are an auth-model change that does
   * not exist: one refresh cookie, one customer. A menu built over it would be an affordance for
   * switching to accounts there is no way to hold.
   */
```

with:

```ts
   * ⚠ This block IS the mockup's account menu now, and the ruling it used to carry is reversed by
   * design §1, not forgotten. It read: "multi-account sessions are an auth-model change that does
   * not exist: one refresh cookie, one customer." Multi-business membership is exactly that
   * change — one login, several businesses, a role in each — so the affordance is no longer for
   * accounts nobody can hold. What is still refused is the OTHER half of the mockup's control:
   * "Add another account" creates a login, which design §8 leaves out with transferring a
   * business and leaving one.
   *
   * ⚠ The org line is the LEGAL name and the menu below it lists TRADE names, because that is what
   * each source carries — `/company` answers `legalName` and `memberships[]` carries `tradeName`
   * (design §5). Recorded as an open item in plan 3 rather than silently reconciled here.
   */
```

Append to the class, after the `account` computed and before `signOut()`:

```ts
  /**
   * Every business this login is a member of, as the rail's menu draws them.
   *
   * Straight off the account `/auth/me` already returned — no request of its own, and no second
   * source that could disagree with the session about which businesses exist.
   *
   * ⚠ It includes the business the session is already in. The menu marks that one and refuses to
   * re-choose it; filtering it out here instead would leave the reader unable to see which company
   * they are in from the control that changes it.
   */
  readonly businesses = computed<PpBusinessOption[]>(() =>
    (this.auth.account()?.memberships ?? []).map((membership) => ({
      id: membership.customerId,
      name: membership.tradeName,
      membershipRole:
        MEMBERSHIP_ROLE_LABELS[membership.membershipRole] ?? membership.membershipRole,
    })),
  );

  /** Which of them the session is in. `null` before `/auth/me` lands, which renders no marker. */
  readonly activeBusinessId = computed(() => this.auth.account()?.customerId ?? null);

  /**
   * The rail asked to move business.
   *
   * One line, and everything it does not do is the point: no store is cleared here, no route is
   * computed here, and no request is issued here. `BusinessSwitcher` owns the round trip and the
   * serialisation — two rotations racing revoke the refresh chain — and the stores invalidate
   * themselves, because every one of them is keyed on the active business id.
   */
  switchBusiness(customerId: string): void {
    this.switcher.switchTo(customerId);
  }
```

- [ ] **Step 5: Run them green**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task10-green.txt 2>&1; tail -14 /tmp/plan3-task10-green.txt
```

Expected: green, including every existing `app.spec.ts` footer test —
`names the signed-in person and their company at the foot of the rail`,
`reads the avatar from the FAMILY name, not from the tussenvoegsel`,
`renders no footer at all before anybody is signed in` and
`shows the person immediately and fills the company in underneath`. All four mount with `ACCOUNT`,
whose single membership renders the label form, so none of them sees a trigger.

- [ ] **Step 6: Mutate — the label map, and the id the menu emits**

**Mutation A — render the wire spelling.** In `app.ts`, change the mapping to:

```ts
      membershipRole: membership.membershipRole,
```

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task10-mutantA.txt 2>&1; grep -n "trade name and role" /tmp/plan3-task10-mutantA.txt > /tmp/plan3-task10-mutantA-line.txt; cat /tmp/plan3-task10-mutantA-line.txt; tail -20 /tmp/plan3-task10-mutantA.txt
```

Predicted: exactly one failure —
`App > offers the other business by trade name and role for somebody in two`, reading
`expected [ 'admin', 'viewer' ] to deeply equal [ 'Admin', 'Viewer' ]`. Restore.

**Mutation B — send the name instead of the id.** Change the option's `id` to:

```ts
      id: membership.tradeName,
```

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task10-mutantB.txt 2>&1; grep -n "switches the session" /tmp/plan3-task10-mutantB.txt > /tmp/plan3-task10-mutantB-line.txt; cat /tmp/plan3-task10-mutantB-line.txt; tail -25 /tmp/plan3-task10-mutantB.txt
```

Predicted: `App > switches the session, and the rail follows it` fails on
`expect(post.request.body).toEqual({ customerId: 'c2' })`, reading
`expected { customerId: 'Zaanse Koeling' } to deeply equal { customerId: 'c2' }`. ⚠ The
`aria-current` assertions in the neighbouring test **stay green**, because `activeBusinessId()` is
still `'c1'` and no option's id equals it any more — so nothing is marked and nothing complains
about it. That asymmetry is why the POST body is asserted at all rather than trusted.

Restore, and prove it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web diff -- apps/customer-portal/src/app/app.ts > /tmp/plan3-task10-diff.txt
grep -c "id: membership.customerId" /tmp/plan3-task10-diff.txt
grep -c "MEMBERSHIP_ROLE_LABELS\[membership.membershipRole\]" /tmp/plan3-task10-diff.txt
npx ng test customer-portal --watch=false > /tmp/plan3-task10-restored.txt 2>&1; tail -8 /tmp/plan3-task10-restored.txt
```

Both `grep -c` must print `1`, and the suite is green.

- [ ] **Step 7: Commit**

```bash
git -C /Users/thinhhuynh/PeakPower/peakpower-web add \
  apps/customer-portal/src/app/app.ts \
  apps/customer-portal/src/app/app.spec.ts
git -C /Users/thinhhuynh/PeakPower/peakpower-web commit -m "Let the rail switch business, and invert the test that forbade it

app.spec.ts said 'offers no way to switch accounts, because there is no such
session to switch to', and it was right at the time: one refresh cookie, one
customer, and the mockup's account menu would have been an affordance for accounts
nobody could hold. Multi-business membership IS that auth-model change, so the
premise is gone and the test is inverted rather than deleted - two thirds of it
survive as their own case. One membership still gets no control, and 'Add another
account' is still nowhere, because creating a login is out of scope.

App maps memberships[] into the shell's options and hands the chosen id to
BusinessSwitcher. The role is capitalised HERE: the shell renders what it is handed,
so the design system never learns the customer API's vocabulary and the back office
never inherits it, and the API client never learns the reader's.

Verified by two mutations: rendering the wire spelling fails the menu test with
lowercase roles, and sending the trade name as the option id fails the POST body
assertion - while leaving the aria-current assertions in the neighbouring test
green, which is precisely why the body is asserted rather than trusted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: The no-unmount probe — shared contract §11, plan 3's named obligation

Contract §11 names one probe as **required** of this plan and gives its wording:

| Probe | Plan | Must prove |
| --- | --- | --- |
| **No unmount** | **3** | **A business switch refreshes data without rebuilding the shell** |

It has two halves and a test that proves only one of them proves nothing. **Refreshes data** —
every session-scoped cache in the portal asks the new business rather than replaying the old one.
**Without rebuilding the shell** — the rail, the topbar, the main landmark and the routed page are
the same DOM and the same component instances afterwards, not identical-looking replacements.

⚠ **Identity, never presence.** A `querySelector` that finds a rail again cannot tell a surviving
rail from a freshly built one, and rebuilding it is the defect this probe exists for.
`pp-app-shell.spec.ts` already makes this distinction for bare mode with a stub component whose
object identity is compared; this probe does the same across a switch, and adds the one thing a
DOM node cannot show — that the routed page's component instance was not re-created.

The reason it matters is `App`'s own template comment: the router outlet is deliberately outside
every condition, because *"step 9 of onboarding flips this very condition, by signing the customer
in"* and an outlet inside a branch destroyed the live wizard. A switch flips nothing — `chrome()`
reads `isSignedIn()`, which stays true throughout — and this probe is what keeps that true when
somebody later "simplifies" the shell by keying it on the account or the business.

**Files:**
- Test: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/app.spec.ts`
- Modify: nothing. ⚠ If this probe needs a production change, something in Tasks 4–10 is wrong and
  the fix belongs there, not here.

**Interfaces:**
- Consumes: everything Tasks 1–10 produced. `mountAt(url, session, account)`, `drain(fixture)`,
  `shell(fixture)`, `rail(fixture)`, `topbar(fixture)`, `routedComponent(fixture)`,
  `ACCOUNT_IN_TWO`, `SESSION_IN_C2` and `COMPANY_C2` are all already in `app.spec.ts`.
- Produces: nothing. It is a probe.

- [ ] **Step 1: Write the probe**

Append to `apps/customer-portal/src/app/app.spec.ts`, after the switcher block from Task 11:

```ts
  // ── shared contract §11: the "no unmount" probe ──────────────────────────
  //
  // "A business switch refreshes data without rebuilding the shell." Both halves, in one test,
  // because a test that proved either alone would pass over the failure mode of the other: a shell
  // that survives while every cache replays the old business is exactly as broken as one that
  // refetches everything and rebuilds the frame under the reader's cursor.
  //
  // ⚠ Compared by IDENTITY. `querySelector` finding a rail again cannot tell a surviving rail from
  // a replacement, and a replacement is the defect.

  it('refreshes every cache on a switch without rebuilding the shell', async () => {
    const fixture = await mountAt('/dashboard', true, ACCOUNT_IN_TWO);

    const shellBefore = shell(fixture);
    const railBefore = rail(fixture);
    const topbarBefore = topbar(fixture);
    const mainBefore = (fixture.nativeElement as HTMLElement).querySelector('#pp-main');
    const pageBefore = routedComponent(fixture);
    expect(pageBefore).not.toBeNull();
    expect(footer(fixture)!.querySelector('.pp-app-shell__account-org')?.textContent?.trim()).toBe(
      'Vandersteen Koeling B.V.',
    );

    switcher(fixture)!.click();
    fixture.detectChanges();
    businessRows(fixture)[1].click();
    fixture.detectChanges();
    http.expectOne('/api/v1/auth/active-business').flush(SESSION_IN_C2);
    fixture.detectChanges();

    // ── half one: the data is asked for again, and asked of the NEW business ──
    //
    // Matched before `drain` gets to them, so the assertion is on the requests the switch itself
    // caused rather than on whatever the page settled into afterwards. All three are the caches
    // design §7 names: the company behind the rail's footer, the entitlement shelf the rail and
    // every guard read, and the connections the Day Ahead group lists.
    const refetched = http
      .match(
        (request) =>
          request.url === '/api/v1/company' ||
          request.url === '/api/v1/company/entitlements' ||
          request.url === '/api/v1/metering-points',
      )
      .map((request) => request.request.url);
    expect(refetched).toContain('/api/v1/company');
    expect(refetched).toContain('/api/v1/company/entitlements');
    for (const request of http.match(() => true)) {
      request.flush({ items: [], total: 0 });
    }
    await drain(fixture);
    fixture.detectChanges();

    // ── half two: nothing was rebuilt ──
    //
    // The same objects, not equal-looking ones. `toBe` is reference equality on both the DOM nodes
    // and the routed component instance; a shell rebuilt on the token, or an outlet moved inside a
    // condition keyed on the business, fails here and nowhere else in this file.
    expect(shell(fixture)).toBe(shellBefore);
    expect(rail(fixture)).toBe(railBefore);
    expect(topbar(fixture)).toBe(topbarBefore);
    expect((fixture.nativeElement as HTMLElement).querySelector('#pp-main')).toBe(mainBefore);
    expect(routedComponent(fixture)).toBe(pageBefore);

    // And it did not blink through bare mode on the way. `chrome()` reads `isSignedIn()`, which is
    // true throughout a switch because the token is REPLACED and never cleared — but a rail that
    // was torn down and rebuilt within one change-detection pass would satisfy every identity
    // assertion above only if it were not torn down at all, which is what this re-states from the
    // reader's side.
    expect(rail(fixture)).not.toBeNull();
    expect(topbar(fixture)).not.toBeNull();
  });

  it('names the new business in the footer once the switch has settled', async () => {
    // The other side of "refreshes data": the requests going out is necessary and not sufficient —
    // the store has to accept the answer, which is what the generation counter could have broken
    // by dropping a live response as stale.
    const fixture = await mountAt('/dashboard', true, ACCOUNT_IN_TWO);

    switcher(fixture)!.click();
    fixture.detectChanges();
    businessRows(fixture)[1].click();
    fixture.detectChanges();
    http.expectOne('/api/v1/auth/active-business').flush(SESSION_IN_C2);
    await drain(fixture);
    fixture.detectChanges();

    expect(footer(fixture)!.querySelector('.pp-app-shell__account-org')?.textContent?.trim()).toBe(
      'Zaanse Koeling B.V.',
    );
    // The person did not change — one login, several businesses. A footer that re-read the name
    // from the company rather than from the account would have moved it too.
    expect(footer(fixture)!.querySelector('.pp-app-shell__account-name')?.textContent?.trim()).toBe(
      'Peter de Vries',
    );
    expect(footer(fixture)!.querySelector('.pp-app-shell__avatar')?.textContent?.trim()).toBe('PV');
  });
```

- [ ] **Step 2: Run it**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task11.txt 2>&1; grep -n "no unmount\|rebuilding the shell\|settled" /tmp/plan3-task11.txt > /tmp/plan3-task11-lines.txt; cat /tmp/plan3-task11-lines.txt; tail -20 /tmp/plan3-task11.txt
```

Expected: **green.** Unlike every other test in this plan, this one is written last and is
expected to pass immediately — it is a probe over work already done, and a probe that failed here
would mean a defect in Tasks 4–10, to be fixed there. Say so in the report either way.

⚠ If `expect(refetched).toContain('/api/v1/company')` fails, Task 5 did not land. If the identity
assertions fail, something is keying the shell or the outlet on the session — read `App`'s
template comment at `:36-55` before changing anything.

- [ ] **Step 3: Mutate — and mutate the SHELL, because that is what the probe claims**

The data half is already covered by Task 5's and Task 6's own mutations. This step proves the
identity half, which nothing else in the repository does.

In `apps/customer-portal/src/app/app.ts`, wrap the outlet in a condition keyed on the session — the
exact "simplification" the probe exists to refuse. Replace line `73`:

```html
      <main id="pp-main" tabindex="-1"><router-outlet /></main>
```

with:

```html
      @if (activeBusinessId(); as business) {
        <main id="pp-main" tabindex="-1"><router-outlet /></main>
      }
```

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false > /tmp/plan3-task11-mutant.txt 2>&1; grep -n "rebuilding the shell" /tmp/plan3-task11-mutant.txt > /tmp/plan3-task11-mutant-line.txt; cat /tmp/plan3-task11-mutant-line.txt; tail -30 /tmp/plan3-task11-mutant.txt
```

Predicted: `App > refreshes every cache on a switch without rebuilding the shell` fails on
`expect((fixture.nativeElement as HTMLElement).querySelector('#pp-main')).toBe(mainBefore)` with
`expected <main id="pp-main" tabindex="-1"> to be <main id="pp-main" tabindex="-1">` — two nodes
that print identically and are not the same object, which is the whole reason the probe compares
identity rather than presence. `expect(routedComponent(fixture)).toBe(pageBefore)` fails the same
way if the run gets that far.

⚠ Other tests in `app.spec.ts` will fail alongside it — the sign-in and onboarding cases mount with
no session at all, so this mutation hides the outlet from them entirely. That is expected and is
not the assertion being demonstrated; read the named failure above, not the count.

Restore, and prove it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web diff -- apps/customer-portal/src/app/app.ts > /tmp/plan3-task11-diff.txt
grep -c "activeBusinessId(); as business" /tmp/plan3-task11-diff.txt
npx ng test customer-portal --watch=false > /tmp/plan3-task11-restored.txt 2>&1; tail -8 /tmp/plan3-task11-restored.txt
```

`grep -c` must print `0`, and the suite is green.

- [ ] **Step 4: Run everything, in both portals and the workspace**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test shared-ui       --watch=false > /tmp/plan3-final-ui.txt 2>&1;  tail -8 /tmp/plan3-final-ui.txt
npx ng test customer-portal --watch=false > /tmp/plan3-final-cus.txt 2>&1; tail -8 /tmp/plan3-final-cus.txt
npx ng test employee-portal --watch=false > /tmp/plan3-final-emp.txt 2>&1; tail -8 /tmp/plan3-final-emp.txt
PEAKPOWER_PLATFORM_PATH=/Users/thinhhuynh/PeakPower/peakpower-platform \
  npm run test:workspace > /tmp/plan3-final-ws.txt 2>&1; tail -8 /tmp/plan3-final-ws.txt
npx ng build shared-ui       > /tmp/plan3-final-build-ui.txt 2>&1;  tail -5 /tmp/plan3-final-build-ui.txt
npx ng build customer-portal > /tmp/plan3-final-build-cus.txt 2>&1; tail -5 /tmp/plan3-final-build-cus.txt
```

All six green, read back from the files rather than from the terminal.

- [ ] **Step 5: Commit**

```bash
git -C /Users/thinhhuynh/PeakPower/peakpower-web add apps/customer-portal/src/app/app.spec.ts
git -C /Users/thinhhuynh/PeakPower/peakpower-web commit -m "Prove a switch refreshes the data without rebuilding the shell

Shared contract section 11 names this probe as plan 3's, and it has two halves that
have to be asserted together: a shell that survives while every cache replays the
old business is exactly as broken as one that refetches everything and rebuilds the
frame under the reader's cursor.

Compared by identity and never by presence. querySelector finding a rail again
cannot tell a surviving rail from a replacement, and a replacement is the defect -
so the shell element, the rail, the topbar, the main landmark and the ROUTED
COMPONENT INSTANCE are all compared with toBe.

It exists because App's outlet is deliberately outside every condition: an outlet
inside a branch was destroyed when onboarding step 9 signed the customer in, and
the wizard came back empty with the agreement already signed. A switch flips no
condition today, and this is what keeps that true when somebody keys the shell on
the business.

Verified by mutation: wrapping the outlet in a condition on the active business
fails the identity assertion with two main elements that print identically and are
not the same object.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done when

Every box below is checked against a file on disk, not against a memory of a terminal.

- [ ] `npx ng test shared-ui --watch=false` green.
- [ ] `npx ng test customer-portal --watch=false` green — which also runs
      `libs/api-client-customer/src/**/*.spec.ts`.
- [ ] `npx ng test employee-portal --watch=false` green — which also runs
      `libs/api-client-employee/src/**/*.spec.ts` (`angular.json:120-122`) — and
      `npx ng build employee-portal` succeeds.
- [ ] `git diff --stat -- libs/api-client-employee` against the pre-plan commit is **NOT empty**,
      and that is the expected answer, not Deviation D4 arriving. Contract §13.3: plan 1's sweep
      moves both OpenAPI documents, and *"plan 3 owns every resulting repair"*. `AccountDto`,
      `CreateAccountRequest` and `UpdateAccountRequest` each lost `isAdmin` and gained
      `membershipRole`; **Task 3 repairs the eleven files that read them**. ⚠ An **empty** diff is
      the failure: it means plan 1 stopped at `CurrentAccountResponse` and left the F12 employee
      surface on the boolean, which contract §10 puts in scope. Report that to the contract owner.
- [ ] `PEAKPOWER_PLATFORM_PATH=… npm run test:workspace` green — the committed clients match the
      platform's documents byte-for-byte.
- [ ] `npx ng build shared-ui` and `npx ng build customer-portal` both succeed.
- [ ] `grep -rn "isAdmin" apps libs e2e --include="*.ts"` returns **nothing at all**. Not the two
      `company-page` files — Task 2 repairs those, because contract §13.3 drops `isAdmin` from
      `CompanyAccountDto` too — and not the employee portal or `e2e/`, which Task 3 repairs. Read
      the result from a file; a bare `grep` that scrolled proves nothing.
- [ ] Twelve commits, one per task, each naming what it was verified against.
- [ ] The mutation results are reported, including **Task 7 Mutation B, which does not bite** — the
      boolean key passes every test in the repository, and the business key is kept for the reason
      written into the code rather than because a test proves it.
- [ ] Deviations D1–D4 and Open items 1–3 are carried into the review, not dropped. ⚠ D4 has been
      **rewritten**, not merely annotated: it now assigns both halves to this plan.
- [ ] Nothing in `auth.interceptor.ts`, `authenticated.guard.ts`, `entitlement.guard.ts`,
      `token-refresher.ts` or `app.routes.ts` was modified. ⚠ `apps/employee-portal/` is no longer
      on this list — Task 3 modifies eight files under it, plus one under `libs/api-client-employee`
      and two under `e2e/`, and nothing else there moves.
- [ ] No `/company/memberships` or `/company/invitations` route, type, screen or client method
      exists anywhere in this branch. Those are plan 4's.
