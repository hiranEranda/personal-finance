-- Migration 008: External fund-name matching tables
--
-- Shared by the price-scraper and deposit-parser services, both of which face
-- the same problem: an external source (utasl.lk's price feed, or a bank's
-- deposit-confirmation PDF) names a fund with a string that doesn't exactly
-- match funds.name. Once a human confirms a mapping, it's remembered forever
-- in fund_name_aliases so the same PDF/feed row never needs review twice.
--
-- processed_deposit_files tracks which PDFs have already been parsed (the
-- deposit-parser's dedupe key) and, for unmatched ones, backs the manual
-- review queue in the UI.

CREATE TABLE IF NOT EXISTS fund_name_aliases (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_name TEXT NOT NULL,        -- exact string as seen from the external source
    source        VARCHAR(20) NOT NULL, -- 'utasl' | 'cal_ut' | 'ndbw_ut'
    fund_id       UUID NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (external_name, source)
);

CREATE TABLE IF NOT EXISTS processed_deposit_files (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source            VARCHAR(20) NOT NULL,  -- 'cal_ut' | 'ndbw_ut'
    pdf_filename      TEXT NOT NULL,
    parsed_fund_name  TEXT NOT NULL,
    fund_id           UUID REFERENCES funds(id),         -- NULL until matched
    transaction_id    UUID REFERENCES transactions(id),  -- NULL until inserted
    status            VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|matched|inserted|error
    issued_date       DATE,
    amount            NUMERIC(14,4),
    nav               NUMERIC(12,4),
    units             NUMERIC(18,8),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source, pdf_filename)
);

CREATE INDEX IF NOT EXISTS idx_processed_deposit_files_status ON processed_deposit_files(status);
