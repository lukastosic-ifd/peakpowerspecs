# F14 — Public Website

**Portal:** public · **Priority:** Could · **Phase:** 4 · **Size:** S

---

## 1. Summary

A marketing and information site: what PeakPower offers, who it is for, how the process works, and a
route to contact or sign in. Separate Angular application **[DEC-11]** — different audience,
different caching and SEO needs, and it must stay available when the portal is in maintenance.

Low priority and deliberately small. It is listed as a feature because it is in the brief and
because the decision *not* to fold it into the customer portal is worth recording.

> **The price teaser is withdrawn — [DEC-27].** Montel price indications must not be displayed
> publicly; display inside the authenticated portal is permitted. [F14-R09] keeps its ID and stays in
> the table below, marked deferred. Nothing else in this feature changes, and the site stays **Could**
> at size **S** — the teaser was the only requirement with a real unknown behind it.

## 2. Functional requirements

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F14-R01 | Public pages: home, proposition, how it works, about, contact, and legal (terms, privacy, cookies). | Must |
| F14-R02 | A prominent **Sign in** action linking to the customer portal. | Must |
| F14-R03 | A contact form that creates a lead notification to PeakPower, with spam protection. | Must |
| F14-R04 | Responsive, accessible to WCAG 2.1 AA. | Must |
| F14-R05 | Content is editable without a deployment — via a headless CMS or structured content files **[OQ-45]**. | Must |
| F14-R06 | Server-side rendered or pre-rendered for SEO, with correct meta and Open Graph tags. | Should |
| F14-R07 | Dutch and English. | Should |
| F14-R08 | Cookie consent, with analytics loading only after consent. | Could |
| F14-R09 | ~~A public price-indication teaser, subject to the Montel licence.~~ **Withdrawn by [DEC-27]** (was Could) — indications must not be displayed publicly. The ID is retained, not reused. Reopening it needs a new decision, not merely a licence that permits it. | Deferred |
| F14-R10 | Case studies / references section. | Could |

## 3. Business rules

1. **No authenticated data on public pages.** Ever.
2. **The public site is independently deployable** and must not share a runtime with the portals.
3. **Legal pages are versioned** with an effective date; superseded versions remain retrievable.
4. **No market prices on public pages [DEC-27].** Not as a teaser, not as a screenshot, not in
   marketing copy. The labelling rules in [F04](F04-price-indications.md) still govern the
   authenticated portal; here the rule is simpler, because there is nothing to label.

## 4. Dependencies

| Depends on | Why |
| --- | --- |
| ~~[F04](F04-price-indications.md)~~ | ~~Only if the price teaser is built~~ — dependency removed with **[DEC-27]** |
| Content and brand assets | Copy, imagery, tone of voice — not yet available |

## 5. Open questions

| Ref | Question |
| --- | --- |
| [OQ-45] | Is a CMS wanted, and if so which — or are content files in the repository acceptable? |
| [OQ-46] | Does PeakPower have brand guidelines and copy, or is that part of this project? |
| ~~[OQ-24]~~ | ~~Does the Montel licence allow a public price teaser?~~ **Closed by [DEC-27]** — no public display, licence or not. The export half of [OQ-24] stays open, but it belongs to [F04](F04-price-indications.md) |
