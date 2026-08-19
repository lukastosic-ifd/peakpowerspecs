# Database Design

PostgreSQL 17. One database, schema-per-module, declarative partitioning on the interval tables.

---

## 1. Schemas

| Schema | Contents |
| --- | --- |
| `customer` | customer companies, **accounts**, **bank accounts [DEC-71]**, **approval requests [DEC-71]**, metering points, labels |
| `metering` | **BRPs [DEC-69]**, inbound messages, interval data versions, readings, imbalance, data state |
| `market` | peak calendars, calendar intervals, price indications, **the indication markup [DEC-80]**, day-ahead prices |
| `trading` | trades, lines, offers, events, blocks, allocations, ~~**four-eyes thresholds [DEC-33]**~~ |
| `wallet` | wallets, entries, reservations, payments, **deposit intents, incoming payments [DEC-106]**, **withdrawal requests [DEC-83]** |
| `billing` | ~~surcharges~~, ~~**feed-in tariffs [DEC-44]**~~, **energiebelasting brackets, reductions and results [DEC-74]**, invoice runs, **invoice drafts [DEC-88]**, sections, lines, credit notes |
| `audit` | generic audit records, internal notes |
| `hangfire` | Hangfire's own tables |

⚠ **Amended 2026-08-19.** Six of the eight schemas changed contents.

| Schema | Change | Driver |
| --- | --- | --- |
| `customer` | Bank accounts become their own table — a bank account is added and deactivated, never edited — and the four-eyes approval record joins them | **[DEC-71]**, **[DEC-61]** |
| `market` | The price-indication markup, as reference data with a default of 2% | **[DEC-80]** |
| `trading` | `four_eyes_threshold` is **not built**. Four-eyes is a per-company on/off mode with **no threshold**, so the approval record is a customer-master object and lives in `customer` | **[DEC-71]** replaces **[DEC-33]**, closing **[OQ-85]** |
| `billing` | `surcharge` is **not built** **[DEC-73]** and `feed_in_tariff` is **never created** **[DEC-87]**. `energy_tax_tariff` stops being an unpopulated placeholder and gains a reduction table and a result table | **[DEC-73]**, **[DEC-87]**, **[DEC-74]** reversing **[DEC-24]** |
| `wallet` | Deposit intents with a platform-issued payment reference, the incoming-payment feed and its matches, and withdrawal requests | **[DEC-106]**, **[DEC-83]** |
| `metering` | `brp` — the metering-data source is configurable reference data, and PVNed is the first row | **[DEC-69]** |

Schema boundaries mirror the module boundaries. Cross-schema foreign keys exist only where the module
graph permits, and an integration test asserts that.

⚠ **One new cross-schema edge, and it points the way the existing ones do not.** `customer.metering_point.brp_id`
references `metering.brp` **[DEC-69]**, while every other cross-schema key runs `metering` → `customer`
(`interval_data_version.metering_point_id`). It is admitted rather than routed around, for one reason:
`metering.brp` is **reference data with no foreign key of its own**, so the edge adds no cycle between
*aggregates* — it is a lookup, not a dependency. The assertion list in the integration test gains this
pair explicitly, so that a future key in the same direction to a non-reference table still fails.

## 2. Sizing

| Table | Rows per year | Driver |
| --- | --- | --- |
| `metering.inbound_message` | **~36 500 per 100 metering points** | 100 × 365 — **one document per EAN per day [DEC-38]** — plus corrections |
| `metering.interval_reading` | **≤ ~3.5 M per 100 metering points** | 100 × 365 × 96 × 2 directions. An **upper** bound: a connection that never produces has no `A01` series at all **[DEC-65]** |
| `metering.interval_data_version` | ≤ ~73 000 per 100 points | 100 × 365 × 2, more with corrections, fewer wherever production is absent **[DEC-65]** |
| `market.calendar_interval` | 35 040 | 365 × 96 |
| `market.day_ahead_price` | 35 040 | Per market area |
| `wallet.wallet_entry` | Thousands | Trades, ~~invoices~~ **[DEC-77]**, deposits **[DEC-106]** and withdrawals **[DEC-83]**. Fewer types than before, not more: nothing invoiced reaches the ledger |
| `trading.trade_event` | Tens of thousands | ~8 events per trade; ~9 where a trade passes through `AWAITING_APPROVAL` ~~**[DEC-33]**~~ **[DEC-71]** — the state survives, the threshold that gated it does not |
| ~~`billing.invoice_line`~~ | ~~about 30 000 per 100 points~~ | ~~100 × 12 × about 25 lines, plus one feed-in line per exporting EAN per rate period **[DEC-44]**~~ ⚠ **Amended 2026-08-19** — see the row below |
| `billing.invoice_line` | **~3 600 per 100 points**, plus corrections | **100 × 12 × 3**: the surviving line categories are **1, 2 and 5** — categories 3, 4 and 6 are reserved and unused after **[DEC-73]** (no surcharge line) and **[DEC-87]** (no feed-in line), and category 5 returns with **[DEC-74]** (energiebelasting). Correction invoices **[DEC-99]** add delta lines at no fixed rate and with **no time bound**, which is why this figure is a floor rather than a bound |
| `billing.energy_tax_result` | **1 200 per 100 points** | 100 × 12 — one snapshot per EAN per month, each carrying the bracket-table version and the ladder it used **[F09-R26]** |
| `customer.approval_request` | **Hundreds** | Only companies with `four_eyes_enabled` write rows, and only for five action types **[DEC-71]** |
| `wallet.deposit_intent`, `wallet.incoming_payment` | **Thousands** | One intent per deposit the customer starts; one row per credit line on the feed, matched or not **[DEC-106]** |
| `metering.brp` | **Single digits** | Reference data. PVNed is row one **[DEC-69]**, **[F02-R44]** |

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
    -- ⚠ Moved 2026-08-19 by [DEC-71] to customer.customer_bank_account. A bank account can no
    --   longer be edited — only added and deactivated — and an immutable fact cannot live as a
    --   column on a row that is edited  [F01-R06], [F01-R44].
    -- iban                text CHECK (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
    -- bic                 text CHECK (bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
    -- bank_account_holder text,

    -- Four-eyes is a per-customer-company MODE, not a value comparison  [DEC-71], [F01-R42].
    -- Default off. There is no threshold column here or anywhere else.
    four_eyes_enabled   boolean NOT NULL DEFAULT false,
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

-- One person's login at one company. Several per company; all equal  [DEC-16], with exactly one
-- flag on top  [DEC-71].
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
        -- PENDING_APPROVAL is new: adding a user is a four-eyes action  [DEC-71], [F01-R15]
        CHECK (status IN ('PENDING_APPROVAL','INVITED','ACTIVE','DEACTIVATED')),

    -- The whole of the role model  [DEC-71], [F01-R47]. It grants exactly one capability:
    -- approving or declining ANOTHER admin's sensitive action. It is not a permission on data,
    -- on trading or on spending, and a non-admin keeps every ordinary privilege  [DEC-16], [DEC-18].
    is_admin            boolean NOT NULL DEFAULT false,
    external_subject_id text,                    -- IdP `sub`, set when the invitation is accepted
    created_by_employee text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    activated_at        timestamptz,
    deactivated_at      timestamptz,
    last_login_at       timestamptz,

    -- ⚠ Qualified 2026-08-19 by [DEC-71]: still no role / permission column, and `is_admin` above
    --    is not one — it decides who may give the SECOND pair of eyes, nothing else  [DEC-16]
    CHECK (status <> 'ACTIVE' OR external_subject_id IS NOT NULL),
    CHECK (status <> 'DEACTIVATED' OR deactivated_at IS NOT NULL)
);

-- Two admins are the precondition for the mode, so the count has to be cheap to take  [F01-R43],
-- [F01-R50]: enabling four-eyes with one admin is refused, and so is deactivating the second-to-last.
CREATE INDEX ix_account_admin ON customer.customer_account (customer_id)
    WHERE is_admin AND status = 'ACTIVE';

-- Bank accounts are added and deactivated, never edited  [DEC-71], [DEC-61], [F01-R44].
CREATE TABLE customer.customer_bank_account (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   uuid NOT NULL REFERENCES customer.customer(id),
    iban          text NOT NULL CHECK (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
    bic           text CHECK (bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
    holder_name   text NOT NULL,
    status        text NOT NULL
        CHECK (status IN ('PENDING_APPROVAL','ACTIVE','DEACTIVATED')),
    added_by_account_id       uuid NOT NULL REFERENCES customer.customer_account(id),
    added_at                  timestamptz NOT NULL DEFAULT now(),
    approved_by_account_id    uuid REFERENCES customer.customer_account(id),
    approved_at               timestamptz,
    deactivated_by_account_id uuid REFERENCES customer.customer_account(id),
    deactivated_at            timestamptz,
    deactivation_approved_by_account_id uuid REFERENCES customer.customer_account(id),

    -- the second pair of eyes is a DIFFERENT account, in the database, not only in the domain
    CHECK (approved_by_account_id IS NULL OR approved_by_account_id <> added_by_account_id),
    CHECK (deactivation_approved_by_account_id IS NULL
           OR deactivation_approved_by_account_id <> deactivated_by_account_id),
    -- 'PENDING_APPROVAL' occurs only while the company has four-eyes on; with the mode off an
    -- account is ACTIVE on insert. That rule is NOT expressible here — it depends on a column of
    -- another row (customer.four_eyes_enabled) as it stood at the moment of the add — so the
    -- domain owns it and this table records only what happened.
    CHECK (status <> 'DEACTIVATED' OR deactivated_at IS NOT NULL)
);

-- at most one active bank account per customer  [F01-R46]; it is where a withdrawal is paid  [W15]
CREATE UNIQUE INDEX ux_bank_account_active
    ON customer.customer_bank_account (customer_id) WHERE status = 'ACTIVE';

-- There is no UPDATE path for iban, bic or holder_name. The trigger says so rather than trusting
-- that no repository ever writes them  [DEC-71].
CREATE FUNCTION customer.bank_account_is_immutable() RETURNS trigger AS $cba$
BEGIN
    IF NEW.iban        IS DISTINCT FROM OLD.iban
    OR NEW.bic         IS DISTINCT FROM OLD.bic
    OR NEW.holder_name IS DISTINCT FROM OLD.holder_name
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
        RAISE EXCEPTION 'a bank account is added and deactivated, never edited [DEC-71]';
    END IF;
    RETURN NEW;
END;
$cba$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bank_account_immutable BEFORE UPDATE ON customer.customer_bank_account
    FOR EACH ROW EXECUTE FUNCTION customer.bank_account_is_immutable();

-- The approval record for every four-eyes action  [DEC-71], [F01-R48]. One table, five action
-- types, so a company has ONE place that shows everything waiting on it. Trade rows are written by
-- [F05], withdrawal rows by [F06]/[F07].
CREATE TABLE customer.approval_request (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id           uuid NOT NULL REFERENCES customer.customer(id),
    action                text NOT NULL CHECK (action IN (
                              'ADD_BANK_ACCOUNT','DEACTIVATE_BANK_ACCOUNT',
                              'ADD_USER','TRADE','WITHDRAWAL')),
    subject_id            uuid NOT NULL,        -- the bank account, account, trade or withdrawal
    requested_by_account_id uuid NOT NULL REFERENCES customer.customer_account(id),
    requested_at          timestamptz NOT NULL DEFAULT now(),
    outcome               text NOT NULL DEFAULT 'PENDING'
        CHECK (outcome IN ('PENDING','APPROVED','DECLINED')),
    decided_by_account_id uuid REFERENCES customer.customer_account(id),
    decided_at            timestamptz,
    reason                text,

    -- the entire four-eyes rule, in the database  [F01-R48], [DEC-17]
    CHECK (decided_by_account_id IS NULL OR decided_by_account_id <> requested_by_account_id),
    CHECK ((outcome = 'PENDING') = (decided_at IS NULL)),
    CHECK ((outcome = 'PENDING') = (decided_by_account_id IS NULL)),
    CHECK (outcome <> 'DECLINED' OR reason IS NOT NULL)
);

-- the company's "waiting on you" queue, and the desk's
CREATE INDEX ix_approval_pending ON customer.approval_request (customer_id, requested_at)
    WHERE outcome = 'PENDING';
CREATE UNIQUE INDEX ux_approval_open_subject
    ON customer.approval_request (action, subject_id) WHERE outcome = 'PENDING';

-- Usernames are unique across the whole platform, not per company
CREATE UNIQUE INDEX ux_account_username ON customer.customer_account (username);
CREATE UNIQUE INDEX ux_account_subject
    ON customer.customer_account (external_subject_id) WHERE external_subject_id IS NOT NULL;
CREATE INDEX ix_account_customer ON customer.customer_account (customer_id) WHERE status = 'ACTIVE';

CREATE TABLE customer.metering_point (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ean            char(18) NOT NULL CHECK (ean ~ '^[0-9]{18}$'),
    -- The discriminator stays  [DEC-15]. ⚠ Gas is out of scope  [DEC-68], reversing [DEC-30]:
    -- 'GAS' remains a legal value and no row carries it, because retrofitting the column later is
    -- expensive and keeping it now is nearly free. No gas tariff, product or unit work follows.
    commodity      text NOT NULL CHECK (commodity IN ('ELECTRICITY','GAS')),
    customer_id    uuid NOT NULL REFERENCES customer.customer(id),
    -- The BRP that is balance-responsible for this connection and delivers its documents
    -- [DEC-69], [F01-R51]. ONE column, therefore exactly one BRP at a time  [F02-R42]:
    -- the cardinality is the constraint, and a series arriving from any other BRP is quarantined
    -- `WRONG_BRP` rather than applied  [F02-R14].
    brp_id         uuid NOT NULL REFERENCES metering.brp(id),
    brp_assigned_at timestamptz NOT NULL DEFAULT now(),
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
    -- 'CUSTOMER_DECLARED' added 2026-08-19 by [DEC-112]: the expectation is the CUSTOMER's
    -- responsibility, declared at onboarding. SJV and profile fractions sanity-check it; they are
    -- not its source. Closes the unnumbered question in §9 and [OQ-91].
    production_expectation_source text
        CHECK (production_expectation_source IN
               ('CUSTOMER_DECLARED','CONTRACT','GRID_OPERATOR','OBSERVED','MANUAL')),
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

-- ingestion routes on this, so it is read once per document  [DEC-69], [F02-R41]
CREATE INDEX ix_mp_brp ON customer.metering_point (brp_id);
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

⚠ **Amended 2026-08-19 by [DEC-112] — the column now has an owner.** The **customer** declares at
onboarding whether a connection produces; SJV (*standaardjaarverbruik*) and profile fractions are a
reference to sanity-check that declaration, never its source. `CUSTOMER_DECLARED` is the source value
that records it. Nothing above changes: the default is still `UNKNOWN`, `UNKNOWN` is still treated as
`EXPECTED` for alerting **[F02-R32]**, and a change still reads **forward only [F01-R41]**. What
changes is that the third state now has a moment at which it is meant to be resolved, which is what
**[OQ-91]** asked for.

#### 3.1.2 Four-eyes is two booleans and one table — [DEC-71]

⚠ **Reversed 2026-08-19.** **[DEC-33]** made four-eyes a comparison against a value threshold and
required a versioned reference table of amounts. **[DEC-71]** replaces it: four-eyes is a
**per-customer-company mode with no threshold**, in euros or in megawatts. **[OQ-85] closes.**

| Object | Column / table | Note |
| --- | --- | --- |
| The mode | `customer.four_eyes_enabled` | One boolean, default off, set by a PeakPower employee **[DEC-16]**, **[F01-R42]**. All five actions or none — there is no per-action override |
| Eligibility to approve | `customer_account.is_admin` | One boolean, default off. It grants **only** the second pair of eyes **[F01-R47]** |
| The record | `customer.approval_request` | Action, subject, initiating account, approving account, decision, timestamps **[F01-R48]** |
| ~~The threshold~~ | ~~`trading.four_eyes_threshold`~~ | ⚠ **Not built** — §3.4 |

What this costs, stated rather than implied: a schema that carries **no amount** cannot answer "was
this trade large enough to need approval". It can only answer "was the mode on for this company",
which is exactly what **[DEC-71]** decided the question is. Reinstating a threshold later means a new
table and a re-pin on every trade, not a column.

**The five actions in scope** are `ADD_BANK_ACCOUNT`, `DEACTIVATE_BANK_ACCOUNT`, `ADD_USER`, `TRADE`
and `WITHDRAWAL`. **Deposits are deliberately absent** from the enum: a customer can transfer money
or use iDEAL unaided, so gating a deposit gates nothing **[DEC-71]**, **[DEC-106]**.

`CHECK (decided_by_account_id <> requested_by_account_id)` is the whole control, in one line, in the
database. It is checkable only because **[DEC-17]** already records the acting account on every
action. `ux_approval_open_subject` stops the same subject accumulating two pending approvals, which
is how a "second" approval could otherwise be manufactured by clicking twice.

### 3.2 Metering — partitioned

```sql
-- The metering-data source is configurable reference data  [DEC-69], [F02-R39]. PVNed is the first
-- row, not the schema. Credentials are held in Key Vault; this table carries the REFERENCE to them
-- and never the secret  [Security](07-security.md) §4.1.
CREATE TABLE metering.brp (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code              text NOT NULL UNIQUE,          -- 'PVNED'
    name              text NOT NULL,
    endpoint_uri      text NOT NULL,                 -- where the BRP pushes, or is polled
    credential_ref    text NOT NULL,                 -- Key Vault secret name — never the secret
    document_format   text NOT NULL
        CHECK (document_format IN ('PVNED_TIMESERIES_XML')),   -- extended per adapter, never free text
    adapter_key       text NOT NULL,                 -- selects the adapter at the composition root
    expected_cadence  text NOT NULL DEFAULT 'DAILY_PER_EAN',   -- what silence is measured against
    is_active         boolean NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (adapter_key, code)
);

CREATE TABLE metering.inbound_message (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- ⚠ `source` was the string 'PVNED'. Under [DEC-69] the BRP is a row, and the message records
    --   WHICH BRP it arrived from  [F02-R41] — the id, not the name, because a replay [F02-R27]
    --   must be parsed by the same adapter that first parsed it.
    brp_id         uuid NOT NULL REFERENCES metering.brp(id),
    source         text,                                -- kept, nullable, display only; brp_id
                                                        -- above is the authoritative source
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
CREATE INDEX ix_msg_brp ON metering.inbound_message (brp_id, received_at DESC);

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

#### 3.2.1 The BRP is a row, not a string — [DEC-69]

**[DEC-21]** stands: the PoC ingests generated data in the PVNed format. What **[DEC-69]** adds is
that the *format*, the *endpoint* and the *credentials* belong to a configurable BRP, and PVNed is
row one **[F02-R44]**. Three schema consequences, all small:

| Consequence | Where |
| --- | --- |
| A metering point is assigned to **exactly one BRP at a time** | `customer.metering_point.brp_id`, `NOT NULL`. **The cardinality of the column *is* the constraint** — one column can hold one value, so no exclusion constraint, no assignment table and no "active" flag is needed to say "one at a time" **[F02-R42]** |
| A stored document keeps the BRP that produced it | `metering.inbound_message.brp_id`, `NOT NULL`. `interval_data_version` inherits it through `inbound_message_id`, which is already `NOT NULL`, so the version needs no column of its own and cannot disagree with the message it came from **[F02-R43]**, **[DEC-07]** |
| Reassignment reads **forward** | Nothing is rewritten. `brp_assigned_at` records when the current assignment started; the change event — actor, time, reason — is an ordinary `audit` row **[DEC-17]**, **[F02-R43]** |

⚠ **The credential column is a reference, never a secret.** A BRP is identified **by the credential
that authenticated the request**, never by a field in the payload ([Security](07-security.md) §4.1);
storing the secret here would put every BRP's credential one `SELECT` away from every reader of
reference data.

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

-- The customer never sees a raw Montel quote  [DEC-80], [F04-R17]. Every customer-facing indication
-- is quote × (1 + percentage), and the percentage is REFERENCE DATA with a default of 2%, changed by
-- an employee without a release  [F04-R18] — not a constant, not an appsettings value.
CREATE TABLE market.price_indication_markup (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- this IS the pinned version id
    percentage  numeric(6,4) NOT NULL CHECK (percentage > 0),  -- 2.0000 = 2%; > 0, no upper bound
    validity    daterange NOT NULL,
    note        text,
    created_by  text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),

    -- platform-wide: one value in force at a time, no scope dimension  [F04-R18]
    EXCLUDE USING gist (validity WITH &&)
);
```

Precomputing the interval spine turns coverage, invoicing and charting from per-row date arithmetic
into joins. Peak membership is materialised per calendar version, so answering "is this interval a
peak interval under the calendar this trade was priced with" is an index lookup.

**The markup is `> 0`, and that is not a formality — [DEC-80], [F04-R18].** A markup of zero renders
the raw quote, which is exactly what **[DEC-80]** forbids and what the Montel licence **[DEC-27]**
is read as restricting. **[DEC-80]** names no upper bound, so none is enforced. The table is
effective-dated for the same reason every rate table here is: an indication captured against a trade
request keeps the percentage in force when it was captured **[F04-R10]**, and a later change must not
restate it. ⚠ Which **side** of the market is marked up is not settled — **[DEC-80]**'s comment says
*bid*, the answer it came with says *ask* — and it is carried on **[OQ-23]** with the missing ticker
symbols. The column is the same either way.

### 3.4 Trading

⚠ **Reversed 2026-08-19 by [DEC-71].** The table below is **not created**. It is kept, struck, with
its reasoning readable, because it is the only record of what was designed against **[DEC-33]** and
of what the reversal costs. **[F05-R50]**…**[F05-R54]** retire with it; the mode and the flag that
replace them are in §3.1.2, and the shared approval record is `customer.approval_request`.

```sql
-- ~~Reference data, versioned, never mutated in place  [DEC-33], [F05-R50].~~
-- ~~⚠ Ships UNPOPULATED — [DEC-33] does not state the value. With no row in force, acceptance is~~
-- ~~  refused with a configuration error and the desk is alerted  [F05-R53].~~
-- ⚠ NOT CREATED [DEC-71]: there is no threshold, so there is no value to leave unset, no row to
--   pin and no configuration error to raise. [OQ-85] closed.
--
-- CREATE TABLE trading.four_eyes_threshold (
--     id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- the pinned version id
--     scope            text NOT NULL CHECK (scope IN ('GLOBAL_DEFAULT','CUSTOMER')),
--     scope_id         uuid REFERENCES customer.customer(id),
--     threshold_amount numeric(18,6) CHECK (threshold_amount IS NULL OR threshold_amount >= 0),
--     validity         daterange NOT NULL,
--     note             text,
--     created_by       text NOT NULL,
--     created_at       timestamptz NOT NULL DEFAULT now(),
--     CHECK ((scope = 'GLOBAL_DEFAULT') = (scope_id IS NULL)),
--     EXCLUDE USING gist (
--         scope WITH =, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
--         validity WITH &&)
-- );
-- CREATE INDEX ix_fet_resolve ON trading.four_eyes_threshold (scope, scope_id, validity);
-- CREATE FUNCTION trading.four_eyes_threshold_is_versioned() ...   -- the versioning trigger
-- CREATE TRIGGER trg_fet_is_versioned BEFORE UPDATE ON trading.four_eyes_threshold ...

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
    -- ⚠ Amended 2026-08-19 by [DEC-70], reversing [DEC-32]: minimum and increment are both
    --   0.01 MW, ten times finer than the 0.1 MW that was here. `mod` on numeric is exact, so
    --   this is a real constraint and not a float comparison  [F05-R04].
    total_power_mw      numeric(12,6) NOT NULL
        CHECK (total_power_mw >= 0.01 AND mod(total_power_mw, 0.01) = 0),
    total_mwh           numeric(16,6) NOT NULL,
    price_eur_mwh       numeric(12,4),
    total_value         numeric(18,6),
    offered_at          timestamptz,
    expires_at          timestamptz,

    -- four eyes  ~~[DEC-33]~~ **[DEC-71]**, [F05-R71]. Set by Accept, never re-set by Approve.
    accepted_by_account_id         uuid REFERENCES customer.customer_account(id),
    approved_by_account_id         uuid REFERENCES customer.customer_account(id),
    -- the shared company-wide queue row for this trade, when the mode was on  [F01-R48]
    approval_request_id            uuid REFERENCES customer.approval_request(id),
    -- ⚠ Dropped 2026-08-19 by [DEC-71] — there is no threshold to pin and no amount to record:
    -- four_eyes_threshold_version_id uuid REFERENCES trading.four_eyes_threshold(id),
    -- threshold_amount_applied       numeric(18,6),

    row_version         bigint NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),

    -- four eyes is two account ids, not a permission  [T10], [F05-R59]
    CHECK (approved_by_account_id IS NULL
           OR approved_by_account_id <> accepted_by_account_id),
    -- nothing is approved that was not accepted
    CHECK (approved_by_account_id IS NULL OR accepted_by_account_id IS NOT NULL),
    -- ⚠ Dropped by [DEC-71]: acceptance no longer pins anything, because there is no versioned
    --   threshold row to pin. What acceptance now reads is the company's four_eyes_enabled flag
    --   at that instant  [F05-R28], [F05-R71], and the evidence it happened is the approval row.
    -- CHECK (accepted_by_account_id IS NULL OR four_eyes_threshold_version_id IS NOT NULL)
    CHECK (approved_by_account_id IS NULL OR approval_request_id IS NOT NULL)
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
    -- ⚠ Amended 2026-08-19 by [DEC-70]: allocations are whole multiples of 0.01 MW, was 0.1 MW
    power_mw          numeric(12,6) NOT NULL
        CHECK (power_mw >= 0.01 AND mod(power_mw, 0.01) = 0),
    PRIMARY KEY (block_id, metering_point_id)
);
```

Invariant B1 (allocations sum exactly to the block power) is checked in the domain and re-checked by
a deferred constraint trigger, because it is the kind of thing a bad migration could break silently.
Under **[DEC-70]** both sides of that sum are multiples of 0,01 MW, so the sum is still exact — the
`numeric` type and the `mod` check do the work, and no tolerance appears anywhere — §3.4.3.

#### 3.4.1 Both trade indexes changed with ~~[DEC-33]~~ [DEC-71]

`AWAITING_APPROVAL` is a new state between `OFFERED` and `ACCEPTED`
([Domain model §4.2](03-domain-model.md)), and **both partial indexes were wrong the moment it was
added** — a partial index silently returns fewer rows rather than failing.

| Index | Was | Now | Why |
| --- | --- | --- | --- |
| `ix_trade_open` | `state IN ('REQUESTED','OFFERED','ACCEPTED')` | `+ 'AWAITING_APPROVAL'` | An accepted-but-unapproved trade is an open trade. Omitting it drops it out of every desk and customer list of live work |
| `ix_trade_expiring` | `state = 'OFFERED'` | `state IN ('OFFERED','AWAITING_APPROVAL')` | **Load-bearing.** This index drives `ExpireOffersJob` ([Background jobs](06-background-jobs.md) §2), which is what **releases the reservation** on a trade accepted ~~above the threshold~~ **by a company with four-eyes on [DEC-71]** and never approved before the window closed **[F05-R62]**, **[T12]** |

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

~~`threshold_amount_applied` is nullable **and its being NULL is not "unpinned"**: a threshold row
with a `NULL` amount is a valid, deliberate statement that this scope never requires approval
**[F05-R50]**. The pinning is carried by `four_eyes_threshold_version_id`, which is `NOT NULL`
whenever the trade has been accepted — that is what the third `CHECK` says, and it is the difference
between "no approval was needed" and "nobody recorded what the rule was".~~

⚠ **Both columns are dropped by [DEC-71]**, and the paragraph above is kept only to show what the
reversal removed. There is no amount to apply and no version to pin. The replacement is weaker in one
specific way, worth naming: the trade records **that** an approval happened
(`approval_request_id`, `approved_by_account_id`) but **not what rule was in force when it did**,
because the rule is now a mutable boolean on the customer row. Turning four-eyes off does not restate
a past approval — the approval row survives — but a trade accepted with the mode **off** and one
accepted with the mode **on** are distinguishable only by the presence of that row. That is the cost
of a mode with no versioned reference data behind it, and it is accepted rather than patched with a
snapshot column **[DEC-71]** does not ask for.

⚠ **[DEC-16] is qualified, not reversed.** Everything it said about *who creates accounts* is
unchanged, and `is_admin` confers nothing except the second pair of eyes **[F01-R47]**.

#### 3.4.3 Volume granularity and short selling — [DEC-70], [DEC-72]

| Decision | Schema effect |
| --- | --- |
| **[DEC-70]** — minimum and increment **0,01 MW**, ⚠ reversing **[DEC-32]**'s 0,1 MW | Two `CHECK` constraints change: `trade.total_power_mw` and `block_allocation.power_mw`. The **types do not** — `numeric(12,6)` already carried six decimals, so this is a constraint swap, not a column rewrite. Ten times finer means the non-whole-MW allocation tail is back: 0,07 MW is now an ordinary allocation, and every fixture and validation message carrying 0,1 changes with it **[F05-R04]** |
| **[DEC-72]** — short selling is **permitted**, ⚠ reversing **[DEC-34]** | **A constraint is removed and nothing replaces it.** No check, trigger or index anywhere compares a `SELL` against confirmed holdings for the period **[F05-R69]**; adding one would now be a defect. The motivating case is a customer with solar production selling expected surplus |

`mod(power_mw, 0.01) = 0` is exact on `numeric` — this is the reason the money and volume columns are
`numeric` and never `float`. On a floating-point column the same constraint would reject legitimate
values at random.

⚠ **Nothing in this schema bounds a short position.** The prepaid wallet **[AS-11]** bounds a *spend*;
a short is a promise to deliver, so the balance check **[DEC-41]** does not size it. There is
deliberately **no collateral column, no exposure limit and no margin table** — inventing one here
would be inventing the rule. It is **[OQ-94]**, and what it blocks is the sell path opening, not this
schema.

### 3.5 Wallet

```sql
CREATE TABLE wallet.wallet (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     uuid NOT NULL UNIQUE REFERENCES customer.customer(id),
    currency        char(3) NOT NULL DEFAULT 'EUR',
    -- ⚠ Strengthened 2026-08-19 by [DEC-77], reversing [AS-12]: no invoice debits the wallet, so
    --   there is no path that may take the balance below zero. Was "negative only via
    --   INVOICE_DEBIT" (~~W4~~); is now W10 — never negative, by any path.
    settled_balance numeric(18,6) NOT NULL DEFAULT 0 CHECK (settled_balance >= 0),
    reserved_amount numeric(18,6) NOT NULL DEFAULT 0 CHECK (reserved_amount >= 0),
    last_sequence   bigint NOT NULL DEFAULT 0,
    row_version     bigint NOT NULL DEFAULT 1
);

CREATE TABLE wallet.wallet_entry (
    wallet_id       uuid NOT NULL REFERENCES wallet.wallet(id),
    sequence        bigint NOT NULL,
    -- The list is closed, and three types left it on 2026-08-19  [F06] §3:
    --   ~~INVOICE_DEBIT~~  ⚠ removed by [DEC-77] — the wallet funds TRADING ONLY. A delivery
    --                      invoice is pushed to the bookkeeping program [DEC-88] and paid to the
    --                      bank; it never reaches this ledger. No writer for it may be built.
    --   ~~INVOICE_CREDIT~~ ⚠ removed by [DEC-77], consequentially: an invoice that never debited
    --                      the wallet cannot be credited back to it.
    --   ~~ADJUSTMENT~~     ⚠ removed by [DEC-85] — chargebacks and reversals are the bookkeeping
    --                      program's. ⚠ Cost: a charged-back iDEAL deposit has no entry type left
    --                      to take the money out of the wallet, so the balance overstates until
    --                      someone decides otherwise.
    entry_type      text NOT NULL CHECK (entry_type IN (
                        'DEPOSIT_IDEAL','DEPOSIT_BANK',                       -- [DEC-58], [DEC-106]
                        'TRADE_RESERVED','TRADE_RESERVATION_RELEASED',
                        'TRADE_SETTLED','TRADE_PROCEEDS',                     -- gross [DEC-78]
                        'WITHDRAWAL_REQUESTED','WITHDRAWAL_RELEASED',
                        'WITHDRAWAL_PAID',                                    -- [DEC-83]
                        'REFUND',                                             -- kept, no writer
                        'FEE')),
    settled_delta   numeric(18,6) NOT NULL,
    reserved_delta  numeric(18,6) NOT NULL,
    settled_after   numeric(18,6) NOT NULL,
    reserved_after  numeric(18,6) NOT NULL,
    available_after numeric(18,6) NOT NULL,
    -- ⚠ Amended 2026-08-19: was TRADE | INVOICE | PAYMENT | MANUAL | CREDIT_NOTE.
    --   INVOICE and CREDIT_NOTE go with [DEC-77]; MANUAL goes with [DEC-85]; PAYMENT narrows to
    --   DEPOSIT, because a credit now always points at a deposit intent, never at a bare payment
    --   [DEC-106]; WITHDRAWAL is new [DEC-83].
    cause_type      text NOT NULL
        CHECK (cause_type IN ('TRADE','DEPOSIT','WITHDRAWAL','FEE')),
    cause_id        uuid,
    description     text NOT NULL,
    actor_type      text NOT NULL,
    actor_id        text NOT NULL,       -- customer_account.id for customer-initiated movements
    actor_name      text NOT NULL,       -- snapshot, so a deactivated account still resolves
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (wallet_id, sequence),
    CHECK (available_after = settled_after - reserved_after),
    -- W10  [DEC-77]: no entry may leave the settled balance negative
    CHECK (settled_after >= 0)
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

-- ── Deposits  [DEC-106], amending [DEC-58] ─────────────────────────────────────────────────────
-- Bank transfer is a FIRST-CLASS deposit route, not an out-of-band manual step. The platform issues
-- the reference, matches the money to it, credits the wallet and emails the customer  [F07-R23..R27].
CREATE TABLE wallet.deposit_intent (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id          uuid NOT NULL REFERENCES wallet.wallet(id),
    initiated_by_account_id uuid NOT NULL REFERENCES customer.customer_account(id),
    method             text NOT NULL CHECK (method IN ('IDEAL','BANK_TRANSFER')),
    -- The whole point of the table. Platform-issued, unique, never reused, grouped and
    -- check-character protected so it survives being retyped into a banking app  [F07-R14].
    payment_reference  text NOT NULL UNIQUE,
    -- A HINT for matching, not a limit: there is no minimum and no maximum  [DEC-84], [F07-R28]
    expected_amount    numeric(18,6) CHECK (expected_amount IS NULL OR expected_amount > 0),
    state              text NOT NULL
        CHECK (state IN ('AWAITING_TRANSFER','CREDITED','CANCELLED')),
    created_at         timestamptz NOT NULL DEFAULT now(),
    first_credited_at  timestamptz,
    cancelled_at       timestamptz,

    CHECK (state <> 'CREDITED'  OR first_credited_at IS NOT NULL),
    CHECK (state <> 'CANCELLED' OR cancelled_at IS NOT NULL)
);
CREATE INDEX ix_intent_open ON wallet.deposit_intent (payment_reference)
    WHERE state = 'AWAITING_TRANSFER';

-- One normalised credit line from the incoming-payment feed. ⚠ Which feed — CAMT.053 import, a PSP
-- webhook or a SEPA-instant push — is [OQ-93]. This shape is deliberately feed-independent so the
-- matcher is written once  [F07-R24].
CREATE TABLE wallet.incoming_payment (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- the idempotency key: a re-delivered line credits nothing twice  [F07-R25]
    bank_transaction_id text NOT NULL UNIQUE,
    amount              numeric(18,6) NOT NULL CHECK (amount > 0),
    currency            char(3) NOT NULL DEFAULT 'EUR',
    value_date          date NOT NULL,
    sender_iban         text,
    sender_name         text,
    description         text,
    received_at         timestamptz NOT NULL DEFAULT now(),
    match_state         text NOT NULL DEFAULT 'UNMATCHED'
        CHECK (match_state IN ('UNMATCHED','MATCHED','QUARANTINED'))
);
CREATE INDEX ix_payment_unmatched ON wallet.incoming_payment (received_at)
    WHERE match_state <> 'MATCHED';

-- The match itself: which payment credited which intent, on what evidence, and the ledger entry it
-- produced. One row per credited deposit  [F07-R25], [DEC-61].
CREATE TABLE wallet.bank_deposit (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    incoming_payment_id uuid NOT NULL UNIQUE REFERENCES wallet.incoming_payment(id),
    deposit_intent_id   uuid REFERENCES wallet.deposit_intent(id),
    wallet_id           uuid NOT NULL REFERENCES wallet.wallet(id),
    -- REFERENCE first; IBAN [DEC-61] is the fallback when the customer omits it; MANUAL is
    -- finance registering a transfer by hand  [F07-R17]. A payment is never credited to a guess.
    matched_by          text NOT NULL CHECK (matched_by IN ('REFERENCE','IBAN','MANUAL')),
    matched_by_employee text,                    -- required when matched_by = 'MANUAL'
    amount              numeric(18,6) NOT NULL CHECK (amount > 0),
    wallet_entry_seq    bigint NOT NULL,
    matched_at          timestamptz NOT NULL DEFAULT now(),

    FOREIGN KEY (wallet_id, wallet_entry_seq)
        REFERENCES wallet.wallet_entry (wallet_id, sequence),
    CHECK (matched_by <> 'MANUAL' OR matched_by_employee IS NOT NULL),
    CHECK (matched_by <> 'REFERENCE' OR deposit_intent_id IS NOT NULL)
);

-- ── Withdrawals  [DEC-83], reversing [DEC-43] ──────────────────────────────────────────────────
-- The platform records the request, the decision and the debit. It never moves money: an employee
-- pays out by bank transfer and then records that it left  [F07-R29..R33], [F06-R33..R37].
CREATE TABLE wallet.withdrawal_request (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id          uuid NOT NULL REFERENCES wallet.wallet(id),
    amount             numeric(18,6) NOT NULL CHECK (amount > 0),
    -- an ACTIVE bank account of the SAME customer  [DEC-61], [W15], plus the IBAN as it stood at
    -- request time, because the account can be deactivated before the payout happens  [F07-R33]
    bank_account_id    uuid NOT NULL REFERENCES customer.customer_bank_account(id),
    iban_at_request    text NOT NULL,
    requested_by_account_id uuid NOT NULL REFERENCES customer.customer_account(id),
    requested_at       timestamptz NOT NULL DEFAULT now(),
    state              text NOT NULL CHECK (state IN
                           ('REQUESTED','AWAITING_APPROVAL','APPROVED','DECLINED','PAID')),
    -- set only when the company has four-eyes on  [DEC-71]; the second admin decides here
    approval_request_id uuid REFERENCES customer.approval_request(id),
    decided_by_account_id uuid REFERENCES customer.customer_account(id),
    decided_at         timestamptz,
    decline_reason     text,
    -- the payout an employee has ALREADY made  [F06-R36]
    paid_by_employee   text,
    bank_reference     text,
    value_date         date,
    paid_at            timestamptz,

    CHECK (decided_by_account_id IS NULL
           OR decided_by_account_id <> requested_by_account_id),
    CHECK (state <> 'DECLINED' OR decline_reason IS NOT NULL),
    CHECK (state <> 'PAID' OR (paid_by_employee IS NOT NULL AND bank_reference IS NOT NULL
                               AND paid_at IS NOT NULL)),
    CHECK (state <> 'AWAITING_APPROVAL' OR approval_request_id IS NOT NULL)
);
CREATE INDEX ix_withdrawal_open ON wallet.withdrawal_request (wallet_id, requested_at)
    WHERE state IN ('REQUESTED','AWAITING_APPROVAL','APPROVED');
```

The `CHECK (available_after = settled_after - reserved_after)` is trivial to write and catches an
entire family of arithmetic bugs at insert time. `trade_id UNIQUE` makes double-reservation for one
trade impossible.

#### 3.5.1 Two money paths, and only one of them is the wallet — [DEC-77]

⚠ **[AS-12] is reversed.** An invoice is no longer settled by deducting from the wallet, and the
schema says so in three places: the `INVOICE_DEBIT` and `INVOICE_CREDIT` entry types are gone from
the `entry_type` check, `INVOICE` and `CREDIT_NOTE` are gone from `cause_type`, and
`settled_balance >= 0` is now unconditional.

| Path | Where the money is | What touches it |
| --- | --- | --- |
| **Trading** | The wallet | Reservation on acceptance, debit on execution, both **VAT-inclusive [DEC-78]**. A withdrawal **[DEC-83]** is the only other debit |
| **Delivery** | The bank | The monthly day-ahead, export and energiebelasting amounts are pushed to the bookkeeping program as a **draft invoice [DEC-88]** and paid to the bank. They never reach a wallet entry |

That separation is what makes **[AS-11]** — no negative balance — hold with **no credit concept at
all**: the only things that can debit the wallet are a trade the customer could already afford
**[DEC-41]** and a withdrawal they asked for. The `CHECK (settled_after >= 0)` is therefore not
defensive programming, it is the invariant.

#### 3.5.2 The deposit reference is the whole mechanism — [DEC-106]

⚠ **[DEC-58] is amended**: the payment surface is iDEAL **plus** a fully modelled bank transfer, not
iDEAL plus an out-of-band manual step. The recorded reason is that iDEAL is limited at the bank side
**[DEC-86]**.

| Question the schema answers | Column |
| --- | --- |
| What did the customer say they would send? | `deposit_intent.expected_amount` — a **hint**, nullable, with no minimum and no maximum **[DEC-84]** |
| How will we recognise it? | `deposit_intent.payment_reference`, `UNIQUE`, issued per **intent** and not per customer |
| Did we already credit this line? | `incoming_payment.bank_transaction_id`, `UNIQUE` — the idempotency key **[F07-R25]** |
| On what evidence did we credit it? | `bank_deposit.matched_by` — `REFERENCE`, else `IBAN` **[DEC-61]**, else `MANUAL` |

⚠ **A reference is not consumed by use** **[F07-R26]**. `deposit_intent` has no unique index on
"one deposit per intent", and `bank_deposit.deposit_intent_id` is deliberately **not** unique: a
second payment quoting the same reference is credited again, to the same wallet, against the same
intent. Refusing it would strand the customer's money on PeakPower's account with no automatic route
back. `incoming_payment_id` **is** unique, because that is the line that must never be credited twice.

⚠ **[OQ-93] blocks the writer, not the tables.** Which feed fills `incoming_payment` — CAMT.053
import, a PSP webhook, or a SEPA-instant push — is undecided. The intent, the reference and the
matching rules are feed-independent and can be built now; nothing here encodes a transport.

**No invoice is raised for a deposit or a withdrawal** **[DEC-83]**, **[DEC-106]**, and the
bookkeeping program learns about both from **its own bank feed** **[DEC-109]** — which is why no
column here carries a bookkeeping reference.

### 3.6 Billing

⚠ **Reworked 2026-08-19.** Two rate tables leave, one arrives populated, and the invoice stops being
a document.

| Change | Decision |
| --- | --- |
| `billing.surcharge` is **not built** | **[DEC-73]** ⚠ reverses **[DEC-35]**. The platform pushes **volume**; the bookkeeping program multiplies it by the topup fee. The platform's only margin instrument is the spread on the price it quotes **[DEC-80]**. **[OQ-36] closes** with the surcharge |
| `billing.feed_in_tariff` is **never created** | **[DEC-87]** ⚠ reverses the second half of **[DEC-44]**. Export is credited **raw at the day-ahead price** for the interval, exactly as surplus is **[DEC-23]**. **[OQ-86] closes**: there is no tariff left to fail to resolve, so `MISSING_FEED_IN_TARIFF` and the month-skip it caused are deleted |
| `billing.energy_tax_tariff` becomes **populated and versioned**, and gains a reduction table and a result table | **[DEC-74]** ⚠ reverses **[DEC-24]** |
| The invoice number is **externally assigned**, the PDF is **not the platform's** | **[DEC-88]** ⚠ reverses **[DEC-45]**; **[DEC-89]** ⚠ reverses **[DEC-46]** |

```sql
-- ~~CREATE TABLE billing.surcharge (…)~~
-- ⚠ NOT BUILT [DEC-73]. Was: scope / scope_id / commodity / rate_eur_per_kwh numeric(12,7) /
--   validity daterange / note / created_by, with a most-specific-wins resolution order and an
--   exclusion constraint per scope. The €/kWh rename and widening [F09-R01], [F09-R11] go with it,
--   and so does the migration in §7.1.
--
-- ~~CREATE TABLE billing.feed_in_tariff (…)~~
-- ⚠ NOT CREATED [DEC-87]. Was the same shape again, positive-credits-the-customer, with the
--   undecided fallback that skipped a month of export. Nothing replaces it: export is valued at
--   the day-ahead price on invoice line 2  [DEC-23], [F10] §9.

-- ── Energiebelasting  [DEC-74] ─────────────────────────────────────────────────────────────────
-- ⚠ Was "retained but unpopulated — [DEC-24] defers energiebelasting". It is now POPULATED,
--   VERSIONED reference data that employees maintain without a release  [F09-R18], [F09-R25].
CREATE TABLE billing.energy_tax_tariff (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    commodity    text NOT NULL,               -- [DEC-15]; only 'ELECTRICITY' has rows  [DEC-68]
    tax_year     smallint NOT NULL,
    -- New: a year's ladder is versioned, never edited in place. Once a version has produced a
    -- pushed ledger entry it is closed and a correction is a NEW version  [F09-R19].
    version      smallint NOT NULL DEFAULT 1,
    tier_index   smallint NOT NULL CHECK (tier_index >= 1),
    lower_kwh    numeric(18,3) NOT NULL CHECK (lower_kwh >= 0),   -- inclusive
    upper_kwh    numeric(18,3),               -- exclusive; NULL = open-ended top tier
    -- €/kWh, applied to a kWh volume with NO /1000  [F09-R18]. Eight decimals for the same reason
    -- the surcharge wanted seven: a rate entered in €/MWh out of habit is 1000× out — §7.1.
    rate_eur_kwh numeric(14,8) NOT NULL CHECK (rate_eur_kwh >= 0),
    source       text NOT NULL,               -- where the figure came from; never blank
    validity     daterange NOT NULL,          -- when this VERSION is in force for edits and reads
    created_by   text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    closed_at    timestamptz,                 -- set when the version has been used to push

    UNIQUE (commodity, tax_year, version, tier_index),
    CHECK (upper_kwh IS NULL OR upper_kwh > lower_kwh)
);

-- resolution reads one version of one year at a time  [F09-R21]
CREATE INDEX ix_ett_resolve
    ON billing.energy_tax_tariff (commodity, tax_year, version, tier_index);

-- The minority who do not pay the standard rate — the source names growers  [DEC-74], [F09-R20].
-- Either an outright exemption or an overriding rate for one tier. A percentage discount is
-- expressed as an overriding rate rather than as a second mechanism.
CREATE TABLE billing.energy_tax_reduction (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope        text NOT NULL CHECK (scope IN ('CUSTOMER','METERING_POINT')),
    scope_id     uuid NOT NULL,
    commodity    text NOT NULL,
    tax_year     smallint NOT NULL,
    tier_index   smallint NOT NULL CHECK (tier_index >= 1),
    is_exempt    boolean NOT NULL DEFAULT false,
    rate_eur_kwh numeric(14,8) CHECK (rate_eur_kwh IS NULL OR rate_eur_kwh >= 0),
    validity     daterange NOT NULL,
    note         text,
    source       text NOT NULL,
    created_by   text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),

    -- exactly one of the two, never both and never neither: "nothing configured" is never read
    -- as "exempt"  [F09-R20], [F09-R21]
    CHECK (is_exempt <> (rate_eur_kwh IS NOT NULL)),

    -- no overlaps within one scope, commodity and tier  [F09-R20] — the same exclusion constraint
    -- the surcharge used, on the one table that survived
    EXCLUDE USING gist (
        scope WITH =, scope_id WITH =, commodity WITH =, tier_index WITH =, validity WITH &&)
);
CREATE INDEX ix_etr_resolve
    ON billing.energy_tax_reduction (scope, scope_id, commodity, tax_year);

-- What was actually pushed, and what produced it. Reading a pushed amount must never depend on
-- current reference data  [F09-R26] — reference data moves and ledger entries do not.
CREATE TABLE billing.energy_tax_result (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    metering_point_id  uuid NOT NULL REFERENCES customer.metering_point(id),
    tax_year           smallint NOT NULL,
    period             daterange NOT NULL,        -- the month this delta belongs to
    tariff_version     smallint NOT NULL,
    ladder_applied     jsonb NOT NULL,            -- boundaries and rates as resolved, snapshotted
    reduction_id       uuid REFERENCES billing.energy_tax_reduction(id),
    -- the cumulative year-to-date delta method  [F09-R22]: a bracket is crossed once a year
    ytd_before_kwh     numeric(18,3) NOT NULL,
    ytd_after_kwh      numeric(18,3) NOT NULL,
    -- 1.00 normally; 0.50 on each side of a mid-year EAN transfer  [DEC-74], [F09-R23]
    split_factor       numeric(4,2) NOT NULL DEFAULT 1.00 CHECK (split_factor > 0),
    amount_eur         numeric(18,6) NOT NULL,    -- ex-VAT; the platform computes no VAT [DEC-76]
    ledger_account     text NOT NULL,             -- [DEC-107]
    push_state         text NOT NULL
        CHECK (push_state IN ('PENDING','PUSHED','PUSH_FAILED')),
    pushed_at          timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),

    UNIQUE (metering_point_id, period, tariff_version),
    CHECK (push_state <> 'PUSHED' OR pushed_at IS NOT NULL)
);

-- ── Invoices  [DEC-88], [DEC-89] ───────────────────────────────────────────────────────────────
CREATE TABLE billing.invoice (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  uuid NOT NULL REFERENCES customer.customer(id),
    invoice_run_id uuid REFERENCES billing.invoice_run(id),
    -- ~~ANNUAL_TRUE_UP~~ ⚠ replaced by CORRECTION [DEC-99]: the true-up's job — invoicing a
    --   difference — becomes continuous rather than annual, at any time, with no threshold [DEC-100]
    kind         text NOT NULL CHECK (kind IN ('MONTHLY','CORRECTION','CREDIT_NOTE')),
    period       daterange NOT NULL,
    corrects_invoice_id uuid REFERENCES billing.invoice(id),   -- set iff kind = 'CORRECTION'
    -- ⚠ Externally assigned [DEC-88], reversing [DEC-45]. The platform NEVER mints a number: there
    --   is no sequence, no generator and no format here. The column holds what the bookkeeping
    --   program returned, and is NULL until it does. UNIQUE is kept — not to allocate, but because
    --   a number returned twice is an integration defect that must raise rather than reconcile.
    number       text UNIQUE,
    number_returned_at timestamptz,
    state        text NOT NULL CHECK (state IN (
                     'DRAFT','CANCELLED','PUSHED','PUSH_FAILED','NUMBERED',
                     'CORRECTED','PARTIALLY_CREDITED','CREDITED')),
    subtotal     numeric(18,6) NOT NULL,        -- ex-VAT, and the only total there is  [DEC-76]
    -- ~~vat_total numeric(18,6) NOT NULL,~~  ⚠ dropped by [DEC-76]: the platform computes NO VAT.
    -- ~~total     numeric(18,6) NOT NULL,~~   It pushes ex-VAT amounts against a ledger account and
    --                                         the bookkeeping program applies that account's rate.
    -- ~~pdf_uri   text,~~                     ⚠ dropped by [DEC-89]: the bookkeeping program renders
    --                                         the PDF and emails it. Nothing here stores a document.
    bookkeeping_ref text,                      -- ~~odoo_ref~~; the external id [DEC-108]
    pushed_at    timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),

    -- ~~CHECK (state = 'DRAFT' OR number IS NOT NULL)~~ ⚠ reversed by [DEC-88]: a PUSHED invoice
    --   legitimately has no number yet, and may never get one if the push fails.
    CHECK (number IS NULL OR state IN ('NUMBERED','CORRECTED','PARTIALLY_CREDITED','CREDITED')),
    CHECK (state <> 'NUMBERED' OR (number IS NOT NULL AND number_returned_at IS NOT NULL)),
    CHECK ((kind = 'CORRECTION') = (corrects_invoice_id IS NOT NULL))
);
CREATE INDEX ix_invoice_awaiting_number ON billing.invoice (pushed_at)
    WHERE state IN ('PUSHED','PUSH_FAILED');
```

#### 3.6.1 ~~Two customer rate tables, one mechanism~~ One rate table, and it is the tax

~~`billing.surcharge` and `billing.feed_in_tariff` are the same object twice: a signed per-unit rate
on metered volume, scoped and time-bounded, resolved most-specific-first per interval **[F09-R14]**.
The columns, the types, the `CHECK` and the `EXCLUDE` are identical on purpose, so there is one set
of behaviour to test and one migration shape to review.~~

⚠ **Reversed 2026-08-19 by [DEC-73] and [DEC-87].** Neither table is built. What survives of that
paragraph is the *shape*: a versioned, time-bounded rate with an exclusion constraint per scope,
which is exactly what `billing.energy_tax_reduction` is. One mechanism, built once — for the one
rate the platform still owns.

| | ~~Surcharge~~ | ~~Feed-in tariff~~ | **Energiebelasting** |
| --- | --- | --- | --- |
| Status | ~~**[DEC-35]**~~ **not built [DEC-73]** | ~~**[DEC-44]**~~ **not built [DEC-87]** | **Built and populated [DEC-74]** |
| Unit | ~~€/kWh~~ | ~~€/kWh~~ | €/kWh, `numeric(14,8)` |
| Applied to | ~~Net usage `Σ U`~~ | ~~Exported volume~~ | Net usage **[DEC-22]**, per EAN, per **calendar year** |
| Invoice line | ~~4~~ | ~~6~~ | **5** |
| Who applies it | ~~The platform~~ | ~~The platform~~ | The platform calculates; the **bookkeeping program** carries the ledger entry **[F09-R24]** |
| Nothing configured | ~~Zero, line omitted~~ | ~~Undecided~~ | **Hard stop** `MISSING_TAX_TARIFF` **[F09-R21]** |

**Market prices stay `numeric(12,4)` in €/MWh** (`trading.trade.price_eur_mwh`,
`market.day_ahead_price.price`). The boundary is market price versus customer rate **[F09]** §4 rule
6, and it is why the tax rate column carries its unit in its name and the market columns carry
theirs.

⚠ **"Nothing configured" is a hard stop, not a zero.** This is the one place the energiebelasting
table is *unlike* the surcharge it replaces. A missing surcharge billed nothing and cost nobody
anything. A missing bracket table means a **legal charge was omitted**, so the run stops for that
customer with `MISSING_TAX_TARIFF` **[F09-R21]** — and zero tax is a statement only an explicit
`EXEMPT` reduction row may make. **Nothing in the schema encodes a default rate**, and nothing should.

**The table ships with rows.** ⚠ This is the change **[DEC-74]** actually makes: the table stops
being a placeholder. The rates below are **illustrative and not the Belastingdienst's** — real rates
are set annually, which is precisely why they are editable reference data **[F09-R18]** — and they
match the worked example in [F09](../10-features/F09-surcharges.md) §5 so the arithmetic can be
checked end to end:

```sql
INSERT INTO billing.energy_tax_tariff
    (commodity, tax_year, version, tier_index, lower_kwh, upper_kwh, rate_eur_kwh, source, validity, created_by)
VALUES
    ('ELECTRICITY', 2026, 1, 1,        0.000,    10000.000, 0.10000000, 'illustrative — see [F09] §5', '[2026-01-01,2027-01-01)', 'seed'),
    ('ELECTRICITY', 2026, 1, 2,    10000.000,    50000.000, 0.07000000, 'illustrative — see [F09] §5', '[2026-01-01,2027-01-01)', 'seed'),
    ('ELECTRICITY', 2026, 1, 3,    50000.000, 10000000.000, 0.04000000, 'illustrative — see [F09] §5', '[2026-01-01,2027-01-01)', 'seed'),
    ('ELECTRICITY', 2026, 1, 4, 10000000.000,         NULL, 0.01000000, 'illustrative — see [F09] §5', '[2026-01-01,2027-01-01)', 'seed');
```

Checking the ladder against **[F09-R22]**'s method, `cumulative(V) = Σ clamp(V − lowerₜ, 0,
upperₜ − lowerₜ) × rateₜ`:

| V | Tier 1 | Tier 2 | Tier 3 | `cumulative(V)` |
| ---: | ---: | ---: | ---: | ---: |
| 30 000 kWh | 10 000 × 0,1000 = 1 000,00 | 20 000 × 0,0700 = 1 400,00 | — | **€2 400,00** |
| 65 000 kWh | 10 000 × 0,1000 = 1 000,00 | 40 000 × 0,0700 = 2 800,00 | 15 000 × 0,0400 = 600,00 | **€4 400,00** |

A February whose year-to-date runs 30 000 → 65 000 kWh therefore pushes 4 400,00 − 2 400,00 =
**€2 000,00**. Taxing February's own 35 000 kWh from the bottom of the ladder would give
`10 000 × 0,1000 + 25 000 × 0,0700` = **€2 750,00**, which is **€750,00 too much, every month, for
every site past the first tier** — which is why `ytd_before_kwh` and `ytd_after_kwh` are columns of
`energy_tax_result` rather than a monthly volume.

**`split_factor` is `0.50`, not a fraction of days.** When an EAN transfers between customers
mid-year, **each period gets 50% of every bracket** **[DEC-74]**, **[F09-R23]**, closing **[OQ-77]**.
The boundaries are halved; the **rates are not**. It is deliberately not a pro-rata: for a 1 October
transfer, pro-rata would give 74,8% / 25,2% and this rule still gives 50/50 — a rule a person can
check in their head, chosen knowing what it costs.

⚠ **The *vermindering* has no column.** The fixed annual reduction per connection was part of
**[OQ-14]**'s original question and **[DEC-74]** does not mention it. It is **[OQ-96]**. Nothing here
encodes it, and a fixed annual credit is **not** expressible as a tier override — it would need its
own column or its own row type — so this is a real, if small, schema change waiting on an answer.

Both remaining reference tables are **append-only in the sense that matters**: a rate change is a new
row — or, for the bracket ladder, a new **version** — never an update **[F09]** §4 rule 4,
**[F09-R19]**. The only legitimate update is closing an open-ended `validity` or setting `closed_at`.
The trigger shape is the one ~~`trading.four_eyes_threshold_is_versioned()`~~ used in §3.4 — kept as
the pattern even though that table is not built — with `rate_eur_kwh` in place of `threshold_amount`.

> **Gap, flagged rather than invented.** [F09](../10-features/F09-surcharges.md) §6 names
> `energy_tax_tariff_audit` and `energy_tax_reduction_audit` **[F09-R27]**. Because neither table is
> ever mutated in place, the rate history *is* the table; what an audit companion adds is the change
> **event** — actor, time, before/after — which the generic `audit` schema (§1) already carries for
> reference-data changes. No dedicated per-table audit tables are defined here. If F09's owner means
> physical tables rather than entities, they are a one-line addition and this is the place to say so.
> ⚠ **[DEC-74] raises the stakes on this**: a tax rate that changed with no name against it is not
> defensible to an accountant or to the Belastingdienst, which the surcharge's rate never had to be.

#### 3.6.2 The invoice is a calculation, not a document — [DEC-88], [DEC-89]

The platform calculates, pushes a **draft**, and stores what comes back. Three columns tell that
story, and two are gone.

| Column | Before | Now |
| --- | --- | --- |
| `number` | Minted by the platform on finalisation, `NOT NULL` from that moment **[DEC-45]** | **Returned by the bookkeeping program [DEC-88]**, `NULL` until the push is answered. No sequence, no generator, no format lives here |
| `pdf_uri` | The rendered document **[DEC-46]** | **Dropped [DEC-89]**. The bookkeeping program renders and emails it; the platform shows the calculated data in the portal **[DEC-47]** as amended |
| `vat_total`, `total` | 21% on every line **[DEC-64]** | **Dropped [DEC-76]**. The platform computes no VAT at all; it pushes ex-VAT amounts against a ledger account **[DEC-107]** and that account's rate is applied elsewhere. **[DEC-64]** survives only as the reference rate **[DEC-78]** uses to gross up a trade reservation — a *wallet* number, not an invoice one |

⚠ **What this costs, recorded because [DEC-45]'s rationale was exactly this.** The customer-facing
invoice number now depends on an integration and on a manual check. A `PUSHED` invoice that never
reaches `NUMBERED` leaves the customer with **no numbered invoice at all** — not a document with a
number and late accounting, as before, but nothing. `ix_invoice_awaiting_number` exists for that one
reason: the set of invoices stuck between the two states must be trivially queryable.

**`CORRECTION` replaces `ANNUAL_TRUE_UP`.** Metering corrections arrive at any time, months after a
finalised month included **[DEC-99]**, **[DEC-98]**, and each produces its own document for the delta
with its own returned number. There is **no materiality threshold column** and none is wanted:
every difference is handled individually **[DEC-100]**, so the €25 default the true-up would have
carried is removed rather than set. `corrects_invoice_id` is self-referential and the original is
never edited **[F10-R32]**.

⚠ **One or two documents per customer per month is [OQ-92].** **[DEC-77]** separates the *money*
paths — the hedge is settled in the wallet, delivery is paid to the bank — but whether the hedge and
the day-ahead delivery are one pushed draft or two is undecided. The schema supports both (`kind` and
`period` do not constrain how many rows a run produces per customer), so nothing here blocks; what
the answer changes is how many drafts the bookkeeping program is asked to number.

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
| Approve an acceptance ~~**[DEC-33]**~~ **[DEC-71]** | Trade row and its `approval_request` row. Still **no wallet lock and no second balance check**: the reservation was taken at acceptance and is not re-created **[T11]** |
| Refuse approval, or expire from `AWAITING_APPROVAL` | **Wallet first, then trade**, same as acceptance — both release a reservation in the same transaction **[T12]**, **[F05-R62]**, **[F05-R63]** |
| Confirm a trade | Same lock ordering: **wallet first, then trade**, always, to prevent deadlock |
| Interval supersession | Advisory lock on `hash(metering_point_id, delivery_date)` — under **[DEC-38]** exactly one document per key per day, so contention is limited to a document and its own correction |
| Invoice run | Advisory lock per (period, customer) |
| **Match an incoming payment [DEC-106]** | Wallet row lock, then the intent, then the entry — one transaction. Serialisation is **not** what makes it safe: `incoming_payment.bank_transaction_id UNIQUE` does, so a re-delivered feed line fails on insert rather than crediting twice **[F07-R25]** |
| **Withdrawal request → payout [DEC-83]** | Wallet first, then the request, same ordering as a trade. The request holds a reservation from the moment it is raised, so the money cannot be traded away while it waits for a second admin **[F07-R29]** |
| **A four-eyes decision [DEC-71]** | The `approval_request` row. `ux_approval_open_subject` is what stops two pending approvals for one subject, so two admins deciding at once resolve on one row rather than on a read-modify-write |
| Everything else | Optimistic concurrency via `row_version` |

**Lock ordering is a written rule** — wallet before trade, always, and now wallet before withdrawal
request and wallet before deposit intent as well. Deadlocks in a money path are the kind of bug that
only shows up under production load. `Approve` is the one four-eyes transition that takes no wallet
lock, and that is a property of **[F05-R55]** rather than an optimisation: if approval had to
re-check the balance, approval would be a race against the customer's own ~~invoices~~ **trades** —
⚠ **amended by [DEC-77]**: invoices no longer touch the wallet at all, so the race it was guarding
against can now only come from the customer's own trading.

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

⚠ **Four new tables need the same policy, 2026-08-19.** `customer.customer_bank_account`,
`customer.approval_request`, `wallet.deposit_intent` and `wallet.withdrawal_request` all carry a
`customer_id` or reach one through `wallet_id`, and all four are read by customer surfaces. They are
the highest-value rows in the schema — a bank account, an approval and a payout instruction — so the
policy is not optional on them. `wallet.incoming_payment` is the exception and gets **no customer
policy at all**: an unmatched credit line belongs to nobody yet, and exposing it by IBAN guess would
be a disclosure. It is employee-only until a `bank_deposit` row attaches it to a wallet.

⚠ **The admin flag is not an RLS concept.** `is_admin` **[DEC-71]** decides who may *approve*, which
is an authorisation check in the domain **[F13-R43]**, re-validated against the account record on
every request. Row-level security answers "whose rows are these", and the answer is the same for an
admin and a non-admin of the same company.

## 7. Migrations

- EF Core migrations, applied by a dedicated migrator job before any host starts
  ([Solution structure](02-solution-structure.md) §4).
- Forward-only. No down migrations in production.
- Expand/contract for anything breaking: add, backfill, switch, remove — across separate releases.
- Partition creation is a maintenance job that creates the next three months ahead.
- Every migration is tested against a restored production-shaped dataset before release.

### 7.1 ~~⚠ The surcharge unit migration — [DEC-35], [F09-R12]~~

⚠ **Reversed 2026-08-19 by [DEC-73]. This migration is not performed, because `billing.surcharge` is
not built.** The whole section is kept because the trap it documents did not go away — it **moved**.
`billing.energy_tax_tariff.rate_eur_kwh` is a €/kWh rate at 8 decimals **[F09-R18]**, and a rate
typed in €/MWh out of habit is 1000× out on a **legal** charge, on every kWh, silently. What
transfers to the bracket table:

| From the surcharge migration | Applies to energiebelasting |
| --- | --- |
| Never reinterpret a scale in place | There is no €/MWh predecessor to convert, so the risk is **entry**, not migration: the field is labelled €/kWh and entry validates against a plausibility band, **warning rather than blocking** — a legitimate rate outside the band must still be enterable **[F09]** §7 |
| Stop on an implausible rate rather than invoicing on it | Unchanged, and stronger: the run stops with `MISSING_TAX_TARIFF` rather than taxing at zero **[F09-R21]** |
| Divide, then widen — never the other way round | Not applicable. No conversion is ever performed on this column; a corrected ladder is a **new version** **[F09-R19]**, never an `UPDATE` |

The original text follows, struck, for the reasoning only.

~~**The rate is divided by 1000. It is never reinterpreted in place.**~~ €/kWh at 4 decimals is 1000×
coarser than the €/MWh it replaces, so the unit change and the widening are one migration, in
expand/contract form because a rename plus a type change is breaking:

```sql
-- ⚠ NOT PERFORMED — kept for the reasoning only  [DEC-73]. There is no billing.surcharge table.
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
-- ⚠ NOT PERFORMED — kept for the reasoning only  [DEC-73].
ALTER TABLE billing.surcharge
    ALTER COLUMN rate TYPE numeric(12,7) USING rate / 1000;
ALTER TABLE billing.surcharge RENAME COLUMN rate TO rate_eur_per_kwh;
```

### 7.2 The rest of the second-round schema changes

⚠ Read with **§7.3**, which supersedes three of these rows.

| Change | Form | Note |
| --- | --- | --- |
| ~~`billing.feed_in_tariff` **[DEC-44]**~~ | ~~New table~~ | ⚠ **Never created [DEC-87]** |
| ~~`trading.four_eyes_threshold` **[DEC-33]**~~ | ~~New table~~ | ⚠ **Never created [DEC-71]** — there is no threshold, so nothing ships empty and nothing blocks acceptance |
| `trading.trade` four-eyes columns | Additive, all nullable | Safe under expand/contract. ⚠ **[DEC-71]**: two of the four (`four_eyes_threshold_version_id`, `threshold_amount_applied`) are **not added**, and `approval_request_id` is added in their place. The `CHECK`s still hold for every existing row because the surviving columns are `NULL` on them |
| `ix_trade_open`, `ix_trade_expiring` | `DROP INDEX` + `CREATE INDEX … CONCURRENTLY` | ⚠ **Must ship in the same release as the `AWAITING_APPROVAL` state, not after it.** Between the two there is a window in which accepted-but-unapproved trades are invisible to the expiry job and their reservations are never released — §3.4.1 |
| `customer.metering_point.production_expectation` **[DEC-65]** | Additive, `DEFAULT 'UNKNOWN'` | Deliberately **not** backfilled to `NEVER` or `EXPECTED`. Every existing point is `UNKNOWN` until someone establishes the answer, which is the whole point of the third state — §3.1.1. ⚠ **[DEC-112]** adds `CUSTOMER_DECLARED` to the `_source` check — a widening, safe in place |

### 7.3 The 2026-08-19 schema changes

| Change | Form | Note |
| --- | --- | --- |
| `metering.brp` **[DEC-69]** | New table, **created before** the column that references it | Seeded with **one row, PVNed** **[F02-R44]**, in the same migration — because `customer.metering_point.brp_id` is `NOT NULL` and every existing point has to point somewhere. Backfilling to the PVNed row is correct here and only here: it is the only BRP that has ever delivered a document |
| `customer.metering_point.brp_id` **[DEC-69]** | Add nullable → backfill to PVNed → `SET NOT NULL`, across one release | Expand/contract, but the backfill is safe enough to run in the same release: the value is knowable for every row without asking anyone |
| `customer.customer.four_eyes_enabled`, `customer_account.is_admin` **[DEC-71]** | Additive, `NOT NULL DEFAULT false` | Both default **off**, so no company changes behaviour on deploy. ⚠ A company cannot enable the mode until it has **two** admins **[F01-R43]** — that is an application guard, not a constraint, because it counts rows in another table |
| `customer.approval_request` **[DEC-71]** | New table | Empty on deploy and correctly so: there is no historic approval to reconstruct, and inventing rows for past trades would fabricate a control that was not applied |
| `customer.customer_bank_account` **[DEC-71]**, **[DEC-61]** | New table + **backfill from the three `customer` columns** + drop, across separate releases | ⚠ The one genuinely breaking move this round. Existing `iban`/`bic`/`bank_account_holder` become one `ACTIVE` row per customer that has them, with `added_by_account_id` set to the account that last edited the customer — **or the migration fails loudly** rather than inventing an actor, because the whole table exists to say who added an account |
| `trading.trade.total_power_mw`, `trading.block_allocation.power_mw` **[DEC-70]** | `DROP CONSTRAINT` + `ADD CONSTRAINT … NOT VALID`, then `VALIDATE` | ⚠ **Check the existing rows before validating.** Every row written under **[DEC-32]** is a multiple of 0,1 MW, therefore also a multiple of 0,01 MW, therefore passes — the change is a **loosening**. If a row fails, it was written outside the old constraint and the migration has found a real defect |
| `wallet.wallet_entry.entry_type`, `cause_type` **[DEC-77]**, **[DEC-85]** | `ADD CONSTRAINT … NOT VALID`, then `VALIDATE` | ⚠ **This is the one that can fail on real data.** If any `INVOICE_DEBIT`, `INVOICE_CREDIT` or `ADJUSTMENT` entry exists, validation fails — and it **must**, because the entry is append-only **[W7]** and cannot be rewritten. The resolution is a decision about those balances, not a migration flag |
| `wallet.wallet.settled_balance >= 0` **[DEC-77]** | `ADD CONSTRAINT … NOT VALID`, then `VALIDATE` | Fails on any wallet already negative under ~~**[AS-12]**~~. Same reasoning: a negative balance is now unreachable, so an existing one is a fact to resolve, not a constraint to weaken |
| `wallet.deposit_intent`, `incoming_payment`, `bank_deposit` **[DEC-106]** | New tables | The tables can ship before **[OQ-93]** is answered; the **matcher cannot**. Nothing here encodes a transport |
| `wallet.withdrawal_request` **[DEC-83]** | New table | Empty on deploy. ⚠ **[DEC-43]** meant there was no payout path at all, so there is nothing to migrate |
| `billing.energy_tax_tariff` **[DEC-74]** | Additive columns (`version`, `validity`, `created_by`, `created_at`, `closed_at`) + **new unique key** + **seed rows** | The table exists and is empty **[DEC-24]**, so the `UNIQUE` widening from `(commodity, tax_year, tier_index)` to `(commodity, tax_year, version, tier_index)` cannot conflict. The seed is the first real content the table has ever had — §3.6.1 |
| `billing.energy_tax_reduction`, `billing.energy_tax_result` **[DEC-74]** | New tables | Empty on deploy. A customer with a reduction has to be entered before their first invoice, and the hard stop **[F09-R21]** is what makes forgetting visible |
| `billing.invoice.number` **[DEC-88]** | **Drop** `CHECK (state = 'DRAFT' OR number IS NOT NULL)`; keep `UNIQUE`; add `number_returned_at` | ⚠ **There is no sequence to drop, because the platform never had one in this schema — and none may be added.** Any numbering generator found in the codebase is a defect under **[DEC-88]** |
| `billing.invoice.pdf_uri`, `vat_total`, `total` **[DEC-89]**, **[DEC-76]** | Drop columns, a release after the readers stop | ⚠ Check the blob container before dropping `pdf_uri`: a stored PDF whose row is gone is unreachable and undeletable. Objects go first, column second |
| `billing.invoice.kind` **[DEC-99]** | Constraint swap: `ANNUAL_TRUE_UP` → `CORRECTION` | No row can carry `ANNUAL_TRUE_UP` — the true-up was never built **[DEC-24]** — so the swap is free |
| ~~`billing.surcharge`~~ **[DEC-73]** | ~~Rename + widen — §7.1~~ | ⚠ **Not built, so not migrated.** If a `surcharge` table exists in a deployed environment, it is dropped in the contract release after its readers go |
| `market.price_indication_markup` **[DEC-80]** | New table, **seeded with 2%** | Unlike every other reference table here, this one **must not ship empty**: with no row in force there is no markup, and rendering falls back to the raw quote — exactly what **[DEC-80]** forbids **[F04-R18]** |

## 8. Retention & archival

⚠ **Settled 2026-08-19 by [DEC-95], closing [OQ-48].** Two things were decided, and the second is
the larger one:

1. **Seven fiscal years, and no longer.** No financial regulation that applies here imposes more.
   Every row below that said "7 years minimum" now says seven years because a decision says so,
   not because seven was a safe guess.
2. **The financial record of record is the bookkeeping program**, not this database. The platform
   pushes ledger ids and values **[DEC-76]**, **[DEC-88]**, **[DEC-107]**; the bookkeeping program
   holds the invoices, the VAT, the payments and the chargebacks **[DEC-85]**, **[DEC-105]**. What
   the platform retains is the **action audit trail** — who did what, when **[DEC-17]** — which is
   the thing no other system has.

| Data | Retention | Then |
| --- | --- | --- |
| Interval readings (superseded versions) | 7 years | Archive to cold storage |
| Interval readings (current) | 7 years | Archive |
| Raw inbound messages | 2 years hot, 7 years cold | Object storage lifecycle |
| Wallet entries | 7 years, effectively permanent | Never deleted. Append-only **[W7]**, so retention is the only lever there is |
| Trade events | 7 years | Never deleted |
| ~~Invoices and PDFs~~ **Invoice calculations** | 7 years (fiscal) | Never deleted. ⚠ **Amended by [DEC-89]** — there is **no PDF here to retain**; the document lives in the bookkeeping program, and so does the obligation to keep it |
| Energiebelasting results **[DEC-74]** | 7 years (fiscal) | Never deleted. Each row snapshots the ladder that produced it **[F09-R26]**, which is what makes a seven-year-old amount re-readable without seven-year-old reference data |
| Approval requests **[DEC-71]** | 7 years | Never deleted. It is the evidence a second person agreed |
| Deposit intents, incoming payments, withdrawal requests **[DEC-106]**, **[DEC-83]** | 7 years | Never deleted. A matched payment is a money movement; an **unmatched** one is a fact about somebody's money and is kept for exactly as long |
| Audit records | ~~Per **[OQ-48]**~~ **7 years [DEC-95]** | Never deleted within the window |

⚠ **What "the bookkeeping program holds the financial record" costs, stated.** Deleting this
database after seven years is now safe for *finance* and not safe for *evidence*: the trade timeline,
the approval trail and the ingestion history exist nowhere else. The retention above is therefore a
floor for the audit trail even where the financial obligation has been discharged elsewhere.

## 9. Open questions

⚠ **Rewritten to the post-2026-08-19 position.** Three of the six rows closed and four opened; two
carried over unchanged.

| Ref | Question |
| --- | --- |
| ~~[OQ-48]~~ | ~~Audit retention period~~ ✅ **CLOSED — seven fiscal years, and the financial record of record is the bookkeeping program; the platform retains the action audit trail** **[DEC-95]** — §8 |
| [OQ-53] | Expected number of metering points at year 1 and year 3 — this determines whether partitioning by month is enough. **[DEC-38]** makes it an inbound-request-rate question as well as a storage one — §2.1. **Still open**, and **[DEC-09]** still holds until the count reaches four digits |
| [OQ-54] | Is a read replica needed for reporting, or is the primary sufficient? **Still open.** ⚠ **[DEC-97]** adds a reader: the customer usage API serves interval and aggregated net usage per metering point, which is the first customer-facing query shaped like a report |
| ~~*(unnumbered, against **[DEC-33]**)*~~ | ~~The four-eyes threshold **value**…~~ ✅ **CLOSED — there is no threshold, in euros or in megawatts** **[DEC-71]**, closing **[OQ-85]**. The table is not built, nothing ships empty and nothing blocks acceptance — §3.1.2, §3.4 |
| ~~*(unnumbered, against **[DEC-44]**)*~~ | ~~When a customer exports and no feed-in tariff resolves, is the export valued at zero or at day-ahead?~~ ✅ **CLOSED — at day-ahead, raw** **[DEC-87]**, closing **[OQ-86]**. There is no feed-in tariff, so there is nothing to fail to resolve — §3.6 |
| ~~*(new, against **[DEC-65]**)*~~ | ~~Who establishes `production_expectation` at onboarding, and from what source?~~ ✅ **CLOSED — the customer declares it, and it is the customer's responsibility** **[DEC-112]**, closing **[OQ-91]**. SJV and profile fractions sanity-check the declaration; `CUSTOMER_DECLARED` is the source value — §3.1.1 |
| **[OQ-93]** | Which incoming-payment feed does the platform consume — CAMT.053 import, a PSP webhook, or a SEPA-instant push? `wallet.incoming_payment` is deliberately feed-independent, so the **tables** can ship; the **matcher** cannot — §3.5.2 |
| **[OQ-94]** | What collateral or exposure limit applies to a short position **[DEC-72]**? Nothing in this schema bounds one: no collateral column, no exposure limit, no margin table. Encoding a limit before the rule exists would be inventing the rule — §3.4.3 |
| **[OQ-96]** | Does the *vermindering* — the fixed annual reduction on energiebelasting — apply, and to which connections? It is **not** expressible as a tier override in `billing.energy_tax_reduction`, so answering it changes the schema, not just the data — §3.6.1 |
| **[OQ-92]** | Are the hedge and the day-ahead delivery one pushed draft invoice or two? `billing.invoice` supports either; the answer decides how many drafts per customer per month the bookkeeping program is asked to number **[DEC-88]** — §3.6.2 |
