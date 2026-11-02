# Integration — EEX Group DataSource (forward block prices)

**Direction:** outbound poll · **Protocol:** REST/JSON over HTTPS · **Criticality:** high when selected

> **[DEC-193], 2026-11-02.** EEX is the first **real** forward-price provider behind `IMarketDataProvider`.
> It is selected with `ForwardPrices:Provider=Eex` and is a second, independent provider next to the planned
> Montel feed ([02 Montel](02-montel-api.md)), not a replacement of that document. Day-ahead prices are **not**
> taken from EEX: they stay on ENTSO-E ([06](06-entsoe-day-ahead.md)), because the EEX REST API does not carry
> EPEX SPOT auction results.

## 1. What it is used for

The forward price indications of **[F04](../10-features/F04-price-indications.md)**: the 24 products
(Base and Peak × M+1…M+6, Q+1…Q+4, Cal+1…Cal+2, **[DEC-161]**). Those indications are what the customer sees on
`/prices` and what a trade request snapshots as `indication_price_eur_per_mwh` (**[F05](../10-features/F05-energy-block-trading.md)**).
The price a block is **traded** at is still the desk's offer; EEX does not set it.

## 2. The API

EEX Group DataSource REST API v2 (user guide release 008, 2026-10-02).

| | |
| --- | --- |
| Base URL | `https://api.eex-group.com/v2/` (`Eex:BaseUrl`) |
| Auth | `Authorization: Bearer <API key>`; the key is created in the DataSource Hub (eds.eex-group.com → Access Tokens), shown once, valid one year |
| Method / format | GET only, JSON |
| Rate limit | 1 request per second per user (429 above it); the client spaces every call by `Eex:RequestSpacing` (default 1.1 s) and retries a 429 once |
| Parameters | Commodity `POWER`, area `NL` (`Eex:Commodity`, `Eex:Area`), as the owner asked |
| Weekends | reference and trade calls for a Saturday or Sunday answer 404; the client steps back to the last weekday |

Calls, all under `…/{Commodity}/{Area}/{TrdDate}/…`:

1. `rd/derivatives/POWER/NL/{TrdDate}` — the products of the day, each with `ShortCode` and `LongName`.
   The client picks the Dutch Base/Peak Month/Quarter/Year futures **by name** (`LongName` contains Dutch, Power,
   Base or Peak, Month, Quarter or Year, and Future, and none of Spread, Week, Weekend, Day, Option, Off-Peak).
   An operator can pin a code instead (`Eex:BaseMonth`, `Eex:PeakQuarter`, …). No match, or more than one, is a
   warning naming the candidates and the product stays unpriced.
2. `rd/derivatives/POWER/NL/{TrdDate}/{ShortCode}/` — the listed maturities. The product's resolved
   **[DEC-161]** delivery period is matched against that list (`yyyyMM` for a month; for a quarter and a year the
   documented formats are unknown, so the candidates `2027Q1`, `2027-Q1`, `202701`, … and `2027`, `202701` are tried in turn).
   No match is a warning listing what EEX offered; the product stays unpriced. **A maturity is never guessed.**
3. `trd/derivatives/POWER/NL/{today}/{ShortCode}/{Maturity}` — today's trades. The price is the `Px` of the latest
   `Tm`, ignoring cancelled trades; the observation time is that `Tm`.
4. Otherwise `stats/derivatives/POWER/NL/{day}/{ShortCode}/{Maturity}` for the previous weekdays (up to
   `Eex:SettlementLookbackDays`, default 7) — the latest settlement, with a later correction (`UpdtAct` Change)
   winning over the first publication. The observation time is the settlement's `Tm`, so an indication read from
   yesterday's settlement turns **STALE** inside the market window under **[DEC-161]** (6), which is the honest label.

Prices arrive in EUR per MWh and are stored as they arrive, unit `MWH` (**[DEC-180]**); readers convert to euro per kWh as
for every other source.

## 3. Failure behaviour

- **No token** with `Provider=Eex`: the Worker logs one warning at start-up and registers no provider; every
  indication answers **UNAVAILABLE**. No price is ever invented (F04 business rule 3).
- **401**: the whole poll fails (`ProviderFailed`), naming `EEX_API_TOKEN` and never printing it.
- **404, a missing product or maturity, a bad body**: that product is unpriced this tick; the others are still stored.

## 4. Configuration (`deploy/.env`)

| Variable | Reaches | Default |
| --- | --- | --- |
| `FORWARD_PRICES_PROVIDER` | `ForwardPrices__Provider`, Worker and customer API | empty (no provider) — set `Eex` |
| `EEX_API_TOKEN` | `Eex__ApiToken`, Worker only — **secret** | empty |
| *(no .env line)* | `Eex__Commodity`, `Eex__Area`, set on the Worker only if they must change | `POWER`, `NL` |
| *(no .env line)* | `Eex__BaseMonth` … `Eex__PeakYear`, pin a short code when the log says the name match failed | empty (found by name) |

## 5. Licence — open

EEX's webshop subscriptions are for internal use within one legal entity. Showing EEX prices to customers in the
portal is external use and needs EEX's dissemination licence (quote from datasource@eex-group.com). This is the
EEX counterpart of **[OQ-117]** and must be settled before `Eex` is switched on against real customers.
