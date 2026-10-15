# Integration — Pro6pp address suggestions

**Direction:** outbound, per keystroke, through the platform · **Protocol:** REST, JSON over HTTPS · **Criticality:** low: search by a full postcode and number, and by EAN, works without it

> **Specified 2026-10-15 by [DEC-182] (3), (4).** Pro6pp is a Dutch postcode service. The search box of both portals asks the platform for address suggestions while a postcode and house number are typed; the platform asks Pro6pp and answers a short list. A browser never calls Pro6pp, because the call carries the key. The key is a secret the product owner sets later. Nothing here is built yet.

## 1. The two requests

| What | Request |
| --- | --- |
| Postcode suggestions | `GET {Pro6pp:BaseUrl}/v2/suggest/nl/postalCode?authKey=…&postalCode={partial}&maxResults=10` |
| Address suggestions | `GET {Pro6pp:BaseUrl}/v2/suggest/nl/streetNumberAndPremise?authKey=…&postalCode={postcode}&streetNumberAndPremise={token}&maxResults=10` (the token omitted when empty) |

Which input asks which (whitespace removed, upper case):

| Input | Kind | Call |
| --- | --- | --- |
| Seven or more digits only (an EAN being typed), or nothing recognisable | `NONE` | none |
| A partial postcode of 2 to 5 characters | `POSTCODE` | postcode suggestions |
| A full postcode followed by a house-number token | `ADDRESS` | address suggestions with the token |
| A full postcode alone | `ADDRESS` | address suggestions without a token, which lists the house numbers |

The postcode must match `^[1-9][0-9]{3}[A-Za-z]{2}$` and the house-number token `^[0-9][0-9A-Za-z\-\+]*$`.

## 2. Settings and the secret key

| Setting | Env | Default |
| --- | --- | --- |
| `Pro6pp:BaseUrl` | `Pro6pp__BaseUrl` (compose `PRO6PP_BASE_URL`) | `https://api.pro6pp.nl`; the paths above carry `/v2` |
| `Pro6pp:AuthKey` | `Pro6pp__AuthKey` (compose `PRO6PP_AUTH_KEY`) | empty; **a secret** |
| `Pro6pp:Provider` | `Pro6pp__Provider` | empty; `Simulated` is set by `./dev-up`, the tests and e2e |
| `Pro6pp:RequestTimeout` | — | 3 seconds, no retry: the next keystroke is the retry |
| `Pro6pp:MaxAttempts` | — | 1 |
| `Pro6pp:MaxResults` | — | 10 |
| `Pro6pp:CoordinateCacheDuration` | — | 30 minutes |

With the key empty the answer is `available: false` with the reason `NOT_CONFIGURED`, and everything else works. The product owner puts the key in the VM's `.env` as `PRO6PP_AUTH_KEY` when they have it.

## 3. The response and its statuses

A 200 is a root array, read case-insensitively. Postcode suggestions carry `postalCode`, `settlement` and `municipality`; address suggestions carry `postalCode`, `street`, `streetNumberAndPremise`, `settlement`, `lat` and `lng`. A 404 is "no results found" and is an empty list. A 401 means Pro6pp refused the key: suggestions are unavailable and one line is logged at most once a minute. A 429, a 5xx and a timeout are unavailable. The platform answers 200 with `available: false` in every unavailable case, never an error per keystroke. Pro6pp's cursor link is never followed.

## 4. What is kept

The coordinates of each address suggestion are remembered in memory for 30 minutes, keyed by the normalised postcode, house number and extension. An address search for the same address writes them onto each result's master-data row with the address they belong to, and the popup shows them as GPS only while that address is the one it shows. The client never sends coordinates. A search by EAN, or an address typed without picking a suggestion in that time, leaves GPS as "—". Coordinates are never returned in a suggestion.

## 5. Redaction

The key is a query parameter, so it is a secret in a URL. Five rules keep it out of everything: own log lines are redacted of `authKey=` and of the key's value, raw and escaped, and name the operation and the status, never the query; the HTTP client factory's logger is removed; an outbound exception is replaced, never wrapped, by one with a redacted message and no inner exception, so nothing that could hold the URL reaches an unhandled-exception log; `IsTraceable` returns false for a URL with `authKey=`, so no span and no exported URL; and no DTO carries a URL or a header. The key is registered as no service and stored only on the options singleton the client reads, whose `ToString()` prints `***`; in compose it is a secret parameter with no value.

## 6. The Simulated provider

Postcode suggestions `9999AA` and `9999AB` (settlement Proefdorp) for any partial input that is a prefix of them. Address suggestions for `9999AA`: `1`, `1A` and `2`, filtered by the typed token's prefix, with fictional coordinates; for `9999AB`: `5`. Postcode `9999ZZ` is unavailable. Everything else is empty, as Pro6pp's 404.
