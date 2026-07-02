-- FinanceOS schema — creates every table the app needs, from nothing.
--
-- Safe to run on a fresh database and safe to re-run (everything is
-- CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING). There is no
-- migration history to track here — this file always reflects the current,
-- complete schema. If you need to change it later, edit it in place and
-- re-run it against your dev database.

-- === RAG: document ingestion + chat ===

CREATE TABLE IF NOT EXISTS documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_hash     VARCHAR(64) UNIQUE NOT NULL,
    filename      TEXT NOT NULL,
    doc_type      VARCHAR(32),
    institution   VARCHAR(128),
    period_start  DATE,
    period_end    DATE,
    currency      VARCHAR(8),
    file_path     TEXT,
    chunk_count   INTEGER DEFAULT 0,
    ingested_at   TIMESTAMPTZ DEFAULT NOW(),
    status        VARCHAR(20) DEFAULT 'pending',
    -- pending | processing | done | error | low_confidence
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_documents_institution ON documents(institution);
CREATE INDEX IF NOT EXISTS idx_documents_status      ON documents(status);

CREATE TABLE IF NOT EXISTS chat_sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title      TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id         UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role               VARCHAR(16) NOT NULL,   -- user | assistant
    content            TEXT NOT NULL,
    rewritten_query    TEXT,
    best_rerank_score  NUMERIC(6,4),
    institution_filter VARCHAR(128),
    period_filter      VARCHAR(64),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS chat_sources (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id   UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    document_id  UUID REFERENCES documents(id) ON DELETE SET NULL,
    institution  VARCHAR(128),
    period       VARCHAR(64),
    section      TEXT,
    chunk_text   TEXT,
    rerank_score NUMERIC(6,4),
    position     SMALLINT
);

CREATE INDEX IF NOT EXISTS idx_chat_sources_message ON chat_sources(message_id);

-- Query-expansion shorthand for the RAG chat (e.g. "jkh" -> "John Keells
-- Holdings PLC"). source='manual' entries are never overwritten by
-- auto-detection; source='auto' entries are upserted by the ingestion
-- pipeline; enabled=FALSE disables an alias without deleting it.
CREATE TABLE IF NOT EXISTS aliases (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alias       VARCHAR(64) UNIQUE NOT NULL,
    expansion   TEXT NOT NULL,
    source      VARCHAR(16) DEFAULT 'manual',
    enabled     BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aliases_enabled ON aliases(enabled) WHERE enabled = TRUE;

-- Generic CSE shorthand — public ticker/company-name mappings, not anyone's
-- private data. Feel free to add your own or remove these.
INSERT INTO aliases (alias, expansion, source) VALUES
    ('dist',  'Distilleries Company of Sri Lanka PLC DCSL', 'manual'),
    ('dcsl',  'Distilleries Company of Sri Lanka PLC DCSL', 'manual'),
    ('cic',   'CIC Holdings PLC',                           'manual'),
    ('jkh',   'John Keells Holdings PLC',                   'manual'),
    ('com',   'Commercial Bank of Ceylon PLC',              'manual'),
    ('hnb',   'Hatton National Bank PLC',                   'manual'),
    ('samp',  'Sampath Bank PLC',                           'manual'),
    ('dial',  'Dialog Axiata PLC',                          'manual'),
    ('lion',  'Lion Brewery Ceylon PLC',                    'manual'),
    ('carg',  'Cargills Ceylon PLC',                        'manual'),
    ('hasu',  'Hemas Holdings PLC',                         'manual')
ON CONFLICT (alias) DO NOTHING;

-- === Shares: CSE portfolio tracker ===
--
-- Backs the /shares page. No FK cascade between share_tickers and
-- share_trades/share_sells/share_weekly_prices — mirrors the app's in-memory
-- model, where deleting a ticker leaves its trade/sell history in place
-- (orphaned rows are simply excluded from holdings calculations). The server
-- persists this as a single document: every save replaces the full
-- ticker/trade/sell/sector/weekly-price set in one transaction.

CREATE TABLE IF NOT EXISTS share_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO share_settings (key, value) VALUES ('sellSideFeeRate', '0.0112')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS share_sectors (
    name       TEXT PRIMARY KEY,
    sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS share_tickers (
    ticker        VARCHAR(32) PRIMARY KEY,
    company_name  TEXT NOT NULL,
    exchange      VARCHAR(16) DEFAULT 'CSE',
    sector        TEXT,
    currency      VARCHAR(8) DEFAULT 'LKR',
    current_price NUMERIC(14,4) NOT NULL,
    notes         TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS share_trades (
    id          INTEGER PRIMARY KEY,
    ticker      VARCHAR(32) NOT NULL,
    buy_date    DATE NOT NULL,
    qty         NUMERIC(14,4) NOT NULL,
    buy_price   NUMERIC(14,4) NOT NULL,
    fees_total  NUMERIC(14,4) NOT NULL DEFAULT 0,
    notes       TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_share_trades_ticker ON share_trades(ticker);

CREATE TABLE IF NOT EXISTS share_sells (
    id          INTEGER PRIMARY KEY,
    ticker      VARCHAR(32) NOT NULL,
    sell_date   DATE NOT NULL,
    qty         NUMERIC(14,4) NOT NULL,
    sell_price  NUMERIC(14,4) NOT NULL,
    commission  NUMERIC(14,4) NOT NULL DEFAULT 0,
    notes       TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_share_sells_ticker ON share_sells(ticker);

-- Authoritative list of weeks tracked, independent of which tickers have a
-- price entered — lets "Add Week" persist before any prices are filled in.
CREATE TABLE IF NOT EXISTS share_weeks (
    week_ending DATE PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS share_weekly_prices (
    week_ending DATE NOT NULL,
    ticker      VARCHAR(32) NOT NULL,
    price       NUMERIC(14,4),
    PRIMARY KEY (week_ending, ticker)
);

CREATE INDEX IF NOT EXISTS idx_share_weekly_prices_ticker ON share_weekly_prices(ticker);

-- === Funds: unit trust tracker ===
--
-- Backs the /funds page (fund metadata + purchase transactions).

CREATE TABLE IF NOT EXISTS funds (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id           TEXT UNIQUE,          -- for joining against any external legacy import
    name                TEXT NOT NULL,
    type                VARCHAR(20) NOT NULL, -- 'Equity'|'Debt'|'Hybrid'|'Income'|'Money Market'
    current_nav         NUMERIC(12,4) NOT NULL DEFAULT 0,
    category            TEXT,
    management_company  TEXT,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funds_deleted_at ON funds(deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS transactions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fund_id     UUID NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
    date        DATE NOT NULL,
    amount      NUMERIC(14,4) NOT NULL,  -- amount invested (LKR)
    nav         NUMERIC(12,4) NOT NULL,  -- NAV at purchase date
    units       NUMERIC(18,8) NOT NULL,  -- units purchased
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_fund_id ON transactions(fund_id, date);

-- NAV history: monthly series + yearly return summaries, shown on /funds and
-- /analytics. Kept current going forward by the price-scraper service
-- (nav_history only — yearly_performance has no automated source).

CREATE TABLE IF NOT EXISTS nav_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fund_id     UUID NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
    date        DATE NOT NULL,
    nav         NUMERIC(12,4) NOT NULL,
    return_pct  NUMERIC(8,4),
    UNIQUE (fund_id, date)
);

CREATE INDEX IF NOT EXISTS idx_nav_history_fund_date ON nav_history(fund_id, date);

CREATE TABLE IF NOT EXISTS yearly_performance (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fund_id     UUID NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
    year        SMALLINT NOT NULL,
    return_pct  NUMERIC(8,4) NOT NULL,
    UNIQUE (fund_id, year)
);

CREATE INDEX IF NOT EXISTS idx_yearly_perf_fund_year ON yearly_performance(fund_id, year);

-- Fund-name matching, shared by price-scraper and deposit-parser: both face
-- the same problem — an external source (utasl.lk's price feed, or a bank's
-- deposit-confirmation PDF) names a fund with a string that doesn't exactly
-- match funds.name. Once a human confirms a mapping, it's remembered forever
-- here so the same PDF/feed row never needs review twice.
CREATE TABLE IF NOT EXISTS fund_name_aliases (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_name TEXT NOT NULL,
    source        VARCHAR(20) NOT NULL, -- 'utasl' | 'cal_ut' | 'ndbw_ut'
    fund_id       UUID NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (external_name, source)
);

-- Tracks which deposit-confirmation PDFs have been parsed (the
-- deposit-parser's dedupe key) and, for unmatched ones, backs the manual
-- review queue in the UI. transaction_id is ON DELETE SET NULL rather than
-- CASCADE: a fund save replaces its whole transaction set (new ids every
-- time), and losing the trace-back link is fine, but losing this row
-- entirely would let an already-processed PDF be re-inserted as a duplicate
-- on the next sync.
CREATE TABLE IF NOT EXISTS processed_deposit_files (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source            VARCHAR(20) NOT NULL,  -- 'cal_ut' | 'ndbw_ut'
    pdf_filename      TEXT NOT NULL,
    parsed_fund_name  TEXT NOT NULL,
    fund_id           UUID REFERENCES funds(id),
    transaction_id    UUID REFERENCES transactions(id) ON DELETE SET NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|inserted|error
    issued_date       DATE,
    amount            NUMERIC(14,4),
    nav               NUMERIC(12,4),
    units             NUMERIC(18,8),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source, pdf_filename)
);

CREATE INDEX IF NOT EXISTS idx_processed_deposit_files_status ON processed_deposit_files(status);

-- === Fixed Deposits ===
--
-- Backs the /fixed-deposits page. Entirely manual entry — no external data
-- source. Value at maturity is computed client-side from these fields
-- (Actual/365 simple interest); net worth counts the principal until the
-- maturity date is reached, then the matured value.

CREATE TABLE IF NOT EXISTS fixed_deposits (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_name         TEXT NOT NULL,
    principal         NUMERIC(14,4) NOT NULL,
    interest_rate     NUMERIC(6,3) NOT NULL,               -- annual %, e.g. 12.500
    start_date        DATE NOT NULL,
    maturity_date     DATE NOT NULL,
    payout_frequency  VARCHAR(20) NOT NULL DEFAULT 'at_maturity', -- 'at_maturity'|'monthly'|'quarterly'
    status            VARCHAR(20) NOT NULL DEFAULT 'active',       -- 'active'|'matured'|'withdrawn'
    notes             TEXT DEFAULT '',
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fixed_deposits_status ON fixed_deposits(status);
