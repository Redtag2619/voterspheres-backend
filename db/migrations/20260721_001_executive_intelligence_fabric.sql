CREATE TABLE IF NOT EXISTS executive_intelligence_memory (

  id BIGSERIAL PRIMARY KEY,

  workspace_id BIGINT NOT NULL DEFAULT 1,

  user_id TEXT NULL,

  question TEXT NOT NULL,

  summary TEXT NULL,

  entities JSONB NOT NULL DEFAULT '{}'::jsonb,

  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,

  evidence_status TEXT NOT NULL DEFAULT 'unavailable',

  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

);

CREATE INDEX IF NOT EXISTS idx_executive_intelligence_memory_workspace ON executive_intelligence_memory (workspace_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_executive_intelligence_memory_user ON executive_intelligence_memory (user_id,created_at DESC);

CREATE INDEX IF NOT EXISTS idx_executive_intelligence_memory_entities ON executive_intelligence_memory USING GIN (entities);

