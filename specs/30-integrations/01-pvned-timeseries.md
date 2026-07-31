# Integration — PVNed TimeSeries

**Direction:** inbound push · **Protocol:** SOAP/XML over HTTPS · **Criticality:** highest

Written against three PVNed source documents: `TimeSeriesDocument-v2p0.xsd` (schema version 2.0.1),
the *PVNED Timeseries Document Implementation Guide* v2.2, and the sample
`CustomerImbalanceReport.json`.

> Those files are **not** in this repository — they are PVNed's copyright and not ours to
> redistribute. This document restates everything the platform needs from them: the document
> structure, the code lists, the interval mapping, the validation rules, a reconstructed sample, and
> the discrepancies found between the three (§9). Request the originals from PVNed and drop them in
> `specs/pvned_docs/` if you want them alongside.

---

## 1. Overview

PVNed pushes `TimeSeriesDocument` messages to a PeakPower endpoint. Two document categories matter:

| Category | `DocumentType` | `ProcessType` | Content |
| --- | --- | --- | --- |
| **Allocations / realisations** | `A23` | `A05` (metered data aggregation) or `A16` (realized) | Per-EAN consumption and production, 15-minute, kWh |
| **Imbalance report** | `A12` | `A06` (imbalance settlement) | Portfolio-level prognosis, realisation, imbalance volume and imbalance prices |

Namespace: `http://www.pvned.eu/CustomerIntegrations/External/v2p0`

```mermaid
sequenceDiagram
    participant P as PVNed
    participant W as PeakPower webhook
    P->>W: TimeSeriesDocument (SOAP)
    W-->>P: SOAP response (optional)
    W-->>P: HTTP response (optional)
```

The guide's own sequence diagram shows both responses as optional, which means **PeakPower must
confirm what PVNed actually expects and how it treats a non-2xx** — that determines the retry
behaviour the platform depends on. **[OQ-05]**

## 2. Timing

| Aspect | Behaviour |
| --- | --- |
| First data for delivery date D | Arrives from **D+1** |
| Corrections | Up to **10 working days** after D |
| Document revision | **Never.** Each send is a new GUID, `DocumentVersion` = 1, new `CreatedDateTime` |
| Authoritative version | *"The latest and greatest received document provides actual generation and load or forecast data"* — the most recently **received** document wins |
| Finalisation | PeakPower marks a date `FINAL` after 10 working days with no newer document **[F02-R23]** |

That the version number is always 1 is the reason ordering must be on **receipt time**, not on
`DocumentVersion` and not on `CreatedDateTime` **[F02-R17]**.

## 3. Document structure

```mermaid
classDiagram
    class TimeSeriesDocument {
        DocumentIdentification : string(36)
        DocumentVersion : integer  0..1
        DocumentType : A23 | A12 | A01
        ProcessType : A05 | A06 | A14 | A16 | A24
        SenderIdentification : GLN-13
        ReceiverIdentification : GLN-13
        CreatedDateTime : dateTime
        ReportPeriode : TimeInterval
        OrderId : string  0..1
        OrderVersion : integer  0..1
    }
    class TimeSeries {
        mRID : string(36)
        BusinessType : code
        ResourceProvider : string  0..1
        BiddingZoneDomain : 10YNL----------L  0..1
        MeasurementPeriode : TimeInterval
        Direction : A01|A02|A03  0..1
        MeasurementUnit : KWH|MWH|KWT|MAW
        CurrencyUnit : string  0..1
        CurveType : A01
    }
    class Resource {
        ResourceObject : string(18)  0..1
        RecourceName : string  0..1
    }
    class Period {
        TimeInterval
        Resolution : PT15M | PT60M
        ProfileCategory : 0..1
        ProfileType : 0..1
        AllocationGroup : TMT|SMA|PRF|NVL|DIM  0..1
        Origin : MSR|UMS|CLC|NMS  0..1
    }
    class Point {
        Pos : 1..100
        Qty : decimal  0..1
        Qty2 : decimal  0..1
        Price : decimal  0..1
    }
    class Reason {
        Code : code
        Text : string(512)  0..1
    }

    TimeSeriesDocument "1" --> "0..*" TimeSeries
    TimeSeriesDocument "1" --> "0..*" Reason
    TimeSeries "1" --> "0..1" Resource
    TimeSeries "1" --> "0..*" Period
    TimeSeries "1" --> "0..*" Reason
    Period "1" --> "1..*" Point
```

> `RecourceName` is spelled that way in the schema. It is a typo in the source, it is normative, and
> the platform must send and expect it exactly as-is. Do not "fix" it in a mapping.

## 4. Code decoding

### 4.1 Direction

| Code | Meaning | Platform mapping |
| --- | --- | --- |
| `A01` | Production | `PRODUCTION` |
| `A02` | Consumption | `CONSUMPTION` |
| `A03` | Combined production and consumption | Rejected — the platform requires separated series **[AS-05]** |
| `A04` | Not used yet | Rejected |

### 4.2 BusinessType (the codes that appear in practice)

| Code | Meaning | Where seen |
| --- | --- | --- |
| `A01` | Production | Allocation |
| `A04` | Consumption | Allocation |
| `A02` | *(sample uses this for `Realisation`)* | Imbalance report |
| `A07` | Net production / consumption | Allocation |
| `A14` | Aggregated energy data — used for `Prognosis` in the sample | Imbalance report |
| `A20` | Imbalance volume | Imbalance report |
| `B23` | Consumption imbalance price | Imbalance report |
| `B24` | Production sales imbalance price — `Imbalance price negative` in the sample | Imbalance report |
| `B25` | Production purchase imbalance price — `Imbalance price positive` in the sample | Imbalance report |
| `N101`…`N142` | Allocation variants (TMT, SMA, PRF, NVL, DIM, aggregated per LV) | Allocation |

The full list is in the guide §5.5.2 and the XSD enumeration. **The platform must not hard-code an
exhaustive match**: it handles the codes it knows, and quarantines anything else with an alert rather
than discarding it.

### 4.3 MeasurementUnit

| Code | Meaning |
| --- | --- |
| `KWH` | Kilowatt hour |
| `MWH` | Megawatt hour |
| `KWT` | Kilowatt |
| `MAW` | Megawatt |

The dependency table specifies `KWH` for allocations and `KWT`/`MWH` for imbalance. **The sample
disagrees**: it uses `KWH` for `A14`, `A02` and `A20`, and `MWH` for `B24` and `B25`. The platform
therefore reads the unit from the message and converts, rather than assuming — and logs a warning
when the unit is not the one the dependency table predicts.

### 4.4 `ResourceObject`

| Value shape | Meaning | Handling |
| --- | --- | --- |
| 18 digits | Metering point EAN (GLN-18) | Resolve to a metering point **[AS-17]** |
| Free text ≤ 18 chars | A descriptive label: `Prognosis`, `Realisation`, `Imbalance`, `Imbalance price negative`, `Imbalance price positive` | Portfolio-level series, stored in the imbalance tables |

Discrimination is on "is it 18 digits", exactly as the guide §5.6.1 describes.

## 5. Interval mapping

```
Pos = 1   →  local 00:00 – 00:15 on the delivery date
Pos = n   →  local start = midnight + (n − 1) × 15 min, in Europe/Amsterdam
```

| Day type | `Pos` range | Note |
| --- | --- | --- |
| Normal | 1 – 96 | |
| Spring forward (last Sunday in March) | 1 – **92** | 02:00–03:00 local does not exist |
| Autumn fall back (last Sunday in October) | 1 – **100** | 02:00–03:00 local occurs twice; `Pos` 9–12 are the first pass, 13–16 the second |

The XSD caps `Pos` at 100 precisely for the autumn day. The delivery date is derived from
`MeasurementPeriode.StartPeriod` converted to `Europe/Amsterdam` — in the sample,
`2024-12-27T23:00:00Z` is midnight on **28 December 2024** local, so the delivery date is
`2024-12-28`.

**Conversion is always via the local calendar, never by adding a fixed offset.**

## 6. Sample document

Reconstructed in XML from the supplied JSON sample, in schema element order:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <TimeSeriesDocument xmlns="http://www.pvned.eu/CustomerIntegrations/External/v2p0">
      <DocumentIdentification>8ff18bca-9e80-41aa-bd9f-3202f2fcc6c8</DocumentIdentification>
      <DocumentVersion>1</DocumentVersion>
      <DocumentType>A12</DocumentType>
      <ProcessType>A06</ProcessType>
      <SenderIdentification>8714252005776</SenderIdentification>
      <ReceiverIdentification>8712423456789</ReceiverIdentification>
      <CreatedDateTime>2025-01-14T15:15:05Z</CreatedDateTime>
      <ReportPeriode>
        <StartPeriod>2024-12-27T23:00:00Z</StartPeriod>
        <EndPeriod>2024-12-28T23:00:00Z</EndPeriod>
      </ReportPeriode>

      <TimeSeries>
        <mRID>3e09aa9e-5013-4b32-8305-f9e6c4430614</mRID>
        <BusinessType>A20</BusinessType>
        <MeasurementPeriode>
          <StartPeriod>2024-12-27T23:00:00Z</StartPeriod>
          <EndPeriod>2024-12-28T23:00:00Z</EndPeriod>
        </MeasurementPeriode>
        <Direction>A01</Direction>
        <MeasurementUnit>KWH</MeasurementUnit>
        <CurrencyUnit>EUR</CurrencyUnit>
        <CurveType>A01</CurveType>
        <Resource>
          <RecourceName>Imbalance</RecourceName>
        </Resource>
        <Period>
          <TimeInterval>
            <StartPeriod>2024-12-27T23:00:00Z</StartPeriod>
            <EndPeriod>2024-12-28T23:00:00Z</EndPeriod>
          </TimeInterval>
          <Resolution>PT15M</Resolution>
          <Point><Pos>1</Pos><Qty>0</Qty><Price>-30.81</Price></Point>
          <Point><Pos>2</Pos><Qty>0</Qty><Price>-28.51</Price></Point>
          <!-- … through Pos 96 … -->
        </Period>
      </TimeSeries>
      <!-- further TimeSeries: A14 Prognosis, A02 Realisation, B24/B25 imbalance prices -->
    </TimeSeriesDocument>
  </soap:Body>
</soap:Envelope>
```

## 7. Mapping to the platform model

### 7.1 Allocation documents (`A23`)

| PVNed | Platform |
| --- | --- |
| `Resource.ResourceObject` (18 digits) | `metering_point.ean` |
| `MeasurementPeriode.StartPeriod` → Amsterdam date | `interval_data_version.delivery_date` |
| `Direction` `A01`/`A02` | `interval_data_version.direction` |
| `DocumentIdentification` | `interval_data_version.document_id` |
| `CreatedDateTime` | `interval_data_version.document_created` |
| Receipt timestamp | `interval_data_version.received_at` — **the ordering key** |
| `Point.Pos` | `interval_reading.pos` |
| `Point.Qty` (+ unit conversion) | `interval_reading.quantity_kwh` |
| `Point.Qty2` | Not used — see §9 |

### 7.2 Imbalance documents (`A12`)

| Series | Platform target |
| --- | --- |
| `A14` / `Prognosis` | `imbalance_reading.prognosis_kwh` per direction |
| `A02` / `Realisation` | `imbalance_reading.realisation_kwh` per direction |
| `A20` / `Imbalance` | `imbalance_reading.volume_kwh` and `settlement_price` per direction |
| `B24` / `Imbalance price negative` | `imbalance_price.negative_price` |
| `B25` / `Imbalance price positive` | `imbalance_price.positive_price` |

Stored at portfolio level **[AS-18]**; allocation to EANs is [OQ-15].

## 8. Validation

### 8.1 Structural

1. Well-formed XML; SOAP envelope present.
2. **XSD validation** against the pinned `TimeSeriesDocument-v2p0.xsd`.
3. **DTD processing and external entity resolution disabled** — mandatory for any XML endpoint
   ([Security](../20-architecture/07-security.md) §4.1).

### 8.2 Semantic

| Rule | Failure |
| --- | --- |
| `DocumentType`/`ProcessType` is a handled combination | `UNSUPPORTED_DOCUMENT_TYPE` |
| `ReceiverIdentification` is PeakPower's own GLN | `WRONG_RECEIVER` |
| `SenderIdentification` is the expected PVNed GLN | `UNKNOWN_SENDER` |
| `Resolution` = `PT15M` | `UNSUPPORTED_RESOLUTION` |
| `CurveType` = `A01` | `UNSUPPORTED_CURVE_TYPE` |
| `MeasurementPeriode` covers exactly one Amsterdam calendar day | `INVALID_MEASUREMENT_PERIOD` |
| Point count equals the expected interval count (92/96/100) for that date | `INCOMPLETE_PERIOD` |
| `Pos` values contiguous from 1, no duplicates | `INVALID_POSITIONS` |
| `Qty` ≥ 0 | `NEGATIVE_QUANTITY` |
| `ResourceObject` resolves to a registered metering point valid on that date | `UNKNOWN_METERING_POINT` → **quarantine, not reject** |

Failures mark the message `FAILED` with the code, raise an alert, and apply nothing — a document
lands whole or not at all **[F02-R13]**.

## 9. Documentation inconsistencies found

Reviewing the XSD, the guide and the sample against each other surfaced the following. **These should
be raised with PVNed before implementation** — each one is a place where a reasonable implementer
could guess wrong. **[OQ-65]**

| # | Field | Guide | XSD | Sample | Recommended handling |
| --- | --- | --- | --- | --- | --- |
| 1 | `DocumentIdentification` | max **35** chars | `maxLength 36` | 36-char GUID | Accept 36; a GUID does not fit in 35 |
| 2 | `Sender`/`ReceiverIdentification` | GLN-13, max **13** | `maxLength 16` | 13 digits | Validate as 13 digits; accept up to 16 |
| 3 | `Pos` | max **6** characters | `maxInclusive 100` | 1–96 | Enforce the XSD bound of 100 |
| 4 | `Qty` max value | §5.8.2 says **9999,999**; Annex A says **9999.000** | unbounded `xs:decimal` | max observed 2 164 | 9 999 kWh per 15 min is only ≈ 40 MW average — reachable by a very large connection. **Do not enforce this as a hard cap**; validate plausibility against the metering point's capacity and alert instead of rejecting. Confirm with PVNed whether it is a real limit |
| 5 | `MeasurementUnit` for imbalance | dependency table says `KWT` / `MWH` | enum includes `KWH` | `KWH` for A20/A14/A02 | Read from the message, convert, warn on the unexpected |
| 6 | Annex A validations | reference `DocumentType` `A67`/`A26`, `ProcessType` `A14`/`A33`, `MeasurementUnit` `MAR` | none of these exist in this XSD | — | Annex A describes the **customer → PVNed** direction and does not apply to inbound processing. Confirm |
| 7 | `Period.TimeInterval` | must sit within `MeasurementPeriode` | — | **Contradicts it** — sample shows `2024-11-30T23:00 → 2024-12-27T23:00` against a one-day `MeasurementPeriode` | Treat `MeasurementPeriode` + `Pos` as authoritative; log the discrepancy. **[OQ-20]** |
| 8 | `Qty2` | "the same value for the previous year" | optional | absent | Not used by the platform |
| 9 | `CurveType` `A03` | listed as permitted in §5.5.11 | enum allows only `A01` | `A01` | Reject `A03` |

Item 7 is the one that would silently corrupt data if implemented naively: an implementer who trusts
`Period.TimeInterval` to place the points would write a month's worth of intervals to the wrong dates.

> The sample is an **imbalance** report, so items 4, 5 and 7 are observed in that context. Whether the
> same quirks appear in allocation documents is unknown until real allocation traffic is seen — which
> is itself an argument for storing every raw payload from day one **[DEC-03]**.

## 10. Error handling & operations

| Situation | Behaviour |
| --- | --- |
| Auth failure | `401`, logged, alert on repetition |
| Payload too large | `413` |
| Malformed HTTP / storage failure | `5xx` so PVNed retries — the only case where failing loudly is right |
| Stored but invalid | `200` to PVNed, message `FAILED`, alert, manual replay after fix |
| Unknown EAN | `200`, series quarantined, alert |
| Duplicate payload within 24 h | `200`, marked `DUPLICATE`, not reprocessed |

Replay is available to admins **[F02-R27]** and is idempotent.

## 11. Testing

Since a PVNed test environment may not exist **[OQ-05]**, the `DevStubs` project
([Solution structure](../20-architecture/02-solution-structure.md) §4.1) must be able to generate:

- a normal 96-interval allocation day with a realistic load shape, for many EANs;
- 92- and 100-interval DST days;
- a correction superseding an earlier document;
- an imbalance report matching the supplied sample exactly;
- one deliberately invalid document per validation rule in §8.2;
- a document with an unknown EAN;
- an out-of-order pair (later `CreatedDateTime` received first);
- a 25 MB document, for the size limit.

## 12. Open questions

| Ref | Question |
| --- | --- |
| [OQ-05] | Endpoint URL and authentication; is a SOAP acknowledgement expected and in what format; retry policy on non-2xx; is there a test environment? |
| [OQ-15] | Can PVNed supply imbalance data per EAN rather than per portfolio? |
| [OQ-20] | How should the `Period.TimeInterval` inconsistency be interpreted? |
| [OQ-21] | Message volume and cadence — one document per EAN per day, or batched across EANs? |
| [OQ-65] | Walk through the inconsistencies in §9 with PVNed and confirm the intended behaviour |
| [OQ-66] | Does PVNed also supply reconciliation data after the 10-working-day window, and should it be ingested? |
