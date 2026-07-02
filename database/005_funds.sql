-- Migration 005: Funds tracker tables
--
-- Backs the /funds page (unit trust funds: metadata + purchase transactions).
-- Replaces server/database/active_funds/<id>.csv and deleted_funds/ — the CSV
-- filename (a Date.now() timestamp generated client-side) becomes legacy_id,
-- kept only so migrate_nav_from_json.py can join nav_history.json onto the
-- right fund. Soft delete (deleted_at) replaces the file-move to deleted_funds/.

CREATE TABLE IF NOT EXISTS funds (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id           TEXT UNIQUE,          -- preserves the CSV-filename timestamp ID
    name                TEXT NOT NULL,
    type                VARCHAR(20) NOT NULL, -- 'Equity'|'Debt'|'Hybrid'|'Income'|'Money Market'
    current_nav         NUMERIC(12,4) NOT NULL DEFAULT 0,
    category            TEXT,                 -- from nav_history.json fund_info.category
    management_company  TEXT,                 -- from nav_history.json fund_info.management_company
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
