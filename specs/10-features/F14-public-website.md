# F14 — Public Website

**Portal:** public · **Priority:** Could · **Phase:** 4 · **Size:** S

---

## 1. Summary

A marketing and information site: what PeakPower offers, who it is for, how the process works, and a
route to contact or sign in. Separate Angular application **[DEC-11]** — different audience,
different caching and SEO needs, and it must stay available when the portal is in maintenance.
**[DEC-11] is unchanged by the 2026-08-19 round**: the split is still two applications.

Low priority and deliberately small. It is listed as a feature because it is in the brief and
because the decision *not* to fold it into the customer portal is worth recording.

> **The price teaser is withdrawn — [DEC-27].** Montel price indications must not be displayed
> publicly; display inside the authenticated portal is permitted. [F14-R09] keeps its ID and stays in
> the table below, marked deferred. Nothing else in this feature changes, and the site stays **Could**
> at size **S** — the teaser was the only requirement with a real unknown behind it.
>
> ⚠ **Reinforced 2026-08-19 by [DEC-81].** The portal price board now shows the **current** forward
> curve only — **no history and no export**, in any form, including the customer usage API
> **[DEC-97]**, which carries usage and nothing priced. So the gap between "public" and "permitted"
> has widened, not narrowed: the only place a customer sees a forward price at all is behind a login,
> once, live. Reopening [F14-R09] is further away than it was, not closer.

> **2026-08-19 round — the two remaining unknowns close, and one of them closes on the option that
> costs more per day.** There is **no CMS [DEC-93]**: content lives as files in the site's own
> repository, so a copy change is a commit, a review and a release. And the **brand already exists
> [DEC-94]** — https://peakpower.nl/ is the reference for colour, typography, logo and tone, so the
> site is no longer designed from nothing. **[OQ-45]** and **[OQ-46]** both close, leaving F14 with no
> open questions.
>
> Size stays **S**, for two reasons that roughly cancel the third. Choosing, hosting, securing and
> teaching a CMS disappears — that is a service, an internet-facing editor login and a licence removed
> from a **Could**-priority phase-4 feature. Designing an identity shrinks to matching a live site.
> Against that, every wording fix now needs a developer and a deployment; on a site this small, that
> is cheaper than the CMS it replaces, and business rule 5 states the price plainly.

## 2. Functional requirements

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F14-R01 | Public pages: home, proposition, how it works, about, contact, and legal (terms, privacy, cookies). | Must |
| F14-R02 | A prominent **Sign in** action linking to the customer portal. | Must |
| F14-R03 | A contact form that creates a lead notification to PeakPower, with spam protection. | Must |
| F14-R04 | Responsive, accessible to WCAG 2.1 AA. | Must |
| ~~F14-R05~~ | ~~Content is editable without a deployment — via a headless CMS or structured content files **[OQ-45]**.~~ ⚠ **Reversed 2026-08-19 by [DEC-93]** — there is no CMS and no deployment-free editing path at all. **Replaced by [F14-R11]**, which requires the opposite: content is files, and changing it is a release. The ID is retained, not reused. | ~~Must~~ Retired |
| F14-R06 | Server-side rendered or pre-rendered for SEO, with correct meta and Open Graph tags. | Should |
| F14-R07 | Dutch and English. | Should |
| F14-R08 | Cookie consent, with analytics loading only after consent. | Could |
| F14-R09 | ~~A public price-indication teaser, subject to the Montel licence.~~ **Withdrawn by [DEC-27]** (was Could) — indications must not be displayed publicly. The ID is retained, not reused. Reopening it needs a new decision, not merely a licence that permits it. ⚠ **Amended 2026-08-19 by [DEC-81]** — the reopening bar rises: even inside the portal the customer sees the current curve only, with no history and no export, so there is no permitted surface from which a public teaser could be derived. | Deferred |
| F14-R10 | Case studies / references section. | Could |
| F14-R11 | Content — page copy, legal text, translations and imagery references — lives as **structured files in the site's repository** and ships with the application **[DEC-93]**. No editing UI, no draft/publish state, no editor preview environment. | Must |
| F14-R12 | The visual identity — logo, colour, typography, imagery and tone of voice — follows the **live brand at https://peakpower.nl/** **[DEC-94]**. Tokens and assets are taken from that site; nothing is invented for this project, and where this site and peakpower.nl disagree, peakpower.nl is right. | Must |

## 3. Business rules

1. **No authenticated data on public pages.** Ever.
2. **The public site is independently deployable** and must not share a runtime with the portals.
3. **Legal pages are versioned** with an effective date; superseded versions remain retrievable.
   ⚠ **Amended 2026-08-19 by [DEC-93]** — under file-based content this is not free. Git history
   records *that* a legal page changed, but it is not a public retrieval route, so a superseded terms
   or privacy version stays in the repository as its own file with its own effective date and its own
   URL. The version history is content, not version control.
4. **No market prices on public pages [DEC-27].** Not as a teaser, not as a screenshot, not in
   marketing copy. The labelling rules in [F04](F04-price-indications.md) still govern the
   authenticated portal; here the rule is simpler, because there is nothing to label.
   ⚠ **Extended 2026-08-19 by [DEC-81]** — customers see forward prices **only inside the
   authenticated portal**, as the current curve, with **no history and no export**. That removes the
   last plausible route to a public number: there is no customer-held CSV to quote back, and under
   **[DEC-80]** what the portal shows is a bid plus a configurable markup rather than a raw market
   price, so it is not PeakPower's to republish either.
5. **Copy is code [DEC-93].** Who can change a word on this site: anyone with commit rights to the
   site repository — in practice a developer. A marketing or commercial colleague cannot publish a
   change themselves; they request it, a developer edits the content file, it is reviewed like any
   other change and it goes live with the next release of the site. What that costs: a typo fix has
   the same lead time as a code change, the release cadence sets how fast copy can move, and there is
   no way to correct a legal page out of hours without a deployment. What it buys: no CMS service to
   host, no editor login exposed to the internet, no CMS licence, no content-model migration, and a
   site whose content is reviewable in the same pull request as the markup that renders it.
6. **The brand is not ours to design [DEC-94].** https://peakpower.nl/ is the source for the visual
   identity, and the deliberate "no brand" convention of the structural wireframes in
   [60-mockups](../60-mockups/README.md) no longer describes this site — that convention now has a
   reference to follow, which is a change to record in the mockups README rather than here. This does
   not add design scope: matching an existing identity is the cheaper of the two possible answers to
   **[OQ-46]**.

## 4. Dependencies

| Depends on | Why |
| --- | --- |
| ~~[F04](F04-price-indications.md)~~ | ~~Only if the price teaser is built~~ — dependency removed with **[DEC-27]**, and further from returning under **[DEC-81]** |
| Content and brand assets | Copy, imagery, tone of voice — ~~not yet available~~ ⚠ **Amended 2026-08-19 by [DEC-94]**: the **brand half resolves** — colour, typography, logo and tone come from https://peakpower.nl/ and can be lifted today. The **copy half does not** — the words for home, proposition, how-it-works, about and the legal pages still have to be written by PeakPower, and under **[DEC-93]** every later revision of them is a release, not an edit |
| Site repository and release pipeline **[DEC-93]** | Content changes are deployments, so the site needs its own build-and-deploy route that a non-urgent copy fix can take without dragging a portal release with it. Business rule 2 already requires the independence; **[DEC-93]** makes it a day-to-day path rather than a deployment-topology preference |

## 5. Open questions

**None. All three questions on this feature are closed.**

| Ref | Question |
| --- | --- |
| ~~[OQ-45]~~ | ~~Is a CMS wanted, and if so which — or are content files in the repository acceptable?~~ **CLOSED 2026-08-19 — no CMS. Content is files in the repository and copy changes go through a release** **[DEC-93]**. ⚠ The Answer column asked whether an open-source CMS could be used in a later phase; the comment ("No CMS") overrides it. Implemented as [F14-R11]; [F14-R05] retired; the standing cost is business rule 5 |
| ~~[OQ-46]~~ | ~~Does PeakPower have brand guidelines and copy, or is that part of this project?~~ **CLOSED 2026-08-19 — brand guidelines exist at https://peakpower.nl/ and are the source for the visual identity** **[DEC-94]**. Implemented as [F14-R12]. ⚠ Residual, deliberately not reopened as a question: the answer covers the **brand**, not the **copy**. Writing the words is a delivery dependency (§4) with a named owner on the PeakPower side, not an unknown |
| ~~[OQ-24]~~ | ~~Does the Montel licence allow a public price teaser?~~ **Closed by [DEC-27]** — no public display, licence or not. The export half of [OQ-24] stays open, but it belongs to [F04](F04-price-indications.md) ⚠ **Settled 2026-08-19 by [DEC-81]** — that export half is now answered too, and answered *no*: no history and no export in the portal either. Nothing returns to this feature |
