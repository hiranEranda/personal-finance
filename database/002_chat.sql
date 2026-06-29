-- Migration 002: chat history tables

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
    -- populated for assistant messages after REC-002 query rewriting is implemented
    rewritten_query    TEXT,
    -- best rerank score from the retrieval pipeline; used to audit REC-001 cutoff
    best_rerank_score  NUMERIC(6,4),
    institution_filter VARCHAR(128),
    period_filter      VARCHAR(64),
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
    ON chat_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS chat_sources (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id   UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    -- nullable: doc may have been deleted after the conversation
    document_id  UUID REFERENCES documents(id) ON DELETE SET NULL,
    institution  VARCHAR(128),
    period       VARCHAR(64),
    section      TEXT,
    chunk_text   TEXT,
    rerank_score NUMERIC(6,4),
    position     SMALLINT
);

CREATE INDEX IF NOT EXISTS idx_chat_sources_message ON chat_sources(message_id);
