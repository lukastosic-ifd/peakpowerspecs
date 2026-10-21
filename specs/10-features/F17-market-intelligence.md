# F17 — Market Intelligence

**Portal:** customer (platform behind it) · **Priority:** Should · **Phase:** 3 · **Size:** S

---

## 1. Summary

PeakPower's market desk writes a market update by email from **marketnews@peakpower.nl** (the first one seen is
*Marktupdate – 9 oktober 2026*). Until 2026-10-21 that text reached nobody through the portal. This feature
reads those emails, **removes every price**, has the text **rewritten by AI** in Dutch and English, and shows it to
customers in a new **Market Intelligence** screen and a compact card on the Dashboard. Next to it the screen shows
one number PeakPower does not calculate itself: the **expected kWh price for the next 12 months**, the `electricity`
figure published by **dynamische-energieprijzen.nl**, with a tooltip naming the source and the date it was calculated.

It is one decision, **[DEC-184]**, from the request of 2026-10-21 and one user decision taken the same day
(how mail is received: **IMAP mailbox polling**).

| Question | Decision |
| --- | --- |
| Where it shows | A new rail item **Market Intelligence** (*Marktinformatie*) in the Overview group, for every signed-in customer (no product entitlement), and a compact card on the Dashboard. |
| How mail arrives | The Worker polls one mailbox over **IMAP** every 5 minutes and reads unread mail whose sender is exactly the configured address (default `marketnews@peakpower.nl`). A message is processed once, keyed by its `Message-Id`. |
| Which mail is trusted | Only mail from the configured sender **and**, by default, with a passing DKIM or DMARC result for that sender's domain in `Authentication-Results`. Anything else is marked read, recorded as rejected and never shown. |
| What "remove all prices" means | Every sentence that states a monetary amount or rate (€, EUR, euro, cent/ct, $, £, `/MWh`, `/kWh`, `per MWh` …) is removed **before** the text reaches the AI, and every AI output is checked again with the same rule; a sentence that still carries a price is removed. Volumes (m³, TWh), percentages, temperatures and dates are not prices and stay. |
| How AI is used | One request per email to the Claude API, structured output, asking for a neutral rewrite in **formal Dutch** (`u`) and **English**: title, short summary and sections. No investment advice, no prices, the email treated as data. |
| Without an AI key | The price-stripped Dutch text is published as it is (title = subject, sections = the email's headings), marked *not rewritten*; the English portal shows the Dutch text, marked as Dutch. |
| Expected kWh price | The Worker fetches `https://dynamische-energieprijzen.nl/api/expected-prices` every 6 hours and keeps **only** `prices.electricity` (EUR per kWh, excl. VAT as the source states in `inclVat`) and `lastUpdated` as **calculated at** (read as Amsterdam time). A new value is stored only when `lastUpdated` changes. |
| What the customer sees | *Expected kWh price for the next 12 months* — the figure, excl. VAT — and an info tooltip: the source, that it is that source's forecast of the average price over the next 12 months shown as published (not a PeakPower offer), and *Calculated at: dd-mm-yyyy*. |

## 2. Requirements

| ID | Requirement | MoSCoW |
| --- | --- | :--: |
| F17-R01 | The platform reads a configured mailbox over IMAP at a fixed interval and stores each new message from the configured sender once, keyed by `Message-Id`; the original text is kept for staff and is never readable by the customer database role. | Must |
| F17-R02 | A message whose sender is not exactly the configured address is not read. A message from that address without a passing DKIM or DMARC result for its domain is marked read and recorded as rejected, unless the check is switched off by configuration. | Must |
| F17-R03 | Before any further processing, every sentence that states a price, tariff or monetary amount is removed. Volumes, percentages, temperatures, counts and dates are kept. | Must |
| F17-R04 | The price-stripped text is rewritten by AI into a Dutch (formal `u`) and an English version, each a title, a summary and sections. The email content is passed as data; instructions inside it are ignored. | Must |
| F17-R05 | Every AI output string is checked with the rule of R03 and any sentence that still states a price is removed before it is stored. | Must |
| F17-R06 | When no AI key is configured, or the AI request fails three times, the price-stripped Dutch text is published as it is, marked as not rewritten. | Must |
| F17-R07 | The platform fetches the expected-price document of dynamische-energieprijzen.nl at a fixed interval and stores only the `electricity` price, its VAT flag and `lastUpdated` (as the calculated-at time, Amsterdam), once per calculated-at time. A missing, non-positive or implausible (above 5 EUR/kWh) value is not stored. | Must |
| F17-R08 | The customer API serves the latest articles, newest first, and the latest expected price, to every signed-in customer alike (shared reference data). | Must |
| F17-R09 | The customer portal has a **Market Intelligence** rail item and screen showing the expected kWh price for the next 12 months with a tooltip naming the source and *Calculated at: dd-mm-yyyy*, and the articles in the customer's language (Dutch when no English version exists, marked as Dutch). | Must |
| F17-R10 | The Dashboard shows a compact Market Intelligence card: the expected kWh price and the latest article's title and summary, linking to the screen. | Should |
| F17-R11 | When the mailbox or the AI is not configured, the Worker logs it once and keeps running; the screen says there is no market update yet. When no expected price is stored, the figure says it is not available. | Must |

## 3. Out of scope (for now)

- Staff review, editing or withdrawal of an article before or after it is published (it is published automatically) — **[OQ-124]**.
- A back-office view of received messages and the two feeds' status.
- Gas and the other three figures of the expected-price document (`gas`, `electricity-solar`, `solar-feedin`).
- Notifications of a new market update.

## 4. Edge cases

- **The same email twice** (a resend, or the mailbox restored): one article, because `Message-Id` is unique.
- **An HTML-only email:** converted to text before redaction.
- **A price written in words** ("vijfentachtig euro"): the rule matches currency words, so the sentence is removed even without digits.
- **"12 centimeter"**, **"per maand"**, **"Market Insights"**: not prices; the rule matches whole words next to an amount.
- **The source's `lastUpdated` does not change for months** (the example is dated 2026-06-09): the screen shows that date; nothing is invented.
- **The source is unreachable:** the last stored value keeps showing with its own calculated-at date.
