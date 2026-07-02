-- Migration 007: Fixed Deposits tracker table
--
-- Backs the new /fixed-deposits page. Entirely manual entry — no external
-- data source, no transaction history like funds have. Maturity/accrued
-- value is computed client-side from these fields.

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
