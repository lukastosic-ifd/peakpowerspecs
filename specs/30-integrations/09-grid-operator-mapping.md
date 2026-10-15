# Integration — Grid-operator mapping

**Direction:** outbound, daily and once per unknown code · **Protocol:** REST, JSON over HTTPS · **Criticality:** low — a name falls back to the code

> **Specified 2026-10-15 by [DEC-182] (8).** PeakPower's own service names grid operators by their 13-digit party code. The platform stores its list in `metering.grid_operator`, refreshes it once a day in the Worker and on demand from the back office, and looks up a code missing from the list once. Every party code the EAN-detail popup shows is named this way; a code the service does not know shows as the code with "name not known". Nothing here is built yet.

## 1. The two requests

| What | Request |
| --- | --- |
| The whole list | `GET {GridOperatorMapping:BaseUrl}/api/eanmapping` |
| One code | `GET {GridOperatorMapping:BaseUrl}/api/eanmapping/{code}` (the code must be 13 digits and is escaped) |

The base URL is the product owner's: `https://ke-gridoperator-costs-g3yecgunzq-ez.a.run.app`. The list is a root array of `eanSubOperator`, `nameSubOperator`, `eanOperator` and `nameOperator`, read case-insensitively. **A 404 is "not found" before the body is read**: the body is plain text ("Sub operator EAN could not be found."), and parsing it as JSON would turn every unknown supplier code into a read error.

## 2. Settings

| Setting | Env | Default |
| --- | --- | --- |
| `GridOperatorMapping:BaseUrl` | `GridOperatorMapping__BaseUrl` (compose `GRID_OPERATOR_MAPPING_BASE_URL`, on both APIs and the Worker) | `https://ke-gridoperator-costs-g3yecgunzq-ez.a.run.app` |
| `GridOperatorMapping:Provider` | `GridOperatorMapping__Provider` | empty; `Simulated` is set by `./dev-up`, the tests and e2e |
| `GridOperatorMapping:RequestTimeout` | — | 5 seconds |
| `GridOperatorMapping:RefreshInterval` | — | 1 day, Worker only |
| `GridOperatorMapping:RunOnStartup` | — | true, Worker only |
| `GridOperatorMapping:NotFoundCacheDuration` | — | 1 day |

## 3. Storage

`metering.grid_operator` ([database design](../20-architecture/04-database-design.md) §3.2.2) holds the code, `nameSubOperator`, `eanOperator`, `nameOperator`, which endpoint last confirmed it (the list or a single lookup) and when. A refresh **upserts every listed row and deletes nothing**, so a code once named stays named. A sub-operator the list files under an unexpected parent is stored as given.

## 4. Resolving a code

Used for the search's grid operator and for all four party codes of the popup: read the table for every code at once; for each miss that is not in the not-found cache, ask the single-code endpoint (four at a time, HTTP only); a 404 is cached as "not found" for a day; a failure leaves the name unknown this time and is cached for 5 minutes; then, after every call has finished, write the found rows with one upsert. A code still unknown is shown with "name not known" / "naam onbekend". A supplier code costs one call per host per day, not one per popup.

## 5. What it does not name

Suppliers, balance responsible parties and metering responsible parties: the service names grid operators only, so most of those show as codes. There is no other name list.

## 6. The Simulated provider

The list holds `8716904000009` Enexis Maastricht (under Enexis `8712423014022`), `8716871000002` Liander, `8716892000005` Stedin Netbeheer and `8712423014022` Enexis B.V. The single-code lookup also knows `8719999000022` Simulatienet Proefdorp, which is not in the list, so "asked once and stored" runs. Every other code is not found, so the supplier `8719328011804` reads "name not known".
