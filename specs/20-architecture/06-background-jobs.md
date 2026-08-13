# Background Jobs

Hangfire on PostgreSQL storage **[DEC-10]**, hosted in the worker. Three kinds of work: **queued**
(triggered by an event, run once), **recurring** (cron), and **scheduled** (run at a specific future
time).

---

## 1. Queues

| Queue | Purpose | Workers | Why separate |
| --- | --- | --- | --- |
| `critical` | Offer expiry, wallet operations | 4 | Must never wait behind a bulk job |
| `ingestion` | PVNed document processing | 8 | Bursty; the bulk of the throughput |
| `default` | Rollups, cache invalidation | 4 | |
| `integration` | Odoo push, Montel polls, payment reconciliation | 4 | Slow, external, retry-heavy |
| `notification` | Email dispatch via **SendGrid [DEC-48]** — offer and approval notifications, **and invoices [DEC-47]** | 4 | Isolated so a mail-provider outage stalls nothing else |
| `reporting` | Invoice runs, exports | 2 | Long-running; must not starve the rest |

A single shared queue would mean a 40-minute invoice run delaying an offer expiry by 40 minutes.
Separating them is the whole point.

⚠ **[DEC-47] puts two very different urgencies on one queue.** The monthly run enqueues one invoice
email per customer at 02:00 on the 5th; an offer notification has a 30-minute window to be useful and
**[DEC-63]** sends one to every active account. The outbox is therefore drained in priority order —
offer, approval and expiry notifications ahead of invoices — rather than in insertion order. If
invoice volume ever makes that insufficient, the answer is a second `notification-bulk` queue, not a
larger worker count on this one.

## 2. Recurring jobs

| Job | Schedule (Europe/Amsterdam) | Queue | Purpose |
| --- | --- | --- | --- |
| `ExpireOffersJob` | every minute | `critical` | Moves **`OFFERED` *and* `AWAITING_APPROVAL`** past `expires_at` to `EXPIRED`, **releasing the reservation in the same transaction** where one is held, and notifies **[DEC-33]**, **[F05-R31]**, **[F05-R62]** |
| `EvaluateWalletThresholdsJob` | daily 08:00 | `critical` | Rule evaluation and alerts **[F11](../10-features/F11-notifications.md)** |
| `ReconcileWalletBalancesJob` | daily 03:00 | `critical` | Recomputes balances from entries; alerts on mismatch **[F06-R09]** |
| `PollMontelIndicationsJob` | every 5 min (market hours), hourly otherwise | `integration` | Price indications |
| `FetchDayAheadPricesJob` | daily **18:05** | `integration` | Day-ahead curve for D+1. **One scheduled fetch plus retry [DEC-36]** — the NL curve arrives at 18:00 Europe/Amsterdam. Retried on failure *or* on an incomplete curve **[F08-R06]** |
| `CheckDayAheadCompletenessJob` | daily **22:00** | `integration` | Verifies coverage for the next day; alerts on gaps **[F08-R07]** |
| `DetectMissingMeteringDataJob` | daily 10:00 | `default` | Metering points silent beyond the threshold **[F02-R26]** |
| `FinaliseDeliveryDatesJob` | daily 04:00 | `default` | Marks dates `FINAL` after 10 working days **[F02-R23]** |
| `RebuildDailyPositionsJob` | daily 04:30 | `default` | Safety net for rollups missed by event-driven rebuilds |
| `EscalateUnconfirmedTradesJob` | every 15 min | `critical` | Alerts on `ACCEPTED` trades older than the threshold **[F05-R39]** |
| `RetryOdooPushJob` | every 10 min | `integration` | Retries invoices in `PUSH_FAILED` |
| `ReconcilePaymentsJob` | every 15 min | `integration` | Resolves payments stuck `INITIATED`/`PENDING` **[F07-R10]** |
| `DispatchNotificationsJob` | every minute | `notification` | Drains the outbox in priority order via SendGrid **[DEC-48]** — offer, approval and expiry notifications ahead of invoices **[DEC-47]** |
| `MonthlyInvoiceRunJob` | 5th of the month, 02:00 | `reporting` | Monthly invoicing **[F10-R02]** |
| `AnnualTrueUpJob` | 20 January, 02:00 | `reporting` | Previous-year true-up. ⚠ **Deferred with energiebelasting — [DEC-24]**. Tier crossings were its principal reason to exist; only the residual late-metering-correction role remains, and that has no live settlement path meanwhile |
| `CreatePartitionsJob` | 1st of the month, 01:00 | `default` | Creates interval partitions three months ahead |
| `ExtendCalendarIntervalsJob` | 1 December, 01:00 | `default` | Materialises the next year's interval spine and peak membership |
| `PurgeExpiredIdempotencyKeysJob` | daily 05:00 | `default` | Housekeeping |
| `ArchiveOldMessagesJob` | weekly, Sunday 02:00 | `default` | Moves raw payloads to cold storage |

### 2.1 Day-ahead timing — [DEC-36]

The four-attempt 13:00 / 14:00 / 15:00 / 18:00 schedule existed because the publication time was
unknown; three of those four attempts were guesses that could only fail. **[DEC-36]** removes the
guessing: the NL curve arrives at **18:00 Europe/Amsterdam**, so there is one fetch and a retry
ladder behind it.

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

**`EscalateUnconfirmedTradesJob` covers `ACCEPTED` only — deliberately.** A trade in
`AWAITING_APPROVAL` is not waiting on PeakPower and never reaches the "to confirm" queue
**[F05-R66]**; it is waiting on the customer's second account, under its own clock, and
`ExpireOffersJob` ends it. Adding `AWAITING_APPROVAL` here would page the desk about a trade it is
not permitted to act on.

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
