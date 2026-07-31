# Integration — Identity Provider

**Direction:** both · **Protocol:** OpenID Connect · **Criticality:** highest availability dependency

Feature spec: [F13 Identity & access](../10-features/F13-identity-and-access.md). The choice is
**[OQ-03]**.

---

## 1. What the platform needs

| Requirement | Why |
| --- | --- |
| OIDC authorisation code + PKCE | Standard for SPAs; no client secret in the browser |
| **Two isolated realms** — customers and employees | Different populations, different trust, different branding. A customer must never obtain an employee token |
| Custom claims (`customer_id` **and** `account_id`) | `customer_id` scopes the data and is the most security-critical field in the system **[F13-R14]**; `account_id` identifies the person for attribution **[F13-R15]** |
| Several accounts per company, all with the same single role | A company has many people; none of them has more rights than another **[DEC-16]** |
| Username-based login, distinct from the email address | The stakeholder model is username + password **[F13-R04]** |
| MFA, mandatory for employees | [NFR-33] |
| Programmatic user provisioning | Employees invite customer users from the portal |
| Immediate session revocation | Deactivating a user must take effect at once |
| Branded, Dutch-language login for customers | It is part of the product experience |
| EU data residency | [NFR-41] |
| Federation with a corporate directory | Employees should not have a second password |

## 2. Options

### 2.1 Authentik — self-hosted

| | |
| --- | --- |
| **Cost** | Infrastructure only; open source |
| **Control** | Complete: flows, branding, claims, data location |
| **Burden** | **PeakPower's.** Patching, HA, backup, upgrade, and being on call for it |
| **Fit** | Realms, custom claims, MFA and a provisioning API all supported |
| **Risk** | It becomes a single point of failure that PeakPower operates. If it is down, nobody — customer or employee — can sign in to a financial application |

### 2.2 Microsoft Entra ID

| | |
| --- | --- |
| **Cost** | Employees likely already licensed; customer-facing identity is priced per monthly active user, and at a few hundred users that is small |
| **Control** | Good; branding on the customer-facing tenant is workable, less flexible than self-hosting |
| **Burden** | Managed. Microsoft's availability, Microsoft's patching |
| **Fit** | Employee federation is immediate if PeakPower runs Microsoft 365. Custom claims via claims mapping or a token-issuance extension — this is the fiddliest part |
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

### Recommendation

**Entra ID**, if PeakPower already runs Microsoft 365 — employees federate immediately, and the
availability of the login path stops being PeakPower's problem. The main work is getting the
`customer_id` claim issued correctly, which is a known, bounded piece of configuration.

**Authentik** is the right answer only if there is a specific requirement the managed options cannot
meet, or a firm policy against a managed identity provider. Self-hosting is not the cheap option once
the cost of operating it is counted honestly: patching, high availability, backups, upgrade testing,
and someone reachable at 3am when nobody can log in.

Whichever is chosen, the platform code stays provider-agnostic — standard OIDC, one provisioning
adapter behind an interface, no vendor SDK in domain or application code.

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
| `amr` | — | ✅ (MFA evidence) |
| `aud` | `peakpower-customer-api` | `peakpower-employee-api` |

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

**Break-glass [OQ-44]:** if the provider is unavailable for an extended period, is there a path for
employees to reach critical functions? A local emergency account is the usual answer, and it is also
a permanent standing risk. The decision should be explicit, and whatever is chosen must be audited
and rehearsed.

## 7. Migration considerations

Because the provider choice is unresolved and phase 1 needs authentication, the practical approach
is to build against standard OIDC from the start and run a local OIDC container (Authentik or
Keycloak) in development regardless of the production choice. Switching later is then a matter of
configuration plus a user migration, not application changes.

## 8. Open questions

| Ref | Question |
| --- | --- |
| [OQ-03] | Which provider? |
| [OQ-43] | Mandatory MFA for customer users? |
| [OQ-44] | Break-glass procedure |
| [OQ-73] | Does PeakPower run Microsoft 365 or another corporate directory? |
| [OQ-74] | Is there an existing customer-facing identity solution to reuse or migrate from? |
| [OQ-78] | Provider-owned credentials, or platform-owned username and password? |
