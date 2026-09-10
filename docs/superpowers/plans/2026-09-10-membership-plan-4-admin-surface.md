# Multi-business membership — Plan 4: the admin surface

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship design §6 — invitations, role change, removal and the admin floor — plus the web
half that replaces the read-only account list with a member-management screen and an invite form.
An admin of a business may bring somebody in, change what they are, and take them out; the
database refuses every one of those writes to anybody who is not an admin of the business their
token names, and refuses the last removal that would leave the business under its admin floor.

**Architecture:** Two verbs on two resources, both under the customer host's existing two tenancy
layers. Layer 1 is the EF Core global query filter; layer 2 is PostgreSQL row-level security. The
invitation table is a fourth credential table shaped exactly like `customer.password_reset_token`
— 32 CSPRNG bytes, a SHA-256 hex digest stored, single use — with `[F13-R21]`'s **fourteen-day**
lifetime rather than the reset flow's hour. It carries `customer_id`, so both row-level-security
coverage guards discover it and it ships the mandatory **policy pair**. Issuing an invitation is a
`CompanyAdmin` write on the tenant connection; **redeeming** one is anonymous on the owner
connection, authorised by the token and not by tenancy, because a known-address accept has no
writable tenant-scoped path at all (see Global Constraints, "Why both accepts are anonymous").
Removal is an `UPDATE` setting `removed_at` — the HTTP verb is `DELETE` and the SQL never is —
and the admin floor is a check-then-act serialised by `SELECT … FOR UPDATE` over the business's
admin rows inside the request's own transaction.

**Tech Stack:** .NET SDK 10.0.400 · `net10.0` · `LangVersion latest` · `Nullable enable` ·
`TreatWarningsAsErrors` · `AnalysisMode Recommended` · EF Core 10.0.11 · Npgsql 10.0.3 ·
`EFCore.NamingConventions` 10.0.1 · PostgreSQL 17 · xunit.v3 · Shouldly 4.3.0 (⚠ **never
FluentAssertions** `[DEC-118]`) · Dapper 2.1.66 · Testcontainers.PostgreSql · Verify.XunitV3
30.15.0 · Docker (daemon running) · Angular 22, zoneless, signals · Vitest (`describe`/`it`/
`expect` from `vitest`, **not** Jasmine)

**Spec:** `docs/superpowers/specs/2026-09-10-multi-business-membership-design.md`
**Shared contract:** `docs/superpowers/plans/2026-09-10-membership-shared-contract.md`

---

## Global Constraints

### Repositories

```
specs    = /Users/thinhhuynh/PeakPower/peakpowerspecs/.claude/worktrees/peakpower-poc-plan-a41ba9
platform = /Users/thinhhuynh/PeakPower/peakpower-platform
web      = /Users/thinhhuynh/PeakPower/peakpower-web
```

Tasks 1–11 commit in **`peakpower-platform`**. Tasks 12–15 commit in **`peakpower-web`**. This
plan writes nothing in the specs repository.

⚠ **Always `git -C <path>` and always absolute paths.** The shell working directory is not stable
between calls in this environment.

### Copied verbatim from the shared contract — normative, not this plan's to redefine

**§3 Naming.**

| Thing | Name |
| --- | --- |
| The table | `customer.customer_membership` |
| The role column | `customer_membership.role` |
| The wire field | **`membershipRole`** |
| The preference column | **`last_active_business_id`** — ⚠ never `last_customer_id` |
| The soft-delete column | `removed_at` |
| The admin predicate | `customer.is_admin_of(uuid, uuid)` |
| Role values | `'admin'`, `'trader'`, `'viewer'` |

Policy names follow `{schema}_{table}_tenant_isolation` and `{schema}_{table}_back_office`.

**§5 Grants and policies** (created by plan 1's migration 15; plan 4 reads them and adds a second
table in the same shape):

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

⚠ **No `DELETE` grant, ever.** PostgreSQL evaluates `WITH CHECK` for `INSERT` and for an
`UPDATE`'s new row and **never for `DELETE`**, which `USING` alone governs — and this `USING` has
no admin term. Removal is an `UPDATE` setting `removed_at`.

⚠ **The permissive `OR` in `USING` does not scope a count.** The `account_id` arm makes the
caller's memberships in *other* businesses visible while acting for this one. **Every admin query
in this plan carries an explicit `AND customer_id = @active`**, and above all the floor count:
without it, an admin of a four-eyes business who is also sole admin of a self-registered shell
business makes the count read two when the business has one.

**§5.3 Column-scoped grants** (also plan 1's):

```sql
REVOKE UPDATE, DELETE ON customer.customer_account FROM app_customer_role;
GRANT  UPDATE (last_active_business_id) ON customer.customer_account TO app_customer_role;
GRANT  INSERT ON customer.refresh_token TO app_customer_role;
GRANT  UPDATE (used_at, replaced_by_token_id) ON customer.refresh_token TO app_customer_role;
```

`customer.refresh_token` already held `SELECT` plus `UPDATE (revoked_at)` from migration 3
(`20260828100211_AuthAndOnboarding.cs:161-163`). **`UPDATE (revoked_at)` is the grant Task 8's
token revocation runs on.**

**§5.2 The replaced policies.** `customer.refresh_token` keys on **its own `customer_id` column**,
not on an `EXISTS` through membership — because Task 8 revokes a removed member's tokens in the
same transaction as the removal, and an `EXISTS`-through-membership policy would see that removal,
find no active membership and **revoke zero rows silently**.

**§7 Types that cross plan boundaries** (plan 1 declares them; this plan consumes them):

```csharp
// PeakPower.Domain/Customers/MembershipRole.cs
public enum MembershipRole { Admin, Trader, Viewer }   // db spelling: 'admin' | 'trader' | 'viewer'

// PeakPower.Domain/Customers/CustomerMembership.cs
public sealed class CustomerMembership
{
    public Guid AccountId { get; private set; }
    public Guid CustomerId { get; private set; }
    public MembershipRole Role { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset? RemovedAt { get; private set; }

    public bool IsActive => RemovedAt is null;
    // ⚠ Result<T>, not the bare type — the house pattern for a factory that can refuse. Every call
    //   site in this plan writes `.Value` (contract §7 and §13.2).
    public static Result<CustomerMembership> Create(Guid accountId, Guid customerId, MembershipRole role, DateTimeOffset at);
    public void ChangeRole(MembershipRole role);
    public void Remove(DateTimeOffset at);
    public void Restore(DateTimeOffset at);
}

// PeakPower.Application/Abstractions/ICustomerContext.cs — MODIFIED by plan 1
public interface ICustomerContext
{
    Guid CustomerId { get; }
    Guid AccountId { get; }
    MembershipRole Role { get; }          // REPLACES bool IsAdmin
    bool IsAuthenticated { get; }
}
```

**§8 Wire contracts — the five routes this plan owns:**

| Route | Method | Auth |
| --- | --- | --- |
| `/api/v1/company/memberships` | GET | `CompanyAdmin` |
| `/api/v1/company/memberships/{accountId}` | PATCH `{ membershipRole }` | `CompanyAdmin` |
| `/api/v1/company/memberships/{accountId}` | DELETE (⚠ SQL is an `UPDATE`) | `CompanyAdmin` |
| `/api/v1/company/invitations` | POST `{ email, membershipRole }` → **202 always** | `CompanyAdmin` |
| `/api/v1/company/invitations/accept` | POST `{ token }` | **anonymous** |

⚠ **Both invitation accepts are anonymous and run on the owner connection.** The invitation token
is the authorisation, not tenancy.

**§11 Testing conventions — the two probes this plan must ship:**

| Probe | Must prove |
| --- | --- |
| **Indistinguishable invite** | Known and unknown addresses match in status, body **and** timing; the throttle counts both |
| **Concurrency** | Two admins removing each other: exactly one succeeds, the business never reaches zero admins |

### Why both accepts are anonymous — design §6.1, restated because Task 5 depends on it

An account that **already has a login** and is invited into a second business cannot accept that
invitation on an authenticated connection. Two independent reasons, and both are fatal:

1. `app.customer_id` on an authenticated request is the invitee's **current** business, not the
   inviting one. §5's `WITH CHECK` first term is
   `customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid`, and the row being
   inserted names the *inviting* business. The term is false. `42501`.
2. The second term is
   `customer.is_admin_of(app.account_id, app.customer_id)` — and even with `app.customer_id`
   somehow set to the inviting business, the invitee is not an admin of it. The row being inserted
   is the very thing that would make that predicate true. The term is false. `42501`.

So the known-address accept fails on **both** terms of the `WITH CHECK`, not one. Running it
anonymously on the owner connection is not the r2 mistake the design records — r2 moved
*tenant-scoped admin verbs* off row-level security; this is an auth-realm operation that was never
tenant scoped, and it is the identical posture sign-in, refresh and password-reset completion
already use (convention C3). The unknown-address accept is anonymous for the ordinary reason:
there is no account yet, so there is nothing to authenticate.

Both accepts are one route, and it goes on
`tests/PeakPower.Integration.Tests/Auth/AnonymousEndpointAllowListTests.Expected`
**deliberately**, with its reason spelled at the `.AnonymousEndpoint(reason)` call site.

### Refusals — named, never a bare 403

`tests/PeakPower.Architecture.Tests/TenancyArchitectureTests.no_type_produces_a_forbidden_response`
scans compiled IL for `Results.Forbid`, `ForbidAsync` and **the Int32 literal 403**, however it was
spelled — `StatusCodes.Status403Forbidden` is a `const int`, so the compiler inlines it and the IL
is identical. The one documented exception is a 403 produced by ASP.NET Core's own authorization
middleware, which is why "you are signed in but you are not an admin here" is expressed as
`.RequireAuthorization(CustomerAuthorizationPolicies.CompanyAdmin)` and never as an `if` in a
handler.

Every other refusal in this plan is one of:

- `ApiResults.NotFound()` — 404, a constant body, for a membership that is not this business's
  `[F13-R19]`;
- `ApiResults.InvalidRequest(property, error)` — 400 `HttpValidationProblemDetails`, for a request
  this endpoint cannot parse;
- `ApiResults.Conflict(detail)` — 409 `ProblemDetails`, for the admin floor, for self-removal, and
  for an invitation that cannot be used.

### Auditing — `[DEC-150]`, and `EntitlementEndpoints` is the working precedent

Every membership write records an `audit.audit_record`. Migration 2 grants `app_customer_role`
`INSERT` on that table and revokes `UPDATE` and `DELETE`, so a customer appends to its own history
and can neither rewrite nor erase it `[F01-R06]`. `AuditRecord.Create` returns a
`Result<AuditRecord>` and refuses only a blank actor, action or entity type — all three are
constants at every call site here, so the result is **guarded and never dereferenced**, exactly as
`EntitlementEndpoints.Audit` does it.

Actor spelling is `AuditRecord.Actor`'s own recorded convention: `account:{id}`.

### The four coverage guards this plan moves

`customer.customer_invitation` carries `customer_id`, so — exactly as design §6.1 warns — **both**
row-level-security coverage guards discover it and it needs a policy pair, and both query-filter
guards discover the entity. Four pinned literals move, all in Task 3:

| File | Literal |
| --- | --- |
| `tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs` | the `expected` name array in `every_entity_type_that_owns_a_customer_id_has_a_global_query_filter`, and `filtered.Length.ShouldBe(n)` |
| `tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs` | `AutomaticPolicyCoverageTests`: `customerIdOwned.Length` and `customerOwned.Length` |
| `tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs` | `CatalogPolicyCoverageTests`: `customerIdTables.Count` and `tables.Count` |

⚠ **Each of those numbers is `<whatever plan 1 left> + 1`, and Task 3 step 1 reads the current
value out of the file before changing it.** Verified in this repository on 2026-09-10, **before**
plan 1: `QueryFilterModelTests` `expected` holds 14 names and `filtered.Length.ShouldBe(10)`;
`AutomaticPolicyCoverageTests` holds `12` / `2` / `12`; `CatalogPolicyCoverageTests` holds `12` /
`2` / `12`. Plan 1 adds `CustomerMembership` (a `customer_id` with a policy pair and an **argued
`ExemptTables` entry** rather than a query filter, contract §9 item 3) and puts `customer_id` on
`refresh_token`. Whatever those leave, plan 4 adds exactly one table and one filtered entity.

### The three places that pin the ordered migration list

All three grow by one entry in the same commit as migration 17 (Task 1):

- `tools/verify-migrator.sh:51` (the `case` pattern) and `:52-59` (the failure message)
- `tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs:32` (the method name),
  `:40` (`migrationIds.Length.ShouldBe(14)`) and `:41-54`
- `tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs:32`
  (`applied.Length.ShouldBe(14)`) and `:33-46`

⚠ **Those line numbers and that `14` are today's file, before plans 1 and 2.** Both of those plans
add a migration and must grow all three places themselves (contract §13.1), so by the time this plan
runs the pinned length reads **16** and every line below it has shifted. Read the real value out of
the file; never paste `14` back.

Fourteen migrations exist today, ending `_DayAheadPriceSource`. Contract §13.1 hands out three
numbers: plan 1 owns **15**, plan 2 owns **16** (`WidenCustomerVisibilityToMemberships`), and plan
4's is **migration 17**, named `CompanyInvitations`. ⚠ Plans 2 and 4 both claimed 16 as authored;
this plan's is **17**.

### Web rules

- **Real design tokens only:** `--text-2xs --text-xs --text-sm --text-base --text-md`,
  `--pp-text-heading --pp-text-body --pp-text-faint`, `--pp-border --pp-surface --font-mono`.
  `apps/customer-portal/src/app/shared/design-tokens.spec.ts` fails by file and token name on
  anything else, and an undeclared custom property renders as nothing with every DOM assertion
  still green.
- ⚠ **A backtick inside an Angular inline template literal closes the template early.** Never use
  one — not in copy, not in a comment inside the template.
- Dates are **en-US** (`formatProductDateTime`). Dutch NUMBER formatting (`1.234,56`, U+2212) must
  never change; nothing in this plan renders a number.
- `apps/**` may declare no custom property of its own.

### Commands

```bash
# platform
cd /Users/thinhhuynh/PeakPower/peakpower-platform
docker info > /dev/null                                     # the daemon must be running
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln --nologo
dotnet ef migrations add CompanyInvitations \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator \
  --output-dir Migrations --context PeakPowerDbContext
tools/verify-migrator.sh

# web — run these individually; `npm run test` also runs verify:clients, which fails whenever
# the platform's OpenAPI has moved and the client has not been regenerated
cd /Users/thinhhuynh/PeakPower/peakpower-web
npm run generate:clients
npx ng test shared-ui       --watch=false
npx ng test customer-portal --watch=false
npx ng test employee-portal --watch=false
```

⚠ **rtk truncates and sometimes fabricates shell output.** Redirect to a file and read the file
back before concluding anything. Never conclude from a bare `grep`/`find`/`ls` that scrolled.

⚠ **`cp -a` preserves mtimes and leaves MSBuild with stale binaries.** When restoring a mutated
file, use plain `cp` or `touch` the restored file, or the rebuild is skipped and you retest the
mutation.

⚠ Integration tests use Testcontainers. Running several suites in parallel across worktrees can
exhaust connections and produce mass Postgres timeouts — retry before reporting a regression.

### Verify by mutation — the house standard

A green test is not evidence. Every task that adds a test breaks the production code on purpose,
**predicts the exact failure**, runs it, confirms the prediction, restores, and proves the restore.
Report the mutation output in the commit message. A mutation that breaks the *build* proves nothing
about an assertion. Mutate the case your assertion is actually for, not the easy neighbouring one.

---

## Deviations from the shared contract, and decisions this plan takes

The contract is normative and this plan follows it, with **one wire deviation** and one route
spelling worth flagging. Both are here so a reviewer finds them in one place.

### D1 — the accept body is `{ token }` **plus three optional fields**, and it has to be

Contract §8 fixes the accept body as `POST { token }`. **That body cannot complete an accept for
an address with no existing login**, and the contract does not say what should happen instead:

- `CustomerAccount.Create` requires a first name and a last name
  (`src/Core/PeakPower.Domain/Customers/CustomerAccount.cs:71-74`: *"First and last name are
  required."*), and an account with no `PasswordHash` can never sign in — `SignInTests`' path
  verifies against `DummyHash` and fails closed.
- The invitation itself carries `{ email, membershipRole }` (contract §8) and no name.
- There is no other endpoint on this host that could set them: `PATCH /company/accounts` does not
  exist, and `POST /auth/password-reset/requests` needs an account that already exists.

So the accept contract in this plan is:

```csharp
public sealed record CompanyInvitationAcceptance(
    string Token, string? FirstName, string? LastName, string? Password);
```

`{ token }` alone — exactly the contract's shape — is a **complete and successful** request for an
address that already has a login. For an address that does not, the endpoint answers **400 with an
`errors` map naming `firstName`, `lastName` and `password`**, writes nothing, and leaves the
invitation unspent; the portal then reveals those three fields and posts again. That is why there
is no preflight route and no "does this address have a login" endpoint: the only party who ever
learns the answer is the person holding a 256-bit token out of that address's own inbox.

**Recorded for the contract owner.** If the contract prefers to keep `{ token }` literally, the
only alternative is to create the account with a name derived from the email local part and mail a
second credential — an account called "j.devries" and two emails per invitation. This plan chose
the extra fields.

### D2 — the route pattern is `{accountId:guid}`, not `{accountId}`

Contract §8 writes `/api/v1/company/memberships/{accountId}`. The house convention constrains an
identifier segment (`GET /api/v1/metering-points/{id:guid}`,
`PATCH /api/v1/metering-points/{id:guid}/naming`), and
`CustomerApiRouteTableTests.ExpectedRouteTable` pins `RoutePattern.RawText` **including the
constraint**. Without `:guid` a non-Guid segment is a 400 out of model binding rather than a 404 at
routing, which is the wrong answer under `[F13-R19]`. Same route, house spelling.

### D3 — `GET /company/memberships` returns pending invitations alongside members

The contract fixes the route and its authorisation, not its response shape. An admin who cannot see
that an invitation is outstanding re-invites the same person weekly. The response therefore carries
two lists:

```csharp
public sealed record CompanyMembershipsResponse(
    IReadOnlyList<CompanyMemberDto> Members,
    IReadOnlyList<CompanyInvitationDto> PendingInvitations);
```

This is why `app_customer_role` is granted `SELECT` — as well as `INSERT` — on
`customer.customer_invitation` (Task 1).

### D4 — the accept's own refusal is 409, not 400

`POST /auth/password-reset/completions` answers 400 for an unusable code, and this endpoint's
`400` is already taken by D1's `HttpValidationProblemDetails`. Two different bodies on one status
is exactly what `CustomerResponseMetadataTests` exists to stop. So an invitation that is unknown,
already accepted or expired answers **409 `ProblemDetails`, one body for all three**, through
`ApiResults.Conflict`. Telling those three apart would make the endpoint an oracle for grinding
tokens; 409 is also the honest verb — the request is well formed and the state of the world is
what refuses it, which is the reading `EntitlementEndpoints` already uses for a coming-soon code.

### D5 — an admin may not remove their own membership

Design §8 puts *"Leaving [a business] on your own initiative"* out of scope. `DELETE
/company/memberships/{self}` is that action wearing the admin verb's clothes, so it is refused with
a named 409. It is not the floor: refusing it is what keeps "leaving" out of scope while the floor
keeps the business governable.

### D6 — `MembershipRole` is lowercase on the wire AND in the database, and does **not** go through `EnumWireFormat`

Contract §3 fixes the role values as `'admin'`, `'trader'`, `'viewer'` and §8 spells the wire field
`membershipRole: 'admin' | 'trader' | 'viewer'`. `EnumToScreamingSnakeConverter` and
`EnumWireFormat` would both produce `ADMIN`. So:

- The EF mapping carries an **explicit** `HasConversion` (Task 3).
  `EnumToTextConvention` is an `IModelFinalizingConvention` that calls
  `property.Builder.HasConversion(converter)` at `ConfigurationSource.Convention`, so an explicit
  fluent conversion wins — verified by Task 3's own round-trip test against a real container.
- ⚠ **The wire spelling lives in `PeakPower.Domain.Customers.MembershipRoleWire`, which this plan
  CONSUMES and never extends** (contract §13.2.1 — one home, one shape, owned by plan 1; the domain
  and not the host, because `PeakPower.Persistence`'s value converter needs it and Persistence may
  not reference a host). It is deliberately not a `PortalMappings.Wire` overload, so
  `CompanyEndpointTests.Every_wire_spelling_PortalMappings_produces_is_the_shared_converters_spelling`
  — which enumerates its types by hand and holds every overload to `EnumWireFormat` — never has to
  carve out an exception. `MembershipRoleWireTests` is that type's own pin, plan 1's to write, and
  it covers both directions; Task 6 keeps one consumer-side round-trip assertion and nothing more.
- ⚠ Wire input is parsed with **`MembershipRoleWire.TryParse(string?, out MembershipRole)`**
  (§13.2.1). Not `Parse(string?) -> MembershipRole?`: reference nullability does not differentiate
  an overload against plan 1's `Parse(string) -> MembershipRole`, so declaring one is `CS0111`.
- `EnumWireValuesSchemaTransformer` registers `MembershipRoleWire.Values`, not
  `EnumWireFormat.Names<T>()` — the same entry shape the upstream plan already used for
  `CurrentAccountResponse` and `AccountMembershipDto`.

### D7 — the invitation's write is wrapped in a savepoint

`POST /company/invitations` is authenticated, so `CustomerSessionMiddleware` has **already opened a
transaction** for it and commits after the handler returns
(`src/Infrastructure/PeakPower.Infrastructure.Web/Tenancy/CustomerSessionMiddleware.cs:61,123`).
A swallowed `DbUpdateException` inside that transaction leaves PostgreSQL in the aborted state
`25P02`, and the middleware's own `CommitAsync` then throws — so the 500 the swallow exists to
prevent comes back, one layer up, on exactly the one branch that reaches a write. The handler
therefore takes a savepoint before the write and rolls back to it in the catch. This has no
analogue in the password-reset flow, which is anonymous and has no ambient transaction to poison.

### Open items this plan records rather than closes

1. **The invitation email's copy for somebody who already has a login** (design §12 item 1,
   contract §12 item 1) is open. This plan sends **one** message for both cases, worded so it
   implies neither a new account nor an existing one and names no business the recipient is already
   in. That is a deliberate resolution of the timing probe rather than an answer to the copy
   question: composing two different strings would be constant-time, but choosing between them
   requires knowing whether the address has a login, and this handler is built so that it cannot
   find out (Task 4).
2. **`[OQ-105]`** — the back office still has no membership screen. Support cannot answer *"which
   businesses is this person in?"* without SQL. Unchanged by this plan.
3. **A removed member's outstanding invitations are not revoked.** Removing somebody who also holds
   an unspent invitation to the same business leaves that invitation usable for its remaining
   fourteen days, and accepting it restores the membership. Re-inviting a removed person is
   `Restore`, so this is coherent rather than a hole — but an admin who removes somebody they
   invited an hour ago will not expect it.

---

## Domain terms used in this plan

- **Membership** — one row of `customer.customer_membership`: this account, in this business, as
  this role, since this moment, until `removed_at`. Never deleted.
- **Business** — a `customer.customer` row. The design's word for a tenant, because "customer" is
  ambiguous once one person belongs to several.
- **Admin floor** — the minimum number of active admin memberships a business must keep: **two**
  for a four-eyes business (`customer.four_eyes_enabled`), **one** otherwise (design decision 7).
- **Four-eyes** — `customer.four_eyes_enabled`, the flag that makes certain actions need a second
  approver. Membership changes **bypass** it (design decision 6); the floor is what survives.
- **Invitation** — one row of `customer.customer_invitation`: an email address, a role, a business,
  and the SHA-256 digest of a 32-byte token that was mailed once and never stored.
- **Owner connection** — the customer host's default connection, logged in as the table owner,
  which row-level security does not apply to. Every anonymous endpoint runs on it because
  `CustomerSessionMiddleware` returns early for an unauthenticated request (convention C3).
- **Tenant connection** — the same connection after that middleware has issued
  `SET LOCAL ROLE app_customer_role` and set `app.account_id` and `app.customer_id`.

---

## Preflight — do all of this before Task 1

Plans 1, 2 and 3 must be complete and green. This plan consumes six things from them, and every one
is checked here rather than discovered halfway through Task 4.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
docker info > /dev/null                                # must exit 0
dotnet --version                                       # must print 10.0.400
dotnet build PeakPower.sln --nologo -warnaserror       # must be green
dotnet test PeakPower.sln --nologo                     # must be green
```

Then read each consumed signature into a file and compare it against what this plan assumes. **Do
not skim the terminal — rtk truncates.**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
{
  echo '== 1. MembershipRole =='
  cat src/Core/PeakPower.Domain/Customers/MembershipRole.cs
  echo '== 2. CustomerMembership =='
  cat src/Core/PeakPower.Domain/Customers/CustomerMembership.cs
  echo '== 3. ICustomerContext =='
  cat src/Core/PeakPower.Application/Abstractions/ICustomerContext.cs
  echo '== 4. CustomerAccount.Create =='
  grep -n 'public static Result<CustomerAccount> Create' -A 14 src/Core/PeakPower.Domain/Customers/CustomerAccount.cs
  echo '== 5. RefreshToken.CustomerId and Issue =='
  grep -n 'CustomerId\|public static RefreshToken Issue' -A 10 src/Core/PeakPower.Domain/Customers/RefreshToken.cs
  echo '== 6. MembershipRoleWire — declared upstream in the DOMAIN, consumed here =='
  cat src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs 2>/dev/null || echo 'MISSING'
  grep -rn 'MembershipRoleWire' src/Core src/Hosts || echo 'NONE'
  grep -rn 'MembershipRole' src/Hosts/PeakPower.Api.Customer src/Core/PeakPower.Contracts || echo 'NONE'
  echo '== 7. the DbSet =='
  grep -n 'CustomerMemberships' src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs
  echo '== 8. the membership exemption =='
  grep -n 'CustomerMembership' tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs \
                               tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs
} > /tmp/plan4-preflight.txt 2>&1
cat /tmp/plan4-preflight.txt
```

What this plan assumes, item by item:

1. `public enum MembershipRole { Admin, Trader, Viewer }` in `PeakPower.Domain.Customers`.
2. `CustomerMembership` exactly as contract §7 spells it, with `Create`, `ChangeRole`, `Remove`,
   `Restore` and `IsActive`. ⚠ `Create` returns **`Result<CustomerMembership>`**, not the bare type
   (contract §7, §13.2); every call site in this plan writes `.Value`. If it returns the bare type,
   drop the five `.Value`s and say so in the commit message.
3. `ICustomerContext` exposes `CustomerId`, `AccountId`, `MembershipRole Role`, `IsAuthenticated`,
   and **no** `IsAdmin`.
4. `CustomerAccount.Create` has lost its `customerId` and `isAdmin` parameters and is otherwise
   unchanged:
   `Create(string username, string firstName, string lastName, string? jobTitle, string email, string? phone, AccountStatus status)`.
   ⚠ **If the parameter list differs, adapt Task 5 step 3 and every arrange helper in Tasks 6–11 to
   the real one, and say so in the commit message.** Nothing else in this plan depends on it.
5. `RefreshToken` carries a `CustomerId` and `Issue` takes it. Task 8 filters on it.
   ⚠ **If `RefreshToken.CustomerId` does not exist, stop.** Task 8's revocation cannot be written
   safely without it (contract §5.2 explains why the `EXISTS` shape revokes zero rows), and that is
   a plan-1 gap, not something to work around here.
6. **`PeakPower.Domain.Customers.MembershipRoleWire` already exists**, at
   `src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs` — the **domain**, not the host.
   ⚠ Contract §13.2.1 settles the home: `PeakPower.Persistence`'s value converter needs the
   spelling and Persistence may not reference a host, so plan 1 puts the type in the domain. An
   earlier revision of this plan looked under `src/Hosts/PeakPower.Api.Customer/Auth/` and stopped
   on `MISSING`; that path is wrong, not the upstream plan.
   Its whole surface, all of it plan 1's (§13.2.1):
   `const string Admin/Trader/Viewer`, `IReadOnlyList<string> Values` (`["admin","trader","viewer"]`),
   `Of(MembershipRole) -> string`, `Parse(string) -> MembershipRole` (throws) and
   **`TryParse(string? value, out MembershipRole role) -> bool`**.
   This plan **consumes** every one of them and declares none — not here, and not mirrored onto
   `PortalMappings`, which is `CS0111` waiting to happen and a silent behaviour fork if it compiles.
   ⚠ `TryParse` is what every handler in this plan calls on wire input. There is deliberately **no**
   `Parse(string?) -> MembershipRole?`: reference nullability does not differentiate an overload
   against plan 1's `Parse(string)`, so that pair is `CS0111` (§13.2.1). If the file is **missing**,
   stop: plan 1 is incomplete and inventing a second copy here is exactly what §13.2 forbids.
7. `PeakPowerDbContext.CustomerMemberships` exists.
8. `CustomerMembership` is named in `QueryFilterModelTests.ExemptEntityTypes` and in **neither**
   `ExemptTables` set (contract §9 item 3: it takes a query-filter exemption, not a policy one).

Then record the four coverage-guard literals as they stand **after** plans 1–3, because Task 3 adds
one to each:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
{
  grep -n 'filtered.Length.ShouldBe' tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs
  grep -n 'string\[\] expected' -A 10 tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs
  grep -n 'customerIdOwned.Length.ShouldBe\|accountIdOwned.Length.ShouldBe\|customerOwned.Length.ShouldBe' \
       tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs
  grep -n 'customerIdTables.Count.ShouldBe\|accountIdTables.Count.ShouldBe\|tables.Count.ShouldBe' \
       tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs
} > /tmp/plan4-guard-literals.txt 2>&1
cat /tmp/plan4-guard-literals.txt
```

Keep `/tmp/plan4-guard-literals.txt`. Task 3 reads it.

---

## File Structure

### `/Users/thinhhuynh/PeakPower/peakpower-platform`

| File | Responsibility |
| --- | --- |
| `src/Core/PeakPower.Domain/Customers/CustomerInvitation.cs` | Create: the invitation aggregate — 14-day life, single use, hash only |
| `src/Core/PeakPower.Contracts/Customer/Portal/MembershipContracts.cs` | Create: the six DTOs the five routes exchange |
| `src/Infrastructure/PeakPower.Persistence/Configurations/CustomerInvitationConfiguration.cs` | Create: table, keys, indexes, the explicit lowercase role conversion |
| `src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs` | Modify: the `CustomerInvitations` `DbSet` and its global query filter |
| `src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_CompanyInvitations.cs` | Create: migration 17 — the table, the grants, the policy pair |
| `src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_CompanyInvitations.Designer.cs` | Create (generated) |
| `src/Infrastructure/PeakPower.Persistence/Migrations/PeakPowerDbContextModelSnapshot.cs` | Modify (regenerated) |
| `src/Hosts/PeakPower.Api.Customer/Onboarding/CustomerPortalLinks.cs` | Modify: `InvitationUrl(string token)` beside `ResetUrl` |
| `src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs` | ⚠ **Not touched.** Plan 1 owns the whole type — `Of`, `Values`, `Parse`, `TryParse` and the three constants (contract §13.2.1). Read only |
| `src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs` | Modify: `ToMemberDto`, `ToInvitationDto`. ⚠ **No `Wire(MembershipRole)` overload** — the role's wire spelling has one home |
| `src/Hosts/PeakPower.Api.Customer/Portal/InvitationEndpoints.cs` | Create: `POST /company/invitations` and `POST /company/invitations/accept` |
| `src/Hosts/PeakPower.Api.Customer/Portal/MembershipEndpoints.cs` | Create: `GET`, `PATCH` and `DELETE` on `/company/memberships` |
| `src/Hosts/PeakPower.Api.Customer/OpenApi/EnumWireValuesSchemaTransformer.cs` | Modify: three `membershipRole` entries carrying the lowercase array |
| `src/Hosts/PeakPower.Api.Customer/Program.cs` | Modify: `app.MapInvitationEndpoints()` and `app.MapMembershipEndpoints()` |
| `tools/verify-migrator.sh` | Modify the `case` pattern and its failure message: append the seventeenth migration |
| `tests/PeakPower.Domain.Tests/Customers/CustomerInvitationTests.cs` | Create: the 14-day life, single use, the usable predicate |
| `tests/PeakPower.Integration.Tests/Migrations/InvitationSchemaTests.cs` | Create: migration 17's columns, indexes, grants and policy pair against a real container |
| `tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs` | Modify `:32`, `:40`, `:41-54` |
| `tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs` | Modify `:32`, `:33-46` |
| `tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs` | Modify: the `expected` name array and `filtered.Length` |
| `tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs` | Modify: `AutomaticPolicyCoverageTests` and `CatalogPolicyCoverageTests` literals |
| `tests/PeakPower.Integration.Tests/Tenancy/CustomerApiRouteTableTests.cs` | Modify: `ExpectedRouteTable`, `TenantScopedParameterisedCount`, `TenantScopedCollectionGetCount` |
| `tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleBodies.cs` | Modify: the new mutating tenant-scoped routes |
| `tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleQueries.cs` | Modify: `GET /company/memberships`, the one new tenant-scoped collection GET |
| `tests/PeakPower.Integration.Tests/Auth/AnonymousEndpointAllowListTests.cs` | Modify: `Expected` gains the accept route |
| `tests/PeakPower.Integration.Tests/Contract/CustomerResponseMetadataTests.cs` | Modify: five entries in `ExpectedResponseContract` |
| `tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json` | Modify (re-verified) |
| `tests/PeakPower.Integration.Tests/Portal/MembershipFixture.cs` | Create: seed a business with N members at chosen roles, and sign one in |
| `tests/PeakPower.Integration.Tests/Portal/InvitationEndpointTests.cs` | Create: issue and accept, both branches |
| `tests/PeakPower.Integration.Tests/Portal/MembershipEndpointTests.cs` | Create: list, role change, removal, the floor, the audit rows |
| `tests/PeakPower.Integration.Tests/Portal/IndistinguishableInvitationTests.cs` | Create: contract §11 probe — status, body, timing, throttle |
| `tests/PeakPower.Integration.Tests/Portal/MembershipConcurrencyTests.cs` | Create: contract §11 probe — two admins removing each other |

### `/Users/thinhhuynh/PeakPower/peakpower-web`

| File | Responsibility |
| --- | --- |
| `libs/api-client-customer/src/generated/customer-schema.d.ts` | Modify (regenerated by `npm run generate:clients`) |
| `libs/api-client-customer/src/lib/customer-api.types.ts` | Modify: the six membership/invitation aliases and the role union |
| `libs/api-client-customer/src/lib/customer-api.client.ts` | Modify: five URL builders and five methods |
| `libs/api-client-customer/src/lib/customer-api.client.spec.ts` | Modify: the five new calls' URLs, verbs and bodies |
| `apps/customer-portal/src/app/shared/labels.ts` | Modify: `membershipRoleLabel` and `membershipRoleTone` |
| `apps/customer-portal/src/app/features/company/company-page.ts` | Modify: the read-only People card becomes the member-management card |
| `apps/customer-portal/src/app/features/company/company-page.spec.ts` | Modify: the People card's new source, controls and admin gating |
| `apps/customer-portal/src/app/features/company/invite-form.ts` | Create: the invite form, admin only |
| `apps/customer-portal/src/app/features/company/invite-form.spec.ts` | Create |
| `apps/customer-portal/src/app/features/company/accept-invitation-page.ts` | Create: the screen the invitation link opens |
| `apps/customer-portal/src/app/features/company/accept-invitation-page.spec.ts` | Create |
| `apps/customer-portal/src/app/app.routes.ts` | Modify: the unguarded `accept-invitation` route |
| `apps/customer-portal/src/app/app.routes.spec.ts` | Modify: the new path in the declared-route list |

---

### Task 1: Migration 17 — `customer.customer_invitation`, its grants and its policy pair

Design §6.1: *"Password-reset token mechanics (32 random bytes, SHA-256 stored, single-use,
`REVOKE ALL` plus RLS) with `[F13-R21]`'s 14-day lifetime… ⚠ If the invitation table carries
`customer_id` it is discovered by the coverage guards and needs a policy pair, the same trap §4.2
exists to warn about."* It does carry one — an invitation is to a business — so it ships the pair.

This is **migration 17**. Fourteen exist today, ending `_DayAheadPriceSource`; plan 1 owns 15
(contract §4, "Plans 2–4 may not add to this migration") and plan 2 owns 16,
`WidenCustomerVisibilityToMemberships` (contract §13.1).

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_CompanyInvitations.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_CompanyInvitations.Designer.cs` (generated)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Migrations/PeakPowerDbContextModelSnapshot.cs` (regenerated)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/InvitationSchemaTests.cs` (create)

**Interfaces:**
- Consumes: `customer.is_admin_of(uuid, uuid)` and the `app.account_id` / `app.customer_id`
  settings, both created by plan 1's migration 15.
- Produces: the table `customer.customer_invitation`; the policies
  `customer_customer_invitation_tenant_isolation` and `customer_customer_invitation_back_office`;
  the grants `SELECT, INSERT` to `app_customer_role` and `SELECT` to `app_employee_role`.

- [ ] **Step 1: Confirm the state this task expects, before writing a line of DDL**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
{
  ls src/Infrastructure/PeakPower.Persistence/Migrations/*.cs | grep -v Designer
  echo '--- is_admin_of ---'
  grep -rn 'is_admin_of' src/Infrastructure/PeakPower.Persistence/Migrations || echo 'MISSING'
  echo '--- customer_invitation must not exist yet ---'
  grep -rn 'customer_invitation' src tests || echo 'ABSENT (expected)'
} > /tmp/t1-before.txt 2>&1
cat /tmp/t1-before.txt
```

Expected: **sixteen** non-Designer migration files — the fifteenth being plan 1's and the sixteenth
plan 2's `…_WidenCustomerVisibilityToMemberships`; `customer.is_admin_of` present in plan 1's
migration; `customer_invitation` absent everywhere. If `is_admin_of` is missing, **stop** — the
`WITH CHECK` below cannot be written and plan 1 is incomplete. If only fifteen files are there, plan
2's migration is missing and step 6's numbers are wrong — stop and read contract §13.1 rather than
renumbering this one.

- [ ] **Step 2: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/InvitationSchemaTests.cs`:

```csharp
using Dapper;
using Npgsql;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Migrations;

/// <summary>
/// What migration 17 actually did to a database, read back out of the catalogue rather than
/// argued from the migration's own source.
/// <para>
/// The privilege facts are the ones that matter most and the ones no other test can see. Migration
/// 2's <c>ALTER DEFAULT PRIVILEGES IN SCHEMA customer … GRANT SELECT, INSERT, UPDATE, DELETE ON
/// TABLES TO app_customer_role, app_employee_role</c>
/// (<c>20260827092246_TenancyRowLevelSecurity.cs:108-110</c>) fires the instant
/// <c>CREATE TABLE</c> runs in this schema, so the table arrives holding <c>arwd</c> for both
/// roles before migration 17's own <c>GRANT</c> is reached. Enumerating what it should have does
/// not remove what it should not — which is exactly how <c>customer.refresh_token</c> sat on a
/// <c>DELETE</c> grant its own migration never asked for.
/// </para>
/// </summary>
public sealed class InvitationSchemaTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private async Task<NpgsqlConnection> OpenAsync()
    {
        var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync(TestContext.Current.CancellationToken);
        return connection;
    }

    [Theory]
    [InlineData("id", "uuid")]
    [InlineData("customer_id", "uuid")]
    [InlineData("email", "citext")]
    [InlineData("role", "text")]
    [InlineData("token_hash", "character varying")]
    [InlineData("invited_by_account_id", "uuid")]
    [InlineData("issued_at", "timestamp with time zone")]
    [InlineData("expires_at", "timestamp with time zone")]
    [InlineData("accepted_at", "timestamp with time zone")]
    public async Task Migration_seventeen_creates_the_column(string column, string dataType)
    {
        await using var connection = await OpenAsync();

        var actual = await connection.ExecuteScalarAsync<string>(
            """
            SELECT CASE WHEN data_type = 'USER-DEFINED' THEN udt_name ELSE data_type END
            FROM information_schema.columns
            WHERE table_schema = 'customer' AND table_name = 'customer_invitation'
              AND column_name = @column
            """,
            new { column });

        actual.ShouldBe(dataType, $"customer.customer_invitation.{column}");
    }

    /// <summary>
    /// citext, so an invitation addressed to "J.deVries@example.nl" is found by a sign-up that
    /// spells it "j.devries@example.nl". customer_account.email is citext for the same reason
    /// (CustomerAccountConfiguration:32), and the accept endpoint joins the two.
    /// </summary>
    [Fact]
    public async Task The_email_column_is_case_insensitive()
    {
        await using var connection = await OpenAsync();

        var udt = await connection.ExecuteScalarAsync<string>(
            """
            SELECT udt_name FROM information_schema.columns
            WHERE table_schema = 'customer' AND table_name = 'customer_invitation'
              AND column_name = 'email'
            """);

        udt.ShouldBe("citext");
    }

    [Fact]
    public async Task The_token_hash_is_unique()
    {
        await using var connection = await OpenAsync();

        var exists = await connection.ExecuteScalarAsync<bool>(
            """
            SELECT EXISTS (SELECT 1 FROM pg_indexes
                           WHERE schemaname = 'customer' AND tablename = 'customer_invitation'
                             AND indexdef LIKE '%UNIQUE%token_hash%')
            """);

        exists.ShouldBeTrue(
            "two invitations sharing a digest would make redemption ambiguous, and the digest is "
            + "the only thing the accept endpoint has to find a row by");
    }

    [Fact]
    public async Task The_role_column_admits_exactly_the_three_contract_values()
    {
        await using var connection = await OpenAsync();

        var definition = await connection.ExecuteScalarAsync<string>(
            """
            SELECT pg_get_constraintdef(oid) FROM pg_constraint
            WHERE conname = 'ck_customer_invitation_role'
            """);

        definition.ShouldNotBeNull();
        // Ordinal, and on the lowercase spelling: shared contract section 3 makes 'admin' |
        // 'trader' | 'viewer' normative in the database as well as on the wire, and Shouldly's
        // ShouldContain is case-insensitive by default - which would pass just as happily over
        // 'ADMIN' and hide exactly the divergence this asserts against.
        definition!.Contains("'admin'::text", StringComparison.Ordinal).ShouldBeTrue(definition);
        definition.Contains("'trader'::text", StringComparison.Ordinal).ShouldBeTrue(definition);
        definition.Contains("'viewer'::text", StringComparison.Ordinal).ShouldBeTrue(definition);
    }

    [Fact]
    public async Task Row_level_security_is_enabled()
    {
        await using var connection = await OpenAsync();

        var enabled = await connection.ExecuteScalarAsync<bool>(
            """
            SELECT c.relrowsecurity FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'customer' AND c.relname = 'customer_invitation'
            """);

        enabled.ShouldBeTrue(
            "ENABLE ROW LEVEL SECURITY plus the REVOKE is the whole protection - migration 2's "
            + "ALTER DEFAULT PRIVILEGES already handed both app roles full DML on this table");
    }

    /// <summary>
    /// Exactly two policies, named. Both coverage guards assert the COUNT; this asserts the NAMES,
    /// because a pinned total stays arithmetically right while a table silently swaps one policy
    /// for another (shared contract section 9 item 2 makes that a requirement in its own right).
    /// </summary>
    [Fact]
    public async Task The_table_carries_exactly_the_tenant_isolation_and_back_office_policies()
    {
        await using var connection = await OpenAsync();

        var names = (await connection.QueryAsync<string>(
            """
            SELECT policyname FROM pg_policies
            WHERE schemaname = 'customer' AND tablename = 'customer_invitation'
            ORDER BY policyname
            """)).ToArray();

        names.ShouldBe(
        [
            "customer_customer_invitation_back_office",
            "customer_customer_invitation_tenant_isolation",
        ]);
    }

    /// <summary>
    /// The WITH CHECK carries BOTH terms: the tenancy one and the admin one. The admin term is
    /// what makes a handler that forgot its own predicate fail at the database rather than at
    /// review - the same backstop shared contract section 5 puts on customer_membership.
    /// </summary>
    [Fact]
    public async Task Only_an_admin_of_the_active_business_may_write_an_invitation()
    {
        await using var connection = await OpenAsync();

        var check = await connection.ExecuteScalarAsync<string>(
            """
            SELECT with_check FROM pg_policies
            WHERE schemaname = 'customer' AND tablename = 'customer_invitation'
              AND policyname = 'customer_customer_invitation_tenant_isolation'
            """);

        check.ShouldNotBeNull();
        check!.Contains("app.customer_id", StringComparison.Ordinal).ShouldBeTrue(check);
        check.Contains("is_admin_of", StringComparison.Ordinal).ShouldBeTrue(check);
        check.Contains("app.account_id", StringComparison.Ordinal).ShouldBeTrue(check);
    }

    /// <summary>
    /// The privilege set, in full and in order, for both roles. Pinned as a complete sentence
    /// rather than checked one privilege at a time: "no DELETE" is only half the claim, and a
    /// migration that granted UPDATE by accident would satisfy every individual assertion.
    /// </summary>
    [Theory]
    [InlineData("app_customer_role", "INSERT,SELECT")]
    [InlineData("app_employee_role", "SELECT")]
    public async Task The_privilege_set_is_exactly(string grantee, string expected)
    {
        await using var connection = await OpenAsync();

        var actual = await connection.ExecuteScalarAsync<string>(
            """
            SELECT COALESCE(string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type), '')
            FROM information_schema.role_table_grants
            WHERE table_schema = 'customer' AND table_name = 'customer_invitation'
              AND grantee = @grantee
            """,
            new { grantee });

        actual.ShouldBe(
            expected,
            $"{grantee} on customer.customer_invitation. No DELETE, ever: PostgreSQL never "
            + "evaluates WITH CHECK for a DELETE, so no policy can guard one. No UPDATE for the "
            + "customer role either - accepting an invitation runs anonymously on the OWNER "
            + "connection, so nothing authenticated ever needs to mark one used.");
    }
}
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~InvitationSchemaTests" 2>&1 | tail -40
```

Expected: **FAIL**, every case. `Migration_seventeen_creates_the_column` fails with
`actual.ShouldBe(dataType)` where actual is `null` — `information_schema.columns` has no row for a
table that does not exist. `Row_level_security_is_enabled` fails on a null `bool?`.
`The_table_carries_exactly_the_tenant_isolation_and_back_office_policies` fails with an empty array
against the two expected names.

- [ ] **Step 4: Generate the migration, for its timestamp and its snapshot**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet ef migrations add CompanyInvitations \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator \
  --output-dir Migrations --context PeakPowerDbContext
ls src/Infrastructure/PeakPower.Persistence/Migrations > /tmp/t1-after-add.txt 2>&1
cat /tmp/t1-after-add.txt
```

⚠ The generated `Up`/`Down` will be **empty**, because the entity does not exist yet — Task 3 adds
it. That is deliberate and it is the same order the repository's other hand-written migrations
used: this step exists for the timestamp, the `.Designer.cs` and the snapshot, and Task 3 re-runs
`dotnet ef migrations add` bookkeeping by editing the snapshot through its own generated pass. Do
**not** delete the generated pair; replace the body of `<ts>_CompanyInvitations.cs` in step 5.

- [ ] **Step 5: Write migration 17**

Replace the whole of
`src/Infrastructure/PeakPower.Persistence/Migrations/<ts>_CompanyInvitations.cs` with this, keeping
the generated `<ts>` in the file name and the class name `CompanyInvitations`:

```csharp
﻿using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace PeakPower.Persistence.Migrations
{
    /// <summary>
    /// Migration 17: <c>customer.customer_invitation</c> — one admin asking one email address to
    /// join one business, in one role, once, within fourteen days.
    /// <para>
    /// <b>Migration 3's <c>password_reset_token</c> shape, deliberately, with two differences.</b>
    /// The mechanics are identical — 32 CSPRNG bytes, a SHA-256 hex digest stored, the plaintext
    /// mailed once and never persisted, single use — because a credential one step before a
    /// session is the same kind of object whichever door it opens. The first difference is the
    /// life: <c>[F13-R21]</c> gives an invitation <b>fourteen days</b>, not the reset flow's hour.
    /// An invitation is not urgent; a reset is. The number lives on
    /// <c>CustomerInvitation.Lifetime</c> and is spelled nowhere else.
    /// </para>
    /// <para>
    /// The second difference is that this table carries <c>customer_id</c>, and that changes what
    /// it owes. <c>password_reset_token</c> is keyed on <c>customer_account_id</c> and is
    /// discovered by the coverage guards' ACCOUNT-scoped predicate; this one is discovered by the
    /// customer-scoped predicate in <c>AutomaticPolicyCoverageTests.CustomerIdOwned</c> (a CLR
    /// property ending in <c>CustomerId</c>) and in <c>CatalogPolicyCoverageTests</c>'s
    /// <c>right(c.column_name, 11) = 'customer_id'</c>, both of which then require row-level
    /// security AND exactly two policies. The design flags this trap by name (design section 6.1).
    /// </para>
    /// <para>
    /// <b>The <c>WITH CHECK</c> carries the admin term as well as the tenancy one</b>, copying
    /// migration 15's <c>customer_membership</c> policy. <c>CompanyAdmin</c> proves "an admin of
    /// the business in my token" in the authorization middleware; this proves it again in the
    /// database, against the business the connection is actually scoped to. A handler that
    /// forgot its own <c>customer_id</c> predicate is then caught by PostgreSQL rather than by
    /// review — which is the whole argument shared contract section 5 makes for keeping these
    /// writes on <c>app_customer_role</c> instead of an owner connection.
    /// </para>
    /// <para>
    /// <b>No <c>UPDATE</c> and no <c>DELETE</c> for <c>app_customer_role</c>.</b> Marking an
    /// invitation accepted happens on the OWNER connection, because both accepts are anonymous
    /// (shared contract section 8) — so nothing authenticated ever writes this table except the
    /// <c>INSERT</c> that issues one. <c>DELETE</c> is refused for the reason section 5.1 item 2
    /// gives for <c>customer_membership</c>: PostgreSQL never evaluates <c>WITH CHECK</c> for a
    /// <c>DELETE</c>, so no policy can guard one, and a granted <c>DELETE</c> would let any admin
    /// erase the evidence that an invitation was ever sent.
    /// </para>
    /// <para>
    /// <c>app_employee_role</c> gets <c>SELECT</c> and the usual back-office policy, so support can
    /// answer "was she ever invited?" The employee host writes nothing here: <c>[OQ-105]</c>
    /// records that the back office has no membership screen at all, and this migration does not
    /// invent one.
    /// </para>
    /// </summary>
    public partial class CompanyInvitations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "customer_invitation",
                schema: "customer",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false, defaultValueSql: "gen_random_uuid()"),
                    customer_id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "citext", nullable: false),
                    role = table.Column<string>(type: "text", nullable: false),
                    token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    invited_by_account_id = table.Column<Guid>(type: "uuid", nullable: true),
                    issued_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: false),
                    accepted_at = table.Column<DateTimeOffset>(type: "timestamptz", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_customer_invitation", x => x.id);

                    // Restrict, not Cascade: a business is never deleted in this platform (it is
                    // CLOSED), and if one ever were, the invitations it sent are part of why its
                    // people have logins. The same choice CustomerEntitlementConfiguration makes.
                    table.ForeignKey(
                        name: "fk_customer_invitation_customer_customer_id",
                        column: x => x.customer_id,
                        principalSchema: "customer",
                        principalTable: "customer",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            // No foreign key on invited_by_account_id, deliberately, and the same reasoning
            // CustomerEntitlementConfiguration records for activated_by_account_id: this column is
            // provenance for an audit question, not a navigable relationship, and a Restrict
            // foreign key would make deleting a colleague fail on invitations nobody thinks of as
            // belonging to them. audit.audit_record.actor carries the same kind of reference as a
            // string for the same reason.

            migrationBuilder.CreateIndex(
                name: "ix_customer_invitation_customer_id",
                schema: "customer",
                table: "customer_invitation",
                column: "customer_id");

            // The read the accept endpoint runs, and the only way it can find a row: the plaintext
            // token is never stored, so the digest IS the lookup key. UNIQUE because two rows
            // sharing a digest would make redemption ambiguous - and because a duplicate digest
            // means a CSPRNG collision or a bug, neither of which should insert quietly.
            migrationBuilder.CreateIndex(
                name: "ix_customer_invitation_token_hash",
                schema: "customer",
                table: "customer_invitation",
                column: "token_hash",
                unique: true);

            // The admin surface's "who is outstanding?" read, and the accept's own duplicate
            // guard. Partial, on the rows that are still live: an accepted invitation is history
            // and is never scanned for again.
            migrationBuilder.CreateIndex(
                name: "ix_customer_invitation_pending",
                schema: "customer",
                table: "customer_invitation",
                columns: new[] { "customer_id", "email" },
                filter: "accepted_at IS NULL");

            // The value set, in the database as well as in the CLR enum. Shared contract section 3
            // makes 'admin' | 'trader' | 'viewer' normative, LOWERCASE, in both places - which is
            // why CustomerInvitationConfiguration carries an explicit HasConversion instead of
            // letting EnumToTextConvention write ADMIN. The check is what stops the two drifting:
            // a converter that started emitting SCREAMING_SNAKE would fail on the INSERT rather
            // than store a value nothing can read back.
            migrationBuilder.Sql(
                """
                ALTER TABLE customer.customer_invitation
                    ADD CONSTRAINT ck_customer_invitation_role
                    CHECK (role IN ('admin', 'trader', 'viewer'));
                """);

            // An invitation cannot expire before it was issued, and cannot be accepted before it
            // was issued either. Expressed here as well as in CustomerInvitation.Issue because the
            // API is not the only writer this table will ever have.
            migrationBuilder.Sql(
                """
                ALTER TABLE customer.customer_invitation
                    ADD CONSTRAINT ck_customer_invitation_window
                    CHECK (expires_at > issued_at
                           AND (accepted_at IS NULL OR accepted_at >= issued_at));
                """);

            // -------------------------------------------------------------------------------
            // Grants.
            //
            // REVOKE ALL first, and it is load-bearing rather than tidiness: migration 2's
            //   ALTER DEFAULT PRIVILEGES IN SCHEMA customer, metering, wallet, audit
            //       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_customer_role, app_employee_role
            // (20260827092246_TenancyRowLevelSecurity.cs:108-110) fired the instant CreateTable
            // ran above, so this table already holds arwd for both roles. Enumerating what it
            // should have does not remove what it should not.
            //
            // SELECT and INSERT for the customer role, and nothing else. INSERT issues an
            // invitation; SELECT is what GET /api/v1/company/memberships reads to list the
            // outstanding ones. UPDATE is not granted because nothing authenticated marks an
            // invitation accepted - both accepts are anonymous and run on the owner connection
            // (shared contract section 8, and this plan's Global Constraints for why the
            // known-address accept cannot run authenticated). DELETE is not granted because no
            // policy can guard one.
            //
            // SELECT for the employee role: support answering "was she invited?". No write: the
            // back office has no membership surface at all - [OQ-105] - and this migration does
            // not quietly create one.
            // -------------------------------------------------------------------------------
            migrationBuilder.Sql(
                """
                REVOKE ALL ON customer.customer_invitation FROM app_customer_role;
                REVOKE ALL ON customer.customer_invitation FROM app_employee_role;
                GRANT SELECT, INSERT ON customer.customer_invitation TO app_customer_role;
                GRANT SELECT         ON customer.customer_invitation TO app_employee_role;
                """);

            // -------------------------------------------------------------------------------
            // Row-level security. The policy pair both coverage guards require, in migration 15's
            // shape for customer_membership rather than migration 2's plainer one.
            //
            // The WITH CHECK carries two terms. The first pins the row to the business the
            // connection is scoped to; the second requires the writer to be an admin of it. The
            // second is not redundant with the CompanyAdmin authorization policy: that policy
            // reads the request, this reads the connection, and it is the connection that decides
            // which rows the statement can touch. A handler that forgot AND customer_id = @active
            // is caught here.
            //
            // customer.is_admin_of is SECURITY DEFINER with a pinned search_path and is EXECUTE-
            // granted to app_customer_role by migration 15. It is called here rather than
            // subqueried inline for the same reason migration 15 calls it: a policy that
            // subqueries the table it is on raises "infinite recursion detected in policy" - and
            // although THIS policy is on a different table, using the same function keeps one
            // definition of "is an admin of" in the database.
            //
            // NULLIF(current_setting(..., true), '') is the fail-closed guard: ''::uuid raises
            // 22P02, while NULL simply matches nothing. FORCE ROW LEVEL SECURITY is deliberately
            // NOT set - the owner runs migrations and the anonymous accept, and no API host
            // connects as the owner for an authenticated request.
            // -------------------------------------------------------------------------------
            migrationBuilder.Sql(
                """
                ALTER TABLE customer.customer_invitation ENABLE ROW LEVEL SECURITY;

                CREATE POLICY customer_customer_invitation_tenant_isolation ON customer.customer_invitation
                    FOR ALL TO app_customer_role
                    USING      (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
                    WITH CHECK (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid
                            AND customer.is_admin_of(
                                    NULLIF(current_setting('app.account_id',  true), '')::uuid,
                                    NULLIF(current_setting('app.customer_id', true), '')::uuid));

                CREATE POLICY customer_customer_invitation_back_office ON customer.customer_invitation
                    FOR ALL TO app_employee_role
                    USING (true)
                    WITH CHECK (true);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Roll forward only - S2-D7. The deployed DatabaseMigrator calls only MigrateAsync, so
            // this never runs in the shipped path; it is written correctly because a developer may
            // run `dotnet ef database update <earlier>` by hand, and nothing may RELY on it.
            //
            // The grants are revoked explicitly rather than left to DROP TABLE. Dropping the table
            // does remove them, but migration 2's ALTER DEFAULT PRIVILEGES is still standing, so a
            // re-run of Up() lands on a freshly granted table again - which is what the REVOKE ALL
            // up there is for, and saying so here keeps the pair readable together.
            migrationBuilder.Sql(
                """
                REVOKE ALL ON customer.customer_invitation FROM app_customer_role;
                REVOKE ALL ON customer.customer_invitation FROM app_employee_role;
                """);

            migrationBuilder.DropTable(
                name: "customer_invitation",
                schema: "customer");
        }
    }
}
```

- [ ] **Step 6: Move the three pins of the ordered migration list**

⚠ **All three already carry plans 1 and 2's entries** — both plans add a migration and contract
§13.1 requires each to grow all three places in its own commit. So the pinned length reads **16**
when this task starts, not `14`, and this task takes it to **17** by appending exactly one line.

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs`,
the method name ends `…_then_<plan 1's migration name>_then_WidenCustomerVisibilityToMemberships_in_that_order()`.
It becomes `…_then_WidenCustomerVisibilityToMemberships_then_CompanyInvitations_in_that_order()`.
Change `migrationIds.Length.ShouldBe(16)` to `.ShouldBe(17)` and append:

```csharp
        migrationIds[16].ShouldEndWith("_CompanyInvitations");
```

⚠ Read the two names above this one out of `/tmp/t1-before.txt` (step 1) rather than trusting this
listing: plan 1's name is `<plan 1's migration name>` as this plan assumes it, and plan 2's is
`WidenCustomerVisibilityToMemberships` per contract §13.1. **Only index `[16]` is this plan's.** If
the length still reads `14` and there is no `[14]`/`[15]` line, plans 1 and 2 left their own pins
unmoved — contract §13.1 names that as a build break, not this plan's to absorb. Add their lines
too, and say so in the commit message.

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs`,
change `applied.Length.ShouldBe(16)` to `.ShouldBe(17)` and append the same line with `applied[16]`.

In `/Users/thinhhuynh/PeakPower/peakpower-platform/tools/verify-migrator.sh`, extend the `case`
pattern — append `\|*_CompanyInvitations` **before** the closing `\|) ;;`, after plan 2's
`\|*_WidenCustomerVisibilityToMemberships` — and extend the failure message so it ends
`…then one ending _CompanyInvitations - found: `.

- [ ] **Step 7: Build, migrate a real container and read the schema back**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~InvitationSchemaTests" 2>&1 | tail -20
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~MigrationScriptTests|FullyQualifiedName~MigrationBehaviourTests" 2>&1 | tail -20
tools/verify-migrator.sh
```

Expected: build clean; `InvitationSchemaTests` PASS, all fifteen cases; both migration-list tests
PASS; `verify-migrator.sh` exits 0.

⚠ **Do not run the whole integration suite yet.** Task 3's four coverage literals are still at
their pre-migration-17 values, so `AutomaticPolicyCoverageTests` and `CatalogPolicyCoverageTests`
are red by design until Task 3 lands. `AutomaticPolicyCoverageTests` will not even discover the
table yet — the entity does not exist — but `CatalogPolicyCoverageTests` reads the catalogue and
finds it immediately.

- [ ] **Step 8: Mutate the two claims that carry the most weight**

**Mutation 1 — the `REVOKE ALL`.** Delete the line
`REVOKE ALL ON customer.customer_invitation FROM app_customer_role;` from the grants block and
re-run against a fresh container (the migration has already been applied to any database you have
used, so the change only takes effect on a new one — Testcontainers gives a new one per fixture):

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~InvitationSchemaTests.The_privilege_set_is_exactly" 2>&1 | tail -20
```

Expected: **FAIL**, the `app_customer_role` case only, with
`actual.ShouldBe("INSERT,SELECT")` reporting actual `"DELETE,INSERT,SELECT,UPDATE"` — migration 2's
`ALTER DEFAULT PRIVILEGES` handed the table full DML the moment `CreateTable` ran, and without the
revoke every signed-in customer could delete every invitation in their business. The
`app_employee_role` case still passes, which is what tells you the mutation was narrow. Restore the
line.

**Mutation 2 — the admin term in the `WITH CHECK`.** Delete
`AND customer.is_admin_of(...)` and its two argument lines from the tenant-isolation policy, so
the check reads only the tenancy term:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~InvitationSchemaTests.Only_an_admin_of_the_active_business_may_write_an_invitation" 2>&1 | tail -20
```

Expected: **FAIL** with
`check.Contains("is_admin_of", StringComparison.Ordinal).ShouldBeTrue(...)` and the actual
`with_check` text printed as the message — `(customer_id = NULLIF(current_setting(...`, with no
`is_admin_of` in it. Restore, then confirm the restore:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform diff --stat \
  src/Infrastructure/PeakPower.Persistence/Migrations
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~InvitationSchemaTests" 2>&1 | tail -10
```

Expected: the diff names only the new migration files (no unexpected edits); all fifteen cases PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform add \
  src/Infrastructure/PeakPower.Persistence/Migrations \
  tools/verify-migrator.sh \
  tests/PeakPower.Integration.Tests/Migrations/InvitationSchemaTests.cs \
  tests/PeakPower.Integration.Tests/Migrations/MigrationScriptTests.cs \
  tests/PeakPower.Integration.Tests/Database/MigrationBehaviourTests.cs
git -C /Users/thinhhuynh/PeakPower/peakpower-platform commit -m "feat(persistence): migration 17, customer.customer_invitation

The password-reset token's mechanics with [F13-R21]'s fourteen days instead of the reset
flow's hour, and a customer_id - which is what makes it a table both row-level-security
coverage guards discover and hold to a policy pair. The customer role gets SELECT and
INSERT and nothing else: marking an invitation accepted happens on the owner connection
because both accepts are anonymous, and no policy can guard a DELETE.

The WITH CHECK carries the admin term as well as the tenancy one, copying migration 15's
customer_membership policy, so a handler that forgets AND customer_id = @active is refused
by PostgreSQL rather than caught at review.

Verified by mutation in both directions: dropping the REVOKE ALL leaves the table holding
DELETE,INSERT,SELECT,UPDATE from migration 2's ALTER DEFAULT PRIVILEGES, and dropping the
is_admin_of term leaves a WITH CHECK any member of the business satisfies.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `CustomerInvitation` — the domain type, and where fourteen days lives

Design §6.1 is explicit about the one number r1 got wrong: *"with `[F13-R21]`'s 14-day lifetime —
an invitation is not urgent; r1 copied the reset flow's hour."* So the lifetime lives **on the
entity**, not in the endpoint, and `Issue` computes `ExpiresAt` from it. `PasswordResetToken` puts
its hour in `AuthEndpoints.ResetTokenLifetime` and takes `expiresAt` as a parameter, which is
exactly the shape that let an hour be copied into a place that wanted a fortnight.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/CustomerInvitation.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Customers/CustomerInvitationTests.cs` (create)

**Interfaces:**
- Consumes: `MembershipRole` (plan 1, contract §7).
- Produces:
  - `PeakPower.Domain.Customers.CustomerInvitation`
  - `public static readonly TimeSpan CustomerInvitation.Lifetime` — 14 days
  - `public static CustomerInvitation Issue(Guid customerId, string email, MembershipRole role, string tokenHash, Guid? invitedByAccountId, DateTimeOffset issuedAt)`
  - `public bool IsUsable(DateTimeOffset at)`
  - `public void MarkAccepted(DateTimeOffset at)`
  - properties `Id`, `CustomerId`, `Email`, `Role`, `TokenHash`, `InvitedByAccountId`, `IssuedAt`, `ExpiresAt`, `AcceptedAt`

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Domain.Tests/Customers/CustomerInvitationTests.cs`:

```csharp
using PeakPower.Domain.Customers;
using Shouldly;
using Xunit;

namespace PeakPower.Domain.Tests.Customers;

/// <summary>
/// The invitation's own rules. Everything about WHO may issue one lives in the endpoint and in the
/// row-level-security policy; what lives here is the life, the single use, and the fact that the
/// plaintext token is never on this type at all.
/// </summary>
public sealed class CustomerInvitationTests
{
    private static readonly Guid Business = Guid.CreateVersion7();
    private static readonly Guid Inviter = Guid.CreateVersion7();
    private static readonly DateTimeOffset Noon =
        new(2026, 9, 10, 12, 0, 0, TimeSpan.Zero);

    private const string Digest = "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";

    private static CustomerInvitation Issued() =>
        CustomerInvitation.Issue(
            Business, "  Jaap.deWit@Example.NL ", MembershipRole.Trader, Digest, Inviter, Noon);

    /// <summary>
    /// FOURTEEN DAYS, and it is the number this test exists for. [F13-R21] gives an invitation a
    /// fortnight; the password-reset flow gives its code an hour, and the design records that r1
    /// shipped the hour by copying the wrong neighbour. The constant lives on this type - not on
    /// the endpoint, where PasswordResetToken's does - precisely so there is nothing to copy.
    /// </summary>
    [Fact]
    public void An_invitation_lives_for_fourteen_days()
    {
        CustomerInvitation.Lifetime.ShouldBe(TimeSpan.FromDays(14));

        Issued().ExpiresAt.ShouldBe(Noon.AddDays(14));
    }

    [Fact]
    public void It_records_the_business_the_role_the_digest_and_the_inviter()
    {
        var invitation = Issued();

        invitation.Id.ShouldNotBe(Guid.Empty);
        invitation.CustomerId.ShouldBe(Business);
        invitation.Role.ShouldBe(MembershipRole.Trader);
        invitation.TokenHash.ShouldBe(Digest);
        invitation.InvitedByAccountId.ShouldBe(Inviter);
        invitation.IssuedAt.ShouldBe(Noon);
        invitation.AcceptedAt.ShouldBeNull();
    }

    /// <summary>
    /// Trimmed and lowercased on the way in. The column is citext so the DATABASE already compares
    /// case-insensitively; this is about the value a human reads back out of an audit record and
    /// out of the pending-invitations list, which should not print the spacing somebody's paste
    /// left behind.
    /// </summary>
    [Fact]
    public void The_address_is_trimmed_and_lowercased()
    {
        Issued().Email.ShouldBe("jaap.dewit@example.nl");
    }

    [Fact]
    public void A_fresh_invitation_is_usable_and_stops_being_so_the_moment_it_expires()
    {
        var invitation = Issued();

        invitation.IsUsable(Noon).ShouldBeTrue();
        invitation.IsUsable(Noon.AddDays(14).AddSeconds(-1)).ShouldBeTrue();
        // Half-open: the instant of expiry is already too late, exactly as
        // PasswordResetToken.IsUsable reads `at < ExpiresAt`.
        invitation.IsUsable(Noon.AddDays(14)).ShouldBeFalse();
        invitation.IsUsable(Noon.AddDays(15)).ShouldBeFalse();
    }

    /// <summary>
    /// Single use, and the second attempt is refused by the SAME predicate the expiry uses - which
    /// is what lets the endpoint answer one body for "unknown", "spent" and "expired" alike
    /// without three branches that could drift into three different answers.
    /// </summary>
    [Fact]
    public void Accepting_spends_it()
    {
        var invitation = Issued();

        invitation.MarkAccepted(Noon.AddDays(1));

        invitation.AcceptedAt.ShouldBe(Noon.AddDays(1));
        invitation.IsUsable(Noon.AddDays(1)).ShouldBeFalse();
        invitation.IsUsable(Noon.AddDays(2)).ShouldBeFalse();
    }

    /// <summary>
    /// The plaintext token is not a member of this type and cannot be made one by accident: the
    /// only string this factory takes for it is a digest. Asserted structurally rather than by
    /// eyeballing the class, because "we did not store the secret" is the property the whole
    /// hashed-token design rests on.
    /// </summary>
    [Fact]
    public void The_type_carries_no_property_that_could_hold_a_plaintext_token()
    {
        typeof(CustomerInvitation).GetProperties()
            .Select(property => property.Name)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ShouldBe(
            [
                "AcceptedAt", "CustomerId", "Email", "ExpiresAt", "Id", "InvitedByAccountId",
                "IssuedAt", "Role", "TokenHash",
            ]);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Domain.Tests --nologo \
  --filter "FullyQualifiedName~CustomerInvitationTests" 2>&1 | tail -20
```

Expected: **build failure**, not a test failure:
`error CS0246: The type or namespace name 'CustomerInvitation' could not be found`, once per
reference in the file. That is the correct first failure — the type does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/CustomerInvitation.cs`:

```csharp
namespace PeakPower.Domain.Customers;

/// <summary>
/// One admin asking one email address to join one business, in one role, once. Aggregate root.
/// </summary>
/// <remarks>
/// <para>
/// <b>Fourteen days, and the number lives here.</b> <c>[F13-R21]</c> gives an invitation a
/// fortnight; <see cref="PasswordResetToken"/> gives a reset code an hour, and it takes its
/// <c>expiresAt</c> as a parameter so that the hour lives at the call site. That is the shape
/// that let the first draft of this design ship an invitation that expired in an hour. Here the
/// factory computes the expiry from <see cref="Lifetime"/> and there is nothing for a caller to
/// get wrong.
/// </para>
/// <para>
/// <b>The token itself is never stored.</b> <c>OpaqueToken.Create()</c> makes 32 CSPRNG bytes,
/// the plaintext goes into exactly one email, and <c>OpaqueToken.HashOf</c>'s SHA-256 hex digest
/// is what lands in <see cref="TokenHash"/> — the same choice, for the same reason,
/// <see cref="RefreshToken"/> and <see cref="PasswordResetToken"/> already make: a stolen database
/// dump must not yield usable credentials, and a 256-bit random value cannot be guessed at any
/// price, so a slow hash would buy nothing.
/// </para>
/// <para>
/// <b>Scoped by <see cref="CustomerId"/>, not by account</b> — unlike the other two token tables,
/// which are keyed on <c>CustomerAccountId</c> because both are read before the caller's customer
/// is known. An invitation names a BUSINESS and an address that may have no account at all, so
/// the customer is the only identity it has. That is also what puts it inside both row-level-
/// security coverage guards' customer-scoped discovery, and therefore why migration 17 ships a
/// policy pair.
/// </para>
/// </remarks>
public sealed class CustomerInvitation
{
    /// <summary>EF Core materialises through this; application code uses <see cref="Issue"/>.</summary>
    private CustomerInvitation()
    {
    }

    /// <summary>Fourteen days. <c>[F13-R21]</c>. An invitation is not urgent; a reset code is.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(14);

    public Guid Id { get; private set; }

    /// <summary>The business being joined, never the inviter's other businesses.</summary>
    public Guid CustomerId { get; private set; }

    /// <summary>
    /// Trimmed and lowercased. The column is <c>citext</c>, so the database already compares
    /// case-insensitively; normalising here is about what a human reads back out of the pending
    /// list and out of <c>audit.audit_record</c>.
    /// </summary>
    public string Email { get; private set; } = string.Empty;

    /// <summary>
    /// What the invitee becomes on acceptance. Persisted as the shared contract's LOWERCASE
    /// spelling — <c>admin</c> | <c>trader</c> | <c>viewer</c> — through an explicit
    /// <c>HasConversion</c> in <c>CustomerInvitationConfiguration</c>, not through
    /// <c>EnumToTextConvention</c>, which would write <c>ADMIN</c>.
    /// </summary>
    public MembershipRole Role { get; private set; }

    /// <summary>SHA-256 hex of the token. The token itself is never stored.</summary>
    public string TokenHash { get; private set; } = string.Empty;

    /// <summary>
    /// The admin who sent it, for the audit trail. Nullable and carrying no foreign key: this is
    /// provenance, not a relationship, and a Restrict foreign key would make deleting a colleague
    /// fail on invitations nobody thinks of as belonging to them.
    /// </summary>
    public Guid? InvitedByAccountId { get; private set; }

    public DateTimeOffset IssuedAt { get; private set; }

    public DateTimeOffset ExpiresAt { get; private set; }

    public DateTimeOffset? AcceptedAt { get; private set; }

    /// <summary>
    /// The moment comes from <c>IMarketCalendar</c>, never from the system clock: architecture
    /// fact 5 confines that to <c>PeakPower.Infrastructure.Time</c>.
    /// </summary>
    public static CustomerInvitation Issue(
        Guid customerId,
        string email,
        MembershipRole role,
        string tokenHash,
        Guid? invitedByAccountId,
        DateTimeOffset issuedAt) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            CustomerId = customerId,
            Email = (email ?? string.Empty).Trim().ToLowerInvariant(),
            Role = role,
            TokenHash = tokenHash,
            InvitedByAccountId = invitedByAccountId,
            IssuedAt = issuedAt,
            ExpiresAt = issuedAt.Add(Lifetime),
        };

    /// <summary>
    /// One predicate for both ways an invitation stops working, so the endpoint can answer one
    /// body for "unknown", "spent" and "expired" alike without three branches that could drift.
    /// Half-open on the expiry, exactly as <see cref="PasswordResetToken.IsUsable"/> reads it.
    /// </summary>
    public bool IsUsable(DateTimeOffset at) => AcceptedAt is null && at < ExpiresAt;

    public void MarkAccepted(DateTimeOffset at) => AcceptedAt = at;
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Domain.Tests --nologo \
  --filter "FullyQualifiedName~CustomerInvitationTests" 2>&1 | tail -20
```

Expected: build clean; PASS, all seven.

- [ ] **Step 5: Mutate the lifetime, which is the one number this whole task exists for**

Change `TimeSpan.FromDays(14)` to `TimeSpan.FromHours(1)` in `CustomerInvitation.Lifetime` — the
exact mistake the design records r1 making.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Domain.Tests --nologo \
  --filter "FullyQualifiedName~CustomerInvitationTests" 2>&1 | tail -30
```

Expected: **FAIL**, exactly two cases.
`An_invitation_lives_for_fourteen_days` fails first on
`CustomerInvitation.Lifetime.ShouldBe(TimeSpan.FromDays(14))` — `01:00:00 should be 14.00:00:00`.
`A_fresh_invitation_is_usable_and_stops_being_so_the_moment_it_expires` fails on
`invitation.IsUsable(Noon.AddDays(14).AddSeconds(-1)).ShouldBeTrue()` — `False should be True`.
The other five still pass, which is what tells you the mutation was narrow.

Restore `TimeSpan.FromDays(14)`, then prove the restore:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform diff -- \
  src/Core/PeakPower.Domain/Customers/CustomerInvitation.cs
dotnet test tests/PeakPower.Domain.Tests --nologo \
  --filter "FullyQualifiedName~CustomerInvitationTests" 2>&1 | tail -10
```

Expected: the diff shows the file as newly added with `FromDays(14)` and no `FromHours`; PASS, all
seven.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform add \
  src/Core/PeakPower.Domain/Customers/CustomerInvitation.cs \
  tests/PeakPower.Domain.Tests/Customers/CustomerInvitationTests.cs
git -C /Users/thinhhuynh/PeakPower/peakpower-platform commit -m "feat(domain): CustomerInvitation, and fourteen days lives on the type

[F13-R21] gives an invitation a fortnight. PasswordResetToken takes its expiry as a
parameter and keeps the hour at the call site, which is the shape that let the first draft
of this design copy the hour into a place that wanted a fortnight; here the factory derives
the expiry from CustomerInvitation.Lifetime and there is nothing for a caller to get wrong.

One IsUsable predicate covers spent and expired alike, so the endpoint can answer one body
for unknown, spent and expired without three branches that could drift apart.

Verified by mutation: setting Lifetime to one hour fails the lifetime assertion and the
usable-window assertion and nothing else.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The EF configuration, the `DbSet`, the query filter, and the four coverage literals

`customer.customer_invitation` carries `customer_id`, so the moment the entity is mapped it is
discovered by **four** guards: two on the EF model, two on the PostgreSQL catalogue. Each requires
something, and each pins a literal that this task moves by exactly one.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/CustomerInvitationConfiguration.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Migrations/PeakPowerDbContextModelSnapshot.cs` (regenerated)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/InvitationSchemaTests.cs` (modify — append the round trip)

**Interfaces:**
- Consumes: `CustomerInvitation` (Task 2); `MembershipRole` (plan 1).
- Produces: `PeakPowerDbContext.CustomerInvitations` (`DbSet<CustomerInvitation>`) with the standard
  `!IsAuthenticated || invitation.CustomerId == ctx.CustomerId` global query filter.

- [ ] **Step 1: Read the four literals as plans 1–3 left them**

```bash
cat /tmp/plan4-guard-literals.txt
```

That file was written in the Preflight. Call the values it reports `Q_names` (the array in
`QueryFilterModelTests`), `Q_filtered`, `A_customerId`, `A_owned`, `C_tables_customerId` and
`C_tables`. This task adds **one** to each numeric literal and **`"CustomerInvitation"`** to
`Q_names`. Before this plan's plan 1 they were, verified 2026-09-10: `Q_names` 14 entries,
`Q_filtered` 10, `A_customerId` 12, `A_owned` 12, `C_tables_customerId` 12, `C_tables` 12.

⚠ If a value moved by anything other than plan 1's own additions, **stop and report it** rather
than adjusting a number until the suite goes green. A coverage guard whose literal is retyped after
each failure is a ritual, not evidence.

- [ ] **Step 2: Write the failing test**

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Migrations/InvitationSchemaTests.cs`,
inside the existing class, after `The_privilege_set_is_exactly`:

```csharp
    /// <summary>
    /// The model and the SQL are one schema or they are two. Writes an invitation through EF on
    /// the OWNER connection and reads the row back with Dapper, so the value that lands in the
    /// column is the one migration 17's CHECK constraint admits.
    /// </summary>
    /// <remarks>
    /// ⚠ <c>role</c> is the one column in this table whose stored spelling is NOT what
    /// <c>EnumToTextConvention</c> would write. That convention is an
    /// <c>IModelFinalizingConvention</c> that applies <c>EnumToScreamingSnakeConverter</c> to every
    /// enum property in the model, which would store <c>ADMIN</c>; shared contract section 3 makes
    /// the database spelling <c>admin</c>. <c>CustomerInvitationConfiguration</c> carries an
    /// explicit <c>HasConversion</c>, and an explicit fluent configuration outranks a convention -
    /// this is what proves it, against a real database rather than against the model builder.
    /// Without it the INSERT fails 23514 on <c>ck_customer_invitation_role</c>.
    /// </remarks>
    [Theory]
    [InlineData(MembershipRole.Admin, "admin")]
    [InlineData(MembershipRole.Trader, "trader")]
    [InlineData(MembershipRole.Viewer, "viewer")]
    public async Task An_invitation_round_trips_and_stores_the_contracts_lowercase_role(
        MembershipRole role, string stored)
    {
        var ct = TestContext.Current.CancellationToken;
        var customer = await SeedCustomerAsync();
        var digest = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");

        await using (var db = factory.CreateOwnerDbContext())
        {
            db.CustomerInvitations.Add(CustomerInvitation.Issue(
                customer, "New.Person@Example.NL", role, digest, invitedByAccountId: null,
                issuedAt: new DateTimeOffset(2026, 9, 10, 12, 0, 0, TimeSpan.Zero)));
            await db.SaveChangesAsync(ct);
        }

        await using var connection = await OpenAsync();

        var row = await connection.QuerySingleAsync<(string Role, string Email)>(
            """
            SELECT role AS "Role", email::text AS "Email"
            FROM customer.customer_invitation WHERE token_hash = @digest
            """,
            new { digest });

        row.Role.ShouldBe(stored);
        row.Email.ShouldBe("new.person@example.nl");

        await using var back = factory.CreateOwnerDbContext();
        var read = await back.CustomerInvitations
            .SingleAsync(invitation => invitation.TokenHash == digest, ct);

        read.Role.ShouldBe(role);
        read.ExpiresAt.ShouldBe(new DateTimeOffset(2026, 9, 24, 12, 0, 0, TimeSpan.Zero));
    }

    /// <summary>A business to hang the invitation off; the foreign key is Restrict, not optional.</summary>
    private async Task<Guid> SeedCustomerAsync()
    {
        await using var db = factory.CreateOwnerDbContext();

        var customer = PeakPower.Domain.Customers.Customer.Create(
            $"Invitation Schema {Guid.NewGuid():N}",
            tradeName: null,
            kvkNumber: PeakPower.Domain.Common.KvkNumber.Create(
                Random.Shared.Next(10_000_000, 100_000_000)
                    .ToString(System.Globalization.CultureInfo.InvariantCulture)).Value,
            vatNumber: null,
            billingAddress: new PeakPower.Domain.Common.Address(
                "Havenweg", "12", null, "3011 AA", "Rotterdam", "NL"),
            visitingAddress: null,
            primaryContact: new PeakPower.Domain.Common.ContactPerson(
                "Els Bakker", "els@example.test", null),
            internalReference: null,
            locale: "nl-NL").Value;

        db.Customers.Add(customer);
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        return customer.Id;
    }
```

Add `using Microsoft.EntityFrameworkCore;` and `using PeakPower.Domain.Customers;` to the file's
usings.

- [ ] **Step 3: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~An_invitation_round_trips" 2>&1 | tail -20
```

Expected: **build failure** —
`error CS1061: 'PeakPowerDbContext' does not contain a definition for 'CustomerInvitations'`.

- [ ] **Step 4: Write the EF configuration**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/Configurations/CustomerInvitationConfiguration.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PeakPower.Domain.Customers;

namespace PeakPower.Persistence.Configurations;

public sealed class CustomerInvitationConfiguration : IEntityTypeConfiguration<CustomerInvitation>
{
    /// <summary>
    /// The partial index the admin surface's "who is outstanding?" read uses, and the one migration
    /// 16 creates by this name. Named through <c>HasDatabaseName</c> rather than left to EF's own
    /// convention so the migration and the model mean the same object: an EF-derived name would
    /// change under a column rename that changed nothing else.
    /// </summary>
    public const string PendingIndexName = "ix_customer_invitation_pending";

    /// <summary>
    /// The database spelling shared contract section 3 makes normative: <c>admin</c> |
    /// <c>trader</c> | <c>viewer</c>, LOWERCASE, in the column and on the wire alike.
    /// </summary>
    /// <remarks>
    /// ⚠ This is the one enum property in the model that does NOT go through
    /// <c>EnumToTextConvention</c>. That convention is an <c>IModelFinalizingConvention</c> which
    /// walks every enum property and applies <c>EnumToScreamingSnakeConverter&lt;T&gt;</c>,
    /// producing <c>ADMIN</c> — and migration 17's <c>ck_customer_invitation_role</c> would then
    /// refuse every insert with 23514. It calls
    /// <c>IConventionPropertyBuilder.HasConversion</c> at <c>ConfigurationSource.Convention</c>, so
    /// the explicit fluent conversion below outranks it. <c>InvitationSchemaTests.
    /// An_invitation_round_trips_and_stores_the_contracts_lowercase_role</c> proves that against a
    /// real database rather than against the model builder, because "an explicit configuration
    /// wins" is a claim about EF's internals and not one to take on trust.
    /// <para>
    /// If a later plan consolidates this with <c>CustomerMembership</c>'s identical conversion into
    /// one shared converter, delete this pair and use that one. Two definitions of one mapping is
    /// a drift risk; it is accepted here only because plan 1 owns the membership half and this
    /// plan may not edit it.
    /// </para>
    /// </remarks>
    private static string ToDatabase(MembershipRole role) => role switch
    {
        MembershipRole.Admin => "admin",
        MembershipRole.Trader => "trader",
        MembershipRole.Viewer => "viewer",
        _ => throw new ArgumentOutOfRangeException(nameof(role), role, null),
    };

    private static MembershipRole FromDatabase(string stored) => stored switch
    {
        "admin" => MembershipRole.Admin,
        "trader" => MembershipRole.Trader,
        "viewer" => MembershipRole.Viewer,
        _ => throw new ArgumentOutOfRangeException(nameof(stored), stored, null),
    };

    public void Configure(EntityTypeBuilder<CustomerInvitation> builder)
    {
        builder.ToTable("customer_invitation", "customer");

        builder.HasKey(invitation => invitation.Id);
        builder.Property(invitation => invitation.Id)
            .HasDefaultValueSql("gen_random_uuid()")
            .ValueGeneratedNever();

        builder.Property(invitation => invitation.CustomerId).IsRequired();
        builder.HasOne<Customer>()
            .WithMany()
            .HasForeignKey(invitation => invitation.CustomerId)
            .OnDelete(DeleteBehavior.Restrict);

        // citext, so an invitation addressed to "J.deVries@example.nl" is found by an account
        // whose email column spells it "j.devries@example.nl". Both sides of the accept endpoint's
        // join are citext for the same reason - CustomerAccountConfiguration:32.
        builder.Property(invitation => invitation.Email).HasColumnType("citext").IsRequired();

        builder.Property(invitation => invitation.Role)
            .HasConversion(role => ToDatabase(role), stored => FromDatabase(stored))
            .HasColumnType("text")
            .IsRequired();

        builder.Property(invitation => invitation.TokenHash).HasMaxLength(64).IsRequired();
        builder.HasIndex(invitation => invitation.TokenHash).IsUnique();

        // No foreign key: provenance, not a relationship. See the property's own doc comment.
        builder.Property(invitation => invitation.InvitedByAccountId);

        builder.Property(invitation => invitation.IssuedAt).HasColumnType("timestamptz").IsRequired();
        builder.Property(invitation => invitation.ExpiresAt).HasColumnType("timestamptz").IsRequired();
        builder.Property(invitation => invitation.AcceptedAt).HasColumnType("timestamptz");

        builder.HasIndex(invitation => invitation.CustomerId);

        builder.HasIndex(invitation => new { invitation.CustomerId, invitation.Email })
            .HasFilter("accepted_at IS NULL")
            .HasDatabaseName(PendingIndexName);
    }
}
```

- [ ] **Step 5: Add the `DbSet` and the global query filter**

In `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs`,
after the `PasswordResetTokens` `DbSet` (line 60), add:

```csharp
    /// <summary>
    /// Outstanding and spent invitations to join a business. Unlike the two token tables above it,
    /// this one is scoped by CUSTOMER rather than by account - an invitation names a business and
    /// an address that may have no account at all - so it takes the standard global query filter
    /// below rather than an exemption.
    /// </summary>
    public DbSet<CustomerInvitation> CustomerInvitations => Set<CustomerInvitation>();
```

In `OnModelCreating`, after the `CustomerEntitlement` filter, add:

```csharp
        // Migration 17's table. The standard filter, and it is exactly right for both readers:
        // the ADMIN surface is authenticated, so `invitation.CustomerId == ctx.CustomerId` is the
        // explicit tenancy predicate the design demands of every admin query; the ANONYMOUS accept
        // endpoint runs with IsAuthenticated false, so the filter collapses to `true` and the
        // lookup by token digest sees every business's invitations - which is what it must do,
        // because the token is the authorisation and the caller's business is not yet known.
        //
        // ⚠ The `!IsAuthenticated ||` prefix is therefore load-bearing here in a way it is not on
        // most tables: without it the accept endpoint would compare customer_id against
        // Guid.Empty and find nothing at all, and every invitation would be unredeemable.
        modelBuilder.Entity<CustomerInvitation>()
            .HasQueryFilter(invitation =>
                !_customerContext.IsAuthenticated ||
                invitation.CustomerId == _customerContext.CustomerId);
```

- [ ] **Step 6: Regenerate the snapshot so the model and migration 17 agree**

The entity now exists, so EF's model snapshot must learn about it. Migration 17's `Up` is already
hand-written, so generate a throwaway migration purely to refresh the snapshot, then remove it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet ef migrations add SnapshotRefresh \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator \
  --output-dir Migrations --context PeakPowerDbContext > /tmp/t3-snapshot.txt 2>&1
cat /tmp/t3-snapshot.txt
sed -n '1,200p' src/Infrastructure/PeakPower.Persistence/Migrations/*_SnapshotRefresh.cs \
  > /tmp/t3-snapshot-body.txt
cat /tmp/t3-snapshot-body.txt
```

⚠ **Read `/tmp/t3-snapshot-body.txt` before removing it.** Its `Up` must be **empty**. If it is
not, migration 17's hand-written DDL and the model disagree — a column type, an index name, a
filter — and the difference it prints is the bug. Fix migration 17 to match the model (or the
configuration to match migration 17), re-run, and only then continue.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet ef migrations remove \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator \
  --context PeakPowerDbContext
git -C /Users/thinhhuynh/PeakPower/peakpower-platform status --short \
  src/Infrastructure/PeakPower.Persistence/Migrations > /tmp/t3-status.txt 2>&1
cat /tmp/t3-status.txt
```

⚠ `dotnet ef migrations remove` reverts the snapshot **to the state before `SnapshotRefresh`**,
which is what we want only if migration 17's own `.Designer.cs` already carries the entity — it
does not, because Task 1 generated it before the entity existed. So after the remove, regenerate
migration 17's designer pair by deleting and re-adding it with the hand-written body preserved:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
cp src/Infrastructure/PeakPower.Persistence/Migrations/*_CompanyInvitations.cs /tmp/migration17.cs
dotnet ef migrations remove \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator \
  --context PeakPowerDbContext
dotnet ef migrations add CompanyInvitations \
  --project src/Infrastructure/PeakPower.Persistence \
  --startup-project src/Hosts/PeakPower.Migrator \
  --output-dir Migrations --context PeakPowerDbContext
```

Now copy the hand-written `Up`/`Down` and the class doc comment out of `/tmp/migration17.cs` into
the newly generated `<ts>_CompanyInvitations.cs`, keeping the NEW timestamp and the NEW
`.Designer.cs`. ⚠ **Use plain `cp`, never `cp -a`**: `cp -a` preserves mtimes and leaves MSBuild
with stale binaries, so the next build silently reuses the old assembly.

The generated `Up` will contain EF's own `CreateTable` for `customer_invitation`; **discard it** in
favour of the hand-written one, which additionally carries the two `CHECK` constraints, the grants
and the policy pair that EF cannot express.

- [ ] **Step 7: Move the four coverage literals**

`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs`

Add `"CustomerInvitation"` to the `expected` array, in ordinal order — it sorts immediately after
`"CustomerEntitlement"` and before `"CustomerMembership"` (`E` < `I` < `M`). Extend the array's own
doc comment with:

```csharp
        // Migration 17's CustomerInvitation is discovered by the plain `CustomerId` half of the
        // predicate and is NOT exempt: it carries a real customer_id, a real policy pair and a
        // real global query filter. The anonymous accept endpoint reads it with IsAuthenticated
        // false, so the filter's own `!IsAuthenticated ||` prefix is what keeps that read working
        // - which is a reason to have the filter, not a reason to exempt the entity.
```

Then raise `filtered.Length.ShouldBe(Q_filtered)` to `Q_filtered + 1` and extend its message with
`plus migration 17's customer_invitation`.

`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs`

In `AutomaticPolicyCoverageTests.every_customer_owned_entity_type_has_row_level_security_enabled_and_both_policies`,
raise `customerIdOwned.Length.ShouldBe(A_customerId)` to `A_customerId + 1` and
`customerOwned.Length.ShouldBe(A_owned)` to `A_owned + 1`. Leave `accountIdOwned.Length` alone —
`CustomerInvitation` has no `CustomerAccountId` property, deliberately (see its own doc comment).

In `CatalogPolicyCoverageTests`, raise `customerIdTables.Count.ShouldBe(C_tables_customerId)` and
`tables.Count.ShouldBe(C_tables)` by one each. Leave `accountIdTables.Count` alone.

Add to each of the four comments the one clause that makes the number readable:
`plus migration 17's customer.customer_invitation, which carries customer_id and a policy pair`.

- [ ] **Step 8: Run everything these four guards touch, and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~QueryFilterModelTests|FullyQualifiedName~RowLevelSecurityTests|FullyQualifiedName~AutomaticPolicyCoverageTests|FullyQualifiedName~CatalogPolicyCoverageTests|FullyQualifiedName~InvitationSchemaTests|FullyQualifiedName~EnumWireAlgorithmDivergenceTests" 2>&1 | tail -30
```

Expected: build clean; all PASS, including the three new
`An_invitation_round_trips_and_stores_the_contracts_lowercase_role` cases.

⚠ `EnumWireAlgorithmDivergenceTests.ExpectedEnumTypeNames` must **not** move for this plan.
`MembershipRole` enters the model with plan 1's `CustomerMembership.Role`; `CustomerInvitation.Role`
is the same CLR type, and `ModelEnumTypes()` returns `.Distinct()`. If that test is red here, plan
1 left it unmoved and it is plan 1's line to add, not this one's.

- [ ] **Step 9: Mutate the explicit conversion, which is the only thing standing between the model and a 23514**

Delete the `.HasConversion(role => ToDatabase(role), stored => FromDatabase(stored))` line from
`CustomerInvitationConfiguration`, leaving `.HasColumnType("text").IsRequired()`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~An_invitation_round_trips" 2>&1 | tail -30
```

Expected: **FAIL**, all three cases, on the `await db.SaveChangesAsync(ct)` in the arrange block,
with
`Npgsql.PostgresException : 23514: new row for relation "customer_invitation" violates check constraint "ck_customer_invitation_role"`
and `DETAIL: Failing row contains (…, ADMIN, …)`. `EnumToTextConvention` wrote the SCREAMING_SNAKE
spelling and migration 17's check refused it — which is the whole reason both the explicit
conversion and the check exist.

Restore the line, then prove the restore and re-run the four guards:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform diff -- \
  src/Infrastructure/PeakPower.Persistence/Configurations/CustomerInvitationConfiguration.cs
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~InvitationSchemaTests|FullyQualifiedName~QueryFilterModelTests|FullyQualifiedName~CatalogPolicyCoverageTests|FullyQualifiedName~AutomaticPolicyCoverageTests" 2>&1 | tail -20
```

Expected: the diff shows the file as newly added with the `HasConversion` line present; all PASS.

- [ ] **Step 10: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform add \
  src/Infrastructure/PeakPower.Persistence/Configurations/CustomerInvitationConfiguration.cs \
  src/Infrastructure/PeakPower.Persistence/PeakPowerDbContext.cs \
  src/Infrastructure/PeakPower.Persistence/Migrations \
  tests/PeakPower.Integration.Tests/Migrations/InvitationSchemaTests.cs \
  tests/PeakPower.Integration.Tests/Tenancy/QueryFilterModelTests.cs \
  tests/PeakPower.Integration.Tests/Tenancy/RowLevelSecurityTests.cs
git -C /Users/thinhhuynh/PeakPower/peakpower-platform commit -m "feat(persistence): map CustomerInvitation, and move the four coverage literals

The entity carries customer_id, so the moment it is mapped four guards discover it - two on
the EF model and two on the PostgreSQL catalogue - and each pinned literal moves by exactly
one. It takes the standard global query filter rather than an exemption: the admin surface
is authenticated and wants the tenancy predicate, and the anonymous accept endpoint runs
with IsAuthenticated false, where the filter's own prefix collapses it to true.

The role column carries an EXPLICIT HasConversion rather than EnumToTextConvention's
SCREAMING_SNAKE, because shared contract section 3 makes the database spelling lowercase.
Verified by mutation against a real container: removing the conversion fails every insert
with 23514 on ck_customer_invitation_role, DETAIL naming ADMIN.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `POST /api/v1/company/invitations` — 202 always, and the branch that swallows

Design §6.1: *"answers `202` always — existing login, no login, or already a member. The throttle
counts every request outside the branch; the known branch swallows and logs its own failures,
because a `500` reachable from one branch only is itself the oracle. Mail is enqueued, never
awaited."*

**The one fact this handler learns, and the one it cannot.** After plan 1 the global query filter
on `CustomerAccount` is `!IsAuthenticated || account.Memberships.Any(m => m.CustomerId ==
ctx.CustomerId && m.RemovedAt == null)` (contract §10). So on an authenticated request,
`db.CustomerAccounts.AnyAsync(a => a.Email == address)` answers **"is this address already an
active member of the business I am acting for?"** — and nothing else. Whether the address has a
login at some *other* business is invisible to this handler by construction, not by care, so the
known/unknown oracle the design is guarding cannot be opened from here even by a future edit that
forgets why. That is also why one message is composed for both cases (open item 1): choosing
between two would require the fact the filter withholds.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Contracts/Customer/Portal/MembershipContracts.cs`
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Portal/InvitationEndpoints.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Onboarding/CustomerPortalLinks.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Program.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/MembershipFixture.cs` (create)
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/InvitationEndpointTests.cs` (create)

**Interfaces:**
- Consumes:
  - `CustomerInvitation.Issue(Guid customerId, string email, MembershipRole role, string tokenHash, Guid? invitedByAccountId, DateTimeOffset issuedAt)` (Task 2)
  - `PeakPowerDbContext.CustomerInvitations` (Task 3)
  - `ICustomerContext { Guid CustomerId; Guid AccountId; MembershipRole Role; bool IsAuthenticated; }` (plan 1)
  - `PeakPower.Domain.Customers.MembershipRoleWire.Of(MembershipRole)`, `.Values` and
    `.TryParse(string?, out MembershipRole)` — the whole type is declared by plan 1 in the domain
    and only consumed here (contract §13.2.1)
  - `OpaqueToken.Create()`, `OpaqueToken.HashOf(string)` — `PeakPower.Infrastructure.Identity`
  - `OutboundMailbox.Enqueue(string to, string subject, string body)` — `PeakPower.Infrastructure.Email`
  - `ISignInThrottle { TimeSpan DelayFor(string, string); void RecordFailure(string, string); void RecordSuccess(string, string); }`
  - `IRequestOrigin { string RemoteAddress { get; } }`
  - `IMarketCalendar.UtcNow`
  - `ApiResults.InvalidRequest(string property, string error)`
  - `AuditRecord.Create(DateTimeOffset, string actor, string action, string entityType, Guid entityId, Guid? customerId, string? before, string? after)`
- Produces:
  - `PeakPower.Contracts.Customer.Portal.CompanyInvitationRequest(string Email, string MembershipRole)`
  - `…CompanyInvitationAcceptance(string Token, string? FirstName, string? LastName, string? Password)`
  - `…CompanyInvitationAcceptedResponse(Guid CustomerId, string TradeName, string MembershipRole)`
  - `…CompanyMemberDto`, `…CompanyInvitationDto`, `…CompanyMembershipsResponse`, `…MembershipRoleChangeRequest`
  - `CustomerPortalLinks.InvitationUrl(string token)`
  - `InvitationEndpoints.MapInvitationEndpoints(this IEndpointRouteBuilder)`

- [ ] **Step 1: Write the shared test fixture**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/MembershipFixture.cs`:

```csharp
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Application.Abstractions;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Domain.Common;
using PeakPower.Domain.Customers;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

/// <summary>
/// Seeds a business with as many members as a test needs, at chosen roles, and signs one of them
/// in.
/// </summary>
/// <remarks>
/// <para>
/// Deliberately NOT an extension of <c>CustomerApiFactory.SeedCustomerWithAccountAsync</c>. That
/// helper seeds exactly one account per company and is the arrange step of a dozen slice-1 tests;
/// every fact in this plan needs two or three members of ONE business at different roles, which is
/// a different shape, and widening the shared helper to take a list would touch every one of those
/// call sites for no gain.
/// </para>
/// <para>
/// Everything is written on the OWNER connection through <c>CreateOwnerDbContext</c>, which
/// bypasses row-level security. That is correct for an arrange step and it is also the only thing
/// that works: writing a membership as <c>app_customer_role</c> requires being an admin of the
/// business already, which is exactly what the arrange step is trying to create.
/// </para>
/// </remarks>
public sealed class MembershipFixture(CustomerApiFactory factory)
{
    public const string Password = "correct-horse-battery";

    private static int _kvkCounter = 61_000_000;

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public sealed record Member(Guid AccountId, string Email, MembershipRole Role);

    public sealed record Business(Guid CustomerId, string TradeName, IReadOnlyList<Member> Members);

    /// <summary>
    /// One business, one membership per role in <paramref name="roles"/>, in that order.
    /// <paramref name="fourEyes"/> raises the admin floor from one to two (design decision 7).
    /// </summary>
    public async Task<Business> SeedBusinessAsync(bool fourEyes, params MembershipRole[] roles)
    {
        using var scope = factory.Services.CreateScope();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher>();

        await using var db = factory.CreateOwnerDbContext();

        var kvk = Interlocked.Increment(ref _kvkCounter).ToString(CultureInfo.InvariantCulture);
        var tradeName = $"Membership {Guid.NewGuid():N}";

        var customer = Customer.Create(
            $"{tradeName} B.V.",
            tradeName: tradeName,
            kvkNumber: KvkNumber.Create(kvk).Value,
            vatNumber: null,
            billingAddress: new Address("Havenweg", "12", null, "3011 AA", "Rotterdam", "NL"),
            visitingAddress: null,
            primaryContact: new ContactPerson("Els Bakker", "els@example.test", null),
            internalReference: null,
            locale: "nl-NL").Value;

        db.Customers.Add(customer);

        // four_eyes_enabled has no domain mutator - Customer.Create sets it false and the back
        // office owns the toggle (C8, [F01-R43], [F12-R41], all out of this plan's scope). Set it
        // with SQL on the owner connection, which is the same thing the back office would do.
        var members = new List<Member>();
        var issuedAt = DateTimeOffset.UtcNow;

        foreach (var role in roles)
        {
            var email = $"{Guid.NewGuid():N}@example.nl";

            var account = CustomerAccount.Create(
                username: email,
                firstName: "Sanne",
                lastName: $"de Vries {members.Count}",
                jobTitle: null,
                email: email,
                phone: null,
                status: AccountStatus.Active).Value;

            account.SetPassword(hasher.Hash(Password));

            db.CustomerAccounts.Add(account);
            db.CustomerMemberships.Add(
                CustomerMembership.Create(account.Id, customer.Id, role, issuedAt).Value);

            members.Add(new Member(account.Id, email, role));
        }

        await db.SaveChangesAsync(Ct);

        if (fourEyes)
        {
            await db.Database.ExecuteSqlAsync(
                $"UPDATE customer.customer SET four_eyes_enabled = true WHERE id = {customer.Id}",
                Ct);
        }

        return new Business(customer.Id, tradeName, members);
    }

    /// <summary>
    /// A client carrying a bearer token for <paramref name="member"/>. Signs in through the real
    /// endpoint rather than minting a token, so the token carries whatever claims the host
    /// actually issues - which is the half a hand-made token silently gets wrong.
    /// </summary>
    public async Task<HttpClient> SignInAsync(Member member)
    {
        var client = factory.CreateAnonymousClient();

        var signIn = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in", new SignInRequest(member.Email, Password), Ct);

        signIn.StatusCode.ShouldBe(
            HttpStatusCode.OK,
            "every fact in this file asserts through a signed-in client; a failed sign-in would "
            + "make them all assert against 401s");

        var body = await signIn.Content.ReadFromJsonAsync<SignInResponse>(Ct);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body!.AccessToken);

        return client;
    }
}
```

⚠ **`CustomerAccount.Create`'s parameter list here is this plan's assumption about what plan 1
left** (Preflight item 4). If the real one differs, correct it here once — every later task reuses
this fixture.

- [ ] **Step 2: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/InvitationEndpointTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Customers;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

/// <summary>
/// <c>POST /api/v1/company/invitations</c> — the issue half. The accept half is
/// <c>InvitationAcceptTests</c>; the "known and unknown are indistinguishable" probe the shared
/// contract section 11 requires is <c>IndistinguishableInvitationTests</c>, kept separate because
/// it needs its own host with its own recorders.
/// </summary>
public sealed class InvitationEndpointTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Invitations = "/api/v1/company/invitations";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private MembershipFixture Seed => new(factory);

    [Fact]
    public async Task An_admin_invites_an_address_and_gets_202_with_no_body()
    {
        var business = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var client = await Seed.SignInAsync(business.Members[0]);

        var response = await client.PostAsJsonAsync(
            Invitations, new CompanyInvitationRequest("nieuw@example.nl", "trader"), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        (await response.Content.ReadAsStringAsync(Ct)).ShouldBe(string.Empty);
    }

    [Fact]
    public async Task The_invitation_row_names_the_business_the_role_and_the_inviter()
    {
        var business = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var client = await Seed.SignInAsync(business.Members[0]);

        await client.PostAsJsonAsync(
            Invitations, new CompanyInvitationRequest("Nieuwe.Collega@Example.NL", "admin"), Ct);

        await using var db = factory.CreateOwnerDbContext();
        var invitation = await db.CustomerInvitations
            .SingleAsync(i => i.CustomerId == business.CustomerId, Ct);

        invitation.Email.ShouldBe("nieuwe.collega@example.nl");
        invitation.Role.ShouldBe(MembershipRole.Admin);
        invitation.InvitedByAccountId.ShouldBe(business.Members[0].AccountId);
        invitation.AcceptedAt.ShouldBeNull();
        // Fourteen days, through the endpoint rather than through the factory - the reset flow's
        // hour is what r1 shipped here, and the only place that can now go wrong is a handler
        // that computed its own expiry instead of letting CustomerInvitation.Issue do it.
        (invitation.ExpiresAt - invitation.IssuedAt).ShouldBe(TimeSpan.FromDays(14));
    }

    /// <summary>
    /// The plaintext token reaches exactly one place: the message. It is not in the response, not
    /// in the row, and not in any log - which is why the assertion reads the stored digest and
    /// derives it from what the mail carried, rather than the other way round.
    /// </summary>
    [Fact]
    public async Task The_token_is_mailed_once_and_stored_only_as_a_digest()
    {
        var business = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var client = await Seed.SignInAsync(business.Members[0]);
        var address = $"{Guid.NewGuid():N}@example.nl";

        var before = factory.Emails.Sent.Count;
        await client.PostAsJsonAsync(
            Invitations, new CompanyInvitationRequest(address, "viewer"), Ct);

        // The send is off the request path - OutboundMailbox hands it to a background drain - so
        // poll rather than assert immediately. Ten tries at 50ms is half a second, which is two
        // orders of magnitude more than a channel read and a console write need.
        var message = await WaitForMessageAsync(address, before);

        message.Body.ShouldContain("http://localhost:4200/accept-invitation?token=");

        var token = message.Body
            .Split("?token=", StringSplitOptions.None)[1]
            .Split('\n', StringSplitOptions.None)[0]
            .Trim();

        await using var db = factory.CreateOwnerDbContext();
        var invitation = await db.CustomerInvitations
            .SingleAsync(i => i.CustomerId == business.CustomerId, Ct);

        invitation.TokenHash.ShouldBe(
            PeakPower.Infrastructure.Identity.OpaqueToken.HashOf(token),
            "the row must carry the digest of the token that was actually mailed");
        invitation.TokenHash.ShouldNotBe(token);
    }

    /// <summary>
    /// The message says neither "your new account" nor "your existing account", and names no
    /// business the recipient may already be in. Open item 1 of the design is what copy this
    /// should be; what is NOT open is that it must be ONE message, because choosing between two
    /// requires the fact this handler is built not to learn.
    /// </summary>
    [Fact]
    public async Task The_message_implies_nothing_about_whether_the_address_already_has_a_login()
    {
        var business = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var client = await Seed.SignInAsync(business.Members[0]);
        var address = $"{Guid.NewGuid():N}@example.nl";

        var before = factory.Emails.Sent.Count;
        await client.PostAsJsonAsync(
            Invitations, new CompanyInvitationRequest(address, "trader"), Ct);

        var message = await WaitForMessageAsync(address, before);

        // Ordinal, and case-insensitively absent: Shouldly's ShouldNotContain is case-INSENSITIVE
        // by default, which is the behaviour wanted here for once - "Your new account" must fail
        // this as surely as "your new account".
        message.Body.ShouldNotContain("new account");
        message.Body.ShouldNotContain("create an account");
        message.Body.ShouldNotContain("existing account");
        message.Body.ShouldContain(business.TradeName, Case.Sensitive);
    }

    [Fact]
    public async Task Inviting_somebody_who_is_already_a_member_writes_nothing_and_still_answers_202()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);
        var client = await Seed.SignInAsync(business.Members[0]);

        var response = await client.PostAsJsonAsync(
            Invitations, new CompanyInvitationRequest(business.Members[1].Email, "admin"), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Accepted);

        await using var db = factory.CreateOwnerDbContext();
        (await db.CustomerInvitations.CountAsync(i => i.CustomerId == business.CustomerId, Ct))
            .ShouldBe(0, "re-inviting a colleague who is already in is a no-op, not a second row");

        // And it did not silently promote them either: the role change verb is PATCH, and an
        // invitation is not a back door to it.
        var membership = await db.CustomerMemberships.SingleAsync(
            m => m.AccountId == business.Members[1].AccountId
              && m.CustomerId == business.CustomerId, Ct);
        membership.Role.ShouldBe(MembershipRole.Trader);
    }

    [Fact]
    public async Task A_non_admin_cannot_invite()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);
        var client = await Seed.SignInAsync(business.Members[1]);

        var response = await client.PostAsJsonAsync(
            Invitations, new CompanyInvitationRequest("nieuw@example.nl", "trader"), Ct);

        // The authorization middleware's own 403 - the one documented exception to the ban
        // TenancyArchitectureTests.no_type_produces_a_forbidden_response enforces on every TYPE in
        // this codebase. No handler produced it.
        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);

        await using var db = factory.CreateOwnerDbContext();
        (await db.CustomerInvitations.CountAsync(i => i.CustomerId == business.CustomerId, Ct))
            .ShouldBe(0);
    }

    [Theory]
    [InlineData("", "email")]
    [InlineData("   ", "email")]
    [InlineData("not-an-address", "email")]
    public async Task A_malformed_address_is_a_400_naming_the_field(string address, string field)
    {
        var business = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var client = await Seed.SignInAsync(business.Members[0]);

        var response = await client.PostAsJsonAsync(
            Invitations, new CompanyInvitationRequest(address, "trader"), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync(Ct)).ShouldContain(field, Case.Sensitive);
    }

    /// <summary>
    /// SCREAMING_SNAKE is refused. Shared contract section 3 makes the wire spelling lowercase in
    /// both directions, and a parser that accepted both would make the contract two contracts.
    /// </summary>
    [Theory]
    [InlineData("ADMIN")]
    [InlineData("Admin")]
    [InlineData("owner")]
    [InlineData("")]
    public async Task An_unknown_role_is_a_400_naming_membershipRole(string role)
    {
        var business = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var client = await Seed.SignInAsync(business.Members[0]);

        var response = await client.PostAsJsonAsync(
            Invitations, new CompanyInvitationRequest("nieuw@example.nl", role), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync(Ct))
            .ShouldContain("membershipRole", Case.Sensitive);
    }

    /// <summary>
    /// Every membership write is audited [DEC-150]. The entity is the ACCOUNT that will exist, so
    /// an invitation names the business it is for and carries the address in its payload - there
    /// is no account id yet to file it under.
    /// </summary>
    [Fact]
    public async Task Issuing_an_invitation_writes_an_audit_record()
    {
        var business = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var client = await Seed.SignInAsync(business.Members[0]);

        await client.PostAsJsonAsync(
            Invitations, new CompanyInvitationRequest("nieuw@example.nl", "viewer"), Ct);

        await using var db = factory.CreateOwnerDbContext();
        var record = await db.AuditRecords.SingleAsync(
            r => r.CustomerId == business.CustomerId && r.Action == "MEMBERSHIP_INVITED", Ct);

        record.Actor.ShouldBe($"account:{business.Members[0].AccountId}");
        record.EntityType.ShouldBe("CustomerMembership");
        record.EntityId.ShouldBe(business.CustomerId);
        record.Before.ShouldBeNull();
        record.After.ShouldNotBeNull();
        record.After!.ShouldContain("nieuw@example.nl", Case.Sensitive);
        record.After.ShouldContain("viewer", Case.Sensitive);
    }

    private async Task<(string To, string Subject, string Body)> WaitForMessageAsync(
        string address, int before)
    {
        for (var attempt = 0; attempt < 20; attempt++)
        {
            var sent = factory.Emails.Sent;
            if (sent.Count > before)
            {
                var match = sent.Skip(before).FirstOrDefault(
                    message => string.Equals(message.To, address, StringComparison.OrdinalIgnoreCase));
                if (match.To is not null) return match;
            }

            await Task.Delay(50, Ct);
        }

        throw new Xunit.Sdk.XunitException(
            $"no message reached {address} within one second; the mailbox drains on a background "
            + "service, so this means the enqueue never happened rather than that it was slow");
    }
}
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~InvitationEndpointTests" 2>&1 | tail -30
```

Expected: **build failure** —
`error CS0246: The type or namespace name 'CompanyInvitationRequest' could not be found`, plus
`CS1061` on `MembershipFixture` if `CustomerAccount.Create`'s real signature differs from the
Preflight assumption. Fix that one now, in `MembershipFixture` only.

- [ ] **Step 4: Write the contracts**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Contracts/Customer/Portal/MembershipContracts.cs`:

```csharp
namespace PeakPower.Contracts.Customer.Portal;

/// <summary>
/// Ask an address to join this business. The answer is <b>202 whether or not the address has a
/// login</b> — see <c>InvitationEndpoints</c> for why that is the endpoint's whole point rather
/// than an omission.
/// </summary>
/// <param name="MembershipRole">
/// <c>admin</c> | <c>trader</c> | <c>viewer</c>, LOWERCASE — shared contract §3 makes that the
/// spelling in the database AND on the wire. <c>ADMIN</c> is refused with a 400, deliberately:
/// accepting both would make one contract into two.
/// </param>
public sealed record CompanyInvitationRequest(string Email, string MembershipRole);

/// <summary>
/// Redeem an invitation. The token is the credential — there is no session, which is why the
/// endpoint that takes this is anonymous.
/// </summary>
/// <remarks>
/// ⚠ <b>The three name/password fields are this plan's one deviation from shared contract §8</b>,
/// which writes the body as <c>{ token }</c>. They are ignored for an address that already has a
/// login, so <c>{ token }</c> alone is a complete and successful request for that case — exactly
/// the contract's shape. For an address with no login they are required, because
/// <c>CustomerAccount.Create</c> refuses a blank first or last name and an account with no
/// password hash can never sign in, and neither the invitation (which carries
/// <c>{ email, membershipRole }</c>) nor a bare <c>{ token }</c> carries either. The endpoint
/// answers 400 with an <c>errors</c> map naming all three and leaves the invitation unspent, so a
/// caller discovers the requirement by asking rather than through a preflight route that would
/// tell anyone which addresses have logins.
/// </remarks>
public sealed record CompanyInvitationAcceptance(
    string Token, string? FirstName, string? LastName, string? Password);

/// <summary>
/// What the invitee joined. Carries no credential and no session: the person signs in normally
/// afterwards, exactly as password-reset completion hands back no session either.
/// </summary>
public sealed record CompanyInvitationAcceptedResponse(
    Guid CustomerId, string TradeName, string MembershipRole);

/// <summary>
/// One colleague, as the member-management screen shows them. Replaces
/// <see cref="CompanyAccountDto"/>'s read-only view for that screen: no <c>isAdmin</c> boolean —
/// <c>[F01-R13]</c>'s "no permission field on an account" is reversed by design §1.1 and the role
/// lives on the MEMBERSHIP, not on the account.
/// </summary>
/// <param name="JoinedAt">
/// <c>customer_membership.created_at</c>. A re-invited colleague keeps the original — <c>Restore</c>
/// clears <c>removed_at</c> and does not re-date the row — so this is "since when have they been
/// one of us", which is the question the column answers.
/// </param>
public sealed record CompanyMemberDto(
    Guid AccountId,
    string FirstName,
    string LastName,
    string? JobTitle,
    string Email,
    string MembershipRole,
    string Status,
    DateTimeOffset JoinedAt,
    DateTimeOffset? LastLoginAt);

/// <summary>
/// One invitation that has been sent and not yet accepted. No token and no digest: the row's only
/// secret never leaves the database, and an admin who could read the digest could not use it
/// anyway — but publishing it would put a credential-shaped value on a screen for no reason.
/// </summary>
public sealed record CompanyInvitationDto(
    Guid Id,
    string Email,
    string MembershipRole,
    DateTimeOffset InvitedAt,
    DateTimeOffset ExpiresAt);

/// <summary>
/// The member-management screen's whole state: who is in, and who has been asked.
/// </summary>
/// <remarks>
/// The pending list is this plan's own addition — shared contract §8 fixes the route and its
/// authorisation, not its response shape. An admin who cannot see that an invitation is
/// outstanding re-invites the same person weekly.
/// <para>
/// ⚠ Neither list ever names a colleague's memberships in OTHER businesses. §5's permissive
/// <c>OR</c> in the tenant-isolation policy makes those rows readable to this connection; the
/// explicit <c>AND customer_id = @active</c> every query here carries is what keeps them out of
/// this payload (design §12 item 3).
/// </para>
/// </remarks>
public sealed record CompanyMembershipsResponse(
    IReadOnlyList<CompanyMemberDto> Members,
    IReadOnlyList<CompanyInvitationDto> PendingInvitations);

/// <summary>Change what one colleague is. <c>admin</c> | <c>trader</c> | <c>viewer</c>, lowercase.</summary>
public sealed record MembershipRoleChangeRequest(string MembershipRole);
```

- [ ] **Step 5: Read `MembershipRoleWire`, and write nothing into it**

⚠ **`MembershipRoleWire` is not this plan's type, and this step adds no code.** Contract §13.2.1
gives plan 1 the whole surface — the three `const string`s, `Values`, `Of(MembershipRole)`,
`Parse(string)` and `TryParse(string?, out MembershipRole)` — in the **domain**, at
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Core/PeakPower.Domain/Customers/MembershipRoleWire.cs`,
with plan 1's own `MembershipRoleWireTests` pinning both directions against the database's `CHECK`
constraint. Do **not** restate any of it, here or on `PortalMappings`: two definitions of one
spelling is a silent behaviour fork, and a second `Wire` overload would also drag the role into
`CompanyEndpointTests.Every_wire_spelling_PortalMappings_produces_is_the_shared_converters_spelling`,
which holds every overload to `EnumWireFormat`'s `ADMIN`.

⚠ An earlier revision of this plan added `Parse(string?) -> MembershipRole?` here. **It must not be
written.** Reference nullability does not differentiate an overload, so it and plan 1's
`Parse(string) -> MembershipRole` are `CS0111: the type already contains a definition for 'Parse'`.
`TryParse` exists for exactly this, and every handler in this plan that reads a role off the wire
calls it:

```csharp
        if (!MembershipRoleWire.TryParse(request.MembershipRole, out var role))
        {
            return ApiResults.InvalidRequest(
                "membershipRole",
                "membershipRole must be one of: "
                + $"{string.Join(", ", MembershipRoleWire.Values)}.");
        }
```

That is the shape Step 7 below and Task 7's `ChangeRoleAsync` both use — `TryParse` for the boundary
check, `Values` for the message, so the accepted set and the documented set stay one array.

No `using` to add: `MembershipRoleWire` lives in `PeakPower.Domain.Customers`, and
`PortalMappings.cs` already imports that namespace (verified, `PortalMappings.cs:4`), as do the
endpoint files this plan creates.

- [ ] **Step 6: Add the portal link**

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Onboarding/CustomerPortalLinks.cs`,
after `ResetUrl`:

```csharp
    /// <summary>
    /// The screen an invitee opens to accept — <c>/accept-invitation?token={token}</c> in the
    /// customer portal.
    /// </summary>
    /// <remarks>
    /// The token is NOT escaped, for exactly the reason <see cref="ResetUrl"/> records:
    /// <c>OpaqueToken.Create</c> returns <c>Base64UrlEncoder.Encode</c> output, whose alphabet is
    /// already URL-safe — no <c>+</c>, no <c>/</c>, no <c>=</c> padding — so
    /// <c>Uri.EscapeDataString</c> would change nothing on every input it can produce. The accept
    /// page reads the parameter with <c>queryParamMap.get('token')</c>, which decodes; should the
    /// alphabet ever change, escaping HERE is the correct fix, not decoding there.
    /// </remarks>
    public string InvitationUrl(string token) => $"{_baseUrl}/accept-invitation?token={token}";
```

- [ ] **Step 7: Write the endpoint**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Portal/InvitationEndpoints.cs`.
(This file gains its second endpoint — the accept — in Task 5; write the issue half now.)

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Auditing;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Email;
using PeakPower.Infrastructure.Identity;
using PeakPower.Infrastructure.Web.Http;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;

namespace PeakPower.Api.Customer.Portal;

/// <summary>
/// Asking somebody to join a business, and their redeeming that invitation.
/// </summary>
/// <remarks>
/// <para>
/// <b>Two endpoints with opposite postures, kept in one file on purpose.</b> Issuing is a
/// <c>CompanyAdmin</c> write on the tenant connection, under the row-level-security policy pair
/// migration 17 ships. Accepting is <b>anonymous, on the owner connection</b>, authorised by the
/// token and not by tenancy. Reading the two together is the only way the asymmetry stays
/// legible.
/// </para>
/// <para>
/// Nothing here binds <c>HttpContext</c> or <c>IHttpContextAccessor</c>; architecture fact 6
/// reserves those for <c>PeakPower.Infrastructure.Web</c>, and the caller's remote address arrives
/// through the <see cref="IRequestOrigin"/> port.
/// </para>
/// </remarks>
public static class InvitationEndpoints
{
    private const string Invitations = "/api/v1/company/invitations";
    private const string Accept = "/api/v1/company/invitations/accept";

    /// <summary>The <c>audit.audit_record.entity_type</c> every row written here carries.</summary>
    /// <remarks>
    /// <c>CustomerMembership</c> and not <c>CustomerInvitation</c>, deliberately: an invitation, an
    /// acceptance, a role change and a removal are four records about ONE person's standing in one
    /// business, and filing the first under a different entity type would scatter that history
    /// across two indexes. The same reasoning <c>EntitlementEndpoints.AuditEntityType</c> records
    /// for filing an activation and its later deactivation under the company.
    /// </remarks>
    internal const string AuditEntityType = "CustomerMembership";

    internal const string InvitedAction = "MEMBERSHIP_INVITED";

    public static IEndpointRouteBuilder MapInvitationEndpoints(this IEndpointRouteBuilder routes)
    {
        // Mapped at the full path on `routes` rather than inside a group, for the reason
        // CompanyEndpoints and EntitlementEndpoints already record: RoutePatternFactory.Combine
        // appends unconditionally, so a group-relative MapPost("") registers ".../invitations/"
        // with a trailing slash. Both spellings answer the same request, so the difference never
        // shows up in a test that calls the endpoint - it shows up in the endpoint table
        // CustomerApiRouteTableTests pins and in the OpenAPI document the portal generates from.
        routes.MapPost(Invitations, IssueAsync)
            .WithTags("Company")
            .RequireAuthorization(CustomerAuthorizationPolicies.CompanyAdmin)
            .TenantScoped("customer")
            .WithName("InviteToCompany")
            .WithSummary("Invite an email address to join this company. Admins only.")
            // 202 and nothing else on the success side, and that IS the endpoint rather than an
            // omission: the handler swallows its own failures (see IssueAsync) so that an address
            // which already belongs to a member and one that does not are indistinguishable in
            // status, body and timing. Declaring anything else here would document the oracle this
            // endpoint exists to close, and a generated client would grow a branch that can never
            // be taken.
            .Produces(StatusCodes.Status202Accepted)
            // The 400 is about the REQUEST - a malformed address, an unknown role - and never
            // about the address's standing. It leaks nothing: the answer is the same whether the
            // address is a colleague, a stranger or nobody at all.
            .ProducesValidationProblem();

        return routes;
    }

    /// <summary>
    /// Ask an address to join. 202 always.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The one fact this handler learns.</b> After plan 1 the global query filter on
    /// <c>CustomerAccount</c> reads
    /// <c>!IsAuthenticated || account.Memberships.Any(m =&gt; m.CustomerId == ctx.CustomerId &amp;&amp; m.RemovedAt == null)</c>,
    /// so <c>db.CustomerAccounts.AnyAsync(a =&gt; a.Email == address)</c> on this authenticated
    /// request answers "is this address already an active member of the business I am acting for?"
    /// — and nothing else. Whether it has a login at some OTHER business is invisible here by
    /// construction. That is why one message is composed for both cases: choosing between two
    /// would need the fact the filter withholds.
    /// </para>
    /// <para>
    /// <b>Branching on "already a member" leaks nothing</b>, because the caller can read exactly
    /// that from <c>GET /api/v1/company/memberships</c>. The oracle the design closes is the other
    /// one — "does this address have a PeakPower login anywhere" — and this handler cannot answer
    /// it.
    /// </para>
    /// <para>
    /// <b>The throttle counts every request, outside the branch.</b> A counter that only ticked on
    /// one arm would let an attacker distinguish the arms by how long the NEXT request took.
    /// <c>RecordFailure</c> and never <c>RecordSuccess</c>, exactly as
    /// <c>RequestPasswordResetAsync</c> does it: there is no "success" here to reset a counter
    /// with.
    /// </para>
    /// </remarks>
    private static async Task<IResult> IssueAsync(
        CompanyInvitationRequest request,
        ICustomerContext tenancy,
        IRequestOrigin requestOrigin,
        PeakPowerDbContext db,
        OutboundMailbox outbound,
        ISignInThrottle throttle,
        IMarketCalendar calendar,
        PeakPower.Api.Customer.Onboarding.CustomerPortalLinks portal,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var address = (request.Email ?? string.Empty).Trim();

        // Both checks before the throttle, and before anything reads the database: a request this
        // endpoint cannot parse is not an attempt on an address, so counting it would let somebody
        // slow another admin's invitations down by sending rubbish.
        if (!LooksLikeAnEmailAddress(address))
        {
            return ApiResults.InvalidRequest(
                "email", "Enter an email address. It must contain an @.");
        }

        // MembershipRoleWire.TryParse and not a nullable-returning Parse: contract §13.2.1 gives
        // plan 1 the single declaration, and `Parse(string?)` beside its `Parse(string)` is CS0111.
        if (!MembershipRoleWire.TryParse(request.MembershipRole, out var role))
        {
            return ApiResults.InvalidRequest(
                "membershipRole",
                "membershipRole must be one of: "
                + $"{string.Join(", ", MembershipRoleWire.Values)}.");
        }

        var source = requestOrigin.RemoteAddress;
        var delay = throttle.DelayFor(address, source);
        if (delay > TimeSpan.Zero) await Task.Delay(delay, cancellationToken);
        throttle.RecordFailure(address, source);   // every request counts, none is "success"

        // See this method's own remarks: under the post-membership query filter this reads
        // "already an active member of the business I am acting for", which the caller can also
        // read off GET /company/memberships. No IgnoreQueryFilters - the filter IS the predicate.
        var alreadyAMember = await db.CustomerAccounts
            .AsNoTracking()
            .AnyAsync(account => account.Email == address, cancellationToken);

        if (!alreadyAMember)
        {
            // ---------------------------------------------------------------------------------
            // The branch that does work, and therefore the branch that can fail. A 500 reachable
            // from one arm only IS the oracle, so this arm swallows and logs.
            //
            // ⚠ A SAVEPOINT, and it is not decoration. This endpoint is authenticated, so
            // CustomerSessionMiddleware has already opened a transaction for the request and
            // commits it after the handler returns (CustomerSessionMiddleware.cs:61 and :123). A
            // swallowed DbUpdateException inside that transaction leaves PostgreSQL in the aborted
            // state 25P02, and the middleware's own CommitAsync then throws - so the 500 this
            // catch exists to prevent comes back one layer up, on exactly the one arm that reaches
            // a write. Rolling back to a savepoint restores the transaction to a usable state.
            // The password-reset request handler needs none of this because it is anonymous and
            // has no ambient transaction to poison.
            // ---------------------------------------------------------------------------------
            var transaction = db.Database.CurrentTransaction;

            try
            {
                if (transaction is not null)
                {
                    await transaction.CreateSavepointAsync("invitation", cancellationToken);
                }

                var now = calendar.UtcNow;
                var token = OpaqueToken.Create();

                db.CustomerInvitations.Add(CustomerInvitation.Issue(
                    tenancy.CustomerId,
                    address,
                    role,
                    OpaqueToken.HashOf(token),
                    tenancy.AccountId,
                    now));

                Audit(db, now, $"account:{tenancy.AccountId}", InvitedAction, tenancy.CustomerId,
                      before: null, after: Payload(address, MembershipRoleWire.Of(role)));

                await db.SaveChangesAsync(cancellationToken);

                // The trade name, for the message. Read AFTER the write and not before, so the
                // read costs the same on both arms of the "already a member" branch - it does not
                // run on the other arm at all, which is the point: the arm that sends is the arm
                // that needs it.
                var tradeName = await db.Customers
                    .AsNoTracking()
                    .Where(customer => customer.Id == tenancy.CustomerId)
                    .Select(customer => customer.TradeName ?? customer.LegalName)
                    .SingleAsync(cancellationToken);

                // Enqueue, not send: no await, no socket, and nothing a stopwatch on the other end
                // can tell apart from the arm that does none of it. OutboundMailbox's own remarks
                // argue the drop-when-full trade in full; the short version is that a dropped
                // invitation costs one more click and a leaked customer list cannot be taken back.
                //
                // ⚠ ONE message for both cases. Design §12 item 1 leaves the exact copy open; what
                // is settled is that it must imply neither a new account nor an existing one, and
                // must name no business the recipient is already in. Choosing between two texts
                // would require knowing whether the address has a login, which this handler cannot
                // find out.
                outbound.Enqueue(
                    address,
                    $"You have been invited to {tradeName} on PeakPower",
                    $"""
                     Hello,

                     You have been invited to act for {tradeName} on PeakPower.

                     Open this link to accept. It works once and expires in fourteen days.

                     {portal.InvitationUrl(token)}

                     If you were not expecting this, nothing has changed and you can ignore this
                     message.
                     """);
            }
            catch (Exception exception)
            {
                // Only the database write and the trade-name read can land here now; the delivery
                // failure this used to catch is caught by OutboundMailService instead, which logs
                // it the same way.
                if (transaction is not null)
                {
                    await transaction.RollbackToSavepointAsync("invitation", cancellationToken);
                }

                // The change tracker still holds the rejected insert, and the middleware commits
                // after this returns; leaving it tracked would retry the failing write there,
                // where nothing swallows it.
                db.ChangeTracker.Clear();

                // No address in the log line. This arm is reached only for an address that is NOT
                // already a colleague, so naming it here would put a list of outsiders into the
                // log file - the same fact the 202 refuses to put in the response.
                loggerFactory.CreateLogger("PeakPower.Api.Customer.Portal.InvitationEndpoints")
                    .LogError(exception, "Failed to issue a company invitation.");
            }
        }

        // 202 either way. Answering anything else for an address that is already a colleague would
        // be harmless on its own - the caller can see the member list - but two success codes is
        // two code paths a client branches on, and the branch is where a future edit puts the
        // fact that actually matters.
        return Results.Accepted();
    }

    /// <summary>
    /// The same shape <c>CustomerAccount.LooksLikeAnEmailAddress</c> uses, duplicated rather than
    /// exposed: that one is a private invariant of the aggregate, and an endpoint reaching into it
    /// would make a domain rule part of the HTTP contract by accident. Both are deliberately
    /// permissive — the address is proven by the message arriving, not by a regular expression.
    /// </summary>
    private static bool LooksLikeAnEmailAddress(string email) =>
        !string.IsNullOrWhiteSpace(email)
        && email.Contains('@', StringComparison.Ordinal)
        && email.Trim().Length > 2;

    /// <summary>
    /// One append-only audit row. <c>Before</c> and <c>After</c> are jsonb columns the database
    /// parses, so both are written as JSON documents rather than as prose.
    /// </summary>
    internal static void Audit(
        PeakPowerDbContext db,
        DateTimeOffset now,
        string actor,
        string action,
        Guid customerId,
        string? before,
        string? after)
    {
        var record = AuditRecord.Create(
            now, actor, action, AuditEntityType,
            // The BUSINESS, for an invitation: there is no account id yet to file it under, and
            // the address is in the payload. Task 8's removal files under the account id, which is
            // the finer key wherever one exists.
            entityId: customerId,
            customerId: customerId,
            before: before,
            after: after);

        // Create refuses only a blank actor, action or entity type, all three of which are
        // constants here. Guarded rather than dereferenced, because a failed Result's .Value
        // throws an InvalidOperationException that names none of them.
        if (record.IsSuccess)
        {
            db.AuditRecords.Add(record.Value);
        }
    }

    /// <summary>
    /// The jsonb payload, hand-written rather than serialised: two fields, one a lowercase role
    /// constant and one an address that has already passed <see cref="LooksLikeAnEmailAddress"/>.
    /// </summary>
    /// <remarks>
    /// ⚠ The address is escaped for JSON. Unlike <c>EntitlementEndpoints.Payload</c>, whose only
    /// field is a catalogue id that cannot contain a quote or a backslash, this one carries a value
    /// a caller typed — and an unescaped quote in it would make the column's jsonb parse fail with
    /// 22P02 inside the try above, turning a valid invitation into a silently swallowed one.
    /// </remarks>
    internal static string Payload(string email, string membershipRole) =>
        $$"""{"email":{{System.Text.Json.JsonSerializer.Serialize(email)}},"membershipRole":"{{membershipRole}}"}""";
}
```

- [ ] **Step 8: Map it, and publish the role's value set**

In `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Program.cs`,
in the flat alphabetical list of portal groups, after `app.MapEntitlementEndpoints();`:

```csharp
// Invitations [design §6.1]. The POST is admin-only; the accept beside it is ANONYMOUS and runs on
// the owner connection, because the invitation token is the authorisation and not tenancy - see
// InvitationEndpoints' own remarks, and AnonymousEndpointAllowListTests for the standing guard.
app.MapInvitationEndpoints();
```

In
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/OpenApi/EnumWireValuesSchemaTransformer.cs`,
add to the dictionary, before the closing `}.ToFrozenDictionary();`:

```csharp
            // The membership role, in every DTO that carries one. ⚠ MembershipRoleWire.Values
            // (the domain type plan 1 owns, contract §13.2.1) and NOT
            // EnumWireFormat.Names<MembershipRole>(): shared contract §3 spells these values
            // LOWERCASE in the database and on the wire alike, and EnumWireFormat would publish
            // ADMIN - a documented set the endpoint answers 400 for. Reading the same array
            // MembershipRoleWire.TryParse accepts is what keeps the documented set and the
            // accepted set one array. ⚠ Spread, not assigned: this dictionary's value type is
            // string[] and §13.2.1 declares Values as IReadOnlyList<string>, so a bare assignment
            // is CS0266.
            [(typeof(CompanyInvitationRequest), "membershipRole")] =
                [.. MembershipRoleWire.Values],
            [(typeof(MembershipRoleChangeRequest), "membershipRole")] =
                [.. MembershipRoleWire.Values],
            [(typeof(CompanyMemberDto), "membershipRole")] =
                [.. MembershipRoleWire.Values],
            [(typeof(CompanyInvitationDto), "membershipRole")] =
                [.. MembershipRoleWire.Values],
            [(typeof(CompanyInvitationAcceptedResponse), "membershipRole")] =
                [.. MembershipRoleWire.Values],
```

- [ ] **Step 9: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~InvitationEndpointTests" 2>&1 | tail -30
```

Expected: build clean; PASS, all fifteen cases (three `Theory` rows for the address, four for the
role, eight `Fact`s).

⚠ **Do not run the whole suite yet.** Task 9's route-table, sample-body, response-metadata and
OpenAPI-snapshot pins are still at their pre-invitation values, so `CustomerApiRouteTableTests`,
`CustomerResponseMetadataTests` and `CustomerOpenApiSnapshotTests` are red by design until Task 9.

- [ ] **Step 10: Mutate the throttle's position, then the swallow**

**Mutation 1 — move the throttle inside the branch.** Cut the three throttle lines and paste them
as the first three lines inside `if (!alreadyAMember) { … }`, before the `try`.

Add this test to `InvitationEndpointTests` first — it is the assertion the mutation must break, and
it belongs in the file permanently:

```csharp
    /// <summary>
    /// The throttle counts EVERY request, on both arms of the branch. A counter that ticked on one
    /// arm only would let an attacker read the arm off how long the NEXT request took - the oracle
    /// moved one request downstream, which is harder to see and just as effective.
    /// </summary>
    [Fact]
    public async Task The_throttle_counts_a_request_for_a_colleague_as_well_as_for_a_stranger()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);
        var recorder = new RecordingThrottle();

        using var host = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
                services.AddSingleton<PeakPower.Infrastructure.Web.Auth.ISignInThrottle>(recorder)));

        var client = await SignInThroughAsync(host, business.Members[0]);

        recorder.Reset();
        await client.PostAsJsonAsync(
            Invitations, new CompanyInvitationRequest(business.Members[1].Email, "trader"), Ct);
        var forAColleague = recorder.Reset();

        await client.PostAsJsonAsync(
            Invitations, new CompanyInvitationRequest($"{Guid.NewGuid():N}@nowhere.example", "trader"), Ct);
        var forAStranger = recorder.Reset();

        forAColleague.ShouldBe(1, "an address that is already a colleague still costs a count");
        forAStranger.ShouldBe(1);
    }
```

with these members on the class:

```csharp
    private async Task<HttpClient> SignInThroughAsync(
        WebApplicationFactory<PeakPower.Api.Customer.CustomerApiEntryPoint> host,
        MembershipFixture.Member member)
    {
        var client = host.CreateClient();
        var signIn = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in",
            new PeakPower.Contracts.Customer.Auth.SignInRequest(
                member.Email, MembershipFixture.Password),
            Ct);
        signIn.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await signIn.Content
            .ReadFromJsonAsync<PeakPower.Contracts.Customer.Auth.SignInResponse>(Ct);
        client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", body!.AccessToken);
        return client;
    }

    /// <summary>
    /// Counts RecordFailure calls and delays nothing. A real InMemorySignInThrottle would also
    /// work, but its curve makes the second call in a test sleep - and a test that sleeps is a
    /// test somebody eventually deletes.
    /// </summary>
    private sealed class RecordingThrottle : PeakPower.Infrastructure.Web.Auth.ISignInThrottle
    {
        private int _failures;

        public TimeSpan DelayFor(string username, string source) => TimeSpan.Zero;

        public void RecordFailure(string username, string source) =>
            Interlocked.Increment(ref _failures);

        public void RecordSuccess(string username, string source)
        {
        }

        public int Reset() => Interlocked.Exchange(ref _failures, 0);
    }
```

Add `using Microsoft.AspNetCore.Mvc.Testing;`, `using Microsoft.AspNetCore.TestHost;` and
`using Microsoft.Extensions.DependencyInjection;` to the file.

Now apply the mutation and run:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~The_throttle_counts_a_request_for_a_colleague" 2>&1 | tail -20
```

Expected: **FAIL** on
`forAColleague.ShouldBe(1, "an address that is already a colleague still costs a count")` —
`0 should be 1`. The stranger's count is still 1, which is what tells you the mutation was narrow.
Restore the three lines to their place above the branch.

**Mutation 2 — drop the savepoint rollback.** Delete the
`await transaction.RollbackToSavepointAsync("invitation", cancellationToken);` line (and its `if`)
from the catch, and force the write to fail by temporarily changing
`CustomerInvitation.Issue(tenancy.CustomerId, …)` to `CustomerInvitation.Issue(Guid.NewGuid(), …)`
— a customer id no `customer.customer` row has, which the foreign key refuses with 23503.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~An_admin_invites_an_address_and_gets_202_with_no_body" 2>&1 | tail -20
```

Expected: **FAIL** — `response.StatusCode.ShouldBe(HttpStatusCode.Accepted)` reporting
`InternalServerError`. The insert was refused, the catch swallowed it, and
`CustomerSessionMiddleware`'s `CommitAsync` then threw
`Npgsql.PostgresException : 25P02: current transaction is aborted, commands ignored until end of transaction block`
— the 500 the swallow exists to prevent, arriving one layer up. That is the whole reason the
savepoint is there.

Restore **both** the rollback line and `tenancy.CustomerId`, then prove the restore:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform diff -- \
  src/Hosts/PeakPower.Api.Customer/Portal/InvitationEndpoints.cs
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~InvitationEndpointTests" 2>&1 | tail -10
```

Expected: the diff shows the file as newly added, containing both
`CreateSavepointAsync("invitation"` and `RollbackToSavepointAsync("invitation"` and
`tenancy.CustomerId`; PASS, all sixteen cases.

- [ ] **Step 11: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform add \
  src/Core/PeakPower.Contracts/Customer/Portal/MembershipContracts.cs \
  src/Hosts/PeakPower.Api.Customer/Portal/InvitationEndpoints.cs \
  src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs \
  src/Hosts/PeakPower.Api.Customer/Onboarding/CustomerPortalLinks.cs \
  src/Hosts/PeakPower.Api.Customer/OpenApi/EnumWireValuesSchemaTransformer.cs \
  src/Hosts/PeakPower.Api.Customer/Program.cs \
  tests/PeakPower.Integration.Tests/Portal/MembershipFixture.cs \
  tests/PeakPower.Integration.Tests/Portal/InvitationEndpointTests.cs
git -C /Users/thinhhuynh/PeakPower/peakpower-platform commit -m "feat(api): POST /company/invitations answers 202 whether or not it does anything

The throttle counts every request outside the branch, and the branch that writes swallows
its own failures - a 500 reachable from one arm only is itself the oracle. The handler is
built so that it CANNOT learn whether the address has a login elsewhere: after plan 1 the
query filter on CustomerAccount restricts the lookup to active members of the business in
the token, so the only fact it reads is one the caller can already see on the member list.
That is also why one message is composed for both cases rather than two.

A savepoint wraps the write. This endpoint is authenticated, so CustomerSessionMiddleware
has already opened the transaction and commits it after the handler returns; a swallowed
DbUpdateException would leave PostgreSQL in 25P02 and the middleware's own commit would
throw, putting the 500 back one layer up.

Verified by mutation: moving the throttle inside the branch drops the colleague arm's count
to zero, and dropping the savepoint rollback turns a refused insert into a 500 out of
CommitAsync.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `POST /api/v1/company/invitations/accept` — anonymous, on the owner connection, both branches

Design §6.1: *"**Both accepts run in the auth realm, on the owner connection — and this is the one
place that is correct.** ⚠ r3 said only the unknown-address accept was anonymous, which left the
*known*-address accept with no writable path at all… The accept is authorised by **the invitation
token**, not by tenancy… Both accepts go on the anonymous-endpoint allow-list deliberately."*

The two reasons the known-address accept cannot run authenticated are set out in Global Constraints
and both are fatal: `app.customer_id` names the invitee's *current* business, so the `WITH CHECK`'s
tenancy term is false; and `is_admin_of(invitee, target)` is false because the row being inserted is
the thing that would make it true. Two false terms, one `42501`.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Portal/InvitationEndpoints.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/InvitationAcceptTests.cs` (create)

**Interfaces:**
- Consumes:
  - `CustomerInvitation.IsUsable(DateTimeOffset)`, `.MarkAccepted(DateTimeOffset)`, `.Email`,
    `.Role`, `.CustomerId` (Task 2)
  - `CompanyInvitationAcceptance(string Token, string? FirstName, string? LastName, string? Password)`
    and `CompanyInvitationAcceptedResponse(Guid CustomerId, string TradeName, string MembershipRole)`
    (Task 4)
  - `CustomerMembership.Create(Guid accountId, Guid customerId, MembershipRole role, DateTimeOffset at)`
    → **`Result<CustomerMembership>`** (contract §7, §13.2 — callers write `.Value`)
    and `.Restore(DateTimeOffset at)` (plan 1)
  - `CustomerAccount.Create(string username, string firstName, string lastName, string? jobTitle, string email, string? phone, AccountStatus status)`
    and `.SetPassword(string passwordHash)` (plan 1 — see Preflight item 4)
  - `IPasswordHasher.Hash(string)`, `PasswordPolicy.IsAcceptable(string?)`,
    `PasswordPolicy.MinimumLength`
  - `InvitationEndpoints.Audit(...)` and `.Payload(...)` (Task 4)
- Produces: the route `POST /api/v1/company/invitations/accept`, and
  `InvitationEndpoints.AcceptedAction` (`"MEMBERSHIP_ACCEPTED"`).

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/InvitationAcceptTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Identity;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

/// <summary>
/// <c>POST /api/v1/company/invitations/accept</c> — anonymous, on the owner connection, and the
/// one place in this design where moving a write off row-level security is correct.
/// </summary>
/// <remarks>
/// A known-address accept CANNOT run authenticated, and this file's
/// <see cref="An_existing_login_joins_a_second_business"/> is the case that proves why it had to
/// be built this way: the invitee is signed in nowhere at all when they click the link, and even
/// if they were, <c>app.customer_id</c> would name their CURRENT business — so migration 15's
/// <c>WITH CHECK</c> would fail on the tenancy term, and <c>is_admin_of</c> would fail on the
/// admin term because the row being inserted is the thing that would make it true.
/// </remarks>
public sealed class InvitationAcceptTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Invitations = "/api/v1/company/invitations";
    private const string Accept = "/api/v1/company/invitations/accept";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private MembershipFixture Seed => new(factory);

    /// <summary>
    /// Issues a real invitation through the real endpoint and returns the plaintext token off the
    /// message. Nothing here reaches into the database for it: the token is not stored, and a
    /// helper that minted its own would be testing a code path production never runs.
    /// </summary>
    private async Task<string> InviteAsync(
        MembershipFixture.Business business, string address, string role)
    {
        var client = await Seed.SignInAsync(business.Members[0]);
        var before = factory.Emails.Sent.Count;

        var response = await client.PostAsJsonAsync(
            Invitations, new CompanyInvitationRequest(address, role), Ct);
        response.StatusCode.ShouldBe(HttpStatusCode.Accepted);

        for (var attempt = 0; attempt < 20; attempt++)
        {
            var match = factory.Emails.Sent.Skip(before).FirstOrDefault(
                message => string.Equals(message.To, address, StringComparison.OrdinalIgnoreCase));
            if (match.To is not null)
            {
                return match.Body
                    .Split("?token=", StringSplitOptions.None)[1]
                    .Split('\n', StringSplitOptions.None)[0]
                    .Trim();
            }

            await Task.Delay(50, Ct);
        }

        throw new Xunit.Sdk.XunitException($"no invitation reached {address}");
    }

    // ------------------------------------------------------------------ the unknown address

    [Fact]
    public async Task An_address_with_no_login_is_told_which_three_fields_it_must_supply()
    {
        var business = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var token = await InviteAsync(business, $"{Guid.NewGuid():N}@example.nl", "trader");

        using var anonymous = factory.CreateAnonymousClient();
        var response = await anonymous.PostAsJsonAsync(
            Accept, new CompanyInvitationAcceptance(token, null, null, null), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var body = await response.Content.ReadAsStringAsync(Ct);
        body.ShouldContain("firstName", Case.Sensitive);
        body.ShouldContain("lastName", Case.Sensitive);
        body.ShouldContain("password", Case.Sensitive);

        // ⚠ And it spent NOTHING. A refusal that consumed the invitation would make the two-step
        // flow the portal actually uses - post, learn what is needed, post again - a flow that can
        // only ever be walked once.
        await using var db = factory.CreateOwnerDbContext();
        var invitation = await db.CustomerInvitations
            .SingleAsync(i => i.CustomerId == business.CustomerId, Ct);
        invitation.AcceptedAt.ShouldBeNull();
    }

    [Fact]
    public async Task A_short_password_is_refused_by_the_same_rule_the_reset_flow_uses()
    {
        var business = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var token = await InviteAsync(business, $"{Guid.NewGuid():N}@example.nl", "trader");

        using var anonymous = factory.CreateAnonymousClient();
        var response = await anonymous.PostAsJsonAsync(
            Accept, new CompanyInvitationAcceptance(token, "Jaap", "de Wit", "short"), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync(Ct)).ShouldContain("password", Case.Sensitive);
    }

    [Fact]
    public async Task An_address_with_no_login_gets_an_account_a_membership_and_can_sign_in()
    {
        var business = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var address = $"{Guid.NewGuid():N}@example.nl";
        var token = await InviteAsync(business, address, "trader");

        using var anonymous = factory.CreateAnonymousClient();
        var response = await anonymous.PostAsJsonAsync(
            Accept,
            new CompanyInvitationAcceptance(token, "Jaap", "de Wit", MembershipFixture.Password),
            Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var accepted = await response.Content
            .ReadFromJsonAsync<CompanyInvitationAcceptedResponse>(Ct);
        accepted!.CustomerId.ShouldBe(business.CustomerId);
        accepted.TradeName.ShouldBe(business.TradeName);
        accepted.MembershipRole.ShouldBe("trader");

        await using var db = factory.CreateOwnerDbContext();

        var account = await db.CustomerAccounts.SingleAsync(a => a.Email == address, Ct);
        account.FirstName.ShouldBe("Jaap");
        account.LastName.ShouldBe("de Wit");
        // The username IS the email address in this build (SignInRequest's own doc comment).
        account.Username.ShouldBe(address);
        // ACTIVE, not INVITED. [F13-R22]'s INVITED -> ACTIVE transition is carried by
        // customer_invitation.accepted_at moving from null to a timestamp: the invitation row IS
        // the invited state, and the account never exists in a half-made form with no credential.
        account.Status.ShouldBe(AccountStatus.Active);
        account.PasswordHash.ShouldNotBeNull();

        var membership = await db.CustomerMemberships.SingleAsync(
            m => m.AccountId == account.Id && m.CustomerId == business.CustomerId, Ct);
        membership.Role.ShouldBe(MembershipRole.Trader);
        membership.RemovedAt.ShouldBeNull();

        // And it works: the whole point of setting the password in the same call is that no second
        // credential email is needed.
        using var fresh = factory.CreateAnonymousClient();
        var signIn = await fresh.PostAsJsonAsync(
            "/api/v1/auth/sign-in",
            new SignInRequest(address, MembershipFixture.Password), Ct);
        signIn.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    // ------------------------------------------------------------------ the known address

    /// <summary>
    /// The case r3's design left with no writable path at all. The invitee already has a login at
    /// business A and is invited into business B; <c>{ token }</c> alone is the whole request.
    /// </summary>
    [Fact]
    public async Task An_existing_login_joins_a_second_business()
    {
        var a = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var b = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var joiner = a.Members[0];

        var token = await InviteAsync(b, joiner.Email, "viewer");

        using var anonymous = factory.CreateAnonymousClient();
        var response = await anonymous.PostAsJsonAsync(
            Accept, new CompanyInvitationAcceptance(token, null, null, null), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        var accepted = await response.Content
            .ReadFromJsonAsync<CompanyInvitationAcceptedResponse>(Ct);
        accepted!.CustomerId.ShouldBe(b.CustomerId);
        accepted.MembershipRole.ShouldBe("viewer");

        await using var db = factory.CreateOwnerDbContext();

        // No second account. One login, several businesses - the whole goal of the design.
        (await db.CustomerAccounts.CountAsync(x => x.Email == joiner.Email, Ct)).ShouldBe(1);

        var memberships = await db.CustomerMemberships
            .Where(m => m.AccountId == joiner.AccountId)
            .OrderBy(m => m.CustomerId)
            .ToListAsync(Ct);

        memberships.Count.ShouldBe(2);
        memberships.Single(m => m.CustomerId == a.CustomerId).Role.ShouldBe(MembershipRole.Admin);
        memberships.Single(m => m.CustomerId == b.CustomerId).Role.ShouldBe(MembershipRole.Viewer);
    }

    /// <summary>
    /// Re-inviting somebody who was removed CLEARS removed_at rather than inserting a duplicate,
    /// which the composite primary key would refuse anyway (design §3.1). The original created_at
    /// survives, so the member list still says since when they have been one of us.
    /// </summary>
    [Fact]
    public async Task Accepting_after_a_removal_restores_the_original_membership_row()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);
        var removed = business.Members[1];

        DateTimeOffset createdAt;
        await using (var arrange = factory.CreateOwnerDbContext())
        {
            var membership = await arrange.CustomerMemberships.SingleAsync(
                m => m.AccountId == removed.AccountId && m.CustomerId == business.CustomerId, Ct);
            createdAt = membership.CreatedAt;
            membership.Remove(DateTimeOffset.UtcNow);
            await arrange.SaveChangesAsync(Ct);
        }

        var token = await InviteAsync(business, removed.Email, "admin");

        using var anonymous = factory.CreateAnonymousClient();
        var response = await anonymous.PostAsJsonAsync(
            Accept, new CompanyInvitationAcceptance(token, null, null, null), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        await using var db = factory.CreateOwnerDbContext();
        var restored = await db.CustomerMemberships.SingleAsync(
            m => m.AccountId == removed.AccountId && m.CustomerId == business.CustomerId, Ct);

        restored.RemovedAt.ShouldBeNull();
        restored.Role.ShouldBe(MembershipRole.Admin, "the new invitation's role wins");
        restored.CreatedAt.ShouldBe(createdAt, "Restore clears removed_at; it does not re-date");
    }

    // ------------------------------------------------------------------ refusals

    /// <summary>
    /// One body for unknown, spent and expired alike. Telling them apart would make this endpoint
    /// an oracle for grinding tokens - and there is nothing to gain from telling them apart, since
    /// every one of the three means "ask for a new invitation".
    /// </summary>
    [Fact]
    public async Task An_unknown_a_spent_and_an_expired_token_get_the_same_409_body()
    {
        var business = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);

        using var anonymous = factory.CreateAnonymousClient();

        var unknownBody = await BodyOf(await anonymous.PostAsJsonAsync(
            Accept, new CompanyInvitationAcceptance(OpaqueToken.Create(), null, null, null), Ct),
            HttpStatusCode.Conflict);

        // Spent: accept once, then again.
        var spentAddress = $"{Guid.NewGuid():N}@example.nl";
        var spentToken = await InviteAsync(business, spentAddress, "trader");
        (await anonymous.PostAsJsonAsync(
            Accept,
            new CompanyInvitationAcceptance(
                spentToken, "Ada", "Lovelace", MembershipFixture.Password), Ct))
            .StatusCode.ShouldBe(HttpStatusCode.OK);
        var spentBody = await BodyOf(await anonymous.PostAsJsonAsync(
            Accept, new CompanyInvitationAcceptance(spentToken, null, null, null), Ct),
            HttpStatusCode.Conflict);

        // Expired: push the row's expiry into the past on the owner connection.
        var expiredAddress = $"{Guid.NewGuid():N}@example.nl";
        var expiredToken = await InviteAsync(business, expiredAddress, "trader");
        await using (var arrange = factory.CreateOwnerDbContext())
        {
            await arrange.Database.ExecuteSqlAsync(
                $"""
                 UPDATE customer.customer_invitation
                 SET issued_at = now() - interval '20 days', expires_at = now() - interval '6 days'
                 WHERE token_hash = {OpaqueToken.HashOf(expiredToken)}
                 """, Ct);
        }
        var expiredBody = await BodyOf(await anonymous.PostAsJsonAsync(
            Accept, new CompanyInvitationAcceptance(expiredToken, null, null, null), Ct),
            HttpStatusCode.Conflict);

        // Byte-identical, all three. Compared ordinally: Shouldly's ShouldBe on strings is
        // ordinal, but ShouldContain is not - and it is ShouldContain that has silently broken
        // three tests in this repository.
        spentBody.ShouldBe(unknownBody);
        expiredBody.ShouldBe(unknownBody);
    }

    [Fact]
    public async Task The_accept_needs_no_token_of_its_own_and_answers_an_anonymous_caller()
    {
        var business = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var address = $"{Guid.NewGuid():N}@example.nl";
        var token = await InviteAsync(business, address, "viewer");

        using var anonymous = factory.CreateAnonymousClient();
        anonymous.DefaultRequestHeaders.Authorization.ShouldBeNull();

        var response = await anonymous.PostAsJsonAsync(
            Accept,
            new CompanyInvitationAcceptance(token, "Grace", "Hopper", MembershipFixture.Password),
            Ct);

        // Not 401. The host denies by default (Program.cs's FallbackPolicy), so this route
        // answering at all is the proof that .AnonymousEndpoint(reason) applied AllowAnonymous -
        // and AnonymousEndpointAllowListTests is what keeps that a reviewed decision.
        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Accepting_writes_an_audit_record_naming_the_accepting_account()
    {
        var business = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var address = $"{Guid.NewGuid():N}@example.nl";
        var token = await InviteAsync(business, address, "trader");

        using var anonymous = factory.CreateAnonymousClient();
        await anonymous.PostAsJsonAsync(
            Accept,
            new CompanyInvitationAcceptance(token, "Jaap", "de Wit", MembershipFixture.Password),
            Ct);

        await using var db = factory.CreateOwnerDbContext();
        var account = await db.CustomerAccounts.SingleAsync(a => a.Email == address, Ct);
        var record = await db.AuditRecords.SingleAsync(
            r => r.CustomerId == business.CustomerId && r.Action == "MEMBERSHIP_ACCEPTED", Ct);

        record.Actor.ShouldBe($"account:{account.Id}");
        record.EntityId.ShouldBe(account.Id);
        record.EntityType.ShouldBe("CustomerMembership");
        record.After!.ShouldContain("trader", Case.Sensitive);
    }

    private static async Task<string> BodyOf(
        HttpResponseMessage response, HttpStatusCode expected)
    {
        response.StatusCode.ShouldBe(expected);
        return await response.Content.ReadAsStringAsync(Ct);
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~InvitationAcceptTests" 2>&1 | tail -30
```

Expected: **FAIL**, every case, with `response.StatusCode.ShouldBe(...)` reporting `Unauthorized`.
The route is not mapped, no endpoint matches, and the host's `FallbackPolicy` answers 401 rather
than 404 for a route it does not have — `ApiShellTests` pins that behaviour, so a 401 here is the
correct "this route does not exist yet" failure and a 404 would mean something else.

- [ ] **Step 3: Write the accept**

Add to
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Portal/InvitationEndpoints.cs`:
the constant beside `InvitedAction`,

```csharp
    internal const string AcceptedAction = "MEMBERSHIP_ACCEPTED";
```

the registration inside `MapInvitationEndpoints`, after the POST:

```csharp
        routes.MapPost(Accept, AcceptAsync)
            .WithTags("Company")
            .AllowAnonymous()
            .WithName("AcceptCompanyInvitation")
            .WithSummary("Redeem an invitation and join the company that sent it.")
            .Produces<CompanyInvitationAcceptedResponse>()
            // The three profile fields an address with no login must supply, and a password the
            // policy refuses. HttpValidationProblemDetails, with the errors filed per field, so
            // the portal can reveal exactly the controls that are missing rather than guessing.
            .ProducesValidationProblem()
            // InvitationCannotBeUsed() - ONE body for unknown, spent and expired alike. 409 rather
            // than 400 because the request is well formed and the state of the world is what
            // refuses it (the reading EntitlementEndpoints already uses for a coming-soon code),
            // and because this endpoint's 400 is taken by the validation shape above: two
            // different bodies on one status is what CustomerResponseMetadataTests exists to stop.
            .ProducesProblem(StatusCodes.Status409Conflict)
            .AnonymousEndpoint("the invitation token is the credential, and the invitee may hold no account at all");
```

and the handler:

```csharp
    /// <summary>
    /// Redeem an invitation: join the business that sent it, creating a login first if this
    /// address has none.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Anonymous, so this runs on the OWNER connection with no tenant configured</b> (convention
    /// C3): <c>CustomerSessionMiddleware</c> returns early for an unauthenticated request, so there
    /// is no <c>SET LOCAL ROLE</c>, no <c>app.customer_id</c>, no ambient transaction and no
    /// row-level security. That is not a bypass of this design's rules — it is the one place the
    /// design says is correct, and both halves of the argument are worth having here:
    /// </para>
    /// <para>
    /// A KNOWN-address accept run authenticated fails migration 15's <c>WITH CHECK</c> on BOTH
    /// terms. <c>app.customer_id</c> is the invitee's CURRENT business, not the inviting one, so
    /// the tenancy term is false; and <c>customer.is_admin_of(invitee, target)</c> is false because
    /// the row being inserted is the very thing that would make it true. There is no authenticated
    /// path, not a slower one.
    /// </para>
    /// <para>
    /// An UNKNOWN-address accept has nothing to authenticate with at all: the account does not
    /// exist until this handler creates it.
    /// </para>
    /// <para>
    /// This is not the mistake design §4.7 records against r2. r2 moved TENANT-SCOPED ADMIN VERBS
    /// off row-level security, leaving a handler's own <c>WHERE</c> clause as the only thing
    /// deciding whose rows it touched. This is an auth-realm operation that was never tenant
    /// scoped, and the invitation token — 256 bits, single use, fourteen days, found only by its
    /// digest — is the whole authorisation, exactly as the refresh cookie and the reset code are
    /// for the three anonymous endpoints that already exist.
    /// </para>
    /// <para>
    /// <b>One <c>SaveChangesAsync</c>, so one implicit transaction.</b> The account, the
    /// membership, the spent invitation and the audit row land together or not at all. There is no
    /// ambient transaction to join here — see above — so this is the only thing making the write
    /// atomic, and a partial commit would be an account with no membership, or a membership
    /// against an invitation that is still usable.
    /// </para>
    /// </remarks>
    private static async Task<IResult> AcceptAsync(
        CompanyInvitationAcceptance request,
        PeakPowerDbContext db,
        IPasswordHasher hasher,
        IMarketCalendar calendar,
        CancellationToken cancellationToken)
    {
        var now = calendar.UtcNow;
        var hash = OpaqueToken.HashOf(request.Token ?? string.Empty);

        // Found by digest and never by the plaintext, which is not stored anywhere. The global
        // query filter on CustomerInvitation reads `!IsAuthenticated || …`, and this request is
        // anonymous by definition, so the filter collapses to `true` and the lookup sees every
        // business's invitations - which is exactly what it must do, because the caller's business
        // is not known until this row is found.
        var invitation = await db.CustomerInvitations
            .SingleOrDefaultAsync(row => row.TokenHash == hash, cancellationToken);

        // IsUsable covers both arms - already accepted, and past its fourteen days.
        if (invitation is null || !invitation.IsUsable(now))
        {
            return InvitationCannotBeUsed();
        }

        var customer = await db.Customers
            .SingleOrDefaultAsync(row => row.Id == invitation.CustomerId, cancellationToken);

        if (customer is null)
        {
            // Unreachable through the foreign key, and answered with the same body rather than a
            // 500: a caller holding a valid token learns nothing useful from "the business is
            // gone", and a distinguishable answer here would be one more bit of an oracle.
            return InvitationCannotBeUsed();
        }

        var account = await db.CustomerAccounts.SingleOrDefaultAsync(
            row => row.Email == invitation.Email && row.Status != AccountStatus.Deactivated,
            cancellationToken);

        if (account is null)
        {
            // ---------------------------------------------------------------------------------
            // The address has no login. Shared contract §8 writes this body as `{ token }`, which
            // cannot get here: CustomerAccount.Create refuses a blank first or last name, and an
            // account with no PasswordHash can never sign in. This plan's deviation D1 adds the
            // three fields, required only on this arm, and answers 400 with all three named rather
            // than inventing a preflight route that would tell anyone which addresses have logins.
            //
            // Nothing is written on this path, so the invitation stays usable and the portal's
            // two-step flow - post, learn what is needed, post again - works.
            // ---------------------------------------------------------------------------------
            var missing = new Dictionary<string, string[]>(StringComparer.Ordinal);

            if (string.IsNullOrWhiteSpace(request.FirstName))
            {
                missing["firstName"] = ["Enter your first name."];
            }

            if (string.IsNullOrWhiteSpace(request.LastName))
            {
                missing["lastName"] = ["Enter your last name."];
            }

            if (!PasswordPolicy.IsAcceptable(request.Password))
            {
                missing["password"] =
                    [$"Choose a password of at least {PasswordPolicy.MinimumLength} characters."];
            }

            if (missing.Count > 0)
            {
                return TypedResults.ValidationProblem(
                    missing, title: ApiResults.ValidationTitle, type: ApiResults.ValidationType);
            }

            var created = CustomerAccount.Create(
                // The username IS the email address in this build - SignInRequest's own doc
                // comment - and the invitation's copy is already trimmed and lowercased.
                username: invitation.Email,
                firstName: request.FirstName!,
                lastName: request.LastName!,
                jobTitle: null,
                email: invitation.Email,
                phone: null,
                // ACTIVE, not INVITED. [F13-R22]'s INVITED -> ACTIVE transition is carried by
                // customer_invitation.accepted_at moving from null to a timestamp: the invitation
                // row IS the invited state. Creating the account INVITED and immediately
                // activating it would need a mutator CustomerAccount does not have, and would
                // leave a window in which an account exists with a password and cannot sign in.
                status: AccountStatus.Active);

            if (!created.IsSuccess)
            {
                // Reachable only for a name the domain refuses that the checks above admitted -
                // whitespace-only is caught there, so this is belt and braces. Filed under
                // firstName because that is the first field Create validates.
                return ApiResults.InvalidRequest("firstName", created.Error);
            }

            account = created.Value;
            account.SetPassword(hasher.Hash(request.Password!));
            db.CustomerAccounts.Add(account);
        }

        // Re-inviting a removed person CLEARS removed_at rather than inserting a duplicate, which
        // the composite primary key (account_id, customer_id) would refuse anyway - design §3.1.
        // Restore does not re-date created_at, so the member list still answers "since when have
        // they been one of us" with the original date.
        var membership = await db.CustomerMemberships.SingleOrDefaultAsync(
            row => row.AccountId == account.Id && row.CustomerId == invitation.CustomerId,
            cancellationToken);

        if (membership is null)
        {
            db.CustomerMemberships.Add(
                CustomerMembership.Create(account.Id, invitation.CustomerId, invitation.Role, now).Value);
        }
        else
        {
            membership.Restore(now);
            membership.ChangeRole(invitation.Role);
        }

        invitation.MarkAccepted(now);

        Audit(db, now, $"account:{account.Id}", AcceptedAction, invitation.CustomerId,
              before: null,
              after: Payload(invitation.Email, MembershipRoleWire.Of(invitation.Role)));

        // One SaveChangesAsync, so one implicit transaction: the account, the membership, the
        // spent invitation and the audit row land together or not at all. This handler runs
        // anonymously, so there is no ambient transaction from CustomerSessionMiddleware to join -
        // this is the only thing making the write atomic.
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Two accepts for the same brand-new address at the same instant. The unique index on
            // customer_account.username decides it, and the loser is told to look again rather
            // than handed a 500 out of a constraint nobody asked about. Deliberately the SAME body
            // as an unusable invitation: a distinguishable answer here would tell a caller that
            // the address was taken in the last few milliseconds.
            return InvitationCannotBeUsed();
        }

        return Results.Ok(new CompanyInvitationAcceptedResponse(
            customer.Id,
            customer.TradeName ?? customer.LegalName,
            MembershipRoleWire.Of(invitation.Role)));
    }

    /// <summary>
    /// One answer for every unusable invitation — unknown, already accepted, or expired — and for
    /// the concurrent-signup race. Telling them apart would let somebody grinding tokens learn
    /// which guesses were once real.
    /// </summary>
    private static IResult InvitationCannotBeUsed() =>
        ApiResults.Conflict(
            "That invitation cannot be used. It has already been accepted or it has expired. "
            + "Ask for a new one.");
```

Add these usings to the file: `using PeakPower.Contracts.Customer.Auth;` (for `PasswordPolicy`).

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~InvitationAcceptTests" 2>&1 | tail -30
```

Expected: build clean; PASS, all eight.

- [ ] **Step 5: Mutate the accept onto the tenant connection, which is what r3 would have shipped**

This is the mutation that matters most in the whole plan, and it needs no code change to the
handler: change `.AllowAnonymous()` and `.AnonymousEndpoint(...)` on the accept route to
`.RequireAuthorization()` and `.TenantScoped("customer")`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~InvitationAcceptTests" 2>&1 | tail -30
```

Expected: **FAIL**, every case, with `response.StatusCode.ShouldBe(HttpStatusCode.OK)` reporting
`Unauthorized`. Every accept in this file is made by `factory.CreateAnonymousClient()`, because an
invitee holds no session — which is precisely the point:
`The_accept_needs_no_token_of_its_own_and_answers_an_anonymous_caller` names it.

Now make the second half of the argument visible. Restore `.AllowAnonymous()`, and instead move the
**write** onto the tenant connection by hand, to show the `WITH CHECK` refusing it. Add this
temporary test to the file:

```csharp
    [Fact]
    public async Task TEMPORARY_the_tenant_connection_refuses_the_known_address_accept()
    {
        var a = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var b = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var joiner = a.Members[0];

        await using var connection = new Npgsql.NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync(Ct);

        await using var transaction = await connection.BeginTransactionAsync(Ct);
        await using (var setup = new Npgsql.NpgsqlBatch(connection, transaction))
        {
            setup.BatchCommands.Add(new Npgsql.NpgsqlBatchCommand("SET LOCAL ROLE app_customer_role"));
            setup.BatchCommands.Add(new Npgsql.NpgsqlBatchCommand(
                $"SELECT set_config('app.account_id', '{joiner.AccountId}', true)"));
            setup.BatchCommands.Add(new Npgsql.NpgsqlBatchCommand(
                $"SELECT set_config('app.customer_id', '{a.CustomerId}', true)"));
            await setup.ExecuteNonQueryAsync(Ct);
        }

        await using var insert = new Npgsql.NpgsqlCommand(
            $"""
             INSERT INTO customer.customer_membership (account_id, customer_id, role, created_at)
             VALUES ('{joiner.AccountId}', '{b.CustomerId}', 'viewer', now())
             """,
            connection, transaction);

        var thrown = await Should.ThrowAsync<Npgsql.PostgresException>(
            async () => await insert.ExecuteNonQueryAsync(Ct));

        thrown.SqlState.ShouldBe(
            Npgsql.PostgresErrorCodes.InsufficientPrivilege,
            "42501 - new row violates row-level security policy. app.customer_id names the "
            + "invitee's CURRENT business, so the WITH CHECK's tenancy term is false; and "
            + "is_admin_of is false because the row being inserted is the thing that would make "
            + "it true. Two false terms, and no authenticated path to fix either. This is why "
            + "the accept is anonymous on the owner connection.");
    }
```

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~TEMPORARY_the_tenant_connection_refuses" 2>&1 | tail -20
```

Expected: **PASS** — the exception is thrown and its `SqlState` is `42501`. That is the design's
claim, demonstrated rather than argued. **Keep this test**, renaming it
`The_tenant_connection_refuses_the_known_address_accept_which_is_why_it_is_anonymous` and dropping
the `TEMPORARY_` prefix: it is the executable form of the paragraph that decides this endpoint's
whole posture, and without it the anonymity looks like a shortcut.

Then confirm the restore:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -n 'AllowAnonymous\|AnonymousEndpoint\|RequireAuthorization' \
  src/Hosts/PeakPower.Api.Customer/Portal/InvitationEndpoints.cs > /tmp/t5-restore.txt 2>&1
cat /tmp/t5-restore.txt
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~InvitationAcceptTests" 2>&1 | tail -10
```

Expected: the accept route carries `.AllowAnonymous()` and `.AnonymousEndpoint(...)`; the POST
carries `.RequireAuthorization(CustomerAuthorizationPolicies.CompanyAdmin)`; PASS, all nine.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform add \
  src/Hosts/PeakPower.Api.Customer/Portal/InvitationEndpoints.cs \
  tests/PeakPower.Integration.Tests/Portal/InvitationAcceptTests.cs
git -C /Users/thinhhuynh/PeakPower/peakpower-platform commit -m "feat(api): accept an invitation anonymously, on the owner connection

Both accepts, and the known-address one is why. Run authenticated it fails migration 15's
WITH CHECK on BOTH terms: app.customer_id names the invitee's CURRENT business, and
is_admin_of is false because the row being inserted is the thing that would make it true.
The_tenant_connection_refuses_the_known_address_accept_which_is_why_it_is_anonymous
demonstrates that against a real database rather than arguing it, and asserts 42501.

The body is { token } plus three fields required only for an address with no login, because
CustomerAccount.Create refuses a blank name and an account with no password hash can never
sign in - recorded as this plan's one wire deviation. A refusal on that arm writes nothing
and leaves the invitation unspent, so the portal's post-learn-post flow works.

Unknown, spent, expired and the concurrent-signup race all answer one 409 body, compared
ordinally in the test rather than through Shouldly's case-insensitive ShouldContain.

Verified by mutation: putting RequireAuthorization on the route 401s every case, because an
invitee holds no session at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `GET /api/v1/company/memberships` — the explicit `AND customer_id = @active`

Design §4.2: *"⚠ **The permissive `OR` in `USING` does not scope a count.** The `account_id` arm
makes the caller's memberships in *other* businesses visible while acting for this one. Any
admin-surface query — the member list, and above all the floor count — **must carry an explicit
`AND customer_id = @active`**."*

`CustomerMembership` carries **no** global query filter (contract §9 item 3 gives it an argued
exemption, because the switcher must read across businesses), so on this table the explicit
predicate is not belt-and-braces: it is the only tenancy in the query.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Portal/MembershipEndpoints.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Program.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/MembershipEndpointTests.cs` (create)

**Interfaces:**
- Consumes: `CompanyMemberDto`, `CompanyInvitationDto`, `CompanyMembershipsResponse` (Task 4);
  `MembershipRoleWire.Of(MembershipRole)` (plan 1, contract §13.2.1); `PeakPowerDbContext.CustomerMemberships`
  (plan 1); `PeakPowerDbContext.CustomerInvitations` (Task 3); `ICustomerContext` (plan 1).
- Produces:
  - `MembershipEndpoints.MapMembershipEndpoints(this IEndpointRouteBuilder)`
  - `MembershipEndpoints.Memberships` (`"/api/v1/company/memberships"`)
  - `internal static Task<CompanyMembershipsResponse> MembershipEndpoints.ReadAsync(PeakPowerDbContext db, ICustomerContext tenancy, CancellationToken ct)`
    — Tasks 7 answers with it too, so the read and the write cannot disagree about what the screen
    shows
  - `PortalMappings.ToMemberDto(...)` and `PortalMappings.ToInvitationDto(CustomerInvitation)`

- [ ] **Step 1: Write the failing test**

Create `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/MembershipEndpointTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Customers;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

/// <summary>
/// The three membership routes. The floor's concurrency half is
/// <c>MembershipConcurrencyTests</c>, which needs two clients racing and its own reasoning.
/// </summary>
public sealed class MembershipEndpointTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Memberships = "/api/v1/company/memberships";
    private const string Invitations = "/api/v1/company/invitations";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private MembershipFixture Seed => new(factory);

    // ------------------------------------------------------------------ the read

    [Fact]
    public async Task The_list_is_this_businesss_active_members_by_surname()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader, MembershipRole.Viewer);
        var client = await Seed.SignInAsync(business.Members[0]);

        var body = await client.GetFromJsonAsync<CompanyMembershipsResponse>(Memberships, Ct);

        body.ShouldNotBeNull();
        body!.Members.Count.ShouldBe(3);
        body.Members.Select(member => member.MembershipRole)
            .ShouldBe(["admin", "trader", "viewer"]);
        // MembershipFixture names them "de Vries 0", "de Vries 1", "de Vries 2", so surname order
        // is seeding order and the assertion above is an ordered one rather than a set comparison.
        body.Members.Select(member => member.LastName)
            .ShouldBe(["de Vries 0", "de Vries 1", "de Vries 2"]);
        body.PendingInvitations.ShouldBeEmpty();
    }

    /// <summary>
    /// A removed colleague leaves the list and the row stays in the table. Removal is an UPDATE
    /// setting removed_at, never a DELETE (design §3.1), so "gone from the screen" and "gone from
    /// the database" are different facts and this asserts both.
    /// </summary>
    [Fact]
    public async Task A_removed_member_is_not_listed_and_the_row_survives()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);

        await using (var arrange = factory.CreateOwnerDbContext())
        {
            var membership = await arrange.CustomerMemberships.SingleAsync(
                m => m.AccountId == business.Members[1].AccountId
                  && m.CustomerId == business.CustomerId, Ct);
            membership.Remove(DateTimeOffset.UtcNow);
            await arrange.SaveChangesAsync(Ct);
        }

        var client = await Seed.SignInAsync(business.Members[0]);
        var body = await client.GetFromJsonAsync<CompanyMembershipsResponse>(Memberships, Ct);

        body!.Members.Count.ShouldBe(1);
        body.Members[0].AccountId.ShouldBe(business.Members[0].AccountId);

        await using var db = factory.CreateOwnerDbContext();
        (await db.CustomerMemberships.CountAsync(m => m.CustomerId == business.CustomerId, Ct))
            .ShouldBe(2, "removal is an UPDATE setting removed_at; the row is never deleted");
    }

    /// <summary>
    /// THE test the design's §4.2 warning is about. A person who is an admin here AND a member of
    /// another business is one row on this screen, not two — because the query carries
    /// `AND customer_id = @active` rather than trusting the tenant-isolation policy, whose
    /// permissive `account_id = app.account_id` arm makes the OTHER business's row readable to
    /// this very connection.
    /// </summary>
    [Fact]
    public async Task A_colleagues_memberships_in_other_businesses_never_appear()
    {
        var a = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var b = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);

        // The admin of A is also a viewer of B. Written on the owner connection: as
        // app_customer_role this insert would need to be an admin of B, which is the point.
        await using (var arrange = factory.CreateOwnerDbContext())
        {
            arrange.CustomerMemberships.Add(CustomerMembership.Create(
                a.Members[0].AccountId, b.CustomerId, MembershipRole.Viewer,
                DateTimeOffset.UtcNow).Value);
            await arrange.SaveChangesAsync(Ct);
        }

        var client = await Seed.SignInAsync(a.Members[0]);
        var body = await client.GetFromJsonAsync<CompanyMembershipsResponse>(Memberships, Ct);

        body!.Members.Count.ShouldBe(1);
        body.Members[0].MembershipRole.ShouldBe("admin");

        var raw = await (await client.GetAsync(Memberships, Ct)).Content.ReadAsStringAsync(Ct);
        raw.ShouldNotContain(
            b.CustomerId.ToString(),
            Case.Insensitive,
            "the other business's identifier must not appear anywhere in this payload");
    }

    [Fact]
    public async Task Outstanding_invitations_are_listed_and_accepted_ones_are_not()
    {
        var business = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var client = await Seed.SignInAsync(business.Members[0]);

        await client.PostAsJsonAsync(
            Invitations, new CompanyInvitationRequest("wachtend@example.nl", "viewer"), Ct);

        var body = await client.GetFromJsonAsync<CompanyMembershipsResponse>(Memberships, Ct);

        body!.PendingInvitations.Count.ShouldBe(1);
        body.PendingInvitations[0].Email.ShouldBe("wachtend@example.nl");
        body.PendingInvitations[0].MembershipRole.ShouldBe("viewer");
        (body.PendingInvitations[0].ExpiresAt - body.PendingInvitations[0].InvitedAt)
            .ShouldBe(TimeSpan.FromDays(14));

        await using (var arrange = factory.CreateOwnerDbContext())
        {
            var invitation = await arrange.CustomerInvitations.SingleAsync(
                i => i.CustomerId == business.CustomerId, Ct);
            invitation.MarkAccepted(DateTimeOffset.UtcNow);
            await arrange.SaveChangesAsync(Ct);
        }

        var after = await client.GetFromJsonAsync<CompanyMembershipsResponse>(Memberships, Ct);
        after!.PendingInvitations.ShouldBeEmpty();
    }

    /// <summary>
    /// No token and no digest on the wire. An admin could not use one, but publishing a
    /// credential-shaped value on a screen for no reason is how it ends up in a screenshot.
    /// </summary>
    [Fact]
    public async Task A_pending_invitation_carries_no_token_and_no_digest()
    {
        var business = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var client = await Seed.SignInAsync(business.Members[0]);

        await client.PostAsJsonAsync(
            Invitations, new CompanyInvitationRequest("wachtend@example.nl", "viewer"), Ct);

        var raw = await (await client.GetAsync(Memberships, Ct)).Content.ReadAsStringAsync(Ct);

        raw.ShouldNotContain("token", Case.Insensitive);
        raw.ShouldNotContain("hash", Case.Insensitive);

        await using var db = factory.CreateOwnerDbContext();
        var digest = await db.CustomerInvitations
            .Where(i => i.CustomerId == business.CustomerId)
            .Select(i => i.TokenHash)
            .SingleAsync(Ct);
        raw.ShouldNotContain(digest, Case.Insensitive);
    }

    [Fact]
    public async Task A_non_admin_cannot_read_the_member_list()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);
        var client = await Seed.SignInAsync(business.Members[1]);

        (await client.GetAsync(Memberships, Ct)).StatusCode
            .ShouldBe(HttpStatusCode.Forbidden);
    }

    /// <summary>
    /// The lowercase spelling, pinned from the consumer's side. There is deliberately no
    /// PortalMappings.Wire(MembershipRole) overload to pin - the spelling has one home,
    /// PeakPower.Domain.Customers.MembershipRoleWire (contract §13.2.1) - which is why the role
    /// never appears in
    /// CompanyEndpointTests.Every_wire_spelling_PortalMappings_produces_is_the_shared_converters_spelling,
    /// where EnumWireFormat would demand ADMIN and shared contract §3 asks for admin.
    /// Plan 1's MembershipRoleWireTests owns the type; this is the one assertion this plan keeps,
    /// because these five endpoints are what the lowercase spelling is FOR.
    /// </summary>
    [Fact]
    public void MembershipRoleWireValuesAreTheContractsLowercaseSpelling()
    {
        MembershipRoleWire.Values.ShouldBe(["admin", "trader", "viewer"]);

        foreach (var role in Enum.GetValues<MembershipRole>())
        {
            MembershipRoleWire.TryParse(MembershipRoleWire.Of(role), out var parsed).ShouldBeTrue();
            parsed.ShouldBe(role);
        }

        // A boundary check on a value a customer sends: everything else is a rejection, not a
        // guess - including the C# spelling and the SCREAMING_SNAKE one.
        MembershipRoleWire.TryParse("Admin", out _).ShouldBeFalse();
        MembershipRoleWire.TryParse("ADMIN", out _).ShouldBeFalse();
        MembershipRoleWire.TryParse("owner", out _).ShouldBeFalse();
        MembershipRoleWire.TryParse(null, out _).ShouldBeFalse();
    }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~MembershipEndpointTests" 2>&1 | tail -30
```

Expected: `MembershipRoleWireValuesAreTheContractsLowercaseSpelling` **passes** (plan 1 ships
`MembershipRoleWire` whole — `Values`, `Of` and `TryParse`; this plan adds nothing to it); every
other case **FAILS**. `The_list_is_this_businesss_active_members_by_surname` fails
inside `GetFromJsonAsync` with
`System.Text.Json.JsonException: 'U' is an invalid start of a value` — the route is unmapped, the
`FallbackPolicy` answers a 401 problem document, and `GetFromJsonAsync` tries to parse it as
`CompanyMembershipsResponse`. `A_non_admin_cannot_read_the_member_list` fails with
`Unauthorized should be Forbidden`.

- [ ] **Step 3: Add the two mappings**

To
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs`,
after `ToAccountDto`:

```csharp
    /// <summary>
    /// One colleague as the member-management screen shows them: the ACCOUNT's identity and the
    /// MEMBERSHIP's role, which are two rows and two lifetimes.
    /// </summary>
    /// <remarks>
    /// Takes both rather than a joined projection type, so the join stays in the query where the
    /// tenancy predicate is and cannot be quietly re-run per row. <paramref name="membership"/> is
    /// the one that decides the role; <c>[F01-R13]</c>'s "no permission field on an account" is
    /// reversed by design §1.1 in exactly this way - the account still has none.
    /// </remarks>
    public static CompanyMemberDto ToMemberDto(
        CustomerAccount account, CustomerMembership membership) =>
        new(account.Id,
            account.FirstName,
            account.LastName,
            account.JobTitle,
            account.Email,
            MembershipRoleWire.Of(membership.Role),
            Wire(account.Status),
            membership.CreatedAt,
            account.LastLoginAt);

    /// <summary>
    /// One outstanding invitation. Carries neither the token nor its digest, deliberately: the
    /// row's only secret never leaves the database.
    /// </summary>
    public static CompanyInvitationDto ToInvitationDto(CustomerInvitation invitation) =>
        new(invitation.Id,
            invitation.Email,
            MembershipRoleWire.Of(invitation.Role),
            invitation.IssuedAt,
            invitation.ExpiresAt);
```

- [ ] **Step 4: Write the endpoint**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Portal/MembershipEndpoints.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using PeakPower.Application.Abstractions;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Auditing;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Web.Http;
using PeakPower.Infrastructure.Web.Tenancy;
using PeakPower.Persistence;

namespace PeakPower.Api.Customer.Portal;

/// <summary>
/// Who acts for this business, and what they may do. The member-management screen, server-side.
/// </summary>
/// <remarks>
/// <para>
/// <b>Every query here carries an explicit <c>AND customer_id = @active</c>, and that is not
/// belt-and-braces.</b> <c>CustomerMembership</c> has no global query filter — the shared
/// contract's §9 item 3 gives it an argued exemption, because the business switcher must read
/// across businesses — so layer 1 supplies nothing on this table. And layer 2 supplies less than
/// it looks: migration 15's tenant-isolation policy is
/// <c>USING (account_id = app.account_id OR customer_id = app.customer_id)</c>, whose first arm
/// makes the CALLER's memberships in other businesses readable while acting for this one. Trusting
/// the policy to scope a count is exploitable exactly as design §4.2 sets out: an admin of a
/// four-eyes business who is also sole admin of a self-registered shell business could make the
/// floor count read two when the business has one.
/// </para>
/// <para>
/// Nothing here binds <c>HttpContext</c>; architecture fact 6 reserves it for
/// <c>PeakPower.Infrastructure.Web</c>.
/// </para>
/// </remarks>
public static class MembershipEndpoints
{
    internal const string Memberships = "/api/v1/company/memberships";
    private const string Membership = "/api/v1/company/memberships/{accountId:guid}";

    public static IEndpointRouteBuilder MapMembershipEndpoints(this IEndpointRouteBuilder routes)
    {
        // Mapped at the full path on `routes` rather than inside a group, for the reason
        // CompanyEndpoints and EntitlementEndpoints already record: RoutePatternFactory.Combine
        // appends unconditionally, so a group-relative MapGet("") registers ".../memberships/"
        // with a trailing slash - invisible to a test that calls the endpoint, visible in the
        // endpoint table CustomerApiRouteTableTests pins and in the OpenAPI document.
        routes.MapGet(Memberships, async (
                ICustomerContext tenancy,
                PeakPowerDbContext db,
                CancellationToken cancellationToken) =>
                Results.Ok(await ReadAsync(db, tenancy, cancellationToken)))
            .WithTags("Company")
            // Admin-only, unlike GET /api/v1/company/entitlements, and the difference is real
            // rather than incidental. The entitlement read is open to everybody because the
            // navigation rail is gated on its answer, so a colleague who could not read it would
            // get an empty rail. Nothing renders off this one except the management screen itself,
            // and design §12 item 3 treats a colleague's standing in other businesses as a
            // disclosure to avoid - so the narrower permission costs nothing and says more.
            .RequireAuthorization(CustomerAuthorizationPolicies.CompanyAdmin)
            .TenantScoped("customer-account")
            .WithName("GetCompanyMemberships")
            .WithSummary("Who acts for this company, and who has been invited. Admins only.")
            // One exit and no 404: a business always has at least one member (the floor), and an
            // empty pending list is an empty array rather than a missing resource.
            .Produces<CompanyMembershipsResponse>();

        return routes;
    }

    /// <summary>
    /// The member-management screen's whole state. One method, because the GET and the PATCH's
    /// response must not be able to disagree about what the screen shows — the same division
    /// <c>EntitlementEndpoints.HeldCodes</c> makes for exactly that reason.
    /// </summary>
    internal static async Task<CompanyMembershipsResponse> ReadAsync(
        PeakPowerDbContext db,
        ICustomerContext tenancy,
        CancellationToken cancellationToken)
    {
        // The join is written here rather than through a navigation, because CustomerMembership
        // carries no navigation to CustomerAccount (contract §7 declares it as a flat relationship
        // type, not an aggregate member) - and because this shape puts the tenancy predicate on
        // the membership side, where it belongs, instead of leaning on the account's query filter.
        //
        // The account's filter DOES also apply and narrows the right side to active members of
        // this business, so the two agree; that is a second layer, not the first one.
        var rows = await db.CustomerMemberships
            .AsNoTracking()
            .Where(membership =>
                membership.CustomerId == tenancy.CustomerId && membership.RemovedAt == null)
            .Join(
                db.CustomerAccounts.AsNoTracking(),
                membership => membership.AccountId,
                account => account.Id,
                (membership, account) => new { membership, account })
            .OrderBy(row => row.account.LastName)
            .ThenBy(row => row.account.FirstName)
            .ToListAsync(cancellationToken);

        var invitations = await db.CustomerInvitations
            .AsNoTracking()
            // The explicit predicate again, although CustomerInvitation DOES carry a query filter:
            // one tenancy rule written the same way on both reads of this method is cheaper to
            // review than two that happen to agree.
            .Where(invitation =>
                invitation.CustomerId == tenancy.CustomerId && invitation.AcceptedAt == null)
            .OrderBy(invitation => invitation.Email)
            .ToListAsync(cancellationToken);

        return new CompanyMembershipsResponse(
            [.. rows.Select(row => PortalMappings.ToMemberDto(row.account, row.membership))],
            [.. invitations.Select(PortalMappings.ToInvitationDto)]);
    }
}
```

⚠ An **expired but unaccepted** invitation still appears in `PendingInvitations`. That is
deliberate: it is the honest state of the world, the screen prints its expiry date, and filtering
it out would leave an admin wondering why re-inviting the same address says "already invited"
nowhere. Task 13's screen marks an expired one visibly.

- [ ] **Step 5: Map it**

In `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Program.cs`,
after `app.MapInvitationEndpoints();`:

```csharp
// The member-management screen [design §6.2]. All three verbs are admin-only, and the DELETE's SQL
// is an UPDATE setting removed_at - see MembershipEndpoints' own remarks.
app.MapMembershipEndpoints();
```

- [ ] **Step 6: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~MembershipEndpointTests" 2>&1 | tail -30
```

Expected: build clean; PASS, all seven.

- [ ] **Step 7: Mutate the explicit tenancy predicate — the one design §4.2 is about**

Delete `membership.CustomerId == tenancy.CustomerId &&` from `ReadAsync`'s first `Where`, leaving
`membership.RemovedAt == null`. Row-level security is still in force, so this is not "no tenancy" —
it is exactly the weaker tenancy the permissive `OR` provides.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~MembershipEndpointTests" 2>&1 | tail -40
```

Expected: **FAIL**, exactly one case —
`A_colleagues_memberships_in_other_businesses_never_appear`, on
`body!.Members.Count.ShouldBe(1)` reporting `2`, and then (if you fix that line alone) on
`raw.ShouldNotContain(b.CustomerId.ToString(), …)`. The admin's own membership in business B came
through the policy's `account_id = app.account_id` arm and was joined to their own account row,
which the account filter admits because they ARE a member of A.

⚠ **The other six cases still pass**, and that is the finding worth writing down: every one of them
seeds a business whose members belong to nothing else, so the whole file would be green over this
bug without that one test. Restore the predicate.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform add \
  src/Hosts/PeakPower.Api.Customer/Portal/MembershipEndpoints.cs \
  src/Hosts/PeakPower.Api.Customer/Portal/PortalMappings.cs \
  src/Hosts/PeakPower.Api.Customer/Program.cs \
  tests/PeakPower.Integration.Tests/Portal/MembershipEndpointTests.cs
git -C /Users/thinhhuynh/PeakPower/peakpower-platform commit -m "feat(api): GET /company/memberships, with the explicit tenancy predicate

CustomerMembership carries no global query filter - the switcher must read across
businesses, so the shared contract gives it an argued exemption - and migration 15's
tenant-isolation policy has a permissive account_id arm that makes the CALLER's memberships
in other businesses readable while acting for this one. So AND customer_id = @active is not
belt-and-braces here; it is the only tenancy in the query.

Verified by mutation: dropping that predicate puts a second row on the screen for an admin
who also belongs to another business, and only one of the seven tests in the file notices -
the other six seed members who belong to nothing else.

The response also carries outstanding invitations, so an admin can see that somebody has
already been asked. No token and no digest on the wire.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `PATCH /api/v1/company/memberships/{accountId:guid}` — the role change, and the floor on demotion

Design §6.2: *"`PATCH /api/v1/company/memberships/{accountId}` changes the role… Both are
`CompanyAdmin`, both audited as `[DEC-150]` established, both under RLS with the §4.2 `WITH CHECK`,
both carrying an explicit `AND customer_id = @active`. ⚠ `CompanyAdmin` proves *"admin of the
business in my token"*, never *"this accountId is in that business"* — the explicit predicate is
what proves the second."*

Design §6.4: *"⚠ **The floor is a check-then-act and must be serialized.**… The count therefore
takes `SELECT … FOR UPDATE` over the business's admin rows inside the same transaction as the
removal."* A **demotion** takes an admin away exactly as a removal does, so it takes the same lock.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Portal/MembershipEndpoints.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/MembershipEndpointTests.cs` (modify)

**Interfaces:**
- Consumes: `MembershipRoleChangeRequest(string MembershipRole)` (Task 4);
  `MembershipEndpoints.ReadAsync(db, tenancy, ct)` (Task 6);
  `MembershipRoleWire.TryParse(string?, out MembershipRole)`, `.Of(MembershipRole)` and `.Values`
  (plan 1, contract §13.2.1);
  `CustomerMembership.ChangeRole(MembershipRole)` (plan 1);
  `ApiResults.NotFound()`, `.Conflict(string)`, `.InvalidRequest(string, string)`.
- Produces:
  - the route `PATCH /api/v1/company/memberships/{accountId:guid}`
  - `internal static async Task<int> MembershipEndpoints.LockAdminsAsync(PeakPowerDbContext db, Guid customerId, CancellationToken ct)`
    — takes `SELECT … FOR UPDATE` over the business's active admin memberships and returns how many
    there are
  - `internal static async Task<int> MembershipEndpoints.AdminFloorAsync(PeakPowerDbContext db, Guid customerId, CancellationToken ct)`
    — 2 for a four-eyes business, 1 otherwise
  - `MembershipEndpoints.RoleChangedAction` (`"MEMBERSHIP_ROLE_CHANGED"`)

- [ ] **Step 1: Write the failing test**

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/MembershipEndpointTests.cs`:

```csharp
    // ------------------------------------------------------------------ the role change

    private static string MembershipUrl(Guid accountId) => $"{Memberships}/{accountId}";

    [Fact]
    public async Task An_admin_promotes_a_colleague_and_gets_the_whole_list_back()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Viewer);
        var client = await Seed.SignInAsync(business.Members[0]);

        var response = await client.PatchAsJsonAsync(
            MembershipUrl(business.Members[1].AccountId),
            new MembershipRoleChangeRequest("admin"), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        // The WHOLE list, not the one row that changed - the same choice
        // POST /company/entitlements makes, and for the same reason: patching client state is
        // where a screen and a server start disagreeing about what is true.
        var body = await response.Content.ReadFromJsonAsync<CompanyMembershipsResponse>(Ct);
        body!.Members.Count.ShouldBe(2);
        body.Members.Select(member => member.MembershipRole).ShouldBe(["admin", "admin"]);

        await using var db = factory.CreateOwnerDbContext();
        var membership = await db.CustomerMemberships.SingleAsync(
            m => m.AccountId == business.Members[1].AccountId
              && m.CustomerId == business.CustomerId, Ct);
        membership.Role.ShouldBe(MembershipRole.Admin);
    }

    /// <summary>
    /// Asking for the role somebody already has is a 200 with the unchanged list, not a 409. The
    /// screen's control is a select, and a select that errors when you re-pick the current value
    /// breaks on a double click - the same reasoning EntitlementEndpoints records for its switch.
    /// </summary>
    [Fact]
    public async Task Setting_the_role_somebody_already_has_changes_nothing_and_still_answers_200()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);
        var client = await Seed.SignInAsync(business.Members[0]);

        var response = await client.PatchAsJsonAsync(
            MembershipUrl(business.Members[1].AccountId),
            new MembershipRoleChangeRequest("trader"), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);

        await using var db = factory.CreateOwnerDbContext();
        (await db.AuditRecords.CountAsync(
            r => r.CustomerId == business.CustomerId && r.Action == "MEMBERSHIP_ROLE_CHANGED", Ct))
            .ShouldBe(0, "nothing changed, so nothing is audited");
    }

    /// <summary>
    /// CompanyAdmin proves "an admin of the business in my token" and never "this accountId is in
    /// that business". The explicit predicate is what proves the second, and 404 - never 403 - is
    /// the answer [F13-R19]: a 403 would confirm that the account exists somewhere.
    /// </summary>
    [Fact]
    public async Task An_account_in_another_business_is_a_404_and_never_a_403()
    {
        var a = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var b = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var client = await Seed.SignInAsync(a.Members[0]);

        var response = await client.PatchAsJsonAsync(
            MembershipUrl(b.Members[0].AccountId),
            new MembershipRoleChangeRequest("viewer"), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);

        // Byte-identical to the 404 for an id that never existed. ApiResults.NotFound writes a
        // constant body precisely so those two cannot be told apart.
        var invented = await client.PatchAsJsonAsync(
            MembershipUrl(Guid.CreateVersion7()),
            new MembershipRoleChangeRequest("viewer"), Ct);
        invented.StatusCode.ShouldBe(HttpStatusCode.NotFound);
        (await response.Content.ReadAsStringAsync(Ct))
            .ShouldBe(await invented.Content.ReadAsStringAsync(Ct));

        await using var db = factory.CreateOwnerDbContext();
        var untouched = await db.CustomerMemberships.SingleAsync(
            m => m.AccountId == b.Members[0].AccountId && m.CustomerId == b.CustomerId, Ct);
        untouched.Role.ShouldBe(MembershipRole.Admin);
    }

    [Fact]
    public async Task A_removed_member_cannot_be_re_roled_and_is_a_404()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);

        await using (var arrange = factory.CreateOwnerDbContext())
        {
            var membership = await arrange.CustomerMemberships.SingleAsync(
                m => m.AccountId == business.Members[1].AccountId
                  && m.CustomerId == business.CustomerId, Ct);
            membership.Remove(DateTimeOffset.UtcNow);
            await arrange.SaveChangesAsync(Ct);
        }

        var client = await Seed.SignInAsync(business.Members[0]);
        var response = await client.PatchAsJsonAsync(
            MembershipUrl(business.Members[1].AccountId),
            new MembershipRoleChangeRequest("admin"), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    // ------------------------------------------------------------------ the floor, sequentially

    /// <summary>
    /// One admin, not four-eyes: the floor is one, so demoting the only admin would leave a
    /// business that can never invite anybody, since every verb here is CompanyAdmin-gated.
    /// </summary>
    [Fact]
    public async Task Demoting_the_last_admin_of_an_ordinary_business_is_refused()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);
        var client = await Seed.SignInAsync(business.Members[0]);

        var response = await client.PatchAsJsonAsync(
            MembershipUrl(business.Members[0].AccountId),
            new MembershipRoleChangeRequest("trader"), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await response.Content.ReadAsStringAsync(Ct))
            .ShouldContain("administrator", Case.Insensitive);

        await using var db = factory.CreateOwnerDbContext();
        var membership = await db.CustomerMemberships.SingleAsync(
            m => m.AccountId == business.Members[0].AccountId
              && m.CustomerId == business.CustomerId, Ct);
        membership.Role.ShouldBe(MembershipRole.Admin);
    }

    /// <summary>
    /// TWO for a four-eyes business (design decision 7). A business that switched four-eyes on
    /// precisely to stop unilateral change must not be left with one person able to make it.
    /// </summary>
    [Fact]
    public async Task Demoting_the_second_admin_of_a_four_eyes_business_is_refused()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: true, MembershipRole.Admin, MembershipRole.Admin);
        var client = await Seed.SignInAsync(business.Members[0]);

        var response = await client.PatchAsJsonAsync(
            MembershipUrl(business.Members[1].AccountId),
            new MembershipRoleChangeRequest("trader"), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Demoting_the_third_admin_of_a_four_eyes_business_is_allowed()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: true, MembershipRole.Admin, MembershipRole.Admin, MembershipRole.Admin);
        var client = await Seed.SignInAsync(business.Members[0]);

        var response = await client.PatchAsJsonAsync(
            MembershipUrl(business.Members[2].AccountId),
            new MembershipRoleChangeRequest("viewer"), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.OK);
    }

    /// <summary>
    /// THE floor-count probe design §10 names, and r2 would have failed it. The admin of a
    /// four-eyes business is ALSO the sole admin of a shell business she self-registered. If the
    /// count leaned on row-level security instead of on customer_id = @active, the policy's
    /// permissive account_id arm would make her shell membership visible here and the count would
    /// read three where the business has two - and she could hold a four-eyes business alone.
    /// </summary>
    [Fact]
    public async Task An_admins_membership_in_a_shell_business_cannot_inflate_the_floor_count()
    {
        var fourEyes = await Seed.SeedBusinessAsync(
            fourEyes: true, MembershipRole.Admin, MembershipRole.Admin);
        var shell = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Trader);

        await using (var arrange = factory.CreateOwnerDbContext())
        {
            arrange.CustomerMemberships.Add(CustomerMembership.Create(
                fourEyes.Members[0].AccountId, shell.CustomerId, MembershipRole.Admin,
                DateTimeOffset.UtcNow).Value);
            await arrange.SaveChangesAsync(Ct);
        }

        var client = await Seed.SignInAsync(fourEyes.Members[0]);

        var response = await client.PatchAsJsonAsync(
            MembershipUrl(fourEyes.Members[1].AccountId),
            new MembershipRoleChangeRequest("trader"), Ct);

        response.StatusCode.ShouldBe(
            HttpStatusCode.Conflict,
            "the four-eyes business has TWO admins and the floor is two; the caller's third "
            + "admin membership belongs to another business and must not be counted");
    }

    [Theory]
    [InlineData("ADMIN")]
    [InlineData("owner")]
    [InlineData("")]
    public async Task An_unknown_role_is_a_400_naming_membershipRole_on_the_patch(string role)
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);
        var client = await Seed.SignInAsync(business.Members[0]);

        var response = await client.PatchAsJsonAsync(
            MembershipUrl(business.Members[1].AccountId),
            new MembershipRoleChangeRequest(role), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync(Ct))
            .ShouldContain("membershipRole", Case.Sensitive);
    }

    [Fact]
    public async Task A_role_change_writes_an_audit_record_with_both_sides()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Viewer);
        var client = await Seed.SignInAsync(business.Members[0]);

        await client.PatchAsJsonAsync(
            MembershipUrl(business.Members[1].AccountId),
            new MembershipRoleChangeRequest("trader"), Ct);

        await using var db = factory.CreateOwnerDbContext();
        var record = await db.AuditRecords.SingleAsync(
            r => r.CustomerId == business.CustomerId && r.Action == "MEMBERSHIP_ROLE_CHANGED", Ct);

        record.Actor.ShouldBe($"account:{business.Members[0].AccountId}");
        record.EntityType.ShouldBe("CustomerMembership");
        record.EntityId.ShouldBe(business.Members[1].AccountId);
        record.Before!.ShouldContain("viewer", Case.Sensitive);
        record.After!.ShouldContain("trader", Case.Sensitive);
    }

    [Fact]
    public async Task A_non_admin_cannot_change_a_role()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);
        var client = await Seed.SignInAsync(business.Members[1]);

        var response = await client.PatchAsJsonAsync(
            MembershipUrl(business.Members[1].AccountId),
            new MembershipRoleChangeRequest("admin"), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }
```

Add `using System.Net.Http.Json;` — already present — and nothing else.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~MembershipEndpointTests" 2>&1 | tail -40
```

Expected: the seven Task-6 cases still PASS; every new case **FAILS** with
`response.StatusCode.ShouldBe(...)` reporting `Unauthorized` — the route is unmapped and the host's
`FallbackPolicy` answers 401 for a route it does not have.

- [ ] **Step 3: Write the floor, and the PATCH**

Add to
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Portal/MembershipEndpoints.cs`:

```csharp
    /// <summary>The <c>audit.audit_record.entity_type</c> every row written here carries.</summary>
    internal const string AuditEntityType = "CustomerMembership";

    internal const string RoleChangedAction = "MEMBERSHIP_ROLE_CHANGED";

    /// <summary>
    /// The refusal, in one string because two verbs produce it and a customer must not read two
    /// different sentences for one rule.
    /// </summary>
    private const string FloorRefusal =
        "This company must keep at least {0} administrator{1}. Make somebody else an "
        + "administrator first, and then try again.";
```

the registration, inside `MapMembershipEndpoints` after the GET:

```csharp
        routes.MapPatch(Membership, ChangeRoleAsync)
            .WithTags("Company")
            .RequireAuthorization(CustomerAuthorizationPolicies.CompanyAdmin)
            .TenantScoped("customer-account")
            .WithName("ChangeCompanyMembershipRole")
            .WithSummary("Change what one colleague may do. Admins only.")
            // The WHOLE list, not the one row that changed: a caller replaces its state instead of
            // patching it, which is where a screen and a server start disagreeing.
            .Produces<CompanyMembershipsResponse>()
            .ProducesValidationProblem()
            // ApiResults.NotFound: the membership is behind the explicit tenancy predicate, so
            // "missing" already means "not this business's" - 404, never 403 [F13-R19].
            .ProducesProblem(StatusCodes.Status404NotFound)
            // The admin floor. One cause, one status: demoting the last admin an ordinary business
            // has, or the second one a four-eyes business has.
            .ProducesProblem(StatusCodes.Status409Conflict);
```

and the handler plus the two floor helpers:

```csharp
    /// <summary>
    /// Change one colleague's role.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>No <c>BeginTransaction</c>.</b> <c>CustomerSessionMiddleware</c> has already opened one
    /// for every authenticated request and EF Core throws rather than nesting; that ambient
    /// transaction is also what makes the lock below and the write atomic — it commits once the
    /// pipeline returns cleanly, and disposes as a rollback if this handler throws.
    /// </para>
    /// <para>
    /// <b>Tracked, not <c>AsNoTracking</c></b>: <c>SaveChangesAsync</c> has to see the mutation.
    /// </para>
    /// </remarks>
    private static async Task<IResult> ChangeRoleAsync(
        Guid accountId,
        MembershipRoleChangeRequest request,
        ICustomerContext tenancy,
        IMarketCalendar calendar,
        PeakPowerDbContext db,
        CancellationToken cancellationToken)
    {
        // Same boundary check as InvitationEndpoints.IssueAsync, and the same single declaration:
        // MembershipRoleWire.TryParse (contract §13.2.1), never a nullable-returning Parse overload.
        if (!MembershipRoleWire.TryParse(request.MembershipRole, out var role))
        {
            return ApiResults.InvalidRequest(
                "membershipRole",
                "membershipRole must be one of: "
                + $"{string.Join(", ", MembershipRoleWire.Values)}.");
        }

        // ⚠ The explicit AND customer_id = @active. CompanyAdmin proved "an admin of the business
        // in my token"; it never proved that THIS accountId is in that business, and this
        // predicate is what proves the second. CustomerMembership carries no query filter, so
        // there is nothing else supplying it - and migration 15's WITH CHECK is the backstop that
        // catches a handler which forgot, rather than the thing doing the work.
        var membership = await db.CustomerMemberships.SingleOrDefaultAsync(
            row => row.AccountId == accountId
                && row.CustomerId == tenancy.CustomerId
                && row.RemovedAt == null,
            cancellationToken);

        if (membership is null)
        {
            // 404, never 403: a 403 would confirm the account exists somewhere [F13-R19]. The body
            // is a constant, so this is byte-identical to the 404 for an id that never existed.
            return ApiResults.NotFound();
        }

        if (membership.Role == role)
        {
            // Asking for the state somebody is already in falls through: no write, no audit row,
            // and the unchanged list. The screen's control is a select, and a select that errors
            // when you re-pick the current value breaks on a double click.
            return Results.Ok(await ReadAsync(db, tenancy, cancellationToken));
        }

        if (membership.Role == MembershipRole.Admin)
        {
            // Demoting an admin takes one away exactly as removing them does, so it takes the same
            // lock. See LockAdminsAsync for why a count without one is exploitable.
            var floor = await AdminFloorAsync(db, tenancy.CustomerId, cancellationToken);
            var admins = await LockAdminsAsync(db, tenancy.CustomerId, cancellationToken);

            if (admins - 1 < floor)
            {
                return ApiResults.Conflict(
                    string.Format(
                        System.Globalization.CultureInfo.InvariantCulture,
                        FloorRefusal, floor, floor == 1 ? string.Empty : "s"));
            }
        }

        var before = MembershipRoleWire.Of(membership.Role);
        membership.ChangeRole(role);

        Audit(db, calendar.UtcNow, $"account:{tenancy.AccountId}", RoleChangedAction,
              tenancy.CustomerId, accountId,
              before: Payload(before), after: Payload(MembershipRoleWire.Of(role)));

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(await ReadAsync(db, tenancy, cancellationToken));
    }

    /// <summary>
    /// Two admins for a four-eyes business, one otherwise. Design decision 7.
    /// </summary>
    /// <remarks>
    /// The corpus is split on whether a floor is a refusal or a warning — C9, <c>[F01-R16]</c> and
    /// <c>[F01-R50]</c> read as refusal, while <c>[F12-R43]</c> says explicitly *"It is not
    /// refused — the account may be a leaver"* — and design §6.4 chooses REFUSAL for the
    /// customer-side verbs while leaving the employee-side warning untouched. This is that choice,
    /// and it is a choice rather than something the corpus agrees on.
    /// </remarks>
    internal static async Task<int> AdminFloorAsync(
        PeakPowerDbContext db, Guid customerId, CancellationToken cancellationToken)
    {
        // The customer row is behind its own tenant-isolation policy, which plan 2 widened to
        // `id = app.customer_id OR id IN (…memberships…)`; the explicit predicate keeps this to
        // the active business regardless.
        var fourEyes = await db.Customers
            .AsNoTracking()
            .Where(customer => customer.Id == customerId)
            .Select(customer => customer.FourEyesEnabled)
            .SingleAsync(cancellationToken);

        return fourEyes ? 2 : 1;
    }

    /// <summary>
    /// Locks this business's active admin memberships and returns how many there are.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The floor is a check-then-act, and without this it is a race.</b> Counting the admins and
    /// then removing one are two statements; under the connection's default READ COMMITTED
    /// isolation two admins acting at the same instant each read a count of three and both
    /// succeed, leaving one — below a four-eyes floor of two. Design §6.4 requires the count to
    /// take <c>SELECT … FOR UPDATE</c> over the business's admin rows inside the same transaction
    /// as the write, which the ambient transaction
    /// <c>CustomerSessionMiddleware</c> opened is.
    /// </para>
    /// <para>
    /// <b>Rows, not <c>count(*)</c>.</b> PostgreSQL refuses <c>FOR UPDATE</c> with an aggregate
    /// (<c>0A000: FOR UPDATE is not allowed with aggregate functions</c>), so this selects the ids
    /// and counts them here.
    /// </para>
    /// <para>
    /// <b><c>ORDER BY account_id</c> is deadlock avoidance, not presentation.</b> Two transactions
    /// locking the same set in the same order make one wait; locking in different orders makes
    /// them deadlock with <c>40P01</c>. The loser then re-evaluates under READ COMMITTED and sees
    /// the winner's <c>removed_at</c>, so the row drops out of its own result and the count it
    /// gets is the post-commit one — which is exactly what makes the second removal refuse.
    /// </para>
    /// <para>
    /// <b><c>FOR UPDATE</c> needs the <c>UPDATE</c> privilege</b>, which shared contract §5 grants
    /// <c>app_customer_role</c> on <c>customer_membership</c>. It does not need — and must not
    /// have — a <c>DELETE</c> one.
    /// </para>
    /// <para>
    /// ⚠ The explicit <c>customer_id = @customerId</c> is the whole point, again: the
    /// tenant-isolation policy's <c>account_id = app.account_id</c> arm makes the CALLER's admin
    /// memberships in OTHER businesses visible on this connection, so a count that leaned on the
    /// policy could read three where the business has two. Design §4.2 sets out the exploit.
    /// </para>
    /// <para>
    /// <c>ExecuteSql</c>-family and never <c>…Raw</c>: EF1002 is an error in this build, and it is
    /// right to be — <paramref name="customerId"/> below is parameterised rather than pasted into
    /// the statement.
    /// </para>
    /// </remarks>
    internal static async Task<int> LockAdminsAsync(
        PeakPowerDbContext db, Guid customerId, CancellationToken cancellationToken)
    {
        var locked = await db.Database
            .SqlQuery<Guid>(
                $"""
                 SELECT account_id AS "Value"
                 FROM customer.customer_membership
                 WHERE customer_id = {customerId}
                   AND role = 'admin'
                   AND removed_at IS NULL
                 ORDER BY account_id
                 FOR UPDATE
                 """)
            .ToListAsync(cancellationToken);

        return locked.Count;
    }

    /// <summary>
    /// One append-only audit row. <c>Before</c> and <c>After</c> are jsonb columns the database
    /// parses, so both are written as JSON documents rather than as prose.
    /// </summary>
    internal static void Audit(
        PeakPowerDbContext db,
        DateTimeOffset now,
        string actor,
        string action,
        Guid customerId,
        Guid accountId,
        string? before,
        string? after)
    {
        var record = AuditRecord.Create(
            now, actor, action, AuditEntityType,
            // The ACCOUNT, here, and not the business: a promotion, a demotion and a removal are
            // three records about ONE person's standing, and (entity_type, entity_id) is then the
            // index that answers "what has happened to this colleague" in one scan.
            // InvitationEndpoints files under the BUSINESS for an invitation, because there is no
            // account id yet - its own doc comment records that.
            entityId: accountId,
            customerId: customerId,
            before: before,
            after: after);

        // Create refuses only a blank actor, action or entity type, all three of which are
        // constants here. Guarded rather than dereferenced, because a failed Result's .Value
        // throws an InvalidOperationException that names none of them.
        if (record.IsSuccess)
        {
            db.AuditRecords.Add(record.Value);
        }
    }

    /// <summary>
    /// The jsonb payload: one field, a lowercase role constant that cannot contain a quote or a
    /// backslash, so it is written by hand rather than serialised.
    /// </summary>
    private static string Payload(string membershipRole) =>
        $$"""{"membershipRole":"{{membershipRole}}"}""";
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~MembershipEndpointTests" 2>&1 | tail -30
```

Expected: build clean; PASS — the seven from Task 6 plus twelve new cases (three `Theory` rows and
nine `Fact`s).

- [ ] **Step 5: Mutate the floor's tenancy predicate, then the floor itself**

**Mutation 1 — the count's tenancy.** In `LockAdminsAsync`, change
`WHERE customer_id = {customerId}` to `WHERE 1 = 1`, leaving the role and `removed_at` predicates.
Row-level security still applies, so this is precisely the "trust the policy" version design §4.2
warns about.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~MembershipEndpointTests" 2>&1 | tail -40
```

Expected: **FAIL**, exactly one case —
`An_admins_membership_in_a_shell_business_cannot_inflate_the_floor_count`, on
`response.StatusCode.ShouldBe(HttpStatusCode.Conflict, …)` reporting `OK`. The caller's admin
membership in her own shell business came through the policy's `account_id` arm, the count read
three, and a four-eyes business was left with one admin. Every other case in the file still passes,
because none of their members belongs to a second business — which is why that one test exists.

Restore `WHERE customer_id = {customerId}`.

**Mutation 2 — the floor number.** In `AdminFloorAsync`, change `fourEyes ? 2 : 1` to `1`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~MembershipEndpointTests" 2>&1 | tail -40
```

Expected: **FAIL**, exactly two cases —
`Demoting_the_second_admin_of_a_four_eyes_business_is_refused` and
`An_admins_membership_in_a_shell_business_cannot_inflate_the_floor_count`, both on
`ShouldBe(HttpStatusCode.Conflict)` reporting `OK`.
`Demoting_the_last_admin_of_an_ordinary_business_is_refused` still passes, which is what tells you
the mutation hit the four-eyes half and not the floor mechanism. Restore `fourEyes ? 2 : 1`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform diff -- \
  src/Hosts/PeakPower.Api.Customer/Portal/MembershipEndpoints.cs > /tmp/t7-restore.diff
grep -c 'customer_id = {customerId}\|fourEyes ? 2 : 1' \
  src/Hosts/PeakPower.Api.Customer/Portal/MembershipEndpoints.cs
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~MembershipEndpointTests" 2>&1 | tail -10
```

Expected: the `grep -c` prints `2`; PASS, all nineteen.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform add \
  src/Hosts/PeakPower.Api.Customer/Portal/MembershipEndpoints.cs \
  tests/PeakPower.Integration.Tests/Portal/MembershipEndpointTests.cs
git -C /Users/thinhhuynh/PeakPower/peakpower-platform commit -m "feat(api): PATCH a membership role, and the admin floor on demotion

A demotion takes an admin away exactly as a removal does, so it takes the same
SELECT ... FOR UPDATE lock over the business's admin rows, inside the transaction
CustomerSessionMiddleware already opened. Rows and not count(*), because PostgreSQL refuses
FOR UPDATE with an aggregate; ORDER BY account_id so two transactions lock the same set in
the same order and one waits rather than both deadlocking.

CompanyAdmin proves 'an admin of the business in my token' and never 'this accountId is in
that business'. The explicit AND customer_id = @active proves the second, and a membership
in another business answers 404 with a byte-identical body to an id that never existed.

Verified by mutation: dropping that predicate from the LOCK lets an admin who is also sole
admin of a shell business hold a four-eyes business alone - one test in nineteen notices -
and flattening the floor to one lets the second admin of a four-eyes business be demoted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `DELETE /api/v1/company/memberships/{accountId:guid}` — the verb is DELETE, the SQL is an UPDATE

Design §3.1: *"⚠ **`removed_at` is not bookkeeping — it is what makes removal safe.** A membership
is *never* `DELETE`d. Postgres evaluates `WITH CHECK` for `INSERT` and for an `UPDATE`'s new row
and **never for `DELETE`**, which is governed by `USING` alone… Removal is therefore an `UPDATE`
setting `removed_at`, which **is** `WITH CHECK`-protected."*

Design §5: *"⚠ **Removal must revoke that member's refresh tokens for that business**, on the same
call. Otherwise 'fall back to another membership' turns a stolen cookie bound to A into a valid
session for B — removal becomes re-pointing rather than revocation. The revocation runs in the same
transaction as the delete, while the row is still visible."*

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Portal/MembershipEndpoints.cs`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/MembershipEndpointTests.cs` (modify)

**Interfaces:**
- Consumes:
  - `MembershipEndpoints.LockAdminsAsync(PeakPowerDbContext db, Guid customerId, CancellationToken ct)`
    — Task 7. Runs
    `SELECT account_id FROM customer.customer_membership WHERE customer_id = @customerId AND role = 'admin' AND removed_at IS NULL ORDER BY account_id FOR UPDATE`
    and returns the row count.
  - `MembershipEndpoints.AdminFloorAsync(PeakPowerDbContext db, Guid customerId, CancellationToken ct)`
    — Task 7. `2` when `customer.four_eyes_enabled`, `1` otherwise.
  - `MembershipEndpoints.Audit(PeakPowerDbContext db, DateTimeOffset now, string actor, string action, Guid customerId, Guid accountId, string? before, string? after)`
    — Task 7.
  - `MembershipEndpoints.ReadAsync(db, tenancy, ct)` — Task 6.
  - `CustomerMembership.Remove(DateTimeOffset at)` (plan 1); `RefreshToken.Revoke(DateTimeOffset)`
    and `RefreshToken.CustomerId` (plan 1 — Preflight item 5).
- Produces: the route `DELETE /api/v1/company/memberships/{accountId:guid}`;
  `MembershipEndpoints.RemovedAction` (`"MEMBERSHIP_REMOVED"`).

- [ ] **Step 1: Write the failing test**

Append to
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/MembershipEndpointTests.cs`:

```csharp
    // ------------------------------------------------------------------ the removal

    [Fact]
    public async Task Removing_a_member_answers_204_and_takes_them_off_the_list()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);
        var client = await Seed.SignInAsync(business.Members[0]);

        var response = await client.DeleteAsync(
            MembershipUrl(business.Members[1].AccountId), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.NoContent);

        var body = await client.GetFromJsonAsync<CompanyMembershipsResponse>(Memberships, Ct);
        body!.Members.Count.ShouldBe(1);
        body.Members[0].AccountId.ShouldBe(business.Members[0].AccountId);
    }

    /// <summary>
    /// THE removal probe. The verb is DELETE and the SQL is an UPDATE - design §3.1 - so the row
    /// survives with removed_at set. Anything else would mean the write was a real DELETE, which
    /// PostgreSQL cannot WITH CHECK-guard and which shared contract §5 revokes the grant for.
    /// </summary>
    [Fact]
    public async Task The_row_survives_with_removed_at_set_and_its_role_untouched()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);
        var client = await Seed.SignInAsync(business.Members[0]);

        await client.DeleteAsync(MembershipUrl(business.Members[1].AccountId), Ct);

        await using var db = factory.CreateOwnerDbContext();
        var membership = await db.CustomerMemberships.SingleAsync(
            m => m.AccountId == business.Members[1].AccountId
              && m.CustomerId == business.CustomerId, Ct);

        membership.RemovedAt.ShouldNotBeNull();
        membership.Role.ShouldBe(
            MembershipRole.Trader,
            "removal records that they left, not that they were demoted on the way out");
    }

    /// <summary>
    /// Design §5: without this, a stolen cookie bound to the removed business survives the removal
    /// and 'fall back to another membership' turns it into a valid session there. The revocation
    /// runs in the same transaction as the removal, while the row is still visible - which is also
    /// why refresh_token keys on its OWN customer_id rather than on an EXISTS through membership
    /// (shared contract §5.2): under that shape the transaction would see its own removal, find no
    /// active membership, and revoke zero rows silently.
    /// </summary>
    [Fact]
    public async Task Removal_revokes_that_persons_refresh_tokens_for_that_business_and_no_others()
    {
        var a = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);
        var b = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var leaver = a.Members[1];

        // The leaver is also a member of B, and holds a live session in each.
        await using (var arrange = factory.CreateOwnerDbContext())
        {
            arrange.CustomerMemberships.Add(CustomerMembership.Create(
                leaver.AccountId, b.CustomerId, MembershipRole.Trader, DateTimeOffset.UtcNow).Value);
            await arrange.SaveChangesAsync(Ct);
        }

        // Sign in twice, so there are two rows to tell apart. Both are for business A until plan
        // 2's switch moves one; force B's directly on the owner connection so this test asserts
        // THIS plan's revocation rather than plan 2's switching.
        await Seed.SignInAsync(leaver);

        await using (var arrange = factory.CreateOwnerDbContext())
        {
            arrange.RefreshTokens.Add(RefreshToken.Issue(
                leaver.AccountId,
                b.CustomerId,
                PeakPower.Infrastructure.Identity.OpaqueToken.HashOf(Guid.NewGuid().ToString("N")),
                DateTimeOffset.UtcNow,
                DateTimeOffset.UtcNow.AddDays(30)));
            await arrange.SaveChangesAsync(Ct);
        }

        var admin = await Seed.SignInAsync(a.Members[0]);
        (await admin.DeleteAsync(MembershipUrl(leaver.AccountId), Ct))
            .StatusCode.ShouldBe(HttpStatusCode.NoContent);

        await using var db = factory.CreateOwnerDbContext();
        var tokens = await db.RefreshTokens
            .Where(token => token.CustomerAccountId == leaver.AccountId)
            .ToListAsync(Ct);

        tokens.Where(token => token.CustomerId == a.CustomerId)
            .ShouldAllBe(token => token.RevokedAt != null);
        tokens.Where(token => token.CustomerId == b.CustomerId)
            .ShouldAllBe(token => token.RevokedAt == null);
    }

    [Fact]
    public async Task Removing_the_last_admin_of_an_ordinary_business_is_refused()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);

        // A second admin removes the first, so this is the floor and not the self-removal rule.
        await using (var arrange = factory.CreateOwnerDbContext())
        {
            var membership = await arrange.CustomerMemberships.SingleAsync(
                m => m.AccountId == business.Members[1].AccountId
                  && m.CustomerId == business.CustomerId, Ct);
            membership.ChangeRole(MembershipRole.Admin);
            await arrange.SaveChangesAsync(Ct);
        }

        // Now demote the second back to trader on the owner connection, leaving exactly one admin,
        // and have that one try to remove... itself - which is the self-removal rule. So instead:
        // seed a fresh business with one admin and one trader, and have the TRADER be removed by
        // the admin; then flip and prove the floor with a second admin removing the first.
        var floorCase = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Admin);
        await using (var arrange = factory.CreateOwnerDbContext())
        {
            var second = await arrange.CustomerMemberships.SingleAsync(
                m => m.AccountId == floorCase.Members[1].AccountId
                  && m.CustomerId == floorCase.CustomerId, Ct);
            second.ChangeRole(MembershipRole.Admin);
            await arrange.SaveChangesAsync(Ct);
        }

        var client = await Seed.SignInAsync(floorCase.Members[1]);

        // Two admins, floor one: removing one is allowed.
        (await client.DeleteAsync(MembershipUrl(floorCase.Members[0].AccountId), Ct))
            .StatusCode.ShouldBe(HttpStatusCode.NoContent);

        // One admin left, and it is the caller - so this is refused by the self-removal rule
        // rather than by the floor. The floor's own refusal is proved by the four-eyes case below,
        // where the caller removes SOMEBODY ELSE and is still refused.
        (await client.DeleteAsync(MembershipUrl(floorCase.Members[1].AccountId), Ct))
            .StatusCode.ShouldBe(HttpStatusCode.Conflict);
    }

    /// <summary>
    /// TWO for a four-eyes business. The caller removes somebody ELSE, so this is unambiguously
    /// the floor and not the self-removal rule.
    /// </summary>
    [Fact]
    public async Task Removing_the_second_admin_of_a_four_eyes_business_is_refused()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: true, MembershipRole.Admin, MembershipRole.Admin);
        var client = await Seed.SignInAsync(business.Members[0]);

        var response = await client.DeleteAsync(
            MembershipUrl(business.Members[1].AccountId), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await response.Content.ReadAsStringAsync(Ct))
            .ShouldContain("administrator", Case.Insensitive);

        await using var db = factory.CreateOwnerDbContext();
        var membership = await db.CustomerMemberships.SingleAsync(
            m => m.AccountId == business.Members[1].AccountId
              && m.CustomerId == business.CustomerId, Ct);
        membership.RemovedAt.ShouldBeNull();
    }

    [Fact]
    public async Task Removing_the_third_admin_of_a_four_eyes_business_is_allowed()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: true, MembershipRole.Admin, MembershipRole.Admin, MembershipRole.Admin);
        var client = await Seed.SignInAsync(business.Members[0]);

        (await client.DeleteAsync(MembershipUrl(business.Members[2].AccountId), Ct))
            .StatusCode.ShouldBe(HttpStatusCode.NoContent);
    }

    /// <summary>
    /// Design §8 puts "leaving a business on your own initiative" out of scope, and DELETE of your
    /// own membership is that action wearing the admin verb's clothes. A named 409, not a bare
    /// 403: no TYPE in this codebase may produce one, and this refusal is a domain rule rather
    /// than an authorization failure - the caller IS an admin.
    /// </summary>
    [Fact]
    public async Task An_admin_may_not_remove_their_own_membership()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Admin);
        var client = await Seed.SignInAsync(business.Members[0]);

        var response = await client.DeleteAsync(
            MembershipUrl(business.Members[0].AccountId), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Conflict);
        (await response.Content.ReadAsStringAsync(Ct))
            .ShouldContain("your own", Case.Insensitive);
    }

    [Fact]
    public async Task A_member_of_another_business_is_a_404_on_the_delete_too()
    {
        var a = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var b = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);
        var client = await Seed.SignInAsync(a.Members[0]);

        (await client.DeleteAsync(MembershipUrl(b.Members[1].AccountId), Ct))
            .StatusCode.ShouldBe(HttpStatusCode.NotFound);

        await using var db = factory.CreateOwnerDbContext();
        var untouched = await db.CustomerMemberships.SingleAsync(
            m => m.AccountId == b.Members[1].AccountId && m.CustomerId == b.CustomerId, Ct);
        untouched.RemovedAt.ShouldBeNull();
    }

    [Fact]
    public async Task Removing_the_same_person_twice_is_a_404_the_second_time()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);
        var client = await Seed.SignInAsync(business.Members[0]);

        (await client.DeleteAsync(MembershipUrl(business.Members[1].AccountId), Ct))
            .StatusCode.ShouldBe(HttpStatusCode.NoContent);
        (await client.DeleteAsync(MembershipUrl(business.Members[1].AccountId), Ct))
            .StatusCode.ShouldBe(
                HttpStatusCode.NotFound,
                "the second call finds no ACTIVE membership; that is the same answer as an "
                + "accountId that was never a member, which is what [F13-R19] asks for");
    }

    [Fact]
    public async Task A_removal_writes_an_audit_record()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Viewer);
        var client = await Seed.SignInAsync(business.Members[0]);

        await client.DeleteAsync(MembershipUrl(business.Members[1].AccountId), Ct);

        await using var db = factory.CreateOwnerDbContext();
        var record = await db.AuditRecords.SingleAsync(
            r => r.CustomerId == business.CustomerId && r.Action == "MEMBERSHIP_REMOVED", Ct);

        record.Actor.ShouldBe($"account:{business.Members[0].AccountId}");
        record.EntityId.ShouldBe(business.Members[1].AccountId);
        record.Before!.ShouldContain("viewer", Case.Sensitive);
        record.After.ShouldBeNull();
    }

    [Fact]
    public async Task A_non_admin_cannot_remove_anybody()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);
        var client = await Seed.SignInAsync(business.Members[1]);

        (await client.DeleteAsync(MembershipUrl(business.Members[0].AccountId), Ct))
            .StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }
```

⚠ `RefreshToken.Issue` above is called with a `customerId` second argument. That is this plan's
assumption about plan 1's widened factory (Preflight item 5). If the real one differs, correct the
one call site here.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~MembershipEndpointTests" 2>&1 | tail -40
```

Expected: the nineteen earlier cases still PASS; every new case **FAILS** with
`response.StatusCode.ShouldBe(HttpStatusCode.NoContent)` reporting `Unauthorized` — the route is
unmapped and the `FallbackPolicy` answers 401.

- [ ] **Step 3: Write the removal**

Add to
`/Users/thinhhuynh/PeakPower/peakpower-platform/src/Hosts/PeakPower.Api.Customer/Portal/MembershipEndpoints.cs`:
the constant,

```csharp
    internal const string RemovedAction = "MEMBERSHIP_REMOVED";
```

the registration, after the PATCH:

```csharp
        routes.MapDelete(Membership, RemoveAsync)
            .WithTags("Company")
            .RequireAuthorization(CustomerAuthorizationPolicies.CompanyAdmin)
            .TenantScoped("customer-account")
            .WithName("RemoveCompanyMembership")
            .WithSummary("Take somebody out of this company. Admins only.")
            // 204 and no body. The caller re-reads the list; handing it back here would make the
            // one verb that has nothing to say say something, and would double this response's
            // size for every removal.
            .Produces(StatusCodes.Status204NoContent)
            // ApiResults.NotFound: 404 for a membership that is not this business's, and for one
            // already removed - byte-identical to an accountId that never existed [F13-R19].
            .ProducesProblem(StatusCodes.Status404NotFound)
            // Two causes, one status: the admin floor, and removing your own membership.
            .ProducesProblem(StatusCodes.Status409Conflict);
```

and the handler:

```csharp
    /// <summary>
    /// Take somebody out of this business.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The HTTP verb is <c>DELETE</c> and the SQL is an <c>UPDATE</c>, and that is the whole
    /// reason removal is guarded at all.</b> PostgreSQL evaluates <c>WITH CHECK</c> for an
    /// <c>INSERT</c> and for an <c>UPDATE</c>'s new row and <b>never for a <c>DELETE</c></b>,
    /// which <c>USING</c> alone governs — and migration 15's <c>USING</c> has no admin term, only
    /// the permissive <c>account_id OR customer_id</c> pair. A granted <c>DELETE</c> would let a
    /// plain viewer wipe every membership in their business, admins included, and let anybody drop
    /// their own memberships in businesses their token does not name. Shared contract §5 therefore
    /// grants no <c>DELETE</c> to either role, and this handler sets <c>removed_at</c>.
    /// </para>
    /// <para>
    /// <b>No <c>BeginTransaction</c>.</b> <c>CustomerSessionMiddleware</c> has already opened one
    /// and EF Core throws rather than nesting. That ambient transaction is what makes the lock, the
    /// removal, the token revocation and the audit row one atomic act — which design §5 requires
    /// in terms: the revocation runs while the membership row is still visible.
    /// </para>
    /// </remarks>
    private static async Task<IResult> RemoveAsync(
        Guid accountId,
        ICustomerContext tenancy,
        IMarketCalendar calendar,
        PeakPowerDbContext db,
        CancellationToken cancellationToken)
    {
        // Design §8 puts "leaving a business on your own initiative" out of scope, and this is
        // that action wearing the admin verb's clothes. Checked BEFORE the lookup so the answer
        // does not depend on the state of the caller's own row, and a named 409 rather than a bare
        // 403 - the caller IS an admin, so this is a domain refusal, not an authorization failure,
        // and no type in this codebase may produce a 403 anyway.
        if (accountId == tenancy.AccountId)
        {
            return ApiResults.Conflict(
                "You cannot remove your own membership. Ask another administrator to do it.");
        }

        // ⚠ The explicit AND customer_id = @active, again. CompanyAdmin proved "an admin of the
        // business in my token" and never "this accountId is in that business".
        var membership = await db.CustomerMemberships.SingleOrDefaultAsync(
            row => row.AccountId == accountId
                && row.CustomerId == tenancy.CustomerId
                && row.RemovedAt == null,
            cancellationToken);

        if (membership is null)
        {
            // Covers three cases with one constant body: not this business's, never existed, and
            // already removed. 404 and never 403 [F13-R19].
            return ApiResults.NotFound();
        }

        if (membership.Role == MembershipRole.Admin)
        {
            var floor = await AdminFloorAsync(db, tenancy.CustomerId, cancellationToken);
            // SELECT ... FOR UPDATE over this business's admin rows, inside the ambient
            // transaction. Without it two admins removing each other at the same instant each read
            // the pre-commit count and both succeed - see LockAdminsAsync's own remarks, and
            // MembershipConcurrencyTests for the proof.
            var admins = await LockAdminsAsync(db, tenancy.CustomerId, cancellationToken);

            if (admins - 1 < floor)
            {
                return ApiResults.Conflict(
                    string.Format(
                        System.Globalization.CultureInfo.InvariantCulture,
                        FloorRefusal, floor, floor == 1 ? string.Empty : "s"));
            }
        }

        var now = calendar.UtcNow;
        var before = MembershipRoleWire.Of(membership.Role);

        membership.Remove(now);

        // ---------------------------------------------------------------------------------
        // Design §5: "Removal must revoke that member's refresh tokens for that business, on the
        // same call. Otherwise 'fall back to another membership' turns a stolen cookie bound to A
        // into a valid session for B - removal becomes re-pointing rather than revocation."
        //
        // FOR THAT BUSINESS and no other: the same person's sessions elsewhere are untouched, which
        // is the whole point of one login with several memberships. That is why refresh_token
        // carries its own customer_id (shared contract §5.2) rather than reaching the tenant
        // through an EXISTS on membership: under that shape this transaction would see its own
        // removal, find no active membership, and revoke ZERO rows - silently.
        //
        // The grant this runs on is UPDATE (revoked_at), from migration 3
        // (20260828100211_AuthAndOnboarding.cs:163). Revoke's `??=` keeps it idempotent, and
        // RevokedAt == null takes in used-but-not-revoked rows too.
        // ---------------------------------------------------------------------------------
        var outstanding = await db.RefreshTokens
            .Where(token => token.CustomerAccountId == accountId
                         && token.CustomerId == tenancy.CustomerId
                         && token.RevokedAt == null)
            .ToListAsync(cancellationToken);

        foreach (var token in outstanding)
        {
            token.Revoke(now);
        }

        Audit(db, now, $"account:{tenancy.AccountId}", RemovedAction,
              tenancy.CustomerId, accountId,
              before: Payload(before),
              // Null, not an empty object: there is no "after" state - the person is not in this
              // business any more, and a payload saying so would invent a role they do not have.
              after: null);

        // One SaveChangesAsync inside the ambient transaction: the removal, the revoked tokens and
        // the audit row commit together with everything else this request did, or none of it does.
        await db.SaveChangesAsync(cancellationToken);

        return Results.NoContent();
    }
```

`Payload(string)` is `MembershipEndpoints`' own private helper from Task 7:
`$$"""{"membershipRole":"{{membershipRole}}"}"""`.

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~MembershipEndpointTests" 2>&1 | tail -30
```

Expected: build clean; PASS, all thirty cases.

- [ ] **Step 5: Mutate the removal into a real delete, then the revocation's tenancy**

**Mutation 1 — make it a `DELETE`.** Replace `membership.Remove(now);` with
`db.CustomerMemberships.Remove(membership);`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~MembershipEndpointTests" 2>&1 | tail -40
```

Expected: **FAIL** on
`Removing_a_member_answers_204_and_takes_them_off_the_list` and every other removal case, with
`response.StatusCode.ShouldBe(HttpStatusCode.NoContent)` reporting `InternalServerError`, and the
inner exception
`Npgsql.PostgresException : 42501: permission denied for table customer_membership`. There is no
`DELETE` grant to either app role and there never will be — shared contract §5.1 item 2 — so the
statement is refused by the privilege system before any policy is consulted. That is the point:
`removed_at` is not bookkeeping.

Restore `membership.Remove(now);`.

**Mutation 2 — drop the revocation's tenancy predicate.** Delete
`&& token.CustomerId == tenancy.CustomerId` from the refresh-token query.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~Removal_revokes_that_persons_refresh_tokens" 2>&1 | tail -20
```

Expected: **FAIL** on
`tokens.Where(token => token.CustomerId == b.CustomerId).ShouldAllBe(token => token.RevokedAt == null)`
— the leaver's session at business B was revoked too. Being removed from one business signed them
out of another, which is the failure mode "one login, several businesses" exists to avoid. Restore
the predicate.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -c 'membership.Remove(now)\|token.CustomerId == tenancy.CustomerId' \
  src/Hosts/PeakPower.Api.Customer/Portal/MembershipEndpoints.cs
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~MembershipEndpointTests" 2>&1 | tail -10
```

Expected: the `grep -c` prints `2`; PASS, all thirty.

- [ ] **Step 6: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform add \
  src/Hosts/PeakPower.Api.Customer/Portal/MembershipEndpoints.cs \
  tests/PeakPower.Integration.Tests/Portal/MembershipEndpointTests.cs
git -C /Users/thinhhuynh/PeakPower/peakpower-platform commit -m "feat(api): DELETE a membership by setting removed_at, and revoke that business's tokens

The verb is DELETE and the SQL is an UPDATE. PostgreSQL never evaluates WITH CHECK for a
DELETE, and migration 15's USING has no admin term, so a granted DELETE would let a plain
viewer wipe every membership in their business - which is why shared contract section 5
grants none and this handler sets removed_at instead.

Removal revokes the leaver's refresh tokens FOR THAT BUSINESS in the same transaction,
while the membership row is still visible. Their sessions elsewhere are untouched, which is
the point of one login with several memberships and the reason refresh_token keys on its own
customer_id rather than through an EXISTS on membership.

An admin may not remove their own membership: design section 8 puts leaving out of scope,
and this is that action wearing the admin verb's clothes. A named 409, not a bare 403.

Verified by mutation: turning the write into a real DELETE answers 500 out of 42501
permission denied, and dropping the revocation's tenancy predicate signs the leaver out of a
business they are still a member of.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The route table, the sample bodies, the allow-list, the response contract and the snapshot

Five routes land on three guards at once (contract §9's closing paragraph): the route-table test
pins the complete customer route list by hand, every endpoint must declare its tenancy
classification, and the mutating-endpoint count is cross-checked against a sample-bodies
collection. The response-metadata table and the OpenAPI snapshot move with them.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/CustomerApiRouteTableTests.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleBodies.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleQueries.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Auth/AnonymousEndpointAllowListTests.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract/CustomerResponseMetadataTests.cs`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json`

**Interfaces:**
- Consumes: the five routes of Tasks 4–8.
- Produces: nothing new — this task makes the standing guards tell the truth about them.

- [ ] **Step 1: Run the four guards and watch them fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~CustomerApiRouteTableTests|FullyQualifiedName~AnonymousEndpointAllowListTests|FullyQualifiedName~CustomerResponseMetadataTests|FullyQualifiedName~CustomerOpenApiSnapshotTests" \
  2>&1 | tail -60
```

Expected, four distinct failures:

1. `CustomerApiRouteTableTests.The_customer_route_table_is_exactly_the_set_this_class_reasons_about`
   — the actual array has five more entries than `ExpectedRouteTable`.
2. `CustomerApiRouteTableTests.Every_tenant_scoped_customer_endpoint_can_actually_be_probed` —
   `mutating.Count.ShouldBe(CustomerSampleBodies.All.Count)` reporting **8 against 5**, and
   `collectionGets.Count.ShouldBe(CustomerSampleQueries.All.Count)` reporting **9 against 8**.
   ⚠ Four mutating tenant-scoped routes exist today; plan 2's `POST /api/v1/auth/active-business`
   is the fifth, on **both** sides of that equality. Tasks 4–8 add three more — the invitation POST
   and the membership PATCH and DELETE — so `mutating` reads 8. `mutating` is a `List` filled one
   entry per METHOD, so `PATCH` and `DELETE` each contribute even though they share one pattern;
   see step 3's warning about the dictionary's key.
3. `AnonymousEndpointAllowListTests.Every_endpoint_requires_a_token_unless_it_is_on_the_allow_list`
   — `anonymous.ShouldBe(Expected, ignoreOrder: true)` with
   `POST /api/v1/company/invitations/accept` present in `anonymous` and absent from `Expected`.
4. `CustomerResponseMetadataTests.The_declared_response_contract_is_exactly_the_set_this_class_reasons_about`
   and `CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot`
   — five extra operations.

- [ ] **Step 2: Move the route table**

In `CustomerApiRouteTableTests.ExpectedRouteTable`, insert in the array's existing ordinal order —
`RouteTable.Enumerate` sorts by `METHOD /pattern`, and these five sit between
`"POST /api/v1/company/entitlements"` and `"GET /api/v1/consumption/day"`:

```csharp
        // Invitations [design §6.1]. The POST is CompanyAdmin and tenant-scoped; the accept is
        // ANONYMOUS - the invitation token is the authorisation, not tenancy, and the invitee may
        // hold no account at all. That is the one route in this file's set that
        // AnonymousEndpointAllowListTests.Expected also names.
        "POST /api/v1/company/invitations",
        "POST /api/v1/company/invitations/accept",
        // The member-management screen [design §6.2]. All three are CompanyAdmin. ⚠ The DELETE's
        // SQL is an UPDATE setting removed_at - there is no DELETE grant on
        // customer.customer_membership and there never will be - so this line describes the HTTP
        // verb and nothing about the statement.
        "GET /api/v1/company/memberships",
        "DELETE /api/v1/company/memberships/{accountId:guid}",
        "PATCH /api/v1/company/memberships/{accountId:guid}",
```

⚠ **Read the actual order off the failure message rather than trusting this listing.** The test
prints the full actual array; paste the five lines where the diff says they belong, keeping the
comments.

Then move the two counts:

```csharp
    /// <summary>
    /// Tenant-scoped routes that name an object in the path — the ones the cross-tenant probe
    /// substitutes another company's identifier into. Today: <c>GET /metering-points/{id:guid}</c>,
    /// <c>PATCH /metering-points/{id:guid}/naming</c>, and design §6.2's two membership verbs.
    /// </summary>
    private const int TenantScopedParameterisedCount = 4;

    /// <summary>
    /// Tenant-scoped GET routes with no route parameter — the ones the leak probe reads whole and
    /// searches for another company's identifiers. Today: <c>/auth/me</c>, <c>/company</c>,
    /// <c>/company/accounts</c>, <c>/company/entitlements</c>, <c>/company/memberships</c>,
    /// <c>/metering-points</c>, <c>/consumption/day</c>, <c>/consumption/intervals</c> and
    /// <c>/consumption/month</c>.
    /// </summary>
    private const int TenantScopedCollectionGetCount = 9;
```

⚠ `POST /api/v1/company/invitations/accept` is **anonymous**, so it is on neither count — it
carries `TenancyScope.Anonymous` and the cross-tenant probe does not attack it. That is what
`Every_endpoint_the_probe_does_not_attack_states_why` requires a reason for, and the reason is at
the `.AnonymousEndpoint(...)` call site.

- [ ] **Step 3: Add the three sample bodies**

In `CustomerSampleBodies.All`, add:

```csharp
            // The invitation. Tenant-scoped, mutating, and answered 202 for ANY address - so the
            // acceptance test that sends every body to its owning customer gets its 2xx whatever
            // the address's standing is, which is exactly the property the endpoint exists to
            // have. A fresh address per run is not needed and would be worse: two runs against one
            // container would then leave two pending invitations where a stable one leaves one.
            ["/api/v1/company/invitations"] =
                """{"email":"probe@example.nl","membershipRole":"viewer"}""",

            // ⚠ The role must be one somebody in the seeded company already is, or the probe's
            // "another company's object is 404" assertion could pass for the wrong reason - a 409
            // from the admin floor rather than a 404 from tenancy. `viewer` is never an admin, so
            // changing somebody to it can only ever be refused by the floor when they WERE the
            // last admin, which the probe's own fixture never arranges.
            ["/api/v1/company/memberships/{accountId:guid}"] =
                """{"membershipRole":"viewer"}""",
```

⚠ **One route pattern, two mutating methods.** `PATCH` and `DELETE` share
`/api/v1/company/memberships/{accountId:guid}`, and `CustomerSampleBodies.All` is keyed on the
pattern alone. Read `Every_tenant_scoped_customer_endpoint_can_actually_be_probed`'s failure text
before assuming one entry covers both: if the probe expands per method (as
`RouteTable.RouteTableEntry` does elsewhere in that class), the `DELETE` needs
`CustomerSampleBodies.NoRequestBody` under its own key and the dictionary's key type must carry the
method. **Fix it the way that file's own harness already reads, and say which in the commit
message** — do not change the harness to suit the entry.

`POST /api/v1/company/invitations/accept` needs **no** sample body: it is anonymous, so it is not
in the tenant-scoped mutating set the probe enumerates.

In `CustomerSampleQueries.All`, add the one new tenant-scoped collection GET — the leak probe reads
it whole, and a route missing from that registry is reported by name by the same test:

```csharp
            // Admin-only and parameterless. NoQueryString is the positive declaration that this
            // route needs none, not an exemption from the probe.
            ["/api/v1/company/memberships"] = _ => CustomerSampleQueries.NoQueryString,
```

⚠ The probe signs in as an admin (`SignedInAsync` seeds one), so this route answers 200 with a
non-empty body rather than the 403 a non-admin would get — which is what the leak check needs.

- [ ] **Step 4: Add the accept to the anonymous allow-list**

In `AnonymousEndpointAllowListTests.Expected`, add in the array's existing grouping:

```csharp
        "POST /api/v1/company/invitations/accept",                           // the invitation token is the credential
```

and extend the class's own remarks paragraph that counts the routes — it says *"All fourteen routes
on it carry `.AnonymousEndpoint(reason)`"* — to fifteen, with one clause naming why this one is
here:

```
/// The fifteenth is design §6.1's invitation accept, and it is the only anonymous route on this
/// host that WRITES a membership. It is anonymous deliberately rather than by omission: a
/// known-address accept run authenticated fails migration 15's WITH CHECK on both terms —
/// app.customer_id names the invitee's CURRENT business, and is_admin_of is false because the row
/// being inserted is the thing that would make it true — and an unknown-address accept has no
/// account to authenticate with at all.
```

- [ ] **Step 5: Add the five entries to the response contract**

In `CustomerResponseMetadataTests.ExpectedResponseContract`, in the array's existing order:

```csharp
        // 202 whether or not the address is already a colleague, and no other success code. A
        // second success code would be a second branch a client takes, and the branch is where a
        // future edit puts the fact that actually matters. The 400 is about the REQUEST - a
        // malformed address, a role that is not one of the three lowercase spellings - and never
        // about the address's standing.
        "POST /api/v1/company/invitations -> 202, 400:HttpValidationProblemDetails",

        // 400 names firstName, lastName and password: an address with no login must supply them,
        // because CustomerAccount.Create refuses a blank name and an account with no password hash
        // can never sign in. 409 is one body for unknown, spent and expired invitations alike, and
        // for the concurrent-signup race - telling those apart would make this an oracle for
        // grinding tokens. No 404 and no 403: the token is the only identifier in the request.
        "POST /api/v1/company/invitations/accept -> 200:CompanyInvitationAcceptedResponse, "
        + "400:HttpValidationProblemDetails, 409:ProblemDetails",

        // One exit and no 404: a business always has at least one member, because the admin floor
        // refuses the removal that would empty it.
        "GET /api/v1/company/memberships -> 200:CompanyMembershipsResponse",

        // 204 and no body on the DELETE; the caller re-reads the list. 404 covers "not this
        // company's", "never existed" and "already removed" with one constant body [F13-R19]. 409
        // has two causes: the admin floor, and removing your own membership, which design §8 puts
        // out of scope. ⚠ The verb is DELETE and the SQL is an UPDATE setting removed_at.
        "DELETE /api/v1/company/memberships/{accountId:guid} -> 204, 404:ProblemDetails, "
        + "409:ProblemDetails",

        // The whole list back, not the one row that changed. 400 for a role that is not one of the
        // three lowercase spellings; 404 for a membership that is not this company's; 409 for the
        // admin floor on a demotion. No 403 declared here or anywhere else on this host: the
        // admin-only refusal is the authorization middleware's.
        "PATCH /api/v1/company/memberships/{accountId:guid} -> 200:CompanyMembershipsResponse, "
        + "400:HttpValidationProblemDetails, 404:ProblemDetails, 409:ProblemDetails",
```

⚠ **Read the actual strings off the failure message.** `Operation.Describe()` builds these from the
endpoint metadata, and the exact spelling of a type name (`HttpValidationProblemDetails` vs
`ValidationProblemDetails`) is the generator's, not this plan's.

- [ ] **Step 6: Re-verify the OpenAPI snapshot**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~CustomerOpenApiSnapshotTests" 2>&1 | tail -20
ls tests/PeakPower.Integration.Tests/Contract/*.received.json > /tmp/t9-received.txt 2>&1
cat /tmp/t9-received.txt
```

Verify then accept:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
diff tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json \
     tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.received.json \
     > /tmp/t9-openapi.diff 2>&1
cat /tmp/t9-openapi.diff
```

⚠ **Read `/tmp/t9-openapi.diff` in full before accepting it.** It is a contract change that a
second repository generates a client from. It must contain exactly: five new paths; the six new
schemas (`CompanyInvitationRequest`, `CompanyInvitationAcceptance`,
`CompanyInvitationAcceptedResponse`, `CompanyMemberDto`, `CompanyInvitationDto`,
`CompanyMembershipsResponse`, `MembershipRoleChangeRequest`); and every `membershipRole` property
carrying `"enum": ["admin","trader","viewer"]` — **lowercase**. A `membershipRole` with no `enum`
at all means `EnumWireValuesSchemaTransformer`'s key did not match a property name (its lookup is
ordinal on the camelCase JSON name), and `Every_enum_wire_value_entry_names_a_property_that_exists`
is the test that says which entry is orphaned. Nothing else may move.

Then accept:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
mv tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.received.json \
   tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json
```

- [ ] **Step 7: Run the whole platform suite — this is the first task that can**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln --nologo 2>&1 | tail -30
tools/verify-migrator.sh
```

Expected: green, everywhere. Every literal Tasks 1–8 left behind is now moved.

⚠ Testcontainers: several suites in parallel across worktrees can exhaust connections and produce
mass Postgres timeouts. Retry once before reporting a regression.

- [ ] **Step 8: Mutate the classification, and then the allow-list**

**Mutation 1 — drop a classification.** Delete `.TenantScoped("customer-account")` from the
`GET /api/v1/company/memberships` registration.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~CustomerApiRouteTableTests" 2>&1 | tail -30
```

Expected: **FAIL** on `Every_customer_endpoint_declares_its_tenancy` with
`undeclared.ShouldBeEmpty(...)` listing `GET /api/v1/company/memberships`, and **also** on
`Every_tenant_scoped_customer_endpoint_can_actually_be_probed`'s
`collectionGets.Count.ShouldBe(CustomerSampleQueries.All.Count)` reporting 8 against 9 — an
unclassified route is skipped by that walk entirely, so it drops out of `collectionGets` while its
registry entry stays. (The registry entry also shows up as a `stale` problem by name.) Two guards
catching one omission is the design of that class: one names it, the other counts it. Restore.

**Mutation 2 — take the accept off the allow-list.** Delete the
`"POST /api/v1/company/invitations/accept"` line from `AnonymousEndpointAllowListTests.Expected`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~AnonymousEndpointAllowListTests" 2>&1 | tail -30
```

Expected: **FAIL** on `Every_endpoint_requires_a_token_unless_it_is_on_the_allow_list` with
`anonymous.ShouldBe(Expected, ignoreOrder: true)` reporting the extra entry — *"an endpoint that
skips CustomerSessionMiddleware runs with RLS disabled; a route missing here has silently stopped
being reachable."* That is the guard doing exactly its job: an anonymous write on this host must be
a line somebody argued for. Restore, and re-run the whole file.

- [ ] **Step 9: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform add \
  tests/PeakPower.Integration.Tests/Tenancy/CustomerApiRouteTableTests.cs \
  tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleBodies.cs \
  tests/PeakPower.Integration.Tests/Tenancy/CustomerSampleQueries.cs \
  tests/PeakPower.Integration.Tests/Auth/AnonymousEndpointAllowListTests.cs \
  tests/PeakPower.Integration.Tests/Contract/CustomerResponseMetadataTests.cs \
  tests/PeakPower.Integration.Tests/Contract/CustomerOpenApiSnapshotTests.the_customer_openapi_document_matches_the_reviewed_snapshot.verified.json
git -C /Users/thinhhuynh/PeakPower/peakpower-platform commit -m "test(contract): the five new routes on every standing guard

The route table, both probe counts, the sample bodies, the sample queries, the anonymous
allow-list, the declared response contract and the OpenAPI snapshot. POST /company/invitations/accept is on
the allow-list DELIBERATELY and with its reason at the call site: it is the only anonymous
route on this host that writes a membership, and it has to be - a known-address accept run
authenticated fails migration 15's WITH CHECK on both terms.

The OpenAPI diff was read in full before it was accepted: five paths, seven schemas, and
every membershipRole carrying the lowercase enum the contract asks for.

Verified by mutation: dropping one .TenantScoped() turns two guards red at once, and taking
the accept off the allow-list is caught by exact equality rather than by a subset check.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: The indistinguishable-invitation probe — status, body **and** timing

Contract §11, required and named so no plan omits it: *"Known and unknown addresses match in
status, body **and** timing; the throttle counts both."*

**Which "known" this probe is about, and why the answer is a stronger property than it looks.**
The oracle worth closing is *"does this email address have a PeakPower login anywhere"* — an admin
with a list of addresses must not be able to read PeakPower's customer list off this endpoint. The
handler cannot answer it: after plan 1, the query filter on `CustomerAccount` narrows its one
lookup to **active members of the business in the token**, so "has a login at another business" and
"has no login at all" take the identical path — same statements, same row written, same message
enqueued. This probe proves that rather than assuming it, and it proves the other half too: that
the *third* case (already a colleague here), which genuinely does less work, still costs a throttle
count, so the arm cannot be read off the next request's delay.

**How timing is asserted, and why not with a stopwatch.** The house rule is
`SignInConstantWorkTests`': *"Asserted by counting the derivations and comparing their cost
parameters, never by timing the response: a wall-clock assertion would be measuring the throttle,
not the hasher."* The same reasoning applies here, so timing is asserted as **work**: the same
number of invitation rows, the same number of enqueued messages, the same number of throttle
counts, and the same response bytes. One wall-clock fact is asserted, and it is the one that
actually bit this codebase before — that neither arm **awaits** the mail provider — measured
against a sender that blocks, which is a coarse threshold rather than a comparison.

**Files:**
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/IndistinguishableInvitationTests.cs` (create)

**Interfaces:**
- Consumes: `MembershipFixture` (Task 4); `POST /api/v1/company/invitations` (Task 4);
  `CustomerApiFactory.Emails` (`CapturedEmailSender`); `ISignInThrottle`; `IEmailSender`.
- Produces: nothing. This is a probe.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/IndistinguishableInvitationTests.cs`:

```csharp
using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PeakPower.Application.Abstractions;
using PeakPower.Contracts.Customer.Auth;
using PeakPower.Contracts.Customer.Portal;
using PeakPower.Domain.Customers;
using PeakPower.Infrastructure.Web.Auth;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

/// <summary>
/// Shared contract §11's <b>Indistinguishable invite</b> probe: known and unknown addresses match
/// in status, body <b>and</b> timing, and the throttle counts both.
/// </summary>
/// <remarks>
/// <para>
/// <b>The oracle being closed is "does this address have a PeakPower login anywhere".</b> An admin
/// holding a list of email addresses must not be able to read PeakPower's customer list off this
/// endpoint. The handler cannot answer it: the query filter on <c>CustomerAccount</c> narrows its
/// one lookup to active members of the business in the token, so "has a login at another business"
/// and "has no login at all" are the same path. This file proves that instead of assuming it.
/// </para>
/// <para>
/// <b>Timing is asserted as WORK, not with a stopwatch</b>, which is
/// <c>SignInConstantWorkTests</c>' rule: a wall-clock comparison of two HTTP round trips measures
/// the throttle, the scheduler and the container, and is the kind of test somebody deletes after
/// the third flake. What makes two branches take the same time is that they issue the same
/// statements and await the same I/O, and that is what is compared here. The one wall-clock fact
/// asserted is a coarse threshold against a deliberately hanging mail sender — the exact failure
/// mode <c>OutboundMailbox</c>'s own remarks record measuring at 30307ms against 185ms.
/// </para>
/// </remarks>
public sealed class IndistinguishableInvitationTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Invitations = "/api/v1/company/invitations";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private MembershipFixture Seed => new(factory);

    /// <summary>
    /// An address that HAS a login — at a different business — and one that has none at all. Both
    /// are strangers to the inviting business, which is the only thing this endpoint may notice.
    /// </summary>
    [Fact]
    public async Task A_login_elsewhere_and_no_login_at_all_are_identical_in_status_and_body()
    {
        var inviter = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var elsewhere = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var client = await Seed.SignInAsync(inviter.Members[0]);

        var withALogin = await client.PostAsJsonAsync(
            Invitations,
            new CompanyInvitationRequest(elsewhere.Members[0].Email, "trader"), Ct);

        var withNoLogin = await client.PostAsJsonAsync(
            Invitations,
            new CompanyInvitationRequest($"{Guid.NewGuid():N}@nowhere.example", "trader"), Ct);

        withALogin.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        withNoLogin.StatusCode.ShouldBe(withALogin.StatusCode);

        // Byte-identical, compared ordinally. Both are empty today; asserting equality rather than
        // emptiness is what keeps them identical if either ever grows a body.
        var a = await withALogin.Content.ReadAsStringAsync(Ct);
        var b = await withNoLogin.Content.ReadAsStringAsync(Ct);
        b.ShouldBe(a);

        // And the headers a client can see. Content-Length is the one that would leak a differing
        // body before anybody read it.
        withNoLogin.Content.Headers.ContentLength
            .ShouldBe(withALogin.Content.Headers.ContentLength);
    }

    /// <summary>
    /// The same WORK: one invitation row, one enqueued message, one throttle count, on both arms.
    /// This is the timing assertion — what makes two paths take the same time is that they do the
    /// same things.
    /// </summary>
    [Fact]
    public async Task A_login_elsewhere_and_no_login_at_all_commission_identical_work()
    {
        var inviter = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);
        var elsewhere = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);

        var throttle = new RecordingThrottle();
        using var host = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
                services.AddSingleton<ISignInThrottle>(throttle)));
        var client = await SignInThroughAsync(host, inviter.Members[0]);

        var work = new List<(int Rows, int Messages, int Throttled)>();

        foreach (var address in new[]
                 {
                     elsewhere.Members[0].Email,
                     $"{Guid.NewGuid():N}@nowhere.example",
                 })
        {
            var mailBefore = factory.Emails.Sent.Count;
            throttle.Reset();

            var response = await client.PostAsJsonAsync(
                Invitations, new CompanyInvitationRequest(address, "trader"), Ct);
            response.StatusCode.ShouldBe(HttpStatusCode.Accepted);

            var messages = await CountMessagesAsync(address, mailBefore);

            await using var db = factory.CreateOwnerDbContext();
            var rows = await db.CustomerInvitations.CountAsync(
                invitation => invitation.CustomerId == inviter.CustomerId
                           && invitation.Email == address, Ct);

            work.Add((rows, messages, throttle.Reset()));
        }

        work[0].ShouldBe((1, 1, 1));
        work[1].ShouldBe(
            work[0],
            "an address with a login elsewhere and one with no login at all must commission the "
            + "same database write, the same enqueue and the same throttle count - that identity "
            + "is what makes their timings identical, and it is the thing a stopwatch would only "
            + "ever measure indirectly");
    }

    /// <summary>
    /// The THIRD case, which is not the oracle and must still cost a count. An address that is
    /// already a colleague here does strictly less work — no row, no message — and the caller can
    /// read that off <c>GET /company/memberships</c> anyway. What must not differ is the throttle,
    /// or the arm becomes readable off how long the NEXT request takes.
    /// </summary>
    [Fact]
    public async Task An_address_that_is_already_a_colleague_still_costs_a_throttle_count()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Trader);

        var throttle = new RecordingThrottle();
        using var host = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
                services.AddSingleton<ISignInThrottle>(throttle)));
        var client = await SignInThroughAsync(host, business.Members[0]);

        throttle.Reset();
        var response = await client.PostAsJsonAsync(
            Invitations, new CompanyInvitationRequest(business.Members[1].Email, "viewer"), Ct);

        response.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        throttle.Reset().ShouldBe(1);
    }

    /// <summary>
    /// Neither arm AWAITS the mail provider. Measured against a sender that blocks for five
    /// seconds: if the send were on the request path, the arm that sends would take five seconds
    /// and the arm that does not would take milliseconds — which is the exact shape
    /// <c>OutboundMailbox</c>'s remarks record measuring at 30307ms against 185ms before the queue
    /// existed.
    /// </summary>
    /// <remarks>
    /// A wall-clock assertion, deliberately, and the only one in this file. It is a COARSE
    /// threshold against a five-second block rather than a comparison of two round trips, so it
    /// cannot flake on a slow container: the gap it is looking for is three orders of magnitude
    /// wide.
    /// </remarks>
    [Fact]
    public async Task Neither_arm_waits_for_the_mail_provider()
    {
        var business = await Seed.SeedBusinessAsync(fourEyes: false, MembershipRole.Admin);

        using var blocking = new BlockingEmailSender(TimeSpan.FromSeconds(5));
        using var host = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IEmailSender>();
                services.AddSingleton<IEmailSender>(blocking);
            }));
        var client = await SignInThroughAsync(host, business.Members[0]);

        var stopwatch = Stopwatch.StartNew();
        var response = await client.PostAsJsonAsync(
            Invitations,
            new CompanyInvitationRequest($"{Guid.NewGuid():N}@nowhere.example", "trader"), Ct);
        stopwatch.Stop();

        response.StatusCode.ShouldBe(HttpStatusCode.Accepted);
        stopwatch.Elapsed.ShouldBeLessThan(
            TimeSpan.FromSeconds(3),
            "the sender is still blocked; a request that waited for it would be at five seconds. "
            + "OutboundMailbox.Enqueue is a channel write and returns whatever the provider is "
            + "doing - that independence is the property, not the speed");

        // And the send really was attempted, so this is not passing because nothing was queued.
        blocking.Entered.Wait(TimeSpan.FromSeconds(5)).ShouldBeTrue(
            "the background drain must have reached the sender; if it never did, this test would "
            + "pass with the enqueue deleted");
    }

    private async Task<int> CountMessagesAsync(string address, int before)
    {
        // The drain is a background service, so poll. One second is two orders of magnitude more
        // than a channel read and an in-memory sender need.
        for (var attempt = 0; attempt < 20; attempt++)
        {
            var seen = factory.Emails.Sent.Skip(before).Count(
                message => string.Equals(message.To, address, StringComparison.OrdinalIgnoreCase));
            if (seen > 0) return seen;
            await Task.Delay(50, Ct);
        }

        return 0;
    }

    private static async Task<HttpClient> SignInThroughAsync(
        WebApplicationFactory<PeakPower.Api.Customer.CustomerApiEntryPoint> host,
        MembershipFixture.Member member)
    {
        var client = host.CreateClient();
        var signIn = await client.PostAsJsonAsync(
            "/api/v1/auth/sign-in",
            new SignInRequest(member.Email, MembershipFixture.Password), Ct);
        signIn.StatusCode.ShouldBe(HttpStatusCode.OK);
        var body = await signIn.Content.ReadFromJsonAsync<SignInResponse>(Ct);
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", body!.AccessToken);
        return client;
    }

    /// <summary>Counts RecordFailure calls and delays nothing.</summary>
    private sealed class RecordingThrottle : ISignInThrottle
    {
        private int _failures;

        public TimeSpan DelayFor(string username, string source) => TimeSpan.Zero;

        public void RecordFailure(string username, string source) =>
            Interlocked.Increment(ref _failures);

        public void RecordSuccess(string username, string source)
        {
        }

        public int Reset() => Interlocked.Exchange(ref _failures, 0);
    }

    /// <summary>
    /// Stands in for a mail provider that has stopped answering. Signals <see cref="Entered"/> as
    /// soon as it is called, then blocks — so a test can prove the send was attempted AND that
    /// nothing on the request path waited for it.
    /// </summary>
    private sealed class BlockingEmailSender(TimeSpan block) : IEmailSender, IDisposable
    {
        public ManualResetEventSlim Entered { get; } = new(false);

        public async Task SendAsync(string to, string subject, string body, CancellationToken ct)
        {
            Entered.Set();
            await Task.Delay(block, CancellationToken.None);
        }

        public void Dispose() => Entered.Dispose();
    }
}
```

Add `using Microsoft.Extensions.DependencyInjection.Extensions;` for `RemoveAll`.

- [ ] **Step 2: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~IndistinguishableInvitationTests" 2>&1 | tail -30
```

Expected: build clean; PASS, all four. This probe describes behaviour Tasks 4 already shipped, so a
green first run is correct — the mutations below are what turn it into evidence.

- [ ] **Step 3: Mutate the three ways this endpoint could become an oracle**

**Mutation 1 — let the handler look outside its business.** In `IssueAsync`, change

```csharp
        var alreadyAMember = await db.CustomerAccounts
            .AsNoTracking()
            .AnyAsync(account => account.Email == address, cancellationToken);
```

to add `.IgnoreQueryFilters()` after `.AsNoTracking()`, and then make the branch skip the write for
**anybody with a login anywhere** — which is what a handler that wanted to compose two different
messages would need:

```csharp
        var alreadyAMember = await db.CustomerAccounts
            .AsNoTracking()
            .IgnoreQueryFilters()
            .AnyAsync(account => account.Email == address, cancellationToken);
```

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~IndistinguishableInvitationTests" 2>&1 | tail -40
```

Expected: **FAIL** on `A_login_elsewhere_and_no_login_at_all_commission_identical_work`, with
`work[1].ShouldBe(work[0], …)` reporting `(1, 1, 1)` against `(0, 0, 1)`. The address that has a
login at another business wrote no row and sent no message, which is a difference an attacker
measures. `A_login_elsewhere_and_no_login_at_all_are_identical_in_status_and_body` still passes —
both are still 202 with an empty body — which is the finding: **status and body alone do not close
this oracle**, and that is why contract §11 names timing as well. Restore.

**Mutation 2 — put the send back on the request path.** In `IssueAsync`, replace the
`outbound.Enqueue(address, subject, body)` call with a direct send. Add an
`IEmailSender emailSender` parameter to the handler and call
`await emailSender.SendAsync(address, subject, body, cancellationToken);`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~Neither_arm_waits_for_the_mail_provider" 2>&1 | tail -20
```

Expected: **FAIL** on
`stopwatch.Elapsed.ShouldBeLessThan(TimeSpan.FromSeconds(3), …)` reporting roughly five seconds.
Restore the `Enqueue` and remove the parameter.

**Mutation 3 — move the throttle inside the branch.** Cut the three throttle lines and paste them
inside `if (!alreadyAMember) { … }`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~An_address_that_is_already_a_colleague_still_costs" 2>&1 | tail -20
```

Expected: **FAIL** on `throttle.Reset().ShouldBe(1)` reporting `0`. Restore, then run the whole
file and the invitation tests together:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform diff -- \
  src/Hosts/PeakPower.Api.Customer/Portal/InvitationEndpoints.cs
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~Invitation" 2>&1 | tail -20
```

Expected: the diff is empty (the file is committed and unmodified); PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform add \
  tests/PeakPower.Integration.Tests/Portal/IndistinguishableInvitationTests.cs
git -C /Users/thinhhuynh/PeakPower/peakpower-platform commit -m "test(portal): shared contract section 11's indistinguishable-invite probe

Status, body and timing, and the throttle counts both. Timing is asserted as WORK - the
same row, the same enqueue, the same throttle count - which is SignInConstantWorkTests'
rule: a wall-clock comparison of two round trips measures the throttle and the scheduler,
not the handler. The one stopwatch assertion is a coarse threshold against a sender that
blocks for five seconds, which is the exact failure OutboundMailbox's remarks record at
30307ms against 185ms.

Verified by mutation, three ways. IgnoreQueryFilters on the membership lookup - what a
handler wanting two different message texts would need - makes the address with a login
elsewhere write no row and send nothing, and ONLY the work assertion notices: status and
body stay identical, which is why the contract names timing separately. Putting the send
back on the request path takes the response to five seconds. Moving the throttle inside the
branch drops the colleague arm's count to zero.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: The concurrency probe — two admins removing each other

Contract §11: *"Two admins removing each other: exactly one succeeds, the business never reaches
zero admins."* Design §10 spells the arrangement: *"Two admins of a four-eyes business removing
each other simultaneously: exactly one succeeds, the business keeps two admins, and neither
transaction leaves it at zero."*

**The arrangement is three admins, and it has to be.** A four-eyes business's floor is two. With
two admins, both removals are refused sequentially and the race proves nothing. With **three**,
each removal is individually legal — each caller reads three and 3 − 1 ≥ 2 — so without
serialisation both commit and the business lands on **one**, below its floor. With `SELECT … FOR
UPDATE` the loser blocks, re-evaluates under READ COMMITTED, sees the winner's `removed_at`, counts
two, and is refused. Exactly one succeeds; the business keeps two admins. That is design §10's
sentence, which only parses on three.

**Files:**
- Test: `/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/MembershipConcurrencyTests.cs` (create)

**Interfaces:**
- Consumes: `MembershipFixture` (Task 4);
  `DELETE /api/v1/company/memberships/{accountId:guid}` (Task 8);
  `MembershipEndpoints.LockAdminsAsync` (Task 7, exercised through the endpoint).
- Produces: nothing. This is a probe.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-platform/tests/PeakPower.Integration.Tests/Portal/MembershipConcurrencyTests.cs`:

```csharp
using System.Net;
using Microsoft.EntityFrameworkCore;
using PeakPower.Domain.Customers;
using Shouldly;
using Xunit;

namespace PeakPower.Integration.Tests.Portal;

/// <summary>
/// Shared contract §11's <b>Concurrency</b> probe: two admins removing each other, exactly one
/// succeeds, and the business never reaches zero admins.
/// </summary>
/// <remarks>
/// <para>
/// <b>Three admins, not two, and the arrangement is the whole test.</b> A four-eyes business's
/// floor is two (design decision 7). With two admins both removals are refused sequentially and
/// the race proves nothing at all. With three, each removal is individually legal — each caller
/// reads three, and 3 − 1 ≥ 2 — so without serialisation both commit and the business lands on
/// ONE, below its own floor. That is the state design §6.4 says <c>[F13-R41]</c> forbids repairing
/// with a "first account is admin" rule, which is why it must not be reachable in the first place.
/// </para>
/// <para>
/// <b>What makes it safe is <c>SELECT … FOR UPDATE</c> inside the request's own transaction.</b>
/// <c>CustomerSessionMiddleware</c> opens that transaction for every authenticated request and
/// commits after the handler returns, so the lock, the count, the <c>removed_at</c> write and the
/// audit row are one atomic act. The loser blocks on the lock, re-evaluates under READ COMMITTED
/// once the winner commits, sees the winner's <c>removed_at</c>, counts two and is refused.
/// </para>
/// <para>
/// <b>Both requests are issued from separate <see cref="HttpClient"/>s on separate sessions</b>, so
/// they land on separate connections and separate transactions. Two calls on one client would be
/// serialised by the client itself and would test nothing.
/// </para>
/// </remarks>
public sealed class MembershipConcurrencyTests(CustomerApiFactory factory)
    : IClassFixture<CustomerApiFactory>
{
    private const string Memberships = "/api/v1/company/memberships";

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private MembershipFixture Seed => new(factory);

    [Fact]
    public async Task Two_admins_removing_each_other_leave_the_four_eyes_business_with_two()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: true, MembershipRole.Admin, MembershipRole.Admin, MembershipRole.Admin);

        var first = await Seed.SignInAsync(business.Members[0]);
        var second = await Seed.SignInAsync(business.Members[1]);

        // Started together and awaited together. The lock is what decides the order, not this.
        var firstRemovesSecond = first.DeleteAsync(
            $"{Memberships}/{business.Members[1].AccountId}", Ct);
        var secondRemovesFirst = second.DeleteAsync(
            $"{Memberships}/{business.Members[0].AccountId}", Ct);

        var responses = await Task.WhenAll(firstRemovesSecond, secondRemovesFirst);

        var succeeded = responses.Count(r => r.StatusCode == HttpStatusCode.NoContent);
        var refused = responses.Count(r => r.StatusCode == HttpStatusCode.Conflict);

        succeeded.ShouldBe(
            1,
            "exactly one removal may commit: with three admins and a floor of two, each is "
            + "individually legal, so it is the lock and nothing else that stops both");
        refused.ShouldBe(
            1,
            $"the other must be REFUSED, not merely lost. Statuses: "
            + $"{string.Join(", ", responses.Select(r => r.StatusCode))}");

        await using var db = factory.CreateOwnerDbContext();
        var admins = await db.CustomerMemberships.CountAsync(
            m => m.CustomerId == business.CustomerId
              && m.Role == MembershipRole.Admin
              && m.RemovedAt == null, Ct);

        admins.ShouldBe(
            2,
            "the business keeps its four-eyes floor. Design §10: 'exactly one succeeds, the "
            + "business keeps two admins, and neither transaction leaves it at zero'");
    }

    /// <summary>
    /// The ordinary-business twin: floor one, two admins, both removing the other. Exactly one
    /// succeeds and one admin is left — which is the floor, not an accident of ordering.
    /// </summary>
    [Fact]
    public async Task Two_admins_removing_each_other_leave_an_ordinary_business_with_one()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: false, MembershipRole.Admin, MembershipRole.Admin);

        var first = await Seed.SignInAsync(business.Members[0]);
        var second = await Seed.SignInAsync(business.Members[1]);

        var responses = await Task.WhenAll(
            first.DeleteAsync($"{Memberships}/{business.Members[1].AccountId}", Ct),
            second.DeleteAsync($"{Memberships}/{business.Members[0].AccountId}", Ct));

        responses.Count(r => r.StatusCode == HttpStatusCode.NoContent).ShouldBe(1);
        responses.Count(r => r.StatusCode == HttpStatusCode.Conflict).ShouldBe(1);

        await using var db = factory.CreateOwnerDbContext();
        (await db.CustomerMemberships.CountAsync(
            m => m.CustomerId == business.CustomerId
              && m.Role == MembershipRole.Admin
              && m.RemovedAt == null, Ct))
            .ShouldBe(1, "the business is never left with zero administrators");
    }

    /// <summary>
    /// The same race on the PATCH. A demotion takes an admin away exactly as a removal does, and a
    /// floor guarded on one verb and not the other is a floor with a door in it.
    /// </summary>
    [Fact]
    public async Task Two_admins_demoting_each_other_leave_the_four_eyes_business_with_two()
    {
        var business = await Seed.SeedBusinessAsync(
            fourEyes: true, MembershipRole.Admin, MembershipRole.Admin, MembershipRole.Admin);

        var first = await Seed.SignInAsync(business.Members[0]);
        var second = await Seed.SignInAsync(business.Members[1]);

        var body = new PeakPower.Contracts.Customer.Portal.MembershipRoleChangeRequest("trader");

        var responses = await Task.WhenAll(
            System.Net.Http.Json.HttpClientJsonExtensions.PatchAsJsonAsync(
                first, $"{Memberships}/{business.Members[1].AccountId}", body, Ct),
            System.Net.Http.Json.HttpClientJsonExtensions.PatchAsJsonAsync(
                second, $"{Memberships}/{business.Members[0].AccountId}", body, Ct));

        responses.Count(r => r.StatusCode == HttpStatusCode.OK).ShouldBe(1);
        responses.Count(r => r.StatusCode == HttpStatusCode.Conflict).ShouldBe(1);

        await using var db = factory.CreateOwnerDbContext();
        (await db.CustomerMemberships.CountAsync(
            m => m.CustomerId == business.CustomerId
              && m.Role == MembershipRole.Admin
              && m.RemovedAt == null, Ct))
            .ShouldBe(2);
    }
}
```

- [ ] **Step 2: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test tests/PeakPower.Integration.Tests --nologo \
  --filter "FullyQualifiedName~MembershipConcurrencyTests" 2>&1 | tail -30
```

Expected: build clean; PASS, all three. Like Task 10, this describes behaviour Task 7 and Task 8
already shipped — the mutation below is what makes it evidence.

⚠ If a run reports `40P01: deadlock detected`, the `ORDER BY account_id` in `LockAdminsAsync` is
missing or was reordered. Two transactions locking the same set in the same order make one wait;
different orders make them deadlock. Fix the `ORDER BY`, do not retry.

- [ ] **Step 3: Mutate the lock away — the whole point of the probe**

In `MembershipEndpoints.LockAdminsAsync`, delete the `FOR UPDATE` line, leaving the `ORDER BY`. The
statement still counts the right rows; it simply stops serialising.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
for attempt in 1 2 3 4 5; do
  dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~MembershipConcurrencyTests" 2>&1 | tail -25
done
```

Expected: **FAIL** on
`Two_admins_removing_each_other_leave_the_four_eyes_business_with_two`, on
`succeeded.ShouldBe(1, …)` reporting `2` and then on `admins.ShouldBe(2, …)` reporting `1` — a
four-eyes business left with one admin, which is the state design §6.4 says must not be reachable.

⚠ **This is a RACE, so run it five times** (the loop above). A single green run without the lock
means the two requests happened not to overlap, not that the lock is unnecessary — the two
transactions must both be inside their check-then-act at the same instant for the bug to appear. If
all five runs pass with `FOR UPDATE` deleted, the requests are not actually concurrent: check that
the two `DeleteAsync` calls are started before either is awaited (`Task.WhenAll` over two already-
started tasks, not two sequential `await`s), and that the two clients are separate instances.

Restore `FOR UPDATE`, then prove the restore:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
grep -n 'FOR UPDATE' src/Hosts/PeakPower.Api.Customer/Portal/MembershipEndpoints.cs
for attempt in 1 2 3 4 5; do
  dotnet test tests/PeakPower.Integration.Tests --nologo \
    --filter "FullyQualifiedName~MembershipConcurrencyTests" 2>&1 | tail -8
done
```

Expected: one `FOR UPDATE` line; PASS, five runs out of five.

- [ ] **Step 4: Run everything, once, and read the result**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln --nologo 2>&1 | tail -30
tools/verify-migrator.sh
```

Expected: green. The platform half of this plan is complete.

- [ ] **Step 5: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
git -C /Users/thinhhuynh/PeakPower/peakpower-platform add \
  tests/PeakPower.Integration.Tests/Portal/MembershipConcurrencyTests.cs
git -C /Users/thinhhuynh/PeakPower/peakpower-platform commit -m "test(portal): shared contract section 11's concurrency probe

Three admins on a four-eyes business, not two, and the arrangement is the whole test: with
two, both removals are refused sequentially and the race proves nothing; with three, each
removal is individually legal, so it is the SELECT ... FOR UPDATE and nothing else that
stops both committing and leaving the business on one - below its own floor.

The PATCH twin is here too. A demotion takes an admin away exactly as a removal does, and a
floor guarded on one verb and not the other is a floor with a door in it.

Verified by mutation: deleting FOR UPDATE lets both removals succeed and leaves a four-eyes
business with one administrator. Run five times, because a single green run over a race
means the requests did not overlap rather than that the lock is unnecessary.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Regenerate the customer client, and add the five calls

The platform's OpenAPI has moved, so `npm run test` in the web repo currently fails on
`verify:clients` before a single spec runs. This task is what unblocks Tasks 13–15.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/libs/api-client-customer/src/generated/customer-schema.d.ts` (regenerated)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/libs/api-client-customer/src/lib/customer-api.types.ts`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/libs/api-client-customer/src/lib/customer-api.client.ts`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-web/libs/api-client-customer/src/lib/customer-api.client.spec.ts` (modify)

**Interfaces:**
- Consumes: the OpenAPI document Task 9 froze.
- Produces:
  - types `CompanyMember`, `CompanyMembershipsResponse`, `CompanyPendingInvitation`,
    `CompanyInvitationRequest`, `CompanyInvitationAcceptance`, `CompanyInvitationAccepted`,
    `MembershipRoleChangeRequest` — and **not** `MembershipRoleValue`, which plan 3 owns
    (contract §13.2)
  - `CustomerApiClient.companyMembershipsUrl()`, `.companyMembershipUrl(accountId)`,
    `.companyInvitationsUrl()`, `.companyInvitationAcceptUrl()`
  - `.getCompanyMemberships()`, `.changeMembershipRole(accountId, body)`,
    `.removeMembership(accountId)`, `.inviteToCompany(body)`, `.acceptInvitation(body)`

- [ ] **Step 1: Write the failing test**

Append to
`/Users/thinhhuynh/PeakPower/peakpower-web/libs/api-client-customer/src/lib/customer-api.client.spec.ts`,
inside the existing `describe`:

```ts
  it('builds the membership and invitation URLs', () => {
    expect(api.companyMembershipsUrl()).toBe('/api/v1/company/memberships');
    expect(api.companyMembershipUrl('a1')).toBe('/api/v1/company/memberships/a1');
    expect(api.companyInvitationsUrl()).toBe('/api/v1/company/invitations');
    expect(api.companyInvitationAcceptUrl()).toBe('/api/v1/company/invitations/accept');
  });

  it('reads the member list and the outstanding invitations from one call', () => {
    const payload: CompanyMembershipsResponse = { members: [], pendingInvitations: [] };
    let received: CompanyMembershipsResponse | undefined;
    api.getCompanyMemberships().subscribe((r) => (received = r));

    const req = http.expectOne('/api/v1/company/memberships');
    expect(req.request.method).toBe('GET');
    req.flush(payload);

    expect(received).toEqual(payload);
  });

  it('PATCHes a role and gets the whole list back', () => {
    const payload: CompanyMembershipsResponse = { members: [], pendingInvitations: [] };
    api.changeMembershipRole('a1', { membershipRole: 'admin' }).subscribe();

    const req = http.expectOne('/api/v1/company/memberships/a1');
    expect(req.request.method).toBe('PATCH');
    // Lowercase on the wire. The platform answers 400 for 'ADMIN', so a client that sent the
    // SCREAMING_SNAKE spelling every other enum in this contract uses would fail on every call.
    expect(req.request.body).toEqual({ membershipRole: 'admin' });
    req.flush(payload);
  });

  it('DELETEs a membership and expects no body back', () => {
    let completed = false;
    api.removeMembership('a1').subscribe({ complete: () => (completed = true) });

    const req = http.expectOne('/api/v1/company/memberships/a1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(completed).toBe(true);
  });

  it('POSTs an invitation and expects no body back', () => {
    let completed = false;
    api
      .inviteToCompany({ email: 'nieuw@example.nl', membershipRole: 'viewer' })
      .subscribe({ complete: () => (completed = true) });

    const req = http.expectOne('/api/v1/company/invitations');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      email: 'nieuw@example.nl',
      membershipRole: 'viewer',
    });
    req.flush(null, { status: 202, statusText: 'Accepted' });

    expect(completed).toBe(true);
  });

  it('POSTs an acceptance with only the token when there is nothing else to send', () => {
    const payload: CompanyInvitationAccepted = {
      customerId: 'c1',
      tradeName: 'Vandersteen Koeling',
      membershipRole: 'trader',
    };
    let received: CompanyInvitationAccepted | undefined;
    api.acceptInvitation({ token: 'abc' }).subscribe((r) => (received = r));

    const req = http.expectOne('/api/v1/company/invitations/accept');
    expect(req.request.method).toBe('POST');
    // ⚠ The three profile fields are OMITTED, not sent as null. The platform treats a missing
    // firstName and a null firstName identically, so this is a convention rather than a
    // requirement - but it keeps `{ token }` on the wire exactly as the shared contract writes it
    // for the case that needs nothing else.
    expect(req.request.body).toEqual({ token: 'abc' });
    req.flush(payload);

    expect(received).toEqual(payload);
  });

  it('POSTs an acceptance with a profile when the invitee has no login yet', () => {
    const payload: CompanyInvitationAccepted = {
      customerId: 'c1',
      tradeName: 'Vandersteen Koeling',
      membershipRole: 'trader',
    };
    api
      .acceptInvitation({
        token: 'abc',
        firstName: 'Jaap',
        lastName: 'de Wit',
        password: 'correct-horse-battery',
      })
      .subscribe();

    const req = http.expectOne('/api/v1/company/invitations/accept');
    expect(req.request.body).toEqual({
      token: 'abc',
      firstName: 'Jaap',
      lastName: 'de Wit',
      password: 'correct-horse-battery',
    });
    req.flush(payload);
  });
```

and add to the file's type imports: `CompanyInvitationAccepted`, `CompanyMembershipsResponse`.

- [ ] **Step 2: Regenerate the schema, then run and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npm run generate:clients > /tmp/t12-generate.txt 2>&1
cat /tmp/t12-generate.txt
git -C /Users/thinhhuynh/PeakPower/peakpower-web diff --stat \
  libs/api-client-customer/src/generated > /tmp/t12-schema.txt 2>&1
cat /tmp/t12-schema.txt
grep -n "CompanyMembershipsResponse\|CompanyInvitationRequest\|CompanyMemberDto" \
  libs/api-client-customer/src/generated/customer-schema.d.ts > /tmp/t12-schemas.txt 2>&1
cat /tmp/t12-schemas.txt
```

Expected: `customer-schema.d.ts` changes; the grep finds `CompanyMembershipsResponse`,
`CompanyInvitationRequest`, `CompanyInvitationAcceptance`, `CompanyInvitationAcceptedResponse`,
`CompanyMemberDto`, `CompanyInvitationDto` and `MembershipRoleChangeRequest`.

⚠ If `generate:clients` reports no change, the platform's `artifacts/openapi/customer.json` was not
rebuilt — run `dotnet build PeakPower.sln` in the platform repo first, since the document is emitted
at build.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test api-client-customer --watch=false 2>&1 | tail -30
```

⚠ If `api-client-customer` is not a project `ng test` knows, the client's specs run inside another
project's suite — read `angular.json` to find which, and use that name here and in every later
command in this task. `npx ng test customer-portal --watch=false` is the likely one.

Expected: **FAIL** to compile —
`error TS2339: Property 'companyMembershipsUrl' does not exist on type 'CustomerApiClient'`, and
`TS2304: Cannot find name 'CompanyMembershipsResponse'`.

- [ ] **Step 3: Add the type aliases**

In `/Users/thinhhuynh/PeakPower/peakpower-web/libs/api-client-customer/src/lib/customer-api.types.ts`,
after the entitlement aliases:

```ts
/**
 * The member-management screen's whole state: who acts for this company, and who has been asked.
 * Admin-only on the server, unlike `getCompanyEntitlements` — nothing renders off this except the
 * screen itself.
 */
export type CompanyMembershipsResponse = Schemas['CompanyMembershipsResponse'];
export type CompanyMember = Schemas['CompanyMemberDto'];
export type CompanyPendingInvitation = Schemas['CompanyInvitationDto'];
export type MembershipRoleChangeRequest = Schemas['MembershipRoleChangeRequest'];

export type CompanyInvitationRequest = Schemas['CompanyInvitationRequest'];
export type CompanyInvitationAcceptance = Schemas['CompanyInvitationAcceptance'];
export type CompanyInvitationAccepted = Schemas['CompanyInvitationAcceptedResponse'];
```

⚠ **Do NOT add `MembershipRoleValue` here.** Contract §13.2 makes plan 3 its single owner and
plan 3's Task 1 already exports it *from this very file* as
`export type MembershipRoleValue = CurrentAccount['membershipRole'];`. A second
`export type MembershipRoleValue = CompanyMember['membershipRole'];` in the same module is
`TS2300: Duplicate identifier`. The alias plan 3 exports is the same
`'admin' | 'trader' | 'viewer'` union — both are pulled off the document, not written out — so the
seven aliases above are all this task adds, and every consumer (Tasks 13–15) imports
`MembershipRoleValue` from `@peakpower-nl/api-client-customer` unchanged.

⚠ If plan 3's export is **absent**, stop: plan 3 is incomplete, and declaring a second copy here is
exactly what §13.2 forbids.

- [ ] **Step 4: Add the URLs and the five calls**

In `/Users/thinhhuynh/PeakPower/peakpower-web/libs/api-client-customer/src/lib/customer-api.client.ts`,
after `companyEntitlementsUrl()`:

```ts
  /**
   * ONE url for the collection: a GET that lists members and outstanding invitations, and nothing
   * else. Admin-only, unlike `companyEntitlementsUrl`'s GET — the navigation rail is gated on the
   * entitlement answer, so every colleague must be able to read that one; nothing renders off this
   * except the management screen itself.
   */
  companyMembershipsUrl(): string {
    return `${this.baseUrl}/company/memberships`;
  }
  /** One colleague's standing: PATCH changes it, DELETE ends it. */
  companyMembershipUrl(accountId: string): string {
    return `${this.companyMembershipsUrl()}/${accountId}`;
  }
  companyInvitationsUrl(): string {
    return `${this.baseUrl}/company/invitations`;
  }
  /**
   * Redeeming an invitation. ANONYMOUS on the server — the token is the credential, and the
   * invitee may hold no account at all — so this is the one company URL a caller with no session
   * may reach.
   */
  companyInvitationAcceptUrl(): string {
    return `${this.baseUrl}/company/invitations/accept`;
  }
```

and after `changeCompanyEntitlement`:

```ts
  // ── Memberships ─────────────────────────────────────────────────────────
  /** Who acts for this company, and who has been invited. ADMIN ONLY — a non-admin gets 403. */
  getCompanyMemberships(): Observable<CompanyMembershipsResponse> {
    return this.http.get<CompanyMembershipsResponse>(this.companyMembershipsUrl());
  }

  /**
   * Change what one colleague may do. ADMIN ONLY.
   *
   * The response is the WHOLE list rather than the one row that changed, so a caller replaces its
   * state instead of patching it — patching is where a screen and a server start disagreeing about
   * who is an admin, and on this screen that disagreement decides which controls are drawn.
   *
   * ⚠ 409 is the admin floor: the company must keep at least one administrator, or two if it has
   * four-eyes approval switched on. The message is the server's; do not re-derive it here, because
   * the floor depends on a flag this client cannot see.
   */
  changeMembershipRole(
    accountId: string,
    body: MembershipRoleChangeRequest,
  ): Observable<CompanyMembershipsResponse> {
    return this.http.patch<CompanyMembershipsResponse>(
      this.companyMembershipUrl(accountId),
      body,
    );
  }

  /**
   * Take somebody out of this company. ADMIN ONLY. 204 and no body — re-read the list.
   *
   * ⚠ The verb is DELETE and the server's SQL is an UPDATE: the membership row survives with
   * `removed_at` set, and re-inviting the same person restores it rather than creating a second.
   * That matters to a caller for one visible reason — their "member since" date does not reset.
   *
   * 409 has two causes: the admin floor, and removing your own membership, which is deliberately
   * out of scope. 404 means the account is not a member of this company, which is byte-identical
   * to an id that never existed.
   */
  removeMembership(accountId: string): Observable<void> {
    return this.http.delete<void>(this.companyMembershipUrl(accountId));
  }

  // ── Invitations ─────────────────────────────────────────────────────────
  /**
   * Ask an email address to join. ADMIN ONLY, and **202 whether or not anything happened** —
   * whether the address already has a PeakPower login is a fact the server refuses to reveal, so
   * there is no success/no-op distinction to branch on here. Do not add one.
   */
  inviteToCompany(body: CompanyInvitationRequest): Observable<void> {
    return this.http.post<void>(this.companyInvitationsUrl(), body);
  }

  /**
   * Redeem an invitation. ANONYMOUS — this is the one call in this client that runs with no
   * session and needs none.
   *
   * ⚠ Two-step by design. Post `{ token }` first: an address that already has a login is done, and
   * one that does not gets a 400 whose `errors` map names `firstName`, `lastName` and `password`.
   * Nothing is written on that refusal and the invitation stays usable, so the caller reveals those
   * three controls and posts again. There is no preflight route asking "does this address have a
   * login", deliberately: such a route would answer that question for anybody.
   */
  acceptInvitation(body: CompanyInvitationAcceptance): Observable<CompanyInvitationAccepted> {
    return this.http.post<CompanyInvitationAccepted>(this.companyInvitationAcceptUrl(), body);
  }
```

Add the seven new type names to the file's `import type { … }` list.

- [ ] **Step 5: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false 2>&1 | tail -30
```

Expected: PASS. (Substitute the project name step 2 established, if it differs.)

- [ ] **Step 6: Mutate the wire spelling**

In `changeMembershipRole`'s spec, nothing changes — mutate the **client**: in
`customer-api.client.ts`, wrap the body:

```ts
    return this.http.patch<CompanyMembershipsResponse>(
      this.companyMembershipUrl(accountId),
      { membershipRole: body.membershipRole.toUpperCase() },
    );
```

which is what somebody "fixing" the odd-one-out enum would write.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false 2>&1 | tail -30
```

Expected: **FAIL** on `PATCHes a role and gets the whole list back`:
`expected { membershipRole: 'ADMIN' } to deeply equal { membershipRole: 'admin' }`. The server
answers 400 for `ADMIN`, so this would have been a screen whose every role change failed. Restore.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web add \
  libs/api-client-customer/src/generated/customer-schema.d.ts \
  libs/api-client-customer/src/lib/customer-api.types.ts \
  libs/api-client-customer/src/lib/customer-api.client.ts \
  libs/api-client-customer/src/lib/customer-api.client.spec.ts
git -C /Users/thinhhuynh/PeakPower/peakpower-web commit -m "feat(api-client): the membership and invitation calls

Five methods over four URLs, regenerated from the platform's frozen document. membershipRole
is LOWERCASE on the wire, unlike every other enum in this contract - the shared contract
makes one spelling normative in the column and on the wire alike, and the server answers 400
for ADMIN.

acceptInvitation is two-step by design and the doc comment says why: post { token }, and an
address with no login gets a 400 naming firstName, lastName and password without spending
the invitation. There is no preflight route asking whether an address has a login, because
such a route would answer that for anybody.

Verified by mutation: upper-casing the role in changeMembershipRole - what somebody fixing
the odd-one-out enum would write - fails the body assertion, which is the screen's every
role change failing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: The member-management screen replaces the read-only account list

`[F01-R21]`'s *"the account list is read-only; changes go through PeakPower"* is one of design
§1.1's reversed rows. `CompanyPage`'s People card says so in terms today —
*"Four-eyes approval arrives in a later slice; nothing is gated on this yet. To invite or deactivate
someone, ask the PeakPower desk."* — and that sentence becomes false the moment Tasks 4–8 ship.

**Files:**
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/features/company/company-page.ts`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/shared/labels.ts`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/features/company/company-page.spec.ts` (modify)

**Interfaces:**
- Consumes: `CustomerApiClient.getCompanyMemberships()`, `.changeMembershipRole(accountId, body)`,
  `.removeMembership(accountId)` (Task 12); types `CompanyMember`,
  `CompanyMembershipsResponse` (Task 12); `MembershipRoleValue` (**plan 3**, contract §13.2);
  `AuthService.account()`.
- Produces: `membershipRoleLabel(MembershipRoleValue)`, `membershipRoleTone(MembershipRoleValue)`
  in `shared/labels.ts`.

⚠ **`AuthService.account()` after plan 2.** `CurrentAccountResponse` **loses `isAdmin`** and gains
`membershipRole` (contract §8). Every admin gate on this screen therefore reads
`this.auth.account()?.membershipRole === 'admin'`. Before writing a line, confirm it:

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
grep -rn "isAdmin\|membershipRole" apps/customer-portal/src libs/api-client-customer/src \
  > /tmp/t13-isadmin.txt 2>&1
cat /tmp/t13-isadmin.txt
```

Expected: no `isAdmin` anywhere in `apps/customer-portal/src` (**plan 3's Task 2** swept it) and
`membershipRole` present on `CurrentAccount`. ⚠ If `isAdmin` survives, **plan 3** is incomplete —
**stop and report it** rather than gating this screen on a field the contract removed. Plan 2
touches no web file at all; it is plan 3 that owns every web repair (contract §13.3).

- [ ] **Step 1: Write the failing test**

Replace the People-card portion of
`/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/features/company/company-page.spec.ts`.
The `PROFILE` constant and the profile tests stay; `account()` and every `/company/accounts`
expectation go. New fixture and cases:

```ts
import type {
  CompanyMember, CompanyMembershipsResponse, CompanyProfile,
} from '@peakpower-nl/api-client-customer';

function member(over: Partial<CompanyMember> = {}): CompanyMember {
  return {
    accountId: 'a1',
    firstName: 'J.',
    lastName: 'de Vries',
    jobTitle: 'Operations manager',
    email: 'j.devries@vandersteen.nl',
    membershipRole: 'admin',
    status: 'ACTIVE',
    joinedAt: '2026-01-14T09:00:00Z',
    lastLoginAt: '2026-08-20T14:25:00Z',
    ...over,
  };
}

function memberships(over: Partial<CompanyMembershipsResponse> = {}): CompanyMembershipsResponse {
  return { members: [member()], pendingInvitations: [], ...over };
}

/**
 * The signed-in account, which decides whether the controls are drawn at all. `membershipRole`
 * and NOT `isAdmin`: the shared contract took that boolean off CurrentAccountResponse, because
 * two sources of truth for one fact is how a demoted admin keeps admin rights for fifteen minutes.
 */
function signedInAs(membershipRole: 'admin' | 'trader' | 'viewer') {
  // The seam every customer-portal spec already uses. Verified against
  // apps/customer-portal/src/app/features/entitlements/entitlements-page.spec.ts:121,138 —
  // `tokens = TestBed.inject(AccessTokenStore)` then `tokens.set('the-token', account)` —
  // and against access-token.store.ts:22, `set(token: string, account: CurrentAccount): void`.
  TestBed.inject(AccessTokenStore).set('the-token', {
    accountId: 'a1',
    customerId: 'c1',
    firstName: 'J.',
    lastName: 'de Vries',
    email: 'j.devries@vandersteen.nl',
    membershipRole,
    memberships: [{ customerId: 'c1', tradeName: 'Vandersteen Koeling', membershipRole }],
  });
}
```

Add `import { AccessTokenStore } from '../../auth/access-token.store';` beside the other imports.

⚠ **Note what this fixture proves about plan 1's sweep.** The `ADMIN` fixture in
`entitlements-page.spec.ts:17-23` still ends `isAdmin: true`. That field is gone from
`CurrentAccount` after plan 1, so that spec — and every other spec carrying a `CurrentAccount`
literal — stops compiling until plan 3's sweep lands. This task therefore runs **after** plan 3,
never beside it.

The cases:

```ts
  it('lists the members with their role, not an admin flag', async () => {
    const fixture = await render();
    await load(fixture, memberships({
      members: [
        member(),
        member({
          accountId: 'a2', firstName: 'R.', lastName: 'Smit',
          membershipRole: 'trader', status: 'ACTIVE', lastLoginAt: null,
        }),
      ],
    }));

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('de Vries');
    expect(text).toContain('Administrator');
    expect(text).toContain('Trader');
    expect(text).toContain('Never signed in');
  });

  it('says nothing about asking the PeakPower desk to invite somebody', async () => {
    const fixture = await render();
    await load(fixture, memberships());

    // [F01-R21] is reversed by design §1.1. Leaving that sentence up beside working controls is
    // worse than having no sentence: it tells a customer the buttons in front of them do not work.
    expect(fixture.nativeElement.textContent).not.toContain('ask the PeakPower desk');
    expect(fixture.nativeElement.textContent).not.toContain('Four-eyes approval arrives');
  });

  it('draws the role control and the remove control for an admin only', async () => {
    const fixture = await render();
    signedInAs('admin');
    await load(fixture, memberships({
      members: [member(), member({ accountId: 'a2', membershipRole: 'trader' })],
    }));

    expect(fixture.nativeElement.querySelectorAll('select[data-role-for]')).toHaveLength(2);
    expect(fixture.nativeElement.querySelectorAll('button[data-remove-for]')).toHaveLength(1);
  });

  it('draws no control at all for a colleague who is not an admin', async () => {
    const fixture = await render();
    signedInAs('trader');
    await load(fixture, memberships({
      members: [member(), member({ accountId: 'a2', membershipRole: 'trader' })],
    }));

    // The server would answer 403, so a control here would be a button that always fails. The
    // screen and the server agree, which is the same rule EntitlementsPage already follows.
    expect(fixture.nativeElement.querySelector('select[data-role-for]')).toBeNull();
    expect(fixture.nativeElement.querySelector('button[data-remove-for]')).toBeNull();
  });

  /**
   * An admin cannot remove themselves — design §8 puts leaving out of scope and the server answers
   * 409 — so the control is absent rather than present and doomed.
   */
  it('draws no remove control against the signed-in admin themselves', async () => {
    const fixture = await render();
    signedInAs('admin');
    await load(fixture, memberships({
      members: [member({ accountId: 'a1' }), member({ accountId: 'a2', membershipRole: 'viewer' })],
    }));

    const removes = [...fixture.nativeElement.querySelectorAll('button[data-remove-for]')];
    expect(removes.map((b: HTMLElement) => b.getAttribute('data-remove-for'))).toEqual(['a2']);
  });

  it('PATCHes the new role and replaces the list from the response', async () => {
    const fixture = await render();
    signedInAs('admin');
    await load(fixture, memberships({
      members: [member(), member({ accountId: 'a2', membershipRole: 'viewer' })],
    }));

    const select: HTMLSelectElement =
      fixture.nativeElement.querySelector('select[data-role-for="a2"]');
    select.value = 'trader';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    const req = http.expectOne('/api/v1/company/memberships/a2');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ membershipRole: 'trader' });
    req.flush(memberships({
      members: [member(), member({ accountId: 'a2', membershipRole: 'trader' })],
    }));
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Trader');
  });

  it('DELETEs a membership and re-reads the list', async () => {
    const fixture = await render();
    signedInAs('admin');
    await load(fixture, memberships({
      members: [member(), member({ accountId: 'a2', membershipRole: 'viewer' })],
    }));

    fixture.nativeElement.querySelector('button[data-remove-for="a2"]').click();
    await fixture.whenStable();

    const remove = http.expectOne('/api/v1/company/memberships/a2');
    expect(remove.request.method).toBe('DELETE');
    remove.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();

    // 204 carries no body, so the screen has to ask again. Patching local state instead is where
    // a screen and a server start disagreeing about who is an admin - and on this screen that
    // disagreement decides which controls are drawn.
    http.expectOne('/api/v1/company/memberships').flush(memberships());
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelectorAll('[ppGridRow]')).toHaveLength(1);
  });

  /**
   * The admin floor. The message is the SERVER's - the floor depends on four_eyes_enabled, which
   * this client cannot see - so the screen prints what it was told rather than re-deriving a rule
   * it does not have the input for.
   */
  it('prints the servers own words when the admin floor refuses a removal', async () => {
    const fixture = await render();
    signedInAs('admin');
    await load(fixture, memberships({
      members: [member(), member({ accountId: 'a2', membershipRole: 'admin' })],
    }));

    fixture.nativeElement.querySelector('button[data-remove-for="a2"]').click();
    await fixture.whenStable();

    http.expectOne('/api/v1/company/memberships/a2').flush(
      { detail: 'This company must keep at least 2 administrators.' },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent)
      .toContain('This company must keep at least 2 administrators.');
  });

  it('lists an outstanding invitation with its expiry', async () => {
    const fixture = await render();
    signedInAs('admin');
    await load(fixture, memberships({
      pendingInvitations: [{
        id: 'i1',
        email: 'wachtend@example.nl',
        membershipRole: 'viewer',
        invitedAt: '2026-09-10T12:00:00Z',
        expiresAt: '2026-09-24T12:00:00Z',
      }],
    }));

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('wachtend@example.nl');
    expect(text).toContain('Viewer');
    // en-US, through formatProductDateTime - the one formatter both portals share.
    expect(text).toContain('Sep 24, 2026');
  });
```

and change `load` to flush the new endpoint:

```ts
  async function load(
    fixture: Awaited<ReturnType<typeof render>>,
    body: CompanyMembershipsResponse,
  ) {
    http.expectOne('/api/v1/company').flush(PROFILE);
    http.expectOne('/api/v1/company/memberships').flush(body);
    await fixture.whenStable();
  }
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false 2>&1 | tail -40
```

Expected: **FAIL** — `http.expectOne('/api/v1/company/memberships')` throws
`Expected one matching request for criteria "Match URL: /api/v1/company/memberships", found none.`
The page still calls `/api/v1/company/accounts`, and `afterEach(() => http.verify())` reports that
as an unexpected open request.

- [ ] **Step 3: Add the two labels**

In `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/shared/labels.ts`, after
`accountStatusTone`:

```ts
/**
 * The membership role, in the product's sentence case.
 *
 * ⚠ An exhaustive switch with NO `default` arm, like every other mapping in this file: the
 * exhaustiveness comes from the root tsconfig's `noImplicitReturns`, so a fourth role added to the
 * contract is a compile error here rather than lowercase text in front of a customer.
 *
 * "Administrator" and not "Admin": the abbreviation reads as a job title, and this is a permission.
 */
export function membershipRoleLabel(value: MembershipRoleValue): string {
  switch (value) {
    case 'admin':
      return 'Administrator';
    case 'trader':
      return 'Trader';
    case 'viewer':
      return 'Viewer';
  }
}

/**
 * Admin is the only role that gates anything today, so it is the only one that carries a tone.
 * Trader and viewer are recorded and displayed and behave identically (design §3.3), and giving
 * them distinct colours would imply a difference the platform does not have.
 */
export function membershipRoleTone(value: MembershipRoleValue): PpTone {
  switch (value) {
    case 'admin':
      return 'info';
    case 'trader':
      return 'neutral';
    case 'viewer':
      return 'neutral';
  }
}
```

Add `MembershipRoleValue` to the file's type imports.

- [ ] **Step 4: Rewrite the People card**

In `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/features/company/company-page.ts`:

Replace the class doc comment's third paragraph (the `[DEC-71]` one) with:

```ts
/**
 * … (keep the first two paragraphs) …
 *
 * The People card is a MANAGEMENT surface now, not a view. [F01-R21]'s "the account list is
 * read-only; changes go through PeakPower" is one of the rows design §1.1 reverses, and the
 * sentence that used to sit under this table said exactly that — leaving it up beside working
 * controls would tell a customer the buttons in front of them do not work.
 *
 * The controls are drawn for an ADMIN ONLY, which is the API's own rule rather than a decoration
 * on top of it: all three membership routes carry the CompanyAdmin policy, so a non-admin who
 * pressed one would get a 403. Nobody is offered a button that cannot work — the same rule
 * EntitlementsPage already follows.
 */
```

Replace the imports and the People block:

```ts
import type {
  Address, CompanyMember, CompanyMembershipsResponse, CompanyProfile, MembershipRoleValue,
} from '@peakpower-nl/api-client-customer';
import { PpBadge, PpButton, PpCard, PpGridHead, PpGridRow, PpGridTable, PpLoading,
         formatProductDate, formatProductDateTime } from '@peakpower-nl/shared-ui';

import { AuthService } from '../../auth/auth.service';
import { GENERIC_FAILURE, OFFLINE_FAILURE, isOffline } from '../../shared/apply-problem-details';
import { membershipRoleLabel, membershipRoleTone, customerStatusLabel } from '../../shared/labels';

const NO_MEMBERS: CompanyMembershipsResponse = { members: [], pendingInvitations: [] };

/** The three roles, in the order the contract declares them, for the select. */
const ROLES: readonly MembershipRoleValue[] = ['admin', 'trader', 'viewer'];
```

The template's People section:

```html
      @if (membersError(); as failure) {
        <pp-load-error what="the people who act for this company" [error]="failure" />
      } @else if (membersLoading()) {
        <pp-card [headingLevel]="2" heading="People">
          <pp-loading label="Loading the people who act for this company…" />
        </pp-card>
      } @else {
        <pp-card
          [headingLevel]="2"
          heading="People"
          subtitle="Everyone who acts for this company, and what they may do"
        >
          @if (writeError(); as message) {
            <p class="write-error" role="alert">{{ message }}</p>
          }

          <pp-grid-table columns="minmax(0, 1.4fr) 1.6fr 1fr 1fr auto" density="dense">
            <div ppGridHead>
              <div>NAME</div>
              <div>EMAIL</div>
              <div>ROLE</div>
              <div>LAST SIGN-IN</div>
              <div></div>
            </div>

            @for (person of members(); track person.accountId) {
              <div ppGridRow>
                <div class="cell-name">
                  <span>{{ person.firstName }} {{ person.lastName }}</span>
                  @if (person.jobTitle) {
                    <span class="job">{{ person.jobTitle }}</span>
                  }
                </div>
                <div class="mono">{{ person.email }}</div>
                <div>
                  @if (canManage()) {
                    <select
                      [attr.data-role-for]="person.accountId"
                      [attr.aria-label]="'Role for ' + person.firstName + ' ' + person.lastName"
                      [value]="person.membershipRole"
                      [disabled]="busy() !== null"
                      (change)="changeRole(person, $any($event.target).value)"
                    >
                      @for (role of roles; track role) {
                        <option [value]="role">{{ roleLabel(role) }}</option>
                      }
                    </select>
                  } @else {
                    <pp-badge [tone]="roleTone(person)">{{ roleLabel(person.membershipRole) }}</pp-badge>
                  }
                </div>
                <div>{{ lastLogin(person) }}</div>
                <div>
                  @if (canManage() && !isMe(person)) {
                    <pp-button
                      variant="secondary"
                      size="sm"
                      [disabled]="busy() !== null"
                      (click)="remove(person)"
                    >
                      <span [attr.data-remove-for]="person.accountId">Remove</span>
                    </pp-button>
                  }
                </div>
              </div>
            }
          </pp-grid-table>

          @if (pending().length > 0) {
            <div class="pending">
              <div class="pending__title">Invited, not yet accepted</div>
              @for (invitation of pending(); track invitation.id) {
                <div class="pending__row">
                  <span class="mono">{{ invitation.email }}</span>
                  <span>{{ roleLabel(invitation.membershipRole) }}</span>
                  <span class="pending__when">Expires {{ expiry(invitation.expiresAt) }}</span>
                </div>
              }
            </div>
          }
        </pp-card>
      }
```

⚠ `data-remove-for` sits on a `<span>` **inside** `pp-button`, not on the component: `PpButton`
renders its own `<button>` and does not forward arbitrary attributes, and the spec's
`querySelector('button[data-remove-for="a2"]')` would find nothing. **Read `pp-button.ts` before
writing this** and put the attribute where the spec can actually reach it — if `PpButton` proxies
host attributes onto its inner control, put it on the component and simplify the spec's selector
to match. Either way the spec and the template must agree, and the spec is the one that says what a
user can click.

The styles to add (real tokens only):

```css
    .write-error {
      margin: 0 0 12px; padding: 10px 12px; border-radius: 8px;
      border: 1px solid var(--pp-red-border); background: var(--pp-red-bg);
      color: var(--pp-red-text); font-size: var(--text-xs); line-height: 1.5;
    }
    select {
      font: inherit; font-size: var(--text-xs); padding: 4px 8px;
      border: 1px solid var(--pp-border); border-radius: 6px;
      background: var(--pp-surface); color: var(--pp-text-heading);
    }
    .pending {
      margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--pp-border);
    }
    .pending__title {
      font-size: var(--text-2xs); font-weight: var(--weight-bold);
      letter-spacing: 0.04em; text-transform: uppercase; color: var(--pp-text-body);
      margin-bottom: 8px;
    }
    .pending__row {
      display: flex; gap: 12px; align-items: baseline;
      padding: 6px 0; font-size: var(--text-xs); color: var(--pp-text-body);
    }
    .pending__when { color: var(--pp-text-faint); margin-left: auto; }
```

⚠ **Check every token against
`libs/shared-ui/src/styles/*.css` before committing** — `--pp-red-border`, `--pp-red-bg`,
`--pp-red-text`, `--weight-bold` and `--text-2xs` must all be declared there.
`design-tokens.spec.ts` fails by file and token name, and an undeclared property renders as nothing
with every DOM assertion still green.

The class body:

```ts
  private readonly auth = inject(AuthService);

  protected readonly roles = ROLES;

  /**
   * Only an admin may manage, because only an admin may PATCH or DELETE. The role is on the
   * account the session already carries, so this costs no request.
   *
   * ⚠ `membershipRole` and not `isAdmin`: the shared contract took that boolean off
   * CurrentAccountResponse, because two sources of truth for one fact is how a demoted admin
   * keeps admin rights for fifteen minutes.
   */
  readonly canManage = computed(() => this.auth.account()?.membershipRole === 'admin');

  private readonly membersFailure = signal<unknown>(null);
  readonly membersError = this.membersFailure.asReadonly();

  /** The accountId currently being written, so the screen cannot start two changes at once. */
  readonly busy = signal<string | null>(null);
  readonly writeError = signal<string | null>(null);

  private readonly membersBusy = signal(true);
  protected readonly membersLoading = computed(
    () => this.membersBusy() && this.membershipsState().members.length === 0,
  );

  /**
   * The list, replaced wholesale by every write's own answer.
   *
   * A writable signal rather than a `toSignal` of one request: a PATCH answers with the WHOLE list
   * and a DELETE answers 204 and needs a re-read, and both have to land in the same place the
   * first load did. Patching a row locally instead is where a screen and a server start
   * disagreeing about who is an admin — and on this screen that disagreement decides which
   * controls are drawn.
   */
  private readonly membershipsState = signal<CompanyMembershipsResponse>(NO_MEMBERS);

  readonly members = computed(() => this.membershipsState().members);
  readonly pending = computed(() => this.membershipsState().pendingInvitations);

  constructor() {
    this.company.load().subscribe({ error: () => undefined });
    this.reload();
  }

  private reload(): void {
    this.membersBusy.set(true);
    this.api.getCompanyMemberships().subscribe({
      next: (body) => {
        this.membershipsState.set(body);
        this.membersBusy.set(false);
      },
      error: (error: unknown) => {
        this.membersFailure.set(error);
        this.membersBusy.set(false);
      },
    });
  }

  isMe(person: CompanyMember): boolean {
    return this.auth.account()?.accountId === person.accountId;
  }

  roleLabel(value: MembershipRoleValue): string {
    return membershipRoleLabel(value);
  }

  roleTone(person: CompanyMember) {
    return membershipRoleTone(person.membershipRole);
  }

  expiry(value: string): string {
    return formatProductDate(value);
  }

  changeRole(person: CompanyMember, membershipRole: string): void {
    if (this.busy() !== null || membershipRole === person.membershipRole) return;

    this.busy.set(person.accountId);
    this.writeError.set(null);
    this.api
      .changeMembershipRole(person.accountId, {
        membershipRole: membershipRole as MembershipRoleValue,
      })
      .subscribe({
        next: (body) => {
          this.membershipsState.set(body);
          this.busy.set(null);
        },
        error: (error: unknown) => {
          this.writeError.set(this.messageFor(error));
          this.busy.set(null);
          // The select is now showing a value the server refused. Re-read rather than reverting
          // by hand: the server's list is the only copy that is definitely right.
          this.reload();
        },
      });
  }

  remove(person: CompanyMember): void {
    if (this.busy() !== null || this.isMe(person)) return;

    this.busy.set(person.accountId);
    this.writeError.set(null);
    this.api.removeMembership(person.accountId).subscribe({
      next: () => {
        this.busy.set(null);
        // 204 carries no body, so the screen asks again.
        this.reload();
      },
      error: (error: unknown) => {
        this.writeError.set(this.messageFor(error));
        this.busy.set(null);
      },
    });
  }

  /**
   * The SERVER's sentence for a 409, and a generic one otherwise.
   *
   * The admin floor depends on `four_eyes_enabled`, which this client cannot see, so a message
   * composed here would have to guess whether the floor is one or two. Printing what the server
   * said is the only version that is right in both cases.
   */
  private messageFor(error: unknown): string {
    if (isOffline(error)) return OFFLINE_FAILURE;

    const detail = (error as { error?: { detail?: unknown } })?.error?.detail;
    return typeof detail === 'string' && detail.length > 0 ? detail : GENERIC_FAILURE;
  }
```

⚠ `formatProductDate` must exist in `@peakpower-nl/shared-ui`. Check
`libs/shared-ui/src/public-api.ts`; if only `formatProductDateTime` is exported, use that and adjust
the spec's expected string to match what it produces.

- [ ] **Step 5: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false 2>&1 | tail -40
npx ng test shared-ui --watch=false 2>&1 | tail -10
```

Expected: PASS, both. `design-tokens.spec.ts` runs inside `customer-portal` and is the one that
fails on an undeclared token, by file and name.

- [ ] **Step 6: Mutate the admin gate, then the reload**

**Mutation 1 — gate on the wrong thing.** Change `canManage` to `computed(() => true)`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false 2>&1 | tail -30
```

Expected: **FAIL** on `draws no control at all for a colleague who is not an admin`:
`expected null not to be null` — the trader is being offered a select and a Remove button that the
server answers 403 for.

Restore, then **Mutation 2 — patch locally instead of re-reading.** In `remove`, replace
`this.reload();` with

```ts
        this.membershipsState.update((state) => ({
          ...state,
          members: state.members.filter((m) => m.accountId !== person.accountId),
        }));
```

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false 2>&1 | tail -30
```

Expected: **FAIL** on `DELETEs a membership and re-reads the list`:
`Expected one matching request for criteria "Match URL: /api/v1/company/memberships", found none.`
The row disappears from the screen and the pending list, the roles and everything else the removal
may have changed stay stale. Restore.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web add \
  apps/customer-portal/src/app/features/company/company-page.ts \
  apps/customer-portal/src/app/features/company/company-page.spec.ts \
  apps/customer-portal/src/app/shared/labels.ts
git -C /Users/thinhhuynh/PeakPower/peakpower-web commit -m "feat(portal): the People card manages members instead of listing them

[F01-R21]'s read-only account list is one of the rows the design reverses, and the sentence
under the table said so in terms - leaving it up beside working controls would tell a
customer the buttons in front of them do not work.

The controls are drawn for an admin only, gated on membershipRole rather than a boolean the
shared contract took off CurrentAccountResponse, and never against the signed-in admin
themselves: removing your own membership is out of scope and the server answers 409.

Every write replaces the whole list from the server's own answer - the PATCH returns it and
the DELETE's 204 forces a re-read - because patching a row locally is where a screen and a
server start disagreeing about who is an admin, and on this screen that decides which
controls exist. A 409 prints the SERVER's sentence: the admin floor depends on a flag this
client cannot see.

Verified by mutation: opening the gate offers a trader controls the server answers 403 for,
and patching locally instead of re-reading leaves the pending list and every other role
stale.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: The invite form

Design §6.1 in one control: an address, a role, and one answer whatever happens.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/features/company/invite-form.ts`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/features/company/invite-form.spec.ts` (create)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/features/company/company-page.ts`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/features/company/company-page.spec.ts`

**Interfaces:**
- Consumes: `CustomerApiClient.inviteToCompany({ email, membershipRole })` (Task 12);
  `MembershipRoleValue` (**plan 3**, contract §13.2); `membershipRoleLabel` (Task 13);
  `applyProblemDetails(form, error)`, `GENERIC_FAILURE`, `OFFLINE_FAILURE`, `isOffline`.
- Produces: `InviteForm`, a standalone component with one `output<void>() invited`.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/features/company/invite-form.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, afterEach } from 'vitest';
import { provideCustomerApiTesting } from '@peakpower-nl/api-client-customer';

import { InviteForm } from './invite-form';

describe('InviteForm', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({ providers: [provideCustomerApiTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(InviteForm);
    await fixture.whenStable();
    return fixture;
  }

  afterEach(() => http.verify());

  function type(fixture: Awaited<ReturnType<typeof render>>, email: string, role?: string) {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[type="email"]');
    input.value = email;
    input.dispatchEvent(new Event('input'));

    if (role !== undefined) {
      const select: HTMLSelectElement = fixture.nativeElement.querySelector('select');
      select.value = role;
      select.dispatchEvent(new Event('change'));
    }
  }

  it('offers the three roles, viewer first', async () => {
    const fixture = await render();

    const options = [...fixture.nativeElement.querySelectorAll('option')]
      .map((o: HTMLOptionElement) => o.value);

    // Viewer FIRST and selected by default: the least a person can be. A form that defaults to
    // admin makes the dangerous choice the one you get by pressing enter.
    expect(options).toEqual(['viewer', 'trader', 'admin']);
    expect(fixture.nativeElement.querySelector('select').value).toBe('viewer');
  });

  it('POSTs the address and the role, lowercase', async () => {
    const fixture = await render();
    type(fixture, 'nieuw@example.nl', 'trader');

    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    const req = http.expectOne('/api/v1/company/invitations');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      email: 'nieuw@example.nl',
      membershipRole: 'trader',
    });
    req.flush(null, { status: 202, statusText: 'Accepted' });
  });

  /**
   * The 202 says nothing about whether the address had a login, whether a message was queued, or
   * whether the person was already a colleague — and the copy here must not invent any of it. It
   * says what we did, not what happened at the other end.
   */
  it('confirms that the invitation was sent without claiming anything about the address', async () => {
    const fixture = await render();
    type(fixture, 'nieuw@example.nl');

    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    http.expectOne('/api/v1/company/invitations')
      .flush(null, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('nieuw@example.nl');
    expect(text).not.toContain('new account');
    expect(text).not.toContain('already');
    expect(text).not.toContain('existing');
  });

  it('clears the address after a send, so a double press cannot invite twice', async () => {
    const fixture = await render();
    type(fixture, 'nieuw@example.nl');

    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    http.expectOne('/api/v1/company/invitations')
      .flush(null, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('input[type="email"]').value).toBe('');
  });

  it('puts a 400 under the field the server named', async () => {
    const fixture = await render();
    type(fixture, 'not-an-address');

    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    http.expectOne('/api/v1/company/invitations').flush(
      { errors: { email: ['Enter an email address. It must contain an @.'] } },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent)
      .toContain('Enter an email address. It must contain an @.');
  });

  it('sends nothing at all when the address is blank', async () => {
    const fixture = await render();

    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    // The ONE client-side rule this portal keeps: "required". Every other rule is the API's, and a
    // rule re-implemented in TypeScript is a rule that drifts from the one actually enforced.
    http.expectNone('/api/v1/company/invitations');
  });

  it('tells the caller it was invited so the list can be re-read', async () => {
    const fixture = await render();
    let invited = 0;
    fixture.componentInstance.invited.subscribe(() => (invited += 1));

    type(fixture, 'nieuw@example.nl');
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    http.expectOne('/api/v1/company/invitations')
      .flush(null, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();

    // The pending-invitations list on the parent screen is now one row out of date, and the parent
    // is the only thing that can fix it. 202 carries no body, so there is nothing to hand over.
    expect(invited).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false 2>&1 | tail -30
```

Expected: **FAIL** to compile —
`error TS2307: Cannot find module './invite-form' or its corresponding type declarations.`

- [ ] **Step 3: Write the component**

Create
`/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/features/company/invite-form.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CustomerApiClient } from '@peakpower-nl/api-client-customer';
import type { MembershipRoleValue } from '@peakpower-nl/api-client-customer';
import { PpButton } from '@peakpower-nl/shared-ui';

import { applyProblemDetails, GENERIC_FAILURE, OFFLINE_FAILURE, isOffline }
  from '../../shared/apply-problem-details';
import { PpFormField } from '../../shared/form-field';
import { membershipRoleLabel } from '../../shared/labels';

/**
 * Ask somebody to join this company.
 *
 * Admin-only, and the parent draws it only for an admin — the server carries the same rule as the
 * CompanyAdmin policy, so nobody is offered a control that answers 403.
 *
 * ⚠ **The answer is 202 whether or not anything happened**, and the copy under this form must
 * never imply otherwise. Whether the address already has a PeakPower login is a fact the server
 * deliberately refuses to reveal — telling anyone with a list of addresses which of them are
 * customers is the oracle the whole endpoint is shaped around — so "invitation sent" is the only
 * honest confirmation. It says what WE did, not what happened at the other end.
 */
@Component({
  selector: 'pp-invite-form',
  imports: [ReactiveFormsModule, PpButton, PpFormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()">
      <div class="row">
        <pp-form-field label="Email address" for="invite-email" [error]="emailError()">
          <input
            id="invite-email"
            type="email"
            autocomplete="off"
            formControlName="email"
            placeholder="colleague@company.nl"
          />
        </pp-form-field>

        <pp-form-field label="Role" for="invite-role" [error]="roleError()">
          <select id="invite-role" formControlName="membershipRole">
            @for (role of roles; track role) {
              <option [value]="role">{{ label(role) }}</option>
            }
          </select>
        </pp-form-field>

        <pp-button type="submit" variant="primary" size="sm" [disabled]="busy()">
          Send invitation
        </pp-button>
      </div>

      @if (failure(); as message) {
        <p class="msg msg--error" role="alert">{{ message }}</p>
      } @else if (sentTo(); as address) {
        <p class="msg msg--ok" role="status">
          Invitation sent to {{ address }}. It works once and expires in fourteen days.
        </p>
      }
    </form>
  `,
  styles: `
    :host { display: block; margin-bottom: 16px; }
    .row { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
    pp-form-field { flex: 1 1 220px; margin-bottom: 0; }
    select {
      width: 100%; box-sizing: border-box; font: inherit; font-size: var(--text-sm);
      padding: 9px 11px; border: 1px solid var(--pp-border); border-radius: 8px;
      background: var(--pp-surface); color: var(--pp-text-heading);
    }
    .msg { margin: 10px 0 0; font-size: var(--text-xs); line-height: 1.5; }
    .msg--ok { color: var(--pp-text-faint); }
    .msg--error { color: var(--pp-red-text); }
  `,
})
export class InviteForm {
  private readonly api = inject(CustomerApiClient);

  /**
   * The invitation landed. The parent's pending list is now one row out of date and the parent is
   * the only thing that can fix it — 202 carries no body, so there is nothing to hand over.
   */
  readonly invited = output<void>();

  /**
   * Viewer FIRST, and selected by default: the least a person can be. A form that defaults to
   * admin makes the dangerous choice the one you get by pressing enter, and this form has no
   * confirmation step.
   */
  protected readonly roles: readonly MembershipRoleValue[] = ['viewer', 'trader', 'admin'];

  readonly busy = signal(false);
  readonly failure = signal<string | null>(null);
  readonly sentTo = signal<string | null>(null);

  /**
   * `required` and nothing else. Every other rule is the API's — a rule re-implemented in
   * TypeScript is a rule that drifts from the one actually enforced — and `applyProblemDetails`
   * is how the server's own messages land under the right control.
   */
  readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    membershipRole: new FormControl<MembershipRoleValue>('viewer', { nonNullable: true }),
  });

  label(role: MembershipRoleValue): string {
    return membershipRoleLabel(role);
  }

  emailError(): string {
    return this.form.controls.email.errors?.['server'] ?? '';
  }

  roleError(): string {
    return this.form.controls.membershipRole.errors?.['server'] ?? '';
  }

  submit(): void {
    if (this.busy() || this.form.invalid) return;

    const email = this.form.controls.email.value.trim();
    if (email.length === 0) return;

    this.busy.set(true);
    this.failure.set(null);
    this.sentTo.set(null);

    this.api
      .inviteToCompany({ email, membershipRole: this.form.controls.membershipRole.value })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.sentTo.set(email);
          // Cleared, so pressing the button again cannot invite the same address twice. Resetting
          // the ROLE too would be worse: an admin adding three viewers would re-pick it each time.
          this.form.controls.email.setValue('');
          this.invited.emit();
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.failure.set(
            isOffline(error) ? OFFLINE_FAILURE : applyProblemDetails(this.form, error) ?? '',
          );
          // applyProblemDetails returns null when every message found a control, and the empty
          // string above is then falsy - so `@if (failure(); as message)` draws nothing and the
          // per-field message under the input is the whole answer.
        },
      });
  }
}
```

⚠ `applyProblemDetails` files server messages under `SERVER_ERROR_KEY` (`'server'`) on each named
control. Confirm that constant and the errors shape in
`apps/customer-portal/src/app/shared/apply-problem-details.ts` before writing `emailError()`.

- [ ] **Step 4: Draw it on the company page**

In `company-page.ts`, add `InviteForm` to `imports`, and inside the People card, above the table:

```html
          @if (canManage()) {
            <pp-invite-form (invited)="reloadMembers()" />
          }
```

and expose the reload:

```ts
  /** The invite form landed a 202; the pending list is one row out of date. */
  reloadMembers(): void {
    this.reload();
  }
```

Add to `company-page.spec.ts`:

```ts
  it('offers the invite form to an admin and to nobody else', async () => {
    const fixture = await render();
    signedInAs('admin');
    await load(fixture, memberships());
    expect(fixture.nativeElement.querySelector('pp-invite-form')).not.toBeNull();

    TestBed.resetTestingModule();

    const other = await render();
    signedInAs('viewer');
    await load(other, memberships());
    expect(other.nativeElement.querySelector('pp-invite-form')).toBeNull();
  });

  it('re-reads the list when an invitation is sent', async () => {
    const fixture = await render();
    signedInAs('admin');
    await load(fixture, memberships());

    const form: HTMLInputElement =
      fixture.nativeElement.querySelector('pp-invite-form input[type="email"]');
    form.value = 'nieuw@example.nl';
    form.dispatchEvent(new Event('input'));
    fixture.nativeElement.querySelector('pp-invite-form form')
      .dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    http.expectOne('/api/v1/company/invitations')
      .flush(null, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();

    http.expectOne('/api/v1/company/memberships').flush(memberships({
      pendingInvitations: [{
        id: 'i1', email: 'nieuw@example.nl', membershipRole: 'viewer',
        invitedAt: '2026-09-10T12:00:00Z', expiresAt: '2026-09-24T12:00:00Z',
      }],
    }));
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('nieuw@example.nl');
  });
```

- [ ] **Step 5: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false 2>&1 | tail -40
```

Expected: PASS, both files.

- [ ] **Step 6: Mutate the confirmation copy, then the role default**

**Mutation 1 — make the confirmation claim something.** Change the success line to
`Invitation sent to {{ address }}. They will get a link to create their PeakPower account.`

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false 2>&1 | tail -30
```

Expected: **FAIL** on
`confirms that the invitation was sent without claiming anything about the address`:
`expected '…create their PeakPower account…' not to contain 'new account'` — no; the assertion that
bites is `expect(text).not.toContain('account')`… ⚠ it is **not** in the spec as written, so add it
while you are here: the three `not.toContain` lines cover "new account", "already" and "existing",
and this mutation slips past all three. Add
`expect(text).not.toContain('create their');` **and** re-run — the point of the mutation is to find
the assertion the spec was missing, and the fix is the assertion, not the copy.

Restore the copy, keep the new assertion.

**Mutation 2 — default to admin.** Change the `membershipRole` control's initial value to
`'admin'` and reorder `roles` to `['admin', 'trader', 'viewer']`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false 2>&1 | tail -30
```

Expected: **FAIL** on `offers the three roles, viewer first`:
`expected [ 'admin', 'trader', 'viewer' ] to deeply equal [ 'viewer', 'trader', 'admin' ]`, and on
the default-value assertion. An admin who typed an address and pressed enter would have made an
administrator. Restore.

- [ ] **Step 7: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web add \
  apps/customer-portal/src/app/features/company/invite-form.ts \
  apps/customer-portal/src/app/features/company/invite-form.spec.ts \
  apps/customer-portal/src/app/features/company/company-page.ts \
  apps/customer-portal/src/app/features/company/company-page.spec.ts
git -C /Users/thinhhuynh/PeakPower/peakpower-web commit -m "feat(portal): the invite form

An address, a role, and one answer whatever happens. The confirmation says what WE did and
nothing about the address: whether it already has a PeakPower login is a fact the server
refuses to reveal, and a screen that inferred it would reopen the oracle from the client
side.

Viewer is first and default - the least a person can be - so an admin who types an address
and presses enter has not made an administrator. `required` is the only client-side rule;
every other message comes off the server through applyProblemDetails.

Verified by mutation: a confirmation that promises a link to create an account slipped past
three of the four copy assertions, so the fourth was added; and defaulting the select to
admin fails the ordering and the default-value assertions together.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: The accept-invitation screen, and its unguarded route

The invitation email links to `/accept-invitation?token=…` (Task 4's `CustomerPortalLinks`). This
is the screen that opens.

⚠ **This task is an addition the plan brief does not name.** Scope item (g) lists the
member-management screen and the invite form. Without an accept screen the link in every invitation
lands on `**` → `/dashboard` → the authenticated guard → `/sign-in`, and the endpoint Task 5 ships
has no human path to it at all. It is written here, flagged, for the same reason `/reset-password`
exists beside the password-reset endpoint.

**Files:**
- Create: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/features/company/accept-invitation-page.ts`
- Test: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/features/company/accept-invitation-page.spec.ts` (create)
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/app.routes.ts`
- Modify: `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/app.routes.spec.ts`

**Interfaces:**
- Consumes: `CustomerApiClient.acceptInvitation({ token, firstName?, lastName?, password? })`
  (Task 12); `ActivatedRoute.queryParamMap`; `applyProblemDetails`.
- Produces: `AcceptInvitationPage`, and the route `accept-invitation`.

- [ ] **Step 1: Write the failing test**

Create
`/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/features/company/accept-invitation-page.spec.ts`:

```ts
import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, afterEach } from 'vitest';
import { provideCustomerApiTesting } from '@peakpower-nl/api-client-customer';

import { AcceptInvitationPage } from './accept-invitation-page';

const ACCEPT = '/api/v1/company/invitations/accept';

describe('AcceptInvitationPage', () => {
  let http: HttpTestingController;

  async function render(token: string | null) {
    const paramMap = convertToParamMap(token === null ? {} : { token });
    TestBed.configureTestingModule({
      providers: [
        provideCustomerApiTesting(),
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(paramMap), snapshot: { queryParamMap: paramMap } },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AcceptInvitationPage);
    await fixture.whenStable();
    return fixture;
  }

  afterEach(() => http.verify());

  /**
   * Step one of the two-step flow: post the token alone. An address that already has a login is
   * finished here, which is the whole reason the profile controls are not drawn up front — asking
   * an existing customer to re-type their name and invent a second password would be absurd.
   */
  it('posts the token alone on arrival and welcomes an existing login', async () => {
    const fixture = await render('abc');

    const req = http.expectOne(ACCEPT);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ token: 'abc' });
    req.flush({ customerId: 'c1', tradeName: 'Vandersteen Koeling', membershipRole: 'trader' });
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Vandersteen Koeling');
    expect(fixture.nativeElement.querySelector('input[type="password"]')).toBeNull();
  });

  /**
   * Step two: the server said this address has no login, naming the three fields. Nothing was
   * written and the invitation is still usable, so the form appears and the same token is posted
   * again.
   */
  it('reveals the profile form when the server names the three fields, and posts again', async () => {
    const fixture = await render('abc');

    http.expectOne(ACCEPT).flush(
      {
        errors: {
          firstName: ['Enter your first name.'],
          lastName: ['Enter your last name.'],
          password: ['Choose a password of at least 12 characters.'],
        },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('input[type="password"]')).not.toBeNull();

    for (const [selector, value] of [
      ['input[formControlName="firstName"]', 'Jaap'],
      ['input[formControlName="lastName"]', 'de Wit'],
      ['input[type="password"]', 'correct-horse-battery'],
    ] as const) {
      const input: HTMLInputElement = fixture.nativeElement.querySelector(selector);
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }

    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    const second = http.expectOne(ACCEPT);
    expect(second.request.body).toEqual({
      token: 'abc',
      firstName: 'Jaap',
      lastName: 'de Wit',
      password: 'correct-horse-battery',
    });
    second.flush({ customerId: 'c1', tradeName: 'Vandersteen Koeling', membershipRole: 'trader' });
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Vandersteen Koeling');
  });

  it('puts a rejected password under its own field', async () => {
    const fixture = await render('abc');
    http.expectOne(ACCEPT).flush(
      { errors: { password: ['Choose a password of at least 12 characters.'] } },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent)
      .toContain('Choose a password of at least 12 characters.');
  });

  it('prints the servers one sentence for an invitation that cannot be used', async () => {
    const fixture = await render('abc');
    http.expectOne(ACCEPT).flush(
      { detail: 'That invitation cannot be used. It has already been accepted or it has expired. Ask for a new one.' },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('cannot be used');
    // No form: there is nothing to retype that would help, and offering one implies otherwise.
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('asks for nothing at all when the URL carries no token', async () => {
    const fixture = await render(null);

    http.expectNone(ACCEPT);
    expect(fixture.nativeElement.textContent).toContain('link');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false 2>&1 | tail -30
```

Expected: **FAIL** to compile —
`error TS2307: Cannot find module './accept-invitation-page'`.

- [ ] **Step 3: Write the page**

Create
`/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/features/company/accept-invitation-page.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs/operators';
import { CustomerApiClient } from '@peakpower-nl/api-client-customer';
import type { CompanyInvitationAccepted } from '@peakpower-nl/api-client-customer';
import { PpButton, PpCard } from '@peakpower-nl/shared-ui';

import { applyProblemDetails, GENERIC_FAILURE, OFFLINE_FAILURE, isOffline }
  from '../../shared/apply-problem-details';
import { PpFormField } from '../../shared/form-field';

/**
 * The screen the invitation link opens. Unguarded, and it has to be: the person arriving may have
 * no PeakPower login at all, and the endpoint behind it is the one anonymous route on the customer
 * host that writes a membership.
 *
 * **Two steps, and the shape is the server's rather than a choice made here.** On arrival this
 * posts `{ token }` alone. An address that already has a login is finished — the membership is
 * written and this says which company they joined. An address with none gets a 400 whose `errors`
 * map names `firstName`, `lastName` and `password`; nothing was written and the invitation is
 * still usable, so those three controls appear and the same token is posted again.
 *
 * ⚠ **There is no preflight that asks whether an address has a login**, deliberately. Such a route
 * would answer that question for anybody who could reach it, which is exactly the oracle
 * `POST /company/invitations` is shaped to close. Learning the answer by attempting the accept
 * restricts it to whoever holds a 256-bit token out of that address's own inbox.
 */
@Component({
  selector: 'pp-accept-invitation-page',
  imports: [ReactiveFormsModule, RouterLink, PpButton, PpCard, PpFormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pp-card [headingLevel]="1" heading="Join on PeakPower">
      @if (accepted(); as joined) {
        <p class="lead">
          You now act for {{ joined.tradeName }}.
        </p>
        <p class="note">
          Sign in with your email address to get started.
        </p>
        <a routerLink="/sign-in">Go to sign in</a>
      } @else if (blocked(); as message) {
        <p class="msg msg--error" role="alert">{{ message }}</p>
      } @else if (needsProfile()) {
        <p class="lead">
          You do not have a PeakPower login yet. Choose a name and a password to create one.
        </p>

        <form [formGroup]="form" (ngSubmit)="submit()">
          <pp-form-field label="First name" for="accept-first" [error]="errorFor('firstName')">
            <input id="accept-first" type="text" autocomplete="given-name"
                   formControlName="firstName" />
          </pp-form-field>

          <pp-form-field label="Last name" for="accept-last" [error]="errorFor('lastName')">
            <input id="accept-last" type="text" autocomplete="family-name"
                   formControlName="lastName" />
          </pp-form-field>

          <pp-form-field label="Password" for="accept-password" [error]="errorFor('password')">
            <input id="accept-password" type="password" autocomplete="new-password"
                   formControlName="password" />
          </pp-form-field>

          <pp-button type="submit" variant="primary" [disabled]="busy()">
            Accept the invitation
          </pp-button>
        </form>
      } @else if (busy()) {
        <p class="lead">Checking your invitation…</p>
      } @else {
        <p class="msg msg--error" role="alert">
          This page needs the link from your invitation email. Open that link again, or ask
          whoever invited you to send a new one.
        </p>
      }
    </pp-card>
  `,
  styles: `
    :host { display: block; max-width: 420px; margin: 48px auto; }
    .lead { margin: 0 0 12px; font-size: var(--text-sm); color: var(--pp-text-body); line-height: 1.5; }
    .note { margin: 0 0 16px; font-size: var(--text-xs); color: var(--pp-text-faint); line-height: 1.5; }
    .msg { margin: 0; font-size: var(--text-xs); line-height: 1.5; }
    .msg--error { color: var(--pp-red-text); }
  `,
})
export class AcceptInvitationPage {
  private readonly api = inject(CustomerApiClient);
  private readonly route = inject(ActivatedRoute);

  private readonly token = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('token'))),
    { initialValue: this.route.snapshot.queryParamMap.get('token') },
  );

  readonly busy = signal(false);
  readonly accepted = signal<CompanyInvitationAccepted | null>(null);
  readonly needsProfile = signal(false);
  /** A refusal there is nothing to retype about: an unusable invitation, or a transport failure. */
  readonly blocked = signal<string | null>(null);

  readonly form = new FormGroup({
    firstName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    lastName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  constructor() {
    const token = this.token();
    if (token !== null && token.length > 0) {
      // Step one, on arrival and without asking: `{ token }` alone is a complete request for an
      // address that already has a login, and posting it is the only way to find out - see this
      // class's own remarks on why there is no preflight.
      this.post(token, false);
    }
  }

  errorFor(field: 'firstName' | 'lastName' | 'password'): string {
    return this.form.controls[field].errors?.['server'] ?? '';
  }

  submit(): void {
    const token = this.token();
    if (this.busy() || token === null || this.form.invalid) return;
    this.post(token, true);
  }

  private post(token: string, withProfile: boolean): void {
    this.busy.set(true);
    this.blocked.set(null);

    // The three fields are OMITTED rather than sent as null on the first attempt, so `{ token }`
    // is literally what goes on the wire for the case the shared contract writes that way.
    const body = withProfile
      ? {
          token,
          firstName: this.form.controls.firstName.value.trim(),
          lastName: this.form.controls.lastName.value.trim(),
          password: this.form.controls.password.value,
        }
      : { token };

    this.api.acceptInvitation(body).subscribe({
      next: (joined) => {
        this.busy.set(false);
        this.needsProfile.set(false);
        this.accepted.set(joined);
      },
      error: (error: unknown) => {
        this.busy.set(false);

        if (isOffline(error)) {
          this.blocked.set(OFFLINE_FAILURE);
          return;
        }

        const status = (error as { status?: number })?.status;

        if (status === 400) {
          // The server named the fields it needs. Nothing was written and the invitation is
          // still usable, so this is a prompt rather than a failure - which is why it does not
          // set `blocked`.
          this.needsProfile.set(true);
          applyProblemDetails(this.form, error);
          return;
        }

        if (status === 409) {
          // One body for unknown, spent and expired alike. There is nothing to retype that would
          // help, so no form is offered.
          const detail = (error as { error?: { detail?: unknown } })?.error?.detail;
          this.blocked.set(
            typeof detail === 'string' && detail.length > 0 ? detail : GENERIC_FAILURE,
          );
          return;
        }

        this.blocked.set(GENERIC_FAILURE);
      },
    });
  }
}
```

- [ ] **Step 4: Add the route**

In `/Users/thinhhuynh/PeakPower/peakpower-web/apps/customer-portal/src/app/app.routes.ts`, beside
`reset-password`:

```ts
  {
    // The invitation link's destination. UNGUARDED, like `reset-password` and for a stronger
    // reason: the person arriving may have no PeakPower login at all, which is precisely the case
    // the endpoint behind it exists to fix. A guard here would send every new colleague to a sign-
    // in page they cannot get past.
    path: 'accept-invitation',
    loadComponent: () =>
      import('./features/company/accept-invitation-page').then((m) => m.AcceptInvitationPage),
  },
```

In `app.routes.spec.ts`, add `'/accept-invitation'` to the `UNGUARDED` array, and extend that
array's doc comment:

```
 * `/accept-invitation` is the invitation link's destination, and it is unguarded for the strongest
 * reason on this list: the person arriving may have no PeakPower login at all. The endpoint behind
 * it is the one anonymous route on the customer host that WRITES a membership, and the invitation
 * token is its whole authorisation.
```

- [ ] **Step 5: Run it and watch it pass**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false 2>&1 | tail -40
npx ng test shared-ui --watch=false 2>&1 | tail -10
npx ng test employee-portal --watch=false 2>&1 | tail -10
```

Expected: PASS, all three. `app.routes.spec.ts`'s
`covers every entry in the table, so a route added without a case here cannot pass vacuously`
counts the declared paths against the four lists plus two, so the new route had to be added to a
list.

- [ ] **Step 6: Mutate the route's guard, then the two-step flow**

**Mutation 1 — guard it.** Add `canActivate: [authenticatedGuard],` to the `accept-invitation`
route.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false 2>&1 | tail -30
```

Expected: **FAIL** in `app.routes.spec.ts` — the `UNGUARDED` case for `/accept-invitation` drives a
navigation with no session and expects to land on `/accept-invitation`, and instead lands on
`/sign-in`. Every invitee with no PeakPower account would have hit that page. Restore.

**Mutation 2 — send the profile fields on the first post.** Change `post(token, false)` in the
constructor to `post(token, true)`.

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
npx ng test customer-portal --watch=false 2>&1 | tail -30
```

Expected: **FAIL** on `posts the token alone on arrival and welcomes an existing login`:
`expected { token: 'abc', firstName: '', lastName: '', password: '' } to deeply equal { token: 'abc' }`.
The first request would carry three empty strings, and the server — which only reads them when the
address has no login — would answer 400 for a password of length zero even for somebody who already
has one. Restore.

- [ ] **Step 7: Run everything, once, in both repositories**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-platform
dotnet build PeakPower.sln --nologo -warnaserror
dotnet test PeakPower.sln --nologo 2>&1 | tail -20
tools/verify-migrator.sh

cd /Users/thinhhuynh/PeakPower/peakpower-web
npm run generate:clients
git -C /Users/thinhhuynh/PeakPower/peakpower-web status --short libs/api-client-customer
npx ng test shared-ui       --watch=false 2>&1 | tail -6
npx ng test customer-portal --watch=false 2>&1 | tail -6
npx ng test employee-portal --watch=false 2>&1 | tail -6
```

Expected: platform green, `verify-migrator.sh` exits 0, `generate:clients` produces **no** diff
(the client is already current), all three web suites green.

- [ ] **Step 8: Commit**

```bash
cd /Users/thinhhuynh/PeakPower/peakpower-web
git -C /Users/thinhhuynh/PeakPower/peakpower-web add \
  apps/customer-portal/src/app/features/company/accept-invitation-page.ts \
  apps/customer-portal/src/app/features/company/accept-invitation-page.spec.ts \
  apps/customer-portal/src/app/app.routes.ts \
  apps/customer-portal/src/app/app.routes.spec.ts
git -C /Users/thinhhuynh/PeakPower/peakpower-web commit -m "feat(portal): the accept-invitation screen, unguarded

The destination of every invitation link, and an addition the plan brief does not name -
without it the link lands on the catch-all, then the guard, then a sign-in page the invitee
cannot get past, and the anonymous endpoint has no human path to it.

Two steps, and the shape is the server's: post { token } on arrival, and an address that
already has a login is finished. One that does not gets a 400 naming firstName, lastName and
password, with nothing written and the invitation still usable, so the form appears and the
same token goes again. There is no preflight asking whether an address has a login, because
such a route would answer that for anybody who could reach it.

Unguarded, for the strongest reason on that list: the person arriving may have no PeakPower
login at all.

Verified by mutation: guarding the route sends every invitee to /sign-in, and sending the
profile fields on the first post puts three empty strings on the wire for somebody who
already has a login.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done, and what a reviewer should check first

1. **The two contract §11 probes exist and bite.** `IndistinguishableInvitationTests` and
   `MembershipConcurrencyTests`, each with the mutation output in its commit message. The
   concurrency one was run five times with the lock removed, because a single green run over a race
   is not evidence.
2. **There is no `DELETE` grant on either new table**, and `InvitationSchemaTests.
   The_privilege_set_is_exactly` pins the complete privilege set rather than checking one privilege
   at a time.
3. **Every admin query carries `AND customer_id = @active`.**
   `grep -n 'CustomerId == tenancy.CustomerId\|customer_id = {customerId}' src/Hosts/PeakPower.Api.Customer/Portal/MembershipEndpoints.cs`
   should find one per query, including inside `LockAdminsAsync`.
4. **The accept is on `AnonymousEndpointAllowListTests.Expected`** with its reason at the
   `.AnonymousEndpoint(...)` call site, and
   `The_tenant_connection_refuses_the_known_address_accept_which_is_why_it_is_anonymous` proves the
   `42501` rather than arguing it.
5. **Deviation D1** — the accept body carries three optional fields the shared contract does not.
   That is the one wire change in this plan and it is the one thing a contract owner has to agree
   with.
