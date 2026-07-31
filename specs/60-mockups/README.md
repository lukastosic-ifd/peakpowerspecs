# Mockups

Nineteen wireframes covering the customer portal and the employee back office.

> **What these are.** Structural wireframes: information architecture, hierarchy, density and the
> data actually on each screen. They are deliberately not visual design — no brand, no final
> typography, no illustration. What matters is *what is on the screen and how prominent it is*.
>
> **Language.** Labels are in English to match the rest of this specification set. The production UI
> is Dutch-first ([NFR-46](../20-architecture/08-non-functional-requirements.md)).
>
> **Numbers.** The figures are consistent across screens and, where they can be, derived rather than
> typed — the day chart's KPIs are computed from the series it plots, and the wallet ledger's running
> balances are computed from its own movements. So the arithmetic on the screens actually holds.

---

## Customer portal

| Screen | Feature | What it shows |
| --- | --- | --- |
| [customer-dashboard.svg](customer-dashboard.svg) | [F03](../10-features/F03-consumption-visualisation.md) | Wallet, coverage, exposure, a live offer banner with countdown, price strip, chart, activity feed |
| [ean-list.svg](ean-list.svg) | [F01](../10-features/F01-customer-and-metering-points.md) | Portfolio of connections with friendly names, data freshness and coverage per site |
| [ean-detail.svg](ean-detail.svg) | [F01](../10-features/F01-customer-and-metering-points.md) · [F02](../10-features/F02-metering-data-ingestion.md) | Label editor, master data, 14-day data-quality strip, block positions |
| [chart-day-view.svg](chart-day-view.svg) | [F03](../10-features/F03-consumption-visualisation.md) | **The core screen.** 96 intervals, block step line, covered/uncovered bands, peak-window shading, interval tooltip |
| [chart-month-view.svg](chart-month-view.svg) | [F03](../10-features/F03-consumption-visualisation.md) | Daily totals, weekend shading, missing days marked, comparison mode |
| [price-indications.svg](price-indications.svg) | [F04](../10-features/F04-price-indications.md) | Six product tiles with staleness marking, disclaimer, 90-day trend |
| [trade-wizard.svg](trade-wizard.svg) | [F05](../10-features/F05-energy-block-trading.md) | Per-connection volume split, live totals, wallet check |
| [trade-offer-countdown.svg](trade-offer-countdown.svg) | [F05](../10-features/F05-energy-block-trading.md) | Firm offer, countdown ring, per-EAN breakdown, wallet impact before/after |
| [trade-history.svg](trade-history.svg) | [F05](../10-features/F05-energy-block-trading.md) · [F15](../10-features/F15-audit-and-observability.md) | The shared audit timeline — **requested by one colleague, accepted by another** — and linked records |
| [wallet-ledger.svg](wallet-ledger.svg) | [F06](../10-features/F06-wallet-and-ledger.md) | Three balances, ledger with reservations visible, **the colleague behind each movement**, reference links |
| [wallet-topup.svg](wallet-topup.svg) | [F07](../10-features/F07-wallet-topup-and-payments.md) | iDEAL vs. bank transfer side by side, payment reference |
| [invoice-detail.svg](invoice-detail.svg) | [F10](../10-features/F10-invoicing-and-settlement.md) | Per-EAN section, all five line categories, the volume reconciliation check |

## Employee portal

| Screen | Feature | What it shows |
| --- | --- | --- |
| [employee-home.svg](employee-home.svg) | [F12](../10-features/F12-employee-back-office.md) | Operational counters, "needs attention now" ranked by urgency, exposure, integration health |
| [employee-trade-desk.svg](employee-trade-desk.svg) | [F05](../10-features/F05-energy-block-trading.md) | Three queues — to price, awaiting customer (counting down), to confirm |
| [employee-trade-detail.svg](employee-trade-detail.svg) | [F05](../10-features/F05-energy-block-trading.md) | Everything needed to price without switching context: request, customer position, market reference, wallet, pricing panel |
| [employee-customer-admin.svg](employee-customer-admin.svg) | [F01](../10-features/F01-customer-and-metering-points.md) | Company master data incl. **KvK and bank account**, **the company's accounts**, metering points with validity, commercial settings |
| [employee-wallet-admin.svg](employee-wallet-admin.svg) | [F06](../10-features/F06-wallet-and-ledger.md) | Wallets sorted by lowest available, deposit registration, adjustment with mandatory reason |
| [employee-invoice-run.svg](employee-invoice-run.svg) | [F10](../10-features/F10-invoicing-and-settlement.md) | Run outcome, a hard failure, skipped customers with named causes, drafts for review |
| [employee-ingestion-health.svg](employee-ingestion-health.svg) | [F02](../10-features/F02-metering-data-ingestion.md) | Data-state heat map, inbound message log, quarantine with a resolve action |

---

## Design decisions worth noting

**The block step line is the signature element.** Its 08:00 and 20:00 steps are the clearest possible
expression of what a peak block is. Everything about the day chart is arranged so that step is
unmissable, and the peak window is shaded behind it.

**Uncovered and surplus are separate colours, never netted.** A day can be short in the evening and
long overnight; netting to one number hides the thing the customer is trying to see.

**Provisional data is labelled everywhere it appears** — a badge in the toolbar, a note on the
invoice, a state cell in the data strip. This is [NFR-48], and it is a usability requirement with
financial consequences.

**The countdown appears three times** on the customer side — dashboard banner, offer screen ring,
notification — because a missed reaction window is a lost trade for both parties.

**Reasons are always visible.** Wherever PeakPower declines, withdraws or fails something, the
mockups show the reason text in the customer's own view, never only internally.

**Names, not just companies.** The trade timeline and the wallet ledger show *which colleague* acted,
with their role in the company beside their name. The trade-history mockup deliberately shows a
request raised by the Energy Manager and accepted by the Finance Director — the normal split, and the
whole reason attribution is per account **[DEC-17]**, **[DEC-18]**.

**Reference links everywhere.** Every ledger row, every invoice line and every block links to the
object that caused it. This is what makes goal G4 — "invoices are reconstructable" — real rather
than aspirational.

**Employee density over whitespace.** The back office is a professional tool used all day. Tables,
counters, three queues visible simultaneously, no modal that hides the queue behind it.

---

## Regenerating

The SVGs are generated, not hand-drawn. Output is deterministic — rerunning produces byte-identical
files, so the diff of a change shows only what actually changed.

```bash
node specs/60-mockups/generate.mjs
```

| File | Purpose |
| --- | --- |
| `lib.mjs` | Wireframe primitives: shell, panel, table, chart, badge, button, load-shape generator |
| `screens-customer.mjs` | The twelve customer-portal screens |
| `screens-employee.mjs` | The seven employee-portal screens |
| `generate.mjs` | Writes every SVG |

`table()` throws if the column widths exceed the table width, so a layout overflow fails the
generator rather than silently producing a clipped mockup.

## Not yet covered

Screens deliberately left out of this round, listed so the gap is visible rather than forgotten:

- Notification centre and preferences ([F11](../10-features/F11-notifications.md))
- Reference-data administration: peak calendars, tax tariffs, ticker mapping ([F12](../10-features/F12-employee-back-office.md))
- Annual true-up statement ([F10](../10-features/F10-invoicing-and-settlement.md))
- Login and invitation-acceptance flows ([F13](../10-features/F13-identity-and-access.md))
- Public website ([F14](../10-features/F14-public-website.md))
- Mobile and tablet breakpoints
- Empty states, loading states and error states — these need a pass of their own before build
