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
it **[DEC-17]**. ⚠ **Amended 2026-08-19 by [DEC-71]** — the two clauses about a *single* role and
about there being *nothing* to authorise inside a company are no longer literally true. Exactly one
intra-company distinction now exists, it is one bit wide, and it exists only so four-eyes can name an
approver. The scoping and attribution jobs above are unchanged and remain the larger part of the work.

The provider is decided: **Microsoft Entra ID** in production **[DEC-20]**, closing [OQ-03] and
effectively answering [OQ-73] — Entra only makes sense against an existing Microsoft tenancy, and
**[DEC-66]** confirms that PeakPower's **corporate** one is it. The evaluation that led there is in
[Identity provider](../30-integrations/05-identity-provider.md). The choice still must not leak into
the application: everything below is written against standard OIDC, so switching providers stays a
configuration change plus a migration, not a rewrite.

> **Two levels and not one more — [DEC-71], qualifying [DEC-16] and closing [OQ-85].** A customer
> account carries an **admin** flag **[F13-R41]**; a customer company carries a **four-eyes enabled**
> flag **[F13-R42]**. That is the entire role model. ⚠ **[DEC-33]**'s value threshold is **replaced,
> not configured to zero** — there is no amount to resolve and the threshold reference table
> **[F05-R50]** is not built.
>
> **What survives [DEC-16] unchanged, and it is most of it.** PeakPower employees still create and
> deactivate every customer account **[F13-R21]**, **[F13-R24]**; customers do not manage their own
> users. A **non-admin account keeps every ordinary privilege** — requesting a price, seeing the
> wallet, and **accepting an offer [DEC-18]**. The admin flag adds no screen, no report, no limit and
> no extra read. It makes an account *eligible to approve or refuse*, and nothing else.
>
> **Why a bigger model was not adopted.** A viewer / trader / approver hierarchy was rejected under
> **[DEC-16]** for a reason that has not changed: it means maintaining the customer's own org chart
> inside our platform, and every level is a level to provision, migrate, test, support and get wrong.
> Four-eyes needs exactly one distinction — *may this person approve?* — so exactly one bit is
> modelled. The cost is small but not nil: a flag on the account, a flag on the company, one extra
> claim entry, one extra validation on every token **[F13-R43]**, and the structural obligation that a
> four-eyes company hold at least two admin accounts (§6).
>
> ⚠ **One tension recorded rather than resolved.** [DEC-71]'s action list includes **add a user**,
> while [DEC-16] — unchanged on this point — keeps account creation and deactivation with PeakPower
> employees. Nothing in this file grants customers user management; if the action list intends to, it
> reopens [DEC-16] and needs saying explicitly. The action inventory itself lives in
> [F05](F05-energy-block-trading.md), not here — this feature supplies the flags and the
> different-admin check **[F13-R44]**.

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
>
> ⚠ **Amended 2026-08-19 by [DEC-92].** The paragraph above stays readable because half of it still
> governs; the half that does not is the word *optional*.
>
> | | Before **[DEC-51]** | After **[DEC-92]** |
> | --- | --- | --- |
> | Is MFA required for customer users | Whatever the tenant policy says | **Mandatory** |
> | Who enforces it | Conditional Access in the corporate tenancy **[DEC-66]** | Unchanged — Conditional Access in the corporate tenancy **[DEC-66]** |
> | Does the platform implement MFA | No — no setting, no enrolment, no step-up | Unchanged — no |
> | What the platform does with `amr` | Records it as evidence **[F13-R06]** | Records **and verifies** it; a token with no second-factor method is rejected **[F13-R45]** |
>
> So the platform stops trusting the tenant silently. It still cannot *cause* MFA to happen, but it can
> refuse a session that does not evidence it, which is the only lever a relying party has.
> **Onboarding friction is accepted [DEC-92]**: every customer user enrols a second factor before they
> can use the portal, and an unenrolled user is a support call rather than a degraded login.
> [OQ-43] closes on these stronger terms.
>
> ⚠ **Cost, recorded.** The platform is now coupled to a claim the tenant must actually emit. If
> Conditional Access is loosened or the `amr` values change, the platform fails closed and customers
> cannot sign in. That is the right failure, but it arrives without warning from outside this
> repository, which is why the accepted method set is configuration rather than a constant
> **[F13-R45]**.

> **No external penetration test before go-live — [DEC-102], closing [OQ-60].** ⚠ **[NFR-36]** —
> *"penetration test completed before go-live, findings closed or risk-accepted in writing"* — is
> **amended 2026-08-19**: none is budgeted, so the requirement cannot be met as written and the second
> half of it (risk-accepted in writing) is what remains. This is recorded here rather than dropped
> quietly, because this feature owns most of the surface such a test would have covered:
>
> | Surface | Why it was the test's target |
> | --- | --- |
> | Tenancy isolation **[F13-R17]**, **[F13-R19]**, **[F13-R30]** | Built and exercised before any authentication existed **[DEC-20]** — correct, and exactly the shape of thing an outsider probes differently than its author |
> | The Entra claim mapping **[F13-R32]** | A `customer_id` that resolves to the wrong company is one customer reading another's positions |
> | The break-glass credential store **[F13-R33..R40]** | A platform-held password hash that did not exist when [NFR-36] was written **[DEC-53]** |
> | The customer usage API **[F13-R46]**, **[F13-R47]** | A second, unattended authorisation surface **[DEC-97]** |
>
> What is left instead: internal review, the deny-by-default rules of §3, automated dependency
> scanning and the threat-model entry **[F13-R40]**. All of those test what we thought of. A
> penetration test is the only item that tests what we did not. Accepting **[DEC-102]** means accepting
> that the first external party to probe the tenancy boundary may be an attacker rather than a
> contractor.

> **Nothing to migrate — [DEC-110], closing [OQ-74].** There is no existing customer-facing identity
> solution. Every customer account is created here, in the customer tenant **[F13-R03]**, through the
> invitation flow **[F13-R21..R22]**. This is consistent with **[DEC-56]** and sits beside
> **[DEC-66]**: the tenancy that already exists holds **employees**; the customer population is
> greenfield. No user import, no password migration (there could not be one — **[DEC-29]**), no legacy
> username collision rule, no dual-run period and no cutover. It removes a work package rather than
> adding one, which is why it is worth writing down: the M size tag assumes this answer.

> **The usage API is a second authorisation surface — [DEC-97].** A customer-facing **usage API** is in
> scope: interval and aggregated net usage per metering point, scoped to the calling company. It is not
> simply another endpoint on a portal session — it is a second population of callers, unattended, with
> its own credential, reaching the same data through the same `customer_id` scope and the same global
> query filter **[F13-R17]**, **[F13-R46]**.
>
> **It carries usage and nothing priced.** No forward price, no price indication, no export of either
> **[DEC-81]**, **[DEC-27]**, **[F13-R47]**. That is a licence restriction rather than a product
> choice, so it is enforced by the surface not having those endpoints at all.
>
> ⚠ **Blocked on transport, not on scope.** [DEC-97]'s source names an API *or* file/FTP delivery
> without choosing; that is **[OQ-95]**. The credential shape follows from the answer — a client
> registration issuing tokens and an FTP account are not the same control, and only one of them can
> reuse anything in this file. The *scope* rule holds either way, which is why the two requirements
> below are written now and the credential is not. §7's "API keys for machine-to-machine customer
> access" bullet is amended accordingly rather than deleted.

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
| Customer MFA | Not exercised — no sign-in | ⚠ **Amended 2026-08-19 by [DEC-92]**: **mandatory**, still enforced by Conditional Access on the corporate tenancy **[DEC-66]**, and the `amr` claim is now **verified** rather than only recorded **[F13-R45]**. Was: *"Entra tenant policy, not the platform. `amr` read as evidence [DEC-51], [F13-R06]"* |
| Role model | Two levels, fed by the development context provider — an **admin** flag on the account, **four-eyes enabled** on the company **[DEC-71]**, **[F13-R41]**, **[F13-R42]** | The same two levels, carried in the token and re-validated against the platform record **[F13-R43]** |
| Customer usage API | Not built | Company-scoped, usage only, never priced **[DEC-97]**, **[F13-R46]**, **[F13-R47]**; transport is **[OQ-95]** |

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

⚠ **The 2026-08-19 round moves the size again, in both directions.** Recorded so the **M** is not
carried forward by habit:

| Change | Effect on this feature |
| --- | --- |
| **[DEC-71]** two-level role model | Small but real: two flags, a claim entry, a re-validation **[F13-R43]**, a different-admin predicate **[F13-R44]** and the provisioning screens that set them |
| **[DEC-92]** mandatory MFA | Small in code — one claim check **[F13-R45]** — and non-trivial in support: every customer user must enrol before first sign-in, and a tenant-side change fails closed |
| **[DEC-97]** customer usage API | The only genuinely new *surface* here, and it is not sized until **[OQ-95]** picks a transport **[F13-R46]**, **[F13-R47]** |
| **[DEC-110]** nothing to migrate | Removes a work package: no import, no dual run |
| **[DEC-102]** no penetration test | Removes a go-live gate and adds residual risk instead of work |

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
| **Admin** | Platform | Boolean, new with **[DEC-71]**, **[F13-R41]**. Set and cleared by a PeakPower employee **[DEC-16]**, never by the customer and never from a request. Grants no extra read or write: its only effect is eligibility to approve or refuse a four-eyes action **[F13-R44]** |
| Status | Platform | `INVITED` · `ACTIVE` · `DEACTIVATED` |

**Four-eyes enabled is not a field on the account — it is a field on the *company* [DEC-71],
[F13-R42].** The two flags do different jobs and belong at different levels: the company flag decides
*whether* a second pair of eyes is required at all, the account flag decides *whose* eyes qualify.
Keeping the mode on the company also means switching it on or off is one change for the whole
customer, not a sweep across every account. Neither flag is derived from anything: there is no
threshold, no value, no first-account-is-admin rule and no default that quietly makes everyone an
admin — an unset flag means non-admin, and a company with the mode on but fewer than two admins is
the edge case in §6.

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
| F13-R06 | ⚠ **Amended 2026-08-19 by [DEC-92]** — the evidence obligation below is unchanged and still required; what is withdrawn is its last clause, that evidence is *the only thing the platform can offer*. The platform now also gates on it **[F13-R45]**. Original text: *"**Customer MFA is governed by Entra tenant policy, not by the platform** **[DEC-51]**. The platform **neither enforces nor exempts** it: there is no MFA setting on a customer account and no endpoint that requires a step-up. It **reads the `amr` claim as evidence**, records it on the session and in the audit trail **[F15](F15-audit-and-observability.md)**, and exposes it to employees answering "was that sign-in second-factored?". ⚠ Because the control lives in the tenant, a change there is invisible to this repository — so the evidence is the only thing the platform can offer, and it must actually be captured rather than assumed."* The recording is what makes an after-the-fact question answerable; **[F13-R45]** is what makes a missing factor stop a session. Both are built. | Must |
| F13-R07 | Sessions use short-lived access tokens (≤ 15 min) with refresh tokens; refresh tokens rotate on use. | Must |
| F13-R08 | Idle timeout of 30 minutes and absolute session limit of 12 hours, both configurable. | Must |
| F13-R09 | Sign-out invalidates the local session and initiates provider sign-out. | Must |
| F13-R10 | Failed logins, lockouts and password resets are handled by the provider; the platform surfaces provider errors without leaking whether an account exists **[DEC-29]**. | Must |
| F13-R11 | Employees can sign in with the organisation's existing corporate identity if the chosen provider supports federation. Entra makes this the default path for employees **[DEC-20]**. | Should |
| F13-R45 | **MFA is mandatory for customer users [DEC-92]**, and the platform **verifies the authentication-method claim** on every customer access token: a token whose `amr` carries no second-factor method is rejected and no session is established. Enforcement stays in Conditional Access on the corporate tenancy **[DEC-66]** — the platform still implements no MFA, no enrolment and no step-up **[F13-R06]** — but it no longer trusts the tenant silently. The accepted method set is **configuration, not a constant**, because Entra's `amr` values change over time; an empty, absent or unrecognised value **fails closed**. Every rejection is logged with the reason **[F15](F15-audit-and-observability.md)**, so "the tenant policy changed under us" is diagnosable in minutes rather than by inference from a support queue. | Must |

### Authorisation

**Built in the PoC [DEC-20].** Every requirement in this section is exercised from the first commit,
fed by the development context provider in **F13-R30** rather than by a token. None of it waits for
authentication. That includes the two-level role model **[F13-R41..R44]**, which the development
context provider therefore has to supply — the two exceptions are **[F13-R46]** and **[F13-R47]**,
which describe a surface **[DEC-97]** that does not exist in the PoC and whose transport is
**[OQ-95]**.

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F13-R12 | Roles come from the token: `customer.user`, `employee.viewer`, `employee.trader`, `employee.finance`, `employee.admin` **[Actors & roles](../00-overview/03-actors-and-roles.md)**. | Must |
| F13-R13 | ⚠ **Amended 2026-08-19 by [DEC-71]**. Original: *"**Every** customer account holds exactly `customer.user`. There is no second customer role and no per-account permission field **[DEC-16]**."* Still true: every customer account holds `customer.user`, and that is the role every ordinary endpoint is written against. No longer true: an account may **additionally** carry the admin flag **[F13-R41]**, projected into the token as a second entry **[F13-R43]**. There is still no third level, still no per-account permission field, and still nothing a customer can grant themselves. | Must |
| F13-R14 | Every customer-portal token carries a `customer_id` claim identifying the **company**, established at provisioning and never derived from a request parameter. | Must |
| F13-R15 | Every customer-portal token also carries an `account_id` claim identifying the **person**. `customer_id` scopes what may be read and written; `account_id` records who did it **[DEC-17]**. | Must |
| F13-R16 | On every request the platform validates that `account_id` belongs to `customer_id` in its own records, and rejects the token if not. | Must |
| F13-R17 | Customer data access is scoped by `customer_id` at the data-access layer — a global query filter — not only in controllers **[Security](../20-architecture/07-security.md)**. | Must |
| F13-R18 | Every endpoint declares its required role explicitly; the default for an undeclared endpoint is deny. | Must |
| F13-R19 | Attempting to access another customer's object returns `404`, not `403`, so the API does not confirm the object exists. | Must |
| F13-R20 | Employees have no implicit write access to customer-owned actions (a trader cannot accept an offer on a customer's behalf). | Must |
| F13-R41 | A customer account carries an **admin** boolean **[DEC-71]**. It is set and cleared by a PeakPower employee **[DEC-16]**, never by the customer, never derived from a request parameter and never defaulted on (no "first account of a company is admin" rule). It grants **no additional read or write**: an admin sees and does exactly what a non-admin sees and does, and a **non-admin may still accept an offer [DEC-18]**. Its only effect is to make the account eligible to give — or refuse — a four-eyes approval **[F13-R44]**. Any endpoint that gates an ordinary read or write on the flag is a defect (§3, rule 11). | Must |
| F13-R42 | A customer **company** carries a **four-eyes enabled** boolean **[DEC-71]**. There is **no threshold**, in euros or in megawatts: ⚠ **[DEC-33]**'s threshold reference data **[F05-R50]** is replaced, not set to zero, so nothing resolves a value at acceptance time. When the flag is off, the admin flag has no behavioural effect anywhere in the platform. When it is on, the actions enumerated in [F05](F05-energy-block-trading.md) require a second admin. Changing the flag is an employee action, audited like any other **[DEC-17]**. | Must |
| F13-R43 | The admin flag reaches the API as a **second entry in the existing `roles` claim** (`customer.admin` beside `customer.user`), so that deny-by-default endpoint declaration **[F13-R18]** keeps one authorisation vocabulary instead of gaining a parallel boolean one. Like `customer_id` and `account_id` it is **re-validated against the platform's own account record on every request**, and the token is rejected on mismatch **[F13-R16]** — a claim that decides who may release money must not be trusted on the token alone, because a token issued before the flag was cleared would otherwise still approve. In the PoC it arrives from the development context provider **[F13-R30]**, for the same reason `account_id` does: the four-eyes path cannot be exercised before authentication exists otherwise. ⚠ **`four_eyes_enabled` is deliberately *not* a claim** — it is company reference data read server-side per request, so switching the mode takes effect immediately instead of at the next token refresh. | Must |
| F13-R44 | The identity layer exposes the single predicate the four-eyes rule is built on: *account B is an **admin** of the **same** company as account A, and B ≠ A* **[DEC-71]**, **[DEC-17]**. A company-level check is not sufficient and **self-approval is rejected at this layer**, not only in the trading UI — the approval API is reached by more than one client over the platform's life. | Must |
| F13-R46 | The customer **usage API** authorises on the same `customer_id` scope as the portal, through the same global query filter **[F13-R17]** and the same `404`-not-`403` behaviour **[F13-R19]** **[DEC-97]**. A usage credential reads the usage of **its own company** and nothing else: there is no cross-company scope, no employee scope and no "all customers" mode on this surface. | Must |
| F13-R47 | The usage API exposes **usage data only** — no forward price, no price indication, no offer and no export of either **[DEC-97]**, **[DEC-81]**, **[DEC-27]**. This is enforced by the surface not carrying those endpoints, rather than by a role check that a later change could relax. ⚠ The credential and the transport are **[OQ-95]** (API or file/FTP); the scope rule above holds whichever is chosen, which is why it is written before the transport is. | Must |

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
| F13-R28 | An account holder can see the other accounts of their own company — name, job title, email, status — so they know who else can act **[DEC-62]**, **[F01-R21]**. Under **[DEC-16]** any colleague can already spend the company's money, so this discloses nothing an employee could not tell them on the phone. ⚠ **Amended 2026-08-19 by [DEC-71]**: the list also shows **who is an admin**. Without it, a user at a four-eyes company cannot tell who to ask for approval, and a 30-minute offer window **[DEC-111]** is not long enough to find out by phone. | Must |
| F13-R29 | Customer users can see their own active sessions and sign them out. | Could |

⚠ **[DEC-71] adds one field to this lifecycle, not a step.** The admin flag is set at creation and
changed afterwards by a **PeakPower employee only** **[DEC-16]**, **[F13-R41]** — there is no
self-service promotion and no customer-side user management (see the tension recorded in §1).
Deactivation **[F13-R24]** also removes the ability to approve, so deactivating the second admin of a
four-eyes company disables the control without disabling the mode. That is flagged at the same point
as deactivating a company's last active account **[F01-R19]**, and it is the edge case in §6.

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
| F13-R34 | Break-glass accounts are **disabled by default** **[DEC-53]**. Enabling one is an explicit, audited action by a second named administrator, is **time-boxed**, and reverts to disabled automatically when the box expires. ⚠ **[DEC-53] does not state the duration.** It is configuration with no shipped default, for the same reason as the four-eyes threshold **[F05-R50]**: a guessed window is either too short to be usable in an incident or long enough to become a standing account. Set it before the path is enabled for the first time. ⚠ **The comparison, not the requirement, is dated 2026-08-19**: **[DEC-71]** replaced the four-eyes threshold **[F05-R50]** with a per-company mode, so there is no longer a threshold to be analogous to. The reasoning stands unchanged on its own, and **[DEC-53]** is untouched — the duration is still unset and is still **[OQ-89]**. | Must |
| F13-R35 | Credentials are stored **only as a hash**, using a current memory-hard password hash with per-credential salt, and are never recoverable, never logged and never displayed after issue **[DEC-53]**. Rotation is scheduled, and is **mandatory after every use** — a break-glass password that survives the incident it was used in is a standing credential wearing an emergency label. | Must |
| F13-R36 | Break-glass sign-in requires a **second factor that does not depend on the identity provider** **[DEC-53]** — a platform-verified TOTP secret or a hardware token, enrolled out of band. A second factor delivered through Entra, or through anything federated to it, fails the only test that matters: it will be unavailable exactly when the path is needed. | Must |
| F13-R37 | **Every break-glass authentication attempt, successful or not, raises an immediate alert** over a channel that does not depend on the identity provider, and is written to the audit log with the named account, timestamp, source address, the second-factor result and the stated reason **[DEC-53]**, **[F15](F15-audit-and-observability.md)**. Enabling, disabling, rotation and failed second factors alert on the same channel. Silent break-glass is indistinguishable from a compromise. | Must |
| F13-R38 | A break-glass session grants the **minimum function set** needed to run the platform through an outage, and **never** more than the same employee's normal roles **[F13-R12]**, **[F13-R20]**. It gives no customer-portal access and no ability to act on a customer's behalf. ⚠ **The function set itself is not specified by [DEC-53]** — it has to be decided with operations, written down, and enforced as a role rather than assumed from "admin". Until it is, the safe reading is read-only plus the specific actions an incident actually requires. It is registered as **[OQ-89]**, together with the time box **[F13-R34]**, and the 2026-08-19 round did **not** answer it. | Must |
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
    ⚠ **Amended 2026-08-19 by [DEC-92].** The *enforcement* is still somebody else's — Conditional
    Access on the corporate tenancy **[DEC-66]** — and the platform still never claims more than `amr`
    says. What changes is that it now makes exactly one decision on the evidence: **no second factor,
    no session** **[F13-R45]**.
11. **Two levels, and the flag grants nothing [DEC-71].** `customer.admin` is eligibility to approve,
    not extra access. Any code path that gates an ordinary read or write on it — a report, a screen, a
    higher limit — is a defect, because it turns one bit into an org chart **[F13-R41]**.
12. **Nobody approves their own action [DEC-71], [DEC-17].** The approver must be a **different admin
    account of the same company**, checked in the identity layer **[F13-R44]** rather than in a client.
    A company-level check would let one person approve themselves from a second tab.
13. **The usage API is company-scoped and carries no price [DEC-97], [DEC-81].** It reads through the
    same `customer_id` filter as the portal **[F13-R46]** and has no price endpoints to reach
    **[F13-R47]**. An unattended credential is exactly where a scope mistake goes unnoticed longest.

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
  "roles": ["customer.user", "customer.admin"],
                                     // customer.user: every account, always      [DEC-16]
                                     // customer.admin: the admin flag, optional  [DEC-71]
                                     // two levels, no third; re-validated against
                                     // the platform record on every request      [F13-R43]
  "name": "Jan de Vries",
  "email": "j.devries@vandersteen.nl",
  "locale": "nl-NL",
  "amr": ["pwd", "mfa"],             // VERIFIED, not merely recorded - a token with
                                     // no second factor is rejected   [DEC-92], [F13-R45]
                                     // (was: evidence only - tenant policy decides [DEC-51])
  "exp": 1785312000
}
// Not a claim, on purpose: four_eyes_enabled. It is a property of the COMPANY, read
// server-side per request [F13-R42], so switching the mode takes effect immediately
// instead of at the next token refresh.  [DEC-71]
```

Two identifiers, two jobs — and they must not be confused. ⚠ **Since [DEC-71] there is a third claim
below**, which is not an identifier and answers a different kind of question:

| Claim | Answers | Used for |
| --- | --- | --- |
| `customer_id` | *Whose data is this?* | Query scoping, row-level security, `404` on cross-customer access |
| `account_id` | *Who is doing it?* | Attribution on trade events, wallet entries and audit records |
| `customer.admin` in `roles` | *May this person approve?* | Four-eyes eligibility, and nothing else **[DEC-71]**, **[F13-R41]** |

Neither is ever accepted from the request. `account_id` grants nothing — two accounts of one company
with different `account_id` values have byte-identical permissions. ⚠ **Amended 2026-08-19 by
[DEC-71]**: the first sentence stands for all three claims, and `account_id` still grants nothing. The
last clause is now narrower — two accounts have byte-identical permissions **on every ordinary read
and write**, and differ only in whether they may stand as the second pair of eyes. That is the whole
difference, and it is deliberately expressed in the `roles` claim rather than as a new boolean so the
deny-by-default endpoint declaration **[F13-R18]** keeps one vocabulary.

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
| **Customer token whose `amr` carries no second factor** | Rejected; no session is established **[F13-R45]**, **[DEC-92]**. The remedy is enrolment in the tenant, which the platform cannot perform on the user's behalf, so the sign-in fails with a message that says exactly that and a support route. ⚠ If this starts happening to *everyone*, the tenant policy changed **[DEC-66]**, not the platform |
| **Token carries `customer.admin` but the platform record does not** | Rejected, exactly like a `customer_id` / `account_id` mismatch **[F13-R43]**, **[F13-R16]**. This is the case that matters: a token minted before the flag was cleared must not be able to approve a payment for the rest of its 15 minutes **[F13-R07]** |
| **Four-eyes is enabled and the company has only one admin account** | The sensitive action can be taken but can never be approved, so it expires. The control is structural — the approver must be a *different* admin **[F13-R44]** — so a four-eyes company needs at least two admins. Flagged at provisioning and again when the second admin is deactivated or un-flagged, at the same point as deactivating a company's last active account **[F01-R19]** |
| **A non-admin accepts an offer at a four-eyes company** | Allowed. A non-admin keeps every ordinary privilege **[DEC-18]**, **[F13-R41]**; the approval that follows still has to come from an admin, and never from the acceptor **[F13-R44]**. ⚠ **[DEC-71]** words its rule around *an admin* taking the action, while **[DEC-18]** leaves acceptance open to any account. The reading here honours both. If the intent was that only admins may take sensitive actions at a four-eyes company, that contradicts **[DEC-18]** and has to be decided explicitly rather than inferred |
| **Usage-API credential asks for a price** | There is no such endpoint to ask **[F13-R47]**, **[DEC-81]**. Not a `403` and not an empty result — the surface does not carry prices at all, which is the only version of this rule that cannot be relaxed by a later configuration change |
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
  ⚠ **Amended 2026-08-19 by [DEC-92]**: still out of scope to *implement* MFA, run enrolment, offer a
  step-up or hold a per-account exemption. **Verifying** the authentication-method claim is now in
  scope **[F13-R45]**.
- **Any intra-company role beyond the admin flag** — a viewer / trader / approver hierarchy stays out
  **[DEC-71]**, **[DEC-16]**. Two levels, and the second exists only for four-eyes.
- **Migration or import from an existing customer-facing identity solution** — there is none
  **[DEC-110]**. No user import, no password migration, no dual run.
- **An external penetration test before go-live** — not budgeted **[DEC-102]**; **[NFR-36]** is amended
  and the residual risk is recorded in §1 rather than dropped.
- SCIM provisioning from customer directories.
- ~~API keys for machine-to-machine customer access (the PVNed endpoint has its own, separate
  scheme).~~ ⚠ **Reversed 2026-08-19 by [DEC-97]** for one surface only: a customer-facing **usage
  API**, company-scoped and usage-only **[F13-R46]**, **[F13-R47]**. Its credential and transport wait
  on **[OQ-95]**. Everything priced stays out **[DEC-81]**, and the PVNed endpoint still has its own
  separate scheme.

## 8. Dependencies

| Depends on | Why |
| --- | --- |
| [Identity provider](../30-integrations/05-identity-provider.md) | Provider selection and configuration |
| [Security](../20-architecture/07-security.md) | Enforcement design |
| [F05 Energy block trading](F05-energy-block-trading.md) | Four-eyes consumes the admin flag, the company mode and the different-admin predicate **[DEC-71]**, **[F13-R41..R44]**; the action inventory lives there |
| [F03 Consumption visualisation](F03-consumption-visualisation.md) | The usage API serves the same net-usage data under the same company scope **[DEC-97]**, **[F13-R46]** |
| [API contracts](../20-architecture/05-api-contracts.md) | The usage API surface and its credential, once **[OQ-95]** settles transport |
| [Non-functional requirements](../20-architecture/08-non-functional-requirements.md) | **[NFR-36]** is amended by **[DEC-102]** — no penetration test is budgeted before go-live |

## 9. Open questions

| Ref | Question |
| --- | --- |
| ~~[OQ-03]~~ | ~~Which identity provider?~~ **Closed by [DEC-20]** — Microsoft Entra ID in production, no authentication in the PoC |
| ~~[OQ-04]~~ | ~~Are differentiated roles needed within a customer?~~ **Closed by [DEC-16]** — all accounts of a company are equal. ⚠ **Amended 2026-08-19 by [DEC-71]**: still no differentiated *roles*, but one differentiated *bit* — the admin flag **[F13-R41]**, which exists solely so four-eyes can name an approver and grants no additional access |
| ~~[OQ-85]~~ | ~~What is the four-eyes threshold, and is it one global figure or per customer?~~ **Closed by [DEC-71]** — there is **no threshold**, in euros or megawatts. Four-eyes is a per-company **mode** **[F13-R42]**, so **[DEC-33]**'s threshold table **[F05-R50]** is replaced rather than populated. Recorded here because it is the reason the admin flag exists at all; the action list lives in [F05](F05-energy-block-trading.md) |
| ~~[OQ-43]~~ | ~~Is MFA mandatory for customer users?~~ **Closed by [DEC-51]** — governed by **Entra tenant policy**, not by the platform. The platform neither enforces nor exempts; it reads `amr` as evidence **[F13-R06]**. Employee MFA remains mandatory **[F13-R05]**. ⚠ **Amended 2026-08-19 by [DEC-92]** — closed on stronger terms: MFA for customer users is **mandatory**. Enforcement stays in Conditional Access on the corporate tenancy **[DEC-66]**, but the platform **verifies the authentication-method claim** and rejects a token without a second factor **[F13-R45]**. Onboarding friction is accepted |
| ~~[OQ-60]~~ | ~~Is an external penetration test budgeted before go-live?~~ **Closed by [DEC-102]** — **no**. ⚠ **[NFR-36]** assumed one and is amended; the residual risk is recorded in §1 with the surface it leaves untested — tenancy isolation **[F13-R17]**, **[F13-R19]**, **[F13-R30]**, the claim mapping **[F13-R32]**, the break-glass credential store **[F13-R33..R40]** and the usage API **[F13-R46]**. Internal review and the deny-by-default rules of §3 test what we thought of; nothing now tests what we did not |
| ~~[OQ-74]~~ | ~~Is there an existing customer-facing identity solution to reuse or migrate from?~~ **Closed by [DEC-110]** — **no**. Greenfield, consistent with **[DEC-56]**, and unaffected by **[DEC-66]**, which confirms an **employee** directory only. No user import, no password migration, no legacy username rule, no dual run |
| ~~[OQ-44]~~ | ~~What is the break-glass procedure if the provider is unavailable?~~ **Closed by [DEC-53]** — a platform-held username and password for **named employee accounts**, disabled by default, second-factored off-provider, alerted, audited and rehearsed **[F13-R33..R40]**. ⚠ Two details the decision leaves to be set before first use: the **time box** on an enabled account **[F13-R34]** and the **function set** a break-glass session may reach **[F13-R38]** |
| ~~[OQ-88]~~ | ~~Entra ID was chosen as the production identity provider, but there is no Microsoft tenancy — which decision moves?~~ **Closed by [DEC-66]** — **neither**. Entra ID uses PeakPower's **existing corporate Microsoft tenancy**; **[DEC-56]** is clarified rather than reversed and means no Azure **subscription, landing zone or naming standard**, with the new subscriptions created **under** that same tenant. Employee identity stays single, so **[DEC-51]** and **[DEC-53]** are unaffected and this feature can be estimated. ⚠ **The residue is a dependency, not a question**: *access* to the tenancy, with a named owner and a date in [Roadmap §2.1](../70-delivery/01-roadmap-and-phasing.md). It is deliberately not registered under an `OQ` number, and **[DEC-67]** makes **[F13-R32]** inherit it |
| ~~[OQ-73]~~ | ~~Does PeakPower run Microsoft 365 or another corporate directory?~~ **Effectively answered by [DEC-20]** and **confirmed by [DEC-66]** — the corporate Microsoft tenancy exists and is the one Entra ID uses |
| ~~[OQ-78]~~ | ~~Are credentials owned by the identity provider, or must the platform hold username and password itself?~~ **Closed by [DEC-29]** — the provider owns them; the platform never stores a customer password. ⚠ **Amended by [DEC-53]**: named employee break-glass accounts are the one bounded exception **[F13-R33]** |
| ~~[OQ-80]~~ | ~~Should a company's accounts be visible to each other in the customer portal?~~ **Closed by [DEC-62]** — yes **[F13-R28]**, **[F01-R21]** |
| **[OQ-89]** | **How long is a break-glass account enabled for, and what function set may a break-glass session reach?** ⏳ **Still open after 2026-08-19** — the round touched neither. **[DEC-53]** and **[DEC-29]** are unchanged, so the time box **[F13-R34]** and the function set **[F13-R38]** are still configuration with no shipped default. Both are needed **before the path is first enabled**, and because **[DEC-53]** makes rehearsal non-negotiable **[F13-R39]**, before the first rehearsal too. ⚠ The analogy [F13-R34] used — "for the same reason as the four-eyes threshold" — lost its referent when **[DEC-71]** replaced **[F05-R50]**; the reasoning did not |
| **[OQ-95]** | **Is customer usage delivered over an API, over file/FTP, or both?** ⏳ **Opened 2026-08-19 by [DEC-97]**, whose source names both transports without choosing. It decides the *credential*, not the scope: a client registration issuing tokens can reuse the `customer_id` scoping in **[F13-R46]**; an FTP account cannot, and would need its own per-company isolation and its own audit trail. **[F13-R46]** and **[F13-R47]** hold either way, so the rule is written and the mechanism waits |
