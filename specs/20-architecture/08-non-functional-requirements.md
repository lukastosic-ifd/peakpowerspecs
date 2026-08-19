# Non-Functional Requirements

Each requirement is numbered, measurable and testable. "Fast" and "reliable" are not requirements.

**2026-08-19 — what the stakeholder answer round did to this register.** Three of the assumptions
these numbers leaned on turned out to be wrong, and none of them was a technical assumption. There is
**no external penetration test** budgeted **[DEC-102]**, there is **no contractual customer SLA**
**[DEC-103]**, and there is **one named operator with no rota** **[DEC-104]**. At the same time the
platform sheds invoicing mechanics to the bookkeeping program — numbering, PDF, email, VAT,
surcharges, payment matching for invoices, chargebacks and settlement from the wallet
(**[DEC-73]**, **[DEC-76]**, **[DEC-77]**, **[DEC-85]**, **[DEC-88]**, **[DEC-89]**, **[DEC-105]**) —
and gains energiebelasting calculation **[DEC-74]**, short selling **[DEC-72]**, configurable BRPs
**[DEC-69]**, platform-matched bank-transfer deposits **[DEC-106]**, withdrawals **[DEC-83]**, a
customer usage API **[DEC-97]** and four-eyes as a per-customer-company mode **[DEC-71]**.

Net effect on this file: **nine new requirements, NFR-61 … NFR-69**; sixteen amended in place; none
deleted. Every superseded phrase keeps its text and its number, struck through with the decision that
superseded it, because an unmet requirement that is quietly reworded stops being auditable.

---

## 1. Performance

| ID | Requirement | Target | How verified |
| --- | --- | --- | --- |
| **NFR-01** | Customer API read endpoints respond within | p95 **400 ms**, p99 800 ms | Load test, production SLO |
| **NFR-02** | Customer API write endpoints respond within | p95 **800 ms**, p99 2 s | Load test |
| **NFR-03** | Consumption day view interactive within | **1.5 s** warm, 3 s cold | Synthetic + RUM |
| **NFR-04** | Consumption month view interactive within | **2 s** | Synthetic |
| **NFR-05** | Trade offer appears on the customer's screen after publication within | **3 s** (SignalR), 30 s worst case (email) | Integration test |
| **NFR-06** | ~~PVNed~~ **BRP** webhook acknowledges within **[DEC-69]** | p95 **1 s**, p99 2 s | Load test |
| **NFR-07** | A ~~PVNed~~ **BRP** document is fully processed within **[DEC-69]** | **5 min** of receipt at normal load | Metric with alert |
| **NFR-08** | ~~Monthly invoice run completes for 100 customers within~~ ⚠ **Amended 2026-08-19 by [DEC-74], [DEC-88], [DEC-99]** — the monthly **calculation** run, *including* energiebelasting, completes for 100 customers within | **30 min** | Timed run |
| **NFR-09** | Employee trade desk updates within | **2 s** of a state change | Integration test |
| **NFR-61** | Customer usage API responds within, for a range of up to one month for one metering point **[DEC-97]** | p95 **500 ms**, p99 1.5 s | Load test |

⚠ **Amended 2026-08-19 by [DEC-69].** Wherever a requirement in this file says *PVNed*, read *the BRP
adapter*. PVNed is the first configured BRP, not the only one, and the ingestion targets are per
adapter: a slow second BRP may not consume the first one's budget. The webhook acknowledgement and
document-processing numbers are unchanged in value — what changed is that they now have to hold for
every adapter behind the port, which is a harder test, not a looser one.

⚠ **NFR-08 no longer covers the whole month-end.** The run it names now ends at a **calculated draft**,
not at an issued invoice: the push to the bookkeeping program and the number that comes back are
**[NFR-63]** and **[NFR-64]**, and they are reliability targets rather than latency ones. Two further
consequences of this round land on the same 30 minutes. Energiebelasting **[DEC-74]** adds a per-EAN,
per-calendar-year bracket walk — including the 50%-per-bracket split when an EAN changes hands mid-year
— which is more work inside the budget. And corrections **[DEC-99]** are no longer gated by the monthly
run at all: a correction that arrives months later produces its own invoice whenever it arrives, so the
30-minute figure is a target for the scheduled batch, not for the total monthly settlement effort.

⚠ **NFR-05's 30-second worst case matters more than it did.** **[DEC-111]** narrows offer notification
to the account that raised the request, plus the second admin when four-eyes is on **[DEC-71]**. With a
30-minute offer window and a one- or two-person audience, email latency is now directly on the path
between an offer and a lost trade. The target does not change; its consequence does.

## 2. Scalability

| ID | Requirement | Year 1 | Year 3 design point |
| --- | --- | --- | --- |
| **NFR-10** | Customers | 50 | **500** |
| **NFR-11** | Metering points | 250 | **2 500** |
| **NFR-12** | Interval rows/year | ~17 M | **~175 M** |
| **NFR-13** | Concurrent customer users | 25 | **200** |
| **NFR-14** | Concurrent employees | 5 | **25** |
| **NFR-15** | Trades per month | 100 | **1 500** |
| **NFR-16** | Inbound ~~PVNed~~ **BRP** documents per day **[DEC-69]** | 500 | **5 000** |

At the year-3 point, **[DEC-09]** (PostgreSQL only) should be re-evaluated. 175 M rows a year in
monthly partitions is still workable, but that is the frontier, not the comfort zone. The trigger to
revisit is a p95 above target on the month view, not a row count.

Everything except the database scales horizontally. The database scales vertically first, then to a
read replica for reporting **[OQ-54]**.

⚠ **Added 2026-08-19 by [DEC-70].** The minimum requested volume and increment drop from 0,1 MW to
**0,01 MW**, reversing [DEC-32]. That is ten times finer, and it lands on **NFR-15** rather than on
NFR-12: the same MW of demand can now be expressed as more, smaller trades, and per-EAN allocation
carries a non-whole-MW tail on every one of them. NFR-15's year-3 figure of 1 500 trades a month is
kept, but it is now the number most likely to be wrong, and it should be the first row re-measured once
real trading volume exists.

### 2.1 Customer usage API limits **[DEC-97]**

The usage API is the platform's first externally driven read load: it is called on the customer's
schedule, not on a person's, so it needs a bound that the portal never needed.

| ID | Requirement | Limit |
| --- | --- | --- |
| **NFR-62** | The customer usage API is rate- and volume-limited per calling company **[DEC-97]** | **60 requests/minute**, burst 120; at most **35 040 interval rows** (one metering point-year at quarter-hour resolution) per response; over-limit returns **429** with `Retry-After`; limits are reference data **[NFR-54]**, not constants |

The row cap is what stops a usage API from becoming an export API by repetition. It does not, on its
own, satisfy **[DEC-81]** — that no forward price leaves the platform — which is a separate and
stricter requirement, **[NFR-67]**. If the transport question **[OQ-95]** is answered with file/FTP
rather than HTTP, NFR-62's request rate becomes a delivery schedule and only the volume cap survives;
the requirement is written so the answer changes its units, not its existence.

## 3. Availability

⚠ **Reframed 2026-08-19 by [DEC-103].** There is **no contractual customer SLA**. Every number in this
section is therefore an **internal engineering goal**, not a commitment with a remedy: missing one is a
defect to be fixed, not a breach to be credited. The targets are kept at their original values because
they were derived from what the business actually needs — a trading window that is open during Dutch
business hours, and a webhook that cannot afford to drop a push — and not from a contract that turns
out never to have existed.

Two things follow, and both cost money rather than saving it in the obvious place.

1. **The cost case for the deployment topology loosens.** A warm secondary region was partly justified
   by an availability commitment that does not exist. **[OQ-62]** (single region with zone redundancy
   versus a warm secondary, roughly double the infrastructure cost) should now be argued on
   **data loss and recovery time** — **[NFR-29]** — and on **[DEC-104]**'s single operator, not on a
   percentage. An availability percentage with no remedy behind it is a weak reason to double a bill.
2. **NFR-21's notice period is a courtesy, not a term.** Five working days of maintenance notice stays
   in the register because customers plan around it; nothing enforces it, and nobody can claim against
   a missed announcement.

| ID | Requirement | ~~Target~~ **Internal goal [DEC-103]** |
| --- | --- | --- |
| **NFR-17** | Customer portal and API availability, business hours (07:00–19:00 CET, Mon–Fri) | **99.9%** |
| **NFR-18** | Customer portal and API availability, outside business hours | 99.5% |
| **NFR-19** | Employee portal availability, business hours | **99.9%** |
| **NFR-20** | ~~PVNed~~ **BRP** webhook availability **[DEC-69]** | **99.95%** — a rejected push may not be retried indefinitely |
| **NFR-21** | Planned maintenance | Outside 07:00–19:00 CET on weekdays, announced 5 working days ahead |
| **NFR-22** | Degraded operation: if Montel is unavailable, everything except price indications keeps working | Verified by chaos test |
| **NFR-23** | Degraded operation: if the payment provider is unavailable, bank transfer remains available ⚠ **Amended 2026-08-19 by [DEC-106], [DEC-86]** — bank transfer is a **first-class deposit route**, not a fallback, so this is now a statement about two independent routes rather than about a graceful failure | Verified |

The webhook has the highest availability target in the system. It is the one endpoint where an
outage causes permanent data loss rather than a delay, because the platform cannot ask PVNed to
resend at will. ⚠ **Softened, not withdrawn, by [DEC-98]:** reconciliation data *does* arrive after the
correction window, sometimes as a manual process. A lost push is therefore recoverable in principle and
expensive in practice, and manual entry **[DEC-60]** is the recovery path. 99.95% stays.

⚠ **NFR-23 has a new dependency.** Bank transfer only "remains available" if the platform can *match*
the incoming payment to a wallet **[NFR-65]**, which needs an incoming-payment feed that has not been
chosen — **[OQ-93]**. Until it is, the degraded mode NFR-23 promises is a manual one.

## 4. Reliability & data integrity

| ID | Requirement |
| --- | --- |
| **NFR-24** | No accepted ~~PVNed~~ **BRP** message is ever lost: raw persistence precedes acknowledgement **[DEC-03]**, **[DEC-69]** |
| **NFR-25** | Wallet balances reconcile against the ledger, verified daily, alerting on any discrepancy ⚠ **Amended 2026-08-19 by [DEC-77], [DEC-83], [DEC-106]** — the entry types being reconciled changed: `INVOICE_DEBIT` is **removed** (delivery invoices are never settled from the wallet), withdrawal debits and matched bank-transfer deposit credits are **added** |
| **NFR-26** | No financial operation is ever partially applied: reserve, settle and release are atomic ⚠ **Amended 2026-08-19 by [DEC-78]** — the amount reserved and later debited is grossed up by the **[DEC-64]** VAT rate, so an ex-VAT reservation against a VAT-inclusive debit is a partial application and this requirement forbids it |
| **NFR-27** | Every state-changing endpoint is idempotent under retry |
| **NFR-28** | Invoice calculation is deterministic and reproducible from recorded inputs ⚠ **Strengthened 2026-08-19 by [DEC-74], [DEC-89], [DEC-99]** — the platform no longer holds the issued document, so reproducing the *calculation* is its only evidence in a dispute; the inputs now include the energiebelasting bracket version and the customer's reduction, and a correction invoice must reproduce both its own delta and the superseded original |
| **NFR-29** | RPO ≤ **5 minutes**; RTO ≤ **4 hours** ⚠ **Qualified 2026-08-19 by [DEC-104]** — four hours assumes the one named operator is reachable; see **[NFR-68]** |
| **NFR-30** | Backups are restore-tested quarterly, with the result recorded |
| **NFR-63** | The draft-invoice push to the bookkeeping program is at-least-once with an idempotency key, retried with backoff, and never silently dropped: **99%** of drafts accepted within **15 minutes** of the calculation run finishing, **100%** within 4 hours or an alert fires **[DEC-88]** |
| **NFR-64** | Every pushed draft either carries the invoice number the bookkeeping program returned, or is visibly in one of `pending push` / `pushed, awaiting check` / `failed`. A draft with no returned number after **5 working days** raises an alert **[DEC-88]** |
| **NFR-65** | No incoming payment is credited to more than one wallet. A payment is matched on the platform-issued reference **[DEC-106]**, falling back to the company IBAN **[DEC-61]**; a payment matching neither is **held for manual assignment**, never credited on a guess |

⚠ **NFR-63 and NFR-64 exist because [DEC-88] moved the invoice number out of the platform.** [DEC-45]
put numbering inside the platform precisely so that issuing an invoice depended on nothing external;
that reasoning has not been refuted, it has been overruled on the grounds that the bookkeeping program
is where a human checks the invoice anyway. The cost is now explicit and it is a reliability cost: a
failed push means a customer with no numbered invoice, and a stalled human check means the same thing
with nothing broken to alert on. NFR-63 covers the machine failure; NFR-64 covers the human one, which
is the more likely of the two and the one no retry policy can fix. Both targets are provisional on
**[OQ-69]** — the bookkeeping program's version and API are still unknown, and its own workflow may
make five working days either generous or absurd.

⚠ **What left this section.** Payment matching for *invoices*, chargebacks and reversals are the
bookkeeping program's **[DEC-85]**, **[DEC-105]**, and no requirement here covers them any more. NFR-65
is deliberately narrow: it is about **wallet deposits only**, which is the one payment flow the platform
still owns end to end.

## 5. Security

Detailed in [Security](07-security.md). Numbered targets:

| ID | Requirement |
| --- | --- |
| **NFR-31** | No customer can access another customer's data through any endpoint — verified by an automated test over the full route table ⚠ **Widened 2026-08-19 by [DEC-97]** — the route table now includes the customer usage API, which is machine-called and therefore exercised far more than the portal |
| **NFR-32** | All traffic over TLS 1.2+; TLS 1.3 preferred |
| **NFR-33** | Employee accounts require MFA ⚠ **Extended 2026-08-19 by [DEC-92]** — customer accounts now do too; see **[NFR-66]** |
| **NFR-34** | Secrets never appear in source control, images or logs — verified in CI |
| **NFR-35** | Critical and high vulnerabilities in dependencies remediated within 7 days |
| **NFR-36** | ~~Penetration test completed before go-live, findings closed or risk-accepted in writing~~ ⚠ **Amended 2026-08-19 by [DEC-102]** — **no external penetration test is budgeted before go-live.** The requirement is **not withdrawn**: it stays on the register unmet, and what go-live requires instead is a **written risk acceptance signed by PeakPower** naming the untested surface and the compensating controls. Reinstating the test needs a budget decision, not a new requirement number |
| **NFR-66** | MFA is **mandatory** for customer users. Enforcement remains Conditional Access in the Entra tenant **[DEC-66]**, but the platform **verifies the authentication-method claim on the token** and rejects a session without it, rather than trusting the tenant silently **[DEC-92]** |
| **NFR-67** | No forward price, price indication or day-ahead curve is reachable through any customer-facing programmatic route, and no price data is exportable from the portal **[DEC-81]**, **[DEC-97]** — verified by the same automated route-table test as **NFR-31** |

⚠ **The residual risk NFR-36 now carries, recorded rather than dropped.** Three things go to production
proven only by tests the same team wrote: the tenant isolation of **NFR-31**, which is the control
standing between two customers' consumption and trading data; the platform-held credential store
**[DEC-53]**; and — new this round — the customer usage API **[DEC-97]**, an authenticated,
machine-driven surface that did not exist when NFR-36 was written and that widens the untested attack
surface rather than leaving it unchanged. **[DEC-20]** sharpens it further: the PoC ran unauthenticated,
so the isolation layers have never been probed from outside by anyone with an incentive to break them.
The compensating controls are real but they are all internal — NFR-31's route-table test, NFR-34's CI
secret scanning, NFR-35's seven-day remediation window and NFR-32's transport floor. What none of them
substitutes for is an adversary. That is the accepted risk, and **[OQ-60]** closes ✅ on the budget
question with the risk open.

⚠ **NFR-66 costs onboarding friction and [DEC-92] accepts it explicitly.** Every customer user needs an
MFA method enrolled before first use, on accounts that PeakPower employees create for them **[DEC-16]**.
That is a support burden on a small team, on a customer base of energy buyers rather than software
users. It is accepted because the same credential authorises a trade against a prepaid wallet.

## 6. Retention & compliance

⚠ **Settled 2026-08-19 by [DEC-95].** No financial regulation imposes longer than the Dutch fiscal
**seven years**, which closes **[OQ-48]** at the number already in this table. The more consequential
half of the same decision is *where* the record lives: the **financial record of record is the
bookkeeping program**, because that is where the invoice is numbered **[DEC-88]**, rendered and sent
**[DEC-89]**, where VAT is computed **[DEC-76]** and where payments and chargebacks are matched
**[DEC-85]**, **[DEC-105]**. The platform pushes ledger identifiers and values and retains an **audit
trail of actions** — who did what, when, on which account **[DEC-17]**.

That split does not shorten the platform's own retention by a day. It still has to reproduce a
seven-year-old calculation on demand **[NFR-28]**, and it is still the only system that holds the
interval data the calculation was made from.

| ID | Requirement |
| --- | --- |
| **NFR-37** | Financial records (ledger, invoices, trades) retained **7 years** — Dutch fiscal requirement ⚠ **Amended 2026-08-19 by [DEC-95], [DEC-88], [DEC-89]** — the platform retains its **calculations, trades, wallet ledger and pushed ledger entries**; the issued invoice document, its number and its payment status are the bookkeeping program's record. Retention on the platform side is unchanged at 7 years |
| **NFR-38** | Interval data retained 7 years, including superseded versions |
| **NFR-39** | Raw inbound ~~messages~~ **BRP messages** retained 2 years hot, 7 years cold **[DEC-69]** |
| **NFR-40** | ~~Audit records retained per **[OQ-48]**, minimum 7 years~~ ⚠ **Amended 2026-08-19 by [DEC-95]** — audit records are retained for **seven fiscal years**, full stop; [OQ-48] is closed and there is no longer-than-seven-years case. The audit trail covers **actions**, and this round added three kinds worth naming: four-eyes approvals and declines **[DEC-71]**, withdrawal requests, approvals and payouts **[DEC-83]**, and bank-account activations and deactivations — a bank account can never be edited, only deactivated **[DEC-71]** |
| **NFR-41** | All data stored and processed within the EU |
| **NFR-42** | GDPR rights supportable within 30 days of request |

⚠ **NFR-42 has a named owner for the test phase only.** The DPIA and the processor agreements are held
by **Kikker** **[DEC-101]**; ownership transfers to PeakPower in a later phase. That transfer is a
go-live item with a date, not an open question. It matters here because the bookkeeping program is now
a processor holding customer financial data **[DEC-108]**, and it was not in scope when the paperwork
was drafted.

## 7. Usability & accessibility

| ID | Requirement |
| --- | --- |
| **NFR-43** | Customer portal meets **WCAG 2.1 AA** |
| **NFR-44** | Employee portal meets WCAG 2.1 AA for core workflows |
| **NFR-45** | Customer portal usable on tablet; core read views usable on phone |
| **NFR-46** | Dutch primary, English secondary; no hard-coded user-facing strings **[AS-19]** |
| **NFR-47** | All money and energy figures shown with unit and currency; no bare numbers |
| **NFR-48** | Every figure derived from non-final data is visibly labelled |
| **NFR-49** | Browser support: last two major versions of Chrome, Edge, Firefox and Safari |

**NFR-48** is a usability requirement with financial consequences: an unlabelled provisional number
that a customer trades on is a dispute waiting to happen. ⚠ **It got harder on 2026-08-19.** **[DEC-99]**
makes corrections continuous — a finalised month can be reopened by a correction that arrives months
later — so "non-final" is no longer a state a figure leaves after the monthly run. Any month that has
ever been invoiced can still change, and the label has to say which of the two it is: provisional
because the data is not in yet, or settled but still correctable.

⚠ **NFR-43 versus [DEC-94].** The visual identity now has a source — the brand guidelines at
peakpower.nl — and the mockups stop being deliberately unbranded. NFR-43 is unchanged and binds
harder than the palette: where a brand colour pair fails AA contrast, the portal deviates from the
brand and records why. Accessibility is a requirement; the palette is a preference.

## 8. Maintainability

| ID | Requirement |
| --- | --- |
| **NFR-50** | Domain and application layer line coverage ≥ **80%**; calculation code ≥ **95%** ⚠ **Widened 2026-08-19 by [DEC-74]** — the energiebelasting bracket walk, the per-customer reduction and the 50%-per-bracket split on a mid-year EAN transfer are calculation code and sit under the 95% bar |
| **NFR-51** | Module dependency graph enforced by an automated architecture test |
| **NFR-52** | `dotnet run` on the Aspire AppHost brings the whole system up locally, including third-party stubs ⚠ **Amended 2026-08-19 by [DEC-69], [DEC-88]** — the stub set grows by a **BRP adapter stub** and a **bookkeeping-program stub**; without the second, no month-end path can be run end to end locally |
| **NFR-53** | A new developer reaches a running local environment within **one day** |
| **NFR-54** | Every reference-data change (calendars, tariffs, ~~surcharges~~, tickers) is possible without a deployment ⚠ **Amended 2026-08-19** — **surcharges leave the platform [DEC-73]** and **four-eyes thresholds are never built [DEC-71]**. What replaces them, and must be editable without a deployment: the **energiebelasting bracket table and its per-year rates [DEC-74]**, per-customer **reductions and exemptions [DEC-74]**, the **price markup percentage, default 2% [DEC-80]**, **BRP configuration — endpoint, credentials, document format [DEC-69]**, the per-company **four-eyes flag [DEC-71]**, the **chart of accounts and tax-code mapping [DEC-107]**, and **[NFR-62]**'s API limits |
| **NFR-55** | Database migrations are forward-only and expand/contract for breaking changes |
| **NFR-56** | Build, test and deploy to a test environment completes within **15 minutes** |

⚠ **The one deliberate exception to NFR-54.** Public-website content is **not** reference data:
**[DEC-93]** rules out a CMS, so marketing copy lives in the repository and a copy change goes through
a release. That is a knowingly worse editing experience, bought for a smaller attack surface and no
CMS to operate — which, with one operator **[DEC-104]**, is the deciding argument.

⚠ **[DEC-107] needs a named owner from day one.** The chart of accounts and tax-code mapping do not
exist yet, and this round made them bigger before they were written: they now have to carry an
energiebelasting ledger account **[DEC-74]** and a VAT rate per account **[DEC-76]**. NFR-54 makes it
editable; it does not make anyone responsible for its contents.

## 9. Observability

| ID | Requirement |
| --- | --- |
| **NFR-57** | Every request and job carries a correlation id propagated end to end |
| **NFR-58** | Business metrics emitted: trade funnel, ingestion lag, invoice run duration, wallet health ⚠ **Extended 2026-08-19** — add **draft-push outcome [DEC-88]**, **energiebelasting calculated per period [DEC-74]**, **deposits matched versus held [DEC-106]** and **open withdrawal requests [DEC-83]** |
| **NFR-59** | Alerts fire within 5 minutes of: ~~PVNed~~ **BRP** silence **[DEC-69]**, Montel staleness, ledger mismatch, failed invoice run, unconfirmed trade escalation ⚠ **Extended 2026-08-19** — add **draft-push failure [NFR-63]**, **a draft with no returned number [NFR-64]**, **an incoming payment held unmatched [NFR-65]** and **a withdrawal request awaiting payout [DEC-83]** |
| **NFR-60** | An operator can trace an invoice line back to the source ~~PVNed~~ **BRP** message through recorded links ⚠ **Extended 2026-08-19 by [DEC-88]** — and *forward* to the invoice number the bookkeeping program returned, because the trace is now only complete if it crosses the system boundary |
| **NFR-68** | Every P1 alert is delivered to the **single named operator [DEC-104]** on at least **two independent channels** (push and phone/SMS), and re-notified every **15 minutes** until acknowledged. **There is no second tier and no rota**: an unacknowledged P1 escalates to nobody |
| **NFR-69** | Alert noise budget: no more than **2 non-actionable P1 or P2 alerts per week**, reviewed monthly, with any alert exceeding it either fixed or demoted |

⚠ **NFR-68 is written to be honest rather than reassuring.** **[DEC-104]** names Thinh as the operator
after go-live, with no rota. The usual escalation ladder cannot be specified because there is nobody on
the second rung, so this requirement specifies what *can* be guaranteed — redundant delivery channels
and persistent re-notification to one person — and states the gap plainly instead of implying a chain
that does not exist. The consequences are concrete and they are not solved here:

| Exposure | Effect |
| --- | --- |
| Operator unreachable — holiday, illness, a flight, asleep | **[NFR-29]**'s four-hour RTO is not achievable for that window. Nothing in the system detects this state |
| Operator on a long incident | A second, unrelated P1 waits. Alerting is fine; response is serialised |
| Alert fatigue | With one reader, a noisy alert channel is a **total** outage of the response capability, not a degraded one. That is why **NFR-69** exists and why its budget is deliberately tight |

The mitigation available without a second person is fewer and louder alerts. **NFR-69** is therefore a
reliability requirement wearing an observability number, and it should be enforced as hard as **NFR-59**.

The backend that carries all of this is still unchosen — **[OQ-47]** — and the choice is now sharper
than it was: with one operator, mobile push quality and alert routing matter more than dashboard
sophistication.

## 10. Requirements in tension

Worth naming, because the trade-offs were deliberate:

| Tension | Resolution |
| --- | --- |
| **NFR-08** (fast invoice run) vs. **NFR-28** (deterministic and reproducible) | Reproducibility wins. Recording input versions costs storage and time; a non-reproducible invoice costs credibility. **Reinforced 2026-08-19**: the platform no longer issues the document **[DEC-89]**, so the calculation is all the evidence there is |
| **NFR-01** (fast reads) vs. tenancy layers 3 and 4 | Isolation wins. The RLS overhead is measurable but small against the cost of a leak |
| **NFR-17** (availability) vs. wallet row locking | Correctness wins. Lock contention is bounded by trade volume, which is low. ⚠ **Cheaper to say since [DEC-103]** — availability is an internal goal, so the argument no longer trades against a contractual number |
| **NFR-07** (fast ingestion) vs. **NFR-24** (never lose a message) | Durability wins. Store-then-acknowledge adds a write to the hot path and is worth it |
| **NFR-12** (data volume) vs. **DEC-09** (one database) | Simplicity wins until the year-3 point, with a defined trigger to revisit |
| **NFR-61 / NFR-62** (a usable customer usage API) vs. **NFR-67** (nothing priced leaves) — *new 2026-08-19* | The licence wins. Customers get usage over an API and can build on it; forward prices are not exposed at any rate limit, and there is no price export at all **[DEC-81]**. A customer who wants prices in a spreadsheet is told no, deliberately |
| **NFR-63 / NFR-64** (the push must work) vs. **[DEC-88]** (the bookkeeping program owns the number) — *new 2026-08-19* | The manual check wins, and the platform accepts a dependency it does not control. [DEC-45]'s argument — that numbering inside the platform depends on nothing external — was never refuted, only outweighed. Retry and a stalled-draft alert are mitigations, not ownership |
| **NFR-59 / NFR-68** (alert on everything, fast) vs. **[DEC-104]** (one operator) — *new 2026-08-19* | Signal wins over coverage. An alert nobody reads is worse than an alert that does not exist, because it teaches the one reader to ignore the channel. **NFR-69** enforces the budget |
| **NFR-36** (prove the security from outside) vs. **[DEC-102]** (no budget) — *new 2026-08-19* | Cost wins, and the risk is accepted in writing rather than reclassified as small. The requirement stays unmet on the register so that it is visible at every review |
| **NFR-66** (mandatory customer MFA) vs. onboarding friction — *new 2026-08-19* | Security wins. **[DEC-92]** accepts the friction explicitly; the same credential authorises a trade against a prepaid wallet |
| **NFR-43** (WCAG 2.1 AA) vs. **[DEC-94]** (brand guidelines from peakpower.nl) — *new 2026-08-19* | Accessibility wins on contrast; the brand wins everywhere else |
| ~~**NFR-17** (availability) vs. a contractual SLA~~ | ⚠ **Dissolved 2026-08-19 by [DEC-103]** — there is no SLA, so there is no tension. What remains is a cost question, **[OQ-62]**, not a compliance one |

## 11. Open questions

⚠ **Rewritten 2026-08-19.** Two of the four questions this file carried are closed; four more that
this file did not carry now bear directly on its numbers.

| Ref | Question | Status after 2026-08-19 |
| --- | --- | --- |
| ~~[OQ-48]~~ | ~~Audit retention period~~ | ✅ **CLOSED** — seven fiscal years, and the financial record of record is the bookkeeping program **[DEC-95]**. **NFR-40** amended |
| ~~[OQ-61]~~ | ~~Is there a contractual SLA with customers, and what does it commit to?~~ | ✅ **CLOSED** — there is none **[DEC-103]**. §3 reframed as internal engineering goals |
| [OQ-53] | Actual expected customer and metering-point counts | ⏳ Open. **NFR-10** … **NFR-16** are design points, not forecasts, and **[DEC-70]**'s 0,01 MW increment makes **NFR-15** the least trustworthy row |
| [OQ-54] | Read replica for reporting? | ⏳ Open. **NFR-62**'s row cap makes the usage API a second reporting-shaped read load, which strengthens the case |
| [OQ-62] | Single region with zone redundancy, or a warm secondary? | ⏳ Open, and **now the live question for §3**. **[DEC-103]** removed the SLA argument, so this must be decided on **NFR-29** (RPO/RTO) and on **[DEC-104]**'s single operator, against roughly double the infrastructure cost |
| [OQ-47] | Observability backend | ⏳ Open. **NFR-68** and **NFR-69** change the selection criteria: alert routing and mobile delivery quality outrank dashboards when there is one reader |
| [OQ-69] | Bookkeeping program version and API | ⏳ Open, and **should be re-prioritised to 🔴 P1**. **NFR-63** and **NFR-64** cannot have final targets without it, and under **[DEC-88]** no invoice can be issued at all without it |
| [OQ-93] | Which incoming-payment feed does the platform consume for wallet deposits? | ⏳ Open. **NFR-65** and **NFR-23**'s degraded mode both depend on it |
| [OQ-95] | Is customer usage delivered over an API, over file/FTP, or both? | ⏳ Open. Decides whether **NFR-61**'s latency target applies at all and whether **NFR-62** is a rate limit or a delivery schedule |
