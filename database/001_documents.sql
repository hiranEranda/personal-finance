-- Migration 001: documents table
-- Replaces rag/storage/documents.json

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
