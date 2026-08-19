# PeakPower Trading Platform — Specification Set

Working specification and scope definition for the **PeakPower** energy trading platform for Dutch
**grootverbruik** (large-consumption) customers.

> **Status:** Draft for stakeholder review · **Version:** 0.1 · **Date:** 2026-08-19
> Nothing in this set is contractually binding. Items marked **[OQ-nn]** are open questions that
> need a decision before the affected work can be estimated or built.
>
> **2026-08-19 — the fourth decision round.** Forty-five decisions **[DEC-68]**…**[DEC-112]** were
> recorded from the stakeholder answer sheet. Fourteen earlier decisions and one assumption were
> **reversed**, and the shape of the platform moved: invoice numbering, the PDF, the invoice email,
> VAT, surcharges, chargebacks and invoice-payment matching all left the platform for a
> **bookkeeping program**, while **energiebelasting**, short selling, configurable BRPs,
> platform-matched bank-transfer deposits, withdrawals and a customer usage API came in. The wallet
> now funds **trading only**. One question is blocking — **[OQ-69]**, the bookkeeping program's
> version, hosting and API — because the invoice cannot be issued without it.
> See [assumptions & decisions](00-overview/04-assumptions-and-decisions.md) and
> [open questions](80-open-questions.md).

---

## How to read this

| If you are… | Start here |
| --- | --- |
| A business stakeholder | [Vision & scope](00-overview/01-vision-and-scope.md) → [Feature index](10-features/README.md) → [Roadmap](70-delivery/01-roadmap-and-phasing.md) |
| A product owner | [Feature index](10-features/README.md) → [Open questions](80-open-questions.md) |
| An architect / lead dev | [Architecture overview](20-architecture/01-architecture-overview.md) → [Solution structure](20-architecture/02-solution-structure.md) → [Domain model](20-architecture/03-domain-model.md) |
| An integrator | [Integrations](30-integrations/) |
| A finance / billing owner | [Invoice calculation](50-calculations/03-invoice-calculation.md) → [Wallet ledger](10-features/F06-wallet-and-ledger.md) |
| A designer | [Mockups](60-mockups/README.md) |

There is also a **stakeholder website** that renders this whole set with navigation, diagrams and an
open-questions dashboard. See [site/README.md](site/README.md).

```bash
node specs/site/build.mjs && open specs/site/index.html
```

---

## Contents

### 00 — Overview
| Doc | Purpose |
| --- | --- |
| [01 Vision & scope](00-overview/01-vision-and-scope.md) | What the platform is, who it serves, what is in and out of scope |
| [02 Glossary](00-overview/02-glossary.md) | Dutch energy-market and platform terminology |
| [03 Actors & roles](00-overview/03-actors-and-roles.md) | Human actors, system actors, permission model |
| [04 Assumptions & decisions](00-overview/04-assumptions-and-decisions.md) | Working assumptions and the decision log |

### 10 — Features
See the [feature index](10-features/README.md) for the full list, MoSCoW priority and release phase.

### 20 — Architecture
| Doc | Purpose |
| --- | --- |
| [01 Architecture overview](20-architecture/01-architecture-overview.md) | Context and container diagrams, key decisions |
| [02 Solution structure](20-architecture/02-solution-structure.md) | .NET solution layout, Aspire orchestration |
| [03 Domain model](20-architecture/03-domain-model.md) | Aggregates, entities, invariants |
| [04 Database design](20-architecture/04-database-design.md) | PostgreSQL schema, partitioning, indexing |
| [05 API contracts](20-architecture/05-api-contracts.md) | REST surface for both portals |
| [06 Background jobs](20-architecture/06-background-jobs.md) | Hangfire job catalogue and scheduling |
| [07 Security](20-architecture/07-security.md) | AuthN/AuthZ, tenancy isolation, secrets, audit |
| [08 Non-functional requirements](20-architecture/08-non-functional-requirements.md) | Performance, availability, retention, compliance |
| [09 Deployment](20-architecture/09-deployment.md) | Azure topology, environments, CI/CD |

### 30 — Integrations
| Doc | Purpose |
| --- | --- |
| [01 PVNed timeseries](30-integrations/01-pvned-timeseries.md) | Inbound SOAP webhook, XSD mapping, versioning rules — the first **BRP** adapter behind a shared port **[DEC-69]** |
| [02 Montel API](30-integrations/02-montel-api.md) | Price indications and day-ahead prices |
| [03 Wallet deposits](30-integrations/03-payments-cm-com.md) | iDEAL and **bank transfer matched on a platform-issued payment reference [DEC-106]**. No provider is chosen **[DEC-86]** |
| [04 Bookkeeping program](30-integrations/04-odoo-accounting.md) | Draft-invoice push and ledger entries. It owns numbering **[DEC-88]**, the PDF and the email **[DEC-89]**, and VAT **[DEC-76]** |
| [05 Identity provider](30-integrations/05-identity-provider.md) | Microsoft Entra ID **[DEC-20]** on the existing corporate tenancy **[DEC-66]**. MFA is mandatory **[DEC-92]** |

### 40 — Processes
| Doc | Purpose |
| --- | --- |
| [01 Trade lifecycle](40-processes/01-trade-lifecycle.md) | End-to-end request → offer → confirmation, state machine |
| [02 Metering data flow](40-processes/02-metering-data-flow.md) | Ingestion, versioning, finalisation |
| [03 Wallet top-up flow](40-processes/03-wallet-topup-flow.md) | iDEAL, reference-matched bank transfer, and manual withdrawal payout **[DEC-83]** |
| [04 Monthly invoicing](40-processes/04-monthly-invoicing.md) | Month-close run |
| [05 Annual true-up](40-processes/05-annual-true-up.md) | January energiebelasting bracket close **[DEC-74]**. Metering corrections are continuous, not annual **[DEC-99]** |

### 50 — Calculations
| Doc | Purpose |
| --- | --- |
| [01 Energy block maths](50-calculations/01-energy-block-maths.md) | Base/peak volume derivation, calendars, DST |
| [02 Position & coverage](50-calculations/02-position-and-coverage.md) | Covered vs. uncovered volume per interval |
| [03 Invoice calculation](50-calculations/03-invoice-calculation.md) | Full line-item model incl. energiebelasting. No VAT and no wallet settlement **[DEC-76]**, **[DEC-77]** |

### 60 — Mockups
[Mockup index](60-mockups/README.md) — SVG wireframes for the customer and employee portals.

### 70 — Delivery
| Doc | Purpose |
| --- | --- |
| [01 Roadmap & phasing](70-delivery/01-roadmap-and-phasing.md) | Release plan, MVP definition, sizing |
| [02 Risks](70-delivery/02-risks.md) | Risk register with mitigations |

### 80 — [Open questions](80-open-questions.md)
The consolidated register. Every **[OQ-nn]** reference in this set resolves here.

---

## Source material

| Source | Reference |
| --- | --- |
| PVNed TimeSeries XSD | `TimeSeriesDocument-v2p0.xsd`, schema version 2.0.1, 23 April 2026 |
| PVNed implementation guide | *PVNED Timeseries Document Implementation Guide* v2.2, 10 February 2026 |
| Sample imbalance report | `CustomerImbalanceReport.json`, document `8ff18bca-…c6c8` |
| Original brief | Stakeholder intake, 2026-07-30 |

> **The three PVNed files are not in this repository.** They carry
> *"Copyright © PVNED B.V. All Rights Reserved"* and are not ours to redistribute, so they are kept
> outside version control — place them in `specs/pvned_docs/` locally if you have them.
>
> Nothing depends on that. Everything needed to build the integration is restated in
> [PVNed timeseries](30-integrations/01-pvned-timeseries.md): the full document structure, every code
> list, the interval mapping, the validation rules, a reconstructed sample message, and the nine
> discrepancies found between the XSD, the guide and the sample.

## Conventions used in these documents

- **MUST / SHOULD / MAY** follow RFC 2119 meaning.
- All times are **Europe/Amsterdam** unless a document explicitly says UTC.
- Money is **EUR**, stored as `numeric(18,6)`, presented at 2 decimals.
- Energy volume is **kWh** in storage, **MWh** in trading and presentation.
- Power is **MW**. Minimum and increment for a requested volume are **0,01 MW** **[DEC-70]**.
- Prices, balances and pushed amounts are **VAT-exclusive** **[DEC-26]**, **[DEC-76]**; the one
  exception is a **trade reservation and its wallet debit**, which are grossed up **[DEC-78]**.
- **Bookkeeping program** is the generic name for Odoo, Moneybird or whatever is chosen — see
  **[OQ-69]**.
- `[OQ-nn]` = open question · `[AS-nn]` = assumption · `[DEC-nn]` = decision taken
