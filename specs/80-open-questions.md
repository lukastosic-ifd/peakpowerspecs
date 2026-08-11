# Open Questions

Every `[OQ-nn]` reference in this specification set resolves here. **42 open, 49 closed.**

**Blocking** means work cannot responsibly start until it is answered. **Impact** is what changes if
the answer is different from the working assumption.

> **2026-08-11 — the P1 set was closed.** Eleven blocking questions were decided as **[DEC-19]**…
> **[DEC-29]**, recorded in
> [Assumptions & decisions](00-overview/04-assumptions-and-decisions.md).
> Three of the eleven were not settled outright — [OQ-05] is answered **for the proof of concept
> only**, and [OQ-14] and [OQ-31] were closed **by deferral**. Each row says so, and states the
> condition that must reopen it. [OQ-03] gives a production answer but ships the PoC unauthenticated.
> [OQ-17] was closed on its largest half only; its two money-affecting residuals are registered as
> [OQ-82] and [OQ-83] so they are not lost with the row that carried them.

> **2026-08-11, second round — the P2/P3 queue.** Thirty-six further questions were decided as
> **[DEC-30]**…**[DEC-65]**. Thirty-five more were **reviewed and consciously parked**: they stay
> **open** and are still counted as open, and they carry **⏳** so a reader can see they were looked at
> and deliberately left for later rather than overlooked. **[OQ-07]** was **not reached** — it is the
> one open row with no mark of any kind. Seven questions the decisions *created* are registered as
> **[OQ-85]**…**[OQ-91]** rather than left in prose inside a feature document.
>
> ⚠ **A P1 reappeared and was closed the same day.** **[OQ-88]** recorded a direct contradiction
> between **[DEC-20]** and **[DEC-56]**. It is resolved by **[DEC-66]** — see the third round below.

> **2026-08-11, third round — [DEC-66] and [DEC-67]. The blocking count is back to 0.**
> **[OQ-88] is closed.** Entra ID uses PeakPower's **existing corporate Microsoft tenancy**; the
> tenancy **exists**. **[DEC-56]** is **clarified, not reversed** — "no existing Azure tenancy" means
> no Azure **subscription, landing zone or naming standard**, and the greenfield infrastructure work
> stands. It does *not* mean no Entra directory: Azure subscriptions are created **under** the
> corporate Entra tenant, so employee identity stays single and **[DEC-20]**, **[DEC-51]** and
> **[DEC-53]** all keep the one directory they assume.
>
> ⚠ **What is left is a dependency, not a question — and it is deliberately not in this register.**
> *Access* to that tenancy is administered by someone outside the delivery team. It cannot be closed
> by deciding, only by being asked for, so it is tracked as a **Phase 0 dependency with a named owner
> and a date** in [Roadmap §2.1](70-delivery/01-roadmap-and-phasing.md). Do not come looking for it
> under an `OQ` number. **[DEC-67]** then puts that dependency on the critical path *by choice*: the
> `customer_id` claim-mapping spike runs against the corporate tenancy rather than a throwaway
> developer tenant. See **[R-24]**, re-scored from 16 to 9 and retitled to match.

| Priority | Meaning |
| :--: | --- |
| 🔴 **P1** | Blocks a phase. Needed before that phase can be estimated or built |
| 🟠 **P2** | Shapes the design. Needed before the affected feature is built |
| 🟡 **P3** | Affects detail or polish. Can be decided during build |
| ⏳ | **Reviewed and parked on 2026-08-11.** Still **open** and still counted as open. Considered in the second decision round and deliberately deferred, not overlooked. The mark sits at the front of the question text |
| ✅ | **Closed — settled.** A decision was taken and the question is answered |
| ⏸ | **Closed by deferral, for the PoC only, or in part.** Not counted as open, and not settled either: the row states what was answered, what was not, and what must reopen it |

---

## The seven still live

Thirty-five of the 42 open questions are parked ⏳ — reviewed on 2026-08-11 and deliberately left.
What is *unparked* is exactly seven: the six the second decision round created that are **still**
open, and [OQ-07], which was never reached. The seventh created question, [OQ-88], closed with
**[DEC-66]**. **None of the seven is blocking.** If only a few decisions can be made before the next
planning session, make these.

| Ref | Question | Why it is first |
| --- | --- | --- |
| **[OQ-85]** | What is the four-eyes threshold, and is it one global figure or per customer? | **[DEC-33]** requires approval above a threshold and deliberately does not say what it is. The reference table ships **empty**, and acceptance is refused while no row is in force — so the state cannot be built or exercised until this exists |
| **[OQ-86]** | When a customer exports and no feed-in tariff resolves, is the export valued at zero or at day-ahead? | **[DEC-44]** specifies the line and the tariff but not the fallback. The two candidates are **€662.53 apart** on one EAN for one month — five times the whole effect of the decision that raised it. Invoicing is skipped rather than defaulted until it is answered |
| **[OQ-89]** | How long is a break-glass account enabled for, and what may that session reach? | **[DEC-53]** states neither. Both are configuration with no shipped default, and the path cannot be enabled for the first time — or rehearsed, which **[DEC-53]** makes non-negotiable — without them |
| **[OQ-91]** | Who sets a metering point's production expectation, when, and what happens when it changes? | **[DEC-65]** requires the property but not its ownership. `UNKNOWN` is treated as `EXPECTED` for alerting, so an unowned worklist becomes permanent false alarms — and under **[DEC-22]** the property decides a settlement figure |
| **[OQ-87]** | Does the platform apply a calorific correction for gas (m³ → kWh)? | **[DEC-30]** fixes gas volumes in m³, but gas is conventionally *billed* on energy content. It decides whether a gas metering point stores one volume series or two. Not on this track's critical path, but retrofitting a conversion under a stored volume series reprices history |
| **[OQ-90]** | Is the invoice PDF attached to the email, or linked from it? | **[DEC-46]** settles who generates the PDF and **[DEC-47]** that invoices are emailed; neither says which of the two. Cheap to decide, and it changes the deliverability and retention profile of the channel **[DEC-48]** |
| **[OQ-07]** | Is bank statement import (CAMT.053) in scope? | **Not reached** on 2026-08-11 — neither decided nor parked. It is the one row carrying no mark, and it should be either answered or parked at the next session so the register stays honest |

---

## Scope & product

| Ref | P | Question | Impact if the assumption is wrong | Owner |
| --- | :--: | --- | --- | --- |
| ~~OQ-01~~ | ✅ | ~~When does **gas** enter scope? Same EAN model, same block products, or something else?~~ **CLOSED — the same EAN model and the same block products** **[DEC-30]**. Only pricing and units differ: gas volumes are in **m³** rather than kWh. Vindicates **[DEC-15]** — the commodity discriminator is the whole of the structural work | What is settled is the *shape* gas takes when it arrives, not the date; gas stays out of this track. ⚠ **The calorific correction is not answered** — gas is metered in m³ and conventionally billed on energy content. Registered as [OQ-87] | Closed |
| ~~OQ-04~~ | ✅ | ~~Are differentiated roles needed **within** a customer organisation?~~ **CLOSED — no.** All accounts of a company have identical privileges **[DEC-16]**; what distinguishes them is attribution, not permission **[DEC-17]** | — | Closed |
| ~~OQ-06~~ | ✅ | ~~Should EANs be validated against an external market register (EDSN / C-AR)?~~ **CLOSED — no** **[DEC-31]**. The GS1 check digit remains the only validation | Typos that pass the check digit reach ingestion and surface as quarantined unknown-EAN documents. That is the accepted cost of not taking an EDSN/C-AR dependency | Closed |
| ~~OQ-08~~ | ✅ | ~~Minimum and increment for a requested volume~~ **CLOSED — minimum 0,1 MW, increment 0,1 MW** **[DEC-32]** | ⚠ Coarser than the 0,001 MW increment the specs assumed. Every requested volume, and therefore every per-EAN allocation, is now a multiple of 0,1 MW, so the "non-whole-MW total" warning in [F05](10-features/F05-energy-block-trading.md) fires far more often — 0,1 MW steps rarely sum to whole clips | Closed |
| ~~OQ-09~~ | ✅ | ~~Is four-eyes approval required above a value threshold?~~ **CLOSED — yes** **[DEC-33]**. This is the one answer that **adds a state to the trade state machine**, which was previously exactly ten transitions: an approval state, an approver identity distinct from the acceptor, and back-office UI | ⚠ **The threshold value is not specified** and is reference data with no shipped default, so acceptance above it can be neither permitted nor refused until a row is in force. Registered as [OQ-85]. Design and reasoning in [F05 §3.2](10-features/F05-energy-block-trading.md) | Closed |
| ~~OQ-10~~ | ✅ | ~~May a customer **sell short** — sell a block they do not hold?~~ **CLOSED — no** **[DEC-34]**, confirming the default | Removes the authorisation flag and the credit view. Sell requests validate against confirmed holdings for the period | Closed |
| ~~OQ-11~~ | ✅ | ~~Does **production** net against consumption for coverage and invoicing, or is it informational?~~ **CLOSED — it nets.** The platform's volume basis is **net usage** = consumption − production, per interval per metering point **[DEC-22]**, which **supersedes [AS-06]**. Net usage may be negative; that surplus is settled under **[DEC-23]**, and **[DEC-44]** later split the physically exported part of it onto its own line | — Treat [Position & coverage](50-calculations/02-position-and-coverage.md) and [Invoice calculation](50-calculations/03-invoice-calculation.md) as changed, not annotated | Closed |
| ~~OQ-26~~ | ✅ | ~~Must a metering point be valid for the **entire** delivery period to be included in a trade?~~ **CLOSED — yes** **[DEC-40]**. Validation rejects the request rather than silently trimming | Removes pro-rated allocations from the model entirely. With **[DEC-42]**, every block covers a whole period at a constant MW, which is what keeps the interval maths simple | Closed |
| ~~OQ-27~~ | ✅ | ~~Should the pre-submission wallet check use a buffer above the estimate?~~ **CLOSED — no buffer; 100% of the estimate** **[DEC-41]**, confirming the default | ⚠ Interacts with [OQ-83], which is parked: if the eventual invoice debit turns out to be VAT-inclusive, the absence of a buffer is what makes the shortfall bite | Closed |
| ~~OQ-28~~ | ✅ | ~~Can a customer buy into a delivery period that has **already started**?~~ **CLOSED — no** **[DEC-42]** | Removes partial-period volume and mid-period coverage starts from the model | Closed |
| **OQ-29** | 🟠 | ⏳ What happens to a customer's blocks when their contract ends mid-period? | Unwind, transfer, or settle at market? Affects offboarding and the final invoice. **Weightier since 2026-08-11** — **[DEC-43]** removes the refund payout path, so a customer closing their account with a positive balance now has no route for their money either. Offboarding is the gap both leave | Legal / Commercial |
| **OQ-55** | 🟡 | ⏳ Does any customer need programmatic API access of their own? | Would add a third API surface with its own auth model | Product |
| ~~OQ-80~~ | ✅ | ~~Should a company's accounts be visible to each other in the customer portal?~~ **CLOSED — yes** **[DEC-62]**, adopting the recommendation | Reasonable transparency given **[DEC-16]**: if any colleague can spend the company's money, knowing who else holds an account is not a disclosure | Closed |
| ~~OQ-81~~ | ✅ | ~~When an offer arrives, is **every** account notified, or only the one that raised the request?~~ **CLOSED — every active account** **[DEC-63]** | A 30-minute offer must not die because one person is in a meeting, and any active account may accept **[DEC-18]**. ⚠ This makes offer notification a **phase 2** dependency of F05 while [F11](10-features/F11-notifications.md) is still tagged phase 3 — see [Roadmap §4](70-delivery/01-roadmap-and-phasing.md) | Closed |
| **OQ-85** | 🟠 | **What is the four-eyes threshold amount, and is it a single global figure or set per customer?** | Registered on 2026-08-11 from **[DEC-33]**, which requires approval above a threshold and deliberately does not state it. The table is reference data with the same shape as a surcharge **[F09-R01]**, **ships empty**, and acceptance is **refused** while no row is in force **[F05-R50]** — so this is not a tuning parameter, it is a precondition of the state existing. Too low and every trade needs two people inside a 30-minute window, which makes the platform slower than the phone call it replaces; too high and the control is decorative. Whether it is global or per customer is part of the same question — the model supports both. See [F05 §3.2 and §12](10-features/F05-energy-block-trading.md) | Risk / Trading |
| **OQ-87** | 🟠 | **Does the platform apply a calorific correction for gas — m³ to kWh — and where does the calorific value come from?** | Registered on 2026-08-11 from **[DEC-30]**, which fixes gas volumes in **m³** but does not address that gas is conventionally *billed* on energy content. It decides whether a gas metering point stores one volume series or two, whether the grid operator's calorific value per region and period becomes reference data with its own validity, and what unit a gas block product is quoted in. Gated on gas entering scope rather than on any phase of this track — but **settle it before gas is built**, because retrofitting a conversion beneath a stored volume series reprices history. See [F01 §10](10-features/F01-customer-and-metering-points.md) | Product |
| **OQ-91** | 🟠 | **Who sets a metering point's production expectation, at what point in onboarding, and what happens to already-ingested dates when it changes?** | Registered on 2026-08-11 from **[DEC-65]**, which requires the property **[F01-R39..R41]** but names no owner and no moment. It defaults to `UNKNOWN`, and `UNKNOWN` is treated as `EXPECTED` for completeness and alerting **[F02-R32]** — so an unowned worklist degrades into permanent false alarms, which is how alerting gets ignored. **[F01-R41]** takes the forward-only reading of a change deliberately, because the alternative re-opens finalised delivery dates with data PVNed will never resend **[DEC-57]**; whether that is the intended commercial answer is not established. Under **[DEC-22]** this property decides a settlement figure, not a chart | Operations |

## Market & calculation

| Ref | P | Question | Impact | Owner |
| --- | :--: | --- | --- | --- |
| ~~OQ-02~~ | ✅ | ~~**Do peak blocks exclude public holidays, and who owns the holiday list?**~~ **CLOSED — they do not.** Peak is Monday to Friday, at or after 08:00 and strictly before 20:00 Europe/Amsterdam; a holiday falling on a weekday is a peak day **[DEC-19]**. This matches the exchange convention for Dutch power peak-load products, so the platform's peak volume agrees with the market PeakPower hedges in. `excluded_dates[]` is empty | **[DEC-14]** still stands — the calendar remains reference data with a weekday rule and an exclusion list, so the empty list can change without a release. **Retires risk R-03** (was 16) | Closed |
| ~~OQ-12~~ | ✅ | ~~Confirm a "**topup**" is a €/MWh surcharge, not a fixed periodic fee or a scheduled wallet deposit~~ **CLOSED — a per-unit fee, quoted and stored in €/kWh** **[DEC-35]** | ⚠ **A unit change, not a label change.** Every other price in the system is €/MWh. The surcharge formula loses its `/1000` divisor, and the rate column needs **widened precision** — €/kWh at 4 decimals is 1000× coarser than €/MWh at 4 decimals, which is a silent mispricing rather than an error. See [Invoice calculation §6.1](50-calculations/03-invoice-calculation.md) and **risk R-23** | Closed |
| ~~OQ-13~~ | ✅ | ~~**How is surplus (over-covered) volume settled?**~~ **CLOSED — credited at the day-ahead price** for the interval concerned **[DEC-23]**. It appears as a **separate sale line, never netted against purchase lines**, because uncovered and surplus volumes occur at different times and therefore at different prices | ⚠ **Narrowed by [DEC-44]**: the sale leg splits. *Unused block cover* still settles at day-ahead under this answer; *physical export* moves to a feed-in tariff on line 6. Both remain separate from the purchase lines | Closed |
| ~~OQ-14~~ | ⏸ | ~~**Energiebelasting**: source and ownership of the annual tariff table; does the *vermindering* apply; do any customers hold exemptions or reduced rates?~~ **CLOSED BY DEFERRAL — out of scope for now** **[DEC-24]**. Invoice line 5 is not implemented. `IEnergyTaxCalculator` and `billing.energy_tax_tariff` stay in the model, unpopulated, so the calculation drops in rather than being retrofitted | ⚠ **Deferred, not settled. EB is a legal obligation, not a feature — reopen before a single invoice is issued to a real customer.** The January annual true-up is deferred alongside it, keeping only its residual role of correcting late metering data. [OQ-77] parks against the same reopening | Closed |
| ~~OQ-15~~ | ✅ | ~~**Imbalance allocation.** Can PVNed supply imbalance per EAN? If not, is pro-rata on consumption acceptable, and is it in the customer contract?~~ **CLOSED — imbalance is out of scope.** Invoice line 3 is not implemented; PVNed `A12` documents are stored but not turned into charges **[DEC-25]**. No allocation method is needed, and none goes in the customer contract. Moots **[AS-18]** | Storing `A12` rather than discarding it keeps the option open at the cost of a table. The allocation question returns as a live one if imbalance is ever invoiced | Closed |
| ~~OQ-16~~ | ⏸ | ~~What resolution does Montel deliver for the NL day-ahead curve, and is history available for backfill?~~ **CLOSED IN PART ONLY** **[DEC-36]** — what the decision settles is the **arrival time**: the NL day-ahead curve arrives at **18:00 Amsterdam** for electricity, which replaces the four-attempt 13:00/14:00/15:00/18:00 schedule with a single scheduled fetch plus retry | ⚠ **Neither half of the question as asked is answered.** The **resolution** Montel delivers and whether **history is available for backfill** both remain unknown, and **[DEC-36]** says so explicitly. Storage handles hourly and 15-minute by design, but backfill depth limits how far back positions can be settled — **reopen before F08 backfill is built for the first invoiced period** | Closed |
| **OQ-25** | 🟡 | ⏳ Are indications shown raw, or with a PeakPower spread? | Affects customer expectation of the eventual offer. Note **[DEC-44]** settled the neighbouring question for *settlement* — day-ahead is used raw, with no spread — which does not decide it for *indications* | Commercial |
| ~~OQ-35~~ | ✅ | ~~Is the **raw** day-ahead price used for settlement, or a price plus a configured spread?~~ **CLOSED — raw, no spread** **[DEC-44]**, which also answers the other half it carried: physically exported volume is separated out into its own line category at a **feed-in tariff**, rather than settling at day-ahead | ⚠ **This partially reopens [DEC-23]** and is one of the three expensive decisions of the round: a sixth line category, a new per-customer reference-data table alongside the surcharge, and a changed volume identity. ⚠ **The fallback when no feed-in tariff resolves is not answered** — registered as [OQ-86] | Closed |
| **OQ-36** | 🟡 | ⏳ Is the surcharge applied to consumption only, or to all invoiced volume including surplus sales? | Changes the surcharge base — and **[DEC-44]** sharpens it again on top of **[DEC-22]** and **[DEC-23]**: invoiced volume now leaves by **three** doors rather than two (day-ahead purchase, unused block cover at day-ahead, physical export at the feed-in tariff), so "consumption only" and "all invoiced volume" are further apart than they were | Finance |
| **OQ-76** | 🟡 | ⏳ True-up materiality threshold (default €25) — and should waived amounts accumulate? | Below-threshold deltas produce a statement, not a document. **Changed by [DEC-24]**: the true-up is deferred with energiebelasting and keeps only its residual role of correcting late metering data, so this threshold is now the *only* judgement governing that correction rather than one of two. **[DEC-57]** narrows it further — PVNed supplies nothing after the 10-working-day window, so there is less to correct | Finance |
| **OQ-77** | 🟠 | ⏳ When an EAN transfers between customers mid-year, how is the annual energiebelasting tier applied? | The tax is levied per connection per calendar year, which may mean the two periods must be considered together — a fiscal question, not a technical one. **Parked with [DEC-24]** and must be answered as part of reopening energiebelasting, not after it. Now the **only** remaining tax-advisor question, since **[DEC-64]** closed [OQ-82] | Finance / Tax advisor |
| **OQ-86** | 🟠 | **When a customer exports and no feed-in tariff resolves, is the export valued at zero or at the day-ahead price?** | Registered on 2026-08-11 from **[DEC-44]**, which specifies the line and the tariff but not the fallback. Both answers are defensible — zero is symmetric with the surcharge's resolution order; day-ahead is the pre-**[DEC-44]** behaviour under **[DEC-23]** and arguably the neutral market price — and they are **€662.53 apart on one EAN for one month** in the worked example, more than the credit actually invoiced there and roughly five times the whole net effect of **[DEC-44]** on that invoice. **Until it is answered nothing is defaulted**: a month with export and no resolving tariff is skipped with `MISSING_FEED_IN_TARIFF` **[F10-R39]**, and a month without export raises a warning only. Skipping is recoverable; a wrong credit on a finalised invoice is a credit note. See [F09 §11.1](10-features/F09-surcharges.md) and [Invoice calculation §7A.2](50-calculations/03-invoice-calculation.md) | Commercial |

## Money & wallet

| Ref | P | Question | Impact | Owner |
| --- | :--: | --- | --- | --- |
| ~~OQ-17~~ | ✅ | ~~**VAT**: rate per line category, exemptions or reverse charge, and — critically — are wallet amounts VAT-inclusive or exclusive?~~ **CLOSED on the inclusive/exclusive half — everything is VAT-exclusive.** All prices, wallet balances and reservations are ex-VAT; VAT is added at invoice level **[DEC-26]**, which **confirms [AS-10]** | ⚠ **Two money-affecting residuals were re-registered, not resolved:** [OQ-82] (rate per line category, exemptions, reverse charge) — since **closed by [DEC-64]** at 21% on every line — and [OQ-83] (does the wallet debit settle the ex-VAT subtotal or the inclusive total), which was reviewed on 2026-08-11 and **parked**, still open | Closed |
| **OQ-19** | 🟠 | ⏳ When a wallet cannot cover an invoice: full debit into negative, or partial settlement with a receivable in Odoo? | Currently full debit **[AS-12]**. Partial settlement splits the debt across two systems. **Weightier still** — with two invoice line categories removed and a third added **[DEC-44]**, the wallet path is a large share of what is left to get right, it compounds with [OQ-83], and **[DEC-59]** leaves the Odoo mapping without a source or an owner, so the receivable half has nowhere to land today | Finance |
| ~~OQ-30~~ | ✅ | ~~Refunds of surplus balance — in scope, who approves, and via the payment provider or a manual transfer?~~ **CLOSED — there is no refund payout path.** Surplus wallet balance stays in the wallet **[DEC-43]** | Removes the refund flow, the approval question and the provider-versus-manual-transfer question in one answer. ⚠ **Offboarding is left unanswered**: a customer closing their account with a positive balance has no route for their money. That is now a known gap rather than an open question, and it interacts with [OQ-29], which is parked. It also makes the refund half of **[DEC-61]** vestigial | Closed |
| ~~OQ-31~~ | ⏸ | ~~Must wallet funds be held in a **segregated client account**, and does holding customer money carry regulatory obligations?~~ **CLOSED BY DEFERRAL** **[DEC-28]** — no segregated account and no regulatory analysis for now | ⚠ **Deferred, not settled, and it is a go-live gate rather than a build gate.** The PoC **must not hold real customer funds**; the wallet may be exercised with test money only. **Risk R-05 (15) stays open** and must be answered before any real deposit is accepted — an adverse answer may imply a licence application with its own lead time | Closed |
| **OQ-32** | 🟡 | ⏳ Minimum and maximum top-up amounts | Defaults €100 / €250 000 | Finance |
| **OQ-33** | 🟡 | ⏳ Chargeback and reversal handling | Currently a manual adjustment with a mandatory reason. Sharper under **[DEC-43]**: with no payout path, a reversal is the only route by which money leaves a wallet | Finance |
| ~~OQ-41~~ | ✅ | ~~Default wallet warning and critical thresholds — fixed amounts, or derived from recent trading volume?~~ **CLOSED — fixed amounts** **[DEC-49]** | Simple and predictable; less useful at the extremes of customer size, which is the trade accepted | Closed |
| **OQ-07** | 🟡 | Is bank statement import (CAMT.053) in scope, or is manual registration acceptable indefinitely? | Manual matching is the main operational cost of the bank-transfer route — reduced but not removed by **[DEC-61]**, which makes the company IBAN a matching key. **Not reached on 2026-08-11**: neither decided nor parked, and the only open row carrying no mark. Answer it or park it at the next session | Finance |
| ~~OQ-79~~ | ✅ | ~~What is the **company bank account** on the customer record used for — refund destination only, or also to match incoming transfers?~~ **CLOSED — both** **[DEC-61]**. Matching on a known IBAN attributes a transfer even when the customer omits the payment reference, which removes the largest source of unmatched payments | ⚠ The refund half is **vestigial** under **[DEC-43]**, which removes the payout path. The field stays because the matching half is the half that earns it | Closed |
| ~~OQ-82~~ | ✅ | ~~**VAT rate per line category**, plus any exemptions or reverse-charge cases. The 21% NL standard rate is assumed until confirmed~~ **CLOSED — 21% on every line category, no exemptions and no reverse-charge cases** **[DEC-64]**, confirming the assumed rate | ⚠ **Recorded as stated, not as advised.** If any customer is a foreign entity or otherwise outside the standard rate, this needs revisiting **before their first invoice**. [OQ-83] — whether the wallet debit is ex- or inclusive-VAT — is a different question and **remains open** | Closed |
| **OQ-83** | 🟠 | ⏳ Does the wallet `INVOICE_DEBIT` settle the VAT-**exclusive** subtotal or the VAT-**inclusive** total? | Registered on 2026-08-11 when **[DEC-26]** closed the inclusive/exclusive half of [OQ-17], reviewed in the second round and **parked**. If it is the inclusive total, a reservation sized ex-VAT **[AS-10]** under-covers the eventual debit by the VAT rate — precisely the exposure [AS-10] was flagged for, and **[DEC-41]** removed the buffer that would have absorbed it. **[DEC-64]** fixes that rate at 21%, which sizes the exposure without resolving it. **Resolve before wallet settlement is built** — the last money question standing in front of phase 2 | Finance |

## Integrations

| Ref | P | Question | Impact | Owner |
| --- | :--: | --- | --- | --- |
| ~~OQ-05~~ | ⏸ | ~~**PVNed**: endpoint URL, authentication mechanism, is a SOAP acknowledgement expected and in what format, retry policy on non-2xx, is there a test environment?~~ **CLOSED FOR THE PoC ONLY** **[DEC-21]** — the PoC ingests generated data in the PVNed document format, built against the reconstructed sample message and XSD and driven through the **real** webhook, parser and validation path. A mock PVNed follows in the test environment | ⚠ **Nothing about the real integration is answered.** Endpoint, authentication, acknowledgement format, retry behaviour and the test-environment question all remain open, and **risk R-01 (20) is deferred, not closed**. [OQ-65] carries the document-format half and is still the first PVNed conversation to open | Closed |
| **OQ-20** | 🟠 | ⏳ The supplied sample has `Period.TimeInterval` spanning a month while `MeasurementPeriode` is one day. Which governs? | The platform treats `MeasurementPeriode` + `Pos` as authoritative. An implementer trusting `TimeInterval` would write intervals to the wrong dates — and under **[DEC-21]** the data generator would encode the same mistake. **[DEC-38]** narrows the shape of the answer without giving it: one document per EAN per day makes the month-long `TimeInterval` in the sample harder to justify, not easier | PVNed |
| ~~OQ-21~~ | ✅ | ~~Message volume and cadence — one document per EAN per day, or batched across EANs?~~ **CLOSED — one document per EAN per day** **[DEC-38]** | Sizes ingestion at roughly one document per metering point per day rather than a daily batch: more documents, each small, and the per-(point, date) mutex in [Background jobs](20-architecture/06-background-jobs.md) becomes the natural unit of concurrency | Closed |
| ~~OQ-84~~ | ✅ | ~~Does PVNed send an `A01` (production) series **at all** for a metering point that never produces, or is the series simply absent?~~ **CLOSED — the series is simply absent** **[DEC-65]** | ⚠ **Confirms the gap it was raised for.** "Both directions present" **cannot** be the completeness test, and `customer.metering_point` needs a recorded **production expectation** **[F01-R39..R41]**: without it an ingestion failure on a producing connection is indistinguishable from a connection that never produces, and under **[DEC-22]** that difference is a settlement figure, not a chart. Who owns the property and when it is set is registered as [OQ-91] | Closed |
| **OQ-65** | 🟠 | ⏳ **Walk through the nine documentation inconsistencies** in [PVNed integration §9](30-integrations/01-pvned-timeseries.md) and confirm intended behaviour | Each is a place where a reasonable implementer could guess wrong. **[DEC-21]** raises the stakes: with the PoC ingesting generated data, the generator encodes these answers and phase 1 is then validated against them. Parked on 2026-08-11 because it needs PVNed in the room — which is exactly why it should be booked, not waited for. **R-01 (20) remains the highest-scoring risk on the register** | PVNed |
| ~~OQ-66~~ | ✅ | ~~Does PVNed supply reconciliation data after the 10-working-day window, and should it be ingested?~~ **CLOSED — it does not** **[DEC-57]** | The correction window is genuinely closed at 10 working days, which makes the `FINAL` state final and removes a source of late true-up work. It also removes the recovery route for a retroactive correction of already-final dates — see [OQ-91] | Closed |
| ~~OQ-75~~ | ✅ | ~~If a delivery date is permanently missing and PVNed cannot resend, is manual data entry acceptable?~~ **CLOSED — yes** **[DEC-60]**, confirming the current design | The entry is flagged as manual and surfaced on every derived figure and invoice that uses it. **[DEC-57]** makes this path more load-bearing, not less: after 10 working days there is nothing else | Closed |
| **OQ-23** | 🟠 | ⏳ Exact Montel ticker symbols for the six products | Reference data, but must be right before the price board is useful | Trading |
| ~~OQ-24~~ | ✅ | ~~**Montel licence**: may indications be shown to customers, exported by them, or displayed publicly?~~ **CLOSED — no public display; display inside the authenticated portal is permitted** **[DEC-27]**. Retires the public-price element of **[F14]** | ⚠ **Customer CSV export is not covered by this answer.** Export is redistribution, so treat it as **not permitted** until the Montel licence says otherwise. [F04](10-features/F04-price-indications.md) keeps its "Indication — not an offer" labelling and its stale-data flagging regardless. Risk R-07 reduced from 12 to 6, not closed | Closed |
| **OQ-34** | 🟠 | ⏳ Is CM.com contracted, and does the contract cover iDEAL at the expected volumes? | Provider-agnostic port, so a change is configuration plus testing. **[DEC-58]** narrows what the contract must cover to iDEAL alone, which makes this a smaller conversation than it was — but it is still a contract, and contracts have lead time | Finance |
| **OQ-67** | 🟡 | ⏳ Does the payment provider offer a settlement report suitable for automated reconciliation? | Otherwise reconciliation stays manual. Related to [OQ-07], which was not reached | Finance |
| ~~OQ-68~~ | ✅ | ~~Are non-iDEAL payment methods needed (SEPA via provider, Bancontact for Belgian entities)?~~ **CLOSED — no** **[DEC-58]**. iDEAL plus manual bank transfer is the whole payment surface | Keeps the payment surface to one method. ⚠ Note the interaction with **[DEC-64]**: a Belgian entity was the obvious reason to add Bancontact, and is also the case that would break the flat 21% VAT assumption | Closed |
| ~~OQ-37~~ | ✅ | ~~Who owns **invoice numbering** — the platform or Odoo?~~ **CLOSED — the platform** **[DEC-45]**, adopting the recommendation | Gapless sequential numbering per legal entity per year stays a platform responsibility, so the customer experience does not depend on an integration that will occasionally fail | Closed |
| ~~OQ-38~~ | ✅ | ~~Who generates the invoice **PDF** — the platform or Odoo?~~ **CLOSED — the platform** **[DEC-46]** | Keeps branding and the portal download path under platform control, and means Odoo receives structured data rather than owning the customer-facing document. ⚠ Whether that PDF is **attached to** or **linked from** the notification email is not answered here — registered as [OQ-90] | Closed |
| ~~OQ-39~~ | ✅ | ~~Are invoices emailed to customers, or portal-only?~~ **CLOSED — both.** Invoices are emailed **and** available in the portal **[DEC-47]** | Raises deliverability from a convenience to a requirement — see **[DEC-48]**. ⚠ Attachment versus link is registered as [OQ-90] | Closed |
| **OQ-69** | 🟠 | ⏳ Odoo version, hosting model, and external API availability | Determines the integration approach. ⚠ **Treat the Odoo integration as blocked rather than pending**: **[DEC-59]** establishes that no chart of accounts or tax-code mapping exists, and with this question, [OQ-71] and [OQ-72] all parked there is nothing left to specify against | Finance / IT |
| ~~OQ-70~~ | ✅ | ~~Does a chart of accounts and tax code mapping already exist, and who owns it?~~ **CLOSED — no, none exists** **[DEC-59]** | ⚠ **A negative answer that creates work rather than removing it.** The Odoo mapping table has **no source and no owner**, and it needs both. With [OQ-69], [OQ-71] and [OQ-72] parked, the Odoo integration cannot be specified in detail — treat it as **blocked**, not pending. **[DEC-24]** and **[DEC-25]** shorten the eventual mapping by two line categories; **[DEC-44]** adds one back | Closed |
| **OQ-71** | 🟠 | ⏳ Do customer records already exist in Odoo, and how are they matched to platform customers? | Partner matching must be on a stable identifier, never on name. Parked with [OQ-69] and [OQ-72]; all three are gated on the same conversation | Finance |
| **OQ-72** | 🟡 | ⏳ Does Odoo need to know about wallet balances and deposits, or only invoices? | Would extend the integration to a second document type. Parked with [OQ-69] and [OQ-71] | Finance |
| ~~OQ-18~~ | ✅ | ~~Are network/transport costs (netbeheerkosten) in scope for these invoices?~~ **CLOSED — out of scope** **[DEC-37]**, confirming the working assumption. The DSO bills grootverbruik customers directly | Removes a line of enquiry rather than a line of the invoice: nothing was built for it | Closed |
| ~~OQ-40~~ | ✅ | ~~Transactional email provider, and is a dedicated sending domain with SPF/DKIM/DMARC available?~~ **CLOSED — SendGrid** **[DEC-48]** | ⚠ **The domain half converts into work, not into an answer.** A dedicated sending domain with SPF, DKIM and DMARC is **still required** and is a lead-time item — start it early. Offer notifications are time-critical **[DEC-63]**, and **[DEC-47]** now puts invoices on the same channel, so deliverability is a settlement concern and not only a convenience | Closed |
| **OQ-90** | 🟡 | **Is the invoice PDF attached to the notification email, or linked from it for download in the portal?** | Registered on 2026-08-11 from the gap between **[DEC-46]** (the platform generates the PDF) and **[DEC-47]** (invoices are emailed *and* in the portal); neither says which of the two the email carries. Attachment is what customers expect and what most accounting inboxes are set up to file, but it puts a financial document on an outbound channel in bulk and raises the size and retention profile of every send; a link keeps the document behind authentication and makes revocation possible after a credit note, at the cost of one more click and of link-rot in an archived mailbox. Cheap to decide, awkward to change once customers have filed a year of them **[DEC-48]** | Finance |

## Identity & security

| Ref | P | Question | Impact | Owner |
| --- | :--: | --- | --- | --- |
| ~~OQ-03~~ | ✅ | ~~**Which identity provider** — Authentik (self-hosted), Entra ID, or Okta?~~ **CLOSED — Microsoft Entra ID in production, and the proof of concept runs with no authentication at all** **[DEC-20]** | ⚠ **Skipping authentication is not skipping tenancy.** The `customer_id` / `account_id` context pipeline must be built now, fed by a development context provider, so the EF Core global query filter, row-level security and the 404-not-403 behaviour are exercised from the first commit — retrofitting isolation is how **R-06** happens. ⚠ **The premise of this answer was briefly in doubt and is now confirmed**: **[DEC-66]** establishes that the tenancy is PeakPower's **existing corporate** one, so [OQ-88] closed without moving this decision. What is outstanding is **access** to that tenancy — a Phase 0 dependency, not a question | Closed |
| ~~OQ-43~~ | ✅ | ~~Is MFA mandatory for customer users?~~ **CLOSED — governed by Entra tenant policy, not by the platform** **[DEC-51]** | The platform neither enforces nor exempts customer MFA; it reads the `amr` claim as evidence. **Employee MFA remains mandatory.** ⚠ Worth recording that this moves a security control *outside* the platform's control surface. The tenant that holds the policy is now named — the existing corporate one **[DEC-66]** — so the control has an address; what the platform still cannot see is a change made to it | Closed |
| ~~OQ-44~~ | ✅ | ~~Break-glass procedure if the identity provider is unavailable~~ **CLOSED — a platform-held username and password for a small set of named employee accounts**, used only when the provider is unavailable **[DEC-53]**, which **amends [DEC-29]** | ⚠ **The platform now hashes and stores passwords**, so credential storage, rotation, lockout and breach handling return — for employees, in a narrow scope **[F13-R33..R40]**. Non-negotiable: named accounts only, disabled by default, a second factor that does not depend on the provider, every use alerted and audited, and **rehearsed** — an unrehearsed break-glass path is not a break-glass path. Customers remain fully provider-authenticated. ⚠ Two details the decision does not state are registered as [OQ-89] | Closed |
| **OQ-73** | 🟠 | ⏳ Does PeakPower run Microsoft 365 or another corporate directory? | Was recorded as *effectively answered* by **[DEC-20]**, briefly put in doubt by **[DEC-56]**, and is now **substantively answered by [DEC-66]**: the corporate Microsoft tenancy **exists** and is the one Entra ID uses. This row stays open and parked only as the **confirmation** it was always meant to be — the directory's own particulars (which employee domains it holds, its licensing, who administers it) are what is still unwritten, and they surface with the access request rather than before it. Nothing is blocked on it | IT |
| **OQ-74** | 🟡 | ⏳ Is there an existing customer-facing identity solution to reuse or migrate from? | Would change the migration plan. Still likely to be "no": **[DEC-66]** confirms an **employee** directory, and the customer-facing External ID tenant **[F13-R03]** is a separate tenant by design, so nothing it confirms carries over to the customer population | IT |
| **OQ-58** | 🟠 | ⏳ Who owns the DPIA and the processor agreements with PVNed, the payment provider, the identity provider, the email provider and the cloud provider? | Required before go-live; each is a lead-time item. The list is now fully named — PVNed, CM.com **[DEC-58]**, Entra ID **[DEC-20]**, SendGrid **[DEC-48]** and the cloud provider — which makes the work schedulable rather than open-ended. Parked, but it is the parked item with the longest external lead time | Legal |
| ~~OQ-59~~ | ✅ | ~~Are customer-managed encryption keys required?~~ **CLOSED — no.** Platform-managed keys at rest **[DEC-52]** | Confirms the default. Revisit only if a customer contract demands it | Closed |
| **OQ-60** | 🟠 | ⏳ Is an external penetration test budgeted before go-live? | [NFR-36] assumes yes. **[DEC-20]** makes it more pointed, not less: a system whose PoC ran unauthenticated needs its isolation proven from the outside — and **[DEC-53]** adds a platform-held credential store to the surface being tested | Security |
| **OQ-48** | 🟡 | ⏳ Audit retention period — does any financial regulation impose longer than the fiscal seven years? | Affects storage cost and archival design | Legal |
| ~~OQ-78~~ | ✅ | ~~**Are credentials owned by the identity provider, or must the platform hold username and password itself?** The account model says "username, password"~~ **CLOSED — the identity provider owns credentials, and the platform never stores a password** **[DEC-29]** | Phase 1 builds no credential storage, no reset flow and no lockout policy **for customers**. ⚠ **Amended by [DEC-53]**: named employee break-glass accounts are the one bounded exception, and they bring hashing, rotation and lockout back for that narrow set | Closed |
| ~~OQ-88~~ | ✅ | ~~**Entra ID was chosen as the production identity provider, but there is no Microsoft tenancy. Which of the two decisions moves?**~~ **CLOSED — neither moves. Entra ID uses PeakPower's existing corporate Microsoft tenancy** **[DEC-66]**. Resolution (a): the tenancy **exists**. **[DEC-56]** is **clarified, not reversed** — "no existing Azure tenancy" means no Azure **subscription, landing zone or naming standard**, and the greenfield work in [Deployment](20-architecture/09-deployment.md) stands untouched. The two live at different layers: Azure subscriptions are created **under** the corporate Entra tenant, so employee identity stays single and **[DEC-20]**, **[DEC-51]** and **[DEC-53]** all keep the one directory they assume | ⚠ **The residue is a dependency, not a question, and it is deliberately not registered here.** The tenancy exists; what is outstanding is **access to it**, administered by someone outside the delivery team. It cannot be closed by deciding — only by being asked for — so it lives on the **Phase 0 dependency list with a named owner and a date** ([Roadmap §2.1](70-delivery/01-roadmap-and-phasing.md)), not in this register. No `OQ` number carries it. **[DEC-67]** then puts that dependency on the critical path *by choice*: the `customer_id` claim-mapping spike runs against the corporate tenancy, so the fiddliest part of Entra stays unproven until access arrives. Mitigated, not removed, by building against standard OIDC with a local Keycloak/Authentik container. **Risk R-24 falls from 16 to 9** and is retitled | Closed |
| **OQ-89** | 🟠 | **How long is a break-glass account enabled for, and what function set may a break-glass session reach?** | Registered on 2026-08-11 from **[DEC-53]**, which states neither. The **time box** **[F13-R34]** is configuration with no shipped default, for the same reason as the four-eyes threshold: too short to be usable in an incident, or long enough that an enabled account becomes a standing one — and an account that is never used auto-disables when the box expires, so the value decides whether the control works at all. The **function set** **[F13-R38]** must be decided with operations, written down and enforced as a role rather than assumed from "admin"; until it is, the safe reading is read-only plus the specific actions an incident actually requires. Both are needed **before the path is first enabled**, and **[DEC-53]** makes rehearsal non-negotiable, so they are needed before the first rehearsal too | Security |

## Architecture & operations

| Ref | P | Question | Impact | Owner |
| --- | :--: | --- | --- | --- |
| ~~OQ-22~~ | ⏸ | ~~Which charting library, and is a commercial licence acceptable?~~ **CLOSED ON THE LICENCE HALF ONLY** **[DEC-39]** — the library must be **open-source and free**, or written in-house. Commercial licences are excluded | ⚠ **Which library is still not chosen.** **[DEC-39]** explicitly keeps the phase-0 spike and narrows it to the free field and to the cost of building custom. "The chart is the product", so this constrains the most user-visible part of the platform — the spike remains scheduled in [Roadmap §2](70-delivery/01-roadmap-and-phasing.md) and remains the one item here that needs building rather than deciding | Closed |
| ~~OQ-49~~ | ⏸ | ~~Angular component library~~ **CLOSED ON THE FRAMEWORK VERSION ONLY** **[DEC-54]** — **Angular 22** for all three front-end applications | ⚠ **The component library itself — the whole of the question as asked — is not chosen.** **[DEC-54]** says so explicitly, and combined with **[DEC-39]** the free field is the expected shape of the answer there too. Reopen with the charting spike, since both decide the same layer | Closed |
| **OQ-50** | 🟠 | ⏳ Is **Azure** confirmed, or must the design stay portable? | Aspire deploys most smoothly to Container Apps. Migration cost sits in IaC, not the application. **[DEC-56]** turns this from a question about an inherited estate into a greenfield choice, and **[DEC-66]** tilts it: subscriptions would be created **under the existing corporate Entra tenant**, which makes Azure the path of least resistance for managed identity and RBAC without making it compulsory — a non-Azure target keeps Entra as the identity provider and loses the managed-identity convenience | IT |
| ~~OQ-51~~ | ✅ | ~~Monorepo for .NET and Angular, or separate repositories?~~ **CLOSED — separate repositories** **[DEC-55]**, reversing the monorepo assumption in [Solution structure](20-architecture/02-solution-structure.md) | ⚠ **Three consequences to design for rather than discover.** The Aspire AppHost must start front-ends it does not contain; OpenAPI-generated clients now cross a repository boundary and need a publishing step; and the "one command brings up the whole system" property has to be preserved **deliberately** rather than for free. All three land in the phase-0/phase-1 setup work | Closed |
| **OQ-52** | 🟠 | ⏳ Where does the **existing Montel implementation** live, and in what shape? Are there other PeakPower .NET conventions or shared libraries to align with? | Reuse was an explicit expectation in the brief. Sharper under **[DEC-55]**: with separate repositories, "align with the existing conventions" needs to name a repository | Engineering |
| **OQ-53** | 🟠 | ⏳ Expected metering-point count at year 1 and year 3 | Determines whether monthly partitioning is sufficient and when **[DEC-09]** must be revisited. **[DEC-38]** raises document count without raising row count, so the partitioning answer is unchanged and the ingestion-throughput answer is not | Commercial |
| **OQ-54** | 🟡 | ⏳ Is a read replica needed for reporting? | Primary is likely sufficient at year-1 volumes | Engineering |
| **OQ-56** | 🟠 | ⏳ Is the 5th of the month the right invoice-run date, given PVNed's 10-working-day correction window? | Earlier means more provisional data; later delays cash. **Weightier** — **[DEC-24]** defers the annual true-up along with energiebelasting, and **[DEC-57]** confirms nothing arrives after the correction window, so the monthly run date is now close to the only correction gate that exists | Finance |
| **OQ-57** | 🟡 | ⏳ Should the Hangfire dashboard be exposed in production, or should job control go through the employee portal? | A security and usability trade-off. What authenticates the dashboard is the question **[DEC-53]** had to answer for the portal, and **[DEC-66]** sharpens it: the dashboard would authenticate against the **same corporate tenant** as the Azure control plane, so an Entra outage takes both the portal and the dashboard with it | Engineering |
| ~~OQ-42~~ | ✅ | ~~How many concurrent employees, and does the trade desk need real-time collaboration beyond a soft lock?~~ **CLOSED — a soft lock is enough, but the desk must warn when two customers request the same period** **[DEC-50]** | ⚠ **Adds a requirement rather than only removing one.** The warning is a desk-side signal that concentration is building in one delivery period — a trading concern, not a UI one | Closed |
| **OQ-47** | 🟡 | ⏳ Observability backend — Azure Monitor, Grafana stack, or something already in use? | Affects setup cost. **[DEC-56]** means there is nothing already in use, so this is a greenfield choice too — and **[DEC-53]** adds a hard requirement on top: break-glass alerting must not depend on the identity provider, which constrains where alerts are delivered | IT |
| **OQ-61** | 🟠 | ⏳ Is there a contractual SLA with customers, and what does it commit to? | Drives availability targets and the cost of the deployment topology | Commercial |
| **OQ-62** | 🟠 | ⏳ Is single-region with zone redundancy acceptable, or is a warm secondary region required? | A warm secondary roughly doubles infrastructure cost | IT / Commercial |
| **OQ-63** | 🟠 | ⏳ Who operates the platform after go-live, and what is the support rota? | P1 alerts need someone to reach. **[DEC-53]** makes this concrete rather than abstract: break-glass accounts are named people who must be reachable, enabled by a *second* named administrator, and rehearsed on a schedule. A rota is now a dependency of a security control, not only of an SLA | Operations |
| ~~OQ-64~~ | ✅ | ~~Is there an existing Azure tenancy, landing zone or naming standard?~~ **CLOSED — none of the three** **[DEC-56]**. Everything is greenfield | Naming and landing-zone conventions are this project's to set, and worth setting **before the first `deploy/infra` commit**. ⚠ **Read this narrowly, as [DEC-66] now requires**: no Azure **subscription, landing zone or naming standard** — *not* no Entra directory. The new subscriptions are created **under the existing corporate Entra tenant**, which is a constraint on the landing-zone design and on which directory holds the managed identities, not a licence to create a second one. A greenfield estate also means [OQ-50] is a free choice rather than an inherited one | Closed |

## Public website

| Ref | P | Question | Impact | Owner |
| --- | :--: | --- | --- | --- |
| **OQ-45** | 🟡 | ⏳ Is a CMS wanted, and if so which — or are content files in the repository acceptable? | Affects who can change copy. **[DEC-55]** makes the repository half of that choice concrete: the public site lives in the Angular repository, not beside the backend | Marketing |
| **OQ-46** | 🟡 | ⏳ Does PeakPower have brand guidelines and copy, or is that part of this project? | Currently no brand assets are available. All mockups are deliberately unbranded | Marketing |

---

## Summary

**91 entries · 42 open · 49 closed.**

| Priority | Count | Blocks |
| --- | --: | --- |
| 🔴 **P1** | **0** | **Nothing is blocking.** The eleven original P1s closed on 2026-08-11; [OQ-88] was created and closed the same day, by **[DEC-66]**. What [OQ-88] left behind is a **dependency** — Entra tenant *access* — tracked in [Roadmap §2.1](70-delivery/01-roadmap-and-phasing.md) with an owner and a date, not in this register |
| 🟠 **P2** | 25 | Feature-level design. 20 of them are parked ⏳ |
| 🟡 **P3** | 17 | Detail and polish. 15 parked ⏳, plus [OQ-07] (not reached) and [OQ-90] |
| ✅ Closed — settled | 43 | OQ-01, 02, 03, 04, 06, 08, 09, 10, 11, 12, 13, 15, 17, 18, 21, 24, 26, 27, 28, 30, 35, 37, 38, 39, 40, 41, 42, 43, 44, 51, 59, 64, 66, 68, 70, 75, 78, 79, 80, 81, 82, 84, 88 |
| ⏸ Closed — deferred, PoC-only or in part | 6 | OQ-05 (PoC only), OQ-14 (deferred), OQ-31 (deferred), OQ-16 (arrival time only), OQ-22 (licence half only), OQ-49 (framework version only) |

Of the 42 open, **35 are parked** ⏳ — reviewed on 2026-08-11 and deliberately deferred. **[OQ-07]** was
not reached. The remaining **six are new**, registered because the second decision round created
them: [OQ-85] (the four-eyes threshold), [OQ-86] (the feed-in fallback), [OQ-87] (gas calorific
correction), [OQ-89] (break-glass time box and function set), [OQ-90] (invoice PDF attached or
linked) and [OQ-91] (production-expectation ownership). The seventh, [OQ-88], closed with
**[DEC-66]** — 35 + 1 + 6 = 42.

Three of the thirty-six closures **change work already specified** rather than filling a gap:
**[DEC-35]** moves the surcharge to €/kWh, which is a unit migration with a silent-failure mode;
**[DEC-44]** adds a sixth invoice line category; and **[DEC-33]** adds a state to the trade state
machine. Those three are the expensive ones, and two of them left a new question behind.

### By owner

Questions with a shared owner (`Finance / Tax advisor`) are counted under both. **Five** of the 42
open questions have two owners — [OQ-29], [OQ-62], [OQ-69], [OQ-77] and [OQ-85] — so the total below
is **47**.

| Owner | Count | Note |
| --- | --: | --- |
| Finance | 15 | Still the largest group, though the second round took ten questions off this list. What is left is the wallet path ([OQ-19], [OQ-83]) and the Odoo set, which **[DEC-59]** leaves blocked rather than pending |
| IT | 6 | Was 7. [OQ-88] closed with **[DEC-66]**, and **IT no longer owns a blocking question** — it owns the **dependency** that replaced it: getting access to the corporate Entra tenancy, on the Phase 0 list rather than here |
| Commercial | 6 | Product and pricing policy, plus the feed-in fallback [OQ-86] |
| Engineering | 3 | |
| Legal | 3 | Lead-time items — DPIA and processor agreements [OQ-58], audit retention [OQ-48], offboarding with [OQ-29]. Client money is deferred **[DEC-28]** but stays a go-live gate |
| Trading | 2 | [OQ-23], and the four-eyes threshold [OQ-85] shared with Risk |
| Product | 2 | |
| PVNed | 2 | External dependency with lead time. **[DEC-21]** buys time; it does not remove the dependency, and [OQ-65] is the one to book |
| Security | 2 | |
| Marketing | 2 | |
| Operations | 2 | |
| Risk | 1 | [OQ-85], shared with Trading |
| Tax advisor | 1 | [OQ-77], shared with Finance. **[DEC-64]** closed [OQ-82], so this is the last one |

*Platform* no longer appears: its only entry, [OQ-16], closed with **[DEC-36]**.

### Suggested sequence

⚠ **The item that used to head this list is gone from it.** [OQ-88] was "first, and on its own"; it is
closed **[DEC-66]**. What replaced it is not a question and therefore has no place in this sequence —
**request access to the corporate Entra tenancy**, with a named owner and a date, on the Phase 0
dependency list ([Roadmap §2.1](70-delivery/01-roadmap-and-phasing.md)). Under **[DEC-67]** it is on
the critical path by choice, and nothing below will remind you of it.

1. **Before phase 1 planning** — [OQ-89] and [OQ-91], both of which are phase-1 build detail with no
   external dependency; then unpark the PVNed pair [OQ-20] and [OQ-65], because **[DEC-21]** makes the
   data generator the de facto specification for phase 1 and a wrong guess encoded there is validated
   by the whole phase. [OQ-50] and [OQ-52] settle the deployment target and the Montel reuse; both are
   parked and both are cheap to unpark.
2. **Before phase 2 planning** — [OQ-85] first: the four-eyes state cannot be built or exercised until
   a threshold row exists. Then [OQ-83], which sizes the reservation, and [OQ-34] on the payment
   contract. [OQ-29] is the offboarding gap **[DEC-43]** widened.
3. **Before phase 3 planning** — [OQ-86] first: it is the largest single unpriced amount left in the
   invoice arithmetic, and the invoice run refuses to guess it. Then [OQ-36] on the surcharge base and
   [OQ-56] on the run date. The Odoo set ([OQ-69], [OQ-71], [OQ-72]) needs unblocking, not merely
   answering — **[DEC-59]** established that the mapping has no source and no owner.
4. **Before go-live** — [OQ-58], [OQ-60], [OQ-48], [OQ-61], [OQ-62], [OQ-63], and the reopening of
   energiebelasting that **[DEC-24]** deferred, which brings [OQ-14] and [OQ-77] back together.
5. **Continuously** — the P3s, resolved during build. [OQ-90] and [OQ-07] belong here.

[OQ-87] sits outside this sequence on purpose: it is gated on gas entering scope, which no phase of
this track does.

### Three that need external parties and therefore have lead time

⚠ **And one that is no longer a question.** [OQ-88] used to head this list. **[DEC-66]** closed it, but
**the lead time did not go with it**: access to the corporate Entra tenancy is granted by an
administrator outside the delivery team, and **[DEC-67]** put that access on the critical path by
choice. It is tracked as a dated Phase 0 dependency ([Roadmap §2.1](70-delivery/01-roadmap-and-phasing.md)),
not as a row here — which is the right home for it and also the reason it is easy to lose. The PoC
ships unauthenticated **[DEC-20]**, so nothing is blocked *today*.

- **[OQ-65]** — PVNed. [OQ-05] is closed **for the PoC only** **[DEC-21]**, which buys time without
  removing the dependency: the real endpoint, authentication, acknowledgement format and retry
  behaviour are all still unvalidated, and **risk R-01 (20) is deferred, not closed**. Parked is not
  the same as unbooked — a third party's calendar is not controllable, so open this one anyway.
- **[OQ-58]** — Legal, on the DPIA and the processor agreements. The counterparties are now all named:
  PVNed, CM.com **[DEC-58]**, Entra ID **[DEC-20]**, SendGrid **[DEC-48]** and the cloud provider.
  [OQ-31] on client money is closed by deferral **[DEC-28]**, but **risk R-05 (15) stays open as a
  go-live gate**: the PoC must not hold real customer funds, and an adverse answer may imply a
  licence application with its own lead time.
- **[OQ-77]** — a tax advisor, on the energiebelasting tier across a mid-year EAN transfer. It is
  parked with **[DEC-24]** and must be answered as part of reopening energiebelasting. **[DEC-64]**
  closed [OQ-82] by confirming 21% on every line, which recorded the assumption rather than taking
  advice on it — if any customer sits outside the standard rate, that question returns here too.

All three can run in parallel with build; none can be skipped before go-live. The tenant-access
dependency runs in parallel too, and is the one with the earliest date.
