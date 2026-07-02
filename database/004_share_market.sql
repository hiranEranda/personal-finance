-- Migration 004: Share Market Tracker tables
--
-- Backs the /shares page (CSE portfolio: tickers, buy/sell log, weekly prices).
-- No FK cascade between share_tickers and share_trades/share_sells/share_weekly_prices —
-- mirrors the app's in-memory model, where deleting a ticker leaves its trade/sell
-- history in place (orphaned rows are simply excluded from holdings calculations).
-- The server persists this as a single document: every save replaces the full
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
