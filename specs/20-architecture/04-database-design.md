# Database Design

PostgreSQL 17. One database, schema-per-module, declarative partitioning on the interval tables.

---

## 1. Schemas

| Schema | Contents |
| --- | --- |
| `customer` | customer companies, **accounts**, metering points, labels |
| `metering` | inbound messages, interval data versions, readings, imbalance, data state |
| `market` | peak calendars, calendar intervals, price indications, day-ahead prices |
| `trading` | trades, lines, offers, events, blocks, allocations, **four-eyes thresholds [DEC-33]** |
| `wallet` | wallets, entries, reservations, payments |
| `billing` | surcharges, **feed-in tariffs [DEC-44]**, tax tariffs, invoice runs, invoices, sections, lines, credit notes |
| `audit` | generic audit records, internal notes |
| `hangfire` | Hangfire's own tables |

Schema boundaries mirror the module boundaries. Cross-schema foreign keys exist only where the module
graph permits, and an integration test asserts that.

## 2. Sizing

| Table | Rows per year | Driver |
| --- | --- | --- |
| `metering.inbound_message` | **~36 500 per 100 metering points** | 100 × 365 — **one document per EAN per day [DEC-38]** — plus corrections |
| `metering.interval_reading` | **≤ ~3.5 M per 100 metering points** | 100 × 365 × 96 × 2 directions. An **upper** bound: a connection that never produces has no `A01` series at all **[DEC-65]** |
| `metering.interval_data_version` | ≤ ~73 000 per 100 points | 100 × 365 × 2, more with corrections, fewer wherever production is absent **[DEC-65]** |
| `market.calendar_interval` | 35 040 | 365 × 96 |
| `market.day_ahead_price` | 35 040 | Per market area |
| `wallet.wallet_entry` | Thousands | Trades, invoices, payments |
| `trading.trade_event` | Tens of thousands | ~8 events per trade; ~9 where a trade passes through `AWAITING_APPROVAL` **[DEC-33]** |
| `billing.invoice_line` | ~30 000 per 100 points | 100 × 12 × ~25 lines, plus one feed-in line per exporting EAN per rate period **[DEC-44]** |

At 500 metering points that is roughly 17 M interval rows a year — comfortable for PostgreSQL with
monthly partitions. **[DEC-09]** holds until the metering-point count reaches four digits.

### 2.1 Ingestion shape — [DEC-38]

**PVNed sends one document per EAN per day.** That is many small documents rather than one daily
batch: it raises the document count by two orders of magnitude and lowers the size of each by the
same, which changes the *shape* of the ingestion load without changing its total.

| Figure | Value |
| --- | --- |
| Documents per day | **1 per metering point** — 100 points → 100/day; 500 points → 500/day; ~182 500/year at 500 points |
| Series per document | 1 or 2 — `A02` consumption always, `A01` production **only where the connection produces [DEC-65]** |
| Points per series | 96, or 92 / 100 on a DST day |
| Payload size | Tens of kilobytes. Three orders of magnitude below the 25 MB cap **[F02-R06]**, which now guards against a pathological payload rather than sizing the normal one |
| Rows written per document | ≤ 192 `interval_reading`, 1–2 `interval_data_version`, 1 `inbound_message` |

**The per-(metering point, delivery date) mutex is the natural unit of concurrency.** One document is
now exactly one mutex key ([Background jobs](06-background-jobs.md) §7, §5 below), so ingestion
parallelises up to the number of metering points with no coordination beyond the key, and two workers
contend only when one document corrects another — which is the single case the mutex exists for. A
daily batch would have made a whole day's data one unit of work; per-EAN documents make it *N*
independent ones, and the `ingestion` queue's 8 workers are the only limit.

⚠ **Document count is a rate-limit input, not only a storage one.** 500 metering points means 500
inbound requests inside whatever window PVNed pushes in. The webhook rate limit in
[Security](07-security.md) §4.1 has to be sized against the metering-point count rather than left at
a default.

## 3. Core tables

### 3.1 Customer

```sql
-- The customer IS a company.
CREATE TABLE customer.customer (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_name          text NOT NULL,
    trade_name          text,
    kvk_number          char(8) NOT NULL CHECK (kvk_number ~ '^[0-9]{8}$'),
    vat_number          text,
    -- bank details, used for refunds and for matching incoming transfers  [OQ-79]
    iban                text CHECK (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
    bic                 text CHECK (bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
    bank_account_holder text,
    status              text NOT NULL
        CHECK (status IN ('PROSPECT','ACTIVE','SUSPENDED','CLOSED')),
    billing_address     jsonb NOT NULL,
    visiting_address    jsonb,
    primary_contact     jsonb NOT NULL,
    internal_reference  text,
    locale              text NOT NULL DEFAULT 'nl-NL',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_customer_kvk_active
    ON customer.customer (kvk_number) WHERE status <> 'CLOSED';

-- One person's login at one company. Several per company; all equal  [DEC-16].
CREATE TABLE customer.customer_account (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         uuid NOT NULL REFERENCES customer.customer(id),
    username            citext NOT NULL,
    first_name          text NOT NULL,
    last_name           text NOT NULL,
    job_title           text,                    -- "role in the company" — descriptive only
    email               citext NOT NULL,
    phone               text,
    status              text NOT NULL
        CHECK (status IN ('INVITED','ACTIVE','DEACTIVATED')),
    external_subject_id text,                    -- IdP `sub`, set when the invitation is accepted
    created_by_employee text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    activated_at        timestamptz,
    deactivated_at      timestamptz,
    last_login_at       timestamptz,

    -- no role / permission column, deliberately  [DEC-16]
    CHECK (status <> 'ACTIVE' OR external_subject_id IS NOT NULL),
    CHECK (status <> 'DEACTIVATED' OR deactivated_at IS NOT NULL)
);

-- Usernames are unique across the whole platform, not per company
CREATE UNIQUE INDEX ux_account_username ON customer.customer_account (username);
CREATE UNIQUE INDEX ux_account_subject
    ON customer.customer_account (external_subject_id) WHERE external_subject_id IS NOT NULL;
CREATE INDEX ix_account_customer ON customer.customer_account (customer_id) WHERE status = 'ACTIVE';

CREATE TABLE customer.metering_point (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ean            char(18) NOT NULL CHECK (ean ~ '^[0-9]{18}$'),
    commodity      text NOT NULL CHECK (commodity IN ('ELECTRICITY','GAS')),
    customer_id    uuid NOT NULL REFERENCES customer.customer(id),
    validity       daterange NOT NULL,
    grid_operator  text,
    capacity_kw    numeric(12,3),
    address        jsonb,
    name           text,
    description    text,
    created_at     timestamptz NOT NULL DEFAULT now(),

    -- Does this connection produce?  [DEC-65]. PVNed sends no `A01` series at all for one that
    -- never does, so "both directions present" cannot be the completeness test.
    production_expectation        text NOT NULL DEFAULT 'UNKNOWN'
        CHECK (production_expectation IN ('UNKNOWN','NEVER','EXPECTED')),
    production_expectation_source text
        CHECK (production_expectation_source IN ('CONTRACT','GRID_OPERATOR','OBSERVED','MANUAL')),
    production_expectation_set_by text,
    production_expectation_set_at timestamptz,
    first_production_observed_at  timestamptz,

    -- one customer per EAN at any instant  [AS-03]
    EXCLUDE USING gist (ean WITH =, validity WITH &&),

    -- anything other than UNKNOWN is a claim, and a claim has an owner, a source and a date
    CHECK (production_expectation = 'UNKNOWN'
           OR (production_expectation_source IS NOT NULL
               AND production_expectation_set_by IS NOT NULL
               AND production_expectation_set_at IS NOT NULL)),

    -- observed production contradicts NEVER; the processor must resolve it, not log it
    CHECK (production_expectation <> 'NEVER' OR first_production_observed_at IS NULL)
);

CREATE INDEX ix_mp_customer ON customer.metering_point (customer_id)
    WHERE upper(validity) IS NULL OR upper(validity) > CURRENT_DATE;

-- the completeness job's driving set: the points where a missing A01 is a fault or an unknown,
-- never a fact  [DEC-65], [F02-R22], [F02-R26]
CREATE INDEX ix_mp_production_expected
    ON customer.metering_point (production_expectation, customer_id)
    WHERE production_expectation IN ('EXPECTED','UNKNOWN');
```

The `EXCLUDE` constraint is the important line. It makes "two customers own the same EAN at the same
time" a database-level impossibility rather than an application rule someone can forget.

#### 3.1.1 The production expectation — [DEC-65]

Without this column an ingestion failure on a producing connection is indistinguishable from a
connection that never produces. Under **[DEC-22]** that difference is a settlement figure, not a
chart: net usage is `consumption − production`, so a silently missing `A01` overstates net usage,
overstates the uncovered volume and over-bills the customer, on every interval, until someone
notices by eye.

**A nullable boolean is not sufficient** — it has the right cardinality and the wrong ergonomics.
`true` / `false` / `NULL` do map onto *expected* / *never* / *not established*, so the count of states
is not the objection. These four are:

| Problem with `expects_production boolean` | Consequence |
| --- | --- |
| The two-valued form, `NOT NULL DEFAULT false` | Makes the dangerous answer the default. Every point registered before anyone asked would assert "never produces", and the assertion is indistinguishable from a deliberate one |
| Three-valued SQL | `WHERE NOT expects_production` silently drops the `NULL` rows — precisely the ones that need looking at. `production_expectation = 'NEVER'` has no such trapdoor: the unknown case must be named to be included or excluded |
| No provenance | The flag decides whether an absent series is a fault or a fact, which makes it a claim with a source, an owner and a date — contract, grid operator, observation or a named person — not a checkbox. `[F09]`-style reference-data discipline, on a customer-master column |
| Cannot record its own contradiction | `first_production_observed_at` is what turns "we were told it never produces" into "and then it did". The `CHECK` makes that combination unstorable, so the ingestion transaction has to move the row to `EXPECTED`/`OBSERVED` rather than write a reading that disagrees with the master data |

The completeness test follows from the column rather than from the document:

| `production_expectation` | An absent `A01` for a delivery date means |
| --- | --- |
| `EXPECTED` | **Incomplete.** The date does not reach `PROVISIONAL` on consumption alone and `DetectMissingMeteringDataJob` alerts **[F02-R26]** |
| `NEVER` | **Complete.** Consumption alone is the whole of the day |
| `UNKNOWN` | **Unproven.** Treated as `EXPECTED` for alerting, and the alert names the missing *flag*, because the fix is a registration rather than a resend |

### 3.2 Metering — partitioned

```sql
CREATE TABLE metering.inbound_message (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source         text NOT NULL,                       -- 'PVNED'
    received_at    timestamptz NOT NULL DEFAULT now(),
    payload_hash   bytea NOT NULL,
    payload_uri    text NOT NULL,                       -- object storage
    http_headers   jsonb,
    remote_ip      inet,
    status         text NOT NULL
        CHECK (status IN ('RECEIVED','PROCESSING','PROCESSED','FAILED','DUPLICATE')),
    failure_code   text,
    failure_detail text,
    processed_at   timestamptz
);
CREATE INDEX ix_msg_hash_recent ON metering.inbound_message (payload_hash, received_at DESC);

CREATE TABLE metering.interval_data_version (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    metering_point_id  uuid NOT NULL REFERENCES customer.metering_point(id),
    delivery_date      date NOT NULL,
    direction          text NOT NULL CHECK (direction IN ('CONSUMPTION','PRODUCTION')),
    document_id        text NOT NULL,
    document_created   timestamptz NOT NULL,
    received_at        timestamptz NOT NULL,
    inbound_message_id uuid NOT NULL REFERENCES metering.inbound_message(id),
    interval_count     smallint NOT NULL CHECK (interval_count IN (92, 96, 100)),
    is_current         boolean NOT NULL DEFAULT true
);

-- exactly one current version per (point, date, direction)   [M4]
CREATE UNIQUE INDEX ux_idv_current
    ON metering.interval_data_version (metering_point_id, delivery_date, direction)
    WHERE is_current;

CREATE TABLE metering.interval_reading (
    version_id     uuid NOT NULL,
    delivery_date  date NOT NULL,
    pos            smallint NOT NULL CHECK (pos BETWEEN 1 AND 100),
    interval_start timestamptz NOT NULL,
    quantity_kwh   numeric(14,3) NOT NULL CHECK (quantity_kwh >= 0),
    PRIMARY KEY (delivery_date, version_id, pos)
) PARTITION BY RANGE (delivery_date);

-- one partition per month, created ahead by a maintenance job
CREATE TABLE metering.interval_reading_2026_08
    PARTITION OF metering.interval_reading
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE INDEX ix_reading_start ON metering.interval_reading USING brin (interval_start);
```

`delivery_date` is part of the primary key so it can be the partition key. `pos` is capped at 100 to
match the XSD and the autumn DST day.

### 3.3 Market — the interval spine

```sql
CREATE TABLE market.calendar_interval (
    interval_start   timestamptz PRIMARY KEY,
    interval_end     timestamptz NOT NULL,
    local_date       date NOT NULL,
    pos              smallint NOT NULL,
    local_dow        smallint NOT NULL,          -- 1 = Monday
    is_dst_duplicate boolean NOT NULL DEFAULT false,
    year             smallint NOT NULL,
    month            smallint NOT NULL,
    quarter          smallint NOT NULL
);
CREATE INDEX ix_cal_local_date ON market.calendar_interval (local_date);

-- peak membership per calendar version, so the peak rule [DEC-19] can change without code
CREATE TABLE market.calendar_interval_peak (
    calendar_version_id uuid NOT NULL REFERENCES market.peak_calendar_version(id),
    interval_start      timestamptz NOT NULL REFERENCES market.calendar_interval(interval_start),
    PRIMARY KEY (calendar_version_id, interval_start)
);

CREATE TABLE market.day_ahead_price (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    market_area text NOT NULL,
    validity    tstzrange NOT NULL,
    price       numeric(12,4) NOT NULL,          -- may be negative
    currency    char(3) NOT NULL DEFAULT 'EUR',
    unit        text NOT NULL DEFAULT 'MWH',
    version     int NOT NULL DEFAULT 1,
    is_current  boolean NOT NULL DEFAULT true,
    is_manual   boolean NOT NULL DEFAULT false,
    source      text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),

    -- no overlapping current prices for one area  [F08-R02]
    EXCLUDE USING gist (market_area WITH =, validity WITH &&) WHERE (is_current)
);
```

Precomputing the interval spine turns coverage, invoicing and charting from per-row date arithmetic
into joins. Peak membership is materialised per calendar version, so answering "is this interval a
peak interval under the calendar this trade was priced with" is an index lookup.

### 3.4 Trading

```sql
-- Reference data, versioned, never mutated in place  [DEC-33], [F05-R50].
-- ⚠ Ships UNPOPULATED — [DEC-33] does not state the value. With no row in force, acceptance is
--   refused with a configuration error and the desk is alerted  [F05-R53]. That is deliberate:
--   guessing a default in either direction is wrong in both.
CREATE TABLE trading.four_eyes_threshold (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- this IS the pinned version id
    scope            text NOT NULL CHECK (scope IN ('GLOBAL_DEFAULT','CUSTOMER')),
    scope_id         uuid REFERENCES customer.customer(id),
    -- EUR, VAT-exclusive  [DEC-26]. NULL means "this scope never requires approval" — which is
    -- NOT the same as no row at all, which is a configuration error  [F05-R50], [F05-R53].
    threshold_amount numeric(18,6) CHECK (threshold_amount IS NULL OR threshold_amount >= 0),
    validity         daterange NOT NULL,
    note             text,
    created_by       text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),

    CHECK ((scope = 'GLOBAL_DEFAULT') = (scope_id IS NULL)),

    -- no overlaps within one scope  [F05-R51]; no commodity dimension — the threshold is on money
    EXCLUDE USING gist (
        scope WITH =, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
        validity WITH &&)
);
CREATE INDEX ix_fet_resolve ON trading.four_eyes_threshold (scope, scope_id, validity);

-- The only permitted mutation is closing the validity window. Everything a trade pinned stays
-- exactly as it was pinned  [F05-R54], domain model §1.1.
CREATE FUNCTION trading.four_eyes_threshold_is_versioned() RETURNS trigger AS $fet$
BEGIN
    IF NEW.scope            IS DISTINCT FROM OLD.scope
    OR NEW.scope_id         IS DISTINCT FROM OLD.scope_id
    OR NEW.threshold_amount IS DISTINCT FROM OLD.threshold_amount
    OR lower(NEW.validity)  IS DISTINCT FROM lower(OLD.validity) THEN
        RAISE EXCEPTION 'four_eyes_threshold is versioned reference data: insert a new row';
    END IF;
    RETURN NEW;
END;
$fet$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fet_is_versioned BEFORE UPDATE ON trading.four_eyes_threshold
    FOR EACH ROW EXECUTE FUNCTION trading.four_eyes_threshold_is_versioned();

CREATE TABLE trading.trade (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reference           text NOT NULL UNIQUE,        -- TRD-1051
    customer_id         uuid NOT NULL REFERENCES customer.customer(id),
    direction           text NOT NULL CHECK (direction IN ('BUY','SELL')),
    shape               text NOT NULL CHECK (shape IN ('BASE','PEAK')),
    period_type         text NOT NULL CHECK (period_type IN ('MONTH','QUARTER','YEAR')),
    period              daterange NOT NULL,
    calendar_version_id uuid NOT NULL REFERENCES market.peak_calendar_version(id),
    requested_by_account_id uuid NOT NULL REFERENCES customer.customer_account(id),
    state               text NOT NULL,
    total_power_mw      numeric(12,6) NOT NULL CHECK (total_power_mw > 0),
    total_mwh           numeric(16,6) NOT NULL,
    price_eur_mwh       numeric(12,4),
    total_value         numeric(18,6),
    offered_at          timestamptz,
    expires_at          timestamptz,

    -- four eyes  [DEC-33], [F05-R54]. Set by Accept, never re-set by Approve.
    accepted_by_account_id         uuid REFERENCES customer.customer_account(id),
    approved_by_account_id         uuid REFERENCES customer.customer_account(id),
    four_eyes_threshold_version_id uuid REFERENCES trading.four_eyes_threshold(id),
    threshold_amount_applied       numeric(18,6),   -- NULL = the pinned row said "never requires approval"

    row_version         bigint NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),

    -- four eyes is two account ids, not a permission  [T10], [F05-R59]
    CHECK (approved_by_account_id IS NULL
           OR approved_by_account_id <> accepted_by_account_id),
    -- nothing is approved that was not accepted
    CHECK (approved_by_account_id IS NULL OR accepted_by_account_id IS NOT NULL),
    -- acceptance pins the threshold version, always  [F05-R54]
    CHECK (accepted_by_account_id IS NULL OR four_eyes_threshold_version_id IS NOT NULL)
);
CREATE INDEX ix_trade_open ON trading.trade (state, created_at)
    WHERE state IN ('REQUESTED','OFFERED','AWAITING_APPROVAL','ACCEPTED');
CREATE INDEX ix_trade_expiring ON trading.trade (expires_at)
    WHERE state IN ('OFFERED','AWAITING_APPROVAL');
CREATE INDEX ix_trade_requester ON trading.trade (customer_id, requested_by_account_id, created_at DESC);
CREATE INDEX ix_trade_awaiting_approval ON trading.trade (customer_id, expires_at)
    WHERE state = 'AWAITING_APPROVAL';

CREATE TABLE trading.trade_event (
    id           bigserial PRIMARY KEY,
    trade_id     uuid NOT NULL REFERENCES trading.trade(id),
    sequence     int NOT NULL,
    event_type   text NOT NULL,
    from_state   text,
    to_state     text,
    actor_type   text NOT NULL CHECK (actor_type IN ('CUSTOMER','EMPLOYEE','SYSTEM')),
    actor_id     text NOT NULL,          -- customer_account.id, employee id, or 'SYSTEM:<job>'
    actor_name   text NOT NULL,          -- snapshot: name as at the moment of the event
    actor_job_title text,                -- snapshot: role in the company, customers only  [F05-R47]
    reason       text,
    comment      text,
    payload      jsonb,
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (trade_id, sequence)
);

CREATE TABLE trading.block_allocation (
    block_id          uuid NOT NULL REFERENCES trading.block(id),
    metering_point_id uuid NOT NULL REFERENCES customer.metering_point(id),
    power_mw          numeric(12,6) NOT NULL CHECK (power_mw > 0),
    PRIMARY KEY (block_id, metering_point_id)
);
```

Invariant B1 (allocations sum exactly to the block power) is checked in the domain and re-checked by
a deferred constraint trigger, because it is the kind of thing a bad migration could break silently.

#### 3.4.1 Both trade indexes changed with [DEC-33]

`AWAITING_APPROVAL` is a new state between `OFFERED` and `ACCEPTED`
([Domain model §4.2](03-domain-model.md)), and **both partial indexes were wrong the moment it was
added** — a partial index silently returns fewer rows rather than failing.

| Index | Was | Now | Why |
| --- | --- | --- | --- |
| `ix_trade_open` | `state IN ('REQUESTED','OFFERED','ACCEPTED')` | `+ 'AWAITING_APPROVAL'` | An accepted-but-unapproved trade is an open trade. Omitting it drops it out of every desk and customer list of live work |
| `ix_trade_expiring` | `state = 'OFFERED'` | `state IN ('OFFERED','AWAITING_APPROVAL')` | **Load-bearing.** This index drives `ExpireOffersJob` ([Background jobs](06-background-jobs.md) §2), which is what **releases the reservation** on a trade accepted above the threshold and never approved before the window closed **[F05-R62]**, **[T12]** |

The expiring index is the sharper of the two. A trade in `AWAITING_APPROVAL` holds an **active
reservation for the full trade value**, taken at acceptance **[T11]**, **[F05-R55]**. If the expiry
job cannot see the row, the trade never leaves the state and the reservation is never released: the
customer's money stays locked against a trade nobody can act on, and no error is raised anywhere.
`ix_trade_awaiting_approval` is separate and serves the desk's "awaiting approval" queue, which is
scoped per customer and must not appear in "to confirm" **[F05-R66]**.

#### 3.4.2 The four-eyes columns

`CHECK (approved_by_account_id <> accepted_by_account_id)` is the database's copy of the whole
four-eyes rule. **[DEC-16]** gives every account of a company identical privileges, so there is no
role to check and nothing else for the constraint to be — the control is a comparison of two account
ids and nothing more, made recordable by **[DEC-17]**. It is enforced in the domain **[T10]** and
again here, because a bug that lets one person approve their own acceptance produces no error
message, only a large trade that went through on one person's say-so.

`threshold_amount_applied` is nullable **and its being NULL is not "unpinned"**: a threshold row with
a `NULL` amount is a valid, deliberate statement that this scope never requires approval
**[F05-R50]**. The pinning is carried by `four_eyes_threshold_version_id`, which is `NOT NULL`
whenever the trade has been accepted — that is what the third `CHECK` says, and it is the difference
between "no approval was needed" and "nobody recorded what the rule was".

### 3.5 Wallet

```sql
CREATE TABLE wallet.wallet (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     uuid NOT NULL UNIQUE REFERENCES customer.customer(id),
    currency        char(3) NOT NULL DEFAULT 'EUR',
    settled_balance numeric(18,6) NOT NULL DEFAULT 0,
    reserved_amount numeric(18,6) NOT NULL DEFAULT 0 CHECK (reserved_amount >= 0),
    last_sequence   bigint NOT NULL DEFAULT 0,
    row_version     bigint NOT NULL DEFAULT 1
);

CREATE TABLE wallet.wallet_entry (
    wallet_id       uuid NOT NULL REFERENCES wallet.wallet(id),
    sequence        bigint NOT NULL,
    entry_type      text NOT NULL,
    settled_delta   numeric(18,6) NOT NULL,
    reserved_delta  numeric(18,6) NOT NULL,
    settled_after   numeric(18,6) NOT NULL,
    reserved_after  numeric(18,6) NOT NULL,
    available_after numeric(18,6) NOT NULL,
    cause_type      text NOT NULL,          -- TRADE | INVOICE | PAYMENT | MANUAL | CREDIT_NOTE
    cause_id        uuid,
    description     text NOT NULL,
    actor_type      text NOT NULL,
    actor_id        text NOT NULL,       -- customer_account.id for customer-initiated movements
    actor_name      text NOT NULL,       -- snapshot, so a deactivated account still resolves
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (wallet_id, sequence),
    CHECK (available_after = settled_after - reserved_after)
);

-- append-only, enforced by the database, not only by code   [W7]
REVOKE UPDATE, DELETE ON wallet.wallet_entry FROM app_role;
CREATE RULE wallet_entry_no_update AS ON UPDATE TO wallet.wallet_entry DO INSTEAD NOTHING;
CREATE RULE wallet_entry_no_delete AS ON DELETE TO wallet.wallet_entry DO INSTEAD NOTHING;

CREATE TABLE wallet.reservation (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id   uuid NOT NULL REFERENCES wallet.wallet(id),
    trade_id    uuid NOT NULL UNIQUE REFERENCES trading.trade(id),
    amount      numeric(18,6) NOT NULL CHECK (amount > 0),
    state       text NOT NULL CHECK (state IN ('ACTIVE','SETTLED','RELEASED')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    release_reason text,
    CHECK (state = 'ACTIVE' OR resolved_at IS NOT NULL)
);
CREATE INDEX ix_reservation_active ON wallet.reservation (wallet_id) WHERE state = 'ACTIVE';
```

The `CHECK (available_after = settled_after - reserved_after)` is trivial to write and catches an
entire family of arithmetic bugs at insert time. `trade_id UNIQUE` makes double-reservation for one
trade impossible.

### 3.6 Billing

```sql
CREATE TABLE billing.surcharge (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope            text NOT NULL CHECK (scope IN ('GLOBAL_DEFAULT','CUSTOMER','METERING_POINT')),
    scope_id         uuid,
    commodity        text NOT NULL,
    -- €/kWh, signed  [DEC-35]. Was `rate numeric(12,4)` in €/MWh; renamed and widened together
    -- [F09-R01], [F09-R11]. Seven decimals restore the €0.0001/MWh granularity the €/MWh column
    -- had — four would resolve only to €0.10/MWh. Migration: §7.
    rate_eur_per_kwh numeric(12,7) NOT NULL,
    validity         daterange NOT NULL,
    note             text,
    created_by       text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CHECK ((scope = 'GLOBAL_DEFAULT') = (scope_id IS NULL)),
    -- no overlaps within one scope  [F09-R02]
    EXCLUDE USING gist (
        scope WITH =, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
        commodity WITH =, validity WITH &&)
);

-- The feed-in tariff  [DEC-44]. Deliberately the same shape, the same constraints and the same
-- rules as the surcharge — one mechanism, built once  [F09-R14], [F09] §11.
CREATE TABLE billing.feed_in_tariff (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope            text NOT NULL CHECK (scope IN ('GLOBAL_DEFAULT','CUSTOMER','METERING_POINT')),
    scope_id         uuid,
    commodity        text NOT NULL,                 -- [DEC-15]
    rate_eur_per_kwh numeric(12,7) NOT NULL,        -- signed; positive credits the customer
    validity         daterange NOT NULL,
    note             text,
    created_by       text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CHECK ((scope = 'GLOBAL_DEFAULT') = (scope_id IS NULL)),
    -- no overlaps within one scope and commodity  [F09-R14], same constraint as the surcharge
    EXCLUDE USING gist (
        scope WITH =, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
        commodity WITH =, validity WITH &&)
);

-- ⚠ Retained but unpopulated — [DEC-24] defers energiebelasting. The table stays so the
--   calculation drops in later; no rows are loaded and no invoice line is produced from it.
CREATE TABLE billing.energy_tax_tariff (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    commodity    text NOT NULL,
    tax_year     smallint NOT NULL,
    tier_index   smallint NOT NULL,
    lower_kwh    numeric(18,3) NOT NULL,
    upper_kwh    numeric(18,3),               -- NULL = open-ended top tier
    rate_eur_kwh numeric(14,8) NOT NULL,
    source       text NOT NULL,
    UNIQUE (commodity, tax_year, tier_index)
);

CREATE TABLE billing.invoice (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  uuid NOT NULL REFERENCES customer.customer(id),
    invoice_run_id uuid REFERENCES billing.invoice_run(id),
    kind         text NOT NULL CHECK (kind IN ('MONTHLY','ANNUAL_TRUE_UP','CREDIT_NOTE')),
    period       daterange NOT NULL,
    number       text UNIQUE,                 -- assigned only on finalisation
    state        text NOT NULL,
    subtotal     numeric(18,6) NOT NULL,
    vat_total    numeric(18,6) NOT NULL,
    total        numeric(18,6) NOT NULL,
    pdf_uri      text,
    odoo_ref     text,
    finalised_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (state = 'DRAFT' OR number IS NOT NULL)
);
```

#### 3.6.1 Two customer rate tables, one mechanism

`billing.surcharge` and `billing.feed_in_tariff` are the same object twice: a signed per-unit rate on
metered volume, scoped and time-bounded, resolved most-specific-first per interval **[F09-R14]**. The
columns, the types, the `CHECK` and the `EXCLUDE` are identical on purpose, so there is one set of
behaviour to test and one migration shape to review.

| | Surcharge | Feed-in tariff |
| --- | --- | --- |
| Unit | €/kWh **[DEC-35]** | €/kWh **[DEC-44]** |
| Type | `numeric(12,7)` | `numeric(12,7)` |
| Sign | Negative = discount | Positive = credit to the customer |
| Applied to | Net usage `Σ U` | Exported volume `Σ max(−U, 0)` |
| Invoice line | 4 | 6 |
| Nothing configured | Zero, and the line is omitted | ⚠ **Not the same thing** — see below |

**Market prices stay `numeric(12,4)` in €/MWh** (`trading.trade.price_eur_mwh`,
`market.day_ahead_price.price`). The boundary is market price versus customer rate **[F09]** §4 rule
6, and it is why the two rate columns carry their unit in the column name and the market columns
carry theirs.

**On the column name.** Both columns are `rate_eur_per_kwh`, not `rate`. That is the rename
**[F09-R01]** and [Invoice calculation](../50-calculations/03-invoice-calculation.md) §6.1 require of
the surcharge, applied to the feed-in tariff for the same reason: **[F09]** §4 rule 6 says every rate
field carries its unit in its name, and a column called `rate` is exactly what allowed a €/MWh figure
to be read as €/kWh in the first place. The shorter `rate` in the sketches in **[F09]** §6 and
Invoice calculation §7A.1 is the same column.

⚠ **A missing feed-in tariff is not a missing surcharge.** A missing surcharge bills nothing and
costs nobody anything; a missing feed-in tariff means exported energy was taken and not paid for. The
fallback is **undecided** — **[DEC-44]** specifies the line and the tariff but not the resolution
failure — so the invoice run skips a month with export and no resolving rate, reason
`MISSING_FEED_IN_TARIFF`, rather than defaulting it **[F09]** §11.1,
[Invoice calculation](../50-calculations/03-invoice-calculation.md) §7A.2. **Nothing in the schema
encodes a default**, and nothing should until that question is answered.

Both tables are **append-only in the sense that matters**: a rate change is a new row, never an
update **[F09]** §4 rule 4. The only legitimate update is closing an open-ended `validity`, which is
the same rule and the same trigger shape as
`trading.four_eyes_threshold_is_versioned()` in §3.4, with `rate_eur_per_kwh` in place of
`threshold_amount`.

> **Gap, flagged rather than invented.** [F09](../10-features/F09-surcharges.md) §6 names
> `surcharge_audit` and `feed_in_tariff_audit`. Because neither table is ever mutated in place, the
> rate history *is* the table; what an audit companion adds is the change **event** — actor, time,
> before/after — which the generic `audit` schema (§1) already carries for reference-data changes
> **[F09-R06]**. No dedicated per-table audit tables are defined here. If F09's owner means physical
> tables rather than entities, they are a one-line addition and this is the place to say so.

## 4. Materialised rollups

```sql
CREATE TABLE metering.daily_position (
    metering_point_id  uuid NOT NULL,
    local_date         date NOT NULL,
    consumption_kwh    numeric(16,3),
    production_kwh     numeric(16,3),
    block_kwh          numeric(16,3),
    covered_kwh        numeric(16,3),
    uncovered_kwh      numeric(16,3),
    surplus_kwh        numeric(16,3),
    spot_cost_eur      numeric(18,6),
    data_state         text NOT NULL,
    computed_at        timestamptz NOT NULL,
    source_version_ids uuid[] NOT NULL,        -- makes invalidation exact
    PRIMARY KEY (metering_point_id, local_date)
);
```

Rebuilt whenever a new interval-data version, a new block, or a corrected day-ahead price touches
that date. `source_version_ids` records exactly what it was computed from, so invalidation is precise
rather than "recompute the month".

## 5. Concurrency

| Path | Mechanism |
| --- | --- |
| Accept an offer | `SELECT … FROM wallet.wallet WHERE id = $1 FOR UPDATE`, then trade state guard, then reservation, all in one transaction — **whichever state the acceptance lands in [F05-R55]** |
| Approve an acceptance **[DEC-33]** | Trade row only. No wallet lock and **no second balance check**: the reservation was taken at acceptance and is not re-created **[T11]** |
| Refuse approval, or expire from `AWAITING_APPROVAL` | **Wallet first, then trade**, same as acceptance — both release a reservation in the same transaction **[T12]**, **[F05-R62]**, **[F05-R63]** |
| Confirm a trade | Same lock ordering: **wallet first, then trade**, always, to prevent deadlock |
| Interval supersession | Advisory lock on `hash(metering_point_id, delivery_date)` — under **[DEC-38]** exactly one document per key per day, so contention is limited to a document and its own correction |
| Invoice run | Advisory lock per (period, customer) |
| Everything else | Optimistic concurrency via `row_version` |

**Lock ordering is a written rule** — wallet before trade, always. Deadlocks in a money path are the
kind of bug that only shows up under production load. `Approve` is the one four-eyes transition that
takes no wallet lock, and that is a property of **[F05-R55]** rather than an optimisation: if
approval had to re-check the balance, approval would be a race against the customer's own invoices.

## 6. Row-level security

Defence in depth behind the EF Core global query filter:

```sql
ALTER TABLE customer.metering_point ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_isolation ON customer.metering_point
    FOR ALL TO app_customer_role
    USING (customer_id = current_setting('app.customer_id')::uuid);
```

The customer API sets `app.customer_id` from the validated token at the start of each request. The
employee API connects as a role with no such policy. If the application filter is ever bypassed by a
mistake, the database still refuses.

## 7. Migrations

- EF Core migrations, applied by a dedicated migrator job before any host starts
  ([Solution structure](02-solution-structure.md) §4).
- Forward-only. No down migrations in production.
- Expand/contract for anything breaking: add, backfill, switch, remove — across separate releases.
- Partition creation is a maintenance job that creates the next three months ahead.
- Every migration is tested against a restored production-shaped dataset before release.

### 7.1 ⚠ The surcharge unit migration — [DEC-35], [F09-R12]

**The rate is divided by 1000. It is never reinterpreted in place.** €/kWh at 4 decimals is 1000×
coarser than the €/MWh it replaces, so the unit change and the widening are one migration, in
expand/contract form because a rename plus a type change is breaking:

```sql
-- 1 · expand: the new column, with the correct type and the unit in its name  [F09-R11]
ALTER TABLE billing.surcharge ADD COLUMN rate_eur_per_kwh numeric(12,7);

-- 2 · backfill: DIVIDE. €4.5500/MWh becomes €0.0045500/kWh  [F09-R12]
UPDATE billing.surcharge SET rate_eur_per_kwh = rate / 1000;

-- 3 · switch: the application reads and writes only the new column
ALTER TABLE billing.surcharge ALTER COLUMN rate_eur_per_kwh SET NOT NULL;

-- 4 · contract, a release later
ALTER TABLE billing.surcharge DROP COLUMN rate;
```

Two ways to get this wrong, both silent:

| Wrong migration | What happens |
| --- | --- |
| `ALTER COLUMN rate TYPE numeric(12,7)` alone | Reinterprets: €4.55/MWh becomes €4.55/**kWh** = €4 550/MWh. A 1000× over-charge on the line that carries PeakPower's whole margin, with no error to catch |
| Dividing before widening — `UPDATE … SET rate = rate / 1000` on the `(12,4)` column | Rounds into 4 decimals: `0.00455` → `0.0046`. €0.05/MWh of error on every kWh, permanently, and unrecoverable because the original value is gone |

Neither raises an exception; both produce a wrong invoice a month later. If a rate is found outside
the plausibility band after migration, treat it as unconverted and stop — do not invoice on it
**[F09]** §7.

If the single-statement form is used instead — acceptable only in a window with no writer on the old
column — it must be one statement so the division happens before the scale is fixed:

```sql
ALTER TABLE billing.surcharge
    ALTER COLUMN rate TYPE numeric(12,7) USING rate / 1000;
ALTER TABLE billing.surcharge RENAME COLUMN rate TO rate_eur_per_kwh;
```

### 7.2 The rest of the second-round schema changes

| Change | Form | Note |
| --- | --- | --- |
| `billing.feed_in_tariff` **[DEC-44]** | New table | Ships empty. Nothing defaults: a month with export and no resolving rate is skipped, not valued **[F09]** §11.1 |
| `trading.four_eyes_threshold` **[DEC-33]** | New table | **Ships empty and blocks acceptance until populated [F05-R53]**. That is not a migration defect; the threshold value is not decided |
| `trading.trade` four-eyes columns | Additive, all nullable | Safe under expand/contract. The `CHECK`s hold for every existing row because all four columns are `NULL` on them |
| `ix_trade_open`, `ix_trade_expiring` | `DROP INDEX` + `CREATE INDEX … CONCURRENTLY` | ⚠ **Must ship in the same release as the `AWAITING_APPROVAL` state, not after it.** Between the two there is a window in which accepted-but-unapproved trades are invisible to the expiry job and their reservations are never released — §3.4.1 |
| `customer.metering_point.production_expectation` **[DEC-65]** | Additive, `DEFAULT 'UNKNOWN'` | Deliberately **not** backfilled to `NEVER` or `EXPECTED`. Every existing point is `UNKNOWN` until someone establishes the answer, which is the whole point of the third state — §3.1.1 |

## 8. Retention & archival

| Data | Retention | Then |
| --- | --- | --- |
| Interval readings (superseded versions) | 7 years | Archive to cold storage |
| Interval readings (current) | 7 years | Archive |
| Raw inbound messages | 2 years hot, 7 years cold | Object storage lifecycle |
| Wallet entries | 7 years minimum, effectively permanent | Never deleted |
| Trade events | 7 years minimum | Never deleted |
| Invoices and PDFs | 7 years (fiscal) | Never deleted |
| Audit records | Per **[OQ-48]** | |

## 9. Open questions

| Ref | Question |
| --- | --- |
| [OQ-48] | Audit retention period |
| [OQ-53] | Expected number of metering points at year 1 and year 3 — this determines whether partitioning by month is enough. **[DEC-38]** makes it an inbound-request-rate question as well as a storage one — §2.1 |
| [OQ-54] | Is a read replica needed for reporting, or is the primary sufficient? |
| *(unnumbered, against **[DEC-33]**)* | The four-eyes threshold **value**. `trading.four_eyes_threshold` ships empty and acceptance is refused with a configuration error until a row exists **[F05-R53]** |
| *(unnumbered, against **[DEC-44]**)* | When a customer exports and no feed-in tariff resolves, is the export valued at zero or at day-ahead? No schema default is encoded either way — §3.6.1 |
| *(new)* | Who establishes `production_expectation` at onboarding, and from what source — contract, grid operator or observation? **[DEC-65]** creates the column; it does not name an owner for the data — §3.1.1 |
