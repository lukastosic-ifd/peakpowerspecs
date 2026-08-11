# Glossary

Terminology used across this specification set. Dutch market terms are given with their English
working equivalent; the **bold** form is the one used in code and UI copy.

## Market & regulatory

| Term | Meaning |
| --- | --- |
| **Grootverbruik** (GV) | Large-consumption connection. Electricity: connection capacity above 3×80 A. Gas: above 40 m³/h. GV connections are metered per interval and settled on measured data, not on a profile. This is PeakPower's segment. |
| Kleinverbruik (KV) | Small-consumption connection. Out of scope. |
| **EAN** | The 18-digit GS1 code identifying a *metering point* (`aansluiting`/connection point). Stable across physical meter replacement. The platform's natural key for a connection. |
| GLN-13 | 13-digit GS1 Global Location Number identifying a *market party* (used for PVNed sender/receiver identification). |
| **DSO** (`netbeheerder`) | Distribution System Operator — Liander, Enexis, Stedin, etc. Owns the connection and the meter. |
| **TSO** | Transmission System Operator — TenneT in the Netherlands. Operates the imbalance settlement. |
| **BRP** (`programmaverantwoordelijke`, PV) | Balance Responsible Party. Submits energy programmes to TenneT and carries the imbalance risk for its portfolio. |
| **Allocation** (`allocatie`) | The process of assigning measured volumes per interval to a BRP portfolio. PVNed sends allocation/realisation data to PeakPower. |
| **Reconciliation** (`reconciliatie`) | Later correction of allocated volumes against final metered data. |
| **Imbalance** (`onbalans`) | The deviation between a BRP's programme and its realised position in a settlement period, priced by TenneT. **Out of scope for charging [DEC-25]** — PVNed `A12` documents are stored but not turned into an invoice line, and no allocation method is stated in the customer contract. The definition stands; only the charging does not. |
| **ISP** / MTU | Imbalance Settlement Period / Market Time Unit — 15 minutes. |
| **Energiebelasting** (EB) | Dutch energy tax. Levied per EAN per calendar year on net consumed volume, with **degressive** tiers: the rate per kWh falls as annual volume rises. Tier crossings are the reason an annual recalculation is required — see [Annual true-up](../40-processes/05-annual-true-up.md). **Deferred by [DEC-24]**: invoice line 5 is not implemented for now and the annual true-up is deferred with it. ⚠ The definition is kept because EB is a legal obligation, not a feature — it must return before a real customer is invoiced. |
| ODE | Opslag Duurzame Energie — a separate levy until 2022, since merged into energiebelasting. Retained here only as a historical note. |
| **Gas** | The second commodity. Out of scope for this track, but modelled from day one as a discriminator on metering point, product, tariff and price **[DEC-15]**. When it enters scope it keeps **the same EAN model and the same block products**; only pricing and units differ, and **gas volumes are in m³**, not kWh **[DEC-30]**. ⚠ Gas is metered in m³ but conventionally *billed* on energy content; whether the platform applies a **calorific correction** (m³ → kWh) is not decided — see [OQ-87]. |
| **Day-ahead price** | The wholesale price per MTU resulting from the day-ahead auction (EPEX SPOT NL), in **€/MWh**. Applied to volume not covered by a purchased block, and to unused block cover on the sale side **[DEC-23]**. Used **raw, with no spread [DEC-44]**. Not applied to physically exported volume, which settles at the **feed-in tariff** instead. The NL curve arrives at **18:00 Europe/Amsterdam [DEC-36]**. |
| **Base load** (`base`) | A product delivering constant power across every hour of the delivery period, 24/7. |
| **Peak load** (`peak`) | A product delivering constant power during **peak hours** only, and nothing outside them. Volume is counted against the peak calendar for the commodity and year **[DEC-14]**, whose exclusion list is empty for electricity **[DEC-19]**. See **Peak hours**. |
| **Peak hours** | Monday to Friday, at or after **08:00** and strictly before **20:00** Europe/Amsterdam. **Public holidays are not excluded** — a holiday falling on a weekday is a peak day **[DEC-19]**, matching the exchange convention for Dutch power peak-load products, so the platform's peak profile agrees with the product PeakPower hedges in. |
| **Off-peak** | Every hour that is not a peak hour. |
| **Cal** / Q / M | Trading shorthand for calendar-year, quarter and month delivery periods (e.g. *Cal-27*, *Q1-27*, *Aug-26*). |
| **Clip** | A whole-MW tradeable unit. Wholesale blocks trade in integer MW. |
| **BTW** | Dutch VAT. All platform prices, wallet balances and reservations are VAT-**exclusive**; VAT is added at invoice level **[DEC-26]**, at **21% on every line category, with no exemptions and no reverse-charge cases [DEC-64]**. ⚠ That rate is recorded as *stated*, not as advised — a customer outside the standard rate reopens it. Whether the wallet debit settles the ex-VAT subtotal or the inclusive total is still open — [OQ-83]. |

## Platform concepts

| Term | Meaning |
| --- | --- |
| **Customer** | The contracting **company**. Holds the commercial relationship: legal identity, KvK registration, VAT number, bank account, addresses and contacts. Owns exactly one wallet and one or more metering points. Used interchangeably with *customer company* where the distinction from an account matters. |
| **Customer account** | One person's login at a customer company: username, name, role in the company, contact details. A customer has **one or more** accounts, created by a PeakPower employee. All accounts of one customer have **identical privileges** and see identical data **[DEC-16]**. |
| **Customer user** | The person behind a customer account. Used when talking about behaviour and needs; *customer account* is used when talking about the record, the login, or attribution. |
| **Role in the company** | The account holder's job title — *Energy Manager*, *Finance Director*, *Operations*. **Descriptive only.** It appears next to their name in the audit trail for context; it grants nothing. Not to be confused with a platform role. |
| **Acting account** | The specific customer account that performed an action. Recorded on every trade event and wallet movement, so history shows not only *which company* but *which person* **[DEC-17]**. |
| **Metering point** | A platform record wrapping an EAN, with customer-supplied name and description, commodity, and validity period. |
| **Interval reading** | One 15-minute measurement for one metering point, in one direction (consumption or production), from one data version. |
| **Delivery date** | The Amsterdam calendar day a measurement belongs to. 96 intervals normally; **92** on the spring-forward day, **100** on the autumn fall-back day. |
| **Data version** | One PVNed document for a metering point and delivery date. Later versions supersede earlier ones; the newest received version is authoritative. |
| **Final data** | The state of a delivery date after the PVNed correction window (10 working days) closes and no newer version has arrived. |
| **Price indication** | A non-binding market price shown to the customer, sourced from Montel. Never a quote. **Must not be displayed publicly [DEC-27]**; display inside the authenticated portal is permitted. Customer CSV export is not covered by that permission and is treated as not permitted — see [OQ-24]. |
| **Trade request** | A customer's request to buy or sell a block: product, period, direction, and a volume per metering point. Raised by one customer account; **any** account of the same customer may answer the resulting offer. |
| **Offer** | PeakPower's firm, time-limited price response to a trade request. |
| **Reaction window** | The period during which an offer can be accepted. Default 30 minutes; set per offer. |
| **Block** (`energy block`) | A confirmed position: base or peak, a delivery period, a volume in MW, an agreed price, allocated across one or more metering points. |
| **Allocation (of a block)** | The split of a block's MW across the metering points named in the trade request. Not to be confused with market *allocation* above. |
| **Net usage** | **Consumption minus production**, for one interval at one metering point. **May be negative** when production exceeds consumption in that interval, which is **feed-in**. This is the platform's volume basis for coverage, the net position and invoicing **[DEC-22]**, superseding **[AS-06]**. The consumption chart shows it alongside the two gross series, never instead of them. |
| **Coverage** | For a given interval, the share of **net usage** supplied by purchased blocks **[DEC-22]**. Unchanged by **[DEC-44]** — coverage is measured before the sale leg splits, so an interval of feed-in is simply an interval with no net usage to cover. |
| **Uncovered volume** | **Net usage** in excess of block coverage, priced at day-ahead. Purchase side only; unaffected by **[DEC-44]**. |
| **Over-coverage** | Block volume in excess of **net usage** in an interval **[DEC-22]**. ⚠ **Split by [DEC-44]**, and the distinction is a money one. *Unused block cover* — bought volume the customer did not consume — is credited at the **day-ahead price** as a separate sale line **[DEC-23]**. *Physically exported* volume — net usage below zero — is **feed-in**, and is credited at the **feed-in tariff** on its own line instead. The two are never netted against each other or against the purchase lines: three volumes, three times, three prices. |
| **Feed-in** | Physically **exported** energy: the part of net usage that falls below zero in an interval, `max(−U, 0)`. Its own invoice line category — **line 6** — settled at the **feed-in tariff**, not at day-ahead **[DEC-44]**. Distinct from *over-coverage*, which is bought volume that went unused; the two can occur in the same month, at different times, at different prices. |
| **Feed-in tariff** | The per-unit rate at which exported energy is credited to the customer, in **€/kWh** and applied directly to the kWh volume with no divisor **[DEC-44]**, **[DEC-35]**. Per-customer, per-period reference data with the same shape, validity and audit rules as the **surcharge**: signed (a positive rate credits the customer), resolved per interval so a mid-month change produces two lines rather than a blended rate, never edited retroactively into an invoiced period. ⚠ What applies when a customer exports and **no** tariff resolves is not decided — see [OQ-86]. Until it is, the invoice run skips that customer rather than defaulting. |
| **Wallet** | The customer's single prepaid money account. Holds a settled balance and a reserved amount. |
| **Ledger** | The append-only record of every wallet movement, each entry carrying the resulting balances. |
| **Reservation** | An amount held against the wallet for a trade that is accepted but not yet confirmed — or, above the threshold, **accepted but not yet approved [DEC-33]**. Reduces available balance without changing the settled balance. Taken at acceptance in the same transaction whichever state the trade lands in, and released in full by any exit other than confirmation. Sized at the full trade value ex-VAT **[AS-10]**, **[DEC-26]**, with no buffer **[DEC-41]** — see [OQ-83]. |
| **Available balance** | Settled balance minus active reservations. The amount a customer can commit. |
| **Surcharge** / **topup** | A per-unit adder applied on top of the energy price, configured per customer per period, **quoted and stored in €/kWh [DEC-35]** and applied directly to the kWh volume with **no `/1000` divisor**. Signed — a negative rate is a discount. ⚠ **The unit is the trap.** Every *market* price in this platform is €/MWh; the two *customer* rates, surcharge and **feed-in tariff**, are €/kWh, and a €/kWh figure read as €/MWh is wrong by exactly 1000 while still looking plausible. The original brief calls this a "topup"; this set uses **surcharge** in code and UI to avoid collision with *wallet top-up*. |
| **Wallet top-up** | Adding money to the wallet, by iDEAL **[DEC-58]** or bank transfer. There is **no route out**: **[DEC-43]** removes the refund payout path, so a surplus balance stays in the wallet. |
| **Four-eyes approval** | The rule that a trade above a value threshold must be **approved by a second account** before PeakPower executes it **[DEC-33]**. Since all accounts of a company have identical privileges **[DEC-16]**, it is not a permission but a condition on identity: *the approving account is an active account of the owning company and is not the account that accepted*. The gate sits **after** acceptance, so the reservation is already held; the offer's reaction window is the only clock, and both signatures must fall inside it. Refusal is its own terminal state and is open to any active account, including the acceptor, because refusing only ever releases money. ⚠ The **threshold** is reference data with no shipped default — see [OQ-85]. |
| **Break-glass** | The emergency sign-in path for a small set of **explicitly named employee accounts**, used only when the identity provider is unavailable **[DEC-53]**. It is the one place the platform holds a credential of its own — a password hash, for employees only — and it **amends [DEC-29]** rather than overturning it: no customer account has a platform-held credential of any kind. Accounts are disabled by default, enabled by a second named administrator for a bounded time, second-factored by something that does not depend on the identity provider, alerted and audited on every use, rotated after every use, and **rehearsed on a schedule**. An unrehearsed break-glass path is not a break-glass path. ⚠ The time box and the reachable function set are not yet set — see [OQ-89]. |
| **Non-working day** | A day excluded from the peak calendar. The calendar keeps an exclusion list as reference data per commodity and year **[DEC-14]**, but **[DEC-19]** leaves it **empty** for electricity peak: no day is excluded, public holidays included. The mechanism stays so the answer can change without a release. |

## Integration terms

| Term | Meaning |
| --- | --- |
| **PVNed** | Third-party data provider. Pushes SOAP/XML `TimeSeriesDocument` messages with allocation and imbalance data. |
| `TimeSeriesDocument` | The PVNed message envelope. See [PVNed integration](../30-integrations/01-pvned-timeseries.md). |
| `Pos` | Position within a period — the 1-based index of a 15-minute interval. `Pos=1` is 00:00–00:15 local time. |
| `BusinessType` / `Direction` / `ProcessType` | PVNed coded fields determining what a timeseries contains. Decoded in the integration spec. |
| **Montel** | Market-data provider supplying price indications and day-ahead prices. |
| **Ticker** | A Montel instrument identifier for a tradeable product, e.g. Dutch power base month-ahead. |
| **CM.com** | Payment service provider candidate for iDEAL top-ups. |
| **Odoo** | The accounting system that receives finalised invoices. |
| **Entra ID** | Microsoft's identity provider, and **the production identity provider for this platform [DEC-20]**. It owns credentials; the platform never stores a customer password **[DEC-29]**, and the one employee exception is **break-glass [DEC-53]**. Customer MFA is governed by the tenant's policy rather than by the platform **[DEC-51]**; employee MFA is mandatory. The proof of concept runs with **no authentication at all** — which does not remove the tenancy context pipeline, only the login in front of it. Authentik and Okta were the alternatives considered under [OQ-03]. It runs in PeakPower's **existing corporate Microsoft tenancy [DEC-66]**, which also hosts the Azure subscriptions. ⚠ *Access* to that tenancy is a Phase 0 dependency, not an open question — and **[DEC-67]** puts it on the critical path by running the claim-mapping spike against it. |
| **SendGrid** | The transactional email provider **[DEC-48]**. Carries offer notifications, which are time-critical, and invoices, which **[DEC-47]** puts on the same channel. A dedicated sending domain with SPF, DKIM and DMARC is required and is a lead-time item. |

## Document conventions

| Marker | Meaning |
| --- | --- |
| `[OQ-nn]` | Open question — decision required. Registered in [80-open-questions.md](../80-open-questions.md). |
| `[AS-nn]` | Working assumption made in the absence of a decision. Registered in [04-assumptions-and-decisions.md](04-assumptions-and-decisions.md). |
| `[DEC-nn]` | Decision taken and recorded. |
| `[F-nn]` | Feature reference. |
| `[NFR-nn]` | Non-functional requirement reference. |
