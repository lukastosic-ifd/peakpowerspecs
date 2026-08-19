# Integration — Identity Provider

**Direction:** both · **Protocol:** OpenID Connect · **Criticality:** highest availability dependency

Feature spec: [F13 Identity & access](../10-features/F13-identity-and-access.md).

> **Decided.** The production identity provider is **Microsoft Entra ID** **[DEC-20]**. The
> **provider owns credentials — the platform never stores a customer password** **[DEC-29]**. The
> **proof of concept runs with no authentication at all** **[DEC-20]**.
>
> This closes **[OQ-03]** and **[OQ-78]**, and effectively answers **[OQ-73]** — Entra only makes
> sense against an existing Microsoft tenancy.
>
> ⚠ **Skipping authentication in the PoC is not skipping tenancy.** See §7.
>
> **The tenancy exists, and it is the corporate one — [DEC-66].** Entra ID runs on **PeakPower's
> existing corporate Microsoft tenancy**. It is not created for this project and it is not a second
> directory: the premise **[DEC-20]** was taken on holds. **[DEC-56]** — "no existing Azure tenancy" —
> is **clarified, not reversed**: it means no Azure **subscription, landing zone or naming standard**,
> and Azure subscriptions are created **under** this same Entra tenant
> ([Deployment §1.1](../20-architecture/09-deployment.md)). Employee identity therefore stays
> **single**, which is what **[DEC-51]** (MFA as tenant policy) and **[DEC-53]** (break-glass covering
> the outage of *the* provider) each assume and neither states.
>
> ⚠ **What is outstanding is *access*, not the tenancy — and it is a dependency, not a question.**
> Access is administered outside the delivery team, so it is tracked on the Phase 0 dependency list
> with a named owner and a date ([Roadmap §2.1](../70-delivery/01-roadmap-and-phasing.md)), not in
> [80-open-questions.md](../80-open-questions.md).
>
> **[DEC-67] — the claim-mapping spike runs against the corporate tenancy**, not a throwaway
> developer tenant, so the mapping is proved **once** against the configuration that will actually
> run. ⚠ The cost is explicit: **tenant access is on the critical path by choice**, and the
> `customer_id` claim mapping — the part §2.2 and §3 single out as Entra's weakest — **stays unproven
> until access arrives**. Two mitigations, neither optional: build against **standard OIDC with a
> local Keycloak or Authentik container** (§7), and keep the access dependency **dated**. See
> **[R-24]**, reduced from 16 to 9 and retitled.
>
> **Two earlier decisions change what this document specifies:**
>
> - **[DEC-53] — break-glass, amending [DEC-29].** The platform holds a username and password hash for
>   a small set of **named employee accounts**, used only when this provider is unavailable. Closes
>   **[OQ-44]**. Bounded exception, employees only, customers unaffected — §6.1 and
>   [F13-R33..R40](../10-features/F13-identity-and-access.md).
> - **[DEC-51] — customer MFA is the tenant's, not the platform's.** Closes **[OQ-43]**. The platform
>   neither enforces nor exempts customer MFA and reads `amr` as evidence — §1, §4.2. Employee MFA
>   remains mandatory **[NFR-33]**.
>   ⚠ **Amended 2026-08-19 by [DEC-92].** Customer MFA is **mandatory**. *Where* it is enforced does
>   not change — Conditional Access in the corporate tenancy **[DEC-66]**, not code in this platform —
>   but it is no longer optional, and the platform now **verifies the authentication-method claim
>   (`amr`) on every customer token instead of merely recording it**. A customer token that does not
>   evidence a second factor is **rejected**, not admitted-and-logged. §1, §4.2, §6. **[OQ-43] stays
>   closed**, on the stronger answer. Onboarding friction is accepted **[DEC-92]**.
>
> **Three further decisions from the 2026-08-19 round land on this document:**
>
> - **[DEC-71] — customer accounts carry an `admin` flag and a company carries a `four_eyes_enabled`
>   flag.** ⚠ **Amends [DEC-16]**, which is why it appears here at all: DEC-16 meant the provider
>   needed to carry **no role** for customers, and now exactly one has to reach the API. **§4.4**
>   states the choice, the two routes rejected and what the choice costs. In one line: the **platform
>   holds the flag** and an employee sets it **[F13-R41]**; the **provider carries a mirror** of it as
>   a second entry in the existing `roles` claim — `customer.admin` beside `customer.user`
>   **[F13-R43]**; and the mirror is **re-validated against the platform's own account record on every
>   request** and never trusted alone. A **directory group mapping is rejected**, and
>   `four_eyes_enabled` is deliberately **not** a claim at all **[F13-R42]**.
>   ⚠ **[DEC-67]'s spike grows by one claim.** It was scoped around `customer_id`, with `account_id`
>   alongside it; it must now also prove that the provider emits **and stops emitting** the
>   `customer.admin` entry. Same tenant, same access dependency, one more thing that stays unproven
>   until access arrives — §3, §4.4, §7.2.
> - **[DEC-110] — there is no existing customer-facing identity solution to reuse or migrate from.**
>   Greenfield, consistent with **[DEC-56]**. **Closes [OQ-74]**: nothing to import, no coexistence
>   period, and **no migration plan in this document** (§8).
> - **[DEC-97] — customers get programmatic access to their own usage data.** That access needs an
>   authorisation model of its own, scoped to the calling company, and it cannot reuse an interactive
>   customer session because **[DEC-92]** now demands a second factor on one. **§4.5**; the transport —
>   API, file/FTP, or both — is **[OQ-95]**.
>
> **[DEC-29], [DEC-53], [DEC-66] and [DEC-67] are unchanged by the 2026-08-19 round**, and
> **[OQ-89]** — the break-glass time box and reachable function set — **stays open** (§6.1, §8).

---

## 1. What the platform needs

| Requirement | Why |
| --- | --- |
| OIDC authorisation code + PKCE | Standard for SPAs; no client secret in the browser |
| **Two isolated realms** — customers and employees | Different populations, different trust, different branding. A customer must never obtain an employee token |
| Custom claims (`customer_id` **and** `account_id`) | `customer_id` scopes the data and is the most security-critical field in the system **[F13-R14]**; `account_id` identifies the person for attribution **[F13-R15]**. ⚠ **Extended 2026-08-19 by [DEC-71]**: a **third** thing the provider must be configured to emit — the `customer.admin` entry in `roles` (§4.4) — which is why the mapping spike gets bigger rather than the model |
| ~~Several accounts per company, all with the same single role~~ ⚠ **Amended 2026-08-19 by [DEC-71]** — **two** levels, and not one more | A company has many people; none of them has more rights than another **[DEC-16]**. ⚠ Since **[DEC-71]** an account is an **admin** or it is not **[F13-R41]**. The flag grants **no extra read or write** — a non-admin still requests prices, sees the wallet and accepts offers **[DEC-18]**; it makes the account *eligible to approve or refuse* a four-eyes action **[F13-R44]**. Everything **[DEC-16]** says about *who creates accounts* — PeakPower employees — is untouched |
| Username-based login, distinct from the email address | The stakeholder model is username + password **[F13-R04]**. The username is the login identifier; the password is the provider's and never the platform's **[DEC-29]** |
| MFA, **mandatory for employees** | [NFR-33], **[F13-R05]** |
| **MFA for customers configured in the tenant, and `amr` emitted** | **[DEC-51]** puts the customer MFA policy in the **tenant**, not in the platform. The platform's requirement is therefore not enforcement but **evidence**: `amr` must be present in customer tokens so a sign-in can be shown to have been second-factored **[F13-R06]**, **[§4.2](#42-required-claims)**. ⚠ **Amended 2026-08-19 by [DEC-92]** — **mandatory for customers, and verified.** The tenant is still where MFA is enforced **[DEC-66]**, so this stays a *configuration* requirement on the provider; what changes is that `amr` becomes an **input to a decision** and not only a record. A customer token whose `amr` carries no second-factor method is **rejected and no session is established** **[F13-R45]**. The accepted method set is configuration, because Entra's `amr` values change; absent, empty or unrecognised **fails closed** |
| **A `customer.admin` entry in the customer `roles` claim, settable and clearable through the provisioning API** | **[DEC-71]**. The platform owns the flag **[F13-R41]**; the provider carries the mirror so that deny-by-default endpoint declaration **[F13-R18]** keeps **one** authorisation vocabulary instead of gaining a parallel boolean one **[F13-R43]**. Clearing must be a provisioning call, not a support ticket in a directory nobody on the team administers — §4.4 |
| **A non-interactive, company-scoped credential for the customer usage API** | **[DEC-97]**. The usage API has no human at the keyboard, so it cannot reuse an interactive customer session: **[DEC-92]** now requires a second factor on one, and an unattended caller has none to present. §4.5. ⚠ Whether this is an OIDC client at all depends on **[OQ-95]** — file/FTP delivery would not involve this provider |
| **A sign-in path that does not depend on this provider, for named employees** | **[DEC-53]**. The availability risk is Microsoft's now, not PeakPower's — but "nobody can sign in to the financial application" still needs an answer that does not route through the thing that is down. §6.1 |
| Programmatic user provisioning | Employees invite customer users from the portal |
| Immediate session revocation | Deactivating a user must take effect at once |
| Branded, Dutch-language login for customers | It is part of the product experience |
| EU data residency | [NFR-41] |
| Federation with a corporate directory | Employees should not have a second password. **[DEC-66]** makes this concrete rather than conditional: the corporate directory **exists** and is the tenant employees already sign in to, so employee federation is the *default* path and not a migration. ⚠ It also means one directory now gates the employee portal **and** the Azure control plane — the reason break-glass enablement is a database row ([Deployment §5](../20-architecture/09-deployment.md)) rather than a portal action |

## 2. Options

Retained as the recorded rationale for **[DEC-20]**, not as a live choice. The comparison was kept so
the decision could be revisited honestly if the tenancy assumption behind it changed. **[DEC-66]**
confirms that assumption rather than disturbing it, so the comparison is now history rather than a
hedge — keep it for the reasoning, not as an escape route.

### 2.1 Authentik — self-hosted

| | |
| --- | --- |
| **Cost** | Infrastructure only; open source |
| **Control** | Complete: flows, branding, claims, data location |
| **Burden** | **PeakPower's.** Patching, HA, backup, upgrade, and being on call for it |
| **Fit** | Realms, custom claims, MFA and a provisioning API all supported |
| **Risk** | It becomes a single point of failure that PeakPower operates. If it is down, nobody — customer or employee — can sign in to a financial application |

### 2.2 Microsoft Entra ID — **chosen [DEC-20]**

| | |
| --- | --- |
| **Cost** | Employees likely already licensed; customer-facing identity is priced per monthly active user, and at a few hundred users that is small |
| **Control** | Good; branding on the customer-facing tenant is workable, less flexible than self-hosting |
| **Burden** | Managed. Microsoft's availability, Microsoft's patching |
| **Fit** | Employee federation is immediate — PeakPower's corporate Microsoft tenancy exists **[DEC-66]**, so the conditional in this row is discharged. Custom claims via claims mapping or a token-issuance extension — **this is the fiddliest part, and [DEC-67] leaves it unproven until tenant access arrives**. ⚠ **[DEC-71]** adds a third claim to that same unproven surface: the `customer.admin` role entry, whose *removal* has to work as reliably as its issue (§4.4) |
| **Risk** | Moderate lock-in; customer-identity product naming and packaging has changed more than once |

### 2.3 Okta / Auth0

| | |
| --- | --- |
| **Cost** | Highest of the three |
| **Control** | Good; strong branding and flow customisation |
| **Burden** | Managed |
| **Fit** | Excellent — custom claims, actions and provisioning APIs are a strength |
| **Risk** | Cost grows with users; moderate lock-in |

## 3. Comparison

| Criterion | Weight | Authentik | Entra ID | Okta |
| --- | :--: | :--: | :--: | :--: |
| Total cost at ~200 users | High | ●●● | ●●● | ● |
| Operational burden on PeakPower | **High** | ● | ●●● | ●●● |
| Availability guarantee | **High** | ● | ●●● | ●●● |
| Realm separation | High | ●●● | ●● | ●●● |
| Custom claim support | High | ●●● | ●● | ●●● |
| Customer branding | Medium | ●●● | ●● | ●●● |
| Employee federation | Medium | ●● | ●●● | ●●● |
| EU residency | High | ●●● | ●●● | ●●● |
| Provisioning API | Medium | ●●● | ●●● | ●●● |
| Time to first login | Medium | ● | ●●● | ●●● |
| Lock-in | Low | ●●● | ●● | ●● |

### Decision — Entra ID **[DEC-20]**

**Entra ID.** Employees federate immediately against the **existing corporate Microsoft tenancy** —
confirmed by **[DEC-66]**, which is the premise this decision was taken on — and the availability of
the login path stops being PeakPower's problem. The comparison table shows where the cost sits: Entra
scores lowest of the three on realm separation, custom claims and branding, and the decision accepts
that in exchange for operational burden and availability, both weighted **high**.

Two tenants are involved and neither is a second *employee* directory: the **corporate tenant** for
employees, and an **External ID tenant** for customers **[F13-R03]**. That split was always the
design. What **[DEC-66]** rules out is a *third* — a project-created Entra tenant holding a second set
of employee accounts, which is the outcome **[DEC-51]** and **[DEC-53]** silently assume away.

⚠ **The `customer_id` claim mapping is the fiddliest part of the choice** — claims mapping or a
token-issuance extension, per §2.2 and §4.2. **[DEC-20]** requires it to be spiked before Phase 1
ends, because it is the one part of the decision that could still surprise.

⚠ **[DEC-71] enlarges that spike without changing its shape.** Three claims now have to come out of
the same configuration — `customer_id`, `account_id` and the `customer.admin` entry in `roles` (§4.4)
— and the third has a property the first two do not: it **changes during an account's life**. Proving
that Entra can *emit* it is half the work; proving that clearing the flag stops it being emitted, and
how long that takes to propagate, is the half that decides whether the re-validation in **[F13-R43]**
is a belt-and-braces check or the only thing standing between a revoked admin and a payment approval.
Same tenant, same access dependency **[DEC-67]**, one more thing on the list.

⚠ **[DEC-67] decides where that spike runs, and buys certainty with schedule.** It runs against the
**corporate tenancy**, not a throwaway developer tenant — one proof, against the configuration that
will actually run, rather than two proofs against two directories that may differ in policy. The price
is stated rather than discovered: **the weakest part of the chosen provider stays unproven until
tenant access is granted**, and granting it is not the delivery team's to do
([Roadmap §2.1](../70-delivery/01-roadmap-and-phasing.md)). §7 says what can and cannot be proved in
the meantime. See **[R-24]**.

**Authentik** would have been right only against a specific requirement the managed options cannot
meet, or a firm policy against a managed identity provider. Self-hosting is not the cheap option once
the cost of operating it is counted honestly: patching, high availability, backups, upgrade testing,
and someone reachable at 3am when nobody can log in.

The decision does not license vendor coupling. **The platform code stays provider-agnostic** —
standard OIDC, one provisioning adapter behind an interface, no vendor SDK in domain or application
code. Entra is a configuration, and §7 keeps it one.

## 4. Configuration

### 4.1 Clients

| Client | Type | Flow | Redirect |
| --- | --- | --- | --- |
| `peakpower-customer-portal` | Public SPA | Code + PKCE | `https://portal.peakpower.example/auth/callback` |
| `peakpower-employee-portal` | Public SPA | Code + PKCE | `https://office.peakpower.example/auth/callback` |
| `peakpower-provisioning` | Confidential | Client credentials | — |
| `peakpower-customer-usage` | Confidential, **one registration per customer company** | Client credentials | — |

⚠ **The fourth client is conditional on [OQ-95], and it is listed anyway.** **[DEC-97]** puts customer
access to usage data in scope; the transport — HTTP API, file/FTP, or both — is undecided. If it is an
API, it is this registration and §4.5 governs it. If it is file delivery, **this provider is not
involved at all** and the company isolation has to be rebuilt in the file layer, with its own
credential store and its own audit trail. That is the reason **[OQ-95]** is not a detail: it decides
whether an existing, understood mechanism is reused or a second one is built.

### 4.2 Required claims

| Claim | Customer realm | Employee realm |
| --- | --- | --- |
| `sub` | ✅ | ✅ |
| `email` | ✅ | ✅ |
| `name` | ✅ | ✅ |
| `preferred_username` | ✅ | ✅ |
| `roles` | ~~`customer.user` (always exactly this)~~ ⚠ **Amended 2026-08-19 by [DEC-71]:** `customer.user`, **plus `customer.admin` when the platform record says the account is an admin** **[F13-R41]**, **[F13-R43]** — §4.4 | one or more `employee.*` |
| `customer_id` | ✅ **required** — the company | — |
| `account_id` | ✅ **required** — the person | — |
| `locale` | ✅ | — |
| `amr` | ~~✅ (evidence only — the tenant decides, the platform records [DEC-51])~~ ⚠ **Amended 2026-08-19 by [DEC-92]:** ✅ **required and verified** — a token whose `amr` carries no accepted second-factor method is **rejected** **[F13-R45]** | ✅ (MFA evidence) |
| `aud` | `peakpower-customer-api` | `peakpower-employee-api` |
| `aud` (usage client) | `peakpower-customer-usage-api` — a **separate audience**, so a usage token cannot be replayed against the portal API and a portal token cannot be replayed against the usage API (§4.5) | — |

~~**`amr` in the customer realm is not an authorisation input.** No endpoint requires it, no role depends
on it and the platform never refuses a token for lacking it **[DEC-51]**, **[F13-R06]**. It is captured
on the session and in the audit trail so that "was that sign-in second-factored?" is answerable
afterwards.~~ Requiring MFA — or exempting anyone from it — is a **tenant configuration** change, made by
whoever administers the customer tenant, and is invisible to this repository. That is the trade
**[DEC-51]** accepts, and the reason the evidence has to be captured rather than assumed.

⚠ **Amended 2026-08-19 by [DEC-92] — `amr` is now the one authorisation input the tenant supplies.**
The struck sentences above no longer hold. MFA is **mandatory** for customer users, and the platform
**checks** rather than merely records:

| | Before **[DEC-51]** | After **[DEC-92]** |
| --- | --- | --- |
| Where MFA is enforced | Conditional Access in the tenant **[DEC-66]** | **Unchanged** — Conditional Access in the tenant. No MFA, enrolment or step-up is implemented here |
| Whether it is optional | Tenant's choice; the platform neither required nor exempted | **Mandatory.** Not a tenant preference the platform tolerates |
| What the platform does with `amr` | Records it on the session and in the audit trail | Records it **and gates on it**: no accepted second-factor method → **no session** **[F13-R45]** |
| A token with `amr` absent, empty or unrecognised | Admitted and logged | **Rejected.** Fails closed, with the reason logged **[F15](../10-features/F15-audit-and-observability.md)** |
| The accepted method set | Not applicable | **Configuration, not a constant** — Entra's `amr` values change over time, and a hard-coded list turns a Microsoft rename into an outage |

⚠ **What this buys and what it costs.** It buys the end of silent trust: previously a relaxed tenant
policy was invisible here, and a customer could sign in with a password alone while the platform
recorded that fact and admitted them anyway. Now the same relaxation shows up immediately as failed
sign-ins with a logged reason, which is diagnosable in minutes. It costs onboarding friction — a
customer who has not enrolled a second factor **cannot be let in by the platform**, because the
platform cannot enrol them either; the sign-in fails with a message saying exactly that and a support
route. **[DEC-92]** accepts that friction explicitly. ⚠ It also creates a **mass-failure mode that has
no platform-side fix**: if the tenant's policy changes, *every* customer fails at once and the remedy
is in the tenant, not in a deployment — §6.

### 4.3 Token lifetimes

| Token | Lifetime |
| --- | --- |
| Access | 15 min |
| Refresh | 12 h, rotating, reuse detection revokes the family |
| ID | 15 min |
| **Usage-API access (client credentials)** | **60 min, no refresh token** — an unattended caller re-authenticates with its own credential instead of holding a long-lived one. ⚠ Provisional, pending **[OQ-95]**; it does not exist if the transport is file delivery |

⚠ **15 minutes is now load-bearing in a way it was not, because of [DEC-71].** The `customer.admin`
entry is a *mirror* of platform state (§4.4), so a token minted before an admin flag was cleared would
otherwise stay able to approve for the rest of its life. That is why **[F13-R43]** re-validates the
claim against the platform record on **every** request rather than relying on the access-token
lifetime: 15 minutes is an acceptable window for a stale display name and an unacceptable one for who
may release money.

### 4.4 How the admin role reaches the platform — decided **[DEC-71]**

**[DEC-16]** meant this document had nothing to say about roles for customers: every account of a
company had identical privileges, so the provider carried none. **[DEC-71]** qualifies that with
exactly one bit — an account is an **admin** or it is not **[F13-R41]** — and that bit has to arrive
at an authorisation decision somehow. Three routes were possible. This section names which one, and
says what the other two would have cost, because the question is asked once and answered for the life
of the system.

| Route | Verdict | Reasoning |
| --- | :--: | --- |
| **Directory group mapping** — a group in the customer tenant, mapped to a role claim | ❌ **Rejected** | It puts the flag in a directory **administered outside the delivery team**, which is the same dependency **[DEC-67]** already pays for on the mapping spike. Worse, it inverts **[DEC-16]**: setting the flag would stop being a PeakPower employee action in the portal **[F13-R41]** and become a tenant-administration action, so granting approval rights would leave the audit trail **[DEC-17]** that makes four-eyes meaningful in the first place |
| **Provider-authoritative claim** — the token is the truth, no platform record | ❌ **Rejected** | Revocation would then wait for the next token, up to the full **15 minutes** of §4.3. On the one flag that decides who may release money and approve a withdrawal **[DEC-83]**, a 15-minute window in which a demoted admin can still approve is not a trade worth making. It also leaves the platform unable to answer "who was an admin on 3 June?" from its own data |
| **Platform-held state, mirrored into the token, re-validated per request** | ✅ **Chosen** | The platform's `customer_account` record is the source of truth **[F13-R41]**; the provider carries `customer.admin` in `roles` so deny-by-default endpoint declaration **[F13-R18]** keeps **one** vocabulary; and **every request re-validates the claim against the record** **[F13-R43]**, exactly as it already does for `customer_id` and `account_id` **[F13-R16]** |

**What each side owns.**

| | Platform | Provider |
| --- | --- | --- |
| `admin` flag | **Source of truth.** Set and cleared by a PeakPower employee **[DEC-16]**, **[F13-R41]**, audited **[DEC-17]** | A mirror, written by the provisioning adapter (§5) |
| `customer.admin` claim | Read, then **re-validated against the record**; mismatch rejects the token **[F13-R43]** | Emits it, or does not |
| `four_eyes_enabled` | **Company reference data, read server-side per request [F13-R42]** | ⚠ **Not a claim, on purpose.** Switching the mode takes effect on the next request instead of the next token refresh, and a company-level flag has no business being copied onto every account's token |

**The mirror is a copy, and copies drift — which is precisely why it is never trusted.** The
re-validation in **[F13-R43]** is not defence in depth for its own sake; it is what makes the drift
harmless in the direction that matters. If the provider still says `customer.admin` after the flag was
cleared, the platform record disagrees and the token is **rejected** (§6). If the provider does not yet
say it after the flag was set, the account simply cannot approve until the mirror catches up. Both
directions fail closed, and neither silently grants.

⚠ **The costs, stated rather than discovered:**

- **A write path that did not exist.** Provisioning gains `SetAdminRoleAsync` (§5). Flag changes are
  now a call to an external system that can fail — see §6.
- **A third claim on the [DEC-67] spike** (§3), and the only one whose *removal* has to be timed as
  well as its issue.
- **A rejection that looks like a bug.** A mismatch ends the session rather than downgrading it, so an
  employee clearing an admin flag signs that person out. That is the correct behaviour for a claim that
  decides who may release money, and it is worth saying out loud in support documentation before the
  first ticket.
- **A structural obligation the identity layer does not enforce alone:** a four-eyes company needs at
  least **two** admin accounts, or its sensitive actions can be raised and never approved
  **[F13-R44]**. The predicate this layer exposes — *B is an admin of the same company as A, and
  B ≠ A* — is what makes self-approval impossible; having somebody to be B is a provisioning concern
  ([F13 §6](../10-features/F13-identity-and-access.md)).

### 4.5 The customer usage API is a second authorisation surface — **[DEC-97]**

**[DEC-97]** gives customers programmatic access to their own usage data. It is not an extra endpoint
on the portal: it is a **second population of callers**, unattended, with no human at the keyboard and
no browser session. That makes it an identity question before it is an API question.

| Property | Rule | Why |
| --- | --- | --- |
| **Credential** | Its own registration per company (§4.1), client credentials, **never a customer's interactive session** | **[DEC-92]** requires a second factor on an interactive customer sign-in, and an unattended process has none to present. Reusing a portal session would mean either weakening **[DEC-92]** or storing a customer's own credential in a script |
| **Scope** | The **calling company's** `customer_id` and nothing else — same global query filter as the portal **[F13-R17]**, same `404`-not-`403` **[F13-R19]**, **[F13-R46]** | The tenancy rule is one rule with two callers, not two rules. A second scoping mechanism is a second thing to get wrong |
| **Audience** | A distinct `aud` (§4.2) | So neither token type is replayable against the other surface |
| **Content** | **Usage only.** No forward price, no price indication, no offer, and no export of any of them **[F13-R47]**, **[DEC-81]**, **[DEC-27]** | Enforced by the surface **not carrying those endpoints**, rather than by a role check a later change could relax. **[DEC-81]** is a licence restriction, not a product preference |
| **Rate limiting** | Per company ([Security §1](../20-architecture/07-security.md), which carries this surface as a threat in its own right) | An unattended caller with a loop is the normal failure mode, not the exception |
| **Attribution** | The credential identifies the **company**, not a person | ⚠ **[DEC-17]**'s "every action records the acting account" degrades here: reads are attributed to a machine credential. Acceptable because the surface is read-only and priced data is absent; it would not be acceptable if the surface ever gained a write |

⚠ **Blocked on transport, not on scope — [OQ-95].** **[DEC-97]**'s source names an API *or* file/FTP
delivery and does not choose. Everything above holds whichever way it goes, which is why it is written
before the answer arrives. What the answer changes is the **mechanism**: an OIDC client registration
reuses the `customer_id` scoping already built, while an FTP account reuses none of it and needs its
own per-company isolation, its own credential rotation and its own audit trail. That is a materially
different amount of work behind the same one-line decision.

## 5. Provisioning

```csharp
public interface IIdentityProvisioning
{
    /// Creates the identity and sends the invitation. The provider issues both claims.
    Task<Result<ExternalSubjectId>> InviteCustomerAccountAsync(
        CustomerId company, CustomerAccountId account,
        Username username, string email, string displayName, CancellationToken ct);

    Task<Result> ResendInvitationAsync(ExternalSubjectId id, CancellationToken ct);
    Task<Result> DeactivateAsync(ExternalSubjectId id, CancellationToken ct);
    Task<Result> RevokeSessionsAsync(ExternalSubjectId id, CancellationToken ct);
    Task<Result<bool>> IsUsernameAvailableAsync(Username username, CancellationToken ct);

    /// Mirrors the platform's admin flag into the provider so the token carries
    /// customer.admin.  [DEC-71], [F13-R41], [F13-R43]
    /// The platform record stays the source of truth (§4.4): this call may fail, and
    /// the failure never grants. Idempotent — setting an already-set flag succeeds.
    Task<Result> SetAdminRoleAsync(ExternalSubjectId id, bool isAdmin, CancellationToken ct);
}
```

⚠ **`SetAdminRoleAsync` is the only method here that changes an *authorisation* fact**, which is why
its failure semantics are written into the interface comment rather than left to the adapter. The
platform commits the flag to its own record first and mirrors second; if the mirror call fails the
record still stands, the reconciliation retry re-attempts it, and in the meantime the re-validation in
**[F13-R43]** keeps the outcome safe in both directions (§4.4, §6).

⚠ **No usage-API method appears here, deliberately [DEC-97].** Provisioning a company's usage
credential cannot be specified before **[OQ-95]** picks a transport: an OIDC client registration is a
provider call and belongs behind this interface, while an FTP account is not a provider concern at
all. Writing the method now would guess, and the guess would be load-bearing.

The platform keeps its own `customer_account` record linked to the provider's `sub`. The provider
owns credentials; the platform owns the person's details, their job title and the link to a company.
Both must exist — on every request, `customer_id` **and** `account_id` are validated against the
platform's own record ([Security](../20-architecture/07-security.md) §2).

**Username uniqueness spans both systems.** The platform holds a unique index and the provider
enforces its own; `IsUsernameAvailableAsync` lets the employee portal fail fast at entry rather than
at provisioning.

## 6. Failure handling

Applies from the first authenticated environment. The PoC has no provider to fail **[DEC-20]** —
which is exactly why the tenancy checks in the last four rows must be exercised there anyway, against
the development context provider (§7).

| Failure | Behaviour |
| --- | --- |
| Provider unavailable | Existing sessions work until token expiry (≤ 15 min). New logins fail with an explanatory page, not a stack trace |
| JWKS unreachable | Cached keys used within their TTL; alert raised |
| Provisioning API failure | Invitation queued and retried; the employee sees the pending state |
| Token with an unknown role | No access, logged |
| Token with a `customer_id` that does not match the platform record | **Rejected and alerted** — this is either a misconfiguration or an attack |
| Token with an `account_id` that does not belong to the `customer_id` | **Rejected and alerted** — same reasoning |
| Token with a valid `customer_id` but a missing `account_id` | Rejected. Attribution is not optional **[DEC-17]** |
| Provisioning succeeds in the provider but fails in the platform | The account is left `INVITED` and reconciled by retry; the person cannot sign in until both records exist |
| **Customer token whose `amr` carries no accepted second-factor method** | **Rejected; no session** **[DEC-92]**, **[F13-R45]**. The message says the account needs a second factor and gives a support route, because the platform cannot enrol one on the user's behalf. Logged with the reason |
| **Customer token whose `amr` is absent, empty or holds only unrecognised values** | **Rejected — fails closed** **[F13-R45]**. An unrecognised value is far more likely a Microsoft rename than a new kind of strong authentication, and the accepted set is configuration (§4.2) so the fix is a setting, not a release |
| **`amr` rejections spike across the whole customer population** | ⚠ **Alert, and treat as a tenant change, not a platform incident.** Conditional Access in the corporate tenancy **[DEC-66]** was relaxed or altered. There is no platform-side remedy and no deployment fixes it — §4.2. This is the mass-failure mode **[DEC-92]** buys the end of silent trust with |
| **Token carries `customer.admin` but the platform record does not** | **Rejected and alerted** **[F13-R43]**, **[F13-R16]**. This is the case the design exists for: a token minted before the flag was cleared must not approve a payment for the rest of its 15 minutes (§4.3, §4.4) |
| **Token lacks `customer.admin` but the platform record says admin** | Rejected on the same rule, so the mirror is repaired rather than tolerated. The account cannot approve until it is — a four-eyes action waits, which is the safe direction |
| **`SetAdminRoleAsync` fails at the provider** | The platform record is already committed and stands (§5). Reconciliation retries; alerted if it keeps failing, because a persistent failure means either every new admin is unusable or every removed admin is signing people out |
| **Usage-API token presented against the portal API, or the reverse** | Rejected on audience **[F13-R46]** (§4.2, §4.5). Not a scope check that could be relaxed later — a different `aud` |
| **Usage-API credential asks for another company's usage** | `404`, not `403` **[F13-R19]**, **[F13-R46]** — the same global query filter as the portal, not a second rule |

### 6.1 Break-glass — decided **[DEC-53]**

**[OQ-44] is closed.** If the provider is unavailable for an extended period, **named employees have a
platform-held username and password path**. It **amends [DEC-29]**: the platform now hashes and stores
passwords, for employees, in a narrow scope. Customers remain fully provider-authenticated and have no
equivalent path.

The constraints are **non-negotiable** and are specified as requirements in
[F13-R33..R40](../10-features/F13-identity-and-access.md); what matters at the integration boundary is
the last one:

| Constraint | Why it is a boundary concern |
| --- | --- |
| **Named accounts only**, enumerated and reviewed | An unnamed emergency account is an unowned credential. It is also the account an attacker looks for first |
| **Disabled by default**, enabled by a second administrator and time-boxed | Otherwise it is not break-glass, it is a second permanent login path with weaker governance |
| **A second factor that does not depend on the identity provider** | ⚠ **The one constraint this document exists to enforce.** A factor delivered through Entra — or through anything federated to it — is unavailable exactly when the path is needed. Enrolment must be out of band and verified by the platform **[F13-R36]** |
| **Every use alerted and audited**, over a channel that does not depend on the provider | An alert routed through a mailbox that authenticates against Entra is no alert during an Entra outage **[F13-R37]** |
| **Rehearsed** | An unrehearsed break-glass path is not a break-glass path — it is an untested credential store **[F13-R39]** |

⚠ **This is a permanent standing risk, consciously accepted.** The platform now stores credentials it
would otherwise not have, and that store belongs in the threat model
([Security](../20-architecture/07-security.md)) as an asset in its own right **[F13-R40]**. Choosing a
managed provider narrowed the question to Entra's availability; **[DEC-53]** answers what to do when
that availability fails, and pays for the answer in a small permanent exposure.

Two details **[DEC-53]** leaves to be set before first use: the **time box** on an enabled account
**[F13-R34]**, and the **function set** a break-glass session may reach **[F13-R38]**. Both are
**[OQ-89]**, which the 2026-08-19 round did not touch and which is needed **before the path is first
enabled or rehearsed** (§8). ⚠ **[DEC-92] does not reach this path.** Mandatory customer MFA is a
customer-population control; break-glass is employees-only and its second factor is required to be
**off-provider** **[F13-R36]**, which is a stronger constraint than `amr` and a different mechanism —
an `amr` check on a token issued by the provider that is down would be checking nothing.

## 7. PoC scope, tenancy, and development

**The PoC has no authentication [DEC-20], and builds no customer credential storage at all [DEC-29].**
What that does *not* license is skipping tenancy:

| Skipped in the PoC | Still built, from the first commit |
| --- | --- |
| Login and token validation | The `customer_id` / `account_id` **context pipeline**, fed by a **development context provider** in place of a token |
| MFA, session revocation, provisioning against a real provider | The EF Core **global query filter** and **row-level security** ([Security](../20-architecture/07-security.md) §2) |
| **Customer** credential storage, reset flows and lockout policy — **never built at all [DEC-29]** | **404-not-403** on out-of-tenant reads, exercised by tests |
| **MFA verification [DEC-92]** — there is no sign-in, so there is no `amr` to check | **The two-level role model [DEC-71]** — `customer.admin` arrives from the **development context provider** exactly as `account_id` does **[F13-R43]**, **[F13-R30]**, and `four_eyes_enabled` is read from company reference data **[F13-R42]**. Without it the four-eyes path cannot be exercised until authentication exists, which is far too late to discover it wrong |
| **The customer usage API [DEC-97]** — not built in the PoC, and unsized until **[OQ-95]** | Nothing extra: the usage API is designed to reuse the **same** query filter and the same `404`-not-`403` **[F13-R46]**, so the tenancy work already in this column is what it will stand on |

⚠ **[DEC-53] adds one line back to the left column that must not be lost.** "No credential storage" was
true of the whole platform; it is now true of the **customer** population only. The break-glass store,
its off-provider second factor, its alerting and its rehearsal are **new Phase 1-onwards work**
**[F13-R33..R40]** — small in code, not small in operational obligation, and easy to under-scope
because it looks like one login screen. It is not needed in the PoC, which has no provider to fail; it
**is** needed before the first authenticated environment that anyone depends on.

The context provider is an implementation of the same abstraction the token-backed provider will
implement, so moving to Entra ID replaces one registration rather than every call site. Retrofitting
tenancy isolation into a system that never had it is how **R-06** happens
([Risks](../70-delivery/02-risks.md)) — and a PoC that quietly hardens into v1 is precisely how a
system ends up never having had it.

### 7.1 Standing advice — now load-bearing, not merely convenient [DEC-67]

This was advice. **[DEC-67]** makes the first two items **mitigations of a live exposure**, and says
so: with the claim-mapping spike deliberately held back until tenant access arrives, the local
container is the only thing exercising the authenticated path in the meantime. Neither is optional.

- **Build against standard OIDC**, not a vendor SDK — no Entra types in domain or application code.
  This is what keeps the wait cheap: when access arrives, one registration changes.
- **Run a local OIDC container — Keycloak or Authentik — from day one**, regardless of the production
  choice. Not "in development so it is convenient", but so that everything except the mapping is
  exercised **before** any tenant exists.
- **Spike the Entra `customer_id` claim mapping before Phase 1 ends [DEC-20]**, **against the
  corporate tenancy [DEC-67]** — see §3. ⚠ It **inherits the tenant-access dependency**
  ([Roadmap §2.1](../70-delivery/01-roadmap-and-phasing.md)) and has no substitute: a developer tenant
  that differs in policy proves the mapping twice and neither time against production.
  ⚠ **The spike now covers three claims, not two [DEC-71]** — `customer_id`, `account_id` and the
  `customer.admin` entry in `roles` — and the third has to be proved in **both** directions, set and
  cleared (§4.4). Add it to the spike's definition of done rather than discovering it during the
  first four-eyes test.

### 7.2 What the local container proves, and what only the real tenant can

The distinction matters because a green local suite is easy to read as "identity works". It is
evidence about **the platform's side of the boundary** and about nothing else.

| Proven locally, from day one | Only the corporate tenant can prove it |
| --- | --- |
| **OIDC discovery** — metadata document, issuer, endpoints, JWKS retrieval and key rollover | **The claim *mapping*** — that Entra actually emits `customer_id` and `account_id` in a token, by claims mapping policy or a token-issuance extension **[F13-R32]**. The one thing **[DEC-67]** defers, and the one §3 calls Entra's weakest |
| **Authorisation code flow with PKCE** for both SPA clients, redirect handling, sign-out | **App-registration specifics** — the two client registrations and their redirect URIs (§4.1), audiences, admin consent, and who in the corporate tenant is allowed to create them |
| **Token validation** — signature, `iss`, `aud`, `exp`, clock skew, refresh rotation and reuse detection (§4.3) | ~~**Tenant MFA policy [DEC-51]** — whether customer MFA is required, and therefore whether `amr` carries what §4.2 expects. The platform never enforces it, so it cannot fake it either~~ ⚠ **Amended 2026-08-19 by [DEC-92]:** the *policy* is still only the tenant's to prove — that **Conditional Access actually requires a second factor** and which `amr` values it emits **[DEC-66]**. What moves to the left column is the **check** |
| **The `amr` gate itself [DEC-92], [F13-R45]** — a local container can issue tokens with and without a second-factor method, so "second factor present → session, absent → rejected, unrecognised → rejected" is fully testable before any tenant exists. ⚠ What it cannot prove is which values Entra will actually emit, which is why the accepted set is configuration | **The `customer.admin` role entry [DEC-71], [F13-R43]** — that Entra emits it, and that **clearing the flag stops it being emitted**, on what delay. Issue and removal are two proofs, not one (§3, §4.4) |
| **The claim *contract*** — that the platform reads `customer_id` / `account_id`, validates the pair against its own record, and rejects a token that fails (§6). Any issuer can emit these claims, which is exactly why proving the contract proves nothing about Entra | **Realm separation as configured** — that a customer token from the External ID tenant is genuinely rejected by the employee API, and the reverse **[F13-R03]** |
| **Tenancy behaviour** — global query filter, row-level security, `404`-not-`403` (§7 table above), exercised from the first commit **[DEC-20]** | **Provisioning against a real directory** — `IIdentityProvisioning` (§5) against Entra's own API, including username uniqueness across both systems and immediate session revocation |

⚠ **The pair to hold apart is the claim *contract* and the claim *mapping*.** The contract is the
platform's and is proven locally; the mapping is Entra's and is not. They differ by one configuration
screen in a directory nobody on the team can reach yet, and confusing them is how a spike gets marked
done without a tenant.

## 8. Open questions

| Ref | Question | Status |
| --- | --- | --- |
| [OQ-03] | Which provider? | **Closed — Entra ID [DEC-20]** |
| ~~[OQ-43]~~ | ~~Mandatory MFA for customer users?~~ | ~~**Closed — [DEC-51]**: governed by **Entra tenant policy**, not by the platform. The platform reads `amr` as evidence and neither enforces nor exempts (§4.2).~~ ⚠ **Amended 2026-08-19 by [DEC-92] — stays closed, on the stronger answer: MFA is *mandatory* for customer users.** Enforcement is still Conditional Access in the corporate tenancy **[DEC-66]** and the platform still implements no MFA, but it **verifies the `amr` claim** and rejects a customer token with no second factor **[F13-R45]** (§4.2, §6). Onboarding friction is accepted. Employee MFA stays mandatory **[NFR-33]** |
| ~~[OQ-44]~~ | ~~Break-glass procedure~~ | **Closed — [DEC-53]**: named employee accounts with a platform-held password hash, disabled by default, second-factored off-provider, alerted, audited and rehearsed (§6.1). ⚠ Amends **[DEC-29]** and leaves the time box and the reachable function set to be set before first use |
| ~~[OQ-88]~~ | ~~Entra was chosen but there is no Microsoft tenancy — which decision moves?~~ | **Closed — neither [DEC-66]**. The tenancy **exists** and is PeakPower's **corporate** one; **[DEC-56]** is clarified, not reversed, and means no Azure subscription, landing zone or naming standard. ⚠ **The residue is a dependency, not a question**: *access* to that tenancy, with a named owner and a date in [Roadmap §2.1](../70-delivery/01-roadmap-and-phasing.md) — not registered under any `OQ` number |
| [OQ-73] | Does PeakPower run Microsoft 365 or another corporate directory? | **Substantively answered by [DEC-66]** — the corporate Microsoft tenancy exists and is the one Entra ID uses; **[DEC-20]** presumed it and was right. Still open only as **confirmation of the directory's particulars** — which employee domains it holds, its licensing, and who administers it. Those surface with the access request rather than before it |
| ~~[OQ-74]~~ | ~~Is there an existing customer-facing identity solution to reuse or migrate from?~~ | **Closed — no [DEC-110].** Greenfield, consistent with **[DEC-56]**. ⚠ The row's own suspicion was right: **[DEC-66]** confirmed the **employee** directory only, and the customer-facing External ID tenant **[F13-R03]** is a separate tenant by design, so nothing it holds carries over. Consequences for this document, all subtractive: **no import**, **no coexistence period**, **no dual-run**, and **no migration plan** — the section that would have held one is not written. Every customer account is created new by a PeakPower employee **[DEC-16]**, carries an admin flag or not **[DEC-71]**, and enrols a second factor at that point **[DEC-92]** |
| **[OQ-89]** | How long is a break-glass account enabled for, and what function set may a break-glass session reach? | **Open** 🟠, and untouched by the 2026-08-19 round. Registered from **[DEC-53]**, which states neither. The **time box** **[F13-R34]** has no shipped default — too short to survive an incident, or long enough that "enabled" becomes permanent — and the **function set** **[F13-R38]** must be decided with operations and enforced as a role rather than inferred from "admin". Both are needed **before the path is first enabled or rehearsed** (§6.1), and **[DEC-104]** names a single operator, so there is no rota to absorb a bad choice. Owner: operations |
| **[OQ-95]** | Is customer usage delivered over an API, over file/FTP, or both? | **Open** 🟡, ⏳ **opened 2026-08-19 by [DEC-97]**, whose source names both transports without choosing. It decides the **credential and the mechanism**, not the scope: the company scoping, the price exclusion and the `404`-not-`403` rule **[F13-R46]**, **[F13-R47]** hold either way and are written already (§4.5). An OIDC client registration (§4.1) reuses everything the portal already has; an FTP account reuses none of it and needs its own isolation, rotation and audit trail |
| [OQ-78] | Provider-owned credentials, or platform-owned username and password? | **Closed — provider-owned [DEC-29]**. ⚠ **Amended by [DEC-53]** for named employee break-glass accounts only (§6.1); customers are unaffected |
