# Integration — EDSN connection register (search and master data)

**Direction:** outbound, on demand · **Protocol:** REST, JSON over HTTPS · **Criticality:** high: no customer can add a connection without it, and staff attach an unconfirmed EAN only through the typed fallback

> **As built 2026-10-16 by [DEC-182] (3), (4), (7), on `feature/ean-search`; not on the VM until the landing.** PeakPower asks EDSN, the Dutch central connection register, what it knows about a connection: by its EAN, or by postcode, house number and extension (search), and for the latest master-data update of an electricity connection. The platform alone makes the calls, never a browser. The service PeakPower calls is a **preprod proof of concept** run in front of EDSN; who owns it, what it promises, its production address and whether a processor agreement is needed are [OQ-119]. **Checked 2026-10-16 against `EdsnOptions.cs` and the clients (platform `0c17204`):** every setting and default below is the code's, and the names of the settings and tables stand.

## 1. The requests

| What | Request |
| --- | --- |
| Search by EAN | `GET {Edsn:BaseUrl}/edsn/api/search/meteringpoints?ean={ean}` |
| Search by address | `GET {Edsn:BaseUrl}/edsn/api/search/meteringpoints?zipcode={postcode}&housenumber={number}&housenumberextension={extension}` (the number and the extension sent apart; the extension omitted when there is none) |
| Master data | `GET {Edsn:BaseUrl}/edsn/api/masterdata/updates?ean={ean}` |

**Paging of master data.** The endpoint was probed on 2026-10-15: it ignores `pageNumber`, `page`, `itemsPerPage` and `pageSize` and always answers page 1 with up to 100 items and the reply's `header.maximumPages`. The platform therefore reads page 1, and asks for further pages only when `maximumPages` is more than 1, with the page parameter in `Edsn:MasterDataPageParameter` (default `pageNumber`, an assumption). If a reply's `header.pageNumber` is not the page asked for, it stops with a warning naming the parameter and records the fetch as incomplete (`pages_complete` false); it also stops at `Edsn:MaxMasterDataPages`. The latest item is then chosen from what was read.

## 2. Settings

| Setting | Env | Default |
| --- | --- | --- |
| `Edsn:BaseUrl` | `Edsn__BaseUrl` (compose `EDSN_BASE_URL`) | `https://ke-edsn-rest-api-poc-preprod-813732417868.europe-west4.run.app`, the product owner's address; absolute http or https |
| `Edsn:Provider` | `Edsn__Provider` | empty; `Simulated` is set by `./dev-up`, the tests and e2e |
| `Edsn:RequestTimeout` | — | 8 seconds, one attempt |
| `Edsn:MaxAttempts` | — | 2, counting the first; only 429, 5xx, a timeout and a network error are retried |
| `Edsn:RetryBaseDelay` | — | 300 milliseconds ⚠ as built 2026-10-16; a `Retry-After` of seconds or an HTTP date is honoured up to 5 seconds |
| `Edsn:MasterDataPageParameter` | — | `pageNumber` |
| `Edsn:MaxMasterDataPages` | — | 20 |
| `Edsn:MaxMasterDataFetchesPerSearch` | — | 10 electricity results per search |
| `Edsn:MasterDataFetchConcurrency` | — | 4 |
| `Edsn:MasterDataRecentWindow` | — | 5 minutes; 0 restores the literal reading of "fetched when a search returns" |

All of them are documented in `deploy/env.example`. The HTTP client factory's logger and the service defaults' resilience handler are removed from this client: URLs carry a postcode and house number, which is personal data for a household, and the client owns its retry and timeout so retries do not stack.

## 3. The response

JSON is read case-insensitively: three casings meet in one reply, and a number may arrive as a string. A missing member is null, never an error.

- **Search reply.** The results sit in `searchResults` (or a bare array). The envelope's `header` is never passed on (its message id is logged at debug for support). Per result: the EAN, product type, market segment, grid area, grid operator code (the name in the reply is always empty and ignored), and the address (street, building number, extension, postcode, city, country, BAG id). The reply carried no extension key for an address without one, so the extension of an address match prefers the master data's; ⚠ **as built 2026-10-16:** the parser reads `exBuildingNr` and `houseNumberExtension`, names that no live reply has confirmed (§8). A result whose EAN is not 18 digits is dropped with a warning. Results are ordered ELK first, then by market segment, then by EAN.
- **Master-data reply.** `header.pageNumber`, `header.maximumPages`, `header.totalItems`, and `items[]`; each item has `id`, `receivedDate`, `mutationDate`, `mutationType`, `dossierId`, `externalReference` (absent on most items) and `updateData`, a JSON string.
- **`updateData`.** The nested shape: the top-level fields (EAN, product type, market segment, grid area, grid operator), the address block with the BAG id, the commercial block (supplier, balance responsible party and metering responsible party, each an object with an `ID` that may be null), the physical block (allocation method, delivery status, flow direction, metering method, physical status, profile category, contracted and physical capacity, and the four yearly figures), the metering-point group (kept as raw text; its shape is unknown), and the mutation (`Portaal_Mutation`, spelled with a double a as the live item carries it, accepted also as `Portal_Mutation`; null in every sample, so its shape is unconfirmed). A string that is not JSON returns no facts and a warning, and never fails the request.
- **The 404 split.** A 404 whose body parses as JSON with a results member is "no results"; any other 404 body (an HTML page, a wrong base URL) is "unavailable" with an error log naming the path. Without the split a wrong base URL would read as "nothing found" for ever.

## 4. Storage

Each EAN a search, an attach, a popup or the backfill meets gets one row in `metering.connection_master_data` ([database design](../20-architecture/04-database-design.md) §3.2.2): the search hit; the chosen item's raw `updateData` verbatim with its id, mutation date, mutation type, dossier id, received date and external reference; the parsed facts; the item count; whether every page was read; and the coordinates of one address. **The latest item** is the one with the latest `mutationDate` on or before today in Amsterdam, ties to the later `receivedDate`, then the higher `id`, chosen by date alone: when its `updateData` cannot be read it is still the latest, and the popup shows only the search fields with a notice. **The 24-hour rule:** a popup refetches a copy whose last successful fetch is older than 24 hours, and serves the stored copy, saying so, when EDSN cannot be reached. Nothing is purged ([OQ-122]).

## 5. When it is called

| When | What is asked | If EDSN fails |
| --- | --- | --- |
| A search returns | The search itself; then master data for at most 10 electricity results not fetched within 5 minutes, in parallel, one attempt each | The search answers 503 (`connection-search-unavailable`). A master-data failure is logged and ignored; the result shows no summary |
| An attach (customer or staff) | The search by EAN, then master data again | A customer add is refused with the 503; a staff attach answers the typed-fallback confirmation (`NOT_FOUND`, `UNAVAILABLE` or `NOT_CONFIGURED`) |
| A popup opens | The search by EAN when no hit is stored; master data when the copy is stale | The stored copy with "could not refresh", or "not available" when nothing is stored; never a 503 |
| The staff backfill | Search and master data for the EANs of open connections, oldest fetch first | Counted as failed; the run goes on |

A request on the request path can wait about 25 seconds in the worst case (two attempts of 8 seconds on the search, then up to one attempt on master data); it holds its database connection for that time, which the lookup rate limit bounds.

## 6. What reads it

The customer API reads master data through exactly three routes: the details of a connection held today, and the eligibility check and the add after the full proof of [DEC-182] (5). The employee API reads it for any EAN. Gas is never fetched. A search answer carries only the register's result fields. See [API contracts](../20-architecture/05-api-contracts.md) §2.1A and §3.5.

## 7. The Simulated provider

Used by `./dev-up`, the tests and e2e; its data is fictional (`Simulatiestraat 1, 9999AA PROEFDORP`, BAG `9999010000000001`). It skips HTTP but builds `updateData` as a nested JSON string and runs it through the same parser and the same latest-item rule as the live service.

| Input | Result |
| --- | --- |
| search `9999AA 1` | `871999000000000018` ELK GVB (addable), `871999000000000025` ELK KVB, `871999000000000032` GAS KVB |
| search `9999AA 2` | `871999000000000049` ELK GVB with no master data |
| `871999000000000018` master data | Three items over two pages; a future-dated item that is never chosen, and two with the same mutation date (2026-01-15) of which the later received one is the latest: supplier `8719328011804`, BRP `8714252005776`, metering responsible party `8719999000008`, 56 kW, 173 kVA, TMT, E3A, yearly 41067 and 41145 consumption and 0 and 0 feed-in, LVR, ACT, IBD |
| any EAN starting `8719991` | ELK GVB at Simulatiestraat 1, one master-data item, BRP `8714252005776`: addable by a company at that address |
| any EAN starting `8719992` | The same, but EDSN's BRP is `8719999000015`: the BRP-warning family |
| any EAN starting `8719993` | The search works and master data is always unreachable |
| `871999000000000094`, or address `9999ZZ` | EDSN unreachable (503) |
| anything else | No results |

## 8. Open

The service is a preprod proof of concept: its owner, its production address and a processor agreement are [OQ-119]. The page parameter's real name (still not found), whether the search carries the extension, and whether an empty extension matches every suffix are answered, or left open with their owner, in [database design §7.13](../20-architecture/04-database-design.md). EDSN returns household addresses and supplier data for small-scale connections; retention is [OQ-122].
