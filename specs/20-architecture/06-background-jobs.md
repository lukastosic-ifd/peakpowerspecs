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
| `notification` | Email dispatch | 4 | Isolated so a mail-provider outage stalls nothing else |
| `reporting` | Invoice runs, exports | 2 | Long-running; must not starve the rest |

A single shared queue would mean a 40-minute invoice run delaying an offer expiry by 40 minutes.
Separating them is the whole point.

## 2. Recurring jobs

| Job | Schedule (Europe/Amsterdam) | Queue | Purpose |
| --- | --- | --- | --- |
| `ExpireOffersJob` | every minute | `critical` | Moves `OFFERED` past `expires_at` to `EXPIRED` and notifies |
| `EvaluateWalletThresholdsJob` | daily 08:00 | `critical` | Rule evaluation and alerts **[F11](../10-features/F11-notifications.md)** |
| `ReconcileWalletBalancesJob` | daily 03:00 | `critical` | Recomputes balances from entries; alerts on mismatch **[F06-R09]** |
| `PollMontelIndicationsJob` | every 5 min (market hours), hourly otherwise | `integration` | Price indications |
| `FetchDayAheadPricesJob` | 13:00, 14:00, 15:00, 18:00 | `integration` | Day-ahead curve for D+1, retried until complete |
| `CheckDayAheadCompletenessJob` | daily 20:00 | `integration` | Verifies coverage for the next day; alerts on gaps |
| `DetectMissingMeteringDataJob` | daily 10:00 | `default` | Metering points silent beyond the threshold **[F02-R26]** |
| `FinaliseDeliveryDatesJob` | daily 04:00 | `default` | Marks dates `FINAL` after 10 working days **[F02-R23]** |
| `RebuildDailyPositionsJob` | daily 04:30 | `default` | Safety net for rollups missed by event-driven rebuilds |
| `EscalateUnconfirmedTradesJob` | every 15 min | `critical` | Alerts on `ACCEPTED` trades older than the threshold **[F05-R39]** |
| `RetryOdooPushJob` | every 10 min | `integration` | Retries invoices in `PUSH_FAILED` |
| `ReconcilePaymentsJob` | every 15 min | `integration` | Resolves payments stuck `INITIATED`/`PENDING` **[F07-R10]** |
| `DispatchNotificationsJob` | every minute | `notification` | Drains the outbox |
| `MonthlyInvoiceRunJob` | 5th of the month, 02:00 | `reporting` | Monthly invoicing **[F10-R02]** |
| `AnnualTrueUpJob` | 20 January, 02:00 | `reporting` | Previous-year true-up |
| `CreatePartitionsJob` | 1st of the month, 01:00 | `default` | Creates interval partitions three months ahead |
| `ExtendCalendarIntervalsJob` | 1 December, 01:00 | `default` | Materialises the next year's interval spine and peak membership |
| `PurgeExpiredIdempotencyKeysJob` | daily 05:00 | `default` | Housekeeping |
| `ArchiveOldMessagesJob` | weekly, Sunday 02:00 | `default` | Moves raw payloads to cold storage |

## 3. Event-triggered jobs

| Trigger | Job | Queue |
| --- | --- | --- |
| PVNed webhook stored | `ProcessTimeSeriesDocumentJob` | `ingestion` |
| Interval version superseded | `RebuildDailyPositionJob` | `default` |
| Interval version affects an invoiced period | `FlagInvoiceForCorrectionJob` | `default` |
| Trade confirmed | `CreateBlockJob` + `InvalidatePositionCacheJob` | `critical` / `default` |
| Invoice finalised | `PushInvoiceToOdooJob` + `SettleInvoiceOnWalletJob` | `integration` / `critical` |
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
| Notification | 5 | 1 m, 5 m, 30 m, 2 h, 8 h | Dead letter + alert |
| Critical (wallet, expiry) | 3 | 10 s, 30 s, 2 m | **Immediate page** |
| Reporting | 2 | 5 m | Alert; manual re-run |

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

## 8. Scaling

The worker scales horizontally on queue depth. Hangfire's storage-level locking means adding
instances is safe with no coordination beyond the database.

| Signal | Action |
| --- | --- |
| `ingestion` depth > 500 for 5 min | Scale out |
| `critical` depth > 20 for 1 min | Scale out and alert |
| Any queue depth growing monotonically for 30 min | Alert — a poison message or a stuck dependency |

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
    Day-ahead fetch 13:00–18:00    :done, d6, 2026-08-01, 31d

    section Monthly
    Create partitions              :milestone, m1, 2026-08-01, 0d
    Monthly invoice run            :crit, m2, 2026-08-05, 1d
    Archive old messages           :m3, 2026-08-02, 1d
```

## 10. Open questions

| Ref | Question |
| --- | --- |
| [OQ-56] | Is the 5th of the month the right invoice-run date, given PVNed's 10-working-day correction window? |
| [OQ-57] | Should the Hangfire dashboard be exposed at all in production, or should job control be surfaced through the employee portal only? |
