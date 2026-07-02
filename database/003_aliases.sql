-- Migration 003: aliases table for query expansion (REC-004)
--
-- source='manual' entries are never overwritten by auto-detection.
-- source='auto'   entries are upserted by the ingestion pipeline.
-- enabled=FALSE   disables an alias without deleting it.

CREATE TABLE IF NOT EXISTS aliases (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alias       VARCHAR(64) UNIQUE NOT NULL,   -- lowercase shorthand, matched case-insensitively
    expansion   TEXT NOT NULL,                  -- full form appended to the query before embedding
    source      VARCHAR(16) DEFAULT 'manual',  -- 'manual' | 'auto'
    enabled     BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aliases_enabled ON aliases(enabled) WHERE enabled = TRUE;

-- Seed with known CSE shorthand. ON CONFLICT DO NOTHING so re-running is safe.
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
