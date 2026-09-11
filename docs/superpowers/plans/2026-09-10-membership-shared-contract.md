# Multi-business membership — Shared Contract

> **Design:** [2026-09-10-multi-business-membership-design.md](../specs/2026-09-10-multi-business-membership-design.md) · **Date:** 2026-09-10
>
> **Decision to record:** `[DEC-152]` · **Open question to record:** `[OQ-105]`

## 0. How to read this file

This file is **normative** for everything that crosses a plan boundary: the migration DDL, the
grants and policies, the types, the wire shapes and the guard updates. A plan may not redefine
anything here. Where a plan disagrees with this file, this file wins and the plan is wrong.

Everything **not** in this file is the owning plan's own business.

Four plans, in strict order. Each is behaviour-preserving or additive except plan 1's step 4.

| Plan | Owns | Repo |
| --- | --- | --- |
| **1 — Tenancy foundation** | Migration 15, the two proofs, the column drop, the `is_admin` sweep | platform |
| **2 — Session and switching** | `/auth/me`, `/auth/active-business`, refresh re-proof, sign-in fallback | platform |
| **3 — The switcher** | Rail control, store invalidation, generation counter | web |
| **4 — The admin surface** | Invitations, role change, removal, the floor | platform + web |

Plan 1 must be complete and green before plan 2 starts: it is the only plan that changes what a
tenancy claim means, and plans 2–4 assume the new meaning.

---

## 1. Versions — verified 2026-09-10

| | |
| --- | --- |
| .NET | `net10.0` |
| Microsoft.EntityFrameworkCore | `10.0.11` |
| Npgsql.EntityFrameworkCore.PostgreSQL | `10.0.3` |
| PostgreSQL | 17 |
| Angular | 22, zoneless, signals |

**Migration 15** is the next number. Fourteen migrations exist; `DayAheadPrices` is number 12, which
is the number `[DEC-149]` records, so the counting convention is confirmed.

---

## 2. Repositories and commands

```
platform = /Users/thinhhuynh/PeakPower/peakpower-platform
web      = /Users/thinhhuynh/PeakPower/peakpower-web
specs    = /Users/thinhhuynh/PeakPower/peakpowerspecs
```

Always `git -C <path>` — the shell working directory is not stable between calls in this
environment.

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

---

## 3. Naming — normative

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

---

## 4. Migration 15 DDL — NORMATIVE, owned by plan 1 alone

Statement order matters. Plans 2–4 may not add to this migration.

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
--   own created_at is now(); "oldest account" below orders by id, which is a UUIDv7 whose leading
--   48 bits are a millisecond timestamp, in Postgres's uuid comparison order.
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

⚠ Dropping the column before step 7 errors on dependent objects. `CASCADE` would silently drop all
three policies, leaving `customer_account` with RLS enabled and **no policy** — every authenticated
request then 401s, because the middleware's own account read returns nothing.

### 4.1 The first-admin repair

`is_admin` defaults false, so a company whose accounts are all non-admin gets **no admin membership**
— violating the floor on deploy and leaving a business that can never invite anyone, since every
admin verb is `CompanyAdmin`-gated.

```sql
UPDATE customer.customer_membership m SET role = 'admin'
WHERE m.account_id = (
    SELECT a.id FROM customer.customer_account a
    JOIN customer.customer_membership m2 ON m2.account_id = a.id AND m2.customer_id = m.customer_id
    WHERE a.status = 'ACTIVE'
    ORDER BY a.id                       -- UUIDv7: id order IS creation order
    LIMIT 1)
AND NOT EXISTS (SELECT 1 FROM customer.customer_membership x
                WHERE x.customer_id = m.customer_id AND x.role = 'admin');
```

Each promotion writes an `audit.audit_record` naming a migration actor. ⚠ `[F13-R41]` forbids a
*"first account of a company is admin"* rule, so this departure is auditable rather than silent.
Companies with **zero** active accounts are listed in the migration output and left alone.

---

## 5. Grants and policies — NORMATIVE

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

### 5.1 Three things about this block that are load-bearing

1. ⚠ **`ENABLE ROW LEVEL SECURITY` and `REVOKE` are the whole protection.** Migration 2's
   `ALTER DEFAULT PRIVILEGES … GRANT SELECT, INSERT, UPDATE, DELETE` fires for every table a later
   migration creates in these schemas. Without the revoke, every signed-in customer holds full DML
   on the table that is the sole proof of tenancy. This repo already found that trap live on
   `refresh_token`.
2. ⚠ **No `DELETE` grant, ever.** Postgres evaluates `WITH CHECK` for `INSERT` and for an `UPDATE`'s
   new row and **never for `DELETE`**, which `USING` alone governs — and this `USING` has no admin
   term. Removal is an `UPDATE` setting `removed_at`. A test asserts the **absent privilege**, because
   no policy can guard a `DELETE`.
3. ⚠ **`SET search_path` is not decoration.** A `SECURITY DEFINER` function with a mutable
   `search_path` lets the caller choose which `customer_membership` it means.

### 5.2 The three replaced policies

| Table | New predicate |
| --- | --- |
| `customer.customer_account` | `EXISTS (SELECT 1 FROM customer.customer_membership m WHERE m.account_id = customer_account.id AND m.customer_id = <app.customer_id> AND m.removed_at IS NULL)` |
| `customer.password_reset_token` | the same `EXISTS`, joined through `customer_account_id` |
| `customer.refresh_token` | ⚠ **NOT the `EXISTS` shape** — it gains its own `customer_id` column and uses the uniform `customer_id = <app.customer_id>` |

⚠ `refresh_token` must key on its own column. Under an `EXISTS`-through-membership policy, plan 4's
removal — which revokes the member's tokens in the same transaction as the removal — would see its
own removal, find no active membership, and **revoke zero rows silently**.

### 5.3 Column-scoped grants

```sql
REVOKE UPDATE, DELETE ON customer.customer_account FROM app_customer_role;
GRANT  UPDATE (last_active_business_id) ON customer.customer_account TO app_customer_role;
-- refresh_token today holds SELECT + UPDATE (revoked_at) only; rotation needs more:
GRANT  INSERT ON customer.refresh_token TO app_customer_role;
GRANT  UPDATE (used_at, replaced_by_token_id) ON customer.refresh_token TO app_customer_role;
```

⚠ **That grant re-opens a hole migration 3 deliberately closed, and must ship with a trigger.**
Combined with the existing `UPDATE (revoked_at)`, the three columns above are exactly the set that
makes `SET used_at = NULL, revoked_at = NULL, replaced_by_token_id = NULL` succeed — un-spending a
spent token, which is the statement migration 3 narrowed this table to prevent. Migration 15
therefore also adds `trg_refresh_token_evidence_monotonic`, refusing any update that nulls a
non-null value in those three columns, and the existing schema test that expects `42501` on that
statement moves to expecting `23001`. The trigger mechanism has precedent in migration 10.

⚠ A blanket `REVOKE UPDATE` on `customer_account` is correct against every call site that exists
today and **wrong** against plan 2's `active-business`, which is authenticated and must write the
preference column. Column scoping lets exactly that through while `password_hash` and
`security_stamp` stay unreachable.

---

## 6. The request path — NORMATIVE, owned by plan 1

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
- ⚠ **Setting `app.customer_id` before the proof keeps one batch and stays fail-closed.** The real
  middleware issues its statements as a single `NpgsqlBatch`; a conditional statement could not be
  batched. A forged claim has no membership row, so step 4 refuses and no handler runs.
  ⚠ **Corrected 2026-09-11 after plan 1's pre-flight.** This is fail-closed because of the
  REFUSAL, not because the policies hide the declared tenant. Declaring a REAL business you are not
  in does make that business's rows visible at the database level to the rest of the batch — the
  migration-2 policies on `customer`, `metering_point`, `wallet` and `audit_record` key directly on
  `app.customer_id`. What keeps it safe is that the batch's only other statements, the membership
  read and the account read, return nothing for a non-member, and the middleware answers 401 before
  any handler executes. The earlier wording — that the policies show the forged tenant *nothing* —
  holds only for a business that does not exist.
- ⚠ **Step 5 must run after step 4's setting**, or the new `EXISTS` policy hides the account row and
  every authenticated request 401s. It is a second read on a second table.

---

## 7. Types that cross plan boundaries

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
    // ⚠ Result<T>, not the bare type — the house pattern for a factory that can refuse.
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

---

## 8. Wire contracts

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

⚠ **Both invitation accepts are anonymous and run on the owner connection.** The invitation token is
the authorisation, not tenancy. A *known-address* accept run authenticated cannot work: `app.customer_id`
is the invitee's **current** business, so the `WITH CHECK` tenancy term fails, and `is_admin_of` is
false because the row being inserted is the thing that would make it true.

---

## 9. Guards that will fail, and how each must be answered

Three guards, not two. Each fails **by design**; none may be silenced by widening a discovery rule.

1. **`policyCount == 2`** per tenant table — *"should carry exactly a tenant-isolation and a
   back-office policy"*. `customer_membership` ships both (§5). ⚠ Plan 2 widens the **existing**
   `customer_customer_tenant_isolation` predicate rather than adding a third policy to
   `customer.customer`.
2. **Discovery by `customer_id` suffix**, model-side and catalogue-side. This is why the preference
   column is `last_active_business_id` (§3). A test must additionally assert `customer_account` is
   still policied **by name**, because the pinned totals can stay arithmetically right while a table
   silently loses its policy.
3. **Every customer-owned entity needs a global query filter or an argued exemption.**
   `CustomerMembership` cannot carry the standard filter — the switcher must read across businesses —
   so it takes a **`QueryFilterModelTests.ExemptEntityTypes`** entry naming that reason. ⚠ Not
   `RowLevelSecurityTests.ExemptTables` — that is the policy-coverage set, a different list.

Also moving: the route-table test pins the complete customer route list by hand, every endpoint must
declare `.TenantScoped()` / `.BackOffice()` / `.AnonymousEndpoint()`, and the mutating-endpoint count
is cross-checked against a sample-bodies collection. **Six** new routes (§8) touch all three — `active-business` plus the five company routes.

---

## 10. The `is_admin` sweep — plan 1 owns all of it

⚠ Roughly a dozen production sites, **not one**. The `CompanyAdmin` policy reads the JWT **claim**;
the column is read and written in the domain type, the token issuer, three auth endpoints, portal and
employee mappings, two employee endpoints that **create and update** it, four wire contracts, the EF
configuration and the demo seeder.

The **whole F12 employee surface for customer accounts is in scope** — create account with a company,
update the admin flag, list and count accounts by company. It runs as `app_employee_role`, which is
why §5 grants that role `INSERT` and `UPDATE` on the membership table.

The EF filter on `CustomerAccount` becomes a collection navigation
(`account.Memberships.Any(m => m.CustomerId == ctx.CustomerId && m.RemovedAt == null)`) —
`HasQueryFilter` cannot reference `Set<T>()` — and ⚠ **must keep its `!ctx.IsAuthenticated ||`
prefix**, or the back office, the Worker and anonymous onboarding all collapse to zero rows.

---

## 11. Testing conventions

Every plan verifies by mutation (§2). Beyond that, these probes are **required** and named here so no
plan omits one:

| Probe | Plan | Must prove |
| --- | --- | --- |
| Cross-tenant | 1 | A valid token for A cannot read B by any route — forged claim, replayed token, **and a pre-switch refresh cookie presented after a switch** (design §10's third vector). ⚠ *Clarified 2026-09-12 at plan 2's pre-flight:* the property is that the pre-switch cookie can **never yield access to B** — it stays bound to A and re-proves membership in A, so it mints only A tokens and is refused once A's membership is gone. It is **not** a requirement to revoke that cookie on switch: the switch never sees it (RefreshCookie.Path is /api/v1/auth/refresh), so revoking would mean signing out the account's other devices in the old business. |
| No-membership | 1 | A company named without membership is refused **before** `app.customer_id` is honoured |
| Escalation | 1 | A `trader` cannot `UPDATE … SET role='admin'` nor `INSERT` naming another company — asserting the **grant and the `WITH CHECK`**, not the outcome |
| **Removal** | 1 | A `viewer` cannot `DELETE FROM customer_membership` by any predicate — asserting the **absent `DELETE` privilege**, because no policy can guard a `DELETE` |
| Cross-tenant account reach | 1 | An admin of B cannot update `password_hash` or `security_stamp` of a person who is also in A |
| Immediate revocation | 2 | Removal takes effect on the **next request**, not at token expiry, and does not disturb that person's session elsewhere |
| Refresh termination | 2 | Refresh after removal terminates rather than looping |
| Zero memberships | 2 | Sign-in with no memberships is a named answer, not a crash |
| No unmount | 3 | A business switch refreshes data without rebuilding the shell |
| Indistinguishable invite | 4 | Known and unknown addresses match in status, body **and** timing; the throttle counts both |
| Concurrency | 4 | Two admins removing each other: exactly one succeeds, the business never reaches zero admins |

---

## 12. Open items — recorded, not closed

1. What the invitation email says to someone who already has a login. It must not imply a new
   account, nor name the businesses they are already in.
2. Whether the F12 back office keeps its own account-creation path or becomes the same invitation
   flow with an employee actor.
3. Whether the member list shows colleagues' other businesses. The §5 `OR` makes them readable; the
   explicit `AND customer_id = @active` predicate every admin query must carry prevents it.

⚠ **`[OQ-105]`** — the back office has no membership screen at all. Support cannot answer *"which
businesses is this person in?"* without SQL. Recorded, not designed.

---

## 13. Seam rulings — amended 2026-09-11, after the plans were authored

Four plans were authored in parallel against revision 1 of this file and then reviewed together. The
review found the plans internally disciplined and broken **at the seams** — which is exactly what
parallel authorship costs. Every ruling below is normative and supersedes anything a plan says.

Corrections **to this contract itself**, already applied above and listed so nobody re-introduces
them: `customer_account` has no `created_at` (§4, §4.1); the `refresh_token` grant needs the
monotonicity trigger (§5.3); `Create` returns `Result<CustomerMembership>` (§7); the exemption set is
`QueryFilterModelTests.ExemptEntityTypes` (§9); six new routes, not five (§9); the accept body needs
name and password fields (§8); and §11's cross-tenant probe had silently dropped design §10's third
vector.

### 13.1 Migration numbers — three, not two

| Migration | Plan | Name |
| --- | --- | --- |
| **15** | 1 | the membership table, policies, backfill, the column drop |
| **16** | 2 | `WidenCustomerVisibilityToMemberships` |
| **17** | 4 | `CompanyInvitations` |

⚠ Plans 2 and 4 both claimed 16. Plan 4's is **17**.

⚠ **Every plan that adds a migration must grow all three places that pin the ordered list** — the
migration-script test (count, ordered ids and names), the migration-behaviour test (applied count and
list) and `tools/verify-migrator.sh`'s `case` pattern. Plan 2 adds a migration and updates none of
them; that is a build break, not an oversight to leave for the implementer.

### 13.2 Single definition — who owns each shared symbol

| Symbol | Owner | Everyone else |
| --- | --- | --- |
| `CustomerAccount.RecordActiveBusiness(Guid)` | **plan 1** | consumes |
| `MembershipRoleWire` — see §13.2.1 for its exact shape | **plan 1** | consumes, never re-declares |
| `AuthEndpoints.SelectBusinessAsync` + its no-business problem document | **plan 1** (forced: dropping `customer_id` breaks sign-in inside plan 1) | consumes |
| `MembershipRoleValue` (web) | **plan 3** | consumes |
| `CustomerMembership.Create` → `Result<CustomerMembership>` | **plan 1** | callers write `.Value` |

⚠ Three of these were defined twice, which is `CS0111`, `TS2300` and a silent behaviour fork
respectively.

#### 13.2.1 `MembershipRoleWire` — one home, one shape

Plan 1 put it in the domain and argued why: `PeakPower.Persistence`'s value converter needs it, and
Persistence may not reference a host. Plans 2 and 4 read a different file, a different namespace, a
different `Values` type and three constants plan 1 never declares. **Plan 1's home wins; plan 4's
extra members are folded in.** The single declaration is:

```csharp
// src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs
namespace PeakPower.Domain.Customers;

public static class MembershipRoleWire
{
    public const string Admin  = "admin";
    public const string Trader = "trader";
    public const string Viewer = "viewer";

    public static IReadOnlyList<string> Values { get; } = [Admin, Trader, Viewer];

    public static string Of(MembershipRole role);                       // never throws
    public static MembershipRole Parse(string value);                   // throws on unknown
    public static bool TryParse(string? value, out MembershipRole role); // for wire input
}
```

⚠ **`TryParse`, not a nullable-returning `Parse` overload.** Plan 4 wanted
`Parse(string?) -> MembershipRole?` beside plan 1's `Parse(string) -> MembershipRole`; reference
nullability does not differentiate an overload, so that pair is `CS0111`. Anything parsing untrusted
wire input calls `TryParse`.

⚠ Plan 2's prerequisite check and plan 4's preflight both `cat` the **host** path and stop when it is
missing. Both must look in the domain.

### 13.3 The web `isAdmin` repair belongs to plan 3

Plan 1 removes `isAdmin` from four wire contracts, so **both** OpenAPI documents move and the
regenerated clients stop compiling. Plan 3 owns every resulting repair:

- customer-portal: the sixteen files its Task 2 already lists, **plus** `features/company/company-page.ts`
  and its spec (a one-line `person.membershipRole === 'admin'`, later replaced wholesale by plan 4);
- employee-portal: **eleven** files, not the eight this contract first counted. The three
  production screens, their three specs, the employee api-client spec and the e2e fixture are
  eight; plan 3 correctly added `shared/labels.ts` and its spec (the house home for every other
  wire-enum option list — two screens need the same three options) and
  `e2e/onboard-and-rename.spec.ts`, which reads `SignedInSession.isAdmin`. The repair is a
  boolean becoming a three-value `<select>`, not a comparison.

⚠ Plan 3's Task 1 gates currently say *"stop and raise it"* on conditions plan 1 **guarantees** — the
loss of `isAdmin` from `CompanyAccountDto` and a non-empty employee-client diff. Both gates must
**expect** those, not halt on them. Plan 4's Task 13 attributes this sweep to plan 2, which touches no
web file at all.

### 13.4 Plan 5 — the specification changes

⚠ Design §11 requires spec changes and **no plan owned them**. `[DEC-152]` appears zero times across
all four plans. A fifth plan, in the specs repo, writes:

- `[DEC-152]`, recording every row of design §1.1 as an explicit reversal — including F13 §6's *"Not
  supported"*, `[F01-R49]`, `[F01-R15]`'s stranded `PENDING_APPROVAL`, and api-contracts §2.10 losing
  `USER_ADD` from its closed list of five;
- the upheld annotations on `[F13-R23]` and `[F01-R14]`, and the §3.2 naming resolution on
  `[F01-R13]` and `[F13-R12]`;
- `[OQ-105]`, the back office's missing membership screen;
- ⚠ **the code twin**: `FourEyesAction.AddUser` is an enum arm whose doc comment names five actions.
  Decision 6 removes `USER_ADD` from that list, so the enum and its comment move with the spec.

Plan 5 runs **last** and touches no code.

### 13.5 Smaller rulings

- Route patterns take the house `{accountId:guid}` constraint — the route-table test pins `RawText`
  including constraints.
- `MembershipRole` bypasses the SCREAMING_SNAKE enum convention via an explicit `HasConversion`,
  because §3 spells the values lowercase in the database and on the wire.
- ✅ **Closed.** Two self-labelled gaps — a `__setAccountForTest` placeholder in plan 4's web task and
  an invented arrange helper in plan 1's Task 5 — both now name the real seam. Plan 4's is
  `TestBed.inject(AccessTokenStore).set(token, account)`, the mechanism every customer-portal spec
  already uses (verified at `entitlements-page.spec.ts:121,138` and `access-token.store.ts:22`).
- ✅ **Closed.** Plan 2's front-matter task numbers no longer shift +1 against its own tasks.
