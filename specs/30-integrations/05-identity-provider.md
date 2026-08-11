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

---

## 1. What the platform needs

| Requirement | Why |
| --- | --- |
| OIDC authorisation code + PKCE | Standard for SPAs; no client secret in the browser |
| **Two isolated realms** — customers and employees | Different populations, different trust, different branding. A customer must never obtain an employee token |
| Custom claims (`customer_id` **and** `account_id`) | `customer_id` scopes the data and is the most security-critical field in the system **[F13-R14]**; `account_id` identifies the person for attribution **[F13-R15]** |
| Several accounts per company, all with the same single role | A company has many people; none of them has more rights than another **[DEC-16]** |
| Username-based login, distinct from the email address | The stakeholder model is username + password **[F13-R04]**. The username is the login identifier; the password is the provider's and never the platform's **[DEC-29]** |
| MFA, **mandatory for employees** | [NFR-33], **[F13-R05]** |
| **MFA for customers configured in the tenant, and `amr` emitted** | **[DEC-51]** puts the customer MFA policy in the **tenant**, not in the platform. The platform's requirement is therefore not enforcement but **evidence**: `amr` must be present in customer tokens so a sign-in can be shown to have been second-factored **[F13-R06]**, **[§4.2](#42-required-claims)** |
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
| **Fit** | Employee federation is immediate — PeakPower's corporate Microsoft tenancy exists **[DEC-66]**, so the conditional in this row is discharged. Custom claims via claims mapping or a token-issuance extension — **this is the fiddliest part, and [DEC-67] leaves it unproven until tenant access arrives** |
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

### 4.2 Required claims

| Claim | Customer realm | Employee realm |
| --- | --- | --- |
| `sub` | ✅ | ✅ |
| `email` | ✅ | ✅ |
| `name` | ✅ | ✅ |
| `preferred_username` | ✅ | ✅ |
| `roles` | `customer.user` (always exactly this) | one or more `employee.*` |
| `customer_id` | ✅ **required** — the company | — |
| `account_id` | ✅ **required** — the person | — |
| `locale` | ✅ | — |
| `amr` | ✅ **(evidence only — the tenant decides, the platform records [DEC-51])** | ✅ (MFA evidence) |
| `aud` | `peakpower-customer-api` | `peakpower-employee-api` |

**`amr` in the customer realm is not an authorisation input.** No endpoint requires it, no role depends
on it and the platform never refuses a token for lacking it **[DEC-51]**, **[F13-R06]**. It is captured
on the session and in the audit trail so that "was that sign-in second-factored?" is answerable
afterwards. Requiring MFA — or exempting anyone from it — is a **tenant configuration** change, made by
whoever administers the customer tenant, and is invisible to this repository. That is the trade
**[DEC-51]** accepts, and the reason the evidence has to be captured rather than assumed.

### 4.3 Token lifetimes

| Token | Lifetime |
| --- | --- |
| Access | 15 min |
| Refresh | 12 h, rotating, reuse detection revokes the family |
| ID | 15 min |

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
}
```

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
**[F13-R34]**, and the **function set** a break-glass session may reach **[F13-R38]**.

## 7. PoC scope, tenancy, and development

**The PoC has no authentication [DEC-20], and builds no customer credential storage at all [DEC-29].**
What that does *not* license is skipping tenancy:

| Skipped in the PoC | Still built, from the first commit |
| --- | --- |
| Login and token validation | The `customer_id` / `account_id` **context pipeline**, fed by a **development context provider** in place of a token |
| MFA, session revocation, provisioning against a real provider | The EF Core **global query filter** and **row-level security** ([Security](../20-architecture/07-security.md) §2) |
| **Customer** credential storage, reset flows and lockout policy — **never built at all [DEC-29]** | **404-not-403** on out-of-tenant reads, exercised by tests |

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

### 7.2 What the local container proves, and what only the real tenant can

The distinction matters because a green local suite is easy to read as "identity works". It is
evidence about **the platform's side of the boundary** and about nothing else.

| Proven locally, from day one | Only the corporate tenant can prove it |
| --- | --- |
| **OIDC discovery** — metadata document, issuer, endpoints, JWKS retrieval and key rollover | **The claim *mapping*** — that Entra actually emits `customer_id` and `account_id` in a token, by claims mapping policy or a token-issuance extension **[F13-R32]**. The one thing **[DEC-67]** defers, and the one §3 calls Entra's weakest |
| **Authorisation code flow with PKCE** for both SPA clients, redirect handling, sign-out | **App-registration specifics** — the two client registrations and their redirect URIs (§4.1), audiences, admin consent, and who in the corporate tenant is allowed to create them |
| **Token validation** — signature, `iss`, `aud`, `exp`, clock skew, refresh rotation and reuse detection (§4.3) | **Tenant MFA policy [DEC-51]** — whether customer MFA is required, and therefore whether `amr` carries what §4.2 expects. The platform never enforces it, so it cannot fake it either |
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
| ~~[OQ-43]~~ | ~~Mandatory MFA for customer users?~~ | **Closed — [DEC-51]**: governed by **Entra tenant policy**, not by the platform. The platform reads `amr` as evidence and neither enforces nor exempts (§4.2). Employee MFA stays mandatory |
| ~~[OQ-44]~~ | ~~Break-glass procedure~~ | **Closed — [DEC-53]**: named employee accounts with a platform-held password hash, disabled by default, second-factored off-provider, alerted, audited and rehearsed (§6.1). ⚠ Amends **[DEC-29]** and leaves the time box and the reachable function set to be set before first use |
| ~~[OQ-88]~~ | ~~Entra was chosen but there is no Microsoft tenancy — which decision moves?~~ | **Closed — neither [DEC-66]**. The tenancy **exists** and is PeakPower's **corporate** one; **[DEC-56]** is clarified, not reversed, and means no Azure subscription, landing zone or naming standard. ⚠ **The residue is a dependency, not a question**: *access* to that tenancy, with a named owner and a date in [Roadmap §2.1](../70-delivery/01-roadmap-and-phasing.md) — not registered under any `OQ` number |
| [OQ-73] | Does PeakPower run Microsoft 365 or another corporate directory? | **Substantively answered by [DEC-66]** — the corporate Microsoft tenancy exists and is the one Entra ID uses; **[DEC-20]** presumed it and was right. Still open only as **confirmation of the directory's particulars** — which employee domains it holds, its licensing, and who administers it. Those surface with the access request rather than before it |
| [OQ-74] | Is there an existing customer-facing identity solution to reuse or migrate from? | Open. ⚠ **[DEC-66]** does not answer it: it confirms the **employee** directory, and the customer-facing External ID tenant **[F13-R03]** is a separate tenant by design |
| [OQ-78] | Provider-owned credentials, or platform-owned username and password? | **Closed — provider-owned [DEC-29]**. ⚠ **Amended by [DEC-53]** for named employee break-glass accounts only (§6.1); customers are unaffected |
