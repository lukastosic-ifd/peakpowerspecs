# Database Design

PostgreSQL 17. One database, schema-per-module, declarative partitioning on the interval tables.

---

## 0. Extensions

Migration 1 **begins** with these two statements, before any schema or table:

```sql
CREATE EXTENSION IF NOT EXISTS citext;      -- username, email
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- equality inside a GiST exclusion constraint
```

The DDL throughout this document needs both and declared neither. `citext` is what makes
`username` and `email` case-insensitive without a functional index on every lookup;
`btree_gist` is what lets `ean WITH =` sit inside the same exclusion constraint as
`validity WITH &&`. Without them migration 1 fails on its first table, which is a cheap failure
and an entirely avoidable one.

## 1. Schemas

| Schema | Contents |
| --- | --- |
| `customer` | customer companies, **accounts**, **bank accounts [DEC-71]**, ~~**approval requests [DEC-71]**~~ *(never built; struck 2026-10-12, [DEC-179])*, metering points, **refresh tokens [DEC-117]**, **password-reset tokens [DEC-113]**, **onboarding applications [DEC-113]** |
| `metering` | **BRPs [DEC-69]**, ~~**the shared EAN pool [DEC-113]**~~ ⚠ removed by [DEC-182] (2), inbound messages, interval data versions, readings, imbalance, data state, **saved usage costs, the recalculation queue and its check runs [DEC-180]**, **EDSN master data and grid-operator names [DEC-182]** |
| `market` | peak calendars, calendar intervals, price indications, **the indication markup [DEC-80]**, day-ahead prices, **day-ahead feed runs [DEC-180]** |
| `trading` | trades, ~~lines~~ connections, offers, events, blocks, ~~allocations~~, ~~**four-eyes thresholds [DEC-33]**~~ ⚠ **Built as designed by [DEC-167]** — ⚠ four tables (amended 2026-09-30, [DEC-167] (16)) and one sequence, §3.4.4; migration 30 (⚠ five from migration 32, `trade_desk_notice`, owner-only, [DEC-168]), **saved hedge positions [DEC-180]**. |
| `wallet` | wallets, entries, reservations, payments, **deposit intents, incoming payments [DEC-106]**, **withdrawal requests [DEC-83]** |
| `billing` | ~~surcharges~~, ~~**feed-in tariffs [DEC-44]**~~, **energiebelasting brackets, reductions and results [DEC-74]**, invoice runs, **invoice drafts [DEC-88]**, sections, lines, credit notes |
| `audit` | generic audit records, internal notes |
| `legal` | **document types, document versions and the PDF files [DEC-174]** — platform reference data, no `customer_id`, no RLS (§3.7) |
| `hangfire` | Hangfire's own tables |

⚠ **Amended 2026-08-19.** Six of the eight schemas changed contents.

| Schema | Change | Driver |
| --- | --- | --- |
| `customer` | Bank accounts become their own table — a bank account is added and deactivated, never edited — ~~and the four-eyes approval record joins them~~ *(never built; struck 2026-10-12)* | **[DEC-71]**, **[DEC-61]**, **[DEC-179]** |
| `market` | The price-indication markup, as reference data with a default of 2% | **[DEC-80]** |
| `trading` | `four_eyes_threshold` is **not built**. ~~Four-eyes is a per-company on/off mode with **no threshold**, so the approval record is a customer-master object and lives in `customer`~~ ⚠ **There is no four-eyes at all since 2026-10-12 ([DEC-179])**, no approval record and no mode column | **[DEC-71]** replaces **[DEC-33]**, closing **[OQ-85]** |
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
| `metering.interval_cost` | ≤ 3 504 000 per 100 connections a year | 100 × 365 × 96. Derived data, rebuilt from its inputs **[DEC-180] (4)** |
| `trading.hedge_position_interval` | ≤ 35 040 per customer a year | 365 × 96 per customer, whatever the number of connections **[DEC-180] (5)** |
| `market.day_ahead_feed_run` | 48 a day, kept 90 days | One row per 30-minute tick, idle ticks included **[DEC-180] (7)** |
| `metering.cost_recalc_request` | A queue that drains | A request is deleted by the batch that claims it. ⚠ **Measured 2026-10-14 (task L1), on a laptop, not on the VM:** the load-test set (100 connections, 365 days, 4 905 600 readings) drained in 18,9 s, leaving `metering.interval_cost` at 577 MB for 3 503 600 rows and `trading.hedge_position_interval` at 7,9 MB for 35 040 rows. The VM's own rate and sizes are not known (§7.12) |
| `wallet.wallet_entry` | Thousands | Trades, ~~invoices~~ **[DEC-77]**, deposits **[DEC-106]** and withdrawals **[DEC-83]**. Fewer types than before, not more: nothing invoiced reaches the ledger |
| `trading.trade_desk_notice` | Tens of thousands | ⚠ **New 2026-10-01 ([DEC-168])** — one row per desk mail: one *new request* per trade plus one *ready to confirm* per accepted-and-ready trade, so about two per trade; each is stamped sent within ~15 s |
| `trading.trade_event` | Tens of thousands | ~8 events per trade; ~~\~9 where a trade passes through `AWAITING_APPROVAL`~~ ~8 *(⚠ no trade passes through `AWAITING_APPROVAL` since 2026-10-12, [DEC-179])* |
| ~~`billing.invoice_line`~~ | ~~about 30 000 per 100 points~~ | ~~100 × 12 × about 25 lines, plus one feed-in line per exporting EAN per rate period **[DEC-44]**~~ ⚠ **Amended 2026-08-19** — see the row below |
| `billing.invoice_line` | **~3 600 per 100 points**, plus corrections | **100 × 12 × 3**: the surviving line categories are **1, 2 and 5** — categories 3, 4 and 6 are reserved and unused after **[DEC-73]** (no surcharge line) and **[DEC-87]** (no feed-in line), and category 5 returns with **[DEC-74]** (energiebelasting). Correction invoices **[DEC-99]** add delta lines at no fixed rate and with **no time bound**, which is why this figure is a floor rather than a bound |
| `billing.energy_tax_result` | **1 200 per 100 points** | 100 × 12 — one snapshot per EAN per month, each carrying the bracket-table version and the ladder it used **[F09-R26]** |
| ~~`customer.approval_request`~~ | ~~**Hundreds**~~ | ~~Only companies with `four_eyes_enabled` write rows, and only for five action types **[DEC-71]**~~ ⚠ **Removed 2026-10-12 by [DEC-179]** — the table was never built. |
| `wallet.deposit_intent`, `wallet.incoming_payment` | **Thousands** | One intent per deposit the customer starts; one row per credit line on the feed, matched or not **[DEC-106]** |
| `metering.brp` | **Single digits** | Reference data. PVNed is row one **[DEC-69]**, **[F02-R44]** |
| `metering.connection_master_data` | One row per EAN met, no purge (no size promised) | ⚠ **New [DEC-182] (7):** one row for each EAN a search, an attach, a popup or the backfill has met, households included; retention is [OQ-122] |
| `metering.grid_operator` | About 30 rows | ⚠ **New [DEC-182] (8):** the grid-operator mapping list plus the codes asked once; a refresh upserts and deletes nothing |

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

    -- ⚠ Dropped 2026-10-12 by [DEC-179], migration 39 (§7.11): four-eyes is gone, and the column with it.
    --   Was: Four-eyes is a per-customer-company MODE, not a value comparison  [DEC-71], [F01-R42].
    --   Default off. There is no threshold column here or anywhere else.
    --   four_eyes_enabled   boolean NOT NULL DEFAULT false,
    -- ⚠ As built 2026-09-30 by [DEC-167] (17) (migration 31): the company's DEPOSIT percentage on a bought
    --   block, incl. VAT, set by the back office only.
    deposit_pct         numeric(5,2) NOT NULL DEFAULT 20 CONSTRAINT ck_customer_deposit_pct_range CHECK (deposit_pct BETWEEN 0 AND 100),
    -- ⚠ As built 2026-09-29 by [DEC-166] (migration 29): two more nullable columns on this table held a
    --   pending request to turn the mode OFF — see §3.1.4. ⚠ Dropped with the mode by migration 39 (§7.11), [DEC-179].
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

-- ⚠ Amended 2026-09-10 by [DEC-152]. One person's login, full stop: an account is no longer AT a
--    company. Its relationship to each business is a customer_membership row (below), carrying the
--    role. Was: "One person's login at one company. Several per company; all equal [DEC-16], with
--    exactly one flag on top [DEC-71]."
CREATE TABLE customer.customer_account (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- ⚠ DROPPED 2026-09-10 by [DEC-152], in migration 15, and dropped LAST in that migration:
    --   three row-level-security policies depend on it, and DROP COLUMN ... CASCADE would silently
    --   take all three, leaving customer_account with RLS enabled and NO policy - after which every
    --   authenticated request 401s, because the middleware's own account read returns nothing.
    --   Was: customer_id         uuid NOT NULL REFERENCES customer.customer(id),

    -- ⚠ ADDED 2026-09-10 by [DEC-152]. Where sign-in lands. A PREFERENCE, NEVER A TENANCY KEY.
    --   ⚠ It must not be called last_customer_id: the RLS coverage guards discover tenant columns
    --   by the suffix customer_id (right(column_name, 11)) and CLR properties by
    --   EndsWith("CustomerId"), so that spelling would keep this table inside tenancy discovery
    --   keyed on something that is not a tenancy key - a guard reporting coverage it does not have.
    --   Granted column-scoped: GRANT UPDATE (last_active_business_id) TO app_customer_role, after a
    --   blanket REVOKE INSERT, UPDATE, DELETE, so password_hash and security_stamp stay unreachable.
    last_active_business_id uuid NULL REFERENCES customer.customer(id),
    username            citext NOT NULL,
    first_name          text NOT NULL,
    last_name           text NOT NULL,
    job_title           text,                    -- "role in the company" — descriptive only
    email               citext NOT NULL,
    phone               text,
    status              text NOT NULL
        -- PENDING_APPROVAL: a login lifecycle state (was: adding a user is a four-eyes action [DEC-71]; struck by
        --   [DEC-152] and [DEC-179] - nothing writes it for that reason any more, and it is NOT removed from the CHECK)
        CHECK (status IN ('PENDING_APPROVAL','INVITED','ACTIVE','DEACTIVATED')),

    -- ⚠ DROPPED 2026-09-10 by [DEC-152], in migration 15. The role is a property of the
    --   MEMBERSHIP, not of the account: one person is an admin of one business and a viewer of
    --   another. It is backfilled into customer_membership.role BEFORE the drop
    --   (admin -> 'admin', otherwise 'trader'), and the drop is sequenced after the policy swap.
    --   Was: is_admin            boolean NOT NULL DEFAULT false,
    --   with: "The whole of the role model [DEC-71], [F01-R47]. It grants exactly one capability:
    --   approving or declining ANOTHER admin's sensitive action."  (four-eyes removed 2026-10-12, [DEC-179])

    -- ⚠ Added 2026-09-03. The platform holds the credential  [DEC-113], and the stamp is what makes
    --   revocation of a stateless token immediate  [DEC-117], [F01-R16]. `password_hash` is Argon2id,
    --   nullable until a credential is set, never logged and never returned by any endpoint. Every
    --   authenticated request compares the token's `stamp` claim to this column.
    password_hash       text,
    security_stamp      uuid NOT NULL,

    -- ⚠ Dead column, 2026-09-03. It was reserved for an identity provider's subject identifier,
    --   which [DEC-119] drops: the platform owns identity outright and there is no external subject
    --   to hold. Always null; nothing reads or writes it. Dropped in the migration after slice 1.
    external_subject_id text,                    -- was: IdP `sub`, set when the invitation is accepted
    created_by_employee text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    activated_at        timestamptz,
    deactivated_at      timestamptz,
    last_login_at       timestamptz,

    -- ⚠ Qualified 2026-08-19 by [DEC-71]: still no role / permission column, and `is_admin` above
    --    is not one — it decides who may give the SECOND pair of eyes, nothing else  [DEC-16]
    -- ⚠ Withdrawn 2026-09-03 by [DEC-119], and NOT built: an active account has a password hash,
    --   not an external subject, so this constraint would refuse every account the platform creates.
    --   Original text: CHECK (status <> 'ACTIVE' OR external_subject_id IS NOT NULL)
    CHECK (status <> 'DEACTIVATED' OR deactivated_at IS NOT NULL)
);

-- ⚠ Dropped with its columns 2026-09-10 by [DEC-152]. The admin count moves to the membership
--    table, where ix_customer_membership_customer_id serves it.
--    Was: CREATE INDEX ix_account_admin ON customer.customer_account (customer_id)
--             WHERE is_admin AND status = 'ACTIVE';
```

⚠ **New 2026-09-10 [DEC-152], migration 15.** The relationship between a person and a business, and
the sole authority on what they may do there. Transcribed from the migration, not from shared
contract §4's own DDL: the two foreign keys are **named**, exactly as the EF model snapshot records
them, because nothing at runtime compares a bare-`REFERENCES` constraint's Postgres-assigned name
against the snapshot's — that drift would stay silent until the first EF-generated migration that
touches one of these keys.

```sql
CREATE TABLE customer.customer_membership (
    account_id  uuid NOT NULL,
    customer_id uuid NOT NULL,
    role        text NOT NULL CHECK (role IN ('admin', 'trader', 'viewer')),
    created_at  timestamptz NOT NULL,
    removed_at  timestamptz NULL,
    CONSTRAINT pk_customer_membership PRIMARY KEY (account_id, customer_id),
    CONSTRAINT fk_customer_membership_customer_account_account_id
        FOREIGN KEY (account_id)  REFERENCES customer.customer_account(id) ON DELETE CASCADE,
    CONSTRAINT fk_customer_membership_customer_customer_id
        FOREIGN KEY (customer_id) REFERENCES customer.customer(id)         ON DELETE RESTRICT
);
CREATE INDEX ix_customer_membership_customer_id ON customer.customer_membership (customer_id);

ALTER TABLE customer.customer_membership ENABLE ROW LEVEL SECURITY;
-- ⚠ The REVOKE is the whole protection. Migration 2's ALTER DEFAULT PRIVILEGES grants
--   SELECT, INSERT, UPDATE, DELETE on every table a later migration creates in this schema;
--   without this line every signed-in customer holds full DML on the sole proof of tenancy.
--   This repository has already found that trap live, on refresh_token.
REVOKE ALL ON customer.customer_membership FROM app_customer_role, app_employee_role;
-- ⚠ NO DELETE GRANT, EVER, TO EITHER ROLE. PostgreSQL evaluates WITH CHECK for INSERT and for
--   an UPDATE's new row and NEVER for DELETE, which USING alone governs - and this USING carries
--   a permissive `OR account_id = me` arm (below) so the business switcher can read across
--   businesses. With DELETE granted, a plain viewer acting for business B could run
--   `DELETE FROM customer_membership WHERE customer_id = <B>` and wipe every membership in B,
--   admins included, and ANY member could run `DELETE ... WHERE account_id = <self>` to drop
--   memberships in businesses their token does not even name. No policy can close either hole.
--   Removal is an UPDATE setting removed_at, which WITH CHECK does guard. A test asserts the
--   ABSENT privilege. ⚠ This is only half the fence: DELETE is ALSO revoked on customer_account,
--   because its ON DELETE CASCADE to this table runs as the table OWNER, not as the connected
--   role - a customer connection that still held DELETE on customer_account could cascade-delete
--   memberships it may never touch directly. See the customer_account grant, above.
GRANT SELECT, INSERT, UPDATE ON customer.customer_membership TO app_customer_role;
GRANT SELECT, INSERT, UPDATE ON customer.customer_membership TO app_employee_role;

-- ⚠ SET search_path is not decoration: a SECURITY DEFINER function with a mutable search_path
--   lets the caller choose which customer_membership it means.
CREATE FUNCTION customer.is_admin_of(account uuid, business uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER STABLE
    SET search_path = customer, pg_temp AS $fn$
    SELECT EXISTS (SELECT 1 FROM customer.customer_membership
                   WHERE account_id = account AND customer_id = business
                     AND role = 'admin' AND removed_at IS NULL) $fn$;
REVOKE EXECUTE ON FUNCTION customer.is_admin_of(uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION customer.is_admin_of(uuid, uuid) TO app_customer_role;

CREATE POLICY customer_customer_membership_tenant_isolation ON customer.customer_membership
    FOR ALL TO app_customer_role
    USING      (account_id  = NULLIF(current_setting('app.account_id',  true), '')::uuid
             OR customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
    WITH CHECK (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid
            AND customer.is_admin_of(NULLIF(current_setting('app.account_id', true), '')::uuid,
                                     NULLIF(current_setting('app.customer_id', true), '')::uuid));

CREATE POLICY customer_customer_membership_back_office ON customer.customer_membership
    FOR ALL TO app_employee_role USING (true) WITH CHECK (true);
```

⚠ **The permissive `OR` in `USING` is deliberate and is a disclosure to manage.** The switcher has to
read a person's memberships **across** businesses, which the tenant predicate alone forbids; the price
is that a colleague's memberships elsewhere are technically readable while acting for this business.
**Every admin query therefore carries an explicit `AND customer_id = @active`** — above all the floor
count, which would otherwise read *two* for a business that has *one*.

⚠ **The three policies that keyed on `customer_account.customer_id` are replaced, not dropped.**
`customer_account` and `password_reset_token` take an `EXISTS` through the membership table;
`refresh_token` gains **its own `customer_id` column** and takes the uniform
`customer_id = <app.customer_id>` shape instead. That asymmetry is load-bearing: under an
`EXISTS`-through-membership policy, a removal that revokes the member's tokens in the same
transaction would see its own removal, find no active membership, and **revoke zero rows silently**.

⚠ **New 2026-09-16 [migration 17].** `customer.customer_invitation` — one admin asking one email
address to join one business, in one role, once, within **fourteen days** **[F13-R21]**.
`password_reset_token`'s shape, deliberately (32 CSPRNG bytes, a SHA-256 digest stored, the plaintext
mailed once and never persisted, single use), with two differences: this table carries its own
`customer_id` rather than an account join, and the life is fourteen days, not the reset flow's hour.

```sql
CREATE TABLE customer.customer_invitation (
    id                    uuid NOT NULL DEFAULT gen_random_uuid(),
    customer_id           uuid NOT NULL,
    email                 citext NOT NULL,
    role                  text NOT NULL,
    token_hash            varchar(64) NOT NULL,
    invited_by_account_id uuid NULL,        -- provenance only, deliberately no FK - see below
    issued_at             timestamptz NOT NULL,
    expires_at            timestamptz NOT NULL,
    accepted_at           timestamptz NULL,
    CONSTRAINT pk_customer_invitation PRIMARY KEY (id),
    -- Restrict, not Cascade: a business is never deleted on this platform (it is CLOSED), and if
    -- one ever were, the invitations it sent are part of the record of why its people have logins.
    CONSTRAINT fk_customer_invitation_customer_customer_id
        FOREIGN KEY (customer_id) REFERENCES customer.customer(id) ON DELETE RESTRICT
);
-- No foreign key on invited_by_account_id: provenance for an audit question, not a navigable
-- relationship, the same choice customer.approval_request's requested_by is NOT - contrast
-- deliberately drawn, because a Restrict FK here would make deleting a colleague fail on
-- invitations nobody thinks of as belonging to them.

ALTER TABLE customer.customer_invitation
    ADD CONSTRAINT ck_customer_invitation_role CHECK (role IN ('admin', 'trader', 'viewer'));
ALTER TABLE customer.customer_invitation
    ADD CONSTRAINT ck_customer_invitation_window
    CHECK (expires_at > issued_at AND (accepted_at IS NULL OR accepted_at >= issued_at));

CREATE INDEX ix_customer_invitation_customer_id ON customer.customer_invitation (customer_id);
-- The accept endpoint's only lookup key, since the plaintext token is never stored. UNIQUE
-- because two rows sharing a digest would make redemption ambiguous.
CREATE UNIQUE INDEX ix_customer_invitation_token_hash ON customer.customer_invitation (token_hash);
-- The admin surface's "who is outstanding?" read - partial, on rows still live.
CREATE INDEX ix_customer_invitation_pending ON customer.customer_invitation (customer_id, email)
    WHERE accepted_at IS NULL;

REVOKE ALL ON customer.customer_invitation FROM app_customer_role, app_employee_role;
-- SELECT + INSERT only for the customer role: INSERT issues an invitation, SELECT is what
-- GET /api/v1/company/memberships reads. No UPDATE - nothing authenticated marks an invitation
-- accepted, because both accept paths are anonymous and run on the owner connection. No DELETE,
-- for the same reason customer_membership has none: PostgreSQL never evaluates WITH CHECK for a
-- DELETE, so no policy can guard one, and a granted DELETE would let any admin erase the evidence
-- that an invitation was ever sent.
GRANT SELECT, INSERT ON customer.customer_invitation TO app_customer_role;
-- SELECT only for the employee role, so support can answer "was she invited?". No write: the
-- back office has no membership screen at all [OQ-105], and this migration does not invent one.
GRANT SELECT         ON customer.customer_invitation TO app_employee_role;

ALTER TABLE customer.customer_invitation ENABLE ROW LEVEL SECURITY;

-- The WITH CHECK carries the admin term as well as the tenancy one, copying customer_membership's
-- shape: CompanyAdmin proves "an admin of the business in my token" in the authorization
-- middleware, and this proves it again in the database, against the business the connection is
-- actually scoped to. A handler that forgot its own customer_id predicate is caught here.
CREATE POLICY customer_customer_invitation_tenant_isolation ON customer.customer_invitation
    FOR ALL TO app_customer_role
    USING      (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid)
    WITH CHECK (customer_id = NULLIF(current_setting('app.customer_id', true), '')::uuid
            AND customer.is_admin_of(NULLIF(current_setting('app.account_id',  true), '')::uuid,
                                     NULLIF(current_setting('app.customer_id', true), '')::uuid));

CREATE POLICY customer_customer_invitation_back_office ON customer.customer_invitation
    FOR ALL TO app_employee_role USING (true) WITH CHECK (true);
```

```sql
-- Bank accounts are added and deactivated, never edited  [DEC-71], [DEC-61], [F01-R44].
-- ⚠ As built 2026-09-28 by [DEC-165] (migration 26): this is the 2026-08-19 design, kept for the record.
--   The built table has no approver columns and no immutability trigger, adds a `source` column, makes
--   added_by_account_id nullable and validates the IBAN and BIC in the domain type rather than in CHECKs —
--   see §3.1.3.
CREATE TABLE customer.customer_bank_account (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   uuid NOT NULL REFERENCES customer.customer(id),
    iban          text NOT NULL CHECK (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
    bic           text CHECK (bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
    holder_name   text NOT NULL,
    status        text NOT NULL
        CHECK (status IN ('ACTIVE','DEACTIVATED')),   -- 'PENDING_APPROVAL' removed 2026-10-12, DEC-179 (migration 39)
    added_by_account_id       uuid NOT NULL REFERENCES customer.customer_account(id),
    added_at                  timestamptz NOT NULL DEFAULT now(),
    -- approved_by_account_id    uuid REFERENCES customer.customer_account(id),   -- never built; struck 2026-10-12, DEC-179
    -- approved_at               timestamptz,
    deactivated_by_account_id uuid REFERENCES customer.customer_account(id),
    deactivated_at            timestamptz,
    -- deactivation_approved_by_account_id uuid REFERENCES customer.customer_account(id),

    -- ⚠ Struck 2026-10-12 by [DEC-179]: there is no second pair of eyes. A bank account is ACTIVE on insert.
    -- CHECK (approved_by_account_id IS NULL OR approved_by_account_id <> added_by_account_id),
    -- CHECK (deactivation_approved_by_account_id IS NULL
    --        OR deactivation_approved_by_account_id <> deactivated_by_account_id),
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

-- ⚠ Struck 2026-10-12 by [DEC-179]. `customer.approval_request` was designed here and NEVER BUILT; there is no
-- four-eyes, so it never will be. Kept as the record of [DEC-71] (commented out):
--
-- -- The approval record for every four-eyes action  [DEC-71], [F01-R48]. One table, five action
-- -- types, so a company has ONE place that shows everything waiting on it. Trade rows are written by
-- -- [F05], withdrawal rows by [F06]/[F07].
-- CREATE TABLE customer.approval_request (
--     id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--     customer_id           uuid NOT NULL REFERENCES customer.customer(id),
--     -- ⚠ 'ADD_USER' removed 2026-09-10 by [DEC-152]: membership changes bypass four-eyes
--     --   entirely [F01-R49], so no membership write ever raises an approval. Four arms, not five.
--     action                text NOT NULL CHECK (action IN (
--                               'ADD_BANK_ACCOUNT','DEACTIVATE_BANK_ACCOUNT',
--                               'TRADE','WITHDRAWAL')),
--     subject_id            uuid NOT NULL,        -- the bank account, account, trade or withdrawal
--     requested_by_account_id uuid NOT NULL REFERENCES customer.customer_account(id),
--     requested_at          timestamptz NOT NULL DEFAULT now(),
--     outcome               text NOT NULL DEFAULT 'PENDING'
--         CHECK (outcome IN ('PENDING','APPROVED','DECLINED')),
--     decided_by_account_id uuid REFERENCES customer.customer_account(id),
--     decided_at            timestamptz,
--     reason                text,

--     -- the entire four-eyes rule, in the database  [F01-R48], [DEC-17]
--     CHECK (decided_by_account_id IS NULL OR decided_by_account_id <> requested_by_account_id),
--     CHECK ((outcome = 'PENDING') = (decided_at IS NULL)),
--     CHECK ((outcome = 'PENDING') = (decided_by_account_id IS NULL)),
--     CHECK (outcome <> 'DECLINED' OR reason IS NOT NULL)
-- );

-- -- the company's "waiting on you" queue, and the desk's
-- CREATE INDEX ix_approval_pending ON customer.approval_request (customer_id, requested_at)
--     WHERE outcome = 'PENDING';
-- CREATE UNIQUE INDEX ux_approval_open_subject
--     ON customer.approval_request (action, subject_id) WHERE outcome = 'PENDING';

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
    capacity_kw    numeric(12,3),   -- ⚠ stale: built as numeric(18,6) (corrected 2026-10-13, [DEC-180])
    address        jsonb,
    edsn_verified_at timestamptz,   -- ⚠ [DEC-182] (6), migration 44: null = "not verified by EDSN"
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

#### 3.1.2 ~~Four-eyes is two booleans and one table — [DEC-71]~~

⚠ **Struck 2026-10-12 by [DEC-179].** This section described the mode (`customer.four_eyes_enabled`), the eligibility to approve (`customer_membership.role = 'admin'`), the record (`customer.approval_request`, **never built**) and the threshold (`trading.four_eyes_threshold`, **never built**), and the `CHECK (decided_by_account_id <> requested_by_account_id)` that was said to be the whole control. **Only the first existed in the database, and migration 39 (§7.11) drops it.** What remains true of the schema: eligibility to administer a business is `customer_membership.role = 'admin'`, read from the database on every request **[DEC-152]**, **[F01-R47]**; deposits were never gated **[DEC-106]**; and there is no amount in the schema, so "was this large enough" was never answerable **[DEC-71]**.

#### 3.1.3 The company bank account, as built — [DEC-165]

⚠ **Added 2026-09-28.** The `customer.customer_bank_account` DDL above is the 2026-08-19 design
**[DEC-71]**, kept for the record. **Migration 26** (`CompanyBankAccounts`) built the table, and it differs
from that sketch in the respects below. A company **admin** now adds or replaces the account from the
Balance page, so a row is written by the customer host, not by an employee **[F01-R44]**. ⚠ **Amended 2026-10-08 by [DEC-176] (9): on the Company page, not Balance.**

| Design sketch above | As built |
| --- | --- |
| `iban` and `bic` with regular-expression `CHECK`s | Plain `text`. The IBAN is validated in the domain type — shape (15 to 34 characters) and ISO 7064 mod-97 — and the BIC by shape, before anything is written; the per-country IBAN length table **[F01-R03]** describes is not built |
| `holder_name text NOT NULL` | The same, with 1 to 200 characters enforced in the domain type, not by the column |
| `added_by_account_id NOT NULL` | **Nullable** — a row copied from an onboarding application that recorded no signing account. Every portal write names the acting account |
| `approved_by_account_id`, `approved_at`, `deactivation_approved_by_account_id` and their `CHECK`s | **Not built, and now never.** ~~They arrive with the four-eyes approval flow **[F01-R45]**, which is deferred~~ ⚠ **[F01-R45] is struck 2026-10-12, [DEC-179]** |
| `status IN ('PENDING_APPROVAL','ACTIVE','DEACTIVATED')` | The same `CHECK` (`ck_customer_bank_account_status_valid`). `PENDING_APPROVAL` was admitted for the deferred flow and **never written**. ⚠ **Re-created without `PENDING_APPROVAL` by migration 39 (§7.11), [DEC-179]**, under the same name; the migration first asserts that no row carries it |
| — | **New: `source`** — `ONBOARDING`, `PORTAL` or `BACKFILL`, with `ck_customer_bank_account_source_valid`. `ONBOARDING` is the wizard's signing **and** migration 26's own copy; `PORTAL` is a Balance-page add or replace (⚠ **Amended 2026-10-08 by [DEC-176] (9): on the Company page, not Balance.**); `BACKFILL` is reserved for a later data repair and written by nothing |
| `CHECK (status <> 'DEACTIVATED' OR deactivated_at IS NOT NULL)` | `ck_customer_bank_account_deactivation_consistency`: `deactivated_at` **and** `deactivated_by_account_id` are set if, and only if, `status = 'DEACTIVATED'` |
| `ux_bank_account_active` | The same partial unique index, named `ux_customer_bank_account_active` — at most one `ACTIVE` row per company **[F01-R46]** |
| `bank_account_is_immutable()` and `trg_bank_account_immutable` | **Not built.** What stops an edit is that no application role holds `UPDATE` or `DELETE` on the table, and its only two writers — the add/replace endpoint, which deactivates and inserts, and onboarding's signing, which inserts — both run owner-privileged and never edit a row in place |

⚠ **Grants and row-level security.** Migration 26 revokes everything first — migration 2's default
privileges had already handed the new table full DML — then grants **`SELECT` only** to `app_customer_role`
and `app_employee_role`. **No role holds `DELETE`**: a bank account is a financial record, only ever
deactivated. Row-level security is enabled with two **`FOR SELECT`** policies — `customer_id = app.customer_id`
for the customer role and `USING (true)` for the back office — narrower than the *"same policy"* §6 asks of
this table, because neither role writes it through its own connection. Every write runs through
`OwnerPrivilegedWrite` **after** the admin check ~~, the four-eyes refusal~~ and every field check have run in C#,
the discipline migration 23 set for `wallet.withdrawal_request`. **Migration 26 also widens
`app_employee_role`'s column-scoped `UPDATE` on `wallet.withdrawal_request`** from `(status, resolved_at)` to
include `destination` — the payout records the account it resolved — and nothing else.

⚠ **The backfill.** Migration 26 inserts, for every customer with a signed `customer.onboarding_application`
carrying an IBAN, one `ACTIVE` row with `source = 'ONBOARDING'` from that customer's **most recent** such
application (`DISTINCT ON (customer_id)` ordered by `signed_at` descending), with `added_at` the signing time
and `added_by_account_id` the signing account. The holder name is the application's bank-account holder, else its
organisation name, else the company's `legal_name`, capped at 200 characters. `ON CONFLICT (customer_id) WHERE
status = 'ACTIVE' DO NOTHING` makes a manual re-run harmless. Note the source: the built `customer.customer`
never carried `iban`, `bic` or `bank_account_holder` — the sketch in §3.1 above is a column that was never
created — so there is nothing to drop from it. A company created by the back office or the seeder has no
onboarding application and gets no row.

⚠ **`wallet.withdrawal_request` stores the IBAN itself.** The DDL in §3.5 sketches `bank_account_id` and
`iban_at_request`; the built table (migration 23) has a single **`destination`** column. A bank-account replace
re-points it for the company's open (`REQUESTED`; ~~`AWAITING_APPROVAL`~~ no longer exists) requests, scoped through the company's
own wallet, and the payout sets it to the account it resolved, so it is where a request **will** be paid, not a
frozen snapshot **[DEC-165]**.

#### 3.1.4 ~~The four-eyes disable request, as built — [DEC-166]~~

⚠ **Superseded 2026-10-12 by [DEC-179].** Migration 29 (`CustomerFourEyesDisableRequest`) added `four_eyes_disable_requested_by_account_id` (a foreign key to `customer.customer_account`, `ON DELETE RESTRICT`, indexed as `ix_customer_four_eyes_disable_requested_by_account_id`) and `four_eyes_disable_requested_at` to `customer.customer`, with the `CHECK`s `ck_customer_four_eyes_disable_request_complete` and `ck_customer_four_eyes_disable_request_implies_on`. **Migration 39 (§7.11) drops all of them, together with `four_eyes_enabled`**, after writing one audit row for every company that had the mode on, including any pending turn-off request. Old migrations are never edited: 29 stays in the history. What still stands from this section is the **lock order** it recorded, one global order for every writer that takes more than one row: **admin roster** (`customer.customer_membership`), then the **company row**, then its **bank-account** rows, then the **withdrawal** row, then the **wallet** row — §5, and api-contracts §2.7 for the path-by-path check. The `FOUR_EYES_*` audit rows that exist stay readable; no new ones are written.

#### Self-service onboarding and the credential store — ⚠ added 2026-09-03

Three tables **[DEC-113]**, **[DEC-117]**. They did not exist when this document was written because
the proof of concept was to run unauthenticated **[DEC-20]**; it does not.

```sql
-- A rotating, single-use refresh token, stored HASHED  [DEC-117]. The plaintext lives only in the
-- HttpOnly SameSite=Strict cookie scoped to the refresh endpoint; it is never returned in a body.
-- ⚠ Was scoped by ACCOUNT alone, its RLS policy joining through customer_account. AMENDED
--   2026-09-10 by [DEC-152], migration 15 — see customer_id below.
CREATE TABLE customer.refresh_token (
    id                   uuid PRIMARY KEY,
    customer_account_id  uuid NOT NULL REFERENCES customer.customer_account(id),

    -- ⚠ ADDED 2026-09-10 by [DEC-152], migration 15, and NOT the EXISTS-through-membership shape
    --   customer_account and password_reset_token take. A removal that revokes the member's
    --   tokens in the SAME transaction as the removal would, under an EXISTS through membership,
    --   see its own removal, find no active membership, and revoke ZERO ROWS silently — a stolen
    --   cookie bound to business A would stay a valid session for business B. This column and a
    --   uniform customer_id = <app.customer_id> policy close that hole.
    customer_id          uuid NOT NULL REFERENCES customer.customer(id),

    token_hash           varchar(64) NOT NULL,
    issued_at            timestamptz NOT NULL,
    expires_at           timestamptz NOT NULL,      -- issued_at + 14 days
    used_at              timestamptz,               -- single use: a second presentation is theft
    revoked_at           timestamptz,
    replaced_by_token_id uuid                       -- the rotation chain, so theft revokes all of it
);

CREATE INDEX ix_refresh_token_customer_account_id
    ON customer.refresh_token (customer_account_id);
CREATE INDEX ix_refresh_token_customer_id
    ON customer.refresh_token (customer_id);

-- ⚠ Added 2026-09-10 by [DEC-152], migration 15. The evidence columns above — used_at, revoked_at,
--   replaced_by_token_id — may be SET and never CLEARED. The business-switch grant this migration
--   adds (INSERT, and UPDATE of used_at/replaced_by_token_id, to app_customer_role) reopens a hole
--   migration 3 had closed: with all three columns writable, `UPDATE ... SET used_at = NULL,
--   revoked_at = NULL, replaced_by_token_id = NULL` names only granted columns and the FOR ALL
--   policy's USING arm passes for the caller's own row, so nothing else refuses it — a plain
--   UPDATE would unmark a used, revoked, replaced token and hand it back as a live credential. A
--   GRANT cannot express "set, never clear"; a trigger can, and it binds the OWNER too,
--   deliberately, because the Worker, the seeders and every test fixture write on the owner
--   connection. What stays legal is NULL -> a value, exactly what a rotation and a sign-out do.
CREATE FUNCTION customer.refresh_token_evidence_is_monotonic() RETURNS trigger AS $rt$
BEGIN
    IF (OLD.used_at IS NOT NULL AND NEW.used_at IS NULL)
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)
    OR (OLD.replaced_by_token_id IS NOT NULL AND NEW.replaced_by_token_id IS NULL) THEN
        RAISE EXCEPTION
            'customer.refresh_token records evidence: used_at, revoked_at and replaced_by_token_id may be set, never cleared'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$rt$ LANGUAGE plpgsql;

CREATE TRIGGER trg_refresh_token_evidence_monotonic BEFORE UPDATE ON customer.refresh_token
    FOR EACH ROW EXECUTE FUNCTION customer.refresh_token_evidence_is_monotonic();

-- The platform owns password reset  [DEC-113]. Same shape, same hashing, no rotation chain.
-- ⚠ Unlike refresh_token above, this table keeps the ACCOUNT join: its RLS policy is re-pointed
--   2026-09-10 by [DEC-152], migration 15, to an EXISTS through customer_membership rather than
--   through the now-dropped customer_account.customer_id, but it gains no customer_id column
--   of its own.
CREATE TABLE customer.password_reset_token (
    id                   uuid PRIMARY KEY,
    customer_account_id  uuid NOT NULL REFERENCES customer.customer_account(id),
    token_hash           varchar(64) NOT NULL,
    issued_at            timestamptz NOT NULL,
    expires_at           timestamptz NOT NULL,
    used_at              timestamptz
);

CREATE INDEX ix_password_reset_token_customer_account_id
    ON customer.password_reset_token (customer_account_id);

-- The nine-step wizard's draft, before a company exists  [DEC-113]. Every column after the first
-- block is nullable because a partial save is the normal case: the customer is on step 3.
CREATE TABLE customer.onboarding_application (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reference            varchar(16) NOT NULL,      -- what the customer quotes to support
    status               text NOT NULL,             -- DRAFT | AWAITING_SIGNATURE | SIGNED
    created_at           timestamptz NOT NULL,

    -- Step 1. The credential is captured here and moves to customer_account at signing.
    first_name           varchar(100) NOT NULL,
    last_name            varchar(100) NOT NULL,
    email                citext NOT NULL,
    password_hash        varchar(200) NOT NULL,     -- Argon2id, from the first keystroke
    terms_accepted_at    timestamptz NOT NULL,
    terms_version_id     uuid REFERENCES legal.document_version(id) ON DELETE RESTRICT,  -- [DEC-174]: the Terms of Use version current when the applicant accepted; NULL if none was published. Written by the server, never sent by the client
    terms_language       varchar(2) CHECK (terms_language IN ('en', 'nl')),  -- [DEC-177]: the language actually served; NULL where terms_version_id is NULL and for rows from before migration 38

    organization_name    varchar(200),              -- steps 2-4
    legal_entity_type    text,                      -- BV | NV | EENMANSZAAK | VOF | ...
    kvk_number           varchar(8),
    registered_address   jsonb,
    industry             varchar(60),
    flow_direction       text,                      -- steps 5-6: CONSUMPTION | PRODUCTION | BOTH
    volume_band          text,   -- UP_TO250_MWH … ABOVE2500_MWH: identifiers, kept; their labels are in kWh [DEC-180] (11), printed kW [DEC-181]
    iban                 varchar(34),               -- steps 6-7
    bank_account_holder  varchar(200),
    bank_verified_at     timestamptz,
    signing_authority    text,                      -- ALONE | JOINTLY | SOMEONE_ELSE
    signatories          jsonb NOT NULL,            -- step 8; '[]' until then

    -- Step 9. The code is HASHED and attempt-counted; the plaintext is emailed and never stored.
    sign_code_hash       varchar(64),
    sign_code_expires_at timestamptz,
    sign_code_attempts   integer NOT NULL,
    signed_at            timestamptz,

    -- Written at signing, null for every draft. This is why the table has no RLS policy — see §6.
    customer_id          uuid,
    account_id           uuid
);
```

⚠ **`onboarding_application` deliberately has no row-level-security policy.** Its `customer_id` is
null for the entire life of a draft and every path that touches it is **anonymous** — a prospect has
no company and no token, so there is no `app.customer_id` to key a policy on. A policy of migration
2's shape would evaluate false on every row and make the wizard unreadable to the only requests that
need it. What contains it instead is that a row is addressed by its own id — a capability, not a
query. §6 records the exemption and what reopens it.

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

-- ⚠ Removed 2026-10-15 by [DEC-182] (2), migration 45 RemoveEanPool: claimed rows copied to audit.audit_record (EAN_POOL_CLAIM), then the table is dropped.
-- ⚠ Added 2026-09-03  [DEC-113]. The shared pool of unclaimed grid connections both portals draw
-- from. Self-service onboarding needs somewhere to claim a connection FROM, and a customer cannot
-- be handed a connection that belongs to nobody unless the pool exists as reference data.
--
-- `btree_gist` (§0) is what lets the equality and the range sit in one exclusion constraint on
-- customer.metering_point; this table has no such constraint of its own, only a unique EAN.
CREATE TABLE metering.ean_pool (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ean                    varchar(18) NOT NULL UNIQUE
        CHECK (ean ~ '^[0-9]{18}$'),               -- eighteen digits only, for now  [DEC-114]
    commodity              text NOT NULL,          -- ELECTRICITY
    grid_operator          varchar(120),
    capacity_kw            numeric(18,6),
    address                jsonb,

    -- A claim takes the row OUT of the pool. `claimed_by_customer_id` records who took it; it is
    -- deliberately NOT a tenancy key — see §6.
    claimed_at             timestamptz,
    claimed_by_customer_id uuid
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

-- ⚠ Corrected by [DEC-143]. The previous form had document_id, document_created and
--   inbound_message_id all NOT NULL and no `source` column, which made [F02-R36]'s manual
--   version unstorable. `source` is the discriminator; the two checks below are what stop it
--   becoming a column anybody can set to anything.
CREATE TABLE metering.interval_data_version (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    metering_point_id  uuid NOT NULL REFERENCES customer.metering_point(id),
    customer_id        uuid NOT NULL REFERENCES customer.customer(id),   -- S2-D1
    delivery_date      date NOT NULL,
    direction          text NOT NULL CHECK (direction IN ('CONSUMPTION','PRODUCTION')),
    source             text NOT NULL CHECK (source IN ('BRP_FEED','MANUAL')),
    document_id        text,
    document_created   timestamptz,
    received_at        timestamptz NOT NULL,
    inbound_message_id uuid REFERENCES metering.inbound_message(id),
    correlation_id     uuid NOT NULL,
    interval_count     smallint NOT NULL CHECK (interval_count IN (92, 96, 100)),
    is_current         boolean NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now(),

    -- A BRP_FEED version is the document it came from, so all three must be present.
    CONSTRAINT ck_idv_brp_feed_has_message CHECK (
        source <> 'BRP_FEED'
        OR (inbound_message_id IS NOT NULL
            AND document_id IS NOT NULL
            AND document_created IS NOT NULL)),

    -- A MANUAL version has no document and no message.  [F02-R36]
    CONSTRAINT ck_idv_manual_has_no_message CHECK (
        source <> 'MANUAL' OR inbound_message_id IS NULL)
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
| A stored document keeps the BRP that produced it | `metering.inbound_message.brp_id`, `NOT NULL`. `interval_data_version` reaches it through `inbound_message_id`, so the version needs no column of its own and cannot disagree with the message it came from **[F02-R43]**, **[DEC-07]**. ⚠ **[DEC-143]** makes that foreign key NULLABLE, because a `MANUAL` version has no message and no BRP; `ck_idv_brp_feed_has_message` is what keeps it `NOT NULL` in substance for every `BRP_FEED` row |
| Reassignment reads **forward** | Nothing is rewritten. `brp_assigned_at` records when the current assignment started; the change event — actor, time, reason — is an ordinary `audit` row **[DEC-17]**, **[F02-R43]** |

⚠ **The credential column is a reference, never a secret.** A BRP is identified **by the credential
that authenticated the request**, never by a field in the payload ([Security](07-security.md) §4.1);
storing the secret here would put every BRP's credential one `SELECT` away from every reader of
reference data.

#### 3.2.2 EDSN master data and grid-operator names — [DEC-182], added 2026-10-15

⚠ **As built 2026-10-16 by [DEC-182] (7), (8), (13), on `feature/ean-search`; not on the VM until the landing.** Two tables in the `metering` schema, created by migration 44 (`20261015082132_EanSearchMasterData`). Neither has a `customer_id` or a row-security policy, on purpose (§6). **Built as designed (checked 2026-10-16 against the migration, `src/Infrastructure/PeakPower.Persistence/Migrations/20261015082132_EanSearchMasterData.cs` lines 58 to 124):** every column, type and nullability below, both primary keys, the five check constraints (`ck_connection_master_data_ean`, `_item`, `_gps`, `ck_grid_operator_code`, `_source`) and the grants are as written; the migration also adds `customer.metering_point.edsn_verified_at timestamptz NULL` (§3.1).

```sql
-- ⚠ New 2026-10-15 [DEC-182] (7). One row per EAN that a search, an attach, a popup or the backfill has met.
CREATE TABLE metering.connection_master_data (
    ean                varchar(18) NOT NULL,
    searched_at        timestamptz,                  -- last time an EDSN search returned this EAN
    search_hit         jsonb,                        -- the search result of that search
    fetched_at         timestamptz,                  -- last SUCCESSFUL master-data fetch, zero items included
    item_count         integer,                      -- items EDSN returned over every page read (0 = no master data)
    pages_complete     boolean,                      -- false when paging stopped early
    item_id            bigint,                       -- the chosen item
    mutation_date      date,                         -- its mutationDate: the popup's "as of"
    mutation_type      text,
    dossier_id         text,
    received_date      timestamp without time zone,  -- as EDSN sent it, no offset
    external_reference text,
    update_data        text,                         -- the chosen item's updateData, VERBATIM
    facts              jsonb,                        -- parsed from update_data; can be re-derived without EDSN
    gps_latitude       numeric(9,6),                 -- from a Pro6pp address suggestion, for one address
    gps_longitude      numeric(9,6),
    gps_address_key    text,                         -- the normalised address the coordinates belong to
    gps_recorded_at    timestamptz,
    CONSTRAINT pk_connection_master_data PRIMARY KEY (ean),
    CONSTRAINT ck_connection_master_data_ean  CHECK (ean ~ '^[0-9]{18}$'),
    CONSTRAINT ck_connection_master_data_item CHECK ((item_id IS NULL) = (update_data IS NULL)),
    CONSTRAINT ck_connection_master_data_gps  CHECK ((gps_latitude IS NULL) = (gps_longitude IS NULL))
);

-- ⚠ New 2026-10-15 [DEC-182] (8). The grid-operator mapping list, plus the codes asked once.
CREATE TABLE metering.grid_operator (
    code          varchar(13) NOT NULL,              -- the mapping's eanSubOperator
    name          text NOT NULL,                     -- nameSubOperator: what the popup shows
    operator_code varchar(13) NOT NULL,              -- eanOperator
    operator_name text NOT NULL,                     -- nameOperator
    source        text NOT NULL,                     -- which endpoint last confirmed it
    refreshed_at  timestamptz NOT NULL,
    CONSTRAINT pk_grid_operator PRIMARY KEY (code),
    CONSTRAINT ck_grid_operator_code   CHECK (code ~ '^[0-9]{13}$'),
    CONSTRAINT ck_grid_operator_source CHECK (source IN ('LIST', 'LOOKUP'))
);
```

No secondary index: every read is by primary key, and the backfill joins from `customer.metering_point`, whose EAN index exists. A refresh upserts every listed row and deletes nothing, so a code once named stays named; a sub-operator the list files under an unexpected parent is stored as given.

**Grants.** `REVOKE ALL` on both tables from both application roles first (migration 2's default privileges grant everything on `CREATE TABLE`), then:

| Table | `app_customer_role` | `app_employee_role` |
| --- | --- | --- |
| `metering.connection_master_data` | `SELECT` | `SELECT, INSERT, UPDATE` |
| `metering.grid_operator` | `SELECT` | `SELECT, INSERT, UPDATE` |

No `DELETE` for either role. The new column `customer.metering_point.edsn_verified_at` needs no grant: table privileges cover added columns. The customer role keeps table-level `UPDATE` on `customer.metering_point` for the rename, so a SQL actor holding it could set `edsn_verified_at` on its own rows; a column-level `REVOKE` does not narrow a table-level grant in PostgreSQL. That is accepted: it forges a back-office mark on the actor's own connection only, and the migration says so.

**Who writes.** One store, three statements, each an `INSERT … ON CONFLICT (ean) DO UPDATE` that touches only its own columns (the search hit, the master data, the coordinates), so concurrent searches never raise a unique violation inside a request transaction, and each guarded on its own timestamp so an older fetch finishing late never overwrites a newer one. The grid-operator store upserts likewise. The customer API writes through the owner path after its endpoint has decided the write; the employee API connects as its own role; the Worker as the owner.

**The latest item ([DEC-182] (7)).** Keep the items whose mutation date is not null and on or before today in Amsterdam. Order them by mutation date, then received date, then id, all descending. Take the first, or none. Whether its `updateData` parsed plays no part: an unreadable latest item is still the latest, is stored raw with `facts` null, and the popup then shows only the search fields with the "no master data" notice, never an older item as current.

**The 24-hour rule.** A popup refetches when `fetched_at` is null or older than 24 hours; a failed refetch serves the stored copy and says so, and with nothing stored the popup says EDSN could not be reached. A search skips an EAN fetched within the last five minutes (`Edsn:MasterDataRecentWindow`); an attach always refetches.

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

-- ⚠ As built 2026-10-01 by [DEC-169] and [DEC-149] — the table above is NOT what was migrated. Migration 12
-- created market.day_ahead_price keyed (delivery_date date, pos smallint) — PRIMARY KEY (delivery_date, pos),
-- no id, no market_area, no validity range, no EXCLUDE — with interval_start timestamptz (the Amsterdam-local
-- start instant) and price_eur_per_kwh numeric(12,5), signed, because a negative day-ahead price is ordinary.
-- The next migration added source varchar(32) NOT NULL, with no default. A row's source was EPEX (the seeded
-- export), DERIVED_FROM_yyyy-MM-dd (a re-dated price) or ENTSOE (the ENTSO-E A44 feed).
-- ⚠ As built 2026-10-02 by [DEC-172]: only ENTSOE is stored. The migration RemoveSeededDayAheadPrices runs
-- DELETE … WHERE source <> 'ENTSOE' once (its Down does nothing), the seeder is removed, and no schema or
-- model-snapshot change was made. The job also deletes rows with delivery_date < DayAheadIngestion:BackfillFrom
-- (2026-01-01) at the start of each tick. The job writes with INSERT … ON CONFLICT (delivery_date, pos) DO UPDATE,
-- which completes a half-written day [DEC-172] (4).
-- The table is read-only to the customer and employee roles (SELECT only), market reference data, no RLS.
-- ⚠ As built 2026-10-13 by [DEC-180] (7): migration 40 (20261013164002_DayAheadFeed) adds updated_at timestamp with time zone NULL (null until a stored
-- price is replaced by a different one; no default, no index, no backfill). source may read SIMULATED on a local run-mode
-- stack. A second table, market.day_ahead_feed_run, holds one row per tick: below.
CREATE TABLE market.day_ahead_feed_run (
    id                    uuid                     NOT NULL,  -- set by the application (Guid.CreateVersion7)
    started_at            timestamp with time zone NOT NULL,  -- the tick's start; the stamp of every price it changed
    finished_at           timestamp with time zone NOT NULL,
    outcome               text                     NOT NULL,  -- IDLE | COMPLETED | FAILED | NOT_CONFIGURED
    source                character varying(32)    NULL,      -- ENTSOE | SIMULATED; null when no source
    window_from           date                     NOT NULL,  -- DayAheadIngestion:BackfillFrom at this tick
    tick_interval_seconds integer                  NOT NULL,  -- DayAheadIngestion:Interval at this tick
    requests              integer                  NOT NULL,
    not_published         integer                  NOT NULL,  -- requests answered "no matching data"
    days_stored           integer                  NOT NULL,  -- delivery days that got at least one new row
    rows_stored           integer                  NOT NULL,
    days_changed          integer                  NOT NULL,  -- delivery days with at least one rewritten price
    rows_changed          integer                  NOT NULL,
    rows_pruned           integer                  NOT NULL,
    recheck               text                     NOT NULL,  -- NOT_RUN | DONE | FAILED | SKIPPED
    recheck_from          date                     NULL,
    recheck_to            date                     NULL,
    max_source_decimals   smallint                 NULL,      -- most significant decimals in a source amount this tick
    failure_code          text                     NULL,      -- UNAVAILABLE | REFUSED | UNREADABLE | ERROR
    failure_detail        character varying(500)   NULL,
    CONSTRAINT pk_day_ahead_feed_run PRIMARY KEY (id)
);
CREATE INDEX ix_day_ahead_feed_run_started_at ON market.day_ahead_feed_run (started_at DESC);
REVOKE ALL ON market.day_ahead_feed_run FROM app_customer_role;  -- the employee role keeps SELECT; only the owner writes; no RLS (no tenant column)
```

The six `CHECK`s of `market.day_ahead_feed_run` (as built):

| Constraint | Rule |
| --- | --- |
| `ck_day_ahead_feed_run_outcome` | `outcome IN ('IDLE','COMPLETED','FAILED','NOT_CONFIGURED')` |
| `ck_day_ahead_feed_run_recheck` | `recheck IN ('NOT_RUN','DONE','FAILED','SKIPPED')` |
| `ck_day_ahead_feed_run_failure_code` | `failure_code IS NULL OR failure_code IN ('UNAVAILABLE','REFUSED','UNREADABLE','ERROR')` |
| `ck_day_ahead_feed_run_failed_has_code` | `(outcome = 'FAILED') = (failure_code IS NOT NULL)` |
| `ck_day_ahead_feed_run_times` | `finished_at >= started_at AND tick_interval_seconds > 0` |
| `ck_day_ahead_feed_run_counts` | each of the seven count columns `>= 0` |

Migration 40 also widens the alert-kind `CHECK` on `metering.operational_alert` to seven kinds (`DAY_AHEAD_PRICES_MISSING` is the seventh). No `CHECK` is added to `market.day_ahead_price.source`, and no index on `updated_at`.

```sql

-- The customer never sees a raw Montel quote  [DEC-80], [F04-R17]. Every customer-facing indication
-- is quote × (1 + markup_rate), and the rate is REFERENCE DATA with a default of 2% (0.0200), changed
-- by an employee without a release  [F04-R18] — not a constant, not an appsettings value.
--
-- ⚠ Reconciled 2026-09-23 by [DEC-161]. The percentage/daterange shape below was never migrated —
-- no prior round created this table — so this is the table as built, not a schema change against
-- live data: markup_rate is a FRACTION (0.0200 = 2 %), not the 2.0000-per-cent shape [F04] §3.1
-- originally sketched. It is the only fractional rate column in this schema — there is no VAT rate
-- column at all [DEC-76], and the energy-tax tiers store an absolute €/kWh rate, not a fraction — so
-- "matches every other rate column" is not the reason; removing the one × 100 at the boundary where a
-- scale error is invisible until an invoice disagrees is. validity is a generated tstzrange from
-- valid_from/valid_to — the platform's established house shape for a validity range, not a first.
-- customer.metering_point.validity already derives its range the same way, a GENERATED daterange
-- from valid_from/valid_to (InitialSchema.cs:262-264, its EXCLUDE at :268-271), which is the
-- precedent this table follows. EF Core has no native range mapping, so both tables add the
-- generated column via raw SQL and map only valid_from/valid_to in the EF model.
CREATE TABLE market.price_indication_markup (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- this IS the pinned version id
    markup_rate numeric(6,4) NOT NULL CHECK (markup_rate > 0),  -- 0.0200 = 2 %; > 0, no upper bound
    valid_from  timestamptz NOT NULL,
    valid_to    timestamptz NULL,
    note        text,
    created_by  varchar(128) NOT NULL,
    created_at  timestamptz NOT NULL,                         -- no DEFAULT now(); set explicitly by the writer

    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
-- validity is generated rather than declared inline: EF Core has no native tstzrange mapping, so the
-- column and its EXCLUDE both land via migrationBuilder.Sql in the same migration, and EF maps only
-- valid_from/valid_to.
ALTER TABLE market.price_indication_markup
    ADD COLUMN validity tstzrange GENERATED ALWAYS AS (tstzrange(valid_from, valid_to, '[)')) STORED;
ALTER TABLE market.price_indication_markup
    ADD CONSTRAINT price_indication_markup_validity_excl
    EXCLUDE USING gist (validity WITH &&);  -- platform-wide: one rate in force at a time  [F04-R18]

-- ⚠ New 2026-09-23 [DEC-161]. Product and observation did not exist in this file before this round —
-- F04 §7 described them, but no migration had shipped either. 24 seeded rows: 6 months + 4 quarters +
-- 2 years, × Base/Peak  [DEC-161].
CREATE TABLE market.price_indication_product (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            varchar(32) NOT NULL UNIQUE,          -- NL_POWER_BASE_M1 … NL_POWER_PEAK_Y2
    commodity       varchar(16) NOT NULL DEFAULT 'ELECTRICITY'
                        CHECK (commodity = 'ELECTRICITY'),  -- gas stays out  [DEC-68]
    shape           varchar(8) NOT NULL CHECK (shape IN ('BASE', 'PEAK')),
    period_type     varchar(8) NOT NULL CHECK (period_type IN ('MONTH', 'QUARTER', 'YEAR')),
    relative_offset smallint NOT NULL CHECK (relative_offset BETWEEN 1 AND 36),
    montel_ticker   varchar(64) NULL,                      -- empty until [OQ-23] delivers 24 symbols
    display_name    varchar(64) NOT NULL,
    display_order   smallint NOT NULL,
    active          boolean NOT NULL DEFAULT true,

    UNIQUE (shape, period_type, relative_offset)
);

-- Append-only  [DEC-161]. raw_price is never marked up on the way in — [F04-R01], §5.2 of the Montel
-- integration doc.
-- ⚠ Unchanged by [DEC-180] (2): what the source sent. Readers get price_eur_per_kwh from the view and the function.
CREATE TABLE market.price_indication_observation (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id     uuid NOT NULL REFERENCES market.price_indication_product(id),
    delivery_start date NOT NULL,
    delivery_end   date NOT NULL CHECK (delivery_end > delivery_start),
    raw_price      numeric(12,4) NOT NULL,                 -- may be negative; never filtered
    currency       char(3) NOT NULL CHECK (currency = 'EUR'),
    unit           varchar(8) NOT NULL CHECK (unit = 'MWH'),
    ticker         varchar(64) NULL,                       -- the product's montel_ticker at poll time, any source; NULL in Phase 1 (unconfigured)  [OQ-23]
    observed_at    timestamptz NOT NULL,
    received_at    timestamptz NOT NULL,
    source         varchar(32) NOT NULL                    -- 'SIMULATED' | future real source ids
);
CREATE INDEX ix_price_indication_observation_lookup
    ON market.price_indication_observation (product_id, delivery_start, source, observed_at DESC);

CREATE FUNCTION market.price_indication_observation_is_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'market.price_indication_observation is append-only' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_price_indication_observation_append_only
    BEFORE UPDATE OR DELETE ON market.price_indication_observation
    FOR EACH ROW EXECUTE FUNCTION market.price_indication_observation_is_append_only();

-- Least-privilege latest-row view  [DEC-161] (5). One row per product/period/source by construction —
-- app_customer_role reads this and loses SELECT on the raw table entirely.
CREATE VIEW market.price_indication_latest AS
    SELECT DISTINCT ON (product_id, delivery_start, source)
        product_id, delivery_start, delivery_end, raw_price,
        currency, unit, observed_at, received_at, source
    FROM market.price_indication_observation
    ORDER BY product_id, delivery_start, source, observed_at DESC;

REVOKE SELECT ON market.price_indication_observation FROM app_customer_role;
-- the view keeps its inherited SELECT — a view's privileges do not follow a REVOKE on its base table
```

Precomputing the interval spine turns coverage, invoicing and charting from per-row date arithmetic
into joins. Peak membership is materialised per calendar version, so answering "is this interval a
peak interval under the calendar this trade was priced with" is an index lookup.

**The markup is `> 0`, and that is not a formality — [DEC-80], [F04-R18].** A markup of zero renders
the raw quote, which is exactly what **[DEC-80]** forbids and what the Montel licence **[DEC-27]**
is read as restricting. **[DEC-80]** names no upper bound, so none is enforced. The table is
effective-dated for the same reason every rate table here is: an indication captured against a trade
request keeps the rate in force when it was captured **[F04-R10]**, and a later change must not
restate it. ⚠ Which **side** of the market is marked up is not settled — **[DEC-80]**'s comment says
*bid*, the answer it came with says *ask* — and it is carried on **[OQ-23]** with the missing ticker
symbols, now 24 of them **[DEC-161]**. The column is the same either way. ⚠ **No row in force at
render time is `UNAVAILABLE`, never a silent 0%** — see the fixed §7.3 note below.

### 3.4 Trading

⚠ **Slice 1 is designed in §3.4.4 (2026-09-29, [DEC-167]).** The sketch below is the **2026-08 design**; where it and §3.4.4 differ — there is **no `approval_request_id`**, ~~the refusal is stored on the trade,~~ *(⚠ the approver and refuser columns are dropped by migration 39, §7.11)* the gross is a stored column, and events carry no `payload` — §3.4.4 wins.

⚠ **Reversed 2026-08-19 by [DEC-71].** The table below is **not created**. It is kept, struck, with
its reasoning readable, because it is the only record of what was designed against **[DEC-33]** and
of what the reversal costs. **[F05-R50]**…**[F05-R54]** retire with it; the mode and the flag that
replace them are in §3.1.2 ~~and the shared approval record is `customer.approval_request`~~ *(both struck 2026-10-12, [DEC-179])*.

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
    --   ⚠ [DEC-180] (10): see §3.4.5 for the columns in kW, kWh and €/kWh
    total_power_mw      numeric(12,6) NOT NULL
        CHECK (total_power_mw >= 0.01 AND mod(total_power_mw, 0.01) = 0),
    total_mwh           numeric(16,6) NOT NULL,
    price_eur_mwh       numeric(12,4),
    total_value         numeric(18,6),
    offered_at          timestamptz,
    expires_at          timestamptz,

    -- who accepted. (Was: four eyes [DEC-71], [F05-R71]. ⚠ approved_by, approval_request_id and the
    -- other four-eyes columns are struck 2026-10-12, [DEC-179]; migration 39 drops the built ones.)
    accepted_by_account_id         uuid REFERENCES customer.customer_account(id),
    -- approved_by_account_id         uuid REFERENCES customer.customer_account(id),
    -- approval_request_id            uuid REFERENCES customer.approval_request(id),
    -- ⚠ Dropped 2026-08-19 by [DEC-71] — there is no threshold to pin and no amount to record:
    -- four_eyes_threshold_version_id uuid REFERENCES trading.four_eyes_threshold(id),
    -- threshold_amount_applied       numeric(18,6),

    row_version         bigint NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),

    -- ⚠ Struck 2026-10-12 by [DEC-179]: four eyes is two account ids, not a permission  [T10], [F05-R59]
    -- CHECK (approved_by_account_id IS NULL
    --        OR approved_by_account_id <> accepted_by_account_id),
    -- CHECK (approved_by_account_id IS NULL OR accepted_by_account_id IS NOT NULL),
    -- ⚠ Dropped by [DEC-71]: acceptance no longer pins anything, because there is no versioned
    --   threshold row to pin. What acceptance now reads is the company's four_eyes_enabled flag
    --   at that instant  [F05-R28], [F05-R71], and the evidence it happened is the approval row.
    -- CHECK (accepted_by_account_id IS NULL OR four_eyes_threshold_version_id IS NOT NULL)
    -- CHECK (approved_by_account_id IS NULL OR approval_request_id IS NOT NULL)
);
CREATE INDEX ix_trade_open ON trading.trade (state, created_at)
    WHERE state IN ('REQUESTED','OFFERED','ACCEPTED');                       -- 'AWAITING_APPROVAL' removed 2026-10-12, DEC-179
CREATE INDEX ix_trade_expiring ON trading.trade (expires_at)
    WHERE state = 'OFFERED';                                                -- 'AWAITING_APPROVAL' removed 2026-10-12, DEC-179
CREATE INDEX ix_trade_requester ON trading.trade (customer_id, requested_by_account_id, created_at DESC);
-- CREATE INDEX ix_trade_awaiting_approval ON trading.trade (customer_id, expires_at)   -- never built (2026-08 sketch only); nothing to drop, DEC-179
--     WHERE state = 'AWAITING_APPROVAL';

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

-- ⚠ DROPPED 2026-09-30 by [DEC-167] (16): a block is account-level, so this table was removed from migration 30 in place.
-- Kept below only to show the design that was reversed; it is not built.
CREATE TABLE trading.block_allocation (
    block_id          uuid NOT NULL REFERENCES trading.block(id),
    metering_point_id uuid NOT NULL REFERENCES customer.metering_point(id),
    -- ⚠ Amended 2026-08-19 by [DEC-70]: allocations are whole multiples of 0.01 MW, was 0.1 MW
    -- ⚠ [DEC-180] (10): see §3.4.5 for the columns in kW, kWh and €/kWh
    power_mw          numeric(12,6) NOT NULL
        CHECK (power_mw >= 0.01 AND mod(power_mw, 0.01) = 0),
    PRIMARY KEY (block_id, metering_point_id)
);
```

⚠ **Reversed 2026-09-30 ([DEC-167] (16)): there are no allocations, so Invariant B1 has nothing to check.** The original text follows. Invariant B1 (allocations sum exactly to the block power) is checked in the domain and re-checked by
a deferred constraint trigger, because it is the kind of thing a bad migration could break silently.
Under **[DEC-70]** both sides of that sum are multiples of 0,01 MW, so the sum is still exact — the
`numeric` type and the `mod` check do the work, and no tolerance appears anywhere — §3.4.3.

#### 3.4.1 ~~Both trade indexes changed with [DEC-33] [DEC-71]~~ — back to their original shape by [DEC-179]

⚠ **Amended 2026-10-12 by [DEC-179].** `AWAITING_APPROVAL` was a state between `OFFERED` and `ACCEPTED` that made both partial indexes wrong the moment it was added (a partial index silently returns fewer rows rather than failing). With the state gone the indexes lose it again, in migration 39 (§7.11):

| Index | Was (2026-08, [DEC-71]) | Now | Why |
| --- | --- | --- | --- |
| `ix_trade_open` | `state IN ('REQUESTED','OFFERED','AWAITING_APPROVAL','ACCEPTED')` | `state IN ('REQUESTED','OFFERED','ACCEPTED')` | No live row can be `AWAITING_APPROVAL` |
| `ix_trade_expiring` | `state IN ('OFFERED','AWAITING_APPROVAL')` | `state = 'OFFERED'` | It drives the expiry sweep, which releases nothing for an `OFFERED` trade (no money is held before acceptance) |
| `ix_trade_awaiting_approval` | `state = 'AWAITING_APPROVAL'` per customer | **never built** | It would have served the desk's *Awaiting approval* queue, which is removed. The approval indexes that were built, `ix_trade_approved_by_account_id` and `ix_trade_approval_refused_by_account_id`, are dropped by migration 39 (§7.11) |

~~The expiring index was the sharper of the two: a trade in `AWAITING_APPROVAL` holds an active reservation, so a row the expiry job could not see was a reservation never released.~~ That risk is gone with the state. **A terminal `APPROVAL_REFUSED` row is not in either index** (it is closed), so tightening them touches no history.

#### 3.4.2 ~~The four-eyes columns~~

⚠ **Struck 2026-10-12 by [DEC-179].** This section argued that `CHECK (approved_by_account_id <> accepted_by_account_id)` was the database's copy of the whole four-eyes rule, and recorded that the replacement for the threshold pinning was weaker (the trade records *that* an approval happened but not what rule was in force). Neither the columns nor the rule exist any more. Migration 39 (§7.11) drops `four_eyes_applied`, `approved_by_account_id`, `approval_decided_at` and `approval_refused_by_account_id`, their two foreign keys and indexes, and the `CHECK`s `ck_trade_awaiting_approval_is_four_eyes`, `ck_trade_four_eyes_approved`, `ck_trade_approver_not_acceptor`, `ck_trade_refuser_not_acceptor`, `ck_trade_single_approval_decision` and `ck_trade_refusal_recorded`, and re-creates `ck_trade_reservation_present` without `four_eyes_applied IS NOT NULL`, **after** a parity guard: every trade that has an approver or a refuser has the matching append-only `trade_event`, so the fact survives in the log. **Kept:** the `trade_event` `CHECK`s `ck_trade_event_type`, `_from_state` and `_to_state` are not touched, because the table is append-only by trigger and its history rows carry `APPROVED`, `APPROVAL_REFUSED` and `AWAITING_APPROVAL`. The state `APPROVAL_REFUSED` stays in `ck_trade_state` for terminal rows; `AWAITING_APPROVAL` leaves it.

#### 3.4.3 Volume granularity and short selling — [DEC-70], [DEC-72]

⚠ **Amended 2026-10-13 by [DEC-180] (10): the grid is 10 kW and the minimum 10 kW (the 0,01 MW of [DEC-70], in kW); the columns, the `CHECK`s and the types are in §3.4.5.**

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

#### 3.4.4 Trading slice 1 — the `trading` schema as designed — [DEC-167]

⚠ **Amended 2026-09-30 as built ([DEC-167] (16)) — the volume is for the whole account.** Migration 30 was amended **in place** (it had never been released; the local database is restored and re-migrated): `trading.trade_line (trade_id, metering_point_id, power_mw, mwh)` became `trading.trade_connection (trade_id, metering_point_id, ean, connection_name)` with **no power** and the same primary key, grants and row-level security; **`trading.block_allocation` is dropped**; `trading.trade` keeps its one `total_power_mw` and `trading.block` its `power_mw`. The schema is therefore **four tables, two triggers and eight policies** (⚠ five tables from migration 32 on 2026-10-01 [DEC-168]: `trading.trade_desk_notice`, owner-only, no policy, so still eight policies); wherever the table below or the paragraphs after it say five, three or ten, or name a line or an allocation, this note wins. ⚠ **Amended 2026-10-13 by [DEC-180] (10): see §3.4.5.**

⚠ **Added 2026-09-29.** Migration **30** (`Trading`) — the next free number when it lands; 29 is **[DEC-166]**'s. EF owns the column list (snake_case by convention) and declares every `CHECK`, so the snapshot agrees; raw SQL adds the grants, the row-level security, the triggers and the ledger index filters. It has a real `Down()`: drop the policies, triggers and functions, revoke, drop the tables, the sequence, the schema and the two ledger indexes. Roll forward in production, as every migration here.

| Table | Contents and the constraints that matter |
| --- | --- |
| `trading.trade_reference_seq` | `bigint`, starts at **1001**. `trading.trade.reference` defaults to `'TRD-' \|\| nextval(...)` — **TRD-1001**, unique |
| `trading.trade` | `id`, `reference`, `customer_id` (RESTRICT), `direction`, `shape`, `period_type`, `period_code`, `delivery_start`/`delivery_end` (exclusive), `delivery_starts_at` (Amsterdam local midnight, captured at submit), `calendar_version` (the constant text `NL-POWER-PEAK-EXCHANGE`), `state`, `total_power_mw numeric(12,6)`, `total_mwh numeric(18,6)`, `comment`, `requested_by_account_id`; the **captured indication** `indication_product_id`, `indication_raw_price numeric(12,4)`, `indication_observed_at`, `indication_source`; the **offer** `price_eur_mwh numeric(12,4)`, `reaction_window_minutes`, `offered_at`, `expires_at`, `offered_by_employee_id`, `trade_value_ex_vat numeric(20,8)`; the **acceptance** `vat_rate numeric(6,4)`, `wallet_amount_gross numeric(18,6)` (**the one stored number**), `accepted_by_account_id`, `accepted_at` (~~`four_eyes_applied`, `approved_by_account_id`, `approval_decided_at`, `approval_refused_by_account_id`~~ dropped by migration 39, [DEC-179]); the **resolution** `resolution_reason`, `external_reference varchar(64)`, `actual_market_price numeric(12,4)`, `resolved_at`; `last_event_sequence`, `created_at`. **No `row_version`** — pessimistic lock-then-check ⚠ **Amended 2026-10-13 by [DEC-180] (10): see §3.4.5.** |
| ~~`trading.trade_line`~~ `trading.trade_connection` | ⚠ **Replaced 2026-09-30 by [DEC-167] (16) — migration 30 amended in place (never released).** `(trade_id, metering_point_id)` primary key, `ean character varying(18) NOT NULL`, `connection_name character varying(80)` **nullable** (both snapshots at submit; the portal shows *— no name set —* for a null name), **no power**: the volume is for the whole account and this is its unweighted roster of covered connections. Tenant policy through an `EXISTS` on the parent trade; customer `SELECT`, employee `SELECT`, no write privilege |
| `trading.trade_event` | Append-only, one row per transition: `id` (a v7 uuid), `trade_id`, `sequence` (unique per trade), `event_type`, `from_state` (admits `DRAFT`, the `SUBMITTED` event's), `to_state`, `actor_type` (`CUSTOMER`/`EMPLOYEE`/`SYSTEM`), `actor_id`, `actor_name`, `actor_job_title`, `reason`, `comment`, `occurred_at`. Trigger `trg_trade_event_append_only` raises `restrict_violation` on `UPDATE` or `DELETE` |
| `trading.block` (~~`block_allocation`~~ **dropped 2026-09-30, [DEC-167] (16)**) | The confirmed position, **account-level**: it keeps `power_mw`, price, period and company and has no per-connection split; **immutable** by trigger (`trg_block_immutable`; ~~`trg_block_allocation_immutable`~~ went with the table); `block.source_trade_id` is unique, so a trade confirms into at most one block ⚠ **Amended 2026-10-13 by [DEC-180] (10): see §3.4.5.** |

**`CHECK`s on `trading.trade`.** `state` is one of the **12 persisted states** (no `DRAFT`) ⚠ **11 since migration 39 (§7.11): `AWAITING_APPROVAL` leaves `ck_trade_state`**; `direction`, `shape` and `period_type` are closed sets; `delivery_end > delivery_start`; `total_power_mw >= 0.01 AND mod(total_power_mw, 0.01) = 0`, and the same grid on every line, block and allocation **[DEC-70]**; `total_mwh > 0`; `price_eur_mwh > 0`; `reaction_window_minutes BETWEEN 5 AND 1440`; `wallet_amount_gross > 0` **and** equal to `round(wallet_amount_gross, 2)`, so a stored gross is always whole cents; ~~the approver and the refuser each differ from the acceptor; **never both approved and refused**; `AWAITING_APPROVAL` implies `four_eyes_applied`; `APPROVAL_REFUSED` implies a refuser and a decision time;~~ *(all dropped by migration 39, [DEC-179])* a trade past `REQUESTED`/`CANCELLED`/`DECLINED` carries a complete offer; an accepted, confirmed, failed or refused trade carries its reservation fields. ~~and **`ck_trade_four_eyes_approved`** — a `four_eyes_applied` trade in `ACCEPTED`, `CONFIRMED` or `FAILED` must carry `approved_by_account_id` **and** `approval_decided_at`. The employee role can write neither column, so **no employee-role `UPDATE` can skip four-eyes** at the database.~~ A `BEFORE UPDATE` transition trigger (state pairs, frozen price and money columns) is **deferred** — it would refuse the raw-`UPDATE` arranges the stored-number tests rely on **[DEC-167]** (c). ⚠ **Amended 2026-10-13 by [DEC-180] (10): see §3.4.5.**

**Indexes.** Unique `reference`; `(customer_id, created_at DESC)`; partial `ix_trade_open (state, created_at)` over `REQUESTED`, `OFFERED`, `ACCEPTED`; partial `ix_trade_expiring (expires_at)` over `OFFERED` — §3.4.1 (~~`AWAITING_APPROVAL`~~ removed from both by migration 39). **On `wallet.ledger_entry`, two partial unique indexes keyed per wallet:** `ux_ledger_entry_trade_reserved (wallet_id, caused_by_id)` where `caused_by_type = 'Trade'` and `entry_type = 'TRADE_RESERVED'`, and `ux_ledger_entry_trade_exit` over the same pair for `TRADE_SETTLED` and `TRADE_RESERVATION_RELEASED` — one reservation and one exit per trade. They are keyed on the wallet too, because the customer role holds `INSERT` on `ledger_entry` and another tenant's insert must never block this trade.

**Grants.** The schema has no default privileges, so the migration `REVOKE`s first and grants exactly. **`app_customer_role` gets a column-scoped `SELECT` on `trading.trade` that excludes `indication_product_id`, `indication_raw_price`, `indication_observed_at`, `indication_source`, `actual_market_price` and `offered_by_employee_id`** (the house pattern of `GRANT SELECT (…)`, as on `onboarding_application` and on migration 25's revoke under **[DEC-161]** D7), plus `SELECT` on the other three tables and **no** write privilege anywhere — customer writes are owner-privileged. Consequence: any customer-role query that materialises a `Trade`, or selects `*`, fails with `42501`, so customer read models **project**. `app_employee_role` gets `SELECT` on all four, `INSERT` on the event and block tables, and a column `UPDATE` on `trading.trade` limited to `state`, `price_eur_mwh`, `reaction_window_minutes`, `offered_at`, `expires_at`, `offered_by_employee_id`, `trade_value_ex_vat`, `resolution_reason`, `external_reference`, `actual_market_price`, `resolved_at`, `last_event_sequence` — which is also what makes `FOR UPDATE` legal for the role. **No role has `DELETE`.** ~~The approval columns are written by the owner only.~~ *(The approval columns are dropped, [DEC-179].)* ⚠ **Amended 2026-10-13 by [DEC-180] (10): see §3.4.5.**

**Row-level security** — enabled, never forced, **eight** policies (⚠ was ten before 2026-09-30): `trading_trade_tenant_isolation` and `trading_block_tenant_isolation` on `customer_id = current_setting('app.customer_id')`; the connection and event tables reach it through an `EXISTS` on their parent; and a `*_back_office` policy per table for `app_employee_role`, `USING (true)`. Accepted residue: **employee actor names on `trade_event` stay `SELECT`-able by the customer role through raw SQL**; no customer API response carries them **[DEC-167]** (b).

**Deposit and balance — migration 31 `TradeDepositSettlement` (`20260930084211`), added 2026-09-30 ([DEC-167] (17)).** Migration 30 is already applied on the local database and is **not** amended; 31 adds:

| Where | What |
| --- | --- |
| `customer.customer` | `deposit_pct numeric(5,2) NOT NULL DEFAULT 20` — every existing company gets 20 — with `ck_customer_deposit_pct_range` (`BETWEEN 0 AND 100`). Written only by the back office: the back office writes it through the employee role. ⚠ (17) The migration's `GRANT UPDATE (deposit_pct)` is **additive and redundant**: migration 2 already grants both app roles table-level `SELECT, INSERT, UPDATE, DELETE` on the `customer` schema and nothing revokes it, so the column grant (and the Down's `REVOKE`) restricts nothing. The property rests on the customer role having **no write policy** on `customer.customer` (migration 16) and there being no customer write route |
| `trading.trade` | The settlement frozen at accept: `deposit_pct numeric(5,2)`, `deposit_amount numeric(18,6)`, `balance_amount numeric(18,6)`, `balance_due_date date` (`delivery_start − 1`, Amsterdam), and the payment record `balance_paid_at timestamptz`, `balance_paid_by_account_id uuid` (FK `customer_account`, `RESTRICT`, indexed) and `balance_paid_source` (`CUSTOMER` \| `AUTO`). All nullable until accept; `wallet_amount_gross` stays the one stored VAT-inclusive number |
| `CHECK`s on `trading.trade` | `ck_trade_deposit_pct_range` (0–100); `ck_trade_settlement_complete` (`deposit_pct`, `deposit_amount`, `balance_amount` and `balance_due_date` are all null or all set); `ck_trade_settlement_adds_up` (both amounts ≥ 0, whole cents, `deposit_amount + balance_amount = wallet_amount_gross`); `ck_trade_settlement_present` (an accepted, confirmed, failed or refused **BUY** carries a settlement); `ck_trade_balance_paid_source` (`CUSTOMER` or `AUTO`); `ck_trade_balance_paid_consistent` (paid-at is set if and only if the source is; a `CUSTOMER` source names the paying account and `AUTO` names none; only a `CONFIRMED` trade with a balance above 0 can be paid) |
| `trading.trade_event` | `ck_trade_event_type` is replaced to admit a 13th type, **`BALANCE_PAID`** (a `CONFIRMED` → `CONFIRMED` row: paying is not a state change) |
| `wallet.ledger_entry` | Third partial unique index **`ux_ledger_entry_trade_balance (wallet_id, caused_by_id)`** where `caused_by_type = 'Trade'` and `entry_type = 'TRADE_BALANCE_PAID'`: one balance debit per (wallet, trade). The reserve and exit indexes of migration 30 are untouched and keep guarding the deposit leg |
| Grants | `app_customer_role` `SELECT` widens by exactly the **seven settlement columns** (`deposit_pct`, `deposit_amount`, `balance_amount`, `balance_due_date`, `balance_paid_at`, `balance_paid_by_account_id`, `balance_paid_source`) — still none of the employee-only ones. The balance payment and the automatic collection write through the same privileged paths as every other trade money movement (the customer host's owner-privileged window, the Worker's owner connection), so no further grant is needed |
| Backfill | A trade accepted before 31 reserved the whole gross, so it reads as **`deposit_pct = 100`, `deposit_amount = wallet_amount_gross`, `balance_amount = 0`, `balance_due_date = delivery_start − 1`** — which is what actually happened to its wallet |

Down() reverses each of the above (the append-only event trigger is disabled around the `BALANCE_PAID` delete). The pins, `tools/verify-migrator.sh`, the model snapshot and both OpenAPI artifacts move with it. The lock order is unchanged: the pay-balance route and the collection take **company row, trade, wallet**; the commercial-terms change takes the company row `FOR UPDATE`, which an accept's `FOR SHARE` serialises against.

**Trade-desk notices — migration 32 `TradeDeskNotice` (`20261001075014`), added 2026-10-01 ([DEC-168]).** The desk mails (*new request*, *ready to confirm*) go to every active back-office account with the desk-mail setting on, resolved by the Worker at send time. Migration 32 adds one **owner-only** table; nothing else changes. It has a real `Down()` (drop the table, which drops its indexes). The migration-list pin (32), the `verify-migrator.sh` history case, the enum-type pin (34, `TradeDeskNoticeKind`), the model-shape table pin and the trading row-level-security table list move with it.

| Table | Contents and the constraints that matter |
| --- | --- |
| `trading.trade_desk_notice` | `id uuid` primary key (client-generated), `trade_id uuid NOT NULL` → `trading.trade(id)`, `kind text NOT NULL` with `CHECK (kind IN ('NEW_REQUEST','READY_TO_CONFIRM'))`, `subject text NOT NULL`, `body text NOT NULL` (the rendered mail, the existing `TradeMail` wording), `created_at timestamptz NOT NULL`, `sent_at timestamptz` null until the Worker has taken it, `recipient_count int` null until sent (set together with `sent_at`; `0` when no opted-in staff account was active). Every value is set by the application — no database defaults. CHECK **`ck_trade_desk_notice_sent_consistent`**: `(sent_at IS NULL) = (recipient_count IS NULL) AND (recipient_count IS NULL OR recipient_count >= 0)`. Partial index **`ix_trade_desk_notice_unsent (created_at) WHERE sent_at IS NULL`** serves the Worker's oldest-first read; FK index **`ix_trade_desk_notice_trade_id (trade_id)`**, the FK being `ON DELETE RESTRICT` |
| **Grants and row-level security** | **Owner-only.** `ENABLE ROW LEVEL SECURITY` with **no policy**, and **no grant to `app_customer_role` or `app_employee_role`** — both roles are refused `SELECT` and `INSERT` (pinned by a test). The customer host writes a row only inside the owner-privileged window that already writes the trade, in the same transaction, so a rolled-back request leaves no notice; the Worker, which connects as the owner, reads and marks it. Realm isolation is kept: the customer host never reads `employee.employee` |

The Worker's `TradeDeskNotificationJob` takes unsent rows (at most `BatchSize` = 50, fewer when sized down below) `ORDER BY created_at … FOR UPDATE SKIP LOCKED`, reads the active, opted-in `employee.employee` accounts once per tick, stamps `sent_at` and `recipient_count`, commits, and only then enqueues one message per recipient — at-most-once, best effort. The batch is sized per tick: with zero recipients `BatchSize` notices (stamped 0); otherwise min(`BatchSize`, min(`MaxMessagesPerTick` (100), the mailbox's free room) ÷ recipients); when that is 0, one notice if the mailbox is empty, else the tick takes nothing and waits. The mailbox can still overflow when one notice has more recipients than its capacity, or when other Worker mail (the *Balance paid* mail) takes the room between the tick's snapshot and its enqueue: unlikely, not impossible — [background jobs §2](06-background-jobs.md).

**Desk-mail opt-in — migration 33 `TradeDeskMailSetting` (`20261001082750`), added 2026-10-01 ([DEC-168] (7)).** The back office's per-operator setting. It follows migration 32 and is the one change `employee.employee` takes:

| Where | What |
| --- | --- |
| `employee.employee` | New column **`receives_trade_desk_mail boolean NOT NULL DEFAULT true`**. The default backfills every existing row to `true`, so each operator keeps receiving desk mail until an admin unticks it. It governs only the two desk mails, never the reset or invite mail. The Worker's recipient query is `is_active = true AND receives_trade_desk_mail = true` |
| **Grants** | `app_employee_role`'s grants on `employee.employee` are **column-scoped** and named column by column, and the new column is added to each: **`SELECT`** (migration 7's list, which had grown by `is_admin` in migration 20), **`INSERT`** (migration 20's list: `id, username, display_name, security_stamp, is_active, is_admin`, plus the new column) and **`UPDATE`** (migration 20's list: `display_name, is_admin, is_active, security_stamp`, plus the new column). **`password_hash` stays in none of the three**, and nothing on the app-role connection may name it, so the operator-create raw `INSERT` names only granted columns. The Worker connects as the owner and needs no grant |
| Reversal | A real `Down()` drops the column; the grants go with it. Tests pin the backfill to `true`, that the app role can `SELECT` and `UPDATE` the column, and that it still cannot name `password_hash` |

**Buy / Sell / EOD — migration 34 `PriceIndicationDailyClose` (`20261001132506`), added 2026-10-01 ([DEC-169] (3)).** It adds one read object in the `market` schema, a function, and no table. It gives the customer **one price a day per product, never the tick history**: migration 25 revoked `app_customer_role`'s `SELECT` on the append-only `market.price_indication_observation` ([DEC-161] D7), and that stays.

| Object | What it is |
| --- | --- |
| `market.price_indication_close_before(p_source text, p_day date, p_product_ids uuid[], p_delivery_starts date[])` (function) | **What the endpoint reads.** `SECURITY DEFINER`, `STABLE`, `search_path = market, pg_temp`. For each (product, delivery start) pair it returns the newest observation before `p_day`'s Amsterdam midnight (`observed_at DESC, received_at DESC`, `LIMIT 1`), seeking the observation index once per pair. It takes a DATE, never an instant, so it can only return the last row of an earlier Amsterdam day, one close a day per product, never the tick history. `EXECUTE` is revoked from `PUBLIC` and granted to `app_customer_role`. An earlier draft filtered a daily-close view by "newest before the cutoff"; that ran a correlated subquery per row and took 46 s on a year of 10-minute ticks, hence the function. ⚠ **[DEC-180] (10), migration 41: its result column is price_eur_per_kwh numeric(12,5) = round(raw_price × 0,001, 5); the view market.price_indication_latest gains the same column as its last one and keeps raw_price, currency and unit.** |
| Reversal | `Down()` drops the function. An earlier draft also created a `market.price_indication_daily_close` view; nothing read it, so it was removed before landing. |

**The Sell price for a negative indication.** `sellPrice` = `buyPrice` − |`buyPrice`| × `ForwardPrices:SellSpreadPercent` ÷ 100, rounded half away from zero to ~~2 decimals~~ 5 decimals, from the served Buy (`IndicationPricing.SellPrice`) ⚠ **[DEC-180] (10).** The spread comes off the magnitude, so Sell is always at or below Buy: −50.00 at 2 percent gives −51.00, not −49.00. ~~`buyPrice` is the raw indication, unrounded.~~ ⚠ **[DEC-180] (10): `buyPrice` is round(raw × 0,001, 5), euro per kWh.**

**Locks.** One global order — §5 and [DEC-167] (7): admin roster, company row, trade, wallet. Trade locks are taken by `id` only; the company row is locked **owner-privileged** with the token's company named explicitly (§3.1.4).

#### 3.4.5 Trading in kW, kWh and €/kWh — [DEC-180], added 2026-10-13

⚠ **As built 2026-10-13 by [DEC-180].** Migration 42 (`20261013191536_TradingKwhUnits`) rewrites the two trading tables that hold a unit: power in kW, energy in kWh, every price in euro per kWh with five decimals. **Every stored euro amount stays exactly as it is.** The names below are the built names.

**1. The columns.**

| Table | Old column | Old type | New column | New type | Conversion |
| --- | --- | --- | --- | --- | --- |
| `trading.trade` | `total_power_mw` | `numeric(12,6) NOT NULL` | `total_power_kw` | `numeric(12,3) NOT NULL` | × 1000, exact |
| `trading.trade` | `total_mwh` | `numeric(18,6) NOT NULL` | `total_kwh` | `numeric(18,3) NOT NULL` | × 1000, exact |
| `trading.trade` | `price_eur_mwh` | `numeric(12,4) NULL` | `price_eur_per_kwh` | `numeric(12,5) NULL` | `round(× 0.001, 5)`, half away from zero |
| `trading.trade` | `indication_raw_price` | `numeric(12,4) NULL`, signed | `indication_price_eur_per_kwh` | `numeric(12,5) NULL`, signed | `round(× 0.001, 5)` |
| `trading.trade` | `actual_market_price` | `numeric(12,4) NULL`, signed | `actual_market_price_eur_per_kwh` | `numeric(12,5) NULL`, signed | `round(× 0.001, 5)` |
| `trading.block` | `power_mw` | `numeric(12,6) NOT NULL` | `power_kw` | `numeric(12,3) NOT NULL` | × 1000, exact |
| `trading.block` | `total_mwh` | `numeric(18,6) NOT NULL` | `total_kwh` | `numeric(18,3) NOT NULL` | × 1000, exact |
| `trading.block` | `price_eur_mwh` | `numeric(12,4) NOT NULL` | `price_eur_per_kwh` | `numeric(12,5) NOT NULL` | `round(× 0.001, 5)` |
| `market.price_indication_observation` | `raw_price`, `unit` | `numeric(12,4)`, `varchar(8)` | **stay** | **stay** | as received [DEC-180] (2) |

The types are the old ones with the decimal point moved three places, so every stored value converts without overflow whatever the `CHECK` allowed: power `numeric(12,3)`, energy `numeric(18,3)`, price `numeric(12,5)` (the type `market.day_ahead_price` already has).

**2. The `CHECK`s.**

| Table | Old name | New name | New definition |
| --- | --- | --- | --- |
| trade | `ck_trade_total_power_grid` | same | `total_power_kw >= 10 AND mod(total_power_kw, 10) = 0` |
| trade | `ck_trade_total_mwh_positive` | `ck_trade_total_kwh_positive` | `total_kwh > 0` |
| trade | `ck_trade_price_positive` | `ck_trade_price_not_negative` | `price_eur_per_kwh IS NULL OR price_eur_per_kwh >= 0` |
| trade | `ck_trade_offer_complete` | same | the same rule, naming `price_eur_per_kwh` |
| block | `ck_block_power_grid` | same | `power_kw >= 10 AND mod(power_kw, 10) = 0` |
| block | `ck_block_total_mwh_positive` | `ck_block_total_kwh_positive` | `total_kwh > 0` |
| block | `ck_block_price_positive` | `ck_block_price_not_negative` | `price_eur_per_kwh >= 0` |

The price `CHECK`s became "not negative" because a converted price below 0,005 €/MWh reads `0.00000`; a `> 0` rule would stop the deploy on a row the old validator allowed. A new price is still refused at zero in the domain, in the desk validator and in the offer check. A trade with a zero gross is still refused by `ck_trade_gross_cents`.

**3. Unchanged.** `trade_value_ex_vat numeric(20,8)`, `vat_rate`, `wallet_amount_gross`, `deposit_amount`, `balance_amount`, `deposit_pct`; every `wallet.*` column; the triggers `trg_block_immutable` and `trg_trade_event_append_only` (they name no column and are never disabled); the eight row-level security policies (none names a converted column); the text of `trading.trade_desk_notice` and of the `trade_event` rows.

**4. Grants under the new names.** `app_customer_role` has a column `SELECT` on `trading.trade` that excludes `indication_product_id`, `indication_price_eur_per_kwh`, `indication_observed_at`, `indication_source`, `actual_market_price_eur_per_kwh` and `offered_by_employee_id`. `app_employee_role` has a column `UPDATE` on `trading.trade` limited to `actual_market_price_eur_per_kwh, expires_at, external_reference, last_event_sequence, offered_at, offered_by_employee_id, price_eur_per_kwh, reaction_window_minutes, resolution_reason, resolved_at, state, trade_value_ex_vat`. A column rename keeps its grant; the migration re-issues both as a no-op.

**5. Three audit actions**, written in the migration's own transaction before any value changes, in the shape of migration 39, actor `system:migration`:

| Action | One row for | Company | `before` | `after` |
| --- | --- | --- | --- | --- |
| `TRADE_PRICE_ROUNDED` | each trade whose firm price loses digits | the trade's | `{"priceEurPerMwh": 95.1234, "tradeValueExVat": 25340.87376000}` | `{"priceEurPerKwh": 0.09512, "tradeValueExVat": 25340.87376000, "reason": "…"}` |
| `BLOCK_PRICE_ROUNDED` | each block whose price loses digits | the block's | `{"priceEurPerMwh": 95.1234, "sourceTradeId": "…"}` | `{"priceEurPerKwh": 0.09512, "sourceTradeId": "…", "reason": "…"}` |
| `TRADE_REFERENCE_PRICE_ROUNDED` | each trade whose captured indication or actual market price loses digits | none, so no customer can read it | `{"indicationPriceEurPerMwh": 87.4567, "actualMarketPriceEurPerMwh": 93.1275}` | the same keys as `…PerKwh`, and `"reason"` |

"Lost digits" means the conversion cannot be undone: `round(p × 0.001, 5) × 1000 <> p`. A price that converts exactly gets no row, and a missing price gets none. No `trade_event` is written. These three keys are the one place, with the audit payloads, where a per-MWh figure is written after the change.

**6. The invariant.** `trade_value_ex_vat = total_kwh × price_eur_per_kwh` for every trade priced after the migration. It does not hold for a converted trade whose price lost digits, and that set is exactly the trades with a `TRADE_PRICE_ROUNDED` row: the stored value is the truth and the price is its rounded label. The amount including VAT is always `round(stored value × (1 + VAT), 2)`, so an offer made before the change is accepted for the amounts it showed.

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
                        'TRADE_SETTLED','TRADE_PROCEEDS',                     -- gross [DEC-78]; a BUY's is the deposit [DEC-167] (17)
                        'TRADE_BALANCE_PAID',                                 -- ⚠ new, migration 31 [DEC-167] (17)
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
    -- ⚠ As built (migration 23, amended 2026-09-28 by [DEC-165]): one `destination` column holding the IBAN
    --   itself, not bank_account_id + iban_at_request. A bank-account replace re-points it while the request
    --   is open and the payout sets it to the account it resolved — see §3.1.3.
    bank_account_id    uuid NOT NULL REFERENCES customer.customer_bank_account(id),
    iban_at_request    text NOT NULL,
    requested_by_account_id uuid NOT NULL REFERENCES customer.customer_account(id),
    requested_at       timestamptz NOT NULL DEFAULT now(),
    state              text NOT NULL CHECK (state IN
                           ('REQUESTED','DECLINED','PAID')),   -- 'AWAITING_APPROVAL' and 'APPROVED' struck 2026-10-12, DEC-179
    -- approval_request_id uuid REFERENCES customer.approval_request(id),   -- struck: never built, DEC-179
    decided_by_account_id uuid REFERENCES customer.customer_account(id),
    decided_at         timestamptz,
    decline_reason     text,
    -- the payout an employee has ALREADY made  [F06-R36]
    -- ⚠ As built (migration 28, 2026-09-29 by [DEC-166]): three nullable columns — bank_reference (optional, at
    --   most 140 characters by CHECK), paid_by_employee_id (the employee's username) and paid_by_employee_name
    --   (a display-name snapshot) — all null unless the request is PAID. There is no value_date column and the
    --   PAID CHECK below is not built; the paid time is resolved_at. See §7.7.
    paid_by_employee   text,
    bank_reference     text,
    value_date         date,
    paid_at            timestamptz,

    -- CHECK (decided_by_account_id IS NULL
    --        OR decided_by_account_id <> requested_by_account_id),     -- the second admin; struck 2026-10-12, DEC-179
    CHECK (state <> 'DECLINED' OR decline_reason IS NOT NULL),
    CHECK (state <> 'PAID' OR (paid_by_employee IS NOT NULL AND bank_reference IS NOT NULL
                               AND paid_at IS NOT NULL)),
    -- CHECK (state <> 'AWAITING_APPROVAL' OR approval_request_id IS NOT NULL)
);
CREATE INDEX ix_withdrawal_open ON wallet.withdrawal_request (wallet_id, requested_at)
    WHERE state = 'REQUESTED';   -- was IN ('REQUESTED','AWAITING_APPROVAL','APPROVED'); DEC-179
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

~~**Market prices stay `numeric(12,4)` in €/MWh** (`trading.trade.price_eur_mwh`,
`market.day_ahead_price.price`).~~ ⚠ **Corrected 2026-10-13 by [DEC-180] (3): every price the platform stores is numeric(12,5) in €/kWh (trading.trade.price_eur_per_kwh, trading.block.price_eur_per_kwh, market.day_ahead_price.price_eur_per_kwh). The one €/MWh column left is the observation's raw_price, kept as received.** The boundary is market price versus customer rate **[F09]** §4 rule
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

### 3.7 Legal documents — [DEC-174], added 2026-10-05

⚠ **Amended 2026-10-09 by [DEC-177] (2), (5), (8): a version is one edition with an English and a Dutch file.** `file_name`, `size_bytes` and `sha256` move from `legal.document_version` to `legal.document_file`, which is now keyed by `(version_id, language)`, and `onboarding_application` gains `terms_language`. The DDL below is the shape after migration 38 (§7.10); the first-release shape (one file per version, `version_id` as the file's key) is in migration 36 (§7.9).

Platform **reference data**: no `customer_id`, **no row-level security**, in the style of `market`. Three tables. The file bytes live in their own table so that listing versions never loads a file. Feature: [F16](../10-features/F16-legal-documents.md).

```sql
CREATE TABLE legal.document_type (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key                   varchar(64)  NOT NULL UNIQUE,        -- immutable; ^[a-z0-9]+(-[a-z0-9]+)*$
    title                 varchar(120) NOT NULL,
    visible_to_customers  boolean NOT NULL,
    sort_order            int NOT NULL,
    built_in              boolean NOT NULL DEFAULT false,      -- immutable
    created_at            timestamptz NOT NULL,
    CONSTRAINT ck_document_type_key_format CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT ck_document_type_built_in_visible CHECK (NOT built_in OR visible_to_customers)
);

CREATE TABLE legal.document_version (                         -- one edition; metadata only
    id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type_id                    uuid NOT NULL REFERENCES legal.document_type(id) ON DELETE RESTRICT,
    version_number             int  NOT NULL,                  -- 1, 2, 3 … per type, no gaps
    effective_from             timestamptz NOT NULL,
    uploaded_at                timestamptz NOT NULL,
    uploaded_by_employee_id    uuid REFERENCES employee.employee(id) ON DELETE RESTRICT,  -- NULL = a system import
    change_note                varchar(500),
    UNIQUE (type_id, version_number),
    CONSTRAINT ck_document_version_number_positive CHECK (version_number >= 1)
);

CREATE TABLE legal.document_file (                            -- one row per language of an edition
    version_id  uuid NOT NULL REFERENCES legal.document_version(id) ON DELETE CASCADE,
    language    varchar(2) NOT NULL,                           -- 'en' | 'nl'
    file_name   varchar(200) NOT NULL,                         -- sanitised, display only
    size_bytes  bigint NOT NULL,                               -- 1 … 10 485 760
    sha256      varchar(64) NOT NULL,                          -- lower-case hex; the ETag
    content     bytea NOT NULL,
    PRIMARY KEY (version_id, language),
    CONSTRAINT ck_document_file_language CHECK (language IN ('en', 'nl')),
    CONSTRAINT ck_document_file_size CHECK (size_bytes BETWEEN 1 AND 10485760),
    CONSTRAINT ck_document_file_sha256_format CHECK (sha256 ~ '^[0-9a-f]{64}$')
);
```

| Rule | Where it is enforced |
| --- | --- |
| `key` and `built_in` never change; a built-in type stays visible | The domain aggregate, with the `CHECK`s above as the last line of defence |
| The **current** version is the highest `version_number` with `effective_from <= now`; a **scheduled** one has `effective_from > now`; **at most one scheduled per type** | The domain and the upload handler. Not a database constraint: "scheduled" depends on the clock |
| A **withdrawn** scheduled version is hard-deleted with its file (`ON DELETE CASCADE`); an effective version is never deleted | The withdraw endpoint, which asks the domain (`CheckCanBeWithdrawn`) under the type's row lock and answers `409` for an effective version. **Not a database rule:** the `DELETE` grant exists for the withdrawal, and the database cannot tell a scheduled row from an effective one without the application's clock |
| `version_number` = max + 1 per type, **allocated under `SELECT … FOR UPDATE` on the type's row**, so two concurrent uploads cannot both take the next number and a withdrawn scheduled number is reused | The upload handler; `UNIQUE (type_id, version_number)` is the net |
| **Both languages on every new version**; the `language` of a file is `en` or `nl` | The domain and the upload handler (`fileEn`, `fileNl`); `ck_document_file_language` and the primary key allow a single language, so a version with one file is *possible* in the table and is **not** produced by any code path. A `CHECK` cannot count a version's files. Migration 38 leaves none (§7.10) |
| `uploaded_by_employee_id` is nullable | A null is the Privacy Statement v1 import, which has no employee. The endpoint resolves it from the signed-in employee's username (the token carries the username, not the row id) |

**Seed.** The migration inserts two built-in, visible types: `terms-of-use` (*Terms of Use*, sort 10) and `privacy-statement` (*Privacy Statement*, sort 20). Privacy Statement **v1** is **not** a migration row: an idempotent Migrator seeder, `LegalDocumentSeeder`, outside the demo-seeding gate, inserts it from an embedded copy of the portal's PDF only when `privacy-statement` has no version. ⚠ **Amended 2026-10-09 by [DEC-177] (8):** it inserts that English PDF as **both** the `en` and the `nl` file of v1 (the same bytes, name, size and SHA-256). The Terms of Use have no version until an admin uploads one.

**Grants.** The schema has no default privileges, so the migration `REVOKE`s first and grants exactly, as for `market`: `app_customer_role` gets `SELECT` on the three tables; `app_employee_role` gets `SELECT`, `INSERT` and a **column-scoped** `UPDATE (title, visible_to_customers, sort_order)` on `document_type`, so `key` and `built_in` are immutable by grant, and `SELECT`, `INSERT`, `DELETE` on `document_version` and `document_file`. No `UPDATE` on either version table: a version is immutable. `SELECT … FOR UPDATE` on `document_type` works with the column-scoped grant. Both roles get `USAGE` on the schema; no default privileges are added for `legal`. `tools/verify-migrator.sh` pins these grants and `LegalDocumentsSchemaTests` exercises them on the real login roles. ⚠ **Amended 2026-10-09 by [DEC-177]:** the grants are unchanged; `document_file` keeps `SELECT` for the customer role and `SELECT`, `INSERT`, `DELETE` (no `UPDATE`) for the employee role, and the new primary key and columns need no new grant. `verify-migrator.sh` pins the file columns, the language `CHECK`, the seeded v1's two file rows (one size and SHA-256) and the `terms_language` column.

**Consent.** `customer.onboarding_application.terms_version_id` (§3.1) is a nullable foreign key to `legal.document_version`. This is a **cross-schema edge from `customer` to `legal`**, admitted on the same reasoning as `customer.metering_point.brp_id` → `metering.brp` (§1): `legal` is reference data whose only outbound key is `document_version.uploaded_by_employee_id` → `employee.employee`, so the edge adds no cycle between aggregates. The column is indexed. Because a version that has been **accepted against** is effective, the withdrawal rule (never delete an effective version) also keeps this key from dangling; the foreign key is `ON DELETE RESTRICT`, so a stray delete fails loudly. ⚠ **Amended 2026-10-09 by [DEC-177] (5):** `customer.onboarding_application.terms_language varchar(2) NULL`, `CHECK (terms_language IN ('en', 'nl'))` (`ck_onboarding_application_terms_language`), holds the language **actually served** beside `terms_version_id`; it is null where `terms_version_id` is null and for every row that existed before migration 38 (no backfill: the single-file era, and the two copies of that version are identical bytes).

### 3.8 Saved costs and positions — [DEC-180], added 2026-10-13

⚠ **As built 2026-10-13 by [DEC-180].** Migration 43 (`20261013215101_SavedCosts`) creates four tables, seven functions and seven triggers. The names are the built names. Two tables hold saved figures and carry the house policy pair; two are plumbing. None is partitioned, none has a foreign key, and only the owner writes.

**1. The tables.**

```sql
CREATE TABLE metering.interval_cost (
    metering_point_id  uuid          NOT NULL,
    delivery_date      date          NOT NULL,
    pos                smallint      NOT NULL,
    customer_id        uuid          NOT NULL,
    usage_kwh          numeric(14,3) NOT NULL,   -- input: the connection's net usage, signed
    price_eur_per_kwh  numeric(12,5) NOT NULL,   -- input: the day-ahead price, signed
    cost_eur           numeric(23,5) NOT NULL,
    calculated_at      timestamptz   NOT NULL,
    CONSTRAINT pk_interval_cost PRIMARY KEY (metering_point_id, delivery_date, pos),
    CONSTRAINT ck_interval_cost_pos CHECK (pos BETWEEN 1 AND 100),
    CONSTRAINT ck_interval_cost_is_usage_times_price
        CHECK (cost_eur = round(usage_kwh * price_eur_per_kwh, 5))
);

CREATE TABLE trading.hedge_position_interval (
    customer_id             uuid          NOT NULL,
    delivery_date           date          NOT NULL,
    pos                     smallint      NOT NULL,
    connections_reported    integer       NOT NULL,
    net_usage_kwh           numeric(18,3),
    hedge_kwh               numeric(18,3) NOT NULL,
    covered_kwh             numeric(18,3),
    short_kwh               numeric(18,3),
    long_kwh                numeric(18,3),
    price_eur_per_kwh       numeric(12,5),
    hedge_cost_eur          numeric(30,5) NOT NULL,
    buy_leg_eur             numeric(30,5),
    sell_leg_eur            numeric(30,5),
    actual_cost_eur         numeric(30,5),
    cost_without_hedge_eur  numeric(30,5),
    calculated_at           timestamptz   NOT NULL,
    CONSTRAINT pk_hedge_position_interval PRIMARY KEY (customer_id, delivery_date, pos),
    CONSTRAINT ck_hedge_position_interval_pos CHECK (pos BETWEEN 1 AND 100),
    CONSTRAINT ck_hedge_position_interval_reported CHECK (
        connections_reported >= 0 AND (net_usage_kwh IS NULL OR connections_reported > 0)),
    CONSTRAINT ck_hedge_position_interval_metered CHECK (
        (net_usage_kwh IS NULL) = (covered_kwh IS NULL)
        AND (net_usage_kwh IS NULL) = (short_kwh IS NULL)
        AND (net_usage_kwh IS NULL) = (long_kwh IS NULL)),
    CONSTRAINT ck_hedge_position_interval_priced_when_metered CHECK (
        price_eur_per_kwh IS NULL OR net_usage_kwh IS NOT NULL),
    CONSTRAINT ck_hedge_position_interval_costed CHECK (
        (price_eur_per_kwh IS NULL) = (buy_leg_eur IS NULL)
        AND (price_eur_per_kwh IS NULL) = (sell_leg_eur IS NULL)
        AND (price_eur_per_kwh IS NULL) = (actual_cost_eur IS NULL)
        AND (price_eur_per_kwh IS NULL) = (cost_without_hedge_eur IS NULL)),
    CONSTRAINT ck_hedge_position_interval_volumes CHECK (
        net_usage_kwh IS NULL OR (
            covered_kwh = LEAST(GREATEST(net_usage_kwh, 0), GREATEST(hedge_kwh, 0))
            AND short_kwh = GREATEST(net_usage_kwh - hedge_kwh, 0)
            AND long_kwh  = GREATEST(hedge_kwh - net_usage_kwh, 0))),
    CONSTRAINT ck_hedge_position_interval_legs CHECK (
        price_eur_per_kwh IS NULL OR (
            buy_leg_eur  = round(short_kwh * price_eur_per_kwh, 5)
            AND sell_leg_eur = round(long_kwh * price_eur_per_kwh, 5)
            AND cost_without_hedge_eur = round(net_usage_kwh * price_eur_per_kwh, 5))),
    CONSTRAINT ck_hedge_position_interval_adds_up CHECK (
        actual_cost_eur IS NULL OR actual_cost_eur = hedge_cost_eur + buy_leg_eur - sell_leg_eur)
) WITH (fillfactor = 85);

CREATE INDEX ix_hedge_position_interval_day
    ON trading.hedge_position_interval (delivery_date, customer_id) WHERE pos = 1;

CREATE TABLE metering.cost_recalc_request (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id     uuid,          -- NULL = every customer
    date_from       date,          -- NULL = from the beginning
    date_to         date,          -- NULL = without end; inclusive
    reason          text NOT NULL,
    source_id       uuid,          -- the row that caused it: a connection, a block, a trade
    check_run_id    bigint,        -- set on VERIFY requests
    requested_at    timestamptz NOT NULL DEFAULT now(),
    attempts        integer NOT NULL DEFAULT 0,
    last_error      text,
    next_attempt_at timestamptz,
    is_unit         boolean GENERATED ALWAYS AS (
                        customer_id IS NOT NULL AND date_from IS NOT NULL
                        AND date_to IS NOT NULL AND date_from = date_to) STORED,
    CONSTRAINT ck_cost_recalc_request_reason CHECK (
        reason IN ('BACKFILL','PRICE','READING','BLOCK','CONNECTION','MANUAL','VERIFY'))
);
CREATE INDEX ix_cost_recalc_request_unit     ON metering.cost_recalc_request (date_from, id) WHERE is_unit;
CREATE INDEX ix_cost_recalc_request_unit_key ON metering.cost_recalc_request (customer_id, date_from) WHERE is_unit;
CREATE INDEX ix_cost_recalc_request_wide     ON metering.cost_recalc_request (id) WHERE NOT is_unit;

CREATE TABLE metering.cost_check_run (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    started_at       timestamptz NOT NULL,
    finished_at      timestamptz,
    recent_from      date NOT NULL,
    recent_to        date NOT NULL,
    rotation_month   date,                        -- first day of the older month checked; NULL = none
    units_checked    integer NOT NULL DEFAULT 0,  -- saved = recalculated
    units_pending    integer NOT NULL DEFAULT 0,  -- an input change was still waiting; not a difference
    units_different  integer NOT NULL DEFAULT 0,
    rows_repaired    bigint  NOT NULL DEFAULT 0,
    sample           jsonb   NOT NULL DEFAULT '[]'  -- at most 50 differences
);
```

`metering.interval_cost` records what each cost was calculated from (`usage_kwh`, `price_eur_per_kwh`) and when (`calculated_at`); the `CHECK` makes "saved = usage × price" true of every row. `trading.hedge_position_interval` is dense: a customer-day that has metered usage or a counted block has a row for every quarter-hour (92, 96 or 100), and any other day has none. A block counts while its trade is `CONFIRMED`, and only then.

**2. No row, or a row with a null cost.** The saved cost table can only hold real costs:

| The quarter-hour for a connection | Saved | API `costEur` | Chart |
| --- | --- | --- | --- |
| Net usage and a price | a row; `cost_eur` is the rounded product, zero included | the number | a bar (also at zero) |
| Net usage, no price stored | no row | `null` | a gap |
| No net usage | no row | `null` | a gap |
| Net usage and a price, recalculation still waiting | no row yet, or a row made from other inputs | `null` | a gap |

A zero can only come out of a calculation, never out of an absence. `hedge_position_interval` has nullable euro columns because its row exists for the energy figures.

**3. Grants and policies.** `REVOKE ALL` first, then `SELECT` only. Row security is enabled and never forced: the owner (the Worker, the Migrator and the trigger functions) writes.

| Table | `app_customer_role` | `app_employee_role` | Policies |
| --- | --- | --- | --- |
| `metering.interval_cost` | `SELECT` | `SELECT` | `metering_interval_cost_tenant_isolation`, `metering_interval_cost_back_office` |
| `trading.hedge_position_interval` | `SELECT` | `SELECT` | `trading_hedge_position_interval_tenant_isolation`, `trading_hedge_position_interval_back_office` |
| `metering.cost_recalc_request` | nothing | `SELECT` | `metering_cost_recalc_request_tenant_isolation` (inert for the customer role), `metering_cost_recalc_request_back_office` |
| `metering.cost_check_run` | nothing | `SELECT` | `metering_cost_check_run_back_office` only |

The employee role cannot write the saved tables either: it loses the inherited write rights the other metering tables keep.

**4. The seven triggers.** Each function is one or two `INSERT`s into `metering.cost_recalc_request`, `SECURITY DEFINER`, with `EXECUTE` revoked from `PUBLIC`. A request is scope without a payload: a customer, a day range and a reason. The seven reasons are `BACKFILL`, `PRICE`, `READING`, `BLOCK`, `CONNECTION`, `MANUAL` and `VERIFY`.

| Trigger | Table | Fires | Request written |
| --- | --- | --- | --- |
| `trg_day_ahead_price_recalc_insert` | `market.day_ahead_price` | after an `INSERT` statement | one `PRICE` request per distinct delivery date inserted |
| `trg_day_ahead_price_recalc_update` | `market.day_ahead_price` | after an `UPDATE` statement | one per delivery date for which a price differs between old and new rows |
| `trg_day_ahead_price_recalc_delete` | `market.day_ahead_price` | after a `DELETE` statement | one per delivery date deleted |
| `trg_interval_data_version_recalc` | `metering.interval_data_version` | after an `INSERT`, a `DELETE` or an `UPDATE` of `is_current` or its keys, per row | one `READING` unit request for the customer and the delivery date |
| `trg_block_recalc` | `trading.block` | after an `INSERT`, per row | one `BLOCK` request for the block's customer and delivery period |
| `trg_trade_recalc` | `trading.trade` | after an `UPDATE OF state` that enters or leaves `CONFIRMED`, per row | one `BLOCK` request for the trade's customer and delivery period |
| `trg_metering_point_recalc` | `customer.metering_point` | after an `UPDATE` of the customer, the commodity or the "never produces" declaration, per row | one `CONNECTION` request for the whole history of the old customer, and of the new one when it changed |

A statement that changes nothing writes nothing, so the price job's prune on every tick costs nothing. A connection joining a customer, leaving it, or changing between "expected" and "unknown" production writes no request: a new connection is a new row with no readings, and its first reading fires the reading trigger.

**5. Who writes.** The owner only, through one engine (`SavedCostRecalculator`), called by the Worker (`SavedCostRecalculationJob`) and by the Migrator (`SavedCostBackfill`, its last step). No API host calls it.

**6. The rule that keeps a request from being lost.** A request is deleted only by a batch that claimed it, after it took the customer's advisory lock and then read the inputs, so the batch has seen the change behind every request it deletes. A change that commits later has its own request with an id the batch never claimed, and that request survives. Two engines at once get different request rows (`SKIP LOCKED`) and run one after the other on the same customer, so the worst case is one unnecessary recalculation, never a stale one.

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

⚠ **Not what was built, and not how costs are kept [DEC-180] (4), (5).** The built rollup holds consumption_kwh, production_kwh, net_usage_kwh, offtake_kwh and export_kwh, numeric(16,3), and no block or cost column. Costs and positions are saved per quarter-hour (§3.8) and follow a price, a reading or a block through the recalculation queue.

Rebuilt whenever a new interval-data version, a new block, or a corrected day-ahead price touches
that date. `source_version_ids` records exactly what it was computed from, so invalidation is precise
rather than "recompute the month".

## 5. Concurrency

| Path | Mechanism |
| --- | --- |
| Accept an offer | `SELECT … FROM wallet.wallet WHERE id = $1 FOR UPDATE`, then trade state guard, then reservation, all in one transaction — **whichever state the acceptance lands in [F05-R55]** ⚠ **Superseded 2026-09-29 by [DEC-167] (7):** the order is **admin roster → company row `FOR SHARE` (owner-privileged, token's company) → trade `FOR UPDATE` → wallet `FOR UPDATE`**, then the guards (`now` read after the trade lock), then the reservation, in one transaction — never the wallet first. |
| ~~Approve an acceptance **[DEC-33]** **[DEC-71]**~~ | ~~Trade row and its `approval_request` row. Still **no wallet lock and no second balance check**: the reservation was taken at acceptance and is not re-created **[T11]** ⚠ **2026-09-29 [DEC-167]:** roster → company row (`FOR SHARE`, status check) → trade. Still no wallet lock and no second balance check; approval is state on the trade, not an `approval_request` row.~~ ⚠ **Removed 2026-10-12 by [DEC-179]** — there is no approval of an acceptance. |
| ~~Refuse approval, or expire from `AWAITING_APPROVAL`~~ ⚠ **Struck 2026-10-12, [DEC-179]** (the expiry sweep of an `OFFERED` trade touches no wallet) | **Wallet first, then trade**, same as acceptance — both release a reservation in the same transaction **[T12]**, **[F05-R62]**, **[F05-R63]** ⚠ **Superseded 2026-09-29 by [DEC-167]:** refusal is roster → trade → wallet; the expiry sweep is trade → wallet, per trade. **Trade first, then wallet.** |
| Confirm a trade | Same lock ordering: **wallet first, then trade**, always, to prevent deadlock ⚠ **Superseded 2026-09-29 by [DEC-167]:** **trade first, then wallet** — the old "wallet first, then trade" deadlocks against the roster-first withdrawal paths. |
| Interval supersession | Advisory lock on `hash(metering_point_id, delivery_date)` — under **[DEC-38]** exactly one document per key per day, so contention is limited to a document and its own correction |
| Invoice run | Advisory lock per (period, customer) |
| **Match an incoming payment [DEC-106]** | Wallet row lock, then the intent, then the entry — one transaction. ⚠ **2026-09-29, as built ([DEC-167] (7)):** the payment (or the deposit intent) is locked first and the wallet is credited last, through the ledger writer. Serialisation is **not** what makes it safe: `incoming_payment.bank_transaction_id UNIQUE` does, so a re-delivered feed line fails on insert rather than crediting twice **[F07-R25]** |
| **Withdrawal request → payout [DEC-83]** | Wallet first, then the request, same ordering as a trade. The request holds a reservation from the moment it is raised, so the money cannot be traded away while it waits ~~for a second admin~~ **[F07-R29]** ⚠ **2026-09-29:** the order is the one in [DEC-166] and [DEC-167] (7) — as built, the request takes the company row `FOR SHARE`, then the wallet, then inserts the withdrawal (no roster and no bank-account lock); ~~approve is roster, withdrawal;~~ decline is roster, withdrawal, wallet — and no trade row is involved. ⚠ **2026-10-12, [DEC-179]:** the withdrawal has no approve step; cancel and the payout lock the withdrawal and then the wallet. |
| ~~**A four-eyes decision [DEC-71]**~~ | ~~The `approval_request` row. `ux_approval_open_subject` is what stops two pending approvals for one subject, so two admins deciding at once resolve on one row rather than on a read-modify-write~~ ⚠ **Removed 2026-10-12 by [DEC-179]** — there is no decision; `approval_request` was never built. |
| Everything else | Optimistic concurrency via `row_version` |

⚠ **Superseded in part 2026-09-29 by [DEC-167] (7).** The one global order is **admin roster → `customer.customer` → `trading.trade` → wallet**, and **the wallet is never locked before the trade**: "wallet before trade" below deadlocks against [DEC-166]'s roster-first withdrawal approve and decline, and is replaced. ~~The roster is locked before the company row so an enabling four-eyes toggle (roster → company `UPDATE`) cannot deadlock with an accept;~~ ⚠ **2026-10-12, [DEC-179]: the toggle is gone, so the accept path takes company row → trade → wallet and no roster lock; the roster is still locked first by the membership writes that enforce the admin floor (§3.1.4);** the company row is locked owner-privileged, naming the token's company (§3.1.4). Withdrawal row before wallet row, and deposit intent before wallet row, as [DEC-166] records and as built (decline, cancel and pay-out lock the withdrawal and only then reach the wallet through the ledger writer; deposit settlement locks the intent first).

**Lock ordering is a written rule** — wallet before trade, always, and now wallet before withdrawal
request and wallet before deposit intent as well. ⚠ **Superseded 2026-09-29 by [DEC-167] (7) and [DEC-166]:** the "wallet before trade", "wallet before withdrawal request" and "wallet before deposit intent" clauses are all replaced; the wallet is always the last lock. Deadlocks in a money path are the kind of bug that
only shows up under production load. ~~`Approve` is the one four-eyes transition that takes no wallet
lock, and that is a property of **[F05-R55]** rather than an optimisation: if approval had to
re-check the balance, approval would be a race against the customer's own trades —
so the race it was guarding against can now only come from the customer's own trading.~~ ⚠ **Struck 2026-10-12 by [DEC-179]:** there is no `Approve`.

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

⚠ **Added 2026-10-13 by [DEC-180].** `metering.interval_cost`, `trading.hedge_position_interval` and `metering.cost_recalc_request` carry the house policy pair; `metering.cost_check_run` is employee-only; `market.day_ahead_feed_run` has no tenant column and no row security, and the customer role holds nothing on it (§3.8).

⚠ **Four new tables need the same policy, 2026-08-19.** `customer.customer_bank_account`,
`customer.approval_request` *(never built; struck 2026-10-12)*, `wallet.deposit_intent` and `wallet.withdrawal_request` all carry a
`customer_id` or reach one through `wallet_id`, and all four are read by customer surfaces. They are
the highest-value rows in the schema — a bank account, an approval and a payout instruction — so the
policy is not optional on them. `wallet.incoming_payment` is the exception and gets **no customer
policy at all**: an unmatched credit line belongs to nobody yet, and exposing it by IBAN guess would
be a disclosure. It is employee-only until a `bank_deposit` row attaches it to a wallet.

⚠ **Row-level security needs database roles, and this document never named them** (added
2026-09-03). A superuser or a table owner **bypasses** RLS silently: with the APIs on the default
connection, every policy in this section is inert while every test still passes — the most expensive
kind of green. Migration 2 therefore creates `app_customer_role` and `app_employee_role`, plus two
non-owner **login** roles, and each host rewrites its connection string onto its own role. The
Migrator keeps the owner connection, because it must be able to create and alter the tables the
policies sit on. Slice 1 is local-only with no deployment, so the two login passwords are literals in
the migration with a comment saying exactly that. **[OQ-102]** owns them before anything is deployed
anywhere.

⚠ **Amended 2026-10-15 by [DEC-182]:** `metering.ean_pool` is gone (migration 45); two new tables are exempt, below.

⚠ **Two tables are deliberately exempt, and both are named in the guard rather than hidden from it**
(added 2026-09-03). An exemption a guard can see is reviewable; a table no guard ever looks at is not.

| Table | Why it has no policy | What reopens it |
| --- | --- | --- |
| `metering.ean_pool` **[DEC-113]** ⚠ **Removed by [DEC-182] (2).** | Shared reference data. It has **no `customer_id`** and no tenant to isolate to: an unclaimed entry belongs to nobody and must be visible to every customer at once, so a `column = app.customer_id` policy would evaluate false on every row and hide the whole pool from everyone. A **claimed row leaves the pool** — what keeps one customer's choices private from another is that the API only ever selects `claimed_at IS NULL`, so a claimed row is invisible to every customer including its claimant. `metering.brp` is the same shape and predates it | The pool gaining a customer-scoped read — a "connections I claimed" screen would be one |
| `metering.connection_master_data` **[DEC-182]** | A row describes one grid connection as EDSN registers it, keyed by EAN. It belongs to no company: several companies hold one EAN one after another, and many EANs are held by none, so a tenant policy would hide every row from every caller. No application role may write directly (the customer role reads only; the customer API writes through the owner path once its endpoint has decided), and a customer reads master data through exactly three routes: the details of a connection held today, and the eligibility check and the add after the full proof of DEC-182 (5) | A fourth customer route that reads the table or asks EDSN for master data; any of the three returning a master-data field beyond the ones fixed for it; the eligibility check or the add revealing anything before the full proof |
| `metering.grid_operator` **[DEC-182]** | Public reference data: the names of grid operators by party code, the same for every caller. Writes are as above | A column that names a customer or a connection |
| `customer.onboarding_application` **[DEC-113]** | Its `customer_id` is **nullable** and null for the whole life of a draft, and **every path is anonymous**: a prospect has no company and no token, so there is no `app.customer_id` for a policy to key on. A row is addressed by its own id — a capability, not a query | An authenticated read of a *signed* application, e.g. a customer viewing their own onboarding history |

⚠ **How the coverage guards discover a table, and why it had to change** (added 2026-09-03).
`AutomaticPolicyCoverageTests` walks the EF model and `CatalogPolicyCoverageTests` walks
`information_schema` plus `pg_class.relrowsecurity`, so a table EF does not know about is still
caught. Both once matched a property named **exactly** `CustomerId`; both now match any name that
**ends** in it, which is what makes `ean_pool.claimed_by_customer_id` visible to them at all. Under
the exact-name predicate that table would have been invisible rather than exempt — and an invisible
table is not a decision, it is an omission nobody made.

⚠ **[DEC-182]:** neither new table ends in customer_id, so neither guard discovers them: they are pinned instead by a schema test (no policy, row security off, no customer column, the customer role cannot write) and by tools/verify-migrator.sh. ean_pool was the last live table with a suffix-only customer column; a synthetic test keeps the suffix half of both guards honest.

⚠ **`refresh_token` and `password_reset_token` were scoped by ACCOUNT, not by company**, so neither
carried a `customer_id` and neither was exempt: migration 3 gave each a policy whose predicate joined
through `customer_account.customer_id`. They were held to the same two-policy bar as everything else,
by a separate account-owned discovery pass.

⚠ **Amended 2026-09-10 by [DEC-152], migration 15 — and the two tables now diverge.**
`password_reset_token` keeps the account join, re-pointed through `customer_membership` (an `EXISTS`
on `customer_account_id`) rather than through the now-dropped `customer_account.customer_id`; it
still carries no `customer_id` of its own. `refresh_token` does **not** take that shape: it gains its
**own** `customer_id` column and a uniform `customer_id = <app.customer_id>` predicate instead. The
asymmetry is load-bearing, not an inconsistency — under an `EXISTS`-through-membership policy, a
removal that revokes the member's refresh tokens in the **same transaction** as the removal would see
its own removal, find no active membership, and revoke **zero rows silently**, turning a revocation
into a re-pointing. `password_reset_token` carries no such same-transaction removal path, so the
`EXISTS` shape costs it nothing.

⚠ **`customer.customer`'s own tenant policy widens 2026-09-10, migration 16, and narrows the command
while it does.** The pre-membership policy was `FOR ALL`, partition-shaped: one account, one company,
so two tenants' reachable rows never overlapped. Under membership they **overlap** — a shared member
reaches every business they belong to — so widening the `USING` arm of a `FOR ALL` policy would hand
an admin of B the ability to *write* A's row. Migration 16 instead `DROP POLICY` + `CREATE POLICY`s a
**`FOR SELECT`**-only replacement: `USING (id = app.customer_id OR id IN (SELECT customer_id FROM
customer_membership WHERE account_id = app.account_id AND removed_at IS NULL))`. `app_customer_role`
is left with **no policy at all** for `INSERT`, `UPDATE` or `DELETE` on `customer.customer`, which
PostgreSQL reads as **zero rows** — and that costs nothing, because every write to this table already
runs on the owner connection (the anonymous onboarding wizard) or through the employee host's
back-office policy.

⚠ **The admin flag is not an RLS concept.** `is_admin` **[DEC-71]** ~~decides who may *approve*~~ *(⚠ the role gates the administrative writes since [DEC-152], and approves nothing since [DEC-179])*, which
is an authorisation check in the domain **[F13-R43]**, re-validated against the account record on
every request. Row-level security answers "whose rows are these", and the answer is the same for an
admin and a non-admin of the same company.

⚠ **Amended 2026-09-10 by [DEC-152], and half of it is now the opposite.** The conclusion still
holds — row-level security answers *"whose rows are these"*, and the answer is the same for an `admin`
and a `viewer` of the same business. What is no longer true is the premise: `customer.is_admin_of()`
**is** consulted by a policy, in `customer_membership`'s `WITH CHECK`, because a write to that table
is the one place *"who may change this"* and *"whose rows are these"* are the same question. That is
also why the function is `SECURITY DEFINER` with a **pinned `search_path`** and why the `DELETE`
privilege is withheld rather than guarded: a policy can express the admin test on an `INSERT` and on
an `UPDATE`'s new row, and on a `DELETE` it cannot express it at all.

## 7. Migrations

- EF Core migrations, applied by a dedicated migrator job before any host starts
  ([Solution structure](02-solution-structure.md) §4).
- Forward-only. No down migrations in production.
- Expand/contract for anything breaking: add, backfill, switch, remove — across separate releases. ⚠ **Set aside for the landing of [DEC-180]: one release, no second column and no compatibility window, as for [DEC-179]. §7.12.**
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
| ~~`trading.trade` four-eyes columns~~ | ~~Additive, all nullable~~ | ~~Safe under expand/contract. ⚠ **[DEC-71]**: two of the four (`four_eyes_threshold_version_id`, `threshold_amount_applied`) are **not added**, and `approval_request_id` is added in their place. The `CHECK`s still hold for every existing row because the surviving columns are `NULL` on them~~ ⚠ **Removed 2026-10-12 by [DEC-179]** — dropped by migration 39 (§7.11). |
| `ix_trade_open`, `ix_trade_expiring` | `DROP INDEX` + `CREATE INDEX … CONCURRENTLY` | ~~⚠ **Must ship in the same release as the `AWAITING_APPROVAL` state, not after it.** Between the two there is a window in which accepted-but-unapproved trades are invisible to the expiry job and their reservations are never released~~ — §3.4.1. ⚠ **Re-created without `AWAITING_APPROVAL` by migration 39 (§7.11), [DEC-179]** |
| `customer.metering_point.production_expectation` **[DEC-65]** | Additive, `DEFAULT 'UNKNOWN'` | Deliberately **not** backfilled to `NEVER` or `EXPECTED`. Every existing point is `UNKNOWN` until someone establishes the answer, which is the whole point of the third state — §3.1.1. ⚠ **[DEC-112]** adds `CUSTOMER_DECLARED` to the `_source` check — a widening, safe in place |

### 7.3 The 2026-08-19 schema changes

| Change | Form | Note |
| --- | --- | --- |
| `metering.brp` **[DEC-69]** | New table, **created before** the column that references it | Seeded with **one row, PVNed** **[F02-R44]**, in the same migration — because `customer.metering_point.brp_id` is `NOT NULL` and every existing point has to point somewhere. Backfilling to the PVNed row is correct here and only here: it is the only BRP that has ever delivered a document |
| `customer.metering_point.brp_id` **[DEC-69]** | Add nullable → backfill to PVNed → `SET NOT NULL`, across one release | Expand/contract, but the backfill is safe enough to run in the same release: the value is knowable for every row without asking anyone |
| `customer.customer.four_eyes_enabled` *(dropped by migration 39, [DEC-179])*, ~~`customer_account.is_admin`~~ **[DEC-71]** | Additive, `NOT NULL DEFAULT false` | Both default **off**, so no company changes behaviour on deploy. ⚠ A company cannot enable the mode until it has **two** admins **[F01-R43]** — an application guard, not a constraint, because it counts rows in another table. ⚠ **`is_admin` is dropped 2026-09-10 by [DEC-152]**; see the row below |
| ~~`customer.approval_request` **[DEC-71]**~~ | ~~New table~~ | ~~Empty on deploy and correctly so: there is no historic approval to reconstruct, and inventing rows for past trades would fabricate a control that was not applied~~ ⚠ **Removed 2026-10-12 by [DEC-179]** — never created. |
| `customer.customer_bank_account` **[DEC-71]**, **[DEC-61]** | New table + **backfill from the three `customer` columns** + drop, across separate releases | ⚠ The one genuinely breaking move this round. Existing `iban`/`bic`/`bank_account_holder` become one `ACTIVE` row per customer that has them, with `added_by_account_id` set to the account that last edited the customer — **or the migration fails loudly** rather than inventing an actor, because the whole table exists to say who added an account. ⚠ **As built 2026-09-28 [DEC-165]:** the source was `customer.onboarding_application`, not `customer` columns — the built table never had them — in **one** migration (26, §7.6), with no actor invented: `added_by_account_id` is nullable, and the row's own `source` says where it came from |
| `trading.trade.total_power_mw`, ~~`trading.block_allocation.power_mw`~~ **[DEC-70]** | `DROP CONSTRAINT` + `ADD CONSTRAINT … NOT VALID`, then `VALIDATE` | ⚠ **Check the existing rows before validating.** Every row written under **[DEC-32]** is a multiple of 0,1 MW, therefore also a multiple of 0,01 MW, therefore passes — the change is a **loosening**. If a row fails, it was written outside the old constraint and the migration has found a real defect |
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
| `market.price_indication_markup` **[DEC-80]** | New table, **seeded with 2%** | Unlike every other reference table here, this one **must not ship empty**: with no row in force there is no markup, and rendering **renders Unavailable** — exactly what **[F04] §8** and **[DEC-161]** require, and what a silent fallback to the raw quote would breach under **[DEC-80]** ⚠ **Corrected 2026-09-23 by [DEC-161]** — this row previously read "rendering falls back to the raw quote", which was never the intended behaviour and would have breached [DEC-80] silently; the platform has always been required to refuse to render rather than fall back, and this text now says so |

### 7.4 The 2026-09-10 multi-business membership migrations

⚠ **A deliberate departure from §7's own rule, stated rather than silent.** §7 asks for
expand/contract **across separate releases** for anything breaking. Migration 15 below does not do
that: it adds, backfills, re-points and drops inside **one** migration, in one strictly-ordered
transaction. That is safe here **only** because the whole membership feature ships on an unreleased
branch — there is no prior release's traffic to keep working against the old shape mid-rollout, which
is the entire reason expand/contract exists. The same departure would be a defect against a table
already carrying production traffic.

| Change | Form | Note |
| --- | --- | --- |
| `customer.customer_membership` + the `customer_account` column drop **[DEC-152]** | New table + backfill + policy swap + **`DROP COLUMN`**, all in migration **15** (2026-09-11), in that order | ⚠ **The one irreversible move of this round, and the order is the whole of it.** Add `last_active_business_id` *before* anything writes to it; create the table with its `REVOKE`, its grants and both policies; backfill one membership per account (`is_admin ? 'admin' : 'trader'`); run the **first-admin repair**; backfill the preference column; swap the three dependent policies and give `refresh_token` its own `customer_id`; and **only then** drop `customer_id` and `is_admin`. Dropping earlier errors on dependent objects, and `CASCADE` would silently take all three policies — leaving `customer_account` with RLS enabled and no policy, after which every authenticated request 401s. ⚠ **The backfill creates businesses with no admin**: `is_admin` defaulted false, so a company whose accounts were all non-admin gets none, violating the floor on deploy and leaving a business that can never invite anybody. The repair promotes the **active account with the lowest `id`** — ordered by `id`, not by `created_at`, because `customer_account` has **no `created_at`** column at all — and **writes an `audit.audit_record` per promotion**, because **[F13-R41]** forbids a *"first account of a company is admin"* rule by name. ⚠ **The ordering IS a chronology claim, not an arbitrary tiebreak.** `customer_account.id` carries `DEFAULT gen_random_uuid()`, but that default is a fallback the application never reaches: `CustomerAccount.Create` mints its own `Guid.CreateVersion7()`, and the EF mapping marks the column `ValueGeneratedNever()` so the client-generated value — never the column default — is what gets written. `CreateVersion7`'s leading 48 bits are a millisecond timestamp laid out in the byte order PostgreSQL's `uuid` comparison uses, so ordering by `id` **is** ordering by creation time for every account this application has ever created — a proxy, and named as one in the migration's own comment. "Lowest id" therefore promotes the **oldest** active account, deterministically. A business whose only admin is `DEACTIVATED` or `INVITED` is **not** repaired over — promoting someone over a deactivated admin is a privilege grant nobody decided, while reactivating that admin is a back-office action support can already take. Two separate `RAISE NOTICE`s name, respectively, businesses with no active account at all and businesses with no *active* admin (a superset, since it also catches the not-repaired-over case) — and EF migrations do **not** surface `RAISE NOTICE` output, so "listed in the migration output" describes what the SQL does, not what an operator sees without querying for it |
| `customer_customer_tenant_isolation` on `customer.customer` **[DEC-152]** | `DROP POLICY` + `CREATE POLICY`, migration **16** (2026-09-15) | The old policy was `FOR ALL`, partition-shaped. Under membership, two tenants' reachable rows **overlap** — a shared member reaches every business they belong to — so widening a `FOR ALL` policy's `USING` arm would hand an admin of B the ability to *write* A's row. The replacement narrows the **command** to `FOR SELECT` and widens `USING` with a membership arm instead; `app_customer_role` is left with no policy at all for `INSERT`/`UPDATE`/`DELETE`, which costs nothing since every write to this table already runs on the owner connection or the employee back-office policy — §6 |
| `customer.customer_invitation` **[DEC-152]** | New table, migration **17** (2026-09-16) | One admin asking one email address to join one business, in one role, once, within **fourteen days** **[F13-R21]** — `password_reset_token`'s shape, keyed on `customer_id` rather than `customer_account_id`. `app_customer_role` gets `SELECT, INSERT` only; `app_employee_role` gets `SELECT` only, because the back office has no membership screen at all **[OQ-105]**. **No `DELETE` grant to either role**, for the same reason `customer_membership` has none — §3.1 |

### 7.5 The 2026-09-23 forward price indications migration

⚠ **One migration, 25, sequential in the platform lane** — the last recorded here was **17**
(§7.4); migrations 18–24 belong to work this register has not caught up on documenting. Neither
**[OQ-106]** (the withdrawal four-eyes SQL-injection residual, closed; moot since 2026-10-12) nor **[OQ-107]** (the
back-office wallet read surface) registers this documentation gap — it is a separate, undocumented
shortfall of this register, not one either of those open questions carries, and this round does not
attempt to backfill it.

| Change | Form | Note |
| --- | --- | --- |
| `market.price_indication_product`, `market.price_indication_observation` **[DEC-161]** | New tables, migration **25** | Generated with `dotnet ef migrations add PriceIndications`, plus raw SQL the EF model cannot express — the append-only trigger and function, and the view/`REVOKE` below. Seeded with **24 product rows** in the same migration: Base/Peak × M1–M6, Q1–Q4, Y1–Y2, literal UUIDs, `display_order` grouped Month/Quarter/Year then offset ascending then Base before Peak |
| `market.price_indication_markup` **[DEC-161]** | **New table, migration 25** — created with `CreateTable`, the same as `price_indication_product` and `price_indication_observation` above, not an `ALTER` against a prior shape | ⚠ **Not a reconciliation of a live schema — a first creation.** This table exists only in the design document (§3.3), sketched with a `percentage`/`daterange` shape that no migration ever built; there is no `percentage` column to `DROP`, no `daterange` `EXCLUDE` to swap, and no backfill, because nothing has ever shipped against the old sketch. Migration 25 creates it directly in the reconciled shape: `markup_rate numeric(6,4)`, `valid_from`/`valid_to`, a generated `validity tstzrange` added via `migrationBuilder.Sql` (EF has no native range mapping), and its `EXCLUDE USING gist`. Seeds **one** row: `markup_rate 0.0200`, `valid_from '2026-01-01T00:00:00Z'`, `valid_to NULL`, `note 'Default 2 % per DEC-80'` (the literal, space included — matches the seeded value), `created_by 'migration:PriceIndications'` |
| `market.price_indication_latest` view + `REVOKE SELECT … FROM app_customer_role` **[DEC-161]** | New view + `REVOKE`, migration **25** | Least privilege (§3.3): the app-customer connection reads the view, never the append-only table directly. ⚠ **The view does not enforce period or source filtering, and neither does the REVOKE.** The view is `DISTINCT ON (product_id, delivery_start, source)` with no other predicate, so it returns the latest row for **every** period ever observed and **every** source, including a period that has since rolled off or a `SIMULATED` row served after the provider is reconfigured. What it guarantees is narrower: **one row per (product, period, source), the latest by construction** — no earlier observation within a single (product, period, source) can leak through. Filtering to the currently resolved period and the configured source is still the endpoint's own job |
| `PeakPowerDbContextModelSnapshot.cs` | Regenerated in the same commit | EF 10's pending-model-changes check has no suppression; the Designer file and the snapshot are committed together with the migration, not as a follow-up |

### 7.6 The 2026-09-28 company bank account migrations

⚠ **Two migrations, 26 and 27, sequential after 25 (§7.5)** in the platform lane. Migration 26 is the expand —
the table, its grants and the backfill — and migration 27 is the contract: it revokes the two onboarding grants
that migration 26's readers made unnecessary.

| Change | Form | Note |
| --- | --- | --- |
| `customer.customer_bank_account` **[DEC-165]** | New table, migration **26** (`CompanyBankAccounts`) | `SELECT`-only grants to both roles after a `REVOKE ALL`, two `FOR SELECT` policies, the partial unique index and three `CHECK`s — §3.1.3. Roll forward only; the `Down` revokes explicitly rather than leave migration 2's default privileges standing over a re-created table |
| Backfill from `customer.onboarding_application` **[DEC-165]** | `INSERT … SELECT DISTINCT ON`, migration **26**, after the table exists | One `ACTIVE`, `ONBOARDING` row per customer with a signed application carrying an IBAN; idempotent through `ON CONFLICT DO NOTHING`. A customer with none gets no row and no error — §3.1.3 |
| `wallet.withdrawal_request` **[DEC-165]** | `GRANT UPDATE (destination) … TO app_employee_role`, migration **26** | Column-scoped, widening `(status, resolved_at)` by `destination` only. `app_customer_role` gains nothing: a replace re-points open withdrawals on the owner connection |
| `customer.onboarding_application` grants **[DEC-165]** | `REVOKE SELECT (iban, customer_id)` from both application roles and `DROP POLICY` on the two policies beside them, migration **27** (`OnboardingIbanGrantRetired`) | Migrations 22 and 23 opened those column grants for two readers — the bank-transfer matcher and the withdrawal request — that now read `customer_bank_account`'s `ACTIVE` row. Row-level security **stays enabled** on the table; the wizard's own reads are anonymous, on the owner connection, and were never gated by either. `Down` restores both grants and both policies |

### 7.7 The 2026-09-29 withdrawals desk and four-eyes migrations

⚠ **Two migrations, 28 and 29, sequential after 27 (§7.6)** in the platform lane. Both are additive `ALTER`s on
tables that already exist, both nullable, so nothing is backfilled and no company changes behaviour on deploy.
Roll forward only, as every migration here.

| Change | Form | Note |
| --- | --- | --- |
| `wallet.withdrawal_request` **[DEC-166]** | Three nullable columns, migration **28** (`WithdrawalPayoutDetails`, `20260929031716`): `bank_reference text`, `paid_by_employee_id text`, `paid_by_employee_name text` | `ck_withdrawal_request_bank_reference_length`: `bank_reference IS NULL OR char_length(bank_reference) <= 140`, because the API's `400` is not the last line of defence. All three stay null until a request is `PAID`. No foreign key to `employee.employee` — the customer role reads this table and a cross-realm key buys nothing the name snapshot does not give. `paid_by_employee_name` is a snapshot, so a later rename never rewrites history |
| `wallet.withdrawal_request` grants **[DEC-166]** | `GRANT UPDATE (bank_reference, paid_by_employee_id, paid_by_employee_name) … TO app_employee_role`, migration **28** | Column-scoped, widening `(status, resolved_at, destination)` by exactly those three columns — the only ones the payout newly touches. `app_customer_role` gains nothing: its table-level `SELECT` already covers the new columns, so the customer role **can** read the payer columns although no customer API returns them (the customer DTO maps `bank_reference` only) |
| `customer.customer` **[DEC-166]** | Two nullable columns, a foreign key, an index and two `CHECK`s, migration **29** (`CustomerFourEyesDisableRequest`, `20260929035903`) — ⚠ **dropped again by migration 39, §7.11** | §3.1.4. No grant change: customer-host writes to the table are already owner-privileged since migration 16. The `Down` drops the foreign key, index, `CHECK`s and columns in that order |
| `PeakPowerDbContextModelSnapshot.cs`, the migration pins and `tools/verify-migrator.sh` | Updated in the same commits | The Designer file, the snapshot, the pins for history, `CHECK`s and the employee `UPDATE` columns, and the migrator script move with each migration, not as a follow-up |

### 7.8 The 2026-09-29 trading migration

⚠ **One migration, 30 (`Trading`)** — the next free number when it lands; 29 is §7.7's — in the platform lane. It creates a schema, so the roll-forward-only rule bites harder than in §7.7: nothing is `ALTER`ed except `wallet.ledger_entry`, which gains two indexes.

| Change | Form | Note |
| --- | --- | --- |
| `trading` schema **[DEC-167]** | ⚠ **Four** tables since 2026-09-30 (migration 30's count; migration 32 adds a fifth, `trade_desk_notice`, [DEC-168]) (`trade`, `trade_connection`, `trade_event`, `block`; ~~`trade_line`, `block_allocation`~~ — [DEC-167] (16)), the sequence `trade_reference_seq` from 1001, the `CHECK`s, **two** triggers, **eight** policies, the grants — §3.4.4 | Every `CHECK` is declared in EF so the snapshot agrees. The `Down` drops policies, triggers and functions, revokes, then drops tables, sequence and schema |
| `wallet.ledger_entry` **[DEC-167]** | Two partial unique indexes, `ux_ledger_entry_trade_reserved` and `ux_ledger_entry_trade_exit`, keyed `(wallet_id, caused_by_id)` where `caused_by_type = 'Trade'` | One reservation and one exit per trade. Created in the same migration as the first producer of `TRADE_*` entries |
| A wallet for every company | **Not a migration:** an unconditional, idempotent Migrator step, `WalletBackfill`, runs after seeding, and the back-office `POST /api/v1/customers` creates the wallet in the same `SaveChanges` | Only onboarding created wallets before; deposits answered 404 without one |
| The migration pins, `PeakPowerDbContextModelSnapshot.cs` and `tools/verify-migrator.sh` | Updated in the same commits | The history length and the applied list, the `CHECK`, grant and policy pins, the query-filter and row-level-security catalogue pins, the model-shape and enum-wire pins, and the migrator script move with the migration |

### 7.9 The 2026-10-05 legal documents migration

⚠ **One migration, migration 36 `20261005040247_LegalDocuments`**, the next after `RemoveSeededDayAheadPrices` ([DEC-172]). Roll forward only. It creates a schema, so nothing is backfilled.

| Change | Form | Note |
| --- | --- | --- |
| `legal` schema **[DEC-174]** | Three tables, the `CHECK`s and the unique keys of §3.7, the two seeded built-in types, the grants | Every `CHECK` is declared in EF so the snapshot agrees. The `Down` drops the tables and the schema |
| `customer.onboarding_application` **[DEC-174]** | One nullable column, `terms_version_id`, its index and its foreign key (`ON DELETE RESTRICT`) | No backfill: every application before the migration has no recorded version, and none can be reconstructed |
| Privacy Statement v1 **[DEC-174]** | **Not a migration:** the Migrator's `LegalDocumentSeeder` | Idempotent, every pass, only when the type has no version |
| The migration pins, `PeakPowerDbContextModelSnapshot.cs`, `tools/verify-migrator.sh` and both OpenAPI snapshots | Updated in the same commits | The history length, the grant pins, the schema list and the route classification move with the migration. `verify-migrator.sh` also pins the seeded v1 to the embedded file's size and SHA-256 |

### 7.10 The 2026-10-09 legal documents in English and Dutch migration

⚠ **New 2026-10-09 by [DEC-177]: one migration, migration 38 `LegalDocumentLanguages`**, the next after `CustomerRowVersion` (migration 37); the legal schema itself came with `LegalDocuments` (migration 36, §7.9). Roll forward only. It changes a schema that already holds rows, so it **backfills**, and the backfill has a test (the `CompanyBankAccountsBackfillTests` pattern): existing single-file versions become **two identical rows**.

| Change | Form | Note |
| --- | --- | --- |
| `legal.document_file` **[DEC-177]** | **In this order** (the `nl` insert would collide with the old primary key on `version_id` otherwise): (1) add `language`, `file_name`, `size_bytes` and `sha256`; (2) backfill each existing row from its version with `language = 'en'`; (3) drop the old primary key on `version_id`; (4) insert, for every one of those rows, an `nl` row with the **same bytes, name, size and SHA-256** (two identical rows per existing version); (5) make the columns `NOT NULL`, add `PRIMARY KEY (version_id, language)`, `ck_document_file_language`, `ck_document_file_size` and `ck_document_file_sha256_format`; (6) drop the moved version columns. **The backfill test must start from a database that already holds at least one version** (the `CompanyBankAccountsBackfillTests` pattern), because a fresh empty database hides a wrong order: the seeder runs after the migrations | Every version holds both languages afterwards, so the fallback of F16-R38 has nothing to fall back on (it stays built and tested). Each existing file is stored twice |
| `legal.document_version` **[DEC-177]** | Drop `file_name`, `size_bytes`, `sha256` and the two `CHECK`s that moved | After the backfill, in the same migration. Version ids do not change, so `terms_version_id` foreign keys stay valid |
| `customer.onboarding_application` **[DEC-177]** | One nullable column, `terms_language varchar(2)` with `ck_onboarding_application_terms_language` | **No backfill:** pre-existing rows keep `NULL` (the single-file era; the version's two copies are identical bytes). The write grant that covers `terms_version_id` covers the new column |
| Privacy Statement v1 **[DEC-177]** | **Not a migration:** the Migrator's `LegalDocumentSeeder`, now importing the English PDF in both languages | Idempotent; acts only when the type has no version, so a database that migrated keeps its two copies |
| Audit | **Nothing rewritten** | Old `LEGAL_DOCUMENT_UPLOADED` payloads keep their single file fields; new ones carry `files` |
| The migration pins, `PeakPowerDbContextModelSnapshot.cs`, `tools/verify-migrator.sh`, `LegalDocumentsSchemaTests` and both OpenAPI snapshots | Updated in the same commits | The history length, the file columns and `CHECK` names, the seeded v1's two rows, the `terms_language` column and the changed contracts move with the migration. Run `tools/verify-migrator.sh` before landing |

### 7.11 The 2026-10-12 four-eyes removal migration

⚠ **One migration, 39 (working name `RemoveFourEyes`)** — the next free number after 38 (§7.10) — in the platform lane, **[DEC-179]**. It is data **and** schema in one step, because the rollout is one coordinated landing; it is written to be correct for zero rows and for many, and a backfill test on a production-like database (awaiting, already approved, refused and expired trades; awaiting, approved and declined withdrawals; companies with the mode on, with and without a pending turn-off request) proves it. Roll forward only, as every migration here; old migrations are never edited. It starts by taking `ACCESS EXCLUSIVE` locks on `customer.customer`, `trading.trade` and `wallet.withdrawal_request` in one statement (the old containers still serve during a deploy, and piecemeal locks could deadlock with an accept in flight). The steps run in this order, in one transaction:

| Step | What | Why |
| --- | --- | --- |
| 1. Guards | **Raise** if any `customer_bank_account` is `PENDING_APPROVAL`; **raise** if a trade has an approver or a refuser without the matching `trade_event` (the parity guard) | Nothing may be dropped that exists nowhere else, and nothing may be bound that main would have released. The bank-account state was never written, so that guard is an assertion; the parity guard protects the one fact the trade columns hold. There is **no guard** on a waiting trade whose approval window lapsed in the seconds before the migration: the first admin accepted inside the offer window, so that acceptance stands and the trade is promoted like every other waiting trade. A guard was tried and removed, because a deploy stops the old Worker before the migrator runs, so a migration that raised there would leave production stopped with nothing left to expire the trade **[DEC-179]** |
| 2. Companies | One `audit.audit_record` per company with `four_eyes_enabled` (action `FOUR_EYES_REMOVED`, system actor, before and after as jsonb **including a pending turn-off request**); then `four_eyes_enabled = false` and the two request columns `NULL` in one statement | Every company behaves as one that never had the mode. The row says why the setting went off without a second admin. The `customer.customer` version trigger bumps those rows, so an open back-office edit form gets one stale-version answer |
| 3. Trades | Every trade in `AWAITING_APPROVAL` becomes `ACCEPTED`: an append-only `trade_event` (`ACCEPTED`, from `AWAITING_APPROVAL`, **system actor**, reason *"A second approval is no longer required. The acceptance stands and the deposit stays reserved."*: a stored reason that stays readable and names no decision number, because it remains in the append-only history and in the API answer for ever; both portals print their own catalogue title and sentence, in English and Dutch, for this system entry instead of the stored text) with the next sequence number, `last_event_sequence` advanced, the desk's *ready to confirm* notice written word for word as for any accepted trade (price, Dutch amounts, the deposit or the gross when no deposit is stored), and one audit row (`TRADE_APPROVAL_WAIVED`, which carries DEC-179). The reservation already exists and is **not** touched; no ledger entry is written; no approver is invented | Acceptance stands **[DEC-179]** (2). The two `CHECK`s that tie `ACCEPTED` to an approver for a four-eyes trade (`ck_trade_four_eyes_approved`, `ck_trade_awaiting_approval_is_four_eyes`) are dropped **right after the guards, before any data step** (so before step 2), so that the update is legal and does not fake an approver; step 5 drops the rest |
| 4. Withdrawals | Each approval already given is copied to the audit log (`WITHDRAWAL_APPROVED`, actor `account:<id>`; the row states that the approval time was never recorded) so that `approved_by_account_id` can be dropped; then one audit row per withdrawal in `AWAITING_APPROVAL` (`WITHDRAWAL_APPROVAL_WAIVED`) and `AWAITING_APPROVAL` → `REQUESTED` | The hold stays; the payout has no approver and the row says so; any admin can still cancel while it is `REQUESTED` |
| 5. Drops | `customer.customer.four_eyes_enabled`, `four_eyes_disable_requested_by_account_id` (with its foreign key and index) and `four_eyes_disable_requested_at`, and the `CHECK`s `ck_customer_four_eyes_disable_request_complete` and `ck_customer_four_eyes_disable_request_implies_on`; on `trading.trade` the four columns of §3.4.2, their two foreign keys and the two indexes `ix_trade_approved_by_account_id` and `ix_trade_approval_refused_by_account_id` and the six `CHECK`s of §3.4.2; on `wallet.withdrawal_request` `approved_by_account_id` and `ck_withdrawal_request_approver_not_requester` | Configuration and approver columns whose facts live in the append-only logs. Dropping a column removes its column grants; none is re-issued |
| 6. Tightenings (re-created under the **same** names) | `ck_trade_state` without `AWAITING_APPROVAL` (it keeps `APPROVAL_REFUSED`); `ck_withdrawal_request_status_valid` without `AWAITING_APPROVAL` (it keeps `APPROVAL_DECLINED`); `ck_customer_bank_account_status_valid` without `PENDING_APPROVAL`; `ck_trade_reservation_present` without `AWAITING_APPROVAL` and without its `four_eyes_applied IS NOT NULL` clause, and `ck_trade_settlement_present` without `AWAITING_APPROVAL` (it never had the `four_eyes_applied` clause); `ix_trade_open` and `ix_trade_expiring` without `AWAITING_APPROVAL` | The state cannot come back |

**Kept, and why.** The `trade_event` `CHECK`s (`ck_trade_event_type`, `_from_state`, `_to_state`) are **not touched**: the table is append-only by trigger and its rows carry `APPROVED`, `APPROVAL_REFUSED` and `AWAITING_APPROVAL`. `wallet.withdrawal_request.decline_reason` stays, shown on old declined rows. Every `audit.audit_record` row with a `FOUR_EYES_*` action stays, and the ledger is never touched. **`customer_account.status = 'PENDING_APPROVAL'`** is out of scope: it is not four-eyes. **Pins:** `tools/verify-migrator.sh` (the migration count and name, the `customer.customer` `CHECK` list becomes exactly `ck_customer_deposit_pct_range`, the `wallet.withdrawal_request` `CHECK` list loses the approver one, the customer-readable `trading.trade` column count falls by the four dropped columns, and new pins assert no `four_eyes_%` column on `customer.customer`, that the three status `CHECK`s no longer contain `AWAITING_APPROVAL` or `PENDING_APPROVAL`, and that `ck_trade_event_type` still allows `APPROVED` and `APPROVAL_REFUSED`), `PeakPowerDbContextModelSnapshot.cs`, the migration-count tests and both OpenAPI snapshots move in the same commits. **Audit action names** (`FOUR_EYES_REMOVED`, `TRADE_APPROVAL_WAIVED`, `WITHDRAWAL_APPROVAL_WAIVED`, `WITHDRAWAL_APPROVED`) are the working names of this spec; the platform change fixes them.

### 7.12 The 2026-10-13 kW, kWh and €/kWh migrations — [DEC-180], added 2026-10-13

⚠ **Four migrations, 40 to 43 (`DayAheadFeed`, `IndicationPricePerKwh`, `TradingKwhUnits`, `SavedCosts`) in the platform lane, [DEC-180].** As built 2026-10-13 by [DEC-180], on the branch `feature/kwh-units`; not yet landed on the VM. Each is written to be correct for zero rows and for many and for an offer in flight, and each has a backfill test on a production-like database. Roll forward only, as every migration here, and each has a real `Down()` that is tested. The rollout is one coordinated landing: no second column and no compatibility window (§7).

**1. The four.**

| # | Name | Contains, in order | Data it touches |
| --- | --- | --- | --- |
| 40 | `DayAheadFeed` (`20261013164002_DayAheadFeed`) | add `market.day_ahead_price.updated_at`; create `market.day_ahead_feed_run` with its index and six `CHECK`s; `REVOKE ALL … FROM app_customer_role`; swap `operational_alert_kind_check` for the seven-value list | none |
| 41 | `IndicationPricePerKwh` (`20261013184255_IndicationPricePerKwh`) | a 20-second `lock_timeout`; `CREATE OR REPLACE VIEW market.price_indication_latest` with `price_eur_per_kwh` appended; drop and create `market.price_indication_close_before` returning `price_eur_per_kwh`; `REVOKE … FROM PUBLIC`; `GRANT … TO app_customer_role` | none; the observation table is not altered, rewritten or locked exclusively |
| 42 | `TradingKwhUnits` (`20261013191536_TradingKwhUnits`) | a 20-second `lock_timeout`; `LOCK TABLE trading.trade, trading.block IN ACCESS EXCLUSIVE MODE`; a money fingerprint; three audit inserts; the trade: drop four `CHECK`s, one `ALTER … TYPE … USING`, five renames, four `CHECK`s; the block: the same shape; two column grants; a self-check | rewrites `trading.trade` and `trading.block`; one audit row per price that lost digits. No euro amount, no wallet row, no ledger row |
| 43 | `SavedCosts` (`20261013215101_SavedCosts`) | `LOCK TABLE` on five input tables `IN SHARE ROW EXCLUSIVE MODE`; four tables with grants, row security and policies; seven functions; seven triggers; one conditional `BACKFILL` request | at most one inserted row |

**2. Why this order.** Four constraints decide it:

| Constraint | How the order meets it |
| --- | --- |
| The view's lock is taken before the trade and block locks | 41 before 42 |
| Nothing earlier in the run locks a relation a trading or Prices request uses | 40 locks `market.day_ahead_price` and `metering.operational_alert`; quote, submit, accept, offer and confirm read neither |
| The triggers are created after every other statement of the landing | 43 is last. No statement of 40, 41 or 42 could fire them anyway |
| The backfill request is decided on the final state | 43 is last |

Migrations commit one by one (§5, test L4), and the order leaves as much as possible that old code can still use: after 40 old code runs unchanged, after 41 it runs except the end-of-day column of the Prices page, and from 42 on only new code runs.

**3. What proves each.** The built test names (the platform's `tests/PeakPower.Integration.Tests/Migrations/`). The migration 42 file has one more, `A_failure_in_a_run_from_39_ends_at_41_or_at_39_and_never_in_a_mix`, and the 43 file a few that are not listed here.

| Migration | Backfill tests |
| --- | --- |
| 40 | `Existing_prices_survive_byte_for_byte_and_get_a_null_stamp`; `An_empty_price_table_and_an_empty_alert_table_migrate`; `Alerts_of_all_six_old_kinds_open_and_resolved_survive_and_the_seventh_is_accepted_afterwards`; `The_old_five_column_insert_still_works_after_the_migration`; `The_ledger_the_wallets_the_trades_and_the_blocks_are_byte_identical_before_and_after` |
| 41 | `The_view_keeps_what_the_source_sent_next_to_the_price_per_kWh_and_the_function_returns_per_kWh`; `The_observation_table_is_untouched` |
| 42 | `An_empty_database_migrates_and_writes_no_audit_row`; `Power_and_volume_are_multiplied_by_1000_exactly_and_every_price_is_rounded_half_away_from_zero`; `No_stored_euro_amount_changes_and_the_ledger_and_every_wallet_are_byte_identical`; `Each_trade_and_block_whose_price_lost_digits_has_one_audit_row_with_the_original_price_and_no_other_has_one`; `An_offer_made_before_the_migration_is_accepted_for_exactly_the_amounts_it_showed`; `The_block_stays_immutable`; `Twenty_thousand_trades_and_ten_thousand_blocks_migrate_with_the_default_command_timeout`; `A_failure_late_in_the_migration_leaves_the_trading_tables_as_they_were` |
| 43 | `An_empty_database_migrates_and_queues_nothing`; `A_production_like_database_queues_one_backfill_and_the_drain_fills_both_tables_for_all_history`; `An_offer_in_flight_is_untouched_and_adds_no_hedge`; `The_ledger_the_wallets_and_every_trade_row_are_byte_identical_before_and_after`; `The_backfill_can_be_stopped_and_resumed_and_ends_the_same`; `With_a_limit_of_zero_the_migrator_leaves_the_requests_and_one_worker_drain_finishes`; `The_budget_cancels_a_batch_in_flight_and_the_migrator_still_exits_0`; `A_reading_stored_after_the_migration_and_before_the_new_Worker_is_requested` |

The landing as a whole has six tests, L1 to L6: all four migrations apply in one run on a production-like database (L1); the ledger, the wallets and every stored euro amount are byte-identical after the migrations and the whole backfill, `xmin` and `ctid` included (L2); an offer made at migration 39 is accepted after the landing for the amounts it showed, and its block enters the saved position at confirm (L3); a failure in the last migration leaves the database at migration 42, because each migration commits by itself (L4, `A_failure_in_the_last_migration_leaves_the_database_at_migration_42`, which decided assumption S2 on 2026-10-14); a second run applies nothing and the backfill goes on where it stopped (L5); and `Down()` walks back through all four to the schema of migration 39 (L6). Five more tests (L7 to L11) run the day-ahead job against the real triggers and engine.

**4. The backfill.** One `BACKFILL` request, queued by migration 43 when there is anything to cost. The Migrator runs the engine as its last step, after the schema migrations and the seeders, for at most `SavedCosts:MigratorBackfillSeconds` (default 120, a hard limit: the batch in flight rolls back; 0 skips the step). It never fails the Migrator: it catches, logs and returns. The Worker finishes what is left, nearest day first. ⚠ **Measured 2026-10-14 (task L1), on a laptop, not on the VM:** the engine writes 131 000 to 148 000 saved rows a second (M1: one customer, 50 connections, 90 days), and 187 000 a second on the load-test set (M2: 3 538 640 rows in 18,9 s), against the 14 000 a second that the 1,65 million rows of 50 connections and all of 2026 need. **The default of 120 stays**: at the measured rate it would cover about 15 million rows. The VM's own rate is not known, and raising the limit is the product owner's call, because every second is downtime.

**5. If the Migrator fails.** In every case the Migrator exits 1, Compose starts no host, and the platform stays down until a person acts (if no old host is still running: row 1 of the last table of this section). ⚠ **Assumption S2 is false, found 2026-10-14 (test L4, task L1): EF Core commits each migration by itself.** A failure in 43 leaves 40 to 42 applied, and the history ends `_TradingKwhUnits`. The right-hand column holds; the left-hand one is struck. Migration 42 is one transaction of its own, so a failure inside it writes nothing of it.

| It fails in | ~~If the run is one transaction~~ | Each migration commits by itself (as found) |
| --- | --- | --- |
| 40 `DayAheadFeed` | ~~at 39, nothing changed~~ | at 39, nothing changed |
| 41 `IndicationPricePerKwh` | ~~at 39, nothing changed~~ | at 40; old code runs unchanged |
| 42 `TradingKwhUnits` | ~~at 39, nothing changed: no audit row, no rewrite~~ | at 41; old code runs except the end-of-day column of the Prices page. Nothing of 42 is written: no audit row, no rewrite |
| 43 `SavedCosts` | ~~at 39, nothing changed~~ | at 42; only new code can run |
| a seeder, after the migrations | ~~at 43; no backfill has run~~ | at 43; no backfill has run |
| the backfill | ~~it cannot fail the Migrator~~ | it cannot fail the Migrator |

**6. Locks.** Migration 42 takes `ACCESS EXCLUSIVE` on `trading.trade` and `trading.block` with a 20-second `lock_timeout`, and 43 takes `SHARE ROW EXCLUSIVE` on its five input tables. Whether a host is still running at that moment is row 1 of the last table of this section. Compose stopped the old hosts first on the deploy of 2026-10-13, as an observation and not a guarantee (row 1). Were one still running, a request in flight could deadlock with the run (the position read takes block then trade, the run takes trade then block), PostgreSQL would end one side within a second, and the deploy is run again: the migrations before the failing one stay applied and the run goes on from there.

**7. Money.** No statement of the four assigns a euro column, a wallet row or a ledger row. Migration 42 ends with a self-check that compares the six money columns of every trade as text before and after, inside the transaction and under the lock, and raises if any changed. A test compares every wallet and ledger row before and after, `xmin` and `ctid` included, and then runs the ledger reconciliation.

**8. Pins move in the same commits:** `tools/verify-migrator.sh` (the ordered migration list, the alert-kind pattern, the grants of the new tables, the employee-only trade columns under their new names, the policy and trigger lists, the empty tables after both migrator runs); the migration-count tests (`MigrationScriptTests`, `MigrationBehaviourTests`); the model snapshot (`PeakPowerDbContextModelSnapshot.cs`); the enum, model-shape, row-level-security and query-filter catalogue tests; and both OpenAPI snapshots (`customer.json`, `employee.json` and their verified copies). `tools/verify-migrator.sh` is run before landing.

**9. To be confirmed at build.** The one table in the specifications that lists what is not known. ⚠ **Part R, 2026-10-14:** rows 2, 3, 4, 6 to 10 and 13 are answered by the build and say what was found; rows 1, 5, 11 and 12 stay open, and say what answers them. The specifications do not state an open row as fact.

| # | Not known | What this page says now | Answered by |
| --- | --- | --- | --- |
| 1 | **Assumption S1:** does `docker compose up -d` stop the old hosts before the Migrator starts, for this landing? | Observed on the four-eyes deploy of 2026-10-13 (Deploy run 38384978431) and on a local stack: the two APIs and the Worker were recreated before the migrator started. An observation with its date, never a guarantee. ⚠ **Re-read 2026-10-14:** the platform's `DEPLOYING.md` records pre-flight O2 as answered by that deploy's log (no host runs while the Migrator runs). The log of this landing's own Deploy has not been read: the landing has not happened | **Open until the landing.** Pre-flight O2, re-read at the landing |
| 2 | **Assumption S2:** does one Migrator run apply all pending migrations in one transaction? | ⚠ **No, found 2026-10-14.** Each migration commits by itself. With the saved-cost table created beforehand, migration 43 fails with `42P07` and the history ends `_TradingKwhUnits`: 40, 41 and 42 stay applied. The right-hand column of §5 holds | **Closed.** Test L4 `A_failure_in_the_last_migration_leaves_the_database_at_migration_42`, task L1 |
| 3 | Saved rows per second; how long the backfill of the load-test set takes; the two range reads before and after; table sizes | ⚠ **Measured 2026-10-14, on a laptop (Apple silicon, 12 CPUs, 24 GiB), not on the VM.** M1: 131 000 and 148 000 saved rows a second (one customer, 50 connections, 90 days). M2: the load-test set (100 connections, 365 days, 4 905 600 readings) drained in 18,9 s, 3 503 600 cost rows and 35 040 position rows, about 187 000 rows a second; `metering.interval_cost` 577 MB, `trading.hedge_position_interval` 7,9 MB. M3, 50 connections over 92 days, median of five warm requests: `GET /consumption/intervals` is **slower** after (622 to 648 ms against 397 to 506 ms before) because it now joins the saved costs; `GET /consumption/position` is about ten times faster (37 to 39 ms against 376 to 410 ms). The VM's own figures are not known | **Closed for the laptop; the VM is not measured.** Task L1 (`L1`, `L1M2`) |
| 4 | The final value of `SavedCosts:MigratorBackfillSeconds` | **120, unchanged (2026-10-14).** At the measured rate 120 seconds cover about 15 million rows against the 1,65 million that 50 connections and all of 2026 need. Raising it is the product owner's call, because every second is downtime | **Closed.** L1 |
| 5 | How many decimals ENTSO-E sends, and whether it revises a published day | Not known. The feed records it: `max_source_decimals` and `rows_changed` on its saved runs | **Open.** After the landing: check C7 of the deploy plan |
| 6 | The migration ids (timestamps) of 40 to 43 | **Fixed 2026-10-13:** `20261013164002_DayAheadFeed`, `20261013184255_IndicationPricePerKwh`, `20261013191536_TradingKwhUnits`, `20261013215101_SavedCosts` | **Closed.** Tasks D2, T3, T4, C3 |
| 7 | The audit action names `TRADE_PRICE_ROUNDED`, `BLOCK_PRICE_ROUNDED`, `TRADE_REFERENCE_PRICE_ROUNDED`; the trigger, function, policy and setting names | **Built as designed (checked 2026-10-14 against migrations 42 and 43).** The three audit actions; the seven triggers `trg_day_ahead_price_recalc_insert`, `_update`, `_delete`, `trg_interval_data_version_recalc`, `trg_block_recalc`, `trg_trade_recalc`, `trg_metering_point_recalc`; the seven functions `metering.recalc_on_price_insert`, `recalc_on_price_update`, `recalc_on_price_delete`, `recalc_on_version_change`, `recalc_on_block_insert`, `recalc_on_trade_state` and `recalc_on_metering_point_update`; the policies of §3.8. The settings are `SavedCosts:Enabled`, `:Interval`, `:RunOnStartup`, `:MaxDaysPerBatch`, `:MaxConnectionDaysPerBatch`, `:MaxBatchesPerTick`, `:VerifyAtHour`, `:VerifyAtMinute`, `:VerifyRecentDays` and `:MigratorBackfillSeconds`, and `DayAheadIngestion:RecheckDays`, `:RecheckAfter`, `:MissingAlertAfter`, `:RunRetentionDays` and `:Provider` | **Closed.** T4 (audit), C3 (triggers), D2, D3, C5 (settings) |
| 8 | The body of the 400 an unknown request member gets | **Found 2026-10-14:** a bare `application/problem+json` answer of the framework, `status` 400, `type` `https://tools.ietf.org/html/rfc9110#section-15.5.1`, no `errors` object and no problem type of ours; nothing is stored | **Closed.** T4, test `A_body_with_an_old_field_name_is_refused` |
| 9 | Whether the four request schemas gain `additionalProperties: false`; whether the feed status string sets are published as OpenAPI enums; where `meteredIntervals` and `costedIntervals` sit in the record | **Found 2026-10-14, in the two committed documents:** all four request schemas have `additionalProperties: false`. The status string sets (`state`, `source`, `outcome`, `recheck`, `code`) are plain strings, with no enum. `meteredIntervals` and `costedIntervals` are the last two members of `ConsumptionSummaryDto`, after `totalCostEur`, each a nullable `int32` | **Closed.** Snapshot review of T4, D5, C7 |
| 10 | The operation and schema counts after the landing | **Confirmed 2026-10-14** by reading both documents against the contract: customer 67 became 66 operations and 113 became 110 schemas (`GET /dashboard/position` and its three schemas gone; 25 members removed and 27 added, which is 24 renames, 1 removal and 3 additions); employee 57 became 59 operations and 84 became 91 schemas (the two status reads and their seven schemas; 10 renames and 1 addition) | **Closed.** L1 |
| 11 | What the deployed database holds: offers in flight, prices with more than 2 decimals per MWh, gaps in the price table, whether a token is set | Nothing. The pre-flight queries exist (Q0 to Q16, O1 to O4 in the platform's `DEPLOYING.md`) and ran against a seeded database; their answers on the VM do not exist | **Open.** Pre-flight Q0 to Q16 and O1 to O4, run at the landing |
| 12 | The twelve defaults of [DEC-180] (15), (a) to (l) | All twelve are built as defaults ((l) is recorded as not decided). **No confirmation or change has been received from the product owner as of 2026-10-14**; the defaults stay marked as taken | **Open.** The product owner |
| 13 | Web wording and mechanics: the sentence for a partial total; the re-read schedule; how many days back the position is re-read; the typed-price and typed-volume parsers; the axis of the day-ahead chart; the card's source line for a simulated source; what an open page says after a deploy; the desk's "Whole MW" badge; whether the two status panels poll | **Built as designed (checked 2026-10-14 against the web reports W4 to W9 and the code).** The partial-total sentence exists in both languages and names no cause; the schedule is a 30-second tick, a waiting day read every 30 seconds six times and then every 5 minutes, and seven days back; the price parser takes at most five decimals, refuses 10 or more and suggests the figure divided by 1000 only when that is a valid price; the volume entry takes whole kW, so `1.000` is one thousand and `0.200` is refused; the day-ahead axis prints round ticks; a price prints in three spellings (`0,09475`, `€ 0,09475`, `€ 0,09475 / kWh`, `units.ts`); the cost chart's accessible name no longer says "priced"; the Data & feeds sentence no longer counts three panels; the card's source line for a simulated source reads the simulated sentence and names no ENTSO-E; an open page is not told about a deploy (no version check, [DEC-180] (14)); the desk's badge is gone; the two status panels do not poll. **Differences and gaps:** the day-ahead chart's Y gutter widens for a label that needs it (`−0,00004`), and the charts stacked on a page (Volume, connection detail) share one Y gutter, so a six-digit kWh tick (`300.000`) prints whole; the customer trades list Status column is wider (212 px) and Data & feeds stacks its two lower panels below 1320 px; a unit keeps its case in the Volume table head and in the back-office capacity label, which now reads "Capacity (kW)" / "Capaciteit (kW)" (the unit sits in its own span that the capitals rule leaves alone). The end-to-end suite and the real-API trial were not run | **Closed, with the gaps above.** Web tasks W4 (re-read, partial total), W5 (entry fields, badge), W6 (axis, source line), W8 (panels), W9 (browser pass) |

### 7.13 The 2026-10-15 EAN search migrations — [DEC-182], added 2026-10-15

⚠ **Two migrations, 44 and 45 (`20261015082132_EanSearchMasterData` and `20261015130245_RemoveEanPool`), in the platform lane, [DEC-182].** ~~Specified 2026-10-15; not built.~~ ⚠ **As built 2026-10-16 by [DEC-182] (13), on `feature/ean-search` (platform tip `0c17204`); not on the VM until the landing.** **Built as designed (checked 2026-10-16 against both migrations):** the Up of 44 (§3.2.2, the column, the grants, the exemption argument as the class comment), the Down of 44 (revoke, drop both tables, drop the column, the data loss stated), the SQL of 45 below word for word (`20261015130245_RemoveEanPool.cs` lines 38 to 52), its Down (the table as migrations 5 and 13 left it, the four grants and the column grant, the claimed rows restored from the audit rows with `NULLIF` for a SQL-null address, exactly those audit rows deleted). The migrator ran Up, Down, Up on scratch databases (tests `EanSearchMasterDataMigrationTests`, `RemoveEanPoolMigrationTests`) and `tools/verify-migrator.sh` ended `OK` when run alone (`logs/P2-verify-migrator.log`, `logs/P8-verify-migrator.log`). Each is written to be correct for zero rows and for many, each has a real `Down()`, and neither is rolled back in production: the platform rolls forward.

**1. The two.**

| # | Name | Up | Down | Runtime |
| --- | --- | --- | --- | --- |
| 44 | `EanSearchMasterData` | create `metering.connection_master_data` and `metering.grid_operator` with their checks; `REVOKE ALL` then the grants of §3.2.2; add `customer.metering_point.edsn_verified_at timestamptz NULL`; the row-security exemption argument of §6 as the migration's comment | `REVOKE ALL` on both; drop both tables; drop the column (a stated data loss) | instant: two empty tables and a nullable column |
| 45 | `RemoveEanPool` | copy every claimed pool row into `audit.audit_record`, then drop `metering.ean_pool` | recreate the table as migrations 5 and 13 left it, restore the claimed rows from the audit rows, delete those audit rows | proportional to the claimed pool rows; instant |

**2. Migration 45.**

```sql
-- ⚠ [DEC-182] (2). Claimed rows keep who claimed which EAN and when; unclaimed rows record nothing.
INSERT INTO audit.audit_record (id, occurred_at, actor, action, entity_type, entity_id, customer_id, before, after)
SELECT gen_random_uuid(), p.claimed_at, 'system:migration', 'EAN_POOL_CLAIM', 'EanPoolEntry', p.id,
       p.claimed_by_customer_id, NULL,
       jsonb_build_object(
         'ean', p.ean, 'claimedAt', p.claimed_at, 'claimedByCustomerId', p.claimed_by_customer_id,
         'commodity', p.commodity, 'gridOperator', p.grid_operator, 'capacityKw', p.capacity_kw, 'address', p.address,
         'meteringPointId', (SELECT mp.id FROM customer.metering_point mp
                              WHERE mp.ean = p.ean AND mp.customer_id = p.claimed_by_customer_id
                              ORDER BY mp.valid_from DESC LIMIT 1),
         'note', 'metering.ean_pool removed by DEC-182; this row keeps who claimed which EAN and when')
FROM metering.ean_pool p
WHERE p.claimed_at IS NOT NULL;

DROP TABLE metering.ean_pool;
```

The actor `system:migration` is the house spelling for audit rows a migration writes. The migration runs as the owner, so row security does not filter the insert, and each row carries its customer id so each company's audit view sees its own claim. A claim that [DEC-151] had already released cleared both columns and is not recoverable. `Down()` recreates `metering.ean_pool` exactly as migrations 5 and 13 left it (columns, primary key, the unique EAN index, the partial claimed-at index, `REVOKE ALL`, `SELECT, UPDATE` for the customer role, `SELECT` and a column `UPDATE` on the two claim columns for the employee role), re-inserts the claimed rows from the audit rows this migration wrote (a SQL-null address was written as a JSON null, so it is turned back with `NULLIF`), then deletes exactly those audit rows by actor and action. Up, Down, Up is idempotent. Unclaimed rows are not restored.

**3. Why 44 before 45.** The new tables exist before the old one goes, and every task in between builds against a schema that has both.

**4. The pins that move.** `tools/verify-migrator.sh` (the ordered list of migrations, the pool grants replaced by the new grants, `ean_pool` absent, `edsn_verified_at` nullable, row security off on both new tables); the migration-count tests; the EF model snapshot, which loses `EanPoolEntry`. ⚠ **As built 2026-10-16:** `verify-migrator.sh` has the 45-entry ordered case, the grants of both new tables, `relrowsecurity` false with no policy, `edsn_verified_at` nullable (line 153) and `to_regclass('metering.ean_pool') IS NULL` (line 120); `MigrationScriptTests` pins 45 migrations (line 41); the customer-id-owned entities and tables discovered by the row-security guards went from 20 to 19, because the pool was the twentieth (`RowLevelSecurityTests.cs` lines 1003 and 1312). Migrations 5 and 13 and their designers stay as history.

**5. To be confirmed at build.** The one place this table lives; [DEC-182] (20) points here. ⚠ **Part S, 2026-10-16:** the rows for the not-active problem type, the migration ids, the counts and the print proof are answered by the build and say what was found; the rows for the preprod address, the page parameter, the extension (in part), the VM's contents and the product owner's confirmation stay open, and say who answers them. The specifications do not state an open row as fact.

| Not known | What this page says now | Answered by |
| --- | --- | --- |
| Whether the product owner's EDSN preprod address answers from the VM | It is the built-in default of `Edsn:BaseUrl` and `EDSN_BASE_URL` (`deploy/docker-compose.yaml` lines 91 and 131); after the deploy one signed-in search must not answer 503. ⚠ **Not checked 2026-10-16:** the probes of 2026-10-15 were made from a laptop, and the landing has not happened | **Open until the landing.** The operator, at the landing |
| The master-data page parameter | Probed 2026-10-15: the endpoint ignores `pageNumber`, `page`, `itemsPerPage` and `pageSize` and answers page 1 with up to 100 items and its `maximumPages`; later pages are asked for only when that is more than 1. ⚠ **Found 2026-10-16:** no parameter name was found. `Edsn:MasterDataPageParameter` keeps `pageNumber` as a guess that is used only when a reply says `maximumPages` is more than 1, and the reader stops with a warning and records the fetch incomplete when a reply does not move on (`EdsnMasterDataClientTests`, task P1) | **Open** until a connection with more than 100 master-data items is seen. The operator, if that warning ever appears in the log |
| Whether the search reply carries the house-number extension, and whether an empty extension matches every suffix | ⚠ **Found 2026-10-16:** the live sample of an address with no extension carries no extension key; the parser reads `exBuildingNr` and `houseNumberExtension`, names that nothing has confirmed. **Built as designed for the match:** the master data's address is preferred and the search hit's is the fallback, written to the audit row as `addressSource` `MASTER_DATA` or `SEARCH`; an extension is compared exactly after normalisation, so `16` does not match `16A` in either direction (`ConnectionAttachRulesTests.cs` lines 62 to 69). Whether a search without an extension returns every suffix was not probed | **Open** for EDSN's behaviour (P1, P6); the match itself is closed |
| The problem type and the eligibility outcome for a company that is not active | **Fixed 2026-10-16:** problem type `connection-company-not-active` (409, title "Your company is not active yet"), eligibility outcome `COMPANY_NOT_ACTIVE`, both checked before EDSN is asked (`ApiResults.cs` lines 124 to 127, `AddConnectionEndpoints.cs`) | **Closed.** Task P6 |
| The migration ids of 44 and 45 | **Fixed 2026-10-16:** `20261015082132_EanSearchMasterData` and `20261015130245_RemoveEanPool` | **Closed.** Tasks P2, P8 |
| The operation, schema and route counts of both documents | **Counted 2026-10-16 from the committed documents and tests:** customer 66 became 69 operations and 110 became 118 schemas (four operations in and one out; `artifacts/openapi/customer.json`); employee 59 became 63 operations and 91 became 103 schemas (five in and one out; `employee.json`). The pins: `SharedReferenceDataCount` 5 to 6, `TenantScopedCollectionGetCount` 18 to 19, `TenantScopedParameterisedCount` 13 to 14 (`CustomerApiRouteTableTests.cs` lines 244 to 262) and `EmployeeEndpointCount` 59 to 63 (`EmployeeRouteTableTests.cs` line 111) | **Closed.** Tasks P8, W10 |
| The print proof of the popup in both portals | **Built as designed (checked 2026-10-16 against the proofs of W6, W8 and W10):** the customer popup prints on one A4 page for the usual data and on two for a long variant (long party names, long street, 60 linked points), in English and Dutch at 375 and 1280; the back office popup prints on two pages at most, from the customers card and from the wizard. In both, the page behind, the top bar, the rail and the Save as PDF and Close buttons are absent. Print is the browser's: no PDF is built on the server | **Closed.** Tasks W6, W8, W10 |
| Whether the VM holds pool rows or real EANs | Not known; the migration and the backfill are right for zero and for many, and the pool rows' fate is known: claimed rows become audit rows, the rest are dropped; run the counts at the landing | **Open.** The operator |
| The product owner's confirmation of the defaults of [DEC-182] (17), (a) to (u) | All built; none blocks. No confirmation or change has been received as of 2026-10-16 | **Open.** The product owner |

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
| ~~Approval requests **[DEC-71]**~~ | ~~7 years~~ | ~~Never deleted. It is the evidence a second person agreed~~ ⚠ **Never built, struck 2026-10-12 ([DEC-179]).** What exists of past approvals — the `trade_event` rows and the `FOUR_EYES_*` and `WITHDRAWAL_*` audit rows — keeps the retention of its own table |
| Deposit intents, incoming payments, withdrawal requests **[DEC-106]**, **[DEC-83]** | 7 years | Never deleted. A matched payment is a money movement; an **unmatched** one is a fact about somebody's money and is kept for exactly as long |
| Audit records | ~~Per **[OQ-48]**~~ **7 years [DEC-95]** | Never deleted within the window |
| Day-ahead feed runs **[DEC-180]** | 90 days (`DayAheadIngestion:RunRetentionDays`) | Deleted by the job |
| Saved costs and positions **[DEC-180]** | Derived data, rebuilt from their inputs | No history of a saved cost is kept [DEC-180] cost (c) |

⚠ **What "the bookkeeping program holds the financial record" costs, stated.** Deleting this
database after seven years is now safe for *finance* and not safe for *evidence*: the trade timeline,
~~the approval trail~~ and the ingestion history exist nowhere else. The retention above is therefore a
floor for the audit trail even where the financial obligation has been discharged elsewhere.

## 9. Open questions

⚠ **Rewritten to the post-2026-08-19 position.** Three of the six rows closed and four opened; two
carried over unchanged.

| Ref | Question |
| --- | --- |
| ~~[OQ-48]~~ | ~~Audit retention period~~ ✅ **CLOSED — seven fiscal years, and the financial record of record is the bookkeeping program; the platform retains the action audit trail** **[DEC-95]** — §8 |
| [OQ-53] | Expected number of metering points at year 1 and year 3 — this determines whether partitioning by month is enough. **[DEC-38]** makes it an inbound-request-rate question as well as a storage one — §2.1. **Still open**, and **[DEC-09]** still holds until the count reaches four digits |
| [OQ-54] | Is a read replica needed for reporting, or is the primary sufficient? **Still open.** ⚠ **[DEC-97]** adds a reader: the customer usage API serves interval and aggregated net usage per metering point, which is the first customer-facing query shaped like a report |
| ~~*(unnumbered, against **[DEC-33]**)*~~ | ~~The four-eyes threshold **value**…~~ ✅ **CLOSED — there is no threshold, in euros or in megawatts** **[DEC-71]**, closing **[OQ-85]**. The table is not built, nothing ships empty and nothing blocks acceptance — §3.1.2, §3.4. ⚠ **And since 2026-10-12 there is no four-eyes at all [DEC-179]** |
| ~~*(unnumbered, against **[DEC-44]**)*~~ | ~~When a customer exports and no feed-in tariff resolves, is the export valued at zero or at day-ahead?~~ ✅ **CLOSED — at day-ahead, raw** **[DEC-87]**, closing **[OQ-86]**. There is no feed-in tariff, so there is nothing to fail to resolve — §3.6 |
| ~~*(new, against **[DEC-65]**)*~~ | ~~Who establishes `production_expectation` at onboarding, and from what source?~~ ✅ **CLOSED — the customer declares it, and it is the customer's responsibility** **[DEC-112]**, closing **[OQ-91]**. SJV and profile fractions sanity-check the declaration; `CUSTOMER_DECLARED` is the source value — §3.1.1 |
| **[OQ-93]** | Which incoming-payment feed does the platform consume — CAMT.053 import, a PSP webhook, or a SEPA-instant push? `wallet.incoming_payment` is deliberately feed-independent, so the **tables** can ship; the **matcher** cannot — §3.5.2 |
| **[OQ-94]** | What collateral or exposure limit applies to a short position **[DEC-72]**? Nothing in this schema bounds one: no collateral column, no exposure limit, no margin table. Encoding a limit before the rule exists would be inventing the rule — §3.4.3 |
| **[OQ-96]** | Does the *vermindering* — the fixed annual reduction on energiebelasting — apply, and to which connections? It is **not** expressible as a tier override in `billing.energy_tax_reduction`, so answering it changes the schema, not just the data — §3.6.1 |
| **[OQ-92]** | Are the hedge and the day-ahead delivery one pushed draft invoice or two? `billing.invoice` supports either; the answer decides how many drafts per customer per month the bookkeeping program is asked to number **[DEC-88]** — §3.6.2 |
