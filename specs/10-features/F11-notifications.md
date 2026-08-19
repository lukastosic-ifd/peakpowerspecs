# F11 — Notifications

⚠ **Retitled 2026-08-19 by [DEC-90].** This document was *F11 — Notifications & Wallet Alerts*. There
are no wallet alerts any more, so the title no longer described the feature. The old name is recorded
here rather than erased.

**Portal:** both · **Priority:** Should (offer, four-eyes approval, deposit and withdrawal
notifications: Must) · **Phase:** 3 · **Size:** M

⚠ **Priority line amended 2026-08-19.** It read *"Should (wallet alerts, approval notifications and
invoice email: Must)"*. Wallet alerts are gone **[DEC-90]** and the invoice email is sent by the
bookkeeping program **[DEC-89]**, so neither can be a Must here. What replaces them as the Must set is
the four-eyes approval traffic **[DEC-71]**, the funds-received mail **[DEC-106]** and the withdrawal
notifications **[DEC-83]**.

---

## 1. Summary

⚠ **Amended 2026-08-19 by [DEC-90] and [DEC-89].** One of the two jobs below no longer exists, and one
of the three example events left the platform.

~~Two distinct jobs sit under one feature.~~ **One job is left.**

**Event notifications** tell someone that something happened — an offer arrived, a trade confirmed,
~~an invoice was issued~~ (⚠ **Removed by [DEC-89]** — the bookkeeping program generates the invoice
PDF and emails it), money arrived in the wallet **[DEC-106]**, a withdrawal was paid out **[DEC-83]**,
or a second admin has to approve something **[DEC-71]**. The offer notification is the time-critical
one: a 30-minute window that the customer doesn't know about is a wasted trade for both sides — and
since **[DEC-111]** that window is deliberately known to fewer people.

~~**Wallet threshold alerts** are rule-driven rather than event-driven. Fixed minimum amounts
**[DEC-49]**, global and per customer, warn a customer as their balance approaches or falls below a
level, so a trade is never blocked by a surprise.~~
⚠ **Reversed 2026-08-19 by [DEC-90].** There are no warning or critical thresholds and no low-balance
alerts. The balance is **visible, not monitored** — it is shown in [F06](F06-wallet-and-ledger.md) and
read by the pre-trade check **[DEC-41]**, which is the only place a balance drives a decision. The
cost is exactly the surprise the old design existed to prevent: a customer now learns they are short
at the moment they try to trade, not before it. That is accepted because the customer can only ever
trade within their balance **[AS-11]**, so the failure is safe and immediate rather than silent.

The decisions that shape this feature, oldest first:

| Decision | Effect here |
| --- | --- |
| ~~**[DEC-63]**~~ ⚠ **Reversed 2026-08-19 by [DEC-111]** | ~~**Every active account** is notified when an offer arrives. Closes [OQ-81] and confirms the design in §2 — a 30-minute offer must not die because one person is in a meeting, and any active account may accept **[DEC-18]**~~ |
| **[DEC-111]** | Offer notifications go to **the account that raised the request**, plus **the admin who must approve** when four-eyes is on **[F11-R25]**. Reverses [DEC-63] and re-closes [OQ-81] the other way. The risk DEC-63 was written to avoid is now accepted deliberately — see §2 |
| ~~**[DEC-47]**~~ ⚠ **Amended 2026-08-19 by [DEC-89]** | ~~Invoices are **both emailed and available in the portal**. Closes [OQ-39], and **raises deliverability from a convenience to a requirement** **[F11-R22]**~~. Invoices are still both emailed and in the portal — but the **email is not sent by the platform** |
| **[DEC-89]** | The **bookkeeping program generates the invoice PDF and emails it**. Invoice, credit-note and true-up notifications leave this catalogue entirely **[F11-R31]**. The platform keeps the calculated invoice data and shows it in the portal with the number returned under **[DEC-88]** |
| **[DEC-48]** | **SendGrid** is the transactional email provider. Closes [OQ-40]. ⚠ **Narrowed 2026-08-19 by [DEC-89]** to the platform's **own** notifications: offers, trade events, wallet deposits, withdrawal requests, four-eyes approvals and ingestion alerts. A **dedicated sending domain with SPF, DKIM and DMARC** is still needed and is still a **lead-time item** **[F11-R24]** |
| ~~**[DEC-33]**~~ ⚠ **Replaced 2026-08-19 by [DEC-71]** | ~~Four-eyes approval adds two notification classes that did not exist: **approval-required**, to the accounts that could approve, and **approval-decided** **[F11-R19..R21]**. The approval rules are [F05](F05-energy-block-trading.md) §3.2's, not this document's~~ |
| **[DEC-71]** | Four-eyes is a **per-company mode with no threshold**, and the approver is a **different admin account of the same company**. Five actions are in scope — add a bank account, deactivate a bank account, add a user, execute a trade, withdraw funds — and each needs an approval-requested and an approved/declined notification **[F11-R19..R21]**, **[F11-R26]**, **[F11-R27]**. Closes [OQ-85] |
| **[DEC-90]** | **No wallet thresholds, no low-balance alerts.** §4 and **[F11-R08..R10]** are removed. Reverses [DEC-49] |
| **[DEC-106]** | A **funds received** email goes to the customer as soon as a bank-transfer deposit is matched on its payment reference **[F11-R28]**. Stated requirement, not a nice-to-have |
| **[DEC-83]** | **Withdrawals exist and are paid out manually.** Request, approval and payout each need a notification **[F11-R29]**, **[F11-R30]** — the payout does not happen at all unless a person is told |

## 2. Who receives a customer notification

A customer company has several accounts, any of which may act **[DEC-16]** — and since **[DEC-71]**
some of them carry an **admin** flag. So "notify the customer" has to mean something specific.

⚠ **Rewritten 2026-08-19 by [DEC-111].** The table below is the post-decision truth. The rule it
replaces — *the default is all active accounts* — is kept underneath it.

| Event class | Recipients | Why |
| --- | --- | --- |
| **Offer received, offer expiring, offer withdrawn** | **The account that raised the request**, plus **the admin accounts that would have to approve** when the company has four-eyes on **[DEC-71]** | **Decided: [DEC-111]**, which re-closes [OQ-81] against [DEC-63]. The requester is the person waiting for the answer; the approving admin is the only other person whose signature the trade needs. Nobody else is told |
| **Approval requested** — any four-eyes action **[DEC-71]**: add a bank account, deactivate a bank account, add a user, execute a trade, withdraw funds | **The other admin accounts of the same customer company** — every admin except the one who raised the action | They are exactly the accounts that *may* approve. The actor is excluded because they cannot approve their own action, and asking them to would teach the whole company to ignore the alert. **There is no threshold** — the notification is raised whenever the mode is on **[DEC-71]** |
| **Approval given, approval declined, expired unapproved** | **The account that raised the action, and the other admin accounts** | An outcome that moves money — a decline or an expiry releases the reservation **[F05-R62]**, **[F05-R63]** — and the actor in particular has to learn what became of their commitment |
| Trade confirmed, declined, failed, rejected, expired | **The account that raised the request**, plus the approving admins where four-eyes applied | ⚠ **Inference, recorded rather than assumed silently.** [DEC-111] speaks about *offer* notifications. Trade outcomes belong to the same request, and the only decision that ever said *every active account* was [DEC-63], which is reversed. Nothing in the 2026-08-19 round gives a trade outcome a wider audience than its own offer, so it gets the same set. **Confirm at the next session** |
| ~~Wallet threshold and negative-balance alerts~~ | ~~All active accounts~~ | ⚠ **Removed 2026-08-19 by [DEC-90]** — there are no threshold alerts. A negative balance cannot arise: the wallet never goes below zero **[AS-11]** |
| **Funds received** — a bank-transfer deposit matched on its reference **[DEC-106]** | The account that raised the deposit, and any configured notification address **[F11-R13]** | The customer wired money and has no other way to learn it landed; the deposit intent has an owner, so the confirmation has an addressee |
| Top-up succeeded or failed (iDEAL) | **The initiating account** | A personal action gets a personal confirmation |
| **Withdrawal requested, approved, declined, paid out** **[DEC-83]** | The requesting account, plus the other admin accounts where four-eyes applies **[DEC-71]** | The payout is a manual bank transfer by a PeakPower employee; the customer's only visibility into it is the notification |
| ~~Invoice issued, credit note, annual true-up~~ | ~~All active accounts, and any finance mailbox configured for the company~~ | ⚠ **Removed 2026-08-19 by [DEC-89]** — the bookkeeping program emails the invoice. The platform still shows the calculated invoice in the portal **[F10](F10-invoicing-and-settlement.md)**, but it sends no mail about it **[F11-R31]** |

~~**The default is all active accounts.** Narrowing it is a per-account preference **[F11-R12]**, and
critical notifications cannot be switched off.~~
⚠ **Reversed 2026-08-19 by [DEC-111].** **The default is the account that acted**, widened only where
a governance rule needs a second person **[DEC-71]**. Narrowing further is still a per-account
preference **[F11-R12]**, and critical notifications still cannot be switched off.

`INVITED` and `DEACTIVATED` accounts are never notified.

**What the narrow audience costs, stated plainly.** [DEC-63] existed for one reason: a 30-minute offer
must not die because one person is in a meeting. That failure is now possible, and [DEC-111] accepts
it. **[DEC-18]** still lets *any* active account accept the offer, so a colleague who happens to be
looking at the portal can still save the trade — they just will not be told to look. The mitigation is
the portal, not the mailbox: the offer is visible to the whole company in-app, and the expiry warning
still fires for the requester. The alternative — telling everyone — was rejected by the customer as
noise. Recorded here so nobody re-derives it as a bug.

## 3. Notification catalogue

The catalogue below is the platform's **own** mail and in-app traffic **[DEC-48]**, as narrowed by
**[DEC-89]**: offers, trade events, wallet deposits, withdrawal requests, four-eyes approvals and
ingestion alerts. Anything invoice-shaped is the bookkeeping program's.

Account invitation mail stays where it already lives — **[F13-R21]** — and is not listed here.
**[DEC-92]** makes MFA **mandatory** for customer users, but it is enforced by Conditional Access in
the tenant **[DEC-66]** and the enrolment prompt is Entra's, so no notification in this catalogue
changes because of it. See [F13](F13-identity-and-access.md).

| Event | Recipient | Channels | Urgency |
| --- | --- | --- | --- |
| Offer received | Customer — **the requester, plus the approving admin under four-eyes [DEC-111]** | In-app + email | **Immediate** |
| Offer expiring soon (configurable, default 5 min left) | Customer — the same set **[DEC-111]** | In-app + email | **Immediate** |
| Offer expired | Customer — the same set **[DEC-111]**, trader | In-app + email | Normal |
| Offer withdrawn by PeakPower | Customer — the same set **[DEC-111]** | In-app + email | Immediate |
| Trade request declined | Customer — the requester | In-app + email | Normal |
| ~~**Approval required** — trade accepted above the four-eyes threshold **[DEC-33]**~~ | ~~Customer — every active account **except the acceptor**~~ | | ⚠ **Amended 2026-08-19 by [DEC-71]** — see the row below. There is no threshold, and the audience is the other **admin** accounts |
| **Approval requested** — a trade was executed under four-eyes **[DEC-71]** | Customer — **the other admin accounts** | In-app + email | **Immediate** |
| **Approval requested** — a bank account was added **[DEC-71]** | Customer — the other admin accounts | In-app + email | Normal |
| **Approval requested** — a bank account was deactivated **[DEC-71]** | Customer — the other admin accounts | In-app + email | Normal |
| **Approval requested** — a user was added **[DEC-71]** | Customer — the other admin accounts | In-app + email | Normal |
| **Approval requested** — a withdrawal was requested **[DEC-71]**, **[DEC-83]** | Customer — the other admin accounts | In-app + email | Normal |
| **Approval reminder** — 5 minutes left, same window **[F05-R61]** (trades only) | Customer — the same admins | In-app + email | **Immediate** |
| **Approved** — any four-eyes action | Customer — the actor and the other admins | In-app + email | Normal |
| **Declined** — any four-eyes action; a trade reservation is released **[F05-R63]** | Customer — the actor and the other admins | In-app + email | **Immediate** |
| **Expired unapproved** — trade only, reservation released **[F05-R62]** | Customer — the actor and the other admins, trader | In-app + email | **Immediate** |
| Trade confirmed | Customer — the requester | In-app + email | Normal |
| Trade failed | Customer — the requester | In-app + email | **Immediate** |
| Top-up succeeded (iDEAL) | Customer — the initiating account | In-app + email | Normal |
| Top-up failed (iDEAL) | Customer — the initiating account | In-app + email | Normal |
| ~~Bank deposit registered~~ | ~~Customer~~ | | ⚠ **Replaced 2026-08-19 by [DEC-106]** — a manually registered transfer becomes a matched deposit with a platform-issued reference; the row below is the notification |
| **Funds received** — bank transfer matched to a deposit intent **[DEC-106]** | Customer | In-app + email | **Immediate** |
| **Deposit unmatched too long** — money arrived with no usable reference **[DEC-61]** | Employees | In-app + email digest | Normal |
| **Withdrawal requested** **[DEC-83]** | **PeakPower employees** | In-app + email | **Immediate** |
| **Withdrawal paid out** **[DEC-83]** | Customer — the requester | In-app + email | Normal |
| **Withdrawal rejected** **[DEC-83]** | Customer — the requester | In-app + email | Normal |
| ~~Wallet approaching minimum~~ | ~~Customer~~ | | ⚠ **Removed 2026-08-19 by [DEC-90]** |
| ~~Wallet below minimum~~ | ~~Customer~~ | | ⚠ **Removed 2026-08-19 by [DEC-90]** |
| ~~Wallet negative~~ | ~~Customer, finance~~ | | ⚠ **Removed 2026-08-19 by [DEC-90]**; the balance cannot go negative **[AS-11]** |
| ~~Invoice issued~~ | ~~Customer~~ | | ⚠ **Removed 2026-08-19 by [DEC-89]** — sent by the bookkeeping program |
| ~~Credit note issued~~ | ~~Customer~~ | | ⚠ **Removed 2026-08-19 by [DEC-89]** — sent by the bookkeeping program |
| ~~Annual true-up available~~ | ~~Customer~~ | | ⚠ **Removed 2026-08-19 by [DEC-89]**; and under **[DEC-99]** corrections are invoiced continuously rather than in an annual event |
| New trade request | Traders | In-app + email | **Immediate** |
| Trade unconfirmed too long | Traders | In-app | **Immediate** |
| Trade awaiting customer approval **[F05-R66]** | Traders | In-app | Normal |
| Metering data missing | Employees | In-app + email digest | Normal |
| Integration failing | Employees | In-app + email | **Immediate** |
| ~~Invoice run finished~~ | ~~Finance~~ | | ⚠ **Amended 2026-08-19 by [DEC-88]** — what finishes is a **push of drafts** to the bookkeeping program; the notification stays, and it now tells finance that drafts are waiting to be checked, not that invoices went out |
| **Draft invoices pushed** — count, total, push failures **[DEC-88]** | Finance | In-app + email | Normal |

## 4. ~~Wallet threshold rules~~ — removed

⚠ **Removed 2026-08-19 by [DEC-90]**, which reverses **[DEC-49]**. There are no warning or critical
thresholds, no per-customer threshold rules, no evaluation job, no cooldown and no recovery notice.
The reason given is short and complete: *the customer can only trade within his balance*, so the
pre-trade check **[DEC-41]** already prevents the only harm the alerts were protecting against.

The original section is kept below for the record. **It is not implemented.** The flowchart is kept as
plain text rather than as a rendered diagram, so that no live diagram in this spec set contradicts
**[DEC-90]**.

~~Both thresholds are fixed amounts **[DEC-49]**, not a function of recent trading volume. This closes
[OQ-41] and is deliberately the simple, predictable answer: a customer can be told their warning level
in euros and it does not move underneath them. The cost is accepted at the extremes — the same figure
is noise for a very large customer and silence for a very small one, which is what the per-customer
scope exists to correct, one customer at a time. Resolution is most-specific-wins: a customer rule
overrides the global rule; absent both, no alerts. Rules are evaluated on every balance change and
once daily, so both a sudden drop and a slow drift are caught.~~

```text
REMOVED — [DEC-90]. Retained as history, not built.

wallet_threshold_rule
  ├─ scope             GLOBAL | CUSTOMER
  ├─ scope_id
  ├─ warning_amount    fixed EUR amount — warn at or below this available balance   [DEC-49]
  ├─ critical_amount   fixed EUR amount — urgent at or below this                   [DEC-49]
  ├─ evaluation        ON_CHANGE + DAILY
  └─ cooldown_hours    suppress repeats, default 24

flowchart LR
    A["available balance changes"] --> B{"≤ critical?"}
    B -->|yes| C["CRITICAL alert (respect cooldown)"]
    B -->|no|  D{"≤ warning?"}
    D -->|yes| E["WARNING alert (respect cooldown)"]
    D -->|no|  F{"was in alert previously?"}
    F -->|yes| G["RECOVERED notice, clear alert state"]
    F -->|no|  H["nothing"]
```

**What replaces it:** nothing. The balance is shown in the portal and in [F06](F06-wallet-and-ledger.md),
and the trade path fails a request that exceeds the available balance **[DEC-41]**, VAT-inclusive
since **[DEC-78]**. **[F11-R32]** records the absence so it is not re-added by habit.

## 5. Functional requirements

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F11-R01 | Every event in §3 raises a notification to the recipients defined in §2. | Must |
| ~~F11-R02~~ | ~~Offer, trade-outcome and wallet-critical notifications go to **every active account** of the company, not only the account that raised the request **[DEC-63]**.~~ ⚠ **Reversed 2026-08-19 by [DEC-111]** — replaced by **[F11-R25]**. The wallet-critical half also disappears with **[DEC-90]**. | ~~Must~~ |
| F11-R03 | Notifications appear in an in-app notification centre with unread counts, and are marked read on open. | Must |
| F11-R04 | Email notifications are sent for events marked as such, rendered from templates with the customer's language **[AS-19]**. | Must |
| F11-R05 | Immediate-urgency notifications are dispatched without batching or digesting. | Must |
| F11-R06 | Offer notifications include price, volume, total value and the deadline as an absolute local time as well as a duration. | Must |
| F11-R07 | Every notification deep-links to the object it concerns. | Must |
| ~~F11-R08~~ | ~~Threshold rules can be configured globally and per customer, warning and critical, by an authorised employee. Both are **fixed EUR amounts [DEC-49]**; nothing derives them from trading volume, and no such derivation is configurable.~~ ⚠ **Removed 2026-08-19 by [DEC-90]** — there are no threshold rules to configure. Nothing replaces it; see **[F11-R32]**. | ~~Must~~ |
| ~~F11-R09~~ | ~~Threshold rules are evaluated on balance change and daily, with a cooldown to prevent flapping.~~ ⚠ **Removed 2026-08-19 by [DEC-90]** — no rules, no evaluation job. | ~~Must~~ |
| ~~F11-R10~~ | ~~A recovery notice is sent when a wallet returns above the warning level.~~ ⚠ **Removed 2026-08-19 by [DEC-90]** — there is no alert state to recover from. | ~~Must~~ |
| F11-R11 | Notification delivery attempts and outcomes are logged; failures are retried and visible to employees. | Must |
| F11-R12 | Customers can choose which non-critical emails they receive. Offer, trade-failed ~~and wallet-critical~~ emails are **not** optional. ⚠ **Amended 2026-08-19**: wallet-critical mail no longer exists **[DEC-90]**; **four-eyes approval mail is added to the non-optional set [DEC-71]**, because it is the record of a governance act **[F11-R27]**, and so is the funds-received mail **[DEC-106]**, which is the customer's only confirmation that a wire landed. | Should |
| F11-R13 | A company can have additional notification-only email addresses (e.g. a shared finance mailbox) that are not accounts and cannot sign in. ⚠ **Amended 2026-08-19**: its main use — the invoice mail — left with **[DEC-89]**. It survives for the funds-received mail **[F11-R28]** and for withdrawal outcomes, so it drops to Could unless a customer asks. | Could |
| F11-R14 | An in-app notification is marked read per account, not per company — one colleague reading it does not clear it for everyone. | Must |
| F11-R15 | Employees can see the notification history for a customer, to answer "did we tell them?". ⚠ Worth more since **[DEC-111]**: with a narrower audience, "who exactly was told" is a question that will now be asked. | Should |
| F11-R16 | An employee can resend a notification. ⚠ Worth more since **[DEC-111]**: resending an offer notification to a colleague is the manual workaround for the requester being unavailable. | Should |
| F11-R17 | Browser push for offer notifications. ⚠ Its value rises under **[DEC-111]** — one recipient, so reaching that one recipient matters more. | Could |
| F11-R18 | Webhooks so a customer's own systems can subscribe to events. | Could |
| **F11-R25** | Offer notifications — received, expiring, withdrawn, expired — go to **the account that raised the request**, and additionally to the **admin accounts that would have to approve** when the company has four-eyes enabled **[DEC-111]**, **[DEC-71]**. No other account of the company is emailed. Replaces ~~[F11-R02]~~. | Must |
| **F11-R26** | Every four-eyes action **[DEC-71]** — add a bank account, deactivate a bank account, add a user, execute a trade, withdraw funds — raises an **approval-requested** notification to **the other admin accounts of the same customer company**, in-app and by email. **There is no threshold**: it is raised whenever the mode is on. The message names the acting admin **[DEC-17]** and what is being approved, and deep-links to the approval screen. | Must |
| **F11-R27** | Every four-eyes action raises an **approved** or **declined** notification to the acting account and the other admin accounts, naming the deciding admin **[DEC-17]**. Where money was released — a trade reservation **[F05-R63]**, or a withdrawal that will not be paid — the notification states the amount, because the available balance has just changed without anyone spending anything. These are **not opt-out** (business rule 1). | Must |
| **F11-R28** | When a bank-transfer deposit is matched to its deposit intent on the platform-issued payment reference **[DEC-106]**, a **funds received** email is sent to the customer immediately, stating the amount and the new balance. This is a stated requirement of the deposit route, not a nice-to-have: the customer has no other signal that a wire landed. ⚠ It cannot be built before the incoming-payment feed is chosen **[OQ-93]**. | Must |
| **F11-R29** | A withdrawal request notifies **PeakPower employees** immediately **[DEC-83]**. The payout is a manual bank transfer, so nothing happens at all unless a person is told; this notification is part of the mechanism, not a courtesy. | Must |
| **F11-R30** | The customer is notified when a withdrawal is **paid out** and when it is **rejected** **[DEC-83]**, with the amount and the destination account's last four digits **[DEC-61]**. Approval and decline under four-eyes are covered by **[F11-R27]**. | Must |
| **F11-R31** | The platform sends **no invoice, credit-note or true-up email** **[DEC-89]**. It pushes a draft to the bookkeeping program **[DEC-88]**, which generates the PDF and sends it. The platform notifies **finance internally** that drafts are waiting (§3), and shows the calculated invoice in the portal. Replaces ~~[F11-R22]~~. | Must |
| **F11-R32** | The platform performs **no balance monitoring**: no thresholds, no low-balance alerts, no scheduled balance evaluation **[DEC-90]**. Recorded as a requirement so the absence is deliberate and testable rather than an omission. | Must |

### Four-eyes approval notifications

~~New with **[DEC-33]**.~~ ⚠ **Redesigned 2026-08-19 by [DEC-71]**, which replaces [DEC-33] and closes
[OQ-85]. Two things changed and both change this subsection:

1. **There is no threshold.** Four-eyes is a per-customer-company **mode**. If it is on, every action
   in scope needs a second signature, whatever it is worth. The threshold reference table [DEC-33]
   required is not built, and no notification is conditional on a value.
2. **The approver is an admin.** Customer accounts now carry an **admin** flag — a two-level role
   model that exists only to make four-eyes expressible ⚠ (qualifying **[DEC-16]**, which said all
   accounts of a company have identical privileges). The audience is therefore **the other admin
   accounts of the same company**, not every active account.

**The approval rules are [F05](F05-energy-block-trading.md) §3.2's** for trades — who may approve, what
the clock does, and what happens to the reservation. This section specifies only the telling, and must
not be read as restating the rule. For the four non-trade actions there is no offer clock at all;
**[F11-R26]** and **[F11-R27]** are the whole notification story.

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F11-R19 | On a trade entering `AWAITING_APPROVAL`, ~~**every active account except the acceptor**~~ — ⚠ **amended 2026-08-19 by [DEC-71] to every other admin account of the company** — is notified immediately, in-app and by email **[F05-R65]**. The message carries the trade value, the **acceptor's name and job title** **[DEC-17]**, and the time remaining **both ways** — the absolute local `expires_at` and the duration **(business rule 2)**. It deep-links to the approval screen. ⚠ The trigger is no longer "above the threshold" but "the company has four-eyes on" **[DEC-71]**. | Must |
| F11-R20 | A reminder goes to **the same set** when 5 minutes of the offer window remain **[F05-R65]**. There is no separate approval window to count down — the offer's `expires_at` is the only clock **[F05-R61]**, so the reminder is computed from it and from nothing else. ⚠ **Amended 2026-08-19 by [DEC-71]**: "the same set" now means the other admin accounts. This requirement applies to **trades only**; the other four actions have no expiry. | Must |
| F11-R21 | The outcome of an awaiting-approval trade — **approved**, ~~**refused**~~ **declined** **[F05-R63]**, or **expired unapproved** **[F05-R62]** — is notified to ~~**every active account**~~ ⚠ **the acting account and the other admin accounts [DEC-71]**, naming the deciding account where there is one. Where the reservation was **released**, the notification says so and states the amount, because the customer's available balance has just changed without anyone spending anything. Approval and decline notifications are **not opt-out** (business rule 1): they are the record of a governance act. ⚠ Generalised to the other four actions by **[F11-R27]**. | Must |

### Email delivery

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| ~~F11-R22~~ | ~~An invoice is **both emailed to the customer and available in the portal** **[DEC-47]**. The email goes to every active account and to any configured finance mailbox **[F11-R13]**, states the invoice number, period and total, and deep-links to the portal copy. ⚠ **Whether the PDF is attached or only linked is not decided.** Attachment is what finance departments expect; a link keeps the document behind authentication. **[DEC-46]** settles who *generates* the PDF — the platform — and not how it is delivered. Decide before the first invoice run; recorded here in prose deliberately, as a live question rather than a numbered one.~~ ⚠ **Removed 2026-08-19 by [DEC-89]** — the bookkeeping program generates the PDF and sends the email. Replaced by **[F11-R31]**. The attached-or-linked question closes with **[OQ-90]**: it is no longer the platform's question. | ~~Must~~ |
| F11-R23 | **SendGrid is the transactional email provider** **[DEC-48]**, reached through a provider-agnostic port in the same shape as the payment and market-data ports. No SendGrid type appears outside the adapter, so a change of provider stays configuration plus a migration of templates. ⚠ **Narrowed 2026-08-19 by [DEC-89]** to the platform's own notifications: offers, trade events, wallet deposits, withdrawal requests, four-eyes approvals and ingestion alerts. The bookkeeping program's mail is sent by the bookkeeping program, through whatever it uses. | Must |
| F11-R24 | Transactional mail is sent from a **dedicated sending domain** with **SPF, DKIM and DMARC** published and aligned, and the domain is warmed before go-live **[DEC-48]**. ⚠ ~~**This is a lead-time item and it now gates money, not only convenience**: **[DEC-47]** puts invoices on the same channel as offer notifications, so a domain in DMARC quarantine means an unread offer *and* an undelivered invoice.~~ **Amended 2026-08-19 by [DEC-89]**: the invoice is no longer on this channel, which **narrows the blast radius** of a deliverability problem — but it does not remove it. A domain in DMARC quarantine still means an unread offer **[F11-R25]**, an unseen approval request **[F11-R26]** and a customer who does not know their wire landed **[F11-R28]**. It remains a lead-time item. Bounce and spam-complaint webhooks are consumed and surfaced **[F11-R11]**. | Must |

## 6. Business rules

1. **Critical notifications are not opt-out.** A customer cannot unsubscribe from an offer alert, a
   trade failure, a **four-eyes approval request or decision [DEC-71]**, or a **funds-received
   confirmation [DEC-106]**.
2. **Deadlines are shown both ways** — "expires at 14:32" and "in 27 minutes". A relative time alone
   is useless in an email read twenty minutes later.
3. ~~**Cooldown prevents noise**, but a *state change* (warning → critical) always sends, cooldown or
   not.~~ ⚠ **Removed 2026-08-19 by [DEC-90]** — cooldown existed only for threshold alerts. Event
   notifications fire once per event and need no suppression.
4. **No sensitive figures beyond what the recipient may already see.** Emails carry amounts because
   the recipient is the account holder; they never carry credentials or tokens. A withdrawal
   notification names the destination account by its last four digits only **[F11-R30]**.
5. **Delivery is at-least-once and logged.** A missed offer notification is a commercial loss, so the
   dispatcher retries and records. ⚠ ~~Since **[DEC-47]** a missed *invoice* email is a billing dispute,
   which is why **[F11-R24]** treats the sending domain as infrastructure rather than as setup.~~
   **Amended 2026-08-19 by [DEC-89]**: the invoice mail is not ours to miss. What is ours is the offer,
   the approval request and the funds-received mail — a missed approval request under **[DEC-71]** is a
   trade that expires unapproved, which is still money.
6. **Language follows the customer's preference**, falling back to Dutch.
7. ~~**The approver set is computed at send time, not stored** **[DEC-33]**. It is "active accounts of
   the company, minus the acceptor" **[F05-R59]**, evaluated when the notification is dispatched, so an
   account deactivated between acceptance and approval is neither asked nor counted.~~
   ⚠ **Amended 2026-08-19 by [DEC-71].** The set is still computed at send time and still not stored,
   but it is now **"active admin accounts of the company, minus the account that acted"**. An admin
   deactivated — or an admin flag removed — between the action and the approval is neither asked nor
   counted.
8. ~~**Thresholds are amounts, not formulas** **[DEC-49]**. A customer can be told their warning level in
   euros and it stays that number until an employee changes it.~~ ⚠ **Removed 2026-08-19 by [DEC-90]**
   — there are no thresholds of either kind.
9. **Four-eyes notifications carry no value test** **[DEC-71]**. The dispatcher must not compare an
   amount to anything to decide whether to send. The only condition is the company's four-eyes mode.
10. **The audience follows the actor, not the company** **[DEC-111]**. A notification goes to the
    account that caused the event, widened only by a governance rule that names a second person. Any
    requirement that says "all active accounts" is either pre-2026-08-19 or a bug.

## 7. Data

| Entity | Purpose |
| --- | --- |
| `notification` | recipient, type, payload, created_at, read_at, deep link |
| `notification_delivery` | channel, attempt, status, provider id, error |
| `notification_preference` | Per user, per type, per channel |
| ~~`wallet_threshold_rule`~~ | ~~Scope, thresholds, cooldown~~ ⚠ **Removed 2026-08-19 by [DEC-90]** — not created |
| ~~`wallet_alert_state`~~ | ~~Current alert level per wallet, last sent, for cooldown and recovery~~ ⚠ **Removed 2026-08-19 by [DEC-90]** — not created |

The four-eyes approval request itself is **not** stored here. It belongs to the feature that raises it
— [F05](F05-energy-block-trading.md) §3.2 for trades, and the bank-account, user and withdrawal flows
for the other four actions **[DEC-71]**. This feature only reads it to decide who to tell.

## 8. Edge cases

| Case | Behaviour |
| --- | --- |
| Email bounces | Recorded; repeated bounces flag the address and alert employees |
| Offer expires before the email is delivered | Email still sent; content reflects the expired state when opened via the deep link |
| ~~Balance oscillates around the threshold~~ | ~~Cooldown suppresses repeats; level changes still send~~ ⚠ **Removed 2026-08-19 by [DEC-90]** |
| ~~Threshold set above the current balance~~ | ~~Fires immediately on the next evaluation — intended~~ ⚠ **Removed 2026-08-19 by [DEC-90]** |
| An account has no email address | Impossible — email is mandatory **[F01-R11]** |
| ~~A company has one account and that person is away~~ | ~~The offer expires unanswered. Employees are prompted at onboarding to create a second account~~ ⚠ **Amended 2026-08-19 by [DEC-111]**: this is no longer an edge case, it is the **normal** failure mode. Only the requester is told, so *any* company whose requester steps away can lose an offer. Accepted — see §2. A colleague can still accept from the portal **[DEC-18]**, and an employee can resend **[F11-R16]** |
| **A company has four-eyes on and only one admin account** | There is **nobody to notify** — the approver set is empty once the actor is excluded **[F11-R26]**, business rule 7. No notification is sent, and the action cannot be approved: a trade expires unapproved **[F05-R62]**, and a bank account, user or withdrawal simply stays pending. ⚠ **Widened 2026-08-19 by [DEC-71]** from trades to all five actions, and the trigger is now the mode rather than a threshold. The warning that matters is given **before submission** **[F05-R56]** for trades; the other four actions need the same warning where they are raised. This feature must not invent a second warning at approval time, and must not fall back to notifying the actor |
| **The actor is deactivated while an action awaits approval** | The approver set is recomputed at send time (business rule 7), so the reminder goes to the remaining **admin** accounts. If none remains, the trade expires and **[F11-R21]** still reports the release |
| **An admin flag is removed while an action awaits approval** | ⚠ New with **[DEC-71]**. Same rule: the set is computed at send time, so that account stops being notified and stops being able to approve. It does not invalidate an approval already given |
| ~~**Invoice email hard-bounces**~~ | ~~Recorded and surfaced, and the invoice is **still available in the portal [DEC-47]** — the two channels are deliberately independent. Repeated bounces flag the address and alert employees, because under **[DEC-47]** an undelivered invoice is a billing problem rather than a preference~~ ⚠ **Removed 2026-08-19 by [DEC-89]** — the platform does not send the invoice email, so it never sees the bounce. A bounced invoice is now a bookkeeping-program problem, and the platform's only contribution is that the calculated invoice stays visible in the portal **[F10](F10-invoicing-and-settlement.md)** |
| **The funds-received email fails** | ⚠ New with **[DEC-106]**. The wallet is already credited — the mail is a notification, never a step in the credit. Retried and logged **[F11-R11]**; the balance is visible in the portal regardless |
| **A wire arrives with no usable payment reference** | No deposit intent to match, so no funds-received mail can be addressed. It falls to IBAN matching **[DEC-61]** and, failing that, to the employee digest in §3. The customer is told when the match is made, not when the money arrived |
| **A withdrawal is requested and no employee reads the notification** | Nothing is paid. The payout is manual **[DEC-83]**, so **[F11-R29]** is load-bearing rather than informational; it is the only trigger the process has |
| One colleague reads an in-app notification | It stays unread for the others **[F11-R14]** |
| ~~Bulk event (invoice run for 50 customers)~~ | ~~Notifications queued and rate-limited; no provider throttling~~ ⚠ **Amended 2026-08-19 by [DEC-89]**: the invoice run no longer generates 50 customer emails from the platform — it generates one internal notification that drafts were pushed **[DEC-88]**. Queueing and rate-limiting stay for the events that remain (a market-wide offer round, an ingestion failure across many metering points) |
| Email provider outage | Queued and retried; in-app notifications are unaffected |

## 9. Out of scope

- SMS and WhatsApp.
- Marketing or newsletter email.
- Per-user quiet hours (critical notifications would have to override them anyway).
- **Wallet balance monitoring of any kind** **[DEC-90]**, **[F11-R32]**.
- **Invoice, credit-note and true-up email** **[DEC-89]** — the bookkeeping program's job.
- **MFA enrolment and account-credential mail** — Entra's, under **[DEC-92]** and **[DEC-66]**. The
  platform sends the invitation **[F13-R21]** and nothing else about identity.

## 10. Dependencies

| Depends on | Why |
| --- | --- |
| [F05](F05-energy-block-trading.md) | Trade events, and the four-eyes approval rules this feature notifies about ~~**[DEC-33]**~~ **[DEC-71]** — §3.2 there is authoritative for trades |
| [F06](F06-wallet-and-ledger.md) | Balance changes and the wallet ledger. ⚠ **Narrowed 2026-08-19 by [DEC-90]**: this feature reads balance *events*, not balance *levels* |
| [F07](F07-wallet-topup-and-payments.md) | The deposit match that fires the funds-received mail **[DEC-106]**, and the withdrawal request, approval and payout **[DEC-83]** |
| [F10](F10-invoicing-and-settlement.md) | ~~Invoice events, now an email obligation **[DEC-47]**~~ ⚠ **Amended 2026-08-19 by [DEC-89]**: invoice events are no longer an email obligation here. What remains is the **internal** notification that drafts were pushed to the bookkeeping program **[DEC-88]** |
| [F13](F13-identity-and-access.md) | The **admin** flag on a customer account **[DEC-71]** — without it the approver set in business rule 7 cannot be computed |
| **SendGrid** | Transactional email **[DEC-48]**, behind a provider-agnostic port **[F11-R23]**, for the platform's own notifications only **[DEC-89]** |

## 11. Open questions

| Ref | Question |
| --- | --- |
| ~~[OQ-39]~~ | ~~Are invoices emailed to customers, or portal-only?~~ **Closed by [DEC-47]** — both **[F11-R22]**. Deliverability becomes a requirement. ⚠ **Re-answered 2026-08-19 by [DEC-89]**: both, but **the platform sends neither the PDF nor the email** **[F11-R31]** |
| ~~[OQ-40]~~ | ~~Which transactional email provider, and is a dedicated sending domain with SPF/DKIM/DMARC available?~~ **Closed on the provider — [DEC-48]: SendGrid** **[F11-R23]**. ⚠ **The sending domain is not a detail of the answer, it is the remaining work**: a dedicated domain with SPF, DKIM and DMARC has to be obtained, published, aligned and warmed, and it has external lead time **[F11-R24]**. ⚠ **Narrowed 2026-08-19 by [DEC-89]** to the platform's own notifications — the lead-time item stands, the invoice no longer depends on it |
| ~~[OQ-41]~~ | ~~Default warning and critical thresholds — a fixed amount, or derived from recent trading volume?~~ ~~**Closed by [DEC-49]** — fixed amounts **[F11-R08]**. The default *values* are still an operational setting, not a specification item.~~ ⚠ **The question itself is void as of 2026-08-19 [DEC-90]**: there are no thresholds of either kind, so there is no default to set. [DEC-49] is reversed and **[F11-R08]** is removed |
| ~~[OQ-81]~~ | ~~When an offer arrives, is every account notified, or only the one that raised the request?~~ ~~**Closed by [DEC-63]** — every active account **[F11-R02]**.~~ ⚠ **Re-closed 2026-08-19 the other way by [DEC-111]** — **only the account that raised the request**, plus the approving admin under four-eyes **[F11-R25]** |
| ~~[OQ-85]~~ | ~~What is the four-eyes threshold, in euros or megawatts?~~ **Closed by [DEC-71]** — **there is no threshold**. Four-eyes is a per-company mode covering five actions, and the threshold reference table [DEC-33] required is not built **[F11-R26]** |
| ~~[OQ-90]~~ | ~~Is the invoice PDF attached to the email or only linked?~~ **Closed by [DEC-89]** — it is not the platform's question. The bookkeeping program generates and sends the document; **[F11-R22]** is removed with the question |
| **[OQ-93]** | Which incoming-payment feed does the platform consume for wallet deposits — CAMT.053 import, a PSP webhook, or a SEPA-instant push? **Open.** It is listed here because **[F11-R28]** cannot be built without it: there is no funds-received mail until something tells the platform funds were received. Owned by [F07](F07-wallet-topup-and-payments.md); this feature is a consumer |
| **[OQ-92]** | Are the hedge and the day-ahead delivery one invoice document or two? **Open**, and only marginally this feature's business since **[DEC-89]** — it changes how many drafts finance is told about in the "draft invoices pushed" notification, not who is emailed |
