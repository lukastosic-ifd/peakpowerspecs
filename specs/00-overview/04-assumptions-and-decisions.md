# Assumptions & Decisions

Two registers. **Assumptions** are things this specification takes as true in the absence of a
decision — if an assumption is wrong, the linked work changes. **Decisions** are choices already made
and recorded, with the reasoning kept so they can be revisited honestly.

Open questions live separately in [80-open-questions.md](../80-open-questions.md).

---

## 1. Assumptions

| ID | Assumption | Because | If wrong |
| --- | --- | --- | --- |
| ~~**AS-01**~~ | *Promoted to* **[DEC-16]** — confirmed by the stakeholder, no longer an assumption. Number retired rather than reused, so older references stay resolvable | | |
| **AS-02** | One customer **company** has exactly **one** wallet, in EUR, shared by all of its accounts | The brief describes "his wallet", singular, and accounts are equal | Wallet becomes a collection; ledger, reservations and invoicing all gain a wallet dimension. Large. |
| **AS-03** | A metering point belongs to exactly one customer company at a time, with a validity period | Standard for the Dutch market: a connection has one supplier at a time | Shared/split ownership would change data scoping and invoicing. Large. |
| **AS-04** | Interval data is stored in **kWh** at 15-minute resolution, as delivered by PVNed | Matches the PVNed dependency table for allocations (`MeasurementUnit = KWH`, `Resolution = PT15M`) | Unit conversion layer needed. Small. |
| **AS-05** | Consumption and production are separate, non-negative series per metering point | PVNed models direction explicitly (`A01` production, `A02` consumption) and states all quantities are unsigned | Netting logic changes. Small. |
| **AS-06** | Trading, coverage and invoicing operate on **consumption** volume; production is displayed but does not reduce block coverage | The brief describes buying against consumption; production is described as "insight" | Net-position trading is a materially different product. Large. See [OQ-11]. |
| **AS-07** | Blocks are **constant-MW** products for the whole delivery period — no shaped or ramped blocks | Standard base/peak market products | Adding shapes means a volume curve per block. Moderate. |
| **AS-08** | Delivery periods are whole calendar **months, quarters and years** only | Stated in the brief | Weeks/days/custom ranges are a small extension of the same model. Small. |
| **AS-09** | An offer is priced as a single **€/MWh** for the whole block; there is no separate fee line on the trade | Simplest thing that matches "PeakPower will reply with the actual price offer" | A fee component splits the trade amount into energy + fee for invoicing and accounting. Moderate. |
| **AS-10** | The reservation amount equals the **full trade value** (volume × price), VAT excluded | Nothing else was specified | If VAT or a margin buffer must be reserved, the reservation formula changes. Small — but must be right before go-live. See [OQ-17]. |
| **AS-11** | Wallet money is **prepaid** and PeakPower is not extending credit; the available balance can never go below zero through a customer action | Implied by "the amount will be reserved on his wallet" | Credit limits per customer add an overdraft concept to the ledger. Moderate. |
| **AS-12** | Invoices are settled by **deducting from the wallet**, not by a separate payment run | Stated in the brief | Dunning, payment terms and receivables tracking. Large. |
| **AS-13** | The platform is the **system of record for trades and wallets**; Odoo is the system of record for **accounting** | Standard split; Odoo is described as the target for invoice data | If Odoo must own invoice numbering or credit control, the push becomes bidirectional. Moderate. |
| **AS-14** | Energiebelasting is levied **per EAN per calendar year** on net consumed volume, with degressive tiers | Dutch tax law; also the stated reason for the January true-up | The true-up process changes shape. Moderate. |
| **AS-15** | Day-ahead prices apply to all volume not covered by a block, per market time unit | Stated in the brief | — |
| **AS-16** | PVNed pushes to a single endpoint per environment, authenticated with a shared secret or mTLS | No auth details supplied; both are normal for this kind of feed | Endpoint hardening changes. Small. See [OQ-05]. |
| **AS-17** | PVNed's `ResourceObject` carries the 18-digit EAN for allocation data, and a descriptive label for imbalance data | Directly stated in the implementation guide §5.6.1 and visible in the sample imbalance report | Mapping logic changes. Small. |
| **AS-18** | Imbalance data from PVNed is at **portfolio/BRP level**, not per EAN | The sample report carries `RecourceName: "Imbalance"` with no EAN, and imbalance is a BRP-level concept | If per-EAN imbalance exists, invoicing simplifies. Otherwise an allocation key is needed — see [OQ-15]. |
| **AS-19** | Dutch (`nl-NL`) is the primary UI language; English is a fast follow | Dutch customer base | — |
| **AS-20** | Volumes are held as `numeric` decimals, never floating point, everywhere money or energy is involved | Financial correctness | — |

---

## 2. Decisions

| ID | Decision | Alternatives considered | Rationale |
| --- | --- | --- | --- |
| **DEC-01** | **Modular monolith** for the write-side domain (customers, trades, wallet, invoicing) deployed as two API hosts plus one worker host, rather than fine-grained microservices | Microservice per bounded context | The domain is small, the team is small, and the hardest problems are transactional (wallet + trade state) rather than scale. Aspire makes the multi-host layout cheap to run locally. Microservices can be extracted later along the module seams. |
| **DEC-02** | **Separate APIs for the customer portal and the employee portal**, sharing a domain library | One API with role-based routing | Different auth realms, different exposure (one is public-facing), different rate-limit and hardening profiles. Cheap to do with a shared library; expensive to retrofit. |
| **DEC-03** | **Ingestion is decoupled from processing.** The PVNed webhook persists the raw payload, acknowledges, and enqueues | Parse and process synchronously in the request | PVNed retries on non-2xx. Slow parsing would cause duplicate deliveries. Raw retention also makes replay and dispute resolution possible. |
| **DEC-04** | **Append-only ledger with derived balances**, with a materialised balance row per wallet updated in the same transaction | Balance column only; or event-sourcing the whole domain | Gives an auditable history and O(1) balance reads. Full event sourcing is more machinery than this domain needs. |
| **DEC-05** | **Reservations are ledger-visible but do not change the settled balance.** Each entry records deltas to both settled and reserved amounts, and stores all three resulting balances | Reservations in a side table only | The brief asks for reserved funds to appear as ledger lines with a resulting balance. This satisfies it without double-counting. |
| **DEC-06** | **Trade state changes are events, not column updates.** The current state is a projection of an append-only `trade_event` stream | Status column with an audit trigger | The audit trail is a first-class product requirement ("visible both by customer and employee"), not an afterthought. |
| **DEC-07** | **Interval data is stored per version, with a pointer to the current version per (metering point, delivery date, direction)** | Overwrite on each new document | PVNed sends corrections for up to 10 working days and never revises a document. Keeping versions makes "what did we invoice on" answerable. |
| **DEC-08** | **All timestamps stored as `timestamptz` (UTC); all business days computed in `Europe/Amsterdam`** | Local time storage | The only way DST arithmetic stays sane. Interval position ↔ timestamp conversion is centralised in one calendar service. |
| **DEC-09** | **PostgreSQL only** — no separate time-series database in the first track | TimescaleDB, InfluxDB, ClickHouse | Volume is modest: a 50-EAN customer generates ~3.5 M rows/year. Native declarative partitioning by month plus a BRIN/btree index handles it. Revisit if EAN count reaches four digits. |
| **DEC-10** | **Hangfire with PostgreSQL storage** for scheduled and background work | Azure Functions, Quartz.NET, a hosted queue | Stated preference; keeps the local Aspire story simple; dashboard is useful operationally. |
| **DEC-11** | **Public website is a separate Angular application**, not a route inside the customer portal | Route in the customer portal | Different audience, different caching and SEO needs, and it must stay up when the portal is in maintenance. |
| **DEC-12** | **Money is `numeric(18,6)` in the database, rounded to 2 decimals only at presentation and invoice-line level** | `numeric(18,2)` throughout | Unit prices are €/MWh with sub-cent precision, and volumes are fractional. Rounding early loses money in aggregate. |
| **DEC-13** | **The offer countdown is authoritative on the server.** The client renders a timer; expiry is decided by a server-side job and by a guard on every accept attempt | Client-side expiry | Clock skew and tab-sleep make client timers unsafe for a financially binding window. |
| **DEC-14** | **Peak-hour definition is reference data, not code.** A named calendar per commodity and year, with the working-day rule and the holiday list as data | Hard-coded Mon–Fri 08:00–20:00 | [OQ-02] is unresolved, and even once resolved the holiday list changes annually. Making it data means the answer can change without a release. |
| **DEC-15** | **Gas is modelled as a discriminator from day one** (`commodity` on metering point, product, tariff and price) but no gas logic is implemented | Electricity-only model, migrate later | The column is nearly free now; retrofitting a commodity dimension across interval data, blocks and invoices is not. |
| **DEC-16** | **A customer is a company with one or more accounts, and all accounts of a company have identical privileges.** Accounts are created and deactivated by PeakPower employees only | An intra-company role model (viewer / trader / approver); customer self-service account management | Confirmed by the stakeholder. The customer decides internally who is allowed to do what; encoding their internal governance in the platform would mean maintaining someone else's org chart. The platform's job is to record precisely who acted — which is what makes **[DEC-17]** the necessary counterpart. Closes [OQ-04]. |
| **DEC-17** | **Every customer-initiated action records the acting account**, not merely the company. Trade events, wallet movements and audit records all carry account id, display name and job title | Company-level attribution only | Direct consequence of **[DEC-16]**: if every account can spend the company's money, "the company accepted the offer" is not an adequate record. It also makes the normal split — one person spots the exposure, another approves the spend — legible instead of anonymous. |
| **DEC-18** | **A trade may be started by one account and answered by another.** No requirement that the accepting account is the requesting account | Locking a trade to its originator | The realistic workflow. An energy manager raises the request at 14:25 and the finance director accepts at 14:44; forcing the originator to accept would push customers back to phone calls, which is the behaviour this platform exists to replace. |
