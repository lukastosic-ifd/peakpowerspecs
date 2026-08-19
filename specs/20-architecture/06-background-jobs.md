# Background Jobs

Hangfire on PostgreSQL storage **[DEC-10]**, hosted in the worker. Three kinds of work: **queued**
(triggered by an event, run once), **recurring** (cron), and **scheduled** (run at a specific future
time).

---

## 1. Queues

| Queue | Purpose | Workers | Why separate |
| --- | --- | --- | --- |
| `critical` | Offer expiry, wallet operations | 4 | Must never wait behind a bulk job |
| `ingestion` | ~~PVNed~~ **BRP** document processing ⚠ **Amended 2026-08-19 by [DEC-69]** | 8 | Bursty; the bulk of the throughput. The queue is BRP-agnostic — PVNed is the first adapter behind the port **[F02-R39..R44]**, not the queue's definition |
| `default` | Rollups, cache invalidation | 4 | |
| `integration` | ~~Odoo push~~ **bookkeeping-program push [DEC-88]**, Montel polls **[DEC-96]**, ~~payment reconciliation~~ **incoming-payment matching for wallet deposits [DEC-106]** | 4 | Slow, external, retry-heavy |
| `notification` | Email dispatch via **SendGrid [DEC-48]** — offer, approval, wallet and deposit notifications, ~~**and invoices [DEC-47]**~~ ⚠ **Amended 2026-08-19 by [DEC-89]** | 4 | Isolated so a mail-provider outage stalls nothing else |
| `reporting` | Invoice runs, exports, **day-ahead backfill [DEC-75]**, the **annual energiebelasting close [DEC-74]** | 2 | Long-running; must not starve the rest |

A single shared queue would mean a 40-minute invoice run delaying an offer expiry by 40 minutes.
Separating them is the whole point.

⚠ ~~**[DEC-47] puts two very different urgencies on one queue.** The monthly run enqueues one invoice
email per customer at 02:00 on the 5th; an offer notification has a 30-minute window to be useful and
**[DEC-63]** sends one to every active account. The outbox is therefore drained in priority order —
offer, approval and expiry notifications ahead of invoices — rather than in insertion order. If
invoice volume ever makes that insufficient, the answer is a second `notification-bulk` queue, not a
larger worker count on this one.~~

⚠ **Amended 2026-08-19 by [DEC-89] and [DEC-111].** Both halves of that paragraph lost their premise.
The invoice email leaves the platform entirely — the bookkeeping program renders and sends it
**[DEC-89]** — so the monthly run no longer enqueues one mail per customer at 02:00 on the 5th, and
the `notification-bulk` escape hatch is dropped from the plan rather than kept in reserve. And
**[DEC-111]** reverses **[DEC-63]**: an offer notification goes to the account that raised the
request, plus the second admin when the company has four-eyes on **[DEC-71]** — one or two
recipients, not the whole company.

The priority drain **stays**, and its justification inverts: the fan-out per offer shrinks, but the
cost of losing a single message rises. Under **[DEC-63]** any of five accounts could still have
accepted a delayed offer; under **[DEC-111]** there may be exactly one person who can, so a
notification delayed past `expires_at` kills the offer outright. The queue still mixes a 30-minute
offer clock with wallet alerts and "funds received" mail **[DEC-106]**, which is reason enough to
order it — and the retry ladder in §6 matters more than it did, not less.

## 2. Recurring jobs

| Job | Schedule (Europe/Amsterdam) | Queue | Purpose |
| --- | --- | --- | --- |
| `ExpireOffersJob` | every minute | `critical` | Moves **`OFFERED` *and* `AWAITING_APPROVAL`** past `expires_at` to `EXPIRED`, **releasing the reservation in the same transaction** where one is held, and notifies ~~**[DEC-33]**~~ **[DEC-71]**, **[F05-R31]**, **[F05-R62]**. ⚠ **Amended 2026-08-19 by [DEC-71]**: `AWAITING_APPROVAL` now arises from the company's four-eyes **mode**, not from a value threshold, so it applies to **every** trade of a four-eyes company. The job's load tracks that flag rather than trade size, and the reservations it releases are no longer only the large ones |
| ~~`EvaluateWalletThresholdsJob`~~ | ~~daily 08:00~~ | ~~`critical`~~ | ~~Rule evaluation and alerts **[F11](../10-features/F11-notifications.md)**~~ ⚠ **Removed 2026-08-19 by [DEC-90]**, reversing **[DEC-49]**. There is nothing to evaluate: no warning amount, no critical amount. The balance is **visible, not monitored**, and the pre-trade check **[DEC-41]** is the only thing that reads it for a decision. Cost of the removal, recorded: a customer whose balance is too low finds out when a trade is refused, not the evening before |
| `ReconcileWalletBalancesJob` | daily 03:00 | `critical` | Recomputes balances from entries; alerts on mismatch **[F06-R09]**. **Unchanged** — the wallet survives **[DEC-77]** as the trading purse, so its ledger still has to agree with itself. It has one entry type fewer to reconcile: `INVOICE_DEBIT` is gone **[DEC-77]** |
| `PollMontelIndicationsJob` | every 5 min (market hours), hourly otherwise | `integration` | Price indications, through the **existing Montel service [DEC-96]**, **[F08-R18]**. The **[DEC-80]** markup — a configurable percentage, default 2% — is applied at the presentation edge, never stored by this job **[F08-R17]** |
| `FetchDayAheadPricesJob` | daily **18:05** | `integration` | Day-ahead curve for D+1. **One scheduled fetch plus retry [DEC-36]** — the NL curve arrives at 18:00 Europe/Amsterdam. Retried on failure *or* on an incomplete curve **[F08-R06]**. **Confirmed 2026-08-19**: this round does not touch it. **[DEC-75]** adds *history behind* it, not a second live fetch — §2.1 |
| `CheckDayAheadCompletenessJob` | daily **22:00** | `integration` | Verifies coverage for the next day; alerts on gaps **[F08-R07]**. It covers **tomorrow's** curve only. Historical gaps belong to the backfill **[F08-R15]** and must not raise this alert, or every un-backfilled day in the licence window pages the desk every night |
| `DetectMissingMeteringDataJob` | daily 10:00 | `default` | Metering points silent beyond the threshold **[F02-R26]**. **BRP-agnostic [DEC-69]**: silence is measured per metering point against the expected cadence of the BRP it is assigned to, so a future BRP that batches changes the expectation, not the job |
| `FinaliseDeliveryDatesJob` | daily 04:00 | `default` | Marks dates `FINAL` after 10 working days **[F02-R23]**. ⚠ **Amended 2026-08-19 by [DEC-98]**: `FINAL` now means *no newer version **yet***, not *no newer version **ever***. Reconciliation data does arrive after the window, sometimes as a manual process **[DEC-60]**. The job no longer closes anything — it marks a date good enough to invoice — and a later version reopens it through the correction path **[DEC-99]** |
| `RebuildDailyPositionsJob` | daily 04:30 | `default` | Safety net for rollups missed by event-driven rebuilds |
| `EscalateUnconfirmedTradesJob` | every 15 min | `critical` | Alerts on `ACCEPTED` trades older than the threshold **[F05-R39]** |
| ~~`RetryOdooPushJob`~~ **`RetryBookkeepingPushJob`** | every 10 min | `integration` | ⚠ **Renamed and re-scoped 2026-08-19 by [DEC-88]**. ~~Retries invoices in `PUSH_FAILED`~~ — retries **draft invoices** and **energiebelasting ledger entries [DEC-74]** left in `PUSH_FAILED` after the inline ladder is exhausted. The stake changed with the name: a push that never lands means the customer has **no numbered invoice at all**, where before it meant the platform's own number had not yet reached the accounting system — §6 |
| `ReconcilePaymentsJob` | every 15 min | `integration` | Resolves payments stuck `INITIATED`/`PENDING` **[F07-R10]**. ⚠ **Narrowed 2026-08-19 by [DEC-105]**: **wallet top-ups only**. Invoice payments are matched in the bookkeeping program, which sees them on its own bank feed **[DEC-109]**, and never reach this job |
| **`MatchIncomingPaymentsJob`** | **every 15 min** | `integration` | **New 2026-08-19 — [DEC-106].** Reads the incoming-credit feed, matches each credit to an open deposit intent on the **platform-issued payment reference**, falls back to the company IBAN **[DEC-61]** when the reference is missing or mangled, credits the wallet and enqueues the "funds received" mail. An unmatched credit goes to an employee review list, never to a best-guess wallet: crediting the wrong wallet is unwindable only by hand, and **[DEC-84]** removes the amount bounds that would otherwise make a wrong match implausible. ⚠ **Which** feed it reads is **[OQ-93]** — the job is specified against a *normalised* credit (amount, value date, counterparty IBAN, description) so the feed stays an adapter choice |
| `DispatchNotificationsJob` | every minute | `notification` | Drains the outbox in priority order via SendGrid **[DEC-48]** — offer, approval and expiry notifications ~~ahead of invoices **[DEC-47]**~~ ⚠ **Amended 2026-08-19 by [DEC-89]**: there are no invoice mails in the outbox at all. The queue now mixes the offer clock with wallet alerts and deposit-received mail **[DEC-106]** — §1 |
| `MonthlyInvoiceRunJob` | 5th of the month, 02:00 | `reporting` | Monthly invoicing **[F10-R02]**. ⚠ **Amended 2026-08-19 by [DEC-99]**: it is a **batch, not a gate** — it no longer closes a month against later correction. See §2.2 |
| ~~`AnnualTrueUpJob`~~ | ~~20 January, 02:00~~ | ~~`reporting`~~ | ~~Previous-year true-up. ⚠ **Deferred with energiebelasting — [DEC-24]**. Tier crossings were its principal reason to exist; only the residual late-metering-correction role remains, and that has no live settlement path meanwhile~~ ⚠ **Split 2026-08-19**, not simply revived. Its two roles separate cleanly: tier crossings come back annually as **`AnnualEnergyTaxCloseJob`** **[DEC-74]**, and the late-metering-correction role becomes **continuous** as `CalculateCorrectionInvoiceJob` **[DEC-99]**, §3. The name retires because nothing is left that is both annual and a true-up; **[F10-R27..R33]** keep their IDs |
| **`AnnualEnergyTaxCloseJob`** | **20 January, 02:00** | `reporting` | **New 2026-08-19 — [DEC-74]**, reversing **[DEC-24]**. Computes energiebelasting **per EAN per calendar year** on net usage **[DEC-22]** against the versioned bracket table for that year, applies the **per-customer reduction or exemption** where one is configured — the minority who do not pay the standard rate, of whom growers are the named example — and pushes the result as a **ledger entry** to the bookkeeping program **[DEC-88]**. Where an EAN changed customer mid-year each period gets **50% of each bracket** — a straight half-and-half split of the annual tier boundaries, not a pro-rata by days **[DEC-74]**, closing **[OQ-77]**. Gated per customer on the year's dates being `FINAL` **[F10-R28]**; a customer failing the gate is **skipped with a reason**, never estimated. ⚠ Under **[DEC-98]** `FINAL` is not permanent, so this job is **re-runnable per (EAN, year)** and a later correction produces a **delta** ledger entry rather than a rewritten one. Whether the *vermindering* itself applies is **[OQ-96]** |
| `CreatePartitionsJob` | 1st of the month, 01:00 | `default` | Creates interval partitions three months ahead |
| `ExtendCalendarIntervalsJob` | 1 December, 01:00 | `default` | Materialises the next year's interval spine and peak membership |
| `PurgeExpiredIdempotencyKeysJob` | daily 05:00 | `default` | Housekeeping |
| `ArchiveOldMessagesJob` | weekly, Sunday 02:00 | `default` | Moves raw payloads to cold storage |

### 2.1 Day-ahead timing — [DEC-36], and the backfill behind it — [DEC-75]

The four-attempt 13:00 / 14:00 / 15:00 / 18:00 schedule existed because the publication time was
unknown; three of those four attempts were guesses that could only fail. **[DEC-36]** removes the
guessing: the NL curve arrives at **18:00 Europe/Amsterdam**, so there is one fetch and a retry
ladder behind it. **This round leaves that untouched.**

**18:05, not 18:00.** A fetch scheduled at the publication instant races the publication. Five
minutes costs nothing and removes a first attempt that is expected to fail — and an expected failure
in a business-critical job is how a real failure stops being noticed.

**Retry, and what counts as failure.** An incomplete curve is a failure, not a success: the job
verifies 92 / 96 / 100 intervals for the delivery date before it reports done **[F08-R06]**. Six
retries — 30 s, 2 m, 10 m, 30 m, 1 h, 2 h — put the last attempt at about **21:48**. The generic
`integration` ladder's 6-hour tail (§6) is wrong here in both directions: too slow to be useful and
too long to finish before the day it prices begins.

**Why the completeness check moves from 20:00 to 22:00.** It is the safety net for the fetch never
having run at all — job design rule 7 — so it has to sit **after the retry ladder is exhausted** and
**before the delivery day starts**. At 20:00 it would now fire while the fetch is still legitimately
retrying, and a recurring false alarm is an alert people learn to ignore. 22:00 is twelve minutes
after the last attempt and two hours before midnight, which is the window in which an employee can
still use the manual-entry route **[F08-R10]** before the day it prices begins. Anything later eats
that window; anything earlier alerts on a job that is still working.

**`BackfillDayAheadPricesJob` is a separate job, not a widened fetch — [DEC-75].** **[DEC-36]**
settled *when* the curve arrives; **[DEC-75]** settles that Montel's **history** is available, so
there is no backfill cliff and positions can be settled retrospectively. The two must not be the same
job, for three reasons that are each sufficient:

| Property | `FetchDayAheadPricesJob` | `BackfillDayAheadPricesJob` |
| --- | --- | --- |
| Trigger | Recurring, 18:05 daily **[DEC-36]** | **On demand for a requested date range** **[F08-R15]**, and automatically when a correction needs a day the platform never stored **[DEC-99]** |
| Queue | `integration` | `reporting` — it is bounded work measured in days, not one call |
| Retry ladder | 6 attempts ending ~21:48, because the day it prices starts at midnight (§6) | The generic `integration` ladder. Nothing downstream starts at midnight; a backfill that finishes tomorrow is still useful |
| Failure meaning | Tomorrow cannot be settled | A **past** month cannot be re-settled — visible, not urgent |

Everything else is shared on purpose: same storage, same versioning **[F08-R04]**, same completeness
check **[F08-R06]** **[F08-R15]**. A second code path for old days would be a second place for the
completeness rule to drift.

**The backfill is chunked one delivery day per unit of work, and takes the same mutex as the daily
fetch** (§7). Without the mutex a backfill range that happens to include *yesterday* races the 18:05
job for the same delivery day and both write a version; with it, one waits. Re-running a backfill is
safe because a re-fetched day creates a new version **only when the price differs** **[F08-R04]** —
version churn of identical rows would make the correction trail **[DEC-99]** unreadable.

**`EscalateUnconfirmedTradesJob` covers `ACCEPTED` only — deliberately.** A trade in
`AWAITING_APPROVAL` is not waiting on PeakPower and never reaches the "to confirm" queue
**[F05-R66]**; it is waiting on the customer's second admin account, under its own clock, and
`ExpireOffersJob` ends it. Adding `AWAITING_APPROVAL` here would page the desk about a trade it is
not permitted to act on. ⚠ **[DEC-71]** makes this louder rather than quieter: four-eyes is now a
company **mode**, so a four-eyes company puts *every* trade through `AWAITING_APPROVAL` and the
volume of rows this job must keep ignoring rises with it.

### 2.2 What this round takes off the schedule

The 2026-08-19 round moves invoicing mechanics — numbering, PDF rendering, the email, VAT, surcharges,
invoice payment matching and chargebacks — out of the platform and into the **bookkeeping program**.
Several jobs go with them. Some were in this catalogue; some were only ever implied by a feature
specification and are named here anyway, so that the removal is checkable rather than assumed.

| Job | Status | Driving decision and reason |
| --- | --- | --- |
| `EvaluateWalletThresholdsJob` | **Removed from §2** | **[DEC-90]**, reversing **[DEC-49]**. No thresholds exist to evaluate |
| `EvaluateWalletThresholdJob` (event-triggered twin) | **Removed from §3** | **[DEC-90]**. Same reason; a balance change now triggers nothing |
| `SettleInvoiceOnWalletJob` | **Removed from §3** | **[DEC-77]**, reversing **[AS-12]**. Delivery invoices are paid to the bank, never deducted from the wallet. The `INVOICE_DEBIT` entry type goes with the job |
| `EmailInvoiceJob` | **Removed from §3** | **[DEC-89]**. The bookkeeping program sends the invoice mail |
| Invoice PDF render | **Never built** | **[DEC-89]**, reversing **[DEC-46]**. It had no job row yet; it now never gets one. Branding of the document leaves platform control with it |
| Any surcharge/topup resolution or rating job | **Never built** | **[DEC-73]**, reversing **[DEC-35]**. The platform pushes **volume**; the bookkeeping program multiplies it by the topup fee. There is no surcharge tariff to resolve, so there is nothing to schedule |
| Any feed-in tariff resolution job | **Never built** | **[DEC-87]**, reversing the second half of **[DEC-44]**. Export is credited raw at the day-ahead price, so `MISSING_FEED_IN_TARIFF` and the month-skip it caused are gone |
| Any invoice payment-matching or chargeback job | **Never built** | **[DEC-105]**, **[DEC-85]**, **[DEC-109]**. Invoice payments and chargebacks are matched in the bookkeeping program from its bank feed. `MatchIncomingPaymentsJob` is **not** this job: it matches **wallet deposits only** **[DEC-106]** |
| `AnnualTrueUpJob` | **Split** | **[DEC-74]** takes the annual half, **[DEC-99]** makes the correction half continuous |

Net effect on the schedule: **two jobs removed, three added** (`MatchIncomingPaymentsJob`,
`AnnualEnergyTaxCloseJob`, and `BackfillDayAheadPricesJob` on demand), one renamed, and one split. The
work does not disappear — it moves across an integration boundary, which is why §6 gains a retry class
and **[OQ-69]** gets heavier.

### 2.3 The monthly run stops being a gate — [DEC-99], [DEC-98]

Before this round the 5th-of-the-month run was the moment a month became billable **and** the moment
it closed. A correction arriving afterwards flagged the invoice **[F02-R20]**, **[F10-R22]** and
waited for a January true-up that was itself deferred **[DEC-24]** — so in practice it waited for
nothing. Two decisions dismantle that:

- **[DEC-98]** removes the premise. PVNed *does* supply reconciliation data after the 10-working-day
  window, sometimes as a manual process. Any job that treated the window as final was building on a
  fact that turned out to be wrong — `FinaliseDeliveryDatesJob` is amended in §2 accordingly.
- **[DEC-99]** removes the gate. A correction is invoiced as a **delta, whenever it lands**, months
  after the month if that is when it arrives.

Four consequences for job design, none of them optional:

1. **The monthly run must be re-enterable, not merely retryable.** Idempotency per (customer, month)
   was already rule 1 in §5; it is now load-bearing rather than hygienic, because the same month can
   legitimately be calculated again a year later.
2. **The correction path is event-driven, not scheduled** (§3). A monthly sweep would add up to 30
   days of latency to a delta that is already late by construction. There is no `MonthlyCorrectionRun`.
3. **No materiality threshold [DEC-100].** Nothing is netted, batched or waived below a floor; the
   €25 default is removed rather than configured. ⚠ Cost, recorded because it is real: a €0,40
   correction produces its own draft, and every draft costs a human check in the bookkeeping program
   **[DEC-88]**. The number of correction drafts is bounded only by how often corrections arrive, and
   nothing in the platform limits that. If it becomes a problem the answer is a decision to batch,
   not a quiet threshold in a job.
4. **The run date stops being interesting.** The 5th **[F10-R02]** was chosen against the
   10-working-day window, which is what **[OQ-56]** was asking about. Under **[DEC-99]** the date only
   decides how much of a month is provisional on first issue — never whether the month can be
   corrected later. **[OQ-56]** closes on that basis, and the 5th stays.

## 3. Event-triggered jobs

| Trigger | Job | Queue |
| --- | --- | --- |
| PVNed webhook stored | `ProcessTimeSeriesDocumentJob` | `ingestion` |
| Interval version superseded | `RebuildDailyPositionJob` | `default` |
| Interval version affects an invoiced period | `FlagInvoiceForCorrectionJob` | `default` |
| Trade entered `AWAITING_APPROVAL` **[DEC-33]** | `NotifyAwaitingApprovalJob` — **every active account except the acceptor [F05-R65]** | `notification` |
| Trade approved or approval refused | `NotifyApprovalOutcomeJob` | `notification` |
| Trade confirmed | `CreateBlockJob` + `InvalidatePositionCacheJob` | `critical` / `default` |
| Invoice finalised | `PushInvoiceToOdooJob` + `SettleInvoiceOnWalletJob` + `EmailInvoiceJob` **[DEC-47]** | `integration` / `critical` / `notification` |
| Wallet balance changed | `EvaluateWalletThresholdJob` | `critical` |
| Notification created | dispatch via the outbox | `notification` |
| Payment webhook received | `ProcessPaymentWebhookJob` | `critical` |

## 4. Scheduled-once jobs

| Trigger | Job | When |
| --- | --- | --- |
| Offer published | `ExpireSingleOfferJob` | At `expires_at` |
| Offer published | `NotifyOfferExpiringSoonJob` | At `expires_at − 5 min` |

Scheduling a job for the exact expiry moment gives second-level accuracy; the per-minute
`ExpireOffersJob` is the safety net if the scheduled job is lost. **Both** exist, and the accept
endpoint guards independently — three layers, because an offer that stays acceptable past its
deadline is a financial liability.

### 4.1 Both scheduled jobs now cover `AWAITING_APPROVAL` — [DEC-33]

Neither job is rescheduled at acceptance, and neither needs to be: **acceptance does not move
`expires_at`**. There is no separate approval window — the reaction window is the whole period in
which the customer may bind PeakPower, and the acceptance and the approval must both fall inside it
**[F05-R61]**, **[DEC-13]**. The job scheduled when the offer was published is still the right job at
the right instant; what changed is what it finds when it runs.

| Job | Behaviour, resolved at run time |
| --- | --- |
| `ExpireSingleOfferJob` | `OFFERED` → `EXPIRED`, nothing to release. **`AWAITING_APPROVAL` → `EXPIRED`, and the reservation is released in full in the same transaction [F05-R62], [T12].** Any other state: no-op |
| `NotifyOfferExpiringSoonJob` | `OFFERED` → remind **every active account [DEC-63]**: anyone may still accept. **`AWAITING_APPROVAL` → remind every active account except the acceptor [F05-R65]**: they are the only ones who can act, and the message is "approve or this expires", not "respond to an offer" |

⚠ **This is the load-bearing half of [DEC-33] and it is easy to miss.** An `AWAITING_APPROVAL` trade
holds an **active reservation for the full trade value**, taken at acceptance and never re-created by
approval **[T11]**, **[F05-R55]**. Expiry is the only thing that gives that money back when nobody
approves in time. A job — or a partial index — that still filters on `OFFERED` alone leaves the trade
in `AWAITING_APPROVAL` for ever with the customer's balance locked behind it, and **raises no error
of any kind**: the reservation is valid, the trade row is valid, the ledger reconciles. See
[Database design §3.4.1](04-database-design.md) for the matching index change, without which the job
cannot see the rows even when its filter is right.

## 5. Job design rules

1. **Idempotent.** Every job may run twice. Keyed on a natural identifier, with a state check first.
2. **Resumable.** Long jobs (invoice runs, bulk ingestion) checkpoint progress and continue rather
   than restart.
3. **Bounded.** Batch sizes are configured, never "process everything found".
4. **Observable.** Every job emits start, end, duration, item counts and outcome, with the
   correlation id of whatever triggered it.
5. **Failure is explicit.** An exhausted job lands in the dead-letter view with its full context and
   a replay action **[F15-R22]**.
6. **No job holds a transaction open across an external call.** Ever.
7. **Business-critical jobs alert on non-execution**, not only on failure — a job that silently stops
   being scheduled is worse than one that throws.

## 6. Retry policy

| Job class | Attempts | Backoff | On exhaustion |
| --- | --- | --- | --- |
| Ingestion | 5 | 1 m, 5 m, 15 m, 1 h, 4 h | Dead letter + alert |
| Integration (outbound) | 8 | exponential, 30 s → 6 h | Dead letter + alert |
| **Day-ahead fetch [DEC-36]** | 6 | 30 s, 2 m, 10 m, 30 m, 1 h, 2 h | Alert; manual entry route **[F08-R10]**. Last attempt ~21:48 — §2.1 |
| Notification | 5 | 1 m, 5 m, 30 m, 2 h, 8 h | Dead letter + alert |
| Critical (wallet, expiry) | 3 | 10 s, 30 s, 2 m | **Immediate page** |
| Reporting | 2 | 5 m | Alert; manual re-run |

**A SendGrid 4xx is not a retry [DEC-48].** An invalid address, a suppression-list hit or a rejected
sender is permanent: it dead-letters on the first response and surfaces the address, rather than
consuming five attempts over eight hours to produce the same answer. `429` and `5xx` are the retried
cases. Bounces and spam complaints arrive asynchronously on SendGrid's event webhook and mark the
address, so the next offer notification does not silently vanish into the same hole — which matters
more under **[DEC-63]**, where every active account is notified, and **[DEC-47]**, where the invoice
uses the same channel.

## 7. Concurrency control

```csharp
[DisableConcurrentExecution(timeoutSeconds: 3600)]
public sealed class MonthlyInvoiceRunJob { … }

// per-entity serialisation for supersession
[Mutex("interval-data:{0}:{1}")]
public sealed class ProcessTimeSeriesDocumentJob
{
    public Task Run(Guid meteringPointId, DateOnly deliveryDate) { … }
}
```

Two documents for the same metering point and date must not process concurrently, or supersession
races and both could end up `is_current`. The unique partial index in
[Database design](04-database-design.md) §3.2 would catch it, but catching it as a constraint
violation is worse than not racing.

**[DEC-38] makes this mutex the natural unit of concurrency.** PVNed sends one document per EAN per
day, so a document *is* a mutex key: 500 metering points are 500 independent keys, the `ingestion`
queue's 8 workers are the only limit on parallelism, and two workers contend only when one document
corrects another — the one case the mutex exists for. Under a daily batch the whole day's data would
have been a single unit of work and this lock would have serialised the entire ingestion path. See
[Database design §2.1](04-database-design.md) for the volume figures.

## 8. Scaling

The worker scales horizontally on queue depth. Hangfire's storage-level locking means adding
instances is safe with no coordination beyond the database.

| Signal | Action |
| --- | --- |
| `ingestion` depth > 500 for 5 min | Scale out |
| `critical` depth > 20 for 1 min | Scale out and alert |
| Any queue depth growing monotonically for 30 min | Alert — a poison message or a stuck dependency |

⚠ **The `ingestion` threshold is now a daily event, not an exception.** Under **[DEC-38]** a
500-metering-point portfolio pushes 500 documents in one window, so the queue crosses 500 every day
at PVNed's push time. Scaling out for the burst is the correct response — but the threshold must be
expressed against the metering-point count rather than left at a constant, or it stops distinguishing
"the daily push arrived" from "ingestion is stuck".

## 9. Timing map over a month

```mermaid
gantt
    title Recurring workload, one month
    dateFormat YYYY-MM-DD
    axisFormat %d

    section Daily
    Reconcile wallets 03:00        :done, d1, 2026-08-01, 31d
    Finalise delivery dates 04:00  :done, d2, 2026-08-01, 31d
    Rebuild rollups 04:30          :done, d3, 2026-08-01, 31d
    Threshold alerts 08:00         :done, d4, 2026-08-01, 31d
    Missing-data check 10:00       :done, d5, 2026-08-01, 31d
    Day-ahead fetch 18:05          :done, d6, 2026-08-01, 31d
    Day-ahead completeness 22:00   :done, d7, 2026-08-01, 31d

    section Monthly
    Create partitions              :milestone, m1, 2026-08-01, 0d
    Monthly invoice run            :crit, m2, 2026-08-05, 1d
    Archive old messages           :m3, 2026-08-02, 1d
```

## 10. Open questions

| Ref | Question |
| --- | --- |
| [OQ-16] | Montel's delivery resolution, and whether history is available for backfill. **[DEC-36]** answers the arrival time only — a backfill would need a job of its own, and its depth limits how far back positions can settle |
| [OQ-56] | Is the 5th of the month the right invoice-run date, given PVNed's 10-working-day correction window? |
| [OQ-57] | Should the Hangfire dashboard be exposed at all in production, or should job control be surfaced through the employee portal only? |
