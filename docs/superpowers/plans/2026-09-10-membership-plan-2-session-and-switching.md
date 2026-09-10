# Membership plan 2 — Session and switching

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one login carry several businesses through a whole session. `GET /api/v1/auth/me`
grows `memberships[]` and `membershipRole` and **loses `isAdmin`**; the existing
`customer_customer_tenant_isolation` policy is **widened** — not duplicated — so the other
businesses can be named, and the EF global query filter on `Customer` is widened with it;
`POST /api/v1/auth/active-business` verifies membership, re-declares the tenant scope, writes
`last_active_business_id`, issues a refresh token bound to the new business and re-mints the access
token; refresh **re-proves** membership and fails **terminally** when it finds none; sign-in lands on
`last_active_business_id` if that is still a live membership, else on the **oldest** membership by
`created_at`, else on a named terminal answer for an account with **zero** memberships.

**Architecture:** Tenancy stays two independent layers and this plan moves **both of them in the
same task**. Layer 1 is the EF Core global query filter in `PeakPowerDbContext.OnModelCreating`;
layer 2 is the PostgreSQL row-level-security policy. Today both say *"the business in your token"*
for `customer.customer`. After task 1 both say *"the business in your token, **or** any business
this account holds a live membership in"*. Widening one without the other is the failure mode the
design names by hand: with only the policy widened, `memberships[].tradeName` still resolves to the
active business alone, and the obvious "fix" — `IgnoreQueryFilters()` — drops layer 1 for the whole
query and is banned by an IL scan
(`TenancyArchitectureTests.no_type_calls_ignore_query_filters`).

Every endpoint in this plan is on the **customer** host. Three of the four run **anonymously on the
owner connection** (sign-in, refresh) or **authenticated under `app_customer_role`** (`me`,
`active-business`), and the difference decides which layer is doing the work in each handler. The
switch is the one handler in the codebase that changes `app.customer_id` **mid-request**, because
the refresh-token row it must insert names the *new* business while the middleware scoped the
transaction to the *old* one.

**Tech Stack:** .NET SDK 10.0.400 · `net10.0` · `Nullable enable` · `TreatWarningsAsErrors` ·
EF Core 10.0.11 (`Microsoft.EntityFrameworkCore`, `.Design`, `.Relational`) · Npgsql 10.0.3
(`Npgsql`, `Npgsql.EntityFrameworkCore.PostgreSQL`) · `EFCore.NamingConventions` 10.0.1 ·
PostgreSQL 17 · xunit.v3 3.2.2 · `xunit.runner.visualstudio` 3.1.5 · `Microsoft.NET.Test.Sdk` 18.9.0
· Shouldly 4.3.0 (⚠ **never FluentAssertions** `[DEC-118]`) · Testcontainers.PostgreSql 4.14.0 ·
Verify.XunitV3 30.15.0 · Docker (daemon running)

**Spec:** `docs/superpowers/specs/2026-09-10-multi-business-membership-design.md`
**Shared contract:** `docs/superpowers/plans/2026-09-10-membership-shared-contract.md`

---

## Global Constraints

### Repositories and commands

```
platform = /Users/thinhhuynh/PeakPower/peakpower-platform
web      = /Users/thinhhuynh/PeakPower/peakpower-web
specs    = /Users/thinhhuynh/PeakPower/peakpowerspecs
```

Always `git -C <path>` and absolute paths — the shell working directory is not stable between calls
in this environment.

```bash
# platform
dotnet build
dotnet test
dotnet ef migrations add <Name> --project src/Infrastructure/PeakPower.Persistence --startup-project src/Hosts/PeakPower.Migrator

# web — run these individually; `npm run test` also runs verify:clients,
# which fails whenever the platform's OpenAPI has moved and the client has not been regenerated
npx ng test shared-ui       --watch=false
npx ng test customer-portal --watch=false
npx ng test employee-portal --watch=false
npm run generate:clients    # after ANY platform contract change
```

⚠ **rtk truncates and sometimes fabricates shell output.** Redirect to a file and read the file back
before concluding anything. Never conclude from a bare `grep`/`find`/`ls` that scrolled.

⚠ **Verify by mutation.** A green test is not evidence. Break the thing under test on purpose,
predict the exact failure, run it, confirm it failed as predicted, restore, prove the restore with
`diff`. Report the mutation output. This is the house standard and a review will reject work without
it.

### Plan order — this plan starts only when plan 1 is green

> Plan 1 must be complete and green before plan 2 starts: it is the only plan that changes what a
> tenancy claim means, and plans 2–4 assume the new meaning.

Plan 1 owns migration 15, the two proofs (the RLS policies and the EF filters re-pointed at
membership), the `customer_id`/`is_admin` column drop and the whole `is_admin` sweep. **This plan
may not add a statement to migration 15.** It writes **migration 16**.

### Naming — normative, copied verbatim from shared contract §3

| Thing | Name | Why not the obvious name |
| --- | --- | --- |
| The table | `customer.customer_membership` | |
| The role column | `customer_membership.role` | |
| The wire field | **`membershipRole`** | `role` is already **job title** on the account record, and `[F01-R13]` says it is *"descriptive only… never checked"* |
| The preference column | **`last_active_business_id`** | ⚠ **Never `last_customer_id`.** The RLS coverage guards discover tenant columns by the suffix `customer_id` (`right(column_name, 11)`) and CLR properties by `EndsWith("CustomerId")`. A preference column matching that suffix keeps `customer_account` in tenancy discovery keyed on something that is not a tenancy key |
| The soft-delete column | `removed_at` | |
| The admin predicate | `customer.is_admin_of(uuid, uuid)` | |
| Role values | `'admin'`, `'trader'`, `'viewer'` | ⚠ `trader`/`viewer` collide with the **employee** vocabulary `[F13-R12]`. Accepted; any code naming both spells `membershipRole` and `employeeRole` explicitly |

The policy names follow the existing convention, which the slice-2 contract made normative:
`{schema}_{table}_tenant_isolation` and `{schema}_{table}_back_office`.

⚠ Role values are **lowercase in the database** — the `CHECK (role IN ('admin', 'trader',
'viewer'))` of contract §4 and the `role = 'admin'` inside `customer.is_admin_of` both say so — so
the wire spelling of `membershipRole` is **lowercase too** (contract §8). That is a deliberate
exception to this repository's SCREAMING_SNAKE enum convention, and **task 2** exists to make it a
single, tested spelling rather than an accident.

### Migration 15 DDL — NORMATIVE, owned by plan 1 alone (contract §4)

Reproduced here so this plan's SQL can be read against it. **Plan 2 may not add to this migration.**

```sql
-- 1. the preference column, BEFORE anything writes to it
ALTER TABLE customer.customer_account ADD COLUMN last_active_business_id uuid NULL
    REFERENCES customer.customer(id);

-- 2. the membership table
CREATE TABLE customer.customer_membership (
    account_id  uuid NOT NULL REFERENCES customer.customer_account(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES customer.customer(id)         ON DELETE RESTRICT,
    role        text NOT NULL CHECK (role IN ('admin', 'trader', 'viewer')),
    created_at  timestamptz NOT NULL,
    removed_at  timestamptz NULL,
    PRIMARY KEY (account_id, customer_id)
);
CREATE INDEX ix_customer_membership_customer_id ON customer.customer_membership (customer_id);

-- 3. grants and RLS — see §5. NO DELETE GRANT, EVER, TO EITHER ROLE.

-- 4. backfill: one membership per existing account
-- ⚠ customer_account has NO created_at column (verified against InitialSchema). The membership's
--   own created_at is now(); "oldest account" in §4.1 orders by id, which is a UUIDv7 whose
--   leading 48 bits are a millisecond timestamp, in Postgres's uuid comparison order.
INSERT INTO customer.customer_membership (account_id, customer_id, role, created_at)
SELECT id, customer_id, CASE WHEN is_admin THEN 'admin' ELSE 'trader' END, now()
FROM customer.customer_account;

-- 5. first-admin repair — see §4.1

-- 6. backfill the preference column
UPDATE customer.customer_account SET last_active_business_id = customer_id;

-- 7. drop the three policies that depend on customer_account.customer_id,
--    create their replacements (§5), add refresh_token.customer_id and its policy pair

-- 8. ONLY NOW drop the columns
ALTER TABLE customer.customer_account DROP COLUMN customer_id;   -- with its index and FK
ALTER TABLE customer.customer_account DROP COLUMN is_admin;
```

### Grants and policies — NORMATIVE, copied verbatim from shared contract §5

```sql
ALTER TABLE customer.customer_membership ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer.customer_membership FROM app_customer_role, app_employee_role;
GRANT SELECT, INSERT, UPDATE ON customer.customer_membership TO app_customer_role;
GRANT SELECT, INSERT, UPDATE ON customer.customer_membership TO app_employee_role;

CREATE FUNCTION customer.is_admin_of(account uuid, business uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER STABLE
    SET search_path = customer, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM customer.customer_membership
                   WHERE account_id = account AND customer_id = business
                     AND role = 'admin' AND removed_at IS NULL) $$;
REVOKE EXECUTE ON FUNCTION customer.is_admin_of(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION customer.is_admin_of(uuid, uuid) TO app_customer_role;

CREATE POLICY customer_customer_membership_tenant_isolation ON customer.customer_membership
    FOR ALL TO app_customer_role
    USING      (account_id  = NULLIF(current_setting('app.account_id',  true), '')::uuid
             OR customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
    WITH CHECK (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid
            AND customer.is_admin_of(NULLIF(current_setting('app.account_id', true), '')::uuid,
                                     NULLIF(current_setting('app.customer_id', true), '')::uuid));

CREATE POLICY customer_customer_membership_back_office ON customer.customer_membership
    FOR ALL TO app_employee_role USING (true) WITH CHECK (true);
```

**The three replaced policies** (contract §5.2), all plan 1's:

| Table | New predicate |
| --- | --- |
| `customer.customer_account` | `EXISTS (SELECT 1 FROM customer.customer_membership m WHERE m.account_id = customer_account.id AND m.customer_id = <app.customer_id> AND m.removed_at IS NULL)` |
| `customer.password_reset_token` | the same `EXISTS`, joined through `customer_account_id` |
| `customer.refresh_token` | ⚠ **NOT the `EXISTS` shape** — it gains its own `customer_id` column and uses the uniform `customer_id = <app.customer_id>` |

**Column-scoped grants** (contract §5.3), all plan 1's, and this plan is the reason two of them
exist:

```sql
REVOKE UPDATE, DELETE ON customer.customer_account FROM app_customer_role;
GRANT  UPDATE (last_active_business_id) ON customer.customer_account TO app_customer_role;
-- refresh_token today holds SELECT + UPDATE (revoked_at) only; rotation needs more:
GRANT  INSERT ON customer.refresh_token TO app_customer_role;
GRANT  UPDATE (used_at, replaced_by_token_id) ON customer.refresh_token TO app_customer_role;
```

⚠ A blanket `REVOKE UPDATE` on `customer_account` is correct against every call site that exists
today and **wrong** against plan 2's `active-business`, which is authenticated and must write the
preference column. Column scoping lets exactly that through while `password_hash` and
`security_stamp` stay unreachable.

⚠ **The `refresh_token` grants ship with `trg_refresh_token_evidence_monotonic`** (contract §5.3,
plan 1's). Combined with the existing `UPDATE (revoked_at)`, `used_at` and `replaced_by_token_id`
are exactly the set that makes `SET used_at = NULL, revoked_at = NULL, replaced_by_token_id = NULL`
succeed — un-spending a spent token, which is what migration 3 narrowed this table to prevent. The
trigger refuses any update that nulls a non-null value in those three columns, and the existing
schema test that expected `42501` on that statement now expects `23001`. Every write this plan makes
to `refresh_token` moves a column **from** null (an `INSERT`, and task 6's revocation of the
business being left), so none of them meets the trigger.

### The request path — NORMATIVE, owned by plan 1 (contract §6)

```
1. token verified -> account id claim, customer id claim. NO role claim.
   Both Guid.TryParse'd before they touch a statement.
2. SET LOCAL ROLE app_customer_role
   SELECT set_config('app.account_id',  $1, true)
   SELECT set_config('app.customer_id', $2, true)     -- CLAIMED, not yet proven
3. SELECT role FROM customer.customer_membership
     WHERE account_id  = current_setting('app.account_id')::uuid
       AND customer_id = current_setting('app.customer_id')::uuid
       AND removed_at IS NULL
4. no row -> 401. row -> role onto ICustomerContext.
5. SELECT security_stamp, status FROM customer.customer_account
     WHERE id = current_setting('app.account_id')::uuid
```

- ⚠ **`set_config`, never `SET LOCAL <name> = <value>`.** House rule, stated in the existing code:
  *"`SET` does not accept a parameter, and concatenating a value into a tenancy control is how
  injection gets in."* The statement text is pinned by a test; the new `app.account_id` line joins
  that pinning.
- ⚠ **Setting `app.customer_id` before the proof keeps one batch and stays fail-closed.**
- ⚠ **Step 5 must run after step 4's setting**, or the new `EXISTS` policy hides the account row and
  every authenticated request 401s. It is a second read on a second table.

Step 4's 401 is what makes this plan's **immediate revocation** probe (task 7) pass; plan 2 does not
implement it and must not reimplement it in a handler.

### Types that cross plan boundaries — NORMATIVE, copied verbatim from shared contract §7

```csharp
// PeakPower.Domain/Customers/MembershipRole.cs
public enum MembershipRole { Admin, Trader, Viewer }   // db spelling: 'admin' | 'trader' | 'viewer'

// PeakPower.Domain/Customers/CustomerMembership.cs — its own aggregate relationship
public sealed class CustomerMembership
{
    public Guid AccountId { get; private set; }
    public Guid CustomerId { get; private set; }
    public MembershipRole Role { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset? RemovedAt { get; private set; }

    public bool IsActive => RemovedAt is null;
    // ⚠ Result<T>, not the bare type — the house pattern for a factory that can refuse. Every
    //   caller writes `.Value`. Nothing in plan 2 calls it: MembershipSeed writes the table by raw
    //   SQL, because shared contract §4 makes the columns normative and nothing pins plan 1's DbSet.
    public static Result<CustomerMembership> Create(Guid accountId, Guid customerId, MembershipRole role, DateTimeOffset at);
    public void ChangeRole(MembershipRole role);
    public void Remove(DateTimeOffset at);
    public void Restore(DateTimeOffset at);
}

// PeakPower.Application/Abstractions/ICustomerContext.cs — MODIFIED
public interface ICustomerContext
{
    Guid CustomerId { get; }
    Guid AccountId { get; }               // already present today
    MembershipRole Role { get; }          // REPLACES bool IsAdmin
    bool IsAuthenticated { get; }
}
```

⚠ `IsAdmin` is **removed** from `ICustomerContext`, not kept alongside `Role`. Two sources of truth
for the same fact is how a demoted admin keeps admin rights for fifteen minutes.

⚠ `ITokenIssuer.IssueAccessToken` takes only the account today and stamps `customer_id` and
`is_admin` off it. It becomes `IssueAccessToken(CustomerAccount account, Guid customerId)` — **no
role argument**, because the role is not in the token. Every call site changes: sign-in, refresh,
and plan 2's switch.

### Wire contracts — NORMATIVE, copied verbatim from shared contract §8

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
| `/api/v1/company/invitations/accept` | POST `{ token, firstName?, lastName?, password? }` | **anonymous** | plan 4 |

⚠ No auth or company route is inside the frozen slice-2 sections (§8.4, §9, §10 — consumption,
webhooks, employee data health). The published customer OpenAPI regenerates normally, and
`npm run generate:clients` must run in the web repo after any of these land.

### Guards that will fail, and how each must be answered — contract §9

1. **`policyCount == 2`** per tenant table. ⚠ **Plan 2 widens the existing
   `customer_customer_tenant_isolation` predicate rather than adding a third policy to
   `customer.customer`.** Task 1 does exactly that, by `DROP POLICY` + `CREATE POLICY` under the
   same name — `ALTER POLICY` cannot change a policy's command, and this one changes from
   `FOR ALL` to `FOR SELECT`.
2. **Discovery by `customer_id` suffix**, model-side and catalogue-side. Plan 2 adds no column, so
   the discovered sets do not move.
3. **Every customer-owned entity needs a global query filter or an argued exemption.** `Customer`
   keeps its filter — widened, not removed. `CustomerMembership`'s exemption is plan 1's.

Also moving: the route-table test pins the complete customer route list by hand, every endpoint must
declare `.TenantScoped()` / `.BackOffice()` / `.AnonymousEndpoint()`, and the mutating-endpoint count
is cross-checked against a sample-bodies collection. Contract §9 counts **six** new routes across the
four plans; **one** of them is plan 2's, and task 6 touches all three harnesses for it.

### Testing conventions — contract §11

Every plan verifies by mutation. Beyond that, these probes are **required** and named so no plan
omits one. Plan 2 owns three of them, and each has a task of its own:

| Probe | Task | Must prove |
| --- | --- | --- |
| **Zero memberships** | 4 | Sign-in with no memberships is a named answer, not a crash |
| **Refresh termination** | 5 | Refresh after removal terminates rather than looping |
| **Immediate revocation** | 7 | Removal takes effect on the **next request**, not at token expiry, and does not disturb that person's session elsewhere |

⚠ Contract §11's **cross-tenant** probe belongs to plan 1, and its third vector — *"a pre-switch
refresh cookie presented after a switch"* — is about behaviour **task 6 has to build**. See task 6.

Syntax is `actual.ShouldBe(expected)` and `await Should.ThrowAsync<T>(act)`. ⚠ **Shouldly's
`ShouldContain` is case-insensitive by default** and has silently broken three tests in this
repository; compare with `StringComparison.Ordinal` and assert on structured fields.

**Pin counted invariants to a computed expectation, not a floor.** `assert count > 0` passes when a
discovery query silently returns the wrong set.

---

## Deviations from the design and the shared contract, and open items

The contract is normative and this plan follows it. Seven places needed a decision neither document
makes, or where the design's abbreviated text cannot be implemented literally. All seven are here so
a reviewer finds them in one place rather than scattered through this plan's eight tasks.

### D1 — The design's widened predicate omits `removed_at IS NULL`; this plan adds it

Design §5 writes the widened `customer.customer` predicate as

```
id = app.customer_id OR id IN (SELECT customer_id FROM customer.customer_membership WHERE account_id = app.account_id)
```

with no `removed_at` term, while design §3.1 says *"Active membership means `removed_at IS NULL` —
every predicate in §4 carries it"* and §4.3 spells the `customer_account` replacement with an
explicit `AND m.removed_at IS NULL`. Taken literally, §5's snippet would let a **removed** member
keep reading the trade name of the business they were removed from. Task 1 carries the term. The
contract does not pin this predicate at all, so this is plan 2's own business — recorded because it
is a difference from a sentence in the design a reviewer will read.

### D2 — `customer_customer_tenant_isolation` becomes `FOR SELECT`, and that moves a pinned test

Design §5: *"It must be `FOR SELECT TO app_customer_role`."* Today the policy is `FOR ALL` with a
`WITH CHECK` arm. `pg_policies.with_check` is **NULL** for a `FOR SELECT` policy, and
`RowLevelSecurityTests.the_tenant_isolation_policy_predicate_reads_the_literal_app_customer_id_setting`
reads it with `reader.GetString(1)` — which throws `InvalidCastException` on NULL rather than
failing an assertion. That test is `[Theory]`-driven over all five customer-owned tables, so task 1
must widen the test as well as the policy. Verified at
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs:616`.

`FOR SELECT` also means `app_customer_role` has **no** policy for `INSERT`/`UPDATE`/`DELETE` on
`customer.customer`, so those commands see no rows (or, for `INSERT`, violate row-level security)
even though migration 2's bulk `GRANT` still holds the privilege. That is strictly safer than today
and no call site is lost: verified with a whole-tree read, the only authenticated read of
`db.Customers` on the customer host is `CompanyEndpoints.cs:43`, and the only writes are
`OnboardingService.cs:434` (anonymous, owner connection) and the employee host's
`CustomerEndpoints.cs:200`/`:236`/`:281` (which run as `app_employee_role` under
`customer_customer_back_office`).

### D3 — "Rotates the refresh token to the new business" cannot mean *the presented* token

Design §5 and contract §5.3 both describe the switch as *rotating* the refresh token, and §5.3 adds
`GRANT UPDATE (used_at, replaced_by_token_id)` for it. **The switch cannot see the presented refresh
token.** `RefreshCookie.Path` is `/api/v1/auth/refresh`
(`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Auth/RefreshCookie.cs:14`),
so a browser never attaches `pp_refresh` to `/api/v1/auth/active-business` — the same asymmetry
`SignOutAsync`'s own doc comment records. Task 6 therefore **issues a new refresh token bound to the
new business and overwrites the cookie**, and it **revokes this account's live refresh tokens for the
business being left** — by `customer_id`, not by device:

- ⚠ Contract §11's cross-tenant probe requires *"a pre-switch refresh cookie presented after a
  switch"* to be **refused** (design §10's *"switched-then-reverted refresh token"*). Leaving the
  abandoned row live means that cookie still refreshes into the old business, which is the exact
  vector the probe names. Revoking by `customer_id` closes it.
- Revoking is **not** `MarkUsed`. Marking this account's other rows used-and-replaced would make the
  next refresh from the person's phone a **replay**, which `RefreshAsync` answers by revoking the
  whole chain **and bumping the security stamp** — signing them out of every device for pressing a
  switcher on a laptop. `RefreshToken.Revoke(at)` is `RevokedAt ??= at`: no replay, no stamp bump.
- It is **not** "sign me out everywhere" either. Only tokens whose `customer_id` is the business
  being left are touched; a session this person holds for any *other* business is untouched, which
  is the same per-business shape design §5 gives plan 4's removal.
- `RevokedAt ??= at` writes null → value, so it satisfies plan 1's
  `trg_refresh_token_evidence_monotonic` (contract §5.3).

So the switch uses the new `INSERT` grant and the **existing** `UPDATE (revoked_at)` grant, and not
the new `UPDATE (used_at, replaced_by_token_id)` grant. That grant is still correct to have — plan
4's removal path and any future rotation need it — but plan 2 does not exercise it.

### D4 — The switch re-declares `app.customer_id` inside the request

After plan 1, `customer.refresh_token` carries `customer_id` and is policed by the uniform
`customer_id = app.customer_id` pair (contract §5.2). The switch must insert a row naming the **new**
business while `CustomerSessionMiddleware` set `app.customer_id` to the **old** one, so the insert
fails the `WITH CHECK` arm. Task 6 issues one extra statement —
`SELECT set_config('app.customer_id', $1, true)` — inside the request's own transaction, after the
membership proof and before any write, through a new
`PeakPower.Infrastructure.Web.Tenancy.ActiveBusinessScope` helper. That is the house-legal spelling
(`set_config`, parameterised, never `SET LOCAL`), it lives in the one assembly architecture fact 6
allows to know about the request, and it is the honest statement of what the endpoint does. Neither
the design nor the contract mentions it, because neither works through the `WITH CHECK` arm on the
token row.

⚠ Layer 1 does **not** move with it: `ICustomerContext.CustomerId` is still the old business for the
rest of the request, because the JWT has not changed. Task 6's handler touches exactly two filtered
tables after the re-scope — `customer_account` (whose filter and policy both pass, because the
account is a live member of *both* businesses) and `refresh_token` (which carries no EF filter at
all; it is on `QueryFilterModelTests.ExemptEntityTypes`). The handler's own comment says so.

⚠ **The revocation of D3 runs BEFORE the move, and as raw SQL.** `refresh_token`'s policy is
`customer_id = app.customer_id` and `USING` is what decides which rows an `UPDATE` may target, so
the rows for the business being left are visible only while `app.customer_id` still names it. A
tracked EF update would be flushed by the single `SaveChangesAsync` at the end — after the move —
and match zero rows. One `ExecuteSqlInterpolatedAsync` before `MoveToAsync` executes immediately, in
the request's own transaction (`CustomerSessionMiddleware` opens it at
`CustomerSessionMiddleware.cs:61` and commits at `:123`), under the old scope, through the existing
`UPDATE (revoked_at)` grant.

### D5 — Signatures the contract does not pin, and which plan 1 chooses

Four seams this plan consumes are not in contract §7. The **Prerequisites** section below verifies
each against the real tree before task 1 and tells you to stop if it differs. The values this plan
is written against (⚠ these are shapes plan 1 **owns**; this plan reads them and never redeclares
one — contract §13.2):

| Seam | Assumed shape | Why this shape |
| --- | --- | --- |
| `RefreshToken.Issue` | `Issue(Guid accountId, Guid customerId, string tokenHash, DateTimeOffset issuedAt, DateTimeOffset expiresAt)` | The minimal widening of today's four-argument factory; `customerId` second, matching the `CustomerAccountId, CustomerId` property order the new column implies |
| `RefreshToken.CustomerId` | `public Guid CustomerId { get; private set; }` | Contract §5.2 requires the column; the property name follows it |
| `CustomerAccount.LastActiveBusinessId` | `public Guid? LastActiveBusinessId { get; private set; }` | Contract §3's column name, PascalCased |
| The `CustomerMembership` ↔ `Customer` relationship | declared **once**, with `.HasForeignKey(membership => membership.CustomerId)` | Task 1 adds the inverse navigation to that one declaration; two declarations of the same relationship produce a shadow `customer_id1` column |

⚠ **`CustomerAccount.RecordActiveBusiness(Guid)` is plan 1's, and this plan consumes it** (contract
§13.2). So are `AuthEndpoints.SelectBusinessAsync` and its no-business problem document, and
`MembershipRoleWire` (`Of` + `Parse` + `Values`). An earlier revision of this plan declared the
first two itself; that was `CS0111` and a silent behaviour fork, and it is gone. Task 4 reads plan
1's selection rule and adds only what plan 1 does not do — writing the resolution back, and the
`memberships[]` list on the response.

### D6 — `tradeName` is `string` on the wire and `string?` on the entity

Contract §8 types the field `tradeName: string`. `Customer.TradeName` is `string?`
(`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/Customer.cs:19`)
and `CustomerApiFactory.SeedCustomerWithAccountAsync` seeds it null. A switcher whose entries can be
blank is not a switcher, so task 3 sends `TradeName ?? LegalName` and the DTO property is
non-nullable. Recorded rather than quietly differing: the wire type matches the contract, the value
is not always literally the trade name.

### D7 — Two new problem types on routes that today answer with exactly one

`POST /auth/refresh` deliberately answers *"every refusal … with this one problem document"*, and
`POST /auth/sign-in` answers a wrong password, an unknown username and a deactivated account
byte-identically. This plan adds one distinguishable answer to each:

- `https://peakpower.dev/problems/membership-revoked` on refresh (task 5). Design §5 requires *"a
  **distinct terminal signal** that makes the client sign out rather than retry"*. This one is new.
- `https://peakpower.dev/problems/no-business-access` on sign-in (task 4). Design §5 requires *"a
  named, terminal answer"*. ⚠ The **document is plan 1's** — `AuthEndpoints.NotAMemberOfAnyBusiness()`
  (contract §13.2). Plan 1 ships it as a bare `ProblemDetails` with a title and a detail and **no
  `type`**; task 4 gives that one method the `type` above. It does not add a second refusal helper.

Neither reopens an enumeration oracle: the first is reachable only by presenting an unspent refresh
token that the database says belongs to this account, and the second only after the Argon2id
verification has already succeeded. Both keep the declared status at `401`, so
`CustomerResponseMetadataTests.ExpectedResponseContract` does not move for either route. **403 is
not an option** — `TenancyArchitectureTests.no_type_produces_a_forbidden_response` scans compiled IL
for the Int32 constant `403` however it was spelled.

### Open items this plan records rather than closes

1. **`[OQ-105]`** — the back office has no membership screen. Support cannot answer *"which
   businesses is this person in?"* without SQL. Unchanged by this plan and made slightly worse by
   it, since there are now more memberships to ask about.
2. **A switch signs this login out of the business it left, on every device.** The revocation D3
   requires is by `customer_id`, and the switch cannot tell one device's row from another's — the
   cookie is path-scoped away from this route. Somebody signed into business A on a phone and a
   laptop, who switches the laptop to B, has to sign in again on the phone. A device list, or a
   refresh-token column naming the session rather than only the account and the business, would let
   us do better. Recorded, not designed.
3. **`TenantScopeMiddleware`** (the tenancy probe app's, not production wiring) must perform the
   same step-3 membership proof or the probe covers half the new predicate. Design §4.4 assigns
   that; plan 1 owns the middleware. If it is still unchanged when this plan lands, raise it rather
   than fixing it here.

---

## Domain terms used in this plan

- **Business** — one `customer.customer` row. The user-facing word for what the code calls a
  customer company. The design uses "business" throughout §5 and the wire field is
  `last_active_business_id`, but the table, the column `customer_id` and the claim are all still
  spelled *customer*.
- **Membership** — one `customer.customer_membership` row: this account, in this business, with this
  role, since this moment, until `removed_at`. Active means `removed_at IS NULL`.
- **Active business** — the business named by the `customer_id` claim of the access token the caller
  presented. Exactly one per token. Changing it is what `POST /auth/active-business` does, and it
  changes by re-minting the token, never by a client-side flag.
- **`membershipRole`** — `admin` | `trader` | `viewer`, the caller's role **in the active
  business**. Not in the token (contract §7); read from `ICustomerContext.Role`, which plan 1's
  middleware fills from the database on every request.
- **The owner connection** — the customer host's connection string logs in as the table owner, which
  row-level security never applies to. `CustomerSessionMiddleware` drops an **authenticated** request
  to `app_customer_role`; an anonymous one (sign-in, refresh) keeps the owner role and no
  `app.customer_id`, so every EF global query filter collapses to `true` as well. Both layers are off
  on those two routes, by design and by allow-list.
- **Layer 1 / layer 2** — the EF Core global query filter and the PostgreSQL row-level-security
  policy. Independent, and both must agree.
- **Terminal signal** — an answer whose whole job is to stop the client retrying. A 401 the client
  reads as "refresh and try again" is the opposite; that loop is what design §5 exists to prevent.

---

## File Structure

### `/Users/thinhhuynh/PeakPower/peakpower-platform`

| File | Responsibility |
| --- | --- |
| `src/Core/PeakPower.Domain/Customers/Customer.cs` | Modify: the `Memberships` collection navigation the widened query filter needs |
| `src/Core/PeakPower.Domain/Customers/CustomerAccount.cs` | **Not modified.** `RecordActiveBusiness(Guid)` and `LastActiveBusinessId` are plan 1's (contract §13.2); this plan only calls them |
| `src/Infrastructure/PeakPower.Persistence/Configurations/CustomerMembershipConfiguration.cs` | Modify (plan 1's file): name the inverse navigation on the one existing relationship |
| `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs` | Modify `:165-167`: widen the `Customer` global query filter to the membership arm |
| `src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_WidenCustomerVisibilityToMemberships.cs` | Create: migration 16 — drop and recreate `customer_customer_tenant_isolation` as `FOR SELECT` with the membership arm |
| `src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_WidenCustomerVisibilityToMemberships.Designer.cs` | Create (generated) |
| `src/Infrastructure/PeakPower.Persistence/Migrations/PeakPowerDbContextModelSnapshot.cs` | Modify (regenerated) |
| `tools/verify-migrator.sh` | Modify `:51` (the `case` pattern) and `:52-59` (the failure message it explains) — contract §13.1 |
| `tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs` | Modify `:32` (the method name), `:40` (the count) and after `:54` (the ordered ids) — contract §13.1 |
| `tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs` | Modify `:32` (the applied count) and after `:46` (the applied list) — contract §13.1 |
| `src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/ActiveBusinessScope.cs` | Create: the one statement that moves `app.customer_id` mid-request |
| `src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs` | Modify: `CurrentAccountResponse` loses `IsAdmin` and gains `MembershipRole` + `Memberships`; add `AccountMembershipDto` and `ActiveBusinessRequest` |
| `src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs` | **Not created.** Plan 1's, and in the DOMAIN rather than under this host (contract §13.2.1). This plan is its first wire consumer and pins its spelling against `pg_constraint` |
| `src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs` | Modify: `me`, sign-in, refresh, and the new `active-business` route and handler |
| `src/Hosts/PeakPower.Api.Customer/OpenApi/EnumWireValuesSchemaTransformer.cs` | Modify: publish the three `membershipRole` values on both DTOs |
| `artifacts/openapi/customer.json` | Modify (regenerated at build) |
| `tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs` | Modify `:598-623`: read `with_check` only where the policy has one |
| `tests/PeakPower.Integration.Tests/Tenancy/MembershipVisibilityTests.cs` | Create: layer 2 through `peakpower_app` — the other business is readable and still not writable |
| `tests/PeakPower.Integration.Tests/Tenancy/CustomerMembershipModelTests.cs` | Create: exactly five mapped columns and exactly two foreign keys on `customer_membership` |
| `tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleBodies.cs` | Modify: the own-customer-id placeholder and its renderer |
| `tests/PeakPower.Integration.Tests/Tenancy/CustomerApiRouteTableTests.cs` | Modify `:63-108`, `:306-344`, `:574-590`: the new route, and rendering the placeholder |
| `tests/PeakPower.Integration.Tests/Contract/CustomerResponseMetadataTests.cs` | Modify `:49-168`: the new route's declared responses |
| `tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json` | Modify (re-accepted) |
| `tests/PeakPower.Integration.Tests/Auth/MembershipSeed.cs` | Create: the one place tests write `customer_membership` rows and second businesses |
| `tests/PeakPower.Integration.Tests/Auth/MembershipRoleWireTests.cs` | Create |
| `tests/PeakPower.Integration.Tests/Auth/CurrentAccountMembershipsTests.cs` | Create: `GET /auth/me` |
| `tests/PeakPower.Integration.Tests/Auth/SignInBusinessSelectionTests.cs` | Create: the fallback chain and the **zero-memberships probe** |
| `tests/PeakPower.Integration.Tests/Auth/RefreshMembershipTests.cs` | Create: the **refresh-termination probe** |
| `tests/PeakPower.Integration.Tests/Auth/ActiveBusinessTests.cs` | Create: the switch |
| `tests/PeakPower.Integration.Tests/Auth/MembershipRevocationTests.cs` | Create: the **immediate-revocation probe** |
| `tests/PeakPower.Integration.Tests/Contract/CustomerDocumentHandoffTests.cs` | Create: the published document carries no `isAdmin` and does carry the new route and enum |

### `/Users/thinhhuynh/PeakPower/peakpower-web`

Nothing in this plan. Task 8 states exactly what plan 3 must run and demonstrates the break. ⚠ It
does **not** state how many files move: **plan 3's Task 2 (customer portal) and Task 3 (employee
portal) are the authoritative lists** (contract §13.3). Task 2 is customer-side only — the employee
portal is Task 3's.

---

## Prerequisites — do this before Task 1

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet --version            # must print 10.0.400
docker info > /dev/null     # must exit 0 — the daemon must be running
dotnet tool install -g dotnet-ef --version 10.0.11    # or: dotnet tool update -g dotnet-ef
dotnet build PeakPower.sln --nologo -warnaserror      # must be green before anything below
dotnet test PeakPower.sln --nologo                    # must be green before anything below
```

`dotnet-ef` installs into `~/.dotnet/tools`. If `dotnet ef` is not found afterwards, add that
directory to `PATH`.

**Plan 1 must have landed and be green.** Everything below assumes migration 15 exists, both columns
are dropped, `ICustomerContext.Role` has replaced `IsAdmin`, and
`ITokenIssuer.IssueAccessToken(CustomerAccount, Guid)` takes two arguments.

### Verify the eight seams this plan consumes, and stop if any differs

Redirect each to a file and **read the file** — rtk truncates and sometimes fabricates terminal
output.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform

# 1. Migration 15 exists and 16 is the next number.
ls src/Infrastructure/PeakPower.Persistence/Migrations > /tmp/pp-migrations.txt 2>&1
# Read /tmp/pp-migrations.txt. Expect FIFTEEN *_Name.cs files (the fourteen listed in the shared
# contract plus plan 1's). Plan 2's migration will be the sixteenth.

# 2. RefreshToken's factory and its new column.
cat -n src/Core/PeakPower.Domain/Customers/RefreshToken.cs > /tmp/pp-refreshtoken.txt 2>&1
# Read it. Expect: a `public Guid CustomerId { get; private set; }` property, and
#   public static RefreshToken Issue(
#       Guid accountId, Guid customerId, string tokenHash,
#       DateTimeOffset issuedAt, DateTimeOffset expiresAt)
# If the parameter ORDER or NAMES differ, use plan 1's - every call in tasks 4 and 6 is a
# five-argument call and only the order changes. If `customerId` is ABSENT, plan 1 is not
# complete: STOP.

# 3. The preference column and plan 1's mutator for it. Contract 13.2: plan 1 OWNS
#    CustomerAccount.RecordActiveBusiness(Guid) and this plan only calls it.
cat -n src/Core/PeakPower.Domain/Customers/CustomerAccount.cs > /tmp/pp-account.txt 2>&1
# Read it. Expect `public Guid? LastActiveBusinessId { get; private set; }` AND
#   public void RecordActiveBusiness(Guid customerId)
# If the mutator is ABSENT, plan 1 is not complete: STOP. Do not add it here - a second
# declaration is CS0111. If plan 1 named it something else, use plan 1's name everywhere tasks 4
# and 6 say RecordActiveBusiness.

# 4. The one declaration of the CustomerMembership -> Customer relationship.
grep -rn "CustomerMembership" src/Infrastructure/PeakPower.Persistence/Configurations \
    > /tmp/pp-membership-config.txt 2>&1
cat -n src/Infrastructure/PeakPower.Persistence/Configurations/CustomerMembershipConfiguration.cs \
    >> /tmp/pp-membership-config.txt 2>&1
# Read /tmp/pp-membership-config.txt. Find the SINGLE call chain that relates CustomerMembership to
# Customer - it is the one naming `.HasForeignKey(` with the membership's CustomerId. Task 1 edits
# exactly that chain. If there are TWO such chains already, stop and fix plan 1 first: two
# declarations of one relationship is how a shadow customer_id1 column appears.

# 5. How sign-in currently resolves the business, and how the three CurrentAccountResponse call
#    sites read after plan 1's sweep.
grep -n "CurrentAccountResponse\|IssueAccessToken\|RefreshToken.Issue\|LastActiveBusinessId" \
    src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs > /tmp/pp-authendpoints.txt 2>&1
cat -n src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs >> /tmp/pp-authendpoints.txt 2>&1
# Read it. Note the LINE NUMBERS of: the sign-in handler's CurrentAccountResponse construction,
# SessionFor(...), and the /me handler's construction. This plan quotes the pre-plan-1 text of each
# and anchors every edit on that quoted text rather than on a line number, because plan 1 moved
# them.

# 6. Whether plan 1 already took isAdmin off the wire contract.
cat -n src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs > /tmp/pp-authcontracts.txt 2>&1
# Read it. Before plan 1 this file declares
#   public sealed record CurrentAccountResponse(
#       Guid AccountId, Guid CustomerId, string FirstName,
#       string LastName, string Email, bool IsAdmin);
# Plan 1's is_admin sweep covers "four wire contracts" (shared contract section 10) and
# CustomerAccount.IsAdmin no longer exists, so `bool IsAdmin` is expected to be GONE already and
# this plan's change to the record is then purely additive. Task 3 step 3 gives the record's exact
# target text either way: make the file match it. Note which of the two states you found - it is
# the difference between "not purely additive" (shared contract section 8) describing plans 1+2
# together and describing this plan alone.

# 7. Plan 1's sign-in business selection and its no-business refusal - contract 13.2 gives plan 1
#    BOTH, and task 4 consumes them rather than writing its own.
grep -n "SelectBusinessAsync\|NotAMemberOfAnyBusiness" \
    src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs > /tmp/pp-selectbusiness.txt 2>&1
# Read it. Expect BOTH:
#   private static async Task<CustomerMembership?> SelectBusinessAsync(
#       PeakPowerDbContext db, CustomerAccount account, CancellationToken cancellationToken)
#   private static IResult NotAMemberOfAnyBusiness()
# and a call to each inside the sign-in handler. If either is missing, plan 1 is not complete:
# STOP. Do not write a second selection rule or a second refusal helper here - a fork in "which
# business does a sign-in land in" is the kind of bug that shows up as an audit-trail argument
# months later.

# 8. MembershipRoleWire - contract 13.2.1 pins ONE home and ONE shape, and the home is the
#    DOMAIN, not this host. PeakPower.Persistence's value converter calls it and Persistence may
#    not reference a host, which is the argument that settled it.
cat -n src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs > /tmp/pp-rolewire.txt 2>&1
# Read it. Expect `namespace PeakPower.Domain.Customers;` and a
# `public static class MembershipRoleWire` carrying ALL of:
#   public const string Admin  = "admin";
#   public const string Trader = "trader";
#   public const string Viewer = "viewer";
#   public static IReadOnlyList<string> Values { get; }            // [Admin, Trader, Viewer]
#   public static string Of(MembershipRole role);                  // never throws
#   public static MembershipRole Parse(string value);              // throws on unknown
#   public static bool TryParse(string? value, out MembershipRole role);
# ⚠ `Values` is IReadOnlyList<string>, not string[] - contract 13.2.1 - and TryParse is what
# anything reading untrusted wire input calls. A `Parse(string?) -> MembershipRole?` overload
# beside `Parse(string) -> MembershipRole` is CS0111: reference nullability does not differentiate
# an overload. If you find that pair, plan 1 is wrong and must be fixed before starting.
# ⚠ Every `using` in this plan that reaches MembershipRoleWire is therefore
# `using PeakPower.Domain.Customers;` and NOT `using PeakPower.Api.Customer.Auth;`.
# ⚠ If the FILE does not exist, plan 1 shipped the wire spelling under another name - the likely
# one is CustomerMembershipConfiguration.RoleToDatabase(MembershipRole), which plan 1's own sign-in
# and /me handlers call. In that case STOP and get plan 1 to hoist it into MembershipRoleWire
# before starting: contract 13.2.1 names this type, four call sites in this plan and every one of
# plan 4's read it, and a persistence-configuration class is not where a WIRE spelling belongs.
# Do not create it here - that is the duplicate definition 13.2 exists to prevent.
```

⚠ **Every line number this plan gives for `AuthEndpoints.cs`, `CustomerAccount.cs` and
`PeakPowerDbContext.cs` was verified against platform commit `4dc8298`, which is *before* plan 1.**
Plan 1 edits all three. Anchor each edit on the quoted code, not on the number; the numbers are
there to tell you roughly where to look.

---

### Task 1: Both tenancy layers learn about membership — the widened filter and the widened policy

`memberships[]` carries `tradeName`, which lives on `customer.customer`, which today is invisible to
anyone outside the active business — twice over. Layer 2 is
`customer_customer_tenant_isolation`, created by migration 2's loop
(`src/Infrastructure/PeakPower.Persistence/Migrations/20260827092246_TenancyRowLevelSecurity.cs:170-192`)
as `FOR ALL TO app_customer_role USING (id = app.customer_id) WITH CHECK (id = app.customer_id)`.
Layer 1 is the global query filter at
`src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs:165-167`, reading
`customer.Id == _customerContext.CustomerId`.

Three things about this task are load-bearing:

⚠ **One policy, not two.** Both coverage guards assert **exactly two** policies per tenant table
(`AutomaticPolicyCoverageTests` at `RowLevelSecurityTests.cs:825` and `CatalogPolicyCoverageTests` at
`:1083`), and `TenancyLiteralsTests.each_customer_owned_table_carries_exactly_its_two_literal_policy_names`
pins the two names. Adding a second read policy to `customer.customer` fails all three. This task
**replaces** the one policy under the same name.

⚠ **`DROP POLICY` + `CREATE POLICY`, never `ALTER POLICY`.** PostgreSQL's `ALTER POLICY` can change
`USING`, `WITH CHECK` and the role list, and **cannot change the command** — and this policy changes
from `FOR ALL` to `FOR SELECT`, which is design §5's own requirement. Both statements are inside the
migration's transaction, so there is no window in which the table has no policy.

⚠ **Three literals pin the ordered migration list, and all three move with the migration.**
Contract §13.1: the migration-script test (its method name, the count and the ordered ids), the
migration-behaviour test (the applied count and list) and `tools/verify-migrator.sh`'s `case`
pattern **and its failure message**. Plan 2's migration is number **16**,
`WidenCustomerVisibilityToMemberships`, and it goes after plan 1's `MultiBusinessMembership`. Step 7
does all three; skipping any of them is a red suite, not an oversight to leave for the next person.

⚠ **The model change and the migration must land in the same task.** Adding the `Customer.Memberships`
navigation moves the EF model; `PersistenceServiceCollectionExtensions` no longer suppresses
`RelationalEventId.PendingModelChangesWarning` (proved by
`PendingModelChangesSuppressionTests.The_pending_model_changes_suppression_is_removed_once_migration_3_lands`),
so between the navigation and the migration every `MigrateAsync` in the suite throws. Do steps 3–6
before you run anything.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/Customer.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/CustomerMembershipConfiguration.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs:165-167`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_WidenCustomerVisibilityToMemberships.cs`
- Create (generated): `.../Migrations/<ts>_WidenCustomerVisibilityToMemberships.Designer.cs`
- Modify (regenerated): `.../Migrations/PeakPowerDbContextModelSnapshot.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/CustomerMembershipModelTests.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/MembershipVisibilityTests.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs:598-623`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh:51`, `:52-59`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs:32`, `:40`, `:54`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs:32`, `:46`

**Interfaces:**
- Consumes: `PeakPower.Domain.Customers.CustomerMembership` with `AccountId`, `CustomerId`, `Role`,
  `CreatedAt`, `RemovedAt` (plan 1, shared contract §7); `customer.customer_membership` with columns
  `account_id, customer_id, role, created_at, removed_at` (plan 1, shared contract §4);
  `TenancyFixture.OwnerContext()`, `.OwnerConnectionString`, `.CustomerRoleConnectionString`,
  `.CompanyAId`, `.CompanyBId`, `.CompanyAAccountId`, `.Connect(string)`.
- Produces: `Customer.Memberships` → `IReadOnlyCollection<CustomerMembership>`; the widened
  `Customer` global query filter; migration 16
  `WidenCustomerVisibilityToMemberships`; `customer_customer_tenant_isolation` on
  `customer.customer` as `FOR SELECT TO app_customer_role` with the membership arm.

- [ ] **Step 1: Write the failing tests**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/CustomerMembershipModelTests.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Tenancy;

/// <summary>
/// Model-only facts about <c>customer.customer_membership</c> and the one navigation membership
/// plan 2 adds to <see cref="Customer"/>. Building a model opens no connection, so these need no
/// container.
/// <para>
/// The navigation exists because <c>HasQueryFilter</c> cannot reference <c>Set&lt;T&gt;()</c>: the
/// widened filter on <see cref="Customer"/> has to ask "does this account hold a live membership
/// here", and a collection navigation is the only expression EF Core accepts for that. The risk it
/// introduces is the reason for the other two facts here — a navigation configured as a SECOND
/// relationship rather than as the inverse of the one that already exists gives
/// <c>customer_membership</c> a shadow <c>customer_id1</c> column and a third foreign key, and
/// nothing else in the suite would notice until a migration diff produced a column nobody asked for.
/// </para>
/// </summary>
public sealed class CustomerMembershipModelTests
{
    private static PeakPowerDbContext ModelOnlyContext()
    {
        var options = new DbContextOptionsBuilder<PeakPowerDbContext>()
            .UseNpgsql("Host=localhost;Port=5432;Database=model-only;Username=none;Password=none")
            .UseSnakeCaseNamingConvention()
            .Options;

        return new PeakPowerDbContext(options, new UnscopedCustomerContext());
    }

    [Fact]
    public void The_membership_table_maps_exactly_its_five_columns()
    {
        using var db = ModelOnlyContext();

        var entity = db.Model.FindEntityType(typeof(CustomerMembership));
        entity.ShouldNotBeNull(
            "plan 1 maps CustomerMembership; without it nothing in plan 2 has a membership to read");

        var storeObject = StoreObjectIdentifier.Table("customer_membership", "customer");

        entity!.GetProperties()
            .Select(property => property.GetColumnName(storeObject))
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray()
            .ShouldBe(
                ["account_id", "created_at", "customer_id", "removed_at", "role"],
                "shared contract section 4 gives this table five columns and no more. A sixth is " +
                "almost always a shadow foreign key EF invented because a navigation was " +
                "configured as a second relationship instead of as the inverse of the first.");
    }

    [Fact]
    public void The_membership_table_carries_exactly_two_foreign_keys()
    {
        using var db = ModelOnlyContext();

        var entity = db.Model.FindEntityType(typeof(CustomerMembership))!;

        entity.GetForeignKeys()
            .Select(foreignKey =>
                $"{foreignKey.PrincipalEntityType.ClrType.Name}(" +
                string.Join(",", foreignKey.Properties.Select(property => property.Name)) + ")")
            .OrderBy(description => description, StringComparer.Ordinal)
            .ToArray()
            .ShouldBe(
                ["Customer(CustomerId)", "CustomerAccount(AccountId)"],
                "one relationship to each principal, each keyed on the property shared contract " +
                "section 4 names. A third entry means Customer.Memberships was declared as its own " +
                "relationship rather than as the inverse of the existing one.");
    }

    [Fact]
    public void The_customer_aggregate_reaches_its_memberships_through_one_navigation()
    {
        using var db = ModelOnlyContext();

        var customer = db.Model.FindEntityType(typeof(Customer))!;

        customer.GetNavigations()
            .Select(navigation => navigation.Name)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray()
            .ShouldBe(
                ["Memberships"],
                "Customer has exactly one navigation and it exists for the global query filter. " +
                "If this list is empty the filter cannot be widened at all; if it has grown, " +
                "somebody hung another aggregate off the customer root.");

        customer.FindNavigation("Memberships")!.TargetEntityType.ClrType
            .ShouldBe(typeof(CustomerMembership));
    }

    [Fact]
    public void The_customer_query_filter_reads_both_the_active_business_and_the_membership()
    {
        using var db = ModelOnlyContext();

        var filters = db.Model.FindEntityType(typeof(Customer))!.GetDeclaredQueryFilters();
        filters.Count.ShouldBe(1, "Customer carries exactly one global query filter");

        var expression = filters.Single().Expression.ToString();

        // Both arms, by name. A filter that kept only the first arm is the pre-plan-2 filter and
        // resolves memberships[].tradeName to the active business alone however permissive the
        // database policy is; a filter that kept only the second would stop a back-office or
        // anonymous read dead. The string comparison is Ordinal because Shouldly's ShouldContain
        // is case-insensitive by default and has silently broken three tests in this repository.
        expression.Contains("CustomerId", StringComparison.Ordinal).ShouldBeTrue(
            $"the active-business arm has gone: {expression}");
        expression.Contains("Memberships", StringComparison.Ordinal).ShouldBeTrue(
            $"the membership arm has gone: {expression}");
        expression.Contains("IsAuthenticated", StringComparison.Ordinal).ShouldBeTrue(
            $"the !IsAuthenticated prefix has gone, which collapses the back office, the Worker " +
            $"and anonymous onboarding to zero rows: {expression}");
    }
}
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/MembershipVisibilityTests.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Tenancy;

/// <summary>
/// Layer 2 of the widening, proved through <c>peakpower_app</c> — never through the owner
/// connection, which row-level security does not apply to and against which every assertion here
/// would pass whether or not a policy exists.
/// <para>
/// Both halves matter and the second is the one a "simplification" breaks. Widening the
/// <c>USING</c> arm of a <c>FOR ALL</c> policy would make the other business readable AND writable
/// — an admin of B could rename A — which is why design section 5 requires
/// <c>FOR SELECT TO app_customer_role</c> and why this class asserts a zero-row UPDATE next to the
/// two-row SELECT.
/// </para>
/// </summary>
[Collection(nameof(TenancyCollection))]
public sealed class MembershipVisibilityTests
{
    private readonly TenancyFixture _fixture;

    public MembershipVisibilityTests(TenancyFixture fixture) => _fixture = fixture;

    /// <summary>
    /// The negative half, and it runs first in the file for a reason: it is what makes the positive
    /// half below evidence rather than a coincidence. Company A's account holds no membership in
    /// company B, so B's row is invisible even though the policy now has an arm that could reveal
    /// it.
    /// </summary>
    [Fact]
    public async Task Without_a_membership_the_other_business_stays_invisible()
    {
        var ct = TestContext.Current.CancellationToken;

        await using var connection = TenancyFixture.Connect(_fixture.CustomerRoleConnectionString);
        await connection.OpenAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        await ScopeAsync(connection, transaction, _fixture.CompanyAId, _fixture.CompanyAAccountId, ct);

        (await ReadCustomerIdsAsync(connection, transaction, ct)).ShouldBe(
            Sorted(_fixture.CompanyAId),
            "the membership arm keys on app.account_id, and company A's account is a member of " +
            "company A only. If company B appears here the arm is not filtering on the account at " +
            "all and every signed-in customer can read every company's trade name.");
    }

    [Fact]
    public async Task A_membership_makes_the_other_business_readable_and_leaves_it_unwritable()
    {
        var ct = TestContext.Current.CancellationToken;

        // Written on the OWNER connection, which no policy applies to: arranging through the app
        // role would be arranging through the thing under test. Raw SQL rather than the DbSet
        // because shared contract section 4 makes the table and its five columns normative while
        // nothing pins plan 1's DbSet name.
        await using (var seed = _fixture.OwnerContext())
        {
            await seed.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 INSERT INTO customer.customer_membership (account_id, customer_id, role, created_at)
                 VALUES ({_fixture.CompanyAAccountId}, {_fixture.CompanyBId}, 'trader', now())
                 """,
                ct);
        }

        try
        {
            await using var connection = TenancyFixture.Connect(_fixture.CustomerRoleConnectionString);
            await connection.OpenAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);

            await ScopeAsync(connection, transaction, _fixture.CompanyAId, _fixture.CompanyAAccountId, ct);

            (await ReadCustomerIdsAsync(connection, transaction, ct)).ShouldBe(
                Sorted(_fixture.CompanyAId, _fixture.CompanyBId),
                "acting for company A, an account with a live membership in company B must be " +
                "able to read B's row - that row is where tradeName lives, and GET /auth/me's " +
                "memberships[] cannot name a business it cannot read");

            // The half that stops the widening becoming a write hole. FOR SELECT means
            // app_customer_role has NO policy for UPDATE on this table, so the row is invisible to
            // an UPDATE and zero rows are affected - even though migration 2's bulk GRANT still
            // holds the UPDATE privilege. A FOR ALL policy carrying the same widened USING would
            // report 1 here, which is an admin of B renaming A.
            (await UpdateLegalNameAsync(connection, transaction, _fixture.CompanyBId, ct)).ShouldBe(
                0,
                "the widened USING arm authorises reads and nothing else; a FOR ALL policy would " +
                "have let this rename another business");

            // And its OWN row, which is the assertion that proves the line above is about FOR
            // SELECT rather than about the row being foreign.
            (await UpdateLegalNameAsync(connection, transaction, _fixture.CompanyAId, ct)).ShouldBe(
                0,
                "customer.customer is read-only to app_customer_role after migration 16. Every " +
                "write to it is either the anonymous onboarding wizard on the owner connection or " +
                "the employee host under customer_customer_back_office.");
        }
        finally
        {
            // TenancyCollection shares one container and one seeded pair of companies, and several
            // classes in it assert exact row counts over customer.customer. Leaving this membership
            // behind would make company B readable to company A for the rest of the run.
            await using var cleanup = _fixture.OwnerContext();
            await cleanup.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 DELETE FROM customer.customer_membership
                 WHERE account_id = {_fixture.CompanyAAccountId}
                   AND customer_id = {_fixture.CompanyBId}
                 """,
                ct);
        }
    }

    /// <summary>
    /// Both settings, because the widened predicate reads both. <c>set_config</c> and never
    /// <c>SET LOCAL &lt;name&gt; = &lt;value&gt;</c>: <c>SET</c> takes no parameter, and
    /// concatenating a value into a tenancy control is how injection gets in.
    /// </summary>
    private static async Task ScopeAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid customerId,
        Guid accountId,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            "SELECT set_config('app.customer_id', @customer, true), " +
            "       set_config('app.account_id',  @account,  true)",
            connection,
            transaction);
        command.Parameters.AddWithValue("customer", customerId.ToString());
        command.Parameters.AddWithValue("account", accountId.ToString());
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<string[]> ReadCustomerIdsAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            "SELECT id FROM customer.customer", connection, transaction);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var ids = new List<string>();
        while (await reader.ReadAsync(cancellationToken))
        {
            ids.Add(reader.GetGuid(0).ToString());
        }

        // Sorted as STRINGS on both sides. Guid.CompareTo and PostgreSQL's uuid ordering disagree
        // on byte order, so "ORDER BY id" here and OrderBy(g => g) there would produce two
        // different sequences for the same set and this comparison would flap.
        ids.Sort(StringComparer.Ordinal);
        return [.. ids];
    }

    private static async Task<int> UpdateLegalNameAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid customerId,
        CancellationToken cancellationToken)
    {
        // SET legal_name = legal_name is a deliberate no-op: this measures row VISIBILITY to an
        // UPDATE, not any particular business mutation, and self-assignment is valid whatever the
        // column holds.
        await using var command = new NpgsqlCommand(
            "UPDATE customer.customer SET legal_name = legal_name WHERE id = @id",
            connection,
            transaction);
        command.Parameters.AddWithValue("id", customerId);
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string[] Sorted(params Guid[] ids)
    {
        var text = ids.Select(id => id.ToString()).ToList();
        text.Sort(StringComparer.Ordinal);
        return [.. text];
    }
}
```

- [ ] **Step 2: Run the new tests and watch them fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~CustomerMembershipModelTests" > /tmp/pp-t1-model.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~MembershipVisibilityTests" > /tmp/pp-t1-rls.txt 2>&1
```

Read both files. Expected:

- `The_customer_aggregate_reaches_its_memberships_through_one_navigation` FAILS —
  `should be ["Memberships"] but was []` (`Customer` has no navigation at all today).
- `The_customer_query_filter_reads_both_the_active_business_and_the_membership` FAILS — *"the
  membership arm has gone"*, printing the current expression, which contains `CustomerId` and
  `IsAuthenticated` but no `Memberships`.
- `The_membership_table_maps_exactly_its_five_columns` and
  `The_membership_table_carries_exactly_two_foreign_keys` PASS already — they describe plan 1's
  model and are here as the guard against what step 4 could break.
- `Without_a_membership_the_other_business_stays_invisible` PASSES already.
- `A_membership_makes_the_other_business_readable_and_leaves_it_unwritable` FAILS on the first
  assertion — *"should be ["…a…", "…b…"] but was ["…a…"]"* — because the un-widened policy hides B.
  It does **not** reach the UPDATE assertions.

- [ ] **Step 3: Give `Customer` the one navigation the filter needs**

In `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/Customer.cs`,
insert immediately after the `private Customer() { }` constructor (today at `:11-13`) and before
`public Guid Id { get; private set; }`:

```csharp
    /// <summary>
    /// EF Core populates this through the field, by its own backing-field convention
    /// (<c>_memberships</c> for <c>Memberships</c>). Application code never touches it.
    /// </summary>
    private readonly List<CustomerMembership> _memberships = [];

    /// <summary>
    /// The memberships that name this business. Read-only, and it exists for exactly one reason:
    /// <c>PeakPowerDbContext</c>'s global query filter on <see cref="Customer"/> has to ask "does
    /// this account hold a live membership here", and <c>HasQueryFilter</c> cannot reference
    /// <c>Set&lt;T&gt;()</c> — a collection navigation is the only expression EF Core accepts for
    /// that question.
    /// </summary>
    /// <remarks>
    /// <b>This is not an aggregate boundary.</b> A membership is its own relationship (shared
    /// contract §7): it is created, re-roled and removed through <see cref="CustomerMembership"/>'s
    /// own methods, and there is deliberately no <c>Add</c> or <c>Remove</c> here for a caller to
    /// reach for. <see cref="IReadOnlyCollection{T}"/> rather than <see cref="List{T}"/> is what
    /// keeps that true rather than merely stated.
    /// </remarks>
    public IReadOnlyCollection<CustomerMembership> Memberships => _memberships;

```

- [ ] **Step 4: Name the inverse navigation on the ONE existing relationship**

Open
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/CustomerMembershipConfiguration.cs`
(Prerequisites step 4 already dumped it to `/tmp/pp-membership-config.txt`). Find the single call
chain that relates `CustomerMembership` to `Customer` — it is the one whose `HasForeignKey` names
the membership's `CustomerId` — and make it read **exactly**:

```csharp
        // .WithMany(company => company.Memberships), not a bare .WithMany(): the inverse
        // navigation belongs to THIS relationship. Declaring Customer.Memberships as a second
        // relationship (a .HasMany in CustomerConfiguration, or a second .HasOne here) makes EF
        // invent a shadow foreign key and a customer_id1 column, which CustomerMembershipModelTests
        // fails on by name.
        builder.HasOne<Customer>()
            .WithMany(company => company.Memberships)
            .HasForeignKey(membership => membership.CustomerId)
            .OnDelete(DeleteBehavior.Restrict);
```

⚠ Keep whatever `OnDelete` plan 1 chose — shared contract §4 says
`REFERENCES customer.customer(id) ON DELETE RESTRICT`, so `DeleteBehavior.Restrict` is the expected
value, but if plan 1 wrote something else that is plan 1's call and this task must not silently
change it. **Change only the `.WithMany(...)` argument.** Do **not** add a `HasMany` in
`CustomerConfiguration.cs`.

- [ ] **Step 5: Widen the global query filter (layer 1)**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs`,
replace the `Customer` filter — today at `:165-167`, immediately after the block comment beginning
*"Tenancy, layer 1 of 2"* — which reads:

```csharp
        modelBuilder.Entity<Customer>()
            .HasQueryFilter(customer =>
                !_customerContext.IsAuthenticated || customer.Id == _customerContext.CustomerId);
```

with:

```csharp
        // Membership plan 2 widened this ONE predicate and nothing else in this method.
        //
        // The second arm is what lets GET /api/v1/auth/me's memberships[] NAME the other
        // businesses this account belongs to: tradeName lives on customer.customer, and without
        // the arm the projection resolves to the active business alone however permissive the
        // database policy is. Migration 16 widens customer_customer_tenant_isolation to exactly
        // this shape - the two layers are independent and both have to move, which is the whole
        // reason they are two.
        //
        // The wrong tool here is IgnoreQueryFilters(): it drops layer 1 for the WHOLE query rather
        // than widening it by one arm, and TenancyArchitectureTests.no_type_calls_ignore_query_filters
        // scans compiled IL for it.
        //
        // Expressed as a collection navigation because HasQueryFilter cannot reference Set<T>().
        // Customer.Memberships exists for this expression and for nothing else - see its own
        // remarks.
        //
        // RemovedAt == null and not IsActive: IsActive is a computed CLR property with no column
        // behind it, so EF cannot translate it into SQL and the filter would throw at model build.
        modelBuilder.Entity<Customer>()
            .HasQueryFilter(customer =>
                !_customerContext.IsAuthenticated
                || customer.Id == _customerContext.CustomerId
                || customer.Memberships.Any(membership =>
                       membership.AccountId == _customerContext.AccountId
                       && membership.RemovedAt == null));
```

- [ ] **Step 6: Scaffold migration 16 and give it the widened policy**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet ef migrations add WidenCustomerVisibilityToMemberships \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator \
  --output-dir Migrations --context PeakPowerDbContext > /tmp/pp-t1-scaffold.txt 2>&1
ls src/Infrastructure/PeakPower.Persistence/Migrations > /tmp/pp-t1-migrations.txt 2>&1
```

Read `/tmp/pp-t1-migrations.txt`: a new `<ts>_WidenCustomerVisibilityToMemberships.cs` and its
`.Designer.cs`. The navigation adds no column and no constraint, so the scaffolded `Up`/`Down` are
empty — that is expected, and the point of running the command is the regenerated
`PeakPowerDbContextModelSnapshot.cs`, which is what stops every `MigrateAsync` in the suite throwing
`PendingModelChangesWarning`.

Replace the whole body of `<ts>_WidenCustomerVisibilityToMemberships.cs` (keep the file name, the
namespace and the class name exactly as scaffolded) with:

```csharp
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PeakPower.Persistence.Migrations
{
    /// <summary>
    /// One login, several businesses: <c>customer.customer</c> becomes readable to any account
    /// holding a live membership in it, and stops being writable by <c>app_customer_role</c>
    /// altogether.
    /// <para>
    /// <b>The existing policy is replaced, not joined.</b> Both coverage guards assert exactly two
    /// policies per tenant table and <c>TenancyLiteralsTests</c> pins their two names, so a second
    /// read policy on this table fails three tests at once. <c>DROP</c> plus <c>CREATE</c> rather
    /// than <c>ALTER POLICY</c> because <c>ALTER POLICY</c> can change the predicate and the roles
    /// and <b>cannot change the command</b>, and this policy changes from <c>FOR ALL</c> to
    /// <c>FOR SELECT</c>. Both statements run inside the migration's transaction, so there is no
    /// instant in which the table carries no policy.
    /// </para>
    /// <para>
    /// <b>Why <c>FOR SELECT</c>.</b> Under membership the reachable sets of two tenants OVERLAP —
    /// a shared member reaches both businesses' rows — where the old partition-shaped policy kept
    /// them disjoint. Widening the <c>USING</c> arm of a <c>FOR ALL</c> policy would therefore hand
    /// an admin of B the ability to rewrite A's legal name, because <c>USING</c> is what authorises
    /// an <c>UPDATE</c>'s target row. Narrowing the command to <c>SELECT</c> leaves
    /// <c>app_customer_role</c> with no policy for <c>INSERT</c>, <c>UPDATE</c> or <c>DELETE</c> on
    /// this table, which PostgreSQL reads as "no rows", and costs nothing: every write to
    /// <c>customer.customer</c> is either the anonymous onboarding wizard on the owner connection
    /// or the employee host under <c>customer_customer_back_office</c>.
    /// </para>
    /// <para>
    /// <b><c>removed_at IS NULL</c> is not optional.</b> Design §5's abbreviated snippet omits it;
    /// design §3.1 says every membership predicate carries it. Without the term a removed member
    /// keeps reading the trade name of the business that removed them.
    /// </para>
    /// <para>
    /// <b>The subquery is safe from recursion.</b> This policy is on <c>customer.customer</c> and
    /// reads <c>customer.customer_membership</c>, a different table — unlike the membership table's
    /// own policy, which needs <c>customer.is_admin_of</c>'s <c>SECURITY DEFINER</c> to avoid
    /// "infinite recursion detected in policy". Row-level security on the membership table still
    /// applies inside this expression, and the <c>account_id</c> arm of
    /// <c>customer_customer_membership_tenant_isolation</c> is exactly what makes these rows
    /// visible to the account they belong to.
    /// </para>
    /// </summary>
    /// <inheritdoc />
    public partial class WidenCustomerVisibilityToMemberships : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder) =>
            migrationBuilder.Sql("""
                DROP POLICY IF EXISTS customer_customer_tenant_isolation ON customer.customer;

                CREATE POLICY customer_customer_tenant_isolation ON customer.customer
                    FOR SELECT TO app_customer_role
                    USING (
                        id = NULLIF(current_setting('app.customer_id', true), '')::uuid
                        OR id IN (
                            SELECT m.customer_id
                            FROM customer.customer_membership m
                            WHERE m.account_id = NULLIF(current_setting('app.account_id', true), '')::uuid
                              AND m.removed_at IS NULL));
                """);

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder) =>
            migrationBuilder.Sql("""
                DROP POLICY IF EXISTS customer_customer_tenant_isolation ON customer.customer;

                CREATE POLICY customer_customer_tenant_isolation ON customer.customer
                    FOR ALL TO app_customer_role
                    USING      (id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
                    WITH CHECK (id = NULLIF(current_setting('app.customer_id', true), '')::uuid);
                """);
    }
}
```

⚠ `NULLIF(…, '')` is not decoration: `''::uuid` raises `22P02`, whereas `NULL` matches nothing,
which is the fail-closed behaviour. When `app.account_id` was never set at all,
`current_setting('app.account_id', true)` already returns `NULL` on its own — `NULLIF` only has to
handle the empty string.

- [ ] **Step 7: Grow all three ordered-migration-list literals**

Contract §13.1. Run them first and watch them go red — the migration file now exists, so all three
are already wrong:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~MigrationScriptTests" > /tmp/pp-t1-miglist-red.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~MigrationBehaviourTests" > /tmp/pp-t1-migbehav-red.txt 2>&1
```

Read both. Expected: `The_migrations_are_…_in_that_order` fails with *"should be 16 but was 15"* on
the `Length` assertion (`migrationIds.Length.ShouldBe(15)` after plan 1), and
`MigrationBehaviourTests` fails the same way on `applied.Length`.

**7a — the migration-script test.** In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs`,
rename the method at `:32` — after plan 1 it ends `…_then_MultiBusinessMembership_in_that_order()`;
append one more segment:

```csharp
    public void The_migrations_are_InitialSchema_then_TenancyRowLevelSecurity_then_AuthAndOnboarding_then_AccountTokenForeignKeys_then_EanPool_then_OnboardingTradeName_then_EmployeeIdentity_then_EmployeeSessions_then_IngestionAndIntervalData_then_EmployeePasswordReset_then_CustomerEntitlements_then_DayAheadPrices_then_EanPoolReleaseGrant_then_DayAheadPriceSource_then_MultiBusinessMembership_then_WidenCustomerVisibilityToMemberships_in_that_order()
```

then, inside it, replace `:40` — before (plan 1 left it at 15):

```csharp
        migrationIds.Length.ShouldBe(15);
```

after:

```csharp
        migrationIds.Length.ShouldBe(16);
```

and append one line after the last `ShouldEndWith` (plan 1's `migrationIds[14]`) — before:

```csharp
        migrationIds[14].ShouldEndWith("_MultiBusinessMembership");
    }
```

after:

```csharp
        migrationIds[14].ShouldEndWith("_MultiBusinessMembership");
        migrationIds[15].ShouldEndWith("_WidenCustomerVisibilityToMemberships");
    }
```

**7b — the migration-behaviour test.** In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs`,
replace `:32` — before:

```csharp
        applied.Length.ShouldBe(15);
```

after:

```csharp
        applied.Length.ShouldBe(16);
```

and append one line after plan 1's `applied[14]` — before:

```csharp
        applied[14].ShouldEndWith("_MultiBusinessMembership");
    }
```

after:

```csharp
        applied[14].ShouldEndWith("_MultiBusinessMembership");
        applied[15].ShouldEndWith("_WidenCustomerVisibilityToMemberships");
    }
```

**7c — the migrator script.** In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh`, replace lines `51-60` —
before (plan 1's state):

```bash
  *_InitialSchema\|*_TenancyRowLevelSecurity\|*_AuthAndOnboarding\|*_AccountTokenForeignKeys\|*_EanPool\|*_OnboardingTradeName\|*_EmployeeIdentity\|*_EmployeeSessions\|*_IngestionAndIntervalData\|*_EmployeePasswordReset\|*_CustomerEntitlements\|*_DayAheadPrices\|*_EanPoolReleaseGrant\|*_DayAheadPriceSource\|*_MultiBusinessMembership\|) ;;
  *) fail "expected __EFMigrationsHistory to contain, in order, a migration ending _InitialSchema " \
       "then one ending _TenancyRowLevelSecurity then one ending _AuthAndOnboarding then one " \
       "ending _AccountTokenForeignKeys then one ending _EanPool then one ending " \
       "_OnboardingTradeName then one ending _EmployeeIdentity then one ending _EmployeeSessions " \
       "then one ending _IngestionAndIntervalData then one ending _EmployeePasswordReset then " \
       "one ending _CustomerEntitlements then one ending _DayAheadPrices then one ending " \
       "_EanPoolReleaseGrant then one ending _DayAheadPriceSource then one ending " \
       "_MultiBusinessMembership - found: " \
       "$history_ids" ;;
esac
```

after:

```bash
  *_InitialSchema\|*_TenancyRowLevelSecurity\|*_AuthAndOnboarding\|*_AccountTokenForeignKeys\|*_EanPool\|*_OnboardingTradeName\|*_EmployeeIdentity\|*_EmployeeSessions\|*_IngestionAndIntervalData\|*_EmployeePasswordReset\|*_CustomerEntitlements\|*_DayAheadPrices\|*_EanPoolReleaseGrant\|*_DayAheadPriceSource\|*_MultiBusinessMembership\|*_WidenCustomerVisibilityToMemberships\|) ;;
  *) fail "expected __EFMigrationsHistory to contain, in order, a migration ending _InitialSchema " \
       "then one ending _TenancyRowLevelSecurity then one ending _AuthAndOnboarding then one " \
       "ending _AccountTokenForeignKeys then one ending _EanPool then one ending " \
       "_OnboardingTradeName then one ending _EmployeeIdentity then one ending _EmployeeSessions " \
       "then one ending _IngestionAndIntervalData then one ending _EmployeePasswordReset then " \
       "one ending _CustomerEntitlements then one ending _DayAheadPrices then one ending " \
       "_EanPoolReleaseGrant then one ending _DayAheadPriceSource then one ending " \
       "_MultiBusinessMembership then one ending _WidenCustomerVisibilityToMemberships - found: " \
       "$history_ids" ;;
esac
```

⚠ **Grow the failure message and not only the pattern.** They drifted apart once already — before
plan 1 the message stopped at `_EanPoolReleaseGrant` while the pattern already listed
`_DayAheadPriceSource` — and the message is the only thing an operator staring at a failed migrator
run gets to read. ⚠ The trailing `\|` inside the pattern is a literal escaped `|`, matching the
`tr '\n' '|'` on `:49`; every entry including the last one carries it.

⚠ If plan 1's migration is not named `MultiBusinessMembership`, use whatever it is actually called —
`ls src/Infrastructure/PeakPower.Persistence/Migrations` from the Prerequisites already told you.
The only thing this step adds is one more entry, at the end, in three places.

Re-run the two tests and confirm green; the script itself is exercised at the end of step 9:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~Migration" > /tmp/pp-t1-miglist-green.txt 2>&1
```

- [ ] **Step 8: Let the pinned policy-predicate test read a policy that has no `WITH CHECK`**

`pg_policies.with_check` is **NULL** for a `FOR SELECT` policy, and
`RowLevelSecurityTests.the_tenant_isolation_policy_predicate_reads_the_literal_app_customer_id_setting`
reads it with `reader.GetString(1)`, which throws `InvalidCastException` on NULL rather than failing
an assertion. In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`,
replace lines `605-622` — before:

```csharp
        await using var command = new NpgsqlCommand(
            "SELECT qual, with_check FROM pg_policies " +
            "WHERE schemaname = @schema AND tablename = @table AND policyname = @policy",
            connection);
        command.Parameters.AddWithValue("schema", schema);
        command.Parameters.AddWithValue("table", table);
        command.Parameters.AddWithValue("policy", tenantIsolationPolicy);
        await using var reader = await command.ExecuteReaderAsync(ct);
        (await reader.ReadAsync(ct)).ShouldBeTrue($"{schema}.{table} should carry {tenantIsolationPolicy}");

        var usingClause = reader.GetString(0);
        var withCheckClause = reader.GetString(1);

        // Task 5 issues set_config('app.customer_id', ..., true) under this exact literal.
        // A spelling drift here means every scoped query silently returns zero rows in
        // production rather than raising an error - see TenancyFixture's remarks.
        usingClause.ShouldContain("app.customer_id");
        withCheckClause.ShouldContain("app.customer_id");
```

after:

```csharp
        await using var command = new NpgsqlCommand(
            "SELECT qual, with_check, cmd FROM pg_policies " +
            "WHERE schemaname = @schema AND tablename = @table AND policyname = @policy",
            connection);
        command.Parameters.AddWithValue("schema", schema);
        command.Parameters.AddWithValue("table", table);
        command.Parameters.AddWithValue("policy", tenantIsolationPolicy);
        await using var reader = await command.ExecuteReaderAsync(ct);
        (await reader.ReadAsync(ct)).ShouldBeTrue($"{schema}.{table} should carry {tenantIsolationPolicy}");

        var usingClause = reader.GetString(0);
        var withCheckClause = reader.IsDBNull(1) ? null : reader.GetString(1);
        var policyCommand = reader.GetString(2);

        // Task 5 issues set_config('app.customer_id', ..., true) under this exact literal.
        // A spelling drift here means every scoped query silently returns zero rows in
        // production rather than raising an error - see TenancyFixture's remarks.
        usingClause.ShouldContain("app.customer_id");

        // pg_policies.with_check is NULL for a FOR SELECT policy: PostgreSQL evaluates WITH CHECK
        // for an INSERT and for an UPDATE's new row and for nothing else, so a read-only policy has
        // no such arm to record. customer.customer became FOR SELECT in migration 16, because under
        // membership two tenants' reachable row sets OVERLAP and a widened USING on a FOR ALL
        // policy would authorise an admin of one business to rewrite another's. Reading the column
        // unconditionally threw InvalidCastException there rather than failing an assertion.
        //
        // The cmd is asserted rather than merely branched on, in both directions: a table that
        // quietly became FOR SELECT loses its write guard, and one that quietly went back to
        // FOR ALL gets the overlap hole back.
        if (string.Equals(policyCommand, "SELECT", StringComparison.Ordinal))
        {
            withCheckClause.ShouldBeNull(
                $"{schema}.{table}'s {tenantIsolationPolicy} is FOR SELECT, which cannot carry a " +
                "WITH CHECK arm at all - a value here means pg_policies is reporting something " +
                "this test does not understand");
            return;
        }

        withCheckClause.ShouldNotBeNull(
            $"{schema}.{table}'s {tenantIsolationPolicy} is FOR {policyCommand}, so it must carry " +
            "a WITH CHECK arm; without one the USING expression authorises writes");
        withCheckClause.ShouldContain("app.customer_id");
```

- [ ] **Step 9: Build, and run the whole tenancy surface**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror > /tmp/pp-t1-build.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~Tenancy" > /tmp/pp-t1-tenancy.txt 2>&1
dotnet test tests/PeakPower.Architecture.Tests --nologo > /tmp/pp-t1-arch.txt 2>&1
dotnet test PeakPower.sln --nologo > /tmp/pp-t1-all.txt 2>&1
tools/verify-migrator.sh > /tmp/pp-t1-migrator.txt 2>&1
```

Read all five. Expected: build clean; every test PASSES, including
`RowLevelSecurityTests`, `TenancyLiteralsTests`, `AutomaticPolicyCoverageTests`,
`CatalogPolicyCoverageTests`, `QueryFilterModelTests`, `QueryFilterEnforcementTests`,
`MigrationScriptTests`, `MigrationBehaviourTests` and `PendingModelChangesSuppressionTests`.
`/tmp/pp-t1-migrator.txt` must contain no `FAIL:` line — that is the third pin from step 7, and it
is the only one no `dotnet test` run will catch for you.

⚠ `QueryFilterEnforcementTests.A_customer_scoped_context_sees_only_its_own_customer_row` is the one
to look for by name. It builds a `ScopedCustomerContext(customerId)` whose `AccountId` is
`Guid.Empty` (`QueryFilterModelTests.cs:595`), so the new arm asks for a membership held by the
empty account and finds none — the test still sees exactly one customer. If it went red, the arm is
matching on something other than the account.

- [ ] **Step 10: Mutate layer 1 — prove the filter is what widens the read**

In `PeakPowerDbContext.cs`, delete the third arm, leaving:

```csharp
        modelBuilder.Entity<Customer>()
            .HasQueryFilter(customer =>
                !_customerContext.IsAuthenticated
                || customer.Id == _customerContext.CustomerId);
```

Predicted failure: `CustomerMembershipModelTests.The_customer_query_filter_reads_both_the_active_business_and_the_membership`
fails with *"the membership arm has gone: customer => Not(value(...).IsAuthenticated)
OrElse (customer.Id == value(...).CustomerId)"*. `MembershipVisibilityTests` still passes — it is a
layer-2 test and reads through raw SQL, which is exactly why layer 1 needs its own assertion.

⚠ This mutation makes the model disagree with the snapshot only if you also touch a mapped
structure; it does not, so `MigrateAsync` keeps working and the failure is the assertion, not a
crash.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~CustomerMembershipModelTests" > /tmp/pp-t1-mut1.txt 2>&1
```

Read `/tmp/pp-t1-mut1.txt` and confirm the predicted failure. Restore the third arm, then prove the
restore:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git diff --stat src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs > /tmp/pp-t1-restored.txt 2>&1
```

Read it: the only change against `HEAD` must be the one step 5 made.

- [ ] **Step 11: Mutate layer 2 — prove `FOR SELECT` is what keeps the read from becoming a write**

In `<ts>_WidenCustomerVisibilityToMemberships.cs`, change `FOR SELECT TO app_customer_role` to
`FOR ALL TO app_customer_role` in `Up` **and** add `WITH CHECK (false)` after the `USING (...)`
block, so the migration is still valid SQL:

```sql
                CREATE POLICY customer_customer_tenant_isolation ON customer.customer
                    FOR ALL TO app_customer_role
                    USING (
                        id = NULLIF(current_setting('app.customer_id', true), '')::uuid
                        OR id IN (
                            SELECT m.customer_id
                            FROM customer.customer_membership m
                            WHERE m.account_id = NULLIF(current_setting('app.account_id', true), '')::uuid
                              AND m.removed_at IS NULL))
                    WITH CHECK (false);
```

Predicted failure:
`MembershipVisibilityTests.A_membership_makes_the_other_business_readable_and_leaves_it_unwritable`
fails on the **first UPDATE** assertion — *"should be 0 but was 1"* — with the message *"the widened
USING arm authorises reads and nothing else; a FOR ALL policy would have let this rename another
business"*. `USING` is what decides which rows an `UPDATE` may target, so company A's connection
renames company B. The SELECT assertion above it still passes, which is the point: the read half is
green in both worlds and only the write half tells them apart.

⚠ **A migration whose `Up()` already ran is never re-run.** `TenancyFixture` and
`CustomerApiFactory` each build a **fresh** container per run and call `MigrateAsync` on it, so
editing the migration file and re-running the test is enough — no local database has to be dropped.
Confirm from the run log that the container was created; if you ever point these at a persistent
database, drop it first.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~MembershipVisibilityTests" > /tmp/pp-t1-mut2.txt 2>&1
```

Read `/tmp/pp-t1-mut2.txt` and confirm the predicted failure. Restore `FOR SELECT` and delete the
`WITH CHECK (false)` line, then re-run and confirm green:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~MembershipVisibilityTests" > /tmp/pp-t1-mut2-restored.txt 2>&1
grep -c "FOR SELECT TO app_customer_role" \
    src/Infrastructure/PeakPower.Persistence/Migrations/*_WidenCustomerVisibilityToMemberships.cs \
    > /tmp/pp-t1-forselect.txt 2>&1
```

Read both. `/tmp/pp-t1-forselect.txt` must print `1`.

- [ ] **Step 12: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Domain/Customers/Customer.cs \
        src/Infrastructure/PeakPower.Persistence/Configurations/CustomerMembershipConfiguration.cs \
        src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs \
        src/Infrastructure/PeakPower.Persistence/Migrations \
        tools/verify-migrator.sh \
        tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs \
        tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs \
        tests/PeakPower.Integration.Tests/Tenancy/CustomerMembershipModelTests.cs \
        tests/PeakPower.Integration.Tests/Tenancy/MembershipVisibilityTests.cs \
        tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs
git commit -m "Let a member name the other businesses they belong to

memberships[] carries tradeName, which lives on customer.customer, which was
invisible outside the active business twice over. Migration 16 replaces
customer_customer_tenant_isolation - one policy, still two on the table, because
three guards assert exactly two - with a FOR SELECT policy carrying a second arm
for any live membership this account holds. The EF global query filter gains the
same arm through a new Customer.Memberships navigation, because HasQueryFilter
cannot reference Set<T>() and IgnoreQueryFilters() drops layer 1 for the whole
query.

FOR SELECT, not FOR ALL: under membership two tenants' reachable rows overlap, so
a widened USING on a FOR ALL policy would let an admin of one business rename
another. That is asserted next to the read, because the read half is green either
way. removed_at IS NULL is carried, which design section 5's abbreviated snippet
omits and design section 3.1 requires.

The tenant-isolation predicate test now reads with_check only where the policy has
one - pg_policies reports NULL for FOR SELECT, and GetString threw rather than
failing an assertion.

All three literals that pin the ordered migration list grow with it: the
migration-script test, the migration-behaviour test and verify-migrator.sh's case
pattern AND the failure message that explains it, which is the only one of the
three an operator reads.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Pin the lowercase wire spelling, and build the one place tests write memberships

Two small pieces that everything after this depends on. **One of them already exists.**

**`MembershipRoleWire` is plan 1's**, and it lives in the **domain** —
`src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs`, contract §13.2.1, which pins both its
home and its exact members. This task **does not create it**; the Prerequisites check 8 already
confirmed it is there and stopped you if it was not. What this task adds is the **test** that holds
it to the database, because plan 2 is its first consumer on the wire and nothing in plan 1 compares
it against `pg_constraint`.

Why that test is worth a task's space. Shared contract §8 spells the wire values
`'admin' | 'trader' | 'viewer'` — **lowercase**, which is not this repository's enum convention.
Every other enum on both hosts goes through `EnumWireFormat` (`JsonNamingPolicy.SnakeCaseUpper`),
which would produce `ADMIN`. The lowercase spelling is not a slip: the database column's own
`CHECK (role IN ('admin', 'trader', 'viewer'))` and the `role = 'admin'` inside
`customer.is_admin_of` are both lowercase (shared contract §4 and §5), and *"the database spelling is
normative"* is the rule this repository already follows — it simply happens to disagree with the
converter for this one column. Reading the value set out of PostgreSQL's own catalogue is what stops
a later tidy-up routing it through `EnumWireFormat` and shipping `ADMIN` to a client that compares
against `'admin'`.

⚠ If plan 1 already shipped an equivalent catalogue-backed test, keep plan 1's and drop the
duplicate here — say which in the commit message. Two tests asserting one fact is noise, not
belt-and-braces.

**`MembershipSeed`.** Every test from task 3 onward needs to put an account in a second business,
remove it again, and read back what the database thinks. Shared contract §4 makes
`customer.customer_membership` and its five columns normative; **nothing pins plan 1's `DbSet`
name**, so these helpers write the table by raw SQL through the owner connection and stay correct
whatever plan 1 called the set. The company itself goes through `Customer.Create`, which this plan
does not change.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/MembershipSeed.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/MembershipRoleWireTests.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/MembershipSeedSelfTests.cs`

**Interfaces:**
- Consumes: `PeakPower.Domain.Customers.MembershipRole` (`{ Admin, Trader, Viewer }`, shared
  contract §7);
  `PeakPower.Domain.Customers.MembershipRoleWire.Of(MembershipRole) -> string`,
  `.Values -> IReadOnlyList<string>` (`["admin","trader","viewer"]`) and the `Admin` / `Trader` /
  `Viewer` constants (**plan 1**, contract §13.2.1 — the DOMAIN file, not a host one);
  `PeakPower.Domain.Customers.Customer.Create(string, string?, KvkNumber, string?,
  Address, Address?, ContactPerson, string?, string)`;
  `CustomerApiFactory.CreateOwnerDbContext()`, `.SeedCustomerWithAccountAsync(string, string,
  string, string)`; `TenancyFixture.OwnerConnectionString`, `.Connect(string)`.
- Produces:
  - `PeakPower.Integration.Tests.Auth.MembershipSeed.AddBusinessAsync(PeakPowerDbContext, Guid, string, string?, string, DateTimeOffset, CancellationToken) -> Task<Guid>`
  - `MembershipSeed.JoinAsync(PeakPowerDbContext, Guid, Guid, string, DateTimeOffset, CancellationToken) -> Task`
  - `MembershipSeed.RemoveAsync(PeakPowerDbContext, Guid, Guid, DateTimeOffset, CancellationToken) -> Task`
  - `MembershipSeed.BusinessesOfAsync(PeakPowerDbContext, Guid, CancellationToken) -> Task<Guid[]>`
  - `MembershipSeed.OnlyBusinessOfAsync(PeakPowerDbContext, Guid, CancellationToken) -> Task<Guid>`
  - `MembershipSeed.SetLastActiveBusinessAsync(PeakPowerDbContext, Guid, Guid?, CancellationToken) -> Task`
  - `MembershipSeed.LastActiveBusinessOfAsync(PeakPowerDbContext, Guid, CancellationToken) -> Task<Guid?>`
  - ⚠ Nothing in plan 2 accepts a role from a client, so this plan reads only `Of`, the three
    constants and `Values`. `Parse` and `TryParse` are on the same type and are **plan 1's**
    (contract §13.2.1); plan 4's `PATCH /api/v1/company/memberships/{accountId}` is the first route
    that reads a role off the wire and calls `TryParse`. Nothing here is created — this task adds
    only the two test files and `MembershipSeed`.

- [ ] **Step 1: Write the failing tests**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/MembershipRoleWireTests.cs`:

```csharp
using System.Text.RegularExpressions;
using Npgsql;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Web.Http;
using PeakPower.Integration.Tests.Tenancy;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Auth;

/// <summary>
/// <c>membershipRole</c> is the one enum on either host whose wire spelling is NOT
/// <see cref="EnumWireFormat"/>'s, and this class exists so that stays a decision rather than a
/// bug someone "fixes".
/// <para>
/// The authority is the database. Shared contract §4 gives
/// <c>customer.customer_membership.role</c> a <c>CHECK (role IN ('admin', 'trader', 'viewer'))</c>
/// and shared contract §5's <c>customer.is_admin_of</c> compares <c>role = 'admin'</c>; shared
/// contract §8 puts the same three strings on the wire. So this reads the constraint out of
/// PostgreSQL's own catalog and requires the C# constants to be exactly that set — a comparison
/// against a hand-written array here would be two copies of the same guess.
/// </para>
/// </summary>
[Collection(nameof(TenancyCollection))]
public sealed class MembershipRoleWireTests
{
    private readonly TenancyFixture _fixture;

    public MembershipRoleWireTests(TenancyFixture fixture) => _fixture = fixture;

    [Fact]
    public void Every_role_has_a_lowercase_wire_spelling()
    {
        MembershipRoleWire.Of(MembershipRole.Admin).ShouldBe("admin");
        MembershipRoleWire.Of(MembershipRole.Trader).ShouldBe("trader");
        MembershipRoleWire.Of(MembershipRole.Viewer).ShouldBe("viewer");

        // Computed from Enum.GetValues, not hand-listed, so a fourth member widens this instead of
        // being silently left out of the OpenAPI document.
        MembershipRoleWire.Values.ShouldBe(["admin", "trader", "viewer"]);
    }

    /// <summary>
    /// The divergence, asserted in the direction that matters. If somebody routes membershipRole
    /// through the shared converter "for consistency", the portal starts receiving ADMIN while
    /// every stored row and every policy predicate still says admin.
    /// </summary>
    [Fact]
    public void The_wire_spelling_is_deliberately_not_the_shared_screaming_snake_one()
    {
        EnumWireFormat.Names<MembershipRole>().ShouldBe(["ADMIN", "TRADER", "VIEWER"],
            "if this ever stops being SCREAMING_SNAKE the whole premise of this test is gone");

        MembershipRoleWire.Values.ShouldNotBe(EnumWireFormat.Names<MembershipRole>(),
            "membershipRole is the one enum whose database spelling is lowercase - see the " +
            "CHECK constraint asserted below - so its wire spelling is lowercase too. That is a " +
            "decision recorded in shared contract sections 3 and 8, not an oversight to tidy up.");
    }

    [Fact]
    public async Task The_wire_spellings_are_exactly_the_value_set_the_database_enforces()
    {
        var ct = TestContext.Current.CancellationToken;

        await using var connection = TenancyFixture.Connect(_fixture.OwnerConnectionString);
        await connection.OpenAsync(ct);

        await using var command = new NpgsqlCommand(
            """
            SELECT pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'customer'
              AND t.relname = 'customer_membership'
              AND c.contype = 'c'
            """,
            connection);

        var definition = (string?)await command.ExecuteScalarAsync(ct);

        definition.ShouldNotBeNull(
            "customer.customer_membership must carry exactly one CHECK constraint - shared " +
            "contract section 4's role value set. Without it this test has no authority to " +
            "compare against and would pass over anything.");

        // Every single-quoted literal in the constraint definition, in the order PostgreSQL
        // prints them.
        var enforced = Regex
            .Matches(definition!, "'([^']*)'", RegexOptions.CultureInvariant)
            .Select(match => match.Groups[1].Value)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();

        enforced.ShouldBe(
            MembershipRoleWire.Values.OrderBy(value => value, StringComparer.Ordinal).ToArray(),
            $"the wire spelling and the stored spelling must be one set. The database enforces " +
            $"[{string.Join(", ", enforced)}] and MembershipRoleWire produces " +
            $"[{string.Join(", ", MembershipRoleWire.Values)}]. An INSERT of the wire value has to " +
            "satisfy this constraint, and customer.is_admin_of compares role = 'admin' literally.");
    }
}
```

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/MembershipSeedSelfTests.cs`:

```csharp
using PeakPower.Domain.Customers;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Auth;

/// <summary>
/// The arrangement helper every test from task 3 onward leans on, checked against the database it
/// writes to. A seeding helper that quietly writes nothing turns every test built on it green and
/// empty, which is the failure this repository has already shipped once (a config glob matching
/// zero files).
/// </summary>
public sealed class MembershipSeedSelfTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_seeded_account_starts_in_exactly_one_business()
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Seed self test {Guid.NewGuid():N}", MembershipSeed.FreshKvkNumber(), email, Password);

        await using var owner = factory.CreateOwnerDbContext();

        var businesses = await MembershipSeed.BusinessesOfAsync(owner, account.Id, Ct);

        businesses.Length.ShouldBe(1,
            "plan 1's migration backfills one membership per account and " +
            "SeedCustomerWithAccountAsync creates one. If this is 0, every test that switches " +
            "between businesses is arranging nothing and asserting nothing.");
    }

    [Fact]
    public async Task A_second_business_is_added_read_back_and_removed()
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Seed self test {Guid.NewGuid():N}", MembershipSeed.FreshKvkNumber(), email, Password);

        await using var owner = factory.CreateOwnerDbContext();

        var first = await MembershipSeed.OnlyBusinessOfAsync(owner, account.Id, Ct);

        var second = await MembershipSeed.AddBusinessAsync(
            owner,
            account.Id,
            legalName: "Windkracht Noord B.V.",
            tradeName: "Windkracht",
            membershipRole: MembershipRoleWire.Viewer,
            joinedAt: new DateTimeOffset(2026, 3, 1, 9, 0, 0, TimeSpan.Zero),
            cancellationToken: Ct);

        (await MembershipSeed.BusinessesOfAsync(owner, account.Id, Ct))
            .ShouldBe([first, second],
                "BusinessesOfAsync orders by created_at then customer_id, and the second business " +
                "was joined in 2026 while the first was joined by the seeder just now - so this " +
                "assertion also pins the ORDER sign-in's oldest-membership fallback depends on. " +
                "If it flips, joinedAt is not reaching the row.");

        await MembershipSeed.RemoveAsync(
            owner, account.Id, second,
            removedAt: new DateTimeOffset(2026, 4, 1, 9, 0, 0, TimeSpan.Zero),
            cancellationToken: Ct);

        (await MembershipSeed.BusinessesOfAsync(owner, account.Id, Ct)).ShouldBe([first],
            "RemoveAsync sets removed_at, and every read in this suite filters on removed_at IS " +
            "NULL. A removal that does not stick makes the revocation probes prove nothing.");
    }

    [Fact]
    public async Task The_last_active_business_round_trips()
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Seed self test {Guid.NewGuid():N}", MembershipSeed.FreshKvkNumber(), email, Password);

        await using var owner = factory.CreateOwnerDbContext();
        var business = await MembershipSeed.OnlyBusinessOfAsync(owner, account.Id, Ct);

        await MembershipSeed.SetLastActiveBusinessAsync(owner, account.Id, null, Ct);
        (await MembershipSeed.LastActiveBusinessOfAsync(owner, account.Id, Ct)).ShouldBeNull();

        await MembershipSeed.SetLastActiveBusinessAsync(owner, account.Id, business, Ct);
        (await MembershipSeed.LastActiveBusinessOfAsync(owner, account.Id, Ct)).ShouldBe(business);
    }
}
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror > /tmp/pp-t2-build.txt 2>&1
```

Read `/tmp/pp-t2-build.txt`. Expected: FAIL to compile with `error CS0103: The name
'MembershipSeed' does not exist in the current context` in `MembershipSeedSelfTests.cs`, once per
call — that type is the only new one here.

⚠ **`MembershipRoleWire` must NOT be among the errors.** Plan 1 ships it
(`src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs`, contract §13.2.1) and the
Prerequisites check 8 already read it. `CS0103: The name 'MembershipRoleWire' does not exist` here
means either plan 1 is not landed or the `using` is wrong — the type is in
`PeakPower.Domain.Customers`, not `PeakPower.Api.Customer.Auth`. Fix the `using`; do not create the
type.

So `MembershipRoleWireTests.cs` compiles as soon as `MembershipSeed` exists, and its three facts go
green on the first run rather than red. That is honest and it is the point: this class is a **pin**
on a type plan 1 already shipped, and the thing that earns it is step 5's mutation, not a red here.
Plan 1's own coverage of that type compares against a hand-written array; this one compares against
`pg_constraint`.

- [ ] **Step 3: Write `MembershipSeed`**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/MembershipSeed.cs`:

```csharp
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using PeakPower.Persistence;

namespace PeakPower.Integration.Tests.Auth;

/// <summary>
/// Arranges memberships for the session tests. Every method here takes a context on the OWNER
/// connection — <c>CustomerApiFactory.CreateOwnerDbContext()</c> or
/// <c>TenancyFixture.OwnerContext()</c> — because arranging through the app role would be
/// arranging through the thing under test.
/// </summary>
/// <remarks>
/// <para>
/// The membership rows are written as raw SQL rather than through a <c>DbSet</c>. Shared contract
/// §4 makes <c>customer.customer_membership</c> and its five columns normative and nothing pins the
/// name plan 1 gave the set, so this stays correct whatever that name turns out to be — and the
/// role values it writes are the same lowercase literals the column's own <c>CHECK</c> enforces.
/// The company itself goes through <see cref="Customer.Create"/>, which this plan does not change.
/// </para>
/// <para>
/// <see cref="FreshKvkNumber"/> counts rather than randomises. <c>customer.customer</c> carries a
/// unique index on <c>kvk_number</c> and these tests share one container per class, so a random
/// eight digits collides eventually and reports itself as an unreadable 23505 in whichever test
/// drew the duplicate. The counter starts at 61 000 000 to stay clear of
/// <c>CustomerApiRouteTableTests</c>' 41 000 000 and <c>TenancyFixture</c>'s 8100000x.
/// </para>
/// </remarks>
public static class MembershipSeed
{
    private static int _kvkCounter = 61_000_000;

    public static string FreshKvkNumber() =>
        Interlocked.Increment(ref _kvkCounter).ToString(CultureInfo.InvariantCulture);

    /// <summary>
    /// A brand-new business, and this account joined to it. Returns the new
    /// <c>customer.customer.id</c>.
    /// </summary>
    public static async Task<Guid> AddBusinessAsync(
        PeakPowerDbContext owner,
        Guid accountId,
        string legalName,
        string? tradeName,
        string membershipRole,
        DateTimeOffset joinedAt,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(owner);

        var company = Customer.Create(
            legalName,
            tradeName,
            kvkNumber: KvkNumber.Create(FreshKvkNumber()).Value,
            vatNumber: null,
            billingAddress: new Address("Havenweg", "12", null, "3011 AA", "Rotterdam", "NL"),
            visitingAddress: null,
            primaryContact: new ContactPerson("Els Bakker", "els@example.test", null),
            internalReference: null,
            locale: "nl-NL").Value;

        owner.Customers.Add(company);
        await owner.SaveChangesAsync(cancellationToken);

        await JoinAsync(owner, accountId, company.Id, membershipRole, joinedAt, cancellationToken);

        return company.Id;
    }

    public static Task JoinAsync(
        PeakPowerDbContext owner,
        Guid accountId,
        Guid customerId,
        string membershipRole,
        DateTimeOffset joinedAt,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(owner);

        return owner.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO customer.customer_membership (account_id, customer_id, role, created_at)
             VALUES ({accountId}, {customerId}, {membershipRole}, {joinedAt})
             """,
            cancellationToken);
    }

    /// <summary>
    /// Removal is an <c>UPDATE</c> setting <c>removed_at</c> and never a <c>DELETE</c> — design
    /// §3.1: PostgreSQL evaluates <c>WITH CHECK</c> for an <c>INSERT</c> and for an
    /// <c>UPDATE</c>'s new row and never for a <c>DELETE</c>, so there is no <c>DELETE</c> grant on
    /// this table to either app role. This helper runs as the owner, but it writes the same shape
    /// plan 4's endpoint will.
    /// </summary>
    public static Task RemoveAsync(
        PeakPowerDbContext owner,
        Guid accountId,
        Guid customerId,
        DateTimeOffset removedAt,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(owner);

        return owner.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE customer.customer_membership
             SET removed_at = {removedAt}
             WHERE account_id = {accountId} AND customer_id = {customerId}
             """,
            cancellationToken);
    }

    /// <summary>
    /// The businesses this account is a live member of, oldest membership first — the same order
    /// sign-in's fallback and <c>GET /auth/me</c>'s <c>memberships[]</c> use.
    /// </summary>
    public static async Task<Guid[]> BusinessesOfAsync(
        PeakPowerDbContext owner, Guid accountId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(owner);

        // AS "Value": EF Core's Database.SqlQuery<T> binds a scalar result from a column with that
        // exact name and throws otherwise.
        return await owner.Database
            .SqlQuery<Guid>(
                $"""
                 SELECT customer_id AS "Value"
                 FROM customer.customer_membership
                 WHERE account_id = {accountId} AND removed_at IS NULL
                 ORDER BY created_at, customer_id
                 """)
            .ToArrayAsync(cancellationToken);
    }

    public static async Task<Guid> OnlyBusinessOfAsync(
        PeakPowerDbContext owner, Guid accountId, CancellationToken cancellationToken) =>
        (await BusinessesOfAsync(owner, accountId, cancellationToken)).Single();

    public static Task SetLastActiveBusinessAsync(
        PeakPowerDbContext owner, Guid accountId, Guid? customerId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(owner);

        return owner.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE customer.customer_account
             SET last_active_business_id = {customerId}
             WHERE id = {accountId}
             """,
            cancellationToken);
    }

    public static async Task<Guid?> LastActiveBusinessOfAsync(
        PeakPowerDbContext owner, Guid accountId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(owner);

        var rows = await owner.Database
            .SqlQuery<Guid?>(
                $"""
                 SELECT last_active_business_id AS "Value"
                 FROM customer.customer_account
                 WHERE id = {accountId}
                 """)
            .ToArrayAsync(cancellationToken);

        return rows.Single();
    }
}
```

- [ ] **Step 4: Build and run**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror > /tmp/pp-t2-build2.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~MembershipRoleWireTests" > /tmp/pp-t2-wire.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~MembershipSeedSelfTests" > /tmp/pp-t2-seed.txt 2>&1
```

Read all three. Expected: build clean, all six tests PASS.

⚠ If `A_seeded_account_starts_in_exactly_one_business` reports `0`, stop: plan 1's
`SeedCustomerWithAccountAsync` is creating an account with no membership, and every session test in
this plan would be arranging nothing. Fix that in plan 1's fixture, not here.

- [ ] **Step 5: Mutate the wire spelling — prove the database is the authority**

In **plan 1's** `src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs`, change one constant to
the shared converter's spelling:

```csharp
    public const string Admin = "ADMIN";
```

⚠ That file is not this plan's to change: mutate it, watch it bite, restore it, and prove the
restore below. It must be byte-identical to `HEAD` before step 7 commits.

Predicted failures, both by name:

- `Every_role_has_a_lowercase_wire_spelling` — *"should be "admin" but was "ADMIN""*.
- `The_wire_spellings_are_exactly_the_value_set_the_database_enforces` — *"the database enforces
  [admin, trader, viewer] and MembershipRoleWire produces [ADMIN, trader, viewer]"*.

The second is the one that matters: it fails **without a hand-written expectation anywhere in the
test**, because the expectation came out of `pg_constraint`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~MembershipRoleWireTests" > /tmp/pp-t2-mut.txt 2>&1
```

Read `/tmp/pp-t2-mut.txt`, confirm both predicted failures, restore `"admin"`, re-run and confirm
green, then prove the restore:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~MembershipRoleWireTests" > /tmp/pp-t2-mut-restored.txt 2>&1
grep -n 'public const string Admin' src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs \
    > /tmp/pp-t2-const.txt 2>&1
git diff --stat src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs \
    >> /tmp/pp-t2-const.txt 2>&1
```

Read both: the second must print `    public const string Admin = "admin";` and then an EMPTY
diff — plan 1's file goes back exactly as it was.

- [ ] **Step 6: Mutate the seed helper — prove the removal actually removes**

In `MembershipSeed.RemoveAsync`, change the statement so it writes nothing:

```csharp
             UPDATE customer.customer_membership
             SET removed_at = {removedAt}
             WHERE account_id = {accountId} AND customer_id = {customerId} AND false
```

Predicted failure: `A_second_business_is_added_read_back_and_removed` fails on its last assertion —
*"should be [<first>] but was [<first>, <second>]"* — with the message *"RemoveAsync sets
removed_at, and every read in this suite filters on removed_at IS NULL"*. This is worth doing
because three later probes (tasks 5, 6 and 8) prove a **removal** and would all go green over a
removal that never happened.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~MembershipSeedSelfTests" > /tmp/pp-t2-mut2.txt 2>&1
```

Read it, confirm, remove the `AND false`, re-run, confirm green.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Auth/MembershipSeed.cs \
        tests/PeakPower.Integration.Tests/Auth/MembershipRoleWireTests.cs \
        tests/PeakPower.Integration.Tests/Auth/MembershipSeedSelfTests.cs
git commit -m "Name the lowercase spelling membershipRole actually uses

membershipRole is the one enum on either host that is not serialised
SCREAMING_SNAKE, because the column it comes from is not stored that way: the
CHECK constraint says 'admin' and customer.is_admin_of compares role = 'admin'.
MembershipRoleWire itself is plan 1's and is not touched here; what this adds is
the test that holds it to the database. The value set is read out of pg_constraint
rather than hand-listed, so the expectation has an authority no C# constant can
supply, and a later tidy-up that routes this enum through EnumWireFormat for
consistency ships ADMIN and fails here instead of at a client.

MembershipSeed is the one place the session tests write customer_membership. Raw
SQL against the normative table and columns, because nothing pins plan 1's DbSet
name; a self-test proves it writes, orders and removes rather than leaving three
later revocation probes green and empty.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `CurrentAccountResponse` grows the switcher's data, and `GET /auth/me` fills it

Shared contract §8 gives `CurrentAccountResponse` two new members and takes `isAdmin` away. Plan 1
has already taken `isAdmin` away — it had to, because `CustomerAccount.IsAdmin` is one of the two
columns it drops and `AuthEndpoints` constructs this record in three places. This task adds the two
new members and fills them from one query, in the one place that can answer it.

⚠ **The construction is in three places and they all move together.** `SignInResponse.Account` is
the same record, so sign-in and refresh answer with it too; a switcher that only gets its list from
`/me` would show nothing until the shell made a second call. This task therefore changes all three
call sites and adds one private helper they share.

⚠ **`membershipRole` is read from two different authorities on purpose.** On `/auth/me` and (task 6)
the switch it comes from `ICustomerContext.Role`, which plan 1's middleware read out of the database
on **this** request — that is the whole point of taking the claim off the token (design decision 8:
a demotion bites immediately rather than at the next fifteen-minute boundary). On sign-in and
refresh there is no `ICustomerContext` at all: both routes are on the anonymous allow-list and run
on the owner connection, so the role is read out of the membership list this task builds. The two
are the same row; `RoleIn` below is what keeps them from disagreeing about which entry it is.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/OpenApi/EnumWireValuesSchemaTransformer.cs:43-109`
- Modify (regenerated): `/Users/thinhhuynh/PeakPower/peakpower-platform/artifacts/openapi/customer.json`
- Modify (re-accepted): `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/CurrentAccountMembershipsTests.cs`

**Interfaces:**
- Consumes: `MembershipRoleWire.Of(MembershipRole)`, `.Values`, `.Viewer` (task 2);
  `MembershipSeed.*` (task 2); `Customer.Memberships` and the widened query filter (task 1);
  `ICustomerContext.Role -> MembershipRole` (plan 1, shared contract §7);
  `ITokenIssuer.IssueAccessToken(CustomerAccount, Guid)` (plan 1, shared contract §7);
  `RefreshToken.CustomerId` (plan 1).
- Produces:
  - `PeakPower.Contracts.Customer.Auth.AccountMembershipDto(Guid CustomerId, string TradeName, string MembershipRole)`
  - `CurrentAccountResponse(Guid AccountId, Guid CustomerId, string FirstName, string LastName, string Email, string MembershipRole, IReadOnlyList<AccountMembershipDto> Memberships)`
  - `AuthEndpoints.MembershipsOfAsync(PeakPowerDbContext, Guid, CancellationToken) -> Task<List<AccountMembershipDto>>` (private)
  - `AuthEndpoints.SessionFor(CustomerAccount, Guid, IReadOnlyList<AccountMembershipDto>, AccessToken) -> SignInResponse` (private)

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/CurrentAccountMembershipsTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Domain.Customers;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Auth;

/// <summary>
/// <c>GET /api/v1/auth/me</c> after membership: the shell's whole picture of who is signed in and
/// what else they can reach.
/// </summary>
/// <remarks>
/// Every fact here is asserted through the HTTP surface and a signed-in client, which is what makes
/// them evidence about both tenancy layers at once: the memberships[] projection reads
/// <c>customer.customer</c> rows belonging to businesses the token does NOT name, so it passes only
/// if the widened query filter (layer 1) and the widened row-level-security policy (layer 2) both
/// moved in task 1. A test that read the same rows through the owner connection would prove
/// neither.
/// </remarks>
public sealed class CurrentAccountMembershipsTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Me_lists_every_business_this_login_belongs_to_oldest_membership_first()
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        var legalName = $"Zonneweide Beheer {Guid.NewGuid():N}";
        var account = await factory.SeedCustomerWithAccountAsync(
            legalName, MembershipSeed.FreshKvkNumber(), email, Password);

        Guid first;
        Guid second;
        await using (var owner = factory.CreateOwnerDbContext())
        {
            first = await MembershipSeed.OnlyBusinessOfAsync(owner, account.Id, Ct);
            second = await MembershipSeed.AddBusinessAsync(
                owner,
                account.Id,
                legalName: "Windkracht Noord B.V.",
                tradeName: "Windkracht",
                membershipRole: MembershipRoleWire.Viewer,
                joinedAt: new DateTimeOffset(2026, 6, 1, 9, 0, 0, TimeSpan.Zero),
                cancellationToken: Ct);
        }

        var me = await SignInAndReadMeAsync(email);

        me.Memberships.Select(membership => membership.CustomerId).ToArray().ShouldBe(
            [first, second],
            "oldest membership first, and never 'any order': the switcher is a list a person " +
            "reads, and sign-in's fallback picks the FIRST entry of this same ordering");

        // The second business is not the one the token names, so it is readable only because BOTH
        // tenancy layers were widened in task 1. If the policy alone moved, this entry is absent;
        // if the filter alone moved, the query is refused by the database.
        me.Memberships[1].TradeName.ShouldBe("Windkracht");
        me.Memberships[1].MembershipRole.ShouldBe(MembershipRoleWire.Viewer);

        // The seeder leaves trade_name null, and a switcher entry with a blank label is not a
        // switcher entry. Shared contract section 8 types the field non-null, so the legal name
        // stands in.
        me.Memberships[0].TradeName.ShouldBe(
            legalName,
            "a business with no trade name is labelled by its legal name; the wire field is " +
            "non-null and a blank entry would be unreadable in the rail");

        me.AccountId.ShouldBe(account.Id);

        // Self-consistency rather than "it must be `first`": which business sign-in lands on is
        // task 4's subject, and asserting it here would make this test fail for a reason that has
        // nothing to do with memberships[].
        me.Memberships.Select(membership => membership.CustomerId).ShouldContain(me.CustomerId);
        me.MembershipRole.ShouldBe(
            me.Memberships.Single(membership => membership.CustomerId == me.CustomerId).MembershipRole,
            "the top-level membershipRole is the caller's role in the business the token names, " +
            "so it must agree with that business's own entry in the list. These come from two " +
            "different authorities - ICustomerContext.Role, read from the database this request, " +
            "and the projection below it - and disagreement means one of them is stale.");
    }

    [Fact]
    public async Task Me_never_lists_a_business_the_login_was_removed_from()
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Zonneweide Beheer {Guid.NewGuid():N}", MembershipSeed.FreshKvkNumber(), email, Password);

        Guid first;
        Guid second;
        await using (var owner = factory.CreateOwnerDbContext())
        {
            first = await MembershipSeed.OnlyBusinessOfAsync(owner, account.Id, Ct);
            second = await MembershipSeed.AddBusinessAsync(
                owner, account.Id, "Windkracht Noord B.V.", "Windkracht", MembershipRoleWire.Trader,
                new DateTimeOffset(2026, 6, 1, 9, 0, 0, TimeSpan.Zero), Ct);

            // Both halves in one test: without the ADD above, "the list has one entry" would pass
            // over a projection that never returns anything at all.
            await MembershipSeed.RemoveAsync(
                owner, account.Id, second,
                new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero), Ct);
        }

        var me = await SignInAndReadMeAsync(email);

        me.Memberships.Select(membership => membership.CustomerId).ToArray().ShouldBe(
            [first],
            "removed_at IS NULL is carried by the projection, by the widened query filter and by " +
            "the widened policy. A removed membership that still appears here puts a business the " +
            "person cannot act in on the switcher.");
    }

    /// <summary>
    /// Design decision 8, end to end: the database is the sole authority on role, so a change made
    /// after the token was minted is visible on the very next request rather than at the next
    /// fifteen-minute boundary. This is what taking <c>is_admin</c> out of the token buys.
    /// </summary>
    [Fact]
    public async Task Me_reports_a_role_changed_after_the_token_was_minted()
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Zonneweide Beheer {Guid.NewGuid():N}", MembershipSeed.FreshKvkNumber(), email, Password);

        var client = await SignedInClientAsync(email);

        var before = await ReadMeAsync(client);

        await using (var owner = factory.CreateOwnerDbContext())
        {
            await owner.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 UPDATE customer.customer_membership
                 SET role = {MembershipRoleWire.Viewer}
                 WHERE account_id = {account.Id} AND customer_id = {before.CustomerId}
                 """,
                Ct);
        }

        var after = await ReadMeAsync(client);

        after.MembershipRole.ShouldBe(
            MembershipRoleWire.Viewer,
            "the access token was minted before this change and carries no role claim at all, so " +
            "the next request has to read the new value. If this still reports the old role, the " +
            "role has crept back into the token or into a cache.");
        after.MembershipRole.ShouldNotBe(before.MembershipRole,
            "if the seeded role were already viewer this test would pass without proving anything");
    }

    private async Task<HttpClient> SignedInClientAsync(string email)
    {
        var client = factory.CreateAnonymousClient();

        var signIn = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password), Ct);
        signIn.StatusCode.ShouldBe(
            HttpStatusCode.OK,
            "every fact in this class is asserted through a signed-in client; a failed sign-in " +
            "would make them all assert against 401s");

        var session = await signIn.Content.ReadFromJsonAsync<SignInResponse>(Ct);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", session!.AccessToken);

        // The same record comes back from sign-in, so the two must agree. A shell that read the
        // list only from /me would show nothing between sign-in and its second call.
        session.Account.Memberships.ShouldNotBeEmpty(
            "SignInResponse.Account is the SAME CurrentAccountResponse - sign-in fills it too");

        return client;
    }

    private async Task<CurrentAccountResponse> ReadMeAsync(HttpClient client)
    {
        var response = await client.GetAsync("/api/v1/auth/me", Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        return (await response.Content.ReadFromJsonAsync<CurrentAccountResponse>(Ct))!;
    }

    private async Task<CurrentAccountResponse> SignInAndReadMeAsync(string email) =>
        await ReadMeAsync(await SignedInClientAsync(email));
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror > /tmp/pp-t3-build.txt 2>&1
```

Read `/tmp/pp-t3-build.txt`. Expected: FAIL to compile —
`error CS1061: 'CurrentAccountResponse' does not contain a definition for 'Memberships'` and the
same for `'MembershipRole'`, in `CurrentAccountMembershipsTests.cs`. The record has neither member
yet, so the compile failure is the first red.

- [ ] **Step 3: Give the contract its two new members**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs`,
make the `CurrentAccountResponse` declaration and the new DTO above it read **exactly** this — today
(before plan 1) it reads `CurrentAccountResponse(Guid AccountId, Guid CustomerId, string FirstName,
string LastName, string Email, bool IsAdmin)` at `:7-13`; plan 1's `is_admin` sweep removes the last
member, and if `bool IsAdmin` is still there, delete it in this step:

```csharp
/// <summary>
/// One business this login belongs to, as the rail's switcher shows it.
/// </summary>
/// <param name="TradeName">
/// What the switcher prints. <c>customer.customer.trade_name</c> is nullable and a switcher entry
/// with a blank label is unreadable, so the server sends the legal name when there is no trade
/// name. Shared contract §8 types this field non-null and this is how it stays non-null.
/// </param>
/// <param name="MembershipRole">
/// <c>admin</c> | <c>trader</c> | <c>viewer</c> — lowercase, which is the spelling the column's own
/// CHECK constraint enforces and NOT this repository's usual SCREAMING_SNAKE. See
/// <c>PeakPower.Domain.Customers.MembershipRoleWire</c>, which is the only thing that produces it.
/// </param>
public sealed record AccountMembershipDto(
    Guid CustomerId,
    string TradeName,
    string MembershipRole);

/// <summary>Who the caller is, as the portal's shell needs it.</summary>
/// <param name="CustomerId">
/// The business the presented access token names — the ACTIVE one, exactly one per token. Changing
/// it is <c>POST /api/v1/auth/active-business</c>, never a client-side flag.
/// </param>
/// <param name="MembershipRole">
/// The caller's role in <paramref name="CustomerId"/>. Not a token claim: shared contract §7 keeps
/// the role out of the JWT so that a demotion bites on the next request rather than at the next
/// fifteen-minute boundary, which matters because the mechanism that used to cover that (bumping
/// the security stamp on a privilege change) went with the <c>is_admin</c> column.
/// </param>
/// <param name="Memberships">
/// Every business this login is a live member of, oldest membership first. Always includes
/// <paramref name="CustomerId"/>'s own entry. Never empty: an account with no membership cannot
/// obtain a session at all — see the sign-in refusal in <c>AuthEndpoints</c>.
/// </param>
public sealed record CurrentAccountResponse(
    Guid AccountId,
    Guid CustomerId,
    string FirstName,
    string LastName,
    string Email,
    string MembershipRole,
    IReadOnlyList<AccountMembershipDto> Memberships);
```

- [ ] **Step 4: Build the list once, in the one place that can**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`,
replace the whole `SessionFor` method — today at `:364-369`, reading:

```csharp
    private static SignInResponse SessionFor(CustomerAccount account, AccessToken access) =>
        new(access.Jwt,
            access.ExpiresAt,
            new CurrentAccountResponse(
                account.Id, account.CustomerId, account.FirstName,
                account.LastName, account.Email, account.IsAdmin));
```

with these three members (plan 1 has already changed the body of this method; replace whatever it
now holds):

```csharp
    /// <summary>
    /// Every business this account is a live member of, oldest membership first, with the label the
    /// switcher prints and the role it shows beside it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Queried from <c>Customers</c> rather than from the membership set, because the label is
    /// what needs the tenancy widening.</b> <c>trade_name</c> lives on <c>customer.customer</c>,
    /// whose rows for the OTHER businesses are reachable only because task 1 widened both the
    /// global query filter and <c>customer_customer_tenant_isolation</c> to an account-keyed
    /// membership arm. Reaching for <c>IgnoreQueryFilters()</c> instead would drop layer 1 for the
    /// whole query and is banned by an IL scan.
    /// </para>
    /// <para>
    /// <b>The <c>Where</c> is explicit and is not redundant.</b> On <c>/auth/me</c> and the switch
    /// the query filter already narrows this set; on sign-in and refresh it does not, because both
    /// are anonymous and every filter in this context is shaped <c>!IsAuthenticated || …</c> and
    /// collapses to <c>true</c> there. One predicate that holds on every path beats two paths that
    /// happen to agree.
    /// </para>
    /// <para>
    /// <b>Two scalar sub-selects rather than one projected row.</b> Casting each to a nullable and
    /// taking <c>FirstOrDefault</c> is what makes "no membership" distinguishable from a real
    /// value: an un-cast <c>MembershipRole</c> would come back as <c>Admin</c> (the zero member)
    /// for a company with no matching row, which is the worst possible default. The correlated
    /// scalar subquery is also the shape EF translates most reliably; projecting an anonymous type
    /// out of <c>FirstOrDefault</c> is a translation this query does not need to gamble on.
    /// </para>
    /// <para>
    /// Ordering happens in memory over a handful of rows, so the tie-break on <c>CustomerId</c>
    /// costs nothing and makes the order total: two memberships created in the same transaction
    /// share a <c>created_at</c>, and "the oldest membership" has to name exactly one business or
    /// sign-in lands somewhere different on every run.
    /// </para>
    /// </remarks>
    private static async Task<List<AccountMembershipDto>> MembershipsOfAsync(
        PeakPowerDbContext db,
        Guid accountId,
        CancellationToken cancellationToken)
    {
        var rows = await db.Customers
            .AsNoTracking()
            .Where(company => company.Memberships.Any(
                membership => membership.AccountId == accountId && membership.RemovedAt == null))
            .Select(company => new
            {
                company.Id,
                Label = company.TradeName ?? company.LegalName,
                Role = company.Memberships
                    .Where(membership =>
                        membership.AccountId == accountId && membership.RemovedAt == null)
                    .Select(membership => (MembershipRole?)membership.Role)
                    .FirstOrDefault(),
                JoinedAt = company.Memberships
                    .Where(membership =>
                        membership.AccountId == accountId && membership.RemovedAt == null)
                    .Select(membership => (DateTimeOffset?)membership.CreatedAt)
                    .FirstOrDefault(),
            })
            .ToListAsync(cancellationToken);

        return
        [
            .. rows
                .Where(row => row.Role is not null && row.JoinedAt is not null)
                .OrderBy(row => row.JoinedAt!.Value)
                .ThenBy(row => row.Id)
                .Select(row => new AccountMembershipDto(
                    row.Id, row.Label, MembershipRoleWire.Of(row.Role!.Value)))
        ];
    }

    /// <summary>
    /// The session body sign-in, refresh and the business switch all answer with.
    /// </summary>
    private static SignInResponse SessionFor(
        CustomerAccount account,
        Guid activeCustomerId,
        IReadOnlyList<AccountMembershipDto> memberships,
        AccessToken access) =>
        new(access.Jwt,
            access.ExpiresAt,
            new CurrentAccountResponse(
                account.Id,
                activeCustomerId,
                account.FirstName,
                account.LastName,
                account.Email,
                RoleIn(memberships, activeCustomerId),
                memberships));

    /// <summary>
    /// The caller's role in the business the token is about to name, read off the very list the
    /// response carries so the two cannot disagree.
    /// </summary>
    /// <remarks>
    /// Throwing is deliberate and the exception is unreachable by construction: every caller picks
    /// <paramref name="activeCustomerId"/> OUT of <paramref name="memberships"/>. Reaching here
    /// means that selection was bypassed and we are one line away from minting a token for a
    /// business this account is not a member of — a 500 is the right answer to that, and a
    /// silently-defaulted role is not.
    /// <para>
    /// <c>/auth/me</c> and the switch do NOT use this: both are authenticated, so
    /// <c>ICustomerContext.Role</c> is available and is the value plan 1's middleware proved
    /// against the database on this very request. This exists for the two anonymous routes, which
    /// have no context at all.
    /// </para>
    /// </remarks>
    private static string RoleIn(
        IReadOnlyList<AccountMembershipDto> memberships, Guid activeCustomerId) =>
        memberships.SingleOrDefault(membership => membership.CustomerId == activeCustomerId)
            ?.MembershipRole
        ?? throw new InvalidOperationException(
            "A session was about to be minted for a business this account holds no live " +
            "membership in. Every caller selects the active business out of this same list, so " +
            "reaching here means that selection was bypassed.");
```

`MembershipsOfAsync` returns `AccountMembershipDto`, so add to the file's using directives if they
are not already there:

```csharp
using PeakPower.Contracts.Customer.Auth;   // already present at :3
using PeakPower.Domain.Customers;          // already present at :4 — MembershipRole lives here
```

- [ ] **Step 5: Fill it on `GET /auth/me`**

In the same file, replace the `/me` handler body — today at `:201-234`, whose handler reads:

```csharp
                var account = await db.CustomerAccounts
                    .AsNoTracking()
                    .SingleOrDefaultAsync(a => a.Id == customer.AccountId, cancellationToken);

                // The row is behind the tenant policy, so "missing" already means "not yours" —
                // 404, never 403 [F13-R19]. ApiResults.Found keeps this endpoint's 404 body
                // byte-identical to every other cross-tenant/missing-row 404 in the API, rather
                // than falling back to ASP.NET Core's own default problem-details shape.
                return ApiResults.Found(account is null
                    ? null
                    : new CurrentAccountResponse(
                        account.Id, account.CustomerId, account.FirstName,
                        account.LastName, account.Email, account.IsAdmin));
```

with:

```csharp
                var account = await db.CustomerAccounts
                    .AsNoTracking()
                    .SingleOrDefaultAsync(a => a.Id == customer.AccountId, cancellationToken);

                // The row is behind the tenant policy, so "missing" already means "not yours" —
                // 404, never 403 [F13-R19]. ApiResults.NotFound() is the same constant body
                // ApiResults.Found() would have produced; the early return is what stops the
                // membership query below running for an account that is not there, and turning a
                // 404 into a 500.
                if (account is null)
                {
                    return ApiResults.NotFound();
                }

                var memberships = await MembershipsOfAsync(db, account.Id, cancellationToken);

                // membershipRole from the CONTEXT and not from the list: this request is
                // authenticated, so plan 1's middleware already read the role out of
                // customer_membership on this very round trip and refused the request outright if
                // there was no live row. Reading it again from the projection would be a second
                // answer to a question that already has an authoritative one.
                return Results.Ok(new CurrentAccountResponse(
                    account.Id,
                    customer.CustomerId,
                    account.FirstName,
                    account.LastName,
                    account.Email,
                    MembershipRoleWire.Of(customer.Role),
                    memberships));
```

- [ ] **Step 6: Fill it on sign-in and on refresh**

Both routes are anonymous and run on the owner connection, so `MembershipsOfAsync` sees every
`customer.customer` row and its own `Where` is what narrows it.

**Sign-in.** In the `/sign-in` handler, immediately after `throttle.RecordSuccess(username,
source);` (today at `:168`), insert:

```csharp
                var memberships = await MembershipsOfAsync(db, account.Id, cancellationToken);
```

and replace the handler's `return Results.Ok(new SignInResponse(...))` — today at `:182-187` —
with:

```csharp
                return Results.Ok(SessionFor(account, activeCustomerId, memberships, access));
```

⚠ `activeCustomerId` is the local plan 1 already computes to satisfy
`tokens.IssueAccessToken(account, …)` and `RefreshToken.Issue(account.Id, …, …)`. If plan 1 inlined
that expression at both call sites instead of naming it, hoist it into a local
`var activeCustomerId = …;` above them first and pass the local to all three. Its right-hand side is
plan 1's selection and stays exactly as plan 1 wrote it — **task 4 adds one statement beside it and
changes no part of the rule**; this task only routes the value through one name.

**Refresh.** `RefreshAsync` answers with a session in two places. Immediately after the `account`
read — today `:305-306`:

```csharp
        var account = await db.CustomerAccounts
            .SingleOrDefaultAsync(a => a.Id == stored.CustomerAccountId, cancellationToken);
```

insert:

```csharp
        // Read once and used by both exits below. stored.CustomerId is the business this refresh
        // chain belongs to (plan 1 gave customer.refresh_token its own column, because a session
        // belongs to a business and a refresh has to know which).
        var memberships = account is null
            ? []
            : await MembershipsOfAsync(db, account.Id, cancellationToken);

        // Task 5 replaces this with the distinct terminal signal design §5 requires. A plain
        // rejection is already correct behaviour - the client cannot refresh past a 401 and signs
        // out - and it is what stops this task shipping a handler that mints a session for a
        // business the account was removed from, or throws out of RoleIn trying.
        if (account is not null
            && !memberships.Any(membership => membership.CustomerId == stored.CustomerId))
        {
            return RefreshRejected(response);
        }
```

Then replace the racing-tab exit — today at `:322-323`:

```csharp
                var raced = tokens.IssueAccessToken(account);
                return Results.Ok(SessionFor(account, raced));
```

with:

```csharp
                var raced = tokens.IssueAccessToken(account, stored.CustomerId);
                return Results.Ok(SessionFor(account, stored.CustomerId, memberships, raced));
```

and the rotating exit — today at `:356-361`:

```csharp
        var access = tokens.IssueAccessToken(account);
        await db.SaveChangesAsync(cancellationToken);

        RefreshCookie.Write(response, refresh, refreshExpiresAt);

        return Results.Ok(SessionFor(account, access));
```

with:

```csharp
        var access = tokens.IssueAccessToken(account, stored.CustomerId);
        await db.SaveChangesAsync(cancellationToken);

        RefreshCookie.Write(response, refresh, refreshExpiresAt);

        return Results.Ok(SessionFor(account, stored.CustomerId, memberships, access));
```

⚠ Plan 1 has already changed both `IssueAccessToken` calls to pass a customer id — shared contract
§7 makes the two-argument form normative and the one-argument form no longer compiles. If the
expression plan 1 passes is not `stored.CustomerId`, **stop and read why**: a refresh that re-mints
for a business other than the one the presented token belongs to is the re-pointing design §5 exists
to prevent.

- [ ] **Step 7: Publish the three values in the OpenAPI document**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/OpenApi/EnumWireValuesSchemaTransformer.cs`,
add to the using directives at `:5-10`:

```csharp
using PeakPower.Contracts.Customer.Auth;
```

⚠ **One using, not two.** `MembershipRoleWire` is in `PeakPower.Domain.Customers` (contract
§13.2.1), and this file already carries `using PeakPower.Domain.Customers;` at `:7` for the enums it
publishes today. `using PeakPower.Api.Customer.Auth;` would be an unused directive, which is a build
error under `TreatWarningsAsErrors`.

and insert into the `WireValuesByProperty` initialiser, immediately after the `// Portal responses.`
group's last entry (`[(typeof(EanPoolEntryDto), "commodity")]`, today `:55`):

```csharp
            // Auth responses. THE ONE ENUM ON THIS HOST WHOSE VALUES DO NOT COME FROM
            // EnumWireFormat, and the exception is in the database rather than on the wire:
            // customer.customer_membership.role is stored lowercase (its CHECK constraint and
            // customer.is_admin_of both say so), so 'admin' | 'trader' | 'viewer' is the stored
            // spelling AND the wire spelling. EnumWireFormat.Names<MembershipRole>() would publish
            // ADMIN | TRADER | VIEWER, which no row ever holds and no client should compare
            // against. MembershipRoleWire.Values is computed from Enum.GetValues, so a fourth
            // member still reaches this document without anybody remembering this file, and
            // MembershipRoleWireTests holds it to the constraint PostgreSQL actually enforces.
            [(typeof(CurrentAccountResponse), "membershipRole")] = MembershipRoleWire.Values,
            [(typeof(AccountMembershipDto), "membershipRole")] = MembershipRoleWire.Values,
```

- [ ] **Step 8: Build, run, and review the contract diff before accepting it**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror > /tmp/pp-t3-build2.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~CurrentAccountMembershipsTests" > /tmp/pp-t3-me.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~CustomerResponseMetadataTests" > /tmp/pp-t3-meta.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~CustomerOpenApiSnapshotTests" > /tmp/pp-t3-snap.txt 2>&1
```

Read all four. Expected: build clean; `CurrentAccountMembershipsTests` all PASS;
`CustomerResponseMetadataTests` PASS (no route was added and no status code changed — only the shape
of a body type, which that class does not pin);
`CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot` **FAILS**,
which is correct: the contract really did change.

Review the change before accepting it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract
ls *.received.json > /tmp/pp-t3-received.txt 2>&1
diff CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json \
     CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.received.json \
     > /tmp/pp-t3-contract.diff 2>&1
wc -l /tmp/pp-t3-contract.diff
```

Read `/tmp/pp-t3-contract.diff` in full. It must contain **only**:

1. a new `AccountMembershipDto` schema with `customerId`, `tradeName` and `membershipRole`, the last
   carrying `"enum": ["admin", "trader", "viewer"]`;
2. `membershipRole` and `memberships` added to `CurrentAccountResponse`, with the same three enum
   values on `membershipRole`;
3. **no** `isAdmin` anywhere — plan 1 already removed it, so it must not appear on either side of
   this diff.

Anything else is a contract change this task did not intend. Then accept:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract
mv CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.received.json \
   CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test PeakPower.sln --nologo > /tmp/pp-t3-all.txt 2>&1
```

Read `/tmp/pp-t3-all.txt`: the whole solution must be green.

- [ ] **Step 9: Mutate the ordering — prove `memberships[]` is oldest-first**

Oldest-first is not decoration. Plan 1's `SelectBusinessAsync` runs the same *oldest by
`created_at`* rule over `customer_membership` to decide which business a sign-in lands in, and task
4 asserts that `memberships[0]` **is** that business. Two orderings, one fact: if this one flips,
the list stops agreeing with the landing and the switcher's first entry is not where the person
actually is.

In `AuthEndpoints.MembershipsOfAsync`, reverse it:

```csharp
                .OrderByDescending(row => row.JoinedAt!.Value)                       // MUTATION
```

Predicted failure:
`CurrentAccountMembershipsTests.Me_lists_every_business_this_login_belongs_to_oldest_membership_first`
fails with *"should be [<first>, <second>] but was [<second>, <first>]"* and the message *"oldest
membership first, and never 'any order'"*, followed by the two `Memberships[1]` assertions failing
on the swapped entry. `RoleIn` still finds the active business, so sign-in itself stays a 200 and the
failure is about the ordering and nothing else.

⚠ **The other property of this projection — that it reads across businesses at all — belongs to the
two tenancy layers, and task 1 mutated both (step 10 for the query filter, step 11 for the policy).
To see it from this side as well, re-apply task 1's step 10 mutation now — drop the third arm of the
`Customer` query filter in `PeakPowerDbContext.cs` — and this very test goes red with *"should be
[<first>, <second>] but was [<first>]"*, because the second business's `customer.customer` row is
filtered away before the projection ever sees it. **Restore the arm before continuing.**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~CurrentAccountMembershipsTests" > /tmp/pp-t3-mut.txt 2>&1
```

Read it, confirm, restore `OrderBy`, re-run and confirm green, then:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git diff --stat src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs > /tmp/pp-t3-restored.txt 2>&1
```

Read it: the only changes against `HEAD` are steps 4, 5 and 6.

- [ ] **Step 10: Mutate the label fallback — prove a nameless business is still readable**

In `MembershipsOfAsync`, send the empty string instead of the legal name. (Dropping the `??` arm
altogether does not compile — `string?` into a non-nullable `string` — and a mutation that breaks the
build proves nothing about an assertion, so keep the coalesce and change its right-hand side.)

```csharp
                Label = company.TradeName ?? string.Empty,            // MUTATION
```

Predicted failure:
`Me_lists_every_business_this_login_belongs_to_oldest_membership_first` fails on the assertion
carrying *"a business with no trade name is labelled by its legal name"* — `should be "Zonneweide
Beheer <hex>" but was ""`. The `Memberships[1].TradeName` assertion above it stays green, because
that business was seeded WITH a trade name; only the nameless one moves.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~CurrentAccountMembershipsTests" > /tmp/pp-t3-mut2.txt 2>&1
```

Read it, confirm, restore `?? company.LegalName`, re-run green.

- [ ] **Step 11: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs \
        src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs \
        src/Hosts/PeakPower.Api.Customer/OpenApi/EnumWireValuesSchemaTransformer.cs \
        artifacts/openapi/customer.json \
        tests/PeakPower.Integration.Tests/Auth/CurrentAccountMembershipsTests.cs \
        tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json
git commit -m "Tell the shell which businesses this login can reach

CurrentAccountResponse gains membershipRole and memberships[], and all three
places that build it move together: SignInResponse.Account is the same record, so
a switcher fed only by /auth/me would show nothing until the shell made a second
call.

The list is one query over Customers, which is where trade_name lives - so it
returns anything at all only because task 1 widened both tenancy layers to the
membership arm. The explicit account predicate is not redundant with the query
filter: sign-in and refresh are anonymous, where every filter in this context
collapses to true.

membershipRole comes from ICustomerContext.Role on /auth/me and from the list on
the two anonymous routes, because those have no context to read. Both are the same
row, and the response asserts they agree.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Sign-in's landing rule, proven — the write-back and the named refusal (zero-memberships probe)

Design §5: *"**Sign-in** lands on `last_active_business_id` if still a member; else the **oldest**
membership by `created_at` — r2 said "any membership", which is nondeterministic and would land
someone in an arbitrary business to take audited actions in. An account with **zero** memberships
gets a named, terminal answer; that state has never existed and every entry point must handle it."*

⚠ **The rule itself is plan 1's and this task does not rewrite it.** Contract §13.2 gives
`AuthEndpoints.SelectBusinessAsync` **and** its no-business refusal to plan 1 — forced, because
dropping `customer_id` breaks sign-in inside plan 1 — and plan 1 already implements all three arms.
This task is the **proof** that the rule is the one design §5 asked for, plus the two things plan 1
does not do: writing the resolution back to `last_active_business_id`, and giving the refusal a
`type` so a client can act on it. Prerequisites check 7 stopped you if either of plan 1's members
was missing.

Three things worth stating before the code:

⚠ **"Oldest by `created_at`", not "first in the list I happened to get".** Plan 1's
`SelectBusinessAsync` orders by `CreatedAt`; `MembershipsOfAsync` orders by `JoinedAt` then
`CustomerId` (task 3). Those are two queries over the same rows and the tests below hold them to the
same answer. The test seeds the second business with a **1st of January 2020** membership so that
"oldest" and "first inserted" disagree; a fallback that took insertion order would land on the wrong
one and say so.

⚠ **`last_active_business_id` is a preference, not an authority.** It is checked **against the live
membership list**, never trusted on its own. A person removed from the business they last used must
land somewhere they can actually work, and the column may still name the business they were removed
from until this very sign-in rewrites it.

⚠ **Zero memberships is a state this platform has never had.** Before plan 1, `customer_id` was
`NOT NULL` on `customer_account` — every account belonged to exactly one company, always. Plan 4's
removal makes zero reachable for the first time. Plan 1 already refuses it rather than crashing;
what is still missing is the `type` that tells the portal *which* refusal this is, and the probe
that keeps the guard from being deleted. Step 7's mutation is that probe.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/SignInBusinessSelectionTests.cs`

⚠ `CustomerAccount.cs` is **not** in this list. `RecordActiveBusiness(Guid)` and
`LastActiveBusinessId` are plan 1's (contract §13.2) and this task only calls them; a second
declaration is `CS0111`.

**Interfaces:**
- Consumes: `AuthEndpoints.MembershipsOfAsync(PeakPowerDbContext, Guid, CancellationToken)` and
  `AuthEndpoints.SessionFor(CustomerAccount, Guid, IReadOnlyList<AccountMembershipDto>, AccessToken)`
  (task 3); `MembershipSeed.*` (task 2) and `MembershipRoleWire.*` (plan 1);
  **`AuthEndpoints.SelectBusinessAsync(PeakPowerDbContext, CustomerAccount, CancellationToken)`**
  and **`AuthEndpoints.NotAMemberOfAnyBusiness() -> IResult`** (plan 1, contract §13.2);
  **`CustomerAccount.RecordActiveBusiness(Guid)`** and `CustomerAccount.LastActiveBusinessId -> Guid?`
  (plan 1, contract §13.2);
  `ITokenIssuer.IssueAccessToken(CustomerAccount, Guid)` and
  `RefreshToken.Issue(Guid, Guid, string, DateTimeOffset, DateTimeOffset)` (plan 1).
- Produces:
  - `POST /api/v1/auth/sign-in` **writes its resolution back** to `last_active_business_id`, so the
    preference stops naming a business the person was removed from.
  - Plan 1's `AuthEndpoints.NotAMemberOfAnyBusiness()` gains
    `type: "https://peakpower.dev/problems/no-business-access"` — the same method, one field richer,
    **not a second refusal helper** (deviation D7).
  - The zero-memberships probe, and the three selection facts, as executable proof of plan 1's rule.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/SignInBusinessSelectionTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Domain.Customers;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Auth;

/// <summary>
/// Which business a sign-in lands in, and what happens when there is none.
/// </summary>
/// <remarks>
/// The last fact in this class is the shared contract §11 <b>zero-memberships</b> probe: *"Sign-in
/// with no memberships is a named answer, not a crash."* That state is new — before plan 1,
/// <c>customer_account.customer_id</c> was NOT NULL and every account belonged to exactly one
/// company — so nothing anywhere in this codebase has ever had to handle it.
/// </remarks>
public sealed class SignInBusinessSelectionTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Sign_in_lands_in_the_business_last_used()
    {
        var (email, account, first, second) = await TwoBusinessesAsync();

        await using (var owner = factory.CreateOwnerDbContext())
        {
            await MembershipSeed.SetLastActiveBusinessAsync(owner, account.Id, second, Ct);
        }

        var session = await SignInAsync(email);

        session.Account.CustomerId.ShouldBe(
            second,
            "decision 5: sign-in lands in the business last used. The preference column is the " +
            "first arm of the fallback and the only one that can name anything but the oldest.");

        // Both first and second are in the list, so the assertion above is about SELECTION rather
        // than about what the account can reach.
        session.Account.Memberships.Select(membership => membership.CustomerId).ToArray()
            .ShouldBe([first, second]);
    }

    [Fact]
    public async Task Sign_in_falls_back_to_the_oldest_membership_when_the_last_used_one_is_gone()
    {
        var (email, account, first, second) = await TwoBusinessesAsync();

        await using (var owner = factory.CreateOwnerDbContext())
        {
            // The preference still names the second business, and the membership behind it is
            // gone. This is exactly the state plan 4's removal leaves behind.
            await MembershipSeed.SetLastActiveBusinessAsync(owner, account.Id, second, Ct);
            await MembershipSeed.RemoveAsync(
                owner, account.Id, second,
                new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero), Ct);
        }

        var session = await SignInAsync(email);

        session.Account.CustomerId.ShouldBe(
            first,
            "last_active_business_id is a preference checked against the live membership list, " +
            "never an authority. Landing in the business somebody was removed from would give " +
            "them a token their very next request 401s on.");

        await using (var owner = factory.CreateOwnerDbContext())
        {
            (await MembershipSeed.LastActiveBusinessOfAsync(owner, account.Id, Ct)).ShouldBe(
                first,
                "the fallback is written back, or every future sign-in re-runs it and the " +
                "preference stays pointing at a business this person cannot use");
        }
    }

    /// <summary>
    /// "Oldest by <c>created_at</c>", not "first inserted" and not "any". The second business is
    /// joined in 2020 and the first is joined by the seeder a moment ago, so the two orderings
    /// disagree and only one of them lands on the 2020 row.
    /// </summary>
    [Fact]
    public async Task Sign_in_with_no_recorded_preference_lands_in_the_oldest_membership()
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Zonneweide Beheer {Guid.NewGuid():N}", MembershipSeed.FreshKvkNumber(), email, Password);

        Guid recent;
        Guid ancient;
        await using (var owner = factory.CreateOwnerDbContext())
        {
            recent = await MembershipSeed.OnlyBusinessOfAsync(owner, account.Id, Ct);
            ancient = await MembershipSeed.AddBusinessAsync(
                owner,
                account.Id,
                legalName: "Windkracht Noord B.V.",
                tradeName: "Windkracht",
                membershipRole: MembershipRoleWire.Trader,
                joinedAt: new DateTimeOffset(2020, 1, 1, 0, 0, 0, TimeSpan.Zero),
                cancellationToken: Ct);

            await MembershipSeed.SetLastActiveBusinessAsync(owner, account.Id, null, Ct);
        }

        var session = await SignInAsync(email);

        session.Account.CustomerId.ShouldBe(
            ancient,
            "the oldest membership by created_at, which is the 2020 one - not the one inserted " +
            "first, and not 'any', which would land somebody in an arbitrary business to take " +
            "audited actions in");
        session.Account.Memberships[0].CustomerId.ShouldBe(
            ancient,
            "memberships[] is ordered oldest-first, so the fallback is literally its first entry " +
            "and the two cannot drift apart");
        session.Account.Memberships[1].CustomerId.ShouldBe(recent);
    }

    /// <summary>
    /// Shared contract §11's <b>zero-memberships</b> probe.
    /// </summary>
    [Fact]
    public async Task Sign_in_with_no_live_membership_is_a_named_answer_and_not_a_crash()
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Zonneweide Beheer {Guid.NewGuid():N}", MembershipSeed.FreshKvkNumber(), email, Password);

        await using (var owner = factory.CreateOwnerDbContext())
        {
            var only = await MembershipSeed.OnlyBusinessOfAsync(owner, account.Id, Ct);
            await MembershipSeed.RemoveAsync(
                owner, account.Id, only,
                new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero), Ct);
        }

        var client = factory.CreateAnonymousClient();
        var response = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password), Ct);

        // Named FIRST, because "not a crash" is half the probe and a 500 would otherwise be
        // reported as "expected 401 but was 500" without saying why that matters.
        ((int)response.StatusCode).ShouldNotBe(
            500,
            "reaching the session builder with an empty membership list throws, and a person " +
            "whose access was withdrawn would be told the platform is broken");

        response.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await ProblemTypeOfAsync(response)).ShouldBe(
            "https://peakpower.dev/problems/no-business-access",
            "a NAMED answer: the credential was right and the client must say so rather than " +
            "asking the person to retype a correct password");

        response.Headers.Contains("Set-Cookie").ShouldBeFalse(
            "no session was created, so nothing may leave a refresh cookie behind");

        await using (var owner = factory.CreateOwnerDbContext())
        {
            (await owner.RefreshTokens.CountAsync(
                token => token.CustomerAccountId == account.Id, Ct)).ShouldBe(
                0,
                "the refusal happens before anything is written; a stored refresh token would be " +
                "a session for a business that does not exist");
        }
    }

    /// <summary>
    /// The other half: adding a named refusal must not have made a wrong password distinguishable
    /// from an unknown username. Those two stay byte-identical, and the new answer is reachable
    /// only AFTER the Argon2id verification has already succeeded.
    /// </summary>
    [Fact]
    public async Task A_wrong_password_and_an_unknown_username_still_answer_identically()
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        await factory.SeedCustomerWithAccountAsync(
            $"Zonneweide Beheer {Guid.NewGuid():N}", MembershipSeed.FreshKvkNumber(), email, Password);

        var client = factory.CreateAnonymousClient();

        var wrongPassword = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, "nope-nope-nope"), Ct);
        var unknownUser = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest("nobody@example.nl", "nope-nope-nope"), Ct);

        unknownUser.StatusCode.ShouldBe(wrongPassword.StatusCode);
        (await unknownUser.Content.ReadAsStringAsync(Ct))
            .ShouldBe(await wrongPassword.Content.ReadAsStringAsync(Ct));

        (await ProblemTypeOfAsync(wrongPassword)).ShouldBe(
            "https://peakpower.dev/problems/sign-in-failed",
            "the no-business-access answer must be a THIRD answer, not a replacement for this one");
    }

    private async Task<(string Email, PeakPower.Domain.Customers.CustomerAccount Account, Guid First, Guid Second)>
        TwoBusinessesAsync()
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Zonneweide Beheer {Guid.NewGuid():N}", MembershipSeed.FreshKvkNumber(), email, Password);

        await using var owner = factory.CreateOwnerDbContext();

        var first = await MembershipSeed.OnlyBusinessOfAsync(owner, account.Id, Ct);
        var second = await MembershipSeed.AddBusinessAsync(
            owner,
            account.Id,
            legalName: "Windkracht Noord B.V.",
            tradeName: "Windkracht",
            membershipRole: MembershipRoleWire.Trader,
            joinedAt: new DateTimeOffset(2026, 6, 1, 9, 0, 0, TimeSpan.Zero),
            cancellationToken: Ct);

        return (email, account, first, second);
    }

    private async Task<SignInResponse> SignInAsync(string email)
    {
        var client = factory.CreateAnonymousClient();
        var response = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password), Ct);

        response.StatusCode.ShouldBe(
            HttpStatusCode.OK,
            $"the arrangement itself must hold: {await response.Content.ReadAsStringAsync(Ct)}");

        return (await response.Content.ReadFromJsonAsync<SignInResponse>(Ct))!;
    }

    private static async Task<string?> ProblemTypeOfAsync(HttpResponseMessage response)
    {
        var payload = await response.Content.ReadAsStringAsync(Ct);
        using var document = JsonDocument.Parse(payload);
        return document.RootElement.TryGetProperty("type", out var type) ? type.GetString() : null;
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~SignInBusinessSelectionTests" > /tmp/pp-t4-red.txt 2>&1
```

Read `/tmp/pp-t4-red.txt`. Plan 1's selection rule is already in place and already correct, so most
of this class goes green on the first run. **Exactly two assertions must be red**, and they are the
two things plan 1 does not do:

- `Sign_in_falls_back_to_the_oldest_membership_when_the_last_used_one_is_gone` FAILS on its **last**
  assertion — *"should be <first> but was <second>"* — with the message *"the fallback is written
  back, or every future sign-in re-runs it"*. Its `CustomerId` assertion PASSES: plan 1 already
  checks the preference against the live list. What is missing is step 3's write-back.
- `Sign_in_with_no_live_membership_is_a_named_answer_and_not_a_crash` FAILS on the `type` assertion
  — *"should be "https://peakpower.dev/problems/no-business-access" but was null"* — with the
  message *"a NAMED answer"*. Its 500-guard, its 401, its no-`Set-Cookie` and its zero-refresh-token
  assertions all PASS, because plan 1's `NotAMemberOfAnyBusiness()` already refuses rather than
  crashing. What is missing is step 4's `type`.

- `Sign_in_lands_in_the_business_last_used`,
  `Sign_in_with_no_recorded_preference_lands_in_the_oldest_membership` and
  `A_wrong_password_and_an_unknown_username_still_answer_identically` PASS.

⚠ **If any of those three is red, stop.** A red `..._lands_in_the_oldest_membership` means plan 1's
`SelectBusinessAsync` is not ordering by `created_at`; a red `..._lands_in_the_business_last_used`
means it is not consulting `last_active_business_id`; a 500 on the zero-membership fact means plan
1's guard is missing. Each is a plan 1 defect and is fixed there, not by writing a second rule here.

⚠ **Three of the five facts being green at "red" is expected and is the point.** They are the
executable proof that plan 1 shipped design §5's rule and not a near-miss — the seam this plan would
otherwise take on trust — and steps 6 and 7 mutate plan 1's own code to earn them.

- [ ] **Step 3: Write the resolution back — the one thing plan 1's selection does not do**

⚠ **No selection rule is written here.** `AuthEndpoints.SelectBusinessAsync` and
`AuthEndpoints.NotAMemberOfAnyBusiness()` are plan 1's (contract §13.2), and plan 1 already
implements design §5 in full: `last_active_business_id` when it still names a live membership, else
the **oldest** by `created_at`, else `null` and the refusal. A second rule here is exactly the
silent behaviour fork §13.2 exists to prevent — two answers to *"which business does a sign-in land
in"*, diverging the first time either is edited.

After plan 1, and after task 3 step 6 routed the response through `SessionFor`, the `/sign-in`
handler reads:

```csharp
                throttle.RecordSuccess(username, source);

                var memberships = await MembershipsOfAsync(db, account.Id, cancellationToken);

                var now = calendar.UtcNow;
                account.RecordSuccessfulSignIn(now);

                var membership = await SelectBusinessAsync(db, account, cancellationToken);
                if (membership is null)
                {
                    return NotAMemberOfAnyBusiness();
                }

                var activeCustomerId = membership.CustomerId;

                var access = tokens.IssueAccessToken(account, activeCustomerId);
```

⚠ Plan 1's replacement is anchored on the `var access = …` line, so `now` and
`RecordSuccessfulSignIn` stay **above** the selection. Read the file rather than trusting the order
above; what matters for this step is only that the insert lands where `activeCustomerId` is already
in scope.

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`,
insert **exactly one statement**, immediately after `var activeCustomerId = membership.CustomerId;`
— which is after `activeCustomerId` exists and before `db.SaveChangesAsync(cancellationToken)`:

```csharp
                // Write plan 1's resolution back. SelectBusinessAsync READS
                // last_active_business_id and never updates it, so without this line an account
                // whose preference names a business it was removed from re-runs the fallback on
                // every sign-in for ever and "the business last used" quietly stops meaning
                // anything. RecordActiveBusiness is plan 1's mutator (contract section 13.2) and is
                // deliberately the one mutator on CustomerAccount that does NOT bump the security
                // stamp: bumping here would kill the access token this very response is issuing.
                account.RecordActiveBusiness(activeCustomerId);
```

`account` is tracked by the same `db` that `SaveChangesAsync` is already called on further down, so
no extra save is needed. Sign-in is anonymous and runs on the owner connection, so the
column-scoped `UPDATE (last_active_business_id)` grant of contract §5.3 is not what carries this
write — that grant is for task 6's authenticated switch.

⚠ If plan 1 inlined `membership.CustomerId` at its call sites instead of naming `activeCustomerId`,
task 3 step 6 already hoisted it into a local; pass that local here. If plan 1's
`SelectBusinessAsync` returns something other than `CustomerMembership?`, take the customer id off
whatever it returns — do **not** re-derive the selection.

- [ ] **Step 4: Give plan 1's refusal its `type`**

Plan 1 ships the refusal as a bare `ProblemDetails` — a title, a detail, a 401 and **no `type`**.
Design §5 asks for a *named* answer and the portal switches on `type`, so this task adds that one
field to **that one method**. It does **not** add a second refusal helper: a
`NoBusinessToSignInTo()` beside plan 1's `NotAMemberOfAnyBusiness()` would be two documents for one
refusal, only one of which the handler ever returns, and the other would rot. Deviation D7 records
this split of ownership.

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`,
plan 1's helper sits beside `SignInFailed()` (today at `:486-500`) and reads:

```csharp
    private static IResult NotAMemberOfAnyBusiness() =>
        Results.Json(
            new Microsoft.AspNetCore.Mvc.ProblemDetails
            {
                Status = StatusCodes.Status401Unauthorized,
                Title = "Not signed in",
                Detail = "This account is not a member of any business.",
            },
            statusCode: StatusCodes.Status401Unauthorized,
            contentType: "application/problem+json");
```

Replace it with the same method carrying the `type` and the remarks that say why this answer is
allowed to be distinguishable at all:

```csharp
    /// <summary>
    /// Zero active memberships. Distinguishable from a wrong password on purpose - the credential
    /// was right - and identical for "removed from your last business" and "never invited into
    /// one", because those differ by nothing the caller may learn.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The <c>type</c> is what makes it a NAMED answer</b> rather than a second anonymous 401.
    /// Design §5 requires one, and the reason is a person, not a protocol: somebody whose access
    /// was withdrawn while they were away would otherwise be told their password is wrong and would
    /// retype a correct password until they were throttled. The portal reads this URI and says what
    /// actually happened.
    /// </para>
    /// <para>
    /// <b>It reopens no enumeration oracle.</b> Every branch that can reach it has already completed
    /// the Argon2id verification against a real stored hash for an ACTIVE account - whoever sees
    /// this answer proved they hold the credential. The wrong-password and unknown-username answers
    /// stay byte-identical to each other, which is what
    /// <c>SignInBusinessSelectionTests.A_wrong_password_and_an_unknown_username_still_answer_identically</c>
    /// holds.
    /// </para>
    /// <para>
    /// <b>401 and never 403.</b> <c>TenancyArchitectureTests.no_type_produces_a_forbidden_response</c>
    /// scans compiled IL for the Int32 constant 403 however it was spelled, because [F13-R19] makes
    /// a 403 an existence oracle. Keeping the status at 401 also leaves
    /// <c>CustomerResponseMetadataTests.ExpectedResponseContract</c>'s line for this route
    /// unchanged: the route already declares one 401 and this is another body for it.
    /// </para>
    /// </remarks>
    private static IResult NotAMemberOfAnyBusiness() =>
        Results.Json(
            new Microsoft.AspNetCore.Mvc.ProblemDetails
            {
                Type = "https://peakpower.dev/problems/no-business-access",
                Status = StatusCodes.Status401Unauthorized,
                Title = "Not signed in",
                Detail = "This account is not a member of any business.",
            },
            statusCode: StatusCodes.Status401Unauthorized,
            contentType: "application/problem+json");
```

⚠ **Change the `Type` and the remarks only.** The title, the detail, the status and the call sites
are plan 1's and stay as they are; contract §13.2 gives plan 1 the document and this is the one
field D7 hands to task 4. If plan 1 already set a `Type`, take **plan 1's URI** and correct this
plan's test instead — a URI that differs between the handler and the portal is worse than either
spelling.

- [ ] **Step 5: Build and run**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror > /tmp/pp-t4-build.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~SignInBusinessSelectionTests" > /tmp/pp-t4-green.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~SignIn" > /tmp/pp-t4-signin.txt 2>&1
dotnet test PeakPower.sln --nologo > /tmp/pp-t4-all.txt 2>&1
```

Read all four. Expected: build clean; every test PASSES, including the pre-existing `SignInTests`,
`SignInConstantWorkTests`, `SecurityStampTests`, `RefreshRotationTests` and `SignOutTests`.

⚠ `SignInConstantWorkTests.An_unknown_username_costs_the_same_argon2id_work_as_a_real_one` counts
Argon2id derivations, and the new branch runs strictly **after** the verification, so the count is
unchanged. If it moved, the membership query was put before the hash comparison.

- [ ] **Step 6: Mutate the preference — prove the first arm exists**

In **plan 1's** `SelectBusinessAsync` — the same file — drop the preference arm from its return:

```csharp
        return active.FirstOrDefault();                                  // MUTATION
```

Predicted failure: `Sign_in_lands_in_the_business_last_used` fails with *"should be <second> but was
<first>"* and the message *"decision 5: sign-in lands in the business last used"*. The three other
selection facts stay green, which is the point — only one of them is about the preference, and the
write-back added in step 3 still writes whatever the (now wrong) rule resolved.

⚠ That method is plan 1's and is not this plan's to change. Mutate it, watch it bite, restore it,
and prove the restore below — it must be byte-identical to `HEAD` before step 8 commits.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~SignInBusinessSelectionTests" > /tmp/pp-t4-mut1.txt 2>&1
```

Read it, confirm, restore both arms, re-run green.

- [ ] **Step 7: Mutate the refusal — prove the zero-memberships probe bites**

Delete plan 1's guard in the `/sign-in` handler:

```csharp
                // if (membership is null)
                // {
                //     return NotAMemberOfAnyBusiness();
                // }
                var activeCustomerId = membership!.CustomerId;           // MUTATION
```

Predicted failure:
`Sign_in_with_no_live_membership_is_a_named_answer_and_not_a_crash` fails on its **first** assertion
— *"should not be 500 but was 500"* — with the message *"reaching the session builder with an empty
membership list throws, and a person whose access was withdrawn would be told the platform is
broken"*. The 500 comes out of `NullReferenceException` on `membership!`, or out of `RoleIn`'s
`InvalidOperationException` if you mutated further down; either is the crash the probe is named
after — and it is the reason this probe stays in plan 2 even though plan 1 wrote the guard.

⚠ Also a mutation of plan 1's code. Restore it and prove the restore below.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~SignInBusinessSelectionTests" > /tmp/pp-t4-mut2.txt 2>&1
```

Read it, confirm, restore the guard, re-run green, then:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git diff src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs > /tmp/pp-t4-restored.txt 2>&1
git diff --stat src/Core/PeakPower.Domain/Customers/CustomerAccount.cs \
    >> /tmp/pp-t4-restored.txt 2>&1
```

Read it. The only changes against `HEAD` in `AuthEndpoints.cs` are step 3's single
`account.RecordActiveBusiness(activeCustomerId);` line and step 4's `Type` plus remarks — plan 1's
`SelectBusinessAsync` body and the sign-in guard must be back exactly as they were. The
`CustomerAccount.cs` diff must be **empty**: this task does not modify that file.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs \
        tests/PeakPower.Integration.Tests/Auth/SignInBusinessSelectionTests.cs
git commit -m "Write sign-in's landing back, and name the refusal it already had

Plan 1 owns the rule - last_active_business_id if it still names a live membership,
else the OLDEST membership by created_at, else a refusal - and this changes none of
it. What it adds is the write-back plan 1 does not do: SelectBusinessAsync only
READS the preference, so without it an account whose preference names a business it
was removed from re-runs the fallback for ever and 'the business last used' stops
meaning anything.

The refusal gains a type - no-business-access - so the portal can say what happened
instead of sending somebody to reset a password that is fine. Same method, one
field: a second refusal helper would be two documents for one answer. Still 401 and
never 403, and still reachable only after the Argon2id verification has succeeded,
so a wrong password and an unknown username stay byte-identical to each other.

Five facts hold the seam: the preference arm, the oldest-by-created_at arm with a
2020 membership so 'oldest' and 'first inserted' disagree, the write-back, the
shared contract's zero-memberships probe, and the constant-work pair. The two
mutations break plan 1's own selection and its guard, because a seam this plan
consumes is a seam this plan has to prove.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Refresh terminates instead of looping (refresh-termination probe)

Design §5: *"**Refresh re-proves membership.** Otherwise a removed member loops: request 401s,
client refreshes, refresh re-mints for the business they were removed from, 401s again — the loop
the API contract explicitly warns about. Finding no membership, refresh fails with a **distinct
terminal signal** that makes the client sign out rather than retry."*

Task 3 already put the proof in the handler and answered it with the ordinary
`RefreshRejected(response)`, which is loop-free but indistinguishable from six other refusals. This
task makes it the distinct signal, revokes the presented row so a second presentation is terminal
by two mechanisms rather than one, and proves both — plus the half that is easy to lose: **a removal
in one business must not disturb this person's session in another.**

⚠ **The proof sits before the replay branch, not after it.** `RefreshAsync` has two exits that mint
an access token: the racing-tab grace window (`stored.UsedAt is { } usedAt` and inside
`RefreshReuseGrace`) and the ordinary rotation at the end. A membership check placed after the first
would hand a removed member a fifteen-minute token whenever they happened to open a second tab.
Task 3 placed it immediately after the `account` read for exactly that reason and this task does not
move it.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/RefreshMembershipTests.cs`

**Interfaces:**
- Consumes: `AuthEndpoints.MembershipsOfAsync` (task 3); `MembershipSeed.*` (task 2);
  `RefreshToken.CustomerId`, `.Revoke(DateTimeOffset)`, `.RevokedAt` (plan 1 / existing);
  `OpaqueToken.HashOf(string)`; `RefreshCookie.Name`.
- Produces: `AuthEndpoints.MembershipRevoked(HttpResponse) -> IResult` (private) — 401,
  `type: "https://peakpower.dev/problems/membership-revoked"`, clears `pp_refresh`.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/RefreshMembershipTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using PeakPower.Api.Customer.Auth;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Identity;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Auth;

/// <summary>
/// Shared contract §11's <b>refresh-termination</b> probe: *"Refresh after removal terminates
/// rather than looping."*
/// </summary>
/// <remarks>
/// <para>
/// The loop this prevents is the one the API contract warns about by name: the access token 401s
/// because the middleware finds no membership, the client refreshes, refresh re-mints for the same
/// business, and the next request 401s again — for ever, and silently, because every step of it
/// looks like an ordinary expiry.
/// </para>
/// <para>
/// <b>Cookies are driven by hand here</b>, exactly as <c>RefreshRotationTests</c> does and for the
/// same reason: the refresh cookie is written <c>Secure</c> and <see cref="System.Net.CookieContainer"/>
/// will not replay a Secure cookie over the <c>http://localhost</c> the test server speaks, so an
/// automatic container would send nothing and every case below would be "rejected" for the wrong
/// reason.
/// </para>
/// </remarks>
public sealed class RefreshMembershipTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    /// <summary>
    /// The control. Without it, every assertion below would pass just as cleanly against a refresh
    /// endpoint that had stopped working altogether.
    /// </summary>
    [Fact]
    public async Task Refresh_rotates_normally_while_the_membership_is_live()
    {
        var seeded = await SignedInAsync();

        var response = await RefreshAsync(seeded.Client, seeded.Refresh);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await response.Content.ReadFromJsonAsync<SignInResponse>(Ct);
        body!.Account.CustomerId.ShouldBe(seeded.BusinessId,
            "a refresh re-mints for the business the presented token belongs to, and for no other");
        RefreshCookieOf(response).ShouldNotBe(seeded.Refresh, "rotation means the old token is spent");
    }

    [Fact]
    public async Task Refresh_after_removal_terminates_with_a_signal_of_its_own()
    {
        var seeded = await SignedInAsync();

        await using (var owner = factory.CreateOwnerDbContext())
        {
            await MembershipSeed.RemoveAsync(
                owner, seeded.AccountId, seeded.BusinessId,
                new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero), Ct);
        }

        var response = await RefreshAsync(seeded.Client, seeded.Refresh);

        response.StatusCode.ShouldBe(
            HttpStatusCode.Unauthorized,
            "a refresh that re-minted here would put the client straight back into the loop: the " +
            "new access token 401s on its very next request, because the middleware finds no " +
            "membership either");

        (await ProblemTypeOfAsync(response)).ShouldBe(
            "https://peakpower.dev/problems/membership-revoked",
            "DISTINCT from the session-expired answer every other refusal on this route gives. " +
            "The client has to sign out rather than retry, and it can only tell the two apart by " +
            "the type.");

        // The cookie goes, so a client that ignores the body still stops sending a credential that
        // can never be honoured again.
        response.Headers.GetValues("Set-Cookie")
            .ShouldContain(
                value => value.StartsWith("pp_refresh=;", StringComparison.Ordinal),
                "the refusal clears the refresh cookie");

        await using (var owner = factory.CreateOwnerDbContext())
        {
            var hash = OpaqueToken.HashOf(seeded.Refresh);
            var row = await owner.RefreshTokens.SingleAsync(token => token.TokenHash == hash, Ct);

            row.RevokedAt.ShouldNotBeNull(
                "the presented row is revoked as well as refused, so the answer stays terminal " +
                "even if the membership were restored a second later");
        }
    }

    [Fact]
    public async Task Refresh_after_removal_answers_the_same_way_the_second_time()
    {
        var seeded = await SignedInAsync();

        await using (var owner = factory.CreateOwnerDbContext())
        {
            await MembershipSeed.RemoveAsync(
                owner, seeded.AccountId, seeded.BusinessId,
                new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero), Ct);
        }

        var first = await RefreshAsync(seeded.Client, seeded.Refresh);
        var second = await RefreshAsync(seeded.Client, seeded.Refresh);

        first.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        second.StatusCode.ShouldBe(
            HttpStatusCode.Unauthorized,
            "terminal means terminal: a client that retries gets the same answer rather than " +
            "being escalated into the theft response, which would bump the security stamp and " +
            "sign this person out of the businesses they ARE still a member of");

        (await ProblemTypeOfAsync(second)).ShouldBe(
            "https://peakpower.dev/problems/membership-revoked",
            "the same signal, not the generic one - the membership proof runs before the replay " +
            "branch, so revoking the row in the first call does not reroute the second");
    }

    /// <summary>
    /// The half that is easy to lose: removal from one business must not touch this person's
    /// session in another. Two sign-ins, two refresh chains, one removal.
    /// </summary>
    [Fact]
    public async Task A_removal_in_one_business_leaves_the_session_in_another_alone()
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Zonneweide Beheer {Guid.NewGuid():N}", MembershipSeed.FreshKvkNumber(), email, Password);

        Guid first;
        Guid second;
        await using (var owner = factory.CreateOwnerDbContext())
        {
            first = await MembershipSeed.OnlyBusinessOfAsync(owner, account.Id, Ct);
            second = await MembershipSeed.AddBusinessAsync(
                owner, account.Id, "Windkracht Noord B.V.", "Windkracht", MembershipRoleWire.Trader,
                new DateTimeOffset(2026, 6, 1, 9, 0, 0, TimeSpan.Zero), Ct);

            await MembershipSeed.SetLastActiveBusinessAsync(owner, account.Id, first, Ct);
        }

        var inFirst = await SignInAsync(email);
        inFirst.CustomerId.ShouldBe(first, "the arrangement itself must hold");

        await using (var owner = factory.CreateOwnerDbContext())
        {
            await MembershipSeed.SetLastActiveBusinessAsync(owner, account.Id, second, Ct);
        }

        var inSecond = await SignInAsync(email);
        inSecond.CustomerId.ShouldBe(second, "the arrangement itself must hold");

        await using (var owner = factory.CreateOwnerDbContext())
        {
            await MembershipSeed.RemoveAsync(
                owner, account.Id, second,
                new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero), Ct);
        }

        var refusedInSecond = await RefreshAsync(inSecond.Client, inSecond.Refresh);
        refusedInSecond.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
        (await ProblemTypeOfAsync(refusedInSecond))
            .ShouldBe("https://peakpower.dev/problems/membership-revoked");

        var survivesInFirst = await RefreshAsync(inFirst.Client, inFirst.Refresh);
        survivesInFirst.StatusCode.ShouldBe(
            HttpStatusCode.OK,
            "the refresh chain for the OTHER business belongs to the same account and must be " +
            "untouched. A handler that revoked the whole chain here would sign somebody out of " +
            "the company they still work for because they left a different one.");

        var body = await survivesInFirst.Content.ReadFromJsonAsync<SignInResponse>(Ct);
        body!.Account.CustomerId.ShouldBe(first);
        body.Account.Memberships.Select(membership => membership.CustomerId).ToArray().ShouldBe(
            [first],
            "and the surviving session's own membership list has caught up with the removal");
    }

    private sealed record Session(HttpClient Client, string Refresh, Guid AccountId, Guid CustomerId)
    {
        public Guid BusinessId => CustomerId;
    }

    private async Task<Session> SignedInAsync()
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        await factory.SeedCustomerWithAccountAsync(
            $"Zonneweide Beheer {Guid.NewGuid():N}", MembershipSeed.FreshKvkNumber(), email, Password);

        return await SignInAsync(email);
    }

    private async Task<Session> SignInAsync(string email)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = false,
        });

        var response = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password), Ct);
        response.StatusCode.ShouldBe(
            HttpStatusCode.OK,
            $"the arrangement itself must hold: {await response.Content.ReadAsStringAsync(Ct)}");

        var body = await response.Content.ReadFromJsonAsync<SignInResponse>(Ct);

        return new Session(
            client,
            RefreshCookieOf(response),
            body!.Account.AccountId,
            body.Account.CustomerId);
    }

    private Task<HttpResponseMessage> RefreshAsync(HttpClient client, string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/refresh");
        request.Headers.Add("Cookie", $"{RefreshCookie.Name}={token}");
        return client.SendAsync(request, Ct);
    }

    private static string RefreshCookieOf(HttpResponseMessage response) =>
        response.Headers.GetValues("Set-Cookie")
            .Single(value => value.StartsWith($"{RefreshCookie.Name}=", StringComparison.Ordinal))
            .Split(';')[0][$"{RefreshCookie.Name}=".Length..];

    private static async Task<string?> ProblemTypeOfAsync(HttpResponseMessage response)
    {
        var payload = await response.Content.ReadAsStringAsync(Ct);
        using var document = JsonDocument.Parse(payload);
        return document.RootElement.TryGetProperty("type", out var type) ? type.GetString() : null;
    }
}
```

⚠ `RefreshCookieOf` on the terminal answer would find the **clearing** cookie
(`pp_refresh=; expires=…`), which is why the tests above read `Set-Cookie` directly for that case
rather than through the helper.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~RefreshMembershipTests" > /tmp/pp-t5-red.txt 2>&1
```

Read `/tmp/pp-t5-red.txt`. Expected:

- `Refresh_rotates_normally_while_the_membership_is_live` PASSES — that is the control and it
  already worked.
- `Refresh_after_removal_terminates_with_a_signal_of_its_own` FAILS on the **type** assertion —
  *"should be "https://peakpower.dev/problems/membership-revoked" but was
  "https://peakpower.dev/problems/session-expired""* — because task 3 answered with the ordinary
  refusal. The status assertion above it passes, and the `RevokedAt` assertion is not reached.
- `Refresh_after_removal_answers_the_same_way_the_second_time` FAILS on the same type assertion.
- `A_removal_in_one_business_leaves_the_session_in_another_alone` FAILS on the type assertion for
  the removed business, and its surviving-session half passes.

- [ ] **Step 3: Make the refusal terminal and name it**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`,
replace the block task 3 step 6 inserted into `RefreshAsync` — which reads:

```csharp
        // Task 5 replaces this with the distinct terminal signal design §5 requires. A plain
        // rejection is already correct behaviour - the client cannot refresh past a 401 and signs
        // out - and it is what stops this task shipping a handler that mints a session for a
        // business the account was removed from, or throws out of RoleIn trying.
        if (account is not null
            && !memberships.Any(membership => membership.CustomerId == stored.CustomerId))
        {
            return RefreshRejected(response);
        }
```

with:

```csharp
        // Refresh RE-PROVES membership, and this is the whole reason it does.
        //
        // Without it a removed member loops: the access token 401s because the middleware finds no
        // membership row, the client refreshes, refresh happily re-mints for the SAME business, and
        // the next request 401s again - for ever, and silently, because every step of it looks like
        // an ordinary expiry.
        //
        // The proof sits HERE, before the replay branch below, on purpose. RefreshAsync has two
        // exits that mint an access token, and the other one is the racing-tab grace window; a
        // check placed after it would hand a removed member a fifteen-minute token whenever they
        // happened to have a second tab open.
        //
        // Revoked as well as refused. The revocation is not what makes the answer terminal - the
        // membership proof above already is, and it runs first on every subsequent presentation -
        // it is what makes the row stop being a live credential the moment we have decided it will
        // never be honoured again. Only the PRESENTED row: revoking the whole chain would sign this
        // person out of the businesses they are still a member of, which is the opposite of what
        // design §5 asks for.
        if (account is not null
            && !memberships.Any(membership => membership.CustomerId == stored.CustomerId))
        {
            stored.Revoke(now);
            await db.SaveChangesAsync(cancellationToken);
            return MembershipRevoked(response);
        }
```

Then add, immediately after `RefreshRejected` (today at `:409-424`):

```csharp
    /// <summary>
    /// This refresh chain belongs to a business this account is no longer a member of. Terminal:
    /// the client must sign out, not retry.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Distinct from <see cref="RefreshRejected"/> on purpose.</b> That method deliberately
    /// answers every other refusal — no cookie, unknown token, expired, revoked, replayed outside
    /// the grace window, inactive account — with one body, because none of them is worth telling
    /// apart and several would be an oracle if they were. This one is different in kind: it is the
    /// only refusal a client should react to by ending the session and saying WHY, and design §5
    /// requires it by name as *"a distinct terminal signal that makes the client sign out rather
    /// than retry"*.
    /// </para>
    /// <para>
    /// <b>It is not an oracle.</b> Reaching it requires presenting a refresh token this database
    /// says belongs to this account. Whoever sees it already had the session.
    /// </para>
    /// <para>
    /// The cookie is cleared for the same reason <see cref="RefreshRejected"/> clears it: a client
    /// holding a credential we will not honour should stop sending it rather than paying for a
    /// round trip that can only ever fail. Clearing goes through <see cref="RefreshCookie"/> so the
    /// name, path and flags are written in exactly one place.
    /// </para>
    /// </remarks>
    private static IResult MembershipRevoked(HttpResponse response)
    {
        RefreshCookie.Clear(response);
        return Results.Problem(
            type: "https://peakpower.dev/problems/membership-revoked",
            title: "No longer a member",
            detail: "Your access to this business has ended. Sign in again.",
            statusCode: StatusCodes.Status401Unauthorized);
    }
```

- [ ] **Step 4: Build and run**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror > /tmp/pp-t5-build.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~RefreshMembershipTests" > /tmp/pp-t5-green.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~RefreshRotationTests" > /tmp/pp-t5-rotation.txt 2>&1
dotnet test PeakPower.sln --nologo > /tmp/pp-t5-all.txt 2>&1
```

Read all four. Expected: build clean; every test PASSES.

⚠ `RefreshRotationTests` is the class that owns the grace window, the replay/theft response and the
security-stamp bump. Nothing in it seeds a removal, so every one of its cases keeps the membership
it signed in with and takes the same path it always did. If any of it went red, the proof was
placed somewhere it changes an existing decision — most likely below the `stored.UsedAt` branch
rather than above it.

- [ ] **Step 5: Mutate the proof — prove refresh would otherwise loop**

Delete the whole `if (account is not null && !memberships.Any(...))` block from `RefreshAsync`.

Predicted failure: `Refresh_after_removal_terminates_with_a_signal_of_its_own` fails on its **first**
assertion — *"should be Unauthorized but was OK"* — with the message *"a refresh that re-minted here
would put the client straight back into the loop"*. `Refresh_after_removal_answers_the_same_way_the_second_time`
fails the same way, and `A_removal_in_one_business_leaves_the_session_in_another_alone` fails on the
removed business's refusal. The control, `Refresh_rotates_normally_while_the_membership_is_live`,
stays green — which is what tells you the mutation removed the proof rather than breaking refresh.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~RefreshMembershipTests" > /tmp/pp-t5-mut1.txt 2>&1
```

Read it, confirm, restore the block, re-run green.

- [ ] **Step 6: Mutate the blast radius — prove only the presented row is revoked**

Change the revocation to take the whole chain:

```csharp
        if (account is not null
            && !memberships.Any(membership => membership.CustomerId == stored.CustomerId))
        {
            await EndEverySessionAsync(                                    // MUTATION
                db, account, stored.CustomerAccountId, now, cancellationToken);
            return MembershipRevoked(response);
        }
```

Predicted failure: `A_removal_in_one_business_leaves_the_session_in_another_alone` fails on
*"should be OK but was Unauthorized"* with the message *"the refresh chain for the OTHER business
belongs to the same account and must be untouched. A handler that revoked the whole chain here
would sign somebody out of the company they still work for because they left a different one."*
`EndEverySessionAsync` also bumps the security stamp, so the surviving session's **access** token
dies as well — this mutation is the exact over-reach the assertion exists to catch.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~RefreshMembershipTests" > /tmp/pp-t5-mut2.txt 2>&1
```

Read it, confirm, restore `stored.Revoke(now); await db.SaveChangesAsync(cancellationToken);`,
re-run green, then:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git diff --stat src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs > /tmp/pp-t5-restored.txt 2>&1
```

Read it: the only changes against `HEAD` are step 3's.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs \
        tests/PeakPower.Integration.Tests/Auth/RefreshMembershipTests.cs
git commit -m "Make a refresh after removal terminal instead of a loop

The loop is the one the API contract warns about by name: the access token 401s
because the middleware finds no membership, the client refreshes, refresh re-mints
for the same business, and the next request 401s again - silently, because every
step of it looks like an ordinary expiry. Refresh now re-proves membership, and
answers with a type of its own so a client can tell 'sign out' from 'try again'.

The proof sits above the replay branch, because the other exit that mints an
access token is the racing-tab grace window and a check below it would hand a
removed member a token whenever they had a second tab open. Only the presented row
is revoked: revoking the chain would also bump the security stamp and sign this
person out of the company they still work for, which the fourth test in this class
holds by name.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `POST /api/v1/auth/active-business` — the switch is a new session, never a flag

Design §5: *"`POST /api/v1/auth/active-business { customerId }` verifies membership, rotates the
refresh token to the new business, writes `last_active_business_id`, re-mints. A switch is never a
client-side flag."*

Four things about this handler are load-bearing, and three of them are not in either document
because neither works through what the database will actually accept:

⚠ **It re-declares `app.customer_id` mid-request.** After plan 1, `customer.refresh_token` is
policed by the uniform `customer_id = app.customer_id` pair (shared contract §5.2). The row this
handler inserts names the **new** business while `CustomerSessionMiddleware` scoped the transaction
to the **old** one, so the `WITH CHECK` arm refuses it. One extra
`SELECT set_config('app.customer_id', $1, true)`, after the membership proof and before any write,
is what makes the write legal — and it is the honest statement of what this endpoint does. It goes
through a new helper in `PeakPower.Infrastructure.Web.Tenancy`, beside the middleware that sets the
same GUC, so the house rule (`set_config`, parameterised, never `SET LOCAL`) is written in one more
place and not invented in a handler.

⚠ **Layer 1 does not move with it.** `ICustomerContext.CustomerId` still reads the old business out
of the unchanged JWT for the rest of the request. That is safe here and only here, because after
the re-scope this handler touches exactly two filtered tables and both pass under either value:
`customer_account` (through a membership this account holds in *both* businesses) and
`refresh_token` (which carries no EF filter at all — it is on
`QueryFilterModelTests.ExemptEntityTypes`). The handler's own comment says so and says not to add a
third.

⚠ **"Rotates the refresh token" cannot mean the presented one.** `RefreshCookie.Path` is
`/api/v1/auth/refresh`, so a browser never attaches `pp_refresh` here — the same asymmetry
`SignOutAsync` records. This handler therefore issues a **new** refresh token bound to the new
business and overwrites the cookie, and marks nothing used and revokes nothing. See deviation D3 for
why each alternative is worse.

⚠ **No security-stamp bump anywhere.** Bumping would kill the access token this very response is
about to replace, and every other device's with it.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/ActiveBusinessScope.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleBodies.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/CustomerApiRouteTableTests.cs:63-108`, `:306-344`, `:574-590`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract/CustomerResponseMetadataTests.cs:49-56`
- Modify (regenerated): `artifacts/openapi/customer.json`
- Modify (re-accepted): `.../Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/ActiveBusinessTests.cs`

**Interfaces:**
- Consumes: `AuthEndpoints.MembershipsOfAsync` and `.SessionFor` (task 3);
  `CustomerAccount.RecordActiveBusiness(Guid)` (**plan 1**, contract §13.2 — task 4 is another
  caller of it, not its author); `MembershipSeed.*` (task 2);
  `ICustomerContext.AccountId`, `.CustomerId`, `.Role` (plan 1);
  `ITokenIssuer.IssueAccessToken(CustomerAccount, Guid)`, `.IssueRefreshToken(Guid, out DateTimeOffset)`;
  `RefreshToken.Issue(Guid, Guid, string, DateTimeOffset, DateTimeOffset)` (plan 1);
  `ApiResults.InvalidRequest(string, string)`, `ApiResults.NotFound()`;
  `RefreshCookie.Write(HttpResponse, string, DateTimeOffset)`.
- Produces:
  - `PeakPower.Infrastructure.Web.Tenancy.ActiveBusinessScope.MoveToAsync(DatabaseFacade, Guid, CancellationToken) -> Task`
  - `PeakPower.Contracts.Customer.Auth.ActiveBusinessRequest(Guid CustomerId)`
  - `POST /api/v1/auth/active-business` → `200:SignInResponse`,
    `400:HttpValidationProblemDetails`, `404:ProblemDetails`; `.TenantScoped("customer")`
  - `CustomerSampleBodies.OwnCustomerIdPlaceholder` and
    `CustomerSampleBodies.Render(string, Guid) -> string`
  - **Plan 3 consumes the route and the response**; plan 4 consumes `ActiveBusinessScope` if its
    invitation-accept ever needs the same move (it does not — that flow is anonymous).

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/ActiveBusinessTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using PeakPower.Api.Customer.Auth;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Identity;
using PeakPower.Infrastructure.Web.Http;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Auth;

/// <summary>
/// <c>POST /api/v1/auth/active-business</c>: the only way a session changes which business it is
/// about.
/// </summary>
/// <remarks>
/// Every fact is asserted through the HTTP surface, because the interesting part of this endpoint
/// is what the DATABASE will accept: the refresh-token row it writes names the new business while
/// the middleware scoped the transaction to the old one, and only the mid-request
/// <c>set_config</c> makes that legal. A test that wrote the same row through the owner connection
/// would be green whether or not that statement exists.
/// </remarks>
public sealed class ActiveBusinessTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Switching_re_mints_the_session_for_the_new_business()
    {
        var seeded = await TwoBusinessesAsync();

        var response = await SwitchAsync(seeded.Client, seeded.Second);

        response.StatusCode.ShouldBe(
            HttpStatusCode.OK,
            $"the switch must succeed for a business this login belongs to: " +
            $"{await response.Content.ReadAsStringAsync(Ct)}");

        var session = await response.Content.ReadFromJsonAsync<SignInResponse>(Ct);

        session!.Account.CustomerId.ShouldBe(seeded.Second, "the session is now about the new business");
        session.Account.MembershipRole.ShouldBe(
            MembershipRoleWire.Viewer,
            "membershipRole is the role in the business the NEW token names, not the one it left");
        session.Account.Memberships.Select(membership => membership.CustomerId).ToArray().ShouldBe(
            [seeded.First, seeded.Second],
            "the switcher's own list is unchanged by switching - only which entry is active moves");

        // The re-minted token has to actually work, and has to work AS the new business. A handler
        // that returned a well-formed token for the old business would satisfy everything above.
        seeded.Client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", session.AccessToken);
        var me = await seeded.Client.GetAsync("/api/v1/auth/me", Ct);
        me.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await me.Content.ReadFromJsonAsync<CurrentAccountResponse>(Ct))!.CustomerId
            .ShouldBe(seeded.Second);
    }

    [Fact]
    public async Task Switching_binds_the_new_refresh_cookie_to_the_new_business()
    {
        var seeded = await TwoBusinessesAsync();

        var response = await SwitchAsync(seeded.Client, seeded.Second);
        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var rotated = RefreshCookieOf(response);
        rotated.ShouldNotBe(
            seeded.Refresh,
            "the browser has one cookie slot for this path, and the value in it after a switch " +
            "must be a token that refreshes into the NEW business");

        await using (var owner = factory.CreateOwnerDbContext())
        {
            var hash = OpaqueToken.HashOf(rotated);
            var row = await owner.RefreshTokens.SingleAsync(token => token.TokenHash == hash, Ct);

            row.CustomerId.ShouldBe(
                seeded.Second,
                "customer.refresh_token carries its own customer_id (shared contract section 5.2) " +
                "and this row is written while app.customer_id names the new business - it is the " +
                "one write in the customer host that could not happen without the mid-request " +
                "set_config");
            row.RevokedAt.ShouldBeNull();
        }

        // And it refreshes into the new business rather than the old one.
        var refreshed = await RefreshAsync(seeded.Client, rotated);
        refreshed.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await refreshed.Content.ReadFromJsonAsync<SignInResponse>(Ct))!.Account.CustomerId
            .ShouldBe(seeded.Second);
    }

    [Fact]
    public async Task Switching_records_the_preference_for_the_next_sign_in()
    {
        var seeded = await TwoBusinessesAsync();

        (await SwitchAsync(seeded.Client, seeded.Second)).StatusCode.ShouldBe(HttpStatusCode.OK);

        await using (var owner = factory.CreateOwnerDbContext())
        {
            (await MembershipSeed.LastActiveBusinessOfAsync(owner, seeded.AccountId, Ct)).ShouldBe(
                seeded.Second,
                "decision 5 is 'sign-in lands in the business last used', and this is the write " +
                "that makes 'last used' mean anything. It reaches the database only because " +
                "migration 15 granted UPDATE (last_active_business_id) by column.");
        }

        var again = await SignInAsync(seeded.Email);
        again.CustomerId.ShouldBe(seeded.Second);
    }

    /// <summary>
    /// The switch replaces this browser's session and nothing else. The access token the caller
    /// already held keeps working for the business it names — a bumped security stamp here would
    /// sign the person out of their phone for pressing a switcher on a laptop.
    /// </summary>
    [Fact]
    public async Task Switching_leaves_the_previously_issued_access_token_working()
    {
        var seeded = await TwoBusinessesAsync();
        var before = seeded.AccessToken;

        (await SwitchAsync(seeded.Client, seeded.Second)).StatusCode.ShouldBe(HttpStatusCode.OK);

        using var other = factory.CreateAnonymousClient();
        other.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", before);

        var me = await other.GetAsync("/api/v1/auth/me", Ct);

        me.StatusCode.ShouldBe(
            HttpStatusCode.OK,
            "no security-stamp bump: the token was minted before the switch and still names a " +
            "business this account is a live member of");
        (await me.Content.ReadFromJsonAsync<CurrentAccountResponse>(Ct))!.CustomerId
            .ShouldBe(seeded.First, "and it is still about the business it was minted for");
    }

    [Fact]
    public async Task Switching_to_the_business_already_active_is_a_fresh_session_and_not_a_conflict()
    {
        var seeded = await TwoBusinessesAsync();

        var response = await SwitchAsync(seeded.Client, seeded.First);

        response.StatusCode.ShouldBe(
            HttpStatusCode.OK,
            "idempotent by design, and relied on: CustomerApiRouteTableTests sends this route's " +
            "sample body as the caller's OWN business and requires a 2xx, because a probe whose " +
            "request is refused never reaches the tenancy check it is there to prove");

        (await response.Content.ReadFromJsonAsync<SignInResponse>(Ct))!.Account.CustomerId
            .ShouldBe(seeded.First);
    }

    [Fact]
    public async Task A_business_this_login_does_not_belong_to_is_404_and_says_nothing_else()
    {
        var seeded = await TwoBusinessesAsync();

        // A real business, belonging to somebody else entirely.
        var strangerEmail = $"{Guid.NewGuid():N}@example.nl";
        var stranger = await factory.SeedCustomerWithAccountAsync(
            $"Vandersteen Koeling {Guid.NewGuid():N}", MembershipSeed.FreshKvkNumber(),
            strangerEmail, Password);

        Guid strangersBusiness;
        await using (var owner = factory.CreateOwnerDbContext())
        {
            strangersBusiness = await MembershipSeed.OnlyBusinessOfAsync(owner, stranger.Id, Ct);
        }

        var response = await SwitchAsync(seeded.Client, strangersBusiness);

        response.StatusCode.ShouldBe(
            HttpStatusCode.NotFound,
            "[F13-R19]: 404 and never 403, because a 403 confirms the business exists");

        (await ProblemTypeOfAsync(response)).ShouldBe(
            ApiResults.NotFoundType,
            "the constant 404 body every other cross-tenant miss on this API returns - byte " +
            "identical, so 'not yours' and 'never existed' cannot be told apart");
    }

    [Fact]
    public async Task A_membership_that_was_removed_is_404_too()
    {
        var seeded = await TwoBusinessesAsync();

        await using (var owner = factory.CreateOwnerDbContext())
        {
            await MembershipSeed.RemoveAsync(
                owner, seeded.AccountId, seeded.Second,
                new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero), Ct);
        }

        (await SwitchAsync(seeded.Client, seeded.Second)).StatusCode.ShouldBe(
            HttpStatusCode.NotFound,
            "removed_at IS NULL is carried by the projection this proof reads; a switch into a " +
            "business somebody was removed from would mint a token their next request 401s on");
    }

    [Fact]
    public async Task A_body_naming_no_business_is_refused_before_anything_is_read()
    {
        var seeded = await TwoBusinessesAsync();

        var response = await SwitchAsync(seeded.Client, Guid.Empty);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var payload = await response.Content.ReadAsStringAsync(Ct);
        payload.Contains("customerId", StringComparison.Ordinal).ShouldBeTrue(
            $"the validation problem names the field the caller got wrong: {payload}");
    }

    private sealed record Seeded(
        HttpClient Client, string Email, string Refresh, string AccessToken,
        Guid AccountId, Guid First, Guid Second);

    private async Task<Seeded> TwoBusinessesAsync()
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Zonneweide Beheer {Guid.NewGuid():N}", MembershipSeed.FreshKvkNumber(), email, Password);

        Guid first;
        Guid second;
        await using (var owner = factory.CreateOwnerDbContext())
        {
            first = await MembershipSeed.OnlyBusinessOfAsync(owner, account.Id, Ct);
            second = await MembershipSeed.AddBusinessAsync(
                owner,
                account.Id,
                legalName: "Windkracht Noord B.V.",
                tradeName: "Windkracht",
                membershipRole: MembershipRoleWire.Viewer,
                joinedAt: new DateTimeOffset(2026, 6, 1, 9, 0, 0, TimeSpan.Zero),
                cancellationToken: Ct);

            await MembershipSeed.SetLastActiveBusinessAsync(owner, account.Id, first, Ct);
        }

        var session = await SignInAsync(email);
        session.CustomerId.ShouldBe(first, "the arrangement itself must hold");

        return new Seeded(
            session.Client, email, session.Refresh, session.AccessToken,
            account.Id, first, second);
    }

    private sealed record SignedIn(
        HttpClient Client, string Refresh, string AccessToken, Guid CustomerId);

    private async Task<SignedIn> SignInAsync(string email)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = false,
        });

        var response = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password), Ct);
        response.StatusCode.ShouldBe(
            HttpStatusCode.OK,
            $"the arrangement itself must hold: {await response.Content.ReadAsStringAsync(Ct)}");

        var body = await response.Content.ReadFromJsonAsync<SignInResponse>(Ct);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body!.AccessToken);

        return new SignedIn(
            client, RefreshCookieOf(response), body.AccessToken, body.Account.CustomerId);
    }

    private Task<HttpResponseMessage> SwitchAsync(HttpClient client, Guid customerId) =>
        client.PostAsJsonAsync(
            "/api/v1/auth/active-business", new ActiveBusinessRequest(customerId), Ct);

    private Task<HttpResponseMessage> RefreshAsync(HttpClient client, string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/refresh");
        request.Headers.Add("Cookie", $"{RefreshCookie.Name}={token}");
        return client.SendAsync(request, Ct);
    }

    private static string RefreshCookieOf(HttpResponseMessage response) =>
        response.Headers.GetValues("Set-Cookie")
            .Single(value => value.StartsWith($"{RefreshCookie.Name}=", StringComparison.Ordinal))
            .Split(';')[0][$"{RefreshCookie.Name}=".Length..];

    private static async Task<string?> ProblemTypeOfAsync(HttpResponseMessage response)
    {
        var payload = await response.Content.ReadAsStringAsync(Ct);
        using var document = JsonDocument.Parse(payload);
        return document.RootElement.TryGetProperty("type", out var type) ? type.GetString() : null;
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror > /tmp/pp-t6-build.txt 2>&1
```

Read it. Expected: FAIL to compile — `error CS0246: The type or namespace name
'ActiveBusinessRequest' could not be found`. The route does not exist either, but that would only
show up as a 404 at run time, which is why the request type is the honest first red.

- [ ] **Step 3: Write the one statement that moves the tenant scope**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/ActiveBusinessScope.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace PeakPower.Infrastructure.Web.Tenancy;

/// <summary>
/// Moves <c>app.customer_id</c> to another business inside the request's own transaction. There is
/// exactly one caller — <c>POST /api/v1/auth/active-business</c> — and there should never be a
/// second.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this exists at all.</b> <c>CustomerSessionMiddleware</c> sets <c>app.customer_id</c> from
/// the token's claim and the whole request runs under it. The business switch is the one handler
/// whose job is to end that: the <c>customer.refresh_token</c> row it inserts names the business
/// being switched TO, and that table's tenant-isolation policy is the uniform
/// <c>customer_id = app.customer_id</c> pair — so the insert fails the <c>WITH CHECK</c> arm unless
/// the setting moves with it. The alternative a hurried implementer reaches for is the owner
/// connection, which design §4.2 exists to forbid: it bypasses row-level security entirely and
/// leaves the handler's own <c>WHERE</c> clause as the only thing deciding whose rows get written.
/// </para>
/// <para>
/// <b>It lives here and not in the endpoint.</b> This assembly is the one architecture fact 6
/// allows to know how a request becomes a tenant scope, and the <c>set_config</c> literal it issues
/// is the same one <see cref="CustomerSessionMiddleware"/> issues. Two spellings of a tenancy
/// control in two files is how they stop agreeing.
/// </para>
/// <para>
/// ⚠ <b><c>set_config</c>, never <c>SET LOCAL &lt;name&gt; = &lt;value&gt;</c>.</b> <c>SET</c> does
/// not accept a parameter, and concatenating a value into a tenancy control is how injection gets
/// in. <see cref="RelationalDatabaseFacadeExtensions.ExecuteSqlInterpolatedAsync"/> turns the
/// interpolation hole into a real query parameter — this is not string formatting, and rewriting it
/// as <c>ExecuteSqlRawAsync($"…{customerId}…")</c> would be exactly the bug the house rule names.
/// </para>
/// <para>
/// <b>It does not move layer 1.</b> <c>ICustomerContext</c> reads the token, and the token has not
/// changed; the caller is responsible for touching no other tenant-filtered table after this
/// returns. The switch touches two, and both pass under either value — see its own comment.
/// </para>
/// </remarks>
public static class ActiveBusinessScope
{
    public static Task MoveToAsync(
        DatabaseFacade database, Guid customerId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(database);

        if (customerId == Guid.Empty)
        {
            throw new ArgumentException(
                "An active business must be named. Setting app.customer_id to the empty guid " +
                "would scope the rest of the request to a tenant that cannot exist, which every " +
                "policy answers with zero rows rather than with an error.",
                nameof(customerId));
        }

        // ToString(), not the Guid: app.customer_id is a text setting and every policy casts it
        // with ::uuid, exactly as CustomerSessionMiddleware's own parameter does.
        var value = customerId.ToString();

        return database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('app.customer_id', {value}, true)", cancellationToken);
    }
}
```

- [ ] **Step 4: Add the request contract**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs`,
append at the end of the file:

```csharp
/// <summary>
/// Switch this session to another business this login belongs to.
/// </summary>
/// <param name="CustomerId">
/// The business to move to. It must be one of <c>CurrentAccountResponse.Memberships</c>' own
/// entries; anything else is answered 404, because a 403 would confirm the business exists
/// [F13-R19].
/// </param>
public sealed record ActiveBusinessRequest(Guid CustomerId);
```

- [ ] **Step 5: Map the route and write the handler**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs`,
insert the registration inside `MapAuthEndpoints` immediately **after** the `/me` registration's
closing `.ProducesProblem(StatusCodes.Status404NotFound);` (today at `:234`) and before
`group.MapPost("/refresh", …)`:

```csharp
        group.MapPost("/active-business", SetActiveBusinessAsync)
            .RequireAuthorization()
            // Tenant-scoped, and not merely "authenticated": this reads the caller's membership
            // rows and writes both customer_account.last_active_business_id and a
            // customer.refresh_token row, all under app_customer_role. The resource kind is
            // "customer" - the thing the body names is a customer company, the same kind
            // GET /api/v1/company declares.
            .TenantScoped("customer")
            .WithName("SetActiveBusiness")
            .WithSummary("Switch this session to another business this login belongs to.")
            // The same body sign-in and refresh answer with: the switch RE-MINTS, so a client gets
            // a whole new session rather than a flag it has to remember.
            .Produces<SignInResponse>()
            // ApiResults.InvalidRequest, keyed to "customerId": a body naming no business at all.
            .ProducesValidationProblem()
            // ApiResults.NotFound() for a business this login holds no live membership in, and it
            // is the only refusal. A 403 would confirm the business exists [F13-R19], and
            // TenancyArchitectureTests.no_type_produces_a_forbidden_response refuses the constant.
            .ProducesProblem(StatusCodes.Status404NotFound);
```

Then add the handler, immediately after `RefreshAsync`'s `SessionFor` / `RoleIn` helpers (task 3's
block):

```csharp
    /// <summary>
    /// Move this session to another business the caller is a live member of.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A switch is a new session, not a flag: the access token carries exactly one
    /// <c>customer_id</c> claim and every tenancy decision in the platform is made from it, so
    /// changing which business a person is acting in means minting a new token. Nothing here is
    /// reversible by the client.
    /// </para>
    /// <para>
    /// <c>HttpResponse</c> rather than <c>HttpContext</c>: see this class's own remarks.
    /// </para>
    /// </remarks>
    private static async Task<IResult> SetActiveBusinessAsync(
        ActiveBusinessRequest request,
        HttpResponse response,
        ICustomerContext customer,
        PeakPowerDbContext db,
        ITokenIssuer tokens,
        IMarketCalendar calendar,
        CancellationToken cancellationToken)
    {
        if (request.CustomerId == Guid.Empty)
        {
            return ApiResults.InvalidRequest("customerId", "Name the business to switch to.");
        }

        // Read under the OLD scope, and that works because the membership table's tenant-isolation
        // policy has an account_id arm as well as a customer_id one: this account's memberships in
        // OTHER businesses are visible while it is acting for this one. That permissive OR is
        // exactly what the switcher needs - and exactly what design §4.2 warns must never be
        // trusted to scope a COUNT, which is plan 4's problem and not this one.
        //
        // MembershipsOfAsync keys on the caller's own account id, so the policy's customer_id arm
        // (which also matches every COLLEAGUE's membership in the business being left) cannot widen
        // this result.
        var memberships = await MembershipsOfAsync(db, customer.AccountId, cancellationToken);
        var target = memberships.SingleOrDefault(
            membership => membership.CustomerId == request.CustomerId);

        if (target is null)
        {
            // 404 and never 403 [F13-R19], through the same constant body every other miss on this
            // API returns - so "you are not a member of it" and "it does not exist" are
            // indistinguishable.
            return ApiResults.NotFound();
        }

        // ─────────────────────────────────────────────────────────────────────────────────
        // Everything below writes, and every write names the NEW business.
        //
        // customer.refresh_token is policed by the uniform customer_id = app.customer_id pair
        // (shared contract §5.2), so an INSERT naming the new business while the middleware scoped
        // this transaction to the old one fails the WITH CHECK arm outright. Moving the setting is
        // the honest statement of what this endpoint does, and it is the ONLY place in the customer
        // host that changes app.customer_id after CustomerSessionMiddleware set it.
        //
        // ⚠ Layer 1 does NOT move with it. ICustomerContext.CustomerId still reads the OLD business
        // out of the unchanged JWT for the rest of this request. That is safe here and only here,
        // because the two filtered tables touched below both pass under either value:
        // customer_account through a membership this account holds in BOTH businesses, and
        // refresh_token through no EF filter at all (it is on QueryFilterModelTests.ExemptEntityTypes).
        // Do not add a read of any other tenant-filtered table below this line.
        // ─────────────────────────────────────────────────────────────────────────────────
        await ActiveBusinessScope.MoveToAsync(db.Database, request.CustomerId, cancellationToken);

        var account = await db.CustomerAccounts
            .SingleOrDefaultAsync(a => a.Id == customer.AccountId, cancellationToken);

        if (account is null)
        {
            return ApiResults.NotFound();
        }

        var now = calendar.UtcNow;

        // The one column app_customer_role may write on customer_account. Migration 15's
        // column-scoped grant is what lets it through: a blanket UPDATE grant would have reopened
        // password_hash and security_stamp to an admin of any business a colleague also belongs to.
        account.RecordActiveBusiness(request.CustomerId);

        // A refresh token bound to the NEW business, and the cookie overwritten.
        //
        // Nothing is marked used and nothing is revoked, and that is a decision rather than an
        // omission. The refresh cookie is path-scoped to /api/v1/auth/refresh (see RefreshCookie),
        // so a browser never attaches it here and this handler cannot know which row the caller is
        // holding - the same asymmetry SignOutAsync records. Marking this account's OTHER rows
        // used-and-replaced would make the next refresh from their phone a REPLAY, which
        // RefreshAsync answers by revoking the whole chain and bumping the security stamp: pressing
        // a switcher on a laptop would sign somebody out everywhere. Revoking them outright is
        // "sign me out everywhere", which is a different button. The row this switch abandons is
        // exactly as live as it was a moment ago, and its plaintext lived only in the cookie slot
        // the RefreshCookie.Write below overwrites.
        var refresh = tokens.IssueRefreshToken(account.Id, out var refreshExpiresAt);
        db.RefreshTokens.Add(RefreshToken.Issue(
            account.Id,
            request.CustomerId,
            OpaqueToken.HashOf(refresh),
            now,
            refreshExpiresAt));

        // No security-stamp bump anywhere in this handler. It would kill the access token this very
        // response is about to replace, and every other device's with it.
        var access = tokens.IssueAccessToken(account, request.CustomerId);

        await db.SaveChangesAsync(cancellationToken);

        RefreshCookie.Write(response, refresh, refreshExpiresAt);

        return Results.Ok(SessionFor(account, request.CustomerId, memberships, access));
    }
```

Add the using directive if it is not already present (`AuthEndpoints.cs:9` already has it):

```csharp
using PeakPower.Infrastructure.Web.Tenancy;
```

- [ ] **Step 6: Register the route with the three harnesses that pin the customer surface**

**6a — the sample body, and the placeholder it needs.** In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleBodies.cs`,
add after `NoRequestBody` (today `:42`):

```csharp
    /// <summary>
    /// Stands in, inside a registered body, for the SIGNED-IN COMPANY'S OWN customer id. Rendered
    /// by <see cref="Render"/> just before the request is sent.
    /// </summary>
    /// <remarks>
    /// <c>POST /api/v1/auth/active-business</c> names a business in its body, and the probe signs
    /// in as a fresh company on every run — so a constant id here would be answered 404 (which is
    /// the tenancy answer, and therefore invisible to a probe asserting "not 200") and
    /// <see cref="CustomerApiRouteTableTests.Every_sample_body_is_accepted_by_its_own_endpoint"/>
    /// would report it as a rejected body. Same reasoning as
    /// <c>CustomerSampleQueries</c>' decision to make its values a function of the caller's own
    /// metering point rather than constants.
    /// </remarks>
    public const string OwnCustomerIdPlaceholder = "{ownCustomerId}";

    /// <summary>
    /// Substitutes <paramref name="ownCustomerId"/> for every
    /// <see cref="OwnCustomerIdPlaceholder"/>. Ordinal, and safe on a body containing none.
    /// </summary>
    public static string Render(string body, Guid ownCustomerId)
    {
        ArgumentNullException.ThrowIfNull(body);
        return body.Replace(
            OwnCustomerIdPlaceholder,
            ownCustomerId.ToString(),
            StringComparison.Ordinal);
    }

```

and add this entry to `All` (order inside the dictionary does not matter; put it beside the
sign-out entry, today `:71`):

```csharp
            // Switching to the business you are already in is a 200 and a fresh session, not a 409
            // - see the endpoint's own tests - which is what lets the probe send this as its own
            // owner and require a 2xx. The id is rendered per run: see OwnCustomerIdPlaceholder.
            ["/api/v1/auth/active-business"] =
                $$"""{"customerId":"{{OwnCustomerIdPlaceholder}}"}""",
```

**6b — the route table.** In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/CustomerApiRouteTableTests.cs`,
add to `ExpectedRouteTable` immediately after `"GET /.well-known/jwks.json",` (today `:65`) — the
list is in `RouteTable.Enumerate`'s ordinal-by-pattern order and
`/api/v1/auth/active-business` sorts before `/api/v1/auth/me`:

```csharp
        // The business switch. Tenant-scoped and parameterless: the business is named in the BODY,
        // not the path, so the cross-tenant probe reaches it through CustomerSampleBodies rather
        // than by substituting an id into the URL - and its own test class is what proves another
        // company's id is answered 404 there.
        "POST /api/v1/auth/active-business",
```

In `Every_sample_body_is_accepted_by_its_own_endpoint` (today `:306-344`), replace:

```csharp
            var body = CustomerSampleBodies.All[entry.RoutePattern];
```

with:

```csharp
            var body = CustomerSampleBodies.Render(
                CustomerSampleBodies.All[entry.RoutePattern], owner.CustomerId);

            // A body that still carries the placeholder was never rendered, and would be refused
            // by model binding with a 400 that this test would report as "the endpoint rejected
            // its own sample body" without saying why.
            body.Contains(CustomerSampleBodies.OwnCustomerIdPlaceholder, StringComparison.Ordinal)
                .ShouldBeFalse($"{entry}'s sample body was not rendered: {body}");
```

In `SendAsync` (today `:574-590`), take the caller's own customer id and render with it:

```csharp
    private static async Task<HttpResponseMessage> SendAsync(
        HttpClient client, RouteTableEntry entry, Guid? id, Guid ownCustomerId)
    {
        var url = id is null
            ? entry.RoutePattern
            : RouteTable.Substitute(entry.RoutePattern, id.Value);

        using var request = new HttpRequestMessage(new HttpMethod(entry.HttpMethod), url);

        if (CustomerSampleBodies.All.TryGetValue(entry.RoutePattern, out var body) &&
            body.Length > 0)
        {
            request.Content = new StringContent(
                CustomerSampleBodies.Render(body, ownCustomerId), Encoding.UTF8, "application/json");
        }

        return await client.SendAsync(request, Ct);
    }
```

and update its four call sites — today `:365`, `:378`, `:513` and `:516`:

```csharp
            using var crossTenant = await SendAsync(
                companyA.Client, entry, companyBObjects[kind], companyA.CustomerId);
```
```csharp
            using var own = await SendAsync(
                companyA.Client, entry, companyAObjects[kind], companyA.CustomerId);
```
```csharp
            using var forA = await SendAsync(companyA.Client, entry, id: null, companyA.CustomerId);
```
```csharp
            using var forB = await SendAsync(companyB.Client, entry, id: null, companyB.CustomerId);
```

⚠ `TenantScopedParameterisedCount` (2) and `TenantScopedCollectionGetCount` (8) do **not** move: the
new route has no path parameter and is not a GET.

**6c — the declared responses.** In
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract/CustomerResponseMetadataTests.cs`,
add to `ExpectedResponseContract` immediately after the JWKS line (today `:53`) — `Operations()`
orders by pattern ordinal then method:

```csharp
        // The business switch re-mints, so 200 carries the same SignInResponse sign-in and refresh
        // do. 400 is ApiResults.InvalidRequest for a body naming no business, keyed to
        // "customerId". 404 is the only refusal: a 403 would confirm the business exists [F13-R19]
        // and an IL scan refuses the constant. No 409 - switching to the business you are already
        // in is a fresh session, deliberately, because the route-table probe sends exactly that.
        "POST /api/v1/auth/active-business -> 200:SignInResponse, "
        + "400:HttpValidationProblemDetails, 404:ProblemDetails",
```

- [ ] **Step 7: Build, run, review the contract diff, accept it**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror > /tmp/pp-t6-build2.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~ActiveBusinessTests" > /tmp/pp-t6-switch.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~CustomerApiRouteTableTests" > /tmp/pp-t6-routes.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~AnonymousEndpointAllowListTests" > /tmp/pp-t6-anon.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~CustomerResponseMetadataTests" > /tmp/pp-t6-meta.txt 2>&1
```

Read all five. Expected: build clean; all PASS.

⚠ `AnonymousEndpointAllowListTests.Expected` does **not** change: the new route calls
`.RequireAuthorization()` and is therefore not anonymous. If it appeared on that list, the
registration lost its `RequireAuthorization()` and the endpoint would run on the owner connection
with row-level security bypassed.

Then the document:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~CustomerOpenApiSnapshotTests" > /tmp/pp-t6-snap.txt 2>&1
cd tests/PeakPower.Integration.Tests/Contract
diff CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json \
     CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.received.json \
     > /tmp/pp-t6-contract.diff 2>&1
wc -l /tmp/pp-t6-contract.diff
```

Read `/tmp/pp-t6-contract.diff` in full. It must contain **only** the new
`/api/v1/auth/active-business` path with its `post` operation (request body
`ActiveBusinessRequest`, responses `200` → `SignInResponse`, `400` →
`HttpValidationProblemDetails`, `404` → `ProblemDetails`) and the new `ActiveBusinessRequest`
schema. Then accept and run everything:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract
mv CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.received.json \
   CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test PeakPower.sln --nologo > /tmp/pp-t6-all.txt 2>&1
```

Read `/tmp/pp-t6-all.txt`: the whole solution must be green.

- [ ] **Step 8: Mutate the scope move — prove the database is what needs it**

In `SetActiveBusinessAsync`, comment out the one statement:

```csharp
        // await ActiveBusinessScope.MoveToAsync(db.Database, request.CustomerId, cancellationToken);
```

Predicted failure: `Switching_re_mints_the_session_for_the_new_business` fails on its **first**
assertion — *"should be OK but was InternalServerError"* — and the message prints the body, which
carries Npgsql's *"new row violates row-level security policy for table "refresh_token""*
(`SQLSTATE 42501`). `Switching_binds_the_new_refresh_cookie_to_the_new_business` and
`Switching_records_the_preference_for_the_next_sign_in` fail the same way.

⚠ This is the mutation that proves deviation D4 was necessary rather than defensive. Record the
exact Npgsql message you saw.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~ActiveBusinessTests" > /tmp/pp-t6-mut1.txt 2>&1
```

Read it, confirm, restore the statement, re-run green.

- [ ] **Step 9: Mutate the membership proof — prove the switch is not a free tenant hop**

Replace the target selection with one that accepts anything:

```csharp
        var target = memberships.FirstOrDefault();                       // MUTATION
```

Predicted failure: `A_business_this_login_does_not_belong_to_is_404_and_says_nothing_else` fails
with *"should be NotFound but was OK"* — a signed-in customer would have minted themselves a valid
token for a stranger's company. `A_membership_that_was_removed_is_404_too` fails the same way.
`Switching_re_mints_the_session_for_the_new_business` **also** fails, on
`session.Account.CustomerId.ShouldBe(seeded.Second)`, because `FirstOrDefault` picks the oldest —
which is a second, independent symptom of the same hole.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~ActiveBusinessTests" > /tmp/pp-t6-mut2.txt 2>&1
```

Read it, confirm, restore the `SingleOrDefault(...)` selection, re-run green, then:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git diff --stat > /tmp/pp-t6-restored.txt 2>&1
```

Read it: the changed files are exactly the eight this task names.

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/ActiveBusinessScope.cs \
        src/Core/PeakPower.Contracts/Customer/Auth/AuthContracts.cs \
        src/Hosts/PeakPower.Api.Customer/Auth/AuthEndpoints.cs \
        artifacts/openapi/customer.json \
        tests/PeakPower.Integration.Tests/Auth/ActiveBusinessTests.cs \
        tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleBodies.cs \
        tests/PeakPower.Integration.Tests/Tenancy/CustomerApiRouteTableTests.cs \
        tests/PeakPower.Integration.Tests/Contract/CustomerResponseMetadataTests.cs \
        tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json
git commit -m "Switch a session to another business by re-minting it

POST /api/v1/auth/active-business proves the membership, moves the tenant scope,
writes last_active_business_id, binds a fresh refresh token to the new business and
re-mints the access token. A switch is a new session; there is nothing here a client
could hold as a flag.

The scope move is the part neither the design nor the contract could have known
about: refresh_token is policed by customer_id = app.customer_id, so the row this
handler inserts - which names the business being switched TO - fails the WITH CHECK
arm while the middleware's setting still names the one being left. One parameterised
set_config, in the assembly that owns that literal, after the proof and before any
write. Commenting it out answers 42501, which is the test.

Nothing is revoked. The refresh cookie is path-scoped away from this route, so the
handler cannot know which row the caller holds; marking the account's other rows
used would turn the next refresh from their phone into a replay, and the theft
response bumps the security stamp. The abandoned row is exactly as live as it was,
and its plaintext lived only in the cookie slot this response overwrites.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Removal bites on the next request (immediate-revocation probe)

Shared contract §11: *"Removal takes effect on the **next request**, not at token expiry, and does
not disturb that person's session elsewhere."*

This task adds no production code. Everything it proves already exists — plan 1's middleware refuses
a request whose `(account, business)` pair has no live membership (shared contract §6, steps 3 and
4), and tasks 1–6 built the multi-business session that makes "elsewhere" a real place. What is
missing is the proof that the two work **together**, end to end, through HTTP, against a real
container: nothing in this repository currently signs one login into two businesses at once and then
takes one of them away.

⚠ **"Not at token expiry" has to be asserted, not implied.** A 401 five seconds after a removal
looks identical to a 401 from an expired token, and a fifteen-minute access-token lifetime means an
inattentive test could be measuring the wrong thing forever. The probe reads `exp` off the very
token that was refused and requires it to still be in the future.

**Files:**
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/MembershipRevocationTests.cs`

**Interfaces:**
- Consumes: `POST /api/v1/auth/active-business` (task 6); `GET /api/v1/auth/me` (task 3);
  `MembershipSeed.*` (task 2); `MembershipRoleWire.Viewer` (task 2);
  `Microsoft.IdentityModel.JsonWebTokens.JsonWebToken` (already referenced by
  `PeakPower.Integration.Tests` — `SignInTests.cs:5`).
- Produces: nothing but the proof.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/MembershipRevocationTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.IdentityModel.JsonWebTokens;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Domain.Customers;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Auth;

/// <summary>
/// Shared contract §11's <b>immediate-revocation</b> probe: *"Removal takes effect on the next
/// request, not at token expiry, and does not disturb that person's session elsewhere."*
/// </summary>
/// <remarks>
/// <para>
/// Both halves are new. Before plan 1 there was nothing to revoke short of deactivating the whole
/// account, and before this plan one login could not be in two businesses at once, so "elsewhere"
/// had no meaning. Nothing else in this suite signs one person into two businesses and then takes
/// one away.
/// </para>
/// <para>
/// The mechanism under test is plan 1's — <c>CustomerSessionMiddleware</c> reads
/// <c>customer_membership</c> on every authenticated request and refuses when it finds no live row
/// (shared contract §6, steps 3 and 4). What this class proves is that plan 2's multi-business
/// session did not quietly route around it.
/// </para>
/// </remarks>
public sealed class MembershipRevocationTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Password = "correct-horse-battery";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Removal_is_refused_on_the_very_next_request_and_not_at_token_expiry()
    {
        var seeded = await SignedIntoBothAsync();

        // Both sessions work before the removal, or nothing below means anything.
        (await MeAsync(seeded.InFirst)).CustomerId.ShouldBe(seeded.First);
        (await MeAsync(seeded.InSecond)).CustomerId.ShouldBe(seeded.Second);

        await using (var owner = factory.CreateOwnerDbContext())
        {
            await MembershipSeed.RemoveAsync(
                owner, seeded.AccountId, seeded.Second,
                new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero), Ct);
        }

        var refused = await seeded.InSecond.GetAsync("/api/v1/auth/me", Ct);

        refused.StatusCode.ShouldBe(
            HttpStatusCode.Unauthorized,
            "the membership proof runs on EVERY authenticated request, so the very next one after " +
            "a removal is refused. Waiting for the token to expire would leave somebody with " +
            "fifteen more minutes of access to a business that has just removed them.");

        // The half that makes the line above evidence rather than a coincidence: the token that
        // was refused is still cryptographically valid and still inside its lifetime, so the 401
        // cannot be an expiry.
        var token = new JsonWebToken(seeded.SecondAccessToken);
        token.ValidTo.ShouldBeGreaterThan(
            DateTime.UtcNow,
            "the refused token has not expired - an access token lives fifteen minutes - so the " +
            "401 above is the membership proof and nothing else");
    }

    [Fact]
    public async Task Removal_from_one_business_leaves_the_session_in_the_other_untouched()
    {
        var seeded = await SignedIntoBothAsync();

        await using (var owner = factory.CreateOwnerDbContext())
        {
            await MembershipSeed.RemoveAsync(
                owner, seeded.AccountId, seeded.Second,
                new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero), Ct);
        }

        var survivor = await MeAsync(seeded.InFirst);

        survivor.CustomerId.ShouldBe(
            seeded.First,
            "the session in the OTHER business belongs to the same account and the same person; " +
            "removing them from one company must not touch the company they still work for");

        survivor.Memberships.Select(membership => membership.CustomerId).ToArray().ShouldBe(
            [seeded.First],
            "and the surviving session's switcher has caught up on the same request: the list is " +
            "read from the database every time rather than cached in the token");
    }

    /// <summary>
    /// The way back in is closed too. A live session in another business is not a route around the
    /// removal.
    /// </summary>
    [Fact]
    public async Task A_removed_member_cannot_switch_back_into_the_business()
    {
        var seeded = await SignedIntoBothAsync();

        await using (var owner = factory.CreateOwnerDbContext())
        {
            await MembershipSeed.RemoveAsync(
                owner, seeded.AccountId, seeded.Second,
                new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero), Ct);
        }

        var attempt = await seeded.InFirst.PostAsJsonAsync(
            "/api/v1/auth/active-business", new ActiveBusinessRequest(seeded.Second), Ct);

        attempt.StatusCode.ShouldBe(
            HttpStatusCode.NotFound,
            "the switch proves membership itself rather than trusting that the caller already had " +
            "a session there; 404 and never 403, because a 403 would confirm the business exists");
    }

    private sealed record Seeded(
        HttpClient InFirst,
        HttpClient InSecond,
        string SecondAccessToken,
        Guid AccountId,
        Guid First,
        Guid Second);

    /// <summary>
    /// One login, two businesses, two live sessions: one signed straight into the first, one
    /// switched across to the second. Two clients, because a browser has one cookie slot and this
    /// is the two-devices case.
    /// </summary>
    private async Task<Seeded> SignedIntoBothAsync()
    {
        var email = $"{Guid.NewGuid():N}@example.nl";
        var account = await factory.SeedCustomerWithAccountAsync(
            $"Zonneweide Beheer {Guid.NewGuid():N}", MembershipSeed.FreshKvkNumber(), email, Password);

        Guid first;
        Guid second;
        await using (var owner = factory.CreateOwnerDbContext())
        {
            first = await MembershipSeed.OnlyBusinessOfAsync(owner, account.Id, Ct);
            second = await MembershipSeed.AddBusinessAsync(
                owner,
                account.Id,
                legalName: "Windkracht Noord B.V.",
                tradeName: "Windkracht",
                membershipRole: MembershipRoleWire.Viewer,
                joinedAt: new DateTimeOffset(2026, 6, 1, 9, 0, 0, TimeSpan.Zero),
                cancellationToken: Ct);

            await MembershipSeed.SetLastActiveBusinessAsync(owner, account.Id, first, Ct);
        }

        var inFirst = await SignInAsync(email);
        var inSecond = await SignInAsync(email);

        var switched = await inSecond.Client.PostAsJsonAsync(
            "/api/v1/auth/active-business", new ActiveBusinessRequest(second), Ct);
        switched.StatusCode.ShouldBe(
            HttpStatusCode.OK,
            $"the arrangement itself must hold: {await switched.Content.ReadAsStringAsync(Ct)}");

        var switchedSession = await switched.Content.ReadFromJsonAsync<SignInResponse>(Ct);
        inSecond.Client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", switchedSession!.AccessToken);

        return new Seeded(
            inFirst.Client, inSecond.Client, switchedSession.AccessToken, account.Id, first, second);
    }

    private sealed record SignedIn(HttpClient Client, string AccessToken);

    private async Task<SignedIn> SignInAsync(string email)
    {
        var client = factory.CreateAnonymousClient();

        var response = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(email, Password), Ct);
        response.StatusCode.ShouldBe(
            HttpStatusCode.OK,
            $"the arrangement itself must hold: {await response.Content.ReadAsStringAsync(Ct)}");

        var body = await response.Content.ReadFromJsonAsync<SignInResponse>(Ct);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body!.AccessToken);

        return new SignedIn(client, body.AccessToken);
    }

    private async Task<CurrentAccountResponse> MeAsync(HttpClient client)
    {
        var response = await client.GetAsync("/api/v1/auth/me", Ct);
        response.StatusCode.ShouldBe(
            HttpStatusCode.OK,
            $"expected a live session: {await response.Content.ReadAsStringAsync(Ct)}");
        return (await response.Content.ReadFromJsonAsync<CurrentAccountResponse>(Ct))!;
    }
}
```

- [ ] **Step 2: Run it and watch it pass — then make it fail on purpose**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~MembershipRevocationTests" > /tmp/pp-t7-green.txt 2>&1
```

Read `/tmp/pp-t7-green.txt`. Expected: all three PASS on the first run — this task adds no
production code, so there is nothing to make red first. **That is precisely why the mutation below
is not optional here.** A probe that has never been seen to fail is a probe nobody has checked.

- [ ] **Step 3: Mutate plan 1's membership proof — prove the middleware is what refuses**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerSessionMiddleware.cs`,
find the statement shared contract §6 step 3 pins — the one reading

```sql
SELECT role FROM customer.customer_membership
  WHERE account_id  = current_setting('app.account_id')::uuid
    AND customer_id = current_setting('app.customer_id')::uuid
    AND removed_at IS NULL
```

and delete the `AND removed_at IS NULL` term from it.

Predicted failure:
`Removal_is_refused_on_the_very_next_request_and_not_at_token_expiry` fails with *"should be
Unauthorized but was OK"* and the message *"the membership proof runs on EVERY authenticated
request…"* — the removed row is still there, `removed_at` and all, so a proof that does not read the
column happily finds it. `Removal_from_one_business_leaves_the_session_in_the_other_untouched` also
fails, on `memberships` still listing two businesses, because that projection **does** filter on
`removed_at` — the two halves disagree, which is exactly the symptom a soft delete produces when one
reader forgets it.

⚠ This is the mutation the design warns about in terms: *"Active membership means
`removed_at IS NULL` — every predicate in §4 carries it."* A single reader that drops the term makes
removal cosmetic.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~MembershipRevocationTests" > /tmp/pp-t7-mut1.txt 2>&1
```

Read it, confirm both predicted failures, restore the term, re-run green, then:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git diff --stat src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerSessionMiddleware.cs \
    > /tmp/pp-t7-restored.txt 2>&1
```

Read it: it must be **empty**. This task changes no production file.

- [ ] **Step 4: Mutate the arrangement — prove the "elsewhere" half is not vacuous**

In `MembershipRevocationTests.SignedIntoBothAsync`, remove the switch so both clients are signed
into the same business:

```csharp
        // var switched = await inSecond.Client.PostAsJsonAsync(                       // MUTATION
        //     "/api/v1/auth/active-business", new ActiveBusinessRequest(second), Ct);
        var switched = await inSecond.Client.PostAsJsonAsync(
            "/api/v1/auth/active-business", new ActiveBusinessRequest(first), Ct);
```

Predicted failure: `Removal_is_refused_on_the_very_next_request_and_not_at_token_expiry` fails on
its arrangement guard — *"should be <second> but was <first>"* on
`(await MeAsync(seeded.InSecond)).CustomerId` — before it ever reaches the removal. Without that
guard the whole class would have gone green over two sessions in the same business, proving nothing
about "elsewhere".

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~MembershipRevocationTests" > /tmp/pp-t7-mut2.txt 2>&1
```

Read it, confirm, restore the switch to `second`, re-run green.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Auth/MembershipRevocationTests.cs
git commit -m "Prove a removal bites on the next request and only where it should

Shared contract section 11's immediate-revocation probe. One login, two businesses,
two live sessions - one signed straight in, one switched across - and one of the
memberships taken away. The switched session is refused on its very next request;
the other one is not, and its switcher list has already caught up. The refused token
is still inside its fifteen minutes, which is what separates the membership proof
from an expiry and is asserted rather than assumed.

The way back in is closed too: a live session elsewhere is not a route around the
removal, and the switch answers 404.

No production code. Verified by mutation against plan 1's middleware: dropping
`AND removed_at IS NULL` from the membership statement makes the removal cosmetic
and turns two of the three red.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Publish the contract, and hand the break to the web repo

The customer OpenAPI document has moved twice in this plan — a reshaped `CurrentAccountResponse`
(task 3) and a new route (task 6) — and both were accepted into the Verify snapshot as they landed.
This task pins the facts a **consumer** cares about, so that a future regeneration that quietly
dropped one of them fails here by name rather than in a TypeScript build two repositories away, and
then states exactly what breaks in `peakpower-web` and how plan 3 fixes it.

⚠ **This plan does not commit anything in `peakpower-web`.** Plan 3 owns that repository. What this
task owes it is an accurate list and a demonstration, not a fix.

**Files:**
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract/CustomerDocumentHandoffTests.cs`

**Interfaces:**
- Consumes: `RepositoryRoot.Find()`
  (`tests/PeakPower.Integration.Tests/Contract/RepositoryRoot.cs`); `MembershipRoleWire.Values`
  (task 2); `artifacts/openapi/customer.json`, emitted at build by
  `OpenApiGenerateDocumentsOnBuild` (`PeakPower.Api.Customer.csproj:40-43`).
- Produces: nothing but the proof, and the handoff recorded in the commit message.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract/CustomerDocumentHandoffTests.cs`:

```csharp
using System.Text.Json;
using PeakPower.Domain.Customers;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Contract;

/// <summary>
/// The three facts <c>peakpower-web</c> generates its typed client from, asserted on the published
/// document rather than on the C# that produced it.
/// </summary>
/// <remarks>
/// <c>CustomerOpenApiSnapshotTests</c> already fails on ANY unreviewed change, which is the right
/// bar for a reviewer and the wrong one for a reader: a diff of a 75 000-character document does
/// not say which of its lines the other repository depends on. These three do, and each is a change
/// that would compile perfectly on this side and break there.
/// </remarks>
public sealed class CustomerDocumentHandoffTests
{
    private static string DocumentPath =>
        Path.Combine(RepositoryRoot.Find(), "artifacts", "openapi", "customer.json");

    private static async Task<JsonDocument> DocumentAsync() =>
        JsonDocument.Parse(
            await File.ReadAllTextAsync(DocumentPath, TestContext.Current.CancellationToken));

    /// <summary>
    /// The admin flag is gone from the customer contract entirely — the column, the claim, the
    /// property and the field. [F13-R41] and [F01-R47] said it granted no read or write; membership
    /// replaced it with a role the database is the sole authority on.
    /// </summary>
    [Fact]
    public async Task The_customer_document_never_mentions_the_admin_flag_again()
    {
        var json = await File.ReadAllTextAsync(
            DocumentPath, TestContext.Current.CancellationToken);

        json.ShouldNotContain(
            "isAdmin",
            Case.Insensitive,
            "the customer contract has no admin flag after plan 1's sweep and this plan's " +
            "membershipRole. A client still reading one is reading a field the server no longer " +
            "sends, and would silently treat every admin as an ordinary member.");
    }

    [Fact]
    public async Task The_customer_document_publishes_the_three_membership_role_values()
    {
        using var document = await DocumentAsync();

        var membershipRole = document.RootElement
            .GetProperty("components")
            .GetProperty("schemas")
            .GetProperty("CurrentAccountResponse")
            .GetProperty("properties")
            .GetProperty("membershipRole");

        membershipRole
            .GetProperty("enum")
            .EnumerateArray()
            .Select(value => value.GetString())
            .ToArray()
            .ShouldBe(
                MembershipRoleWire.Values,
                "lowercase, and published rather than left as a bare { \"type\": \"string\" }. " +
                "EnumWireValuesSchemaTransformer keys on (declaring type, camelCase property " +
                "name) and a key that matches nothing is a silent no-op - the transformer runs, " +
                "matches nothing, and the value set vanishes from the document without anything " +
                "failing on this side.");
    }

    [Fact]
    public async Task The_customer_document_carries_the_switcher_and_the_switch()
    {
        using var document = await DocumentAsync();
        var root = document.RootElement;

        root.GetProperty("components")
            .GetProperty("schemas")
            .GetProperty("CurrentAccountResponse")
            .GetProperty("properties")
            .TryGetProperty("memberships", out var memberships)
            .ShouldBeTrue("the rail's switcher is built from this array and nothing else");
        memberships.GetProperty("type").GetString().ShouldBe("array");

        root.GetProperty("paths")
            .TryGetProperty("/api/v1/auth/active-business", out var switchPath)
            .ShouldBeTrue(
                "a switch is a server round trip that re-mints the session; a client that could " +
                "not find this route would have to fake it with a local flag, which is the thing " +
                "design §5 forbids in terms");

        switchPath.TryGetProperty("post", out _).ShouldBeTrue();
    }
}
```

- [ ] **Step 2: Run it**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror > /tmp/pp-t8-build.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~CustomerDocumentHandoffTests" > /tmp/pp-t8.txt 2>&1
```

Read both. Expected: build clean and all three PASS — tasks 3 and 6 already produced the document
these assert on. If `The_customer_document_never_mentions_the_admin_flag_again` fails, plan 1's
sweep left `isAdmin` somewhere in the customer contract and that is plan 1's to finish, not this
plan's to work around.

- [ ] **Step 3: Mutate the transformer — prove the enum values are published rather than assumed**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/OpenApi/EnumWireValuesSchemaTransformer.cs`,
misspell one key's property name — the exact silent failure that file's own doc comment records:

```csharp
            [(typeof(CurrentAccountResponse), "MembershipRole")] = MembershipRoleWire.Values,
```

(capital `M`; the transformer looks up `JsonPropertyInfo.Name`, which is camelCase, in a
`FrozenDictionary` that compares ordinally.)

Predicted failures, in this order:

1. `CustomerResponseMetadataTests.Every_enum_wire_value_entry_names_a_property_that_exists` fails
   with *"should be empty but was ["CurrentAccountResponse.MembershipRole"]"* — that is the guard
   built for this mistake.
2. `CustomerDocumentHandoffTests.The_customer_document_publishes_the_three_membership_role_values`
   fails with `KeyNotFoundException`/*"The given key 'enum' was not present"*, because the property
   fell back to a bare `{ "type": "string" }`.
3. `CustomerOpenApiSnapshotTests` fails, because the document changed.

All three are the point: the first two catch it without a human reading a 75 000-character diff.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror > /tmp/pp-t8-mut-build.txt 2>&1
dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~Contract" > /tmp/pp-t8-mut.txt 2>&1
```

Read both, confirm, restore `"membershipRole"`, rebuild, re-run, and confirm the document is back:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror > /tmp/pp-t8-rebuild.txt 2>&1
git diff --stat artifacts/openapi/customer.json > /tmp/pp-t8-artifact.txt 2>&1
dotnet test PeakPower.sln --nologo > /tmp/pp-t8-all.txt 2>&1
```

Read all three. `/tmp/pp-t8-artifact.txt` must be **empty** (the document is byte-identical to what
task 6 committed) and `/tmp/pp-t8-all.txt` must be green.

- [ ] **Step 4: Demonstrate the break in `peakpower-web`, and list it**

The web repo generates its typed client from the document this plan just moved, and
`npm run verify:clients` is what notices. Run it and capture the evidence:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npm run verify:clients > /tmp/pp-t8-verify-clients.txt 2>&1
grep -rn "isAdmin" apps/customer-portal libs/api-client-customer > /tmp/pp-t8-web-isadmin.txt 2>&1
wc -l /tmp/pp-t8-web-isadmin.txt
```

Read both files — do not trust the terminal. Expected: `verify:clients` FAILS, because
`libs/api-client-customer/src/generated/customer-schema.d.ts` no longer matches the document, and
`/tmp/pp-t8-web-isadmin.txt` lists the call sites below.

**This is plan 3's work and this plan must not do it.** What plan 3 has to run, in
`/Users/thinhhuynh/PeakPower/peakpower-web`:

```bash
npm run generate:clients
npx ng test shared-ui       --watch=false
npx ng test customer-portal --watch=false
npx ng test employee-portal --watch=false
```

**What breaks, verified against `peakpower-web` at the time this plan was written.** One production
file and thirteen specs, all in the customer half:

| File | Why |
| --- | --- |
| `libs/api-client-customer/src/generated/customer-schema.d.ts:480`, `:683` | Regenerated by `npm run generate:clients`. `isAdmin` goes; `membershipRole` and `memberships` arrive |
| `apps/customer-portal/src/app/features/entitlements/entitlements-page.ts:163-166` | **Production.** `canChange = computed(() => this.auth.account()?.isAdmin === true)` becomes `…?.membershipRole === 'admin'`. ⚠ Lowercase — this is the one enum on this contract that is not SCREAMING_SNAKE |
| `libs/api-client-customer/src/lib/customer-api.client.spec.ts:154`, `:157` | A `CurrentAccount` fixture and an assertion on `isAdmin` |
| `apps/customer-portal/src/app/app.spec.ts:87`, `app.config.spec.ts:58`, `app.routes.spec.ts:21`, `auth/auth.service.spec.ts:20`, `auth/auth.interceptor.spec.ts:19`, `auth/access-token.store.spec.ts:14`, `auth/authenticated.guard.spec.ts:24`, `shell/customer-nav.service.spec.ts:25`, `shell/company.store.spec.ts:18`, `shell/entitlement.store.spec.ts:18`, `features/dashboard/dashboard-page.spec.ts:171`, `features/entitlements/entitlements-page.spec.ts:23`, `:26`, `features/sign-in/sign-in-page.spec.ts:20`, `onboarding/onboarding-wizard.spec.ts:27` | Each builds a `CurrentAccount` fixture with `isAdmin`. Every one needs `membershipRole` and `memberships` instead |

⚠ The `isAdmin` hits in `apps/employee-portal/**` and
`libs/api-client-employee/src/generated/employee-schema.d.ts` are the **employee** contract's
`AccountDto`. Plan 1's `is_admin` sweep (contract §10) moves the SERVER side of it; the WEB side —
those eleven files — is **plan 3's Task 3** (contract §13.3). Not this plan's, and not unowned.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git add tests/PeakPower.Integration.Tests/Contract/CustomerDocumentHandoffTests.cs
git commit -m "Pin the three contract facts peakpower-web actually depends on

CustomerOpenApiSnapshotTests fails on any unreviewed change, which is the right bar
for a reviewer and the wrong one for a reader: a diff of a 75 000-character document
does not say which of its lines the other repository builds against. These three do
- no isAdmin anywhere, membershipRole published as its three lowercase values, and
memberships[] plus the switch route present - and each is a change that compiles
perfectly on this side and breaks there.

Verified by mutation: capitalising one key in EnumWireValuesSchemaTransformer makes
the value set vanish from the document while the build stays clean, which is the
silent failure that file's own doc comment warns about.

Handoff: peakpower-web must run npm run generate:clients. One production file
breaks - entitlements-page.ts reads account()?.isAdmin and becomes
membershipRole === 'admin', lowercase - plus thirteen specs that build a
CurrentAccount fixture. The employee-portal hits are plan 1's sweep, not this.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done — what this plan leaves behind, and what it does not

**Behind it.** One login can hold several businesses for a whole session. `GET /api/v1/auth/me`
answers with the caller's role in the business the token names and with every business they belong
to, oldest membership first, each labelled with its trade name — which is readable at all only
because `customer_customer_tenant_isolation` and the `Customer` global query filter were widened
**together**, one policy still, `FOR SELECT` so the widened read never became a widened write.
`POST /api/v1/auth/active-business` proves the membership, moves `app.customer_id` inside the
request so the database will accept the token row, writes `last_active_business_id`, binds a new
refresh token to the new business and re-mints. Refresh re-proves membership and terminates with a
signal of its own instead of looping. Sign-in lands on the business last used, else the oldest
membership, else a named refusal for an account with none — a state this platform has never had.
All three of shared contract §11's plan-2 probes exist and have each been seen to fail.

**Not behind it, and deliberately.**

- **The rail switcher and the store invalidation are plan 3's**, in `peakpower-web`. This plan
  changed no file there and left `npm run verify:clients` red on purpose; task 8 lists the one
  production file and thirteen specs that move.
- **Every admin verb is plan 4's** — the member list, invitations, role changes, removal and the
  two-admin floor. Nothing in this plan writes a `customer_membership` row outside a test helper,
  and `customer.is_admin_of` has no caller yet.
- **The `UPDATE (used_at, replaced_by_token_id)` grant on `refresh_token` is unused.** Deviation D3:
  the switch cannot see the presented refresh token, so it inserts rather than rotates. The grant is
  correct to hold and plan 4 may be its first user.
- **The business the switch leaves keeps a live refresh-token row** until it expires. Nobody holds
  its plaintext — the cookie slot was overwritten — but it is a row, and a device list or an
  explicit "sign out of this device" would let us do better. Recorded, not designed.
- **`TenantScopeMiddleware`** (the tenancy probe app's, not production wiring) is plan 1's to teach
  the step-3 membership proof. If it is still unchanged, the probe app exercises half the new
  predicate and stays green over the other half.
- **`[OQ-105]`** — the back office still has no membership screen, and there are now more
  memberships to ask about than there were.
