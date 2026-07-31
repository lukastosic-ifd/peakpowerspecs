# Open Questions

Every `[OQ-nn]` reference in this specification set resolves here. **80 open, 1 closed.**

**Blocking** means work cannot responsibly start until it is answered. **Impact** is what changes if
the answer is different from the working assumption.

| Priority | Meaning |
| :--: | --- |
| 🔴 **P1** | Blocks a phase. Needed before that phase can be estimated or built |
| 🟠 **P2** | Shapes the design. Needed before the affected feature is built |
| 🟡 **P3** | Affects detail or polish. Can be decided during build |

---

## The nine that matter most

If only a few decisions can be made before the next planning session, make these.

| Ref | Question | Why it is first |
| --- | --- | --- |
| **[OQ-05]** | PVNed endpoint, authentication, acknowledgement expectations, test environment | Phase 1 is entirely dependent on it, and it is the largest technical unknown in the project |
| **[OQ-02]** | Do peak blocks exclude public holidays? | ~3.5% of annual peak volume, and if the platform's profile differs from the traded product PeakPower carries the basis. Affects pricing, invoicing and every chart |
| **[OQ-14]** | Energiebelasting tariffs, credit applicability, exemptions | Invoicing cannot be built without the tariff table |
| **[OQ-15]** | How is portfolio-level imbalance allocated to EANs? | Changes both the invoice arithmetic and the customer contract |
| **[OQ-17]** | VAT treatment, and whether wallet amounts are VAT-inclusive | If wallets are exclusive and invoices inclusive, every wallet drifts short by 21% of invoice value |
| **[OQ-13]** | How is surplus volume settled? | A commercial decision that determines who carries market risk on over-hedging |
| **[OQ-03]** | Which identity provider? | Needed at the start of phase 1; self-hosting adds a permanent operational obligation |
| **[OQ-78]** | Provider-owned credentials, or platform-owned username and password? | Decides whether PeakPower takes on credential storage, resets, lockout and breach exposure. Pairs with [OQ-03] |
| **[OQ-24]** | Montel licence terms for onward display to customers | Could reshape the whole price-indication feature |

---

## Scope & product

| Ref | P | Question | Impact if the assumption is wrong | Owner |
| --- | :--: | --- | --- | --- |
| **OQ-01** | 🟠 | When does **gas** enter scope? Same EAN model, same block products, or something else? | The model carries a commodity discriminator **[DEC-15]**, so the structure is ready. Gas-specific pricing, units (m³ vs. kWh, calorific correction) and tariffs are new work | Product |
| ~~OQ-04~~ | ✅ | ~~Are differentiated roles needed **within** a customer organisation?~~ **CLOSED — no.** All accounts of a company have identical privileges **[DEC-16]**; what distinguishes them is attribution, not permission **[DEC-17]** | — | Closed |
| **OQ-06** | 🟡 | Should EANs be validated against an external market register (EDSN / C-AR)? | Today only the check digit is validated. External validation catches typos at onboarding | Product |
| **OQ-08** | 🟠 | Minimum and increment for a requested volume | Default 0,1 MW minimum, 0,001 MW increment. Affects the wizard and what the trade desk sees | Trading |
| **OQ-09** | 🟠 | Is four-eyes approval required above a value threshold? | Adds an approval state to the trade machine. Cheap now, expensive later | Risk / Trading |
| **OQ-10** | 🟠 | May a customer **sell short** — sell a block they do not hold? | Blocked by default. Permitting it needs an authorisation flag and a credit view | Risk / Trading |
| **OQ-11** | 🔴 | Does **production** net against consumption for coverage and invoicing, or is it informational? | **[AS-06]** says informational. Netting changes coverage, invoicing and the energiebelasting basis together | Product / Finance |
| **OQ-26** | 🟡 | Must a metering point be valid for the **entire** delivery period to be included in a trade? | Currently yes. Allowing partial validity means pro-rated allocations | Trading |
| **OQ-27** | 🟡 | Should the pre-submission wallet check use a buffer above the estimate? | Default 100% of estimate. A buffer reduces rejected acceptances when the offer exceeds the indication | Trading |
| **OQ-28** | 🟡 | Can a customer buy into a delivery period that has **already started**? | Currently blocked. Allowing it means partial-period volume and a mid-period coverage start | Trading |
| **OQ-29** | 🟠 | What happens to a customer's blocks when their contract ends mid-period? | Unwind, transfer, or settle at market? Affects offboarding and the final invoice | Legal / Commercial |
| **OQ-55** | 🟡 | Does any customer need programmatic API access of their own? | Would add a third API surface with its own auth model | Product |
| **OQ-80** | 🟡 | Should a company's accounts be visible to each other in the customer portal? | Recommended yes — if any colleague can spend the company's money, knowing who else holds an account is reasonable transparency. Suppressing it hides nothing an employee could not tell them anyway | Product |
| **OQ-81** | 🟠 | When an offer arrives, is **every** account notified, or only the one that raised the request? | Recommended all active accounts. Notifying only the requester means a 30-minute offer can die because one person is in a meeting, and any account may accept **[DEC-18]** | Commercial / Trading |

## Market & calculation

| Ref | P | Question | Impact | Owner |
| --- | :--: | --- | --- | --- |
| **OQ-02** | 🔴 | **Do peak blocks exclude public holidays, and who owns the holiday list?** The exchange convention for Dutch power peak-load products includes them; the brief says "working days only" | ~8–9 weekdays a year ≈ 3.5% of annual peak volume. If the platform bills a holiday-excluding profile while PeakPower buys a holiday-including product, PeakPower carries the difference. **[DEC-14]** makes it configurable, but the answer must be explicit and identical for pricing, invoicing and charts | Trading / Commercial |
| **OQ-12** | 🟠 | Confirm a "**topup**" is a €/MWh surcharge, not a fixed periodic fee or a scheduled wallet deposit | A fixed fee makes the invoice line flat rather than volumetric — small change, but the tariff screens differ | Finance |
| **OQ-13** | 🔴 | **How is surplus (over-covered) volume settled?** Credited at day-ahead, at the block price, or not at all | Determines who carries market risk on over-hedging. Implemented as a per-contract policy either way | Commercial |
| **OQ-14** | 🔴 | **Energiebelasting**: source and ownership of the annual tariff table; does the *vermindering* apply; do any customers hold exemptions or reduced rates? | Invoicing cannot be built without it. Tiers, boundaries and rates change annually | Finance |
| **OQ-15** | 🔴 | **Imbalance allocation.** Can PVNed supply imbalance per EAN? If not, is pro-rata on consumption acceptable, and is it in the customer contract? | Changes the invoice arithmetic and the most-queried invoice line | Finance / PVNed |
| **OQ-16** | 🟠 | What resolution does Montel deliver for the NL day-ahead curve, and is history available for backfill? | Storage handles both hourly and 15-minute by design. Backfill depth limits how far back positions can be settled | Platform |
| **OQ-25** | 🟡 | Are indications shown raw, or with a PeakPower spread? | Affects customer expectation of the eventual offer | Commercial |
| **OQ-35** | 🟠 | Is the **raw** day-ahead price used for settlement, or a price plus a configured spread? | Directly changes every invoice | Commercial |
| **OQ-36** | 🟡 | Is the surcharge applied to consumption only, or to all invoiced volume including surplus sales? | Changes the surcharge base | Finance |
| **OQ-76** | 🟡 | True-up materiality threshold (default €25) — and should waived amounts accumulate? | Below-threshold deltas produce a statement, not a document | Finance |
| **OQ-77** | 🟠 | When an EAN transfers between customers mid-year, how is the annual energiebelasting tier applied? | The tax is levied per connection per calendar year, which may mean the two periods must be considered together — a fiscal question, not a technical one | Finance / Tax advisor |

## Money & wallet

| Ref | P | Question | Impact | Owner |
| --- | :--: | --- | --- | --- |
| **OQ-17** | 🔴 | **VAT**: rate per line category, exemptions or reverse charge, and — critically — are wallet amounts VAT-inclusive or exclusive? | If wallets are exclusive and invoices inclusive, every wallet drifts short by 21% of invoice value. Also determines the reservation amount **[AS-10]** | Finance / Tax advisor |
| **OQ-19** | 🟠 | When a wallet cannot cover an invoice: full debit into negative, or partial settlement with a receivable in Odoo? | Currently full debit **[AS-12]**. Partial settlement splits the debt across two systems | Finance |
| **OQ-30** | 🟠 | Refunds of surplus balance — in scope, who approves, and via the payment provider or a manual transfer? | Needed for offboarding regardless | Finance |
| **OQ-31** | 🔴 | Must wallet funds be held in a **segregated client account**, and does holding customer money carry regulatory obligations? | A legal and licensing question with potentially significant consequences. Should be answered by counsel before go-live | Legal |
| **OQ-32** | 🟡 | Minimum and maximum top-up amounts | Defaults €100 / €250 000 | Finance |
| **OQ-33** | 🟡 | Chargeback and reversal handling | Currently a manual adjustment with a mandatory reason | Finance |
| **OQ-41** | 🟡 | Default wallet warning and critical thresholds — fixed amounts, or derived from recent trading volume? | Affects alert usefulness for both very large and very small customers | Finance |
| **OQ-07** | 🟡 | Is bank statement import (CAMT.053) in scope, or is manual registration acceptable indefinitely? | Manual matching is the main operational cost of the bank-transfer route | Finance |
| **OQ-79** | 🟠 | What is the **company bank account** on the customer record used for — refund destination only, or also to match incoming transfers? | If it is also a matching key, an incoming transfer from a known IBAN can be attributed even when the customer forgets the payment reference. That would remove the largest source of unmatched payments, and is close to free given the field already exists | Finance |

## Integrations

| Ref | P | Question | Impact | Owner |
| --- | :--: | --- | --- | --- |
| **OQ-05** | 🔴 | **PVNed**: endpoint URL, authentication mechanism, is a SOAP acknowledgement expected and in what format, retry policy on non-2xx, is there a test environment? | Phase 1 depends entirely on this. Without a test environment the `DevStubs` project becomes critical-path | PVNed |
| **OQ-20** | 🟠 | The supplied sample has `Period.TimeInterval` spanning a month while `MeasurementPeriode` is one day. Which governs? | The platform treats `MeasurementPeriode` + `Pos` as authoritative. An implementer trusting `TimeInterval` would write intervals to the wrong dates | PVNed |
| **OQ-21** | 🟠 | Message volume and cadence — one document per EAN per day, or batched across EANs? | Sizes the ingestion pipeline and the partition strategy | PVNed |
| **OQ-65** | 🟠 | **Walk through the nine documentation inconsistencies** in [PVNed integration §9](30-integrations/01-pvned-timeseries.md) and confirm intended behaviour | Each is a place where a reasonable implementer could guess wrong | PVNed |
| **OQ-66** | 🟡 | Does PVNed supply reconciliation data after the 10-working-day window, and should it be ingested? | Would extend the correction window and affect the true-up gate | PVNed |
| **OQ-75** | 🟡 | If a delivery date is permanently missing and PVNed cannot resend, is manual data entry acceptable? | Currently allowed but flagged on every derived figure | Operations |
| **OQ-23** | 🟠 | Exact Montel ticker symbols for the six products | Reference data, but must be right before the price board is useful | Trading |
| **OQ-24** | 🔴 | **Montel licence**: may indications be shown to customers, exported by them, or displayed publicly? | Could reshape [F04](10-features/F04-price-indications.md) entirely — possibly into a PeakPower-derived indication | Commercial / Legal |
| **OQ-34** | 🟠 | Is CM.com contracted, and does the contract cover iDEAL at the expected volumes? | Provider-agnostic port, so a change is configuration plus testing | Finance |
| **OQ-67** | 🟡 | Does the payment provider offer a settlement report suitable for automated reconciliation? | Otherwise reconciliation stays manual | Finance |
| **OQ-68** | 🟡 | Are non-iDEAL payment methods needed (SEPA via provider, Bancontact for Belgian entities)? | Configuration plus testing per method | Commercial |
| **OQ-37** | 🟠 | Who owns **invoice numbering** — the platform or Odoo? | Recommendation: the platform, so the customer experience is independent of an integration that will occasionally fail | Finance |
| **OQ-38** | 🟠 | Who generates the invoice **PDF** — the platform or Odoo? | Affects branding control and the portal download path | Finance |
| **OQ-39** | 🟡 | Are invoices emailed to customers, or portal-only? | Affects notification design and deliverability requirements | Finance |
| **OQ-69** | 🟠 | Odoo version, hosting model, and external API availability | Determines the integration approach | Finance / IT |
| **OQ-70** | 🟠 | Does a chart of accounts and tax code mapping already exist, and who owns it? | The mapping table needs an owner from day one | Finance |
| **OQ-71** | 🟠 | Do customer records already exist in Odoo, and how are they matched to platform customers? | Partner matching must be on a stable identifier, never on name | Finance |
| **OQ-72** | 🟡 | Does Odoo need to know about wallet balances and deposits, or only invoices? | Would extend the integration to a second document type | Finance |
| **OQ-18** | 🟠 | Are network/transport costs (netbeheerkosten) in scope for these invoices? | Assumed out of scope — normally billed directly by the DSO for grootverbruik | Finance |
| **OQ-40** | 🟡 | Transactional email provider, and is a dedicated sending domain with SPF/DKIM/DMARC available? | Offer notifications are time-critical; deliverability is a commercial concern | IT |

## Identity & security

| Ref | P | Question | Impact | Owner |
| --- | :--: | --- | --- | --- |
| **OQ-03** | 🔴 | **Which identity provider** — Authentik (self-hosted), Entra ID, or Okta? | Recommendation: Entra ID if Microsoft 365 is already in use. Self-hosting means owning uptime for the thing that gates access to a financial application | IT |
| **OQ-43** | 🟠 | Is MFA mandatory for customer users? | Supported either way; mandatory adds onboarding friction and removes a real risk | Security |
| **OQ-44** | 🟠 | Break-glass procedure if the identity provider is unavailable | A local emergency account is the usual answer and a permanent standing risk. Must be explicit, audited and rehearsed | Security |
| **OQ-73** | 🟠 | Does PeakPower run Microsoft 365 or another corporate directory? | Largely decides [OQ-03] | IT |
| **OQ-74** | 🟡 | Is there an existing customer-facing identity solution to reuse or migrate from? | Would change the migration plan | IT |
| **OQ-58** | 🟠 | Who owns the DPIA and the processor agreements with PVNed, the payment provider, the identity provider, the email provider and the cloud provider? | Required before go-live; each is a lead-time item | Legal |
| **OQ-59** | 🟡 | Are customer-managed encryption keys required? | Platform-managed by default | Security |
| **OQ-60** | 🟠 | Is an external penetration test budgeted before go-live? | [NFR-36] assumes yes | Security |
| **OQ-48** | 🟡 | Audit retention period — does any financial regulation impose longer than the fiscal seven years? | Affects storage cost and archival design | Legal |
| **OQ-78** | 🔴 | **Are credentials owned by the identity provider, or must the platform hold username and password itself?** The account model says "username, password" | The design keeps the password with the provider, which removes credential storage, reset flows, lockout, breach exposure and MFA from PeakPower's scope. Platform-owned credentials mean building and securing all of that, and they conflict with the OIDC basis of **[OQ-03]**. Decide explicitly — this is a security-posture choice, not a detail | Security / IT |

## Architecture & operations

| Ref | P | Question | Impact | Owner |
| --- | :--: | --- | --- | --- |
| **OQ-22** | 🟠 | Which charting library, and is a commercial licence acceptable? | The chart is the product. Deserves a spike in phase 1 | Engineering |
| **OQ-49** | 🟡 | Angular component library | Affects delivery speed and visual consistency | Engineering |
| **OQ-50** | 🟠 | Is **Azure** confirmed, or must the design stay portable? | Aspire deploys most smoothly to Container Apps. Migration cost sits in IaC, not the application | IT |
| **OQ-51** | 🟡 | Monorepo for .NET and Angular, or separate repositories? | Affects CI design | Engineering |
| **OQ-52** | 🟠 | Where does the **existing Montel implementation** live, and in what shape? Are there other PeakPower .NET conventions or shared libraries to align with? | Reuse was an explicit expectation in the brief | Engineering |
| **OQ-53** | 🟠 | Expected metering-point count at year 1 and year 3 | Determines whether monthly partitioning is sufficient and when **[DEC-09]** must be revisited | Commercial |
| **OQ-54** | 🟡 | Is a read replica needed for reporting? | Primary is likely sufficient at year-1 volumes | Engineering |
| **OQ-56** | 🟠 | Is the 5th of the month the right invoice-run date, given PVNed's 10-working-day correction window? | Earlier means more provisional data; later delays cash | Finance |
| **OQ-57** | 🟡 | Should the Hangfire dashboard be exposed in production, or should job control go through the employee portal? | A security and usability trade-off | Engineering |
| **OQ-42** | 🟡 | How many concurrent employees, and does the trade desk need real-time collaboration beyond a soft lock? | Affects the desk design | Operations |
| **OQ-47** | 🟡 | Observability backend — Azure Monitor, Grafana stack, or something already in use? | Affects setup cost | IT |
| **OQ-61** | 🟠 | Is there a contractual SLA with customers, and what does it commit to? | Drives availability targets and the cost of the deployment topology | Commercial |
| **OQ-62** | 🟠 | Is single-region with zone redundancy acceptable, or is a warm secondary region required? | A warm secondary roughly doubles infrastructure cost | IT / Commercial |
| **OQ-63** | 🟠 | Who operates the platform after go-live, and what is the support rota? | P1 alerts need someone to reach | Operations |
| **OQ-64** | 🟡 | Is there an existing Azure tenancy, landing zone or naming standard? | Affects IaC setup | IT |

## Public website

| Ref | P | Question | Impact | Owner |
| --- | :--: | --- | --- | --- |
| **OQ-45** | 🟡 | Is a CMS wanted, and if so which — or are content files in the repository acceptable? | Affects who can change copy | Marketing |
| **OQ-46** | 🟡 | Does PeakPower have brand guidelines and copy, or is that part of this project? | Currently no brand assets are available. All mockups are deliberately unbranded | Marketing |

---

## Summary

| Priority | Count | Blocks |
| --- | --: | --- |
| 🔴 **P1** | 11 | OQ-02, 03, 05, 11, 13, 14, 15, 17, 24, 31, 78 |
| 🟠 **P2** | 37 | Feature-level design |
| 🟡 **P3** | 32 | Detail and polish |
| ✅ Closed | 1 | OQ-04 — resolved by **[DEC-16]** |

### By owner

Questions with a shared owner (`Finance / Tax advisor`) are counted under both, so the total exceeds
77.

| Owner | Count | Note |
| --- | --: | --- |
| Finance | 25 | The largest group by some distance — invoicing is the least settled area |
| Commercial | 10 | Product and pricing policy |
| IT | 9 | Mostly answerable internally |
| Trading | 8 | Operational policy |
| PVNed | 6 | External dependency with lead time; raise early |
| Engineering | 6 | |
| Product | 5 | |
| Legal | 5 | Lead-time items — DPIA, processor agreements, client money |
| Security | 4 | |
| Operations | 3 | |
| Risk | 2 | |
| Tax advisor | 2 | Shared with Finance |
| Marketing | 2 | |
| Platform | 1 | |

### Suggested sequence

1. **This week** — the eight in the table at the top. Six of them are conversations, not analyses.
2. **Before phase 1 planning** — every P1, plus OQ-22, OQ-50, OQ-52, OQ-53, OQ-73. [OQ-78] belongs
   here: it changes what phase 1 builds.
3. **Before phase 2 planning** — trading policy: OQ-08, 09, 10, 25, 27, 28, 29, 34.
4. **Before phase 3 planning** — everything finance-owned. Invoicing has the most unknowns and the
   least tolerance for getting it wrong.
5. **Continuously** — the P3s, resolved during build.

### Two that need external parties and therefore have lead time

- **[OQ-05] and [OQ-65]** — PVNed. Phase 1 cannot finish without them, and a third party's calendar
  is not controllable. Open this conversation first.
- **[OQ-31] and [OQ-58]** — Legal, on holding customer money and on the DPIA. Both can run in
  parallel with build, but neither can be skipped before go-live.
