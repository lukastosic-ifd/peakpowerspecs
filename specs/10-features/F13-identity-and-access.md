# F13 — Identity & Access

**Portal:** both · **Priority:** Must · **Phase:** 1 · **Size:** M

---

## 1. Summary

Two separate identity populations — **customer accounts** and PeakPower **employees** — with separate
portals, separate APIs and separate trust levels. Both authenticate through an OpenID Connect
provider.

A customer account is one person's login at one customer company. Every account of a company holds
the same single role, `customer.user`, and therefore the same rights **[DEC-16]**. What the identity
layer must get right is not *authorisation inside a company* — there is none to model — but two other
things: **scoping** every request to exactly one company, and **identifying** exactly which person
acted, so [F05](F05-energy-block-trading.md) and [F15](F15-audit-and-observability.md) can attribute
it **[DEC-17]**.

Which provider is not yet decided. The evaluation is in
[Identity provider](../30-integrations/05-identity-provider.md); **[OQ-03]** is the decision. The
important thing is that the choice must not leak into the application: everything below is written
against standard OIDC, so switching providers is a configuration change plus a migration, not a
rewrite.

### The account record

| Field | Owned by | Notes |
| --- | --- | --- |
| **Username** | Platform + provider | Login identifier. Unique platform-wide, immutable after creation |
| **Password** | **Provider only** | Never set, stored, transmitted through or visible to the platform — see **[OQ-78]** |
| First name, last name | Platform | Shown in the audit trail, notifications and to the trade desk |
| **Role in the company** | Platform | Job title. Descriptive; grants nothing |
| Contact phone | Platform | |
| Contact email | Platform | Notification destination; may differ from the username |
| Company | Platform | The `customer_id` claim; set at provisioning, never client-supplied |
| Status | Platform | `INVITED` · `ACTIVE` · `DEACTIVATED` |

**[OQ-78]** asks whether this split is what is wanted. The stakeholder described an account as
"username, password, …", which reads naturally as the platform owning both. The design above keeps
the password with the identity provider instead, because that is what removes credential storage,
password reset, lockout, breach exposure and MFA from PeakPower's responsibility — and because it is
already the basis for **[OQ-03]**. If the platform must own credentials directly, that is a
deliberate change with a real security cost, and it should be decided rather than assumed.

## 2. Functional requirements

### Authentication

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F13-R01 | Both portals authenticate via OIDC authorisation code flow with PKCE. | Must |
| F13-R02 | The platform never receives or stores user passwords. | Must |
| F13-R03 | Customer and employee identities live in separate realms/tenants, with separate client registrations and separate token audiences. | Must |
| F13-R04 | A customer signs in with a **username**, not necessarily an email address. The two may differ, and the email is used for notifications rather than for login. | Must |
| F13-R05 | Employee accounts require MFA. | Must |
| F13-R06 | Customer accounts support MFA; whether it is mandatory is **[OQ-43]**. | Must |
| F13-R07 | Sessions use short-lived access tokens (≤ 15 min) with refresh tokens; refresh tokens rotate on use. | Must |
| F13-R08 | Idle timeout of 30 minutes and absolute session limit of 12 hours, both configurable. | Must |
| F13-R09 | Sign-out invalidates the local session and initiates provider sign-out. | Must |
| F13-R10 | Failed logins, lockouts and password resets are handled by the provider; the platform surfaces provider errors without leaking whether an account exists. | Must |
| F13-R11 | Employees can sign in with the organisation's existing corporate identity if the chosen provider supports federation. | Should |

### Authorisation

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
| F13-R28 | An account holder can see the other accounts of their own company — name, job title, email, status — so they know who else can act **[OQ-80]**. | Should |
| F13-R29 | Customer users can see their own active sessions and sign them out. | Could |

## 3. Business rules

1. **Two realms, no crossover.** An employee token is never valid on the customer API and vice
   versa, enforced by audience validation.
2. **`customer_id` comes from the token, always.** Any code path that reads a customer identifier
   from a query string, body or header for authorisation purposes is a defect.
3. **Deny by default.** Both at the endpoint level and at the data-access level.
4. **Deactivate, never delete.** Audit trails must remain readable years later.
5. **Impersonation is read-only** **[F12-R31..R33]**.
6. **Provider-agnostic.** No provider-specific API calls in domain code; provisioning goes through one
   adapter.

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

## 5. Provider decision

Summarised here; full comparison in
[Identity provider](../30-integrations/05-identity-provider.md).

| | Authentik (self-hosted) | Microsoft Entra ID | Okta |
| --- | --- | --- | --- |
| Cost at ~200 users | Infrastructure only | Low if already licensed | Highest |
| Operational burden | **PeakPower's** — patching, HA, backups | Managed | Managed |
| Multi-realm separation | Good | Workable via External ID for customers | Good |
| Customer-facing branding | Full control | Good with External ID | Good |
| Data residency | Full control | Configurable EU | Configurable EU |
| Time to first login | Days | Hours if tenancy exists | Hours |
| Lock-in | Low | Moderate | Moderate |

**Recommendation:** if PeakPower already runs Microsoft 365, use **Entra ID for employees** and a
customer-facing tenant for customer users — it removes an availability-critical component from
PeakPower's own operational scope. Self-hosting an identity provider means owning uptime for the
thing that gates access to a financial application, which is a real and permanent cost.

## 6. Edge cases

| Case | Behaviour |
| --- | --- |
| Provider unavailable | Existing sessions keep working until token expiry; new logins fail with a clear message. Employees have a documented break-glass path **[OQ-44]** |
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
| [OQ-03] | Which identity provider? |
| [OQ-04] | Are differentiated roles needed within a customer? |
| [OQ-43] | Is MFA mandatory for customer users? |
| [OQ-44] | What is the break-glass procedure if the provider is unavailable? |
| [OQ-78] | Are credentials owned by the identity provider, or must the platform hold username and password itself? |
| [OQ-80] | Should a company's accounts be visible to each other in the customer portal? |

> [OQ-04] — differentiated roles inside a customer — is **closed**. All accounts are equal
> **[DEC-16]**.
