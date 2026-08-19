# PeakPower Trading Platform — Specification

Specification and scope definition for the **PeakPower** energy trading platform, serving Dutch
**grootverbruik** (large-consumption) customers.

**📖 [Read the specification site →](https://lukastosic-ifd.github.io/peakpowerspecs/)**

> **Status:** Draft for stakeholder review · **Version:** 0.1
> Nothing here is contractually binding. Items marked `[OQ-nn]` are decisions still to be made.
> **2026-08-19 — the fourth round, and the largest.** Forty-five decisions `[DEC-68]`…`[DEC-112]`
> were recorded from the stakeholder answer sheet. **Fourteen earlier decisions and one assumption
> were reversed**, and the platform's boundary moved in both directions: invoice numbering, the PDF,
> the invoice email, VAT, surcharges, chargebacks and invoice-payment matching left the platform for
> a **bookkeeping program**, while **energiebelasting**, short selling, configurable BRPs,
> platform-matched bank-transfer deposits, withdrawals, a customer usage API and four-eyes as a
> per-company mode came in. The wallet now funds **trading only** — it no longer settles invoices.
> ⚠ **One question is blocking again:** `[OQ-69]` — the bookkeeping program's version, hosting and
> API. Five decisions moved work into that program, so the invoice cannot be issued without it.
> **2026-08-11:** three review rounds. The eleven blocking (P1) questions were decided as `[DEC-19]`…
> `[DEC-29]`, thirty-six more as `[DEC-30]`…`[DEC-65]`, and two final ones as `[DEC-66]`…`[DEC-67]`.
> Several were closed **by deferral, for the proof of concept only, or in part**, and say so where
> they are registered. Thirty-five further questions were reviewed and **deliberately parked** —
> still open, marked ⏳ — see [open questions](specs/80-open-questions.md).
> ✅ **Nothing was blocking, as at 2026-08-11** — ⚠ that no longer holds; `[OQ-69]` became blocking on
> 2026-08-19, see the note above. `[OQ-88]` reopened the P1 set for one round and closed with `[DEC-66]`:
> Entra ID uses PeakPower's **existing corporate Microsoft tenancy**, and `[DEC-56]` is clarified
> rather than reversed — no Azure **subscription, landing zone or naming standard**, but the
> subscriptions sit **under** that tenant, so employee identity stays single.
> ⚠ **What it left behind is a dependency, not a question.** *Access* to that tenancy is granted
> outside the delivery team, and `[DEC-67]` puts it on the critical path by choice by running the
> `customer_id` claim-mapping spike against it. It is tracked with a named owner and a date in
> [roadmap §2.1](specs/70-delivery/01-roadmap-and-phasing.md) — **not** in the open-question register.

---

## What is in here

| | |
| --- | --: |
| Specification documents | **47** |
| Features, fully specified | **15** |
| Numbered, testable requirements (50 retired on 2026-08-19) | **506** |
| Non-functional requirements | **77** |
| Diagrams | **70** |
| UI mockups | **19** |
| Open questions (**1 blocking**, 80 closed) | **16** |
| Decisions recorded | **112** |
| Risks — 33 active, 1 retired | **34** |

Everything lives in [`specs/`](specs/). Start with the
[specification index](specs/README.md) or the
[vision & scope](specs/00-overview/01-vision-and-scope.md).

## The platform in one paragraph

A self-service portal that lets grootverbruik customers see their energy position per metering point
and buy or sell wholesale energy blocks against it, with PeakPower brokering every trade. The
customer requests; PeakPower responds with a firm, time-limited price; the customer accepts or
rejects — and if that company has **four-eyes** switched on, a second admin of the same company must
approve it, with no threshold `[DEC-71]`. A prepaid wallet backs every trade and **nothing else**
`[DEC-77]`. Monthly invoicing settles measured **net usage** — consumption minus production —
against purchased blocks and the raw day-ahead price, which also credits surplus cover and physical
export `[DEC-87]`, plus **energiebelasting** on bracketed tiers `[DEC-74]`. The platform computes no
VAT and mints no invoice number: it pushes a draft to a bookkeeping program, which numbers it,
renders it and sends it `[DEC-76]`, `[DEC-88]`, `[DEC-89]`. Imbalance stays out of scope and
PeakPower carries that risk in full `[DEC-25]`.

## Layout

```
specs/
├── 00-overview/       vision & scope · glossary · actors · decisions & assumptions
├── 10-features/       F01–F15, each with numbered requirements
├── 20-architecture/   C4 · .NET/Aspire solution · domain model · schema · API · security · NFRs
├── 30-integrations/   PVNed · Montel · payments · Odoo · identity provider
├── 40-processes/      trade lifecycle · data flow · top-up · invoicing · annual true-up
├── 50-calculations/   energy block maths · position & coverage · invoice calculation
├── 60-mockups/        19 generated SVG wireframes + the generator
├── 70-delivery/       roadmap & phasing · risk register
├── 80-open-questions.md
├── pvned_docs/        PVNed source material — NOT in this repo, see below
└── site/              the stakeholder website
```

### A note on `specs/pvned_docs/`

The PVNed XSD, implementation guide and sample message are **deliberately not committed** — they
carry *"Copyright © PVNED B.V. All Rights Reserved"* and are not ours to redistribute.

Nothing depends on them being here.
[PVNed timeseries](specs/30-integrations/01-pvned-timeseries.md) restates the full document
structure, every code list, the interval mapping, the validation rules, a reconstructed sample
message, and the nine discrepancies found between the three sources. If you have the originals, drop
them in `specs/pvned_docs/` — the path is gitignored, so they stay local.

## Reading it locally

The Markdown renders fine in any editor or on GitHub. For the full experience — navigation, rendered
diagrams, search, and the interactive feature / open-question / risk boards:

```bash
node specs/site/build.mjs && open specs/site/index.html
```

No install, no server, no network. Node 18+ is the only requirement.

## Generated artefacts

Two things in this repository are generated and should never be hand-edited:

| Artefact | Generated by | Committed? |
| --- | --- | :--: |
| `specs/60-mockups/*.svg` | `node specs/60-mockups/generate.mjs` | yes |
| `specs/site/content.js` | `node specs/site/build.mjs` | yes |

They are committed so that a clone or a downloaded ZIP works immediately, without a build step. Both
generators are deterministic — rerunning with unchanged input produces byte-identical output, so a
diff only appears when the content genuinely changed.

**After editing any Markdown or mockup source, run both and commit the result:**

```bash
node specs/60-mockups/generate.mjs && node specs/site/build.mjs
```

CI regenerates them before publishing regardless, so a stale commit degrades to a warning rather than
a wrong site — but the committed copies are what anyone reading the repo directly will see.

## Publishing

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) regenerates the mockups and the content
bundle, sanity-checks the result, and publishes `specs/site/` to GitHub Pages on every push to `main`
that touches `specs/`. It can also be run manually from the Actions tab.

## Conventions

- **MUST / SHOULD / MAY** follow RFC 2119.
- Times are **Europe/Amsterdam** unless a document says UTC.
- Money is **EUR**; energy is **kWh** in storage and **MWh** in trading. Market prices are **€/MWh**;
  **energiebelasting bracket rates** `[DEC-74]` are **€/kWh**. A €/kWh figure read as €/MWh is wrong
  by exactly 1000 and still looks plausible. The surcharge `[DEC-35]` and feed-in tariff `[DEC-44]`
  rates that used to sit here were withdrawn on 2026-08-19 by `[DEC-73]` and `[DEC-87]`.
- Requested volume has a **0,01 MW** minimum and increment `[DEC-70]`.
- Everything is **VAT-exclusive** `[DEC-26]`, `[DEC-76]` except a **trade reservation and its wallet
  debit**, which are grossed up `[DEC-78]`.
- `[OQ-nn]` open question · `[AS-nn]` assumption · `[DEC-nn]` decision · `[F-nn]` feature ·
  `[NFR-nn]` non-functional requirement. Every reference resolves to a definition, and the
  specification site turns them into links.
