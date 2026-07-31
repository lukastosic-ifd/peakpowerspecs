# Database Design

PostgreSQL 17. One database, schema-per-module, declarative partitioning on the interval tables.

---

## 1. Schemas

| Schema | Contents |
| --- | --- |
| `customer` | customer companies, **accounts**, metering points, labels |
| `metering` | inbound messages, interval data versions, readings, imbalance, data state |
| `market` | peak calendars, calendar intervals, price indications, day-ahead prices |
| `trading` | trades, lines, offers, events, blocks, allocations |
| `wallet` | wallets, entries, reservations, payments |
| `billing` | surcharges, tax tariffs, invoice runs, invoices, sections, lines, credit notes |
| `audit` | generic audit records, internal notes |
| `hangfire` | Hangfire's own tables |

Schema boundaries mirror the module boundaries. Cross-schema foreign keys exist only where the module
graph permits, and an integration test asserts that.

## 2. Sizing

| Table | Rows per year | Driver |
| --- | --- | --- |
| `metering.interval_reading` | **~3.5 M per 100 metering points** | 100 × 365 × 96 × 2 directions |
| `metering.interval_data_version` | ~73 000 per 100 points | 100 × 365 × 2, more with corrections |
| `market.calendar_interval` | 35 040 | 365 × 96 |
| `market.day_ahead_price` | 35 040 | Per market area |
| `wallet.wallet_entry` | Thousands | Trades, invoices, payments |
| `trading.trade_event` | Tens of thousands | ~8 events per trade |
| `billing.invoice_line` | ~30 000 per 100 points | 100 × 12 × ~25 lines |

At 500 metering points that is roughly 17 M interval rows a year — comfortable for PostgreSQL with
monthly partitions. **[DEC-09]** holds until the metering-point count reaches four digits.

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

    -- one customer per EAN at any instant  [AS-03]
    EXCLUDE USING gist (ean WITH =, validity WITH &&)
);

CREATE INDEX ix_mp_customer ON customer.metering_point (customer_id)
    WHERE upper(validity) IS NULL OR upper(validity) > CURRENT_DATE;
```

The `EXCLUDE` constraint is the important line. It makes "two customers own the same EAN at the same
time" a database-level impossibility rather than an application rule someone can forget.

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

-- peak membership per calendar version, so [OQ-02] can change without code
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
    row_version         bigint NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_trade_open ON trading.trade (state, created_at)
    WHERE state IN ('REQUESTED','OFFERED','ACCEPTED');
CREATE INDEX ix_trade_expiring ON trading.trade (expires_at) WHERE state = 'OFFERED';
CREATE INDEX ix_trade_requester ON trading.trade (customer_id, requested_by_account_id, created_at DESC);

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
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope      text NOT NULL CHECK (scope IN ('GLOBAL_DEFAULT','CUSTOMER','METERING_POINT')),
    scope_id   uuid,
    commodity  text NOT NULL,
    rate       numeric(12,4) NOT NULL,       -- signed
    validity   daterange NOT NULL,
    note       text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- no overlaps within one scope  [F09-R02]
    EXCLUDE USING gist (
        scope WITH =, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
        commodity WITH =, validity WITH &&)
);

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
| Accept an offer | `SELECT … FROM wallet.wallet WHERE id = $1 FOR UPDATE`, then trade state guard, then reservation, all in one transaction |
| Confirm a trade | Same lock ordering: **wallet first, then trade**, always, to prevent deadlock |
| Interval supersession | Advisory lock on `hash(metering_point_id, delivery_date)` |
| Invoice run | Advisory lock per (period, customer) |
| Everything else | Optimistic concurrency via `row_version` |

**Lock ordering is a written rule** — wallet before trade, always. Deadlocks in a money path are the
kind of bug that only shows up under production load.

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
| [OQ-53] | Expected number of metering points at year 1 and year 3 — this determines whether partitioning by month is enough |
| [OQ-54] | Is a read replica needed for reporting, or is the primary sufficient? |
