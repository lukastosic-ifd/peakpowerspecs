# F13 — Identity & Access

**Portal:** both · **Priority:** Must · **Phase:** 1 · **Size:** M

---

## 1. Summary

Two separate identity populations — **customer accounts** and PeakPower **employees** — with separate
portals, separate APIs and separate trust levels. In production both authenticate through an OpenID
Connect provider; the proof of concept authenticates neither **[DEC-20]** — see below, because that
sentence is easy to misread as licence to skip tenancy too.

A customer account is one person's login at one customer company. Every account of a company holds
the same single role, `customer.user`, and therefore the same rights **[DEC-16]**. What the identity
layer must get right is not *authorisation inside a company* — there is none to model — but two other
things: **scoping** every request to exactly one company, and **identifying** exactly which person
acted, so [F05](F05-energy-block-trading.md) and [F15](F15-audit-and-observability.md) can attribute
it **[DEC-17]**.

The provider is decided: **Microsoft Entra ID** in production **[DEC-20]**, closing [OQ-03] and
effectively answering [OQ-73] — Entra only makes sense against an existing Microsoft tenancy, and
**[DEC-66]** confirms that PeakPower's **corporate** one is it. The evaluation that led there is in
[Identity provider](../30-integrations/05-identity-provider.md). The choice still must not leak into
the application: everything below is written against standard OIDC, so switching providers stays a
configuration change plus a migration, not a rewrite.

> **The tenancy — [DEC-66], closing [OQ-88].** Entra ID runs on PeakPower's **existing corporate
> Microsoft tenancy**. It is not created for this project. **[DEC-56]** — "no existing Azure tenancy"
> — is **clarified, not reversed**: it means no Azure **subscription, landing zone or naming
> standard**, and Azure subscriptions are created **under** this same Entra tenant. Employee identity
> therefore stays **single**, which is exactly what **[DEC-51]** and **[DEC-53]** assume without
> saying. [OQ-88] is closed.
>
> ⚠ **What is outstanding is *access*, and it is a dependency rather than a question.** Access is
> administered outside the delivery team, so it lives on the Phase 0 dependency list with a named
> owner and a date ([Roadmap §2.1](../70-delivery/01-roadmap-and-phasing.md)) — not in
> [80-open-questions.md](../80-open-questions.md). Under **[DEC-67]** the `customer_id` claim-mapping
> spike **[F13-R32]** runs against that tenancy and therefore **inherits** the dependency. Nothing
> here is blocked *today*, because the PoC ships unauthenticated **[DEC-20]** — which is precisely
> what makes it easy to forget. See **[R-24]**.

> **Break-glass — [DEC-53] amends [DEC-29].** The platform now **hashes and stores passwords for a
> small set of named employee accounts**, used only when the identity provider is unavailable. This
> closes [OQ-44]. **It is a bounded exception, not a reversal**: customers remain **fully
> provider-authenticated** and no customer credential is ever stored **[F13-R02]**. The
> non-negotiable constraints — named accounts only, disabled by default, a second factor that does
> **not** depend on the identity provider, every use alerted and audited, and rehearsed — are
> requirements **[F13-R33..R40]**, not advice.
>
> ⚠ **It partially reopens what Phase 1 builds.** "No credential storage, no reset flow, no lockout
> policy" was true of the whole platform under **[DEC-29]**; it is now true only of the **customer**
> population. Credential storage, hashing, rotation, lockout and breach handling come back in a narrow
> employee scope, and they come back with the operational obligations — the alerting and the rehearsal
> — that make them worth having. An unrehearsed break-glass path is not a break-glass path.

> **Customer MFA — [DEC-51].** MFA for customer users is governed by **Entra tenant policy, not by the
> platform**. The platform neither enforces nor exempts it; it **reads `amr` as evidence** and records
> it **[F13-R06]**. Employee MFA stays mandatory **[F13-R05]**, **[NFR-33]**. Closes [OQ-43], and moves
> a security control off the platform's control surface — worth recording explicitly, because a
> control nobody in this repository owns is a control that can silently change.

### The proof of concept has no authentication — and full tenancy anyway

**[DEC-20]** runs the PoC with **no authentication at all**. That is a decision about *logging in*,
not about *scoping*.

> ⚠ **Skipping authentication is not skipping tenancy.** The `customer_id` / `account_id` context
> pipeline is built **now**, fed by a **development context provider** instead of a token, so that
> the EF Core global query filter, row-level security and the `404`-not-`403` behaviour are exercised
> **from the first commit**. Retrofitting tenancy isolation into a system that never had it is how
> [R-06](../70-delivery/02-risks.md) happens.

| | Proof of concept | Production |
| --- | --- | --- |
| Who authenticates | Nobody — no sign-in **[DEC-20]** | Microsoft Entra ID, OIDC + PKCE **[F13-R01]** |
| Where the context comes from | Development context provider **[F13-R30]** | Validated token claims **[F13-R14, R15]** |
| Query scoping, RLS, `404`-not-`403` | **Built and tested** | Identical code path |
| Credential storage | None — the platform never stores a password **[DEC-29]** | **None for customers [DEC-29]**; password hashes for a small set of **named employee break-glass accounts** **[DEC-53]**, **[F13-R33..R40]** |
| Customer MFA | Not exercised — no sign-in | **Entra tenant policy**, not the platform. `amr` read as evidence **[DEC-51]**, **[F13-R06]** |

The fiddliest part of the production provider is mapping Entra's claims onto `customer_id` — spike it
before Phase 1 ends **[F13-R32]**, against the **corporate tenancy [DEC-67]**. ⚠ That makes the spike
dependent on tenant access being granted first ([Roadmap §2.1](../70-delivery/01-roadmap-and-phasing.md)),
with no substitute: a local Keycloak or Authentik container proves discovery, PKCE, token validation
and the claim **contract**, but it cannot prove Entra's claim **mapping**.

Phase 1 scope **shifts rather than shrinks**: no sign-in, no customer credential handling and no reset
flows to build **[DEC-29]**, but a context pipeline, a development provider and an Entra claim-mapping
spike to build instead. ⚠ **[DEC-53] adds back a small, non-optional piece** — the break-glass
credential store, its second factor, its alerting and its rehearsal **[F13-R33..R40]** — which is not
free and is easy to under-scope because it looks like "one login screen". The **M** size tag holds only
if break-glass is planned as its own slice rather than as a corner of the auth work.

### The account record

| Field | Owned by | Notes |
| --- | --- | --- |
| **Username** | Platform + provider | Login identifier. Unique platform-wide, immutable after creation |
| **Password** | **Provider only** | Never set, stored, transmitted through or visible to the platform **[DEC-29]**. ⚠ **One exception, and it is not a customer one:** named **employee** break-glass accounts hold a platform-stored password hash **[DEC-53]**, **[F13-R33]**. No customer account has a platform-held credential of any kind |
| First name, last name | Platform | Shown in the audit trail, notifications and to the trade desk |
| **Role in the company** | Platform | Job title. Descriptive; grants nothing |
| Contact phone | Platform | |
| Contact email | Platform | Notification destination; may differ from the username |
| Company | Platform | The `customer_id` claim; set at provisioning, never client-supplied |
| Status | Platform | `INVITED` · `ACTIVE` · `DEACTIVATED` |

**[DEC-29] closes [OQ-78] and confirms this split.** The stakeholder described an account as
"username, password, …", which reads naturally as the platform owning both. It does not: the identity
provider owns the credential and **the platform never stores a customer password**. That removes
credential storage, password reset, lockout, breach exposure and MFA from PeakPower's responsibility
for the customer population, and it is consistent with **[DEC-20]** — Entra owns the credential, the
platform owns the `customer_id` ↔ `account_id` mapping and validates the claim pair on every request.

So Phase 1 builds no credential storage, no reset flow and no lockout policy **for customers** — none
of it is the platform's to own. **[DEC-53]** carves out the one exception, for named employee
break-glass accounts, and bounds it in §2.

## 2. Functional requirements

### Authentication

**Not built in the PoC [DEC-20].** These are production requirements against Microsoft Entra ID. They
keep their MoSCoW tags because nothing here is dropped — only sequenced behind the PoC. The
*Authorisation* requirements below are built from the first commit regardless.

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F13-R01 | Both portals authenticate via OIDC authorisation code flow with PKCE, against **Microsoft Entra ID [DEC-20]**. | Must |
| F13-R02 | The platform never receives or stores a **customer** password. The identity provider owns the credential **[DEC-29]** — no credential storage, reset flow or lockout policy is built for customers. The **only** platform-held credentials anywhere in the system are the named employee break-glass accounts of **[DEC-53]**, **[F13-R33..R40]**. | Must |
| F13-R03 | Customer and employee identities live in separate realms/tenants, with separate client registrations and separate token audiences. Under Entra that is **PeakPower's existing corporate tenant** for employees **[DEC-66]** and an External ID tenant for customers **[DEC-20]**. Two tenants, one **employee** directory — a third Entra tenant holding a second set of employee accounts is what **[DEC-66]** rules out, because **[DEC-51]** and **[DEC-53]** are both written against *the* tenant. | Must |
| F13-R04 | A customer signs in with a **username**, not necessarily an email address. The two may differ, and the email is used for notifications rather than for login. | Must |
| F13-R05 | Employee accounts require MFA **[NFR-33]**. Unchanged by **[DEC-51]**, which is about customers only. | Must |
| F13-R06 | **Customer MFA is governed by Entra tenant policy, not by the platform** **[DEC-51]**. The platform **neither enforces nor exempts** it: there is no MFA setting on a customer account and no endpoint that requires a step-up. It **reads the `amr` claim as evidence**, records it on the session and in the audit trail **[F15](F15-audit-and-observability.md)**, and exposes it to employees answering "was that sign-in second-factored?". ⚠ Because the control lives in the tenant, a change there is invisible to this repository — so the evidence is the only thing the platform can offer, and it must actually be captured rather than assumed. | Must |
| F13-R07 | Sessions use short-lived access tokens (≤ 15 min) with refresh tokens; refresh tokens rotate on use. | Must |
| F13-R08 | Idle timeout of 30 minutes and absolute session limit of 12 hours, both configurable. | Must |
| F13-R09 | Sign-out invalidates the local session and initiates provider sign-out. | Must |
| F13-R10 | Failed logins, lockouts and password resets are handled by the provider; the platform surfaces provider errors without leaking whether an account exists **[DEC-29]**. | Must |
| F13-R11 | Employees can sign in with the organisation's existing corporate identity if the chosen provider supports federation. Entra makes this the default path for employees **[DEC-20]**. | Should |

### Authorisation

**Built in the PoC [DEC-20].** Every requirement in this section is exercised from the first commit,
fed by the development context provider in **F13-R30** rather than by a token. None of it waits for
authentication.

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F13-R12 | Roles come from the token: `customer.user`, `employee.viewer`, `employee.trader`, `employee.finance`, `employee.admin` **[Actors & roles](../00-overview/03-actors-and-roles.md)**. | Must |
| F13-R13 | **Every** customer account holds exactly `customer.user`. There is no second customer role and no per-account permission field **[DEC-16]**. | Must |
| F13-R14 | Every customer-portal token carries a `customer_id` claim identifying the **company**, established at provisioning and never derived from a request parameter. | Must |
| F13-R15 | Every customer-portal token also carries an `account_id` claim identifying the **person**. `customer_id` scopes what may be read and written; `account_id` records who did it **[DEC-17]**. | Must |
| F13-R16 | On every request the platform validates that `account_id` belongs to `customer_id` in its own records, and rejects the token if not. | Must |
| F13-R17 | Customer data access is scoped by `customer_id` at the data-access layer — a global query filter — not only in controllers **[Security](../20-architecture/07-security.md)**. | Must |
| F13-R18 | Every endpoint declares its required role explicitly; the default for an undeclared endpoint is deny. | Must |
| F13-R19 | Attempting to access another customer's object returns `404`, not `403`, so the API does not confirm the object exists. | Must |
| F13-R20 | Employees have no implicit write access to customer-owned actions (a trader cannot accept an offer on a customer's behalf). | Must |

### User lifecycle

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F13-R21 | An employee can create a customer account and invite the person by email; the invitation is single-use and time-limited (default 14 days). | Must |
| F13-R22 | Accepting an invitation activates the identity in the provider, where the person sets their own credential, and links it to the platform account record. The account moves `INVITED` → `ACTIVE`. | Must |
| F13-R23 | A company may have any number of accounts. Creating the second and subsequent accounts is the same operation as the first — there is no notion of a primary or owner account. | Must |
| F13-R24 | An employee can deactivate a customer account, immediately revoking its sessions. Deactivation never removes the account record, so historical attribution stays resolvable **[F05-R46]**. | Must |
| F13-R25 | An admin can manage employee accounts and role assignments. | Must |
| F13-R26 | User accounts are deactivated, never deleted, so audit references stay resolvable. | Must |
| F13-R27 | An account holder can update their own first name, last name, job title, phone and notification preferences; email changes go through verification. Username is immutable. | Should |
| F13-R28 | An account holder can see the other accounts of their own company — name, job title, email, status — so they know who else can act **[DEC-62]**, **[F01-R21]**. Under **[DEC-16]** any colleague can already spend the company's money, so this discloses nothing an employee could not tell them on the phone. | Must |
| F13-R29 | Customer users can see their own active sessions and sign them out. | Could |

### Tenancy context

New with **[DEC-20]**. These exist so that "the PoC has no authentication" cannot quietly become "the
PoC has no tenancy".

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F13-R30 | The `customer_id` / `account_id` request context is a first-class pipeline, independent of how it was obtained. In the PoC it is supplied by a **development context provider**; in production it is supplied from validated token claims **[F13-R14, R15]**. The global query filter **[F13-R17]**, row-level security and the `404`-not-`403` behaviour **[F13-R19]** read the context, never the request, and are exercised against it from the first commit **[DEC-20]**. | Must |
| F13-R31 | The development context provider is available in development and test configurations only. It cannot be activated in a production configuration, and the application refuses to start if it is present there. A dev context provider reachable in production is a tenancy bypass, which is [R-06](../70-delivery/02-risks.md) by another route **[DEC-20]**. | Must |
| F13-R32 | The Entra adapter maps provider claims onto `customer_id` and `account_id`. This mapping is the fiddliest part of the provider integration and is **spiked before the end of Phase 1** **[DEC-20]**, **against PeakPower's corporate Entra tenancy and not a throwaway developer tenant** **[DEC-67]** — proving it once against the configuration that will actually run. ⚠ **The spike therefore carries an external dependency**: tenant *access* is granted outside the delivery team and is tracked with a named owner and a date in [Roadmap §2.1](../70-delivery/01-roadmap-and-phasing.md). It has no substitute — the local OIDC container required by **[DEC-67]** proves discovery, PKCE, token validation and the claim **contract**, never Entra's claim **mapping**. If access is late the spike's date moves; it does **not** move to another tenant **[R-24]**. | Must |

### Break-glass access

New with **[DEC-53]**, which **amends [DEC-29]** and closes [OQ-44]. A managed identity provider moves
the availability risk off PeakPower; it does not remove it, and "nobody can sign in to the financial
application" needs an answer that does not depend on the thing that is down.

**This is a bounded exception.** It exists for **employees**, for **provider unavailability**, and for
nothing else. Customers stay fully provider-authenticated **[F13-R02]**; there is no customer-facing
break-glass and no "emergency password reset" for a customer account.

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F13-R33 | The platform holds a username and a **password hash** for a small set of **explicitly named employee accounts** **[DEC-53]**. The set is enumerated in configuration and reviewed on a schedule; there is **no shared account**, no generic `admin`, and no way to create a break-glass account other than the reviewed, audited path — a break-glass account nobody can name is an unowned credential. | Must |
| F13-R34 | Break-glass accounts are **disabled by default** **[DEC-53]**. Enabling one is an explicit, audited action by a second named administrator, is **time-boxed**, and reverts to disabled automatically when the box expires. ⚠ **[DEC-53] does not state the duration.** It is configuration with no shipped default, for the same reason as the four-eyes threshold **[F05-R50]**: a guessed window is either too short to be usable in an incident or long enough to become a standing account. Set it before the path is enabled for the first time. | Must |
| F13-R35 | Credentials are stored **only as a hash**, using a current memory-hard password hash with per-credential salt, and are never recoverable, never logged and never displayed after issue **[DEC-53]**. Rotation is scheduled, and is **mandatory after every use** — a break-glass password that survives the incident it was used in is a standing credential wearing an emergency label. | Must |
| F13-R36 | Break-glass sign-in requires a **second factor that does not depend on the identity provider** **[DEC-53]** — a platform-verified TOTP secret or a hardware token, enrolled out of band. A second factor delivered through Entra, or through anything federated to it, fails the only test that matters: it will be unavailable exactly when the path is needed. | Must |
| F13-R37 | **Every break-glass authentication attempt, successful or not, raises an immediate alert** over a channel that does not depend on the identity provider, and is written to the audit log with the named account, timestamp, source address, the second-factor result and the stated reason **[DEC-53]**, **[F15](F15-audit-and-observability.md)**. Enabling, disabling, rotation and failed second factors alert on the same channel. Silent break-glass is indistinguishable from a compromise. | Must |
| F13-R38 | A break-glass session grants the **minimum function set** needed to run the platform through an outage, and **never** more than the same employee's normal roles **[F13-R12]**, **[F13-R20]**. It gives no customer-portal access and no ability to act on a customer's behalf. ⚠ **The function set itself is not specified by [DEC-53]** — it has to be decided with operations, written down, and enforced as a role rather than assumed from "admin". Until it is, the safe reading is read-only plus the specific actions an incident actually requires. | Must |
| F13-R39 | The path is **rehearsed on a schedule** (at least twice a year and after any change to it), the rehearsal is recorded with date, participants and outcome, and a failed rehearsal is treated as an incident **[DEC-53]**. **An unrehearsed break-glass path is not a break-glass path** — it is an untested credential store with an optimistic name. | Must |
| F13-R40 | Break-glass sign-in has its **own** rate limiting, lockout and breach procedure, separate from anything the provider does, and a documented, practised way to disable every break-glass account at once on suspicion of compromise **[DEC-53]**. The credential store is a new asset in the threat model **[Security](../20-architecture/07-security.md)** and must be entered there as one. | Must |

## 3. Business rules

1. **Two realms, no crossover.** An employee token is never valid on the customer API and vice
   versa, enforced by audience validation.
2. **`customer_id` comes from the token, always.** Any code path that reads a customer identifier
   from a query string, body or header for authorisation purposes is a defect.
3. **Deny by default.** Both at the endpoint level and at the data-access level.
4. **Deactivate, never delete.** Audit trails must remain readable years later.
5. **Impersonation is read-only** **[F12-R31..R33]**.
6. **Provider-agnostic.** No provider-specific API calls in domain code; provisioning goes through one
   adapter. **[DEC-20]** names Entra ID as the provider; it does not license Entra-shaped code
   outside that adapter.
7. **The platform holds no customer credential [DEC-29].** Not a password, not a hash, not a reset
   token. **[DEC-53]** amends this for **employees only**: the named break-glass accounts hold a hash
   **[F13-R33]**, disabled by default, second-factored off-provider, alerted on every use and
   rehearsed. Everything outside that enumerated set is unchanged, and the exception is not a licence
   to store any other credential "while we are at it".
8. **No authentication is not no tenancy [DEC-20].** The context pipeline, the query filter and the
   `404` behaviour are unconditional. A build with authentication disabled still scopes every query.
9. **Break-glass is exercised or it does not exist [DEC-53].** Rehearsal is a requirement
   **[F13-R39]**, not a good intention, and the alerting **[F13-R37]** is what makes a real use
   distinguishable from an attacker finding the same door.
10. **Customer MFA is somebody else's control [DEC-51].** The platform records the evidence and makes
    no decision. It must therefore never *claim* MFA was applied, only report what `amr` said.

## 4. Token shape

```jsonc
// Customer portal access token (claims of interest)
{
  "iss": "https://id.peakpower.example/realms/customers",
  "aud": "peakpower-customer-api",
  "sub": "9f3c…",                    // stable provider subject
  "preferred_username": "jdevries",
  "customer_id": "c-000142",         // the COMPANY — scopes every query
  "account_id": "acc-0031",          // the PERSON  — stamped on every write
  "roles": ["customer.user"],        // the only customer role there is  [DEC-16]
  "name": "Jan de Vries",
  "email": "j.devries@vandersteen.nl",
  "locale": "nl-NL",
  "amr": ["pwd", "mfa"],             // evidence only - tenant policy decides  [DEC-51]
  "exp": 1785312000
}
```

Two identifiers, two jobs — and they must not be confused:

| Claim | Answers | Used for |
| --- | --- | --- |
| `customer_id` | *Whose data is this?* | Query scoping, row-level security, `404` on cross-customer access |
| `account_id` | *Who is doing it?* | Attribution on trade events, wallet entries and audit records |

Neither is ever accepted from the request. `account_id` grants nothing — two accounts of one company
with different `account_id` values have byte-identical permissions.

The issuer and realm values above are illustrative. Under **[DEC-20]** they become the Entra corporate
tenant for employees and an External ID tenant for customers; the **claim contract does not change**,
which is what keeps the domain code provider-agnostic. In the PoC there is no token at all and the same
two values arrive from the development context provider **[F13-R30]**.

```jsonc
// Employee portal access token
{
  "iss": "https://id.peakpower.example/realms/employees",
  "aud": "peakpower-employee-api",
  "sub": "4b1a…",
  "roles": ["employee.trader", "employee.viewer"],
  "email": "…",
  "amr": ["pwd", "otp"],             // MFA evidence
  "exp": 1785312000
}
```

The `customer_id` claim is the single most security-critical field in the system. It is set once at
provisioning, is never writable by the user, and is validated against the platform's own account
record on every request — belt and braces, because the cost of getting it wrong is one customer
seeing another's trading position.

`account_id` is the second: not because it grants access, but because an attribution that names the
wrong person is worse than one that names nobody.

## 5. Provider decision — Microsoft Entra ID [DEC-20]

**Decided.** Entra ID in production; no authentication at all in the PoC. The comparison below is
kept as the record of what was considered, not as an open choice. Full detail in
[Identity provider](../30-integrations/05-identity-provider.md).

| | Authentik (self-hosted) | Microsoft Entra ID | Okta |
| --- | --- | --- | --- |
| Cost at ~200 users | Infrastructure only | Low if already licensed | Highest |
| Operational burden | **PeakPower's** — patching, HA, backups | Managed | Managed |
| Multi-realm separation | Good | Workable via External ID for customers | Good |
| Customer-facing branding | Full control | Good with External ID | Good |
| Data residency | Full control | Configurable EU | Configurable EU |
| Time to first login | Days | Hours **once access is granted** — the tenancy exists **[DEC-66]** | Hours |
| Lock-in | Low | Moderate | Moderate |

**The decision followed the recommendation:** **Entra ID for employees** and a customer-facing tenant
for customer users, which removes an availability-critical component from PeakPower's own operational
scope. Self-hosting an identity provider would mean owning uptime for the thing that gates access to
a financial application — a real and permanent cost. Entra only makes sense against an existing
Microsoft tenancy, so **[DEC-20]** effectively answers **[OQ-73]** as well — and **[DEC-66]**
confirms it: the corporate tenancy exists, so the premise held.

Two things this decision does **not** settle, and they are the ones to plan around:

| | Consequence |
| --- | --- |
| **Claim mapping** | Entra's `customer_id` claim mapping is the fiddliest part of the provider adapter. Spike it before Phase 1 ends **[F13-R32]**, against the corporate tenancy **[DEC-67]**. ⚠ It stays **unproven until tenant access arrives**, which is a deliberate trade — one proof against the real configuration, at the cost of putting an external dependency on the critical path ([Roadmap §2.1](../70-delivery/01-roadmap-and-phasing.md)) |
| **Lock-in** | Rated *moderate* above and unchanged by the decision. The provider-agnostic rule (business rule 6) is what keeps it moderate |

## 6. Edge cases

| Case | Behaviour |
| --- | --- |
| PoC request with no token at all | Served under the development context provider's `customer_id` / `account_id` **[F13-R30]**. The query filter, row-level security and `404`-not-`403` behave exactly as in production — that is the point of building it this way **[DEC-20]** |
| Development context provider found in a production configuration | The application refuses to start **[F13-R31]**. Failing to boot is the correct response to a tenancy bypass |
| Entra returns a token with no `customer_id` claim | Rejected. The claim mapping is provider configuration, and a missing mapping is a configuration failure, never a default-to-something **[F13-R32]** |
| Provider unavailable | Existing sessions keep working until token expiry; new logins fail with a clear message. **Named employees have a break-glass path [DEC-53]** — disabled until an administrator enables it, second-factored without the provider, alerted and audited on every use **[F13-R33..R40]**. Customers have none and wait for the provider |
| **Break-glass used when the provider is in fact available** | Permitted but conspicuous. The alert fires exactly as it would in an outage **[F13-R37]**, and the use is reviewed. Break-glass is not gated on a health check — a gate that has to decide whether the provider is "really" down would fail in the grey cases that matter |
| **A break-glass account is enabled and never used** | It auto-disables when its time box expires **[F13-R34]**. A standing enabled account is the failure mode this requirement exists to prevent |
| **Second factor unavailable during an incident** | The path fails closed. There is no bypass, because a break-glass path with a bypass is a password-only path **[F13-R36]**. The remedy is enrolment of more than one named account, not a weaker check |
| One person works for two customer companies | Not supported. They need a second account with a different username, because `customer_id` is fixed per account. Flagged at provisioning |
| Two accounts of one company act on one trade | Supported and expected **[DEC-18]** |
| A company reaches its last active account | Deactivating it needs explicit confirmation **[F01-R19]** |
| Employee leaves | Deactivated in the provider; sessions revoked at next token refresh, immediately for a forced revocation |
| Token with an unknown role | Treated as no role; access denied and logged |
| Customer user deactivated mid-session | Next request fails authorisation; the UI returns to sign-in |
| Invitation email never arrives | Employee can resend or reissue; the old link is invalidated |

## 7. Out of scope

- Self-service customer registration.
- Social login.
- **Break-glass, password storage or credential recovery for customer accounts** — **[DEC-53]** is an
  employee-only exception and does not extend here.
- **Platform-side MFA enforcement or exemption for customers** — tenant policy owns it **[DEC-51]**.
- SCIM provisioning from customer directories.
- API keys for machine-to-machine customer access (the PVNed endpoint has its own, separate scheme).

## 8. Dependencies

| Depends on | Why |
| --- | --- |
| [Identity provider](../30-integrations/05-identity-provider.md) | Provider selection and configuration |
| [Security](../20-architecture/07-security.md) | Enforcement design |

## 9. Open questions

| Ref | Question |
| --- | --- |
| ~~[OQ-03]~~ | ~~Which identity provider?~~ **Closed by [DEC-20]** — Microsoft Entra ID in production, no authentication in the PoC |
| ~~[OQ-04]~~ | ~~Are differentiated roles needed within a customer?~~ **Closed by [DEC-16]** — all accounts of a company are equal |
| ~~[OQ-43]~~ | ~~Is MFA mandatory for customer users?~~ **Closed by [DEC-51]** — governed by **Entra tenant policy**, not by the platform. The platform neither enforces nor exempts; it reads `amr` as evidence **[F13-R06]**. Employee MFA remains mandatory **[F13-R05]** |
| ~~[OQ-44]~~ | ~~What is the break-glass procedure if the provider is unavailable?~~ **Closed by [DEC-53]** — a platform-held username and password for **named employee accounts**, disabled by default, second-factored off-provider, alerted, audited and rehearsed **[F13-R33..R40]**. ⚠ Two details the decision leaves to be set before first use: the **time box** on an enabled account **[F13-R34]** and the **function set** a break-glass session may reach **[F13-R38]** |
| ~~[OQ-88]~~ | ~~Entra ID was chosen as the production identity provider, but there is no Microsoft tenancy — which decision moves?~~ **Closed by [DEC-66]** — **neither**. Entra ID uses PeakPower's **existing corporate Microsoft tenancy**; **[DEC-56]** is clarified rather than reversed and means no Azure **subscription, landing zone or naming standard**, with the new subscriptions created **under** that same tenant. Employee identity stays single, so **[DEC-51]** and **[DEC-53]** are unaffected and this feature can be estimated. ⚠ **The residue is a dependency, not a question**: *access* to the tenancy, with a named owner and a date in [Roadmap §2.1](../70-delivery/01-roadmap-and-phasing.md). It is deliberately not registered under an `OQ` number, and **[DEC-67]** makes **[F13-R32]** inherit it |
| ~~[OQ-73]~~ | ~~Does PeakPower run Microsoft 365 or another corporate directory?~~ **Effectively answered by [DEC-20]** and **confirmed by [DEC-66]** — the corporate Microsoft tenancy exists and is the one Entra ID uses |
| ~~[OQ-78]~~ | ~~Are credentials owned by the identity provider, or must the platform hold username and password itself?~~ **Closed by [DEC-29]** — the provider owns them; the platform never stores a customer password. ⚠ **Amended by [DEC-53]**: named employee break-glass accounts are the one bounded exception **[F13-R33]** |
| ~~[OQ-80]~~ | ~~Should a company's accounts be visible to each other in the customer portal?~~ **Closed by [DEC-62]** — yes **[F13-R28]**, **[F01-R21]** |
