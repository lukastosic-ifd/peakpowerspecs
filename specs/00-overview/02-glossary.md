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
| **Imbalance** (`onbalans`) | The deviation between a BRP's programme and its realised position in a settlement period, priced by TenneT. |
| **ISP** / MTU | Imbalance Settlement Period / Market Time Unit — 15 minutes. |
| **Energiebelasting** (EB) | Dutch energy tax. Levied per EAN per calendar year on consumed volume, with **degressive** tiers: the rate per kWh falls as annual volume rises. This is the reason an annual recalculation is required — see [Annual true-up](../40-processes/05-annual-true-up.md). |
| ODE | Opslag Duurzame Energie — a separate levy until 2022, since merged into energiebelasting. Retained here only as a historical note. |
| **Day-ahead price** | The wholesale price per MTU resulting from the day-ahead auction (EPEX SPOT NL). Applied to volume not covered by a purchased block. |
| **Base load** (`base`) | A product delivering constant power across every hour of the delivery period, 24/7. |
| **Peak load** (`peak`) | A product delivering constant power during peak hours only. See **Peak hours**. |
| **Peak hours** | Monday–Friday, 08:00–20:00 Europe/Amsterdam. **Whether public holidays are excluded is an open decision** — see [OQ-02]; the exchange convention for Dutch power peak-load products includes them. |
| **Off-peak** | Every hour that is not a peak hour. |
| **Cal** / Q / M | Trading shorthand for calendar-year, quarter and month delivery periods (e.g. *Cal-27*, *Q1-27*, *Aug-26*). |
| **Clip** | A whole-MW tradeable unit. Wholesale blocks trade in integer MW. |
| **BTW** | Dutch VAT. |

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
| **Price indication** | A non-binding market price shown to the customer, sourced from Montel. Never a quote. |
| **Trade request** | A customer's request to buy or sell a block: product, period, direction, and a volume per metering point. Raised by one customer account; **any** account of the same customer may answer the resulting offer. |
| **Offer** | PeakPower's firm, time-limited price response to a trade request. |
| **Reaction window** | The period during which an offer can be accepted. Default 30 minutes; set per offer. |
| **Block** (`energy block`) | A confirmed position: base or peak, a delivery period, a volume in MW, an agreed price, allocated across one or more metering points. |
| **Allocation (of a block)** | The split of a block's MW across the metering points named in the trade request. Not to be confused with market *allocation* above. |
| **Coverage** | For a given interval, the share of measured consumption supplied by purchased blocks. |
| **Uncovered volume** | Measured volume in excess of block coverage, priced at day-ahead. |
| **Over-coverage** | Block volume in excess of measured consumption in an interval. See [OQ-13] for the settlement rule. |
| **Wallet** | The customer's single prepaid money account. Holds a settled balance and a reserved amount. |
| **Ledger** | The append-only record of every wallet movement, each entry carrying the resulting balances. |
| **Reservation** | An amount held against the wallet for an accepted-but-unconfirmed trade. Reduces available balance without changing the settled balance. |
| **Available balance** | Settled balance minus active reservations. The amount a customer can commit. |
| **Surcharge** / **topup** | A per-MWh adder applied on top of the energy price, configured per customer per period. The original brief calls this a "topup"; this set uses **surcharge** in code and UI to avoid collision with *wallet top-up*. See [OQ-12]. |
| **Wallet top-up** | Adding money to the wallet, by iDEAL or bank transfer. |
| **Non-working day** | A day excluded from the peak calendar, if [OQ-02] resolves that way. Maintained as reference data per year. |

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
| **Authentik / Entra ID / Okta** | Identity provider candidates. See [OQ-03]. |

## Document conventions

| Marker | Meaning |
| --- | --- |
| `[OQ-nn]` | Open question — decision required. Registered in [80-open-questions.md](../80-open-questions.md). |
| `[AS-nn]` | Working assumption made in the absence of a decision. Registered in [04-assumptions-and-decisions.md](04-assumptions-and-decisions.md). |
| `[DEC-nn]` | Decision taken and recorded. |
| `[F-nn]` | Feature reference. |
| `[NFR-nn]` | Non-functional requirement reference. |
