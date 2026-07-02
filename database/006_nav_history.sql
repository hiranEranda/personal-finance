-- Migration 006: NAV history tables
--
-- Backs the /funds and /analytics pages' monthly NAV series and yearly return
-- summaries. Replaces server/database/nav_history.json. Populated once by
-- migrate_nav_from_json.py from the existing JSON, and going forward by the
-- price-scraper service (nav_history only — yearly_performance has no
-- automated source and stays migration-only for now).

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
