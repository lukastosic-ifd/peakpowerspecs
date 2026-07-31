# Non-Functional Requirements

Each requirement is numbered, measurable and testable. "Fast" and "reliable" are not requirements.

---

## 1. Performance

| ID | Requirement | Target | How verified |
| --- | --- | --- | --- |
| **NFR-01** | Customer API read endpoints respond within | p95 **400 ms**, p99 800 ms | Load test, production SLO |
| **NFR-02** | Customer API write endpoints respond within | p95 **800 ms**, p99 2 s | Load test |
| **NFR-03** | Consumption day view interactive within | **1.5 s** warm, 3 s cold | Synthetic + RUM |
| **NFR-04** | Consumption month view interactive within | **2 s** | Synthetic |
| **NFR-05** | Trade offer appears on the customer's screen after publication within | **3 s** (SignalR), 30 s worst case (email) | Integration test |
| **NFR-06** | PVNed webhook acknowledges within | p95 **1 s**, p99 2 s | Load test |
| **NFR-07** | A PVNed document is fully processed within | **5 min** of receipt at normal load | Metric with alert |
| **NFR-08** | Monthly invoice run completes for 100 customers within | **30 min** | Timed run |
| **NFR-09** | Employee trade desk updates within | **2 s** of a state change | Integration test |

## 2. Scalability

| ID | Requirement | Year 1 | Year 3 design point |
| --- | --- | --- | --- |
| **NFR-10** | Customers | 50 | **500** |
| **NFR-11** | Metering points | 250 | **2 500** |
| **NFR-12** | Interval rows/year | ~17 M | **~175 M** |
| **NFR-13** | Concurrent customer users | 25 | **200** |
| **NFR-14** | Concurrent employees | 5 | **25** |
| **NFR-15** | Trades per month | 100 | **1 500** |
| **NFR-16** | Inbound PVNed documents per day | 500 | **5 000** |

At the year-3 point, **[DEC-09]** (PostgreSQL only) should be re-evaluated. 175 M rows a year in
monthly partitions is still workable, but that is the frontier, not the comfort zone. The trigger to
revisit is a p95 above target on the month view, not a row count.

Everything except the database scales horizontally. The database scales vertically first, then to a
read replica for reporting **[OQ-54]**.

## 3. Availability

| ID | Requirement | Target |
| --- | --- | --- |
| **NFR-17** | Customer portal and API availability, business hours (07:00–19:00 CET, Mon–Fri) | **99.9%** |
| **NFR-18** | Customer portal and API availability, outside business hours | 99.5% |
| **NFR-19** | Employee portal availability, business hours | **99.9%** |
| **NFR-20** | PVNed webhook availability | **99.95%** — a rejected push may not be retried indefinitely |
| **NFR-21** | Planned maintenance | Outside 07:00–19:00 CET on weekdays, announced 5 working days ahead |
| **NFR-22** | Degraded operation: if Montel is unavailable, everything except price indications keeps working | Verified by chaos test |
| **NFR-23** | Degraded operation: if the payment provider is unavailable, bank transfer remains available | Verified |

The webhook has the highest availability target in the system. It is the one endpoint where an
outage causes permanent data loss rather than a delay, because the platform cannot ask PVNed to
resend at will.

## 4. Reliability & data integrity

| ID | Requirement |
| --- | --- |
| **NFR-24** | No accepted PVNed message is ever lost: raw persistence precedes acknowledgement **[DEC-03]** |
| **NFR-25** | Wallet balances reconcile against the ledger, verified daily, alerting on any discrepancy |
| **NFR-26** | No financial operation is ever partially applied: reserve, settle and release are atomic |
| **NFR-27** | Every state-changing endpoint is idempotent under retry |
| **NFR-28** | Invoice calculation is deterministic and reproducible from recorded inputs |
| **NFR-29** | RPO ≤ **5 minutes**; RTO ≤ **4 hours** |
| **NFR-30** | Backups are restore-tested quarterly, with the result recorded |

## 5. Security

Detailed in [Security](07-security.md). Numbered targets:

| ID | Requirement |
| --- | --- |
| **NFR-31** | No customer can access another customer's data through any endpoint — verified by an automated test over the full route table |
| **NFR-32** | All traffic over TLS 1.2+; TLS 1.3 preferred |
| **NFR-33** | Employee accounts require MFA |
| **NFR-34** | Secrets never appear in source control, images or logs — verified in CI |
| **NFR-35** | Critical and high vulnerabilities in dependencies remediated within 7 days |
| **NFR-36** | Penetration test completed before go-live, findings closed or risk-accepted in writing |

## 6. Retention & compliance

| ID | Requirement |
| --- | --- |
| **NFR-37** | Financial records (ledger, invoices, trades) retained **7 years** — Dutch fiscal requirement |
| **NFR-38** | Interval data retained 7 years, including superseded versions |
| **NFR-39** | Raw inbound messages retained 2 years hot, 7 years cold |
| **NFR-40** | Audit records retained per **[OQ-48]**, minimum 7 years |
| **NFR-41** | All data stored and processed within the EU |
| **NFR-42** | GDPR rights supportable within 30 days of request |

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
that a customer trades on is a dispute waiting to happen.

## 8. Maintainability

| ID | Requirement |
| --- | --- |
| **NFR-50** | Domain and application layer line coverage ≥ **80%**; calculation code ≥ **95%** |
| **NFR-51** | Module dependency graph enforced by an automated architecture test |
| **NFR-52** | `dotnet run` on the Aspire AppHost brings the whole system up locally, including third-party stubs |
| **NFR-53** | A new developer reaches a running local environment within **one day** |
| **NFR-54** | Every reference-data change (calendars, tariffs, surcharges, tickers) is possible without a deployment |
| **NFR-55** | Database migrations are forward-only and expand/contract for breaking changes |
| **NFR-56** | Build, test and deploy to a test environment completes within **15 minutes** |

## 9. Observability

| ID | Requirement |
| --- | --- |
| **NFR-57** | Every request and job carries a correlation id propagated end to end |
| **NFR-58** | Business metrics emitted: trade funnel, ingestion lag, invoice run duration, wallet health |
| **NFR-59** | Alerts fire within 5 minutes of: PVNed silence, Montel staleness, ledger mismatch, failed invoice run, unconfirmed trade escalation |
| **NFR-60** | An operator can trace an invoice line back to the source PVNed message through recorded links |

## 10. Requirements in tension

Worth naming, because the trade-offs were deliberate:

| Tension | Resolution |
| --- | --- |
| **NFR-08** (fast invoice run) vs. **NFR-28** (deterministic and reproducible) | Reproducibility wins. Recording input versions costs storage and time; a non-reproducible invoice costs credibility |
| **NFR-01** (fast reads) vs. tenancy layers 3 and 4 | Isolation wins. The RLS overhead is measurable but small against the cost of a leak |
| **NFR-17** (availability) vs. wallet row locking | Correctness wins. Lock contention is bounded by trade volume, which is low |
| **NFR-07** (fast ingestion) vs. **NFR-24** (never lose a message) | Durability wins. Store-then-acknowledge adds a write to the hot path and is worth it |
| **NFR-12** (data volume) vs. **DEC-09** (one database) | Simplicity wins until the year-3 point, with a defined trigger to revisit |

## 11. Open questions

| Ref | Question |
| --- | --- |
| [OQ-48] | Audit retention period |
| [OQ-53] | Actual expected customer and metering-point counts |
| [OQ-54] | Read replica for reporting? |
| [OQ-61] | Is there a contractual SLA with customers, and what does it commit to? |
