# Multi-business membership — "one login, several businesses, a role in each"

> **Status:** Draft for review, revision 4 · **Date:** 2026-09-10 · **Next free decision:** `[DEC-152]` · **Next free open question:** `[OQ-105]`
>
> **Section-reference convention.** Bare `§n` means a section of **this** document. Other documents are
> always qualified — "F13 §6", "api-contracts §2.7", "domain-model C9".
>
> **Revision history.** r1 shipped the membership table writable by every signed-in customer. r2 fixed
> the grants but moved every membership write off RLS onto an "owner connection" that does not exist
> in the customer host. r3 put the writes back under RLS — and guarded them with a `WITH CHECK`, which
> Postgres never evaluates for `DELETE`, leaving removal unguarded. r4 removes the `DELETE` grant
> entirely and makes removal an `UPDATE`. §4.7 keeps every wrong turn visible: each was plausible, all
> four were caught by adversarial review rather than by reading, and the next reader will be tempted
> by the same shortcuts.

**Goal.** One person, one login, several businesses, a role in each; a switcher on the rail; an admin
may invite others.

⚠ **The specification declares this feature unsupported by name.** F13 §6's edge-case table:
*"One person works for two customer companies — **Not supported.** They need a second account with a
different username, because `customer_id` is fixed per account. Flagged at provisioning."* That row
is the design's entire goal. It is reversed here, on the stakeholder's instruction — and it is the
headline of §1, not a footnote.

---

## 1. What this reverses

`[DEC-16]` rejects by name *"An intra-company role model (viewer / trader / approver); customer
self-service account management"* — **"Confirmed by the stakeholder."** Reversed on the stakeholder's
instruction of 2026-09-10. The reversal surface is far wider than that one decision; r1 listed four
statements, r2 twelve, and both were incomplete.

### 1.1 Reversed

| Statement | Says today | Note |
| --- | --- | --- |
| **F13 §6** edge case | *"One person works for two customer companies — Not supported"* | The whole goal |
| `[DEC-16]` | No role model; no self-service account management; accounts created and deactivated by employees only | All three clauses. ⚠ `[DEC-113]` already reversed the creation clause for self-registration |
| `[DEC-71]` | Four-eyes action list includes **"add a user"** | Decision 6, §6.4 |
| `[F01-R49]` | *"With four-eyes on, adding a user requires a second admin's approval. The account is created in PENDING_APPROVAL and no invitation is sent until the approval lands"* | ⚠ Destroyed by decision 6 |
| `[F01-R15]` | `PENDING_APPROVAL` is one of four account statuses | Becomes unreachable for user adds |
| api-contracts **§2.10** | Four-eyes actions are *"TRADE_ACCEPT, BANK_ACCOUNT_ADD, BANK_ACCOUNT_DEACTIVATE, **USER_ADD**, WITHDRAWAL — the five and no others"* | `USER_ADD` leaves the list |
| api-contracts **§2.7** | *"All three are read-only… there is no write endpoint here at all"* | §6 adds four writes to exactly that URL space |
| `[F13-R41]`, `[F01-R47]` | The admin flag *"is set and cleared by a PeakPower employee, never by the customer"*, and *"grants no additional read or write… any endpoint that gates an ordinary read or write on the flag is a defect"* | Both halves; `[F01-R47]` is the F01 twin r2 missed |
| `[F01-R13]` | *"All accounts of one company have identical privileges. There is no permission field on an account"* | ⚠ **Reversed**, not merely a name collision as r2 said |
| `[F13-R13]` | *"still no per-account permission field, and still nothing a customer can grant themselves"* | |
| `[F01-R21]` | The account list is *"read-only; changes go through PeakPower"* | Becomes the member-management surface |
| `[F13-R28]` | (the account-list requirement — ⚠ r2 attributed F01-R21's wording to it; it does not carry that text) | |
| `[F13-R21]` | An **employee** creates an account and invites by email, single-use, **14 days** | Extended to customer admins; the 14 days is **kept** |
| `[F13-R22]` | *"Accepting an invitation activates the identity… INVITED → ACTIVE"* | ⚠ r2 misquoted this row; the invite-issuing text is R21 alone |
| **F13 §7** | *"a viewer / trader / approver hierarchy stays out… Two levels, and the second exists only for four-eyes"* | ⚠ **Reversed**, not "narrowed" — this ships that literal triple and makes admin gate non-four-eyes actions |
| domain-model **C7**, §3 | An account belongs to one customer; accounts are entities inside the customer aggregate | Aggregate restructure, §3.4 |
| `database-design` DDL | `customer_id NOT NULL`, `is_admin NOT NULL` on `customer_account` | Both columns leave |
| api-contracts **§1.2** | The `is_admin` token claim | Leaves the token, decision 8 |
| **F12** back office | Employee endpoints create accounts with a company and an admin flag, and count accounts by company | Whole surface in scope, §3.4 |

### 1.2 Upheld

`[F13-R23]` (no owner account) — owning is being an admin. `[F01-R14]` (identical data) — upheld for
now, §3.3.

---

## 2. Decisions

Given 2026-09-10: (1) one login, many memberships; (2) roles recorded, only `admin` gates;
(3) "owner" = admin; (4) an invitation never reveals whether the address has a login; (5) sign-in
lands in the business last used; (6) **membership changes bypass four-eyes**.

⚠ **Decision 6's cost is larger than it was first presented as, and it was re-confirmed knowing that.**
When first put to the stakeholder it was described as reversing only `[DEC-71]`'s "add a user". It
also destroys `[F01-R49]`, strands `[F01-R15]`'s `PENDING_APPROVAL` status for user adds, and removes
`USER_ADD` from api-contracts §2.10's closed list of five. The full cost was put back to the
stakeholder on 2026-09-10 with the four-eyes alternative alongside it, and **the bypass was chosen
again**. The consequence accepted with it: in a business that enabled four-eyes precisely to prevent
unilateral change, one admin — or one compromised admin account — can add another without a second
pair of eyes.

Settled in this document: (7) the admin floor is **two** for a four-eyes business, one otherwise
(§6.4); (8) **the database is the sole authority on role** — the `is_admin` claim leaves the token.

---

## 3. The model

### 3.1 Schema

```sql
CREATE TABLE customer.customer_membership (
    account_id  uuid NOT NULL REFERENCES customer.customer_account(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES customer.customer(id)         ON DELETE RESTRICT,
    role        text NOT NULL CHECK (role IN ('admin', 'trader', 'viewer')),
    created_at  timestamptz NOT NULL,
    removed_at  timestamptz NULL,
    PRIMARY KEY (account_id, customer_id)
);
```

⚠ **`removed_at` is not bookkeeping — it is what makes removal safe.** A membership is *never*
`DELETE`d. Postgres evaluates `WITH CHECK` for `INSERT` and for an `UPDATE`'s new row and **never for
`DELETE`**, which is governed by `USING` alone. r3 granted `DELETE` and put the admin proof in
`WITH CHECK`, so removal — one of the two verbs §6.2 ships — had no proof at all: a plain `viewer`
acting for B could `DELETE FROM customer_membership WHERE customer_id = <B>` and wipe every
membership in B including its admins, and anyone could `DELETE WHERE account_id = <self>` to drop
their memberships in businesses their token does not name. This repo had already proved that exact
`FOR ALL`/`USING` behaviour against postgres 17 and written it down on `refresh_token`; r3 reproduced
the bug its own migration comment documents.

Removal is therefore an `UPDATE` setting `removed_at`, which **is** `WITH CHECK`-protected. Active
membership means `removed_at IS NULL` — every predicate in §4 carries it. Re-inviting a removed person
clears the column rather than inserting a duplicate, which the composite key would refuse anyway.

`customer_account` loses `customer_id` and `is_admin`, and gains
**`last_active_business_id uuid NULL`**.

⚠ The obvious name — `last_customer_id` — **must not be used.** The RLS coverage guards discover
tenant columns by the suffix `customer_id` (`right(column_name, 11)`) and CLR properties by
`EndsWith("CustomerId")`. A preference column matching that suffix keeps `customer_account` in
tenancy discovery keyed on something that is not a tenancy key — a guard reporting coverage it does
not have. r2 introduced exactly this and then misdiagnosed it in the opposite direction.

### 3.2 Naming — three collisions

`trader`/`viewer` are the **employee** vocabulary (`[F13-R12]`); `role` is **job title** on the
account record and `[F01-R13]` says it is descriptive and never checked. Resolution: column
`customer_membership.role`, wire field **`membershipRole`**, job title unchanged; any code naming more
than one spells all of them.

### 3.3 What the roles gate

`admin` gates entitlements, invitations, role changes, removals. `trader` and `viewer` are recorded
and displayed but behaviourally identical to today's single customer role, keeping `[F01-R14]` true.

### 3.4 `is_admin` is a sweep, and the employee host is in scope

⚠ r1 claimed one call site by conflating the **column** with the **JWT claim**. The column has roughly
a dozen production sites across both realms, including the employee endpoints that create and update
it and the wire contracts on both sides. The F12 back-office surface — create account, update, list,
count-by-company (which groups on `account.CustomerId`) — is in scope and r1 omitted it entirely.

C7 is likewise not a one-line swap: domain-model §3 hangs `Customer._accounts` off the customer
aggregate *because* an account only ever lived in one company. The account becomes its own aggregate
root.

### 3.5 Migration order

1. add `last_active_business_id` **(before anything writes to it — r2 backfilled a column it added
   two steps later)**;
2. create `customer_membership`; `ENABLE ROW LEVEL SECURITY`; `REVOKE ALL` from both app roles;
   `GRANT SELECT, INSERT, UPDATE` — **never `DELETE`** — to both app roles per §4.2; create the
   `is_admin_of` function with its pinned `search_path`; create **both** policies (§4.2);
3. backfill one membership per account, `role = is_admin ? 'admin' : 'trader'`;
4. **first-admin repair** — see below;
5. backfill `last_active_business_id` from the account's `customer_id`;
6. drop the three policies depending on `customer_account.customer_id`; create their replacements
   (§4.3); add `customer_id` to `refresh_token` with its policy pair;
7. only then drop `customer_id` and `is_admin` and their index and FK.

⚠ **The backfill creates businesses with no admin.** `is_admin` defaults false, so a company whose
accounts are all non-admin gets no admin membership — violating decision 7's floor on deploy and
leaving a business that can never invite anyone, since every §6 verb is `CompanyAdmin`-gated. And the
obvious repair is forbidden by name: `[F13-R41]` says *"never defaulted on (no 'first account of a
company is admin' rule)"*. Step 4 therefore promotes **the oldest active account** of any admin-less
company and **records each promotion in `audit.audit_record`** with a migration actor, so the
departure from R41 is auditable rather than silent. Companies with zero active accounts are listed in
the migration output and left alone.

---

## 4. Tenancy

### 4.1 Both defences, not one

A forged `customer_id` is caught twice today: `customer_account`'s own `_tenant_isolation` policy, and
the EF global query filter on `CustomerAccount` — which the security-stamp tests prove by mutation
still catches a forged claim even with `SET LOCAL ROLE` removed. Both key on the dropped column. Both
must be replaced.

### 4.2 `customer_membership` — grants and policies

```sql
ALTER TABLE customer.customer_membership ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer.customer_membership FROM app_customer_role, app_employee_role;
-- NO DELETE, EVER, to either role: DELETE cannot be WITH CHECK-guarded (§3.1)
GRANT SELECT, INSERT, UPDATE ON customer.customer_membership TO app_customer_role;
GRANT SELECT, INSERT, UPDATE ON customer.customer_membership TO app_employee_role;

-- non-recursive: a policy on this table cannot subquery this table.
-- search_path is PINNED: a SECURITY DEFINER function with a mutable search_path is an
-- escalation vector, because the caller chooses which customer.customer_membership it means.
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

⚠ **`app_employee_role` needs `INSERT` and `UPDATE`, not just `SELECT`.** §3.4 puts the F12 account
surface in scope, and that surface writes memberships: creating a customer account with a company is
an `INSERT`, and flipping the admin flag is a role `UPDATE`. Both run as `app_employee_role`, and a
`SELECT`-only grant fails them with `42501`. r3 granted `SELECT` alone while putting the surface in
scope — an inconsistency between its own §3.4 and §4.2.

⚠ **`ENABLE ROW LEVEL SECURITY` plus `REVOKE` is the whole protection.** Migration 2's
`ALTER DEFAULT PRIVILEGES … GRANT SELECT, INSERT, UPDATE, DELETE` fires for every table a later
migration creates in this schema; the same trap was found live on `refresh_token`.

**Why writes stay under `app_customer_role`.** r2 moved them to "the owner connection". That posture
does not exist in the customer host — one DbContext, one connection, `SET LOCAL ROLE app_customer_role`
issued for every authenticated request, and no `RESET ROLE` anywhere. Worse, this codebase already
rejected the move by name: sign-out was deliberately *not* put on the owner connection because *"that
bypasses RLS entirely, leaving the handler's own WHERE clause as the only thing deciding whose tokens
get revoked."* The `WITH CHECK` arm above is that missing backstop: it pins every write to the active
business **and** requires the writer to be an admin of it, so a handler that forgets
`AND customer_id = @active` is caught by the database rather than by review.

`SECURITY DEFINER` is what makes the admin predicate legal — a policy on `customer_membership` that
subqueried `customer_membership` directly would raise *infinite recursion detected in policy*.

**Two policies, and the names matter.** Both coverage guards assert **exactly two** policies —
a tenant-isolation and a back-office one — for every table carrying `customer_id`, and the shared
contract makes `{schema}_{table}_tenant_isolation` normative. r2's single `customer_membership_readable`
failed both. The back-office policy is not optional decoration: without it the employee host reads
**zero** membership rows, silently, and §3.4 puts its account surface in scope.

⚠ **The permissive `OR` in `USING` does not scope a count.** The `account_id` arm makes the caller's
memberships in *other* businesses visible while acting for this one. Any admin-surface query — the
member list, and above all the floor count — **must carry an explicit `AND customer_id = @active`**.
Trusting RLS to scope the floor count is exploitable: an admin of a four-eyes business who also
self-registers a shell business where she is sole admin can make the count read two when the business
has one, remove the other admin, and hold a four-eyes business alone. The design requires the explicit
predicate and a test that asserts it.

### 4.3 The replaced policies

`customer_account` and `password_reset_token` re-point at `customer_membership` via an `EXISTS` on an
**active** membership (`removed_at IS NULL`), keyed on `app.customer_id`. This restores defence 1 — a
forged claim finds no membership, so the account row is invisible and the request 401s.

⚠ **`refresh_token` does NOT use that shape.** It gains its own `customer_id` column (§4.5) and keys
on the uniform `customer_id = app.customer_id` predicate, like every other table. r3 said both things
in different sections, and the `EXISTS` reading is actively harmful: §5 revokes a removed member's
tokens in the same transaction as the removal, and under an `EXISTS`-through-membership policy that
transaction sees its own removal, finds no active membership, and **revokes zero rows — silently**.
Removal would become the re-pointing §5 exists to prevent. Keying the token on its own column makes
revocation independent of the membership's state, which is the property that matters.

⚠ **The rewrite is not equivalent, and the difference is a privilege boundary.** The old policies were
*partition*-shaped: an account lived in one company, so two tenants' reachable account sets were
disjoint. Under membership they **overlap** — a shared member is reachable from both businesses. With
`customer_account`'s policy still `FOR ALL` and `app_customer_role` still holding full DML on a table
carrying `password_hash` and `security_stamp`, an admin of B can reach the account row of a person who
is also a member of A. The design therefore narrows the grant — **column-scoped, not a blanket
revoke**:

```sql
REVOKE UPDATE, DELETE ON customer.customer_account FROM app_customer_role;
GRANT  UPDATE (last_active_business_id) ON customer.customer_account TO app_customer_role;
```

⚠ A blanket `REVOKE UPDATE` — which r3 wrote — is correct against every call site that exists **today**
(every authenticated path leaves `customer_account` alone; sign-in, password reset, stamp bumps and
onboarding are all anonymous routes on the owner connection, and deactivation is the employee host).
It is wrong against this design's **own new writes**: §5's `active-business` is necessarily
authenticated, so it runs as `app_customer_role` and must write `last_active_business_id`. Column
scoping lets exactly that one preference column through while `password_hash` and `security_stamp`
stay unreachable. This is the pattern migration 2 already uses on `audit.audit_record` and
`metering.brp`.

The same applies to `refresh_token`, whose existing grants are `SELECT` plus `UPDATE (revoked_at)`
only. Rotating a token on a switch needs `INSERT`, and needs `UPDATE` of `used_at` and
`replaced_by_token_id`; both are added as column-scoped grants. ⚠ Without them §9 step 5 is three
`42501`s — and the one-line fix a hurried implementer reaches for is the owner connection §4.2 exists
to forbid.

The EF filter replacement must be expressed as a collection navigation
(`account.Memberships.Any(m => m.CustomerId == ctx.CustomerId)`) — `HasQueryFilter` cannot reference
`Set<T>()` — and **must keep its `!ctx.IsAuthenticated ||` prefix**, or the back office, the Worker and
anonymous onboarding all collapse to zero rows.

### 4.4 The request path

```
1. token verified -> account id claim, customer id claim. NO role claim.
   Both Guid.TryParse'd before they touch a statement.
2. SET LOCAL ROLE app_customer_role
   SELECT set_config('app.account_id',  $1, true)      -- identity
   SELECT set_config('app.customer_id', $2, true)      -- CLAIMED tenancy, not yet proven
3. SELECT role FROM customer.customer_membership
     WHERE account_id  = current_setting('app.account_id')::uuid
       AND customer_id = current_setting('app.customer_id')::uuid
       AND removed_at IS NULL
4. no row -> 401. row -> role goes on ICustomerContext.
5. SELECT security_stamp, status FROM customer.customer_account
     WHERE id = current_setting('app.account_id')::uuid
```

⚠ **`set_config`, never `SET LOCAL <name> = <value>`** — a tested house rule this codebase states in
terms: *"`set_config`, not `SET LOCAL`: `SET` does not accept a parameter, and concatenating a value
into a tenancy control is how injection gets in."* The literal statement text is pinned by a test, so
the new `app.account_id` line must be added to that pinning.

⚠ **Setting `app.customer_id` before the proof is deliberate and stays fail-closed.** The real
middleware issues its statements as **one batch**, and a step that only ran conditionally on an
earlier step's result could not be batched — the batch shape is the part earlier rounds got wrong
empirically. Setting the claimed value up front keeps one batch, and costs nothing: if the claim is
forged there is no membership row, step 4 refuses, and in the meantime every policy keyed on
`app.customer_id` shows that tenant *nothing*, because the forged tenant has no rows the caller can
reach. The proof is step 4's refusal, not the withholding of the setting.

⚠ Step 5's placement is load-bearing and r1 and r2 both omitted it from the path entirely. It must run
**after** `app.customer_id` is set, or the new `EXISTS` policy hides the account row and every
authenticated request 401s. It is a second read on a second table — r3's claim that the role "costs
nothing" because it rides the row the request already fetches was wrong.

⚠ Step 5 is today's most security-critical statement and r1 and r2 both omitted it from the path. Its
**placement is now load-bearing**: run it before step 4 and the new `EXISTS` policy hides the row,
401ing every authenticated request. It is two reads on two tables, not the one r2 claimed.

The `is_admin` claim leaves the token, so a demotion takes effect immediately rather than at the next
15-minute boundary — which matters because the mechanism that covers that today (bumping the security
stamp on a privilege change) is being removed with the column.

⚠ `TenantScopeMiddleware` also writes `app.customer_id`, straight from an unproven value, and never
sets `app.account_id`. It is **not** production wiring — its only use is the tenancy probe app — so it
must not be "deleted" as r2 suggested; it must perform the same step-3 proof, or the probe exercises
half the new predicate and stays green while covering less.

### 4.5 `refresh_token`

Gains `customer_id` (a session belongs to a business) plus its own policy pair, which moves the pinned
catalogue counts. Without it a refresh cannot know which business the user was in.

### 4.6 The guards — three, not two

`policyCount == 2` per tenant table (r2 failed it two ways: one policy on `customer_membership`, three
on `customer.customer` — see §5). Discovery by `customer_id` suffix (which is why §3.1 renames the
preference column). And a **third** guard requires a global query filter, or an argued exemption, for
every customer-owned entity — `CustomerMembership` cannot carry the standard filter, because the
switcher must read across businesses, so it needs an argued `ExemptTables` entry naming that reason.

### 4.7 Wrong turns kept visible

**r1** — no `ENABLE ROW LEVEL SECURITY`, no `REVOKE`; a SELECT-only policy that made the admin surface
impossible; "every other RLS policy is untouched" while `customer_account`'s own policy keyed on the
dropped column; one defence counted where there are two.

**r2** — writes moved to a non-existent owner connection, removing every database backstop from the
most privilege-bearing table; a single policy against a guard demanding two; a preference column named
into tenancy discovery; a migration step writing to a column added later.

**r3** — granted `DELETE` and put the admin proof in `WITH CHECK`, which Postgres **never evaluates for
`DELETE`**. A `viewer` could have wiped every membership in their business, admins included; anyone
could have dropped their own memberships in businesses their token did not name. The escalation probe
r3 specified tested only `UPDATE` and `INSERT`, so the suite would have gone green over it. r3 also
blanket-revoked `UPDATE` on `customer_account` — correct for every call site that existed, wrong for
its own new `active-business` write — and said two different things about what `refresh_token`'s policy
keys on, one of which silently revokes zero rows.

Each was plausible. Three of the four were introduced *while fixing the previous one*. That is why
they are recorded rather than tidied away.

---

## 5. Sessions and switching

`POST /api/v1/auth/active-business { customerId }` verifies membership, rotates the refresh token to
the new business, writes `last_active_business_id`, re-mints. A switch is never a client-side flag.

**Refresh re-proves membership.** Otherwise a removed member loops: request 401s, client refreshes,
refresh re-mints for the business they were removed from, 401s again — the loop the API contract
explicitly warns about. Finding no membership, refresh fails with a **distinct terminal signal** that
makes the client sign out rather than retry.

⚠ **Removal must revoke that member's refresh tokens for that business**, on the same call. Otherwise
"fall back to another membership" turns a stolen cookie bound to A into a valid session for B —
removal becomes re-pointing rather than revocation. The revocation runs in the same transaction as the
delete, while the row is still visible.

**Sign-in** lands on `last_active_business_id` if still a member; else the **oldest** membership by
`created_at` — r2 said "any membership", which is nondeterministic and would land someone in an
arbitrary business to take audited actions in. An account with **zero** memberships gets a named,
terminal answer; that state has never existed and every entry point must handle it.

`GET /api/v1/auth/me` gains `memberships[]` of `{ customerId, tradeName, membershipRole }`.
⚠ `tradeName` lives on `customer.customer`, hidden by its own `id = app.customer_id` policy. r2 added
a second policy there, which fails the exactly-two guard from the other direction. Instead the
**existing** `customer_customer_tenant_isolation` predicate is widened to
`id = app.customer_id OR id IN (SELECT customer_id FROM customer.customer_membership WHERE account_id = app.account_id)`
— one policy, still two on the table. ⚠ It must be `FOR SELECT TO app_customer_role`: r2 wrote a bare
`CREATE POLICY`, which defaults to `FOR ALL TO PUBLIC` and, with no `WITH CHECK`, would have let the
`USING` expression authorise writes to other businesses' customer rows.

⚠ **The policy is layer two; the EF query filter is layer one, and it must change with it.** The
filter on `Customer` is still `customer.Id == ctx.CustomerId`, so `memberships[].tradeName` resolves
to the active business alone no matter what the policy permits. The filter — not the policy — is what
this query needs widened; reaching for `IgnoreQueryFilters()` instead would drop layer one for the
whole query and is the wrong tool.

`CurrentAccountResponse` loses `isAdmin`, gains `membershipRole` and `memberships[]` — not purely
additive. No auth or company route is in the frozen slice-2 sections.

---

## 6. The admin surface

### 6.1 Invitations

Password-reset token mechanics (32 random bytes, SHA-256 stored, single-use, `REVOKE ALL` plus RLS)
with `[F13-R21]`'s **14-day** lifetime — an invitation is not urgent; r1 copied the reset flow's hour.
⚠ If the invitation table carries `customer_id` it is discovered by the coverage guards and needs a
**policy pair**, the same trap §4.2 exists to warn about.

`POST /api/v1/company/invitations { email, membershipRole }` answers **`202` always** — existing login,
no login, or already a member. The throttle counts every request outside the branch; the known branch
swallows and logs its own failures, because a `500` reachable from one branch only is itself the
oracle. Mail is enqueued, never awaited.

**Both accepts run in the auth realm, on the owner connection — and this is the one place that is
correct.** ⚠ r3 said only the unknown-address accept was anonymous, which left the *known*-address
accept with no writable path at all: run it authenticated and `app.customer_id` is the invitee's
**current** business, so §4.2's `WITH CHECK` fails on the tenancy term; and `is_admin_of(invitee,
target)` is false because the row being inserted is the very thing that would make it true. The accept
is authorised by **the invitation token**, not by tenancy — exactly like the other token-bearing auth
flows — so it belongs on the owner connection with the token as the proof. This is not the r2 mistake:
r2 moved *tenant-scoped admin verbs* off RLS; this is an auth-realm operation that was never tenant
scoped, and it is the same posture sign-in and password-reset completion already use. Both accepts go
on the anonymous-endpoint allow-list deliberately.

### 6.2 Role change and removal

`PATCH /api/v1/company/memberships/{accountId}` changes the role; `DELETE` of the same URL **removes
by setting `removed_at`** (§3.1) — the verb is `DELETE`, the SQL is an `UPDATE`, and that is the whole
reason removal is guarded at all. Both are `CompanyAdmin`, both audited as `[DEC-150]` established,
both under RLS with the §4.2 `WITH CHECK`, both carrying an explicit `AND customer_id = @active`.

⚠ `CompanyAdmin` proves *"admin of the business in my token"*, never *"this accountId is in that
business"* — the explicit predicate is what proves the second, and the `WITH CHECK` is what catches a
handler that forgets it.

### 6.3 Refusals

Named policies or domain refusals only — a bare `403`, however spelled, is caught by an IL scan that
looks for the integer literal.

### 6.4 The floor

Membership changes bypass four-eyes (decision 6). The floor survives: **two** admins for a four-eyes
business, one otherwise.

⚠ **The floor is a check-then-act and must be serialized.** Counting the admins and then removing one
are two statements; under the connection's default READ COMMITTED isolation, two admins removing each
other at the same instant each read a count of two and **both succeed, leaving zero admins** — the
state `[F13-R41]` forbids repairing with a "first account is admin" rule. The count therefore takes
`SELECT … FOR UPDATE` over the business's admin rows inside the same transaction as the removal.

⚠ **The corpus is split on whether a floor is a refusal or a warning**, and r2 asserted refusal without
noting it: C9, `[F01-R16]` and `[F01-R50]` read as refusal; `[F12-R43]` says explicitly *"It is not
refused — the account may be a leaver"*, as do F12 and F13 §6. This design chooses **refusal** for the
customer-side verbs and leaves the employee-side warning untouched, and says so rather than implying
the corpus agrees. The **enable-side** floor — C8, `[F01-R43]`, FE-1, `[F12-R41]`, which govern turning
four-eyes *on* — is unchanged and out of scope.

---

## 7. The client

All five client findings were confirmed accurate against the code. Both root stores reset on a
**boolean**, so replacing the token propagates nothing; each memoises a `shareReplay` in a plain class
field, so clearing the signal replays the old business with no HTTP call; `CompanyStore` has no reset;
the rail resource is keyed on the same boolean; nothing is cancellable, so an in-flight request from
the old business can write into a just-cleared store.

Minimum change: key resets on the active `customerId`; a real `reset()` nulling signal **and** memo; a
generation counter; re-key the nav resource; make the bottom-left block a real control. A switch
returns to the dashboard rather than re-resolving a route that may not exist in the new business. The
app spec's *"offers no way to switch accounts"* is inverted, not deleted.

---

## 8. Scope

**In.** §3–§7, the F12 employee surface (§3.4), the route-table and sample-body registrations the new
endpoints need, and the three guard updates (§4.6).

**Out.** Any behavioural difference between `trader` and `viewer`. A back-office screen for
memberships — `[OQ-105]`; support cannot answer *"which businesses is this person in?"* without SQL,
and it is worse than `[DEC-150]`'s equivalent gap. Transferring a business. Leaving one on your own
initiative. SSO.

---

## 9. Sequencing

1. **Additive schema** — `last_active_business_id`, `customer_membership` with grants and both
   policies, backfill, first-admin repair. Both old columns stay. Nothing observable.
2. **Re-point the three policies and the EF filter at membership**, add `refresh_token.customer_id`,
   `REVOKE UPDATE, DELETE` on `customer_account`. Both proofs now hold at once. Nothing observable.
3. **Role off the token onto `ICustomerContext`**; `CompanyAdmin` reads the context. Observable only in
   that demotion becomes immediate — an improvement, stated as one.
4. **Drop `customer_id` and `is_admin`**; sweep the dozen sites and the F12 surface. The suite staying
   green is the test that 1–3 were complete.
5. **`me`, `active-business`, refresh re-proof, sign-in fallback, zero-membership state.**
6. **Rail switcher and store invalidation.**
7. **Invitations, role change, removal, the floor.**

Steps 1–3 are additive and reversible; step 4 is the irreversible one and is deliberately last among
the schema work. ⚠ r2 dropped `is_admin` in step 1, before anything replaced the claim the token and
the `CompanyAdmin` policy both read.

---

## 10. Testing

**Cross-tenant probe.** An account with memberships in A and B, holding a valid token for A, cannot
read B by any route — forged claim, replayed token, switched-then-reverted refresh token. An account
naming a company it is not a member of is refused before `app.customer_id` is ever set.

**Escalation probe** (r1 would have failed it). As an ordinary `trader`, attempt
`UPDATE customer_membership SET role='admin'` and an `INSERT` naming another company through the app
role. Both refused — and the test asserts the **grant and the `WITH CHECK`**, not merely the outcome.

**Removal probe** (r3 would have failed it, and r3's own escalation probe would have stayed green over
it, because it tested only `UPDATE` and `INSERT`). As an ordinary `viewer` acting for B, attempt
`DELETE FROM customer_membership WHERE customer_id = <B>` and
`DELETE … WHERE account_id = <self>` through the app role. Both must fail on the **grant** — there is
no `DELETE` grant to revoke a policy argument about — and the test asserts the absent privilege
directly, because a policy cannot guard a `DELETE`.

**Concurrency probe.** Two admins of a four-eyes business removing each other simultaneously: exactly
one succeeds, the business keeps two admins, and neither transaction leaves it at zero.

**Floor-count probe** (r2 would have failed it). An admin of a four-eyes business who is also sole
admin of a self-registered shell business cannot remove the other admin of the first.

**Cross-tenant account reach.** An admin of B cannot update the `password_hash` or `security_stamp` of
a person who is also a member of A.

Removal takes effect on the next request, revokes that business's refresh tokens, and does not disturb
sessions elsewhere. Refresh after removal terminates rather than looping. Sign-in with zero
memberships is a named answer. The invitation endpoint is indistinguishable for known and unknown
addresses in status, body **and** timing.

Every one is verified by mutation.

---

## 11. Proposed specification changes

`[DEC-152]` records this design and every row of §1.1 as an explicit reversal — including F13 §6's
"Not supported", `[F01-R49]`, `[F01-R15]`'s stranded status, and api-contracts §2.10's closed list of
five. `[F13-R23]` and `[F01-R14]` are annotated as upheld. `[F01-R13]` and `[F13-R12]` carry the
naming resolution of §3.2. `[OQ-105]` records the back-office gap.

---

## 12. Open items

1. **What does the invitation email say to someone who already has a login?** It must not imply a new
   account, nor name the businesses they are already in.
2. **Does the F12 back office keep its own account-creation path**, or become the same invitation flow
   with an employee actor?
3. **Does the member list show colleagues' other businesses?** The §4.2 `OR` makes them readable; §8
   treats that as a disclosure to avoid, and the explicit `customer_id` predicate prevents it.
